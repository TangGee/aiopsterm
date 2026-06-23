import { randomUUID } from 'crypto'
import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import {
  createAgentSessionEventStreamRuntime,
  type AgentSessionEventStreamListResult
} from './agentSessionEventStreamRuntime'
import { createAgentSessionAuditRuntime, type ManagedAiSessionAuditKind } from './agentSessionAuditRuntime'
import {
  createAgentSessionAutoNamingRuntime,
  type ManagedAiSessionAutoNamingRuntime
} from './agentSessionAutoNamingRuntime'
import { createAgentSessionStoreRuntime } from './agentSessionStoreRuntime'
import {
  autoTitleFor,
  cleanOptionalText,
  cleanText,
  compactRawValue,
  compactString,
  decisionKinds,
  defaultAgentHibernationConfig,
  firstText,
  isRecord,
  managedAiSessionStateForEvent,
  nestedRecord,
  normalizeAgentHibernationConfig,
  normalizeAiAgentSessionEventInput,
  normalizeSource,
  normalizeWaitTimeoutMs,
  pendingDecisionKey,
  resumeCommandFor,
  sessionKey,
  sourceLabel,
  normalizeRecordEvent
} from './agentSessionNormalization'
import { createAgentSessionNotificationRuntime } from './agentSessionNotificationRuntime'
import type {
  AiAgentSessionEvent,
  AiAgentSessionEventInput,
  AiAgentSessionEventResult,
  AiAgentSessionSource,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiSessionEvent,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionClearInput,
  ManagedAiSessionDecision,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionHibernateInput,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiNotificationClearResult,
  ManagedAiNotificationDismissInput,
  ManagedAiNotificationListInput,
  ManagedAiNotificationListResult,
  ManagedAiNotificationMarkReadInput,
  ManagedAiNotificationMutationResult,
  ManagedAiNotificationOpenInput,
  ManagedAiSessionRecord,
  ManagedAiSessionRenameInput,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot
} from '@shared/contracts/managedAiSessions'

export { normalizeAiAgentSessionEventInput } from './agentSessionNormalization'
export type { ManagedAiSessionAutoNamingInput, ManagedAiSessionAutoNamingRuntime } from './agentSessionAutoNamingRuntime'

export type { AgentSessionEventStreamCategory, AgentSessionEventStreamFrame, AgentSessionEventStreamListResult } from './agentSessionEventStreamRuntime'

export type AgentSessionEventSink = (event: AiAgentSessionEvent) => void

type AgentSessionSocketResponse = AiAgentSessionEventResult & {
  status?: 'acknowledged' | 'pending' | 'resolved' | 'timeout'
  agentOutput?: Record<string, unknown>
}

type PendingAgentDecision = {
  source: AiAgentSessionSource
  sessionId: string
  requestId: string
  event: AiAgentSessionEvent
  raw: Record<string, unknown>
  timer: NodeJS.Timeout
  resolve: (response: AgentSessionSocketResponse) => void
}

type AgentSessionSocketRuntime = {
  userDataPath: string
  emit: AgentSessionEventSink
}

const storeVersion = 1
const maxSessions = 200
const maxEventsPerSession = 200
const maxDecisionsPerSession = 40

let server: Server | null = null
let socketPath = ''
let eventSink: AgentSessionEventSink | null = null
let sessions = new Map<string, ManagedAiSessionRecord>()
let agentHibernationConfig: AgentHibernationConfig = { ...defaultAgentHibernationConfig }
let pendingDecisions = new Map<string, PendingAgentDecision>()
let emitManagedAiSessionEvent: (event: ManagedAiSessionEvent) => void = () => undefined

const agentSessionEventStreamRuntime = createAgentSessionEventStreamRuntime({
  compactRawValue,
  cleanText,
  cleanOptionalText,
  emitManagedAiSessionEvent: (event) => emitManagedAiSessionEvent(event)
})

