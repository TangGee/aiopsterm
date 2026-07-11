import { extractFencedSql, extractSql, isReadOnlySql, stripFencedSql } from '@/services/database/databaseSqlEditorRuntime'
import {
  DB_AI_PANE_DEFAULT_WIDTH,
  DB_AI_PANE_MAX_WIDTH,
  DB_AI_PANE_MIN_WIDTH,
  databaseCatalogDisplayName,
  defaultSchemaForSqlConnection,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  sqlConnectionRequiresSchema
} from '@/services/database/databaseWorkspaceRuntime'
import type { SqlConsoleContext, WorkspaceTab } from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneStateSnapshot,
  DatabaseAiResponseLanguage,
  DatabaseCatalogInfo,
  DatabaseConnectionInfo
} from '@shared/contracts/database'
import {
  databaseAiPaneActionName,
  databaseAiPaneHistoryFieldName,
  databaseAiQuickPrompt
} from '@shared/databaseAiSqlRuntime'
import type {
  DbAiAction,
  DbAiBackendContext,
  DbAiPaneContext,
  DbAiPaneMessage,
  DbAiPaneMessageStatus,
  DbAiRequest,
  DbAiStatus,
  DbAiTargetDialect
} from '@/services/database/databaseBackendGuards'

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

export const dbAiResponseLanguageForLocale = (locale: unknown): DatabaseAiResponseLanguage => locale === 'zh-CN' ? 'zh-CN' : 'en-US'

export const dbAiActionLabel = (action: DbAiAction, responseLanguage: DatabaseAiResponseLanguage) =>
  databaseAiPaneActionName(action, responseLanguage)

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
  const catalogName = databaseCatalogDisplayName(connection, { name: context.catalogName })
  return [connection.name, connection.dbType, catalogName, context.schemaName].filter(Boolean).join(' · ')
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
  conversationId: snapshot.conversationId,
  open: snapshot.open === true,
  width: clampDbAiPaneWidth(snapshot.width),
  context: snapshot.context?.connectionId ? resolveContext(snapshot.context) : null,
  draft: snapshot.draft || '',
  messages: snapshot.messages.map(cloneDbAiPaneMessage)
})

const cloneDbAiPaneMessage = (message: DbAiPaneMessage): DbAiPaneMessage => ({
  ...message,
  ...(message.context ? { context: { ...message.context } } : {}),
  ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
})

export const currentDbAiPaneStateSnapshot = (input: {
  conversationId?: string
  open: boolean
  width: number
  context: DbAiPaneContext
  draft: string
  messages: DbAiPaneMessage[]
}): DatabaseAiPaneStateSnapshot => ({
  conversationId: input.conversationId,
  open: input.open,
  width: input.width,
  context: { ...input.context },
  draft: input.draft,
  messages: input.messages.slice(-24).map(cloneDbAiPaneMessage)
})

export const dbAiContextParts = (tab: SqlTab, connection?: DatabaseConnectionInfo) => {
  const catalogName = databaseCatalogDisplayName(connection, { name: tab.catalogName })
  return [connection?.name, connection?.dbType, catalogName, tab.schemaName].filter(Boolean)
}

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
  const reasoning = stripFencedSql(text)
  return reasoning.replace(/^(?:Reasoning|\u5206\u6790)\s*\n?/i, '').trim()
}

export const dbAiPaneMessageContent = (message: DbAiPaneMessage) =>
  message.sqlAction && message.sqlAction.action !== 'explain' ? dbAiReasoningText(message.content) : message.content

export const dbAiPaneMessageGeneratedSql = (message: DbAiPaneMessage) =>
  message.sqlAction?.generatedSql.trim() || (message.sqlAction && message.sqlAction.action !== 'explain' ? extractFencedSql(message.content) : '')

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
  responseLanguage: DatabaseAiResponseLanguage
}): DatabaseAiDrawerResponseInput => ({
  action: input.action,
  responseLanguage: input.responseLanguage,
  sourceSql: input.sourceSql,
  targetDialect: input.targetDialect,
  context: dbAiBackendContextForIpc(input.context)
})

export const dbAiPaneRequestInput = (input: {
  conversationId?: string
  prompt: string
  action?: DbAiAction
  responseLanguage: DatabaseAiResponseLanguage
  context: DbAiPaneContext
  contextSummary: string
  activeSql: string
  tableName?: string
  messages: DbAiPaneMessage[]
}) => ({
  conversationId: input.conversationId,
  prompt: input.prompt,
  ...(input.action ? { action: input.action } : {}),
  responseLanguage: input.responseLanguage,
  context: {
    connectionId: input.context.connectionId,
    dbType: input.context.dbType || undefined,
    databaseName: input.context.catalogName,
    schemaName: input.context.schemaName,
    ...(input.tableName ? { tableName: input.tableName } : {}),
    contextSummary: input.contextSummary
  },
  activeSql: input.activeSql,
  messages: input.messages.map((message) => ({
    role: message.role,
    content: message.role === 'user' && message.sqlAction?.sourceSql.trim()
      ? [
          dbAiActionLabel(message.sqlAction.action, input.responseLanguage),
          databaseAiPaneHistoryFieldName(message.sqlAction.action, input.responseLanguage),
          message.sqlAction.sourceSql
        ].join('\n')
      : message.content
  }))
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

export const dbAiQuickPromptText = (
  kind: 'explainActive' | 'schemaSummary' | 'selectSample',
  sql = '',
  responseLanguage: DatabaseAiResponseLanguage = 'en-US'
) => databaseAiQuickPrompt(kind, sql, responseLanguage)
