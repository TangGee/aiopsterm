<template>
  <section class="right-assistant-panel">
    <AiPanel
      class="right-assistant-content"
      :agent-mode="agentMode"
      :product-session-request="productSessionRequest"
      :project-files-available="projectFilesAvailable"
      :project-files-active="projectFilesActive"
      :project-files-session="activeManagedAiSession"
      @toggle-project-files="toggleProjectFiles"
      @close-project-files="closeProjectFiles"
      @product-session-request-consumed="$emit('productSessionRequestConsumed', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AiPanel from '@/components/AiPanel.vue'
import type { ProductSessionUiRequest } from '@/components/productSessionUiTypes'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import { projectFilesClient } from '@/services/files/projectFilesClient'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  agentMode?: boolean
  productSessionRequest?: ProductSessionUiRequest | null
}>()
defineEmits<{
  productSessionRequestConsumed: [sequence: number]
}>()

const workspace = useWorkspaceStore()
const projectFilesAvailable = ref(false)
let availabilityGeneration = 0

const activeManagedAiSession = computed(() => {
  const panel = workspace.panels.find((item) => item.id === workspace.activePanelId)
  if (!panel) return null
  if (panel.kind === 'project-file' && panel.projectFile) {
    return workspace.managedAiSessions.find((session) =>
      session.source === panel.projectFile?.source &&
      session.id === panel.projectFile?.sessionId &&
      Boolean(session.terminalSessionId)
    ) || null
  }
  if (!isTerminalWorkspacePanel(panel) || !panel.sessionId) return null
  return workspace.managedAiSessions
    .filter((session) =>
      session.terminalSessionId === panel.sessionId &&
      session.sessionKind !== 'subagent' &&
      session.sessionKind !== 'internal'
    )
    .sort((first, second) => second.lastActivityAt - first.lastActivityAt)[0] || null
})

const activeSessionSignature = computed(() => {
  const session = activeManagedAiSession.value
  if (!session) return ''
  return [
    session.source,
    session.id,
    session.terminalSessionId || '',
    session.hibernatedTerminalSessionId || '',
    session.cwd || '',
    session.canonicalCwd || ''
  ].join(':')
})

const activeAvailabilityTrigger = computed(() => {
  const session = activeManagedAiSession.value
  if (!session) return ''
  return `${activeSessionSignature.value}:${session.lastActivityAt}`
})

const activeTerminalSessionId = computed(() => activeManagedAiSession.value?.terminalSessionId || '')
const projectFilesActive = computed(() =>
  projectFilesAvailable.value &&
  workspace.rightAssistantSurfaceForTerminal(activeTerminalSessionId.value) === 'files'
)

const refreshProjectFilesAvailability = async (contextSignature: string) => {
  const session = activeManagedAiSession.value
  const requestGeneration = ++availabilityGeneration
  if (!session) return
  const getContext = projectFilesClient.getContext()
  const logFields = {
    source: session.source,
    sessionId: session.id,
    terminalSessionId: session.terminalSessionId || '',
    generation: requestGeneration
  }
  if (!getContext) {
    writeRendererRuntimeLog('warn', 'renderer.project-files.context.bridge-missing', logFields)
    return
  }
  writeRendererRuntimeLog('debug', 'renderer.project-files.context.requested', logFields)
  try {
    const result = await getContext({ source: session.source, sessionId: session.id })
    if (requestGeneration !== availabilityGeneration || contextSignature !== activeSessionSignature.value) {
      writeRendererRuntimeLog('debug', 'renderer.project-files.context.stale', logFields)
      return
    }
    projectFilesAvailable.value = Boolean(result.ok && result.data)
    writeRendererRuntimeLog(
      projectFilesAvailable.value ? 'debug' : 'warn',
      projectFilesAvailable.value
        ? 'renderer.project-files.context.available'
        : 'renderer.project-files.context.unavailable',
      {
        ...logFields,
        ...(result.data?.projectRoot ? { projectRoot: result.data.projectRoot } : {}),
        ...(result.data?.capability ? { capability: result.data.capability } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {})
      }
    )
  } catch (error) {
    if (requestGeneration !== availabilityGeneration) return
    projectFilesAvailable.value = false
    writeRendererRuntimeLog('warn', 'renderer.project-files.context.failed', {
      ...logFields,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }
}

const toggleProjectFiles = () => {
  if (!projectFilesAvailable.value) return
  workspace.setRightAssistantSurfaceForTerminal(
    activeTerminalSessionId.value,
    projectFilesActive.value ? 'ai' : 'files'
  )
}

const closeProjectFiles = () => {
  workspace.setRightAssistantSurfaceForTerminal(activeTerminalSessionId.value, 'ai')
}

let checkedContextSignature = ''
watch(
  activeAvailabilityTrigger,
  () => {
    const contextSignature = activeSessionSignature.value
    if (!contextSignature) {
      availabilityGeneration += 1
      checkedContextSignature = ''
      projectFilesAvailable.value = false
      return
    }
    if (contextSignature !== checkedContextSignature) {
      availabilityGeneration += 1
      checkedContextSignature = contextSignature
      projectFilesAvailable.value = false
    } else if (projectFilesAvailable.value) {
      return
    }
    void refreshProjectFilesAvailability(contextSignature)
  },
  { immediate: true }
)

watch(
  () => props.productSessionRequest?.sequence,
  (sequence) => {
    if (sequence) closeProjectFiles()
  }
)
</script>
