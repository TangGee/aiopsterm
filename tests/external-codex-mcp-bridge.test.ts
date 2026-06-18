import { createConnection } from 'net'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-external-mcp-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}))

vi.mock('electron-store', () => {
  const stores = new Map<string, Record<string, unknown>>()

  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { name?: string; defaults?: T }) {
      const key = options?.name || 'default'
      if (!stores.has(key)) stores.set(key, JSON.parse(JSON.stringify(options?.defaults || {})))
      this.store = stores.get(key) as T
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore, __resetMockStores: () => stores.clear() }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store asset backend in tests')
})

type BridgeResponse = {
  id?: string
  ok: boolean
  errorCode?: string
  errorMessage?: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
}

type McpResponse = {
  jsonrpc: '2.0'
  id: string | number
  result?: {
    serverInfo?: Record<string, unknown>
    tools?: Array<Record<string, unknown>>
    content?: Array<{ type: string; text: string }>
    structuredContent?: BridgeResponse
    isError?: boolean
  }
  error?: {
    code: number
    message: string
  }
}

class MockSshChannel extends PassThrough {
  stderr = new PassThrough()
  writes: Array<string | Buffer> = []
  windows: Array<{ rows: number; cols: number; height: number; width: number }> = []
  closeCalls = 0

  override write(chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk))
    const done = typeof encoding === 'function' ? encoding : callback
    done?.()
    return true
  }

  setWindow(rows: number, cols: number, height: number, width: number) {
    this.windows.push({ rows, cols, height, width })
  }

  close() {
    this.closeCalls += 1
    this.emit('close')
  }
}

const createSshRuntime = (options: { manualReady?: boolean } = {}) => {
  const clients: Array<EventEmitter & { connect: (config: Record<string, unknown>) => void; shell: (options: Record<string, unknown>, callback: (error: Error | undefined, stream: MockSshChannel) => void) => void; end: () => void; endCalls: number }> = []
  const connectConfigs: Array<Record<string, unknown>> = []
  const channels: MockSshChannel[] = []
  const shellOptions: Array<Record<string, unknown>> = []

  class MockSshClient extends EventEmitter {
    endCalls = 0

    connect(config: Record<string, unknown>) {
      connectConfigs.push(config)
      if (options.manualReady) return
      queueMicrotask(() => this.emit('ready'))
    }

    shell(shellOptionsInput: Record<string, unknown>, callback: (error: Error | undefined, stream: MockSshChannel) => void) {
      shellOptions.push(shellOptionsInput)
      const channel = new MockSshChannel()
      channels.push(channel)
      queueMicrotask(() => callback(undefined, channel))
    }

    end() {
      this.endCalls += 1
      this.emit('end')
    }
  }

  return {
    runtime: {
      Client: class extends MockSshClient {
        constructor() {
          super()
          clients.push(this)
        }
      }
    },
    clients,
    connectConfigs,
    channels,
    shellOptions
  }
}

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition was not met')
}

const socketRequest = (socketPath: string, request: Record<string, unknown>) =>
  new Promise<BridgeResponse>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex)
      socket.end()
      try {
        resolve(JSON.parse(line) as BridgeResponse)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('external MCP bridge test socket timed out'))
    })
    socket.on('error', reject)
  })

