import { randomUUID } from 'crypto'
import type {
  DatabaseAiResponseProvider,
  DatabaseAiDrawerAction,
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiTargetDialect,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneStateContext,
  DatabaseAiPaneStateResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseEngineCode,
  DatabaseSqlErrorDiagnosisInput,
  DatabaseSqlErrorDiagnosisResult
} from './contracts/database'
import { shouldUseDatabaseAiBackendDouble } from './runtimeSwitches'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const supportedEngines = new Set<string>(['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlite', 'oracle', 'sqlserver', 'clickhouse', 'presto'])
const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'
const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | DatabaseAiTargetDialect | '') => dbType === 'postgresql' || dbType === 'kingbase'

type DatabaseAiTableContext = {
  connectionId: string
  databaseName?: string
  schemaName?: string
  tableName?: string
}

export type DatabaseAiBackendContext = {
  ensureStateLoaded?: () => void
  persistState?: () => void
  tableKeysForContext?: (input: Omit<DatabaseAiTableContext, 'tableName'>) => string[]
  tableKeyForContext?: (input: DatabaseAiTableContext) => string
  columnsForTableKey?: (key: string) => string[]
}

let databaseAiBackendContext: DatabaseAiBackendContext = {}

export function configureDatabaseAiBackendContext(context?: DatabaseAiBackendContext) {
  databaseAiBackendContext = context ? { ...context } : {}
}

const databaseAiEnsureStateLoaded = () => {
  databaseAiBackendContext.ensureStateLoaded?.()
}

const databaseAiPersistState = () => {
  databaseAiBackendContext.persistState?.()
}

export const DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS = 500
export const DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS = 260
const DATABASE_AI_PANE_DEFAULT_WIDTH = 360
const DATABASE_AI_PANE_MIN_WIDTH = 280
const DATABASE_AI_PANE_MAX_WIDTH = 720
const DATABASE_AI_PANE_MAX_MESSAGES = 24

const defaultDatabaseAiPaneContext = (): DatabaseAiPaneStateContext => ({
  connectionId: '',
  catalogName: '',
  schemaName: '',
  dbType: ''
})

const defaultDatabaseAiPaneState = (): DatabaseAiPaneStateSnapshot => ({
  open: false,
  width: DATABASE_AI_PANE_DEFAULT_WIDTH,
  context: defaultDatabaseAiPaneContext(),
  draft: '',
  messages: []
})

const databaseAiPaneMessages = new Map<string, DatabaseAiPaneMessageRecord>()
const databaseAiDrawerRequests = new Map<string, DatabaseAiDrawerRequestRecord>()
let databaseAiPaneState = defaultDatabaseAiPaneState()

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

type DatabaseAiRuntimeConfig = {
  getModelName?: () => string | undefined
  generateText?: (input: DatabaseAiProviderTextInput) => Promise<DatabaseAiProviderTextResult>
  localBackendDouble?: boolean
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
}

let databaseAiRuntime: DatabaseAiRuntimeConfig = {}

export function configureDatabaseAiRuntime(config?: DatabaseAiRuntimeConfig) {
  databaseAiRuntime = config ? { ...config } : {}
}

const databaseAiPaneMessageRecord = (
  input: {
    requestId: string
    role: 'user' | 'assistant'
    status: DatabaseAiPaneMessageRecord['status']
    content: string
    contextSummary: string
    createdAt: number
  },
  id = `dbai-pane-message-${randomUUID()}`
): DatabaseAiPaneMessageRecord => ({
  id,
  requestId: input.requestId,
  role: input.role,
  status: input.status,
  content: input.content,
  contextSummary: input.contextSummary,
  createdAt: input.createdAt,
  updatedAt: input.createdAt
})

const cloneDatabaseAiPaneMessageRecord = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({ ...message })

const normalizeDatabaseAiPaneStateContext = (context?: Partial<DatabaseAiPaneStateContext>): DatabaseAiPaneStateContext => {
  const dbType = context?.dbType && supportedEngines.has(context.dbType) ? context.dbType : ''
  return {
    connectionId: trim(context?.connectionId),
    catalogName: trim(context?.catalogName),
    schemaName: trim(context?.schemaName),
    dbType
  }
}

const normalizeDatabaseAiPaneStateMessage = (message: unknown): DatabaseAiPaneMessageRecord | null => {
  if (!message || typeof message !== 'object') return null
  const raw = message as Partial<DatabaseAiPaneMessageRecord>
  const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null
  if (!role) return null
  const id = trim(raw.id)
  const requestId = trim(raw.requestId)
  if (!id || !requestId) return null
  const rawStatus = String(raw.status || '')
  if (!['queued', 'streaming', 'done', 'error', 'cancelled'].includes(rawStatus)) return null
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null
  const status =
    rawStatus === 'queued' || rawStatus === 'streaming' ? 'cancelled' : (rawStatus as DatabaseAiPaneMessageRecord['status'])
  return {
    id,
    requestId,
    role,
    status,
    content: String(raw.content ?? ''),
    contextSummary: String(raw.contextSummary ?? ''),
    createdAt,
    updatedAt
  }
}

