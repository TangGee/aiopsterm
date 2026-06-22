import type {
  DatabaseAiDrawerAction,
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneResponseInput,
  DatabaseAiResponseProvider,
  DatabaseAiTargetDialect
} from './contracts/database'
import {
  databaseAiDialectLabel,
  databaseAiDrawerActionName,
  databaseAiProviderSchemaSummaryForContext,
  type DatabaseAiTableMetadataRuntime
} from './databaseAiSqlRuntime'

export type DatabaseAiProviderTextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type DatabaseAiProviderTextInput = {
  surface: 'pane' | 'drawer'
  systemPrompt: string
  messages: DatabaseAiProviderTextMessage[]
  maxTokens: number
  modelName: string
  prompt: string
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']
  requestId?: string
  assistantMessageId?: string
  action?: DatabaseAiDrawerAction
  activeSql?: string
  sourceSql?: string
  targetDialect?: DatabaseAiTargetDialect
  errorMessage?: string
}

export type DatabaseAiProviderTextResult =
  | { ok: true; text: string; provider: DatabaseAiResponseProvider; model?: string }
  | { ok: false; errorCode: string; errorMessage: string; provider?: DatabaseAiResponseProvider }

export const normalizeDatabaseAiProviderText = (value: unknown) => String(value || '').trim()

const databaseAiContextLines = (context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']) => {
  const lines = [
    `Connection id: ${normalizeDatabaseAiProviderText(context.connectionId) || '(not set)'}`,
    `Engine: ${normalizeDatabaseAiProviderText(context.dbType) || '(not set)'}`,
    `Current database: ${normalizeDatabaseAiProviderText(context.databaseName) || '(not set)'}`,
    `Current schema: ${normalizeDatabaseAiProviderText(context.schemaName) || '(not set)'}`,
    `Context summary: ${normalizeDatabaseAiProviderText(context.contextSummary) || '(not set)'}`
  ]
  const tableName = 'tableName' in context ? normalizeDatabaseAiProviderText(context.tableName) : ''
  if (tableName) lines.push(`Current table: ${tableName}`)
  return lines
}

export const buildDatabaseAiProviderSystemPrompt = (
  surface: 'pane' | 'drawer',
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context'],
  metadata: DatabaseAiTableMetadataRuntime,
  extra: string[] = []
) =>
  [
    'You are aiopsterm DB-AI, a database-workspace assistant for relational database analysis, SQL drafting, SQL review, and safe diagnostics.',
    'Respond in the same language as the operator when possible.',
    'There is no shell, filesystem, SSH, or remote-host workspace in this request. Only use the database context supplied below.',
    'Do not claim that you executed SQL, changed schemas, queried live data, or inspected objects unless the supplied context explicitly includes that result.',
    'Never reveal or invent credentials, connection strings, API keys, hostnames, or IP addresses.',
    'Do not invent tables, columns, indexes, constraints, or types. If schema metadata is missing, say what is missing and ask for the next required context.',
    'Prefer read-only SQL and diagnostics. For destructive or write operations, provide SQL as review text only and explain the risk; do not claim execution.',
    surface === 'drawer'
      ? 'For drawer requests, return a concise reasoning section followed by exactly one fenced SQL block using ```sql. The SQL block is required.'
      : 'For pane requests, answer conversationally and include SQL in fenced ```sql blocks when SQL is useful.',
    '',
    'Database context:',
    ...databaseAiContextLines(context),
    '',
    'Backend schema metadata available to this request:',
    ...databaseAiProviderSchemaSummaryForContext(context, metadata),
    ...extra
  ]
    .filter((line) => line !== '')
    .join('\n')

export const databaseAiPaneProviderSystemPrompt = (
  input: DatabaseAiPaneResponseInput,
  metadata: DatabaseAiTableMetadataRuntime
) =>
  buildDatabaseAiProviderSystemPrompt('pane', input.context, metadata, [
    normalizeDatabaseAiProviderText(input.activeSql) ? 'Active SQL editor content is included in the user messages.' : 'No active SQL editor content was supplied.'
  ])

export const databaseAiDrawerProviderSystemPrompt = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect,
  metadata: DatabaseAiTableMetadataRuntime
) =>
  buildDatabaseAiProviderSystemPrompt('drawer', input.context, metadata, [
    `Drawer action: ${databaseAiDrawerActionName(input.action)}`,
    `Target dialect: ${databaseAiDialectLabel(dialect)}`
  ])

export const databaseAiPaneProviderMessages = (
  input: DatabaseAiPaneResponseInput,
  prompt: string
): DatabaseAiProviderTextMessage[] => {
  const messages = (input.messages || [])
    .slice(-12)
    .map((message): DatabaseAiProviderTextMessage | null => {
      const content = normalizeDatabaseAiProviderText(message.content)
      if (!content) return null
      return { role: message.role === 'assistant' ? 'assistant' : 'user', content }
    })
    .filter(Boolean) as DatabaseAiProviderTextMessage[]
  if (normalizeDatabaseAiProviderText(input.activeSql)) {
    messages.push({ role: 'user', content: `Active SQL editor content:\n${normalizeDatabaseAiProviderText(input.activeSql)}` })
  }
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user' || last.content !== prompt) {
    messages.push({ role: 'user', content: prompt })
  }
  return messages
}

export const databaseAiDrawerProviderMessages = (
  input: DatabaseAiDrawerResponseInput,
  dialect: DatabaseAiTargetDialect
): DatabaseAiProviderTextMessage[] => {
  const actionLabel = databaseAiDrawerActionName(input.action)
  const details = [
    `Action: ${actionLabel}`,
    `Target dialect: ${databaseAiDialectLabel(dialect)}`,
    normalizeDatabaseAiProviderText(input.errorMessage) ? `Observed SQL error: ${normalizeDatabaseAiProviderText(input.errorMessage)}` : '',
    normalizeDatabaseAiProviderText(input.sourceSql) ? `Source SQL:\n${normalizeDatabaseAiProviderText(input.sourceSql)}` : '',
    '',
    'Return a concise reasoning section followed by one fenced SQL block. The SQL must match the target dialect and the current database context.'
  ]
    .filter(Boolean)
    .join('\n')
  return [{ role: 'user', content: details }]
}

export const extractDatabaseAiFencedSqlBlock = (text: string) => {
  const match = text.match(/```(?:sql|mysql|postgresql|sqlite|oracle|mssql|tsql|clickhouse|presto)?\s*([\s\S]*?)```/i)
  const sql = normalizeDatabaseAiProviderText(match?.[1])
  if (!match || !sql) return { sql: '', reasoning: normalizeDatabaseAiProviderText(text) }
  const reasoning = normalizeDatabaseAiProviderText(text.slice(0, match.index)) || normalizeDatabaseAiProviderText(text.replace(match[0], ''))
  return { sql, reasoning }
}
