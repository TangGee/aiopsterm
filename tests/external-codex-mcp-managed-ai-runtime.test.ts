import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiAgentSessionEventName,
  AiAgentSessionSource,
  ManagedAiDecisionMode,
  ManagedAiNotificationRecord,
  ManagedAiRequestKind,
  ManagedAiSessionRecord,
  ManagedAiSessionState,
  ManagedAiSessionTimelineEvent
} from '../src/shared/contracts/managedAiSessions'

const agentSessionsMock = vi.hoisted(() => ({
  listManagedAiSessions: vi.fn(),
  replyManagedAiSession: vi.fn(),
  clearManagedAiSession: vi.fn(),
  listManagedAiSessionEvents: vi.fn(),
  waitForManagedAiSessionEvent: vi.fn(),
  listManagedAiNotifications: vi.fn(),
  markManagedAiNotificationRead: vi.fn(),
  dismissManagedAiNotification: vi.fn(),
  clearManagedAiNotifications: vi.fn(),
  openManagedAiNotification: vi.fn(),
  jumpToUnreadManagedAiNotification: vi.fn()
}))

vi.mock('../src/main/backend/agent/agentSessions', () => agentSessionsMock)

type ManagedAiRuntime = {
  handleExternalCodexMcpManagedAiRequest: (
    method: string | undefined,
    params: Record<string, unknown>,
    config?: { focusManagedAiSession?: (request: Record<string, unknown>) => void }
  ) => Promise<Record<string, unknown> | null>
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/codex/externalCodexMcpManagedAiRuntime'
  return (await import(modulePath)) as ManagedAiRuntime
}

const timelineEvent = (overrides: Partial<ManagedAiSessionTimelineEvent> = {}): ManagedAiSessionTimelineEvent => ({
  id: overrides.id || `event-${overrides.sessionId || 'session-1'}`,
  source: overrides.source || 'claude-code',
  event: overrides.event || 'permission_request',
  sessionId: overrides.sessionId || 'session-1',
  requestId: overrides.requestId || 'request-1',
  title: overrides.title || 'Claude Code',
  summary: overrides.summary || 'run tests',
  receivedAt: overrides.receivedAt || 1000,
  requestKind: overrides.requestKind || 'permission',
  decisionMode: overrides.decisionMode || 'blocking',
  actionable: overrides.actionable,
  cwd: overrides.cwd,
  raw: overrides.raw,
  ...overrides
})

const sessionRecord = (overrides: Partial<ManagedAiSessionRecord> = {}): ManagedAiSessionRecord => {
  const source = overrides.source || 'claude-code'
  const id = overrides.id || 'session-1'
  const requestKind = overrides.requestKind || 'permission'
  const decisionMode = overrides.decisionMode || 'blocking'
  const state = overrides.state || 'needsInput'
  return {
    id,
    source,
    title: overrides.title || 'Claude Code · api',
    summary: overrides.summary || 'run tests',
    state,
    lastEvent: overrides.lastEvent || 'permission_request',
    lastActivityAt: overrides.lastActivityAt || 1100,
    createdAt: overrides.createdAt || 1000,
    updatedAt: overrides.updatedAt || 1100,
    panelId: overrides.panelId || 'panel-1',
    terminalSessionId: overrides.terminalSessionId || 'terminal-1',
    cwd: overrides.cwd || '/work/api',
    pendingRequestId: overrides.pendingRequestId || (state === 'needsInput' ? 'request-1' : undefined),
    requestKind,
    decisionMode,
    actionable: overrides.actionable,
    events: overrides.events || [timelineEvent({ source, sessionId: id, requestKind, decisionMode, summary: overrides.summary || 'run tests', raw: { secret: 'hidden' } })],
    decisions: overrides.decisions || [],
    ...overrides
  }
}

