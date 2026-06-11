import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto'
import { dirname, isAbsolute, join, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type {
  DatabaseColumnFilter,
  DatabaseColumnSort,
  DatabaseAiResponseProvider,
  DatabaseAiDrawerAction,
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiTargetDialect,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneRequestResult,
  DatabaseCatalogInfo,
  DatabaseCatalogResult,
  DatabaseCatalogDefaults,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseConnectionDeleteResult,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseCreateDatabaseInput,
  DatabaseCreateDatabaseResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseAiPaneStateContext,
  DatabaseAiPaneStateResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  DatabaseSchemaInfo,
  DatabaseWorkspaceCatalog,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseSqlExecuteInput,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableInfo,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationPlanStatement,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult,
  DatabaseSqlErrorDiagnosisInput,
  DatabaseSqlErrorDiagnosisResult
} from './preload'

const supportedEngines = new Set(['mysql', 'postgresql', 'sqlite', 'oracle', 'sqlserver'])
const DEFAULT_DATABASE_GROUP_ID = 'group-default'
const databaseEnvValues = new Set<DatabaseConnectionInfo['env']>(['Development', 'TEST', 'Staging', 'Production'])
const databaseStatusValues = new Set<DatabaseConnectionInfo['status']>(['idle', 'testing', 'connected', 'failed'])
const postgresSslModeValues = new Set(['', 'disable', 'require', 'verify-ca', 'verify-full'])

const engineVersions: Record<DatabaseConnectionTestInput['dbType'], string> = {
  mysql: 'MySQL 8 local backend validation',
  postgresql: 'PostgreSQL 16 local backend validation',
  sqlite: 'SQLite local backend validation',
  oracle: 'Oracle local backend validation',
  sqlserver: 'SQL Server local backend validation'
}

const databaseEngines: DatabaseEngineInfo[] = [
  { code: 'mysql', connectionCode: 'mysql', name: 'MySQL', enabled: true, accent: '#00758f' },
  { code: 'h2', name: 'H2', enabled: false, accent: '#7c3aed' },
  { code: 'oracle', connectionCode: 'oracle', name: 'Oracle', enabled: true, accent: '#c74634' },
  { code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' },
  { code: 'sqlserver', connectionCode: 'sqlserver', name: 'SQLServer', enabled: true, accent: '#a91d22' },
  { code: 'sqlite', connectionCode: 'sqlite', name: 'SQLite', enabled: true, accent: '#00a1e0' },
  { code: 'mariadb', name: 'MariaDB', enabled: false, accent: '#c0765c' },
  { code: 'clickhouse', name: 'ClickHouse', enabled: false, accent: '#fdd835' },
  { code: 'dm', name: 'DM', enabled: false, accent: '#d946ef' },
  { code: 'presto', name: 'Presto', enabled: false, accent: '#7c2d12' },
  { code: 'db2', name: 'DB2', enabled: false, accent: '#2563eb' },
  { code: 'oceanbase', name: 'OceanBase', enabled: false, accent: '#0ea5e9' },
  { code: 'hive', name: 'Hive', enabled: false, accent: '#f59e0b' },
  { code: 'kingbase', name: 'KingBase', enabled: false, accent: '#dc2626' },
  { code: 'mongodb', name: 'MongoDB', enabled: false, accent: '#4db33d' },
  { code: 'timeplus', name: 'Timeplus', enabled: false, accent: '#14b8a6' }
]

const databaseGroupSeed: DatabaseGroupInfo[] = [
  { id: 'group-default', name: 'Default Group' },
  { id: 'group-prod', name: 'Production' },
  { id: 'group-local', name: 'Local Lab' }
]

const databaseGroupParentSeed: Record<string, string | null> = {
  'group-default': null,
  'group-prod': null,
  'group-local': null
}

const ordersColumns: DatabaseColumnInfo[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'owner', type: 'varchar(64)', nullable: true },
  { name: 'updated_at', type: 'timestamp', nullable: false }
]

const incidentsColumns: DatabaseColumnInfo[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'updated_at', type: 'datetime', nullable: false }
]

const serviceHealthColumns: DatabaseColumnInfo[] = [
  { name: 'id', type: 'int', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'region', type: 'varchar(32)', nullable: false },
  { name: 'latency_ms', type: 'int', nullable: false },
  { name: 'healthy', type: 'tinyint', nullable: false }
]

const metricEventsColumns: DatabaseColumnInfo[] = [
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'event_type', type: 'varchar(32)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'created_at', type: 'datetime', nullable: false }
]

const cacheColumns: DatabaseColumnInfo[] = [
  { name: 'key', type: 'text', nullable: false, key: 'PK' },
  { name: 'value', type: 'text', nullable: true },
  { name: 'ttl_seconds', type: 'integer', nullable: true },
  { name: 'updated_at', type: 'text', nullable: false }
]

const oracleAuditColumns: DatabaseColumnInfo[] = [
  { name: 'event_id', type: 'NUMBER', nullable: false },
  { name: 'actor', type: 'VARCHAR2(64)', nullable: false },
  { name: 'action', type: 'VARCHAR2(64)', nullable: false },
  { name: 'created_at', type: 'TIMESTAMP', nullable: false }
]

const databaseConnectionSeed: DatabaseConnectionInfo[] = [
  {
    id: 'conn-prod-pg',
    name: 'orders-postgres',
    dbType: 'postgresql',
    env: 'Production',
    groupId: 'group-prod',
    host: '10.32.6.9',
    port: 5432,
    authentication: 'UserAndPassword',
    user: 'readonly',
    hasPassword: true,
    database: 'orders',
    sslMode: 'require',
    url: 'jdbc:postgresql://10.32.6.9:5432/orders',
    status: 'connected',
    catalogs: [
      {
        name: 'orders',
        schemas: [
          {
            name: 'public',
            tables: [{ id: 'tbl-orders', name: 'orders', columns: ordersColumns, primaryKey: ['id'] }],
            views: [{ id: 'view-public-open-orders', name: 'open_orders_v', columns: ordersColumns, primaryKey: ['id'] }],
            functions: ['notify_order_owner(order_id bigint)', 'calculate_order_age(order_id bigint)'],
            procedures: ['archive_closed_orders(cutoff timestamp)']
          },
          {
            name: 'ops',
            tables: [{ id: 'tbl-pg-incidents', name: 'ops_incidents', columns: incidentsColumns, primaryKey: ['id'] }],
            views: [{ id: 'view-ops-active-incidents', name: 'active_incidents_v', columns: incidentsColumns, primaryKey: ['id'] }],
            functions: ['incident_priority(severity text)'],
            procedures: ['rotate_incident_partitions()']
          }
        ]
      }
    ]
  },
  {
    id: 'conn-metrics-mysql',
    name: 'metrics-mysql',
    dbType: 'mysql',
    env: 'Staging',
    groupId: 'group-default',
    host: '10.32.6.18',
    port: 3306,
    authentication: 'UserAndPassword',
    user: 'ops',
    hasPassword: true,
    database: 'metrics',
    url: 'jdbc:mysql://10.32.6.18:3306/metrics',
    status: 'idle',
    catalogs: [
      {
        name: 'metrics',
        tables: [
          { id: 'tbl-service-health', name: 'service_health', columns: serviceHealthColumns, primaryKey: ['id'] },
          { id: 'tbl-mysql-incidents', name: 'ops_incidents', columns: incidentsColumns, primaryKey: ['id'] },
          { id: 'tbl-metric-events', name: 'metric_events', columns: metricEventsColumns, primaryKey: [] }
        ]
      }
    ]
  },
  {
    id: 'conn-oracle-audit',
    name: 'audit-oracle',
    dbType: 'oracle',
    env: 'TEST',
    groupId: 'group-default',
    host: '10.32.6.28',
    port: 1521,
    authentication: 'UserAndPassword',
    user: 'audit',
    hasPassword: true,
    database: 'ORCLPDB1',
    url: '10.32.6.28:1521/ORCLPDB1',
    status: 'connected',
    catalogs: [
      {
        name: 'ORCLPDB1',
        schemas: [
          {
            name: 'OPS',
            tables: [{ id: 'tbl-oracle-audit-log', name: 'AUDIT_LOG', columns: oracleAuditColumns, primaryKey: [] }]
          }
        ]
      }
    ]
  },
  {
    id: 'conn-local-cache',
    name: 'local-cache',
    dbType: 'sqlite',
    env: 'Development',
    groupId: 'group-local',
    host: 'local',
    port: null,
    authentication: 'UserAndPassword',
    user: '',
    database: 'cache.db',
    filePath: '/tmp/aiopsterm/cache.db',
    readonly: true,
    url: 'sqlite:///tmp/aiopsterm/cache.db',
    status: 'idle',
    catalogs: [
      {
        name: 'cache.db',
        tables: [{ id: 'tbl-cache-entries', name: 'cache_entries', columns: cacheColumns, primaryKey: ['key'] }]
      }
    ]
  }
]
const databaseConnectionSeedIds = new Set(databaseConnectionSeed.map((connection) => connection.id))

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const sqlitePathFromUrl = (url: string) => {
  const trimmed = trim(url)
  if (!trimmed.toLowerCase().startsWith('sqlite://')) return ''
  return trimmed.replace(/^sqlite:\/\//i, '')
}

type SqliteRunResult = { changes?: number }
type SqliteColumnDefinition = { name?: string }
type SqliteStatement = {
  reader: boolean
  all: (...params: unknown[]) => Array<Record<string, unknown>>
  run: (...params: unknown[]) => SqliteRunResult
  columns: () => SqliteColumnDefinition[]
}
type SqliteDatabase = {
  prepare: (source: string) => SqliteStatement
  close: () => unknown
}
type SqliteDatabaseConstructor = new (
  filePath: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }
) => SqliteDatabase
type MySqlConnection = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<[T, unknown]>
  end: () => Promise<unknown>
  destroy?: () => unknown
}
type MySqlDriver = {
  createConnection: (config: Record<string, unknown>) => Promise<MySqlConnection>
}
type PostgresClient = {
  connect: () => Promise<unknown>
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{
    rows?: T[]
    fields?: Array<{ name: string }>
    rowCount?: number | null
  }>
  end: () => Promise<unknown>
}
type PostgresDriver = {
  Client: new (config: Record<string, unknown>) => PostgresClient
}
type OracleExecuteResult = {
  rows?: unknown[]
  metaData?: Array<{ name?: string } | string>
  rowsAffected?: number | null
}
type OracleConnection = {
  execute: (sql: string, params?: unknown[] | Record<string, unknown>, options?: Record<string, unknown>) => Promise<OracleExecuteResult>
  close: () => Promise<unknown>
  commit?: () => Promise<unknown>
  rollback?: () => Promise<unknown>
}
type OracleDriver = {
  getConnection: (config: Record<string, unknown>) => Promise<OracleConnection>
  OUT_FORMAT_OBJECT?: number
  CLOB?: unknown
  NCLOB?: unknown
  BLOB?: unknown
  fetchAsString?: unknown[]
  fetchAsBuffer?: unknown[]
  initOracleClient?: (config: { libDir?: string; configDir?: string; driverName?: string }) => unknown
}
type SqlServerRequest = {
  input: (name: string, value: unknown) => SqlServerRequest
  query: <T = Record<string, unknown>>(sql: string) => Promise<{
    recordset?: T[]
    recordsets?: T[][]
    rowsAffected?: number[]
    output?: Record<string, unknown>
  }>
}
type SqlServerTransaction = {
  begin: () => Promise<unknown>
  commit: () => Promise<unknown>
  rollback: () => Promise<unknown>
  request: () => SqlServerRequest
}
type SqlServerPool = {
  connect?: () => Promise<SqlServerPool>
  request: () => SqlServerRequest
  transaction?: () => SqlServerTransaction
  close: () => Promise<unknown>
}
type SqlServerDriver = {
  ConnectionPool: new (config: Record<string, unknown>) => SqlServerPool
}
export type DatabaseRuntimeConfig = {
  useSeedData?: boolean
  mysqlDriver?: MySqlDriver
  postgresDriver?: PostgresDriver
  oracleDriver?: OracleDriver | null
  sqlServerDriver?: SqlServerDriver | null
  oracleClientLibDir?: string
  oracleClientConfigDir?: string
  oracleDriverName?: string
  stateFilePath?: string
  credentialKeyPath?: string
}
type SqliteSchemaTableRow = { name?: string; type?: string }
type SqliteTableColumnRow = { cid?: number; name?: string; type?: string; notnull?: number; pk?: number; hidden?: number }

const SQLITE_MAIN_SCHEMA = 'main'
const SQLITE_TIMEOUT_MS = 5000
const RELATIONAL_TIMEOUT_MS = 10_000
let sqliteRuntime: SqliteDatabaseConstructor | null | undefined
let databaseRuntimeConfig: DatabaseRuntimeConfig = {}
let mysqlRuntime: MySqlDriver | null | undefined
let postgresRuntime: PostgresDriver | null | undefined
let oracleRuntime: OracleDriver | null | undefined
let sqlServerRuntime: SqlServerDriver | null | undefined
let oracleClientInitialized = false
const databaseConnectionSecrets = new Map<string, string>()
const databaseVerifiedConnections = new Set<string>()

export function configureDatabaseRuntime(config?: DatabaseRuntimeConfig) {
  databaseRuntimeConfig = config ? { ...config } : {}
  databaseLoadedStateFilePath = ''
  cachedDatabaseCredentialKeyPath = ''
  cachedDatabaseCredentialKey = null
  oracleClientInitialized = false
}

const loadSqliteRuntime = () => {
  if (sqliteRuntime !== undefined) return sqliteRuntime
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('better-sqlite3') as SqliteDatabaseConstructor | { default?: SqliteDatabaseConstructor }
    sqliteRuntime = typeof loaded === 'function' ? loaded : loaded.default && typeof loaded.default === 'function' ? loaded.default : null
  } catch {
    sqliteRuntime = null
  }
  return sqliteRuntime
}

const isExplicitDatabaseSeedDataEnabled = () => {
  try {
    return typeof process !== 'undefined' && String(process.env?.AIOPSTERM_DATABASE_ENABLE_SEED || '').trim() === '1'
  } catch {
    return false
  }
}

const shouldUseDatabaseSeedData = () => databaseRuntimeConfig.useSeedData ?? isExplicitDatabaseSeedDataEnabled()

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (cipher: Buffer) => string
}

const databaseSafeStorageCredentialPrefix = 'ds1:'
const databaseLocalKeyCredentialPrefix = 'dk1:'
let cachedDatabaseCredentialKeyPath = ''
let cachedDatabaseCredentialKey: Buffer | null = null

const resolveDatabaseSafeStorage = (): SafeStorageLike | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { safeStorage?: SafeStorageLike }
    return electron.safeStorage || null
  } catch {
    return null
  }
}

const defaultDatabaseCredentialKeyPath = () => {
  const envPath = trim(typeof process !== 'undefined' ? process.env?.AIOPSTERM_DATABASE_CREDENTIAL_KEY_FILE : '')
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  const statePath = databaseStateFilePath()
  if (statePath) return join(dirname(statePath), 'database-credential.key')
  return join(typeof process !== 'undefined' ? process.cwd() : '.', '.aiopsterm-database-credential.key')
}

const databaseCredentialKeyPath = () => {
  const configured = trim(databaseRuntimeConfig.credentialKeyPath)
  return configured ? (isAbsolute(configured) ? configured : resolve(configured)) : defaultDatabaseCredentialKeyPath()
}

const readOrCreateDatabaseCredentialKey = () => {
  const keyPath = databaseCredentialKeyPath()
  if (cachedDatabaseCredentialKey && cachedDatabaseCredentialKeyPath === keyPath) return cachedDatabaseCredentialKey
  cachedDatabaseCredentialKeyPath = keyPath
  cachedDatabaseCredentialKey = null
  if (existsSync(keyPath)) {
    const current = readFileSync(keyPath)
    if (current.length === 32) {
      cachedDatabaseCredentialKey = current
      return cachedDatabaseCredentialKey
    }
  }
  mkdirSync(dirname(keyPath), { recursive: true })
  cachedDatabaseCredentialKey = randomBytes(32)
  writeFileSync(keyPath, cachedDatabaseCredentialKey, { mode: 0o600 })
  return cachedDatabaseCredentialKey
}

const isDatabaseCredentialCiphertext = (value: unknown) =>
  typeof value === 'string' && (value.startsWith(databaseSafeStorageCredentialPrefix) || value.startsWith(databaseLocalKeyCredentialPrefix))

const databaseSafeStorageAvailable = (safeStorage = resolveDatabaseSafeStorage()) => {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

const encryptDatabaseCredentialWithLocalKey = (plain: string) => {
  const key = readOrCreateDatabaseCredentialKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${databaseLocalKeyCredentialPrefix}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`
}

const decryptDatabaseCredentialWithLocalKey = (cipherText: string) => {
  const body = cipherText.slice(databaseLocalKeyCredentialPrefix.length)
  const [ivB64, encryptedB64, tagB64] = body.split('.')
  if (!ivB64 || !encryptedB64 || !tagB64) throw new Error('Malformed local database credential ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', readOrCreateDatabaseCredentialKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf-8')
}

const encryptDatabaseCredentialForStorage = (value: unknown) => {
  if (typeof value !== 'string') return ''
  if (!value) return ''
  if (isDatabaseCredentialCiphertext(value)) return value
  const safeStorage = resolveDatabaseSafeStorage()
  if (databaseSafeStorageAvailable(safeStorage)) {
    return `${databaseSafeStorageCredentialPrefix}${safeStorage!.encryptString(value).toString('base64')}`
  }
  return encryptDatabaseCredentialWithLocalKey(value)
}

const decryptDatabaseCredentialFromStorage = (value: unknown) => {
  if (typeof value !== 'string') return ''
  if (!value) return ''
  if (value.startsWith(databaseSafeStorageCredentialPrefix)) {
    try {
      return resolveDatabaseSafeStorage()?.decryptString(Buffer.from(value.slice(databaseSafeStorageCredentialPrefix.length), 'base64')) || ''
    } catch {
      return ''
    }
  }
  if (value.startsWith(databaseLocalKeyCredentialPrefix)) {
    try {
      return decryptDatabaseCredentialWithLocalKey(value)
    } catch {
      return ''
    }
  }
  return value
}

const loadMysqlRuntime = () => {
  if (databaseRuntimeConfig.mysqlDriver) return databaseRuntimeConfig.mysqlDriver
  if (mysqlRuntime !== undefined) return mysqlRuntime
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('mysql2/promise') as unknown as { createConnection?: MySqlDriver['createConnection']; default?: MySqlDriver }
    mysqlRuntime =
      typeof loaded.createConnection === 'function'
        ? { createConnection: loaded.createConnection }
        : loaded.default && typeof loaded.default.createConnection === 'function'
          ? loaded.default
          : null
  } catch {
    mysqlRuntime = null
  }
  return mysqlRuntime
}

const loadPostgresRuntime = () => {
  if (databaseRuntimeConfig.postgresDriver) return databaseRuntimeConfig.postgresDriver
  if (postgresRuntime !== undefined) return postgresRuntime
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('pg') as unknown as { Client?: PostgresDriver['Client']; default?: PostgresDriver }
    postgresRuntime =
      typeof loaded.Client === 'function'
        ? { Client: loaded.Client }
        : loaded.default && typeof loaded.default.Client === 'function'
          ? loaded.default
          : null
  } catch {
    postgresRuntime = null
  }
  return postgresRuntime
}

const loadOracleRuntime = () => {
  if ('oracleDriver' in databaseRuntimeConfig) return databaseRuntimeConfig.oracleDriver ?? null
  if (oracleRuntime !== undefined) return oracleRuntime
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('oracledb') as unknown as OracleDriver & { default?: OracleDriver }
    const driver = typeof loaded.getConnection === 'function' ? loaded : loaded.default && typeof loaded.default.getConnection === 'function' ? loaded.default : null
    if (driver) {
      if (driver.CLOB || driver.NCLOB) driver.fetchAsString = [driver.CLOB, driver.NCLOB].filter(Boolean)
      if (driver.BLOB) driver.fetchAsBuffer = [driver.BLOB]
    }
    oracleRuntime = driver
  } catch {
    oracleRuntime = null
  }
  return oracleRuntime
}

const loadSqlServerRuntime = () => {
  if ('sqlServerDriver' in databaseRuntimeConfig) return databaseRuntimeConfig.sqlServerDriver ?? null
  if (sqlServerRuntime !== undefined) return sqlServerRuntime
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('mssql') as unknown as SqlServerDriver & { default?: SqlServerDriver }
    sqlServerRuntime =
      typeof loaded.ConnectionPool === 'function'
        ? loaded
        : loaded.default && typeof loaded.default.ConnectionPool === 'function'
          ? loaded.default
          : null
  } catch {
    sqlServerRuntime = null
  }
  return sqlServerRuntime
}

const ensureOracleClientInitialized = (driver: OracleDriver) => {
  if (oracleClientInitialized || !driver.initOracleClient) return
  const libDir = trim(databaseRuntimeConfig.oracleClientLibDir)
  const configDir = trim(databaseRuntimeConfig.oracleClientConfigDir)
  const driverName = trim(databaseRuntimeConfig.oracleDriverName)
  if (!libDir && !configDir && !driverName) return
  driver.initOracleClient({
    ...(libDir ? { libDir } : {}),
    ...(configDir ? { configDir } : {}),
    ...(driverName ? { driverName } : {})
  })
  oracleClientInitialized = true
}

const sqliteFilePathFromConnection = (connection: Pick<DatabaseConnectionInfo, 'filePath' | 'url'>) =>
  trim(connection.filePath) || sqlitePathFromUrl(trim(connection.url))

const sqliteFilePathFromTestInput = (input: Pick<DatabaseConnectionTestInput, 'filePath' | 'url'>) =>
  trim(input.filePath) || sqlitePathFromUrl(trim(input.url))

const isSqliteFileExtension = (filePath: string) => /\.(db|sqlite|sqlite3)$/i.test(filePath)

const openSqliteDatabase = (filePath: string, readonly: boolean) => {
  const Database = loadSqliteRuntime()
  if (!Database) {
    throw Object.assign(new Error('SQLite runtime is unavailable. Rebuild better-sqlite3 for the Electron runtime.'), {
      code: 'DB_SQLITE_DRIVER_UNAVAILABLE'
    })
  }
  return new Database(filePath, { readonly, fileMustExist: true, timeout: SQLITE_TIMEOUT_MS })
}

const sqliteErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : fallback
}

const sqliteErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

const isRealSqliteConnection = (connection: DatabaseConnectionInfo | null | undefined) => {
  if (!connection || connection.dbType !== 'sqlite') return false
  const filePath = sqliteFilePathFromConnection(connection)
  return !!filePath && existsSync(filePath)
}

const sqliteSchemaNameFor = (connection: DatabaseConnectionInfo, databaseName?: string) => {
  const requested = trim(databaseName)
  if (!requested || requested === connection.database) return SQLITE_MAIN_SCHEMA
  return requested
}

const sqliteIdentifier = (value: string) => `"${String(value || '').replace(/"/g, '""')}"`

const sqliteTableReference = (connection: DatabaseConnectionInfo, databaseName: string | undefined, tableName: string) =>
  `${sqliteIdentifier(sqliteSchemaNameFor(connection, databaseName))}.${sqliteIdentifier(tableName)}`

const sqliteCall = (stmt: SqliteStatement, params: unknown[], mode: 'all' | 'run') => (params.length ? stmt[mode](...params) : stmt[mode]())

const sqliteColumnNamesFromStatement = (stmt: SqliteStatement, rows: Array<Record<string, unknown>>) => {
  const columns = stmt
    .columns()
    .map((column) => trim(column.name))
    .filter(Boolean)
  return columns.length ? columns : columnsForRows(rows)
}

const sqliteColumnsForTable = (db: SqliteDatabase, schemaName: string, tableName: string): DatabaseColumnInfo[] => {
  const rows = db.prepare(`PRAGMA ${sqliteIdentifier(schemaName)}.table_xinfo(${sqliteIdentifier(tableName)})`).all() as SqliteTableColumnRow[]
  return rows
    .filter((row) => trim(row.name) && Number(row.hidden ?? 0) !== 1)
    .sort((first, second) => Number(first.cid ?? 0) - Number(second.cid ?? 0))
    .map((row) => {
      const primaryKeyRank = Number(row.pk ?? 0)
      return {
        name: trim(row.name),
        type: trim(row.type).toUpperCase() || 'TEXT',
        nullable: primaryKeyRank <= 0 && Number(row.notnull ?? 0) === 0,
        ...(primaryKeyRank > 0 ? { key: 'PK' as const } : {})
      }
    })
}

const sqlitePrimaryKeyForColumns = (columns: DatabaseColumnInfo[]) =>
  columns.filter((column) => column.key === 'PK').map((column) => column.name)

