import { BrowserWindow, app, net, screen, shell } from 'electron'
import { join } from 'path'
import { configureAssetBackendRuntime, configureAssetConnectionRuntime, getAsset, getAssetSecret, getKeychainSecret } from '../assets/assets'
import type { refreshOrganizationAssets } from '../assets/assets'
import { configureAiChatRuntime } from '../ai/aiChat'
import { configureAiCommandBackendRuntime } from '../ai/aiCommands'
import { configureAiContextBackendRuntime } from '../ai/aiContext'
import { configureAiTodoBackendRuntime } from '../ai/aiTodos'
import { configureAliasBackendRuntime } from '../quick-commands/aliases'
import { configureAgentHookInstallerRuntime } from '../agent/agentHookInstaller'
import {
  agentHookScriptPathFor,
  configureManagedAiSessionAutoNamingRuntime,
  configureManagedAiSessionImportRuntime,
  getAiAgentSessionSocketPath
} from '../agent/agentSessions'
import { configureAppUpdateRuntime } from './appUpdate'
import { configureChatHistoryBackendRuntime } from '../chat/chatHistory'
import { configureCodexCliRuntime, refreshCodexConfig } from '../codex/codexCli'
import { getCodexTerminalBridgeSocketPath } from '../codex/codexTerminalBridge'
import { configureControlSocketRuntime, getControlSocketPath } from '../control/controlSocket'
import { configureDatabaseBackendRuntime } from '../database/database'
import { configureDatabaseCommentsRuntime } from '../database/databaseComments'
import { configureExtensionBackendRuntime } from '../extensions/extensions'
import { ensureExternalCodexMcpBridgeServer } from '../codex/externalCodexMcpBridge'
import { configureFilesBackendRuntime } from '../files/files'
import { configureKubernetesBackendRuntime, setKubernetesTerminalEventSink } from '../kubernetes/kubernetes'
import { configureLocalTerminalBackendRuntime } from '../terminal/localTerminal'
import { callMcpTool } from '../mcp/mcpRuntime'
import { createAiProviderProxyFetch } from '../ai/aiProviderProxyFetch'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider } from '../ai/modelProviderText'
import { configurePrivacyRuntime } from './privacyRuntime'
import { configureQuickCommandBackendRuntime } from '../quick-commands/quickCommands'
import { configureRuntimeLog, logRuntimeEvent } from './runtimeLog'
import { configureSettingsPreferencesBackendRuntime } from '../settings/settingsPreferences'
import { createSshProxySocket } from '../ssh/sshProxy'
import { configureSshTerminalBackendRuntime } from '../ssh/sshTerminal'
import { configureSshTunnelBackendRuntime } from '../ssh/sshTunnels'
import { configureTerminalSuggestionsRuntime } from '../terminal/terminalSuggestions'
import { configureUserAccountBackendRuntime } from '../user/userAccount'
import { configureVoiceBackendRuntime } from '../ai/voice'
import {
  shouldUseAiChatBackendDouble,
  shouldUseAiTodoSeedData,
  shouldUseAliasesSeedData,
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
import type { UserConfig } from '@shared/contracts/userConfig'
import type { ControlNotificationRecord, ControlResponse } from '@shared/contracts/control'
import type { McpConfigFile } from '@shared/contracts/mcp'
import type { ManagedAiSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { SkillUserConfig } from '@shared/contracts/skills'
import type { KnowledgeBaseEntry, KnowledgeBaseNodeConfig } from '@shared/contracts/knowledgeBase'

type ConfigureMainRuntimeInput = {
  getConfig: () => UserConfig
  getDefaultShell: () => string
  getLogDirPath: () => string
  focusWindow: (window?: BrowserWindow) => BrowserWindow | null
  loadCurrentMcpConfigFile: () => Promise<McpConfigFile>
  listKnowledgeDir: (relDir: string) => Promise<KnowledgeBaseEntry[]>
  buildKnowledgeTreeFromDisk: () => Promise<KnowledgeBaseNodeConfig[]>
  loadSkillsFromDisk: () => Promise<SkillUserConfig[]>
  rememberTerminalPassword: (assetId: string, password: string) => void
  refreshOrganizationAssets: typeof refreshOrganizationAssets
  writeTerminalBySessionId: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
  showControlNotification: (notification: ControlNotificationRecord) => void
  broadcastManagedAiSessionFocusRequest: (request: ManagedAiSessionFocusRequest) => void
  broadcastManagedAiSessionEvent: (event: ManagedAiSessionEvent) => void
}

const shellHomePath = () => String(process.env.HOME || '').trim() || app.getPath('home')
const agentHookScriptPath = () => agentHookScriptPathFor(app.getAppPath(), process.resourcesPath || '', app.getPath('userData'))

export const configureMainBackendRuntimes = (input: ConfigureMainRuntimeInput) => {
  configureTerminalSuggestionsRuntime({ getConfig: input.getConfig })
  configureAssetConnectionRuntime({ getConfig: input.getConfig })
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
    getControlSocketPath
  })
  configureControlSocketRuntime({
    userDataPath: app.getPath('userData'),
    getWindows: () => BrowserWindow.getAllWindows(),
    focusWindow: input.focusWindow,
    getDisplays: () => screen.getAllDisplays().map((display) => ({ id: display.id, label: display.label, bounds: display.bounds, workArea: display.workArea })),
    writeTerminal: input.writeTerminalBySessionId,
    showNotification: input.showControlNotification
  })
  configureAgentHookInstallerRuntime({
    getHomeDir: shellHomePath,
    getEnv: () => process.env,
    getAgentHookScriptPath: agentHookScriptPath
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
    socketPath: process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET,
    userDataPath: app.getPath('userData'),
    focusManagedAiSession: input.broadcastManagedAiSessionFocusRequest
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
    extensionRootDir: join(app.getPath('userData'), 'extensions'),
    fetch: (url, init) => net.fetch(url, init)
  })
  configureKubernetesBackendRuntime({
    stateDir: join(app.getPath('userData'), 'kubernetes'),
    useSeedData: shouldUseKubernetesSeedData(),
    refreshOrganizationAssets: input.refreshOrganizationAssets
  })
  setKubernetesTerminalEventSink((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => {
    const channel = 'data' in event ? 'kubernetes:terminal:data' : 'kubernetes:terminal:exit'
    broadcastWindowEvent(BrowserWindow.getAllWindows(), channel, event)
  })
  configureUserAccountBackendRuntime({
    stateFilePath: join(app.getPath('userData'), 'user-account.json'),
    useSeedData: shouldUseUserAccountSeedData(),
    loginUrl: process.env.AIOPSTERM_USER_LOGIN_URL,
    accountCenterUrl: process.env.AIOPSTERM_USER_ACCOUNT_CENTER_URL,
    openExternal: shouldUseUserExternalOpenBackendDouble() ? async () => undefined : (url) => shell.openExternal(url)
  })
  configureSettingsPreferencesBackendRuntime({
    useSeedData: shouldUseSettingsPreferencesSeedData()
  })
  configureAiTodoBackendRuntime({
    stateFilePath: join(app.getPath('userData'), 'ai-todos.json'),
    useSeedData: shouldUseAiTodoSeedData()
  })
  configureChatHistoryBackendRuntime({
    stateFilePath: join(app.getPath('userData'), 'chat-history.json'),
    useSeedData: shouldUseChatHistorySeedData()
  })
  configureQuickCommandBackendRuntime({
    databasePath: join(app.getPath('userData'), 'aiopsterm-state.db'),
    useSeedData: shouldUseQuickCommandsSeedData()
  })
  configureAliasBackendRuntime({
    databasePath: join(app.getPath('userData'), 'aiopsterm-state.db'),
    useSeedData: shouldUseAliasesSeedData()
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
    localBackendDouble: shouldUseAiChatBackendDouble(),
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