const publishAgentEventStreamFrame = agentSessionEventStreamRuntime.publishAgentEventStreamFrame
const publishManagedAiStreamFrame = agentSessionEventStreamRuntime.publishManagedAiStreamFrame
const auditRuntime = createAgentSessionAuditRuntime({ compactString })
const appendManagedAiSessionAudit = auditRuntime.appendManagedAiSessionAudit
const storeRuntime = createAgentSessionStoreRuntime({
  storeVersion,
  getSnapshot: () => snapshot(),
  getAgentHibernationConfig: () => agentHibernationConfig,
  applyLoadedStore: (loaded) => {
    sessions = loaded.sessions
    agentHibernationConfig = loaded.agentHibernationConfig
  }
})
const autoNamingRuntime = createAgentSessionAutoNamingRuntime({
  getSession: (key) => sessions.get(key),
  setSession: (key, session) => {
    sessions.set(key, session)
  },
  persistSnapshot: () => storeRuntime.persistSnapshot(),
  appendManagedAiSessionAudit,
  publishManagedAiStreamFrame
})

const notificationRuntime = createAgentSessionNotificationRuntime({
  loadStoreIfNeeded: () => loadStoreIfNeeded(),
  getSnapshot: () => snapshot(),
  getSession: (source, sessionId) => sessions.get(sessionKey(source, sessionId)) || null,
  getSessions: () => [...sessions.values()],
  deleteSession: (source, sessionId) => sessions.delete(sessionKey(source, sessionId)),
  persistSnapshot: () => persistSnapshot(),
  replyManagedAiSession: (input) => replyManagedAiSession(input),
  bulkManagedAiSessions: (input) => bulkManagedAiSessions(input),
  appendManagedAiSessionAudit,
  publishManagedAiStreamFrame,
  maxNotifications: maxSessions
})
emitManagedAiSessionEvent = autoNamingRuntime.emitManagedAiSessionEvent

export const configureManagedAiSessionAutoNamingRuntime = (config?: ManagedAiSessionAutoNamingRuntime) => {
  autoNamingRuntime.configure(config)
}

export const listManagedAiSessionEvents = (input: Record<string, unknown> = {}): AgentSessionEventStreamListResult =>
  agentSessionEventStreamRuntime.listManagedAiSessionEvents(input)

const auditPathFor = (userDataPath: string) => join(userDataPath, 'agent-sessions', 'managed-ai-sessions.audit.jsonl')

const auditEventReceived = (event: AiAgentSessionEvent, session: ManagedAiSessionRecord) => {
  appendManagedAiSessionAudit({
    at: event.receivedAt,
    kind: 'event.received',
    source: event.source,
    sessionId: event.sessionId,
    event: event.event,
    state: session.state,
    title: session.title,
    summary: event.summary,
    requestId: event.requestId,
    requestKind: event.requestKind,
    decisionMode: event.decisionMode,
    waitTimeoutMs: event.waitTimeoutMs,
    toolName: event.toolName,
    actionable: event.actionable
  })
}

const auditSocketCompleted = (event: AiAgentSessionEvent, response: AgentSessionSocketResponse) => {
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'event.socket.completed',
    source: event.source,
    sessionId: event.sessionId,
    event: event.event,
    title: event.title,
    summary: event.summary,
    requestId: event.requestId,
    requestKind: event.requestKind,
    decisionMode: event.decisionMode,
    waitTimeoutMs: event.waitTimeoutMs,
    toolName: event.toolName,
    actionable: event.actionable,
    status: response.status,
    errorCode: response.ok ? undefined : response.errorCode
  })
}

const auditDecisionCreated = (session: ManagedAiSessionRecord, decision: ManagedAiSessionDecision, kind: ManagedAiSessionAuditKind = 'decision.created') => {
  appendManagedAiSessionAudit({
    at: decision.createdAt,
    kind,
    source: session.source,
    sessionId: session.id,
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary,
    requestId: session.pendingRequestId,
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    waitTimeoutMs: session.waitTimeoutMs,
    toolName: session.toolName,
    decisionKind: decision.kind,
    decisionId: decision.id
  })
}

const snapshot = (): ManagedAiSessionSnapshot => ({
  sessions: [...sessions.values()]
    .sort((first, second) => second.lastActivityAt - first.lastActivityAt)
    .map((session) => ({
      ...session,
      events: [...session.events],
      decisions: [...session.decisions]
    }))
})

const persistSnapshot = storeRuntime.persistSnapshot
const loadStoreIfNeeded = storeRuntime.loadStoreIfNeeded
const storePathFor = storeRuntime.storePathFor

