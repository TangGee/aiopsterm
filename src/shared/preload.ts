import type { AiopstermDeepLinkPayload } from './deepLink'
import type { AiopsMutationResult } from './contracts/common'
import type {
  CodexSessionCreateOptions,
  CodexSessionDataEvent,
  CodexSessionExitEvent,
  CodexSessionInfo,
  CodexSessionKillResult,
  CodexSessionLifecycleEvent,
  CodexSessionPendingContextResult,
  CodexSessionTargetContext,
  CodexSessionTargetUpdateResult,
  CodexSessionWriteResult
} from './contracts/codexSessions'
import type {
  TerminalBinaryWriteResult,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalDisconnectReason,
  TerminalExitEvent,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalKillResult,
  TerminalLifecycleEvent,
  TerminalLifecycleStage,
  TerminalSessionInfo,
  TerminalSshConnectionInfo,
  TerminalWriteResult
} from './contracts/terminalSessions'
import type {
  AiopsAssetAuthType,
  AiopsAssetConnectionTestInput,
  AiopsAssetConnectionTestResult,
  AiopsAssetEditableSecret,
  AiopsAssetExportInput,
  AiopsAssetExportResult,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupListInput,
  AiopsAssetGroupRecord,
  AiopsAssetGroupRenameInput,
  AiopsAssetImportConfirmInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewInput,
  AiopsAssetImportPreviewResult,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsAssetType,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsOrganizationAssetRefreshInput,
  AiopsOrganizationAssetRefreshResult,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelRecord,
  AiopsSshTunnelStartInput,
  AiopsSshTunnelStopInput
} from './contracts/assets'
import type {
  AiAgentSessionEvent,
  AiAgentSessionEventInput,
  AiAgentSessionEventResult,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiNotificationClearResult,
  ManagedAiNotificationDismissInput,
  ManagedAiNotificationListInput,
  ManagedAiNotificationListResult,
  ManagedAiNotificationMarkReadInput,
  ManagedAiNotificationMutationResult,
  ManagedAiNotificationOpenInput,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionClearInput,
  ManagedAiSessionEvent,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionHibernateInput,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRenameInput,
  ManagedAiSessionReplyInput
} from './contracts/managedAiSessions'
import type {
  AgentHookInstallerListResult,
  AgentHookInstallerOperationInput,
  AgentHookInstallerOperationResult
} from './contracts/agentHooks'
import type {
  ZmodemSavePathPickResult,
  ZmodemStreamCloseResult,
  ZmodemStreamOpenResult,
  ZmodemStreamWriteResult,
  ZmodemUploadPickResult
} from './contracts/zmodem'
import type {
  FileContentOptions,
  FileEntryMutation,
  FileEntryMutationResult,
  FileListEntry,
  FileListOptions,
  FileReadContentResult,
  FileSessionCatalogResult,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionMutationResult,
  FileSessionPatch,
  FileSessionSftpPayload,
  FileSessionTerminalContext,
  FileTransferOperation,
  FileTransferOperationResult,
  FileTransferTask,
  FileTransferTaskCancelInput,
  FileTransferTaskCancelResult,
  FileWriteContentResult
} from './contracts/files'
import type {
  AiopsTrustedDeviceRevokeResult,
  AiopsUserAccountResult,
  AiopsUserAvatarPrepareInput,
  AiopsUserAvatarPrepareResult,
  AiopsUserCodeInput,
  AiopsUserCodeResult,
  AiopsUserContactBindInput,
  AiopsUserDeactivateInput,
  AiopsUserExternalActionResult,
  AiopsUserLoginInput,
  AiopsUserMutationResult,
  AiopsUserPasswordInput,
  AiopsUserProfileUpdateInput
} from './contracts/userAccount'
import type {
  ExtensionInstallProgress,
  ExtensionPackageDownloadInput,
  ExtensionPackageDownloadResult,
  ExtensionPackageInstallInput,
  ExtensionPluginCancelResult,
  ExtensionPluginListResult,
  ExtensionPluginOperationInput,
  ExtensionPluginOperationResult,
  ExtensionPluginUrlInstallInput,
  ExtensionSubscriptionInput,
  ExtensionSubscriptionResult,
  ExtensionUserConfig
} from './contracts/extensions'
import type {
  QuickCommandGroupDeleteResult,
  QuickCommandGroupMutationResult,
  QuickCommandGroupSaveInput,
  QuickCommandMacroMutationResult,
  QuickCommandMacroSaveInput,
  QuickCommandReorderInput,
  QuickCommandReorderResult,
  QuickCommandScriptPlanInput,
  QuickCommandScriptPlanResult,
  QuickCommandSnippetDeleteResult,
  QuickCommandSnippetMutationResult,
  QuickCommandSnippetSaveInput,
  QuickCommandsUserConfig
} from './contracts/quickCommands'
import type {
  AliasCommandConfig,
  AliasCommandDeleteInput,
  AliasCommandDeleteResult,
  AliasCommandListResult,
  AliasCommandMutationResult,
  AliasCommandSaveInput
} from './contracts/aliases'
import type {
  McpConfigWriteResult,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallResult,
  McpToolStatesUserConfig
} from './contracts/mcp'
import type {
  SettingsPreferencesMutationResult,
  SettingsPreferencesResult,
  SettingsRuleDeleteResult,
  SettingsRuleSaveInput,
  SettingsShortcutSaveInput,
  ShortcutUserConfig,
  UserRuleConfig
} from './contracts/settingsPreferences'
import type {
  SkillContentResult,
  SkillDeleteResult,
  SkillEnabledResult,
  SkillExportResult,
  SkillImportResult,
  SkillMetadataConfig,
  SkillUserConfig,
  SkillWriteResult
} from './contracts/skills'
import type {
  KnowledgeBaseCreateResult,
  KnowledgeBaseDeleteResult,
  KnowledgeBaseEntry,
  KnowledgeBaseImportResult,
  KnowledgeBasePastedImageResult,
  KnowledgeBaseReadResult,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeBaseWriteResult
} from './contracts/knowledgeBase'

