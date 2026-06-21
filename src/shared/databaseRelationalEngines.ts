import type {
  DatabaseCatalogInfo,
  DatabaseColumnFilter,
  DatabaseColumnInfo,
  DatabaseColumnSort,
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseEngineCode,
  DatabaseSchemaInfo,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult,
  DatabaseWorkspaceCatalog
} from './contracts/database'
import {
  buildDatabaseMutationStatement,
  databaseMutationTableReference,
  type DatabaseMutationStatement
} from './databaseMutationPlanner'

export type RelationalDatabaseType = Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'oracle' | 'sqlserver'>
export type RelationalDatabaseConnection = DatabaseConnectionInfo & { dbType: RelationalDatabaseType }
type DatabaseSqlExecuteRawData = Omit<NonNullable<DatabaseSqlExecuteResult['data']>, 'execution'>
type DatabaseSqlExecuteRawResult = {
  ok: boolean
  data?: DatabaseSqlExecuteRawData
  errorCode?: string
  errorMessage?: string
}

export type MySqlConnection = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<[T, unknown]>
  end: () => Promise<unknown>
  destroy?: () => unknown
}
export type MySqlDriver = {
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
export type PostgresDriver = {
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
export type OracleDriver = {
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
export type SqlServerDriver = {
  ConnectionPool: new (config: Record<string, unknown>) => SqlServerPool
}
export type DatabaseProxySocket = {
  destroy?: () => unknown
}
export type DatabaseProxySocketResult = {
  proxyName: string
  socket: DatabaseProxySocket
}

type DatabaseRelationalRuntime = {
  mysqlDriver?: MySqlDriver
  postgresDriver?: PostgresDriver
  oracleDriver?: OracleDriver | null
  sqlServerDriver?: SqlServerDriver | null
  createProxySocket?: (input: DatabaseConnectionTestInput, targetHost: string, targetPort: number, options?: { timeoutMs?: number }) => Promise<DatabaseProxySocketResult | null>
  oracleClientLibDir?: string
  oracleClientConfigDir?: string
  oracleDriverName?: string
  connectionInputFromSaved: (connection: DatabaseConnectionInfo) => DatabaseConnectionTestInput
  refreshConnectionCatalog: (connectionId: string, loadCatalogs: (connection: DatabaseConnectionInfo) => Promise<DatabaseCatalogInfo[]>) => Promise<void>
  workspaceCatalogFor: (selectedConnectionId?: string) => DatabaseWorkspaceCatalog | undefined
}

const RELATIONAL_TIMEOUT_MS = 10_000
let runtime: DatabaseRelationalRuntime | null = null
let mysqlRuntime: MySqlDriver | null | undefined
let postgresRuntime: PostgresDriver | null | undefined
let oracleRuntime: OracleDriver | null | undefined
let sqlServerRuntime: SqlServerDriver | null | undefined
let oracleClientInitialized = false

export function configureDatabaseRelationalEngines(config: DatabaseRelationalRuntime) {
  runtime = config
  resetDatabaseRelationalRuntime()
}

export function resetDatabaseRelationalRuntime() {
  mysqlRuntime = undefined
  postgresRuntime = undefined
  oracleRuntime = undefined
  sqlServerRuntime = undefined
  oracleClientInitialized = false
}

const configuredRuntime = () => {
  if (!runtime) throw new Error('Database relational engine runtime has not been configured.')
  return runtime
}

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizedDatabasePort = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

const normalizeQueryRows = (rows: unknown): Array<Record<string, unknown>> =>
  Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }))
    : []

const columnsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {})

const rowValue = (row: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
    const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
    if (found) return row[found]
  }
  return undefined
}

const databaseColumnId = (connectionId: string, tableName: string) => `tbl-${connectionId}-${tableName.replace(/[^A-Za-z0-9_-]+/g, '-')}`

const sqlitePrimaryKeyForColumns = (columns: DatabaseColumnInfo[]) =>
  columns.filter((column) => column.key === 'PK').map((column) => column.name)

