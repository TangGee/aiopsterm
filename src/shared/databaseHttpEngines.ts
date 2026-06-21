import type {
  DatabaseCatalogInfo,
  DatabaseColumnFilter,
  DatabaseColumnInfo,
  DatabaseColumnSort,
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableInfo,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult,
  DatabaseWorkspaceCatalog
} from './contracts/database'
import {
  decodeDatabaseMutationPrimaryKeyRowKey,
  type DatabaseMutationStatement
} from './databaseMutationPlanner'

type DatabaseFetch = typeof fetch
type DatabaseSqlExecuteRawData = Omit<NonNullable<DatabaseSqlExecuteResult['data']>, 'execution'>
type DatabaseSqlExecuteRawResult = {
  ok: boolean
  data?: DatabaseSqlExecuteRawData
  errorCode?: string
  errorMessage?: string
}
type ClickHouseDatabaseConnection = DatabaseConnectionInfo & { dbType: 'clickhouse' }
type PrestoDatabaseConnection = DatabaseConnectionInfo & { dbType: 'presto' }
type DatabaseRowMutation = Extract<DatabaseTableMutationInput['mutations'][number], { kind: 'delete' | 'update' }>

type DatabaseHttpEngineRuntime = {
  fetch?: DatabaseFetch
  connectionInputFromSaved: (connection: DatabaseConnectionInfo) => DatabaseConnectionTestInput
  refreshConnectionCatalog: (connectionId: string, loadCatalogs: (connection: DatabaseConnectionInfo) => Promise<DatabaseCatalogInfo[]>) => Promise<void>
  workspaceCatalogFor: (selectedConnectionId?: string) => DatabaseWorkspaceCatalog | undefined
}

type ClickHouseJsonResponse = {
  meta?: Array<{ name?: string; type?: string }>
  data?: Array<Record<string, unknown>>
  rows?: number
  statistics?: Record<string, unknown>
}

type PrestoColumn = {
  name?: string
  type?: string
  typeSignature?: { rawType?: string }
}

type PrestoStatementResponse = {
  id?: string
  infoUri?: string
  nextUri?: string
  columns?: PrestoColumn[]
  data?: unknown[][]
  stats?: Record<string, unknown>
  error?: {
    message?: string
    errorCode?: number
    errorName?: string
    errorType?: string
  }
}

let runtime: DatabaseHttpEngineRuntime | null = null

export function configureDatabaseHttpEngines(config: DatabaseHttpEngineRuntime) {
  runtime = config
}

const configuredRuntime = () => {
  if (!runtime) throw new Error('Database HTTP engine runtime has not been configured.')
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
  }
  const lower = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(lower, name.toLowerCase())) return lower[name.toLowerCase()]
  }
  return undefined
}

const databaseColumnId = (connectionId: string, tableName: string) => `tbl-${connectionId}-${tableName.replace(/[^A-Za-z0-9_-]+/g, '-')}`

const primaryKeyForColumns = (columns: DatabaseColumnInfo[]) => columns.filter((column) => column.key === 'PK').map((column) => column.name)

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

const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
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

export const isClickHouseConnection = (connection: DatabaseConnectionInfo | null | undefined): connection is ClickHouseDatabaseConnection =>
  connection?.dbType === 'clickhouse'

export const isPrestoConnection = (connection: DatabaseConnectionInfo | null | undefined): connection is PrestoDatabaseConnection =>
  connection?.dbType === 'presto'

const loadDatabaseFetch = () => {
  const runtimeConfig = configuredRuntime()
  if (runtimeConfig.fetch) return runtimeConfig.fetch
  const runtimeFetch = globalThis.fetch
  return typeof runtimeFetch === 'function' ? (runtimeFetch.bind(globalThis) as DatabaseFetch) : null
}

const loadClickHouseFetch = loadDatabaseFetch

export const clickHouseBaseUrlFrom = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'url'>) => {
  const rawUrl = trim(input.url)
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl.replace(/\/+$/, '')
  const host = trim(input.host)
  const port = normalizedDatabasePort(input.port) ?? 8123
  return `http://${host}:${port}`
}

const clickHouseAuthorizationHeader = (input: Pick<DatabaseConnectionTestInput, 'user' | 'password'>) => {
  const user = trim(input.user)
  const password = input.password ?? ''
  if (!user && !password) return ''
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

const clickHouseConnectionInput = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => configuredRuntime().connectionInputFromSaved(connection)

export const clickHouseEndpointFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'url'>) => clickHouseBaseUrlFrom(input)

