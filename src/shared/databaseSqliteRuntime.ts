import { existsSync } from 'fs'
import type {
  DatabaseCatalogInfo,
  DatabaseColumnFilter,
  DatabaseColumnInfo,
  DatabaseColumnSort,
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult,
  DatabaseWorkspaceCatalog
} from './contracts/database'
import { buildDatabaseMutationStatement, databaseMutationPlanData, inputKnownColumns } from './databaseMutationPlanner'
import type { DatabaseSqlExecuteRawData, DatabaseSqlExecuteRawResult } from './databaseSqlExecution'
import {
  executeSqliteGuardedTableQueryInWorker,
  executeSqliteStatementInWorker,
  executeSqliteTransactionInWorker,
  loadSqliteCatalogsInWorker,
  type SqliteWorkerStatementInput
} from './databaseSqliteWorkerRuntime'
import {
  columnsForRows,
  parseOrderByRaw,
  parseWhereRaw,
  trim
} from './databaseTableRuntime'

type SqliteRunResult = { changes?: number }
type SqliteColumnDefinition = { name?: string }
type SqliteStatement = {
  reader: boolean
  all: (...params: unknown[]) => Array<Record<string, unknown>>
  run: (...params: unknown[]) => SqliteRunResult
  columns: () => SqliteColumnDefinition[]
}
export type SqliteDatabase = {
  prepare: (source: string) => SqliteStatement
  close: () => unknown
}
type SqliteDatabaseConstructor = new (
  filePath: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }
) => SqliteDatabase

type SqliteSchemaTableRow = { name?: string; type?: string }
type SqliteTableColumnRow = { cid?: number; name?: string; type?: string; notnull?: number; pk?: number; hidden?: number }

export type DatabaseSqliteRuntimeConfig = {
  refreshConnectionCatalog: (connectionId: string, catalogs: DatabaseCatalogInfo[]) => void
  workspaceCatalogFor: (selectedConnectionId?: string) => DatabaseWorkspaceCatalog | undefined
}

const SQLITE_MAIN_SCHEMA = 'main'
// better-sqlite3 的 busy timeout(等锁上限),不约束查询执行时长。
const SQLITE_BUSY_TIMEOUT_MS = 5000
const SQLITE_EXECUTE_MAX_ROWS = 5000
let sqliteRuntime: SqliteDatabaseConstructor | null | undefined
let runtimeConfig: DatabaseSqliteRuntimeConfig | null = null

export const configureDatabaseSqliteRuntime = (config: DatabaseSqliteRuntimeConfig) => {
  runtimeConfig = config
}

const configuredRuntime = () => {
  if (!runtimeConfig) throw new Error('Database SQLite runtime has not been configured.')
  return runtimeConfig
}

export const resetDatabaseSqliteRuntime = () => {
  sqliteRuntime = undefined
}

export const sqlitePathFromUrl = (url: string) => {
  const trimmed = trim(url)
  if (!trimmed.toLowerCase().startsWith('sqlite://')) return ''
  return trimmed.replace(/^sqlite:\/\//i, '')
}

export const sqliteFilePathFromConnection = (connection: Pick<DatabaseConnectionInfo, 'filePath' | 'url'>) =>
  trim(connection.filePath) || sqlitePathFromUrl(trim(connection.url))

export const sqliteFilePathFromTestInput = (input: Pick<DatabaseConnectionTestInput, 'filePath' | 'url'>) =>
  trim(input.filePath) || sqlitePathFromUrl(trim(input.url))

export const isSqliteFileExtension = (filePath: string) => /\.(db|sqlite|sqlite3)$/i.test(filePath)

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

export const openSqliteDatabase = (filePath: string, readonly: boolean) => {
  const Database = loadSqliteRuntime()
  if (!Database) {
    throw Object.assign(new Error('SQLite runtime is unavailable. Rebuild better-sqlite3 for the Electron runtime.'), {
      code: 'DB_SQLITE_DRIVER_UNAVAILABLE'
    })
  }
  return new Database(filePath, { readonly, fileMustExist: true, timeout: SQLITE_BUSY_TIMEOUT_MS })
}

export const sqliteErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : fallback
}

export const sqliteErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

