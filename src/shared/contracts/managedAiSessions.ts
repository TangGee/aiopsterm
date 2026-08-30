import type { AiopsMutationResult } from './common'

export type BuiltinAiAgentSessionSource =
  | 'codex'
  | 'claude-code'
  | 'cursor'
  | 'gemini'
  | 'copilot'
  | 'grok'
  | 'opencode'
  | 'codebuddy'
  | 'factory'
  | 'qoder'
  | 'antigravity'
  | 'kiro'
  | 'hermes-agent'
  | 'rovodev'
  | 'amp'
  | 'pi'
  | 'omp'
  | 'kimi-code'
  | 'deepseek-harness'

export type CustomAiAgentSessionSource = `custom:${string}`

export type AiAgentSessionSource = BuiltinAiAgentSessionSource | CustomAiAgentSessionSource

export type AiAgentSessionEventName =
  | 'session_start'
  | 'prompt_submit'
  | 'pre_tool_use'
  | 'permission_request'
  | 'question'
  | 'notification'
  | 'lifecycle'
  | 'stop'
  | 'session_end'

export type ManagedAiRequestKind = 'permission' | 'question' | 'plan' | 'notification' | 'telemetry'

export type ManagedAiDecisionMode = 'blocking' | 'telemetry' | 'local'

export type ManagedAiSessionKind = 'main' | 'subagent' | 'internal'

export type AiAgentSessionEventInput = {
  source?: string
  agent?: string
  agentName?: string
  agent_name?: string
  event?: string
  hookEventName?: string
  hook_event_name?: string
  type?: string
  kind?: string
  sessionId?: string
  session_id?: string
  conversationId?: string
  conversation_id?: string
  id?: string
  panelId?: string
  panel_id?: string
  surfaceId?: string
  surface_id?: string
  terminalSessionId?: string
  terminal_session_id?: string
  terminalId?: string
  terminal_id?: string
  workspaceId?: string
  workspace_id?: string
  cwd?: string
  canonicalCwd?: string
  canonical_cwd?: string
  gitBranch?: string
  git_branch?: string
  gitDirty?: boolean
  git_dirty?: boolean
  gitStatusUpdatedAt?: number
  git_status_updated_at?: number
  realCwd?: string
  real_cwd?: string
  realpath?: string
  workingDirectory?: string
  working_directory?: string
  transcriptPath?: string
  transcript_path?: string
  turnId?: string
  turn_id?: string
  title?: string
  summary?: string
  message?: string
  body?: string
  text?: string
  prompt?: string
  requestId?: string
  request_id?: string
  requestKind?: string
  request_kind?: string
  decisionMode?: string
  decision_mode?: string
  toolName?: string
  tool_name?: string
  waitForDecision?: boolean
  wait_for_decision?: boolean
  waitTimeoutMs?: number
  wait_timeout_ms?: number
  launchCommand?: string
  launch_command?: string
  resumeCommand?: string
  resume_command?: string
  sessionKind?: string
  session_kind?: string
  threadSource?: string
  thread_source?: string
  isSubagent?: boolean
  is_subagent?: boolean
  isSidechain?: boolean
  is_sidechain?: boolean
  sidechain?: boolean
  subagent?: unknown
  parentSessionId?: string
  parent_session_id?: string
  parentThreadId?: string
  parent_thread_id?: string
  restorable?: boolean
  isRestorable?: boolean
  is_restorable?: boolean
  canResume?: boolean
  can_resume?: boolean
  processId?: number
  process_id?: number
  pid?: number
  parentProcessId?: number
  parent_process_id?: number
  ppid?: number
  processGroupId?: number
  process_group_id?: number
  pgid?: number
  agentLifecycle?: ManagedAiSessionLifecycle
  agent_lifecycle?: ManagedAiSessionLifecycle
  lifecycle?: ManagedAiSessionLifecycle
  status?: string
  receivedAt?: number
  [key: string]: unknown
}

