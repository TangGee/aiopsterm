import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnectionInfo, DatabaseWorkspaceCatalog } from '../src/shared/contracts/database'

const executeSqliteStatementInWorker = vi.fn()
const executeSqliteTransactionInWorker = vi.fn()
const executeSqliteGuardedTableQueryInWorker = vi.fn()
const loadSqliteCatalogsInWorker = vi.fn()

vi.mock('../src/shared/databaseSqliteWorkerRuntime', () => ({
  executeSqliteGuardedTableQueryInWorker,
  executeSqliteStatementInWorker,
  executeSqliteTransactionInWorker,
  loadSqliteCatalogsInWorker
}))

const loadRuntime = async () => import('../src/shared/databaseSqliteRuntime')
const loadConnectionTestRuntime = async () => import('../src/shared/databaseConnectionTestRuntime')

const sqliteConnection = (filePath: string): DatabaseConnectionInfo => ({
  id: 'conn-worker-sqlite',
  name: 'worker-sqlite',
  dbType: 'sqlite',
  host: 'local',
  port: null,
  user: '',
  database: 'worker.sqlite3',
  filePath,
  readonly: false,
  url: `sqlite://${filePath}`,
  env: 'Development',
  groupId: 'group-local',
  authentication: 'UserAndPassword',
  status: 'connected',
  catalogs: []
})

const sqliteColumnRows = [
  { cid: 0, name: 'key', type: 'TEXT', notnull: 0, pk: 1, hidden: 0 },
  { cid: 1, name: 'value', type: 'TEXT', notnull: 0, pk: 0, hidden: 0 },
  { cid: 2, name: 'ttl_seconds', type: 'INTEGER', notnull: 0, pk: 0, hidden: 0 }
]

