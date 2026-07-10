import {
  cleanOptionalText,
  cleanPositiveInteger,
  cleanText,
  managedAiNotificationId,
  normalizeSource,
  sessionKey
} from './agentSessionNormalization'
import type { ManagedAiSessionAuditEntry } from './agentSessionAuditRuntime'
import type {
  AiAgentSessionSource,
  ManagedAiNotificationClearResult,
  ManagedAiNotificationDismissInput,
  ManagedAiNotificationListInput,
  ManagedAiNotificationListResult,
  ManagedAiNotificationMarkReadInput,
  ManagedAiNotificationMutationResult,
  ManagedAiNotificationOpenInput,
  ManagedAiNotificationRecord,
  ManagedAiNotificationSelectorInput,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot
} from '@shared/contracts/managedAiSessions'

type AgentSessionNotificationRuntimeOptions = {
  loadStoreIfNeeded: () => Promise<void>
  getSnapshot: () => ManagedAiSessionSnapshot
  getSession: (source: AiAgentSessionSource, sessionId: string) => ManagedAiSessionRecord | null
  getSessions: () => ManagedAiSessionRecord[]
  deleteSession: (source: AiAgentSessionSource, sessionId: string) => boolean
  persistSnapshot: () => void
  replyManagedAiSession: (input: ManagedAiSessionReplyInput) => Promise<ManagedAiSessionMutationResult>
  bulkManagedAiSessions: (input: ManagedAiSessionBulkInput) => Promise<ManagedAiSessionBulkResult>
  appendManagedAiSessionAudit: (entry: ManagedAiSessionAuditEntry) => void
  publishManagedAiStreamFrame: (name: string, session: ManagedAiSessionRecord | null, payload: Record<string, unknown>) => void
}

const notificationMutationError = (errorCode: string, errorMessage: string): ManagedAiNotificationMutationResult => ({ ok: false, errorCode, errorMessage })

const notificationClearError = (errorCode: string, errorMessage: string): ManagedAiNotificationClearResult => ({ ok: false, errorCode, errorMessage })

export const notificationReadStateForSession = (session: ManagedAiSessionRecord) => session.state !== 'needsInput' || Boolean(session.handledAt)

export const notificationForSession = (session: ManagedAiSessionRecord): ManagedAiNotificationRecord => {
  const read = notificationReadStateForSession(session)
  return {
    id: managedAiNotificationId(session.source, session.id),
    source: session.source,
    sessionId: session.id,
    title: session.title,
    summary: session.summary,
    body: session.summary,
    state: session.state,
    event: session.lastEvent,
    read,
    isRead: read,
    needsInput: session.state === 'needsInput',
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    ...(session.waitTimeoutMs ? { waitTimeoutMs: session.waitTimeoutMs } : {}),
    ...(session.toolName ? { toolName: session.toolName } : {}),
    ...(typeof session.actionable === 'boolean' ? { actionable: session.actionable } : {}),
    ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.canonicalCwd ? { canonicalCwd: session.canonicalCwd } : {}),
    ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
    ...(typeof session.gitDirty === 'boolean' ? { gitDirty: session.gitDirty } : {}),
    ...(session.gitStatusUpdatedAt ? { gitStatusUpdatedAt: session.gitStatusUpdatedAt } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.handledAt ? { readAt: session.handledAt } : {})
  }
}

const notificationPartsFromId = (id: string) => {
  const match = id.match(/^managed-ai:([^:]+):(.+)$/)
  if (!match) return null
  const source = normalizeSource(match[1])
  const sessionId = cleanOptionalText(match[2])
  return source && sessionId ? { source, sessionId } : null
}

const focusRequestForSession = (session: ManagedAiSessionRecord): ManagedAiSessionFocusRequest => ({
  source: session.source,
  sessionId: session.id,
  ...(session.panelId ? { panelId: session.panelId } : {}),
  ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {})
})