export type { AiopsMutationResult } from './contracts/common'
export type {
  CodexSessionCreateOptions,
  CodexSessionDataEvent,
  CodexSessionExitEvent,
  CodexSessionInfo,
  CodexSessionKillResult,
  CodexSessionLifecycleEvent,
  CodexSessionLifecycleStage,
  CodexSessionPendingContextResult,
  CodexSessionTargetContext,
  CodexSessionTargetUpdateResult,
  CodexSessionWriteResult
} from './contracts/codexSessions'
export type {
  TerminalBinaryWriteResult,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalDisconnectReason,
  TerminalExitEvent,
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalKillResult,
  TerminalLifecycleEvent,
  TerminalLifecycleStage,
  TerminalSessionInfo,
  TerminalSshConnectionInfo,
  TerminalWriteResult
} from './contracts/terminalSessions'
export type {
  AiopsAssetAuthType,
  AiopsAssetConnectionTestInfo,
  AiopsAssetConnectionTestInput,
  AiopsAssetConnectionTestResult,
  AiopsAssetEditableSecret,
  AiopsAssetExportInput,
  AiopsAssetExportPayload,
  AiopsAssetExportResult,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupListInput,
  AiopsAssetGroupRecord,
  AiopsAssetGroupRenameInput,
  AiopsAssetImportConfirmInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewInput,
  AiopsAssetImportPreviewRecord,
  AiopsAssetImportPreviewResult,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsAssetType,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType,
  AiopsOrganizationAssetRefreshInput,
  AiopsOrganizationAssetRefreshResult,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelRecord,
  AiopsSshTunnelStartInput,
  AiopsSshTunnelState,
  AiopsSshTunnelStopInput,
  AiopsSshTunnelType
} from './contracts/assets'
export type {
  AiAgentSessionEvent,
  AiAgentSessionEventInput,
  AiAgentSessionEventName,
  AiAgentSessionEventResult,
  AiAgentSessionSource,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiDecisionMode,
  ManagedAiNotificationClearResult,
  ManagedAiNotificationDismissInput,
  ManagedAiNotificationListInput,
  ManagedAiNotificationListResult,
  ManagedAiNotificationMarkReadInput,
  ManagedAiNotificationMutationResult,
  ManagedAiNotificationOpenInput,
  ManagedAiNotificationRecord,
  ManagedAiNotificationSelectorInput,
  ManagedAiRequestKind,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkOperation,
  ManagedAiSessionBulkResult,
  ManagedAiSessionClearInput,
  ManagedAiSessionDecision,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionEvent,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionHibernateInput,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionLifecycle,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionRenameInput,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot,
  ManagedAiSessionState,
  ManagedAiSessionTimelineEvent
} from './contracts/managedAiSessions'
export type {
  AgentHookInstallerListResult,
  AgentHookInstallerOperation,
  AgentHookInstallerOperationInput,
  AgentHookInstallerOperationResult,
  AgentHookInstallerSnapshot,
  AgentHookInstallerSource,
  AgentHookInstallerStatus
} from './contracts/agentHooks'
export type {
  ZmodemSavePathPickResult,
  ZmodemStreamCloseResult,
  ZmodemStreamOpenResult,
  ZmodemStreamWriteResult,
  ZmodemUploadFile,
  ZmodemUploadPickResult
} from './contracts/zmodem'
export type {
  FileContentOptions,
  FileEntryMutation,
  FileEntryMutationResult,
  FileListEntry,
  FileListOptions,
  FileReadContentResult,
  FileSessionCatalog,
  FileSessionCatalogResult,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionKind,
  FileSessionMutationResult,
  FileSessionPatch,
  FileSessionSftpPayload,
  FileSessionTerminalContext,
  FileTransferOperation,
  FileTransferOperationResult,
  FileTransferTask,
  FileTransferTaskCancelInput,
  FileTransferTaskCancelResult,
  FileWriteContentResult
} from './contracts/files'
export type {
  AiopsTrustedDevice,
  AiopsTrustedDeviceRevokeResult,
  AiopsUserAccountResult,
  AiopsUserAccountSnapshot,
  AiopsUserAvatarPrepareInput,
  AiopsUserAvatarPrepareResult,
  AiopsUserCodeInput,
  AiopsUserCodeResult,
  AiopsUserContactBindInput,
  AiopsUserDeactivateInput,
  AiopsUserExternalAction,
  AiopsUserExternalActionResult,
  AiopsUserLastLoginMethod,
  AiopsUserLoginInput,
  AiopsUserMutationResult,
  AiopsUserPasswordInput,
  AiopsUserProfile,
  AiopsUserProfileUpdateInput,
  AiopsUserRegistrationCode
} from './contracts/userAccount'
export type {
  ExtensionConnectionLogConfig,
  ExtensionFunctionConfig,
  ExtensionIconKey,
  ExtensionInstallProgress,
  ExtensionInstallStage,
  ExtensionPackageDownloadInput,
  ExtensionPackageDownloadResult,
  ExtensionPackageInstallInput,
  ExtensionPluginCancelResult,
  ExtensionPluginListResult,
  ExtensionPluginOperation,
  ExtensionPluginOperationInput,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig,
  ExtensionPluginSource,
  ExtensionPluginUrlInstallInput,
  ExtensionSubscriptionInput,
  ExtensionSubscriptionResult,
  ExtensionUserConfig
} from './contracts/extensions'
export type {
  QuickCommandGroupConfig,
  QuickCommandGroupDeleteResult,
  QuickCommandGroupMutationResult,
  QuickCommandGroupSaveInput,
  QuickCommandMacroEntryInput,
  QuickCommandMacroMutationResult,
  QuickCommandMacroSaveInput,
  QuickCommandReorderInput,
  QuickCommandReorderResult,
  QuickCommandScriptPlan,
  QuickCommandScriptPlanInput,
  QuickCommandScriptPlanResult,
  QuickCommandScriptSegment,
  QuickCommandSnippetConfig,
  QuickCommandSnippetDeleteResult,
  QuickCommandSnippetMutationResult,
  QuickCommandSnippetSaveInput,
  QuickCommandsUserConfig
} from './contracts/quickCommands'
export type {
  AliasCommandConfig,
  AliasCommandDeleteInput,
  AliasCommandDeleteResult,
  AliasCommandListResult,
  AliasCommandMutationResult,
  AliasCommandSaveInput
} from './contracts/aliases'
export type {
  McpConfigFile,
  McpConfigFileServer,
  McpConfigWriteResult,
  McpResourceConfig,
  McpResourceReadContent,
  McpResourceReadInput,
  McpResourceReadResult,
  McpServerStatus,
  McpServerUserConfig,
  McpToolCallContent,
  McpToolCallInput,
  McpToolCallResult,
  McpToolConfig,
  McpToolStatesUserConfig
} from './contracts/mcp'
export type {
  SettingsPreferencesMutationResult,
  SettingsPreferencesResult,
  SettingsPreferencesSnapshot,
  SettingsRuleDeleteResult,
  SettingsRuleSaveInput,
  SettingsShortcutSaveInput,
  ShortcutUserConfig,
  UserRuleConfig
} from './contracts/settingsPreferences'
export type {
  SkillContentResult,
  SkillDeleteResult,
  SkillEnabledResult,
  SkillExportResult,
  SkillImportErrorCode,
  SkillImportResult,
  SkillMetadataConfig,
  SkillUserConfig,
  SkillWriteResult
} from './contracts/skills'
export type {
  KnowledgeBaseCreateResult,
  KnowledgeBaseDeleteResult,
  KnowledgeBaseEntry,
  KnowledgeBaseImportResult,
  KnowledgeBaseMutationEntry,
  KnowledgeBaseNodeConfig,
  KnowledgeBasePastedImageInput,
  KnowledgeBasePastedImageResult,
  KnowledgeBaseReadResult,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeBaseWriteResult,
  KnowledgeNode,
  KnowledgeNodeType
} from './contracts/knowledgeBase'

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'

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
  surfaceKind: 'terminal' | 'knowledge'
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
  kind: 'terminal' | 'knowledge'
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

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

export type TerminalMouseEventAction = 'none' | 'paste' | 'contextMenu' | 'closeTab'

export type SshProxyType = 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5' | 'TCP'

export type SshProxyConfig = {
  name: string
  type: SshProxyType
  host: string
  port: number
  enableProxyIdentity: boolean
  username: string
  password: string
}

export type SshAgentKeyConfig = {
  id: string
  fingerprint: string
  comment: string
  keyType: string
  keyChainId: string
}

export type SshAgentKeychainOption = {
  key: string
  label: string
  fingerprint: string
  keyType: string
}

export type TerminalUserConfig = {
  terminalType: string
  fontFamily: string
  fontSize: number
  scrollBack: number
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
  lineHeight: number
  pinchZoomStatus: boolean
  showCloseButton: boolean
  sshAgentsStatus: boolean
  middleMouseEvent: TerminalMouseEventAction
  rightMouseEvent: Exclude<TerminalMouseEventAction, 'closeTab'>
}

export type WorkspaceUserConfig = {
  expandedGroups: string[]
  showIpMode: boolean
  recentAssetIds?: string[]
}

export type EditorUserConfig = {
  fontSize: number
  lineHeight: number
  fontFamily: string
  tabSize: number
  wordWrap: 'on' | 'off'
  minimap: boolean
  mouseWheelZoom: boolean
}

export type KeywordHighlightRuleConfig = {
  name: string
  enabled: boolean
  scope: 'output' | 'input' | 'both'
  matchType: 'regex' | 'wildcard'
  pattern: string | string[]
  style: {
    foreground: string
    fontStyle: 'bold' | 'normal'
  }
}

export type KeywordHighlightUserConfig = {
  'keyword-highlight': {
    enabled: boolean
    applyTo: {
      output: boolean
      input: boolean
    }
    rules: KeywordHighlightRuleConfig[]
  }
}

export type SecurityUserConfig = {
  security: {
    enableCommandSecurity: boolean
    enableStrictMode: boolean
    blacklistPatterns: string[]
    whitelistPatterns: string[]
    dangerousCommands: string[]
    maxCommandLength: number
    securityPolicy: {
      blockCritical: boolean
      askForMedium: boolean
      askForHigh: boolean
      askForBlacklist: boolean
    }
  }
}

export type KeywordHighlightConfigWriteResult = AiopsMutationResult<{
  keywordHighlight: KeywordHighlightUserConfig
}>

export type SecurityConfigWriteResult = AiopsMutationResult<{
  securityConfig: SecurityUserConfig
}>

export type PrivacyUserConfig = {
  telemetry: 'enabled' | 'disabled'
  secretRedaction: 'enabled' | 'disabled'
  dataSync: 'enabled' | 'disabled'
}

export type PrivacyRuntimeApplyInput = {
  previousPrivacy: PrivacyUserConfig
  nextPrivacy: PrivacyUserConfig
}

export type PrivacyRuntimeSnapshot = {
  telemetry: PrivacyUserConfig['telemetry']
  dataSync: PrivacyUserConfig['dataSync']
  appliedAt: string
  dataSyncRuntime: 'disabled' | 'service' | 'backend-double' | 'local-file'
  syncStatus?: 'disabled' | 'idle' | 'syncing' | 'synced' | 'error'
  syncRunId?: string
  syncedScopes?: Array<'config' | 'knowledge' | 'chat' | 'assets' | 'skills'>
  stateFilePath?: string
  lastSyncAt?: string
  errorMessage?: string
  message: string
}

export type PrivacyRuntimeApplyResult = AiopsMutationResult<PrivacyRuntimeSnapshot>

export type AiPreferencesUserConfig = {
  enableExtendedThinking: boolean
  thinkingBudgetTokens: number
  autoExecuteReadOnlyCommands: boolean
  commandOutputFilteringEnabled: boolean
  kbSearchEnabled: boolean
  experienceExtractionEnabled: boolean
  managedAiAutoNamingEnabled: boolean
  autoApproval: boolean
  reasoningEffort: 'low' | 'medium' | 'high'
  needProxy: boolean
  proxy: {
    type: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'
    host: string
    port: number
    enableProxyIdentity: boolean
    username: string
    password: string
  }
  shellIntegrationTimeout: number
}

export type NotificationUserConfig = {
  desktopNotifications: boolean
  controlNotificationBell: boolean
}

export type KnowledgeSearchRuntimeApplyInput = {
  previousEnabled: boolean
  nextEnabled: boolean
}

export type KnowledgeSearchRuntimeSnapshot = {
  enabled: boolean
  appliedAt: string
  source: 'settings'
  message: string
}

export type KnowledgeSearchRuntimeApplyResult = AiopsMutationResult<KnowledgeSearchRuntimeSnapshot>

export type ModelProviderUserConfig = {
  baseUrl: string
  apiKey: string
  modelId: string
  apiFormat?: 'chat-completions' | 'responses'
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
  awsRegion?: string
  awsUseCrossRegionInference?: boolean
  awsEndpointSelected?: boolean
  awsBedrockEndpoint?: string
}

export type ModelProviderCheckKey = 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama' | 'lmstudio'

export type ModelProviderCheckInput = {
  provider: ModelProviderCheckKey
  config: ModelProviderUserConfig
  timeoutMs?: number
}

