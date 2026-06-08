import type { AiopstermDeepLinkPayload } from './deepLink'

export type TerminalCreateOptions = {
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
  kind?: 'local' | 'ssh'
  assetId?: string
  title?: string
  ssh?: {
    host: string
    port?: number
    username: string
    password?: string
    privateKey?: string
    passphrase?: string
    forkFromConnectionId?: string
  }
}

export type TerminalSshConnectionInfo = {
  connectionId: string
  host: string
  port: number
  username: string
  assetId?: string
  assetName: string
  assetType?: string
  organizationId?: string
  authType?: string
  title?: string
  createdAt: number
  forkFromConnectionId?: string
}

export type TerminalSessionInfo = {
  id: string
  shell: string
  cwd: string
  kind?: 'local' | 'ssh'
  connection?: TerminalSshConnectionInfo
}

export type TerminalWriteResult = AiopsMutationResult<{
  id: string
  bytes: number
}>

export type TerminalKillResult = AiopsMutationResult<{
  id: string
}>

export type TerminalDataEvent = {
  id: string
  data: string
}

export type TerminalExitEvent = {
  id: string
  code: number | null
}

export type AiopsAssetType = 'person' | 'organization' | 'switch'

export type AiopsAssetAuthType = 'password' | 'keyBased'

export type AiopsAssetRecord = {
  id: string
  uuid: string
  name: string
  title: string
  host: string
  ip: string
  group: string
  group_name: string
  status: 'online' | 'offline' | 'unknown'
  tags: string[]
  username: string
  port: number
  asset_type: AiopsAssetType
  auth_type: AiopsAssetAuthType
  comment: string
  data_source: 'manual' | 'refresh' | 'import'
  favorite?: boolean
  folderUuid?: string
  organizationId?: string
  tunnelState?: 'created' | 'active'
  needProxy?: boolean
  proxyName?: string
  keychainId?: string
  hasPassword?: boolean
  hasPrivateKey?: boolean
  isLocalShell?: boolean
}

export type AiopsAssetGroupRecord = {
  key: string
  name: string
  count: number
}

export type AiopsAssetGroupListInput = {
  assetTypes?: AiopsAssetType[]
}

export type AiopsAssetGroupRenameInput = AiopsAssetGroupListInput & {
  oldName: string
  newName: string
}

export type AiopsAssetGroupDeleteInput = AiopsAssetGroupListInput & {
  name: string
  fallbackName?: string
}