const clickHouseEnsureJsonFormat = (sql: string) => (/\bformat\s+json\b/i.test(sql) ? sql : `${sql.replace(/;+$/, '')} FORMAT JSON`)
const clickHouseReturnsRows = (sql: string) => /^\s*(select|with|show|describe|desc|explain)\b/i.test(sql)

const clickHouseLiteral = (value: string) => `'${String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export const clickHouseIdentifier = (value: string) => `\`${String(value || '').replace(/`/g, '``')}\``

const clickHouseTableReference = (input: Pick<DatabaseTableQueryInput, 'databaseName' | 'tableName'>) =>
  `${clickHouseIdentifier(trim(input.databaseName))}.${clickHouseIdentifier(trim(input.tableName))}`

const clickHouseMutationLiteral = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : clickHouseLiteral(String(value))
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return clickHouseLiteral(value.toISOString().replace('T', ' ').replace(/Z$/, ''))
  return clickHouseLiteral(String(value))
}

const clickHouseMutationComparison = (column: string, value: unknown) => {
  const quoted = clickHouseIdentifier(column)
  return value === null || value === undefined ? `${quoted} IS NULL` : `${quoted} = ${clickHouseMutationLiteral(value)}`
}

const clickHouseMutationWhereForRow = (
  knownColumns: string[],
  mutation: DatabaseRowMutation
) => {
  const primaryKey = mutation.primaryKey.map(trim).filter(Boolean)
  const values = decodeDatabaseMutationPrimaryKeyRowKey(mutation.rowKey, primaryKey)
  if (primaryKey.length && values) {
    return {
      sql: primaryKey.map((column, index) => clickHouseMutationComparison(column, values[index])).join(' AND '),
      usesPrimaryKey: true
    }
  }

  if (!mutation.originalRow) {
    throw Object.assign(new Error('Original row snapshot is required for ClickHouse table mutations without a primary key.'), {
      code: 'DB_ROW_SNAPSHOT_REQUIRED'
    })
  }

  const originalRow = mutation.originalRow
  const clauses = knownColumns.flatMap((column) =>
    Object.prototype.hasOwnProperty.call(originalRow, column)
      ? [clickHouseMutationComparison(column, originalRow[column])]
      : []
  )
  if (!clauses.length) {
    throw Object.assign(new Error('Original row snapshot does not contain known ClickHouse table columns.'), { code: 'DB_ROW_SNAPSHOT_REQUIRED' })
  }
  return { sql: clauses.join(' AND '), usesPrimaryKey: false }
}

const buildClickHouseMutationStatement = (
  tableRef: string,
  knownColumns: string[],
  mutation: DatabaseTableMutationInput['mutations'][number]
): DatabaseMutationStatement | null => {
  const knownColumnSet = new Set(knownColumns.map((column) => column.toLowerCase()))
  if (mutation.kind === 'drop') return { kind: mutation.kind, sql: `DROP TABLE ${tableRef}`, params: [] }
  if (mutation.kind === 'truncate') return { kind: mutation.kind, sql: `TRUNCATE TABLE ${tableRef}`, params: [] }
  if (mutation.kind === 'insert') {
    const columns = Object.keys(mutation.values).filter((column) => knownColumnSet.has(column.toLowerCase()) && mutation.values[column] !== null && mutation.values[column] !== undefined)
    if (!columns.length) return null
    return {
      kind: mutation.kind,
      sql: `INSERT INTO ${tableRef} (${columns.map(clickHouseIdentifier).join(', ')}) VALUES (${columns.map((column) => clickHouseMutationLiteral(mutation.values[column])).join(', ')})`,
      params: []
    }
  }
  if (mutation.kind === 'delete') {
    const where = clickHouseMutationWhereForRow(knownColumns, mutation)
    return { kind: mutation.kind, sql: `ALTER TABLE ${tableRef} DELETE WHERE ${where.sql}`, params: [] }
  }

  const columns = Object.keys(mutation.patch).filter((column) => knownColumnSet.has(column.toLowerCase()))
  if (!columns.length) return null
  const assignments = columns.map((column) => `${clickHouseIdentifier(column)} = ${clickHouseMutationLiteral(mutation.patch[column])}`).join(', ')
  const where = clickHouseMutationWhereForRow(knownColumns, mutation)
  return { kind: mutation.kind, sql: `ALTER TABLE ${tableRef} UPDATE ${assignments} WHERE ${where.sql}`, params: [] }
}

const addClickHouseMutationPreview = (statement: DatabaseMutationStatement) => ({
  ...statement,
  preview: `${statement.sql};`
})