export type ModelProviderCheckResult = AiopsMutationResult<{
  provider: ModelProviderCheckKey
  label: string
  modelId: string
  endpoint: string
  message: string
  durationMs: number
}>

export type AiModelCatalogOption = {
  id: string
  label: string
  detail: string
  displayName?: string
  checked?: boolean
  locked?: boolean
  tier?: string
  type?: 'standard' | 'custom'
  apiProvider?: string
}

export type AiModelCatalog = {
  chatModels: AiModelCatalogOption[]
  lockedChatModels: AiModelCatalogOption[]
  settingsModels: ModelOptionUserConfig[]
}

export type ModelOptionUserConfig = {
  name: string
  displayName?: string
  locked: boolean
  checked: boolean
  type?: 'standard' | 'custom'
  apiProvider?: string
}

export type ModelSettingsUserConfig = {
  addModelSwitch: boolean
  providers: {
    litellm: ModelProviderUserConfig
    openai: ModelProviderUserConfig
    bedrock: ModelProviderUserConfig
    deepseek: ModelProviderUserConfig
    anthropic: ModelProviderUserConfig
    ollama: ModelProviderUserConfig
    lmstudio: ModelProviderUserConfig
  }
  options: ModelOptionUserConfig[]
}

export type AiModelCatalogInput = {
  modelSettings?: ModelSettingsUserConfig
  localChatBackendAvailable?: boolean
}

export type FileDialogFilter = {
  name: string
  extensions: string[]
}

export type OpenDialogOptions = {
  defaultPath?: string
  properties: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory'>
  filters?: FileDialogFilter[]
}

export type OpenDialogResult = {
  canceled: boolean
  filePaths: string[]
}

export type SaveDialogOptions = {
  defaultPath?: string
  filters?: FileDialogFilter[]
}

export type SaveDialogResult = {
  canceled: boolean
  filePath?: string
}

export type LocalFileReadResult = {
  content: string
  mtimeMs: number
  size: number
}

export type LocalFileWriteResult = AiopsMutationResult<{
  filePath: string
  bytes: number
  size: number
  mtimeMs: number
}>

export type ChatAttachmentStageResult = {
  mode: 'local'
  taskId: string
  srcAbsPath: string
  refPath: string
  name: string
  size: number
  stagedPath: string
}

export type ChatImageAttachmentMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export type ChatImageAttachmentPrepareInput = {
  mediaType?: string
  data?: string
  name?: string
  size?: number
}

export type ChatImageAttachmentValidateInput = Omit<ChatImageAttachmentPrepareInput, 'data'>

export type ChatImageAttachmentFileInput = {
  filePath: string
  name?: string
}

export type ChatImageAttachmentClipboardInput = {
  name?: string
}

export type ChatImageAttachmentValidateResult = AiopsMutationResult<{
  mediaType: ChatImageAttachmentMediaType
  name?: string
  size: number
}>

export type ChatImageAttachmentPrepareResult = AiopsMutationResult<{
  type: 'image'
  mediaType: ChatImageAttachmentMediaType
  data: string
  name?: string
  size: number
}>

export type AppUpdateCheckResult = {
  available: boolean
  channel: 'local' | 'manual' | 'auto'
  isUpdateAvailable?: boolean
  versionInfo?: {
    version: string
    channel?: string
  }
  updateInfo?: {
    version: string
    channel?: string
    fileName?: string
    size?: number
    sha256?: string
    notes?: string
    signature?: {
      algorithm: 'ed25519' | 'rsa-sha256'
      verified: true
      keyId?: string
    }
  } | null
}

export type AppUpdateSignatureInfo = NonNullable<NonNullable<AppUpdateCheckResult['updateInfo']>['signature']>

export type AppUpdateProgressEvent = {
  status: 'downloading' | 'downloaded' | 'error'
  version: string
  percent: number
  message?: string
}

export type AppUpdateDownloadResult = AiopsMutationResult<{
  version: string
  status: 'downloaded'
  percent: 100
  filePath: string
  size: number
  sha256?: string
  signature?: AppUpdateSignatureInfo
  message: string
}>

export type AppUpdateInstallResult = AiopsMutationResult<{
  version: string
  status: 'install-requested'
  filePath: string
  size: number
  sha256?: string
  signature?: AppUpdateSignatureInfo
  handoff: {
    kind: 'os-open'
    accepted: true
  }
  requestedAt: string
  message: string
}>

export type OpenPathResult = {
  path: string
}

export type SettingsDocumentationPage =
  | 'general'
  | 'terminal'
  | 'extensions'
  | 'models'
  | 'billing'
  | 'ai'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'shortcuts'
  | 'trustedDevices'
  | 'privacy'
  | 'about'

export type OpenSettingsDocumentationInput = {
  page?: SettingsDocumentationPage
  locale?: string
  documentPath?: string
  basePath?: string
}

export type SettingsDocumentationResult = {
  path: string
  title: string
  content: string
}

export type CustomBackgroundSaveResult = {
  filePath: string
  url: string
  name: string
  size: number
  bytes: number
  mtimeMs: number
}

export type UserConfig = {
  language: string
  theme: string
  defaultMode: 'terminal' | 'agents'
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  agentsLeftOpen: boolean
  leftPanelWidth?: number
  rightPanelWidth?: number
  agentsLeftWidth?: number
  modelProvider: 'local' | 'litellm' | 'openai-compatible' | 'ollama' | 'lmstudio' | 'bedrock' | 'deepseek' | 'anthropic'
  modelEndpoint: string
  modelName: string
  watermark: 'open' | 'close'
  background: {
    mode: 'none' | 'preset' | 'custom'
    image: string
    opacity: number
    brightness: number
    lastCustomImage?: string
  }
  terminal?: TerminalUserConfig
  workspacePreferences?: WorkspaceUserConfig
  editorSettings?: EditorUserConfig
  sshProxyConfigs?: SshProxyConfig[]
  sshAgentKeys?: SshAgentKeyConfig[]
  extensionSettings?: ExtensionUserConfig
  keywordHighlight?: KeywordHighlightUserConfig
  securityConfig?: SecurityUserConfig
  privacy?: PrivacyUserConfig
  aiPreferences?: AiPreferencesUserConfig
  notifications?: NotificationUserConfig
  modelSettings?: ModelSettingsUserConfig
  shortcuts?: ShortcutUserConfig[]
  rules?: UserRuleConfig[]
  skills?: SkillUserConfig[]
  customInstructions?: string
  mcpServers?: McpServerUserConfig[]
  mcpToolStates?: McpToolStatesUserConfig
  quickCommands?: QuickCommandsUserConfig
  knowledgeBase?: KnowledgeBaseUserConfig
  aliasCommands?: AliasCommandConfig[]
  onboarding?: {
    version: number
    guideTabAutoOpened: boolean
    completedModules: Record<string, boolean>
  }
}

export type TerminalCommandSuggestion = {
  command: string
  source: 'base' | 'history' | 'ai'
  explanation?: string
}

export type TerminalCommandSuggestionContext = {
  panelId?: string
  host?: string
  shell?: string
  modelName?: string
  mode?: 'base' | 'ai'
}

export type TerminalCommandGenerationContext = {
  host: string
  username: string
  cwd: string
  shell: string
  connectionType: 'local' | 'ssh'
}

export type TerminalCommandGenerationInput = {
  panelId: string
  instruction: string
  modelName?: string
  context: TerminalCommandGenerationContext
}

export type TerminalCommandGenerationRecord = {
  id: string
  panelId: string
  instruction: string
  command: string
  modelName: string
  context: TerminalCommandGenerationContext
  status: 'done'
  createdAt: number
  provider: 'aiopsterm-local' | ModelProviderCheckKey
}

export type TerminalCommandGenerationResult = AiopsMutationResult<TerminalCommandGenerationRecord>

export type VoiceTranscriptionInput = {
  audioData?: string
  audioBytes?: ArrayBuffer | Uint8Array | number[]
  audioFormat?: string
  audioSize?: number
  durationMs?: number
  source?: 'browser'
}

export type VoiceTranscriptionProvider = 'aiopsterm-local' | ModelProviderCheckKey

export type VoiceTranscriptionResult = AiopsMutationResult<{
  text: string
  provider: VoiceTranscriptionProvider
  model?: string
}>

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

export type DatabaseEngineCode =
  | 'mysql'
  | 'mariadb'
  | 'oceanbase'
  | 'postgresql'
  | 'kingbase'
  | 'sqlite'
  | 'oracle'
  | 'sqlserver'
  | 'clickhouse'
  | 'presto'

export type DatabaseEngineOptionCode =
  | DatabaseEngineCode
  | 'h2'
  | 'clickhouse'
  | 'dm'
  | 'presto'
  | 'db2'
  | 'oceanbase'
  | 'hive'
  | 'kingbase'
  | 'mongodb'
  | 'timeplus'

export type DatabaseEngineInfo = {
  code: DatabaseEngineOptionCode
  connectionCode?: DatabaseEngineCode
  name: string
  enabled: boolean
  accent: string
}

export type DatabaseColumnInfo = {
  name: string
  type: string
  nullable: boolean
  key?: 'PK' | 'FK'
}

export type DatabaseTableInfo = {
  id: string
  name: string
  columns: DatabaseColumnInfo[]
  primaryKey: string[]
}

export type DatabaseSchemaInfo = {
  name: string
  tables: DatabaseTableInfo[]
  views?: DatabaseTableInfo[]
  functions?: string[]
  procedures?: string[]
}

export type DatabaseCatalogInfo = {
  name: string
  schemas?: DatabaseSchemaInfo[]
  tables?: DatabaseTableInfo[]
}

