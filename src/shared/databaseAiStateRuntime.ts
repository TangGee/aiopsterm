import { randomUUID } from 'crypto'
import type {
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneStateContext,
  DatabaseAiPaneStateSnapshot
} from './contracts/database'
import { isSupportedDatabaseAiEngine } from './databaseAiSqlRuntime'

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

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

export const createDatabaseAiPaneMessageRecord = (
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

export const cloneDatabaseAiPaneMessageRecord = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({ ...message })

const normalizeDatabaseAiPaneStateContext = (context?: Partial<DatabaseAiPaneStateContext>): DatabaseAiPaneStateContext => {
  const dbType = context?.dbType && isSupportedDatabaseAiEngine(context.dbType) ? context.dbType : ''
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
