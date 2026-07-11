import type {
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableInfo,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './contracts/database'
import {
  columnsForRows,
  configuredDatabaseHttpRuntime,
  databaseColumnId,
  loadDatabaseHttpFetch,
  normalizedDatabasePort,
  parseOrderByRaw,
  parseWhereRaw,
  rowValue,
  trim,
  type DatabaseSqlExecuteRawResult
} from './databaseHttpRuntime'

type PrestoDatabaseConnection = DatabaseConnectionInfo & { dbType: 'presto' }

const MAX_PRESTO_RESPONSE_PAGES = 1000

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

export const isPrestoConnection = (connection: DatabaseConnectionInfo | null | undefined): connection is PrestoDatabaseConnection =>
  connection?.dbType === 'presto'

export const prestoBaseUrlFrom = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'url'>) => {
  const rawUrl = trim(input.url)
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl.replace(/\/+$/, '')
  const host = trim(input.host)
  const port = normalizedDatabasePort(input.port) ?? 8080
  return `http://${host}:${port}`
}

export const prestoEndpointFor = (input: Pick<DatabaseConnectionTestInput, 'host' | 'port' | 'url'>) => prestoBaseUrlFrom(input)

const prestoConnectionInput = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput =>
  configuredDatabaseHttpRuntime().connectionInputFromSaved(connection)

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
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(new Error('Presto HTTP redirects are not allowed.'), {
      code: 'DB_PRESTO_REDIRECT_REJECTED'
    })
  }
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

const prestoNextUriError = (code: string, message: string) => Object.assign(new Error(message), { code })

const resolvePrestoNextUri = (value: string, statementUrl: URL) => {
  let nextUrl: URL
  try {
    nextUrl = new URL(value, statementUrl)
  } catch {
    throw prestoNextUriError('DB_PRESTO_NEXT_URI_INVALID', 'Presto returned an invalid next-page URI.')
  }
  nextUrl.hash = ''
  if (nextUrl.origin !== statementUrl.origin) {
    throw prestoNextUriError('DB_PRESTO_NEXT_URI_ORIGIN_INVALID', 'Presto returned a next-page URI for a different origin.')
  }
  return nextUrl
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
  const fetchImpl = loadDatabaseHttpFetch()
  if (!fetchImpl) {
    throw Object.assign(new Error('Presto HTTP runtime is unavailable. Use a Node/Electron runtime with fetch support.'), {
      code: 'DB_PRESTO_FETCH_UNAVAILABLE'
    })
  }
  const headers = prestoHeadersFor(input, context)
  const statementUrl = new URL(`${prestoBaseUrlFrom(input)}/v1/statement`)
  const firstResponse = await fetchImpl(statementUrl, {
    method: 'POST',
    headers,
    body: sql,
    redirect: 'manual'
  })
  const raw: PrestoStatementResponse[] = []
  let payload = await parsePrestoResponse(firstResponse)
  let columns = Array.isArray(payload.columns) ? payload.columns : []
  let rows = prestoRowsFromData<T>(columns, payload.data)
  raw.push(payload)
  ensurePrestoResponseOk(payload)

  let nextUri = trim(payload.nextUri)
  const visitedNextUris = new Set<string>()
  while (nextUri) {
    if (raw.length >= MAX_PRESTO_RESPONSE_PAGES) {
      throw prestoNextUriError('DB_PRESTO_PAGE_LIMIT', 'Presto returned too many response pages.')
    }
    const nextUrl = resolvePrestoNextUri(nextUri, statementUrl)
    if (visitedNextUris.has(nextUrl.href)) {
      throw prestoNextUriError('DB_PRESTO_NEXT_URI_LOOP', 'Presto repeated a next-page URI.')
    }
    visitedNextUris.add(nextUrl.href)
    const nextResponse = await fetchImpl(nextUrl, {
      method: 'GET',
      headers,
      redirect: 'manual'
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
    'SHOW CATALOGS',
    { databaseName: '', schemaName: '' }
  )
  const selected = trim(connection.database)
  const catalogNames = Array.from(new Set([selected, ...catalogRows.map((row) => trim(rowValue(row, 'Catalog', 'catalog', 'catalog_name')))].filter(Boolean)))
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

const prestoWhereForFilters = (filters: ReturnType<typeof parseWhereRaw>, knownColumns: string[]) => {
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

const prestoOrderByFor = (sort: DatabaseTableQueryInput['sort'] | null | undefined, knownColumns: string[]) => {
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
    const requireStableBaseTable = input.requireStableBaseTable === true
    if (requireStableBaseTable) {
      return {
        ok: false,
        errorCode: 'DB_TABLE_QUERY_UNSUPPORTED',
        errorMessage: 'Presto cannot guarantee a stable base-table query.'
      }
    }
    const columns = await prestoColumnsForTable(connection, input)
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
    const where = prestoWhereForFilters(filters, knownColumns)
    const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
    const orderBy = prestoOrderByFor(sort, knownColumns)
    const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
    const page = Math.max(1, Math.floor(Number(input.page) || 1))
    const offset = (page - 1) * pageSize
    const tableRef = prestoTableReference(input)
    const context = { databaseName: trim(input.databaseName), schemaName: trim(input.schemaName) }
    const selectList = selectedColumns.map(prestoIdentifier).join(', ')
    const rowsQuery = await prestoQuery<Record<string, unknown>>(
      prestoConnectionInput(connection),
      `SELECT ${selectList} FROM ${tableRef}${where}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
      context
    )
    const countRows = input.withTotal
      ? await prestoRows<Record<string, unknown>>(connection, `SELECT count(*) AS total FROM ${tableRef}${where}`, context)
      : []
    return {
      ok: true,
      data: {
        columns: rowsQuery.columns.length ? rowsQuery.columns : selectedColumns,
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
