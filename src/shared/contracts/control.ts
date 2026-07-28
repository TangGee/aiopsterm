import type { AiopsAssetAuthType, AiopsAssetRecord } from './assets'
import type { AiopsMutationResult } from './common'
import type { AgentHibernationConfig, AiAgentSessionSource } from './managedAiSessions'

export type ControlTerminalSummary = {
  panelId: string
  panel_id?: string
  surfaceId?: string
  surface_id?: string
  terminalId?: string
  terminal_id?: string
  sessionId?: string
  session_id?: string
  terminalSessionId?: string
  terminal_session_id?: string
  title: string
  titleSource?: 'system' | 'user' | 'auto'
  title_source?: 'system' | 'user' | 'auto'
  kind: 'local' | 'ssh' | 'unknown'
  active: boolean
  connected: boolean
  status?: string
  cwd?: string
  shell?: string
  processId?: number
  processGroupId?: number
  host?: string
  port?: number
  username?: string
  assetId?: string
  assetName?: string
  cols?: number
  rows?: number
}

export type ControlSurfaceResumeBindingSummary = {
  name?: string
  kind?: string
  command: string
  cwd?: string
  checkpointId?: string
  checkpoint_id?: string
  source?: string
  environment?: Record<string, string>
  autoResume: boolean
  auto_resume?: boolean
  approvalPolicy?: string
  approval_policy?: string
  approvalRecordId?: string
  approval_record_id?: string
  trustedAt?: number
  trusted_at?: number
  trustReason?: string
  trust_reason?: string
  updatedAt: number
  updated_at?: number
}

export type ControlSurfaceTelemetrySummary = {
  ttyName?: string
  tty_name?: string
  shellState?: 'prompt' | 'running' | 'unknown'
  shell_state?: 'prompt' | 'running' | 'unknown'
  lastShellStateAt?: number
  last_shell_state_at?: number
  lastTtyAt?: number
  last_tty_at?: number
  lastPortsKickAt?: number
  last_ports_kick_at?: number
  lastPortsKickReason?: 'command' | 'refresh'
  last_ports_kick_reason?: 'command' | 'refresh'
}

export type ControlSurfaceSummary = {
  panelId: string
  panel_id?: string
  surfaceId?: string
  surface_id?: string
  title: string
  titleSource?: 'system' | 'user' | 'auto'
  title_source?: 'system' | 'user' | 'auto'
  surfaceKind: 'terminal' | 'knowledge' | 'managed-ai-session' | 'local-file'
  active: boolean
  status?: string
  cwd?: string
  sessionId?: string
  session_id?: string
  terminalSessionId?: string
  terminal_session_id?: string
  terminalKind?: ControlTerminalSummary['kind']
  connected?: boolean
  split?: 'right' | 'below'
  splitSourceId?: string
  splitGroupId?: string
  splitOrder?: number
  workspaceGroupId?: string
  workspaceGroupName?: string
  resumeBinding?: ControlSurfaceResumeBindingSummary
  resume_binding?: ControlSurfaceResumeBindingSummary
  telemetry?: ControlSurfaceTelemetrySummary
  knowledge?: {
    relPath: string
    isImage: boolean
    startLine?: number
    endLine?: number
  }
  managedAiSession?: {
    source: AiAgentSessionSource
    sessionId: string
  }
  localFile?: {
    filePath: string
  }
}

export type ControlSplitGroupSummary = {
  id: string
  panelIds: string[]
  count: number
  activePanelId?: string
  direction: 'right' | 'below' | 'mixed'
}

export type ControlWorkspaceGroupSummary = {
  id: string
  ref: string
  name: string
  anchorPanelId: string
  memberPanelIds: string[]
  memberCount: number
  collapsed: boolean
  pinned: boolean
  index: number
  createdAt: number
  updatedAt: number
  cwd?: string
  color?: string
  icon?: string
  active: boolean
}

export type ControlAgentTeamLaunchSource = 'codex' | 'claude-code' | 'custom'

export type ControlAgentTeamLaunchMember = {
  index: number
  source: ControlAgentTeamLaunchSource
  command: string
  panel: ControlSurfaceSummary
  terminal?: ControlTerminalSummary
  status: 'launched' | 'needs-approval' | 'failed'
  errorMessage?: string
}

export type ControlAgentTeamLaunchResult = {
  source: ControlAgentTeamLaunchSource
  cwd?: string
  requestedCount: number
  launchedCount: number
  approvalCount: number
  failedCount: number
  group: ControlWorkspaceGroupSummary
  members: ControlAgentTeamLaunchMember[]
  snapshot: ControlWorkspaceSnapshot
}

