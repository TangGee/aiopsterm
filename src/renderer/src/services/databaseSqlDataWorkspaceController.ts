import { computed, nextTick, reactive, type ComputedRef, type Ref } from 'vue'
import { createDatabaseSqlDataBackend } from '@/services/databaseSqlDataBackend'
import {
  addDataRowState,
  applyFilters,
  applySort,
  buildDataEditSummary,
  buildDataMutationPayload,
  clampPage,
  deleteSelectedDataRowState,
  isDirtyStateDirty,
  makeDataMutationPlanState,
  makeDirtyState,
  makeOriginalRows,
  nextSort,
  replaceFilter,
  undoDataChangesState,
  updateDataCellState,
  updateNewDataRowCellState,
  type DataMutationPlanState,
  type DbFilter
} from '@/services/databaseGridRuntime'
import { currentSqlStatement, firstStatement, formatSqlText } from '@/services/databaseSqlEditorRuntime'
import {
  isDatabaseExportData,
  isDatabasePageCommentGetData,
  isDatabasePageCommentSaveData,
  isDatabaseSqlExecuteData,
  isDatabaseSqlExecutionRecord,
  isDatabaseTableMutationData,
  isDatabaseTableMutationPlanData,
  isDatabaseTableQueryData,
  isLocalFileWriteData
} from '@/services/databaseBackendGuards'
import {
  buildChartSummary,
  databasePageCommentKeyId,
  type DatabaseChartSource
} from '@/services/databaseWorkspaceRuntime'
import type {
  DatabaseChartModalState,
  DatabaseCommentModalState,
  SqlExecutionOutcome,
  SqlExecutionPayload,
  SqlHistory,
  SqlResult,
  SqlResultViewState,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseExportInput,
  DatabasePageCommentKey,
  DatabaseSqlExecuteResult,
  DatabaseTableInfo,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationInput,
  DatabaseTableMutationResult,
  DatabaseTableQueryResult
} from '@shared/contracts/database'

type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>
type DataTab = Extract<WorkspaceTab, { kind: 'data' }>
type TableContext = { connectionId: string; catalogName: string; schemaName?: string; tableId?: string; tableName: string }
type TableReloadOptions = { withTotal?: boolean; preserveDirty?: boolean; notice?: string }

type DatabaseSqlDataWorkspaceControllerState = {
  tabs: Ref<WorkspaceTab[]>
  activeTabId: Ref<string>
  activeSqlTab: ComputedRef<SqlTab | null>
  activeDataTab: ComputedRef<DataTab | null>
  activeSqlCanRun: ComputedRef<boolean>
}

type DatabaseSqlDataWorkspaceControllerDeps = {
  showNotice: (message: string) => void
  copyText: (value: string) => Promise<boolean>
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  errorToMessage: (error: unknown) => string
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  findTable: (connectionId: string, catalogName: string, tableId: string, schemaName?: string) => DatabaseTableInfo | null
  tableContextMatches: (tab: Extract<WorkspaceTab, { kind: 'sql' | 'data' }>, ctx: TableContext) => boolean
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
  getSqlSelectionRange: () => { start: number; end: number }
  setEditorSql: (nextSql: string, selectionStart: number, selectionEnd?: number) => void
}

