import type { ChatMessage } from '@/services/ai/workspaceAiChatTypes'
import { aiChatStaleClineTaskMessage, type AiChatAgentTaskRef } from '@shared/contracts/aiChat'
import type { ClineAgentHostTarget, ClineAgentTaskEvent } from '@shared/contracts/clineAgent'

const cleanText = (value: unknown) => String(value || '').trim()
const hostInspectionToolNames = new Set(['read_host_file', 'search_host_files'])
const sensitiveToolNames = new Set([...hostInspectionToolNames, 'access_mcp_resource'])

const isClineToolCard = (message: Pick<ChatMessage, 'ask' | 'agentTask'>) => Boolean(
  message.ask === 'command' ||
  (
    message.agentTask?.toolCallId &&
    (message.ask === 'mcp_tool_call' || message.ask === 'mcp_resource_access')
  )
)

const activeTaskStatuses = new Set<AiChatAgentTaskRef['status']>([
  'starting',
  'running',
  'waiting-approval'
])

const terminalTaskStatuses = new Set<AiChatAgentTaskRef['status']>([
  'done',
  'error',
  'cancelled'
])

export const classicClineStaleTaskMessage = aiChatStaleClineTaskMessage

export const exactClassicApprovalHostTarget = (
  task: Pick<AiChatAgentTaskRef, 'targetId' | 'targetLabel' | 'terminalSessionId'>,
  targets: ClineAgentHostTarget[] | undefined
) => {
  const targetId = cleanText(task.targetId)
  const targetLabel = cleanText(task.targetLabel)
  const terminalSessionId = cleanText(task.terminalSessionId)
  if (!targetId || !targetLabel || !terminalSessionId) return null
  return targets?.find((target) =>
    target.targetId === targetId &&
    target.label === targetLabel &&
    target.terminalSessionId === terminalSessionId
  ) || null
}

export const isRestoredClassicClineTaskMessage = (
  message: Pick<ChatMessage, 'agentTask'> | null | undefined
) => message?.agentTask?.restored === true

export const isActiveClassicClineTaskMessage = (message: Pick<ChatMessage, 'agentTask'> | null | undefined) =>
  Boolean(message?.agentTask && activeTaskStatuses.has(message.agentTask.status))

export type ClassicClineActivity = 'idle' | 'processing' | 'waiting-approval'

/**
 * Approval must win over older command cards that remain in running state until
 * the whole Cline turn finishes. The composer uses this only for presentation;
 * the active-task predicate above still controls cancellation and input guards.
 */
export const classicClineActivityForMessages = (messages: Pick<ChatMessage, 'ask' | 'commandExecutionStatus' | 'agentTask' | 'state'>[]): ClassicClineActivity => {
  if (messages.some((message) =>
    message.agentTask?.status === 'waiting-approval' &&
    (
      (message.ask === 'command' && message.commandExecutionStatus === 'pending') ||
      message.ask === 'mcp_tool_call' ||
      message.ask === 'mcp_resource_access'
    )
  )) return 'waiting-approval'
  if (messages.some((message) =>
    message.state === 'streaming' || isActiveClassicClineTaskMessage(message)
  )) return 'processing'
  return 'idle'
}

const eventTask = (
  event: ClineAgentTaskEvent,
  status: AiChatAgentTaskRef['status'],
  tool?: {
    toolCallId?: string
    toolName?: string
    terminalSessionId?: string
    targetId?: string
    targetLabel?: string
  }
): AiChatAgentTaskRef => ({
  taskId: event.taskId,
  turnId: event.turnId,
  ...(cleanText(tool?.terminalSessionId) ? { terminalSessionId: cleanText(tool?.terminalSessionId) } : {}),
  ...(cleanText(tool?.targetId) ? { targetId: cleanText(tool?.targetId) } : {}),
  ...(cleanText(tool?.targetLabel) ? { targetLabel: cleanText(tool?.targetLabel) } : {}),
  ...(cleanText(tool?.toolCallId) ? { toolCallId: cleanText(tool?.toolCallId) } : {}),
  ...(cleanText(tool?.toolName) ? { toolName: cleanText(tool?.toolName) } : {}),
  status
})