export type ControlNotificationRecord = {
  id: string
  title: string
  subtitle?: string
  body?: string
  level?: 'info' | 'success' | 'warning' | 'error' | 'approval' | 'done'
  group?: string
  key?: string
  action?: string
  url?: string
  read: boolean
  isRead: boolean
  createdAt: number
  updatedAt: number
  readAt?: number
  panelId?: string
  sessionId?: string
  terminalSessionId?: string
  workspaceId?: string
  source?: string
}

export type ControlAgentVaultDetectRule = {
  processName?: string
  argvContains?: string[]
  executableContains?: string
  commandContains?: string[]
}

export type ControlAgentVaultSessionIdSource =
  | { type: 'provided' }
  | { type: 'argvOption'; argvOption: string }
  | { type: 'env'; envVar: string }
  | { type: 'fixed'; value: string }
  | { type: 'piSessionFile' }

export type ControlAgentVaultEntry = {
  id: string
  name: string
  builtIn?: boolean
  description?: string
  executable?: string
  detect?: ControlAgentVaultDetectRule
  sessionIdSource?: ControlAgentVaultSessionIdSource
  launchCommand?: string
  resumeCommand?: string
  forkCommand?: string
  sessionDirectory?: string
  cwd?: 'preserve' | 'ignore'
  icon?: string
  createdAt: number
  updatedAt: number
}

export type ControlAgentVaultProcessSnapshot = {
  pid?: number
  ppid?: number
  pgid?: number
  processName?: string
  executable?: string
  argv: string[]
  commandLine?: string
  cwd?: string
  env?: Record<string, string>
  sessionId?: string
  sessionPath?: string
}

export type ControlAgentVaultIdentifyMatch = {
  agent: ControlAgentVaultEntry
  matched: true
  sessionId: string
  sessionPath?: string
  cwd?: string
  panelId?: string
  terminalSessionId?: string
  terminalTitle?: string
  terminalProcessId?: number
  process: Pick<ControlAgentVaultProcessSnapshot, 'pid' | 'ppid' | 'pgid' | 'processName' | 'executable' | 'argv'>
  canResume: boolean
  canFork: boolean
  resumeCommand?: string
  forkCommand?: string
}

export type ControlAiAttentionSummary = {
  id: string
  source: string
  kind: string
  title: string
  summary: string
  priority: number
  createdAt: number
  conversationId?: string
  sessionId?: string
  surfaceId?: string
  notificationId?: string
}

export type ControlManagedAiSessionSummary = {
  id: string
  source: string
  title: string
  summary: string
  state: string
  lastEvent: string
  lastActivityAt: number
  createdAt: number
  updatedAt: number
  needsInput: boolean
  requestKind?: string
  decisionMode?: string
  pendingRequestId?: string
  panelId?: string
  terminalSessionId?: string
  workspaceId?: string
  cwd?: string
  transcriptPath?: string
  toolName?: string
  launchCommand?: string
  resumeCommand?: string
  processId?: number
  parentProcessId?: number
  processGroupId?: number
  agentLifecycle?: string
  terminalProcessId?: number
  terminalActivityAt?: number
  hibernated?: boolean
  hibernatedAt?: number
  hibernationReason?: string
  hibernatedTerminalSessionId?: string
  eventCount: number
  decisionCount: number
}

export type ControlWorkspaceRemoteSummary = {
  configured: boolean
  state: 'local' | 'configured' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'unsupported'
  connectionState: string
  connection_state?: string
  displayTarget?: string
  display_target?: string
  remoteDisplayTarget?: string
  remote_display_target?: string
  surfaceId?: string
  surface_id?: string
  panelId?: string
  sessionId?: string
  session_id?: string
  terminalSessionId?: string
  terminal_session_id?: string
  transport?: string
  host?: string
  destination?: string
  port?: number
  username?: string
  assetId?: string
  assetName?: string
  proxyName?: string
  needProxy?: boolean
  foregroundAuthReadyAt?: number
  foreground_auth_ready_at?: number
  updatedAt?: number
  updated_at?: number
}

export type ControlWorkspaceSummary = {
  id: string
  title: string
  autoTitle?: string | null
  auto_title?: string | null
  titleSource?: 'system' | 'user' | 'auto'
  title_source?: 'system' | 'user' | 'auto'
  active: boolean
  mode: string
  activeModule: string
  activePanelId: string
  remoteDisplayTarget?: string | null
  remote_display_target?: string | null
  remoteConnectionState?: string
  remote_connection_state?: string
  remote?: ControlWorkspaceRemoteSummary | null
}