export const configureAiAgentSessionStore = async (userDataPath: string) => {
  auditRuntime.configure(auditPathFor(userDataPath))
  await storeRuntime.configure(userDataPath)
}

const upsertSessionForEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) => {
  const key = sessionKey(event.source, event.sessionId)
  const existing = sessions.get(key)
  const state = managedAiSessionStateForEvent(event.event, existing?.state, event.agentLifecycle, event)
  const nextAutoTitle = event.event === 'stop' ? autoTitleFor(event, existing) : existing?.autoTitle
  const title = existing?.userTitle || nextAutoTitle || event.title || existing?.title || sourceLabel(event.source)
  const handledAt = state === 'needsInput' ? undefined : existing?.handledAt
  const pendingRequestId = state === 'needsInput' && event.actionable && event.requestId ? event.requestId : undefined
  const requestKind = event.requestKind || existing?.requestKind || 'telemetry'
  const decisionMode = event.decisionMode || existing?.decisionMode || 'telemetry'
  const waitTimeoutMs = event.waitTimeoutMs || existing?.waitTimeoutMs
  const toolName = event.toolName || existing?.toolName
  const cwd = event.cwd || existing?.cwd
  const launchCommand = event.launchCommand || existing?.launchCommand
  const resumeCommand = event.resumeCommand && event.cwd ? event.resumeCommand : existing?.resumeCommand || resumeCommandFor(event.source, event.sessionId, cwd, launchCommand)
  const processId = event.processId || existing?.processId
  const parentProcessId = event.parentProcessId || existing?.parentProcessId
  const processGroupId = event.processGroupId || existing?.processGroupId
  const agentLifecycle = event.agentLifecycle || existing?.agentLifecycle
  const preserveHibernation = existing?.hibernated === true && event.event !== 'session_start'
  const record: ManagedAiSessionRecord = {
    id: event.sessionId,
    source: event.source,
    title,
    summary: event.summary || existing?.summary || '',
    state,
    lastEvent: event.event,
    lastActivityAt: event.receivedAt,
    createdAt: existing?.createdAt || event.receivedAt,
    updatedAt: Date.now(),
    ...(handledAt ? { handledAt } : {}),
    ...(nextAutoTitle ? { autoTitle: nextAutoTitle } : existing?.autoTitle ? { autoTitle: existing.autoTitle } : {}),
    ...(existing?.userTitle ? { userTitle: existing.userTitle } : {}),
    ...(existing?.autoTitleEventCount ? { autoTitleEventCount: existing.autoTitleEventCount } : {}),
    ...(existing?.autoTitleAttemptedAt ? { autoTitleAttemptedAt: existing.autoTitleAttemptedAt } : {}),
    ...(existing?.autoTitleGeneratedAt ? { autoTitleGeneratedAt: existing.autoTitleGeneratedAt } : {}),
    ...(event.panelId || existing?.panelId ? { panelId: event.panelId || existing?.panelId } : {}),
    ...(event.terminalSessionId || existing?.terminalSessionId ? { terminalSessionId: event.terminalSessionId || existing?.terminalSessionId } : {}),
    ...(event.workspaceId || existing?.workspaceId ? { workspaceId: event.workspaceId || existing?.workspaceId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
    ...(pendingRequestId ? { pendingRequestId } : {}),
    requestKind,
    decisionMode,
    ...(waitTimeoutMs ? { waitTimeoutMs } : {}),
    ...(toolName ? { toolName } : {}),
    ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(processId ? { processId } : {}),
    ...(parentProcessId ? { parentProcessId } : {}),
    ...(processGroupId ? { processGroupId } : {}),
    ...(agentLifecycle ? { agentLifecycle } : {}),
    ...(preserveHibernation ? { hibernated: true } : {}),
    ...(preserveHibernation && existing?.hibernatedAt ? { hibernatedAt: existing.hibernatedAt } : {}),
    ...(preserveHibernation && existing?.hibernationReason ? { hibernationReason: existing.hibernationReason } : {}),
    ...(preserveHibernation && existing?.hibernatedTerminalSessionId ? { hibernatedTerminalSessionId: existing.hibernatedTerminalSessionId } : {}),
    events: [...(existing?.events || []), normalizeRecordEvent(event, raw)].slice(-maxEventsPerSession),
    decisions: [...(existing?.decisions || [])].slice(-maxDecisionsPerSession)
  }
  sessions.set(key, record)
  const ordered = [...sessions.values()].sort((first, second) => second.lastActivityAt - first.lastActivityAt)
  sessions = new Map(ordered.slice(0, maxSessions).map((session) => [sessionKey(session.source, session.id), session]))
  persistSnapshot()
  auditEventReceived(event, record)
  publishAgentEventStreamFrame(event, record)
  autoNamingRuntime.maybeRunAutoNaming(record, event)
  return record
}

export const publishAiAgentSessionEvent = (input: AiAgentSessionEventInput, emit: AgentSessionEventSink | null = eventSink) => {
  const result = normalizeAiAgentSessionEventInput(input)
  if (!result.ok || !result.data) return result
  upsertSessionForEvent(result.data, input as Record<string, unknown>)
  emit?.(result.data)
  return result
}

const isBlockingAgentEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) =>
  event.source === 'claude-code' &&
  (event.requestKind === 'permission' || event.requestKind === 'question' || event.requestKind === 'plan') &&
  event.decisionMode === 'blocking' &&
  event.actionable === true &&
  Boolean(event.requestId || cleanOptionalText(raw.requestId || raw.request_id || raw.tool_use_id))

const questionAnswersFromMessage = (raw: Record<string, unknown>, message?: string) => {
  const text = cleanText(message)
  if (!text) return {}
  const toolInput = nestedRecord(raw, 'tool_input')
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const answers: Record<string, string> = {}
  ;(lines.length ? lines : [text]).forEach((answer, index) => {
    const question = questions[index] && typeof questions[index] === 'object' && !Array.isArray(questions[index]) ? (questions[index] as Record<string, unknown>) : null
    const key = firstText(question || {}, ['question', 'header', 'prompt']) || `Answer ${index + 1}`
    answers[key] = answer
  })
  return answers
}

const renderClaudeHookOutput = (session: ManagedAiSessionRecord, decision: ManagedAiSessionDecision, pending?: PendingAgentDecision) => {
  const latest = session.events.slice().reverse().find((event) => event.requestId === session.pendingRequestId) || session.events.at(-1)
  const raw = pending?.raw || latest?.raw || {}
  const hookDecision = (behavior: 'allow' | 'deny', options: { message?: string; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] } = {}) => {
    const inner: Record<string, unknown> = { behavior }
    if (behavior === 'deny') inner.message = cleanOptionalText(options.message) || 'User denied permission via aiopsterm.'
    if (options.updatedInput && Object.keys(options.updatedInput).length) inner.updatedInput = options.updatedInput
    if (options.updatedPermissions && options.updatedPermissions.length) inner.updatedPermissions = options.updatedPermissions
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: inner
      }
    }
  }

  if (decision.kind === 'handled') return {}
  if (decision.kind === 'deny') return hookDecision('deny', { message: decision.message })
  if (pending?.event.event === 'question' || session.lastEvent === 'question' || latest?.event === 'question') {
    const toolInput = nestedRecord(raw, 'tool_input')
    const updatedInput = {
      ...toolInput,
      answers: questionAnswersFromMessage(raw, decision.message)
    }
    return hookDecision('allow', { updatedInput })
  }

  const permissionSuggestions = Array.isArray(raw.permission_suggestions) ? raw.permission_suggestions : []
  if (decision.kind === 'always') return hookDecision('allow', { updatedPermissions: permissionSuggestions })
  if (decision.kind === 'bypass') {
    return hookDecision('allow', {
      updatedPermissions: [
        {
          type: 'setMode',
          mode: 'bypassPermissions',
          destination: 'session'
        }
      ]
    })
  }
  return hookDecision('allow')
}

