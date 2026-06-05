export type TerminalCreateOptions = {
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
}

export type TerminalSessionInfo = {
  id: string
  shell: string
  cwd: string
}

export type TerminalDataEvent = {
  id: string
  data: string
}

export type TerminalExitEvent = {
  id: string
  code: number | null
}

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

export type KnowledgeBaseNodeConfig = {
  id: string
  key: string
  title: string
  type: 'file' | 'dir'
  relPath: string
  size?: number
  children?: KnowledgeBaseNodeConfig[]
}

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

export type AliasCommandConfig = {
  id: string
  alias: string
  command: string
  createdAt?: number
}

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

export type ChatAttachmentStageResult = {
  mode: 'local'
  refPath: string
  name: string
  size: number
  stagedPath: string
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
  modelProvider: 'mock' | 'litellm' | 'openai-compatible' | 'ollama' | 'bedrock' | 'deepseek' | 'anthropic'
  modelEndpoint: string
  modelName: string
  watermark: 'open' | 'close'
  background: {
    mode: 'none' | 'preset' | 'custom'
    image: string
    opacity: number
    brightness: number
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
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

export type AiopsPreloadApi = {
  platform: () => Promise<string>
  shell: () => Promise<string>
  checkUpdate: () => Promise<{ available: false; channel: 'local' }>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  unmaximizeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  closeWindow: () => Promise<void>
  onMaximized: (listener: () => void) => () => void
  onUnmaximized: (listener: () => void) => () => void
  getConfig: () => Promise<UserConfig>
  saveConfig: (patch: Partial<UserConfig>) => Promise<UserConfig>
  getSecurityConfigPath: () => Promise<string>
  readSecurityConfig: () => Promise<string>
  writeSecurityConfig: (content: string) => Promise<void>
  onSecurityConfigFileChanged: (listener: (content: string) => void) => () => void
  getKeywordHighlightConfigPath: () => Promise<string>
  readKeywordHighlightConfig: () => Promise<string>
  writeKeywordHighlightConfig: (content: string) => Promise<void>
  onKeywordHighlightConfigFileChanged: (listener: (content: string) => void) => () => void
  getMcpConfigPath: () => Promise<string>
  readMcpConfig: () => Promise<string>
  writeMcpConfig: (content: string) => Promise<void>
  toggleMcpServer: (serverName: string, disabled: boolean) => Promise<void>
  deleteMcpServer: (serverName: string) => Promise<void>
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
  writeLocalFile: (filePath: string, content: string) => Promise<void>
  stageChatAttachment: (payload: { taskId: string; srcAbsPath: string }) => Promise<ChatAttachmentStageResult>
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
  onKbTransferProgress: (listener: (event: KnowledgeBaseTransferProgress) => void) => () => void
  createTerminal: (options?: TerminalCreateOptions) => Promise<TerminalSessionInfo>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  listFiles: (directory: string) => Promise<FileListEntry[]>
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => () => void
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => () => void
}
