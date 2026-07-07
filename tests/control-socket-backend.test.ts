import { createConnection } from 'net'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ControlRequest, ControlResponse } from '@shared/contracts/control'

type ControlSocketBackend = {
  configureControlSocketRuntime: (config?: {
    userDataPath?: string
    getWindows?: () => Array<Record<string, unknown>>
    focusWindow?: (window?: Record<string, unknown> | null) => Record<string, unknown> | null
    getDisplays?: () => Array<Record<string, unknown>>
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
    listTmuxCompatHooks: () => Array<Record<string, unknown>>
    eventSubscriptionCount: () => number
    mobileEventSubscriptionCount: () => number
    listMobileEventSubscriptions: () => Array<Record<string, unknown>>
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
  id?: number
  focused?: boolean
  visible?: boolean
  minimized?: boolean
  requests: ControlRequest[]
  isDestroyed: () => boolean
  isFocused: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  getBounds: () => { x: number; y: number; width: number; height: number }
  webContents: {
    isDestroyed: () => boolean
    send: (channel: string, request: ControlRequest) => void
  }
}

const loadBackend = async () => {
  const modulePath = '../src/main/backend/control/controlSocket'
  return (await import(modulePath)) as unknown as ControlSocketBackend
}

const loadControlSocketStateRuntime = async () => {
  const modulePath = '../src/main/backend/control/controlSocketStateRuntime'
  return (await import(modulePath)) as { flushControlSocketDurableEventLog: () => Promise<void> }
}

const loadAgentSessionsBackend = async () => {
  const modulePath = '../src/main/backend/agent/agentSessions'
  return (await import(modulePath)) as AgentSessionsBackend
}

const loadAgentHookInstallerBackend = async () => {
  const modulePath = '../src/main/backend/agent/agentHookInstaller'
  return (await import(modulePath)) as AgentHookInstallerBackend
}

const createMockWindow = (handler: (request: ControlRequest) => ControlResponse | Promise<ControlResponse>): MockWindow => ({
  id: 1,
  focused: true,
  visible: true,
  minimized: false,
  requests: [],
  isDestroyed: () => false,
  isFocused() {
    return this.focused === true
  },
  isVisible() {
    return this.visible !== false
  },
  isMinimized() {
    return this.minimized === true
  },
  getBounds() {
    return { x: 10, y: 20, width: 1200, height: 800 }
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

const waitForEventSubscriptionsToDrain = async (backend: ControlSocketBackend, attempts = 20) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (backend.__testing.eventSubscriptionCount() === 0) return
    await nextTick()
  }
  expect(backend.__testing.eventSubscriptionCount()).toBe(0)
}

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
            capabilities: expect.arrayContaining([
              'system.capabilities',
              'system.identify',
              'system.top',
              'system.memory',
              'auth.status',
              'auth.begin_sign_in',
              'auth.sign_out',
              'vm.compat',
              'remotes.compat',
              'sidebar.custom',
              'feedback.submit',
              'agent.session',
              'events.stream'
            ])
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

      await expect(backend.__testing.handleControlRequest({ method: 'system.ping' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ pong: true, socketPath: expect.any(String) })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'auth.status' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            signed_in: false,
            is_loading: false,
            timed_out: false,
            local_control_socket: true,
            unsupported: true
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'auth.sign_in_url' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ unsupported: true, url: null })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'auth.begin_sign_in', params: { timeout_seconds: 1 } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            signed_in: false,
            action: 'begin_sign_in',
            completed: false,
            unsupported: true
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'auth.sign_out' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            signed_in: false,
            action: 'sign_out',
            completed: false,
            unsupported: true
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'feedback.submit', params: { email: 'dev@example.test', body: 'feedback body', image_paths: ['/tmp/a.png'] } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            submitted: false,
            accepted: true,
            local_only: true,
            email: 'dev@example.test',
            body_length: 13,
            attachment_count: 1
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'feedback.submit', params: { email: 'dev@example.test' } })).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          errorCode: 'INVALID_PARAMS',
          data: { field: 'body' }
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'system.top', params: { include_processes: true } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            active: null,
            caller: null,
            sample: expect.objectContaining({ source: 'node.process.memoryUsage+os', process_details: true }),
            totals: expect.objectContaining({ process_count: 1, pids: [process.pid] }),
            memory_diagnostic: expect.objectContaining({
              app: expect.objectContaining({ pid: process.pid, name: 'aiopsterm' }),
              system: expect.objectContaining({ total_bytes: expect.any(Number), free_bytes: expect.any(Number) })
            }),
            program_totals: [expect.objectContaining({ id: 'aiopsterm' })],
            coding_agents: [],
            windows: [],
            compatibility: expect.objectContaining({ control_compat_shape: true, renderer_snapshot_available: false }),
            warning: expect.objectContaining({ ok: false, errorCode: 'NO_APP_WINDOW' })
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'system.memory', params: { top_group_limit: 3 } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            sample: expect.objectContaining({ source: 'node.process.memoryUsage+os' }),
            memory_diagnostic: expect.objectContaining({ children: expect.objectContaining({ groups: expect.any(Array) }) }),
            windows: [],
            compatibility: expect.objectContaining({ control_compat_shape: true })
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'system.memory', params: { top_group_limit: 101 } })).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          errorCode: 'INVALID_PARAMS'
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'vm.list' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ vms: [], count: 0, unsupported: true, method: 'vm.list' })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'vm.create', params: { image: 'ubuntu' } })).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          errorCode: 'INVALID_PARAMS',
          data: { field: 'idempotency_key' }
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'vm.create', params: { image: 'ubuntu', provider: 'test', idempotency_key: 'key-1' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ created: false, image: 'ubuntu', provider: 'test', idempotency_key: 'key-1', unsupported: true })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'vm.exec', params: { id: 'vm-1', command: 'echo hello' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ id: 'vm-1', command: 'echo hello', executed: false, unsupported: true })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'vm.ssh_info', params: { id: 'vm-1' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ id: 'vm-1', host: null, port: null, token: null, unsupported: true })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'remotes.list' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ remotes: [], count: 0, unsupported: true, method: 'remotes.list' })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'remotes.add', params: { name: 'desk', routes: ['host.example:22'], tag: 'lab' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ ok: false, added: false, name: 'desk', routes: ['host.example:22'], tag: 'lab', unsupported: true })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'remotes.remove', params: { target: 'desk' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ ok: false, removed: false, target: 'desk', unsupported: true })
        })
      )

      await mkdir(join(root, 'custom-sidebars'), { recursive: true })
      await writeFile(join(root, 'custom-sidebars', 'ops.json'), '{"title":"Ops"}', 'utf-8')
      await expect(backend.__testing.handleControlRequest({ method: 'sidebar.custom.validate' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            directory: join(root, 'custom-sidebars'),
            valid_count: 0,
            error_count: 1,
            unsupported: true,
            sidebars: [expect.objectContaining({ name: 'ops', kind: 'json', ok: false, error: expect.stringContaining('custom sidebar rendering is not implemented') })]
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'sidebar.custom.reload', params: { name: 'ops' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            reloaded_count: 0,
            reloaded_names: [],
            reloaded: false,
            sidebars: [expect.objectContaining({ name: 'ops' })]
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'sidebar.custom.select', params: { name: 'missing' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            selected: false,
            selected_name: null,
            sidebars: [expect.objectContaining({ name: 'missing', ok: false, error: 'Sidebar file is missing.' })]
          })
        })
      )

      await expect(backend.__testing.handleControlRequest({ method: 'sidebar.custom.select' })).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          errorCode: 'INVALID_PARAMS',
          data: { field: 'name' }
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

  it('summarizes the current automation context from the renderer workspace snapshot', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow(() => ({
      ok: true,
      data: {
        snapshot: {
          generatedAt: 1000,
          mode: 'terminal',
          activeModule: 'workspace',
          activePanelId: 'panel-1',
          workspaces: [{ id: 'main', title: 'Main Workspace', active: true, mode: 'terminal', activeModule: 'workspace', activePanelId: 'panel-1' }],
          terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local API', kind: 'local', active: true, connected: true, cwd: '/work/api' }],
          surfaces: [{ panelId: 'panel-1', title: 'Local API', surfaceKind: 'terminal', active: true, sessionId: 'terminal-1', terminalKind: 'local', connected: true, cwd: '/work/api' }],
          splitGroups: [],
          workspaceGroups: [],
          notifications: [{ id: 'notify-1', title: 'Deploy done', body: 'All green', read: false, source: 'ci', level: 'success', group: 'build', createdAt: 900, updatedAt: 900 }],
          managedAiSessions: [
            {
              id: 'claude-approval-1',
              source: 'claude-code',
              title: 'Deploy approval',
              summary: 'Approve rollout',
              state: 'needsInput',
              lastEvent: 'permission_request',
              lastActivityAt: 950,
              createdAt: 900,
              updatedAt: 950,
              needsInput: true,
              requestKind: 'permission',
              decisionMode: 'blocking',
              actionable: true,
              pendingRequestId: 'request-1',
              panelId: 'panel-1',
              terminalSessionId: 'terminal-1',
              cwd: '/work/api',
              eventCount: 1,
              decisionCount: 0
            }
          ],
          agentHibernation: { enabled: false, idleSeconds: 300, maxLiveTerminals: 12, confirmationSeconds: 60 },
          attention: { unreadCount: 1, items: [{ id: 'managed-ai:claude-code:claude-approval-1', source: 'claude-code', kind: 'permission', title: 'Deploy approval', summary: 'Approve rollout', priority: 100, createdAt: 950, sessionId: 'claude-approval-1', surfaceId: 'panel-1' }] },
          counts: {
            terminals: 1,
            connectedTerminals: 1,
            surfaces: 1,
            splitGroups: 0,
            workspaceGroups: 0,
            notifications: 1,
            unreadNotifications: 1,
            managedAiSessions: 1,
            managedAiNeedsInput: 1,
            attentionItems: 1
          }
        }
      }
    }))
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'workspace.context' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          activeTerminal: expect.objectContaining({ panelId: 'panel-1', sessionId: 'terminal-1', cwd: '/work/api' }),
          counts: expect.objectContaining({ writableTerminals: 1, pendingAiSessions: 1, unreadNotifications: 1 }),
          pendingAiSessions: [expect.objectContaining({ source: 'claude-code', sessionId: 'claude-approval-1', pendingRequestId: 'request-1' })],
          unreadNotifications: [expect.objectContaining({ id: 'notify-1', title: 'Deploy done' })],
          suggestions: expect.arrayContaining([
            expect.objectContaining({ label: 'Read active terminal screen', rpc: expect.objectContaining({ method: 'terminal.read_screen' }) }),
            expect.objectContaining({ label: 'Open next pending AI session', rpc: expect.objectContaining({ method: 'feed.jump' }) })
          ])
        })
      })
    )
    expect(mockWindow.requests).toEqual([expect.objectContaining({ method: 'workspace.snapshot' })])
  })

  it('exposes control_compat-style system and window compatibility controls without closing user windows', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow(() => ({
      ok: true,
      data: {
        snapshot: {
          generatedAt: 1000,
          mode: 'terminal',
          activeModule: 'workspace',
          activePanelId: 'panel-1',
          workspaces: [{ id: 'main', title: 'Main Workspace', active: true, mode: 'terminal', activeModule: 'workspace', activePanelId: 'panel-1' }],
          terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1', title: 'Local', kind: 'local', active: true, connected: true, cwd: '/work' }],
          surfaces: [{ panelId: 'panel-1', title: 'Local', surfaceKind: 'terminal', active: true, sessionId: 'terminal-1', terminalKind: 'local', connected: true }],
          splitGroups: [],
          workspaceGroups: [],
          notifications: [],
          managedAiSessions: [],
          agentHibernation: { enabled: false, idleSeconds: 0, maxLiveTerminals: 0, confirmationSeconds: 0 },
          attention: { unreadCount: 0, items: [] },
          counts: {
            terminals: 1,
            connectedTerminals: 1,
            surfaces: 1,
            splitGroups: 0,
            workspaceGroups: 0,
            notifications: 0,
            unreadNotifications: 0,
            managedAiSessions: 0,
            managedAiNeedsInput: 0,
            attentionItems: 0
          }
        }
      }
    }))
    const secondWindow = createMockWindow(() => ({ ok: true, data: {} }))
    secondWindow.id = 17
    secondWindow.focused = false
    let focusedWindow: Record<string, unknown> | null = null
    backend.configureControlSocketRuntime({
      getWindows: () => [mockWindow, secondWindow],
      focusWindow: (window) => {
        focusedWindow = window || null
        mockWindow.focused = window === mockWindow
        secondWindow.focused = window === secondWindow
        return window || null
      },
      getDisplays: () => [{ id: 101, label: 'Unit Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 24, width: 1920, height: 1056 } }]
    })

    await expect(backend.__testing.handleControlRequest({ method: 'auth.login' })).resolves.toEqual(expect.objectContaining({ ok: true, data: { authenticated: true, required: false } }))
    await expect(backend.__testing.handleControlRequest({ method: 'window.list' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          windows: [
            expect.objectContaining({ id: 'window:1', electronId: 1, key: true, selected_workspace_id: 'main' }),
            expect.objectContaining({ id: 'window:17', electronId: 17, key: false })
          ]
        })
      })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'window.focus', params: { windowId: 'window:17' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ windowId: 'window:17', focused: true }) })
    )
    expect(focusedWindow).toBe(secondWindow)
    await expect(backend.__testing.handleControlRequest({ method: 'window.displays' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ displays: [expect.objectContaining({ displayId: 101, name: 'Unit Display' })] }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'window.close', params: { windowId: 'window:17' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ closed: false, unsupported: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'window.focus', params: { windowId: 'window:1' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ windowId: 'window:1', focused: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'system.tree' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          active: expect.objectContaining({ workspace_id: 'main', surface_id: 'panel-1' }),
          windows: [expect.objectContaining({ workspaces: [expect.objectContaining({ panes: [expect.objectContaining({ selected_surface_id: 'panel-1' })] })] })]
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

  it('routes workspace env and auto-title compatibility controls to the renderer', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'workspace.env') {
        return { ok: true, data: { workspace_id: 'main', workspace_ref: 'workspace:1', env: { SAFE_ENV: 'yes' }, count: 1, keys: ['SAFE_ENV'] } }
      }
      return {
        ok: true,
        data: {
          enabled: true,
          title: params.title,
          workspaceApplied: params.probe === true ? false : true,
          workspace_applied: params.probe === true ? false : true,
          panelApplied: params.probe === true ? false : true,
          panel_applied: params.probe === true ? false : true,
          workspace_user_owned: params.probe === true,
          panelId: params.panelId || 'panel-1',
          panel_id: params.panelId || 'panel-1'
        }
      }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'workspace.env', params: { workspaceId: 'main' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ env: { SAFE_ENV: 'yes' }, count: 1 }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'workspace.set_auto_title', params: { panelId: 'panel-1', title: 'Generated Title' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ workspaceApplied: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'workspace.set_auto_title', params: { panelId: 'panel-1', probe: true } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ workspace_user_owned: true }) })
    )

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'workspace.env', params: expect.objectContaining({ workspaceId: 'main' }) }),
      expect.objectContaining({ method: 'workspace.set_auto_title', params: expect.objectContaining({ panelId: 'panel-1', title: 'Generated Title' }) }),
      expect.objectContaining({ method: 'workspace.set_auto_title', params: expect.objectContaining({ panelId: 'panel-1', probe: true }) })
    ])
    const workspaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'workspace' } })
    expect(workspaceEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'workspace.auto_title_set', payload: expect.objectContaining({ title: 'Generated Title', workspace_applied: true, panel_id: 'panel-1' }) })
      ])
    )
  })

  it('routes workspace remote controls to the renderer and records sanitized workspace events', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'workspace.remote.configure') {
        return {
          ok: true,
          data: {
            configured: true,
            autoConnect: params.autoConnect === true || params.auto_connect === true,
            surfaceId: params.surfaceId || 'panel-remote',
            remote: {
              configured: true,
              state: 'disconnected',
              connection_state: 'disconnected',
              remote_display_target: 'root@example.com:2222',
              destination: 'example.com',
              host: 'example.com',
              port: 2222,
              username: 'root'
            }
          }
        }
      }
      if (request.method === 'workspace.remote.reconnect') {
        return {
          ok: true,
          data: {
            reconnected: true,
            connected: true,
            surfaceId: params.surfaceId || 'panel-remote',
            remote: {
              configured: true,
              state: 'connected',
              connection_state: 'connected',
              remote_display_target: 'root@example.com:2222',
              destination: 'example.com'
            }
          }
        }
      }
      if (request.method === 'workspace.remote.disconnect') {
        return {
          ok: true,
          data: {
            disconnected: true,
            clear: params.clear === true,
            remote: {
              configured: true,
              state: 'disconnected',
              connection_state: 'disconnected',
              remote_display_target: 'root@example.com:2222',
              destination: 'example.com'
            }
          }
        }
      }
      if (request.method === 'workspace.remote.pty_bridge' || request.method === 'workspace.remote.pty_resize' || request.method === 'remote.tmux.sessions') {
        return {
          ok: true,
          data: {
            method: request.method,
            unsupported: true,
            resized: request.method === 'workspace.remote.pty_resize' ? false : undefined,
            unsupportedReason: 'unsupported compatibility path',
            remote: {
              configured: true,
              state: 'disconnected',
              connection_state: 'disconnected',
              remote_display_target: 'root@example.com:2222',
              destination: 'example.com'
            }
          }
        }
      }
      return { ok: true, data: { remote: { connection_state: 'disconnected', destination: 'example.com' } } }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(
      backend.__testing.handleControlRequest({
        method: 'workspace.remote.configure',
        params: { destination: 'root@example.com', port: 2222, auto_connect: true, foreground_auth_token: 'secret-token' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ configured: true }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'workspace.remote.reconnect', params: { surfaceId: 'panel-remote' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ reconnected: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'workspace.remote.disconnect', params: { surfaceId: 'panel-remote', clear: true } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ disconnected: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'workspace.remote.pty_bridge', params: { session_id: 'ssh-1' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true }) })
    )
    await expect(
      backend.__testing.handleControlRequest({ method: 'workspace.remote.pty_resize', params: { session_id: 'ssh-1', attachment_id: 'attach-1', attachment_token: 'token-1', cols: 100, rows: 40 } })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true, resized: false }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'remote.tmux.sessions', params: { host: 'example.com', identity_file: '/tmp/key' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true }) })
    )

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'workspace.remote.configure', params: expect.objectContaining({ destination: 'root@example.com', port: 2222 }) }),
      expect.objectContaining({ method: 'workspace.remote.reconnect', params: expect.objectContaining({ surfaceId: 'panel-remote' }) }),
      expect.objectContaining({ method: 'workspace.remote.disconnect', params: expect.objectContaining({ surfaceId: 'panel-remote', clear: true }) }),
      expect.objectContaining({ method: 'workspace.remote.pty_bridge', params: expect.objectContaining({ session_id: 'ssh-1' }) }),
      expect.objectContaining({ method: 'workspace.remote.pty_resize', params: expect.objectContaining({ session_id: 'ssh-1', attachment_id: 'attach-1', cols: 100, rows: 40 }) }),
      expect.objectContaining({ method: 'remote.tmux.sessions', params: expect.objectContaining({ host: 'example.com', identity_file: '/tmp/key' }) })
    ])
    const workspaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'workspace' } })
    expect(workspaceEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'workspace_remote.configured', payload: expect.objectContaining({ remote_state: 'disconnected', remote_display_target: 'root@example.com:2222', destination: 'example.com', reconnected: false }) }),
        expect.objectContaining({ name: 'workspace_remote.reconnected', payload: expect.objectContaining({ remote_state: 'connected', reconnected: true }) }),
        expect.objectContaining({ name: 'workspace_remote.disconnected', payload: expect.objectContaining({ remote_state: 'disconnected', disconnected: true }) }),
        expect.objectContaining({ name: 'workspace_remote.pty_unsupported', payload: expect.objectContaining({ unsupported: true, unsupported_reason: 'unsupported compatibility path' }) }),
        expect.objectContaining({ name: 'remote_tmux.unsupported', payload: expect.objectContaining({ unsupported: true, destination: 'example.com' }) })
      ])
    )
    const serializedEvents = JSON.stringify(workspaceEvents.data?.events)
    expect(serializedEvents).not.toContain('secret-token')
    expect(serializedEvents).not.toContain('/tmp/key')
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

  it('routes project, markdown, and file open compatibility requests to the renderer window', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'project.open') {
        return { ok: true, data: { opened: true, surfaceId: 'panel-project', project: { surfaceId: 'panel-project', projectUrl: (request.params as any).path, activeTab: 'files' } } }
      }
      if (request.method === 'project.set_tab') {
        return { ok: true, data: { surfaceId: 'panel-project', projectUrl: '/work/project', activeTab: (request.params as any).tab, unsupported: true } }
      }
      if (request.method === 'markdown.open' || request.method === 'file.open') {
        return { ok: true, data: { opened: true, surfaceId: 'kb:commands/diagnose.md', relPath: 'commands/diagnose.md', surfaces: [{ panelId: 'kb:commands/diagnose.md' }] } }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'project.open', params: { path: '/work/project' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ opened: true, surfaceId: 'panel-project' }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'project.set_tab', params: { surfaceId: 'panel-project', tab: 'targets' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ activeTab: 'targets' }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'markdown.open', params: { path: 'commands/diagnose.md', line: 2 } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ relPath: 'commands/diagnose.md' }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'file.open', params: { paths: ['commands/diagnose.md'] } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ opened: true }) })
    )
    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'project.open', params: expect.objectContaining({ path: '/work/project' }) }),
      expect.objectContaining({ method: 'project.set_tab', params: expect.objectContaining({ surfaceId: 'panel-project', tab: 'targets' }) }),
      expect.objectContaining({ method: 'markdown.open', params: expect.objectContaining({ path: 'commands/diagnose.md', line: 2 }) }),
      expect.objectContaining({ method: 'file.open', params: expect.objectContaining({ paths: ['commands/diagnose.md'] }) })
    ])
    const projectEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'project' } })
    expect(projectEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'project.opened' }),
        expect.objectContaining({ name: 'project.updated' }),
        expect.objectContaining({ name: 'markdown.opened' }),
        expect.objectContaining({ name: 'file.opened' })
      ])
    )
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

  it('routes control_compat-style mobile terminal controls to shared terminal surfaces', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'workspace.snapshot') {
        return {
          ok: true,
          data: {
            snapshot: {
              activePanelId: 'panel-1',
              workspaces: [{ id: 'main', title: 'Main Workspace' }],
              terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1' }]
            }
          }
        }
      }
      if (request.method === 'surface.create') {
        return { ok: true, data: { surface_id: 'panel-new', surface: { panelId: 'panel-new' }, createdPane: { panelId: 'panel-new', title: params.title || 'New' } } }
      }
      if (request.method === 'mobile.workspace.list') {
        return { ok: true, data: { workspace_count: 1, terminals: [{ panelId: 'panel-1', sessionId: 'terminal-1' }] } }
      }
      if (request.method === 'terminal.input' || request.method === 'terminal.paste' || request.method === 'terminal.replay' || request.method === 'terminal.viewport') {
        return {
          ok: true,
          data: {
            workspace_id: 'main',
            surface_id: params.surface_id || params.surfaceId || 'panel-1',
            session_id: params.session_id || params.sessionId || 'terminal-1',
            queued: request.method === 'terminal.input' ? false : undefined,
            submitted: request.method === 'terminal.paste' ? true : undefined,
            snapshot_format: request.method === 'terminal.replay' ? 'aiopsterm.text' : undefined,
            columns: request.method === 'terminal.replay' || request.method === 'terminal.viewport' ? 80 : undefined,
            rows: request.method === 'terminal.replay' || request.method === 'terminal.viewport' ? 24 : undefined
          }
        }
      }
      if (request.method === 'terminal.scroll' || request.method === 'terminal.mouse') {
        return { ok: true, data: { surface_id: params.surface_id || 'panel-1', unsupported: true } }
      }
      return { ok: true, data: {} }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'mobile.host.status' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ terminal_count: 1, capabilities: expect.arrayContaining(['terminal.input.v1']) }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'mobile.workspace.list' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.create', params: { title: 'Mobile Shell' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.input', params: { surface_id: 'panel-1', text: 'pwd' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.paste', params: { surface_id: 'panel-1', text: 'hello', submit_key: 'none' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.replay', params: { surface_id: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.viewport', params: { surface_id: 'panel-1', viewport_columns: 120 } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.scroll', params: { surface_id: 'panel-1', delta_lines: 3 } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.mouse', params: { surface_id: 'panel-1', col: 2, row: 3 } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'terminal.paste_image', params: { surface_id: 'panel-1', image_base64: 'abc' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true }) })
    )

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'workspace.snapshot' }),
      expect.objectContaining({ method: 'mobile.workspace.list' }),
      expect.objectContaining({ method: 'surface.create', params: expect.objectContaining({ title: 'Mobile Shell' }) }),
      expect.objectContaining({ method: 'terminal.input', params: expect.objectContaining({ surface_id: 'panel-1', text: 'pwd' }) }),
      expect.objectContaining({ method: 'terminal.paste', params: expect.objectContaining({ surface_id: 'panel-1', submit_key: 'none' }) }),
      expect.objectContaining({ method: 'terminal.replay', params: expect.objectContaining({ surface_id: 'panel-1' }) }),
      expect.objectContaining({ method: 'terminal.viewport', params: expect.objectContaining({ surface_id: 'panel-1', viewport_columns: 120 }) }),
      expect.objectContaining({ method: 'terminal.scroll', params: expect.objectContaining({ surface_id: 'panel-1', delta_lines: 3 }) }),
      expect.objectContaining({ method: 'terminal.mouse', params: expect.objectContaining({ surface_id: 'panel-1', col: 2, row: 3 }) })
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

  it('routes control_compat-style pane navigation aliases to the renderer and records focus events', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      if (request.method === 'workspace.find') {
        return {
          ok: true,
          data: {
            matches: [{ panelId: 'panel-2', title: 'Deploy', kind: 'terminal', active: false, reason: 'title' }],
            count: 1,
            query: (request.params as any)?.query
          }
        }
      }
      return {
        ok: true,
        data: {
          selectedPane: { panelId: (request.params as any)?.paneId || (request.params as any)?.panelId || 'panel-2', surfaceKind: 'terminal', title: 'Pane 2' },
          previousActivePanelId: 'panel-1',
          activePanelId: (request.params as any)?.paneId || (request.params as any)?.panelId || 'panel-2',
          action: request.method
        }
      }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'next-window', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'previous-window', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'last-window', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'select-window', params: { panelId: 'panel-3' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'select-pane', params: { paneId: 'panel-4' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'last-pane', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'find-window', params: { query: 'deploy' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ matches: [expect.objectContaining({ panelId: 'panel-2' })] }) })
    )

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'workspace.next' }),
      expect.objectContaining({ method: 'workspace.previous' }),
      expect.objectContaining({ method: 'workspace.last' }),
      expect.objectContaining({ method: 'workspace.select', params: expect.objectContaining({ panelId: 'panel-3' }) }),
      expect.objectContaining({ method: 'pane.focus', params: expect.objectContaining({ paneId: 'panel-4' }) }),
      expect.objectContaining({ method: 'pane.last' }),
      expect.objectContaining({ method: 'workspace.find', params: expect.objectContaining({ query: 'deploy' }) })
    ])
    const paneEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'pane' } })
    expect(paneEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'pane.focused' })]))
    const workspaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'workspace' } })
    expect(workspaceEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'workspace.selected' })]))
  })

  it('routes tmux-style pane management aliases to the renderer and records mutation events', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'workspace.list') return { ok: true, data: { workspaces: [{ id: 'main', active: true, title: 'Main' }] } }
      if (request.method === 'workspace.current') return { ok: true, data: { workspace: { panelId: 'panel-1', title: 'Main', active: true }, activePanelId: 'panel-1' } }
      if (request.method === 'pane.list') return { ok: true, data: { panes: [{ panelId: 'panel-1', title: 'Main', surfaceKind: 'terminal' }], count: 1 } }
      if (request.method === 'workspace.has_session') return { ok: true, data: { exists: true, target: params.panelId || 'panel-1' } }
      if (request.method === 'workspace.select_layout') return { ok: true, data: { layout: params.layout, applied: true } }
      if (request.method === 'workspace.rename') return { ok: true, data: { renamedPane: { panelId: params.panelId || 'panel-1', title: params.title }, action: 'rename-window' } }
      if (request.method === 'workspace.close' || request.method === 'surface.close') {
        return { ok: true, data: { closedPane: { panelId: params.panelId || params.paneId || 'panel-1', title: 'Closed' }, action: request.method } }
      }
      return { ok: true, data: { createdPane: { panelId: 'panel-new', title: params.title || 'New' }, action: request.method } }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'list-windows', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'current-window', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activePanelId: 'panel-1' }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'list-panes', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'new-window', params: { title: 'Scratch', focus: false } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'split-window', params: { paneId: 'panel-1', direction: 'right' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'rename-window', params: { panelId: 'panel-1', title: 'Main Ops' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'kill-window', params: { panelId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'kill-pane', params: { paneId: 'panel-2' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'has-session', params: { panelId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ exists: true }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'select-layout', params: { layout: 'main-vertical' } })).resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'workspace.list' }),
      expect.objectContaining({ method: 'workspace.current' }),
      expect.objectContaining({ method: 'pane.list' }),
      expect.objectContaining({ method: 'workspace.create', params: expect.objectContaining({ title: 'Scratch' }) }),
      expect.objectContaining({ method: 'surface.split', params: expect.objectContaining({ paneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'workspace.rename', params: expect.objectContaining({ title: 'Main Ops' }) }),
      expect.objectContaining({ method: 'workspace.close' }),
      expect.objectContaining({ method: 'surface.close' }),
      expect.objectContaining({ method: 'workspace.has_session' }),
      expect.objectContaining({ method: 'workspace.select_layout' })
    ])
    const workspaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'workspace' } })
    expect(workspaceEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'workspace.created' }),
        expect.objectContaining({ name: 'workspace.renamed' }),
        expect.objectContaining({ name: 'workspace.closed' }),
        expect.objectContaining({ name: 'workspace.layout_selected' })
      ])
    )
    const paneEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'pane' } })
    expect(paneEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'pane.created' }), expect.objectContaining({ name: 'pane.closed' })]))
  })

  it('routes control_compat-style surface and workspace aliases to the renderer', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'workspace.current') return { ok: true, data: { workspace: { panelId: 'panel-1', title: 'Main', active: true }, activePanelId: 'panel-1' } }
      if (request.method === 'workspace.select') return { ok: true, data: { selectedPane: { panelId: params.panelId || 'panel-1', title: 'Main' }, activePanelId: params.panelId || 'panel-1', action: 'select-workspace' } }
      if (request.method === 'surface.list') return { ok: true, data: { surfaces: [{ panelId: 'panel-1', title: 'Main', surfaceKind: 'terminal' }], count: 1 } }
      if (request.method === 'pane.surfaces') return { ok: true, data: { paneId: params.paneId || 'panel-1', surfaces: [{ panelId: params.paneId || 'panel-1', title: 'Main', surfaceKind: 'terminal', selected: true }], count: 1 } }
      if (request.method === 'workspace.close' || request.method === 'surface.close') {
        return { ok: true, data: { closedPane: { panelId: params.panelId || params.paneId || 'panel-1', title: 'Closed' }, action: request.method } }
      }
      return { ok: true, data: { createdPane: { panelId: 'panel-new', title: params.title || 'New' }, action: request.method } }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'new-workspace', params: { title: 'Scratch', focus: false } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'current-workspace', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activePanelId: 'panel-1' }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'select-workspace', params: { panelId: 'panel-2' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'close-workspace', params: { panelId: 'panel-2' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'list-panels', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1 }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'list-pane-surfaces', params: { paneId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1 }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'close-surface', params: { paneId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'new-split', params: { surfaceId: 'panel-1', direction: 'below', focus: true } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'new-pane', params: { direction: 'right' } })).resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'workspace.create', params: expect.objectContaining({ title: 'Scratch' }) }),
      expect.objectContaining({ method: 'workspace.current' }),
      expect.objectContaining({ method: 'workspace.select', params: expect.objectContaining({ panelId: 'panel-2' }) }),
      expect.objectContaining({ method: 'workspace.close', params: expect.objectContaining({ panelId: 'panel-2' }) }),
      expect.objectContaining({ method: 'surface.list' }),
      expect.objectContaining({ method: 'pane.surfaces', params: expect.objectContaining({ paneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.close', params: expect.objectContaining({ paneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.split', params: expect.objectContaining({ surfaceId: 'panel-1', direction: 'below' }) }),
      expect.objectContaining({ method: 'surface.split', params: expect.objectContaining({ direction: 'right' }) })
    ])
    const workspaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'workspace' } })
    expect(workspaceEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'workspace.created' }), expect.objectContaining({ name: 'workspace.selected' }), expect.objectContaining({ name: 'workspace.closed' })]))
    const paneEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'pane' } })
    expect(paneEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'pane.created' }), expect.objectContaining({ name: 'pane.closed' })]))
  })

  it('routes control_compat-style surface operation aliases to the renderer', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'surface.health') return { ok: true, data: { surfaces: [{ panelId: 'panel-1', surfaceKind: 'terminal', mounted: true }], count: 1 } }
      if (request.method === 'workspace.move_to_window') return { ok: true, data: { unsupported: true, unsupportedReason: 'single window', workspaceId: params.workspaceId, windowId: params.windowId } }
      if (request.method === 'surface.action' || request.method === 'tab.action' || request.method === 'workspace.action') {
        return {
          ok: true,
          data: {
            surface: { panelId: params.surfaceId || params.panelId || params.workspaceId || 'panel-1', surfaceKind: 'terminal' },
            action: params.action,
            changed: true,
            createdSurface: params.action === 'new_terminal_right' ? { panelId: 'panel-new', surfaceKind: 'terminal' } : undefined
          }
        }
      }
      return {
        ok: true,
        data: {
          surface: { panelId: params.surfaceId || params.panelId || params.workspaceId || 'panel-1', surfaceKind: 'terminal' },
          movedSurface: { panelId: params.surfaceId || params.panelId || params.workspaceId || 'panel-1', surfaceKind: 'terminal' },
          action: request.method,
          changed: true,
          toIndex: params.index ?? 0
        }
      }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'move-surface', params: { surfaceId: 'panel-2', paneId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'reorder-surface', params: { surfaceId: 'panel-2', index: 0 } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'split-off', params: { surfaceId: 'panel-2' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'surface.drag_to_split', params: { surfaceId: 'panel-3', direction: 'right' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'refresh-surfaces', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'surface-health', params: {} })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1 }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'trigger-flash', params: { surfaceId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'reorder-workspace', params: { workspaceId: 'panel-2', index: 0 } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'reorder-workspaces', params: { workspaceIds: ['panel-2', 'panel-1'] } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'move-workspace-to-window', params: { workspaceId: 'panel-2', windowId: 'window-1' } })).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true }) }))
    await expect(backend.__testing.handleControlRequest({ method: 'surface.action', params: { surfaceId: 'panel-2', action: 'new_terminal_right' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'tab.action', params: { surfaceId: 'panel-2', action: 'close_others' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'workspace.action', params: { workspaceId: 'panel-2', action: 'rename', title: 'Ops' } })).resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'surface.move', params: expect.objectContaining({ surfaceId: 'panel-2', paneId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.reorder', params: expect.objectContaining({ surfaceId: 'panel-2', index: 0 }) }),
      expect.objectContaining({ method: 'surface.split_off', params: expect.objectContaining({ surfaceId: 'panel-2' }) }),
      expect.objectContaining({ method: 'surface.drag_to_split', params: expect.objectContaining({ surfaceId: 'panel-3', direction: 'right' }) }),
      expect.objectContaining({ method: 'surface.refresh' }),
      expect.objectContaining({ method: 'surface.health' }),
      expect.objectContaining({ method: 'surface.trigger_flash', params: expect.objectContaining({ surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'workspace.reorder', params: expect.objectContaining({ workspaceId: 'panel-2', index: 0 }) }),
      expect.objectContaining({ method: 'workspace.reorder_many', params: expect.objectContaining({ workspaceIds: ['panel-2', 'panel-1'] }) }),
      expect.objectContaining({ method: 'workspace.move_to_window', params: expect.objectContaining({ workspaceId: 'panel-2', windowId: 'window-1' }) }),
      expect.objectContaining({ method: 'surface.action', params: expect.objectContaining({ surfaceId: 'panel-2', action: 'new_terminal_right' }) }),
      expect.objectContaining({ method: 'tab.action', params: expect.objectContaining({ surfaceId: 'panel-2', action: 'close_others' }) }),
      expect.objectContaining({ method: 'workspace.action', params: expect.objectContaining({ workspaceId: 'panel-2', action: 'rename', title: 'Ops' }) })
    ])
    const surfaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'surface' } })
    expect(surfaceEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'surface.moved' }), expect.objectContaining({ name: 'surface.reordered' }), expect.objectContaining({ name: 'surface.split_off' }), expect.objectContaining({ name: 'surface.refreshed' }), expect.objectContaining({ name: 'surface.flashed' }), expect.objectContaining({ name: 'surface.actioned' })]))
    const workspaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'workspace' } })
    expect(workspaceEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'workspace.reordered' }), expect.objectContaining({ name: 'workspace.reordered_many' }), expect.objectContaining({ name: 'workspace.actioned' })]))
  })

  it('routes control_compat-style surface telemetry and create/focus primitives to the renderer', async () => {
    const backend = await loadBackend()
    backend.registerControlSocketIpc({
      handle: (_channel, handler) => {
        mockIpcHandler = handler
      }
    })
    mockWindow = createMockWindow((request) => {
      const params = (request.params as any) || {}
      if (request.method === 'surface.focus') {
        return { ok: true, data: { surface: { panelId: params.surfaceId || 'panel-1', surfaceKind: 'terminal' }, selectedPane: { panelId: params.surfaceId || 'panel-1', surfaceKind: 'terminal' }, action: 'surface.focus' } }
      }
      if (request.method === 'surface.create') {
        return { ok: true, data: { surface: { panelId: 'panel-new', surfaceKind: 'terminal' }, createdPane: { panelId: 'panel-new', surfaceKind: 'terminal', title: params.title || 'New' }, createdSurface: { panelId: 'panel-new', surfaceKind: 'terminal' }, action: 'surface.create' } }
      }
      if (request.method === 'pane.create') {
        return { ok: true, data: { pane: { panelId: 'panel-split', surfaceKind: 'terminal' }, createdPane: { panelId: 'panel-split', surfaceKind: 'terminal', title: params.title || 'Split' }, action: 'pane.create' } }
      }
      return {
        ok: true,
        data: {
          surface: { panelId: params.surfaceId || params.panelId || 'panel-1', surfaceKind: 'terminal' },
          action: request.method,
          ttyName: params.ttyName || params.tty_name,
          state: params.state,
          reason: params.reason || 'command',
          published: request.method === 'surface.report_shell_state',
          kicked: request.method === 'surface.ports_kick'
        }
      }
    })
    backend.configureControlSocketRuntime({ getWindows: () => [mockWindow] })

    await expect(backend.__testing.handleControlRequest({ method: 'surface.focus', params: { surfaceId: 'panel-1' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'surface.create', params: { title: 'Scratch', focus: true } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'pane.create', params: { surfaceId: 'panel-1', direction: 'below', title: 'Split' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'report-tty', params: { surfaceId: 'panel-1', ttyName: '/dev/pts/7' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'report-shell-state', params: { surfaceId: 'panel-1', state: 'prompt' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(backend.__testing.handleControlRequest({ method: 'ports-kick', params: { surfaceId: 'panel-1', reason: 'refresh' } })).resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(mockWindow.requests).toEqual([
      expect.objectContaining({ method: 'surface.focus', params: expect.objectContaining({ surfaceId: 'panel-1' }) }),
      expect.objectContaining({ method: 'surface.create', params: expect.objectContaining({ title: 'Scratch' }) }),
      expect.objectContaining({ method: 'pane.create', params: expect.objectContaining({ surfaceId: 'panel-1', direction: 'below' }) }),
      expect.objectContaining({ method: 'surface.report_tty', params: expect.objectContaining({ surfaceId: 'panel-1', ttyName: '/dev/pts/7' }) }),
      expect.objectContaining({ method: 'surface.report_shell_state', params: expect.objectContaining({ surfaceId: 'panel-1', state: 'prompt' }) }),
      expect.objectContaining({ method: 'surface.ports_kick', params: expect.objectContaining({ surfaceId: 'panel-1', reason: 'refresh' }) })
    ])
    const surfaceEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'surface' } })
    expect(surfaceEvents.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'surface.focused' }),
        expect.objectContaining({ name: 'surface.created' }),
        expect.objectContaining({ name: 'surface.tty_reported', payload: expect.objectContaining({ tty_name: '/dev/pts/7' }) }),
        expect.objectContaining({ name: 'surface.shell_state_reported', payload: expect.objectContaining({ state: 'prompt', published: true }) }),
        expect.objectContaining({ name: 'surface.ports_kicked', payload: expect.objectContaining({ reason: 'refresh', kicked: true }) })
      ])
    )
    const paneEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'pane' } })
    expect(paneEvents.data?.events).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'pane.created' })]))
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

    await expect(backend.__testing.handleControlRequest({ method: 'show-buffer', params: { name: 'deploy' } })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          text: deployCommand,
          buffer: expect.objectContaining({ name: 'deploy', size: deployBytes })
        })
      })
    )

    await expect(backend.__testing.handleControlRequest({ method: 'save-buffer', params: { name: 'deploy', path: '/tmp/deploy.txt' } })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          text: deployCommand,
          path: '/tmp/deploy.txt'
        })
      })
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

  it('stores tmux-compatible hooks and reports supported tmux options', async () => {
    const backend = await loadBackend()

    await expect(
      backend.__testing.handleControlRequest({
        method: 'set-hook',
        params: { event: 'after-split-window', command: 'display-message split' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          hook: expect.objectContaining({ event: 'after-split-window', command: 'display-message split' })
        })
      })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'tmux.hook.list', params: {} })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1, hooks: [expect.objectContaining({ event: 'after-split-window' })] }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'show-options', params: { option: 'extended-keys', valueOnly: true } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ name: 'extended-keys', value: 'on', valueOnly: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'show-options', params: { option: 'escape-time' } })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'TMUX_OPTION_UNSUPPORTED' })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'set-window-option', params: { option: 'automatic-rename', value: 'off' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ noop: true, accepted: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'popup', params: {} })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'TMUX_COMPAT_UNSUPPORTED',
        data: expect.objectContaining({ command: 'popup', unsupported: true })
      })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'set-hook', params: { event: 'after-split-window', unset: true } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ removed: true }) })
    )
    expect(backend.__testing.listTmuxCompatHooks()).toEqual([])

    const tmuxEvents = await backend.__testing.handleControlRequest({ method: 'events.list', params: { category: 'tmux' } })
    expect(tmuxEvents.data?.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'tmux.hook.set' }), expect.objectContaining({ name: 'tmux.hook.unset' })])
    )
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
      params: {
        title: 'Build done',
        subtitle: 'tests',
        body: 'All green',
        panelId: 'panel-1',
        sessionId: 'terminal-1',
        source: 'ci',
        level: 'success',
        group: 'build',
        key: 'project-main',
        action: 'done',
        url: 'https://example.test/build/1'
      }
    })
    const notification = created.data?.notification as Record<string, unknown>
    expect(created).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unreadCount: 1 }) }))
    expect(notification).toEqual(
      expect.objectContaining({
        title: 'Build done',
        panelId: 'panel-1',
        sessionId: 'terminal-1',
        source: 'ci',
        level: 'success',
        group: 'build',
        key: 'project-main',
        action: 'done',
        url: 'https://example.test/build/1',
        read: false
      })
    )
    expect(shown).toEqual([expect.objectContaining({ title: 'Build done', source: 'ci', level: 'success' })])

    await expect(backend.__testing.handleControlRequest({ method: 'notification.list', params: { unread: true, source: 'ci', level: 'success', group: 'build', query: 'project-main' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ count: 1, unreadCount: 1 }) })
    )

    const updated = await backend.__testing.handleControlRequest({
      method: 'notification.create',
      params: { title: 'Build failed', body: 'Unit test failed', source: 'ci', level: 'error', group: 'build', key: 'project-main' }
    })
    expect(updated).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          total: 1,
          unreadCount: 1,
          notification: expect.objectContaining({
            id: notification.id,
            title: 'Build failed',
            level: 'error',
            source: 'ci',
            group: 'build',
            key: 'project-main',
            panelId: 'panel-1',
            sessionId: 'terminal-1'
          })
        })
      })
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

  it('keeps notification key identity scoped by source and group tuples', async () => {
    const backend = await loadBackend()
    const sameFlattenedKey = await Promise.all([
      backend.__testing.handleControlRequest({ method: 'notification.create', params: { title: 'Tuple 1', source: 'ci:build', group: 'main', key: 'same' } }),
      backend.__testing.handleControlRequest({ method: 'notification.create', params: { title: 'Tuple 2', source: 'ci', group: 'build:main', key: 'same' } })
    ])
    expect(sameFlattenedKey.map((response) => response.data?.notification).map((item) => (item as Record<string, unknown>).id)).toEqual([expect.any(String), expect.any(String)])
    expect((sameFlattenedKey[0].data?.notification as Record<string, unknown>).id).not.toBe((sameFlattenedKey[1].data?.notification as Record<string, unknown>).id)
    await expect(backend.__testing.handleControlRequest({ method: 'notification.list', params: { query: 'Tuple' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ total: 2, count: 2 }) })
    )
  })

  it('creates control_compat-style targeted notifications for surfaces and targets', async () => {
    const backend = await loadBackend()
    const shown: Record<string, unknown>[] = []
    backend.configureControlSocketRuntime({
      showNotification: (notification) => shown.push(notification)
    })

    const surfaceNotification = await backend.__testing.handleControlRequest({
      method: 'notification.create_for_surface',
      params: { surface_id: 'panel-1', title: 'Needs review', body: 'approval pending' }
    })
    expect(surfaceNotification).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          targeted: true,
          surface_id: 'panel-1',
          workspace_id: 'main',
          notification: expect.objectContaining({ title: 'Needs review', panelId: 'panel-1', workspaceId: 'main' })
        })
      })
    )

    const targetNotification = await backend.__testing.handleControlRequest({
      method: 'notification.create_for_target',
      params: { workspace_id: 'main', surface_id: 'panel-2', title: 'Done' }
    })
    expect(targetNotification).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          targeted: true,
          surface_id: 'panel-2',
          notification: expect.objectContaining({ title: 'Done', panelId: 'panel-2', workspaceId: 'main' })
        })
      })
    )
    const callerNotification = await backend.__testing.handleControlRequest({
      method: 'notification.create_for_caller',
      params: { caller: { panelId: 'panel-3', workspaceId: 'main' }, title: 'Caller' }
    })
    expect(callerNotification).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          method: 'notification.create_for_caller',
          targeted: true,
          surface_id: 'panel-3',
          notification: expect.objectContaining({ title: 'Caller', panelId: 'panel-3', workspaceId: 'main' })
        })
      })
    )
    expect(shown).toEqual([expect.objectContaining({ panelId: 'panel-1' }), expect.objectContaining({ panelId: 'panel-2' }), expect.objectContaining({ panelId: 'panel-3' })])
    await expect(backend.__testing.handleControlRequest({ method: 'notification.create_for_surface', params: { title: 'Missing' } })).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'NOTIFICATION_SURFACE_REQUIRED' }))
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
      await waitForEventSubscriptionsToDrain(backend)
    } finally {
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('acknowledges control_compat-style mobile event subscription probes', async () => {
    const backend = await loadBackend()

    await expect(
      backend.__testing.handleControlRequest({
        method: 'mobile.events.subscribe',
        params: { stream_id: 'mobile-stream-1', topics: ['terminal.render_grid', 'workspace.updated'] }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          stream_id: 'mobile-stream-1',
          topics: ['terminal.render_grid', 'workspace.updated'],
          already_subscribed: false,
          event_stream_method: 'events.stream'
        })
      })
    )
    expect(backend.__testing.mobileEventSubscriptionCount()).toBe(1)
    expect(backend.__testing.listMobileEventSubscriptions()).toEqual([
      expect.objectContaining({ streamId: 'mobile-stream-1', topics: ['terminal.render_grid', 'workspace.updated'] })
    ])

    await expect(
      backend.__testing.handleControlRequest({
        method: 'mobile.events.subscribe',
        params: { stream_id: 'mobile-stream-1', topics: ['workspace.updated'] }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          stream_id: 'mobile-stream-1',
          topics: ['workspace.updated'],
          already_subscribed: true
        })
      })
    )
    expect(backend.__testing.listMobileEventSubscriptions()).toEqual([expect.objectContaining({ streamId: 'mobile-stream-1', topics: ['workspace.updated'] })])

    await expect(backend.__testing.handleControlRequest({ method: 'mobile.events.subscribe', params: { stream_id: 'missing-topics' } })).resolves.toEqual(
      expect.objectContaining({ ok: false, errorCode: 'INVALID_PARAMS' })
    )

    await expect(backend.__testing.handleControlRequest({ method: 'mobile.events.unsubscribe', params: { stream_id: 'mobile-stream-1' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ stream_id: 'mobile-stream-1', removed: true }) })
    )
    await expect(backend.__testing.handleControlRequest({ method: 'mobile.events.unsubscribe', params: { stream_id: 'mobile-stream-1' } })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ stream_id: 'mobile-stream-1', removed: false }) })
    )
    expect(backend.__testing.mobileEventSubscriptionCount()).toBe(0)
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
      const { flushControlSocketDurableEventLog } = await loadControlSocketStateRuntime()
      await flushControlSocketDurableEventLog()
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

      const { flushControlSocketDurableEventLog } = await loadControlSocketStateRuntime()
      await flushControlSocketDurableEventLog()
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

  it('accepts control_compat-style feed push, jump, and reply commands', async () => {
    const backend = await loadBackend()
    const agentSessions = await loadAgentSessionsBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-feed-compat-'))
    try {
      await backend.ensureControlSocketServer(root)
      await agentSessions.configureAiAgentSessionStore(root)

      const pushed = await backend.__testing.handleControlRequest({
        method: 'feed.push',
        params: {
          event: {
            source: 'claude-code',
            hook_event_name: 'PermissionRequest',
            session_id: 'claude-feed-compat-1',
            request_id: 'permission-request-1',
            wait_for_decision: true,
            actionable: true,
            panel_id: 'panel-feed',
            terminal_session_id: 'terminal-feed',
            cwd: '/work/feed',
            title: 'Feed approval',
            summary: 'Approve feed command',
            tool_name: 'Bash',
            raw_secret: 'do-not-return'
          },
          wait_timeout_seconds: 5
        }
      })
      expect(pushed).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            status: 'acknowledged',
            waited: false,
            unsupported_wait: true,
            request_id: 'permission-request-1',
            session_id: 'claude-feed-compat-1',
            session: expect.objectContaining({
              source: 'claude-code',
              sessionId: 'claude-feed-compat-1',
              state: 'needsInput',
              pendingRequestId: 'permission-request-1',
              panelId: 'panel-feed'
            })
          })
        })
      )
      expect(JSON.stringify(pushed)).not.toContain('raw_secret')
      expect(JSON.stringify(pushed)).not.toContain('do-not-return')

      await expect(backend.__testing.handleControlRequest({ method: 'feed.jump', params: { workstream_id: 'permission-request-1' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            workstream_id: 'permission-request-1',
            matched: true,
            panelId: 'panel-feed',
            session: expect.objectContaining({ sessionId: 'claude-feed-compat-1' })
          })
        })
      )

      await expect(
        backend.__testing.handleControlRequest({
          method: 'feed.permission.reply',
          params: { request_id: 'permission-request-1', mode: 'deny', message: 'Use staging first' }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            delivered: true,
            request_id: 'permission-request-1',
            kind: 'deny',
            mode: 'deny',
            needsInputCount: 0,
            session: expect.objectContaining({
              sessionId: 'claude-feed-compat-1',
              state: 'idle',
              decisions: [expect.objectContaining({ kind: 'deny', message: 'Use staging first' })]
            })
          })
        })
      )

      await backend.__testing.handleControlRequest({
        method: 'feed.push',
        params: {
          source: 'claude-code',
          event: 'question',
          session_id: 'claude-feed-question-1',
          request_id: 'question-request-1',
          wait_for_decision: true,
          actionable: true,
          summary: 'Which environment?'
        }
      })
      await expect(
        backend.__testing.handleControlRequest({
          method: 'feed.question.reply',
          params: { request_id: 'question-request-1', selections: ['staging', 'blue'] }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            delivered: true,
            kind: 'reply',
            session: expect.objectContaining({
              sessionId: 'claude-feed-question-1',
              decisions: [expect.objectContaining({ kind: 'reply', message: 'staging\nblue' })]
            })
          })
        })
      )

      await backend.__testing.handleControlRequest({
        method: 'feed.push',
        params: {
          source: 'claude-code',
          event: 'PermissionRequest',
          session_id: 'claude-feed-plan-1',
          request_id: 'plan-request-1',
          wait_for_decision: true,
          actionable: true,
          tool_name: 'ExitPlanMode',
          summary: 'Review implementation plan'
        }
      })
      await expect(
        backend.__testing.handleControlRequest({
          method: 'feed.exit_plan.reply',
          params: { request_id: 'plan-request-1', mode: 'bypassPermissions', feedback: 'Proceed' }
        })
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            delivered: true,
            kind: 'bypass',
            session: expect.objectContaining({
              sessionId: 'claude-feed-plan-1',
              decisions: [expect.objectContaining({ kind: 'bypass', message: 'Proceed' })]
            })
          })
        })
      )
    } finally {
      await agentSessions.__testing.flushManagedAiSessionWrites()
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exposes control_compat-style mobile chat sessions and actions for managed terminal agents', async () => {
    const backend = await loadBackend()
    const agentSessions = await loadAgentSessionsBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-mobile-chat-'))
    const writes: Array<{ sessionId: string; data: string }> = []
    try {
      await backend.ensureControlSocketServer(root)
      await agentSessions.configureAiAgentSessionStore(root)
      backend.configureControlSocketRuntime({
        writeTerminal: (sessionId, data) => {
          writes.push({ sessionId, data })
          return { ok: true, data: { id: sessionId, bytes: Buffer.byteLength(data, 'utf8') } }
        }
      })
      agentSessions.publishAiAgentSessionEvent(
        {
          source: 'claude-code',
          event: 'PermissionRequest',
          sessionId: 'claude-mobile-chat-1',
          requestId: 'mobile-request-1',
          waitForDecision: true,
          actionable: true,
          panelId: 'panel-mobile-ai',
          terminalSessionId: 'terminal-mobile-ai',
          workspaceId: 'main',
          cwd: '/work/mobile-chat',
          title: 'Deploy review',
          summary: 'Approve deploy command',
          toolName: 'Bash',
          raw_secret: 'do-not-return',
          receivedAt: 1717200000000
        },
        null
      )

      await expect(backend.__testing.handleControlRequest({ method: 'mobile.chat.sessions', params: { workspace_id: 'main' } })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            count: 1,
            needs_input_count: 1,
            sessions: [
              expect.objectContaining({
                session_id: 'claude-mobile-chat-1',
                agent_kind: 'claude',
                terminal_id: 'panel-mobile-ai',
                terminal_session_id: 'terminal-mobile-ai',
                cwd: '/work/mobile-chat',
                state: expect.objectContaining({ state: 'needs_input' })
              })
            ]
          })
        })
      )

      const history = await backend.__testing.handleControlRequest({ method: 'mobile.chat.history', params: { session_id: 'claude-mobile-chat-1', limit: 5 } })
      expect(history).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            source: 'managed-ai-events',
            messages: [
              expect.objectContaining({
                role: 'agent',
                kind: expect.objectContaining({ type: 'permission_request', subject: 'Approve deploy command' }),
                request_id: 'mobile-request-1'
              })
            ]
          })
        })
      )
      expect(JSON.stringify(history)).not.toContain('raw_secret')
      expect(JSON.stringify(history)).not.toContain('do-not-return')

      await expect(backend.__testing.handleControlRequest({ method: 'chat.sessions.dump' })).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            count: 1,
            sessions: [expect.objectContaining({ sessionId: 'claude-mobile-chat-1', descriptor: expect.objectContaining({ session_id: 'claude-mobile-chat-1' }) })]
          })
        })
      )
      await expect(
        backend.__testing.handleControlRequest({ method: 'mobile.chat.send', params: { session_id: 'claude-mobile-chat-1', text: 'Ship it' } })
      ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ sent: true, session_id: 'claude-mobile-chat-1' }) }))
      await expect(
        backend.__testing.handleControlRequest({ method: 'mobile.chat.interrupt', params: { session_id: 'claude-mobile-chat-1', hard: true } })
      ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ interrupted: true, hard: true }) }))
      await expect(
        backend.__testing.handleControlRequest({ method: 'mobile.chat.answer', params: { session_id: 'claude-mobile-chat-1', option_index: 1 } })
      ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ answered: true, option_index: 1 }) }))
      await expect(
        backend.__testing.handleControlRequest({ method: 'mobile.chat.send', params: { session_id: 'claude-mobile-chat-1', attachments: [{ data_b64: 'abc', format: 'png' }] } })
      ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'MOBILE_CHAT_ATTACHMENTS_UNSUPPORTED' }))

      expect(writes).toEqual([
        { sessionId: 'terminal-mobile-ai', data: '\x1b[200~Ship it\x1b[201~\r' },
        { sessionId: 'terminal-mobile-ai', data: '\x03' },
        { sessionId: 'terminal-mobile-ai', data: '2' }
      ])
    } finally {
      await agentSessions.__testing.flushManagedAiSessionWrites()
      backend.closeControlSocketServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates local-only control_compat-style mobile attach tickets', async () => {
    const backend = await loadBackend()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-control-attach-ticket-'))
    try {
      const socketPath = await backend.ensureControlSocketServer(root)
      const result = await backend.__testing.handleControlRequest({
        method: 'mobile.attach_ticket.create',
        params: { ttl_seconds: 5, workspace_id: 'main', terminal_id: 'panel-ai' }
      })
      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            ttl_seconds: 30,
            unsupported_remote: true,
            ticket: expect.objectContaining({
              version: 1,
              workspaceID: 'main',
              terminalID: 'panel-ai',
              auth_token: expect.any(String),
              routes: [expect.objectContaining({ id: 'local_control_socket', kind: 'websocket' })]
            }),
            routes: [
              expect.objectContaining({
                id: 'local_control_socket',
                endpoint: expect.objectContaining({ type: 'url', url: expect.stringContaining(encodeURIComponent(socketPath)) }),
                local_socket_path: socketPath
              })
            ]
          })
        })
      )
      expect((result.data?.ticket as Record<string, unknown>).auth_token).not.toHaveLength(0)
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
