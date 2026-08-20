import type { ExternalCodexMcpResponse } from '@shared/contracts/control'
import type {
  ManagedAiNotificationRecord,
  ManagedAiSessionClearInput,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionRecord,
  ManagedAiSessionReplyInput
} from '@shared/contracts/managedAiSessions'
import {
  clearManagedAiNotifications,
  clearManagedAiSession,
  dismissManagedAiNotification,
  jumpToUnreadManagedAiNotification,
  listManagedAiNotifications,
  listManagedAiSessionEvents,
  listManagedAiSessions,
  markManagedAiNotificationRead,
  openManagedAiNotification,
  replyManagedAiSession,
  waitForManagedAiSessionEvent
} from '../agent/agentSessions'

export type ExternalCodexMcpManagedAiRuntimeConfig = {
  focusManagedAiSession?: (request: ManagedAiSessionFocusRequest) => void
  signal?: AbortSignal
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

const normalizeInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numberValue)))
}

const ok = <T extends Record<string, unknown>>(data: T, target?: Record<string, unknown>): ExternalCodexMcpResponse<T> => ({
  ok: true,
  data,
  ...(target ? { target } : {})
})

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>, target?: Record<string, unknown>): ExternalCodexMcpResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {}),
  ...(target ? { target } : {})
})

export const externalCodexMcpManagedAiMethods: ReadonlySet<string> = new Set([
  'list_ai_sessions',
  'get_ai_session',
  'list_ai_approvals',
  'focus_ai_session',
  'reply_ai_session',
  'approve_ai_session',
  'deny_ai_session',
  'answer_ai_question',
  'handle_ai_session',
  'clear_ai_session',
  'list_ai_session_events',
  'wait_ai_session_completion',
  'list_ai_notifications',
  'mark_ai_notification_read',
  'dismiss_ai_notification',
  'clear_ai_notifications',
  'open_ai_notification',
  'jump_to_unread_ai_notification'
])

const managedAiSessionSummary = (session: ManagedAiSessionRecord, options: { includeEvents?: boolean; eventLimit?: number } = {}) => {
  const eventLimit = normalizeInteger(options.eventLimit, 5, 1, 50)
  return {
    source: session.source,
    sessionId: session.id,
    title: session.title,
    summary: session.summary,
    state: session.state,
    needsInput: session.state === 'needsInput',
    lastEvent: session.lastEvent,
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    ...(session.waitTimeoutMs ? { waitTimeoutMs: session.waitTimeoutMs } : {}),
    ...(session.toolName ? { toolName: session.toolName } : {}),
    actionable: session.actionable === true,
    ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
    ...(session.launchCommand ? { launchCommand: session.launchCommand } : {}),
    ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
    ...(session.processId ? { processId: session.processId } : {}),
    ...(session.parentProcessId ? { parentProcessId: session.parentProcessId } : {}),
    ...(session.processGroupId ? { processGroupId: session.processGroupId } : {}),
    ...(session.agentLifecycle ? { agentLifecycle: session.agentLifecycle } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.handledAt ? { handledAt: session.handledAt } : {}),
    eventCount: session.events.length,
    decisionCount: session.decisions.length,
    ...(options.includeEvents
      ? {
          events: session.events.slice(-eventLimit).map((event) => ({
            id: event.id,
            source: event.source,
            event: event.event,
            sessionId: event.sessionId,
            title: event.title,
            summary: event.summary,
            receivedAt: event.receivedAt,
            requestKind: event.requestKind,
            decisionMode: event.decisionMode,
            ...(event.waitTimeoutMs ? { waitTimeoutMs: event.waitTimeoutMs } : {}),
            ...(event.toolName ? { toolName: event.toolName } : {}),
            ...(event.requestId ? { requestId: event.requestId } : {}),
            ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : {}),
            ...(event.cwd ? { cwd: event.cwd } : {}),
            ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
            ...(event.agentLifecycle ? { agentLifecycle: event.agentLifecycle } : {})
          }))
        }
      : {})
  }
}

const managedAiApprovalRequestKinds = new Set(['permission', 'question', 'plan'])

const isCodexNativePermissionPrompt = (session: ManagedAiSessionRecord) =>
  session.source === 'codex' && session.requestKind === 'permission' && session.decisionMode === 'local'

