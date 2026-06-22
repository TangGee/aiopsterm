import { extractSql, isReadOnlySql } from '@/services/databaseSqlEditorRuntime'
import {
  DB_AI_PANE_DEFAULT_WIDTH,
  DB_AI_PANE_MAX_WIDTH,
  DB_AI_PANE_MIN_WIDTH,
  defaultSchemaForSqlConnection,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  sqlConnectionRequiresSchema
} from '@/services/databaseWorkspaceRuntime'
import type { SqlConsoleContext, WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneStateSnapshot,
  DatabaseCatalogInfo,
  DatabaseConnectionInfo
} from '@shared/contracts/database'
import type {
  DbAiAction,
  DbAiBackendContext,
  DbAiPaneContext,
  DbAiPaneMessage,
  DbAiPaneMessageStatus,
  DbAiRequest,
  DbAiStatus,
  DbAiTargetDialect
} from '@/services/databaseBackendGuards'

export type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>

export const dbAiDialectOptions: Array<{ value: DbAiTargetDialect; label: string }> = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'mssql', label: 'SQL Server' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'presto', label: 'Presto' }
]

export const emptyDbAiPaneContext = (): DbAiPaneContext => ({ connectionId: '', catalogName: '', schemaName: '', dbType: '' })

export const normalizeDbAiPaneContext = (
  input: Partial<DbAiPaneContext> | SqlConsoleContext,
  connections: DatabaseConnectionInfo[]
): DbAiPaneContext => {
  const connection = input.connectionId ? (connections.find((item) => item.id === input.connectionId) ?? connections[0]) : connections[0]
  if (!connection) return emptyDbAiPaneContext()
  const catalog = connection.catalogs.find((item) => item.name === input.catalogName) ?? connection.catalogs[0]
  const schemaName = sqlConnectionRequiresSchema(connection) ? defaultSchemaForSqlConnection(connection, catalog) : ''
  const requestedSchema = sqlConnectionRequiresSchema(connection)
    ? catalog?.schemas?.find((schema) => schema.name === input.schemaName)?.name
    : ''
  return {
    connectionId: connection.id,
    catalogName: catalog?.name ?? '',
    schemaName: requestedSchema || schemaName,
    dbType: connection.dbType
  }
}

export const dbAiPaneContextSummary = (connection: DatabaseConnectionInfo | null | undefined, context: DbAiPaneContext) => {
  if (!connection) return 'No database context selected'
  return [connection.name, connection.dbType, context.catalogName, context.schemaName].filter(Boolean).join(' · ')
}

export const dbAiPaneCanSend = (draft: string, context: DbAiPaneContext, isStreaming: boolean) =>
  Boolean(draft.trim() && context.connectionId && context.catalogName && !isStreaming)

export const dbAiPaneIsStreaming = (messages: DbAiPaneMessage[]) =>
  messages.some((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))

export const dbAiPaneStatusLabel = (status: DbAiPaneMessageStatus) => {
  if (status === 'queued') return 'Queued'
  if (status === 'streaming') return 'Streaming'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'error') return 'Error'
  return 'Done'
}

export const clampDbAiPaneWidth = (value: number) => {
  if (!Number.isFinite(value)) return DB_AI_PANE_DEFAULT_WIDTH
  return Math.min(DB_AI_PANE_MAX_WIDTH, Math.max(DB_AI_PANE_MIN_WIDTH, Math.round(value)))
}

export const applyDbAiPaneStateSnapshot = (
  snapshot: DatabaseAiPaneStateSnapshot,
  resolveContext: (context: DbAiPaneContext) => DbAiPaneContext
) => ({
  open: snapshot.open === true,
  width: clampDbAiPaneWidth(snapshot.width),
  context: snapshot.context?.connectionId ? resolveContext(snapshot.context) : null,
  draft: snapshot.draft || '',
  messages: snapshot.messages.map((message) => ({ ...message }))
})