export const normalizeDatabaseAiPaneState = (state?: Partial<DatabaseAiPaneStateSnapshot>): DatabaseAiPaneStateSnapshot => {
  const width = Number(state?.width)
  const messages = Array.isArray(state?.messages)
    ? state.messages.map(normalizeDatabaseAiPaneStateMessage).filter((message): message is DatabaseAiPaneMessageRecord => Boolean(message))
    : []
  return {
    open: state?.open === true,
    width: Math.min(DATABASE_AI_PANE_MAX_WIDTH, Math.max(DATABASE_AI_PANE_MIN_WIDTH, Number.isFinite(width) ? Math.round(width) : DATABASE_AI_PANE_DEFAULT_WIDTH)),
    context: normalizeDatabaseAiPaneStateContext(state?.context),
    draft: typeof state?.draft === 'string' ? state.draft : '',
    messages: messages.slice(-DATABASE_AI_PANE_MAX_MESSAGES).map(cloneDatabaseAiPaneMessageRecord)
  }
}

const cloneDatabaseAiPaneState = (state: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  open: state.open,
  width: state.width,
  context: { ...state.context },
  draft: state.draft,
  messages: state.messages.map(cloneDatabaseAiPaneMessageRecord)
})

const sortedDatabaseAiPaneMessages = () =>
  Array.from(databaseAiPaneMessages.values())
    .sort((first, second) => first.createdAt - second.createdAt)
    .slice(-DATABASE_AI_PANE_MAX_MESSAGES)
    .map(cloneDatabaseAiPaneMessageRecord)

const syncDatabaseAiPaneStateMessages = () => {
  databaseAiPaneState = {
    ...databaseAiPaneState,
    messages: sortedDatabaseAiPaneMessages()
  }
}

export const replaceDatabaseAiPaneState = (state: DatabaseAiPaneStateSnapshot) => {
  databaseAiPaneState = normalizeDatabaseAiPaneState(state)
  databaseAiPaneMessages.clear()
  databaseAiPaneState.messages.forEach((message) => {
    databaseAiPaneMessages.set(message.id, cloneDatabaseAiPaneMessageRecord(message))
  })
  syncDatabaseAiPaneStateMessages()
}

export const getDatabaseAiPaneStateSnapshot = () => cloneDatabaseAiPaneState(databaseAiPaneState)

export const resetDatabaseAiBackendState = () => {
  databaseAiPaneMessages.clear()
  databaseAiPaneState = defaultDatabaseAiPaneState()
  databaseAiDrawerRequests.clear()
}

export function getDatabaseAiPaneState(): DatabaseAiPaneStateResult {
  databaseAiEnsureStateLoaded()
  return {
    ok: true,
    data: cloneDatabaseAiPaneState(databaseAiPaneState)
  }
}