const managedAiApprovalCapabilities = (session: ManagedAiSessionRecord) => {
  const localOnly = session.decisionMode !== 'blocking'
  const canUnblockAgent = session.decisionMode === 'blocking' && session.state === 'needsInput' && Boolean(session.pendingRequestId)
  const decisions: ManagedAiSessionDecisionKind[] = []
  const noteParts: string[] = []

  if (!managedAiApprovalRequestKinds.has(session.requestKind)) {
    decisions.push('handled')
    noteParts.push('This managed AI item is informational; aiopsterm can only mark it handled.')
  } else if (isCodexNativePermissionPrompt(session)) {
    decisions.push('handled')
    noteParts.push('Stock Codex permission prompts stay in the Codex TUI; aiopsterm surfaces them as pending and can only mark them handled.')
  } else if (session.requestKind === 'question') {
    decisions.push('reply', 'deny', 'handled')
  } else if (session.requestKind === 'plan') {
    decisions.push('allow', 'deny', 'handled')
  } else if (session.requestKind === 'permission') {
    decisions.push('allow', 'always', 'bypass', 'deny', 'handled')
  }

  if (localOnly && !noteParts.length) {
    noteParts.push('This request is local to aiopsterm; a decision records handling state but may not unblock the agent process.')
  }

  return {
    decisions: [...new Set(decisions)],
    canAllow: decisions.includes('allow'),
    canAlwaysAllow: decisions.includes('always'),
    canBypass: decisions.includes('bypass'),
    canDeny: decisions.includes('deny'),
    canReply: decisions.includes('reply'),
    canHandle: decisions.includes('handled'),
    canUnblockAgent,
    blocking: session.decisionMode === 'blocking',
    localOnly,
    nativePrompt: isCodexNativePermissionPrompt(session),
    ...(noteParts.length ? { note: noteParts.join(' ') } : {})
  }
}

const managedAiApprovalSummary = (session: ManagedAiSessionRecord, options: { includeEvents?: boolean; eventLimit?: number } = {}) => ({
  ...managedAiSessionSummary(session, options),
  approvalId: `managed-ai:${session.source}:${session.id}`,
  pending: session.state === 'needsInput',
  approvalKind: session.requestKind,
  capabilities: managedAiApprovalCapabilities(session)
})

const managedAiNotificationSummary = (notification: ManagedAiNotificationRecord) => ({
  id: notification.id,
  source: notification.source,
  sessionId: notification.sessionId,
  title: notification.title,
  summary: notification.summary,
  body: notification.body,
  state: notification.state,
  event: notification.event,
  read: notification.read,
  isRead: notification.isRead,
  needsInput: notification.needsInput,
  requestKind: notification.requestKind,
  decisionMode: notification.decisionMode,
  ...(notification.waitTimeoutMs ? { waitTimeoutMs: notification.waitTimeoutMs } : {}),
  ...(notification.toolName ? { toolName: notification.toolName } : {}),
  ...(typeof notification.actionable === 'boolean' ? { actionable: notification.actionable } : {}),
  ...(notification.pendingRequestId ? { pendingRequestId: notification.pendingRequestId } : {}),
  ...(notification.panelId ? { panelId: notification.panelId } : {}),
  ...(notification.terminalSessionId ? { terminalSessionId: notification.terminalSessionId } : {}),
  ...(notification.workspaceId ? { workspaceId: notification.workspaceId } : {}),
  ...(notification.cwd ? { cwd: notification.cwd } : {}),
  ...(notification.transcriptPath ? { transcriptPath: notification.transcriptPath } : {}),
  createdAt: notification.createdAt,
  updatedAt: notification.updatedAt,
  lastActivityAt: notification.lastActivityAt,
  ...(notification.readAt ? { readAt: notification.readAt } : {})
})