const sqliteCatalogsForConnection = (connection: DatabaseConnectionInfo): DatabaseCatalogInfo[] | null => {
  if (!isRealSqliteConnection(connection)) return null
  const filePath = sqliteFilePathFromConnection(connection)
  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(filePath, true)
    const rows = db
      .prepare(
        `SELECT name, type FROM ${sqliteIdentifier(SQLITE_MAIN_SCHEMA)}.sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as SqliteSchemaTableRow[]
    const tables = rows
      .filter((row) => row.type === 'table' && trim(row.name))
      .map((row) => {
        const name = trim(row.name)
        const columns = sqliteColumnsForTable(db!, SQLITE_MAIN_SCHEMA, name)
        return {
          id: `tbl-${connection.id}-${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
          name,
          columns,
          primaryKey: sqlitePrimaryKeyForColumns(columns)
        }
      })
    return [{ name: SQLITE_MAIN_SCHEMA, tables }]
  } catch {
    return null
  } finally {
    db?.close()
  }
}

const sqliteExecute = (connection: DatabaseConnectionInfo, sql: string, startedAt: number): DatabaseSqlExecuteResult => {
  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(sqliteFilePathFromConnection(connection), !!connection.readonly)
    const stmt = db.prepare(sql)
    if (stmt.reader) {
      const rows = sqliteCall(stmt, [], 'all') as Array<Record<string, unknown>>
      return {
        ok: true,
        data: {
          columns: sqliteColumnNamesFromStatement(stmt, rows),
          rows,
          rowCount: rows.length,
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    }
    const result = sqliteCall(stmt, [], 'run') as SqliteRunResult
    return {
      ok: true,
      data: {
        columns: [],
        rows: [],
        rowCount: Number(result.changes ?? 0),
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_QUERY_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite query failed.')
    }
  } finally {
    db?.close()
  }
}

const sqliteWhereForFilters = (filters: DatabaseColumnFilter[], knownColumns: string[]) => {
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const clauses: string[] = []
  const params: unknown[] = []
  filters.forEach((filter) => {
    const column = known.get(trim(filter.column).toLowerCase())
    if (!column) return
    const quoted = sqliteIdentifier(column)
    if (filter.operator === 'isnull') {
      clauses.push(`${quoted} IS NULL`)
      return
    }
    if (filter.operator === 'notnull') {
      clauses.push(`${quoted} IS NOT NULL`)
      return
    }
    if (filter.operator === 'like') {
      clauses.push(`${quoted} LIKE ?`)
      params.push(`%${String(filter.value ?? '')}%`)
      return
    }
    if (filter.operator === 'eq') {
      clauses.push(`${quoted} = ?`)
      params.push(String(filter.value ?? ''))
      return
    }
    if (filter.operator === 'neq') {
      clauses.push(`${quoted} <> ?`)
      params.push(String(filter.value ?? ''))
      return
    }
    const values = (filter.values ?? []).map(String)
    if (!values.length) {
      clauses.push('0 = 1')
      return
    }
    clauses.push(`${quoted} IN (${values.map(() => '?').join(', ')})`)
    params.push(...values)
  })
  return {
    sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    params
  }
}

const sqliteOrderByFor = (sort: DatabaseColumnSort | null | undefined, knownColumns: string[]) => {
  if (!sort) return ''
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const column = known.get(trim(sort.column).toLowerCase())
  if (!column) return ''
  return ` ORDER BY ${sqliteIdentifier(column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
}

const sqliteQueryTable = (connection: DatabaseConnectionInfo, input: DatabaseTableQueryInput, startedAt: number): DatabaseTableQueryResult => {
  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(sqliteFilePathFromConnection(connection), true)
    const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
    const tableName = trim(input.tableName)
    const columns = sqliteColumnsForTable(db, schemaName, tableName)
    if (!columns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
    const where = sqliteWhereForFilters(filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = sqliteOrderByFor(sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = sqliteTableReference(connection, input.databaseName, tableName)
    const rows = db.prepare(`SELECT * FROM ${tableRef}${where.sql}${orderBy} LIMIT ? OFFSET ?`).all(...where.params, pageSize, offset)
    const total = input.withTotal
      ? Number((db.prepare(`SELECT COUNT(*) AS total FROM ${tableRef}${where.sql}`).all(...where.params)[0]?.total as number | undefined) ?? 0)
      : null
    return {
      ok: true,
      data: {
        columns: knownColumns,
        rows,
        rowCount: rows.length,
        durationMs: Math.max(1, Date.now() - startedAt),
        total,
        knownColumns
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_QUERY_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite table query failed.')
    }
  } finally {
    db?.close()
  }
}

const sqliteTableDdl = (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): DatabaseTableDdlResult => {
  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(sqliteFilePathFromConnection(connection), true)
    const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
    const rows = db
      .prepare(
        `SELECT sql FROM ${sqliteIdentifier(schemaName)}.sqlite_schema WHERE type IN ('table', 'view') AND name = ? ORDER BY type LIMIT 1`
      )
      .all(trim(input.tableName))
    const ddl = typeof rows[0]?.sql === 'string' ? rows[0].sql : ''
    if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    return { ok: true, data: { ddl } }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_DDL_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite DDL lookup failed.')
    }
  } finally {
    db?.close()
  }
}

const sqliteKnownColumnsForTable = (db: SqliteDatabase, schemaName: string, tableName: string) =>
  sqliteColumnsForTable(db, schemaName, tableName).map((column) => column.name)

type RelationalDatabaseType = Extract<DatabaseEngineCode, 'mysql' | 'postgresql' | 'oracle' | 'sqlserver'>
type DatabaseMutationDialect = DatabaseEngineCode
type DatabaseMutationStatement = Omit<DatabaseTableMutationPlanStatement, 'preview'>
type DatabaseRowMutation = Extract<DatabaseTableMutationInput['mutations'][number], { kind: 'delete' | 'update' }>

const databaseMutationIdentifier = (value: string, dialect: DatabaseMutationDialect) =>
  dialect === 'mysql'
    ? `\`${String(value || '').replace(/`/g, '``')}\``
    : dialect === 'sqlserver'
      ? `[${String(value || '').replace(/]/g, ']]')}]`
      : `"${String(value || '').replace(/"/g, '""')}"`

const databaseMutationPlaceholder = (dialect: DatabaseMutationDialect, index: number) => {
  if (dialect === 'postgresql') return `$${index}`
  if (dialect === 'oracle') return `:${index}`
  if (dialect === 'sqlserver') return `@p${index}`
  return '?'
}

const databaseMutationTableReference = (
  connection: Pick<DatabaseConnectionInfo, 'dbType' | 'database' | 'user'> | null,
  input: Pick<DatabaseTableMutationInput, 'databaseName' | 'schemaName' | 'tableName'>,
  dialect: DatabaseMutationDialect
) => {
  const tableName = dialect === 'oracle' ? oracleLookupIdentifier(input.tableName) : trim(input.tableName)
  const table = databaseMutationIdentifier(tableName, dialect)
  if (dialect === 'mysql') return `${databaseMutationIdentifier(trim(input.databaseName), dialect)}.${table}`
  if (dialect === 'sqlserver') return `${databaseMutationIdentifier(trim(input.schemaName) || 'dbo', dialect)}.${table}`
  if (dialect === 'sqlite') {
    const schemaName = connection && connection.dbType === 'sqlite' ? sqliteSchemaNameFor(connection as DatabaseConnectionInfo, input.databaseName) : trim(input.databaseName) || SQLITE_MAIN_SCHEMA
    return `${databaseMutationIdentifier(schemaName, dialect)}.${table}`
  }
  if (dialect === 'oracle') {
    const schemaName = oracleLookupIdentifier(trim(input.schemaName) || trim(connection?.user))
    return schemaName ? `${databaseMutationIdentifier(schemaName, dialect)}.${table}` : table
  }
  return `${databaseMutationIdentifier(trim(input.schemaName) || 'public', dialect)}.${table}`
}

const decodeDatabaseMutationPrimaryKeyRowKey = (rowKey: string, primaryKey: string[]) => {
  if (!primaryKey.length) return null
  try {
    const parsed = JSON.parse(rowKey)
    return Array.isArray(parsed) && parsed.length === primaryKey.length ? parsed : null
  } catch {
    return null
  }
}

const pushDatabaseMutationComparison = (clauses: string[], params: unknown[], dialect: DatabaseMutationDialect, column: string, value: unknown) => {
  const quoted = databaseMutationIdentifier(column, dialect)
  if (value === null || value === undefined) {
    clauses.push(`${quoted} IS NULL`)
    return
  }
  params.push(value)
  clauses.push(`${quoted} = ${databaseMutationPlaceholder(dialect, params.length)}`)
}

const databaseMutationWhereForRow = (
  dialect: DatabaseMutationDialect,
  knownColumns: string[],
  mutation: DatabaseRowMutation,
  params: unknown[]
) => {
  const primaryKey = mutation.primaryKey.map(trim).filter(Boolean)
  const values = decodeDatabaseMutationPrimaryKeyRowKey(mutation.rowKey, primaryKey)
  if (primaryKey.length && values) {
    const clauses: string[] = []
    primaryKey.forEach((column, index) => pushDatabaseMutationComparison(clauses, params, dialect, column, values[index]))
    return { sql: clauses.join(' AND '), usesPrimaryKey: true }
  }

  if (dialect === 'oracle') {
    throw Object.assign(new Error('Oracle table editing requires a primary key in this version.'), { code: 'DB_PRIMARY_KEY_REQUIRED' })
  }
  if (!mutation.originalRow) {
    throw Object.assign(new Error('Original row snapshot is required for table mutations without a primary key.'), {
      code: dialect === 'sqlite' ? 'DB_SQLITE_PRIMARY_KEY_REQUIRED' : 'DB_PRIMARY_KEY_REQUIRED'
    })
  }

  const clauses: string[] = []
  knownColumns.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(mutation.originalRow, column)) {
      pushDatabaseMutationComparison(clauses, params, dialect, column, mutation.originalRow?.[column])
    }
  })
  if (!clauses.length) {
    throw Object.assign(new Error('Original row snapshot does not contain known table columns.'), { code: 'DB_ROW_SNAPSHOT_REQUIRED' })
  }
  return { sql: clauses.join(' AND '), usesPrimaryKey: false }
}

const applyDatabaseMutationSingleRowGuard = (
  dialect: DatabaseMutationDialect,
  tableRef: string,
  sql: string,
  whereSql: string,
  usesPrimaryKey: boolean
) => {
  if (usesPrimaryKey) return sql
  if (dialect === 'mysql') return `${sql} LIMIT 1`
  if (dialect === 'sqlserver') return sql.replace(/^DELETE FROM /i, 'DELETE TOP (1) FROM ').replace(/^UPDATE /i, 'UPDATE TOP (1) ')
  if (dialect === 'sqlite') return sql.replace(`WHERE ${whereSql}`, `WHERE rowid = (SELECT rowid FROM ${tableRef} WHERE ${whereSql} LIMIT 1)`)
  if (dialect === 'postgresql') return sql.replace(`WHERE ${whereSql}`, `WHERE ctid = (SELECT ctid FROM ${tableRef} WHERE ${whereSql} LIMIT 1)`)
  return sql
}

const buildDatabaseMutationStatement = (
  dialect: DatabaseMutationDialect,
  tableRef: string,
  knownColumns: string[],
  mutation: DatabaseTableMutationInput['mutations'][number]
): DatabaseMutationStatement | null => {
  const knownColumnSet = new Set(knownColumns.map((column) => column.toLowerCase()))
  const params: unknown[] = []
  if (mutation.kind === 'drop') return { kind: mutation.kind, sql: `DROP TABLE ${tableRef}`, params }
  if (mutation.kind === 'truncate') {
    return { kind: mutation.kind, sql: dialect === 'sqlite' ? `DELETE FROM ${tableRef}` : `TRUNCATE TABLE ${tableRef}`, params }
  }
  if (mutation.kind === 'insert') {
    const columns = Object.keys(mutation.values).filter((column) => knownColumnSet.has(column.toLowerCase()) && mutation.values[column] !== null && mutation.values[column] !== undefined)
    if (!columns.length) return null
    columns.forEach((column) => params.push(mutation.values[column]))
    return {
      kind: mutation.kind,
      sql: `INSERT INTO ${tableRef} (${columns.map((column) => databaseMutationIdentifier(column, dialect)).join(', ')}) VALUES (${columns.map((_column, index) => databaseMutationPlaceholder(dialect, index + 1)).join(', ')})`,
      params
    }
  }
  if (mutation.kind === 'delete') {
    const where = databaseMutationWhereForRow(dialect, knownColumns, mutation, params)
    const sql = `DELETE FROM ${tableRef} WHERE ${where.sql}`
    return { kind: mutation.kind, sql: applyDatabaseMutationSingleRowGuard(dialect, tableRef, sql, where.sql, where.usesPrimaryKey), params }
  }

  const columns = Object.keys(mutation.patch).filter((column) => knownColumnSet.has(column.toLowerCase()))
  if (!columns.length) return null
  columns.forEach((column) => params.push(mutation.patch[column]))
  const assignments = columns.map((column, index) => `${databaseMutationIdentifier(column, dialect)} = ${databaseMutationPlaceholder(dialect, index + 1)}`).join(', ')
  const where = databaseMutationWhereForRow(dialect, knownColumns, mutation, params)
  const sql = `UPDATE ${tableRef} SET ${assignments} WHERE ${where.sql}`
  return { kind: mutation.kind, sql: applyDatabaseMutationSingleRowGuard(dialect, tableRef, sql, where.sql, where.usesPrimaryKey), params }
}

const formatDatabaseMutationSqlLiteral = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}

const formatDatabaseMutationStatementPreview = (statement: DatabaseMutationStatement) => {
  let paramIndex = 0
  const sql = statement.sql.replace(/\$(\d+)|:(\d+)|@p(\d+)|\?/g, (match) => {
    if (match === '?') {
      const value = statement.params[paramIndex]
      paramIndex += 1
      return formatDatabaseMutationSqlLiteral(value)
    }
    const index = Number(match.replace(/^\$|^:|^@p/i, '') || paramIndex + 1)
    return formatDatabaseMutationSqlLiteral(statement.params[index - 1])
  })
  return `${sql};`
}

const addDatabaseMutationPreview = (statement: DatabaseMutationStatement): DatabaseTableMutationPlanStatement => ({
  ...statement,
  preview: formatDatabaseMutationStatementPreview(statement)
})

const sqliteApplyMutation = (db: SqliteDatabase, tableRef: string, knownColumns: string[], mutation: DatabaseTableMutationInput['mutations'][number]) => {
  if (mutation.kind === 'drop') {
    db.prepare(`DROP TABLE ${tableRef}`).run()
    return 0
  }
  const statement = buildDatabaseMutationStatement('sqlite', tableRef, knownColumns, mutation)
  if (!statement) return 0
  const result = db.prepare(statement.sql).run(...statement.params)
  return Number(result.changes ?? 0)
}

const sqliteMutateTable = (connection: DatabaseConnectionInfo, input: DatabaseTableMutationInput, startedAt: number): DatabaseTableMutationResult => {
  if (connection.readonly) {
    return { ok: false, errorCode: 'DB_SQLITE_READONLY', errorMessage: 'SQLite connection is read-only.' }
  }

  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(sqliteFilePathFromConnection(connection), false)
    const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
    const tableName = trim(input.tableName)
    const knownColumns = sqliteKnownColumnsForTable(db, schemaName, tableName)
    if (!knownColumns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const tableRef = sqliteTableReference(connection, input.databaseName, tableName)
    let affected = 0
    db.prepare('BEGIN').run()
    try {
      input.mutations.forEach((mutation) => {
        affected += sqliteApplyMutation(db!, tableRef, knownColumns, mutation)
      })
      db.prepare('COMMIT').run()
    } catch (error) {
      db.prepare('ROLLBACK').run()
      throw error
    }
    const catalogs = sqliteCatalogsForConnection(connection)
    if (catalogs) {
      const index = databaseConnections.findIndex((item) => item.id === connection.id)
      if (index >= 0) databaseConnections[index] = { ...databaseConnections[index], catalogs }
    }
    return {
      ok: true,
      data: {
        affected,
        durationMs: Math.max(1, Date.now() - startedAt),
        catalog: databaseWorkspaceCatalogFor(input.connectionId)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_MUTATION_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite table mutation failed.')
    }
  } finally {
    db?.close()
  }
}

const isRelationalConnection = (connection: DatabaseConnectionInfo | null | undefined): connection is DatabaseConnectionInfo =>
  !!connection && (connection.dbType === 'mysql' || connection.dbType === 'postgresql' || connection.dbType === 'oracle' || connection.dbType === 'sqlserver')

const relationalErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : code || fallback
}

const relationalErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

const relationalEngineCode = (dbType: RelationalDatabaseType) => (dbType === 'postgresql' ? 'POSTGRES' : dbType.toUpperCase())

const relationalFallbackCode = (dbType: RelationalDatabaseType, action: string) => `DB_${relationalEngineCode(dbType)}_${action}`

const normalizeQueryRows = (rows: unknown): Array<Record<string, unknown>> =>
  Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }))
    : []

const relationalIdentifier = (value: string, dbType: RelationalDatabaseType) =>
  dbType === 'mysql'
    ? `\`${String(value || '').replace(/`/g, '``')}\``
    : dbType === 'sqlserver'
      ? `[${String(value || '').replace(/]/g, ']]')}]`
      : `"${String(value || '').replace(/"/g, '""')}"`

const relationalPlaceholder = (dbType: RelationalDatabaseType, index: number) => {
  if (dbType === 'postgresql') return `$${index}`
  if (dbType === 'oracle') return `:${index}`
  if (dbType === 'sqlserver') return `@p${index}`
  return '?'
}

const oracleLookupIdentifier = (value: string) => {
  const raw = trim(value)
  if (!raw) return ''
  const unquoted = unquoteDatabaseIdentifier(raw)
  return raw.startsWith('"') && raw.endsWith('"') ? unquoted : unquoted.toUpperCase()
}

const oracleSchemaNameFor = (
  connection: Pick<DatabaseConnectionInfo, 'user'>,
  input: Pick<DatabaseTableDdlInput, 'schemaName'>
) => oracleLookupIdentifier(trim(input.schemaName) || trim(connection.user))

const relationalTableReference = (
  connection: Pick<DatabaseConnectionInfo, 'dbType' | 'user'>,
  input: Pick<DatabaseTableDdlInput, 'databaseName' | 'schemaName' | 'tableName'>
) => {
  const dbType = connection.dbType as RelationalDatabaseType
  const tableName = dbType === 'oracle' ? oracleLookupIdentifier(input.tableName) : trim(input.tableName)
  const table = relationalIdentifier(tableName, dbType)
  if (connection.dbType === 'postgresql') return `${relationalIdentifier(trim(input.schemaName) || 'public', 'postgresql')}.${table}`
  if (connection.dbType === 'sqlserver') return `${relationalIdentifier(trim(input.schemaName) || 'dbo', 'sqlserver')}.${table}`
  if (connection.dbType === 'oracle') {
    const schemaName = oracleSchemaNameFor(connection, input)
    return schemaName ? `${relationalIdentifier(schemaName, 'oracle')}.${table}` : table
  }
  return `${relationalIdentifier(trim(input.databaseName), 'mysql')}.${table}`
}

const relationalRowCount = (result: unknown, fallback = 0) => {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>
    const affectedRows = Number(record.affectedRows)
    if (Number.isFinite(affectedRows)) return affectedRows
    const rowCount = Number(record.rowCount)
    if (Number.isFinite(rowCount)) return rowCount
    const changes = Number(record.changes)
    if (Number.isFinite(changes)) return changes
  }
  return fallback
}

const mysqlConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>) => ({
  host: trim(input.host),
  port: normalizedDatabasePort(input.port) ?? undefined,
  user: trim(input.user),
  password: input.password || undefined,
  database: trim(input.database) || undefined,
  connectTimeout: RELATIONAL_TIMEOUT_MS,
  ...(trim(input.sslMode) && trim(input.sslMode) !== 'disable' ? { ssl: { rejectUnauthorized: false } } : {})
})

const postgresConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>) => ({
  host: trim(input.host),
  port: normalizedDatabasePort(input.port) ?? undefined,
  user: trim(input.user),
  password: input.password || undefined,
  database: trim(input.database) || undefined,
  connectionTimeoutMillis: RELATIONAL_TIMEOUT_MS,
  ...(trim(input.sslMode) && trim(input.sslMode) !== 'disable' ? { ssl: { rejectUnauthorized: false } } : {})
})

const sqlServerConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>) => ({
  server: trim(input.host),
  port: normalizedDatabasePort(input.port) ?? undefined,
  user: trim(input.user),
  password: input.password || undefined,
  database: trim(input.database) || undefined,
  connectionTimeout: RELATIONAL_TIMEOUT_MS,
  requestTimeout: RELATIONAL_TIMEOUT_MS,
  options: {
    encrypt: trim(input.sslMode) !== 'disable',
    trustServerCertificate: true,
    enableArithAbort: true
  }
})

const oracleConnectStringFromInput = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'database' | 'url'>) => {
  const rawUrl = trim(input.url)
  if (rawUrl) {
    return rawUrl
      .replace(/^jdbc:oracle:thin:@\/\//i, '')
      .replace(/^jdbc:oracle:thin:@/i, '')
      .replace(/^oracle:\/\//i, '')
      .replace(/^\/\//, '')
  }
  const host = trim(input.host)
  const port = normalizedDatabasePort(input.port)
  const database = trim(input.database)
  const portText = port ? `:${port}` : ''
  return `${host}${portText}${database ? `/${database}` : ''}`
}

const oracleConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'url'>) => ({
  user: trim(input.user),
  password: input.password || undefined,
  connectString: oracleConnectStringFromInput(input),
  callTimeout: RELATIONAL_TIMEOUT_MS
})

const connectionTestInputFromSaved = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => ({
  dbType: connection.dbType,
  name: connection.name,
  host: connection.host,
  port: connection.port,
  user: connection.user,
  password: databaseConnectionSecrets.get(connection.id) || '',
  database: connection.database,
  filePath: connection.filePath,
  readonly: connection.readonly,
  sslMode: connection.sslMode,
  url: connection.url
})

const openMysqlConnection = async (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>) => {
  const driver = loadMysqlRuntime()
  if (!driver) {
    throw Object.assign(new Error('MySQL driver is unavailable. Install mysql2 before connecting to MySQL.'), {
      code: 'DB_MYSQL_DRIVER_UNAVAILABLE'
    })
  }
  return driver.createConnection(mysqlConfigFor(input))
}

const openPostgresClient = async (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>) => {
  const driver = loadPostgresRuntime()
  if (!driver) {
    throw Object.assign(new Error('PostgreSQL driver is unavailable. Install pg before connecting to PostgreSQL.'), {
      code: 'DB_POSTGRES_DRIVER_UNAVAILABLE'
    })
  }
  const client = new driver.Client(postgresConfigFor(input))
  await client.connect()
  return client
}

const openOracleConnection = async (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'url'>) => {
  const driver = loadOracleRuntime()
  if (!driver) {
    throw Object.assign(new Error('Oracle driver is unavailable. Install oracledb before connecting to Oracle.'), {
      code: 'DB_ORACLE_DRIVER_UNAVAILABLE'
    })
  }
  ensureOracleClientInitialized(driver)
  return driver.getConnection(oracleConfigFor(input))
}

const openSqlServerPool = async (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>) => {
  const driver = loadSqlServerRuntime()
  if (!driver) {
    throw Object.assign(new Error('SQL Server driver is unavailable. Install mssql before connecting to SQL Server.'), {
      code: 'DB_SQLSERVER_DRIVER_UNAVAILABLE'
    })
  }
  const pool = new driver.ConnectionPool(sqlServerConfigFor(input))
  return typeof pool.connect === 'function' ? pool.connect() : pool
}

const withMysqlConnection = async <T>(connection: DatabaseConnectionInfo, fn: (client: MySqlConnection) => Promise<T>) => {
  let client: MySqlConnection | null = null
  try {
    client = await openMysqlConnection(connectionTestInputFromSaved(connection))
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        client.destroy?.()
      }
    }
  }
}

const withPostgresClient = async <T>(connection: DatabaseConnectionInfo, fn: (client: PostgresClient) => Promise<T>) => {
  let client: PostgresClient | null = null
  try {
    client = await openPostgresClient(connectionTestInputFromSaved(connection))
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        /* ignore close errors */
      }
    }
  }
}

const withOracleConnection = async <T>(connection: DatabaseConnectionInfo, fn: (client: OracleConnection) => Promise<T>) => {
  let client: OracleConnection | null = null
  try {
    client = await openOracleConnection(connectionTestInputFromSaved(connection))
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.close()
      } catch {
        /* ignore close errors */
      }
    }
  }
}

const withSqlServerPool = async <T>(connection: DatabaseConnectionInfo, fn: (client: SqlServerPool) => Promise<T>) => {
  let client: SqlServerPool | null = null
  try {
    client = await openSqlServerPool(connectionTestInputFromSaved(connection))
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.close()
      } catch {
        /* ignore close errors */
      }
    }
  }
}

const mysqlRows = async <T extends Record<string, unknown>>(client: MySqlConnection, sql: string, params: unknown[] = []) => {
  const [rows] = await client.query<T[]>(sql, params)
  return normalizeQueryRows(rows) as T[]
}

