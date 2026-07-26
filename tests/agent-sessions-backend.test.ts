import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createConnection } from 'net'
import { describe, expect, it, vi } from 'vitest'

type AgentSessionsBackend = {
  configureAiAgentSessionStore: (userDataPath: string) => Promise<void>
  configureManagedAiSessionTerminalLiveness: (resolver?: (sessionId: string) => boolean) => void
  findManagedAiSessionRecord: (source: string, sessionId: string) => Promise<any>
  listManagedAiSessions: () => Promise<unknown>
  listManagedAiSessionContent: (input: Record<string, unknown>) => Promise<unknown>
  configureManagedAiSessionImportRuntime: (config?: Record<string, unknown> & { importSessions?: () => Promise<unknown[]> }) => void
  configureManagedAiSessionGitRuntime: (config?: Record<string, unknown> & { runGit?: (cwd: string, args: string[], timeoutMs: number) => Promise<string> }) => void
  listManagedAiSessionEvents: (input?: Record<string, unknown>) => unknown
  listManagedAiNotifications: (input?: Record<string, unknown>) => Promise<unknown>
  markManagedAiNotificationRead: (input: Record<string, unknown>) => Promise<unknown>
  dismissManagedAiNotification: (input: Record<string, unknown>) => Promise<unknown>
  clearManagedAiNotifications: () => Promise<unknown>
  openManagedAiNotification: (input: Record<string, unknown>) => Promise<unknown>
  jumpToUnreadManagedAiNotification: () => Promise<unknown>
  normalizeAiAgentSessionEventInput: (input: unknown, now?: number) => unknown
  publishAiAgentSessionEvent: (input: Record<string, unknown>, emit?: ((event: unknown) => void) | null) => unknown
  ensureAiAgentSessionServer: (input: { userDataPath: string; emit: (event: unknown) => void }) => Promise<string>
  agentHookScriptPathFor: (appPath: string, resourcesPath: string, userDataPath?: string) => string
  closeAiAgentSessionServer: () => void
  renameManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  replyManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  clearManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  bulkManagedAiSessions: (input: Record<string, unknown>) => Promise<unknown>
  getAgentHibernationConfig: () => Promise<unknown>
  setAgentHibernationConfig: (input: Record<string, unknown>) => Promise<unknown>
  hibernateManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  wakeManagedAiSession: (input: Record<string, unknown>) => Promise<unknown>
  bindManagedAiSessionTerminal: (input: Record<string, unknown>) => Promise<unknown>
  releaseManagedAiTerminalBinding: (terminalSessionId: string) => boolean
  configureManagedAiSessionAutoNamingRuntime: (config?: Record<string, unknown>) => void
  __testing: {
    auditPathFor: (userDataPath: string) => string
    streamLatestSeq: () => number
    flushManagedAiSessionImports: () => Promise<number>
    flushManagedAiSessionGitRefresh: () => Promise<number>
    flushManagedAiSessionWrites: () => Promise<void>
    flushCodexTranscriptMonitors: () => Promise<void>
    activeCodexTranscriptMonitorCount: () => number
  }
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/agent/agentSessions'
  return (await import(modulePath)) as AgentSessionsBackend
}

type ProjectFilesBackend = {
  configureProjectFilesRuntime: (input: Record<string, unknown>) => void
  getProjectFileContext: (input: Record<string, unknown>) => Promise<unknown>
}

