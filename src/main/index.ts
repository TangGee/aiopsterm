import { app, BrowserWindow, Notification, dialog, ipcMain, net, protocol, shell, type IpcMainEvent } from 'electron'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { randomUUID } from 'crypto'
import { existsSync, watch } from 'fs'
import type { FSWatcher } from 'fs'
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import Store from 'electron-store'
import AdmZip from 'adm-zip'
import { getAsset, getAssetSecret, getKeychainSecret, refreshOrganizationAssets, saveAsset } from './backend/assets'
import { formatMcpResourceReadContent } from './backend/aiChat'
import {
  createCodexSession,
  killCodexSession,
  resizeCodexSession,
  setCodexSessionPendingContext,
  writeCodexSession
} from './backend/codexCli'
import {
  appendCodexTerminalBridgeData,
  closeCodexTerminalBridgeServer,
  ensureCodexTerminalBridgeServer,
  registerCodexTerminalBridgeSession,
  updateCodexTerminalBridgeSessionTarget,
  unregisterCodexTerminalBridgeSession
} from './backend/codexTerminalBridge'
import { closeExternalCodexMcpBridgeServer } from './backend/externalCodexMcpBridge'
import {
  closeAiAgentSessionServer,
  ensureAiAgentSessionServer,
} from './backend/agentSessions'
import {
  getChatConversationMessages,
  replaceChatConversationMessages,
} from './backend/chatHistory'
import { logRuntimeEvent } from './backend/runtimeLog'
import { broadcastWindowEvent, sendWindowEvent } from '@shared/windowEvents'
import { defaultMcpServers, defaultMcpToolStates } from '@shared/mcpSeed'
import {
  shouldRunMcpDiscovery,
  shouldUseAiChatBackendDouble,
  shouldUseE2eDialogFixtures,
} from '@shared/runtimeSwitches'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'
import { callMcpTool, clearMcpRuntimeClientCache, discoverMcpServerSnapshot, readMcpResource } from './backend/mcpRuntime'
import { normalizeConfigModelName, normalizeConfigModelProvider } from './backend/configBoundary'
import { createLocalTerminalSession, type LocalTerminalSession } from './backend/localTerminal'
import {
  closeControlSocketServer,
  ensureControlSocketServer,
  invokeControlSocketMethod,
  registerControlSocketIpc
} from './backend/controlSocket'
import { createSshTerminalSession, type SshTerminalSession } from './backend/sshTerminal'
import { recordTerminalCommandHistory } from './backend/terminalSuggestions'
import {
  createSshTerminalConnectionInfo,
  createTerminalBinaryWriteResult,
  createTerminalDataEvent,
  createTerminalKillResult,
  createTerminalWriteResult
} from './backend/terminal'
import { resolveUserAvatarAssetPath } from './backend/userAccount'
import { registerAiCatalogIpc } from './ipc/aiCatalog'
import { registerAiChatIpc } from './ipc/aiChat'
import { registerAiChatActionsIpc } from './ipc/aiChatActions'
import { configureMainBackendRuntimes } from './backend/runtimeConfiguration'
import { registerAgentHooksIpc } from './ipc/agentHooks'
import { registerAliasesIpc } from './ipc/aliases'
import { registerAppRuntimeIpc } from './ipc/appRuntime'
import { registerAppUpdateIpc } from './ipc/appUpdate'
import { registerAssetsIpc } from './ipc/assets'
import { registerChatHistoryIpc } from './ipc/chatHistory'
import { registerCodexSessionsIpc } from './ipc/codexSessions'
import { registerDatabaseIpc } from './ipc/database'
import { registerExtensionsIpc } from './ipc/extensions'
import { registerFilesIpc } from './ipc/files'
import { registerKubernetesIpc } from './ipc/kubernetes'
import { registerKnowledgeBaseIpc } from './ipc/knowledgeBase'
import { registerLocalFilesIpc } from './ipc/localFiles'
import { registerManagedAiSessionsIpc } from './ipc/managedAiSessions'
import { registerMcpConfigIpc } from './ipc/mcpConfig'
import { registerModelsIpc } from './ipc/models'
import { registerQuickCommandsIpc } from './ipc/quickCommands'
import { registerSettingsPreferencesIpc } from './ipc/settingsPreferences'
import { registerSkillsIpc } from './ipc/skills'
import { registerTerminalSessionsIpc, terminalHistoryLinesFromWrite, type TerminalSession } from './ipc/terminalSessions'
import { registerTerminalToolsIpc } from './ipc/terminalTools'
import { registerUserAccountIpc } from './ipc/userAccount'
import { registerVoiceIpc } from './ipc/voice'
import { registerWindowIpc } from './ipc/window'
import { registerZmodemIpc } from './ipc/zmodem'
import {
  aiopstermProtocolPrefix,
  aiopstermProtocolScheme,
  parseAiopstermDeepLink,
  type AiopstermDeepLinkPayload
} from '@shared/deepLink'
import {
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH,
  defaultKnowledgeBaseConfig,
  defaultKnowledgeSeedTree,
  getDefaultKnowledgeSeedFile,
  shouldUseKnowledgeSeedData
} from '@shared/knowledgeBaseSeed'
import { defaultModelSettingsConfig } from '@shared/modelSettingsSeed'
import { defaultSettingsRulesConfig } from '@shared/settingsPreferencesSeed'
import { defaultSkillSeedData, defaultSkillsConfig, shouldUseSkillSeedData } from '@shared/skillsSeed'
import { defaultWorkspacePreferencesConfig } from '@shared/workspacePreferencesSeed'
import type { CodexSessionCreateOptions, CodexSessionLifecycleEvent } from '@shared/contracts/codexSessions'
import type {
  TerminalCreateOptions,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '@shared/contracts/terminalSessions'
import type { AiAgentSessionEvent, ManagedAiSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { AliasCommandConfig } from '@shared/contracts/aliases'
import type {
  EditorUserConfig,
  KeywordHighlightUserConfig,
  KnowledgeBaseCreateResult,
  KnowledgeBaseDeleteResult,
  KnowledgeBaseImportResult,
  KnowledgeBaseNodeConfig,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseWriteResult,
  KnowledgeBaseUserConfig,
  McpConfigFile,
  McpResourceReadInput,
  McpServerUserConfig,
  McpToolCallInput,
  McpToolStatesUserConfig,
  ModelSettingsUserConfig,
  SecurityUserConfig,
  ShortcutUserConfig,
  SkillDeleteResult,
  SkillEnabledResult,
  SkillExportResult,
  SkillImportResult,
  SkillMetadataConfig,
  SkillUserConfig,
  SkillWriteResult,
  SshAgentKeyConfig,
  SshProxyConfig,
  UserConfig,
  WorkspaceUserConfig,
  UserRuleConfig
} from '@shared/preload'

if (process.env.NODE_ENV === 'test') {
  app.disableHardwareAcceleration()
}

const registerTerminalForCodexBridge = (session: TerminalSession, target?: CodexSessionCreateOptions['target']) => {
  registerCodexTerminalBridgeSession({
    id: session.id,
    kind: session.kind,
    host: session.host,
    cwd: session.cwd,
    window: session.window,
    target,
    write: (data) => {
      if (session.kind === 'ssh') {
        ;(session.process as SshTerminalSession).write(data)
      } else {
        ;(session.process as LocalTerminalSession).write(data)
      }
    }
  })
}

const writeTerminalBySessionId = async (id: string, data: string) => {
  const session = sessions.get(id)
  const bytes = Buffer.byteLength(String(data || ''), 'utf8')
  if (!session) {
    logRuntimeEvent('warn', 'control.terminal-write.missing-session', { id, bytes })
    return {
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: `Terminal session not found: ${id}`
    }
  }
  logRuntimeEvent('debug', 'control.terminal-write.request', { id, kind: session.kind, bytes })
  if (session.kind === 'ssh') {
    ;(session.process as SshTerminalSession).write(data)
  } else {
    ;(session.process as LocalTerminalSession).write(data)
  }
  terminalHistoryLinesFromWrite(data).forEach((command) => recordTerminalCommandHistory(command, { host: session.host }))
  return {
    ok: true,
    data: { id, bytes }
  }
}

const showControlNotification = (notification: import('@shared/preload').ControlNotificationRecord) => {
  if (!getConfig().notifications?.desktopNotifications) return
  if (!Notification.isSupported()) return
  const desktop = new Notification({
    title: notification.source ? `${notification.source}: ${notification.title}` : notification.title,
    body: [notification.level && notification.level !== 'info' ? `[${notification.level}]` : '', notification.group, notification.subtitle, notification.body].filter(Boolean).join('\n') || notification.title,
    silent: false
  })
  desktop.on('click', () => {
    const target = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0]
    focusWindow(target)
    void invokeControlSocketMethod('notification.open', { id: notification.id })
  })
  desktop.show()
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

const defaultKnowledgeBaseUserConfig: KnowledgeBaseUserConfig = defaultKnowledgeBaseConfig()
const defaultSettingsRulesUserConfig: UserRuleConfig[] = defaultSettingsRulesConfig()
const defaultSkillsUserConfig: SkillUserConfig[] = defaultSkillsConfig()
const defaultWorkspacePreferencesUserConfig: WorkspaceUserConfig = defaultWorkspacePreferencesConfig()
const defaultModelSettingsUserConfig: ModelSettingsUserConfig = defaultModelSettingsConfig()

const defaultConfig: UserConfig = {
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
    controlNotificationBell: true
  },
  modelSettings: defaultModelSettingsUserConfig,
  shortcuts: [
    { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
    { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
    { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
    { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
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
const pendingDeepLinks: AiopstermDeepLinkPayload[] = []
let securityConfigWatcher: FSWatcher | null = null
let keywordHighlightConfigWatcher: FSWatcher | null = null
let mcpConfigWatcher: FSWatcher | null = null
let skillsWatchers: FSWatcher[] = []
let skillsWatcherDebounce: NodeJS.Timeout | null = null

const sendTerminalExit = (owner: BrowserWindow, lifecycle: TerminalLifecycleEvent, code = lifecycle.code ?? null) => {
  sendWindowEvent(owner, 'terminal:exit', {
    id: lifecycle.id,
    code,
    kind: lifecycle.kind,
    reason: lifecycle.reason,
    isNetworkDisconnect: lifecycle.isNetworkDisconnect,
    errorCode: lifecycle.errorCode,
    errorMessage: lifecycle.errorMessage
  })
}

const terminalDataPayload = (id: string, chunk: string | Buffer) => {
  return createTerminalDataEvent(id, chunk)
}

const sendTerminalData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
  logRuntimeEvent('debug', 'terminal.data', {
    id,
    bytes: Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk || ''), 'utf8')
  })
  appendCodexTerminalBridgeData(id, chunk)
  sendWindowEvent(owner, 'terminal:data', terminalDataPayload(id, chunk))
}

const sendCodexExit = (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent, code = lifecycle.code ?? null) => {
  sendWindowEvent(owner, 'codex:exit', {
    id: lifecycle.id,
    code,
    errorCode: lifecycle.errorCode,
    errorMessage: lifecycle.errorMessage
  })
}

const sendCodexData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
  logRuntimeEvent('debug', 'codex.data', {
    id,
    bytes: Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk || ''), 'utf8')
  })
  sendWindowEvent(owner, 'codex:data', createTerminalDataEvent(id, chunk))
}

const aiAgentEventNeedsAttention = (event: AiAgentSessionEvent) => {
  if (event.source === 'codex' && event.event === 'permission_request') return false
  if (event.requestKind === 'telemetry') return false
  if (event.decisionMode === 'blocking') return true
  if (event.requestKind === 'notification') return true
  return event.actionable === true
}

const broadcastAiAgentSessionEvent = (event: AiAgentSessionEvent) => {
  logRuntimeEvent('info', 'ai-agent.event', {
    source: event.source,
    event: event.event,
    sessionId: event.sessionId,
    panelId: event.panelId,
    terminalSessionId: event.terminalSessionId
  })
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'ai-agent:session-event', event)
  if (!aiAgentEventNeedsAttention(event)) return
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: event.title || 'AI session needs attention',
    body: event.summary || `${event.source} needs attention`,
    silent: false
  })
  notification.on('click', () => {
    const target = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0]
    focusWindow(target)
    broadcastWindowEvent(BrowserWindow.getAllWindows(), 'ai-agent:session-event', event)
  })
  notification.show()
}