const listAiSessions = async (params: Record<string, unknown>) => {
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'MANAGED_AI_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
  const query = cleanText(params.query).toLowerCase()
  const source = cleanOptionalText(params.source)
  const state = cleanOptionalText(params.state)
  const needsInput = params.needsInput === true
  const includeEvents = params.includeEvents === true || params.include_events === true
  const eventLimit = normalizeInteger(params.eventLimit || params.event_limit, 5, 1, 50)
  const limit = normalizeInteger(params.limit, 50, 1, 200)
  const filtered = snapshot.data.sessions.filter((session) => {
    if (source && session.source !== source) return false
    if (state && session.state !== state) return false
    if (needsInput && session.state !== 'needsInput') return false
    if (!query) return true
    return [session.source, session.id, session.title, session.summary, session.cwd || '', session.panelId || '', session.terminalSessionId || ''].some((value) =>
      value.toLowerCase().includes(query)
    )
  })
  return ok({
    sessions: filtered.slice(0, limit).map((session) => managedAiSessionSummary(session, { includeEvents, eventLimit })),
    count: filtered.length,
    total: snapshot.data.sessions.length,
    needsInputCount: snapshot.data.sessions.filter((session) => session.state === 'needsInput').length
  })
}

const resolveManagedAiSession = async (params: Record<string, unknown>) => {
  const sessionId = cleanText(params.sessionId || params.session_id)
  if (!sessionId) return { error: fail('AI_SESSION_ID_REQUIRED', 'sessionId is required.') }
  const source = cleanOptionalText(params.source)
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) {
    return { error: fail(snapshot.errorCode || 'MANAGED_AI_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.') }
  }
  const matches = snapshot.data.sessions.filter((session) => session.id === sessionId && (!source || session.source === source))
  if (!matches.length) return { error: fail('AI_SESSION_NOT_FOUND', `Managed AI session was not found: ${source ? `${source}:` : ''}${sessionId}`) }
  if (matches.length > 1) return { error: fail('AI_SESSION_SOURCE_REQUIRED', `Multiple managed AI sessions match ${sessionId}; pass source.`) }
  return { session: matches[0] }
}

const getAiSession = async (params: Record<string, unknown>) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const includeEvents = params.includeEvents !== false && params.include_events !== false
  const eventLimit = normalizeInteger(params.eventLimit || params.event_limit, 25, 1, 100)
  return ok({
    session: managedAiSessionSummary(resolved.session!, { includeEvents, eventLimit })
  })
}

const listAiApprovals = async (params: Record<string, unknown>) => {
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'MANAGED_AI_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
  const query = cleanText(params.query).toLowerCase()
  const source = cleanOptionalText(params.source)
  const pendingOnly = params.pendingOnly === true || params.pending_only === true
  const includeHandled = params.includeHandled === true || params.include_handled === true
  const includeEvents = params.includeEvents === true || params.include_events === true
  const eventLimit = normalizeInteger(params.eventLimit || params.event_limit, 5, 1, 50)
  const limit = normalizeInteger(params.limit, 50, 1, 200)
  const filtered = snapshot.data.sessions.filter((session) => {
    if (!managedAiApprovalRequestKinds.has(session.requestKind)) return false
    if (source && session.source !== source) return false
    if (!includeHandled && session.handledAt) return false
    if (pendingOnly && session.state !== 'needsInput') return false
    if (!query) return true
    return [session.source, session.id, session.title, session.summary, session.cwd || '', session.panelId || '', session.terminalSessionId || ''].some((value) =>
      value.toLowerCase().includes(query)
    )
  })
  return ok({
    approvals: filtered.slice(0, limit).map((session) => managedAiApprovalSummary(session, { includeEvents, eventLimit })),
    count: filtered.length,
    total: snapshot.data.sessions.filter((session) => managedAiApprovalRequestKinds.has(session.requestKind)).length,
    pendingCount: snapshot.data.sessions.filter((session) => managedAiApprovalRequestKinds.has(session.requestKind) && session.state === 'needsInput').length,
    blockingCount: snapshot.data.sessions.filter((session) => managedAiApprovalRequestKinds.has(session.requestKind) && session.decisionMode === 'blocking').length,
    localOnlyCount: snapshot.data.sessions.filter((session) => managedAiApprovalRequestKinds.has(session.requestKind) && session.decisionMode !== 'blocking').length
  })
}

const normalizeAiApprovalDecisionKind = (value: unknown, fallback: ManagedAiSessionDecisionKind = 'allow'): ManagedAiSessionDecisionKind | 'all' | '' => {
  const text = cleanText(value).toLowerCase()
  if (!text) return fallback
  if (text === 'once') return 'allow'
  if (text === 'all' || text === 'all-tools' || text === 'all_tools') return 'all'
  if (text === 'allow' || text === 'always' || text === 'bypass' || text === 'deny' || text === 'reply' || text === 'handled') return text
  return ''
}

