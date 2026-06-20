import type {
  AiPreferencesUserConfig,
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
import type { ExtensionUserConfig } from '@shared/contracts/extensions'
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
const defaultAiPreferencesConfig = defaultConfig.aiPreferences!
const defaultModelSettingsConfig = defaultConfig.modelSettings!

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback
const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)

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