export const createAgentSessionNotificationRuntime = (options: AgentSessionNotificationRuntimeOptions) => {
  const allNotifications = () => options.getSnapshot().sessions.map(notificationForSession)

  const normalizeLimit = (value: unknown) => cleanPositiveInteger(value) || 50

  const listPayload = (input: ManagedAiNotificationListInput = {}) => {
    const source = normalizeSource(input.source)
    const query = cleanText(input.query).toLowerCase()
    const unreadOnly = input.unread === true && input.read !== true
    const readOnly = input.read === true && input.unread !== true
    const limit = normalizeLimit(input.limit)
    const all = allNotifications()
    const filtered = all.filter((notification) => {
      if (source && notification.source !== source) return false
      if (unreadOnly && notification.read) return false
      if (readOnly && !notification.read) return false
      if (!query) return true
      return [
        notification.id,
        notification.source,
        notification.sessionId,
        notification.title,
        notification.summary,
        notification.cwd || '',
        notification.panelId || '',
        notification.terminalSessionId || ''
      ].some((value) => value.toLowerCase().includes(query))
    })
    return {
      notifications: filtered.slice(0, limit),
      count: filtered.length,
      total: all.length,
      unreadCount: all.filter((notification) => !notification.read).length
    }
  }

  const resolveSession = (input: ManagedAiNotificationSelectorInput = {}) => {
    const id = cleanText(input.id)
    if (id.startsWith('managed-ai:') && !notificationPartsFromId(id)) {
      return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_ID_INVALID', 'Managed AI notification id is invalid.') }
    }
    const parsed = notificationPartsFromId(id)
    const source = parsed?.source || normalizeSource(input.source)
    const sessionId = parsed?.sessionId || cleanOptionalText(input.sessionId) || (!id.startsWith('managed-ai:') ? cleanOptionalText(id) : undefined)
    if (source && sessionId) {
      const session = options.getSession(source, sessionId)
      if (!session) return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_NOT_FOUND', 'Managed AI notification was not found.') }
      return { session }
    }
    if (sessionId) {
      const matches = options.getSessions().filter((session) => session.id === sessionId)
      if (!matches.length) return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_NOT_FOUND', 'Managed AI notification was not found.') }
      if (matches.length > 1) {
        return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_SOURCE_REQUIRED', 'Multiple managed AI notifications match this sessionId; pass source.') }
      }
      return { session: matches[0] }
    }
    return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_SELECTOR_REQUIRED', 'Managed AI notification id or sessionId is required.') }
  }

  const list = async (input: ManagedAiNotificationListInput = {}): Promise<ManagedAiNotificationListResult> => {
    await options.loadStoreIfNeeded()
    return { ok: true, data: listPayload(input) }
  }

  const markRead = async (input: ManagedAiNotificationMarkReadInput): Promise<ManagedAiNotificationMutationResult> => {
    await options.loadStoreIfNeeded()
    if (input?.all === true) {
      const result = await options.bulkManagedAiSessions({ operation: 'mark-handled' })
      if (!result.ok || !result.data) {
        return notificationMutationError(result.errorCode || 'MANAGED_AI_NOTIFICATION_MARK_READ_FAILED', result.errorMessage || 'Managed AI notification mark read failed.')
      }
      options.appendManagedAiSessionAudit({
        at: Date.now(),
        kind: 'notification.mark_read',
        changed: result.data.changed
      })
      options.publishManagedAiStreamFrame('managed_ai.notification.mark_read', null, {
        changed: result.data.changed,
        all: true
      })
      return {
        ok: true,
        data: {
          changed: result.data.changed,
          notifications: listPayload().notifications,
          snapshot: result.data.snapshot
        }
      }
    }

    const resolved = resolveSession(input || {})
    if (resolved.error) return resolved.error
    const session = resolved.session!
    if (notificationReadStateForSession(session)) {
      return {
        ok: true,
        data: {
          changed: 0,
          notification: notificationForSession(session),
          notifications: listPayload().notifications,
          snapshot: options.getSnapshot()
        }
      }
    }
    const result = await options.replyManagedAiSession({ source: session.source, sessionId: session.id, kind: 'handled' })
    if (!result.ok || !result.data) {
      return notificationMutationError(result.errorCode || 'MANAGED_AI_NOTIFICATION_MARK_READ_FAILED', result.errorMessage || 'Managed AI notification mark read failed.')
    }
    const next = result.data.session || options.getSession(session.source, session.id) || session
    options.appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'notification.mark_read',
      source: session.source,
      sessionId: session.id,
      notificationId: managedAiNotificationId(session.source, session.id),
      changed: 1
    })
    options.publishManagedAiStreamFrame('managed_ai.notification.mark_read', next, {
      notificationId: managedAiNotificationId(session.source, session.id),
      changed: 1
    })
    return {
      ok: true,
      data: {
        changed: 1,
        notification: notificationForSession(next),
        notifications: listPayload().notifications,
        snapshot: result.data.snapshot
      }
    }
  }

  const dismiss = async (input: ManagedAiNotificationDismissInput): Promise<ManagedAiNotificationMutationResult> => {
    await options.loadStoreIfNeeded()
    if (input?.allRead === true || input?.all_read === true) {
      const readSessions = options.getSnapshot().sessions.filter((session) => notificationReadStateForSession(session))
      let changed = 0
      readSessions.forEach((session) => {
        if (!options.deleteSession(session.source, session.id)) return
        changed += 1
      })
      if (changed) options.persistSnapshot()
      options.appendManagedAiSessionAudit({
        at: Date.now(),
        kind: 'notification.dismissed',
        changed
      })
      options.publishManagedAiStreamFrame('managed_ai.notification.dismissed', null, {
        changed,
        allRead: true
      })
      return {
        ok: true,
        data: {
          changed,
          notifications: listPayload().notifications,
          snapshot: options.getSnapshot()
        }
      }
    }

    const resolved = resolveSession(input || {})
    if (resolved.error) return resolved.error
    const session = resolved.session!
    if (!notificationReadStateForSession(session)) {
      return notificationMutationError('MANAGED_AI_NOTIFICATION_UNREAD', 'Unread managed AI notification must be marked read before dismissing.')
    }
    options.deleteSession(session.source, session.id)
    options.persistSnapshot()
    options.appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'notification.dismissed',
      source: session.source,
      sessionId: session.id,
      notificationId: managedAiNotificationId(session.source, session.id),
      event: session.lastEvent,
      state: session.state,
      title: session.title,
      summary: session.summary,
      changed: 1
    })
    options.publishManagedAiStreamFrame('managed_ai.notification.dismissed', session, {
      notificationId: managedAiNotificationId(session.source, session.id),
      changed: 1
    })
    return {
      ok: true,
      data: {
        changed: 1,
        notification: notificationForSession(session),
        notifications: listPayload().notifications,
        snapshot: options.getSnapshot()
      }
    }
  }

  const clear = async (): Promise<ManagedAiNotificationClearResult> => {
    await options.loadStoreIfNeeded()
    const result = await options.bulkManagedAiSessions({ operation: 'clear-all' })
    if (!result.ok || !result.data) {
      return notificationClearError(result.errorCode || 'MANAGED_AI_NOTIFICATIONS_CLEAR_FAILED', result.errorMessage || 'Managed AI notifications clear failed.')
    }
    options.appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'notification.dismissed',
      changed: result.data.changed
    })
    options.publishManagedAiStreamFrame('managed_ai.notification.cleared', null, {
      changed: result.data.changed
    })
    return {
      ok: true,
      data: {
        changed: result.data.changed,
        notifications: [],
        snapshot: result.data.snapshot
      }
    }
  }

  const open = async (input: ManagedAiNotificationOpenInput): Promise<ManagedAiNotificationMutationResult> => {
    await options.loadStoreIfNeeded()
    const resolved = resolveSession(input || {})
    if (resolved.error) return resolved.error
    const session = resolved.session!
    const focusRequest = focusRequestForSession(session)
    options.appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'notification.opened',
      source: session.source,
      sessionId: session.id,
      notificationId: managedAiNotificationId(session.source, session.id),
      event: session.lastEvent,
      state: session.state,
      title: session.title,
      summary: session.summary
    })
    options.publishManagedAiStreamFrame('managed_ai.notification.opened', session, {
      notificationId: managedAiNotificationId(session.source, session.id)
    })
    return {
      ok: true,
      data: {
        changed: 0,
        notification: notificationForSession(session),
        notifications: listPayload().notifications,
        snapshot: options.getSnapshot(),
        focusRequest
      }
    }
  }

  const jumpToUnread = async (): Promise<ManagedAiNotificationMutationResult> => {
    await options.loadStoreIfNeeded()
    const notification = listPayload({ unread: true, limit: 1 }).notifications[0]
    if (!notification) {
      return {
        ok: true,
        data: {
          changed: 0,
          notifications: listPayload().notifications,
          snapshot: options.getSnapshot()
        }
      }
    }
    return open({ id: notification.id })
  }

  return {
    listPayload,
    resolveSession,
    list,
    markRead,
    dismiss,
    clear,
    open,
    jumpToUnread
  }
}