const startExternalMcpScript = (socketPath: string, token: string) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'resources', 'aiopsterm-external-codex-mcp.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: socketPath,
      AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token
    },
    stdio: 'pipe'
  }) as ChildProcessWithoutNullStreams
  const pending = new Map<string, { resolve: (response: McpResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let buffer = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      const response = JSON.parse(line) as McpResponse
      const waiter = pending.get(String(response.id))
      if (!waiter) continue
      clearTimeout(waiter.timer)
      pending.delete(String(response.id))
      waiter.resolve(response)
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('exit', (code) => {
    for (const [id, waiter] of pending.entries()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`external MCP script exited before response ${id}: ${code}; stderr=${stderr}`))
    }
    pending.clear()
  })
  return {
    child,
    request: (message: Record<string, unknown>) =>
      new Promise<McpResponse>((resolve, reject) => {
        const id = Object.prototype.hasOwnProperty.call(message, 'id') ? String(message.id) : ''
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`external MCP response timed out for ${id}; stderr=${stderr}`))
        }, 5000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify(message)}\n`)
      })
  }
}

const loadBackends = async () => {
  vi.resetModules()
  const storeModule = (await import('electron-store')) as unknown as { __resetMockStores?: () => void }
  storeModule.__resetMockStores?.()
  const assetsModulePath = '../src/main/backend/assets'
  const sshTerminalModulePath = '../src/main/backend/sshTerminal'
  const bridgeModulePath = '../src/main/backend/externalCodexMcpBridge'
  const assets = await import(assetsModulePath)
  const sshTerminal = await import(sshTerminalModulePath)
  const bridge = await import(bridgeModulePath)
  assets.configureAssetBackendRuntime({ useSeedData: false, forceFallbackStore: true })
  sshTerminal.configureSshTerminalBackendRuntime()
  bridge.closeExternalCodexMcpBridgeServer()
  bridge.configureExternalCodexMcpBridgeRuntime({
    enabled: true,
    token: 'test-token'
  })
  return { assets, sshTerminal, bridge }
}

let activeBridge: Awaited<ReturnType<typeof loadBackends>>['bridge'] | null = null
let activeSshTerminal: Awaited<ReturnType<typeof loadBackends>>['sshTerminal'] | null = null

describe('external Codex MCP bridge runtime', () => {
  beforeEach(() => {
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET
  })

  afterEach(async () => {
    activeBridge?.closeExternalCodexMcpBridgeServer()
    activeSshTerminal?.configureSshTerminalBackendRuntime()
    activeBridge = null
    activeSshTerminal = null
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET
  })

  it('requires the external MCP feature flag and token before serving host data', async () => {
    const { bridge } = await loadBackends()
    activeBridge = bridge

    bridge.configureExternalCodexMcpBridgeRuntime({ enabled: false, token: 'test-token' })
    await expect(bridge.handleExternalCodexMcpBridgeRequest({ method: 'list_hosts', token: 'test-token' })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'EXTERNAL_CODEX_MCP_DISABLED'
      })
    )

    bridge.configureExternalCodexMcpBridgeRuntime({ enabled: true, token: 'test-token' })
    await expect(bridge.handleExternalCodexMcpBridgeRequest({ method: 'list_hosts', token: 'wrong-token' })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'EXTERNAL_CODEX_MCP_UNAUTHORIZED'
      })
    )
  })

  it('lists saved hosts without exposing stored secrets', async () => {
    const { assets, bridge } = await loadBackends()
    activeBridge = bridge
    const saved = assets.saveAsset({
      name: 'secret-host',
      title: 'Secret Host',
      host: '10.91.0.8',
      username: 'deploy',
      port: 2222,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['prod'],
      password: 'backend-secret'
    })

    const response = await bridge.handleExternalCodexMcpBridgeRequest({ method: 'list_hosts', token: 'test-token', params: { query: 'secret' } })

    expect(saved.ok).toBe(true)
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          hosts: [
            expect.objectContaining({
              assetId: saved.data!.id,
              host: '10.91.0.8',
              username: 'deploy',
              authMethods: ['password']
            })
          ]
        })
      })
    )
    expect(JSON.stringify(response)).not.toContain('backend-secret')
  })

  it('keeps external headless connections separate from terminal-owned sessions', async () => {
    const { assets, sshTerminal, bridge } = await loadBackends()
    activeBridge = bridge
    activeSshTerminal = sshTerminal
    const ssh = createSshRuntime()
    sshTerminal.configureSshTerminalBackendRuntime({
      ssh2Runtime: ssh.runtime as never,
      getAsset: (id: string) => assets.getAsset(id),
      getAssetSecret: (id: string) => assets.getAssetSecret(id),
      getKeychainSecret: () => ({}),
      getConfig: () => ({ sshProxyConfigs: [], sshAgentKeys: [], terminal: { sshAgentsStatus: false } })
    })
    const saved = assets.saveAsset({
      name: 'external-host',
      title: 'External Host',
      host: '10.91.0.9',
      username: 'root',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['external'],
      password: 'root-secret'
    })

    const connectResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'connect_host',
      token: 'test-token',
      params: { assetId: saved.data!.id, timeoutMs: 5000 }
    })
    expect(connectResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          connection: expect.objectContaining({
            connectionId: expect.stringMatching(/^mcp-/),
            owner: 'external_codex',
            visible: false,
            status: 'connected'
          })
        })
      })
    )
    const connectionId = (connectResponse.data?.connection as { connectionId: string }).connectionId

    const terminalDisconnect = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'disconnect_host',
      token: 'test-token',
      params: { connectionId: 'terminal-visible-1' }
    })
    expect(terminalDisconnect).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'TERMINAL_OWNED_CONNECTION'
      })
    )
    expect(ssh.clients[0].endCalls).toBe(0)

    const disconnectResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'disconnect_host',
      token: 'test-token',
      params: { connectionId }
    })
    expect(disconnectResponse).toEqual(expect.objectContaining({ ok: true, data: { connectionId, disconnected: true } }))
    expect(ssh.channels[0].closeCalls).toBe(1)
    expect(bridge.__getExternalCodexMcpConnectionCountForTests()).toBe(0)
  })

  it('runs marked commands through the external connection and captures output', async () => {
    const { assets, sshTerminal, bridge } = await loadBackends()
    activeBridge = bridge
    activeSshTerminal = sshTerminal
    const ssh = createSshRuntime()
    sshTerminal.configureSshTerminalBackendRuntime({
      ssh2Runtime: ssh.runtime as never,
      getAsset: (id: string) => assets.getAsset(id),
      getAssetSecret: (id: string) => assets.getAssetSecret(id),
      getKeychainSecret: () => ({}),
      getConfig: () => ({ sshProxyConfigs: [], sshAgentKeys: [], terminal: { sshAgentsStatus: false } })
    })
    const saved = assets.saveAsset({
      name: 'command-host',
      title: 'Command Host',
      host: '10.91.0.10',
      username: 'deploy',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['external'],
      password: 'deploy-secret'
    })
    const connectResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'connect_host',
      token: 'test-token',
      params: { assetId: saved.data!.id, timeoutMs: 5000 }
    })
    const connectionId = (connectResponse.data?.connection as { connectionId: string }).connectionId

    const responsePromise = bridge.handleExternalCodexMcpBridgeRequest({
      method: 'run_command',
      token: 'test-token',
      params: {
        connectionId,
        command: 'pwd',
        commandId: 'cmd-1',
        timeoutMs: 5000
      }
    })
    await waitFor(() => ssh.channels[0].writes.length === 1)
    expect(String(ssh.channels[0].writes[0])).toContain("echo '__AIOPSTERM_EXT_CODEX_START_cmd-1__'")
    expect(String(ssh.channels[0].writes[0])).toContain('pwd')

    bridge.appendExternalConnectionData(
      connectionId,
      ['__AIOPSTERM_EXT_CODEX_START_cmd-1__\r\n', '/home/deploy\r\n', '__AIOPSTERM_EXT_CODEX_END_cmd-1__:0\r\n'].join('')
    )
    const response = await responsePromise
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        target: expect.objectContaining({
          connectionId,
          owner: 'external_codex',
          visible: false,
          host: '10.91.0.10',
          username: 'deploy'
        }),
        data: expect.objectContaining({
          commandId: 'cmd-1',
          command: 'pwd',
          output: '/home/deploy',
          exitCode: 0
        })
      })
    )
  })

  it('serves socket bridge requests and the external stdio MCP tool list', async () => {
    const { assets, bridge } = await loadBackends()
    activeBridge = bridge
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-external-mcp-'))
    const socketPath = join(root, 'external.sock')
    const saved = assets.saveAsset({
      name: 'socket-host',
      title: 'Socket Host',
      host: '10.91.0.11',
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['socket'],
      password: 'ops-secret'
    })

    try {
      const actualSocket = await bridge.ensureExternalCodexMcpBridgeServer({
        enabled: true,
        token: 'test-token',
        socketPath,
        userDataPath: root
      })
      expect(actualSocket).toBe(socketPath)

      const socketResponse = await socketRequest(socketPath, { id: 'list-hosts', method: 'list_hosts', token: 'test-token', params: { query: 'socket' } })
      expect(socketResponse).toEqual(
        expect.objectContaining({
          id: 'list-hosts',
          ok: true,
          data: expect.objectContaining({
            hosts: [expect.objectContaining({ assetId: saved.data!.id, host: '10.91.0.11' })]
          })
        })
      )

      const mcp = startExternalMcpScript(socketPath, 'test-token')
      try {
        const initialize = await mcp.request({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-03-26' } })
        expect(initialize.result?.serverInfo).toEqual(expect.objectContaining({ name: 'aiopsterm-hosts' }))

        const tools = await mcp.request({ jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: {} })
        expect(tools.result?.tools?.map((tool) => tool.name)).toEqual([
          'list_hosts',
          'connect_host',
          'list_connections',
          'disconnect_host',
          'target_context',
          'run_command',
          'read_file',
          'glob_search',
          'grep_search'
        ])
        const runCommandTool = tools.result?.tools?.find((tool) => tool.name === 'run_command')
        expect(runCommandTool?.annotations).toEqual(expect.objectContaining({ destructiveHint: true }))
      } finally {
        mcp.child.kill()
      }
    } finally {
      bridge.closeExternalCodexMcpBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })
})
