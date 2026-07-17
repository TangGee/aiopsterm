import type {
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneSessionSnapshot,
  DatabaseAiPaneStateContext,
  DatabaseAiPaneStateSnapshot
} from './contracts/database'
import { isSupportedDatabaseAiEngine, normalizeDatabaseAiResponseLanguage } from './databaseAiSqlRuntime'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const randomRuntimeId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`

const DATABASE_AI_PANE_DEFAULT_WIDTH = 360
const DATABASE_AI_PANE_MIN_WIDTH = 280
const DATABASE_AI_PANE_MAX_WIDTH = 720
export const DATABASE_AI_PANE_MAX_MESSAGES = 24
export const DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS = 40

const defaultDatabaseAiPaneContext = (): DatabaseAiPaneStateContext => ({
  connectionId: '',
  catalogName: '',
  schemaName: '',
  dbType: ''
})

const defaultDatabaseAiPaneState = (): DatabaseAiPaneStateSnapshot => ({
  conversationId: `dbai-pane-conversation-${randomRuntimeId()}`,
  open: false,
  width: DATABASE_AI_PANE_DEFAULT_WIDTH,
  context: defaultDatabaseAiPaneContext(),
  draft: '',
  messages: [],
  archivedSessions: []
})

const databaseAiPaneMessages = new Map<string, DatabaseAiPaneMessageRecord>()
const databaseAiDrawerRequests = new Map<string, DatabaseAiDrawerRequestRecord>()
let databaseAiPaneState = defaultDatabaseAiPaneState()

export const createDatabaseAiPaneMessageRecord = (
  input: {
    requestId: string
    role: 'user' | 'assistant'
    status: DatabaseAiPaneMessageRecord['status']
    content: string
    contextSummary: string
    createdAt: number
    responseLanguage?: DatabaseAiPaneMessageRecord['responseLanguage']
    context?: DatabaseAiPaneStateContext
  },
  id = `dbai-pane-message-${randomRuntimeId()}`
): DatabaseAiPaneMessageRecord => ({
  id,
  requestId: input.requestId,
  role: input.role,
  status: input.status,
  content: input.content,
  contextSummary: input.contextSummary,
  createdAt: input.createdAt,
  updatedAt: input.createdAt,
  responseLanguage: normalizeDatabaseAiResponseLanguage(input.responseLanguage),
  ...(input.context ? { context: { ...input.context } } : {})
})

export const cloneDatabaseAiPaneMessageRecord = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({
  ...message,
  ...(message.context ? { context: { ...message.context } } : {}),
  ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
})

const normalizeDatabaseAiPaneStateContext = (context?: Partial<DatabaseAiPaneStateContext>): DatabaseAiPaneStateContext => {
  const dbType = context?.dbType && isSupportedDatabaseAiEngine(context.dbType) ? context.dbType : ''
  return {
    connectionId: trim(context?.connectionId),
    catalogName: trim(context?.catalogName),
    schemaName: trim(context?.schemaName),
    dbType
  }
}

const normalizeDatabaseAiPaneStateMessage = (
  message: unknown,
  cancelInFlight: boolean
): DatabaseAiPaneMessageRecord | null => {
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
  const status = cancelInFlight && (rawStatus === 'queued' || rawStatus === 'streaming')
    ? 'cancelled'
    : (rawStatus as DatabaseAiPaneMessageRecord['status'])
  const rawSqlAction = raw.sqlAction && typeof raw.sqlAction === 'object' ? raw.sqlAction : null
  const context = raw.context && typeof raw.context === 'object'
    ? normalizeDatabaseAiPaneStateContext(raw.context)
    : undefined
  const action = rawSqlAction?.action && ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate'].includes(rawSqlAction.action)
    ? rawSqlAction.action
    : undefined
  const targetDialect = rawSqlAction?.targetDialect && isSupportedDatabaseAiEngine(rawSqlAction.targetDialect === 'mssql' ? 'sqlserver' : rawSqlAction.targetDialect)
    ? rawSqlAction.targetDialect
    : undefined
  const rawContext = rawSqlAction?.context && typeof rawSqlAction.context === 'object' ? rawSqlAction.context : {}
  const sqlAction = action && targetDialect && (rawSqlAction?.transport === 'pane' || rawSqlAction?.transport === 'drawer')
    ? {
        action,
        label: trim(rawSqlAction.label),
        sourceSql: String(rawSqlAction.sourceSql ?? ''),
        generatedSql: String(rawSqlAction.generatedSql ?? ''),
        targetDialect,
        transport: rawSqlAction.transport,
        context: {
          ...(trim(rawContext.connectionId) ? { connectionId: trim(rawContext.connectionId) } : {}),
          ...(rawContext.dbType === '' || (typeof rawContext.dbType === 'string' && isSupportedDatabaseAiEngine(rawContext.dbType)) ? { dbType: rawContext.dbType } : {}),
          ...(trim(rawContext.databaseName) ? { databaseName: trim(rawContext.databaseName) } : {}),
          ...(trim(rawContext.schemaName) ? { schemaName: trim(rawContext.schemaName) } : {}),
          ...(trim(rawContext.tableName) ? { tableName: trim(rawContext.tableName) } : {}),
          ...(trim(rawContext.contextSummary) ? { contextSummary: trim(rawContext.contextSummary) } : {})
        }
      }
    : undefined
  return {
    id,
    requestId,
    role,
    status,
    content: String(raw.content ?? ''),
    contextSummary: String(raw.contextSummary ?? ''),
    createdAt,
    updatedAt,
    responseLanguage: normalizeDatabaseAiResponseLanguage(raw.responseLanguage),
    ...(context ? { context } : {}),
    ...(sqlAction ? { sqlAction } : {})
  }
}

const normalizeDatabaseAiPaneSessionSnapshot = (value: unknown): DatabaseAiPaneSessionSnapshot | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<DatabaseAiPaneSessionSnapshot>
  const conversationId = trim(raw.conversationId)
  if (!conversationId) return null
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  if (!Number.isFinite(createdAt) || createdAt < 0 || !Number.isFinite(updatedAt) || updatedAt < createdAt) return null
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message) => normalizeDatabaseAiPaneStateMessage(message, true))
        .filter((message): message is DatabaseAiPaneMessageRecord => Boolean(message))
        .slice(-DATABASE_AI_PANE_MAX_MESSAGES)
        .map(cloneDatabaseAiPaneMessageRecord)
    : []
  return {
    conversationId,
    context: normalizeDatabaseAiPaneStateContext(raw.context),
    draft: typeof raw.draft === 'string' ? raw.draft : '',
    messages,
    createdAt,
    updatedAt
  }
}

export const normalizeDatabaseAiPaneState = (
  state?: Partial<DatabaseAiPaneStateSnapshot>,
  options: { cancelInFlight?: boolean } = {}
): DatabaseAiPaneStateSnapshot => {
  const width = Number(state?.width)
  const cancelInFlight = options.cancelInFlight !== false
  const messages = Array.isArray(state?.messages)
    ? state.messages
        .map((message) => normalizeDatabaseAiPaneStateMessage(message, cancelInFlight))
        .filter((message): message is DatabaseAiPaneMessageRecord => Boolean(message))
    : []
  const conversationId = trim(state?.conversationId) || `dbai-pane-conversation-${randomRuntimeId()}`
  const archivedSessionIds = new Set<string>()
  const archivedSessions = Array.isArray(state?.archivedSessions)
    ? state.archivedSessions
        .map(normalizeDatabaseAiPaneSessionSnapshot)
        .filter((session): session is DatabaseAiPaneSessionSnapshot => session !== null && session.conversationId !== conversationId)
        .sort((left, right) => right.updatedAt - left.updatedAt || left.conversationId.localeCompare(right.conversationId))
        .filter((session) => {
          if (archivedSessionIds.has(session.conversationId)) return false
          archivedSessionIds.add(session.conversationId)
          return true
        })
        .slice(0, DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS)
    : []
  return {
    conversationId,
    open: state?.open === true,
    width: Math.min(DATABASE_AI_PANE_MAX_WIDTH, Math.max(DATABASE_AI_PANE_MIN_WIDTH, Number.isFinite(width) ? Math.round(width) : DATABASE_AI_PANE_DEFAULT_WIDTH)),
    context: normalizeDatabaseAiPaneStateContext(state?.context),
    draft: typeof state?.draft === 'string' ? state.draft : '',
    messages: messages.slice(-DATABASE_AI_PANE_MAX_MESSAGES).map(cloneDatabaseAiPaneMessageRecord),
    archivedSessions
  }
}

const cloneDatabaseAiPaneState = (state: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  conversationId: state.conversationId,
  open: state.open,
  width: state.width,
  context: { ...state.context },
  draft: state.draft,
  messages: state.messages.map(cloneDatabaseAiPaneMessageRecord),
  archivedSessions: (state.archivedSessions || []).map((session) => ({
    ...session,
    context: { ...session.context },
    messages: session.messages.map(cloneDatabaseAiPaneMessageRecord)
  }))
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
  databaseAiPaneState = normalizeDatabaseAiPaneState(state, { cancelInFlight: false })
  databaseAiPaneMessages.clear()
  databaseAiPaneState.messages.forEach((message) => {
    databaseAiPaneMessages.set(message.id, cloneDatabaseAiPaneMessageRecord(message))
  })
  syncDatabaseAiPaneStateMessages()
}

export const getDatabaseAiPaneStateSnapshot = () => cloneDatabaseAiPaneState(databaseAiPaneState)

export const deleteDatabaseAiPaneSessionProjection = (conversationIdInput: string) => {
  const conversationId = trim(conversationIdInput)
  if (!conversationId) return false
  const currentArchivedSessions = databaseAiPaneState.archivedSessions || []
  const archivedSessions = currentArchivedSessions.filter(
    (session) => session.conversationId !== conversationId
  )
  if (databaseAiPaneState.conversationId === conversationId) {
    databaseAiPaneState = {
      ...defaultDatabaseAiPaneState(),
      width: databaseAiPaneState.width,
      archivedSessions: archivedSessions.map((session) => ({
        ...session,
        context: { ...session.context },
        messages: session.messages.map(cloneDatabaseAiPaneMessageRecord)
      }))
    }
    databaseAiPaneMessages.clear()
    return true
  }
  if (archivedSessions.length === currentArchivedSessions.length) return false
  databaseAiPaneState = {
    ...databaseAiPaneState,
    archivedSessions
  }
  return true
}

export const resetDatabaseAiState = () => {
  databaseAiPaneMessages.clear()
  databaseAiPaneState = defaultDatabaseAiPaneState()
  databaseAiDrawerRequests.clear()
}

export const storeDatabaseAiPaneMessage = (message: DatabaseAiPaneMessageRecord) => {
  const stored = cloneDatabaseAiPaneMessageRecord(message)
  databaseAiPaneMessages.set(stored.id, stored)
  syncDatabaseAiPaneStateMessages()
  return cloneDatabaseAiPaneMessageRecord(stored)
}

export const findDatabaseAiPaneAssistantMessage = (input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneMessageRecord | null => {
  const assistantMessageId = trim(input.assistantMessageId)
  if (assistantMessageId) {
    const message = databaseAiPaneMessages.get(assistantMessageId)
    if (message?.role === 'assistant') return cloneDatabaseAiPaneMessageRecord(message)
  }
  const requestId = trim(input.requestId)
  if (!requestId) return null
  const message =
    Array.from(databaseAiPaneMessages.values())
      .filter((candidate) => candidate.role === 'assistant' && candidate.requestId === requestId)
      .sort((first, second) => second.createdAt - first.createdAt)[0] ?? null
  return message ? cloneDatabaseAiPaneMessageRecord(message) : null
}

export const updateDatabaseAiPaneAssistantMessage = (
  input: DatabaseAiPaneLifecycleInput,
  patch: Partial<Pick<DatabaseAiPaneMessageRecord, 'status' | 'content' | 'updatedAt'>>,
  now: () => number
): DatabaseAiPaneMessageRecord | null => {
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return null
  const updated: DatabaseAiPaneMessageRecord = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? now()
  }
  databaseAiPaneMessages.set(updated.id, cloneDatabaseAiPaneMessageRecord(updated))
  syncDatabaseAiPaneStateMessages()
  return cloneDatabaseAiPaneMessageRecord(updated)
}

export const cloneDatabaseAiDrawerRequestRecord = (request: DatabaseAiDrawerRequestRecord): DatabaseAiDrawerRequestRecord => ({
  ...request,
  backendContext: { ...request.backendContext }
})

export const storeDatabaseAiDrawerRequest = (request: DatabaseAiDrawerRequestRecord) => {
  const stored = cloneDatabaseAiDrawerRequestRecord(request)
  databaseAiDrawerRequests.set(stored.id, stored)
  return cloneDatabaseAiDrawerRequestRecord(stored)
}

export const findDatabaseAiDrawerRequest = (input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerRequestRecord | null => {
  const requestId = trim(input.requestId)
  if (!requestId) return null
  const request = databaseAiDrawerRequests.get(requestId)
  return request ? cloneDatabaseAiDrawerRequestRecord(request) : null
}

export const updateDatabaseAiDrawerRequest = (
  input: DatabaseAiDrawerLifecycleInput,
  patch: Partial<Pick<DatabaseAiDrawerRequestRecord, 'status' | 'text' | 'targetDialect' | 'updatedAt'>>,
  now: () => number
): DatabaseAiDrawerRequestRecord | null => {
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return null
  const updated = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? now()
  }
  databaseAiDrawerRequests.set(updated.id, cloneDatabaseAiDrawerRequestRecord(updated))
  return cloneDatabaseAiDrawerRequestRecord(updated)
}
