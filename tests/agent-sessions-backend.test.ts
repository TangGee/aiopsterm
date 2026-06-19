import { mkdtemp, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createConnection } from 'net'
import { describe, expect, it, vi } from 'vitest'

type AgentSessionsBackend = {
  configureAiAgentSessionStore: (userDataPath: string) => Promise<void>
  listManagedAiSessions: () => Promise<unknown>
  listManagedAiSessionEvents: (input?: Record<string, unknown>) => unknown
  listManagedAiNotifications: (input?: Record<string, unknown>) => Promise<unknown>
  markManagedAiNotificationRead: (input: Record<string, unknown>) => Promise<unknown>
  dismissManagedAiNotification: (input: Record<string, unknown>) => Promise<unknown>
  openManagedAiNotification: (input: Record<string, unknown>) => Promise<unknown>
  jumpToUnreadManagedAiNotification: () => Promise<unknown>
  normalizeAiAgentSessionEventInput: (input: unknown, now?: number) => unknown
  publishAiAgentSessionEvent: (input: Record<string, unknown>, emit?: ((event: unknown) => void) | null) => unknown
  ensureAiAgentSessionServer: (input: { userDataPath: string; emit: (event: unknown) => void }) => Promise<string>
  closeAiAgentSessionServer: () => void
  renameManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  replyManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  clearManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  bulkManagedAiSessions: (input: Record<string, unknown>) => Promise<unknown>
  __testing: {
    auditPathFor: (userDataPath: string) => string
    streamLatestSeq: () => number
    flushManagedAiSessionWrites: () => Promise<void>
  }
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/agentSessions'
  return (await import(modulePath)) as AgentSessionsBackend
}

const socketRequest = (socketPath: string, payload: Record<string, unknown>) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(payload)}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      socket.end()
      resolve(JSON.parse(buffer.slice(0, newlineIndex)) as Record<string, unknown>)
    })
    socket.on('timeout', () => reject(new Error('agent session socket response timed out')))
    socket.on('error', reject)
  })

const streamSocket = (socketPath: string, request: Record<string, unknown>) => {
  const socket = createConnection(socketPath)
  let buffer = ''
  const frames: Record<string, unknown>[] = []
  const waiters: Array<{ count: number; resolve: (frames: Record<string, unknown>[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = []
  const flushWaiters = () => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]
      if (frames.length < waiter.count) continue
      clearTimeout(waiter.timer)
      waiters.splice(index, 1)
      waiter.resolve(frames.slice(0, waiter.count))
    }
  }
  socket.setEncoding('utf8')
  socket.setTimeout(5000)
  socket.on('connect', () => {
    socket.write(`${JSON.stringify(request)}\n`)
  })
  socket.on('data', (chunk) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) frames.push(JSON.parse(line) as Record<string, unknown>)
      newlineIndex = buffer.indexOf('\n')
    }
    flushWaiters()
  })
  socket.on('error', (error) => {
    while (waiters.length) {
      const waiter = waiters.pop()!
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  })
  return {
    waitForFrames: (count: number, timeoutMs = 5000) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        if (frames.length >= count) {
          resolve(frames.slice(0, count))
          return
        }
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error(`timed out waiting for ${count} stream frames`))
        }, timeoutMs)
        waiters.push({ count, resolve, reject, timer })
      }),
    close: () => socket.destroy()
  }
}

