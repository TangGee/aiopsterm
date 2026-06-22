import type {
  DatabaseAiDrawerAction,
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneResponseInput,
  DatabaseAiTargetDialect,
  DatabaseEngineCode
} from './contracts/database'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const supportedEngines = new Set<string>(['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlite', 'oracle', 'sqlserver', 'clickhouse', 'presto'])

export type DatabaseAiTableContext = {
  connectionId: string
  databaseName?: string
  schemaName?: string
  tableName?: string
}

export type DatabaseAiTableMetadataRuntime = {
  tableKeysForContext: (input: Omit<DatabaseAiTableContext, 'tableName'>) => string[]
  tableKeyForContext: (input: DatabaseAiTableContext) => string
  columnsForTableKey: (key: string) => string[]
}

export const isSupportedDatabaseAiEngine = (dbType: string) => supportedEngines.has(dbType)

const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'
const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'postgresql' || dbType === 'kingbase'

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

const schemaNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?)\s*\.\s*([`"\[]?[\w.-]+[`"\]]?)/i)
  return match ? unquoteIdentifier(match[1].trim()) : ''
}

const keyParts = (key: string) => {
  const [connectionId, databaseName, schemaName, tableName] = key.split(':')
  return { connectionId, databaseName, schemaName, tableName }
}

const tableKeysForContext = (metadata: DatabaseAiTableMetadataRuntime, input: { connectionId: string; databaseName?: string; schemaName?: string }) =>
  metadata.tableKeysForContext(input).slice().sort()

const firstTableKeyForContext = (metadata: DatabaseAiTableMetadataRuntime, input: { connectionId: string; databaseName?: string; schemaName?: string }) =>
  tableKeysForContext(metadata, input)[0] || ''

const quoteIdentifier = (value: string, dbType: DatabaseEngineCode) => {
  const raw = String(value || '')
  if (isMysqlCompatibleDbType(dbType)) return `\`${raw.replace(/`/g, '``')}\``
  if (dbType === 'sqlserver') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

const qualifiedTableReference = (input: { dbType?: DatabaseEngineCode | ''; databaseName?: string; schemaName?: string; tableName: string }) => {
  const dbType = input.dbType && supportedEngines.has(input.dbType) ? input.dbType : 'postgresql'
  const table = quoteIdentifier(input.tableName, dbType)
  if (dbType === 'presto' && input.databaseName && input.schemaName) {
    return `${quoteIdentifier(input.databaseName, dbType)}.${quoteIdentifier(input.schemaName, dbType)}.${table}`
  }
  if ((isPostgresCompatibleDbType(dbType) || dbType === 'oracle' || dbType === 'sqlserver') && input.schemaName) return `${quoteIdentifier(input.schemaName, dbType)}.${table}`
  if (dbType === 'sqlite' && input.databaseName) return `${quoteIdentifier(input.databaseName, dbType)}.${table}`
  return table
}

