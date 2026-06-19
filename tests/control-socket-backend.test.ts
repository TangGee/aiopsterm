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
  }) => void
  ensureControlSocketServer: (userDataPath: string) => Promise<string>
  closeControlSocketServer: () => void
  registerControlSocketIpc: (ipcMain: { handle: (channel: string, handler: (event: unknown, id: string, response: ControlResponse) => unknown) => void }) => void
  __testing: {
    handleControlRequest: (request: { method?: string; params?: Record<string, unknown> }) => Promise<ControlResponse>
    pendingRendererRequestCount: () => number
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
