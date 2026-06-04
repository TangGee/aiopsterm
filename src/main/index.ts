import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { watch } from 'fs'
import type { FSWatcher } from 'fs'
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import Store from 'electron-store'
import AdmZip from 'adm-zip'
import type {
  AliasCommandConfig,
  EditorUserConfig,
  KeywordHighlightUserConfig,
  KnowledgeBaseNodeConfig,
  KnowledgeBaseUserConfig,
  McpConfigFile,
  McpServerUserConfig,
  McpToolStatesUserConfig,
  ModelSettingsUserConfig,
  SecurityUserConfig,
  ShortcutUserConfig,
  SkillMetadataConfig,
  SkillUserConfig,
  SshAgentKeyConfig,
  SshProxyConfig,
  UserConfig,
  UserRuleConfig
} from '@shared/preload'

type PtyProcess = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
}

type PtyModule = {
  spawn(shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): PtyProcess
}

type TerminalSession = {
  id: string
  process: ChildProcessWithoutNullStreams | PtyProcess
  shell: string
  cwd: string
  window: BrowserWindow
  kind: 'pty' | 'process'
}

type SkillImportResult = {
  success: boolean
  skillName?: string
  error?: string
  errorCode?: 'INVALID_ZIP' | 'NO_SKILL_MD' | 'INVALID_METADATA' | 'DIR_EXISTS' | 'EXTRACT_FAILED' | 'UNKNOWN'
}

type KnowledgeBaseEntry = {
  name: string
  relPath: string
  type: 'file' | 'dir'
  size?: number
  mtimeMs?: number
}

type KnowledgeBaseTransferProgress = {
  jobId: string
  transferred: number
  total: number
  destRelPath: string
}

