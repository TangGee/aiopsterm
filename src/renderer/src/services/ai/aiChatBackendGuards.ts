import type {
  AiChatCancelResult,
  AiChatChipRef,
  AiChatContextUsageSnapshot,
  AiChatConversationDeleteResult,
  AiChatConversationMutationResult,
  AiChatConversationRecord,
  AiChatConversationRestoreResult,
  AiChatExchangeRequestResult,
  AiChatHistoryHostContext,
  AiChatHistoryListResult,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatMessageMetadataResult,
  AiChatMessageState,
  AiChatResponseInput,
  AiChatResponseResult,
  AiCommandChipRef,
  AiContentPart,
  AiDocChipRef,
  AiMcpResourceAccessActionResult,
  AiMcpToolCallActionResult,
  AiSkillChipRef,
  AiSupportedImageType
} from '@shared/contracts/aiChat'

export type AiChatHistorySnapshotData = NonNullable<AiChatHistoryListResult['data']>
export type AiChatConversationMutationData = NonNullable<AiChatConversationMutationResult['data']>
export type AiChatConversationDeleteData = NonNullable<AiChatConversationDeleteResult['data']>
export type AiChatConversationRestoreData = NonNullable<AiChatConversationRestoreResult['data']>
export type AiChatMessageMetadataData = NonNullable<AiChatMessageMetadataResult['data']>
export type AiMcpToolCallActionData = NonNullable<AiMcpToolCallActionResult['data']>
export type AiMcpResourceAccessActionData = NonNullable<AiMcpResourceAccessActionResult['data']>
export type AiChatExchangeRequestData = NonNullable<AiChatExchangeRequestResult['data']>
export type AiChatResponseData = NonNullable<AiChatResponseResult['data']>
export type AiChatCancelData = NonNullable<AiChatCancelResult['data']>
export type AiContextUsage = AiChatContextUsageSnapshot

