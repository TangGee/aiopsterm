import type { AiopsMutationResult } from './common'

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'

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
  /** Enables detailed runtime diagnostics for troubleshooting. */
  debugLogs?: boolean
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
  telemetry: 'undecided' | 'enabled' | 'disabled'
  telemetryConsentVersion?: 0 | 1
  secretRedaction: 'enabled' | 'disabled'
  dataSync: 'enabled' | 'disabled'
}

export type OfficialExternalLink =
  | 'website'
  | 'documentation'
  | 'issues'
  | 'discussions'
  | 'discord'
  | 'wechat'
  | 'supportEmail'
  | 'securityEmail'
  | 'privacyPolicy'

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

export const notificationSoundPresetValues = ['chime', 'soft-ding', 'approval-voice', 'custom'] as const
export type NotificationSoundPreset = (typeof notificationSoundPresetValues)[number]

export type NotificationUserConfig = {
  desktopNotifications: boolean
  controlNotificationBell: boolean
  soundEnabled: boolean
  soundPreset: NotificationSoundPreset
  customSoundPath: string
  customSoundUrl: string
  customSoundName: string
}

export type ExportMcpUserConfig = {
  allowAgentSshAuthSubmit: boolean
  allowDatabaseRead: boolean
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
  endpointMode?: 'auto' | 'exact'
  apiPathMode?: 'auto' | 'v1' | 'none'
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
  suggestion?: {
    baseUrl: string
    endpoint: string
    apiFormat?: 'chat-completions' | 'responses'
    apiPathMode?: 'auto' | 'v1' | 'none'
    reasons: string[]
  }
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
  | 'aiNotifications'
  | 'aiRemoteHostManagement'
  | 'commandSecurity'
  | 'mcp'
  | 'exportMcp'
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

export type CustomNotificationSoundSaveResult = {
  filePath: string
  url: string
  name: string
  size: number
  bytes: number
  mtimeMs: number
}