const defaultKeywordHighlightConfig: KeywordHighlightUserConfig = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const defaultSecurityConfig: SecurityUserConfig = {
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

const defaultKnowledgeBaseConfig: KnowledgeBaseUserConfig = {
  tree: [
    {
      id: 'kb-dir-commands',
      key: 'commands',
      relPath: 'commands',
      title: 'commands',
      type: 'dir',
      children: [
        {
          id: 'kb-file-rollback-plan',
          key: 'commands/rollback-plan.md',
          relPath: 'commands/rollback-plan.md',
          title: 'rollback-plan.md',
          type: 'file',
          size: 16384
        },
        {
          id: 'kb-file-diagnose',
          key: 'commands/diagnose.md',
          relPath: 'commands/diagnose.md',
          title: 'diagnose.md',
          type: 'file',
          size: 12288
        },
        {
          id: 'kb-file-summary',
          key: 'commands/Summary to Doc.md',
          relPath: 'commands/Summary to Doc.md',
          title: 'Summary to Doc.md',
          type: 'file',
          size: 24576
        }
      ]
    },
    {
      id: 'kb-dir-images',
      key: 'images',
      relPath: 'images',
      title: 'images',
      type: 'dir',
      children: [
        {
          id: 'kb-file-interface',
          key: 'images/interface.png',
          relPath: 'images/interface.png',
          title: 'interface.png',
          type: 'file',
          size: 303104
        }
      ]
    },
    {
      id: 'kb-file-markdown',
      key: 'Markdown语法指南.md',
      relPath: 'Markdown语法指南.md',
      title: 'Markdown语法指南.md',
      type: 'file',
      size: 18432
    }
  ],
  usedBytes: 350208,
  totalBytes: 1024 * 1024 * 1024
}

const defaultConfig: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  modelProvider: 'mock',
  modelEndpoint: '',
  modelName: 'mock-ops-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.15,
    brightness: 0.45
  },
  terminal: {
    terminalType: 'xterm-256color',
    fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
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
  workspacePreferences: {
    expandedGroups: ['recent_connections', 'group-生产', 'group-预发', 'local_connections', 'org-1', 'custom-folder-a'],
    showIpMode: false
  },
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
    shellIntegrationTimeout: 3000
  },
  modelSettings: {
    addModelSwitch: true,
    providers: {
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
      }
    },
    options: [
      { name: 'gpt-5', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
      { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
      { name: 'ops-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
      { name: 'custom-maintenance', locked: false, checked: false, type: 'custom', apiProvider: 'openai' }
    ]
  },
  shortcuts: [
    { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
    { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
    { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
    { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
  ],
  rules: [
    { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令和回滚点。', enabled: true },
    { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
  ],
  skills: [
    {
      name: 'incident-triage',
      description: 'Collect symptoms, recent changes, and affected services.',
      enabled: true,
      editable: true,
      content: 'When incident triage is requested, collect scope, blast radius, and recent deployments first.'
    },
    {
      name: 'k8s-rollout',
      description: 'Guide Kubernetes rollout inspection and rollback planning.',
      enabled: true,
      editable: true,
      content: 'Prefer kubectl describe, events, image pull checks, and rollback safety checks.'
    }
  ],
  mcpServers: [
    {
      name: 'filesystem',
      status: 'connected',
      disabled: false,
      tools: [
        {
          name: 'read_file',
          description: 'Read a workspace file for agent context.',
          enabled: true,
          parameters: [
            { name: 'path', description: 'Absolute file path.', required: true },
            { name: 'encoding', description: 'Optional text encoding.' }
          ]
        },
        {
          name: 'list_directory',
          description: 'List files under a directory.',
          enabled: true,
          parameters: [{ name: 'path', description: 'Directory path.', required: true }]
        }
      ],
      resources: [{ name: 'workspace-root', description: 'Current aiopsterm workspace.', uri: 'file:///workspace' }]
    },
    {
      name: 'ops-inventory',
      status: 'error',
      disabled: false,
      error: 'Token expired',
      tools: [
        {
          name: 'lookup_asset',
          description: 'Find a host by name, tag, or IP.',
          enabled: false,
          parameters: [{ name: 'query', description: 'Asset search query.', required: true }]
        }
      ],
      resources: []
    }
  ],
  mcpToolStates: {
    'filesystem:read_file': true,
    'filesystem:list_directory': true,
    'ops-inventory:lookup_asset': false
  },
  knowledgeBase: defaultKnowledgeBaseConfig,
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

if (process.env.AIOPSTERM_USER_DATA_DIR) {
  app.setPath('userData', process.env.AIOPSTERM_USER_DATA_DIR)
}

const store = new Store<{ config: UserConfig }>({
  name: 'aiopsterm-config',
  defaults: {
    config: defaultConfig
  }
})

const sessions = new Map<string, TerminalSession>()
let mainWindow: BrowserWindow | null = null
let securityConfigWatcher: FSWatcher | null = null
let keywordHighlightConfigWatcher: FSWatcher | null = null
let mcpConfigWatcher: FSWatcher | null = null
let skillsWatchers: FSWatcher[] = []
let skillsWatcherDebounce: NodeJS.Timeout | null = null

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

const cloneAliasCommands = (commands?: AliasCommandConfig[]): AliasCommandConfig[] | undefined =>
  commands?.map((command) => ({ ...command }))

const cloneShortcuts = (shortcuts?: ShortcutUserConfig[]): ShortcutUserConfig[] | undefined =>
  shortcuts?.map((shortcut) => ({ ...shortcut }))

const cloneRules = (rules?: UserRuleConfig[]): UserRuleConfig[] | undefined =>
  rules?.map((rule) => ({ ...rule }))

const cloneSkills = (skills?: SkillUserConfig[]): SkillUserConfig[] | undefined =>
  skills?.map((skill) => ({ ...skill }))

const isEditableSkill = (skill: SkillUserConfig) => {
  if (!skill.path) return skill.editable
  const userRoot = resolve(getSkillsUserPath())
  const skillPath = resolve(skill.path)
  return skillPath === userRoot || skillPath.startsWith(`${userRoot}${sep}`)
}

const normalizeSkillNameForDirectory = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'skill'

const parseSkillYamlValue = (value: string): string => {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const parseSkillFrontmatter = (content: string): { metadata: Partial<SkillMetadataConfig>; body: string } => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/)
  if (!match) {
    const heading = normalized.match(/^#\s+(.+)$/m)
    const paragraph = normalized.match(/^#.+\n+([^#\n][^\n]+)/m)
    return {
      metadata: {
        ...(heading ? { name: heading[1].trim() } : {}),
        ...(paragraph ? { description: paragraph[1].trim() } : {})
      },
      body: normalized.trim()
    }
  }
  const metadata: Partial<SkillMetadataConfig> = {}
  match[1].split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) return
    const key = line.slice(0, colonIndex).trim()
    const value = parseSkillYamlValue(line.slice(colonIndex + 1))
    if (key === 'name' || key === 'description') {
      metadata[key] = value
    }
  })
  return {
    metadata,
    body: match[2].trim()
  }
}

const validateSkillMetadata = (metadata: Partial<SkillMetadataConfig>) => {
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
  if (!name || !description) {
    throw new Error('Skill metadata requires name and description')
  }
  return { name, description }
}

const buildSkillFile = (metadata: SkillMetadataConfig, content: string) => {
  const safeDescription = metadata.description.replace(/\r?\n/g, ' ')
  return `---\nname: ${metadata.name}\ndescription: ${safeDescription}\n---\n\n${content.trim()}\n`
}

const cloneMcpServers = (servers?: McpServerUserConfig[]): McpServerUserConfig[] | undefined =>
  servers?.map((server) => ({
    ...server,
    tools: server.tools.map((tool) => ({
      ...tool,
      parameters: tool.parameters.map((parameter) => ({ ...parameter }))
    })),
    resources: server.resources.map((resource) => ({ ...resource }))
  }))

const cloneMcpToolStates = (states?: McpToolStatesUserConfig): McpToolStatesUserConfig | undefined =>
  states ? { ...states } : undefined

const cloneEditorSettings = (settings?: EditorUserConfig): EditorUserConfig | undefined =>
  settings ? { ...settings } : undefined

const cloneSshProxyConfigs = (configs?: SshProxyConfig[]): SshProxyConfig[] | undefined => configs?.map((config) => ({ ...config }))

const cloneSshAgentKeys = (keys?: SshAgentKeyConfig[]): SshAgentKeyConfig[] | undefined => keys?.map((key) => ({ ...key }))

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

const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = value.type === 'sse' || value.type === 'streamableHttp' ? value.type : 'stdio'
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

const mcpConfigFromUserConfig = (config: UserConfig): McpConfigFile => {
  const servers = config.mcpServers || []
  return {
    mcpServers: Object.fromEntries(
      servers.map((server) => [
        server.name,
        {
          type: 'stdio' as const,
          disabled: server.disabled,
          command: server.name === 'filesystem' ? 'npx' : server.name,
          args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', app.getPath('home')] : [],
          timeout: 60
        }
      ])
    )
  }
}

const normalizeKeywordHighlightConfig = (source?: unknown): KeywordHighlightUserConfig => {
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

const normalizeSecurityConfig = (source?: unknown): SecurityUserConfig => {
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

const cloneModelSettings = (settings?: ModelSettingsUserConfig): ModelSettingsUserConfig | undefined =>
  settings
    ? {
        addModelSwitch: settings.addModelSwitch,
        providers: {
          litellm: { ...settings.providers.litellm },
          openai: { ...settings.providers.openai }
        },
        options: settings.options.map((option) => ({ ...option }))
      }
    : undefined

const isDev = !app.isPackaged
const rendererUrl = process.env.ELECTRON_RENDERER_URL

app.setName('aiopsterm')
app.setAppUserModelId('app.aiopsterm.desktop')

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1344,
    height: 756,
    minWidth: 1024,
    minHeight: 680,
    title: 'aiopsterm',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized')
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:unmaximized')
  })
}

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

const mergeConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
  ...base,
  ...patch,
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
    expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || []
  },
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
  quickCommands:
    base.quickCommands || patch.quickCommands
      ? {
          groups: [...(patch.quickCommands?.groups || base.quickCommands?.groups || [])],
          snippets: [...(patch.quickCommands?.snippets || base.quickCommands?.snippets || [])]
        }
      : undefined,
  knowledgeBase: cloneKnowledgeBase(patch.knowledgeBase || base.knowledgeBase),
  aliasCommands: cloneAliasCommands(patch.aliasCommands || base.aliasCommands),
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

const getConfig = (): UserConfig => mergeConfig(defaultConfig, store.get('config'))

const getSecurityConfigPath = () => join(app.getPath('userData'), 'security-config.json')
const getKeywordHighlightConfigPath = () => join(app.getPath('userData'), 'keyword-highlight.json')
const getMcpConfigPath = () => join(app.getPath('userData'), 'setting', 'mcp_settings.json')
const getSkillsUserPath = () => join(app.getPath('userData'), 'skills')
const getSkillsInitMarkerPath = () => join(getSkillsUserPath(), '.aiopsterm-skills-initialized')
const getSkillFilePath = (skillDirName: string) => join(getSkillsUserPath(), skillDirName, 'SKILL.md')
const getKnowledgeBasePath = () => join(app.getPath('userData'), 'knowledgebase')
const getKnowledgeBaseInitMarkerPath = () => join(getKnowledgeBasePath(), '.aiopsterm-knowledge-initialized')

const blockedKnowledgeImportExtensions = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.app',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.iso',
  '.bin',
  '.dll',
  '.so',
  '.dylib',
  '.jar',
  '.class',
  '.pyc',
  '.o',
  '.a',
  '.lib',
  '.db',
  '.sqlite',
  '.sqlite3'
])

const knowledgeImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const maxKnowledgeImportBytes = 10 * 1024 * 1024

const normalizeKnowledgeRelPath = (relPath: string) => relPath.replace(/\\/g, '/').replace(/^\/+/, '')

const isSafeKnowledgeBasename = (name: string) => {
  if (!name || name === '.' || name === '..') return false
  return !name.includes('/') && !name.includes('\\')
}

const resolveKnowledgePath = (relPath: string) => {
  const normalized = normalizeKnowledgeRelPath(relPath || '')
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error('Absolute path not allowed')
  }
  const rootAbs = resolve(getKnowledgeBasePath())
  const absPath = resolve(rootAbs, normalized)
  if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) {
    throw new Error('Path escapes knowledgebase root')
  }
  return { rootAbs, absPath, relPath: normalized }
}