export const currentDbAiPaneStateSnapshot = (input: {
  open: boolean
  width: number
  context: DbAiPaneContext
  draft: string
  messages: DbAiPaneMessage[]
}): DatabaseAiPaneStateSnapshot => ({
  open: input.open,
  width: input.width,
  context: { ...input.context },
  draft: input.draft,
  messages: input.messages.slice(-24).map((message) => ({ ...message }))
})

export const dbAiContextParts = (tab: SqlTab, connection?: DatabaseConnectionInfo) =>
  [connection?.name, connection?.dbType, tab.catalogName, tab.schemaName].filter(Boolean)

export const dbAiBackendContext = (
  input: {
    tab?: SqlTab | null
    connection?: DatabaseConnectionInfo
    contextSummary?: string
    override?: DbAiBackendContext
  }
): DbAiBackendContext => {
  const { tab, connection, contextSummary = '', override = {} } = input
  return {
    connectionId: override.connectionId ?? tab?.connectionId ?? '',
    dbType: override.dbType ?? connection?.dbType ?? '',
    databaseName: override.databaseName ?? tab?.catalogName ?? '',
    schemaName: override.schemaName !== undefined ? override.schemaName : tab?.schemaName || undefined,
    tableName: override.tableName !== undefined ? override.tableName : tab?.tableName || undefined,
    contextSummary: override.contextSummary ?? contextSummary
  }
}

export const dbAiBackendContextForIpc = (context: DbAiBackendContext): DatabaseAiDrawerResponseInput['context'] => ({
  connectionId: String(context.connectionId || ''),
  dbType: context.dbType || '',
  databaseName: String(context.databaseName || ''),
  schemaName: context.schemaName ? String(context.schemaName) : undefined,
  tableName: context.tableName ? String(context.tableName) : undefined,
  contextSummary: context.contextSummary ? String(context.contextSummary) : undefined
})

export const normalizeDbAiTargetDialect = (dbType?: string): DbAiTargetDialect => {
  if (dbType === 'sqlserver') return 'mssql'
  if (dbType && isMysqlCompatibleDbType(dbType as any)) return 'mysql'
  if (dbType && isPostgresCompatibleDbType(dbType as any)) return 'postgresql'
  return (dbType as DbAiTargetDialect) || 'postgresql'
}

export const dbAiDialectLabel = (dialect: DbAiTargetDialect) => dbAiDialectOptions.find((option) => option.value === dialect)?.label ?? dialect

export const dbAiRequestList = (requests: Record<string, DbAiRequest>) => Object.values(requests).sort((a, b) => b.createdAt - a.createdAt)

export const patchDbAiRequestRecord = (requests: Record<string, DbAiRequest>, reqId: string, patch: Partial<DbAiRequest>) => {
  const existing = requests[reqId]
  if (!existing) return requests
  return {
    ...requests,
    [reqId]: { ...existing, ...patch }
  }
}

export const removeDbAiRequestRecord = (requests: Record<string, DbAiRequest>, reqId: string) => {
  const { [reqId]: _removed, ...rest } = requests
  const fallback = dbAiRequestList(rest)[0] ?? null
  return { requests: rest, activeReqId: fallback?.id ?? null, open: Boolean(fallback) }
}

export const dbAiStatusLabel = (status: DbAiStatus | 'idle') => {
  if (status === 'queued') return 'Queued'
  if (status === 'streaming') return 'Streaming'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'error') return 'Error'
  if (status === 'done') return 'Done'
  return 'Idle'
}

export const dbAiSql = (request: DbAiRequest | null | undefined) => (request?.status === 'done' ? extractSql(request.text) : '')

export const dbAiReasoningText = (text: string) => {
  const fenceIndex = text.search(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql|clickhouse|presto)?\s*\n/i)
  const reasoning = fenceIndex >= 0 ? text.slice(0, fenceIndex).trim() : text.trim()
  return reasoning.replace(/^Reasoning\s*\n?/i, '').trim()
}

