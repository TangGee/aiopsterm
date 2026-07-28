<template>
  <AiPanelPresentation
    v-bind="attrs"
    :project-files-available="projectFilesAvailable"
    :project-files-active="projectFilesActive"
    :project-files-session="projectFilesSession"
    @toggle-project-files="$emit('toggleProjectFiles')"
    @close-project-files="$emit('closeProjectFiles')"
  />
  <Teleport to="body">
    <div
      v-if="pendingCreateSurface"
      class="agents-resource-dialog-backdrop"
      data-testid="agents-resource-dialog"
      @mousedown.self="closeResourceDialog"
    >
      <section
        class="agents-resource-dialog"
        role="dialog"
        aria-modal="true"
        @keydown.esc.stop.prevent="closeResourceDialog"
      >
        <header>
          <strong>{{ t('agents.resourceDialogTitle', { agent: surfaceLabel }) }}</strong>
          <span>{{ resourceDialogHint }}</span>
        </header>
        <div class="agents-resource-list">
          <label
            v-for="resource in availableResources"
            :key="resource.id"
            class="agents-resource-option"
            :class="{ selected: selectedResourceIds.includes(resource.id) }"
          >
            <input
              :type="pendingCreateSurface === 'codex' ? 'radio' : 'checkbox'"
              name="agents-resource"
              :checked="selectedResourceIds.includes(resource.id)"
              :disabled="resourceSelectionDisabled(resource.id)"
              @change="toggleResource(resource.id)"
            />
            <span>
              <strong>{{ resource.label }}</strong>
              <em>{{ resource.detail }}</em>
            </span>
            <small>{{ resource.kind === 'terminal' ? t('agents.resourceOpenTerminal') : t('agents.resourceConfiguredHost') }}</small>
          </label>
          <div v-if="!availableResources.length" class="agents-resource-empty">
            {{ t('agents.resourceEmpty') }}
          </div>
        </div>
        <footer>
          <button type="button" :disabled="resourceDialogBusy" @click="closeResourceDialog">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="primary"
            data-testid="agents-resource-create"
            :disabled="resourceCreateDisabled"
            @click="confirmResourceSelection"
          >
            {{ resourceDialogBusy ? t('common.processing') : t('common.new') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, useAttrs, watch } from 'vue'
import AiPanelPresentation from '@/components/ai/AiPanelPresentation.vue'
import type { ProductSessionUiRequest } from '@/components/productSessionUiTypes'
import type { ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'
import { provideAiPanelRuntime } from '@/services/ai/aiPanelContext'
import { useAiPanelContainerRuntime } from '@/services/ai/aiPanelContainerRuntime'
import { codexTargetContextFromPanel } from '@/services/ai/aiPanelCodexRuntime'
import { classicHostContextFromTerminalPanel } from '@/services/ai/classicSessionContextRuntime'
import {
  productSessionResourceOptions,
  type ProductSessionResourceOption
} from '@/services/ai/productSessionResourceRuntime'
import { CLINE_AGENT_MAX_HOST_TARGETS } from '@shared/contracts/clineAgent'
import type { ProductSessionSurface } from '@shared/contracts/productSessions'

const props = defineProps<{
  agentMode?: boolean
  productSessionRequest?: ProductSessionUiRequest | null
  projectFilesAvailable?: boolean
  projectFilesActive?: boolean
  projectFilesSession?: ManagedAiSessionRecord | null
}>()
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const emit = defineEmits<{
  productSessionRequestConsumed: [sequence: number]
  toggleProjectFiles: []
  closeProjectFiles: []
}>()

const runtime = useAiPanelContainerRuntime(props)
provideAiPanelRuntime(runtime)
const t = runtime.t

let latestRequestSequence = 0
const pendingCreateSurface = ref<Extract<ProductSessionSurface, 'classic' | 'codex'> | null>(null)
const selectedResourceIds = ref<string[]>([])
const resourceDialogBusy = ref(false)

const availableResources = computed(() => productSessionResourceOptions(
  runtime.workspace.panels,
  runtime.workspace.aiContextCatalog,
  runtime.workspace.activePanelId
))
const surfaceLabel = computed(() => pendingCreateSurface.value === 'codex'
  ? runtime.t('agents.sessionType.codex')
  : runtime.t('agents.sessionType.classic'))
const resourceDialogHint = computed(() => pendingCreateSurface.value === 'codex'
  ? runtime.t('agents.resourceCodexHint')
  : runtime.t('agents.resourceClassicHint', { limit: CLINE_AGENT_MAX_HOST_TARGETS }))
const resourceCreateDisabled = computed(() =>
  resourceDialogBusy.value ||
  (pendingCreateSurface.value === 'codex' && selectedResourceIds.value.length !== 1)
)

const closeResourceDialog = () => {
  if (resourceDialogBusy.value) return
  pendingCreateSurface.value = null
  selectedResourceIds.value = []
}

const openResourceDialog = async (surface: Extract<ProductSessionSurface, 'classic' | 'codex'>) => {
  await runtime.workspace.refreshAiContextCatalog({ hydrateSelection: false })
  pendingCreateSurface.value = surface
  const active = availableResources.value.find((resource) => resource.panelId === runtime.workspace.activePanelId)
  selectedResourceIds.value = active ? [active.id] : []
}

const resourceSelectionDisabled = (id: string) =>
  pendingCreateSurface.value === 'classic' &&
  !selectedResourceIds.value.includes(id) &&
  selectedResourceIds.value.length >= CLINE_AGENT_MAX_HOST_TARGETS

const toggleResource = (id: string) => {
  if (pendingCreateSurface.value === 'codex') {
    selectedResourceIds.value = [id]
    return
  }
  selectedResourceIds.value = selectedResourceIds.value.includes(id)
    ? selectedResourceIds.value.filter((candidate) => candidate !== id)
    : [...selectedResourceIds.value, id].slice(0, CLINE_AGENT_MAX_HOST_TARGETS)
}

const resolveResourcePanel = async (resource: ProductSessionResourceOption) => {
  if (resource.kind === 'terminal') {
    return runtime.workspace.panels.find((panel) =>
      panel.id === resource.panelId &&
      panel.sessionId &&
      panel.status !== 'closed' &&
      panel.status !== 'error'
    ) || null
  }
  return runtime.workspace.openTerminalForAiHostContext(resource.context)
}

const confirmResourceSelection = async () => {
  const surface = pendingCreateSurface.value
  if (!surface || resourceCreateDisabled.value) return
  resourceDialogBusy.value = true
  const originalPanelId = runtime.workspace.activePanelId
  try {
    const resources = selectedResourceIds.value
      .map((id) => availableResources.value.find((resource) => resource.id === id))
      .filter((resource): resource is ProductSessionResourceOption => Boolean(resource))
    const panels = []
    for (const resource of resources) {
      const panel = await resolveResourcePanel(resource)
      if (panel?.sessionId && panel.status !== 'closed' && panel.status !== 'error') panels.push(panel)
      else if (surface === 'codex') return
    }
    if (surface === 'codex') {
      const panel = panels[0]
      if (!panel) return
      const created = await runtime.createNewCodexConversation(codexTargetContextFromPanel(panel))
      if (created === false) return
      runtime.workspace.activateTerminalPanel(panel.id)
    } else {
      const contexts = panels
        .map((panel) => classicHostContextFromTerminalPanel(panel))
        .filter((context): context is NonNullable<typeof context> => Boolean(context))
      if (originalPanelId) runtime.workspace.activateTerminalPanel(originalPanelId)
      const created = await runtime.createNewAiConversation(contexts)
      if (created === false) return
    }
    pendingCreateSurface.value = null
    selectedResourceIds.value = []
  } finally {
    resourceDialogBusy.value = false
  }
}

const showProductSessionFailure = (request: ProductSessionUiRequest) => {
  const key = request.action === 'create'
    ? 'agents.sessionCreateFailed'
    : request.action === 'focus'
      ? 'agents.sessionFocusFailed'
      : 'agents.sessionRestoreFailed'
  runtime.workspace.setTopNotice(runtime.t(key))
}

const applyProductSessionRequest = async (request: ProductSessionUiRequest) => {
  if (request.surface === 'database') return
  const selected = await runtime.selectAiPanelMode(request.surface)
  if (latestRequestSequence !== request.sequence) return
  if (!selected) {
    showProductSessionFailure(request)
    return
  }
  if (request.action === 'create') {
    await openResourceDialog(request.surface)
    return
  }
  if (!request.sessionId) return
  if (request.surface === 'codex') {
    const restored = await runtime.restoreCodexProductSession(request.sessionId)
    if (!restored && latestRequestSequence === request.sequence) showProductSessionFailure(request)
    return
  }
  await runtime.restoreHistoryConversation(request.sessionId)
}

watch(
  () => props.productSessionRequest,
  (request) => {
    if (!request || request.sequence === latestRequestSequence) return
    latestRequestSequence = request.sequence
    emit('productSessionRequestConsumed', request.sequence)
    void applyProductSessionRequest(request)
  },
  { immediate: true }
)
</script>
