import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '@shared/preload'
import {
  cancelDatabaseAiDrawerResponse,
  cancelDatabaseAiPaneResponse,
  connectDatabaseConnection,
  configureDatabaseAiRuntime,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  createDatabaseCatalog,
  createDatabaseGroup,
  deleteDatabaseGroup,
  disconnectDatabaseConnection,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  executeDatabaseSql,
  getDatabaseTableDdl,
  listDatabaseCatalog,
  moveDatabaseConnection,
  moveDatabaseGroup,
  mutateDatabaseTable,
  queryDatabaseTable,
  refreshDatabaseConnection,
  removeDatabaseConnection,
  renameDatabaseGroup,
  resetDatabaseBackendSeed,
  saveDatabaseConnection,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse,
  testDatabaseConnection
} from '@shared/database'

let configureDatabaseBackendRuntime: (config?: {
  getConfig?: () => UserConfig
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}) => void

beforeAll(async () => {
  const modulePath = '../src/main/backend/database'
  const backend = await import(modulePath)
  configureDatabaseBackendRuntime = backend.configureDatabaseBackendRuntime
})

describe('database backend boundary', () => {
  let tempDirs: string[] = []

  const createTempSqliteFile = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-sqlite-'))
    tempDirs.push(dir)
    return join(dir, 'ops-cache.sqlite3')
  }

  beforeEach(() => {
    configureDatabaseBackendRuntime()
    resetDatabaseBackendSeed()
    tempDirs = []
  })

  afterEach(async () => {
    configureDatabaseBackendRuntime()
    vi.restoreAllMocks()
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('validates PostgreSQL drafts and returns backend probe metadata', async () => {
    const result = await testDatabaseConnection({
      dbType: 'postgresql',
      name: 'orders-postgres',
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      database: 'orders',
      sslMode: 'require'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      dbType: 'postgresql',
      serverVersion: 'PostgreSQL 16 local backend validation',
      endpoint: '127.0.0.1:5432'
    })
    expect(result.data?.durationMs).toBeGreaterThan(0)
  })

  it('lists the database workspace catalog through the backend boundary', async () => {
    const result = await listDatabaseCatalog()

    expect(result.ok).toBe(true)
    expect(result.data?.engines).toHaveLength(16)
    expect(result.data?.engines.filter((engine) => engine.enabled).map((engine) => engine.name)).toEqual(['MySQL', 'Oracle', 'PostgreSQL', 'SQLite'])
    expect(result.data?.groups.map((group) => group.name)).toEqual(['Default Group', 'Production', 'Local Lab'])
    expect(result.data?.groupParents).toEqual({
      'group-default': null,
      'group-prod': null,
      'group-local': null
    })
    expect(result.data?.defaults).toMatchObject({
      selectedNodeId: 'conn-prod-pg',
      expandedConnectionIds: ['conn-prod-pg'],
      expandedCatalogIds: ['conn-prod-pg:orders']
    })

    const ordersConnection = result.data?.connections.find((connection) => connection.id === 'conn-prod-pg')
    const publicSchema = ordersConnection?.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')
    const opsSchema = ordersConnection?.catalogs[0]?.schemas?.find((schema) => schema.name === 'ops')
    expect(ordersConnection).toMatchObject({ name: 'orders-postgres', dbType: 'postgresql', status: 'connected' })
    expect(publicSchema?.tables.map((table) => table.name)).toEqual(['orders'])
    expect(publicSchema?.views?.map((table) => table.name)).toEqual(['open_orders_v'])
    expect(opsSchema?.tables.map((table) => table.name)).toEqual(['ops_incidents'])
    expect(opsSchema?.views?.map((table) => table.name)).toEqual(['active_incidents_v'])

    const metricsConnection = result.data?.connections.find((connection) => connection.id === 'conn-metrics-mysql')
    expect(metricsConnection?.catalogs[0]?.tables?.map((table) => table.name)).toEqual(['service_health', 'ops_incidents', 'metric_events'])
  })

  it('persists database sidebar group and connection menu actions behind the backend boundary', async () => {
    const createGroup = await createDatabaseGroup({ name: 'Unit DB Group', parentId: 'group-default' })
    expect(createGroup.ok).toBe(true)
    expect(createGroup.data?.group).toEqual({ id: 'group-unit-db-group', name: 'Unit DB Group' })
    expect(createGroup.data?.groupParents['group-unit-db-group']).toBe('group-default')

    const renameGroup = await renameDatabaseGroup({ id: 'group-unit-db-group', name: 'Renamed DB Group' })
    expect(renameGroup.ok).toBe(true)
    expect(renameGroup.data?.groups.find((group) => group.id === 'group-unit-db-group')?.name).toBe('Renamed DB Group')

    const moveGroup = await moveDatabaseGroup({ id: 'group-unit-db-group', parentId: null })
    expect(moveGroup.ok).toBe(true)
    expect(moveGroup.data?.groupParents['group-unit-db-group']).toBeNull()

    const moveConnection = await moveDatabaseConnection({ connectionId: 'conn-metrics-mysql', groupId: 'group-unit-db-group' })
    expect(moveConnection.ok).toBe(true)
    expect(moveConnection.data?.connection.groupId).toBe('group-unit-db-group')
    expect(moveConnection.data?.connections.find((connection) => connection.id === 'conn-metrics-mysql')?.groupId).toBe('group-unit-db-group')

    const connect = await connectDatabaseConnection('conn-metrics-mysql')
    expect(connect.ok).toBe(true)
    expect(connect.data?.connection.status).toBe('connected')

    const refresh = await refreshDatabaseConnection('conn-metrics-mysql')
    expect(refresh.ok).toBe(true)
    expect(refresh.data?.connection.catalogs[0]?.tables?.map((table) => table.name)).toContain('service_health')

    const disconnect = await disconnectDatabaseConnection('conn-metrics-mysql')
    expect(disconnect.ok).toBe(true)
    expect(disconnect.data?.connection.status).toBe('idle')

    const deleteGroup = await deleteDatabaseGroup('group-unit-db-group')
    expect(deleteGroup.ok).toBe(true)
    expect(deleteGroup.data?.groups.some((group) => group.id === 'group-unit-db-group')).toBe(false)
    expect(deleteGroup.data?.connections.find((connection) => connection.id === 'conn-metrics-mysql')?.groupId).toBe('group-default')

    const removeConnection = await removeDatabaseConnection('conn-metrics-mysql')
    expect(removeConnection.ok).toBe(true)
    expect(removeConnection.data?.connections.some((connection) => connection.id === 'conn-metrics-mysql')).toBe(false)

    const resetCatalog = await listDatabaseCatalog()
    expect(resetCatalog.data?.connections.some((connection) => connection.id === 'conn-metrics-mysql')).toBe(false)
    resetDatabaseBackendSeed()
    const restoredCatalog = await listDatabaseCatalog()
    expect(restoredCatalog.data?.connections.some((connection) => connection.id === 'conn-metrics-mysql')).toBe(true)
  })

  it('rejects invalid SQLite file extensions behind the preload/main boundary', async () => {
    const result = await testDatabaseConnection({
      dbType: 'sqlite',
      name: 'cache',
      filePath: '/tmp/cache.txt',
      readonly: true
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQLITE_EXTENSION',
      errorMessage: 'SQLite file should end with .db, .sqlite, or .sqlite3.'
    })
  })

  it('allows Oracle connect-string-only drafts', async () => {
    const result = await testDatabaseConnection({
      dbType: 'oracle',
      name: 'hr-oracle-url',
      user: 'hr',
      password: 'secret',
      database: 'ORCLPDB1',
      url: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      dbType: 'oracle',
      serverVersion: 'Oracle local backend validation',
      endpoint: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
    })
  })

  it('saves database connections through the backend catalog boundary', async () => {
    const sqliteFilePath = await createTempSqliteFile()
    const sqlite = new Database(sqliteFilePath)
    sqlite.exec('CREATE TABLE cache_entries (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);')
    sqlite.close()

    const createResult = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'unit-sqlite',
        filePath: sqliteFilePath,
        readonly: true,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })

    expect(createResult.ok).toBe(true)
    expect(createResult.data?.connection).toMatchObject({
      id: 'conn-unit-sqlite',
      name: 'unit-sqlite',
      dbType: 'sqlite',
      host: 'local',
      database: 'ops-cache.sqlite3',
      filePath: sqliteFilePath,
      status: 'idle'
    })
    expect(createResult.data?.connection.catalogs).toEqual([
      {
        name: 'main',
        tables: [
          {
            id: 'tbl-conn-unit-sqlite-cache_entries',
            name: 'cache_entries',
            columns: [
              { name: 'key', type: 'TEXT', nullable: false, key: 'PK' },
              { name: 'value', type: 'TEXT', nullable: true },
              { name: 'updated_at', type: 'TEXT', nullable: false }
            ],
            primaryKey: ['key']
          }
        ]
      }
    ])
    expect(createResult.data?.connections.some((connection) => connection.id === 'conn-unit-sqlite')).toBe(true)
    expect(createResult.data?.defaults.selectedNodeId).toBe('conn-unit-sqlite')

    const editResult = await saveDatabaseConnection({
      mode: 'edit',
      id: 'conn-prod-pg',
      connection: {
        dbType: 'postgresql',
        name: 'orders-pg-edited',
        host: '10.32.6.9',
        port: 5432,
        user: 'readonly',
        password: '',
        database: 'orders',
        sslMode: 'require',
        env: 'Production',
        groupId: 'group-prod',
        authentication: 'UserAndPassword'
      }
    })

    expect(editResult.ok).toBe(true)
    expect(editResult.data?.connection).toMatchObject({
      id: 'conn-prod-pg',
      name: 'orders-pg-edited',
      hasPassword: true
    })
    expect(editResult.data?.connection.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')?.tables.map((table) => table.name)).toEqual([
      'orders'
    ])

    resetDatabaseBackendSeed()
    const resetCatalog = await listDatabaseCatalog()
    expect(resetCatalog.data?.connections.some((connection) => connection.id === 'conn-unit-sqlite')).toBe(false)
    expect(resetCatalog.data?.connections.find((connection) => connection.id === 'conn-prod-pg')?.name).toBe('orders-postgres')
  })

  it('creates database catalogs through the backend boundary', async () => {
    const result = await createDatabaseCatalog({
      connectionId: 'conn-metrics-mysql',
      requestedName: 'ops_metrics',
      sql: 'CREATE DATABASE `ops_metrics`;'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.catalog).toEqual({ name: 'ops_metrics', tables: [] })
    expect(result.data?.connection.catalogs.map((catalog) => catalog.name)).toContain('ops_metrics')
    expect(result.data?.defaults.selectedNodeId).toBe('conn-metrics-mysql')
    expect(result.data?.defaults.expandedCatalogIds).toContain('conn-metrics-mysql:ops_metrics')

    const duplicate = await createDatabaseCatalog({
      connectionId: 'conn-metrics-mysql',
      requestedName: 'ops_metrics',
      sql: 'CREATE DATABASE `ops_metrics`;'
    })

    expect(duplicate.ok).toBe(false)
    expect(duplicate.errorCode).toBe('DB_CREATE_DATABASE_DUPLICATE')
  })

  it('executes SELECT statements from the database backend seed data', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      sql: 'select id, service, status from public.orders order by updated_at desc limit 20'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.columns).toEqual(['id', 'service', 'status', 'owner', 'updated_at'])
    expect(result.data?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'payment-api', status: 'investigating' }),
        expect.objectContaining({ service: 'orders-worker', status: 'mitigated' })
      ])
    )
    expect(result.data?.durationMs).toBeGreaterThan(0)
  })

  it('returns backend explain-plan rows without renderer result generation', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      sql: 'EXPLAIN select * from public.orders'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.columns).toEqual(['step', 'operation', 'relation', 'cost', 'rows'])
    expect(result.data?.rows[0]).toMatchObject({ operation: 'Seq Scan', relation: 'orders' })
  })

  it('rejects empty SQL before execution', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      sql: ''
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQL_EMPTY',
      errorMessage: 'SQL is required.'
    })
  })

  it('reports backend SQL rejections as mutation errors', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      sql: 'syntax_error'
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQL_REJECTED',
      errorMessage: 'Backend SQL executor rejected this statement.'
    })
  })

  it('fetches table DDL through the database backend boundary', async () => {
    const result = await getDatabaseTableDdl({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.ddl).toContain('CREATE TABLE public.orders')
  })

  it('executes real SQLite files and refreshes their table catalog through the backend boundary', async () => {
    const sqliteFilePath = await createTempSqliteFile()
    const sqlite = new Database(sqliteFilePath)
    sqlite.exec(`
      CREATE TABLE cache_entries (
        key TEXT PRIMARY KEY,
        value TEXT,
        ttl_seconds INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY,
        service TEXT NOT NULL,
        severity TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO cache_entries (key, value, ttl_seconds, updated_at) VALUES
        ('feature:checkout', 'enabled', 120, '2026-06-03 10:00:00'),
        ('feature:search', 'disabled', 60, '2026-06-03 10:05:00');
      INSERT INTO audit_events (id, service, severity, created_at) VALUES
        (1, 'checkout', 'warning', '2026-06-03 10:10:00'),
        (2, 'search', 'info', '2026-06-03 10:15:00');
    `)
    sqlite.close()

    const probe = await testDatabaseConnection({
      dbType: 'sqlite',
      name: 'real-sqlite',
      filePath: sqliteFilePath,
      readonly: true
    })
    expect(probe.ok).toBe(true)
    expect(probe.data?.serverVersion).toMatch(/^SQLite /)

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'real-sqlite',
        filePath: sqliteFilePath,
        readonly: true,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)
    expect(saved.data?.connection).toMatchObject({
      id: 'conn-real-sqlite',
      dbType: 'sqlite',
      database: 'ops-cache.sqlite3',
      filePath: sqliteFilePath
    })
    expect(saved.data?.connection.catalogs[0]).toMatchObject({
      name: 'main',
      tables: expect.arrayContaining([
        expect.objectContaining({ name: 'audit_events', primaryKey: ['id'] }),
        expect.objectContaining({ name: 'cache_entries', primaryKey: ['key'] })
      ])
    })

    const refreshed = await refreshDatabaseConnection('conn-real-sqlite')
    expect(refreshed.ok).toBe(true)
    expect(refreshed.data?.connection.catalogs[0]?.tables?.map((table) => table.name)).toEqual(['audit_events', 'cache_entries'])

    const result = await executeDatabaseSql({
      connectionId: 'conn-real-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      sql: 'SELECT key, value FROM cache_entries ORDER BY key'
    })
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      columns: ['key', 'value'],
      rowCount: 2,
      rows: [
        { key: 'feature:checkout', value: 'enabled' },
        { key: 'feature:search', value: 'disabled' }
      ]
    })

    const ddl = await getDatabaseTableDdl({
      connectionId: 'conn-real-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      tableName: 'cache_entries'
    })
    expect(ddl.ok).toBe(true)
    expect(ddl.data?.ddl).toContain('CREATE TABLE cache_entries')

    const page = await queryDatabaseTable({
      connectionId: 'conn-real-sqlite',
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
    })
    expect(page.ok).toBe(true)
    expect(page.data).toMatchObject({
      columns: ['key', 'value', 'ttl_seconds', 'updated_at'],
      knownColumns: ['key', 'value', 'ttl_seconds', 'updated_at'],
      rowCount: 1,
      total: 2,
      rows: [expect.objectContaining({ key: 'feature:search', value: 'disabled' })]
    })
  })

  it('applies real SQLite table mutations in a backend transaction', async () => {
    const sqliteFilePath = await createTempSqliteFile()
    const sqlite = new Database(sqliteFilePath)
    sqlite.exec(`
      CREATE TABLE cache_entries (
        key TEXT PRIMARY KEY,
        value TEXT,
        ttl_seconds INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY,
        service TEXT NOT NULL
      );
      INSERT INTO cache_entries (key, value, ttl_seconds, updated_at) VALUES
        ('feature:checkout', 'enabled', 120, '2026-06-03 10:00:00'),
        ('feature:search', 'disabled', 60, '2026-06-03 10:05:00');
    `)
    sqlite.close()

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'mutating-sqlite',
        filePath: sqliteFilePath,
        readonly: false,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const update = await mutateDatabaseTable({
      connectionId: 'conn-mutating-sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      mutations: [
        { kind: 'update', rowKey: JSON.stringify(['feature:checkout']), primaryKey: ['key'], patch: { value: 'rolled-out', ttl_seconds: 300 } },
        { kind: 'insert', values: { key: 'feature:billing', value: 'enabled', ttl_seconds: 45, updated_at: '2026-06-03 11:00:00' } },
        { kind: 'delete', rowKey: JSON.stringify(['feature:search']), primaryKey: ['key'] }
      ]
    })
    expect(update.ok).toBe(true)
    expect(update.data?.affected).toBe(3)

    const rows = await executeDatabaseSql({
      connectionId: 'conn-mutating-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      sql: 'SELECT key, value, ttl_seconds FROM cache_entries ORDER BY key'
    })
    expect(rows.ok).toBe(true)
    expect(rows.data?.rows).toEqual([
      { key: 'feature:billing', value: 'enabled', ttl_seconds: 45 },
      { key: 'feature:checkout', value: 'rolled-out', ttl_seconds: 300 }
    ])

    const failed = await mutateDatabaseTable({
      connectionId: 'conn-mutating-sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      mutations: [
        { kind: 'insert', values: { key: 'feature:rollback', value: 'pending', ttl_seconds: 1, updated_at: '2026-06-03 12:00:00' } },
        { kind: 'insert', values: { key: 'feature:billing', value: 'duplicate', ttl_seconds: 1, updated_at: '2026-06-03 12:01:00' } }
      ]
    })
    expect(failed.ok).toBe(false)
    expect(failed.errorCode).toBe('DB_SQLITE_MUTATION_FAILED')

    const rolledBack = await executeDatabaseSql({
      connectionId: 'conn-mutating-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      sql: "SELECT key FROM cache_entries WHERE key = 'feature:rollback'"
    })
    expect(rolledBack.ok).toBe(true)
    expect(rolledBack.data?.rows).toEqual([])

    const truncate = await mutateDatabaseTable({
      connectionId: 'conn-mutating-sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      mutations: [{ kind: 'truncate' }]
    })
    expect(truncate.ok).toBe(true)
    expect(truncate.data?.affected).toBe(2)

    const empty = await queryDatabaseTable({
      connectionId: 'conn-mutating-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      filters: [],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })
    expect(empty.ok).toBe(true)
    expect(empty.data?.rows).toEqual([])
    expect(empty.data?.total).toBe(0)

    const drop = await mutateDatabaseTable({
      connectionId: 'conn-mutating-sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      mutations: [{ kind: 'drop' }]
    })
    expect(drop.ok).toBe(true)
    expect(drop.data?.catalog?.connections.find((connection) => connection.id === 'conn-mutating-sqlite')?.catalogs[0]?.tables?.map((table) => table.name)).toEqual([
      'audit_events'
    ])

    const dropped = await getDatabaseTableDdl({
      connectionId: 'conn-mutating-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      tableName: 'cache_entries'
    })
    expect(dropped.ok).toBe(false)
    expect(dropped.errorCode).toBe('DB_TABLE_NOT_FOUND')
  })

  it('rejects real SQLite mutations for readonly connections', async () => {
    const sqliteFilePath = await createTempSqliteFile()
    const sqlite = new Database(sqliteFilePath)
    sqlite.exec("CREATE TABLE cache_entries (key TEXT PRIMARY KEY, value TEXT); INSERT INTO cache_entries (key, value) VALUES ('feature:checkout', 'enabled');")
    sqlite.close()

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'readonly-sqlite',
        filePath: sqliteFilePath,
        readonly: true,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const result = await mutateDatabaseTable({
      connectionId: 'conn-readonly-sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      mutations: [{ kind: 'update', rowKey: JSON.stringify(['feature:checkout']), primaryKey: ['key'], patch: { value: 'disabled' } }]
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQLITE_READONLY',
      errorMessage: 'SQLite connection is read-only.'
    })
  })

  it('generates DB AI pane responses behind the database backend boundary', async () => {
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema and generate a SELECT',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      },
      activeSql: 'select * from public.orders;',
      messages: [{ role: 'user', content: 'previous database question' }]
    })

    expect(created.ok).toBe(true)
    expect(created.data?.requestId).toMatch(/^dbai-pane-request-/)
    expect(created.data?.userMessage).toMatchObject({
      requestId: created.data?.requestId,
      role: 'user',
      status: 'done',
      content: 'Summarize schema and generate a SELECT'
    })
    expect(created.data?.assistantMessage).toMatchObject({
      requestId: created.data?.requestId,
      role: 'assistant',
      status: 'queued',
      content: ''
    })

    const startedAt = Date.now()
    const result = await generateDatabaseAiPaneResponse({
      requestId: created.data!.requestId,
      assistantMessageId: created.data!.assistantMessage.id,
      prompt: 'Summarize schema and generate a SELECT',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      },
      activeSql: 'select * from public.orders;',
      messages: [{ role: 'user', content: 'previous database question' }]
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      requestId: created.data?.requestId,
      provider: 'aiopsterm-local',
      assistantMessage: expect.objectContaining({
        id: created.data?.assistantMessage.id,
        requestId: created.data?.requestId,
        status: 'done'
      })
    })
    expect(result.data?.text).toContain('orders-postgres · postgresql · orders · public')
    expect(result.data?.text).toContain('当前响应由 aiopsterm DB AI 本地后端生成')
    expect(result.data?.text).toContain('orders(5 columns)')
    expect(result.data?.text).toContain('FROM "public"."open_orders_v"')
    expect(elapsedMs).toBeGreaterThanOrEqual(475)
  })

  it('calls the configured DB AI provider for non-local pane responses', async () => {
    const generateText = vi.fn(async (input) => {
      expect(input.surface).toBe('pane')
      expect(input.modelName).toBe('ops-db')
      expect(input.systemPrompt).toContain('database-workspace assistant')
      expect(input.systemPrompt).toContain('Current database: orders')
      expect(input.systemPrompt).toContain('orders.public.orders')
      expect(input.messages.at(-1)).toEqual({ role: 'user', content: 'Summarize schema' })
      return {
        ok: true as const,
        provider: 'openai' as const,
        text: 'Provider summary for orders.public.orders.\n\n```sql\nSELECT id, service FROM \"public\".\"orders\" LIMIT 20;\n```'
      }
    })
    configureDatabaseAiRuntime({
      getModelName: () => 'ops-db',
      now: () => 30_000,
      generateText
    })
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    const result = await generateDatabaseAiPaneResponse({
      requestId: created.data!.requestId,
      assistantMessageId: created.data!.assistantMessage.id,
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      },
      messages: [{ role: 'user', content: 'previous database question' }]
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      requestId: created.data!.requestId,
      provider: 'openai',
      text: expect.stringContaining('Provider summary'),
      assistantMessage: {
        id: created.data!.assistantMessage.id,
        status: 'done',
        content: expect.stringContaining('Provider summary')
      },
      durationMs: 1
    })
    expect(result.data?.text).not.toContain('当前响应由 aiopsterm DB AI 本地后端生成')
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('uses the main-process model provider runtime for non-local DB AI pane responses', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Provider-backed DB pane response from OpenAI-compatible runtime.'
              }
            }
          ]
        })
    })) as unknown as typeof fetch
    configureDatabaseBackendRuntime({
      now: () => 35_000,
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'ops-db',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-db', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'http://127.0.0.1:4410',
                apiKey: 'sk-db',
                modelId: 'ops-db',
                apiFormat: 'chat-completions'
              }
            }
          }
        }) as UserConfig
    })
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Explain the active query',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      },
      activeSql: 'select * from public.orders;'
    })

    const result = await generateDatabaseAiPaneResponse({
      requestId: created.data!.requestId,
      assistantMessageId: created.data!.assistantMessage.id,
      prompt: 'Explain the active query',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      },
      activeSql: 'select * from public.orders;'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'openai',
      text: 'Provider-backed DB pane response from OpenAI-compatible runtime.'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4410/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-db' })
      })
    )
    const body = JSON.parse(String((fetchMock as any).mock.calls[0][1].body))
    expect(body.model).toBe('ops-db')
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[0].content).toContain('Current database: orders')
    expect(body.messages[0].content).toContain('orders.public.orders')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Explain the active query' })
  })

  it('returns a backend error when a non-local DB AI pane model has no provider runtime', async () => {
    configureDatabaseAiRuntime({
      getModelName: () => 'ops-db',
      now: () => 40_000
    })
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })
    expect(startDatabaseAiPaneResponse({ requestId: created.data!.requestId, assistantMessageId: created.data!.assistantMessage.id }).data?.assistantMessage).toMatchObject({
      status: 'streaming'
    })

    const result = await generateDatabaseAiPaneResponse({
      requestId: created.data!.requestId,
      assistantMessageId: created.data!.assistantMessage.id,
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('DB_AI_PROVIDER_UNAVAILABLE')
    expect(result.data).toMatchObject({
      provider: 'aiopsterm-local',
      assistantMessage: {
        id: created.data!.assistantMessage.id,
        status: 'error',
        content: 'Database AI provider is unavailable.'
      },
      text: 'Database AI provider is unavailable.'
    })
  })

  it('keeps DB AI pane lifecycle status behind the database backend boundary', async () => {
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(created.ok).toBe(true)
    const requestId = created.data!.requestId
    const assistantMessageId = created.data!.assistantMessage.id

    const started = startDatabaseAiPaneResponse({ requestId, assistantMessageId })
    expect(started.data?.assistantMessage).toMatchObject({ id: assistantMessageId, status: 'streaming' })

    const responsePromise = generateDatabaseAiPaneResponse({
      requestId,
      assistantMessageId,
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    const cancelled = cancelDatabaseAiPaneResponse({ requestId, assistantMessageId })
    expect(cancelled.data?.assistantMessage).toMatchObject({
      id: assistantMessageId,
      status: 'cancelled',
      content: 'Response cancelled before the first chunk.'
    })

    const lateResponse = await responsePromise
    expect(lateResponse.data?.assistantMessage).toMatchObject({
      id: assistantMessageId,
      status: 'cancelled'
    })
    expect(lateResponse.data?.text).not.toContain('当前响应由 aiopsterm DB AI 本地后端生成')
  })

  it('keeps cancelled DB AI pane provider results from overwriting backend state', async () => {
    let resolveProvider: (value: { ok: true; provider: 'openai'; text: string }) => void = () => {}
    const providerPromise = new Promise<{ ok: true; provider: 'openai'; text: string }>((resolve) => {
      resolveProvider = resolve
    })
    const generateText = vi.fn(() => providerPromise)
    configureDatabaseAiRuntime({
      getModelName: () => 'ops-db',
      now: () => 50_000,
      generateText
    })
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })
    const requestId = created.data!.requestId
    const assistantMessageId = created.data!.assistantMessage.id
    expect(startDatabaseAiPaneResponse({ requestId, assistantMessageId }).data?.assistantMessage).toMatchObject({ status: 'streaming' })

    const responsePromise = generateDatabaseAiPaneResponse({
      requestId,
      assistantMessageId,
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })
    expect(cancelDatabaseAiPaneResponse({ requestId, assistantMessageId }).data?.assistantMessage).toMatchObject({
      id: assistantMessageId,
      status: 'cancelled'
    })
    resolveProvider({ ok: true, provider: 'openai', text: 'late provider pane text' })

    const lateResponse = await responsePromise
    expect(lateResponse.ok).toBe(true)
    expect(lateResponse.data).toMatchObject({
      provider: 'openai',
      assistantMessage: {
        id: assistantMessageId,
        status: 'cancelled',
        content: 'Response cancelled before the first chunk.'
      },
      text: 'Response cancelled before the first chunk.'
    })
  })

  it('returns backend-owned DB AI pane error message records', async () => {
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(created.ok).toBe(true)
    const requestId = created.data!.requestId
    const assistantMessageId = created.data!.assistantMessage.id
    expect(startDatabaseAiPaneResponse({ requestId, assistantMessageId }).data?.assistantMessage).toMatchObject({
      id: assistantMessageId,
      status: 'streaming'
    })

    const failed = await generateDatabaseAiPaneResponse({
      requestId,
      assistantMessageId,
      prompt: '',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(failed.ok).toBe(false)
    expect(failed.errorCode).toBe('DB_AI_PROMPT_REQUIRED')
    expect(failed.data).toMatchObject({
      requestId,
      provider: 'aiopsterm-local',
      assistantMessage: {
        id: assistantMessageId,
        requestId,
        status: 'error',
        content: 'Prompt is required.'
      },
      text: 'Prompt is required.'
    })
  })

  it('generates DB AI drawer SQL behind the database backend boundary', async () => {
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders" where status = \'open\'',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      }
    })

    expect(created.ok).toBe(true)
    expect(created.data).toMatchObject({
      id: expect.stringMatching(/^dbai-drawer-request-/),
      action: 'convert',
      label: 'Convert SQL',
      status: 'queued',
      contextSummary: 'orders-postgres · postgresql · orders · public',
      sourceSql: 'select id from "public"."orders" where status = \'open\'',
      text: '',
      targetDialect: 'mssql',
      backendContext: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      }
    })

    const startedAt = Date.now()
    const result = await generateDatabaseAiDrawerResponse({
      action: created.data!.action,
      sourceSql: created.data!.sourceSql,
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'aiopsterm-local',
      sql: expect.stringContaining('SELECT TOP (100)')
    })
    expect(result.data?.sql).toContain('[public].[orders]')
    expect(result.data?.reasoning).toContain('aiopsterm DB AI 本地后端生成')
    expect(result.data?.text).toContain('```sql')
    expect(elapsedMs).toBeGreaterThanOrEqual(240)
  })

  it('calls the configured DB AI provider for non-local drawer responses', async () => {
    const generateText = vi.fn(async (input) => {
      expect(input.surface).toBe('drawer')
      expect(input.modelName).toBe('ops-db')
      expect(input.action).toBe('convert')
      expect(input.targetDialect).toBe('mssql')
      expect(input.systemPrompt).toContain('exactly one fenced SQL block')
      expect(input.messages[0].content).toContain('Source SQL')
      return {
        ok: true as const,
        provider: 'openai' as const,
        text: `Reasoning
- Converted quoting for SQL Server.

\`\`\`sql
SELECT TOP (20) id
FROM [public].[orders]
WHERE status = ''open'';
\`\`\``
      }
    })
    configureDatabaseAiRuntime({
      getModelName: () => 'ops-db',
      now: () => 60_000,
      generateText
    })
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders" where status = \'open\'',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      }
    })

    const result = await generateDatabaseAiDrawerResponse({
      requestId: created.data!.id,
      action: created.data!.action,
      sourceSql: created.data!.sourceSql,
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'openai',
      reasoning: expect.stringContaining('Converted quoting'),
      sql: "SELECT TOP (20) id\nFROM [public].[orders]\nWHERE status = ''open'';",
      request: {
        id: created.data!.id,
        status: 'done',
        text: expect.stringContaining('```sql')
      },
      durationMs: 1
    })
    expect(result.data?.reasoning).not.toContain('aiopsterm DB AI 本地后端生成')
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('rejects provider drawer responses that omit fenced SQL', async () => {
    configureDatabaseAiRuntime({
      getModelName: () => 'ops-db',
      now: () => 70_000,
      generateText: vi.fn(async () => ({
        ok: true as const,
        provider: 'openai' as const,
        text: 'Reasoning only, no SQL block.'
      }))
    })
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders"',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })
    expect(startDatabaseAiDrawerResponse({ requestId: created.data!.id }).data).toMatchObject({ status: 'streaming' })

    const result = await generateDatabaseAiDrawerResponse({
      requestId: created.data!.id,
      action: created.data!.action,
      sourceSql: created.data!.sourceSql,
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('DB_AI_PROVIDER_SQL_MISSING')
    expect(result.data).toMatchObject({
      provider: 'openai',
      request: {
        id: created.data!.id,
        status: 'error',
        text: expect.stringContaining('fenced SQL block')
      },
      sql: ''
    })
  })

  it('keeps DB AI drawer lifecycle status behind the database backend boundary', async () => {
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders"',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      }
    })

    expect(created.ok).toBe(true)
    const requestId = created.data!.id
    expect(startDatabaseAiDrawerResponse({ requestId }).data).toMatchObject({ id: requestId, status: 'streaming' })

    const responsePromise = generateDatabaseAiDrawerResponse({
      requestId,
      action: created.data!.action,
      sourceSql: created.data!.sourceSql,
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })

    expect(cancelDatabaseAiDrawerResponse({ requestId }).data).toMatchObject({ id: requestId, status: 'cancelled' })

    const lateResponse = await responsePromise
    expect(lateResponse.data?.request).toMatchObject({ id: requestId, status: 'cancelled' })
    expect(lateResponse.data?.text).toBe('')
    expect(lateResponse.data?.sql).toBe('')
  })

  it('keeps cancelled DB AI drawer provider results from overwriting backend state', async () => {
    let resolveProvider: (value: { ok: true; provider: 'openai'; text: string }) => void = () => {}
    const providerPromise = new Promise<{ ok: true; provider: 'openai'; text: string }>((resolve) => {
      resolveProvider = resolve
    })
    configureDatabaseAiRuntime({
      getModelName: () => 'ops-db',
      now: () => 80_000,
      generateText: vi.fn(() => providerPromise)
    })
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders"',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })
    const requestId = created.data!.id
    expect(startDatabaseAiDrawerResponse({ requestId }).data).toMatchObject({ status: 'streaming' })

    const responsePromise = generateDatabaseAiDrawerResponse({
      requestId,
      action: created.data!.action,
      sourceSql: created.data!.sourceSql,
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })
    expect(cancelDatabaseAiDrawerResponse({ requestId }).data).toMatchObject({ id: requestId, status: 'cancelled' })
    resolveProvider({
      ok: true,
      provider: 'openai',
      text: 'Reasoning\n- late result\n\n```sql\nSELECT 1;\n```'
    })

    const lateResponse = await responsePromise
    expect(lateResponse.ok).toBe(true)
    expect(lateResponse.data).toMatchObject({
      provider: 'openai',
      request: {
        id: requestId,
        status: 'cancelled',
        text: ''
      },
      reasoning: '',
      sql: ''
    })
  })

  it('returns backend-owned DB AI drawer error request records', async () => {
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders"',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(created.ok).toBe(true)
    const requestId = created.data!.id
    expect(startDatabaseAiDrawerResponse({ requestId }).data).toMatchObject({ id: requestId, status: 'streaming' })

    const failed = await generateDatabaseAiDrawerResponse({
      requestId,
      action: created.data!.action,
      sourceSql: '',
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })

    expect(failed.ok).toBe(false)
    expect(failed.errorCode).toBe('DB_AI_SQL_REQUIRED')
    expect(failed.data).toMatchObject({
      request: {
        id: requestId,
        status: 'error',
        text: expect.stringContaining('SQL is required.')
      },
      reasoning: expect.stringContaining('SQL is required.'),
      sql: '',
      provider: 'aiopsterm-local'
    })
  })

  it('completes drawer SQL from the supplied cursor prefix', async () => {
    const result = await generateDatabaseAiDrawerResponse({
      action: 'complete',
      sourceSql: 'select id from public.orders where',
      targetDialect: 'postgresql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data?.sql).toContain("where status = 'open'")
    expect(result.data?.sql).toContain('LIMIT 100')
  })

  it('diagnoses SQL errors through the drawer backend without renderer SQL generation', async () => {
    const result = await generateDatabaseAiDrawerResponse({
      action: 'diagnose',
      sourceSql: 'select * from public.orders_missing',
      targetDialect: 'postgresql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      },
      errorMessage: 'relation does not exist'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.sql).toBe('SELECT *\nFROM "public"."orders"\nLIMIT 100;')
    expect(result.data?.reasoning).toContain('Diagnosis input error')
  })

  it('preserves DDL permission errors from the backend boundary', async () => {
    const result = await getDatabaseTableDdl({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'open_orders_v'
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'permission',
      errorMessage: 'DDL requires elevated catalog permission.'
    })
  })

  it('queries table rows with backend filters, paging metadata, and totals', async () => {
    const result = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [],
      sort: null,
      whereRaw: "status = 'investigating'",
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(result.ok).toBe(true)
    expect(result.data?.columns).toEqual(['id', 'service', 'status', 'owner', 'updated_at'])
    expect(result.data?.rows).toEqual([expect.objectContaining({ id: 1001, service: 'payment-api', status: 'investigating' })])
    expect(result.data?.rowCount).toBe(1)
    expect(result.data?.total).toBe(1)
    expect(result.data?.knownColumns).toEqual(['id', 'service', 'status', 'owner', 'updated_at'])
  })

  it('applies table mutations through backend state and supports truncate/drop', async () => {
    const updateResult = await mutateDatabaseTable({
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'update', rowKey: JSON.stringify([1001]), primaryKey: ['id'], patch: { owner: 'dba-oncall' } }]
    })

    expect(updateResult.ok).toBe(true)
    expect(updateResult.data?.affected).toBe(1)

    const updatedRows = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [{ column: 'id', operator: 'eq', value: '1001' }],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(updatedRows.ok).toBe(true)
    expect(updatedRows.data?.rows[0]).toMatchObject({ id: 1001, owner: 'dba-oncall' })

    const truncateResult = await mutateDatabaseTable({
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'truncate' }]
    })

    expect(truncateResult.ok).toBe(true)
    expect(truncateResult.data?.affected).toBe(4)

    const emptyRows = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(emptyRows.ok).toBe(true)
    expect(emptyRows.data?.rows).toEqual([])
    expect(emptyRows.data?.total).toBe(0)

    const dropResult = await mutateDatabaseTable({
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'drop' }]
    })

    expect(dropResult.ok).toBe(true)
    expect(dropResult.data?.affected).toBe(0)
    const mutationPublicSchema = dropResult.data?.catalog?.connections
      .find((connection) => connection.id === 'conn-prod-pg')
      ?.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')
    expect(mutationPublicSchema?.tables.some((table) => table.name === 'orders')).toBe(false)
    expect(mutationPublicSchema?.views?.some((table) => table.name === 'open_orders_v')).toBe(true)

    const droppedRows = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(droppedRows.ok).toBe(false)
    expect(droppedRows.errorCode).toBe('DB_TABLE_NOT_FOUND')

    const droppedDdl = await getDatabaseTableDdl({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(droppedDdl.ok).toBe(false)
    expect(droppedDdl.errorCode).toBe('DB_TABLE_NOT_FOUND')

    const catalogAfterDrop = await listDatabaseCatalog()
    const publicSchema = catalogAfterDrop.data?.connections
      .find((connection) => connection.id === 'conn-prod-pg')
      ?.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')
    expect(catalogAfterDrop.ok).toBe(true)
    expect(publicSchema?.tables.some((table) => table.name === 'orders')).toBe(false)
    expect(publicSchema?.views?.some((table) => table.name === 'open_orders_v')).toBe(true)
  })
})