const broadcastManagedAiSessionFocusRequest = (request: ManagedAiSessionFocusRequest) => {
  logRuntimeEvent('info', 'ai-agent.focus-request', {
    source: request.source,
    sessionId: request.sessionId,
    panelId: request.panelId,
    terminalSessionId: request.terminalSessionId
  })
  const target = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0]
  focusWindow(target)
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'ai-agent:session-focus', request)
}

const broadcastManagedAiSessionEvent = (event: ManagedAiSessionEvent) => {
  logRuntimeEvent('debug', 'ai-agent.managed-event', {
    name: event.name,
    source: event.source,
    sessionId: event.sessionId,
    seq: event.seq
  })
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'ai-agent:managed-session-event', event)
}

const sanitizeKeyboardInteractiveResponses = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '')).slice(0, 8)
}

const sanitizeKeyboardInteractiveResponse = (value: unknown): TerminalKeyboardInteractiveResponse => {
  if (Array.isArray(value)) return { responses: sanitizeKeyboardInteractiveResponses(value) }
  if (typeof value === 'object' && value) {
    const record = value as Record<string, unknown>
    return {
      responses: sanitizeKeyboardInteractiveResponses(record.responses),
      ...(record.rememberPassword === true ? { rememberPassword: true } : {})
    }
  }
  return { responses: [] }
}