const mysqlExec = async (client: MySqlConnection, sql: string, params: unknown[] = []) => {
  const [result] = await client.query(sql, params)
  return relationalRowCount(result)
}

const postgresRows = async <T extends Record<string, unknown>>(client: PostgresClient, sql: string, params: unknown[] = []) => {
  const result = await client.query<T>(sql, params)
  return normalizeQueryRows(result.rows)
}

const postgresExec = async (client: PostgresClient, sql: string, params: unknown[] = []) => {
  const result = await client.query(sql, params)
  return relationalRowCount(result, Number(result.rowCount ?? 0))
}

const sqlServerRequestWithParams = (request: SqlServerRequest, params: unknown[] = []) => {
  params.forEach((param, index) => {
    request.input(`p${index + 1}`, param)
  })
  return request
}

const sqlServerRows = async <T extends Record<string, unknown>>(pool: SqlServerPool, sql: string, params: unknown[] = []) => {
  const result = await sqlServerRequestWithParams(pool.request(), params).query<T>(sql)
  return normalizeQueryRows(result.recordset) as T[]
}

const sqlServerExec = async (pool: SqlServerPool, sql: string, params: unknown[] = []) => {
  const result = await sqlServerRequestWithParams(pool.request(), params).query(sql)
  return result.rowsAffected?.reduce((sum, value) => sum + Number(value || 0), 0) ?? 0
}

const oracleExecuteOptions = () => {
  const driver = loadOracleRuntime()
  return driver?.OUT_FORMAT_OBJECT ? { outFormat: driver.OUT_FORMAT_OBJECT } : {}
}

const oracleColumnsFromMetadata = (metaData: OracleExecuteResult['metaData'] | undefined) =>
  (metaData ?? [])
    .map((field) => (typeof field === 'string' ? field : trim(field.name)))
    .filter(Boolean)

const oracleRowsFromResult = <T extends Record<string, unknown>>(result: OracleExecuteResult) => {
  const columns = oracleColumnsFromMetadata(result.metaData)
  const rows = Array.isArray(result.rows) ? result.rows : []
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return Object.fromEntries(row.map((value, index) => [columns[index] || `column_${index + 1}`, value])) as T
    }
    return row && typeof row === 'object' ? ({ ...(row as Record<string, unknown>) } as T) : ({ value: row } as unknown as T)
  })
}

const oracleRows = async <T extends Record<string, unknown>>(client: OracleConnection, sql: string, params: unknown[] = []) => {
  const result = await client.execute(sql, params, oracleExecuteOptions())
  return oracleRowsFromResult<T>(result)
}

const oracleExec = async (client: OracleConnection, sql: string, params: unknown[] = []) => {
  const result = await client.execute(sql, params, oracleExecuteOptions())
  return relationalRowCount(result, Number(result.rowsAffected ?? 0))
}

const oracleCommit = async (client: OracleConnection) => {
  if (client.commit) return client.commit()
  return oracleExec(client, 'COMMIT')
}

const oracleRollback = async (client: OracleConnection) => {
  if (client.rollback) return client.rollback()
  return oracleExec(client, 'ROLLBACK')
}

const rowValue = (row: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
    const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
    if (found) return row[found]
  }
  return undefined
}

const testRelationalDatabaseConnection = async (input: DatabaseConnectionTestInput, startedAt: number): Promise<DatabaseConnectionTestResult> => {
  if (input.dbType === 'mysql') {
    let client: MySqlConnection | null = null
    try {
      client = await openMysqlConnection(input)
      const rows = await mysqlRows<{ version?: string; v?: string }>(client, 'SELECT VERSION() AS version')
      const version = trim(rows[0]?.version || rows[0]?.v)
      return {
        ok: true,
        data: {
          dbType: 'mysql',
          serverVersion: version ? `MySQL ${version}` : 'MySQL',
          endpoint: endpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return { ok: false, errorCode: relationalErrorCode(error, 'DB_MYSQL_CONNECTION_FAILED'), errorMessage: relationalErrorMessage(error, 'MySQL connection failed.') }
    } finally {
      if (client) {
        try {
          await client.end()
        } catch {
          client.destroy?.()
        }
      }
    }
  }

  if (input.dbType === 'oracle') {
    let client: OracleConnection | null = null
    try {
      client = await openOracleConnection(input)
      const versionRows = await oracleRows<{ version?: string; BANNER?: string }>(
        client,
        "SELECT banner AS version FROM v$version WHERE banner LIKE 'Oracle%' AND ROWNUM = 1"
      ).catch(() => [])
      const contextRows = versionRows.length
        ? []
        : await oracleRows<{ db_name?: string; service_name?: string; DB_NAME?: string; SERVICE_NAME?: string }>(
            client,
            "SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS db_name, SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS service_name FROM DUAL"
          ).catch(() => [])
      const version = trim(rowValue(versionRows[0] ?? {}, 'VERSION', 'version', 'BANNER', 'banner'))
      const fallbackName = trim(contextRows[0]?.db_name || contextRows[0]?.DB_NAME || contextRows[0]?.service_name || contextRows[0]?.SERVICE_NAME)
      return {
        ok: true,
        data: {
          dbType: 'oracle',
          serverVersion: version || (fallbackName ? `Oracle ${fallbackName}` : 'Oracle'),
          endpoint: endpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return { ok: false, errorCode: relationalErrorCode(error, 'DB_ORACLE_CONNECTION_FAILED'), errorMessage: relationalErrorMessage(error, 'Oracle connection failed.') }
    } finally {
      if (client) {
        try {
          await client.close()
        } catch {
          /* ignore close errors */
        }
      }
    }
  }

  if (input.dbType === 'sqlserver') {
    let client: SqlServerPool | null = null
    try {
      client = await openSqlServerPool(input)
      const rows = await sqlServerRows<Record<string, unknown>>(client, "SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(128)) AS version")
      const version = trim(rowValue(rows[0] ?? {}, 'version', 'VERSION'))
      return {
        ok: true,
        data: {
          dbType: 'sqlserver',
          serverVersion: version ? `SQL Server ${version}` : 'SQL Server',
          endpoint: endpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: relationalErrorCode(error, 'DB_SQLSERVER_CONNECTION_FAILED'),
        errorMessage: relationalErrorMessage(error, 'SQL Server connection failed.')
      }
    } finally {
      if (client) {
        try {
          await client.close()
        } catch {
          /* ignore close errors */
        }
      }
    }
  }

  let client: PostgresClient | null = null
  try {
    client = await openPostgresClient(input)
    const rows = await postgresRows<{ version?: string }>(client, 'SELECT version() AS version')
    const version = trim(rows[0]?.version)
    return {
      ok: true,
      data: {
        dbType: 'postgresql',
        serverVersion: version || 'PostgreSQL',
        endpoint: endpointFor(input),
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  } catch (error) {
    return { ok: false, errorCode: relationalErrorCode(error, 'DB_POSTGRES_CONNECTION_FAILED'), errorMessage: relationalErrorMessage(error, 'PostgreSQL connection failed.') }
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        /* ignore close errors */
      }
    }
  }
}

const databaseColumnId = (connectionId: string, tableName: string) => `tbl-${connectionId}-${tableName.replace(/[^A-Za-z0-9_-]+/g, '-')}`

const mysqlCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withMysqlConnection(connection, async (client) => {
    const schemaRows = await mysqlRows<{ SCHEMA_NAME?: string; schema_name?: string }>(
      client,
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') ORDER BY SCHEMA_NAME"
    )
    const catalogNames = schemaRows.map((row) => trim(row.SCHEMA_NAME || row.schema_name)).filter(Boolean)
    const selected = trim(connection.database)
    const orderedCatalogs = Array.from(new Set([selected, ...catalogNames].filter(Boolean)))
    const catalogs: DatabaseCatalogInfo[] = []

    for (const catalogName of orderedCatalogs) {
      const tableRows = await mysqlRows<{ TABLE_NAME?: string; table_name?: string; TABLE_TYPE?: string; table_type?: string }>(
        client,
        'SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
        [catalogName]
      )
      const columnRows = await mysqlRows<{
        TABLE_NAME?: string
        table_name?: string
        COLUMN_NAME?: string
        column_name?: string
        COLUMN_TYPE?: string
        column_type?: string
        DATA_TYPE?: string
        data_type?: string
        IS_NULLABLE?: string
        is_nullable?: string
        COLUMN_KEY?: string
        column_key?: string
      }>(
        client,
        'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
        [catalogName]
      )
      const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
      columnRows.forEach((row) => {
        const tableName = trim(row.TABLE_NAME || row.table_name)
        const name = trim(row.COLUMN_NAME || row.column_name)
        if (!tableName || !name) return
        const column: DatabaseColumnInfo = {
          name,
          type: trim(row.COLUMN_TYPE || row.column_type || row.DATA_TYPE || row.data_type) || 'unknown',
          nullable: trim(row.IS_NULLABLE || row.is_nullable).toUpperCase() !== 'NO',
          ...(trim(row.COLUMN_KEY || row.column_key).toUpperCase() === 'PRI' ? { key: 'PK' as const } : {})
        }
        columnsByTable.set(tableName, [...(columnsByTable.get(tableName) ?? []), column])
      })
      catalogs.push({
        name: catalogName,
        tables: tableRows
          .filter((row) => trim(row.TABLE_TYPE || row.table_type).toUpperCase() !== 'VIEW')
          .map((row) => {
            const name = trim(row.TABLE_NAME || row.table_name)
            const columns = columnsByTable.get(name) ?? []
            return {
              id: databaseColumnId(connection.id, `${catalogName}-${name}`),
              name,
              columns,
              primaryKey: sqlitePrimaryKeyForColumns(columns)
            }
          })
          .filter((table) => table.name)
      })
    }

    return catalogs
  })

const postgresCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withPostgresClient(connection, async (client) => {
    const databaseName = trim(connection.database)
    const schemaRows = await postgresRows<{ schema_name?: string }>(
      client,
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_toast%' AND schema_name NOT LIKE 'pg_temp_%' ORDER BY schema_name"
    )
    const objectRows = await postgresRows<{ table_schema?: string; table_name?: string; table_type?: string }>(
      client,
      "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_catalog = current_database() AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp_%' ORDER BY table_schema, table_name"
    )
    const columnRows = await postgresRows<{
      table_schema?: string
      table_name?: string
      column_name?: string
      data_type?: string
      udt_name?: string
      character_maximum_length?: number | null
      is_nullable?: string
    }>(
      client,
      "SELECT table_schema, table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_catalog = current_database() AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp_%' ORDER BY table_schema, table_name, ordinal_position"
    )
    const primaryKeyRows = await postgresRows<{ table_schema?: string; table_name?: string; column_name?: string }>(
      client,
      "SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_catalog = current_database() ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position"
    )
    const routineRows = await postgresRows<{ routine_schema?: string; routine_name?: string; routine_type?: string }>(
      client,
      "SELECT routine_schema, routine_name, routine_type FROM information_schema.routines WHERE specific_catalog = current_database() AND routine_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY routine_schema, routine_name"
    )

    const pkByTable = new Map<string, string[]>()
    primaryKeyRows.forEach((row) => {
      const key = `${trim(row.table_schema)}.${trim(row.table_name)}`
      const column = trim(row.column_name)
      if (key !== '.' && column) pkByTable.set(key, [...(pkByTable.get(key) ?? []), column])
    })
    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const key = `${trim(row.table_schema)}.${trim(row.table_name)}`
      const name = trim(row.column_name)
      if (key === '.' || !name) return
      const primaryKey = pkByTable.get(key) ?? []
      const type = trim(row.character_maximum_length) && trim(row.data_type).includes('character') ? `${trim(row.data_type)}(${row.character_maximum_length})` : trim(row.data_type || row.udt_name) || 'unknown'
      columnsByTable.set(key, [
        ...(columnsByTable.get(key) ?? []),
        {
          name,
          type,
          nullable: trim(row.is_nullable).toUpperCase() !== 'NO',
          ...(primaryKey.includes(name) ? { key: 'PK' as const } : {})
        }
      ])
    })

    const schemas = schemaRows
      .map((row) => trim(row.schema_name))
      .filter(Boolean)
      .map((schemaName): DatabaseSchemaInfo => {
        const schemaObjects = objectRows.filter((row) => trim(row.table_schema) === schemaName)
        const functions = routineRows
          .filter((row) => trim(row.routine_schema) === schemaName && trim(row.routine_type).toUpperCase() === 'FUNCTION')
          .map((row) => trim(row.routine_name))
          .filter(Boolean)
        const procedures = routineRows
          .filter((row) => trim(row.routine_schema) === schemaName && trim(row.routine_type).toUpperCase() === 'PROCEDURE')
          .map((row) => trim(row.routine_name))
          .filter(Boolean)
        const tableFor = (row: { table_name?: string }) => {
          const name = trim(row.table_name)
          const key = `${schemaName}.${name}`
          const columns = columnsByTable.get(key) ?? []
          return {
            id: databaseColumnId(connection.id, `${databaseName}-${schemaName}-${name}`),
            name,
            columns,
            primaryKey: pkByTable.get(key) ?? []
          }
        }
        return {
          name: schemaName,
          tables: schemaObjects
            .filter((row) => trim(row.table_type).toUpperCase() === 'BASE TABLE')
            .map(tableFor)
            .filter((table) => table.name),
          views: schemaObjects
            .filter((row) => trim(row.table_type).toUpperCase() === 'VIEW')
            .map(tableFor)
            .filter((table) => table.name),
          functions,
          procedures
        }
      })
      .filter(schemaHasObjects)

    return [{ name: databaseName, schemas }]
  })

const oracleSystemSchemas = [
  'ANONYMOUS',
  'APEX_PUBLIC_USER',
  'APPQOSSYS',
  'AUDSYS',
  'CTXSYS',
  'DBSFWUSER',
  'DBSNMP',
  'DIP',
  'DVF',
  'DVSYS',
  'GGSYS',
  'GSMADMIN_INTERNAL',
  'GSMCATUSER',
  'GSMUSER',
  'LBACSYS',
  'MDSYS',
  'OJVMSYS',
  'OLAPSYS',
  'ORACLE_OCM',
  'ORDDATA',
  'ORDPLUGINS',
  'ORDSYS',
  'OUTLN',
  'REMOTE_SCHEDULER_AGENT',
  'SI_INFORMTN_SCHEMA',
  'SYS',
  'SYS$UMF',
  'SYSBACKUP',
  'SYSDG',
  'SYSKM',
  'SYSRAC',
  'SYSTEM',
  'WMSYS',
  'XDB',
  'XS$NULL'
]
const oracleSystemSchemaListSql = oracleSystemSchemas.map((schema) => `'${schema}'`).join(', ')

const oracleColumnType = (row: Record<string, unknown>) => {
  const dataType = trim(rowValue(row, 'DATA_TYPE', 'data_type')).toUpperCase()
  const length = Number(rowValue(row, 'DATA_LENGTH', 'data_length'))
  const precision = Number(rowValue(row, 'DATA_PRECISION', 'data_precision'))
  const scale = Number(rowValue(row, 'DATA_SCALE', 'data_scale'))
  if ((dataType.includes('CHAR') || dataType === 'RAW') && Number.isFinite(length) && length > 0) return `${dataType}(${length})`
  if (dataType === 'NUMBER' && Number.isFinite(precision) && precision > 0) {
    return Number.isFinite(scale) && scale > 0 ? `${dataType}(${precision}, ${scale})` : `${dataType}(${precision})`
  }
  return dataType || 'UNKNOWN'
}

const oracleCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withOracleConnection(connection, async (client) => {
    const contextRows = await oracleRows<Record<string, unknown>>(
      client,
      "SELECT SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS service_name, SYS_CONTEXT('USERENV', 'DB_NAME') AS db_name FROM DUAL"
    ).catch(() => [])
    const databaseName =
      trim(connection.database) ||
      trim(rowValue(contextRows[0] ?? {}, 'SERVICE_NAME', 'service_name')) ||
      trim(rowValue(contextRows[0] ?? {}, 'DB_NAME', 'db_name')) ||
      oracleConnectStringFromInput(connection)
    const schemaRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT DISTINCT owner FROM all_objects WHERE owner NOT IN (${oracleSystemSchemaListSql}) ORDER BY owner`
    )
    const objectRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT owner, object_name, object_type FROM all_objects WHERE owner NOT IN (${oracleSystemSchemaListSql}) AND object_type IN ('TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE') ORDER BY owner, object_type, object_name`
    )
    const columnRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT owner, table_name, column_name, data_type, data_length, data_precision, data_scale, nullable FROM all_tab_columns WHERE owner NOT IN (${oracleSystemSchemaListSql}) ORDER BY owner, table_name, column_id`
    )
    const primaryKeyRows = await oracleRows<Record<string, unknown>>(
      client,
      `SELECT c.owner, c.table_name, cc.column_name FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name AND cc.table_name = c.table_name WHERE c.constraint_type = 'P' AND c.owner NOT IN (${oracleSystemSchemaListSql}) ORDER BY c.owner, c.table_name, cc.position`
    )

    const pkByTable = new Map<string, string[]>()
    primaryKeyRows.forEach((row) => {
      const owner = trim(rowValue(row, 'OWNER', 'owner'))
      const tableName = trim(rowValue(row, 'TABLE_NAME', 'table_name'))
      const column = trim(rowValue(row, 'COLUMN_NAME', 'column_name'))
      const key = `${owner}.${tableName}`
      if (owner && tableName && column) pkByTable.set(key, [...(pkByTable.get(key) ?? []), column])
    })

    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const owner = trim(rowValue(row, 'OWNER', 'owner'))
      const tableName = trim(rowValue(row, 'TABLE_NAME', 'table_name'))
      const name = trim(rowValue(row, 'COLUMN_NAME', 'column_name'))
      if (!owner || !tableName || !name) return
      const key = `${owner}.${tableName}`
      const primaryKey = pkByTable.get(key) ?? []
      columnsByTable.set(key, [
        ...(columnsByTable.get(key) ?? []),
        {
          name,
          type: oracleColumnType(row),
          nullable: trim(rowValue(row, 'NULLABLE', 'nullable')).toUpperCase() !== 'N',
          ...(primaryKey.includes(name) ? { key: 'PK' as const } : {})
        }
      ])
    })

    const objectOwners = new Set(objectRows.map((row) => trim(rowValue(row, 'OWNER', 'owner'))).filter(Boolean))
    const orderedSchemas = Array.from(
      new Set([...schemaRows.map((row) => trim(rowValue(row, 'OWNER', 'owner'))).filter(Boolean), ...Array.from(objectOwners)])
    ).sort((first, second) => first.localeCompare(second))
    const schemas = orderedSchemas
      .map((schemaName): DatabaseSchemaInfo => {
        const schemaObjects = objectRows.filter((row) => trim(rowValue(row, 'OWNER', 'owner')) === schemaName)
        const functions = schemaObjects
          .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'FUNCTION')
          .map((row) => trim(rowValue(row, 'OBJECT_NAME', 'object_name')))
          .filter(Boolean)
        const procedures = schemaObjects
          .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'PROCEDURE')
          .map((row) => trim(rowValue(row, 'OBJECT_NAME', 'object_name')))
          .filter(Boolean)
        const tableFor = (row: Record<string, unknown>) => {
          const name = trim(rowValue(row, 'OBJECT_NAME', 'object_name'))
          const key = `${schemaName}.${name}`
          const columns = columnsByTable.get(key) ?? []
          return {
            id: databaseColumnId(connection.id, `${databaseName}-${schemaName}-${name}`),
            name,
            columns,
            primaryKey: pkByTable.get(key) ?? []
          }
        }
        return {
          name: schemaName,
          tables: schemaObjects
            .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'TABLE')
            .map(tableFor)
            .filter((table) => table.name),
          views: schemaObjects
            .filter((row) => trim(rowValue(row, 'OBJECT_TYPE', 'object_type')).toUpperCase() === 'VIEW')
            .map(tableFor)
            .filter((table) => table.name),
          functions,
          procedures
        }
      })
      .filter(schemaHasObjects)

    return [{ name: databaseName, schemas }]
  })

const sqlServerColumnType = (row: Record<string, unknown>) => {
  const dataType = trim(rowValue(row, 'DATA_TYPE', 'data_type')).toLowerCase()
  const maxLength = Number(rowValue(row, 'CHARACTER_MAXIMUM_LENGTH', 'character_maximum_length', 'max_length'))
  const precision = Number(rowValue(row, 'NUMERIC_PRECISION', 'numeric_precision', 'precision'))
  const scale = Number(rowValue(row, 'NUMERIC_SCALE', 'numeric_scale', 'scale'))
  if (['varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary'].includes(dataType) && Number.isFinite(maxLength)) {
    const displayLength = ['nvarchar', 'nchar'].includes(dataType) && maxLength > 0 ? Math.floor(maxLength / 2) : maxLength
    return `${dataType}(${displayLength < 0 ? 'max' : displayLength})`
  }
  if (['decimal', 'numeric'].includes(dataType) && Number.isFinite(precision) && precision > 0) {
    return Number.isFinite(scale) && scale >= 0 ? `${dataType}(${precision}, ${scale})` : `${dataType}(${precision})`
  }
  return dataType || 'unknown'
}

const sqlServerCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> =>
  withSqlServerPool(connection, async (client) => {
    const databaseRows = await sqlServerRows<Record<string, unknown>>(client, 'SELECT DB_NAME() AS database_name').catch(() => [])
    const databaseName = trim(rowValue(databaseRows[0] ?? {}, 'database_name', 'DATABASE_NAME')) || trim(connection.database)
    const schemaRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT name AS schema_name FROM sys.schemas WHERE name NOT IN ('INFORMATION_SCHEMA', 'sys') ORDER BY name"
    )
    const objectRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT s.name AS schema_name, o.name AS object_name, o.type AS object_type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('U', 'V', 'FN', 'IF', 'TF', 'P', 'PC') AND s.name NOT IN ('INFORMATION_SCHEMA', 'sys') ORDER BY s.name, o.type, o.name"
    )
    const columnRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT s.name AS schema_name, o.name AS table_name, c.name AS column_name, t.name AS data_type, c.max_length AS character_maximum_length, c.precision AS numeric_precision, c.scale AS numeric_scale, c.is_nullable FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE o.type IN ('U', 'V') AND s.name NOT IN ('INFORMATION_SCHEMA', 'sys') ORDER BY s.name, o.name, c.column_id"
    )
    const primaryKeyRows = await sqlServerRows<Record<string, unknown>>(
      client,
      "SELECT s.name AS schema_name, o.name AS table_name, c.name AS column_name FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.objects o ON o.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE kc.type = 'PK' ORDER BY s.name, o.name, ic.key_ordinal"
    )

    const pkByTable = new Map<string, string[]>()
    primaryKeyRows.forEach((row) => {
      const schemaName = trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))
      const tableName = trim(rowValue(row, 'table_name', 'TABLE_NAME'))
      const column = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
      const key = `${schemaName}.${tableName}`
      if (schemaName && tableName && column) pkByTable.set(key, [...(pkByTable.get(key) ?? []), column])
    })

    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const schemaName = trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))
      const tableName = trim(rowValue(row, 'table_name', 'TABLE_NAME'))
      const name = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
      if (!schemaName || !tableName || !name) return
      const key = `${schemaName}.${tableName}`
      const primaryKey = pkByTable.get(key) ?? []
      columnsByTable.set(key, [
        ...(columnsByTable.get(key) ?? []),
        {
          name,
          type: sqlServerColumnType(row),
          nullable: Boolean(rowValue(row, 'is_nullable', 'IS_NULLABLE')),
          ...(primaryKey.includes(name) ? { key: 'PK' as const } : {})
        }
      ])
    })

    const objectSchemas = new Set(objectRows.map((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))).filter(Boolean))
    const orderedSchemas = Array.from(
      new Set([...schemaRows.map((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))).filter(Boolean), ...Array.from(objectSchemas)])
    ).sort((first, second) => first.localeCompare(second))
    const schemas = orderedSchemas
      .map((schemaName): DatabaseSchemaInfo => {
        const schemaObjects = objectRows.filter((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME')) === schemaName)
        const functions = schemaObjects
          .filter((row) => ['FN', 'IF', 'TF'].includes(trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase()))
          .map((row) => trim(rowValue(row, 'object_name', 'OBJECT_NAME')))
          .filter(Boolean)
        const procedures = schemaObjects
          .filter((row) => ['P', 'PC'].includes(trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase()))
          .map((row) => trim(rowValue(row, 'object_name', 'OBJECT_NAME')))
          .filter(Boolean)
        const tableFor = (row: Record<string, unknown>) => {
          const name = trim(rowValue(row, 'object_name', 'OBJECT_NAME'))
          const key = `${schemaName}.${name}`
          const columns = columnsByTable.get(key) ?? []
          return {
            id: databaseColumnId(connection.id, `${databaseName}-${schemaName}-${name}`),
            name,
            columns,
            primaryKey: pkByTable.get(key) ?? []
          }
        }
        return {
          name: schemaName,
          tables: schemaObjects
            .filter((row) => trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase() === 'U')
            .map(tableFor)
            .filter((table) => table.name),
          views: schemaObjects
            .filter((row) => trim(rowValue(row, 'object_type', 'OBJECT_TYPE')).toUpperCase() === 'V')
            .map(tableFor)
            .filter((table) => table.name),
          functions,
          procedures
        }
      })
      .filter(schemaHasObjects)

    return [{ name: databaseName, schemas }]
  })

const relationalCatalogsForConnection = (connection: DatabaseConnectionInfo) =>
  connection.dbType === 'mysql'
    ? mysqlCatalogsForConnection(connection)
    : connection.dbType === 'oracle'
      ? oracleCatalogsForConnection(connection)
      : connection.dbType === 'sqlserver'
        ? sqlServerCatalogsForConnection(connection)
        : postgresCatalogsForConnection(connection)

const applyConnectionFailure = (connectionId: string, error: unknown, fallbackCode: string, fallbackMessage: string) => {
  const index = databaseConnections.findIndex((connection) => connection.id === connectionId)
  if (index >= 0) databaseConnections[index] = { ...databaseConnections[index], status: 'failed' }
  return {
    ok: false as const,
    errorCode: relationalErrorCode(error, fallbackCode),
    errorMessage: relationalErrorMessage(error, fallbackMessage)
  }
}

const relationalColumnsForTable = async (
  connection: DatabaseConnectionInfo,
  input: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName' | 'tableName'>
): Promise<DatabaseColumnInfo[]> => {
  if (connection.dbType === 'mysql') {
    return withMysqlConnection(connection, async (client) =>
      mysqlRows<{
        COLUMN_NAME?: string
        COLUMN_TYPE?: string
        DATA_TYPE?: string
        IS_NULLABLE?: string
        COLUMN_KEY?: string
      }>(
        client,
        'SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [trim(input.databaseName), trim(input.tableName)]
      ).then((rows) =>
        rows.map((row) => ({
          name: trim(row.COLUMN_NAME),
          type: trim(row.COLUMN_TYPE || row.DATA_TYPE) || 'unknown',
          nullable: trim(row.IS_NULLABLE).toUpperCase() !== 'NO',
          ...(trim(row.COLUMN_KEY).toUpperCase() === 'PRI' ? { key: 'PK' as const } : {})
        }))
      )
    )
  }
  if (connection.dbType === 'oracle') {
    return withOracleConnection(connection, async (client) => {
      const schemaName = oracleSchemaNameFor(connection, input)
      const tableName = oracleLookupIdentifier(input.tableName)
      const primaryKeys = await oracleRows<Record<string, unknown>>(
        client,
        "SELECT cc.column_name FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name AND cc.table_name = c.table_name WHERE c.constraint_type = 'P' AND c.owner = :1 AND c.table_name = :2 ORDER BY cc.position",
        [schemaName, tableName]
      )
      const pk = primaryKeys.map((row) => trim(rowValue(row, 'COLUMN_NAME', 'column_name'))).filter(Boolean)
      const rows = await oracleRows<Record<string, unknown>>(
        client,
        'SELECT column_name, data_type, data_length, data_precision, data_scale, nullable FROM all_tab_columns WHERE owner = :1 AND table_name = :2 ORDER BY column_id',
        [schemaName, tableName]
      )
      return rows.map((row) => {
        const name = trim(rowValue(row, 'COLUMN_NAME', 'column_name'))
        return {
          name,
          type: oracleColumnType(row),
          nullable: trim(rowValue(row, 'NULLABLE', 'nullable')).toUpperCase() !== 'N',
          ...(pk.includes(name) ? { key: 'PK' as const } : {})
        }
      })
    })
  }
  if (connection.dbType === 'sqlserver') {
    return withSqlServerPool(connection, async (client) => {
      const schemaName = trim(input.schemaName) || 'dbo'
      const primaryKeys = await sqlServerRows<Record<string, unknown>>(
        client,
        "SELECT c.name AS column_name FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.objects o ON o.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE kc.type = 'PK' AND s.name = @p1 AND o.name = @p2 ORDER BY ic.key_ordinal",
        [schemaName, trim(input.tableName)]
      )
      const pk = primaryKeys.map((row) => trim(rowValue(row, 'column_name', 'COLUMN_NAME'))).filter(Boolean)
      const rows = await sqlServerRows<Record<string, unknown>>(
        client,
        "SELECT c.name AS column_name, t.name AS data_type, c.max_length AS character_maximum_length, c.precision AS numeric_precision, c.scale AS numeric_scale, c.is_nullable FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE s.name = @p1 AND o.name = @p2 ORDER BY c.column_id",
        [schemaName, trim(input.tableName)]
      )
      return rows.map((row) => {
        const name = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
        return {
          name,
          type: sqlServerColumnType(row),
          nullable: Boolean(rowValue(row, 'is_nullable', 'IS_NULLABLE')),
          ...(pk.includes(name) ? { key: 'PK' as const } : {})
        }
      })
    })
  }
  return withPostgresClient(connection, async (client) => {
    const schemaName = trim(input.schemaName) || 'public'
    const primaryKeys = await postgresRows<{ column_name?: string }>(
      client,
      "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position",
      [schemaName, trim(input.tableName)]
    )
    const pk = primaryKeys.map((row) => trim(row.column_name)).filter(Boolean)
    const rows = await postgresRows<{
      column_name?: string
      data_type?: string
      udt_name?: string
      character_maximum_length?: number | null
      is_nullable?: string
    }>(
      client,
      'SELECT column_name, data_type, udt_name, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
      [schemaName, trim(input.tableName)]
    )
    return rows.map((row) => {
      const name = trim(row.column_name)
      const type = trim(row.character_maximum_length) && trim(row.data_type).includes('character') ? `${trim(row.data_type)}(${row.character_maximum_length})` : trim(row.data_type || row.udt_name) || 'unknown'
      return {
        name,
        type,
        nullable: trim(row.is_nullable).toUpperCase() !== 'NO',
        ...(pk.includes(name) ? { key: 'PK' as const } : {})
      }
    })
  })
}

const relationalWhereForFilters = (dbType: RelationalDatabaseType, filters: DatabaseColumnFilter[], knownColumns: string[]) => {
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const clauses: string[] = []
  const params: unknown[] = []
  filters.forEach((filter) => {
    const column = known.get(trim(filter.column).toLowerCase())
    if (!column) return
    const quoted = relationalIdentifier(column, dbType)
    if (filter.operator === 'isnull') {
      clauses.push(`${quoted} IS NULL`)
      return
    }
    if (filter.operator === 'notnull') {
      clauses.push(`${quoted} IS NOT NULL`)
      return
    }
    if (filter.operator === 'like') {
      params.push(`%${String(filter.value ?? '')}%`)
      clauses.push(`${quoted} LIKE ${relationalPlaceholder(dbType, params.length)}`)
      return
    }
    if (filter.operator === 'eq') {
      params.push(String(filter.value ?? ''))
      clauses.push(`${quoted} = ${relationalPlaceholder(dbType, params.length)}`)
      return
    }
    if (filter.operator === 'neq') {
      params.push(String(filter.value ?? ''))
      clauses.push(`${quoted} <> ${relationalPlaceholder(dbType, params.length)}`)
      return
    }
    const values = (filter.values ?? []).map(String)
    if (!values.length) {
      clauses.push('0 = 1')
      return
    }
    const placeholders = values.map((value) => {
      params.push(value)
      return relationalPlaceholder(dbType, params.length)
    })
    clauses.push(`${quoted} IN (${placeholders.join(', ')})`)
  })
  return {
    sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    params
  }
}

const relationalOrderByFor = (dbType: RelationalDatabaseType, sort: DatabaseColumnSort | null | undefined, knownColumns: string[]) => {
  if (!sort) return ''
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const column = known.get(trim(sort.column).toLowerCase())
  if (!column) return ''
  return ` ORDER BY ${relationalIdentifier(column, dbType)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
}

const relationalQueryTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableQueryInput,
  startedAt: number
): Promise<DatabaseTableQueryResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    const columns = await relationalColumnsForTable(connection, input)
    if (!columns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
    const where = relationalWhereForFilters(dbType, filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = relationalOrderByFor(dbType, sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = relationalTableReference(connection, input)
    const limitPlaceholder = relationalPlaceholder(dbType, where.params.length + (dbType === 'sqlserver' ? 2 : 1))
    const offsetPlaceholder = relationalPlaceholder(dbType, where.params.length + (dbType === 'sqlserver' ? 1 : 2))
    const rowsSql =
      dbType === 'oracle' || dbType === 'sqlserver'
        ? `SELECT * FROM ${tableRef}${where.sql}${orderBy || ' ORDER BY (SELECT 1)'} OFFSET ${offsetPlaceholder} ROWS FETCH NEXT ${limitPlaceholder} ROWS ONLY`
        : `SELECT * FROM ${tableRef}${where.sql}${orderBy} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`
    const countSql = `SELECT COUNT(*) AS total FROM ${tableRef}${where.sql}`
    const params = dbType === 'oracle' || dbType === 'sqlserver' ? [...where.params, offset, pageSize] : [...where.params, pageSize, offset]

    if (connection.dbType === 'mysql') {
      return await withMysqlConnection(connection, async (client) => {
        const rows = await mysqlRows<Record<string, unknown>>(client, rowsSql, params)
        const count = input.withTotal ? await mysqlRows<{ total?: number | string }>(client, countSql, where.params) : []
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows,
            rowCount: rows.length,
            durationMs: Math.max(1, Date.now() - startedAt),
            total: input.withTotal ? Number(count[0]?.total ?? 0) : null,
            knownColumns
          }
        }
      })
    }
    if (connection.dbType === 'oracle') {
      return await withOracleConnection(connection, async (client) => {
        const rows = await oracleRows<Record<string, unknown>>(client, rowsSql, params)
        const count = input.withTotal ? await oracleRows<Record<string, unknown>>(client, countSql, where.params) : []
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows,
            rowCount: rows.length,
            durationMs: Math.max(1, Date.now() - startedAt),
            total: input.withTotal ? Number(rowValue(count[0] ?? {}, 'TOTAL', 'total') ?? 0) : null,
            knownColumns
          }
        }
      })
    }
    if (connection.dbType === 'sqlserver') {
      return await withSqlServerPool(connection, async (client) => {
        const rows = await sqlServerRows<Record<string, unknown>>(client, rowsSql, params)
        const count = input.withTotal ? await sqlServerRows<Record<string, unknown>>(client, countSql, where.params) : []
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows,
            rowCount: rows.length,
            durationMs: Math.max(1, Date.now() - startedAt),
            total: input.withTotal ? Number(rowValue(count[0] ?? {}, 'total', 'TOTAL') ?? 0) : null,
            knownColumns
          }
        }
      })
    }

    return await withPostgresClient(connection, async (client) => {
      const rows = await postgresRows<Record<string, unknown>>(client, rowsSql, params)
      const count = input.withTotal ? await postgresRows<{ total?: number | string }>(client, countSql, where.params) : []
      return {
        ok: true,
        data: {
          columns: knownColumns,
          rows,
          rowCount: rows.length,
          durationMs: Math.max(1, Date.now() - startedAt),
          total: input.withTotal ? Number(count[0]?.total ?? 0) : null,
          knownColumns
        }
      }
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'QUERY_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database table query failed.')
    }
  }
}