const unquoteDatabaseIdentifier = (value: string) => {
  const token = trim(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  if (token.startsWith('[') && token.endsWith(']')) return token.slice(1, -1).replace(/]]/g, ']')
  return token
}

const schemaHasObjects = (schema: DatabaseSchemaInfo) =>
  schema.tables.length || (schema.views?.length ?? 0) || (schema.functions?.length ?? 0) || (schema.procedures?.length ?? 0)

const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

const parseWhereRaw = (whereRaw: string | null | undefined): DatabaseColumnFilter[] => {
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

const parseOrderByRaw = (orderByRaw: string | null | undefined, knownColumns: string[]): DatabaseColumnSort | null => {
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

export const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'

export const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | '') => dbType === 'postgresql' || dbType === 'kingbase'

const mysqlCompatibleLabel = (dbType: DatabaseEngineCode | '') => (dbType === 'mariadb' ? 'MariaDB' : dbType === 'oceanbase' ? 'OceanBase' : 'MySQL')

const postgresCompatibleLabel = (dbType: DatabaseEngineCode | '') => (dbType === 'kingbase' ? 'KingBase' : 'PostgreSQL')

const mysqlCompatibleDriverErrorCode = (dbType: DatabaseEngineCode | '') =>
  dbType === 'mariadb' ? 'DB_MARIADB_DRIVER_UNAVAILABLE' : dbType === 'oceanbase' ? 'DB_OCEANBASE_DRIVER_UNAVAILABLE' : 'DB_MYSQL_DRIVER_UNAVAILABLE'

const postgresCompatibleDriverErrorCode = (dbType: DatabaseEngineCode | '') =>
  dbType === 'kingbase' ? 'DB_KINGBASE_DRIVER_UNAVAILABLE' : 'DB_POSTGRES_DRIVER_UNAVAILABLE'

export const isRelationalConnection = (connection: DatabaseConnectionInfo | null | undefined): connection is RelationalDatabaseConnection =>
  !!connection &&
  (connection.dbType === 'mysql' ||
    connection.dbType === 'mariadb' ||
    connection.dbType === 'oceanbase' ||
    connection.dbType === 'postgresql' ||
    connection.dbType === 'kingbase' ||
    connection.dbType === 'oracle' ||
    connection.dbType === 'sqlserver')

export const relationalErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : code || fallback
}

export const relationalErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

const relationalEngineCode = (dbType: RelationalDatabaseType) =>
  dbType === 'postgresql' || dbType === 'kingbase' ? (dbType === 'kingbase' ? 'KINGBASE' : 'POSTGRES') : dbType.toUpperCase()

export const relationalFallbackCode = (dbType: RelationalDatabaseType, action: string) => `DB_${relationalEngineCode(dbType)}_${action}`

const relationalIdentifier = (value: string, dbType: RelationalDatabaseType) =>
  isMysqlCompatibleDbType(dbType)
    ? `\`${String(value || '').replace(/`/g, '``')}\``
    : dbType === 'sqlserver'
      ? `[${String(value || '').replace(/]/g, ']]')}]`
      : `"${String(value || '').replace(/"/g, '""')}"`

