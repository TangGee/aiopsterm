<template>
  <div
    class="app-shell"
    :class="{
      'has-app-background': workspace.config.background.mode !== 'none',
      'watermark-enabled': workspace.config.watermark === 'open'
    }"
    :style="appBackgroundStyle"
  >
    <TopBar />
    <main
      class="app-body"
      :class="[
        `mode-${workspace.mode}`,
        `module-${workspace.activeModule}`,
        { 'has-left-pane': hasLeftPane, 'has-right-pane': hasRightPane }
      ]"
    >
      <template v-if="workspace.mode === 'agents'">
        <div
          v-if="showAgentsLeftPane"
          class="layout-pane layout-pane-left agents-sidebar-pane"
          :style="{ width: `${displayAgentsLeftWidth}px` }"
          data-layout-pane="agents-left"
        >
          <AgentsSidebar />
        </div>
        <button
          v-if="showAgentsLeftPane"
          class="layout-resizer layout-resizer-left"
          :class="{ dragging: draggingSide === 'agents-left' }"
          data-layout-resizer="agents-left"
          title="调整会话侧栏宽度"
          aria-label="调整会话侧栏宽度"
          @mousedown="startResize('agents-left', $event)"
        ></button>
        <section class="agents-stage">
          <AiPanel agent-mode />
        </section>
      </template>

      <template v-else>
        <SideRail />
        <div
          v-if="showTerminalLeftPane"
          class="layout-pane layout-pane-left module-panel-pane"
          :style="{ width: `${displayLeftPanelWidth}px` }"
          data-onboarding-id="left-function-panel"
          data-layout-pane="terminal-left"
        >
          <ModulePanel />
        </div>
        <button
          v-if="showTerminalLeftPane"
          class="layout-resizer layout-resizer-left"
          :class="{ dragging: draggingSide === 'left' }"
          data-layout-resizer="terminal-left"
          title="调整左侧面板宽度"
          aria-label="调整左侧面板宽度"
          @mousedown="startResize('left', $event)"
        ></button>
        <FilesWorkspace v-if="workspace.activeModule === 'files'" />
        <AssetsWorkspace v-else-if="workspace.activeModule === 'assets'" />
        <ExtensionsWorkspace v-else-if="workspace.activeModule === 'extensions'" />
        <KubernetesWorkspace v-else-if="workspace.activeModule === 'kubernetes'" />
        <SettingsWorkspace v-else-if="workspace.activeModule === 'settings'" />
        <UserPanel v-else-if="workspace.activeModule === 'user'" />
        <TerminalWorkspace v-else-if="workspace.activeModule !== 'database'" />
        <DatabaseWorkspace v-else />
        <div
          v-if="showTerminalRightPane"
          class="layout-pane layout-pane-right ai-panel-pane"
          :style="{ width: `${displayRightPanelWidth}px` }"
          data-onboarding-id="right-ai-sidebar"
          data-layout-pane="terminal-right"
        >
          <button
            class="layout-resizer layout-resizer-right"
            :class="{ dragging: draggingSide === 'right' }"
            data-layout-resizer="terminal-right"
            title="调整 AI 侧栏宽度"
            aria-label="调整 AI 侧栏宽度"
            @mousedown="startResize('right', $event)"
          ></button>
          <AiPanel />
        </div>
        <OnboardingSpotlight />
      </template>
    </main>
    <div
      v-if="terminalMfaDialog.open && terminalMfaDialog.request"
      class="terminal-mfa-backdrop"
      data-testid="terminal-mfa-dialog"
    >
      <section
        class="terminal-mfa-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="terminalAuthTitle"
      >
        <header>
          <div>
            <span>{{ terminalAuthRequired }}</span>
            <strong>{{ terminalAuthTitle }}</strong>
          </div>
          <button
            type="button"
            :title="t('common.close')"
            @click="cancelTerminalMfa"
          >
            <X />
          </button>
        </header>
        <p>
          {{ terminalAuthDescription }}
        </p>
        <form @submit.prevent="submitTerminalMfa">
          <label
            v-for="(prompt, index) in terminalMfaPrompts"
            :key="`${terminalMfaDialog.request.id}-${index}`"
          >
            <span>{{ prompt.prompt || terminalAuthPromptFallback }}</span>
            <input
              v-model="terminalMfaDialog.responses[index]"
              :ref="(element) => setTerminalMfaInputRef(element, index)"
              :type="prompt.echo ? 'text' : 'password'"
              autocomplete="one-time-code"
              :aria-label="prompt.prompt || terminalAuthPromptFallback"
              :disabled="terminalMfaDialog.submitting"
              data-testid="terminal-mfa-input"
            />
          </label>
          <label
            v-if="showTerminalPasswordRemember"
            class="terminal-mfa-remember"
          >
            <input
              v-model="terminalMfaDialog.rememberPassword"
              type="checkbox"
              :disabled="terminalMfaDialog.submitting"
              data-testid="terminal-password-remember"
            />
            <span>{{ t('terminal.passwordRemember') }}</span>
          </label>
          <p
            v-if="terminalMfaDialog.error"
            class="terminal-mfa-error"
            data-testid="terminal-mfa-error"
          >
            {{ terminalMfaDialog.error }}
          </p>
          <footer>
            <button
              type="button"
              :disabled="terminalMfaDialog.submitting"
              @click="cancelTerminalMfa"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              class="primary"
              :disabled="terminalMfaDialog.submitting"
              data-testid="terminal-mfa-submit"
            >
              {{ terminalMfaDialog.submitting ? t('terminal.mfaSubmitting') : t('terminal.mfaSubmit') }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import TopBar from '@/components/TopBar.vue'
import SideRail from '@/components/SideRail.vue'
import ModulePanel from '@/components/ModulePanel.vue'
import TerminalWorkspace from '@/components/TerminalWorkspace.vue'
import FilesWorkspace from '@/components/FilesWorkspace.vue'
import AssetsWorkspace from '@/components/AssetsWorkspace.vue'
import ExtensionsWorkspace from '@/components/ExtensionsWorkspace.vue'
import KubernetesWorkspace from '@/components/KubernetesWorkspace.vue'
import SettingsWorkspace from '@/components/SettingsWorkspace.vue'
import AiPanel from '@/components/AiPanel.vue'
import AgentsSidebar from '@/components/AgentsSidebar.vue'
import DatabaseWorkspace from '@/components/DatabaseWorkspace.vue'
import UserPanel from '@/components/panels/UserPanel.vue'
import OnboardingSpotlight from '@/components/onboarding/OnboardingSpotlight.vue'
import { layoutWidthLimits, useWorkspaceStore } from '@/stores/workspace'
import { backgroundStyleVars } from '@/services/backgroundRuntime'
import { applyDocumentLocale, useI18n, type I18nKey } from '@/i18n'
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'
import type { TerminalKeyboardInteractiveRequest, TerminalKeyboardInteractiveResult } from '@shared/preload'

const workspace = useWorkspaceStore()
const { locale, t } = useI18n()
type ResizeSide = 'left' | 'right' | 'agents-left'
type TerminalMfaPrompt = TerminalKeyboardInteractiveRequest['prompts'][number]
type TerminalMfaDialogState = {
  open: boolean
  request: TerminalKeyboardInteractiveRequest | null
  responses: string[]
  rememberPassword: boolean
  submitting: boolean
  error: string
}

const draggingSide = ref<ResizeSide | null>(null)
const draftLeftPanelWidth = ref<number | null>(null)
const draftRightPanelWidth = ref<number | null>(null)
const draftAgentsLeftWidth = ref<number | null>(null)
let resizeStartX = 0
let resizeStartWidth = 0
let resizeQuickClosed = false
let stopDeepLink: (() => void) | undefined
let stopKeyboardInteractiveRequest: (() => void) | undefined
let stopKeyboardInteractiveResult: (() => void) | undefined
let stopAiAgentSessionEvent: (() => void) | undefined
let stopManagedAiSessionEvent: (() => void) | undefined
let stopManagedAiSessionFocusRequest: (() => void) | undefined
const terminalMfaInputRefs = ref<HTMLInputElement[]>([])
const terminalMfaDialog = ref<TerminalMfaDialogState>({
  open: false,
  request: null,
  responses: [],
  rememberPassword: false,
  submitting: false,
  error: ''
})

const showAgentsLeftPane = computed(() => workspace.mode === 'agents' && workspace.agentsLeftOpen)
const showTerminalLeftPane = computed(
  () => workspace.mode === 'terminal' && workspace.isLeftVisible && !['assets', 'settings', 'database', 'user'].includes(workspace.activeModule)
)
const showTerminalRightPane = computed(
  () => workspace.mode === 'terminal' && workspace.isRightVisible && !['assets', 'database', 'user'].includes(workspace.activeModule)
)
const hasLeftPane = computed(() => showAgentsLeftPane.value || showTerminalLeftPane.value)
const hasRightPane = computed(() => showTerminalRightPane.value)
const displayLeftPanelWidth = computed(() => draftLeftPanelWidth.value ?? workspace.leftPanelWidth)
const displayRightPanelWidth = computed(() => draftRightPanelWidth.value ?? workspace.rightPanelWidth)
const displayAgentsLeftWidth = computed(() => draftAgentsLeftWidth.value ?? workspace.agentsLeftWidth)
const appBackgroundStyle = computed(() => backgroundStyleVars(workspace.config.background))
const terminalMfaTarget = computed(() => {
  const request = terminalMfaDialog.value.request
  return request ? `${request.username}@${request.host}:${request.port}` : ''
})
const terminalMfaPrompts = computed<TerminalMfaPrompt[]>(() => {
  const prompts = terminalMfaDialog.value.request?.prompts || []
  return prompts.length ? prompts : [{ prompt: terminalAuthPromptFallback.value, echo: false }]
})
const isTerminalPasswordPrompt = computed(() => terminalMfaDialog.value.request?.purpose === 'password')
const showTerminalPasswordRemember = computed(
  () => isTerminalPasswordPrompt.value && terminalMfaDialog.value.request?.canRememberPassword === true
)
const isTerminalPasswordRetry = computed(() => isTerminalPasswordPrompt.value && Number(terminalMfaDialog.value.request?.attempts || 1) > 1)
const terminalAuthTitle = computed(() => t(isTerminalPasswordPrompt.value ? 'terminal.passwordTitle' : 'terminal.mfaTitle'))
const terminalAuthRequired = computed(() => t(isTerminalPasswordPrompt.value ? 'terminal.passwordRequired' : 'terminal.mfaRequired'))
const terminalAuthPromptFallback = computed(() => t(isTerminalPasswordPrompt.value ? 'terminal.passwordPromptFallback' : 'terminal.mfaPromptFallback'))
const terminalAuthDescription = computed(() => {
  const key = isTerminalPasswordPrompt.value
    ? isTerminalPasswordRetry.value
      ? 'terminal.passwordRejectedDescription'
      : 'terminal.passwordDescription'
    : 'terminal.mfaDescription'
  return tf(key, { target: terminalMfaTarget.value })
})

const tf = (key: I18nKey, values: Record<string, string | number>) => {
  let text = t(key)
  Object.entries(values).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value))
  })
  return text
}