export type DatabaseConnectionInfo = {
  id: string
  name: string
  dbType: DatabaseEngineCode
  env: 'Development' | 'TEST' | 'Staging' | 'Production'
  groupId: string
  host: string
  port: number | null
  authentication: 'UserAndPassword'
  user: string
  hasPassword?: boolean
  database: string
  filePath?: string
  readonly?: boolean
  sslMode?: '' | 'disable' | 'require' | 'verify-ca' | 'verify-full'
  needProxy?: boolean
  proxyName?: string
  url?: string
  status: 'idle' | 'testing' | 'connected' | 'failed'
  catalogs: DatabaseCatalogInfo[]
}

export type DatabaseGroupInfo = {
  id: string
  name: string
}

export type DatabaseCatalogDefaults = {
  selectedNodeId: string | null
  expandedGroupIds: string[]
  expandedConnectionIds: string[]
  expandedCatalogIds: string[]
  expandedSchemaIds: string[]
  expandedSchemaObjectFolderIds: string[]
}

export type DatabaseWorkspaceCatalog = {
  engines: DatabaseEngineInfo[]
  groups: DatabaseGroupInfo[]
  groupParents: Record<string, string | null>
  connections: DatabaseConnectionInfo[]
  defaults: DatabaseCatalogDefaults
}

export type DatabaseCatalogResult = AiopsMutationResult<DatabaseWorkspaceCatalog>

export type DatabaseConnectionTestInput = {
  dbType: DatabaseEngineCode
  name: string
  host?: string
  port?: number | null
  user?: string
  password?: string
  database?: string
  filePath?: string
  readonly?: boolean
  sslMode?: string
  needProxy?: boolean
  proxyName?: string
  url?: string
}

export type DatabaseConnectionTestResult = AiopsMutationResult<{
  dbType: DatabaseEngineCode
  serverVersion: string
  endpoint: string
  durationMs: number
}>

export type DatabaseConnectionSaveInput = {
  mode: 'create' | 'edit'
  id?: string
  connection: DatabaseConnectionTestInput & {
    env?: DatabaseConnectionInfo['env']
    groupId?: string
    authentication?: DatabaseConnectionInfo['authentication']
  }
}

export type DatabaseConnectionSaveResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connection: DatabaseConnectionInfo
    message: string
  }
>

export type DatabaseGroupCreateInput = {
  name: string
  parentId?: string | null
}

export type DatabaseGroupUpdateInput = {
  id: string
  name?: string
  parentId?: string | null
}

export type DatabaseGroupMutationResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    group: DatabaseGroupInfo
    message: string
  }
>

export type DatabaseGroupDeleteResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    deletedGroupId: string
    message: string
  }
>

export type DatabaseConnectionMoveInput = {
  connectionId: string
  groupId?: string | null
}

export type DatabaseConnectionMutationResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connection: DatabaseConnectionInfo
    message: string
  }
>

export type DatabaseConnectionDeleteResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connectionId: string
    message: string
  }
>

export type DatabaseCreateDatabaseInput = {
  connectionId: string
  sql: string
  requestedName?: string
}

export type DatabaseCreateDatabaseResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connection: DatabaseConnectionInfo
    catalog: DatabaseCatalogInfo
    message: string
  }
>

export type DatabaseSqlExecuteInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  sql: string
  databaseName?: string
  schemaName?: string
}

export type DatabaseSqlExecutionRecord = {
  id: string
  status: 'ok' | 'error'
  message: string
  durationMs: number
  rowCount: number
  createdAt: string
}

export type DatabaseSqlExecuteResult = AiopsMutationResult<{
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  execution: DatabaseSqlExecutionRecord
}> & {
  execution?: DatabaseSqlExecutionRecord
}

export type DatabaseTableDdlInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  databaseName: string
  schemaName?: string
  tableName: string
}

export type DatabaseTableDdlResult = AiopsMutationResult<{
  ddl: string
}>

export type DatabaseColumnFilter =
  | { column: string; operator: 'like' | 'eq' | 'neq'; value?: string; values?: string[] }
  | { column: string; operator: 'in'; values?: string[]; value?: string }
  | { column: string; operator: 'isnull' | 'notnull'; value?: string; values?: string[] }

export type DatabaseColumnSort = { column: string; direction: 'asc' | 'desc' }

export type DatabaseTableQueryInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  databaseName: string
  schemaName?: string
  tableName: string
  filters?: DatabaseColumnFilter[]
  sort?: DatabaseColumnSort | null
  whereRaw?: string | null
  orderByRaw?: string | null
  page: number
  pageSize: number
  withTotal?: boolean
}

export type DatabaseTableQueryResult = AiopsMutationResult<{
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  total: number | null
  knownColumns: string[]
}>

export type DatabaseTableMutation =
  | { kind: 'delete'; rowKey: string; primaryKey: string[]; originalRow?: Record<string, unknown> }
  | { kind: 'update'; rowKey: string; primaryKey: string[]; patch: Record<string, unknown>; originalRow?: Record<string, unknown> }
  | { kind: 'insert'; values: Record<string, unknown> }
  | { kind: 'truncate' }
  | { kind: 'drop' }

export type DatabaseTableMutationInput = {
  connectionId: string
  databaseName: string
  schemaName?: string
  tableName: string
  mutations: DatabaseTableMutation[]
}

export type DatabaseTableMutationResult = AiopsMutationResult<{
  affected: number
  durationMs: number
  catalog?: DatabaseWorkspaceCatalog
}>

export type DatabaseTableMutationPlanInput = DatabaseTableMutationInput & {
  dbType?: DatabaseEngineCode
  columns?: string[]
  knownColumns?: string[]
}

export type DatabaseTableMutationPlanStatement = {
  kind: DatabaseTableMutation['kind']
  sql: string
  params: unknown[]
  preview: string
}

export type DatabaseTableMutationPlanResult = AiopsMutationResult<{
  statements: DatabaseTableMutationPlanStatement[]
  statementCount: number
  preview: string
  warning: string
}>

export type DatabaseExportInput = {
  title: string
  kind: 'sql-result' | 'table-page'
  columns: string[]
  rows: Array<Record<string, unknown>>
  metadata?: {
    connectionName?: string
    databaseName?: string
    schemaName?: string
    tableName?: string
    sql?: string
    page?: number
    pageSize?: number
    total?: number | null
  }
}

export type DatabaseExportResult = AiopsMutationResult<{
  exported: number
  fileName: string
  filePath?: string
  bytes?: number
  canceled?: boolean
  csv?: string
}>

export type DatabasePageCommentScope = 'sql-result' | 'table-page'

export type DatabasePageCommentKey = {
  scope: DatabasePageCommentScope
  connectionId: string
  databaseName: string
  schemaName?: string
  tableName?: string
  resultId?: string
  sql?: string
}

export type DatabasePageCommentRecord = DatabasePageCommentKey & {
  comment: string
  updatedAt: number
}

export type DatabasePageCommentGetResult = AiopsMutationResult<{
  record: DatabasePageCommentRecord
}>

export type DatabasePageCommentSaveInput = {
  key: DatabasePageCommentKey
  comment: string
}

export type DatabasePageCommentSaveResult = AiopsMutationResult<{
  record: DatabasePageCommentRecord
  message: string
}>

export type DatabaseAiPaneMessageInput = {
  role: 'user' | 'assistant'
  content: string
}

export type DatabaseAiPaneMessageRecord = {
  id: string
  requestId: string
  role: 'user' | 'assistant'
  status: 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'
  content: string
  contextSummary: string
  createdAt: number
  updatedAt: number
}

export type DatabaseAiPaneStateContext = {
  connectionId: string
  catalogName: string
  schemaName: string
  dbType: DatabaseEngineCode | ''
}

export type DatabaseAiPaneStateSnapshot = {
  open: boolean
  width: number
  context: DatabaseAiPaneStateContext
  draft: string
  messages: DatabaseAiPaneMessageRecord[]
}

export type DatabaseAiPaneStateResult = AiopsMutationResult<DatabaseAiPaneStateSnapshot>

export type DatabaseAiPaneResponseInput = {
  requestId?: string
  assistantMessageId?: string
  prompt: string
  context: {
    connectionId: string
    dbType?: DatabaseEngineCode | ''
    databaseName: string
    schemaName?: string
    contextSummary?: string
  }
  activeSql?: string
  messages?: DatabaseAiPaneMessageInput[]
}

export type DatabaseAiPaneRequestInput = DatabaseAiPaneResponseInput

export type DatabaseAiPaneRequestResult = AiopsMutationResult<{
  requestId: string
  userMessage: DatabaseAiPaneMessageRecord
  assistantMessage: DatabaseAiPaneMessageRecord
}>

export type DatabaseAiPaneLifecycleInput = {
  requestId: string
  assistantMessageId?: string
}

export type DatabaseAiPaneLifecycleResult = AiopsMutationResult<{
  assistantMessage: DatabaseAiPaneMessageRecord
}>

export type DatabaseAiResponseProvider = 'aiopsterm-local' | ModelProviderCheckKey

export type DatabaseAiPaneResponseResult = AiopsMutationResult<{
  requestId: string
  assistantMessage: DatabaseAiPaneMessageRecord
  text: string
  provider: DatabaseAiResponseProvider
  durationMs: number
}>

export type DatabaseAiDrawerAction = 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete' | 'diagnose' | 'drop' | 'truncate'

export type DatabaseAiTargetDialect = DatabaseEngineCode | 'mssql'

export type DatabaseAiDrawerResponseInput = {
  requestId?: string
  action: DatabaseAiDrawerAction
  sourceSql: string
  targetDialect?: DatabaseAiTargetDialect
  context: {
    connectionId?: string
    dbType?: DatabaseEngineCode | ''
    databaseName?: string
    schemaName?: string
    tableName?: string
    contextSummary?: string
  }
  errorMessage?: string
}

