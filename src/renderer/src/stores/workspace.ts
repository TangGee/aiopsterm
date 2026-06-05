import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { validateCommandSecurity, type CommandSecurityResult } from '@/services/commandSecurityRuntime'
import { applyKeywordHighlight } from '@/services/keywordHighlightRuntime'
import {
  initialFileSessions,
  mockAliasCommands,
  mockExtensionPlugins,
  mockInitialTransferTasks,
  mockKnowledgeTree,
  mockK8sBastions,
  mockK8sClusters,
  mockK8sContexts,
  mockK8sNamespaces,
  mockK8sResources,
  mockQuickCommandSnippets,
  mockSettingsMcpServers,
  mockSettingsRules,
  mockSettingsShortcuts,
  mockSettingsSkills,
  mockSettingsTrustedDevices,
  createDefaultOnboardingCompleted,
  mockUserProfile,
  onboardingTourSteps,
  settingsModelOptions,
  mockSnippetGroups
} from '@/data/mockData'
import type {
  AiContextOption,
  AliasCommand,
  ExtensionPlugin,
  ExtensionInstallStage,
  FileSessionInfo,
  FileTransferTask,
  K8sBastionGroup,
  K8sContextInfo,
  K8sImportContextInfo,
  K8sNamespaceInfo,
  K8sProxyConfig,
  K8sResourceKind,
  K8sTerminalTab,
  MockK8sResource,
  MockK8sCluster,
  ModuleKey,
  OnboardingModuleId,
  QuickCommandSnippet,
  SettingSectionKey,
  SettingsMcpServer,
  SettingsRule,
  SettingsShortcut,
  SettingsSkill,
  SettingsTrustedDevice,
  MockUserProfile,
  SnippetGroup
} from '@/data/mockData'
import type { KnowledgeNode, KnowledgeNodeType } from '@/data/mockData'
import type {
  AiPreferencesUserConfig,
  AliasCommandConfig,
  EditorUserConfig,
  ExtensionUserConfig,
  KeywordHighlightRuleConfig,
  KeywordHighlightUserConfig,
  KnowledgeBaseEntry,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  McpServerUserConfig,
  McpToolStatesUserConfig,
  McpConfigFile,
  ModelOptionUserConfig,
  ModelSettingsUserConfig,
  PrivacyUserConfig,
  QuickCommandsUserConfig,
  SecurityUserConfig,
  ShortcutUserConfig,
  SkillUserConfig,
  SshAgentKeyConfig,
  SshProxyConfig,
  SshProxyType,
  TerminalMouseEventAction,
  TerminalUserConfig,
  UserConfig,
  UserRuleConfig,
  WorkspaceUserConfig
} from '@shared/preload'

type PanelDirection = 'right' | 'below'
type CloseMode = 'current' | 'others' | 'all'
type FilesUiMode = 'transfer' | 'default'
type KbClipboard = { mode: 'copy' | 'cut'; sources: string[] } | null
type ModelProviderKey = 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama'
type TopUpdateState = 'idle' | 'checking' | 'local' | 'available'
type OnboardingAiRequest =
  | 'none'
  | 'open-mode'
  | 'open-model'
  | 'open-context-main'
  | 'open-context-hosts'
  | 'prepare-send'
type OnboardingAssetRequest = 'none' | 'open-host-management' | 'open-create-form'
type ParsedSnippetCommand =
  | { type: 'COMMAND'; payload: string }
  | { type: 'SLEEP'; payload: number }
  | { type: 'KEY'; payload: 'esc' | 'tab' | 'return' | 'backspace' | 'up' | 'down' | 'left' | 'right' }
  | { type: 'CTRL'; payload: string }

type TerminalOutputScope = 'output' | 'input'
type TerminalCommandSource = 'direct' | 'global' | 'snippet' | 'agent'
type ExtensionInstallProgress = {
  pluginId: string
  stage: ExtensionInstallStage
  percent: number
}

type MacroCommandEntry = {
  command: string
  timestamp: number
}

export type TerminalSecurityExecution = {
  command: string
  panelIds: string[]
  inputText: string
  outputText?: string
  shellText?: string
  writeToShell: boolean
  source: TerminalCommandSource
}

export type TerminalSecurityPrompt = {
  id: string
  command: string
  panelIds: string[]
  source: TerminalCommandSource
  result: CommandSecurityResult
  summary: string
  execution: TerminalSecurityExecution
} | null

export type TerminalSecurityDecision =
  | { status: 'allow' }
  | { status: 'blocked'; result: CommandSecurityResult }
  | { status: 'needs-approval'; prompt: NonNullable<TerminalSecurityPrompt> }

export type TerminalOutputSegment = {
  text: string
  scope: TerminalOutputScope
}

export type TerminalPanel = {
  id: string
  title: string
  cwd: string
  output: string
  outputSegments: TerminalOutputSegment[]
  status: 'ready' | 'running' | 'closed'
  kind?: 'terminal' | 'knowledge'
  split?: PanelDirection
  sessionId?: string
  knowledge?: {
    relPath: string
    isImage: boolean
  }
  sshSession?: TerminalSshSession
}

export type TerminalSshSession = {
  connectionId: string
  sourcePanelId?: string
  forkFromConnectionId?: string
  host: string
  port: number
  username: string
  assetId?: string
  assetName: string
  organizationId?: string
  authType?: string
  createdAt: number
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  contentParts?: AiContentPart[]
  hosts?: AiContextOption[]
  state?: 'streaming' | 'done'
  favorite?: boolean
  feedback?: 'up' | 'down'
  executedCommand?: string
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

export type TodoItem = {
  id: string
  content: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  isFocused?: boolean
  subtasks?: Array<{
    id: string
    content: string
    description?: string
  }>
}

export type ConversationItem = {
  id: string
  title: string
  summary: string
  updatedAt: string
  ts: number
  ipAddress?: string
  favorite?: boolean
}

export type EditorSettings = EditorUserConfig

export type TerminalSettings = TerminalUserConfig

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

type SettingsModelOption = {
  name: string
  locked: boolean
  checked: boolean
  type?: 'standard' | 'custom'
  apiProvider?: string
}

type SshProxyForm = SshProxyConfig

type SshAgentKeyChainOption = {
  key: string
  label: string
  fingerprint: string
  keyType: string
}

export type KeywordHighlightSettings = KeywordHighlightUserConfig
export type SecuritySettings = SecurityUserConfig

export type AiPreferenceSettings = AiPreferencesUserConfig

type AiPreferencePatch = Partial<Omit<AiPreferenceSettings, 'proxy'>> & {
  proxy?: Partial<AiPreferenceSettings['proxy']>
}

function cloneKnowledgeNodes(nodes: KnowledgeNode[]): KnowledgeNode[] {
  return nodes.map((node) => ({ ...node, children: node.children ? cloneKnowledgeNodes(node.children) : undefined }))
}

const cloneShortcutConfig = (shortcuts: SettingsShortcut[]): ShortcutUserConfig[] =>
  shortcuts.map((shortcut) => ({
    id: shortcut.id,
    action: shortcut.action,
    shortcut: shortcut.shortcut,
    ...(shortcut.suffix ? { suffix: shortcut.suffix } : {})
  }))

const cloneRuleConfig = (rules: SettingsRule[]): UserRuleConfig[] =>
  rules
    .filter((rule) => rule.content.trim())
    .map((rule) => ({
      id: rule.id,
      content: rule.content.trim(),
      enabled: rule.enabled !== undefined ? rule.enabled : true
    }))

const cloneSkillConfig = (skills: SettingsSkill[]): SkillUserConfig[] =>
  skills
    .filter((skill) => skill.name.trim() && skill.description.trim() && skill.content.trim())
    .map((skill) => ({
      name: skill.name.trim(),
      description: skill.description.trim(),
      enabled: skill.enabled !== undefined ? skill.enabled : true,
      editable: skill.editable !== undefined ? skill.editable : true,
      content: skill.content.trim(),
      ...(skill.path ? { path: skill.path } : {})
    }))

const cloneModelOptionConfig = (options: SettingsModelOption[]): ModelOptionUserConfig[] =>
  options
    .filter((option) => option.name.trim())
    .map((option) => {
      const name = option.name.trim()
      const type = option.type || (name.startsWith('custom-') ? 'custom' : 'standard')
      return {
        name,
        locked: Boolean(option.locked),
        checked: Boolean(option.checked),
        type,
        apiProvider: option.apiProvider || (type === 'custom' ? 'openai' : 'default')
      }
    })

const cloneMcpServerConfig = (servers: SettingsMcpServer[]): McpServerUserConfig[] =>
  servers.map((server) => ({
    name: server.name,
    status: server.status,
    disabled: server.disabled,
    ...(server.error ? { error: server.error } : {}),
    tools: server.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      parameters: tool.parameters.map((parameter) => ({ ...parameter }))
    })),
    resources: server.resources.map((resource) => ({ ...resource }))
  }))

export type ExtensionSettings = ExtensionUserConfig

export type PrivacySettings = PrivacyUserConfig & {
  deactivateModalOpen: boolean
  deactivateConfirmationInput: string
}

export type BillingSettings = {
  skippedLogin: boolean
  email: string
  subscription: string
  subscriptionExpiresAt: string
  budgetResetAt: string
  ratio: number
}

export type UserLoginTab = 'account' | 'email' | 'mobile'

export type AboutSettings = {
  version: string
  updateStatus: 'idle' | 'checking' | 'latest' | 'available' | 'downloading'
  newVersion: string
  progress: number
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
      }
    },
    options: cloneModelOptionConfig(settingsModelOptions)
  },
  shortcuts: cloneShortcutConfig(mockSettingsShortcuts),
  rules: cloneRuleConfig(mockSettingsRules),
  skills: cloneSkillConfig(mockSettingsSkills),
  mcpServers: cloneMcpServerConfig(mockSettingsMcpServers),
  mcpToolStates: {
    'filesystem:read_file': true,
    'filesystem:list_directory': true,
    'ops-inventory:lookup_asset': false
  },
  quickCommands: {
    groups: mockSnippetGroups.map((group) => ({ ...group })),
    snippets: mockQuickCommandSnippets.map((snippet) => ({ ...snippet }))
  },
  knowledgeBase: {
    tree: cloneKnowledgeNodes(mockKnowledgeTree),
    usedBytes: 342 * 1024,
    totalBytes: 1024 * 1024 * 1024
  },
  aliasCommands: mockAliasCommands.map((alias) => ({ id: alias.id, alias: alias.alias, command: alias.command, createdAt: alias.createdAt })),
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

