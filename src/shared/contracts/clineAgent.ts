import type { AiopsMutationResult } from './common'

export const CLINE_AGENT_PROTOCOL_VERSION = 1 as const
export const CLINE_AGENT_SDK_VERSION = '0.0.59' as const
export const CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES = 64 * 1024 * 1024
export const CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES = 40 * 1024 * 1024
export const CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024

export type ClineAgentProfile = 'classic-chat' | 'classic-command' | 'classic-agent' | 'database'

export const CLINE_AGENT_MAX_HOST_TARGETS = 5

export type ClineAgentHostTarget = {
  targetId: string
  terminalSessionId: string
  label: string
  kind: 'local' | 'ssh'
  cwd?: string
}

export type ClineAgentProviderConfig = {
  providerId: 'openai-compatible' | 'openai-native' | 'litellm' | 'anthropic' | 'deepseek' | 'ollama' | 'lmstudio' | 'bedrock'
  modelId: string
  apiKey?: string
  baseUrl?: string
  providerConfig?: {
    providerId: string
    modelId: string
    [key: string]: unknown
  }
  knownModels?: Record<string, {
    id: string
    name?: string
    contextWindow?: number
    maxInputTokens?: number
    maxTokens?: number
    capabilities?: Array<
      | 'images'
      | 'streaming'
      | 'reasoning'
      | 'files'
      | 'tools'
      | 'temperature'
      | 'prompt-cache'
      | 'reasoning-effort'
      | 'computer-use'
      | 'global-endpoint'
      | 'structured_output'
    >
    status?: 'active' | 'preview' | 'deprecated'
  }>
  thinking?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  thinkingBudgetTokens?: number
  maxTokensPerTurn?: number
  useHostProxy?: boolean
}

export type ClineAgentProviderFetchInput = {
  sessionId: string
  taskId: string
  turnId: string
  url: string
  method: string
  headers: Record<string, string>
  bodyBase64?: string
}

export type ClineAgentProviderFetchResult = {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyBase64: string
}

export type ClineAgentSeedMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ClineAgentToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  autoApprove: boolean
  completesRun?: boolean
  timeoutMs?: number
}

export type ClineAgentSessionStartInput = {
  sessionId: string
  profile: ClineAgentProfile
  systemPrompt: string
  provider: ClineAgentProviderConfig
  tools: ClineAgentToolDefinition[]
  initialMessages?: ClineAgentSeedMessage[]
  /** Delete and recreate this deterministic native session from `initialMessages`. */
  replaceTranscript?: boolean
  metadata?: Record<string, unknown>
  maxIterations?: number
}

export type ClineAgentTurnInput = {
  sessionId: string
  taskId: string
  turnId: string
  prompt: string
  userImages?: string[]
}

export type ClineAgentTurnResult = {
  sessionId: string
  taskId: string
  turnId: string
  text: string
  finishReason: string
  iterations: number
  usage?: Record<string, unknown>
  toolCalls?: Array<{
    id: string
    name: string
    input: unknown
    output: unknown
    error?: string
    durationMs?: number
  }>
}

type ClineAgentTaskEventBase = {
  protocolVersion: typeof CLINE_AGENT_PROTOCOL_VERSION
  sessionId: string
  taskId: string
  turnId: string
  seq: number
  at: string
}