export type DatabaseAiDrawerRequestRecord = {
  id: string
  action: DatabaseAiDrawerAction
  label: string
  status: 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'
  contextSummary: string
  sourceSql: string
  text: string
  targetDialect: DatabaseAiTargetDialect
  backendContext: DatabaseAiDrawerResponseInput['context']
  createdAt: number
  updatedAt: number
}

export type DatabaseAiDrawerRequestInput = DatabaseAiDrawerResponseInput

export type DatabaseAiDrawerRequestResult = AiopsMutationResult<DatabaseAiDrawerRequestRecord>

export type DatabaseAiDrawerLifecycleInput = {
  requestId: string
}

export type DatabaseAiDrawerLifecycleResult = AiopsMutationResult<DatabaseAiDrawerRequestRecord>

export type DatabaseAiDrawerResponseResult = AiopsMutationResult<{
  request: DatabaseAiDrawerRequestRecord
  text: string
  reasoning: string
  sql: string
  provider: DatabaseAiResponseProvider
  durationMs: number
}>

export type DatabaseSqlErrorDiagnosisInput = {
  requestId?: string
  sourceSql: string
  targetDialect?: DatabaseAiTargetDialect
  context: DatabaseAiDrawerResponseInput['context']
  errorMessage: string
}

export type DatabaseSqlErrorDiagnosisResult = DatabaseAiDrawerResponseResult

export type KubernetesConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export type KubernetesClusterSource = 'local' | 'jumpserver'

export type KubernetesContextInfo = {
  name: string
  cluster: string
  namespace: string
  server: string
  isActive: boolean
}

export type KubernetesClusterRecord = {
  id: string
  name: string
  kubeconfig_path: string | null
  kubeconfig_content: string | null
  context_name: string
  server_url: string
  auth_type: string
  is_active: number
  connection_status: KubernetesConnectionStatus
  auto_connect: number
  default_namespace: string
  created_at: string
  updated_at: string
  source_type: KubernetesClusterSource
  bastion_uuid: string | null
  bastion_asset_address: string | null
  bastion_asset_name: string | null
  bastion_asset_id_last: number | null
}

export type KubernetesClusterInput = {
  name: string
  contextName: string
  serverUrl: string
  defaultNamespace?: string
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
  sourceType?: KubernetesClusterSource
  bastionUuid?: string | null
  authType?: string
  autoConnect?: boolean
}

export type KubernetesClusterUpdateInput = {
  name?: string
  defaultNamespace?: string
  autoConnect?: boolean
}

export type KubernetesClusterTestInput = {
  contextName: string
  serverUrl?: string
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
}

export type KubernetesClusterTestResult = AiopsMutationResult<{
  success: boolean
  isValid: boolean
  contextName: string
  serverUrl: string
  message: string
  command?: string
  output?: string
  error?: string
  durationMs?: number
}>

export type KubernetesImportContextInfo = {
  name: string
  cluster: string
  server: string
  namespace: string
}

export type KubernetesKubeconfigImportInput = {
  requestId?: string | null
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
}

export type KubernetesKubeconfigImportResult = AiopsMutationResult<{
  requestId: string
  contexts: KubernetesImportContextInfo[]
  kubeconfigPath: string
  kubeconfigContent: string
  currentContext: string
}>

export type KubernetesBastionGroup = {
  uuid: string
  label: string
  ip: string
}

export type KubernetesResourceKind = 'pods' | 'deployments' | 'services' | 'nodes'

export type KubernetesNamespaceInfo = {
  id: string
  clusterId: string
  name: string
  status: string
  age: string
}

export type KubernetesResource = {
  id: string
  clusterId: string
  kind: KubernetesResourceKind
  name: string
  namespace: string
  status: string
  ready: string
  age: string
  detail: string
  node?: string
  image?: string
  ports?: string
  restarts?: number
  selector?: string
}

export type KubernetesResourceAction = 'get' | 'describe' | 'logs'

export type KubernetesResourceActionInput = {
  resourceId: string
  action?: KubernetesResourceAction
}

export type KubernetesResourceActionPlanResult = AiopsMutationResult<{
  resourceId: string
  resourceName: string
  resourceKind: KubernetesResourceKind
  action: KubernetesResourceAction
  title: string
  command: string
  clusterId: string
  clusterName: string
  contextName: string
  namespace: string
}>

export type KubernetesProxyType = 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'

export type KubernetesAgentProxyConfig = {
  enabled: boolean
  type: KubernetesProxyType
  host: string
  port: number
  enableProxyIdentity: boolean
  username: string
  password: string
  updatedAt: string
}

export type KubernetesAgentProxyConfigInput = Partial<Omit<KubernetesAgentProxyConfig, 'updatedAt'>>

export type KubernetesAgentProxyConfigResult = AiopsMutationResult<{
  proxyConfig: KubernetesAgentProxyConfig
  message: string
}>

export type KubernetesCatalog = {
  contexts: KubernetesContextInfo[]
  currentContext: string
  clusters: KubernetesClusterRecord[]
  bastions: KubernetesBastionGroup[]
  namespaces: KubernetesNamespaceInfo[]
  resources: KubernetesResource[]
  importContexts: KubernetesImportContextInfo[]
  activeClusterId: string | null
  selectedClusterId: string | null
  agentProxyConfig: KubernetesAgentProxyConfig
}

export type KubernetesCatalogResult = AiopsMutationResult<KubernetesCatalog>
export type KubernetesClusterMutationResult = AiopsMutationResult<KubernetesCatalog & { cluster?: KubernetesClusterRecord }>
export type KubernetesContextSwitchResult = AiopsMutationResult<KubernetesCatalog & { currentContext: string }>
export type KubernetesBastionSyncResult = AiopsMutationResult<KubernetesCatalog & { syncedCount: number; updatedCount: number }>

export type KubernetesTerminalStatus = 'connecting' | 'connected' | 'ended' | 'error'

export type KubernetesTerminalCreateInput = {
  clusterId: string
  namespace?: string
  cols?: number
  rows?: number
}

export type KubernetesTerminalRecord = {
  id: string
  sessionId: string
  clusterId: string
  name: string
  namespace: string
  output: string
  status: KubernetesTerminalStatus
  cols: number
  rows: number
  createdAt: string
  updatedAt: string
}

export type KubernetesTerminalCreateResult = AiopsMutationResult<KubernetesTerminalRecord>
export type KubernetesTerminalMutationResult = AiopsMutationResult<KubernetesTerminalRecord>
export type KubernetesTerminalCloseResult = AiopsMutationResult<KubernetesTerminalRecord & { exitCode: number }>
export type KubernetesTerminalWriteData = {
  id: string
  sessionId: string
  bytes: number
  command: string
  output: string
  success: boolean
  error: string
  terminalOutput: string
  updatedAt: string
}
export type KubernetesTerminalWriteResult = AiopsMutationResult<KubernetesTerminalWriteData>
export type KubernetesTerminalDataEvent = {
  id: string
  sessionId: string
  clusterId: string
  data: string
  command: string
  output: string
  success: boolean
  error: string
  emittedAt: string
}
export type KubernetesTerminalExitEvent = {
  id: string
  sessionId: string
  clusterId: string
  exitCode: number
  reason: 'closed' | 'disconnect' | 'error'
  error?: string
  emittedAt: string
}

export type KubernetesCommandInput = {
  command: string
  clusterId?: string
  clusterName?: string
  contextName?: string
  namespace?: string
  defaultNamespace?: string
  source?: 'terminal' | 'agent' | 'resource'
}

export type KubernetesCommandResult = AiopsMutationResult<{
  runId: string
  command: string
  output: string
  terminalOutput: string
  success: boolean
  error: string
  durationMs: number
  startedAt: string
  clusterId: string
  contextName: string
  namespace: string
  source: 'terminal' | 'agent' | 'resource'
}>

export type KubernetesResourceActionExecuteResult = AiopsMutationResult<
  NonNullable<KubernetesCommandResult['data']> & {
    resourceId: string
    resourceName: string
    resourceKind: KubernetesResourceKind
    action: KubernetesResourceAction
    title: string
  }
>

export type KubernetesResourceRefreshInput = {
  clusterId: string
  namespace?: string
  kind?: KubernetesResourceKind | 'all'
}

export type KubernetesResourceRefreshResult = AiopsMutationResult<
  KubernetesCatalog & {
    runId: string
    refreshedClusterId: string
    refreshedKind: KubernetesResourceKind | 'all'
    clusterId: string
    contextName: string
    namespace: string
    command: string
    output: string
    terminalOutput: string
    success: boolean
    error: string
    durationMs: number
    startedAt: string
    source: 'resource'
    refreshedResources: number
    refreshedNamespaces: number
    message: string
  }
>

export type KubernetesAgentCleanupResult = AiopsMutationResult<{
  cleared: boolean
  cleanedAt: string
}>