const relationalExecute = async (connection: DatabaseConnectionInfo, rawSql: string, startedAt: number): Promise<DatabaseSqlExecuteResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    if (connection.dbType === 'mysql') {
      return await withMysqlConnection(connection, async (client) => {
        const [rawRows, rawFields] = await client.query(rawSql)
        const rows = normalizeQueryRows(rawRows)
        const fields = Array.isArray(rawFields) ? (rawFields as Array<{ name?: string }>) : []
        return {
          ok: true,
          data: {
            columns: fields.map((field) => trim(field.name)).filter(Boolean) || columnsForRows(rows),
            rows,
            rowCount: rows.length || relationalRowCount(rawRows),
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      })
    }
    if (connection.dbType === 'oracle') {
      return await withOracleConnection(connection, async (client) => {
        const result = await client.execute(rawSql, [], oracleExecuteOptions())
        const rows = oracleRowsFromResult<Record<string, unknown>>(result)
        const columns = oracleColumnsFromMetadata(result.metaData)
        return {
          ok: true,
          data: {
            columns: columns.length ? columns : columnsForRows(rows),
            rows,
            rowCount: rows.length || Number(result.rowsAffected ?? 0),
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      })
    }
    if (connection.dbType === 'sqlserver') {
      return await withSqlServerPool(connection, async (client) => {
        const result = await client.request().query<Record<string, unknown>>(rawSql)
        const rows = normalizeQueryRows(result.recordset)
        return {
          ok: true,
          data: {
            columns: columnsForRows(rows),
            rows,
            rowCount: rows.length || result.rowsAffected?.reduce((sum, value) => sum + Number(value || 0), 0) || 0,
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      })
    }
    return await withPostgresClient(connection, async (client) => {
      const result = await client.query<Record<string, unknown>>(rawSql)
      const rows = normalizeQueryRows(result.rows)
      const columns = Array.isArray(result.fields) && result.fields.length ? result.fields.map((field) => trim(field.name)).filter(Boolean) : columnsForRows(rows)
      return {
        ok: true,
        data: {
          columns,
          rows,
          rowCount: rows.length || Number(result.rowCount ?? 0),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'QUERY_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database query failed.')
    }
  }
}

const postgresColumnTypeDdl = (row: {
  data_type?: string
  udt_name?: string
  character_maximum_length?: number | null
  numeric_precision?: number | null
  numeric_scale?: number | null
}) => {
  const dataType = trim(row.data_type)
  if (row.character_maximum_length && dataType.includes('character')) return `${dataType}(${row.character_maximum_length})`
  if (row.numeric_precision && dataType === 'numeric') return row.numeric_scale ? `numeric(${row.numeric_precision}, ${row.numeric_scale})` : `numeric(${row.numeric_precision})`
  return dataType || trim(row.udt_name) || 'text'
}

const sqlServerColumnTypeDdl = (row: Record<string, unknown>) => sqlServerColumnType(row)

const oracleDdlPermissionError = (error: unknown) => {
  const message = relationalErrorMessage(error, '')
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return /ORA-01031|insufficient privileges|permission/i.test(`${code} ${message}`)
}

const relationalTableDdl = async (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    if (connection.dbType === 'mysql') {
      return await withMysqlConnection(connection, async (client) => {
        const rows = await mysqlRows<Record<string, unknown>>(
          client,
          `SHOW CREATE TABLE ${relationalTableReference(connection, input)}`
        )
        const values = Object.values(rows[0] ?? {})
        const ddl = values.find((value, index) => index > 0 && typeof value === 'string')
        if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        return { ok: true, data: { ddl: String(ddl) } }
      })
    }
    if (connection.dbType === 'oracle') {
      return await withOracleConnection(connection, async (client) => {
        const schemaName = oracleSchemaNameFor(connection, input)
        const tableName = oracleLookupIdentifier(input.tableName)
        const objectRows = await oracleRows<Record<string, unknown>>(
          client,
          "SELECT object_type FROM all_objects WHERE owner = :1 AND object_name = :2 AND object_type IN ('TABLE', 'VIEW') ORDER BY CASE object_type WHEN 'TABLE' THEN 1 ELSE 2 END",
          [schemaName, tableName]
        )
        const objectType = trim(rowValue(objectRows[0] ?? {}, 'OBJECT_TYPE', 'object_type'))
        if (!objectType) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        try {
          const rows = await oracleRows<Record<string, unknown>>(
            client,
            'SELECT DBMS_METADATA.GET_DDL(:1, :2, :3) AS ddl FROM dual',
            [objectType, tableName, schemaName]
          )
          const ddl = trim(rowValue(rows[0] ?? {}, 'DDL', 'ddl'))
          if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
          return { ok: true, data: { ddl } }
        } catch (error) {
          if (oracleDdlPermissionError(error)) {
            return { ok: false, errorCode: 'permission', errorMessage: 'DDL requires elevated catalog permission.' }
          }
          throw error
        }
      })
    }
    if (connection.dbType === 'sqlserver') {
      return await withSqlServerPool(connection, async (client) => {
        const schemaName = trim(input.schemaName) || 'dbo'
        const tableName = trim(input.tableName)
        const objectRows = await sqlServerRows<Record<string, unknown>>(
          client,
          "SELECT o.type AS object_type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = @p1 AND o.name = @p2 AND o.type IN ('U', 'V')",
          [schemaName, tableName]
        )
        const objectType = trim(rowValue(objectRows[0] ?? {}, 'object_type', 'OBJECT_TYPE')).toUpperCase()
        if (!objectType) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        if (objectType === 'V') {
          const viewRows = await sqlServerRows<Record<string, unknown>>(
            client,
            "SELECT sm.definition AS ddl FROM sys.sql_modules sm JOIN sys.objects o ON o.object_id = sm.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = @p1 AND o.name = @p2 AND o.type = 'V'",
            [schemaName, tableName]
          ).catch(() => [])
          const viewDdl = trim(rowValue(viewRows[0] ?? {}, 'ddl', 'DDL'))
          if (!viewDdl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
          return { ok: true, data: { ddl: viewDdl } }
        }
        const columns = await sqlServerRows<Record<string, unknown>>(
          client,
          "SELECT c.name AS column_name, t.name AS data_type, c.max_length AS character_maximum_length, c.precision AS numeric_precision, c.scale AS numeric_scale, c.is_nullable, dc.definition AS column_default FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types t ON t.user_type_id = c.user_type_id LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id WHERE s.name = @p1 AND o.name = @p2 AND o.type = 'U' ORDER BY c.column_id",
          [schemaName, tableName]
        )
        if (!columns.length) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const primaryKeys = await sqlServerRows<Record<string, unknown>>(
          client,
          "SELECT c.name AS column_name FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id JOIN sys.objects o ON o.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE kc.type = 'PK' AND s.name = @p1 AND o.name = @p2 ORDER BY ic.key_ordinal",
          [schemaName, tableName]
        )
        const columnLines = columns.map((row) => {
          const pieces = [
            `  ${relationalIdentifier(trim(rowValue(row, 'column_name', 'COLUMN_NAME')), 'sqlserver')} ${sqlServerColumnTypeDdl(row)}`,
            Boolean(rowValue(row, 'is_nullable', 'IS_NULLABLE')) ? 'NULL' : 'NOT NULL',
            trim(rowValue(row, 'column_default', 'COLUMN_DEFAULT')) ? `DEFAULT ${trim(rowValue(row, 'column_default', 'COLUMN_DEFAULT'))}` : ''
          ].filter(Boolean)
          return pieces.join(' ')
        })
        const pk = primaryKeys.map((row) => trim(rowValue(row, 'column_name', 'COLUMN_NAME'))).filter(Boolean)
        if (pk.length) {
          columnLines.push(`  PRIMARY KEY (${pk.map((column) => relationalIdentifier(column, 'sqlserver')).join(', ')})`)
        }
        return { ok: true, data: { ddl: `CREATE TABLE ${relationalTableReference(connection, input)} (\n${columnLines.join(',\n')}\n);` } }
      })
    }

    return await withPostgresClient(connection, async (client) => {
      const schemaName = trim(input.schemaName) || 'public'
      const tableName = trim(input.tableName)
      const columns = await postgresRows<{
        column_name?: string
        data_type?: string
        udt_name?: string
        character_maximum_length?: number | null
        numeric_precision?: number | null
        numeric_scale?: number | null
        is_nullable?: string
        column_default?: string | null
      }>(
        client,
        'SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        [schemaName, tableName]
      )
      if (!columns.length) {
        const viewRows = await postgresRows<{ ddl?: string }>(
          client,
          'SELECT pg_get_viewdef(($1)::regclass, true) AS ddl',
          [`${relationalIdentifier(schemaName, 'postgresql')}.${relationalIdentifier(tableName, 'postgresql')}`]
        ).catch(() => [])
        const viewDdl = trim(viewRows[0]?.ddl)
        if (!viewDdl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        return { ok: true, data: { ddl: `CREATE VIEW ${relationalTableReference(connection, input)} AS\n${viewDdl};` } }
      }
      const primaryKeys = await postgresRows<{ column_name?: string }>(
        client,
        "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position",
        [schemaName, tableName]
      )
      const columnLines = columns.map((row) => {
        const pieces = [
          `  ${relationalIdentifier(trim(row.column_name), 'postgresql')} ${postgresColumnTypeDdl(row)}`,
          trim(row.is_nullable).toUpperCase() === 'NO' ? 'NOT NULL' : '',
          trim(row.column_default) ? `DEFAULT ${trim(row.column_default)}` : ''
        ].filter(Boolean)
        return pieces.join(' ')
      })
      const pk = primaryKeys.map((row) => trim(row.column_name)).filter(Boolean)
      if (pk.length) {
        columnLines.push(`  PRIMARY KEY (${pk.map((column) => relationalIdentifier(column, 'postgresql')).join(', ')})`)
      }
      return { ok: true, data: { ddl: `CREATE TABLE ${relationalTableReference(connection, input)} (\n${columnLines.join(',\n')}\n);` } }
    })
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'DDL_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database DDL lookup failed.')
    }
  }
}

const relationalMutateTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationInput,
  startedAt: number
): Promise<DatabaseTableMutationResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    const columns = await relationalColumnsForTable(connection, input)
    if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const tableRef = databaseMutationTableReference(connection, input, dbType)
    const statements = input.mutations
      .map((mutation) => buildDatabaseMutationStatement(dbType, tableRef, knownColumns, mutation))
      .filter((statement): statement is DatabaseMutationStatement => !!statement)
    let affected = 0
    if (connection.dbType === 'mysql') {
      await withMysqlConnection(connection, async (client) => {
        await mysqlExec(client, 'BEGIN')
        try {
          for (const statement of statements) affected += await mysqlExec(client, statement.sql, statement.params)
          await mysqlExec(client, 'COMMIT')
        } catch (error) {
          await mysqlExec(client, 'ROLLBACK').catch(() => undefined)
          throw error
        }
      })
    } else {
      if (connection.dbType === 'oracle') {
        await withOracleConnection(connection, async (client) => {
          try {
            for (const statement of statements) affected += await oracleExec(client, statement.sql, statement.params)
            await oracleCommit(client)
          } catch (error) {
            await oracleRollback(client).catch(() => undefined)
            throw error
          }
        })
      } else if (connection.dbType === 'sqlserver') {
        await withSqlServerPool(connection, async (client) => {
          const transaction = client.transaction?.()
          if (transaction) {
            await transaction.begin()
            try {
              for (const statement of statements) {
                const result = await sqlServerRequestWithParams(transaction.request(), statement.params).query(statement.sql)
                affected += result.rowsAffected?.reduce((sum, value) => sum + Number(value || 0), 0) ?? 0
              }
              await transaction.commit()
            } catch (error) {
              await transaction.rollback().catch(() => undefined)
              throw error
            }
            return
          }
          await sqlServerExec(client, 'BEGIN TRANSACTION')
          try {
            for (const statement of statements) affected += await sqlServerExec(client, statement.sql, statement.params)
            await sqlServerExec(client, 'COMMIT TRANSACTION')
          } catch (error) {
            await sqlServerExec(client, 'ROLLBACK TRANSACTION').catch(() => undefined)
            throw error
          }
        })
      } else {
        await withPostgresClient(connection, async (client) => {
          await postgresExec(client, 'BEGIN')
          try {
            for (const statement of statements) affected += await postgresExec(client, statement.sql, statement.params)
            await postgresExec(client, 'COMMIT')
          } catch (error) {
            await postgresExec(client, 'ROLLBACK').catch(() => undefined)
            throw error
          }
        })
      }
    }
    const index = databaseConnections.findIndex((item) => item.id === connection.id)
    if (index >= 0) {
      const catalogs = await relationalCatalogsForConnection({ ...databaseConnections[index] }).catch(() => databaseConnections[index].catalogs)
      databaseConnections[index] = { ...databaseConnections[index], catalogs }
    }
    return {
      ok: true,
      data: {
        affected,
        durationMs: Math.max(1, Date.now() - startedAt),
        catalog: databaseWorkspaceCatalogFor(input.connectionId)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: relationalErrorCode(error, relationalFallbackCode(dbType, 'MUTATION_FAILED')),
      errorMessage: relationalErrorMessage(error, 'Database table mutation failed.')
    }
  }
}

const endpointFor = (input: DatabaseConnectionTestInput) => {
  if (input.dbType === 'sqlite') return trim(input.filePath) || sqlitePathFromUrl(trim(input.url))
  if (input.dbType === 'oracle' && trim(input.url)) return trim(input.url)
  const host = trim(input.host)
  const port = typeof input.port === 'number' && Number.isFinite(input.port) ? input.port : null
  return port ? `${host}:${port}` : host
}

const queryRows: Record<string, Array<Record<string, unknown>>> = {
  'conn-prod-pg:orders:public:orders': [
    { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' },
    { id: 1002, service: 'orders-worker', status: 'mitigated', owner: 'bob', updated_at: '2026-06-03 09:44:00' },
    { id: 1003, service: 'k8s-ingress', status: 'watching', owner: null, updated_at: '2026-06-02 22:01:00' },
    { id: 1004, service: 'billing-sync', status: 'closed', owner: 'carol', updated_at: '2026-06-02 18:22:00' }
  ],
  'conn-prod-pg:orders:public:open_orders_v': [
    { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' }
  ],
  'conn-prod-pg:orders:ops:ops_incidents': [
    { id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' },
    { id: 9002, service: 'search', severity: 'P2', status: 'triaged', updated_at: '2026-06-03 08:04:00' }
  ],
  'conn-prod-pg:orders:ops:active_incidents_v': [{ id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' }],
  'conn-metrics-mysql:metrics::service_health': [
    { id: 1, service: 'api-gateway', region: 'shanghai', latency_ms: 28, healthy: true },
    { id: 2, service: 'worker', region: 'hangzhou', latency_ms: 73, healthy: true },
    { id: 3, service: 'queue', region: 'shenzhen', latency_ms: 211, healthy: false }
  ],
  'conn-metrics-mysql:metrics::ops_incidents': [
    { id: 7001, service: 'metrics-api', severity: 'P2', status: 'watching', updated_at: '2026-06-03 07:52:00' },
    { id: 7002, service: 'prometheus', severity: 'P3', status: 'closed', updated_at: '2026-06-02 16:31:00' }
  ],
  'conn-metrics-mysql:metrics::metric_events': [
    { service: 'api-gateway', event_type: 'deploy', severity: 'info', created_at: '2026-06-03 10:42:00' },
    { service: 'queue', event_type: 'lag', severity: 'warning', created_at: '2026-06-03 10:58:00' }
  ],
  'conn-oracle-audit:ORCLPDB1:OPS:AUDIT_LOG': [
    { event_id: 501, actor: 'deploy-bot', action: 'RELEASE_START', created_at: '2026-06-03 08:10:00' },
    { event_id: 502, actor: 'ops-user', action: 'MANUAL_APPROVE', created_at: '2026-06-03 08:16:00' }
  ],
  'conn-local-cache:cache.db::cache_entries': [
    { key: 'session:1001', value: 'payment-api', ttl_seconds: 3600, updated_at: '2026-06-03 09:00:00' },
    { key: 'feature:rollout', value: 'enabled', ttl_seconds: null, updated_at: '2026-06-02 23:20:00' }
  ]
}

const tableDdl: Record<string, { ddl: string; error?: { code: 'permission' | 'other'; message: string } }> = {
  'conn-prod-pg:orders:public:orders': {
    ddl:
      'CREATE TABLE public.orders (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  owner VARCHAR(64),\n  updated_at TIMESTAMP NOT NULL\n);'
  },
  'conn-prod-pg:orders:public:open_orders_v': {
    ddl:
      'CREATE VIEW public.open_orders_v AS\nSELECT id, service, status, owner, updated_at\nFROM public.orders\nWHERE status <> \'closed\';',
    error: { code: 'permission', message: 'DDL requires elevated catalog permission.' }
  },
  'conn-prod-pg:orders:ops:ops_incidents': {
    ddl:
      'CREATE TABLE ops.ops_incidents (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  severity VARCHAR(16) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  updated_at TIMESTAMP NOT NULL\n);'
  },
  'conn-prod-pg:orders:ops:active_incidents_v': {
    ddl:
      'CREATE VIEW ops.active_incidents_v AS\nSELECT id, service, severity, status, updated_at\nFROM ops.ops_incidents\nWHERE status <> \'closed\';'
  },
  'conn-metrics-mysql:metrics::service_health': {
    ddl:
      'CREATE TABLE `service_health` (\n  `id` INT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `region` VARCHAR(32) NOT NULL,\n  `latency_ms` INT NOT NULL,\n  `healthy` TINYINT NOT NULL,\n  PRIMARY KEY (`id`)\n);'
  },
  'conn-metrics-mysql:metrics::ops_incidents': {
    ddl:
      'CREATE TABLE `ops_incidents` (\n  `id` BIGINT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `status` VARCHAR(32) NOT NULL,\n  `updated_at` DATETIME NOT NULL,\n  PRIMARY KEY (`id`)\n);'
  },
  'conn-metrics-mysql:metrics::metric_events': {
    ddl:
      'CREATE TABLE `metric_events` (\n  `service` VARCHAR(80) NOT NULL,\n  `event_type` VARCHAR(32) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `created_at` DATETIME NOT NULL\n);'
  },
  'conn-oracle-audit:ORCLPDB1:OPS:AUDIT_LOG': {
    ddl:
      'CREATE TABLE OPS.AUDIT_LOG (\n  event_id NUMBER NOT NULL,\n  actor VARCHAR2(64) NOT NULL,\n  action VARCHAR2(64) NOT NULL,\n  created_at TIMESTAMP NOT NULL\n);'
  },
  'conn-local-cache:cache.db::cache_entries': {
    ddl:
      'CREATE TABLE cache_entries (\n  key TEXT PRIMARY KEY,\n  value TEXT,\n  ttl_seconds INTEGER,\n  updated_at TEXT NOT NULL\n);'
  }
}

const cloneRows = (rows: Record<string, Array<Record<string, unknown>>>) =>
  Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.map((row) => ({ ...row }))]))

const columnsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {})

const cloneColumns = (columns: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, value.slice()]))

const tableRows = cloneRows(queryRows)
const tableColumns = cloneColumns(Object.fromEntries(Object.entries(queryRows).map(([key, rows]) => [key, columnsForRows(rows)])))
const tableDdlEntries = Object.fromEntries(Object.entries(tableDdl).map(([key, value]) => [key, { ddl: value.ddl, error: value.error ? { ...value.error } : undefined }]))

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

const tableExistsInBackend = (input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) => {
  const key = `${input.connectionId}:${input.databaseName}:${input.schemaName || ''}:${input.tableName}`
  return hasOwn(tableRows, key) || hasOwn(tableDdlEntries, key)
}

const databaseMutationWarning = (dialect: DatabaseMutationDialect, input: Pick<DatabaseTableMutationInput, 'mutations'>) => {
  const hasNoPrimaryKeyRowMutation = input.mutations.some((mutation) => {
    if (mutation.kind !== 'delete' && mutation.kind !== 'update') return false
    return mutation.primaryKey.map(trim).filter(Boolean).length === 0
  })
  if (!hasNoPrimaryKeyRowMutation) return ''
  if (dialect === 'oracle') return 'Oracle table editing requires a primary key in this version.'
  return 'No primary key detected. UPDATE and DELETE previews use the original row snapshot with a single-row guard.'
}

const inputKnownColumns = (input: DatabaseTableMutationPlanInput) => {
  const columns = [...(input.knownColumns ?? []), ...(input.columns ?? [])].map(trim).filter(Boolean)
  return Array.from(new Set(columns))
}

const databaseMutationPlanData = (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationPlanInput,
  knownColumns: string[]
): DatabaseTableMutationPlanResult['data'] => {
  const dialect = connection.dbType
  const tableRef = databaseMutationTableReference(connection, input, dialect)
  const statements = input.mutations
    .map((mutation) => buildDatabaseMutationStatement(dialect, tableRef, knownColumns, mutation))
    .filter((statement): statement is DatabaseMutationStatement => !!statement)
    .map(addDatabaseMutationPreview)
  return {
    statements,
    statementCount: statements.length,
    preview: statements.map((statement) => statement.preview).join('\n'),
    warning: databaseMutationWarning(dialect, input)
  }
}

const databaseMutationPlanErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : fallback
}

const databaseMutationPlanErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

const cloneDatabaseColumn = (column: DatabaseColumnInfo): DatabaseColumnInfo => ({ ...column })

const cloneDatabaseTable = (table: DatabaseTableInfo): DatabaseTableInfo => ({
  ...table,
  columns: table.columns.map(cloneDatabaseColumn),
  primaryKey: table.primaryKey.slice()
})

const cloneDatabaseCatalogRaw = (catalog: DatabaseCatalogInfo): DatabaseCatalogInfo => ({
  name: catalog.name,
  ...(catalog.tables ? { tables: catalog.tables.map(cloneDatabaseTable) } : {}),
  ...(catalog.schemas
    ? {
        schemas: catalog.schemas.map((schema) => ({
          name: schema.name,
          tables: schema.tables.map(cloneDatabaseTable),
          views: schema.views?.map(cloneDatabaseTable),
          functions: schema.functions?.slice(),
          procedures: schema.procedures?.slice()
        }))
      }
    : {})
})

const cloneDatabaseCatalog = (connectionId: string, catalog: DatabaseCatalogInfo): DatabaseCatalogInfo => ({
  name: catalog.name,
  ...(catalog.tables
    ? {
        tables: catalog.tables
          .filter((table) => tableExistsInBackend({ connectionId, databaseName: catalog.name, tableName: table.name }))
          .map(cloneDatabaseTable)
      }
    : {}),
  ...(catalog.schemas
    ? {
        schemas: catalog.schemas.map((schema) => ({
          name: schema.name,
          tables: schema.tables
            .filter((table) => tableExistsInBackend({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name }))
            .map(cloneDatabaseTable),
          views: (schema.views ?? [])
            .filter((table) => tableExistsInBackend({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name }))
            .map(cloneDatabaseTable),
          functions: schema.functions?.slice(),
          procedures: schema.procedures?.slice()
        }))
      }
    : {})
})

const cloneDatabaseConnection = (connection: DatabaseConnectionInfo): DatabaseConnectionInfo => ({
  ...connection,
  status:
    !shouldUseDatabaseSeedData() && isRelationalConnection(connection) && connection.status === 'connected' && !databaseVerifiedConnections.has(connection.id)
      ? 'idle'
      : connection.status,
  catalogs:
    (connection.dbType === 'sqlite' && isRealSqliteConnection(connection)) || !shouldUseDatabaseSeedData()
      ? connection.catalogs.map(cloneDatabaseCatalogRaw)
      : connection.catalogs.map((catalog) => cloneDatabaseCatalog(connection.id, catalog))
})

let databaseGroups: DatabaseGroupInfo[] = databaseGroupSeed.map((group) => ({ ...group }))
let databaseGroupParents: Record<string, string | null> = { ...databaseGroupParentSeed }
let databaseConnections: DatabaseConnectionInfo[] = databaseConnectionSeed.map(cloneDatabaseConnection)
let databaseLoadedStateFilePath = ''

type DatabasePersistedState = {
  version: 1
  groups: DatabaseGroupInfo[]
  groupParents: Record<string, string | null>
  connections: DatabaseConnectionInfo[]
  secrets: Record<string, { password?: string }>
  aiPaneState?: DatabaseAiPaneStateSnapshot
  needsSecretMigration?: boolean
}

const normalizePersistedString = (value: unknown, fallback = '') => {
  const text = trim(value)
  return text || fallback
}

const normalizePersistedColumn = (value: unknown): DatabaseColumnInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const key = value.key === 'PK' || value.key === 'FK' ? value.key : undefined
  return {
    name,
    type: normalizePersistedString(value.type, 'unknown'),
    nullable: value.nullable !== false,
    ...(key ? { key } : {})
  }
}

