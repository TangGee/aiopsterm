import {
  buildDataMutationPayload,
  clampPage,
  makeDataMutationPlanState,
  makeDirtyState,
  makeOriginalRows,
  nextSort,
  replaceFilter,
  type DbFilter
} from '@/services/database/databaseGridRuntime'
import { isDatabaseSqlExecuteData, isDatabaseSqlExecutionRecord } from '@/services/database/databaseBackendGuards'
import type { DatabaseChartSource } from '@/services/database/databaseWorkspaceRuntime'
import type {
  SqlExecutionOutcome,
  SqlExecutionPayload,
  SqlHistory,
  SqlResult,
  SqlResultViewState,
  WorkspaceTab
} from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseExportInput,
  DatabasePageCommentKey,
  DatabaseSqlExecuteResult,
  DatabaseTableInfo,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from '@shared/contracts/database'

export type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>
export type DataTab = Extract<WorkspaceTab, { kind: 'data' }>

export const emptySqlResultViewState = Object.freeze({ page: 1, pageSize: 100, filters: [], sort: null }) as SqlResultViewState

export const createSqlResultViewState = (): SqlResultViewState => ({ page: 1, pageSize: 100, filters: [], sort: null })

export const createDataTab = (
  input: {
    connectionId: string
    catalogName: string
    table: DatabaseTableInfo
    schemaName?: string
  },
  now = Date.now()
): DataTab => ({
  id: `tab-data-${input.table.id}-${now}`,
  kind: 'data',
  title: input.table.name,
  connectionId: input.connectionId,
  catalogName: input.catalogName,
  schemaName: input.schemaName,
  tableId: input.table.id,
  tableName: input.table.name,
  columns: input.table.columns.map((column) => column.name),
  sourceRows: [],
  rows: [],
  primaryKey: input.table.primaryKey,
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
  knownColumns: input.table.columns.map((column) => column.name),
  durationMs: 0,
  dirtyState: makeDirtyState([], input.table.primaryKey),
  undoStack: [],
  mutationPlan: makeDataMutationPlanState(),
  saving: false,
  saveError: null
})