const belongsToTurn = (
  message: ChatMessage,
  event: ClineAgentTaskEvent
): message is ChatMessage & { agentTask: AiChatAgentTaskRef } =>
  message.agentTask?.taskId === event.taskId && message.agentTask.turnId === event.turnId

const messageForTurn = (messages: ChatMessage[], event: ClineAgentTaskEvent) =>
  messages.find((message) => message.id === event.turnId) ||
  messages.find((message) => belongsToTurn(message, event))

const stateMessageForTurn = (messages: ChatMessage[], event: ClineAgentTaskEvent) =>
  messages.find((message) => message.id === event.turnId && !isClineToolCard(message)) ||
  messages.find((message) => belongsToTurn(message, event) && !isClineToolCard(message))

const commandMessageId = (event: ClineAgentTaskEvent, toolCallId: string) =>
  `${event.turnId}-cline-command-${toolCallId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)}`

const sensitiveToolMessageId = (event: ClineAgentTaskEvent, toolCallId: string) =>
  `${event.turnId}-cline-tool-${toolCallId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)}`

const commandMessageForTool = (messages: ChatMessage[], event: ClineAgentTaskEvent, toolCallId: string) => {
  const deterministicId = commandMessageId(event, toolCallId)
  return messages.find(
    (message) =>
      message.id === deterministicId &&
      belongsToTurn(message, event) &&
      message.agentTask.toolCallId === toolCallId &&
      message.ask === 'command'
  ) || messages.find(
    (message) =>
      belongsToTurn(message, event) &&
      message.agentTask.toolCallId === toolCallId &&
      message.ask === 'command'
  )
}

const sensitiveMessageForTool = (messages: ChatMessage[], event: ClineAgentTaskEvent, toolCallId: string) => {
  const deterministicId = sensitiveToolMessageId(event, toolCallId)
  return messages.find(
    (message) =>
      message.id === deterministicId &&
      belongsToTurn(message, event) &&
      message.agentTask.toolCallId === toolCallId &&
      isClineToolCard(message)
  ) || messages.find(
    (message) =>
      belongsToTurn(message, event) &&
      message.agentTask.toolCallId === toolCallId &&
      (message.ask === 'mcp_tool_call' || message.ask === 'mcp_resource_access')
  )
}

const resultMessageId = (event: ClineAgentTaskEvent, ordinal = 0) =>
  `${event.turnId}-cline-result${ordinal ? `-${ordinal}` : ''}`

const turnEntriesForEvent = (messages: ChatMessage[], event: ClineAgentTaskEvent) => messages
  .map((message, index) => ({ message, index }))
  .filter(({ message }) => message.id === event.turnId || belongsToTurn(message, event))

const isSyntheticAnswerRoot = (message: ChatMessage, event: ClineAgentTaskEvent) => {
  if (message.id !== event.turnId || isClineToolCard(message)) return false
  const text = cleanText(message.text)
  return !text || text === '正在请求...' || text.startsWith('正在请求 aiopsterm AI 后端')
}

/**
 * Keep assistant text and tool cards in the order in which Cline emitted
 * them. The synthetic root is only a correlation row: the first real text or
 * tool replaces it. Real text after a tool always gets a new result segment
 * at the end of the turn.
 */
const resultMessageForTurn = (messages: ChatMessage[], event: ClineAgentTaskEvent, create = true) => {
  const entries = turnEntriesForEvent(messages, event)
  const last = entries.at(-1)
  if (last && !isClineToolCard(last.message)) return last.message
  if (!create) return undefined

  let ordinal = 0
  while (messages.some((message) => message.id === resultMessageId(event, ordinal))) ordinal += 1
  const result: ChatMessage = {
    id: resultMessageId(event, ordinal),
    role: 'assistant',
    text: '',
    state: 'streaming',
    agentTask: eventTask(event, 'running')
  }
  messages.splice(last ? last.index + 1 : messages.length, 0, result)
  return result
}

const commandFromEventInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  return cleanText((input as Record<string, unknown>).command)
}

const commandTargetForEvent = (
  event: Extract<ClineAgentTaskEvent, { type: 'tool-call' | 'approval-requested' }>,
  fallback = ''
) => {
  return cleanText(event.targetLabel) || cleanText(event.targetId) || cleanText(fallback)
}

const insertCommandMessage = (messages: ChatMessage[], event: ClineAgentTaskEvent, message: ChatMessage) => {
  const turnIndexes = messages
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.id === event.turnId || belongsToTurn(item, event))
    .map(({ index }) => index)
  const previous = turnIndexes.length ? messages[turnIndexes.at(-1)!] : undefined
  if (previous && !isClineToolCard(previous) && previous.state === 'streaming') previous.state = 'done'
  const lastTurnIndex = turnIndexes.at(-1)
  messages.splice(lastTurnIndex === undefined ? messages.length : lastTurnIndex + 1, 0, message)
}

const commandTaskForEvent = (
  messages: ChatMessage[],
  event: Extract<ClineAgentTaskEvent, { type: 'tool-call' | 'approval-requested' }>,
  status: AiChatAgentTaskRef['status']
) => {
  const binding = messageForTurn(messages, event)?.agentTask
  return eventTask(event, status, {
    ...binding,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    ...('targetId' in event ? { targetId: event.targetId } : {}),
    ...('targetLabel' in event ? { targetLabel: event.targetLabel } : {}),
    ...('terminalSessionId' in event ? { terminalSessionId: event.terminalSessionId } : {})
  })
}

const applyHostCommandToolCall = (
  messages: ChatMessage[],
  event: Extract<ClineAgentTaskEvent, { type: 'tool-call' }>
) => {
  if (event.toolName !== 'run_host_command') return true
  const command = commandFromEventInput(event.input)
  if (!command) return true
  const existing = commandMessageForTool(messages, event, event.toolCallId)
  if (existing) {
    const status = existing.agentTask?.status || 'running'
    existing.agentTask = commandTaskForEvent(messages, event, status)
    return true
  }
  const message: ChatMessage = {
    id: commandMessageId(event, event.toolCallId),
    role: 'assistant',
    text: command,
    state: 'done',
    ask: 'command',
    commandExecutionStatus: 'running',
    commandExecutionMessage: 'Cline Agent 正在执行命令...',
    commandExecution: {
      ip: commandTargetForEvent(event),
      command,
      requiresApproval: false,
      interactive: false
    },
    agentTask: commandTaskForEvent(messages, event, 'running')
  }
  const root = messageForTurn(messages, event)
  if (root && isSyntheticAnswerRoot(root, event)) Object.assign(root, { ...message, id: root.id })
  else insertCommandMessage(messages, event, message)
  return true
}

const settleTurnMessages = (
  messages: ChatMessage[],
  event: ClineAgentTaskEvent,
  status: Extract<AiChatAgentTaskRef['status'], 'done' | 'error' | 'cancelled'>,
  commandMessage: string
) => {
  for (const message of messages) {
    if (!belongsToTurn(message, event)) continue
    message.agentTask = { ...message.agentTask, status }
    if (
      message.ask === 'command' &&
      (message.commandExecutionStatus === 'pending' || message.commandExecutionStatus === 'running')
    ) {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = commandMessage
    }
    if (
      (message.ask === 'mcp_tool_call' || message.ask === 'mcp_resource_access') &&
      sensitiveToolNames.has(message.agentTask.toolName || '') &&
      !message.action
    ) {
      message.action = 'rejected'
      message.commandExecutionMessage = commandMessage
    }
  }
}

