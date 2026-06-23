import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PostgresDriver } from '@shared/databaseRelationalEngines'
import {
  configureDatabaseRuntime,
  connectDatabaseConnection,
  createDatabaseGroup,
  listDatabaseCatalog,
  refreshDatabaseConnection,
  resetDatabaseBackendSeed,
  saveDatabaseConnection
} from '@shared/database'

const fieldsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {}).map((name) => ({ name }))

const createPostgresCatalogDriverDouble = (options: { failCatalog?: boolean } = {}) => {
  const state = {
    connected: 0,
    closed: 0,
    configs: [] as Array<Record<string, unknown>>
  }
  class Client {
    constructor(config: Record<string, unknown>) {
      state.configs.push({ ...config })
    }

    async connect() {
      state.connected += 1
    }

    async end() {
      state.closed += 1
    }

    async query<T = Record<string, unknown>>(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      const rowsFor = (rows: Array<Record<string, unknown>>) => ({ rows: rows as T[], fields: fieldsForRows(rows), rowCount: rows.length })
      if (normalized.startsWith('select version()')) return rowsFor([{ version: 'PostgreSQL 16 catalog-runtime' }])
      if (options.failCatalog && normalized.startsWith('select schema_name from information_schema.schemata')) {
        throw Object.assign(new Error('catalog lookup unavailable'), { code: 'PG_CATALOG_DOWN' })
      }
      if (normalized.startsWith('select schema_name from information_schema.schemata')) return rowsFor([{ schema_name: 'public' }])
      if (normalized.includes('from information_schema.tables')) return rowsFor([{ table_schema: 'public', table_name: 'orders', table_type: 'BASE TABLE' }])
      if (normalized.includes('from information_schema.columns')) {
        return rowsFor([
          { table_schema: 'public', table_name: 'orders', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
          { table_schema: 'public', table_name: 'orders', column_name: 'service', data_type: 'text', is_nullable: 'NO' }
        ])
      }
      if (normalized.includes('from information_schema.table_constraints')) return rowsFor([{ table_schema: 'public', table_name: 'orders', column_name: 'id' }])
      if (normalized.includes('from information_schema.routines')) return rowsFor([])
      if (normalized.startsWith('select pg_get_viewdef')) return rowsFor([])
      throw Object.assign(new Error(`unexpected postgres query: ${sql}`), { code: 'PG_FAKE_UNHANDLED' })
    }
  }
  return { driver: { Client } as PostgresDriver, state }
}

describe('database catalog backend runtime', () => {
  let tempDirs: string[] = []
  const originalDatabaseSeed = process.env.AIOPSTERM_DATABASE_ENABLE_SEED

  beforeEach(() => {
    process.env.AIOPSTERM_DATABASE_ENABLE_SEED = '1'
    configureDatabaseRuntime()
    resetDatabaseBackendSeed()
    tempDirs = []
  })

  afterEach(async () => {
    configureDatabaseRuntime()
    resetDatabaseBackendSeed()
    if (originalDatabaseSeed === undefined) {
      delete process.env.AIOPSTERM_DATABASE_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_DATABASE_ENABLE_SEED = originalDatabaseSeed
    }
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('owns non-seed catalog visibility and defaults independently from SQL execution', async () => {
    delete process.env.AIOPSTERM_DATABASE_ENABLE_SEED
    configureDatabaseRuntime({ useSeedData: false })
    resetDatabaseBackendSeed()

    const emptyCatalog = await listDatabaseCatalog()
    expect(emptyCatalog.ok).toBe(true)
    expect(emptyCatalog.data?.connections).toEqual([])
    expect(emptyCatalog.data?.defaults).toMatchObject({
      selectedNodeId: null,
      expandedConnectionIds: []
    })
  })

  it('persists groups, encrypted secrets, and restores live connections through the catalog runtime store', async () => {
    const { driver, state } = createPostgresCatalogDriverDouble()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-catalog-runtime-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'database-workspace.json')
    const credentialKeyPath = join(dir, 'database-credential.key')
    const password = 'catalog-runtime-secret'
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver, stateFilePath, credentialKeyPath })

    const group = await createDatabaseGroup({ name: 'Runtime Ops', parentId: null })
    expect(group.ok).toBe(true)

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'postgresql',
        name: 'runtime-postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password,
        database: 'orders',
        env: 'Production',
        groupId: 'group-runtime-ops',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const connected = await connectDatabaseConnection('conn-runtime-postgres')
    expect(connected.ok).toBe(true)
    expect(connected.data?.connection.catalogs[0]?.schemas?.[0]?.tables[0]).toMatchObject({ name: 'orders', primaryKey: ['id'] })

    const persistedText = await readFile(stateFilePath, 'utf-8')
    const persisted = JSON.parse(persistedText) as {
      groups: Array<{ id: string; name: string }>
      connections: Array<{ id: string; status: string; catalogs: unknown[] }>
      secrets: Record<string, { password?: string }>
    }
    expect(persisted.groups).toContainEqual({ id: 'group-runtime-ops', name: 'Runtime Ops' })
    expect(persisted.connections).toEqual([expect.objectContaining({ id: 'conn-runtime-postgres', status: 'connected' })])
    expect(persisted.connections[0].catalogs).toHaveLength(1)
    expect(persisted.secrets['conn-runtime-postgres'].password).toMatch(/^dk1:/)
    expect(persistedText).not.toContain(password)

    resetDatabaseBackendSeed()
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver, stateFilePath, credentialKeyPath })

    const restored = await listDatabaseCatalog()
    expect(restored.data?.groups).toContainEqual({ id: 'group-runtime-ops', name: 'Runtime Ops' })
    expect(restored.data?.connections).toEqual([
      expect.objectContaining({
        id: 'conn-runtime-postgres',
        status: 'idle',
        hasPassword: true
      })
    ])
    expect(restored.data?.connections[0]?.catalogs[0]?.schemas?.[0]?.tables[0]).toMatchObject({ name: 'orders', primaryKey: ['id'] })
    expect(state.configs.at(-1)).toMatchObject({ password })
  })

  it('marks live relational refresh failures on the catalog connection state', async () => {
    const { driver } = createPostgresCatalogDriverDouble({ failCatalog: true })
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver })

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'postgresql',
        name: 'failing-postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password: 'secret',
        database: 'orders',
        env: 'Production',
        groupId: 'group-default',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const refreshed = await refreshDatabaseConnection('conn-failing-postgres')
    expect(refreshed).toMatchObject({
      ok: false,
      errorCode: 'PG_CATALOG_DOWN',
      errorMessage: 'catalog lookup unavailable'
    })

    const catalog = await listDatabaseCatalog()
    expect(catalog.data?.connections).toEqual([
      expect.objectContaining({
        id: 'conn-failing-postgres',
        status: 'failed'
      })
    ])
  })

  it('migrates legacy plaintext secrets inside the catalog runtime state owner', async () => {
    const { driver } = createPostgresCatalogDriverDouble()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-catalog-legacy-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'database-workspace.json')
    const credentialKeyPath = join(dir, 'database-credential.key')
    await writeFile(
      stateFilePath,
      JSON.stringify(
        {
          version: 1,
          groups: [{ id: 'group-default', name: 'Default Group' }],
          groupParents: { 'group-default': null },
          connections: [
            {
              id: 'conn-legacy-runtime',
              name: 'legacy-runtime',
              dbType: 'postgresql',
              env: 'Production',
              groupId: 'group-default',
              host: '127.0.0.1',
              port: 5432,
              authentication: 'UserAndPassword',
              user: 'ops',
              hasPassword: true,
              database: 'orders',
              sslMode: 'require',
              status: 'connected',
              catalogs: [{ name: 'orders', schemas: [{ name: 'public', tables: [{ id: 'tbl-orders', name: 'orders', columns: [], primaryKey: [] }] }] }]
            }
          ],
          secrets: { 'conn-legacy-runtime': { password: 'legacy-runtime-secret' } }
        },
        null,
        2
      ),
      'utf-8'
    )

    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver, stateFilePath, credentialKeyPath })

    const catalog = await listDatabaseCatalog()
    expect(catalog.data?.connections).toEqual([
      expect.objectContaining({
        id: 'conn-legacy-runtime',
        status: 'idle',
        hasPassword: true
      })
    ])
    const migratedText = await readFile(stateFilePath, 'utf-8')
    const migrated = JSON.parse(migratedText) as { secrets: Record<string, { password?: string }> }
    expect(migratedText).not.toContain('legacy-runtime-secret')
    expect(migrated.secrets['conn-legacy-runtime'].password).toMatch(/^dk1:/)
  })
})
