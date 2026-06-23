import { describe, expect, it, vi } from 'vitest'
import type {
  AiAgentSessionSource,
  ManagedAiSessionBulkInput,
  ManagedAiSessionDecision,
  ManagedAiSessionRecord,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot
} from '../src/shared/contracts/managedAiSessions'

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentSessionNotificationRuntime'
  return import(modulePath)
}

const sessionRecord = (overrides: Partial<ManagedAiSessionRecord> = {}): ManagedAiSessionRecord => ({
  id: overrides.id || 'session-1',
  source: overrides.source || 'codex',
  title: overrides.title || 'Codex',
  summary: overrides.summary || 'Needs attention',
  state: overrides.state || 'needsInput',
  lastEvent: overrides.lastEvent || 'permission_request',
  lastActivityAt: overrides.lastActivityAt || 200,
  createdAt: overrides.createdAt || 100,
  updatedAt: overrides.updatedAt || 200,
  requestKind: overrides.requestKind || 'permission',
  decisionMode: overrides.decisionMode || 'local',
  events: overrides.events || [],
  decisions: overrides.decisions || [],
  ...overrides
})

const createHarness = async (initialSessions: ManagedAiSessionRecord[]) => {
  const { createAgentSessionNotificationRuntime } = await loadRuntime()
  const sessions = new Map(initialSessions.map((session) => [`${session.source}:${session.id}`, session]))
  const audit = vi.fn()
  const publish = vi.fn()
  const snapshot = (): ManagedAiSessionSnapshot => ({ sessions: [...sessions.values()].sort((first, second) => second.lastActivityAt - first.lastActivityAt) })
  const persistSnapshot = vi.fn()
  const replyManagedAiSession = vi.fn(async (input: ManagedAiSessionReplyInput) => {
    const key = `${input.source}:${input.sessionId}`
    const session = sessions.get(key)
    if (!session) return { ok: false, errorCode: 'MANAGED_AI_SESSION_NOT_FOUND', errorMessage: 'Managed AI session was not found.' }
    const decision: ManagedAiSessionDecision = { id: `decision-${session.decisions.length + 1}`, kind: input.kind, createdAt: 300 }
    const next = {
      ...session,
      state: session.state === 'needsInput' ? 'idle' : session.state,
      handledAt: 300,
      updatedAt: 300,
      decisions: [...session.decisions, decision]
    } satisfies ManagedAiSessionRecord
    sessions.set(key, next)
    persistSnapshot()
    return { ok: true, data: { session: next, snapshot: snapshot() } }
  })
  const bulkManagedAiSessions = vi.fn(async (input: ManagedAiSessionBulkInput) => {
    let changed = 0
    if (input.operation === 'mark-handled') {
      sessions.forEach((session, key) => {
        if (session.state !== 'needsInput') return
        changed += 1
        sessions.set(key, { ...session, state: 'idle', handledAt: 310, updatedAt: 310 })
      })
    } else if (input.operation === 'clear-all') {
      changed = sessions.size
      sessions.clear()
    }
    persistSnapshot()
    return { ok: true, data: { changed, snapshot: snapshot() } }
  })
  const runtime = createAgentSessionNotificationRuntime({
    loadStoreIfNeeded: vi.fn(async () => undefined),
    getSnapshot: snapshot,
    getSession: (source: AiAgentSessionSource, sessionId: string) => sessions.get(`${source}:${sessionId}`) || null,
    getSessions: () => [...sessions.values()],
    deleteSession: (source: AiAgentSessionSource, sessionId: string) => sessions.delete(`${source}:${sessionId}`),
    persistSnapshot,
    replyManagedAiSession,
    bulkManagedAiSessions,
    appendManagedAiSessionAudit: audit,
    publishManagedAiStreamFrame: publish,
    maxNotifications: 20
  })
  return { runtime, sessions, audit, publish, persistSnapshot, replyManagedAiSession, bulkManagedAiSessions, snapshot }
}

describe('agentSessionNotificationRuntime', () => {
  it('projects and filters managed AI notifications without owning session state', async () => {
    const { runtime } = await createHarness([
      sessionRecord({
        id: 'needs-input',
        source: 'claude-code',
        title: 'Claude approval',
        summary: 'Approve deploy',
        cwd: '/work/api',
        panelId: 'panel-1',
        terminalSessionId: 'terminal-1',
        lastActivityAt: 300
      }),
      sessionRecord({
        id: 'done',
        source: 'gemini',
        title: 'Gemini done',
        summary: 'Finished turn',
        state: 'ended',
        lastEvent: 'stop',
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        lastActivityAt: 200
      })
    ])

    await expect(runtime.list({ query: 'api', unread: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          total: 2,
          unreadCount: 1,
          notifications: [
            expect.objectContaining({
              id: 'managed-ai:claude-code:needs-input',
              read: false,
              isRead: false,
              needsInput: true,
              cwd: '/work/api',
              panelId: 'panel-1',
              terminalSessionId: 'terminal-1'
            })
          ]
        })
      })
    )
    await expect(runtime.list({ source: 'gemini', read: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          unreadCount: 1,
          notifications: [expect.objectContaining({ id: 'managed-ai:gemini:done', read: true })]
        })
      })
    )
  })

  it('marks, opens, dismisses, clears, and resolves ambiguous selectors through injected session operations', async () => {
    const { runtime, audit, publish, persistSnapshot, replyManagedAiSession, bulkManagedAiSessions, snapshot } = await createHarness([
      sessionRecord({ id: 'shared', source: 'codex', title: 'Codex shared' }),
      sessionRecord({ id: 'shared', source: 'claude-code', title: 'Claude shared' }),
      sessionRecord({ id: 'read-me', source: 'gemini', state: 'ended', lastEvent: 'stop', title: 'Gemini read' })
    ])

    await expect(runtime.open({ sessionId: 'shared' })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'MANAGED_AI_NOTIFICATION_SOURCE_REQUIRED'
      })
    )
    await expect(runtime.open({ id: 'managed-ai:codex:shared' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          focusRequest: expect.objectContaining({ source: 'codex', sessionId: 'shared' }),
          notification: expect.objectContaining({ id: 'managed-ai:codex:shared', read: false })
        })
      })
    )
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'notification.opened', source: 'codex', sessionId: 'shared' }))

    await expect(runtime.markRead({ id: 'managed-ai:codex:shared' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          notification: expect.objectContaining({ read: true, needsInput: false })
        })
      })
    )
    expect(replyManagedAiSession).toHaveBeenCalledWith({ source: 'codex', sessionId: 'shared', kind: 'handled' })
    expect(publish).toHaveBeenCalledWith('managed_ai.notification.mark_read', expect.objectContaining({ source: 'codex', id: 'shared' }), expect.objectContaining({ changed: 1 }))

    await expect(runtime.dismiss({ id: 'managed-ai:codex:shared' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ changed: 1 })
      })
    )
    expect(snapshot().sessions.some((session) => session.source === 'codex' && session.id === 'shared')).toBe(false)
    expect(persistSnapshot).toHaveBeenCalled()

    await expect(runtime.clear()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: { changed: 2, notifications: [], snapshot: { sessions: [] } }
      })
    )
    expect(bulkManagedAiSessions).toHaveBeenCalledWith({ operation: 'clear-all' })
  })
})
