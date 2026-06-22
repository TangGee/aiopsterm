import { computed, nextTick, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { databaseClient } from '@/services/databaseClient'
import { currentSqlStatement, currentSqlStatementRange } from '@/services/databaseSqlEditorRuntime'
import {
  applyDbAiPaneStateSnapshot as applyRuntimeDbAiPaneStateSnapshot,
  canRunDbAiReadOnly,
  clampDbAiPaneWidth,
  currentDbAiPaneStateSnapshot as currentRuntimeDbAiPaneStateSnapshot,
  dbAiBackendContext,
  dbAiCanCancel as runtimeDbAiCanCancel,
  dbAiContentText as runtimeDbAiContentText,
  dbAiContextParts,
  dbAiDialectOptions,
  dbAiDrawerCreateInput,
  dbAiPaneCanSend as runtimeDbAiPaneCanSend,
  dbAiPaneContextSummary as runtimeDbAiPaneContextSummary,
  dbAiPaneIsStreaming as runtimeDbAiPaneIsStreaming,
  dbAiPaneRequestInput,
  dbAiPaneStatusLabel,
  dbAiQuickPromptText,
  dbAiReasoningText as runtimeDbAiReasoningText,
  dbAiRequestList as runtimeDbAiRequestList,
  dbAiSql as runtimeDbAiSql,
  dbAiStatusLabel as runtimeDbAiStatusLabel,
  dbAiBackendContextForIpc,
  formatDbAiRequestTime,
  isDbAiExecutableDialect as runtimeIsDbAiExecutableDialect,
  normalizeDbAiPaneContext as normalizeRuntimeDbAiPaneContext,
  normalizeDbAiTargetDialect,
  patchDbAiRequestRecord,
  planDbAiInsertSql,
  planDbAiReplaceSql,
  removeDbAiRequestRecord,
  type SqlTab
} from '@/services/databaseAiRuntime'
import {
  isDbAiDrawerRequestRecord,
  isDbAiDrawerResponseData,
  isDbAiPaneLifecycleData,
  isDbAiPaneRequestData,
  isDbAiPaneResponseData,
  isDbAiPaneStateSnapshot,
  type DbAiAction,
  type DbAiBackendContext,
  type DbAiPaneContext,
  type DbAiPaneMessage,
  type DbAiPaneMessageStatus,
  type DbAiRequest,
  type DbAiStatus,
  type DbAiTargetDialect
} from '@/services/databaseBackendGuards'
import {
  DB_AI_PANE_DEFAULT_WIDTH,
  DB_AI_PANE_MAX_WIDTH,
  DB_AI_PANE_MIN_WIDTH,
  sqlConnectionRequiresSchema
} from '@/services/databaseWorkspaceRuntime'
import type { DbAiPaneQuickPrompt, SqlConsoleContext, SqlResult, WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseCatalogInfo,
  DatabaseConnectionInfo
} from '@shared/contracts/database'

type DatabaseAiWorkspaceControllerState = {
  connections: Ref<DatabaseConnectionInfo[]>
  expandedConnections: Ref<string[]>
  activeSqlTab: ComputedRef<SqlTab | null>
  activeSqlCanRun: ComputedRef<boolean>
  currentSqlCatalogs: ComputedRef<DatabaseCatalogInfo[]>
  databaseAiPanelsRef: Ref<{ scrollPaneMessagesToBottom: () => void } | null>
}

type DatabaseAiWorkspaceControllerDeps = {
  showNotice: (message: string) => void
  closeMenus: () => void
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  copyText: (value: string) => Promise<boolean>
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  defaultSqlContextForConnection: (connection: DatabaseConnectionInfo) => SqlConsoleContext
  resolveSqlConsoleContext: (connectionId?: string) => SqlConsoleContext
  connectConnection: (connectionId: string) => Promise<boolean>
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
  getSqlSelectionRange: () => { start: number; end: number }
  getSqlTextUntilCursor: () => string
  renderDefaultSql: (connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined, schemaName?: string) => string
  setEditorSql: (nextSql: string, selectionStart: number, selectionEnd?: number) => void
  appendSqlExecution: (tab: SqlTab, sql: string) => Promise<void>
}

export const createDatabaseAiWorkspaceController = (
  state: DatabaseAiWorkspaceControllerState,
  deps: DatabaseAiWorkspaceControllerDeps
) => {
  const {
    connections,
    expandedConnections,
    activeSqlTab,
    activeSqlCanRun,
    currentSqlCatalogs,
    databaseAiPanelsRef
  } = state
  const {
    showNotice,
    closeMenus,
    bridgeErrorMessage,
    copyText,
    findConnection,
    defaultSqlContextForConnection,
    resolveSqlConsoleContext,
    connectConnection,
    getSelectedSqlText,
    getSqlCursorOffset,
    getSqlSelectionRange,
    getSqlTextUntilCursor,
    renderDefaultSql,
    setEditorSql,
    appendSqlExecution
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

  const dbAiOpen = ref(false)
  const dbAiRequests = ref<Record<string, DbAiRequest>>({})
  const dbAiActiveReqId = ref<string | null>(null)
  const sqlDiagnose = reactive({
    running: false,
    error: '',
    success: false,
    resultId: '',
    requestId: ''
  })
  let sqlDiagnoseSuccessTimer: number | null = null
  let sqlDiagnoseRequestSequence = 1

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
  const dbAiRequestList = computed(() => runtimeDbAiRequestList(dbAiRequests.value))
  const activeDbAiRequest = computed(() => {
    const id = dbAiActiveReqId.value
    return id ? (dbAiRequests.value[id] ?? null) : null
  })
  const dbAiTargetDialect = computed<DbAiTargetDialect>({
    get() {
      return activeDbAiRequest.value?.targetDialect ?? 'postgresql'
    },
    set(value) {
      const request = activeDbAiRequest.value
      if (!request) return
      patchDbAiRequest(request.id, {
        targetDialect: value
      })
      if (request.action === 'convert' && request.status !== 'cancelled') {
        void requestDbAiDrawerResponse(request.id)
      }
    }
  })
  const dbAiActionLabel = computed(() => activeDbAiRequest.value?.label ?? 'DB AI')
  const dbAiAction = computed<DbAiAction>(() => activeDbAiRequest.value?.action ?? 'explain')
  const dbAiText = computed(() => activeDbAiRequest.value?.text ?? '')
  const dbAiStatus = computed<DbAiStatus | 'idle'>(() => activeDbAiRequest.value?.status ?? 'idle')
  const dbAiContextSummary = computed(() => activeDbAiRequest.value?.contextSummary ?? '')
  const dbAiSql = computed(() => runtimeDbAiSql(activeDbAiRequest.value))
  const dbAiIsConvertAction = computed(() => dbAiAction.value === 'convert')
  const dbAiReasoningText = computed(() => runtimeDbAiReasoningText(dbAiText.value))
  const dbAiContentText = computed(() => runtimeDbAiContentText({ action: dbAiAction.value, text: dbAiText.value, sql: dbAiSql.value, targetDialect: dbAiTargetDialect.value }))
  const dbAiStatusLabel = computed(() => runtimeDbAiStatusLabel(dbAiStatus.value))
  const dbAiIsExecutableDialect = computed(() => runtimeIsDbAiExecutableDialect(dbAiAction.value, dbAiTargetDialect.value, activeSqlTab.value ? findConnection(activeSqlTab.value.connectionId) : undefined))
  const dbAiCanRunReadOnly = computed(() =>
    canRunDbAiReadOnly({
      activeSqlCanRun: activeSqlCanRun.value,
      action: dbAiAction.value,
      targetDialect: dbAiTargetDialect.value,
      connection: activeSqlTab.value ? findConnection(activeSqlTab.value.connectionId) : undefined,
      sql: dbAiSql.value
    })
  )
  const dbAiCanCancel = computed(() => runtimeDbAiCanCancel(dbAiStatus.value))
  const dbAiEmptyState = computed(() => dbAiOpen.value && !activeDbAiRequest.value)

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

  const openDbAiFromToolbar = (action: Extract<DbAiAction, 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete'>) => {
    const tab = activeSqlTab.value
    if (!tab) return
    const selected = getSelectedSqlText().trim()
    const current = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim()
    const cursorPrefix = getSqlTextUntilCursor().trim()
    const sourceSql = action === 'complete' ? cursorPrefix : selected || current || tab.sql.trim()
    if (action !== 'nl2sql' && action !== 'complete' && !sourceSql) {
      showNotice('SQL is empty')
      return
    }
    const contextParts = buildDbAiContextParts(tab)
    if (action === 'complete') contextParts.push(sourceSql ? 'cursor prefix' : 'default table context')
    else contextParts.push(selected ? 'selection' : current ? 'current statement' : action === 'nl2sql' ? 'natural language prompt' : 'full editor')
    const sql =
      action === 'nl2sql'
        ? 'show the latest open orders with service, owner, status, and updated time'
        : action === 'complete' && !sourceSql
          ? renderDefaultSql(findConnection(tab.connectionId), currentSqlCatalogs.value[0], tab.schemaName)
          : sourceSql
    openDbAi(action, sql, contextParts.join(' · '))
  }

  const buildDbAiContextParts = (tab: SqlTab) => {
    const connection = findConnection(tab.connectionId)
    return dbAiContextParts(tab, connection)
  }

  const buildDbAiBackendContext = (contextSummary = '', override: DbAiBackendContext = {}): DbAiBackendContext => {
    const tab = activeSqlTab.value
    const connection = override.connectionId ? findConnection(override.connectionId) : tab ? findConnection(tab.connectionId) : undefined
    return dbAiBackendContext({ tab, connection, contextSummary, override })
  }

  const openDbAi = async (action: DbAiAction, sql: string, context = '', backendContextOverride: DbAiBackendContext = {}) => {
    const backendContext = buildDbAiBackendContext(context, backendContextOverride)
    const activeDialect = backendContext.dbType || (activeSqlTab.value ? findConnection(activeSqlTab.value.connectionId)?.dbType : undefined)
    const targetDialect = normalizeDbAiTargetDialect(activeDialect)
    const createBridge = databaseClient.createDatabaseAiDrawerRequest()
    if (!createBridge) {
      showNotice('DB AI drawer request service unavailable')
      return
    }
    let result: DatabaseAiDrawerRequestResult
    try {
      result = await createBridge(dbAiDrawerCreateInput({
        action,
        sourceSql: sql,
        targetDialect,
        context: { ...backendContext, contextSummary: backendContext.contextSummary || context }
      }))
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI request failed'))
      return
    }
    if (!result.ok) {
      showNotice(result.errorMessage || 'DB AI request failed')
      return
    }
    if (!isDbAiDrawerRequestRecord(result.data)) {
      showNotice('DB AI drawer backend returned malformed request data.')
      return
    }
    const request = result.data
    dbAiRequests.value = { ...dbAiRequests.value, [request.id]: request }
    dbAiActiveReqId.value = request.id
    dbAiOpen.value = true
    void requestDbAiDrawerResponse(request.id)
    closeMenus()
  }

  const patchDbAiRequest = (reqId: string, patch: Partial<DbAiRequest>) => {
    dbAiRequests.value = patchDbAiRequestRecord(dbAiRequests.value, reqId, patch)
  }

  const requestDbAiDrawerResponse = async (reqId: string) => {
    const request = dbAiRequests.value[reqId]
    if (!request) return
    const expectedDialect = request.targetDialect
    const startBridge = databaseClient.startDatabaseAiDrawerResponse()
    if (!startBridge) {
      showNotice('DB AI drawer start service unavailable')
      return
    }
    let started: DatabaseAiDrawerLifecycleResult
    try {
      started = await startBridge({ requestId: reqId })
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI drawer request failed to start'))
      return
    }
    if (!started.ok) {
      showNotice(started.errorMessage || 'DB AI drawer request failed to start')
      return
    }
    if (!isDbAiDrawerRequestRecord(started.data, reqId)) {
      showNotice('DB AI drawer backend returned malformed lifecycle data.')
      return
    }
    patchDbAiRequest(reqId, { status: started.data.status, text: started.data.text, updatedAt: started.data.updatedAt })
    const generateBridge = databaseClient.generateDatabaseAiDrawerResponse()
    if (!generateBridge) {
      showNotice('DB AI drawer response service unavailable')
      return
    }
    try {
      const result = await generateBridge({
        requestId: reqId,
        action: request.action,
        sourceSql: request.sourceSql,
        targetDialect: expectedDialect,
        context: dbAiBackendContextForIpc(request.backendContext)
      })
      finishDbAiRequest(reqId, result, expectedDialect)
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI drawer response failed'))
    }
  }

  const finishDbAiRequest = (reqId: string, result: DatabaseAiDrawerResponseResult, expectedDialect?: DbAiTargetDialect) => {
    const request = dbAiRequests.value[reqId]
    if (!request || request.status === 'cancelled') return
    if (expectedDialect && request.targetDialect !== expectedDialect) return
    const hasValidResponseData = isDbAiDrawerResponseData(result.data, reqId)
    const responseData = hasValidResponseData ? result.data : null
    if (result.ok && !hasValidResponseData) {
      showNotice('DB AI drawer backend returned malformed response data.')
      return
    }
    if (responseData) {
      dbAiRequests.value = {
        ...dbAiRequests.value,
        [reqId]: responseData.request
      }
      return
    }
    showNotice(result.errorMessage || 'DB AI drawer backend failed.')
  }

  const setActiveDbAiRequest = (reqId: string) => {
    const request = dbAiRequests.value[reqId]
    if (!request) return
    dbAiActiveReqId.value = reqId
    dbAiOpen.value = true
  }

  const copyDbAiSql = async () => {
    if (await copyText(dbAiSql.value)) showNotice('Generated SQL copied')
  }

  const insertDbAiSql = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    const range = getSqlSelectionRange()
    const plan = planDbAiInsertSql(tab.sql, range, dbAiSql.value)
    setEditorSql(plan.nextSql, plan.selectionStart)
    showNotice(plan.notice)
  }

  const replaceDbAiSqlSelection = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    const selection = getSqlSelectionRange()
    const range = selection.start !== selection.end ? selection : currentSqlStatementRange(tab.sql, getSqlCursorOffset())
    const plan = planDbAiReplaceSql(tab.sql, range, dbAiSql.value, selection.start !== selection.end)
    setEditorSql(plan.nextSql, plan.selectionStart, plan.selectionEnd)
    showNotice(plan.notice)
  }

  const runDbAiReadonly = () => {
    const tab = activeSqlTab.value
    if (!tab || !dbAiCanRunReadOnly.value) return
    void appendSqlExecution(tab, dbAiSql.value)
    showNotice('Read-only SQL executed')
  }

  const clearSqlDiagnoseTimers = () => {
    if (sqlDiagnoseSuccessTimer) {
      window.clearTimeout(sqlDiagnoseSuccessTimer)
      sqlDiagnoseSuccessTimer = null
    }
  }

  const nextSqlDiagnoseRequestId = (result: SqlResult) => {
    sqlDiagnoseRequestSequence += 1
    return `dbai-diagnose-${result.id}-${Date.now().toString(36)}-${sqlDiagnoseRequestSequence}`
  }

  const diagnoseSqlError = async (result: SqlResult) => {
    const tab = activeSqlTab.value
    if (!tab || result.status !== 'error') return
    if (!activeSqlCanRun.value) {
      sqlDiagnose.running = false
      sqlDiagnose.success = false
      sqlDiagnose.resultId = result.id
      sqlDiagnose.requestId = ''
      sqlDiagnose.error = 'Database context is required before diagnosis.'
      return
    }
    clearSqlDiagnoseTimers()
    const requestId = nextSqlDiagnoseRequestId(result)
    sqlDiagnose.running = true
    sqlDiagnose.success = false
    sqlDiagnose.error = ''
    sqlDiagnose.resultId = result.id
    sqlDiagnose.requestId = requestId

    try {
      const connection = findConnection(tab.connectionId)
      const diagnoseBridge = databaseClient.diagnoseDatabaseSqlError()
      if (!diagnoseBridge) {
        sqlDiagnose.running = false
        sqlDiagnose.success = false
        sqlDiagnose.error = 'DB AI diagnosis service unavailable'
        sqlDiagnose.requestId = ''
        return
      }
      const response = await diagnoseBridge({
        requestId,
        sourceSql: result.sql,
        targetDialect: connection?.dbType ?? 'postgresql',
        context: dbAiBackendContextForIpc(
          buildDbAiBackendContext('', {
            connectionId: tab.connectionId,
            dbType: connection?.dbType ?? '',
            databaseName: tab.catalogName,
            schemaName: tab.schemaName || undefined,
            tableName: tab.tableName || undefined,
            contextSummary: buildDbAiContextParts(tab).join(' · ')
          })
        ),
        errorMessage: result.error ?? ''
      })
      if (sqlDiagnose.resultId !== result.id || sqlDiagnose.requestId !== requestId) return
      if (!response.ok) {
        sqlDiagnose.running = false
        sqlDiagnose.success = false
        sqlDiagnose.error = response.errorMessage || 'DB AI diagnosis failed.'
        return
      }
      if (!isDbAiDrawerResponseData(response.data, requestId) || response.data.request.action !== 'diagnose' || !response.data.sql.trim()) {
        sqlDiagnose.running = false
        sqlDiagnose.success = false
        sqlDiagnose.error = 'DB AI diagnosis backend returned malformed result data.'
        return
      }
      const diagnosedSql = response.data.sql
      setEditorSql(diagnosedSql, diagnosedSql.length)
      sqlDiagnose.running = false
      sqlDiagnose.success = true
      sqlDiagnose.error = ''
      showNotice('SQL diagnosis applied to editor')
      sqlDiagnoseSuccessTimer = window.setTimeout(() => {
        if (sqlDiagnose.resultId === result.id && sqlDiagnose.requestId === requestId) sqlDiagnose.success = false
        sqlDiagnoseSuccessTimer = null
      }, 3000)
    } catch (error) {
      if (sqlDiagnose.resultId !== result.id || sqlDiagnose.requestId !== requestId) return
      sqlDiagnose.running = false
      sqlDiagnose.success = false
      sqlDiagnose.error = bridgeErrorMessage(error, 'DB AI diagnosis failed.')
    }
  }

  const cancelDbAiRequest = async () => {
    const request = activeDbAiRequest.value
    if (!request) return
    if (request.status === 'done' || request.status === 'error') return
    const cancelBridge = databaseClient.cancelDatabaseAiDrawerResponse()
    if (!cancelBridge) {
      showNotice('DB AI drawer cancel service unavailable')
      return
    }
    let result: DatabaseAiDrawerLifecycleResult
    try {
      result = await cancelBridge({ requestId: request.id })
    } catch (error) {
      showNotice(bridgeErrorMessage(error, 'DB AI request cancel failed'))
      return
    }
    if (!result.ok) {
      showNotice(result.errorMessage || 'DB AI request cancel failed')
      return
    }
    if (!isDbAiDrawerRequestRecord(result.data, request.id)) {
      showNotice('DB AI drawer backend returned malformed lifecycle data.')
      return
    }
    dbAiRequests.value = {
      ...dbAiRequests.value,
      [request.id]: result.data
    }
    showNotice('DB AI request cancelled')
  }

  const clearDbAiRequest = () => {
    const request = activeDbAiRequest.value
    if (request) {
      const next = removeDbAiRequestRecord(dbAiRequests.value, request.id)
      dbAiRequests.value = next.requests
      dbAiActiveReqId.value = next.activeReqId
      dbAiOpen.value = next.open
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
    dbAiOpen,
    dbAiActiveReqId,
    sqlDiagnose,
    dbAiDialectOptions,
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
    dbAiRequestList,
    dbAiTargetDialect,
    dbAiActionLabel,
    dbAiStatus,
    dbAiContextSummary,
    dbAiIsConvertAction,
    dbAiReasoningText,
    dbAiContentText,
    dbAiEmptyState,
    dbAiSql,
    dbAiIsExecutableDialect,
    dbAiCanRunReadOnly,
    dbAiCanCancel,
    dbAiStatusLabel,
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
    persistDbAiPaneState,
    openDbAiFromToolbar,
    openDbAi,
    setActiveDbAiRequest,
    copyDbAiSql,
    replaceDbAiSqlSelection,
    insertDbAiSql,
    runDbAiReadonly,
    cancelDbAiRequest,
    clearDbAiRequest,
    formatDbAiRequestTime,
    clearSqlDiagnoseTimers,
    diagnoseSqlError
  }
}