const rememberTerminalPassword = (assetId: string, password: string) => {
  if (!password) return
  const asset = getAsset(assetId)
  if (!asset || asset.isLocalShell) return
  const result = saveAsset({
    ...asset,
    id: asset.id,
    name: asset.name,
    title: asset.title,
    host: asset.host,
    ip: asset.ip,
    group: asset.group,
    group_name: asset.group_name,
    username: asset.username,
    port: asset.port,
    asset_type: asset.asset_type,
    auth_type: asset.auth_type,
    password
  })
  logRuntimeEvent(result.ok ? 'info' : 'warn', 'terminal.password.remember', {
    assetId,
    host: asset.host,
    port: asset.port,
    username: asset.username,
    ok: result.ok,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage
  })
}

const sendTerminalKeyboardInteractiveResult = (owner: BrowserWindow, result: TerminalKeyboardInteractiveResult) => {
  logRuntimeEvent(result.status === 'success' ? 'info' : 'warn', 'terminal.keyboard-interactive.result', {
    id: result.id,
    status: result.status,
    authScope: result.authScope,
    attempts: result.attempts,
    final: result.final,
    errorMessage: result.errorMessage
  })
  sendWindowEvent(owner, 'terminal:keyboard-interactive:result', result)
}

const requestTerminalKeyboardInteractive = (owner: BrowserWindow, request: TerminalKeyboardInteractiveRequest) =>
  new Promise<TerminalKeyboardInteractiveResponse>((resolve, reject) => {
    let settled = false
    const responseChannel = `terminal:keyboard-interactive:response:${request.id}`
    const cancelChannel = `terminal:keyboard-interactive:cancel:${request.id}`
    const cleanup = () => {
      ipcMain.off(responseChannel, handleResponse)
      ipcMain.off(cancelChannel, handleCancel)
      clearTimeout(timer)
    }
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const handleResponse = (event: IpcMainEvent, payload: unknown) => {
      if (event.sender !== owner.webContents) return
      settle(() => resolve(sanitizeKeyboardInteractiveResponse(payload)))
    }
    const handleCancel = (event: IpcMainEvent) => {
      if (event.sender !== owner.webContents) return
      settle(() => reject(new Error('Two-factor authentication canceled by user.')))
    }
    const timer = setTimeout(() => {
      sendTerminalKeyboardInteractiveResult(owner, {
        id: request.id,
        status: 'timeout',
        attempts: request.attempts,
        final: true,
        errorMessage: 'Two-factor authentication timed out.'
      })
      settle(() => reject(new Error('Two-factor authentication timed out.')))
    }, request.timeoutMs)

    ipcMain.on(responseChannel, handleResponse)
    ipcMain.on(cancelChannel, handleCancel)
    logRuntimeEvent('info', 'terminal.keyboard-interactive.request', {
      id: request.id,
      connectionId: request.connectionId,
      host: request.host,
      port: request.port,
      username: request.username,
      purpose: request.purpose,
      authScope: request.authScope,
      assetId: request.assetId,
      title: request.title,
      name: request.name,
      hasInstructions: Boolean(request.instructions),
      canRememberPassword: request.canRememberPassword,
      promptLabels: request.prompts.map((prompt) => prompt.prompt.slice(0, 120)),
      prompts: request.prompts.length,
      attempts: request.attempts,
      maxAttempts: request.maxAttempts
    })
    sendWindowEvent(owner, 'terminal:keyboard-interactive:request', request)
  })

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
      servers.map((server) => {
        const autoApprove = server.tools.filter((tool) => tool.autoApprove).map((tool) => tool.name)
        return [
          server.name,
          {
            type: 'stdio' as const,
            disabled: server.disabled,
            ...(autoApprove.length ? { autoApprove } : {}),
            command: server.name === 'filesystem' ? 'npx' : server.name,
            args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', app.getPath('home')] : [],
            timeout: 60
          }
        ]
      })
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

const isDev = !app.isPackaged
const rendererUrl = process.env.ELECTRON_RENDERER_URL

app.setName('aiopsterm')
app.setAppUserModelId('app.aiopsterm.desktop')

const focusWindow = (targetWindow = mainWindow || BrowserWindow.getAllWindows()[0]) => {
  if (!targetWindow || targetWindow.isDestroyed()) return null
  if (targetWindow.isMinimized()) targetWindow.restore()
  targetWindow.focus()
  return targetWindow
}

const dispatchDeepLinkToRenderer = (payload: AiopstermDeepLinkPayload) => {
  const targetWindow = focusWindow()
  if (!targetWindow) return false
  sendWindowEvent(targetWindow, 'app:deep-link', payload)
  return true
}

const handleDeepLinkUrl = (rawUrl: string) => {
  const parsed = parseAiopstermDeepLink(rawUrl)
  if (!parsed.valid) {
    return { success: false, reason: parsed.reason }
  }

  const payload = {
    ...parsed.payload,
    acceptedAt: Date.now()
  }
  pendingDeepLinks.push(payload)
  dispatchDeepLinkToRenderer(payload)
  return { success: true, payload }
}

const findDeepLinkArg = (argv: string[]) => argv.find((arg) => typeof arg === 'string' && arg.startsWith(aiopstermProtocolPrefix))

const userAvatarProtocolScheme = 'aiopsterm-user-avatar'
const backgroundProtocolScheme = 'aiopsterm-background'

