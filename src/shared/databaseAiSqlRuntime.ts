import type {
  DatabaseAiDrawerAction,
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneResponseInput,
  DatabaseAiResponseLanguage,
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

export const normalizeDatabaseAiResponseLanguage = (value: unknown): DatabaseAiResponseLanguage => value === 'zh-CN' ? 'zh-CN' : 'en-US'

const databaseAiLanguageText = (language: DatabaseAiResponseLanguage | undefined, zhCN: string, enUS: string) =>
  normalizeDatabaseAiResponseLanguage(language) === 'zh-CN' ? zhCN : enUS

const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'
const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'postgresql' || dbType === 'kingbase'

const unquoteIdentifier = (value: string) => value.replace(/^[`"\[]|[`"\]]$/g, '').replace(/""/g, '"').replace(/``/g, '`').replace(/]]/g, ']')

type DatabaseAiSqlToken = {
  kind: 'word' | 'identifier' | 'symbol'
  value: string
}

export type DatabaseAiSqlTableReference = {
  parts: string[]
  tableName: string
}

const isDatabaseAiSqlWordCharacter = (value: string) => /[\p{L}\p{N}_$#@]/u.test(value)

const databaseAiSqlTokens = (sql: string): DatabaseAiSqlToken[] => {
  const tokens: DatabaseAiSqlToken[] = []
  let index = 0
  while (index < sql.length) {
    const character = sql[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (character === '-' && sql[index + 1] === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n') index += 1
      continue
    }
    if (character === '#') {
      index += 1
      while (index < sql.length && sql[index] !== '\n') index += 1
      continue
    }
    if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      index = end < 0 ? sql.length : end + 2
      continue
    }
    if (character === "'") {
      index += 1
      while (index < sql.length) {
        if (sql[index] !== "'") {
          index += 1
          continue
        }
        if (sql[index + 1] === "'") {
          index += 2
          continue
        }
        index += 1
        break
      }
      continue
    }
    if (character === '$') {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0]
      if (delimiter) {
        const end = sql.indexOf(delimiter, index + delimiter.length)
        index = end < 0 ? sql.length : end + delimiter.length
        continue
      }
    }
    if (character === '"' || character === '`' || character === '[') {
      const closing = character === '[' ? ']' : character
      let value = ''
      index += 1
      while (index < sql.length) {
        if (sql[index] !== closing) {
          value += sql[index]
          index += 1
          continue
        }
        if (sql[index + 1] === closing) {
          value += closing
          index += 2
          continue
        }
        index += 1
        break
      }
      if (value) tokens.push({ kind: 'identifier', value })
      continue
    }
    if (isDatabaseAiSqlWordCharacter(character)) {
      let value = character
      index += 1
      while (index < sql.length && isDatabaseAiSqlWordCharacter(sql[index])) {
        value += sql[index]
        index += 1
      }
      tokens.push({ kind: 'word', value })
      continue
    }
    tokens.push({ kind: 'symbol', value: character })
    index += 1
  }
  return tokens
}

const databaseAiSqlCteNames = (tokens: DatabaseAiSqlToken[]) => {
  const names = new Set<string>()
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].kind !== 'word' || tokens[index].value.toLowerCase() !== 'with') continue
    let cursor = index + 1
    if (tokens[cursor]?.kind === 'word' && tokens[cursor].value.toLowerCase() === 'recursive') cursor += 1
    while (cursor < tokens.length) {
      const name = tokens[cursor]
      if (!name || (name.kind !== 'word' && name.kind !== 'identifier')) break
      let next = cursor + 1
      if (tokens[next]?.value === '(') {
        let depth = 1
        next += 1
        while (next < tokens.length && depth > 0) {
          if (tokens[next].value === '(') depth += 1
          if (tokens[next].value === ')') depth -= 1
          next += 1
        }
      }
      if (tokens[next]?.kind !== 'word' || tokens[next].value.toLowerCase() !== 'as') break
      next += 1
      if (tokens[next]?.kind === 'word' && tokens[next].value.toLowerCase() === 'not') next += 1
      if (tokens[next]?.kind === 'word' && tokens[next].value.toLowerCase() === 'materialized') next += 1
      if (tokens[next]?.value !== '(') break
      names.add(name.value.toLowerCase())
      let depth = 1
      next += 1
      while (next < tokens.length && depth > 0) {
        if (tokens[next].value === '(') depth += 1
        if (tokens[next].value === ')') depth -= 1
        next += 1
      }
      if (tokens[next]?.value !== ',') break
      cursor = next + 1
    }
  }
  return names
}