describe('agent session backend', () => {
  it('normalizes Codex hook payloads into managed AI session events', async () => {
    const { normalizeAiAgentSessionEventInput } = await loadBackend()
    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'codex',
          hookEventName: 'PermissionRequest',
          session_id: 'codex-session-1',
          surface_id: 'panel-1',
          terminal_id: 'terminal-1',
          cwd: '/work/project',
          message: 'Approve shell command'
        },
        100
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'codex',
        event: 'permission_request',
        sessionId: 'codex-session-1',
        title: 'Codex · project',
        panelId: 'panel-1',
        terminalSessionId: 'terminal-1',
        cwd: '/work/project',
        summary: 'Approve shell command',
        receivedAt: 100
      })
    })
  })

  it('rejects unsupported sources before publishing', async () => {
    const { publishAiAgentSessionEvent } = await loadBackend()
    const emit = vi.fn()
    expect(
      publishAiAgentSessionEvent(
        {
          source: 'external',
          event: 'Notification',
          sessionId: 'session-1'
        },
        emit
      )
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'AI_AGENT_EVENT_SOURCE_INVALID'
      })
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('derives question summaries and project titles when hook payloads omit display titles', async () => {
    const { normalizeAiAgentSessionEventInput } = await loadBackend()
    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'claude-code',
          hookEventName: 'AskUserQuestion',
          session_id: 'claude-session-1',
          project_dir: '/work/release-api',
          transcript_path: '/tmp/claude.jsonl',
          tool_input: {
            questions: [{ question: 'Deploy to staging or production?', options: [{ label: 'staging' }, { label: 'production' }] }]
          }
        },
        200
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'claude-code',
        event: 'question',
        sessionId: 'claude-session-1',
        title: 'Claude Code · release-api',
        summary: 'Deploy to staging or production?',
        cwd: '/work/release-api',
        transcriptPath: '/tmp/claude.jsonl',
        receivedAt: 200
      })
    })
  })

  it('builds native resume commands and sanitizes launch commands', async () => {
    const { normalizeAiAgentSessionEventInput } = await loadBackend()
    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'codex',
          event: 'SessionStart',
          session_id: 'codex-session-1',
          cwd: '/work/project',
          launchCommand: 'codex -m gpt-5 --approval on-request --api-key sk-secret -p "do this" --sandbox workspace-write'
        },
        250
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'codex',
        sessionId: 'codex-session-1',
        launchCommand: 'codex -m gpt-5 --approval on-request --sandbox workspace-write',
        resumeCommand: "cd '/work/project' && codex resume 'codex-session-1'"
      })
    })

    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'claude-code',
          event: 'SessionStart',
          session_id: 'claude-session-1',
          project_dir: "/work/project's app",
          launch_command: 'claude --model opus --permission-mode plan --prompt "secret prompt"'
        },
        260
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'claude-code',
        sessionId: 'claude-session-1',
        launchCommand: 'claude --model opus --permission-mode plan',
        resumeCommand: "cd '/work/project'\\''s app' && claude --resume 'claude-session-1'"
      })
    })
  })

  it('persists resume command metadata across later events that omit it', async () => {
    const { configureAiAgentSessionStore, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-resume-')))

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'SessionStart',
        sessionId: 'codex-persist-1',
        cwd: '/work/project',
        launchCommand: 'codex -m gpt-5 --approval on-request',
        receivedAt: 300
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'Stop',
        sessionId: 'codex-persist-1',
        summary: 'turn complete',
        receivedAt: 400
      },
      null
    )

    expect(await listManagedAiSessions()).toEqual({
      ok: true,
      data: {
        sessions: [
          expect.objectContaining({
            id: 'codex-persist-1',
            launchCommand: 'codex -m gpt-5 --approval on-request',
            resumeCommand: "cd '/work/project' && codex resume 'codex-persist-1'",
            events: expect.arrayContaining([
              expect.objectContaining({
                event: 'session_start',
                resumeCommand: "cd '/work/project' && codex resume 'codex-persist-1'"
              }),
              expect.objectContaining({ event: 'stop' })
            ])
          })
        ]
      }
    })
  })

  it('tracks lifecycle and process metadata for managed AI sessions', async () => {
    const { configureAiAgentSessionStore, listManagedAiSessions, normalizeAiAgentSessionEventInput, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-lifecycle-')))

    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'amp',
          event: 'Lifecycle',
          sessionId: 'amp-session-1',
          panelId: 'panel-1',
          terminalSessionId: 'terminal-1',
          cwd: '/work/project',
          pid: '4242',
          ppid: 41,
          pgid: 4200,
          status: 'thinking'
        },
        450
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'amp',
        event: 'lifecycle',
        sessionId: 'amp-session-1',
        processId: 4242,
        parentProcessId: 41,
        processGroupId: 4200,
        agentLifecycle: 'running'
      })
    })

    publishAiAgentSessionEvent(
      {
        source: 'amp',
        event: 'Lifecycle',
        sessionId: 'amp-session-1',
        panelId: 'panel-1',
        terminalSessionId: 'terminal-1',
        cwd: '/work/project',
        pid: '4242',
        ppid: 41,
        pgid: 4200,
        status: 'thinking',
        receivedAt: 450
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'amp',
        event: 'Lifecycle',
        sessionId: 'amp-session-1',
        status: 'idle',
        receivedAt: 460
      },
      null
    )

    expect(await listManagedAiSessions()).toEqual({
      ok: true,
      data: {
        sessions: [
          expect.objectContaining({
            id: 'amp-session-1',
            state: 'idle',
            processId: 4242,
            parentProcessId: 41,
            processGroupId: 4200,
            agentLifecycle: 'idle',
            events: expect.arrayContaining([
              expect.objectContaining({ event: 'lifecycle', agentLifecycle: 'running' }),
              expect.objectContaining({ event: 'lifecycle', agentLifecycle: 'idle' })
            ])
          })
        ]
      }
    })
  })

  it('persists managed session records with timeline, decisions, and auto titles', async () => {
    const { configureAiAgentSessionStore, listManagedAiSessions, publishAiAgentSessionEvent, renameManagedAiSession, replyManagedAiSession } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-sessions-')))

    publishAiAgentSessionEvent(
      {
        source: 'gemini',
        event: 'SessionStart',
        sessionId: 'gemini-session-1',
        cwd: '/work/release-api',
        receivedAt: 300
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'gemini',
        event: 'Stop',
        sessionId: 'gemini-session-1',
        summary: 'implement release health checks',
        receivedAt: 400
      },
      null
    )

    expect(await listManagedAiSessions()).toEqual({
      ok: true,
      data: {
        sessions: [
          expect.objectContaining({
          id: 'gemini-session-1',
          source: 'gemini',
          title: 'implement release health checks',
            state: 'idle',
            events: expect.arrayContaining([expect.objectContaining({ event: 'session_start' }), expect.objectContaining({ event: 'stop' })])
          })
        ]
      }
    })

    expect(await replyManagedAiSession({ source: 'gemini', sessionId: 'gemini-session-1', kind: 'handled' })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({
            handledAt: expect.any(Number),
            decisions: [expect.objectContaining({ kind: 'handled' })]
          })
        })
      })
    )

    expect(await renameManagedAiSession({ source: 'gemini', sessionId: 'gemini-session-1', title: 'Release checks' })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({
            title: 'Release checks',
            userTitle: 'Release checks'
          })
        })
      })
    )
  })

  it('derives managed AI notifications and supports mark/open/dismiss actions', async () => {
    const {
      configureAiAgentSessionStore,
      dismissManagedAiNotification,
      jumpToUnreadManagedAiNotification,
      listManagedAiNotifications,
      markManagedAiNotificationRead,
      openManagedAiNotification,
      publishAiAgentSessionEvent
    } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-notifications-')))

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PermissionRequest',
        sessionId: 'codex-notification-1',
        requestId: 'approve-notification-1',
        actionable: true,
        title: 'Codex · api-service',
        summary: 'approve npm test',
        cwd: '/work/api-service',
        panelId: 'panel-notification',
        terminalSessionId: 'terminal-notification',
        receivedAt: 700
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'Stop',
        sessionId: 'claude-notification-1',
        summary: 'turn complete',
        cwd: '/work/ops',
        receivedAt: 650
      },
      null
    )

    await expect(listManagedAiNotifications()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          total: 2,
          unreadCount: 1,
          notifications: [
            expect.objectContaining({
              id: 'managed-ai:codex:codex-notification-1',
              source: 'codex',
              sessionId: 'codex-notification-1',
              title: 'Codex · api-service',
              summary: 'approve npm test',
              read: false,
              isRead: false,
              needsInput: true,
              panelId: 'panel-notification',
              terminalSessionId: 'terminal-notification'
            }),
            expect.objectContaining({
              id: 'managed-ai:claude-code:claude-notification-1',
              read: true,
              needsInput: false
            })
          ]
        })
      })
    )
    await expect(listManagedAiNotifications({ unread: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          notifications: [expect.objectContaining({ id: 'managed-ai:codex:codex-notification-1' })]
        })
      })
    )

    await expect(openManagedAiNotification({ id: 'managed-ai:codex:codex-notification-1' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          focusRequest: {
            source: 'codex',
            sessionId: 'codex-notification-1',
            panelId: 'panel-notification',
            terminalSessionId: 'terminal-notification'
          },
          notification: expect.objectContaining({ read: false })
        })
      })
    )

    await expect(dismissManagedAiNotification({ id: 'managed-ai:codex:codex-notification-1' })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'MANAGED_AI_NOTIFICATION_UNREAD'
      })
    )
    await expect(jumpToUnreadManagedAiNotification()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          focusRequest: expect.objectContaining({ sessionId: 'codex-notification-1' })
        })
      })
    )
    await expect(markManagedAiNotificationRead({ id: 'managed-ai:codex:codex-notification-1' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          notification: expect.objectContaining({
            read: true,
            needsInput: false
          })
        })
      })
    )
    await expect(dismissManagedAiNotification({ allRead: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 2,
          notifications: [],
          snapshot: { sessions: [] }
        })
      })
    )
  })

  it('writes compact append-only audit entries for events and user mutations', async () => {
    const {
      __testing,
      bulkManagedAiSessions,
      clearManagedAiSession,
      configureAiAgentSessionStore,
      publishAiAgentSessionEvent,
      renameManagedAiSession,
      replyManagedAiSession
    } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-audit-'))
    await configureAiAgentSessionStore(userDataPath)

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PermissionRequest',
        sessionId: 'codex-audit-1',
        requestId: 'request-1',
        actionable: true,
        cwd: '/work/project',
        summary: 'approve shell command',
        receivedAt: 500
      },
      null
    )
    await replyManagedAiSession({ source: 'codex', sessionId: 'codex-audit-1', kind: 'handled' })
    await renameManagedAiSession({ source: 'codex', sessionId: 'codex-audit-1', title: 'Audit Session' })
    await bulkManagedAiSessions({ operation: 'mark-handled' })
    await clearManagedAiSession({ source: 'codex', sessionId: 'codex-audit-1' })
    await __testing.flushManagedAiSessionWrites()

    const entries = String(await readFile(__testing.auditPathFor(userDataPath), 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          at: 500,
          kind: 'event.received',
          source: 'codex',
          sessionId: 'codex-audit-1',
          event: 'permission_request',
          state: 'needsInput',
          requestId: 'request-1',
          actionable: true,
          summary: 'approve shell command'
        }),
        expect.objectContaining({
          kind: 'decision.created',
          source: 'codex',
          sessionId: 'codex-audit-1',
          decisionKind: 'handled'
        }),
        expect.objectContaining({
          kind: 'session.renamed',
          source: 'codex',
          sessionId: 'codex-audit-1',
          title: 'Audit Session'
        }),
        expect.objectContaining({
          kind: 'sessions.bulk',
          operation: 'mark-handled',
          changed: 0
        }),
        expect.objectContaining({
          kind: 'session.cleared',
          source: 'codex',
          sessionId: 'codex-audit-1',
          title: 'Audit Session'
        })
      ])
    )
  })

  it('streams managed AI session events over the agent socket with replay cursors', async () => {
    const { __testing, ensureAiAgentSessionServer, closeAiAgentSessionServer, publishAiAgentSessionEvent, replyManagedAiSession } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-stream-'))
    const socketPath = await ensureAiAgentSessionServer({ userDataPath, emit: vi.fn() })
    const stream = streamSocket(socketPath, {
      method: 'events.stream',
      params: {
        after_seq: __testing.streamLatestSeq(),
        categories: ['agent', 'managed-ai'],
        include_heartbeats: false
      }
    })
    try {
      await expect(stream.waitForFrames(1)).resolves.toEqual([
        expect.objectContaining({
          type: 'ack',
          protocol: 'aiopsterm-agent-events',
          replay_count: expect.any(Number)
        })
      ])

      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'PermissionRequest',
          sessionId: 'codex-stream-1',
          requestId: 'request-stream-1',
          actionable: true,
          cwd: '/work/project',
          summary: 'approve stream command',
          receivedAt: 600
        },
        null
      )
      await expect(stream.waitForFrames(2)).resolves.toEqual([
        expect.objectContaining({ type: 'ack' }),
        expect.objectContaining({
          type: 'event',
          name: 'agent.hook.PermissionRequest',
          category: 'agent',
          source: 'codex',
          payload: expect.objectContaining({
            source: 'codex',
            sessionId: 'codex-stream-1',
            state: 'needsInput',
            requestId: 'request-stream-1',
            summary: 'approve stream command'
          })
        })
      ])

      await replyManagedAiSession({ source: 'codex', sessionId: 'codex-stream-1', kind: 'handled' })
      const liveFrames = await stream.waitForFrames(3)
      expect(liveFrames[2]).toEqual(
        expect.objectContaining({
          type: 'event',
          name: 'managed_ai.decision.created',
          category: 'managed-ai',
          payload: expect.objectContaining({
            sessionId: 'codex-stream-1',
            decisionKind: 'handled'
          })
        })
      )
      const replay = streamSocket(socketPath, {
        method: 'events.stream',
        params: {
          after_seq: Number(liveFrames[1].seq) - 1,
          name: 'agent.hook.PermissionRequest',
          include_heartbeats: false
        }
      })
      try {
        await expect(replay.waitForFrames(2)).resolves.toEqual([
          expect.objectContaining({ type: 'ack', replay_count: 1 }),
          expect.objectContaining({
            type: 'event',
            seq: liveFrames[1].seq,
            name: 'agent.hook.PermissionRequest'
          })
        ])
      } finally {
        replay.close()
      }
    } finally {
      stream.close()
      closeAiAgentSessionServer()
    }
  })

  it('lists managed AI session events with cursor and source filters', async () => {
    const { __testing, listManagedAiSessionEvents, publishAiAgentSessionEvent, replyManagedAiSession } = await loadBackend()
    const afterSeq = __testing.streamLatestSeq()
    publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'AskUserQuestion',
        sessionId: 'claude-event-list-1',
        requestId: 'question-1',
        actionable: true,
        summary: 'Need deployment window',
        panelId: 'panel-event-list',
        terminalSessionId: 'terminal-event-list',
        receivedAt: 750
      },
      null
    )
    await replyManagedAiSession({ source: 'claude-code', sessionId: 'claude-event-list-1', kind: 'reply', message: 'Tonight' })

    expect(listManagedAiSessionEvents({ afterSeq, source: 'claude-code', limit: 10 })).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          afterSeq,
          latestSeq: expect.any(Number),
          gap: false,
          count: 2,
          events: [
            expect.objectContaining({
              name: 'agent.hook.Question',
              category: 'agent',
              source: 'claude-code',
              terminal_session_id: 'terminal-event-list',
              payload: expect.objectContaining({
                source: 'claude-code',
                sessionId: 'claude-event-list-1',
                state: 'needsInput'
              })
            }),
            expect.objectContaining({
              name: 'managed_ai.decision.created',
              category: 'managed-ai',
              payload: expect.objectContaining({
                sessionId: 'claude-event-list-1',
                decisionKind: 'reply'
              })
            })
          ]
        })
      })
    )
    expect(listManagedAiSessionEvents({ afterSeq, category: 'managed-ai', sessionId: 'claude-event-list-1' })).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          count: 1,
          events: [expect.objectContaining({ name: 'managed_ai.decision.created' })]
        })
      })
    )
  })

  it('waits for actionable Claude decisions and returns Claude hook output to the socket client', async () => {
    const { __testing, ensureAiAgentSessionServer, closeAiAgentSessionServer, listManagedAiSessions, replyManagedAiSession } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-socket-'))
    const socketPath = await ensureAiAgentSessionServer({ userDataPath, emit: vi.fn() })
    try {
      const responsePromise = socketRequest(socketPath, {
        source: 'claude-code',
        event: 'AskUserQuestion',
        session_id: 'claude-blocking-1',
        request_id: 'request-1',
        waitForDecision: true,
        waitTimeoutMs: 5000,
        project_dir: '/work/release-api',
        tool_input: {
          questions: [{ question: 'Which environment?', options: [{ label: 'staging' }, { label: 'prod' }] }]
        }
      })

      await vi.waitFor(async () => {
        const snapshot = (await listManagedAiSessions()) as any
        expect(snapshot.data.sessions[0]).toMatchObject({
          source: 'claude-code',
          id: 'claude-blocking-1',
          state: 'needsInput',
          pendingRequestId: 'request-1',
          actionable: true
        })
      })

      await expect(replyManagedAiSession({ source: 'claude-code', sessionId: 'claude-blocking-1', kind: 'reply', message: 'staging' })).resolves.toEqual(
        expect.objectContaining({ ok: true })
      )

      await expect(responsePromise).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          status: 'resolved',
          agentOutput: {
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision: {
                behavior: 'allow',
                updatedInput: expect.objectContaining({
                  answers: {
                    'Which environment?': 'staging'
                  }
                })
              }
            }
          }
        })
      )
      await __testing.flushManagedAiSessionWrites()
      const entries = String(await readFile(__testing.auditPathFor(userDataPath), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'decision.resolved',
            source: 'claude-code',
            sessionId: 'claude-blocking-1',
            requestId: 'request-1',
            decisionKind: 'reply'
          }),
          expect.objectContaining({
            kind: 'event.socket.completed',
            source: 'claude-code',
            sessionId: 'claude-blocking-1',
            requestId: 'request-1',
            status: 'resolved'
          })
        ])
      )
    } finally {
      closeAiAgentSessionServer()
    }
  })
})