const pathExists = async (absPath: string) => {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

const splitNameExt = (fileName: string) => {
  const ext = extname(fileName)
  return { base: ext ? fileName.slice(0, -ext.length) : fileName, ext }
}

const ensureUniqueKnowledgeName = async (dirAbs: string, desiredName: string) => {
  const { base, ext } = splitNameExt(desiredName)
  let candidate = desiredName
  let index = 1
  while (await pathExists(join(dirAbs, candidate))) {
    candidate = `${base} (${index})${ext}`
    index += 1
  }
  return candidate
}

const getKnowledgeMimeType = (relPath: string) => {
  const ext = extname(relPath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

const knowledgeSeedContent = (node: KnowledgeBaseNodeConfig) => {
  if (node.relPath === 'commands/rollback-plan.md') {
    return '# rollback-plan\n\nGenerate rollback steps, validation checks, and risk notes for the current service.\n'
  }
  if (node.relPath === 'commands/diagnose.md') {
    return '# diagnose\n\nGenerate a read-only diagnosis plan from the current terminal, asset, and knowledge context.\n'
  }
  if (node.relPath === 'commands/Summary to Doc.md') {
    return '# Summary to Doc\n\nUse this note to summarize terminal findings, remediation steps, and reusable operations knowledge.\n'
  }
  if (node.relPath === 'Markdown语法指南.md') {
    return '# Markdown语法指南\n\n- 使用标题组织运维知识。\n- 使用代码块保存命令和输出。\n- 使用列表记录排查步骤和结论。\n'
  }
  if (node.relPath === 'images/interface.png') {
    return 'aiopsterm knowledge image placeholder\n'
  }
  return ''
}

const ensureKnowledgeSeedNode = async (node: KnowledgeBaseNodeConfig, parentRelDir = '') => {
  const relPath = node.relPath || posix.join(parentRelDir, node.title)
  const { absPath } = resolveKnowledgePath(relPath)
  if (node.type === 'dir') {
    await mkdir(absPath, { recursive: true })
    for (const child of node.children || []) {
      await ensureKnowledgeSeedNode(child, relPath)
    }
    return
  }
  if (!(await pathExists(absPath))) {
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, knowledgeSeedContent(node), 'utf-8')
  }
}

const ensureKnowledgeBaseDirectory = async () => {
  const knowledgePath = getKnowledgeBasePath()
  await mkdir(knowledgePath, { recursive: true })
  try {
    await access(getKnowledgeBaseInitMarkerPath())
  } catch {
    for (const node of defaultKnowledgeBaseConfig.tree) {
      await ensureKnowledgeSeedNode(node)
    }
    await writeFile(getKnowledgeBaseInitMarkerPath(), 'initialized\n', 'utf-8')
  }
  return knowledgePath
}

const listKnowledgeDir = async (relDir: string): Promise<KnowledgeBaseEntry[]> => {
  await ensureKnowledgeBaseDirectory()
  const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
  if (!(await pathExists(dirAbs))) return []
  const entries = await readdir(dirAbs, { withFileTypes: true })
  const result: KnowledgeBaseEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const childAbs = join(dirAbs, entry.name)
    const metadata = await stat(childAbs)
    const childRel = posix.join(normalizedRelDir, entry.name)
    result.push({
      name: entry.name,
      relPath: childRel,
      type: entry.isDirectory() ? 'dir' : 'file',
      ...(entry.isDirectory() ? {} : { size: metadata.size }),
      mtimeMs: metadata.mtimeMs
    })
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

const getKnowledgeNodeId = (relPath: string) => `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`

const buildKnowledgeTreeFromDisk = async (relDir = ''): Promise<KnowledgeBaseNodeConfig[]> => {
  const entries = await listKnowledgeDir(relDir)
  const nodes: KnowledgeBaseNodeConfig[] = []
  for (const entry of entries) {
    const node: KnowledgeBaseNodeConfig = {
      id: getKnowledgeNodeId(entry.relPath),
      key: entry.relPath,
      title: entry.name,
      type: entry.type,
      relPath: entry.relPath,
      ...(entry.type === 'file' ? { size: entry.size || 0 } : {})
    }
    if (entry.type === 'dir') {
      node.children = await buildKnowledgeTreeFromDisk(entry.relPath)
    }
    nodes.push(node)
  }
  return nodes
}

const sumKnowledgeTreeSize = (nodes: KnowledgeBaseNodeConfig[]): number =>
  nodes.reduce((total, node) => total + (node.size || 0) + (node.children ? sumKnowledgeTreeSize(node.children) : 0), 0)

const syncKnowledgeBaseConfigFromDisk = async () => {
  const tree = await buildKnowledgeTreeFromDisk()
  const config = getConfig()
  const nextKnowledgeBase: KnowledgeBaseUserConfig = {
    tree,
    usedBytes: sumKnowledgeTreeSize(tree),
    totalBytes: config.knowledgeBase?.totalBytes || defaultKnowledgeBaseConfig.totalBytes
  }
  store.set('config', mergeConfig(config, { knowledgeBase: nextKnowledgeBase }))
  return nextKnowledgeBase
}

const isKnowledgeFileAllowedForImport = (fileName: string, fileSize: number) => {
  const ext = extname(fileName).toLowerCase()
  if (ext && blockedKnowledgeImportExtensions.has(ext)) return false
  return fileSize <= maxKnowledgeImportBytes
}

const collectKnowledgeImportTasks = async (srcDir: string, destDir: string): Promise<Array<{ srcPath: string; destPath: string }>> => {
  const tasks: Array<{ srcPath: string; destPath: string }> = []
  const entries = await readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      tasks.push(...(await collectKnowledgeImportTasks(srcPath, destPath)))
      continue
    }
    if (!entry.isFile()) continue
    const metadata = await stat(srcPath)
    if (isKnowledgeFileAllowedForImport(entry.name, metadata.size)) {
      tasks.push({ srcPath, destPath })
    }
  }
  return tasks
}

const sendKnowledgeProgress = (window: BrowserWindow | null, payload: KnowledgeBaseTransferProgress) => {
  if (window && !window.isDestroyed()) {
    window.webContents.send('kb:transfer-progress', payload)
  }
}

const parseSkillFile = async (filePath: string): Promise<SkillUserConfig | null> => {
  const content = await readFile(filePath, 'utf-8')
  const parsed = parseSkillFrontmatter(content)
  try {
    const metadata = validateSkillMetadata(parsed.metadata)
    return {
      name: metadata.name,
      description: metadata.description,
      enabled: true,
      editable: isEditableSkill({ name: metadata.name, description: metadata.description, enabled: true, editable: true, content: parsed.body, path: filePath }),
      content: parsed.body,
      path: filePath
    }
  } catch {
    return null
  }
}

const hasAnySkillFile = async (dirPath: string) => {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'SKILL.md') return true
      if (entry.isDirectory()) {
        try {
          await access(join(dirPath, entry.name, 'SKILL.md'))
          return true
        } catch {
          // Ignore directories that are not skill folders.
        }
      }
    }
  } catch {
    return false
  }
  return false
}