const clampLayoutWidth = (width: number) => Math.min(layoutWidthLimits.max, Math.max(layoutWidthLimits.min, Math.round(width)))

const setDraftWidth = (side: ResizeSide, width: number | null) => {
  if (side === 'left') draftLeftPanelWidth.value = width
  if (side === 'right') draftRightPanelWidth.value = width
  if (side === 'agents-left') draftAgentsLeftWidth.value = width
}

const setTerminalMfaInputRef = (element: unknown, index: number) => {
  if (element instanceof HTMLInputElement) terminalMfaInputRefs.value[index] = element
}

const resetTerminalMfaDialog = () => {
  terminalMfaInputRefs.value = []
  terminalMfaDialog.value = {
    open: false,
    request: null,
    responses: [],
    rememberPassword: false,
    submitting: false,
    error: ''
  }
}

const handleTerminalMfaRequest = (request: TerminalKeyboardInteractiveRequest) => {
  const promptCount = request.prompts.length || 1
  terminalMfaInputRefs.value = []
  terminalMfaDialog.value = {
    open: true,
    request,
    responses: Array.from({ length: promptCount }, () => ''),
    rememberPassword: false,
    submitting: false,
    error: ''
  }
  void nextTick(() => terminalMfaInputRefs.value[0]?.focus())
}