const replyAiApproval = async (
  params: Record<string, unknown>,
  requestedKind: ManagedAiSessionDecisionKind | 'all',
  options: { requireMessage?: boolean } = {}
) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const kind: ManagedAiSessionDecisionKind = requestedKind === 'all' ? 'always' : requestedKind
  const capabilities = managedAiApprovalCapabilities(session)
  if (!capabilities.decisions.includes(kind)) {
    return fail('AI_APPROVAL_DECISION_UNSUPPORTED', `Decision ${requestedKind} is not supported for ${session.source}:${session.id}.`, {
      approval: managedAiApprovalSummary(session)
    })
  }
  const message = cleanOptionalText(params.message || params.answer || params.reply)
  if (options.requireMessage && !message) {
    return fail('AI_APPROVAL_MESSAGE_REQUIRED', 'A message is required for this AI approval decision.', {
      approval: managedAiApprovalSummary(session)
    })
  }
  const result = await replyManagedAiSession({
    source: session.source,
    sessionId: session.id,
    kind,
    ...(message ? { message } : {})
  })
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_APPROVAL_REPLY_FAILED', result.errorMessage || 'Managed AI approval reply failed.')
  const nextSession = result.data.session || session
  return ok({
    decisionKind: kind,
    approval: managedAiApprovalSummary(nextSession),
    session: managedAiSessionSummary(nextSession),
    count: result.data.snapshot.sessions.length,
    needsInputCount: result.data.snapshot.sessions.filter((item) => item.state === 'needsInput').length
  })
}

const approveAiSession = async (params: Record<string, unknown>) => {
  const kind = normalizeAiApprovalDecisionKind(params.kind || params.mode, 'allow')
  if (!kind || kind === 'deny' || kind === 'reply') {
    return fail('AI_APPROVAL_DECISION_INVALID', 'approve_ai_session mode must be allow, once, always, all, bypass, or handled.')
  }
  return replyAiApproval(params, kind)
}

const denyAiSession = async (params: Record<string, unknown>) => replyAiApproval(params, 'deny')

const answerAiQuestion = async (params: Record<string, unknown>) => replyAiApproval(params, 'reply', { requireMessage: true })

const handleAiSession = async (params: Record<string, unknown>) => replyAiApproval(params, 'handled')

const focusAiSession = async (params: Record<string, unknown>, config: ExternalCodexMcpManagedAiRuntimeConfig) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const request: ManagedAiSessionFocusRequest = {
    source: session.source,
    sessionId: session.id,
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {})
  }
  config.focusManagedAiSession?.(request)
  return ok({
    focusRequested: typeof config.focusManagedAiSession === 'function',
    session: managedAiSessionSummary(session)
  })
}

const replyAiSession = async (params: Record<string, unknown>) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const kind = cleanText(params.kind) as ManagedAiSessionDecisionKind
  const input: ManagedAiSessionReplyInput = {
    source: session.source,
    sessionId: session.id,
    kind,
    ...(cleanOptionalText(params.message) ? { message: cleanOptionalText(params.message) } : {})
  }
  const result = await replyManagedAiSession(input)
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_SESSION_REPLY_FAILED', result.errorMessage || 'Managed AI session reply failed.')
  return ok({
    session: result.data.session ? managedAiSessionSummary(result.data.session) : managedAiSessionSummary(session),
    count: result.data.snapshot.sessions.length,
    needsInputCount: result.data.snapshot.sessions.filter((item) => item.state === 'needsInput').length
  })
}

const clearAiSession = async (params: Record<string, unknown>) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const input: ManagedAiSessionClearInput = {
    source: session.source,
    sessionId: session.id
  }
  const result = await clearManagedAiSession(input)
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_SESSION_CLEAR_FAILED', result.errorMessage || 'Managed AI session clear failed.')
  return ok({
    cleared: true,
    session: managedAiSessionSummary(session),
    count: result.data.snapshot.sessions.length,
    needsInputCount: result.data.snapshot.sessions.filter((item) => item.state === 'needsInput').length
  })
}