export type AiopsPreloadApi = {
  getPathForFile: (file: File) => string
  platform: () => Promise<string>
  shell: () => Promise<string>
  checkUpdate: () => Promise<AppUpdateCheckResult>
  downloadAppUpdate: (version: string) => Promise<AppUpdateDownloadResult>
  installAppUpdate: (version?: string) => Promise<AppUpdateInstallResult>
  onAppUpdateProgress: (listener: (event: AppUpdateProgressEvent) => void) => () => void
  listChatConversations: () => Promise<AiChatHistoryListResult>
  createChatConversation: () => Promise<AiChatConversationMutationResult>
  updateChatConversation: (input: AiChatConversationUpdateInput) => Promise<AiChatConversationMutationResult>
  deleteChatConversation: (id: string) => Promise<AiChatConversationDeleteResult>
  restoreChatConversation: (id: string) => Promise<AiChatConversationRestoreResult>
  saveChatMessageMetadata: (input: AiChatMessageMetadataInput) => Promise<AiChatMessageMetadataResult>
  approveAiMcpToolCall: (input: AiMcpToolCallActionInput) => Promise<AiMcpToolCallActionResult>
  rejectAiMcpToolCall: (input: AiMcpToolCallActionInput) => Promise<AiMcpToolCallActionResult>
  approveAiMcpResourceAccess: (input: AiMcpResourceAccessActionInput) => Promise<AiMcpResourceAccessActionResult>
  rejectAiMcpResourceAccess: (input: AiMcpResourceAccessActionInput) => Promise<AiMcpResourceAccessActionResult>
  exportChat: (input: AiChatExportInput) => Promise<AiChatExportResult>
  listAiTodoSnapshot: () => Promise<AiTodoSnapshotResult>
  listAiContextCatalog: () => Promise<AiContextCatalogResult>
  listAiCommandCatalog: () => Promise<AiCommandCatalogResult>
  getUserAccount: () => Promise<AiopsUserAccountResult>
  openUserLogin: () => Promise<AiopsUserExternalActionResult>
  openUserAccountCenter: () => Promise<AiopsUserExternalActionResult>
  loginUserAccount: (input: AiopsUserLoginInput) => Promise<AiopsUserMutationResult>
  logoutUserAccount: () => Promise<AiopsUserMutationResult>
  skipUserLogin: () => Promise<AiopsUserMutationResult>
  sendUserLoginCode: (input: AiopsUserCodeInput) => Promise<AiopsUserCodeResult>
  prepareUserAvatarImage: (input: AiopsUserAvatarPrepareInput) => Promise<AiopsUserAvatarPrepareResult>
  updateUserProfile: (input: AiopsUserProfileUpdateInput) => Promise<AiopsUserMutationResult>
  resetUserPassword: (input: AiopsUserPasswordInput) => Promise<AiopsUserMutationResult>
  sendUserContactCode: (input: AiopsUserCodeInput) => Promise<AiopsUserCodeResult>
  bindUserContact: (input: AiopsUserContactBindInput) => Promise<AiopsUserMutationResult>
  deactivateUserAccount: (input: AiopsUserDeactivateInput) => Promise<AiopsUserMutationResult>
  revokeTrustedDevice: (id: number) => Promise<AiopsTrustedDeviceRevokeResult>
  getProtocolPrefix: () => Promise<string>
  handleProtocolUrl: (url: string) => Promise<{ success: boolean; reason?: string; payload?: AiopstermDeepLinkPayload }>
  consumeDeepLinks: () => Promise<AiopstermDeepLinkPayload[]>
  onDeepLink: (listener: (payload: AiopstermDeepLinkPayload) => void) => () => void
  openExternalUrl: (url: string) => Promise<void>
  openSettingsDocumentation: (input?: OpenSettingsDocumentationInput) => Promise<SettingsDocumentationResult>
  submitSettingsFeedbackReport: () => Promise<OpenPathResult>
  openLogDir: () => Promise<OpenPathResult>
  writeRuntimeLog?: (level: RuntimeLogLevel, event: string, fields?: Record<string, unknown>) => Promise<AiopsMutationResult<{ event: string }>>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  unmaximizeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  closeWindow: () => Promise<void>
  onMaximized: (listener: () => void) => () => void
  onUnmaximized: (listener: () => void) => () => void
  getConfig: () => Promise<UserConfig>
  saveConfig: (patch: Partial<UserConfig>) => Promise<UserConfig>
  applyPrivacyRuntimeSettings: (input: PrivacyRuntimeApplyInput) => Promise<PrivacyRuntimeApplyResult>
  applyKnowledgeSearchRuntimeSetting: (input: KnowledgeSearchRuntimeApplyInput) => Promise<KnowledgeSearchRuntimeApplyResult>
  getSettingsPreferences: () => Promise<SettingsPreferencesResult>
  saveSettingsRule: (input: SettingsRuleSaveInput) => Promise<SettingsPreferencesMutationResult>
  deleteSettingsRule: (id: string) => Promise<SettingsRuleDeleteResult>
  saveSettingsShortcut: (input: SettingsShortcutSaveInput) => Promise<SettingsPreferencesMutationResult>
  resetSettingsShortcuts: () => Promise<SettingsPreferencesMutationResult>
  getSecurityConfigPath: () => Promise<string>
  readSecurityConfig: () => Promise<string>
  writeSecurityConfig: (content: string) => Promise<SecurityConfigWriteResult>
  onSecurityConfigFileChanged: (listener: (content: string) => void) => () => void
  getKeywordHighlightConfigPath: () => Promise<string>
  readKeywordHighlightConfig: () => Promise<string>
  writeKeywordHighlightConfig: (content: string) => Promise<KeywordHighlightConfigWriteResult>
  onKeywordHighlightConfigFileChanged: (listener: (content: string) => void) => () => void
  getMcpConfigPath: () => Promise<string>
  getMcpServers: () => Promise<McpServerUserConfig[]>
  readMcpConfig: () => Promise<string>
  writeMcpConfig: (content: string) => Promise<McpConfigWriteResult>
  toggleMcpServer: (serverName: string, disabled: boolean) => Promise<McpConfigWriteResult>
  deleteMcpServer: (serverName: string) => Promise<McpConfigWriteResult>
  setMcpToolState: (serverName: string, toolName: string, enabled: boolean) => Promise<McpConfigWriteResult>
  setMcpToolAutoApprove: (serverName: string, toolName: string, autoApprove: boolean) => Promise<McpConfigWriteResult>
  callMcpTool: (serverName: string, toolName: string, args?: Record<string, unknown>) => Promise<McpToolCallResult>
  readMcpResource: (serverName: string, uri: string) => Promise<McpResourceReadResult>
  onMcpConfigFileChanged: (listener: (content: string) => void) => () => void
  getSkills: () => Promise<SkillUserConfig[]>
  getEnabledSkills: () => Promise<SkillUserConfig[]>
  setSkillEnabled: (skillName: string, enabled: boolean) => Promise<SkillEnabledResult>
  getSkillsUserPath: () => Promise<string>
  reloadSkills: () => Promise<SkillUserConfig[]>
  createSkill: (metadata: SkillMetadataConfig, content: string) => Promise<SkillWriteResult>
  deleteSkill: (skillName: string) => Promise<SkillDeleteResult>
  openSkillsFolder: () => Promise<OpenPathResult>
  importSkillZip: (zipPath: string, overwrite?: boolean) => Promise<SkillImportResult>
  readSkillContent: (skillName: string) => Promise<SkillContentResult>
  updateSkill: (skillName: string, metadata: SkillMetadataConfig, content: string) => Promise<SkillWriteResult>
  exportSkillZip: (skillName: string) => Promise<SkillExportResult>
  onSkillsUpdate: (listener: (skills: SkillUserConfig[]) => void) => () => void
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogResult | undefined>
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult | undefined>
  saveCustomBackground: (srcAbsPath: string) => Promise<CustomBackgroundSaveResult>
  readLocalFile: (filePath: string) => Promise<LocalFileReadResult>
  writeLocalFile: (filePath: string, content: string) => Promise<LocalFileWriteResult>
  stageChatAttachment: (payload: { taskId: string; srcAbsPath: string }) => Promise<ChatAttachmentStageResult>
  validateChatImageAttachment: (input: ChatImageAttachmentValidateInput) => Promise<ChatImageAttachmentValidateResult>
  prepareChatImageAttachment: (input: ChatImageAttachmentPrepareInput) => Promise<ChatImageAttachmentPrepareResult>
  prepareChatImageAttachmentFromFile: (input: ChatImageAttachmentFileInput) => Promise<ChatImageAttachmentPrepareResult>
  prepareChatImageAttachmentFromClipboard: (input?: ChatImageAttachmentClipboardInput) => Promise<ChatImageAttachmentPrepareResult>
  kbCheckPath: (absPath: string) => Promise<{ exists: boolean; isDirectory: boolean; isFile: boolean }>
  kbEnsureRoot: () => Promise<{ success: boolean }>
  kbGetRoot: () => Promise<{ root: string }>
  kbListDir: (relDir: string) => Promise<KnowledgeBaseEntry[]>
  kbReadFile: (relPath: string, encoding?: 'utf-8' | 'base64') => Promise<KnowledgeBaseReadResult>
  kbWriteFile: (relPath: string, content: string, encoding?: 'utf-8' | 'base64') => Promise<KnowledgeBaseWriteResult>
  kbPasteImageFromClipboard: (relDir?: string, name?: string) => Promise<KnowledgeBasePastedImageResult>
  kbMkdir: (relDir: string, name: string) => Promise<KnowledgeBaseCreateResult>
  kbCreateFile: (relDir: string, name: string, content?: string) => Promise<KnowledgeBaseCreateResult>
  kbRename: (relPath: string, newName: string) => Promise<KnowledgeBaseCreateResult>
  kbDelete: (relPath: string, recursive?: boolean) => Promise<KnowledgeBaseDeleteResult>
  kbMove: (srcRelPath: string, dstRelDir: string) => Promise<KnowledgeBaseCreateResult>
  kbCopy: (srcRelPath: string, dstRelDir: string) => Promise<KnowledgeBaseCreateResult>
  kbImportFile: (srcAbsPath: string, dstRelDir: string) => Promise<KnowledgeBaseImportResult>
  kbImportFolder: (srcAbsPath: string, dstRelDir: string) => Promise<KnowledgeBaseImportResult>
  kbSearch: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<KnowledgeBaseSearchResult[]>
  kbSearchStatus: () => Promise<KnowledgeBaseSearchStatus>
  kbReindex: () => Promise<{ files: number; chunks: number }>
  onKbTransferProgress: (listener: (event: KnowledgeBaseTransferProgress) => void) => () => void
  listAssets: () => Promise<AiopsAssetSnapshot>
  listAssetGroups: (input?: AiopsAssetGroupListInput) => Promise<AiopsAssetGroupRecord[]>
  renameAssetGroup: (input: AiopsAssetGroupRenameInput) => Promise<AiopsMutationResult<AiopsAssetSnapshot>>
  deleteAssetGroup: (input: AiopsAssetGroupDeleteInput) => Promise<AiopsMutationResult<AiopsAssetSnapshot>>
  saveAsset: (asset: AiopsAssetInput) => Promise<AiopsMutationResult<AiopsAssetRecord>>
  getAssetEditableSecret: (id: string) => Promise<AiopsMutationResult<AiopsAssetEditableSecret>>
  testAssetConnection: (input: AiopsAssetConnectionTestInput) => Promise<AiopsAssetConnectionTestResult>
  deleteAsset: (id: string) => Promise<AiopsMutationResult<{ id: string }>>
  refreshOrganizationAssets: (input?: AiopsOrganizationAssetRefreshInput) => Promise<AiopsOrganizationAssetRefreshResult>
  previewAssetImport: (input: AiopsAssetImportPreviewInput) => Promise<AiopsAssetImportPreviewResult>
  confirmAssetImport: (input: AiopsAssetImportConfirmInput) => Promise<AiopsAssetImportConfirmResult>
  exportAssets: (input: AiopsAssetExportInput) => Promise<AiopsAssetExportResult>
  startSshTunnel: (input: AiopsSshTunnelStartInput) => Promise<AiopsSshTunnelMutationResult>
  stopSshTunnel: (input: AiopsSshTunnelStopInput) => Promise<AiopsSshTunnelMutationResult>
  saveAssetFolder: (folder: AiopsCustomFolderSaveInput) => Promise<AiopsMutationResult<AiopsCustomFolderRecord>>
  deleteAssetFolder: (uuid: string) => Promise<AiopsMutationResult<{ uuid: string }>>
  listKeychains: () => Promise<AiopsKeychainRecord[]>
  listSshAgentKeychainOptions: () => Promise<SshAgentKeychainOption[]>
  getKeychain: (id: string) => Promise<AiopsKeychainRecord | null>
  saveKeychain: (keychain: AiopsKeychainInput) => Promise<AiopsMutationResult<AiopsKeychainRecord>>
  deleteKeychain: (id: string) => Promise<AiopsMutationResult<{ id: string }>>
  getQuickCommands: () => Promise<QuickCommandsUserConfig>
  saveQuickCommandGroup: (input: QuickCommandGroupSaveInput) => Promise<QuickCommandGroupMutationResult>
  deleteQuickCommandGroup: (uuid: string) => Promise<QuickCommandGroupDeleteResult>
  saveQuickCommandSnippet: (input: QuickCommandSnippetSaveInput) => Promise<QuickCommandSnippetMutationResult>
  saveQuickCommandMacro: (input: QuickCommandMacroSaveInput) => Promise<QuickCommandMacroMutationResult>
  deleteQuickCommandSnippet: (id: number) => Promise<QuickCommandSnippetDeleteResult>
  reorderQuickCommands: (input: QuickCommandReorderInput) => Promise<QuickCommandReorderResult>
  planQuickCommandScript: (input: QuickCommandScriptPlanInput) => Promise<QuickCommandScriptPlanResult>
  listAliasCommands: (query?: string) => Promise<AliasCommandListResult>
  saveAliasCommand: (input: AliasCommandSaveInput) => Promise<AliasCommandMutationResult>
  deleteAliasCommand: (input: AliasCommandDeleteInput) => Promise<AliasCommandDeleteResult>
  createTerminal: (options?: TerminalCreateOptions) => Promise<TerminalSessionInfo>
  writeTerminal: (id: string, data: string) => Promise<TerminalWriteResult>
  writeTerminalBinary: (id: string, data: number[] | Uint8Array | ArrayBuffer) => Promise<TerminalBinaryWriteResult>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<TerminalKillResult>
  createCodexSession: (options?: CodexSessionCreateOptions) => Promise<CodexSessionInfo>
  setCodexSessionTarget: (target?: CodexSessionTargetContext) => Promise<CodexSessionTargetUpdateResult>
  setCodexSessionPendingContext: (id: string, text?: string) => Promise<CodexSessionPendingContextResult>
  writeCodexSession: (id: string, data: string) => Promise<CodexSessionWriteResult>
  resizeCodexSession: (id: string, cols: number, rows: number) => Promise<void>
  killCodexSession: (id: string) => Promise<CodexSessionKillResult>
  listAgentHookInstallers: () => Promise<AgentHookInstallerListResult>
  installAgentHook: (input: AgentHookInstallerOperationInput) => Promise<AgentHookInstallerOperationResult>
  uninstallAgentHook: (input: AgentHookInstallerOperationInput) => Promise<AgentHookInstallerOperationResult>
  listManagedAiSessions: () => Promise<ManagedAiSessionListResult>
  getAgentHibernationConfig: () => Promise<AgentHibernationConfigResult>
  setAgentHibernationConfig: (input: Partial<AgentHibernationConfig> & { enabled?: boolean }) => Promise<AgentHibernationConfigResult>
  hibernateManagedAiSession: (input: ManagedAiSessionHibernateInput) => Promise<ManagedAiSessionHibernateResult>
  wakeManagedAiSession: (input: ManagedAiSessionHibernateInput) => Promise<ManagedAiSessionHibernateResult>
  replyManagedAiSession: (input: ManagedAiSessionReplyInput) => Promise<ManagedAiSessionMutationResult>
  renameManagedAiSession: (input: ManagedAiSessionRenameInput) => Promise<ManagedAiSessionMutationResult>
  clearManagedAiSession: (input: ManagedAiSessionClearInput) => Promise<ManagedAiSessionMutationResult>
  bulkManagedAiSessions: (input: ManagedAiSessionBulkInput) => Promise<ManagedAiSessionBulkResult>
  listManagedAiNotifications: (input?: ManagedAiNotificationListInput) => Promise<ManagedAiNotificationListResult>
  markManagedAiNotificationRead: (input: ManagedAiNotificationMarkReadInput) => Promise<ManagedAiNotificationMutationResult>
  dismissManagedAiNotification: (input: ManagedAiNotificationDismissInput) => Promise<ManagedAiNotificationMutationResult>
  clearManagedAiNotifications: () => Promise<ManagedAiNotificationClearResult>
  openManagedAiNotification: (input: ManagedAiNotificationOpenInput) => Promise<ManagedAiNotificationMutationResult>
  jumpToUnreadManagedAiNotification: () => Promise<ManagedAiNotificationMutationResult>
  invokeControlRequest: (method: string, params?: Record<string, unknown>) => Promise<ControlResponse>
  respondControlRequest: (id: string, response: ControlResponse) => void
  onControlRequest: (listener: ControlRequestHandler) => () => void
  respondTerminalKeyboardInteractive: (id: string, response: string[] | TerminalKeyboardInteractiveResponse) => void
  cancelTerminalKeyboardInteractive: (id: string) => void
  pickZmodemUploadFiles: () => Promise<ZmodemUploadPickResult>
  pickZmodemSavePath: (name: string) => Promise<ZmodemSavePathPickResult>
  openZmodemStream: (savePath: string) => Promise<ZmodemStreamOpenResult>
  writeZmodemChunk: (streamId: string, chunk: number[] | Uint8Array | ArrayBuffer) => Promise<ZmodemStreamWriteResult>
  closeZmodemStream: (streamId: string) => Promise<ZmodemStreamCloseResult>
  getTerminalCommandSuggestions: (query: string, context?: TerminalCommandSuggestionContext) => Promise<TerminalCommandSuggestion[]>
  generateTerminalCommand: (input: TerminalCommandGenerationInput) => Promise<TerminalCommandGenerationResult>
  listAiModels: (input?: AiModelCatalogInput) => Promise<AiModelCatalog>
  checkModelProvider: (input: ModelProviderCheckInput) => Promise<ModelProviderCheckResult>
  listExtensionPlugins: () => Promise<ExtensionPluginListResult>
  installExtensionPlugin: (input: ExtensionPluginOperationInput) => Promise<ExtensionPluginOperationResult>
  updateExtensionPlugin: (input: ExtensionPluginOperationInput) => Promise<ExtensionPluginOperationResult>
  installExtensionPackage: (input: ExtensionPackageInstallInput) => Promise<ExtensionPluginOperationResult>
  downloadExtensionPackage: (input: ExtensionPackageDownloadInput) => Promise<ExtensionPackageDownloadResult>
  installExtensionPluginFromUrl: (input: ExtensionPluginUrlInstallInput) => Promise<ExtensionPluginOperationResult>
  uninstallExtensionPlugin: (input: ExtensionPluginOperationInput) => Promise<ExtensionPluginOperationResult>
  openExtensionSubscription: (input: ExtensionSubscriptionInput) => Promise<ExtensionSubscriptionResult>
  cancelExtensionInstall: (pluginId: string) => Promise<ExtensionPluginCancelResult>
  onExtensionInstallProgress: (listener: (event: ExtensionInstallProgress) => void) => () => void
  createAiChatExchangeRequest: (input: AiChatExchangeRequestInput) => Promise<AiChatExchangeRequestResult>
  generateAiChatResponse: (input: AiChatResponseInput) => Promise<AiChatResponseResult>
  cancelAiChatResponse: (input: AiChatCancelInput) => Promise<AiChatCancelResult>
  transcribeVoiceInput: (input?: VoiceTranscriptionInput) => Promise<VoiceTranscriptionResult>
  testDatabaseConnection: (input: DatabaseConnectionTestInput) => Promise<DatabaseConnectionTestResult>
  saveDatabaseConnection: (input: DatabaseConnectionSaveInput) => Promise<DatabaseConnectionSaveResult>
  createDatabaseGroup: (input: DatabaseGroupCreateInput) => Promise<DatabaseGroupMutationResult>
  renameDatabaseGroup: (input: DatabaseGroupUpdateInput) => Promise<DatabaseGroupMutationResult>
  moveDatabaseGroup: (input: DatabaseGroupUpdateInput) => Promise<DatabaseGroupMutationResult>
  deleteDatabaseGroup: (id: string) => Promise<DatabaseGroupDeleteResult>
  moveDatabaseConnection: (input: DatabaseConnectionMoveInput) => Promise<DatabaseConnectionMutationResult>
  removeDatabaseConnection: (connectionId: string) => Promise<DatabaseConnectionDeleteResult>
  connectDatabaseConnection: (connectionId: string) => Promise<DatabaseConnectionMutationResult>
  disconnectDatabaseConnection: (connectionId: string) => Promise<DatabaseConnectionMutationResult>
  refreshDatabaseConnection: (connectionId: string) => Promise<DatabaseConnectionMutationResult>
  createDatabaseCatalog: (input: DatabaseCreateDatabaseInput) => Promise<DatabaseCreateDatabaseResult>
  listDatabaseCatalog: () => Promise<DatabaseCatalogResult>
  executeDatabaseSql: (input: DatabaseSqlExecuteInput) => Promise<DatabaseSqlExecuteResult>
  getDatabaseTableDdl: (input: DatabaseTableDdlInput) => Promise<DatabaseTableDdlResult>
  queryDatabaseTable: (input: DatabaseTableQueryInput) => Promise<DatabaseTableQueryResult>
  planDatabaseTableMutation: (input: DatabaseTableMutationPlanInput) => Promise<DatabaseTableMutationPlanResult>
  mutateDatabaseTable: (input: DatabaseTableMutationInput) => Promise<DatabaseTableMutationResult>
  exportDatabaseRows: (input: DatabaseExportInput) => Promise<DatabaseExportResult>
  getDatabasePageComment: (input: DatabasePageCommentKey) => Promise<DatabasePageCommentGetResult>
  saveDatabasePageComment: (input: DatabasePageCommentSaveInput) => Promise<DatabasePageCommentSaveResult>
  getDatabaseAiPaneState: () => Promise<DatabaseAiPaneStateResult>
  saveDatabaseAiPaneState: (input: DatabaseAiPaneStateSnapshot) => Promise<DatabaseAiPaneStateResult>
  createDatabaseAiPaneRequest: (input: DatabaseAiPaneRequestInput) => Promise<DatabaseAiPaneRequestResult>
  startDatabaseAiPaneResponse: (input: DatabaseAiPaneLifecycleInput) => Promise<DatabaseAiPaneLifecycleResult>
  cancelDatabaseAiPaneResponse: (input: DatabaseAiPaneLifecycleInput) => Promise<DatabaseAiPaneLifecycleResult>
  generateDatabaseAiPaneResponse: (input: DatabaseAiPaneResponseInput) => Promise<DatabaseAiPaneResponseResult>
  createDatabaseAiDrawerRequest: (input: DatabaseAiDrawerRequestInput) => Promise<DatabaseAiDrawerRequestResult>
  startDatabaseAiDrawerResponse: (input: DatabaseAiDrawerLifecycleInput) => Promise<DatabaseAiDrawerLifecycleResult>
  cancelDatabaseAiDrawerResponse: (input: DatabaseAiDrawerLifecycleInput) => Promise<DatabaseAiDrawerLifecycleResult>
  generateDatabaseAiDrawerResponse: (input: DatabaseAiDrawerResponseInput) => Promise<DatabaseAiDrawerResponseResult>
  diagnoseDatabaseSqlError: (input: DatabaseSqlErrorDiagnosisInput) => Promise<DatabaseSqlErrorDiagnosisResult>
  listKubernetesCatalog: () => Promise<KubernetesCatalogResult>
  switchKubernetesContext: (contextName: string) => Promise<KubernetesContextSwitchResult>
  addKubernetesCluster: (input: KubernetesClusterInput) => Promise<KubernetesClusterMutationResult>
  updateKubernetesCluster: (id: string, input: KubernetesClusterUpdateInput) => Promise<KubernetesClusterMutationResult>
  testKubernetesClusterConnection: (input: KubernetesClusterTestInput) => Promise<KubernetesClusterTestResult>
  importKubernetesKubeconfig: (input: KubernetesKubeconfigImportInput) => Promise<KubernetesKubeconfigImportResult>
  deleteKubernetesCluster: (id: string) => Promise<KubernetesClusterMutationResult>
  connectKubernetesCluster: (id: string) => Promise<KubernetesClusterMutationResult>
  disconnectKubernetesCluster: (id: string) => Promise<KubernetesClusterMutationResult>
  syncKubernetesBastion: (bastionUuid: string) => Promise<KubernetesBastionSyncResult>
  createKubernetesTerminal: (input: KubernetesTerminalCreateInput) => Promise<KubernetesTerminalCreateResult>
  writeKubernetesTerminal: (id: string, data: string) => Promise<KubernetesTerminalWriteResult>
  resizeKubernetesTerminal: (id: string, cols: number, rows: number) => Promise<KubernetesTerminalMutationResult>
  closeKubernetesTerminal: (id: string, exitCode?: number) => Promise<KubernetesTerminalCloseResult>
  executeKubernetesCommand: (input: KubernetesCommandInput) => Promise<KubernetesCommandResult>
  planKubernetesResourceAction: (input: KubernetesResourceActionInput) => Promise<KubernetesResourceActionPlanResult>
  executeKubernetesResourceAction: (input: KubernetesResourceActionInput) => Promise<KubernetesResourceActionExecuteResult>
  refreshKubernetesResources: (input: KubernetesResourceRefreshInput) => Promise<KubernetesResourceRefreshResult>
  getKubernetesAgentProxyConfig: () => Promise<KubernetesAgentProxyConfigResult>
  saveKubernetesAgentProxyConfig: (input: KubernetesAgentProxyConfigInput) => Promise<KubernetesAgentProxyConfigResult>
  cleanupKubernetesAgent: () => Promise<KubernetesAgentCleanupResult>
  listFileSessionCatalog: () => Promise<FileSessionCatalogResult>
  saveFileSession: (session: FileSessionInfo) => Promise<FileSessionMutationResult>
  saveFileSessionFromSftpPayload: (payload: FileSessionSftpPayload) => Promise<FileSessionMutationResult>
  saveFileSessionFromTerminalContext: (context: FileSessionTerminalContext) => Promise<FileSessionMutationResult>
  updateFileSession: (id: string, patch: FileSessionPatch) => Promise<FileSessionMutationResult>
  deleteFileSession: (id: string) => Promise<FileSessionCatalogResult>
  saveFileSessionFolder: (folder: FileSessionFolderSaveInput) => Promise<FileSessionFolderMutationResult>
  deleteFileSessionFolder: (uuid: string) => Promise<FileSessionFolderDeleteResult>
  listFiles: (directory: string, options?: FileListOptions) => Promise<FileListEntry[]>
  readFileContent: (filePath: string, options?: FileContentOptions) => Promise<FileReadContentResult>
  writeFileContent: (filePath: string, content: string, options?: FileContentOptions) => Promise<FileWriteContentResult>
  mutateFileEntry: (mutation: FileEntryMutation, options?: FileListOptions) => Promise<FileEntryMutationResult>
  transferFileEntry: (operation: FileTransferOperation, options?: FileListOptions) => Promise<FileTransferOperationResult>
  cancelFileTransferTask: (input: FileTransferTaskCancelInput) => Promise<FileTransferTaskCancelResult>
  listFileTransferTasks: () => Promise<FileTransferTask[]>
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => () => void
  onTerminalLifecycle: (listener: (event: TerminalLifecycleEvent) => void) => () => void
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => () => void
  publishAiAgentSessionEvent: (input: AiAgentSessionEventInput) => Promise<AiAgentSessionEventResult>
  onAiAgentSessionEvent: (listener: (event: AiAgentSessionEvent) => void) => () => void
  onManagedAiSessionEvent: (listener: (event: ManagedAiSessionEvent) => void) => () => void
  onManagedAiSessionFocusRequest: (listener: (request: ManagedAiSessionFocusRequest) => void) => () => void
  onCodexSessionData: (listener: (event: CodexSessionDataEvent) => void) => () => void
  onCodexSessionLifecycle: (listener: (event: CodexSessionLifecycleEvent) => void) => () => void
  onCodexSessionExit: (listener: (event: CodexSessionExitEvent) => void) => () => void
  onTerminalKeyboardInteractiveRequest: (listener: (event: TerminalKeyboardInteractiveRequest) => void) => () => void
  onTerminalKeyboardInteractiveResult: (listener: (event: TerminalKeyboardInteractiveResult) => void) => () => void
  onKubernetesTerminalData: (listener: (event: KubernetesTerminalDataEvent) => void) => () => void
  onKubernetesTerminalExit: (listener: (event: KubernetesTerminalExitEvent) => void) => () => void
}
