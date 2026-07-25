import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import { formatMcpResourceReadContent } from './backend/ai/aiChat'
import { bindClassicProductSessionResponse } from './backend/agent/classicProductSessionLifecycle'
import { bindProductSessionNativeBinding } from './backend/agent/productSessionBindingLifecycle'
import { syncDatabaseProductSessionState as syncDatabaseProductSessionStateLifecycle } from './backend/agent/databaseProductSessionLifecycle'
import {
  bindCodexProductSessionThread,
  prepareCodexProductSessionLaunch
} from './backend/agent/codexProductSessionLifecycle'
import {
  createCodexSession,
  deleteCodexNativeThread,
  findCodexSavedSessionRolloutPath,
  killCodexSession,
  resizeCodexSession,
  setCodexSessionPendingContext,
  stopCodexProductSessionRuntimes,
  writeCodexSession
} from './backend/codex/codexCli'
import {
  clearCodexTerminalBridgeRuntimeTarget,
  ensureCodexTerminalBridgeServer,
  updateCodexTerminalBridgeRuntimeTarget
} from './backend/codex/codexTerminalBridge'
import {
  deleteChatConversationProjection,
  getChatConversationMessages,
  replaceChatConversationMessages,
} from './backend/chat/chatHistory'
import { logRuntimeEvent } from './backend/app/runtimeLog'
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
import { registerClineAgentIpc } from './ipc/clineAgent'
import { registerCodexSessionsIpc } from './ipc/codexSessions'
import { registerControlSocketIpc } from './backend/control/controlSocket'
import { registerDatabaseIpc } from './ipc/database'
import { databaseClineNativeBinding } from './backend/database/database'
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
import { registerProductSessionsIpc } from './ipc/productSessions'
import { registerSettingsPreferencesIpc } from './ipc/settingsPreferences'
import { registerSkillsIpc } from './ipc/skills'
import { registerTerminalSessionsIpc } from './ipc/terminalSessions'
import { registerTerminalToolsIpc } from './ipc/terminalTools'
import { registerUserAccountIpc } from './ipc/userAccount'
import { registerVoiceIpc } from './ipc/voice'
import { registerWindowIpc } from './ipc/window'
import { registerZmodemIpc } from './ipc/zmodem'
import { shouldUseAiChatBackendDouble, shouldUseE2eDialogFixtures } from '@shared/runtimeSwitches'
import { broadcastWindowEvent, sendWindowEvent } from '@shared/windowEvents'
import type { AiAgentSessionEvent, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'
import type { KeywordHighlightUserConfig, SecurityUserConfig } from '@shared/contracts/appRuntime'
import type { McpConfigFile } from '@shared/contracts/mcp'
import type { AiChatHistoryMessage } from '@shared/contracts/aiChat'
import type { UserConfig } from '@shared/contracts/userConfig'
import type {
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneStateSnapshot
} from '@shared/contracts/database'
import type { defaultConfig, mergeConfig, normalizeTerminalType } from './appConfigRuntime'
import type { createMainTerminalRuntime } from './terminalRuntime'
import type { createAppBootstrapRuntime } from './appBootstrapRuntime'
import type { createKnowledgeBaseRuntime } from './backend/knowledge/knowledgeBaseRuntime'
import type { createSettingsConfigRuntime } from './backend/settings/settingsConfigRuntime'
import type { createSkillsRuntime } from './backend/settings/skillsRuntime'
import type { ProductSessionRegistry } from './backend/agent/productSessionRegistry'
import { clineAgentSessionIdFor, deleteClineAgentSession, stopClineAgentSession } from './backend/agent/clineAgentRuntime'
import { createProductSessionPermanentDelete } from './backend/agent/productSessionDeletionLifecycle'
import { deleteDatabaseAiPaneSession } from '@shared/databaseAi'

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
  productSessionRegistry: ProductSessionRegistry
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
  let productSessionMutationBlocked = (_id: string) => false
  const saveConfigPatch = (patch: Partial<UserConfig>) => {
    const next = input.mergeConfig(input.getConfig(), patch)
    input.store.set('config', next)
    return next
  }

  const syncClassicProductSession = (
    conversation: { id: string; title: string },
    options: { isOpen?: boolean; createIsOpen?: boolean; projectionMessages?: AiChatHistoryMessage[] } = {}
  ) => {
    if (productSessionMutationBlocked(conversation.id)) return
    try {
      const existing = input.productSessionRegistry.get(conversation.id)
      if (existing) {
        if (existing.title !== conversation.title || options.isOpen !== undefined) {
          input.productSessionRegistry.update({
            id: conversation.id,
            title: conversation.title,
            ...(options.isOpen !== undefined ? { isOpen: options.isOpen } : {})
          })
        }
      } else {
        input.productSessionRegistry.create({
          id: conversation.id,
          surface: 'classic',
          title: conversation.title,
          isOpen: options.isOpen ?? options.createIsOpen ?? false
        })
      }
      const stored = input.productSessionRegistry.listProjectionMessages(conversation.id, { limit: 1 })
      const projection = options.projectionMessages === undefined && stored.totalMessages === 0
        ? getChatConversationMessages(conversation.id).data?.messages
        : options.projectionMessages
      if (projection) {
        const messages = projection
          .filter((message) => message.id !== 'aiopsterm-history-truncated')
          .map((message) => ({ messageId: message.id, payload: message }))
        if (stored.totalMessages === 0) input.productSessionRegistry.replaceProjectionMessages(conversation.id, messages)
        else if (options.projectionMessages !== undefined) input.productSessionRegistry.upsertProjectionMessages(conversation.id, messages)
      }
    } catch (error) {
      logRuntimeEvent('warn', 'product-session.classic-sync-failed', {
        productSessionId: conversation.id,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const permanentlyDeleteProductSession = createProductSessionPermanentDelete({
    registry: input.productSessionRegistry,
    stopRuntime: (session) => {
      if (session.surface === 'codex') return stopCodexProductSessionRuntimes(session.id)
      if (!session.nativeBinding && session.surface === 'database') {
        return deleteClineAgentSession(clineAgentSessionIdFor('database', session.id))
      }
      if (!session.nativeBinding && session.surface === 'classic') {
        return deleteClineAgentSession(clineAgentSessionIdFor('classic-chat', session.id))
      }
      return false
    },
    deleteNativeBinding: (binding) => {
      if (binding.engine === 'cline') return deleteClineAgentSession(binding.nativeSessionId)
      if (binding.engine === 'codex') return deleteCodexNativeThread(binding.nativeSessionId)
      return false
    },
    deleteProjection: (session) => {
      if (session.surface === 'classic') return deleteChatConversationProjection(session.id)
      if (session.surface === 'database') return deleteDatabaseAiPaneSession(session.id)
      return false
    }
  })
  productSessionMutationBlocked = permanentlyDeleteProductSession.blocksBinding

  const bindCodexProductSession = (
    productSessionId: Parameters<typeof bindCodexProductSessionThread>[0]['productSessionId'],
    event: Parameters<typeof bindCodexProductSessionThread>[0]['event'],
    options: Parameters<typeof bindCodexProductSessionThread>[0]['options']
  ) => bindCodexProductSessionThread({
      registry: input.productSessionRegistry,
      productSessionId,
      event,
      options,
      stopRuntime: killCodexSession,
      clearRuntimeTarget: clearCodexTerminalBridgeRuntimeTarget,
      deleteNativeSession: (threadId) => permanentlyDeleteProductSession.registerLateCleanup(
        productSessionId,
        () => deleteCodexNativeThread(threadId)
      ),
      isProductSessionDeleting: permanentlyDeleteProductSession.blocksBinding,
      logFailure: (eventName, fields) => logRuntimeEvent('warn', eventName, fields)
    })

  const bindDatabaseProductSession = async (
    request: DatabaseAiPaneResponseInput | DatabaseAiDrawerResponseInput,
    result: DatabaseAiPaneResponseResult | DatabaseAiDrawerResponseResult
  ) => {
    const productSessionId = String(request.conversationId || '').trim()
    const connectionId = String(request.context.connectionId || '').trim()
    if (!productSessionId || !connectionId || !result.ok || !result.data || result.data.provider === 'aiopsterm-local') return
    const binding = databaseClineNativeBinding(request)
    const database = {
      connectionId,
      ...(request.context.databaseName ? { databaseName: request.context.databaseName } : {}),
      ...(request.context.schemaName ? { schemaName: request.context.schemaName } : {})
    }
    await bindProductSessionNativeBinding({
      registry: input.productSessionRegistry,
      createInput: {
        id: productSessionId,
        surface: 'database',
        title: [request.context.databaseName, request.context.schemaName].filter(Boolean).join(' / ') || 'DB AI',
        database
      },
      updateInput: { id: productSessionId, database },
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: binding.nativeSessionId,
        profile: binding.profile,
        scopeKey: binding.scopeKey
      },
      stopClosedNativeSession: async () => {
        await stopClineAgentSession(binding.nativeSessionId)
      },
      stopFailedNativeSession: async () => {
        await stopClineAgentSession(binding.nativeSessionId)
      },
      stopReplacedNativeSession: async (replacedBinding) => {
        if (replacedBinding.engine === 'cline') await stopClineAgentSession(replacedBinding.nativeSessionId)
      },
      isProductSessionDeleting: () => permanentlyDeleteProductSession.blocksBinding(productSessionId),
      deleteDeletingNativeSession: () => permanentlyDeleteProductSession.registerLateCleanup(
        productSessionId,
        () => deleteClineAgentSession(binding.nativeSessionId)
      ),
      failureEvent: 'product-session.database-bind-failed',
      stopFailureEvent: 'product-session.database-stop-failed',
      logFailure: (eventName, fields) => logRuntimeEvent('warn', eventName, fields)
    })
  }

  const syncDatabaseProductSessionState = (
    state: DatabaseAiPaneStateSnapshot,
  ) => syncDatabaseProductSessionStateLifecycle({
    registry: input.productSessionRegistry,
    state,
    isMutationBlocked: productSessionMutationBlocked,
    logFailure: (eventName, fields) => logRuntimeEvent('warn', eventName, fields)
  })

  registerControlSocketIpc(ipcMain)
  registerAgentHooksIpc(ipcMain)
  registerExportMcpIpc(ipcMain)
  registerAiCatalogIpc(ipcMain)
  registerAiChatIpc(ipcMain, {
    resolveTrustedHostTarget: (event, terminalSessionId) => {
      const session = input.terminalRuntime.sessions.get(terminalSessionId)
      if (!session || session.window.webContents.id !== event.sender.id || !session.classicTarget) return null
      return { ...session.classicTarget }
    },
    bindProductSession: (request, result) => bindClassicProductSessionResponse({
      registry: input.productSessionRegistry,
      request,
      result,
      stopNativeSession: async (nativeSessionId) => {
        await stopClineAgentSession(nativeSessionId)
      },
      deleteNativeSession: (nativeSessionId) => permanentlyDeleteProductSession.registerLateCleanup(
        String(request.conversationId || ''),
        () => deleteClineAgentSession(nativeSessionId)
      ),
      isProductSessionDeleting: permanentlyDeleteProductSession.blocksBinding,
      logFailure: (eventName, fields) => logRuntimeEvent('warn', eventName, fields)
    })
  })
  registerClineAgentIpc(ipcMain)
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
  registerChatHistoryIpc(ipcMain, {
    syncProductSession: syncClassicProductSession,
    deleteProductSession: permanentlyDeleteProductSession
  })
  registerProductSessionsIpc(ipcMain, {
    registry: input.productSessionRegistry,
    permanentlyDelete: permanentlyDeleteProductSession,
    isMutationBlocked: permanentlyDeleteProductSession.blocksBinding,
    broadcastChange: (event) => broadcastWindowEvent(BrowserWindow.getAllWindows(), 'product-session:changed', event),
    stopNativeBinding: async (engine, nativeSessionId) => {
      if (engine !== 'cline') return false
      return stopClineAgentSession(nativeSessionId)
    }
  })
  registerDatabaseIpc(ipcMain, {
    showSaveDialog: (options) => {
      const owner = BrowserWindow.getFocusedWindow()
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    },
    bindProductSession: bindDatabaseProductSession,
    bindDrawerProductSession: bindDatabaseProductSession,
    syncProductSessionState: syncDatabaseProductSessionState
  })
  registerExtensionsIpc(ipcMain, {
    openExternal: (url) => shell.openExternal(url)
  })
  registerFilesIpc(ipcMain)
  registerKubernetesIpc(ipcMain)
  registerManagedAiSessionsIpc(ipcMain, {
    emitAgentSessionEvent: input.broadcastAiAgentSessionEvent,
    focusManagedAiSession: input.broadcastManagedAiSessionFocusRequest,
    isTerminalSessionLive: (sessionId) => input.terminalRuntime.sessions.has(sessionId)
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
    ackTerminalData: input.terminalRuntime.ackTerminalData
  })

  registerCodexSessionsIpc(ipcMain, {
    getOwnerWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    createId: () => randomUUID(),
    getUserDataPath: () => app.getPath('userData'),
    logRuntimeEvent,
    ensureCodexTerminalBridgeServer,
    updateCodexTerminalBridgeSessionTarget: updateCodexTerminalBridgeRuntimeTarget,
    clearCodexTerminalBridgeSessionTarget: clearCodexTerminalBridgeRuntimeTarget,
    createCodexSession,
    prepareCodexSessionLaunch: (options) => prepareCodexProductSessionLaunch({
      registry: input.productSessionRegistry,
      options,
      findSavedSessionRolloutPath: findCodexSavedSessionRolloutPath
    }),
    setCodexSessionPendingContext,
    writeCodexSession,
    resizeCodexSession,
    killCodexSession,
    sendCodexLifecycle: (owner, lifecycle) => sendWindowEvent(owner, 'codex:lifecycle', lifecycle),
    sendCodexExit: input.terminalRuntime.sendCodexExit,
    sendCodexData: input.terminalRuntime.sendCodexData,
    sendCodexThread: (owner, event) => sendWindowEvent(owner, 'codex:thread', event),
    bindCodexThread: bindCodexProductSession,
    closeCodexDataSession: input.terminalRuntime.closeCodexDataSession
  })
}