export function saveDatabaseAiPaneState(input: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateResult {
  databaseAiEnsureStateLoaded()
  replaceDatabaseAiPaneState(input)
  databaseAiPersistState()
  return {
    ok: true,
    data: cloneDatabaseAiPaneState(databaseAiPaneState)
  }
}

const storeDatabaseAiPaneMessage = (message: DatabaseAiPaneMessageRecord) => {
  databaseAiPaneMessages.set(message.id, cloneDatabaseAiPaneMessageRecord(message))
  syncDatabaseAiPaneStateMessages()
  return message
}

const findDatabaseAiPaneAssistantMessage = (input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneMessageRecord | null => {
  const assistantMessageId = trim(input.assistantMessageId)
  if (assistantMessageId) {
    const message = databaseAiPaneMessages.get(assistantMessageId)
    if (message?.role === 'assistant') return cloneDatabaseAiPaneMessageRecord(message)
  }
  const requestId = trim(input.requestId)
  if (!requestId) return null
  return (
    Array.from(databaseAiPaneMessages.values())
      .filter((message) => message.role === 'assistant' && message.requestId === requestId)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}

const updateDatabaseAiPaneAssistantMessage = (
  input: DatabaseAiPaneLifecycleInput,
  patch: Partial<Pick<DatabaseAiPaneMessageRecord, 'status' | 'content' | 'updatedAt'>>
): DatabaseAiPaneMessageRecord | null => {
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return null
  const updated: DatabaseAiPaneMessageRecord = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? databaseAiNow()
  }
  databaseAiPaneMessages.set(updated.id, cloneDatabaseAiPaneMessageRecord(updated))
  syncDatabaseAiPaneStateMessages()
  return updated
}

const cloneDatabaseAiDrawerRequestRecord = (request: DatabaseAiDrawerRequestRecord): DatabaseAiDrawerRequestRecord => ({
  ...request,
  backendContext: { ...request.backendContext }
})

const storeDatabaseAiDrawerRequest = (request: DatabaseAiDrawerRequestRecord) => {
  databaseAiDrawerRequests.set(request.id, cloneDatabaseAiDrawerRequestRecord(request))
  return request
}

const findDatabaseAiDrawerRequest = (input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerRequestRecord | null => {
  const requestId = trim(input.requestId)
  if (!requestId) return null
  const request = databaseAiDrawerRequests.get(requestId)
  return request ? cloneDatabaseAiDrawerRequestRecord(request) : null
}

const updateDatabaseAiDrawerRequest = (
  input: DatabaseAiDrawerLifecycleInput,
  patch: Partial<Pick<DatabaseAiDrawerRequestRecord, 'status' | 'text' | 'targetDialect' | 'updatedAt'>>
): DatabaseAiDrawerRequestRecord | null => {
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return null
  const updated = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? databaseAiNow()
  }
  databaseAiDrawerRequests.set(updated.id, cloneDatabaseAiDrawerRequestRecord(updated))
  return updated
}

const databaseAiPaneContextSummary = (input: DatabaseAiPaneResponseInput) =>
  trim(input.context.contextSummary) ||
  [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')

const databaseAiPaneErrorResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  provider: DatabaseAiResponseProvider = 'aiopsterm-local'
): DatabaseAiPaneResponseResult => {
  const requestId = trim(input.requestId) || `dbai-pane-request-${randomUUID()}`
  const contextSummary = databaseAiPaneContextSummary(input)
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  let assistantMessage: DatabaseAiPaneMessageRecord
  if (existing && existing.status !== 'cancelled') {
    assistantMessage =
      updateDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: existing.id }, { status: 'error', content: errorMessage }) ?? existing
  } else {
    assistantMessage =
      existing ??
      storeDatabaseAiPaneMessage(
        databaseAiPaneMessageRecord(
          {
            requestId,
            role: 'assistant',
            status: 'error',
            content: errorMessage,
            contextSummary,
            createdAt: startedAt
          },
          input.assistantMessageId || `dbai-pane-message-${randomUUID()}`
        )
      )
  }

  databaseAiPersistState()
  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      requestId,
      assistantMessage,
      text: assistantMessage.content,
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const databaseAiDrawerErrorResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string,
  provider: DatabaseAiResponseProvider = 'aiopsterm-local'
): DatabaseAiDrawerResponseResult => {
  const requestId = trim(input.requestId)
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  const targetDialect = drawerTargetDialect(input)
  const text = `Reasoning\n- ${errorMessage}`
  let request: DatabaseAiDrawerRequestRecord
  if (existing && existing.status !== 'cancelled') {
    request = updateDatabaseAiDrawerRequest({ requestId: existing.id }, { status: 'error', text, targetDialect }) ?? existing
  } else {
    request =
      existing ??
      storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'error',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: databaseAiNow()
      })
  }

  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      request,
      text: request.text,
      reasoning: request.text,
      sql: '',
      provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const databaseAiDrawerActionName = (action: DatabaseAiDrawerAction) => {
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

const wait = (durationMs: number) => {
  if (databaseAiRuntime.wait) return databaseAiRuntime.wait(durationMs)
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

const databaseAiNow = () => (databaseAiRuntime.now ? databaseAiRuntime.now() : Date.now())

const databaseAiModelName = () => trim(databaseAiRuntime.getModelName?.()) || 'aiopsterm-local-agent'

const shouldUseDatabaseAiProvider = (modelName: string) => trim(modelName) !== '' && trim(modelName) !== 'aiopsterm-local-agent'

const isDatabaseAiLocalDoubleEnabled = () => databaseAiRuntime.localBackendDouble === true || shouldUseDatabaseAiBackendDouble()

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

const keyParts = (key: string) => {
  const [connectionId, databaseName, schemaName, tableName] = key.split(':')
  return { connectionId, databaseName, schemaName, tableName }
}

const tableKeysForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) => {
  const keys = databaseAiBackendContext.tableKeysForContext?.(input) ?? []
  return keys.slice().sort()
}

const tableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) =>
  databaseAiBackendContext.tableKeyForContext?.(input) || ''

const columnsForTableKey = (key: string) => {
  const columns = databaseAiBackendContext.columnsForTableKey?.(key) ?? []
  return columns.slice()
}

const firstTableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) => tableKeysForContext(input)[0] || ''

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

const suggestedReadOnlySqlForContext = (input: DatabaseAiPaneResponseInput) => {
  const key = firstTableKeyForContext({
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

const schemaSummaryForContext = (input: DatabaseAiPaneResponseInput) => {
  const keys = tableKeysForContext({
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  if (!keys.length) return ['- No table metadata is available behind the local DB AI backend boundary.']
  const grouped = new Map<string, string[]>()
  keys.forEach((key) => {
    const parts = keyParts(key)
    const group = parts.schemaName || parts.databaseName || 'default'
    const columns = columnsForTableKey(key)
    const label = `${parts.tableName}(${columns.length} columns)`
    grouped.set(group, [...(grouped.get(group) ?? []), label])
  })
  return [...grouped.entries()].map(([group, tables]) => `- ${group}: ${tables.slice(0, 5).join(', ')}`)
}

const drawerDbType = (input: DatabaseAiDrawerResponseInput) =>
  input.context.dbType && supportedEngines.has(input.context.dbType) ? input.context.dbType : 'postgresql'

const normalizeDatabaseAiTargetDialect = (dialect: DatabaseAiTargetDialect | '' | undefined): DatabaseAiTargetDialect =>
  dialect === 'sqlserver'
    ? 'mssql'
    : dialect === 'mariadb' || dialect === 'oceanbase'
      ? 'mysql'
      : dialect === 'kingbase'
        ? 'postgresql'
        : dialect || 'postgresql'

const drawerTargetDialect = (input: DatabaseAiDrawerResponseInput): DatabaseAiTargetDialect =>
  normalizeDatabaseAiTargetDialect(input.targetDialect || drawerDbType(input))

const quoteDrawerIdentifier = (value: string, dialect: DatabaseAiTargetDialect) => {
  const raw = String(value || '').replace(/^[`"\[]|[`"\]]$/g, '')
  if (isMysqlCompatibleDbType(dialect) || dialect === 'clickhouse') return `\`${raw.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

const dialectLabel = (dialect: DatabaseAiTargetDialect) => {
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

const drawerTableReference = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const explicitTable = trim(input.context.tableName) || tableNameFromSql(input.sourceSql)
  const connectionId = trim(input.context.connectionId)
  const databaseName = trim(input.context.databaseName)
  const schemaName = trim(input.context.schemaName) || schemaNameFromSql(input.sourceSql)
  const key = explicitTable
    ? tableKeyForContext({ connectionId, databaseName, schemaName, tableName: explicitTable })
    : firstTableKeyForContext({ connectionId, databaseName, schemaName })
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

const buildDrawerNl2Sql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const tableRef = drawerTableReference(input, dialect)
  if (dialect === 'oracle') {
    return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nFETCH FIRST 20 ROWS ONLY;`
  }
  if (dialect === 'mssql' || dialect === 'sqlserver') {
    return `SELECT TOP (20) id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC;`
  }
  return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nLIMIT 20;`
}

const completeDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const fallback = `SELECT *\nFROM ${drawerTableReference(input, dialect)}`
  const base = stripSqlTerminator(input.sourceSql.trim() || fallback)
  let completed = base
  if (/\bwhere\s*$/i.test(completed)) {
    completed = `${completed} status = 'open'`
  } else if (!/\bwhere\b/i.test(completed) && /^\s*(select|with)\b/i.test(completed)) {
    completed = `${completed}\nWHERE status = 'open'`
  }
  return addDialectLimit(completed, dialect, 100)
}

const optimizeDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const fallback = `SELECT id, service, status, owner, updated_at\nFROM ${drawerTableReference(input, dialect)}`
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

const diagnoseDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const tableRef = drawerTableReference(input, dialect)
  if (dialect === 'oracle') return `SELECT *\nFROM ${tableRef}\nFETCH FIRST 100 ROWS ONLY;`
  if (dialect === 'mssql' || dialect === 'sqlserver') return `SELECT TOP (100) *\nFROM ${tableRef};`
  return `SELECT *\nFROM ${tableRef}\nLIMIT 100;`
}

const buildDrawerGeneratedSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action === 'convert') return convertDrawerSqlToDialect(input, dialect)
  if (input.action === 'diagnose') return diagnoseDrawerSql(input, dialect)
  if (input.action === 'nl2sql') return buildDrawerNl2Sql(input, dialect)
  if (input.action === 'complete') return completeDrawerSql(input, dialect)
  if (input.action === 'optimize') return optimizeDrawerSql(input, dialect)
  return ensureSqlTerminated(input.sourceSql.trim() || 'SELECT 1')
}

const isExecutableDrawerDialect = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action !== 'convert') return true
  if (dialect === 'mssql') return drawerDbType(input) === 'sqlserver'
  if (dialect === 'mysql') return isMysqlCompatibleDbType(drawerDbType(input))
  if (dialect === 'postgresql') return isPostgresCompatibleDbType(drawerDbType(input))
  return drawerDbType(input) === dialect
}

const buildDrawerReasoning = (input: DatabaseAiDrawerResponseInput, generatedSql: string, dialect: DatabaseAiTargetDialect) => {
  const contextLine =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName, input.context.tableName].filter(Boolean).join(' · ')
  const lines = ['Reasoning', '- Read the active database context and selected editor range through the aiopsterm backend boundary.']
  if (contextLine) lines.push(`- Context: ${contextLine}.`)
  lines.push('- 当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。')
  if (input.action === 'convert') {
    lines.push(`- Converted the SQL text to ${dialectLabel(dialect)} syntax.`)
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

const composeDrawerResponseText = (reasoning: string, generatedSql: string) => `${reasoning}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``

const normalizeDatabaseAiProviderText = (value: unknown) => String(value || '').trim()

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

const databaseAiSchemaSummaryForContext = (context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context']) => {
  const connectionId = normalizeDatabaseAiProviderText(context.connectionId)
  const databaseName = normalizeDatabaseAiProviderText(context.databaseName)
  const schemaName = normalizeDatabaseAiProviderText(context.schemaName)
  if (!connectionId || !databaseName) return ['- No backend schema metadata is available for this request context.']
  const keys = tableKeysForContext({ connectionId, databaseName, schemaName })
  if (!keys.length) return ['- No backend schema metadata is available for this request context.']
  return keys.slice(0, 16).map((key) => {
    const parts = keyParts(key)
    const columns = columnsForTableKey(key)
    const qualified = [parts.databaseName, parts.schemaName, parts.tableName].filter(Boolean).join('.')
    return `- ${qualified}: ${columns.slice(0, 12).join(', ')}`
  })
}

const buildDatabaseAiProviderSystemPrompt = (
  surface: 'pane' | 'drawer',
  context: DatabaseAiPaneResponseInput['context'] | DatabaseAiDrawerResponseInput['context'],
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
    ...databaseAiSchemaSummaryForContext(context),
    ...extra
  ]
    .filter((line) => line !== '')
    .join('\n')

const paneProviderMessages = (input: DatabaseAiPaneResponseInput, prompt: string): DatabaseAiProviderTextMessage[] => {
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

const drawerProviderMessages = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect): DatabaseAiProviderTextMessage[] => {
  const actionLabel = databaseAiDrawerActionName(input.action)
  const details = [
    `Action: ${actionLabel}`,
    `Target dialect: ${dialectLabel(dialect)}`,
    normalizeDatabaseAiProviderText(input.errorMessage) ? `Observed SQL error: ${normalizeDatabaseAiProviderText(input.errorMessage)}` : '',
    normalizeDatabaseAiProviderText(input.sourceSql) ? `Source SQL:\n${normalizeDatabaseAiProviderText(input.sourceSql)}` : '',
    '',
    'Return a concise reasoning section followed by one fenced SQL block. The SQL must match the target dialect and the current database context.'
  ]
    .filter(Boolean)
    .join('\n')
  return [{ role: 'user', content: details }]
}

const extractFencedSqlBlock = (text: string) => {
  const match = text.match(/```(?:sql|mysql|postgresql|sqlite|oracle|mssql|tsql|clickhouse|presto)?\s*([\s\S]*?)```/i)
  const sql = normalizeDatabaseAiProviderText(match?.[1])
  if (!match || !sql) return { sql: '', reasoning: normalizeDatabaseAiProviderText(text) }
  const reasoning = normalizeDatabaseAiProviderText(text.slice(0, match.index)) || normalizeDatabaseAiProviderText(text.replace(match[0], ''))
  return { sql, reasoning }
}

const storeDatabaseAiPaneDoneResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  requestId: string,
  text: string,
  contextLine: string
) => {
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord(
      {
        requestId,
        role: 'assistant',
        status: 'done',
        content: text,
        contextSummary: contextLine,
        createdAt: existing?.createdAt ?? startedAt
      },
      input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
    )
  )
  assistantMessage.updatedAt = databaseAiNow()
  databaseAiPaneMessages.set(assistantMessage.id, cloneDatabaseAiPaneMessageRecord(assistantMessage))
  syncDatabaseAiPaneStateMessages()
  return assistantMessage
}

async function generateProviderDatabaseAiPaneResponse(
  input: DatabaseAiPaneResponseInput,
  modelName: string,
  startedAt: number,
  prompt: string
): Promise<DatabaseAiPaneResponseResult> {
  const generateText = databaseAiRuntime.generateText
  if (!generateText) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }
  const contextLine = databaseAiPaneContextSummary(input)
  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const existingBefore = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingBefore?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existingBefore,
        text: existingBefore.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const providerResponse = await generateText({
    surface: 'pane',
    modelName,
    prompt,
    context: input.context,
    requestId,
    assistantMessageId: input.assistantMessageId,
    activeSql: input.activeSql,
    systemPrompt: buildDatabaseAiProviderSystemPrompt('pane', input.context, [
      normalizeDatabaseAiProviderText(input.activeSql) ? 'Active SQL editor content is included in the user messages.' : 'No active SQL editor content was supplied.'
    ]),
    messages: paneProviderMessages(input, prompt),
    maxTokens: 1800
  })
  const existingAfter = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existingAfter?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existingAfter,
        text: existingAfter.content,
        provider: providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  if (!providerResponse.ok) {
    return databaseAiPaneErrorResponse(
      input,
      startedAt,
      providerResponse.errorCode,
      providerResponse.errorMessage,
      providerResponse.provider || 'aiopsterm-local'
    )
  }
  const text = normalizeDatabaseAiProviderText(providerResponse.text)
  if (!text) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_EMPTY', 'Database AI provider returned an empty response.', providerResponse.provider)
  }
  const assistantMessage = storeDatabaseAiPaneDoneResponse(input, startedAt, requestId, text, contextLine)
  databaseAiPersistState()
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: providerResponse.provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const storeDatabaseAiDrawerDoneResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  requestId: string,
  dialect: DatabaseAiTargetDialect,
  text: string
) => {
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  return existing && requestId
    ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect })
    : storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'done',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect: dialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: databaseAiNow()
      })
}