export const dbAiContentText = (input: { action: DbAiAction; text: string; sql: string; targetDialect: DbAiTargetDialect }) => {
  if (!input.sql || !input.text.trim()) return ''
  if (input.action === 'convert') return `Generated ${dbAiDialectLabel(input.targetDialect)} SQL preview.`
  if (input.action === 'diagnose') return 'Generated a conservative read-only SQL diagnosis candidate.'
  if (input.action === 'optimize') return 'Generated an optimized read-only SQL candidate.'
  if (input.action === 'complete') return 'Generated a completed SQL candidate for the active editor context.'
  if (input.action === 'nl2sql') return 'Generated SQL from the natural-language request and current database context.'
  return 'Generated SQL is ready for copy, replacement, insertion, or read-only execution when allowed.'
}

export const isDbAiExecutableDialect = (action: DbAiAction, target: DbAiTargetDialect, connection?: DatabaseConnectionInfo) => {
  if (action !== 'convert') return true
  if (target === 'mssql') return connection?.dbType === 'sqlserver'
  if (target === 'mysql') return !!connection && isMysqlCompatibleDbType(connection.dbType)
  if (target === 'postgresql') return !!connection && isPostgresCompatibleDbType(connection.dbType)
  return connection?.dbType === target
}

export const canRunDbAiReadOnly = (input: {
  activeSqlCanRun: boolean
  action: DbAiAction
  targetDialect: DbAiTargetDialect
  connection?: DatabaseConnectionInfo
  sql: string
}) => Boolean(input.activeSqlCanRun && isDbAiExecutableDialect(input.action, input.targetDialect, input.connection) && isReadOnlySql(input.sql))

export const dbAiCanCancel = (status: DbAiStatus | 'idle') => status === 'queued' || status === 'streaming'

export const dbAiDrawerCreateInput = (input: {
  action: DbAiAction
  sourceSql: string
  targetDialect: DbAiTargetDialect
  context: DbAiBackendContext
}): DatabaseAiDrawerResponseInput => ({
  action: input.action,
  sourceSql: input.sourceSql,
  targetDialect: input.targetDialect,
  context: dbAiBackendContextForIpc(input.context)
})

export const dbAiPaneRequestInput = (input: {
  prompt: string
  context: DbAiPaneContext
  contextSummary: string
  activeSql: string
  messages: DbAiPaneMessage[]
}) => ({
  prompt: input.prompt,
  context: {
    connectionId: input.context.connectionId,
    dbType: input.context.dbType || undefined,
    databaseName: input.context.catalogName,
    schemaName: input.context.schemaName,
    contextSummary: input.contextSummary
  },
  activeSql: input.activeSql,
  messages: input.messages.slice(-12).map((message) => ({ role: message.role, content: message.content }))
})

export const planDbAiInsertSql = (sqlText: string, range: { start: number; end: number }, generatedSql: string) => {
  const before = sqlText.slice(0, range.start)
  const after = sqlText.slice(range.end)
  const replacingSelection = range.start !== range.end
  const prefix = !replacingSelection && before && !/\s$/.test(before) ? '\n' : ''
  const suffix = !replacingSelection && after && !/^\s/.test(after) ? '\n' : ''
  const nextSql = `${before}${prefix}${generatedSql}${suffix}${after}`
  return {
    nextSql,
    selectionStart: range.start + prefix.length + generatedSql.length,
    notice: replacingSelection ? 'Editor selection replaced' : 'Generated SQL inserted'
  }
}

export const planDbAiReplaceSql = (sqlText: string, range: { start: number; end: number }, generatedSql: string, replacingExplicitSelection: boolean) => ({
  nextSql: `${sqlText.slice(0, range.start)}${generatedSql}${sqlText.slice(range.end)}`,
  selectionStart: range.start,
  selectionEnd: range.start + generatedSql.length,
  notice: replacingExplicitSelection ? 'Editor selection replaced' : 'Current statement replaced'
})

export const formatDbAiRequestTime = (time: number) => {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export const dbAiQuickPromptText = (kind: 'explainActive' | 'schemaSummary' | 'selectSample', sql = '') => {
  if (kind === 'explainActive') return `Explain this SQL and point out execution risks:\n${sql}`
  if (kind === 'schemaSummary') return 'Summarize the current database schema and list useful query entry points.'
  return 'Generate a read-only SELECT query for the most useful table in the current context.'
}
