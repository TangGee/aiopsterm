import { computed, nextTick, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { databaseClient } from '@/services/database/databaseClient'
import { currentSqlStatement, extractFencedSql } from '@/services/database/databaseSqlEditorRuntime'
import {
  applyDbAiPaneStateSnapshot as applyRuntimeDbAiPaneStateSnapshot,
  clampDbAiPaneWidth,
  currentDbAiPaneStateSnapshot as currentRuntimeDbAiPaneStateSnapshot,
  dbAiActionLabel,
  dbAiPaneCanSend as runtimeDbAiPaneCanSend,
  dbAiPaneContextSummary as runtimeDbAiPaneContextSummary,
  dbAiPaneIsStreaming as runtimeDbAiPaneIsStreaming,
  dbAiPaneRequestInput,
  dbAiPaneStatusLabel,
  dbAiQuickPromptText,
  dbAiSql,
  dbAiDialectLabel,
  normalizeDbAiTargetDialect,
  normalizeDbAiPaneContext as normalizeRuntimeDbAiPaneContext,
  type SqlTab
} from '@/services/database/databaseAiRuntime'
import {
  isDbAiPaneLifecycleData,
  isDbAiPaneRequestData,
  isDbAiPaneResponseData,
  isDbAiPaneStateSnapshot,
  type DbAiPaneContext,
  type DbAiPaneMessage,
  type DbAiAction,
  type DbAiRequest
} from '@/services/database/databaseBackendGuards'
import { DB_AI_PANE_DEFAULT_WIDTH, sqlConnectionRequiresSchema } from '@/services/database/databaseWorkspaceRuntime'
import type { DbAiPaneQuickPrompt, SqlConsoleContext } from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneResponseResult,
  DatabaseAiResponseLanguage,
  DatabaseAiPaneStateSnapshot,
  DatabaseConnectionInfo
} from '@shared/contracts/database'
import { databaseAiNl2SqlPrompt } from '@shared/databaseAiSqlRuntime'

type DatabaseAiPaneWorkspaceRuntimeState = {
  connections: Ref<DatabaseConnectionInfo[]>
  expandedConnections: Ref<string[]>
  activeSqlTab: ComputedRef<SqlTab | null>
  databaseAiPanelsRef: Ref<{ scrollPaneMessagesToBottom: () => void; focusPaneComposer?: () => void } | null>
}

type DatabaseAiPaneWorkspaceRuntimeDeps = {
  showNotice: (message: string) => void
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  defaultSqlContextForConnection: (connection: DatabaseConnectionInfo) => SqlConsoleContext
  resolveSqlConsoleContext: (connectionId?: string) => SqlConsoleContext
  connectConnection: (connectionId: string) => Promise<boolean>
  getResponseLanguage: () => DatabaseAiResponseLanguage
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
}

