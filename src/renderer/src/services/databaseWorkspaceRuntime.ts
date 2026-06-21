import type {
  DatabaseAiDrawerAction,
  DatabaseAiTargetDialect,
  DatabaseCatalogInfo,
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabaseGroupInfo,
  DatabasePageCommentKey,
  DatabaseTableDdlResult,
  DatabaseTableInfo
} from '@shared/contracts/database'

export type DatabaseChartSource = {
  title: string
  scopeLabel: string
  columns: string[]
  rows: Array<Record<string, unknown>>
}

export type DatabaseChartBar = {
  label: string
  value: number
  width: number
}

export type DatabaseChartSummary = {
  title: string
  scopeLabel: string
  categoryColumn: string
  valueColumn: string
  rowCount: number
  bars: DatabaseChartBar[]
  numericColumns: string[]
}

export type SchemaObjectKind = 'tables' | 'views' | 'functions' | 'procedures'
export type SchemaObjectFolder = { kind: SchemaObjectKind; count: number; tables: DatabaseTableInfo[]; routines: string[] }
export type VisibleGroupNode = DatabaseGroupInfo & { depth: number }
export type TableDdlResult = { ok: true; ddl: string } | { ok: false; errorCode: string; errorMessage: string }

export type DatabaseConnectionUrlDraft = Pick<DatabaseConnectionInfo, 'dbType'> & {
  host?: string
  port?: number | null
  database?: string
  filePath?: string
}

export const DB_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const DEFAULT_GROUP_ID = 'group-default'
export const DB_AI_PANE_DEFAULT_WIDTH = 360
export const DB_AI_PANE_MIN_WIDTH = 280
export const DB_AI_PANE_MAX_WIDTH = 720

export const DB_AI_ACTIONS: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
export const DB_AI_TARGET_DIALECTS: DatabaseAiTargetDialect[] = ['mysql', 'postgresql', 'sqlite', 'oracle', 'mssql', 'clickhouse', 'presto']
export const DB_ENGINE_CODES: DatabaseEngineCode[] = ['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlite', 'oracle', 'sqlserver', 'clickhouse', 'presto']
export const DB_ENGINE_OPTION_CODES = [
  'mysql',
  'h2',
  'oracle',
  'postgresql',
  'sqlserver',
  'sqlite',
  'mariadb',
  'clickhouse',
  'dm',
  'presto',
  'db2',
  'oceanbase',
  'hive',
  'kingbase',
  'mongodb',
  'timeplus'
] as const

export const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'
export const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'postgresql' || dbType === 'kingbase'

export const connectionSchemeForDbType = (dbType: DatabaseEngineCode) =>
  dbType === 'postgresql'
    ? 'jdbc:postgresql'
    : dbType === 'kingbase'
      ? 'jdbc:kingbase8'
      : dbType === 'sqlserver'
        ? 'jdbc:sqlserver'
        : dbType === 'clickhouse' || dbType === 'presto'
          ? 'http'
          : dbType === 'mariadb'
            ? 'jdbc:mariadb'
            : dbType === 'oceanbase'
              ? 'jdbc:oceanbase'
              : 'jdbc:mysql'

export function buildConnectionUrl(draft: DatabaseConnectionUrlDraft) {
  if (draft.dbType === 'sqlite') return draft.filePath ? `sqlite://${draft.filePath}` : 'sqlite://'
  const host = draft.host || ''
  const port = draft.port ? `:${draft.port}` : ''
  const database = draft.database ? `/${draft.database}` : ''
  if (draft.dbType === 'oracle') return `${host}${port}${database}`
  const scheme = connectionSchemeForDbType(draft.dbType)
  if (draft.dbType === 'clickhouse' || draft.dbType === 'presto') return `${scheme}://${host}${port}`
  return `${scheme}://${host}${port}${database}`
}

export function sqlConnectionRequiresSchema(connection: Pick<DatabaseConnectionInfo, 'dbType'>) {
  return isPostgresCompatibleDbType(connection.dbType) || connection.dbType === 'oracle' || connection.dbType === 'sqlserver' || connection.dbType === 'presto'
}

