import { computed, reactive, ref, type ComputedRef } from 'vue'
import { databaseClient } from '@/services/databaseClient'
import { currentSqlStatement, currentSqlStatementRange } from '@/services/databaseSqlEditorRuntime'
import {
  canRunDbAiReadOnly,
  dbAiBackendContext,
  dbAiBackendContextForIpc,
  dbAiCanCancel as runtimeDbAiCanCancel,
  dbAiContentText as runtimeDbAiContentText,
  dbAiContextParts,
  dbAiDrawerCreateInput,
  dbAiReasoningText as runtimeDbAiReasoningText,
  dbAiRequestList as runtimeDbAiRequestList,
  dbAiSql as runtimeDbAiSql,
  dbAiStatusLabel as runtimeDbAiStatusLabel,
  formatDbAiRequestTime,
  isDbAiExecutableDialect as runtimeIsDbAiExecutableDialect,
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
  type DbAiAction,
  type DbAiBackendContext,
  type DbAiRequest,
  type DbAiStatus,
  type DbAiTargetDialect
} from '@/services/databaseBackendGuards'
import type { SqlResult } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseResult,
  DatabaseCatalogInfo,
  DatabaseConnectionInfo
} from '@shared/contracts/database'

type DatabaseAiDrawerWorkspaceRuntimeState = {
  activeSqlTab: ComputedRef<SqlTab | null>
  activeSqlCanRun: ComputedRef<boolean>
  currentSqlCatalogs: ComputedRef<DatabaseCatalogInfo[]>
}

type DatabaseAiDrawerWorkspaceRuntimeDeps = {
  showNotice: (message: string) => void
  closeMenus: () => void
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  copyText: (value: string) => Promise<boolean>
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
  getSqlSelectionRange: () => { start: number; end: number }
  getSqlTextUntilCursor: () => string
  renderDefaultSql: (connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined, schemaName?: string) => string
  setEditorSql: (nextSql: string, selectionStart: number, selectionEnd?: number) => void
  appendSqlExecution: (tab: SqlTab, sql: string) => Promise<void>
}

export const createDatabaseAiDrawerWorkspaceRuntime = (
  state: DatabaseAiDrawerWorkspaceRuntimeState,
  deps: DatabaseAiDrawerWorkspaceRuntimeDeps
) => {
  const { activeSqlTab, activeSqlCanRun, currentSqlCatalogs } = state
  const {
    showNotice,
    closeMenus,
    bridgeErrorMessage,
    copyText,
    findConnection,
    getSelectedSqlText,
    getSqlCursorOffset,
    getSqlSelectionRange,
    getSqlTextUntilCursor,
    renderDefaultSql,
    setEditorSql,
    appendSqlExecution
  } = deps

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

  return {
    dbAiOpen,
    dbAiActiveReqId,
    sqlDiagnose,
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
