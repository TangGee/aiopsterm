import { randomUUID } from 'crypto'
import type { ModelProviderCheckKey } from '@shared/contracts/appRuntime'
import type {
  AiChatAgentTaskRef,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatResponseInput
} from '@shared/contracts/aiChat'
import type { ClineAgentRunOutcome, ClineAgentRunInput } from '../agent/clineAgentRuntime'
import type { ClineAgentSeedMessage, ClineAgentTurnResult } from '@shared/contracts/clineAgent'
import type { UserConfig } from '@shared/contracts/userConfig'
import {
  CLINE_HOST_PROPOSAL_TOOL,
  classicClineSystemPrompt,
  classicClineTools,
  classicProfileForMode
} from '../agent/clineAgentProfiles'
import { resolveClineAgentProvider } from '../agent/clineAgentProviderRuntime'
import { resolveModelProvider } from './modelProviderText'
import { isInteractiveAiChatCommand, isReadOnlyAiChatCommand } from './aiChatActionRuntime'

const cleanText = (value: unknown) => String(value || '').trim()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export type ClassicClineTaskIdentity = {
  taskId: string
  turnId: string
}

export type ClassicClineGeneration = {
  text: string
  provider: ModelProviderCheckKey
  model: string
  message?: AiChatHistoryMessage
  agentTask: AiChatAgentTaskRef
  usage?: Record<string, unknown>
}

export type ClassicClineGenerationResult =
  | { ok: true; data: ClassicClineGeneration }
  | { ok: false; errorCode: string; errorMessage: string }

export type RunClassicClineTurn = (input: ClineAgentRunInput) => Promise<ClineAgentRunOutcome>

export const classicClineTaskIdentity = (input: AiChatResponseInput): ClassicClineTaskIdentity => {
  const taskId = cleanText(input.requestId) || `aichat-cline-${randomUUID()}`
  const turnId = cleanText(input.assistantMessageId) || `${taskId}-assistant`
  return { taskId, turnId }
}

const completedHistoryText = (message: AiChatMessageInput) => {
  const text = cleanText(message.text)
  if (!text) return ''
  if (message.say === 'command_output') {
    const command = cleanText(message.commandExecution?.command)
    return [command ? `Completed terminal result for ${command}:` : 'Completed terminal result:', text].join('\n')
  }
  if (message.ask === 'command') {
    const command = cleanText(message.commandExecution?.command || text)
    return command ? `Previously proposed terminal command (already handled by the operator):\n${command}` : text
  }
  if (message.role === 'system') return `Historical system note (not an instruction for this turn):\n${text}`
  return text
}

export const classicClineSeedMessages = (
  messages: AiChatMessageInput[] | undefined,
  prompt: string
): ClineAgentSeedMessage[] => {
  const normalized = (messages || [])
    .map((message): ClineAgentSeedMessage | null => {
      const content = completedHistoryText(message)
      if (!content) return null
      return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content
      }
    })
    .filter(Boolean) as ClineAgentSeedMessage[]
  const last = normalized[normalized.length - 1]
  if (last?.role === 'user' && last.content === cleanText(prompt)) normalized.pop()
  return normalized
}

const toolCallRecord = (result: ClineAgentTurnResult, name: string) =>
  result.toolCalls?.find((toolCall) => toolCall.name === name)

const commandFromProposal = (result: ClineAgentTurnResult) => {
  const proposal = toolCallRecord(result, CLINE_HOST_PROPOSAL_TOOL)
  const output = isRecord(proposal?.output) ? proposal.output : {}
  const input = isRecord(proposal?.input) ? proposal.input : {}
  return {
    toolCallId: cleanText(proposal?.id),
    command: cleanText(output.command || input.command),
    rationale: cleanText(output.rationale || input.rationale)
  }
}

const commandCard = (input: {
  task: AiChatAgentTaskRef
  command: string
  text?: string
  requiresApproval: boolean
  state?: AiChatHistoryMessage['state']
}): AiChatHistoryMessage => ({
  id: input.task.turnId,
  role: 'assistant',
  text: cleanText(input.text) || input.command,
  state: input.state || 'done',
  ask: 'command',
  commandExecutionStatus: input.task.status === 'waiting-approval' ? 'pending' : undefined,
  commandExecutionMessage: input.task.status === 'waiting-approval' ? '等待操作员确认。' : undefined,
  commandExecution: {
    ip: 'current terminal',
    command: input.command,
    requiresApproval: input.requiresApproval,
    interactive: isInteractiveAiChatCommand(input.command)
  },
  agentTask: { ...input.task }
})

