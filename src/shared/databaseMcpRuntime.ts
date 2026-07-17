import { randomBytes } from 'crypto'
import type { AiopsMutationResult } from './contracts/common'
import type {
  DatabaseCatalogResult,
  DatabaseColumnFilter,
  DatabaseConnectionInfo,
  DatabaseTableExplainPlanInput,
  DatabaseTableExplainPlanResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableIndexInspectionInput,
  DatabaseTableIndexInspectionResult,
  DatabaseTableInfo,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './contracts/database'

export const DATABASE_MCP_TOOL_NAMES = [
  'list_database_connections',
  'list_databases',
  'list_schemas',
  'list_tables',
  'search_database_objects',
  'describe_database_table',
  'get_database_table_ddl',
  'query_database_table',
  'sample_rows',
  'count_rows',
  'inspect_indexes',
  'explain_plan'
] as const

export type DatabaseMcpToolName = (typeof DATABASE_MCP_TOOL_NAMES)[number]

export type DatabaseMcpToolDefinition = {
  name: DatabaseMcpToolName
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: true
    destructiveHint: false
    idempotentHint: true
    openWorldHint: boolean
  }
}

export type DatabaseMcpToolResult = AiopsMutationResult<Record<string, unknown>>

export type DatabaseMcpToolCallOptions = {
  allowInternalConnectionId?: boolean
  signal?: AbortSignal
}

export type DatabaseMcpDependencyReadOptions = {
  signal: AbortSignal
}

export type DatabaseMcpRuntimeDependencies = {
  listCatalog: () => Promise<DatabaseCatalogResult>
  getTableDdl: (input: DatabaseTableDdlInput, options?: DatabaseMcpDependencyReadOptions) => Promise<DatabaseTableDdlResult>
  queryTable: (input: DatabaseTableQueryInput, options?: DatabaseMcpDependencyReadOptions) => Promise<DatabaseTableQueryResult>
  inspectTableIndexes?: (input: DatabaseTableIndexInspectionInput, options?: DatabaseMcpDependencyReadOptions) => Promise<DatabaseTableIndexInspectionResult>
  explainTable?: (input: DatabaseTableExplainPlanInput, options?: DatabaseMcpDependencyReadOptions) => Promise<DatabaseTableExplainPlanResult>
}

type DatabaseObjectKind = 'table' | 'view' | 'function' | 'procedure'

type DatabaseObjectRecord = {
  connectionId: string
  databaseName: string
  schemaName?: string
  kind: DatabaseObjectKind
  name: string
  table?: DatabaseTableInfo
}

const MAX_OBJECT_RESULTS = 200
const MAX_DATABASE_RESULTS = 100
const MAX_SCHEMA_RESULTS = 200
const MAX_TABLE_RESULTS = 500
const MAX_SAMPLE_ROWS = 20
const MAX_INDEX_RESULTS = 200
const MAX_QUERY_PAGE_SIZE = 100
const MAX_QUERY_PAGE = 1000
const MAX_QUERY_COLUMNS = 50
const MAX_QUERY_FILTERS = 10
const MAX_FILTER_VALUES = 50
const MAX_FILTER_VALUE_LENGTH = 4096
const MAX_RESULT_BYTES = 512 * 1024
const MAX_DDL_BYTES = 256 * 1024
const MAX_DDL_SOURCE_CHARS = 512 * 1024
const MAX_EXPLAIN_PLAN_BYTES = 128 * 1024
const MAX_SENSITIVE_TEXT_CHARS = 16 * 1024
const MAX_CELL_STRING_LENGTH = 16 * 1024
const MAX_ACTIVE_DATABASE_READS = 4
const MAX_PHYSICAL_DATABASE_READS = MAX_ACTIVE_DATABASE_READS * 2
const DATABASE_READ_DEADLINE_MS = 30_000

const localReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

const externalReadOnlyAnnotations = {
  ...localReadOnlyAnnotations,
  openWorldHint: true
} as const

const connectionIdProperty = {
  type: 'string',
  description: 'Process-scoped opaque handle returned by list_database_connections.'
}

const tableSelectorProperties = {
  connectionId: connectionIdProperty,
  databaseName: { type: 'string', description: 'Catalog or database name from the saved connection.' },
  schemaName: { type: 'string', description: 'Optional schema name.' },
  tableName: { type: 'string', description: 'Exact table or view name.' }
}

const queryTableSelectorProperties = {
  ...tableSelectorProperties,
  tableName: { type: 'string', description: 'Exact base table name. Views cannot be queried.' }
}

const boundedColumnsProperty = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_QUERY_COLUMNS,
  uniqueItems: true,
  items: { type: 'string' },
  description: 'Optional bounded scalar columns. Unbounded LOB, TEXT, JSON, collection, and String columns are rejected.'
}

const structuredFiltersProperty = {
  type: 'array',
  maxItems: MAX_QUERY_FILTERS,
  description: 'Structured filters combined with AND.',
  items: {
    type: 'object',
    properties: {
      column: { type: 'string' },
      operator: { type: 'string', enum: ['like', 'eq', 'neq', 'in', 'isnull', 'notnull'] },
      value: { type: 'string' },
      values: { type: 'array', maxItems: MAX_FILTER_VALUES, items: { type: 'string' } }
    },
    required: ['column', 'operator'],
    additionalProperties: false
  }
}

const structuredSortProperty = {
  type: 'object',
  properties: {
    column: { type: 'string' },
    direction: { type: 'string', enum: ['asc', 'desc'] }
  },
  required: ['column', 'direction'],
  additionalProperties: false
}