const createDbAiPaneConversationId = () => {
  const id = globalThis.crypto?.randomUUID?.()
  return `dbai-pane-conversation-${id || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

export const createDatabaseAiPaneWorkspaceRuntime = (
  state: DatabaseAiPaneWorkspaceRuntimeState,
  deps: DatabaseAiPaneWorkspaceRuntimeDeps
) => {
  const { connections, expandedConnections, activeSqlTab, databaseAiPanelsRef } = state
  const {
    showNotice,
    bridgeErrorMessage,
    findConnection,
    defaultSqlContextForConnection,
    resolveSqlConsoleContext,
    connectConnection,
    getResponseLanguage,
    getSelectedSqlText,
    getSqlCursorOffset
  } = deps

  const dbAiPaneOpen = ref(false)
  const dbAiPaneWidth = ref(DB_AI_PANE_DEFAULT_WIDTH)
  const dbAiPaneResizing = ref(false)
  const dbAiPaneContext = reactive<DbAiPaneContext>({
    connectionId: '',
    catalogName: '',
    schemaName: '',
    dbType: ''
  })
  const dbAiPaneDraft = ref('')
  const dbAiPaneComposerAction = ref<DbAiAction | null>(null)
  const dbAiPaneMessages = ref<DbAiPaneMessage[]>([])
  const dbAiPaneConversationId = ref(createDbAiPaneConversationId())
  const dbAiPaneRequestStarting = ref(false)
  let dbAiPaneResizeStartX = 0
  let dbAiPaneResizeStartWidth = DB_AI_PANE_DEFAULT_WIDTH
  let dbAiPaneContextTouched = false
  let dbAiPaneStateHydrating = false
  let dbAiPaneStateNoticeShown = false
  let dbAiPaneConversationGeneration = 0
  let dbAiPaneStateSaveQueue: Promise<void> = Promise.resolve()
  let dbAiPaneStateSaveSuspended = false

  const canToggleDbAiPane = computed(() => connections.value.length > 0)
  const dbAiPaneConnection = computed(() => findConnection(dbAiPaneContext.connectionId) ?? null)
  const dbAiPaneCatalogOptions = computed(() => dbAiPaneConnection.value?.catalogs ?? [])
  const dbAiPaneCatalog = computed(() => dbAiPaneCatalogOptions.value.find((catalog) => catalog.name === dbAiPaneContext.catalogName) ?? null)
  const dbAiPaneSchemaOptions = computed(() => dbAiPaneCatalog.value?.schemas ?? [])
  const dbAiPaneRequiresSchema = computed(() => !!dbAiPaneConnection.value && sqlConnectionRequiresSchema(dbAiPaneConnection.value))
  const dbAiPaneConnectionNeedsConnect = computed(() => {
    const connection = dbAiPaneConnection.value
    return !!connection && connection.status !== 'connected' && connection.status !== 'testing'
  })
  const dbAiPaneContextTitle = computed(() => dbAiPaneContextSummary.value || 'No database context selected')
  const dbAiPaneContextSummary = computed(() => runtimeDbAiPaneContextSummary(dbAiPaneConnection.value, dbAiPaneContext))
  const dbAiPaneIsStreaming = computed(() => runtimeDbAiPaneIsStreaming(dbAiPaneMessages.value))
  const dbAiPaneCanSend = computed(() =>
    !dbAiPaneRequestStarting.value && runtimeDbAiPaneCanSend(dbAiPaneDraft.value, dbAiPaneContext, dbAiPaneIsStreaming.value)
  )
  const dbAiPaneComposerPlaceholder = computed(() =>
    dbAiPaneComposerAction.value === 'nl2sql' ? 'Describe the data you want to query' : 'Ask DB AI'
  )

  const sqlTabMatchesDbAiPaneContext = (tab: SqlTab, context: DbAiPaneContext) =>
    tab.connectionId === context.connectionId &&
    tab.catalogName === context.catalogName &&
    (tab.schemaName || '') === (context.schemaName || '')

  const dbAiPaneMessageMatchesContext = (
    message: DbAiPaneMessage,
    context: DbAiPaneContext,
    contextSummary: string
  ) => {
    if (message.context) {
      return (
        message.context.connectionId === context.connectionId &&
        message.context.catalogName === context.catalogName &&
        (message.context.schemaName || '') === (context.schemaName || '')
      )
    }
    const actionContext = message.sqlAction?.context
    if (!actionContext) return false
    if (!actionContext.connectionId || !actionContext.databaseName) return message.contextSummary === contextSummary
    return (
      actionContext.connectionId === context.connectionId &&
      actionContext.databaseName === context.catalogName &&
      (actionContext.schemaName || '') === (context.schemaName || '')
    )
  }

  const normalizeDbAiPaneContext = (input: Partial<DbAiPaneContext> | SqlConsoleContext): DbAiPaneContext => {
    return normalizeRuntimeDbAiPaneContext(input, connections.value)
  }

  const applyDbAiPaneContext = (input: Partial<DbAiPaneContext> | SqlConsoleContext, touched = true) => {
    const next = normalizeDbAiPaneContext(input)
    dbAiPaneContext.connectionId = next.connectionId
    dbAiPaneContext.catalogName = next.catalogName
    dbAiPaneContext.schemaName = next.schemaName
    dbAiPaneContext.dbType = next.dbType
    dbAiPaneContextTouched = touched
  }

  const resolveDbAiPaneContextFromWorkspace = () => normalizeDbAiPaneContext(resolveSqlConsoleContext())

  const ensureDbAiPaneContextInitialized = (force = false) => {
    if (!force && dbAiPaneContext.connectionId && findConnection(dbAiPaneContext.connectionId)) {
      applyDbAiPaneContext(dbAiPaneContext, dbAiPaneContextTouched)
      return
    }
    applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
  }

  const syncDbAiPaneContextAfterActiveTabChange = () => {
    if (dbAiPaneOpen.value && !dbAiPaneContextTouched) applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
  }

  const syncDbAiPaneContextAfterCatalogChange = () => {
    if (dbAiPaneOpen.value || dbAiPaneContext.connectionId) {
      if (dbAiPaneContext.connectionId && findConnection(dbAiPaneContext.connectionId)) {
        applyDbAiPaneContext(dbAiPaneContext, dbAiPaneContextTouched)
      } else {
        ensureDbAiPaneContextInitialized(true)
      }
    }
  }

  const toggleDbAiPane = () => {
    if (dbAiPaneOpen.value) closeDbAiPane()
    else openDbAiPane()
  }

  const openDbAiPane = () => {
    if (!canToggleDbAiPane.value) return
    ensureDbAiPaneContextInitialized(false)
    dbAiPaneOpen.value = true
    scrollDbAiPaneMessagesToBottom()
  }

  const closeDbAiPane = () => {
    dbAiPaneOpen.value = false
  }

  const useActiveDbAiPaneContext = () => {
    applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
    showNotice('DB AI context synced with active workspace tab')
  }

  const syncDbAiPaneContextToActiveSqlTab = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    applyDbAiPaneContext({
      connectionId: tab.connectionId,
      catalogName: tab.catalogName,
      schemaName: tab.schemaName,
      dbType: findConnection(tab.connectionId)?.dbType ?? ''
    }, false)
  }

  const updateDbAiPaneConnection = (event: Event) => {
    const connectionId = (event.target as HTMLSelectElement).value
    const connection = findConnection(connectionId)
    if (!connection) return
    applyDbAiPaneContext(defaultSqlContextForConnection(connection), true)
  }

  const updateDbAiPaneCatalog = (event: Event) => {
    const catalogName = (event.target as HTMLSelectElement).value
    applyDbAiPaneContext({ ...dbAiPaneContext, catalogName, schemaName: '' }, true)
  }

  const updateDbAiPaneSchema = (event: Event) => {
    dbAiPaneContext.schemaName = (event.target as HTMLSelectElement).value
    dbAiPaneContextTouched = true
  }

  const connectDbAiPaneConnection = async () => {
    const connection = dbAiPaneConnection.value
    if (!connection) return
    const connected = await connectConnection(connection.id)
    if (!connected) return
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
    showNotice('DB AI context connection opened')
  }

  const handleDbAiPaneDraftKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    event.preventDefault()
    sendDbAiPaneMessage()
  }

  const prepareDbAiPaneAction = (action: DbAiAction) => {
    openDbAiPane()
    dbAiPaneComposerAction.value = action
    void nextTick(() => databaseAiPanelsRef.value?.focusPaneComposer?.())
  }

  const cancelDbAiPaneActionMode = () => {
    dbAiPaneComposerAction.value = null
  }

  const sendDbAiPaneQuickPrompt = (kind: DbAiPaneQuickPrompt) => {
    if (dbAiPaneIsStreaming.value || dbAiPaneRequestStarting.value) return
    const responseLanguage = getResponseLanguage()
    if (kind === 'explainActive') {
      const tab = activeSqlTab.value
      if (!tab) return
      const sql = getSelectedSqlText().trim() || currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || tab.sql.trim()
      if (!sql) {
        showNotice('SQL is empty')
        return
      }
      syncDbAiPaneContextToActiveSqlTab()
      openDbAiPane()
      sendDbAiPaneMessage(dbAiQuickPromptText(kind, sql, responseLanguage), { action: 'explain', sourceSql: sql })
      return
    }
    openDbAiPane()
    const prompt = dbAiQuickPromptText(kind, '', responseLanguage)
    sendDbAiPaneMessage(prompt, kind === 'selectSample' ? { action: 'nl2sql', sourceSql: prompt } : {})
  }

  const sendDbAiPaneMessage = async (
    promptOverride = '',
    options: { action?: DbAiAction; sourceSql?: string } = {}
  ) => {
    const responseLanguage = getResponseLanguage()
    const rawPrompt = (promptOverride || dbAiPaneDraft.value).trim()
    const action = options.action ?? (promptOverride ? undefined : dbAiPaneComposerAction.value ?? undefined)
    const prompt = action === 'nl2sql' && !promptOverride
      ? databaseAiNl2SqlPrompt(rawPrompt, responseLanguage)
      : rawPrompt
    if (!prompt || dbAiPaneIsStreaming.value || dbAiPaneRequestStarting.value) return
    dbAiPaneRequestStarting.value = true
    try {
      ensureDbAiPaneContextInitialized(false)
      if (!dbAiPaneContext.connectionId || !dbAiPaneContext.catalogName) {
        showNotice('Database context is required before using DB AI pane')
        return
      }
      if (dbAiPaneConnectionNeedsConnect.value) {
        await connectDbAiPaneConnection()
        if (dbAiPaneConnectionNeedsConnect.value) return
      }
      // Context/open-state watchers can otherwise overwrite lifecycle messages created by the next IPC call.
      await nextTick()
      await persistDbAiPaneState()
      dbAiPaneStateSaveSuspended = true
      try {
        const contextSummary = dbAiPaneContextSummary.value
        const contextSnapshot = { ...dbAiPaneContext }
        const activeTabSnapshot = activeSqlTab.value
        const activeSqlSnapshot = activeTabSnapshot && sqlTabMatchesDbAiPaneContext(activeTabSnapshot, contextSnapshot)
          ? activeTabSnapshot.sql
          : ''
        const activeTableNameSnapshot = activeTabSnapshot && sqlTabMatchesDbAiPaneContext(activeTabSnapshot, contextSnapshot)
          ? activeTabSnapshot.tableName || ''
          : ''
        const messageSnapshot = dbAiPaneMessages.value
          .filter((message) => message.responseLanguage === responseLanguage)
          .filter((message) => dbAiPaneMessageMatchesContext(message, contextSnapshot, contextSummary))
          .map((message) => ({
            ...message,
            ...(message.context ? { context: { ...message.context } } : {}),
            ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
          }))
        const conversationIdSnapshot = dbAiPaneConversationId.value
        const requestInput = dbAiPaneRequestInput({
          conversationId: conversationIdSnapshot,
          prompt,
          action,
          responseLanguage,
          context: contextSnapshot,
          contextSummary,
          activeSql: activeSqlSnapshot,
          tableName: activeTableNameSnapshot,
          messages: messageSnapshot
        })
        const createBridge = databaseClient.createDatabaseAiPaneRequest()
        if (!createBridge) {
          showNotice('DB AI pane request service unavailable')
          return
        }
        let created: DatabaseAiPaneRequestResult
        const conversationGeneration = dbAiPaneConversationGeneration
        try {
          created = await createBridge(requestInput)
        } catch (error) {
          showNotice(bridgeErrorMessage(error, 'DB AI pane request failed'))
          return
        }
        if (conversationGeneration !== dbAiPaneConversationGeneration) return
        if (!created.ok) {
          showNotice(created.errorMessage || 'DB AI pane request failed')
          return
        }
        if (!isDbAiPaneRequestData(created.data)) {
          showNotice('DB AI pane backend returned malformed request data.')
          return
        }
        const targetDialect = normalizeDbAiTargetDialect(contextSnapshot.dbType)
        const sqlAction = action
          ? {
              action,
              label: dbAiActionLabel(action, responseLanguage),
              sourceSql: options.sourceSql ?? (action === 'nl2sql' ? rawPrompt : activeSqlSnapshot),
              generatedSql: '',
              targetDialect,
              transport: 'pane' as const,
              context: {
                connectionId: contextSnapshot.connectionId,
                dbType: contextSnapshot.dbType,
                databaseName: contextSnapshot.catalogName,
                schemaName: contextSnapshot.schemaName || undefined,
                contextSummary
              }
            }
          : undefined
        const userMessage = {
          ...created.data.userMessage,
          context: { ...contextSnapshot },
          ...(sqlAction ? { sqlAction: { ...sqlAction, context: { ...sqlAction.context } } } : {})
        }
        const assistantMessage = {
          ...created.data.assistantMessage,
          context: { ...contextSnapshot },
          ...(sqlAction ? { sqlAction: { ...sqlAction, context: { ...sqlAction.context } } } : {})
        }
        dbAiPaneMessages.value = [...dbAiPaneMessages.value, userMessage, assistantMessage].slice(-24)
        if (!promptOverride) dbAiPaneDraft.value = ''
        dbAiPaneComposerAction.value = null
        void requestDbAiPaneResponse(
          assistantMessage.id,
          prompt,
          contextSnapshot,
          contextSummary,
          created.data.requestId,
          activeSqlSnapshot,
          activeTableNameSnapshot,
          messageSnapshot,
          sqlAction,
          responseLanguage,
          conversationGeneration,
          conversationIdSnapshot
        )
        scrollDbAiPaneMessagesToBottom()
      } finally {
        dbAiPaneStateSaveSuspended = false
        void persistDbAiPaneState()
      }
    } finally {
      dbAiPaneRequestStarting.value = false
    }
  }

  const failDbAiPaneMessage = (messageId: string, errorMessage: string) => {
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) =>
      message.id === messageId && message.status !== 'cancelled'
        ? { ...message, status: 'error', content: errorMessage, updatedAt: Date.now() }
        : message
    )
    showNotice(errorMessage)
    scrollDbAiPaneMessagesToBottom()
  }

  const requestDbAiPaneResponse = async (
    messageId: string,
    prompt: string,
    context: DbAiPaneContext,
    contextSummary: string,
    requestId: string,
    activeSql: string,
    tableName: string,
    messages: DbAiPaneMessage[],
    sqlAction: DbAiPaneMessage['sqlAction'] | undefined,
    responseLanguage: DatabaseAiResponseLanguage,
    conversationGeneration: number,
    conversationId: string
  ) => {
    const startBridge = databaseClient.startDatabaseAiPaneResponse()
    if (!startBridge) {
      failDbAiPaneMessage(messageId, 'DB AI pane start service unavailable')
      return
    }
    let started: DatabaseAiPaneLifecycleResult
    try {
      started = await startBridge({ requestId, assistantMessageId: messageId })
    } catch (error) {
      failDbAiPaneMessage(messageId, bridgeErrorMessage(error, 'DB AI pane request failed to start'))
      return
    }
    if (!started.ok) {
      failDbAiPaneMessage(messageId, started.errorMessage || 'DB AI pane request failed to start')
      return
    }
    if (!isDbAiPaneLifecycleData(started.data, { requestId, assistantMessageId: messageId })) {
      failDbAiPaneMessage(messageId, 'DB AI pane backend returned malformed lifecycle data.')
      return
    }
    if (conversationGeneration !== dbAiPaneConversationGeneration) {
      void persistDbAiPaneState()
      return
    }
    applyDbAiPaneAssistantMessage(started.data.assistantMessage, sqlAction)
    const generateBridge = databaseClient.generateDatabaseAiPaneResponse()
    if (!generateBridge) {
      failDbAiPaneMessage(messageId, 'DB AI pane response service unavailable')
      return
    }
    try {
      const result = await generateBridge({
        ...dbAiPaneRequestInput({
          conversationId,
          prompt,
          action: sqlAction?.action,
          responseLanguage,
          context,
          contextSummary,
          activeSql,
          tableName,
          messages
        }),
        requestId,
        assistantMessageId: messageId
      })
      if (conversationGeneration !== dbAiPaneConversationGeneration) {
        void persistDbAiPaneState()
        return
      }
      finishDbAiPaneMessage(messageId, result, requestId)
    } catch (error) {
      if (conversationGeneration !== dbAiPaneConversationGeneration) {
        void persistDbAiPaneState()
        return
      }
      failDbAiPaneMessage(messageId, bridgeErrorMessage(error, 'DB AI pane response failed'))
    }
  }

  const applyDbAiPaneAssistantMessage = (assistantMessage: DbAiPaneMessage, sqlAction?: DbAiPaneMessage['sqlAction']) => {
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
      if (message.id !== assistantMessage.id) return message
      const action = sqlAction ?? message.sqlAction
      const messageContext = assistantMessage.context ?? message.context
      return {
        ...assistantMessage,
        ...(messageContext ? { context: { ...messageContext } } : {}),
        ...(action ? { sqlAction: { ...action, context: { ...action.context } } } : {})
      }
    })
    scrollDbAiPaneMessagesToBottom()
  }

  const finishDbAiPaneMessage = (messageId: string, result: DatabaseAiPaneResponseResult, requestId: string) => {
    const hasValidResponseData = isDbAiPaneResponseData(result.data, { requestId, assistantMessageId: messageId })
    const responseData = hasValidResponseData ? result.data : null
    if (result.ok && !hasValidResponseData) {
      failDbAiPaneMessage(messageId, 'DB AI pane backend returned malformed response data.')
      return
    }
    if (!result.ok && !hasValidResponseData) {
      failDbAiPaneMessage(messageId, result.errorMessage || 'DB AI pane response failed')
      return
    }
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
      if (message.id !== messageId || message.status === 'cancelled') return message
      if (responseData) {
        const sqlAction = message.sqlAction
        const messageContext = responseData.assistantMessage.context ?? message.context
        return {
          ...responseData.assistantMessage,
          ...(messageContext ? { context: { ...messageContext } } : {}),
          ...(sqlAction
            ? {
                sqlAction: {
                  ...sqlAction,
                  generatedSql: sqlAction.action === 'explain' ? '' : extractFencedSql(responseData.assistantMessage.content),
                  context: { ...sqlAction.context }
                }
              }
            : {})
        }
      }
      return message
    })
    scrollDbAiPaneMessagesToBottom()
  }

  const cancelDbAiPaneResponse = async () => {
    const activeAssistant = [...dbAiPaneMessages.value]
      .reverse()
      .find((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))
    if (!activeAssistant) return
    const cancelBridge = databaseClient.cancelDatabaseAiPaneResponse()
    if (!cancelBridge) {
      showNotice('DB AI pane cancel service unavailable')
      return
    }
    let result: DatabaseAiPaneLifecycleResult
    try {
      result = await cancelBridge({ requestId: activeAssistant.requestId, assistantMessageId: activeAssistant.id })
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI pane cancel failed'))
      return
    }
    if (!result.ok) {
      showNotice(result.errorMessage || 'DB AI pane cancel failed')
      return
    }
    if (!isDbAiPaneLifecycleData(result.data, { requestId: activeAssistant.requestId, assistantMessageId: activeAssistant.id })) {
      showNotice('DB AI pane backend returned malformed lifecycle data.')
      return
    }
    applyDbAiPaneAssistantMessage(result.data.assistantMessage)
    showNotice('DB AI pane response stopped')
  }

  const resetDbAiPaneConversation = () => {
    dbAiPaneConversationGeneration += 1
    dbAiPaneConversationId.value = createDbAiPaneConversationId()
    dbAiPaneMessages.value = []
    dbAiPaneDraft.value = ''
    dbAiPaneComposerAction.value = null
    showNotice('DB AI pane conversation reset')
  }

  const syncDbAiPaneActionRequest = (request: DbAiRequest) => {
    const userId = `dbai-pane-action-${request.id}-user`
    const assistantId = `dbai-pane-action-${request.id}-assistant`
    const requestAlreadyMirrored = dbAiPaneMessages.value.some((message) => message.id === userId || message.id === assistantId)
    const connectionId = String(request.backendContext.connectionId || '')
    if (!requestAlreadyMirrored && connectionId && findConnection(connectionId)) {
      applyDbAiPaneContext({
        connectionId,
        catalogName: String(request.backendContext.databaseName || ''),
        schemaName: String(request.backendContext.schemaName || ''),
        dbType: request.backendContext.dbType || ''
      }, false)
    } else if (!requestAlreadyMirrored) {
      ensureDbAiPaneContextInitialized(false)
    }
    const contextSummary = request.contextSummary || dbAiPaneContextSummary.value
    const responseLanguage: DatabaseAiResponseLanguage = request.responseLanguage === 'zh-CN' ? 'zh-CN' : 'en-US'
    const sqlAction = {
      action: request.action,
      label: request.label,
      sourceSql: request.sourceSql,
      generatedSql: dbAiSql(request),
      targetDialect: request.targetDialect,
      transport: 'drawer' as const,
      context: {
        ...request.backendContext,
        contextSummary: request.backendContext.contextSummary || contextSummary
      }
    }
    const userMessage: DbAiPaneMessage = {
      id: userId,
      requestId: request.id,
      role: 'user',
      status: 'done',
      content: request.label,
      contextSummary,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      responseLanguage,
      context: {
        connectionId: String(request.backendContext.connectionId || ''),
        catalogName: String(request.backendContext.databaseName || ''),
        schemaName: String(request.backendContext.schemaName || ''),
        dbType: request.backendContext.dbType || ''
      },
      sqlAction: { ...sqlAction, generatedSql: '', context: { ...sqlAction.context } }
    }
    const assistantMessage: DbAiPaneMessage = {
      id: assistantId,
      requestId: request.id,
      role: 'assistant',
      status: request.status,
      content: request.text,
      contextSummary,
      createdAt: request.createdAt + 1,
      updatedAt: request.updatedAt,
      responseLanguage,
      context: {
        connectionId: String(request.backendContext.connectionId || ''),
        catalogName: String(request.backendContext.databaseName || ''),
        schemaName: String(request.backendContext.schemaName || ''),
        dbType: request.backendContext.dbType || ''
      },
      sqlAction: { ...sqlAction, context: { ...sqlAction.context } }
    }
    const next = dbAiPaneMessages.value.filter((message) => message.id !== userId && message.id !== assistantId)
    dbAiPaneMessages.value = [...next, userMessage, assistantMessage]
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-24)
    if (!requestAlreadyMirrored) dbAiPaneOpen.value = true
    scrollDbAiPaneMessagesToBottom()
  }

  const scrollDbAiPaneMessagesToBottom = () => {
    void nextTick(() => {
      databaseAiPanelsRef.value?.scrollPaneMessagesToBottom()
    })
  }

  const startDbAiPaneResize = (event: PointerEvent) => {
    event.preventDefault()
    dbAiPaneResizeStartX = event.clientX
    dbAiPaneResizeStartWidth = dbAiPaneWidth.value
    dbAiPaneResizing.value = true
    window.addEventListener('pointermove', handleDbAiPaneResizeMove)
    window.addEventListener('pointerup', stopDbAiPaneResize)
    window.addEventListener('mousemove', handleDbAiPaneResizeMove)
    window.addEventListener('mouseup', stopDbAiPaneResize)
  }

  const handleDbAiPaneResizeMove = (event: PointerEvent | MouseEvent) => {
    if (!dbAiPaneResizing.value) return
    dbAiPaneWidth.value = clampDbAiPaneWidth(dbAiPaneResizeStartWidth + dbAiPaneResizeStartX - event.clientX)
  }

  const stopDbAiPaneResize = () => {
    if (!dbAiPaneResizing.value) return
    dbAiPaneResizing.value = false
    window.removeEventListener('pointermove', handleDbAiPaneResizeMove)
    window.removeEventListener('pointerup', stopDbAiPaneResize)
    window.removeEventListener('mousemove', handleDbAiPaneResizeMove)
    window.removeEventListener('mouseup', stopDbAiPaneResize)
  }

  const resetDbAiPaneWidth = () => {
    dbAiPaneWidth.value = DB_AI_PANE_DEFAULT_WIDTH
  }

  const applyDbAiPaneStateSnapshot = (snapshot: DatabaseAiPaneStateSnapshot) => {
    const next = applyRuntimeDbAiPaneStateSnapshot(snapshot, normalizeDbAiPaneContext)
    dbAiPaneConversationId.value = next.conversationId || createDbAiPaneConversationId()
    dbAiPaneOpen.value = next.open
    dbAiPaneWidth.value = next.width
    if (next.context) applyDbAiPaneContext(next.context, true)
    else ensureDbAiPaneContextInitialized(true)
    dbAiPaneDraft.value = next.draft
    dbAiPaneMessages.value = next.messages
  }

  const currentDbAiPaneStateSnapshot = (): DatabaseAiPaneStateSnapshot =>
    currentRuntimeDbAiPaneStateSnapshot({
      conversationId: dbAiPaneConversationId.value,
      open: dbAiPaneOpen.value,
      width: dbAiPaneWidth.value,
      context: dbAiPaneContext,
      draft: dbAiPaneDraft.value,
      messages: dbAiPaneMessages.value
    })

  const loadDbAiPaneState = async () => {
    dbAiPaneStateHydrating = true
    try {
      const bridge = databaseClient.getDatabaseAiPaneState()
      if (!bridge) {
        ensureDbAiPaneContextInitialized(true)
        showNotice('DB AI pane state service unavailable')
        return
      }
      const result = await bridge()
      if (!result.ok || !result.data) {
        ensureDbAiPaneContextInitialized(true)
        showNotice(result.errorMessage || 'DB AI pane state load failed')
        return
      }
      if (!isDbAiPaneStateSnapshot(result.data)) {
        ensureDbAiPaneContextInitialized(true)
        showNotice('DB AI pane state backend returned malformed result data.')
        return
      }
      applyDbAiPaneStateSnapshot(result.data)
    } catch {
      ensureDbAiPaneContextInitialized(true)
      showNotice('DB AI pane state load failed')
    } finally {
      dbAiPaneStateHydrating = false
    }
  }

  const persistDbAiPaneState = () => {
    if (dbAiPaneStateHydrating || dbAiPaneStateSaveSuspended) return Promise.resolve()
    const snapshot = currentDbAiPaneStateSnapshot()
    const saveSnapshot = async () => {
      const bridge = databaseClient.saveDatabaseAiPaneState()
      if (!bridge) {
        if (!dbAiPaneStateNoticeShown) {
          dbAiPaneStateNoticeShown = true
          showNotice('DB AI pane state service unavailable')
        }
        return
      }
      try {
        const result = await bridge(snapshot)
        if (!result.ok && !dbAiPaneStateNoticeShown) {
          dbAiPaneStateNoticeShown = true
          showNotice(result.errorMessage || 'DB AI pane state save failed')
          return
        }
        if (result.ok && !isDbAiPaneStateSnapshot(result.data) && !dbAiPaneStateNoticeShown) {
          dbAiPaneStateNoticeShown = true
          showNotice('DB AI pane state backend returned malformed result data.')
        }
      } catch {
        if (!dbAiPaneStateNoticeShown) {
          dbAiPaneStateNoticeShown = true
          showNotice('DB AI pane state save failed')
        }
      }
    }
    dbAiPaneStateSaveQueue = dbAiPaneStateSaveQueue.then(saveSnapshot, saveSnapshot)
    return dbAiPaneStateSaveQueue
  }

  watch(
    [
      dbAiPaneOpen,
      dbAiPaneWidth,
      dbAiPaneDraft,
      dbAiPaneConversationId,
      dbAiPaneMessages,
      () => [dbAiPaneContext.connectionId, dbAiPaneContext.catalogName, dbAiPaneContext.schemaName, dbAiPaneContext.dbType].join('|')
    ],
    persistDbAiPaneState,
    { deep: true }
  )

  return {
    dbAiPaneOpen,
    dbAiPaneWidth,
    dbAiPaneResizing,
    dbAiPaneContext,
    dbAiPaneDraft,
    dbAiPaneComposerAction,
    dbAiPaneComposerPlaceholder,
    dbAiPaneMessages,
    canToggleDbAiPane,
    dbAiPaneConnection,
    dbAiPaneCatalogOptions,
    dbAiPaneSchemaOptions,
    dbAiPaneRequiresSchema,
    dbAiPaneConnectionNeedsConnect,
    dbAiPaneContextTitle,
    dbAiPaneContextSummary,
    dbAiPaneIsStreaming,
    dbAiPaneCanSend,
    dbAiPaneStatusLabel,
    syncDbAiPaneContextAfterActiveTabChange,
    syncDbAiPaneContextAfterCatalogChange,
    toggleDbAiPane,
    openDbAiPane,
    closeDbAiPane,
    useActiveDbAiPaneContext,
    syncDbAiPaneContextToActiveSqlTab,
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    handleDbAiPaneDraftKeydown,
    prepareDbAiPaneAction,
    cancelDbAiPaneActionMode,
    sendDbAiPaneQuickPrompt,
    syncDbAiPaneActionRequest,
    resetDbAiPaneConversation,
    cancelDbAiPaneResponse,
    sendDbAiPaneMessage,
    startDbAiPaneResize,
    stopDbAiPaneResize,
    resetDbAiPaneWidth,
    loadDbAiPaneState,
    persistDbAiPaneState
  }
}
