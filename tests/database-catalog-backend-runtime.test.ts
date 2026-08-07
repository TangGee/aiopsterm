import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      if (normalized.startsWith('select current_database()')) return rowsFor([{ database_name: 'runtime_default' }])
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

  it('restores system-encrypted passwords without decrypting until the connection is opened', async () => {
    const { driver, state } = createPostgresCatalogDriverDouble()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-lazy-credential-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'database-workspace.json')
    const credentialKeyPath = join(dir, 'database-credential.key')
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver, stateFilePath, credentialKeyPath, credentialStorageBackend: 'local' })

    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'postgresql',
        name: 'lazy-credential-postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'ops',
        password: 'initial-password',
        database: 'orders',
        env: 'Production',
        groupId: 'default-group',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      secrets: Record<string, { password: string }>
    }
    persisted.secrets['conn-lazy-credential-postgres'].password = `ds1:${Buffer.from('sealed:lazy-database-password').toString('base64')}`
    await writeFile(stateFilePath, JSON.stringify(persisted, null, 2), 'utf-8')

    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((plain: string) => Buffer.from(`sealed:${plain}`, 'utf-8')),
      decryptString: vi.fn((cipher: Buffer) => cipher.toString('utf-8').replace(/^sealed:/, ''))
    }
    resetDatabaseBackendSeed()
    state.configs.length = 0
    configureDatabaseRuntime({
      useSeedData: false,
      postgresDriver: driver,
      stateFilePath,
      credentialKeyPath,
      credentialStorageBackend: 'system',
      safeStorage
    })

    const restored = await listDatabaseCatalog()
    expect(restored.data?.connections).toContainEqual(expect.objectContaining({ id: 'conn-lazy-credential-postgres', hasPassword: true }))
    expect(safeStorage.decryptString).not.toHaveBeenCalled()

    const connected = await connectDatabaseConnection('conn-lazy-credential-postgres')
    expect(connected.ok).toBe(true)
    expect(safeStorage.decryptString).toHaveBeenCalledTimes(1)
    expect(state.configs.at(-1)).toEqual(expect.objectContaining({ password: 'lazy-database-password' }))
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

  it('uses the server current database when PostgreSQL-compatible drafts omit a database', async () => {
    const { driver } = createPostgresCatalogDriverDouble()
    configureDatabaseRuntime({ useSeedData: false, postgresDriver: driver })

    for (const dbType of ['postgresql', 'kingbase'] as const) {
      const saved = await saveDatabaseConnection({
        mode: 'create',
        connection: {
          dbType,
          name: `${dbType}@127.0.0.1:5432`,
          host: '127.0.0.1',
          port: 5432,
          user: 'ops',
          password: 'secret',
          database: '',
          env: 'Development',
          groupId: 'group-default',
          authentication: 'UserAndPassword'
        }
      })
      expect(saved.ok).toBe(true)
      expect(saved.data?.connection.catalogs).toEqual([])

      const connected = await connectDatabaseConnection(saved.data!.connection.id)
      expect(connected.ok).toBe(true)
      expect(connected.data?.connection.catalogs[0]?.name).toBe('runtime_default')
      expect(connected.data?.connection.database).toBe('runtime_default')
    }
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

  it('migrates legacy automatic connection names once and preserves stable connection ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-catalog-name-migration-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'database-workspace.json')
    const baseConnection = {
      env: 'Development',
      groupId: 'group-default',
      authentication: 'UserAndPassword' as const,
      hasPassword: false,
      readonly: true,
      status: 'idle' as const,
      catalogs: [{ name: 'main', tables: [] }]
    }
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        groups: [{ id: 'group-default', name: 'Default Group' }],
        groupParents: { 'group-default': null },
        connections: [
          {
            ...baseConnection,
            id: 'conn-youtube',
            name: 'sqlite-connection',
            dbType: 'sqlite',
            host: 'local',
            port: null,
            user: '',
            database: 'youtube_downloads.db',
            filePath: '/srv/data/youtube_downloads.db',
            catalogs: [{ name: 'youtube_downloads.db', tables: [] }]
          },
          {
            ...baseConnection,
            id: 'conn-codex-state',
            name: 'sqlite-connection',
            dbType: 'sqlite',
            host: 'local',
            port: null,
            user: '',
            database: 'state_5.sqlite',
            filePath: 'C:\\Users\\ops\\state_5.sqlite'
          },
          {
            ...baseConnection,
            id: 'conn-orders-auto',
            name: 'postgresql-connection',
            dbType: 'postgresql',
            host: 'db.internal',
            port: 5432,
            user: 'ops',
            database: 'orders',
            readonly: undefined,
            catalogs: [{ name: 'orders', schemas: [] }]
          },
          {
            ...baseConnection,
            id: 'conn-orders-custom',
            name: 'orders@db.internal:5432',
            dbType: 'postgresql',
            host: 'db.internal',
            port: 5432,
            user: 'ops',
            database: 'orders',
            readonly: undefined,
            catalogs: [{ name: 'orders', schemas: [] }]
          }
        ],
        secrets: {}
      }),
      'utf-8'
    )

    configureDatabaseRuntime({ useSeedData: false, stateFilePath })
    const catalog = await listDatabaseCatalog()
    expect(catalog.data?.connections.map((connection) => [connection.id, connection.name])).toEqual([
      ['conn-youtube', 'youtube_downloads.db'],
      ['conn-codex-state', 'state_5.sqlite'],
      ['conn-orders-auto', 'orders@db.internal:5432-2'],
      ['conn-orders-custom', 'orders@db.internal:5432']
    ])
    expect(catalog.data?.connections.find((connection) => connection.id === 'conn-youtube')?.catalogs[0]?.name).toBe('main')

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      version: number
      connections: Array<{ id: string; name: string }>
    }
    expect(persisted.version).toBe(2)
    expect(persisted.connections.map((connection) => [connection.id, connection.name])).toEqual([
      ['conn-youtube', 'youtube_downloads.db'],
      ['conn-codex-state', 'state_5.sqlite'],
      ['conn-orders-auto', 'orders@db.internal:5432-2'],
      ['conn-orders-custom', 'orders@db.internal:5432']
    ])

    const versionTwoState = JSON.parse(await readFile(stateFilePath, 'utf-8'))
    versionTwoState.connections.push({
      id: 'conn-explicit-placeholder',
      name: 'mysql-connection',
      dbType: 'mysql',
      env: 'Development',
      groupId: 'group-default',
      host: 'mysql.internal',
      port: 3306,
      authentication: 'UserAndPassword',
      user: 'ops',
      hasPassword: false,
      database: 'metrics',
      status: 'idle',
      catalogs: [{ name: 'metrics', tables: [] }]
    })
    await writeFile(stateFilePath, JSON.stringify(versionTwoState), 'utf-8')
    configureDatabaseRuntime({ useSeedData: false, stateFilePath })
    const reloaded = await listDatabaseCatalog()
    expect(reloaded.data?.connections.find((connection) => connection.id === 'conn-explicit-placeholder')?.name).toBe('mysql-connection')
  })

  it('does not load or rewrite state from a newer persistence version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-db-catalog-future-version-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'database-workspace.json')
    const futureState = JSON.stringify({ version: 3, marker: 'future-state', groups: [], connections: [] })
    await writeFile(stateFilePath, futureState, 'utf-8')

    configureDatabaseRuntime({ useSeedData: false, stateFilePath })
    const catalog = await listDatabaseCatalog()

    expect(catalog.data?.connections).toEqual([])
    expect((await createDatabaseGroup({ name: 'must-not-downgrade' })).ok).toBe(true)
    expect(await readFile(stateFilePath, 'utf-8')).toBe(futureState)
  })
})
