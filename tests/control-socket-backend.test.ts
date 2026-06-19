import { createConnection } from 'net'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
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
    listTerminalBuffers: () => Array<Record<string, unknown>>
    eventSubscriptionCount: () => number
  }
}

type AgentSessionsBackend = {
  configureAiAgentSessionStore: (userDataPath: string) => Promise<void>
  publishAiAgentSessionEvent: (input: Record<string, unknown>, emit?: ((event: unknown) => void) | null) => unknown
  listManagedAiSessions: () => Promise<unknown>
  __testing: {
    flushManagedAiSessionWrites: () => Promise<void>
  }
}

type AgentHookInstallerBackend = {
  configureAgentHookInstallerRuntime: (config?: {
    getEnv?: () => NodeJS.ProcessEnv
    getHomeDir?: () => string
    getAgentHookScriptPath?: () => string
  }) => void
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

const loadAgentSessionsBackend = async () => {
  const modulePath = '../src/main/backend/agentSessions'
  return (await import(modulePath)) as AgentSessionsBackend
}

const loadAgentHookInstallerBackend = async () => {
  const modulePath = '../src/main/backend/agentHookInstaller'
  return (await import(modulePath)) as AgentHookInstallerBackend
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

const waitForAgentVaultScanMatch = async (backend: ControlSocketBackend, sessionId: string, attempts = 20) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await backend.__testing.handleControlRequest({ method: 'agent.vault.scan', params: { id: 'scan-agent' } })
    const matches = response.data?.matches
    if (response.ok && Array.isArray(matches) && matches.some((match) => (match as Record<string, unknown>).sessionId === sessionId)) return response
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  return backend.__testing.handleControlRequest({ method: 'agent.vault.scan', params: { id: 'scan-agent' } })
}

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

  it('returns system capabilities and identity for automation probes', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-system-'))
    try {
      await backend.ensureControlSocketServer(root)
      backend.configureControlSocketRuntime({ userDataPath: root, getWindows: () => [] })

      await expect(backend.__testing.handleControlRequest({ method: 'system.capabilities' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            protocol: 'aiopsterm-control',
            version: 1,
            app: expect.objectContaining({ name: 'aiopsterm' }),
            process: expect.objectContaining({ pid: process.pid, platform: process.platform, arch: process.arch }),
            socketPath: expect.any(String),
            capabilities: expect.arrayContaining(['system.capabilities', 'system.identify', 'agent.session', 'events.stream'])
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'identify', params: { caller: { panelId: 'panel-1' } } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            caller: { panelId: 'panel-1' },
            runtime: expect.objectContaining({ userDataPath: root, windowCount: 0 }),
            capabilities: expect.arrayContaining(['terminal.list'])
          })
        })
      )
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('routes control_compat-style agent hook installer controls through the control socket', async () => {
    const backend = await loadBackend()
    const installer = await loadAgentHookInstallerBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-hooks-'))
    const binDir = join(root, 'bin')
    const hookScript = join(root, 'aiopsterm-agent-hook.js')
    try {
      await writeFile(hookScript, '#!/usr/bin/env node\n', 'utf-8')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'codex'), '#!/bin/sh\nexit 0\n', 'utf-8')
      await chmod(join(binDir, 'codex'), 0o755)
      installer.configureAgentHookInstallerRuntime({
        getHomeDir: () => root,
        getEnv: () => ({ HOME: root, PATH: binDir }),
        getAgentHookScriptPath: () => hookScript
      })

      await backend.ensureControlSocketServer(root)
      await expect(backend.__testing.handleControlRequest({ method: 'agent.hooks.list' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            count: expect.any(Number),
            readyCount: 1,
            installers: expect.arrayContaining([expect.objectContaining({ source: 'codex', binaryPath: join(binDir, 'codex'), installed: false })])
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'hooks.setup' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            operation: 'setup',
            installed: 1,
            failed: 0,
            skipped: expect.arrayContaining([expect.objectContaining({ source: 'claude-code' })]),
            installers: expect.arrayContaining([expect.objectContaining({ source: 'codex', installed: true })])
          })
        })
      )
      expect(await readFile(join(root, '.codex/hooks.json'), 'utf-8')).toContain('aiopsterm-agent-hook-v1')

      await expect(backend.__testing.handleControlRequest({ method: 'agent.hooks.uninstall', params: { source: 'codex' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            operation: 'uninstall',
            uninstalled: 1,
            failed: 0,
            installers: expect.arrayContaining([expect.objectContaining({ source: 'codex', installed: false })])
          })
        })
      )
    } finally {
      installer.configureAgentHookInstallerRuntime()
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
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

  it('routes control_compat-style screen capture aliases to terminal read-screen', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'terminal.read_screen') {
        return { ok: true, data: { text: 'alpha\nbeta\n', tailLines: 2 } }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'surface.read_text',
        params: { surfaceId: 'panel-1', lines: 2 }
      })
    ).resolves.toEqual({ ok: true, data: { text: 'alpha\nbeta\n', tailLines: 2 } })
    await expect(
      backend.__testing.handleControlRequest({
        method: 'capture-pane',
        params: { panelId: 'panel-1', lines: 2 }
      })
    ).resolves.toEqual({ ok: true, data: { text: 'alpha\nbeta\n', tailLines: 2 } })
    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'terminal.read_screen', params: expect.objectContaining({ surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'terminal.read_screen', params: expect.objectContaining({ panelId: 'panel-1' }) })
    ])
  })

  it('routes control_compat-style clear-history aliases to the renderer and records a terminal event', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'terminal.clear_history') {
        return {
          ok: true,
          data: {
            terminal: { panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true },
            cleared: true
          }
        }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'surface.clear_history',
        params: { surfaceId: 'panel-1' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ cleared: true }) }))
    await expect(
      backend.__testing.handleControlRequest({
        method: 'clear-history',
        params: { panelId: 'panel-1' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ cleared: true }) }))

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'terminal.clear_history', params: expect.objectContaining({ surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'terminal.clear_history', params: expect.objectContaining({ panelId: 'panel-1' }) })
    ])
    const terminalEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'terminal' } })
    expect(terminalEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'terminal.history_cleared' })]))
  })

  it('routes control_compat-style respawn aliases to the renderer and records a terminal event', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'surface.respawn') {
        return {
          ok: true,
          data: {
            surface: { panelId: 'panel-1', surfaceKind: 'terminal', active: true, title: 'Local' },
            terminal: { panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true },
            command: (request.params as Record<string, unknown>).command || 'exec ${SHELL:-/bin/bash} -l',
            decision: { status: 'allow' }
          }
        }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'respawn-pane',
        params: { panelId: 'panel-1', command: 'exec bash -l' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ command: 'exec bash -l', decision: expect.objectContaining({ status: 'allow' }) }) }))

    expect(mockWindow.requests).toEqual([expect.objectContaining({ method: 'surface.respawn', params: expect.objectContaining({ panelId: 'panel-1', command: 'exec bash -l' }) })])
    const terminalEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'terminal' } })
    expect(terminalEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'terminal.respawn_requested', payload: expect.objectContaining({ decision_status: 'allow' }) })]))
  })

  it('routes control_compat-style pane layout aliases to the renderer and records pane events', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'pane.resize') {
        return {
          ok: true,
          data: {
            pane: { panelId: (request.params as any)?.paneId || 'panel-1', surfaceKind: 'terminal', title: 'Pane' },
            resized: false,
            unsupported: true,
            unsupportedReason: 'equal-size layout'
          }
        }
      }
      return {
        ok: true,
        data: {
          pane: { panelId: (request.params as any)?.paneId || 'panel-2', surfaceKind: 'terminal', title: 'Pane 2', splitGroupId: 'panel-1' },
          targetPane: (request.params as any)?.targetPaneId
            ? { panelId: (request.params as any)?.targetPaneId, surfaceKind: 'terminal', title: 'Main', splitGroupId: 'panel-1' }
            : undefined,
          changed: true
        }
      }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'join-pane',
        params: { paneId: 'panel-2', targetPaneId: 'panel-1', direction: 'below', focus: true }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: true }) }))
    await expect(
      backend.__testing.handleControlRequest({
        method: 'break-pane',
        params: { paneId: 'panel-2' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: true }) }))
    await expect(
      backend.__testing.handleControlRequest({
        method: 'swap-pane',
        params: { paneId: 'panel-2', targetPaneId: 'panel-1' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: true }) }))
    await expect(
      backend.__testing.handleControlRequest({
        method: 'resize-pane',
        params: { paneId: 'panel-1', direction: 'right', amount: 5 }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true }) }))

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'pane.join', params: expect.objectContaining({ paneId: 'panel-2', targetPaneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'pane.break', params: expect.objectContaining({ paneId: 'panel-2' }) }),
      expect.objectContaining({ method: 'pane.swap', params: expect.objectContaining({ paneId: 'panel-2', targetPaneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'pane.resize', params: expect.objectContaining({ paneId: 'panel-1' }) })
    ])
    const paneEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'pane' } })
    expect(paneEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pane.joined' }),
        expect.objectContaining({ name: 'pane.broken' }),
        expect.objectContaining({ name: 'pane.swapped' }),
        expect.objectContaining({ name: 'pane.resize_rejected', payload: expect.objectContaining({ unsupported_reason: 'equal-size layout' }) })
      ])
    )
  })

  it('writes terminal keys through session ids and resolves panel ids through the renderer', async () => {
    const backend = await loadBackend()
    const writes: Array<{ sessionId: string; data: string }> = []
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'terminal.focus') {
        return {
          ok: true,
          data: {
            terminal: { panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true }
          }
        }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({
      getWindows: () => [mockWindow],
      writeTerminal: (sessionId, data) => {
        writes.push({ sessionId, data })
        return { ok: true, data: { id: sessionId, bytes: Buffer.byteLength(data, 'utf8') } }
      }
    })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'terminal.send_key',
        params: { sessionId: 'terminal-2', key: 'ctrl+c' }
      })
    ).resolves.toEqual({ ok: true, data: { id: 'terminal-2', bytes: 1, key: 'ctrl+c' } })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'send-key-panel',
        params: { panelId: 'panel-1', key: 'enter' }
      })
    ).resolves.toEqual({ ok: true, data: { id: 'terminal-1', bytes: 1, key: 'enter' } })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'terminal.send_key',
        params: { sessionId: 'terminal-2', key: 'not-a-key-name' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'TERMINAL_KEY_UNKNOWN' }))

    expect(writes).toEqual([
      { sessionId: 'terminal-2', data: '\x03' },
      { sessionId: 'terminal-1', data: '\r' }
    ])
    expect(mockWindow.requests).toEqual([expect.objectContaining({ method: 'terminal.focus', params: expect.objectContaining({ panelId: 'panel-1' }) })])

    const terminalEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'terminal' } })
    expect(terminalEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'terminal.key_sent', payload: expect.objectContaining({ key: 'ctrl+c', bytes: 1 }) }),
        expect.objectContaining({ name: 'terminal.key_sent', payload: expect.objectContaining({ key: 'enter', panel_id: 'panel-1' }) })
      ])
    )
  })

  it('stores tmux-style buffers and pastes them through terminal text input', async () => {
    const backend = await loadBackend()
    const writes: Array<{ sessionId: string; data: string }> = []
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'terminal.focus') {
        return {
          ok: true,
          data: {
            terminal: { panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true }
          }
        }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({
      getWindows: () => [mockWindow],
      writeTerminal: (sessionId, data) => {
        writes.push({ sessionId, data })
        return { ok: true, data: { id: sessionId, bytes: Buffer.byteLength(data, 'utf8') } }
      }
    })
    const deployCommand = 'kubectl rollout status deploy/api\n'
    const deployBytes = Buffer.byteLength(deployCommand, 'utf8')

    await expect(
      backend.__testing.handleControlRequest({
        method: 'set-buffer',
        params: { name: 'deploy', text: deployCommand }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          buffer: expect.objectContaining({ name: 'deploy', size: deployBytes }),
          buffers: [expect.objectContaining({ name: 'deploy', size: deployBytes })]
        })
      })
    )

    await expect(backend.__testing.handleControlRequest({ method: 'list-buffers', params: {} })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1, buffers: [expect.objectContaining({ name: 'deploy' })] }) })
    )

    await expect(
      backend.__testing.handleControlRequest({
        method: 'paste-buffer',
        params: { name: 'deploy', panelId: 'panel-1' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          id: 'terminal-1',
          bytes: deployBytes,
          bufferName: 'deploy'
        })
      })
    )

    await expect(backend.__testing.handleControlRequest({ method: 'terminal.buffer.paste', params: { name: 'missing', sessionId: 'terminal-1' } })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'TERMINAL_BUFFER_NOT_FOUND' })
    )
    expect(writes).toEqual([{ sessionId: 'terminal-1', data: deployCommand }])
    expect(backend.__testing.listTerminalBuffers()).toEqual([expect.objectContaining({ name: 'deploy' })])
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

  it('coordinates local automation with wait-for signals over the control socket', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-wait-for-'))
    try {
      const socketPath = await backend.ensureControlSocketServer(root)
      const waiter = socketRequest(socketPath, {
        id: 'waiter-1',
        method: 'sync.wait_for',
        params: { name: 'build-ready', timeoutMs: 5000 }
      })
      await nextTick()
      await expect(
        socketRequest(socketPath, {
          id: 'signal-1',
          method: 'wait-for',
          params: { name: 'build-ready', signal: true }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          id: 'signal-1',
          ok: true,
          data: expect.objectContaining({ name: 'build-ready', status: 'signaled', waiterCount: 1 })
        })
      )
      await expect(waiter).resolves.toEqual(
        expect.objectContaining({
          id: 'waiter-1',
          ok: true,
          data: expect.objectContaining({ name: 'build-ready', status: 'signaled' })
        })
      )

      await expect(
        backend.__testing.handleControlRequest({
          method: 'sync.wait_for',
          params: { name: '../bad', signal: true }
        })
      ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'WAIT_FOR_NAME_INVALID' }))

      await expect(
        backend.__testing.handleControlRequest({
          method: 'sync.wait_for',
          params: { name: 'missing-signal', timeoutMs: 1 }
        })
      ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'WAIT_FOR_TIMEOUT' }))
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stores sidebar-style status, progress, and log metadata for automation', async () => {
    const backend = await loadBackend()

    await expect(
      backend.__testing.handleControlRequest({
        method: 'sidebar.status.set',
        params: { workspaceId: 'main', key: 'build', value: 'compiling', icon: 'hammer', color: '#ff9500', priority: 80 }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: expect.objectContaining({ key: 'build', value: 'compiling', priority: 80 }),
          statuses: [expect.objectContaining({ key: 'build' })]
        })
      })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'set-progress', params: { workspaceId: 'main', value: 0.5, label: 'Building' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ progress: expect.objectContaining({ value: 0.5, label: 'Building' }) }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'log', params: { workspaceId: 'main', level: 'success', source: 'test', message: 'All green' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ log: expect.objectContaining({ level: 'success', source: 'test', message: 'All green' }) }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'sidebar.state', params: { workspaceId: 'main' } })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          statuses: [expect.objectContaining({ key: 'build' })],
          progress: expect.objectContaining({ value: 0.5 }),
          logs: [expect.objectContaining({ message: 'All green' })]
        })
      })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'clear-status', params: { workspaceId: 'main', key: 'build' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ removed: true, statuses: [] }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'clear-progress', params: { workspaceId: 'main' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ removed: true, progress: null }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'clear-log', params: { workspaceId: 'main' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ changed: 1, logs: [] }) })
    )
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
          detect: {
            processName: 'my-agent',
            argvContains: ['--session']
          },
          sessionIdSource: { type: 'argvOption', argvOption: '--session' },
          launchCommand: 'my-agent --cwd {{cwd}} --role {{role}} --index {{index}} {{prompt}}',
          resumeCommand: 'my-agent --session {{sessionId}}',
          forkCommand: 'my-agent --session {{sessionId}} --fork',
          cwd: 'preserve'
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
      expect(backend.__testing.listAgentVaultEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'my-agent' }),
          expect.objectContaining({ id: 'omp', sessionIdSource: { type: 'piSessionFile' } }),
          expect.objectContaining({ id: 'pi', sessionIdSource: { type: 'piSessionFile' } })
        ])
      )

      await expect(
        backend.__testing.handleControlRequest({
          method: 'agent.vault.render',
          params: { id: 'my-agent', kind: 'resume', sessionId: 'session-1' }
        })
      ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ command: 'my-agent --session session-1' }) }))
      await expect(
        backend.__testing.handleControlRequest({
          method: 'agent.vault.identify',
          params: {
            process: {
              pid: 4242,
              processName: 'my-agent',
              executable: '/usr/local/bin/my-agent',
              argv: ['/usr/local/bin/my-agent', '--session', 'session-42'],
              cwd: '/work/project'
            }
          }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            matched: true,
            count: 1,
            matches: [
              expect.objectContaining({
                sessionId: 'session-42',
                cwd: '/work/project',
                canResume: true,
                canFork: true,
                resumeCommand: 'my-agent --session session-42',
                forkCommand: 'my-agent --session session-42 --fork',
                agent: expect.objectContaining({
                  id: 'my-agent',
                  detect: expect.objectContaining({ processName: 'my-agent', argvContains: ['--session'] }),
                  sessionIdSource: { type: 'argvOption', argvOption: '--session' }
                }),
                process: expect.objectContaining({ pid: 4242, processName: 'my-agent' })
              })
            ]
          })
        })
      )
      await expect(
        backend.__testing.handleControlRequest({
          method: 'agent.vault.identify',
          params: {
            process: {
              processName: 'omp',
              executable: '/usr/local/bin/omp',
              argv: ['/usr/local/bin/omp'],
              sessionPath: '/home/user/.omp/agent/sessions/omp-session-1',
              cwd: '/work/omp'
            }
          }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            matched: true,
            matches: expect.arrayContaining([
              expect.objectContaining({
                sessionId: '/home/user/.omp/agent/sessions/omp-session-1',
                resumeCommand: '/usr/local/bin/omp --session /home/user/.omp/agent/sessions/omp-session-1',
                forkCommand: '/usr/local/bin/omp --session /home/user/.omp/agent/sessions/omp-session-1 --fork',
                agent: expect.objectContaining({ id: 'omp', name: 'OMP' })
              })
            ])
          })
        })
      )

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

  it('scans aiopsterm local terminal descendants through Agent Vault', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-vault-scan-'))
    let child: ChildProcessWithoutNullStreams | null = null
    try {
      await backend.ensureControlSocketServer(root)
      await backend.__testing.handleControlRequest({
        method: 'agent.vault.register',
        params: {
          id: 'scan-agent',
          name: 'Scan Agent',
          executable: process.execPath,
          detect: {
            executableContains: 'node',
            argvContains: ['--session', 'session-scan-1']
          },
          sessionIdSource: { type: 'argvOption', argvOption: '--session' },
          resumeCommand: '{{executable}} --session {{sessionId}}',
          cwd: 'preserve'
        }
      })
      backend.registerControlSocketIpc({
        handle: (_channel, handler) => {
          mockIpcHandler = handler
        }
      })
      mockWindow = createMockWindow((request) => {
        if (request.method === 'terminal.list') {
          return {
            ok: true,
            data: {
              terminals: [
                {
                  panelId: 'panel-local',
                  sessionId: 'terminal-local',
                  title: 'Local',
                  kind: 'local',
                  active: true,
                  connected: true,
                  cwd: process.cwd(),
                  processId: process.pid,
                  processGroupId: process.pid,
                  shell: process.execPath
                }
              ],
              count: 1,
              activePanelId: 'panel-local'
            }
          }
        }
        return { ok: false, errorCode: 'UNEXPECTED_REQUEST', errorMessage: `Unexpected request ${request.method}` }
      })
      backend.configureControlSocketRuntime({ userDataPath: root, getWindows: () => [mockWindow] })
      if (process.platform !== 'linux') {
        await expect(backend.__testing.handleControlRequest({ method: 'agent.vault.scan', params: { id: 'scan-agent' } })).resolves.toEqual(
          expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true, platform: process.platform }) })
        )
        return
      }
      child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', '--', '--session', 'session-scan-1'], { stdio: 'pipe' })

      const scanned = await waitForAgentVaultScanMatch(backend, 'session-scan-1')
      expect(scanned).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            matched: true,
            count: 1,
            terminals: [expect.objectContaining({ panelId: 'panel-local', processId: process.pid })],
            matches: [
              expect.objectContaining({
                sessionId: 'session-scan-1',
                panelId: 'panel-local',
                terminalSessionId: 'terminal-local',
                terminalProcessId: process.pid,
                resumeCommand: expect.stringContaining('--session session-scan-1'),
                agent: expect.objectContaining({ id: 'scan-agent' }),
                process: expect.objectContaining({ pid: child.pid })
              })
            ]
          })
        })
      )
    } finally {
      if (child && !child.killed) child.kill('SIGTERM')
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

  it('manages captured AI sessions through local control primitives without raw hook payloads', async () => {
    const backend = await loadBackend()
    const agentSessions = await loadAgentSessionsBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-agent-session-'))
    try {
      await backend.ensureControlSocketServer(root)
      await agentSessions.configureAiAgentSessionStore(root)
      agentSessions.publishAiAgentSessionEvent(
        {
          source: 'claude-code',
          event: 'PermissionRequest',
          sessionId: 'claude-control-1',
          requestId: 'request-1',
          waitForDecision: true,
          actionable: true,
          panelId: 'panel-ai',
          terminalSessionId: 'terminal-ai',
          cwd: '/work/project',
          title: 'Deploy review',
          summary: 'Approve deploy command',
          toolName: 'Bash',
          raw_secret: 'do-not-return',
          receivedAt: 1717200000000
        },
        null
      )

      await expect(backend.__testing.handleControlRequest({ method: 'agent.session.list', params: { needsInput: true } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            count: 1,
            total: 1,
            needsInputCount: 1,
            sessions: [
              expect.objectContaining({
                source: 'claude-code',
                sessionId: 'claude-control-1',
                state: 'needsInput',
                needsInput: true,
                eventCount: 1,
                decisionCount: 0
              })
            ]
          })
        })
      )

      const shown = await backend.__testing.handleControlRequest({ method: 'agent.session.show', params: { sessionId: 'claude-control-1', source: 'claude-code' } })
      expect(shown).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            session: expect.objectContaining({
              source: 'claude-code',
              sessionId: 'claude-control-1',
              events: [expect.objectContaining({ event: 'permission_request', summary: 'Approve deploy command' })]
            })
          })
        })
      )
      expect(JSON.stringify(shown)).not.toContain('raw_secret')
      expect(JSON.stringify(shown)).not.toContain('do-not-return')

      await expect(
        backend.__testing.handleControlRequest({
          method: 'agent.session.reply',
          params: { sessionId: 'claude-control-1', source: 'claude-code', kind: 'deny', message: 'Use staging first' }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            session: expect.objectContaining({
              state: 'idle',
              decisions: [expect.objectContaining({ kind: 'deny', message: 'Use staging first' })]
            }),
            needsInputCount: 0
          })
        })
      )

      await expect(
        backend.__testing.handleControlRequest({ method: 'agent.session.rename', params: { sessionId: 'claude-control-1', source: 'claude-code', title: 'Deploy Approval' } })
      ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ session: expect.objectContaining({ title: 'Deploy Approval' }) }) }))

      await expect(backend.__testing.handleControlRequest({ method: 'agent.session.clear', params: { sessionId: 'claude-control-1', source: 'claude-code' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ cleared: true, count: 0, needsInputCount: 0 })
        })
      )
      await expect(agentSessions.listManagedAiSessions()).resolves.toEqual(expect.objectContaining({ ok: true, data: { sessions: [] } }))
    } finally {
      await agentSessions.__testing.flushManagedAiSessionWrites()
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('bulk manages captured AI sessions through feed-style control commands', async () => {
    const backend = await loadBackend()
    const agentSessions = await loadAgentSessionsBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-agent-session-bulk-'))
    try {
      await backend.ensureControlSocketServer(root)
      await agentSessions.configureAiAgentSessionStore(root)
      agentSessions.publishAiAgentSessionEvent(
        {
          source: 'claude-code',
          event: 'PermissionRequest',
          sessionId: 'claude-bulk-1',
          requestId: 'request-1',
          waitForDecision: true,
          actionable: true,
          summary: 'Approve command',
          receivedAt: 1717200000000
        },
        null
      )
      agentSessions.publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'SessionEnd',
          sessionId: 'codex-ended-1',
          summary: 'Finished old task',
          receivedAt: 1717200000100
        },
        null
      )

      await expect(backend.__testing.handleControlRequest({ method: 'feed.mark-handled' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            operation: 'mark-handled',
            changed: 1,
            needsInputCount: 0,
            sessions: expect.arrayContaining([expect.objectContaining({ sessionId: 'claude-bulk-1', state: 'idle' })])
          })
        })
      )
      await expect(backend.__testing.handleControlRequest({ method: 'agent.session.bulk', params: { operation: 'clear-ended' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            operation: 'clear-ended',
            changed: 1,
            sessions: expect.not.arrayContaining([expect.objectContaining({ sessionId: 'codex-ended-1' })])
          })
        })
      )
      await expect(backend.__testing.handleControlRequest({ method: 'feed.clear' })).resolves.toEqual(
        expect.objectContaining({ ok: false, errorCode: 'AGENT_SESSION_CLEAR_ALL_CONFIRM_REQUIRED' })
      )
      await expect(backend.__testing.handleControlRequest({ method: 'feed.clear', params: { yes: true } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ operation: 'clear-all', changed: 1, count: 0 })
        })
      )
    } finally {
      await agentSessions.__testing.flushManagedAiSessionWrites()
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
