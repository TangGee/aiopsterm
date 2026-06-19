import { createConnection } from 'net'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ControlRequest, ControlResponse } from '@shared/preload'

type ControlSocketBackend = {
  configureControlSocketRuntime: (config?: {
    userDataPath?: string
    getWindows?: () => Array<Record<string, unknown>>
    focusWindow?: (window?: Record<string, unknown> | null) => Record<string, unknown> | null
    writeTerminal?: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
    showNotification?: (notification: Record<string, unknown>) => void
  }) => void
  ensureControlSocketServer: (userDataPath: string) => Promise<string>
  closeControlSocketServer: () => void
  registerControlSocketIpc: (ipcMain: { handle: (channel: string, handler: (event: unknown, id: string, response: ControlResponse) => unknown) => void }) => void
  __testing: {
    handleControlRequest: (request: { method?: string; params?: Record<string, unknown> }) => Promise<ControlResponse>
    pendingRendererRequestCount: () => number
    listNotifications: () => Array<Record<string, unknown>>
    listEvents: () => Array<Record<string, unknown>>
    eventLogPathFor: (userDataPath: string) => string
    listSessionSnapshots: () => Array<Record<string, unknown>>
    sessionSnapshotPathFor: (userDataPath: string) => string
    listAgentVaultEntries: () => Array<Record<string, unknown>>
    agentVaultPathFor: (userDataPath: string) => string
    eventSubscriptionCount: () => number
  }
}

type MockWindow = {
  focused?: boolean
  requests: ControlRequest[]
  isDestroyed: () => boolean
  isFocused: () => boolean
  webContents: {
    isDestroyed: () => boolean
    send: (channel: string, request: ControlRequest) => void
  }
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/controlSocket'
  return (await import(modulePath)) as unknown as ControlSocketBackend
}

const createMockWindow = (handler: (request: ControlRequest) => ControlResponse | Promise<ControlResponse>): MockWindow => ({
  focused: true,
  requests: [],
  isDestroyed: () => false,
  isFocused() {
    return this.focused === true
  },
  webContents: {
    isDestroyed: () => false,
    send(channel, request) {
      if (channel !== 'control:request') return
      mockWindow.requests.push(request)
      void Promise.resolve(handler(request)).then((response) => mockIpcHandler?.(null, request.id, response))
    }
  }
})

let mockIpcHandler: ((event: unknown, id: string, response: ControlResponse) => unknown) | null = null
let mockWindow: MockWindow

const socketRequest = (socketPath: string, request: Record<string, unknown>) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000)
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      socket.end()
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('control socket test timed out'))
    })
    socket.on('error', reject)
  })