const aiChatHistoryMessageRoles: AiChatHistoryMessage['role'][] = ['user', 'assistant', 'system']
const aiChatMessageStates: AiChatMessageState[] = ['streaming', 'done', 'cancelled', 'error']
const aiChatFeedbackValues: NonNullable<AiChatHistoryMessage['feedback']>[] = ['up', 'down']
const aiChatAskValues: NonNullable<AiChatHistoryMessage['ask']>[] = ['command', 'mcp_tool_call', 'mcp_resource_access', 'followup']
const aiChatSayValues: NonNullable<AiChatHistoryMessage['say']>[] = ['command', 'command_output', 'search_result', 'context_truncated']
const aiChatActionValues: NonNullable<AiChatHistoryMessage['action']>[] = ['approved', 'rejected']
const aiChatCommandExecutionStatusValues: NonNullable<AiChatHistoryMessage['commandExecutionStatus']>[] = ['pending', 'running', 'succeeded', 'failed']
const aiChatAgentTaskStatusValues: NonNullable<AiChatHistoryMessage['agentTask']>['status'][] = [
  'starting',
  'running',
  'waiting-approval',
  'done',
  'cancelled',
  'error'
]
const aiChatModes: NonNullable<AiChatResponseInput['mode']>[] = ['agent', 'command', 'chat']
const aiSupportedImageTypes: AiSupportedImageType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']
const aiProviderKeys = ['aiopsterm-local', 'litellm', 'openai', 'bedrock', 'deepseek', 'anthropic', 'ollama', 'lmstudio']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonNegativeFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPositiveFiniteNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'
const isOptionalFiniteNumber = (value: unknown) => value === undefined || isFiniteNumber(value)
const isOptionalNonNegativeFiniteNumber = (value: unknown) => value === undefined || isNonNegativeFiniteNumber(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isAiProviderKey = (value: unknown) => typeof value === 'string' && aiProviderKeys.includes(value)

export const isAiHistoryHostContext = (source: unknown): source is AiChatHistoryHostContext =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  source.kind === 'hosts' &&
  isNonEmptyString(source.label) &&
  isOptionalString(source.detail)

export const isAiDocChipRef = (source: unknown): source is AiDocChipRef =>
  isRecord(source) &&
  isNonEmptyString(source.absPath) &&
  isOptionalString(source.relPath) &&
  isOptionalString(source.name) &&
  (source.type === undefined || source.type === 'file' || source.type === 'dir') &&
  isOptionalFiniteNumber(source.startLine) &&
  isOptionalFiniteNumber(source.endLine)

export const isAiChatChipRef = (source: unknown): source is AiChatChipRef =>
  isRecord(source) && isNonEmptyString(source.taskId) && isOptionalString(source.title)

export const isAiCommandChipRef = (source: unknown): source is AiCommandChipRef =>
  isRecord(source) &&
  isNonEmptyString(source.command) &&
  isOptionalString(source.label) &&
  isOptionalFiniteNumber(source.summarizeUpToTs) &&
  isOptionalString(source.path)

export const isAiSkillChipRef = (source: unknown): source is AiSkillChipRef =>
  isRecord(source) && isNonEmptyString(source.skillName) && isOptionalString(source.description)

export const isAiContentPart = (source: unknown): source is AiContentPart => {
  if (!isRecord(source)) return false
  if (source.type === 'text') return typeof source.text === 'string'
  if (source.type === 'image') {
    return aiSupportedImageTypes.includes(source.mediaType as AiSupportedImageType) && isNonEmptyString(source.data) && isOptionalString(source.name)
  }
  if (source.type !== 'chip') return false
  if (source.chipType === 'doc') return isAiDocChipRef(source.ref)
  if (source.chipType === 'chat') return isAiChatChipRef(source.ref)
  if (source.chipType === 'command') return isAiCommandChipRef(source.ref)
  if (source.chipType === 'skill') return isAiSkillChipRef(source.ref)
  return false
}

export const isAiChatCommandExecution = (source: unknown): source is NonNullable<AiChatHistoryMessage['commandExecution']> =>
  isRecord(source) &&
  typeof source.ip === 'string' &&
  isNonEmptyString(source.command) &&
  typeof source.requiresApproval === 'boolean' &&
  typeof source.interactive === 'boolean'

export const isAiChatAgentTaskRef = (source: unknown): source is NonNullable<AiChatHistoryMessage['agentTask']> =>
  isRecord(source) &&
  isNonEmptyString(source.taskId) &&
  isNonEmptyString(source.turnId) &&
  isOptionalString(source.targetId) &&
  isOptionalString(source.targetLabel) &&
  isOptionalString(source.terminalSessionId) &&
  isOptionalString(source.toolCallId) &&
  isOptionalString(source.toolName) &&
  isOptionalBoolean(source.restored) &&
  aiChatAgentTaskStatusValues.includes(source.status as NonNullable<AiChatHistoryMessage['agentTask']>['status'])

export const isAiChatHistoryMessage = (source: unknown): source is AiChatHistoryMessage =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  aiChatHistoryMessageRoles.includes(source.role as AiChatHistoryMessage['role']) &&
  typeof source.text === 'string' &&
  (source.contentParts === undefined || (Array.isArray(source.contentParts) && source.contentParts.every(isAiContentPart))) &&
  (source.hosts === undefined || (Array.isArray(source.hosts) && source.hosts.every(isAiHistoryHostContext))) &&
  (source.state === undefined || aiChatMessageStates.includes(source.state as AiChatMessageState)) &&
  isOptionalBoolean(source.favorite) &&
  (source.feedback === undefined || aiChatFeedbackValues.includes(source.feedback as NonNullable<AiChatHistoryMessage['feedback']>)) &&
  isOptionalString(source.executedCommand) &&
  (source.commandExecutionStatus === undefined ||
    aiChatCommandExecutionStatusValues.includes(source.commandExecutionStatus as NonNullable<AiChatHistoryMessage['commandExecutionStatus']>)) &&
  isOptionalString(source.commandExecutionMessage) &&
  (source.ask === undefined || aiChatAskValues.includes(source.ask as NonNullable<AiChatHistoryMessage['ask']>)) &&
  (source.say === undefined || aiChatSayValues.includes(source.say as NonNullable<AiChatHistoryMessage['say']>)) &&
  (source.action === undefined || aiChatActionValues.includes(source.action as NonNullable<AiChatHistoryMessage['action']>)) &&
  (source.commandExecution === undefined || isAiChatCommandExecution(source.commandExecution)) &&
  (source.agentTask === undefined || isAiChatAgentTaskRef(source.agentTask)) &&
  (source.mcpToolCall === undefined ||
    (isRecord(source.mcpToolCall) &&
      isNonEmptyString(source.mcpToolCall.serverName) &&
      isNonEmptyString(source.mcpToolCall.toolName) &&
      (source.mcpToolCall.arguments === undefined || isRecord(source.mcpToolCall.arguments)))) &&
  (source.mcpResourceAccess === undefined ||
    (isRecord(source.mcpResourceAccess) && isNonEmptyString(source.mcpResourceAccess.serverName) && isNonEmptyString(source.mcpResourceAccess.uri))) &&
  (source.followupOptions === undefined || (Array.isArray(source.followupOptions) && source.followupOptions.every((item) => typeof item === 'string'))) &&
  isOptionalString(source.selectedOption) &&
  isOptionalBoolean(source.partial)

export const isAiChatConversationRecord = (source: unknown): source is AiChatConversationRecord =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  typeof source.title === 'string' &&
  typeof source.summary === 'string' &&
  typeof source.updatedAt === 'string' &&
  isNonNegativeFiniteNumber(source.ts) &&
  isOptionalString(source.ipAddress) &&
  isOptionalBoolean(source.favorite)

export const isAiChatHistorySnapshotData = (source: unknown): source is AiChatHistorySnapshotData =>
  isRecord(source) &&
  Array.isArray(source.conversations) &&
  source.conversations.every(isAiChatConversationRecord) &&
  typeof source.selectedConversationId === 'string'

export const isAiChatConversationMutationData = (source: unknown): source is AiChatConversationMutationData =>
  isRecord(source) &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.conversations) &&
  source.conversations.every(isAiChatConversationRecord) &&
  typeof source.selectedConversationId === 'string' &&
  source.conversations.some((conversation) => conversation.id === (source.conversation as AiChatConversationRecord).id)