const submitTerminalMfa = () => {
  const request = terminalMfaDialog.value.request
  if (!request || terminalMfaDialog.value.submitting) return
  const responses = terminalMfaPrompts.value.map((_prompt, index) => terminalMfaDialog.value.responses[index] || '')
  if (responses.some((value) => !value.trim())) {
    terminalMfaDialog.value.error = t('terminal.mfaEmpty')
    return
  }
  terminalMfaDialog.value.submitting = true
  terminalMfaDialog.value.error = ''
  window.aiops?.respondTerminalKeyboardInteractive?.(
    request.id,
    isTerminalPasswordPrompt.value
      ? {
          responses,
          rememberPassword: terminalMfaDialog.value.rememberPassword
        }
      : responses
  )
}

const cancelTerminalMfa = () => {
  const request = terminalMfaDialog.value.request
  if (request) {
    window.aiops?.cancelTerminalKeyboardInteractive?.(request.id)
  }
  resetTerminalMfaDialog()
}

const handleTerminalMfaResult = (result: TerminalKeyboardInteractiveResult) => {
  const request = terminalMfaDialog.value.request
  if (!request || result.id !== request.id) return
  if (result.status === 'success') {
    resetTerminalMfaDialog()
    return
  }
  if (result.status === 'failed' && !result.final) {
    terminalMfaDialog.value.submitting = false
    terminalMfaDialog.value.error = result.errorMessage || t('terminal.mfaFailed')
    terminalMfaInputRefs.value[0]?.focus()
    return
  }
  resetTerminalMfaDialog()
}