const resolvePendingDecision = (session: ManagedAiSessionRecord, decision: ManagedAiSessionDecision) => {
  const requestId = session.pendingRequestId
  if (!requestId) return
  const key = pendingDecisionKey(session.source, session.id, requestId)
  const pending = pendingDecisions.get(key)
  if (!pending) return
  pendingDecisions.delete(key)
  clearTimeout(pending.timer)
  auditDecisionCreated(session, decision, 'decision.resolved')
  pending.resolve({
    ok: true,
    data: session.events.at(-1),
    status: 'resolved',
    agentOutput: session.source === 'claude-code' ? renderClaudeHookOutput(session, decision, pending) : {}
  })
}

const waitForAgentDecision = (event: AiAgentSessionEvent, raw: Record<string, unknown>) =>
  new Promise<AgentSessionSocketResponse>((resolve) => {
    const requestId = event.requestId || cleanOptionalText(raw.requestId || raw.request_id || raw.tool_use_id)
    if (!requestId) {
      resolve({ ok: true, data: event, status: 'acknowledged' })
      return
    }
    const key = pendingDecisionKey(event.source, event.sessionId, requestId)
    const timeoutMs = event.waitTimeoutMs || normalizeWaitTimeoutMs(raw.waitTimeoutMs || raw.wait_timeout_ms)
    const timer = setTimeout(() => {
      pendingDecisions.delete(key)
      appendManagedAiSessionAudit({
        at: Date.now(),
        kind: 'decision.timeout',
        source: event.source,
        sessionId: event.sessionId,
        event: event.event,
        title: event.title,
        summary: event.summary,
        requestId,
        requestKind: event.requestKind,
        decisionMode: event.decisionMode,
        waitTimeoutMs: timeoutMs,
        toolName: event.toolName
      })
      resolve({ ok: true, data: event, status: 'timeout', agentOutput: {} })
    }, timeoutMs)
    pendingDecisions.set(key, {
      source: event.source,
      sessionId: event.sessionId,
      requestId,
      event,
      raw,
      timer,
      resolve
    })
  })