protocol.registerSchemesAsPrivileged([
  {
    scheme: userAvatarProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  },
  {
    scheme: backgroundProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

const registerDeepLinkProtocol = () => {
  if (!app.isDefaultProtocolClient(aiopstermProtocolScheme)) {
    app.setAsDefaultProtocolClient(aiopstermProtocolScheme)
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
registerDeepLinkProtocol()

const registerUserAvatarProtocol = () => {
  protocol.handle(userAvatarProtocolScheme, async (request) => {
    const assetPath = resolveUserAvatarAssetPath(request.url)
    if (!assetPath) return new Response('Avatar not found', { status: 404 })
    try {
      const metadata = await stat(assetPath)
      if (!metadata.isFile()) return new Response('Avatar not found', { status: 404 })
      return net.fetch(pathToFileURL(assetPath).href)
    } catch {
      return new Response('Avatar not found', { status: 404 })
    }
  })
}

const customBackgroundUrlForPath = (filePath: string) => `${backgroundProtocolScheme}://local/${encodeURIComponent(basename(filePath))}`

const resolveCustomBackgroundAssetPath = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${backgroundProtocolScheme}:` || parsed.hostname !== 'local') return ''
    const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    if (!fileName || fileName !== basename(fileName)) return ''
    const backgroundRoot = resolve(getCustomBackgroundsPath())
    const assetPath = resolve(backgroundRoot, fileName)
    const rel = relative(backgroundRoot, assetPath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return ''
    return assetPath
  } catch {
    return ''
  }
}

const registerCustomBackgroundProtocol = () => {
  protocol.handle(backgroundProtocolScheme, async (request) => {
    const assetPath = resolveCustomBackgroundAssetPath(request.url)
    if (!assetPath) return new Response('Background not found', { status: 404 })
    try {
      const metadata = await stat(assetPath)
      if (!metadata.isFile()) return new Response('Background not found', { status: 404 })
      return net.fetch(pathToFileURL(assetPath).href)
    } catch {
      return new Response('Background not found', { status: 404 })
    }
  })
}
if (!gotSingleInstanceLock) {
  const deepLinkArg = findDeepLinkArg(process.argv)
  if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    focusWindow()
    const deepLinkArg = findDeepLinkArg(commandLine)
    if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
  })
}

app.on('open-url', (event, url) => {
  if (!url.startsWith(aiopstermProtocolPrefix)) return
  event.preventDefault()
  handleDeepLinkUrl(url)
})

const createWindow = () => {
  const appIcon = resolveAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1344,
    height: 756,
    minWidth: 1024,
    minHeight: 680,
    title: 'aiopsterm',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0f1117',
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizeExternalHttpUrl(url)
    if (normalized.valid) void shell.openExternal(normalized.url)
    return { action: 'deny' }
  })

  if (isDev && rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('maximize', () => {
    sendWindowEvent(mainWindow, 'window:maximized')
  })
  mainWindow.on('unmaximize', () => {
    sendWindowEvent(mainWindow, 'window:unmaximized')
  })
}

const resolveAppIconPath = () => {
  if (process.platform === 'darwin') return ''
  const candidates = [
    join(process.resourcesPath || '', 'icons', '256x256.png'),
    join(process.resourcesPath || '', 'resources', 'icons', '256x256.png'),
    join(__dirname, '../../resources/icons/256x256.png'),
    resolve('resources/icons/256x256.png')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) || ''
}

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

const normalizeModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  return normalizeConfigModelProvider(value, defaultConfig)
}

const normalizeModelName = (value: unknown) => {
  return normalizeConfigModelName(value, defaultConfig)
}

const normalizeLayoutWidth = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 220 && value <= 640 ? Math.round(value) : fallback

const mergeConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
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

const terminalTypeOptions = new Set(['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi'])

const normalizeTerminalType = (value: unknown, fallback: string) => {
  const terminalType = typeof value === 'string' ? value.trim() : ''
  return terminalTypeOptions.has(terminalType) ? terminalType : fallback
}

const getSecurityConfigPath = () => join(app.getPath('userData'), 'security-config.json')
const getKeywordHighlightConfigPath = () => join(app.getPath('userData'), 'keyword-highlight.json')
const getMcpConfigPath = () => join(app.getPath('userData'), 'setting', 'mcp_settings.json')
const getSkillsUserPath = () => join(app.getPath('userData'), 'skills')
const getSkillsInitMarkerPath = () => join(getSkillsUserPath(), '.aiopsterm-skills-initialized')
const getSkillFilePath = (skillDirName: string) => join(getSkillsUserPath(), skillDirName, 'SKILL.md')
const getKnowledgeBasePath = () => join(app.getPath('userData'), 'knowledgebase')
const getKnowledgeBaseInitMarkerPath = () => join(getKnowledgeBasePath(), '.aiopsterm-knowledge-initialized')
const getChatAttachmentsPath = () => join(app.getPath('userData'), 'chat-attachments')
const getCustomBackgroundsPath = () => join(app.getPath('userData'), 'backgrounds')
const getLogDirPath = () => join(app.getPath('userData'), 'logs')
const settingsExternalActionRuntime = () => ({
  userDataPath: app.getPath('userData'),
  appPath: app.getAppPath(),
  cwd: process.cwd(),
  moduleDir: __dirname,
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  openPath: (targetPath: string) => shell.openPath(targetPath),
  skipOpen: shouldUseE2eDialogFixtures()
})

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
const knowledgeSearchExtensions = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.log',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.csv',
  '.tsv',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.js',
  '.ts',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.html',
  '.css',
  '.xml'
])
const maxKnowledgeImportBytes = 10 * 1024 * 1024
const maxKnowledgeSearchFileBytes = 2 * 1024 * 1024
const maxKnowledgeSearchQueryLength = 512

const normalizeKnowledgeRelPath = (relPath: string) => relPath.replace(/\\/g, '/').replace(/^\/+/, '')

type KnowledgeSearchChunk = {
  id: string
  path: string
  startLine: number
  endLine: number
  text: string
  normalizedText: string
  tokens: string[]
}

type KnowledgeSearchIndex = {
  chunks: KnowledgeSearchChunk[]
  status: KnowledgeBaseSearchStatus
}

let knowledgeSearchIndex: KnowledgeSearchIndex | null = null

const invalidateKnowledgeSearchIndex = () => {
  knowledgeSearchIndex = null
}

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

const knowledgeMutationEntry = async (relPath: string, absPath: string): Promise<KnowledgeBaseCreateResult> => {
  const metadata = await stat(absPath)
  if (metadata.isDirectory()) {
    return {
      relPath,
      type: 'dir',
      mtimeMs: metadata.mtimeMs
    }
  }
  if (!metadata.isFile()) throw new Error('Knowledge target is not a file or directory')
  return {
    relPath,
    type: 'file',
    size: metadata.size,
    mtimeMs: metadata.mtimeMs
  }
}

const knowledgeWriteResult = async (relPath: string, absPath: string, expectedBytes: number): Promise<KnowledgeBaseWriteResult> => {
  const entry = await knowledgeMutationEntry(relPath, absPath)
  if (entry.type !== 'file') throw new Error('Knowledge write target is not a file')
  if (entry.size !== expectedBytes) throw new Error('Knowledge write size does not match content byte count')
  return {
    relPath: entry.relPath,
    type: 'file',
    size: entry.size,
    bytes: expectedBytes,
    mtimeMs: entry.mtimeMs
  }
}

const knowledgeDeletedResult = async (relPath: string, type: 'file' | 'dir', absPath: string): Promise<KnowledgeBaseDeleteResult> => {
  if (await pathExists(absPath)) throw new Error('Knowledge delete target still exists')
  return {
    success: true,
    relPath,
    type,
    deleted: true
  }
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

const isKnowledgeSearchableFile = (relPath: string, size: number) => {
  const ext = extname(relPath).toLowerCase()
  return size <= maxKnowledgeSearchFileBytes && knowledgeSearchExtensions.has(ext)
}

const normalizeKnowledgeSearchText = (value: string) => value.toLowerCase().normalize('NFKC')

const tokenizeKnowledgeSearch = (value: string) =>
  Array.from(new Set(normalizeKnowledgeSearchText(value).match(/[\p{L}\p{N}_-]+/gu) || [])).filter((token) => token.length > 1)

const createKnowledgeSearchSnippet = (text: string, queryTokens: string[]) => {
  const compact = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (!compact) return ''
  const normalized = normalizeKnowledgeSearchText(compact)
  const firstMatch = queryTokens.reduce((best, token) => {
    const index = normalized.indexOf(token)
    return index === -1 ? best : Math.min(best, index)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(firstMatch)) return compact.slice(0, 260)
  const start = Math.max(0, firstMatch - 80)
  const end = Math.min(compact.length, firstMatch + 180)
  return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`
}

const chunkKnowledgeSearchText = (relPath: string, content: string): KnowledgeSearchChunk[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const chunks: KnowledgeSearchChunk[] = []
  const maxLines = 36
  const overlapLines = 6
  for (let start = 0; start < lines.length; start += maxLines - overlapLines) {
    const slice = lines.slice(start, start + maxLines)
    const text = slice.join('\n').trim()
    if (!text) continue
    chunks.push({
      id: `${relPath}:${start + 1}`,
      path: relPath,
      startLine: start + 1,
      endLine: Math.min(lines.length, start + slice.length),
      text,
      normalizedText: normalizeKnowledgeSearchText(text),
      tokens: tokenizeKnowledgeSearch(text)
    })
    if (start + maxLines >= lines.length) break
  }
  return chunks
}

const walkKnowledgeSearchFiles = async (relDir = ''): Promise<Array<{ relPath: string; size: number }>> => {
  const files: Array<{ relPath: string; size: number }> = []
  const entries = await listKnowledgeDir(relDir)
  for (const entry of entries) {
    if (entry.type === 'dir') {
      files.push(...(await walkKnowledgeSearchFiles(entry.relPath)))
    } else if (isKnowledgeSearchableFile(entry.relPath, entry.size || 0)) {
      files.push({ relPath: entry.relPath, size: entry.size || 0 })
    }
  }
  return files
}

const buildKnowledgeSearchIndex = async (): Promise<KnowledgeSearchIndex> => {
  await ensureKnowledgeBaseDirectory()
  const files = await walkKnowledgeSearchFiles('')
  const chunks: KnowledgeSearchChunk[] = []
  for (const file of files) {
    const { absPath } = resolveKnowledgePath(file.relPath)
    try {
      const content = await readFile(absPath, 'utf-8')
      chunks.push(...chunkKnowledgeSearchText(file.relPath, content))
    } catch {
      // Ignore unreadable/binary-like text files; the tree and editor read paths still surface file errors.
    }
  }
  return {
    chunks,
    status: {
      totalFiles: files.length,
      totalChunks: chunks.length,
      provider: 'aiopsterm-local',
      model: 'lexical',
      updatedAt: Date.now()
    }
  }
}

const getKnowledgeSearchIndex = async () => {
  if (!knowledgeSearchIndex) {
    knowledgeSearchIndex = await buildKnowledgeSearchIndex()
  }
  return knowledgeSearchIndex
}

const scoreKnowledgeChunk = (chunk: KnowledgeSearchChunk, query: string, queryTokens: string[]) => {
  const normalizedQuery = normalizeKnowledgeSearchText(query)
  let matchCount = 0
  let score = 0
  if (chunk.normalizedText.includes(normalizedQuery)) {
    matchCount += 1
    score += 1.5
  }
  for (const token of queryTokens) {
    const occurrences = chunk.normalizedText.split(token).length - 1
    if (occurrences <= 0) continue
    matchCount += occurrences
    score += Math.min(occurrences, 4) * (chunk.tokens.includes(token) ? 0.55 : 0.3)
  }
  const fileName = normalizeKnowledgeSearchText(basename(chunk.path))
  if (queryTokens.some((token) => fileName.includes(token))) {
    score += 0.35
  }
  return { score, matchCount }
}

const searchKnowledgeIndex = async (query: string, options?: { maxResults?: number; minScore?: number }): Promise<KnowledgeBaseSearchResult[]> => {
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''
  if (!normalizedQuery || normalizedQuery.length > maxKnowledgeSearchQueryLength) return []
  const queryTokens = tokenizeKnowledgeSearch(normalizedQuery)
  if (!queryTokens.length) return []
  const maxResults = Math.min(Math.max(Math.floor(options?.maxResults || 20), 1), 50)
  const minScore = Math.max(options?.minScore ?? 0.15, 0)
  const index = await getKnowledgeSearchIndex()
  return index.chunks
    .map((chunk) => {
      const scored = scoreKnowledgeChunk(chunk, normalizedQuery, queryTokens)
      return {
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: Number(scored.score.toFixed(4)),
        snippet: createKnowledgeSearchSnippet(chunk.text, queryTokens),
        matchCount: scored.matchCount
      }
    })
    .filter((result) => result.score >= minScore && result.matchCount > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, maxResults)
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
    const seedFile = getDefaultKnowledgeSeedFile(relPath)
    if (seedFile?.kind === 'base64') {
      await writeFile(absPath, Buffer.from(seedFile.base64, 'base64'))
    } else {
      await writeFile(absPath, seedFile?.content || '', 'utf-8')
    }
  }
}

const migrateKnowledgeSeedPlaceholders = async () => {
  const seedFile = getDefaultKnowledgeSeedFile(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH)
  if (seedFile?.kind !== 'base64') return
  try {
    const { absPath } = resolveKnowledgePath(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_REL_PATH)
    const current = await readFile(absPath)
    if (current.toString('utf-8') === 'aiopsterm knowledge image placeholder\n') {
      await writeFile(absPath, Buffer.from(seedFile.base64, 'base64'))
    }
  } catch {
    // Missing user-edited default images are left untouched after initial seeding.
  }
}

const ensureKnowledgeBaseDirectory = async () => {
  const knowledgePath = getKnowledgeBasePath()
  await mkdir(knowledgePath, { recursive: true })
  try {
    await access(getKnowledgeBaseInitMarkerPath())
  } catch {
    if (shouldUseKnowledgeSeedData()) {
      for (const node of defaultKnowledgeSeedTree()) {
        await ensureKnowledgeSeedNode(node)
      }
    }
    await writeFile(getKnowledgeBaseInitMarkerPath(), 'initialized\n', 'utf-8')
  }
  await migrateKnowledgeSeedPlaceholders()
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
    totalBytes: config.knowledgeBase?.totalBytes || defaultKnowledgeBaseUserConfig.totalBytes
  }
  store.set('config', mergeConfig(config, { knowledgeBase: nextKnowledgeBase }))
  invalidateKnowledgeSearchIndex()
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
  sendWindowEvent(window, 'kb:transfer-progress', payload)
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
    if (shouldUseSkillSeedData() && !(await hasAnySkillFile(skillsPath))) {
      await seedSkillsFromConfig(defaultSkillSeedData())
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
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'skills:update', skills)
}

const syncSkillsConfigFromDisk = async () => {
  const skills = await loadSkillsFromDisk()
  store.set('config', mergeConfig(getConfig(), { skills }))
  broadcastSkillsUpdate(skills)
  return skills
}

const createSkillWriteResult = async (skill: SkillUserConfig, filePath = skill.path): Promise<SkillWriteResult> => {
  if (!filePath) {
    throw new Error(`Skill file path missing: ${skill.name}`)
  }
  const [metadata, content] = await Promise.all([stat(filePath), readFile(filePath)])
  return {
    skill,
    filePath,
    bytes: Buffer.byteLength(content),
    size: metadata.size,
    mtimeMs: metadata.mtimeMs
  }
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
  if (await pathExists(targetDir)) {
    if (!overwrite) {
      return {
        success: false,
        skillName: metadata.name,
        error: `Skill "${metadata.name}" already exists`,
        errorCode: 'DIR_EXISTS'
      }
    }
    await rm(targetDir, { recursive: true, force: true })
    if (await pathExists(targetDir)) {
      return { success: false, skillName: metadata.name, error: 'Failed to replace existing skill directory', errorCode: 'EXTRACT_FAILED' }
    }
  }

  try {
    await mkdir(targetDir, { recursive: true })
    let writtenFiles = 0
    let writtenBytes = 0
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
      const data = entry.getData()
      await writeFile(targetPath, data)
      writtenFiles += 1
      writtenBytes += data.byteLength
    }
    await startSkillsWatcher()
    const imported = await findSkillByName(metadata.name)
    if (!imported?.path) throw new Error(`Imported skill not found: ${metadata.name}`)
    return {
      success: true,
      skillName: metadata.name,
      skill: imported,
      importedPath: imported.path,
      bytes: writtenBytes,
      files: writtenFiles,
      importedAt: new Date().toISOString()
    }
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
  return { skill, zipBuffer: zip.toBuffer() }
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

const applyMcpConfigFileSnapshot = async (parsed: McpConfigFile) => {
  await clearMcpRuntimeClientCache()
  const current = getConfig()
  const snapshot = await discoverMcpServerSnapshot(parsed, {
    existingServers: current.mcpServers || [],
    toolStates: current.mcpToolStates || {},
    clientName: 'aiopsterm',
    clientVersion: app.getVersion(),
    runDiscovery: shouldRunMcpDiscovery()
  })
  const next = mergeConfig(current, { mcpServers: snapshot.mcpServers, mcpToolStates: snapshot.mcpToolStates })
  store.set('config', next)
  return {
    mcpConfig: parsed,
    mcpServers: cloneMcpServers(next.mcpServers) || [],
    mcpToolStates: cloneMcpToolStates(next.mcpToolStates) || {}
  }
}

const mcpConfigWriteSuccess = (data: Awaited<ReturnType<typeof applyMcpConfigFileSnapshot>>) => ({ ok: true, data })

const mcpConfigWriteError = (error: unknown, fallbackCode: string, fallbackMessage: string) => ({
  ok: false,
  errorCode: fallbackCode,
  errorMessage: error instanceof Error ? error.message : fallbackMessage
})

const syncMcpConfigFromContent = async (content: string) => {
  if (!content.trim()) return
  return applyMcpConfigFileSnapshot(normalizeMcpConfigFile(JSON.parse(content)))
}

const loadCurrentMcpConfigFile = async () => {
  const configPath = await ensureMcpConfigFile()
  return normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
}

const runtimeConfiguration = configureMainBackendRuntimes({
  getConfig,
  getDefaultShell,
  getLogDirPath,
  focusWindow,
  loadCurrentMcpConfigFile,
  listKnowledgeDir,
  buildKnowledgeTreeFromDisk: () => buildKnowledgeTreeFromDisk(),
  loadSkillsFromDisk,
  rememberTerminalPassword,
  refreshOrganizationAssets,
  writeTerminalBySessionId,
  showControlNotification,
  broadcastManagedAiSessionFocusRequest,
  broadcastManagedAiSessionEvent
})

const setMcpToolState = async (serverName: string, toolName: string, enabled: boolean) => {
  const normalizedServerName = serverName.trim()
  const normalizedToolName = toolName.trim()
  if (!normalizedServerName || !normalizedToolName) {
    throw new Error('MCP server and tool names are required')
  }
  const current = getConfig()
  const servers = cloneMcpServers(current.mcpServers) || []
  const server = servers.find((item) => item.name === normalizedServerName)
  if (!server) {
    throw new Error(`MCP server not found: ${normalizedServerName}`)
  }
  const tool = server.tools.find((item) => item.name === normalizedToolName)
  if (!tool) {
    throw new Error(`MCP tool not found: ${normalizedServerName}:${normalizedToolName}`)
  }
  tool.enabled = enabled
  store.set(
    'config',
    mergeConfig(current, {
      mcpServers: servers,
      mcpToolStates: {
        ...(current.mcpToolStates || {}),
        [`${normalizedServerName}:${normalizedToolName}`]: enabled
      }
    })
  )
  const configPath = await ensureMcpConfigFile()
  const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
  const snapshot = await applyMcpConfigFileSnapshot(parsed)
  return mcpConfigWriteSuccess(snapshot)
}

const setMcpToolAutoApprove = async (serverName: string, toolName: string, autoApprove: boolean) => {
  const normalizedServerName = serverName.trim()
  const normalizedToolName = toolName.trim()
  if (!normalizedServerName || !normalizedToolName) {
    throw new Error('MCP server and tool names are required')
  }
  const current = getConfig()
  const existingServer = current.mcpServers?.find((server) => server.name === normalizedServerName)
  if (!existingServer) {
    throw new Error(`MCP server not found: ${normalizedServerName}`)
  }
  if (!existingServer.tools.some((tool) => tool.name === normalizedToolName)) {
    throw new Error(`MCP tool not found: ${normalizedServerName}:${normalizedToolName}`)
  }

  const configPath = await ensureMcpConfigFile()
  const parsed = normalizeMcpConfigFile(JSON.parse(await readFile(configPath, 'utf-8')))
  const server = parsed.mcpServers[normalizedServerName]
  if (!server) {
    throw new Error(`MCP server config not found: ${normalizedServerName}`)
  }

  const approved = new Set((server.autoApprove || []).filter(Boolean))
  if (autoApprove) {
    approved.add(normalizedToolName)
  } else {
    approved.delete(normalizedToolName)
  }
  const nextAutoApprove = [...approved]
  if (nextAutoApprove.length) {
    server.autoApprove = nextAutoApprove
  } else {
    delete server.autoApprove
  }

  const nextContent = JSON.stringify(parsed, null, 2)
  await writeFile(configPath, nextContent, 'utf-8')
  const snapshot = await applyMcpConfigFileSnapshot(parsed)
  broadcastMcpConfigChanged(nextContent)
  return mcpConfigWriteSuccess(snapshot)
}

const callCurrentMcpTool = async (input: McpToolCallInput) => {
  const current = getConfig()
  return callMcpTool(await loadCurrentMcpConfigFile(), input, {
    servers: current.mcpServers || [],
    toolStates: current.mcpToolStates || {},
    clientName: 'aiopsterm',
    clientVersion: app.getVersion()
  })
}

const readCurrentMcpResource = async (input: McpResourceReadInput) => {
  const current = getConfig()
  return readMcpResource(await loadCurrentMcpConfigFile(), input, {
    servers: current.mcpServers || [],
    clientName: 'aiopsterm',
    clientVersion: app.getVersion()
  })
}

const broadcastMcpConfigChanged = (content: string) => {
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'mcp-config:changed', content)
}

const syncKeywordHighlightConfigFromContent = (content: string) => {
  if (!content.trim()) return
  const parsed = JSON.parse(content) as Partial<UserConfig>
  if (!parsed.keywordHighlight && !('keyword-highlight' in parsed)) return
  const nextKeywordHighlight = normalizeKeywordHighlightConfig(parsed.keywordHighlight || parsed)
  const next = mergeConfig(getConfig(), { keywordHighlight: nextKeywordHighlight })
  store.set('config', next)
  return next.keywordHighlight
}

const broadcastKeywordHighlightConfigChanged = (content: string) => {
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'keyword-highlight-config:changed', content)
}

const syncSecurityConfigFromContent = (content: string) => {
  const cleaned = removeJsonComments(content)
  if (!cleaned) return
  const parsed = JSON.parse(cleaned) as Partial<UserConfig>
  if (!parsed.securityConfig && !('security' in parsed)) return
  const nextSecurityConfig = normalizeSecurityConfig(parsed.securityConfig || parsed)
  const next = mergeConfig(getConfig(), { securityConfig: nextSecurityConfig })
  store.set('config', next)
  return next.securityConfig
}

const broadcastSecurityConfigChanged = (content: string) => {
  broadcastWindowEvent(BrowserWindow.getAllWindows(), 'security-config:changed', content)
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
      await syncMcpConfigFromContent(content)
      broadcastMcpConfigChanged(content)
    } catch {
      // External editors can briefly replace the file; the next watch event or read call will recover.
    }
  })
}

