<template>
  <div
    v-if="commandAuditDialog.open && activeCommandAuditMessage"
    class="ai-command-audit-backdrop"
    data-testid="ai-command-audit-dialog"
    @keydown.esc.prevent="closeCommandAuditDialog"
  >
    <section
      class="ai-command-audit-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('ai.commandReviewTitle')"
      @click.stop
    >
      <header>
        <div>
          <span>{{ t('ai.commandReview') }}</span>
          <strong>{{ t('ai.commandReviewTitle') }}</strong>
        </div>
        <button
          type="button"
          :title="t('common.close')"
          data-testid="ai-command-audit-close"
          @click="closeCommandAuditDialog"
        >
          <X />
        </button>
      </header>
      <p>{{ t('ai.commandReviewDescription') }}</p>
      <label>
        <span>Command</span>
        <textarea
          ref="commandAuditTextareaRef"
          v-model="commandAuditDialog.draft"
          data-testid="ai-command-audit-input"
          spellcheck="false"
          :readonly="!canEditActiveCommandAudit"
          @keydown.stop
        ></textarea>
      </label>
      <footer>
        <span data-testid="ai-command-audit-line-count">
          {{ commandLineCountForText(commandAuditDialog.draft) }} line{{ commandLineCountForText(commandAuditDialog.draft) === 1 ? '' : 's' }}
        </span>
        <button
          type="button"
          data-testid="ai-command-audit-copy"
          @click="copyCommandAuditDraft"
        >
          <Copy />
          <span>{{ t('ai.commandReviewCopy') }}</span>
        </button>
        <button
          type="button"
          data-testid="ai-command-audit-save"
          :disabled="!canEditActiveCommandAudit || !commandAuditDialog.draft.trim()"
          @click="saveCommandAuditDraft()"
        >
          <Check />
          <span>{{ t('ai.commandReviewSave') }}</span>
        </button>
        <button
          type="button"
          class="primary"
          data-testid="ai-command-audit-run"
          :disabled="!canEditActiveCommandAudit || !commandAuditDialog.draft.trim()"
          @click="void runCommandAuditDraft()"
        >
          <Play />
          <span>{{ t('ai.commandReviewRun') }}</span>
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  Copy,
  Play,
  X
} from 'lucide-vue-next'
import { useAiPanelRuntimeContext } from '@/services/ai/aiPanelContext'

const {
  activeCommandAuditMessage,
  canEditActiveCommandAudit,
  closeCommandAuditDialog,
  commandAuditDialog,
  commandAuditTextareaRef,
  commandLineCountForText,
  copyCommandAuditDraft,
  runCommandAuditDraft,
  saveCommandAuditDraft,
  t
} = useAiPanelRuntimeContext()
</script>