const notificationRecord = (overrides: Partial<ManagedAiNotificationRecord> = {}): ManagedAiNotificationRecord => ({
  id: overrides.id || 'managed-ai:claude-code:session-1',
  source: overrides.source || 'claude-code',
  sessionId: overrides.sessionId || 'session-1',
  title: overrides.title || 'Claude Code · api',
  summary: overrides.summary || 'answer question',
  body: overrides.body || 'Need input',
  state: overrides.state || 'needsInput',
  event: overrides.event || 'question',
  read: overrides.read || false,
  isRead: overrides.isRead || false,
  needsInput: overrides.needsInput ?? true,
  actionable: overrides.actionable,
  requestKind: overrides.requestKind || 'question',
  decisionMode: overrides.decisionMode || 'local',
  pendingRequestId: overrides.pendingRequestId || 'question-1',
  panelId: overrides.panelId || 'panel-1',
  terminalSessionId: overrides.terminalSessionId || 'terminal-1',
  cwd: overrides.cwd || '/work/api',
  createdAt: overrides.createdAt || 1000,
  updatedAt: overrides.updatedAt || 1100,
  lastActivityAt: overrides.lastActivityAt || 1100,
  ...overrides
})

const snapshot = (sessions: ManagedAiSessionRecord[]) => ({ sessions })

beforeEach(() => {
  vi.clearAllMocks()
  agentSessionsMock.listManagedAiSessions.mockResolvedValue({ ok: true, data: snapshot([]) })
  agentSessionsMock.replyManagedAiSession.mockResolvedValue({ ok: true, data: { snapshot: snapshot([]) } })
  agentSessionsMock.clearManagedAiSession.mockResolvedValue({ ok: true, data: { snapshot: snapshot([]) } })
  agentSessionsMock.listManagedAiSessionEvents.mockReturnValue({ ok: true, data: { protocol: 'aiopsterm-agent-events', bootId: 'boot-1', afterSeq: 1, oldestSeq: 1, latestSeq: 2, nextSeq: 3, events: [], count: 0 } })
  agentSessionsMock.waitForManagedAiSessionEvent.mockResolvedValue({
    protocol: 'aiopsterm-agent-events',
    version: 1,
    bootId: 'boot-1',
    afterSeq: 2,
    latestSeq: 3,
    nextSeq: 4,
    timedOut: false,
    aborted: false,
    event: {
      type: 'event',
      protocol: 'aiopsterm-agent-events',
      version: 1,
      boot_id: 'boot-1',
      seq: 3,
      id: 'boot-1-3',
      name: 'agent.hook.Stop',
      category: 'agent',
      source: 'codex',
      occurred_at: '2026-08-16T12:00:00.000Z',
      payload: { source: 'codex', sessionId: 'codex-wait-1', event: 'stop', state: 'needsInput' }
    }
  })
  agentSessionsMock.listManagedAiNotifications.mockResolvedValue({ ok: true, data: { notifications: [], count: 0, total: 0, unreadCount: 0 } })
  agentSessionsMock.markManagedAiNotificationRead.mockResolvedValue({ ok: true, data: { changed: 0, notifications: [], snapshot: snapshot([]) } })
  agentSessionsMock.dismissManagedAiNotification.mockResolvedValue({ ok: true, data: { changed: 0, notifications: [], snapshot: snapshot([]) } })
  agentSessionsMock.clearManagedAiNotifications.mockResolvedValue({ ok: true, data: { changed: 0, notifications: [], snapshot: snapshot([]) } })
  agentSessionsMock.openManagedAiNotification.mockResolvedValue({ ok: true, data: { changed: 0, notifications: [], snapshot: snapshot([]) } })
  agentSessionsMock.jumpToUnreadManagedAiNotification.mockResolvedValue({ ok: true, data: { changed: 0, notifications: [], snapshot: snapshot([]) } })
})

