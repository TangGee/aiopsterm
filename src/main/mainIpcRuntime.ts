import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import { formatMcpResourceReadContent } from './backend/ai/aiChat'
import {
  createCodexSession,
  killCodexSession,
  resizeCodexSession,
  setCodexSessionPendingContext,
  writeCodexSession
} from './backend/codex/codexCli'
import {
  ensureCodexTerminalBridgeServer,
  updateCodexTerminalBridgeSessionTarget
} from './backend/codex/codexTerminalBridge'
import {
  getChatConversationMessages,
  replaceChatConversationMessages,
} from './backend/chat/chatHistory'
import { logRuntimeEvent } from './backend/app/runtimeLog'
import { recordTerminalCommandHistory } from './backend/terminal/terminalSuggestions'
import {
  createSshTerminalConnectionInfo,
  createTerminalBinaryWriteResult,
  createTerminalKillResult,
  createTerminalWriteResult
} from './backend/terminal/terminal'
import { registerAiCatalogIpc } from './ipc/aiCatalog'
import { registerAiChatIpc } from './ipc/aiChat'
import { registerAiChatActionsIpc } from './ipc/aiChatActions'
import { registerAgentHooksIpc } from './ipc/agentHooks'
import { registerAliasesIpc } from './ipc/aliases'
import { registerAppRuntimeIpc } from './ipc/appRuntime'
import { registerAppUpdateIpc } from './ipc/appUpdate'
import { registerAssetsIpc } from './ipc/assets'
import { registerChatHistoryIpc } from './ipc/chatHistory'
import { registerCodexSessionsIpc } from './ipc/codexSessions'
import { registerControlSocketIpc } from './backend/control/controlSocket'
import { registerDatabaseIpc } from './ipc/database'
import { registerExtensionsIpc } from './ipc/extensions'
import { registerExportMcpIpc } from './ipc/exportMcp'
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
import { registerTerminalSessionsIpc } from './ipc/terminalSessions'
import { registerTerminalToolsIpc } from './ipc/terminalTools'
import { registerUserAccountIpc } from './ipc/userAccount'
import { registerVoiceIpc } from './ipc/voice'
import { registerWindowIpc } from './ipc/window'
import { registerZmodemIpc } from './ipc/zmodem'
import { shouldUseAiChatBackendDouble, shouldUseE2eDialogFixtures } from '@shared/runtimeSwitches'
import { sendWindowEvent } from '@shared/windowEvents'
import type { AiAgentSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { KeywordHighlightUserConfig, SecurityUserConfig } from '@shared/contracts/appRuntime'
import type { McpConfigFile } from '@shared/contracts/mcp'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { defaultConfig, mergeConfig, normalizeTerminalType } from './appConfigRuntime'
import type { createMainTerminalRuntime } from './terminalRuntime'
import type { createAppBootstrapRuntime } from './appBootstrapRuntime'
import type { createKnowledgeBaseRuntime } from './backend/knowledge/knowledgeBaseRuntime'
import type { createSettingsConfigRuntime } from './backend/settings/settingsConfigRuntime'
import type { createSkillsRuntime } from './backend/settings/skillsRuntime'

type StoreAdapter = {
  set: (key: 'config', value: UserConfig) => void
}

type RuntimeConfigurationAdapter = {
  syncManagedAiAutoNamingRuntime: (config: UserConfig) => void
}

type MainIpcRuntimeInput = {
  appBootstrapRuntime: ReturnType<typeof createAppBootstrapRuntime>
  terminalRuntime: ReturnType<typeof createMainTerminalRuntime>
  knowledgeBaseRuntime: ReturnType<typeof createKnowledgeBaseRuntime>
  settingsConfigRuntime: ReturnType<typeof createSettingsConfigRuntime>
  skillsRuntime: ReturnType<typeof createSkillsRuntime>
  store: StoreAdapter
  runtimeConfiguration: RuntimeConfigurationAdapter
  getConfig: () => UserConfig
  mergeConfig: typeof mergeConfig
  defaultConfig: typeof defaultConfig
  normalizeTerminalType: typeof normalizeTerminalType
  getDefaultShell: () => string
  getChatAttachmentsPath: () => string
  getCustomBackgroundsPath: () => string
  getCustomNotificationSoundsPath: () => string
  getLogDirPath: () => string
  settingsExternalActionRuntime: () => {
    userDataPath: string
    appPath: string
    cwd: string
    moduleDir: string
    version: string
    platform: NodeJS.Platform
    arch: string
    openPath: (targetPath: string) => Promise<string>
    skipOpen: boolean
  }
  normalizeSecurityConfig: (source?: unknown) => SecurityUserConfig
  normalizeKeywordHighlightConfig: (source?: unknown) => KeywordHighlightUserConfig
  normalizeMcpConfigFile: (source?: unknown) => McpConfigFile
  broadcastAiAgentSessionEvent: (event: AiAgentSessionEvent) => void
  broadcastManagedAiSessionFocusRequest: (request: ManagedAiSessionFocusRequest) => void
}

export const registerMainIpcRuntime = (input: MainIpcRuntimeInput) => {
  const saveConfigPatch = (patch: Partial<UserConfig>) => {
    const next = input.mergeConfig(input.getConfig(), patch)
    input.store.set('config', next)
    return next
  }

  registerControlSocketIpc(ipcMain)
  registerAgentHooksIpc(ipcMain)
  registerExportMcpIpc(ipcMain)
  registerAiCatalogIpc(ipcMain)
  registerAiChatIpc(ipcMain)
  registerAppUpdateIpc(ipcMain, {
    getVersion: () => app.getVersion(),
    getUserDataPath: () => app.getPath('userData')
  })
  registerAppRuntimeIpc(ipcMain, {
    getPlatform: () => process.platform,
    getDefaultShell: input.getDefaultShell,
    getGpuFeatureStatus: () => app.getGPUFeatureStatus(),
    handleProtocolUrl: (rawUrl) => input.appBootstrapRuntime.handleDeepLinkUrl(rawUrl),
    consumeDeepLinks: input.appBootstrapRuntime.consumeDeepLinks,
    openExternal: (url) => shell.openExternal(url),
    openPath: (targetPath) => shell.openPath(targetPath),
    getLogDirPath: input.getLogDirPath,
    createSettingsExternalActionRuntime: input.settingsExternalActionRuntime,
    getConfig: input.getConfig,
    saveConfigPatch: (patch) => {
      const next = saveConfigPatch(patch)
      input.runtimeConfiguration.syncManagedAiAutoNamingRuntime(next)
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
    getChatAttachmentsPath: input.getChatAttachmentsPath,
    getCustomBackgroundsPath: input.getCustomBackgroundsPath,
    getCustomNotificationSoundsPath: input.getCustomNotificationSoundsPath,
    customBackgroundUrlForPath: input.appBootstrapRuntime.customBackgroundUrlForPath
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
    emitAgentSessionEvent: input.broadcastAiAgentSessionEvent,
    focusManagedAiSession: input.broadcastManagedAiSessionFocusRequest
  })
  registerModelsIpc(ipcMain, {
    getConfig: input.getConfig,
    isLocalChatBackendAvailable: shouldUseAiChatBackendDouble
  })
  registerQuickCommandsIpc(ipcMain)
  registerSettingsPreferencesIpc(ipcMain, {
    getConfig: input.getConfig,
    saveConfigPatch
  })
  registerTerminalToolsIpc(ipcMain)
  registerUserAccountIpc(ipcMain)
  registerVoiceIpc(ipcMain)
  registerWindowIpc(ipcMain, {
    createWindow: input.appBootstrapRuntime.createWindow
  })
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
    ensureSecurityConfigFile: input.settingsConfigRuntime.ensureSecurityConfigFile,
    ensureKeywordHighlightConfigFile: input.settingsConfigRuntime.ensureKeywordHighlightConfigFile,
    ensureMcpConfigFile: input.settingsConfigRuntime.ensureMcpConfigFile,
    removeJsonComments: input.settingsConfigRuntime.removeJsonComments,
    normalizeSecurityConfig: input.normalizeSecurityConfig,
    normalizeKeywordHighlightConfig: input.normalizeKeywordHighlightConfig,
    normalizeMcpConfigFile: input.normalizeMcpConfigFile,
    saveConfigPatch,
    getMcpServers: input.settingsConfigRuntime.getMcpServers,
    applyMcpConfigFileSnapshot: input.settingsConfigRuntime.applyMcpConfigFileSnapshot,
    syncMcpConfigFromContent: input.settingsConfigRuntime.syncMcpConfigFromContent,
    setMcpToolState: input.settingsConfigRuntime.setMcpToolState,
    setMcpToolAutoApprove: input.settingsConfigRuntime.setMcpToolAutoApprove,
    callMcpTool: input.settingsConfigRuntime.callCurrentMcpTool,
    readMcpResource: input.settingsConfigRuntime.readCurrentMcpResource,
    broadcastSecurityConfigChanged: input.settingsConfigRuntime.broadcastSecurityConfigChanged,
    broadcastKeywordHighlightConfigChanged: input.settingsConfigRuntime.broadcastKeywordHighlightConfigChanged,
    broadcastMcpConfigChanged: input.settingsConfigRuntime.broadcastMcpConfigChanged
  })
  registerAiChatActionsIpc(ipcMain, {
    getChatConversationMessages,
    replaceChatConversationMessages,
    setMcpToolAutoApprove: input.settingsConfigRuntime.setMcpToolAutoApprove,
    callMcpTool: input.settingsConfigRuntime.callCurrentMcpTool,
    readMcpResource: input.settingsConfigRuntime.readCurrentMcpResource,
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
    syncSkillsConfigFromDisk: input.skillsRuntime.syncSkillsConfigFromDisk,
    loadSkillsFromDisk: input.skillsRuntime.loadSkillsFromDisk,
    saveSkillsSnapshot: input.skillsRuntime.saveSkillsSnapshot,
    broadcastSkillsUpdate: input.skillsRuntime.broadcastSkillsUpdate,
    ensureSkillsDirectory: input.skillsRuntime.ensureSkillsDirectory,
    validateSkillMetadata: input.skillsRuntime.validateSkillMetadata,
    normalizeSkillNameForDirectory: input.skillsRuntime.normalizeSkillNameForDirectory,
    buildSkillFile: input.skillsRuntime.buildSkillFile,
    startSkillsWatcher: input.skillsRuntime.startSkillsWatcher,
    findSkillByName: input.skillsRuntime.findSkillByName,
    createSkillWriteResult: input.skillsRuntime.createSkillWriteResult,
    isEditableSkill: input.skillsRuntime.isEditableSkill,
    pathExists: input.skillsRuntime.pathExists,
    openPath: (targetPath) => shell.openPath(targetPath),
    importSkillZip: input.skillsRuntime.importSkillZip,
    exportSkillZipBuffer: input.skillsRuntime.exportSkillZipBuffer,
    showSaveDialog: (event, options) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    }
  })
  registerKnowledgeBaseIpc(ipcMain, {
    ensureKnowledgeBaseDirectory: input.knowledgeBaseRuntime.ensureKnowledgeBaseDirectory,
    syncKnowledgeBaseConfigFromDisk: input.knowledgeBaseRuntime.syncKnowledgeBaseConfigFromDisk,
    listKnowledgeDir: input.knowledgeBaseRuntime.listKnowledgeDir,
    resolveKnowledgePath: input.knowledgeBaseRuntime.resolveKnowledgePath,
    getKnowledgeMimeType: input.knowledgeBaseRuntime.getKnowledgeMimeType,
    isKnowledgeImage: input.knowledgeBaseRuntime.isKnowledgeImage,
    knowledgeWriteResult: input.knowledgeBaseRuntime.knowledgeWriteResult,
    knowledgeMutationEntry: input.knowledgeBaseRuntime.knowledgeMutationEntry,
    knowledgeDeletedResult: input.knowledgeBaseRuntime.knowledgeDeletedResult,
    isSafeKnowledgeBasename: input.knowledgeBaseRuntime.isSafeKnowledgeBasename,
    ensureUniqueKnowledgeName: input.knowledgeBaseRuntime.ensureUniqueKnowledgeName,
    pathExists: input.knowledgeBaseRuntime.pathExists,
    isKnowledgeFileAllowedForImport: input.knowledgeBaseRuntime.isKnowledgeFileAllowedForImport,
    maxKnowledgeImportBytes: input.knowledgeBaseRuntime.maxKnowledgeImportBytes,
    collectKnowledgeImportTasks: input.knowledgeBaseRuntime.collectKnowledgeImportTasks,
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    sendKnowledgeProgress: input.knowledgeBaseRuntime.sendKnowledgeProgress,
    searchKnowledgeIndex: input.knowledgeBaseRuntime.searchKnowledgeIndex,
    getKnowledgeSearchIndex: input.knowledgeBaseRuntime.getKnowledgeSearchIndex,
    buildKnowledgeSearchIndex: input.knowledgeBaseRuntime.buildKnowledgeSearchIndex,
    setKnowledgeSearchIndex: input.knowledgeBaseRuntime.setKnowledgeSearchIndex
  })
  registerTerminalSessionsIpc(ipcMain, {
    sessions: input.terminalRuntime.sessions,
    getConfig: input.getConfig,
    defaultTerminalType: input.defaultConfig.terminal?.terminalType,
    normalizeTerminalType: input.normalizeTerminalType,
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    createId: () => randomUUID(),
    logRuntimeEvent,
    createSshTerminal: input.terminalRuntime.createSshTerminal,
    createSshTerminalConnectionInfo,
    createTerminalWriteResult,
    createTerminalBinaryWriteResult,
    createTerminalKillResult,
    createLocalTerminal: input.terminalRuntime.createLocalTerminal,
    registerTerminalForCodexBridge: input.terminalRuntime.registerTerminalForCodexBridge,
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
    sendCodexExit: input.terminalRuntime.sendCodexExit,
    sendCodexData: input.terminalRuntime.sendCodexData,
    closeCodexDataSession: input.terminalRuntime.closeCodexDataSession
  })
}
