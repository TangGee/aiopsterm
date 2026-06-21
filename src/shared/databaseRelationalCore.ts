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
  DatabaseWorkspaceCatalog
} from './contracts/database'

export type RelationalDatabaseType = Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'oracle' | 'sqlserver'>
export type RelationalDatabaseConnection = DatabaseConnectionInfo & { dbType: RelationalDatabaseType }
export type DatabaseSqlExecuteRawData = Omit<NonNullable<DatabaseSqlExecuteResult['data']>, 'execution'>
export type DatabaseSqlExecuteRawResult = {
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
export type PostgresClient = {
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
export type OracleExecuteResult = {
  rows?: unknown[]
  metaData?: Array<{ name?: string } | string>
  rowsAffected?: number | null
}
export type OracleConnection = {
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
export type SqlServerRequest = {
  input: (name: string, value: unknown) => SqlServerRequest
  query: <T = Record<string, unknown>>(sql: string) => Promise<{
    recordset?: T[]
    recordsets?: T[][]
    rowsAffected?: number[]
    output?: Record<string, unknown>
  }>
}
export type SqlServerTransaction = {
  begin: () => Promise<unknown>
  commit: () => Promise<unknown>
  rollback: () => Promise<unknown>
  request: () => SqlServerRequest
}
export type SqlServerPool = {
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

export type DatabaseRelationalRuntime = {
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

export const RELATIONAL_TIMEOUT_MS = 10_000
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

export const configuredDatabaseRelationalRuntime = () => {
  if (!runtime) throw new Error('Database relational engine runtime has not been configured.')
  return runtime
}

export const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const normalizedDatabasePort = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

export const normalizeQueryRows = (rows: unknown): Array<Record<string, unknown>> =>
  Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }))
    : []

export const columnsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {})

export const rowValue = (row: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
    const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
    if (found) return row[found]
  }
  return undefined
}

export const databaseColumnId = (connectionId: string, tableName: string) => `tbl-${connectionId}-${tableName.replace(/[^A-Za-z0-9_-]+/g, '-')}`

export const sqlitePrimaryKeyForColumns = (columns: DatabaseColumnInfo[]) =>
  columns.filter((column) => column.key === 'PK').map((column) => column.name)

export const unquoteDatabaseIdentifier = (value: string) => {
  const token = trim(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  if (token.startsWith('[') && token.endsWith(']')) return token.slice(1, -1).replace(/]]/g, ']')
  return token
}

export const schemaHasObjects = (schema: DatabaseSchemaInfo) =>
  schema.tables.length || (schema.views?.length ?? 0) || (schema.functions?.length ?? 0) || (schema.procedures?.length ?? 0)

export const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

export const parseWhereRaw = (whereRaw: string | null | undefined): DatabaseColumnFilter[] => {
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

export const parseOrderByRaw = (orderByRaw: string | null | undefined, knownColumns: string[]): DatabaseColumnSort | null => {
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

export const relationalIdentifier = (value: string, dbType: RelationalDatabaseType) =>
  isMysqlCompatibleDbType(dbType)
    ? `\`${String(value || '').replace(/`/g, '``')}\``
    : dbType === 'sqlserver'
      ? `[${String(value || '').replace(/]/g, ']]')}]`
      : `"${String(value || '').replace(/"/g, '""')}"`

export const relationalPlaceholder = (dbType: RelationalDatabaseType, index: number) => {
  if (isPostgresCompatibleDbType(dbType)) return `$${index}`
  if (dbType === 'oracle') return `:${index}`
  if (dbType === 'sqlserver') return `@p${index}`
  return '?'
}

export const oracleLookupIdentifier = (value: string) => {
  const raw = trim(value)
  if (!raw) return ''
  const unquoted = unquoteDatabaseIdentifier(raw)
  return raw.startsWith('"') && raw.endsWith('"') ? unquoted : unquoted.toUpperCase()
}

export const oracleSchemaNameFor = (
  connection: Pick<DatabaseConnectionInfo, 'user'>,
  input: Pick<DatabaseTableDdlInput, 'schemaName'>
) => oracleLookupIdentifier(trim(input.schemaName) || trim(connection.user))

