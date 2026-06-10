import { mkdtemp, readFile, rm } from 'fs/promises'
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
  configureDatabaseRuntime,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  createDatabaseCatalog,
  createDatabaseGroup,
  deleteDatabaseGroup,
  diagnoseDatabaseSqlError,
  disconnectDatabaseConnection,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  executeDatabaseSql,
  getDatabaseAiPaneState,
  getDatabaseTableDdl,
  listDatabaseCatalog,
  moveDatabaseConnection,
  moveDatabaseGroup,
  mutateDatabaseTable,
  planDatabaseTableMutation,
  queryDatabaseTable,
  refreshDatabaseConnection,
  removeDatabaseConnection,
  renameDatabaseGroup,
  resetDatabaseBackendSeed,
  saveDatabaseAiPaneState,
  saveDatabaseConnection,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse,
  testDatabaseConnection
} from '@shared/database'

const fieldsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {}).map((name) => ({ name }))

const createPostgresDriverDouble = () => {
  const state = {
    connected: 0,
    closed: 0,
    configs: [] as Array<Record<string, unknown>>,
    createdDatabases: [] as string[],
    ordersDropped: false,
    rows: [
      { id: 1, service: 'live-api', status: 'open', owner: 'nina', updated_at: '2026-06-09 10:00:00' },
      { id: 2, service: 'live-worker', status: 'closed', owner: 'omar', updated_at: '2026-06-09 09:00:00' }
    ] as Array<Record<string, unknown>>
  }
  class Client {
    readonly config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
      state.configs.push({ ...config })
    }

    async connect() {
      state.connected += 1
    }

    async end() {
      state.closed += 1
    }

    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      const rowsFor = (rows: Array<Record<string, unknown>>, rowCount = rows.length) => ({ rows: rows as T[], fields: fieldsForRows(rows), rowCount })

      if (normalized.startsWith('select version()')) return rowsFor([{ version: 'PostgreSQL 16.9 live-driver' }])
      if (normalized.startsWith('select schema_name from information_schema.schemata')) return rowsFor([{ schema_name: 'public' }])
      if (normalized.includes('from information_schema.tables')) {
        return rowsFor(state.ordersDropped ? [] : [{ table_schema: 'public', table_name: 'orders', table_type: 'BASE TABLE' }])
      }
      if (normalized.includes('from information_schema.columns')) {
        if (state.ordersDropped) return rowsFor([])
        return rowsFor([
          { table_schema: 'public', table_name: 'orders', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
          { table_schema: 'public', table_name: 'orders', column_name: 'service', data_type: 'text', is_nullable: 'NO' },
          { table_schema: 'public', table_name: 'orders', column_name: 'status', data_type: 'text', is_nullable: 'NO' },
          { table_schema: 'public', table_name: 'orders', column_name: 'owner', data_type: 'text', is_nullable: 'YES' },
          { table_schema: 'public', table_name: 'orders', column_name: 'updated_at', data_type: 'timestamp without time zone', is_nullable: 'NO' }
        ])
      }
      if (normalized.includes('from information_schema.table_constraints')) return rowsFor(state.ordersDropped ? [] : [{ table_schema: 'public', table_name: 'orders', column_name: 'id' }])
      if (normalized.includes('from information_schema.routines')) return rowsFor([])
      if (normalized.startsWith('select pg_get_viewdef')) return rowsFor([])
      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') return rowsFor([], 0)
      if (normalized.startsWith('create database')) {
        state.createdDatabases.push(String(sql.match(/"([^"]+)"/)?.[1] || 'unknown'))
        return rowsFor([], 0)
      }
      if (normalized.startsWith('update ')) {
        const owner = params[0]
        const id = params[1]
        const row = state.rows.find((item) => item.id === id)
        if (row) row.owner = owner
        return rowsFor([], row ? 1 : 0)
      }
      if (normalized.startsWith('insert ')) {
        const next = { id: params[0], service: params[1], status: params[2], owner: params[3], updated_at: params[4] }
        state.rows.push(next)
        return rowsFor([], 1)
      }
      if (normalized.startsWith('delete ')) {
        const id = params[0]
        const before = state.rows.length
        state.rows = state.rows.filter((row) => row.id !== id)
        return rowsFor([], before - state.rows.length)
      }
      if (normalized.startsWith('truncate ')) {
        const affected = state.rows.length
        state.rows = []
        return rowsFor([], affected)
      }
      if (normalized.startsWith('drop table')) {
        state.ordersDropped = true
        return rowsFor([], 0)
      }
      if (normalized.startsWith('select count(*)')) {
        const status = params[0]
        const total = status ? state.rows.filter((row) => row.status === status).length : state.rows.length
        return rowsFor([{ total }])
      }
      if (normalized.startsWith('select') && normalized.includes('orders')) {
        let rows = state.rows
        if (params.length && typeof params[0] === 'string') rows = rows.filter((row) => row.status === params[0])
        return rowsFor(rows.map((row) => ({ ...row })))
      }
      throw Object.assign(new Error(`unexpected postgres query: ${sql}`), { code: 'PG_FAKE_UNHANDLED' })
    }
  }
  return { driver: { Client }, state }
}