const clickHouseMutationWarning = (input: Pick<DatabaseTableMutationInput, 'mutations'>) => {
  const hasNoPrimaryKeyRowMutation = input.mutations.some((mutation) => {
    if (mutation.kind !== 'delete' && mutation.kind !== 'update') return false
    return mutation.primaryKey.map(trim).filter(Boolean).length === 0
  })
  return hasNoPrimaryKeyRowMutation
    ? 'No primary key detected. ClickHouse UPDATE and DELETE previews use the original row snapshot as the mutation guard.'
    : ''
}

export const clickHouseMutationPlanData = (
  input: DatabaseTableMutationPlanInput,
  knownColumns: string[]
): DatabaseTableMutationPlanResult['data'] => {
  const tableRef = clickHouseTableReference(input)
  const statements = input.mutations
    .map((mutation) => buildClickHouseMutationStatement(tableRef, knownColumns, mutation))
    .filter((statement): statement is DatabaseMutationStatement => !!statement)
    .map(addClickHouseMutationPreview)
  return {
    statements,
    statementCount: statements.length,
    preview: statements.map((statement) => statement.preview).join('\n'),
    warning: clickHouseMutationWarning(input)
  }
}

export const clickHouseErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : fallback
}

export const clickHouseErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

export const clickHouseQueryText = async (input: DatabaseConnectionTestInput, sql: string, databaseName?: string) => {
  const fetchImpl = loadClickHouseFetch()
  if (!fetchImpl) {
    throw Object.assign(new Error('ClickHouse HTTP runtime is unavailable. Use a Node/Electron runtime with fetch support.'), {
      code: 'DB_CLICKHOUSE_FETCH_UNAVAILABLE'
    })
  }
  const url = new URL(clickHouseBaseUrlFrom(input))
  const database = trim(databaseName) || trim(input.database)
  if (database) url.searchParams.set('database', database)
  const authorization = clickHouseAuthorizationHeader(input)
  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...(authorization ? { Authorization: authorization } : {})
    },
    body: sql
  })
  const text = await response.text()
  if (!response.ok) {
    throw Object.assign(new Error(text.trim() || response.statusText || `ClickHouse HTTP ${response.status}`), {
      code: 'DB_CLICKHOUSE_HTTP_FAILED'
    })
  }
  return text
}

export const clickHouseQueryJson = async <T extends Record<string, unknown>>(
  input: DatabaseConnectionTestInput,
  sql: string,
  databaseName?: string
): Promise<{ columns: string[]; rows: T[]; raw: ClickHouseJsonResponse }> => {
  const text = await clickHouseQueryText(input, clickHouseEnsureJsonFormat(sql), databaseName)
  let parsed: ClickHouseJsonResponse
  try {
    parsed = JSON.parse(text) as ClickHouseJsonResponse
  } catch {
    throw Object.assign(new Error('ClickHouse returned a non-JSON response.'), { code: 'DB_CLICKHOUSE_JSON_INVALID' })
  }
  const rows = normalizeQueryRows(parsed.data) as T[]
  const columns = Array.isArray(parsed.meta) ? parsed.meta.map((field) => trim(field.name)).filter(Boolean) : columnsForRows(rows)
  return { columns, rows, raw: parsed }
}

const clickHouseRows = async <T extends Record<string, unknown>>(connection: DatabaseConnectionInfo, sql: string, databaseName?: string) =>
  clickHouseQueryJson<T>(clickHouseConnectionInput(connection), sql, databaseName).then((result) => result.rows)