async function generateProviderDatabaseAiDrawerResponse(
  input: DatabaseAiDrawerResponseInput,
  modelName: string,
  startedAt: number,
  dialect: DatabaseAiTargetDialect
): Promise<DatabaseAiDrawerResponseResult> {
  const generateText = databaseAiRuntime.generateText
  if (!generateText) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }
  const requestId = trim(input.requestId)
  const existingBefore = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existingBefore?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existingBefore,
        text: existingBefore.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const providerResponse = await generateText({
    surface: 'drawer',
    modelName,
    prompt: databaseAiDrawerActionName(input.action),
    context: input.context,
    requestId,
    action: input.action,
    sourceSql: input.sourceSql,
    targetDialect: dialect,
    errorMessage: input.errorMessage,
    systemPrompt: buildDatabaseAiProviderSystemPrompt('drawer', input.context, [
      `Drawer action: ${databaseAiDrawerActionName(input.action)}`,
      `Target dialect: ${dialectLabel(dialect)}`
    ]),
    messages: drawerProviderMessages(input, dialect),
    maxTokens: 1400
  })
  const existingAfter = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existingAfter?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existingAfter,
        text: existingAfter.text,
        reasoning: '',
        sql: '',
        provider: providerResponse.ok ? providerResponse.provider : providerResponse.provider || 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  if (!providerResponse.ok) {
    return databaseAiDrawerErrorResponse(
      input,
      startedAt,
      providerResponse.errorCode,
      providerResponse.errorMessage,
      providerResponse.provider || 'aiopsterm-local'
    )
  }
  const providerText = normalizeDatabaseAiProviderText(providerResponse.text)
  if (!providerText) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_EMPTY', 'Database AI provider returned an empty response.', providerResponse.provider)
  }
  const parsed = extractFencedSqlBlock(providerText)
  if (!parsed.sql) {
    return databaseAiDrawerErrorResponse(
      input,
      startedAt,
      'DB_AI_PROVIDER_SQL_MISSING',
      'Database AI provider response did not include a fenced SQL block.',
      providerResponse.provider
    )
  }
  const reasoning = parsed.reasoning || `Reasoning\n- Provider returned SQL for ${databaseAiDrawerActionName(input.action)}.`
  const text = composeDrawerResponseText(reasoning, parsed.sql)
  const request = storeDatabaseAiDrawerDoneResponse(input, startedAt, requestId, dialect, text)
  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: parsed.sql,
      provider: providerResponse.provider,
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

const schemaNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?)\s*\.\s*([`"\[]?[\w.-]+[`"\]]?)/i)
  return match ? unquoteIdentifier(match[1].trim()) : ''
}

export async function createDatabaseAiPaneRequest(input: DatabaseAiPaneRequestInput): Promise<DatabaseAiPaneRequestResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = Date.now()
  const prompt = trim(input.prompt)
  if (!prompt) return { ok: false, errorCode: 'DB_AI_PROMPT_REQUIRED', errorMessage: 'Prompt is required.' }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.context.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  const requestId = `dbai-pane-request-${randomUUID()}`
  const contextSummary =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')
  const userCreatedAt = startedAt
  const userMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord({
      requestId,
      role: 'user',
      status: 'done',
      content: prompt,
      contextSummary,
      createdAt: userCreatedAt
    })
  )
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord({
      requestId,
      role: 'assistant',
      status: 'queued',
      content: '',
      contextSummary,
      createdAt: userCreatedAt + 1
    })
  )
  databaseAiPersistState()
  return {
    ok: true,
    data: {
      requestId,
      userMessage,
      assistantMessage
    }
  }
}

export function startDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'cancelled' || existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, { status: 'streaming' })
  if (assistantMessage) databaseAiPersistState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export function cancelDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, {
    status: 'cancelled',
    content: existing.content || 'Response cancelled before the first chunk.'
  })
  if (assistantMessage) databaseAiPersistState()
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export async function generateDatabaseAiPaneResponse(input: DatabaseAiPaneResponseInput): Promise<DatabaseAiPaneResponseResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = databaseAiNow()
  const prompt = trim(input.prompt)
  if (!prompt) return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROMPT_REQUIRED', 'Prompt is required.')
  if (!trim(input.context.connectionId)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }
  if (!trim(input.context.databaseName)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_DATABASE_REQUIRED', 'Database name is required.')
  }

  const modelName = databaseAiModelName()
  if (shouldUseDatabaseAiProvider(modelName)) {
    return generateProviderDatabaseAiPaneResponse(input, modelName, startedAt, prompt)
  }
  if (!isDatabaseAiLocalDoubleEnabled()) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }

  const promptLower = prompt.toLowerCase()
  const contextLine = databaseAiPaneContextSummary(input)
  const recentTurns = (input.messages || []).filter((message) => message.role === 'user').slice(-4).length
  const selectSql = suggestedReadOnlySqlForContext(input)
  const lines = [`Context: ${contextLine}`, '当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。', `Recent user turns: ${recentTurns}`]

  if (promptLower.includes('explain') || promptLower.includes('解释')) {
    lines.push(
      '',
      'I read the active SQL editor and current database context.',
      'Execution notes:',
      '- Keep the query read-only before running it from the workbench.',
      '- Verify WHERE clauses before widening result sets.',
      '- Check indexes on join/filter columns if latency grows.',
      '',
      'Suggested next SQL:',
      '```sql',
      selectSql,
      '```'
    )
  } else if (promptLower.includes('schema') || promptLower.includes('table') || promptLower.includes('表')) {
    lines.push('', 'Schema summary:', ...schemaSummaryForContext(input), '', 'Recommended starting point:', '```sql', selectSql, '```')
  } else if (promptLower.includes('select') || promptLower.includes('query') || promptLower.includes('sql')) {
    const key = firstTableKeyForContext({
      connectionId: input.context.connectionId,
      databaseName: input.context.databaseName,
      schemaName: input.context.schemaName || ''
    })
    const tableName = key ? keyParts(key).tableName : ''
    lines.push('', `Generated a conservative read-only query${tableName ? ` for ${tableName}` : ''}.`, '', '```sql', selectSql, '```')
  } else {
    lines.push(
      '',
      'I can help inspect schema metadata, draft read-only SQL, explain editor SQL, and suggest optimization checks in this database workspace.',
      '',
      '```sql',
      selectSql,
      '```'
    )
  }

  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const text = lines.join('\n')
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existing,
        text: existing.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord(
      {
        requestId,
        role: 'assistant',
        status: 'done',
        content: text,
        contextSummary: contextLine,
        createdAt: existing?.createdAt ?? startedAt
      },
      input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
    )
  )
  assistantMessage.updatedAt = databaseAiNow()
  databaseAiPaneMessages.set(assistantMessage.id, cloneDatabaseAiPaneMessageRecord(assistantMessage))
  syncDatabaseAiPaneStateMessages()
  databaseAiPersistState()
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function createDatabaseAiDrawerRequest(input: DatabaseAiDrawerRequestInput): Promise<DatabaseAiDrawerRequestResult> {
  databaseAiEnsureStateLoaded()
  const now = Date.now()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return { ok: false, errorCode: 'DB_AI_ACTION_INVALID', errorMessage: 'DB AI action is not supported.' }
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }

  const requestId = trim(input.requestId) || `dbai-drawer-request-${randomUUID()}`
  const existing = findDatabaseAiDrawerRequest({ requestId })
  if (existing) {
    return { ok: false, errorCode: 'DB_AI_REQUEST_DUPLICATE', errorMessage: 'DB AI drawer request id already exists.' }
  }

  const request: DatabaseAiDrawerRequestRecord = {
    id: requestId,
    action,
    label: databaseAiDrawerActionName(action),
    status: 'queued',
    contextSummary: trim(input.context.contextSummary),
    sourceSql: input.sourceSql,
    text: '',
    targetDialect: drawerTargetDialect(input),
    backendContext: {
      connectionId: trim(input.context.connectionId),
      dbType: input.context.dbType || '',
      databaseName: trim(input.context.databaseName),
      schemaName: trim(input.context.schemaName) || undefined,
      tableName: trim(input.context.tableName) || undefined,
      contextSummary: trim(input.context.contextSummary) || undefined
    },
    createdAt: now,
    updatedAt: now
  }
  return { ok: true, data: storeDatabaseAiDrawerRequest(request) }
}

