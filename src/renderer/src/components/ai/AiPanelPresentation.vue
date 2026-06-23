<template>
  <aside
    class="ai-panel"
    :class="{ 'agent-mode': agentMode }"
    tabindex="-1"
    @click="closePopups()"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
    @keydown="handlePanelKeydown"
  >
    <div class="ai-panel-top">
      <AiPanelHeader />
    </div>

    <AiPanelCodexShell />

    <AiPanelClassicConversation />

    <span
      v-if="aiPanelMode === 'classic' && chatExportNotice"
      class="ai-operation-notice"
      data-testid="ai-chat-export-notice"
    >
      {{ chatExportNotice }}
    </span>

    <AiPanelClassicComposer />

    <AiPanelCommandAuditDialog />
  </aside>
</template>

<script setup lang="ts">
import AiPanelClassicComposer from '@/components/ai/AiPanelClassicComposer.vue'
import AiPanelClassicConversation from '@/components/ai/AiPanelClassicConversation.vue'
import AiPanelCodexShell from '@/components/ai/AiPanelCodexShell.vue'
import AiPanelCommandAuditDialog from '@/components/ai/AiPanelCommandAuditDialog.vue'
import AiPanelHeader from '@/components/ai/AiPanelHeader.vue'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'

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
</script>