const listAiSessionEvents = (params: Record<string, unknown>) => {
  const result = listManagedAiSessionEvents(params)
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_SESSION_EVENTS_UNAVAILABLE', result.errorMessage || 'Managed AI session events are unavailable.')
  return ok({
    ...result.data,
    boot_id: result.data.bootId,
    after_seq: result.data.afterSeq,
    oldest_seq: result.data.oldestSeq,
    latest_seq: result.data.latestSeq,
    next_seq: result.data.nextSeq
  })
}

const waitAiSessionCompletion = async (
  params: Record<string, unknown>,
  config: ExternalCodexMcpManagedAiRuntimeConfig
) => {
  const resolved = await resolveManagedAiSession(params)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const cursor = listManagedAiSessionEvents({ limit: 1 })
  if (!cursor.ok || !cursor.data) {
    return fail(cursor.errorCode || 'AI_SESSION_EVENTS_UNAVAILABLE', cursor.errorMessage || 'Managed AI session events are unavailable.')
  }
  const suppliedAfterSeq = params.afterSeq ?? params.after_seq
  const afterSeq = Number.isFinite(Number(suppliedAfterSeq))
    ? Math.max(0, Math.floor(Number(suppliedAfterSeq)))
    : cursor.data.latestSeq
  const timeoutMs = normalizeInteger(params.timeoutMs ?? params.timeout_ms, 120_000, 1_000, 180_000)
  const waited = await waitForManagedAiSessionEvent({
    afterSeq,
    timeoutMs,
    signal: config.signal,
    predicate: (frame) => {
      const source = cleanText(frame.payload.source || frame.source)
      const sessionId = cleanText(frame.payload.sessionId || frame.payload.session_id)
      if (source !== session.source || sessionId !== session.id) return false
      const event = cleanText(frame.payload.event).toLowerCase()
      const lifecycle = cleanText(frame.payload.agentLifecycle).toLowerCase()
      return event === 'stop' || event === 'session_end' || (event === 'lifecycle' && lifecycle === 'ended')
    }
  })
  if (waited.aborted) return fail('AI_SESSION_WAIT_CANCELLED', 'Waiting for managed AI session completion was cancelled.')
  const latest = await resolveManagedAiSession({ source: session.source, sessionId: session.id })
  const currentSession = latest.session || session
  const eventName = cleanText(waited.event?.payload.event).toLowerCase()
  const reason = eventName === 'session_end' || currentSession.state === 'ended' ? 'ended' : waited.event ? 'completed' : 'timeout'
  return ok({
    matched: Boolean(waited.event),
    timedOut: waited.timedOut,
    reason,
    timeoutMs,
    protocol: waited.protocol,
    bootId: waited.bootId,
    boot_id: waited.bootId,
    afterSeq: waited.afterSeq,
    after_seq: waited.afterSeq,
    latestSeq: waited.latestSeq,
    latest_seq: waited.latestSeq,
    nextSeq: waited.nextSeq,
    next_seq: waited.nextSeq,
    ...(waited.event ? { event: waited.event } : {}),
    session: managedAiSessionSummary(currentSession, { includeEvents: true, eventLimit: 10 })
  })
}

const listAiNotifications = async (params: Record<string, unknown>) => {
  const result = await listManagedAiNotifications({
    query: cleanOptionalText(params.query),
    source: cleanOptionalText(params.source) as never,
    unread: params.unread === true,
    read: params.read === true,
    limit: params.limit as never
  })
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_NOTIFICATIONS_UNAVAILABLE', result.errorMessage || 'Managed AI notifications are unavailable.')
  return ok({
    notifications: result.data.notifications.map(managedAiNotificationSummary),
    count: result.data.count,
    total: result.data.total,
    unreadCount: result.data.unreadCount
  })
}

const compactNotificationMutation = (result: Awaited<ReturnType<typeof openManagedAiNotification>> | Awaited<ReturnType<typeof markManagedAiNotificationRead>> | Awaited<ReturnType<typeof dismissManagedAiNotification>>) => {
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_NOTIFICATION_MUTATION_FAILED', result.errorMessage || 'Managed AI notification request failed.')
  return ok({
    changed: result.data.changed,
    ...(result.data.notification ? { notification: managedAiNotificationSummary(result.data.notification) } : {}),
    notifications: result.data.notifications.map(managedAiNotificationSummary),
    count: result.data.notifications.length,
    unreadCount: result.data.notifications.filter((notification) => !notification.read).length,
    ...(result.data.focusRequest ? { focusRequest: result.data.focusRequest, focusRequested: false } : {})
  })
}

