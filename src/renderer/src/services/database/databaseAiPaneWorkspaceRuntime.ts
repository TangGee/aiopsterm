import { computed, nextTick, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { databaseClient } from '@/services/database/databaseClient'
import { currentSqlStatement } from '@/services/database/databaseSqlEditorRuntime'
import {
  applyDbAiPaneStateSnapshot as applyRuntimeDbAiPaneStateSnapshot,
  clampDbAiPaneWidth,
  currentDbAiPaneStateSnapshot as currentRuntimeDbAiPaneStateSnapshot,
  dbAiPaneCanSend as runtimeDbAiPaneCanSend,
  dbAiPaneContextSummary as runtimeDbAiPaneContextSummary,
  dbAiPaneIsStreaming as runtimeDbAiPaneIsStreaming,
  dbAiPaneRequestInput,
  dbAiPaneStatusLabel,
  dbAiQuickPromptText,
  normalizeDbAiPaneContext as normalizeRuntimeDbAiPaneContext,
  type SqlTab
} from '@/services/database/databaseAiRuntime'
import {
  isDbAiPaneLifecycleData,
  isDbAiPaneRequestData,
  isDbAiPaneResponseData,
  isDbAiPaneStateSnapshot,
  type DbAiPaneContext,
  type DbAiPaneMessage
} from '@/services/database/databaseBackendGuards'
import { DB_AI_PANE_DEFAULT_WIDTH, sqlConnectionRequiresSchema } from '@/services/database/databaseWorkspaceRuntime'
import type { DbAiPaneQuickPrompt, SqlConsoleContext } from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseConnectionInfo
} from '@shared/contracts/database'

type DatabaseAiPaneWorkspaceRuntimeState = {
  connections: Ref<DatabaseConnectionInfo[]>
  expandedConnections: Ref<string[]>
  activeSqlTab: ComputedRef<SqlTab | null>
  databaseAiPanelsRef: Ref<{ scrollPaneMessagesToBottom: () => void } | null>
}

