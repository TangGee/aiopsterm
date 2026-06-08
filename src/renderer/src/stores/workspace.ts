import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { validateCommandSecurity, type CommandSecurityResult } from '@/services/commandSecurityRuntime'
import { applyEditorSettingsToDocument } from '@/services/editorRuntime'
import { applyKeywordHighlight } from '@/services/keywordHighlightRuntime'
import { shortcutRuntime, type ShortcutActionHandler } from '@/services/shortcutRuntime'
import { addSystemThemeListener, applyThemeToDocument, isThemeId, type ThemeId } from '@/services/themeRuntime'
import type { AiopstermDeepLinkPayload } from '@shared/deepLink'
import { createDefaultOnboardingCompleted, onboardingTourSteps } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { OnboardingModuleId } from '@/config/onboarding'
import type { SettingSectionKey } from '@/config/settings'
import type {
  AppUpdateCheckResult,
  AppUpdateProgressEvent,
  AiContextCatalog,
  AiContextOption,
  AiPreferencesUserConfig,
  AiChatConversationRecord,
  AiChatExchangeRequestInput,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatResponseInput,
  AiTodoItem,
  AiModelCatalog,
  AiModelCatalogOption,
  AiopsPreloadApi,
  AliasCommandConfig,
  AliasCommandSaveInput,
  AiopsTrustedDevice,
  AiopsUserAccountSnapshot,
  AiopsUserMutationResult,
  AiopsUserProfile,
  EditorUserConfig,
  ExtensionInstallProgress as BackendExtensionInstallProgress,
  ExtensionInstallStage,
  ExtensionPluginRuntimeConfig,
  ExtensionUserConfig,
  FileSessionCatalog,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionPatch,
  FileSessionTerminalContext,
  FileTransferTask,
  FileTransferTaskRecordInput,
  KeywordHighlightRuleConfig,
  KeywordHighlightUserConfig,
  KnowledgeBaseEntry,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeNode,
  KnowledgeNodeType,
  KubernetesBastionGroup,
  KubernetesCatalog,
  KubernetesClusterRecord,
  KubernetesClusterTestInput,
  KubernetesConnectionStatus,
  KubernetesContextInfo,
  KubernetesImportContextInfo,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceKind,
  KubernetesTerminalRecord,
  KubernetesTerminalStatus,
  McpServerUserConfig,
  McpToolStatesUserConfig,
  McpConfigFile,
  ModelProviderCheckKey,
  ModelOptionUserConfig,
  ModelSettingsUserConfig,
  PrivacyUserConfig,
  QuickCommandGroupConfig,
  QuickCommandSnippetConfig,
  QuickCommandsUserConfig,
  SecurityUserConfig,
  SettingsPreferencesSnapshot,
  ShortcutUserConfig,
  SkillUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  SshProxyType,
  TerminalCommandGenerationContext,
  TerminalCommandGenerationRecord,
  TerminalSessionInfo,
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
type SnippetGroup = QuickCommandGroupConfig
type QuickCommandSnippet = QuickCommandSnippetConfig
type AliasCommand = AliasCommandConfig & { edit?: boolean }
type KnowledgeBridgeApi = Pick<AiopsPreloadApi, 'kbEnsureRoot' | 'kbListDir'>
type ModelProviderKey = ModelProviderCheckKey
type TopUpdateState = 'idle' | 'checking' | 'local' | 'available'
type AiChatHistoryHost = NonNullable<AiChatHistoryMessage['hosts']>[number]
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

type K8sContextInfo = KubernetesContextInfo
type K8sCluster = KubernetesClusterRecord
type K8sBastionGroup = KubernetesBastionGroup
type K8sImportContextInfo = KubernetesImportContextInfo
type K8sNamespaceInfo = KubernetesNamespaceInfo
type K8sResource = KubernetesResource
type K8sResourceKind = KubernetesResourceKind
type K8sConnectionStatus = KubernetesConnectionStatus
type K8sProxyConfig = {
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'
  host: string
  port: number
  enableProxyIdentity: boolean
  username: string
  password: string
}
type K8sTerminalStatus = KubernetesTerminalStatus
type K8sTerminalTab = {
  id: string
  sessionId: string
  clusterId: string
  name: string
  namespace: string
  isActive: boolean
  output: string
  status: K8sTerminalStatus
  cols: number
  rows: number
  createdAt: string
  updatedAt: string
  exitCode: number | null
  commandHistory: string[]
  lastCommand: string
  lastCommandOutput: string
  collectingAiOutput: boolean
  aiCommandTabId: string | null
}
type K8sAgentRunRecord = {
  id: string
  command: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  output: string
  error?: string
  clusterId: string | null
  contextName: string | null
  namespace: string
  startedAt: string
  durationMs: number
}
type ExtensionPlugin = ExtensionPluginRuntimeConfig

type MacroCommandEntry = {
  command: string
  timestamp: number
}

const getKnowledgeBridge = (): KnowledgeBridgeApi | null => {
  const api = window.aiops as unknown as Partial<Record<keyof KnowledgeBridgeApi, unknown>> | undefined
  if (typeof api?.kbEnsureRoot !== 'function' || typeof api?.kbListDir !== 'function') return null
  return api as KnowledgeBridgeApi
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
  | { status: 'allow'; execution?: TerminalSecurityExecution }
  | { status: 'blocked'; result: CommandSecurityResult }
  | { status: 'needs-approval'; prompt: NonNullable<TerminalSecurityPrompt> }
  | { status: 'unavailable'; command: string; panelIds: string[]; reason: string }

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
    startLine?: number
    endLine?: number
    jumpToken?: number
  }
  sshSession?: TerminalSshSession
}

export type TerminalSshSession = {
  connectionId?: string
  sourcePanelId?: string
  forkFromConnectionId?: string
  host: string
  port: number
  username: string
  assetId?: string
  assetName: string
  assetType?: string
  organizationId?: string
  authType?: string
  createdAt?: number
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
  ask?: 'command' | 'mcp_tool_call' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  followupOptions?: string[]
  selectedOption?: string
  partial?: boolean
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

type K8sKubeconfigImportResult = {
  success: boolean
  contexts: K8sImportContextInfo[]
  kubeconfigContent: string
  currentContext: string
  error?: string
}

export type TodoItem = AiTodoItem

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

type AiModelOption = AiModelCatalogOption

const defaultAiModelCatalog: AiModelCatalog = {
  chatModels: [],
  lockedChatModels: [],
  settingsModels: []
}

type SshProxyForm = SshProxyConfig

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
    .filter((rule) => !rule.isDraft && rule.content.trim())
    .map((rule) => ({
      id: rule.id,
      content: rule.content.trim(),
      enabled: rule.enabled !== undefined ? rule.enabled : true
    }))

type SettingsShortcut = ShortcutUserConfig
type SettingsRule = UserRuleConfig & { isEditing?: boolean; isDraft?: boolean }
type SettingsSkill = SkillUserConfig
type SettingsMcpServer = McpServerUserConfig

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
  updateStatus: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error'
  newVersion: string
  progress: number
}

const createEmptyUserProfile = (): AiopsUserProfile => ({
  uid: 0,
  name: '',
  username: '',
  avatarInitials: 'AI',
  avatarImageUrl: '',
  registrationType: 'personal',
  registrationCode: 9,
  authProvider: 'local',
  subscription: 'free',
  subscriptionExpiresAt: '',
  email: '',
  mobile: '',
  localIp: '',
  macAddress: '',
  isOfficeDevice: false,
  needDeviceVerification: false,
  skippedLogin: true,
  localDatabaseReady: false,
  lastLoginMethod: 'skip',
  lastLoginAt: '',
  passwordUpdatedAt: '',
  avatarUpdatedAt: ''
})

const defaultConfig: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.15,
    brightness: 0.45,
    lastCustomImage: ''
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
    options: []
  },
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

const ONBOARDING_VERSION = 2
const onboardingModuleIds: OnboardingModuleId[] = ['interfaceGuide', 'systemSettings', 'addAndConnectHost', 'aiChat']
const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`
const normalizeThemeId = (theme: string): ThemeId => (isThemeId(theme) ? theme : 'dark')
const stripYamlScalar = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withoutComment = trimmed.replace(/\s+#.*$/, '').trim()
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"')) || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1)
  }
  return withoutComment
}
const yamlValueAfter = (line: string, key: string) => {
  const match = line.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`))
  return match ? stripYamlScalar(match[1]) : ''
}
const parseKubeconfigContexts = (content: string): K8sKubeconfigImportResult => {
  const lines = content.split(/\r?\n/)
  const currentContext = lines.map((line) => yamlValueAfter(line, 'current-context')).find(Boolean) || ''
  const clusters = new Map<string, string>()
  const contexts: K8sImportContextInfo[] = []
  let section: 'clusters' | 'contexts' | '' = ''
  let clusterName = ''
  let contextName = ''
  let contextCluster = ''
  let contextNamespace = ''

  const flushContext = () => {
    if (!contextName || !contextCluster) return
    contexts.push({
      name: contextName,
      cluster: contextCluster,
      server: clusters.get(contextCluster) || '',
      namespace: contextNamespace || 'default'
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    if (/^\s*clusters\s*:\s*$/.test(line)) {
      flushContext()
      section = 'clusters'
      clusterName = ''
      contextName = ''
      contextCluster = ''
      contextNamespace = ''
      continue
    }
    if (/^\s*contexts\s*:\s*$/.test(line)) {
      flushContext()
      section = 'contexts'
      clusterName = ''
      contextName = ''
      contextCluster = ''
      contextNamespace = ''
      continue
    }
    if (/^\s*(users|preferences|apiVersion|kind)\s*:/.test(line)) {
      if (section === 'contexts') flushContext()
      section = ''
      clusterName = ''
      contextName = ''
      contextCluster = ''
      contextNamespace = ''
      continue
    }
    if (section === 'clusters') {
      const listName = line.match(/^\s*-\s+name\s*:\s*(.+)$/)
      if (listName) {
        clusterName = stripYamlScalar(listName[1])
        if (!clusters.has(clusterName)) clusters.set(clusterName, '')
        continue
      }
      const server = yamlValueAfter(line, 'server')
      if (clusterName && server) clusters.set(clusterName, server)
      continue
    }
    if (section === 'contexts') {
      const listName = line.match(/^\s*-\s+name\s*:\s*(.+)$/)
      if (listName) {
        flushContext()
        contextName = stripYamlScalar(listName[1])
        contextCluster = ''
        contextNamespace = ''
        continue
      }
      const cluster = yamlValueAfter(line, 'cluster')
      if (contextName && cluster) {
        contextCluster = cluster
        continue
      }
      const namespace = yamlValueAfter(line, 'namespace')
      if (contextName && namespace) contextNamespace = namespace
    }
  }
  if (section === 'contexts') flushContext()

  const uniqueContexts = contexts.filter((context, index, list) => list.findIndex((item) => item.name === context.name) === index)
  return {
    success: uniqueContexts.length > 0,
    contexts: uniqueContexts,
    kubeconfigContent: content,
    currentContext,
    error: uniqueContexts.length > 0 ? undefined : '未在 kubeconfig 中发现 contexts'
  }
}
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
const k8sTerminalTabFromRecord = (record: KubernetesTerminalRecord): K8sTerminalTab => ({
  id: record.id,
  sessionId: record.sessionId,
  clusterId: record.clusterId,
  name: record.name,
  namespace: record.namespace,
  isActive: false,
  output: record.output,
  status: record.status,
  cols: record.cols,
  rows: record.rows,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  exitCode: null,
  commandHistory: [],
  lastCommand: '',
  lastCommandOutput: '',
  collectingAiOutput: false,
  aiCommandTabId: null
})
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
  groups: [],
  snippets: []
}

const defaultKnowledgeBase: KnowledgeBaseUserConfig = {
  tree: [],
  usedBytes: defaultConfig.knowledgeBase!.usedBytes,
  totalBytes: defaultConfig.knowledgeBase!.totalBytes
}

const defaultAliasCommands: AliasCommandConfig[] = []

const defaultShortcuts: ShortcutUserConfig[] = []
const shortcutDefaultsById = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))
const shortcutModifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const defaultRules: UserRuleConfig[] = []
const defaultSkills: SkillUserConfig[] = []
const defaultMcpServers: McpServerUserConfig[] = []
const defaultMcpToolStates: McpToolStatesUserConfig = {}
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