describe('externalCodexMcpManagedAiRuntime', () => {
  it('lists sessions with sanitized event summaries and filters without exposing raw payloads', async () => {
    const runtime = await loadRuntime()
    const sessions = [
      sessionRecord({ id: 'claude-1', source: 'claude-code', summary: 'deploy api', state: 'needsInput' }),
      sessionRecord({ id: 'codex-1', source: 'codex', summary: 'local note', state: 'working', decisionMode: 'local', pendingRequestId: undefined })
    ]
    agentSessionsMock.listManagedAiSessions.mockResolvedValue({ ok: true, data: snapshot(sessions) })

    const response = await runtime.handleExternalCodexMcpManagedAiRequest('list_ai_sessions', {
      source: 'claude-code',
      needsInput: true,
      includeEvents: true
    })

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          total: 2,
          needsInputCount: 1,
          sessions: [
            expect.objectContaining({
              source: 'claude-code',
              sessionId: 'claude-1',
              needsInput: true,
              eventCount: 1,
              events: [expect.not.objectContaining({ raw: expect.anything() })]
            })
          ]
        })
      })
    )
    expect(JSON.stringify(response)).not.toContain('hidden')
  })

  it('projects approval capabilities and blocks unsupported native Codex approval decisions', async () => {
    const runtime = await loadRuntime()
    const claude = sessionRecord({ id: 'claude-approval', source: 'claude-code', actionable: true })
    const codex = sessionRecord({
      id: 'codex-local',
      source: 'codex',
      state: 'needsInput',
      decisionMode: 'local',
      actionable: true
    })
    agentSessionsMock.listManagedAiSessions.mockResolvedValue({ ok: true, data: snapshot([claude, codex]) })

    const listResponse = await runtime.handleExternalCodexMcpManagedAiRequest('list_ai_approvals', { includeEvents: true })
    expect(listResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 2,
          pendingCount: 2,
          blockingCount: 1,
          localOnlyCount: 1,
          approvals: expect.arrayContaining([
            expect.objectContaining({
              approvalId: 'managed-ai:claude-code:claude-approval',
              capabilities: expect.objectContaining({
                decisions: ['allow', 'always', 'bypass', 'deny', 'handled'],
                canUnblockAgent: true,
                nativePrompt: false
              })
            }),
            expect.objectContaining({
              approvalId: 'managed-ai:codex:codex-local',
              capabilities: expect.objectContaining({
                decisions: ['handled'],
                localOnly: true,
                nativePrompt: true
              })
            })
          ])
        })
      })
    )

    const unsupported = await runtime.handleExternalCodexMcpManagedAiRequest('approve_ai_session', {
      source: 'codex',
      sessionId: 'codex-local',
      mode: 'allow'
    })
    expect(unsupported).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'AI_APPROVAL_DECISION_UNSUPPORTED',
        data: expect.objectContaining({
          approval: expect.objectContaining({
            source: 'codex',
            capabilities: expect.objectContaining({ decisions: ['handled'], nativePrompt: true })
          })
        })
      })
    )
  })

  it('normalizes approval aliases and requires answers for question approvals', async () => {
    const runtime = await loadRuntime()
    const question = sessionRecord({
      id: 'question-1',
      requestKind: 'question',
      lastEvent: 'question',
      actionable: true
    })
    agentSessionsMock.listManagedAiSessions.mockResolvedValue({ ok: true, data: snapshot([question]) })
    agentSessionsMock.replyManagedAiSession.mockImplementation(async (input: Record<string, unknown>) => ({
      ok: true,
      data: {
        session: { ...question, state: 'idle' as ManagedAiSessionState, decisions: [{ id: 'decision-1', kind: input.kind, message: input.message, createdAt: 1200 }] },
        snapshot: snapshot([{ ...question, state: 'idle' as ManagedAiSessionState }])
      }
    }))

    await expect(runtime.handleExternalCodexMcpManagedAiRequest('answer_ai_question', { source: 'claude-code', sessionId: 'question-1' })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'AI_APPROVAL_MESSAGE_REQUIRED' })
    )

    const response = await runtime.handleExternalCodexMcpManagedAiRequest('answer_ai_question', {
      source: 'claude-code',
      sessionId: 'question-1',
      answer: 'Friday night'
    })
    expect(agentSessionsMock.replyManagedAiSession).toHaveBeenCalledWith({
      source: 'claude-code',
      sessionId: 'question-1',
      kind: 'reply',
      message: 'Friday night'
    })
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          decisionKind: 'reply',
          approval: expect.objectContaining({ sessionId: 'question-1', state: 'idle' })
        })
      })
    )
  })

  it('opens notifications through the injected focus callback and compacts mutation payloads', async () => {
    const runtime = await loadRuntime()
    const notification = notificationRecord()
    const focusRequest = {
      source: notification.source,
      sessionId: notification.sessionId,
      panelId: notification.panelId,
      terminalSessionId: notification.terminalSessionId
    }
    agentSessionsMock.openManagedAiNotification.mockResolvedValue({
      ok: true,
      data: {
        changed: 1,
        notification: { ...notification, read: true, isRead: true, readAt: 1200, needsInput: false },
        notifications: [{ ...notification, read: true, isRead: true, readAt: 1200, needsInput: false }],
        snapshot: snapshot([]),
        focusRequest
      }
    })
    const focusManagedAiSession = vi.fn()

    const response = await runtime.handleExternalCodexMcpManagedAiRequest(
      'open_ai_notification',
      { id: notification.id },
      { focusManagedAiSession }
    )

    expect(focusManagedAiSession).toHaveBeenCalledWith(focusRequest)
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          focusRequested: true,
          focusRequest,
          notification: expect.objectContaining({
            id: notification.id,
            read: true,
            needsInput: false
          }),
          unreadCount: 0
        })
      })
    )
  })

  it('waits for a later completion event and returns a resumable cursor without polling', async () => {
    const runtime = await loadRuntime()
    const completed = sessionRecord({
      id: 'codex-wait-1',
      source: 'codex',
      state: 'needsInput',
      lastEvent: 'stop',
      requestKind: 'notification',
      decisionMode: 'local'
    })
    agentSessionsMock.listManagedAiSessions.mockResolvedValue({ ok: true, data: snapshot([completed]) })

    const response = await runtime.handleExternalCodexMcpManagedAiRequest('wait_ai_session_completion', {
      source: 'codex',
      sessionId: 'codex-wait-1',
      timeoutMs: 45_000
    })

    expect(agentSessionsMock.waitForManagedAiSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ afterSeq: 2, timeoutMs: 45_000, predicate: expect.any(Function) })
    )
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          matched: true,
          timedOut: false,
          reason: 'completed',
          after_seq: 2,
          next_seq: 4,
          session: expect.objectContaining({ source: 'codex', sessionId: 'codex-wait-1', lastEvent: 'stop' }),
          event: expect.objectContaining({ name: 'agent.hook.Stop', seq: 3 })
        })
      })
    )
  })

  it('returns the latest session and next cursor when completion waiting times out', async () => {
    const runtime = await loadRuntime()
    const working = sessionRecord({
      id: 'codex-wait-timeout-1',
      source: 'codex',
      state: 'working',
      lastEvent: 'prompt_submit',
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      pendingRequestId: undefined
    })
    agentSessionsMock.listManagedAiSessions.mockResolvedValue({ ok: true, data: snapshot([working]) })
    agentSessionsMock.waitForManagedAiSessionEvent.mockResolvedValue({
      protocol: 'aiopsterm-agent-events',
      version: 1,
      bootId: 'boot-1',
      afterSeq: 2,
      latestSeq: 2,
      nextSeq: 3,
      timedOut: true,
      aborted: false
    })

    const response = await runtime.handleExternalCodexMcpManagedAiRequest('wait_ai_session_completion', {
      source: 'codex',
      sessionId: 'codex-wait-timeout-1',
      timeoutMs: 1_000
    })

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          matched: false,
          timedOut: true,
          reason: 'timeout',
          next_seq: 3,
          session: expect.objectContaining({ state: 'working' })
        })
      })
    )
  })

  it('returns null for methods outside the managed AI subdomain', async () => {
    const runtime = await loadRuntime()

    await expect(runtime.handleExternalCodexMcpManagedAiRequest('list_hosts', {})).resolves.toBeNull()
  })
})