const socketStreamFrames = (socketPath: string, request: Record<string, unknown>, count: number, trigger?: () => void | Promise<void>) =>
  new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const socket = createConnection(socketPath)
    const frames: Record<string, unknown>[] = []
    let buffer = ''
    let triggered = false
    socket.setEncoding('utf8')
    socket.setTimeout(5000)
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const frame = JSON.parse(line) as Record<string, unknown>
          frames.push(frame)
          if (!triggered && frame.type === 'ack' && trigger) {
            triggered = true
            void Promise.resolve(trigger()).catch(reject)
          }
          if (frames.length >= count) {
            socket.end()
            resolve(frames)
            return
          }
        } catch (error) {
          socket.destroy()
          reject(error)
          return
        }
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('control socket stream test timed out'))
    })
    socket.on('error', reject)
  })

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('control socket backend', () => {
  afterEach(async () => {
    const backend = await loadBackend()
    backend.closeControlSocketServer()
    backend.configureControlSocketRuntime()
    mockIpcHandler = null
  })

  it('routes terminal list requests to the renderer window and returns the renderer response', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow(() => ({
      ok: true,
      data: {
        terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true }],
        count: 1,
        activePanelId: 'panel-1'
      }
    }))
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'terminal.list' })).resolves.toEqual({
      ok: true,
      data: {
        terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true }],
        count: 1,
        activePanelId: 'panel-1'
      }
    })
    expect(mockWindow.requests).toEqual([expect.objectContaining({ method: 'terminal.list' })])
    expect(backend.__testing.pendingRendererRequestCount()).toBe(0)
  })

  it('routes workspace snapshot requests to the renderer window', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => ({
      ok: true,
      data: {
        snapshot: {
          generatedAt: 1000,
          mode: 'terminal',
          activeModule: 'workspace',
          activePanelId: 'panel-1',
          workspaces: [{ id: 'main', title: 'Main Workspace', active: true, mode: 'terminal', activeModule: 'workspace', activePanelId: 'panel-1' }],
          terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true }],
          surfaces: [{ panelId: 'panel-1', title: 'Local', surfaceKind: 'terminal', active: true, sessionId: 'terminal-1', terminalKind: 'local', connected: true }],
          splitGroups: [],
          notifications: [],
          managedAiSessions: [],
          attention: { unreadCount: 0, items: [] },
          counts: {
            terminals: 1,
            connectedTerminals: 1,
            surfaces: 1,
            splitGroups: 0,
            notifications: 0,
            unreadNotifications: 0,
            managedAiSessions: 0,
            managedAiNeedsInput: 0,
            attentionItems: 0
          }
        }
      }
    }))
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'workspace.snapshot' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          snapshot: expect.objectContaining({
            activePanelId: 'panel-1',
            counts: expect.objectContaining({ terminals: 1 })
          })
        })
      })
    )
    expect(mockWindow.requests).toEqual([expect.objectContaining({ method: 'workspace.snapshot' })])
  })

  it('routes workspace group requests to the renderer window', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => ({
      ok: true,
      data: {
        groups: [{ id: 'group-1', ref: 'workspace_group:1', name: 'Ops', memberCount: 2, collapsed: false, pinned: true }],
        count: 1
      }
    }))
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'workspace.group.list' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          groups: [expect.objectContaining({ ref: 'workspace_group:1', name: 'Ops' })]
        })
      })
    )
    expect(mockWindow.requests).toEqual([expect.objectContaining({ method: 'workspace.group.list' })])
  })

  it('routes surface resume requests to the renderer window', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow(() => ({
      ok: true,
      data: {
        surfaceId: 'panel-1',
        surface_id: 'panel-1',
        resumeBinding: { command: 'tmux attach -t work', kind: 'tmux', autoResume: false, updatedAt: 1717200000000 },
        resume_binding: { command: 'tmux attach -t work', kind: 'tmux', auto_resume: false, updated_at: 1717200000000 }
      }
    }))
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'surface.resume.set',
        params: { surfaceId: 'panel-1', command: 'tmux attach -t work', kind: 'tmux' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          surfaceId: 'panel-1',
          resumeBinding: expect.objectContaining({ command: 'tmux attach -t work', kind: 'tmux' })
        })
      })
    )
    expect(mockWindow.requests).toEqual([
      expect.objectContaining({
        method: 'surface.resume.set',
        params: expect.objectContaining({ surfaceId: 'panel-1', command: 'tmux attach -t work' })
      })
    ])
  })

  it('writes terminal text through the runtime without requiring renderer focus', async () => {
    const backend = await loadBackend()
    const writes: Array<{ sessionId: string; data: string }> = []
    backend.configureControlSocketRuntime({
      writeTerminal: (sessionId, data) => {
        writes.push({ sessionId, data })
        return { ok: true, data: { id: sessionId, bytes: Buffer.byteLength(data, 'utf8') } }
      }
    })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'terminal.send_text',
        params: { sessionId: 'terminal-1', text: 'pwd\n' }
      })
    ).resolves.toEqual({ ok: true, data: { id: 'terminal-1', bytes: 4 } })
    expect(writes).toEqual([{ sessionId: 'terminal-1', data: 'pwd\n' }])
  })

  it('creates, lists, opens, marks, dismisses, and clears generic notifications', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'notification.open') return { ok: true, data: { focused: true } }
      if (request.method === 'notification.sync') return { ok: true, data: { synced: true } }
      return { ok: true, data: {} }
    })
    const shown: Record<string, unknown>[] = []
    backend.configureControlSocketRuntime({
      getWindows: () => [mockWindow],
      showNotification: (notification) => shown.push(notification)
    })

    const created = await backend.__testing.handleControlRequest({
      method: 'notification.create',
      params: { title: 'Build done', subtitle: 'tests', body: 'All green', panelId: 'panel-1', sessionId: 'terminal-1' }
    })
    const notification = created.data?.notification as Record<string, unknown>
    expect(created).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unreadCount: 1 }) }))
    expect(notification).toEqual(expect.objectContaining({ title: 'Build done', panelId: 'panel-1', sessionId: 'terminal-1', read: false }))
    expect(shown).toEqual([expect.objectContaining({ title: 'Build done' })])

    await expect(backend.__testing.handleControlRequest({ method: 'notification.list', params: { unread: true } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1, unreadCount: 1 }) })
    )

    await expect(backend.__testing.handleControlRequest({ method: 'notification.open', params: { id: String(notification.id) } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ unreadCount: 0, focusRequest: expect.objectContaining({ panelId: 'panel-1' }) }) })
    )
    expect(mockWindow.requests.some((request) => request.method === 'notification.open')).toBe(true)

    await expect(backend.__testing.handleControlRequest({ method: 'notification.dismiss', params: { id: String(notification.id) } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 1, total: 0 }) })
    )

    await backend.__testing.handleControlRequest({ method: 'notification.create', params: { title: 'One' } })
    await backend.__testing.handleControlRequest({ method: 'notification.create', params: { title: 'Two' } })
    await expect(backend.__testing.handleControlRequest({ method: 'notification.mark_read', params: { all: true } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 2, unreadCount: 0 }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'notification.clear' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 2, total: 0 }) })
    )
  })

  it('records bounded control events and lists them with filters', async () => {
    const backend = await loadBackend()
    backend.configureControlSocketRuntime({
      writeTerminal: (sessionId, data) => ({ ok: true, data: { id: sessionId, bytes: Buffer.byteLength(data, 'utf8') } })
    })

    await backend.__testing.handleControlRequest({
      method: 'terminal.send_text',
      params: { sessionId: 'terminal-1', text: 'secret terminal text\n' }
    })
    await backend.__testing.handleControlRequest({
      method: 'notification.create',
      params: { title: 'Build done', body: 'full notification body should not be copied into event payload' }
    })

    const eventsResponse = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'notification' } })
    expect(eventsResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          protocol: 'aiopsterm-events',
          count: 1,
          events: [expect.objectContaining({ name: 'notification.created', category: 'notification' })]
        })
      })
    )
    const event = (eventsResponse.data?.events as Record<string, unknown>[])[0]
    expect(event.payload).toEqual(
      expect.objectContaining({
        title_preview: 'Build done',
        body_length: 'full notification body should not be copied into event payload'.length
      })
    )
    expect(JSON.stringify(event)).not.toContain('full notification body should not be copied')

    const terminalEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'terminal' } })
    expect(JSON.stringify(terminalEvents.data?.events)).not.toContain('secret terminal text')
  })

  it('streams replayed and live control events over the local socket', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-events-'))
    try {
      const socketPath = await backend.ensureControlSocketServer(root)
      await backend.__testing.handleControlRequest({ method: 'notification.create', params: { title: 'Replay me' } })
      const initialEvents = backend.__testing.listEvents()
      const replaySeq = Number(initialEvents[0].seq) - 1

      const replayFrames = await socketStreamFrames(socketPath, {
        id: 'events-replay',
        method: 'events.stream',
        params: { after_seq: replaySeq, categories: ['notification'], include_heartbeats: false }
      }, 2)
      expect(replayFrames[0]).toEqual(
        expect.objectContaining({
          type: 'ack',
          protocol: 'aiopsterm-events',
          replay_count: 1,
          filters: expect.objectContaining({ categories: ['notification'] })
        })
      )
      expect(replayFrames[1]).toEqual(expect.objectContaining({ type: 'event', name: 'notification.created', category: 'notification' }))

      const liveFrames = await socketStreamFrames(
        socketPath,
        {
          id: 'events-live',
          method: 'events.stream',
          params: { after_seq: Number(backend.__testing.listEvents().at(-1)?.seq || 0), categories: ['notification'], include_heartbeats: false }
        },
        2,
        async () => {
          await backend.__testing.handleControlRequest({ method: 'notification.create', params: { title: 'Live me' } })
        }
      )
      expect(liveFrames[0]).toEqual(expect.objectContaining({ type: 'ack', replay_count: 0 }))
      expect(liveFrames[1]).toEqual(expect.objectContaining({ type: 'event', name: 'notification.created', category: 'notification' }))
      await nextTick()
      expect(backend.__testing.eventSubscriptionCount()).toBe(0)
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists control events to JSONL and replays them after socket restart', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-events-jsonl-'))
    try {
      const firstSocketPath = await backend.ensureControlSocketServer(root)
      backend.configureControlSocketRuntime({
        writeTerminal: (sessionId, data) => ({ ok: true, data: { id: sessionId, bytes: Buffer.byteLength(data, 'utf8') } })
      })
      await backend.__testing.handleControlRequest({
        method: 'terminal.send_text',
        params: { sessionId: 'terminal-jsonl', text: 'secret durable terminal text\n' }
      })
      await backend.__testing.handleControlRequest({
        method: 'notification.create',
        params: { title: 'Durable event', body: 'durable body should not be copied into jsonl' }
      })

      const eventFile = await readFile(backend.__testing.eventLogPathFor(root), 'utf-8')
      expect(eventFile).toContain('"name":"terminal.text_sent"')
      expect(eventFile).toContain('"name":"notification.created"')
      expect(eventFile).not.toContain('secret durable terminal text')
      expect(eventFile).not.toContain('durable body should not be copied')
      const previousLatestSeq = Number(backend.__testing.listEvents().at(-1)?.seq)
      expect(Number.isFinite(previousLatestSeq)).toBe(true)

      backend.closeControlSocketServer()
      const secondSocketPath = await backend.ensureControlSocketServer(root)
      expect(secondSocketPath).toBe(firstSocketPath)
      expect(backend.__testing.listEvents().map((event) => event.name)).toEqual(['terminal.text_sent', 'notification.created'])

      const replayFrames = await socketStreamFrames(secondSocketPath, {
        id: 'events-durable-replay',
        method: 'events.stream',
        params: { after_seq: 0, include_heartbeats: false }
      }, 3)
      expect(replayFrames[0]).toEqual(expect.objectContaining({ type: 'ack', replay_count: 2 }))
      expect(replayFrames[1]).toEqual(expect.objectContaining({ type: 'event', name: 'terminal.text_sent' }))
      expect(replayFrames[2]).toEqual(expect.objectContaining({ type: 'event', name: 'notification.created' }))

      await backend.__testing.handleControlRequest({
        method: 'notification.create',
        params: { title: 'After restart' }
      })
      expect(Number(backend.__testing.listEvents().at(-1)?.seq)).toBe(previousLatestSeq + 1)
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('registers, persists, renders, and routes agent vault entries for visible team launch', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-vault-'))
    try {
      await backend.ensureControlSocketServer(root)
      const registered = await backend.__testing.handleControlRequest({
        method: 'agent.vault.register',
        params: {
          id: 'my-agent',
          name: 'My Agent',
          executable: 'my-agent',
          launchCommand: 'my-agent --cwd {{cwd}} --role {{role}} --index {{index}} {{prompt}}',
          resumeCommand: 'my-agent --session {{sessionId}}',
          forkCommand: 'my-agent --session {{sessionId}} --fork'
        }
      })
      expect(registered).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            agent: expect.objectContaining({ id: 'my-agent', name: 'My Agent', launchCommand: expect.stringContaining('{{index}}') })
          })
        })
      )
      expect(backend.__testing.listAgentVaultEntries()).toEqual([expect.objectContaining({ id: 'my-agent' })])

      await expect(
        backend.__testing.handleControlRequest({
          method: 'agent.vault.render',
          params: { id: 'my-agent', kind: 'resume', sessionId: 'session-1' }
        })
      ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ command: 'my-agent --session session-1' }) }))

      backend.registerControlSocketIpc({
        handle: (_channel, handler) => {
          mockIpcHandler = handler
        }
      })
      mockWindow = createMockWindow((request) => ({
        ok: true,
        data: {
          team: {
            source: 'custom',
            requestedCount: 2,
            launchedCount: 2,
            approvalCount: 0,
            failedCount: 0,
            members: [],
            group: { ref: 'workspace_group:1', name: 'My Agent Team', memberCount: 2 }
          }
        }
      }))
      backend.configureControlSocketRuntime({ userDataPath: root, getWindows: () => [mockWindow] })
      await expect(
        backend.__testing.handleControlRequest({
          method: 'agent.team.launch',
          params: { source: 'my-agent', count: 2, cwd: '/work/project', prompt: 'review', role: 'reviewer' }
        })
      ).resolves.toEqual(expect.objectContaining({ ok: true }))
      expect(mockWindow.requests).toEqual([
        expect.objectContaining({
          method: 'agent.team.launch',
          params: expect.objectContaining({
            source: 'custom',
            agentVaultId: 'my-agent',
            agentVaultName: 'My Agent',
            command: 'my-agent --cwd {{cwd}} --role {{role}} --index {{index}} {{prompt}}',
            cwd: '/work/project',
            prompt: 'review',
            role: 'reviewer',
            name: 'My Agent Team'
          })
        })
      ])

      const storeFile = await readFile(backend.__testing.agentVaultPathFor(root), 'utf-8')
      expect(storeFile).toContain('"id": "my-agent"')
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('saves, persists, restores, and clears control session snapshots', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-session-'))
    try {
      await backend.ensureControlSocketServer(root)
      backend.registerControlSocketIpc({
        handle: (_channel, handler) => {
          mockIpcHandler = handler
        }
      })
      mockWindow = createMockWindow((request) => {
        if (request.method === 'session.export') {
          return {
            ok: true,
            data: {
              snapshot: {
                id: request.params?.id || 'latest',
                name: request.params?.name || 'Latest Session',
                version: 1,
                createdAt: 1717200000000,
                updatedAt: 1717200000000,
                activePanelId: 'panel-local',
                mode: 'terminal',
                activeModule: 'workspace',
                panels: [
                  { id: 'panel-local', title: 'Local', cwd: '/work/project', kind: 'terminal', status: 'running', terminalKind: 'local' },
                  {
                    id: 'panel-ssh',
                    title: 'Prod',
                    cwd: '/home/ops',
                    kind: 'terminal',
                    status: 'closed',
                    terminalKind: 'ssh',
                    split: 'right',
                    splitSourceId: 'panel-local',
                    splitGroupId: 'panel-local',
                    sshSession: { host: '10.0.0.5', port: 22, username: 'ops', assetId: 'asset-prod', assetName: 'Prod' },
                    resumeBinding: { command: 'tmux attach -t prod', autoResume: false, updatedAt: 1717200000001 }
                  }
                ],
                workspaceGroups: [
                  {
                    id: 'group-1',
                    name: 'Ops',
                    anchorPanelId: 'panel-local',
                    memberPanelIds: ['panel-local', 'panel-ssh'],
                    collapsed: false,
                    pinned: true,
                    index: 0,
                    createdAt: 1717200000000,
                    updatedAt: 1717200000000
                  }
                ]
              }
            }
          }
        }
        if (request.method === 'session.restore') {
          return {
            ok: true,
            data: {
              restoredSnapshot: request.params?.snapshot,
              restoredPanels: (request.params?.snapshot as any)?.panels?.length || 0,
              launchedLocalTerminals: 1,
              skippedRemoteTerminals: 1
            }
          }
        }
        return { ok: true, data: {} }
      })
      backend.configureControlSocketRuntime({ userDataPath: root, getWindows: () => [mockWindow] })

      const saved = await backend.__testing.handleControlRequest({ method: 'session.save', params: { id: 'latest', name: 'Work Layout' } })
      expect(saved).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ snapshot: expect.objectContaining({ id: 'latest', name: 'Work Layout' }) }) }))
      expect(backend.__testing.listSessionSnapshots()).toEqual([expect.objectContaining({ id: 'latest', panels: expect.arrayContaining([expect.objectContaining({ id: 'panel-local' })]) })])
      const storeFile = await readFile(backend.__testing.sessionSnapshotPathFor(root), 'utf-8')
      expect(storeFile).toContain('"id": "latest"')
      expect(storeFile).not.toContain('secret')

      backend.closeControlSocketServer()
      await backend.ensureControlSocketServer(root)
      backend.configureControlSocketRuntime({ userDataPath: root, getWindows: () => [mockWindow] })
      await expect(backend.__testing.handleControlRequest({ method: 'session.list' })).resolves.toEqual(
        expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1, snapshots: [expect.objectContaining({ id: 'latest' })] }) })
      )
      await expect(backend.__testing.handleControlRequest({ method: 'session.restore', params: { id: 'latest' } })).resolves.toEqual(
        expect.objectContaining({ ok: true, data: expect.objectContaining({ restoredPanels: 2, launchedLocalTerminals: 1, skippedRemoteTerminals: 1 }) })
      )
      expect(mockWindow.requests.some((request) => request.method === 'session.restore' && (request.params?.snapshot as any)?.id === 'latest')).toBe(true)

      await expect(backend.__testing.handleControlRequest({ method: 'session.clear', params: { id: 'latest' } })).resolves.toEqual(
        expect.objectContaining({ ok: true, data: expect.objectContaining({ removed: true, count: 0 }) })
      )
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serves newline-delimited JSON requests over the local socket', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-socket-'))
    try {
      const socketPath = await backend.ensureControlSocketServer(root)
      await expect(socketRequest(socketPath, { id: 'ping-1', method: 'ping' })).resolves.toEqual(
        expect.objectContaining({
          id: 'ping-1',
          ok: true,
          data: expect.objectContaining({ pong: true, socketPath })
        })
      )
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })
})
