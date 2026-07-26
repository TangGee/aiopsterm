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
      @close-project-files="projectFilesActive = false"
      @product-session-request-consumed="$emit('productSessionRequestConsumed', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AiPanel from '@/components/AiPanel.vue'
import type { ProductSessionUiRequest } from '@/components/productSessionUiTypes'
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
const projectFilesActive = ref(false)
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

const refreshProjectFilesAvailability = async () => {
  const session = activeManagedAiSession.value
  const requestGeneration = ++availabilityGeneration
  projectFilesAvailable.value = false
  if (!session) {
    projectFilesActive.value = false
    return
  }
  const getContext = projectFilesClient.getContext()
  if (!getContext) {
    projectFilesActive.value = false
    return
  }
  try {
    const result = await getContext({ source: session.source, sessionId: session.id })
    if (requestGeneration !== availabilityGeneration) return
    projectFilesAvailable.value = Boolean(result.ok && result.data)
    if (!projectFilesAvailable.value) projectFilesActive.value = false
  } catch {
    if (requestGeneration !== availabilityGeneration) return
    projectFilesAvailable.value = false
    projectFilesActive.value = false
  }
}

const toggleProjectFiles = () => {
  if (!projectFilesAvailable.value) return
  projectFilesActive.value = !projectFilesActive.value
}

watch(activeSessionSignature, () => void refreshProjectFilesAvailability(), { immediate: true })

watch(
  () => props.productSessionRequest?.sequence,
  (sequence) => {
    if (sequence) projectFilesActive.value = false
  }
)
</script>