const createSshTerminal = (owner: BrowserWindow, id: string, options: TerminalCreateOptions) => {
  return createSshTerminalSession(id, options, {
    lifecycle: (event) => {
      logRuntimeEvent(event.stage === 'error' ? 'error' : 'info', 'terminal.lifecycle', {
        id: event.id,
        kind: event.kind,
        stage: event.stage,
        reason: event.reason,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
        message: event.message,
        host: event.host,
        port: event.port,
        username: event.username,
        targetHost: event.targetHost,
        targetPort: event.targetPort,
        targetUsername: event.targetUsername,
        jumpHost: event.jumpHost,
        jumpPort: event.jumpPort,
        jumpUsername: event.jumpUsername,
        authScope: event.authScope,
        authPurpose: event.authPurpose,
        sshTransport: event.sshTransport,
        sshAuthMethods: event.sshAuthMethods,
        connectionReuse: event.connectionReuse,
        remoteHop: event.remoteHop,
        expectedHost: event.expectedHost,
        actualHost: event.actualHost,
        actualUsername: event.actualUsername,
        endpointConfidence: event.endpointConfidence,
        proxyName: event.proxyName
      })
      sendWindowEvent(owner, 'terminal:lifecycle', event)
    },
    exit: (event, code) => {
      logRuntimeEvent('info', 'terminal.exit', {
        id: event.id,
        kind: event.kind,
        code: code ?? event.code ?? null,
        reason: event.reason,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage
      })
      sendTerminalExit(owner, event, code ?? event.code ?? null)
    },
    data: (chunk) => sendTerminalData(owner, id, chunk),
    keyboardInteractive: (request) => requestTerminalKeyboardInteractive(owner, request),
    keyboardInteractiveResult: (result) => sendTerminalKeyboardInteractiveResult(owner, result),
    closed: () => {
      unregisterCodexTerminalBridgeSession(id)
      sessions.delete(id)
      logRuntimeEvent('info', 'terminal.session-removed', { id, kind: 'ssh' })
    }
  })
}