export const DATABASE_MCP_TOOL_DEFINITIONS: DatabaseMcpToolDefinition[] = [
  {
    name: 'list_database_connections',
    title: 'List aiopsterm database connections',
    description: 'List saved database connections without returning hosts, usernames, URLs, file paths, passwords, or other connection secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter across generated label, engine, environment, and status.' }
      },
      additionalProperties: false
    },
    annotations: localReadOnlyAnnotations
  },
  {
    name: 'list_databases',
    title: 'List databases on an aiopsterm connection',
    description: 'List bounded catalog or database metadata on one saved connection. No connection secrets are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: connectionIdProperty,
        databaseName: { type: 'string', description: 'Optional exact database scope.' },
        query: { type: 'string', description: 'Optional case-insensitive name filter.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_DATABASE_RESULTS, description: 'Maximum databases to return. Defaults to 100.' }
      },
      required: ['connectionId'],
      additionalProperties: false
    },
    annotations: localReadOnlyAnnotations
  },
  {
    name: 'list_schemas',
    title: 'List schemas in an aiopsterm database',
    description: 'List bounded schema metadata from the current catalog snapshot for one exact database.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: connectionIdProperty,
        databaseName: { type: 'string', description: 'Exact catalog or database name.' },
        schemaName: { type: 'string', description: 'Optional exact schema scope.' },
        query: { type: 'string', description: 'Optional case-insensitive name filter.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SCHEMA_RESULTS, description: 'Maximum schemas to return. Defaults to 100.' }
      },
      required: ['connectionId', 'databaseName'],
      additionalProperties: false
    },
    annotations: localReadOnlyAnnotations
  },
  {
    name: 'list_tables',
    title: 'List tables in an aiopsterm database',
    description: 'List bounded table and view metadata in one exact database and optional schema.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: connectionIdProperty,
        databaseName: { type: 'string', description: 'Exact catalog or database name.' },
        schemaName: { type: 'string', description: 'Optional exact schema scope.' },
        query: { type: 'string', description: 'Optional case-insensitive table-name filter.' },
        kinds: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['table', 'view'] } },
        limit: { type: 'integer', minimum: 1, maximum: MAX_TABLE_RESULTS, description: 'Maximum tables and views to return. Defaults to 200.' }
      },
      required: ['connectionId', 'databaseName'],
      additionalProperties: false
    },
    annotations: localReadOnlyAnnotations
  },
  {
    name: 'search_database_objects',
    title: 'Search aiopsterm database objects',
    description: 'Search catalog metadata for tables, views, functions, and procedures on one saved database connection.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: connectionIdProperty,
        query: { type: 'string', description: 'Optional case-insensitive object, path, or column-name search.' },
        databaseName: { type: 'string', description: 'Optional exact catalog or database name.' },
        schemaName: { type: 'string', description: 'Optional exact schema name.' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['table', 'view', 'function', 'procedure'] },
          description: 'Optional object-kind filter.'
        },
        limit: { type: 'integer', minimum: 1, maximum: MAX_OBJECT_RESULTS, description: 'Maximum objects to return. Defaults to 100.' }
      },
      required: ['connectionId'],
      additionalProperties: false
    },
    annotations: localReadOnlyAnnotations
  },
  {
    name: 'describe_database_table',
    title: 'Describe an aiopsterm database table',
    description: 'Return current catalog metadata for one table or view, including column types, nullability, keys, and primary-key columns.',
    inputSchema: {
      type: 'object',
      properties: tableSelectorProperties,
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: localReadOnlyAnnotations
  },
  {
    name: 'get_database_table_ddl',
    title: 'Get aiopsterm database table DDL',
    description: 'Read a redacted CREATE definition for one catalog-known table or view through the saved aiopsterm connection.',
    inputSchema: {
      type: 'object',
      properties: tableSelectorProperties,
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: externalReadOnlyAnnotations
  },
  {
    name: 'query_database_table',
    title: 'Query an aiopsterm database table',
    description: 'Read a bounded page from one catalog-known table using structured, parameterized filters and sorting. Arbitrary SQL is not accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        ...queryTableSelectorProperties,
        columns: boundedColumnsProperty,
        filters: structuredFiltersProperty,
        sort: structuredSortProperty,
        page: { type: 'integer', minimum: 1, maximum: MAX_QUERY_PAGE, description: 'One-based page number. Defaults to 1 and is capped at 1000.' },
        pageSize: { type: 'integer', minimum: 1, maximum: MAX_QUERY_PAGE_SIZE, description: 'Rows per page. Defaults to 50 and is capped at 100.' }
      },
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: externalReadOnlyAnnotations
  },
  {
    name: 'sample_rows',
    title: 'Sample rows from an aiopsterm database table',
    description: 'Read at most 20 rows from one catalog-known base table through the structured table-query boundary. Arbitrary SQL is not accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        ...queryTableSelectorProperties,
        columns: boundedColumnsProperty,
        filters: structuredFiltersProperty,
        sort: structuredSortProperty,
        limit: { type: 'integer', minimum: 1, maximum: MAX_SAMPLE_ROWS, description: 'Rows to return. Defaults to 5 and is capped at 20.' }
      },
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: externalReadOnlyAnnotations
  },
  {
    name: 'count_rows',
    title: 'Count rows in an aiopsterm database table',
    description: 'Count rows in one catalog-known base table using optional structured filters. Arbitrary SQL is not accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        ...queryTableSelectorProperties,
        filters: structuredFiltersProperty
      },
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: externalReadOnlyAnnotations
  },
  {
    name: 'inspect_indexes',
    title: 'Inspect indexes on an aiopsterm database table',
    description: 'Return structured index metadata for one catalog-known base table when the database engine has a safe index adapter.',
    inputSchema: {
      type: 'object',
      properties: queryTableSelectorProperties,
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: externalReadOnlyAnnotations
  },
  {
    name: 'explain_plan',
    title: 'Explain a structured aiopsterm table query',
    description: 'Return a bounded execution plan for a catalog-validated structured base-table query when the database engine has a safe explain adapter. SQL text is never accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        ...queryTableSelectorProperties,
        columns: boundedColumnsProperty,
        filters: structuredFiltersProperty,
        sort: structuredSortProperty
      },
      required: ['connectionId', 'databaseName', 'tableName'],
      additionalProperties: false
    },
    annotations: externalReadOnlyAnnotations
  }
]

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const positiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(max, Math.floor(numberValue)))
}

const ok = (data: Record<string, unknown>): DatabaseMcpToolResult => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string): DatabaseMcpToolResult => ({
  ok: false,
  errorCode,
  errorMessage
})

const safeDependencyErrorCode = (value: unknown, fallback: string) => {
  const errorCode = cleanText(value)
  return /^DB_[A-Z0-9_]{1,80}$/.test(errorCode) ? errorCode : fallback
}

const sameName = (left: string, right: string) => left === right || left.toLocaleLowerCase() === right.toLocaleLowerCase()

const databaseMcpConnectionLabel = (connection: DatabaseConnectionInfo, index: number) =>
  `${connection.dbType} / ${connection.env} / ${index + 1}`

const regexpEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const redactDatabaseMcpSensitiveValues = (value: string, sensitiveValues: string[]) => {
  let output = value
  const seen = new Set<string>()
  const normalizedValues = sensitiveValues
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase()
      if (!item || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => right.length - left.length)
  for (const sensitiveValue of normalizedValues) {
    if (sensitiveValue.length >= 3) {
      output = output.replace(new RegExp(regexpEscape(sensitiveValue), 'gi'), '[redacted]')
      continue
    }
    const tokenPattern = new RegExp(`(^|[^\\p{L}\\p{N}_$-])${regexpEscape(sensitiveValue)}(?=$|[^\\p{L}\\p{N}_$-])`, 'giu')
    output = output.replace(tokenPattern, '$1[redacted]')
  }
  return output
}

export const sanitizeDatabaseMcpSensitiveText = (value: unknown, sensitiveValues: string[] = []) => {
  const rawSource = String(value || '')
  let source = rawSource.slice(0, MAX_SENSITIVE_TEXT_CHARS)
  const finalCodeUnit = source.charCodeAt(source.length - 1)
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) source = source.slice(0, -1)
  const output = redactDatabaseMcpSensitiveValues(source, sensitiveValues)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^@\s/?#]+)@/gi, '$1[redacted]@')
    .replace(
      /\b(password|passwd|pwd|secret|token|access[_-]?key|secret[_-]?key|user(?:name)?|user\s+id|uid|host(?:name)?|server|address|data\s+source)\s*[:=]\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;]+)/gi,
      '$1=[redacted]'
    )
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted]')
    .replace(/\[(?=[0-9a-f:]*:)[0-9a-f:]{2,}\]/gi, '[redacted]')
    .replace(
      /(^|[^A-Za-z0-9_])((?=[0-9A-Fa-f:]*[0-9A-Fa-f])(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f]{0,4})(?=$|[^A-Za-z0-9_])/g,
      '$1[redacted]'
    )
  return source.length < rawSource.length ? `${output}...` : output
}