const publishAiAgentSessionSocketEvent = async (input: AiAgentSessionEventInput, emit: AgentSessionEventSink | null): Promise<AgentSessionSocketResponse> => {
  const result = normalizeAiAgentSessionEventInput(input)
  if (!result.ok || !result.data) return result
  const raw = input as Record<string, unknown>
  const waiter = isBlockingAgentEvent(result.data, raw) ? waitForAgentDecision(result.data, raw) : null
  upsertSessionForEvent(result.data, raw)
  emit?.(result.data)
  if (!waiter) {
    const response: AgentSessionSocketResponse = { ...result, status: 'acknowledged' }
    auditSocketCompleted(result.data, response)
    return response
  }
  const response = await waiter
  auditSocketCompleted(result.data, response)
  return response
}

export const listManagedAiSessions = async (): Promise<ManagedAiSessionListResult> => {
  await loadStoreIfNeeded()
  return { ok: true, data: snapshot() }
}

export const listManagedAiNotifications = async (input: ManagedAiNotificationListInput = {}): Promise<ManagedAiNotificationListResult> => {
  return notificationRuntime.list(input)
}

const mutationError = (errorCode: string, errorMessage: string): ManagedAiSessionMutationResult => ({ ok: false, errorCode, errorMessage })

const bulkError = (errorCode: string, errorMessage: string): ManagedAiSessionBulkResult => ({ ok: false, errorCode, errorMessage })

const hibernationError = (errorCode: string, errorMessage: string): ManagedAiSessionHibernateResult => ({ ok: false, errorCode, errorMessage })

const getSessionForInput = (sourceValue: unknown, sessionIdValue: unknown) => {
  const source = normalizeSource(sourceValue)
  const sessionId = cleanOptionalText(sessionIdValue)
  if (!source || !sessionId) return null
  return sessions.get(sessionKey(source, sessionId)) || null
}

