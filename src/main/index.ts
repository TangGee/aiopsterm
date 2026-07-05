import { app, BrowserWindow, crashReporter, Notification, shell } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { refreshOrganizationAssets } from './backend/assets/assets'
import {
  closeCodexTerminalBridgeServer
} from './backend/codex/codexTerminalBridge'
import { closeExternalCodexMcpBridgeServer } from './backend/codex/externalCodexMcpBridge'
import {
  closeAiAgentSessionServer,
  ensureAiAgentSessionServer,
} from './backend/agent/agentSessions'
import { configureRuntimeLog, logRuntimeEvent } from './backend/app/runtimeLog'
import { configureCrashDiagnosticsRuntime, shouldEnableCrashDiagnostics } from './backend/app/crashDiagnosticsRuntime'
import {
  closeControlSocketServer,
  ensureControlSocketServer,
  invokeControlSocketMethod
} from './backend/control/controlSocket'
import { createKnowledgeBaseRuntime } from './backend/knowledge/knowledgeBaseRuntime'
import { createSettingsConfigRuntime } from './backend/settings/settingsConfigRuntime'
import { createSkillsRuntime } from './backend/settings/skillsRuntime'
import { resolveUserAvatarAssetPath } from './backend/user/userAccount'
import { configureMainBackendRuntimes } from './backend/app/runtimeConfiguration'
import { showNativeNotification, type NativeNotificationRuntime } from './backend/app/nativeNotificationRuntime'
import {
  cloneMcpServers,
  cloneMcpToolStates,
  defaultConfig,
  defaultKeywordHighlightConfig,
  defaultKnowledgeBaseUserConfig,
  defaultSecurityConfig,
  mcpConfigFromUserConfig,
  mergeConfig,
  normalizeKeywordHighlightConfig,
  normalizeMcpConfigFile,
  normalizeSecurityConfig,
  normalizeTerminalType
} from './appConfigRuntime'
import { createAppBootstrapRuntime } from './appBootstrapRuntime'
import { registerMainIpcRuntime } from './mainIpcRuntime'
import { createMainTerminalRuntime } from './terminalRuntime'
import { shouldUseE2eDialogFixtures } from '@shared/runtimeSwitches'
import { broadcastWindowEvent } from '@shared/windowEvents'
import type { ControlNotificationRecord } from '@shared/contracts/control'
import type { AiAgentSessionEvent, ManagedAiSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { UserConfig } from '@shared/contracts/userConfig'

if (process.env.NODE_ENV === 'test') {
  app.disableHardwareAcceleration()
}

if (process.env.AIOPSTERM_USER_DATA_DIR) {
  app.setPath('userData', process.env.AIOPSTERM_USER_DATA_DIR)
}

app.setName('aiopsterm')
app.setAppUserModelId('app.aiopsterm.desktop')

const store = new Store<{ config: UserConfig }>({
  name: 'aiopsterm-config',
  defaults: {
    config: defaultConfig
  }
})

let mainWindow: BrowserWindow | null = null

const getConfig = (): UserConfig => mergeConfig(defaultConfig, store.get('config'))

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

const getChatAttachmentsPath = () => join(app.getPath('userData'), 'chat-attachments')
const getCustomBackgroundsPath = () => join(app.getPath('userData'), 'backgrounds')
const getCustomNotificationSoundsPath = () => join(app.getPath('userData'), 'notification-sounds')
const getLogDirPath = () => join(app.getPath('userData'), 'logs')
configureRuntimeLog({ getLogDir: getLogDirPath })
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

const appBootstrapRuntime = createAppBootstrapRuntime({
  getMainWindow: () => mainWindow,
  setMainWindow: (window) => {
    mainWindow = window
  },
  resolveUserAvatarAssetPath,
  getCustomBackgroundsPath,
  preloadPath: join(__dirname, '../preload/index.js'),
  rendererUrl: process.env.ELECTRON_RENDERER_URL,
  rendererIndexPath: join(__dirname, '../renderer/index.html')
})

const hasPrimaryInstanceLock = appBootstrapRuntime.registerSingleInstanceDeepLinkHandling()
appBootstrapRuntime.registerOpenUrlDeepLinkHandling()
if (hasPrimaryInstanceLock && !app.isPackaged && shouldEnableCrashDiagnostics()) {
  configureCrashDiagnosticsRuntime({
    app,
    crashReporter,
    getWindows: () => BrowserWindow.getAllWindows(),
    browserWindowFromWebContents: (webContents) => BrowserWindow.fromWebContents(webContents)
  })
}

const terminalRuntime = createMainTerminalRuntime({
  focusWindow: appBootstrapRuntime.focusWindow
})

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

const nativeNotificationRuntime: NativeNotificationRuntime = {
  isSupported: () => Notification.isSupported(),
  create: (input) => new Notification(input)
}

const settingsConfigRuntime = createSettingsConfigRuntime({
  userDataPath: () => app.getPath('userData'),
  getConfig,
  saveConfig: (config) => store.set('config', config),
  mergeConfig,
  normalizeSecurityConfig,
  normalizeKeywordHighlightConfig,
  normalizeMcpConfigFile,
  mcpConfigFromUserConfig: (config) => mcpConfigFromUserConfig(config, app.getPath('home')),
  cloneMcpServers,
  cloneMcpToolStates,
  defaultSecurityConfig,
  defaultKeywordHighlightConfig,
  appVersion: () => app.getVersion(),
  getWindows: () => BrowserWindow.getAllWindows()
})

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
  const desktopNotificationsEnabled = getConfig().notifications?.desktopNotifications !== false
  const notificationSupported = nativeNotificationRuntime.isSupported()
  logRuntimeEvent('info', 'native-notification.request', {
    source: 'ai-agent',
    agentSource: event.source,
    event: event.event,
    sessionId: event.sessionId,
    panelId: event.panelId,
    terminalSessionId: event.terminalSessionId,
    enabled: desktopNotificationsEnabled,
    supported: notificationSupported
  })
  const shown = showNativeNotification(nativeNotificationRuntime, {
    title: event.title || 'AI session needs attention',
    body: event.summary || `${event.source} needs attention`,
    silent: false,
    onClick: () => {
      const target = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0]
      appBootstrapRuntime.focusWindow(target)
      broadcastWindowEvent(BrowserWindow.getAllWindows(), 'ai-agent:session-focus', {
        source: event.source,
        sessionId: event.sessionId,
        ...(event.panelId ? { panelId: event.panelId } : {}),
        ...(event.terminalSessionId ? { terminalSessionId: event.terminalSessionId } : {})
      })
    }
  }, desktopNotificationsEnabled)
  logRuntimeEvent('debug', 'native-notification.result', {
    source: 'ai-agent',
    agentSource: event.source,
    event: event.event,
    sessionId: event.sessionId,
    shown,
    enabled: desktopNotificationsEnabled,
    supported: notificationSupported
  })
}