const applyHostCommandApprovalRequest = (messages: ChatMessage[], event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>) => {
  if (event.toolName !== 'run_host_command') return false
  const command = commandFromEventInput(event.input)
  if (!command) return false
  const existing = commandMessageForTool(messages, event, event.toolCallId)
  const root = messageForTurn(messages, event)
  const message = existing || (root && isSyntheticAnswerRoot(root, event) ? root : undefined)
  const task = commandTaskForEvent(messages, event, 'waiting-approval')
  const next: ChatMessage = {
    id: message?.id || commandMessageId(event, event.toolCallId),
    role: 'assistant',
    text: command,
    state: 'done',
    ask: 'command',
    commandExecutionStatus: 'pending',
    commandExecutionMessage: event.reason || '等待操作员确认。',
    commandExecution: {
      ip: commandTargetForEvent(event, message?.commandExecution?.ip),
      command,
      requiresApproval: event.autoApprovable !== true,
      interactive: false
    },
    agentTask: task,
    action: undefined,
    executedCommand: undefined
  }
  if (message) Object.assign(message, next)
  else insertCommandMessage(messages, event, next)
  return true
}

const sensitiveApprovalSummary = (toolName: string, input: Record<string, unknown>) => {
  if (toolName === 'read_host_file') return cleanText(input.path)
  if (toolName === 'search_host_files') {
    return [cleanText(input.kind), cleanText(input.path), cleanText(input.pattern)].filter(Boolean).join(' ')
  }
  if (toolName === 'access_mcp_resource') return [cleanText(input.serverName), cleanText(input.uri)].filter(Boolean).join(' ')
  return ''
}

const applySensitiveApprovalRequest = (
  messages: ChatMessage[],
  event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>
) => {
  if (!sensitiveToolNames.has(event.toolName) || !event.input || typeof event.input !== 'object' || Array.isArray(event.input)) {
    return false
  }
  const input = event.input as Record<string, unknown>
  const summary = sensitiveApprovalSummary(event.toolName, input)
  if (!summary) return false
  const existing = sensitiveMessageForTool(messages, event, event.toolCallId)
  const root = messageForTurn(messages, event)
  const message = existing || (root && isSyntheticAnswerRoot(root, event) ? root : undefined)
  const task = commandTaskForEvent(messages, event, 'waiting-approval')
  let next: ChatMessage
  if (hostInspectionToolNames.has(event.toolName)) {
    if (!event.targetId || !event.targetLabel || !event.terminalSessionId) return false
    next = {
      id: message?.id || sensitiveToolMessageId(event, event.toolCallId),
      role: 'assistant',
      text: `${event.toolName}: ${summary}`,
      state: 'done',
      ask: 'mcp_tool_call',
      mcpToolCall: {
        serverName: event.targetLabel,
        toolName: event.toolName,
        arguments: Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'targetId'))
      },
      agentTask: task,
      action: undefined
    }
  } else {
    const serverName = cleanText(event.serverName || input.serverName)
    const uri = cleanText(event.resourceUri || input.uri)
    if (!serverName || !uri || serverName !== cleanText(input.serverName) || uri !== cleanText(input.uri)) return false
    next = {
      id: message?.id || sensitiveToolMessageId(event, event.toolCallId),
      role: 'assistant',
      text: `${event.toolName}: ${summary}`,
      state: 'done',
      ask: 'mcp_resource_access',
      mcpResourceAccess: { serverName, uri },
      agentTask: task,
      action: undefined
    }
  }
  if (message) Object.assign(message, next)
  else insertCommandMessage(messages, event, next)
  return true
}

const applyApprovalRequest = (messages: ChatMessage[], event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>) =>
  event.toolName === 'run_host_command'
    ? applyHostCommandApprovalRequest(messages, event)
    : applySensitiveApprovalRequest(messages, event)

