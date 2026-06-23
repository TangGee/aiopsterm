import type {
  DatabaseCatalogInfo,
  DatabaseColumnFilter,
  DatabaseColumnInfo,
  DatabaseColumnSort,
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseSqlExecuteResult,
  DatabaseTableMutationInput,
  DatabaseWorkspaceCatalog
} from './contracts/database'

export type DatabaseFetch = typeof fetch

export type DatabaseSqlExecuteRawData = Omit<NonNullable<DatabaseSqlExecuteResult['data']>, 'execution'>

export type DatabaseSqlExecuteRawResult = {
  ok: boolean
  data?: DatabaseSqlExecuteRawData
  errorCode?: string
  errorMessage?: string
}

export type DatabaseRowMutation = Extract<DatabaseTableMutationInput['mutations'][number], { kind: 'delete' | 'update' }>

export type DatabaseHttpEngineRuntime = {
  fetch?: DatabaseFetch
  connectionInputFromSaved: (connection: DatabaseConnectionInfo) => DatabaseConnectionTestInput
  refreshConnectionCatalog: (connectionId: string, loadCatalogs: (connection: DatabaseConnectionInfo) => Promise<DatabaseCatalogInfo[]>) => Promise<void>
  workspaceCatalogFor: (selectedConnectionId?: string) => DatabaseWorkspaceCatalog | undefined
}

let runtime: DatabaseHttpEngineRuntime | null = null

export function configureDatabaseHttpEngines(config: DatabaseHttpEngineRuntime) {
  runtime = config
}

export const configuredDatabaseHttpRuntime = () => {
  if (!runtime) throw new Error('Database HTTP engine runtime has not been configured.')
  return runtime
}

export const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const normalizedDatabasePort = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

export const normalizeQueryRows = (rows: unknown): Array<Record<string, unknown>> =>
  Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }))
    : []

export const columnsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {})

export const rowValue = (row: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
  }
  const lower = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(lower, name.toLowerCase())) return lower[name.toLowerCase()]
  }
  return undefined
}

export const databaseColumnId = (connectionId: string, tableName: string) => `tbl-${connectionId}-${tableName.replace(/[^A-Za-z0-9_-]+/g, '-')}`

export const primaryKeyForColumns = (columns: DatabaseColumnInfo[]) => columns.filter((column) => column.key === 'PK').map((column) => column.name)

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

const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
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

export const loadDatabaseHttpFetch = () => {
  const runtimeConfig = configuredDatabaseHttpRuntime()
  if (runtimeConfig.fetch) return runtimeConfig.fetch
  const runtimeFetch = globalThis.fetch
  return typeof runtimeFetch === 'function' ? (runtimeFetch.bind(globalThis) as DatabaseFetch) : null
}