const broadcastManagedAiSessionFocusRequest = (request: ManagedAiSessionFocusRequest) => {
  logRuntimeEvent('info', 'ai-agent.focus-request', {
    source: request.source,
    sessionId: request.sessionId,
    panelId: request.panelId,
    terminalSessionId: request.terminalSessionId
  })
  const target = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0]
  appBootstrapRuntime.focusWindow(target)
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

const showControlNotification = (notification: ControlNotificationRecord) => {
  const desktopNotificationsEnabled = getConfig().notifications?.desktopNotifications !== false
  const notificationSupported = nativeNotificationRuntime.isSupported()
  logRuntimeEvent('info', 'native-notification.request', {
    source: 'control-notification',
    notificationId: notification.id,
    level: notification.level,
    group: notification.group,
    surfaceId: notification.panelId,
    sessionId: notification.sessionId,
    terminalSessionId: notification.terminalSessionId,
    enabled: desktopNotificationsEnabled,
    supported: notificationSupported
  })
  const shown = showNativeNotification(nativeNotificationRuntime, {
    title: notification.source ? `${notification.source}: ${notification.title}` : notification.title,
    body: [notification.level && notification.level !== 'info' ? `[${notification.level}]` : '', notification.group, notification.subtitle, notification.body].filter(Boolean).join('\n') || notification.title,
    silent: false,
    onClick: () => {
      const target = BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0]
      appBootstrapRuntime.focusWindow(target)
      void invokeControlSocketMethod('notification.open', { id: notification.id })
    }
  }, desktopNotificationsEnabled)
  logRuntimeEvent('debug', 'native-notification.result', {
    source: 'control-notification',
    notificationId: notification.id,
    level: notification.level,
    shown,
    enabled: desktopNotificationsEnabled,
    supported: notificationSupported
  })
}

const runtimeConfiguration = configureMainBackendRuntimes({
  getConfig,
  getDefaultShell,
  getLogDirPath,
  focusWindow: appBootstrapRuntime.focusWindow,
  loadCurrentMcpConfigFile: settingsConfigRuntime.loadCurrentMcpConfigFile,
  listKnowledgeDir: knowledgeBaseRuntime.listKnowledgeDir,
  buildKnowledgeTreeFromDisk: () => knowledgeBaseRuntime.buildKnowledgeTreeFromDisk(),
  loadSkillsFromDisk: skillsRuntime.loadSkillsFromDisk,
  rememberTerminalPassword: terminalRuntime.rememberTerminalPassword,
  requestTerminalKeyboardInteractive: terminalRuntime.requestKeyboardInteractiveFromFocusedWindow,
  focusTerminalKeyboardInteractive: terminalRuntime.focusKeyboardInteractiveRequest,
  sendTerminalKeyboardInteractiveResult: terminalRuntime.sendKeyboardInteractiveResult,
  dismissTerminalKeyboardInteractive: terminalRuntime.dismissKeyboardInteractiveRequest,
  refreshOrganizationAssets,
  writeTerminalBySessionId: terminalRuntime.writeTerminalBySessionId,
  showControlNotification,
  broadcastManagedAiSessionFocusRequest,
  broadcastManagedAiSessionEvent
})

app.whenReady().then(async () => {
  appBootstrapRuntime.registerAssetProtocols()
  registerMainIpcRuntime({
    appBootstrapRuntime,
    terminalRuntime,
    knowledgeBaseRuntime,
    settingsConfigRuntime,
    skillsRuntime,
    store,
    runtimeConfiguration,
    getConfig,
    mergeConfig,
    defaultConfig,
    normalizeTerminalType,
    getDefaultShell,
    getChatAttachmentsPath,
    getCustomBackgroundsPath,
    getCustomNotificationSoundsPath,
    getLogDirPath,
    settingsExternalActionRuntime,
    normalizeSecurityConfig,
    normalizeKeywordHighlightConfig,
    normalizeMcpConfigFile,
    broadcastAiAgentSessionEvent,
    broadcastManagedAiSessionFocusRequest
  })
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
  appBootstrapRuntime.createWindow()
  appBootstrapRuntime.handleStartupDeepLink()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      appBootstrapRuntime.createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeAiAgentSessionServer()
  closeControlSocketServer()
  closeCodexTerminalBridgeServer()
  closeExternalCodexMcpBridgeServer()
  terminalRuntime.killAllSessions()
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