export const clickHouseColumnsForTable = async (
  connection: DatabaseConnectionInfo,
  input: Pick<DatabaseTableQueryInput, 'databaseName' | 'tableName'>
): Promise<DatabaseColumnInfo[]> => {
  const rows = await clickHouseRows<Record<string, unknown>>(
    connection,
    [
      'SELECT name, type, is_in_primary_key',
      'FROM system.columns',
      `WHERE database = ${clickHouseLiteral(trim(input.databaseName))} AND table = ${clickHouseLiteral(trim(input.tableName))}`,
      'ORDER BY position'
    ].join(' '),
    trim(input.databaseName)
  )
  return rows
    .flatMap((row) => {
      const name = trim(rowValue(row, 'name', 'NAME'))
      if (!name) return []
      const inPrimaryKey = Number(rowValue(row, 'is_in_primary_key', 'IS_IN_PRIMARY_KEY') ?? 0) > 0
      const type = trim(rowValue(row, 'type', 'TYPE')) || 'unknown'
      const column: DatabaseColumnInfo = {
        name,
        type,
        nullable: /^Nullable\(/i.test(type),
        ...(inPrimaryKey ? { key: 'PK' as const } : {})
      }
      return [column]
    })
}

export const clickHouseCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> => {
  const databaseRows = await clickHouseRows<Record<string, unknown>>(
    connection,
    "SELECT name FROM system.databases WHERE name NOT IN ('INFORMATION_SCHEMA', 'information_schema', 'system') ORDER BY name"
  )
  const selected = trim(connection.database)
  const catalogNames = Array.from(new Set([selected, ...databaseRows.map((row) => trim(rowValue(row, 'name', 'NAME')))].filter(Boolean)))
  const catalogs: DatabaseCatalogInfo[] = []
  for (const catalogName of catalogNames) {
    const tableRows = await clickHouseRows<Record<string, unknown>>(
      connection,
      [
        'SELECT name, engine',
        'FROM system.tables',
        `WHERE database = ${clickHouseLiteral(catalogName)}`,
        'ORDER BY name'
      ].join(' '),
      catalogName
    )
    const tables: DatabaseTableInfo[] = []
    const views: DatabaseTableInfo[] = []
    for (const row of tableRows) {
      const name = trim(rowValue(row, 'name', 'NAME'))
      if (!name) continue
      const engine = trim(rowValue(row, 'engine', 'ENGINE')).toLowerCase()
      const columns = await clickHouseColumnsForTable(connection, { databaseName: catalogName, tableName: name })
      const table = {
        id: databaseColumnId(connection.id, `${catalogName}-${name}`),
        name,
        columns,
        primaryKey: primaryKeyForColumns(columns)
      }
      if (engine.includes('view')) views.push(table)
      else tables.push(table)
    }
    catalogs.push({
      name: catalogName,
      tables,
      ...(views.length ? { schemas: [{ name: 'default', tables: [], views, functions: [], procedures: [] }] } : {})
    })
  }
  return catalogs
}

const clickHouseWhereForFilters = (filters: DatabaseColumnFilter[], knownColumns: string[]) => {
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const clauses: string[] = []
  filters.forEach((filter) => {
    const column = known.get(trim(filter.column).toLowerCase())
    if (!column) return
    const quoted = clickHouseIdentifier(column)
    if (filter.operator === 'isnull') {
      clauses.push(`${quoted} IS NULL`)
      return
    }
    if (filter.operator === 'notnull') {
      clauses.push(`${quoted} IS NOT NULL`)
      return
    }
    if (filter.operator === 'like') {
      clauses.push(`${quoted} LIKE ${clickHouseLiteral(`%${String(filter.value ?? '')}%`)}`)
      return
    }
    if (filter.operator === 'eq') {
      clauses.push(`${quoted} = ${clickHouseLiteral(String(filter.value ?? ''))}`)
      return
    }
    if (filter.operator === 'neq') {
      clauses.push(`${quoted} != ${clickHouseLiteral(String(filter.value ?? ''))}`)
      return
    }
    const values = (filter.values ?? []).map(String)
    if (!values.length) {
      clauses.push('0 = 1')
      return
    }
    clauses.push(`${quoted} IN (${values.map(clickHouseLiteral).join(', ')})`)
  })
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
}

const clickHouseOrderByFor = (sort: DatabaseColumnSort | null | undefined, knownColumns: string[]) => {
  if (!sort) return ''
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const column = known.get(trim(sort.column).toLowerCase())
  if (!column) return ''
  return ` ORDER BY ${clickHouseIdentifier(column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
}

export const clickHouseExecute = async (connection: DatabaseConnectionInfo, rawSql: string, startedAt: number): Promise<DatabaseSqlExecuteRawResult> => {
  try {
    if (!clickHouseReturnsRows(rawSql)) {
      await clickHouseQueryText(clickHouseConnectionInput(connection), rawSql, trim(connection.database))
      return {
        ok: true,
        data: {
          columns: [],
          rows: [],
          rowCount: 0,
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    }
    const query = await clickHouseQueryJson<Record<string, unknown>>(clickHouseConnectionInput(connection), rawSql, trim(connection.database))
    return {
      ok: true,
      data: {
        columns: query.columns.length ? query.columns : columnsForRows(query.rows),
        rows: query.rows,
        rowCount: query.rows.length,
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_QUERY_FAILED'),
      errorMessage: clickHouseErrorMessage(error, 'ClickHouse query failed.')
    }
  }
}

export const clickHouseQueryTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableQueryInput,
  startedAt: number
): Promise<DatabaseTableQueryResult> => {
  try {
    const columns = await clickHouseColumnsForTable(connection, input)
    if (!columns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
    const where = clickHouseWhereForFilters(filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = clickHouseOrderByFor(sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = clickHouseTableReference(input)
    const rowsQuery = await clickHouseQueryJson<Record<string, unknown>>(
      clickHouseConnectionInput(connection),
      `SELECT * FROM ${tableRef}${where}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
      trim(input.databaseName)
    )
    const countRows = input.withTotal
      ? await clickHouseRows<Record<string, unknown>>(connection, `SELECT count() AS total FROM ${tableRef}${where}`, trim(input.databaseName))
      : []
    return {
      ok: true,
      data: {
        columns: rowsQuery.columns.length ? rowsQuery.columns : knownColumns,
        rows: rowsQuery.rows,
        rowCount: rowsQuery.rows.length,
        durationMs: Math.max(1, Date.now() - startedAt),
        total: input.withTotal ? Number(rowValue(countRows[0] ?? {}, 'total', 'TOTAL') ?? 0) : null,
        knownColumns
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_QUERY_FAILED'),
      errorMessage: clickHouseErrorMessage(error, 'ClickHouse table query failed.')
    }
  }
}

