<template>
  <aside
    class="ai-panel"
    :class="[
      {
        'agent-mode': agentMode,
        'project-files-active': projectFilesActive
      },
      `mode-${aiPanelMode}`
    ]"
    tabindex="-1"
    @click="closePopups()"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
    @keydown="handlePresentationKeydown"
  >
    <div class="ai-panel-top">
      <AiPanelHeader
        :project-files-available="projectFilesAvailable"
        :project-files-active="projectFilesActive"
        @toggle-project-files="$emit('toggleProjectFiles')"
        @activate-ai-surface="$emit('closeProjectFiles')"
      />
    </div>

    <AiPanelCodexShell v-show="!projectFilesActive" />

    <AiPanelClassicConversation v-show="!projectFilesActive" />

    <span
      v-if="!projectFilesActive && aiPanelMode === 'classic' && chatExportNotice"
      class="ai-operation-notice"
      data-testid="ai-chat-export-notice"
    >
      {{ chatExportNotice }}
    </span>

    <AiPanelClassicComposer v-show="!projectFilesActive" />

    <AiPanelCommandAuditDialog />

    <Transition name="project-files-drawer">
      <ProjectFilesPanel
        v-if="projectFilesActive"
        class="project-files-drawer"
        :session="projectFilesSession"
        @close="$emit('closeProjectFiles')"
      />
    </Transition>
  </aside>
</template>

<script setup lang="ts">
import AiPanelClassicComposer from '@/components/ai/AiPanelClassicComposer.vue'
import AiPanelClassicConversation from '@/components/ai/AiPanelClassicConversation.vue'
import AiPanelCodexShell from '@/components/ai/AiPanelCodexShell.vue'
import AiPanelCommandAuditDialog from '@/components/ai/AiPanelCommandAuditDialog.vue'
import AiPanelHeader from '@/components/ai/AiPanelHeader.vue'
import ProjectFilesPanel from '@/components/files/ProjectFilesPanel.vue'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'
import type { ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'

const props = defineProps<{
  projectFilesAvailable?: boolean
  projectFilesActive?: boolean
  projectFilesSession?: ManagedAiSessionRecord | null
}>()
const emit = defineEmits<{
  toggleProjectFiles: []
  closeProjectFiles: []
}>()

const {
  agentMode,
  aiPanelMode,
  chatExportNotice,
  closePopups,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handlePanelKeydown
} = useAiPanelRuntimeContext()

const handlePresentationKeydown = (event: KeyboardEvent) => {
  if (props.projectFilesActive && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('closeProjectFiles')
    return
  }
  handlePanelKeydown(event)
}
</script>