export type AiAgentSessionEvent = {
  source: AiAgentSessionSource
  event: AiAgentSessionEventName
  sessionId: string
  title: string
  summary: string
  receivedAt: number
  panelId?: string
  terminalSessionId?: string
  workspaceId?: string
  cwd?: string
  canonicalCwd?: string
  gitBranch?: string
  gitDirty?: boolean
  gitStatusUpdatedAt?: number
  transcriptPath?: string
  requestId?: string
  requestKind?: ManagedAiRequestKind
  decisionMode?: ManagedAiDecisionMode
  waitTimeoutMs?: number
  toolName?: string
  actionable?: boolean
  launchCommand?: string
  resumeCommand?: string
  sessionKind?: ManagedAiSessionKind
  parentSessionId?: string
  restorable?: boolean
  processId?: number
  parentProcessId?: number
  processGroupId?: number
  agentLifecycle?: ManagedAiSessionLifecycle
  terminalProcessId?: number
  terminalActivityAt?: number
}

export type AiAgentSessionEventResult = AiopsMutationResult<AiAgentSessionEvent>

export type ManagedAiSessionState = 'idle' | 'working' | 'needsInput' | 'ended' | 'unknown'

export type ManagedAiSessionLifecycle = 'idle' | 'running' | 'needsInput' | 'ended' | 'unknown'

export type ManagedAiSessionDecisionKind = 'allow' | 'always' | 'bypass' | 'deny' | 'reply' | 'handled'

export type ManagedAiSessionTimelineEvent = AiAgentSessionEvent & {
  id: string
  requestKind: ManagedAiRequestKind
  decisionMode: ManagedAiDecisionMode
  raw?: Record<string, unknown>
}

export type ManagedAiSessionDecision = {
  id: string
  kind: ManagedAiSessionDecisionKind
  message?: string
  createdAt: number
}

export type ManagedAiSessionRecord = {
  id: string
  source: AiAgentSessionSource
  title: string
  summary: string
  state: ManagedAiSessionState
  lastEvent: AiAgentSessionEventName
  lastActivityAt: number
  createdAt: number
  updatedAt: number
  handledAt?: number
  autoTitle?: string
  userTitle?: string
  autoTitleEventCount?: number
  autoTitleAttemptedAt?: number
  autoTitleGeneratedAt?: number
  panelId?: string
  terminalSessionId?: string
  workspaceId?: string
  cwd?: string
  canonicalCwd?: string
  gitBranch?: string
  gitDirty?: boolean
  gitStatusUpdatedAt?: number
  transcriptPath?: string
  pendingRequestId?: string
  requestKind: ManagedAiRequestKind
  decisionMode: ManagedAiDecisionMode
  waitTimeoutMs?: number
  toolName?: string
  actionable?: boolean
  launchCommand?: string
  resumeCommand?: string
  sessionKind?: ManagedAiSessionKind
  parentSessionId?: string
  restorable?: boolean
  processId?: number
  parentProcessId?: number
  processGroupId?: number
  agentLifecycle?: ManagedAiSessionLifecycle
  terminalProcessId?: number
  terminalActivityAt?: number
  hibernated?: boolean
  hibernatedAt?: number
  hibernationReason?: string
  hibernatedTerminalSessionId?: string
  events: ManagedAiSessionTimelineEvent[]
  decisions: ManagedAiSessionDecision[]
}

export type ManagedAiSessionSnapshot = {
  sessions: ManagedAiSessionRecord[]
}

export type ManagedAiSessionEvent = {
  name: string
  category: 'managed-ai'
  source: string
  sessionId?: string
  title?: string
  state?: ManagedAiSessionState
  payload: Record<string, unknown>
  seq?: number
}

export type ManagedAiSessionListResult = AiopsMutationResult<ManagedAiSessionSnapshot>

export type ManagedAiSessionReplyInput = {
  source: AiAgentSessionSource
  sessionId: string
  kind: ManagedAiSessionDecisionKind
  message?: string
}

export type ManagedAiSessionRenameInput = {
  source: AiAgentSessionSource
  sessionId: string
  title: string
}