const registerIpc = () => {
  registerControlSocketIpc(ipcMain)
  registerAgentHooksIpc(ipcMain)
  registerAiCatalogIpc(ipcMain)
  registerAiChatIpc(ipcMain)
  registerAppUpdateIpc(ipcMain, {
    getVersion: () => app.getVersion(),
    getUserDataPath: () => app.getPath('userData')
  })
  registerAppRuntimeIpc(ipcMain, {
    getPlatform: () => process.platform,
    getDefaultShell,
    handleProtocolUrl: (rawUrl) => handleDeepLinkUrl(rawUrl),
    consumeDeepLinks: () => {
      const queue = [...pendingDeepLinks]
      pendingDeepLinks.length = 0
      return queue
    },
    openExternal: (url) => shell.openExternal(url),
    openPath: (targetPath) => shell.openPath(targetPath),
    getLogDirPath,
    createSettingsExternalActionRuntime: settingsExternalActionRuntime,
    getConfig,
    saveConfigPatch: (patch) => {
      const next = mergeConfig(getConfig(), patch)
      store.set('config', next)
      runtimeConfiguration.syncManagedAiAutoNamingRuntime(next)
      return next
    },
    shouldSkipOpenPath: shouldUseE2eDialogFixtures
  })
  registerAssetsIpc(ipcMain, {
    showSaveDialog: (options) => {
      const owner = BrowserWindow.getFocusedWindow()
      if (shouldUseE2eDialogFixtures()) {
        return Promise.resolve({
          canceled: false,
          filePath: join(app.getPath('downloads'), basename(options.defaultPath))
        })
      }
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerLocalFilesIpc(ipcMain, {
    showOpenDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
    },
    showSaveDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    },
    shouldUseE2eDialogFixtures,
    getUserDataPath: () => app.getPath('userData'),
    getDownloadsPath: () => app.getPath('downloads'),
    getChatAttachmentsPath,
    getCustomBackgroundsPath,
    customBackgroundUrlForPath
  })
  registerAliasesIpc(ipcMain)
  registerChatHistoryIpc(ipcMain)
  registerDatabaseIpc(ipcMain, {
    showSaveDialog: (options) => {
      const owner = BrowserWindow.getFocusedWindow()
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerExtensionsIpc(ipcMain, {
    openExternal: (url) => shell.openExternal(url)
  })
  registerFilesIpc(ipcMain)
  registerKubernetesIpc(ipcMain)
  registerManagedAiSessionsIpc(ipcMain, {
    emitAgentSessionEvent: broadcastAiAgentSessionEvent,
    focusManagedAiSession: broadcastManagedAiSessionFocusRequest
  })
  registerModelsIpc(ipcMain, {
    getConfig,
    isLocalChatBackendAvailable: shouldUseAiChatBackendDouble
  })
  registerQuickCommandsIpc(ipcMain)
  registerSettingsPreferencesIpc(ipcMain, {
    getConfig,
    saveConfigPatch: (patch) => {
      const next = mergeConfig(getConfig(), patch)
      store.set('config', next)
      return next
    }
  })
  registerTerminalToolsIpc(ipcMain)
  registerUserAccountIpc(ipcMain)
  registerVoiceIpc(ipcMain)
  registerWindowIpc(ipcMain)
  registerZmodemIpc(ipcMain, {
    showOpenDialog: (options) => {
      const owner = BrowserWindow.getFocusedWindow()
      return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
    },
    showSaveDialog: (options) => {
      const owner = BrowserWindow.getFocusedWindow()
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerMcpConfigIpc(ipcMain, {
    ensureSecurityConfigFile,
    ensureKeywordHighlightConfigFile,
    ensureMcpConfigFile,
    removeJsonComments,
    normalizeSecurityConfig,
    normalizeKeywordHighlightConfig,
    normalizeMcpConfigFile,
    saveConfigPatch: (patch) => {
      const next = mergeConfig(getConfig(), patch)
      store.set('config', next)
      return next
    },
    getMcpServers: () => cloneMcpServers(getConfig().mcpServers) || [],
    applyMcpConfigFileSnapshot,
    syncMcpConfigFromContent,
    setMcpToolState,
    setMcpToolAutoApprove,
    callMcpTool: callCurrentMcpTool,
    readMcpResource: readCurrentMcpResource,
    broadcastSecurityConfigChanged,
    broadcastKeywordHighlightConfigChanged,
    broadcastMcpConfigChanged
  })
  registerAiChatActionsIpc(ipcMain, {
    getChatConversationMessages,
    replaceChatConversationMessages,
    setMcpToolAutoApprove,
    callMcpTool: callCurrentMcpTool,
    readMcpResource: readCurrentMcpResource,
    formatMcpResourceReadContent,
    showChatExportSaveDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (shouldUseE2eDialogFixtures()) {
        return Promise.resolve({
          canceled: false,
          filePath: join(app.getPath('downloads'), basename(options.defaultPath))
        })
      }
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerSkillsIpc(ipcMain, {
    syncSkillsConfigFromDisk,
    loadSkillsFromDisk,
    saveSkillsSnapshot: (skills) => store.set('config', mergeConfig(getConfig(), { skills })),
    broadcastSkillsUpdate,
    ensureSkillsDirectory,
    validateSkillMetadata,
    normalizeSkillNameForDirectory,
    buildSkillFile,
    startSkillsWatcher,
    findSkillByName,
    createSkillWriteResult,
    isEditableSkill,
    pathExists,
    openPath: (targetPath) => shell.openPath(targetPath),
    importSkillZip,
    exportSkillZipBuffer,
    showSaveDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerKnowledgeBaseIpc(ipcMain, {
    ensureKnowledgeBaseDirectory,
    syncKnowledgeBaseConfigFromDisk,
    listKnowledgeDir,
    resolveKnowledgePath,
    getKnowledgeMimeType,
    isKnowledgeImage: (relPath) => knowledgeImageExtensions.has(extname(relPath).toLowerCase()),
    knowledgeWriteResult,
    knowledgeMutationEntry,
    knowledgeDeletedResult,
    isSafeKnowledgeBasename,
    ensureUniqueKnowledgeName,
    pathExists,
    isKnowledgeFileAllowedForImport,
    maxKnowledgeImportBytes,
    collectKnowledgeImportTasks,
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    sendKnowledgeProgress,
    searchKnowledgeIndex,
    getKnowledgeSearchIndex,
    buildKnowledgeSearchIndex,
    setKnowledgeSearchIndex: (index) => {
      knowledgeSearchIndex = index
    }
  })
  registerTerminalSessionsIpc(ipcMain, {
    sessions,
    getConfig,
    defaultTerminalType: defaultConfig.terminal?.terminalType,
    normalizeTerminalType,
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    createId: () => randomUUID(),
    logRuntimeEvent,
    createSshTerminal,
    createSshTerminalConnectionInfo,
    createTerminalWriteResult,
    createTerminalBinaryWriteResult,
    createTerminalKillResult,
    createLocalTerminal: (owner, id, options) =>
      createLocalTerminalSession(id, options, {
        lifecycle: (event) => {
          logRuntimeEvent(event.stage === 'error' ? 'error' : 'info', 'terminal.lifecycle', {
            id: event.id,
            kind: event.kind,
            stage: event.stage,
            shell: event.shell,
            cwd: event.cwd,
            reason: event.reason,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage
          })
          sendWindowEvent(owner, 'terminal:lifecycle', event)
        },
        exit: (event, code) => {
          logRuntimeEvent('info', 'terminal.exit', {
            id: event.id,
            kind: event.kind,
            code: code ?? event.code ?? null,
            reason: event.reason,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage
          })
          sendTerminalExit(owner, event, code ?? event.code ?? null)
        },
        data: (chunk) => sendTerminalData(owner, id, chunk),
        closed: () => {
          unregisterCodexTerminalBridgeSession(id)
          sessions.delete(id)
          logRuntimeEvent('info', 'terminal.session-removed', { id, kind: 'local' })
        }
      }),
    registerTerminalForCodexBridge,
    recordTerminalCommandHistory
  })

  registerCodexSessionsIpc(ipcMain, {
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    createId: () => randomUUID(),
    getUserDataPath: () => app.getPath('userData'),
    logRuntimeEvent,
    ensureCodexTerminalBridgeServer,
    updateCodexTerminalBridgeSessionTarget,
    createCodexSession,
    setCodexSessionPendingContext,
    writeCodexSession,
    resizeCodexSession,
    killCodexSession,
    sendCodexLifecycle: (owner, lifecycle) => sendWindowEvent(owner, 'codex:lifecycle', lifecycle),
    sendCodexExit,
    sendCodexData
  })

}

app.whenReady().then(async () => {
  registerUserAvatarProtocol()
  registerCustomBackgroundProtocol()
  registerIpc()
  await ensureControlSocketServer(app.getPath('userData'))
  await ensureAiAgentSessionServer({
    userDataPath: app.getPath('userData'),
    emit: broadcastAiAgentSessionEvent
  })
  await Promise.all([startSecurityConfigWatcher(), startKeywordHighlightConfigWatcher(), startMcpConfigWatcher(), startSkillsWatcher()])
  createWindow()
  const deepLinkArg = findDeepLinkArg(process.argv)
  if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeAiAgentSessionServer()
  closeControlSocketServer()
  closeCodexTerminalBridgeServer()
  closeExternalCodexMcpBridgeServer()
  sessions.forEach((session) => {
    if (session.kind === 'ssh') {
      ;(session.process as SshTerminalSession).kill()
    } else {
      ;(session.process as LocalTerminalSession).kill()
    }
  })
  sessions.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeControlSocketServer()
  closeCodexTerminalBridgeServer()
  closeExternalCodexMcpBridgeServer()
  securityConfigWatcher?.close()
  securityConfigWatcher = null
  keywordHighlightConfigWatcher?.close()
  keywordHighlightConfigWatcher = null
  mcpConfigWatcher?.close()
  mcpConfigWatcher = null
  void clearMcpRuntimeClientCache()
  closeSkillsWatchers()
  if (skillsWatcherDebounce) {
    clearTimeout(skillsWatcherDebounce)
    skillsWatcherDebounce = null
  }
})