const oracleQuotedLiteralEnd = (delimiter: string) => {
  if (delimiter === '[') return ']'
  if (delimiter === '{') return '}'
  if (delimiter === '(') return ')'
  if (delimiter === '<') return '>'
  return delimiter
}

export const sanitizeDatabaseMcpDdl = (value: unknown, sensitiveValues: string[] = []) => {
  const rawSource = String(value || '')
  let source = rawSource.slice(0, MAX_DDL_SOURCE_CHARS)
  const finalCodeUnit = source.charCodeAt(source.length - 1)
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) source = source.slice(0, -1)
  let output = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const newline = source.indexOf('\n', index + 2)
      if (newline < 0) break
      output += '\n'
      index = newline + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      output += ' '
      continue
    }
    const char = source[index]
    if (char === "'") {
      output += "'[redacted]'"
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (source[index] !== "'") {
          index += 1
          continue
        }
        if (source[index + 1] === "'") {
          index += 2
          continue
        }
        index += 1
        break
      }
      continue
    }
    if ((char === 'q' || char === 'Q') && source[index + 1] === "'" && source[index + 2]) {
      const delimiter = source[index + 2]
      const closing = `${oracleQuotedLiteralEnd(delimiter)}'`
      const end = source.indexOf(closing, index + 3)
      output += `${char}'${delimiter}[redacted]${closing}`
      index = end < 0 ? source.length : end + closing.length
      continue
    }
    if (char === '$') {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (delimiter) {
        const end = source.indexOf(delimiter, index + delimiter.length)
        output += `${delimiter}[redacted]${delimiter}`
        index = end < 0 ? source.length : end + delimiter.length
        continue
      }
    }
    output += char
    index += 1
  }

  output = output
    .replace(/\bDEFINER\s*=\s*(?:`(?:``|[^`])*`|[^@\s]+)\s*@\s*(?:`(?:``|[^`])*`|[^\s]+)/gi, 'DEFINER=[redacted]')
    .replace(/\bIDENTIFIED\s+BY\s+[^\s,;)]+/gi, 'IDENTIFIED BY [redacted]')
    .replace(/\b(password|secret|token|access_key|secret_key)\s*=\s*[^\s,;)]+/gi, '$1=[redacted]')

  output = redactDatabaseMcpSensitiveValues(output, sensitiveValues)
  return output.trim()
}

const objectPath = (object: DatabaseObjectRecord) => [object.databaseName, object.schemaName, object.name].filter(Boolean).join('.')

const databaseObjectsForConnection = (connection: DatabaseConnectionInfo): DatabaseObjectRecord[] =>
  connection.catalogs.flatMap((catalog) => {
    const rootTables: DatabaseObjectRecord[] = (catalog.tables ?? []).map((table) => ({
      connectionId: connection.id,
      databaseName: catalog.name,
      kind: 'table',
      name: table.name,
      table
    }))
    const schemaObjects = (catalog.schemas ?? []).flatMap((schema): DatabaseObjectRecord[] => [
      ...schema.tables.map((table) => ({
        connectionId: connection.id,
        databaseName: catalog.name,
        schemaName: schema.name,
        kind: 'table' as const,
        name: table.name,
        table
      })),
      ...(schema.views ?? []).map((table) => ({
        connectionId: connection.id,
        databaseName: catalog.name,
        schemaName: schema.name,
        kind: 'view' as const,
        name: table.name,
        table
      })),
      ...(schema.functions ?? []).map((name) => ({
        connectionId: connection.id,
        databaseName: catalog.name,
        schemaName: schema.name,
        kind: 'function' as const,
        name
      })),
      ...(schema.procedures ?? []).map((name) => ({
        connectionId: connection.id,
        databaseName: catalog.name,
        schemaName: schema.name,
        kind: 'procedure' as const,
        name
      }))
    ])
    return [...rootTables, ...schemaObjects]
  })

const publicObject = (object: DatabaseObjectRecord, connectionHandleFor: (connectionId: string) => string) => ({
  connectionId: connectionHandleFor(object.connectionId),
  databaseName: object.databaseName,
  ...(object.schemaName ? { schemaName: object.schemaName } : {}),
  kind: object.kind,
  name: object.name,
  path: objectPath(object),
  ...(object.table
    ? {
        columnCount: object.table.columns.length,
        primaryKey: object.table.primaryKey.slice()
      }
    : {})
})

const publicTable = (object: DatabaseObjectRecord, connectionHandleFor: (connectionId: string) => string) => ({
  ...publicObject(object, connectionHandleFor),
  columns: (object.table?.columns ?? []).map((column) => ({
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    ...(column.key ? { key: column.key } : {})
  })),
  primaryKey: object.table?.primaryKey.slice() ?? []
})

const normalizeKinds = (value: unknown): Set<DatabaseObjectKind> | null => {
  if (value === undefined) return null
  if (!Array.isArray(value)) return new Set()
  const allowed = new Set<DatabaseObjectKind>(['table', 'view', 'function', 'procedure'])
  const kinds = value.map(cleanText).filter((kind): kind is DatabaseObjectKind => allowed.has(kind as DatabaseObjectKind))
  return kinds.length === value.length ? new Set(kinds) : new Set()
}

const catalogSnapshot = async (dependencies: DatabaseMcpRuntimeDependencies) => {
  let result: DatabaseCatalogResult
  try {
    result = await dependencies.listCatalog()
  } catch {
    return {
      result: fail('DB_MCP_CATALOG_FAILED', 'Database catalog could not be loaded.'),
      connections: null
    }
  }
  if (!result.ok || !result.data) {
    return {
      result: fail(safeDependencyErrorCode(result.errorCode, 'DB_MCP_CATALOG_FAILED'), 'Database catalog could not be loaded.'),
      connections: null
    }
  }
  return { result: null, connections: result.data.connections }
}

const resolveConnection = async (
  dependencies: DatabaseMcpRuntimeDependencies,
  connectionIdValue: unknown,
  connectionIdForHandle: (handle: string) => string | undefined,
  allowInternalConnectionId: boolean
) => {
  const suppliedConnectionId = cleanText(connectionIdValue)
  if (!suppliedConnectionId) return { result: fail('DB_MCP_CONNECTION_REQUIRED', 'connectionId is required.'), connection: null }
  const connectionId = connectionIdForHandle(suppliedConnectionId) || (allowInternalConnectionId ? suppliedConnectionId : '')
  if (!connectionId) return { result: fail('DB_MCP_CONNECTION_NOT_FOUND', 'The saved database connection was not found.'), connection: null }
  const snapshot = await catalogSnapshot(dependencies)
  if (snapshot.result || !snapshot.connections) return { result: snapshot.result, connection: null }
  const connection = snapshot.connections.find((item) => item.id === connectionId) ?? null
  if (!connection) return { result: fail('DB_MCP_CONNECTION_NOT_FOUND', 'The saved database connection was not found.'), connection: null }
  return { result: null, connection }
}