export const isAiChatConversationDeleteData = (source: unknown): source is AiChatConversationDeleteData =>
  isRecord(source) && isNonEmptyString(source.deletedId) && isAiChatHistorySnapshotData(source)

export const isAiChatConversationRestoreData = (source: unknown): source is AiChatConversationRestoreData =>
  isRecord(source) &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage) &&
  isOptionalNonNegativeFiniteNumber(source.totalMessages) &&
  isOptionalNonNegativeFiniteNumber(source.returnedMessages) &&
  isOptionalBoolean(source.truncated)

export const isAiChatMessageMetadataData = (source: unknown): source is AiChatMessageMetadataData =>
  isRecord(source) &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage)

export const isAiChatMessageInput = (source: unknown): source is AiChatMessageInput =>
  isRecord(source) &&
  aiChatHistoryMessageRoles.includes(source.role as AiChatMessageInput['role']) &&
  typeof source.text === 'string' &&
  (source.ask === undefined || aiChatAskValues.includes(source.ask as NonNullable<AiChatMessageInput['ask']>)) &&
  (source.say === undefined || aiChatSayValues.includes(source.say as NonNullable<AiChatMessageInput['say']>)) &&
  (source.action === undefined || aiChatActionValues.includes(source.action as NonNullable<AiChatMessageInput['action']>)) &&
  (source.commandExecution === undefined || isAiChatCommandExecution(source.commandExecution)) &&
  (source.agentTask === undefined || isAiChatAgentTaskRef(source.agentTask))