const normalizePersistedTable = (value: unknown): DatabaseTableInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const columns = Array.isArray(value.columns)
    ? value.columns.map(normalizePersistedColumn).filter((column): column is DatabaseColumnInfo => Boolean(column))
    : []
  return {
    id: normalizePersistedString(value.id, `tbl-persisted-${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`),
    name,
    columns,
    primaryKey: Array.isArray(value.primaryKey) ? value.primaryKey.map(trim).filter(Boolean) : sqlitePrimaryKeyForColumns(columns)
  }
}

const normalizePersistedSchema = (value: unknown): DatabaseSchemaInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const tables = Array.isArray(value.tables)
    ? value.tables.map(normalizePersistedTable).filter((table): table is DatabaseTableInfo => Boolean(table))
    : []
  const views = Array.isArray(value.views)
    ? value.views.map(normalizePersistedTable).filter((table): table is DatabaseTableInfo => Boolean(table))
    : []
  return {
    name,
    tables,
    views,
    functions: Array.isArray(value.functions) ? value.functions.map(trim).filter(Boolean) : [],
    procedures: Array.isArray(value.procedures) ? value.procedures.map(trim).filter(Boolean) : []
  }
}

const normalizePersistedCatalog = (value: unknown): DatabaseCatalogInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const tables = Array.isArray(value.tables)
    ? value.tables.map(normalizePersistedTable).filter((table): table is DatabaseTableInfo => Boolean(table))
    : undefined
  const schemas = Array.isArray(value.schemas)
    ? value.schemas.map(normalizePersistedSchema).filter((schema): schema is DatabaseSchemaInfo => Boolean(schema))
    : undefined
  return {
    name,
    ...(schemas ? { schemas } : {}),
    ...(tables ? { tables } : {})
  }
}

const normalizePersistedGroup = (value: unknown): DatabaseGroupInfo | null => {
  if (!isRecord(value)) return null
  const id = normalizePersistedString(value.id)
  const name = normalizePersistedString(value.name)
  if (!id || !name) return null
  return { id, name }
}

const normalizePersistedConnection = (value: unknown, knownGroupIds: Set<string>): DatabaseConnectionInfo | null => {
  if (!isRecord(value)) return null
  const id = normalizePersistedString(value.id)
  const name = normalizePersistedString(value.name)
  const dbType = typeof value.dbType === 'string' && supportedEngines.has(value.dbType) ? (value.dbType as DatabaseEngineCode) : null
  if (!id || !name || !dbType) return null
  const port = normalizedDatabasePort(typeof value.port === 'number' ? value.port : Number(value.port))
  const sslMode = postgresSslModeValues.has(String(value.sslMode ?? '')) ? (String(value.sslMode ?? '') as DatabaseConnectionInfo['sslMode']) : ''
  return {
    id,
    name,
    dbType,
    env: typeof value.env === 'string' && databaseEnvValues.has(value.env as DatabaseConnectionInfo['env']) ? (value.env as DatabaseConnectionInfo['env']) : 'Development',
    groupId: knownGroupIds.has(trim(value.groupId)) ? trim(value.groupId) : DEFAULT_DATABASE_GROUP_ID,
    host: normalizePersistedString(value.host, dbType === 'sqlite' ? 'local' : ''),
    port: dbType === 'sqlite' ? null : port,
    authentication: 'UserAndPassword',
    user: dbType === 'sqlite' ? '' : normalizePersistedString(value.user),
    hasPassword: value.hasPassword === true,
    database: normalizePersistedString(value.database),
    filePath: dbType === 'sqlite' ? normalizePersistedString(value.filePath) || undefined : undefined,
    readonly: dbType === 'sqlite' ? value.readonly !== false : undefined,
    sslMode: dbType === 'postgresql' || dbType === 'sqlserver' ? sslMode : '',
    url: normalizePersistedString(value.url) || undefined,
    status:
      typeof value.status === 'string' && databaseStatusValues.has(value.status as DatabaseConnectionInfo['status'])
        ? (value.status as DatabaseConnectionInfo['status'])
        : 'idle',
    catalogs: Array.isArray(value.catalogs)
      ? value.catalogs.map(normalizePersistedCatalog).filter((catalog): catalog is DatabaseCatalogInfo => Boolean(catalog))
      : []
  }
}

const normalizePersistedState = (value: unknown): DatabasePersistedState | null => {
  if (!isRecord(value)) return null
  const groups = Array.isArray(value.groups)
    ? value.groups.map(normalizePersistedGroup).filter((group): group is DatabaseGroupInfo => Boolean(group))
    : []
  if (!groups.some((group) => group.id === DEFAULT_DATABASE_GROUP_ID)) {
    groups.unshift({ id: DEFAULT_DATABASE_GROUP_ID, name: 'Default Group' })
  }
  const knownGroupIds = new Set(groups.map((group) => group.id))
  const groupParents: Record<string, string | null> = {}
  const rawParents = isRecord(value.groupParents) ? value.groupParents : {}
  groups.forEach((group) => {
    const parentId = trim(rawParents[group.id])
    groupParents[group.id] = parentId && parentId !== group.id && knownGroupIds.has(parentId) ? parentId : null
  })
  const connections = Array.isArray(value.connections)
    ? value.connections.map((connection) => normalizePersistedConnection(connection, knownGroupIds)).filter((connection): connection is DatabaseConnectionInfo => Boolean(connection))
    : []
  const secrets: DatabasePersistedState['secrets'] = {}
  const rawSecrets = isRecord(value.secrets) ? value.secrets : {}
  let needsSecretMigration = false
  connections.forEach((connection) => {
    const secret = rawSecrets[connection.id]
    if (isRecord(secret) && typeof secret.password === 'string' && secret.password) {
      const password = decryptDatabaseCredentialFromStorage(secret.password)
      if (password) {
        secrets[connection.id] = { password }
        connection.hasPassword = true
        if (!isDatabaseCredentialCiphertext(secret.password)) needsSecretMigration = true
      }
    }
  })
  return {
    version: 1,
    groups,
    groupParents,
    connections,
    secrets,
    aiPaneState: isRecord(value.aiPaneState) ? normalizeDatabaseAiPaneState(value.aiPaneState) : undefined,
    needsSecretMigration
  }
}

const databaseStateFilePath = () => trim(databaseRuntimeConfig.stateFilePath)

const applyPersistedDatabaseState = (state: DatabasePersistedState) => {
  databaseGroups = state.groups.map((group) => ({ ...group }))
  databaseGroupParents = { ...state.groupParents }
  databaseConnections = state.connections.map(cloneDatabaseConnection)
  databaseConnectionSecrets.clear()
  Object.entries(state.secrets).forEach(([connectionId, secret]) => {
    if (secret.password) databaseConnectionSecrets.set(connectionId, secret.password)
  })
  if (state.aiPaneState) replaceDatabaseAiPaneState(state.aiPaneState)
}

const ensureDatabaseStateLoaded = () => {
  const filePath = databaseStateFilePath()
  if (!filePath || databaseLoadedStateFilePath === filePath) return
  databaseLoadedStateFilePath = filePath
  if (!existsSync(filePath)) return
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const state = normalizePersistedState(parsed)
    if (state) {
      applyPersistedDatabaseState(state)
      if (state.needsSecretMigration) persistDatabaseState()
    }
  } catch {
    /* Ignore corrupt local state and keep the backend fallback catalog. */
  }
}

const persistDatabaseState = () => {
  const filePath = databaseStateFilePath()
  if (!filePath) return
  try {
    const state: DatabasePersistedState = {
      version: 1,
      groups: databaseGroups.map((group) => ({ ...group })),
      groupParents: { ...databaseGroupParents },
      connections: visibleDatabaseConnections().map(cloneDatabaseConnection),
      secrets: Object.fromEntries(
        Array.from(databaseConnectionSecrets.entries()).map(([connectionId, password]) => [connectionId, { password: encryptDatabaseCredentialForStorage(password) }])
      ),
      aiPaneState: cloneDatabaseAiPaneState(databaseAiPaneState)
    }
    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tempPath, filePath)
    databaseLoadedStateFilePath = filePath
  } catch {
    /* Persistence must not turn a successful database action into a UI failure. */
  }
}

const visibleDatabaseConnections = () =>
  shouldUseDatabaseSeedData()
    ? databaseConnections
    : databaseConnections.filter((connection) => !databaseConnectionSeedIds.has(connection.id) || databaseVerifiedConnections.has(connection.id) || databaseConnectionSecrets.has(connection.id))

const defaultDatabaseCatalogDefaults = (): DatabaseCatalogDefaults => ({
  selectedNodeId: 'conn-prod-pg',
  expandedGroupIds: ['group-default', 'group-prod', 'group-local'],
  expandedConnectionIds: ['conn-prod-pg'],
  expandedCatalogIds: ['conn-prod-pg:orders'],
  expandedSchemaIds: ['conn-prod-pg:orders:public', 'conn-prod-pg:orders:ops'],
  expandedSchemaObjectFolderIds: ['conn-prod-pg:orders:public:tables', 'conn-prod-pg:orders:ops:tables']
})

const schemaHasObjects = (schema: DatabaseSchemaInfo) =>
  schema.tables.length > 0 || (schema.views?.length ?? 0) > 0 || (schema.functions?.length ?? 0) > 0 || (schema.procedures?.length ?? 0) > 0

const databaseCatalogDefaultsFor = (selectedConnectionId = 'conn-prod-pg'): DatabaseCatalogDefaults => {
  const baseDefaults = defaultDatabaseCatalogDefaults()
  const visibleConnections = visibleDatabaseConnections()
  const selectedConnection = visibleConnections.find((connection) => connection.id === selectedConnectionId)
  const selectedGroup = databaseGroups.find((group) => group.id === selectedConnectionId)
  const expandedGroupIds = databaseGroups.map((group) => group.id)
  if (!selectedConnection || selectedConnectionId === 'conn-prod-pg') {
    if (!shouldUseDatabaseSeedData() && !selectedConnection) {
      const firstConnection = visibleConnections[0]
      return {
        selectedNodeId: selectedGroup?.id ?? firstConnection?.id ?? null,
        expandedGroupIds,
        expandedConnectionIds: firstConnection ? [firstConnection.id] : [],
        expandedCatalogIds: [],
        expandedSchemaIds: [],
        expandedSchemaObjectFolderIds: []
      }
    }
    return {
      ...baseDefaults,
      selectedNodeId: selectedGroup?.id ?? baseDefaults.selectedNodeId,
      expandedGroupIds
    }
  }

  const expandedCatalogIds = selectedConnection.catalogs.map((catalog) => `${selectedConnection.id}:${catalog.name}`)
  const expandedSchemaIds = selectedConnection.catalogs.flatMap((catalog) =>
    (catalog.schemas ?? []).filter(schemaHasObjects).map((schema) => `${selectedConnection.id}:${catalog.name}:${schema.name}`)
  )
  const expandedSchemaObjectFolderIds = selectedConnection.catalogs.flatMap((catalog) =>
    (catalog.schemas ?? []).flatMap((schema) => {
      const folderIds: string[] = []
      if (schema.tables.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:tables`)
      if (schema.views?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:views`)
      if (schema.functions?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:functions`)
      if (schema.procedures?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:procedures`)
      return folderIds
    })
  )

  return {
    selectedNodeId: selectedConnection.id,
    expandedGroupIds,
    expandedConnectionIds: Array.from(new Set([...baseDefaults.expandedConnectionIds, selectedConnection.id])),
    expandedCatalogIds: Array.from(new Set([...baseDefaults.expandedCatalogIds, ...expandedCatalogIds])),
    expandedSchemaIds: Array.from(new Set([...baseDefaults.expandedSchemaIds, ...expandedSchemaIds])),
    expandedSchemaObjectFolderIds: Array.from(new Set([...baseDefaults.expandedSchemaObjectFolderIds, ...expandedSchemaObjectFolderIds]))
  }
}

const databaseWorkspaceCatalogFor = (selectedConnectionId = 'conn-prod-pg'): DatabaseWorkspaceCatalog => ({
  engines: databaseEngines.map((engine) => ({ ...engine })),
  groups: databaseGroups.map((group) => ({ ...group })),
  groupParents: { ...databaseGroupParents },
  connections: visibleDatabaseConnections().map(cloneDatabaseConnection),
  defaults: databaseCatalogDefaultsFor(selectedConnectionId)
})

const basenameFromPath = (value: string) => {
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || 'main'
}

const slugForConnectionId = (value: string) =>
  trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'database'

const slugForGroupId = (value: string) =>
  trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'group'