export function startDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'cancelled') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'streaming', text: '' })
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export function cancelDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  databaseAiEnsureStateLoaded()
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'done' || existing.status === 'error') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'cancelled' })
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export async function generateDatabaseAiDrawerResponse(input: DatabaseAiDrawerResponseInput): Promise<DatabaseAiDrawerResponseResult> {
  databaseAiEnsureStateLoaded()
  const startedAt = databaseAiNow()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_ACTION_INVALID', 'DB AI action is not supported.')
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_SQL_REQUIRED', 'SQL is required.')
  }
  if (!trim(input.context.connectionId)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }

  const dialect = drawerTargetDialect(input)
  const modelName = databaseAiModelName()
  if (shouldUseDatabaseAiProvider(modelName)) {
    return generateProviderDatabaseAiDrawerResponse(input, modelName, startedAt, dialect)
  }
  if (!isDatabaseAiLocalDoubleEnabled()) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_PROVIDER_UNAVAILABLE', 'Database AI provider is unavailable.')
  }

  const generatedSql = buildDrawerGeneratedSql(input, dialect)
  const reasoning = buildDrawerReasoning(input, generatedSql, dialect)
  const requestId = trim(input.requestId)
  const elapsedMs = databaseAiNow() - startedAt
  if (elapsedMs < DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existing,
        text: existing.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, databaseAiNow() - startedAt)
      }
    }
  }

  const text = composeDrawerResponseText(reasoning, generatedSql)
  const request =
    existing && requestId
      ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect })
      : storeDatabaseAiDrawerRequest({
          id: requestId || `dbai-drawer-request-${randomUUID()}`,
          action,
          label: databaseAiDrawerActionName(action),
          status: 'done',
          contextSummary: trim(input.context.contextSummary),
          sourceSql: input.sourceSql,
          text,
          targetDialect: dialect,
          backendContext: {
            connectionId: trim(input.context.connectionId),
            dbType: input.context.dbType || '',
            databaseName: trim(input.context.databaseName),
            schemaName: trim(input.context.schemaName) || undefined,
            tableName: trim(input.context.tableName) || undefined,
            contextSummary: trim(input.context.contextSummary) || undefined
          },
          createdAt: startedAt,
          updatedAt: databaseAiNow()
        })

  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }

  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: generatedSql,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, databaseAiNow() - startedAt)
    }
  }
}