export const createRunningSqlResult = (tab: Pick<SqlTab, 'resultTabs'>, sql: string, seq: number): SqlResult => {
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

export const createSqlErrorPayload = (message: string, durationMs = 0): SqlExecutionPayload => ({
  status: 'error',
  columns: [],
  rows: [],
  rowCount: 0,
  durationMs,
  error: message,
  message
})

export const sqlOutcomeFromBackendResult = (result: DatabaseSqlExecuteResult | undefined): SqlExecutionOutcome => {
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

export const patchSqlResult = (tab: SqlTab, resultId: string, payload: SqlExecutionPayload) => {
  const index = tab.resultTabs.findIndex((item) => item.id === resultId)
  if (index === -1) return false
  tab.resultTabs[index] = { ...tab.resultTabs[index], ...payload }
  return true
}

export const appendSqlHistoryFromExecution = (tab: SqlTab, result: SqlResult, sql: string, execution: NonNullable<SqlExecutionOutcome['execution']>) => {
  const resultTabId = tab.resultTabs.some((item) => item.id === result.id) ? result.id : null
  tab.history.push({
    id: execution.id,
    resultTabId,
    title: result.title,
    sql,
    message: execution.message,
    status: execution.status,
    durationMs: execution.durationMs,
    rowCount: execution.rowCount,
    createdAt: execution.createdAt
  })
}

export const defaultSqlFileName = (tab: SqlTab, connectionName = '') => {
  const parts = [tab.title, connectionName, tab.catalogName, tab.schemaName].filter(Boolean)
  const base = parts.join('-') || 'query'
  const safe = base
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${safe || 'query'}.sql`
}

export const fileNameFromPath = (filePath: string) => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath

export const closeSqlResultTab = (tab: SqlTab, resultId: string, viewStateById: Record<string, SqlResultViewState>) => {
  if (resultId === 'overview') return false
  const closedIndex = tab.resultTabs.findIndex((result) => result.id === resultId)
  if (closedIndex === -1) return false
  tab.resultTabs.splice(closedIndex, 1)
  delete viewStateById[resultId]
  tab.history.forEach((item) => {
    if (item.resultTabId === resultId) item.resultTabId = null
  })
  if (tab.activeResultTabId === resultId) {
    const fallback = tab.resultTabs[closedIndex - 1] ?? tab.resultTabs[closedIndex] ?? null
    tab.activeResultTabId = fallback?.id ?? 'overview'
  }
  return true
}

export const openSqlHistoryResult = (tab: SqlTab, history: SqlHistory) => {
  if (!history.resultTabId) return false
  if (!tab.resultTabs.some((result) => result.id === history.resultTabId)) return false
  tab.activeResultTabId = history.resultTabId
  return true
}

export const isSqlHistoryClosed = (tab: SqlTab | null, history: SqlHistory) => {
  if (!tab || !history.resultTabId) return true
  return !tab.resultTabs.some((result) => result.id === history.resultTabId)
}

export const setSqlResultPage = (state: SqlResultViewState, page: number, filteredCount: number) => {
  state.page = clampPage(page, filteredCount, state.pageSize)
}

export const setSqlResultPageSize = (state: SqlResultViewState, size: number, filteredCount: number) => {
  state.pageSize = size
  state.page = clampPage(state.page, filteredCount, state.pageSize)
}

export const gotoLastSqlResultPage = (state: SqlResultViewState, filteredCount: number) => {
  state.page = Math.max(1, Math.ceil(filteredCount / state.pageSize))
}

export const cycleSqlResultSort = (state: SqlResultViewState, column: string) => {
  state.sort = nextSort(state.sort, column)
  state.page = 1
}

export const applySqlResultFilter = (state: SqlResultViewState, column: string, filter: DbFilter | null) => {
  state.filters = replaceFilter(state.filters, column, filter)
  state.page = 1
}

export const dataEditDisabledReason = (
  tab: DataTab,
  input: {
    connection?: DatabaseConnectionInfo
    table?: DatabaseTableInfo | null
    isView: boolean
  }
) => {
  if (!input.connection) return 'Connection is unavailable'
  if (input.connection.readonly) return 'Connection is readonly'
  if (input.isView) return 'View editing is disabled in this version'
  if (!input.table) return 'Table is unavailable'
  return ''
}

export const buildDataMutationPlanInput = (tab: DataTab, dbType?: DatabaseConnectionInfo['dbType']): DatabaseTableMutationPlanInput => ({
  connectionId: tab.connectionId,
  dbType,
  databaseName: tab.catalogName,
  schemaName: tab.schemaName,
  tableName: tab.tableName,
  columns: tab.columns.slice(),
  knownColumns: tab.knownColumns.slice(),
  mutations: buildDataMutationPayload(tab)
})

export const buildDataMutationInput = (tab: DataTab): DatabaseTableMutationInput => ({
  connectionId: tab.connectionId,
  databaseName: tab.catalogName,
  schemaName: tab.schemaName,
  tableName: tab.tableName,
  mutations: buildDataMutationPayload(tab)
})

export const buildDataQueryInput = (tab: DataTab, withTotal: boolean, dbType?: DatabaseConnectionInfo['dbType']): DatabaseTableQueryInput => ({
  connectionId: tab.connectionId,
  dbType,
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

export const setDataPage = (tab: DataTab, page: number) => {
  tab.page = tab.total === null ? Math.max(1, Math.floor(page)) : clampPage(page, tab.total, tab.pageSize)
}

export const setDataPageSize = (tab: DataTab, size: number) => {
  tab.pageSize = size
  tab.page = 1
}

export const gotoLastDataPage = (tab: DataTab, total: number) => {
  tab.page = Math.max(1, Math.ceil(total / tab.pageSize))
}

export const cycleDataSort = (tab: DataTab, column: string) => {
  tab.sort = nextSort(tab.sort, column)
  tab.page = 1
}

export const applyDataFilter = (tab: DataTab, column: string, filter: DbFilter | null) => {
  tab.filters = replaceFilter(tab.filters, column, filter)
  tab.page = 1
}

export const updateDataWhereDraft = (tab: DataTab, value: string) => {
  tab.whereDraft = value
}

export const applyDataWhere = (tab: DataTab) => {
  tab.whereRaw = tab.whereDraft.trim()
  tab.whereDraft = tab.whereRaw
  tab.page = 1
}

export const resetDataMutationPlan = (tab: DataTab) => {
  tab.mutationPlan = makeDataMutationPlanState()
}

export const setDataMutationPlanLoading = (tab: DataTab, key: string) => {
  tab.mutationPlan = makeDataMutationPlanState({ key, loading: true })
}

export const setDataMutationPlanError = (tab: DataTab, key: string, error: string) => {
  tab.mutationPlan = makeDataMutationPlanState({ key, error })
}

export const setDataMutationPlanPreview = (
  tab: DataTab,
  input: {
    key: string
    statementCount: number
    preview: string
    warning: string
  }
) => {
  tab.mutationPlan = makeDataMutationPlanState(input)
}

export const resetDataDirtyState = (tab: DataTab) => {
  tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
  tab.undoStack = []
  tab.selectedRowKey = null
  tab.saveError = null
  resetDataMutationPlan(tab)
}

export const applyDataQueryResult = (tab: DataTab, data: NonNullable<DatabaseTableQueryResult['data']>, preserveDirty: boolean) => {
  const total = data.total
  if (typeof total === 'number') {
    const maxPage = Math.max(1, Math.ceil(total / tab.pageSize))
    if (tab.page > maxPage) {
      tab.page = maxPage
      return { retry: true, dirtyPreserved: preserveDirty }
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
    resetDataDirtyState(tab)
    return { retry: false, dirtyPreserved: false }
  }
  tab.dirtyState = { ...tab.dirtyState, originalRows: makeOriginalRows(tab.rows, tab.primaryKey) }
  return { retry: false, dirtyPreserved: true }
}

export const buildSqlResultExportInput = (
  tab: SqlTab,
  result: SqlResult,
  rows: Array<Record<string, unknown>>,
  viewState: SqlResultViewState,
  total: number,
  connectionName?: string
): DatabaseExportInput => ({
  title: `${tab.title}-${result.title}`,
  kind: 'sql-result',
  columns: result.columns,
  rows,
  metadata: {
    connectionName,
    databaseName: tab.catalogName,
    schemaName: tab.schemaName,
    sql: result.sql,
    page: viewState.page,
    pageSize: viewState.pageSize,
    total
  }
})

export const buildDataPageExportInput = (tab: DataTab, rows: Array<Record<string, unknown>>, connectionName?: string): DatabaseExportInput => ({
  title: `${tab.title}-page-${tab.page}`,
  kind: 'table-page',
  columns: tab.columns,
  rows,
  metadata: {
    connectionName,
    databaseName: tab.catalogName,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    page: tab.page,
    pageSize: tab.pageSize,
    total: tab.total
  }
})

export const sqlResultChartSource = (tab: SqlTab, result: SqlResult, rows: Array<Record<string, unknown>>, page: number): DatabaseChartSource => ({
  title: `${tab.title} - ${result.title}`,
  scopeLabel: `SQL page ${page}`,
  columns: result.columns,
  rows
})

export const dataPageChartSource = (tab: DataTab, rows: Array<Record<string, unknown>>): DatabaseChartSource => ({
  title: `${tab.title} - page ${tab.page}`,
  scopeLabel: [tab.catalogName, tab.schemaName, tab.tableName].filter(Boolean).join(' / '),
  columns: tab.columns,
  rows
})

export const sqlResultCommentKey = (tab: SqlTab, result: SqlResult): DatabasePageCommentKey => ({
  scope: 'sql-result',
  connectionId: tab.connectionId,
  databaseName: tab.catalogName,
  ...(tab.schemaName ? { schemaName: tab.schemaName } : {}),
  resultId: result.id,
  sql: result.sql
})

export const dataPageCommentKey = (tab: DataTab): DatabasePageCommentKey => ({
  scope: 'table-page',
  connectionId: tab.connectionId,
  databaseName: tab.catalogName,
  ...(tab.schemaName ? { schemaName: tab.schemaName } : {}),
  tableName: tab.tableName
})
