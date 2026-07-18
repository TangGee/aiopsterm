import {
  applyCommandTextToMessage,
  canEditCommandMessage,
  commandHostForMessage,
  commandTextForMessage,
  isAiPanelCommandSuggestionMessage,
  isReadOnlyCommandMessage,
  setAiPanelCommandExecutionState,
  type AiPanelCommandSuggestionMessage
} from '@/services/ai/aiPanelMessageRuntime'
import {
  classicClineStaleTaskMessage,
  isRestoredClassicClineTaskMessage
} from '@/services/ai/classicClineTaskRuntime'
import type { TerminalCommandSource, TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import type {
  ClineAgentApprovalInput,
  ClineAgentApprovalResult,
  ClineAgentHostTarget
} from '@shared/contracts/clineAgent'

export type AiPanelCommandActionTerminalPanel = {
  id: string
  kind?: string
  sessionId?: string | null
  classicTarget?: ClineAgentHostTarget
  output: string
}

export type AiPanelCommandAuditDialogState = {
  open: boolean
  messageId: string
  draft: string
}

export type AiPanelCommandActionRuntimeState = {
  commandAuditDialog: AiPanelCommandAuditDialogState
}

export type AiPanelCommandActionLabels = {
  commandCopyEmpty: () => string
  commandCopied: () => string
  commandCopyFailed: () => string
  commandUpdated: () => string
  clineApprovalCommandImmutable: () => string
  commandRejected: () => string
  commandRejectedCannotRun: () => string
  commandRunEmpty: () => string
  commandTerminalUnavailable: () => string
  commandNeedsApproval: () => string
  commandBlocked: () => string
  commandSending: () => string
  readOnlyCommandSending: () => string
  commandSent: (command: string) => string
  readOnlyCommandSent: (command: string) => string
  commandWrittenNotice: () => string
  readOnlyCommandWrittenNotice: () => string
  commandWaitingOutput: () => string
  commandOutputReturned: (command: string) => string
  commandOutputReturnedNotice: () => string
  readOnlyAutoRunOutputReturnedNotice: () => string
}

export type AiPanelCommandActionLoopInput = {
  commandMessageId: string
  command: string
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  terminalPanelId: string
  outputStartLength: number
}

export type AiPanelCommandActionLoopResult =
  | {
      status: 'continued'
      output?: string
      assistantMessageId?: string
      requestId?: string
    }
  | {
      status: string
      reason?: string
    }

const aiPanelCommandLoopResultReason = (result: AiPanelCommandActionLoopResult) =>
  'reason' in result ? result.reason : undefined

export type AiPanelCommandActionRuntimeOptions = {
  state: AiPanelCommandActionRuntimeState
  messages: () => AiPanelCommandSuggestionMessage[]
  panels: () => AiPanelCommandActionTerminalPanel[]
  chatMode: () => string
  copyText: (text: string) => Promise<boolean>
  notify: (message: string) => void
  runTerminalCommand?: (panelId: string, command: string, source: TerminalCommandSource) => Promise<TerminalSecurityDecision | null>
  continueAgentCommandLoop: (input: AiPanelCommandActionLoopInput) => Promise<AiPanelCommandActionLoopResult>
  enableAgentReadOnlyAutoRunForCurrentConversation: () => boolean
  syncCurrentConversationSnapshot: (options: { notifyFailure?: boolean; notifyUnavailable?: boolean }) => void | Promise<unknown>
  respondClineAgentApproval?: (input: ClineAgentApprovalInput) => Promise<ClineAgentApprovalResult>
  labels?: Partial<AiPanelCommandActionLabels>
}

const defaultCommandAuditDialog = (): AiPanelCommandAuditDialogState => ({
  open: false,
  messageId: '',
  draft: ''
})

export const createEmptyAiPanelCommandActionRuntimeState = (): AiPanelCommandActionRuntimeState => ({
  commandAuditDialog: defaultCommandAuditDialog()
})

const defaultLabels: AiPanelCommandActionLabels = {
  commandCopyEmpty: () => '没有可复制的命令。',
  commandCopied: () => '命令已复制。',
  commandCopyFailed: () => '复制失败。',
  commandUpdated: () => '命令已更新。',
  clineApprovalCommandImmutable: () => '待审批的 Agent 命令必须原样确认或拒绝。',
  commandRejected: () => '命令已拒绝。',
  commandRejectedCannotRun: () => '命令已拒绝，无法执行。',
  commandRunEmpty: () => '没有可运行的命令。',
  commandTerminalUnavailable: () => '目标终端会话不可用，请重新连接对应主机。',
  commandNeedsApproval: () => '命令已送入终端安全确认。',
  commandBlocked: () => '命令被安全策略拦截。',
  commandSending: () => '正在发送到目标终端...',
  readOnlyCommandSending: () => '查询类命令正在发送到目标终端...',
  commandSent: (command) => `已发送到终端：${command}`,
  readOnlyCommandSent: (command) => `查询类命令已发送到终端：${command}`,
  commandWrittenNotice: () => '命令已写入终端输入区。',
  readOnlyCommandWrittenNotice: () => '查询类命令已写入终端输入区。',
  commandWaitingOutput: () => '命令已发送，正在等待终端输出...',
  commandOutputReturned: (command) => `命令输出已回传 Agent：${command}`,
  commandOutputReturnedNotice: () => '命令输出已回传 Agent，正在继续分析。',
  readOnlyAutoRunOutputReturnedNotice: () => '已开启本会话查询类自动执行，并继续分析。'
}

export const resolveAiPanelCommandActionTerminalPanel = (
  panels: AiPanelCommandActionTerminalPanel[],
  binding?: Pick<NonNullable<AiPanelCommandSuggestionMessage['agentTask']>, 'targetId' | 'targetLabel' | 'terminalSessionId'>
) => {
  const targetId = binding?.targetId?.trim() || ''
  const targetLabel = binding?.targetLabel?.trim() || ''
  const terminalSessionId = binding?.terminalSessionId?.trim() || ''
  if (!targetId || !targetLabel || !terminalSessionId) return null
  return panels.find((panel) =>
    isTerminalWorkspacePanel(panel) &&
    panel.sessionId?.trim() === terminalSessionId &&
    panel.classicTarget?.targetId.trim() === targetId &&
    panel.classicTarget.label.trim() === targetLabel &&
    panel.classicTarget.terminalSessionId.trim() === terminalSessionId
  ) || null
}

export const createAiPanelCommandActionRuntime = (options: AiPanelCommandActionRuntimeOptions) => {
  const labels = { ...defaultLabels, ...options.labels }

  const persistCommandExecutionState = () => {
    void options.syncCurrentConversationSnapshot({ notifyFailure: true, notifyUnavailable: true })
  }

  const activeCommandAuditMessage = () => {
    const dialog = options.state.commandAuditDialog
    if (!dialog.open || !dialog.messageId) return null
    const message = options.messages().find((item) => item.id === dialog.messageId)
    return message && isAiPanelCommandSuggestionMessage(message) ? message : null
  }

  const canEditActiveCommandAudit = () => {
    const message = activeCommandAuditMessage()
    return !pendingClineApproval(message) && canEditCommandMessage(message)
  }

  const copyCommandToClipboard = async (message: AiPanelCommandSuggestionMessage) => {
    const command = commandTextForMessage(message).trim()
    if (!command) {
      options.notify(labels.commandCopyEmpty())
      return false
    }
    const copied = await options.copyText(command)
    options.notify(copied ? labels.commandCopied() : labels.commandCopyFailed())
    return copied
  }

  const closeCommandAuditDialog = () => {
    options.state.commandAuditDialog = defaultCommandAuditDialog()
  }

  const openCommandAuditDialog = (message: AiPanelCommandSuggestionMessage) => {
    options.state.commandAuditDialog = {
      open: true,
      messageId: message.id,
      draft: commandTextForMessage(message)
    }
    return true
  }

  const saveCommandAuditDraft = (input: { silent?: boolean } = {}) => {
    const message = activeCommandAuditMessage()
    if (!message) return false
    if (isRestoredClassicClineTaskMessage(message)) {
      options.notify(classicClineStaleTaskMessage)
      return false
    }
    if (pendingClineApproval(message)) {
      options.notify(labels.clineApprovalCommandImmutable())
      return false
    }
    const saved = applyCommandTextToMessage(message, options.state.commandAuditDialog.draft)
    if (!saved) {
      options.notify(labels.commandRunEmpty())
      return false
    }
    options.state.commandAuditDialog.draft = commandTextForMessage(message)
    persistCommandExecutionState()
    if (!input.silent) options.notify(labels.commandUpdated())
    return true
  }

  const copyCommandAuditDraft = async () => {
    const command = options.state.commandAuditDialog.draft.trim()
    if (!command) {
      options.notify(labels.commandCopyEmpty())
      return false
    }
    const copied = await options.copyText(command)
    options.notify(copied ? labels.commandCopied() : labels.commandCopyFailed())
    return copied
  }

  const enableSessionReadOnlyAutoRun = (message: AiPanelCommandSuggestionMessage, input: { autoReadOnly?: boolean }) => {
    if (!input.autoReadOnly || options.chatMode() !== 'agent' || !isReadOnlyCommandMessage(message)) return false
    return options.enableAgentReadOnlyAutoRunForCurrentConversation()
  }

  const pendingClineApproval = (message: AiPanelCommandSuggestionMessage | null | undefined) => {
    const task = message?.agentTask
    if (
      task?.status !== 'waiting-approval' ||
      !task.taskId.trim() ||
      !task.turnId.trim() ||
      !task.toolCallId?.trim() ||
      !task.toolName?.trim() ||
      !task.targetId?.trim() ||
      !task.targetLabel?.trim() ||
      !task.terminalSessionId?.trim()
    ) return null
    return {
      ...task,
      toolCallId: task.toolCallId,
      toolName: task.toolName,
      targetId: task.targetId,
      targetLabel: task.targetLabel,
      terminalSessionId: task.terminalSessionId
    }
  }

  const currentClineApprovalMessage = (
    messageId: string,
    task: Pick<NonNullable<AiPanelCommandSuggestionMessage['agentTask']>, 'taskId' | 'turnId' | 'toolCallId'>
  ) => options.messages().find((message) =>
    message.id === messageId &&
    message.agentTask?.taskId === task.taskId &&
    message.agentTask.turnId === task.turnId &&
    message.agentTask.toolCallId === task.toolCallId
  )

  const respondToClineApproval = async (
    message: AiPanelCommandSuggestionMessage,
    approved: boolean,
    input: { enableReadOnlyAutoRun?: boolean } = {}
  ) => {
    const task = pendingClineApproval(message)
    if (!task || !options.respondClineAgentApproval) return false
    const previousStatus = message.commandExecutionStatus
    const previousMessage = message.commandExecutionMessage
    message.commandExecutionStatus = 'running'
    message.commandExecutionMessage = approved ? 'Cline Agent 正在执行命令...' : '正在拒绝 Cline Agent 命令...'
    persistCommandExecutionState()
    let result: ClineAgentApprovalResult
    try {
      result = await options.respondClineAgentApproval({
        taskId: task.taskId,
        turnId: task.turnId,
        toolCallId: task.toolCallId,
        toolName: task.toolName,
        targetId: task.targetId,
        targetLabel: task.targetLabel,
        terminalSessionId: task.terminalSessionId,
        approved,
        ...(input.enableReadOnlyAutoRun ? { enableReadOnlyAutoRun: true } : {}),
        reason: approved ? undefined : 'The operator rejected the host command.'
      })
    } catch {
      result = { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_FAILED', errorMessage: 'Cline Agent 审批服务不可用。' }
    }
    if (!result.ok) {
      const currentMessage = currentClineApprovalMessage(message.id, task)
      if (result.errorCode === 'CLINE_AGENT_APPROVAL_NOT_FOUND') {
        // The approval promise is process-local and cannot be reconstructed
        // from a restored transcript. Do not put the card back into pending;
        // make it a terminal, display-only record instead.
        const staleMessage = currentMessage || message
        const currentTaskStatus = staleMessage.agentTask?.status
        const alreadyTerminal = currentTaskStatus === 'done' || currentTaskStatus === 'cancelled' || currentTaskStatus === 'error'
        if (!alreadyTerminal) {
          staleMessage.agentTask = {
            ...staleMessage.agentTask!,
            status: 'cancelled',
            restored: true
          }
          if (staleMessage.ask === 'command' &&
            (staleMessage.commandExecutionStatus === 'pending' || staleMessage.commandExecutionStatus === 'running')) {
            staleMessage.commandExecutionStatus = 'failed'
            staleMessage.commandExecutionMessage = classicClineStaleTaskMessage
          }
          persistCommandExecutionState()
        }
        options.notify(staleMessage.commandExecutionMessage || classicClineStaleTaskMessage)
        return false
      }
      if (currentMessage?.agentTask?.status === 'waiting-approval' && currentMessage.commandExecutionStatus === 'running') {
        currentMessage.commandExecutionStatus = previousStatus
        currentMessage.commandExecutionMessage = result.errorMessage || previousMessage || 'Cline Agent 审批失败。'
        persistCommandExecutionState()
      }
      options.notify(result.errorMessage || previousMessage || 'Cline Agent 审批失败。')
      return false
    }
    const currentMessage = currentClineApprovalMessage(message.id, task)
    const currentTaskStatus = currentMessage?.agentTask?.status
    if (
      currentMessage?.commandExecutionStatus === 'running' &&
      (currentTaskStatus === 'starting' || currentTaskStatus === 'running' || currentTaskStatus === 'waiting-approval')
    ) {
      currentMessage.action = approved ? 'approved' : 'rejected'
      currentMessage.agentTask = { ...task, status: approved ? 'running' : 'cancelled' }
      currentMessage.commandExecutionStatus = approved ? 'running' : 'failed'
      currentMessage.commandExecutionMessage = approved ? 'Cline Agent 正在执行命令...' : '已拒绝执行。'
      persistCommandExecutionState()
    }
    options.notify(
      approved
        ? result.data?.readOnlyAutoRunEnabled
          ? labels.readOnlyAutoRunOutputReturnedNotice()
          : '命令已批准，Cline Agent 正在继续分析。'
        : labels.commandRejected()
    )
    return result.data
  }

  const rejectMessageCommand = (message: AiPanelCommandSuggestionMessage) => {
    if (isRestoredClassicClineTaskMessage(message)) {
      options.notify(classicClineStaleTaskMessage)
      return false
    }
    if (message.commandExecutionStatus === 'running') return false
    if (pendingClineApproval(message)) return respondToClineApproval(message, false)
    message.action = 'rejected'
    message.commandExecutionMessage = '已拒绝执行。'
    persistCommandExecutionState()
    options.notify(labels.commandRejected())
    return true
  }

  const runMessageCommand = async (message: AiPanelCommandSuggestionMessage, input: { autoReadOnly?: boolean } = {}) => {
    if (isRestoredClassicClineTaskMessage(message)) {
      options.notify(classicClineStaleTaskMessage)
      return false
    }
    if (message.commandExecutionStatus === 'running') return false
    if (message.action === 'rejected') {
      options.notify(labels.commandRejectedCannotRun())
      return false
    }
    const command = commandTextForMessage(message)
    if (!command) {
      setAiPanelCommandExecutionState(message, 'failed', labels.commandRunEmpty())
      persistCommandExecutionState()
      options.notify(labels.commandRunEmpty())
      return false
    }

    if (pendingClineApproval(message)) {
      const enableReadOnlyAutoRun = input.autoReadOnly === true &&
        options.chatMode() === 'agent' &&
        isReadOnlyCommandMessage(message)
      return respondToClineApproval(message, true, { enableReadOnlyAutoRun })
    }

    const terminalPanel = resolveAiPanelCommandActionTerminalPanel(options.panels(), message.agentTask)
    const outputStartLength = terminalPanel?.output.length ?? 0
    const terminalPanelId = terminalPanel?.id || ''
    const sessionAutoRunEnabled = enableSessionReadOnlyAutoRun(message, input)
    setAiPanelCommandExecutionState(message, 'running', input.autoReadOnly ? labels.readOnlyCommandSending() : labels.commandSending())

    const decision = terminalPanel
      ? await options.runTerminalCommand?.(terminalPanel.id, command, 'agent') ?? null
      : null
    if (!decision) {
      setAiPanelCommandExecutionState(message, 'failed', labels.commandTerminalUnavailable())
      persistCommandExecutionState()
      options.notify(labels.commandTerminalUnavailable())
      return false
    }
    if (decision.status === 'needs-approval') {
      setAiPanelCommandExecutionState(message, 'pending', labels.commandNeedsApproval())
      persistCommandExecutionState()
      options.notify(labels.commandNeedsApproval())
      return decision
    }
    if (decision.status === 'blocked') {
      setAiPanelCommandExecutionState(message, 'failed', labels.commandBlocked())
      persistCommandExecutionState()
      options.notify(labels.commandBlocked())
      return decision
    }
    if (decision.status === 'unavailable') {
      setAiPanelCommandExecutionState(message, 'failed', decision.reason)
      persistCommandExecutionState()
      options.notify(decision.reason)
      return decision
    }

    setAiPanelCommandExecutionState(
      message,
      'succeeded',
      input.autoReadOnly ? labels.readOnlyCommandSent(command) : labels.commandSent(command),
      command
    )
    persistCommandExecutionState()

    if (options.chatMode() !== 'agent' || message.ask !== 'command') {
      options.notify(input.autoReadOnly ? labels.readOnlyCommandWrittenNotice() : labels.commandWrittenNotice())
      return decision
    }
    if (!terminalPanelId) {
      setAiPanelCommandExecutionState(message, 'failed', labels.commandTerminalUnavailable())
      persistCommandExecutionState()
      options.notify(labels.commandTerminalUnavailable())
      return false
    }

    setAiPanelCommandExecutionState(message, 'running', labels.commandWaitingOutput())
    persistCommandExecutionState()
    const loopResult = await options.continueAgentCommandLoop({
      commandMessageId: message.id,
      command,
      commandExecution: message.commandExecution
        ? {
            ip: message.commandExecution.ip || commandHostForMessage(message).replace(/^Host\s+/, '') || '127.0.0.1',
            command,
            requiresApproval: message.commandExecution.requiresApproval === true,
            interactive: message.commandExecution.interactive === true
          }
        : undefined,
      terminalPanelId,
      outputStartLength
    })
    if (loopResult.status === 'continued') {
      setAiPanelCommandExecutionState(message, 'succeeded', labels.commandOutputReturned(command), command)
      persistCommandExecutionState()
      options.notify(sessionAutoRunEnabled ? labels.readOnlyAutoRunOutputReturnedNotice() : labels.commandOutputReturnedNotice())
      return loopResult
    }
    const failureMessage = aiPanelCommandLoopResultReason(loopResult) || labels.commandTerminalUnavailable()
    setAiPanelCommandExecutionState(message, 'failed', failureMessage, command)
    persistCommandExecutionState()
    options.notify(failureMessage)
    return loopResult
  }

  const runCommandAuditDraft = async () => {
    const message = activeCommandAuditMessage()
    if (!message) return false
    if (!saveCommandAuditDraft({ silent: true })) return false
    closeCommandAuditDialog()
    return runMessageCommand(message)
  }

  return {
    activeCommandAuditMessage,
    canEditActiveCommandAudit,
    closeCommandAuditDialog,
    copyCommandAuditDraft,
    copyCommandToClipboard,
    openCommandAuditDialog,
    persistCommandExecutionState,
    rejectMessageCommand,
    runCommandAuditDraft,
    runMessageCommand,
    saveCommandAuditDraft
  }
}
