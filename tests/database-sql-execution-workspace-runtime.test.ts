import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseSqlExecutionWorkspaceRuntime } from '@/services/database/databaseSqlExecutionWorkspaceRuntime'
import type { SqlTab } from '@/services/database/databaseSqlDataRuntime'
import type { DatabaseSqlExecuteInput, DatabaseSqlExecuteResult } from '@shared/contracts/database'

const makeSqlTab = (sql = 'select 1; select 2;'): SqlTab => ({
  id: 'tab-sql-1',
  kind: 'sql',
  title: 'Query',
  connectionId: 'conn-1',
  catalogName: 'orders',
  schemaName: 'public',
  sql,
  savedSql: sql,
  saving: false,
  saveError: null,
  resultTabs: [],
  activeResultTabId: 'overview',
  history: []
})

const executionResult = (id: string, sql: string, status: 'ok' | 'error' = 'ok'): DatabaseSqlExecuteResult => {
  const execution = {
    id,
    status,
    message: status === 'ok' ? `Executed ${sql}` : `Failed ${sql}`,
    durationMs: 1,
    rowCount: status === 'ok' ? 1 : 0,
    createdAt: `2026-07-10T00:00:0${id.slice(-1)}.000Z`
  }
  if (status === 'error') {
    return { ok: false, errorCode: 'DB_SQL_FAILED', errorMessage: execution.message, execution }
  }
  return {
    ok: true,
    data: {
      columns: ['value'],
      rows: [{ value: sql }],
      rowCount: 1,
      durationMs: 1,
      execution
    }
  }
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const makeRuntime = (tab: SqlTab, executeSql: (input: DatabaseSqlExecuteInput) => Promise<DatabaseSqlExecuteResult>) => {
  const activeSqlTab = ref<SqlTab | null>(tab)
  return createDatabaseSqlExecutionWorkspaceRuntime(
    { activeSqlTab: computed(() => activeSqlTab.value), activeSqlCanRun: computed(() => true) },
    {
      showNotice: vi.fn(),
      findConnection: () => undefined,
      getSelectedSqlText: () => '',
      getSqlCursorOffset: () => tab.sql.length,
      getSqlSelectionRange: () => ({ start: 0, end: 0 }),
      setEditorSql: vi.fn(),
      backend: {
        executeSql,
        pickSqlSavePath: vi.fn(),
        saveSqlFile: vi.fn(),
        sqlFileWriterUnavailableError: () => ''
      }
    }
  )
}

describe('databaseSqlExecutionWorkspaceRuntime', () => {
  it('executes every statement in order and continues after an SQL error', async () => {
    const tab = makeSqlTab()
    const executeSql = vi.fn(async (input: DatabaseSqlExecuteInput) =>
      executionResult(input.sql === 'select 1' ? 'exec-1' : 'exec-2', input.sql, input.sql === 'select 1' ? 'error' : 'ok')
    )
    const runtime = makeRuntime(tab, executeSql)

    await runtime.runSql('all')

    expect(executeSql.mock.calls.map(([input]) => input.sql)).toEqual(['select 1', 'select 2'])
    expect(tab.resultTabs).toHaveLength(2)
    expect(tab.resultTabs.map((result) => result.status)).toEqual(['error', 'ok'])
    expect(tab.history.map((history) => history.id)).toEqual(['exec-1', 'exec-2'])
  })

  it('reuses completed unpinned result slots and detaches their old history entries', async () => {
    const tab = makeSqlTab('select 1;')
    let sequence = 0
    const executeSql = vi.fn(async (input: DatabaseSqlExecuteInput) => executionResult(`exec-${++sequence}`, input.sql))
    const runtime = makeRuntime(tab, executeSql)

    await runtime.runSql('all')
    const firstResultId = tab.resultTabs[0].id
    const firstHistory = tab.history[0]
    tab.sql = 'select 2;'
    await runtime.runSql('all')

    expect(tab.resultTabs).toHaveLength(1)
    expect(tab.resultTabs[0]).toEqual(expect.objectContaining({ id: firstResultId, sql: 'select 2', status: 'ok' }))
    expect(firstHistory.resultTabId).toBeNull()
    expect(tab.history[1].resultTabId).toBe(firstResultId)
  })

  it('preserves pinned results while reusing only ordinary completed slots', async () => {
    const tab = makeSqlTab('select 1;')
    let sequence = 0
    const runtime = makeRuntime(tab, async (input) => executionResult(`exec-${++sequence}`, input.sql))

    await runtime.runSql('all')
    const pinnedId = tab.resultTabs[0].id
    runtime.toggleResultTabPinned(pinnedId)
    tab.sql = 'select 2;'
    await runtime.runSql('all')
    const reusableId = tab.resultTabs.find((result) => result.id !== pinnedId)!.id
    tab.sql = 'select 3;'
    await runtime.runSql('all')

    expect(tab.resultTabs).toHaveLength(2)
    expect(tab.resultTabs.find((result) => result.id === pinnedId)).toEqual(
      expect.objectContaining({ sql: 'select 1', pinned: true })
    )
    expect(tab.resultTabs.find((result) => result.id === reusableId)).toEqual(
      expect.objectContaining({ sql: 'select 3', pinned: false })
    )
  })

  it('does not reuse a result slot that is still running', async () => {
    const tab = makeSqlTab('select 1;')
    const first = deferred<DatabaseSqlExecuteResult>()
    const second = deferred<DatabaseSqlExecuteResult>()
    const executeSql = vi
      .fn<(input: DatabaseSqlExecuteInput) => Promise<DatabaseSqlExecuteResult>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const runtime = makeRuntime(tab, executeSql)

    const firstRun = runtime.runSql('all')
    tab.sql = 'select 2;'
    const secondRun = runtime.runSql('all')

    expect(tab.resultTabs).toHaveLength(2)
    expect(tab.resultTabs.map((result) => result.status)).toEqual(['running', 'running'])
    second.resolve(executionResult('exec-2', 'select 2'))
    await secondRun
    first.resolve(executionResult('exec-1', 'select 1'))
    await firstRun

    expect(tab.resultTabs).toHaveLength(2)
    expect(tab.resultTabs.map((result) => result.sql)).toEqual(['select 1', 'select 2'])
  })
})