export function defaultSchemaForSqlConnection(connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined) {
  if (!connection || !catalog || !sqlConnectionRequiresSchema(connection)) return ''
  if (!catalog.schemas?.length) return ''
  return catalog.schemas.find((schema) => schema.name === 'public')?.name ?? catalog.schemas[0]?.name ?? ''
}

export function renderCreateDatabaseTemplate(
  name: string,
  dbType: Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'sqlserver' | 'clickhouse'>
) {
  const trimmed = name.trim()
  return trimmed ? `CREATE DATABASE ${quoteIdentForDialect(trimmed, dbType)};` : ''
}

export function parseCreateDatabaseName(sql: string) {
  const match = sql.match(/\bcreate\s+database\s+(?:if\s+not\s+exists\s+)?(`(?:``|[^`])+`|"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_]*)/i)
  if (!match) return ''
  const token = match[1]
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  return token
}

export function toggleId(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

export function flattenVisibleGroups(sourceGroups: DatabaseGroupInfo[], groupParentById: Record<string, string | null>): VisibleGroupNode[] {
  const sourceIds = new Set(sourceGroups.map((group) => group.id))
  const byParent = new Map<string | null, DatabaseGroupInfo[]>()
  sourceGroups.forEach((group) => {
    const parentId = groupParentById[group.id] ?? null
    const visibleParent = parentId && sourceIds.has(parentId) ? parentId : null
    const list = byParent.get(visibleParent) ?? []
    list.push(group)
    byParent.set(visibleParent, list)
  })
  const out: VisibleGroupNode[] = []
  const visit = (parentId: string | null, depth: number) => {
    ;(byParent.get(parentId) ?? []).forEach((group) => {
      out.push({ ...group, depth })
      visit(group.id, depth + 1)
    })
  }
  visit(null, 0)
  return out
}

export function groupPathLabel(groupId: string, groups: DatabaseGroupInfo[], groupParentById: Record<string, string | null>) {
  const seen = new Set<string>()
  const names: string[] = []
  let currentId: string | null = groupId
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const group = groups.find((item) => item.id === currentId)
    if (!group) break
    names.unshift(group.name)
    currentId = groupParentById[currentId] ?? null
  }
  return names.join(' / ') || 'Root Group'
}

export function collectDescendantGroupIds(groupId: string, groups: DatabaseGroupInfo[], groupParentById: Record<string, string | null>) {
  const out = new Set<string>()
  const visit = (parentId: string) => {
    groups.forEach((group) => {
      if ((groupParentById[group.id] ?? null) === parentId) {
        out.add(group.id)
        visit(group.id)
      }
    })
  }
  visit(groupId)
  return out
}

export function connectionText(connection: DatabaseConnectionInfo) {
  return [connection.name, connection.dbType, connection.host, connection.database, ...connection.catalogs.map((catalog) => catalog.name)].join(' ').toLowerCase()
}

export function columnNodeId(tableId: string, columnName: string) {
  return `${tableId}:column:${columnName}`
}

export function schemaObjectFolderKey(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind) {
  return `${connectionId}:${catalogName}:${schemaName}:${kind}`
}

export function schemaRoutineNodeId(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind, routine: string) {
  return `${schemaObjectFolderKey(connectionId, catalogName, schemaName, kind)}:${routine}`
}

export function schemaObjectFolders(schema: { tables: DatabaseTableInfo[]; views?: DatabaseTableInfo[]; functions?: string[]; procedures?: string[] }): SchemaObjectFolder[] {
  return [
    { kind: 'tables', count: schema.tables.length, tables: schema.tables, routines: [] },
    { kind: 'views', count: schema.views?.length ?? 0, tables: schema.views ?? [], routines: [] },
    { kind: 'functions', count: schema.functions?.length ?? 0, tables: [], routines: schema.functions ?? [] },
    { kind: 'procedures', count: schema.procedures?.length ?? 0, tables: [], routines: schema.procedures ?? [] }
  ]
}

export function buildQualifiedTableReference(dbType: DatabaseEngineCode, catalogName: string, schemaName: string | undefined, tableName: string) {
  const quotedTable = quoteSqlIdentifierForDialect(tableName, dbType)
  if (dbType === 'presto' && catalogName && schemaName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quoteSqlIdentifierForDialect(schemaName, dbType)}.${quotedTable}`
  }
  if (dbType === 'clickhouse' && catalogName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quotedTable}`
  }
  if ((isPostgresCompatibleDbType(dbType) || dbType === 'oracle' || dbType === 'sqlserver') && schemaName) {
    return `${quoteSqlIdentifierForDialect(schemaName, dbType)}.${quotedTable}`
  }
  if (dbType === 'sqlite' && catalogName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quotedTable}`
  }
  return quotedTable
}

