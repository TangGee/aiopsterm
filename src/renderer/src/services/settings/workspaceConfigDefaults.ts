import type {
  AiPreferencesUserConfig,
  EditorUserConfig,
  ExportMcpUserConfig,
  KeywordHighlightRuleConfig,
  KeywordHighlightUserConfig,
  KnowledgeSearchRuntimeSnapshot,
  ModelOptionUserConfig,
  ModelProviderCheckKey,
  ModelSettingsUserConfig,
  NotificationUserConfig,
  PrivacyRuntimeSnapshot,
  PrivacyUserConfig,
  SecurityUserConfig,
  SshProxyType,
  TerminalMouseEventAction,
  TerminalUserConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { ExtensionUserConfig } from '@shared/contracts/extensions'
import type { KnowledgeBaseUserConfig } from '@shared/contracts/knowledgeBase'
import type { McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type { QuickCommandsUserConfig } from '@shared/contracts/quickCommands'
import type { ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { UserConfig } from '@shared/contracts/userConfig'
import { defaultModelSettingsData } from '@shared/modelSettingsDefaults'
import { defaultWorkspacePreferencesData } from '@shared/workspacePreferencesDefaults'

export type EditorSettings = EditorUserConfig
export type TerminalSettings = TerminalUserConfig
export type ModelProviderKey = ModelProviderCheckKey
export type ModelProviderSettings = {
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
export type SettingsModelOption = {
  name: string
  displayName?: string
  locked: boolean
  checked: boolean
  type?: 'standard' | 'custom'
  apiProvider?: string
}
export type ExtensionSettings = ExtensionUserConfig
export type KeywordHighlightSettings = KeywordHighlightUserConfig
export type SecuritySettings = SecurityUserConfig
export type ExportMcpSettings = ExportMcpUserConfig
export type AiPreferenceSettings = AiPreferencesUserConfig
export type PrivacySettings = PrivacyUserConfig & {
  dataSyncRuntime: PrivacyRuntimeSnapshot['dataSyncRuntime']
  dataSyncStatus: NonNullable<PrivacyRuntimeSnapshot['syncStatus']>
  dataSyncRunId: string
  dataSyncStateFilePath: string
  dataSyncLastSyncAt: string
  dataSyncSyncedScopes: NonNullable<PrivacyRuntimeSnapshot['syncedScopes']>
  dataSyncErrorMessage: string
  deactivateModalOpen: boolean
  deactivateConfirmationInput: string
  deactivateLoading: boolean
}

export type PrivacyRuntimeApplyData = PrivacyRuntimeSnapshot
export type KnowledgeSearchRuntimeApplyData = KnowledgeSearchRuntimeSnapshot

export const layoutWidthLimits = {
  min: 220,
  max: 640,
  quickCloseThreshold: 50,
  defaults: {
    leftPanelWidth: 286,
    rightPanelWidth: 360,
    agentsLeftWidth: 286
  }
}

export const defaultNotificationSettings: NotificationUserConfig = {
  desktopNotifications: true,
  controlNotificationBell: true,
  soundEnabled: true,
  soundPreset: 'chime',
  customSoundPath: '',
  customSoundUrl: '',
  customSoundName: ''
}

const defaultWorkspacePreferencesUserConfig: WorkspaceUserConfig = defaultWorkspacePreferencesData()
const defaultModelSettingsUserConfig: ModelSettingsUserConfig = defaultModelSettingsData()

export const defaultConfig: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  leftPanelWidth: layoutWidthLimits.defaults.leftPanelWidth,
  rightPanelWidth: layoutWidthLimits.defaults.rightPanelWidth,
  agentsLeftWidth: layoutWidthLimits.defaults.agentsLeftWidth,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.68,
    brightness: 0.92,
    lastCustomImage: ''
  },
  terminal: {
    terminalType: 'xterm-256color',
    fontFamily: '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace',
    fontSize: 12,
    scrollBack: 1000,
    cursorStyle: 'block',
    cursorBlink: true,
    lineHeight: 1,
    pinchZoomStatus: true,
    showCloseButton: true,
    sshAgentsStatus: false,
    middleMouseEvent: 'paste',
    rightMouseEvent: 'contextMenu'
  },
  workspacePreferences: defaultWorkspacePreferencesUserConfig,
  editorSettings: {
    fontSize: 14,
    lineHeight: 0,
    fontFamily: 'cascadia-mono',
    tabSize: 4,
    wordWrap: 'off',
    minimap: true,
    mouseWheelZoom: true
  },
  sshProxyConfigs: [],
  sshAgentKeys: [],
  extensionSettings: {
    autoCompleteStatus: true,
    quickVimStatus: true,
    highlightStatus: true
  },
  keywordHighlight: {
    'keyword-highlight': {
      enabled: true,
      applyTo: {
        output: true,
        input: false
      },
      rules: []
    }
  },
  securityConfig: {
    security: {
      enableCommandSecurity: true,
      enableStrictMode: false,
      blacklistPatterns: [],
      whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
      dangerousCommands: ['rm', 'format', 'shutdown'],
      maxCommandLength: 10000,
      securityPolicy: {
        blockCritical: true,
        askForMedium: true,
        askForHigh: true,
        askForBlacklist: false
      }
    }
  },
  privacy: {
    telemetry: 'enabled',
    secretRedaction: 'disabled',
    dataSync: 'disabled'
  },
  aiPreferences: {
    enableExtendedThinking: true,
    thinkingBudgetTokens: 4096,
    autoExecuteReadOnlyCommands: false,
    commandOutputFilteringEnabled: true,
    kbSearchEnabled: true,
    experienceExtractionEnabled: true,
    managedAiAutoNamingEnabled: false,
    autoApproval: false,
    reasoningEffort: 'medium',
    needProxy: false,
    proxy: {
      type: 'HTTP',
      host: '127.0.0.1',
      port: 7890,
      enableProxyIdentity: false,
      username: '',
      password: ''
    },
    shellIntegrationTimeout: 4
  },
  notifications: { ...defaultNotificationSettings },
  exportMcp: {
    allowAgentSshAuthSubmit: false,
    allowDatabaseRead: false
  },
  modelSettings: defaultModelSettingsUserConfig,
  shortcuts: [],
  rules: [],
  skills: [],
  mcpServers: [],
  mcpToolStates: {},
  quickCommands: { groups: [], snippets: [] },
  knowledgeBase: {
    tree: [],
    usedBytes: 0,
    totalBytes: 1024 * 1024 * 1024
  },
  onboarding: {
    version: 2,
    guideTabAutoOpened: false,
    completedModules: {
      interfaceGuide: false,
      systemSettings: false,
      addAndConnectHost: false,
      aiChat: false
    }
  }
}

export const defaultTerminalSettings: TerminalSettings = {
  ...defaultConfig.terminal!
}

export const defaultEditorSettings: EditorSettings = {
  ...defaultConfig.editorSettings!
}

export const defaultWorkspacePreferences: WorkspaceUserConfig = {
  ...defaultConfig.workspacePreferences!,
  expandedGroups: [...defaultConfig.workspacePreferences!.expandedGroups]
}

export const defaultModelProviders: Record<ModelProviderKey, ModelProviderSettings> = {
  litellm: {
    baseUrl: 'http://localhost:4000',
    apiKey: '',
    modelId: 'gpt-5'
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    modelId: 'gpt-5',
    apiFormat: 'responses'
  },
  bedrock: {
    baseUrl: '',
    apiKey: '',
    modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    awsAccessKey: '',
    awsSecretKey: '',
    awsSessionToken: '',
    awsRegion: 'us-east-1',
    awsUseCrossRegionInference: false,
    awsEndpointSelected: false,
    awsBedrockEndpoint: ''
  },
  deepseek: {
    baseUrl: '',
    apiKey: '',
    modelId: 'deepseek-chat'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    modelId: 'claude-3-5-sonnet-latest'
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    modelId: 'llama3.1'
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234',
    apiKey: '',
    modelId: 'openai/gpt-oss-20b'
  }
}

export const defaultAiPreferences: AiPreferenceSettings = {
  ...defaultConfig.aiPreferences!,
  proxy: { ...defaultConfig.aiPreferences!.proxy }
}

export const defaultExportMcpSettings: ExportMcpSettings = {
  ...defaultConfig.exportMcp!
}

export const defaultExtensionSettings: ExtensionSettings = {
  ...defaultConfig.extensionSettings!
}

export const defaultKeywordHighlightSettings: KeywordHighlightSettings = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

export const defaultSecuritySettings: SecuritySettings = {
  security: {
    enableCommandSecurity: true,
    enableStrictMode: false,
    blacklistPatterns: [],
    whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
    dangerousCommands: ['rm', 'format', 'shutdown'],
    maxCommandLength: 10000,
    securityPolicy: {
      blockCritical: true,
      askForMedium: true,
      askForHigh: true,
      askForBlacklist: false
    }
  }
}

export const defaultPrivacySettings: PrivacySettings = {
  ...defaultConfig.privacy!,
  dataSyncRuntime: 'disabled',
  dataSyncStatus: 'disabled',
  dataSyncRunId: '',
  dataSyncStateFilePath: '',
  dataSyncLastSyncAt: '',
  dataSyncSyncedScopes: [],
  dataSyncErrorMessage: '',
  deactivateModalOpen: false,
  deactivateConfirmationInput: '',
  deactivateLoading: false
}

export const defaultQuickCommands: QuickCommandsUserConfig = {
  groups: [],
  snippets: []
}

export const defaultKnowledgeBase: KnowledgeBaseUserConfig = {
  tree: [],
  usedBytes: defaultConfig.knowledgeBase!.usedBytes,
  totalBytes: defaultConfig.knowledgeBase!.totalBytes
}

export const defaultShortcuts: ShortcutUserConfig[] = []
export const defaultRules: UserRuleConfig[] = []
export const defaultSkills: SkillUserConfig[] = []
export const defaultMcpServers: McpServerUserConfig[] = []
export const defaultMcpToolStates: McpToolStatesUserConfig = {}

export const terminalTypes = ['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi'] as const
export const terminalCursorStyles = ['block', 'bar', 'underline'] as const
export const middleMouseEventActions: TerminalMouseEventAction[] = ['none', 'paste', 'contextMenu', 'closeTab']
export const rightMouseEventActions: TerminalSettings['rightMouseEvent'][] = ['none', 'paste', 'contextMenu']
export const sshProxyTypes: SshProxyType[] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5', 'TCP']
export const standardProxyTypes: Array<Exclude<SshProxyType, 'TCP'>> = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

export const linuxReadableTerminalFontFamily = '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace'
export const legacyTerminalFontFamilies = new Set([
  'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
  'Monaco, "Courier New", Consolas, Courier, monospace',
  '"MesloLGS NF", "Courier New", Courier, monospace',
  'Consolas, "Courier New", Courier, monospace',
  '"JetBrains Mono", "Courier New", Courier, monospace',
  '"Source Code Pro", "Courier New", Courier, monospace'
])
export const modelApiFormats: NonNullable<ModelProviderSettings['apiFormat']>[] = ['chat-completions', 'responses']
export const modelEndpointModes: NonNullable<ModelProviderSettings['endpointMode']>[] = ['auto', 'exact']
export const modelApiPathModes: NonNullable<ModelProviderSettings['apiPathMode']>[] = ['auto', 'v1', 'none']
export const modelOptionTypes: NonNullable<ModelOptionUserConfig['type']>[] = ['standard', 'custom']
export const editorWordWrapValues: EditorSettings['wordWrap'][] = ['on', 'off']
export const keywordHighlightScopes: KeywordHighlightRuleConfig['scope'][] = ['output', 'input', 'both']
export const keywordHighlightMatchTypes: KeywordHighlightRuleConfig['matchType'][] = ['regex', 'wildcard']
export const keywordHighlightFontStyles: KeywordHighlightRuleConfig['style']['fontStyle'][] = ['bold', 'normal']
export const keywordHighlightHexColorPattern = /^#(?:[0-9a-fA-F]{6})$/
export const privacyStatusValues = ['enabled', 'disabled'] as const
export const privacyRuntimeValues = ['disabled', 'service', 'backend-double', 'local-file'] as const
export const privacySyncStatusValues = ['disabled', 'idle', 'syncing', 'synced', 'error'] as const
export const privacySyncedScopeValues = ['config', 'knowledge', 'chat', 'assets', 'skills'] as const
export const reasoningEffortValues = ['low', 'medium', 'high'] as const
export const proxyTypeValues: AiPreferenceSettings['proxy']['type'][] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']
export const shortcutDefaultsById = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))
export const shortcutModifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
export const mcpStatusValues: McpServerUserConfig['status'][] = ['connected', 'connecting', 'disconnected', 'disabled', 'error']
export const backgroundModeValues = ['none', 'preset', 'custom'] as const
export const ONBOARDING_VERSION = defaultConfig.onboarding!.version
export const onboardingModuleIds = ['interfaceGuide', 'systemSettings', 'addAndConnectHost', 'aiChat'] as const
export const defaultAiPreferencesConfig = defaultConfig.aiPreferences!
export const defaultModelSettingsConfig = defaultConfig.modelSettings!
