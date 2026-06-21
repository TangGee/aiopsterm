import { app, BrowserWindow, Notification, dialog, ipcMain, net, protocol, shell, type IpcMainEvent } from 'electron'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import Store from 'electron-store'
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
import { normalizeConfigModelName, normalizeConfigModelProvider } from './backend/configBoundary'
import { createKnowledgeBaseRuntime } from './backend/knowledgeBaseRuntime'
import { createLocalTerminalSession, type LocalTerminalSession } from './backend/localTerminal'
import { createSettingsConfigRuntime } from './backend/settingsConfigRuntime'
import { createSkillsRuntime } from './backend/skillsRuntime'
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
  defaultKnowledgeBaseConfig
} from '@shared/knowledgeBaseSeed'
import { defaultModelSettingsConfig } from '@shared/modelSettingsSeed'
import { defaultSettingsRulesConfig } from '@shared/settingsPreferencesSeed'
import { defaultSkillsConfig } from '@shared/skillsSeed'
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
import type { ControlNotificationRecord } from '@shared/contracts/control'
import type {
  EditorUserConfig,
  KeywordHighlightUserConfig,
  ModelSettingsUserConfig,
  SecurityUserConfig,
  SshAgentKeyConfig,
  SshProxyConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type { ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type {
  KnowledgeBaseNodeConfig,
  KnowledgeBaseUserConfig
} from '@shared/contracts/knowledgeBase'
import type { SkillUserConfig } from '@shared/contracts/skills'

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

const showControlNotification = (notification: ControlNotificationRecord) => {
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

const skillsRuntime = createSkillsRuntime({
  userDataPath: () => app.getPath('userData'),
  getSkillsSnapshot: () => getConfig().skills || [],
  saveSkillsSnapshot: (skills) => store.set('config', mergeConfig(getConfig(), { skills })),
  broadcastWindows: () => BrowserWindow.getAllWindows()
})

const knowledgeBaseRuntime = createKnowledgeBaseRuntime({
  userDataPath: () => app.getPath('userData'),
  getConfig,
  defaultKnowledgeBase: defaultKnowledgeBaseUserConfig,
  saveKnowledgeBase: (knowledgeBase) => store.set('config', mergeConfig(getConfig(), { knowledgeBase }))
})

const settingsConfigRuntime = createSettingsConfigRuntime({
  userDataPath: () => app.getPath('userData'),
  getConfig,
  saveConfig: (config) => store.set('config', config),
  mergeConfig,
  normalizeSecurityConfig,
  normalizeKeywordHighlightConfig,
  normalizeMcpConfigFile,
  mcpConfigFromUserConfig,
  cloneMcpServers,
  cloneMcpToolStates,
  defaultSecurityConfig,
  defaultKeywordHighlightConfig,
  appVersion: () => app.getVersion(),
  getWindows: () => BrowserWindow.getAllWindows()
})

const terminalTypeOptions = new Set(['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi'])

const normalizeTerminalType = (value: unknown, fallback: string) => {
  const terminalType = typeof value === 'string' ? value.trim() : ''
  return terminalTypeOptions.has(terminalType) ? terminalType : fallback
}

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

const runtimeConfiguration = configureMainBackendRuntimes({
  getConfig,
  getDefaultShell,
  getLogDirPath,
  focusWindow,
  loadCurrentMcpConfigFile: settingsConfigRuntime.loadCurrentMcpConfigFile,
  listKnowledgeDir: knowledgeBaseRuntime.listKnowledgeDir,
  buildKnowledgeTreeFromDisk: () => knowledgeBaseRuntime.buildKnowledgeTreeFromDisk(),
  loadSkillsFromDisk: skillsRuntime.loadSkillsFromDisk,
  rememberTerminalPassword,
  refreshOrganizationAssets,
  writeTerminalBySessionId,
  showControlNotification,
  broadcastManagedAiSessionFocusRequest,
  broadcastManagedAiSessionEvent
})

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
    ensureSecurityConfigFile: settingsConfigRuntime.ensureSecurityConfigFile,
    ensureKeywordHighlightConfigFile: settingsConfigRuntime.ensureKeywordHighlightConfigFile,
    ensureMcpConfigFile: settingsConfigRuntime.ensureMcpConfigFile,
    removeJsonComments: settingsConfigRuntime.removeJsonComments,
    normalizeSecurityConfig,
    normalizeKeywordHighlightConfig,
    normalizeMcpConfigFile,
    saveConfigPatch: (patch) => {
      const next = mergeConfig(getConfig(), patch)
      store.set('config', next)
      return next
    },
    getMcpServers: settingsConfigRuntime.getMcpServers,
    applyMcpConfigFileSnapshot: settingsConfigRuntime.applyMcpConfigFileSnapshot,
    syncMcpConfigFromContent: settingsConfigRuntime.syncMcpConfigFromContent,
    setMcpToolState: settingsConfigRuntime.setMcpToolState,
    setMcpToolAutoApprove: settingsConfigRuntime.setMcpToolAutoApprove,
    callMcpTool: settingsConfigRuntime.callCurrentMcpTool,
    readMcpResource: settingsConfigRuntime.readCurrentMcpResource,
    broadcastSecurityConfigChanged: settingsConfigRuntime.broadcastSecurityConfigChanged,
    broadcastKeywordHighlightConfigChanged: settingsConfigRuntime.broadcastKeywordHighlightConfigChanged,
    broadcastMcpConfigChanged: settingsConfigRuntime.broadcastMcpConfigChanged
  })
  registerAiChatActionsIpc(ipcMain, {
    getChatConversationMessages,
    replaceChatConversationMessages,
    setMcpToolAutoApprove: settingsConfigRuntime.setMcpToolAutoApprove,
    callMcpTool: settingsConfigRuntime.callCurrentMcpTool,
    readMcpResource: settingsConfigRuntime.readCurrentMcpResource,
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
    syncSkillsConfigFromDisk: skillsRuntime.syncSkillsConfigFromDisk,
    loadSkillsFromDisk: skillsRuntime.loadSkillsFromDisk,
    saveSkillsSnapshot: skillsRuntime.saveSkillsSnapshot,
    broadcastSkillsUpdate: skillsRuntime.broadcastSkillsUpdate,
    ensureSkillsDirectory: skillsRuntime.ensureSkillsDirectory,
    validateSkillMetadata: skillsRuntime.validateSkillMetadata,
    normalizeSkillNameForDirectory: skillsRuntime.normalizeSkillNameForDirectory,
    buildSkillFile: skillsRuntime.buildSkillFile,
    startSkillsWatcher: skillsRuntime.startSkillsWatcher,
    findSkillByName: skillsRuntime.findSkillByName,
    createSkillWriteResult: skillsRuntime.createSkillWriteResult,
    isEditableSkill: skillsRuntime.isEditableSkill,
    pathExists: skillsRuntime.pathExists,
    openPath: (targetPath) => shell.openPath(targetPath),
    importSkillZip: skillsRuntime.importSkillZip,
    exportSkillZipBuffer: skillsRuntime.exportSkillZipBuffer,
    showSaveDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerKnowledgeBaseIpc(ipcMain, {
    ensureKnowledgeBaseDirectory: knowledgeBaseRuntime.ensureKnowledgeBaseDirectory,
    syncKnowledgeBaseConfigFromDisk: knowledgeBaseRuntime.syncKnowledgeBaseConfigFromDisk,
    listKnowledgeDir: knowledgeBaseRuntime.listKnowledgeDir,
    resolveKnowledgePath: knowledgeBaseRuntime.resolveKnowledgePath,
    getKnowledgeMimeType: knowledgeBaseRuntime.getKnowledgeMimeType,
    isKnowledgeImage: knowledgeBaseRuntime.isKnowledgeImage,
    knowledgeWriteResult: knowledgeBaseRuntime.knowledgeWriteResult,
    knowledgeMutationEntry: knowledgeBaseRuntime.knowledgeMutationEntry,
    knowledgeDeletedResult: knowledgeBaseRuntime.knowledgeDeletedResult,
    isSafeKnowledgeBasename: knowledgeBaseRuntime.isSafeKnowledgeBasename,
    ensureUniqueKnowledgeName: knowledgeBaseRuntime.ensureUniqueKnowledgeName,
    pathExists: knowledgeBaseRuntime.pathExists,
    isKnowledgeFileAllowedForImport: knowledgeBaseRuntime.isKnowledgeFileAllowedForImport,
    maxKnowledgeImportBytes: knowledgeBaseRuntime.maxKnowledgeImportBytes,
    collectKnowledgeImportTasks: knowledgeBaseRuntime.collectKnowledgeImportTasks,
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    sendKnowledgeProgress: knowledgeBaseRuntime.sendKnowledgeProgress,
    searchKnowledgeIndex: knowledgeBaseRuntime.searchKnowledgeIndex,
    getKnowledgeSearchIndex: knowledgeBaseRuntime.getKnowledgeSearchIndex,
    buildKnowledgeSearchIndex: knowledgeBaseRuntime.buildKnowledgeSearchIndex,
    setKnowledgeSearchIndex: knowledgeBaseRuntime.setKnowledgeSearchIndex
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
  await Promise.all([
    settingsConfigRuntime.startSecurityConfigWatcher(),
    settingsConfigRuntime.startKeywordHighlightConfigWatcher(),
    settingsConfigRuntime.startMcpConfigWatcher(),
    skillsRuntime.startSkillsWatcher()
  ])
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
  settingsConfigRuntime.stopConfigWatchers()
  skillsRuntime.stopSkillsWatcher()
})