export type ControlWorkspaceSnapshot = {
  generatedAt: number
  mode: string
  activeModule: string
  activePanelId: string
  workspaces: ControlWorkspaceSummary[]
  terminals: ControlTerminalSummary[]
  surfaces: ControlSurfaceSummary[]
  splitGroups: ControlSplitGroupSummary[]
  workspaceGroups: ControlWorkspaceGroupSummary[]
  notifications: ControlNotificationRecord[]
  managedAiSessions: ControlManagedAiSessionSummary[]
  agentHibernation: AgentHibernationConfig
  remote?: ControlWorkspaceRemoteSummary | null
  workspaceEnvironment?: {
    keys: string[]
    count: number
    updatedAt?: number
  }
  workspace_environment?: {
    keys: string[]
    count: number
    updated_at?: number
  }
  attention: {
    unreadCount: number
    items: ControlAiAttentionSummary[]
    current?: ControlAiAttentionSummary
  }
  counts: {
    terminals: number
    connectedTerminals: number
    surfaces: number
    splitGroups: number
    workspaceGroups: number
    notifications: number
    unreadNotifications: number
    managedAiSessions: number
    managedAiNeedsInput: number
    attentionItems: number
  }
}

export type ControlSessionPanelSnapshot = {
  id: string
  title: string
  cwd?: string
  kind: 'terminal' | 'knowledge' | 'managed-ai-session'
  status?: string
  terminalKind?: ControlTerminalSummary['kind']
  split?: 'right' | 'below'
  splitSourceId?: string
  splitGroupId?: string
  splitOrder?: number
  sshSession?: {
    host: string
    port: number
    username: string
    assetId?: string
    assetName?: string
    assetType?: string
    organizationId?: string
    jumpHostId?: string
    authType?: string
    needProxy?: boolean
    proxyName?: string
    forkFromConnectionId?: string
  }
  knowledge?: {
    relPath: string
    isImage: boolean
    startLine?: number
    endLine?: number
  }
  managedAiSession?: {
    source: AiAgentSessionSource
    sessionId: string
  }
  resumeBinding?: ControlSurfaceResumeBindingSummary
}

export type ControlSessionSnapshot = {
  id: string
  name: string
  version: 1
  createdAt: number
  updatedAt: number
  activePanelId: string
  mode: string
  activeModule: string
  panels: ControlSessionPanelSnapshot[]
  workspaceGroups: Omit<ControlWorkspaceGroupSummary, 'ref' | 'memberCount' | 'active'>[]
  agentHibernation?: AgentHibernationConfig
  source?: string
}

export type ControlSessionRestoreResult = {
  snapshot: ControlWorkspaceSnapshot
  restoredSnapshot: ControlSessionSnapshot
  restoredPanels: number
  restoredWorkspaceGroups: number
  restoredResumeBindings: number
  launchedLocalTerminals: number
  skippedRemoteTerminals: number
}

export type ControlNotificationFocusRequest = {
  notification: ControlNotificationRecord
  panelId?: string
  sessionId?: string
  terminalSessionId?: string
}

export type ControlRequest = {
  id: string
  method: string
  params?: Record<string, unknown>
}

export type ControlResponse = AiopsMutationResult<Record<string, unknown>>

export type ControlRequestHandler = (request: ControlRequest) => Promise<ControlResponse> | ControlResponse

export type ExternalCodexMcpHost = {
  assetId: string
  name: string
  title: string
  host: string
  port: number
  username: string
  group?: string
  tags: string[]
  authType: AiopsAssetAuthType
  authMethods: string[]
  needProxy?: boolean
  proxyName?: string
  jumpHostId?: string
  jumpHostName?: string
  status?: AiopsAssetRecord['status']
}

export type ExternalCodexMcpConnection = {
  connectionId: string
  assetId: string
  owner: 'external_codex'
  visible: false
  status: 'connecting' | 'connected' | 'closed' | 'error'
  host: string
  port: number
  username: string
  title: string
  cwd?: string
  createdAt: number
  lastUsedAt: number
  errorMessage?: string
}

export type ExternalCodexMcpResponse<T extends Record<string, unknown> = Record<string, unknown>> = AiopsMutationResult<T> & {
  target?: Record<string, unknown>
}
