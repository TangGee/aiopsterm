import type { ChatMessage } from '@/services/ai/workspaceAiChatTypes'
import type { AiChatAgentTaskRef } from '@shared/contracts/aiChat'
import type { ClineAgentTaskEvent } from '@shared/contracts/clineAgent'

const cleanText = (value: unknown) => String(value || '').trim()

const activeTaskStatuses = new Set<AiChatAgentTaskRef['status']>([
  'starting',
  'running',
  'waiting-approval'
])

export const isActiveClassicClineTaskMessage = (message: Pick<ChatMessage, 'agentTask'> | null | undefined) =>
  Boolean(message?.agentTask && activeTaskStatuses.has(message.agentTask.status))

const eventTask = (
  event: ClineAgentTaskEvent,
  status: AiChatAgentTaskRef['status'],
  tool?: { toolCallId?: string; toolName?: string; terminalSessionId?: string }
): AiChatAgentTaskRef => ({
  taskId: event.taskId,
  turnId: event.turnId,
  ...(cleanText(tool?.terminalSessionId) ? { terminalSessionId: cleanText(tool?.terminalSessionId) } : {}),
  ...(cleanText(tool?.toolCallId) ? { toolCallId: cleanText(tool?.toolCallId) } : {}),
  ...(cleanText(tool?.toolName) ? { toolName: cleanText(tool?.toolName) } : {}),
  status
})

const messageForTurn = (messages: ChatMessage[], event: ClineAgentTaskEvent) =>
  messages.find((message) => message.id === event.turnId) ||
  messages.find((message) => message.agentTask?.taskId === event.taskId && message.agentTask.turnId === event.turnId)

const commandMessageForTool = (messages: ChatMessage[], event: ClineAgentTaskEvent, toolCallId: string) =>
  messages.find(
    (message) =>
      message.agentTask?.taskId === event.taskId &&
      message.agentTask.turnId === event.turnId &&
      message.agentTask.toolCallId === toolCallId &&
      message.ask === 'command'
  )

const resultMessageId = (event: ClineAgentTaskEvent) => `${event.turnId}-cline-result`

const resultMessageForTurn = (messages: ChatMessage[], event: ClineAgentTaskEvent, create = true) => {
  const root = messageForTurn(messages, event)
  if (root && root.ask !== 'command') return root
  const id = resultMessageId(event)
  let result = messages.find((message) => message.id === id)
  if (!result && create) {
    result = {
      id,
      role: 'assistant',
      text: '',
      state: 'streaming',
      agentTask: eventTask(event, 'running')
    }
    messages.push(result)
  }
  return result
}

const commandFromEventInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  return cleanText((input as Record<string, unknown>).command)
}

const approvalMessageId = (event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>) =>
  `${event.turnId}-cline-command-${event.toolCallId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)}`

const applyApprovalRequest = (messages: ChatMessage[], event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>) => {
  const command = commandFromEventInput(event.input)
  if (!command) return false
  const existing = commandMessageForTool(messages, event, event.toolCallId)
  const root = messageForTurn(messages, event)
  const message = existing || (root && root.ask !== 'command' ? root : undefined)
  const task = eventTask(event, 'waiting-approval', event)
  const next: ChatMessage = {
    id: message?.id || approvalMessageId(event),
    role: 'assistant',
    text: command,
    state: 'done',
    ask: 'command',
    commandExecutionStatus: 'pending',
    commandExecutionMessage: event.reason || '等待操作员确认。',
    commandExecution: {
      ip: 'current terminal',
      command,
      requiresApproval: true,
      interactive: false
    },
    agentTask: task
  }
  if (message) Object.assign(message, next)
  else messages.push(next)
  return true
}

export const applyClassicClineTaskEvent = (messages: ChatMessage[], event: ClineAgentTaskEvent) => {
  const root = messageForTurn(messages, event)
  if (!root) return false

  if (event.type === 'approval-requested') return applyApprovalRequest(messages, event)

  if (event.type === 'text-delta') {
    const message = resultMessageForTurn(messages, event)
    if (!message) return false
    message.text = typeof event.accumulated === 'string' ? event.accumulated : `${message.text}${event.text}`
    message.state = 'streaming'
    message.agentTask = eventTask(event, 'running')
    return true
  }

  if (event.type === 'tool-result') {
    if (event.toolName !== 'run_host_command') return true
    const message = commandMessageForTool(messages, event, event.toolCallId)
    if (!message) return false
    message.action = 'approved'
    message.commandExecutionStatus = event.error ? 'failed' : 'succeeded'
    message.commandExecutionMessage = event.error || '命令已由 Cline Agent 执行，结果已回传。'
    message.executedCommand = event.error ? undefined : message.commandExecution?.command
    message.agentTask = eventTask(event, event.error ? 'error' : 'running', {
      ...message.agentTask,
      toolCallId: event.toolCallId,
      toolName: event.toolName
    })
    return true
  }

  if (event.type === 'done') {
    for (const message of messages) {
      if (message.agentTask?.taskId === event.taskId && message.agentTask.turnId === event.turnId) {
        message.agentTask = { ...message.agentTask, status: 'done' }
      }
    }
    if (!cleanText(event.text)) {
      const existingResult = messages.find((message) => message.id === resultMessageId(event))
      if (existingResult) {
        existingResult.state = 'done'
        existingResult.agentTask = eventTask(event, 'done')
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
    const message = resultMessageForTurn(messages, event) || root
    message.state = event.type === 'cancelled' ? 'cancelled' : 'error'
    message.text = event.type === 'error' ? event.errorMessage : cleanText(event.reason) || '已停止生成。'
    message.agentTask = eventTask(event, event.type === 'error' ? 'error' : 'cancelled')
    return true
  }

  if (event.type === 'status') {
    const status: AiChatAgentTaskRef['status'] =
      event.status === 'waiting-approval'
        ? 'waiting-approval'
        : event.status === 'interrupted'
          ? 'error'
          : event.status === 'idle'
            ? 'done'
            : event.status
    root.agentTask = { ...root.agentTask, ...eventTask(event, status) }
    return true
  }

  if (event.type === 'tool-call') {
    root.agentTask = eventTask(event, 'running', {
      ...root.agentTask,
      toolCallId: event.toolCallId,
      toolName: event.toolName
    })
    return true
  }

  return event.type === 'tool-update' || event.type === 'reasoning-delta' || event.type === 'usage'
}