export const clickHouseTableDdl = async (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> => {
  try {
    const rows = await clickHouseRows<Record<string, unknown>>(
      connection,
      `SHOW CREATE TABLE ${clickHouseTableReference(input)}`,
      trim(input.databaseName)
    )
    const values = Object.values(rows[0] ?? {})
    const ddl = values.find((value) => typeof value === 'string' && trim(value).toLowerCase().startsWith('create'))
    if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    return { ok: true, data: { ddl: String(ddl) } }
  } catch (error) {
    return {
      ok: false,
      errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_DDL_FAILED'),
      errorMessage: clickHouseErrorMessage(error, 'ClickHouse DDL lookup failed.')
    }
  }
}

export const clickHouseMutateTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableMutationInput,
  startedAt: number
): Promise<DatabaseTableMutationResult> => {
  if (connection.readonly) {
    return { ok: false, errorCode: 'DB_CLICKHOUSE_READONLY', errorMessage: 'ClickHouse connection is read-only.' }
  }

  try {
    const columns = await clickHouseColumnsForTable(connection, input)
    if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const tableRef = clickHouseTableReference(input)
    const statements = input.mutations
      .map((mutation) => buildClickHouseMutationStatement(tableRef, knownColumns, mutation))
      .filter((statement): statement is DatabaseMutationStatement => !!statement)

    for (const statement of statements) {
      await clickHouseQueryText(clickHouseConnectionInput(connection), statement.sql, trim(input.databaseName))
    }

    await configuredRuntime().refreshConnectionCatalog(connection.id, clickHouseCatalogsForConnection)

    return {
      ok: true,
      data: {
        affected: statements.length,
        durationMs: Math.max(1, Date.now() - startedAt),
        catalog: configuredRuntime().workspaceCatalogFor(input.connectionId)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_MUTATION_FAILED'),
      errorMessage: clickHouseErrorMessage(error, 'ClickHouse table mutation failed.')
    }
  }
}

const loadPrestoFetch = loadDatabaseFetch

export const prestoBaseUrlFrom = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'url'>) => {
  const rawUrl = trim(input.url)
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl.replace(/\/+$/, '')
  const host = trim(input.host)
  const port = normalizedDatabasePort(input.port) ?? 8080
  return `http://${host}:${port}`
}

export const prestoEndpointFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'url'>) => prestoBaseUrlFrom(input)

const prestoConnectionInput = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => configuredRuntime().connectionInputFromSaved(connection)

const prestoAuthorizationHeader = (input: Pick<DatabaseConnectionTestInput, 'user' | 'password'>) => {
  const user = trim(input.user)
  const password = input.password ?? ''
  if (!password) return ''
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

const prestoHeadersFor = (
  input: Pick<DatabaseConnectionTestInput, 'user' | 'password'>,
  context: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName'> = { databaseName: '', schemaName: '' }
) => {
  const authorization = prestoAuthorizationHeader(input)
  const catalog = trim(context.databaseName)
  const schema = trim(context.schemaName)
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Presto-User': trim(input.user) || 'presto',
    ...(catalog ? { 'X-Presto-Catalog': catalog } : {}),
    ...(schema ? { 'X-Presto-Schema': schema } : {}),
    ...(authorization ? { Authorization: authorization } : {})
  }
}

export const prestoErrorCode = (error: unknown, fallback: string) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return code.startsWith('DB_') ? code : fallback
}

export const prestoErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : String(error || fallback))

const parsePrestoResponse = async (response: Response): Promise<PrestoStatementResponse> => {
  const text = await response.text()
  if (!response.ok) {
    throw Object.assign(new Error(text.trim() || response.statusText || `Presto HTTP ${response.status}`), {
      code: 'DB_PRESTO_HTTP_FAILED'
    })
  }
  try {
    const parsed = JSON.parse(text) as PrestoStatementResponse
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid payload')
    return parsed
  } catch {
    throw Object.assign(new Error('Presto returned a non-JSON response.'), { code: 'DB_PRESTO_JSON_INVALID' })
  }
}