describe('databaseSqliteRuntime worker delegation', () => {
  beforeEach(() => {
    executeSqliteStatementInWorker.mockReset()
    executeSqliteTransactionInWorker.mockReset()
    executeSqliteGuardedTableQueryInWorker.mockReset()
    loadSqliteCatalogsInWorker.mockReset()
  })

  it('delegates strict reads to the atomic worker guard and rejects a stale view before a data statement runs', async () => {
    const { sqliteQueryTable } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-sqlite-worker-guard-'))
    const filePath = join(root, 'worker.sqlite3')
    await writeFile(filePath, 'sqlite fixture placeholder', 'utf-8')
    executeSqliteStatementInWorker.mockResolvedValue({ reader: true, columns: [], rows: sqliteColumnRows, truncated: false })
    executeSqliteGuardedTableQueryInWorker.mockRejectedValue(
      Object.assign(new Error('Stable SQLite reads are limited to base tables.'), { code: 'DB_TABLE_QUERY_UNSUPPORTED' })
    )

    try {
      const result = await sqliteQueryTable(
        sqliteConnection(filePath),
        {
          connectionId: 'conn-worker-sqlite',
          dbType: 'sqlite',
          databaseName: 'main',
          tableName: 'cache_entries',
          page: 1,
          pageSize: 20,
          withTotal: false,
          requireStableBaseTable: true
        },
        Date.now()
      )

      expect(result).toMatchObject({ ok: false, errorCode: 'DB_TABLE_QUERY_UNSUPPORTED' })
      expect(executeSqliteGuardedTableQueryInWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath,
          schemaName: 'main',
          tableName: 'cache_entries',
          rowStatement: expect.objectContaining({ sql: expect.stringMatching(/^SELECT .* FROM "main"\."cache_entries"/) })
        })
      )
      expect(executeSqliteStatementInWorker).toHaveBeenCalledTimes(1)
      expect(executeSqliteStatementInWorker.mock.calls.some(([input]) => /^SELECT .* FROM "main"\."cache_entries"/.test(input.sql))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('queries SQLite table pages through the worker boundary', async () => {
    const { sqliteQueryTable } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-sqlite-worker-query-'))
    const filePath = join(root, 'worker.sqlite3')
    await writeFile(filePath, 'sqlite fixture placeholder', 'utf-8')
    let resolveRows: (value: unknown) => void = () => undefined
    executeSqliteStatementInWorker.mockImplementation((input: { sql: string }) => {
      if (input.sql.startsWith('PRAGMA')) {
        return Promise.resolve({ reader: true, columns: [], rows: sqliteColumnRows, truncated: false })
      }
      if (input.sql.startsWith('SELECT "key", "value", "ttl_seconds"')) {
        return new Promise((resolve) => {
          resolveRows = resolve
        })
      }
      if (input.sql.startsWith('SELECT COUNT')) {
        return Promise.resolve({ reader: true, columns: ['total'], rows: [{ total: 2 }], truncated: false })
      }
      throw new Error(`unexpected SQL: ${input.sql}`)
    })

    try {
      const query = sqliteQueryTable(
        sqliteConnection(filePath),
        {
          connectionId: 'conn-worker-sqlite',
          dbType: 'sqlite',
          databaseName: 'main',
          tableName: 'cache_entries',
          filters: [{ column: 'value', operator: 'like', value: 'abled' }],
          sort: { column: 'key', direction: 'desc' },
          whereRaw: null,
          orderByRaw: null,
          page: 1,
          pageSize: 1,
          withTotal: true
        },
        Date.now()
      )
      await vi.waitFor(() => {
        expect(executeSqliteStatementInWorker).toHaveBeenCalledWith(
          expect.objectContaining({
            sql: 'SELECT "key", "value", "ttl_seconds" FROM "main"."cache_entries" WHERE "value" LIKE ? ORDER BY "key" DESC LIMIT ? OFFSET ?',
            params: ['%abled%', 1, 0]
          })
        )
      })

      let settled = false
      query.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      resolveRows({ reader: true, columns: ['key', 'value', 'ttl_seconds'], rows: [{ key: 'feature:search', value: 'disabled', ttl_seconds: 60 }], truncated: false })
      await expect(query).resolves.toMatchObject({
        ok: true,
        data: {
          columns: ['key', 'value', 'ttl_seconds'],
          knownColumns: ['key', 'value', 'ttl_seconds'],
          total: 2,
          rows: [{ key: 'feature:search', value: 'disabled', ttl_seconds: 60 }]
        }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tests SQLite connections through the worker boundary', async () => {
    const { testDatabaseConnectionRuntime } = await loadConnectionTestRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-sqlite-worker-probe-'))
    const filePath = join(root, 'worker.sqlite3')
    await writeFile(filePath, 'sqlite fixture placeholder', 'utf-8')
    executeSqliteStatementInWorker.mockResolvedValue({ reader: true, columns: ['version'], rows: [{ version: '3.46.0' }], truncated: false })

    try {
      const result = await testDatabaseConnectionRuntime(
        {
          dbType: 'sqlite',
          name: 'worker-sqlite',
          filePath,
          readonly: true
        },
        { shouldUseSeedData: () => false }
      )

      expect(result).toMatchObject({
        ok: true,
        data: {
          dbType: 'sqlite',
          serverVersion: 'SQLite 3.46.0',
          endpoint: filePath
        }
      })
      expect(executeSqliteStatementInWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath,
          readonly: true,
          sql: 'SELECT sqlite_version() AS version',
          maxRows: 1
        })
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('applies SQLite table mutations in a worker transaction and refreshes catalog metadata asynchronously', async () => {
    const { configureDatabaseSqliteRuntime, sqliteMutateTable } = await loadRuntime()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-sqlite-worker-mutate-'))
    const filePath = join(root, 'worker.sqlite3')
    await writeFile(filePath, 'sqlite fixture placeholder', 'utf-8')
    const refreshedCatalog = [{ name: 'main', tables: [{ id: 'tbl-conn-worker-sqlite-cache_entries', name: 'cache_entries', columns: [], primaryKey: [] }] }]
    const refreshed: Array<{ connectionId: string; catalogCount: number }> = []
    executeSqliteStatementInWorker.mockResolvedValue({ reader: true, columns: [], rows: sqliteColumnRows, truncated: false })
    executeSqliteTransactionInWorker.mockResolvedValue({ changes: 2 })
    loadSqliteCatalogsInWorker.mockResolvedValue(refreshedCatalog)
    configureDatabaseSqliteRuntime({
      refreshConnectionCatalog: (connectionId, catalogs) => refreshed.push({ connectionId, catalogCount: catalogs.length }),
      workspaceCatalogFor: (selectedConnectionId): DatabaseWorkspaceCatalog => ({
        engines: [],
        groups: [],
        groupParents: {},
        connections: [{ ...sqliteConnection(filePath), catalogs: refreshedCatalog }],
        defaults: {
          selectedNodeId: selectedConnectionId || 'conn-worker-sqlite',
          expandedGroupIds: [],
          expandedConnectionIds: [],
          expandedCatalogIds: [],
          expandedSchemaIds: [],
          expandedSchemaObjectFolderIds: []
        }
      })
    })

    try {
      const result = await sqliteMutateTable(
        sqliteConnection(filePath),
        {
          connectionId: 'conn-worker-sqlite',
          databaseName: 'main',
          tableName: 'cache_entries',
          mutations: [
            { kind: 'update', rowKey: JSON.stringify(['feature:checkout']), primaryKey: ['key'], patch: { value: 'enabled' } },
            { kind: 'insert', values: { key: 'feature:billing', value: 'enabled', ttl_seconds: 45 } }
          ]
        },
        Date.now()
      )

      expect(result.ok).toBe(true)
      expect(result.data?.affected).toBe(2)
      expect(executeSqliteTransactionInWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath,
          statements: [
            expect.objectContaining({ sql: 'UPDATE "main"."cache_entries" SET "value" = ? WHERE "key" = ?', params: ['enabled', 'feature:checkout'] }),
            expect.objectContaining({ sql: 'INSERT INTO "main"."cache_entries" ("key", "value", "ttl_seconds") VALUES (?, ?, ?)', params: ['feature:billing', 'enabled', 45] })
          ]
        })
      )
      expect(loadSqliteCatalogsInWorker).toHaveBeenCalledWith(expect.objectContaining({ filePath, connectionId: 'conn-worker-sqlite' }))
      expect(refreshed).toEqual([{ connectionId: 'conn-worker-sqlite', catalogCount: 1 }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