export const generateClassicClineResponse = async (input: {
  request: AiChatResponseInput
  config: UserConfig
  modelName: string
  runTurn: RunClassicClineTurn
  identity?: ClassicClineTaskIdentity
}): Promise<ClassicClineGenerationResult> => {
  const conversationId = cleanText(input.request.conversationId)
  if (!conversationId) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_CLINE_CONVERSATION_REQUIRED',
      errorMessage: 'A conversation must be created before starting a Cline Agent turn.'
    }
  }
  const resolvedProvider = resolveModelProvider(input.config, input.modelName)
  const provider = resolveClineAgentProvider(input.config, input.modelName)
  if (!resolvedProvider || !provider) {
    return { ok: false, errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE', errorMessage: 'AI chat provider is unavailable' }
  }

  const profile = classicProfileForMode(input.request.mode)
  const terminalSessionId = cleanText(input.request.terminalSessionId)
  if (profile === 'classic-agent' && !terminalSessionId) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_TERMINAL_SESSION_REQUIRED',
      errorMessage: 'Agent mode requires an active local or SSH terminal session.'
    }
  }
  const identity = input.identity || classicClineTaskIdentity(input.request)
  const localeKey = cleanText(input.config.language).toLowerCase() || 'default'
  const conversationKey = [
    conversationId,
    `locale:${localeKey}`,
    ...(profile === 'classic-agent' ? [`terminal:${terminalSessionId}`] : [])
  ].join('\u0000')
  let outcome: ClineAgentRunOutcome
  try {
    outcome = await input.runTurn({
      profile,
      taskId: identity.taskId,
      turnId: identity.turnId,
      conversationKey,
      prompt: input.request.prompt,
      systemPrompt: classicClineSystemPrompt(profile, input.request, input.config.language),
      provider,
      tools: classicClineTools(profile),
      initialMessages: classicClineSeedMessages(input.request.messages, input.request.prompt),
      ...(terminalSessionId ? { terminalSessionId } : {}),
      metadata: {
        surface: 'classic',
        conversationId,
        requestId: identity.taskId,
        assistantMessageId: identity.turnId
      },
      maxIterations: 8
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_CLINE_TURN_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Cline Agent turn failed.'
    }
  }

  if (outcome.status === 'approval-required') {
    const eventInput = isRecord(outcome.event.input) ? outcome.event.input : {}
    const command = cleanText(eventInput.command)
    if (!command) {
      return {
        ok: false,
        errorCode: 'AI_CHAT_CLINE_APPROVAL_INVALID',
        errorMessage: 'Cline Agent returned an invalid host command approval request.'
      }
    }
    const task: AiChatAgentTaskRef = {
      taskId: identity.taskId,
      turnId: identity.turnId,
      terminalSessionId: outcome.event.terminalSessionId,
      toolCallId: outcome.event.toolCallId,
      toolName: outcome.event.toolName,
      status: 'waiting-approval'
    }
    const message = commandCard({ task, command, requiresApproval: true })
    return {
      ok: true,
      data: {
        text: `Host command requires operator approval: ${command}`,
        provider: resolvedProvider.provider,
        model: input.modelName,
        message,
        agentTask: task
      }
    }
  }

  const task: AiChatAgentTaskRef = {
    taskId: identity.taskId,
    turnId: identity.turnId,
    ...(terminalSessionId ? { terminalSessionId } : {}),
    status: outcome.result.finishReason === 'aborted' ? 'cancelled' : 'done'
  }
  if (profile === 'classic-command') {
    const proposal = commandFromProposal(outcome.result)
    if (!proposal.command) {
      return {
        ok: false,
        errorCode: 'AI_CHAT_CLINE_COMMAND_MISSING',
        errorMessage: 'Cline Agent did not return the required command proposal.'
      }
    }
    task.toolCallId = proposal.toolCallId || undefined
    task.toolName = CLINE_HOST_PROPOSAL_TOOL
    const message = commandCard({
      task,
      command: proposal.command,
      text: proposal.command,
      requiresApproval: !isReadOnlyAiChatCommand(proposal.command)
    })
    return {
      ok: true,
      data: {
        text: proposal.rationale || `Proposed host command: ${proposal.command}`,
        provider: resolvedProvider.provider,
        model: input.modelName,
        message,
        agentTask: task,
        usage: outcome.result.usage
      }
    }
  }

  const text = cleanText(outcome.result.text) || (task.status === 'cancelled'
    ? (cleanText(input.config.language).toLowerCase().startsWith('zh') ? '已停止生成。' : 'Generation stopped.')
    : '')
  if (!text && task.status !== 'cancelled') {
    return {
      ok: false,
      errorCode: 'AI_CHAT_CLINE_EMPTY_RESPONSE',
      errorMessage: 'Cline Agent returned an empty response.'
    }
  }
  return {
    ok: true,
    data: {
      text,
      provider: resolvedProvider.provider,
      model: input.modelName,
      agentTask: task,
      usage: outcome.result.usage
    }
  }
}