export const databaseAiSqlTableReferences = (sql: string): DatabaseAiSqlTableReference[] => {
  const tokens = databaseAiSqlTokens(sql)
  const cteNames = databaseAiSqlCteNames(tokens)
  const references: DatabaseAiSqlTableReference[] = []
  const seen = new Set<string>()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind !== 'word' || (token.value.toLowerCase() !== 'from' && token.value.toLowerCase() !== 'join')) continue
    let cursor = index + 1
    while (tokens[cursor]?.kind === 'word' && ['only', 'lateral'].includes(tokens[cursor].value.toLowerCase())) cursor += 1
    if (tokens[cursor]?.value === '(') continue
    const parts: string[] = []
    const first = tokens[cursor]
    if (!first || (first.kind !== 'word' && first.kind !== 'identifier')) continue
    parts.push(first.value)
    cursor += 1
    while (tokens[cursor]?.value === '.') {
      const next = tokens[cursor + 1]
      if (!next || (next.kind !== 'word' && next.kind !== 'identifier')) break
      parts.push(next.value)
      cursor += 2
    }
    if (tokens[cursor]?.value === '(') continue
    const boundedParts = parts.slice(-3)
    const tableName = boundedParts.at(-1) || ''
    if (!tableName || (boundedParts.length === 1 && cteNames.has(tableName.toLowerCase()))) continue
    const key = boundedParts.map((part) => part.toLowerCase()).join('.')
    if (seen.has(key)) continue
    seen.add(key)
    references.push({ parts: boundedParts, tableName })
  }
  return references
}

const tableNameFromSql = (sql: string) => {
  return databaseAiSqlTableReferences(sql)[0]?.tableName || ''
}