const relationalPlaceholder = (dbType: RelationalDatabaseType, index: number) => {
  if (isPostgresCompatibleDbType(dbType)) return `$${index}`
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
  if (isPostgresCompatibleDbType(connection.dbType)) return `${relationalIdentifier(trim(input.schemaName) || 'public', dbType)}.${table}`
  if (connection.dbType === 'sqlserver') return `${relationalIdentifier(trim(input.schemaName) || 'dbo', 'sqlserver')}.${table}`
  if (connection.dbType === 'oracle') {
    const schemaName = oracleSchemaNameFor(connection, input)
    return schemaName ? `${relationalIdentifier(schemaName, 'oracle')}.${table}` : table
  }
  return `${relationalIdentifier(trim(input.databaseName), dbType)}.${table}`
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

const databaseProxyRequested = (input: Pick<DatabaseConnectionTestInput, 'needProxy' | 'proxyName'>) => !!input.needProxy || !!trim(input.proxyName)

const databaseProxyUnsupportedFor = (dbType: DatabaseConnectionTestInput['dbType']) => {
  if (dbType === 'oracle') {
    return {
      errorCode: 'DB_PROXY_ORACLE_UNSUPPORTED',
      errorMessage: 'Database SSH proxy is not supported for Oracle connect strings in this version.'
    }
  }
  if (dbType === 'clickhouse') {
    return {
      errorCode: 'DB_PROXY_CLICKHOUSE_UNSUPPORTED',
      errorMessage: 'Database SSH proxy is not supported for ClickHouse HTTP connections in this version.'
    }
  }
  if (dbType === 'presto') {
    return {
      errorCode: 'DB_PROXY_PRESTO_UNSUPPORTED',
      errorMessage: 'Database SSH proxy is not supported for Presto HTTP connections in this version.'
    }
  }
  return null
}

const databaseProxyUnsupportedError = (dbType: DatabaseConnectionTestInput['dbType']) => {
  const unsupported = databaseProxyUnsupportedFor(dbType)
  return unsupported ? Object.assign(new Error(unsupported.errorMessage), { code: unsupported.errorCode }) : null
}

const databaseProxyTarget = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port'>) => {
  const host = trim(input.host)
  const port = normalizedDatabasePort(input.port)
  if (!host || !port) return null
  return { host, port }
}

const createDatabaseProxySocket = async (input: DatabaseConnectionTestInput) => {
  if (!databaseProxyRequested(input)) return null
  const unsupported = databaseProxyUnsupportedError(input.dbType)
  if (unsupported) throw unsupported
  const createProxySocket = configuredRuntime().createProxySocket
  if (!createProxySocket) {
    throw Object.assign(new Error('Database SSH proxy runtime is unavailable.'), { code: 'DB_PROXY_RUNTIME_UNAVAILABLE' })
  }
  const target = databaseProxyTarget(input)
  if (!target) {
    throw Object.assign(new Error('Database proxy requires a host and port target.'), { code: 'DB_PROXY_TARGET_INVALID' })
  }
  return createProxySocket(input, target.host, target.port, { timeoutMs: RELATIONAL_TIMEOUT_MS })
}

const closeDatabaseProxySocket = (proxy: DatabaseProxySocketResult | null | undefined) => {
  try {
    proxy?.socket.destroy?.()
  } catch {
    /* ignore proxy socket close errors */
  }
}

const loadMysqlRuntime = () => {
  const runtimeConfig = configuredRuntime()
  if (runtimeConfig.mysqlDriver) return runtimeConfig.mysqlDriver
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
  const runtimeConfig = configuredRuntime()
  if (runtimeConfig.postgresDriver) return runtimeConfig.postgresDriver
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
  const runtimeConfig = configuredRuntime()
  if ('oracleDriver' in runtimeConfig) return runtimeConfig.oracleDriver ?? null
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
  const runtimeConfig = configuredRuntime()
  if ('sqlServerDriver' in runtimeConfig) return runtimeConfig.sqlServerDriver ?? null
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
  const runtimeConfig = configuredRuntime()
  if (oracleClientInitialized || !driver.initOracleClient) return
  const libDir = trim(runtimeConfig.oracleClientLibDir)
  const configDir = trim(runtimeConfig.oracleClientConfigDir)
  const driverName = trim(runtimeConfig.oracleDriverName)
  if (!libDir && !configDir && !driverName) return
  driver.initOracleClient({
    ...(libDir ? { libDir } : {}),
    ...(configDir ? { configDir } : {}),
    ...(driverName ? { driverName } : {})
  })
  oracleClientInitialized = true
}

const mysqlConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>, proxy?: DatabaseProxySocketResult | null) => ({
  host: trim(input.host),
  port: normalizedDatabasePort(input.port) ?? undefined,
  user: trim(input.user),
  password: input.password || undefined,
  database: trim(input.database) || undefined,
  connectTimeout: RELATIONAL_TIMEOUT_MS,
  ...(proxy ? { stream: proxy.socket } : {}),
  ...(trim(input.sslMode) && trim(input.sslMode) !== 'disable' ? { ssl: { rejectUnauthorized: false } } : {})
})

const postgresConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>, proxy?: DatabaseProxySocketResult | null) => ({
  host: trim(input.host),
  port: normalizedDatabasePort(input.port) ?? undefined,
  user: trim(input.user),
  password: input.password || undefined,
  database: trim(input.database) || undefined,
  connectionTimeoutMillis: RELATIONAL_TIMEOUT_MS,
  ...(proxy ? { stream: proxy.socket } : {}),
  ...(trim(input.sslMode) && trim(input.sslMode) !== 'disable' ? { ssl: { rejectUnauthorized: false } } : {})
})

const sqlServerConfigFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'user' | 'password' | 'database' | 'sslMode'>, proxy?: DatabaseProxySocketResult | null) => ({
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
    enableArithAbort: true,
    ...(proxy ? { connector: () => Promise.resolve(proxy.socket) } : {})
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

const connectionTestInputFromSaved = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => configuredRuntime().connectionInputFromSaved(connection)

const openMysqlConnection = async (
  input: DatabaseConnectionTestInput,
  dbType: DatabaseEngineCode | '' = 'mysql'
) => {
  const driver = loadMysqlRuntime()
  if (!driver) {
    const label = mysqlCompatibleLabel(dbType)
    throw Object.assign(new Error(`${label} driver is unavailable. Install mysql2 before connecting to ${label}.`), {
      code: mysqlCompatibleDriverErrorCode(dbType)
    })
  }
  const proxy = await createDatabaseProxySocket(input)
  try {
    const client = await driver.createConnection(mysqlConfigFor(input, proxy))
    return { client, proxy }
  } catch (error) {
    closeDatabaseProxySocket(proxy)
    throw error
  }
}

const openPostgresClient = async (
  input: DatabaseConnectionTestInput,
  dbType: DatabaseEngineCode | '' = 'postgresql'
) => {
  const driver = loadPostgresRuntime()
  if (!driver) {
    const label = postgresCompatibleLabel(dbType)
    throw Object.assign(new Error(`${label} driver is unavailable. Install pg before connecting to ${label}.`), {
      code: postgresCompatibleDriverErrorCode(dbType)
    })
  }
  const proxy = await createDatabaseProxySocket(input)
  const client = new driver.Client(postgresConfigFor(input, proxy))
  try {
    await client.connect()
    return { client, proxy }
  } catch (error) {
    closeDatabaseProxySocket(proxy)
    throw error
  }
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

const openSqlServerPool = async (input: DatabaseConnectionTestInput) => {
  const driver = loadSqlServerRuntime()
  if (!driver) {
    throw Object.assign(new Error('SQL Server driver is unavailable. Install mssql before connecting to SQL Server.'), {
      code: 'DB_SQLSERVER_DRIVER_UNAVAILABLE'
    })
  }
  const proxy = await createDatabaseProxySocket(input)
  const pool = new driver.ConnectionPool(sqlServerConfigFor(input, proxy))
  try {
    const connectedPool = typeof pool.connect === 'function' ? await pool.connect() : pool
    return { pool: connectedPool, proxy }
  } catch (error) {
    closeDatabaseProxySocket(proxy)
    throw error
  }
}

const withMysqlConnection = async <T>(connection: DatabaseConnectionInfo, fn: (client: MySqlConnection) => Promise<T>) => {
  let client: MySqlConnection | null = null
  let proxy: DatabaseProxySocketResult | null = null
  try {
    const opened = await openMysqlConnection(connectionTestInputFromSaved(connection), connection.dbType)
    client = opened.client
    proxy = opened.proxy
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        client.destroy?.()
      }
    }
    closeDatabaseProxySocket(proxy)
  }
}

const withPostgresClient = async <T>(connection: DatabaseConnectionInfo, fn: (client: PostgresClient) => Promise<T>) => {
  let client: PostgresClient | null = null
  let proxy: DatabaseProxySocketResult | null = null
  try {
    const opened = await openPostgresClient(connectionTestInputFromSaved(connection), connection.dbType)
    client = opened.client
    proxy = opened.proxy
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        /* ignore close errors */
      }
    }
    closeDatabaseProxySocket(proxy)
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
  let proxy: DatabaseProxySocketResult | null = null
  try {
    const opened = await openSqlServerPool(connectionTestInputFromSaved(connection))
    client = opened.pool
    proxy = opened.proxy
    return await fn(client)
  } finally {
    if (client) {
      try {
        await client.close()
      } catch {
        /* ignore close errors */
      }
    }
    closeDatabaseProxySocket(proxy)
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

const relationalEndpointFor = (input: DatabaseConnectionTestInput) => {
  if (input.dbType === 'oracle' && trim(input.url)) return trim(input.url)
  const host = trim(input.host)
  const port = typeof input.port === 'number' && Number.isFinite(input.port) ? input.port : null
  return port ? `${host}:${port}` : host
}

export const testRelationalDatabaseConnection = async (input: DatabaseConnectionTestInput, startedAt: number): Promise<DatabaseConnectionTestResult> => {
  if (isMysqlCompatibleDbType(input.dbType)) {
    let client: MySqlConnection | null = null
    let proxy: DatabaseProxySocketResult | null = null
    const label = mysqlCompatibleLabel(input.dbType)
    try {
      const opened = await openMysqlConnection(input, input.dbType)
      client = opened.client
      proxy = opened.proxy
      const rows = await mysqlRows<{ version?: string; v?: string }>(client, 'SELECT VERSION() AS version')
      const version = trim(rows[0]?.version || rows[0]?.v)
      return {
        ok: true,
        data: {
          dbType: input.dbType,
          serverVersion: version ? `${label} ${version}` : label,
          endpoint: relationalEndpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: relationalErrorCode(error, relationalFallbackCode(input.dbType, 'CONNECTION_FAILED')),
        errorMessage: relationalErrorMessage(error, `${label} connection failed.`)
      }
    } finally {
      if (client) {
        try {
          await client.end()
        } catch {
          client.destroy?.()
        }
      }
      closeDatabaseProxySocket(proxy)
    }
  }

  if (isPostgresCompatibleDbType(input.dbType)) {
    let client: PostgresClient | null = null
    let proxy: DatabaseProxySocketResult | null = null
    const label = postgresCompatibleLabel(input.dbType)
    try {
      const opened = await openPostgresClient(input, input.dbType)
      client = opened.client
      proxy = opened.proxy
      const rows = await postgresRows<{ version?: string }>(client, 'SELECT version() AS version')
      const version = trim(rows[0]?.version)
      return {
        ok: true,
        data: {
          dbType: input.dbType,
          serverVersion: version ? (version.toLowerCase().includes(label.toLowerCase()) ? version : `${label} ${version}`) : label,
          endpoint: relationalEndpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: relationalErrorCode(error, relationalFallbackCode(input.dbType, 'CONNECTION_FAILED')),
        errorMessage: relationalErrorMessage(error, `${label} connection failed.`)
      }
    } finally {
      if (client) {
        try {
          await client.end()
        } catch {
          /* ignore close errors */
        }
      }
      closeDatabaseProxySocket(proxy)
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
          endpoint: relationalEndpointFor(input),
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
    let proxy: DatabaseProxySocketResult | null = null
    try {
      const opened = await openSqlServerPool(input)
      client = opened.pool
      proxy = opened.proxy
      const rows = await sqlServerRows<Record<string, unknown>>(client, "SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(128)) AS version")
      const version = trim(rowValue(rows[0] ?? {}, 'version', 'VERSION'))
      return {
        ok: true,
        data: {
          dbType: 'sqlserver',
          serverVersion: version ? `SQL Server ${version}` : 'SQL Server',
          endpoint: relationalEndpointFor(input),
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
      closeDatabaseProxySocket(proxy)
    }
  }

  return { ok: false, errorCode: 'DB_UNSUPPORTED_ENGINE', errorMessage: `Unsupported relational database engine: ${input.dbType}` }
}

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

export const relationalCatalogsForConnection = (connection: DatabaseConnectionInfo) =>
  isMysqlCompatibleDbType(connection.dbType)
    ? mysqlCatalogsForConnection(connection)
    : connection.dbType === 'oracle'
      ? oracleCatalogsForConnection(connection)
      : connection.dbType === 'sqlserver'
        ? sqlServerCatalogsForConnection(connection)
        : postgresCatalogsForConnection(connection)

export const relationalColumnsForTable = async (
  connection: DatabaseConnectionInfo,
  input: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName' | 'tableName'>
): Promise<DatabaseColumnInfo[]> => {
  if (isMysqlCompatibleDbType(connection.dbType)) {
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

export const relationalQueryTable = async (
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

    if (isMysqlCompatibleDbType(connection.dbType)) {
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

export const relationalExecute = async (connection: DatabaseConnectionInfo, rawSql: string, startedAt: number): Promise<DatabaseSqlExecuteRawResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    if (isMysqlCompatibleDbType(connection.dbType)) {
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

export const relationalTableDdl = async (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> => {
  const dbType = connection.dbType as RelationalDatabaseType
  try {
    if (isMysqlCompatibleDbType(connection.dbType)) {
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
          [`${relationalIdentifier(schemaName, dbType)}.${relationalIdentifier(tableName, dbType)}`]
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
          `  ${relationalIdentifier(trim(row.column_name), dbType)} ${postgresColumnTypeDdl(row)}`,
          trim(row.is_nullable).toUpperCase() === 'NO' ? 'NOT NULL' : '',
          trim(row.column_default) ? `DEFAULT ${trim(row.column_default)}` : ''
        ].filter(Boolean)
        return pieces.join(' ')
      })
      const pk = primaryKeys.map((row) => trim(row.column_name)).filter(Boolean)
      if (pk.length) {
        columnLines.push(`  PRIMARY KEY (${pk.map((column) => relationalIdentifier(column, dbType)).join(', ')})`)
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

export const relationalCreateDatabase = async (connection: DatabaseConnectionInfo, sql: string, name: string) => {
  if (isMysqlCompatibleDbType(connection.dbType)) {
    await withMysqlConnection(connection, async (client) => {
      await mysqlExec(client, sql || `CREATE DATABASE ${relationalIdentifier(name, connection.dbType as RelationalDatabaseType)}`)
    })
    return
  }
  if (isPostgresCompatibleDbType(connection.dbType)) {
    await withPostgresClient(connection, async (client) => {
      await postgresExec(client, sql || `CREATE DATABASE ${relationalIdentifier(name, connection.dbType as RelationalDatabaseType)}`)
    })
    return
  }
  if (connection.dbType === 'sqlserver') {
    await withSqlServerPool(connection, async (client) => {
      await sqlServerExec(client, sql || `CREATE DATABASE ${relationalIdentifier(name, 'sqlserver')}`)
    })
    return
  }
  throw Object.assign(new Error('Create Database is not supported for this relational engine.'), { code: 'DB_CREATE_DATABASE_UNSUPPORTED' })
}

export const relationalMutateTable = async (
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
    if (isMysqlCompatibleDbType(connection.dbType)) {
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
    await configuredRuntime().refreshConnectionCatalog(connection.id, relationalCatalogsForConnection)
    return {
      ok: true,
      data: {
        affected,
        durationMs: Math.max(1, Date.now() - startedAt),
        catalog: configuredRuntime().workspaceCatalogFor(input.connectionId)
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