export const applyClassicClineTaskEvent = (messages: ChatMessage[], event: ClineAgentTaskEvent) => {
  const root = messageForTurn(messages, event)
  if (!root) return false

  if (event.type === 'approval-requested') return applyApprovalRequest(messages, event)

  if (event.type === 'text-delta') {
    const message = resultMessageForTurn(messages, event)
    if (!message) return false
    message.text = typeof event.accumulated === 'string' ? event.accumulated : `${message.text}${event.text}`
    message.state = 'streaming'
    message.agentTask = eventTask(event, 'running', message.agentTask)
    return true
  }

  if (event.type === 'tool-result') {
    if (sensitiveToolNames.has(event.toolName)) {
      const message = sensitiveMessageForTool(messages, event, event.toolCallId)
      if (!message) return false
      if (event.error) {
        message.action = 'rejected'
        message.commandExecutionMessage = event.error
      } else {
        message.action ||= 'approved'
        message.commandExecutionMessage = message.action === 'rejected' ? '已拒绝读取。' : '读取完成，结果已回传。'
      }
      message.agentTask = eventTask(event, 'running', {
        ...message.agentTask,
        toolCallId: event.toolCallId,
        toolName: event.toolName
      })
      return true
    }
    if (event.toolName !== 'run_host_command') return true
    const message = commandMessageForTool(messages, event, event.toolCallId)
    if (!message) return false
    const rejected = message.action === 'rejected' || message.agentTask?.status === 'cancelled'
    if (!rejected) message.action = 'approved'
    message.commandExecutionStatus = rejected || event.error ? 'failed' : 'succeeded'
    message.commandExecutionMessage = rejected
      ? '已拒绝执行。'
      : event.error || '命令已由 Cline Agent 执行，结果已回传。'
    message.executedCommand = rejected || event.error ? undefined : message.commandExecution?.command
    const currentStatus = message.agentTask?.status
    const status = currentStatus && terminalTaskStatuses.has(currentStatus)
      ? currentStatus
      : event.error
        ? 'error'
        : 'running'
    message.agentTask = eventTask(event, status, {
      ...message.agentTask,
      toolCallId: event.toolCallId,
      toolName: event.toolName
    })
    return true
  }

  if (event.type === 'done') {
    settleTurnMessages(messages, event, 'done', 'Agent 任务已结束，但未收到该命令的执行结果。')
    if (!cleanText(event.text)) {
      const terminalMessage = resultMessageForTurn(messages, event, false) || (!isClineToolCard(root) ? root : undefined)
      if (terminalMessage) {
        terminalMessage.state = 'done'
        terminalMessage.agentTask = eventTask(event, 'done', terminalMessage.agentTask)
      }
      return true
    }
    const message = resultMessageForTurn(messages, event)
    if (!message) return false
    message.text = event.text
    message.state = 'done'
    message.agentTask = eventTask(event, 'done')
    return true
  }

  if (event.type === 'cancelled' || event.type === 'error') {
    const status = event.type === 'error' ? 'error' : 'cancelled'
    const reason = event.type === 'error'
      ? event.errorMessage
      : cleanText(event.reason) || 'Cline Agent 命令已停止。'
    settleTurnMessages(messages, event, status, reason)
    const message = resultMessageForTurn(messages, event) || root
    message.state = event.type === 'cancelled' ? 'cancelled' : 'error'
    message.text = event.type === 'error' ? event.errorMessage : cleanText(event.reason) || '已停止生成。'
    message.agentTask = eventTask(event, status)
    return true
  }

  if (event.type === 'status') {
    if (event.status === 'interrupted') {
      const reason = cleanText(event.message) || 'Cline Agent 任务已中断。'
      settleTurnMessages(messages, event, 'error', reason)
      const message = resultMessageForTurn(messages, event) || root
      message.state = 'error'
      message.text = reason
      message.agentTask = eventTask(event, 'error')
      return true
    }
    const status: AiChatAgentTaskRef['status'] =
      event.status === 'waiting-approval'
        ? 'waiting-approval'
        : event.status === 'idle'
            ? 'done'
            : event.status
    const message = stateMessageForTurn(messages, event)
    if (message) message.agentTask = { ...message.agentTask, ...eventTask(event, status) }
    return true
  }

  if (event.type === 'tool-call') {
    return applyHostCommandToolCall(messages, event)
  }

  return event.type === 'tool-update' || event.type === 'reasoning-delta' || event.type === 'usage'
}