const seedSkillsFromConfig = async (skills: SkillUserConfig[]) => {
  for (const skill of skills) {
    const name = skill.name?.trim()
    const description = skill.description?.trim()
    const content = skill.content?.trim()
    if (!name || !description || !content) continue
    const skillFilePath = getSkillFilePath(normalizeSkillNameForDirectory(name))
    try {
      await access(skillFilePath)
      continue
    } catch {
      await mkdir(dirname(skillFilePath), { recursive: true })
      await writeFile(skillFilePath, buildSkillFile({ name, description }, content), 'utf-8')
    }
  }
}

const ensureSkillsDirectory = async () => {
  const skillsPath = getSkillsUserPath()
  await mkdir(skillsPath, { recursive: true })
  try {
    await access(getSkillsInitMarkerPath())
  } catch {
    if (!(await hasAnySkillFile(skillsPath))) {
      await seedSkillsFromConfig(getConfig().skills || defaultConfig.skills || [])
    }
    await writeFile(getSkillsInitMarkerPath(), 'initialized\n', 'utf-8')
  }
  return skillsPath
}

const loadSkillsFromDisk = async (): Promise<SkillUserConfig[]> => {
  const skillsPath = await ensureSkillsDirectory()
  const savedStates = new Map((getConfig().skills || []).map((skill) => [skill.name, skill.enabled]))
  const entries = await readdir(skillsPath, { withFileTypes: true })
  const skillsByName = new Map<string, SkillUserConfig>()

  for (const entry of entries) {
    const filePath = entry.isDirectory() ? join(skillsPath, entry.name, 'SKILL.md') : entry.isFile() && entry.name === 'SKILL.md' ? join(skillsPath, entry.name) : ''
    if (!filePath) continue
    try {
      const skill = await parseSkillFile(filePath)
      if (!skill || skillsByName.has(skill.name)) continue
      skill.enabled = savedStates.has(skill.name) ? Boolean(savedStates.get(skill.name)) : true
      skillsByName.set(skill.name, skill)
    } catch {
      // Invalid or temporarily unavailable SKILL.md files are skipped until the next reload.
    }
  }

  return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

const broadcastSkillsUpdate = (skills: SkillUserConfig[]) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('skills:update', skills)
    }
  })
}

const syncSkillsConfigFromDisk = async () => {
  const skills = await loadSkillsFromDisk()
  store.set('config', mergeConfig(getConfig(), { skills }))
  broadcastSkillsUpdate(skills)
  return skills
}

const closeSkillsWatchers = () => {
  skillsWatchers.forEach((watcher) => watcher.close())
  skillsWatchers = []
}

const scheduleSkillsReload = () => {
  if (skillsWatcherDebounce) {
    clearTimeout(skillsWatcherDebounce)
  }
  skillsWatcherDebounce = setTimeout(() => {
    skillsWatcherDebounce = null
    syncSkillsConfigFromDisk()
      .then(() => startSkillsWatcher())
      .catch(() => {
        // External edits can briefly remove files or folders; the next event or manual reload will recover.
      })
  }, 100)
}

const startSkillsWatcher = async () => {
  const skillsPath = await ensureSkillsDirectory()
  closeSkillsWatchers()
  skillsWatchers.push(watch(skillsPath, scheduleSkillsReload))
  const entries = await readdir(skillsPath, { withFileTypes: true })
  entries
    .filter((entry) => entry.isDirectory())
    .forEach((entry) => {
      try {
        skillsWatchers.push(
          watch(join(skillsPath, entry.name), (_eventType, filename) => {
            if (!filename || filename.toString() === 'SKILL.md') {
              scheduleSkillsReload()
            }
          })
        )
      } catch {
        // A skill directory can be removed between readdir and watch.
      }
    })
  await syncSkillsConfigFromDisk()
}

const findSkillByName = async (skillName: string) => {
  const skills = await loadSkillsFromDisk()
  return skills.find((skill) => skill.name === skillName) || null
}

const ignoredSkillExportEntries = new Set(['.DS_Store', 'Thumbs.db', '.git', '.gitignore', 'node_modules', '__pycache__', '.vscode', '.idea'])

const normalizeZipEntryName = (entryName: string) => entryName.replace(/\\/g, '/')

const isUnsafeZipEntryName = (entryName: string) => {
  const normalized = normalizeZipEntryName(entryName)
  return normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')
}

const importSkillZip = async (zipPath: string, overwrite = false): Promise<SkillImportResult> => {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    return { success: false, error: 'Invalid or corrupted ZIP file', errorCode: 'INVALID_ZIP' }
  }

  const entries = zip.getEntries()
  if (!entries.length) {
    return { success: false, error: 'ZIP file is empty', errorCode: 'INVALID_ZIP' }
  }

  let skillMdEntry: AdmZip.IZipEntry | null = null
  let skillMdBasePath = ''

  for (const entry of entries) {
    const entryName = normalizeZipEntryName(entry.entryName)
    if (isUnsafeZipEntryName(entryName)) {
      return { success: false, error: 'ZIP file contains invalid paths', errorCode: 'INVALID_ZIP' }
    }
    if (entryName === 'SKILL.md') {
      skillMdEntry = entry
      skillMdBasePath = ''
      break
    }
    if (entryName.endsWith('/SKILL.md')) {
      const parts = entryName.split('/')
      if (parts.length === 2) {
        skillMdEntry = entry
        skillMdBasePath = `${parts[0]}/`
        break
      }
    }
  }

  if (!skillMdEntry) {
    return { success: false, error: 'No SKILL.md file found in ZIP', errorCode: 'NO_SKILL_MD' }
  }

  let metadata: SkillMetadataConfig
  try {
    metadata = validateSkillMetadata(parseSkillFrontmatter(skillMdEntry.getData().toString('utf-8')).metadata)
  } catch {
    return { success: false, error: 'Invalid SKILL.md metadata', errorCode: 'INVALID_METADATA' }
  }

  const userSkillsPath = await ensureSkillsDirectory()
  const skillDirName = normalizeSkillNameForDirectory(metadata.name)
  const targetDir = join(userSkillsPath, skillDirName)
  try {
    await access(targetDir)
    if (!overwrite) {
      return {
        success: false,
        skillName: metadata.name,
        error: `Skill "${metadata.name}" already exists`,
        errorCode: 'DIR_EXISTS'
      }
    }
    await rm(targetDir, { recursive: true, force: true })
  } catch {
    // Directory does not exist.
  }

  try {
    await mkdir(targetDir, { recursive: true })
    for (const entry of entries) {
      const entryName = normalizeZipEntryName(entry.entryName)
      if (isUnsafeZipEntryName(entryName)) {
        throw new Error(`Invalid ZIP entry path: ${entryName}`)
      }
      if (skillMdBasePath && !entryName.startsWith(skillMdBasePath)) {
        continue
      }
      if (entry.isDirectory) {
        continue
      }
      const relativePath = skillMdBasePath ? entryName.slice(skillMdBasePath.length) : entryName
      if (!relativePath) {
        continue
      }
      const targetPath = resolve(targetDir, relativePath)
      const targetRoot = `${resolve(targetDir)}${sep}`
      if (!targetPath.startsWith(targetRoot)) {
        throw new Error(`Invalid ZIP entry path: ${entryName}`)
      }
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, entry.getData())
    }
    await startSkillsWatcher()
    return { success: true, skillName: metadata.name }
  } catch {
    await rm(targetDir, { recursive: true, force: true })
    return { success: false, skillName: metadata.name, error: 'Failed to extract skill files', errorCode: 'EXTRACT_FAILED' }
  }
}