export function quoteSqlIdentifierForDialect(value: string, dbType: DatabaseEngineCode) {
  if (isMysqlCompatibleDbType(dbType) || dbType === 'clickhouse') return `\`${String(value).replace(/`/g, '``')}\``
  if (dbType === 'sqlserver') return `[${String(value).replace(/]/g, ']]')}]`
  return `"${String(value).replace(/"/g, '""')}"`
}

export function quoteIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9_]/g, '_')
}

export function quoteIdentForDialect(value: string, dbType: DatabaseEngineCode) {
  return quoteSqlIdentifierForDialect(value, dbType)
}

export function databasePageCommentKeyId(key: DatabasePageCommentKey) {
  return [
    key.scope,
    key.connectionId,
    key.databaseName,
    key.schemaName || '',
    key.tableName || '',
    key.resultId || '',
    key.sql || ''
  ].join('\u001f')
}

export function labelForChartValue(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function numberForChartValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function buildChartSummary(source: DatabaseChartSource): DatabaseChartSummary | null {
  const rows = source.rows.filter((row) => row && typeof row === 'object')
  const numericColumns = source.columns.filter((column) => rows.some((row) => numberForChartValue(row[column]) !== null))
  const valueColumn = numericColumns[0]
  if (!valueColumn) return null
  const categoryColumn = source.columns.find((column) => column !== valueColumn && rows.some((row) => row[column] !== null && row[column] !== undefined && row[column] !== '')) || valueColumn
  const grouped = new Map<string, number>()
  rows.forEach((row, index) => {
    const numeric = numberForChartValue(row[valueColumn])
    if (numeric === null) return
    const label = labelForChartValue(row[categoryColumn], `Row ${index + 1}`)
    grouped.set(label, (grouped.get(label) || 0) + numeric)
  })
  const sorted = [...grouped.entries()].sort((first, second) => Math.abs(second[1]) - Math.abs(first[1])).slice(0, 12)
  if (!sorted.length) return null
  const max = Math.max(...sorted.map(([, value]) => Math.abs(value)), 1)
  return {
    title: source.title,
    scopeLabel: source.scopeLabel,
    categoryColumn,
    valueColumn,
    rowCount: rows.length,
    bars: sorted.map(([label, value]) => ({ label, value, width: Math.max(4, Math.round((Math.abs(value) / max) * 100)) })),
    numericColumns
  }
}

export function formatChartNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function formatCommentTime(value: number) {
  if (!value) return ''
  return new Date(value).toLocaleString()
}

export function normalizeTableDdlResult(result: DatabaseTableDdlResult): TableDdlResult {
  if (result.ok) {
    const ddl = typeof result.data?.ddl === 'string' ? result.data.ddl : ''
    if (!ddl.trim()) return { ok: false, errorCode: 'other', errorMessage: 'Database DDL backend returned malformed result data.' }
    return { ok: true, ddl }
  }
  return { ok: false, errorCode: result.errorCode || 'other', errorMessage: result.errorMessage || 'DDL fetch failed.' }
}

export function formatDdlError(result: Extract<TableDdlResult, { ok: false }>) {
  if (result.errorCode === 'permission') return `DDL permission denied: ${result.errorMessage}`
  return `DDL fetch failed: ${result.errorMessage}`
}