const getCurrentWidth = (side: ResizeSide) => {
  if (side === 'left') return workspace.leftPanelWidth
  if (side === 'right') return workspace.rightPanelWidth
  return workspace.agentsLeftWidth
}

const persistResize = async (side: ResizeSide, width: number) => {
  if (side === 'right') return workspace.resizeRightPanel(width)
  return workspace.resizeLeftPanel(width)
}

const quickClose = async (side: ResizeSide) => {
  if (side === 'right') return workspace.quickCloseRightPanel()
  return workspace.quickCloseLeftPanel()
}

const applyDeepLinkPayload = (payload: unknown) => {
  if (!isAiopstermDeepLinkPayload(payload)) {
    workspace.handleDeepLink(payload)
    return false
  }
  return workspace.handleDeepLink(payload)
}

const consumePendingDeepLinks = async () => {
  const consumeDeepLinks = window.aiops?.consumeDeepLinks
  if (typeof consumeDeepLinks !== 'function') return
  try {
    const payloads = await consumeDeepLinks()
    if (!Array.isArray(payloads)) {
      applyDeepLinkPayload(payloads)
      return
    }
    payloads.forEach((payload) => applyDeepLinkPayload(payload))
  } catch {
    applyDeepLinkPayload(null)
  }
}

const endResize = async () => {
  const side = draggingSide.value
  if (!side) return
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', endResize)
  draggingSide.value = null
  document.body.classList.remove('layout-resizing')
  const width = side === 'left' ? draftLeftPanelWidth.value : side === 'right' ? draftRightPanelWidth.value : draftAgentsLeftWidth.value
  setDraftWidth(side, null)
  if (resizeQuickClosed) {
    resizeQuickClosed = false
    return
  }
  if (typeof width === 'number') {
    void persistResize(side, width)
  }
}

const handleResizeMove = (event: MouseEvent) => {
  const side = draggingSide.value
  if (!side) return
  if (side === 'right') {
    const distanceFromRight = window.innerWidth - event.clientX
    if (distanceFromRight < layoutWidthLimits.quickCloseThreshold) {
      resizeQuickClosed = true
      setDraftWidth(side, null)
      void quickClose(side)
      void endResize()
      return
    }
    setDraftWidth(side, clampLayoutWidth(resizeStartWidth - (event.clientX - resizeStartX)))
    return
  }
  if (event.clientX < layoutWidthLimits.quickCloseThreshold) {
    resizeQuickClosed = true
    setDraftWidth(side, null)
    void quickClose(side)
    void endResize()
    return
  }
  setDraftWidth(side, clampLayoutWidth(resizeStartWidth + (event.clientX - resizeStartX)))
}

const startResize = (side: ResizeSide, event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  draggingSide.value = side
  resizeStartX = event.clientX
  resizeStartWidth = getCurrentWidth(side)
  resizeQuickClosed = false
  setDraftWidth(side, resizeStartWidth)
  document.body.classList.add('layout-resizing')
  window.addEventListener('mousemove', handleResizeMove)
  window.addEventListener('mouseup', endResize)
}

onMounted(() => {
  workspace.installShortcutRuntime()
  workspace.hydrateConfig()
  void workspace.refreshManagedAiSessions({ silent: true })
  stopDeepLink = window.aiops?.onDeepLink?.((payload) => {
    applyDeepLinkPayload(payload)
  })
  stopKeyboardInteractiveRequest = window.aiops?.onTerminalKeyboardInteractiveRequest?.(handleTerminalMfaRequest)
  stopKeyboardInteractiveResult = window.aiops?.onTerminalKeyboardInteractiveResult?.(handleTerminalMfaResult)
  stopAiAgentSessionEvent = window.aiops?.onAiAgentSessionEvent?.((event) => {
    workspace.upsertManagedAiSession(event)
  })
  stopManagedAiSessionEvent = window.aiops?.onManagedAiSessionEvent?.(() => {
    workspace.refreshManagedAiSessionsDebounced()
  })
  stopManagedAiSessionFocusRequest = window.aiops?.onManagedAiSessionFocusRequest?.((request) => {
    void workspace.focusManagedAiSessionRequest(request)
  })
  void consumePendingDeepLinks()
})

onUnmounted(() => {
  stopDeepLink?.()
  stopKeyboardInteractiveRequest?.()
  stopKeyboardInteractiveResult?.()
  stopAiAgentSessionEvent?.()
  stopManagedAiSessionEvent?.()
  stopManagedAiSessionFocusRequest?.()
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', endResize)
  document.body.classList.remove('layout-resizing')
  workspace.uninstallShortcutRuntime()
})

watch(
  locale,
  (value) => {
    applyDocumentLocale(value)
  },
  { immediate: true }
)
</script>