type DatabaseAiPaneWorkspaceRuntimeDeps = {
  showNotice: (message: string) => void
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  defaultSqlContextForConnection: (connection: DatabaseConnectionInfo) => SqlConsoleContext
  resolveSqlConsoleContext: (connectionId?: string) => SqlConsoleContext
  connectConnection: (connectionId: string) => Promise<boolean>
  getSqlCursorOffset: () => number
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
  const dbAiPaneMessages = ref<DbAiPaneMessage[]>([])
  let dbAiPaneResizeStartX = 0
  let dbAiPaneResizeStartWidth = DB_AI_PANE_DEFAULT_WIDTH
  let dbAiPaneContextTouched = false
  let dbAiPaneStateHydrating = false
  let dbAiPaneStateNoticeShown = false

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
  const dbAiPaneCanSend = computed(() => runtimeDbAiPaneCanSend(dbAiPaneDraft.value, dbAiPaneContext, dbAiPaneIsStreaming.value))

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

  const sendDbAiPaneQuickPrompt = (kind: DbAiPaneQuickPrompt) => {
    if (dbAiPaneIsStreaming.value) return
    if (kind === 'explainActive') {
      const tab = activeSqlTab.value
      if (!tab) return
      const sql = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || tab.sql.trim()
      sendDbAiPaneMessage(dbAiQuickPromptText(kind, sql))
      return
    }
    sendDbAiPaneMessage(dbAiQuickPromptText(kind))
  }

  const sendDbAiPaneMessage = async (promptOverride = '') => {
    const prompt = (promptOverride || dbAiPaneDraft.value).trim()
    if (!prompt || dbAiPaneIsStreaming.value) return
    ensureDbAiPaneContextInitialized(false)
    if (!dbAiPaneContext.connectionId || !dbAiPaneContext.catalogName) {
      showNotice('Database context is required before using DB AI pane')
      return
    }
    if (dbAiPaneConnectionNeedsConnect.value) {
      await connectDbAiPaneConnection()
      if (dbAiPaneConnectionNeedsConnect.value) return
    }
    const contextSummary = dbAiPaneContextSummary.value
    const requestInput = dbAiPaneRequestInput({
      prompt,
      context: dbAiPaneContext,
      contextSummary,
      activeSql: activeSqlTab.value?.sql ?? '',
      messages: dbAiPaneMessages.value
    })
    const createBridge = databaseClient.createDatabaseAiPaneRequest()
    if (!createBridge) {
      showNotice('DB AI pane request service unavailable')
      return
    }
    let created: DatabaseAiPaneRequestResult
    try {
      created = await createBridge(requestInput)
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI pane request failed'))
      return
    }
    if (!created.ok) {
      showNotice(created.errorMessage || 'DB AI pane request failed')
      return
    }
    if (!isDbAiPaneRequestData(created.data)) {
      showNotice('DB AI pane backend returned malformed request data.')
      return
    }
    const { userMessage, assistantMessage } = created.data
    dbAiPaneMessages.value = [...dbAiPaneMessages.value, userMessage, assistantMessage]
    if (!promptOverride) dbAiPaneDraft.value = ''
    void requestDbAiPaneResponse(assistantMessage.id, prompt, { ...dbAiPaneContext }, contextSummary, created.data.requestId)
    scrollDbAiPaneMessagesToBottom()
  }

  const requestDbAiPaneResponse = async (messageId: string, prompt: string, context: DbAiPaneContext, contextSummary: string, requestId: string) => {
    const startBridge = databaseClient.startDatabaseAiPaneResponse()
    if (!startBridge) {
      showNotice('DB AI pane start service unavailable')
      return
    }
    let started: DatabaseAiPaneLifecycleResult
    try {
      started = await startBridge({ requestId, assistantMessageId: messageId })
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI pane request failed to start'))
      return
    }
    if (!started.ok) {
      showNotice(started.errorMessage || 'DB AI pane request failed to start')
      return
    }
    if (!isDbAiPaneLifecycleData(started.data, { requestId, assistantMessageId: messageId })) {
      showNotice('DB AI pane backend returned malformed lifecycle data.')
      return
    }
    applyDbAiPaneAssistantMessage(started.data.assistantMessage)
    const generateBridge = databaseClient.generateDatabaseAiPaneResponse()
    if (!generateBridge) {
      showNotice('DB AI pane response service unavailable')
      return
    }
    try {
      const result = await generateBridge({
        ...dbAiPaneRequestInput({
          prompt,
          context,
          contextSummary,
          activeSql: activeSqlTab.value?.sql ?? '',
          messages: dbAiPaneMessages.value
        }),
        requestId,
        assistantMessageId: messageId
      })
      finishDbAiPaneMessage(messageId, result, requestId)
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI pane response failed'))
    }
  }

  const applyDbAiPaneAssistantMessage = (assistantMessage: DbAiPaneMessage) => {
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
      if (message.id !== assistantMessage.id) return message
      return assistantMessage
    })
    scrollDbAiPaneMessagesToBottom()
  }

  const finishDbAiPaneMessage = (messageId: string, result: DatabaseAiPaneResponseResult, requestId: string) => {
    const hasValidResponseData = isDbAiPaneResponseData(result.data, { requestId, assistantMessageId: messageId })
    const responseData = hasValidResponseData ? result.data : null
    if (result.ok && !hasValidResponseData) {
      showNotice('DB AI pane backend returned malformed response data.')
      return
    }
    if (!result.ok && !hasValidResponseData) {
      showNotice(result.errorMessage || 'DB AI pane response failed')
      return
    }
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
      if (message.id !== messageId || message.status === 'cancelled') return message
      if (responseData) return responseData.assistantMessage
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
    dbAiPaneMessages.value = []
    dbAiPaneDraft.value = ''
    showNotice('DB AI pane conversation reset')
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
    dbAiPaneOpen.value = next.open
    dbAiPaneWidth.value = next.width
    if (next.context) applyDbAiPaneContext(next.context, true)
    else ensureDbAiPaneContextInitialized(true)
    dbAiPaneDraft.value = next.draft
    dbAiPaneMessages.value = next.messages
  }

  const currentDbAiPaneStateSnapshot = (): DatabaseAiPaneStateSnapshot =>
    currentRuntimeDbAiPaneStateSnapshot({
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

  const persistDbAiPaneState = async () => {
    if (dbAiPaneStateHydrating) return
    const bridge = databaseClient.saveDatabaseAiPaneState()
    if (!bridge) {
      if (!dbAiPaneStateNoticeShown) {
        dbAiPaneStateNoticeShown = true
        showNotice('DB AI pane state service unavailable')
      }
      return
    }
    try {
      const result = await bridge(currentDbAiPaneStateSnapshot())
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

  watch(
    [
      dbAiPaneOpen,
      dbAiPaneWidth,
      dbAiPaneDraft,
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
    closeDbAiPane,
    useActiveDbAiPaneContext,
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    handleDbAiPaneDraftKeydown,
    sendDbAiPaneQuickPrompt,
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