const resolveSessionForSelector = (input: Pick<ManagedAiSessionHibernateInput, 'source' | 'sessionId'>) => {
  const source = normalizeSource(input?.source)
  const sessionId = cleanOptionalText(input?.sessionId)
  if (!sessionId) return { error: hibernationError('MANAGED_AI_SESSION_ID_REQUIRED', 'Managed AI session id is required.') }
  if (source) {
    const session = sessions.get(sessionKey(source, sessionId))
    if (!session) return { error: hibernationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.') }
    return { session }
  }
  const matches = [...sessions.values()].filter((session) => session.id === sessionId)
  if (!matches.length) return { error: hibernationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.') }
  if (matches.length > 1) return { error: hibernationError('MANAGED_AI_SESSION_SOURCE_REQUIRED', 'Multiple managed AI sessions match this sessionId; pass source.') }
  return { session: matches[0] }
}

export const getAgentHibernationConfig = async (): Promise<AgentHibernationConfigResult> => {
  await loadStoreIfNeeded()
  return { ok: true, data: { config: { ...agentHibernationConfig } } }
}

export const setAgentHibernationConfig = async (input: Partial<AgentHibernationConfig> = {}): Promise<AgentHibernationConfigResult> => {
  await loadStoreIfNeeded()
  agentHibernationConfig = normalizeAgentHibernationConfig(input, agentHibernationConfig)
  persistSnapshot()
  return { ok: true, data: { config: { ...agentHibernationConfig } } }
}

export const hibernateManagedAiSession = async (input: ManagedAiSessionHibernateInput): Promise<ManagedAiSessionHibernateResult> => {
  await loadStoreIfNeeded()
  if (!agentHibernationConfig.enabled) return hibernationError('AGENT_HIBERNATION_DISABLED', 'Agent hibernation is disabled.')
  const resolved = resolveSessionForSelector(input)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') return hibernationError('AGENT_HIBERNATION_NEEDS_INPUT', 'Managed AI session needs input and cannot hibernate.')
  if (!session.resumeCommand) return hibernationError('AGENT_HIBERNATION_RESUME_UNAVAILABLE', 'Managed AI session has no resume command.')
  const now = Date.now()
  const next: ManagedAiSessionRecord = {
    ...session,
    hibernated: true,
    hibernatedAt: now,
    hibernationReason: cleanOptionalText(input.reason) || 'manual',
    hibernatedTerminalSessionId: cleanOptionalText(input.terminalSessionId) || session.terminalSessionId,
    state: session.state === 'working' ? 'idle' : session.state,
    agentLifecycle: session.agentLifecycle === 'running' ? 'idle' : session.agentLifecycle,
    updatedAt: now
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: now,
    kind: 'session.hibernated',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary,
    reason: next.hibernationReason
  })
  publishManagedAiStreamFrame('managed_ai.session.hibernated', next, { reason: next.hibernationReason })
  return { ok: true, data: { session: next, snapshot: snapshot(), config: { ...agentHibernationConfig } } }
}

export const wakeManagedAiSession = async (input: ManagedAiSessionHibernateInput): Promise<ManagedAiSessionHibernateResult> => {
  await loadStoreIfNeeded()
  const resolved = resolveSessionForSelector(input)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const now = Date.now()
  const {
    hibernated: _hibernated,
    hibernatedAt: _hibernatedAt,
    hibernationReason: _hibernationReason,
    hibernatedTerminalSessionId: _hibernatedTerminalSessionId,
    ...rest
  } = session
  const next: ManagedAiSessionRecord = {
    ...rest,
    updatedAt: now
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: now,
    kind: 'session.woke',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary,
    reason: cleanOptionalText(input.reason) || 'manual'
  })
  publishManagedAiStreamFrame('managed_ai.session.woke', next, { reason: cleanOptionalText(input.reason) || 'manual' })
  return { ok: true, data: { session: next, snapshot: snapshot(), config: { ...agentHibernationConfig } } }
}

export const replyManagedAiSession = async (input: ManagedAiSessionReplyInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const session = getSessionForInput(input?.source, input?.sessionId)
  if (!session) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  const kind = cleanText(input.kind) as ManagedAiSessionDecisionKind
  if (!decisionKinds.has(kind)) return mutationError('MANAGED_AI_SESSION_DECISION_INVALID', 'Managed AI session decision kind is invalid.')
  const decision: ManagedAiSessionDecision = {
    id: randomUUID(),
    kind,
    ...(cleanOptionalText(input.message) ? { message: cleanOptionalText(input.message) } : {}),
    createdAt: Date.now()
  }
  const { pendingRequestId: _pendingRequestId, ...sessionWithoutPending } = session
  const next: ManagedAiSessionRecord = {
    ...sessionWithoutPending,
    state: session.state === 'needsInput' ? 'idle' : session.state,
    handledAt: decision.createdAt,
    updatedAt: decision.createdAt,
    decisions: [...session.decisions, decision].slice(-maxDecisionsPerSession)
  }
  resolvePendingDecision(session, decision)
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  auditDecisionCreated(session, decision)
  publishManagedAiStreamFrame('managed_ai.decision.created', next, {
    decisionKind: decision.kind,
    decisionId: decision.id,
    requestId: session.pendingRequestId
  })
  return { ok: true, data: { session: next, snapshot: snapshot() } }
}