const addSkillDirectoryToZip = async (zip: AdmZip, rootDir: string, currentDir: string) => {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredSkillExportEntries.has(entry.name)) {
      continue
    }
    const fullPath = join(currentDir, entry.name)
    const relativePath = relative(rootDir, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      await addSkillDirectoryToZip(zip, rootDir, fullPath)
      continue
    }
    zip.addFile(relativePath, await readFile(fullPath))
  }
}

const exportSkillZipBuffer = async (skillName: string) => {
  const skill = await findSkillByName(skillName)
  if (!skill?.path) {
    throw new Error(`Skill not found: ${skillName}`)
  }
  const skillDir = dirname(skill.path)
  const metadata = await stat(skillDir)
  if (!metadata.isDirectory()) {
    throw new Error(`Skill directory not found: ${skillDir}`)
  }
  const zip = new AdmZip()
  await addSkillDirectoryToZip(zip, skillDir, skillDir)
  return zip.toBuffer()
}

const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

const defaultSecurityConfigContent = () => `// aiopsterm AI security configuration
// Edit this file to control command approval, block lists, allow lists, and command length limits.

${JSON.stringify(defaultSecurityConfig, null, 2)}
`

const ensureSecurityConfigFile = async () => {
  const configPath = getSecurityConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  try {
    await access(configPath)
  } catch {
    await writeFile(configPath, defaultSecurityConfigContent(), 'utf-8')
  }
  return configPath
}

const defaultKeywordHighlightConfigContent = () => JSON.stringify(defaultKeywordHighlightConfig, null, 2)

const ensureKeywordHighlightConfigFile = async () => {
  const configPath = getKeywordHighlightConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  try {
    await access(configPath)
  } catch {
    await writeFile(configPath, defaultKeywordHighlightConfigContent(), 'utf-8')
  }
  return configPath
}

const ensureMcpConfigFile = async () => {
  const configPath = getMcpConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  try {
    await access(configPath)
  } catch {
    await writeFile(configPath, JSON.stringify(mcpConfigFromUserConfig(getConfig()), null, 2), 'utf-8')
  }
  return configPath
}

const syncMcpConfigFromContent = (content: string) => {
  if (!content.trim()) return
  const parsed = normalizeMcpConfigFile(JSON.parse(content))
  const serverEntries = Object.entries(parsed.mcpServers)
  const current = getConfig()
  const byName = new Map((current.mcpServers || []).map((server) => [server.name, server]))
  const nextServers: McpServerUserConfig[] = serverEntries.map(([name, serverConfig]) => {
    const existing = byName.get(name)
    return {
      name,
      status: serverConfig.disabled ? 'disabled' : existing?.status && existing.status !== 'disabled' ? existing.status : 'connected',
      disabled: Boolean(serverConfig.disabled),
      ...(existing?.error && !serverConfig.disabled ? { error: existing.error } : {}),
      tools: existing?.tools || [],
      resources: existing?.resources || []
    }
  })
  const nextToolStates: McpToolStatesUserConfig = {}
  nextServers.forEach((server) => {
    server.tools.forEach((tool) => {
      nextToolStates[`${server.name}:${tool.name}`] = tool.enabled
    })
  })
  store.set('config', mergeConfig(current, { mcpServers: nextServers, mcpToolStates: nextToolStates }))
}

const broadcastMcpConfigChanged = (content: string) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('mcp-config:changed', content)
    }
  })
}

const syncKeywordHighlightConfigFromContent = (content: string) => {
  if (!content.trim()) return
  const parsed = JSON.parse(content) as Partial<UserConfig>
  if (!parsed.keywordHighlight && !('keyword-highlight' in parsed)) return
  const nextKeywordHighlight = normalizeKeywordHighlightConfig(parsed.keywordHighlight || parsed)
  const next = mergeConfig(getConfig(), { keywordHighlight: nextKeywordHighlight })
  store.set('config', next)
}

const broadcastKeywordHighlightConfigChanged = (content: string) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('keyword-highlight-config:changed', content)
    }
  })
}

const syncSecurityConfigFromContent = (content: string) => {
  const cleaned = removeJsonComments(content)
  if (!cleaned) return
  const parsed = JSON.parse(cleaned) as Partial<UserConfig>
  if (!parsed.securityConfig && !('security' in parsed)) return
  const nextSecurityConfig = normalizeSecurityConfig(parsed.securityConfig || parsed)
  const next = mergeConfig(getConfig(), { securityConfig: nextSecurityConfig })
  store.set('config', next)
}

const broadcastSecurityConfigChanged = (content: string) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('security-config:changed', content)
    }
  })
}

