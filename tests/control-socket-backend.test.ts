import { createConnection } from 'net'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ControlRequest, ControlResponse } from '@shared/preload'

type ControlSocketBackend = {
  configureControlSocketRuntime: (config?: {
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
