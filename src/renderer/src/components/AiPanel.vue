<template>
  <AiPanelPresentation
    :project-files-available="projectFilesAvailable"
    :project-files-active="projectFilesActive"
    @toggle-project-files="$emit('toggleProjectFiles')"
    @close-project-files="$emit('closeProjectFiles')"
  />
</template>

<script setup lang="ts">
import { watch } from 'vue'
import AiPanelPresentation from '@/components/ai/AiPanelPresentation.vue'
import type { ProductSessionUiRequest } from '@/components/productSessionUiTypes'
import { provideAiPanelRuntime } from '@/services/ai/aiPanelContext'
import { useAiPanelContainerRuntime } from '@/services/ai/aiPanelContainerRuntime'

const props = defineProps<{
  agentMode?: boolean
  productSessionRequest?: ProductSessionUiRequest | null
  projectFilesAvailable?: boolean
  projectFilesActive?: boolean
}>()
const emit = defineEmits<{
  productSessionRequestConsumed: [sequence: number]
  toggleProjectFiles: []
  closeProjectFiles: []
}>()

const runtime = useAiPanelContainerRuntime(props)
provideAiPanelRuntime(runtime)

let latestRequestSequence = 0

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
    if (request.surface === 'codex') await runtime.createNewCodexConversation()
    else await runtime.createNewAiConversation()
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