export type AiopsAssetInput = {
  id?: string
  name: string
  title?: string
  host: string
  ip?: string
  group?: string
  group_name?: string
  status?: 'online' | 'offline' | 'unknown'
  username: string
  port?: number
  asset_type?: AiopsAssetType
  auth_type?: AiopsAssetAuthType
  comment?: string
  data_source?: 'manual' | 'refresh' | 'import'
  tags?: string[]
  favorite?: boolean
  folderUuid?: string
  organizationId?: string
  tunnelState?: 'created' | 'active'
  needProxy?: boolean
  proxyName?: string
  keychainId?: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export type AiopsKeychainType = 'rsa' | 'ed25519' | 'ecdsa'

export type AiopsKeychainRecord = {
  id: string
  name: string
  type: AiopsKeychainType
  publicKey: string
  privateKey?: string
  passphrase?: string
  hasPrivateKey: boolean
  createdAt: number
  updatedAt: number
}

export type AiopsKeychainInput = {
  id?: string
  name: string
  type?: AiopsKeychainType
  publicKey?: string
  privateKey?: string
  passphrase?: string
}

export type AiopsCustomFolderRecord = {
  uuid: string
  name: string
  description: string
}

export type AiopsCustomFolderSaveInput = {
  uuid?: string
  name: string
  description?: string
}

export type AiopsAssetSnapshot = {
  assets: AiopsAssetRecord[]
  folders: AiopsCustomFolderRecord[]
}

export type AiopsOrganizationAssetRefreshInput = {
  organizationId?: string
}

export type AiopsOrganizationAssetRefreshResult = AiopsMutationResult<
  AiopsAssetSnapshot & {
    refreshed: number
    created: number
    updated: number
  }
>

export type AiopsMutationResult<T> = {
  ok: boolean
  data?: T
  errorCode?: string
  errorMessage?: string
}

export type FileSessionKind = 'local' | 'remote'

export type FileSessionInfo = {
  id: string
  label: string
  host: string
  group: string
  kind: FileSessionKind
  rootPath: string
  status: 'active' | 'idle' | 'error'
  favorite?: boolean
  assetType?: 'local' | 'person' | 'organization' | 'custom_folder'
  folderUuid?: string
  comment?: string
  errorMsg?: string
}

export type FileSessionFolderRecord = AiopsCustomFolderRecord
export type FileSessionFolderSaveInput = AiopsCustomFolderSaveInput

export type FileSessionCatalog = {
  sessions: FileSessionInfo[]
  folders: FileSessionFolderRecord[]
}

export type FileSessionPatch = Partial<Omit<FileSessionInfo, 'id'>>
export type FileSessionSftpPayload = Record<string, unknown>

export type FileSessionCatalogResult = AiopsMutationResult<FileSessionCatalog>
export type FileSessionMutationResult = AiopsMutationResult<FileSessionCatalog & { session: FileSessionInfo }>
export type FileSessionFolderMutationResult = AiopsMutationResult<FileSessionCatalog & { folder: FileSessionFolderRecord }>
export type FileSessionFolderDeleteResult = AiopsMutationResult<FileSessionCatalog & { folderUuid: string }>

export type AiContextKind = 'hosts' | 'docs' | 'images' | 'skills' | 'chats'

export type AiContextOption = {
  id: string
  kind: AiContextKind
  label: string
  detail?: string
  relPath?: string
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

export type AiopsUserRegistrationCode = 1 | 2 | 3 | 4 | 6 | 7 | 9

export type AiopsUserLastLoginMethod = 'account' | 'email' | 'mobile' | 'skip' | 'external'

export type AiopsUserProfile = {
  uid: number
  name: string
  username: string
  avatarInitials: string
  avatarImageUrl: string
  registrationType: 'enterprise' | 'personal'
  registrationCode: AiopsUserRegistrationCode
  authProvider: 'local' | 'sso' | 'oauth'
  subscription: 'free' | 'pro' | 'ultra'
  subscriptionExpiresAt: string
  email: string
  mobile: string
  localIp: string
  macAddress: string
  isOfficeDevice: boolean
  needDeviceVerification: boolean
  skippedLogin: boolean
  localDatabaseReady: boolean
  lastLoginMethod: AiopsUserLastLoginMethod
  lastLoginAt: string
  passwordUpdatedAt: string
  avatarUpdatedAt: string
}

export type AiopsTrustedDevice = {
  id: number
  deviceName: string
  macAddress: string
  lastLoginIp: string
  location: string
  lastLoginUserAgent: string
  current: boolean
}

export type AiopsUserAccountSnapshot = {
  profile: AiopsUserProfile
  trustedDevices: AiopsTrustedDevice[]
}

export type AiopsUserLoginInput =
  | { method: 'account'; username: string; password: string }
  | { method: 'email'; email: string; code: string }
  | { method: 'mobile'; mobile: string; code: string }

export type AiopsUserProfileUpdateInput = Partial<
  Pick<AiopsUserProfile, 'name' | 'username' | 'email' | 'mobile' | 'avatarInitials' | 'avatarImageUrl' | 'avatarUpdatedAt'>
>

export type AiopsUserCodeInput = {
  kind: 'email' | 'mobile'
  value: string
}

export type AiopsUserContactBindInput = AiopsUserCodeInput & {
  code: string
}

export type AiopsUserPasswordInput = {
  password: string
}

export type AiopsUserAccountResult = AiopsMutationResult<AiopsUserAccountSnapshot>

export type AiopsUserMutationResult = AiopsMutationResult<AiopsUserAccountSnapshot & { message: string }>

export type AiopsUserCodeResult = AiopsMutationResult<{
  kind: 'email' | 'mobile'
  target: string
  countdownSeconds: number
  message: string
}>

export type AiopsTrustedDeviceRevokeResult = AiopsMutationResult<{
  deviceId: number
  trustedDevices: AiopsTrustedDevice[]
  message: string
}>

export type AiChatHistoryMessageRole = 'user' | 'assistant' | 'system'

export type AiChatHistoryHostContext = {
  id: string
  kind: 'hosts'
  label: string
  detail?: string
}

export type AiChatHistoryMessage = {
  id: string
  role: AiChatHistoryMessageRole
  text: string
  hosts?: AiChatHistoryHostContext[]
  state?: 'streaming' | 'done'
  favorite?: boolean
  feedback?: 'up' | 'down'
}

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

export type SshProxyType = 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'

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

export type ExtensionUserConfig = {
  autoCompleteStatus: boolean
  quickVimStatus: boolean
  aliasStatus: boolean
  highlightStatus: boolean
}

export type ExtensionInstallStage = 'downloading' | 'verifying' | 'installing' | 'done' | 'error' | 'cancelled' | ''

export type ExtensionPluginSource = 'preinstalled' | 'store' | 'local'

export type ExtensionIconKey = 'jumpserver' | 'alias' | 'runbook' | 'cloud' | 'private' | 'local'

export type ExtensionFunctionConfig = {
  title: string
  desc: string
}

export type ExtensionConnectionLogConfig = {
  time: string
  status: 'progress' | 'success' | 'error'
  message: string
}

export type ExtensionPluginRuntimeConfig = {
  pluginId: string
  name: string
  description: string
  iconKey: ExtensionIconKey
  tabName: string
  show: boolean
  isPlugin: boolean
  installed: boolean
  hasUpdate: boolean
  installedVersion?: string
  latestVersion?: string
  installable?: boolean
  required?: boolean
  isDraggedOnly?: boolean
  source?: ExtensionPluginSource
  isPrivate?: boolean
  lastUpdated?: string
  size?: number
  readme?: string
  categories?: string[]
  functions?: ExtensionFunctionConfig[]
  detailSummary?: string
  guideSteps?: string[]
  connectionLog?: ExtensionConnectionLogConfig[]
}

export type ExtensionPluginOperation = 'install' | 'update' | 'uninstall' | 'package'

export type ExtensionPluginOperationInput = {
  plugin: ExtensionPluginRuntimeConfig
}

export type ExtensionSubscriptionInput = {
  plugin: ExtensionPluginRuntimeConfig
}

export type ExtensionPackageInstallInput = {
  fileName: string
  filePath?: string
  size?: number
  existingPluginIds?: string[]
}

export type ExtensionInstallProgress = {
  pluginId: string
  stage: ExtensionInstallStage
  percent: number
  operation: ExtensionPluginOperation
  message?: string
}

export type ExtensionPluginOperationResult = AiopsMutationResult<{
  operation: ExtensionPluginOperation
  plugin: ExtensionPluginRuntimeConfig
  message: string
}>

export type ExtensionPluginListResult = AiopsMutationResult<ExtensionPluginRuntimeConfig[]>

export type ExtensionSubscriptionResult = AiopsMutationResult<{
  pluginId: string
  url: string
  message: string
}>

export type ExtensionPluginCancelResult = AiopsMutationResult<{
  pluginId: string
  stage: Extract<ExtensionInstallStage, 'cancelled'>
  percent: 0
  message: string
}>

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

export type PrivacyUserConfig = {
  telemetry: 'enabled' | 'disabled'
  secretRedaction: 'enabled' | 'disabled'
  dataSync: 'enabled' | 'disabled'
}

export type AiPreferencesUserConfig = {
  enableExtendedThinking: boolean
  thinkingBudgetTokens: number
  autoExecuteReadOnlyCommands: boolean
  commandOutputFilteringEnabled: boolean
  kbSearchEnabled: boolean
  experienceExtractionEnabled: boolean
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

export type ModelProviderCheckKey = 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama'

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
  }
  options: ModelOptionUserConfig[]
}

export type ShortcutUserConfig = {
  id: string
  action: string
  shortcut: string
  suffix?: string
}

export type UserRuleConfig = {
  id: string
  content: string
  enabled: boolean
}

export type SettingsPreferencesSeedInput = {
  shortcuts?: unknown
  rules?: unknown
  customInstructions?: unknown
}

export type SettingsPreferencesSnapshot = {
  shortcuts: ShortcutUserConfig[]
  rules: UserRuleConfig[]
}

export type SettingsPreferencesResult = AiopsMutationResult<SettingsPreferencesSnapshot>

export type SettingsRuleSaveInput = {
  id?: string
  content: string
  enabled?: boolean
}

export type SettingsRuleDeleteResult = AiopsMutationResult<SettingsPreferencesSnapshot & { deleted: UserRuleConfig }>

export type SettingsPreferencesMutationResult = AiopsMutationResult<SettingsPreferencesSnapshot & { message: string }>

export type SettingsShortcutSaveInput = {
  id: string
  shortcut: string
}

export type McpServerStatus = 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error'

export type McpToolConfig = {
  name: string
  description: string
  enabled: boolean
  parameters: Array<{
    name: string
    description: string
    required?: boolean
  }>
}

export type McpResourceConfig = {
  name: string
  description: string
  uri: string
}

export type McpServerUserConfig = {
  name: string
  status: McpServerStatus
  disabled: boolean
  error?: string
  tools: McpToolConfig[]
  resources: McpResourceConfig[]
}

export type McpToolStatesUserConfig = Record<string, boolean>

export type McpConfigFileServer = {
  type: 'stdio' | 'sse' | 'streamableHttp'
  disabled?: boolean
  autoApprove?: string[]
  timeout?: number
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type McpConfigFile = {
  mcpServers: Record<string, McpConfigFileServer>
}

export type QuickCommandGroupConfig = {
  id: number
  uuid: string
  group_name: string
}

export type QuickCommandSnippetConfig = {
  id: number
  uuid: string
  snippet_name: string
  snippet_content: string
  group_uuid?: string | null
  create_at?: string
  update_at?: string
}

export type QuickCommandsUserConfig = {
  groups: QuickCommandGroupConfig[]
  snippets: QuickCommandSnippetConfig[]
}

export type QuickCommandGroupSaveInput = {
  uuid?: string
  group_name: string
}

export type QuickCommandSnippetSaveInput = {
  id?: number
  uuid?: string
  snippet_name: string
  snippet_content: string
  group_uuid?: string | null
}

export type QuickCommandReorderInput = {
  orderedIds: number[]
}

export type QuickCommandGroupMutationResult = AiopsMutationResult<QuickCommandsUserConfig & { group: QuickCommandGroupConfig }>
export type QuickCommandGroupDeleteResult = AiopsMutationResult<QuickCommandsUserConfig & { groupUuid: string }>
export type QuickCommandSnippetMutationResult = AiopsMutationResult<QuickCommandsUserConfig & { snippet: QuickCommandSnippetConfig }>
export type QuickCommandSnippetDeleteResult = AiopsMutationResult<QuickCommandsUserConfig & { id: number }>
export type QuickCommandReorderResult = AiopsMutationResult<QuickCommandsUserConfig>

export type KnowledgeBaseNodeConfig = {
  id: string
  key: string
  title: string
  type: 'file' | 'dir'
  relPath: string
  size?: number
  children?: KnowledgeBaseNodeConfig[]
}

export type KnowledgeNodeType = KnowledgeBaseNodeConfig['type']
export type KnowledgeNode = KnowledgeBaseNodeConfig

export type KnowledgeBaseUserConfig = {
  tree: KnowledgeBaseNodeConfig[]
  usedBytes: number
  totalBytes: number
}

export type KnowledgeBaseEntry = {
  name: string
  relPath: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
}

export type KnowledgeBaseReadResult = {
  content: string
  mtimeMs: number
  mimeType?: string
  isImage?: boolean
}

export type KnowledgeBaseTransferProgress = {
  jobId: string
  transferred: number
  total: number
  destRelPath: string
}

export type KnowledgeBaseSearchResult = {
  path: string
  startLine: number
  endLine: number
  score: number
  snippet: string
  matchCount: number
}

export type KnowledgeBaseSearchStatus = {
  totalFiles: number
  totalChunks: number
  provider: string
  model: string
  updatedAt: number
}

export type AliasCommandConfig = {
  id: string
  alias: string
  command: string
  createdAt?: number
}

export type AliasCommandSaveInput = {
  id?: string
  previousAlias?: string
  alias: string
  command: string
  createdAt?: number
}

export type AliasCommandDeleteInput = {
  id?: string
  alias?: string
}

export type AliasCommandListResult = AiopsMutationResult<AliasCommandConfig[]>

export type AliasCommandMutationResult = AiopsMutationResult<{
  command: AliasCommandConfig
  commands: AliasCommandConfig[]
}>

export type AliasCommandDeleteResult = AiopsMutationResult<{
  deleted: AliasCommandConfig
  commands: AliasCommandConfig[]
}>

export type SkillUserConfig = {
  name: string
  description: string
  enabled: boolean
  editable: boolean
  content: string
  path?: string
}

export type SkillMetadataConfig = {
  name: string
  description: string
}

export type SkillContentResult = {
  metadata: Partial<SkillMetadataConfig>
  content: string
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

export type ChatAttachmentStageResult = {
  mode: 'local'
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
  } | null
}

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
  message: string
}>

export type AppUpdateInstallResult = AiopsMutationResult<{
  version: string
  status: 'install-requested'
  message: string
}>

export type OpenPathResult = {
  path: string
}

export type CustomBackgroundSaveResult = {
  filePath: string
  url: string
  name: string
  size: number
}

export type SkillImportErrorCode = 'INVALID_ZIP' | 'NO_SKILL_MD' | 'INVALID_METADATA' | 'DIR_EXISTS' | 'EXTRACT_FAILED' | 'UNKNOWN'

export type SkillImportResult = {
  success: boolean
  skillName?: string
  error?: string
  errorCode?: SkillImportErrorCode
}

export type SkillExportResult = {
  success: boolean
  filePath?: string
  error?: string
}

export type UserConfig = {
  language: string
  theme: string
  defaultMode: 'terminal' | 'agents'
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  modelProvider: 'local' | 'litellm' | 'openai-compatible' | 'ollama' | 'bedrock' | 'deepseek' | 'anthropic'
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

export type FileListEntry = {
  name: string
  path: string
  type: 'file' | 'directory' | 'link'
  size: number
  modifiedAt: number
  mode?: string
}

export type FileListOptions = {
  sessionId?: string
  kind?: 'local' | 'remote'
  host?: string
  fromHost?: string
  toHost?: string
  rootPath?: string
}

export type FileContentOptions = FileListOptions

export type FileReadContentResult = AiopsMutationResult<{
  content: string
  action: 'edit' | 'create'
  size: number
  mtimeMs: number
}>

export type FileWriteContentResult = AiopsMutationResult<{
  size: number
  mtimeMs: number
}>

export type FileEntryMutation =
  | { kind: 'rename'; oldPath: string; newPath: string }
  | { kind: 'delete'; path: string; recursive?: boolean }
  | { kind: 'chmod'; path: string; mode: string; recursive?: boolean }
  | { kind: 'copy'; srcPath: string; targetPath: string; overwrite?: boolean }
  | { kind: 'move'; srcPath: string; targetPath: string; overwrite?: boolean }

export type FileEntryMutationResult = AiopsMutationResult<{
  affected: number
  path?: string
  mode?: string
  mtimeMs: number
}>

export type FileTransferOperation =
  | { kind: 'upload-file' | 'upload-directory' | 'upload-path'; localPath: string; remoteDirectory: string }
  | { kind: 'download-file'; remotePath: string; localPath: string }
  | { kind: 'copy-remote'; remotePath: string; targetPath: string; overwrite?: boolean }

export type FileTransferOperationResult = AiopsMutationResult<{
  status: 'success' | 'cancelled' | 'skipped'
  source: string
  target: string
  bytes: number
  files: number
  mtimeMs: number
  itemKind?: 'file' | 'directory'
  task?: FileTransferTask
}>

export type FileTransferTask = {
  id: string
  type: 'download' | 'upload' | 'r2r'
  name: string
  source: string
  target: string
  progress: number
  speed: string
  status: 'running' | 'success' | 'failed' | 'error'
  stage?: 'scanning' | 'pending'
  isGroup?: boolean
  fromHost?: string
  toHost?: string
  totalFiles?: number
  finishedFiles?: number
  children?: FileTransferTask[]
}

export type FileTransferTaskRecordInput = Partial<Omit<FileTransferTask, 'id'>> & Pick<FileTransferTask, 'type' | 'name' | 'source' | 'target'>

export type FileTransferTaskRecordResult = AiopsMutationResult<{
  task: FileTransferTask
}>

export type FileTransferTaskCancelInput = {
  id: string
}

export type FileTransferTaskCancelResult = AiopsMutationResult<{
  id: string
  taskIds: string[]
  status: 'aborted' | 'not_found'
}>

export type TerminalCommandSuggestion = {
  command: string
  source: 'base' | 'history' | 'ai'
  explanation?: string
}

export type TerminalCommandSuggestionContext = {
  panelId?: string
  host?: string
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
  provider: 'aiopsterm-local'
}

export type TerminalCommandGenerationResult = AiopsMutationResult<TerminalCommandGenerationRecord>

export type VoiceTranscriptionInput = {
  audioData?: string
  audioFormat?: string
  audioSize?: number
  durationMs?: number
  source?: 'browser' | 'local-dev'
}

export type VoiceTranscriptionResult = AiopsMutationResult<{
  text: string
  provider: 'aiopsterm-local'
}>

export type AiChatMessageInput = {
  role: 'user' | 'assistant' | 'system'
  text: string
}

export type AiChatExchangeRequestInput = {
  text: string
  hosts?: AiChatHistoryHostContext[]
}

export type AiChatExchangeRequestResult = AiopsMutationResult<{
  userMessage: AiChatHistoryMessage
  assistantMessage: AiChatHistoryMessage
}>

export type AiChatResponseInput = {
  prompt: string
  messages?: AiChatMessageInput[]
  contexts?: Array<{ id: string; kind: AiContextKind | string; label: string }>
  skills?: Array<{ name: string; description?: string; content?: string }>
  command?: { id?: string; label?: string; command?: string } | null
  model?: string
  mode?: 'agent' | 'command' | 'chat'
}

export type AiChatResponseResult = AiopsMutationResult<{
  text: string
  provider: 'aiopsterm-local'
  model: string
  durationMs: number
}>

export type DatabaseEngineCode = 'mysql' | 'postgresql' | 'sqlite' | 'oracle'

export type DatabaseEngineOptionCode =
  | DatabaseEngineCode
  | 'h2'
  | 'sqlserver'
  | 'mariadb'
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

export type DatabaseSqlExecuteResult = AiopsMutationResult<{
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
}>

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
  | { kind: 'delete'; rowKey: string; primaryKey: string[] }
  | { kind: 'update'; rowKey: string; primaryKey: string[]; patch: Record<string, unknown> }
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

export type DatabaseAiPaneMessageInput = {
  role: 'user' | 'assistant'
  content: string
}

export type DatabaseAiPaneMessageRecord = {
  id: string
  requestId: string
  role: 'user' | 'assistant'
  status: 'queued' | 'streaming' | 'done' | 'cancelled'
  content: string
  contextSummary: string
  createdAt: number
  updatedAt: number
}

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

export type DatabaseAiPaneResponseResult = AiopsMutationResult<{
  requestId: string
  assistantMessage: DatabaseAiPaneMessageRecord
  text: string
  provider: 'aiopsterm-local'
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
  provider: 'aiopsterm-local'
  durationMs: number
}>

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
}>

export type KubernetesImportContextInfo = {
  name: string
  cluster: string
  server: string
  namespace: string
}

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

export type KubernetesCommandInput = {
  command: string
  clusterId: string
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

export type AiopsPreloadApi = {
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
  listAiTodoSnapshot: () => Promise<AiTodoSnapshotResult>
  listAiContextCatalog: () => Promise<AiContextCatalogResult>
  getUserAccount: () => Promise<AiopsUserAccountResult>
  openUserLogin: () => Promise<AiopsUserMutationResult>
  loginUserAccount: (input: AiopsUserLoginInput) => Promise<AiopsUserMutationResult>
  logoutUserAccount: () => Promise<AiopsUserMutationResult>
  skipUserLogin: () => Promise<AiopsUserMutationResult>
  sendUserLoginCode: (input: AiopsUserCodeInput) => Promise<AiopsUserCodeResult>
  updateUserProfile: (input: AiopsUserProfileUpdateInput) => Promise<AiopsUserMutationResult>
  resetUserPassword: (input: AiopsUserPasswordInput) => Promise<AiopsUserMutationResult>
  sendUserContactCode: (input: AiopsUserCodeInput) => Promise<AiopsUserCodeResult>
  bindUserContact: (input: AiopsUserContactBindInput) => Promise<AiopsUserMutationResult>
  revokeTrustedDevice: (id: number) => Promise<AiopsTrustedDeviceRevokeResult>
  getProtocolPrefix: () => Promise<string>
  handleProtocolUrl: (url: string) => Promise<{ success: boolean; reason?: string; payload?: AiopstermDeepLinkPayload }>
  consumeDeepLinks: () => Promise<AiopstermDeepLinkPayload[]>
  onDeepLink: (listener: (payload: AiopstermDeepLinkPayload) => void) => () => void
  openExternalUrl: (url: string) => Promise<void>
  openLogDir: () => Promise<OpenPathResult>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  unmaximizeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  closeWindow: () => Promise<void>
  onMaximized: (listener: () => void) => () => void
  onUnmaximized: (listener: () => void) => () => void
  getConfig: () => Promise<UserConfig>
  saveConfig: (patch: Partial<UserConfig>) => Promise<UserConfig>
  getSettingsPreferences: (seed?: SettingsPreferencesSeedInput) => Promise<SettingsPreferencesResult>
  saveSettingsRule: (input: SettingsRuleSaveInput) => Promise<SettingsPreferencesMutationResult>
  deleteSettingsRule: (id: string) => Promise<SettingsRuleDeleteResult>
  saveSettingsShortcut: (input: SettingsShortcutSaveInput) => Promise<SettingsPreferencesMutationResult>
  resetSettingsShortcuts: () => Promise<SettingsPreferencesMutationResult>
  getSecurityConfigPath: () => Promise<string>
  readSecurityConfig: () => Promise<string>
  writeSecurityConfig: (content: string) => Promise<void>
  onSecurityConfigFileChanged: (listener: (content: string) => void) => () => void
  getKeywordHighlightConfigPath: () => Promise<string>
  readKeywordHighlightConfig: () => Promise<string>
  writeKeywordHighlightConfig: (content: string) => Promise<void>
  onKeywordHighlightConfigFileChanged: (listener: (content: string) => void) => () => void
  getMcpConfigPath: () => Promise<string>
  getMcpServers: () => Promise<McpServerUserConfig[]>
  readMcpConfig: () => Promise<string>
  writeMcpConfig: (content: string) => Promise<void>
  toggleMcpServer: (serverName: string, disabled: boolean) => Promise<void>
  deleteMcpServer: (serverName: string) => Promise<void>
  setMcpToolState: (serverName: string, toolName: string, enabled: boolean) => Promise<void>
  onMcpConfigFileChanged: (listener: (content: string) => void) => () => void
  getSkills: () => Promise<SkillUserConfig[]>
  getEnabledSkills: () => Promise<SkillUserConfig[]>
  setSkillEnabled: (skillName: string, enabled: boolean) => Promise<void>
  getSkillsUserPath: () => Promise<string>
  reloadSkills: () => Promise<SkillUserConfig[]>
  createSkill: (metadata: SkillMetadataConfig, content: string) => Promise<SkillUserConfig>
  deleteSkill: (skillName: string) => Promise<void>
  openSkillsFolder: () => Promise<void>
  importSkillZip: (zipPath: string, overwrite?: boolean) => Promise<SkillImportResult>
  readSkillContent: (skillName: string) => Promise<SkillContentResult>
  updateSkill: (skillName: string, metadata: SkillMetadataConfig, content: string) => Promise<void>
  exportSkillZip: (skillName: string) => Promise<SkillExportResult>
  onSkillsUpdate: (listener: (skills: SkillUserConfig[]) => void) => () => void
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogResult | undefined>
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult | undefined>
  saveCustomBackground: (srcAbsPath: string) => Promise<CustomBackgroundSaveResult>
  readLocalFile: (filePath: string) => Promise<LocalFileReadResult>
  writeLocalFile: (filePath: string, content: string) => Promise<void>
  stageChatAttachment: (payload: { taskId: string; srcAbsPath: string }) => Promise<ChatAttachmentStageResult>
  validateChatImageAttachment: (input: ChatImageAttachmentValidateInput) => Promise<ChatImageAttachmentValidateResult>
  prepareChatImageAttachment: (input: ChatImageAttachmentPrepareInput) => Promise<ChatImageAttachmentPrepareResult>
  kbCheckPath: (absPath: string) => Promise<{ exists: boolean; isDirectory: boolean; isFile: boolean }>
  kbEnsureRoot: () => Promise<{ success: boolean }>
  kbGetRoot: () => Promise<{ root: string }>
  kbListDir: (relDir: string) => Promise<KnowledgeBaseEntry[]>
  kbReadFile: (relPath: string, encoding?: 'utf-8' | 'base64') => Promise<KnowledgeBaseReadResult>
  kbWriteFile: (relPath: string, content: string, encoding?: 'utf-8' | 'base64') => Promise<{ mtimeMs: number }>
  kbMkdir: (relDir: string, name: string) => Promise<{ success: boolean; relPath: string }>
  kbCreateFile: (relDir: string, name: string, content?: string) => Promise<{ relPath: string }>
  kbRename: (relPath: string, newName: string) => Promise<{ relPath: string }>
  kbDelete: (relPath: string, recursive?: boolean) => Promise<{ success: boolean }>
  kbMove: (srcRelPath: string, dstRelDir: string) => Promise<{ relPath: string }>
  kbCopy: (srcRelPath: string, dstRelDir: string) => Promise<{ relPath: string }>
  kbImportFile: (srcAbsPath: string, dstRelDir: string) => Promise<{ jobId: string; relPath: string }>
  kbImportFolder: (srcAbsPath: string, dstRelDir: string) => Promise<{ jobId: string; relPath: string }>
  kbSearch: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<KnowledgeBaseSearchResult[]>
  kbSearchStatus: () => Promise<KnowledgeBaseSearchStatus>
  kbReindex: () => Promise<{ files: number; chunks: number }>
  onKbTransferProgress: (listener: (event: KnowledgeBaseTransferProgress) => void) => () => void
  listAssets: () => Promise<AiopsAssetSnapshot>
  listAssetGroups: (input?: AiopsAssetGroupListInput) => Promise<AiopsAssetGroupRecord[]>
  renameAssetGroup: (input: AiopsAssetGroupRenameInput) => Promise<AiopsMutationResult<AiopsAssetSnapshot>>
  deleteAssetGroup: (input: AiopsAssetGroupDeleteInput) => Promise<AiopsMutationResult<AiopsAssetSnapshot>>
  saveAsset: (asset: AiopsAssetInput) => Promise<AiopsMutationResult<AiopsAssetRecord>>
  deleteAsset: (id: string) => Promise<AiopsMutationResult<{ id: string }>>
  refreshOrganizationAssets: (input?: AiopsOrganizationAssetRefreshInput) => Promise<AiopsOrganizationAssetRefreshResult>
  saveAssetFolder: (folder: AiopsCustomFolderSaveInput) => Promise<AiopsMutationResult<AiopsCustomFolderRecord>>
  deleteAssetFolder: (uuid: string) => Promise<AiopsMutationResult<{ uuid: string }>>
  listKeychains: () => Promise<AiopsKeychainRecord[]>
  listSshAgentKeychainOptions: () => Promise<SshAgentKeychainOption[]>
  getKeychain: (id: string) => Promise<AiopsKeychainRecord | null>
  saveKeychain: (keychain: AiopsKeychainInput) => Promise<AiopsMutationResult<AiopsKeychainRecord>>
  deleteKeychain: (id: string) => Promise<AiopsMutationResult<{ id: string }>>
  getQuickCommands: () => Promise<QuickCommandsUserConfig>
  saveQuickCommands: (config: QuickCommandsUserConfig) => Promise<AiopsMutationResult<QuickCommandsUserConfig>>
  saveQuickCommandGroup: (input: QuickCommandGroupSaveInput) => Promise<QuickCommandGroupMutationResult>
  deleteQuickCommandGroup: (uuid: string) => Promise<QuickCommandGroupDeleteResult>
  saveQuickCommandSnippet: (input: QuickCommandSnippetSaveInput) => Promise<QuickCommandSnippetMutationResult>
  deleteQuickCommandSnippet: (id: number) => Promise<QuickCommandSnippetDeleteResult>
  reorderQuickCommands: (input: QuickCommandReorderInput) => Promise<QuickCommandReorderResult>
  listAliasCommands: (query?: string) => Promise<AliasCommandListResult>
  saveAliasCommand: (input: AliasCommandSaveInput) => Promise<AliasCommandMutationResult>
  deleteAliasCommand: (input: AliasCommandDeleteInput) => Promise<AliasCommandDeleteResult>
  createTerminal: (options?: TerminalCreateOptions) => Promise<TerminalSessionInfo>
  writeTerminal: (id: string, data: string) => Promise<TerminalWriteResult>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<TerminalKillResult>
  getTerminalCommandSuggestions: (query: string, context?: TerminalCommandSuggestionContext) => Promise<TerminalCommandSuggestion[]>
  generateTerminalCommand: (input: TerminalCommandGenerationInput) => Promise<TerminalCommandGenerationResult>
  listAiModels: () => Promise<AiModelCatalog>
  checkModelProvider: (input: ModelProviderCheckInput) => Promise<ModelProviderCheckResult>
  listExtensionPlugins: () => Promise<ExtensionPluginListResult>
  installExtensionPlugin: (input: ExtensionPluginOperationInput) => Promise<ExtensionPluginOperationResult>
  updateExtensionPlugin: (input: ExtensionPluginOperationInput) => Promise<ExtensionPluginOperationResult>
  installExtensionPackage: (input: ExtensionPackageInstallInput) => Promise<ExtensionPluginOperationResult>
  uninstallExtensionPlugin: (input: ExtensionPluginOperationInput) => Promise<ExtensionPluginOperationResult>
  openExtensionSubscription: (input: ExtensionSubscriptionInput) => Promise<ExtensionSubscriptionResult>
  cancelExtensionInstall: (pluginId: string) => Promise<ExtensionPluginCancelResult>
  onExtensionInstallProgress: (listener: (event: ExtensionInstallProgress) => void) => () => void
  createAiChatExchangeRequest: (input: AiChatExchangeRequestInput) => Promise<AiChatExchangeRequestResult>
  generateAiChatResponse: (input: AiChatResponseInput) => Promise<AiChatResponseResult>
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
  mutateDatabaseTable: (input: DatabaseTableMutationInput) => Promise<DatabaseTableMutationResult>
  createDatabaseAiPaneRequest: (input: DatabaseAiPaneRequestInput) => Promise<DatabaseAiPaneRequestResult>
  startDatabaseAiPaneResponse: (input: DatabaseAiPaneLifecycleInput) => Promise<DatabaseAiPaneLifecycleResult>
  cancelDatabaseAiPaneResponse: (input: DatabaseAiPaneLifecycleInput) => Promise<DatabaseAiPaneLifecycleResult>
  generateDatabaseAiPaneResponse: (input: DatabaseAiPaneResponseInput) => Promise<DatabaseAiPaneResponseResult>
  createDatabaseAiDrawerRequest: (input: DatabaseAiDrawerRequestInput) => Promise<DatabaseAiDrawerRequestResult>
  startDatabaseAiDrawerResponse: (input: DatabaseAiDrawerLifecycleInput) => Promise<DatabaseAiDrawerLifecycleResult>
  cancelDatabaseAiDrawerResponse: (input: DatabaseAiDrawerLifecycleInput) => Promise<DatabaseAiDrawerLifecycleResult>
  generateDatabaseAiDrawerResponse: (input: DatabaseAiDrawerResponseInput) => Promise<DatabaseAiDrawerResponseResult>
  listKubernetesCatalog: () => Promise<KubernetesCatalogResult>
  switchKubernetesContext: (contextName: string) => Promise<KubernetesContextSwitchResult>
  addKubernetesCluster: (input: KubernetesClusterInput) => Promise<KubernetesClusterMutationResult>
  updateKubernetesCluster: (id: string, input: KubernetesClusterUpdateInput) => Promise<KubernetesClusterMutationResult>
  testKubernetesClusterConnection: (input: KubernetesClusterTestInput) => Promise<KubernetesClusterTestResult>
  deleteKubernetesCluster: (id: string) => Promise<KubernetesClusterMutationResult>
  connectKubernetesCluster: (id: string) => Promise<KubernetesClusterMutationResult>
  disconnectKubernetesCluster: (id: string) => Promise<KubernetesClusterMutationResult>
  syncKubernetesBastion: (bastionUuid: string) => Promise<KubernetesBastionSyncResult>
  createKubernetesTerminal: (input: KubernetesTerminalCreateInput) => Promise<KubernetesTerminalCreateResult>
  resizeKubernetesTerminal: (id: string, cols: number, rows: number) => Promise<KubernetesTerminalMutationResult>
  closeKubernetesTerminal: (id: string, exitCode?: number) => Promise<KubernetesTerminalCloseResult>
  executeKubernetesCommand: (input: KubernetesCommandInput) => Promise<KubernetesCommandResult>
  listFileSessionCatalog: () => Promise<FileSessionCatalogResult>
  saveFileSession: (session: FileSessionInfo) => Promise<FileSessionMutationResult>
  saveFileSessionFromSftpPayload: (payload: FileSessionSftpPayload) => Promise<FileSessionMutationResult>
  updateFileSession: (id: string, patch: FileSessionPatch) => Promise<FileSessionMutationResult>
  deleteFileSession: (id: string) => Promise<FileSessionCatalogResult>
  saveFileSessionFolder: (folder: FileSessionFolderSaveInput) => Promise<FileSessionFolderMutationResult>
  deleteFileSessionFolder: (uuid: string) => Promise<FileSessionFolderDeleteResult>
  listFiles: (directory: string, options?: FileListOptions) => Promise<FileListEntry[]>
  readFileContent: (filePath: string, options?: FileContentOptions) => Promise<FileReadContentResult>
  writeFileContent: (filePath: string, content: string, options?: FileContentOptions) => Promise<FileWriteContentResult>
  mutateFileEntry: (mutation: FileEntryMutation, options?: FileListOptions) => Promise<FileEntryMutationResult>
  transferFileEntry: (operation: FileTransferOperation, options?: FileListOptions) => Promise<FileTransferOperationResult>
  recordFileTransferTask: (input: FileTransferTaskRecordInput) => Promise<FileTransferTaskRecordResult>
  cancelFileTransferTask: (input: FileTransferTaskCancelInput) => Promise<FileTransferTaskCancelResult>
  listFileTransferTasks: () => Promise<FileTransferTask[]>
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => () => void
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => () => void
}
