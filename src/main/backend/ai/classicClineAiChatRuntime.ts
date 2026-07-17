import { randomUUID } from 'crypto'
import type { ModelProviderCheckKey } from '@shared/contracts/appRuntime'
import type {
  AiChatAgentTaskRef,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatResponseInput
} from '@shared/contracts/aiChat'
import {
  clineAgentSessionIdFor,
  type ClineAgentRunOutcome,
  type ClineAgentRunInput
} from '../agent/clineAgentRuntime'
import type { ClineAgentHostTarget, ClineAgentSeedMessage, ClineAgentTaskEvent, ClineAgentTurnResult } from '@shared/contracts/clineAgent'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { UserRuleConfig } from '@shared/contracts/settingsPreferences'
import {
  CLINE_HOST_PROPOSAL_TOOL,
  classicClineSystemPrompt,
  classicClineTools,
  classicProfileForMode
} from '../agent/clineAgentProfiles'
import {
  CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL,
  CLASSIC_AGENT_READ_HOST_FILE_TOOL,
  CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL
} from '../agent/classicAgentTools'
import { resolveClineAgentProvider } from '../agent/clineAgentProviderRuntime'
import { resolveModelProvider } from './modelProviderText'
import { isInteractiveAiChatCommand, isReadOnlyAiChatCommand } from './aiChatActionRuntime'
import { validateClassicUserImages } from './classicRichContext'

const cleanText = (value: unknown) => String(value || '').trim()

export const classicClineSessionScopeKey = (conversationId: string) => cleanText(conversationId)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const classicHostTargets = (request: AiChatResponseInput): ClineAgentHostTarget[] => {
  return (request.hostTargets || []).map((target) => ({
    targetId: cleanText(target.targetId),
    terminalSessionId: cleanText(target.terminalSessionId),
    label: cleanText(target.label),
    kind: target.kind,
    ...(cleanText(target.cwd) ? { cwd: cleanText(target.cwd) } : {})
  }))
}

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
  nativeSessionId: string
  nativeProfile: string
  nativeScopeKey: string
}

export type ClassicClineGenerationResult =
  | { ok: true; data: ClassicClineGeneration }
  | { ok: false; errorCode: string; errorMessage: string }

export type RunClassicClineTurn = (input: ClineAgentRunInput) => Promise<ClineAgentRunOutcome>

export const classicClineNativeBinding = (request: AiChatResponseInput, _language?: string) => {
  const conversationId = cleanText(request.conversationId)
  const profile = classicProfileForMode(request.mode)
  const scopeKey = classicClineSessionScopeKey(conversationId)
  return {
    profile,
    scopeKey,
    nativeSessionId: clineAgentSessionIdFor(profile, scopeKey)
  }
}

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

const commandFromProposal = (result: ClineAgentTurnResult, hostTargets: ClineAgentHostTarget[]) => {
  const proposal = toolCallRecord(result, CLINE_HOST_PROPOSAL_TOOL)
  const output = isRecord(proposal?.output) ? proposal.output : {}
  const input = isRecord(proposal?.input) ? proposal.input : {}
  const targetId = cleanText(output.targetId || input.targetId)
  const target = hostTargets.find((candidate) => candidate.targetId === targetId)
  return {
    toolCallId: cleanText(proposal?.id),
    command: cleanText(output.command || input.command),
    rationale: cleanText(output.rationale || input.rationale),
    target
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
    ip: input.task.targetLabel || '',
    command: input.command,
    requiresApproval: input.requiresApproval,
    interactive: isInteractiveAiChatCommand(input.command)
  },
  agentTask: { ...input.task }
})

type ClineApprovalEvent = Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>

const sensitiveApprovalCard = (
  event: ClineApprovalEvent,
  task: AiChatAgentTaskRef,
  eventInput: Record<string, unknown>
): AiChatHistoryMessage | null => {
  if (event.toolName === CLASSIC_AGENT_READ_HOST_FILE_TOOL || event.toolName === CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL) {
    if (!event.targetId || !event.targetLabel || !event.terminalSessionId) return null
    const argumentsWithoutTarget = Object.fromEntries(
      Object.entries(eventInput).filter(([key]) => key !== 'targetId')
    )
    const detail = event.toolName === CLASSIC_AGENT_READ_HOST_FILE_TOOL
      ? cleanText(eventInput.path)
      : [cleanText(eventInput.kind), cleanText(eventInput.path), cleanText(eventInput.pattern)].filter(Boolean).join(' ')
    if (!detail) return null
    return {
      id: task.turnId,
      role: 'assistant',
      text: `${event.toolName}: ${detail}`,
      state: 'done',
      ask: 'mcp_tool_call',
      mcpToolCall: {
        serverName: event.targetLabel,
        toolName: event.toolName,
        arguments: argumentsWithoutTarget
      },
      agentTask: { ...task }
    }
  }
  if (event.toolName === CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL) {
    const serverName = cleanText(event.serverName || eventInput.serverName)
    const uri = cleanText(event.resourceUri || eventInput.uri)
    if (!serverName || !uri || serverName !== cleanText(eventInput.serverName) || uri !== cleanText(eventInput.uri)) return null
    return {
      id: task.turnId,
      role: 'assistant',
      text: `${event.toolName}: ${serverName} ${uri}`,
      state: 'done',
      ask: 'mcp_resource_access',
      mcpResourceAccess: { serverName, uri },
      agentTask: { ...task }
    }
  }
  return null
}