export const renameManagedAiSession = async (input: ManagedAiSessionRenameInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const session = getSessionForInput(input?.source, input?.sessionId)
  if (!session) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  const title = compactString(input.title, 80)
  if (!title) return mutationError('MANAGED_AI_SESSION_TITLE_REQUIRED', 'Managed AI session title is required.')
  const updatedAt = Date.now()
  const next: ManagedAiSessionRecord = {
    ...session,
    title,
    userTitle: title,
    updatedAt
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: updatedAt,
    kind: 'session.renamed',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary
  })
  publishManagedAiStreamFrame('managed_ai.session.renamed', next, { title: next.title })
  return { ok: true, data: { session: next, snapshot: snapshot() } }
}

export const clearManagedAiSession = async (input: ManagedAiSessionClearInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const source = normalizeSource(input?.source)
  const sessionId = cleanOptionalText(input?.sessionId)
  if (!source || !sessionId) return mutationError('MANAGED_AI_SESSION_INPUT_INVALID', 'Managed AI session source and sessionId are required.')
  const key = sessionKey(source, sessionId)
  const session = sessions.get(key)
  if (!session) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  sessions.delete(key)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'session.cleared',
    source,
    sessionId,
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary
  })
  publishManagedAiStreamFrame('managed_ai.session.cleared', session, {})
  return { ok: true, data: { snapshot: snapshot() } }
}

export const bulkManagedAiSessions = async (input: ManagedAiSessionBulkInput): Promise<ManagedAiSessionBulkResult> => {
  await loadStoreIfNeeded()
  const operation = input?.operation
  if (operation !== 'mark-handled' && operation !== 'clear-ended' && operation !== 'clear-all') {
    return bulkError('MANAGED_AI_SESSION_BULK_OPERATION_INVALID', 'Managed AI session bulk operation is invalid.')
  }
  const sourceFilter = new Set((Array.isArray(input.sources) ? input.sources.map(normalizeSource).filter(Boolean) : []) as AiAgentSessionSource[])
  const idFilter = new Set(Array.isArray(input.sessionIds) ? input.sessionIds.map(cleanText).filter(Boolean) : [])
  const matches = (session: ManagedAiSessionRecord) =>
    (!sourceFilter.size || sourceFilter.has(session.source)) && (!idFilter.size || idFilter.has(session.id))
  let changed = 0
  const now = Date.now()
  if (operation === 'mark-handled') {
    sessions.forEach((session, key) => {
      if (!matches(session) || session.state !== 'needsInput') return
      changed += 1
      const decision: ManagedAiSessionDecision = { id: randomUUID(), kind: 'handled', createdAt: now }
      sessions.set(key, {
        ...session,
        state: 'idle',
        handledAt: now,
        updatedAt: now,
        decisions: [...session.decisions, decision].slice(-maxDecisionsPerSession)
      })
    })
  } else if (operation === 'clear-ended') {
    sessions.forEach((session, key) => {
      if (!matches(session) || session.state !== 'ended') return
      changed += 1
      sessions.delete(key)
    })
  } else {
    sessions.forEach((session, key) => {
      if (!matches(session)) return
      changed += 1
      sessions.delete(key)
    })
  }
  if (changed) persistSnapshot()
  appendManagedAiSessionAudit({
    at: now,
    kind: 'sessions.bulk',
    operation,
    changed
  })
  publishManagedAiStreamFrame('managed_ai.sessions.bulk', null, {
    operation,
    changed,
    sources: [...sourceFilter],
    sessionIds: [...idFilter]
  })
  return { ok: true, data: { changed, snapshot: snapshot() } }
}

