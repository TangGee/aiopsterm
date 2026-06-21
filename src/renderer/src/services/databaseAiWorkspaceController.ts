import { computed, nextTick, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { databaseClient } from '@/services/databaseClient'
import { currentSqlStatement, currentSqlStatementRange, extractSql, isReadOnlySql } from '@/services/databaseSqlEditorRuntime'
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
  defaultSchemaForSqlConnection,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
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

type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>

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

  const dbAiDialectOptions: Array<{ value: DbAiTargetDialect; label: string }> = [
    { value: 'postgresql', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'sqlite', label: 'SQLite' },
    { value: 'oracle', label: 'Oracle' },
    { value: 'mssql', label: 'SQL Server' },
    { value: 'clickhouse', label: 'ClickHouse' },
    { value: 'presto', label: 'Presto' }
  ]

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
  const dbAiPaneContextSummary = computed(() => {
    const connection = dbAiPaneConnection.value
    if (!connection) return 'No database context selected'
    return [connection.name, connection.dbType, dbAiPaneContext.catalogName, dbAiPaneContext.schemaName].filter(Boolean).join(' · ')
  })
  const dbAiPaneIsStreaming = computed(() =>
    dbAiPaneMessages.value.some((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))
  )
  const dbAiPaneCanSend = computed(() => Boolean(dbAiPaneDraft.value.trim() && dbAiPaneContext.connectionId && dbAiPaneContext.catalogName && !dbAiPaneIsStreaming.value))
  const dbAiRequestList = computed(() => Object.values(dbAiRequests.value).sort((a, b) => b.createdAt - a.createdAt))
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
  const dbAiSql = computed(() => (dbAiStatus.value === 'done' ? extractSql(dbAiText.value) : ''))
  const dbAiIsConvertAction = computed(() => dbAiAction.value === 'convert')
  const dbAiReasoningText = computed(() => {
    const fenceIndex = dbAiText.value.search(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql|clickhouse|presto)?\s*\n/i)
    const text = fenceIndex >= 0 ? dbAiText.value.slice(0, fenceIndex).trim() : dbAiText.value.trim()
    return text.replace(/^Reasoning\s*\n?/i, '').trim()
  })
  const dbAiContentText = computed(() => {
    const sql = dbAiSql.value
    if (!sql || !dbAiText.value.trim()) return ''
    if (dbAiAction.value === 'convert') return `Generated ${dbAiDialectLabel(dbAiTargetDialect.value)} SQL preview.`
    if (dbAiAction.value === 'diagnose') return 'Generated a conservative read-only SQL diagnosis candidate.'
    if (dbAiAction.value === 'optimize') return 'Generated an optimized read-only SQL candidate.'
    if (dbAiAction.value === 'complete') return 'Generated a completed SQL candidate for the active editor context.'
    if (dbAiAction.value === 'nl2sql') return 'Generated SQL from the natural-language request and current database context.'
    return 'Generated SQL is ready for copy, replacement, insertion, or read-only execution when allowed.'
  })
  const dbAiStatusLabel = computed(() => {
    if (dbAiStatus.value === 'queued') return 'Queued'
    if (dbAiStatus.value === 'streaming') return 'Streaming'
    if (dbAiStatus.value === 'cancelled') return 'Cancelled'
    if (dbAiStatus.value === 'error') return 'Error'
    if (dbAiStatus.value === 'done') return 'Done'
    return 'Idle'
  })
  const dbAiIsExecutableDialect = computed(() => isDbAiExecutableDialect(dbAiAction.value, dbAiTargetDialect.value))
  const dbAiCanRunReadOnly = computed(() => Boolean(activeSqlCanRun.value && dbAiIsExecutableDialect.value && isReadOnlySql(dbAiSql.value)))
  const dbAiCanCancel = computed(() => dbAiStatus.value === 'queued' || dbAiStatus.value === 'streaming')
  const dbAiEmptyState = computed(() => dbAiOpen.value && !activeDbAiRequest.value)

  const normalizeDbAiPaneContext = (input: Partial<DbAiPaneContext> | SqlConsoleContext): DbAiPaneContext => {
    const connection = input.connectionId ? (findConnection(input.connectionId) ?? connections.value[0]) : connections.value[0]
    if (!connection) return { connectionId: '', catalogName: '', schemaName: '', dbType: '' }
    const catalog = connection.catalogs.find((item) => item.name === input.catalogName) ?? connection.catalogs[0]
    const schemaName = sqlConnectionRequiresSchema(connection) ? defaultSchemaForSqlConnection(connection, catalog) : ''
    const requestedSchema = sqlConnectionRequiresSchema(connection)
      ? catalog?.schemas?.find((schema) => schema.name === input.schemaName)?.name
      : ''
    return {
      connectionId: connection.id,
      catalogName: catalog?.name ?? '',
      schemaName: requestedSchema || schemaName,
      dbType: connection.dbType
    }
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
      sendDbAiPaneMessage(`Explain this SQL and point out execution risks:\n${sql}`)
      return
    }
    if (kind === 'schemaSummary') {
      sendDbAiPaneMessage('Summarize the current database schema and list useful query entry points.')
      return
    }
    sendDbAiPaneMessage('Generate a read-only SELECT query for the most useful table in the current context.')
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
    const requestInput = {
      prompt,
      context: {
        connectionId: dbAiPaneContext.connectionId,
        dbType: dbAiPaneContext.dbType || undefined,
        databaseName: dbAiPaneContext.catalogName,
        schemaName: dbAiPaneContext.schemaName,
        contextSummary
      },
      activeSql: activeSqlTab.value?.sql ?? '',
      messages: dbAiPaneMessages.value.slice(-12).map((message) => ({ role: message.role, content: message.content }))
    }
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
        requestId,
        assistantMessageId: messageId,
        prompt,
        context: {
          connectionId: context.connectionId,
          dbType: context.dbType || undefined,
          databaseName: context.catalogName,
          schemaName: context.schemaName,
          contextSummary
        },
        activeSql: activeSqlTab.value?.sql ?? '',
        messages: dbAiPaneMessages.value.slice(-12).map((message) => ({ role: message.role, content: message.content }))
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

  const dbAiPaneStatusLabel = (status: DbAiPaneMessageStatus) => {
    if (status === 'queued') return 'Queued'
    if (status === 'streaming') return 'Streaming'
    if (status === 'cancelled') return 'Cancelled'
    if (status === 'error') return 'Error'
    return 'Done'
  }

  const scrollDbAiPaneMessagesToBottom = () => {
    void nextTick(() => {
      databaseAiPanelsRef.value?.scrollPaneMessagesToBottom()
    })
  }

  const clampDbAiPaneWidth = (value: number) => {
    if (!Number.isFinite(value)) return DB_AI_PANE_DEFAULT_WIDTH
    return Math.min(DB_AI_PANE_MAX_WIDTH, Math.max(DB_AI_PANE_MIN_WIDTH, Math.round(value)))
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
    dbAiPaneOpen.value = snapshot.open === true
    dbAiPaneWidth.value = clampDbAiPaneWidth(snapshot.width)
    if (snapshot.context?.connectionId) applyDbAiPaneContext(snapshot.context, true)
    else ensureDbAiPaneContextInitialized(true)
    dbAiPaneDraft.value = snapshot.draft || ''
    dbAiPaneMessages.value = snapshot.messages.map((message) => ({ ...message }))
  }

  const currentDbAiPaneStateSnapshot = (): DatabaseAiPaneStateSnapshot => ({
    open: dbAiPaneOpen.value,
    width: dbAiPaneWidth.value,
    context: { ...dbAiPaneContext },
    draft: dbAiPaneDraft.value,
    messages: dbAiPaneMessages.value.slice(-24).map((message) => ({ ...message }))
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
    return [connection?.name, connection?.dbType, tab.catalogName, tab.schemaName].filter(Boolean)
  }

  const buildDbAiBackendContext = (contextSummary = '', override: DbAiBackendContext = {}): DbAiBackendContext => {
    const tab = activeSqlTab.value
    const connection = override.connectionId ? findConnection(override.connectionId) : tab ? findConnection(tab.connectionId) : undefined
    return {
      connectionId: override.connectionId ?? tab?.connectionId ?? '',
      dbType: override.dbType ?? connection?.dbType ?? '',
      databaseName: override.databaseName ?? tab?.catalogName ?? '',
      schemaName: override.schemaName !== undefined ? override.schemaName : tab?.schemaName || undefined,
      tableName: override.tableName !== undefined ? override.tableName : tab?.tableName || undefined,
      contextSummary: override.contextSummary ?? contextSummary
    }
  }

  const dbAiBackendContextForIpc = (context: DbAiBackendContext): DatabaseAiDrawerResponseInput['context'] => ({
    connectionId: String(context.connectionId || ''),
    dbType: context.dbType || '',
    databaseName: String(context.databaseName || ''),
    schemaName: context.schemaName ? String(context.schemaName) : undefined,
    tableName: context.tableName ? String(context.tableName) : undefined,
    contextSummary: context.contextSummary ? String(context.contextSummary) : undefined
  })

  const openDbAi = async (action: DbAiAction, sql: string, context = '', backendContextOverride: DbAiBackendContext = {}) => {
    const backendContext = buildDbAiBackendContext(context, backendContextOverride)
    const activeDialect = backendContext.dbType || (activeSqlTab.value ? findConnection(activeSqlTab.value.connectionId)?.dbType : undefined)
    const normalizedDialect: DbAiTargetDialect =
      activeDialect === 'sqlserver'
        ? 'mssql'
        : activeDialect && isMysqlCompatibleDbType(activeDialect)
          ? 'mysql'
          : activeDialect && isPostgresCompatibleDbType(activeDialect)
            ? 'postgresql'
            : activeDialect || 'postgresql'
    const targetDialect: DbAiTargetDialect = action === 'convert' ? normalizedDialect : normalizedDialect
    const createBridge = databaseClient.createDatabaseAiDrawerRequest()
    if (!createBridge) {
      showNotice('DB AI drawer request service unavailable')
      return
    }
    let result: DatabaseAiDrawerRequestResult
    try {
      result = await createBridge({
        action,
        sourceSql: sql,
        targetDialect,
        context: dbAiBackendContextForIpc({ ...backendContext, contextSummary: backendContext.contextSummary || context })
      })
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
    const existing = dbAiRequests.value[reqId]
    if (!existing) return
    dbAiRequests.value = {
      ...dbAiRequests.value,
      [reqId]: { ...existing, ...patch }
    }
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
    const before = tab.sql.slice(0, range.start)
    const after = tab.sql.slice(range.end)
    const replacingSelection = range.start !== range.end
    const prefix = !replacingSelection && before && !/\s$/.test(before) ? '\n' : ''
    const suffix = !replacingSelection && after && !/^\s/.test(after) ? '\n' : ''
    const nextSql = `${before}${prefix}${dbAiSql.value}${suffix}${after}`
    setEditorSql(nextSql, range.start + prefix.length + dbAiSql.value.length)
    showNotice(replacingSelection ? 'Editor selection replaced' : 'Generated SQL inserted')
  }

  const replaceDbAiSqlSelection = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    const selection = getSqlSelectionRange()
    const range = selection.start !== selection.end ? selection : currentSqlStatementRange(tab.sql, getSqlCursorOffset())
    const nextSql = `${tab.sql.slice(0, range.start)}${dbAiSql.value}${tab.sql.slice(range.end)}`
    setEditorSql(nextSql, range.start, range.start + dbAiSql.value.length)
    showNotice(selection.start !== selection.end ? 'Editor selection replaced' : 'Current statement replaced')
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
      const { [request.id]: _removed, ...rest } = dbAiRequests.value
      dbAiRequests.value = rest
      const fallback = Object.values(rest).sort((a, b) => b.createdAt - a.createdAt)[0]
      dbAiActiveReqId.value = fallback?.id ?? null
    }
    dbAiOpen.value = Boolean(dbAiActiveReqId.value)
  }

  const formatDbAiRequestTime = (time: number) => {
    const date = new Date(time)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
  }

  const isDbAiExecutableDialect = (action: DbAiAction, target: DbAiTargetDialect) => {
    if (action !== 'convert') return true
    const tab = activeSqlTab.value
    const connection = tab ? findConnection(tab.connectionId) : undefined
    if (target === 'mssql') return connection?.dbType === 'sqlserver'
    if (target === 'mysql') return !!connection && isMysqlCompatibleDbType(connection.dbType)
    if (target === 'postgresql') return !!connection && isPostgresCompatibleDbType(connection.dbType)
    return connection?.dbType === target
  }

  const dbAiDialectLabel = (dialect: DbAiTargetDialect) => dbAiDialectOptions.find((option) => option.value === dialect)?.label ?? dialect

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