const ensurePrestoResponseOk = (payload: PrestoStatementResponse) => {
  if (!payload.error) return
  const message = trim(payload.error.message) || trim(payload.error.errorName) || 'Presto query failed.'
  throw Object.assign(new Error(message), { code: 'DB_PRESTO_QUERY_FAILED' })
}

const prestoRowsFromData = <T extends Record<string, unknown>>(columns: PrestoColumn[], data: unknown[][] | undefined): T[] => {
  if (!Array.isArray(data)) return []
  const names = columns.map((column, index) => trim(column.name) || `column_${index + 1}`)
  return data.map((row) => {
    if (!Array.isArray(row)) return { value: row } as unknown as T
    return Object.fromEntries(row.map((value, index) => [names[index] || `column_${index + 1}`, value])) as T
  })
}

export const prestoQuery = async <T extends Record<string, unknown>>(
  input: DatabaseConnectionTestInput,
  sql: string,
  context: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName'> = { databaseName: '', schemaName: '' }
): Promise<{ columns: string[]; rows: T[]; raw: PrestoStatementResponse[] }> => {
  const fetchImpl = loadPrestoFetch()
  if (!fetchImpl) {
    throw Object.assign(new Error('Presto HTTP runtime is unavailable. Use a Node/Electron runtime with fetch support.'), {
      code: 'DB_PRESTO_FETCH_UNAVAILABLE'
    })
  }
  const headers = prestoHeadersFor(input, context)
  const firstResponse = await fetchImpl(`${prestoBaseUrlFrom(input)}/v1/statement`, {
    method: 'POST',
    headers,
    body: sql
  })
  const raw: PrestoStatementResponse[] = []
  let payload = await parsePrestoResponse(firstResponse)
  let columns = Array.isArray(payload.columns) ? payload.columns : []
  let rows = prestoRowsFromData<T>(columns, payload.data)
  raw.push(payload)
  ensurePrestoResponseOk(payload)

  let nextUri = trim(payload.nextUri)
  while (nextUri) {
    const nextResponse = await fetchImpl(nextUri, {
      method: 'GET',
      headers
    })
    payload = await parsePrestoResponse(nextResponse)
    raw.push(payload)
    ensurePrestoResponseOk(payload)
    if (!columns.length && Array.isArray(payload.columns)) columns = payload.columns
    rows = rows.concat(prestoRowsFromData<T>(columns, payload.data))
    nextUri = trim(payload.nextUri)
  }

  return {
    columns: columns.map((column) => trim(column.name)).filter(Boolean),
    rows,
    raw
  }
}

const prestoRows = async <T extends Record<string, unknown>>(
  connection: DatabaseConnectionInfo,
  sql: string,
  context: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName'> = { databaseName: '', schemaName: '' }
) => prestoQuery<T>(prestoConnectionInput(connection), sql, context).then((result) => result.rows)

const prestoLiteral = (value: string) => `'${String(value || '').replace(/'/g, "''")}'`

const prestoIdentifier = (value: string) => `"${String(value || '').replace(/"/g, '""')}"`

const prestoTableReference = (input: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName' | 'tableName'>) => {
  const parts = [trim(input.databaseName), trim(input.schemaName), trim(input.tableName)].filter(Boolean)
  return parts.map(prestoIdentifier).join('.')
}

const prestoColumnsForTable = async (
  connection: DatabaseConnectionInfo,
  input: Pick<DatabaseTableQueryInput, 'databaseName' | 'schemaName' | 'tableName'>
): Promise<DatabaseColumnInfo[]> => {
  const catalogName = trim(input.databaseName)
  const schemaName = trim(input.schemaName)
  if (!catalogName || !schemaName) return []
  const rows = await prestoRows<Record<string, unknown>>(
    connection,
    [
      'SELECT table_schema, table_name, column_name, data_type, is_nullable',
      `FROM ${prestoIdentifier(catalogName)}.information_schema.columns`,
      `WHERE table_schema = ${prestoLiteral(schemaName)} AND table_name = ${prestoLiteral(trim(input.tableName))}`,
      'ORDER BY ordinal_position'
    ].join(' '),
    { databaseName: catalogName, schemaName }
  )
  return rows
    .map((row) => {
      const name = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
      if (!name) return null
      return {
        name,
        type: trim(rowValue(row, 'data_type', 'DATA_TYPE')) || 'unknown',
        nullable: trim(rowValue(row, 'is_nullable', 'IS_NULLABLE')).toUpperCase() !== 'NO'
      }
    })
    .filter((column): column is DatabaseColumnInfo => !!column)
}