export type ClineAgentTaskEvent =
  | (ClineAgentTaskEventBase & {
      type: 'status'
      status: 'starting' | 'running' | 'waiting-approval' | 'idle' | 'interrupted'
      message?: string
    })
  | (ClineAgentTaskEventBase & {
      type: 'text-delta'
      text: string
      accumulated?: string
    })
  | (ClineAgentTaskEventBase & {
      type: 'reasoning-delta'
      text: string
      redacted?: boolean
    })
  | (ClineAgentTaskEventBase & {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      input: unknown
      targetId?: string
      targetLabel?: string
      terminalSessionId?: string
      iteration?: number
    })
  | (ClineAgentTaskEventBase & {
      type: 'tool-update'
      toolCallId: string
      toolName: string
      update: unknown
    })
  | (ClineAgentTaskEventBase & {
      type: 'tool-result'
      toolCallId: string
      toolName: string
      output?: unknown
      error?: string
      durationMs?: number
    })
  | (ClineAgentTaskEventBase & {
      type: 'approval-requested'
      toolCallId: string
      toolName: string
      targetId?: string
      targetLabel?: string
      terminalSessionId?: string
      serverName?: string
      resourceUri?: string
      input: unknown
      iteration: number
      autoApprovable?: boolean
      reason?: string
    })
  | (ClineAgentTaskEventBase & {
      type: 'usage'
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      totalInputTokens?: number
      totalOutputTokens?: number
      totalCost?: number
    })
  | (ClineAgentTaskEventBase & {
      type: 'done'
      text: string
      finishReason: string
      iterations: number
      usage?: Record<string, unknown>
    })
  | (ClineAgentTaskEventBase & {
      type: 'cancelled'
      reason?: string
    })
  | (ClineAgentTaskEventBase & {
      type: 'error'
      errorCode: string
      errorMessage: string
      recoverable: boolean
    })

export type ClineAgentTaskEventData = ClineAgentTaskEvent extends infer Event
  ? Event extends ClineAgentTaskEventBase
    ? Omit<Event, keyof ClineAgentTaskEventBase>
    : never
  : never

export type ClineAgentApprovalInput = {
  taskId: string
  turnId: string
  toolCallId: string
  toolName: string
  targetId?: string
  targetLabel?: string
  terminalSessionId?: string
  serverName?: string
  resourceUri?: string
  approved: boolean
  enableReadOnlyAutoRun?: boolean
  reason?: string
}

export type ClineAgentApprovalResult = AiopsMutationResult<{
  taskId: string
  turnId: string
  toolCallId: string
  toolName: string
  targetId?: string
  targetLabel?: string
  terminalSessionId?: string
  serverName?: string
  resourceUri?: string
  status: 'approved' | 'rejected'
  readOnlyAutoRunEnabled?: boolean
}>

export type ClineAgentAbortInput = {
  taskId: string
  turnId?: string
  reason?: string
}

export type ClineAgentAbortResult = AiopsMutationResult<{
  taskId: string
  turnId?: string
  status: 'cancelled'
}>

export type ClineAgentSidecarReady = {
  protocolVersion: typeof CLINE_AGENT_PROTOCOL_VERSION
  sdkVersion: typeof CLINE_AGENT_SDK_VERSION
  pid: number
}

export type ClineAgentSidecarRequestMethod =
  | 'runtime.ping'
  | 'runtime.shutdown'
  | 'session.start'
  | 'session.send'
  | 'session.abort'
  | 'session.stop'
  | 'session.delete'

export type ClineAgentSidecarRequest = {
  version: typeof CLINE_AGENT_PROTOCOL_VERSION
  kind: 'request'
  id: string
  method: ClineAgentSidecarRequestMethod
  payload?: unknown
}

export type ClineAgentSidecarResponse = {
  version: typeof CLINE_AGENT_PROTOCOL_VERSION
  kind: 'response'
  id: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export type ClineAgentSidecarEvent = {
  version: typeof CLINE_AGENT_PROTOCOL_VERSION
  kind: 'event'
  event: 'runtime.ready' | 'agent.task'
  payload: ClineAgentSidecarReady | ClineAgentTaskEvent
}

export type ClineAgentSidecarCallback = {
  version: typeof CLINE_AGENT_PROTOCOL_VERSION
  kind: 'callback'
  id: string
  callback: 'tool.execute' | 'approval.request' | 'provider.fetch'
  payload: unknown
}

export type ClineAgentSidecarCallbackResult = {
  version: typeof CLINE_AGENT_PROTOCOL_VERSION
  kind: 'callback-result'
  id: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export type ClineAgentSidecarMessage =
  | ClineAgentSidecarRequest
  | ClineAgentSidecarResponse
  | ClineAgentSidecarEvent
  | ClineAgentSidecarCallback
  | ClineAgentSidecarCallbackResult