export type ManagedAiSessionClearInput = {
  source: AiAgentSessionSource
  sessionId: string
}

export type ManagedAiSessionBulkOperation = 'mark-handled' | 'clear-ended' | 'clear-all'

export type ManagedAiSessionBulkInput = {
  operation: ManagedAiSessionBulkOperation
  sources?: AiAgentSessionSource[]
  sessionIds?: string[]
}

export type ManagedAiSessionMutationResult = AiopsMutationResult<{
  session?: ManagedAiSessionRecord
  snapshot: ManagedAiSessionSnapshot
}>

export type ManagedAiSessionTerminalBindInput = {
  source: AiAgentSessionSource
  sessionId: string
  terminalSessionId: string
  panelId?: string
  workspaceId?: string
  cwd?: string
}

export type ManagedAiSessionBulkResult = AiopsMutationResult<{
  changed: number
  snapshot: ManagedAiSessionSnapshot
}>

export type AgentHibernationConfig = {
  enabled: boolean
  idleSeconds: number
  maxLiveTerminals: number
  confirmationSeconds: number
}

export type AgentHibernationConfigResult = AiopsMutationResult<{
  config: AgentHibernationConfig
}>

export type ManagedAiSessionHibernateInput = {
  source?: AiAgentSessionSource
  sessionId: string
  reason?: string
  terminalSessionId?: string
}

export type ManagedAiSessionHibernateResult = AiopsMutationResult<{
  session: ManagedAiSessionRecord
  snapshot: ManagedAiSessionSnapshot
  config: AgentHibernationConfig
}>

export type ManagedAiSessionFocusRequest = {
  source?: AiAgentSessionSource
  sessionId?: string
  panelId?: string
  terminalSessionId?: string
}

export type ManagedAiNotificationRecord = {
  id: string
  source: AiAgentSessionSource
  sessionId: string
  title: string
  summary: string
  body: string
  state: ManagedAiSessionState
  event: AiAgentSessionEventName
  read: boolean
  isRead: boolean
  needsInput: boolean
  actionable?: boolean
  requestKind: ManagedAiRequestKind
  decisionMode: ManagedAiDecisionMode
  waitTimeoutMs?: number
  toolName?: string
  pendingRequestId?: string
  panelId?: string
  terminalSessionId?: string
  workspaceId?: string
  cwd?: string
  canonicalCwd?: string
  gitBranch?: string
  gitDirty?: boolean
  gitStatusUpdatedAt?: number
  transcriptPath?: string
  createdAt: number
  updatedAt: number
  lastActivityAt: number
  readAt?: number
}

export type ManagedAiNotificationListInput = {
  query?: string
  source?: AiAgentSessionSource
  unread?: boolean
  read?: boolean
  limit?: number
}

export type ManagedAiNotificationSelectorInput = {
  id?: string
  source?: AiAgentSessionSource
  sessionId?: string
}

export type ManagedAiNotificationMarkReadInput = ManagedAiNotificationSelectorInput & {
  all?: boolean
}

export type ManagedAiNotificationDismissInput = ManagedAiNotificationSelectorInput & {
  allRead?: boolean
  all_read?: boolean
}

export type ManagedAiNotificationOpenInput = ManagedAiNotificationSelectorInput

export type ManagedAiNotificationListResult = AiopsMutationResult<{
  notifications: ManagedAiNotificationRecord[]
  count: number
  total: number
  unreadCount: number
}>

export type ManagedAiNotificationMutationResult = AiopsMutationResult<{
  changed: number
  notification?: ManagedAiNotificationRecord
  notifications: ManagedAiNotificationRecord[]
  snapshot: ManagedAiSessionSnapshot
  focusRequest?: ManagedAiSessionFocusRequest
}>

export type ManagedAiNotificationClearResult = AiopsMutationResult<{
  changed: number
  notifications: ManagedAiNotificationRecord[]
  snapshot: ManagedAiSessionSnapshot
}>