export const prestoCatalogsForConnection = async (connection: DatabaseConnectionInfo): Promise<DatabaseCatalogInfo[]> => {
  const catalogRows = await prestoRows<Record<string, unknown>>(
    connection,
    'SELECT catalog_name FROM information_schema.catalogs ORDER BY catalog_name',
    { databaseName: trim(connection.database), schemaName: '' }
  )
  const selected = trim(connection.database)
  const catalogNames = Array.from(new Set([selected, ...catalogRows.map((row) => trim(rowValue(row, 'catalog_name', 'CATALOG_NAME')))].filter(Boolean)))
  const catalogs: DatabaseCatalogInfo[] = []
  for (const catalogName of catalogNames) {
    const schemaRows = await prestoRows<Record<string, unknown>>(
      connection,
      [
        'SELECT schema_name',
        `FROM ${prestoIdentifier(catalogName)}.information_schema.schemata`,
        "WHERE schema_name NOT IN ('information_schema')",
        'ORDER BY schema_name'
      ].join(' '),
      { databaseName: catalogName, schemaName: '' }
    )
    const tableRows = await prestoRows<Record<string, unknown>>(
      connection,
      [
        'SELECT table_schema, table_name, table_type',
        `FROM ${prestoIdentifier(catalogName)}.information_schema.tables`,
        "WHERE table_schema NOT IN ('information_schema')",
        'ORDER BY table_schema, table_name'
      ].join(' '),
      { databaseName: catalogName, schemaName: '' }
    )
    const columnRows = await prestoRows<Record<string, unknown>>(
      connection,
      [
        'SELECT table_schema, table_name, column_name, data_type, is_nullable',
        `FROM ${prestoIdentifier(catalogName)}.information_schema.columns`,
        "WHERE table_schema NOT IN ('information_schema')",
        'ORDER BY table_schema, table_name, ordinal_position'
      ].join(' '),
      { databaseName: catalogName, schemaName: '' }
    )
    const columnsByTable = new Map<string, DatabaseColumnInfo[]>()
    columnRows.forEach((row) => {
      const schemaName = trim(rowValue(row, 'table_schema', 'TABLE_SCHEMA'))
      const tableName = trim(rowValue(row, 'table_name', 'TABLE_NAME'))
      const columnName = trim(rowValue(row, 'column_name', 'COLUMN_NAME'))
      if (!schemaName || !tableName || !columnName) return
      const key = `${schemaName}.${tableName}`
      const column: DatabaseColumnInfo = {
        name: columnName,
        type: trim(rowValue(row, 'data_type', 'DATA_TYPE')) || 'unknown',
        nullable: trim(rowValue(row, 'is_nullable', 'IS_NULLABLE')).toUpperCase() !== 'NO'
      }
      columnsByTable.set(key, [...(columnsByTable.get(key) ?? []), column])
    })
    const tablesBySchema = new Map<string, { tables: DatabaseTableInfo[]; views: DatabaseTableInfo[] }>()
    tableRows.forEach((row) => {
      const schemaName = trim(rowValue(row, 'table_schema', 'TABLE_SCHEMA'))
      const tableName = trim(rowValue(row, 'table_name', 'TABLE_NAME'))
      if (!schemaName || !tableName) return
      const tableType = trim(rowValue(row, 'table_type', 'TABLE_TYPE')).toUpperCase()
      const columns = columnsByTable.get(`${schemaName}.${tableName}`) ?? []
      const table: DatabaseTableInfo = {
        id: databaseColumnId(connection.id, `${catalogName}-${schemaName}-${tableName}`),
        name: tableName,
        columns,
        primaryKey: []
      }
      const bucket = tablesBySchema.get(schemaName) ?? { tables: [], views: [] }
      if (tableType.includes('VIEW')) bucket.views.push(table)
      else bucket.tables.push(table)
      tablesBySchema.set(schemaName, bucket)
    })
    const schemaNames = Array.from(new Set([...schemaRows.map((row) => trim(rowValue(row, 'schema_name', 'SCHEMA_NAME'))), ...tablesBySchema.keys()].filter(Boolean)))
    catalogs.push({
      name: catalogName,
      schemas: schemaNames.map((schemaName) => {
        const bucket = tablesBySchema.get(schemaName) ?? { tables: [], views: [] }
        return {
          name: schemaName,
          tables: bucket.tables,
          views: bucket.views,
          functions: [],
          procedures: []
        }
      })
    })
  }
  return catalogs
}