export const isRealSqliteConnection = (connection: DatabaseConnectionInfo | null | undefined) => {
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

export const sqlitePrimaryKeyForColumns = (columns: DatabaseColumnInfo[]) =>
  columns.filter((column) => column.key === 'PK').map((column) => column.name)

export const sqliteCatalogsForConnection = (connection: DatabaseConnectionInfo): DatabaseCatalogInfo[] | null => {
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

export const sqliteCatalogsForConnectionAsync = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[] | null> => {
  if (!isRealSqliteConnection(connection)) return null
  try {
    return await loadSqliteCatalogsInWorker({
      filePath: sqliteFilePathFromConnection(connection),
      connectionId: connection.id,
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
    })
  } catch {
    return null
  }
}

// 用户 SQL 在 worker 线程执行，主线程不再被长查询阻塞；reader 结果超过上限时截断并标记 truncated。
export const sqliteExecute = async (connection: DatabaseConnectionInfo, sql: string, startedAt: number): Promise<DatabaseSqlExecuteRawResult> => {
  try {
    const outcome = await executeSqliteStatementInWorker({
      filePath: sqliteFilePathFromConnection(connection),
      readonly: !!connection.readonly,
      sql,
      maxRows: SQLITE_EXECUTE_MAX_ROWS,
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
    })
    if (outcome.reader) {
      const data: DatabaseSqlExecuteRawData & { truncated?: boolean } = {
        columns: outcome.columns.length ? outcome.columns : columnsForRows(outcome.rows),
        rows: outcome.rows,
        rowCount: outcome.rows.length,
        durationMs: Math.max(1, Date.now() - startedAt),
        ...(outcome.truncated ? { truncated: true } : {})
      }
      return { ok: true, data }
    }
    return {
      ok: true,
      data: {
        columns: [],
        rows: [],
        rowCount: outcome.changes,
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_QUERY_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite query failed.')
    }
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

const sqliteColumnsForTableInWorker = async (connection: DatabaseConnectionInfo, schemaName: string, tableName: string) => {
  const outcome = await executeSqliteStatementInWorker({
    filePath: sqliteFilePathFromConnection(connection),
    readonly: true,
    sql: `PRAGMA ${sqliteIdentifier(schemaName)}.table_xinfo(${sqliteIdentifier(tableName)})`,
    maxRows: 10_000,
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
  })
  if (!outcome.reader) return []
  return (outcome.rows as SqliteTableColumnRow[])
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

export const sqliteQueryTable = async (connection: DatabaseConnectionInfo, input: DatabaseTableQueryInput, startedAt: number): Promise<DatabaseTableQueryResult> => {
  try {
    const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
    const tableName = trim(input.tableName)
    const columns = await sqliteColumnsForTableInWorker(connection, schemaName, tableName)
    if (!columns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const requestedColumns = (input.columns ?? []).map((column) => knownColumns.find((known) => known.toLowerCase() === trim(column).toLowerCase())).filter(Boolean) as string[]
    if (input.columns?.length && requestedColumns.length !== input.columns.length) {
      return { ok: false, errorCode: 'DB_COLUMNS_INVALID', errorMessage: 'One or more selected columns are not available.' }
    }
    const selectedColumns = input.columns?.length ? requestedColumns : knownColumns
    if (!selectedColumns.length) return { ok: false, errorCode: 'DB_COLUMNS_REQUIRED', errorMessage: 'At least one selected column is required.' }
    const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
    const where = sqliteWhereForFilters(filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = sqliteOrderByFor(sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = sqliteTableReference(connection, input.databaseName, tableName)
    const selectList = selectedColumns.map(sqliteIdentifier).join(', ')
    const rowStatement = {
      sql: `SELECT ${selectList} FROM ${tableRef}${where.sql}${orderBy} LIMIT ? OFFSET ?`,
      params: [...where.params, pageSize, offset]
    }
    const totalStatement = input.withTotal
      ? {
          sql: `SELECT COUNT(*) AS total FROM ${tableRef}${where.sql}`,
          params: where.params
        }
      : undefined
    let rows: Array<Record<string, unknown>>
    let total: number | null
    if (input.requireStableBaseTable) {
      const guarded = await executeSqliteGuardedTableQueryInWorker({
        filePath: sqliteFilePathFromConnection(connection),
        schemaName,
        tableName,
        rowStatement,
        ...(totalStatement ? { totalStatement } : {}),
        maxRows: pageSize,
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
      })
      rows = guarded.rows
      total = guarded.total
    } else {
      const rowsOutcome = await executeSqliteStatementInWorker({
        filePath: sqliteFilePathFromConnection(connection),
        readonly: true,
        ...rowStatement,
        maxRows: pageSize,
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
      })
      rows = rowsOutcome.reader ? rowsOutcome.rows : []
      total = null
      if (totalStatement) {
        const totalOutcome = await executeSqliteStatementInWorker({
          filePath: sqliteFilePathFromConnection(connection),
          readonly: true,
          ...totalStatement,
          maxRows: 1,
          busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
        })
        total = totalOutcome.reader ? Number((totalOutcome.rows[0]?.total as number | undefined) ?? 0) : 0
      }
    }
    return {
      ok: true,
      data: {
        columns: selectedColumns,
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
  }
}

export const sqliteTableDdl = async (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> => {
  try {
    const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
    const outcome = await executeSqliteStatementInWorker({
      filePath: sqliteFilePathFromConnection(connection),
      readonly: true,
      sql: `SELECT sql FROM ${sqliteIdentifier(schemaName)}.sqlite_schema WHERE type IN ('table', 'view') AND name = ? ORDER BY type LIMIT 1`,
      params: [trim(input.tableName)],
      maxRows: 1,
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
    })
    const ddl = outcome.reader && typeof outcome.rows[0]?.sql === 'string' ? outcome.rows[0].sql : ''
    if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    return { ok: true, data: { ddl } }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_DDL_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite DDL lookup failed.')
    }
  }
}

export const sqliteKnownColumnsForTable = (db: SqliteDatabase, schemaName: string, tableName: string) =>
  sqliteColumnsForTable(db, schemaName, tableName).map((column) => column.name)

export const sqliteMutationPlan = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationPlanInput
): Promise<DatabaseTableMutationPlanResult['data']> => {
  const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
  const knownColumns = (await sqliteColumnsForTableInWorker(connection, schemaName, trim(input.tableName))).map((column) => column.name)
  if (!knownColumns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
    throw Object.assign(new Error(`Table not found: ${input.tableName}`), { code: 'DB_TABLE_NOT_FOUND' })
  }
  return databaseMutationPlanData(connection, input, knownColumns.length ? knownColumns : inputKnownColumns(input))
}

export const sqliteMutateTable = async (connection: DatabaseConnectionInfo, input: DatabaseTableMutationInput, startedAt: number): Promise<DatabaseTableMutationResult> => {
  if (connection.readonly) {
    return { ok: false, errorCode: 'DB_SQLITE_READONLY', errorMessage: 'SQLite connection is read-only.' }
  }

  try {
    const schemaName = sqliteSchemaNameFor(connection, input.databaseName)
    const tableName = trim(input.tableName)
    const knownColumns = (await sqliteColumnsForTableInWorker(connection, schemaName, tableName)).map((column) => column.name)
    if (!knownColumns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const tableRef = sqliteTableReference(connection, input.databaseName, tableName)
    const statements = input.mutations
      .map((mutation) => buildDatabaseMutationStatement('sqlite', tableRef, knownColumns, mutation))
      .filter((statement): statement is NonNullable<ReturnType<typeof buildDatabaseMutationStatement>> => Boolean(statement))
      .map((statement): SqliteWorkerStatementInput => ({ sql: statement.sql, params: statement.params }))
    const result = await executeSqliteTransactionInWorker({
      filePath: sqliteFilePathFromConnection(connection),
      statements,
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS
    })
    const catalogs = await sqliteCatalogsForConnectionAsync(connection)
    const runtime = configuredRuntime()
    if (catalogs) runtime.refreshConnectionCatalog(connection.id, catalogs)
    return {
      ok: true,
      data: {
        affected: result.changes,
        durationMs: Math.max(1, Date.now() - startedAt),
        catalog: runtime.workspaceCatalogFor(input.connectionId)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: sqliteErrorCode(error, 'DB_SQLITE_MUTATION_FAILED'),
      errorMessage: sqliteErrorMessage(error, 'SQLite table mutation failed.')
    }
  }
}
