import { createConnection } from 'net'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_MCP_TOOL_DEFINITIONS } from '../src/shared/databaseMcpRuntime'

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

const startExternalMcpScript = (socketPath: string, token: string, scope: string) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'resources', 'aiopsterm-external-codex-mcp.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: socketPath,
      AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE: scope
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
  const assetsModulePath = '../src/main/backend/assets/assets'
  const sshTerminalModulePath = '../src/main/backend/ssh/sshTerminal'
  const bridgeModulePath = '../src/main/backend/codex/externalCodexMcpBridge'
  const agentSessionsModulePath = '../src/main/backend/agent/agentSessions'
  const assets = await import(assetsModulePath)
  const sshTerminal = await import(sshTerminalModulePath)
  const bridge = await import(bridgeModulePath)
  const agentSessions = await import(agentSessionsModulePath)
  assets.configureAssetBackendRuntime({ useSeedData: false, forceFallbackStore: true })
  sshTerminal.configureSshTerminalBackendRuntime()
  agentSessions.closeAiAgentSessionServer()
  await agentSessions.configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-external-agent-sessions-')))
  bridge.closeExternalCodexMcpBridgeServer()
  bridge.configureExternalCodexMcpBridgeRuntime({
    enabled: true,
    token: 'test-token',
    focusManagedAiSession: undefined
  })
  return { assets, sshTerminal, bridge, agentSessions }
}

let activeBridge: Awaited<ReturnType<typeof loadBackends>>['bridge'] | null = null
let activeSshTerminal: Awaited<ReturnType<typeof loadBackends>>['sshTerminal'] | null = null
let activeAgentSessions: Awaited<ReturnType<typeof loadBackends>>['agentSessions'] | null = null