const prestoWhereForFilters = (filters: DatabaseColumnFilter[], knownColumns: string[]) => {
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const clauses: string[] = []
  filters.forEach((filter) => {
    const column = known.get(trim(filter.column).toLowerCase())
    if (!column) return
    const quoted = prestoIdentifier(column)
    if (filter.operator === 'isnull') {
      clauses.push(`${quoted} IS NULL`)
      return
    }
    if (filter.operator === 'notnull') {
      clauses.push(`${quoted} IS NOT NULL`)
      return
    }
    if (filter.operator === 'like') {
      clauses.push(`${quoted} LIKE ${prestoLiteral(`%${String(filter.value ?? '')}%`)}`)
      return
    }
    if (filter.operator === 'eq') {
      clauses.push(`${quoted} = ${prestoLiteral(String(filter.value ?? ''))}`)
      return
    }
    if (filter.operator === 'neq') {
      clauses.push(`${quoted} <> ${prestoLiteral(String(filter.value ?? ''))}`)
      return
    }
    const values = (filter.values ?? []).map(String)
    if (!values.length) {
      clauses.push('0 = 1')
      return
    }
    clauses.push(`${quoted} IN (${values.map(prestoLiteral).join(', ')})`)
  })
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
}

const prestoOrderByFor = (sort: DatabaseColumnSort | null | undefined, knownColumns: string[]) => {
  if (!sort) return ''
  const known = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const column = known.get(trim(sort.column).toLowerCase())
  if (!column) return ''
  return ` ORDER BY ${prestoIdentifier(column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
}

export const prestoExecute = async (connection: DatabaseConnectionInfo, rawSql: string, startedAt: number): Promise<DatabaseSqlExecuteRawResult> => {
  try {
    const query = await prestoQuery<Record<string, unknown>>(prestoConnectionInput(connection), rawSql, {
      databaseName: trim(connection.database),
      schemaName: ''
    })
    return {
      ok: true,
      data: {
        columns: query.columns.length ? query.columns : columnsForRows(query.rows),
        rows: query.rows,
        rowCount: query.rows.length,
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: prestoErrorCode(error, 'DB_PRESTO_QUERY_FAILED'),
      errorMessage: prestoErrorMessage(error, 'Presto query failed.')
    }
  }
}

export const prestoQueryTable = async (
  connection: DatabaseConnectionInfo,
  input: DatabaseTableQueryInput,
  startedAt: number
): Promise<DatabaseTableQueryResult> => {
  try {
    const columns = await prestoColumnsForTable(connection, input)
    if (!columns.length) {
      return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    }
    const knownColumns = columns.map((column) => column.name)
    const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
    const where = prestoWhereForFilters(filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = prestoOrderByFor(sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = prestoTableReference(input)
    const context = { databaseName: trim(input.databaseName), schemaName: trim(input.schemaName) }
    const rowsQuery = await prestoQuery<Record<string, unknown>>(
      prestoConnectionInput(connection),
      `SELECT * FROM ${tableRef}${where}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
      context
    )
    const countRows = input.withTotal
      ? await prestoRows<Record<string, unknown>>(connection, `SELECT count(*) AS total FROM ${tableRef}${where}`, context)
      : []
    return {
      ok: true,
      data: {
        columns: rowsQuery.columns.length ? rowsQuery.columns : knownColumns,
        rows: rowsQuery.rows,
        rowCount: rowsQuery.rows.length,
        durationMs: Math.max(1, Date.now() - startedAt),
        total: input.withTotal ? Number(rowValue(countRows[0] ?? {}, 'total', 'TOTAL') ?? 0) : null,
        knownColumns
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: prestoErrorCode(error, 'DB_PRESTO_QUERY_FAILED'),
      errorMessage: prestoErrorMessage(error, 'Presto table query failed.')
    }
  }
}

export const prestoTableDdl = async (connection: DatabaseConnectionInfo, input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> => {
  try {
    const rows = await prestoRows<Record<string, unknown>>(
      connection,
      `SHOW CREATE TABLE ${prestoTableReference(input)}`,
      { databaseName: trim(input.databaseName), schemaName: trim(input.schemaName) }
    )
    const values = Object.values(rows[0] ?? {})
    const ddl = values.find((value) => typeof value === 'string' && trim(value).toLowerCase().startsWith('create'))
    if (!ddl) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
    return { ok: true, data: { ddl: String(ddl) } }
  } catch (error) {
    return {
      ok: false,
      errorCode: prestoErrorCode(error, 'DB_PRESTO_DDL_FAILED'),
      errorMessage: prestoErrorMessage(error, 'Presto DDL lookup failed.')
    }
  }
}

export const prestoMutationUnsupported = () => ({
  ok: false as const,
  errorCode: 'DB_PRESTO_MUTATION_UNSUPPORTED',
  errorMessage: 'Presto table editing is not supported by this aiopsterm backend.'
})