const loadProjectFilesBackend = async () => {
  const modulePath = '../src/main/backend/files/projectFiles'
  return (await import(modulePath)) as ProjectFilesBackend
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
  it('stages the agent hook helper under userData for stable installed hook paths', async () => {
    const { agentHookScriptPathFor } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-hook-path-'))
    const appPath = join(root, 'app')
    const resourcesPath = join(root, 'tmp-mount')
    const userDataPath = join(root, 'user-data')
    await mkdir(join(resourcesPath, 'resources'), { recursive: true })
    await writeFile(join(resourcesPath, 'resources', 'aiopsterm-agent-hook.js'), '#!/usr/bin/env node\n', 'utf-8')

    const staged = agentHookScriptPathFor(appPath, resourcesPath, userDataPath)

    expect(staged).toBe(join(userDataPath, 'agent-hooks', 'aiopsterm-agent-hook.js'))
    expect(await readFile(staged, 'utf-8')).toBe('#!/usr/bin/env node\n')
  })

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
        canonicalCwd: '/work/project',
        summary: 'Approve shell command',
        requestKind: 'permission',
        decisionMode: 'local',
        actionable: true,
        receivedAt: 100
      })
    })
  })

  it('restores old stored Codex permission prompts as pending terminal attention', async () => {
    const { configureAiAgentSessionStore, listManagedAiSessions } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-stored-permission-'))
    const storeDir = join(root, 'agent-sessions')
    await mkdir(storeDir, { recursive: true })
    await writeFile(
      join(storeDir, 'managed-ai-sessions.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'codex-stored-permission-1',
            source: 'codex',
            title: 'Codex · api',
            summary: 'Bash: npm test',
            state: 'working',
            lastEvent: 'permission_request',
            lastActivityAt: 200,
            createdAt: 100,
            updatedAt: 200,
            requestKind: 'permission',
            decisionMode: 'local',
            actionable: false,
            events: [
              {
                id: 'event-1',
                source: 'codex',
                event: 'permission_request',
                sessionId: 'codex-stored-permission-1',
                requestId: 'codex-request-1',
                title: 'Codex · api',
                summary: 'Bash: npm test',
                receivedAt: 200,
                requestKind: 'permission',
                decisionMode: 'local',
                actionable: false
              }
            ],
            decisions: []
          }
        ]
      }),
      'utf-8'
    )

    await configureAiAgentSessionStore(root)

    await expect(listManagedAiSessions()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'codex-stored-permission-1',
              state: 'needsInput',
              requestKind: 'permission',
              decisionMode: 'local',
              actionable: true,
              pendingRequestId: 'codex-request-1',
              events: [expect.objectContaining({ actionable: true })]
            })
          ]
        })
      })
    )
  })

  it('promotes Codex AskUserQuestion hooks to managed AI pending sessions', async () => {
    const { configureAiAgentSessionStore, listManagedAiNotifications, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-codex-ask-user-question-')))

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'AskUserQuestion',
        sessionId: 'codex-question-hook-1',
        requestId: 'codex-question-request-1',
        cwd: '/work/kids-game',
        panelId: 'panel-codex-question',
        terminalSessionId: 'terminal-codex-question',
        tool_input: {
          questions: [
            {
              question: '你最希望第一版上线后验证什么？',
              options: [
                { label: '孩子愿意反复玩', description: '优先做关卡反馈、趣味包装和可重复性' },
                { label: '家长觉得有价值', description: '优先做能力说明、难度分级、时长建议' }
              ]
            }
          ]
        },
        receivedAt: 260
      },
      null
    )

    const sessionsResponse = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    expect(sessionsResponse.data?.sessions?.find((item) => item.id === 'codex-question-hook-1')).toEqual(
      expect.objectContaining({
        id: 'codex-question-hook-1',
        source: 'codex',
        state: 'needsInput',
        lastEvent: 'question',
        summary: '你最希望第一版上线后验证什么？',
        requestKind: 'question',
        decisionMode: 'local',
        actionable: true,
        pendingRequestId: 'codex-question-request-1',
        panelId: 'panel-codex-question',
        terminalSessionId: 'terminal-codex-question'
      })
    )
    await expect(listManagedAiNotifications({ unread: true })).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          count: 1,
          unreadCount: 1,
          notifications: [
            expect.objectContaining({
              source: 'codex',
              sessionId: 'codex-question-hook-1',
              needsInput: true,
              requestKind: 'question',
              pendingRequestId: 'codex-question-request-1',
              summary: '你最希望第一版上线后验证什么？'
            })
          ]
        })
      })
    )
  })

  it('promotes Codex request_user_input pre-tool hooks to managed AI pending sessions', async () => {
    const { configureAiAgentSessionStore, listManagedAiNotifications, listManagedAiSessions, normalizeAiAgentSessionEventInput, publishAiAgentSessionEvent } =
      await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-codex-request-user-input-pre-tool-')))

    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'codex',
          event: 'PreToolUse',
          sessionId: 'codex-question-pre-tool-1',
          requestId: 'codex-question-pre-tool-request-1',
          tool_name: 'request_user_input',
          tool_input: {
            questions: [{ question: '请选择部署环境', options: [{ label: 'staging' }, { label: 'prod' }] }]
          },
          cwd: '/work/deploy',
          receivedAt: 270
        },
        270
      )
    ).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          event: 'pre_tool_use',
          requestKind: 'question',
          decisionMode: 'local',
          actionable: true,
          toolName: 'request_user_input',
          summary: '请选择部署环境'
        })
      })
    )

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PreToolUse',
        sessionId: 'codex-question-pre-tool-1',
        requestId: 'codex-question-pre-tool-request-1',
        cwd: '/work/deploy',
        panelId: 'panel-codex-pre-tool-question',
        terminalSessionId: 'terminal-codex-pre-tool-question',
        tool_name: 'request_user_input',
        tool_input: {
          questions: [{ question: '请选择部署环境', options: [{ label: 'staging' }, { label: 'prod' }] }]
        },
        receivedAt: 270
      },
      null
    )

    const sessionsResponse = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    expect(sessionsResponse.data?.sessions?.find((item) => item.id === 'codex-question-pre-tool-1')).toEqual(
      expect.objectContaining({
        id: 'codex-question-pre-tool-1',
        source: 'codex',
        state: 'needsInput',
        lastEvent: 'pre_tool_use',
        summary: '请选择部署环境',
        requestKind: 'question',
        decisionMode: 'local',
        actionable: true,
        pendingRequestId: 'codex-question-pre-tool-request-1',
        toolName: 'request_user_input',
        panelId: 'panel-codex-pre-tool-question',
        terminalSessionId: 'terminal-codex-pre-tool-question'
      })
    )
    await expect(listManagedAiNotifications({ unread: true })).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          count: 1,
          unreadCount: 1,
          notifications: [
            expect.objectContaining({
              source: 'codex',
              sessionId: 'codex-question-pre-tool-1',
              needsInput: true,
              requestKind: 'question',
              pendingRequestId: 'codex-question-pre-tool-request-1',
              toolName: 'request_user_input',
              summary: '请选择部署环境'
            })
          ]
        })
      })
    )
  })

  it('stores canonical cwd metadata for symlink-aware project grouping', async () => {
    const { configureAiAgentSessionStore, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-canonical-cwd-'))
    const realProject = join(root, 'real', 'aiopsterm')
    const linkedProject = join(root, 'link-aiopsterm')
    await mkdir(realProject, { recursive: true })
    await symlink(realProject, linkedProject)
    await configureAiAgentSessionStore(join(root, 'user-data'))

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'SessionStart',
        sessionId: 'codex-canonical-1',
        cwd: linkedProject,
        receivedAt: 160
      },
      null
    )

    const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    expect(response.data?.sessions?.[0]).toEqual(
      expect.objectContaining({
        id: 'codex-canonical-1',
        cwd: linkedProject,
        canonicalCwd: realProject
      })
    )
  })

  it('persists terminal-origin session end events over stale active state', async () => {
    const { __testing, configureAiAgentSessionStore, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-terminal-ended-'))
    await configureAiAgentSessionStore(root)

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'pre_tool_use',
        sessionId: 'codex-terminal-ended-1',
        title: 'Codex project',
        summary: 'Running tests',
        panelId: 'panel-main',
        terminalSessionId: 'terminal-session-1',
        agentLifecycle: 'running',
        receivedAt: 100
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'session_end',
        sessionId: 'codex-terminal-ended-1',
        title: 'Codex project',
        summary: 'Terminal closed',
        panelId: 'panel-main',
        terminalSessionId: 'terminal-session-1',
        agentLifecycle: 'ended',
        receivedAt: 200
      },
      null
    )
    await __testing.flushManagedAiSessionWrites()

    const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    expect(response.data?.sessions?.find((session) => session.id === 'codex-terminal-ended-1')).toEqual(
      expect.objectContaining({
        state: 'ended',
        agentLifecycle: 'ended',
        lastEvent: 'session_end',
        lastActivityAt: 200
      })
    )
    const stored = JSON.parse(await readFile(join(root, 'agent-sessions', 'managed-ai-sessions.json'), 'utf-8')) as {
      sessions: Array<Record<string, unknown>>
    }
    expect(stored.sessions.find((session) => session.id === 'codex-terminal-ended-1')).toEqual(
      expect.objectContaining({ state: 'ended', agentLifecycle: 'ended', lastEvent: 'session_end' })
    )
  })

  it('reconciles persisted active state against Main terminal liveness without ending a live detached PTY', async () => {
    const {
      configureAiAgentSessionStore,
      configureManagedAiSessionTerminalLiveness,
      listManagedAiSessions,
      publishAiAgentSessionEvent
    } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-terminal-liveness-')))
    const liveTerminalIds = new Set(['terminal-live'])
    configureManagedAiSessionTerminalLiveness((sessionId) => liveTerminalIds.has(sessionId))
    try {
      for (const [sessionId, terminalSessionId] of [
        ['codex-live-detached', 'terminal-live'],
        ['codex-stale-active', 'terminal-stale']
      ]) {
        publishAiAgentSessionEvent(
          {
            source: 'codex',
            event: 'pre_tool_use',
            sessionId,
            title: sessionId,
            summary: 'Running',
            terminalSessionId,
            agentLifecycle: 'running',
            receivedAt: 100
          },
          null
        )
      }

      const first = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(first.data?.sessions?.find((session) => session.id === 'codex-live-detached')).toEqual(
        expect.objectContaining({ state: 'working', terminalSessionId: 'terminal-live' })
      )
      expect(first.data?.sessions?.find((session) => session.id === 'codex-stale-active')).toEqual(
        expect.objectContaining({ state: 'ended', summary: 'Terminal no longer exists', agentLifecycle: 'ended' })
      )

      liveTerminalIds.delete('terminal-live')
      const second = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(second.data?.sessions?.find((session) => session.id === 'codex-live-detached')).toEqual(
        expect.objectContaining({ state: 'ended', summary: 'Terminal no longer exists', agentLifecycle: 'ended' })
      )
    } finally {
      configureManagedAiSessionTerminalLiveness()
    }
  })

  it('keeps exactly one top-level agent session bound to a managed terminal across session switches', async () => {
    const {
      configureAiAgentSessionStore,
      configureManagedAiSessionTerminalLiveness,
      listManagedAiSessions,
      publishAiAgentSessionEvent,
      releaseManagedAiTerminalBinding
    } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-terminal-binding-')))
    configureManagedAiSessionTerminalLiveness((sessionId) => sessionId === 'terminal-switch')
    try {
      publishAiAgentSessionEvent({
        source: 'codex',
        event: 'session_start',
        sessionId: 'session-a',
        terminalSessionId: 'terminal-switch',
        panelId: 'panel-switch',
        cwd: '/work/a',
        receivedAt: 100
      }, null)
      publishAiAgentSessionEvent({
        source: 'codex',
        event: 'session_start',
        sessionId: 'session-b',
        terminalSessionId: 'terminal-switch',
        panelId: 'panel-switch',
        cwd: '/work/b',
        receivedAt: 200
      }, null)

      let response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(response.data?.sessions?.find((session) => session.id === 'session-a')?.terminalSessionId).toBeUndefined()
      expect(response.data?.sessions?.find((session) => session.id === 'session-b')).toEqual(
        expect.objectContaining({ terminalSessionId: 'terminal-switch', panelId: 'panel-switch' })
      )

      publishAiAgentSessionEvent({
        source: 'codex',
        event: 'session_end',
        sessionId: 'session-a',
        terminalSessionId: 'terminal-switch',
        receivedAt: 300
      }, null)
      response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(response.data?.sessions?.find((session) => session.id === 'session-b')?.terminalSessionId).toBe('terminal-switch')

      expect(releaseManagedAiTerminalBinding('terminal-switch')).toBe(true)
      response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(response.data?.sessions?.find((session) => session.id === 'session-b')?.terminalSessionId).toBeUndefined()
    } finally {
      configureManagedAiSessionTerminalLiveness()
    }
  })

  it('adds cached git branch and dirty metadata to managed AI session snapshots', async () => {
    const { __testing, configureAiAgentSessionStore, configureManagedAiSessionGitRuntime, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-git-'))
    const project = join(root, 'repo')
    await mkdir(project, { recursive: true })
    await configureAiAgentSessionStore(join(root, 'user-data'))
    const runGit = vi.fn(async (_cwd: string, args: string[]) => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'main\n'
      if (args.join(' ') === 'status --porcelain') return ' M src/app.ts\n'
      return ''
    })
    configureManagedAiSessionGitRuntime({
      ttlMs: 1000,
      now: () => 200,
      runGit
    })

    try {
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'SessionStart',
          sessionId: 'codex-git-1',
          cwd: project,
          receivedAt: 160
        },
        null
      )

      const initial = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      await __testing.flushManagedAiSessionGitRefresh()
      const second = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }

      expect(initial.data?.sessions?.[0]).toEqual(
        expect.objectContaining({
          id: 'codex-git-1'
        })
      )
      expect(initial.data?.sessions?.[0]).not.toHaveProperty('gitBranch')
      expect(second.data?.sessions?.[0]).toEqual(
        expect.objectContaining({
          id: 'codex-git-1',
          gitBranch: 'main',
          gitDirty: true,
          gitStatusUpdatedAt: 200
        })
      )
      expect(runGit).toHaveBeenCalledTimes(2)
      await __testing.flushManagedAiSessionGitRefresh()
    } finally {
      configureManagedAiSessionGitRuntime()
    }
  })

  it('does not publish git refreshes for timestamp-only probe results', async () => {
    const { __testing, configureAiAgentSessionStore, configureManagedAiSessionGitRuntime, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-git-timestamp-'))
    const project = join(root, 'repo')
    await mkdir(project, { recursive: true })
    await configureAiAgentSessionStore(join(root, 'user-data'))
    const runGit = vi.fn(async () => '')
    configureManagedAiSessionGitRuntime({
      ttlMs: 0,
      now: () => 500,
      runGit
    })

    try {
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'SessionStart',
          sessionId: 'codex-git-timestamp-1',
          cwd: project,
          receivedAt: 450
        },
        null
      )

      await listManagedAiSessions()
      await expect(__testing.flushManagedAiSessionGitRefresh()).resolves.toBe(0)
      const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }

      expect(response.data?.sessions?.[0]).toEqual(expect.objectContaining({ id: 'codex-git-timestamp-1' }))
      expect(response.data?.sessions?.[0]).not.toHaveProperty('gitStatusUpdatedAt')
      expect(runGit).toHaveBeenCalledTimes(2)
      await __testing.flushManagedAiSessionGitRefresh()
    } finally {
      configureManagedAiSessionGitRuntime()
    }
  })

  it('returns managed AI session snapshots without waiting for slow git metadata probes', async () => {
    const { __testing, configureAiAgentSessionStore, configureManagedAiSessionGitRuntime, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-git-slow-'))
    const project = join(root, 'repo')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeFile(join(project, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await configureAiAgentSessionStore(join(root, 'user-data'))
    const gitRequests: Array<{ args: string[]; resolve: (value: string) => void }> = []
    const runGit = vi.fn((_cwd: string, args: string[]) =>
      new Promise<string>((resolve) => {
        gitRequests.push({ args, resolve })
      })
    )
    configureManagedAiSessionGitRuntime({
      ttlMs: 1000,
      now: () => 300,
      runGit
    })

    try {
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'SessionStart',
          sessionId: 'codex-git-slow-1',
          cwd: project,
          receivedAt: 260
        },
        null
      )
      publishAiAgentSessionEvent(
        {
          source: 'claude-code',
          event: 'SessionStart',
          sessionId: 'claude-git-slow-1',
          cwd: project,
          receivedAt: 270
        },
        null
      )

      const initial = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }

      expect(initial.data?.sessions).toHaveLength(2)
      expect(runGit).not.toHaveBeenCalled()

      const refresh = __testing.flushManagedAiSessionGitRefresh()
      await vi.waitFor(() => expect(gitRequests).toHaveLength(1))
      expect(gitRequests[0].args).toEqual(['rev-parse', '--abbrev-ref', 'HEAD'])
      gitRequests[0].resolve('feature/large-repo\n')
      await vi.waitFor(() => expect(gitRequests).toHaveLength(2))
      expect(gitRequests[1].args).toEqual(['status', '--porcelain'])
      gitRequests[1].resolve('')
      await expect(refresh).resolves.toBe(2)

      const refreshed = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(refreshed.data?.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'codex-git-slow-1', gitBranch: 'feature/large-repo', gitDirty: false }),
          expect.objectContaining({ id: 'claude-git-slow-1', gitBranch: 'feature/large-repo', gitDirty: false })
        ])
      )
      expect(runGit).toHaveBeenCalledTimes(2)
      await __testing.flushManagedAiSessionGitRefresh()
    } finally {
      configureManagedAiSessionGitRuntime()
    }
  })

  it('loads managed AI session content without refreshing imported sessions or git metadata for existing sessions', async () => {
    const {
      configureAiAgentSessionStore,
      configureManagedAiSessionGitRuntime,
      configureManagedAiSessionImportRuntime,
      listManagedAiSessionContent,
      publishAiAgentSessionEvent
    } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-content-no-refresh-'))
    const project = join(root, 'repo')
    const transcriptPath = join(root, 'codex-content.jsonl')
    await mkdir(project, { recursive: true })
    await writeFile(
      transcriptPath,
      `${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello from transcript' }] } })}\n`,
      'utf-8'
    )
    await configureAiAgentSessionStore(join(root, 'user-data'))
    const importSessions = vi.fn(async () => [])
    const runGit = vi.fn(async () => '')
    configureManagedAiSessionImportRuntime({ importSessions })
    configureManagedAiSessionGitRuntime({ runGit })

    try {
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'SessionStart',
          sessionId: 'codex-content-no-refresh-1',
          cwd: project,
          transcriptPath,
          receivedAt: 240
        },
        null
      )

      const response = (await listManagedAiSessionContent({
        source: 'codex',
        sessionId: 'codex-content-no-refresh-1',
        limit: 10,
        maxContentChars: 1000
      })) as { ok?: boolean; data?: { records?: Array<Record<string, unknown>> } }

      expect(response.ok).toBe(true)
      expect(response.data?.records?.map((record) => record.content)).toContain('hello from transcript')
      expect(importSessions).not.toHaveBeenCalled()
      expect(runGit).not.toHaveBeenCalled()
    } finally {
      configureManagedAiSessionImportRuntime()
      configureManagedAiSessionGitRuntime()
    }
  })

  it('promotes stock Codex permission hooks to pending terminal attention', async () => {
    const { configureAiAgentSessionStore, listManagedAiNotifications, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-codex-telemetry-')))

    expect(
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'PermissionRequest',
          sessionId: 'codex-telemetry-1',
          requestId: 'codex-request-1',
          title: 'Codex · api-service',
          summary: 'approve npm test',
          cwd: '/work/api-service',
          receivedAt: 150
        },
        null
      )
    ).toEqual(expect.objectContaining({ ok: true }))

    const sessionsResponse = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    expect(sessionsResponse).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'codex-telemetry-1',
              state: 'needsInput',
              requestKind: 'permission',
              decisionMode: 'local',
              actionable: true,
              pendingRequestId: 'codex-request-1'
            })
          ]
        })
      })
    )
    await expect(listManagedAiNotifications({ unread: true })).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          count: 1,
          unreadCount: 1,
          notifications: [expect.objectContaining({ source: 'codex', sessionId: 'codex-telemetry-1', needsInput: true })]
        })
      })
    )
  })

  it('promotes Codex transcript request_user_input entries to question notifications', async () => {
    const {
      __testing,
      configureAiAgentSessionStore,
      listManagedAiNotifications,
      listManagedAiSessions,
      publishAiAgentSessionEvent
    } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-question-'))
    const transcriptPath = join(root, 'codex-session.jsonl')
    await configureAiAgentSessionStore(join(root, 'user-data'))
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'request_user_input',
            turn_id: 'turn-1',
            call_id: 'call-question-1',
            questions: [
              {
                id: 'site-style',
                header: '儿童游戏网站',
                question: '你更想让它像哪一种儿童游戏网站？',
                options: [
                  { label: '益智', description: '偏学习和轻互动' },
                  { label: '闯关', description: '偏挑战和奖励' }
                ]
              }
            ]
          }
        })
      ].join('\n') + '\n',
      'utf-8'
    )

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'UserPromptSubmit',
        sessionId: 'codex-question-1',
        cwd: '/work/kids-game',
        transcriptPath,
        turnId: 'turn-1',
        receivedAt: 180
      },
      null
    )
    await __testing.flushCodexTranscriptMonitors()
    await __testing.flushCodexTranscriptMonitors()

    const sessionsResponse = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    const session = sessionsResponse.data?.sessions?.find((item) => item.id === 'codex-question-1')
    expect(session).toEqual(
      expect.objectContaining({
        id: 'codex-question-1',
        source: 'codex',
        state: 'needsInput',
        lastEvent: 'question',
        summary: '你更想让它像哪一种儿童游戏网站？',
        requestKind: 'question',
        decisionMode: 'local',
        actionable: true,
        pendingRequestId: 'call-question-1',
        transcriptPath
      })
    )
    expect((session?.events as Array<Record<string, unknown>>).filter((event) => event.event === 'question')).toHaveLength(1)
    await expect(listManagedAiNotifications({ unread: true })).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          count: 1,
          unreadCount: 1,
          notifications: [
            expect.objectContaining({
              source: 'codex',
              sessionId: 'codex-question-1',
              needsInput: true,
              requestKind: 'question',
              pendingRequestId: 'call-question-1',
              summary: '你更想让它像哪一种儿童游戏网站？'
            })
          ]
        })
      })
    )
  })

  it('promotes Codex transcript request_user_input function calls to question notifications', async () => {
    const {
      __testing,
      configureAiAgentSessionStore,
      listManagedAiSessions,
      publishAiAgentSessionEvent
    } = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-function-question-'))
    const transcriptPath = join(root, 'codex-session.jsonl')
    await configureAiAgentSessionStore(join(root, 'user-data'))
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-2' } }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'request_user_input',
            call_id: 'call-question-2',
            arguments: JSON.stringify({
              questions: [
                {
                  id: 'approval-style',
                  question: '要按哪种权限策略继续？'
                }
              ]
            })
          }
        })
      ].join('\n') + '\n',
      'utf-8'
    )

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'UserPromptSubmit',
        sessionId: 'codex-question-2',
        cwd: '/work/approval',
        transcriptPath,
        turnId: 'turn-2',
        receivedAt: 181
      },
      null
    )
    await __testing.flushCodexTranscriptMonitors()

    const sessionsResponse = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
    expect(sessionsResponse.data?.sessions?.find((item) => item.id === 'codex-question-2')).toEqual(
      expect.objectContaining({
        state: 'needsInput',
        lastEvent: 'question',
        summary: '要按哪种权限策略继续？',
        requestKind: 'question',
        pendingRequestId: 'call-question-2'
      })
    )
  })

  it('classifies ExitPlanMode as plan input without treating Codex hook telemetry as blocking', async () => {
    const { normalizeAiAgentSessionEventInput } = await loadBackend()
    expect(
      normalizeAiAgentSessionEventInput(
        {
          source: 'codex',
          hookEventName: 'PermissionRequest',
          session_id: 'codex-plan-1',
          tool_name: 'ExitPlanMode',
          request_id: 'plan-1',
          summary: 'Review implementation plan',
          waitForDecision: true
        },
        150
      )
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'codex',
        event: 'permission_request',
        sessionId: 'codex-plan-1',
        requestKind: 'plan',
        decisionMode: 'local',
        toolName: 'ExitPlanMode',
        actionable: true
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
        requestKind: 'question',
        decisionMode: 'local',
        actionable: true,
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

    const childResult = normalizeAiAgentSessionEventInput(
      {
        source: 'cursor',
        event: 'SessionStart',
        session_id: 'cursor-child-1',
        cwd: '/work/project',
        thread_source: 'subagent',
        parent_session_id: 'cursor-parent-1',
        resumeCommand: "cursor-agent --resume 'cursor-child-1'"
      },
      270
    )
    expect(childResult).toEqual({
      ok: true,
      data: expect.objectContaining({
        source: 'cursor',
        sessionId: 'cursor-child-1',
        sessionKind: 'subagent',
        parentSessionId: 'cursor-parent-1',
        restorable: false
      })
    })
    expect((childResult as { data?: Record<string, unknown> }).data).not.toHaveProperty('resumeCommand')
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
            state: 'needsInput',
            requestKind: 'notification',
            decisionMode: 'local',
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

  it('returns managed AI session snapshots without waiting for slow local history import', async () => {
    const { __testing, configureAiAgentSessionStore, configureManagedAiSessionImportRuntime, listManagedAiSessions } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-slow-')))
    const imported = [
      {
        id: 'codex-slow-import-1',
        source: 'codex',
        title: 'Imported Slow Codex',
        summary: 'slow historical codex task',
        state: 'idle',
        lastEvent: 'session_start',
        lastActivityAt: 1781884700000,
        createdAt: 1781884700000,
        updatedAt: 1781885000000,
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        agentLifecycle: 'idle',
        events: [
          {
            id: 'imported-slow-codex',
            source: 'codex',
            event: 'session_start',
            sessionId: 'codex-slow-import-1',
            title: 'Imported Slow Codex',
            summary: 'slow historical codex task',
            receivedAt: 1781884700000,
            requestKind: 'telemetry',
            decisionMode: 'telemetry'
          }
        ]
      }
    ]
    let resolveImport: (value: unknown[]) => void = () => undefined
    const importSessions = vi.fn(() =>
      new Promise<unknown[]>((resolve) => {
        resolveImport = resolve
      })
    )
    configureManagedAiSessionImportRuntime({ importSessions })

    try {
      const initial = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(initial.data?.sessions || []).toHaveLength(0)
      expect(importSessions).not.toHaveBeenCalled()

      const scan = __testing.flushManagedAiSessionImports()
      await vi.waitFor(() => expect(importSessions).toHaveBeenCalledTimes(1))
      resolveImport(imported)
      await expect(scan).resolves.toBe(1)

      const refreshed = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      expect(refreshed.data?.sessions).toEqual([
        expect.objectContaining({
          id: 'codex-slow-import-1',
          title: 'Imported Slow Codex'
        })
      ])
    } finally {
      configureManagedAiSessionImportRuntime()
    }
  })

  it('does not immediately rescan imported history after a background import event reloads the list', async () => {
    const { __testing, configureAiAgentSessionStore, configureManagedAiSessionImportRuntime, listManagedAiSessions } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-cooldown-')))

    const importSessions = vi.fn(async () => [
      {
        id: 'codex-import-cooldown-1',
        source: 'codex',
        title: 'Imported Cooldown Codex',
        summary: 'historical codex task',
        state: 'idle',
        lastEvent: 'session_start',
        lastActivityAt: 1781884700000,
        createdAt: 1781884700000,
        updatedAt: 1781885000000,
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        agentLifecycle: 'idle',
        events: [
          {
            id: `imported-cooldown-${importSessions.mock.calls.length}`,
            source: 'codex',
            event: 'session_start',
            sessionId: 'codex-import-cooldown-1',
            title: 'Imported Cooldown Codex',
            summary: 'historical codex task',
            receivedAt: 1781884700000,
            requestKind: 'telemetry',
            decisionMode: 'telemetry'
          }
        ]
      }
    ])
    configureManagedAiSessionImportRuntime({ importSessions })

    try {
      await listManagedAiSessions()
      await expect(__testing.flushManagedAiSessionImports()).resolves.toBe(1)
      await listManagedAiSessions()
      await expect(__testing.flushManagedAiSessionImports()).resolves.toBe(0)

      expect(importSessions).toHaveBeenCalledTimes(1)
    } finally {
      configureManagedAiSessionImportRuntime()
    }
  })

  it('merges imported local agent history without overwriting live managed session state', async () => {
    const {
      __testing,
      configureAiAgentSessionStore,
      configureManagedAiSessionImportRuntime,
      listManagedAiSessions,
      publishAiAgentSessionEvent
    } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-merge-')))

    publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'AskUserQuestion',
        sessionId: 'claude-live-1',
        requestId: 'question-1',
        actionable: true,
        waitForDecision: true,
        title: 'Live Claude',
        summary: 'Pick a release target',
        receivedAt: 1781884900000
      },
      null
    )

    const imported = [
      {
        id: 'claude-live-1',
        source: 'claude-code',
        title: 'Imported Claude',
        summary: 'imported history',
        state: 'idle',
        lastEvent: 'session_start',
        lastActivityAt: 1781884800000,
        createdAt: 1781884800000,
        updatedAt: 1781885000000,
        cwd: '/work/claude-live',
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        resumeCommand: "cd '/work/claude-live' && claude --resume 'claude-live-1'",
        agentLifecycle: 'idle',
        events: [
          {
            id: 'imported-claude-live',
            source: 'claude-code',
            event: 'session_start',
            sessionId: 'claude-live-1',
            title: 'Imported Claude',
            summary: 'imported history',
            receivedAt: 1781884800000,
            cwd: '/work/claude-live',
            requestKind: 'telemetry',
            decisionMode: 'telemetry',
            resumeCommand: "cd '/work/claude-live' && claude --resume 'claude-live-1'"
          }
        ]
      },
      {
        id: 'codex-imported-1',
        source: 'codex',
        title: 'Imported Codex',
        summary: 'historical codex task',
        state: 'idle',
        lastEvent: 'session_start',
        lastActivityAt: 1781884700000,
        createdAt: 1781884700000,
        updatedAt: 1781885000000,
        cwd: '/work/codex-imported',
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        resumeCommand: "cd '/work/codex-imported' && codex resume 'codex-imported-1'",
        agentLifecycle: 'idle',
        events: [
          {
            id: 'imported-codex',
            source: 'codex',
            event: 'session_start',
            sessionId: 'codex-imported-1',
            title: 'Imported Codex',
            summary: 'historical codex task',
            receivedAt: 1781884700000,
            cwd: '/work/codex-imported',
            requestKind: 'telemetry',
            decisionMode: 'telemetry',
            resumeCommand: "cd '/work/codex-imported' && codex resume 'codex-imported-1'"
          }
        ]
      }
    ]
    configureManagedAiSessionImportRuntime({
      importSessions: async () => imported
    })

    try {
      await listManagedAiSessions()
      await __testing.flushManagedAiSessionImports()
      const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      const sessions = response.data?.sessions || []
      const live = sessions.find((session) => session.id === 'claude-live-1')
      const codex = sessions.find((session) => session.id === 'codex-imported-1')

      expect(live).toEqual(
        expect.objectContaining({
          title: 'Live Claude',
          state: 'needsInput',
          pendingRequestId: 'question-1',
          cwd: '/work/claude-live',
          resumeCommand: "cd '/work/claude-live' && claude --resume 'claude-live-1'"
        })
      )
      expect(codex).toEqual(
        expect.objectContaining({
          source: 'codex',
          title: 'Imported Codex',
          state: 'idle',
          resumeCommand: "cd '/work/codex-imported' && codex resume 'codex-imported-1'"
        })
      )
    } finally {
      configureManagedAiSessionImportRuntime()
    }
  })

  it('does not re-import unchanged review-only child sessions on every list refresh', async () => {
    const {
      __testing,
      configureAiAgentSessionStore,
      configureManagedAiSessionImportRuntime,
      listManagedAiSessions
    } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-idempotent-'))
    await configureAiAgentSessionStore(userDataPath)

    const imported = [
      {
        id: 'codex-child-history-1',
        source: 'codex',
        title: 'Child review',
        summary: 'review-only child session',
        state: 'idle',
        lastEvent: 'session_start',
        lastActivityAt: 1781884600000,
        createdAt: 1781884600000,
        updatedAt: 1781885000000,
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        sessionKind: 'subagent',
        parentSessionId: 'codex-parent-history-1',
        restorable: false,
        agentLifecycle: 'idle',
        events: [
          {
            id: 'imported-codex-child',
            source: 'codex',
            event: 'session_start',
            sessionId: 'codex-child-history-1',
            title: 'Child review',
            summary: 'review-only child session',
            receivedAt: 1781884600000,
            requestKind: 'telemetry',
            decisionMode: 'telemetry',
            sessionKind: 'subagent',
            parentSessionId: 'codex-parent-history-1',
            restorable: false
          }
        ]
      }
    ]
    configureManagedAiSessionImportRuntime({
      importSessions: async () => imported
    })

    try {
      await listManagedAiSessions()
      await __testing.flushManagedAiSessionImports()
      const first = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      const firstSession = first.data?.sessions?.find((session) => session.id === 'codex-child-history-1')
      const firstUpdatedAt = firstSession?.updatedAt

      await __testing.flushManagedAiSessionImports()
      const second = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      const secondSession = second.data?.sessions?.find((session) => session.id === 'codex-child-history-1')

      expect(secondSession).toEqual(
        expect.objectContaining({
          sessionKind: 'subagent',
          parentSessionId: 'codex-parent-history-1',
          restorable: false
        })
      )
      expect(secondSession?.updatedAt).toBe(firstUpdatedAt)

      await __testing.flushManagedAiSessionWrites()
      const entries = String(await readFile(__testing.auditPathFor(userDataPath), 'utf-8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(entries.filter((entry) => entry.kind === 'sessions.imported')).toEqual([
        expect.objectContaining({ changed: 1 })
      ])
    } finally {
      configureManagedAiSessionImportRuntime()
    }
  })

  it('keeps all imported sessions instead of capping the managed session store', async () => {
    const {
      __testing,
      configureAiAgentSessionStore,
      configureManagedAiSessionImportRuntime,
      listManagedAiSessions
    } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-import-unlimited-')))

    const imported = Array.from({ length: 205 }, (_item, index) => ({
      id: `codex-imported-many-${index}`,
      source: 'codex',
      title: `Imported Codex ${index}`,
      summary: `historical codex task ${index}`,
      state: 'idle',
      lastEvent: 'session_start',
      lastActivityAt: 1781885000000 - index,
      createdAt: 1781884000000 - index,
      updatedAt: 1781886000000,
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      agentLifecycle: 'idle',
      events: [
        {
          id: `imported-many-${index}`,
          source: 'codex',
          event: 'session_start',
          sessionId: `codex-imported-many-${index}`,
          title: `Imported Codex ${index}`,
          summary: `historical codex task ${index}`,
          receivedAt: 1781885000000 - index,
          requestKind: 'telemetry',
          decisionMode: 'telemetry'
        }
      ]
    }))
    configureManagedAiSessionImportRuntime({
      importSessions: async () => imported
    })

    try {
      await listManagedAiSessions()
      await __testing.flushManagedAiSessionImports()
      const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, unknown>> } }
      const sessions = response.data?.sessions || []

      expect(sessions).toHaveLength(205)
      expect(sessions.some((session) => session.id === 'codex-imported-many-204')).toBe(true)
    } finally {
      configureManagedAiSessionImportRuntime()
    }
  })

  it('tracks explicit agent hibernation state and config', async () => {
    const {
      configureAiAgentSessionStore,
      getAgentHibernationConfig,
      hibernateManagedAiSession,
      listManagedAiSessions,
      publishAiAgentSessionEvent,
      replyManagedAiSession,
      setAgentHibernationConfig,
      wakeManagedAiSession
    } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-hibernate-')))

    await expect(getAgentHibernationConfig()).resolves.toEqual({
      ok: true,
      data: {
        config: { enabled: false, idleSeconds: 300, maxLiveTerminals: 12, confirmationSeconds: 60 }
      }
    })

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'Stop',
        sessionId: 'codex-hibernate-1',
        cwd: '/work/project',
        resumeCommand: "cd '/work/project' && codex resume 'codex-hibernate-1'",
        terminalSessionId: 'terminal-session-1',
        agentLifecycle: 'idle',
        receivedAt: 500
      },
      null
    )

    await expect(hibernateManagedAiSession({ source: 'codex', sessionId: 'codex-hibernate-1' })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'AGENT_HIBERNATION_DISABLED' })
    )
    await expect(setAgentHibernationConfig({ enabled: true, idleSeconds: 10, maxLiveTerminals: 2, confirmationSeconds: 1 })).resolves.toEqual({
      ok: true,
      data: {
        config: { enabled: true, idleSeconds: 10, maxLiveTerminals: 2, confirmationSeconds: 1 }
      }
    })
    await expect(hibernateManagedAiSession({ source: 'codex', sessionId: 'codex-hibernate-1', terminalSessionId: 'terminal-session-1' })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'AGENT_HIBERNATION_NEEDS_INPUT' })
    )
    await replyManagedAiSession({ source: 'codex', sessionId: 'codex-hibernate-1', kind: 'handled' })
    await expect(
      hibernateManagedAiSession({ source: 'codex', sessionId: 'codex-hibernate-1', terminalSessionId: 'terminal-session-1', reason: 'manual-test' })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({
            id: 'codex-hibernate-1',
            hibernated: true,
            hibernationReason: 'manual-test',
            hibernatedTerminalSessionId: 'terminal-session-1',
            panelId: undefined,
            terminalSessionId: undefined
          })
        })
      })
    )
    await expect(listManagedAiSessions()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          sessions: [expect.objectContaining({ id: 'codex-hibernate-1', hibernated: true })]
        })
      })
    )
    await expect(wakeManagedAiSession({ source: 'codex', sessionId: 'codex-hibernate-1', reason: 'resume' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.not.objectContaining({ hibernated: true })
        })
      })
    )
  })

  it('binds a restored managed session to its new live terminal without waiting for an agent hook', async () => {
    const {
      bindManagedAiSessionTerminal,
      configureAiAgentSessionStore,
      configureManagedAiSessionTerminalLiveness,
      findManagedAiSessionRecord,
      listManagedAiSessions,
      publishAiAgentSessionEvent
    } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-restore-binding-'))
    const projectRoot = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-restored-project-'))
    await configureAiAgentSessionStore(userDataPath)
    configureManagedAiSessionTerminalLiveness((terminalSessionId) => terminalSessionId === 'terminal-restored')
    const projectFiles = await loadProjectFilesBackend()
    projectFiles.configureProjectFilesRuntime({
      userDataPath,
      getManagedSession: findManagedAiSessionRecord,
      findProductSession: () => null
    })

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'session_start',
        sessionId: 'codex-restored',
        cwd: projectRoot,
        resumeCommand: `cd '${projectRoot}' && codex resume 'codex-restored'`,
        receivedAt: 500
      },
      null
    )
    await expect(projectFiles.getProjectFileContext({
      source: 'codex',
      sessionId: 'codex-restored'
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'PROJECT_FILE_CONTEXT_UNAVAILABLE'
    }))

    await expect(bindManagedAiSessionTerminal({
      source: 'codex',
      sessionId: 'codex-restored',
      terminalSessionId: 'terminal-missing',
      panelId: 'panel-missing',
      cwd: projectRoot
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'MANAGED_AI_SESSION_TERMINAL_NOT_LIVE'
    }))

    await expect(bindManagedAiSessionTerminal({
      source: 'codex',
      sessionId: 'codex-restored',
      terminalSessionId: 'terminal-restored',
      panelId: 'panel-restored',
      cwd: projectRoot
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        session: expect.objectContaining({
          id: 'codex-restored',
          terminalSessionId: 'terminal-restored',
          panelId: 'panel-restored',
          cwd: projectRoot
        })
      })
    }))
    await expect(listManagedAiSessions()).resolves.toEqual(expect.objectContaining({
      data: expect.objectContaining({
        sessions: [
          expect.objectContaining({
            id: 'codex-restored',
            terminalSessionId: 'terminal-restored',
            panelId: 'panel-restored'
          })
        ]
      })
    }))
    await expect(projectFiles.getProjectFileContext({
      source: 'codex',
      sessionId: 'codex-restored'
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        source: 'codex',
        sessionId: 'codex-restored',
        projectRoot
      })
    }))
    configureManagedAiSessionTerminalLiveness()
  })

  it('does not let late events roll back a newer ended managed AI session', async () => {
    const { __testing, configureAiAgentSessionStore, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-event-order-')))

    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PreToolUse',
        sessionId: 'codex-event-order-1',
        summary: 'Run tests',
        receivedAt: 100
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'SessionEnd',
        sessionId: 'codex-event-order-1',
        summary: 'Terminal closed',
        receivedAt: 200
      },
      null
    )
    const streamSeqAfterEnd = __testing.streamLatestSeq()
    const emit = vi.fn()

    expect(
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'PreToolUse',
          sessionId: 'codex-event-order-1',
          summary: 'Late tool event',
          receivedAt: 150
        },
        emit
      )
    ).toEqual(expect.objectContaining({ ok: true }))

    expect(emit).not.toHaveBeenCalled()
    expect(__testing.streamLatestSeq()).toBe(streamSeqAfterEnd)
    const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, any>> } }
    const session = response.data?.sessions?.find((item) => item.id === 'codex-event-order-1')
    expect(session).toEqual(
      expect.objectContaining({
        state: 'ended',
        lastEvent: 'session_end',
        lastActivityAt: 200,
        summary: 'Terminal closed'
      })
    )
    expect(session?.events.map((event: Record<string, unknown>) => event.event)).toEqual(['pre_tool_use', 'session_end'])
  })

  it('deduplicates deterministic timeline events and repeated synthetic session ends', async () => {
    const { __testing, configureAiAgentSessionStore, listManagedAiSessions, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-event-idempotent-')))
    const workingEvent = {
      source: 'codex',
      event: 'PreToolUse',
      sessionId: 'codex-event-idempotent-1',
      summary: 'Run tests',
      receivedAt: 100
    }
    const endEvent = {
      source: 'codex',
      event: 'SessionEnd',
      sessionId: 'codex-event-idempotent-1',
      summary: 'Terminal closed',
      receivedAt: 200
    }

    publishAiAgentSessionEvent(workingEvent, null)
    const duplicateEmit = vi.fn()
    expect(publishAiAgentSessionEvent(workingEvent, duplicateEmit)).toEqual(expect.objectContaining({ ok: true }))
    expect(duplicateEmit).not.toHaveBeenCalled()
    publishAiAgentSessionEvent(endEvent, null)
    const streamSeqAfterEnd = __testing.streamLatestSeq()
    const repeatedEndEmit = vi.fn()

    expect(publishAiAgentSessionEvent(endEvent, repeatedEndEmit)).toEqual(expect.objectContaining({ ok: true }))
    expect(publishAiAgentSessionEvent({ ...endEvent, receivedAt: 250 }, repeatedEndEmit)).toEqual(expect.objectContaining({ ok: true }))

    expect(repeatedEndEmit).not.toHaveBeenCalled()
    expect(__testing.streamLatestSeq()).toBe(streamSeqAfterEnd)
    const response = (await listManagedAiSessions()) as { data?: { sessions?: Array<Record<string, any>> } }
    const session = response.data?.sessions?.find((item) => item.id === 'codex-event-idempotent-1')
    const events = session?.events || []
    expect(session).toEqual(
      expect.objectContaining({
        state: 'ended',
        lastEvent: 'session_end',
        lastActivityAt: 200
      })
    )
    expect(events.map((event: Record<string, unknown>) => event.event)).toEqual(['pre_tool_use', 'session_end'])
    expect(new Set(events.map((event: Record<string, unknown>) => event.id)).size).toBe(events.length)
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
            state: 'needsInput',
            requestKind: 'notification',
            decisionMode: 'local',
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

  it('auto-names managed AI sessions on stop without overwriting manual titles', async () => {
    const {
      __testing,
      configureAiAgentSessionStore,
      configureManagedAiSessionAutoNamingRuntime,
      listManagedAiSessions,
      publishAiAgentSessionEvent,
      renameManagedAiSession
    } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-auto-name-'))
    await configureAiAgentSessionStore(userDataPath)
    const generateTitle = vi.fn(async ({ prompt }: any) => {
      expect(prompt).toContain('Recent session events:')
      expect(prompt).toContain('修复发布脚本')
      return '"发布脚本修复"'
    })
    configureManagedAiSessionAutoNamingRuntime({
      enabled: true,
      minIntervalMs: 30000,
      minEventGrowth: 1,
      generateTitle
    })
    try {
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'SessionStart',
          sessionId: 'codex-auto-title-1',
          cwd: '/work/release-api',
          receivedAt: 800
        },
        null
      )
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'Stop',
          sessionId: 'codex-auto-title-1',
          summary: '修复发布脚本失败重试',
          receivedAt: 900
        },
        null
      )

      await vi.waitFor(async () => {
        await expect(listManagedAiSessions()).resolves.toEqual(
          expect.objectContaining({
            ok: true,
            data: {
              sessions: [
                expect.objectContaining({
                  id: 'codex-auto-title-1',
                  title: '发布脚本修复',
                  autoTitle: '发布脚本修复',
                  autoTitleEventCount: 2,
                  autoTitleGeneratedAt: expect.any(Number)
                })
              ]
            }
          })
        )
      })

      await renameManagedAiSession({ source: 'codex', sessionId: 'codex-auto-title-1', title: '手动标题' })
      publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'Stop',
          sessionId: 'codex-auto-title-1',
          summary: '实现部署回滚',
          receivedAt: 1000
        },
        null
      )
      await new Promise((resolve) => setTimeout(resolve, 20))

      await expect(listManagedAiSessions()).resolves.toEqual(
        expect.objectContaining({
          data: {
            sessions: [
              expect.objectContaining({
                id: 'codex-auto-title-1',
                title: '手动标题',
                userTitle: '手动标题'
              })
            ]
          }
        })
      )
      expect(generateTitle).toHaveBeenCalledTimes(1)

      await __testing.flushManagedAiSessionWrites()
      const entries = String(await readFile(__testing.auditPathFor(userDataPath), 'utf-8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'session.auto_named',
            source: 'codex',
            sessionId: 'codex-auto-title-1',
            title: '发布脚本修复'
          })
        ])
      )
    } finally {
      configureManagedAiSessionAutoNamingRuntime()
    }
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
        source: 'claude-code',
        event: 'PermissionRequest',
        sessionId: 'claude-notification-1',
        requestId: 'approve-notification-1',
        waitForDecision: true,
        actionable: true,
        title: 'Claude Code · api-service',
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
        source: 'gemini',
        event: 'Stop',
        sessionId: 'gemini-notification-1',
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
          unreadCount: 2,
          notifications: [
            expect.objectContaining({
              id: 'managed-ai:claude-code:claude-notification-1',
              source: 'claude-code',
              sessionId: 'claude-notification-1',
              title: 'Claude Code · api-service',
              summary: 'approve npm test',
              read: false,
              isRead: false,
              needsInput: true,
              panelId: 'panel-notification',
              terminalSessionId: 'terminal-notification'
            }),
            expect.objectContaining({
              id: 'managed-ai:gemini:gemini-notification-1',
              read: false,
              needsInput: true,
              requestKind: 'notification',
              decisionMode: 'local'
            })
          ]
        })
      })
    )
    await expect(listManagedAiNotifications({ unread: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 2,
          notifications: [
            expect.objectContaining({ id: 'managed-ai:claude-code:claude-notification-1' }),
            expect.objectContaining({ id: 'managed-ai:gemini:gemini-notification-1' })
          ]
        })
      })
    )

    await expect(openManagedAiNotification({ id: 'managed-ai:claude-code:claude-notification-1' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          focusRequest: {
            source: 'claude-code',
            sessionId: 'claude-notification-1',
            panelId: 'panel-notification',
            terminalSessionId: 'terminal-notification'
          },
          notification: expect.objectContaining({ read: false })
        })
      })
    )

    await expect(dismissManagedAiNotification({ id: 'managed-ai:claude-code:claude-notification-1' })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'MANAGED_AI_NOTIFICATION_UNREAD'
      })
    )
    await expect(jumpToUnreadManagedAiNotification()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          focusRequest: expect.objectContaining({ sessionId: 'claude-notification-1' })
        })
      })
    )
    await expect(markManagedAiNotificationRead({ id: 'managed-ai:claude-code:claude-notification-1' })).resolves.toEqual(
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
          changed: 1,
          notifications: [expect.objectContaining({ id: 'managed-ai:gemini:gemini-notification-1', read: false })],
          snapshot: { sessions: [expect.objectContaining({ id: 'gemini-notification-1', state: 'needsInput' })] }
        })
      })
    )
  })

  it('clears all managed AI notifications without requiring read state', async () => {
    const { clearManagedAiNotifications, configureAiAgentSessionStore, listManagedAiNotifications, publishAiAgentSessionEvent } = await loadBackend()
    await configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-agent-notification-clear-')))

    publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'PermissionRequest',
        sessionId: 'claude-notification-clear-1',
        waitForDecision: true,
        actionable: true,
        summary: 'approve deploy',
        receivedAt: 710
      },
      null
    )
    publishAiAgentSessionEvent(
      {
        source: 'gemini',
        event: 'Stop',
        sessionId: 'gemini-notification-clear-1',
        summary: 'turn complete',
        receivedAt: 705
      },
      null
    )

    await expect(listManagedAiNotifications()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ total: 2, unreadCount: 2 })
      })
    )
    await expect(clearManagedAiNotifications()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: {
          changed: 2,
          notifications: [],
          snapshot: { sessions: [] }
        }
      })
    )
    await expect(listManagedAiNotifications()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ total: 0, unreadCount: 0, notifications: [] })
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
        source: 'claude-code',
        event: 'PermissionRequest',
        sessionId: 'claude-audit-1',
        requestId: 'request-1',
        waitForDecision: true,
        actionable: true,
        cwd: '/work/project',
        summary: 'approve shell command',
        receivedAt: 500
      },
      null
    )
    await replyManagedAiSession({ source: 'claude-code', sessionId: 'claude-audit-1', kind: 'handled' })
    await renameManagedAiSession({ source: 'claude-code', sessionId: 'claude-audit-1', title: 'Audit Session' })
    await bulkManagedAiSessions({ operation: 'mark-handled' })
    await clearManagedAiSession({ source: 'claude-code', sessionId: 'claude-audit-1' })
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
          source: 'claude-code',
          sessionId: 'claude-audit-1',
          event: 'permission_request',
          state: 'needsInput',
          requestId: 'request-1',
          actionable: true,
          summary: 'approve shell command'
        }),
        expect.objectContaining({
          kind: 'decision.created',
          source: 'claude-code',
          sessionId: 'claude-audit-1',
          decisionKind: 'handled'
        }),
        expect.objectContaining({
          kind: 'session.renamed',
          source: 'claude-code',
          sessionId: 'claude-audit-1',
          title: 'Audit Session'
        }),
        expect.objectContaining({
          kind: 'sessions.bulk',
          operation: 'mark-handled',
          changed: 0
        }),
        expect.objectContaining({
          kind: 'session.cleared',
          source: 'claude-code',
          sessionId: 'claude-audit-1',
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
          source: 'claude-code',
          event: 'PermissionRequest',
          sessionId: 'claude-stream-1',
          requestId: 'request-stream-1',
          waitForDecision: true,
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
          source: 'claude-code',
          payload: expect.objectContaining({
            source: 'claude-code',
            sessionId: 'claude-stream-1',
            state: 'needsInput',
            requestId: 'request-stream-1',
            summary: 'approve stream command'
          })
        })
      ])

      await replyManagedAiSession({ source: 'claude-code', sessionId: 'claude-stream-1', kind: 'handled' })
      const liveFrames = await stream.waitForFrames(3)
      expect(liveFrames[2]).toEqual(
        expect.objectContaining({
          type: 'event',
          name: 'managed_ai.decision.created',
          category: 'managed-ai',
          payload: expect.objectContaining({
            sessionId: 'claude-stream-1',
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
          requestKind: 'question',
          decisionMode: 'blocking',
          waitTimeoutMs: 5000,
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
            requestKind: 'question',
            decisionMode: 'blocking',
            decisionKind: 'reply'
          }),
          expect.objectContaining({
            kind: 'event.socket.completed',
            source: 'claude-code',
            sessionId: 'claude-blocking-1',
            requestId: 'request-1',
            requestKind: 'question',
            decisionMode: 'blocking',
            status: 'resolved'
          })
        ])
      )
    } finally {
      closeAiAgentSessionServer()
    }
  })

  it('waits for actionable Claude decisions when the hook payload has no request id', async () => {
    const { ensureAiAgentSessionServer, closeAiAgentSessionServer, listManagedAiSessions, replyManagedAiSession } = await loadBackend()
    const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-socket-generated-request-'))
    const socketPath = await ensureAiAgentSessionServer({ userDataPath, emit: vi.fn() })
    try {
      const responsePromise = socketRequest(socketPath, {
        source: 'claude-code',
        event: 'PermissionRequest',
        session_id: 'claude-blocking-generated-1',
        waitForDecision: true,
        waitTimeoutMs: 5000,
        actionable: true,
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      })

      await vi.waitFor(async () => {
        const snapshot = (await listManagedAiSessions()) as any
        expect(snapshot.data.sessions[0]).toMatchObject({
          id: 'claude-blocking-generated-1',
          state: 'needsInput',
          decisionMode: 'blocking'
        })
        expect(snapshot.data.sessions[0].pendingRequestId).toEqual(expect.any(String))
      })
      await replyManagedAiSession({ source: 'claude-code', sessionId: 'claude-blocking-generated-1', kind: 'allow' })
      await expect(responsePromise).resolves.toMatchObject({ status: 'resolved' })
    } finally {
      closeAiAgentSessionServer()
    }
  })
})