const resolveTable = (
  connection: DatabaseConnectionInfo,
  params: Record<string, unknown>
): { result: DatabaseMcpToolResult | null; object: DatabaseObjectRecord | null } => {
  const databaseName = cleanText(params.databaseName)
  const schemaName = cleanText(params.schemaName)
  const tableName = cleanText(params.tableName)
  if (!databaseName) return { result: fail('DB_MCP_DATABASE_REQUIRED', 'databaseName is required.'), object: null }
  if (!tableName) return { result: fail('DB_MCP_TABLE_REQUIRED', 'tableName is required.'), object: null }
  const matches = databaseObjectsForConnection(connection).filter(
    (object) =>
      (object.kind === 'table' || object.kind === 'view') &&
      sameName(object.databaseName, databaseName) &&
      (!schemaName || sameName(object.schemaName || '', schemaName)) &&
      sameName(object.name, tableName)
  )
  if (!matches.length) return { result: fail('DB_MCP_TABLE_NOT_FOUND', 'The table or view was not found in the current database catalog.'), object: null }
  if (matches.length > 1 && !schemaName) {
    return { result: fail('DB_MCP_SCHEMA_REQUIRED', 'schemaName is required because the table name is ambiguous.'), object: null }
  }
  return { result: null, object: matches[0] }
}

const resolveCatalog = (connection: DatabaseConnectionInfo, databaseNameValue: unknown) => {
  const databaseName = cleanText(databaseNameValue)
  if (!databaseName) return { result: fail('DB_MCP_DATABASE_REQUIRED', 'databaseName is required.'), catalog: null }
  const catalog = connection.catalogs.find((item) => sameName(item.name, databaseName)) ?? null
  return catalog
    ? { result: null, catalog }
    : { result: fail('DB_MCP_DATABASE_NOT_FOUND', 'The database was not found in the current connection catalog.'), catalog: null }
}

const connectionMustBeOpen = (connection: DatabaseConnectionInfo) =>
  connection.status === 'connected' || connection.dbType === 'sqlite'
    ? null
    : fail('DB_MCP_CONNECTION_NOT_CONNECTED', 'Open the saved database connection in aiopsterm before reading database data.')

const normalizeFilterValue = (value: unknown) => {
  if (typeof value !== 'string') return null
  return value.slice(0, MAX_FILTER_VALUE_LENGTH)
}

const normalizeFilters = (
  value: unknown,
  table: DatabaseTableInfo
): { result: DatabaseMcpToolResult | null; filters: DatabaseColumnFilter[] } => {
  if (value === undefined) return { result: null, filters: [] }
  if (!Array.isArray(value) || value.length > MAX_QUERY_FILTERS) {
    return { result: fail('DB_MCP_FILTERS_INVALID', `filters must be an array with at most ${MAX_QUERY_FILTERS} entries.`), filters: [] }
  }
  const knownColumns = new Map(table.columns.map((column) => [column.name.toLocaleLowerCase(), column.name]))
  const filters: DatabaseColumnFilter[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { result: fail('DB_MCP_FILTER_INVALID', 'Each filter must be an object.'), filters: [] }
    }
    const input = raw as Record<string, unknown>
    const column = knownColumns.get(cleanText(input.column).toLocaleLowerCase())
    const operator = cleanText(input.operator)
    if (!column) return { result: fail('DB_MCP_FILTER_COLUMN_INVALID', 'A filter references a column that is not in the table catalog.'), filters: [] }
    if (operator === 'isnull' || operator === 'notnull') {
      filters.push({ column, operator })
      continue
    }
    if (operator === 'in') {
      if (!Array.isArray(input.values) || !input.values.length || input.values.length > MAX_FILTER_VALUES) {
        return { result: fail('DB_MCP_FILTER_VALUES_INVALID', `An in filter requires 1-${MAX_FILTER_VALUES} string values.`), filters: [] }
      }
      const values = input.values.map(normalizeFilterValue)
      if (values.some((item) => item === null)) return { result: fail('DB_MCP_FILTER_VALUES_INVALID', 'Filter values must be strings.'), filters: [] }
      filters.push({ column, operator, values: values as string[] })
      continue
    }
    if (operator !== 'like' && operator !== 'eq' && operator !== 'neq') {
      return { result: fail('DB_MCP_FILTER_OPERATOR_INVALID', 'The filter operator is not supported.'), filters: [] }
    }
    const filterValue = normalizeFilterValue(input.value)
    if (filterValue === null) return { result: fail('DB_MCP_FILTER_VALUE_INVALID', 'The filter value must be a string.'), filters: [] }
    filters.push({ column, operator, value: filterValue })
  }
  return { result: null, filters }
}

const normalizeSort = (value: unknown, table: DatabaseTableInfo) => {
  if (value === undefined || value === null) return { result: null, sort: null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { result: fail('DB_MCP_SORT_INVALID', 'sort must be an object.'), sort: null }
  }
  const input = value as Record<string, unknown>
  const column = table.columns.find((item) => sameName(item.name, cleanText(input.column)))?.name
  const direction = cleanText(input.direction)
  if (!column || (direction !== 'asc' && direction !== 'desc')) {
    return { result: fail('DB_MCP_SORT_INVALID', 'sort requires a catalog-known column and asc or desc direction.'), sort: null }
  }
  return { result: null, sort: { column, direction } as const }
}