const schemaNameFromSql = (sql: string) => {
  const parts = databaseAiSqlTableReferences(sql)[0]?.parts ?? []
  return parts.length > 1 ? unquoteIdentifier(parts.at(-2) || '') : ''
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
  if (!keys.length) {
    return [databaseAiLanguageText(input.responseLanguage, '- 本地 DB AI 后端边界内没有可用的 table metadata。', '- No table metadata is available behind the local DB AI backend boundary.')]
  }
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
  metadata: DatabaseAiTableMetadataRuntime,
  responseLanguage: DatabaseAiResponseLanguage = 'en-US'
) => {
  const connectionId = trim(context.connectionId)
  const databaseName = trim(context.databaseName)
  const schemaName = trim(context.schemaName)
  const unavailable = databaseAiLanguageText(responseLanguage, '- 此请求上下文没有可用的 backend schema metadata。', '- No backend schema metadata is available for this request context.')
  if (!connectionId || !databaseName) return [unavailable]
  const keys = tableKeysForContext(metadata, { connectionId, databaseName, schemaName })
  if (!keys.length) return [unavailable]
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

export const databaseAiDrawerActionName = (action: DatabaseAiDrawerAction, responseLanguage: DatabaseAiResponseLanguage = 'en-US') => {
  if (responseLanguage === 'zh-CN') {
    switch (action) {
      case 'explain':
        return '解释 SQL'
      case 'nl2sql':
        return '自然语言转 SQL'
      case 'optimize':
        return '优化 SQL'
      case 'convert':
        return '转换 SQL'
      case 'complete':
        return '补全 SQL'
      case 'diagnose':
        return '诊断 SQL'
      case 'truncate':
        return '清空 table'
      case 'drop':
        return '删除 table'
      default:
        return action
    }
  }
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

export const databaseAiPaneActionName = (action: DatabaseAiDrawerAction, responseLanguage: DatabaseAiResponseLanguage = 'en-US') =>
  action === 'nl2sql'
    ? databaseAiLanguageText(responseLanguage, '生成 SQL', 'Generate SQL')
    : databaseAiDrawerActionName(action, responseLanguage)

export const databaseAiPaneHistoryFieldName = (action: DatabaseAiDrawerAction, responseLanguage: DatabaseAiResponseLanguage = 'en-US') =>
  action === 'nl2sql'
    ? databaseAiLanguageText(responseLanguage, '请求：', 'Request:')
    : databaseAiLanguageText(responseLanguage, '源 SQL：', 'Source SQL:')

export const databaseAiQuickPrompt = (
  kind: 'explainActive' | 'schemaSummary' | 'selectSample',
  sql = '',
  responseLanguage: DatabaseAiResponseLanguage = 'en-US'
) => {
  if (responseLanguage === 'zh-CN') {
    if (kind === 'explainActive') return `解释以下 SQL，并指出执行风险：\n${sql}`
    if (kind === 'schemaSummary') return '总结当前 database schema，并列出实用的查询入口。'
    return '为当前上下文中最有用的 table 生成一条只读 SELECT 查询。'
  }
  if (kind === 'explainActive') return `Explain this SQL and point out execution risks:\n${sql}`
  if (kind === 'schemaSummary') return 'Summarize the current database schema and list useful query entry points.'
  return 'Generate a read-only SELECT query for the most useful table in the current context.'
}

export const databaseAiNl2SqlPrompt = (request: string, responseLanguage: DatabaseAiResponseLanguage = 'en-US') =>
  `${databaseAiLanguageText(responseLanguage, '为以下请求生成一条只读 SQL 查询：', 'Generate a read-only SQL query for this request:')}\n${request}`

export const databaseAiReasoningHeading = (responseLanguage: DatabaseAiResponseLanguage = 'en-US') =>
  databaseAiLanguageText(responseLanguage, '分析', 'Reasoning')

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
  const zhCN = normalizeDatabaseAiResponseLanguage(input.responseLanguage) === 'zh-CN'
  const lines = zhCN
    ? ['分析', '- 已通过 aiopsterm 后端边界读取当前数据库上下文和选中的编辑器范围。']
    : ['Reasoning', '- Read the active database context and selected editor range through the aiopsterm backend boundary.']
  if (contextLine) lines.push(zhCN ? `- 上下文：${contextLine}。` : `- Context: ${contextLine}.`)
  lines.push(zhCN
    ? '- 当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。'
    : '- This response was generated by the local aiopsterm DB AI backend without a remote database AI service.')
  if (input.action === 'convert') {
    lines.push(zhCN ? `- 已将 SQL 文本转换为 ${databaseAiDialectLabel(dialect)} 语法。` : `- Converted the SQL text to ${databaseAiDialectLabel(dialect)} syntax.`)
    lines.push(isExecutableDrawerDialect(input, dialect)
      ? (zhCN ? '- 目标方言与当前连接匹配，因此可以启用只读执行。' : '- Target dialect matches the active connection, so read-only execution can be enabled.')
      : (zhCN ? '- 对当前连接而言，目标方言仅作为文本输出。' : '- Target dialect is text-only for this connection.'))
  } else if (input.action === 'diagnose') {
    lines.push(zhCN ? '- 已生成一条保守的只读语句，用于验证引用的 table。' : '- Built a conservative read-only statement that can verify the referenced table.')
    if (trim(input.errorMessage)) lines.push(zhCN ? `- 诊断输入错误：${trim(input.errorMessage)}。` : `- Diagnosis input error: ${trim(input.errorMessage)}.`)
  } else if (input.action === 'drop' || input.action === 'truncate') {
    lines.push(zhCN ? '- 破坏性 SQL 仅作为生成文本保留；只读保护仍会阻止执行。' : '- Preserved the destructive SQL as generated text only; execution remains blocked by the read-only guard.')
  } else if (input.action === 'nl2sql') {
    lines.push(zhCN ? '- 已将请求映射到当前数据库上下文中的第一个可见 table。' : '- Mapped the request to the first visible table in the current database context.')
  } else if (input.action === 'complete') {
    lines.push(zhCN ? '- 已使用有界的只读条件补全当前语句。' : '- Completed the current statement with a bounded read-only predicate.')
  } else if (input.action === 'optimize') {
    lines.push(zhCN ? '- 保持查询只读，并添加了更安全的有界投影供审查。' : '- Kept the query read-only and added a safer bounded projection for review.')
  } else {
    lines.push(zhCN ? '- 已保留源 SQL，供编辑器操作和审查。' : '- Kept the source SQL available for editor actions and review.')
  }
  lines.push(zhCN
    ? `- 在执行任何操作前，生成的 SQL ${isReadOnlySql(generatedSql) ? '是只读的' : '不是只读的'}。`
    : `- Generated SQL is ${isReadOnlySql(generatedSql) ? 'read-only' : 'not read-only'} before any execution action.`)
  if (input.sourceSql.trim() && input.sourceSql !== generatedSql) {
    lines.push(zhCN
      ? '- 在选择复制、替换、插入或只读运行之前，编辑器中的原始 SQL 保持不变。'
      : '- The original editor SQL remains unchanged until Copy, Replace, Insert, or Run ReadOnly is chosen.')
  }
  return lines.join('\n')
}

export const composeDatabaseAiDrawerResponseText = (reasoning: string, generatedSql: string) => `${reasoning}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``