export const suggestedDatabaseAiReadOnlySqlForContext = (
  input: DatabaseAiPaneResponseInput,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const key = firstTableKeyForContext(metadata, {
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

export const databaseAiPaneSchemaSummaryForContext = (
  input: DatabaseAiPaneResponseInput,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const keys = tableKeysForContext(metadata, {
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  if (!keys.length) return ['- No table metadata is available behind the local DB AI backend boundary.']
  const grouped = new Map<string, string[]>()
  keys.forEach((key) => {
    const parts = keyParts(key)
    const group = parts.schemaName || parts.databaseName || 'default'
    const columns = metadata.columnsForTableKey(key)
    const label = `${parts.tableName}(${columns.length} columns)`
    grouped.set(group, [...(grouped.get(group) ?? []), label])
  })
  return [...grouped.entries()].map(([group, tables]) => `- ${group}: ${tables.slice(0, 5).join(', ')}`)
}

export const databaseAiFirstTableNameForPaneContext = (
  input: DatabaseAiPaneResponseInput,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const key = firstTableKeyForContext(metadata, {
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  return key ? keyParts(key).tableName : ''
}

export const databaseAiProviderSchemaSummaryForContext = (
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context'],
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const connectionId = trim(context.connectionId)
  const databaseName = trim(context.databaseName)
  const schemaName = trim(context.schemaName)
  if (!connectionId || !databaseName) return ['- No backend schema metadata is available for this request context.']
  const keys = tableKeysForContext(metadata, { connectionId, databaseName, schemaName })
  if (!keys.length) return ['- No backend schema metadata is available for this request context.']
  return keys.slice(0, 16).map((key) => {
    const parts = keyParts(key)
    const columns = metadata.columnsForTableKey(key)
    const qualified = [parts.databaseName, parts.schemaName, parts.tableName].filter(Boolean).join('.')
    return `- ${qualified}: ${columns.slice(0, 12).join(', ')}`
  })
}

const drawerDbType = (input: DatabaseAiDrawerResponseInput) =>
  input.context.dbType && supportedEngines.has(input.context.dbType) ? input.context.dbType : 'postgresql'

export const normalizeDatabaseAiTargetDialect = (dialect: DatabaseAiTargetDialect | '' | undefined): DatabaseAiTargetDialect =>
  dialect === 'sqlserver'
    ? 'mssql'
    : dialect === 'mariadb' || dialect === 'oceanbase'
      ? 'mysql'
      : dialect === 'kingbase'
        ? 'postgresql'
        : dialect || 'postgresql'

export const databaseAiDrawerTargetDialect = (input: DatabaseAiDrawerResponseInput): DatabaseAiTargetDialect =>
  normalizeDatabaseAiTargetDialect(input.targetDialect || drawerDbType(input))

const quoteDrawerIdentifier = (value: string, dialect: DatabaseAiTargetDialect) => {
  const raw = String(value || '').replace(/^[`"\[]|[`"\]]$/g, '')
  if (isMysqlCompatibleDbType(dialect) || dialect === 'clickhouse') return `\`${raw.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

export const databaseAiDialectLabel = (dialect: DatabaseAiTargetDialect) => {
  if (dialect === 'postgresql') return 'PostgreSQL'
  if (dialect === 'mysql') return 'MySQL'
  if (dialect === 'mariadb') return 'MariaDB'
  if (dialect === 'oceanbase') return 'OceanBase'
  if (dialect === 'kingbase') return 'KingBase'
  if (dialect === 'sqlite') return 'SQLite'
  if (dialect === 'oracle') return 'Oracle'
  if (dialect === 'clickhouse') return 'ClickHouse'
  if (dialect === 'presto') return 'Presto'
  if (dialect === 'mssql' || dialect === 'sqlserver') return 'SQL Server'
  return dialect
}

export const databaseAiDrawerActionName = (action: DatabaseAiDrawerAction) => {
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

const drawerTableReference = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const explicitTable = trim(input.context.tableName) || tableNameFromSql(input.sourceSql)
  const connectionId = trim(input.context.connectionId)
  const databaseName = trim(input.context.databaseName)
  const schemaName = trim(input.context.schemaName) || schemaNameFromSql(input.sourceSql)
  const key = explicitTable
    ? metadata.tableKeyForContext({ connectionId, databaseName, schemaName, tableName: explicitTable })
    : firstTableKeyForContext(metadata, { connectionId, databaseName, schemaName })
  const parts = key ? keyParts(key) : { databaseName, schemaName, tableName: explicitTable || 'orders' }
  if (dialect === 'presto' && parts.databaseName && parts.schemaName) {
    return `${quoteDrawerIdentifier(parts.databaseName, dialect)}.${quoteDrawerIdentifier(parts.schemaName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  }
  if ((isPostgresCompatibleDbType(dialect) || dialect === 'oracle' || dialect === 'mssql' || dialect === 'sqlserver') && parts.schemaName) {
    return `${quoteDrawerIdentifier(parts.schemaName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  }
  if (dialect === 'clickhouse' && parts.databaseName) return `${quoteDrawerIdentifier(parts.databaseName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  if (dialect === 'sqlite' && parts.databaseName) return `${quoteDrawerIdentifier(parts.databaseName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  return quoteDrawerIdentifier(parts.tableName, dialect)
}

const buildDrawerNl2Sql = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const tableRef = drawerTableReference(input, dialect, metadata)
  if (dialect === 'oracle') {
    return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nFETCH FIRST 20 ROWS ONLY;`
  }
  if (dialect === 'mssql' || dialect === 'sqlserver') {
    return `SELECT TOP (20) id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC;`
  }
  return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nLIMIT 20;`
}

const completeDrawerSql = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const fallback = `SELECT *\nFROM ${drawerTableReference(input, dialect, metadata)}`
  const base = stripSqlTerminator(input.sourceSql.trim() || fallback)
  let completed = base
  if (/\bwhere\s*$/i.test(completed)) {
    completed = `${completed} status = 'open'`
  } else if (!/\bwhere\b/i.test(completed) && /^\s*(select|with)\b/i.test(completed)) {
    completed = `${completed}\nWHERE status = 'open'`
  }
  return addDialectLimit(completed, dialect, 100)
}

const optimizeDrawerSql = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const fallback = `SELECT id, service, status, owner, updated_at\nFROM ${drawerTableReference(input, dialect, metadata)}`
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

const diagnoseDrawerSql = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  const tableRef = drawerTableReference(input, dialect, metadata)
  if (dialect === 'oracle') return `SELECT *\nFROM ${tableRef}\nFETCH FIRST 100 ROWS ONLY;`
  if (dialect === 'mssql' || dialect === 'sqlserver') return `SELECT TOP (100) *\nFROM ${tableRef};`
  return `SELECT *\nFROM ${tableRef}\nLIMIT 100;`
}

export const buildDatabaseAiDrawerGeneratedSql = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) => {
  if (input.action === 'convert') return convertDrawerSqlToDialect(input, dialect)
  if (input.action === 'diagnose') return diagnoseDrawerSql(input, dialect, metadata)
  if (input.action === 'nl2sql') return buildDrawerNl2Sql(input, dialect, metadata)
  if (input.action === 'complete') return completeDrawerSql(input, dialect, metadata)
  if (input.action === 'optimize') return optimizeDrawerSql(input, dialect, metadata)
  return ensureSqlTerminated(input.sourceSql.trim() || 'SELECT 1')
}

const isExecutableDrawerDialect = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action !== 'convert') return true
  if (dialect === 'mssql') return drawerDbType(input) === 'sqlserver'
  if (dialect === 'mysql') return isMysqlCompatibleDbType(drawerDbType(input))
  if (dialect === 'postgresql') return isPostgresCompatibleDbType(drawerDbType(input))
  return drawerDbType(input) === dialect
}

export const buildDatabaseAiDrawerReasoning = (
  input: DatabaseAiDrawerResponseInput,
  generatedSql: string,
  dialect: DatabaseAiTargetDialect
) => {
  const contextLine =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName, input.context.tableName].filter(Boolean).join(' · ')
  const lines = ['Reasoning', '- Read the active database context and selected editor range through the aiopsterm backend boundary.']
  if (contextLine) lines.push(`- Context: ${contextLine}.`)
  lines.push('- 当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。')
  if (input.action === 'convert') {
    lines.push(`- Converted the SQL text to ${databaseAiDialectLabel(dialect)} syntax.`)
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

export const composeDatabaseAiDrawerResponseText = (reasoning: string, generatedSql: string) => `${reasoning}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``