const isPotentiallyUnboundedColumnType = (value: string) => {
  const type = value.trim().toLowerCase()
  if (!type) return true
  if (/\b(blob|clob|nclob|bytea|text|jsonb?|xml|image|long raw|long|bit varying|varbinary\s*\(\s*max\s*\)|[n]?varchar\s*\(\s*max\s*\))\b/i.test(type)) return true
  if (/\b(array|map|tuple|row|object|variant)\s*[<(]/i.test(type)) return true
  if (/\[\]\s*$/.test(type)) return true
  if (/\bstring\b/i.test(type) && !/\bfixedstring\s*\(\s*\d+\s*\)/i.test(type)) return true
  if (/\b(varchar|nvarchar|character varying|varbinary|binary varying)\b/i.test(type) && !/\(\s*\d+\s*\)/.test(type)) return true
  if (/\b(numeric|decimal)\b/i.test(type) && !/\(\s*\d+\s*(?:,\s*\d+\s*)?\)/.test(type)) return true
  const declaredLength = type.match(/\(\s*(\d+)\s*(?:[,)]|$)/)?.[1]
  if (declaredLength && Number(declaredLength) > MAX_CELL_STRING_LENGTH) return true
  return !/\b(int|integer|tinyint|smallint|mediumint|bigint|uint\d*|int\d*|decimal|numeric|number|real|double|float|bool|boolean|bit|date|time|timestamp|datetime|interval|year|uuid|uniqueidentifier|inet|ipv[46]|cidr|macaddr|money|fixedstring|char|varchar|nvarchar|binary|varbinary|enum|set)\b/i.test(type)
}

const normalizeSelectedColumns = (value: unknown, table: DatabaseTableInfo) => {
  if (value !== undefined && (!Array.isArray(value) || !value.length || value.length > MAX_QUERY_COLUMNS)) {
    return { result: fail('DB_MCP_COLUMNS_INVALID', `columns must contain 1-${MAX_QUERY_COLUMNS} entries.`), columns: [], omittedColumns: [] }
  }
  const knownColumns = new Map(table.columns.map((column) => [column.name.toLowerCase(), column]))
  const requested = Array.isArray(value) ? value.map(cleanText) : []
  if (requested.some((name) => !name) || new Set(requested.map((name) => name.toLowerCase())).size !== requested.length) {
    return { result: fail('DB_MCP_COLUMNS_INVALID', 'columns must contain unique non-empty catalog column names.'), columns: [], omittedColumns: [] }
  }
  const selected = requested.length
    ? requested.map((name) => knownColumns.get(name.toLowerCase())).filter(Boolean)
    : table.columns.filter((column) => !isPotentiallyUnboundedColumnType(column.type)).slice(0, MAX_QUERY_COLUMNS)
  if (requested.length && selected.length !== requested.length) {
    return { result: fail('DB_MCP_COLUMNS_INVALID', 'A selected column is not in the current table catalog.'), columns: [], omittedColumns: [] }
  }
  const unbounded = selected.filter((column) => column && isPotentiallyUnboundedColumnType(column.type))
  if (unbounded.length) {
    return {
      result: fail('DB_MCP_UNBOUNDED_COLUMN_UNSUPPORTED', `Unbounded columns cannot be returned by database MCP: ${unbounded.map((column) => column?.name).join(', ')}`),
      columns: [],
      omittedColumns: []
    }
  }
  const columns = selected.map((column) => column?.name || '').filter(Boolean)
  if (!columns.length) {
    return { result: fail('DB_MCP_BOUNDED_COLUMNS_REQUIRED', 'This table has no bounded scalar columns available for MCP queries.'), columns: [], omittedColumns: [] }
  }
  const selectedNames = new Set(columns.map((column) => column.toLowerCase()))
  return {
    result: null,
    columns,
    omittedColumns: table.columns.filter((column) => !selectedNames.has(column.name.toLowerCase())).map((column) => column.name)
  }
}

const projectRowsToColumns = (rows: Array<Record<string, unknown>>, columns: string[]) =>
  rows.map((row) => {
    const rowKeys = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]))
    return Object.fromEntries(
      columns.flatMap((column) => {
        const sourceKey = Object.prototype.hasOwnProperty.call(row, column) ? column : rowKeys.get(column.toLowerCase())
        return sourceKey ? [[column, row[sourceKey]]] : []
      })
    )
  })

const jsonSafeValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value ?? null
  if (typeof value === 'string') return value.length > MAX_CELL_STRING_LENGTH ? `${value.slice(0, MAX_CELL_STRING_LENGTH)}...` : value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol' || typeof value === 'function') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return { type: 'binary', byteLength: value.byteLength }
  if (depth >= 4 || typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => jsonSafeValue(item, depth + 1, seen))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([key, item]) => [key, jsonSafeValue(item, depth + 1, seen)])
  )
}

const boundedRows = (rows: Array<Record<string, unknown>>, maxRows: number) => {
  const output: Array<Record<string, unknown>> = []
  let bytes = 0
  for (const row of rows.slice(0, Math.max(0, maxRows))) {
    const safeRow = jsonSafeValue(row) as Record<string, unknown>
    const rowBytes = Buffer.byteLength(JSON.stringify(safeRow), 'utf8')
    if (bytes + rowBytes > MAX_RESULT_BYTES) break
    output.push(safeRow)
    bytes += rowBytes
  }
  return { rows: output, bytes, truncated: output.length < rows.length }
}

const boundedUtf8Text = (value: string, maxBytes: number) => {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.byteLength <= maxBytes) return { value, bytes: buffer.byteLength, truncated: false }
  let end = maxBytes
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  const bounded = buffer.subarray(0, end).toString('utf8')
  return { value: bounded, bytes: Buffer.byteLength(bounded, 'utf8'), truncated: true }
}

export const isDatabaseMcpToolName = (value: unknown): value is DatabaseMcpToolName =>
  DATABASE_MCP_TOOL_NAMES.includes(value as DatabaseMcpToolName)