export const isAiChatContextInput = (source: unknown): source is NonNullable<AiChatResponseInput['contexts']>[number] =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  isNonEmptyString(source.kind) &&
  isNonEmptyString(source.label) &&
  isOptionalString(source.detail) &&
  isOptionalString(source.relPath) &&
  isOptionalString(source.mediaType) &&
  (source.contextSource === undefined || source.contextSource === 'selected' || source.contextSource === 'knowledge-search') &&
  isOptionalFiniteNumber(source.startLine) &&
  isOptionalFiniteNumber(source.endLine) &&
  isOptionalString(source.chatSessionId)

export const isAiChatCommandInput = (source: unknown): source is NonNullable<AiChatResponseInput['command']> => {
  if (!isRecord(source)) return false
  return (
    isOptionalString(source.id) &&
    isOptionalString(source.label) &&
    isOptionalString(source.command) &&
    isOptionalString(source.path) &&
    [source.id, source.label, source.command].some(isNonEmptyString)
  )
}

export const isAiChatSkillInput = (source: unknown): source is NonNullable<AiChatResponseInput['skills']>[number] =>
  isRecord(source) && isNonEmptyString(source.name) && isOptionalString(source.description) && isOptionalString(source.content)

export const isClineAgentHostTarget = (source: unknown): source is NonNullable<AiChatResponseInput['hostTargets']>[number] =>
  isRecord(source) &&
  isNonEmptyString(source.targetId) &&
  isNonEmptyString(source.terminalSessionId) &&
  isNonEmptyString(source.label) &&
  (source.kind === 'local' || source.kind === 'ssh') &&
  isOptionalString(source.cwd)

export const isAiContextUsageSnapshot = (source: unknown): source is AiContextUsage =>
  isRecord(source) &&
  isNonNegativeFiniteNumber(source.used) &&
  isPositiveFiniteNumber(source.contextWindow) &&
  isNonNegativeFiniteNumber(source.percent) &&
  source.percent <= 100 &&
  (source.tokensIn === undefined || isNonNegativeFiniteNumber(source.tokensIn)) &&
  (source.tokensOut === undefined || isNonNegativeFiniteNumber(source.tokensOut)) &&
  (source.cacheWrites === undefined || isNonNegativeFiniteNumber(source.cacheWrites)) &&
  (source.cacheReads === undefined || isNonNegativeFiniteNumber(source.cacheReads)) &&
  source.source === 'backend' &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId)

export const isAiContextUsageForRequest = (source: unknown, requestId: string, assistantMessageId: string): source is AiContextUsage =>
  isAiContextUsageSnapshot(source) && source.requestId === requestId && source.assistantMessageId === assistantMessageId

export const isAiChatResponseInput = (source: unknown): source is AiChatResponseInput =>
  isRecord(source) &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId) &&
  isOptionalString(source.conversationId) &&
  (source.hostTargets === undefined || (Array.isArray(source.hostTargets) && source.hostTargets.every(isClineAgentHostTarget))) &&
  isNonEmptyString(source.prompt) &&
  (source.messages === undefined || (Array.isArray(source.messages) && source.messages.every(isAiChatMessageInput))) &&
  (source.contexts === undefined || (Array.isArray(source.contexts) && source.contexts.every(isAiChatContextInput))) &&
  (source.userImages === undefined || (Array.isArray(source.userImages) && source.userImages.every(isNonEmptyString))) &&
  (source.skills === undefined || (Array.isArray(source.skills) && source.skills.every(isAiChatSkillInput))) &&
  (source.command === undefined || source.command === null || isAiChatCommandInput(source.command)) &&
  isOptionalString(source.model) &&
  (source.mode === undefined || aiChatModes.includes(source.mode as NonNullable<AiChatResponseInput['mode']>))

