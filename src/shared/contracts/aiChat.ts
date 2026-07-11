import type { ModelProviderCheckKey } from './appRuntime'
import type { AiopsMutationResult } from './common'
import type { McpConfigWriteResult, McpResourceReadResult, McpToolCallResult } from './mcp'

export type AiContextKind = 'hosts' | 'docs' | 'images' | 'skills' | 'chats'

export type AiContextOption = {
  id: string
  kind: AiContextKind
  label: string
  detail?: string
  host?: string
  port?: number
  username?: string
  assetName?: string
  isLocalShell?: boolean
  relPath?: string
  parentRelPath?: string
  contextType?: 'file' | 'dir' | 'doc' | 'image'
  content?: string
  mediaType?: string
  data?: string
}

export type AiContextCategoryInfo = {
  id: AiContextKind
  label: string
  options: AiContextOption[]
}

export type AiContextCatalog = {
  categories: AiContextCategoryInfo[]
  openedHosts: AiContextOption[]
  selectedDefaults: AiContextOption[]
}

export type AiContextCatalogResult = AiopsMutationResult<AiContextCatalog>

export type AiCommandCatalogOption = {
  id: string
  label: string
  name: string
  path: string
  command: string
}

export type AiCommandCatalog = {
  commands: AiCommandCatalogOption[]
}

export type AiCommandCatalogResult = AiopsMutationResult<AiCommandCatalog>

export type AiChatHistoryMessageRole = 'user' | 'assistant' | 'system'
export type AiChatMessageState = 'streaming' | 'done' | 'cancelled' | 'error'

export type AiChatAgentTaskStatus = 'starting' | 'running' | 'waiting-approval' | 'done' | 'cancelled' | 'error'

export type AiChatAgentTaskRef = {
  taskId: string
  turnId: string
  terminalSessionId?: string
  toolCallId?: string
  toolName?: string
  status: AiChatAgentTaskStatus
}

export type AiChatHistoryHostContext = {
  id: string
  kind: 'hosts'
  label: string
  detail?: string
}

export type AiTextContentPart = {
  type: 'text'
  text: string
}

export type AiDocChipRef = {
  absPath: string
  relPath?: string
  name?: string
  type?: 'file' | 'dir'
  startLine?: number
  endLine?: number
}

export type AiChatChipRef = {
  taskId: string
  title?: string
}

export type AiCommandChipRef = {
  command: string
  label?: string
  summarizeUpToTs?: number
  path?: string
}

export type AiSkillChipRef = {
  skillName: string
  description?: string
}

export type AiDocChipContentPart = { type: 'chip'; chipType: 'doc'; ref: AiDocChipRef }
export type AiChatChipContentPart = { type: 'chip'; chipType: 'chat'; ref: AiChatChipRef }
export type AiCommandChipContentPart = { type: 'chip'; chipType: 'command'; ref: AiCommandChipRef }
export type AiSkillChipContentPart = { type: 'chip'; chipType: 'skill'; ref: AiSkillChipRef }
export type AiChipContentPart =
  | AiDocChipContentPart
  | AiChatChipContentPart
  | AiCommandChipContentPart
  | AiSkillChipContentPart

export type AiSupportedImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/bmp' | 'image/svg+xml'

export type AiImageContentPart = {
  type: 'image'
  mediaType: AiSupportedImageType
  data: string
  name?: string
}

export type AiContentPart = AiTextContentPart | AiChipContentPart | AiImageContentPart

export type AiChatHistoryMessage = {
  id: string
  role: AiChatHistoryMessageRole
  text: string
  contentParts?: AiContentPart[]
  hosts?: AiChatHistoryHostContext[]
  state?: AiChatMessageState
  favorite?: boolean
  feedback?: 'up' | 'down'
  executedCommand?: string
  commandExecutionStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
  commandExecutionMessage?: string
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  agentTask?: AiChatAgentTaskRef
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
  followupOptions?: string[]
  selectedOption?: string
  partial?: boolean
}

export type AiChatExportMessage = AiChatHistoryMessage

export type AiChatExportInput = {
  title: string
  messages: AiChatExportMessage[]
}

export type AiChatExportResult = AiopsMutationResult<{
  exported: number
  fileName: string
  filePath?: string
  bytes?: number
  canceled?: boolean
  markdown?: string
}>

export type AiChatConversationRecord = {
  id: string
  title: string
  summary: string
  updatedAt: string
  ts: number
  ipAddress?: string
  favorite?: boolean
}

export type AiChatHistorySnapshot = {
  conversations: AiChatConversationRecord[]
  selectedConversationId: string
}

export type AiChatHistoryListResult = AiopsMutationResult<AiChatHistorySnapshot>

export type AiChatConversationMutationResult = AiopsMutationResult<{
  conversation: AiChatConversationRecord
  conversations: AiChatConversationRecord[]
  selectedConversationId: string
}>

export type AiChatConversationDeleteResult = AiopsMutationResult<{
  deletedId: string
  conversations: AiChatConversationRecord[]
  selectedConversationId: string
}>

