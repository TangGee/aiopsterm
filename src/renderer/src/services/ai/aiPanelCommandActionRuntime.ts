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
import type { TerminalCommandSource, TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import type { ClineAgentApprovalInput, ClineAgentApprovalResult } from '@shared/contracts/clineAgent'

export type AiPanelCommandActionTerminalPanel = {
  id: string
  kind?: string
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
  activePanel: () => AiPanelCommandActionTerminalPanel | null | undefined
  panels: () => AiPanelCommandActionTerminalPanel[]
  chatMode: () => string
  copyText: (text: string) => Promise<boolean>
  notify: (message: string) => void
  runActiveTerminalCommand: (command: string, source: TerminalCommandSource) => Promise<TerminalSecurityDecision | null>
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
  commandTerminalUnavailable: () => '终端会话不可用，请先打开本地 shell 或连接 SSH。',
  commandNeedsApproval: () => '命令已送入终端安全确认。',
  commandBlocked: () => '命令被安全策略拦截。',
  commandSending: () => '正在发送到当前终端...',
  readOnlyCommandSending: () => '查询类命令正在发送到当前终端...',
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
  activePanel: AiPanelCommandActionTerminalPanel | null | undefined,
  panels: AiPanelCommandActionTerminalPanel[]
) => (isTerminalWorkspacePanel(activePanel) ? activePanel : panels.find((panel) => isTerminalWorkspacePanel(panel)))

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
      !task.terminalSessionId?.trim()
    ) return null
    return {
      ...task,
      toolCallId: task.toolCallId,
      terminalSessionId: task.terminalSessionId
    }
  }

  const respondToClineApproval = async (message: AiPanelCommandSuggestionMessage, approved: boolean) => {
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
        terminalSessionId: task.terminalSessionId,
        approved,
        reason: approved ? undefined : 'The operator rejected the host command.'
      })
    } catch {
      result = { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_FAILED', errorMessage: 'Cline Agent 审批服务不可用。' }
    }
    if (!result.ok) {
      message.commandExecutionStatus = previousStatus
      message.commandExecutionMessage = result.errorMessage || previousMessage || 'Cline Agent 审批失败。'
      persistCommandExecutionState()
      options.notify(message.commandExecutionMessage)
      return false
    }
    message.action = approved ? 'approved' : 'rejected'
    message.agentTask = { ...task, status: approved ? 'running' : 'cancelled' }
    message.commandExecutionStatus = approved ? 'running' : 'failed'
    message.commandExecutionMessage = approved ? 'Cline Agent 正在执行命令...' : '已拒绝执行。'
    persistCommandExecutionState()
    options.notify(approved ? '命令已批准，Cline Agent 正在继续分析。' : labels.commandRejected())
    return result.data
  }

  const rejectMessageCommand = (message: AiPanelCommandSuggestionMessage) => {
    if (message.commandExecutionStatus === 'running') return false
    if (pendingClineApproval(message)) return respondToClineApproval(message, false)
    message.action = 'rejected'
    message.commandExecutionMessage = '已拒绝执行。'
    persistCommandExecutionState()
    options.notify(labels.commandRejected())
    return true
  }

  const runMessageCommand = async (message: AiPanelCommandSuggestionMessage, input: { autoReadOnly?: boolean } = {}) => {
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

    if (pendingClineApproval(message)) return respondToClineApproval(message, true)

    const terminalPanel = resolveAiPanelCommandActionTerminalPanel(options.activePanel(), options.panels())
    const outputStartLength = terminalPanel?.output.length ?? 0
    const terminalPanelId = terminalPanel?.id || ''
    const sessionAutoRunEnabled = enableSessionReadOnlyAutoRun(message, input)
    setAiPanelCommandExecutionState(message, 'running', input.autoReadOnly ? labels.readOnlyCommandSending() : labels.commandSending())

    const decision = await options.runActiveTerminalCommand(command, 'agent')
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
    options.notify(aiPanelCommandLoopResultReason(loopResult) || labels.commandTerminalUnavailable())
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