const nextDatabaseConnectionId = (name: string) => {
  const base = `conn-${slugForConnectionId(name)}`
  let candidate = base
  let suffix = 2
  while (databaseConnections.some((connection) => connection.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const nextDatabaseGroupId = (name: string) => {
  const base = `group-${slugForGroupId(name)}`
  let candidate = base
  let suffix = 2
  while (databaseGroups.some((group) => group.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const databaseGroupExists = (groupId: string | null | undefined) => !!groupId && databaseGroups.some((group) => group.id === groupId)

const normalizedDatabaseGroupId = (groupId: string | null | undefined) => {
  const id = trim(groupId)
  return databaseGroupExists(id) ? id : DEFAULT_DATABASE_GROUP_ID
}

const normalizedDatabaseGroupParentId = (groupId: string | null | undefined) => {
  const id = trim(groupId)
  return databaseGroupExists(id) ? id : null
}

const databaseGroupDescendantIds = (groupId: string) => {
  const out = new Set<string>()
  const visit = (parentId: string) => {
    for (const group of databaseGroups) {
      if ((databaseGroupParents[group.id] ?? null) === parentId) {
        out.add(group.id)
        visit(group.id)
      }
    }
  }
  visit(groupId)
  return out
}

const normalizedDatabasePort = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

const buildSavedConnectionUrl = (
  input: DatabaseConnectionTestInput,
  normalized: Pick<DatabaseConnectionInfo, 'dbType' | 'host' | 'port' | 'database' | 'filePath'>
) => {
  const rawUrl = trim(input.url)
  if (rawUrl) return rawUrl
  if (normalized.dbType === 'sqlite') return `sqlite://${normalized.filePath || ''}`
  const port = normalized.port ? `:${normalized.port}` : ''
  const database = normalized.database ? `/${normalized.database}` : ''
  if (normalized.dbType === 'oracle') return `${normalized.host}${port}${database}`
  const scheme = normalized.dbType === 'postgresql' ? 'jdbc:postgresql' : normalized.dbType === 'sqlserver' ? 'jdbc:sqlserver' : 'jdbc:mysql'
  return `${scheme}://${normalized.host}${port}${database}`
}

const defaultCatalogsForSavedConnection = (connection: Omit<DatabaseConnectionInfo, 'catalogs'>): DatabaseCatalogInfo[] => {
  const catalogName = trim(connection.database)
  if (!catalogName) return []
  if (connection.dbType === 'sqlite') {
    const sqliteCatalogs = sqliteCatalogsForConnection({ ...connection, catalogs: [] })
    return sqliteCatalogs ?? [{ name: catalogName, tables: [] }]
  }
  if (connection.dbType === 'postgresql') {
    return [{ name: catalogName, schemas: [{ name: 'public', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'oracle') {
    return [{ name: catalogName, schemas: [{ name: 'OPS', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'sqlserver') {
    return [{ name: catalogName, schemas: [{ name: 'dbo', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  return [{ name: catalogName, tables: [] }]
}

const createDatabaseCatalogForConnection = (connection: DatabaseConnectionInfo, name: string): DatabaseCatalogInfo =>
  connection.dbType === 'postgresql' || connection.dbType === 'sqlserver'
    ? { name, schemas: [{ name: connection.dbType === 'postgresql' ? 'public' : 'dbo', tables: [], views: [], functions: [], procedures: [] }] }
    : { name, tables: [] }

const unquoteDatabaseIdentifier = (value: string) => {
  const token = trim(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  if (token.startsWith('[') && token.endsWith(']')) return token.slice(1, -1).replace(/]]/g, ']')
  return token
}

const databaseNameFromCreateSql = (sql: string) => {
  const match = trim(sql).match(/^create\s+database\s+(?:if\s+not\s+exists\s+)?(`(?:``|[^`])+`|"(?:""|[^"])+"|\[(?:]]|[^\]])+\]|[A-Za-z_][A-Za-z0-9_]*)\s*;?$/i)
  return match ? unquoteDatabaseIdentifier(match[1]) : ''
}

const normalizeDatabaseConnectionSaveDraft = (
  input: DatabaseConnectionSaveInput['connection']
): Omit<DatabaseConnectionInfo, 'id' | 'status' | 'catalogs' | 'hasPassword'> => {
  const isSqlite = input.dbType === 'sqlite'
  const hasOracleConnectString = input.dbType === 'oracle' && !!trim(input.url)
  const filePath = isSqlite ? trim(input.filePath) || sqlitePathFromUrl(trim(input.url)) : ''
  const database = isSqlite ? basenameFromPath(filePath) : trim(input.database)
  const host = isSqlite ? 'local' : hasOracleConnectString ? 'connect-string' : trim(input.host)
  const port = isSqlite || hasOracleConnectString ? null : normalizedDatabasePort(input.port)
  const sslMode: DatabaseConnectionInfo['sslMode'] =
    input.dbType === 'postgresql' && postgresSslModeValues.has(input.sslMode ?? '') ? ((input.sslMode || '') as DatabaseConnectionInfo['sslMode']) : ''
  const normalized = {
    name: trim(input.name),
    dbType: input.dbType,
    env: input.env && databaseEnvValues.has(input.env) ? input.env : 'Development',
    groupId: normalizedDatabaseGroupId(input.groupId),
    host,
    port,
    authentication: input.authentication === 'UserAndPassword' ? input.authentication : 'UserAndPassword',
    user: isSqlite ? '' : trim(input.user),
    database,
    filePath: isSqlite ? filePath : undefined,
    readonly: isSqlite ? !!input.readonly : undefined,
    sslMode
  }
  return {
    ...normalized,
    url: buildSavedConnectionUrl(input, normalized)
  }
}

export function resetDatabaseBackendSeed() {
  databaseRuntimeConfig = {}
  databaseLoadedStateFilePath = ''
  databaseConnectionSecrets.clear()
  databaseVerifiedConnections.clear()
  Object.keys(tableRows).forEach((key) => {
    delete tableRows[key]
  })
  Object.keys(tableColumns).forEach((key) => {
    delete tableColumns[key]
  })
  Object.assign(tableRows, cloneRows(queryRows))
  Object.assign(tableColumns, cloneColumns(Object.fromEntries(Object.entries(queryRows).map(([key, rows]) => [key, columnsForRows(rows)]))))
  Object.keys(tableDdlEntries).forEach((key) => {
    delete tableDdlEntries[key]
  })
  Object.assign(tableDdlEntries, Object.fromEntries(Object.entries(tableDdl).map(([key, value]) => [key, { ddl: value.ddl, error: value.error ? { ...value.error } : undefined }])))
  databaseGroups = databaseGroupSeed.map((group) => ({ ...group }))
  databaseGroupParents = { ...databaseGroupParentSeed }
  databaseConnections = databaseConnectionSeed.map(cloneDatabaseConnection)
  databaseAiPaneMessages.clear()
  databaseAiPaneState = defaultDatabaseAiPaneState()
  databaseAiDrawerRequests.clear()
}

export async function listDatabaseCatalog(): Promise<DatabaseCatalogResult> {
  ensureDatabaseStateLoaded()
  return {
    ok: true,
    data: databaseWorkspaceCatalogFor()
  }
}

export function getDatabaseAiPaneState(): DatabaseAiPaneStateResult {
  ensureDatabaseStateLoaded()
  return {
    ok: true,
    data: cloneDatabaseAiPaneState(databaseAiPaneState)
  }
}

export function saveDatabaseAiPaneState(input: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateResult {
  ensureDatabaseStateLoaded()
  replaceDatabaseAiPaneState(input)
  persistDatabaseState()
  return {
    ok: true,
    data: cloneDatabaseAiPaneState(databaseAiPaneState)
  }
}

export async function createDatabaseGroup(input: DatabaseGroupCreateInput): Promise<DatabaseGroupMutationResult> {
  ensureDatabaseStateLoaded()
  const name = trim(input.name) || 'New Group'
  const parentId = normalizedDatabaseGroupParentId(input.parentId)
  const group: DatabaseGroupInfo = {
    id: nextDatabaseGroupId(name),
    name
  }
  databaseGroups.push(group)
  databaseGroupParents[group.id] = parentId
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(group.id),
      group: { ...group },
      message: 'Group created'
    }
  }
}

export async function renameDatabaseGroup(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
  ensureDatabaseStateLoaded()
  const group = databaseGroups.find((item) => item.id === trim(input.id))
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  const name = trim(input.name)
  if (!name) {
    return { ok: false, errorCode: 'DB_GROUP_NAME_REQUIRED', errorMessage: 'Group name is required.' }
  }

  group.name = name
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(group.id),
      group: { ...group },
      message: 'Group renamed'
    }
  }
}

export async function moveDatabaseGroup(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
  ensureDatabaseStateLoaded()
  const groupId = trim(input.id)
  const group = databaseGroups.find((item) => item.id === groupId)
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  if (groupId === DEFAULT_DATABASE_GROUP_ID) {
    return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be moved.' }
  }

  const parentId = input.parentId === undefined ? (databaseGroupParents[groupId] ?? null) : normalizedDatabaseGroupParentId(input.parentId)
  if (parentId === groupId || (parentId && databaseGroupDescendantIds(groupId).has(parentId))) {
    return { ok: false, errorCode: 'DB_GROUP_PARENT_INVALID', errorMessage: 'Group cannot be moved into itself or one of its children.' }
  }

  databaseGroupParents[groupId] = parentId
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(group.id),
      group: { ...group },
      message: parentId ? 'Group moved' : 'Group moved to root'
    }
  }
}

export async function deleteDatabaseGroup(id: string): Promise<DatabaseGroupDeleteResult> {
  ensureDatabaseStateLoaded()
  const groupId = trim(id)
  const group = databaseGroups.find((item) => item.id === groupId)
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  if (groupId === DEFAULT_DATABASE_GROUP_ID) {
    return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be deleted.' }
  }

  databaseGroups = databaseGroups.filter((item) => item.id !== groupId)
  for (const child of databaseGroups) {
    if ((databaseGroupParents[child.id] ?? null) === groupId) databaseGroupParents[child.id] = null
  }
  delete databaseGroupParents[groupId]
  databaseConnections = databaseConnections.map((connection) =>
    connection.groupId === groupId ? { ...connection, groupId: DEFAULT_DATABASE_GROUP_ID } : connection
  )
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(DEFAULT_DATABASE_GROUP_ID),
      deletedGroupId: groupId,
      message: 'Group deleted'
    }
  }
}

const databaseConnectionMutation = (
  connectionId: string,
  message: string,
  mutate: (connection: DatabaseConnectionInfo) => DatabaseConnectionInfo
): DatabaseConnectionMutationResult => {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const index = databaseConnections.findIndex((connection) => connection.id === id)
  if (index === -1) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  const saved = mutate(databaseConnections[index])
  databaseConnections[index] = saved
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      message
    }
  }
}

export async function moveDatabaseConnection(input: DatabaseConnectionMoveInput): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  const groupId = normalizedDatabaseGroupId(input.groupId)
  return databaseConnectionMutation(input.connectionId, groupId === DEFAULT_DATABASE_GROUP_ID ? 'Connection moved to root group' : 'Connection moved', (connection) => ({
    ...connection,
    groupId
  }))
}

export async function removeDatabaseConnection(connectionId: string): Promise<DatabaseConnectionDeleteResult> {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const index = databaseConnections.findIndex((connection) => connection.id === id)
  if (index === -1) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  databaseConnections = databaseConnections.filter((connection) => connection.id !== id)
  databaseConnectionSecrets.delete(id)
  databaseVerifiedConnections.delete(id)
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(),
      connectionId: id,
      message: 'Connection removed'
    }
  }
}

export async function connectDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const connection = databaseConnections.find((item) => item.id === id)
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData() && isRelationalConnection(connection)) {
    try {
      const catalogs = await relationalCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection opened', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'CONNECTION_FAILED'),
        'Database connection failed.'
      )
      return failed
    }
  }
  return databaseConnectionMutation(connectionId, 'Connection opened', (connection) => ({
    ...connection,
    status: 'connected'
  }))
}

export async function disconnectDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  databaseVerifiedConnections.delete(trim(connectionId))
  return databaseConnectionMutation(connectionId, 'Connection closed', (connection) => ({
    ...connection,
    status: 'idle'
  }))
}

export async function refreshDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const connection = databaseConnections.find((item) => item.id === id)
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData() && isRelationalConnection(connection)) {
    try {
      const catalogs = await relationalCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection schema refreshed', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'REFRESH_FAILED'),
        'Database schema refresh failed.'
      )
      return failed
    }
  }
  return databaseConnectionMutation(connectionId, 'Connection schema refreshed', (connection) => {
    if (connection.dbType !== 'sqlite') return { ...connection }
    const catalogs = sqliteCatalogsForConnection(connection)
    return catalogs ? { ...connection, catalogs } : { ...connection }
  })
}

const normalizeSql = (sql: string) => sql.trim().replace(/\s+/g, ' ')

export const DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS = 500
export const DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS = 260
const DATABASE_AI_PANE_DEFAULT_WIDTH = 360
const DATABASE_AI_PANE_MIN_WIDTH = 280
const DATABASE_AI_PANE_MAX_WIDTH = 720
const DATABASE_AI_PANE_MAX_MESSAGES = 24

const defaultDatabaseAiPaneContext = (): DatabaseAiPaneStateContext => ({
  connectionId: '',
  catalogName: '',
  schemaName: '',
  dbType: ''
})

const defaultDatabaseAiPaneState = (): DatabaseAiPaneStateSnapshot => ({
  open: false,
  width: DATABASE_AI_PANE_DEFAULT_WIDTH,
  context: defaultDatabaseAiPaneContext(),
  draft: '',
  messages: []
})

const databaseAiPaneMessages = new Map<string, DatabaseAiPaneMessageRecord>()
const databaseAiDrawerRequests = new Map<string, DatabaseAiDrawerRequestRecord>()
let databaseAiPaneState = defaultDatabaseAiPaneState()

export type DatabaseAiProviderTextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type DatabaseAiProviderTextInput = {
  surface: 'pane' | 'drawer'
  systemPrompt: string
  messages: DatabaseAiProviderTextMessage[]
  maxTokens: number
  modelName: string
  prompt: string
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']
  requestId?: string
  assistantMessageId?: string
  action?: DatabaseAiDrawerAction
  activeSql?: string
  sourceSql?: string
  targetDialect?: DatabaseAiTargetDialect
  errorMessage?: string
}

export type DatabaseAiProviderTextResult =
  | { ok: true; text: string; provider: DatabaseAiResponseProvider; model?: string }
  | { ok: false; errorCode: string; errorMessage: string; provider?: DatabaseAiResponseProvider }

type DatabaseAiRuntimeConfig = {
  getModelName?: () => string | undefined
  generateText?: (input: DatabaseAiProviderTextInput) => Promise<DatabaseAiProviderTextResult>
  localBackendDouble?: boolean
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
}

let databaseAiRuntime: DatabaseAiRuntimeConfig = {}

export function configureDatabaseAiRuntime(config?: DatabaseAiRuntimeConfig) {
  databaseAiRuntime = config ? { ...config } : {}
}

const databaseAiPaneMessageRecord = (
  input: {
    requestId: string
    role: 'user' | 'assistant'
    status: DatabaseAiPaneMessageRecord['status']
    content: string
    contextSummary: string
    createdAt: number
  },
  id = `dbai-pane-message-${randomUUID()}`
): DatabaseAiPaneMessageRecord => ({
  id,
  requestId: input.requestId,
  role: input.role,
  status: input.status,
  content: input.content,
  contextSummary: input.contextSummary,
  createdAt: input.createdAt,
  updatedAt: input.createdAt
})

const cloneDatabaseAiPaneMessageRecord = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({ ...message })

const normalizeDatabaseAiPaneStateContext = (context?: Partial<DatabaseAiPaneStateContext>): DatabaseAiPaneStateContext => {
  const dbType = context?.dbType && supportedEngines.has(context.dbType) ? context.dbType : ''
  return {
    connectionId: trim(context?.connectionId),
    catalogName: trim(context?.catalogName),
    schemaName: trim(context?.schemaName),
    dbType
  }
}

const normalizeDatabaseAiPaneStateMessage = (message: unknown): DatabaseAiPaneMessageRecord | null => {
  if (!message || typeof message !== 'object') return null
  const raw = message as Partial<DatabaseAiPaneMessageRecord>
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null
  if (!role) return null
  const id = trim(raw.id)
  const requestId = trim(raw.requestId)
  if (!id || !requestId) return null
  const rawStatus = String(raw.status || '')
  if (!['queued', 'streaming', 'done', 'error', 'cancelled'].includes(rawStatus)) return null
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null
  const status =
    rawStatus === 'queued' || rawStatus === 'streaming' ? 'cancelled' : (rawStatus as DatabaseAiPaneMessageRecord['status'])
  return {
    id,
    requestId,
    role,
    status,
    content: String(raw.content ?? ''),
    contextSummary: String(raw.contextSummary ?? ''),
    createdAt,
    updatedAt
  }
}

const normalizeDatabaseAiPaneState = (state?: Partial<DatabaseAiPaneStateSnapshot>): DatabaseAiPaneStateSnapshot => {
  const width = Number(state?.width)
  const messages = Array.isArray(state?.messages)
    ? state.messages.map(normalizeDatabaseAiPaneStateMessage).filter((message): message is DatabaseAiPaneMessageRecord => Boolean(message))
    : []
  return {
    open: state?.open === true,
    width: Math.min(DATABASE_AI_PANE_MAX_WIDTH, Math.max(DATABASE_AI_PANE_MIN_WIDTH, Number.isFinite(width) ? Math.round(width) : DATABASE_AI_PANE_DEFAULT_WIDTH)),
    context: normalizeDatabaseAiPaneStateContext(state?.context),
    draft: typeof state?.draft === 'string' ? state.draft : '',
    messages: messages.slice(-DATABASE_AI_PANE_MAX_MESSAGES).map(cloneDatabaseAiPaneMessageRecord)
  }
}

const cloneDatabaseAiPaneState = (state: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  open: state.open,
  width: state.width,
  context: { ...state.context },
  draft: state.draft,
  messages: state.messages.map(cloneDatabaseAiPaneMessageRecord)
})

const sortedDatabaseAiPaneMessages = () =>
  Array.from(databaseAiPaneMessages.values())
    .sort((first, second) => first.createdAt - second.createdAt)
    .slice(-DATABASE_AI_PANE_MAX_MESSAGES)
    .map(cloneDatabaseAiPaneMessageRecord)

const syncDatabaseAiPaneStateMessages = () => {
  databaseAiPaneState = {
    ...databaseAiPaneState,
    messages: sortedDatabaseAiPaneMessages()
  }
}

const replaceDatabaseAiPaneState = (state: DatabaseAiPaneStateSnapshot) => {
  databaseAiPaneState = normalizeDatabaseAiPaneState(state)
  databaseAiPaneMessages.clear()
  databaseAiPaneState.messages.forEach((message) => {
    databaseAiPaneMessages.set(message.id, cloneDatabaseAiPaneMessageRecord(message))
  })
  syncDatabaseAiPaneStateMessages()
}

const storeDatabaseAiPaneMessage = (message: DatabaseAiPaneMessageRecord) => {
  databaseAiPaneMessages.set(message.id, cloneDatabaseAiPaneMessageRecord(message))
  syncDatabaseAiPaneStateMessages()
  return message
}

const findDatabaseAiPaneAssistantMessage = (input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneMessageRecord | null => {
  const assistantMessageId = trim(input.assistantMessageId)
  if (assistantMessageId) {
    const message = databaseAiPaneMessages.get(assistantMessageId)
    if (message?.role === 'assistant') return cloneDatabaseAiPaneMessageRecord(message)
  }
  const requestId = trim(input.requestId)
  if (!requestId) return null
  return (
    Array.from(databaseAiPaneMessages.values())
      .filter((message) => message.role === 'assistant' && message.requestId === requestId)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}

const updateDatabaseAiPaneAssistantMessage = (
  input: DatabaseAiPaneLifecycleInput,
  patch: Partial<Pick<DatabaseAiPaneMessageRecord, 'status' | 'content' | 'updatedAt'>>
): DatabaseAiPaneMessageRecord | null => {
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return null
  const updated: DatabaseAiPaneMessageRecord = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? databaseAiNow()
  }
  databaseAiPaneMessages.set(updated.id, cloneDatabaseAiPaneMessageRecord(updated))
  syncDatabaseAiPaneStateMessages()
  return updated
}

const cloneDatabaseAiDrawerRequestRecord = (request: DatabaseAiDrawerRequestRecord): DatabaseAiDrawerRequestRecord => ({
  ...request,
  backendContext: { ...request.backendContext }
})

const storeDatabaseAiDrawerRequest = (request: DatabaseAiDrawerRequestRecord) => {
  databaseAiDrawerRequests.set(request.id, cloneDatabaseAiDrawerRequestRecord(request))
  return request
}

const findDatabaseAiDrawerRequest = (input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerRequestRecord | null => {
  const requestId = trim(input.requestId)
  if (!requestId) return null
  const request = databaseAiDrawerRequests.get(requestId)
  return request ? cloneDatabaseAiDrawerRequestRecord(request) : null
}

const updateDatabaseAiDrawerRequest = (
  input: DatabaseAiDrawerLifecycleInput,
  patch: Partial<Pick<DatabaseAiDrawerRequestRecord, 'status' | 'text' | 'targetDialect' | 'updatedAt'>>
): DatabaseAiDrawerRequestRecord | null => {
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return null
  const updated = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? databaseAiNow()
  }
  databaseAiDrawerRequests.set(updated.id, cloneDatabaseAiDrawerRequestRecord(updated))
  return updated
}

const databaseAiPaneContextSummary = (input: DatabaseAiPaneResponseInput) =>
  trim(input.context.contextSummary) ||
  [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')

const databaseAiPaneErrorResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  provider: DatabaseAiResponseProvider = 'aiopsterm-local'
): DatabaseAiPaneResponseResult => {
  const requestId = trim(input.requestId) || `dbai-pane-request-${randomUUID()}`
  const contextSummary = databaseAiPaneContextSummary(input)
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  let assistantMessage: DatabaseAiPaneMessageRecord
  if (existing && existing.status !== 'cancelled') {
    assistantMessage =
      updateDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: existing.id }, { status: 'error', content: errorMessage }) ?? existing
  } else {
    assistantMessage =
      existing ??
      storeDatabaseAiPaneMessage(
        databaseAiPaneMessageRecord(
          {
            requestId,
            role: 'assistant',
            status: 'error',
            content: errorMessage,
            contextSummary,
            createdAt: startedAt
          },
          input.assistantMessageId || `dbai-pane-message-${randomUUID()}`
        )
      )
  }

  persistDatabaseState()
  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      requestId,
      assistantMessage,
      text: assistantMessage.content,
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const databaseAiDrawerErrorResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  provider: DatabaseAiResponseProvider = 'aiopsterm-local'
): DatabaseAiDrawerResponseResult => {
  const requestId = trim(input.requestId)
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  const targetDialect = drawerTargetDialect(input)
  const text = `Reasoning\n- ${errorMessage}`
  let request: DatabaseAiDrawerRequestRecord
  if (existing && existing.status !== 'cancelled') {
    request = updateDatabaseAiDrawerRequest({ requestId: existing.id }, { status: 'error', text, targetDialect }) ?? existing
  } else {
    request =
      existing ??
      storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'error',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: databaseAiNow()
      })
  }

  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      request,
      text: request.text,
      reasoning: request.text,
      sql: '',
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const databaseAiDrawerActionName = (action: DatabaseAiDrawerAction) => {
  switch (action) {
    case 'explain':
      return 'Explain SQL'
    case 'nl2sql':
      return 'Natural Language to SQL'
    case 'optimize':
      return 'Optimize SQL'
    case 'convert':
      return 'Convert SQL'
    case 'complete':
      return 'Complete SQL'
    case 'diagnose':
      return 'Diagnose SQL'
    case 'truncate':
      return 'Truncate Table'
    case 'drop':
      return 'Drop Table'
    default:
      return action
  }
}

const wait = (durationMs: number) => {
  if (databaseAiRuntime.wait) return databaseAiRuntime.wait(durationMs)
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

const databaseAiNow = () => (databaseAiRuntime.now ? databaseAiRuntime.now() : Date.now())

const databaseAiModelName = () => trim(databaseAiRuntime.getModelName?.()) || 'aiopsterm-local-agent'

const shouldUseDatabaseAiProvider = (modelName: string) => trim(modelName) !== '' && trim(modelName) !== 'aiopsterm-local-agent'

const isExplicitDatabaseAiLocalDoubleEnabled = () => {
  try {
    return typeof process !== 'undefined' && String(process.env?.AIOPSTERM_DB_AI_BACKEND_DOUBLE || '').trim() === '1'
  } catch {
    return false
  }
}

const isDatabaseAiLocalDoubleEnabled = () => databaseAiRuntime.localBackendDouble === true || isExplicitDatabaseAiLocalDoubleEnabled()

const unquoteIdentifier = (value: string) => value.replace(/^[`"\[]|[`"\]]$/g, '').replace(/""/g, '"').replace(/``/g, '`').replace(/]]/g, ']')

const tableNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w.-]+[`"\]]?)?)/i)
  if (!match) return ''
  const parts = match[1]
    .split('.')
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean)
  return parts.at(-1) || ''
}

const keyParts = (key: string) => {
  const [connectionId, databaseName, schemaName, tableName] = key.split(':')
  return { connectionId, databaseName, schemaName, tableName }
}

const tableKeysForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) =>
  Object.keys(tableRows)
    .filter((key) => {
      const parts = keyParts(key)
      if (parts.connectionId !== input.connectionId) return false
      if (input.databaseName && parts.databaseName !== input.databaseName) return false
      if (input.schemaName && parts.schemaName !== input.schemaName) return false
      return true
    })
    .sort()

const firstTableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) => tableKeysForContext(input)[0] || ''

const quoteIdentifier = (value: string, dbType: DatabaseConnectionTestInput['dbType']) => {
  const raw = String(value || '')
  if (dbType === 'mysql') return `\`${raw.replace(/`/g, '``')}\``
  if (dbType === 'sqlserver') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

const qualifiedTableReference = (input: { dbType?: DatabaseConnectionTestInput['dbType'] | ''; databaseName?: string; schemaName?: string; tableName: string }) => {
  const dbType = input.dbType && supportedEngines.has(input.dbType) ? input.dbType : 'postgresql'
  const table = quoteIdentifier(input.tableName, dbType)
  if ((dbType === 'postgresql' || dbType === 'oracle' || dbType === 'sqlserver') && input.schemaName) return `${quoteIdentifier(input.schemaName, dbType)}.${table}`
  if (dbType === 'sqlite' && input.databaseName) return `${quoteIdentifier(input.databaseName, dbType)}.${table}`
  return table
}

const sampleSelectForContext = (input: DatabaseAiPaneResponseInput) => {
  const key = firstTableKeyForContext({
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  if (!key) return 'select 1;'
  const parts = keyParts(key)
  const qualified = qualifiedTableReference({
    dbType: input.context.dbType || 'postgresql',
    databaseName: parts.databaseName,
    schemaName: parts.schemaName,
    tableName: parts.tableName
  })
  if (input.context.dbType === 'oracle') return `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;`
  if (input.context.dbType === 'sqlserver') return `SELECT TOP (100) *\nFROM ${qualified};`
  return `SELECT *\nFROM ${qualified}\nLIMIT 100;`
}

const schemaSummaryForContext = (input: DatabaseAiPaneResponseInput) => {
  const keys = tableKeysForContext({
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  if (!keys.length) return ['- No table metadata is available behind the local DB AI backend boundary.']
  const grouped = new Map<string, string[]>()
  keys.forEach((key) => {
    const parts = keyParts(key)
    const group = parts.schemaName || parts.databaseName || 'default'
    const columns = tableColumns[key] ?? columnsForRows(tableRows[key] ?? [])
    const label = `${parts.tableName}(${columns.length} columns)`
    grouped.set(group, [...(grouped.get(group) ?? []), label])
  })
  return [...grouped.entries()].map(([group, tables]) => `- ${group}: ${tables.slice(0, 5).join(', ')}`)
}

const drawerDbType = (input: DatabaseAiDrawerResponseInput) =>
  input.context.dbType && supportedEngines.has(input.context.dbType) ? input.context.dbType : 'postgresql'

const normalizeDatabaseAiTargetDialect = (dialect: DatabaseAiTargetDialect | '' | undefined): DatabaseAiTargetDialect =>
  dialect === 'sqlserver' ? 'mssql' : dialect || 'postgresql'

const drawerTargetDialect = (input: DatabaseAiDrawerResponseInput): DatabaseAiTargetDialect =>
  normalizeDatabaseAiTargetDialect(input.targetDialect || drawerDbType(input))

const quoteDrawerIdentifier = (value: string, dialect: DatabaseAiTargetDialect) => {
  const raw = String(value || '').replace(/^[`"\[]|[`"\]]$/g, '')
  if (dialect === 'mysql') return `\`${raw.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

const dialectLabel = (dialect: DatabaseAiTargetDialect) => {
  if (dialect === 'postgresql') return 'PostgreSQL'
  if (dialect === 'mysql') return 'MySQL'
  if (dialect === 'sqlite') return 'SQLite'
  if (dialect === 'oracle') return 'Oracle'
  if (dialect === 'mssql' || dialect === 'sqlserver') return 'SQL Server'
  return dialect
}

const stripSqlTerminator = (sql: string) => sql.trim().replace(/;+$/, '').trim()

const ensureSqlTerminated = (sql: string) => {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

const extractSqlLimit = (sql: string) => {
  const limitMatch = sql.match(/\blimit\s+(\d+)\b/i)
  if (limitMatch) return Number(limitMatch[1])
  const fetchMatch = sql.match(/\bfetch\s+first\s+(\d+)\s+rows\s+only\b/i)
  if (fetchMatch) return Number(fetchMatch[1])
  const topMatch = sql.match(/\btop\s*\(\s*(\d+)\s*\)/i)
  if (topMatch) return Number(topMatch[1])
  return null
}

const addDialectLimit = (sql: string, dialect: DatabaseAiTargetDialect, fallbackLimit: number) => {
  const limit = extractSqlLimit(sql) ?? fallbackLimit
  let withoutLimit = stripSqlTerminator(sql)
    .replace(/\s+limit\s+\d+\s*$/i, '')
    .replace(/\s+fetch\s+first\s+\d+\s+rows\s+only\s*$/i, '')
  const topMatch = withoutLimit.match(/^\s*select\s+top\s*\(\s*(\d+)\s*\)\s+/i)
  if (topMatch) withoutLimit = withoutLimit.replace(/^\s*select\s+top\s*\(\s*\d+\s*\)\s+/i, 'SELECT ')
  const resolvedLimit = Number(topMatch?.[1] ?? limit)
  if (dialect === 'oracle') return ensureSqlTerminated(`${withoutLimit}\nFETCH FIRST ${resolvedLimit} ROWS ONLY`)
  if (dialect === 'mssql' || dialect === 'sqlserver') return ensureSqlTerminated(withoutLimit.replace(/^\s*select\s+/i, `SELECT TOP (${resolvedLimit}) `))
  return ensureSqlTerminated(`${withoutLimit}\nLIMIT ${resolvedLimit}`)
}

const stripLeadingSqlComments = (sql: string) => {
  let next = sql.trim()
  let changed = true
  while (changed) {
    const before = next
    next = next.replace(/^--[^\n]*(?:\n|$)/, '').replace(/^\/\*[\s\S]*?\*\//, '').trimStart()
    changed = next !== before
  }
  return next
}

const isReadOnlySql = (sql: string) => {
  const cleaned = stripLeadingSqlComments(sql).trim()
  if (!/^(select|with|explain)\b/i.test(cleaned)) return false
  return !/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|execute)\b/i.test(cleaned)
}

const drawerTableReference = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const explicitTable = trim(input.context.tableName) || tableNameFromSql(input.sourceSql)
  const connectionId = trim(input.context.connectionId)
  const databaseName = trim(input.context.databaseName)
  const schemaName = trim(input.context.schemaName) || schemaNameFromSql(input.sourceSql)
  const key = explicitTable
    ? tableKeyForContext({ connectionId, databaseName, schemaName, tableName: explicitTable })
    : firstTableKeyForContext({ connectionId, databaseName, schemaName })
  const parts = key ? keyParts(key) : { databaseName, schemaName, tableName: explicitTable || 'orders' }
  if ((dialect === 'postgresql' || dialect === 'oracle' || dialect === 'mssql' || dialect === 'sqlserver') && parts.schemaName) {
    return `${quoteDrawerIdentifier(parts.schemaName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  }
  if (dialect === 'sqlite' && parts.databaseName) return `${quoteDrawerIdentifier(parts.databaseName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  return quoteDrawerIdentifier(parts.tableName, dialect)
}

const buildDrawerNl2Sql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const tableRef = drawerTableReference(input, dialect)
  if (dialect === 'oracle') {
    return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nFETCH FIRST 20 ROWS ONLY;`
  }
  if (dialect === 'mssql' || dialect === 'sqlserver') {
    return `SELECT TOP (20) id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC;`
  }
  return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nLIMIT 20;`
}

const completeDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const fallback = `SELECT *\nFROM ${drawerTableReference(input, dialect)}`
  const base = stripSqlTerminator(input.sourceSql.trim() || fallback)
  let completed = base
  if (/\bwhere\s*$/i.test(completed)) {
    completed = `${completed} status = 'open'`
  } else if (!/\bwhere\b/i.test(completed) && /^\s*(select|with)\b/i.test(completed)) {
    completed = `${completed}\nWHERE status = 'open'`
  }
  return addDialectLimit(completed, dialect, 100)
}

const optimizeDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const fallback = `SELECT id, service, status, owner, updated_at\nFROM ${drawerTableReference(input, dialect)}`
  const base = stripSqlTerminator(input.sourceSql.trim() || fallback)
  const compact = base.replace(/\bselect\s+\*/i, 'SELECT id, service, status, owner, updated_at')
  return addDialectLimit(compact, dialect, 100)
}

const convertDrawerSqlToDialect = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const normalized = stripSqlTerminator(input.sourceSql.trim() || 'SELECT 1')
  const quoted = normalized
    .replace(/"([^"]+)"/g, (_match, value: string) => quoteDrawerIdentifier(value, dialect))
    .replace(/`([^`]+)`/g, (_match, value: string) => quoteDrawerIdentifier(value, dialect))
    .replace(/\[([^\]]+)\]/g, (_match, value: string) => quoteDrawerIdentifier(value, dialect))
  return addDialectLimit(quoted, dialect, extractSqlLimit(normalized) ?? 100)
}

const diagnoseDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const tableRef = drawerTableReference(input, dialect)
  if (dialect === 'oracle') return `SELECT *\nFROM ${tableRef}\nFETCH FIRST 100 ROWS ONLY;`
  if (dialect === 'mssql' || dialect === 'sqlserver') return `SELECT TOP (100) *\nFROM ${tableRef};`
  return `SELECT *\nFROM ${tableRef}\nLIMIT 100;`
}

const buildDrawerGeneratedSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action === 'convert') return convertDrawerSqlToDialect(input, dialect)
  if (input.action === 'diagnose') return diagnoseDrawerSql(input, dialect)
  if (input.action === 'nl2sql') return buildDrawerNl2Sql(input, dialect)
  if (input.action === 'complete') return completeDrawerSql(input, dialect)
  if (input.action === 'optimize') return optimizeDrawerSql(input, dialect)
  return ensureSqlTerminated(input.sourceSql.trim() || 'SELECT 1')
}

const isExecutableDrawerDialect = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action !== 'convert') return true
  if (dialect === 'mssql') return drawerDbType(input) === 'sqlserver'
  return drawerDbType(input) === dialect
}

const buildDrawerReasoning = (input: DatabaseAiDrawerResponseInput, generatedSql: string, dialect: DatabaseAiTargetDialect) => {
  const contextLine =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName, input.context.tableName].filter(Boolean).join(' · ')
  const lines = ['Reasoning', '- Read the active database context and selected editor range through the aiopsterm backend boundary.']
  if (contextLine) lines.push(`- Context: ${contextLine}.`)
  lines.push('- 当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。')
  if (input.action === 'convert') {
    lines.push(`- Converted the SQL text to ${dialectLabel(dialect)} syntax.`)
    lines.push(isExecutableDrawerDialect(input, dialect) ? '- Target dialect matches the active connection, so read-only execution can be enabled.' : '- Target dialect is text-only for this connection.')
  } else if (input.action === 'diagnose') {
    lines.push('- Built a conservative read-only statement that can verify the referenced table.')
    if (trim(input.errorMessage)) lines.push(`- Diagnosis input error: ${trim(input.errorMessage)}.`)
  } else if (input.action === 'drop' || input.action === 'truncate') {
    lines.push('- Preserved the destructive SQL as generated text only; execution remains blocked by the read-only guard.')
  } else if (input.action === 'nl2sql') {
    lines.push('- Mapped the request to the first visible table in the current database context.')
  } else if (input.action === 'complete') {
    lines.push('- Completed the current statement with a bounded read-only predicate.')
  } else if (input.action === 'optimize') {
    lines.push('- Kept the query read-only and added a safer bounded projection for review.')
  } else {
    lines.push('- Kept the source SQL available for editor actions and review.')
  }
  lines.push(`- Generated SQL is ${isReadOnlySql(generatedSql) ? 'read-only' : 'not read-only'} before any execution action.`)
  if (input.sourceSql.trim() && input.sourceSql !== generatedSql) {
    lines.push('- The original editor SQL remains unchanged until Copy, Replace, Insert, or Run ReadOnly is chosen.')
  }
  return lines.join('\n')
}

const composeDrawerResponseText = (reasoning: string, generatedSql: string) => `${reasoning}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``

const normalizeDatabaseAiProviderText = (value: unknown) => String(value || '').trim()

const databaseAiContextLines = (context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']) => {
  const lines = [
    `Connection id: ${normalizeDatabaseAiProviderText(context.connectionId) || '(not set)'}`,
    `Engine: ${normalizeDatabaseAiProviderText(context.dbType) || '(not set)'}`,
    `Current database: ${normalizeDatabaseAiProviderText(context.databaseName) || '(not set)'}`,
    `Current schema: ${normalizeDatabaseAiProviderText(context.schemaName) || '(not set)'}`,
    `Context summary: ${normalizeDatabaseAiProviderText(context.contextSummary) || '(not set)'}`
  ]
  const tableName = 'tableName' in context ? normalizeDatabaseAiProviderText(context.tableName) : ''
  if (tableName) lines.push(`Current table: ${tableName}`)
  return lines
}

const databaseAiSchemaSummaryForContext = (context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']) => {
  const connectionId = normalizeDatabaseAiProviderText(context.connectionId)
  const databaseName = normalizeDatabaseAiProviderText(context.databaseName)
  const schemaName = normalizeDatabaseAiProviderText(context.schemaName)
  if (!connectionId || !databaseName) return ['- No backend schema metadata is available for this request context.']
  const keys = tableKeysForContext({ connectionId, databaseName, schemaName })
  if (!keys.length) return ['- No backend schema metadata is available for this request context.']
  return keys.slice(0, 16).map((key) => {
    const parts = keyParts(key)
    const columns = tableColumns[key] ?? columnsForRows(tableRows[key] ?? [])
    const qualified = [parts.databaseName, parts.schemaName, parts.tableName].filter(Boolean).join('.')
    return `- ${qualified}: ${columns.slice(0, 12).join(', ')}`
  })
}

const buildDatabaseAiProviderSystemPrompt = (
  surface: 'pane' | 'drawer',
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context'],
  extra: string[] = []
) =>
  [
    'You are aiopsterm DB-AI, a database-workspace assistant for relational database analysis, SQL drafting, SQL review, and safe diagnostics.',
    'Respond in the same language as the operator when possible.',
    'There is no shell, filesystem, SSH, or remote-host workspace in this request. Only use the database context supplied below.',
    'Do not claim that you executed SQL, changed schemas, queried live data, or inspected objects unless the supplied context explicitly includes that result.',
    'Never reveal or invent credentials, connection strings, API keys, hostnames, or IP addresses.',
    'Do not invent tables, columns, indexes, constraints, or types. If schema metadata is missing, say what is missing and ask for the next required context.',
    'Prefer read-only SQL and diagnostics. For destructive or write operations, provide SQL as review text only and explain the risk; do not claim execution.',
    surface === 'drawer'
      ? 'For drawer requests, return a concise reasoning section followed by exactly one fenced SQL block using ```sql. The SQL block is required.'
      : 'For pane requests, answer conversationally and include SQL in fenced ```sql blocks when SQL is useful.',
    '',
    'Database context:',
    ...databaseAiContextLines(context),
    '',
    'Backend schema metadata available to this request:',
    ...databaseAiSchemaSummaryForContext(context),
    ...extra
  ]
    .filter((line) => line !== '')
    .join('\n')

const paneProviderMessages = (input: DatabaseAiPaneResponseInput, prompt: string): DatabaseAiProviderTextMessage[] => {
  const messages = (input.messages || [])
    .slice(-12)
    .map((message): DatabaseAiProviderTextMessage | null => {
      const content = normalizeDatabaseAiProviderText(message.content)
      if (!content) return null
      return { role: message.role === 'assistant' ? 'assistant' : 'user', content }
    })
    .filter(Boolean) as DatabaseAiProviderTextMessage[]
  if (normalizeDatabaseAiProviderText(input.activeSql)) {
    messages.push({ role: 'user', content: `Active SQL editor content:\n${normalizeDatabaseAiProviderText(input.activeSql)}` })
  }
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user' || last.content !== prompt) {
    messages.push({ role: 'user', content: prompt })
  }
  return messages
}

const drawerProviderMessages = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect): DatabaseAiProviderTextMessage[] => {
  const actionLabel = databaseAiDrawerActionName(input.action)
  const details = [
    `Action: ${actionLabel}`,
    `Target dialect: ${dialectLabel(dialect)}`,
    normalizeDatabaseAiProviderText(input.errorMessage) ? `Observed SQL error: ${normalizeDatabaseAiProviderText(input.errorMessage)}` : '',
    normalizeDatabaseAiProviderText(input.sourceSql) ? `Source SQL:\n${normalizeDatabaseAiProviderText(input.sourceSql)}` : '',
    '',
    'Return a concise reasoning section followed by one fenced SQL block. The SQL must match the target dialect and the current database context.'
  ]
    .filter(Boolean)
    .join('\n')
  return [{ role: 'user', content: details }]
}

const extractFencedSqlBlock = (text: string) => {
  const match = text.match(/```(?:sql|mysql|postgresql|sqlite|oracle|mssql|tsql)?\s*([\s\S]*?)```/i)
  const sql = normalizeDatabaseAiProviderText(match?.[1])
  if (!match || !sql) return { sql: '', reasoning: normalizeDatabaseAiProviderText(text) }
  const reasoning = normalizeDatabaseAiProviderText(text.slice(0, match.index)) || normalizeDatabaseAiProviderText(text.replace(match[0], ''))
  return { sql, reasoning }
}

const storeDatabaseAiPaneDoneResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  requestId: string,
  text: string,
  contextLine: string
) => {
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord(
      {
        requestId,
        role: 'assistant',
        status: 'done',
        content: text,
        contextSummary: contextLine,
        createdAt: existing?.createdAt ?? startedAt
      },
      input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
    )
  )
  assistantMessage.updatedAt = databaseAiNow()
  databaseAiPaneMessages.set(assistantMessage.id, cloneDatabaseAiPaneMessageRecord(assistantMessage))
  syncDatabaseAiPaneStateMessages()
  return assistantMessage
}

async function generateProviderDatabaseAiPaneResponse(
  input: DatabaseAiPaneResponseInput,
  modelName: string,
  startedAt: number,
  prompt: string
): Promise<DatabaseAiPaneResponseResult> {
  const generateText = databaseAiRuntime.generateText
  if (!generateText) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }
  const contextLine = databaseAiPaneContextSummary(input)
  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const existingBefore = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingBefore?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existingBefore,
        text: existingBefore.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const providerResponse = await generateText({
    surface: 'pane',
    modelName,
    prompt,
    context: input.context,
    requestId,
    assistantMessageId: input.assistantMessageId,
    activeSql: input.activeSql,
    systemPrompt: buildDatabaseAiProviderSystemPrompt('pane', input.context, [
      normalizeDatabaseAiProviderText(input.activeSql) ? 'Active SQL editor content is included in the user messages.' : 'No active SQL editor content was supplied.'
    ]),
    messages: paneProviderMessages(input, prompt),
    maxTokens: 1800
  })
  const existingAfter = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingAfter?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existingAfter,
        text: existingAfter.content,
        provider: providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  if (!providerResponse.ok) {
    return databaseAiPaneErrorResponse(
      input,
      startedAt,
      providerResponse.errorCode,
      providerResponse.errorMessage,
      providerResponse.provider || 'aiopsterm-local'
    )
  }
  const text = normalizeDatabaseAiProviderText(providerResponse.text)
  if (!text) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_EMPTY', 'Database AI provider returned an empty response.', providerResponse.provider)
  }
  const assistantMessage = storeDatabaseAiPaneDoneResponse(input, startedAt, requestId, text, contextLine)
  persistDatabaseState()
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: providerResponse.provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const storeDatabaseAiDrawerDoneResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  requestId: string,
  dialect: DatabaseAiTargetDialect,
  text: string
) => {
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  return existing && requestId
    ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect })
    : storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'done',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect: dialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: databaseAiNow()
      })
}

async function generateProviderDatabaseAiDrawerResponse(
  input: DatabaseAiDrawerResponseInput,
  modelName: string,
  startedAt: number,
  dialect: DatabaseAiTargetDialect
): Promise<DatabaseAiDrawerResponseResult> {
  const generateText = databaseAiRuntime.generateText
  if (!generateText) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }
  const requestId = trim(input.requestId)
  const existingBefore = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existingBefore?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existingBefore,
        text: existingBefore.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const providerResponse = await generateText({
    surface: 'drawer',
    modelName,
    prompt: databaseAiDrawerActionName(input.action),
    context: input.context,
    requestId,
    action: input.action,
    sourceSql: input.sourceSql,
    targetDialect: dialect,
    errorMessage: input.errorMessage,
    systemPrompt: buildDatabaseAiProviderSystemPrompt('drawer', input.context, [
      `Drawer action: ${databaseAiDrawerActionName(input.action)}`,
      `Target dialect: ${dialectLabel(dialect)}`
    ]),
    messages: drawerProviderMessages(input, dialect),
    maxTokens: 1400
  })
  const existingAfter = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existingAfter?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existingAfter,
        text: existingAfter.text,
        reasoning: '',
        sql: '',
        provider: providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  if (!providerResponse.ok) {
    return databaseAiDrawerErrorResponse(
      input,
      startedAt,
      providerResponse.errorCode,
      providerResponse.errorMessage,
      providerResponse.provider || 'aiopsterm-local'
    )
  }
  const providerText = normalizeDatabaseAiProviderText(providerResponse.text)
  if (!providerText) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_EMPTY', 'Database AI provider returned an empty response.', providerResponse.provider)
  }
  const parsed = extractFencedSqlBlock(providerText)
  if (!parsed.sql) {
    return databaseAiDrawerErrorResponse(
      input,
      startedAt,
      'DB_AI_PROVIDER_SQL_MISSING',
      'Database AI provider response did not include a fenced SQL block.',
      providerResponse.provider
    )
  }
  const reasoning = parsed.reasoning || `Reasoning\n- Provider returned SQL for ${databaseAiDrawerActionName(input.action)}.`
  const text = composeDrawerResponseText(reasoning, parsed.sql)
  const request = storeDatabaseAiDrawerDoneResponse(input, startedAt, requestId, dialect, text)
  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: parsed.sql,
      provider: providerResponse.provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const schemaNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?)\s*\.\s*([`"\[]?[\w.-]+[`"\]]?)/i)
  return match ? unquoteIdentifier(match[1].trim()) : ''
}

const tableRowsForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) => {
  const tableName = trim(input.tableName)
  const candidates = [
    `${input.connectionId}:${input.databaseName || ''}:${input.schemaName || ''}:${tableName}`,
    `${input.connectionId}:${input.databaseName || ''}::${tableName}`
  ]
  const found = candidates.map((key) => tableRows[key]).find(Boolean)
  return found?.map((row) => ({ ...row })) ?? null
}

const tableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) => {
  const tableName = trim(input.tableName)
  const candidates = [
    `${input.connectionId}:${input.databaseName || ''}:${input.schemaName || ''}:${tableName}`,
    `${input.connectionId}:${input.databaseName || ''}::${tableName}`
  ]
  return candidates.find((key) => tableRows[key]) || ''
}

const findRowsForSql = (input: DatabaseSqlExecuteInput, sql: string) => {
  const tableName = tableNameFromSql(sql)
  const explicitSchema = schemaNameFromSql(sql)
  return tableRowsForContext({
    connectionId: input.connectionId,
    databaseName: input.databaseName,
    schemaName: explicitSchema || input.schemaName || '',
    tableName
  })
}

const constantRowsForSql = (sql: string) => {
  const normalized = normalizeSql(sql).replace(/;$/, '')
  const match = normalized.match(/^select\s+1(?:\s+as\s+([A-Za-z_][\w$]*))?$/i)
  if (!match) return null
  return [{ [match[1] || 'result']: 1 }]
}

const resolveSeedSqlRows = (input: DatabaseSqlExecuteInput, sql: string) => {
  const explained = /^explain\b/i.test(sql)
  const tableName = tableNameFromSql(sql)
  const tableRows = tableName ? findRowsForSql(input, sql) : null
  if (explained) {
    if (tableName && !tableRows) {
      return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${tableName}` }
    }
    return {
      ok: true as const,
      rows: [
        { step: 1, operation: tableName ? 'Seq Scan' : 'Result', relation: tableName || 'derived', cost: '0.00..12.40', rows: tableRows?.length ?? 1 },
        { step: 2, operation: 'Limit', relation: 'result', cost: '0.00..1.00', rows: 1 }
      ]
    }
  }
  if (tableRows) return { ok: true as const, rows: tableRows }
  const constantRows = constantRowsForSql(sql)
  if (constantRows) return { ok: true as const, rows: constantRows }
  if (/\bfrom\b/i.test(sql)) {
    return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${tableName || 'unknown'}` }
  }
  return {
    ok: false as const,
    errorCode: 'DB_SQL_UNSUPPORTED',
    errorMessage: 'Seed database SQL execution supports backend-known tables or SELECT 1 only.'
  }
}

const normalizeFilterValue = (value: unknown) => {
  if (value === null || value === undefined) return null
  return String(value)
}

const matchesFilter = (value: unknown, filter: DatabaseColumnFilter) => {
  const normalized = normalizeFilterValue(value)
  if (filter.operator === 'isnull') return normalized === null
  if (filter.operator === 'notnull') return normalized !== null
  if (normalized === null) return false
  if (filter.operator === 'like') return normalized.toLowerCase().includes(String(filter.value ?? '').toLowerCase())
  if (filter.operator === 'eq') return normalized === String(filter.value ?? '')
  if (filter.operator === 'neq') return normalized !== String(filter.value ?? '')
  if (filter.operator === 'in') return (filter.values ?? []).map(String).includes(normalized)
  return true
}

function parseWhereRaw(whereRaw: string | null | undefined): DatabaseColumnFilter[] {
  const raw = trim(whereRaw)
  if (!raw) return []
  const match = raw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (!match) return []
  return [
    {
      column: match[1],
      operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq',
      value: match[3]
    }
  ]
}

const filterRows = (rows: Array<Record<string, unknown>>, filters: DatabaseColumnFilter[]) => {
  if (!filters.length) return rows
  return rows.filter((row) => filters.every((filter) => matchesFilter(row[filter.column], filter)))
}

