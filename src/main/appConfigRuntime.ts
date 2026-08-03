import { defaultMcpServers, defaultMcpToolStates } from '@shared/mcpSeed'
import { defaultKnowledgeBaseConfig } from '@shared/knowledgeBaseSeed'
import { defaultModelSettingsConfig } from '@shared/modelSettingsSeed'
import { defaultSettingsRulesConfig } from '@shared/settingsPreferencesSeed'
import { defaultSkillsConfig } from '@shared/skillsSeed'
import { defaultWorkspacePreferencesConfig } from '@shared/workspacePreferencesSeed'
import { normalizeConfigModelName, normalizeConfigModelProvider } from './backend/app/configBoundary'
import type {
  EditorUserConfig,
  ExportMcpUserConfig,
  KeywordHighlightUserConfig,
  ModelSettingsUserConfig,
  SecurityUserConfig,
  SshAgentKeyConfig,
  SshProxyConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type {
  KnowledgeBaseNodeConfig,
  KnowledgeBaseUserConfig
} from '@shared/contracts/knowledgeBase'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type { ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { UserConfig, WorkspaceIdleCleanupUserConfig } from '@shared/contracts/userConfig'

const defaultWorkspaceIdleCleanup: WorkspaceIdleCleanupUserConfig = {
  enabled: false,
  timeoutMinutes: 20
}

export const defaultKeywordHighlightConfig: KeywordHighlightUserConfig = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

export const defaultSecurityConfig: SecurityUserConfig = {
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

export const defaultKnowledgeBaseUserConfig: KnowledgeBaseUserConfig = defaultKnowledgeBaseConfig()
const defaultSettingsRulesUserConfig: UserRuleConfig[] = defaultSettingsRulesConfig()
const defaultSkillsUserConfig: SkillUserConfig[] = defaultSkillsConfig()
const defaultWorkspacePreferencesUserConfig: WorkspaceUserConfig = defaultWorkspacePreferencesConfig()
const defaultModelSettingsUserConfig: ModelSettingsUserConfig = defaultModelSettingsConfig()

export const defaultConfig: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  leftPanelWidth: 286,
  rightPanelWidth: 360,
  agentsLeftWidth: 286,
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
  workspaceIdleCleanup: defaultWorkspaceIdleCleanup,
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
  keywordHighlight: defaultKeywordHighlightConfig,
  securityConfig: defaultSecurityConfig,
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
  notifications: {
    desktopNotifications: true,
    controlNotificationBell: true,
    soundEnabled: true,
    soundPreset: 'chime',
    customSoundPath: '',
    customSoundUrl: '',
    customSoundName: ''
  },
  exportMcp: {
    allowAgentSshAuthSubmit: false,
    allowDatabaseRead: false
  },
  modelSettings: defaultModelSettingsUserConfig,
  shortcuts: [
    { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
    { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
    { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
    { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' },
    { id: 'closeCurrentPanel', action: '关闭当前面板', shortcut: 'Ctrl+Shift+W' },
    { id: 'recentPanels', action: '打开最近面板', shortcut: 'Ctrl+Tab' },
    { id: 'navigatePanelBack', action: '导航到上一个面板', shortcut: 'Ctrl+Left' },
    { id: 'navigatePanelForward', action: '导航到下一个面板', shortcut: 'Ctrl+Right' }
  ],
  rules: defaultSettingsRulesUserConfig,
  skills: defaultSkillsUserConfig,
  mcpServers: defaultMcpServers(),
  mcpToolStates: defaultMcpToolStates(),
  knowledgeBase: defaultKnowledgeBaseUserConfig,
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

const cloneKnowledgeBaseNodes = (nodes: KnowledgeBaseNodeConfig[] = []): KnowledgeBaseNodeConfig[] =>
  nodes.map((node) => ({
    ...node,
    children: node.children ? cloneKnowledgeBaseNodes(node.children) : undefined
  }))

const cloneKnowledgeBase = (source?: KnowledgeBaseUserConfig): KnowledgeBaseUserConfig | undefined =>
  source
    ? {
        tree: cloneKnowledgeBaseNodes(source.tree),
        usedBytes: source.usedBytes,
        totalBytes: source.totalBytes
      }
    : undefined

const cloneShortcuts = (shortcuts?: ShortcutUserConfig[]): ShortcutUserConfig[] | undefined =>
  shortcuts?.map((shortcut) => ({ ...shortcut }))

const cloneRules = (rules?: UserRuleConfig[]): UserRuleConfig[] | undefined =>
  rules?.map((rule) => ({ ...rule }))

const cloneSkills = (skills?: SkillUserConfig[]): SkillUserConfig[] | undefined =>
  skills?.map((skill) => ({ ...skill }))

export const cloneMcpServers = (servers?: McpServerUserConfig[]): McpServerUserConfig[] | undefined =>
  servers?.map((server) => ({
    ...server,
    tools: server.tools.map((tool) => ({
      ...tool,
      parameters: tool.parameters.map((parameter) => ({ ...parameter }))
    })),
    resources: server.resources.map((resource) => ({ ...resource }))
  }))

export const cloneMcpToolStates = (states?: McpToolStatesUserConfig): McpToolStatesUserConfig | undefined =>
  states ? { ...states } : undefined

const cloneEditorSettings = (settings?: EditorUserConfig): EditorUserConfig | undefined =>
  settings ? { ...settings } : undefined

const cloneSshProxyConfigs = (configs?: SshProxyConfig[]): SshProxyConfig[] | undefined => configs?.map((config) => ({ ...config }))

const cloneSshAgentKeys = (keys?: SshAgentKeyConfig[]): SshAgentKeyConfig[] | undefined => keys?.map((key) => ({ ...key }))

const normalizeExportMcpConfig = (config?: Partial<ExportMcpUserConfig>): ExportMcpUserConfig => ({
  allowAgentSshAuthSubmit: config?.allowAgentSshAuthSubmit === true,
  allowDatabaseRead: config?.allowDatabaseRead === true
})

const cloneKeywordHighlight = (config?: KeywordHighlightUserConfig): KeywordHighlightUserConfig | undefined =>
  config
    ? {
        'keyword-highlight': {
          enabled: config['keyword-highlight']?.enabled ?? defaultKeywordHighlightConfig['keyword-highlight'].enabled,
          applyTo: {
            ...defaultKeywordHighlightConfig['keyword-highlight'].applyTo,
            ...(config['keyword-highlight']?.applyTo || {})
          },
          rules: (config['keyword-highlight']?.rules || defaultKeywordHighlightConfig['keyword-highlight'].rules).map((rule) => ({
            ...rule,
            pattern: Array.isArray(rule.pattern) ? [...rule.pattern] : rule.pattern,
            style: { ...rule.style }
          }))
        }
      }
    : undefined

const cloneSecurityConfig = (config?: SecurityUserConfig): SecurityUserConfig | undefined =>
  config
    ? {
        security: {
          enableCommandSecurity: config.security?.enableCommandSecurity ?? defaultSecurityConfig.security.enableCommandSecurity,
          enableStrictMode: config.security?.enableStrictMode ?? defaultSecurityConfig.security.enableStrictMode,
          blacklistPatterns: [...(config.security?.blacklistPatterns || defaultSecurityConfig.security.blacklistPatterns)],
          whitelistPatterns: [...(config.security?.whitelistPatterns || defaultSecurityConfig.security.whitelistPatterns)],
          dangerousCommands: [...(config.security?.dangerousCommands || defaultSecurityConfig.security.dangerousCommands)],
          maxCommandLength: config.security?.maxCommandLength ?? defaultSecurityConfig.security.maxCommandLength,
          securityPolicy: {
            ...defaultSecurityConfig.security.securityPolicy,
            ...(config.security?.securityPolicy || {})
          }
        }
      }
    : undefined

const normalizeStringArray = (source: unknown, fallback: string[]) =>
  Array.isArray(source) ? source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [...fallback]

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toStringArray = (source: unknown) =>
  Array.isArray(source) ? source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : undefined

const toStringRecord = (source: unknown) => {
  if (!isRecord(source)) return undefined
  const entries = Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length ? Object.fromEntries(entries) : undefined
}

const normalizeMcpTransportType = (server: Record<string, unknown>): McpConfigFile['mcpServers'][string]['type'] => {
  const rawType = typeof server.type === 'string' ? server.type.trim() : ''
  if (rawType === 'sse') return 'sse'
  if (rawType === 'streamableHttp' || rawType === 'http' || rawType === 'streamable_http' || rawType === 'streamable-http') return 'streamableHttp'
  if (rawType === 'stdio') return 'stdio'

  const hasCommand = typeof server.command === 'string' && server.command.trim().length > 0
  const hasUrl = typeof server.url === 'string' && server.url.trim().length > 0
  return !hasCommand && hasUrl ? 'streamableHttp' : 'stdio'
}

export const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = normalizeMcpTransportType(value)
    const server: McpConfigFile['mcpServers'][string] = {
      type,
      ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      ...(toStringArray(value.autoApprove) ? { autoApprove: toStringArray(value.autoApprove) } : {}),
      ...(typeof value.timeout === 'number' && value.timeout > 0 ? { timeout: value.timeout } : {})
    }
    if (type === 'stdio') {
      if (typeof value.command === 'string' && value.command.trim()) server.command = value.command.trim()
      const args = toStringArray(value.args)
      if (args) server.args = args
      if (typeof value.cwd === 'string' && value.cwd.trim()) server.cwd = value.cwd.trim()
      const env = toStringRecord(value.env)
      if (env) server.env = env
    } else {
      if (typeof value.url === 'string' && value.url.trim()) server.url = value.url.trim()
      const headers = toStringRecord(value.headers)
      if (headers) server.headers = headers
    }
    mcpServers[name.trim()] = server
  })
  return { mcpServers }
}

export const mcpConfigFromUserConfig = (config: UserConfig, homePath: string): McpConfigFile => {
  const servers = config.mcpServers || []
  return {
    mcpServers: Object.fromEntries(
      servers.map((server) => {
        const autoApprove = server.tools.filter((tool) => tool.autoApprove).map((tool) => tool.name)
        return [
          server.name,
          {
            type: 'stdio' as const,
            disabled: server.disabled,
            ...(autoApprove.length ? { autoApprove } : {}),
            command: server.name === 'filesystem' ? 'npx' : server.name,
            args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', homePath] : [],
            timeout: 60
          }
        ]
      })
    )
  }
}

export const normalizeKeywordHighlightConfig = (source?: unknown): KeywordHighlightUserConfig => {
  const root = isRecord(source) ? source : {}
  const incoming = isRecord(root['keyword-highlight']) ? root['keyword-highlight'] : {}
  const applyTo = isRecord(incoming.applyTo) ? incoming.applyTo : {}
  const rulesSource = Array.isArray(incoming.rules) ? incoming.rules : []
  const rules: KeywordHighlightUserConfig['keyword-highlight']['rules'] = []
  const seen = new Set<string>()
  rulesSource.forEach((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim() || seen.has(item.name.trim())) return
    const style = isRecord(item.style) ? item.style : {}
    const foreground = typeof style.foreground === 'string' && /^#(?:[0-9a-fA-F]{6})$/.test(style.foreground) ? style.foreground : '#F87171'
    const pattern =
      Array.isArray(item.pattern) && item.pattern.some((value) => typeof value === 'string' && value.trim())
        ? item.pattern.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
        : typeof item.pattern === 'string' && item.pattern.trim()
          ? item.pattern.trim()
          : item.name.trim()
    const name = item.name.trim()
    seen.add(name)
    rules.push({
      name,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      scope: item.scope === 'input' || item.scope === 'both' ? item.scope : 'output',
      matchType: item.matchType === 'wildcard' ? 'wildcard' : 'regex',
      pattern,
      style: {
        foreground,
        fontStyle: style.fontStyle === 'normal' ? 'normal' : 'bold'
      }
    })
  })
  return {
    'keyword-highlight': {
      enabled: incoming.enabled !== undefined ? Boolean(incoming.enabled) : defaultKeywordHighlightConfig['keyword-highlight'].enabled,
      applyTo: {
        output: applyTo.output !== undefined ? Boolean(applyTo.output) : defaultKeywordHighlightConfig['keyword-highlight'].applyTo.output,
        input: applyTo.input !== undefined ? Boolean(applyTo.input) : defaultKeywordHighlightConfig['keyword-highlight'].applyTo.input
      },
      rules
    }
  }
}

export const normalizeSecurityConfig = (source?: unknown): SecurityUserConfig => {
  const root = isRecord(source) ? source : {}
  const securitySource = isRecord(root.security) ? root.security : {}
  const policySource = isRecord(securitySource.securityPolicy) ? securitySource.securityPolicy : {}
  const defaults = defaultSecurityConfig.security
  return {
    security: {
      enableCommandSecurity:
        typeof securitySource.enableCommandSecurity === 'boolean' ? securitySource.enableCommandSecurity : defaults.enableCommandSecurity,
      enableStrictMode: typeof securitySource.enableStrictMode === 'boolean' ? securitySource.enableStrictMode : defaults.enableStrictMode,
      blacklistPatterns: normalizeStringArray(securitySource.blacklistPatterns, defaults.blacklistPatterns),
      whitelistPatterns: normalizeStringArray(securitySource.whitelistPatterns, defaults.whitelistPatterns),
      dangerousCommands: normalizeStringArray(securitySource.dangerousCommands, defaults.dangerousCommands),
      maxCommandLength:
        typeof securitySource.maxCommandLength === 'number' && securitySource.maxCommandLength > 0
          ? securitySource.maxCommandLength
          : defaults.maxCommandLength,
      securityPolicy: {
        blockCritical: typeof policySource.blockCritical === 'boolean' ? policySource.blockCritical : defaults.securityPolicy.blockCritical,
        askForMedium: typeof policySource.askForMedium === 'boolean' ? policySource.askForMedium : defaults.securityPolicy.askForMedium,
        askForHigh: typeof policySource.askForHigh === 'boolean' ? policySource.askForHigh : defaults.securityPolicy.askForHigh,
        askForBlacklist: typeof policySource.askForBlacklist === 'boolean' ? policySource.askForBlacklist : defaults.securityPolicy.askForBlacklist
      }
    }
  }
}

const mergeModelProvider = (
  provider: ModelSettingsUserConfig['providers'][keyof ModelSettingsUserConfig['providers']] | undefined,
  fallback: ModelSettingsUserConfig['providers'][keyof ModelSettingsUserConfig['providers']]
) => ({
  ...fallback,
  ...(provider || {})
})

const cloneModelSettings = (settings?: ModelSettingsUserConfig): ModelSettingsUserConfig | undefined =>
  settings
    ? {
        addModelSwitch: settings.addModelSwitch,
        providers: {
          litellm: mergeModelProvider(settings.providers?.litellm, defaultConfig.modelSettings!.providers.litellm),
          openai: mergeModelProvider(settings.providers?.openai, defaultConfig.modelSettings!.providers.openai),
          bedrock: mergeModelProvider(settings.providers?.bedrock, defaultConfig.modelSettings!.providers.bedrock),
          deepseek: mergeModelProvider(settings.providers?.deepseek, defaultConfig.modelSettings!.providers.deepseek),
          anthropic: mergeModelProvider(settings.providers?.anthropic, defaultConfig.modelSettings!.providers.anthropic),
          ollama: mergeModelProvider(settings.providers?.ollama, defaultConfig.modelSettings!.providers.ollama),
          lmstudio: mergeModelProvider(settings.providers?.lmstudio, defaultConfig.modelSettings!.providers.lmstudio)
        },
        options: (settings.options || defaultConfig.modelSettings!.options).map((option) => ({ ...option }))
      }
    : undefined

const normalizeModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  return normalizeConfigModelProvider(value, defaultConfig)
}

const normalizeModelName = (value: unknown) => {
  return normalizeConfigModelName(value, defaultConfig)
}

const normalizeLayoutWidth = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 220 && value <= 640 ? Math.round(value) : fallback

const normalizeWorkspaceIdleCleanup = (
  source: UserConfig['workspaceIdleCleanup'],
  fallback: WorkspaceIdleCleanupUserConfig
): WorkspaceIdleCleanupUserConfig => {
  const timeoutMinutes = typeof source?.timeoutMinutes === 'number' && Number.isFinite(source.timeoutMinutes)
    ? Math.min(1440, Math.max(1, Math.round(source.timeoutMinutes)))
    : fallback.timeoutMinutes
  return {
    enabled: typeof source?.enabled === 'boolean' ? source.enabled : fallback.enabled,
    timeoutMinutes
  }
}

export const mergeConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
  ...base,
  ...patch,
  leftPanelWidth: normalizeLayoutWidth(patch.leftPanelWidth, normalizeLayoutWidth(base.leftPanelWidth, defaultConfig.leftPanelWidth!)),
  rightPanelWidth: normalizeLayoutWidth(patch.rightPanelWidth, normalizeLayoutWidth(base.rightPanelWidth, defaultConfig.rightPanelWidth!)),
  agentsLeftWidth: normalizeLayoutWidth(patch.agentsLeftWidth, normalizeLayoutWidth(base.agentsLeftWidth, defaultConfig.agentsLeftWidth!)),
  modelProvider: normalizeModelProvider(patch.modelProvider || base.modelProvider),
  modelName: normalizeModelName(patch.modelName || base.modelName),
  background: {
    ...base.background,
    ...(patch.background || {})
  },
  terminal: {
    ...base.terminal!,
    ...(patch.terminal || {})
  },
  workspacePreferences: {
    ...base.workspacePreferences!,
    ...(patch.workspacePreferences || {}),
    expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || [],
    recentAssetIds: patch.workspacePreferences?.recentAssetIds || base.workspacePreferences?.recentAssetIds || []
  },
  workspaceIdleCleanup: normalizeWorkspaceIdleCleanup(
    patch.workspaceIdleCleanup,
    normalizeWorkspaceIdleCleanup(base.workspaceIdleCleanup, defaultWorkspaceIdleCleanup)
  ),
  editorSettings: cloneEditorSettings(patch.editorSettings || base.editorSettings),
  sshProxyConfigs: cloneSshProxyConfigs(patch.sshProxyConfigs || base.sshProxyConfigs),
  sshAgentKeys: cloneSshAgentKeys(patch.sshAgentKeys || base.sshAgentKeys),
  extensionSettings: {
    ...base.extensionSettings!,
    ...(patch.extensionSettings || {})
  },
  keywordHighlight: cloneKeywordHighlight(patch.keywordHighlight || base.keywordHighlight),
  securityConfig: cloneSecurityConfig(patch.securityConfig || base.securityConfig),
  privacy: {
    ...base.privacy!,
    ...(patch.privacy || {})
  },
  modelSettings: cloneModelSettings(patch.modelSettings || base.modelSettings),
  aiPreferences: {
    ...base.aiPreferences!,
    ...(patch.aiPreferences || {}),
    proxy: {
      ...base.aiPreferences!.proxy,
      ...(patch.aiPreferences?.proxy || {})
    }
  },
  notifications: {
    ...base.notifications!,
    ...(patch.notifications || {})
  },
  exportMcp: normalizeExportMcpConfig({
    ...(base.exportMcp || defaultConfig.exportMcp!),
    ...(patch.exportMcp || {})
  }),
  quickCommands:
    base.quickCommands || patch.quickCommands
      ? {
          groups: [...(patch.quickCommands?.groups || base.quickCommands?.groups || [])],
          snippets: [...(patch.quickCommands?.snippets || base.quickCommands?.snippets || [])]
        }
      : undefined,
  knowledgeBase: cloneKnowledgeBase(patch.knowledgeBase || base.knowledgeBase),
  shortcuts: cloneShortcuts(patch.shortcuts || base.shortcuts),
  rules: cloneRules(patch.rules || base.rules),
  skills: cloneSkills(patch.skills || base.skills),
  customInstructions: typeof patch.customInstructions === 'string' ? patch.customInstructions : base.customInstructions,
  mcpServers: cloneMcpServers(patch.mcpServers || base.mcpServers),
  mcpToolStates: cloneMcpToolStates(patch.mcpToolStates || base.mcpToolStates),
  onboarding: {
    ...base.onboarding!,
    ...(patch.onboarding || {}),
    completedModules: {
      ...(base.onboarding?.completedModules || {}),
      ...(patch.onboarding?.completedModules || {})
    }
  }
})

const terminalTypeOptions = new Set(['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi'])

export const normalizeTerminalType = (value: unknown, fallback: string) => {
  const terminalType = typeof value === 'string' ? value.trim() : ''
  return terminalTypeOptions.has(terminalType) ? terminalType : fallback
}