export async function diagnoseDatabaseSqlError(input: DatabaseSqlErrorDiagnosisInput): Promise<DatabaseSqlErrorDiagnosisResult> {
  databaseAiEnsureStateLoaded()
  const requestId = trim(input.requestId) || `dbai-diagnose-request-${randomUUID()}`
  const sourceSql = trim(input.sourceSql)
  const errorMessage = trim(input.errorMessage)
  if (!sourceSql) return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  if (!errorMessage) return { ok: false, errorCode: 'DB_AI_ERROR_REQUIRED', errorMessage: 'SQL error message is required.' }

  const created = await createDatabaseAiDrawerRequest({
    requestId,
    action: 'diagnose',
    sourceSql,
    targetDialect: input.targetDialect,
    context: input.context,
    errorMessage
  })
  if (!created.ok || !created.data) {
    return { ok: false, errorCode: created.errorCode, errorMessage: created.errorMessage }
  }

  const started = startDatabaseAiDrawerResponse({ requestId: created.data.id })
  if (!started.ok || !started.data) {
    return { ok: false, errorCode: started.errorCode, errorMessage: started.errorMessage }
  }

  return generateDatabaseAiDrawerResponse({
    requestId,
    action: 'diagnose',
    sourceSql: created.data.sourceSql,
    targetDialect: created.data.targetDialect,
    context: created.data.backendContext,
    errorMessage
  })
}