const createMysqlDriverDouble = () => {
  const state = {
    connected: 0,
    closed: 0,
    configs: [] as Array<Record<string, unknown>>,
    rows: [
      { id: 1, service: 'gateway', region: 'shanghai', latency_ms: 22, healthy: 1 },
      { id: 2, service: 'worker', region: 'hangzhou', latency_ms: 61, healthy: 1 }
    ] as Array<Record<string, unknown>>
  }
  return {
    driver: {
      async createConnection(config: Record<string, unknown>) {
        state.connected += 1
        state.configs.push({ ...config })
        return {
          async query<T = unknown>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
            const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
            const rowsFor = (rows: Array<Record<string, unknown>>, fields = fieldsForRows(rows)) => [rows as T, fields] as [T, unknown]
            if (normalized.startsWith('select version()')) return rowsFor([{ version: '8.4.0-live-driver' }])
            if (normalized.includes('from information_schema.schemata')) return rowsFor([{ SCHEMA_NAME: 'metrics' }])
            if (normalized.includes('from information_schema.tables')) return rowsFor([{ TABLE_NAME: 'service_health', TABLE_TYPE: 'BASE TABLE' }])
            if (normalized.includes('from information_schema.columns')) {
              return rowsFor([
                { TABLE_NAME: 'service_health', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI' },
                { TABLE_NAME: 'service_health', COLUMN_NAME: 'service', COLUMN_TYPE: 'varchar(80)', IS_NULLABLE: 'NO', COLUMN_KEY: '' },
                { TABLE_NAME: 'service_health', COLUMN_NAME: 'region', COLUMN_TYPE: 'varchar(32)', IS_NULLABLE: 'NO', COLUMN_KEY: '' },
                { TABLE_NAME: 'service_health', COLUMN_NAME: 'latency_ms', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: '' },
                { TABLE_NAME: 'service_health', COLUMN_NAME: 'healthy', COLUMN_TYPE: 'tinyint', IS_NULLABLE: 'NO', COLUMN_KEY: '' }
              ])
            }
            if (normalized.startsWith('show create table')) {
              return rowsFor([{ Table: 'service_health', 'Create Table': 'CREATE TABLE `service_health` (`id` int PRIMARY KEY)' }])
            }
            if (normalized.startsWith('select count(*)')) return rowsFor([{ total: state.rows.length }])
            if (normalized.startsWith('select') && normalized.includes('service_health')) return rowsFor(state.rows.map((row) => ({ ...row })))
            if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') return [{ affectedRows: 0 } as T, []]
            throw Object.assign(new Error(`unexpected mysql query: ${sql}`), { code: 'MYSQL_FAKE_UNHANDLED' })
          },
          async end() {
            state.closed += 1
          },
          destroy() {
            state.closed += 1
          }
        }
      }
    },
    state
  }
}

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

  it('plans real SQLite table mutations without executing them', async () => {
    const sqliteFilePath = await createTempSqliteFile()
    const sqlite = new Database(sqliteFilePath)
    sqlite.exec(`
      CREATE TABLE cache_entries (
        key TEXT PRIMARY KEY,
        value TEXT,
        ttl_seconds INTEGER,
        updated_at TEXT NOT NULL
      );
      INSERT INTO cache_entries (key, value, ttl_seconds, updated_at)
      VALUES ('feature:checkout', 'enabled', 120, '2026-06-03 10:00:00');
    `)
    sqlite.close()

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'planning-sqlite',
        filePath: sqliteFilePath,
        readonly: false,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const plan = await planDatabaseTableMutation({
      connectionId: 'conn-planning-sqlite',
      dbType: 'sqlite',
      databaseName: 'main',
      tableName: 'cache_entries',
      mutations: [
        { kind: 'update', rowKey: JSON.stringify(['feature:checkout']), primaryKey: ['key'], patch: { value: 'planned-only' } },
        { kind: 'insert', values: { key: 'feature:billing', value: 'enabled', ttl_seconds: 45, updated_at: '2026-06-03 11:00:00' } }
      ]
    })
    expect(plan.ok).toBe(true)
    expect(plan.data?.statementCount).toBe(2)
    expect(plan.data?.preview).toContain('UPDATE "main"."cache_entries" SET "value" = \'planned-only\' WHERE "key" = \'feature:checkout\';')
    expect(plan.data?.preview).toContain('INSERT INTO "main"."cache_entries"')

    const rows = await queryDatabaseTable({
      connectionId: 'conn-planning-sqlite',
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
    expect(rows.ok).toBe(true)
    expect(rows.data?.rows).toEqual([{ key: 'feature:checkout', value: 'enabled', ttl_seconds: 120, updated_at: '2026-06-03 10:00:00' }])
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

  it('keeps DB AI pane state behind the database backend boundary', () => {
    expect(getDatabaseAiPaneState()).toEqual({
      ok: true,
      data: {
        open: false,
        width: 360,
        context: {
          connectionId: '',
          catalogName: '',
          schemaName: '',
          dbType: ''
        },
        draft: '',
        messages: []
      }
    })

    const saved = saveDatabaseAiPaneState({
      open: true,
      width: 999,
      context: {
        connectionId: ' conn-prod-pg ',
        catalogName: ' orders ',
        schemaName: ' public ',
        dbType: 'postgresql'
      },
      draft: ' explain this schema ',
      messages: [
        {
          id: 'pane-user-1',
          requestId: 'pane-req-1',
          role: 'user',
          status: 'done',
          content: 'Explain',
          contextSummary: 'orders-postgres · postgresql · orders · public',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000
        },
        {
          id: 'pane-assistant-1',
          requestId: 'pane-req-1',
          role: 'assistant',
          status: 'streaming',
          content: '',
          contextSummary: 'orders-postgres · postgresql · orders · public',
          createdAt: 1_700_000_000_001,
          updatedAt: 1_700_000_000_001
        }
      ]
    })

    expect(saved.data).toMatchObject({
      open: true,
      width: 720,
      context: {
        connectionId: 'conn-prod-pg',
        catalogName: 'orders',
        schemaName: 'public',
        dbType: 'postgresql'
      },
      draft: ' explain this schema '
    })
    expect(saved.data?.messages).toHaveLength(2)
    expect(saved.data?.messages[1]).toMatchObject({
      id: 'pane-assistant-1',
      status: 'cancelled'
    })

    saved.data!.messages[0].content = 'mutated outside backend'
    expect(getDatabaseAiPaneState().data?.messages[0].content).toBe('Explain')
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

  it('diagnoses SQL errors through a dedicated backend lifecycle boundary', async () => {
    const result = await diagnoseDatabaseSqlError({
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
    expect(result.data?.request).toMatchObject({
      id: expect.stringMatching(/^dbai-drawer-request-/),
      action: 'diagnose',
      label: 'Diagnose SQL',
      status: 'done',
      sourceSql: 'select * from public.orders_missing',
      targetDialect: 'postgresql',
      backendContext: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      }
    })
    expect(result.data?.sql).toBe('SELECT *\nFROM "public"."orders"\nLIMIT 100;')
    expect(result.data?.reasoning).toContain('Diagnosis input error')
    expect(result.data?.text).toContain('```sql')
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

  it('plans table mutation SQL through the backend boundary', async () => {
    const plan = await planDatabaseTableMutation({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [
        { kind: 'delete', rowKey: JSON.stringify([1002]), primaryKey: ['id'], originalRow: { id: 1002, service: 'orders-worker' } },
        { kind: 'update', rowKey: JSON.stringify([1001]), primaryKey: ['id'], patch: { owner: 'dba-oncall' }, originalRow: { id: 1001, owner: 'alice' } },
        { kind: 'insert', values: { id: 1005, service: 'scheduler', status: 'open', owner: 'erin', updated_at: '2026-06-03 12:00:00' } }
      ]
    })

    expect(plan.ok).toBe(true)
    expect(plan.data?.statementCount).toBe(3)
    expect(plan.data?.warning).toBe('')
    expect(plan.data?.preview).toContain('DELETE FROM "public"."orders" WHERE "id" = 1002;')
    expect(plan.data?.preview).toContain('UPDATE "public"."orders" SET "owner" = \'dba-oncall\' WHERE "id" = 1001;')
    expect(plan.data?.preview).toContain('INSERT INTO "public"."orders"')
    expect(plan.data?.statements[1]).toMatchObject({
      kind: 'update',
      sql: 'UPDATE "public"."orders" SET "owner" = $1 WHERE "id" = $2',
      params: ['dba-oncall', 1001]
    })
  })

  it('plans no-primary-key MySQL mutations with snapshot single-row guards', async () => {
    const plan = await planDatabaseTableMutation({
      connectionId: 'conn-metrics-mysql',
      dbType: 'mysql',
      databaseName: 'metrics',
      tableName: 'metric_events',
      mutations: [
        {
          kind: 'update',
          rowKey: 'row-0',
          primaryKey: [],
          patch: { severity: 'critical' },
          originalRow: { service: 'api-gateway', event_type: 'deploy', severity: 'info', created_at: '2026-06-03 10:42:00' }
        }
      ]
    })

    expect(plan.ok).toBe(true)
    expect(plan.data?.warning).toContain('No primary key detected')
    expect(plan.data?.preview).toContain('UPDATE `metrics`.`metric_events` SET `severity` = \'critical\'')
    expect(plan.data?.preview).toContain('`service` = \'api-gateway\'')
    expect(plan.data?.preview).toContain('LIMIT 1;')
  })

  it('rejects Oracle no-primary-key mutation planning behind the backend boundary', async () => {
    const plan = await planDatabaseTableMutation({
      connectionId: 'conn-oracle-audit',
      dbType: 'oracle',
      databaseName: 'ORCLPDB1',
      schemaName: 'OPS',
      tableName: 'AUDIT_LOG',
      mutations: [
        {
          kind: 'update',
          rowKey: 'row-0',
          primaryKey: [],
          patch: { action: 'RELEASE_BLOCKED' },
          originalRow: { event_id: 501, actor: 'deploy-bot', action: 'RELEASE_START', created_at: '2026-06-03 08:10:00' }
        }
      ]
    })

    expect(plan.ok).toBe(false)
    expect(plan.errorCode).toBe('DB_PRIMARY_KEY_REQUIRED')
    expect(plan.errorMessage).toContain('Oracle table editing requires a primary key')
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

  it('uses the injected PostgreSQL driver in non-seed runtime instead of backend seed rows', async () => {
    const { driver, state } = createPostgresDriverDouble()
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver })

    const emptyCatalog = await listDatabaseCatalog()
    expect(emptyCatalog.ok).toBe(true)
    expect(emptyCatalog.data?.connections).toEqual([])
    expect(emptyCatalog.data?.defaults.selectedNodeId).toBeNull()

    const probe = await testDatabaseConnection({
      dbType: 'postgresql',
      name: 'live-postgres',
      host: '127.0.0.1',
      port: 5432,
      user: 'ops',
      password: 'secret',
      database: 'orders',
      sslMode: 'require'
    })
    expect(probe.ok).toBe(true)
    expect(probe.data).toMatchObject({
      dbType: 'postgresql',
      serverVersion: 'PostgreSQL 16.9 live-driver',
      endpoint: '127.0.0.1:5432'
    })

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'postgresql',
        name: 'live-postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password: 'secret',
        database: 'orders',
        env: 'Production',
        groupId: 'group-prod',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)
    expect(saved.data?.connection).toMatchObject({ id: 'conn-live-postgres', status: 'idle', catalogs: [{ name: 'orders' }] })

    const edited = await saveDatabaseConnection({
      mode: 'edit',
      id: 'conn-live-postgres',
      connection: {
        dbType: 'postgresql',
        name: 'live-postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password: '',
        database: 'orders',
        env: 'Production',
        groupId: 'group-prod',
        authentication: 'UserAndPassword'
      }
    })
    expect(edited.ok).toBe(true)
    expect(state.configs.at(-1)).toMatchObject({ password: 'secret' })

    const connected = await connectDatabaseConnection('conn-live-postgres')
    expect(connected.ok).toBe(true)
    expect(connected.data?.connection.status).toBe('connected')
    expect(connected.data?.connection.catalogs[0]?.schemas?.[0]?.tables[0]).toMatchObject({
      name: 'orders',
      primaryKey: ['id'],
      columns: expect.arrayContaining([expect.objectContaining({ name: 'service', type: 'text' })])
    })
    expect((await listDatabaseCatalog()).data?.connections.map((connection) => connection.id)).toEqual(['conn-live-postgres'])

    const sql = await executeDatabaseSql({
      connectionId: 'conn-live-postgres',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      sql: 'select * from public.orders'
    })
    expect(sql.ok).toBe(true)
    expect(sql.data?.rows).toEqual([
      expect.objectContaining({ service: 'live-api', owner: 'nina' }),
      expect.objectContaining({ service: 'live-worker', owner: 'omar' })
    ])
    expect(sql.data?.rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ service: 'payment-api' })]))

    const tablePage = await queryDatabaseTable({
      connectionId: 'conn-live-postgres',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [{ column: 'status', operator: 'eq', value: 'open' }],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 20,
      withTotal: true
    })
    expect(tablePage.ok).toBe(true)
    expect(tablePage.data?.rows).toEqual([expect.objectContaining({ service: 'live-api' })])
    expect(tablePage.data?.total).toBe(1)

    const ddl = await getDatabaseTableDdl({
      connectionId: 'conn-live-postgres',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })
    expect(ddl.ok).toBe(true)
    expect(ddl.data?.ddl).toContain('CREATE TABLE "public"."orders"')
    expect(ddl.data?.ddl).toContain('"id" integer NOT NULL')
    expect(ddl.data?.ddl).toContain('PRIMARY KEY ("id")')

    const mutation = await mutateDatabaseTable({
      connectionId: 'conn-live-postgres',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [
        { kind: 'update', rowKey: JSON.stringify([1]), primaryKey: ['id'], patch: { owner: 'live-owner' } },
        { kind: 'insert', values: { id: 3, service: 'live-cron', status: 'open', owner: 'ivy', updated_at: '2026-06-09 11:00:00' } },
        { kind: 'delete', rowKey: JSON.stringify([2]), primaryKey: ['id'] }
      ]
    })
    expect(mutation.ok).toBe(true)
    expect(mutation.data?.affected).toBe(3)
    expect(state.rows).toEqual([
      expect.objectContaining({ id: 1, owner: 'live-owner' }),
      expect.objectContaining({ id: 3, service: 'live-cron' })
    ])

    const createdDatabase = await createDatabaseCatalog({
      connectionId: 'conn-live-postgres',
      requestedName: 'ops_live',
      sql: 'CREATE DATABASE "ops_live";'
    })
    expect(createdDatabase.ok).toBe(true)
    expect(state.createdDatabases).toEqual(['ops_live'])
    expect(createdDatabase.data?.connection.catalogs.map((catalog) => catalog.name)).toContain('ops_live')

    const disconnected = await disconnectDatabaseConnection('conn-live-postgres')
    expect(disconnected.ok).toBe(true)
    expect(disconnected.data?.connection.status).toBe('idle')
    expect(state.connected).toBeGreaterThan(0)
    expect(state.closed).toBeGreaterThan(0)
  })

  it('persists live database workspace state and restores it through the backend store', async () => {
    const { driver, state } = createPostgresDriverDouble()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-state-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'database-workspace.json')
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver, stateFilePath })

    const group = await createDatabaseGroup({ name: 'Persisted DB Ops', parentId: null })
    expect(group.ok).toBe(true)

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'postgresql',
        name: 'persisted-postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password: 'secret',
        database: 'orders',
        env: 'Production',
        groupId: 'group-persisted-db-ops',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const connected = await connectDatabaseConnection('conn-persisted-postgres')
    expect(connected.ok).toBe(true)
    expect(connected.data?.connection.catalogs[0]?.schemas?.[0]?.tables[0]?.name).toBe('orders')

    const paneState = saveDatabaseAiPaneState({
      open: true,
      width: 512,
      context: {
        connectionId: 'conn-persisted-postgres',
        catalogName: 'orders',
        schemaName: 'public',
        dbType: 'postgresql'
      },
      draft: 'persist this database context',
      messages: []
    })
    expect(paneState.ok).toBe(true)
    const paneRequest = await createDatabaseAiPaneRequest({
      prompt: 'Remember this DB question',
      context: {
        connectionId: 'conn-persisted-postgres',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'persisted-postgres · orders · public'
      }
    })
    expect(paneRequest.ok).toBe(true)
    expect(startDatabaseAiPaneResponse({ requestId: paneRequest.data!.requestId, assistantMessageId: paneRequest.data!.assistantMessage.id }).ok).toBe(true)

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      groups: Array<{ id: string; name: string }>
      connections: Array<{ id: string; status: string; catalogs: unknown[] }>
      secrets: Record<string, { password?: string }>
      aiPaneState: { open: boolean; draft: string; messages: Array<{ status: string; content: string }> }
    }
    expect(persisted.groups.map((item) => item.id)).toContain('group-persisted-db-ops')
    expect(persisted.connections.map((item) => item.id)).toEqual(['conn-persisted-postgres'])
    expect(persisted.connections[0]).toMatchObject({ status: 'connected' })
    expect(persisted.connections[0].catalogs).toHaveLength(1)
    expect(persisted.secrets['conn-persisted-postgres']).toEqual({ password: 'secret' })
    expect(persisted.aiPaneState).toMatchObject({ open: true, draft: 'persist this database context' })
    expect(persisted.aiPaneState.messages.map((message) => message.content)).toContain('Remember this DB question')

    resetDatabaseBackendSeed()
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver, stateFilePath })

    const restoredCatalog = await listDatabaseCatalog()
    expect(restoredCatalog.data?.groups.find((item) => item.id === 'group-persisted-db-ops')?.name).toBe('Persisted DB Ops')
    const restoredConnection = restoredCatalog.data?.connections.find((item) => item.id === 'conn-persisted-postgres')
    expect(restoredCatalog.data?.connections.map((item) => item.id)).toEqual(['conn-persisted-postgres'])
    expect(restoredConnection).toMatchObject({ name: 'persisted-postgres', status: 'idle', hasPassword: true })
    expect(restoredConnection?.catalogs[0]?.schemas?.[0]?.tables[0]).toMatchObject({ name: 'orders', primaryKey: ['id'] })

    const restoredPaneState = getDatabaseAiPaneState()
    expect(restoredPaneState.data).toMatchObject({
      open: true,
      width: 512,
      context: { connectionId: 'conn-persisted-postgres', catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' },
      draft: 'persist this database context'
    })
    expect(restoredPaneState.data?.messages.find((message) => message.role === 'assistant')).toMatchObject({
      status: 'cancelled',
      content: ''
    })

    const edited = await saveDatabaseConnection({
      mode: 'edit',
      id: 'conn-persisted-postgres',
      connection: {
        dbType: 'postgresql',
        name: 'persisted-postgres-renamed',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password: '',
        database: 'orders',
        env: 'Production',
        groupId: 'group-persisted-db-ops',
        authentication: 'UserAndPassword'
      }
    })
    expect(edited.ok).toBe(true)
    expect(state.configs.at(-1)).toMatchObject({ password: 'secret' })
  })

  it('uses the injected MySQL driver and reports unsupported engines without seed success in non-seed runtime', async () => {
    const { driver } = createMysqlDriverDouble()
    configureDatabaseRuntime({ useSeedData: false, mysqlDriver: driver })

    const mysqlProbe = await testDatabaseConnection({
      dbType: 'mysql',
      name: 'live-mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'ops',
      password: 'secret',
      database: 'metrics'
    })
    expect(mysqlProbe.ok).toBe(true)
    expect(mysqlProbe.data).toMatchObject({ dbType: 'mysql', serverVersion: 'MySQL 8.4.0-live-driver' })

    const oracleProbe = await testDatabaseConnection({
      dbType: 'oracle',
      name: 'oracle-prod',
      user: 'ops',
      password: 'secret',
      database: 'ORCLPDB1',
      url: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
    })
    expect(oracleProbe).toEqual({
      ok: false,
      errorCode: 'DB_ORACLE_DRIVER_UNAVAILABLE',
      errorMessage: 'Oracle driver is not wired in this aiopsterm backend yet.'
    })

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'mysql',
        name: 'live-mysql',
        host: '127.0.0.1',
        port: 3306,
        user: 'ops',
        password: 'secret',
        database: 'metrics',
        env: 'Staging',
        groupId: 'group-default',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const refreshed = await refreshDatabaseConnection('conn-live-mysql')
    expect(refreshed.ok).toBe(true)
    expect(refreshed.data?.connection.status).toBe('connected')
    expect(refreshed.data?.connection.catalogs[0]?.tables?.[0]).toMatchObject({
      name: 'service_health',
      primaryKey: ['id']
    })

    const sql = await executeDatabaseSql({
      connectionId: 'conn-live-mysql',
      dbType: 'mysql',
      databaseName: 'metrics',
      sql: 'select * from service_health'
    })
    expect(sql.ok).toBe(true)
    expect(sql.data?.rows).toEqual([expect.objectContaining({ service: 'gateway' }), expect.objectContaining({ service: 'worker' })])

    const ddl = await getDatabaseTableDdl({
      connectionId: 'conn-live-mysql',
      dbType: 'mysql',
      databaseName: 'metrics',
      tableName: 'service_health'
    })
    expect(ddl.ok).toBe(true)
    expect(ddl.data?.ddl).toBe('CREATE TABLE `service_health` (`id` int PRIMARY KEY)')
  })
})
