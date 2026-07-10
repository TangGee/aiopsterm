import { describe, expect, it, vi } from 'vitest'
import { isProxy, reactive } from 'vue'
import {
  appendSqlHistoryFromExecution,
  applyDataFilter,
  applyDataQueryResult,
  applyDataWhere,
  applySqlResultFilter,
  buildDataMutationInput,
  buildDataMutationPlanInput,
  buildDataPageExportInput,
  buildDataQueryInput,
  buildSqlResultExportInput,
  closeSqlResultTab,
  createDataTab,
  createRunningSqlResult,
  createSqlResultViewState,
  cycleDataSort,
  cycleSqlResultSort,
  dataEditDisabledReason,
  dataPageChartSource,
  dataPageCommentKey,
  defaultSqlFileName,
  fileNameFromPath,
  gotoLastDataPage,
  gotoLastSqlResultPage,
  isSqlHistoryClosed,
  openSqlHistoryResult,
  patchSqlResult,
  resetDataDirtyState,
  setDataMutationPlanError,
  setDataMutationPlanLoading,
  setDataMutationPlanPreview,
  setDataPage,
  setDataPageSize,
  setSqlResultPage,
  setSqlResultPageSize,
  sqlOutcomeFromBackendResult,
  sqlResultChartSource,
  sqlResultCommentKey,
  updateDataWhereDraft,
  type DataTab,
  type SqlTab
} from '@/services/database/databaseSqlDataRuntime'
import { updateDataCellState } from '@/services/database/databaseGridRuntime'
import type { DatabaseConnectionInfo, DatabaseSqlExecuteResult, DatabaseTableInfo } from '@shared/contracts/database'

const table: DatabaseTableInfo = {
  id: 'tbl-orders',
  name: 'orders',
  columns: [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'status', type: 'text', nullable: true }
  ],
  primaryKey: ['id']
}

const connection: DatabaseConnectionInfo = {
  id: 'conn-1',
  name: 'Orders DB',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: []
}

const makeSqlTab = (): SqlTab => ({
  id: 'tab-sql-1',
  kind: 'sql',
  title: 'Orders Query',
  connectionId: 'conn-1',
  catalogName: 'orders',
  schemaName: 'public',
  sql: 'select * from orders',
  savedSql: 'select * from orders',
  saving: false,
  saveError: null,
  resultTabs: [],
  activeResultTabId: 'overview',
  history: []
})

