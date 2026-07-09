import type { AiopstermDeepLinkPayload } from '../deepLink'
import type { AiopsMutationResult } from './common'
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
} from './codexSessions'
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
} from './terminalSessions'
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
} from './assets'
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
} from './managedAiSessions'
import type {
  ManagedAiSessionContentListInput,
  ManagedAiSessionContentListResult,
  ManagedAiSessionContentRecordInput,
  ManagedAiSessionContentRecordResult,
  ManagedAiSessionContentUpdateInput,
  ManagedAiSessionContentUpdateResult
} from './managedAiSessionContent'
import type {
  AgentHookInstallerListResult,
  AgentHookInstallerOperationInput,
  AgentHookInstallerOperationResult
} from './agentHooks'
import type {
  ExportMcpCopyConfigInput,
  ExportMcpCopyConfigResult,
  ExportMcpInstallerListResult,
  ExportMcpInstallerOperationInput,
  ExportMcpInstallerOperationResult,
  ExportMcpTokenResetResult
} from './exportMcp'
import type {
  ZmodemSavePathPickResult,
  ZmodemStreamCloseResult,
  ZmodemStreamOpenResult,
  ZmodemStreamWriteResult,
  ZmodemUploadPickResult
} from './zmodem'
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
  FileTransferTaskEvent,
  FileWriteContentResult
} from './files'
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
} from './userAccount'
import type { UserConfig } from './userConfig'
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
} from './extensions'
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
} from './quickCommands'
import type {
  AliasCommandConfig,
  AliasCommandDeleteInput,
  AliasCommandDeleteResult,
  AliasCommandListResult,
  AliasCommandMutationResult,
  AliasCommandSaveInput
} from './aliases'
import type {
  McpConfigWriteResult,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallResult,
  McpToolStatesUserConfig
} from './mcp'
import type {
  SettingsPreferencesMutationResult,
  SettingsPreferencesResult,
  SettingsRuleDeleteResult,
  SettingsRuleSaveInput,
  SettingsShortcutSaveInput,
  ShortcutUserConfig,
  UserRuleConfig
} from './settingsPreferences'
import type {
  SkillContentResult,
  SkillDeleteResult,
  SkillEnabledResult,
  SkillExportResult,
  SkillImportResult,
  SkillMetadataConfig,
  SkillUserConfig,
  SkillWriteResult
} from './skills'
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
} from './knowledgeBase'
import type {
  AiModelCatalog,
  AiModelCatalogInput,
  AiPreferencesUserConfig,
  AppUpdateCheckResult,
  AppUpdateDownloadResult,
  AppUpdateInstallResult,
  AppUpdateProgressEvent,
  CustomBackgroundSaveResult,
  CustomNotificationSoundSaveResult,
  EditorUserConfig,
  ExportMcpUserConfig,
  KeywordHighlightConfigWriteResult,
  KeywordHighlightUserConfig,
  KnowledgeSearchRuntimeApplyInput,
  KnowledgeSearchRuntimeApplyResult,
  ModelProviderCheckInput,
  ModelProviderCheckResult,
  ModelSettingsUserConfig,
  NotificationUserConfig,
  OpenPathResult,
  OpenSettingsDocumentationInput,
  PrivacyRuntimeApplyInput,
  PrivacyRuntimeApplyResult,
  PrivacyUserConfig,
  RuntimeLogLevel,
  SecurityConfigWriteResult,
  SecurityUserConfig,
  SettingsDocumentationResult,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  TerminalUserConfig,
  WorkspaceUserConfig
} from './appRuntime'
import type {
  VoiceTranscriptionInput,
  VoiceTranscriptionResult
} from './voice'
import type {
  ChatAttachmentStageResult,
  ChatImageAttachmentClipboardInput,
  ChatImageAttachmentFileInput,
  ChatImageAttachmentPrepareInput,
  ChatImageAttachmentPrepareResult,
  ChatImageAttachmentValidateInput,
  ChatImageAttachmentValidateResult,
  LocalFileReadResult,
  LocalFileWriteResult,
  OpenDialogOptions,
  OpenDialogResult,
  SaveDialogOptions,
  SaveDialogResult
} from './localFiles'
import type {
  ControlRequest,
  ControlRequestHandler,
  ControlResponse
} from './control'
import type {
  AiChatCancelInput,
  AiChatCancelResult,
  AiChatConversationDeleteResult,
  AiChatConversationMutationResult,
  AiChatConversationRestoreResult,
  AiChatConversationUpdateInput,
  AiChatExchangeRequestInput,
  AiChatExchangeRequestResult,
  AiChatExportInput,
  AiChatExportResult,
  AiChatHistoryListResult,
  AiChatMessageMetadataInput,
  AiChatMessageMetadataResult,
  AiChatResponseInput,
  AiChatResponseResult,
  AiCommandCatalogResult,
  AiContextCatalogResult,
  AiMcpResourceAccessActionInput,
  AiMcpResourceAccessActionResult,
  AiMcpToolCallActionInput,
  AiMcpToolCallActionResult,
  AiTodoSnapshotResult
} from './aiChat'
import type {
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneStateResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseCatalogResult,
  DatabaseConnectionDeleteResult,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseCreateDatabaseInput,
  DatabaseCreateDatabaseResult,
  DatabaseExportInput,
  DatabaseExportResult,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  DatabasePageCommentGetResult,
  DatabasePageCommentKey,
  DatabasePageCommentSaveInput,
  DatabasePageCommentSaveResult,
  DatabaseSqlErrorDiagnosisInput,
  DatabaseSqlErrorDiagnosisResult,
  DatabaseSqlExecuteInput,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './database'
import type {
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext
} from './terminalTools'
import type {
  KubernetesAgentCleanupResult,
  KubernetesAgentProxyConfigInput,
  KubernetesAgentProxyConfigResult,
  KubernetesBastionSyncResult,
  KubernetesCatalogResult,
  KubernetesClusterInput,
  KubernetesClusterMutationResult,
  KubernetesClusterTestInput,
  KubernetesClusterTestResult,
  KubernetesClusterUpdateInput,
  KubernetesCommandInput,
  KubernetesCommandResult,
  KubernetesContextSwitchResult,
  KubernetesKubeconfigImportInput,
  KubernetesKubeconfigImportResult,
  KubernetesResourceActionExecuteResult,
  KubernetesResourceActionInput,
  KubernetesResourceActionPlanResult,
  KubernetesResourceRefreshInput,
  KubernetesResourceRefreshResult,
  KubernetesTerminalCloseResult,
  KubernetesTerminalCreateInput,
  KubernetesTerminalCreateResult,
  KubernetesTerminalDataEvent,
  KubernetesTerminalExitEvent,
  KubernetesTerminalMutationResult,
  KubernetesTerminalWriteResult
} from './kubernetes'

export type AiopsPreloadApi = {
  getPathForFile: (file: File) => string
  runtimeEnv?: () => Record<string, string | undefined>
  platform: () => Promise<string>
  shell: () => Promise<string>
  getGpuFeatureStatus?: () => Promise<Record<string, unknown>>
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
  newWindow: () => Promise<void>
  toggleFullScreen: () => Promise<boolean>
  setBadgeCount?: (count: number) => Promise<boolean>
  setBadgeState?: (input: { count: number; activeKeys: string[] }) => Promise<boolean>
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
  saveCustomNotificationSound: (srcAbsPath: string) => Promise<CustomNotificationSoundSaveResult>
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
  ackTerminalData: (id: string, bytes: number) => void
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
  listExportMcpInstallers: () => Promise<ExportMcpInstallerListResult>
  installExportMcp: (input: ExportMcpInstallerOperationInput) => Promise<ExportMcpInstallerOperationResult>
  uninstallExportMcp: (input: ExportMcpInstallerOperationInput) => Promise<ExportMcpInstallerOperationResult>
  copyExportMcpConfig: (input: ExportMcpCopyConfigInput) => Promise<ExportMcpCopyConfigResult>
  resetExportMcpToken: () => Promise<ExportMcpTokenResetResult>
  listManagedAiSessions: () => Promise<ManagedAiSessionListResult>
  getAgentHibernationConfig: () => Promise<AgentHibernationConfigResult>
  setAgentHibernationConfig: (input: Partial<AgentHibernationConfig> & { enabled?: boolean }) => Promise<AgentHibernationConfigResult>
  hibernateManagedAiSession: (input: ManagedAiSessionHibernateInput) => Promise<ManagedAiSessionHibernateResult>
  wakeManagedAiSession: (input: ManagedAiSessionHibernateInput) => Promise<ManagedAiSessionHibernateResult>
  replyManagedAiSession: (input: ManagedAiSessionReplyInput) => Promise<ManagedAiSessionMutationResult>
  renameManagedAiSession: (input: ManagedAiSessionRenameInput) => Promise<ManagedAiSessionMutationResult>
  clearManagedAiSession: (input: ManagedAiSessionClearInput) => Promise<ManagedAiSessionMutationResult>
  bulkManagedAiSessions: (input: ManagedAiSessionBulkInput) => Promise<ManagedAiSessionBulkResult>
  listManagedAiSessionContent: (input: ManagedAiSessionContentListInput) => Promise<ManagedAiSessionContentListResult>
  getManagedAiSessionContentRecord: (input: ManagedAiSessionContentRecordInput) => Promise<ManagedAiSessionContentRecordResult>
  updateManagedAiSessionContentRecord: (input: ManagedAiSessionContentUpdateInput) => Promise<ManagedAiSessionContentUpdateResult>
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
  onFileTransferTaskEvent: (listener: (event: FileTransferTaskEvent) => void) => () => void
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