export const markManagedAiNotificationRead = async (input: ManagedAiNotificationMarkReadInput): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.markRead(input)
}

export const dismissManagedAiNotification = async (input: ManagedAiNotificationDismissInput): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.dismiss(input)
}

export const clearManagedAiNotifications = async (): Promise<ManagedAiNotificationClearResult> => {
  return notificationRuntime.clear()
}

export const openManagedAiNotification = async (input: ManagedAiNotificationOpenInput): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.open(input)
}

export const jumpToUnreadManagedAiNotification = async (): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.jumpToUnread()
}

const writeSocketResponse = (socket: Socket, response: AgentSessionSocketResponse) => {
  socket.write(`${JSON.stringify(response)}\n`)
}

const isEventStreamRequest = (record: unknown) => {
  if (!isRecord(record)) return false
  const method = cleanText(record.method || record.type || record.command).toLowerCase()
  return method === 'events.stream' || method === 'stream' || method === 'agent.events.stream'
}

const handleSocketLine = async (socket: Socket, line: string, emit: AgentSessionEventSink) => {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    if (isEventStreamRequest(parsed)) {
      agentSessionEventStreamRuntime.startEventStream(socket, parsed)
      return
    }
    writeSocketResponse(socket, await publishAiAgentSessionSocketEvent(parsed as AiAgentSessionEventInput, emit))
  } catch {
    writeSocketResponse(socket, {
      ok: false,
      errorCode: 'AI_AGENT_EVENT_JSON_INVALID',
      errorMessage: 'AI agent event socket payload must be newline-delimited JSON.'
    })
  }
}

export const agentSessionSocketPathFor = (userDataPath: string) => {
  if (process.platform === 'win32') return `\\\\.\\pipe\\aiopsterm-agent-sessions-${process.pid}`
  return join(userDataPath, 'agent-sessions', `aiopsterm-agent-sessions-${process.pid}.sock`)
}

export const agentHookScriptPathFor = (appPath: string, resourcesPath: string) => {
  const scriptName = 'aiopsterm-agent-hook.js'
  const candidates = [join(resourcesPath, scriptName), join(resourcesPath, 'resources', scriptName), join(appPath, 'resources', scriptName)]
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export const getAiAgentSessionSocketPath = () => socketPath

export const ensureAiAgentSessionServer = async ({ userDataPath, emit }: AgentSessionSocketRuntime) => {
  eventSink = emit
  await configureAiAgentSessionStore(userDataPath)
  if (server && socketPath) return socketPath
  socketPath = agentSessionSocketPathFor(userDataPath)
  if (process.platform !== 'win32') {
    await mkdir(join(userDataPath, 'agent-sessions'), { recursive: true })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) handleSocketLine(socket, line, emit)
        newlineIndex = buffer.indexOf('\n')
      }
    })
    socket.on('end', () => {
      const line = buffer.trim()
      if (line) handleSocketLine(socket, line, emit)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(socketPath, () => {
      server?.off('error', reject)
      resolve()
    })
  })
  return socketPath
}

export const closeAiAgentSessionServer = () => {
  const existing = server
  server = null
  if (existing) existing.close()
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
  eventSink = null
  pendingDecisions.forEach((pending) => {
    clearTimeout(pending.timer)
    appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'decision.timeout',
      source: pending.source,
      sessionId: pending.sessionId,
      event: pending.event.event,
      title: pending.event.title,
      summary: pending.event.summary,
      requestId: pending.requestId
    })
    pending.resolve({ ok: true, status: 'timeout', agentOutput: {} })
  })
  pendingDecisions = new Map()
  agentSessionEventStreamRuntime.closeEventStreams()
}

export const __testing = {
  sourceLabel,
  storePathFor,
  auditPathFor,
  managedAiSessionStateForEvent,
  autoTitleFor,
  streamBootId: agentSessionEventStreamRuntime.streamBootId,
  streamEventCount: agentSessionEventStreamRuntime.streamEventCount,
  streamLatestSeq: agentSessionEventStreamRuntime.streamLatestSeq,
  flushManagedAiSessionWrites: async () => {
    await storeRuntime.flush()
    await auditRuntime.flush()
  }
}