const ONBOARDING_VERSION = 2
const onboardingModuleIds: OnboardingModuleId[] = ['interfaceGuide', 'systemSettings', 'addAndConnectHost', 'aiChat']
const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`
const MACRO_MAX_RECORDING_DURATION_MS = 5 * 60 * 1000
const MACRO_MAX_COMMAND_COUNT = 50
const MACRO_DEFAULT_SLEEP_THRESHOLD_MS = 500
const k8sResourceTypeByKind: Record<K8sResourceKind, string> = {
  pods: 'pod',
  deployments: 'deployment',
  services: 'service',
  nodes: 'node'
}
const k8sKindLabels: Record<K8sResourceKind, string> = {
  pods: 'Pods',
  deployments: 'Deployments',
  services: 'Services',
  nodes: 'Nodes'
}
const ctrlKeyMap: Record<string, string> = {
  'ctrl+a': '\x01',
  'ctrl+b': '\x02',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+e': '\x05',
  'ctrl+f': '\x06',
  'ctrl+g': '\x07',
  'ctrl+h': '\x08',
  'ctrl+k': '\x0b',
  'ctrl+l': '\x0c',
  'ctrl+n': '\x0e',
  'ctrl+p': '\x10',
  'ctrl+r': '\x12',
  'ctrl+t': '\x14',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+z': '\x1a'
}
const keyMap: Record<string, string> = {
  esc: '\x1b',
  tab: '\t',
  return: '\r',
  backspace: '\b',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}
const keySequences = Object.entries(keyMap).sort(([, first], [, second]) => second.length - first.length) as Array<[SnippetKeyPayload, string]>
const ctrlSequences = Object.entries(ctrlKeyMap).sort(([, first], [, second]) => second.length - first.length)

const defaultTerminalSettings: TerminalSettings = {
  ...defaultConfig.terminal!
}

const defaultEditorSettings: EditorSettings = {
  ...defaultConfig.editorSettings!
}

const defaultWorkspacePreferences: WorkspaceUserConfig = {
  ...defaultConfig.workspacePreferences!,
  expandedGroups: [...defaultConfig.workspacePreferences!.expandedGroups]
}

const defaultQuickCommands: QuickCommandsUserConfig = {
  groups: mockSnippetGroups.map((group) => ({ ...group })),
  snippets: mockQuickCommandSnippets.map((snippet) => ({ ...snippet }))
}

const defaultKnowledgeBase: KnowledgeBaseUserConfig = {
  tree: cloneKnowledgeNodes(mockKnowledgeTree),
  usedBytes: defaultConfig.knowledgeBase!.usedBytes,
  totalBytes: defaultConfig.knowledgeBase!.totalBytes
}

const defaultAliasCommands: AliasCommandConfig[] = mockAliasCommands.map((alias) => ({
  id: alias.id,
  alias: alias.alias,
  command: alias.command,
  createdAt: alias.createdAt
}))

const defaultShortcuts: ShortcutUserConfig[] = cloneShortcutConfig(mockSettingsShortcuts)
const shortcutDefaultsById = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))
const shortcutModifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const defaultRules: UserRuleConfig[] = cloneRuleConfig(mockSettingsRules)
const defaultSkills: SkillUserConfig[] = cloneSkillConfig(mockSettingsSkills)
const defaultMcpServers: McpServerUserConfig[] = cloneMcpServerConfig(mockSettingsMcpServers)
const defaultMcpToolStates: McpToolStatesUserConfig = {
  'filesystem:read_file': true,
  'filesystem:list_directory': true,
  'ops-inventory:lookup_asset': false
}
const mcpStatusValues: McpServerUserConfig['status'][] = ['connected', 'connecting', 'disconnected', 'disabled', 'error']

const defaultMcpConfigFile = (): McpConfigFile => ({
  mcpServers: Object.fromEntries(
    defaultMcpServers.map((server) => [
      server.name,
      {
        type: 'stdio' as const,
        disabled: server.disabled,
        command: server.name === 'filesystem' ? 'npx' : server.name,
        args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', '~'] : [],
        timeout: 60
      }
    ])
  )
})
const defaultSshAgentKeyChainOptions: SshAgentKeyChainOption[] = [
  {
    key: 'key-prod-ed25519',
    label: 'prod-ed25519',
    fingerprint: 'SHA256:6qY8zR2aQ0prodEd25519',
    keyType: 'ED25519'
  },
  {
    key: 'key-staging-rsa',
    label: 'staging-rsa',
    fingerprint: 'SHA256:9uP1mR4bL7stagingRSA',
    keyType: 'RSA'
  },
  {
    key: 'key-bastion-ecdsa',
    label: 'bastion-ecdsa',
    fingerprint: 'SHA256:3wK5nE8cT2bastionECDSA',
    keyType: 'ECDSA'
  }
]

const terminalTypes = ['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi'] as const
const terminalCursorStyles = ['block', 'bar', 'underline'] as const
const middleMouseEventActions: TerminalMouseEventAction[] = ['none', 'paste', 'contextMenu', 'closeTab']
const rightMouseEventActions: TerminalSettings['rightMouseEvent'][] = ['none', 'paste', 'contextMenu']
const modelApiFormats: NonNullable<ModelProviderSettings['apiFormat']>[] = ['chat-completions', 'responses']
const modelOptionTypes: NonNullable<ModelOptionUserConfig['type']>[] = ['standard', 'custom']
const sshProxyTypes: SshProxyType[] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback

const integerInRange = (value: unknown, fallback: number, min: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)

const createMacroSnippetName = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return `macro-${year}${month}${day}-${hour}${minute}${second}`
}

const knowledgeNodeSize = (node: KnowledgeNode): number => (node.size || 0) + (node.children?.reduce((total, child) => total + knowledgeNodeSize(child), 0) || 0)

const knowledgeTreeSize = (nodes: KnowledgeNode[]) => nodes.reduce((total, node) => total + knowledgeNodeSize(node), 0)

const knowledgeEntryToNode = (entry: KnowledgeBaseEntry): KnowledgeNode => ({
  id: `kb-${entry.relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`,
  key: entry.relPath,
  relPath: entry.relPath,
  title: entry.name,
  type: entry.type,
  ...(entry.type === 'file' ? { size: entry.size || 0 } : { children: [] })
})

const normalizeTerminalConfig = (source?: Partial<TerminalUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: TerminalSettings = {
    terminalType: stringFromOptions(incoming.terminalType, terminalTypes, defaultTerminalSettings.terminalType),
    fontFamily: typeof incoming.fontFamily === 'string' && incoming.fontFamily.trim() ? incoming.fontFamily : defaultTerminalSettings.fontFamily,
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

const normalizeWorkspacePreferences = (source?: Partial<WorkspaceUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingExpandedGroups = Array.isArray(incoming.expandedGroups)
    ? incoming.expandedGroups.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.expandedGroups
  const normalized: WorkspaceUserConfig = {
    expandedGroups: Array.from(new Set(incomingExpandedGroups)),
    showIpMode: typeof incoming.showIpMode === 'boolean' ? incoming.showIpMode : defaultWorkspacePreferences.showIpMode
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.expandedGroups) ||
    incoming.expandedGroups.length !== normalized.expandedGroups.length ||
    incoming.expandedGroups.some((item, index) => item !== normalized.expandedGroups[index]) ||
    incoming.showIpMode !== normalized.showIpMode

  return {
    normalized,
    changed
  }
}

const editorWordWrapValues: EditorSettings['wordWrap'][] = ['on', 'off']

const normalizeEditorSettingsConfig = (source?: Partial<EditorUserConfig>) => {
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

const normalizeSshProxyConfigs = (source?: unknown) => {
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

const normalizeSshAgentKeys = (source?: unknown) => {
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

const booleanFromExtensionStatus = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 2) return false
  return fallback
}

const normalizeExtensionSettingsConfig = (source?: Partial<ExtensionUserConfig>) => {
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

const normalizeKeywordHighlightConfig = (source?: unknown) => {
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

const keywordHighlightEditorContentFromFile = (content: string) => (content.trim() ? content : JSON.stringify(defaultKeywordHighlightSettings, null, 2))

const parseKeywordHighlightEditorContent = (content: string) => JSON.parse(content)

const parseMcpEditorContent = (content: string) => JSON.parse(content)

const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = value.type === 'sse' || value.type === 'streamableHttp' ? value.type : 'stdio'
    const autoApprove = Array.isArray(value.autoApprove)
      ? value.autoApprove.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : undefined
    const args = Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : undefined
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

const mcpConfigFileToServers = (file: McpConfigFile, existingServers: SettingsMcpServer[]): SettingsMcpServer[] => {
  const existingByName = new Map(existingServers.map((server) => [server.name, server]))
  return Object.entries(file.mcpServers).map(([name, serverConfig]) => {
    const existing = existingByName.get(name)
    return {
      name,
      status: serverConfig.disabled ? 'disabled' : existing?.status && existing.status !== 'disabled' ? existing.status : 'connected',
      disabled: Boolean(serverConfig.disabled),
      ...(existing?.error && !serverConfig.disabled ? { error: existing.error } : {}),
      tools: existing?.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter })) })) || [],
      resources: existing?.resources.map((resource) => ({ ...resource })) || []
    }
  })
}

const normalizeStringArray = (source: unknown, fallback: string[]) => {
  if (!Array.isArray(source)) return { normalized: [...fallback], changed: true }
  const normalized = source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  return {
    normalized,
    changed: normalized.length !== source.length || normalized.some((item, index) => item !== source[index])
  }
}

const normalizeSecurityConfig = (source?: unknown) => {
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

const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

const securityEditorContentFromFile = (content: string) => {
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

const parseSecurityEditorContent = (content: string) => JSON.parse(removeJsonComments(content))

const privacyStatusValues = ['enabled', 'disabled'] as const
const privacyStatusFromOptions = (value: unknown, fallback: PrivacyUserConfig['telemetry']) =>
  stringFromOptions(value, privacyStatusValues, fallback)

const normalizePrivacyConfig = (source?: Partial<PrivacyUserConfig>) => {
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

const reasoningEffortValues = ['low', 'medium', 'high'] as const
const proxyTypeValues: AiPreferenceSettings['proxy']['type'][] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']
const defaultAiPreferencesConfig = defaultConfig.aiPreferences!

const normalizeThinkingBudget = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value === 0) return 0
  return Math.min(6553, Math.max(1024, Math.round(value)))
}

const normalizeAiPreferencesConfig = (source?: Partial<AiPreferencesUserConfig>) => {
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

const defaultModelSettingsConfig = defaultConfig.modelSettings!

const normalizeModelProviderConfig = (source: unknown, fallback: ModelProviderSettings): ModelProviderSettings => {
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

const normalizeModelSettingsConfig = (source?: unknown) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProviders = isRecord(incoming.providers) ? incoming.providers : {}
  const providers: ModelSettingsUserConfig['providers'] = {
    litellm: normalizeModelProviderConfig(incomingProviders.litellm, defaultModelSettingsConfig.providers.litellm),
    openai: normalizeModelProviderConfig(incomingProviders.openai, defaultModelSettingsConfig.providers.openai),
    bedrock: normalizeModelProviderConfig(incomingProviders.bedrock, defaultModelSettingsConfig.providers.bedrock),
    deepseek: normalizeModelProviderConfig(incomingProviders.deepseek, defaultModelSettingsConfig.providers.deepseek),
    anthropic: normalizeModelProviderConfig(incomingProviders.anthropic, defaultModelSettingsConfig.providers.anthropic),
    ollama: normalizeModelProviderConfig(incomingProviders.ollama, defaultModelSettingsConfig.providers.ollama)
  }

  const rawOptions = Array.isArray(incoming.options) ? incoming.options : defaultModelSettingsConfig.options
  const seenNames = new Set<string>()
  const options: ModelOptionUserConfig[] = []
  let changed = !isRecord(source) || !isRecord(incoming.providers) || !Array.isArray(incoming.options)
  rawOptions.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const option: ModelOptionUserConfig = {
      name,
      locked: Boolean(item.locked),
      checked: item.checked !== undefined ? Boolean(item.checked) : true,
      type: stringFromOptions(item.type, modelOptionTypes, item.locked ? 'standard' : 'custom'),
      apiProvider: typeof item.apiProvider === 'string' && item.apiProvider.trim() ? item.apiProvider.trim() : 'default'
    }
    options.push(option)
    const allowedKeys = new Set(['name', 'locked', 'checked', 'type', 'apiProvider'])
    if (
      item.name !== option.name ||
      item.locked !== option.locked ||
      item.checked !== option.checked ||
      item.type !== option.type ||
      item.apiProvider !== option.apiProvider ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

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

const normalizeQuickCommandsConfig = (source?: Partial<QuickCommandsUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const rawGroups = Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups
  const rawSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  const groupUuids = new Set<string>()
  const snippetIds = new Set<number>()
  const snippetUuids = new Set<string>()

  const groups = rawGroups
    .map((item, index): SnippetGroup | null => {
      if (!isRecord(item)) return null
      const groupName = typeof item.group_name === 'string' ? item.group_name.trim() : ''
      if (!groupName) return null
      const uuid = typeof item.uuid === 'string' && item.uuid.trim() ? item.uuid.trim() : `snippet-group-${index + 1}`
      if (groupUuids.has(uuid)) return null
      groupUuids.add(uuid)
      return {
        id: integerInRange(item.id, index + 1, 1),
        uuid,
        group_name: groupName
      }
    })
    .filter(Boolean) as SnippetGroup[]

  const normalizedSnippets: QuickCommandSnippet[] = []
  rawSnippets.forEach((item, index) => {
    if (!isRecord(item)) return
    const snippetName = typeof item.snippet_name === 'string' ? item.snippet_name.trim() : ''
    const snippetContent = typeof item.snippet_content === 'string' ? item.snippet_content : ''
    if (!snippetName || !snippetContent) return

    let id = integerInRange(item.id, index + 1, 1)
    while (snippetIds.has(id)) id += 1
    snippetIds.add(id)

    const uuid = typeof item.uuid === 'string' && item.uuid.trim() ? item.uuid.trim() : `snippet-${id}`
    if (snippetUuids.has(uuid)) return
    snippetUuids.add(uuid)

    const groupUuid = typeof item.group_uuid === 'string' && groupUuids.has(item.group_uuid) ? item.group_uuid : null
    const snippet: QuickCommandSnippet = {
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

const normalizeKnowledgeBaseConfig = (source?: Partial<KnowledgeBaseUserConfig>) => {
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

const normalizeAliasCommandsConfig = (source?: AliasCommandConfig[]) => {
  const rawCommands = Array.isArray(source) ? source : defaultAliasCommands
  const seenAliases = new Set<string>()
  const seenIds = new Set<string>()
  const normalized: AliasCommandConfig[] = []

  rawCommands.forEach((item, index) => {
    if (!isRecord(item)) return
    const alias = typeof item.alias === 'string' ? item.alias.trim() : ''
    const command = typeof item.command === 'string' ? item.command.trim() : ''
    if (!alias || !command || seenAliases.has(alias)) return
    let id = typeof item.id === 'string' && item.id.trim() && item.id !== 'new' ? item.id.trim() : `alias-${index + 1}`
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

const getShortcutParts = (shortcut: string) => shortcut.split('+').map((part) => part.trim()).filter(Boolean)

const isValidShortcutForAction = (actionId: string, shortcut: string) => {
  const parts = getShortcutParts(shortcut)
  if (!parts.length) return false
  if (actionId !== 'switchToSpecificTab') return true

  const hasDigit = parts.some((part) => /^\d$/.test(part))
  const hasModifier = parts.some((part) => shortcutModifierTokens.has(part.toLowerCase()))
  return !hasDigit && hasModifier
}

const normalizeShortcutsConfig = (source?: unknown) => {
  const shortcutsById = new Map<string, string>()
  let changed = !Array.isArray(source)

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!isRecord(item)) {
        changed = true
        return
      }
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const defaultShortcut = shortcutDefaultsById.get(id)
      const shortcut = typeof item.shortcut === 'string' ? item.shortcut.trim() : ''
      if (!defaultShortcut || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      shortcutsById.set(id, shortcut)
      const allowedKeys = new Set(['id', 'action', 'shortcut', 'suffix'])
      if (
        item.id !== id ||
        item.shortcut !== shortcut ||
        item.action !== defaultShortcut.action ||
        item.suffix !== defaultShortcut.suffix ||
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
      shortcutsById.set(id, shortcut)
      if (value !== shortcut) changed = true
    })
  }

  const normalized = defaultShortcuts.map((defaultShortcut) => ({
    ...defaultShortcut,
    shortcut: shortcutsById.get(defaultShortcut.id) || defaultShortcut.shortcut
  }))

  if (shortcutsById.size !== normalized.length) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

const normalizeRulesConfig = (source?: unknown, customInstructions?: unknown) => {
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
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `rule-${index + 1}`
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

const normalizeSkillsConfig = (source?: unknown) => {
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

const normalizeMcpToolStatesConfig = (source?: unknown): McpToolStatesUserConfig => {
  if (!isRecord(source)) return { ...defaultMcpToolStates }
  const normalized: McpToolStatesUserConfig = {}
  Object.entries(source).forEach(([key, value]) => {
    if (typeof key === 'string' && key.includes(':') && typeof value === 'boolean') {
      normalized[key] = value
    }
  })
  return normalized
}

const normalizeMcpServersConfig = (source?: unknown, toolStatesSource?: unknown) => {
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
    const status = disabled ? 'disabled' : stringFromOptions(item.status, mcpStatusValues, 'connected')
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
          parameters
        }
        if (tool.name !== normalizedTool.name || tool.description !== normalizedTool.description || tool.enabled !== normalizedTool.enabled) changed = true
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

const mergeUserConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
  ...base,
  ...patch,
  background: {
    ...base.background,
    ...(patch.background || {})
  },
  terminal: {
    ...(base.terminal || defaultTerminalSettings),
    ...(patch.terminal || {})
  },
  workspacePreferences: {
    ...(base.workspacePreferences || defaultWorkspacePreferences),
    ...(patch.workspacePreferences || {}),
    expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || defaultWorkspacePreferences.expandedGroups
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
  mcpServers: normalizeMcpServersConfig(patch.mcpServers || base.mcpServers, patch.mcpToolStates || base.mcpToolStates).normalized,
  mcpToolStates: normalizeMcpServersConfig(patch.mcpServers || base.mcpServers, patch.mcpToolStates || base.mcpToolStates).toolStates,
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
})

const normalizeOnboardingConfig = (source?: UserConfig['onboarding']) => {
  const completed = createDefaultOnboardingCompleted()
  const incomingCompleted = source?.completedModules || {}
  onboardingModuleIds.forEach((moduleId) => {
    completed[moduleId] = Boolean(incomingCompleted[moduleId])
  })

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

const defaultModelProviders: Record<ModelProviderKey, ModelProviderSettings> = {
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
  }
}

const defaultAiPreferences: AiPreferenceSettings = {
  ...defaultConfig.aiPreferences!,
  proxy: { ...defaultConfig.aiPreferences!.proxy }
}

const defaultExtensionSettings: ExtensionSettings = {
  ...defaultConfig.extensionSettings!
}

const defaultKeywordHighlightSettings: KeywordHighlightSettings = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const keywordHighlightScopes: KeywordHighlightRuleConfig['scope'][] = ['output', 'input', 'both']
const keywordHighlightMatchTypes: KeywordHighlightRuleConfig['matchType'][] = ['regex', 'wildcard']
const keywordHighlightFontStyles: KeywordHighlightRuleConfig['style']['fontStyle'][] = ['bold', 'normal']
const keywordHighlightHexColorPattern = /^#(?:[0-9a-fA-F]{6})$/

const defaultSecuritySettings: SecuritySettings = {
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

const defaultPrivacySettings: PrivacySettings = {
  ...defaultConfig.privacy!,
  deactivateModalOpen: false,
  deactivateConfirmationInput: ''
}

const defaultBillingSettings: BillingSettings = {
  skippedLogin: false,
  email: 'guest@example.local',
  subscription: 'pro',
  subscriptionExpiresAt: '2026-12-31',
  budgetResetAt: '2026-07-01',
  ratio: 0.42
}

const defaultAboutSettings: AboutSettings = {
  version: '0.1.0',
  updateStatus: 'idle',
  newVersion: '',
  progress: 0
}

type SnippetKeyPayload = Extract<ParsedSnippetCommand, { type: 'KEY' }>['payload']

const parseSnippetScript = (text: string): ParsedSnippetCommand[] => {
  const commands: ParsedSnippetCommand[] = []
  text.split(/\r\n|\n|\r/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return
    const sleepMatch = trimmed.match(/^sleep==(\d+)$/i)
    if (sleepMatch) {
      commands.push({ type: 'SLEEP', payload: Number(sleepMatch[1]) })
      return
    }
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('ctrl+') && ctrlKeyMap[lower]) {
      commands.push({ type: 'CTRL', payload: lower })
      return
    }
    if (['esc', 'tab', 'return', 'backspace', 'up', 'down', 'left', 'right'].includes(lower)) {
      commands.push({ type: 'KEY', payload: lower as SnippetKeyPayload })
      return
    }
    commands.push({ type: 'COMMAND', payload: trimmed })
  })
  return commands
}

const getKbParent = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

const createKbRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

const imageFileExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

const getFileExtension = (relPath: string) => {
  const fileName = relPath.split('/').pop() || relPath
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

const isKnowledgeImagePath = (relPath: string) => imageFileExtensions.has(getFileExtension(relPath))

const mediaTypeFromKnowledgePath = (relPath: string) => {
  const ext = getFileExtension(relPath)
  const mediaTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return mediaTypes[ext] || 'application/octet-stream'
}

const createTerminalSegments = (text: string, scope: TerminalOutputScope = 'output'): TerminalOutputSegment[] => (text ? [{ text, scope }] : [])

const appendTerminalSegment = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  if (!text) return
  panel.output += text
  if (!panel.outputSegments) {
    panel.outputSegments = []
  }
  panel.outputSegments.push({ text, scope })
}

const setTerminalOutput = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  panel.output = text
  panel.outputSegments = createTerminalSegments(text, scope)
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const mode = ref<'terminal' | 'agents'>('terminal')
  const activeModule = ref<ModuleKey>('workspace')
  const leftPanelOpen = ref(true)
  const rightPanelOpen = ref(true)
  const agentsLeftOpen = ref(true)
  const topUpdateState = ref<TopUpdateState>('idle')
  const topNotice = ref('')
  const onboardingCompleted = ref<Record<OnboardingModuleId, boolean>>(createDefaultOnboardingCompleted())
  const onboardingActiveTour = ref<OnboardingModuleId | null>(null)
  const onboardingActiveStepIndex = ref(0)
  const onboardingGuideOpen = ref(false)
  const onboardingAiRequest = ref<{ action: OnboardingAiRequest; stepId: string; sequence: number }>({
    action: 'none',
    stepId: '',
    sequence: 0
  })
  const onboardingAssetRequest = ref<{ action: OnboardingAssetRequest; stepId: string; sequence: number }>({
    action: 'none',
    stepId: '',
    sequence: 0
  })
  const onboardingAutoApprovalEvent = ref(0)
  const config = ref<UserConfig>(defaultConfig)
  const workspacePreferences = ref<WorkspaceUserConfig>({
    ...defaultWorkspacePreferences,
    expandedGroups: [...defaultWorkspacePreferences.expandedGroups]
  })
  const activePanelId = ref('panel-main')
  const panels = ref<TerminalPanel[]>([
    {
      id: 'panel-main',
      title: 'local shell',
      cwd: '~',
      kind: 'terminal',
      status: 'ready',
      output: 'aiopsterm local shell\n$ ',
      outputSegments: createTerminalSegments('aiopsterm local shell\n$ ')
    }
  ])
  const selectedConversationId = ref('conv-1')
  const now = Date.now()
  const conversations = ref<ConversationItem[]>([
    {
      id: 'conv-1',
      title: '生产巡检',
      summary: '分析磁盘、负载和服务状态',
      updatedAt: '刚刚',
      ts: now,
      ipAddress: '10.24.8.12'
    },
    {
      id: 'conv-2',
      title: 'K8s 发布失败',
      summary: '检查 Pod 事件和镜像拉取',
      updatedAt: '今天',
      ts: now - 1000 * 60 * 45,
      ipAddress: 'prod-cluster'
    },
    {
      id: 'conv-3',
      title: '数据库慢查询',
      summary: '梳理慢日志和索引建议',
      updatedAt: '昨天',
      ts: now - 1000 * 60 * 60 * 24,
      ipAddress: '10.32.6.9'
    }
  ])
  const selectedContexts = ref<AiContextOption[]>([
    { id: 'opened-local', kind: 'hosts', label: '127.0.0.1', detail: 'local shell' },
    { id: 'asset-1', kind: 'hosts', label: '10.24.8.12', detail: 'prod-bastion' }
  ])

  const createMockSshConnectionId = (asset: { id?: string; host: string; port?: number; username?: string; asset_type?: string }) =>
    `${asset.username || 'root'}@${asset.host}:${asset.port || 22}:${asset.asset_type || 'person'}:${createId('ssh')}`

  const registerMockSshSession = (
    panelId: string,
    asset: {
      id?: string
      name?: string
      title?: string
      host: string
      port?: number
      username?: string
      group_name?: string
      asset_type?: string
      auth_type?: string
    }
  ) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel) return null
    const title = asset.name || asset.title || asset.host
    const session: TerminalSshSession = {
      connectionId: createMockSshConnectionId(asset),
      host: asset.host,
      port: Number(asset.port) || 22,
      username: asset.username || 'root',
      assetId: asset.id,
      assetName: title,
      organizationId: asset.group_name,
      authType: asset.auth_type,
      createdAt: Date.now()
    }
    panel.kind = 'terminal'
    panel.sshSession = session
    return session
  }
  const aiSkillContextOptions = computed<AiContextOption[]>(() =>
    settingsSkills.value
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        id: `skill:${skill.name}`,
        kind: 'skills' as const,
        label: skill.name,
        detail: skill.description
      }))
  )
  const selectedCommandId = ref<string | null>(null)
  const selectedCommandRef = ref<AiCommandChipRef | null>(null)
  const filesUiMode = ref<FilesUiMode>('transfer')
  const fileSessions = ref<FileSessionInfo[]>([...initialFileSessions])
  const selectedLeftFileSessionId = ref<string | null>(null)
  const selectedRightFileSessionId = ref<string | null>('local')
  const fileTransferTasks = ref<FileTransferTask[]>(mockInitialTransferTasks.map((task) => ({ ...task, children: task.children ? [...task.children] : undefined })))
  const snippetGroups = ref<SnippetGroup[]>(mockSnippetGroups.map((group) => ({ ...group })))
  const quickCommands = ref<QuickCommandSnippet[]>(mockQuickCommandSnippets.map((snippet) => ({ ...snippet })))
  const selectedSnippetGroupUuid = ref<string | null>(null)
  const snippetSearchQuery = ref('')
  const isMacroRecording = ref(false)
  const macroCommandBuffer = ref<MacroCommandEntry[]>([])
  const recordedCommands = computed(() => macroCommandBuffer.value.map((entry) => entry.command))
  const macroCurrentLineBuffer = ref('')
  const macroRecordingStartTime = ref<number | null>(null)
  const macroTerminalId = ref<string | null>(null)
  const macroRecordControlKeys = ref(true)
  const macroSleepThresholdMs = ref(MACRO_DEFAULT_SLEEP_THRESHOLD_MS)
  const macroDefaultName = ref('')
  const macroTargetGroupUuid = ref<string | null>(null)
  const macroLimitReason = ref<'time' | 'count' | null>(null)
  let macroAutoStopTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  const knowledgeTree = ref<KnowledgeNode[]>(cloneKnowledgeNodes(mockKnowledgeTree))
  const kbExpandedKeys = ref<string[]>(['commands', 'images'])
  const kbSelectedKeys = ref<string[]>([])
  const kbSearchQuery = ref('')
  const kbClipboard = ref<KbClipboard>(null)
  const kbImportJobs = ref<Array<{ id: string; destRelPath: string; percent: number }>>([])
  const kbUsedBytes = ref(342 * 1024)
  const kbTotalBytes = ref(1024 * 1024 * 1024)
  const extensionSearchQuery = ref('')
  const extensionPlugins = ref<ExtensionPlugin[]>(mockExtensionPlugins.map((plugin) => ({ ...plugin, functions: plugin.functions ? [...plugin.functions] : undefined })))
  const selectedExtensionId = ref<string>('jumpserverSupport')
  const extensionDetailTab = ref<'details' | 'features'>('details')
  const extensionNotice = ref('')
  const extensionInstallLoadingMap = ref<Record<string, boolean>>({})
  const extensionUpdateLoadingMap = ref<Record<string, boolean>>({})
  const extensionInstallProgressMap = ref<Record<string, ExtensionInstallProgress>>({})
  const extensionDragActive = ref(false)
  const extensionInstallingPackageName = ref('')
  const aliasCommands = ref<AliasCommand[]>(mockAliasCommands.map((alias) => ({ ...alias })))
  const aliasEditSnapshot = ref<AliasCommand | null>(null)
  const aliasSearchQuery = ref('')
  const k8sContexts = ref<K8sContextInfo[]>(mockK8sContexts.map((context) => ({ ...context })))
  const k8sClusters = ref<MockK8sCluster[]>(mockK8sClusters.map((cluster) => ({ ...cluster })))
  const k8sBastions = ref<K8sBastionGroup[]>(mockK8sBastions.map((bastion) => ({ ...bastion })))
  const k8sNamespaces = ref<K8sNamespaceInfo[]>(mockK8sNamespaces.map((namespace) => ({ ...namespace })))
  const k8sResources = ref<MockK8sResource[]>(mockK8sResources.map((resource) => ({ ...resource })))
  const k8sConnectingClusterIds = ref<string[]>([])
  const k8sSyncingBastionIds = ref<string[]>([])
  const k8sDeleteConfirmClusterId = ref<string | null>(null)
  const k8sClusterActionMenuId = ref<string | null>(null)
  const k8sImportContexts = ref<K8sImportContextInfo[]>([
    { name: 'prod/admin', cluster: 'prod-cluster', server: 'https://prod.k8s.local:6443', namespace: 'default' },
    { name: 'staging/devops', cluster: 'staging-cluster', server: 'https://staging.k8s.local:6443', namespace: 'staging' }
  ])
  const k8sActiveClusterId = ref<string | null>('k8s-1')
  const k8sSearchQuery = ref('')
  const k8sConfigTab = ref<'local' | 'jumpserver'>('local')
  const k8sSelectedClusterId = ref<string | null>('k8s-1')
  const k8sClusterNotice = ref('')
  const k8sTerminalTabs = ref<K8sTerminalTab[]>([
    {
      id: 'k8s-tab-k8s-1',
      clusterId: 'k8s-1',
      name: 'prod-cluster',
      namespace: 'default',
      isActive: true,
      output: 'kubectl context: prod/admin\n$ '
    }
  ])
  const k8sActiveTerminalId = ref<string | null>('k8s-tab-k8s-1')
  const k8sAddModalOpen = ref(false)
  const k8sEditModalOpen = ref(false)
  const k8sEditingClusterId = ref<string | null>(null)
  const k8sAddMode = ref<'import' | 'manual'>('import')
  const k8sTestResult = ref<boolean | null>(null)
  const k8sCollapsedBastionIds = ref<string[]>([])
  const k8sResourceKind = ref<K8sResourceKind>('pods')
  const k8sResourceNamespace = ref('all')
  const k8sResourceQuery = ref('')
  const k8sResourceOutput = ref('选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。')
  const k8sResourceOutputTitle = ref('资源输出')
  const k8sResourceLoading = ref(false)
  const k8sCopiedCommand = ref('')
  const k8sProxyConfig = ref<K8sProxyConfig>({
    enabled: false,
    type: 'SOCKS5',
    host: '127.0.0.1',
    port: 1080,
    enableProxyIdentity: false,
    username: '',
    password: ''
  })
  const k8sProxyConfigOpen = ref(false)
  const activeSettingsSection = ref<SettingSectionKey>('general')
  const editorSettings = ref<EditorSettings>({ ...defaultEditorSettings })
  const terminalSettings = ref<TerminalSettings>({ ...defaultTerminalSettings })
  const sshProxyConfigs = ref<SshProxyConfig[]>([])
  const sshProxyConfigModalOpen = ref(false)
  const sshProxyAddModalOpen = ref(false)
  const sshProxyForm = ref<SshProxyForm>({
    name: '',
    type: 'SOCKS5',
    host: '127.0.0.1',
    port: 22,
    enableProxyIdentity: false,
    username: '',
    password: ''
  })
  const sshAgentKeys = ref<SshAgentKeyConfig[]>([])
  const sshAgentConfigModalOpen = ref(false)
  const sshAgentSelectedKey = ref('')
  const sshAgentKeyChainOptions = ref<SshAgentKeyChainOption[]>(defaultSshAgentKeyChainOptions.map((option) => ({ ...option })))
  const settingModelOptions = ref<SettingsModelOption[]>(
    settingsModelOptions.map((model) => {
      const type = model.name.startsWith('custom-') ? 'custom' : 'standard'
      return {
        ...model,
        type,
        apiProvider: type === 'custom' ? 'openai' : 'default'
      }
    })
  )
  const addModelSwitch = ref(true)
  const modelProviders = ref<Record<ModelProviderKey, ModelProviderSettings>>({
    litellm: { ...defaultModelProviders.litellm },
    openai: { ...defaultModelProviders.openai },
    bedrock: { ...defaultModelProviders.bedrock },
    deepseek: { ...defaultModelProviders.deepseek },
    anthropic: { ...defaultModelProviders.anthropic },
    ollama: { ...defaultModelProviders.ollama }
  })
  const modelCheckState = ref<Record<ModelProviderKey, 'idle' | 'checking' | 'success'>>({
    litellm: 'idle',
    openai: 'idle',
    bedrock: 'idle',
    deepseek: 'idle',
    anthropic: 'idle',
    ollama: 'idle'
  })
  const aiPreferences = ref<AiPreferenceSettings>({
    ...defaultAiPreferences,
    proxy: { ...defaultAiPreferences.proxy }
  })
  const extensionSettings = ref<ExtensionSettings>({ ...defaultExtensionSettings })
  const keywordHighlightSettings = ref<KeywordHighlightSettings>(normalizeKeywordHighlightConfig(defaultKeywordHighlightSettings).normalized)
  const keywordHighlightEditorOpen = ref(false)
  const keywordHighlightEditorContent = ref(JSON.stringify(defaultKeywordHighlightSettings, null, 2))
  const keywordHighlightEditorError = ref('')
  const keywordHighlightEditorLastSaved = ref(false)
  const keywordHighlightConfigPath = ref('~/.config/aiopsterm/keyword-highlight.json')
  const securitySettings = ref<SecuritySettings>(normalizeSecurityConfig(defaultSecuritySettings).normalized)
  const securityConfigEditorOpen = ref(false)
  const securityConfigEditorContent = ref(JSON.stringify(defaultSecuritySettings, null, 2))
  const securityConfigEditorError = ref('')
  const securityConfigEditorLastSaved = ref(false)
  const securityConfigPath = ref('~/.config/aiopsterm/security-config.json')
  const mcpConfigEditorOpen = ref(false)
  const mcpConfigEditorContent = ref(JSON.stringify(defaultMcpConfigFile(), null, 2))
  const mcpConfigEditorError = ref('')
  const mcpConfigEditorLastSaved = ref(false)
  const mcpConfigPath = ref('~/.config/aiopsterm/setting/mcp_settings.json')
  const privacySettings = ref<PrivacySettings>({ ...defaultPrivacySettings })
  const billingSettings = ref<BillingSettings>({ ...defaultBillingSettings })
  const aboutSettings = ref<AboutSettings>({ ...defaultAboutSettings })
  const userProfile = ref<MockUserProfile>({ ...mockUserProfile })
  const userNotice = ref('')
  const mcpServers = ref<SettingsMcpServer[]>(mockSettingsMcpServers.map((server) => ({ ...server, tools: server.tools.map((tool) => ({ ...tool, parameters: [...tool.parameters] })), resources: server.resources.map((resource) => ({ ...resource })) })))
  const expandedMcpServerNames = ref<string[]>(['filesystem'])
  const activeMcpServerTab = ref<Record<string, 'tools' | 'resources'>>({})
  const settingsSkills = ref<SettingsSkill[]>(mockSettingsSkills.map((skill) => ({ ...skill })))
  const skillsUserPath = ref('~/.config/aiopsterm/skills')
  const skillModal = ref<{ mode: 'create' | 'edit' | null; name: string; description: string; content: string }>({
    mode: null,
    name: '',
    description: '',
    content: ''
  })
  const settingsRules = ref<SettingsRule[]>(mockSettingsRules.map((rule) => ({ ...rule })))
  const settingsShortcuts = ref<SettingsShortcut[]>(mockSettingsShortcuts.map((shortcut) => ({ ...shortcut })))
  const shortcutRecording = ref<{ actionId: string | null; tempShortcut: string }>({ actionId: null, tempShortcut: '' })
  const trustedDevices = ref<SettingsTrustedDevice[]>(mockSettingsTrustedDevices.map((device) => ({ ...device })))
  const trustedDeviceModal = ref<{ open: boolean; id: number | null }>({ open: false, id: null })
  const settingsNotice = ref('')
  const todoItems = ref<TodoItem[]>([
    { id: 'todo-1', content: '收集上下文', description: '读取终端输出、资产和知识库引用', status: 'completed' },
    {
      id: 'todo-2',
      content: '生成命令建议',
      description: '只生成需要确认的只读命令',
      status: 'in_progress',
      isFocused: true,
      subtasks: [
        { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
        { id: 'todo-2-2', content: '生成回滚步骤' }
      ]
    },
    { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
  ])
  const chatMessages = ref<ChatMessage[]>([
    { id: 'msg-1', role: 'system', text: 'AI 能力当前使用本地 mock，占位保留聊天、上下文、命令建议和 Agent 状态流。' },
    { id: 'msg-2', role: 'assistant', text: '选择资产或输入目标后，我会生成可审计的执行计划。', state: 'done' }
  ])
  const terminalSecurityPrompt = ref<TerminalSecurityPrompt>(null)
  let keywordHighlightSaveTimer: number | null = null
  let removeKeywordHighlightConfigFileListener: (() => void) | null = null
  let keywordHighlightLoadRequest = 0
  let securityConfigSaveTimer: number | null = null
  let removeSecurityConfigFileListener: (() => void) | null = null
  let securityConfigLoadRequest = 0
  let mcpConfigSaveTimer: number | null = null
  let removeMcpConfigFileListener: (() => void) | null = null
  let mcpConfigLoadRequest = 0
  let removeSkillsUpdateListener: (() => void) | null = null
  let removeKnowledgeProgressListener: (() => void) | null = null
  let pendingSkillImportOverwritePath = ''

  const activePanel = computed(() => panels.value.find((panel) => panel.id === activePanelId.value) || panels.value[0])
  const isLeftVisible = computed(() => mode.value === 'terminal' && leftPanelOpen.value)
  const isRightVisible = computed(() => mode.value === 'terminal' && rightPanelOpen.value)
  const sortedConversations = computed(() => [...conversations.value].sort((a, b) => b.ts - a.ts))
  const todoProgress = computed(() => {
    const total = todoItems.value.length
    const completed = todoItems.value.filter((todo) => todo.status === 'completed').length
    const inProgress = todoItems.value.filter((todo) => todo.status === 'in_progress').length
    return {
      total,
      completed,
      inProgress,
      pending: total - completed - inProgress,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100)
    }
  })
  const selectedLeftFileSession = computed(() => fileSessions.value.find((session) => session.id === selectedLeftFileSessionId.value) || null)
  const selectedRightFileSession = computed(() => fileSessions.value.find((session) => session.id === selectedRightFileSessionId.value) || null)
  const transferTaskGroups = computed(() => {
    const groups = {
      download: fileTransferTasks.value.filter((task) => task.type === 'download'),
      upload: fileTransferTasks.value.filter((task) => task.type === 'upload'),
      r2r: fileTransferTasks.value.filter((task) => task.type === 'r2r')
    }
    return groups
  })
  const transferTaskCount = computed(() => fileTransferTasks.value.length)
  const transferOverallPercent = computed(() => {
    if (!fileTransferTasks.value.length) return 0
    const sum = fileTransferTasks.value.reduce((acc, task) => acc + task.progress, 0)
    return Math.round(sum / fileTransferTasks.value.length)
  })
  const filteredQuickCommands = computed(() => {
    const query = snippetSearchQuery.value.trim().toLowerCase()
    if (query) {
      return quickCommands.value.filter(
        (command) => command.snippet_name.toLowerCase().includes(query) || command.snippet_content.toLowerCase().includes(query)
      )
    }
    if (selectedSnippetGroupUuid.value) {
      return quickCommands.value.filter((command) => command.group_uuid === selectedSnippetGroupUuid.value)
    }
    return quickCommands.value.filter((command) => !command.group_uuid)
  })
  const currentSnippetGroupName = computed(() => snippetGroups.value.find((group) => group.uuid === selectedSnippetGroupUuid.value)?.group_name || '')
  const filteredKnowledgeTree = computed(() => {
    const query = kbSearchQuery.value.trim().toLowerCase()
    if (!query) return knowledgeTree.value
    const filter = (nodes: KnowledgeNode[]): KnowledgeNode[] =>
      nodes
        .map((node) => {
          const hit = node.title.toLowerCase().includes(query)
          const children = node.children ? filter(node.children) : []
          if (hit || children.length) return { ...node, children: children.length ? children : node.children }
          return null
        })
        .filter(Boolean) as KnowledgeNode[]
    return filter(knowledgeTree.value)
  })
  const kbCapacityPercent = computed(() => Math.min(100, Math.round((kbUsedBytes.value / kbTotalBytes.value) * 100)))
  const visibleExtensionPlugins = computed(() =>
    extensionPlugins.value
      .filter((plugin) => plugin.show && (plugin.pluginId !== 'Alias' || extensionSettings.value.aliasStatus))
      .sort((a, b) => {
        const rank = (plugin: ExtensionPlugin) => {
          if (!plugin.isPlugin) return 0
          if (plugin.installed) return 1
          if (plugin.hasUpdate) return 2
          return 3
        }
        const aRank = rank(a)
        const bRank = rank(b)
        if (aRank !== bRank) return aRank - bRank
        return a.name.localeCompare(b.name)
      })
  )
  const filteredExtensionPlugins = computed(() => {
    const query = extensionSearchQuery.value.trim().toLowerCase()
    const visible = visibleExtensionPlugins.value
    if (!query) return visible
    return visible.filter((plugin) =>
      [plugin.name, plugin.description, plugin.pluginId, plugin.source || '', ...(plugin.categories || [])].some((value) => value.toLowerCase().includes(query))
    )
  })
  const selectedExtension = computed(() => visibleExtensionPlugins.value.find((plugin) => plugin.pluginId === selectedExtensionId.value) || null)
  const selectedExtensionInstallProgress = computed(() =>
    selectedExtension.value ? extensionInstallProgressMap.value[selectedExtension.value.pluginId] || null : null
  )
  const filteredAliasCommands = computed(() => {
    const query = aliasSearchQuery.value.trim().toLowerCase()
    if (!query) return aliasCommands.value
    return aliasCommands.value.filter((item) => item.alias.toLowerCase().includes(query) || item.command.toLowerCase().includes(query))
  })
  const k8sHasContexts = computed(() => k8sContexts.value.length > 0)
  const k8sActiveContext = computed(() => k8sContexts.value.find((context) => context.isActive) || null)
  const k8sSelectedCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sSelectedClusterId.value) || null)
  const k8sActiveCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sActiveClusterId.value) || null)
  const k8sDeleteConfirmCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sDeleteConfirmClusterId.value) || null)
  const filteredK8sClusters = computed(() => {
    const query = k8sSearchQuery.value.trim().toLowerCase()
    return k8sClusters.value.filter((cluster) => {
      if (!query) return true
      return [cluster.name, cluster.context_name, cluster.server_url, cluster.default_namespace].some((value) => value.toLowerCase().includes(query))
    })
  })
  const localK8sClusters = computed(() => filteredK8sClusters.value.filter((cluster) => cluster.source_type === 'local'))
  const filteredK8sBastions = computed(() => {
    const query = k8sSearchQuery.value.trim().toLowerCase()
    if (!query) return k8sBastions.value
    return k8sBastions.value.filter((bastion) => {
      if ([bastion.label, bastion.ip].some((value) => value.toLowerCase().includes(query))) return true
      return k8sClusters.value.some(
        (cluster) =>
          cluster.source_type === 'jumpserver' &&
          cluster.bastion_uuid === bastion.uuid &&
          [cluster.name, cluster.server_url].some((value) => value.toLowerCase().includes(query))
      )
    })
  })
  const k8sActiveTerminal = computed(() => k8sTerminalTabs.value.find((tab) => tab.id === k8sActiveTerminalId.value) || null)
  const k8sResourceCluster = computed(() => k8sActiveCluster.value || k8sSelectedCluster.value || k8sClusters.value[0] || null)
  const k8sActiveNamespaces = computed(() => {
    const clusterId = k8sResourceCluster.value?.id
    if (!clusterId) return []
    const namespaceNames = new Set<string>()
    k8sNamespaces.value
      .filter((namespace) => namespace.clusterId === clusterId)
      .forEach((namespace) => namespaceNames.add(namespace.name))
    k8sResources.value
      .filter((resource) => resource.clusterId === clusterId && resource.kind !== 'nodes')
      .forEach((resource) => namespaceNames.add(resource.namespace))
    return [...namespaceNames].sort((a, b) => a.localeCompare(b))
  })
  const filteredK8sResources = computed(() => {
    const clusterId = k8sResourceCluster.value?.id
    if (!clusterId) return []
    const query = k8sResourceQuery.value.trim().toLowerCase()
    return k8sResources.value.filter((resource) => {
      if (resource.clusterId !== clusterId || resource.kind !== k8sResourceKind.value) return false
      if (resource.kind !== 'nodes' && k8sResourceNamespace.value !== 'all' && resource.namespace !== k8sResourceNamespace.value) return false
      if (!query) return true
      return [
        resource.name,
        resource.namespace,
        resource.status,
        resource.ready,
        resource.detail,
        resource.node || '',
        resource.image || '',
        resource.ports || '',
        resource.selector || ''
      ].some((value) => value.toLowerCase().includes(query))
    })
  })
  const k8sResourceSummary = computed<Record<K8sResourceKind, number>>(() => {
    const clusterId = k8sResourceCluster.value?.id
    const summary: Record<K8sResourceKind, number> = { pods: 0, deployments: 0, services: 0, nodes: 0 }
    if (!clusterId) return summary
    k8sResources.value.forEach((resource) => {
      if (resource.clusterId !== clusterId) return
      if (resource.kind !== 'nodes' && k8sResourceNamespace.value !== 'all' && resource.namespace !== k8sResourceNamespace.value) return
      summary[resource.kind] += 1
    })
    return summary
  })
  const onboardingCompletedCount = computed(() => Object.values(onboardingCompleted.value).filter(Boolean).length)
  const onboardingActiveSteps = computed(() => (onboardingActiveTour.value ? onboardingTourSteps[onboardingActiveTour.value] : []))
  const onboardingActiveStep = computed(() => onboardingActiveSteps.value[onboardingActiveStepIndex.value] || null)

  const hydrateConfig = async () => {
    if (!window.aiops) return
    const savedConfig = await window.aiops.getConfig()
    const missingTerminalConfig = !isRecord(savedConfig.terminal)
    const missingWorkspacePreferences = !isRecord(savedConfig.workspacePreferences)
    const missingEditorSettings = !isRecord(savedConfig.editorSettings)
    const missingSshProxyConfigs = !Array.isArray(savedConfig.sshProxyConfigs)
    const missingSshAgentKeys = !Array.isArray(savedConfig.sshAgentKeys)
    const missingExtensionSettings = !isRecord(savedConfig.extensionSettings)
    const missingKeywordHighlight = !isRecord(savedConfig.keywordHighlight)
    const missingSecurityConfig = !isRecord(savedConfig.securityConfig)
    const missingPrivacy = !isRecord(savedConfig.privacy)
    const missingAiPreferences = !isRecord(savedConfig.aiPreferences)
    const missingModelSettings = !isRecord(savedConfig.modelSettings)
    const missingQuickCommands = !isRecord(savedConfig.quickCommands)
    const missingKnowledgeBase = !isRecord(savedConfig.knowledgeBase)
    const missingAliasCommands = !Array.isArray(savedConfig.aliasCommands)
    const missingShortcuts = !Array.isArray(savedConfig.shortcuts)
    const missingRules = !Array.isArray(savedConfig.rules)
    const missingSkills = !Array.isArray(savedConfig.skills)
    const missingMcpServers = !Array.isArray(savedConfig.mcpServers)
    config.value = mergeUserConfig(defaultConfig, savedConfig)
    const { normalized: normalizedTerminal, changed: terminalChanged } = normalizeTerminalConfig(config.value.terminal)
    terminalSettings.value = normalizedTerminal
    const { normalized: normalizedWorkspacePreferences, changed: workspacePreferencesChanged } = normalizeWorkspacePreferences(config.value.workspacePreferences)
    workspacePreferences.value = normalizedWorkspacePreferences
    const { normalized: normalizedEditorSettings, changed: editorSettingsChanged } = normalizeEditorSettingsConfig(savedConfig.editorSettings)
    editorSettings.value = normalizedEditorSettings
    const { normalized: normalizedSshProxyConfigs, changed: sshProxyConfigsChanged } = normalizeSshProxyConfigs(savedConfig.sshProxyConfigs)
    sshProxyConfigs.value = normalizedSshProxyConfigs.map((config) => ({ ...config }))
    const { normalized: normalizedSshAgentKeys, changed: sshAgentKeysChanged } = normalizeSshAgentKeys(savedConfig.sshAgentKeys)
    sshAgentKeys.value = normalizedSshAgentKeys.map((key) => ({ ...key }))
    const { normalized: normalizedExtensionSettings, changed: extensionSettingsChanged } = normalizeExtensionSettingsConfig(savedConfig.extensionSettings)
    extensionSettings.value = normalizedExtensionSettings
    const { normalized: normalizedKeywordHighlight, changed: keywordHighlightChanged } = normalizeKeywordHighlightConfig(savedConfig.keywordHighlight)
    keywordHighlightSettings.value = normalizedKeywordHighlight
    keywordHighlightEditorContent.value = JSON.stringify(normalizedKeywordHighlight, null, 2)
    const { normalized: normalizedSecurityConfig, changed: securityConfigChanged } = normalizeSecurityConfig(savedConfig.securityConfig)
    securitySettings.value = normalizedSecurityConfig
    securityConfigEditorContent.value = JSON.stringify(normalizedSecurityConfig, null, 2)
    const { normalized: normalizedPrivacy, changed: privacyChanged } = normalizePrivacyConfig(savedConfig.privacy)
    privacySettings.value = {
      ...normalizedPrivacy,
      deactivateModalOpen: false,
      deactivateConfirmationInput: ''
    }
    const { normalized: normalizedAiPreferences, changed: aiPreferencesChanged } = normalizeAiPreferencesConfig(savedConfig.aiPreferences)
    aiPreferences.value = {
      ...normalizedAiPreferences,
      proxy: { ...normalizedAiPreferences.proxy }
    }
    const { normalized: normalizedModelSettings, changed: modelSettingsChanged } = normalizeModelSettingsConfig(savedConfig.modelSettings)
    addModelSwitch.value = normalizedModelSettings.addModelSwitch
    modelProviders.value = {
      litellm: { ...normalizedModelSettings.providers.litellm },
      openai: { ...normalizedModelSettings.providers.openai },
      bedrock: { ...normalizedModelSettings.providers.bedrock },
      deepseek: { ...normalizedModelSettings.providers.deepseek },
      anthropic: { ...normalizedModelSettings.providers.anthropic },
      ollama: { ...normalizedModelSettings.providers.ollama }
    }
    settingModelOptions.value = normalizedModelSettings.options.map((option) => ({
      name: option.name,
      locked: option.locked,
      checked: option.checked,
      type: option.type,
      apiProvider: option.apiProvider
    }))
    const { normalized: normalizedQuickCommands, changed: quickCommandsChanged } = normalizeQuickCommandsConfig(savedConfig.quickCommands)
    snippetGroups.value = normalizedQuickCommands.groups.map((group) => ({ ...group }))
    quickCommands.value = normalizedQuickCommands.snippets.map((snippet) => ({ ...snippet }))
    const { normalized: normalizedKnowledgeBase, changed: knowledgeBaseChanged } = normalizeKnowledgeBaseConfig(savedConfig.knowledgeBase)
    knowledgeTree.value = cloneKnowledgeNodes(normalizedKnowledgeBase.tree)
    kbUsedBytes.value = normalizedKnowledgeBase.usedBytes
    kbTotalBytes.value = normalizedKnowledgeBase.totalBytes
    const { normalized: normalizedAliasCommands, changed: aliasCommandsChanged } = normalizeAliasCommandsConfig(savedConfig.aliasCommands)
    aliasCommands.value = normalizedAliasCommands.map((alias) => ({ ...alias, edit: false }))
    const { normalized: normalizedShortcuts, changed: shortcutsChanged } = normalizeShortcutsConfig(savedConfig.shortcuts)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    const { normalized: normalizedRules, changed: rulesChanged } = normalizeRulesConfig(savedConfig.rules, savedConfig.customInstructions)
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    const { normalized: normalizedSkills, changed: skillsChanged } = normalizeSkillsConfig(savedConfig.skills)
    settingsSkills.value = normalizedSkills.map((skill) => ({ ...skill }))
    const {
      normalized: normalizedMcpServers,
      toolStates: normalizedMcpToolStates,
      changed: mcpServersChanged
    } = normalizeMcpServersConfig(savedConfig.mcpServers, savedConfig.mcpToolStates)
    mcpServers.value = normalizedMcpServers.map((server) => ({
      ...server,
      tools: server.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter })) })),
      resources: server.resources.map((resource) => ({ ...resource }))
    }))
    const { normalized, changed } = normalizeOnboardingConfig(config.value.onboarding)
    onboardingCompleted.value = normalized.completedModules
    config.value = mergeUserConfig(config.value, {
      terminal: normalizedTerminal,
      workspacePreferences: normalizedWorkspacePreferences,
      editorSettings: normalizedEditorSettings,
      sshProxyConfigs: normalizedSshProxyConfigs,
      sshAgentKeys: normalizedSshAgentKeys,
      extensionSettings: normalizedExtensionSettings,
      keywordHighlight: normalizedKeywordHighlight,
      securityConfig: normalizedSecurityConfig,
      privacy: normalizedPrivacy,
      aiPreferences: normalizedAiPreferences,
      modelSettings: normalizedModelSettings,
      quickCommands: normalizedQuickCommands,
      knowledgeBase: normalizedKnowledgeBase,
      aliasCommands: normalizedAliasCommands,
      shortcuts: normalizedShortcuts,
      rules: normalizedRules,
      skills: normalizedSkills,
      customInstructions: typeof savedConfig.customInstructions === 'string' && savedConfig.customInstructions.trim() ? '' : savedConfig.customInstructions,
      mcpServers: normalizedMcpServers,
      mcpToolStates: normalizedMcpToolStates,
      onboarding: normalized
    })
    if (
      changed ||
      terminalChanged ||
      missingTerminalConfig ||
      workspacePreferencesChanged ||
      missingWorkspacePreferences ||
      editorSettingsChanged ||
      missingEditorSettings ||
      sshProxyConfigsChanged ||
      missingSshProxyConfigs ||
      sshAgentKeysChanged ||
      missingSshAgentKeys ||
      extensionSettingsChanged ||
      missingExtensionSettings ||
      keywordHighlightChanged ||
      missingKeywordHighlight ||
      securityConfigChanged ||
      missingSecurityConfig ||
      privacyChanged ||
      missingPrivacy ||
      aiPreferencesChanged ||
      missingAiPreferences ||
      modelSettingsChanged ||
      missingModelSettings ||
      quickCommandsChanged ||
      missingQuickCommands ||
      knowledgeBaseChanged ||
      missingKnowledgeBase ||
      aliasCommandsChanged ||
      missingAliasCommands ||
      shortcutsChanged ||
      missingShortcuts ||
      rulesChanged ||
      missingRules ||
      skillsChanged ||
      missingSkills ||
      mcpServersChanged ||
      missingMcpServers
    ) {
      config.value = mergeUserConfig(
        config.value,
        await window.aiops.saveConfig({
          terminal: normalizedTerminal,
          workspacePreferences: normalizedWorkspacePreferences,
          editorSettings: normalizedEditorSettings,
          sshProxyConfigs: normalizedSshProxyConfigs,
          sshAgentKeys: normalizedSshAgentKeys,
          extensionSettings: normalizedExtensionSettings,
          keywordHighlight: normalizedKeywordHighlight,
          securityConfig: normalizedSecurityConfig,
          privacy: normalizedPrivacy,
          aiPreferences: normalizedAiPreferences,
          modelSettings: normalizedModelSettings,
          quickCommands: normalizedQuickCommands,
          knowledgeBase: normalizedKnowledgeBase,
          aliasCommands: normalizedAliasCommands,
          shortcuts: normalizedShortcuts,
          rules: normalizedRules,
          skills: normalizedSkills,
          customInstructions: '',
          mcpServers: normalizedMcpServers,
          mcpToolStates: normalizedMcpToolStates,
          onboarding: normalized
        })
      )
    }
    mode.value = config.value.defaultMode
    leftPanelOpen.value = config.value.leftPanelOpen
    rightPanelOpen.value = config.value.rightPanelOpen
    document.documentElement.dataset.theme = config.value.theme
    await loadSkillsFromBridge()
    setupKnowledgeBridgeListeners()
    await refreshKnowledgeTree({ persist: false })
  }

  const saveConfig = async (patch: Partial<UserConfig>) => {
    config.value = mergeUserConfig(config.value, patch)
    document.documentElement.dataset.theme = config.value.theme
    if (window.aiops) {
      config.value = mergeUserConfig(config.value, await window.aiops.saveConfig(patch))
    }
  }

  const getQuickCommandsSnapshot = (): QuickCommandsUserConfig => ({
    groups: snippetGroups.value.map((group) => ({ ...group })),
    snippets: quickCommands.value.map((snippet) => ({ ...snippet }))
  })

  const persistQuickCommands = () => {
    saveConfig({ quickCommands: getQuickCommandsSnapshot() })
  }

  const getKnowledgeBaseSnapshot = (): KnowledgeBaseUserConfig => ({
    tree: cloneKnowledgeNodes(knowledgeTree.value),
    usedBytes: kbUsedBytes.value,
    totalBytes: kbTotalBytes.value
  })

  const persistKnowledgeBase = () => {
    saveConfig({ knowledgeBase: getKnowledgeBaseSnapshot() })
  }

  const loadKnowledgeTreeFromBridge = async (relDir = ''): Promise<KnowledgeNode[]> => {
    if (!window.aiops?.kbListDir) return cloneKnowledgeNodes(knowledgeTree.value)
    const entries = await window.aiops.kbListDir(relDir)
    const nodes: KnowledgeNode[] = []
    for (const entry of entries) {
      const node = knowledgeEntryToNode(entry)
      if (entry.type === 'dir') {
        node.children = await loadKnowledgeTreeFromBridge(entry.relPath)
      }
      nodes.push(node)
    }
    return nodes
  }

  const refreshKnowledgeTree = async (options: { persist?: boolean } = {}) => {
    if (!window.aiops?.kbEnsureRoot || !window.aiops?.kbListDir) return
    await window.aiops.kbEnsureRoot()
    const nextTree = await loadKnowledgeTreeFromBridge('')
    const nextSnapshot: KnowledgeBaseUserConfig = {
      tree: cloneKnowledgeNodes(nextTree),
      usedBytes: knowledgeTreeSize(nextTree),
      totalBytes: kbTotalBytes.value
    }
    const changed = JSON.stringify(getKnowledgeBaseSnapshot()) !== JSON.stringify(nextSnapshot)
    knowledgeTree.value = nextTree
    kbUsedBytes.value = nextSnapshot.usedBytes
    if (changed && options.persist !== false) persistKnowledgeBase()
  }

  const handleKnowledgeTransferProgress = (event: KnowledgeBaseTransferProgress) => {
    const total = event.total || 1
    const percent = Math.min(100, Math.round((event.transferred / total) * 100))
    const existing = kbImportJobs.value.find((job) => job.id === event.jobId)
    if (existing) {
      existing.destRelPath = event.destRelPath
      existing.percent = percent
    } else {
      kbImportJobs.value.push({ id: event.jobId, destRelPath: event.destRelPath, percent })
    }
    if (percent >= 100) {
      window.setTimeout(() => {
        kbImportJobs.value = kbImportJobs.value.filter((job) => job.id !== event.jobId)
      }, 500)
    }
  }

  const setupKnowledgeBridgeListeners = () => {
    if (removeKnowledgeProgressListener || !window.aiops?.onKbTransferProgress) return
    removeKnowledgeProgressListener = window.aiops.onKbTransferProgress(handleKnowledgeTransferProgress)
  }

  const getAliasCommandsSnapshot = (): AliasCommandConfig[] =>
    aliasCommands.value
      .filter((alias) => alias.id !== 'new' && alias.alias.trim() && alias.command.trim())
      .map((alias) => ({
        id: alias.id,
        alias: alias.alias.trim(),
        command: alias.command.trim(),
        createdAt: alias.createdAt
      }))

  const persistAliasCommands = () => {
    saveConfig({ aliasCommands: getAliasCommandsSnapshot() })
  }

  const getExtensionSettingsSnapshot = (): ExtensionUserConfig => ({ ...extensionSettings.value })

  const getPrivacySnapshot = (): PrivacyUserConfig => ({
    telemetry: privacySettings.value.telemetry,
    secretRedaction: privacySettings.value.secretRedaction,
    dataSync: privacySettings.value.dataSync
  })

  const getAiPreferencesSnapshot = (): AiPreferencesUserConfig => ({
    ...aiPreferences.value,
    proxy: { ...aiPreferences.value.proxy }
  })

  const getModelSettingsSnapshot = (): ModelSettingsUserConfig => ({
    addModelSwitch: addModelSwitch.value,
    providers: {
      litellm: { ...modelProviders.value.litellm },
      openai: { ...modelProviders.value.openai },
      bedrock: { ...modelProviders.value.bedrock },
      deepseek: { ...modelProviders.value.deepseek },
      anthropic: { ...modelProviders.value.anthropic },
      ollama: { ...modelProviders.value.ollama }
    },
    options: settingModelOptions.value.map((option) => ({
      name: option.name,
      locked: Boolean(option.locked),
      checked: Boolean(option.checked),
      type: option.type || (option.locked ? 'standard' : 'custom'),
      apiProvider: option.apiProvider || (option.locked ? 'default' : 'openai')
    }))
  })

  const persistModelSettings = () => {
    saveConfig({ modelSettings: getModelSettingsSnapshot() })
  }

  const getShortcutsSnapshot = (): ShortcutUserConfig[] => cloneShortcutConfig(settingsShortcuts.value)

  const getRulesSnapshot = (): UserRuleConfig[] => cloneRuleConfig(settingsRules.value)

  const persistRules = () => {
    saveConfig({ rules: getRulesSnapshot(), customInstructions: '' })
  }

  const getSkillsSnapshot = (): SkillUserConfig[] => cloneSkillConfig(settingsSkills.value)

  const persistSkills = () => {
    saveConfig({ skills: getSkillsSnapshot() })
  }

  const applySkillsList = (skills: SkillUserConfig[]) => {
    const { normalized } = normalizeSkillsConfig(skills)
    settingsSkills.value = normalized.map((skill) => ({ ...skill }))
    config.value = mergeUserConfig(config.value, { skills: normalized })
  }

  const installSkillsUpdateListener = () => {
    if (removeSkillsUpdateListener || !window.aiops?.onSkillsUpdate) return
    removeSkillsUpdateListener = window.aiops.onSkillsUpdate((skills) => {
      applySkillsList(skills)
    })
  }

  const loadSkillsFromBridge = async () => {
    if (!window.aiops?.getSkills) return false
    try {
      installSkillsUpdateListener()
      const [path, skills] = await Promise.all([
        window.aiops.getSkillsUserPath ? window.aiops.getSkillsUserPath() : Promise.resolve(skillsUserPath.value),
        window.aiops.getSkills()
      ])
      skillsUserPath.value = path
      applySkillsList(skills)
      return true
    } catch {
      setSettingsNotice('Skills 加载失败')
      return false
    }
  }

  const reloadSkills = async () => {
    try {
      const skills = window.aiops?.reloadSkills ? await window.aiops.reloadSkills() : getSkillsSnapshot()
      applySkillsList(skills)
      setSettingsNotice('Skills 已重新加载')
      return true
    } catch {
      setSettingsNotice('Skills 重新加载失败')
      return false
    }
  }

  const openSkillsFolder = async () => {
    try {
      if (window.aiops?.openSkillsFolder) {
        await window.aiops.openSkillsFolder()
      }
      setSettingsNotice('Skills 文件夹已打开')
      return true
    } catch {
      setSettingsNotice('Skills 文件夹打开失败')
      return false
    }
  }

  const getMcpSnapshot = () => {
    const servers = cloneMcpServerConfig(mcpServers.value)
    const toolStates: McpToolStatesUserConfig = {}
    servers.forEach((server) => {
      server.tools.forEach((tool) => {
        toolStates[`${server.name}:${tool.name}`] = tool.enabled
      })
    })
    return { servers, toolStates }
  }

  const persistMcpServers = () => {
    const { servers, toolStates } = getMcpSnapshot()
    saveConfig({ mcpServers: servers, mcpToolStates: toolStates })
  }

  const applyMcpConfigFileContent = (content: string, markSaved = true) => {
    const editorContent = content.trim() ? content : JSON.stringify({ mcpServers: {} }, null, 2)
    mcpConfigEditorContent.value = editorContent
    try {
      const parsed = normalizeMcpConfigFile(parseMcpEditorContent(editorContent))
      mcpServers.value = mcpConfigFileToServers(parsed, mcpServers.value)
      expandedMcpServerNames.value = expandedMcpServerNames.value.filter((name) => mcpServers.value.some((server) => server.name === name))
      const { toolStates } = getMcpSnapshot()
      mcpConfigEditorError.value = ''
      mcpConfigEditorLastSaved.value = markSaved
      saveConfig({ mcpServers: cloneMcpServerConfig(mcpServers.value), mcpToolStates: toolStates })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
      mcpConfigEditorLastSaved.value = false
      return false
    }
  }

  const installMcpConfigFileListener = () => {
    if (removeMcpConfigFileListener || !window.aiops?.onMcpConfigFileChanged) return
    removeMcpConfigFileListener = window.aiops.onMcpConfigFileChanged((content) => {
      applyMcpConfigFileContent(content, true)
    })
  }

  const ensureSelectedExtensionVisible = () => {
    if (visibleExtensionPlugins.value.some((plugin) => plugin.pluginId === selectedExtensionId.value)) return
    selectedExtensionId.value = visibleExtensionPlugins.value[0]?.pluginId || ''
    extensionDetailTab.value = 'details'
  }

  const persistOnboardingState = async () => {
    await saveConfig({
      onboarding: {
        version: ONBOARDING_VERSION,
        guideTabAutoOpened: Boolean(config.value.onboarding?.guideTabAutoOpened),
        completedModules: { ...onboardingCompleted.value }
      }
    })
  }

  const setSettingsNotice = (text: string) => {
    settingsNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (settingsNotice.value === text) settingsNotice.value = ''
    }, 2400)
  }

  const setActiveSettingsSection = (key: SettingSectionKey) => {
    if (key === 'docs') {
      setSettingsNotice('已打开文档入口')
      return
    }
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    if (mcpConfigEditorOpen.value) {
      closeMcpConfigEditor()
    }
    onboardingGuideOpen.value = false
    activeSettingsSection.value = key
    if (key === 'skills') {
      void loadSkillsFromBridge()
    }
  }

  const prepareOnboardingStep = (moduleId: OnboardingModuleId, stepId: string) => {
    if (mode.value !== 'terminal') mode.value = 'terminal'
    onboardingAiRequest.value = {
      action: 'none',
      stepId,
      sequence: onboardingAiRequest.value.sequence + 1
    }
    onboardingAssetRequest.value = {
      action: 'none',
      stepId,
      sequence: onboardingAssetRequest.value.sequence + 1
    }

    if (moduleId === 'interfaceGuide') {
      activeModule.value = 'workspace'
      leftPanelOpen.value = true
      if (stepId === 'ai-sidebar') rightPanelOpen.value = true
      return
    }

    if (moduleId === 'systemSettings') {
      activeModule.value = 'settings'
      rightPanelOpen.value = false
      if (stepId === 'terminal-tab' || stepId === 'terminal-options') {
        activeSettingsSection.value = 'terminal'
      } else if (stepId === 'ai-preferences-tab' || stepId === 'ai-preferences-content' || stepId === 'ai-auto-approval') {
        activeSettingsSection.value = 'ai'
      } else {
        activeSettingsSection.value = 'general'
      }
      return
    }

    if (moduleId === 'addAndConnectHost') {
      activeModule.value = 'assets'
      leftPanelOpen.value = true
      rightPanelOpen.value = true
      const assetRequestMap: Record<string, OnboardingAssetRequest> = {
        'host-management': 'open-host-management',
        'new-host': 'open-host-management',
        'form-fields': 'open-create-form',
        'form-submit': 'open-create-form'
      }
      onboardingAssetRequest.value = {
        action: assetRequestMap[stepId] || 'none',
        stepId,
        sequence: onboardingAssetRequest.value.sequence + 1
      }
      if (stepId === 'new-host') setSettingsNotice('点击新建主机继续引导')
      return
    }

    if (moduleId === 'aiChat') {
      activeModule.value = 'workspace'
      leftPanelOpen.value = true
      rightPanelOpen.value = true
      const requestMap: Record<string, OnboardingAiRequest> = {
        'ai-mode-agent': 'open-mode',
        'ai-model-open': 'none',
        'ai-model-option': 'open-model',
        'ai-context-open': 'none',
        'ai-context-hosts': 'open-context-main',
        'ai-localhost-option': 'open-context-hosts',
        'ai-send': 'prepare-send'
      }
      onboardingAiRequest.value = {
        action: requestMap[stepId] || 'none',
        stepId,
        sequence: onboardingAiRequest.value.sequence + 1
      }
    }
  }

  const openOnboardingGuide = () => {
    activeModule.value = 'settings'
    activeSettingsSection.value = 'general'
    rightPanelOpen.value = false
    onboardingGuideOpen.value = true
    onboardingActiveTour.value = null
    onboardingActiveStepIndex.value = 0
    config.value = {
      ...config.value,
      onboarding: {
        version: ONBOARDING_VERSION,
        guideTabAutoOpened: true,
        completedModules: { ...onboardingCompleted.value }
      }
    }
    persistOnboardingState()
    setSettingsNotice('已打开入门引导')
  }

  const startOnboardingTour = (moduleId: OnboardingModuleId) => {
    onboardingActiveTour.value = moduleId
    onboardingActiveStepIndex.value = 0
    onboardingGuideOpen.value = false
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][0]?.id || '')
  }

  const stopOnboardingTour = () => {
    onboardingActiveTour.value = null
    onboardingActiveStepIndex.value = 0
  }

  const nextOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingActiveStepIndex.value + 1
    if (nextIndex >= onboardingActiveSteps.value.length) {
      onboardingCompleted.value = { ...onboardingCompleted.value, [moduleId]: true }
      persistOnboardingState()
      stopOnboardingTour()
      setSettingsNotice(`${moduleId === 'interfaceGuide' ? '界面导览' : moduleId === 'systemSettings' ? '系统设置' : moduleId === 'addAndConnectHost' ? '添加并连接主机' : 'AI 会话'} 引导已完成`)
      return
    }
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, onboardingActiveSteps.value[nextIndex]?.id || '')
  }

  const previousOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    onboardingActiveStepIndex.value = Math.max(0, onboardingActiveStepIndex.value - 1)
    prepareOnboardingStep(moduleId, onboardingActiveStep.value?.id || '')
  }

  const jumpOnboardingStep = (stepId: string) => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingActiveSteps.value.findIndex((step) => step.id === stepId)
    if (nextIndex < 0) return
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, stepId)
  }

  const resetOnboarding = () => {
    onboardingCompleted.value = createDefaultOnboardingCompleted()
    stopOnboardingTour()
    config.value = {
      ...config.value,
      onboarding: {
        version: ONBOARDING_VERSION,
        guideTabAutoOpened: false,
        completedModules: { ...onboardingCompleted.value }
      }
    }
    persistOnboardingState()
    setSettingsNotice('入门引导进度已重置')
  }

  const selectTheme = (theme: string) => {
    saveConfig({ theme })
  }

  const selectBackground = (mode: UserConfig['background']['mode'], image = '') => {
    saveConfig({
      background: {
        ...config.value.background,
        mode,
        image
      }
    })
  }

  const updateBackgroundTuning = (patch: Partial<Pick<UserConfig['background'], 'opacity' | 'brightness'>>) => {
    saveConfig({
      background: {
        ...config.value.background,
        ...patch
      }
    })
  }

  const updateDefaultLayout = (mode: 'terminal' | 'agents') => {
    saveConfig({ defaultMode: mode })
  }

  const updateLanguage = (language: string) => {
    saveConfig({ language })
  }

  const updateWatermark = (watermark: 'open' | 'close') => {
    saveConfig({ watermark })
  }

  const updateEditorSettings = (patch: Partial<EditorSettings>) => {
    editorSettings.value = normalizeEditorSettingsConfig({ ...editorSettings.value, ...patch }).normalized
    saveConfig({ editorSettings: { ...editorSettings.value } })
    setSettingsNotice('编辑器设置已保存')
  }

  const updateTerminalSettings = (patch: Partial<TerminalSettings>) => {
    terminalSettings.value = normalizeTerminalConfig({ ...terminalSettings.value, ...patch }).normalized
    saveConfig({ terminal: { ...terminalSettings.value } })
    setSettingsNotice('终端设置已保存')
  }

  const resetSshProxyForm = () => {
    sshProxyForm.value = {
      name: '',
      type: 'SOCKS5',
      host: '127.0.0.1',
      port: 22,
      enableProxyIdentity: false,
      username: '',
      password: ''
    }
  }

  const openSshProxyConfig = () => {
    sshProxyConfigModalOpen.value = true
  }

  const closeSshProxyConfig = () => {
    sshProxyConfigModalOpen.value = false
  }

  const openAddSshProxyConfig = () => {
    resetSshProxyForm()
    sshProxyAddModalOpen.value = true
  }

  const closeAddSshProxyConfig = () => {
    sshProxyAddModalOpen.value = false
    resetSshProxyForm()
  }

  const updateSshProxyForm = (patch: Partial<SshProxyForm>) => {
    sshProxyForm.value = {
      ...sshProxyForm.value,
      ...patch,
      type: stringFromOptions(patch.type || sshProxyForm.value.type, sshProxyTypes, 'SOCKS5'),
      port: patch.port !== undefined ? numberInRange(patch.port, sshProxyForm.value.port, 1, 65535) : sshProxyForm.value.port
    }
  }

  const saveSshProxyForm = () => {
    const rawName = sshProxyForm.value.name.trim()
    const rawHost = sshProxyForm.value.host.trim()
    if (!rawName) {
      setSettingsNotice('请输入代理配置名称')
      return false
    }
    if (!rawHost) {
      setSettingsNotice('请输入代理主机')
      return false
    }
    const proxyConfig = normalizeSshProxyConfigs([{ ...sshProxyForm.value, name: rawName, host: rawHost }]).normalized[0]
    if (!proxyConfig) return false
    if (sshProxyConfigs.value.some((config) => config.name === proxyConfig.name)) {
      setSettingsNotice('代理配置名称已存在')
      return false
    }
    sshProxyConfigs.value = [...sshProxyConfigs.value, proxyConfig]
    saveConfig({ sshProxyConfigs: sshProxyConfigs.value.map((config) => ({ ...config })) })
    closeAddSshProxyConfig()
    setSettingsNotice('SSH 代理配置已添加')
    return true
  }

  const removeSshProxyConfig = (name: string) => {
    const nextConfigs = sshProxyConfigs.value.filter((config) => config.name !== name)
    if (nextConfigs.length === sshProxyConfigs.value.length) return false
    sshProxyConfigs.value = nextConfigs
    saveConfig({ sshProxyConfigs: sshProxyConfigs.value.map((config) => ({ ...config })) })
    setSettingsNotice('SSH 代理配置已删除')
    return true
  }

  const getSshAgentKeysSnapshot = (): SshAgentKeyConfig[] => sshAgentKeys.value.map((key) => ({ ...key }))

  const openSshAgentConfig = () => {
    sshAgentConfigModalOpen.value = true
  }

  const closeSshAgentConfig = () => {
    sshAgentConfigModalOpen.value = false
  }

  const setSshAgentSelectedKey = (key: string) => {
    sshAgentSelectedKey.value = key
  }

  const addSshAgentKey = () => {
    const selectedKey = sshAgentSelectedKey.value
    if (!selectedKey) {
      setSettingsNotice('请选择密钥')
      return false
    }
    const option = sshAgentKeyChainOptions.value.find((item) => item.key === selectedKey)
    if (!option) {
      setSettingsNotice('密钥不存在')
      return false
    }
    if (sshAgentKeys.value.some((key) => key.keyChainId === option.key || key.id === option.key)) {
      setSettingsNotice('密钥已添加')
      sshAgentSelectedKey.value = ''
      return false
    }
    const agentKey: SshAgentKeyConfig = {
      id: option.key,
      fingerprint: option.fingerprint,
      comment: option.label,
      keyType: option.keyType,
      keyChainId: option.key
    }
    sshAgentKeys.value = [...sshAgentKeys.value, agentKey]
    sshAgentSelectedKey.value = ''
    saveConfig({ sshAgentKeys: getSshAgentKeysSnapshot() })
    setSettingsNotice('SSH Agent 密钥已添加')
    return true
  }

  const removeSshAgentKey = (id: string) => {
    const nextKeys = sshAgentKeys.value.filter((key) => key.id !== id)
    if (nextKeys.length === sshAgentKeys.value.length) return false
    sshAgentKeys.value = nextKeys
    saveConfig({ sshAgentKeys: getSshAgentKeysSnapshot() })
    setSettingsNotice('SSH Agent 密钥已移除')
    return true
  }

  const updateWorkspacePreferences = (patch: Partial<WorkspaceUserConfig>) => {
    workspacePreferences.value = normalizeWorkspacePreferences({ ...workspacePreferences.value, ...patch }).normalized
    saveConfig({ workspacePreferences: { ...workspacePreferences.value, expandedGroups: [...workspacePreferences.value.expandedGroups] } })
  }

  const updateModelOption = (name: string, checked: boolean) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked) return
    model.checked = checked
    persistModelSettings()
  }

  const removeModelOption = (name: string) => {
    settingModelOptions.value = settingModelOptions.value.filter((item) => item.name !== name || item.locked)
    persistModelSettings()
  }

  const toggleAddModelSwitch = (checked: boolean) => {
    addModelSwitch.value = checked
    persistModelSettings()
  }

  const updateModelProviderConfig = (provider: ModelProviderKey, patch: Partial<ModelProviderSettings>) => {
    modelProviders.value[provider] = { ...modelProviders.value[provider], ...patch }
    persistModelSettings()
  }

  const checkModelProvider = (provider: ModelProviderKey) => {
    modelCheckState.value = { ...modelCheckState.value, [provider]: 'checking' }
    window.setTimeout(() => {
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'success' }
      const providerLabel: Record<ModelProviderKey, string> = {
        litellm: 'LiteLLM',
        openai: 'OpenAI Compatible',
        bedrock: 'Amazon Bedrock',
        deepseek: 'DeepSeek',
        anthropic: 'Anthropic',
        ollama: 'Ollama'
      }
      setSettingsNotice(`${providerLabel[provider]} Check 成功`)
    }, 300)
  }

  const saveModelProvider = (provider: ModelProviderKey) => {
    const configPatch = modelProviders.value[provider]
    const providerName: Record<ModelProviderKey, UserConfig['modelProvider']> = {
      litellm: 'litellm',
      openai: 'openai-compatible',
      bedrock: 'bedrock',
      deepseek: 'deepseek',
      anthropic: 'anthropic',
      ollama: 'ollama'
    }
    const providerLabel: Record<ModelProviderKey, string> = {
      litellm: 'LiteLLM',
      openai: 'OpenAI Compatible',
      bedrock: 'Amazon Bedrock',
      deepseek: 'DeepSeek',
      anthropic: 'Anthropic',
      ollama: 'Ollama'
    }
    saveConfig({
      modelProvider: providerName[provider],
      modelEndpoint: configPatch.baseUrl,
      modelName: configPatch.modelId,
      modelSettings: getModelSettingsSnapshot()
    })
    setSettingsNotice(`${providerLabel[provider]} Save 成功`)
  }

  const updateAiPreferences = (patch: AiPreferencePatch) => {
    const enablesAutoApproval = patch.autoApproval === true && !aiPreferences.value.autoApproval
    aiPreferences.value = normalizeAiPreferencesConfig({
      ...getAiPreferencesSnapshot(),
      ...patch,
      proxy: patch.proxy ? { ...aiPreferences.value.proxy, ...patch.proxy } : aiPreferences.value.proxy
    }).normalized
    if (enablesAutoApproval) {
      onboardingAutoApprovalEvent.value += 1
    }
    saveConfig({ aiPreferences: getAiPreferencesSnapshot() })
    setSettingsNotice('AI 偏好设置已保存')
  }

  const updateExtensionSettings = (patch: Partial<ExtensionSettings>) => {
    extensionSettings.value = normalizeExtensionSettingsConfig({ ...extensionSettings.value, ...patch }).normalized
    ensureSelectedExtensionVisible()
    saveConfig({ extensionSettings: getExtensionSettingsSnapshot() })
    setSettingsNotice('扩展设置已保存')
  }

  const persistKeywordHighlightSettings = () => {
    saveConfig({ keywordHighlight: normalizeKeywordHighlightConfig(keywordHighlightSettings.value).normalized })
  }

  const applyKeywordHighlightConfigFileContent = (content: string, markSaved = true) => {
    const editorContent = keywordHighlightEditorContentFromFile(content)
    keywordHighlightEditorContent.value = editorContent
    try {
      const parsed = parseKeywordHighlightEditorContent(editorContent)
      const { normalized } = normalizeKeywordHighlightConfig(parsed)
      keywordHighlightSettings.value = normalized
      keywordHighlightEditorError.value = ''
      keywordHighlightEditorLastSaved.value = markSaved
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Invalid JSON: ${message}`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
  }

  const installKeywordHighlightConfigFileListener = () => {
    if (removeKeywordHighlightConfigFileListener || !window.aiops?.onKeywordHighlightConfigFileChanged) return
    removeKeywordHighlightConfigFileListener = window.aiops.onKeywordHighlightConfigFileChanged((content) => {
      if (applyKeywordHighlightConfigFileContent(content, true)) {
        persistKeywordHighlightSettings()
      }
    })
  }

  const openKeywordHighlightEditor = async () => {
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    if (mcpConfigEditorOpen.value) {
      closeMcpConfigEditor()
    }
    const requestId = ++keywordHighlightLoadRequest
    keywordHighlightEditorOpen.value = true
    keywordHighlightEditorContent.value = JSON.stringify(keywordHighlightSettings.value, null, 2)
    keywordHighlightEditorError.value = ''
    keywordHighlightEditorLastSaved.value = false
    installKeywordHighlightConfigFileListener()
    if (!window.aiops) return
    try {
      const [path, content] = await Promise.all([window.aiops.getKeywordHighlightConfigPath(), window.aiops.readKeywordHighlightConfig()])
      if (requestId !== keywordHighlightLoadRequest) return
      keywordHighlightConfigPath.value = path
      applyKeywordHighlightConfigFileContent(content, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Failed to read keyword highlight config: ${message}`
    }
  }

  const closeKeywordHighlightEditor = () => {
    keywordHighlightLoadRequest += 1
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    if (removeKeywordHighlightConfigFileListener) {
      removeKeywordHighlightConfigFileListener()
      removeKeywordHighlightConfigFileListener = null
    }
    keywordHighlightEditorOpen.value = false
  }

  const updateKeywordHighlightEditorContent = (content: string) => {
    keywordHighlightEditorContent.value = content
    keywordHighlightEditorLastSaved.value = false
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    try {
      parseKeywordHighlightEditorContent(content)
      keywordHighlightEditorError.value = ''
      keywordHighlightSaveTimer = window.setTimeout(() => {
        void saveKeywordHighlightEditor()
        keywordHighlightSaveTimer = null
      }, 1000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveKeywordHighlightEditor = async () => {
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    let parsed: unknown
    try {
      parsed = parseKeywordHighlightEditorContent(keywordHighlightEditorContent.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const { normalized } = normalizeKeywordHighlightConfig(parsed)
    keywordHighlightSettings.value = normalized
    keywordHighlightEditorContent.value = JSON.stringify(normalized, null, 2)
    keywordHighlightEditorError.value = ''
    try {
      await window.aiops?.writeKeywordHighlightConfig(keywordHighlightEditorContent.value)
      keywordHighlightEditorLastSaved.value = true
      persistKeywordHighlightSettings()
      setSettingsNotice('关键词高亮配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Save failed: ${message}`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
  }

  const resetKeywordHighlightEditor = async () => {
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    keywordHighlightSettings.value = normalizeKeywordHighlightConfig(defaultKeywordHighlightSettings).normalized
    keywordHighlightEditorContent.value = JSON.stringify(keywordHighlightSettings.value, null, 2)
    keywordHighlightEditorError.value = ''
    keywordHighlightEditorLastSaved.value = false
    try {
      await window.aiops?.writeKeywordHighlightConfig(keywordHighlightEditorContent.value)
      persistKeywordHighlightSettings()
      setSettingsNotice('关键词高亮配置已重置')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Reset failed: ${message}`
    }
  }

  const persistSecuritySettings = () => {
    saveConfig({ securityConfig: normalizeSecurityConfig(securitySettings.value).normalized })
  }

  const applySecurityConfigFileContent = (content: string, markSaved = true) => {
    const editorContent = securityEditorContentFromFile(content)
    securityConfigEditorContent.value = editorContent
    try {
      const parsed = parseSecurityEditorContent(editorContent)
      const { normalized } = normalizeSecurityConfig(parsed)
      securitySettings.value = normalized
      securityConfigEditorError.value = ''
      securityConfigEditorLastSaved.value = markSaved
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Invalid JSON: ${message}`
      securityConfigEditorLastSaved.value = false
      return false
    }
  }

  const installSecurityConfigFileListener = () => {
    if (removeSecurityConfigFileListener || !window.aiops?.onSecurityConfigFileChanged) return
    removeSecurityConfigFileListener = window.aiops.onSecurityConfigFileChanged((content) => {
      if (applySecurityConfigFileContent(content, true)) {
        persistSecuritySettings()
      }
    })
  }

  const openSecurityConfigEditor = async () => {
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (mcpConfigEditorOpen.value) {
      closeMcpConfigEditor()
    }
    const requestId = ++securityConfigLoadRequest
    securityConfigEditorOpen.value = true
    securityConfigEditorContent.value = JSON.stringify(securitySettings.value, null, 2)
    securityConfigEditorError.value = ''
    securityConfigEditorLastSaved.value = false
    installSecurityConfigFileListener()
    if (!window.aiops) return
    try {
      const [path, content] = await Promise.all([window.aiops.getSecurityConfigPath(), window.aiops.readSecurityConfig()])
      if (requestId !== securityConfigLoadRequest) return
      securityConfigPath.value = path
      applySecurityConfigFileContent(content, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Failed to read security config: ${message}`
    }
  }

  const closeSecurityConfigEditor = () => {
    securityConfigLoadRequest += 1
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    if (removeSecurityConfigFileListener) {
      removeSecurityConfigFileListener()
      removeSecurityConfigFileListener = null
    }
    securityConfigEditorOpen.value = false
  }

  const updateSecurityConfigEditorContent = (content: string) => {
    securityConfigEditorContent.value = content
    securityConfigEditorLastSaved.value = false
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    try {
      parseSecurityEditorContent(content)
      securityConfigEditorError.value = ''
      securityConfigSaveTimer = window.setTimeout(() => {
        void saveSecurityConfigEditor()
        securityConfigSaveTimer = null
      }, 1000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveSecurityConfigEditor = async () => {
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    let parsed: unknown
    try {
      parsed = parseSecurityEditorContent(securityConfigEditorContent.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const { normalized } = normalizeSecurityConfig(parsed)
    securitySettings.value = normalized
    securityConfigEditorContent.value = JSON.stringify(normalized, null, 2)
    securityConfigEditorError.value = ''
    try {
      await window.aiops?.writeSecurityConfig(securityConfigEditorContent.value)
      securityConfigEditorLastSaved.value = true
      persistSecuritySettings()
      setSettingsNotice('安全配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Save failed: ${message}`
      securityConfigEditorLastSaved.value = false
      return false
    }
  }

  const resetSecurityConfigEditor = async () => {
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    securitySettings.value = normalizeSecurityConfig(defaultSecuritySettings).normalized
    securityConfigEditorContent.value = JSON.stringify(securitySettings.value, null, 2)
    securityConfigEditorError.value = ''
    securityConfigEditorLastSaved.value = false
    try {
      await window.aiops?.writeSecurityConfig(securityConfigEditorContent.value)
      persistSecuritySettings()
      setSettingsNotice('安全配置已重置')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Reset failed: ${message}`
    }
  }

  const updatePrivacySettings = (patch: Partial<PrivacySettings>) => {
    const nextPersistent = normalizePrivacyConfig({ ...getPrivacySnapshot(), ...patch }).normalized
    privacySettings.value = {
      ...privacySettings.value,
      ...patch,
      ...nextPersistent
    }
    if ('telemetry' in patch || 'secretRedaction' in patch || 'dataSync' in patch) {
      saveConfig({ privacy: getPrivacySnapshot() })
    }
    setSettingsNotice('隐私设置已保存')
  }

  const updateBillingSettings = (patch: Partial<BillingSettings>) => {
    billingSettings.value = { ...billingSettings.value, ...patch }
    setSettingsNotice(patch.skippedLogin ? '已切换为登录提示状态' : '计费概览已刷新')
  }

  const setUserNotice = (message: string) => {
    userNotice.value = message
  }

  const userAccountCenterOpen = ref(false)
  const userContactCodeCountdown = ref<Record<'email' | 'mobile', number>>({
    email: 0,
    mobile: 0
  })
  const userContactCodeSending = ref<Record<'email' | 'mobile', boolean>>({
    email: false,
    mobile: false
  })
  const userContactCodeTimers: Partial<Record<'email' | 'mobile', number>> = {}
  const userLoginTab = ref<UserLoginTab>('account')
  const userLoginLoading = ref(false)
  const userLoginCodeCountdown = ref<Record<'email' | 'mobile', number>>({
    email: 0,
    mobile: 0
  })
  const userLoginCodeSending = ref<Record<'email' | 'mobile', boolean>>({
    email: false,
    mobile: false
  })
  const userLoginCodeTimers: Partial<Record<'email' | 'mobile', number>> = {}

  const isUserSubscriptionActive = computed(() => {
    const profile = userProfile.value
    if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
    return new Date(profile.subscriptionExpiresAt) > new Date()
  })

  const canEditUserMobile = computed(() => userProfile.value.authProvider !== 'oauth')
  const canEditUserEmail = computed(() => userProfile.value.authProvider === 'local')
  const canResetUserPassword = computed(() => userProfile.value.authProvider === 'local')

  const validateUserProfileDraft = (patch: Partial<Pick<MockUserProfile, 'name' | 'username'>>) => {
    const username = patch.username?.trim() ?? userProfile.value.username
    const name = patch.name?.trim() ?? userProfile.value.name
    if (!username || username.length < 6 || username.length > 20) {
      return '用户名长度需要在 6 到 20 个字符之间'
    }
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
      return '用户名仅支持字母、数字和下划线'
    }
    if (!name || name.length > 20) {
      return '姓名不能为空且不能超过 20 个字符'
    }
    return ''
  }

  const validateUserContactDraft = (kind: 'email' | 'mobile', value: string) => {
    const trimmed = value.trim()
    if (kind === 'email') {
      if (!canEditUserEmail.value) return '当前登录方式不允许修改邮箱'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return '邮箱格式不正确'
      return ''
    }
    if (!canEditUserMobile.value) return '当前登录方式不允许修改手机号'
    if (!/^1[3-9]\d{9}$/.test(trimmed)) return '手机号格式不正确'
    return ''
  }

  const openAccountCenter = () => {
    userAccountCenterOpen.value = true
    setUserNotice('账号中心已打开，本地展示订阅、可信设备和账号状态')
  }

  const closeAccountCenter = () => {
    userAccountCenterOpen.value = false
  }

  const openUserLogin = () => {
    activeModule.value = 'user'
    userProfile.value.skippedLogin = true
    billingSettings.value.skippedLogin = true
    userLoginTab.value = 'account'
    setUserNotice('已打开本地登录页')
  }

  const setUserLoginTab = (tab: UserLoginTab) => {
    userLoginTab.value = tab
  }

  const applyLocalLoginProfile = (patch: Partial<Pick<MockUserProfile, 'name' | 'username' | 'email' | 'mobile' | 'authProvider' | 'needDeviceVerification'>> = {}) => {
    userProfile.value.skippedLogin = false
    userProfile.value = {
      ...userProfile.value,
      ...patch,
      skippedLogin: false,
      needDeviceVerification: patch.needDeviceVerification ?? false
    }
    billingSettings.value.skippedLogin = false
    billingSettings.value.email = userProfile.value.email || billingSettings.value.email
    userLoginLoading.value = false
  }

  const loginUser = (patch: Partial<Pick<MockUserProfile, 'name' | 'username' | 'email' | 'mobile' | 'authProvider'>> = {}) => {
    applyLocalLoginProfile(patch)
    setUserNotice('已切换为本地登录状态')
  }

  const logoutUser = () => {
    userProfile.value.skippedLogin = true
    billingSettings.value.skippedLogin = true
    userAccountCenterOpen.value = false
    setUserNotice('已退出，本地 mock 登录态已清除')
  }

  const skipUserLogin = () => {
    applyLocalLoginProfile({
      name: 'Guest',
      username: 'guest',
      email: 'guest@example.local',
      mobile: '',
      authProvider: 'local'
    })
    billingSettings.value.skippedLogin = true
    setUserNotice('已跳过登录，使用本地访客状态')
    return true
  }

  const sendUserLoginCode = (kind: 'email' | 'mobile', value: string) => {
    const trimmed = value.trim()
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setUserNotice('邮箱格式不正确')
      return false
    }
    if (kind === 'mobile' && !/^1[3-9]\d{9}$/.test(trimmed)) {
      setUserNotice('手机号格式不正确')
      return false
    }
    if (userLoginCodeCountdown.value[kind] > 0 || userLoginCodeSending.value[kind]) return false
    userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: true }
    window.setTimeout(() => {
      userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: false }
      userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, [kind]: 300 }
      if (userLoginCodeTimers[kind]) window.clearInterval(userLoginCodeTimers[kind])
      userLoginCodeTimers[kind] = window.setInterval(() => {
        const next = Math.max(0, userLoginCodeCountdown.value[kind] - 1)
        userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, [kind]: next }
        if (next === 0 && userLoginCodeTimers[kind]) {
          window.clearInterval(userLoginCodeTimers[kind])
          delete userLoginCodeTimers[kind]
        }
      }, 1000)
      setUserNotice(`${kind === 'email' ? '邮箱' : '手机'}登录验证码已发送`)
    }, 120)
    return true
  }

  const loginWithAccount = (username: string, password: string) => {
    const nextUsername = username.trim()
    if (!nextUsername || !password) {
      setUserNotice('请输入用户名和密码')
      return false
    }
    userLoginLoading.value = true
    if (nextUsername.toLowerCase().includes('verify')) {
      userLoginLoading.value = false
      userProfile.value.needDeviceVerification = true
      setUserNotice('当前设备需要验证后才能登录')
      return false
    }
    applyLocalLoginProfile({
      username: nextUsername,
      name: userProfile.value.name || nextUsername,
      authProvider: 'local'
    })
    setUserNotice('账号登录成功，本地数据库初始化完成')
    return true
  }

  const loginWithEmail = (email: string, code: string) => {
    const nextEmail = email.trim()
    if (!nextEmail || !code.trim()) {
      setUserNotice('请输入邮箱和验证码')
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setUserNotice('邮箱格式不正确')
      return false
    }
    userLoginLoading.value = true
    applyLocalLoginProfile({
      email: nextEmail,
      username: nextEmail.split('@')[0] || userProfile.value.username,
      authProvider: 'local'
    })
    userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, email: 0 }
    if (userLoginCodeTimers.email) {
      window.clearInterval(userLoginCodeTimers.email)
      delete userLoginCodeTimers.email
    }
    setUserNotice('邮箱登录成功，本地数据库初始化完成')
    return true
  }

  const loginWithMobile = (mobile: string, code: string) => {
    const nextMobile = mobile.trim()
    if (!nextMobile || !code.trim()) {
      setUserNotice('请输入手机号和验证码')
      return false
    }
    if (!/^1[3-9]\d{9}$/.test(nextMobile)) {
      setUserNotice('手机号格式不正确')
      return false
    }
    userLoginLoading.value = true
    applyLocalLoginProfile({
      mobile: nextMobile,
      authProvider: 'local'
    })
    userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, mobile: 0 }
    if (userLoginCodeTimers.mobile) {
      window.clearInterval(userLoginCodeTimers.mobile)
      delete userLoginCodeTimers.mobile
    }
    setUserNotice('手机号登录成功，本地数据库初始化完成')
    return true
  }

  const updateUserProfile = (patch: Partial<Pick<MockUserProfile, 'name' | 'username' | 'email' | 'mobile' | 'avatarInitials' | 'avatarImageUrl'>>) => {
    const validation = validateUserProfileDraft(patch)
    if (validation) {
      setUserNotice(validation)
      return false
    }
    const nextAvatarInitials = patch.avatarInitials?.trim().toUpperCase().slice(0, 3)
    userProfile.value = {
      ...userProfile.value,
      ...patch,
      name: patch.name?.trim() ?? userProfile.value.name,
      username: patch.username?.trim() ?? userProfile.value.username,
      avatarInitials: nextAvatarInitials || userProfile.value.avatarInitials
    }
    setUserNotice('个人信息已保存')
    return true
  }

  const resetUserPassword = (password = '') => {
    if (!canResetUserPassword.value) {
      setUserNotice('当前登录方式不允许修改密码')
      return false
    }
    if (password && password.length < 6) {
      setUserNotice('密码长度至少 6 位')
      return false
    }
    setUserNotice('密码重置为本地占位，未调用远端接口')
    return true
  }

  const sendUserContactCode = (kind: 'email' | 'mobile', value: string) => {
    const validation = validateUserContactDraft(kind, value)
    if (validation) {
      setUserNotice(validation)
      return false
    }
    if (userContactCodeCountdown.value[kind] > 0 || userContactCodeSending.value[kind]) return false
    userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: true }
    window.setTimeout(() => {
      userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: false }
      userContactCodeCountdown.value = { ...userContactCodeCountdown.value, [kind]: 300 }
      if (userContactCodeTimers[kind]) window.clearInterval(userContactCodeTimers[kind])
      userContactCodeTimers[kind] = window.setInterval(() => {
        const next = Math.max(0, userContactCodeCountdown.value[kind] - 1)
        userContactCodeCountdown.value = { ...userContactCodeCountdown.value, [kind]: next }
        if (next === 0 && userContactCodeTimers[kind]) {
          window.clearInterval(userContactCodeTimers[kind])
          delete userContactCodeTimers[kind]
        }
      }, 1000)
      setUserNotice(`${kind === 'email' ? '邮箱' : '手机'}验证码已发送`)
    }, 120)
    return true
  }

  const bindUserContact = (kind: 'email' | 'mobile', value: string, code = '') => {
    const validation = validateUserContactDraft(kind, value)
    if (validation) {
      setUserNotice(validation)
      return false
    }
    if (!code.trim()) {
      setUserNotice(`请输入${kind === 'email' ? '邮箱' : '手机'}验证码`)
      return false
    }
    userProfile.value = { ...userProfile.value, [kind]: value.trim() }
    userContactCodeCountdown.value = { ...userContactCodeCountdown.value, [kind]: 0 }
    if (userContactCodeTimers[kind]) {
      window.clearInterval(userContactCodeTimers[kind])
      delete userContactCodeTimers[kind]
    }
    setUserNotice(`${kind === 'email' ? '邮箱' : '手机号'}已绑定`)
    return true
  }

  const checkAboutUpdate = () => {
    aboutSettings.value.updateStatus = 'checking'
    setSettingsNotice('正在检查更新')
    window.setTimeout(() => {
      aboutSettings.value.updateStatus = 'latest'
      aboutSettings.value.newVersion = aboutSettings.value.version
      setSettingsNotice('当前已是最新版本')
    }, 300)
  }

  const setTopNotice = (message: string) => {
    topNotice.value = message
    if (!message) return
    window.setTimeout(() => {
      if (topNotice.value === message) topNotice.value = ''
    }, 2400)
  }

  const checkTopUpdate = async () => {
    topUpdateState.value = 'checking'
    try {
      const result = await window.aiops?.checkUpdate()
      topUpdateState.value = result?.available ? 'available' : 'local'
      if (result?.available) {
        setTopNotice('检测到可用更新')
      }
    } catch {
      topUpdateState.value = 'local'
      setTopNotice('更新检查不可用')
    }
  }

  const handleTopUpdateClick = () => {
    if (topUpdateState.value === 'available') {
      setTopNotice('更新安装为本地占位，未连接远端更新服务')
      return
    }
    checkTopUpdate()
  }

  const openSettingsExternalAction = (label: string) => {
    setSettingsNotice(`已打开 ${label}`)
  }

  const openMcpConfigEditor = async () => {
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    const requestId = ++mcpConfigLoadRequest
    mcpConfigEditorOpen.value = true
    mcpConfigEditorContent.value = JSON.stringify(defaultMcpConfigFile(), null, 2)
    mcpConfigEditorError.value = ''
    mcpConfigEditorLastSaved.value = false
    installMcpConfigFileListener()
    if (!window.aiops) return
    try {
      const [path, content] = await Promise.all([window.aiops.getMcpConfigPath(), window.aiops.readMcpConfig()])
      if (requestId !== mcpConfigLoadRequest) return
      mcpConfigPath.value = path
      applyMcpConfigFileContent(content, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Failed to read MCP config: ${message}`
    }
  }

  const closeMcpConfigEditor = () => {
    mcpConfigLoadRequest += 1
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    if (removeMcpConfigFileListener) {
      removeMcpConfigFileListener()
      removeMcpConfigFileListener = null
    }
    mcpConfigEditorOpen.value = false
  }

  const updateMcpConfigEditorContent = (content: string) => {
    mcpConfigEditorContent.value = content
    mcpConfigEditorLastSaved.value = false
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    try {
      parseMcpEditorContent(content)
      mcpConfigEditorError.value = ''
      mcpConfigSaveTimer = window.setTimeout(() => {
        void saveMcpConfigEditor()
        mcpConfigSaveTimer = null
      }, 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveMcpConfigEditor = async (format = false) => {
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    let normalized: McpConfigFile
    try {
      normalized = normalizeMcpConfigFile(parseMcpEditorContent(mcpConfigEditorContent.value))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const content = format ? JSON.stringify(normalized, null, 2) : mcpConfigEditorContent.value
    try {
      await window.aiops?.writeMcpConfig(content)
      mcpConfigEditorContent.value = JSON.stringify(normalized, null, 2)
      mcpServers.value = mcpConfigFileToServers(normalized, mcpServers.value)
      persistMcpServers()
      mcpConfigEditorError.value = ''
      mcpConfigEditorLastSaved.value = true
      setSettingsNotice('MCP 配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Save failed: ${message}`
      mcpConfigEditorLastSaved.value = false
      return false
    }
  }

  const toggleMcpServerExpanded = (name: string) => {
    expandedMcpServerNames.value = expandedMcpServerNames.value.includes(name)
      ? expandedMcpServerNames.value.filter((item) => item !== name)
      : [...expandedMcpServerNames.value, name]
  }

  const setMcpServerTab = (name: string, tab: 'tools' | 'resources') => {
    activeMcpServerTab.value = { ...activeMcpServerTab.value, [name]: tab }
  }

  const toggleMcpServerDisabled = async (name: string) => {
    const server = mcpServers.value.find((item) => item.name === name)
    if (!server) return
    server.disabled = !server.disabled
    server.status = server.disabled ? 'disabled' : server.error ? 'error' : 'connected'
    try {
      await window.aiops?.toggleMcpServer(name, server.disabled)
    } catch (error) {
      server.disabled = !server.disabled
      server.status = server.disabled ? 'disabled' : server.error ? 'error' : 'connected'
      setSettingsNotice(`MCP ${name} 状态更新失败`)
      return
    }
    persistMcpServers()
    setSettingsNotice(`${server.name} ${server.disabled ? '已禁用' : '已启用'}`)
  }

  const deleteMcpServer = async (name: string) => {
    const previous = mcpServers.value.map((server) => ({ ...server, tools: server.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter })) })), resources: server.resources.map((resource) => ({ ...resource })) }))
    mcpServers.value = mcpServers.value.filter((item) => item.name !== name)
    expandedMcpServerNames.value = expandedMcpServerNames.value.filter((item) => item !== name)
    try {
      await window.aiops?.deleteMcpServer(name)
    } catch {
      mcpServers.value = previous
      setSettingsNotice(`${name} 删除失败`)
      return
    }
    persistMcpServers()
    setSettingsNotice(`${name} 已删除`)
  }

  const toggleMcpTool = (serverName: string, toolName: string) => {
    const tool = mcpServers.value.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
    if (!tool) return
    tool.enabled = !tool.enabled
    persistMcpServers()
    setSettingsNotice(`${toolName} ${tool.enabled ? '已启用' : '已禁用'}`)
  }

  const openSkillModal = async (mode: 'create' | 'edit', skillName?: string) => {
    if (mode === 'edit') {
      const skill = settingsSkills.value.find((item) => item.name === skillName)
      if (!skill) return
      if (!skill.editable) {
        setSettingsNotice('只能编辑用户创建的 Skill')
        return
      }
      try {
        const result = window.aiops?.readSkillContent ? await window.aiops.readSkillContent(skill.name) : { metadata: { description: skill.description }, content: skill.content }
        skillModal.value = {
          mode,
          name: skill.name,
          description: typeof result.metadata.description === 'string' ? result.metadata.description : skill.description,
          content: result.content || skill.content
        }
      } catch {
        setSettingsNotice(`${skill.name} 读取失败`)
      }
      return
    }
    skillModal.value = { mode, name: '', description: '', content: '' }
  }

  const closeSkillModal = () => {
    skillModal.value = { mode: null, name: '', description: '', content: '' }
  }

  const saveSkillModal = async () => {
    const name = skillModal.value.name.trim()
    const description = skillModal.value.description.trim()
    const content = skillModal.value.content.trim()
    if (!name || !description || !content) {
      setSettingsNotice('Skill 名称、描述和内容不能为空')
      return false
    }
    if (skillModal.value.mode === 'edit') {
      const skill = settingsSkills.value.find((item) => item.name === name)
      if (!skill) return false
      if (!skill.editable) {
        setSettingsNotice('只能编辑用户创建的 Skill')
        return false
      }
      try {
        if (window.aiops?.updateSkill) {
          await window.aiops.updateSkill(name, { name, description }, content)
          await loadSkillsFromBridge()
        } else {
          skill.description = description
          skill.content = content
          persistSkills()
        }
        setSettingsNotice(`${name} 已保存`)
        closeSkillModal()
        return true
      } catch {
        setSettingsNotice(`${name} 保存失败`)
        return false
      }
    }
    if (!/^[a-z-]+$/.test(name)) {
      setSettingsNotice('Skill 名称只能包含小写字母和连字符')
      return false
    }
    if (settingsSkills.value.some((item) => item.name === name)) {
      setSettingsNotice('Skill 已存在')
      return false
    }
    try {
      if (window.aiops?.createSkill) {
        await window.aiops.createSkill({ name, description }, content)
        await loadSkillsFromBridge()
      } else {
        settingsSkills.value.unshift({ name, description, content, enabled: true, editable: true })
        persistSkills()
      }
      setSettingsNotice(`${name} 已创建`)
      closeSkillModal()
      return true
    } catch {
      setSettingsNotice(`${name} 创建失败`)
      return false
    }
  }

  const toggleSkillEnabled = async (name: string) => {
    const skill = settingsSkills.value.find((item) => item.name === name)
    if (!skill) return
    const previous = skill.enabled
    skill.enabled = !skill.enabled
    try {
      if (window.aiops?.setSkillEnabled) {
        await window.aiops.setSkillEnabled(name, skill.enabled)
      } else {
        persistSkills()
      }
      setSettingsNotice(`${name} ${skill.enabled ? '已启用' : '已禁用'}`)
    } catch {
      skill.enabled = previous
      setSettingsNotice(`${name} 状态更新失败`)
    }
  }

  const deleteSkill = async (name: string) => {
    const skill = settingsSkills.value.find((item) => item.name === name)
    if (!skill) return
    if (!skill.editable) {
      setSettingsNotice('只能删除用户创建的 Skill')
      return
    }
    const previous = settingsSkills.value.map((item) => ({ ...item }))
    settingsSkills.value = settingsSkills.value.filter((item) => item.name !== name)
    try {
      if (window.aiops?.deleteSkill) {
        await window.aiops.deleteSkill(name)
        await loadSkillsFromBridge()
      } else {
        persistSkills()
      }
      setSettingsNotice(`${name} 已删除`)
    } catch {
      settingsSkills.value = previous
      setSettingsNotice(`${name} 删除失败`)
    }
  }

  const showSkillImportError = (errorCode?: string) => {
    const errorMap: Record<string, string> = {
      INVALID_ZIP: 'Skill ZIP 无效',
      NO_SKILL_MD: 'ZIP 中未找到 SKILL.md',
      INVALID_METADATA: 'SKILL.md 元数据无效',
      EXTRACT_FAILED: 'Skill ZIP 解压失败'
    }
    setSettingsNotice(errorMap[errorCode || ''] || 'Skill ZIP 导入失败')
  }

  const importSkillZip = async () => {
    try {
      if (pendingSkillImportOverwritePath) {
        const overwritePath = pendingSkillImportOverwritePath
        pendingSkillImportOverwritePath = ''
        const overwriteResult = await window.aiops?.importSkillZip?.(overwritePath, true)
        if (overwriteResult?.success) {
          await loadSkillsFromBridge()
          setSettingsNotice(`${overwriteResult.skillName || 'Skill'} 已覆盖导入`)
          return
        }
        showSkillImportError(overwriteResult?.errorCode)
        return
      }
      const result = await window.aiops?.showOpenDialog?.({
        properties: ['openFile'],
        filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return
      const importResult = await window.aiops?.importSkillZip?.(result.filePaths[0])
      if (importResult?.success) {
        await loadSkillsFromBridge()
        setSettingsNotice(`${importResult.skillName || 'Skill'} 已导入`)
        return
      }
      if (importResult?.errorCode === 'DIR_EXISTS') {
        pendingSkillImportOverwritePath = result.filePaths[0]
        setSettingsNotice('Skill 已存在，再次点击 Import 覆盖')
        return
      }
      showSkillImportError(importResult?.errorCode)
    } catch {
      pendingSkillImportOverwritePath = ''
      setSettingsNotice('Skill ZIP 导入失败')
    }
  }

  const exportSkillZip = async (name: string) => {
    try {
      const result = await window.aiops?.exportSkillZip?.(name)
      if (result?.success) {
        setSettingsNotice(`${name} 已导出为 ZIP`)
      } else if (result?.error !== 'cancelled') {
        setSettingsNotice(`${name} ZIP 导出失败`)
      }
    } catch {
      setSettingsNotice(`${name} ZIP 导出失败`)
    }
  }

  const addSettingsRule = () => {
    if (settingsRules.value.some((rule) => rule.isEditing)) return
    settingsRules.value.unshift({ id: createId('rule'), content: '', enabled: true, isEditing: true })
  }

  const editSettingsRule = (id: string) => {
    settingsRules.value.forEach((rule) => {
      rule.isEditing = rule.id === id
    })
  }

  const updateSettingsRuleDraft = (id: string, content: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (rule) rule.content = content
  }

  const saveSettingsRule = (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    if (!rule.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      persistRules()
      return false
    }
    rule.content = rule.content.trim()
    rule.isEditing = false
    persistRules()
    setSettingsNotice('规则已保存')
    return true
  }

  const cancelSettingsRuleEdit = (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return
    if (!rule.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return
    }
    const savedRule = config.value.rules?.find((item) => item.id === id)
    if (savedRule) {
      rule.content = savedRule.content
      rule.enabled = savedRule.enabled
    }
    rule.isEditing = false
  }

  const toggleSettingsRule = (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return
    rule.enabled = !rule.enabled
    persistRules()
    setSettingsNotice(`规则${rule.enabled ? '已启用' : '已禁用'}`)
  }

  const deleteSettingsRule = (id: string) => {
    settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
    persistRules()
    setSettingsNotice('规则已删除')
  }

  const startShortcutRecording = (actionId: string) => {
    shortcutRecording.value = { actionId, tempShortcut: '' }
  }

  const updateShortcutRecording = (shortcut: string) => {
    shortcutRecording.value.tempShortcut = shortcut
  }

  const saveShortcutRecording = () => {
    const { actionId, tempShortcut } = shortcutRecording.value
    const nextShortcut = tempShortcut.trim()
    if (!actionId || !nextShortcut) return false
    const shortcut = settingsShortcuts.value.find((item) => item.id === actionId)
    if (!shortcut) return false
    if (!isValidShortcutForAction(actionId, nextShortcut)) {
      setSettingsNotice('快捷键格式无效')
      return false
    }
    const conflicted = settingsShortcuts.value.some((item) => item.id !== actionId && item.shortcut === nextShortcut)
    if (conflicted) {
      setSettingsNotice('快捷键已被占用')
      return false
    }
    shortcut.shortcut = nextShortcut
    saveConfig({ shortcuts: getShortcutsSnapshot() })
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
    setSettingsNotice('快捷键已保存')
    return true
  }

  const cancelShortcutRecording = () => {
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
  }

  const resetAllShortcuts = () => {
    settingsShortcuts.value = defaultShortcuts.map((shortcut) => ({ ...shortcut }))
    saveConfig({ shortcuts: getShortcutsSnapshot() })
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
    setSettingsNotice('快捷键已全部重置')
  }

  const openTrustedDeviceRevoke = (id: number) => {
    const device = trustedDevices.value.find((item) => item.id === id)
    if (!device || device.current) return
    trustedDeviceModal.value = { open: true, id }
  }

  const confirmTrustedDeviceRevoke = () => {
    const id = trustedDeviceModal.value.id
    if (id === null) return
    trustedDevices.value = trustedDevices.value.filter((item) => item.id !== id)
    trustedDeviceModal.value = { open: false, id: null }
    setSettingsNotice('可信设备已移除')
  }

  const toggleMode = () => {
    const nextMode = mode.value === 'terminal' ? 'agents' : 'terminal'
    mode.value = nextMode
    if (nextMode === 'terminal' && activeModule.value !== 'database' && activeModule.value !== 'user') {
      rightPanelOpen.value = config.value.rightPanelOpen
    }
    saveConfig({ defaultMode: mode.value })
    setTopNotice(`已切换到 ${mode.value === 'agents' ? 'Agents' : 'Terminal'} 模式`)
  }

  const setActiveModule = (key: ModuleKey) => {
    activeModule.value = key
    if (key !== 'settings') onboardingGuideOpen.value = false
    if (key === 'database') {
      rightPanelOpen.value = false
    }
  }

  const setFilesUiMode = (mode: FilesUiMode) => {
    filesUiMode.value = mode
  }

  const scheduleFileTransferTaskRemoval = (id: string, delay = 800) => {
    window.setTimeout(() => {
      fileTransferTasks.value = fileTransferTasks.value.filter((item) => item.id !== id)
    }, delay)
  }

  const selectFileSession = (side: 'left' | 'right', id: string | null) => {
    if (side === 'left') {
      selectedLeftFileSessionId.value = id
      return
    }
    selectedRightFileSessionId.value = id
  }

  const openFileSession = (sessionId: string, side: 'left' | 'right' = selectedLeftFileSessionId.value ? 'right' : 'left') => {
    const session = fileSessions.value.find((item) => item.id === sessionId)
    if (!session) return
    selectFileSession(side, session.id)
  }

  const closeFileSession = (side: 'left' | 'right') => {
    selectFileSession(side, null)
  }

  const addRemoteFileSession = (assetId: string, side: 'left' | 'right' = 'left') => {
    const known = fileSessions.value.find((item) => item.id === assetId)
    if (known) {
      openFileSession(assetId, side)
      return known
    }
    const session: FileSessionInfo = {
      id: assetId,
      label: assetId,
      host: assetId,
      group: '资产',
      kind: 'remote',
      rootPath: '/home/deploy',
      status: 'active'
    }
    fileSessions.value.push(session)
    openFileSession(assetId, side)
    return session
  }

  const addRemoteFileSessionFromSftpPayload = (payload: Record<string, unknown>, side: 'left' | 'right' = 'left') => {
    const assetId = String(payload.uuid || payload.id || payload.host || payload.ip || createId('file-asset'))
    const known = fileSessions.value.find((item) => item.id === assetId)
    if (known) {
      openFileSession(assetId, side)
      return known
    }
    const host = String(payload.host || payload.ip || assetId)
    const username = String(payload.username || 'deploy')
    const session: FileSessionInfo = {
      id: assetId,
      label: String(payload.title || payload.hostname || host),
      host,
      group: '资产',
      kind: 'remote',
      rootPath: username ? `/home/${username}` : '/home/deploy',
      status: 'active',
      favorite: false,
      assetType: String(payload.asset_type || '').includes('organization') ? 'organization' : 'person',
      comment: payload.comment ? String(payload.comment) : undefined
    }
    fileSessions.value.push(session)
    openFileSession(assetId, side)
    return session
  }

  const pushFileTransferTask = (patch: Partial<FileTransferTask> & Pick<FileTransferTask, 'type' | 'name' | 'source' | 'target'>) => {
    const task: FileTransferTask = {
      ...patch,
      id: patch.id || createId('transfer'),
      progress: patch.progress ?? 0,
      speed: patch.speed ?? 'pending',
      status: patch.status ?? 'running'
    }
    fileTransferTasks.value.unshift(task)
    if (task.status === 'running') {
      const timer = window.setInterval(() => {
        const current = fileTransferTasks.value.find((item) => item.id === task.id)
        if (!current) {
          window.clearInterval(timer)
          return
        }
        current.progress = Math.min(100, current.progress + 12)
        current.speed = current.progress >= 100 ? '完成' : '620 KB/s'
        if (current.progress >= 100) {
          current.status = 'success'
          window.clearInterval(timer)
          scheduleFileTransferTaskRemoval(current.id, current.isGroup ? 8000 : 2500)
        }
      }, 900)
    } else if (task.status === 'success' || task.status === 'failed' || task.status === 'error') {
      scheduleFileTransferTaskRemoval(task.id, task.status === 'success' ? 2500 : 8000)
    }
    return task
  }

  const cancelFileTransferTask = (id: string) => {
    const taskIds = new Set([id])
    fileTransferTasks.value.forEach((item) => {
      if (item.children?.some((child) => child.id === id)) {
        taskIds.add(item.id)
        item.children?.forEach((child) => taskIds.add(child.id))
      }
      if (item.id === id && item.children?.length) {
        item.children.forEach((child) => taskIds.add(child.id))
      }
    })
    const affected = fileTransferTasks.value.filter((item) => taskIds.has(item.id))
    affected.forEach((task) => {
      task.status = 'failed'
      task.speed = '已取消'
      task.progress = Math.min(task.progress, 99)
      task.children?.forEach((child) => {
        child.status = 'failed'
        child.speed = '已取消'
        child.progress = Math.min(child.progress, 99)
      })
      scheduleFileTransferTaskRemoval(task.id, 800)
    })
  }

  const createSnippetGroup = (groupName: string) => {
    const name = groupName.trim()
    if (!name) return
    const nextId = Math.max(0, ...snippetGroups.value.map((group) => group.id)) + 1
    const group = { id: nextId, uuid: createId('snippet-group'), group_name: name }
    snippetGroups.value.push(group)
    persistQuickCommands()
    return group
  }

  const renameSnippetGroup = (uuid: string, groupName: string) => {
    const group = snippetGroups.value.find((item) => item.uuid === uuid)
    if (group && groupName.trim()) {
      group.group_name = groupName.trim()
      persistQuickCommands()
    }
  }

  const deleteSnippetGroup = (uuid: string) => {
    quickCommands.value = quickCommands.value.filter((command) => command.group_uuid !== uuid)
    snippetGroups.value = snippetGroups.value.filter((group) => group.uuid !== uuid)
    if (selectedSnippetGroupUuid.value === uuid) selectedSnippetGroupUuid.value = null
    persistQuickCommands()
  }

  const createQuickCommand = (payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return
    const nextId = Math.max(0, ...quickCommands.value.map((command) => command.id)) + 1
    const nowText = '刚刚'
    const command = {
      id: nextId,
      uuid: createId('snippet'),
      snippet_name: snippetName,
      snippet_content: payload.snippet_content,
      group_uuid: payload.group_uuid ?? null,
      create_at: nowText,
      update_at: nowText
    }
    quickCommands.value.push(command)
    persistQuickCommands()
    return command
  }

  const updateQuickCommand = (id: number, payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const command = quickCommands.value.find((item) => item.id === id)
    if (!command) return
    command.snippet_name = payload.snippet_name.trim()
    command.snippet_content = payload.snippet_content
    command.group_uuid = payload.group_uuid ?? null
    command.update_at = '刚刚'
    persistQuickCommands()
  }

  const deleteQuickCommand = (id: number) => {
    quickCommands.value = quickCommands.value.filter((command) => command.id !== id)
    persistQuickCommands()
  }

  const reorderQuickCommand = (sourceId: number, targetId: number) => {
    const currentList = [...filteredQuickCommands.value]
    const sourceIndex = currentList.findIndex((command) => command.id === sourceId)
    const targetIndex = currentList.findIndex((command) => command.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
    const [moved] = currentList.splice(sourceIndex, 1)
    currentList.splice(targetIndex, 0, moved)
    const otherCommands = quickCommands.value.filter((command) => !currentList.some((item) => item.id === command.id))
    quickCommands.value = [...otherCommands, ...currentList]
    persistQuickCommands()
  }

  const serializeSnippetScript = (scriptContent: string, autoExecute: boolean) => {
    const parsed = parseSnippetScript(scriptContent)
    const commandItems = parsed.filter((item): item is Extract<ParsedSnippetCommand, { type: 'COMMAND' }> => item.type === 'COMMAND')
    const lastCommandPayload = commandItems.at(-1)?.payload
    let seenCommandCount = 0
    return parsed
      .filter((item) => item.type !== 'SLEEP')
      .map((item) => {
        if (item.type === 'COMMAND') {
          seenCommandCount += 1
          const isLastCommand = item.payload === lastCommandPayload && seenCommandCount === commandItems.length
          const suffix = isLastCommand && !autoExecute ? '' : '\n'
          return `${item.payload}${suffix}`
        }
        if (item.type === 'KEY') return keyMap[item.payload]
        if (item.type === 'CTRL') return ctrlKeyMap[item.payload] || ''
        return ''
      })
      .join('')
  }

  const runQuickCommand = (id: number, autoExecute = true, allTabs = false) => {
    const command = quickCommands.value.find((item) => item.id === id)
    if (!command) return
    const payload = serializeSnippetScript(command.snippet_content, autoExecute)
    const securityCommand = parseSnippetScript(command.snippet_content).find((item) => item.type === 'COMMAND')?.payload || command.snippet_name
    const terminalPanels = panels.value.filter((panel) => panel.kind !== 'knowledge')
    const targetPanelIds = allTabs ? terminalPanels.map((panel) => panel.id) : [activePanel.value.kind === 'knowledge' ? terminalPanels[0]?.id || activePanel.value.id : activePanel.value.id]
    const decision = prepareTerminalSecurityExecution({
      command: securityCommand,
      panelIds: targetPanelIds,
      inputText: `\n${payload}`,
      outputText: `[snippet] ${command.snippet_name}\n$ `,
      shellText: payload,
      writeToShell: false,
      source: 'snippet'
    })
    return decision
  }

  const clearMacroAutoStopTimer = () => {
    if (macroAutoStopTimer !== null) {
      clearTimeout(macroAutoStopTimer)
      macroAutoStopTimer = null
    }
  }

  const buildMacroSnippetContent = () => {
    if (!macroCommandBuffer.value.length) return ''
    const lines: string[] = []
    macroCommandBuffer.value.forEach((entry, index) => {
      const previous = macroCommandBuffer.value[index - 1]
      if (previous) {
        const delay = entry.timestamp - previous.timestamp
        if (delay >= macroSleepThresholdMs.value) {
          lines.push(`sleep==${delay}`)
        }
      }
      lines.push(entry.command)
    })
    return lines.join('\n')
  }

  const commitMacroCurrentLine = (timestamp = Date.now()) => {
    if (!macroCurrentLineBuffer.value.length) return true
    const added = addMacroCommandEntry(macroCurrentLineBuffer.value, timestamp)
    macroCurrentLineBuffer.value = ''
    return added
  }

  function addMacroCommandEntry(command: string, timestamp = Date.now()) {
    if (!isMacroRecording.value) return false
    if (macroCommandBuffer.value.length >= MACRO_MAX_COMMAND_COUNT) {
      autoStopMacroRecording('count')
      return false
    }
    macroCommandBuffer.value.push({ command, timestamp })
    if (macroCommandBuffer.value.length >= MACRO_MAX_COMMAND_COUNT) {
      autoStopMacroRecording('count')
    }
    return true
  }

  const saveMacroSnippet = (content: string) => {
    if (!content.trim()) return null
    return createQuickCommand({
      snippet_name: macroDefaultName.value || createMacroSnippetName(),
      snippet_content: content,
      group_uuid: macroTargetGroupUuid.value
    })
  }

  const resetMacroRecordingState = () => {
    clearMacroAutoStopTimer()
    isMacroRecording.value = false
    macroTerminalId.value = null
    macroCommandBuffer.value = []
    macroCurrentLineBuffer.value = ''
    macroRecordingStartTime.value = null
    macroDefaultName.value = ''
    macroTargetGroupUuid.value = null
  }

  function autoStopMacroRecording(reason: 'time' | 'count') {
    if (!isMacroRecording.value) return null
    macroLimitReason.value = reason
    commitMacroCurrentLine()
    const content = buildMacroSnippetContent()
    const saved = saveMacroSnippet(content)
    resetMacroRecordingState()
    return saved
  }

  const startMacroRecording = (terminalId?: string | null) => {
    if (isMacroRecording.value) return
    isMacroRecording.value = true
    macroTerminalId.value = terminalId || (activePanel.value.kind === 'knowledge' ? panels.value.find((panel) => panel.kind !== 'knowledge')?.id || null : activePanel.value.id)
    macroCommandBuffer.value = []
    macroCurrentLineBuffer.value = ''
    macroRecordingStartTime.value = Date.now()
    macroDefaultName.value = createMacroSnippetName()
    macroTargetGroupUuid.value = selectedSnippetGroupUuid.value
    macroLimitReason.value = null
    clearMacroAutoStopTimer()
    macroAutoStopTimer = setTimeout(() => {
      autoStopMacroRecording('time')
    }, MACRO_MAX_RECORDING_DURATION_MS)
  }

  const recordMacroCommand = (command: string, timestamp = Date.now()) => {
    const text = command.trim()
    if (!text) return
    addMacroCommandEntry(text, timestamp)
  }

  const setMacroRecordControlKeys = (enabled: boolean) => {
    macroRecordControlKeys.value = enabled
  }

  const setMacroSleepThreshold = (milliseconds: number) => {
    macroSleepThresholdMs.value = Math.max(0, Math.round(milliseconds))
  }

  const recordMacroTerminalInput = (panelId: string, data: string, timestamp = Date.now()) => {
    if (!isMacroRecording.value || !data) return
    if (macroTerminalId.value && panelId !== macroTerminalId.value) return
    if (macroRecordingStartTime.value && timestamp - macroRecordingStartTime.value >= MACRO_MAX_RECORDING_DURATION_MS) {
      autoStopMacroRecording('time')
      return
    }

    let cursor = 0
    while (cursor < data.length) {
      if (!isMacroRecording.value) return
      const remaining = data.slice(cursor)
      const keyMatch = keySequences.find(([, sequence]) => remaining.startsWith(sequence))
      if (keyMatch) {
        const [key, sequence] = keyMatch
        if (key === 'return') {
          commitMacroCurrentLine(timestamp)
        } else if (key === 'backspace') {
          macroCurrentLineBuffer.value = macroCurrentLineBuffer.value.slice(0, -1)
        } else if (macroRecordControlKeys.value) {
          commitMacroCurrentLine(timestamp)
          addMacroCommandEntry(key, timestamp)
        }
        cursor += sequence.length
        continue
      }

      const ctrlMatch = ctrlSequences.find(([, sequence]) => remaining.startsWith(sequence))
      if (ctrlMatch) {
        const [ctrl, sequence] = ctrlMatch
        if (macroRecordControlKeys.value) {
          commitMacroCurrentLine(timestamp)
          addMacroCommandEntry(ctrl, timestamp)
        }
        if (ctrl === 'ctrl+c') {
          macroCurrentLineBuffer.value = ''
        }
        cursor += sequence.length
        continue
      }

      const char = data[cursor]
      if (char === '\n' || char === '\r') {
        commitMacroCurrentLine(timestamp)
      } else if (char === '\b' || char === '\x7f') {
        macroCurrentLineBuffer.value = macroCurrentLineBuffer.value.slice(0, -1)
      } else if (char === '\t') {
        if (macroRecordControlKeys.value) {
          commitMacroCurrentLine(timestamp)
          addMacroCommandEntry('tab', timestamp)
        }
      } else if (char.charCodeAt(0) >= 32) {
        macroCurrentLineBuffer.value += char
      }
      cursor += 1
    }
  }

  const stopMacroRecording = () => {
    if (!isMacroRecording.value) return
    commitMacroCurrentLine()
    const content = buildMacroSnippetContent()
    const saved = saveMacroSnippet(content)
    resetMacroRecordingState()
    return saved
  }

  const cancelMacroRecording = () => {
    if (!isMacroRecording.value) return
    resetMacroRecordingState()
  }

  const findKnowledgeNode = (relPath: string, nodes = knowledgeTree.value): KnowledgeNode | null => {
    for (const node of nodes) {
      if (node.relPath === relPath) return node
      if (node.children) {
        const hit = findKnowledgeNode(relPath, node.children)
        if (hit) return hit
      }
    }
    return null
  }

  const removeKnowledgeNode = (relPath: string, nodes = knowledgeTree.value): KnowledgeNode | null => {
    const index = nodes.findIndex((node) => node.relPath === relPath)
    if (index >= 0) {
      const [removed] = nodes.splice(index, 1)
      return removed
    }
    for (const node of nodes) {
      if (node.children) {
        const removed = removeKnowledgeNode(relPath, node.children)
        if (removed) return removed
      }
    }
    return null
  }

  const insertKnowledgeNode = (parentRelDir: string, node: KnowledgeNode) => {
    if (!parentRelDir) {
      knowledgeTree.value.unshift(node)
      return
    }
    const parent = findKnowledgeNode(parentRelDir)
    if (!parent || parent.type !== 'dir') return
    parent.children = parent.children || []
    parent.children.unshift(node)
    if (!kbExpandedKeys.value.includes(parentRelDir)) kbExpandedKeys.value.push(parentRelDir)
  }

  const selectKnowledgeNode = (relPath: string, multi = false) => {
    if (!multi) {
      kbSelectedKeys.value = [relPath]
      return
    }
    kbSelectedKeys.value = kbSelectedKeys.value.includes(relPath)
      ? kbSelectedKeys.value.filter((item) => item !== relPath)
      : [...kbSelectedKeys.value, relPath]
  }

  const createKnowledgeNode = async (kind: KnowledgeNodeType, parentRelDir: string, title: string) => {
    const name = title.trim()
    if (!name) return null
    if (window.aiops?.kbCreateFile && window.aiops?.kbMkdir) {
      const result =
        kind === 'dir'
          ? await window.aiops.kbMkdir(parentRelDir, name)
          : await window.aiops.kbCreateFile(parentRelDir, name, '')
      await refreshKnowledgeTree()
      const created = findKnowledgeNode(result.relPath)
      kbSelectedKeys.value = [result.relPath]
      if (kind === 'dir' && !kbExpandedKeys.value.includes(result.relPath)) {
        kbExpandedKeys.value.push(result.relPath)
      }
      return created
    }
    const relPath = createKbRelPath(parentRelDir, name)
    const node: KnowledgeNode = {
      id: createId('kb'),
      key: relPath,
      relPath,
      title: name,
      type: kind,
      size: kind === 'file' ? 1024 : undefined,
      children: kind === 'dir' ? [] : undefined
    }
    insertKnowledgeNode(parentRelDir, node)
    kbSelectedKeys.value = [relPath]
    kbUsedBytes.value += node.size || 0
    persistKnowledgeBase()
    return node
  }

  const renameKnowledgeNode = async (relPath: string, title: string) => {
    const node = findKnowledgeNode(relPath)
    const name = title.trim()
    if (!node || !name) return
    if (window.aiops?.kbRename) {
      const result = await window.aiops.kbRename(relPath, name)
      kbSelectedKeys.value = [result.relPath]
      kbExpandedKeys.value = kbExpandedKeys.value.map((key) => (key === relPath || key.startsWith(`${relPath}/`) ? key.replace(relPath, result.relPath) : key))
      await refreshKnowledgeTree()
      syncKnowledgePanelsAfterRename(relPath, result.relPath)
      return
    }
    const parent = getKbParent(relPath)
    const nextRelPath = createKbRelPath(parent, name)
    const updatePaths = (target: KnowledgeNode, oldPrefix: string, newPrefix: string) => {
      target.title = target.relPath === oldPrefix ? name : target.title
      target.relPath = target.relPath.replace(oldPrefix, newPrefix)
      target.key = target.relPath
      target.children?.forEach((child) => updatePaths(child, oldPrefix, newPrefix))
    }
    updatePaths(node, relPath, nextRelPath)
    kbSelectedKeys.value = [nextRelPath]
    kbExpandedKeys.value = kbExpandedKeys.value.map((key) => (key === relPath || key.startsWith(`${relPath}/`) ? key.replace(relPath, nextRelPath) : key))
    syncKnowledgePanelsAfterRename(relPath, nextRelPath)
    persistKnowledgeBase()
  }

  const deleteKnowledgeNodes = async (relPaths: string[]) => {
    if (window.aiops?.kbDelete) {
      for (const relPath of relPaths) {
        const node = findKnowledgeNode(relPath)
        if (!node) continue
        await window.aiops.kbDelete(relPath, node.type === 'dir')
      }
      kbSelectedKeys.value = kbSelectedKeys.value.filter((key) => !relPaths.includes(key))
      kbExpandedKeys.value = kbExpandedKeys.value.filter((key) => !relPaths.some((relPath) => key === relPath || key.startsWith(`${relPath}/`)))
      await refreshKnowledgeTree()
      closeKnowledgePanelsForRemoved(relPaths)
      return
    }
    relPaths.forEach((relPath) => {
      const removed = removeKnowledgeNode(relPath)
      if (removed) kbUsedBytes.value = Math.max(0, kbUsedBytes.value - knowledgeNodeSize(removed))
    })
    kbSelectedKeys.value = kbSelectedKeys.value.filter((key) => !relPaths.includes(key))
    kbExpandedKeys.value = kbExpandedKeys.value.filter((key) => !relPaths.some((relPath) => key === relPath || key.startsWith(`${relPath}/`)))
    closeKnowledgePanelsForRemoved(relPaths)
    persistKnowledgeBase()
  }

  const copyKnowledgeNodes = (relPaths: string[], mode: 'copy' | 'cut') => {
    if (!relPaths.length) return
    kbClipboard.value = { mode, sources: relPaths }
  }

  const pasteKnowledgeNodes = async (targetRelDir: string) => {
    if (!kbClipboard.value) return
    const destination = findKnowledgeNode(targetRelDir)
    const dstRelDir = destination?.type === 'file' ? getKbParent(destination.relPath) : targetRelDir
    if (window.aiops?.kbCopy && window.aiops?.kbMove) {
      const sources = [...kbClipboard.value.sources]
      const mode = kbClipboard.value.mode
      for (const source of sources) {
        if (mode === 'copy') {
          await window.aiops.kbCopy(source, dstRelDir)
        } else {
          await window.aiops.kbMove(source, dstRelDir)
        }
      }
      if (mode === 'cut') kbClipboard.value = null
      await refreshKnowledgeTree()
      if (mode === 'cut') closeKnowledgePanelsForRemoved(sources)
      return
    }
    kbClipboard.value.sources.forEach((source) => {
      const node = findKnowledgeNode(source)
      if (!node) return
      const copied = cloneKnowledgeNodes([node])[0]
      const baseName = kbClipboard.value?.mode === 'copy' ? `${copied.title.replace(/(\.[^.]+)?$/, '')}_copy${copied.title.match(/(\.[^.]+)$/)?.[1] || ''}` : copied.title
      copied.title = baseName
      const newRelPath = createKbRelPath(dstRelDir, baseName)
      const oldRelPath = copied.relPath
      const updatePaths = (target: KnowledgeNode) => {
        target.relPath = target.relPath.replace(oldRelPath, newRelPath)
        target.key = target.relPath
        target.children?.forEach(updatePaths)
      }
      updatePaths(copied)
      insertKnowledgeNode(dstRelDir, copied)
      if (kbClipboard.value?.mode === 'copy') {
        kbUsedBytes.value += knowledgeNodeSize(copied)
      }
      if (kbClipboard.value?.mode === 'cut') removeKnowledgeNode(source)
    })
    if (kbClipboard.value.mode === 'cut') kbClipboard.value = null
    persistKnowledgeBase()
  }

  const addKnowledgeImportJob = async (destRelPath: string, srcAbsPath?: string, sourceType: 'file' | 'folder' = 'file') => {
    if (srcAbsPath && window.aiops?.kbImportFile && window.aiops?.kbImportFolder) {
      const dstRelDir = getKbParent(destRelPath)
      const result = sourceType === 'folder' ? await window.aiops.kbImportFolder(srcAbsPath, dstRelDir) : await window.aiops.kbImportFile(srcAbsPath, dstRelDir)
      if (!kbImportJobs.value.some((job) => job.id === result.jobId)) {
        kbImportJobs.value.push({ id: result.jobId, destRelPath: result.relPath, percent: 100 })
        window.setTimeout(() => {
          kbImportJobs.value = kbImportJobs.value.filter((job) => job.id !== result.jobId)
        }, 500)
      }
      await refreshKnowledgeTree()
      return
    }
    const job = { id: createId('kb-import'), destRelPath, percent: 0 }
    kbImportJobs.value.push(job)
    const timer = window.setInterval(() => {
      job.percent = Math.min(100, job.percent + 25)
      if (job.percent >= 100) {
        void createKnowledgeNode('file', getKbParent(destRelPath), destRelPath.split('/').pop() || 'import.md')
        window.clearInterval(timer)
        window.setTimeout(() => {
          kbImportJobs.value = kbImportJobs.value.filter((item) => item.id !== job.id)
        }, 500)
      }
    }, 250)
  }

  const addKnowledgeFilesToChat = async (relPaths: string[]) => {
    const filePaths = relPaths.filter((relPath) => findKnowledgeNode(relPath)?.type === 'file')
    for (const relPath of filePaths) {
      const node = findKnowledgeNode(relPath)
      const label = node?.title || relPath.split('/').pop() || relPath
      if (isKnowledgeImagePath(relPath)) {
        let imageContext: AiContextOption = {
          id: `kb-image:${relPath}`,
          kind: 'images',
          label,
          detail: relPath,
          relPath,
          mediaType: mediaTypeFromKnowledgePath(relPath)
        }
        if (window.aiops?.kbReadFile) {
          try {
            const result = await window.aiops.kbReadFile(relPath, 'base64')
            imageContext = {
              ...imageContext,
              mediaType: result.mimeType || imageContext.mediaType,
              data: result.content
            }
          } catch {
            // Keep a path-only image context if the file is temporarily unreadable.
          }
        }
        selectedContexts.value = selectedContexts.value.some((context) => context.id === imageContext.id)
          ? selectedContexts.value
          : [...selectedContexts.value, imageContext]
      } else {
        const docContext: AiContextOption = {
          id: `kb-doc:${relPath}`,
          kind: 'docs',
          label,
          detail: relPath,
          relPath
        }
        selectedContexts.value = selectedContexts.value.some((context) => context.id === docContext.id)
          ? selectedContexts.value
          : [...selectedContexts.value, docContext]
      }
    }
    rightPanelOpen.value = true
  }

  const selectExtension = (pluginId: string) => {
    if (!visibleExtensionPlugins.value.some((plugin) => plugin.pluginId === pluginId)) return
    selectedExtensionId.value = pluginId
    extensionDetailTab.value = 'details'
  }

  const setExtensionNotice = (text: string) => {
    extensionNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (extensionNotice.value === text) extensionNotice.value = ''
    }, 2400)
  }

  const setExtensionDragActive = (active: boolean) => {
    extensionDragActive.value = active
  }

  const setExtensionInstallLoading = (pluginId: string, loading: boolean) => {
    const next = { ...extensionInstallLoadingMap.value }
    if (loading) next[pluginId] = true
    else delete next[pluginId]
    extensionInstallLoadingMap.value = next
  }

  const setExtensionUpdateLoading = (pluginId: string, loading: boolean) => {
    const next = { ...extensionUpdateLoadingMap.value }
    if (loading) next[pluginId] = true
    else delete next[pluginId]
    extensionUpdateLoadingMap.value = next
  }

  const setExtensionInstallProgress = (pluginId: string, stage: ExtensionInstallStage, percent = 0) => {
    const next = { ...extensionInstallProgressMap.value }
    if (!stage || ['done', 'error', 'cancelled'].includes(stage)) {
      if (stage) next[pluginId] = { pluginId, stage, percent: Math.max(0, Math.min(100, Math.round(percent))) }
      else delete next[pluginId]
    } else {
      next[pluginId] = {
        pluginId,
        stage,
        percent: Math.max(0, Math.min(100, Math.round(percent)))
      }
    }
    extensionInstallProgressMap.value = next
  }

  const clearExtensionInstallProgressLater = (pluginId: string) => {
    window.setTimeout(() => {
      const current = extensionInstallProgressMap.value[pluginId]
      if (!current || !['done', 'error', 'cancelled'].includes(current.stage)) return
      const next = { ...extensionInstallProgressMap.value }
      delete next[pluginId]
      extensionInstallProgressMap.value = next
    }, 900)
  }

  const runExtensionInstallLifecycle = (
    pluginId: string,
    mode: 'install' | 'update',
    onComplete: () => void,
    successNotice: string
  ) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    if (mode === 'install') setExtensionInstallLoading(pluginId, true)
    else setExtensionUpdateLoading(pluginId, true)
    setExtensionInstallProgress(pluginId, 'downloading', 8)
    setExtensionNotice(mode === 'install' ? `正在安装 ${plugin.name}` : `正在更新 ${plugin.name}`)
    const steps: Array<{ stage: ExtensionInstallStage; percent: number; delay: number }> = [
      { stage: 'downloading', percent: 42, delay: 120 },
      { stage: 'downloading', percent: 84, delay: 240 },
      { stage: 'verifying', percent: 100, delay: 360 },
      { stage: 'installing', percent: 100, delay: 480 }
    ]
    steps.forEach((step) => {
      window.setTimeout(() => {
        if (mode === 'install' && !extensionInstallLoadingMap.value[pluginId]) return
        if (mode === 'update' && !extensionUpdateLoadingMap.value[pluginId]) return
        setExtensionInstallProgress(pluginId, step.stage, step.percent)
      }, step.delay)
    })
    window.setTimeout(() => {
      if (mode === 'install' && !extensionInstallLoadingMap.value[pluginId]) return
      if (mode === 'update' && !extensionUpdateLoadingMap.value[pluginId]) return
      onComplete()
      setExtensionInstallLoading(pluginId, false)
      setExtensionUpdateLoading(pluginId, false)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(successNotice)
      clearExtensionInstallProgressLater(pluginId)
    }, 620)
  }

  const markPluginInstalled = (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || plugin.installable === false) return
    plugin.installed = true
    plugin.hasUpdate = false
    plugin.installedVersion = plugin.latestVersion || plugin.installedVersion || '1.0.0'
    plugin.source = plugin.source || 'store'
  }

  const installExtensionPlugin = (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    if (plugin.installable === false) {
      setExtensionNotice('该插件需要订阅后安装')
      return
    }
    runExtensionInstallLifecycle(pluginId, 'install', () => markPluginInstalled(pluginId), `${plugin.name} 安装成功`)
  }

  const updateExtensionPlugin = (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || !plugin.installed || !plugin.hasUpdate) return
    runExtensionInstallLifecycle(
      pluginId,
      'update',
      () => {
        plugin.installedVersion = plugin.latestVersion || plugin.installedVersion
        plugin.hasUpdate = false
      },
      `${plugin.name} 已更新`
    )
  }

  const uninstallExtensionPlugin = (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || plugin.required) return
    if (plugin.source === 'local' && !plugin.latestVersion) {
      extensionPlugins.value = extensionPlugins.value.filter((item) => item.pluginId !== pluginId)
      ensureSelectedExtensionVisible()
    } else {
      plugin.installed = false
      plugin.installedVersion = ''
      plugin.hasUpdate = false
    }
    setExtensionNotice(`${plugin.name} 已卸载`)
  }

  const subscribeExtensionPlugin = (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin) return
    setExtensionNotice(`${plugin.name} 已打开订阅入口`)
  }

  const cancelExtensionInstall = (pluginId: string) => {
    if (!extensionInstallLoadingMap.value[pluginId] && !extensionUpdateLoadingMap.value[pluginId]) return
    setExtensionInstallLoading(pluginId, false)
    setExtensionUpdateLoading(pluginId, false)
    setExtensionInstallProgress(pluginId, 'cancelled', 0)
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    setExtensionNotice(`${plugin?.name || '插件'} 安装已取消`)
    clearExtensionInstallProgressLater(pluginId)
  }

  const createLocalExtensionPlugin = (fileName: string) => {
    const pluginName = fileName.replace(/\.external-reference$/i, '').replace(/[-_]+/g, ' ').trim()
    const baseId = `local-${pluginName.toLowerCase().replace(/\s+/g, '-') || Date.now().toString(36)}`
    let pluginId = baseId
    let index = 1
    while (extensionPlugins.value.some((plugin) => plugin.pluginId === pluginId)) {
      pluginId = `${baseId}-${index++}`
    }
    return {
      pluginId,
      pluginName: pluginName || 'Local Plugin'
    }
  }

  const dropExtensionPackage = (fileName: string) => {
    extensionDragActive.value = false
    if (!fileName.endsWith('.external-reference')) {
      setExtensionNotice('插件包格式错误，请拖入 .external-reference 文件')
      return false
    }
    const { pluginId, pluginName } = createLocalExtensionPlugin(fileName)
    extensionInstallingPackageName.value = pluginName
    setExtensionInstallLoading(pluginId, true)
    setExtensionInstallProgress(pluginId, 'installing', 100)
    setExtensionNotice(`正在安装 ${pluginName}`)
    extensionPlugins.value.push({
      pluginId,
      name: pluginName,
      description: '通过本地 .external-reference 包安装的插件。',
      iconKey: 'local',
      tabName: pluginName,
      show: true,
      isPlugin: true,
      installed: true,
      hasUpdate: false,
      installedVersion: '1.0.0',
      latestVersion: '',
      installable: true,
      isDraggedOnly: true,
      source: 'local',
      lastUpdated: '刚刚',
      size: 524288,
      readme: '本地拖拽安装的插件包已加入插件列表。',
      categories: ['Local', 'Tools'],
      functions: [{ title: '本地插件', desc: '从 .external-reference 包安装，等待接入真实插件运行时。' }]
    })
    selectedExtensionId.value = pluginId
    window.setTimeout(() => {
      setExtensionInstallLoading(pluginId, false)
      setExtensionInstallProgress(pluginId, 'done', 100)
      extensionInstallingPackageName.value = ''
      setExtensionNotice(`${pluginName} 安装成功`)
      clearExtensionInstallProgressLater(pluginId)
    }, 350)
    return true
  }

  const createAliasCommand = () => {
    if (aliasCommands.value.some((item) => item.id === 'new')) return
    aliasSearchQuery.value = ''
    if (aliasEditSnapshot.value && aliasEditSnapshot.value.id !== 'new') {
      aliasCommands.value = aliasCommands.value.map((item) =>
        item.id === aliasEditSnapshot.value?.id ? { ...aliasEditSnapshot.value, edit: false } : { ...item, edit: false }
      )
    } else {
      aliasCommands.value = aliasCommands.value.map((item) => ({ ...item, edit: false }))
    }
    aliasEditSnapshot.value = { id: 'new', alias: '', command: '', edit: true }
    aliasCommands.value = [{ id: 'new', alias: '', command: '', edit: true }, ...aliasCommands.value]
  }

  const startAliasEdit = (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return
    if (aliasCommands.value.some((item) => item.id === 'new')) {
      aliasCommands.value = aliasCommands.value.filter((item) => item.id !== 'new')
    }
    if (aliasEditSnapshot.value && aliasEditSnapshot.value.id !== 'new') {
      aliasCommands.value = aliasCommands.value.map((item) =>
        item.id === aliasEditSnapshot.value?.id ? { ...aliasEditSnapshot.value, edit: false } : item
      )
    }
    aliasEditSnapshot.value = { ...target }
    aliasCommands.value = aliasCommands.value.map((item) => ({ ...item, edit: item.id === id }))
  }

  const updateAliasDraft = (id: string, patch: Partial<Pick<AliasCommand, 'alias' | 'command'>>) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return
    Object.assign(target, patch)
  }

  const saveAliasCommand = (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    const alias = target.alias.trim()
    const command = target.command.trim()
    if (!alias || !command) {
      setExtensionNotice('Alias 和 Command 不能为空')
      return { ok: false, reason: 'missing' as const }
    }
    if (aliasCommands.value.some((item) => item.id !== id && item.alias.trim() === alias)) {
      setExtensionNotice('Alias 已存在')
      return { ok: false, reason: 'duplicate' as const }
    }
    target.alias = alias
    target.command = command
    target.edit = false
    if (target.id === 'new') {
      target.id = createId('alias')
      target.createdAt = Date.now()
    }
    aliasEditSnapshot.value = null
    setExtensionNotice('Alias 已保存')
    persistAliasCommands()
    return { ok: true, reason: 'saved' as const }
  }

  const cancelAliasEdit = (id: string) => {
    if (id === 'new') {
      aliasCommands.value = aliasCommands.value.filter((item) => item.id !== 'new')
      aliasEditSnapshot.value = null
      return
    }
    const target = aliasCommands.value.find((item) => item.id === id)
    if (target && aliasEditSnapshot.value?.id === id) {
      target.alias = aliasEditSnapshot.value.alias
      target.command = aliasEditSnapshot.value.command
      target.edit = false
    } else if (target) {
      target.edit = false
    }
    aliasEditSnapshot.value = null
  }

  const deleteAliasCommand = (id: string) => {
    aliasCommands.value = aliasCommands.value.filter((item) => item.id !== id)
    if (aliasEditSnapshot.value?.id === id) aliasEditSnapshot.value = null
    setExtensionNotice('Alias 已删除')
    persistAliasCommands()
  }

  const setK8sNotice = (text: string) => {
    k8sClusterNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (k8sClusterNotice.value === text) k8sClusterNotice.value = ''
    }, 2400)
  }

  const switchK8sContext = (name: string) => {
    k8sContexts.value.forEach((context) => {
      context.isActive = context.name === name
    })
    setK8sNotice(`已切换到 ${name}`)
  }

  const reloadK8sConfig = () => {
    setK8sNotice('Kubernetes 配置已刷新')
  }

  const clearK8sSearch = () => {
    k8sSearchQuery.value = ''
    setK8sActionMenu(null)
  }

  const setK8sActionMenu = (clusterId: string | null) => {
    k8sClusterActionMenuId.value = clusterId
  }

  const setK8sConnecting = (clusterId: string, connecting: boolean) => {
    k8sConnectingClusterIds.value = connecting
      ? [...new Set([...k8sConnectingClusterIds.value, clusterId])]
      : k8sConnectingClusterIds.value.filter((id) => id !== clusterId)
  }

  const setK8sSyncingBastion = (bastionUuid: string, syncing: boolean) => {
    k8sSyncingBastionIds.value = syncing
      ? [...new Set([...k8sSyncingBastionIds.value, bastionUuid])]
      : k8sSyncingBastionIds.value.filter((id) => id !== bastionUuid)
  }

  const selectK8sCluster = (id: string | null) => {
    k8sSelectedClusterId.value = id
  }

  const openK8sProxyConfig = () => {
    k8sProxyConfigOpen.value = true
  }

  const closeK8sProxyConfig = () => {
    k8sProxyConfigOpen.value = false
  }

  const updateK8sProxyConfig = (patch: Partial<K8sProxyConfig>) => {
    k8sProxyConfig.value = {
      ...k8sProxyConfig.value,
      ...patch,
      port: patch.port === undefined ? k8sProxyConfig.value.port : Math.max(1, Math.min(65535, Number(patch.port) || 1))
    }
    if (!k8sProxyConfig.value.enableProxyIdentity) {
      k8sProxyConfig.value.username = ''
      k8sProxyConfig.value.password = ''
    }
  }

  const saveK8sProxyConfig = () => {
    if (k8sProxyConfig.value.enabled && (!k8sProxyConfig.value.host.trim() || !k8sProxyConfig.value.port)) {
      setK8sNotice('请补全 Kubernetes Agent 代理主机和端口')
      return false
    }
    k8sProxyConfigOpen.value = false
    setK8sNotice(k8sProxyConfig.value.enabled ? 'Kubernetes Agent 代理配置已应用' : 'Kubernetes Agent 代理已关闭')
    return true
  }

  const connectK8sCluster = (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return
    setK8sActionMenu(null)
    setK8sConnecting(id, true)
    cluster.connection_status = 'connecting'
    setK8sNotice(`正在连接 ${cluster.name}`)
    window.setTimeout(() => {
      const latest = k8sClusters.value.find((item) => item.id === id)
      if (!latest || !k8sConnectingClusterIds.value.includes(id)) return
      k8sClusters.value.forEach((item) => {
        item.is_active = item.id === id ? 1 : 0
        if (item.id !== id && item.connection_status === 'connected') item.connection_status = 'disconnected'
      })
      latest.connection_status = 'connected'
      latest.is_active = 1
      k8sActiveClusterId.value = id
      setK8sConnecting(id, false)
      setK8sNotice(
        k8sProxyConfig.value.enabled
          ? `${latest.name} 连接成功，K8s Agent 代理 ${k8sProxyConfig.value.type} ${k8sProxyConfig.value.host}:${k8sProxyConfig.value.port} 已应用`
          : `${latest.name} 连接成功`
      )
    }, 280)
  }

  const disconnectK8sCluster = (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return
    setK8sActionMenu(null)
    setK8sConnecting(id, false)
    cluster.connection_status = 'disconnected'
    cluster.is_active = 0
    if (k8sActiveClusterId.value === id) k8sActiveClusterId.value = null
    setK8sNotice(`${cluster.name} 已断开`)
  }

  const openK8sTerminal = (clusterId: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    if (!cluster) return
    let tab = k8sTerminalTabs.value.find((item) => item.clusterId === clusterId)
    if (!tab) {
      tab = {
        id: createId('k8s-tab'),
        clusterId,
        name: cluster.name,
        namespace: cluster.default_namespace || 'default',
        isActive: false,
        output: `kubectl context: ${cluster.context_name}\nnamespace: ${cluster.default_namespace || 'default'}\n$ `
      }
      k8sTerminalTabs.value.push(tab)
    }
    k8sTerminalTabs.value.forEach((item) => {
      item.isActive = item.id === tab.id
    })
    k8sActiveTerminalId.value = tab.id
    if (cluster.connection_status !== 'connected') connectK8sCluster(clusterId)
  }

  const closeK8sTerminalTab = (id: string) => {
    const index = k8sTerminalTabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return
    k8sTerminalTabs.value.splice(index, 1)
    if (k8sActiveTerminalId.value === id) {
      const next = k8sTerminalTabs.value[Math.min(index, k8sTerminalTabs.value.length - 1)]
      k8sActiveTerminalId.value = next?.id || null
      k8sTerminalTabs.value.forEach((tab) => {
        tab.isActive = tab.id === k8sActiveTerminalId.value
      })
    }
  }

  const setActiveK8sTerminal = (id: string) => {
    k8sActiveTerminalId.value = id
    k8sTerminalTabs.value.forEach((tab) => {
      tab.isActive = tab.id === id
    })
  }

  const sendK8sTerminalCommand = (command: string) => {
    const tab = k8sActiveTerminal.value
    if (!tab || !command.trim()) return
    tab.output += `${command}\n[mock kubectl] ${command}\n$ `
  }

  const findK8sResource = (resourceId: string) => k8sResources.value.find((resource) => resource.id === resourceId) || null

  const buildK8sResourceCommand = (resource: MockK8sResource, action: 'get' | 'describe' | 'logs') => {
    const type = k8sResourceTypeByKind[resource.kind]
    const namespaceArg = resource.kind === 'nodes' ? '' : ` -n ${resource.namespace}`
    if (action === 'logs') return `kubectl logs ${resource.name}${namespaceArg} --tail=120`
    if (action === 'describe') return `kubectl describe ${type} ${resource.name}${namespaceArg}`
    return `kubectl get ${type} ${resource.name}${namespaceArg} -o wide`
  }

  const currentK8sOutputCommand = () => k8sResourceOutput.value.split('\n').find((line) => line.trim().startsWith('kubectl '))?.trim() || ''

  const setK8sResourceKind = (kind: K8sResourceKind) => {
    k8sResourceKind.value = kind
    if (kind === 'nodes') k8sResourceNamespace.value = 'all'
  }

  const setK8sResourceNamespace = (namespace: string) => {
    k8sResourceNamespace.value = namespace
  }

  const refreshK8sResources = () => {
    const cluster = k8sResourceCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes 集群')
      return
    }
    k8sResourceLoading.value = true
    k8sResourceOutputTitle.value = `${cluster.name} / ${k8sKindLabels[k8sResourceKind.value]}`
    k8sResourceOutput.value = `kubectl get ${k8sKindLabels[k8sResourceKind.value].toLowerCase()} ${k8sResourceNamespace.value === 'all' ? '--all-namespaces' : `-n ${k8sResourceNamespace.value}`}\n\n已刷新 ${filteredK8sResources.value.length} 条资源。`
    window.setTimeout(() => {
      k8sResourceLoading.value = false
    }, 180)
    setK8sNotice('Kubernetes 资源已刷新')
  }

  const describeK8sResource = (resourceId: string) => {
    const resource = findK8sResource(resourceId)
    if (!resource) return
    const command = buildK8sResourceCommand(resource, 'describe')
    k8sResourceOutputTitle.value = `Describe ${resource.name}`
    k8sResourceOutput.value = [
      command,
      '',
      `Name: ${resource.name}`,
      `Namespace: ${resource.kind === 'nodes' ? '<cluster>' : resource.namespace}`,
      `Kind: ${k8sKindLabels[resource.kind]}`,
      `Status: ${resource.status}`,
      `Ready: ${resource.ready}`,
      resource.node ? `Node: ${resource.node}` : '',
      resource.image ? `Image: ${resource.image}` : '',
      resource.ports ? `Ports: ${resource.ports}` : '',
      resource.selector ? `Selector: ${resource.selector}` : '',
      resource.restarts !== undefined ? `Restarts: ${resource.restarts}` : '',
      `Age: ${resource.age}`,
      '',
      `Events: ${resource.detail}`
    ]
      .filter(Boolean)
      .join('\n')
  }

  const showK8sPodLogs = (resourceId: string) => {
    const resource = findK8sResource(resourceId)
    if (!resource || resource.kind !== 'pods') return
    const command = buildK8sResourceCommand(resource, 'logs')
    const errorLine = resource.status === 'CrashLoopBackOff' ? '\n2026-06-04T09:28:11Z error failed to load billing config: missing secret billing-api-token' : ''
    k8sResourceOutputTitle.value = `Logs ${resource.name}`
    k8sResourceOutput.value = `${command}\n\n2026-06-04T09:27:59Z info starting container ${resource.name}\n2026-06-04T09:28:02Z info namespace=${resource.namespace} node=${resource.node || '-'}${errorLine}\n2026-06-04T09:28:15Z info readiness probe ${resource.status === 'Running' ? 'passed' : 'pending'}`
  }

  const copyK8sResourceCommand = (resourceId: string, action: 'get' | 'describe' | 'logs' = 'get') => {
    const resource = findK8sResource(resourceId)
    if (!resource || (action === 'logs' && resource.kind !== 'pods')) return ''
    const command = buildK8sResourceCommand(resource, action)
    k8sCopiedCommand.value = command
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(command).catch(() => undefined)
    }
    setK8sNotice('kubectl 命令已复制')
    return command
  }

  const copyK8sResourceOutput = () => {
    const output = k8sResourceOutput.value.trim()
    if (!output) return ''
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(output).catch(() => undefined)
    }
    setK8sNotice('Kubernetes 输出已复制')
    return output
  }

  const clearK8sResourceOutput = () => {
    k8sCopiedCommand.value = ''
    k8sResourceOutputTitle.value = '资源输出'
    k8sResourceOutput.value = '选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。'
    setK8sNotice('Kubernetes 输出已清空')
  }

  const sendK8sCurrentOutputToTerminal = () => {
    const cluster = k8sResourceCluster.value
    const command = currentK8sOutputCommand()
    if (!cluster || !command) {
      setK8sNotice('当前没有可发送到终端的 kubectl 命令')
      return ''
    }
    openK8sTerminal(cluster.id)
    sendK8sTerminalCommand(command)
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
    return command
  }

  const sendK8sCurrentOutputToAi = () => {
    const cluster = k8sResourceCluster.value
    const output = k8sResourceOutput.value.trim()
    if (!cluster || !output) {
      setK8sNotice('当前没有可发送到 AI 的 Kubernetes 输出')
      return false
    }
    const host: AiContextOption = {
      id: `k8s-${cluster.id}`,
      kind: 'hosts',
      label: cluster.name,
      detail: `${cluster.context_name} / ${cluster.default_namespace}`
    }
    sendChat(`请分析这个 Kubernetes 输出并给出下一步排查建议：\n\nTerminal output:\n\`\`\`\n${output}\n\`\`\``, undefined, [host])
    setK8sNotice('Kubernetes 输出已发送到 AI')
    return true
  }

  const sendK8sResourceCommand = (resourceId: string, action: 'get' | 'describe' | 'logs' = 'get') => {
    const resource = findK8sResource(resourceId)
    const cluster = resource ? k8sClusters.value.find((item) => item.id === resource.clusterId) : null
    if (!resource || !cluster || (action === 'logs' && resource.kind !== 'pods')) return
    openK8sTerminal(cluster.id)
    sendK8sTerminalCommand(buildK8sResourceCommand(resource, action))
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
  }

  const testK8sClusterConnection = (patch: { contextName?: string; serverUrl?: string }) => {
    const ok = !!(patch.contextName?.trim() && patch.serverUrl?.trim())
    k8sTestResult.value = ok
    setK8sNotice(ok ? '连接测试成功' : '连接测试失败')
    return ok
  }

  const selectK8sImportContext = (contextName: string) => {
    return k8sImportContexts.value.find((context) => context.name === contextName) || null
  }

  const addK8sCluster = (payload: {
    name: string
    contextName: string
    serverUrl: string
    defaultNamespace?: string
    kubeconfigPath?: string | null
    kubeconfigContent?: string | null
    sourceType?: 'local' | 'jumpserver'
    bastionUuid?: string | null
  }) => {
    const name = payload.name.trim()
    const contextName = payload.contextName.trim()
    const serverUrl = payload.serverUrl.trim()
    if (!name || !contextName || !serverUrl) {
      setK8sNotice('请补全集群名称、Context 和 Server URL')
      return null
    }
    const cluster: MockK8sCluster = {
      id: createId('k8s'),
      name,
      kubeconfig_path: payload.kubeconfigPath || null,
      kubeconfig_content: payload.kubeconfigContent || null,
      context_name: contextName,
      server_url: serverUrl,
      auth_type: payload.sourceType === 'jumpserver' ? 'jumpserver' : 'kubeconfig',
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: payload.defaultNamespace?.trim() || 'default',
      created_at: '刚刚',
      updated_at: '刚刚',
      source_type: payload.sourceType || 'local',
      bastion_uuid: payload.bastionUuid || null,
      bastion_asset_address: null,
      bastion_asset_name: null,
      bastion_asset_id_last: null
    }
    k8sClusters.value.unshift(cluster)
    if (cluster.source_type === 'local') {
      k8sContexts.value.unshift({
        name: cluster.context_name,
        cluster: cluster.name,
        namespace: cluster.default_namespace,
        server: cluster.server_url,
        isActive: false
      })
    }
    k8sSelectedClusterId.value = cluster.id
    k8sAddModalOpen.value = false
    setK8sNotice(`${cluster.name} 已添加`)
    return cluster
  }

  const updateK8sCluster = (id: string, patch: { name?: string; defaultNamespace?: string; autoConnect?: boolean }) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return
    if (patch.name?.trim()) cluster.name = patch.name.trim()
    if (patch.defaultNamespace?.trim()) cluster.default_namespace = patch.defaultNamespace.trim()
    if (patch.autoConnect !== undefined) cluster.auto_connect = patch.autoConnect ? 1 : 0
    cluster.updated_at = '刚刚'
    const context = k8sContexts.value.find((item) => item.name === cluster.context_name)
    if (context) {
      context.cluster = cluster.name
      context.namespace = cluster.default_namespace
      context.server = cluster.server_url
    }
    k8sEditModalOpen.value = false
    k8sEditingClusterId.value = null
    setK8sNotice(`${cluster.name} 已更新`)
  }

  const requestDeleteK8sCluster = (id: string) => {
    k8sDeleteConfirmClusterId.value = id
    setK8sActionMenu(null)
  }

  const cancelDeleteK8sCluster = () => {
    k8sDeleteConfirmClusterId.value = null
  }

  const confirmDeleteK8sCluster = () => {
    if (!k8sDeleteConfirmClusterId.value) return
    deleteK8sCluster(k8sDeleteConfirmClusterId.value)
    k8sDeleteConfirmClusterId.value = null
  }

  const deleteK8sCluster = (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    k8sClusters.value = k8sClusters.value.filter((item) => item.id !== id)
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => tab.clusterId !== id)
    k8sContexts.value = k8sContexts.value.filter((context) => context.name !== cluster?.context_name)
    if (k8sSelectedClusterId.value === id) k8sSelectedClusterId.value = null
    if (k8sActiveClusterId.value === id) k8sActiveClusterId.value = null
    if (k8sActiveTerminalId.value && !k8sTerminalTabs.value.some((tab) => tab.id === k8sActiveTerminalId.value)) {
      k8sActiveTerminalId.value = k8sTerminalTabs.value[0]?.id || null
    }
    setK8sNotice(`${cluster?.name || '集群'} 已删除`)
  }

  const syncK8sBastion = (bastionUuid: string) => {
    const bastion = k8sBastions.value.find((item) => item.uuid === bastionUuid)
    if (!bastion) return
    setK8sSyncingBastion(bastionUuid, true)
    setK8sNotice(`正在同步 ${bastion.label}`)
    window.setTimeout(() => {
      const existing = k8sClusters.value.filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid)
      if (!existing.length) {
        addK8sCluster({
          name: `${bastion.label}-k8s`,
          contextName: `${bastion.label}/synced`,
          serverUrl: `${bastion.ip}:6443`,
          defaultNamespace: 'default',
          sourceType: 'jumpserver',
          bastionUuid
        })
        k8sConfigTab.value = 'jumpserver'
        setK8sNotice(`${bastion.label} Kubernetes 资产已同步，新增 1 个`)
      } else {
        existing.forEach((cluster) => {
          cluster.updated_at = '刚刚'
        })
        setK8sNotice(`${bastion.label} Kubernetes 资产已同步，更新 ${existing.length} 个`)
      }
      setK8sSyncingBastion(bastionUuid, false)
    }, 320)
  }

  const toggleK8sBastionCollapsed = (uuid: string) => {
    k8sCollapsedBastionIds.value = k8sCollapsedBastionIds.value.includes(uuid)
      ? k8sCollapsedBastionIds.value.filter((id) => id !== uuid)
      : [...k8sCollapsedBastionIds.value, uuid]
  }

  const toggleLeft = () => {
    if (mode.value === 'agents') {
      agentsLeftOpen.value = !agentsLeftOpen.value
      return
    }
    leftPanelOpen.value = !leftPanelOpen.value
    saveConfig({ leftPanelOpen: leftPanelOpen.value })
  }

  const toggleRight = () => {
    if (mode.value !== 'terminal' || activeModule.value === 'database' || activeModule.value === 'user') return
    rightPanelOpen.value = !rightPanelOpen.value
    saveConfig({ rightPanelOpen: rightPanelOpen.value })
  }

  const createPanel = (split?: PanelDirection) => {
    const panel: TerminalPanel = {
      id: createId('panel'),
      title: split ? `split ${panels.value.length}` : `shell ${panels.value.length}`,
      cwd: '~',
      kind: 'terminal',
      output: 'aiopsterm local shell\n$ ',
      outputSegments: createTerminalSegments('aiopsterm local shell\n$ '),
      status: 'ready',
      split
    }
    panels.value.push(panel)
    activePanelId.value = panel.id
  }

  const resetToDefaultTerminalPanel = (panel: TerminalPanel) => {
    panel.id = 'panel-main'
    panel.title = 'local shell'
    panel.cwd = '~'
    panel.kind = 'terminal'
    panel.status = 'ready'
    panel.split = undefined
    panel.sessionId = undefined
    panel.knowledge = undefined
    panel.sshSession = undefined
    setTerminalOutput(panel, 'aiopsterm dashboard\n$ ')
  }

  const closePanel = (id = activePanelId.value) => {
    if (panels.value.length === 1) {
      resetToDefaultTerminalPanel(panels.value[0])
      activePanelId.value = panels.value[0].id
      return
    }
    panels.value = panels.value.filter((panel) => panel.id !== id)
    if (!panels.value.some((panel) => panel.id === activePanelId.value)) {
      activePanelId.value = panels.value[0].id
    }
  }

  const closeOthers = () => {
    panels.value = panels.value.filter((panel) => panel.id === activePanelId.value)
  }

  const closeAllPanels = () => {
    panels.value = [
      {
        id: 'panel-main',
        title: 'local shell',
        cwd: '~',
        kind: 'terminal',
        status: 'ready',
        output: 'aiopsterm local shell\n$ ',
        outputSegments: createTerminalSegments('aiopsterm local shell\n$ ')
      }
    ]
    activePanelId.value = 'panel-main'
  }

  const closePanels = (mode: CloseMode, id = activePanelId.value) => {
    if (mode === 'all') {
      closeAllPanels()
    } else if (mode === 'others') {
      activePanelId.value = id
      closeOthers()
    } else {
      closePanel(id)
    }
  }

  const renamePanel = (id: string, title: string) => {
    const panel = panels.value.find((item) => item.id === id)
    if (panel && title.trim()) {
      panel.title = title.trim()
    }
  }

  const canForkSshPanel = (panelId: string) => {
    const panel = panels.value.find((item) => item.id === panelId)
    return Boolean(panel?.kind === 'terminal' && panel.sshSession?.connectionId)
  }

  const forkSshPanel = (panelId: string) => {
    const source = panels.value.find((item) => item.id === panelId)
    if (!source?.sshSession?.connectionId) return null
    const sourceSession = source.sshSession
    const forkSession: TerminalSshSession = {
      ...sourceSession,
      connectionId: createMockSshConnectionId({
        id: sourceSession.assetId,
        host: sourceSession.host,
        port: sourceSession.port,
        username: sourceSession.username,
        asset_type: sourceSession.authType || 'person'
      }),
      sourcePanelId: source.id,
      forkFromConnectionId: sourceSession.connectionId,
      createdAt: Date.now()
    }
    const forkPanel: TerminalPanel = {
      id: createId('panel'),
      title: `${source.title} fork`,
      cwd: source.cwd,
      kind: 'terminal',
      output: '',
      outputSegments: [],
      status: 'running',
      split: source.split,
      sshSession: forkSession
    }
    const message = [
      `[fork ssh] source=${source.title}`,
      `[fork ssh] reused ${sourceSession.username}@${sourceSession.host}:${sourceSession.port}`,
      `[fork ssh] sourceConnectionId=${sourceSession.connectionId}`,
      `[fork ssh] newConnectionId=${forkSession.connectionId}`,
      '$ '
    ].join('\n')
    setTerminalOutput(forkPanel, `${message}\n`)
    panels.value.push(forkPanel)
    activePanelId.value = forkPanel.id
    selectedContexts.value = [
      ...selectedContexts.value.filter((item) => item.id !== (sourceSession.assetId || sourceSession.connectionId)),
      {
        id: sourceSession.assetId || sourceSession.connectionId,
        kind: 'hosts',
        label: sourceSession.host,
        detail: `${sourceSession.assetName} fork`
      }
    ]
    return forkPanel
  }

  const knowledgePanelId = (relPath: string) => `kb:${relPath}`

  const openKnowledgeFile = (relPath: string) => {
    const node = findKnowledgeNode(relPath)
    if (!node || node.type !== 'file') return null
    const existing = panels.value.find((panel) => panel.kind === 'knowledge' && panel.knowledge?.relPath === relPath)
    if (existing) {
      activePanelId.value = existing.id
      kbSelectedKeys.value = [relPath]
      return existing
    }
    const panel: TerminalPanel = {
      id: knowledgePanelId(relPath),
      title: node.title || relPath.split('/').pop() || 'KnowledgeCenter',
      cwd: getKbParent(relPath) || '@knowledgebase',
      kind: 'knowledge',
      status: 'ready',
      output: '',
      outputSegments: [],
      knowledge: {
        relPath,
        isImage: isKnowledgeImagePath(relPath)
      }
    }
    panels.value.push(panel)
    activePanelId.value = panel.id
    kbSelectedKeys.value = [relPath]
    return panel
  }

  const syncKnowledgePanelsAfterRename = (oldRelPath: string, newRelPath: string) => {
    panels.value.forEach((panel) => {
      if (panel.kind !== 'knowledge' || !panel.knowledge?.relPath) return
      const relPath = panel.knowledge.relPath
      if (relPath !== oldRelPath && !relPath.startsWith(`${oldRelPath}/`)) return
      const nextRelPath = relPath === oldRelPath ? newRelPath : `${newRelPath}${relPath.slice(oldRelPath.length)}`
      const oldPanelId = panel.id
      panel.id = knowledgePanelId(nextRelPath)
      panel.title = nextRelPath.split('/').pop() || nextRelPath
      panel.cwd = getKbParent(nextRelPath) || '@knowledgebase'
      panel.knowledge = {
        relPath: nextRelPath,
        isImage: isKnowledgeImagePath(nextRelPath)
      }
      if (activePanelId.value === oldPanelId) {
        activePanelId.value = panel.id
      }
    })
  }

  const closeKnowledgePanelsForRemoved = (relPaths: string[]) => {
    const shouldClose = (panel: TerminalPanel) =>
      panel.kind === 'knowledge' &&
      Boolean(panel.knowledge?.relPath) &&
      relPaths.some((relPath) => panel.knowledge!.relPath === relPath || panel.knowledge!.relPath.startsWith(`${relPath}/`))
    if (!panels.value.some(shouldClose)) return
    panels.value = panels.value.filter((panel) => !shouldClose(panel))
    if (!panels.value.length) {
      closeAllPanels()
      return
    }
    if (!panels.value.some((panel) => panel.id === activePanelId.value)) {
      activePanelId.value = panels.value[0].id
    }
  }

  const appendTerminalOutput = (id: string, data: string) => {
    const panel = panels.value.find((item) => item.sessionId === id || item.id === id)
    if (!panel) return
    appendTerminalSegment(panel, data, 'output')
    panel.status = 'running'
  }

  const appendTerminalInput = (id: string, data: string) => {
    const panel = panels.value.find((item) => item.sessionId === id || item.id === id)
    if (!panel) return
    appendTerminalSegment(panel, data, 'input')
    recordMacroTerminalInput(panel.id, data)
  }

  const replaceTerminalOutput = (id: string, data: string, scope: TerminalOutputScope = 'output') => {
    const panel = panels.value.find((item) => item.sessionId === id || item.id === id)
    if (!panel) return
    setTerminalOutput(panel, data, scope)
  }

  const getHighlightedTerminalOutput = (id: string) => {
    const panel = panels.value.find((item) => item.id === id || item.sessionId === id)
    if (!panel) return ''
    if (!panel.outputSegments?.length) {
      panel.outputSegments = createTerminalSegments(panel.output)
    }
    return panel.outputSegments
      .map((segment) => applyKeywordHighlight(keywordHighlightSettings.value, segment.text, segment.scope))
      .join('')
  }

  const terminalSecuritySummary = (result: CommandSecurityResult, command: string) => {
    const reason = result.reason || 'Security policy requires review'
    const severity = result.severity ? `severity=${result.severity}` : 'severity=unknown'
    const category = result.category ? `category=${result.category}` : 'category=security'
    return `[security] ${result.action === 'block' ? 'blocked' : 'approval required'}: ${command}\n[security] ${reason} (${category}, ${severity})\n`
  }

  const appendSecurityBlockedOutput = (panelIds: string[], result: CommandSecurityResult, command: string) => {
    const summary = terminalSecuritySummary(result, command)
    panelIds.forEach((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (panel) {
        appendTerminalSegment(panel, summary, 'output')
      }
    })
  }

  const applyTerminalExecution = (execution: TerminalSecurityExecution) => {
    execution.panelIds.forEach((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (!panel) return
      appendTerminalSegment(panel, execution.inputText, 'input')
      if (execution.source !== 'snippet') {
        recordMacroTerminalInput(panel.id, execution.shellText || execution.inputText)
      }
      if (execution.outputText) {
        appendTerminalSegment(panel, execution.outputText, 'output')
        panel.status = 'running'
      }
    })
  }

  const prepareTerminalSecurityExecution = (execution: TerminalSecurityExecution): TerminalSecurityDecision => {
    const result = validateCommandSecurity(securitySettings.value, execution.command)
    if (result.requiresApproval) {
      const prompt = {
        id: createId('terminal-security'),
        command: execution.command,
        panelIds: execution.panelIds,
        source: execution.source,
        result,
        summary: terminalSecuritySummary(result, execution.command),
        execution
      }
      terminalSecurityPrompt.value = prompt
      return { status: 'needs-approval', prompt }
    }

    if (!result.isAllowed) {
      appendSecurityBlockedOutput(execution.panelIds, result, execution.command)
      terminalSecurityPrompt.value = null
      return { status: 'blocked', result }
    }

    terminalSecurityPrompt.value = null
    applyTerminalExecution(execution)
    return { status: 'allow' }
  }

  const executeTerminalCommand = (panelId: string, command: string, options: Partial<Pick<TerminalSecurityExecution, 'inputText' | 'outputText' | 'shellText' | 'writeToShell' | 'source'>> = {}) => {
    const text = command.trim()
    if (!text) return { status: 'allow' } as TerminalSecurityDecision
    return prepareTerminalSecurityExecution({
      command: text,
      panelIds: [panelId],
      inputText: options.inputText ?? `${text}\n`,
      outputText: options.outputText ?? `[mock] ${text}\n$ `,
      shellText: options.shellText ?? `${text}\n`,
      writeToShell: options.writeToShell ?? false,
      source: options.source ?? 'direct'
    })
  }

  const executeGlobalTerminalCommand = (command: string) => {
    const text = command.trim()
    if (!text) return { status: 'allow' } as TerminalSecurityDecision
    const terminalPanelIds = panels.value.filter((panel) => panel.kind !== 'knowledge').map((panel) => panel.id)
    return prepareTerminalSecurityExecution({
      command: text,
      panelIds: terminalPanelIds,
      inputText: `${text}\n`,
      outputText: `[mock broadcast] ${text}\n$ `,
      shellText: `${text}\n`,
      writeToShell: false,
      source: 'global'
    })
  }

  const approveTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    applyTerminalExecution(prompt.execution)
    terminalSecurityPrompt.value = null
    return prompt.execution
  }

  const cancelTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    prompt.panelIds.forEach((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (panel) appendTerminalSegment(panel, `[security] command rejected: ${prompt.command}\n$ `, 'output')
    })
    terminalSecurityPrompt.value = null
    return prompt.execution
  }

  const resolveActiveWritableTerminalPanel = () =>
    activePanel.value.kind === 'knowledge' ? panels.value.find((item) => item.kind !== 'knowledge') : activePanel.value

  const stageActiveTerminalCommand = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    const text = command.trim()
    if (!panel || !text) return null
    return executeTerminalCommand(panel.id, text, { source: 'agent' })
  }

  const appendActiveTerminalInput = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    if (!panel) return null
    return executeTerminalCommand(panel.id, command, { writeToShell: false, source: 'agent' })
  }

  const buildPlainTextFromAiParts = (parts: AiContentPart[]) =>
    parts
      .map((part) => {
        if (part.type === 'text') return part.text
        if (part.type === 'image') return '[image]'
        if (part.chipType === 'doc') return `@${part.ref.absPath || ''}`
        if (part.chipType === 'command') return part.ref.command
        if (part.chipType === 'skill') return `@skill:${part.ref.skillName}`
        const taskName = part.ref.title || ''
        return taskName ? `@${part.ref.taskId}_${taskName}` : `@${part.ref.taskId}`
      })
      .join('')

  const appendChatExchange = (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const safeContentParts = contentParts?.filter((part) => part.type !== 'text' || part.text.trim()) || []
    const hasStructuredParts = safeContentParts.some((part) => part.type !== 'text')
    const prompt = text.trim() || buildPlainTextFromAiParts(safeContentParts).trim()
    if (!prompt && !hasStructuredParts) return false
    const messageContexts = overrideHosts ? [...overrideHosts, ...selectedContexts.value.filter((item) => item.kind !== 'hosts')] : selectedContexts.value
    const selectedSkillNames = new Set(messageContexts.filter((item) => item.kind === 'skills').map((item) => item.label))
    const selectedSkills = settingsSkills.value.filter((skill) => skill.enabled && selectedSkillNames.has(skill.name))
    const selectedKnowledgeDocs = messageContexts.filter((item) => item.kind === 'docs' && item.relPath)
    const selectedKnowledgeImages = messageContexts.filter((item) => item.kind === 'images' && item.relPath)
    const skillContext = selectedSkills.length
      ? `\n\nSkill Instructions:\n${selectedSkills
          .map((skill) => `# Skill Activated: ${skill.name}\nDescription: ${skill.description}\n\n${skill.content}`)
          .join('\n\n')}`
      : ''
    const knowledgeContext =
      selectedKnowledgeDocs.length || selectedKnowledgeImages.length
        ? `\n\nKnowledge Context:\n${[
            ...selectedKnowledgeDocs.map((doc) => `- doc: ${doc.label} (${doc.relPath})`),
            ...selectedKnowledgeImages.map((image) => `- image: ${image.label} (${image.relPath}, ${image.mediaType || 'image'})`)
          ].join('\n')}`
        : ''
    const contextLabel = messageContexts.length
      ? `\n\n上下文：${messageContexts.map((item) => `${item.kind}:${item.label}`).join('、')}`
      : ''
    const commandDisplay = selectedCommandRef.value?.label || selectedCommandRef.value?.command || selectedCommandId.value
    const commandLabel = commandDisplay ? `\n命令：${commandDisplay}` : ''
    chatMessages.value.push({
      id: createId('msg'),
      role: 'user',
      text: `${prompt}${contextLabel}${commandLabel}${knowledgeContext}${skillContext}`,
      contentParts: safeContentParts.length || hasStructuredParts ? safeContentParts : undefined,
      hosts: overrideHosts ?? selectedContexts.value.filter((item) => item.kind === 'hosts')
    })
    const assistantId = createId('msg')
    chatMessages.value.push({
      id: assistantId,
      role: 'assistant',
      text: `${selectedSkills.map((skill) => `Activated Skill: ${skill.name}`).join('\n')}${selectedSkills.length ? '\n\n' : ''}正在读取当前终端、资产和知识库上下文...\n\n计划：\n1. 确认目标环境。\n2. 生成只读检查命令。\n3. 等待用户确认后执行。`,
      state: 'streaming'
    })
    window.setTimeout(() => {
      const message = chatMessages.value.find((item) => item.id === assistantId)
      if (message) {
        message.state = 'done'
        message.text = `${message.text}\n\n当前为本地 mock 响应，未连接任何远端 AI 服务。`
      }
    }, 700)
    const conversation = conversations.value.find((item) => item.id === selectedConversationId.value)
    if (conversation) {
      conversation.summary = prompt
      conversation.updatedAt = '刚刚'
      conversation.ts = Math.max(Date.now(), ...conversations.value.map((item) => item.ts)) + 1
    }
    return true
  }

  const sendChat = (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    appendChatExchange(text, contentParts, overrideHosts)
  }

  const resendUserMessageFromParts = (messageId: string, contentParts: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const index = chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'user')
    if (index === -1) return false
    const originalHosts = chatMessages.value[index].hosts
    const prompt = buildPlainTextFromAiParts(contentParts).trim()
    const hasStructuredParts = contentParts.some((part) => part.type !== 'text')
    if (!prompt && !hasStructuredParts) return false
    chatMessages.value.splice(index)
    return appendChatExchange(prompt, contentParts, overrideHosts ?? originalHosts)
  }

  const createConversation = () => {
    const conversation: ConversationItem = {
      id: createId('conv'),
      title: '新会话',
      summary: '等待输入运维目标',
      updatedAt: '刚刚',
      ts: Math.max(Date.now(), ...conversations.value.map((item) => item.ts)) + 1
    }
    conversations.value.unshift(conversation)
    selectedConversationId.value = conversation.id
    chatMessages.value = [{ id: createId('msg'), role: 'assistant', text: '请输入本次运维目标。', state: 'done' }]
    return conversation
  }

  const deleteConversation = (id: string) => {
    conversations.value = conversations.value.filter((conversation) => conversation.id !== id)
    if (selectedConversationId.value === id) {
      selectedConversationId.value = conversations.value[0]?.id || ''
    }
  }

  const selectConversation = (id: string) => {
    selectedConversationId.value = id
  }

  const renameConversation = (id: string, title: string) => {
    const nextTitle = title.trim()
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation || !nextTitle) return false
    conversation.title = nextTitle
    conversation.updatedAt = '刚刚'
    conversation.ts = Math.max(Date.now(), ...conversations.value.map((item) => item.ts)) + 1
    return true
  }

  const toggleConversationFavorite = (id: string) => {
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    conversation.favorite = !conversation.favorite
    return true
  }

  const restoreConversation = (id: string) => {
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    selectedConversationId.value = id
    chatMessages.value = [
      {
        id: createId('msg'),
        role: 'system',
        text: `已恢复会话：${conversation.title}`
      },
      {
        id: createId('msg'),
        role: 'user',
        text: conversation.summary || conversation.title,
        hosts: conversation.ipAddress
          ? [
              {
                id: `history-host-${conversation.id}`,
                kind: 'hosts',
                label: conversation.ipAddress,
                detail: conversation.title
              }
            ]
          : undefined
      },
      {
        id: createId('msg'),
        role: 'assistant',
        text: `这是 ${conversation.title} 的本地历史摘要。继续输入后会基于当前上下文生成新的运维计划。`,
        state: 'done'
      }
    ]
    return true
  }

  const toggleContext = (context: AiContextOption) => {
    selectedContexts.value = selectedContexts.value.some((item) => item.id === context.id)
      ? selectedContexts.value.filter((item) => item.id !== context.id)
      : [...selectedContexts.value, context]
  }

  const removeContext = (id: string) => {
    selectedContexts.value = selectedContexts.value.filter((item) => item.id !== id)
  }

  const applyCommandPreset = (id: string, prompt: string) => {
    selectedCommandId.value = id
    selectedCommandRef.value = null
    sendChat(prompt)
  }

  const selectCommandPreset = (id: string | null, commandRef?: AiCommandChipRef | null) => {
    selectedCommandId.value = id
    selectedCommandRef.value = id && commandRef ? { ...commandRef } : null
  }

  const setMessageFeedback = (id: string, feedback: 'up' | 'down') => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (message) {
      message.feedback = message.feedback === feedback ? undefined : feedback
    }
  }

  const toggleMessageFavorite = (id: string) => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (message) {
      message.favorite = !message.favorite
    }
  }

  const retryAssistantMessage = (messageId?: string) => {
    const assistantIndex = messageId
      ? chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'assistant')
      : -1
    const history = assistantIndex >= 0 ? chatMessages.value.slice(0, assistantIndex) : chatMessages.value
    const lastUserMessage = [...history].reverse().find((message) => message.role === 'user')
    if (lastUserMessage) {
      sendChat(lastUserMessage.text, lastUserMessage.contentParts, lastUserMessage.hosts)
      return true
    }
    return false
  }

  const retryLastAssistantMessage = () => {
    return retryAssistantMessage()
  }

  const messagePlainText = (message: ChatMessage) =>
    message.contentParts?.length ? buildPlainTextFromAiParts(message.contentParts).trim() : message.text.trim()

  const messageSummaryContent = (message: ChatMessage) => {
    const body = messagePlainText(message)
    const hosts = message.hosts?.length ? `\n\nHosts: ${message.hosts.map((host) => host.label).join(', ')}` : ''
    return `# AI Message Summary\n\nRole: ${message.role}\nMessage ID: ${message.id}\n\n${body}${hosts}\n`
  }

  const knowledgeFileNameForMessage = (message: ChatMessage) => {
    const safeId = message.id.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'message'
    return `ai-message-${safeId}.md`
  }

  const uniqueKnowledgeFileName = (parentRelDir: string, fileName: string) => {
    const dotIndex = fileName.lastIndexOf('.')
    const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : ''
    let candidate = fileName
    let index = 1
    while (findKnowledgeNode(createKbRelPath(parentRelDir, candidate))) {
      candidate = `${base}-${index}${ext}`
      index += 1
    }
    return candidate
  }

  const ensureLocalKnowledgeDir = async (title: string) => {
    const relPath = title
    const existing = findKnowledgeNode(relPath)
    if (existing?.type === 'dir') return existing
    if (window.aiops?.kbMkdir) {
      await window.aiops.kbMkdir('', title)
      await refreshKnowledgeTree()
      const created = findKnowledgeNode(relPath)
      if (created?.type === 'dir') return created
    }
    const node: KnowledgeNode = {
      id: createId('kb'),
      key: relPath,
      relPath,
      title,
      type: 'dir',
      children: []
    }
    insertKnowledgeNode('', node)
    persistKnowledgeBase()
    return node
  }

  const summarizeMessageToKnowledge = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const content = messageSummaryContent(message)
    await ensureLocalKnowledgeDir('summary')
    const fileName = uniqueKnowledgeFileName('summary', knowledgeFileNameForMessage(message))
    const fallbackRelPath = createKbRelPath('summary', fileName)
    let relPath = fallbackRelPath

    if (window.aiops?.kbCreateFile) {
      const result = await window.aiops.kbCreateFile('summary', fileName, content)
      relPath = result?.relPath || fallbackRelPath
      if (window.aiops.kbWriteFile) {
        await window.aiops.kbWriteFile(relPath, content)
      }
      await refreshKnowledgeTree()
    } else {
      insertKnowledgeNode('summary', {
        id: createId('kb'),
        key: relPath,
        relPath,
        title: fileName,
        type: 'file',
        size: content.length
      })
      kbUsedBytes.value += content.length
      persistKnowledgeBase()
    }

    kbSelectedKeys.value = [relPath]
    openKnowledgeFile(relPath)
    return { relPath, content }
  }

  const alphaSuffix = (index: number) => {
    let value = index
    let suffix = ''
    do {
      suffix = String.fromCharCode(97 + (value % 26)) + suffix
      value = Math.floor(value / 26) - 1
    } while (value >= 0)
    return suffix
  }

  const skillNameForMessage = (message: ChatMessage) => {
    const words = messagePlainText(message)
      .toLowerCase()
      .match(/[a-z]+/g)
      ?.filter((word) => word.length > 2)
      .slice(0, 3)
    const rawBase = words?.length ? `${words.join('-')}-skill` : 'ai-message-skill'
    let candidate = rawBase.replace(/[^a-z-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'ai-message-skill'
    let index = 0
    while (settingsSkills.value.some((skill) => skill.name === candidate)) {
      candidate = `${rawBase}-${alphaSuffix(index)}`
      index += 1
    }
    return candidate
  }

  const summarizeMessageToSkill = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const name = skillNameForMessage(message)
    const plainText = messagePlainText(message)
    const skill = {
      name,
      description: `Summarized from AI message ${message.id}`,
      content: `Use this runbook when a similar operations context appears.\n\nSource message:\n${plainText}`,
      enabled: true,
      editable: true
    }
    settingsSkills.value.unshift(skill)
    persistSkills()
    try {
      const created = await window.aiops?.createSkill?.({ name: skill.name, description: skill.description }, skill.content)
      if (created) {
        const existing = settingsSkills.value.find((item) => item.name === created.name)
        if (existing) Object.assign(existing, created)
      }
    } catch {
      setSettingsNotice(`${name} 已保存到本地，技能桥接创建失败`)
    }
    return skill
  }

  return {
    mode,
    activeModule,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    topUpdateState,
    topNotice,
    onboardingCompleted,
    onboardingActiveTour,
    onboardingActiveStepIndex,
    onboardingGuideOpen,
    onboardingAiRequest,
    onboardingAssetRequest,
    onboardingAutoApprovalEvent,
    config,
    panels,
    activePanelId,
    activePanel,
    isLeftVisible,
    isRightVisible,
    conversations,
    sortedConversations,
    selectedConversationId,
    chatMessages,
    terminalSecurityPrompt,
    selectedContexts,
    aiSkillContextOptions,
    selectedCommandId,
    selectedCommandRef,
    filesUiMode,
    fileSessions,
    selectedLeftFileSessionId,
    selectedRightFileSessionId,
    selectedLeftFileSession,
    selectedRightFileSession,
    fileTransferTasks,
    transferTaskGroups,
    transferTaskCount,
    transferOverallPercent,
    snippetGroups,
    quickCommands,
    selectedSnippetGroupUuid,
    snippetSearchQuery,
    filteredQuickCommands,
    currentSnippetGroupName,
    isMacroRecording,
    recordedCommands,
    macroCurrentLineBuffer,
    macroTerminalId,
    macroRecordControlKeys,
    macroSleepThresholdMs,
    macroLimitReason,
    knowledgeTree,
    kbExpandedKeys,
    kbSelectedKeys,
    kbSearchQuery,
    kbClipboard,
    kbImportJobs,
    kbUsedBytes,
    kbTotalBytes,
    filteredKnowledgeTree,
    kbCapacityPercent,
    extensionSearchQuery,
    extensionPlugins,
    filteredExtensionPlugins,
    selectedExtensionId,
    selectedExtension,
    selectedExtensionInstallProgress,
    extensionDetailTab,
    extensionNotice,
    extensionInstallLoadingMap,
    extensionUpdateLoadingMap,
    extensionInstallProgressMap,
    extensionDragActive,
    extensionInstallingPackageName,
    aliasCommands,
    aliasSearchQuery,
    filteredAliasCommands,
    k8sContexts,
    k8sClusters,
    k8sBastions,
    k8sNamespaces,
    k8sResources,
    k8sConnectingClusterIds,
    k8sSyncingBastionIds,
    k8sDeleteConfirmClusterId,
    k8sDeleteConfirmCluster,
    k8sClusterActionMenuId,
    k8sImportContexts,
    k8sActiveClusterId,
    k8sSearchQuery,
    k8sConfigTab,
    k8sSelectedClusterId,
    k8sClusterNotice,
    k8sTerminalTabs,
    k8sActiveTerminalId,
    k8sAddModalOpen,
    k8sEditModalOpen,
    k8sEditingClusterId,
    k8sAddMode,
    k8sTestResult,
    k8sCollapsedBastionIds,
    k8sResourceKind,
    k8sResourceNamespace,
    k8sResourceQuery,
    k8sResourceOutput,
    k8sResourceOutputTitle,
    k8sResourceLoading,
    k8sCopiedCommand,
    k8sProxyConfig,
    k8sProxyConfigOpen,
    activeSettingsSection,
    editorSettings,
    terminalSettings,
    sshProxyConfigs,
    sshProxyConfigModalOpen,
    sshProxyAddModalOpen,
    sshProxyForm,
    sshAgentKeys,
    sshAgentConfigModalOpen,
    sshAgentSelectedKey,
    sshAgentKeyChainOptions,
    settingModelOptions,
    addModelSwitch,
    modelProviders,
    modelCheckState,
    aiPreferences,
    extensionSettings,
    keywordHighlightSettings,
    keywordHighlightEditorOpen,
    keywordHighlightEditorContent,
    keywordHighlightEditorError,
    keywordHighlightEditorLastSaved,
    keywordHighlightConfigPath,
    securitySettings,
    securityConfigEditorOpen,
    securityConfigEditorContent,
    securityConfigEditorError,
    securityConfigEditorLastSaved,
    securityConfigPath,
    mcpConfigEditorOpen,
    mcpConfigEditorContent,
    mcpConfigEditorError,
    mcpConfigEditorLastSaved,
    mcpConfigPath,
    privacySettings,
    billingSettings,
    aboutSettings,
    userProfile,
    userNotice,
    userAccountCenterOpen,
    userContactCodeCountdown,
    userContactCodeSending,
    userLoginTab,
    userLoginLoading,
    userLoginCodeCountdown,
    userLoginCodeSending,
    isUserSubscriptionActive,
    canEditUserMobile,
    canEditUserEmail,
    canResetUserPassword,
    mcpServers,
    expandedMcpServerNames,
    activeMcpServerTab,
    settingsSkills,
    skillsUserPath,
    skillModal,
    settingsRules,
    settingsShortcuts,
    shortcutRecording,
    trustedDevices,
    trustedDeviceModal,
    settingsNotice,
    workspacePreferences,
    k8sHasContexts,
    k8sActiveContext,
    k8sSelectedCluster,
    k8sActiveCluster,
    filteredK8sClusters,
    localK8sClusters,
    filteredK8sBastions,
    k8sActiveTerminal,
    k8sResourceCluster,
    k8sActiveNamespaces,
    filteredK8sResources,
    k8sResourceSummary,
    onboardingCompletedCount,
    onboardingActiveSteps,
    onboardingActiveStep,
    todoItems,
    todoProgress,
    hydrateConfig,
    saveConfig,
    setSettingsNotice,
    setActiveSettingsSection,
    openOnboardingGuide,
    startOnboardingTour,
    stopOnboardingTour,
    nextOnboardingStep,
    previousOnboardingStep,
    jumpOnboardingStep,
    resetOnboarding,
    selectTheme,
    selectBackground,
    updateBackgroundTuning,
    updateDefaultLayout,
    updateLanguage,
    updateWatermark,
    updateEditorSettings,
    updateTerminalSettings,
    openSshProxyConfig,
    closeSshProxyConfig,
    openAddSshProxyConfig,
    closeAddSshProxyConfig,
    updateSshProxyForm,
    saveSshProxyForm,
    removeSshProxyConfig,
    openSshAgentConfig,
    closeSshAgentConfig,
    setSshAgentSelectedKey,
    addSshAgentKey,
    removeSshAgentKey,
    updateWorkspacePreferences,
    updateModelOption,
    removeModelOption,
    toggleAddModelSwitch,
    updateModelProviderConfig,
    checkModelProvider,
    saveModelProvider,
    updateAiPreferences,
    updateExtensionSettings,
    openKeywordHighlightEditor,
    closeKeywordHighlightEditor,
    updateKeywordHighlightEditorContent,
    saveKeywordHighlightEditor,
    resetKeywordHighlightEditor,
    openSecurityConfigEditor,
    closeSecurityConfigEditor,
    updateSecurityConfigEditorContent,
    saveSecurityConfigEditor,
    resetSecurityConfigEditor,
    openMcpConfigEditor,
    closeMcpConfigEditor,
    updateMcpConfigEditorContent,
    saveMcpConfigEditor,
    updatePrivacySettings,
    updateBillingSettings,
    setUserNotice,
    openAccountCenter,
    closeAccountCenter,
    openUserLogin,
    setUserLoginTab,
    loginUser,
    logoutUser,
    skipUserLogin,
    sendUserLoginCode,
    loginWithAccount,
    loginWithEmail,
    loginWithMobile,
    updateUserProfile,
    resetUserPassword,
    sendUserContactCode,
    bindUserContact,
    checkAboutUpdate,
    checkTopUpdate,
    handleTopUpdateClick,
    openSettingsExternalAction,
    openSkillsFolder,
    reloadSkills,
    toggleMcpServerExpanded,
    setMcpServerTab,
    toggleMcpServerDisabled,
    deleteMcpServer,
    toggleMcpTool,
    openSkillModal,
    closeSkillModal,
    saveSkillModal,
    toggleSkillEnabled,
    deleteSkill,
    importSkillZip,
    exportSkillZip,
    addSettingsRule,
    editSettingsRule,
    updateSettingsRuleDraft,
    saveSettingsRule,
    cancelSettingsRuleEdit,
    toggleSettingsRule,
    deleteSettingsRule,
    startShortcutRecording,
    updateShortcutRecording,
    saveShortcutRecording,
    cancelShortcutRecording,
    resetAllShortcuts,
    openTrustedDeviceRevoke,
    confirmTrustedDeviceRevoke,
    toggleMode,
    setActiveModule,
    setFilesUiMode,
    selectFileSession,
    openFileSession,
    closeFileSession,
    addRemoteFileSession,
    addRemoteFileSessionFromSftpPayload,
    pushFileTransferTask,
    cancelFileTransferTask,
    createSnippetGroup,
    renameSnippetGroup,
    deleteSnippetGroup,
    createQuickCommand,
    updateQuickCommand,
    deleteQuickCommand,
    reorderQuickCommand,
    runQuickCommand,
    startMacroRecording,
    recordMacroCommand,
    recordMacroTerminalInput,
    setMacroRecordControlKeys,
    setMacroSleepThreshold,
    stopMacroRecording,
    cancelMacroRecording,
    refreshKnowledgeTree,
    findKnowledgeNode,
    selectKnowledgeNode,
    openKnowledgeFile,
    createKnowledgeNode,
    renameKnowledgeNode,
    deleteKnowledgeNodes,
    copyKnowledgeNodes,
    pasteKnowledgeNodes,
    addKnowledgeImportJob,
    addKnowledgeFilesToChat,
    selectExtension,
    setExtensionDragActive,
    installExtensionPlugin,
    updateExtensionPlugin,
    uninstallExtensionPlugin,
    subscribeExtensionPlugin,
    cancelExtensionInstall,
    dropExtensionPackage,
    createAliasCommand,
    startAliasEdit,
    updateAliasDraft,
    saveAliasCommand,
    cancelAliasEdit,
    deleteAliasCommand,
    switchK8sContext,
    reloadK8sConfig,
    clearK8sSearch,
    selectK8sCluster,
    setK8sActionMenu,
    openK8sProxyConfig,
    closeK8sProxyConfig,
    updateK8sProxyConfig,
    saveK8sProxyConfig,
    connectK8sCluster,
    disconnectK8sCluster,
    openK8sTerminal,
    closeK8sTerminalTab,
    setActiveK8sTerminal,
    sendK8sTerminalCommand,
    setK8sResourceKind,
    setK8sResourceNamespace,
    refreshK8sResources,
    describeK8sResource,
    showK8sPodLogs,
    copyK8sResourceCommand,
    copyK8sResourceOutput,
    clearK8sResourceOutput,
    sendK8sCurrentOutputToTerminal,
    sendK8sCurrentOutputToAi,
    sendK8sResourceCommand,
    testK8sClusterConnection,
    selectK8sImportContext,
    addK8sCluster,
    updateK8sCluster,
    requestDeleteK8sCluster,
    cancelDeleteK8sCluster,
    confirmDeleteK8sCluster,
    deleteK8sCluster,
    syncK8sBastion,
    toggleK8sBastionCollapsed,
    toggleLeft,
    toggleRight,
    createPanel,
    registerMockSshSession,
    canForkSshPanel,
    forkSshPanel,
    closePanel,
    closeOthers,
    closeAllPanels,
    closePanels,
    renamePanel,
    appendTerminalOutput,
    appendTerminalInput,
    replaceTerminalOutput,
    getHighlightedTerminalOutput,
    executeTerminalCommand,
    executeGlobalTerminalCommand,
    approveTerminalSecurityPrompt,
    cancelTerminalSecurityPrompt,
    stageActiveTerminalCommand,
    appendActiveTerminalInput,
    sendChat,
    resendUserMessageFromParts,
    createConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation,
    toggleContext,
    removeContext,
    applyCommandPreset,
    selectCommandPreset,
    setMessageFeedback,
    toggleMessageFavorite,
    retryAssistantMessage,
    retryLastAssistantMessage,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill
  }
})