export const createDatabaseSqlDataWorkspaceController = (
  state: DatabaseSqlDataWorkspaceControllerState,
  deps: DatabaseSqlDataWorkspaceControllerDeps
) => {
  const { tabs, activeTabId, activeSqlTab, activeDataTab, activeSqlCanRun } = state
  const {
    showNotice,
    copyText,
    bridgeErrorMessage,
    errorToMessage,
    findConnection,
    findTable,
    tableContextMatches,
    getSelectedSqlText,
    getSqlCursorOffset,
    getSqlSelectionRange,
    setEditorSql
  } = deps

  const DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE = 'Backend table mutation returned malformed result data.'
  const SQL_FILE_WRITE_MALFORMED_MESSAGE = 'SQL file writer returned malformed result data.'
  const backend = createDatabaseSqlDataBackend({ bridgeErrorMessage, errorToMessage })

  const resultSeq = { value: 1 }
  const sqlResultViewStateById = reactive<Record<string, SqlResultViewState>>({})
  const emptySqlResultViewState: SqlResultViewState = Object.freeze({ page: 1, pageSize: 100, filters: [], sort: null }) as SqlResultViewState
  const chartModal = reactive<DatabaseChartModalState>({
    open: false,
    summary: null,
    error: ''
  })
  const commentModal = reactive<DatabaseCommentModalState>({
    open: false,
    title: '',
    scopeLabel: '',
    key: null,
    draft: '',
    updatedAt: 0,
    loading: false,
    saving: false,
    error: ''
  })

  const activeDataEditSummary = computed(() => (activeDataTab.value ? buildDataEditSummary(activeDataTab.value) : null))
  const activeSqlResult = computed(() => {
    const tab = activeSqlTab.value
    if (!tab || tab.activeResultTabId === 'overview') return null
    return tab.resultTabs.find((result) => result.id === tab.activeResultTabId) ?? null
  })
  const activeSqlResultViewState = computed(() => {
    const result = activeSqlResult.value
    return result ? getOrCreateSqlResultViewState(result.id) : emptySqlResultViewState
  })
  const activeDataWherePending = computed(() => {
    const tab = activeDataTab.value
    return !!tab && tab.whereDraft.trim() !== tab.whereRaw
  })
  const pagedDataRows = computed(() => {
    const tab = activeDataTab.value
    if (!tab) return []
    return tab.rows
  })
  const filteredSqlRows = computed(() => {
    const result = activeSqlResult.value
    if (!result || result.status === 'error') return []
    const state = activeSqlResultViewState.value
    return applySort(applyFilters(result.rows, state.filters), state.sort)
  })
  const pagedSqlRows = computed(() => {
    const result = activeSqlResult.value
    if (!result || result.status === 'error') return []
    const state = activeSqlResultViewState.value
    const start = (state.page - 1) * state.pageSize
    return filteredSqlRows.value.slice(start, start + state.pageSize)
  })

  const getOrCreateSqlResultViewState = (resultId: string): SqlResultViewState => {
    let state = sqlResultViewStateById[resultId]
    if (!state) {
      state = { page: 1, pageSize: 100, filters: [], sort: null }
      sqlResultViewStateById[resultId] = state
    }
    return state
  }

  const openTable = async (connectionId: string, catalogName: string, table: DatabaseTableInfo, schemaName?: string) => {
    const existing = tabs.value.find((tab) => tab.kind === 'data' && tab.tableId === table.id && tab.connectionId === connectionId) as WorkspaceTab | undefined
    if (existing) {
      activeTabId.value = existing.id
      return
    }
    const tab: WorkspaceTab = {
      id: `tab-data-${table.id}-${Date.now()}`,
      kind: 'data',
      title: table.name,
      connectionId,
      catalogName,
      schemaName,
      tableId: table.id,
      tableName: table.name,
      columns: table.columns.map((column) => column.name),
      sourceRows: [],
      rows: [],
      primaryKey: table.primaryKey,
      whereRaw: '',
      whereDraft: '',
      orderByRaw: '',
      orderByDraft: '',
      page: 1,
      pageSize: 100,
      filters: [],
      sort: null,
      selectedRowKey: null,
      loading: true,
      error: null,
      total: null,
      rowCount: 0,
      knownColumns: table.columns.map((column) => column.name),
      durationMs: 0,
      dirtyState: makeDirtyState([], table.primaryKey),
      undoStack: [],
      mutationPlan: makeDataMutationPlanState(),
      saving: false,
      saveError: null
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    await nextTick()
    const reactiveTab = tabs.value.find((item) => item.id === tab.id && item.kind === 'data') as DataTab | undefined
    if (reactiveTab) await reloadDataTab(reactiveTab, { preserveDirty: false })
  }

  const updateActiveSql = (value: string) => {
    const tab = activeSqlTab.value
    if (!tab) return
    tab.sql = value
  }

  const runSql = (mode: 'all' | 'current' | 'explain') => {
    const tab = activeSqlTab.value
    if (!tab || !activeSqlCanRun.value) return
    const sql = resolveSqlForRun(tab, mode)
    if (!sql.trim()) {
      showNotice('SQL is empty')
      return
    }
    void appendSqlExecution(tab, sql)
  }

  const appendSqlExecution = async (tab: SqlTab, sql: string) => {
    const result = createRunningSqlResult(tab, sql)
    tab.resultTabs.push(result)
    tab.activeResultTabId = result.id

    const response = await executeSqlThroughBackend(tab, sql)
    const outcome = sqlOutcomeFromBackendResult(response)

    patchSqlResult(tab, result.id, outcome.payload)
    if (outcome.execution) {
      const resultTabId = tab.resultTabs.some((item) => item.id === result.id) ? result.id : null
      tab.history.push({
        id: outcome.execution.id,
        resultTabId,
        title: result.title,
        sql,
        message: outcome.execution.message,
        status: outcome.execution.status,
        durationMs: outcome.execution.durationMs,
        rowCount: outcome.execution.rowCount,
        createdAt: outcome.execution.createdAt
      })
    }
  }

  const runSqlFromShortcut = () => {
    const selected = getSelectedSqlText()
    runSql(selected.trim() ? 'current' : 'all')
  }

  const resolveSqlForRun = (tab: SqlTab, mode: 'all' | 'current' | 'explain') => {
    if (mode === 'all') return tab.sql.trim()
    if (mode === 'current') return getSelectedSqlText().trim() || currentSqlStatement(tab.sql, getSqlCursorOffset()).trim()
    const statement = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || firstStatement(tab.sql)
    return statement ? `EXPLAIN ${stripExplainPrefix(statement)}` : ''
  }

  const createRunningSqlResult = (tab: SqlTab, sql: string): SqlResult => {
    const seq = resultSeq.value++
    const idx = tab.resultTabs.length + 1
    const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 40) || 'SQL'
    return {
      id: `result-${seq}`,
      title: `#${seq}-${idx} ${preview}`,
      sql,
      status: 'running',
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      error: null,
      message: 'Running'
    }
  }

  const executeSqlThroughBackend = async (tab: SqlTab, sql: string): Promise<DatabaseSqlExecuteResult> => {
    const connection = findConnection(tab.connectionId)
    return backend.executeSql({
      connectionId: tab.connectionId,
      dbType: connection?.dbType,
      sql,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName
    })
  }

  const sqlOutcomeFromBackendResult = (result: DatabaseSqlExecuteResult | undefined): SqlExecutionOutcome => {
    if (!result || typeof result !== 'object') {
      return { payload: createSqlErrorPayload('Backend SQL executor returned an empty response.'), execution: null }
    }
    if (!result.ok) {
      const execution = isDatabaseSqlExecutionRecord(result.execution) && result.execution.status === 'error' ? result.execution : null
      return {
        payload: createSqlErrorPayload(execution?.message || result.errorMessage || 'Backend SQL executor failed.', execution?.durationMs ?? 0),
        execution
      }
    }
    if (!isDatabaseSqlExecuteData(result.data)) {
      return { payload: createSqlErrorPayload('Backend SQL executor returned malformed result data.'), execution: null }
    }
    const data = result.data
    return {
      payload: {
        status: 'ok',
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount,
        durationMs: data.durationMs,
        error: null,
        message: data.execution.message
      },
      execution: data.execution
    }
  }

  const createSqlErrorPayload = (message: string, durationMs = 0): SqlExecutionPayload => ({
    status: 'error',
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs,
    error: message,
    message
  })

  const patchSqlResult = (tab: SqlTab, resultId: string, payload: SqlExecutionPayload) => {
    const index = tab.resultTabs.findIndex((item) => item.id === resultId)
    if (index === -1) return
    tab.resultTabs[index] = { ...tab.resultTabs[index], ...payload }
  }

  const defaultSqlFileName = (tab: SqlTab) => {
    const connection = findConnection(tab.connectionId)
    const parts = [tab.title, connection?.name, tab.catalogName, tab.schemaName].filter(Boolean)
    const base = parts.join('-') || 'query'
    const safe = base
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    return `${safe || 'query'}.sql`
  }

  const fileNameFromPath = (filePath: string) => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath

  const pickSqlSavePath = async (tab: SqlTab) => {
    return backend.pickSqlSavePath(tab.filePath || defaultSqlFileName(tab))
  }

  const saveActiveSql = async (forceSaveAs: boolean) => {
    const tab = activeSqlTab.value
    if (!tab || tab.saving) return
    const writerUnavailable = backend.sqlFileWriterUnavailableError()
    if (writerUnavailable) {
      tab.saveError = writerUnavailable
      showNotice(tab.saveError)
      return
    }
    tab.saving = true
    tab.saveError = null
    try {
      let targetPath = forceSaveAs ? '' : tab.filePath || ''
      if (!targetPath) {
        const picked = await pickSqlSavePath(tab)
        if (!picked.ok) {
          tab.saveError = picked.error
          showNotice(tab.saveError)
          return
        }
        if (picked.canceled) {
          showNotice('SQL save cancelled')
          return
        }
        targetPath = picked.filePath
      }
      const write = await backend.saveSqlFile(targetPath, tab.sql)
      if (!write.ok) {
        tab.saveError = write.error
        showNotice(tab.saveError)
        return
      }
      if (write.result?.ok !== true) {
        tab.saveError = write.result?.errorMessage || 'SQL file save failed'
        showNotice(tab.saveError)
        return
      }
      if (!isLocalFileWriteData(write.result.data, targetPath, tab.sql)) {
        tab.saveError = SQL_FILE_WRITE_MALFORMED_MESSAGE
        showNotice(tab.saveError)
        return
      }
      tab.filePath = targetPath
      tab.savedSql = tab.sql
      tab.saveError = null
      showNotice(`SQL saved to ${fileNameFromPath(targetPath)}`)
    } finally {
      tab.saving = false
    }
  }

  const stripExplainPrefix = (sql: string) => sql.replace(/^\s*explain\s+/i, '').trim()

  const closeResultTab = (resultId: string) => {
    const tab = activeSqlTab.value
    if (!tab || resultId === 'overview') return
    const closedIndex = tab.resultTabs.findIndex((result) => result.id === resultId)
    if (closedIndex === -1) return
    tab.resultTabs.splice(closedIndex, 1)
    delete sqlResultViewStateById[resultId]
    tab.history.forEach((item) => {
      if (item.resultTabId === resultId) item.resultTabId = null
    })
    if (tab.activeResultTabId === resultId) {
      const fallback = tab.resultTabs[closedIndex - 1] ?? tab.resultTabs[closedIndex] ?? null
      tab.activeResultTabId = fallback?.id ?? 'overview'
    }
  }

  const openSqlHistoryResult = (history: SqlHistory) => {
    const tab = activeSqlTab.value
    if (!tab || !history.resultTabId) return
    if (!tab.resultTabs.some((result) => result.id === history.resultTabId)) return
    tab.activeResultTabId = history.resultTabId
  }

  const isSqlHistoryClosed = (history: SqlHistory) => {
    const tab = activeSqlTab.value
    if (!tab || !history.resultTabId) return true
    return !tab.resultTabs.some((result) => result.id === history.resultTabId)
  }

  const updateSqlResultActiveTab = (resultTabId: string) => {
    const tab = activeSqlTab.value
    if (!tab) return
    tab.activeResultTabId = resultTabId
  }

  const updateSqlResultPage = (page: number) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    state.page = clampPage(page, filteredSqlRows.value.length, state.pageSize)
  }

  const updateSqlResultPageSize = (size: number) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    state.pageSize = size
    state.page = clampPage(state.page, filteredSqlRows.value.length, state.pageSize)
  }

  const gotoLastSqlResultPage = () => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    state.page = Math.max(1, Math.ceil(filteredSqlRows.value.length / state.pageSize))
  }

  const cycleSqlSort = (column: string) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    state.sort = nextSort(state.sort, column)
    state.page = 1
  }

  const applySqlFilter = (column: string, filter: DbFilter | null) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    state.filters = replaceFilter(state.filters, column, filter)
    state.page = 1
  }

  const updateDataPage = (page: number) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.page = tab.total === null ? Math.max(1, Math.floor(page)) : clampPage(page, tab.total, tab.pageSize)
    void reloadDataTab(tab)
  }

  const updateDataPageSize = (size: number) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.pageSize = size
    tab.page = 1
    void reloadDataTab(tab)
  }

  const updateActiveDataWhereDraft = (value: string) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.whereDraft = value
  }

  const gotoLastDataPage = () => {
    const tab = activeDataTab.value
    if (!tab) return
    void (async () => {
      if (tab.total === null) await refreshDataTotal()
      const total = tab.total ?? tab.rowCount
      tab.page = Math.max(1, Math.ceil(total / tab.pageSize))
      await reloadDataTab(tab)
    })()
  }

  const cycleDataSort = (column: string) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.sort = nextSort(tab.sort, column)
    tab.page = 1
    void reloadDataTab(tab)
  }

  const applyDataFilter = (column: string, filter: DbFilter | null) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.filters = replaceFilter(tab.filters, column, filter)
    tab.page = 1
    void reloadDataTab(tab)
  }

  const applyWhere = () => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.whereRaw = tab.whereDraft.trim()
    tab.whereDraft = tab.whereRaw
    tab.page = 1
    void reloadDataTab(tab)
  }

  const canEditDataTab = (tab: DataTab) => dataEditDisabledReason(tab) === ''

  const dataEditDisabledReason = (tab: DataTab) => {
    const connection = findConnection(tab.connectionId)
    const table = findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)
    if (!connection) return 'Connection is unavailable'
    if (connection.readonly) return 'Connection is readonly'
    if (isViewTable(tab)) return 'View editing is disabled in this version'
    if (!table) return 'Table is unavailable'
    return ''
  }

  const isDataTabDirty = (tab: DataTab) => isDirtyStateDirty(tab.dirtyState)

  const buildDataMutationPlanInput = (tab: DataTab): DatabaseTableMutationPlanInput => {
    const connection = findConnection(tab.connectionId)
    return {
      connectionId: tab.connectionId,
      dbType: connection?.dbType,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName,
      tableName: tab.tableName,
      columns: tab.columns.slice(),
      knownColumns: tab.knownColumns.slice(),
      mutations: buildDataMutationPayload(tab)
    }
  }

  const resetDataMutationPlan = (tab: DataTab) => {
    tab.mutationPlan = makeDataMutationPlanState()
  }

  const refreshDataMutationPlan = async (tab: DataTab, force = false): Promise<DataMutationPlanState> => {
    if (!isDataTabDirty(tab)) {
      resetDataMutationPlan(tab)
      return tab.mutationPlan
    }
    const input = buildDataMutationPlanInput(tab)
    const key = JSON.stringify(input)
    if (!force && tab.mutationPlan.key === key && !tab.mutationPlan.loading) return tab.mutationPlan
    tab.mutationPlan = makeDataMutationPlanState({ key, loading: true })
    const result = await backend.planTableMutation(input)
    if (tab.mutationPlan.key !== key) return tab.mutationPlan
    if (!result.ok) {
      tab.mutationPlan = makeDataMutationPlanState({
        key,
        error: result.errorMessage || 'Backend table mutation planning failed.'
      })
      return tab.mutationPlan
    }
    if (!isDatabaseTableMutationPlanData(result.data)) {
      tab.mutationPlan = makeDataMutationPlanState({
        key,
        error: DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE
      })
      return tab.mutationPlan
    }
    tab.mutationPlan = makeDataMutationPlanState({
      key,
      statementCount: result.data.statementCount,
      preview: result.data.preview,
      warning: result.data.warning
    })
    return tab.mutationPlan
  }

  const updateDataCell = (rowKey: string, column: string, value: string) => {
    const tab = activeDataTab.value
    if (!tab || !canEditDataTab(tab) || tab.saving) return
    const result = updateDataCellState(tab, rowKey, column, value)
    if (result.changed) void refreshDataMutationPlan(tab)
  }

  const updateNewDataRowCell = (tmpId: string, column: string, value: string) => {
    const tab = activeDataTab.value
    if (!tab || !canEditDataTab(tab) || tab.saving) return
    const result = updateNewDataRowCellState(tab, tmpId, column, value)
    if (result.changed) void refreshDataMutationPlan(tab)
  }

  const setActiveDataSelectedRow = (key: string) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.selectedRowKey = key
  }

  const addDataRow = () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    const reason = dataEditDisabledReason(tab)
    if (reason) {
      showNotice(reason)
      return
    }
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const result = addDataRowState(tab, tmpId)
    if (result.changed) void refreshDataMutationPlan(tab)
    if (result.notice) showNotice(result.notice)
  }

  const deleteSelectedDataRow = () => {
    const tab = activeDataTab.value
    if (!tab || !tab.selectedRowKey || tab.saving) return
    const reason = dataEditDisabledReason(tab)
    if (reason) {
      showNotice(reason)
      return
    }
    const result = deleteSelectedDataRowState(tab)
    if (result.changed) void refreshDataMutationPlan(tab)
    if (result.notice) showNotice(result.notice)
  }

  const undoDataChanges = () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    const result = undoDataChangesState(tab)
    if (result.changed) void refreshDataMutationPlan(tab)
    if (result.notice) showNotice(result.notice)
  }

  const saveDataChanges = async () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    const reason = dataEditDisabledReason(tab)
    if (reason) {
      tab.saveError = reason
      showNotice(reason)
      return
    }
    const plan = await refreshDataMutationPlan(tab, true)
    if (plan.error) {
      tab.saveError = plan.error
      showNotice(plan.error)
      return
    }
    if (plan.statementCount === 0) {
      tab.saveError = 'No SQL statement will be generated until a new row contains at least one value.'
      showNotice(tab.saveError)
      return
    }
    tab.saving = true
    tab.saveError = null
    await nextTick()
    try {
      const backendResult = await mutateDataTabThroughBackend(tab)
      if (!backendResult.ok) {
        tab.saveError = backendResult.errorMessage || 'Backend table mutation failed.'
        showNotice(tab.saveError)
        return
      }
      if (!isDatabaseTableMutationData(backendResult.data)) {
        tab.saveError = DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE
        showNotice(tab.saveError)
        return
      }
      await reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false })
      showNotice(`Changes saved through backend table store (${plan.statementCount} statement${plan.statementCount > 1 ? 's' : ''})`)
    } finally {
      tab.saving = false
    }
  }

  const mutateDataTabThroughBackend = (tab: DataTab): Promise<DatabaseTableMutationResult> =>
    mutateDatabaseTableThroughBackend({
      connectionId: tab.connectionId,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName,
      tableName: tab.tableName,
      mutations: buildDataMutationPayload(tab)
    })

  const mutateDatabaseTableThroughBackend = async (input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> => backend.mutateTable(input)

  const exportDatabaseRowsThroughBackend = async (input: DatabaseExportInput) => {
    const result = await backend.exportRows(input)
    if (!result.ok) {
      showNotice(result.errorMessage || 'Database export failed')
      return null
    }
    if (!isDatabaseExportData(result.data)) {
      showNotice('Database export backend returned malformed result data.')
      return null
    }
    if (result.data.canceled) {
      showNotice('Database export cancelled')
      return result.data
    }
    showNotice(`Exported ${result.data.exported} row${result.data.exported === 1 ? '' : 's'} to ${result.data.fileName}`)
    return result.data
  }

  const exportActiveSqlResultPage = () => {
    const tab = activeSqlTab.value
    const result = activeSqlResult.value
    if (!tab || !result || result.status !== 'ok' || !pagedSqlRows.value.length) {
      showNotice('No SQL result rows to export')
      return null
    }
    const connection = findConnection(tab.connectionId)
    return exportDatabaseRowsThroughBackend({
      title: `${tab.title}-${result.title}`,
      kind: 'sql-result',
      columns: result.columns,
      rows: pagedSqlRows.value,
      metadata: {
        connectionName: connection?.name,
        databaseName: tab.catalogName,
        schemaName: tab.schemaName,
        sql: result.sql,
        page: activeSqlResultViewState.value.page,
        pageSize: activeSqlResultViewState.value.pageSize,
        total: filteredSqlRows.value.length
      }
    })
  }

  const exportActiveDataPage = () => {
    const tab = activeDataTab.value
    if (!tab || tab.loading || tab.error || !pagedDataRows.value.length) {
      showNotice('No table rows to export')
      return null
    }
    const connection = findConnection(tab.connectionId)
    return exportDatabaseRowsThroughBackend({
      title: `${tab.title}-page-${tab.page}`,
      kind: 'table-page',
      columns: tab.columns,
      rows: pagedDataRows.value,
      metadata: {
        connectionName: connection?.name,
        databaseName: tab.catalogName,
        schemaName: tab.schemaName,
        tableName: tab.tableName,
        page: tab.page,
        pageSize: tab.pageSize,
        total: tab.total
      }
    })
  }

  const sqlResultCommentKey = (tab: SqlTab, result: SqlResult): DatabasePageCommentKey => ({
    scope: 'sql-result',
    connectionId: tab.connectionId,
    databaseName: tab.catalogName,
    ...(tab.schemaName ? { schemaName: tab.schemaName } : {}),
    resultId: result.id,
    sql: result.sql
  })

  const dataPageCommentKey = (tab: DataTab): DatabasePageCommentKey => ({
    scope: 'table-page',
    connectionId: tab.connectionId,
    databaseName: tab.catalogName,
    ...(tab.schemaName ? { schemaName: tab.schemaName } : {}),
    tableName: tab.tableName
  })

  const openChartModal = (source: DatabaseChartSource) => {
    chartModal.summary = buildChartSummary(source)
    chartModal.error = chartModal.summary ? '' : 'Current page does not contain a numeric column to chart.'
    chartModal.open = true
    if (!chartModal.summary) showNotice(chartModal.error)
  }

  const closeChartModal = () => {
    chartModal.open = false
  }

  const updateCommentDraft = (value: string) => {
    commentModal.draft = value
  }

  const openActiveSqlResultChart = () => {
    const tab = activeSqlTab.value
    const result = activeSqlResult.value
    if (!tab || !result || result.status !== 'ok' || !pagedSqlRows.value.length) {
      showNotice('No SQL result rows to chart')
      return
    }
    openChartModal({
      title: `${tab.title} - ${result.title}`,
      scopeLabel: `SQL page ${activeSqlResultViewState.value.page}`,
      columns: result.columns,
      rows: pagedSqlRows.value
    })
  }

  const openActiveDataChart = () => {
    const tab = activeDataTab.value
    if (!tab || tab.loading || tab.error || !pagedDataRows.value.length) {
      showNotice('No table rows to chart')
      return
    }
    openChartModal({
      title: `${tab.title} - page ${tab.page}`,
      scopeLabel: [tab.catalogName, tab.schemaName, tab.tableName].filter(Boolean).join(' / '),
      columns: tab.columns,
      rows: pagedDataRows.value
    })
  }

  const openCommentModal = async (input: { title: string; scopeLabel: string; key: DatabasePageCommentKey }) => {
    commentModal.open = true
    commentModal.title = input.title
    commentModal.scopeLabel = input.scopeLabel
    commentModal.key = input.key
    commentModal.draft = ''
    commentModal.updatedAt = 0
    commentModal.loading = true
    commentModal.saving = false
    commentModal.error = ''
    const result = await backend.getPageComment(input.key)
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(input.key)) return
    commentModal.loading = false
    if (!result.ok) {
      commentModal.error = result.errorMessage || 'Database comment load failed'
      showNotice(commentModal.error)
      return
    }
    if (!isDatabasePageCommentGetData(result.data, input.key)) {
      commentModal.error = 'Database comment backend returned malformed result data.'
      showNotice(commentModal.error)
      return
    }
    commentModal.draft = result.data.record.comment
    commentModal.updatedAt = result.data.record.updatedAt
  }

  const openActiveSqlResultComment = () => {
    const tab = activeSqlTab.value
    const result = activeSqlResult.value
    if (!tab || !result || result.status !== 'ok') {
      showNotice('No SQL result context to comment')
      return
    }
    void openCommentModal({
      title: `${tab.title} - ${result.title}`,
      scopeLabel: `SQL result / ${tab.catalogName}${tab.schemaName ? ` / ${tab.schemaName}` : ''}`,
      key: sqlResultCommentKey(tab, result)
    })
  }

  const openActiveDataComment = () => {
    const tab = activeDataTab.value
    if (!tab || tab.loading || tab.error) {
      showNotice('No table page context to comment')
      return
    }
    void openCommentModal({
      title: `${tab.title} - page ${tab.page}`,
      scopeLabel: [tab.catalogName, tab.schemaName, tab.tableName].filter(Boolean).join(' / '),
      key: dataPageCommentKey(tab)
    })
  }

  const saveActiveComment = async () => {
    const key = commentModal.key
    if (!key || commentModal.loading || commentModal.saving) return
    commentModal.saving = true
    commentModal.error = ''
    const result = await backend.savePageComment(key, commentModal.draft)
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(key)) return
    commentModal.saving = false
    if (!result.ok) {
      commentModal.error = result.errorMessage || 'Database comment save failed'
      showNotice(commentModal.error)
      return
    }
    if (!isDatabasePageCommentSaveData(result.data, key)) {
      commentModal.error = 'Database comment backend returned malformed result data.'
      showNotice(commentModal.error)
      return
    }
    commentModal.draft = result.data.record.comment
    commentModal.updatedAt = result.data.record.updatedAt
    showNotice(result.data.message || 'Comment saved')
  }

  const closeCommentModal = () => {
    if (commentModal.saving) return
    commentModal.open = false
  }

  const discardDataChanges = () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
    tab.undoStack = []
    tab.selectedRowKey = null
    tab.saveError = null
    resetDataMutationPlan(tab)
    showNotice('Local data edits discarded')
  }

  const copyDataMutationPreview = async () => {
    const summary = activeDataEditSummary.value
    if (!summary?.preview) return
    if (await copyText(summary.preview)) showNotice('Mutation preview copied')
  }

  const refreshDataTab = () => {
    const tab = activeDataTab.value
    if (!tab) return
    void reloadDataTab(tab, { notice: 'Table data refreshed' })
  }

  const refreshDataTotal = async () => {
    const tab = activeDataTab.value
    if (!tab) return
    await reloadDataTab(tab, { withTotal: true, preserveDirty: true, notice: 'Table total refreshed' })
  }

  const reloadDataTab = async (tab: DataTab, options: TableReloadOptions = {}) => {
    const preserveDirty = options.preserveDirty ?? true
    tab.loading = true
    tab.error = null
    try {
      const result = await queryDataTabThroughBackend(tab, options.withTotal ?? false)
      if (!result.ok) {
        tab.error = result.errorMessage || 'Backend table query failed.'
        return
      }
      if (!isDatabaseTableQueryData(result.data)) {
        tab.error = 'Backend table query returned malformed result data.'
        return
      }
      const data = result.data
      const total = data.total
      if (typeof total === 'number') {
        const maxPage = Math.max(1, Math.ceil(total / tab.pageSize))
        if (tab.page > maxPage) {
          tab.page = maxPage
          return reloadDataTab(tab, options)
        }
        tab.total = total
      }
      const rows = data.rows
      tab.rows = rows
      tab.sourceRows = rows.map((row) => ({ ...row }))
      tab.rowCount = data.rowCount
      tab.durationMs = data.durationMs
      tab.knownColumns = data.knownColumns
      tab.columns = data.columns
      if (!preserveDirty) {
        tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
        tab.undoStack = []
        tab.selectedRowKey = null
        tab.saveError = null
        resetDataMutationPlan(tab)
      } else {
        tab.dirtyState = { ...tab.dirtyState, originalRows: makeOriginalRows(tab.rows, tab.primaryKey) }
        void refreshDataMutationPlan(tab)
      }
      if (options.notice) showNotice(options.notice)
    } finally {
      tab.loading = false
    }
  }

  const queryDataTabThroughBackend = (tab: DataTab, withTotal: boolean): Promise<DatabaseTableQueryResult> => {
    const connection = findConnection(tab.connectionId)
    return backend.queryTable({
      connectionId: tab.connectionId,
      dbType: connection?.dbType,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName,
      tableName: tab.tableName,
      filters: tab.filters.map((filter) => ({ ...filter })),
      sort: tab.sort ? { ...tab.sort } : null,
      whereRaw: tab.whereRaw || null,
      orderByRaw: tab.orderByRaw || null,
      page: tab.page,
      pageSize: tab.pageSize,
      withTotal
    })
  }

  const isViewTable = (tab: DataTab) => {
    const catalog = findConnection(tab.connectionId)?.catalogs.find((item) => item.name === tab.catalogName)
    if (!catalog) return false
    if (tab.schemaName) {
      const schema = catalog.schemas?.find((item) => item.name === tab.schemaName)
      return !!schema?.views?.some((table) => table.id === tab.tableId)
    }
    return false
  }

  const formatSql = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    const range = getSqlSelectionRange()
    const hasSelection = range.start !== range.end
    const source = hasSelection ? tab.sql.slice(range.start, range.end) : tab.sql
    if (!source.trim()) {
      showNotice('SQL is empty')
      return
    }
    const formatted = formatSqlText(source)
    if (hasSelection) {
      const nextSql = `${tab.sql.slice(0, range.start)}${formatted}${tab.sql.slice(range.end)}`
      setEditorSql(nextSql, range.start, range.start + formatted.length)
    } else {
      setEditorSql(formatted, formatted.length)
    }
    showNotice('SQL formatted')
  }

  const cleanupDroppedTableUi = (
    droppedContext: TableContext & { tableId: string },
    removedTabIds: Set<string>,
    options: {
      ddlOpen: boolean
      setDdlOpen: (open: boolean) => void
      expandedTables: Ref<string[]>
      selectedNodeId: Ref<string | null>
      databaseNodeExists: (id: string | null) => boolean
    }
  ) => {
    tabs.value = tabs.value.filter((tab) => !removedTabIds.has(tab.id))
    if (removedTabIds.has(activeTabId.value)) activeTabId.value = tabs.value[0]?.id ?? 'tab-overview'
    options.expandedTables.value = options.expandedTables.value.filter((id) => id !== droppedContext.tableId)
    if (options.ddlOpen) options.setDdlOpen(false)
    const parentNodeId = droppedContext.schemaName
      ? `${droppedContext.connectionId}:${droppedContext.catalogName}:${droppedContext.schemaName}`
      : `${droppedContext.connectionId}:${droppedContext.catalogName}`
    if (
      options.databaseNodeExists(parentNodeId) &&
      (options.selectedNodeId.value === droppedContext.tableId || options.selectedNodeId.value?.startsWith(`${droppedContext.tableId}:column:`))
    ) {
      options.selectedNodeId.value = parentNodeId
    }
  }

  const dataTabsMatching = (context: TableContext) =>
    tabs.value.filter((tab): tab is DataTab => tab.kind === 'data' && tableContextMatches(tab, context))

  const tabIdsMatching = (context: TableContext) =>
    new Set(tabs.value.filter((tab) => tab.kind !== 'overview' && tableContextMatches(tab, context)).map((tab) => tab.id))

  return {
    chartModal,
    commentModal,
    activeDataEditSummary,
    activeSqlResult,
    activeSqlResultViewState,
    activeDataWherePending,
    pagedDataRows,
    filteredSqlRows,
    pagedSqlRows,
    openTable,
    updateActiveSql,
    runSql,
    appendSqlExecution,
    runSqlFromShortcut,
    saveActiveSql,
    closeResultTab,
    openSqlHistoryResult,
    isSqlHistoryClosed,
    updateSqlResultActiveTab,
    updateSqlResultPage,
    updateSqlResultPageSize,
    gotoLastSqlResultPage,
    cycleSqlSort,
    applySqlFilter,
    updateDataPage,
    updateDataPageSize,
    updateActiveDataWhereDraft,
    gotoLastDataPage,
    cycleDataSort,
    applyDataFilter,
    applyWhere,
    canEditDataTab,
    dataEditDisabledReason,
    isDataTabDirty,
    resetDataMutationPlan,
    refreshDataMutationPlan,
    updateDataCell,
    updateNewDataRowCell,
    setActiveDataSelectedRow,
    addDataRow,
    deleteSelectedDataRow,
    undoDataChanges,
    saveDataChanges,
    mutateDatabaseTableThroughBackend,
    exportActiveSqlResultPage,
    exportActiveDataPage,
    closeChartModal,
    updateCommentDraft,
    openActiveSqlResultChart,
    openActiveDataChart,
    openActiveSqlResultComment,
    openActiveDataComment,
    saveActiveComment,
    closeCommentModal,
    discardDataChanges,
    copyDataMutationPreview,
    refreshDataTab,
    refreshDataTotal,
    reloadDataTab,
    formatSql,
    cleanupDroppedTableUi,
    dataTabsMatching,
    tabIdsMatching
  }
}
