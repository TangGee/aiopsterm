import { BrowserWindow, app, net, screen, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { configureAssetBackendRuntime, getAsset, getAssetSecret, getKeychainSecret } from '../assets/assets'
import { createJumpserverSeedFetch } from '@shared/jumpserverClient'
import type { refreshOrganizationAssets, saveAsset } from '../assets/assets'
import { configureAiChatRuntime } from '../ai/aiChat'
import { configureAiCommandBackendRuntime } from '../ai/aiCommands'
import { configureAiContextBackendRuntime } from '../ai/aiContext'
import { configureAiTodoBackendRuntime } from '../ai/aiTodos'
import { configureAgentHookInstallerRuntime } from '../agent/agentHookInstaller'
import { configureClineAgentRuntime } from '../agent/clineAgentRuntime'
import {
  agentHookScriptPathFor,
  configureManagedAiSessionAutoNamingRuntime,
  configureManagedAiSessionImportRuntime,
  getAiAgentSessionSocketPath
} from '../agent/agentSessions'
import { configureAppUpdateRuntime } from './appUpdate'
import { configureChatHistoryBackendRuntime } from '../chat/chatHistory'
import { getChatConversationMessages } from '../chat/chatHistory'
import { configureCodexCliRuntime, refreshCodexConfig } from '../codex/codexCli'
import { getCodexTerminalBridgeSocketPath } from '../codex/codexTerminalBridge'
import { configureExportMcpInstallerRuntime, exportMcpScriptPathFor } from '../codex/exportMcpInstaller'
import { configureExportMcpTokenRuntime, getEffectiveExportMcpToken, rotateStoredExportMcpToken } from '../codex/exportMcpTokenRuntime'
import { configureControlSocketRuntime, getControlSocketPath } from '../control/controlSocket'
import { configureDatabaseBackendRuntime } from '../database/database'
import { configureDatabaseCommentsRuntime } from '../database/databaseComments'
import { configureExtensionBackendRuntime } from '../extensions/extensions'
import { ensureExternalCodexMcpBridgeServer } from '../codex/externalCodexMcpBridge'
import { configureFilesBackendRuntime } from '../files/files'
import { configureKubernetesBackendRuntime, setKubernetesTerminalEventSink } from '../kubernetes/kubernetes'
import { configureLocalTerminalBackendRuntime } from '../terminal/localTerminal'
import { callMcpTool, readMcpResource } from '../mcp/mcpRuntime'
import { createAiProviderProxyFetch } from '../ai/aiProviderProxyFetch'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider } from '../ai/modelProviderText'
import { configurePrivacyRuntime } from './privacyRuntime'
import { configureQuickCommandBackendRuntime } from '../quick-commands/quickCommands'
import { configureRuntimeLog, logRuntimeEvent } from './runtimeLog'
import { configureSettingsPreferencesBackendRuntime } from '../settings/settingsPreferences'
import { getSettingsPreferences } from '../settings/settingsPreferences'
import { createSshProxySocket } from '../ssh/sshProxy'
import { configureSshTerminalBackendRuntime } from '../ssh/sshTerminal'
import { configureSshTunnelBackendRuntime } from '../ssh/sshTunnels'
import { configureTerminalSuggestionsRuntime } from '../terminal/terminalSuggestions'
import { configureUserAccountBackendRuntime } from '../user/userAccount'
import { configureVoiceBackendRuntime } from '../ai/voice'
import {
  shouldUseAiChatBackendDouble,
  shouldUseAiTodoSeedData,
  shouldUseAssetsSeedData,
  shouldUseChatHistorySeedData,
  shouldUseDataSyncBackendDouble,
  shouldUseDatabaseAiBackendDouble,
  shouldUseDatabaseSeedData,
  shouldUseFilesSeedData,
  shouldUseKubernetesSeedData,
  shouldUseQuickCommandsSeedData,
  shouldUseSettingsPreferencesSeedData,
  shouldUseSshTerminalBackendDouble,
  shouldUseUserAccountSeedData,
  shouldUseUserExternalOpenBackendDouble
} from '@shared/runtimeSwitches'
import { broadcastWindowEvent } from '@shared/windowEvents'
import type { KubernetesTerminalDataEvent, KubernetesTerminalExitEvent } from '@shared/contracts/kubernetes'
import type { TerminalKeyboardInteractiveRequest, TerminalKeyboardInteractiveResponse, TerminalKeyboardInteractiveResult } from '@shared/contracts/terminalSessions'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { ControlNotificationRecord, ControlResponse } from '@shared/contracts/control'
import type { McpConfigFile } from '@shared/contracts/mcp'
import type { ManagedAiSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { KnowledgeBaseEntry, KnowledgeBaseNodeConfig, KnowledgeBaseSearchResult } from '@shared/contracts/knowledgeBase'

type ConfigureMainRuntimeInput = {
  getConfig: () => UserConfig
  getDefaultShell: () => string
  getLogDirPath: () => string
  focusWindow: (window?: BrowserWindow) => BrowserWindow | null
  loadCurrentMcpConfigFile: () => Promise<McpConfigFile>
  searchKnowledgeIndex: (
    query: string,
    options?: { maxResults?: number; minScore?: number }
  ) => Promise<KnowledgeBaseSearchResult[]>
  listKnowledgeDir: (relDir: string) => Promise<KnowledgeBaseEntry[]>
  buildKnowledgeTreeFromDisk: () => Promise<KnowledgeBaseNodeConfig[]>
  resolveKnowledgePath: (relPath: string) => { absPath: string; relPath: string }
  getKnowledgeMimeType: (relPath: string) => string
  isKnowledgeImage: (relPath: string) => boolean
  getChatAttachmentsPath: () => string
  loadSkillsFromDisk: () => Promise<SkillUserConfig[]>
  rememberTerminalPassword: (assetId: string, password: string) => void
  requestTerminalKeyboardInteractive: (request: TerminalKeyboardInteractiveRequest) => Promise<TerminalKeyboardInteractiveResponse>
  focusTerminalKeyboardInteractive: (request: TerminalKeyboardInteractiveRequest) => boolean | void
  sendTerminalKeyboardInteractiveResult: (result: TerminalKeyboardInteractiveResult) => void
  dismissTerminalKeyboardInteractive: (id: string, message?: string) => void
  refreshOrganizationAssets: typeof refreshOrganizationAssets
  saveAsset: typeof saveAsset
  writeTerminalBySessionId: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
  showControlNotification: (notification: ControlNotificationRecord) => void
  broadcastManagedAiSessionFocusRequest: (request: ManagedAiSessionFocusRequest) => void
  broadcastManagedAiSessionEvent: (event: ManagedAiSessionEvent) => void
}

const shellHomePath = () => String(process.env.HOME || '').trim() || app.getPath('home')
const jsRuntimeExecutablePath = () => String(process.env.APPIMAGE || '').trim() || process.execPath
const agentHookScriptPath = () => agentHookScriptPathFor(app.getAppPath(), process.resourcesPath || '', app.getPath('userData'))
const exportMcpScriptPath = () => exportMcpScriptPathFor(app.getAppPath(), process.resourcesPath || '', app.getPath('userData'))
const controlHelperScriptPath = () => {
  const candidates = [
    join(process.resourcesPath || '', 'aiopsterm-control.js'),
    join(process.resourcesPath || '', 'resources', 'aiopsterm-control.js'),
    join(app.getAppPath(), 'resources', 'aiopsterm-control.js')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) || candidates[candidates.length - 1]
}

export const configureMainBackendRuntimes = (input: ConfigureMainRuntimeInput) => {
  const userDataPath = app.getPath('userData')
  configureClineAgentRuntime({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath || '',
    userDataPath,
    isPackaged: app.isPackaged,
    getConfig: input.getConfig,
    searchKnowledgeBase: (query, options) => input.searchKnowledgeIndex(query, options),
    readMcpResource: async (resourceInput) => {
      const current = input.getConfig()
      return readMcpResource(await input.loadCurrentMcpConfigFile(), resourceInput, {
        servers: current.mcpServers || [],
        clientName: 'aiopsterm',
        clientVersion: app.getVersion()
      })
    },
    getWindows: () => BrowserWindow.getAllWindows(),
    env: process.env
  })
  configureExportMcpTokenRuntime({
    userDataPath,
    getEnv: () => process.env
  })
  try {
    getEffectiveExportMcpToken()
  } catch {
    // Export MCP will surface token storage errors when the user opens or uses its settings page.
  }
  configureTerminalSuggestionsRuntime({ getConfig: input.getConfig })
  configureDatabaseBackendRuntime({
    getConfig: input.getConfig,
    fetch,
    createSshProxySocket,
    localBackendDouble: shouldUseDatabaseAiBackendDouble(),
    stateFilePath: join(app.getPath('userData'), 'database-workspace.json'),
    useSeedData: shouldUseDatabaseSeedData()
  })
  configureDatabaseCommentsRuntime({
    stateFilePath: join(app.getPath('userData'), 'database-comments.json')
  })
  configureVoiceBackendRuntime({ getConfig: input.getConfig })
  configureAssetBackendRuntime({
    getConfig: input.getConfig,
    jumpserverFetch: shouldUseAssetsSeedData() ? createJumpserverSeedFetch() : net.fetch as typeof fetch,
    useSeedData: shouldUseAssetsSeedData()
  })
  configureFilesBackendRuntime({
    getConfig: input.getConfig,
    useSeedData: shouldUseFilesSeedData()
  })
  configurePrivacyRuntime({
    dataSyncStateFilePath: join(app.getPath('userData'), 'data-sync-runtime.json'),
    useDataSyncBackendDouble: shouldUseDataSyncBackendDouble()
  })
  configureSshTunnelBackendRuntime({ getConfig: input.getConfig })
  configureLocalTerminalBackendRuntime({
    getDefaultShell: input.getDefaultShell,
    getDefaultCwd: shellHomePath,
    getEnv: () => process.env,
    getAgentSocketPath: getAiAgentSessionSocketPath,
    getAgentHookScriptPath: agentHookScriptPath,
    getControlSocketPath,
    getJsRuntimeExecutable: jsRuntimeExecutablePath,
    getControlHelperScriptPath: controlHelperScriptPath
  })
  configureControlSocketRuntime({
    userDataPath,
    getWindows: () => BrowserWindow.getAllWindows(),
    focusWindow: input.focusWindow,
    getDisplays: () => screen.getAllDisplays().map((display) => ({ id: display.id, label: display.label, bounds: display.bounds, workArea: display.workArea })),
    writeTerminal: input.writeTerminalBySessionId,
    showNotification: input.showControlNotification
  })
  configureAgentHookInstallerRuntime({
    getHomeDir: shellHomePath,
    getEnv: () => process.env,
    getAgentHookScriptPath: agentHookScriptPath,
    getJsRuntimeExecutable: jsRuntimeExecutablePath
  })
  configureExportMcpInstallerRuntime({
    getHomeDir: shellHomePath,
    getEnv: () => process.env,
    getExportMcpScriptPath: exportMcpScriptPath,
    getJsRuntimeExecutable: jsRuntimeExecutablePath,
    getExportMcpToken: getEffectiveExportMcpToken,
    resetExportMcpToken: rotateStoredExportMcpToken
  })
  configureManagedAiSessionImportRuntime({
    getHomeDir: shellHomePath,
    getEnv: () => process.env,
    enabled: process.env.AIOPSTERM_AGENT_SESSION_IMPORT_DISABLED !== '1'
  })
  configureCodexCliRuntime({
    getUserDataPath: () => app.getPath('userData'),
    getAppPath: () => app.getAppPath(),
    getResourcesPath: () => process.resourcesPath,
    getConfig: input.getConfig,
    getEnv: () => process.env,
    getBridgeSocketPath: () => getCodexTerminalBridgeSocketPath()
  })
  void refreshCodexConfig()
    .then((result) => {
      logRuntimeEvent('info', 'codex.config.refreshed', result)
    })
    .catch((error) => {
      logRuntimeEvent('error', 'codex.config.refresh-failed', {
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    })
  configureSshTerminalBackendRuntime({
    getConfig: input.getConfig,
    getAsset,
    getAssetSecret,
    getKeychainSecret,
    rememberAssetPassword: input.rememberTerminalPassword,
    getSshControlDir: () => join(app.getPath('userData'), 'ssh-control'),
    useBackendDouble: shouldUseSshTerminalBackendDouble()
  })
  void ensureExternalCodexMcpBridgeServer({
    enabled: process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE === '1',
    token: process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN,
    getToken: getEffectiveExportMcpToken,
    getConfig: input.getConfig,
    socketPath: process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET,
    userDataPath,
    focusManagedAiSession: input.broadcastManagedAiSessionFocusRequest,
    requestKeyboardInteractive: input.requestTerminalKeyboardInteractive,
    focusKeyboardInteractive: input.focusTerminalKeyboardInteractive,
    sendKeyboardInteractiveResult: input.sendTerminalKeyboardInteractiveResult,
    dismissKeyboardInteractive: input.dismissTerminalKeyboardInteractive
  })
    .then((externalCodexMcpSocketPath) => {
      if (!externalCodexMcpSocketPath) return
      logRuntimeEvent('info', 'external-codex-mcp.started', { socketPath: externalCodexMcpSocketPath })
    })
    .catch((error) => {
      logRuntimeEvent('error', 'external-codex-mcp.start-failed', {
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    })
  configureExtensionBackendRuntime({
    extensionRootDir: join(userDataPath, 'extensions'),
    builtinPluginDir: app.isPackaged
      ? join(process.resourcesPath || '', 'builtin-plugins')
      : join(app.getAppPath(), 'resources', 'builtin-plugins'),
    appVersion: app.getVersion(),
    saveAsset: input.saveAsset,
    fetch: (url, init) => net.fetch(url, init)
  })
  configureKubernetesBackendRuntime({
    stateDir: join(userDataPath, 'kubernetes'),
    useSeedData: shouldUseKubernetesSeedData(),
    refreshOrganizationAssets: input.refreshOrganizationAssets
  })
  setKubernetesTerminalEventSink((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => {
    const channel = 'data' in event ? 'kubernetes:terminal:data' : 'kubernetes:terminal:exit'
    broadcastWindowEvent(BrowserWindow.getAllWindows(), channel, event)
  })
  configureUserAccountBackendRuntime({
    stateFilePath: join(userDataPath, 'user-account.json'),
    useSeedData: shouldUseUserAccountSeedData(),
    loginUrl: process.env.AIOPSTERM_USER_LOGIN_URL,
    accountCenterUrl: process.env.AIOPSTERM_USER_ACCOUNT_CENTER_URL,
    openExternal: shouldUseUserExternalOpenBackendDouble() ? async () => undefined : (url) => shell.openExternal(url)
  })
  configureSettingsPreferencesBackendRuntime({
    useSeedData: shouldUseSettingsPreferencesSeedData()
  })
  configureAiTodoBackendRuntime({
    stateFilePath: join(userDataPath, 'ai-todos.json'),
    useSeedData: shouldUseAiTodoSeedData()
  })
  configureChatHistoryBackendRuntime({
    stateFilePath: join(userDataPath, 'chat-history.json'),
    useSeedData: shouldUseChatHistorySeedData()
  })
  configureQuickCommandBackendRuntime({
    databasePath: join(userDataPath, 'aiopsterm-state.db'),
    useSeedData: shouldUseQuickCommandsSeedData()
  })
  configureAppUpdateRuntime({
    installer: async (update) => {
      const errorMessage = await shell.openPath(update.filePath)
      if (errorMessage) throw new Error(errorMessage)
      return {
        handoff: {
          kind: 'os-open',
          accepted: true
        },
        message: `Update ${update.version} handed off to the operating system installer.`
      }
    }
  })
  configureRuntimeLog({ getLogDir: input.getLogDirPath })
  configureAiContextBackendRuntime({
    listKnowledgeTree: () => input.buildKnowledgeTreeFromDisk(),
    listSkills: () => input.loadSkillsFromDisk()
  })
  configureAiCommandBackendRuntime({
    listKnowledgeDir: (relDir) => input.listKnowledgeDir(relDir)
  })
  configureAiChatRuntime({
    getConfig: input.getConfig,
    listSkills: () => input.loadSkillsFromDisk(),
    listRules: () => {
      const result = getSettingsPreferences({
        rules: input.getConfig().rules,
        customInstructions: input.getConfig().customInstructions
      })
      return result.ok && result.data ? result.data.rules : input.getConfig().rules || []
    },
    richContext: {
      resolveKnowledgePath: input.resolveKnowledgePath,
      getKnowledgeMimeType: input.getKnowledgeMimeType,
      isKnowledgeImage: input.isKnowledgeImage,
      getChatAttachmentsPath: input.getChatAttachmentsPath,
      getChatConversationMessages
    },
    localBackendDouble: shouldUseAiChatBackendDouble(),
    clineEnabled: true,
    callMcpTool: async (toolInput) => {
      const current = input.getConfig()
      return callMcpTool(await input.loadCurrentMcpConfigFile(), toolInput, {
        servers: current.mcpServers || [],
        toolStates: current.mcpToolStates || {},
        clientName: 'aiopsterm',
        clientVersion: app.getVersion()
      })
    }
  })

  const syncManagedAiAutoNamingRuntime = (config = input.getConfig()) => {
    configureManagedAiSessionAutoNamingRuntime({
      enabled: config.aiPreferences?.managedAiAutoNamingEnabled === true,
      emit: input.broadcastManagedAiSessionEvent,
      generateTitle: async ({ prompt }) => {
        const current = input.getConfig()
        const provider = resolveModelProvider(current)
        if (!provider) return null
        const request = createProviderTextRequest(
          provider,
          'You create concise titles for AI coding-agent sessions. Return only the title.',
          prompt,
          24,
          { preferences: current.aiPreferences ? { reasoningEffort: current.aiPreferences.reasoningEffort } : undefined }
        )
        if (!request) return null
        const proxyFetch = createAiProviderProxyFetch(current.aiPreferences)
        const response = await fetchProviderText(request, {
          fetch:
            proxyFetch ||
            ((url, init) => {
              const target = url instanceof URL ? url.toString() : url
              return net.fetch(target, init) as unknown as Promise<Response>
            }),
          timeoutMs: 20_000,
          errorCodePrefix: 'MANAGED_AI_AUTO_NAMING_PROVIDER',
          maxRetries: 1
        })
        return response.ok ? response.text : null
      }
    })
  }
  syncManagedAiAutoNamingRuntime()
  return { syncManagedAiAutoNamingRuntime }
}