const sortRows = (rows: Array<Record<string, unknown>>, sort: DatabaseColumnSort | null | undefined) => {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const av = a[sort.column]
    const bv = b[sort.column]
    const factor = sort.direction === 'asc' ? 1 : -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor
  })
}

const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

function parseOrderByRaw(orderByRaw: string | null | undefined, knownColumns: string[]): DatabaseColumnSort | null {
  const raw = trim(orderByRaw).replace(/^order\s+by\s+/i, '')
  if (!raw) return null
  const knownColumnMap = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const first = raw.split(',')[0]?.trim() || ''
  const match = first.match(
    /^((?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*))*)(?:\s+(asc|desc))?/i
  )
  if (!match) return null
  const column = normalizeOrderByIdentifier(match[1])
  const knownColumn = knownColumnMap.get(column.toLowerCase())
  if (!knownColumn) return null
  return { column: knownColumn, direction: match[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
}

const rowKeyFor = (row: Record<string, unknown>, primaryKey: string[], index: number) => {
  if (!primaryKey.length) return `row-${index}`
  return JSON.stringify(primaryKey.map((column) => row[column] ?? null))
}

export async function testDatabaseConnection(input: DatabaseConnectionTestInput): Promise<DatabaseConnectionTestResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  if (!supportedEngines.has(input.dbType)) {
    return { ok: false, errorCode: 'DB_UNSUPPORTED_ENGINE', errorMessage: `Unsupported database engine: ${input.dbType}` }
  }

  if (!trim(input.name)) {
    return { ok: false, errorCode: 'DB_CONNECTION_NAME_REQUIRED', errorMessage: 'Connection name is required.' }
  }

  if (input.dbType === 'sqlite') {
    const filePath = sqliteFilePathFromTestInput(input)
    if (!filePath) {
      return { ok: false, errorCode: 'DB_SQLITE_FILE_REQUIRED', errorMessage: 'SQLite file path is required.' }
    }
    if (!isSqliteFileExtension(filePath)) {
      return { ok: false, errorCode: 'DB_SQLITE_EXTENSION', errorMessage: 'SQLite file should end with .db, .sqlite, or .sqlite3.' }
    }
    if (!existsSync(filePath)) {
      return { ok: false, errorCode: 'DB_SQLITE_FILE_NOT_FOUND', errorMessage: 'SQLite file does not exist.' }
    }
    let db: SqliteDatabase | null = null
    try {
      db = openSqliteDatabase(filePath, input.readonly !== false)
      const rows = db.prepare('SELECT sqlite_version() AS version').all()
      const version = String(rows[0]?.version ?? '').trim()
      return {
        ok: true,
        data: {
          dbType: input.dbType,
          serverVersion: version ? `SQLite ${version}` : engineVersions.sqlite,
          endpoint: endpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: sqliteErrorCode(error, 'DB_SQLITE_OPEN_FAILED'),
        errorMessage: sqliteErrorMessage(error, 'SQLite connection test failed.')
      }
    } finally {
      db?.close()
    }
  } else {
    const hasOracleConnectString = input.dbType === 'oracle' && !!trim(input.url)
    if (hasOracleConnectString && !/(jdbc:oracle|:\/\/|:)/i.test(trim(input.url))) {
      return { ok: false, errorCode: 'DB_ORACLE_CONNECT_STRING', errorMessage: 'Oracle connect string is not valid enough for backend validation.' }
    }
    if (!hasOracleConnectString) {
      if (!trim(input.host)) {
        return { ok: false, errorCode: 'DB_HOST_REQUIRED', errorMessage: 'Database host is required.' }
      }
      if (typeof input.port !== 'number' || !Number.isFinite(input.port) || input.port <= 0) {
        return { ok: false, errorCode: 'DB_PORT_REQUIRED', errorMessage: 'Database port is required.' }
      }
    }
    if (!trim(input.user)) {
      return { ok: false, errorCode: 'DB_USER_REQUIRED', errorMessage: 'Database user is required.' }
    }
  }

  if (!shouldUseDatabaseSeedData()) {
    if (input.dbType === 'mysql' || input.dbType === 'postgresql' || input.dbType === 'oracle' || input.dbType === 'sqlserver') {
      return testRelationalDatabaseConnection(input, startedAt)
    }
  }

  return {
    ok: true,
    data: {
      dbType: input.dbType,
      serverVersion: engineVersions[input.dbType],
      endpoint: endpointFor(input),
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

export async function saveDatabaseConnection(input: DatabaseConnectionSaveInput): Promise<DatabaseConnectionSaveResult> {
  ensureDatabaseStateLoaded()
  const existingIndex = input.mode === 'edit' ? databaseConnections.findIndex((connection) => connection.id === trim(input.id)) : -1
  if (input.mode === 'edit' && existingIndex === -1) {
    return {
      ok: false,
      errorCode: 'DB_CONNECTION_NOT_FOUND',
      errorMessage: 'Database connection was not found.'
    }
  }
  const existing = existingIndex >= 0 ? databaseConnections[existingIndex] : null
  const connectionSecret = trim(input.connection.password)
  const validationConnection =
    input.mode === 'edit' && !connectionSecret && existing?.hasPassword
      ? { ...input.connection, password: databaseConnectionSecrets.get(existing.id) || '' }
      : input.connection
  const testResult = await testDatabaseConnection(validationConnection)
  if (!testResult.ok) {
    return {
      ok: false,
      errorCode: testResult.errorCode || 'DB_CONNECTION_SAVE_FAILED',
      errorMessage: testResult.errorMessage || 'Database connection validation failed.'
    }
  }

  const normalized = normalizeDatabaseConnectionSaveDraft(input.connection)

  if (input.mode === 'edit') {
    const existing = databaseConnections[existingIndex]
    const saved: DatabaseConnectionInfo = {
      id: existing.id,
      ...normalized,
      hasPassword: connectionSecret ? true : existing.hasPassword,
      status: existing.dbType === normalized.dbType && existing.host === normalized.host && existing.port === normalized.port && existing.database === normalized.database ? existing.status : 'idle',
      catalogs:
        existing.dbType === normalized.dbType && existing.database === normalized.database && shouldUseDatabaseSeedData()
          ? existing.catalogs.map((catalog) => cloneDatabaseCatalog(existing.id, catalog))
          : defaultCatalogsForSavedConnection({
              id: existing.id,
              ...normalized,
              hasPassword: connectionSecret ? true : existing.hasPassword,
              status: existing.status
            })
    }
    databaseConnections[existingIndex] = saved
    if (connectionSecret) databaseConnectionSecrets.set(saved.id, connectionSecret)
    if (!connectionSecret && !saved.hasPassword) databaseConnectionSecrets.delete(saved.id)
    databaseVerifiedConnections.delete(saved.id)
    persistDatabaseState()
    return {
      ok: true,
      data: {
        ...databaseWorkspaceCatalogFor(saved.id),
        connection: cloneDatabaseConnection(saved),
        message: 'Connection saved'
      }
    }
  }

  const saved: DatabaseConnectionInfo = {
    id: nextDatabaseConnectionId(normalized.name),
    ...normalized,
    hasPassword: !!connectionSecret,
    status: 'idle',
    catalogs: []
  }
  saved.catalogs = defaultCatalogsForSavedConnection(saved)
  databaseConnections.push(saved)
  if (connectionSecret) databaseConnectionSecrets.set(saved.id, connectionSecret)
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      message: 'Connection saved'
    }
  }
}

export async function createDatabaseCatalog(input: DatabaseCreateDatabaseInput): Promise<DatabaseCreateDatabaseResult> {
  ensureDatabaseStateLoaded()
  const connectionIndex = databaseConnections.findIndex((connection) => connection.id === trim(input.connectionId))
  const connection = connectionIndex >= 0 ? databaseConnections[connectionIndex] : null
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (connection.dbType !== 'mysql' && connection.dbType !== 'postgresql' && connection.dbType !== 'sqlserver') {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_UNSUPPORTED', errorMessage: 'Create Database is only available for MySQL, PostgreSQL, and SQL Server connections.' }
  }

  const name = databaseNameFromCreateSql(input.sql) || trim(input.requestedName)
  if (!name) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_SQL_INVALID', errorMessage: 'CREATE DATABASE statement is required.' }
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_NAME_INVALID', errorMessage: 'Database name must start with a letter or underscore and contain only letters, numbers, and underscores.' }
  }
  if (connection.catalogs.some((catalog) => catalog.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_DUPLICATE', errorMessage: 'Database already exists.' }
  }

  if (!shouldUseDatabaseSeedData()) {
    try {
      if (connection.dbType === 'mysql') {
        await withMysqlConnection(connection, async (client) => {
          await mysqlExec(client, input.sql || `CREATE DATABASE ${relationalIdentifier(name, 'mysql')}`)
        })
      } else if (connection.dbType === 'postgresql') {
        await withPostgresClient(connection, async (client) => {
          await postgresExec(client, input.sql || `CREATE DATABASE ${relationalIdentifier(name, 'postgresql')}`)
        })
      } else {
        await withSqlServerPool(connection, async (client) => {
          await sqlServerExec(client, input.sql || `CREATE DATABASE ${relationalIdentifier(name, 'sqlserver')}`)
        })
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: relationalErrorCode(
          error,
          connection.dbType === 'mysql'
            ? 'DB_MYSQL_CREATE_DATABASE_FAILED'
            : connection.dbType === 'sqlserver'
              ? 'DB_SQLSERVER_CREATE_DATABASE_FAILED'
              : 'DB_POSTGRES_CREATE_DATABASE_FAILED'
        ),
        errorMessage: relationalErrorMessage(error, 'Create database failed.')
      }
    }
  }

  const catalog = createDatabaseCatalogForConnection(connection, name)
  const saved: DatabaseConnectionInfo = {
    ...connection,
    catalogs: [...connection.catalogs.map((item) => (shouldUseDatabaseSeedData() ? cloneDatabaseCatalog(connection.id, item) : cloneDatabaseCatalogRaw(item))), catalog]
  }
  databaseConnections[connectionIndex] = saved
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      catalog: cloneDatabaseCatalog(saved.id, catalog),
      message: 'Database created in workspace catalog'
    }
  }
}

export async function executeDatabaseSql(input: DatabaseSqlExecuteInput): Promise<DatabaseSqlExecuteResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  const rawSql = trim(input.sql)
  const sql = normalizeSql(input.sql || '')
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!rawSql) {
    return { ok: false, errorCode: 'DB_SQL_EMPTY', errorMessage: 'SQL is required.' }
  }
  if (/drop\s+database|syntax_error/i.test(sql)) {
    return { ok: false, errorCode: 'DB_SQL_REJECTED', errorMessage: 'Backend SQL executor rejected this statement.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteExecute(connection, rawSql, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isRelationalConnection(connection)) return relationalExecute(connection, rawSql, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine execution is not wired in this aiopsterm backend yet.' }
  }

  const resolved = resolveSeedSqlRows(input, sql)
  if (!resolved.ok) {
    return {
      ok: false,
      errorCode: resolved.errorCode,
      errorMessage: resolved.errorMessage
    }
  }
  const rows = resolved.rows

  return {
    ok: true,
    data: {
      columns: columnsForRows(rows),
      rows,
      rowCount: rows.length,
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

export async function getDatabaseTableDdl(input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> {
  ensureDatabaseStateLoaded()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteTableDdl(connection, input)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isRelationalConnection(connection)) return relationalTableDdl(connection, input)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine DDL lookup is not wired in this aiopsterm backend yet.' }
  }

  const key = tableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const entry = tableDdlEntries[key]
  if (!entry?.ddl.trim()) {
    return { ok: false, errorCode: 'other', errorMessage: 'DDL is empty.' }
  }
  if (entry.error) {
    return { ok: false, errorCode: entry.error.code, errorMessage: entry.error.message }
  }
  return { ok: true, data: { ddl: entry.ddl } }
}

export async function queryDatabaseTable(input: DatabaseTableQueryInput): Promise<DatabaseTableQueryResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteQueryTable(connection, input, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isRelationalConnection(connection)) return relationalQueryTable(connection, input, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table query is not wired in this aiopsterm backend yet.' }
  }

  const tableKey = tableKeyForContext(input)
  if (!tableKey) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const sourceRows = tableRows[tableKey].map((row) => ({ ...row }))

  const knownColumns = tableColumns[tableKey]?.slice() ?? columnsForRows(sourceRows)
  const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
  const filteredRows = filterRows(sourceRows, filters)
  const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
  const rows = sortRows(filteredRows, sort)
  const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const start = (page - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize).map((row) => ({ ...row }))

  return {
    ok: true,
    data: {
      columns: knownColumns,
      rows: pageRows,
      rowCount: pageRows.length,
      durationMs: Math.max(1, Date.now() - startedAt),
      total: input.withTotal ? rows.length : null,
      knownColumns
    }
  }
}

export async function planDatabaseTableMutation(input: DatabaseTableMutationPlanInput): Promise<DatabaseTableMutationPlanResult> {
  ensureDatabaseStateLoaded()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }
  if (!Array.isArray(input.mutations)) {
    return { ok: false, errorCode: 'DB_MUTATIONS_REQUIRED', errorMessage: 'Table mutations are required.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    let db: SqliteDatabase | null = null
    try {
      db = openSqliteDatabase(sqliteFilePathFromConnection(connection), true)
      const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
      const knownColumns = sqliteKnownColumnsForTable(db, schemaName, trim(input.tableName))
      if (!knownColumns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
        return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
      }
      return { ok: true, data: databaseMutationPlanData(connection, input, knownColumns.length ? knownColumns : inputKnownColumns(input)) }
    } catch (error) {
      return {
        ok: false,
        errorCode: databaseMutationPlanErrorCode(error, 'DB_SQLITE_MUTATION_PLAN_FAILED'),
        errorMessage: databaseMutationPlanErrorMessage(error, 'SQLite table mutation planning failed.')
      }
    } finally {
      db?.close()
    }
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }

  if (!shouldUseDatabaseSeedData()) {
    if (isRelationalConnection(connection)) {
      try {
        const columns = await relationalColumnsForTable(connection, input)
        if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const knownColumns = columns.map((column) => column.name)
        return { ok: true, data: databaseMutationPlanData(connection, input, knownColumns.length ? knownColumns : inputKnownColumns(input)) }
      } catch (error) {
        return {
          ok: false,
          errorCode: relationalErrorCode(error, relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'MUTATION_PLAN_FAILED')),
          errorMessage: relationalErrorMessage(error, 'Database table mutation planning failed.')
        }
      }
    }
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table mutation planning is not wired in this aiopsterm backend yet.' }
  }

  const key = tableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const knownColumns = tableColumns[key]?.slice() ?? inputKnownColumns(input) ?? columnsForRows(tableRows[key])
  try {
    return { ok: true, data: databaseMutationPlanData(connection, input, knownColumns) }
  } catch (error) {
    return {
      ok: false,
      errorCode: databaseMutationPlanErrorCode(error, 'DB_MUTATION_PLAN_FAILED'),
      errorMessage: databaseMutationPlanErrorMessage(error, 'Database table mutation planning failed.')
    }
  }
}

export async function mutateDatabaseTable(input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteMutateTable(connection, input, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isRelationalConnection(connection)) return relationalMutateTable(connection, input, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table mutations are not wired in this aiopsterm backend yet.' }
  }

  const key = tableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const rows = tableRows[key]
  let affected = 0

  input.mutations.forEach((mutation) => {
    if (mutation.kind === 'drop') {
      affected += rows.length
      delete tableRows[key]
      delete tableColumns[key]
      delete tableDdlEntries[key]
      return
    }
    if (mutation.kind === 'truncate') {
      affected += rows.length
      rows.splice(0, rows.length)
      return
    }
    if (mutation.kind === 'insert') {
      rows.push({ ...mutation.values })
      affected += 1
      return
    }

    const index = rows.findIndex((row, rowIndex) => rowKeyFor(row, mutation.primaryKey, rowIndex) === mutation.rowKey)
    if (index < 0) return

    if (mutation.kind === 'delete') {
      rows.splice(index, 1)
      affected += 1
      return
    }

    rows[index] = { ...rows[index], ...mutation.patch }
    affected += 1
  })
  persistDatabaseState()

  return {
    ok: true,
    data: {
      affected,
      durationMs: Math.max(1, Date.now() - startedAt),
      catalog: databaseWorkspaceCatalogFor(input.connectionId)
    }
  }
}

export async function createDatabaseAiPaneRequest(input: DatabaseAiPaneRequestInput): Promise<DatabaseAiPaneRequestResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  const prompt = trim(input.prompt)
  if (!prompt) return { ok: false, errorCode: 'DB_AI_PROMPT_REQUIRED', errorMessage: 'Prompt is required.' }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.context.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  const requestId = `dbai-pane-request-${randomUUID()}`
  const contextSummary =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')
  const userCreatedAt = startedAt
  const userMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord({
      requestId,
      role: 'user',
      status: 'done',
      content: prompt,
      contextSummary,
      createdAt: userCreatedAt
    })
  )
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord({
      requestId,
      role: 'assistant',
      status: 'queued',
      content: '',
      contextSummary,
      createdAt: userCreatedAt + 1
    })
  )
  persistDatabaseState()
  return {
    ok: true,
    data: {
      requestId,
      userMessage,
      assistantMessage
    }
  }
}

export function startDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  ensureDatabaseStateLoaded()
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'cancelled' || existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, { status: 'streaming' })
  if (assistantMessage) persistDatabaseState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export function cancelDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  ensureDatabaseStateLoaded()
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, {
    status: 'cancelled',
    content: existing.content || 'Response cancelled before the first chunk.'
  })
  if (assistantMessage) persistDatabaseState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export async function generateDatabaseAiPaneResponse(input: DatabaseAiPaneResponseInput): Promise<DatabaseAiPaneResponseResult> {
  ensureDatabaseStateLoaded()
  const startedAt = databaseAiNow()
  const prompt = trim(input.prompt)
  if (!prompt) return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROMPT_REQUIRED', 'Prompt is required.')
  if (!trim(input.context.connectionId)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }
  if (!trim(input.context.databaseName)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_DATABASE_REQUIRED', 'Database name is required.')
  }

  const modelName = databaseAiModelName()
  if (shouldUseDatabaseAiProvider(modelName)) {
    return generateProviderDatabaseAiPaneResponse(input, modelName, startedAt, prompt)
  }
  if (!isDatabaseAiLocalDoubleEnabled()) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }

  const promptLower = prompt.toLowerCase()
  const contextLine = databaseAiPaneContextSummary(input)
  const recentTurns = (input.messages || []).filter((message) => message.role === 'user').slice(-4).length
  const selectSql = sampleSelectForContext(input)
  const lines = [`Context: ${contextLine}`, '当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。', `Recent user turns: ${recentTurns}`]

  if (promptLower.includes('explain') || promptLower.includes('解释')) {
    lines.push(
      '',
      'I read the active SQL editor and current database context.',
      'Execution notes:',
      '- Keep the query read-only before running it from the workbench.',
      '- Verify WHERE clauses before widening result sets.',
      '- Check indexes on join/filter columns if latency grows.',
      '',
      'Suggested next SQL:',
      '```sql',
      selectSql,
      '```'
    )
  } else if (promptLower.includes('schema') || promptLower.includes('table') || promptLower.includes('表')) {
    lines.push('', 'Schema summary:', ...schemaSummaryForContext(input), '', 'Recommended starting point:', '```sql', selectSql, '```')
  } else if (promptLower.includes('select') || promptLower.includes('query') || promptLower.includes('sql')) {
    const key = firstTableKeyForContext({
      connectionId: input.context.connectionId,
      databaseName: input.context.databaseName,
      schemaName: input.context.schemaName || ''
    })
    const tableName = key ? keyParts(key).tableName : ''
    lines.push('', `Generated a conservative read-only query${tableName ? ` for ${tableName}` : ''}.`, '', '```sql', selectSql, '```')
  } else {
    lines.push(
      '',
      'I can help inspect schema metadata, draft read-only SQL, explain editor SQL, and suggest optimization checks in this database workspace.',
      '',
      '```sql',
      selectSql,
      '```'
    )
  }

  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const text = lines.join('\n')
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existing,
        text: existing.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord(
      {
        requestId,
        role: 'assistant',
        status: 'done',
        content: text,
        contextSummary: contextLine,
        createdAt: existing?.createdAt ?? startedAt
      },
      input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
    )
  )
  assistantMessage.updatedAt = databaseAiNow()
  databaseAiPaneMessages.set(assistantMessage.id, cloneDatabaseAiPaneMessageRecord(assistantMessage))
  syncDatabaseAiPaneStateMessages()
  persistDatabaseState()
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function createDatabaseAiDrawerRequest(input: DatabaseAiDrawerRequestInput): Promise<DatabaseAiDrawerRequestResult> {
  ensureDatabaseStateLoaded()
  const now = Date.now()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return { ok: false, errorCode: 'DB_AI_ACTION_INVALID', errorMessage: 'DB AI action is not supported.' }
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }

  const request: DatabaseAiDrawerRequestRecord = {
    id: `dbai-drawer-request-${randomUUID()}`,
    action,
    label: databaseAiDrawerActionName(action),
    status: 'queued',
    contextSummary: trim(input.context.contextSummary),
    sourceSql: input.sourceSql,
    text: '',
    targetDialect: drawerTargetDialect(input),
    backendContext: {
      connectionId: trim(input.context.connectionId),
      dbType: input.context.dbType || '',
      databaseName: trim(input.context.databaseName),
      schemaName: trim(input.context.schemaName) || undefined,
      tableName: trim(input.context.tableName) || undefined,
      contextSummary: trim(input.context.contextSummary) || undefined
    },
    createdAt: now,
    updatedAt: now
  }
  return { ok: true, data: storeDatabaseAiDrawerRequest(request) }
}

export function startDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  ensureDatabaseStateLoaded()
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'cancelled') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'streaming', text: '' })
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export function cancelDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  ensureDatabaseStateLoaded()
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'done' || existing.status === 'error') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'cancelled' })
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export async function generateDatabaseAiDrawerResponse(input: DatabaseAiDrawerResponseInput): Promise<DatabaseAiDrawerResponseResult> {
  ensureDatabaseStateLoaded()
  const startedAt = databaseAiNow()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_ACTION_INVALID', 'DB AI action is not supported.')
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_SQL_REQUIRED', 'SQL is required.')
  }
  if (!trim(input.context.connectionId)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }

  const dialect = drawerTargetDialect(input)
  const modelName = databaseAiModelName()
  if (shouldUseDatabaseAiProvider(modelName)) {
    return generateProviderDatabaseAiDrawerResponse(input, modelName, startedAt, dialect)
  }
  if (!isDatabaseAiLocalDoubleEnabled()) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }

  const generatedSql = buildDrawerGeneratedSql(input, dialect)
  const reasoning = buildDrawerReasoning(input, generatedSql, dialect)
  const requestId = trim(input.requestId)
  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existing,
        text: existing.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const text = composeDrawerResponseText(reasoning, generatedSql)
  const request =
    existing && requestId
      ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect })
      : storeDatabaseAiDrawerRequest({
          id: requestId || `dbai-drawer-request-${randomUUID()}`,
          action,
          label: databaseAiDrawerActionName(action),
          status: 'done',
          contextSummary: trim(input.context.contextSummary),
          sourceSql: input.sourceSql,
          text,
          targetDialect: dialect,
          backendContext: {
            connectionId: trim(input.context.connectionId),
            dbType: input.context.dbType || '',
            databaseName: trim(input.context.databaseName),
            schemaName: trim(input.context.schemaName) || undefined,
            tableName: trim(input.context.tableName) || undefined,
            contextSummary: trim(input.context.contextSummary) || undefined
          },
          createdAt: startedAt,
          updatedAt: databaseAiNow()
        })

  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }

  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: generatedSql,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function diagnoseDatabaseSqlError(input: DatabaseSqlErrorDiagnosisInput): Promise<DatabaseSqlErrorDiagnosisResult> {
  ensureDatabaseStateLoaded()
  const sourceSql = trim(input.sourceSql)
  const errorMessage = trim(input.errorMessage)
  if (!sourceSql) return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  if (!errorMessage) return { ok: false, errorCode: 'DB_AI_ERROR_REQUIRED', errorMessage: 'SQL error message is required.' }

  const created = await createDatabaseAiDrawerRequest({
    action: 'diagnose',
    sourceSql,
    targetDialect: input.targetDialect,
    context: input.context,
    errorMessage
  })
  if (!created.ok || !created.data) {
    return { ok: false, errorCode: created.errorCode, errorMessage: created.errorMessage }
  }

  const started = startDatabaseAiDrawerResponse({ requestId: created.data.id })
  if (!started.ok || !started.data) {
    return { ok: false, errorCode: started.errorCode, errorMessage: started.errorMessage }
  }

  return generateDatabaseAiDrawerResponse({
    requestId: created.data.id,
    action: 'diagnose',
    sourceSql: created.data.sourceSql,
    targetDialect: created.data.targetDialect,
    context: created.data.backendContext,
    errorMessage
  })
}