export const generateClassicClineResponse = async (input: {
  request: AiChatResponseInput
  config: UserConfig
  modelName: string
  operatorRules?: UserRuleConfig[]
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

  const binding = classicClineNativeBinding(input.request, input.config.language)
  const profile = binding.profile
  const hostTargets = classicHostTargets(input.request)
  const identity = input.identity || classicClineTaskIdentity(input.request)
  const conversationKey = binding.scopeKey
  const imageValidation = validateClassicUserImages(input.request.userImages)
  if (imageValidation.imageErrors.length) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_IMAGE_INVALID',
      errorMessage: [...new Set(imageValidation.imageErrors)].join('\n')
    }
  }
  let outcome: ClineAgentRunOutcome
  try {
    outcome = await input.runTurn({
      profile,
      taskId: identity.taskId,
      turnId: identity.turnId,
      conversationKey,
      prompt: input.request.prompt,
      userImages: imageValidation.userImages,
      systemPrompt: classicClineSystemPrompt(profile, { ...input.request, hostTargets }, input.config.language, {
        rules: input.operatorRules || input.config.rules,
        customInstructions: input.config.customInstructions,
        mcpServers: input.config.mcpServers
      }),
      provider,
      tools: classicClineTools(profile, hostTargets),
      initialMessages: classicClineSeedMessages(input.request.messages, input.request.prompt),
      replaceTranscript: input.request.replaceNativeTranscript === true || undefined,
      hostTargets,
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
    const task: AiChatAgentTaskRef = {
      taskId: identity.taskId,
      turnId: identity.turnId,
      ...(outcome.event.targetId ? { targetId: outcome.event.targetId } : {}),
      ...(outcome.event.targetLabel ? { targetLabel: outcome.event.targetLabel } : {}),
      ...(outcome.event.terminalSessionId ? { terminalSessionId: outcome.event.terminalSessionId } : {}),
      toolCallId: outcome.event.toolCallId,
      toolName: outcome.event.toolName,
      status: 'waiting-approval'
    }
    const command = cleanText(eventInput.command)
    const message = outcome.event.toolName === 'run_host_command' && command
      ? commandCard({ task, command, requiresApproval: outcome.event.autoApprovable !== true })
      : sensitiveApprovalCard(outcome.event, task, eventInput)
    if (!message) {
      return {
        ok: false,
        errorCode: 'AI_CHAT_CLINE_APPROVAL_INVALID',
        errorMessage: 'Cline Agent returned an invalid tool approval request.'
      }
    }
    return {
      ok: true,
      data: {
        text: command
          ? `Host command requires operator approval: ${command}`
          : `Tool requires operator approval: ${outcome.event.toolName}`,
        provider: resolvedProvider.provider,
        model: input.modelName,
        message,
        agentTask: task,
        nativeSessionId: binding.nativeSessionId,
        nativeProfile: binding.profile,
        nativeScopeKey: binding.scopeKey
      }
    }
  }

  const task: AiChatAgentTaskRef = {
    taskId: identity.taskId,
    turnId: identity.turnId,
    status: outcome.result.finishReason === 'aborted' ? 'cancelled' : 'done'
  }
  if (profile === 'classic-command') {
    const proposal = commandFromProposal(outcome.result, hostTargets)
    if (!proposal.command) {
      return {
        ok: false,
        errorCode: 'AI_CHAT_CLINE_COMMAND_MISSING',
        errorMessage: 'Cline Agent did not return the required command proposal.'
      }
    }
    if (hostTargets.length && !proposal.target) {
      return {
        ok: false,
        errorCode: 'AI_CHAT_CLINE_COMMAND_TARGET_INVALID',
        errorMessage: 'Cline Agent did not return a valid targetId for the command proposal.'
      }
    }
    task.toolCallId = proposal.toolCallId || undefined
    task.toolName = CLINE_HOST_PROPOSAL_TOOL
    task.targetId = proposal.target?.targetId
    task.targetLabel = proposal.target?.label
    task.terminalSessionId = proposal.target?.terminalSessionId
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
        usage: outcome.result.usage,
        nativeSessionId: binding.nativeSessionId,
        nativeProfile: binding.profile,
        nativeScopeKey: binding.scopeKey
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
      usage: outcome.result.usage,
      nativeSessionId: binding.nativeSessionId,
      nativeProfile: binding.profile,
      nativeScopeKey: binding.scopeKey
    }
  }
}
