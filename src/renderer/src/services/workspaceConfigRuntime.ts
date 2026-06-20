import { isLocaleSetting } from '@/i18n/runtime'
import type {
  AiPreferencesUserConfig,
  CustomBackgroundSaveResult,
  EditorUserConfig,
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
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  SshProxyType,
  TerminalMouseEventAction,
  TerminalUserConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { AliasCommandConfig } from '@shared/contracts/aliases'
import type { ExtensionUserConfig } from '@shared/contracts/extensions'
import type { KnowledgeBaseUserConfig, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type { QuickCommandGroupConfig, QuickCommandSnippetConfig, QuickCommandsUserConfig } from '@shared/contracts/quickCommands'
import type { ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { UserConfig } from '@shared/contracts/userConfig'
import { defaultModelSettingsData } from '@shared/modelSettingsDefaults'
import { defaultWorkspacePreferencesData } from '@shared/workspacePreferencesDefaults'
import { isLegacyLocalModelName } from '@shared/modelConfigBoundary'

export type EditorSettings = EditorUserConfig
export type TerminalSettings = TerminalUserConfig
export type ModelProviderKey = ModelProviderCheckKey
export type ModelProviderSettings = {
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

type PrivacyRuntimeApplyData = PrivacyRuntimeSnapshot
type KnowledgeSearchRuntimeApplyData = KnowledgeSearchRuntimeSnapshot

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
  controlNotificationBell: true
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
    aliasStatus: true,
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
  aliasCommands: [],
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

export const defaultAliasCommands: AliasCommandConfig[] = []
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

const linuxReadableTerminalFontFamily = '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace'
const legacyTerminalFontFamilies = new Set([
  'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
  'Monaco, "Courier New", Consolas, Courier, monospace',
  '"MesloLGS NF", "Courier New", Courier, monospace',
  'Consolas, "Courier New", Courier, monospace',
  '"JetBrains Mono", "Courier New", Courier, monospace',
  '"Source Code Pro", "Courier New", Courier, monospace'
])
const modelApiFormats: NonNullable<ModelProviderSettings['apiFormat']>[] = ['chat-completions', 'responses']
const modelOptionTypes: NonNullable<ModelOptionUserConfig['type']>[] = ['standard', 'custom']
const editorWordWrapValues: EditorSettings['wordWrap'][] = ['on', 'off']
const keywordHighlightScopes: KeywordHighlightRuleConfig['scope'][] = ['output', 'input', 'both']
const keywordHighlightMatchTypes: KeywordHighlightRuleConfig['matchType'][] = ['regex', 'wildcard']
const keywordHighlightFontStyles: KeywordHighlightRuleConfig['style']['fontStyle'][] = ['bold', 'normal']
const keywordHighlightHexColorPattern = /^#(?:[0-9a-fA-F]{6})$/
const privacyStatusValues = ['enabled', 'disabled'] as const
const privacyRuntimeValues = ['disabled', 'service', 'backend-double', 'local-file'] as const
const privacySyncStatusValues = ['disabled', 'idle', 'syncing', 'synced', 'error'] as const
const privacySyncedScopeValues = ['config', 'knowledge', 'chat', 'assets', 'skills'] as const
const reasoningEffortValues = ['low', 'medium', 'high'] as const
const proxyTypeValues: AiPreferenceSettings['proxy']['type'][] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']
const shortcutDefaultsById = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))
const shortcutModifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const mcpStatusValues: McpServerUserConfig['status'][] = ['connected', 'connecting', 'disconnected', 'disabled', 'error']
const backgroundModeValues = ['none', 'preset', 'custom'] as const
const ONBOARDING_VERSION = defaultConfig.onboarding!.version
const onboardingModuleIds = ['interfaceGuide', 'systemSettings', 'addAndConnectHost', 'aiChat'] as const
const defaultAiPreferencesConfig = defaultConfig.aiPreferences!
const defaultModelSettingsConfig = defaultConfig.modelSettings!

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback
const integerInRange = (value: unknown, fallback: number, min: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback
const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

export const normalizeModelSettingsOptions = (source: unknown, fallback: ModelOptionUserConfig[] = []) => {
  const rawOptions = Array.isArray(source) ? source : fallback
  const seenNames = new Set<string>()
  const options: ModelOptionUserConfig[] = []
  let changed = !Array.isArray(source)
  rawOptions.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || isLegacyLocalModelName(name) || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : ''
    const locked = Boolean(item.locked)
    const type = stringFromOptions(item.type, modelOptionTypes, locked ? 'standard' : 'custom')
    const option: ModelOptionUserConfig = {
      name,
      displayName: displayName && displayName !== name ? displayName : undefined,
      locked,
      checked: item.checked !== undefined ? Boolean(item.checked) : true,
      type,
      apiProvider: typeof item.apiProvider === 'string' && item.apiProvider.trim() ? item.apiProvider.trim() : 'default'
    }
    options.push(option)
    const allowedKeys = new Set(['name', 'displayName', 'locked', 'checked', 'type', 'apiProvider'])
    if (
      item.name !== option.name ||
      item.displayName !== option.displayName ||
      item.locked !== option.locked ||
      item.checked !== option.checked ||
      item.type !== option.type ||
      item.apiProvider !== option.apiProvider ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized: options,
    changed
  }
}

export const isVisibleModelSettingsOption = (model: ModelOptionUserConfig | SettingsModelOption) => model.name !== 'aiopsterm-local-agent'

export const normalizeTerminalConfig = (source?: Partial<TerminalUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingFontFamily = typeof incoming.fontFamily === 'string' ? incoming.fontFamily.trim() : ''
  const normalized: TerminalSettings = {
    terminalType: stringFromOptions(incoming.terminalType, terminalTypes, defaultTerminalSettings.terminalType),
    fontFamily: incomingFontFamily ? (legacyTerminalFontFamilies.has(incomingFontFamily) ? linuxReadableTerminalFontFamily : incomingFontFamily) : defaultTerminalSettings.fontFamily,
    fontSize: numberInRange(incoming.fontSize, defaultTerminalSettings.fontSize, 8, 64),
    scrollBack: numberInRange(incoming.scrollBack, defaultTerminalSettings.scrollBack, 1, 100000),
    cursorStyle: stringFromOptions(incoming.cursorStyle, terminalCursorStyles, defaultTerminalSettings.cursorStyle),
    cursorBlink: typeof incoming.cursorBlink === 'boolean' ? incoming.cursorBlink : defaultTerminalSettings.cursorBlink,
    lineHeight: numberInRange(incoming.lineHeight, defaultTerminalSettings.lineHeight, 1, 3),
    pinchZoomStatus: typeof incoming.pinchZoomStatus === 'boolean' ? incoming.pinchZoomStatus : defaultTerminalSettings.pinchZoomStatus,
    showCloseButton: typeof incoming.showCloseButton === 'boolean' ? incoming.showCloseButton : defaultTerminalSettings.showCloseButton,
    sshAgentsStatus: typeof incoming.sshAgentsStatus === 'boolean' ? incoming.sshAgentsStatus : defaultTerminalSettings.sshAgentsStatus,
    middleMouseEvent: stringFromOptions(incoming.middleMouseEvent, middleMouseEventActions, defaultTerminalSettings.middleMouseEvent),
    rightMouseEvent: stringFromOptions(incoming.rightMouseEvent, rightMouseEventActions, defaultTerminalSettings.rightMouseEvent)
  }

  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof TerminalSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

export const isTerminalSettingsSnapshot = (source: unknown): source is TerminalUserConfig => {
  if (!isRecord(source)) return false
  return (
    (terminalTypes as readonly string[]).includes(source.terminalType as string) &&
    typeof source.fontFamily === 'string' &&
    source.fontFamily.trim().length > 0 &&
    typeof source.fontSize === 'number' &&
    Number.isFinite(source.fontSize) &&
    typeof source.scrollBack === 'number' &&
    Number.isFinite(source.scrollBack) &&
    (terminalCursorStyles as readonly string[]).includes(source.cursorStyle as string) &&
    typeof source.cursorBlink === 'boolean' &&
    typeof source.lineHeight === 'number' &&
    Number.isFinite(source.lineHeight) &&
    typeof source.pinchZoomStatus === 'boolean' &&
    typeof source.showCloseButton === 'boolean' &&
    typeof source.sshAgentsStatus === 'boolean' &&
    middleMouseEventActions.includes(source.middleMouseEvent as TerminalMouseEventAction) &&
    rightMouseEventActions.includes(source.rightMouseEvent as TerminalSettings['rightMouseEvent'])
  )
}

export const normalizeWorkspacePreferences = (source?: Partial<WorkspaceUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingExpandedGroups = Array.isArray(incoming.expandedGroups)
    ? incoming.expandedGroups.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.expandedGroups
  const incomingRecentAssetIds = Array.isArray(incoming.recentAssetIds)
    ? incoming.recentAssetIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.recentAssetIds || []
  const normalized: WorkspaceUserConfig = {
    expandedGroups: Array.from(new Set(incomingExpandedGroups)),
    showIpMode: typeof incoming.showIpMode === 'boolean' ? incoming.showIpMode : defaultWorkspacePreferences.showIpMode,
    recentAssetIds: Array.from(new Set(incomingRecentAssetIds)).slice(0, 10)
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.expandedGroups) ||
    !Array.isArray(incoming.recentAssetIds) ||
    incoming.expandedGroups.length !== normalized.expandedGroups.length ||
    incoming.expandedGroups.some((item, index) => item !== normalized.expandedGroups[index]) ||
    incoming.showIpMode !== normalized.showIpMode ||
    incoming.recentAssetIds.length !== (normalized.recentAssetIds || []).length ||
    incoming.recentAssetIds.some((item, index) => item !== (normalized.recentAssetIds || [])[index])

  return {
    normalized,
    changed
  }
}

export const isWorkspacePreferencesSnapshot = (source: unknown): source is WorkspaceUserConfig => {
  if (!isRecord(source) || !Array.isArray(source.expandedGroups) || typeof source.showIpMode !== 'boolean' || !Array.isArray(source.recentAssetIds)) return false
  const { changed } = normalizeWorkspacePreferences(source)
  return !changed
}

export const cloneWorkspacePreferencesSnapshot = (preferences: WorkspaceUserConfig): WorkspaceUserConfig => ({
  showIpMode: preferences.showIpMode,
  expandedGroups: [...preferences.expandedGroups],
  recentAssetIds: [...(preferences.recentAssetIds || [])]
})

export const workspacePreferenceSnapshotsMatch = (left: WorkspaceUserConfig, right: WorkspaceUserConfig) =>
  JSON.stringify(cloneWorkspacePreferencesSnapshot(left)) === JSON.stringify(cloneWorkspacePreferencesSnapshot(right))

export const normalizeEditorSettingsConfig = (source?: Partial<EditorUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: EditorSettings = {
    fontSize: numberInRange(incoming.fontSize, defaultEditorSettings.fontSize, 8, 32),
    lineHeight: numberInRange(incoming.lineHeight, defaultEditorSettings.lineHeight, 0, 48),
    fontFamily: typeof incoming.fontFamily === 'string' && incoming.fontFamily.trim() ? incoming.fontFamily.trim() : defaultEditorSettings.fontFamily,
    tabSize: numberInRange(incoming.tabSize, defaultEditorSettings.tabSize, 1, 8),
    wordWrap: stringFromOptions(incoming.wordWrap, editorWordWrapValues, defaultEditorSettings.wordWrap),
    minimap: typeof incoming.minimap === 'boolean' ? incoming.minimap : defaultEditorSettings.minimap,
    mouseWheelZoom: typeof incoming.mouseWheelZoom === 'boolean' ? incoming.mouseWheelZoom : defaultEditorSettings.mouseWheelZoom
  }

  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof EditorSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

export const isEditorSettingsSnapshot = (source: unknown): source is EditorUserConfig => {
  if (!isRecord(source)) return false
  return (
    typeof source.fontSize === 'number' &&
    Number.isFinite(source.fontSize) &&
    typeof source.lineHeight === 'number' &&
    Number.isFinite(source.lineHeight) &&
    typeof source.fontFamily === 'string' &&
    source.fontFamily.trim().length > 0 &&
    typeof source.tabSize === 'number' &&
    Number.isFinite(source.tabSize) &&
    editorWordWrapValues.includes(source.wordWrap as EditorSettings['wordWrap']) &&
    typeof source.minimap === 'boolean' &&
    typeof source.mouseWheelZoom === 'boolean'
  )
}

export const normalizeSshProxyConfigs = (source?: unknown) => {
  const rawConfigs = Array.isArray(source) ? source : []
  const seenNames = new Set<string>()
  let changed = !Array.isArray(source)
  const normalized: SshProxyConfig[] = []

  rawConfigs.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const host = typeof item.host === 'string' ? item.host.trim() : ''
    if (!name || !host || seenNames.has(name)) {
      changed = true
      return
    }
    const proxyConfig: SshProxyConfig = {
      name,
      type: stringFromOptions(item.type, sshProxyTypes, 'SOCKS5'),
      host,
      port: numberInRange(item.port, 22, 1, 65535),
      enableProxyIdentity: typeof item.enableProxyIdentity === 'boolean' ? item.enableProxyIdentity : false,
      username: typeof item.username === 'string' ? item.username : '',
      password: typeof item.password === 'string' ? item.password : ''
    }
    seenNames.add(name)
    normalized.push(proxyConfig)
    const allowedKeys = new Set(['name', 'type', 'host', 'port', 'enableProxyIdentity', 'username', 'password'])
    if (
      item.name !== proxyConfig.name ||
      item.type !== proxyConfig.type ||
      item.host !== proxyConfig.host ||
      item.port !== proxyConfig.port ||
      item.enableProxyIdentity !== proxyConfig.enableProxyIdentity ||
      item.username !== proxyConfig.username ||
      item.password !== proxyConfig.password ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

export const normalizeSshAgentKeys = (source?: unknown) => {
  const rawKeys = Array.isArray(source) ? source : []
  const seenIds = new Set<string>()
  const seenKeyChainIds = new Set<string>()
  let changed = !Array.isArray(source)
  const normalized: SshAgentKeyConfig[] = []

  rawKeys.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    const keyChainIdSource = typeof item.keyChainId === 'string' ? item.keyChainId.trim() : typeof item.key === 'string' ? item.key.trim() : ''
    const keyChainId = keyChainIdSource || id
    if (!id || !fingerprint || !comment || seenIds.has(id) || seenKeyChainIds.has(keyChainId)) {
      changed = true
      return
    }
    const key: SshAgentKeyConfig = {
      id,
      fingerprint,
      comment,
      keyType: typeof item.keyType === 'string' && item.keyType.trim() ? item.keyType.trim().toUpperCase() : 'UNKNOWN',
      keyChainId
    }
    seenIds.add(id)
    seenKeyChainIds.add(keyChainId)
    normalized.push(key)
    const allowedKeys = new Set(['id', 'fingerprint', 'comment', 'keyType', 'keyChainId'])
    if (
      item.id !== key.id ||
      item.fingerprint !== key.fingerprint ||
      item.comment !== key.comment ||
      item.keyType !== key.keyType ||
      item.keyChainId !== key.keyChainId ||
      Object.keys(item).some((itemKey) => !allowedKeys.has(itemKey))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

export const sshProxyConfigSnapshotsMatch = (left: SshProxyConfig[], right: SshProxyConfig[]) =>
  JSON.stringify(normalizeSshProxyConfigs(left).normalized) === JSON.stringify(normalizeSshProxyConfigs(right).normalized)

export const sshAgentKeySnapshotsMatch = (left: SshAgentKeyConfig[], right: SshAgentKeyConfig[]) =>
  JSON.stringify(normalizeSshAgentKeys(left).normalized) === JSON.stringify(normalizeSshAgentKeys(right).normalized)

export const normalizeSshAgentKeychainOptions = (source?: unknown): SshAgentKeychainOption[] => {
  const rawOptions = Array.isArray(source) ? source : []
  const seenKeys = new Set<string>()
  const normalized: SshAgentKeychainOption[] = []

  rawOptions.forEach((item) => {
    if (!isRecord(item)) return
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    const keyType = typeof item.keyType === 'string' ? item.keyType.trim().toUpperCase() : ''
    if (!key || !label || !fingerprint || !keyType || seenKeys.has(key)) return
    seenKeys.add(key)
    normalized.push({ key, label, fingerprint, keyType })
  })

  return normalized
}

export const readSshAgentKeychainOptionsSnapshot = (source: unknown): SshAgentKeychainOption[] | null => {
  if (!Array.isArray(source)) return null
  const normalized = normalizeSshAgentKeychainOptions(source)
  return normalized.length === source.length ? normalized : null
}

const booleanFromExtensionStatus = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 2) return false
  return fallback
}

export const normalizeExtensionSettingsConfig = (source?: Partial<ExtensionSettings>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: ExtensionSettings = {
    autoCompleteStatus: booleanFromExtensionStatus(incoming.autoCompleteStatus, defaultExtensionSettings.autoCompleteStatus),
    quickVimStatus: booleanFromExtensionStatus(incoming.quickVimStatus, defaultExtensionSettings.quickVimStatus),
    aliasStatus: booleanFromExtensionStatus(incoming.aliasStatus, defaultExtensionSettings.aliasStatus),
    highlightStatus: booleanFromExtensionStatus(incoming.highlightStatus, defaultExtensionSettings.highlightStatus)
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof ExtensionSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

export const normalizeKeywordHighlightConfig = (source?: unknown) => {
  const incomingRoot = isRecord(source) ? source : {}
  const incoming = isRecord(incomingRoot['keyword-highlight']) ? incomingRoot['keyword-highlight'] : {}
  const incomingApplyTo = isRecord(incoming.applyTo) ? incoming.applyTo : {}
  const rawRules = Array.isArray(incoming.rules) ? incoming.rules : defaultKeywordHighlightSettings['keyword-highlight'].rules
  const seenNames = new Set<string>()
  let changed = !isRecord(source) || !isRecord(incomingRoot['keyword-highlight']) || !isRecord(incoming.applyTo) || !Array.isArray(incoming.rules)

  const rules: KeywordHighlightRuleConfig[] = []
  rawRules.forEach((item, index) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Rule ${index + 1}`
    if (seenNames.has(name)) {
      changed = true
      return
    }
    const rawPattern = item.pattern
    const pattern = Array.isArray(rawPattern)
      ? rawPattern.filter((patternItem): patternItem is string => typeof patternItem === 'string' && patternItem.trim().length > 0).map((patternItem) => patternItem.trim())
      : typeof rawPattern === 'string' && rawPattern.trim()
        ? rawPattern.trim()
        : ''
    if ((Array.isArray(pattern) && pattern.length === 0) || (!Array.isArray(pattern) && !pattern)) {
      changed = true
      return
    }
    const incomingStyle = isRecord(item.style) ? item.style : {}
    const rule: KeywordHighlightRuleConfig = {
      name,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      scope: stringFromOptions(item.scope, keywordHighlightScopes, 'output'),
      matchType: stringFromOptions(item.matchType, keywordHighlightMatchTypes, 'regex'),
      pattern,
      style: {
        foreground:
          typeof incomingStyle.foreground === 'string' && keywordHighlightHexColorPattern.test(incomingStyle.foreground)
            ? incomingStyle.foreground.toUpperCase()
            : '#FF4D4F',
        fontStyle: stringFromOptions(incomingStyle.fontStyle, keywordHighlightFontStyles, 'bold')
      }
    }
    seenNames.add(name)
    rules.push(rule)
    const allowedKeys = new Set(['name', 'enabled', 'scope', 'matchType', 'pattern', 'style'])
    const allowedStyleKeys = new Set(['foreground', 'fontStyle'])
    if (
      item.name !== rule.name ||
      item.enabled !== rule.enabled ||
      item.scope !== rule.scope ||
      item.matchType !== rule.matchType ||
      JSON.stringify(item.pattern) !== JSON.stringify(rule.pattern) ||
      !isRecord(item.style) ||
      incomingStyle.foreground !== rule.style.foreground ||
      incomingStyle.fontStyle !== rule.style.fontStyle ||
      Object.keys(item).some((key) => !allowedKeys.has(key)) ||
      Object.keys(incomingStyle).some((key) => !allowedStyleKeys.has(key))
    ) {
      changed = true
    }
  })

  const normalized: KeywordHighlightSettings = {
    'keyword-highlight': {
      enabled: incoming.enabled !== undefined ? Boolean(incoming.enabled) : defaultKeywordHighlightSettings['keyword-highlight'].enabled,
      applyTo: {
        output: incomingApplyTo.output !== undefined ? Boolean(incomingApplyTo.output) : defaultKeywordHighlightSettings['keyword-highlight'].applyTo.output,
        input: incomingApplyTo.input !== undefined ? Boolean(incomingApplyTo.input) : defaultKeywordHighlightSettings['keyword-highlight'].applyTo.input
      },
      rules
    }
  }

  if (
    incoming.enabled !== normalized['keyword-highlight'].enabled ||
    incomingApplyTo.output !== normalized['keyword-highlight'].applyTo.output ||
    incomingApplyTo.input !== normalized['keyword-highlight'].applyTo.input
  ) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

export const keywordHighlightEditorContentFromFile = (content: string) => (content.trim() ? content : JSON.stringify(defaultKeywordHighlightSettings, null, 2))

export const parseKeywordHighlightEditorContent = (content: string) => JSON.parse(content)

export const normalizeSecurityConfig = (source?: unknown) => {
  const incomingRoot = isRecord(source) ? source : {}
  const incoming = isRecord(incomingRoot.security) ? incomingRoot.security : {}
  const incomingPolicy = isRecord(incoming.securityPolicy) ? incoming.securityPolicy : {}
  const defaults = defaultSecuritySettings.security
  const blacklist = normalizeStringArray(incoming.blacklistPatterns, defaults.blacklistPatterns)
  const whitelist = normalizeStringArray(incoming.whitelistPatterns, defaults.whitelistPatterns)
  const dangerous = normalizeStringArray(incoming.dangerousCommands, defaults.dangerousCommands)
  const normalized: SecuritySettings = {
    security: {
      enableCommandSecurity: incoming.enableCommandSecurity !== undefined ? Boolean(incoming.enableCommandSecurity) : defaults.enableCommandSecurity,
      enableStrictMode: incoming.enableStrictMode !== undefined ? Boolean(incoming.enableStrictMode) : defaults.enableStrictMode,
      blacklistPatterns: blacklist.normalized,
      whitelistPatterns: whitelist.normalized,
      dangerousCommands: dangerous.normalized,
      maxCommandLength: numberInRange(incoming.maxCommandLength, defaults.maxCommandLength, 1, 100000),
      securityPolicy: {
        blockCritical: incomingPolicy.blockCritical !== undefined ? Boolean(incomingPolicy.blockCritical) : defaults.securityPolicy.blockCritical,
        askForMedium: incomingPolicy.askForMedium !== undefined ? Boolean(incomingPolicy.askForMedium) : defaults.securityPolicy.askForMedium,
        askForHigh: incomingPolicy.askForHigh !== undefined ? Boolean(incomingPolicy.askForHigh) : defaults.securityPolicy.askForHigh,
        askForBlacklist: incomingPolicy.askForBlacklist !== undefined ? Boolean(incomingPolicy.askForBlacklist) : defaults.securityPolicy.askForBlacklist
      }
    }
  }

  const allowedRootKeys = new Set(['security'])
  const allowedSecurityKeys = new Set([
    'enableCommandSecurity',
    'enableStrictMode',
    'blacklistPatterns',
    'whitelistPatterns',
    'dangerousCommands',
    'maxCommandLength',
    'securityPolicy'
  ])
  const allowedPolicyKeys = new Set(['blockCritical', 'askForMedium', 'askForHigh', 'askForBlacklist'])
  const changed =
    !isRecord(source) ||
    !isRecord(incomingRoot.security) ||
    !isRecord(incoming.securityPolicy) ||
    blacklist.changed ||
    whitelist.changed ||
    dangerous.changed ||
    incoming.enableCommandSecurity !== normalized.security.enableCommandSecurity ||
    incoming.enableStrictMode !== normalized.security.enableStrictMode ||
    incoming.maxCommandLength !== normalized.security.maxCommandLength ||
    incomingPolicy.blockCritical !== normalized.security.securityPolicy.blockCritical ||
    incomingPolicy.askForMedium !== normalized.security.securityPolicy.askForMedium ||
    incomingPolicy.askForHigh !== normalized.security.securityPolicy.askForHigh ||
    incomingPolicy.askForBlacklist !== normalized.security.securityPolicy.askForBlacklist ||
    Object.keys(incomingRoot).some((key) => !allowedRootKeys.has(key)) ||
    Object.keys(incoming).some((key) => !allowedSecurityKeys.has(key)) ||
    Object.keys(incomingPolicy).some((key) => !allowedPolicyKeys.has(key))

  return {
    normalized,
    changed
  }
}

const normalizeStringArray = (source: unknown, fallback: string[]) => {
  if (!Array.isArray(source)) return { normalized: [...fallback], changed: true }
  const normalized = source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  return {
    normalized,
    changed: normalized.length !== source.length || normalized.some((item, index) => item !== source[index])
  }
}

export const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

export const securityEditorContentFromFile = (content: string) => {
  if (!content.trim()) {
    return JSON.stringify(defaultSecuritySettings, null, 2)
  }
  const cleaned = removeJsonComments(content)
  if (!cleaned) {
    return content
  }
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    return content
  }
}

export const parseSecurityEditorContent = (content: string) => JSON.parse(removeJsonComments(content))

export const keywordHighlightSettingsSnapshotsMatch = (left: KeywordHighlightSettings, right: KeywordHighlightSettings) =>
  JSON.stringify(normalizeKeywordHighlightConfig(left).normalized) === JSON.stringify(normalizeKeywordHighlightConfig(right).normalized)

export const securitySettingsSnapshotsMatch = (left: SecuritySettings, right: SecuritySettings) =>
  JSON.stringify(normalizeSecurityConfig(left).normalized) === JSON.stringify(normalizeSecurityConfig(right).normalized)

const privacyStatusFromOptions = (value: unknown, fallback: PrivacyUserConfig['telemetry']) =>
  stringFromOptions(value, privacyStatusValues, fallback)

export const normalizePrivacyConfig = (source?: Partial<PrivacyUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: PrivacyUserConfig = {
    telemetry: privacyStatusFromOptions(incoming.telemetry, defaultPrivacySettings.telemetry),
    secretRedaction: privacyStatusFromOptions(incoming.secretRedaction, defaultPrivacySettings.secretRedaction),
    dataSync: privacyStatusFromOptions(incoming.dataSync, defaultPrivacySettings.dataSync)
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof PrivacyUserConfig>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

export const isPrivacyRuntimeSnapshotForRequest = (source: unknown, expectedPrivacy: PrivacyUserConfig): source is PrivacyRuntimeApplyData =>
  isRecord(source) &&
  source.telemetry === expectedPrivacy.telemetry &&
  source.dataSync === expectedPrivacy.dataSync &&
  typeof source.appliedAt === 'string' &&
  source.appliedAt.trim() !== '' &&
  privacyRuntimeValues.includes(source.dataSyncRuntime as (typeof privacyRuntimeValues)[number]) &&
  (expectedPrivacy.dataSync === 'enabled' || source.dataSyncRuntime === 'disabled') &&
  (source.syncStatus === undefined || privacySyncStatusValues.includes(source.syncStatus as (typeof privacySyncStatusValues)[number])) &&
  (expectedPrivacy.dataSync === 'enabled' || source.syncStatus === undefined || source.syncStatus === 'disabled') &&
  (source.syncRunId === undefined || typeof source.syncRunId === 'string') &&
  (source.stateFilePath === undefined || typeof source.stateFilePath === 'string') &&
  (source.lastSyncAt === undefined || typeof source.lastSyncAt === 'string') &&
  (source.errorMessage === undefined || typeof source.errorMessage === 'string') &&
  (source.syncedScopes === undefined ||
    (Array.isArray(source.syncedScopes) && source.syncedScopes.every((scope) => privacySyncedScopeValues.includes(scope as (typeof privacySyncedScopeValues)[number])))) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

export const privacyRuntimeSettingsFromSnapshot = (snapshot?: PrivacyRuntimeApplyData | null) => ({
  dataSyncRuntime: snapshot?.dataSyncRuntime || 'disabled',
  dataSyncStatus: snapshot?.syncStatus || (snapshot?.dataSync === 'enabled' ? 'idle' : 'disabled'),
  dataSyncRunId: snapshot?.syncRunId || '',
  dataSyncStateFilePath: snapshot?.stateFilePath || '',
  dataSyncLastSyncAt: snapshot?.lastSyncAt || '',
  dataSyncSyncedScopes: snapshot?.syncedScopes ? [...snapshot.syncedScopes] : [],
  dataSyncErrorMessage: snapshot?.errorMessage || ''
})

export const normalizeNotificationConfig = (source?: Partial<NotificationUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: NotificationUserConfig = {
    desktopNotifications: typeof incoming.desktopNotifications === 'boolean' ? incoming.desktopNotifications : defaultNotificationSettings.desktopNotifications,
    controlNotificationBell: typeof incoming.controlNotificationBell === 'boolean' ? incoming.controlNotificationBell : defaultNotificationSettings.controlNotificationBell
  }
  const changed =
    isRecord(source) &&
    (incoming.desktopNotifications !== normalized.desktopNotifications ||
      incoming.controlNotificationBell !== normalized.controlNotificationBell ||
      Object.keys(incoming).some((key) => key !== 'desktopNotifications' && key !== 'controlNotificationBell'))

  return {
    normalized,
    changed
  }
}

export const isAiPreferencesSnapshot = (source: unknown): source is AiPreferencesUserConfig => {
  if (!isRecord(source) || !isRecord(source.proxy)) return false
  return (
    typeof source.enableExtendedThinking === 'boolean' &&
    typeof source.thinkingBudgetTokens === 'number' &&
    Number.isFinite(source.thinkingBudgetTokens) &&
    typeof source.autoExecuteReadOnlyCommands === 'boolean' &&
    typeof source.commandOutputFilteringEnabled === 'boolean' &&
    typeof source.kbSearchEnabled === 'boolean' &&
    typeof source.experienceExtractionEnabled === 'boolean' &&
    typeof source.managedAiAutoNamingEnabled === 'boolean' &&
    typeof source.autoApproval === 'boolean' &&
    reasoningEffortValues.includes(source.reasoningEffort as AiPreferenceSettings['reasoningEffort']) &&
    typeof source.needProxy === 'boolean' &&
    proxyTypeValues.includes(source.proxy.type as AiPreferenceSettings['proxy']['type']) &&
    typeof source.proxy.host === 'string' &&
    typeof source.proxy.port === 'number' &&
    Number.isFinite(source.proxy.port) &&
    typeof source.proxy.enableProxyIdentity === 'boolean' &&
    typeof source.proxy.username === 'string' &&
    typeof source.proxy.password === 'string' &&
    typeof source.shellIntegrationTimeout === 'number' &&
    Number.isFinite(source.shellIntegrationTimeout)
  )
}

export const isKnowledgeSearchRuntimeSnapshotForRequest = (source: unknown, expectedEnabled: boolean): source is KnowledgeSearchRuntimeApplyData =>
  isRecord(source) &&
  source.enabled === expectedEnabled &&
  source.source === 'settings' &&
  typeof source.appliedAt === 'string' &&
  source.appliedAt.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const normalizeThinkingBudget = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value === 0) return 0
  return Math.min(6553, Math.max(1024, Math.round(value)))
}

export const normalizeAiPreferencesConfig = (source?: Partial<AiPreferencesUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProxy: Record<string, unknown> = isRecord(incoming.proxy) ? incoming.proxy : {}
  const normalized: AiPreferenceSettings = {
    enableExtendedThinking: typeof incoming.enableExtendedThinking === 'boolean' ? incoming.enableExtendedThinking : defaultAiPreferencesConfig.enableExtendedThinking,
    thinkingBudgetTokens: normalizeThinkingBudget(incoming.thinkingBudgetTokens, defaultAiPreferencesConfig.thinkingBudgetTokens),
    autoExecuteReadOnlyCommands:
      typeof incoming.autoExecuteReadOnlyCommands === 'boolean' ? incoming.autoExecuteReadOnlyCommands : defaultAiPreferencesConfig.autoExecuteReadOnlyCommands,
    commandOutputFilteringEnabled:
      typeof incoming.commandOutputFilteringEnabled === 'boolean' ? incoming.commandOutputFilteringEnabled : defaultAiPreferencesConfig.commandOutputFilteringEnabled,
    kbSearchEnabled: typeof incoming.kbSearchEnabled === 'boolean' ? incoming.kbSearchEnabled : defaultAiPreferencesConfig.kbSearchEnabled,
    experienceExtractionEnabled:
      typeof incoming.experienceExtractionEnabled === 'boolean' ? incoming.experienceExtractionEnabled : defaultAiPreferencesConfig.experienceExtractionEnabled,
    managedAiAutoNamingEnabled:
      typeof incoming.managedAiAutoNamingEnabled === 'boolean'
        ? incoming.managedAiAutoNamingEnabled
        : defaultAiPreferencesConfig.managedAiAutoNamingEnabled,
    autoApproval: typeof incoming.autoApproval === 'boolean' ? incoming.autoApproval : defaultAiPreferencesConfig.autoApproval,
    reasoningEffort: stringFromOptions(incoming.reasoningEffort, reasoningEffortValues, defaultAiPreferencesConfig.reasoningEffort),
    needProxy: typeof incoming.needProxy === 'boolean' ? incoming.needProxy : defaultAiPreferencesConfig.needProxy,
    proxy: {
      type: stringFromOptions(incomingProxy.type, proxyTypeValues, defaultAiPreferencesConfig.proxy.type),
      host: typeof incomingProxy.host === 'string' ? incomingProxy.host : defaultAiPreferencesConfig.proxy.host,
      port: numberInRange(incomingProxy.port, defaultAiPreferencesConfig.proxy.port, 1, 65535),
      enableProxyIdentity:
        typeof incomingProxy.enableProxyIdentity === 'boolean' ? incomingProxy.enableProxyIdentity : defaultAiPreferencesConfig.proxy.enableProxyIdentity,
      username: typeof incomingProxy.username === 'string' ? incomingProxy.username : defaultAiPreferencesConfig.proxy.username,
      password: typeof incomingProxy.password === 'string' ? incomingProxy.password : defaultAiPreferencesConfig.proxy.password
    },
    shellIntegrationTimeout: numberInRange(incoming.shellIntegrationTimeout, defaultAiPreferencesConfig.shellIntegrationTimeout, 1, 300)
  }

  if (!normalized.enableExtendedThinking) {
    normalized.thinkingBudgetTokens = 0
  } else if (normalized.thinkingBudgetTokens === 0) {
    normalized.thinkingBudgetTokens = 1024
  }

  const comparable = {
    ...incoming,
    proxy: incomingProxy
  }
  const changed = !isRecord(source) || JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

export const normalizeModelProviderConfig = (source: unknown, fallback: ModelProviderSettings): ModelProviderSettings => {
  const incoming = isRecord(source) ? source : {}
  return {
    baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl.trim() : fallback.baseUrl,
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : fallback.apiKey,
    modelId: typeof incoming.modelId === 'string' && incoming.modelId.trim() ? incoming.modelId.trim() : fallback.modelId,
    ...(fallback.apiFormat || incoming.apiFormat
      ? {
          apiFormat: stringFromOptions(incoming.apiFormat, modelApiFormats, fallback.apiFormat || 'chat-completions')
        }
      : {}),
    ...(fallback.awsAccessKey !== undefined || incoming.awsAccessKey !== undefined
      ? {
          awsAccessKey: typeof incoming.awsAccessKey === 'string' ? incoming.awsAccessKey : fallback.awsAccessKey || ''
        }
      : {}),
    ...(fallback.awsSecretKey !== undefined || incoming.awsSecretKey !== undefined
      ? {
          awsSecretKey: typeof incoming.awsSecretKey === 'string' ? incoming.awsSecretKey : fallback.awsSecretKey || ''
        }
      : {}),
    ...(fallback.awsSessionToken !== undefined || incoming.awsSessionToken !== undefined
      ? {
          awsSessionToken: typeof incoming.awsSessionToken === 'string' ? incoming.awsSessionToken : fallback.awsSessionToken || ''
        }
      : {}),
    ...(fallback.awsRegion !== undefined || incoming.awsRegion !== undefined
      ? {
          awsRegion: typeof incoming.awsRegion === 'string' && incoming.awsRegion.trim() ? incoming.awsRegion.trim() : fallback.awsRegion || 'us-east-1'
        }
      : {}),
    ...(fallback.awsUseCrossRegionInference !== undefined || incoming.awsUseCrossRegionInference !== undefined
      ? {
          awsUseCrossRegionInference:
            typeof incoming.awsUseCrossRegionInference === 'boolean'
              ? incoming.awsUseCrossRegionInference
              : Boolean(fallback.awsUseCrossRegionInference)
        }
      : {}),
    ...(fallback.awsEndpointSelected !== undefined || incoming.awsEndpointSelected !== undefined
      ? {
          awsEndpointSelected: typeof incoming.awsEndpointSelected === 'boolean' ? incoming.awsEndpointSelected : Boolean(fallback.awsEndpointSelected)
        }
      : {}),
    ...(fallback.awsBedrockEndpoint !== undefined || incoming.awsBedrockEndpoint !== undefined
      ? {
          awsBedrockEndpoint: typeof incoming.awsBedrockEndpoint === 'string' ? incoming.awsBedrockEndpoint.trim() : fallback.awsBedrockEndpoint || ''
        }
      : {})
  }
}

export const normalizeModelSettingsConfig = (source?: unknown, fallbackOptions: ModelOptionUserConfig[] = defaultModelSettingsConfig.options) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProviders = isRecord(incoming.providers) ? incoming.providers : {}
  const providers: ModelSettingsUserConfig['providers'] = {
    litellm: normalizeModelProviderConfig(incomingProviders.litellm, defaultModelSettingsConfig.providers.litellm),
    openai: normalizeModelProviderConfig(incomingProviders.openai, defaultModelSettingsConfig.providers.openai),
    bedrock: normalizeModelProviderConfig(incomingProviders.bedrock, defaultModelSettingsConfig.providers.bedrock),
    deepseek: normalizeModelProviderConfig(incomingProviders.deepseek, defaultModelSettingsConfig.providers.deepseek),
    anthropic: normalizeModelProviderConfig(incomingProviders.anthropic, defaultModelSettingsConfig.providers.anthropic),
    ollama: normalizeModelProviderConfig(incomingProviders.ollama, defaultModelSettingsConfig.providers.ollama),
    lmstudio: normalizeModelProviderConfig(incomingProviders.lmstudio, defaultModelSettingsConfig.providers.lmstudio)
  }

  const { normalized: options, changed: optionsChanged } = normalizeModelSettingsOptions(incoming.options, fallbackOptions)
  let changed = !isRecord(source) || !isRecord(incoming.providers) || optionsChanged

  const normalized: ModelSettingsUserConfig = {
    addModelSwitch: typeof incoming.addModelSwitch === 'boolean' ? incoming.addModelSwitch : defaultModelSettingsConfig.addModelSwitch,
    providers,
    options
  }
  if (incoming.addModelSwitch !== normalized.addModelSwitch || JSON.stringify(incomingProviders) !== JSON.stringify(providers)) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

const modelProviderSettingsMatch = (left: ModelProviderSettings, right: ModelProviderSettings) => JSON.stringify(left) === JSON.stringify(right)

export const modelOptionsSnapshotsMatch = (left: ModelOptionUserConfig[], right: ModelOptionUserConfig[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index]
    return (
      Boolean(other) &&
      item.name === other.name &&
      item.displayName === other.displayName &&
      item.locked === other.locked &&
      item.checked === other.checked &&
      item.type === other.type &&
      item.apiProvider === other.apiProvider
    )
  })

export const modelSettingsSnapshotsMatch = (left: ModelSettingsUserConfig, right: ModelSettingsUserConfig) =>
  left.addModelSwitch === right.addModelSwitch &&
  modelProviderSettingsMatch(left.providers.litellm, right.providers.litellm) &&
  modelProviderSettingsMatch(left.providers.openai, right.providers.openai) &&
  modelProviderSettingsMatch(left.providers.bedrock, right.providers.bedrock) &&
  modelProviderSettingsMatch(left.providers.deepseek, right.providers.deepseek) &&
  modelProviderSettingsMatch(left.providers.anthropic, right.providers.anthropic) &&
  modelProviderSettingsMatch(left.providers.ollama, right.providers.ollama) &&
  modelProviderSettingsMatch(left.providers.lmstudio, right.providers.lmstudio) &&
  modelOptionsSnapshotsMatch(left.options, right.options)

export const modelOptionProviderForSavedProvider = (provider: ModelProviderKey): string => (provider === 'openai' ? 'openai' : provider)

export type GeneralBaseSettingsPatch = Partial<Pick<UserConfig, 'defaultMode' | 'language' | 'watermark'>>
export type LayoutPreferencesPatch = Partial<
  Pick<UserConfig, 'defaultMode' | 'leftPanelOpen' | 'rightPanelOpen' | 'agentsLeftOpen' | 'leftPanelWidth' | 'rightPanelWidth' | 'agentsLeftWidth'>
>
export type BackgroundUserConfig = UserConfig['background']
export type McpServersConfigNormalization = ReturnType<typeof normalizeMcpServersConfig>

export const createKbRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

export const knowledgeNodeSize = (node: KnowledgeNode): number => (node.size || 0) + (node.children?.reduce((total, child) => total + knowledgeNodeSize(child), 0) || 0)

export const knowledgeTreeSize = (nodes: KnowledgeNode[]) => nodes.reduce((total, node) => total + knowledgeNodeSize(node), 0)

export const defaultMcpConfigFile = (): McpConfigFile => ({
  mcpServers: Object.fromEntries(
    defaultMcpServers.map((server) => {
      const autoApprove = server.tools.filter((tool) => tool.autoApprove).map((tool) => tool.name)
      return [
        server.name,
        {
          type: 'stdio' as const,
          disabled: server.disabled,
          ...(autoApprove.length ? { autoApprove } : {}),
          command: server.name === 'filesystem' ? 'npx' : server.name,
          args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', '~'] : [],
          timeout: 60
        }
      ]
    })
  )
})

export const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = value.type === 'sse' || value.type === 'streamableHttp' ? value.type : 'stdio'
    const autoApprove = Array.isArray(value.autoApprove)
      ? value.autoApprove.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : undefined
    const args = Array.isArray(value.args)
      ? value.args
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined
    const stringRecord = (record: unknown) =>
      isRecord(record) ? Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined
    mcpServers[name.trim()] = {
      type,
      ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      ...(autoApprove?.length ? { autoApprove } : {}),
      ...(typeof value.timeout === 'number' && value.timeout > 0 ? { timeout: value.timeout } : {}),
      ...(typeof value.command === 'string' && value.command.trim() ? { command: value.command.trim() } : {}),
      ...(args?.length ? { args } : {}),
      ...(typeof value.cwd === 'string' && value.cwd.trim() ? { cwd: value.cwd.trim() } : {}),
      ...(stringRecord(value.env) ? { env: stringRecord(value.env) } : {}),
      ...(typeof value.url === 'string' && value.url.trim() ? { url: value.url.trim() } : {}),
      ...(stringRecord(value.headers) ? { headers: stringRecord(value.headers) } : {})
    }
  })
  return { mcpServers }
}

export const mcpConfigFilesMatch = (left: McpConfigFile, right: McpConfigFile) =>
  JSON.stringify(normalizeMcpConfigFile(left)) === JSON.stringify(normalizeMcpConfigFile(right))

export const normalizeQuickCommandsConfig = (source?: Partial<QuickCommandsUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const rawGroups = Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups
  const rawSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  const groupUuids = new Set<string>()
  const snippetIds = new Set<number>()
  const snippetUuids = new Set<string>()

  const groups = rawGroups
    .map((item, index): QuickCommandGroupConfig | null => {
      if (!isRecord(item)) return null
      const groupName = typeof item.group_name === 'string' ? item.group_name.trim() : ''
      if (!groupName) return null
      const uuid = typeof item.uuid === 'string' ? item.uuid.trim() : ''
      if (!uuid) return null
      if (groupUuids.has(uuid)) return null
      groupUuids.add(uuid)
      return {
        id: integerInRange(item.id, index + 1, 1),
        uuid,
        group_name: groupName
      }
    })
    .filter(Boolean) as QuickCommandGroupConfig[]

  const normalizedSnippets: QuickCommandSnippetConfig[] = []
  rawSnippets.forEach((item, index) => {
    if (!isRecord(item)) return
    const snippetName = typeof item.snippet_name === 'string' ? item.snippet_name.trim() : ''
    const snippetContent = typeof item.snippet_content === 'string' ? item.snippet_content : ''
    if (!snippetName || !snippetContent) return

    let id = integerInRange(item.id, index + 1, 1)
    while (snippetIds.has(id)) id += 1
    snippetIds.add(id)

    const uuid = typeof item.uuid === 'string' ? item.uuid.trim() : ''
    if (!uuid) return
    if (snippetUuids.has(uuid)) return
    snippetUuids.add(uuid)

    const groupUuid = typeof item.group_uuid === 'string' && groupUuids.has(item.group_uuid) ? item.group_uuid : null
    const snippet: QuickCommandSnippetConfig = {
      id,
      uuid,
      snippet_name: snippetName,
      snippet_content: snippetContent,
      group_uuid: groupUuid
    }
    if (typeof item.create_at === 'string') snippet.create_at = item.create_at
    if (typeof item.update_at === 'string') snippet.update_at = item.update_at
    normalizedSnippets.push(snippet)
  })

  const normalized: QuickCommandsUserConfig = {
    groups,
    snippets: normalizedSnippets
  }
  const comparable = {
    groups: Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups,
    snippets: Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.groups) ||
    !Array.isArray(incoming.snippets) ||
    JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const normalizeKnowledgeNodes = (source: unknown, parentRelDir = '', seen = new Set<string>()): KnowledgeNode[] => {
  const rawNodes = Array.isArray(source) ? source : []
  const nodes: KnowledgeNode[] = []
  rawNodes.forEach((item, index) => {
    if (!isRecord(item)) return
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : ''
    if (!rawTitle) return
    const type = item.type === 'dir' || item.type === 'file' ? item.type : 'file'
    const fallbackRelPath = createKbRelPath(parentRelDir, rawTitle)
    const relPath = typeof item.relPath === 'string' && item.relPath.trim() ? item.relPath.trim() : fallbackRelPath
    if (!relPath || seen.has(relPath)) return
    seen.add(relPath)
    const node: KnowledgeNode = {
      id: typeof item.id === 'string' && item.id.trim() ? item.id : `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || index}`,
      key: relPath,
      relPath,
      title: rawTitle,
      type
    }
    if (type === 'file') {
      node.size = numberInRange(item.size, 0, 0)
    } else {
      node.children = normalizeKnowledgeNodes(item.children, relPath, seen)
    }
    nodes.push(node)
  })
  return nodes
}

export const normalizeKnowledgeBaseConfig = (source?: Partial<KnowledgeBaseUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalizedTree = normalizeKnowledgeNodes(Array.isArray(incoming.tree) ? incoming.tree : defaultKnowledgeBase.tree)
  const normalized: KnowledgeBaseUserConfig = {
    tree: normalizedTree,
    usedBytes: numberInRange(incoming.usedBytes, defaultKnowledgeBase.usedBytes, 0),
    totalBytes: numberInRange(incoming.totalBytes, defaultKnowledgeBase.totalBytes, 1)
  }
  if (normalized.usedBytes === 0 && normalizedTree.length > 0 && incoming.usedBytes === undefined) {
    normalized.usedBytes = knowledgeTreeSize(normalizedTree)
  }
  const comparable = {
    tree: Array.isArray(incoming.tree) ? incoming.tree : defaultKnowledgeBase.tree,
    usedBytes: typeof incoming.usedBytes === 'number' ? incoming.usedBytes : defaultKnowledgeBase.usedBytes,
    totalBytes: typeof incoming.totalBytes === 'number' ? incoming.totalBytes : defaultKnowledgeBase.totalBytes
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.tree) ||
    typeof incoming.usedBytes !== 'number' ||
    typeof incoming.totalBytes !== 'number' ||
    JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

export const normalizeAliasCommandsConfig = (source?: AliasCommandConfig[]) => {
  const rawCommands = Array.isArray(source) ? source : defaultAliasCommands
  const seenAliases = new Set<string>()
  const seenIds = new Set<string>()
  const normalized: AliasCommandConfig[] = []

  rawCommands.forEach((item, index) => {
    if (!isRecord(item)) return
    const alias = typeof item.alias === 'string' ? item.alias.trim() : ''
    const command = typeof item.command === 'string' ? item.command.trim() : ''
    if (!alias || !command || seenAliases.has(alias)) return
    let id = typeof item.id === 'string' && item.id.trim() && item.id !== 'new' ? item.id.trim() : ''
    if (!id) return
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenAliases.add(alias)
    seenIds.add(id)
    const commandConfig: AliasCommandConfig = { id, alias, command }
    if (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)) {
      commandConfig.createdAt = item.createdAt
    }
    normalized.push(commandConfig)
  })

  const changed = !Array.isArray(source) || JSON.stringify(source) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const getShortcutParts = (shortcut: string) =>
  shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

export const isValidShortcutForAction = (actionId: string, shortcut: string) => {
  const parts = getShortcutParts(shortcut)
  if (!parts.length) return false
  if (actionId !== 'switchToSpecificTab') return true

  const hasDigit = parts.some((part) => /^\d$/.test(part))
  const hasModifier = parts.some((part) => shortcutModifierTokens.has(part.toLowerCase()))
  return !hasDigit && hasModifier
}

export const normalizeShortcutsConfig = (source?: unknown) => {
  const shortcutsById = new Map<string, ShortcutUserConfig>()
  let changed = !Array.isArray(source)

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!isRecord(item)) {
        changed = true
        return
      }
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const action = typeof item.action === 'string' && item.action.trim() ? item.action.trim() : id
      const shortcut = typeof item.shortcut === 'string' ? item.shortcut.trim() : ''
      if (!id || !action || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      const normalizedShortcut: ShortcutUserConfig = {
        id,
        action,
        shortcut,
        ...(typeof item.suffix === 'string' && item.suffix.trim() ? { suffix: item.suffix.trim() } : {})
      }
      shortcutsById.set(id, normalizedShortcut)
      const allowedKeys = new Set(['id', 'action', 'shortcut', 'suffix'])
      if (
        item.id !== id ||
        item.shortcut !== shortcut ||
        item.action !== action ||
        item.suffix !== normalizedShortcut.suffix ||
        Object.keys(item).some((key) => !allowedKeys.has(key))
      ) {
        changed = true
      }
    })
  } else if (isRecord(source)) {
    Object.entries(source).forEach(([id, value]) => {
      const defaultShortcut = shortcutDefaultsById.get(id)
      const shortcut = typeof value === 'string' ? value.trim() : ''
      if (!defaultShortcut || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      shortcutsById.set(id, { ...defaultShortcut, shortcut })
      if (value !== shortcut) changed = true
    })
  }

  const normalized = Array.from(shortcutsById.values())

  return {
    normalized,
    changed
  }
}

export const normalizeRulesConfig = (source?: unknown, customInstructions?: unknown) => {
  const rawRules = Array.isArray(source) ? source : defaultRules
  const seenIds = new Set<string>()
  const normalized: UserRuleConfig[] = []
  let changed = !Array.isArray(source)

  rawRules.forEach((item, index) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) {
      changed = true
      return
    }
    let id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) {
      changed = true
      return
    }
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    const rule = {
      id,
      content,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true
    }
    normalized.push(rule)
    const allowedKeys = new Set(['id', 'content', 'enabled'])
    if (
      item.id !== rule.id ||
      item.content !== rule.content ||
      item.enabled !== rule.enabled ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  const migratedInstruction = typeof customInstructions === 'string' ? customInstructions.trim() : ''
  if (migratedInstruction) {
    let id = 'rule-custom-instructions'
    let suffix = 1
    while (seenIds.has(id)) {
      suffix += 1
      id = `rule-custom-instructions-${suffix}`
    }
    normalized.unshift({
      id,
      content: migratedInstruction,
      enabled: true
    })
    changed = true
  }

  return {
    normalized,
    changed
  }
}

export const normalizeSkillsConfig = (source?: unknown) => {
  const rawSkills = Array.isArray(source) ? source : defaultSkills
  const seenNames = new Set<string>()
  const normalized: SkillUserConfig[] = []
  let changed = !Array.isArray(source)

  rawSkills.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!name || !description || !content || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const skill: SkillUserConfig = {
      name,
      description,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      editable: item.editable !== undefined ? Boolean(item.editable) : true,
      content
    }
    if (typeof item.path === 'string' && item.path.trim()) {
      skill.path = item.path.trim()
    }
    normalized.push(skill)
    const allowedKeys = new Set(['name', 'description', 'enabled', 'editable', 'content', 'path'])
    if (
      item.name !== skill.name ||
      item.description !== skill.description ||
      item.enabled !== skill.enabled ||
      item.editable !== skill.editable ||
      item.content !== skill.content ||
      item.path !== skill.path ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

export const normalizeMcpToolStatesConfig = (source?: unknown): McpToolStatesUserConfig => {
  if (!isRecord(source)) return { ...defaultMcpToolStates }
  const normalized: McpToolStatesUserConfig = {}
  Object.entries(source).forEach(([key, value]) => {
    if (typeof key === 'string' && key.includes(':') && typeof value === 'boolean') {
      normalized[key] = value
    }
  })
  return normalized
}

export const normalizeMcpServersConfig = (source?: unknown, toolStatesSource?: unknown) => {
  const rawServers = Array.isArray(source) ? source : defaultMcpServers
  const toolStates = normalizeMcpToolStatesConfig(toolStatesSource)
  const seenServers = new Set<string>()
  let changed = !Array.isArray(source)

  const normalized: McpServerUserConfig[] = []
  rawServers.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || seenServers.has(name)) {
      changed = true
      return
    }
    seenServers.add(name)
    const disabled = typeof item.disabled === 'boolean' ? item.disabled : false
    const status = disabled ? 'disabled' : stringFromOptions(item.status, mcpStatusValues, 'disconnected')
    const seenTools = new Set<string>()
    const tools = (Array.isArray(item.tools) ? item.tools : [])
      .map((tool): McpServerUserConfig['tools'][number] | null => {
        if (!isRecord(tool)) {
          changed = true
          return null
        }
        const toolName = typeof tool.name === 'string' ? tool.name.trim() : ''
        if (!toolName || seenTools.has(toolName)) {
          changed = true
          return null
        }
        seenTools.add(toolName)
        const stateKey = `${name}:${toolName}`
        const enabled = typeof toolStates[stateKey] === 'boolean' ? toolStates[stateKey] : typeof tool.enabled === 'boolean' ? tool.enabled : true
        const parameters = (Array.isArray(tool.parameters) ? tool.parameters : [])
          .map((parameter): McpServerUserConfig['tools'][number]['parameters'][number] | null => {
            if (!isRecord(parameter)) {
              changed = true
              return null
            }
            const parameterName = typeof parameter.name === 'string' ? parameter.name.trim() : ''
            if (!parameterName) {
              changed = true
              return null
            }
            return {
              name: parameterName,
              description: typeof parameter.description === 'string' ? parameter.description : '',
              ...(parameter.required !== undefined ? { required: Boolean(parameter.required) } : {})
            }
          })
          .filter(Boolean) as McpServerUserConfig['tools'][number]['parameters']
        const normalizedTool = {
          name: toolName,
          description: typeof tool.description === 'string' ? tool.description : '',
          enabled,
          ...(tool.autoApprove === true ? { autoApprove: true } : {}),
          parameters
        }
        if (
          tool.name !== normalizedTool.name ||
          tool.description !== normalizedTool.description ||
          tool.enabled !== normalizedTool.enabled ||
          Boolean(tool.autoApprove) !== Boolean(normalizedTool.autoApprove)
        ) {
          changed = true
        }
        return normalizedTool
      })
      .filter(Boolean) as McpServerUserConfig['tools']

    const seenResources = new Set<string>()
    const resources = (Array.isArray(item.resources) ? item.resources : [])
      .map((resource): McpServerUserConfig['resources'][number] | null => {
        if (!isRecord(resource)) {
          changed = true
          return null
        }
        const uri = typeof resource.uri === 'string' ? resource.uri.trim() : ''
        const resourceName = typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim() : uri
        if (!uri || !resourceName || seenResources.has(uri)) {
          changed = true
          return null
        }
        seenResources.add(uri)
        return {
          name: resourceName,
          description: typeof resource.description === 'string' ? resource.description : '',
          uri
        }
      })
      .filter(Boolean) as McpServerUserConfig['resources']

    const server: McpServerUserConfig = {
      name,
      status,
      disabled,
      ...(typeof item.error === 'string' && item.error.trim() ? { error: item.error.trim() } : {}),
      tools,
      resources
    }
    normalized.push(server)
    const allowedKeys = new Set(['name', 'status', 'disabled', 'error', 'tools', 'resources'])
    if (
      item.name !== server.name ||
      item.status !== server.status ||
      item.disabled !== server.disabled ||
      item.error !== server.error ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  const normalizedToolStates: McpToolStatesUserConfig = {}
  normalized.forEach((server) => {
    server.tools.forEach((tool) => {
      normalizedToolStates[`${server.name}:${tool.name}`] = tool.enabled
    })
  })

  if (JSON.stringify(toolStates) !== JSON.stringify(normalizedToolStates)) {
    changed = true
  }

  return {
    normalized,
    toolStates: normalizedToolStates,
    changed
  }
}

export const normalizeUserModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'local') return 'local'
  if (
    provider === 'litellm' ||
    provider === 'openai-compatible' ||
    provider === 'ollama' ||
    provider === 'lmstudio' ||
    provider === 'bedrock' ||
    provider === 'deepseek' ||
    provider === 'anthropic'
  ) {
    return provider
  }
  return defaultConfig.modelProvider
}

export const normalizeUserModelName = (value: unknown) => {
  const modelName = String(value || '').trim()
  if (!modelName) return defaultConfig.modelName
  return modelName
}

export const normalizeCatalogModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'default' || provider === 'local') return 'local'
  if (provider === 'openai') return 'openai-compatible'
  return normalizeUserModelProvider(provider)
}

const isDefaultModeValue = (value: unknown): value is UserConfig['defaultMode'] => value === 'terminal' || value === 'agents'

const isBooleanValue = (value: unknown): value is boolean => typeof value === 'boolean'

const isWatermarkValue = (value: unknown): value is UserConfig['watermark'] => value === 'open' || value === 'close'

const isSettingsLanguageValue = (value: unknown): value is string => isLocaleSetting(value)

export const normalizeGeneralBaseSettingsPatch = (patch: GeneralBaseSettingsPatch) => {
  const normalized: GeneralBaseSettingsPatch = {}
  if (patch.defaultMode !== undefined) {
    if (!isDefaultModeValue(patch.defaultMode)) return null
    normalized.defaultMode = patch.defaultMode
  }
  if (patch.language !== undefined) {
    if (!isSettingsLanguageValue(patch.language)) return null
    normalized.language = patch.language
  }
  if (patch.watermark !== undefined) {
    if (!isWatermarkValue(patch.watermark)) return null
    normalized.watermark = patch.watermark
  }
  return normalized
}

export const generalBaseSettingsPatchMatches = (patch: GeneralBaseSettingsPatch, savedConfig: Record<string, unknown>) => {
  if (patch.defaultMode !== undefined && savedConfig.defaultMode !== patch.defaultMode) return false
  if (patch.language !== undefined && savedConfig.language !== patch.language) return false
  if (patch.watermark !== undefined && savedConfig.watermark !== patch.watermark) return false
  return true
}

export const isGeneralBaseSettingsSnapshot = (source: unknown): source is Pick<UserConfig, 'defaultMode' | 'language' | 'watermark'> =>
  isRecord(source) && isDefaultModeValue(source.defaultMode) && isSettingsLanguageValue(source.language) && isWatermarkValue(source.watermark)

export const normalizeLayoutPreferencesPatch = (patch: LayoutPreferencesPatch) => {
  const normalized: LayoutPreferencesPatch = {}
  if (patch.defaultMode !== undefined) {
    if (!isDefaultModeValue(patch.defaultMode)) return null
    normalized.defaultMode = patch.defaultMode
  }
  if (patch.leftPanelOpen !== undefined) {
    if (!isBooleanValue(patch.leftPanelOpen)) return null
    normalized.leftPanelOpen = patch.leftPanelOpen
  }
  if (patch.rightPanelOpen !== undefined) {
    if (!isBooleanValue(patch.rightPanelOpen)) return null
    normalized.rightPanelOpen = patch.rightPanelOpen
  }
  if (patch.agentsLeftOpen !== undefined) {
    if (!isBooleanValue(patch.agentsLeftOpen)) return null
    normalized.agentsLeftOpen = patch.agentsLeftOpen
  }
  if (patch.leftPanelWidth !== undefined) {
    const width = numberInRange(patch.leftPanelWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.leftPanelWidth = Math.round(width)
  }
  if (patch.rightPanelWidth !== undefined) {
    const width = numberInRange(patch.rightPanelWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.rightPanelWidth = Math.round(width)
  }
  if (patch.agentsLeftWidth !== undefined) {
    const width = numberInRange(patch.agentsLeftWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.agentsLeftWidth = Math.round(width)
  }
  return normalized
}

export const layoutPreferencesPatchMatches = (patch: LayoutPreferencesPatch, savedConfig: Record<string, unknown>) => {
  if (patch.defaultMode !== undefined && savedConfig.defaultMode !== patch.defaultMode) return false
  if (patch.leftPanelOpen !== undefined && savedConfig.leftPanelOpen !== patch.leftPanelOpen) return false
  if (patch.rightPanelOpen !== undefined && savedConfig.rightPanelOpen !== patch.rightPanelOpen) return false
  if (patch.agentsLeftOpen !== undefined && savedConfig.agentsLeftOpen !== patch.agentsLeftOpen) return false
  if (patch.leftPanelWidth !== undefined && savedConfig.leftPanelWidth !== patch.leftPanelWidth) return false
  if (patch.rightPanelWidth !== undefined && savedConfig.rightPanelWidth !== patch.rightPanelWidth) return false
  if (patch.agentsLeftWidth !== undefined && savedConfig.agentsLeftWidth !== patch.agentsLeftWidth) return false
  return true
}

const isLayoutWidthValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= layoutWidthLimits.min && value <= layoutWidthLimits.max

export const layoutWidthFromConfig = (value: unknown, fallback: number) => numberInRange(value, fallback, layoutWidthLimits.min, layoutWidthLimits.max)

export const isLayoutPreferencesSnapshot = (
  source: unknown
): source is Pick<UserConfig, 'defaultMode' | 'leftPanelOpen' | 'rightPanelOpen' | 'agentsLeftOpen' | 'leftPanelWidth' | 'rightPanelWidth' | 'agentsLeftWidth'> =>
  isRecord(source) &&
  isDefaultModeValue(source.defaultMode) &&
  isBooleanValue(source.leftPanelOpen) &&
  isBooleanValue(source.rightPanelOpen) &&
  isBooleanValue(source.agentsLeftOpen) &&
  isLayoutWidthValue(source.leftPanelWidth) &&
  isLayoutWidthValue(source.rightPanelWidth) &&
  isLayoutWidthValue(source.agentsLeftWidth)

export const normalizeBackgroundConfig = (source?: Partial<BackgroundUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const mode = stringFromOptions(incoming.mode, backgroundModeValues, defaultConfig.background.mode)
  const normalized: BackgroundUserConfig = {
    mode,
    image: typeof incoming.image === 'string' ? incoming.image : defaultConfig.background.image,
    opacity: numberInRange(incoming.opacity, defaultConfig.background.opacity, 0, 1),
    brightness: numberInRange(incoming.brightness, defaultConfig.background.brightness, 0, 1),
    lastCustomImage: typeof incoming.lastCustomImage === 'string' ? incoming.lastCustomImage : defaultConfig.background.lastCustomImage
  }
  if (normalized.mode === 'none') {
    normalized.image = ''
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof BackgroundUserConfig>).some((key) => incoming[key] !== normalized[key])
  return { normalized, changed }
}

export const isBackgroundSnapshot = (source: unknown): source is BackgroundUserConfig => {
  if (!isRecord(source)) return false
  return (
    backgroundModeValues.includes(source.mode as BackgroundUserConfig['mode']) &&
    typeof source.image === 'string' &&
    typeof source.opacity === 'number' &&
    Number.isFinite(source.opacity) &&
    source.opacity >= 0 &&
    source.opacity <= 1 &&
    typeof source.brightness === 'number' &&
    Number.isFinite(source.brightness) &&
    source.brightness >= 0 &&
    source.brightness <= 1 &&
    (source.lastCustomImage === undefined || typeof source.lastCustomImage === 'string')
  )
}

export const cloneBackgroundSnapshot = (background: BackgroundUserConfig): BackgroundUserConfig => ({ ...background })

export const backgroundSnapshotsMatch = (left: BackgroundUserConfig, right: BackgroundUserConfig) =>
  JSON.stringify(cloneBackgroundSnapshot(left)) === JSON.stringify(cloneBackgroundSnapshot(right))

export const visibleBackgroundTuning = (background: BackgroundUserConfig): BackgroundUserConfig => {
  if (background.mode === 'none') return background
  const wasLegacyLowVisibility = background.opacity <= 0.5 && background.brightness <= 0.85
  if (!wasLegacyLowVisibility) return background
  return {
    ...background,
    opacity: defaultConfig.background.opacity,
    brightness: defaultConfig.background.brightness
  }
}

export const isCustomBackgroundSaveResult = (source: unknown): source is CustomBackgroundSaveResult =>
  isRecord(source) &&
  isNonEmptyString(source.filePath) &&
  isNonEmptyString(source.url) &&
  isNonEmptyString(source.name) &&
  typeof source.size === 'number' &&
  Number.isInteger(source.size) &&
  source.size > 0 &&
  typeof source.bytes === 'number' &&
  Number.isInteger(source.bytes) &&
  source.bytes === source.size &&
  typeof source.mtimeMs === 'number' &&
  Number.isFinite(source.mtimeMs) &&
  source.mtimeMs > 0

const normalizeOnboardingCompleted = (source?: UserConfig['onboarding']) => {
  const incomingCompleted = source?.completedModules || {}
  return {
    interfaceGuide: Boolean(incomingCompleted.interfaceGuide),
    systemSettings: Boolean(incomingCompleted.systemSettings),
    addAndConnectHost: Boolean(incomingCompleted.addAndConnectHost),
    aiChat: Boolean(incomingCompleted.aiChat)
  }
}

export const normalizeOnboardingConfig = (source?: UserConfig['onboarding']) => {
  const completed = normalizeOnboardingCompleted(source)

  const normalized = {
    version: ONBOARDING_VERSION,
    guideTabAutoOpened: Boolean(source?.guideTabAutoOpened),
    completedModules: completed
  }

  const isCurrent =
    source?.version === ONBOARDING_VERSION &&
    onboardingModuleIds.every((moduleId) => typeof source.completedModules?.[moduleId] === 'boolean')

  return {
    normalized,
    changed: !isCurrent
  }
}

export const stripBusinessDataConfig = (source: Partial<UserConfig>): Partial<UserConfig> => {
  const { quickCommands, knowledgeBase, aliasCommands, ...rest } = source
  void quickCommands
  void knowledgeBase
  void aliasCommands
  return rest
}

export const mergeUserConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => {
  const normalizedMcp = normalizeMcpServersConfig(patch.mcpServers || base.mcpServers, patch.mcpToolStates || base.mcpToolStates)

  return {
    ...base,
    ...patch,
    defaultMode: isDefaultModeValue(patch.defaultMode) ? patch.defaultMode : isDefaultModeValue(base.defaultMode) ? base.defaultMode : defaultConfig.defaultMode,
    leftPanelOpen: typeof patch.leftPanelOpen === 'boolean' ? patch.leftPanelOpen : typeof base.leftPanelOpen === 'boolean' ? base.leftPanelOpen : defaultConfig.leftPanelOpen,
    rightPanelOpen: typeof patch.rightPanelOpen === 'boolean' ? patch.rightPanelOpen : typeof base.rightPanelOpen === 'boolean' ? base.rightPanelOpen : defaultConfig.rightPanelOpen,
    agentsLeftOpen:
      typeof patch.agentsLeftOpen === 'boolean' ? patch.agentsLeftOpen : typeof base.agentsLeftOpen === 'boolean' ? base.agentsLeftOpen : defaultConfig.agentsLeftOpen,
    leftPanelWidth: layoutWidthFromConfig(patch.leftPanelWidth, layoutWidthFromConfig(base.leftPanelWidth, defaultConfig.leftPanelWidth!)),
    rightPanelWidth: layoutWidthFromConfig(patch.rightPanelWidth, layoutWidthFromConfig(base.rightPanelWidth, defaultConfig.rightPanelWidth!)),
    agentsLeftWidth: layoutWidthFromConfig(patch.agentsLeftWidth, layoutWidthFromConfig(base.agentsLeftWidth, defaultConfig.agentsLeftWidth!)),
    modelProvider: normalizeUserModelProvider(patch.modelProvider || base.modelProvider),
    modelName: normalizeUserModelName(patch.modelName || base.modelName),
    background: normalizeBackgroundConfig({
      ...base.background,
      ...(patch.background || {})
    }).normalized,
    terminal: {
      ...(base.terminal || defaultTerminalSettings),
      ...(patch.terminal || {})
    },
    workspacePreferences: {
      ...(base.workspacePreferences || defaultWorkspacePreferences),
      ...(patch.workspacePreferences || {}),
      expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || defaultWorkspacePreferences.expandedGroups,
      recentAssetIds: patch.workspacePreferences?.recentAssetIds || base.workspacePreferences?.recentAssetIds || defaultWorkspacePreferences.recentAssetIds || []
    },
    editorSettings: normalizeEditorSettingsConfig({
      ...(base.editorSettings || defaultEditorSettings),
      ...(patch.editorSettings || {})
    }).normalized,
    sshProxyConfigs: normalizeSshProxyConfigs(patch.sshProxyConfigs || base.sshProxyConfigs).normalized,
    sshAgentKeys: normalizeSshAgentKeys(patch.sshAgentKeys || base.sshAgentKeys).normalized,
    extensionSettings: normalizeExtensionSettingsConfig({
      ...(base.extensionSettings || defaultExtensionSettings),
      ...(patch.extensionSettings || {})
    }).normalized,
    keywordHighlight: normalizeKeywordHighlightConfig(patch.keywordHighlight || base.keywordHighlight).normalized,
    securityConfig: normalizeSecurityConfig(patch.securityConfig || base.securityConfig).normalized,
    privacy: normalizePrivacyConfig({
      ...(base.privacy || defaultConfig.privacy!),
      ...(patch.privacy || {})
    }).normalized,
    aiPreferences: normalizeAiPreferencesConfig({
      ...(base.aiPreferences || defaultAiPreferences),
      ...(patch.aiPreferences || {}),
      proxy: {
        ...(base.aiPreferences?.proxy || defaultAiPreferences.proxy),
        ...(patch.aiPreferences?.proxy || {})
      }
    }).normalized,
    notifications: normalizeNotificationConfig({
      ...(base.notifications || defaultNotificationSettings),
      ...(patch.notifications || {})
    }).normalized,
    modelSettings: normalizeModelSettingsConfig(patch.modelSettings || base.modelSettings).normalized,
    quickCommands:
      base.quickCommands || patch.quickCommands
        ? {
            groups: [...(patch.quickCommands?.groups || base.quickCommands?.groups || defaultQuickCommands.groups)],
            snippets: [...(patch.quickCommands?.snippets || base.quickCommands?.snippets || defaultQuickCommands.snippets)]
          }
        : undefined,
    knowledgeBase: patch.knowledgeBase || base.knowledgeBase ? normalizeKnowledgeBaseConfig(patch.knowledgeBase || base.knowledgeBase).normalized : undefined,
    aliasCommands: patch.aliasCommands || base.aliasCommands ? normalizeAliasCommandsConfig(patch.aliasCommands || base.aliasCommands).normalized : undefined,
    shortcuts: normalizeShortcutsConfig(patch.shortcuts || base.shortcuts).normalized,
    rules: normalizeRulesConfig(patch.rules || base.rules, patch.customInstructions || base.customInstructions).normalized,
    skills: normalizeSkillsConfig(patch.skills || base.skills).normalized,
    customInstructions: patch.customInstructions !== undefined ? patch.customInstructions : base.customInstructions,
    mcpServers: normalizedMcp.normalized,
    mcpToolStates: normalizedMcp.toolStates,
    onboarding:
      base.onboarding || patch.onboarding
        ? {
            ...(base.onboarding || defaultConfig.onboarding!),
            ...(patch.onboarding || {}),
            completedModules: {
              ...(base.onboarding?.completedModules || defaultConfig.onboarding!.completedModules),
              ...(patch.onboarding?.completedModules || {})
            }
          }
        : undefined
  }
}

export const mergeGenericSavedConfig = (base: UserConfig, savedConfig: Partial<UserConfig>, patch: Partial<UserConfig> = {}) =>
  mergeUserConfig(base, {
    ...stripBusinessDataConfig(savedConfig),
    ...patch
  })
