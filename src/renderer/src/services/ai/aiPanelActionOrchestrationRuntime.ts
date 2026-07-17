import { computed, reactive, ref, toRef } from 'vue'
import {
  createAiPanelCommandActionRuntime,
  createEmptyAiPanelCommandActionRuntimeState,
  type AiPanelCommandActionLoopInput,
  type AiPanelCommandActionLoopResult,
  type AiPanelCommandActionTerminalPanel
} from '@/services/ai/aiPanelCommandActionRuntime'
import {
  createAiPanelMessageActionRuntime,
  type AiPanelMessageActionMessage
} from '@/services/ai/aiPanelMessageActionRuntime'
import type { AiPanelCommandSuggestionMessage } from '@/services/ai/aiPanelMessageRuntime'
import type { TerminalCommandSource, TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'
import type { ClineAgentApprovalInput, ClineAgentApprovalResult } from '@shared/contracts/clineAgent'

export type AiPanelActionOrchestrationMessage = AiPanelMessageActionMessage & AiPanelCommandSuggestionMessage

export type AiPanelActionOrchestrationRuntimeOptions<TMessage extends AiPanelActionOrchestrationMessage> = {
  messages: () => TMessage[]
  panels: () => AiPanelCommandActionTerminalPanel[]
  chatMode: () => string
  copyText: (text: string) => Promise<boolean>
  notify: (message: string) => void
  approveMcpToolCall: (id: string, options: { autoApprove?: boolean }) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  rejectMcpToolCall: (id: string) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  approveMcpResourceAccess: (id: string) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  rejectMcpResourceAccess: (id: string) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  toggleMessageFavorite: (id: string) => Promise<boolean>
  setMessageFeedback: (id: string, feedback: 'up' | 'down') => Promise<boolean>
  retryAssistantMessage: (id: string) => boolean
  summarizeMessageToKnowledge: (id: string) => Promise<{ relPath: string } | null>
  summarizeMessageToSkill: (id: string) => Promise<{ name: string } | null>
  runTerminalCommand?: (panelId: string, command: string, source: TerminalCommandSource) => Promise<TerminalSecurityDecision | null>
  continueAgentCommandLoop: (input: AiPanelCommandActionLoopInput) => Promise<AiPanelCommandActionLoopResult>
  enableAgentReadOnlyAutoRunForCurrentConversation: () => boolean
  syncCurrentConversationSnapshot: (options: { notifyFailure?: boolean; notifyUnavailable?: boolean }) => void | Promise<unknown>
  respondClineAgentApproval?: (input: ClineAgentApprovalInput) => Promise<ClineAgentApprovalResult>
  closePopups: () => void
  afterDomUpdate: () => void | Promise<void>
}

export const createAiPanelActionOrchestrationRuntime = <TMessage extends AiPanelActionOrchestrationMessage>(
  options: AiPanelActionOrchestrationRuntimeOptions<TMessage>
) => {
  const commandActionRuntimeState = reactive(createEmptyAiPanelCommandActionRuntimeState())
  const commandAuditTextareaRef = ref<HTMLTextAreaElement | null>(null)
  const commandAuditDialog = toRef(commandActionRuntimeState, 'commandAuditDialog')

  const aiPanelMessageActionRuntime = createAiPanelMessageActionRuntime({
    messages: options.messages,
    copyText: options.copyText,
    notify: options.notify,
    approveMcpToolCall: options.approveMcpToolCall,
    rejectMcpToolCall: options.rejectMcpToolCall,
    approveMcpResourceAccess: options.approveMcpResourceAccess,
    rejectMcpResourceAccess: options.rejectMcpResourceAccess,
    toggleMessageFavorite: options.toggleMessageFavorite,
    setMessageFeedback: options.setMessageFeedback,
    retryAssistantMessage: options.retryAssistantMessage,
    summarizeMessageToKnowledge: options.summarizeMessageToKnowledge,
    summarizeMessageToSkill: options.summarizeMessageToSkill,
    respondClineAgentApproval: options.respondClineAgentApproval,
    syncCurrentConversationSnapshot: options.syncCurrentConversationSnapshot
  })

  const aiPanelCommandActionRuntime = createAiPanelCommandActionRuntime({
    state: commandActionRuntimeState,
    messages: options.messages,
    panels: options.panels,
    chatMode: options.chatMode,
    copyText: options.copyText,
    notify: options.notify,
    runTerminalCommand: options.runTerminalCommand,
    continueAgentCommandLoop: options.continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation: options.enableAgentReadOnlyAutoRunForCurrentConversation,
    syncCurrentConversationSnapshot: options.syncCurrentConversationSnapshot,
    respondClineAgentApproval: options.respondClineAgentApproval
  })

  const activeCommandAuditMessage = computed(() => aiPanelCommandActionRuntime.activeCommandAuditMessage())
  const canEditActiveCommandAudit = computed(() => aiPanelCommandActionRuntime.canEditActiveCommandAudit())

  const openCommandAuditDialog = async (message: AiPanelCommandSuggestionMessage) => {
    const opened = aiPanelCommandActionRuntime.openCommandAuditDialog(message)
    options.closePopups()
    await options.afterDomUpdate()
    commandAuditTextareaRef.value?.focus()
    commandAuditTextareaRef.value?.select()
    return opened
  }

  return {
    activeCommandAuditMessage,
    approveMcpResourceAccess: aiPanelMessageActionRuntime.approveMcpResourceAccess,
    approveMcpToolCall: aiPanelMessageActionRuntime.approveMcpToolCall,
    canEditActiveCommandAudit,
    closeCommandAuditDialog: aiPanelCommandActionRuntime.closeCommandAuditDialog,
    commandAuditDialog,
    commandAuditTextareaRef,
    copyCommandAuditDraft: aiPanelCommandActionRuntime.copyCommandAuditDraft,
    copyCommandToClipboard: aiPanelCommandActionRuntime.copyCommandToClipboard,
    copyMessageToClipboard: aiPanelMessageActionRuntime.copyMessageToClipboard,
    copyRenderedTextToClipboard: aiPanelMessageActionRuntime.copyRenderedTextToClipboard,
    formatMcpToolArguments: aiPanelMessageActionRuntime.formatMcpToolArguments,
    openCommandAuditDialog,
    rejectMcpResourceAccess: aiPanelMessageActionRuntime.rejectMcpResourceAccess,
    rejectMcpToolCall: aiPanelMessageActionRuntime.rejectMcpToolCall,
    rejectMessageCommand: aiPanelCommandActionRuntime.rejectMessageCommand,
    retryAssistantMessage: aiPanelMessageActionRuntime.retryAssistantMessage,
    runCommandAuditDraft: aiPanelCommandActionRuntime.runCommandAuditDraft,
    runMessageCommand: aiPanelCommandActionRuntime.runMessageCommand,
    saveCommandAuditDraft: aiPanelCommandActionRuntime.saveCommandAuditDraft,
    setMessageFeedback: aiPanelMessageActionRuntime.setMessageFeedback,
    summarizeMessageToKnowledge: aiPanelMessageActionRuntime.summarizeMessageToKnowledge,
    summarizeMessageToSkill: aiPanelMessageActionRuntime.summarizeMessageToSkill,
    toggleMessageFavorite: aiPanelMessageActionRuntime.toggleMessageFavorite
  }
}