const normalizeModelSettingsOptions = (source: unknown, fallback: ModelOptionUserConfig[] = []) => {
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
    if (!name || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const locked = Boolean(item.locked)
    const type = stringFromOptions(item.type, modelOptionTypes, locked ? 'standard' : 'custom')
    const option: ModelOptionUserConfig = {
      name,
      locked,
      checked: item.checked !== undefined ? Boolean(item.checked) : true,
      type,
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

  return {
    normalized: options,
    changed
  }
}

const normalizeAiModelOption = (source: unknown): AiModelOption | null => {
  if (!isRecord(source)) return null
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const label = typeof source.label === 'string' && source.label.trim() ? source.label.trim() : id
  if (!id || !label) return null
  const locked = Boolean(source.locked)
  return {
    id,
    label,
    detail: typeof source.detail === 'string' ? source.detail.trim() : '',
    checked: source.checked !== undefined ? Boolean(source.checked) : true,
    locked,
    tier: typeof source.tier === 'string' ? source.tier.trim() : undefined,
    type: stringFromOptions(source.type, modelOptionTypes, locked ? 'standard' : 'standard'),
    apiProvider: typeof source.apiProvider === 'string' && source.apiProvider.trim() ? source.apiProvider.trim() : 'default'
  }
}

const normalizeAiModelCatalog = (source?: Partial<AiModelCatalog> | null): AiModelCatalog => {
  const incoming = isRecord(source) ? source : {}
  const chatModels = (Array.isArray(incoming.chatModels) ? incoming.chatModels : defaultAiModelCatalog.chatModels)
    .map(normalizeAiModelOption)
    .filter((model): model is AiModelOption => Boolean(model))
  const lockedChatModels = (Array.isArray(incoming.lockedChatModels) ? incoming.lockedChatModels : defaultAiModelCatalog.lockedChatModels)
    .map(normalizeAiModelOption)
    .filter((model): model is AiModelOption => Boolean(model))
    .map((model) => ({ ...model, locked: true }))
  const settingsModels = normalizeModelSettingsOptions(
    Array.isArray(incoming.settingsModels) ? incoming.settingsModels : defaultAiModelCatalog.settingsModels,
    defaultAiModelCatalog.settingsModels
  ).normalized
  return { chatModels, lockedChatModels, settingsModels }
}

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

const normalizeSshAgentKeychainOptions = (source?: unknown): SshAgentKeychainOption[] => {
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

  const { normalized: options, changed: optionsChanged } = normalizeModelSettingsOptions(incoming.options, defaultModelSettingsConfig.options)
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

const normalizeUserModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'mock' || provider === 'local') return 'local'
  if (provider === 'litellm' || provider === 'openai-compatible' || provider === 'ollama' || provider === 'bedrock' || provider === 'deepseek' || provider === 'anthropic') return provider
  return defaultConfig.modelProvider
}

const normalizeUserModelName = (value: unknown) => {
  const modelName = String(value || '').trim()
  if (!modelName || modelName === 'mock-ops-agent' || modelName === 'ops-local-agent' || modelName === 'aiopsterm-local-agent') return defaultConfig.modelName
  return modelName
}

const mergeUserConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
  ...base,
  ...patch,
  modelProvider: normalizeUserModelProvider(patch.modelProvider || base.modelProvider),
  modelName: normalizeUserModelName(patch.modelName || base.modelName),
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

const settingsDocumentationUrl = 'https://aiopsterm.local/docs'
const settingsFeedbackUrl = 'https://aiopsterm.local/feedback'

const resolveUpdateVersion = (result?: AppUpdateCheckResult | null) =>
  result?.updateInfo?.version || result?.versionInfo?.version || (result?.isUpdateAvailable || result?.available ? '0.1.1' : '')

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

const createEmptyTerminalPanel = (
  id: string,
  title: string,
  split?: PanelDirection
): TerminalPanel => ({
  id,
  title,
  cwd: '~',
  kind: 'terminal',
  output: '',
  outputSegments: [],
  status: 'ready',
  ...(split ? { split } : {})
})

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
  const themeListenerCleanup = ref<(() => void) | null>(null)
  const workspacePreferences = ref<WorkspaceUserConfig>({
    ...defaultWorkspacePreferences,
    expandedGroups: [...defaultWorkspacePreferences.expandedGroups]
  })
  const activePanelId = ref('panel-main')
  const panels = ref<TerminalPanel[]>([
    createEmptyTerminalPanel('panel-main', 'local shell')
  ])

  const applyCurrentTheme = () => {
    applyThemeToDocument(config.value.theme)
  }

  const applyCurrentEditorSettings = () => {
    applyEditorSettingsToDocument(editorSettings.value)
  }

  const shortcutHandlers: Record<string, ShortcutActionHandler> = {
    newTerminal: () => triggerShortcutAction('newTerminal'),
    toggleAi: () => triggerShortcutAction('toggleAi'),
    switchToSpecificTab: (payload) => triggerShortcutAction('switchToSpecificTab', payload?.digit),
    quickCommand: () => triggerShortcutAction('quickCommand')
  }

  const refreshShortcutRuntime = () => {
    shortcutRuntime.update(getShortcutsSnapshot(), shortcutHandlers)
  }

  const setupThemeBridge = () => {
    if (themeListenerCleanup.value) return
    themeListenerCleanup.value = addSystemThemeListener(() => {
      if (config.value.theme === 'auto') applyCurrentTheme()
    })
  }
  const selectedConversationId = ref('')
  const conversations = ref<ConversationItem[]>([])
  const aiContextCatalog = ref<AiContextCatalog>({
    categories: [],
    openedHosts: [],
    selectedDefaults: []
  })
  const selectedContexts = ref<AiContextOption[]>([])

  const registerSshSession = (
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
      host: asset.host,
      port: Number(asset.port) || 22,
      username: asset.username || 'root',
      assetId: asset.id,
      assetName: title,
      assetType: asset.asset_type,
      organizationId: asset.group_name,
      authType: asset.auth_type
    }
    panel.kind = 'terminal'
    panel.sshSession = session
    return session
  }

  const applySshTerminalSession = (
    panelId: string,
    terminalSession?: TerminalSessionInfo | null,
    asset?: {
      id?: string
      name?: string
      title?: string
      host?: string
      port?: number
      username?: string
      group_name?: string
      asset_type?: string
      auth_type?: string
    }
  ) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || !terminalSession) return null
    panel.sessionId = terminalSession.id
    panel.cwd = terminalSession.cwd || panel.cwd
    panel.kind = 'terminal'
    panel.status = 'running'
    if (terminalSession.kind !== 'ssh' || !terminalSession.connection) return null
    const connection = terminalSession.connection
    const previous = panel.sshSession
    const session: TerminalSshSession = {
      connectionId: connection.connectionId,
      sourcePanelId: previous?.sourcePanelId,
      forkFromConnectionId: connection.forkFromConnectionId || previous?.forkFromConnectionId,
      host: connection.host || asset?.host || previous?.host || '',
      port: Number(connection.port || asset?.port || previous?.port || 22),
      username: connection.username || asset?.username || previous?.username || 'root',
      assetId: connection.assetId || asset?.id || previous?.assetId,
      assetName: connection.assetName || asset?.name || asset?.title || previous?.assetName || connection.host || 'ssh',
      assetType: connection.assetType || asset?.asset_type || previous?.assetType,
      organizationId: connection.organizationId || asset?.group_name || previous?.organizationId,
      authType: connection.authType || asset?.auth_type || previous?.authType,
      createdAt: connection.createdAt
    }
    panel.sshSession = session
    return session
  }

  const terminalShellTitle = (shell: string) => shell.replace(/\\/g, '/').split('/').filter(Boolean).pop() || shell || 'local shell'

  const applyLocalTerminalSession = (panelId: string, terminalSession?: TerminalSessionInfo | null) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || !terminalSession?.id) return null
    panel.sessionId = terminalSession.id
    panel.cwd = terminalSession.cwd || panel.cwd
    panel.title = terminalShellTitle(terminalSession.shell)
    panel.kind = 'terminal'
    panel.status = 'running'
    panel.sshSession = undefined
    return panel
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
  const fileSessions = ref<FileSessionInfo[]>([])
  const fileSessionFolders = ref<FileSessionFolderRecord[]>([])
  const selectedLeftFileSessionId = ref<string | null>(null)
  const selectedRightFileSessionId = ref<string | null>('local')
  const fileTransferTasks = ref<FileTransferTask[]>([])
  const snippetGroups = ref<SnippetGroup[]>([])
  const quickCommands = ref<QuickCommandSnippet[]>([])
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
  const knowledgeTree = ref<KnowledgeNode[]>([])
  const kbExpandedKeys = ref<string[]>(['commands', 'images'])
  const kbSelectedKeys = ref<string[]>([])
  const kbSearchQuery = ref('')
  const kbContentSearchResults = ref<KnowledgeBaseSearchResult[]>([])
  const kbSearchStatus = ref<KnowledgeBaseSearchStatus>({ totalFiles: 0, totalChunks: 0, provider: 'aiopsterm-local', model: 'lexical', updatedAt: 0 })
  const kbSearchLoading = ref(false)
  const kbSearchError = ref('')
  const kbClipboard = ref<KbClipboard>(null)
  const kbImportJobs = ref<Array<{ id: string; destRelPath: string; percent: number }>>([])
  const kbUsedBytes = ref(0)
  const kbTotalBytes = ref(1024 * 1024 * 1024)
  const extensionSearchQuery = ref('')
  const extensionPlugins = ref<ExtensionPlugin[]>([])
  const selectedExtensionId = ref<string>('jumpserverSupport')
  const extensionDetailTab = ref<'details' | 'features'>('details')
  const extensionNotice = ref('')
  const extensionInstallLoadingMap = ref<Record<string, boolean>>({})
  const extensionUpdateLoadingMap = ref<Record<string, boolean>>({})
  const extensionInstallProgressMap = ref<Record<string, ExtensionInstallProgress>>({})
  const extensionDragActive = ref(false)
  const extensionInstallingPackageName = ref('')
  const aliasCommands = ref<AliasCommand[]>([])
  const aliasEditSnapshot = ref<AliasCommand | null>(null)
  const aliasSearchQuery = ref('')
  const k8sContexts = ref<K8sContextInfo[]>([])
  const k8sClusters = ref<K8sCluster[]>([])
  const k8sBastions = ref<K8sBastionGroup[]>([])
  const k8sNamespaces = ref<K8sNamespaceInfo[]>([])
  const k8sResources = ref<K8sResource[]>([])
  const k8sConnectingClusterIds = ref<string[]>([])
  const k8sSyncingBastionIds = ref<string[]>([])
  const k8sDeleteConfirmClusterId = ref<string | null>(null)
  const k8sClusterActionMenuId = ref<string | null>(null)
  const k8sImportContexts = ref<K8sImportContextInfo[]>([])
  const k8sActiveClusterId = ref<string | null>(null)
  const k8sSearchQuery = ref('')
  const k8sConfigTab = ref<'local' | 'jumpserver'>('local')
  const k8sSelectedClusterId = ref<string | null>(null)
  const k8sClusterNotice = ref('')
  const k8sTerminalTabs = ref<K8sTerminalTab[]>([])
  const k8sActiveTerminalId = ref<string | null>(null)
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
  const k8sAgentClusterId = ref<string | null>(null)
  const k8sAgentContextName = ref('')
  const k8sAgentStatus = ref<'idle' | 'ready' | 'running' | 'error'>('idle')
  const k8sAgentCommandDraft = ref('kubectl get pods -A')
  const k8sAgentCommandHistory = ref<string[]>(['kubectl get pods -A', 'kubectl get namespaces', 'kubectl version --request-timeout=10s'])
  const k8sAgentRuns = ref<K8sAgentRunRecord[]>([])
  const k8sAgentLastResult = ref<K8sAgentRunRecord | null>(null)
  const k8sAgentTesting = ref(false)
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
  const sshAgentKeyChainOptions = ref<SshAgentKeychainOption[]>([])
  const aiModelOptions = ref<AiModelOption[]>([])
  const lockedAiModelOptions = ref<AiModelOption[]>([])
  const settingModelOptions = ref<SettingsModelOption[]>([])
  const addModelSwitch = ref(true)
  const modelProviders = ref<Record<ModelProviderKey, ModelProviderSettings>>({
    litellm: { ...defaultModelProviders.litellm },
    openai: { ...defaultModelProviders.openai },
    bedrock: { ...defaultModelProviders.bedrock },
    deepseek: { ...defaultModelProviders.deepseek },
    anthropic: { ...defaultModelProviders.anthropic },
    ollama: { ...defaultModelProviders.ollama }
  })
  const modelCheckState = ref<Record<ModelProviderKey, 'idle' | 'checking' | 'success' | 'error'>>({
    litellm: 'idle',
    openai: 'idle',
    bedrock: 'idle',
    deepseek: 'idle',
    anthropic: 'idle',
    ollama: 'idle'
  })
  const modelCheckRequestSeq = ref<Record<ModelProviderKey, number>>({
    litellm: 0,
    openai: 0,
    bedrock: 0,
    deepseek: 0,
    anthropic: 0,
    ollama: 0
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
  const userProfile = ref<AiopsUserProfile>(createEmptyUserProfile())
  const userNotice = ref('')
  const mcpServers = ref<SettingsMcpServer[]>([])
  const expandedMcpServerNames = ref<string[]>([])
  const activeMcpServerTab = ref<Record<string, 'tools' | 'resources'>>({})
  const settingsSkills = ref<SettingsSkill[]>([])
  const skillsUserPath = ref('~/.config/aiopsterm/skills')
  const skillModal = ref<{ mode: 'create' | 'edit' | null; name: string; description: string; content: string }>({
    mode: null,
    name: '',
    description: '',
    content: ''
  })
  const settingsRules = ref<SettingsRule[]>([])
  const settingsShortcuts = ref<SettingsShortcut[]>([])
  const shortcutRecording = ref<{ actionId: string | null; tempShortcut: string }>({ actionId: null, tempShortcut: '' })
  const trustedDevices = ref<AiopsTrustedDevice[]>([])
  const trustedDeviceModal = ref<{ open: boolean; id: number | null }>({ open: false, id: null })
  const settingsNotice = ref('')
  const setSettingsNoticeText = (text: string) => {
    settingsNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (settingsNotice.value === text) settingsNotice.value = ''
    }, 2400)
  }
  const todoItems = ref<TodoItem[]>([])
  const chatMessages = ref<ChatMessage[]>([])
  const terminalSecurityPrompt = ref<TerminalSecurityPrompt>(null)
  const terminalCommandGenerationRecords = ref<TerminalCommandGenerationRecord[]>([])
  let keywordHighlightSaveTimer: number | null = null
  let removeKeywordHighlightConfigFileListener: (() => void) | null = null
  let keywordHighlightLoadRequest = 0
  let securityConfigSaveTimer: number | null = null
  let removeSecurityConfigFileListener: (() => void) | null = null
  let securityConfigLoadRequest = 0
  let mcpConfigSaveTimer: number | null = null
  let removeMcpConfigFileListener: (() => void) | null = null
  let mcpConfigLoadRequest = 0
  let kbSearchRequest = 0
  let removeSkillsUpdateListener: (() => void) | null = null
  let removeKnowledgeProgressListener: (() => void) | null = null
  let removeExtensionInstallProgressListener: (() => void) | null = null
  let aiModelCatalogLoadPromise: Promise<AiModelCatalog> | null = null
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

  const cloneConversationRecord = (conversation: AiChatConversationRecord): ConversationItem => ({
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    updatedAt: conversation.updatedAt,
    ts: conversation.ts,
    ipAddress: conversation.ipAddress,
    favorite: conversation.favorite
  })

  const applyChatHistorySnapshot = (snapshot: { conversations: AiChatConversationRecord[]; selectedConversationId: string }) => {
    conversations.value = snapshot.conversations.map(cloneConversationRecord)
    selectedConversationId.value = conversations.value.some((conversation) => conversation.id === snapshot.selectedConversationId)
      ? snapshot.selectedConversationId
      : conversations.value[0]?.id || ''
  }

  const historyHostToContext = (host: AiChatHistoryHost): AiContextOption => ({
    id: host.id,
    kind: 'hosts',
    label: host.label,
    detail: host.detail
  })

  const chatHistoryMessageToChatMessage = (message: AiChatHistoryMessage): ChatMessage => ({
    id: message.id,
    role: message.role,
    text: message.text,
    hosts: message.hosts?.map(historyHostToContext),
    state: message.state,
    favorite: message.favorite,
    feedback: message.feedback
  })

  const chatMessageToHistoryMessage = (message: ChatMessage): AiChatHistoryMessage | null => {
    const text = message.text.trim()
    if (!text) return null
    const hosts = message.hosts
      ?.filter((host) => host.kind === 'hosts' && host.label.trim())
      .map((host): AiChatHistoryHost => ({
        id: host.id,
        kind: 'hosts',
        label: host.label,
        detail: host.detail
      }))
    return {
      id: message.id,
      role: message.role,
      text,
      hosts: hosts?.length ? hosts : undefined,
      state: message.state,
      favorite: message.favorite,
      feedback: message.feedback
    }
  }

  const currentChatHistoryMessages = () => chatMessages.value.map(chatMessageToHistoryMessage).filter(Boolean) as AiChatHistoryMessage[]

  const restoreChatMessagesFromBackend = async (id: string) => {
    if (!window.aiops?.restoreChatConversation) return false
    const result = await window.aiops.restoreChatConversation(id)
    if (!result?.ok || !result.data) return false
    const existing = conversations.value.find((conversation) => conversation.id === result.data!.conversation.id)
    const nextConversation = cloneConversationRecord(result.data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    chatMessages.value = result.data.messages.map(chatHistoryMessageToChatMessage)
    return true
  }

  const loadChatConversationsFromBackend = async (options: { restoreIfEmpty?: boolean } = {}) => {
    if (!window.aiops?.listChatConversations) return false
    const result = await window.aiops.listChatConversations()
    if (!result?.ok || !result.data) return false
    applyChatHistorySnapshot(result.data)
    if (options.restoreIfEmpty !== false && chatMessages.value.length === 0 && selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    }
    return true
  }

  const refreshAiContextCatalog = async (options: { hydrateSelection?: boolean } = {}) => {
    if (!window.aiops?.listAiContextCatalog) return false
    const result = await window.aiops.listAiContextCatalog()
    if (!result?.ok || !result.data) return false
    aiContextCatalog.value = {
      categories: result.data.categories.map((category) => ({
        ...category,
        options: category.options.map((option) => ({ ...option }))
      })),
      openedHosts: result.data.openedHosts.map((host) => ({ ...host })),
      selectedDefaults: result.data.selectedDefaults.map((context) => ({ ...context }))
    }
    if (options.hydrateSelection !== false && selectedContexts.value.length === 0) {
      selectedContexts.value = aiContextCatalog.value.selectedDefaults.map((context) => ({ ...context }))
    }
    return true
  }

  const refreshAiTodoSnapshot = async () => {
    if (!window.aiops?.listAiTodoSnapshot) {
      todoItems.value = []
      return false
    }
    const result = await window.aiops.listAiTodoSnapshot()
    if (!result?.ok || !result.data) {
      todoItems.value = []
      return false
    }
    todoItems.value = result.data.todos.map((todo) => ({
      ...todo,
      subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
    }))
    return true
  }

  const updateCurrentConversationSnapshot = async (summary?: string, options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) => {
    if (!window.aiops?.updateChatConversation) {
      if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
      return false
    }
    let id = selectedConversationId.value
    if (!id || !conversations.value.some((conversation) => conversation.id === id)) {
      if (!window.aiops.createChatConversation) {
        if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
        return false
      }
      const created = await window.aiops.createChatConversation()
      if (!created?.ok || !created.data) {
        if (options.notifyFailure) setTopNotice(created?.errorMessage || '会话历史写入失败')
        return false
      }
      applyChatHistorySnapshot({
        conversations: created.data.conversations,
        selectedConversationId: created.data.selectedConversationId
      })
      id = created.data.conversation.id
    }
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const result = await window.aiops.updateChatConversation({
      id,
      title: conversation.title,
      summary: summary || conversation.summary,
      favorite: conversation.favorite,
      messages: currentChatHistoryMessages()
    })
    if (!result?.ok || !result.data) {
      if (options.notifyFailure) setTopNotice(result?.errorMessage || '会话历史写入失败')
      return false
    }
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

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
  const terminalCommandModelOptions = computed(() =>
    settingModelOptions.value.filter((model) => model.checked && !model.locked && !model.name.endsWith('-Thinking')).map((model) => model.name)
  )
  const applyAiModelCatalog = (catalog: AiModelCatalog, options: { replaceSettingsOptions?: boolean } = {}) => {
    aiModelOptions.value = catalog.chatModels.map((model) => ({ ...model }))
    lockedAiModelOptions.value = catalog.lockedChatModels.map((model) => ({ ...model, locked: true }))
    if (options.replaceSettingsOptions) {
      settingModelOptions.value = catalog.settingsModels.map((model) => ({
        name: model.name,
        locked: model.locked,
        checked: model.checked,
        type: model.type,
        apiProvider: model.apiProvider
      }))
    }
    return catalog
  }
  const refreshAiModelCatalog = async (options: { replaceSettingsOptions?: boolean } = {}) => {
    if (!window.aiops?.listAiModels) {
      return applyAiModelCatalog(defaultAiModelCatalog, {
        replaceSettingsOptions: options.replaceSettingsOptions ?? settingModelOptions.value.length === 0
      })
    }
    aiModelCatalogLoadPromise ||= window.aiops
      .listAiModels()
      .then((catalog) => normalizeAiModelCatalog(catalog))
      .finally(() => {
        aiModelCatalogLoadPromise = null
      })
    try {
      const catalog = await aiModelCatalogLoadPromise
      return applyAiModelCatalog(catalog, {
        replaceSettingsOptions: options.replaceSettingsOptions ?? settingModelOptions.value.length === 0
      })
    } catch (error) {
      setSettingsNoticeText(`模型列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return applyAiModelCatalog(defaultAiModelCatalog, {
        replaceSettingsOptions: options.replaceSettingsOptions ?? settingModelOptions.value.length === 0
      })
    }
  }
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
  const kbContentSearchVisible = computed(() => kbSearchQuery.value.trim().length > 1)
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
  const k8sAgentCluster = computed(() => (k8sAgentClusterId.value ? k8sClusters.value.find((cluster) => cluster.id === k8sAgentClusterId.value) || null : null))
  const k8sAgentCurrentCluster = computed(() => ({
    clusterId: k8sAgentCluster.value?.id || null,
    contextName: k8sAgentCluster.value?.context_name || k8sAgentContextName.value || null
  }))
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

  const refreshSshAgentKeychainOptions = async () => {
    if (!window.aiops?.listSshAgentKeychainOptions) {
      sshAgentKeyChainOptions.value = []
      return false
    }
    try {
      const options = await window.aiops.listSshAgentKeychainOptions()
      sshAgentKeyChainOptions.value = normalizeSshAgentKeychainOptions(options)
      return true
    } catch {
      sshAgentKeyChainOptions.value = []
      setSettingsNotice('SSH Agent 密钥列表加载失败')
      return false
    }
  }

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
    const savedModelSettings: Record<string, unknown> = isRecord(savedConfig.modelSettings) ? savedConfig.modelSettings : {}
    const missingModelSettings = !isRecord(savedConfig.modelSettings)
    const missingModelOptions = !Array.isArray(savedModelSettings.options)
    const modelProviderChanged = normalizeUserModelProvider(savedConfig.modelProvider) !== savedConfig.modelProvider
    const modelNameChanged = normalizeUserModelName(savedConfig.modelName) !== savedConfig.modelName
    const missingQuickCommands = !isRecord(savedConfig.quickCommands)
    const missingKnowledgeBase = !isRecord(savedConfig.knowledgeBase)
    const missingAliasCommands = !Array.isArray(savedConfig.aliasCommands)
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
    await refreshSshAgentKeychainOptions()
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
    const modelCatalog = await refreshAiModelCatalog({ replaceSettingsOptions: false })
    const modelSettingsSource =
      missingModelSettings || missingModelOptions
        ? {
            ...savedModelSettings,
            options: modelCatalog.settingsModels
          }
        : savedConfig.modelSettings
    const { normalized: normalizedModelSettings, changed: modelSettingsChanged } = normalizeModelSettingsConfig(modelSettingsSource)
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
    const bridgeQuickCommands = window.aiops.getQuickCommands ? await window.aiops.getQuickCommands() : savedConfig.quickCommands
    const { normalized: normalizedQuickCommands, changed: quickCommandsChanged } = normalizeQuickCommandsConfig(bridgeQuickCommands)
    snippetGroups.value = normalizedQuickCommands.groups.map((group) => ({ ...group }))
    quickCommands.value = normalizedQuickCommands.snippets.map((snippet) => ({ ...snippet }))
    const {
      normalized: savedKnowledgeBaseSnapshot,
      changed: savedKnowledgeBaseChanged
    } = normalizeKnowledgeBaseConfig(savedConfig.knowledgeBase)
    let normalizedKnowledgeBase = savedKnowledgeBaseSnapshot
    let knowledgeBaseChanged = savedKnowledgeBaseChanged
    const knowledgeBridge = getKnowledgeBridge()
    if (knowledgeBridge) {
      try {
        await knowledgeBridge.kbEnsureRoot()
        const bridgeKnowledgeTree = await loadKnowledgeTreeFromBridge('')
        const bridgeKnowledgeBase: KnowledgeBaseUserConfig = {
          tree: cloneKnowledgeNodes(bridgeKnowledgeTree),
          usedBytes: knowledgeTreeSize(bridgeKnowledgeTree),
          totalBytes: savedKnowledgeBaseSnapshot.totalBytes
        }
        normalizedKnowledgeBase = bridgeKnowledgeBase
      } catch {
        setTopNotice('知识库加载失败')
      }
    }
    knowledgeTree.value = cloneKnowledgeNodes(normalizedKnowledgeBase.tree)
    kbUsedBytes.value = normalizedKnowledgeBase.usedBytes
    kbTotalBytes.value = normalizedKnowledgeBase.totalBytes
    let bridgeAliasCommands = savedConfig.aliasCommands || defaultAliasCommands
    try {
      bridgeAliasCommands = await loadAliasCommandsFromBackend(bridgeAliasCommands)
    } catch {
      setExtensionNotice('Alias 加载失败')
    }
    const { normalized: normalizedAliasCommands, changed: aliasCommandsChanged } = normalizeAliasCommandsConfig(bridgeAliasCommands)
    aliasCommands.value = normalizedAliasCommands.map((alias) => ({ ...alias, edit: false }))
    let bridgeSettingsPreferences: SettingsPreferencesSnapshot = {
      shortcuts: normalizeShortcutsConfig(savedConfig.shortcuts).normalized,
      rules: normalizeRulesConfig(savedConfig.rules, savedConfig.customInstructions).normalized
    }
    try {
      const result = await window.aiops.getSettingsPreferences?.({
        shortcuts: savedConfig.shortcuts,
        rules: savedConfig.rules,
        customInstructions: savedConfig.customInstructions
      })
      if (result?.ok && result.data) {
        bridgeSettingsPreferences = result.data
      } else if (result && !result.ok) {
        setSettingsNotice(result.errorMessage || '设置偏好加载失败')
      }
    } catch {
      setSettingsNotice('设置偏好加载失败')
    }
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(bridgeSettingsPreferences.shortcuts)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    const { normalized: normalizedRules } = normalizeRulesConfig(bridgeSettingsPreferences.rules)
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    const savedSkillsSnapshot = normalizeSkillsConfig(savedConfig.skills)
    const bridgeSkills = await readSkillsSnapshotFromBridge()
    const {
      normalized: normalizedSkills,
      changed: rawSkillsChanged
    } = normalizeSkillsConfig(bridgeSkills || savedConfig.skills)
    const skillsChanged = bridgeSkills ? savedSkillsSnapshot.changed : rawSkillsChanged
    settingsSkills.value = normalizedSkills.map((skill) => ({ ...skill }))
    const savedMcpSnapshot = normalizeMcpServersConfig(savedConfig.mcpServers, savedConfig.mcpToolStates)
    applyMcpServersSnapshot({
      normalized: savedMcpSnapshot.normalized,
      toolStates: savedMcpSnapshot.toolStates,
      changed: savedMcpSnapshot.changed
    })
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
      customInstructions: '',
      mcpServers: savedMcpSnapshot.normalized,
      mcpToolStates: savedMcpSnapshot.toolStates,
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
      modelProviderChanged ||
      modelNameChanged ||
      modelSettingsChanged ||
      missingModelSettings ||
      quickCommandsChanged ||
      missingQuickCommands ||
      knowledgeBaseChanged ||
      missingKnowledgeBase ||
      aliasCommandsChanged ||
      missingAliasCommands ||
      skillsChanged ||
      missingSkills ||
      savedMcpSnapshot.changed ||
      missingMcpServers
    ) {
      config.value = mergeUserConfig(
        config.value,
        await window.aiops.saveConfig({
          modelProvider: config.value.modelProvider,
          modelName: config.value.modelName,
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
          skills: normalizedSkills,
          customInstructions: '',
          mcpServers: savedMcpSnapshot.normalized,
          mcpToolStates: savedMcpSnapshot.toolStates,
          onboarding: normalized
        })
      )
    }
    mode.value = config.value.defaultMode
    leftPanelOpen.value = config.value.leftPanelOpen
    rightPanelOpen.value = config.value.rightPanelOpen
    config.value.theme = normalizeThemeId(config.value.theme)
    applyCurrentTheme()
    applyCurrentEditorSettings()
    refreshShortcutRuntime()
    setupThemeBridge()
    await refreshUserAccount()
    await refreshExtensionPlugins()
    setupKnowledgeBridgeListeners()
    await refreshKnowledgeTree({ persist: false })
    await refreshFileSessionCatalog()
    await refreshFileTransferTasks()
    await refreshKubernetesCatalog()
    await loadChatConversationsFromBackend({ restoreIfEmpty: true })
    await refreshAiTodoSnapshot()
    await refreshAiContextCatalog({ hydrateSelection: true })
  }

  const saveConfig = async (patch: Partial<UserConfig>) => {
    const normalizedPatch = patch.theme ? { ...patch, theme: normalizeThemeId(patch.theme) } : patch
    config.value = mergeUserConfig(config.value, normalizedPatch)
    config.value.theme = normalizeThemeId(config.value.theme)
    applyCurrentTheme()
    setupThemeBridge()
    if (window.aiops) {
      config.value = mergeUserConfig(config.value, await window.aiops.saveConfig(normalizedPatch))
    }
    config.value.theme = normalizeThemeId(config.value.theme)
    editorSettings.value = normalizeEditorSettingsConfig(config.value.editorSettings).normalized
    applyCurrentTheme()
    applyCurrentEditorSettings()
    refreshShortcutRuntime()
    setupThemeBridge()
  }

  const getQuickCommandsSnapshot = (): QuickCommandsUserConfig => ({
    groups: snippetGroups.value.map((group) => ({ ...group })),
    snippets: quickCommands.value.map((snippet) => ({ ...snippet }))
  })

  const applyQuickCommandsSnapshot = (snapshot: QuickCommandsUserConfig) => {
    const normalized = normalizeQuickCommandsConfig(snapshot).normalized
    snippetGroups.value = normalized.groups.map((group) => ({ ...group }))
    quickCommands.value = normalized.snippets.map((snippet) => ({ ...snippet }))
    config.value = mergeUserConfig(config.value, { quickCommands: normalized })
    return normalized
  }

  const refreshQuickCommands = async () => {
    const snapshot = window.aiops?.getQuickCommands ? await window.aiops.getQuickCommands() : config.value.quickCommands || defaultQuickCommands
    return applyQuickCommandsSnapshot(snapshot)
  }

  const persistQuickCommands = async () => {
    const snapshot = getQuickCommandsSnapshot()
    if (window.aiops?.saveQuickCommands) {
      const result = await window.aiops.saveQuickCommands(snapshot)
      if (!result?.ok || !result.data) throw new Error(result?.errorMessage || '快捷命令保存失败')
      applyQuickCommandsSnapshot(result.data)
      await saveConfig({ quickCommands: result.data })
      return result.data
    }
    await saveConfig({ quickCommands: snapshot })
    return snapshot
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
    const knowledgeBridge = getKnowledgeBridge()
    if (!knowledgeBridge) return cloneKnowledgeNodes(knowledgeTree.value)
    const entries = await knowledgeBridge.kbListDir(relDir)
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
    const knowledgeBridge = getKnowledgeBridge()
    if (!knowledgeBridge) return
    await knowledgeBridge.kbEnsureRoot()
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

  const applyAliasCommandsFromBackend = (commands: AliasCommandConfig[]) => {
    const { normalized } = normalizeAliasCommandsConfig(commands)
    aliasCommands.value = normalized.map((alias) => ({ ...alias, edit: false }))
    config.value = mergeUserConfig(config.value, { aliasCommands: normalized })
    return normalized
  }

  const loadAliasCommandsFromBackend = async (fallback: AliasCommandConfig[]) => {
    if (!window.aiops?.listAliasCommands) return fallback
    const result = await window.aiops.listAliasCommands()
    if (!result?.ok || !result.data) throw new Error(result?.errorMessage || 'Alias 加载失败')
    return result.data
  }

  const refreshAliasCommands = async () => {
    try {
      const commands = await loadAliasCommandsFromBackend(defaultAliasCommands)
      const normalized = applyAliasCommandsFromBackend(commands)
      await saveConfig({ aliasCommands: normalized })
      return true
    } catch {
      setExtensionNotice('Alias 加载失败')
      return false
    }
  }

  const syncAliasConfigFromBackend = async (commands: AliasCommandConfig[]) => {
    applyAliasCommandsFromBackend(commands)
    await saveConfig({ aliasCommands: getAliasCommandsSnapshot() })
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

  const applySettingsPreferencesSnapshot = (snapshot: SettingsPreferencesSnapshot) => {
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(snapshot.shortcuts)
    const { normalized: normalizedRules } = normalizeRulesConfig(snapshot.rules)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    config.value = mergeUserConfig(config.value, {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules,
      customInstructions: ''
    })
    refreshShortcutRuntime()
    return {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules
    }
  }

  const getSkillsSnapshot = (): SkillUserConfig[] => cloneSkillConfig(settingsSkills.value)

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

  const readSkillsSnapshotFromBridge = async () => {
    if (!window.aiops?.getSkills) return false
    try {
      installSkillsUpdateListener()
      const [path, skills] = await Promise.all([
        window.aiops.getSkillsUserPath ? window.aiops.getSkillsUserPath() : Promise.resolve(skillsUserPath.value),
        window.aiops.getSkills()
      ])
      skillsUserPath.value = path
      return skills
    } catch {
      setSettingsNotice('Skills 加载失败')
      return null
    }
  }

  const loadSkillsFromBridge = async () => {
    const skills = await readSkillsSnapshotFromBridge()
    if (!skills) return false
    try {
      applySkillsList(skills)
      return true
    } catch {
      setSettingsNotice('Skills 加载失败')
      return false
    }
  }

  const refreshSkillsFromBridge = () => loadSkillsFromBridge()

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

  const readMcpServersSnapshotFromBridge = async (currentServers: McpServerUserConfig[], currentToolStates: McpToolStatesUserConfig) => {
    if (window.aiops?.getMcpServers) {
      try {
        return normalizeMcpServersConfig(await window.aiops.getMcpServers())
      } catch {
        setSettingsNotice('MCP 配置加载失败')
        return null
      }
    }
    if (!window.aiops?.readMcpConfig) return null
    try {
      const content = await window.aiops.readMcpConfig()
      const editorContent = content.trim() ? content : JSON.stringify({ mcpServers: {} }, null, 2)
      const parsed = normalizeMcpConfigFile(parseMcpEditorContent(editorContent))
      return normalizeMcpServersConfig(mcpConfigFileToServers(parsed, currentServers), currentToolStates)
    } catch {
      setSettingsNotice('MCP 配置加载失败')
      return null
    }
  }

  const applyMcpServersSnapshot = (snapshot: ReturnType<typeof normalizeMcpServersConfig>) => {
    mcpServers.value = snapshot.normalized.map((server) => ({
      ...server,
      tools: server.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter })) })),
      resources: server.resources.map((resource) => ({ ...resource }))
    }))
    const expandedNames = expandedMcpServerNames.value.filter((name) => mcpServers.value.some((server) => server.name === name))
    expandedMcpServerNames.value = expandedNames.length || !mcpServers.value[0] ? expandedNames : [mcpServers.value[0].name]
    config.value = mergeUserConfig(config.value, {
      mcpServers: snapshot.normalized,
      mcpToolStates: snapshot.toolStates
    })
  }

  const refreshMcpServersFromBridge = async () => {
    const { servers, toolStates } = getMcpSnapshot()
    const snapshot = await readMcpServersSnapshotFromBridge(servers, toolStates)
    if (!snapshot) return false
    applyMcpServersSnapshot(snapshot)
    return true
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
    setSettingsNoticeText(text)
  }

  const closeSettingsInlineEditors = () => {
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
  }

  const openSettingsDocumentation = async () => {
    closeSettingsInlineEditors()
    activeSettingsSection.value = 'general'
    try {
      await window.aiops?.openExternalUrl?.(settingsDocumentationUrl)
      setSettingsNotice('已打开文档')
      return true
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const setActiveSettingsSection = (key: SettingSectionKey) => {
    if (key === 'docs') {
      void openSettingsDocumentation()
      return
    }
    closeSettingsInlineEditors()
    activeSettingsSection.value = key
    if (key === 'skills') {
      void loadSkillsFromBridge()
    } else if (key === 'mcp') {
      void refreshMcpServersFromBridge()
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
    saveConfig({ theme: normalizeThemeId(theme) })
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

  const uploadCustomBackground = async () => {
    try {
      const result = await window.aiops?.showOpenDialog?.({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return false
      const saved = await window.aiops?.saveCustomBackground?.(result.filePaths[0])
      if (!saved?.url) {
        setSettingsNotice('自定义背景保存失败')
        return false
      }
      await saveConfig({
        background: {
          ...config.value.background,
          mode: 'custom',
          image: saved.url,
          lastCustomImage: saved.url
        }
      })
      setSettingsNotice(`自定义背景已保存：${saved.name}`)
      return true
    } catch (error) {
      setSettingsNotice(`自定义背景保存失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const selectCustomBackground = () => {
    const customImage = config.value.background.lastCustomImage || (config.value.background.mode === 'custom' ? config.value.background.image : '')
    if (!customImage) {
      setSettingsNotice('请先上传自定义背景')
      return false
    }
    saveConfig({
      background: {
        ...config.value.background,
        mode: 'custom',
        image: customImage,
        lastCustomImage: customImage
      }
    })
    return true
  }

  const clearCustomBackground = () => {
    const wasSelected = config.value.background.mode === 'custom'
    saveConfig({
      background: {
        ...config.value.background,
        mode: wasSelected ? 'none' : config.value.background.mode,
        image: wasSelected ? '' : config.value.background.image,
        lastCustomImage: ''
      }
    })
    setSettingsNotice('自定义背景已清除')
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
    applyCurrentEditorSettings()
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
    void refreshSshAgentKeychainOptions()
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

  const checkModelProvider = async (provider: ModelProviderKey) => {
    const requestSeq = (modelCheckRequestSeq.value[provider] || 0) + 1
    modelCheckRequestSeq.value = { ...modelCheckRequestSeq.value, [provider]: requestSeq }
    modelCheckState.value = { ...modelCheckState.value, [provider]: 'checking' }
    const config = { ...modelProviders.value[provider] }
    try {
      const result = await window.aiops.checkModelProvider({ provider, config })
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      if (result.ok) {
        modelCheckState.value = { ...modelCheckState.value, [provider]: 'success' }
        setSettingsNotice(result.data?.message || `${provider} Check 成功`)
      } else {
        modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
        setSettingsNotice(result.errorMessage || `${provider} Check 失败`)
      }
    } catch (error) {
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
      setSettingsNotice(`模型 Provider 检查失败：${error instanceof Error ? error.message : String(error)}`)
    }
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

  const clearUserCodeTimer = (timers: Partial<Record<'email' | 'mobile', number>>, kind: 'email' | 'mobile') => {
    if (!timers[kind]) return
    window.clearInterval(timers[kind])
    delete timers[kind]
  }

  const resetUserCodeState = (target: 'login' | 'contact', kind?: 'email' | 'mobile') => {
    const kinds: Array<'email' | 'mobile'> = kind ? [kind] : ['email', 'mobile']
    kinds.forEach((item) => {
      if (target === 'login') {
        userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, [item]: 0 }
        userLoginCodeSending.value = { ...userLoginCodeSending.value, [item]: false }
        clearUserCodeTimer(userLoginCodeTimers, item)
      } else {
        userContactCodeCountdown.value = { ...userContactCodeCountdown.value, [item]: 0 }
        userContactCodeSending.value = { ...userContactCodeSending.value, [item]: false }
        clearUserCodeTimer(userContactCodeTimers, item)
      }
    })
  }

  const isUserSubscriptionActive = computed(() => {
    const profile = userProfile.value
    if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
    return new Date(profile.subscriptionExpiresAt) > new Date()
  })

  const canEditUserMobile = computed(() => userProfile.value.registrationCode !== 7)
  const canEditUserEmail = computed(() => ![2, 3, 4, 6].includes(userProfile.value.registrationCode))
  const canResetUserPassword = computed(() => userProfile.value.registrationCode !== 1 && userProfile.value.authProvider !== 'sso')

  const applyUserAccountSnapshot = (snapshot: AiopsUserAccountSnapshot) => {
    userProfile.value = { ...snapshot.profile }
    trustedDevices.value = snapshot.trustedDevices.map((device) => ({ ...device }))
    billingSettings.value = {
      ...billingSettings.value,
      skippedLogin: snapshot.profile.skippedLogin || snapshot.profile.lastLoginMethod === 'skip',
      email: snapshot.profile.email || billingSettings.value.email,
      subscription: snapshot.profile.subscription,
      subscriptionExpiresAt: snapshot.profile.subscriptionExpiresAt
    }
  }

  const applyUserMutationResult = (result: AiopsUserMutationResult | undefined) => {
    if (result?.data) applyUserAccountSnapshot(result.data)
    if (!result?.ok) {
      setUserNotice(result?.errorMessage || '用户操作失败')
      userLoginLoading.value = false
      return false
    }
    setUserNotice(result.data?.message || '用户操作已完成')
    userLoginLoading.value = false
    return true
  }

  const refreshUserAccount = async () => {
    if (!window.aiops?.getUserAccount) return false
    try {
      const result = await window.aiops.getUserAccount()
      if (!result?.ok || !result.data) {
        setUserNotice(result?.errorMessage || '用户信息加载失败')
        return false
      }
      applyUserAccountSnapshot(result.data)
      return true
    } catch (error) {
      setUserNotice(error instanceof Error ? error.message : '用户信息加载失败')
      return false
    }
  }

  const startUserCountdown = (
    target: 'login' | 'contact',
    kind: 'email' | 'mobile',
    countdownSeconds: number,
    message: string,
    delayMs = 120
  ) => {
    const sendingRef = target === 'login' ? userLoginCodeSending : userContactCodeSending
    const countdownRef = target === 'login' ? userLoginCodeCountdown : userContactCodeCountdown
    const timers = target === 'login' ? userLoginCodeTimers : userContactCodeTimers
    window.setTimeout(() => {
      sendingRef.value = { ...sendingRef.value, [kind]: false }
      countdownRef.value = { ...countdownRef.value, [kind]: countdownSeconds }
      clearUserCodeTimer(timers, kind)
      timers[kind] = window.setInterval(() => {
        const next = Math.max(0, countdownRef.value[kind] - 1)
        countdownRef.value = { ...countdownRef.value, [kind]: next }
        if (next === 0) clearUserCodeTimer(timers, kind)
      }, 1000)
      setUserNotice(message)
    }, delayMs)
  }

  const openAccountCenter = () => {
    userAccountCenterOpen.value = true
    setUserNotice('账号中心已打开')
  }

  const closeAccountCenter = () => {
    userAccountCenterOpen.value = false
  }

  const openUserLogin = async () => {
    activeModule.value = 'user'
    userLoginTab.value = 'account'
    resetUserCodeState('login')
    if (!window.aiops?.openUserLogin) {
      setUserNotice('登录服务不可用')
      return false
    }
    return applyUserMutationResult(await window.aiops.openUserLogin())
  }

  const setUserLoginTab = (tab: UserLoginTab) => {
    userLoginTab.value = tab
  }

  const loginUser = async () => {
    const result = await window.aiops?.loginUserAccount?.({ method: 'account', username: userProfile.value.username || 'local_ops', password: 'local' })
    return applyUserMutationResult(result || { ok: false, errorMessage: '用户登录 API 不可用' })
  }

  const logoutUser = async () => {
    userAccountCenterOpen.value = false
    resetUserCodeState('login')
    resetUserCodeState('contact')
    if (!window.aiops?.logoutUserAccount) {
      setUserNotice('登出服务不可用')
      return false
    }
    return applyUserMutationResult(await window.aiops.logoutUserAccount())
  }

  const skipUserLogin = async () => {
    const result = await window.aiops?.skipUserLogin?.()
    return applyUserMutationResult(result || { ok: false, errorMessage: '跳过登录 API 不可用' })
  }

  const sendUserLoginCode = async (kind: 'email' | 'mobile', value: string) => {
    if (userLoginCodeCountdown.value[kind] > 0 || userLoginCodeSending.value[kind]) return false
    userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: true }
    const result = await window.aiops?.sendUserLoginCode?.({ kind, value })
    if (!result?.ok || !result.data) {
      userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: false }
      setUserNotice(result?.errorMessage || '验证码发送失败')
      return false
    }
    startUserCountdown('login', kind, result.data.countdownSeconds, result.data.message)
    return true
  }

  const loginWithAccount = async (username: string, password: string) => {
    userLoginLoading.value = true
    const result = await window.aiops?.loginUserAccount?.({ method: 'account', username, password })
    return applyUserMutationResult(result || { ok: false, errorMessage: '账号登录 API 不可用' })
  }

  const loginWithEmail = async (email: string, code: string) => {
    userLoginLoading.value = true
    const result = await window.aiops?.loginUserAccount?.({ method: 'email', email, code })
    const ok = applyUserMutationResult(result || { ok: false, errorMessage: '邮箱登录 API 不可用' })
    if (ok) resetUserCodeState('login', 'email')
    return ok
  }

  const loginWithMobile = async (mobile: string, code: string) => {
    userLoginLoading.value = true
    const result = await window.aiops?.loginUserAccount?.({ method: 'mobile', mobile, code })
    const ok = applyUserMutationResult(result || { ok: false, errorMessage: '手机号登录 API 不可用' })
    if (ok) resetUserCodeState('login', 'mobile')
    return ok
  }

  const updateUserProfile = async (
    patch: Partial<Pick<AiopsUserProfile, 'name' | 'username' | 'email' | 'mobile' | 'avatarInitials' | 'avatarImageUrl' | 'avatarUpdatedAt'>>
  ) => {
    const result = await window.aiops?.updateUserProfile?.(patch)
    return applyUserMutationResult(result || { ok: false, errorMessage: '用户资料保存 API 不可用' })
  }

  const resetUserPassword = async (password = '') => {
    const result = await window.aiops?.resetUserPassword?.({ password })
    return applyUserMutationResult(result || { ok: false, errorMessage: '密码重置 API 不可用' })
  }

  const sendUserContactCode = async (kind: 'email' | 'mobile', value: string) => {
    if (userContactCodeCountdown.value[kind] > 0 || userContactCodeSending.value[kind]) return false
    userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: true }
    const result = await window.aiops?.sendUserContactCode?.({ kind, value })
    if (!result?.ok || !result.data) {
      userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: false }
      setUserNotice(result?.errorMessage || '验证码发送失败')
      return false
    }
    startUserCountdown('contact', kind, result.data.countdownSeconds, result.data.message)
    return true
  }

  const bindUserContact = async (kind: 'email' | 'mobile', value: string, code = '') => {
    const result = await window.aiops?.bindUserContact?.({ kind, value, code })
    const ok = applyUserMutationResult(result || { ok: false, errorMessage: '联系方式绑定 API 不可用' })
    if (ok) resetUserCodeState('contact', kind)
    return ok
  }

  let removeAppUpdateProgressListener: (() => void) | null = null

  const handleAppUpdateProgress = (event: AppUpdateProgressEvent) => {
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: event.status === 'downloaded' ? 'downloaded' : event.status,
      newVersion: event.version || aboutSettings.value.newVersion,
      progress: Math.max(0, Math.min(100, Math.round(event.percent)))
    }
    if (event.status === 'downloaded') setSettingsNotice('更新已下载，可执行安装')
    if (event.status === 'error') setSettingsNotice(event.message || '更新下载失败')
  }

  const installAppUpdateProgressListener = () => {
    if (removeAppUpdateProgressListener || !window.aiops?.onAppUpdateProgress) return
    removeAppUpdateProgressListener = window.aiops.onAppUpdateProgress(handleAppUpdateProgress)
  }

  const startAboutDownload = async () => {
    installAppUpdateProgressListener()
    const version = aboutSettings.value.newVersion || aboutSettings.value.version
    aboutSettings.value.updateStatus = 'downloading'
    aboutSettings.value.progress = 0
    setSettingsNotice('正在下载更新')
    try {
      const result = await window.aiops?.downloadAppUpdate?.(version)
      if (!result?.ok || !result.data) {
        aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
        setSettingsNotice(result?.errorMessage || '更新下载失败')
        return
      }
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'downloaded',
        newVersion: result.data.version,
        progress: result.data.percent
      }
      setSettingsNotice('更新已下载，可执行安装')
    } catch (error) {
      aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
      setSettingsNotice(error instanceof Error ? error.message : '更新下载失败')
    }
  }

  const checkAboutUpdate = async () => {
    if (aboutSettings.value.updateStatus === 'available') {
      await startAboutDownload()
      return
    }
    if (aboutSettings.value.updateStatus === 'downloaded') {
      try {
        const result = await window.aiops?.installAppUpdate?.(aboutSettings.value.newVersion || aboutSettings.value.version)
        if (!result?.ok || !result.data) {
          aboutSettings.value.updateStatus = 'error'
          setSettingsNotice(result?.errorMessage || '更新安装失败')
          return
        }
        aboutSettings.value.updateStatus = 'latest'
        aboutSettings.value.progress = 100
        aboutSettings.value.version = result.data.version
        aboutSettings.value.newVersion = ''
        setSettingsNotice('更新安装请求已提交')
      } catch (error) {
        aboutSettings.value.updateStatus = 'error'
        setSettingsNotice(error instanceof Error ? error.message : '更新安装失败')
      }
      return
    }
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: 'checking',
      progress: 0
    }
    setSettingsNotice('正在检查更新')
    try {
      const result = await window.aiops?.checkUpdate()
      const detectedVersion = resolveUpdateVersion(result)
      if (result?.available || result?.isUpdateAvailable || result?.updateInfo) {
        aboutSettings.value = {
          ...aboutSettings.value,
          updateStatus: 'available',
          newVersion: detectedVersion || aboutSettings.value.version
        }
        setSettingsNotice(`检测到可用更新 ${aboutSettings.value.newVersion}`)
        return
      }
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'latest',
        newVersion: detectedVersion || aboutSettings.value.version,
        progress: 0
      }
      setSettingsNotice('当前已是最新版本')
    } catch {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice('更新检查失败')
    }
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
        const detectedVersion = resolveUpdateVersion(result)
        if (detectedVersion) aboutSettings.value.newVersion = detectedVersion
        setTopNotice(detectedVersion ? `检测到可用更新 ${detectedVersion}` : '检测到可用更新')
      }
    } catch {
      topUpdateState.value = 'local'
      setTopNotice('更新检查不可用')
    }
  }

  const handleTopUpdateClick = async () => {
    if (topUpdateState.value === 'available') {
      const version = aboutSettings.value.newVersion || aboutSettings.value.version
      topUpdateState.value = 'checking'
      await startAboutDownload()
      if (aboutSettings.value.updateStatus !== 'downloaded') {
        topUpdateState.value = 'available'
        setTopNotice('更新下载失败')
        return
      }
      try {
        const result = await window.aiops?.installAppUpdate?.(version)
        if (!result?.ok || !result.data) {
          topUpdateState.value = 'available'
          setTopNotice(result?.errorMessage || '更新安装失败')
          return
        }
        aboutSettings.value = {
          ...aboutSettings.value,
          updateStatus: 'latest',
          version: result.data.version,
          newVersion: '',
          progress: 100
        }
        topUpdateState.value = 'local'
        setTopNotice('更新安装请求已提交')
      } catch (error) {
        topUpdateState.value = 'available'
        setTopNotice(error instanceof Error ? error.message : '更新安装失败')
      }
      return
    }
    await checkTopUpdate()
  }

  const openSettingsExternalAction = async (label: '日志目录' | '反馈页面' | '账户中心' | string) => {
    try {
      if (label === '日志目录') {
        await window.aiops?.openLogDir?.()
        setSettingsNotice('日志目录已打开')
        return true
      }
      if (label === '反馈页面') {
        await window.aiops?.openExternalUrl?.(settingsFeedbackUrl)
        setSettingsNotice('反馈页面已打开')
        return true
      }
      setSettingsNotice(`已打开 ${label}`)
      return true
    } catch {
      setSettingsNotice(`${label} 打开失败`)
      return false
    }
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
      const { servers, toolStates } = getMcpSnapshot()
      const bridgeSnapshot = await readMcpServersSnapshotFromBridge(servers, toolStates)
      if (bridgeSnapshot) {
        applyMcpServersSnapshot(bridgeSnapshot)
      }
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
    if (!window.aiops?.writeMcpConfig) {
      mcpConfigEditorError.value = 'Save failed: MCP 配置保存服务不可用'
      mcpConfigEditorLastSaved.value = false
      setSettingsNotice('MCP 配置保存服务不可用')
      return false
    }
    try {
      await window.aiops.writeMcpConfig(content)
      mcpConfigEditorContent.value = JSON.stringify(normalized, null, 2)
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        mcpServers.value = mcpConfigFileToServers(normalized, mcpServers.value)
        const { servers, toolStates } = getMcpSnapshot()
        config.value = mergeUserConfig(config.value, { mcpServers: servers, mcpToolStates: toolStates })
      }
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
    if (!server) return false
    if (!window.aiops?.toggleMcpServer) {
      setSettingsNotice('MCP 状态服务不可用')
      return false
    }
    const nextDisabled = !server.disabled
    try {
      await window.aiops.toggleMcpServer(name, nextDisabled)
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        setSettingsNotice(`MCP ${name} 状态更新后刷新失败`)
        return false
      }
    } catch {
      setSettingsNotice(`MCP ${name} 状态更新失败`)
      return false
    }
    setSettingsNotice(`${name} ${nextDisabled ? '已禁用' : '已启用'}`)
    return true
  }

  const deleteMcpServer = async (name: string) => {
    if (!window.aiops?.deleteMcpServer) {
      setSettingsNotice('MCP 删除服务不可用')
      return false
    }
    try {
      await window.aiops.deleteMcpServer(name)
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        setSettingsNotice(`${name} 删除后刷新失败`)
        return false
      }
    } catch {
      setSettingsNotice(`${name} 删除失败`)
      return false
    }
    setSettingsNotice(`${name} 已删除`)
    return true
  }

  const toggleMcpTool = async (serverName: string, toolName: string) => {
    const tool = mcpServers.value.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
    if (!tool) return false
    if (!window.aiops?.setMcpToolState) {
      setSettingsNotice('MCP Tool 状态服务不可用')
      return false
    }
    const nextEnabled = !tool.enabled
    try {
      await window.aiops.setMcpToolState(serverName, toolName, nextEnabled)
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        setSettingsNotice(`${toolName} 状态更新后刷新失败`)
        return false
      }
    } catch {
      setSettingsNotice(`${toolName} 状态更新失败`)
      return false
    }
    setSettingsNotice(`${toolName} ${nextEnabled ? '已启用' : '已禁用'}`)
    return true
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
      if (!window.aiops?.updateSkill) {
        setSettingsNotice('Skill 保存服务不可用')
        return false
      }
      try {
        await window.aiops.updateSkill(name, { name, description }, content)
        await loadSkillsFromBridge()
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
    if (!window.aiops?.createSkill) {
      setSettingsNotice('Skill 创建服务不可用')
      return false
    }
    try {
      const created = await window.aiops.createSkill({ name, description }, content)
      await loadSkillsFromBridge()
      if (created) {
        applySkillsList([created, ...settingsSkills.value.filter((item) => item.name !== created.name)])
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
    if (!window.aiops?.setSkillEnabled) {
      setSettingsNotice('Skill 状态服务不可用')
      return
    }
    const previous = skill.enabled
    skill.enabled = !skill.enabled
    try {
      await window.aiops.setSkillEnabled(name, skill.enabled)
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
    if (!window.aiops?.deleteSkill) {
      setSettingsNotice('Skill 删除服务不可用')
      return
    }
    try {
      await window.aiops.deleteSkill(name)
      await loadSkillsFromBridge()
      setSettingsNotice(`${name} 已删除`)
    } catch {
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
    settingsRules.value.unshift({ id: 'rule-draft-new', content: '', enabled: true, isEditing: true, isDraft: true })
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

  const saveSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    if (!rule.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return false
    }
    try {
      const result = await window.aiops?.saveSettingsRule?.({
        ...(rule.isDraft ? {} : { id }),
        content: rule.content,
        enabled: rule.enabled
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则保存失败')
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice(result.data.message || '规则已保存')
      return true
    } catch {
      setSettingsNotice('规则保存失败')
      return false
    }
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
      rule.isDraft = false
    }
    rule.isEditing = false
  }

  const toggleSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    const nextEnabled = !rule.enabled
    try {
      const result = await window.aiops?.saveSettingsRule?.({
        id,
        content: rule.content,
        enabled: nextEnabled
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则更新失败')
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice(`规则${nextEnabled ? '已启用' : '已禁用'}`)
      return true
    } catch {
      setSettingsNotice('规则更新失败')
      return false
    }
  }

  const deleteSettingsRule = async (id: string) => {
    const existing = settingsRules.value.find((item) => item.id === id)
    if (!existing) return false
    if (!existing.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return true
    }
    try {
      const result = await window.aiops?.deleteSettingsRule?.(id)
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则删除失败')
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice('规则已删除')
      return true
    } catch {
      setSettingsNotice('规则删除失败')
      return false
    }
  }

  const startShortcutRecording = (actionId: string) => {
    shortcutRecording.value = { actionId, tempShortcut: '' }
    shortcutRuntime.setRecording(true)
  }

  const updateShortcutRecording = (shortcut: string) => {
    shortcutRecording.value.tempShortcut = shortcut
  }

  const saveShortcutRecording = async () => {
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
    try {
      const result = await window.aiops?.saveSettingsShortcut?.({
        id: actionId,
        shortcut: nextShortcut
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '快捷键保存失败')
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      shortcutRuntime.setRecording(false)
      setSettingsNotice(result.data.message || '快捷键已保存')
      return true
    } catch {
      setSettingsNotice('快捷键保存失败')
      return false
    }
  }

  const cancelShortcutRecording = () => {
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
    shortcutRuntime.setRecording(false)
  }

  const resetAllShortcuts = async () => {
    try {
      const result = await window.aiops?.resetSettingsShortcuts?.()
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '快捷键重置失败')
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      shortcutRuntime.setRecording(false)
      setSettingsNotice(result.data.message || '快捷键已全部重置')
      return true
    } catch {
      setSettingsNotice('快捷键重置失败')
      return false
    }
  }

  const installShortcutRuntime = () => {
    shortcutRuntime.install(getShortcutsSnapshot(), shortcutHandlers)
  }

  const uninstallShortcutRuntime = () => {
    shortcutRuntime.destroy()
  }

  const switchToTerminalPanelIndex = (digit: number) => {
    const index = Math.max(1, Math.min(9, Math.floor(digit))) - 1
    const terminalPanels = panels.value.filter((panel) => panel.kind !== 'knowledge')
    const target = terminalPanels[index]
    if (!target) return false
    mode.value = 'terminal'
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    return true
  }

  const triggerShortcutAction = (actionId: string, digit?: number) => {
    if (actionId === 'newTerminal') {
      mode.value = 'terminal'
      activeModule.value = 'workspace'
      createPanel()
      setTopNotice('已通过快捷键新建终端')
      return true
    }
    if (actionId === 'toggleAi') {
      mode.value = 'terminal'
      if (activeModule.value === 'database' || activeModule.value === 'user') activeModule.value = 'workspace'
      toggleRight()
      setTopNotice(`AI 侧栏已${rightPanelOpen.value ? '打开' : '关闭'}`)
      return true
    }
    if (actionId === 'switchToSpecificTab' && digit) {
      return switchToTerminalPanelIndex(digit)
    }
    if (actionId === 'quickCommand') {
      mode.value = 'terminal'
      activeModule.value = 'snippets'
      leftPanelOpen.value = true
      setTopNotice('已打开快捷命令')
      return true
    }
    return false
  }

  const openTrustedDeviceRevoke = (id: number) => {
    const device = trustedDevices.value.find((item) => item.id === id)
    if (!device || device.current) return
    trustedDeviceModal.value = { open: true, id }
  }

  const confirmTrustedDeviceRevoke = async () => {
    const id = trustedDeviceModal.value.id
    if (id === null) return false
    const result = await window.aiops?.revokeTrustedDevice?.(id)
    if (!result?.ok || !result.data) {
      setSettingsNotice(result?.errorMessage || '可信设备移除失败')
      setUserNotice(result?.errorMessage || '可信设备移除失败')
      return false
    }
    trustedDevices.value = result.data.trustedDevices.map((device) => ({ ...device }))
    trustedDeviceModal.value = { open: false, id: null }
    setSettingsNotice(result.data.message)
    setUserNotice(result.data.message)
    return true
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

  const handleDeepLink = (payload: AiopstermDeepLinkPayload) => {
    if (payload.target === 'agents') {
      mode.value = 'agents'
      agentsLeftOpen.value = true
      setTopNotice('已通过 aiopsterm:// 打开 Agents')
      return true
    }

    const targetModule = payload.module || payload.target
    mode.value = 'terminal'
    activeModule.value = targetModule
    if (targetModule === 'settings') {
      rightPanelOpen.value = false
      setActiveSettingsSection(payload.settingsSection || 'general')
    } else if (targetModule === 'database' || targetModule === 'user') {
      rightPanelOpen.value = false
      onboardingGuideOpen.value = false
    } else {
      leftPanelOpen.value = true
      rightPanelOpen.value = config.value.rightPanelOpen
      onboardingGuideOpen.value = false
    }
    setTopNotice(`已通过 aiopsterm:// 打开${targetModule === 'workspace' ? '工作区' : targetModule}`)
    return true
  }

  const setFilesUiMode = (mode: FilesUiMode) => {
    filesUiMode.value = mode
  }

  const normalizeFileTransferTask = (value: unknown): FileTransferTask | null => {
    if (!isRecord(value)) return null
    const type = value.type === 'download' || value.type === 'upload' || value.type === 'r2r' ? value.type : null
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const source = typeof value.source === 'string' ? value.source : ''
    const target = typeof value.target === 'string' ? value.target : ''
    const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : ''
    if (!id || !type || !name || !source || !target) return null
    const status =
      value.status === 'running' || value.status === 'success' || value.status === 'failed' || value.status === 'error'
        ? value.status
        : 'running'
    const progress = typeof value.progress === 'number' && Number.isFinite(value.progress) ? Math.min(100, Math.max(0, Math.round(value.progress))) : 0
    const stage = value.stage === 'scanning' || value.stage === 'pending' ? value.stage : undefined
    const task: FileTransferTask = {
      id,
      type,
      name,
      source,
      target,
      progress,
      speed: typeof value.speed === 'string' && value.speed.trim() ? value.speed : status === 'running' ? 'pending' : '',
      status,
      ...(stage ? { stage } : {}),
      ...(value.isGroup === true ? { isGroup: true } : {}),
      ...(typeof value.fromHost === 'string' && value.fromHost ? { fromHost: value.fromHost } : {}),
      ...(typeof value.toHost === 'string' && value.toHost ? { toHost: value.toHost } : {}),
      ...(typeof value.totalFiles === 'number' && Number.isFinite(value.totalFiles) ? { totalFiles: Math.max(0, Math.round(value.totalFiles)) } : {}),
      ...(typeof value.finishedFiles === 'number' && Number.isFinite(value.finishedFiles)
        ? { finishedFiles: Math.max(0, Math.round(value.finishedFiles)) }
        : {})
    }
    const children = Array.isArray(value.children) ? value.children.map(normalizeFileTransferTask).filter((child): child is FileTransferTask => !!child) : []
    if (children.length) task.children = children
    return task
  }

  const refreshFileTransferTasks = async () => {
    if (!window.aiops?.listFileTransferTasks) {
      fileTransferTasks.value = []
      return false
    }
    try {
      const tasks = await window.aiops.listFileTransferTasks()
      fileTransferTasks.value = Array.isArray(tasks) ? tasks.map(normalizeFileTransferTask).filter((task): task is FileTransferTask => !!task) : []
      return true
    } catch {
      setTopNotice('文件传输任务加载失败')
      return false
    }
  }

  const applyFileSessionCatalog = (catalog: FileSessionCatalog) => {
    fileSessions.value = Array.isArray(catalog.sessions) ? catalog.sessions.map((session) => ({ ...session })) : []
    fileSessionFolders.value = Array.isArray(catalog.folders) ? catalog.folders.map((folder) => ({ ...folder })) : []
    if (!fileSessions.value.some((session) => session.id === selectedLeftFileSessionId.value)) {
      selectedLeftFileSessionId.value = null
    }
    if (!fileSessions.value.some((session) => session.id === selectedRightFileSessionId.value)) {
      selectedRightFileSessionId.value = fileSessions.value.some((session) => session.id === 'local') ? 'local' : fileSessions.value[0]?.id || null
    }
    return catalog
  }

  const refreshFileSessionCatalog = async () => {
    if (!window.aiops?.listFileSessionCatalog) return null
    const result = await window.aiops.listFileSessionCatalog()
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话加载失败')
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const applyFileSessionMutationResult = (result?: { ok?: boolean; data?: FileSessionCatalog; errorMessage?: string }) => {
    if (!result?.ok || !result.data) {
      if (result?.errorMessage) setTopNotice(result.errorMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const persistFileSession = async (session: FileSessionInfo) => {
    if (!window.aiops?.saveFileSession) return null
    return applyFileSessionMutationResult(await window.aiops.saveFileSession({ ...session }))
  }

  const updateFileSession = async (id: string, patch: FileSessionPatch) => {
    const session = fileSessions.value.find((item) => item.id === id)
    if (!session) return null
    if (!window.aiops?.updateFileSession) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    const previous = { ...session }
    Object.assign(session, patch)
    const result = await window.aiops.updateFileSession(id, patch)
    const applied = applyFileSessionMutationResult(result)
    if (!applied) Object.assign(session, previous)
    return result?.ok ? result.data?.session || null : null
  }

  const saveFileSessionFolder = async (folder: FileSessionFolderSaveInput) => {
    const normalized = { ...(folder.uuid ? { uuid: folder.uuid } : {}), name: folder.name.trim(), description: (folder.description || '').trim() }
    if (!normalized.name || !window.aiops?.saveFileSessionFolder) return null
    const result = await window.aiops.saveFileSessionFolder(normalized)
    applyFileSessionMutationResult(result)
    return result?.ok ? result.data?.folder || null : null
  }

  const deleteFileSessionFolder = async (uuid: string) => {
    if (!window.aiops?.deleteFileSessionFolder) return false
    const result = await window.aiops.deleteFileSessionFolder(uuid)
    applyFileSessionMutationResult(result)
    return Boolean(result?.ok)
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

  const fileSideForTerminalPanel = () => {
    if (!selectedLeftFileSessionId.value) return 'left'
    if (!selectedRightFileSessionId.value) return 'right'
    return 'left'
  }

  const fileSessionTerminalContextForPanel = (panel: TerminalPanel): FileSessionTerminalContext => {
    const ssh = panel.sshSession
    const hasSshBackendConnection = Boolean(ssh?.connectionId)
    return {
      kind: ssh ? 'ssh' : 'local',
      panelId: panel.id,
      panelTitle: panel.title,
      panelStatus: panel.status,
      sessionId: ssh && !hasSshBackendConnection ? undefined : panel.sessionId,
      cwd: ssh && !hasSshBackendConnection ? undefined : panel.cwd,
      ...(ssh
        ? {
            ssh: {
              connectionId: ssh.connectionId,
              host: ssh.host,
              port: ssh.port,
              username: ssh.username,
              assetId: ssh.assetId,
              assetName: ssh.assetName,
              assetType: ssh.assetType,
              organizationId: ssh.organizationId,
              authType: ssh.authType,
              createdAt: ssh.createdAt,
              forkFromConnectionId: ssh.forkFromConnectionId
            }
          }
        : {})
    }
  }

  const ensureFileSessionForTerminalPanel = async (panelId = activePanelId.value, side: 'left' | 'right' = fileSideForTerminalPanel()) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || panel.kind === 'knowledge') return null
    if (!window.aiops?.saveFileSessionFromTerminalContext) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    const result = await window.aiops.saveFileSessionFromTerminalContext(fileSessionTerminalContextForPanel(panel))
    if (!result?.ok || !result.data?.session) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }

    applyFileSessionCatalog(result.data)
    const session = result.data.session
    setFilesUiMode('transfer')
    openFileSession(session.id, side)
    setActiveModule('files')
    appendTerminalSegment(panel, `[file manager] opened ${session.label} on ${side} transfer pane\n$ `, 'output')
    return session
  }

  const closeFileSession = (side: 'left' | 'right') => {
    selectFileSession(side, null)
  }

  const addRemoteFileSession = async (assetId: string, side: 'left' | 'right' = 'left') => {
    const known = fileSessions.value.find((item) => item.id === assetId)
    if (known) {
      openFileSession(assetId, side)
      return known
    }
    if (!window.aiops?.saveFileSessionFromTerminalContext) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    const result = await window.aiops.saveFileSessionFromTerminalContext({
      kind: 'ssh',
      panelTitle: assetId,
      panelStatus: 'running',
      ssh: {
        assetId
      }
    })
    if (!result?.ok || !result.data?.session) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    applyFileSessionCatalog(result.data)
    const session = result.data.session
    openFileSession(session.id, side)
    return session
  }

  const addRemoteFileSessionFromSftpPayload = async (payload: Record<string, unknown>, side: 'left' | 'right' = 'left') => {
    const payloadId = String(payload.uuid || payload.id || payload.assetId || '').trim()
    const payloadHost = String(payload.host || payload.ip || '').trim()
    const known = fileSessions.value.find((item) => (payloadId && item.id === payloadId) || (payloadHost && item.host === payloadHost))
    if (known) {
      openFileSession(known.id, side)
      return known
    }
    if (!window.aiops?.saveFileSessionFromSftpPayload) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    const result = await window.aiops.saveFileSessionFromSftpPayload({ ...payload })
    if (!result?.ok || !result.data?.session) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    applyFileSessionCatalog(result.data)
    const session = result.data.session
    openFileSession(session.id, side)
    return session
  }

  const pushFileTransferTask = (task: FileTransferTask) => {
    const normalized = normalizeFileTransferTask(task)
    if (!normalized) return null
    fileTransferTasks.value = fileTransferTasks.value.filter((item) => item.id !== normalized.id)
    fileTransferTasks.value.unshift(normalized)
    if (normalized.status === 'success' || normalized.status === 'failed' || normalized.status === 'error') {
      scheduleFileTransferTaskRemoval(normalized.id, normalized.status === 'success' ? 2500 : 8000)
    }
    return normalized
  }

  const recordFileTransferTask = async (input: FileTransferTaskRecordInput) => {
    if (!window.aiops?.recordFileTransferTask) return null
    const result = await window.aiops.recordFileTransferTask(input)
    if (!result?.ok || !result.data?.task) {
      if (result?.errorMessage) setTopNotice(result.errorMessage)
      return null
    }
    return pushFileTransferTask(result.data.task)
  }

  const affectedFileTransferTaskIds = (id: string) => {
    const taskIds = new Set<string>([id])
    fileTransferTasks.value.forEach((item) => {
      if (item.children?.some((child) => child.id === id)) {
        taskIds.add(item.id)
        item.children?.forEach((child) => taskIds.add(child.id))
      }
      if (item.id === id && item.children?.length) {
        item.children.forEach((child) => taskIds.add(child.id))
      }
    })
    return taskIds
  }

  const markFileTransferTasksCancelled = (ids: Iterable<string>) => {
    const taskIds = new Set(ids)
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

  const cancelFileTransferTask = async (id: string) => {
    if (!window.aiops?.cancelFileTransferTask) return false
    const result = await window.aiops.cancelFileTransferTask({ id })
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '取消传输任务失败')
      return false
    }
    if (result.data.status !== 'aborted') {
      setTopNotice('传输任务已结束或不存在')
      return false
    }
    markFileTransferTasksCancelled(result.data.taskIds.length ? result.data.taskIds : affectedFileTransferTaskIds(id))
    return true
  }

  const createSnippetGroup = async (groupName: string) => {
    const name = groupName.trim()
    if (!name) return
    const result = await window.aiops.saveQuickCommandGroup({ group_name: name })
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
    return result.data.group
  }

  const renameSnippetGroup = async (uuid: string, groupName: string) => {
    const name = groupName.trim()
    if (!name) return
    const result = await window.aiops.saveQuickCommandGroup({ uuid, group_name: name })
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
  }

  const deleteSnippetGroup = async (uuid: string) => {
    const result = await window.aiops.deleteQuickCommandGroup(uuid)
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
    if (selectedSnippetGroupUuid.value === uuid) selectedSnippetGroupUuid.value = null
  }

  const createQuickCommand = async (payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return
    const result = await window.aiops.saveQuickCommandSnippet({
      snippet_name: snippetName,
      snippet_content: payload.snippet_content,
      group_uuid: payload.group_uuid ?? null
    })
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
    return result.data.snippet
  }

  const updateQuickCommand = async (id: number, payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return
    const result = await window.aiops.saveQuickCommandSnippet({
      id,
      snippet_name: snippetName,
      snippet_content: payload.snippet_content,
      group_uuid: payload.group_uuid ?? null
    })
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
  }

  const deleteQuickCommand = async (id: number) => {
    const result = await window.aiops.deleteQuickCommandSnippet(id)
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
  }

  const reorderQuickCommand = async (sourceId: number, targetId: number) => {
    const currentList = [...filteredQuickCommands.value]
    const sourceIndex = currentList.findIndex((command) => command.id === sourceId)
    const targetIndex = currentList.findIndex((command) => command.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
    const [moved] = currentList.splice(sourceIndex, 1)
    currentList.splice(targetIndex, 0, moved)
    const otherCommandIds = quickCommands.value.filter((command) => !currentList.some((item) => item.id === command.id)).map((command) => command.id)
    const result = await window.aiops.reorderQuickCommands({ orderedIds: [...otherCommandIds, ...currentList.map((command) => command.id)] })
    if (!result.ok || !result.data) return
    applyQuickCommandsSnapshot(result.data)
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

  const resolveQuickCommandPanelIds = (allTabs: boolean) => {
    const terminalPanels = panels.value.filter((panel) => panel.kind !== 'knowledge')
    if (allTabs) {
      const writablePanelIds = terminalPanels.filter((panel) => panel.sessionId).map((panel) => panel.id)
      return writablePanelIds.length ? writablePanelIds : terminalPanels.map((panel) => panel.id)
    }
    const targetPanel = activePanel.value.kind === 'knowledge' ? terminalPanels[0] || activePanel.value : activePanel.value
    return [targetPanel.id]
  }

  const runQuickCommand = async (id: number, autoExecute = true, allTabs = false) => {
    const command = quickCommands.value.find((item) => item.id === id)
    if (!command) return
    const payload = serializeSnippetScript(command.snippet_content, autoExecute)
    const securityCommand = parseSnippetScript(command.snippet_content).find((item) => item.type === 'COMMAND')?.payload || command.snippet_name
    const targetPanelIds = resolveQuickCommandPanelIds(allTabs)
    const decision = prepareTerminalSecurityExecution({
      command: securityCommand,
      panelIds: targetPanelIds,
      inputText: payload,
      shellText: payload,
      writeToShell: true,
      source: 'snippet'
    })
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
    return writeTerminalExecution(decision.execution)
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
      void autoStopMacroRecording('count')
      return false
    }
    macroCommandBuffer.value.push({ command, timestamp })
    if (macroCommandBuffer.value.length >= MACRO_MAX_COMMAND_COUNT) {
      void autoStopMacroRecording('count')
    }
    return true
  }

  const saveMacroSnippet = async (content: string, snippetName = macroDefaultName.value || createMacroSnippetName(), groupUuid = macroTargetGroupUuid.value) => {
    if (!content.trim()) return null
    return createQuickCommand({
      snippet_name: snippetName,
      snippet_content: content,
      group_uuid: groupUuid
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

  async function autoStopMacroRecording(reason: 'time' | 'count') {
    if (!isMacroRecording.value) return null
    macroLimitReason.value = reason
    commitMacroCurrentLine()
    const content = buildMacroSnippetContent()
    const snippetName = macroDefaultName.value || createMacroSnippetName()
    const groupUuid = macroTargetGroupUuid.value
    resetMacroRecordingState()
    return saveMacroSnippet(content, snippetName, groupUuid)
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
      void autoStopMacroRecording('time')
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
      void autoStopMacroRecording('time')
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

  const stopMacroRecording = async () => {
    if (!isMacroRecording.value) return
    commitMacroCurrentLine()
    const content = buildMacroSnippetContent()
    const saved = await saveMacroSnippet(content)
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

  const selectKnowledgeNode = (relPath: string, multi = false) => {
    if (!multi) {
      kbSelectedKeys.value = [relPath]
      return
    }
    kbSelectedKeys.value = kbSelectedKeys.value.includes(relPath)
      ? kbSelectedKeys.value.filter((item) => item !== relPath)
      : [...kbSelectedKeys.value, relPath]
  }

  const refreshKnowledgeSearchStatus = async () => {
    if (!window.aiops?.kbSearchStatus) return
    try {
      kbSearchStatus.value = await window.aiops.kbSearchStatus()
    } catch {
      kbSearchStatus.value = { totalFiles: 0, totalChunks: 0, provider: 'aiopsterm-local', model: 'lexical', updatedAt: 0 }
    }
  }

  const searchKnowledgeContent = async (query = kbSearchQuery.value) => {
    const normalizedQuery = query.trim()
    const request = ++kbSearchRequest
    if (normalizedQuery.length <= 1 || !window.aiops?.kbSearch) {
      kbContentSearchResults.value = []
      kbSearchLoading.value = false
      kbSearchError.value = ''
      return []
    }
    kbSearchLoading.value = true
    kbSearchError.value = ''
    try {
      const results = await window.aiops.kbSearch(normalizedQuery, { maxResults: 12, minScore: 0.15 })
      if (request !== kbSearchRequest) return kbContentSearchResults.value
      kbContentSearchResults.value = results
      await refreshKnowledgeSearchStatus()
      return results
    } catch (searchError) {
      if (request !== kbSearchRequest) return kbContentSearchResults.value
      kbContentSearchResults.value = []
      kbSearchError.value = searchError instanceof Error ? searchError.message : String(searchError)
      return []
    } finally {
      if (request === kbSearchRequest) kbSearchLoading.value = false
    }
  }

  const reindexKnowledgeContent = async () => {
    if (!window.aiops?.kbReindex) return { files: 0, chunks: 0 }
    const result = await window.aiops.kbReindex()
    await refreshKnowledgeSearchStatus()
    if (kbSearchQuery.value.trim().length > 1) void searchKnowledgeContent()
    return result
  }

  const createKnowledgeNode = async (kind: KnowledgeNodeType, parentRelDir: string, title: string) => {
    const name = title.trim()
    if (!name) return null
    if (!window.aiops?.kbCreateFile || !window.aiops?.kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
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

  const renameKnowledgeNode = async (relPath: string, title: string) => {
    const node = findKnowledgeNode(relPath)
    const name = title.trim()
    if (!node || !name) return
    if (!window.aiops?.kbRename) {
      setTopNotice('知识库重命名服务不可用')
      return
    }
    const result = await window.aiops.kbRename(relPath, name)
    kbSelectedKeys.value = [result.relPath]
    kbExpandedKeys.value = kbExpandedKeys.value.map((key) => (key === relPath || key.startsWith(`${relPath}/`) ? key.replace(relPath, result.relPath) : key))
    await refreshKnowledgeTree()
    syncKnowledgePanelsAfterRename(relPath, result.relPath)
  }

  const deleteKnowledgeNodes = async (relPaths: string[]) => {
    if (!window.aiops?.kbDelete) {
      setTopNotice('知识库删除服务不可用')
      return
    }
    for (const relPath of relPaths) {
      const node = findKnowledgeNode(relPath)
      if (!node) continue
      await window.aiops.kbDelete(relPath, node.type === 'dir')
    }
    kbSelectedKeys.value = kbSelectedKeys.value.filter((key) => !relPaths.includes(key))
    kbExpandedKeys.value = kbExpandedKeys.value.filter((key) => !relPaths.some((relPath) => key === relPath || key.startsWith(`${relPath}/`)))
    await refreshKnowledgeTree()
    closeKnowledgePanelsForRemoved(relPaths)
  }

  const copyKnowledgeNodes = (relPaths: string[], mode: 'copy' | 'cut') => {
    if (!relPaths.length) return
    kbClipboard.value = { mode, sources: relPaths }
  }

  const pasteKnowledgeNodes = async (targetRelDir: string) => {
    if (!kbClipboard.value) return
    const destination = findKnowledgeNode(targetRelDir)
    const dstRelDir = destination?.type === 'file' ? getKbParent(destination.relPath) : targetRelDir
    if (!window.aiops?.kbCopy || !window.aiops?.kbMove) {
      setTopNotice('知识库复制移动服务不可用')
      return
    }
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
  }

  const addKnowledgeImportJob = async (destRelPath: string, srcAbsPath?: string, sourceType: 'file' | 'folder' = 'file') => {
    if (!srcAbsPath) {
      setTopNotice('知识库导入需要真实本地路径')
      return false
    }
    if (!window.aiops?.kbImportFile || !window.aiops?.kbImportFolder) {
      setTopNotice('知识库导入服务不可用')
      return false
    }
    const dstRelDir = getKbParent(destRelPath)
    const result = sourceType === 'folder' ? await window.aiops.kbImportFolder(srcAbsPath, dstRelDir) : await window.aiops.kbImportFile(srcAbsPath, dstRelDir)
    if (!kbImportJobs.value.some((job) => job.id === result.jobId)) {
      kbImportJobs.value.push({ id: result.jobId, destRelPath: result.relPath, percent: 100 })
      window.setTimeout(() => {
        kbImportJobs.value = kbImportJobs.value.filter((job) => job.id !== result.jobId)
      }, 500)
    }
    await refreshKnowledgeTree()
    return true
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

  const handleExtensionInstallProgress = (event: BackendExtensionInstallProgress) => {
    if (event.operation === 'update') {
      setExtensionUpdateLoading(event.pluginId, !['done', 'error', 'cancelled'].includes(event.stage))
    } else {
      setExtensionInstallLoading(event.pluginId, !['done', 'error', 'cancelled'].includes(event.stage))
    }
    setExtensionInstallProgress(event.pluginId, event.stage, event.percent)
  }

  const installExtensionInstallProgressListener = () => {
    if (removeExtensionInstallProgressListener || !window.aiops?.onExtensionInstallProgress) return
    removeExtensionInstallProgressListener = window.aiops.onExtensionInstallProgress(handleExtensionInstallProgress)
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

  const cloneExtensionPluginForBackend = (plugin: ExtensionPlugin): ExtensionPluginRuntimeConfig => ({
    ...plugin,
    categories: plugin.categories ? [...plugin.categories] : undefined,
    functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
    guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
    connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined
  })

  const applyExtensionPluginFromBackend = (plugin: ExtensionPluginRuntimeConfig) => {
    const nextPlugin: ExtensionPlugin = {
      ...plugin,
      iconKey: plugin.iconKey || 'local',
      categories: plugin.categories ? [...plugin.categories] : undefined,
      functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
      guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
      connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined
    }
    const index = extensionPlugins.value.findIndex((item) => item.pluginId === nextPlugin.pluginId)
    if (nextPlugin.show === false && nextPlugin.source === 'local' && !nextPlugin.latestVersion) {
      if (index >= 0) extensionPlugins.value = extensionPlugins.value.filter((item) => item.pluginId !== nextPlugin.pluginId)
      ensureSelectedExtensionVisible()
      return
    }
    if (index >= 0) {
      extensionPlugins.value[index] = { ...extensionPlugins.value[index], ...nextPlugin }
    } else {
      extensionPlugins.value.push(nextPlugin)
    }
  }

  const refreshExtensionPlugins = async () => {
    if (!window.aiops?.listExtensionPlugins) return false
    try {
      const result = await window.aiops.listExtensionPlugins()
      if (!result?.ok || !Array.isArray(result.data)) {
        setExtensionNotice(result?.errorMessage || '插件列表加载失败')
        return false
      }
      extensionPlugins.value = result.data.map((plugin) => ({
        ...plugin,
        iconKey: plugin.iconKey || 'local',
        categories: plugin.categories ? [...plugin.categories] : undefined,
        functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
        guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
        connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined
      }))
      ensureSelectedExtensionVisible()
      return true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : '插件列表加载失败')
      ensureSelectedExtensionVisible()
      return false
    }
  }

  const installExtensionPlugin = async (pluginId: string) => {
    installExtensionInstallProgressListener()
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    if (plugin.installable === false) {
      setExtensionNotice('该插件需要订阅后安装')
      return
    }
    setExtensionInstallLoading(pluginId, true)
    setExtensionNotice(`正在安装 ${plugin.name}`)
    try {
      const result = await window.aiops?.installExtensionPlugin?.({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok || !result.data) {
        const cancelled = result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED'
        setExtensionInstallProgress(pluginId, cancelled ? 'cancelled' : 'error', 0)
        setExtensionNotice(cancelled ? `${plugin.name} 安装已取消` : result?.errorMessage || `${plugin.name} 安装失败`)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 安装成功`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionInstallProgress(pluginId, 'error', 0)
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 安装失败`)
      clearExtensionInstallProgressLater(pluginId)
    } finally {
      setExtensionInstallLoading(pluginId, false)
    }
  }

  const updateExtensionPlugin = async (pluginId: string) => {
    installExtensionInstallProgressListener()
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || !plugin.installed || !plugin.hasUpdate) return
    setExtensionUpdateLoading(pluginId, true)
    setExtensionNotice(`正在更新 ${plugin.name}`)
    try {
      const result = await window.aiops?.updateExtensionPlugin?.({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok || !result.data) {
        const cancelled = result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED'
        setExtensionInstallProgress(pluginId, cancelled ? 'cancelled' : 'error', 0)
        setExtensionNotice(cancelled ? `${plugin.name} 安装已取消` : result?.errorMessage || `${plugin.name} 更新失败`)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 已更新`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionInstallProgress(pluginId, 'error', 0)
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 更新失败`)
      clearExtensionInstallProgressLater(pluginId)
    } finally {
      setExtensionUpdateLoading(pluginId, false)
    }
  }

  const uninstallExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || plugin.required) return
    try {
      const result = await window.aiops?.uninstallExtensionPlugin?.({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok || !result.data) {
        setExtensionNotice(result?.errorMessage || `${plugin.name} 卸载失败`)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionNotice(`${result.data.plugin.name} 已卸载`)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 卸载失败`)
    }
  }

  const subscribeExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    try {
      const result = await window.aiops?.openExtensionSubscription?.({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok || !result.data) {
        setExtensionNotice(result?.errorMessage || `${plugin.name} 订阅入口打开失败`)
        return
      }
      setExtensionNotice(`${plugin.name} 已打开订阅入口`)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 订阅入口打开失败`)
    }
  }

  const cancelExtensionInstall = async (pluginId: string) => {
    if (!extensionInstallLoadingMap.value[pluginId] && !extensionUpdateLoadingMap.value[pluginId]) return
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    try {
      const result = await window.aiops?.cancelExtensionInstall?.(pluginId)
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin?.name || '插件'} 取消失败`)
        return
      }
      setExtensionInstallLoading(pluginId, false)
      setExtensionUpdateLoading(pluginId, false)
      setExtensionInstallProgress(pluginId, 'cancelled', 0)
      setExtensionNotice(`${plugin?.name || '插件'} 安装已取消`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin?.name || '插件'} 取消失败`)
    }
  }

  const dropExtensionPackage = async (file: string | { name?: string; path?: string; size?: number }) => {
    installExtensionInstallProgressListener()
    extensionDragActive.value = false
    const fileName = typeof file === 'string' ? file : file?.name || ''
    const filePath = typeof file === 'string' ? '' : file?.path || ''
    const size = typeof file === 'string' ? undefined : file?.size
    if (!fileName.endsWith('.external-reference')) {
      setExtensionNotice('插件包格式错误，请拖入 .external-reference 文件')
      return false
    }
    const packageName = fileName.replace(/\.external-reference$/i, '').replace(/[-_]+/g, ' ').trim() || 'Local Plugin'
    extensionInstallingPackageName.value = packageName
    setExtensionNotice(`正在安装 ${packageName}`)
    let pendingPluginId = ''
    try {
      const result = await window.aiops?.installExtensionPackage?.({
        fileName,
        filePath,
        size,
        existingPluginIds: extensionPlugins.value.map((plugin) => plugin.pluginId)
      })
      if (!result?.ok || !result.data) {
        setExtensionNotice(result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED' ? `${packageName} 安装已取消` : result?.errorMessage || `${packageName} 安装失败`)
        return false
      }
      pendingPluginId = result.data.plugin.pluginId
      applyExtensionPluginFromBackend(result.data.plugin)
      selectedExtensionId.value = result.data.plugin.pluginId
      setExtensionInstallProgress(result.data.plugin.pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 安装成功`)
      clearExtensionInstallProgressLater(result.data.plugin.pluginId)
      return true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${packageName} 安装失败`)
      return false
    } finally {
      if (pendingPluginId) setExtensionInstallLoading(pendingPluginId, false)
      extensionInstallingPackageName.value = ''
    }
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

  const saveAliasCommand = async (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    const alias = target.alias.trim()
    const command = target.command.trim()
    if (!alias || !command) {
      setExtensionNotice('Alias 和 Command 不能为空')
      return { ok: false, reason: 'missing' as const }
    }
    const payload: AliasCommandSaveInput = {
      id: target.id === 'new' ? undefined : target.id,
      previousAlias: target.id === 'new' ? undefined : aliasEditSnapshot.value?.alias || target.alias,
      alias,
      command,
      createdAt: target.createdAt
    }
    try {
      const result = await window.aiops?.saveAliasCommand?.(payload)
      if (!result?.ok || !result.data) {
        if (result?.errorCode === 'ALIAS_DUPLICATE') {
          setExtensionNotice('Alias 已存在')
          return { ok: false, reason: 'duplicate' as const }
        }
        setExtensionNotice(result?.errorMessage || 'Alias 保存失败')
        return { ok: false, reason: 'backend' as const }
      }
      await syncAliasConfigFromBackend(result.data.commands)
      aliasEditSnapshot.value = null
      setExtensionNotice('Alias 已保存')
      return { ok: true, reason: 'saved' as const }
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : 'Alias 保存失败')
      return { ok: false, reason: 'backend' as const }
    }
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

  const deleteAliasCommand = async (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    try {
      const result = await window.aiops?.deleteAliasCommand?.({ id: target.id, alias: target.alias })
      if (!result?.ok || !result.data) {
        setExtensionNotice(result?.errorMessage || 'Alias 删除失败')
        return { ok: false, reason: 'backend' as const }
      }
      await syncAliasConfigFromBackend(result.data.commands)
      if (aliasEditSnapshot.value?.id === id) aliasEditSnapshot.value = null
      setExtensionNotice('Alias 已删除')
      return { ok: true, reason: 'deleted' as const }
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : 'Alias 删除失败')
      return { ok: false, reason: 'backend' as const }
    }
  }

  const setK8sNotice = (text: string) => {
    k8sClusterNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (k8sClusterNotice.value === text) k8sClusterNotice.value = ''
    }, 2400)
  }

  const activateK8sTerminal = (id: string) => {
    k8sActiveTerminalId.value = id
    k8sTerminalTabs.value.forEach((tab) => {
      tab.isActive = tab.id === id
    })
  }

  const applyKubernetesCatalog = (catalog: KubernetesCatalog) => {
    k8sContexts.value = catalog.contexts.map((context) => ({ ...context }))
    k8sClusters.value = catalog.clusters.map((cluster) => ({ ...cluster }))
    k8sBastions.value = catalog.bastions.map((bastion) => ({ ...bastion }))
    k8sNamespaces.value = catalog.namespaces.map((namespace) => ({ ...namespace }))
    k8sResources.value = catalog.resources.map((resource) => ({ ...resource }))
    k8sImportContexts.value = catalog.importContexts.map((context) => ({ ...context }))
    k8sActiveClusterId.value = catalog.activeClusterId
    if (!k8sSelectedClusterId.value || !k8sClusters.value.some((cluster) => cluster.id === k8sSelectedClusterId.value)) {
      k8sSelectedClusterId.value = catalog.selectedClusterId
    }
    k8sConnectingClusterIds.value = k8sConnectingClusterIds.value.filter((id) => k8sClusters.value.some((cluster) => cluster.id === id))
    k8sSyncingBastionIds.value = k8sSyncingBastionIds.value.filter((id) => k8sBastions.value.some((bastion) => bastion.uuid === id))
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => k8sClusters.value.some((cluster) => cluster.id === tab.clusterId))

    if (!k8sTerminalTabs.value.length) {
      k8sActiveTerminalId.value = null
    } else if (!k8sActiveTerminalId.value || !k8sTerminalTabs.value.some((tab) => tab.id === k8sActiveTerminalId.value)) {
      activateK8sTerminal(k8sTerminalTabs.value[0].id)
    }

    const activeCluster = k8sClusters.value.find((cluster) => cluster.id === k8sActiveClusterId.value)
    if (activeCluster && (!k8sAgentClusterId.value || !k8sClusters.value.some((cluster) => cluster.id === k8sAgentClusterId.value))) {
      k8sAgentClusterId.value = activeCluster.id
      k8sAgentContextName.value = activeCluster.context_name
      k8sAgentStatus.value = 'ready'
    } else if (!activeCluster && k8sAgentClusterId.value && !k8sClusters.value.some((cluster) => cluster.id === k8sAgentClusterId.value)) {
      k8sAgentClusterId.value = null
      k8sAgentContextName.value = ''
      k8sAgentStatus.value = 'idle'
    }

    return catalog
  }

  const refreshKubernetesCatalog = async () => {
    if (!window.aiops?.listKubernetesCatalog) return null
    const result = await window.aiops.listKubernetesCatalog()
    if (!result?.ok || !result.data) {
      setK8sNotice(result?.errorMessage || 'Kubernetes 配置加载失败')
      return null
    }
    return applyKubernetesCatalog(result.data)
  }

  const switchK8sContext = async (name: string) => {
    if (!window.aiops?.switchKubernetesContext) {
      setK8sNotice('Kubernetes context API 不可用')
      return false
    }
    const result = await window.aiops.switchKubernetesContext(name)
    if (!result?.ok || !result.data) {
      setK8sNotice(result?.errorMessage || 'Kubernetes Context 切换失败')
      return false
    }
    applyKubernetesCatalog(result.data)
    setK8sNotice(`已切换到 ${name}`)
    return true
  }

  const reloadK8sConfig = async () => {
    const catalog = await refreshKubernetesCatalog()
    setK8sNotice(catalog ? 'Kubernetes 配置已刷新' : 'Kubernetes 配置刷新失败')
    return Boolean(catalog)
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

  const setK8sAgentCluster = (clusterId: string | null) => {
    const cluster = clusterId ? k8sClusters.value.find((item) => item.id === clusterId) : null
    k8sAgentClusterId.value = cluster?.id || null
    k8sAgentContextName.value = cluster?.context_name || ''
    k8sAgentStatus.value = cluster ? 'ready' : 'idle'
    if (cluster) setK8sNotice(`Kubernetes Agent 已切换到 ${cluster.name}`)
    return Boolean(cluster)
  }

  const connectK8sCluster = (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return false
    if (!window.aiops?.connectKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    setK8sActionMenu(null)
    setK8sConnecting(id, true)
    cluster.connection_status = 'connecting'
    setK8sNotice(`正在连接 ${cluster.name}`)
    void window.aiops
      .connectKubernetesCluster(id)
      .then((result) => {
        if (!result?.ok || !result.data) {
          cluster.connection_status = 'error'
          setK8sNotice(result?.errorMessage || `${cluster.name} 连接失败`)
          return false
        }
        applyKubernetesCatalog(result.data)
        const latest = result.data.cluster || result.data.clusters.find((item) => item.id === id)
        if (latest) {
          k8sAgentClusterId.value = latest.id
          k8sAgentContextName.value = latest.context_name
          k8sAgentStatus.value = 'ready'
        }
        completeK8sTerminalConnect(id)
        setK8sNotice(
          k8sProxyConfig.value.enabled
            ? `${latest?.name || cluster.name} 连接成功，K8s Agent 代理 ${k8sProxyConfig.value.type} ${k8sProxyConfig.value.host}:${k8sProxyConfig.value.port} 已应用`
            : `${latest?.name || cluster.name} 连接成功`
        )
        return true
      })
      .catch((error) => {
        cluster.connection_status = 'error'
        setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 连接失败`)
      })
      .finally(() => {
        setK8sConnecting(id, false)
      })
    return true
  }

  const disconnectK8sCluster = (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return false
    if (!window.aiops?.disconnectKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    setK8sActionMenu(null)
    setK8sConnecting(id, false)
    void window.aiops
      .disconnectKubernetesCluster(id)
      .then((result) => {
        if (!result?.ok || !result.data) {
          setK8sNotice(result?.errorMessage || `${cluster.name} 断开失败`)
          return false
        }
        applyKubernetesCatalog(result.data)
        if (k8sAgentClusterId.value === id) {
          k8sAgentClusterId.value = null
          k8sAgentContextName.value = ''
          k8sAgentStatus.value = 'idle'
        }
        k8sTerminalTabs.value
          .filter((tab) => tab.clusterId === id && tab.status !== 'ended')
          .forEach((tab) => {
            tab.status = 'ended'
            tab.exitCode = 0
            tab.collectingAiOutput = false
            appendK8sTerminalOutput(tab, `[Terminal session ended]`)
          })
        setK8sNotice(`${cluster.name} 已断开`)
        return true
      })
      .catch((error) => {
        setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 断开失败`)
      })
    return true
  }

  const appendK8sTerminalOutput = (tab: K8sTerminalTab, text: string) => {
    tab.output = tab.output.endsWith('\n') || !tab.output ? `${tab.output}${text}` : `${tab.output}\n${text}`
    tab.updatedAt = '刚刚'
  }

  const completeK8sTerminalConnect = (clusterId: string) => {
    k8sTerminalTabs.value
      .filter((tab) => tab.clusterId === clusterId && tab.status === 'connecting')
      .forEach((tab) => {
        tab.status = 'connected'
        tab.updatedAt = '刚刚'
      })
  }

  const openK8sTerminal = async (clusterId: string, options: { forceNew?: boolean; namespace?: string; cols?: number; rows?: number } = {}) => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    if (!cluster) return null
    let tab = options.forceNew ? undefined : k8sTerminalTabs.value.find((item) => item.clusterId === clusterId && item.status !== 'ended')
    if (!tab) {
      if (!window.aiops?.createKubernetesTerminal) {
        setK8sNotice('Kubernetes terminal API 不可用')
        return null
      }
      const result = await window.aiops.createKubernetesTerminal({
        clusterId,
        namespace: options.namespace,
        cols: options.cols,
        rows: options.rows
      })
      if (!result?.ok || !result.data) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端创建失败')
        return null
      }
      tab = k8sTerminalTabFromRecord(result.data)
      k8sTerminalTabs.value.push(tab)
    }
    activateK8sTerminal(tab.id)
    if (cluster.connection_status !== 'connected') connectK8sCluster(clusterId)
    else if (tab.status === 'connecting') completeK8sTerminalConnect(clusterId)
    return tab
  }

  const createNewK8sTerminalTab = async (clusterId?: string) => {
    const targetClusterId = clusterId || k8sActiveCluster.value?.id || k8sSelectedCluster.value?.id || k8sClusters.value[0]?.id
    return targetClusterId ? openK8sTerminal(targetClusterId, { forceNew: true }) : null
  }

  const closeK8sTerminalTab = async (id: string) => {
    const index = k8sTerminalTabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const tab = k8sTerminalTabs.value[index]
    if (tab.status !== 'ended') {
      if (!window.aiops?.closeKubernetesTerminal) {
        setK8sNotice('Kubernetes terminal API 不可用')
        return
      }
      const result = await window.aiops.closeKubernetesTerminal(tab.sessionId, 0)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端关闭失败')
        return
      }
    }
    k8sTerminalTabs.value[index].status = 'ended'
    k8sTerminalTabs.value[index].exitCode = 0
    k8sTerminalTabs.value.splice(index, 1)
    if (k8sActiveTerminalId.value === id) {
      const next = k8sTerminalTabs.value[Math.min(index, k8sTerminalTabs.value.length - 1)]
      if (next) activateK8sTerminal(next.id)
      else k8sActiveTerminalId.value = null
    }
  }

  const setActiveK8sTerminal = (id: string) => {
    if (!k8sTerminalTabs.value.some((tab) => tab.id === id)) return
    activateK8sTerminal(id)
  }

  const resizeK8sTerminal = async (id: string, cols: number, rows: number) => {
    const tab = k8sTerminalTabs.value.find((item) => item.id === id || item.sessionId === id)
    if (!tab) return false
    if (window.aiops?.resizeKubernetesTerminal) {
      const result = await window.aiops.resizeKubernetesTerminal(tab.sessionId, cols, rows)
      if (!result?.ok || !result.data) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端尺寸同步失败')
        return false
      }
      tab.cols = result.data.cols
      tab.rows = result.data.rows
      tab.updatedAt = result.data.updatedAt
      tab.status = result.data.status
    } else {
      setK8sNotice('Kubernetes terminal API 不可用')
      return false
    }
    setK8sNotice(`${tab.name} 终端尺寸已同步 ${tab.cols}x${tab.rows}`)
    return true
  }

  type K8sBackendCommandData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['executeKubernetesCommand']>>['data']>
  type K8sAgentRunInput = Omit<K8sBackendCommandData, 'terminalOutput'> & Partial<Pick<K8sBackendCommandData, 'terminalOutput'>>

  const executeK8sBackendCommand = async (command: string, clusterId: string, namespace: string, source: 'terminal' | 'agent' | 'resource'): Promise<K8sBackendCommandData | null> => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    if (!window.aiops?.executeKubernetesCommand) {
      setK8sNotice('Kubernetes command API 不可用')
      return null
    }
    try {
      const result = await window.aiops.executeKubernetesCommand({
        command,
        clusterId,
        clusterName: cluster?.name,
        contextName: cluster?.context_name,
        namespace,
        defaultNamespace: cluster?.default_namespace,
        source
      })
      if (result.ok && result.data) return result.data
      setK8sNotice(result.errorMessage || 'Kubernetes command failed.')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes command failed.')
      return null
    }
  }

  const sendK8sTerminalCommand = async (command: string) => {
    const tab = k8sActiveTerminal.value
    const text = command.trim()
    if (!tab || !text || tab.status === 'ended') return ''
    if (tab.status === 'connecting') tab.status = 'connected'
    const result = await executeK8sBackendCommand(text, tab.clusterId, tab.namespace, 'terminal')
    if (!result) {
      tab.collectingAiOutput = false
      return ''
    }
    const terminalOutput = result.terminalOutput || ''
    tab.commandHistory = [text, ...tab.commandHistory.filter((item) => item !== text)].slice(0, 20)
    tab.lastCommand = text
    tab.lastCommandOutput = terminalOutput
    if (terminalOutput) appendK8sTerminalOutput(tab, terminalOutput)
    if (tab.collectingAiOutput) {
      tab.collectingAiOutput = false
      const cluster = k8sClusters.value.find((item) => item.id === tab.clusterId)
      const host: AiContextOption | undefined = cluster
        ? {
            id: `k8s-${cluster.id}`,
            kind: 'hosts',
            label: cluster.name,
            detail: `${cluster.context_name} / ${tab.namespace}`
          }
        : undefined
      void sendChat(`Terminal output:\n\`\`\`\n${terminalOutput || 'Command executed successfully, no output returned'}\n\`\`\``, undefined, host ? [host] : undefined)
      setK8sNotice(`${tab.name} 命令输出已发送到 AI`)
    }
    return terminalOutput
  }

  const executeK8sTerminalAiCommand = async (command: string, tabId?: string) => {
    const target = tabId ? k8sTerminalTabs.value.find((tab) => tab.id === tabId || tab.sessionId === tabId) : k8sActiveTerminal.value
    if (!target || target.status === 'ended') return false
    activateK8sTerminal(target.id)
    target.collectingAiOutput = true
    target.aiCommandTabId = tabId || target.id
    await sendK8sTerminalCommand(command)
    return true
  }

  const endK8sTerminalSession = async (id: string, exitCode = 0) => {
    const tab = k8sTerminalTabs.value.find((item) => item.id === id || item.sessionId === id)
    if (!tab) return false
    if (window.aiops?.closeKubernetesTerminal) {
      const result = await window.aiops.closeKubernetesTerminal(tab.sessionId, exitCode)
      if (!result?.ok || !result.data) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端会话结束失败')
        return false
      }
      tab.updatedAt = result.data.updatedAt
    } else {
      setK8sNotice('Kubernetes terminal API 不可用')
      return false
    }
    tab.status = 'ended'
    tab.exitCode = exitCode
    tab.collectingAiOutput = false
    appendK8sTerminalOutput(tab, `[Terminal session ended]`)
    setK8sNotice(`${tab.name} 终端会话已结束`)
    return true
  }

  const findK8sResource = (resourceId: string) => k8sResources.value.find((resource) => resource.id === resourceId) || null

  const buildK8sResourceCommand = (resource: K8sResource, action: 'get' | 'describe' | 'logs') => {
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

  const addK8sAgentRun = (result: K8sAgentRunInput, fallbackCluster?: K8sCluster | null) => {
    const cluster = fallbackCluster ?? k8sAgentCluster.value
    const record: K8sAgentRunRecord = {
      id: result.runId,
      command: result.command,
      status: result.success ? 'success' : 'error',
      output: result.output,
      error: result.error || undefined,
      clusterId: result.clusterId || cluster?.id || null,
      contextName: result.contextName || cluster?.context_name || k8sAgentContextName.value || null,
      namespace: result.namespace,
      startedAt: result.startedAt,
      durationMs: result.durationMs
    }
    k8sAgentRuns.value = [record, ...k8sAgentRuns.value].slice(0, 12)
    k8sAgentLastResult.value = record
    return record
  }

  const addK8sAgentLocalFailure = (command: string, error: string) =>
    addK8sAgentRun({
      runId: 'k8s-run-local-validation',
      command,
      output: '',
      success: false,
      error,
      durationMs: 0,
      startedAt: '刚刚',
      clusterId: '',
      contextName: k8sAgentContextName.value || 'unknown-context',
      namespace: k8sResourceNamespace.value === 'all' ? 'all' : k8sResourceNamespace.value,
      source: 'agent'
    })

  const runK8sAgentKubectl = async (command?: string) => {
    const cluster = k8sAgentCluster.value
    const text = (command ?? k8sAgentCommandDraft.value).trim()
    if (!cluster || !text) {
      const failed = addK8sAgentLocalFailure(text || '<empty>', 'No cluster selected. Please select a cluster first.')
      k8sAgentStatus.value = 'error'
      setK8sNotice(failed.error || 'Kubernetes Agent 执行失败')
      return failed
    }
    k8sAgentStatus.value = 'running'
    const namespace = k8sResourceNamespace.value === 'all' ? cluster.default_namespace || 'default' : k8sResourceNamespace.value
    const result = await executeK8sBackendCommand(text, cluster.id, namespace, 'agent')
    if (!result) {
      k8sAgentStatus.value = 'error'
      k8sResourceOutputTitle.value = `Agent kubectl / ${cluster.name}`
      k8sResourceOutput.value = text
      return null
    }
    const record = addK8sAgentRun(result, cluster)
    k8sAgentCommandHistory.value = [text, ...k8sAgentCommandHistory.value.filter((item) => item !== text)].slice(0, 12)
    k8sAgentCommandDraft.value = text
    k8sAgentStatus.value = result.success ? 'ready' : 'error'
    k8sResourceOutputTitle.value = `Agent kubectl / ${cluster.name}`
    k8sResourceOutput.value = `${text}\n\n${result.output || result.error || ''}`
    setK8sNotice(result.success ? 'Kubernetes Agent 命令执行完成' : 'Kubernetes Agent 命令执行失败')
    return record
  }

  const testK8sAgentConnection = async () => {
    const cluster = k8sAgentCluster.value
    k8sAgentTesting.value = true
    const record = cluster
      ? await runK8sAgentKubectl('kubectl version --request-timeout=10s')
      : addK8sAgentLocalFailure('kubectl version --request-timeout=10s', 'No cluster selected')
    if (!record) {
      k8sAgentStatus.value = 'error'
      k8sResourceOutputTitle.value = 'Agent Test Connection'
      window.setTimeout(() => {
        k8sAgentTesting.value = false
      }, 160)
      setK8sNotice('Kubernetes Agent 连接测试失败')
      return null
    }
    k8sAgentStatus.value = record.status === 'success' ? 'ready' : 'error'
    k8sResourceOutputTitle.value = 'Agent Test Connection'
    k8sResourceOutput.value = `${record.command}\n\n${record.output || record.error || ''}`
    window.setTimeout(() => {
      k8sAgentTesting.value = false
    }, 160)
    setK8sNotice(record.status === 'success' ? 'Kubernetes Agent 连接测试成功' : 'Kubernetes Agent 连接测试失败')
    return record
  }

  const refreshK8sAgentNamespaces = async () => {
    const cluster = k8sAgentCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes Agent 集群')
      return null
    }
    const result = await executeK8sBackendCommand('kubectl get namespaces', cluster.id, cluster.default_namespace, 'agent')
    if (!result) return null
    const record = addK8sAgentRun(result, cluster)
    k8sResourceOutputTitle.value = `Namespaces / ${cluster.name}`
    k8sResourceOutput.value = `${record.command}\n\n${result.output || result.error || ''}`
    setK8sNotice('Kubernetes namespaces 已刷新')
    return record
  }

  const cleanupK8sAgent = () => {
    k8sAgentClusterId.value = null
    k8sAgentContextName.value = ''
    k8sAgentStatus.value = 'idle'
    k8sAgentLastResult.value = null
    setK8sNotice('Kubernetes Agent 已清理')
  }

  const refreshK8sResources = async () => {
    const cluster = k8sResourceCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes 集群')
      return
    }
    k8sResourceLoading.value = true
    k8sResourceOutputTitle.value = `${cluster.name} / ${k8sKindLabels[k8sResourceKind.value]}`
    const command = `kubectl get ${k8sKindLabels[k8sResourceKind.value].toLowerCase()} ${k8sResourceNamespace.value === 'all' ? '--all-namespaces' : `-n ${k8sResourceNamespace.value}`}`
    const result = await executeK8sBackendCommand(command, cluster.id, cluster.default_namespace, 'resource')
    if (!result) {
      k8sResourceLoading.value = false
      return
    }
    addK8sAgentRun(result, cluster)
    k8sResourceOutput.value = `${command}\n\n${result.output || result.error || ''}\n\n已刷新 ${filteredK8sResources.value.length} 条资源。`
    window.setTimeout(() => {
      k8sResourceLoading.value = false
    }, 180)
    setK8sNotice('Kubernetes 资源已刷新')
  }

  const describeK8sResource = async (resourceId: string) => {
    const resource = findK8sResource(resourceId)
    if (!resource) return
    const command = buildK8sResourceCommand(resource, 'describe')
    k8sResourceOutputTitle.value = `Describe ${resource.name}`
    const result = await executeK8sBackendCommand(command, resource.clusterId, resource.namespace, 'resource')
    if (!result) return
    k8sResourceOutput.value = `${command}\n\n${result.output || result.error || ''}`
  }

  const showK8sPodLogs = async (resourceId: string) => {
    const resource = findK8sResource(resourceId)
    if (!resource || resource.kind !== 'pods') return
    const command = buildK8sResourceCommand(resource, 'logs')
    k8sResourceOutputTitle.value = `Logs ${resource.name}`
    const result = await executeK8sBackendCommand(command, resource.clusterId, resource.namespace, 'resource')
    if (!result) return
    k8sResourceOutput.value = `${command}\n\n${result.output || result.error || ''}`
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

  const sendK8sCurrentOutputToTerminal = async () => {
    const cluster = k8sResourceCluster.value
    const command = currentK8sOutputCommand()
    if (!cluster || !command) {
      setK8sNotice('当前没有可发送到终端的 kubectl 命令')
      return ''
    }
    await openK8sTerminal(cluster.id)
    const terminalOutput = await sendK8sTerminalCommand(command)
    if (!terminalOutput) return ''
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
    return command
  }

  const sendK8sCurrentOutputToAi = async () => {
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
    const sent = await sendChat(`请分析这个 Kubernetes 输出并给出下一步排查建议：\n\nTerminal output:\n\`\`\`\n${output}\n\`\`\``, undefined, [host])
    if (!sent) return false
    setK8sNotice('Kubernetes 输出已发送到 AI')
    return true
  }

  const sendK8sResourceCommand = async (resourceId: string, action: 'get' | 'describe' | 'logs' = 'get') => {
    const resource = findK8sResource(resourceId)
    const cluster = resource ? k8sClusters.value.find((item) => item.id === resource.clusterId) : null
    if (!resource || !cluster || (action === 'logs' && resource.kind !== 'pods')) return
    await openK8sTerminal(cluster.id)
    const terminalOutput = await sendK8sTerminalCommand(buildK8sResourceCommand(resource, action))
    if (!terminalOutput) return
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
  }

  const testK8sClusterConnection = async (input: Partial<KubernetesClusterTestInput>) => {
    if (!window.aiops?.testKubernetesClusterConnection) {
      k8sTestResult.value = false
      setK8sNotice('Kubernetes cluster test API 不可用')
      return false
    }
    const result = await window.aiops.testKubernetesClusterConnection({
      contextName: input.contextName || '',
      serverUrl: input.serverUrl,
      kubeconfigPath: input.kubeconfigPath,
      kubeconfigContent: input.kubeconfigContent
    })
    const ok = Boolean(result?.ok && result.data?.isValid)
    k8sTestResult.value = ok
    setK8sNotice(ok ? result.data?.message || '连接测试成功' : result?.errorMessage || result?.data?.message || '连接测试失败，请确认 Context 和 Server URL')
    return ok
  }

  const selectK8sImportContext = (contextName: string) => {
    return k8sImportContexts.value.find((context) => context.name === contextName) || null
  }

  const importK8sKubeconfigContent = (content: string) => {
    const result = parseKubeconfigContexts(content)
    if (result.success) {
      k8sImportContexts.value = result.contexts
      setK8sNotice(`已发现 ${result.contexts.length} 个 kubeconfig Context`)
    } else {
      setK8sNotice(result.error || 'Kubeconfig 导入失败')
    }
    return result
  }

  const importK8sKubeconfigFile = async (filePath: string) => {
    if (!filePath.trim()) {
      const emptyResult: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigContent: '',
        currentContext: '',
        error: '请选择 kubeconfig 文件'
      }
      setK8sNotice(emptyResult.error || '请选择 kubeconfig 文件')
      return emptyResult
    }
    try {
      const result = await window.aiops.readLocalFile(filePath)
      const parsed = importK8sKubeconfigContent(result.content)
      if (parsed.success) setK8sNotice(`已选择 kubeconfig 文件，发现 ${parsed.contexts.length} 个 Context`)
      return parsed
    } catch (error) {
      const failed: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigContent: '',
        currentContext: '',
        error: error instanceof Error ? error.message : String(error)
      }
      setK8sNotice(`Kubeconfig 导入失败：${failed.error}`)
      return failed
    }
  }

  const addK8sCluster = async (payload: {
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
    if (!window.aiops?.addKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return null
    }
    const result = await window.aiops.addKubernetesCluster({
      name,
      contextName,
      serverUrl,
      defaultNamespace: payload.defaultNamespace,
      kubeconfigPath: payload.kubeconfigPath,
      kubeconfigContent: payload.kubeconfigContent,
      sourceType: payload.sourceType,
      bastionUuid: payload.bastionUuid
    })
    if (!result?.ok || !result.data?.cluster) {
      setK8sNotice(result?.errorMessage || 'Kubernetes 集群添加失败')
      return null
    }
    applyKubernetesCatalog(result.data)
    const cluster = result.data.cluster
    k8sSelectedClusterId.value = cluster.id
    k8sAddModalOpen.value = false
    setK8sNotice(`${cluster.name} 已添加`)
    return cluster
  }

  const updateK8sCluster = async (id: string, patch: { name?: string; defaultNamespace?: string; autoConnect?: boolean }) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return null
    if (!window.aiops?.updateKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return null
    }
    const result = await window.aiops.updateKubernetesCluster(id, patch)
    if (!result?.ok || !result.data?.cluster) {
      setK8sNotice(result?.errorMessage || `${cluster.name} 更新失败`)
      return null
    }
    applyKubernetesCatalog(result.data)
    const updated = result.data.cluster
    k8sEditModalOpen.value = false
    k8sEditingClusterId.value = null
    setK8sNotice(`${updated.name} 已更新`)
    return updated
  }

  const requestDeleteK8sCluster = (id: string) => {
    k8sDeleteConfirmClusterId.value = id
    setK8sActionMenu(null)
  }

  const cancelDeleteK8sCluster = () => {
    k8sDeleteConfirmClusterId.value = null
  }

  const confirmDeleteK8sCluster = async () => {
    if (!k8sDeleteConfirmClusterId.value) return
    await deleteK8sCluster(k8sDeleteConfirmClusterId.value)
    k8sDeleteConfirmClusterId.value = null
  }

  const deleteK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!window.aiops?.deleteKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    const result = await window.aiops.deleteKubernetesCluster(id)
    if (!result?.ok || !result.data) {
      setK8sNotice(result?.errorMessage || `${cluster?.name || '集群'} 删除失败`)
      return false
    }
    applyKubernetesCatalog(result.data)
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => tab.clusterId !== id)
    if (k8sSelectedClusterId.value === id) k8sSelectedClusterId.value = null
    if (k8sActiveClusterId.value === id) k8sActiveClusterId.value = null
    if (k8sActiveTerminalId.value && !k8sTerminalTabs.value.some((tab) => tab.id === k8sActiveTerminalId.value)) {
      k8sActiveTerminalId.value = k8sTerminalTabs.value[0]?.id || null
      k8sTerminalTabs.value.forEach((tab) => {
        tab.isActive = tab.id === k8sActiveTerminalId.value
      })
    }
    setK8sNotice(`${cluster?.name || '集群'} 已删除`)
    return true
  }

  const syncK8sBastion = (bastionUuid: string) => {
    const bastion = k8sBastions.value.find((item) => item.uuid === bastionUuid)
    if (!bastion) return false
    if (!window.aiops?.syncKubernetesBastion) {
      setK8sNotice('Kubernetes bastion API 不可用')
      return false
    }
    setK8sSyncingBastion(bastionUuid, true)
    setK8sNotice(`正在同步 ${bastion.label}`)
    void window.aiops
      .syncKubernetesBastion(bastionUuid)
      .then((result) => {
        if (!result?.ok || !result.data) {
          setK8sNotice(result?.errorMessage || `${bastion.label} Kubernetes 资产同步失败`)
          return false
        }
        applyKubernetesCatalog(result.data)
        k8sConfigTab.value = 'jumpserver'
        setK8sNotice(
          result.data.syncedCount
            ? `${bastion.label} Kubernetes 资产已同步，新增 ${result.data.syncedCount} 个`
            : `${bastion.label} Kubernetes 资产已同步，更新 ${result.data.updatedCount} 个`
        )
        return true
      })
      .catch((error) => {
        setK8sNotice(error instanceof Error ? error.message : `${bastion.label} Kubernetes 资产同步失败`)
      })
      .finally(() => {
        setK8sSyncingBastion(bastionUuid, false)
      })
    return true
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
    const panel = createEmptyTerminalPanel(createId('panel'), split ? `split ${panels.value.length}` : `shell ${panels.value.length}`, split)
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
    setTerminalOutput(panel, '')
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
    panels.value = [createEmptyTerminalPanel('panel-main', 'local shell')]
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
      host: sourceSession.host,
      port: sourceSession.port,
      username: sourceSession.username,
      assetId: sourceSession.assetId,
      assetName: sourceSession.assetName,
      assetType: sourceSession.assetType,
      organizationId: sourceSession.organizationId,
      authType: sourceSession.authType,
      sourcePanelId: source.id,
      forkFromConnectionId: sourceSession.connectionId
    }
    const forkPanel: TerminalPanel = {
      id: createId('panel'),
      title: `${source.title} fork`,
      cwd: source.cwd,
      kind: 'terminal',
      output: '',
      outputSegments: [],
      status: 'ready',
      split: source.split,
      sshSession: forkSession
    }
    panels.value.push(forkPanel)
    activePanelId.value = forkPanel.id
    const contextId = sourceSession.assetId || sourceSession.connectionId || forkPanel.id
    selectedContexts.value = [
      ...selectedContexts.value.filter((item) => item.id !== contextId),
      {
        id: contextId,
        kind: 'hosts',
        label: sourceSession.host,
        detail: `${sourceSession.assetName} fork`
      }
    ]
    return forkPanel
  }

  const knowledgePanelId = (relPath: string) => `kb:${relPath}`

  let knowledgeJumpTokenSeed = 0

  const createKnowledgeJumpState = (range?: { startLine?: number; endLine?: number }) => {
    if (!range?.startLine) return {}
    knowledgeJumpTokenSeed += 1
    return {
      startLine: range.startLine,
      ...(range.endLine ? { endLine: range.endLine } : {}),
      jumpToken: knowledgeJumpTokenSeed
    }
  }

  const openKnowledgeFile = (relPath: string, range?: { startLine?: number; endLine?: number }) => {
    const node = findKnowledgeNode(relPath)
    if (!node || node.type !== 'file') return null
    const existing = panels.value.find((panel) => panel.kind === 'knowledge' && panel.knowledge?.relPath === relPath)
    if (existing) {
      existing.knowledge = {
        relPath,
        isImage: isKnowledgeImagePath(relPath),
        ...createKnowledgeJumpState(range)
      }
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
        isImage: isKnowledgeImagePath(relPath),
        ...createKnowledgeJumpState(range)
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

  const reportTerminalExecutionUnavailable = (command: string, panelIds: string[] = [], reason = '终端会话不可用，请先打开本地 shell 或连接 SSH') => {
    setTopNotice(reason)
    terminalSecurityPrompt.value = null
    return { status: 'unavailable', command, panelIds, reason } as TerminalSecurityDecision
  }

  const terminalWriteFailureReason = (result?: Awaited<ReturnType<AiopsPreloadApi['writeTerminal']>>) =>
    result?.errorMessage || '终端写入失败，请重新打开本地 shell 或连接 SSH'

  const canWriteTerminalExecution = (execution: Pick<TerminalSecurityExecution, 'panelIds' | 'writeToShell'>) => {
    if (!execution.writeToShell) return true
    if (typeof window.aiops?.writeTerminal !== 'function') return false
    return execution.panelIds.every((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      return Boolean(panel?.sessionId)
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
    if (!execution.writeToShell) applyTerminalExecution(execution)
    return { status: 'allow', execution }
  }

  const writeTerminalExecution = async (execution: TerminalSecurityExecution): Promise<TerminalSecurityDecision> => {
    if (!execution.writeToShell) {
      applyTerminalExecution(execution)
      return { status: 'allow', execution }
    }
    if (!canWriteTerminalExecution(execution)) {
      return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
    }
    for (const panelId of execution.panelIds) {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (!panel?.sessionId) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
      const result = await window.aiops.writeTerminal(panel.sessionId, execution.shellText || execution.inputText)
      if (result?.ok === false) {
        return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, terminalWriteFailureReason(result))
      }
    }
    applyTerminalExecution(execution)
    return { status: 'allow', execution }
  }

  const executeTerminalCommand = (panelId: string, command: string, options: Partial<Pick<TerminalSecurityExecution, 'inputText' | 'outputText' | 'shellText' | 'writeToShell' | 'source'>> = {}) => {
    const text = command.trim()
    if (!text) return { status: 'allow' } as TerminalSecurityDecision
    const writeToShell = options.writeToShell ?? true
    const execution: TerminalSecurityExecution = {
      command: text,
      panelIds: [panelId],
      inputText: options.inputText ?? `${text}\n`,
      outputText: options.outputText,
      shellText: options.shellText ?? `${text}\n`,
      writeToShell,
      source: options.source ?? 'direct'
    }
    return prepareTerminalSecurityExecution(execution)
  }

  const runTerminalCommand = async (
    panelId: string,
    command: string,
    options: Partial<Pick<TerminalSecurityExecution, 'inputText' | 'outputText' | 'shellText' | 'writeToShell' | 'source'>> = {}
  ) => {
    const decision = executeTerminalCommand(panelId, command, options)
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
    return writeTerminalExecution(decision.execution)
  }

  const executeGlobalTerminalCommand = (command: string) => {
    const text = command.trim()
    if (!text) return { status: 'allow' } as TerminalSecurityDecision
    const terminalPanelIds = panels.value.filter((panel) => panel.kind !== 'knowledge' && panel.sessionId).map((panel) => panel.id)
    if (!terminalPanelIds.length || typeof window.aiops?.writeTerminal !== 'function') {
      return reportTerminalExecutionUnavailable(text, panels.value.filter((panel) => panel.kind !== 'knowledge').map((panel) => panel.id))
    }
    const execution: TerminalSecurityExecution = {
      command: text,
      panelIds: terminalPanelIds,
      inputText: `${text}\n`,
      shellText: `${text}\n`,
      writeToShell: true,
      source: 'global'
    }
    return prepareTerminalSecurityExecution(execution)
  }

  const runGlobalTerminalCommand = async (command: string) => {
    const decision = executeGlobalTerminalCommand(command)
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
    return writeTerminalExecution(decision.execution)
  }

  const approveTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    if (!canWriteTerminalExecution(prompt.execution)) {
      reportTerminalExecutionUnavailable(prompt.command, prompt.panelIds)
      return null
    }
    terminalSecurityPrompt.value = null
    if (!prompt.execution.writeToShell) applyTerminalExecution(prompt.execution)
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
    return executeTerminalCommand(panel.id, text, { source: 'agent', writeToShell: true })
  }

  const runActiveTerminalCommand = async (command: string, source: TerminalCommandSource = 'agent') => {
    const panel = resolveActiveWritableTerminalPanel()
    const text = command.trim()
    if (!panel || !text) return null
    return runTerminalCommand(panel.id, text, { source, writeToShell: true })
  }

  const appendActiveTerminalInput = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    if (!panel) return null
    return executeTerminalCommand(panel.id, command, { writeToShell: false, source: 'agent' })
  }

  const buildTerminalCommandContext = (panel: TerminalPanel): TerminalCommandGenerationContext => {
    const ssh = panel.sshSession
    return {
      host: ssh?.host || '127.0.0.1',
      username: ssh?.username || 'local',
      cwd: panel.cwd || '~',
      shell: panel.sessionId ? 'local-shell' : 'bash',
      connectionType: ssh ? ('ssh' as const) : ('local' as const)
    }
  }

  const generateTerminalCommand = async (panelId: string, instruction: string, modelName?: string) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    const prompt = instruction.trim()
    if (!panel || panel.kind === 'knowledge' || !prompt) return null
    const selectedModel = modelName || terminalCommandModelOptions.value[0] || config.value.modelName || 'aiopsterm-local-agent'

    const result = await window.aiops.generateTerminalCommand({
      panelId: panel.id,
      instruction: prompt,
      modelName: selectedModel,
      context: buildTerminalCommandContext(panel)
    })
    if (!result.ok || !result.data) return null
    const record = result.data
    terminalCommandGenerationRecords.value = [record, ...terminalCommandGenerationRecords.value].slice(0, 20)
    return record
  }

  const injectGeneratedTerminalCommand = (panelId: string, command: string) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    const text = command.trim()
    if (!panel || panel.kind === 'knowledge' || !text) return null
    appendTerminalSegment(panel, text, 'input')
    recordMacroTerminalInput(panel.id, text)
    return { status: 'allow' } as TerminalSecurityDecision
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

  const generateAiResponseForMessage = async (assistantId: string, input: AiChatResponseInput) => {
    const result = await window.aiops.generateAiChatResponse(input)
    const message = chatMessages.value.find((item) => item.id === assistantId)
    if (!message || message.state !== 'streaming') return
    message.state = 'done'
    message.text = result.ok && result.data?.text ? result.data.text : result.errorMessage || 'AI 响应生成失败'
    void updateCurrentConversationSnapshot()
  }

  const hostContextForExchangeRequest = (context: AiContextOption): NonNullable<AiChatExchangeRequestInput['hosts']>[number] | null => {
    if (context.kind !== 'hosts' || !context.label.trim()) return null
    return {
      id: context.id,
      kind: 'hosts',
      label: context.label,
      detail: context.detail
    }
  }

  const appendChatExchange = async (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[]) => {
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
    const userText = `${prompt}${contextLabel}${commandLabel}${knowledgeContext}${skillContext}`
    const historyForBackend: AiChatMessageInput[] = chatMessages.value.slice(-12).map((message) => ({ role: message.role, text: message.text }))
    const hostContexts = overrideHosts ?? selectedContexts.value.filter((item) => item.kind === 'hosts')
    const request = await window.aiops.createAiChatExchangeRequest({
      text: userText,
      hosts: hostContexts.map(hostContextForExchangeRequest).filter(Boolean) as AiChatExchangeRequestInput['hosts']
    })
    if (!request.ok || !request.data) return false
    const userMessage = chatHistoryMessageToChatMessage(request.data.userMessage)
    userMessage.contentParts = safeContentParts.length || hasStructuredParts ? safeContentParts : undefined
    userMessage.hosts = hostContexts
    const assistantMessage = chatHistoryMessageToChatMessage(request.data.assistantMessage)
    chatMessages.value.push(userMessage)
    chatMessages.value.push(assistantMessage)
    void generateAiResponseForMessage(assistantMessage.id, {
      prompt: userText,
      messages: [...historyForBackend, { role: 'user', text: userText }],
      contexts: messageContexts.map((item) => ({ id: item.id, kind: item.kind, label: item.label })),
      skills: selectedSkills.map((skill) => ({ name: skill.name, description: skill.description, content: skill.content })),
      command: selectedCommandRef.value
        ? { id: selectedCommandId.value || undefined, label: selectedCommandRef.value.label, command: selectedCommandRef.value.command }
        : commandDisplay
          ? { id: selectedCommandId.value || undefined, label: commandDisplay }
          : null,
      model: config.value.modelName,
      mode: mode.value === 'agents' ? 'agent' : 'command'
    })
    await updateCurrentConversationSnapshot(prompt, { notifyFailure: true, notifyUnavailable: true })
    return true
  }

  const sendChat = (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    return appendChatExchange(text, contentParts, overrideHosts)
  }

  const resendUserMessageFromParts = async (messageId: string, contentParts: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const index = chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'user')
    if (index === -1) return false
    const originalHosts = chatMessages.value[index].hosts
    const prompt = buildPlainTextFromAiParts(contentParts).trim()
    const hasStructuredParts = contentParts.some((part) => part.type !== 'text')
    if (!prompt && !hasStructuredParts) return false
    chatMessages.value.splice(index)
    return appendChatExchange(prompt, contentParts, overrideHosts ?? originalHosts)
  }

  const createConversation = async () => {
    if (!window.aiops?.createChatConversation) return null
    const result = await window.aiops.createChatConversation()
    if (!result?.ok || !result.data) return null
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    await restoreChatMessagesFromBackend(result.data.conversation.id)
    return conversations.value.find((conversation) => conversation.id === result.data!.conversation.id) || cloneConversationRecord(result.data.conversation)
  }

  const deleteConversation = async (id: string) => {
    if (!window.aiops?.deleteChatConversation) return false
    const result = await window.aiops.deleteChatConversation(id)
    if (!result?.ok || !result.data) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    if (selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    } else {
      chatMessages.value = []
    }
    return true
  }

  const selectConversation = (id: string) => {
    selectedConversationId.value = id
  }

  const renameConversation = async (id: string, title: string) => {
    const nextTitle = title.trim()
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation || !nextTitle) return false
    if (!window.aiops?.updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await window.aiops.updateChatConversation({
      id,
      title: nextTitle,
      summary: conversation.summary,
      favorite: conversation.favorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !result.data) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const toggleConversationFavorite = async (id: string) => {
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const nextFavorite = !conversation.favorite
    if (!window.aiops?.updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await window.aiops.updateChatConversation({
      id,
      title: conversation.title,
      summary: conversation.summary,
      favorite: nextFavorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !result.data) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const restoreConversation = async (id: string) => {
    const restored = await restoreChatMessagesFromBackend(id)
    if (restored) return true
    if (await loadChatConversationsFromBackend({ restoreIfEmpty: false })) {
      return restoreChatMessagesFromBackend(id)
    }
    return false
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
    void sendChat(prompt)
  }

  const selectCommandPreset = (id: string | null, commandRef?: AiCommandChipRef | null) => {
    selectedCommandId.value = id
    selectedCommandRef.value = id && commandRef ? { ...commandRef } : null
  }

  const applyMessageMetadataSnapshot = (messageId: string, messages: AiChatHistoryMessage[]) => {
    const snapshot = messages.find((message) => message.id === messageId)
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!snapshot || !message) return false
    message.favorite = snapshot.favorite
    message.feedback = snapshot.feedback
    return true
  }

  const setMessageFeedback = async (id: string, feedback: 'up' | 'down') => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    if (!window.aiops?.saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const nextFeedback = message.feedback === feedback ? null : feedback
    const result = await window.aiops.saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      feedback: nextFeedback
    })
    if (!result?.ok || !result.data) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const toggleMessageFavorite = async (id: string) => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    if (!window.aiops?.saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const result = await window.aiops.saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      favorite: !message.favorite
    })
    if (!result?.ok || !result.data) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const retryAssistantMessage = (messageId?: string) => {
    const assistantIndex = messageId
      ? chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'assistant')
      : -1
    const history = assistantIndex >= 0 ? chatMessages.value.slice(0, assistantIndex) : chatMessages.value
    const lastUserMessage = [...history].reverse().find((message) => message.role === 'user')
    if (lastUserMessage) {
      void sendChat(lastUserMessage.text, lastUserMessage.contentParts, lastUserMessage.hosts)
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
    if (!window.aiops?.kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    await window.aiops.kbMkdir('', title)
    await refreshKnowledgeTree()
    const created = findKnowledgeNode(relPath)
    return created?.type === 'dir' ? created : null
  }

  const summarizeMessageToKnowledge = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const content = messageSummaryContent(message)
    const summaryDir = await ensureLocalKnowledgeDir('summary')
    if (!summaryDir) return null
    const fileName = uniqueKnowledgeFileName('summary', knowledgeFileNameForMessage(message))
    const fallbackRelPath = createKbRelPath('summary', fileName)
    if (!window.aiops?.kbCreateFile || !window.aiops?.kbWriteFile) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await window.aiops.kbCreateFile('summary', fileName, content)
    const relPath = result?.relPath || fallbackRelPath
    await window.aiops.kbWriteFile(relPath, content)
    await refreshKnowledgeTree()

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
    if (!window.aiops?.createSkill) {
      setSettingsNotice('Skill 创建服务不可用')
      return null
    }
    try {
      const created = await window.aiops.createSkill({ name: skill.name, description: skill.description }, skill.content)
      await loadSkillsFromBridge()
      if (created) {
        applySkillsList([created, ...settingsSkills.value.filter((item) => item.name !== created.name)])
      }
      return created || skill
    } catch {
      setSettingsNotice(`${name} 创建失败`)
      return null
    }
  }

  return {
    mode,
    activeModule,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    topUpdateState,
    topNotice,
    setTopNotice,
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
    terminalCommandGenerationRecords,
    selectedContexts,
    aiSkillContextOptions,
    selectedCommandId,
    selectedCommandRef,
    filesUiMode,
    fileSessions,
    fileSessionFolders,
    selectedLeftFileSessionId,
    selectedRightFileSessionId,
    selectedLeftFileSession,
    selectedRightFileSession,
    fileTransferTasks,
    transferTaskGroups,
    transferTaskCount,
    transferOverallPercent,
    refreshFileSessionCatalog,
    refreshFileTransferTasks,
    terminalCommandModelOptions,
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
    kbContentSearchResults,
    kbSearchStatus,
    kbSearchLoading,
    kbSearchError,
    kbContentSearchVisible,
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
    refreshAliasCommands,
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
    k8sAgentClusterId,
    k8sAgentContextName,
    k8sAgentStatus,
    k8sAgentCommandDraft,
    k8sAgentCommandHistory,
    k8sAgentRuns,
    k8sAgentLastResult,
    k8sAgentTesting,
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
    aiModelOptions,
    lockedAiModelOptions,
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
    k8sAgentCluster,
    k8sAgentCurrentCluster,
    k8sResourceCluster,
    k8sActiveNamespaces,
    filteredK8sResources,
    k8sResourceSummary,
    onboardingCompletedCount,
    onboardingActiveSteps,
    onboardingActiveStep,
    todoItems,
    todoProgress,
    aiContextCatalog,
    hydrateConfig,
    loadChatConversationsFromBackend,
    refreshAiTodoSnapshot,
    refreshAiContextCatalog,
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
    uploadCustomBackground,
    selectCustomBackground,
    clearCustomBackground,
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
    refreshSshAgentKeychainOptions,
    openSshAgentConfig,
    closeSshAgentConfig,
    setSshAgentSelectedKey,
    addSshAgentKey,
    removeSshAgentKey,
    updateWorkspacePreferences,
    refreshAiModelCatalog,
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
    refreshMcpServersFromBridge,
    updatePrivacySettings,
    updateBillingSettings,
    setUserNotice,
    openAccountCenter,
    closeAccountCenter,
    refreshUserAccount,
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
    refreshSkillsFromBridge,
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
    installShortcutRuntime,
    uninstallShortcutRuntime,
    triggerShortcutAction,
    handleDeepLink,
    openTrustedDeviceRevoke,
    confirmTrustedDeviceRevoke,
    toggleMode,
    setActiveModule,
    setFilesUiMode,
    selectFileSession,
    openFileSession,
    ensureFileSessionForTerminalPanel,
    closeFileSession,
    addRemoteFileSession,
    addRemoteFileSessionFromSftpPayload,
    persistFileSession,
    updateFileSession,
    saveFileSessionFolder,
    deleteFileSessionFolder,
    pushFileTransferTask,
    recordFileTransferTask,
    cancelFileTransferTask,
    createSnippetGroup,
    renameSnippetGroup,
    deleteSnippetGroup,
    refreshQuickCommands,
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
    searchKnowledgeContent,
    reindexKnowledgeContent,
    refreshKnowledgeSearchStatus,
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
    refreshExtensionPlugins,
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
    refreshKubernetesCatalog,
    switchK8sContext,
    reloadK8sConfig,
    clearK8sSearch,
    selectK8sCluster,
    setK8sActionMenu,
    openK8sProxyConfig,
    closeK8sProxyConfig,
    updateK8sProxyConfig,
    saveK8sProxyConfig,
    setK8sAgentCluster,
    connectK8sCluster,
    disconnectK8sCluster,
    openK8sTerminal,
    createNewK8sTerminalTab,
    closeK8sTerminalTab,
    setActiveK8sTerminal,
    resizeK8sTerminal,
    endK8sTerminalSession,
    sendK8sTerminalCommand,
    executeK8sTerminalAiCommand,
    runK8sAgentKubectl,
    testK8sAgentConnection,
    refreshK8sAgentNamespaces,
    cleanupK8sAgent,
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
    importK8sKubeconfigContent,
    importK8sKubeconfigFile,
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
    registerSshSession,
    applySshTerminalSession,
    applyLocalTerminalSession,
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
    runTerminalCommand,
    writeTerminalExecution,
    executeGlobalTerminalCommand,
    runGlobalTerminalCommand,
    approveTerminalSecurityPrompt,
    cancelTerminalSecurityPrompt,
    stageActiveTerminalCommand,
    runActiveTerminalCommand,
    appendActiveTerminalInput,
    generateTerminalCommand,
    injectGeneratedTerminalCommand,
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