export const isAiChatExchangeRequestData = (source: unknown): source is AiChatExchangeRequestData =>
  isRecord(source) &&
  isNonEmptyString(source.requestId) &&
  isAiChatHistoryMessage(source.userMessage) &&
  source.userMessage.role === 'user' &&
  isAiChatHistoryMessage(source.assistantMessage) &&
  source.assistantMessage.role === 'assistant' &&
  isAiChatResponseInput(source.responseInput) &&
  (source.contextUsage === undefined || isAiContextUsageSnapshot(source.contextUsage))

export const isAiChatResponseData = (source: unknown): source is AiChatResponseData =>
  isRecord(source) &&
  isNonEmptyString(source.text) &&
  isAiProviderKey(source.provider) &&
  isNonEmptyString(source.model) &&
  isNonNegativeFiniteNumber(source.durationMs) &&
  (source.status === undefined || source.status === 'done' || source.status === 'cancelled') &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId) &&
  (source.message === undefined || isAiChatHistoryMessage(source.message)) &&
  (source.agentTask === undefined || isAiChatAgentTaskRef(source.agentTask)) &&
  (source.contextUsage === undefined || isAiContextUsageSnapshot(source.contextUsage))

export const aiChatRequestIdFromAssistantMessageId = (assistantMessageId: string) =>
  assistantMessageId.endsWith('-assistant') ? assistantMessageId.slice(0, -'-assistant'.length) : ''

export const aiBridgeErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

export const isAiChatExchangeRequestDataForRequest = (source: unknown): source is AiChatExchangeRequestData => {
  if (!isAiChatExchangeRequestData(source)) return false
  const requestId = source.requestId.trim()
  const userMessageId = source.userMessage.id.trim()
  const assistantMessageId = source.assistantMessage.id.trim()
  const responseRequestId = source.responseInput.requestId?.trim()
  const responseAssistantMessageId = source.responseInput.assistantMessageId?.trim()
  return (
    userMessageId === `${requestId}-user` &&
    assistantMessageId === `${requestId}-assistant` &&
    responseRequestId === requestId &&
    responseAssistantMessageId === assistantMessageId
  )
}

export const isAiChatResponseDataForRequest = (source: unknown, requestId: string, assistantMessageId: string): source is AiChatResponseData => {
  if (!isAiChatResponseData(source)) return false
  if (source.requestId !== requestId || source.assistantMessageId !== assistantMessageId) return false
  if (source.message && source.message.id !== assistantMessageId) return false
  return true
}

export const isAiChatCancelData = (source: unknown): source is AiChatCancelData =>
  isRecord(source) &&
  source.status === 'cancelled' &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId) &&
  isNonEmptyString(source.text) &&
  typeof source.active === 'boolean' &&
  (source.contextUsage === undefined || isAiContextUsageSnapshot(source.contextUsage))

export const isAiChatCancelDataForRequest = (source: unknown, requestId: string, assistantMessageId: string): source is AiChatCancelData =>
  isAiChatCancelData(source) && source.requestId === requestId && source.assistantMessageId === assistantMessageId

export const isAiMcpToolCallActionData = (source: unknown): source is AiMcpToolCallActionData =>
  isRecord(source) &&
  (source.status === 'approved' || source.status === 'rejected') &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage) &&
  (source.mcpConfig === undefined ||
    (isRecord(source.mcpConfig) &&
      isRecord(source.mcpConfig.mcpConfig) &&
      Array.isArray(source.mcpConfig.mcpServers) &&
      isRecord(source.mcpConfig.mcpToolStates)))

export const isAiMcpResourceAccessActionData = (source: unknown): source is AiMcpResourceAccessActionData =>
  isRecord(source) &&
  (source.status === 'approved' || source.status === 'rejected') &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage)