describe('databaseSqlDataRuntime', () => {
  it('keeps SQL result state and backend outcome normalization outside the workspace controller', () => {
    const tab = makeSqlTab()
    const running = createRunningSqlResult(tab, 'select * from orders where status = open', 7)
    tab.resultTabs.push(running)
    tab.activeResultTabId = running.id

    const okResult: DatabaseSqlExecuteResult = {
      ok: true,
      data: {
        columns: ['id', 'status'],
        rows: [{ id: 1, status: 'open' }],
        rowCount: 1,
        durationMs: 12,
        execution: { id: 'exec-1', status: 'ok', message: '1 row', durationMs: 12, rowCount: 1, createdAt: '2026-06-22T00:00:00.000Z' }
      }
    }
    const outcome = sqlOutcomeFromBackendResult(okResult)

    expect(running).toEqual(expect.objectContaining({ id: 'result-7', status: 'running', message: 'Running' }))
    expect(outcome).toEqual(expect.objectContaining({ payload: expect.objectContaining({ status: 'ok', rowCount: 1 }), execution: okResult.data?.execution }))
    expect(patchSqlResult(tab, running.id, outcome.payload)).toBe(true)
    appendSqlHistoryFromExecution(tab, running, running.sql, outcome.execution!)
    expect(tab.resultTabs[0]).toEqual(expect.objectContaining({ status: 'ok', rowCount: 1 }))
    expect(tab.history[0]).toEqual(expect.objectContaining({ id: 'exec-1', resultTabId: running.id, status: 'ok' }))

    const state = createSqlResultViewState()
    setSqlResultPageSize(state, 50, 125)
    gotoLastSqlResultPage(state, 125)
    cycleSqlResultSort(state, 'id')
    applySqlResultFilter(state, 'status', { column: 'status', operator: 'eq', value: 'open' })
    setSqlResultPage(state, 3, 125)
    expect(state).toEqual({ page: 3, pageSize: 50, filters: [{ column: 'status', operator: 'eq', value: 'open' }], sort: { column: 'id', direction: 'asc' } })

    expect(openSqlHistoryResult(tab, tab.history[0])).toBe(true)
    expect(isSqlHistoryClosed(tab, tab.history[0])).toBe(false)
    expect(closeSqlResultTab(tab, running.id, { [running.id]: state })).toBe(true)
    expect(tab.activeResultTabId).toBe('overview')
    expect(tab.history[0].resultTabId).toBeNull()

    expect(sqlOutcomeFromBackendResult({ ok: false, errorMessage: 'failed', execution: { id: 'exec-2', status: 'error', message: 'syntax error', durationMs: 3, rowCount: 0, createdAt: '2026-06-22T00:00:01.000Z' } })).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ status: 'error', error: 'syntax error' }) })
    )
    expect(sqlOutcomeFromBackendResult({ ok: true, data: { columns: ['id'] } as any })).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ status: 'error', error: 'Backend SQL executor returned malformed result data.' }) })
    )
  })

  it('owns data tab state construction, query payloads, dirty reset, and export/comment/chart inputs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1782086400000)
    const tab = createDataTab({ connectionId: 'conn-1', catalogName: 'orders', table, schemaName: 'public' }, Date.now())

    expect(tab).toEqual(expect.objectContaining({ id: 'tab-data-tbl-orders-1782086400000', columns: ['id', 'status'], page: 1, pageSize: 100, loading: true }))
    expect(dataEditDisabledReason(tab, { connection, table, isView: false })).toBe('')
    expect(dataEditDisabledReason(tab, { connection: { ...connection, readonly: true }, table, isView: false })).toBe('Connection is readonly')
    expect(dataEditDisabledReason(tab, { connection, table, isView: true })).toBe('View editing is disabled in this version')

    setDataPage(tab, 2)
    setDataPageSize(tab, 25)
    updateDataWhereDraft(tab, ' status = open ')
    applyDataWhere(tab)
    cycleDataSort(tab, 'id')
    applyDataFilter(tab, 'status', { column: 'status', operator: 'eq', value: 'open' })
    expect(tab).toEqual(expect.objectContaining({ page: 1, pageSize: 25, whereRaw: 'status = open', sort: { column: 'id', direction: 'asc' } }))

    expect(buildDataQueryInput(tab, true, connection.dbType)).toEqual(
      expect.objectContaining({
        connectionId: 'conn-1',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders',
        whereRaw: 'status = open',
        withTotal: true
      })
    )

    const applied = applyDataQueryResult(
      tab,
      { columns: ['id', 'status'], rows: [{ id: 1, status: 'open' }], rowCount: 1, durationMs: 5, total: 51, knownColumns: ['id', 'status'] },
      false
    )
    expect(applied).toEqual({ retry: false, dirtyPreserved: false })
    expect(tab).toEqual(expect.objectContaining({ rows: [{ id: 1, status: 'open' }], total: 51, rowCount: 1, loading: true }))

    gotoLastDataPage(tab, 51)
    expect(tab.page).toBe(3)
    updateDataCellState(tab, JSON.stringify([1]), 'status', 'closed')
    expect(buildDataMutationPlanInput(tab, connection.dbType)).toEqual(expect.objectContaining({ dbType: 'postgresql', columns: ['id', 'status'], knownColumns: ['id', 'status'] }))
    expect(buildDataMutationInput(tab)).toEqual(expect.objectContaining({ mutations: [expect.objectContaining({ kind: 'update', patch: { status: 'closed' } })] }))
    setDataMutationPlanLoading(tab, 'plan-1')
    setDataMutationPlanError(tab, 'plan-1', 'failed')
    expect(tab.mutationPlan).toEqual(expect.objectContaining({ key: 'plan-1', error: 'failed' }))
    setDataMutationPlanPreview(tab, { key: 'plan-2', statementCount: 1, preview: 'update orders', warning: '' })
    expect(tab.mutationPlan).toEqual(expect.objectContaining({ key: 'plan-2', statementCount: 1, preview: 'update orders' }))
    resetDataDirtyState(tab)
    expect(tab.dirtyState.updatedCells.size).toBe(0)

    expect(buildDataPageExportInput(tab, tab.rows, connection.name)).toEqual(expect.objectContaining({ title: 'orders-page-3', kind: 'table-page', metadata: expect.objectContaining({ connectionName: 'Orders DB' }) }))
    expect(dataPageChartSource(tab, tab.rows)).toEqual(expect.objectContaining({ title: 'orders - page 3', scopeLabel: 'orders / public / orders' }))
    expect(dataPageCommentKey(tab)).toEqual({ scope: 'table-page', connectionId: 'conn-1', databaseName: 'orders', schemaName: 'public', tableName: 'orders' })
  })

  it('builds SQL file, export, chart, and comment helper data without backend dependencies', () => {
    const tab = makeSqlTab()
    const result = createRunningSqlResult(tab, 'select 1', 1)
    result.status = 'ok'
    result.columns = ['id']
    result.rows = [{ id: 1 }]
    result.rowCount = 1
    tab.resultTabs.push(result)
    const view = createSqlResultViewState()

    expect(defaultSqlFileName(tab, 'Orders DB')).toBe('Orders-Query-Orders-DB-orders-public.sql')
    expect(fileNameFromPath('/tmp/orders.sql')).toBe('orders.sql')
    expect(buildSqlResultExportInput(tab, result, result.rows, view, 1, 'Orders DB')).toEqual(expect.objectContaining({ title: 'Orders Query-#1-1 select 1', kind: 'sql-result' }))
    expect(sqlResultChartSource(tab, result, result.rows, 1)).toEqual(expect.objectContaining({ title: 'Orders Query - #1-1 select 1', scopeLabel: 'SQL page 1' }))
    expect(sqlResultCommentKey(tab, result)).toEqual({ scope: 'sql-result', connectionId: 'conn-1', databaseName: 'orders', schemaName: 'public', resultId: result.id, sql: 'select 1' })

    const sqliteTab = { ...tab, catalogName: 'main', schemaName: '' }
    expect(defaultSqlFileName(sqliteTab, 'Local cache', 'cache.sqlite3')).toBe('Orders-Query-Local-cache-cache.sqlite3.sql')
    expect(defaultSqlFileName(sqliteTab, 'cache.sqlite3', 'cache.sqlite3')).toBe('Orders-Query-cache.sqlite3.sql')
    expect(buildSqlResultExportInput(sqliteTab, result, result.rows, view, 1, 'Local cache', 'cache.sqlite3').metadata?.databaseName).toBe('cache.sqlite3')
    expect(sqlResultCommentKey(sqliteTab, result).databaseName).toBe('main')

    const sqliteDataTab = { ...createDataTab({ connectionId: 'conn-sqlite', catalogName: 'main', table }), loading: false }
    expect(buildDataPageExportInput(sqliteDataTab, [], 'Local cache', 'cache.sqlite3').metadata?.databaseName).toBe('cache.sqlite3')
    expect(dataPageChartSource(sqliteDataTab, [], 'cache.sqlite3').scopeLabel).toBe('cache.sqlite3 / orders')
    expect(dataPageCommentKey(sqliteDataTab).databaseName).toBe('main')
  })

  it('detaches reactive SQL and table page values before sending export inputs through IPC', () => {
    const createdAt = new Date('2026-07-10T04:00:00.000Z')
    const rows = reactive([
      {
        id: 1,
        payload: { status: 'ready', tags: ['daily'] },
        createdAt,
        bytes: new Uint8Array([1, 2, 3])
      }
    ]) as Array<Record<string, unknown>>
    const tab = reactive(makeSqlTab()) as SqlTab
    const result = reactive(createRunningSqlResult(tab, 'select payload from orders', 1))
    result.columns = reactive(['id', 'payload', 'createdAt', 'bytes'])
    result.rows = rows

    const sqlInput = buildSqlResultExportInput(tab, result, rows, createSqlResultViewState(), 1)
    const dataTab = reactive(createDataTab({ connectionId: 'conn-1', catalogName: 'orders', table, schemaName: 'public' })) as DataTab
    dataTab.columns = reactive(['id', 'payload', 'createdAt', 'bytes'])
    const dataInput = buildDataPageExportInput(dataTab, rows)

    for (const input of [sqlInput, dataInput]) {
      expect(() => structuredClone(input)).not.toThrow()
      expect(isProxy(input.columns)).toBe(false)
      expect(isProxy(input.rows)).toBe(false)
      expect(isProxy(input.rows[0])).toBe(false)
      expect(isProxy(input.rows[0].payload)).toBe(false)
      expect(input.rows[0].createdAt).toEqual(createdAt)
      expect(input.rows[0].createdAt).not.toBe(createdAt)
      expect(input.rows[0].bytes).toEqual(new Uint8Array([1, 2, 3]))
    }
  })
})