const markAiNotificationRead = async (params: Record<string, unknown>) =>
  compactNotificationMutation(
    await markManagedAiNotificationRead({
      id: cleanOptionalText(params.id),
      source: cleanOptionalText(params.source) as never,
      sessionId: cleanOptionalText(params.sessionId || params.session_id),
      all: params.all === true
    })
  )

const dismissAiNotification = async (params: Record<string, unknown>) =>
  compactNotificationMutation(
    await dismissManagedAiNotification({
      id: cleanOptionalText(params.id),
      source: cleanOptionalText(params.source) as never,
      sessionId: cleanOptionalText(params.sessionId || params.session_id),
      allRead: params.allRead === true || params.all_read === true
    })
  )

const clearAiNotifications = async () => {
  const result = await clearManagedAiNotifications()
  if (!result.ok || !result.data) return fail(result.errorCode || 'AI_NOTIFICATIONS_CLEAR_FAILED', result.errorMessage || 'Managed AI notifications clear failed.')
  return ok({
    changed: result.data.changed,
    notifications: [],
    count: 0,
    unreadCount: 0
  })
}

const openAiNotification = async (params: Record<string, unknown>, config: ExternalCodexMcpManagedAiRuntimeConfig) => {
  const result = await openManagedAiNotification({
    id: cleanOptionalText(params.id),
    source: cleanOptionalText(params.source) as never,
    sessionId: cleanOptionalText(params.sessionId || params.session_id)
  })
  if (result.ok && result.data?.focusRequest) config.focusManagedAiSession?.(result.data.focusRequest)
  const response = compactNotificationMutation(result)
  if (response.ok && response.data) {
    return ok({
      ...response.data,
      focusRequested: typeof config.focusManagedAiSession === 'function'
    })
  }
  return response
}

const jumpToUnreadAiNotification = async (config: ExternalCodexMcpManagedAiRuntimeConfig) => {
  const result = await jumpToUnreadManagedAiNotification()
  if (result.ok && result.data?.focusRequest) config.focusManagedAiSession?.(result.data.focusRequest)
  const response = compactNotificationMutation(result)
  if (response.ok && response.data) {
    return ok({
      ...response.data,
      focusRequested: Boolean(result.data?.focusRequest && typeof config.focusManagedAiSession === 'function')
    })
  }
  return response
}

export const handleExternalCodexMcpManagedAiRequest = async (
  method: string | undefined,
  params: Record<string, unknown>,
  config: ExternalCodexMcpManagedAiRuntimeConfig = {}
): Promise<ExternalCodexMcpResponse | null> => {
  if (method === 'list_ai_sessions') return listAiSessions(params)
  if (method === 'get_ai_session') return getAiSession(params)
  if (method === 'list_ai_approvals') return listAiApprovals(params)
  if (method === 'focus_ai_session') return focusAiSession(params, config)
  if (method === 'reply_ai_session') return replyAiSession(params)
  if (method === 'approve_ai_session') return approveAiSession(params)
  if (method === 'deny_ai_session') return denyAiSession(params)
  if (method === 'answer_ai_question') return answerAiQuestion(params)
  if (method === 'handle_ai_session') return handleAiSession(params)
  if (method === 'clear_ai_session') return clearAiSession(params)
  if (method === 'list_ai_session_events') return listAiSessionEvents(params)
  if (method === 'wait_ai_session_completion') return waitAiSessionCompletion(params, config)
  if (method === 'list_ai_notifications') return listAiNotifications(params)
  if (method === 'mark_ai_notification_read') return markAiNotificationRead(params)
  if (method === 'dismiss_ai_notification') return dismissAiNotification(params)
  if (method === 'clear_ai_notifications') return clearAiNotifications()
  if (method === 'open_ai_notification') return openAiNotification(params, config)
  if (method === 'jump_to_unread_ai_notification') return jumpToUnreadAiNotification(config)
  return null
}