const startSecurityConfigWatcher = async () => {
  const configPath = await ensureSecurityConfigFile()
  securityConfigWatcher?.close()
  securityConfigWatcher = watch(configPath, async () => {
    try {
      const content = await readFile(configPath, 'utf-8')
      syncSecurityConfigFromContent(content)
      broadcastSecurityConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const startKeywordHighlightConfigWatcher = async () => {
  const configPath = await ensureKeywordHighlightConfigFile()
  keywordHighlightConfigWatcher?.close()
  keywordHighlightConfigWatcher = watch(configPath, async () => {
    try {
      const content = await readFile(configPath, 'utf-8')
      syncKeywordHighlightConfigFromContent(content)
      broadcastKeywordHighlightConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const startMcpConfigWatcher = async () => {
  const configPath = await ensureMcpConfigFile()
  mcpConfigWatcher?.close()
  mcpConfigWatcher = watch(configPath, async () => {
    try {
      const content = await readFile(configPath, 'utf-8')
      syncMcpConfigFromContent(content)
      broadcastMcpConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const loadPty = (): PtyModule | null => {
  try {
    return require('node-pty') as PtyModule
  } catch {
    return null
  }
}

const registerIpc = () => {
  ipcMain.handle('app:platform', () => process.platform)
  ipcMain.handle('app:shell', () => getDefaultShell())
  ipcMain.handle('app:check-update', () => ({ available: false, channel: 'local' as const }))
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.maximize()
  })
  ipcMain.handle('window:unmaximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.unmaximize()
  })
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false)
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:save', (_event, patch: Partial<UserConfig>) => {
    const next = mergeConfig(getConfig(), patch)
    store.set('config', next)
    return next
  })
  ipcMain.handle('security-config:path', async () => ensureSecurityConfigFile())
  ipcMain.handle('security-config:read', async () => {
    const configPath = await ensureSecurityConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('security-config:write', async (_event, content: string) => {
    const configPath = await ensureSecurityConfigFile()
    JSON.parse(removeJsonComments(content))
    await writeFile(configPath, content, 'utf-8')
    syncSecurityConfigFromContent(content)
    broadcastSecurityConfigChanged(content)
  })
  ipcMain.handle('keyword-highlight-config:path', async () => ensureKeywordHighlightConfigFile())
  ipcMain.handle('keyword-highlight-config:read', async () => {
    const configPath = await ensureKeywordHighlightConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('keyword-highlight-config:write', async (_event, content: string) => {
    const configPath = await ensureKeywordHighlightConfigFile()
    JSON.parse(content)
    await writeFile(configPath, content, 'utf-8')
    syncKeywordHighlightConfigFromContent(content)
    broadcastKeywordHighlightConfigChanged(content)
  })
  ipcMain.handle('mcp-config:path', async () => ensureMcpConfigFile())
  ipcMain.handle('mcp-config:read', async () => {
    const configPath = await ensureMcpConfigFile()
    return readFile(configPath, 'utf-8')
  })
  ipcMain.handle('mcp-config:write', async (_event, content: string) => {
    const configPath = await ensureMcpConfigFile()
    const normalized = normalizeMcpConfigFile(JSON.parse(content))
    const nextContent = JSON.stringify(normalized, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    syncMcpConfigFromContent(nextContent)
    broadcastMcpConfigChanged(nextContent)
  })
  ipcMain.handle('mcp-config:toggle-server', async (_event, serverName: string, disabled: boolean) => {
    const configPath = await ensureMcpConfigFile()
    const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
    if (!parsed.mcpServers[serverName]) {
      parsed.mcpServers[serverName] = { type: 'stdio' }
    }
    parsed.mcpServers[serverName].disabled = disabled
    const nextContent = JSON.stringify(parsed, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    syncMcpConfigFromContent(nextContent)
    broadcastMcpConfigChanged(nextContent)
  })
  ipcMain.handle('mcp-config:delete-server', async (_event, serverName: string) => {
    const configPath = await ensureMcpConfigFile()
    const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
    delete parsed.mcpServers[serverName]
    const nextContent = JSON.stringify(parsed, null, 2)
    await writeFile(configPath, nextContent, 'utf-8')
    syncMcpConfigFromContent(nextContent)
    broadcastMcpConfigChanged(nextContent)
  })
  ipcMain.handle('skills:get-all', async () => syncSkillsConfigFromDisk())
  ipcMain.handle('skills:get-enabled', async () => {
    const skills = await loadSkillsFromDisk()
    return skills.filter((skill) => skill.enabled)
  })
  ipcMain.handle('skills:set-enabled', async (_event, skillName: string, enabled: boolean) => {
    const skills = await loadSkillsFromDisk()
    const target = skills.find((skill) => skill.name === skillName)
    if (!target) throw new Error(`Skill not found: ${skillName}`)
    const nextSkills = skills.map((skill) => (skill.name === skillName ? { ...skill, enabled: Boolean(enabled) } : skill))
    store.set('config', mergeConfig(getConfig(), { skills: nextSkills }))
    broadcastSkillsUpdate(nextSkills)
  })
  ipcMain.handle('skills:get-user-path', async () => ensureSkillsDirectory())
  ipcMain.handle('skills:reload', async () => syncSkillsConfigFromDisk())
  ipcMain.handle('skills:create', async (_event, metadata: SkillMetadataConfig, content: string) => {
    const normalized = validateSkillMetadata(metadata)
    if (!/^[a-z-]+$/.test(normalized.name)) {
      throw new Error('Skill name can only contain lowercase letters and hyphens')
    }
    const skillContent = typeof content === 'string' ? content.trim() : ''
    if (!skillContent) {
      throw new Error('Skill content is required')
    }
    const skillsPath = await ensureSkillsDirectory()
    const existing = await loadSkillsFromDisk()
    if (existing.some((skill) => skill.name === normalized.name)) {
      throw new Error(`Skill already exists: ${normalized.name}`)
    }
    const skillDir = join(skillsPath, normalizeSkillNameForDirectory(normalized.name))
    try {
      await access(skillDir)
      throw new Error(`Skill directory already exists: ${skillDir}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Skill directory already exists')) throw error
    }
    await mkdir(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    await writeFile(skillPath, buildSkillFile(normalized, skillContent), 'utf-8')
    await startSkillsWatcher()
    const created = await findSkillByName(normalized.name)
    if (!created) throw new Error(`Failed to create skill: ${normalized.name}`)
    return created
  })
  ipcMain.handle('skills:delete', async (_event, skillName: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill || !skill.path) throw new Error(`Skill not found: ${skillName}`)
    if (!isEditableSkill(skill)) throw new Error('Can only delete user-created skills')
    await rm(dirname(skill.path), { recursive: true, force: true })
    await startSkillsWatcher()
  })
  ipcMain.handle('skills:open-folder', async () => {
    const skillsPath = await ensureSkillsDirectory()
    const result = await shell.openPath(skillsPath)
    if (result) throw new Error(result)
  })
  ipcMain.handle('skills:import-zip', async (_event, zipPath: string, overwrite?: boolean) => importSkillZip(zipPath, Boolean(overwrite)))
  ipcMain.handle('skills:read-content', async (_event, skillName: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    return {
      metadata: {
        name: skill.name,
        description: skill.description
      },
      content: skill.content
    }
  })
  ipcMain.handle('skills:update', async (_event, skillName: string, metadata: SkillMetadataConfig, content: string) => {
    const skill = await findSkillByName(skillName)
    if (!skill || !skill.path) throw new Error(`Skill not found: ${skillName}`)
    if (!isEditableSkill(skill)) throw new Error('Can only update user-created skills')
    const normalized = validateSkillMetadata({ ...metadata, name: skillName })
    const skillContent = typeof content === 'string' ? content.trim() : ''
    if (!skillContent) throw new Error('Skill content is required')
    await writeFile(skill.path, buildSkillFile(normalized, skillContent), 'utf-8')
    await startSkillsWatcher()
  })
  ipcMain.handle('skills:export-zip', async (event, skillName: string) => {
    const zipBuffer = await exportSkillZipBuffer(skillName)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const saveOptions = {
      defaultPath: `${skillName}.zip`,
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'cancelled' }
    }
    await writeFile(result.filePath, zipBuffer)
    return { success: true, filePath: result.filePath }
  })
  ipcMain.handle('dialog:open-file', async (event, options) => {
    if (process.env.NODE_ENV === 'test' && Array.isArray(options?.properties) && options.properties.includes('openDirectory')) {
      const importPath = join(app.getPath('userData'), 'e2e-imported-note.md')
      await writeFile(importPath, '# E2E imported note\n\nGenerated by the aiopsterm test harness.\n', 'utf-8')
      return { canceled: false, filePaths: [importPath] }
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
  })
  ipcMain.handle('dialog:save-file', async (event, options) => {
    if (process.env.NODE_ENV === 'test') {
      return { canceled: false, filePath: join(app.getPath('downloads'), options?.defaultPath ? basename(String(options.defaultPath)) : 'downloaded-file') }
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
  })
  ipcMain.handle('files:write-local', async (_event, filePath: string, content: string) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required')
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, typeof content === 'string' ? content : String(content), 'utf-8')
  })
  ipcMain.handle('kb:check-path', async (_event, payload: { absPath: string }) => {
    const absPath = typeof payload?.absPath === 'string' ? payload.absPath : ''
    try {
      const metadata = await stat(absPath)
      return {
        exists: true,
        isDirectory: metadata.isDirectory(),
        isFile: metadata.isFile()
      }
    } catch {
      return { exists: false, isDirectory: false, isFile: false }
    }
  })
  ipcMain.handle('kb:ensure-root', async () => {
    await ensureKnowledgeBaseDirectory()
    await syncKnowledgeBaseConfigFromDisk()
    return { success: true }
  })
  ipcMain.handle('kb:get-root', async () => {
    const root = await ensureKnowledgeBaseDirectory()
    await syncKnowledgeBaseConfigFromDisk()
    return { root }
  })
  ipcMain.handle('kb:list-dir', async (_event, payload: { relDir: string }) => listKnowledgeDir(payload?.relDir || ''))
  ipcMain.handle('kb:read-file', async (_event, payload: { relPath: string; encoding?: 'utf-8' | 'base64' }) => {
    const relPath = payload?.relPath || ''
    const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf-8'
    const { absPath } = resolveKnowledgePath(relPath)
    const metadata = await stat(absPath)
    if (!metadata.isFile()) throw new Error('Not a file')
    if (encoding === 'base64') {
      const content = (await readFile(absPath)).toString('base64')
      return {
        content,
        mtimeMs: metadata.mtimeMs,
        mimeType: getKnowledgeMimeType(relPath),
        isImage: knowledgeImageExtensions.has(extname(relPath).toLowerCase())
      }
    }
    return {
      content: await readFile(absPath, 'utf-8'),
      mtimeMs: metadata.mtimeMs
    }
  })
  ipcMain.handle('kb:write-file', async (_event, payload: { relPath: string; content: string; encoding?: 'utf-8' | 'base64' }) => {
    const relPath = payload?.relPath || ''
    const content = typeof payload?.content === 'string' ? payload.content : ''
    const encoding = payload?.encoding === 'base64' ? 'base64' : 'utf-8'
    const { absPath } = resolveKnowledgePath(relPath)
    await mkdir(dirname(absPath), { recursive: true })
    if (encoding === 'base64') {
      await writeFile(absPath, Buffer.from(content, 'base64'))
    } else {
      await writeFile(absPath, content, 'utf-8')
    }
    const metadata = await stat(absPath)
    await syncKnowledgeBaseConfigFromDisk()
    return { mtimeMs: metadata.mtimeMs }
  })
  ipcMain.handle('kb:mkdir', async (_event, payload: { relDir: string; name: string }) => {
    const relDir = payload?.relDir || ''
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    if (!isSafeKnowledgeBasename(name)) throw new Error('Invalid folder name')
    const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
    await mkdir(dirAbs, { recursive: true })
    const targetAbs = join(dirAbs, name)
    await mkdir(targetAbs, { recursive: false })
    const relPath = posix.join(normalizedRelDir, name)
    await syncKnowledgeBaseConfigFromDisk()
    return { success: true, relPath }
  })
  ipcMain.handle('kb:create-file', async (_event, payload: { relDir: string; name: string; content?: string }) => {
    const relDir = payload?.relDir || ''
    const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
    if (!isSafeKnowledgeBasename(name)) throw new Error('Invalid file name')
    const { absPath: dirAbs, relPath: normalizedRelDir } = resolveKnowledgePath(relDir)
    await mkdir(dirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dirAbs, name)
    await writeFile(join(dirAbs, finalName), typeof payload?.content === 'string' ? payload.content : '', 'utf-8')
    const relPath = posix.join(normalizedRelDir, finalName)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath }
  })
  ipcMain.handle('kb:rename', async (_event, payload: { relPath: string; newName: string }) => {
    const relPath = payload?.relPath || ''
    const newName = typeof payload?.newName === 'string' ? payload.newName.trim() : ''
    if (!isSafeKnowledgeBasename(newName)) throw new Error('Invalid name')
    const { absPath: srcAbs, relPath: normalizedRelPath } = resolveKnowledgePath(relPath)
    const parentAbs = dirname(srcAbs)
    const destAbs = join(parentAbs, newName)
    const parentRel = posix.dirname(normalizedRelPath)
    const nextRelPath = parentRel === '.' ? newName : posix.join(parentRel, newName)
    if (srcAbs === destAbs) return { relPath: nextRelPath }
    if (await pathExists(destAbs)) throw new Error('Target already exists')
    await rename(srcAbs, destAbs)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath: nextRelPath }
  })
  ipcMain.handle('kb:delete', async (_event, payload: { relPath: string; recursive?: boolean }) => {
    const relPath = payload?.relPath || ''
    const { absPath } = resolveKnowledgePath(relPath)
    const metadata = await stat(absPath)
    if (metadata.isDirectory()) {
      await rm(absPath, { recursive: Boolean(payload?.recursive), force: true })
    } else {
      await unlink(absPath)
    }
    await syncKnowledgeBaseConfigFromDisk()
    return { success: true }
  })
  ipcMain.handle('kb:move', async (_event, payload: { srcRelPath: string; dstRelDir: string }) => {
    const srcRelPath = payload?.srcRelPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const { absPath: srcAbs } = resolveKnowledgePath(srcRelPath)
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    if (dstDirAbs === srcAbs || dstDirAbs.startsWith(`${srcAbs}${sep}`)) {
      throw new Error('Cannot move a folder into itself')
    }
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbs))
    const destAbs = join(dstDirAbs, finalName)
    try {
      await rename(srcAbs, destAbs)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EXDEV') {
        await cp(srcAbs, destAbs, { recursive: true })
        await rm(srcAbs, { recursive: true, force: true })
      } else {
        throw error
      }
    }
    const relPath = posix.join(normalizedDstRelDir, finalName)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath }
  })
  ipcMain.handle('kb:copy', async (_event, payload: { srcRelPath: string; dstRelDir: string }) => {
    const srcRelPath = payload?.srcRelPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const { absPath: srcAbs } = resolveKnowledgePath(srcRelPath)
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    if (dstDirAbs === srcAbs || dstDirAbs.startsWith(`${srcAbs}${sep}`)) {
      throw new Error('Cannot copy a folder into itself')
    }
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbs))
    await cp(srcAbs, join(dstDirAbs, finalName), { recursive: true })
    const relPath = posix.join(normalizedDstRelDir, finalName)
    await syncKnowledgeBaseConfigFromDisk()
    return { relPath }
  })
  ipcMain.handle('kb:import-file', async (event, payload: { srcAbsPath: string; dstRelDir: string }) => {
    const srcAbsPath = payload?.srcAbsPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const sourceMetadata = await stat(srcAbsPath)
    if (!sourceMetadata.isFile()) throw new Error('Source is not a file')
    if (!isKnowledgeFileAllowedForImport(srcAbsPath, sourceMetadata.size)) {
      if (sourceMetadata.size > maxKnowledgeImportBytes) throw new Error('File too large')
      throw new Error('File type not allowed')
    }
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    await mkdir(dstDirAbs, { recursive: true })
    const finalName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbsPath))
    const destAbs = join(dstDirAbs, finalName)
    const jobId = randomUUID()
    const destRelPath = posix.join(normalizedDstRelDir, finalName)
    const owner = BrowserWindow.fromWebContents(event.sender)
    sendKnowledgeProgress(owner, { jobId, transferred: 0, total: sourceMetadata.size || 1, destRelPath })
    await cp(srcAbsPath, destAbs)
    sendKnowledgeProgress(owner, { jobId, transferred: sourceMetadata.size || 1, total: sourceMetadata.size || 1, destRelPath })
    await syncKnowledgeBaseConfigFromDisk()
    return { jobId, relPath: destRelPath }
  })
  ipcMain.handle('kb:import-folder', async (event, payload: { srcAbsPath: string; dstRelDir: string }) => {
    const srcAbsPath = payload?.srcAbsPath || ''
    const dstRelDir = payload?.dstRelDir || ''
    const sourceMetadata = await stat(srcAbsPath)
    if (!sourceMetadata.isDirectory()) throw new Error('Source is not a folder')
    const { absPath: dstDirAbs, relPath: normalizedDstRelDir } = resolveKnowledgePath(dstRelDir)
    await mkdir(dstDirAbs, { recursive: true })
    const finalFolderName = await ensureUniqueKnowledgeName(dstDirAbs, basename(srcAbsPath))
    const destFolderAbs = join(dstDirAbs, finalFolderName)
    const destFolderRel = posix.join(normalizedDstRelDir, finalFolderName)
    await mkdir(destFolderAbs, { recursive: true })
    const tasks = await collectKnowledgeImportTasks(srcAbsPath, destFolderAbs)
    const jobId = randomUUID()
    const owner = BrowserWindow.fromWebContents(event.sender)
    sendKnowledgeProgress(owner, { jobId, transferred: 0, total: tasks.length, destRelPath: destFolderRel })
    for (let index = 0; index < tasks.length; index += 1) {
      await mkdir(dirname(tasks[index].destPath), { recursive: true })
      await cp(tasks[index].srcPath, tasks[index].destPath)
      sendKnowledgeProgress(owner, { jobId, transferred: index + 1, total: tasks.length, destRelPath: destFolderRel })
    }
    await syncKnowledgeBaseConfigFromDisk()
    return { jobId, relPath: destFolderRel }
  })

  ipcMain.handle('terminal:create', (event, options: { cwd?: string; shell?: string; cols?: number; rows?: number } = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) {
      throw new Error('No owner window for terminal session')
    }

    const id = randomUUID()
    const terminalShell = options.shell || getDefaultShell()
    const cwd = options.cwd || app.getPath('home')
    const ptyModule = loadPty()
    if (ptyModule) {
      const ptyProcess = ptyModule.spawn(terminalShell, [], {
        name: 'xterm-256color',
        cols: options.cols || 100,
        rows: options.rows || 30,
        cwd,
        env: process.env
      })
      sessions.set(id, {
        id,
        process: ptyProcess,
        shell: terminalShell,
        cwd,
        window: owner,
        kind: 'pty'
      })
      ptyProcess.onData((data) => owner.webContents.send('terminal:data', { id, data }))
      ptyProcess.onExit((event) => {
        sessions.delete(id)
        owner.webContents.send('terminal:exit', { id, code: event.exitCode })
      })
    } else {
      const child = spawn(terminalShell, [], {
        cwd,
        env: process.env,
        shell: false
      })

      sessions.set(id, {
        id,
        process: child,
        shell: terminalShell,
        cwd,
        window: owner,
        kind: 'process'
      })

      child.stdout.on('data', (chunk: Buffer) => {
        owner.webContents.send('terminal:data', { id, data: chunk.toString('utf8') })
      })
      child.stderr.on('data', (chunk: Buffer) => {
        owner.webContents.send('terminal:data', { id, data: chunk.toString('utf8') })
      })
      child.on('exit', (code) => {
        sessions.delete(id)
        owner.webContents.send('terminal:exit', { id, code })
      })
      child.on('error', (childError) => {
        owner.webContents.send('terminal:data', { id, data: `\n[aiopsterm] failed to start shell: ${childError.message}\n` })
      })
      owner.webContents.send('terminal:data', {
        id,
        data: '\n[aiopsterm] pty unavailable, using subprocess fallback.\n'
      })
    }

    return { id, shell: terminalShell, cwd }
  })

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    const session = sessions.get(id)
    if (!session) return
    if (session.kind === 'pty') {
      ;(session.process as PtyProcess).write(data)
    } else {
      ;(session.process as ChildProcessWithoutNullStreams).stdin.write(data)
    }
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    const session = sessions.get(id)
    if (!session || session.kind !== 'pty') return
    ;(session.process as PtyProcess).resize(cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    session.process.kill()
    sessions.delete(id)
  })

  ipcMain.handle('files:list', async (_event, directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true })
    const result = await Promise.all(
      entries.slice(0, 500).map(async (entry) => {
        const fullPath = join(directory, entry.name)
        const metadata = await stat(fullPath)
        return {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size: metadata.size,
          modifiedAt: metadata.mtimeMs
        }
      })
    )
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  })
}

app.whenReady().then(async () => {
  registerIpc()
  await Promise.all([startSecurityConfigWatcher(), startKeywordHighlightConfigWatcher(), startMcpConfigWatcher(), startSkillsWatcher()])
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  sessions.forEach((session) => session.process.kill())
  sessions.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  securityConfigWatcher?.close()
  securityConfigWatcher = null
  keywordHighlightConfigWatcher?.close()
  keywordHighlightConfigWatcher = null
  mcpConfigWatcher?.close()
  mcpConfigWatcher = null
  closeSkillsWatchers()
  if (skillsWatcherDebounce) {
    clearTimeout(skillsWatcherDebounce)
    skillsWatcherDebounce = null
  }
})
