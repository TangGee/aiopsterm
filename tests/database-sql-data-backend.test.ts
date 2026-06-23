import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseSqlDataBackend } from '@/services/database/databaseSqlDataBackend'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

const makeBackend = () =>
  createDatabaseSqlDataBackend({
    bridgeErrorMessage: (error, fallback) => (error instanceof Error ? error.message : fallback),
    errorToMessage: (error) => (error instanceof Error ? error.message : String(error))
  })

const commentKey = {
  scope: 'table-page' as const,
  connectionId: 'conn-1',
  databaseName: 'app',
  schemaName: 'public',
  tableName: 'orders'
}

describe('databaseSqlDataBackend', () => {
  it('centralizes SQL/Data bridge unavailable fallbacks', async () => {
    window.aiops = {
      ...originalAiops,
      executeDatabaseSql: undefined as any,
      showSaveDialog: undefined as any,
      writeLocalFile: undefined as any,
      planDatabaseTableMutation: undefined as any,
      mutateDatabaseTable: undefined as any,
      exportDatabaseRows: undefined as any,
      getDatabasePageComment: undefined as any,
      saveDatabasePageComment: undefined as any,
      queryDatabaseTable: undefined as any
    }
    const backend = makeBackend()

    await expect(backend.executeSql({ connectionId: 'conn-1', sql: 'select 1', databaseName: 'app' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE',
      errorMessage: 'Database SQL executor service unavailable'
    })
    await expect(backend.pickSqlSavePath('query.sql')).resolves.toEqual({ ok: false, error: 'SQL save dialog service unavailable' })
    expect(backend.sqlFileWriterUnavailableError()).toBe('SQL file writer service unavailable')
    await expect(backend.saveSqlFile('/tmp/query.sql', 'select 1;')).resolves.toEqual({ ok: false, error: 'SQL file writer service unavailable' })
    await expect(backend.planTableMutation({ connectionId: 'conn-1', databaseName: 'app', tableName: 'orders', mutations: [] })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.mutateTable({ connectionId: 'conn-1', databaseName: 'app', tableName: 'orders', mutations: [] })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.exportRows({ title: 'orders', kind: 'table-page', columns: ['id'], rows: [] })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.getPageComment(commentKey)).resolves.toMatchObject({ ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE' })
    await expect(backend.savePageComment(commentKey, 'hot table')).resolves.toMatchObject({ ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE' })
    await expect(backend.queryTable({ connectionId: 'conn-1', databaseName: 'app', tableName: 'orders', page: 1, pageSize: 100 })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
  })

  it('binds SQL/Data bridge calls and converts thrown bridge errors into envelopes', async () => {
    window.aiops = {
      ...originalAiops,
      executeDatabaseSql: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            columns: ['id'],
            rows: [{ id: 1 }],
            rowCount: 1,
            durationMs: 4,
            execution: { id: 'exec-1', status: 'ok' as const, message: '1 row', durationMs: 4, rowCount: 1, createdAt: '2026-06-22T00:00:00.000Z' }
          }
        })
        .mockRejectedValueOnce(new Error('executor crashed')),
      showSaveDialog: vi.fn().mockResolvedValueOnce({ canceled: false, filePath: '/tmp/query.sql' }).mockRejectedValueOnce(new Error('dialog crashed')),
      writeLocalFile: vi.fn(async () => ({ ok: true, data: { filePath: '/tmp/query.sql', bytes: 9, size: 9, mtimeMs: 1782086400000 } })),
      queryDatabaseTable: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: { columns: ['id'], rows: [{ id: 1 }], rowCount: 1, durationMs: 3, total: 1, knownColumns: ['id'] } })
        .mockRejectedValueOnce(new Error('query crashed'))
    }
    const backend = makeBackend()

    await expect(backend.executeSql({ connectionId: 'conn-1', dbType: 'postgresql', sql: 'select 1', databaseName: 'app', schemaName: 'public' })).resolves.toMatchObject({
      ok: true,
      data: { rowCount: 1 }
    })
    await expect(backend.executeSql({ connectionId: 'conn-1', sql: 'select broken', databaseName: 'app' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_SQL_EXECUTOR_FAILED',
      errorMessage: 'executor crashed'
    })
    await expect(backend.pickSqlSavePath('query.sql')).resolves.toEqual({ ok: true, canceled: false, filePath: '/tmp/query.sql' })
    await expect(backend.pickSqlSavePath('query.sql')).resolves.toEqual({ ok: false, error: 'dialog crashed' })
    await expect(backend.saveSqlFile('/tmp/query.sql', 'select 1;')).resolves.toMatchObject({ ok: true, result: { ok: true } })
    expect(backend.sqlFileWriterUnavailableError()).toBe('')
    await expect(backend.queryTable({ connectionId: 'conn-1', dbType: 'postgresql', databaseName: 'app', schemaName: 'public', tableName: 'orders', page: 1, pageSize: 100 })).resolves.toMatchObject({
      ok: true,
      data: { rowCount: 1 }
    })
    await expect(backend.queryTable({ connectionId: 'conn-1', databaseName: 'app', tableName: 'orders', page: 1, pageSize: 100 })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_TABLE_QUERY_FAILED',
      errorMessage: 'query crashed'
    })
    expect(window.aiops.executeDatabaseSql).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      dbType: 'postgresql',
      sql: 'select 1',
      databaseName: 'app',
      schemaName: 'public'
    })
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'query.sql', filters: [{ name: 'SQL Files', extensions: ['sql'] }] })
    expect(window.aiops.writeLocalFile).toHaveBeenCalledWith('/tmp/query.sql', 'select 1;')
    expect(window.aiops.queryDatabaseTable).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      dbType: 'postgresql',
      databaseName: 'app',
      schemaName: 'public',
      tableName: 'orders',
      page: 1,
      pageSize: 100
    })
  })
})