export function createDatabaseMcpToolRuntime(dependencies: DatabaseMcpRuntimeDependencies) {
  let activeDatabaseReadLeases = 0
  let physicalDatabaseReads = 0
  const connectionHandles = new Map<string, string>()
  const connectionIdsByHandle = new Map<string, string>()

  const connectionHandleFor = (connectionId: string) => {
    const existing = connectionHandles.get(connectionId)
    if (existing) return existing
    let handle = ''
    do {
      handle = `db-${randomBytes(16).toString('hex')}`
    } while (connectionIdsByHandle.has(handle))
    connectionHandles.set(connectionId, handle)
    connectionIdsByHandle.set(handle, connectionId)
    return handle
  }

  const resolveRuntimeConnection = (
    connectionIdValue: unknown,
    options: DatabaseMcpToolCallOptions
  ) => resolveConnection(dependencies, connectionIdValue, (handle) => connectionIdsByHandle.get(handle), options.allowInternalConnectionId === true)

  const runDatabaseRead = async <T>(
    operation: (options: DatabaseMcpDependencyReadOptions) => Promise<T>,
    failure: { errorCode: string; errorMessage: string },
    signal?: AbortSignal
  ): Promise<{ value?: T; error?: DatabaseMcpToolResult }> => {
    if (signal?.aborted) {
      return { error: fail('DB_MCP_REQUEST_CANCELLED', 'Database MCP request was cancelled.') }
    }
    if (physicalDatabaseReads >= MAX_PHYSICAL_DATABASE_READS) {
      return { error: fail('DB_MCP_READ_CHANNEL_ISOLATED', 'Database MCP reads are isolated because cancelled operations did not stop.') }
    }
    if (activeDatabaseReadLeases >= MAX_ACTIVE_DATABASE_READS) {
      return { error: fail('DB_MCP_READ_CONCURRENCY_LIMIT', 'Too many database MCP reads are already running.') }
    }
    activeDatabaseReadLeases += 1
    physicalDatabaseReads += 1
    let leaseReleased = false
    const releaseLease = () => {
      if (leaseReleased) return
      leaseReleased = true
      activeDatabaseReadLeases = Math.max(0, activeDatabaseReadLeases - 1)
    }
    const readController = new AbortController()
    const tracked = Promise.resolve()
      .then(() => operation({ signal: readController.signal }))
      .then((value) => ({ value }))
      .catch(() => ({ error: fail(failure.errorCode, failure.errorMessage) }))
      .finally(() => {
        physicalDatabaseReads = Math.max(0, physicalDatabaseReads - 1)
        releaseLease()
      })
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<{ error: DatabaseMcpToolResult }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ error: fail('DB_MCP_READ_TIMEOUT', 'Database MCP read exceeded the 30 second deadline.') })
        readController.abort('DB_MCP_READ_TIMEOUT')
      }, DATABASE_READ_DEADLINE_MS)
      timer.unref?.()
    })
    let cancel: (() => void) | undefined
    const cancelled = new Promise<{ error: DatabaseMcpToolResult }>((resolve) => {
      if (!signal) return
      cancel = () => {
        resolve({ error: fail('DB_MCP_REQUEST_CANCELLED', 'Database MCP request was cancelled.') })
        readController.abort(signal.reason)
      }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
    try {
      return await Promise.race([tracked, timeout, cancelled])
    } finally {
      if (timer) clearTimeout(timer)
      if (signal && cancel) signal.removeEventListener('abort', cancel)
      releaseLease()
    }
  }

  const listConnections = async (params: Record<string, unknown>) => {
    const snapshot = await catalogSnapshot(dependencies)
    if (snapshot.result || !snapshot.connections) return snapshot.result as DatabaseMcpToolResult
    const query = cleanText(params.query).toLocaleLowerCase()
    const connections = snapshot.connections
      .map((connection, index) => ({
        connectionId: connectionHandleFor(connection.id),
        label: databaseMcpConnectionLabel(connection, index),
        dbType: connection.dbType,
        environment: connection.env,
        status: connection.status,
        readonly: connection.readonly === true,
        catalogCount: connection.catalogs.length
      }))
      .filter((connection) => {
        if (!query) return true
        return [connection.label, connection.dbType, connection.environment, connection.status].some((value) => String(value).toLocaleLowerCase().includes(query))
      })
    return ok({ connections, count: connections.length })
  }

  const listDatabases = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const exactDatabaseName = cleanText(params.databaseName)
    const query = cleanText(params.query).toLocaleLowerCase()
    const limit = positiveInteger(params.limit, MAX_DATABASE_RESULTS, MAX_DATABASE_RESULTS)
    const matches = resolved.connection.catalogs
      .filter((catalog) => !exactDatabaseName || sameName(catalog.name, exactDatabaseName))
      .filter((catalog) => !query || catalog.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name))
    if (exactDatabaseName && !matches.length) {
      return fail('DB_MCP_DATABASE_NOT_FOUND', 'The database was not found in the current connection catalog.')
    }
    const databases = matches.slice(0, limit).map((catalog) => ({
      name: catalog.name,
      schemaCount: catalog.schemas?.length ?? 0,
      tableCount: (catalog.tables?.length ?? 0) + (catalog.schemas ?? []).reduce((count, schema) => count + schema.tables.length, 0),
      viewCount: (catalog.schemas ?? []).reduce((count, schema) => count + (schema.views?.length ?? 0), 0)
    }))
    return ok({ databases, count: databases.length, totalMatched: matches.length, truncated: databases.length < matches.length })
  }

  const listSchemas = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const selected = resolveCatalog(resolved.connection, params.databaseName)
    if (selected.result || !selected.catalog) return selected.result as DatabaseMcpToolResult
    const exactSchemaName = cleanText(params.schemaName)
    const query = cleanText(params.query).toLocaleLowerCase()
    const limit = positiveInteger(params.limit, 100, MAX_SCHEMA_RESULTS)
    const matches = (selected.catalog.schemas ?? [])
      .filter((schema) => !exactSchemaName || sameName(schema.name, exactSchemaName))
      .filter((schema) => !query || schema.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name))
    if (exactSchemaName && !matches.length) {
      return fail('DB_MCP_SCHEMA_NOT_FOUND', 'The schema was not found in the current database catalog.')
    }
    const schemas = matches.slice(0, limit).map((schema) => ({
      name: schema.name,
      tableCount: schema.tables.length,
      viewCount: schema.views?.length ?? 0,
      functionCount: schema.functions?.length ?? 0,
      procedureCount: schema.procedures?.length ?? 0
    }))
    return ok({ databaseName: selected.catalog.name, schemas, count: schemas.length, totalMatched: matches.length, truncated: schemas.length < matches.length })
  }

  const listTables = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const selected = resolveCatalog(resolved.connection, params.databaseName)
    if (selected.result || !selected.catalog) return selected.result as DatabaseMcpToolResult
    const schemaName = cleanText(params.schemaName)
    const query = cleanText(params.query).toLocaleLowerCase()
    const kinds = normalizeKinds(params.kinds)
    if (kinds && (!Array.isArray(params.kinds) || kinds.size !== params.kinds.length || [...kinds].some((kind) => kind !== 'table' && kind !== 'view'))) {
      return fail('DB_MCP_OBJECT_KINDS_INVALID', 'kinds contains an unsupported database object kind.')
    }
    if (schemaName && !(selected.catalog.schemas ?? []).some((schema) => sameName(schema.name, schemaName))) {
      return fail('DB_MCP_SCHEMA_NOT_FOUND', 'The schema was not found in the current database catalog.')
    }
    const limit = positiveInteger(params.limit, 200, MAX_TABLE_RESULTS)
    const matches = databaseObjectsForConnection(resolved.connection)
      .filter((object) => object.kind === 'table' || object.kind === 'view')
      .filter((object) => sameName(object.databaseName, selected.catalog?.name || ''))
      .filter((object) => !schemaName || sameName(object.schemaName || '', schemaName))
      .filter((object) => !kinds || kinds.has(object.kind))
      .filter((object) => !query || `${object.name} ${objectPath(object)}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => objectPath(left).localeCompare(objectPath(right)))
    const tables = matches.slice(0, limit).map((object) => ({
      databaseName: object.databaseName,
      ...(object.schemaName ? { schemaName: object.schemaName } : {}),
      name: object.name,
      kind: object.kind,
      path: objectPath(object),
      columnCount: object.table?.columns.length ?? 0,
      primaryKey: object.table?.primaryKey.slice() ?? []
    }))
    return ok({ tables, count: tables.length, totalMatched: matches.length, truncated: tables.length < matches.length })
  }

  const searchObjects = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const kinds = normalizeKinds(params.kinds)
    if (kinds && (!Array.isArray(params.kinds) || kinds.size !== params.kinds.length)) {
      return fail('DB_MCP_OBJECT_KINDS_INVALID', 'kinds contains an unsupported database object kind.')
    }
    const query = cleanText(params.query).toLocaleLowerCase()
    const databaseName = cleanText(params.databaseName)
    const schemaName = cleanText(params.schemaName)
    const limit = positiveInteger(params.limit, 100, MAX_OBJECT_RESULTS)
    const matches = databaseObjectsForConnection(resolved.connection)
      .filter((object) => !databaseName || sameName(object.databaseName, databaseName))
      .filter((object) => !schemaName || sameName(object.schemaName || '', schemaName))
      .filter((object) => !kinds || kinds.has(object.kind))
      .filter((object) => {
        if (!query) return true
        const columnNames = object.table?.columns.map((column) => column.name).join(' ') || ''
        return `${objectPath(object)} ${object.kind} ${columnNames}`.toLocaleLowerCase().includes(query)
      })
      .sort((left, right) => objectPath(left).localeCompare(objectPath(right)))
    const objects = matches.slice(0, limit).map((object) => publicObject(object, connectionHandleFor))
    return ok({ objects, count: objects.length, totalMatched: matches.length, truncated: matches.length > objects.length })
  }

  const describeTable = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const table = resolveTable(resolved.connection, params)
    if (table.result || !table.object) return table.result as DatabaseMcpToolResult
    return ok({ table: publicTable(table.object, connectionHandleFor) })
  }

  const getTableDdl = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const openError = connectionMustBeOpen(resolved.connection)
    if (openError) return openError
    const table = resolveTable(resolved.connection, params)
    if (table.result || !table.object) return table.result as DatabaseMcpToolResult
    const connection = resolved.connection
    const object = table.object
    const read = await runDatabaseRead((readOptions) => dependencies.getTableDdl({
        connectionId: connection.id,
        dbType: connection.dbType,
        databaseName: object.databaseName,
        ...(object.schemaName ? { schemaName: object.schemaName } : {}),
        tableName: object.name
      }, readOptions), { errorCode: 'DB_MCP_DDL_FAILED', errorMessage: 'Database table DDL could not be loaded.' }, options.signal)
    if (read.error || !read.value) return read.error as DatabaseMcpToolResult
    const result = read.value
    if (!result.ok || !result.data) return fail(safeDependencyErrorCode(result.errorCode, 'DB_MCP_DDL_FAILED'), 'Database table DDL could not be loaded.')
    const rawDdl = String(result.data.ddl || '')
    const redactedDdl = sanitizeDatabaseMcpDdl(rawDdl, [
      connection.host,
      connection.user,
      connection.url || '',
      connection.filePath || '',
      connection.proxyName || ''
    ])
    const boundedDdl = boundedUtf8Text(redactedDdl, MAX_DDL_BYTES)
    return ok({
      table: publicObject(object, connectionHandleFor),
      ddl: boundedDdl.value,
      ddlBytes: boundedDdl.bytes,
      redacted: true,
      truncated: boundedDdl.truncated || rawDdl.length > MAX_DDL_SOURCE_CHARS
    })
  }

  const queryTable = async (
    params: Record<string, unknown>,
    options: DatabaseMcpToolCallOptions,
    execution: { withTotal?: boolean; maxPageSize?: number } = {}
  ) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const openError = connectionMustBeOpen(resolved.connection)
    if (openError) return openError
    const table = resolveTable(resolved.connection, params)
    if (table.result || !table.object) return table.result as DatabaseMcpToolResult
    const connection = resolved.connection
    const object = table.object
    const tableInfo = object.table
    if (!tableInfo) return fail('DB_MCP_TABLE_METADATA_UNAVAILABLE', 'Database table metadata is unavailable.')
    if (object.kind !== 'table') return fail('DB_MCP_VIEW_QUERY_UNSUPPORTED', 'Database MCP queries are limited to base tables.')
    const selectedColumns = normalizeSelectedColumns(params.columns, tableInfo)
    if (selectedColumns.result) return selectedColumns.result
    const boundedTableInfo = {
      ...tableInfo,
      columns: tableInfo.columns.filter((column) => !isPotentiallyUnboundedColumnType(column.type))
    }
    const filters = normalizeFilters(params.filters, boundedTableInfo)
    if (filters.result) return filters.result
    const sort = normalizeSort(params.sort, boundedTableInfo)
    if (sort.result) return sort.result
    const page = positiveInteger(params.page, 1, MAX_QUERY_PAGE)
    const pageSize = positiveInteger(params.pageSize, 50, execution.maxPageSize ?? MAX_QUERY_PAGE_SIZE)
    const read = await runDatabaseRead((readOptions) => dependencies.queryTable({
        connectionId: connection.id,
        dbType: connection.dbType,
        databaseName: object.databaseName,
        ...(object.schemaName ? { schemaName: object.schemaName } : {}),
        tableName: object.name,
        columns: selectedColumns.columns,
        filters: filters.filters,
        sort: sort.sort,
        whereRaw: null,
        orderByRaw: null,
        page,
        pageSize,
        withTotal: execution.withTotal === true,
        requireStableBaseTable: true
      }, readOptions), { errorCode: 'DB_MCP_QUERY_FAILED', errorMessage: 'Database table query failed.' }, options.signal)
    if (read.error || !read.value) return read.error as DatabaseMcpToolResult
    const result = read.value
    if (!result.ok || !result.data) return fail(safeDependencyErrorCode(result.errorCode, 'DB_MCP_QUERY_FAILED'), 'Database table query failed.')
    const sourceRows = result.data.rows
    const pageRows = sourceRows.slice(0, pageSize)
    const bounded = boundedRows(projectRowsToColumns(pageRows, selectedColumns.columns), pageSize)
    return ok({
      table: publicObject(object, connectionHandleFor),
      columns: selectedColumns.columns,
      omittedColumns: selectedColumns.omittedColumns,
      rows: bounded.rows,
      rowCount: bounded.rows.length,
      sourceRowCount: result.data.rowCount,
      total: result.data.total,
      page,
      pageSize,
      durationMs: result.data.durationMs,
      resultBytes: bounded.bytes,
      truncated: bounded.truncated || pageRows.length < sourceRows.length
    })
  }

  const sampleRows = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const limit = positiveInteger(params.limit, 5, MAX_SAMPLE_ROWS)
    const { limit: _limit, ...queryParams } = params
    const result = await queryTable({ ...queryParams, page: 1, pageSize: limit }, options, { maxPageSize: MAX_SAMPLE_ROWS })
    if (!result.ok || !result.data) return result
    return ok({
      table: result.data.table,
      columns: result.data.columns,
      omittedColumns: result.data.omittedColumns,
      rows: result.data.rows,
      rowCount: result.data.rowCount,
      limit,
      durationMs: result.data.durationMs,
      resultBytes: result.data.resultBytes,
      truncated: result.data.truncated
    })
  }

  const countRows = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const result = await queryTable({ ...params, page: 1, pageSize: 1 }, options, { withTotal: true, maxPageSize: 1 })
    if (!result.ok || !result.data) return result
    const total = result.data.total
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
      return fail('DB_MCP_COUNT_UNSUPPORTED', 'This database engine did not return a safe exact row count.')
    }
    return ok({
      table: result.data.table,
      count: total,
      durationMs: result.data.durationMs
    })
  }

  const inspectIndexes = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const openError = connectionMustBeOpen(resolved.connection)
    if (openError) return openError
    const table = resolveTable(resolved.connection, params)
    if (table.result || !table.object) return table.result as DatabaseMcpToolResult
    if (table.object.kind !== 'table') return fail('DB_MCP_VIEW_INDEX_UNSUPPORTED', 'Index inspection is limited to base tables.')
    const inspectTableIndexes = dependencies.inspectTableIndexes
    if (!inspectTableIndexes) {
      return fail('DB_MCP_INDEX_INSPECTION_UNSUPPORTED', 'This database engine does not provide a safe structured index inspection adapter.')
    }
    const connection = resolved.connection
    const object = table.object
    const read = await runDatabaseRead((readOptions) => inspectTableIndexes({
      connectionId: connection.id,
      dbType: connection.dbType,
      databaseName: object.databaseName,
      ...(object.schemaName ? { schemaName: object.schemaName } : {}),
      tableName: object.name
    }, readOptions), { errorCode: 'DB_MCP_INDEX_INSPECTION_FAILED', errorMessage: 'Database index metadata could not be loaded.' }, options.signal)
    if (read.error || !read.value) return read.error as DatabaseMcpToolResult
    const result = read.value
    if (!result.ok || !result.data) {
      return fail(safeDependencyErrorCode(result.errorCode, 'DB_MCP_INDEX_INSPECTION_FAILED'), 'Database index metadata could not be loaded.')
    }
    if (!Array.isArray(result.data.indexes)) {
      return fail('DB_MCP_INDEX_RESULT_INVALID', 'The database index adapter returned an invalid result.')
    }
    const knownColumns = new Map((object.table?.columns ?? []).map((column) => [column.name.toLocaleLowerCase(), column.name]))
    const indexes = [] as Array<{ name: string; columns: string[]; unique: boolean; primary: boolean; method?: string }>
    for (const rawIndex of result.data.indexes.slice(0, MAX_INDEX_RESULTS)) {
      const name = sanitizeDatabaseMcpSensitiveText(rawIndex?.name, [connection.host, connection.user]).slice(0, 256)
      const columns = Array.isArray(rawIndex?.columns)
        ? rawIndex.columns.map((column) => knownColumns.get(cleanText(column).toLocaleLowerCase())).filter((column): column is string => Boolean(column))
        : []
      if (!name || !Array.isArray(rawIndex?.columns) || columns.length !== rawIndex.columns.length || !columns.length) {
        return fail('DB_MCP_INDEX_RESULT_INVALID', 'The database index adapter returned an invalid result.')
      }
      const method = cleanText(rawIndex.method)
      indexes.push({
        name,
        columns,
        unique: rawIndex.unique === true,
        primary: rawIndex.primary === true,
        ...(method ? { method: sanitizeDatabaseMcpSensitiveText(method).slice(0, 128) } : {})
      })
    }
    return ok({
      table: publicObject(object, connectionHandleFor),
      indexes,
      count: indexes.length,
      totalMatched: result.data.indexes.length,
      durationMs: Math.max(0, Math.floor(Number(result.data.durationMs) || 0)),
      truncated: result.data.indexes.length > indexes.length
    })
  }

  const explainPlan = async (params: Record<string, unknown>, options: DatabaseMcpToolCallOptions) => {
    const resolved = await resolveRuntimeConnection(params.connectionId, options)
    if (resolved.result || !resolved.connection) return resolved.result as DatabaseMcpToolResult
    const openError = connectionMustBeOpen(resolved.connection)
    if (openError) return openError
    const table = resolveTable(resolved.connection, params)
    if (table.result || !table.object) return table.result as DatabaseMcpToolResult
    const connection = resolved.connection
    const object = table.object
    if (object.kind !== 'table' || !object.table) return fail('DB_MCP_VIEW_EXPLAIN_UNSUPPORTED', 'Explain plans are limited to base tables.')
    const explainTable = dependencies.explainTable
    if (!explainTable) {
      return fail('DB_MCP_EXPLAIN_UNSUPPORTED', 'This database engine does not provide a safe structured explain adapter.')
    }
    const selectedColumns = normalizeSelectedColumns(params.columns, object.table)
    if (selectedColumns.result) return selectedColumns.result
    const boundedTableInfo = {
      ...object.table,
      columns: object.table.columns.filter((column) => !isPotentiallyUnboundedColumnType(column.type))
    }
    const filters = normalizeFilters(params.filters, boundedTableInfo)
    if (filters.result) return filters.result
    const sort = normalizeSort(params.sort, boundedTableInfo)
    if (sort.result) return sort.result
    const read = await runDatabaseRead((readOptions) => explainTable({
      connectionId: connection.id,
      dbType: connection.dbType,
      databaseName: object.databaseName,
      ...(object.schemaName ? { schemaName: object.schemaName } : {}),
      tableName: object.name,
      columns: selectedColumns.columns,
      filters: filters.filters,
      sort: sort.sort
    }, readOptions), { errorCode: 'DB_MCP_EXPLAIN_FAILED', errorMessage: 'Database explain plan could not be loaded.' }, options.signal)
    if (read.error || !read.value) return read.error as DatabaseMcpToolResult
    const result = read.value
    if (!result.ok || !result.data || result.data.format !== 'text') {
      return fail(safeDependencyErrorCode(result.errorCode, 'DB_MCP_EXPLAIN_FAILED'), 'Database explain plan could not be loaded.')
    }
    const rawPlan = String(result.data.plan || '')
    if (!rawPlan) return fail('DB_MCP_EXPLAIN_RESULT_INVALID', 'The database explain adapter returned an invalid result.')
    const sanitized = sanitizeDatabaseMcpSensitiveText(rawPlan, [
      connection.host,
      connection.user,
      connection.url || '',
      connection.filePath || '',
      connection.proxyName || ''
    ])
    const boundedPlan = boundedUtf8Text(sanitized, MAX_EXPLAIN_PLAN_BYTES)
    return ok({
      table: publicObject(object, connectionHandleFor),
      format: 'text',
      plan: boundedPlan.value,
      planBytes: boundedPlan.bytes,
      durationMs: Math.max(0, Math.floor(Number(result.data.durationMs) || 0)),
      redacted: true,
      truncated: boundedPlan.truncated || rawPlan.length > MAX_SENSITIVE_TEXT_CHARS
    })
  }

  return {
    definitions: DATABASE_MCP_TOOL_DEFINITIONS,
    async callTool(
      name: string,
      args: Record<string, unknown> = {},
      options: DatabaseMcpToolCallOptions = {}
    ): Promise<DatabaseMcpToolResult | null> {
      if (!isDatabaseMcpToolName(name)) return null
      if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('DB_MCP_ARGUMENTS_INVALID', 'Tool arguments must be a JSON object.')
      try {
        if (name === 'list_database_connections') return await listConnections(args)
        if (name === 'list_databases') return await listDatabases(args, options)
        if (name === 'list_schemas') return await listSchemas(args, options)
        if (name === 'list_tables') return await listTables(args, options)
        if (name === 'search_database_objects') return await searchObjects(args, options)
        if (name === 'describe_database_table') return await describeTable(args, options)
        if (name === 'get_database_table_ddl') return await getTableDdl(args, options)
        if (name === 'query_database_table') return await queryTable(args, options)
        if (name === 'sample_rows') return await sampleRows(args, options)
        if (name === 'count_rows') return await countRows(args, options)
        if (name === 'inspect_indexes') return await inspectIndexes(args, options)
        return await explainPlan(args, options)
      } catch {
        return fail('DB_MCP_TOOL_FAILED', 'Database MCP tool failed.')
      }
    }
  }
}