export const relationalTableReference = (
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

export const relationalRowCount = (result: unknown, fallback = 0) => {
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
  const createProxySocket = configuredDatabaseRelationalRuntime().createProxySocket
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
  const runtimeConfig = configuredDatabaseRelationalRuntime()
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
  const runtimeConfig = configuredDatabaseRelationalRuntime()
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
  const runtimeConfig = configuredDatabaseRelationalRuntime()
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
  const runtimeConfig = configuredDatabaseRelationalRuntime()
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
  const runtimeConfig = configuredDatabaseRelationalRuntime()
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

export const oracleConnectStringFromInput = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'database' | 'url'>) => {
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

const connectionTestInputFromSaved = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => configuredDatabaseRelationalRuntime().connectionInputFromSaved(connection)

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

export const withMysqlConnection = async <T>(connection: DatabaseConnectionInfo, fn: (client: MySqlConnection) => Promise<T>) => {
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

export const withPostgresClient = async <T>(connection: DatabaseConnectionInfo, fn: (client: PostgresClient) => Promise<T>) => {
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

export const withOracleConnection = async <T>(connection: DatabaseConnectionInfo, fn: (client: OracleConnection) => Promise<T>) => {
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

export const withSqlServerPool = async <T>(connection: DatabaseConnectionInfo, fn: (client: SqlServerPool) => Promise<T>) => {
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

export const mysqlRows = async <T extends Record<string, unknown>>(client: MySqlConnection, sql: string, params: unknown[] = []) => {
  const [rows] = await client.query<T[]>(sql, params)
  return normalizeQueryRows(rows) as T[]
}

export const mysqlExec = async (client: MySqlConnection, sql: string, params: unknown[] = []) => {
  const [result] = await client.query(sql, params)
  return relationalRowCount(result)
}

export const postgresRows = async <T extends Record<string, unknown>>(client: PostgresClient, sql: string, params: unknown[] = []) => {
  const result = await client.query<T>(sql, params)
  return normalizeQueryRows(result.rows)
}

export const postgresExec = async (client: PostgresClient, sql: string, params: unknown[] = []) => {
  const result = await client.query(sql, params)
  return relationalRowCount(result, Number(result.rowCount ?? 0))
}

export const sqlServerRequestWithParams = (request: SqlServerRequest, params: unknown[] = []) => {
  params.forEach((param, index) => {
    request.input(`p${index + 1}`, param)
  })
  return request
}

export const sqlServerRows = async <T extends Record<string, unknown>>(pool: SqlServerPool, sql: string, params: unknown[] = []) => {
  const result = await sqlServerRequestWithParams(pool.request(), params).query<T>(sql)
  return normalizeQueryRows(result.recordset) as T[]
}

export const sqlServerExec = async (pool: SqlServerPool, sql: string, params: unknown[] = []) => {
  const result = await sqlServerRequestWithParams(pool.request(), params).query(sql)
  return result.rowsAffected?.reduce((sum, value) => sum + Number(value || 0), 0) ?? 0
}

export const oracleExecuteOptions = () => {
  const driver = loadOracleRuntime()
  return driver?.OUT_FORMAT_OBJECT ? { outFormat: driver.OUT_FORMAT_OBJECT } : {}
}

export const oracleColumnsFromMetadata = (metaData: OracleExecuteResult['metaData'] | undefined) =>
  (metaData ?? [])
    .map((field) => (typeof field === 'string' ? field : trim(field.name)))
    .filter(Boolean)

export const oracleRowsFromResult = <T extends Record<string, unknown>>(result: OracleExecuteResult) => {
  const columns = oracleColumnsFromMetadata(result.metaData)
  const rows = Array.isArray(result.rows) ? result.rows : []
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return Object.fromEntries(row.map((value, index) => [columns[index] || `column_${index + 1}`, value])) as T
    }
    return row && typeof row === 'object' ? ({ ...(row as Record<string, unknown>) } as T) : ({ value: row } as unknown as T)
  })
}

export const oracleColumnType = (row: Record<string, unknown>) => {
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

export const sqlServerColumnType = (row: Record<string, unknown>) => {
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

export const oracleRows = async <T extends Record<string, unknown>>(client: OracleConnection, sql: string, params: unknown[] = []) => {
  const result = await client.execute(sql, params, oracleExecuteOptions())
  return oracleRowsFromResult<T>(result)
}

export const oracleExec = async (client: OracleConnection, sql: string, params: unknown[] = []) => {
  const result = await client.execute(sql, params, oracleExecuteOptions())
  return relationalRowCount(result, Number(result.rowsAffected ?? 0))
}

export const oracleCommit = async (client: OracleConnection) => {
  if (client.commit) return client.commit()
  return oracleExec(client, 'COMMIT')
}

export const oracleRollback = async (client: OracleConnection) => {
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