describe('external Codex MCP bridge runtime', () => {
  beforeEach(() => {
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN
    delete process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET
  })

  afterEach(async () => {
    activeBridge?.closeExternalCodexMcpBridgeServer()
    activeAgentSessions?.closeAiAgentSessionServer()
    activeSshTerminal?.configureSshTerminalBackendRuntime()
    await activeAgentSessions?.configureAiAgentSessionStore(await mkdtemp(join(tmpdir(), 'aiopsterm-external-agent-sessions-reset-')))
    activeBridge = null
    activeSshTerminal = null
    activeAgentSessions = null
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

  it('requires an explicit Export MCP database-read grant', async () => {
    const { bridge } = await loadBackends()
    activeBridge = bridge
    const databaseRuntimePath = '../src/shared/databaseRuntime'
    const databaseRuntime = await import(databaseRuntimePath)
    databaseRuntime.resetDatabaseBackendSeed()
    databaseRuntime.configureDatabaseRuntime({ useSeedData: true })
    bridge.configureExternalCodexMcpBridgeRuntime({
      getConfig: () => ({
        language: 'zh-CN',
        exportMcp: { allowAgentSshAuthSubmit: false, allowDatabaseRead: false }
      })
    })

    const disabled = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_database_connections',
      token: 'test-token',
      params: {}
    })
    expect(disabled).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'DB_MCP_DATABASE_READ_DISABLED',
        errorMessage: expect.stringContaining('设置 -> 导出 MCP'),
        data: expect.objectContaining({
          messageKey: 'externalMcp.database.readDisabled',
          settingsTarget: 'exportMcp',
          capability: 'databaseRead'
        })
      })
    )

    bridge.configureExternalCodexMcpBridgeRuntime({
      getConfig: () => {
        throw new Error('config unavailable')
      }
    })
    await expect(
      bridge.handleExternalCodexMcpBridgeRequest({
        method: 'list_database_connections',
        token: 'test-token',
        params: {}
      })
    ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'DB_MCP_DATABASE_READ_DISABLED' }))

    bridge.configureExternalCodexMcpBridgeRuntime({
      getConfig: () => ({
        language: 'zh-CN',
        exportMcp: { allowAgentSshAuthSubmit: false, allowDatabaseRead: true }
      })
    })
    const enabled = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_database_connections',
      token: 'test-token',
      params: { query: 'postgresql' }
    })
    const databaseConnection = (enabled.data?.connections as Array<Record<string, unknown>>)?.[0]
    const databaseConnectionId = String(databaseConnection?.connectionId || '')
    expect(enabled).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          connections: expect.arrayContaining([
            expect.objectContaining({
              connectionId: expect.stringMatching(/^db-[a-f0-9]{32}$/),
              label: 'postgresql / Production / 1',
              dbType: 'postgresql'
            })
          ])
        })
      })
    )
    expect(databaseConnectionId).not.toBe('conn-prod-pg')
    expect(JSON.stringify(enabled)).not.toContain('10.32.6.9')
    expect(JSON.stringify(enabled)).not.toContain('orders-postgres')

    const described = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'describe_database_table',
      token: 'test-token',
      params: {
        connectionId: databaseConnectionId,
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      }
    })
    expect(described).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          table: expect.objectContaining({
            path: 'orders.public.orders',
            primaryKey: ['id'],
            columns: expect.arrayContaining([expect.objectContaining({ name: 'id', type: 'bigint', key: 'PK' })])
          })
        })
      })
    )

    await expect(
      bridge.handleExternalCodexMcpBridgeRequest({
        method: 'describe_database_table',
        token: 'test-token',
        params: {
          connectionId: 'conn-prod-pg',
          databaseName: 'orders',
          schemaName: 'public',
          tableName: 'orders'
        }
      })
    ).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_CONNECTION_NOT_FOUND' })
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

  it('returns an i18n auth-required response when an external SSH connection needs keyboard-interactive input', async () => {
    const { assets, sshTerminal, bridge } = await loadBackends()
    activeBridge = bridge
    activeSshTerminal = sshTerminal
    const ssh = createSshRuntime({ manualReady: true })
    sshTerminal.configureSshTerminalBackendRuntime({
      ssh2Runtime: ssh.runtime as never,
      getAsset: (id: string) => assets.getAsset(id),
      getAssetSecret: (id: string) => assets.getAssetSecret(id),
      getKeychainSecret: () => ({}),
      getConfig: () => ({ sshProxyConfigs: [], sshAgentKeys: [], terminal: { sshAgentsStatus: false } })
    })
    bridge.configureExternalCodexMcpBridgeRuntime({
      getConfig: () => ({
        language: 'en-US',
        exportMcp: { allowAgentSshAuthSubmit: false, allowDatabaseRead: false }
      })
    })
    const saved = assets.saveAsset({
      name: 'mfa-host',
      title: 'MFA Host',
      host: '10.91.0.18',
      username: 'deploy',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['mfa']
    })

    const connectPromise = bridge.handleExternalCodexMcpBridgeRequest({
      method: 'connect_host',
      token: 'test-token',
      params: { assetId: saved.data!.id, timeoutMs: 5000 }
    })
    await waitFor(() => ssh.clients.length === 1)
    ssh.clients[0].emit(
      'keyboard-interactive',
      'Verification',
      'Enter verification code',
      '',
      [{ prompt: 'Code:', echo: false }],
      () => undefined
    )

    const connectResponse = await connectPromise

    expect(connectResponse).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'SSH_AUTH_REQUIRED',
        errorMessage: expect.stringContaining('aiopsterm'),
        data: expect.objectContaining({
          messageKey: 'externalMcp.auth.required.openAiopsterm',
          nextAction: 'OPEN_AIOPSTERM_AUTH_PROMPT',
          authRequestId: expect.stringContaining('keyboard'),
          agentSideAuthAvailable: true,
          agentSideAuthEnabled: false,
          authRequest: expect.objectContaining({
            connectionId: expect.stringMatching(/^mcp-/),
            host: '10.91.0.18',
            username: 'deploy',
            purpose: 'keyboard-interactive',
            prompts: [{ prompt: 'Code:', echo: false }]
          })
        })
      })
    )

    const listResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_auth_requests',
      token: 'test-token',
      params: {}
    })
    expect(listResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          authRequests: [expect.objectContaining({ status: 'pending', agentSideAuthEnabled: false })]
        })
      })
    )
  })

  it('gates external Agent SSH auth submission behind the Export MCP setting', async () => {
    const { assets, sshTerminal, bridge } = await loadBackends()
    activeBridge = bridge
    activeSshTerminal = sshTerminal
    const ssh = createSshRuntime({ manualReady: true })
    sshTerminal.configureSshTerminalBackendRuntime({
      ssh2Runtime: ssh.runtime as never,
      getAsset: (id: string) => assets.getAsset(id),
      getAssetSecret: (id: string) => assets.getAssetSecret(id),
      getKeychainSecret: () => ({}),
      getConfig: () => ({ sshProxyConfigs: [], sshAgentKeys: [], terminal: { sshAgentsStatus: false } })
    })
    const saved = assets.saveAsset({
      name: 'agent-auth-host',
      title: 'Agent Auth Host',
      host: '10.91.0.19',
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['agent-auth']
    })

    let finishResponses: string[] = []
    bridge.configureExternalCodexMcpBridgeRuntime({
      getConfig: () => ({
        language: 'en-US',
        exportMcp: { allowAgentSshAuthSubmit: false, allowDatabaseRead: false }
      })
    })
    const connectPromise = bridge.handleExternalCodexMcpBridgeRequest({
      method: 'connect_host',
      token: 'test-token',
      params: { assetId: saved.data!.id, timeoutMs: 5000 }
    })
    await waitFor(() => ssh.clients.length === 1)
    ssh.clients[0].emit(
      'keyboard-interactive',
      'Verification',
      'Enter verification code',
      '',
      [{ prompt: 'Code:', echo: false }],
      (responses: string[]) => {
        finishResponses = responses
      }
    )
    const connectResponse = await connectPromise
    const authRequestId = String(connectResponse.data?.authRequestId || '')

    const disabledSubmit = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'submit_ssh_auth_response',
      token: 'test-token',
      params: { authRequestId, response: '123456' }
    })
    expect(disabledSubmit).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'AGENT_SIDE_AUTH_DISABLED',
        errorMessage: expect.stringContaining('Settings -> Export MCP'),
        data: expect.objectContaining({
          messageKey: 'externalMcp.auth.agentSubmitDisabled',
          settingsTarget: 'exportMcp'
        })
      })
    )
    expect(finishResponses).toEqual([])

    bridge.configureExternalCodexMcpBridgeRuntime({
      getConfig: () => ({
        language: 'en-US',
        exportMcp: { allowAgentSshAuthSubmit: true, allowDatabaseRead: false }
      })
    })
    const enabledSubmit = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'submit_ssh_auth_response',
      token: 'test-token',
      params: { authRequestId, response: '123456' }
    })
    expect(enabledSubmit).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          messageKey: 'externalMcp.auth.submitted',
          submitted: true
        })
      })
    )
    expect(finishResponses).toEqual(['123456'])

    ssh.clients[0].emit('ready')
    await waitFor(() => ssh.channels.length === 1)
    const connections = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_connections',
      token: 'test-token',
      params: {}
    })
    expect(connections.data?.connections).toEqual([expect.objectContaining({ status: 'connected', assetId: saved.data!.id })])
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
    expect(String(ssh.channels[0].writes[0])).toContain('if "${SHELL:-sh}" -c')
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

  it('exposes managed AI sessions to external Codex MCP without owning visible terminals', async () => {
    const { bridge, agentSessions } = await loadBackends()
    activeBridge = bridge
    activeAgentSessions = agentSessions
    const focusRequests: Array<Record<string, unknown>> = []
    bridge.configureExternalCodexMcpBridgeRuntime({
      enabled: true,
      token: 'test-token',
      focusManagedAiSession: (request: unknown) => focusRequests.push(request as Record<string, unknown>)
    })
    expect(
      agentSessions.publishAiAgentSessionEvent(
        {
          source: 'codex',
          event: 'PermissionRequest',
          sessionId: 'codex-managed-1',
          requestId: 'approve-1',
          title: 'Codex · api-service',
          summary: 'approve npm test',
          cwd: '/work/api-service',
          panelId: 'panel-1',
          terminalSessionId: 'terminal-1',
          receivedAt: 700
        },
        null
      )
    ).toEqual(expect.objectContaining({ ok: true }))
    await expect(agentSessions.listManagedAiSessions()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          sessions: [expect.objectContaining({ id: 'codex-managed-1', source: 'codex' })]
        })
      })
    )

    const listResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_ai_sessions',
      token: 'test-token',
      params: { needsInput: true, includeEvents: true }
    })
    expect(listResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          needsInputCount: 1,
          sessions: [
            expect.objectContaining({
              source: 'codex',
              sessionId: 'codex-managed-1',
              state: 'needsInput',
              needsInput: true,
              requestKind: 'permission'
            })
          ]
        })
      })
    )

    const allSessionsResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_ai_sessions',
      token: 'test-token',
      params: { includeEvents: true }
    })
    expect(allSessionsResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          needsInputCount: 1,
          sessions: [
            expect.objectContaining({
              source: 'codex',
              sessionId: 'codex-managed-1',
              title: 'Codex · api-service',
              summary: 'approve npm test',
              state: 'needsInput',
              needsInput: true,
              requestKind: 'permission',
              decisionMode: 'local',
              actionable: true,
              panelId: 'panel-1',
              terminalSessionId: 'terminal-1',
              eventCount: 1,
              events: [expect.objectContaining({ event: 'permission_request', summary: 'approve npm test', requestKind: 'permission', decisionMode: 'local' })]
            })
          ]
        })
      })
    )
    expect(JSON.stringify(listResponse)).not.toContain('raw')

    const detailResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'get_ai_session',
      token: 'test-token',
      params: { source: 'codex', sessionId: 'codex-managed-1', eventLimit: 10 }
    })
    expect(detailResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({
            source: 'codex',
            sessionId: 'codex-managed-1',
            eventCount: 1,
            events: [expect.objectContaining({ event: 'permission_request', summary: 'approve npm test' })]
          })
        })
      })
    )
    expect(JSON.stringify(detailResponse)).not.toContain('raw')

    await expect(
      bridge.handleExternalCodexMcpBridgeRequest({
        method: 'get_ai_session',
        token: 'test-token',
        params: { source: 'codex', sessionId: 'missing-session' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: false, errorCode: 'AI_SESSION_NOT_FOUND' }))

    const focusResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'focus_ai_session',
      token: 'test-token',
      params: { source: 'codex', sessionId: 'codex-managed-1' }
    })
    expect(focusResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ focusRequested: true }) }))
    expect(focusRequests).toEqual([
      {
        source: 'codex',
        sessionId: 'codex-managed-1',
        panelId: 'panel-1',
        terminalSessionId: 'terminal-1'
      }
    ])

    const replyResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'reply_ai_session',
      token: 'test-token',
      params: { source: 'codex', sessionId: 'codex-managed-1', kind: 'handled', message: 'done' }
    })
    expect(replyResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({
            sessionId: 'codex-managed-1',
            state: 'idle',
            needsInput: false
          }),
          needsInputCount: 0
        })
      })
    )

    const clearResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'clear_ai_session',
      token: 'test-token',
      params: { source: 'codex', sessionId: 'codex-managed-1' }
    })
    expect(clearResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ cleared: true, count: 0 }) }))
  })

  it('exposes feed-style managed AI approvals through external Codex MCP aliases', async () => {
    const { bridge, agentSessions } = await loadBackends()
    activeBridge = bridge
    activeAgentSessions = agentSessions
    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'PermissionRequest',
        sessionId: 'claude-approval-1',
        requestId: 'claude-permission-1',
        actionable: true,
        title: 'Claude Code · deploy',
        summary: 'run deploy script',
        cwd: '/work/deploy',
        toolName: 'Bash',
        panelId: 'panel-approval',
        terminalSessionId: 'terminal-approval',
        receivedAt: 820
      },
      null
    )
    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PermissionRequest',
        sessionId: 'codex-local-approval-1',
        requestId: 'codex-permission-1',
        title: 'Codex · api-service',
        summary: 'approve npm test',
        cwd: '/work/api-service',
        receivedAt: 830
      },
      null
    )

    const listResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_ai_approvals',
      token: 'test-token',
      params: { includeEvents: true }
    })
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
              approvalId: 'managed-ai:claude-code:claude-approval-1',
              source: 'claude-code',
              sessionId: 'claude-approval-1',
              state: 'needsInput',
              pending: true,
              approvalKind: 'permission',
              decisionMode: 'blocking',
              capabilities: expect.objectContaining({
                decisions: ['allow', 'always', 'bypass', 'deny', 'handled'],
                canUnblockAgent: true,
                localOnly: false,
                nativePrompt: false
              }),
              events: [expect.objectContaining({ requestKind: 'permission', decisionMode: 'blocking' })]
            }),
            expect.objectContaining({
              approvalId: 'managed-ai:codex:codex-local-approval-1',
              source: 'codex',
              sessionId: 'codex-local-approval-1',
              state: 'needsInput',
              pending: true,
              approvalKind: 'permission',
              decisionMode: 'local',
              capabilities: expect.objectContaining({
                decisions: ['handled'],
                canUnblockAgent: false,
                localOnly: true,
                nativePrompt: true
              })
            })
          ])
        })
      })
    )
    expect(JSON.stringify(listResponse)).not.toContain('raw')

    const approveResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'approve_ai_session',
      token: 'test-token',
      params: { source: 'claude-code', sessionId: 'claude-approval-1', mode: 'always' }
    })
    expect(approveResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          decisionKind: 'always',
          approval: expect.objectContaining({
            sessionId: 'claude-approval-1',
            state: 'idle',
            needsInput: false
          }),
          needsInputCount: 1
        })
      })
    )

    const unsupportedCodexApproval = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'approve_ai_session',
      token: 'test-token',
      params: { source: 'codex', sessionId: 'codex-local-approval-1', mode: 'allow' }
    })
    expect(unsupportedCodexApproval).toEqual(
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

    const handledCodexApproval = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'handle_ai_session',
      token: 'test-token',
      params: { source: 'codex', sessionId: 'codex-local-approval-1', message: 'handled in Codex TUI' }
    })
    expect(handledCodexApproval).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          decisionKind: 'handled',
          approval: expect.objectContaining({
            source: 'codex',
            sessionId: 'codex-local-approval-1',
            capabilities: expect.objectContaining({ decisions: ['handled'], nativePrompt: true })
          })
        })
      })
    )
  })

  it('answers and denies managed AI approval aliases through the external Codex MCP bridge', async () => {
    const { bridge, agentSessions } = await loadBackends()
    activeBridge = bridge
    activeAgentSessions = agentSessions
    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'AskUserQuestion',
        sessionId: 'claude-question-approval-1',
        requestId: 'claude-question-1',
        actionable: true,
        title: 'Claude Code · release',
        summary: 'choose release window',
        cwd: '/work/release',
        receivedAt: 840
      },
      null
    )
    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'claude-code',
        event: 'PermissionRequest',
        sessionId: 'claude-deny-approval-1',
        requestId: 'claude-deny-1',
        actionable: true,
        title: 'Claude Code · database',
        summary: 'drop staging database',
        cwd: '/work/database',
        receivedAt: 850
      },
      null
    )

    const missingAnswer = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'answer_ai_question',
      token: 'test-token',
      params: { source: 'claude-code', sessionId: 'claude-question-approval-1' }
    })
    expect(missingAnswer).toEqual(expect.objectContaining({ ok: false, errorCode: 'AI_APPROVAL_MESSAGE_REQUIRED' }))

    const answerResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'answer_ai_question',
      token: 'test-token',
      params: { source: 'claude-code', sessionId: 'claude-question-approval-1', answer: 'Friday night' }
    })
    expect(answerResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          decisionKind: 'reply',
          approval: expect.objectContaining({
            source: 'claude-code',
            sessionId: 'claude-question-approval-1',
            approvalKind: 'question',
            state: 'idle'
          })
        })
      })
    )

    const denyResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'deny_ai_session',
      token: 'test-token',
      params: { source: 'claude-code', sessionId: 'claude-deny-approval-1', message: 'too destructive' }
    })
    expect(denyResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          decisionKind: 'deny',
          approval: expect.objectContaining({
            source: 'claude-code',
            sessionId: 'claude-deny-approval-1',
            approvalKind: 'permission',
            state: 'idle'
          }),
          needsInputCount: 0
        })
      })
    )
  })

  it('returns managed AI session event frames through external Codex MCP cursors', async () => {
    const { bridge, agentSessions } = await loadBackends()
    activeBridge = bridge
    activeAgentSessions = agentSessions
    const afterSeq = agentSessions.__testing.streamLatestSeq()
    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PermissionRequest',
        sessionId: 'codex-event-cursor-1',
        requestId: 'cursor-approve-1',
        summary: 'approve build',
        panelId: 'panel-cursor',
        terminalSessionId: 'terminal-cursor',
        receivedAt: 800
      },
      null
    )

    const response = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_ai_session_events',
      token: 'test-token',
      params: { afterSeq, source: 'codex', limit: 10 }
    })
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          protocol: 'aiopsterm-agent-events',
          boot_id: expect.any(String),
          after_seq: afterSeq,
          latest_seq: expect.any(Number),
          count: 1,
          events: [
            expect.objectContaining({
              name: 'agent.hook.PermissionRequest',
              category: 'agent',
              source: 'codex',
              payload: expect.objectContaining({
                sessionId: 'codex-event-cursor-1',
                state: 'needsInput',
                requestKind: 'permission',
                decisionMode: 'local',
                actionable: true
              })
            })
          ]
        })
      })
    )
  })

  it('exposes managed AI notifications through external Codex MCP', async () => {
    const { bridge, agentSessions } = await loadBackends()
    activeBridge = bridge
    activeAgentSessions = agentSessions
    const focusRequests: Array<Record<string, unknown>> = []
    bridge.configureExternalCodexMcpBridgeRuntime({
      enabled: true,
      token: 'test-token',
      focusManagedAiSession: (request: unknown) => focusRequests.push(request as Record<string, unknown>)
    })
    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'Question',
        sessionId: 'codex-notification-mcp-1',
        requestId: 'question-1',
        actionable: true,
        title: 'Codex · rollout',
        summary: 'choose deployment window',
        cwd: '/work/rollout',
        panelId: 'panel-notification-mcp',
        terminalSessionId: 'terminal-notification-mcp',
        receivedAt: 900
      },
      null
    )

    const listResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'list_ai_notifications',
      token: 'test-token',
      params: { unread: true }
    })
    expect(listResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          unreadCount: 1,
          notifications: [
            expect.objectContaining({
              id: 'managed-ai:codex:codex-notification-mcp-1',
              source: 'codex',
              sessionId: 'codex-notification-mcp-1',
              read: false,
              needsInput: true,
              requestKind: 'question',
              decisionMode: 'local',
              panelId: 'panel-notification-mcp',
              terminalSessionId: 'terminal-notification-mcp'
            })
          ]
        })
      })
    )
    expect(JSON.stringify(listResponse)).not.toContain('raw')

    const openResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'open_ai_notification',
      token: 'test-token',
      params: { id: 'managed-ai:codex:codex-notification-mcp-1' }
    })
    expect(openResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          focusRequested: true,
          focusRequest: {
            source: 'codex',
            sessionId: 'codex-notification-mcp-1',
            panelId: 'panel-notification-mcp',
            terminalSessionId: 'terminal-notification-mcp'
          }
        })
      })
    )
    expect(focusRequests).toEqual([
      {
        source: 'codex',
        sessionId: 'codex-notification-mcp-1',
        panelId: 'panel-notification-mcp',
        terminalSessionId: 'terminal-notification-mcp'
      }
    ])

    const markResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'mark_ai_notification_read',
      token: 'test-token',
      params: { id: 'managed-ai:codex:codex-notification-mcp-1' }
    })
    expect(markResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          notification: expect.objectContaining({
            id: 'managed-ai:codex:codex-notification-mcp-1',
            read: true,
            needsInput: false
          }),
          unreadCount: 0
        })
      })
    )

    const dismissResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'dismiss_ai_notification',
      token: 'test-token',
      params: { allRead: true }
    })
    expect(dismissResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          count: 0,
          unreadCount: 0
        })
      })
    )

    agentSessions.publishAiAgentSessionEvent(
      {
        source: 'codex',
        event: 'PermissionRequest',
        sessionId: 'codex-notification-clear-mcp-1',
        actionable: true,
        summary: 'approve prod deploy',
        receivedAt: 910
      },
      null
    )
    const clearResponse = await bridge.handleExternalCodexMcpBridgeRequest({
      method: 'clear_ai_notifications',
      token: 'test-token',
      params: {}
    })
    expect(clearResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          changed: 1,
          count: 0,
          unreadCount: 0,
          notifications: []
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

      const mcp = startExternalMcpScript(socketPath, 'test-token', 'hosts')
      try {
        const initialize = await mcp.request({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-03-26' } })
        expect(initialize.result?.serverInfo).toEqual(expect.objectContaining({ name: 'aiopsterm-hosts' }))

        const tools = await mcp.request({ jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: {} })
        expect(tools.result?.tools?.map((tool) => tool.name)).toEqual([
          'list_hosts',
          'connect_host',
          'list_connections',
          'disconnect_host',
          'list_auth_requests',
          'get_auth_request_status',
          'focus_auth_request',
          'cancel_auth_request',
          'submit_ssh_auth_response',
          'target_context',
          'run_command',
          'read_file',
          'glob_search',
          'grep_search'
        ])
        const runCommandTool = tools.result?.tools?.find((tool) => tool.name === 'run_command')
        expect(runCommandTool?.annotations).toEqual(expect.objectContaining({ destructiveHint: true }))

        const aiMcp = startExternalMcpScript(socketPath, 'test-token', 'ai-sessions')
        const databaseMcp = startExternalMcpScript(socketPath, 'test-token', 'databases')
        try {
          const aiInitialize = await aiMcp.request({ jsonrpc: '2.0', id: 'ai-init', method: 'initialize', params: {} })
          expect(aiInitialize.result?.serverInfo).toEqual(expect.objectContaining({ name: 'aiopsterm-ai-sessions' }))
          const aiTools = await aiMcp.request({ jsonrpc: '2.0', id: 'ai-tools', method: 'tools/list', params: {} })
          expect(aiTools.result?.tools?.map((tool) => tool.name)).toEqual([
          'list_ai_sessions',
          'get_ai_session',
          'list_ai_approvals',
          'focus_ai_session',
          'reply_ai_session',
          'approve_ai_session',
          'deny_ai_session',
          'answer_ai_question',
          'handle_ai_session',
          'clear_ai_session',
          'list_ai_session_events',
          'list_ai_notifications',
          'mark_ai_notification_read',
          'dismiss_ai_notification',
          'clear_ai_notifications',
          'open_ai_notification',
          'jump_to_unread_ai_notification'
          ])
          const listAiSessionsTool = aiTools.result?.tools?.find((tool) => tool.name === 'list_ai_sessions')
          expect(listAiSessionsTool?.annotations).toEqual(expect.objectContaining({ readOnlyHint: true }))
          const clearAiSessionTool = aiTools.result?.tools?.find((tool) => tool.name === 'clear_ai_session')
          expect(clearAiSessionTool?.annotations).toEqual(expect.objectContaining({ destructiveHint: true }))

          const databaseInitialize = await databaseMcp.request({ jsonrpc: '2.0', id: 'database-init', method: 'initialize', params: {} })
          expect(databaseInitialize.result?.serverInfo).toEqual(expect.objectContaining({ name: 'aiopsterm-databases' }))
          const databaseTools = await databaseMcp.request({ jsonrpc: '2.0', id: 'database-tools', method: 'tools/list', params: {} })
          expect(databaseTools.result?.tools?.map((tool) => tool.name)).toEqual([
          'list_database_connections',
          'list_databases',
          'list_schemas',
          'list_tables',
          'search_database_objects',
          'describe_database_table',
          'get_database_table_ddl',
          'query_database_table',
          'sample_rows',
          'count_rows',
          'inspect_indexes',
          'explain_plan'
          ])
          expect(databaseTools.result?.tools).toEqual(DATABASE_MCP_TOOL_DEFINITIONS)
          const queryDatabaseTableTool = databaseTools.result?.tools?.find((tool) => tool.name === 'query_database_table')
          expect(queryDatabaseTableTool?.annotations).toEqual(
            expect.objectContaining({ readOnlyHint: true, destructiveHint: false, openWorldHint: true })
          )
          expect((queryDatabaseTableTool?.inputSchema as any)?.properties?.page).toEqual(expect.objectContaining({ maximum: 1000 }))

          const crossScope = await mcp.request({
            jsonrpc: '2.0',
            id: 'cross-scope',
            method: 'tools/call',
            params: { name: 'list_ai_sessions', arguments: {} }
          })
          expect(crossScope.result?.isError).toBe(true)
        } finally {
          aiMcp.child.kill()
          databaseMcp.child.kill()
        }
      } finally {
        mcp.child.kill()
      }
      const invalidMcp = startExternalMcpScript(socketPath, 'test-token', 'all')
      try {
        const invalidInitialize = await invalidMcp.request({ jsonrpc: '2.0', id: 'invalid-init', method: 'initialize', params: {} })
        expect(invalidInitialize.error).toEqual(expect.objectContaining({ code: -32602 }))
      } finally {
        invalidMcp.child.kill()
      }
    } finally {
      bridge.closeExternalCodexMcpBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps serving after a socket client disconnects before its response is written', async () => {
    const { assets, sshTerminal, bridge } = await loadBackends()
    activeBridge = bridge
    activeSshTerminal = sshTerminal
    const ssh = createSshRuntime({ manualReady: true })
    sshTerminal.configureSshTerminalBackendRuntime({
      ssh2Runtime: ssh.runtime as never,
      getAsset: (id: string) => assets.getAsset(id),
      getAssetSecret: (id: string) => assets.getAssetSecret(id),
      getKeychainSecret: () => ({}),
      getConfig: () => ({ sshProxyConfigs: [], sshAgentKeys: [], terminal: { sshAgentsStatus: false } })
    })
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-external-mcp-disconnect-'))
    const socketPath = join(root, 'external.sock')
    const saved = assets.saveAsset({
      name: 'disconnect-host',
      title: 'Disconnect Host',
      host: '10.91.0.21',
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['disconnect'],
      password: 'ops-secret'
    })

    try {
      await bridge.ensureExternalCodexMcpBridgeServer({
        enabled: true,
        token: 'test-token',
        socketPath,
        userDataPath: root
      })

      const client = createConnection(socketPath)
      client.on('error', () => undefined)
      await new Promise<void>((resolve) => client.on('connect', () => resolve()))
      client.write(
        `${JSON.stringify({ id: 'connect-drop', method: 'connect_host', token: 'test-token', params: { assetId: saved.data!.id, timeoutMs: 1000 } })}\n`
      )
      await waitFor(() => ssh.clients.length === 1)
      client.destroy()

      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(bridge.__getExternalCodexMcpConnectionCountForTests()).toBe(0)

      const listResponse = await socketRequest(socketPath, {
        id: 'list-hosts-after-drop',
        method: 'list_hosts',
        token: 'test-token',
        params: { query: 'disconnect' }
      })
      expect(listResponse).toEqual(
        expect.objectContaining({
          id: 'list-hosts-after-drop',
          ok: true,
          data: expect.objectContaining({
            hosts: [expect.objectContaining({ assetId: saved.data!.id })]
          })
        })
      )
    } finally {
      bridge.closeExternalCodexMcpBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses a stable default socket path across app restarts', async () => {
    const { bridge } = await loadBackends()
    activeBridge = bridge
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-external-mcp-stable-'))
    const expectedSocket = process.platform === 'win32' ? '\\\\.\\pipe\\aiopsterm-external-codex' : join(root, 'external-codex-mcp', 'aiopsterm-external-codex.sock')

    try {
      const firstSocket = await bridge.ensureExternalCodexMcpBridgeServer({
        enabled: true,
        token: 'test-token',
        userDataPath: root
      })
      expect(firstSocket).toBe(expectedSocket)

      bridge.closeExternalCodexMcpBridgeServer()

      const secondSocket = await bridge.ensureExternalCodexMcpBridgeServer({
        enabled: true,
        token: 'test-token',
        userDataPath: root
      })
      expect(secondSocket).toBe(firstSocket)
    } finally {
      bridge.closeExternalCodexMcpBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })
})