export type AiChatConversationRestoreResult = AiopsMutationResult<{
  conversation: AiChatConversationRecord
  messages: AiChatHistoryMessage[]
  totalMessages?: number
  returnedMessages?: number
  truncated?: boolean
}>

export type AiChatConversationUpdateInput = {
  id: string
  title?: string
  summary?: string
  favorite?: boolean
  messages?: AiChatHistoryMessage[]
}

export type AiChatMessageMetadataInput = {
  conversationId: string
  messageId: string
  favorite?: boolean
  feedback?: 'up' | 'down' | null
}

export type AiChatMessageMetadataResult = AiopsMutationResult<{
  conversation: AiChatConversationRecord
  messages: AiChatHistoryMessage[]
}>

export type AiMcpToolCallActionInput = {
  conversationId: string
  messageId: string
  autoApprove?: boolean
}

export type AiMcpToolCallActionResult = AiopsMutationResult<{
  status: 'approved' | 'rejected'
  conversation: AiChatConversationRecord
  messages: AiChatHistoryMessage[]
  toolCall?: NonNullable<McpToolCallResult['data']>
  toolCallError?: {
    errorCode?: string
    errorMessage: string
  }
  mcpConfig?: NonNullable<McpConfigWriteResult['data']>
}>

export type AiMcpResourceAccessActionInput = {
  conversationId: string
  messageId: string
}

export type AiMcpResourceAccessActionResult = AiopsMutationResult<{
  status: 'approved' | 'rejected'
  conversation: AiChatConversationRecord
  messages: AiChatHistoryMessage[]
  resourceAccess?: NonNullable<McpResourceReadResult['data']>
  resourceAccessError?: {
    errorCode?: string
    errorMessage: string
  }
}>

export type AiTodoStatus = 'pending' | 'in_progress' | 'completed'

export type AiTodoSubtask = {
  id: string
  content: string
  description?: string
}

export type AiTodoItem = {
  id: string
  content: string
  description?: string
  status: AiTodoStatus
  isFocused?: boolean
  subtasks?: AiTodoSubtask[]
}

export type AiTodoSnapshot = {
  todos: AiTodoItem[]
  focusedTodoId: string | null
  totalTodos: number
  completedTodos: number
  source: 'backend'
  updatedAt: string
}

export type AiTodoSnapshotResult = AiopsMutationResult<AiTodoSnapshot>

export type AiChatMessageInput = {
  role: 'user' | 'assistant' | 'system'
  text: string
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  agentTask?: AiChatAgentTaskRef
}

export type AiChatContextInput = {
  id: string
  kind: AiContextKind | string
  label: string
  detail?: string
  relPath?: string
  mediaType?: string
}

export type AiChatCommandInput = {
  id?: string
  label?: string
  command?: string
  path?: string
}

export type AiChatSkillInput = {
  name: string
  description?: string
  content?: string
}

export type AiChatContextUsageSnapshot = {
  used: number
  contextWindow: number
  percent: number
  tokensIn?: number
  tokensOut?: number
  cacheWrites?: number
  cacheReads?: number
  source: 'backend'
  requestId?: string
  assistantMessageId?: string
}

export type AiChatExchangeRequestInput = {
  text: string
  conversationId?: string
  terminalSessionId?: string
  hosts?: AiChatHistoryHostContext[]
  messages?: AiChatMessageInput[]
  contexts?: AiChatContextInput[]
  command?: AiChatCommandInput | null
  model?: string
  mode?: 'agent' | 'command' | 'chat'
}

export type AiChatExchangeRequestResult = AiopsMutationResult<{
  requestId: string
  userMessage: AiChatHistoryMessage
  assistantMessage: AiChatHistoryMessage
  responseInput: AiChatResponseInput
  contextUsage?: AiChatContextUsageSnapshot
}>

export type AiChatResponseInput = {
  requestId?: string
  assistantMessageId?: string
  conversationId?: string
  terminalSessionId?: string
  prompt: string
  messages?: AiChatMessageInput[]
  contexts?: AiChatContextInput[]
  skills?: AiChatSkillInput[]
  command?: AiChatCommandInput | null
  model?: string
  mode?: 'agent' | 'command' | 'chat'
}

export type AiChatResponseResult = AiopsMutationResult<{
  text: string
  provider: 'aiopsterm-local' | ModelProviderCheckKey
  model: string
  durationMs: number
  status?: Extract<AiChatMessageState, 'done' | 'cancelled'>
  requestId?: string
  assistantMessageId?: string
  message?: AiChatHistoryMessage
  agentTask?: AiChatAgentTaskRef
  contextUsage?: AiChatContextUsageSnapshot
}>

export type AiChatCancelInput = {
  requestId?: string
  assistantMessageId?: string
}

export type AiChatCancelResult = AiopsMutationResult<{
  status: 'cancelled'
  requestId?: string
  assistantMessageId?: string
  text: string
  active: boolean
  contextUsage?: AiChatContextUsageSnapshot
}>
