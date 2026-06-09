import { generateKeyPairSync } from 'crypto'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class MockSocket extends PassThrough {
  writes: Buffer[] = []
  destroyedFlag = false
  remoteAddress?: string
  remotePort?: number

  constructor(options: { remoteAddress?: string; remotePort?: number } = {}) {
    super()
    this.remoteAddress = options.remoteAddress || '127.0.0.1'
    this.remotePort = options.remotePort || 55000
  }

  override write(chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    const buffer = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8')
    this.writes.push(buffer)
    const done = typeof encoding === 'function' ? encoding : callback
    done?.()
    return true
  }

  override end(chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void): this {
    if (chunk !== undefined) this.write(chunk, typeof encoding === 'string' ? encoding : undefined)
    const done = typeof encoding === 'function' ? encoding : callback
    done?.()
    this.emit('close')
    return this
  }

  override destroy(error?: Error): this {
    if (!this.destroyedFlag) {
      this.destroyedFlag = true
      this.emit('close', error)
    }
    return this
  }
}

class MockServer extends EventEmitter {
  listenOptions: Record<string, unknown>[] = []
  closeCalls = 0

  constructor(private handler: (socket: MockSocket) => void) {
    super()
  }

  listen(options: Record<string, unknown>) {
    this.listenOptions.push(options)
    queueMicrotask(() => {
      if (netRuntime.failListen) this.emit('error', netRuntime.failListen)
      else this.emit('listening')
    })
    return this
  }

  close(callback?: () => void) {
    this.closeCalls += 1
    callback?.()
    this.emit('close')
    return this
  }

  simulateConnection(socket = new MockSocket()) {
    this.handler(socket)
    return socket
  }
}

const ssh2Runtime = {
  clients: [] as EventEmitter[],
  connectConfigs: [] as Array<Record<string, unknown>>,
  forwardOutCalls: [] as Array<Record<string, unknown>>,
  forwardInCalls: [] as Array<Record<string, unknown>>,
  unforwardInCalls: [] as Array<Record<string, unknown>>,
  endCalls: 0,
  failConnect: null as Error | null,
  failForwardOut: null as Error | null,
  failForwardIn: null as Error | null,
  reset() {
    this.clients.length = 0
    this.connectConfigs.length = 0
    this.forwardOutCalls.length = 0
    this.forwardInCalls.length = 0
    this.unforwardInCalls.length = 0
    this.endCalls = 0
    this.failConnect = null
    this.failForwardOut = null
    this.failForwardIn = null
  },
  Client: class MockSshClient extends EventEmitter {
    constructor() {
      super()
      ssh2Runtime.clients.push(this)
    }

    connect(config: Record<string, unknown>) {
      ssh2Runtime.connectConfigs.push(config)
      queueMicrotask(() => {
        if (ssh2Runtime.failConnect) this.emit('error', ssh2Runtime.failConnect)
        else this.emit('ready')
      })
    }

    forwardOut(
      srcHost: string,
      srcPort: number,
      dstHost: string,
      dstPort: number,
      callback: (error: Error | null, stream?: PassThrough) => void
    ) {
      ssh2Runtime.forwardOutCalls.push({ srcHost, srcPort, dstHost, dstPort })
      if (ssh2Runtime.failForwardOut) callback(ssh2Runtime.failForwardOut)
      else callback(null, new PassThrough())
    }

    forwardIn(host: string, port: number, callback: (error?: Error | null) => void) {
      ssh2Runtime.forwardInCalls.push({ host, port })
      callback(ssh2Runtime.failForwardIn)
    }

    unforwardIn(host: string, port: number, callback: (error?: Error | null) => void) {
      ssh2Runtime.unforwardInCalls.push({ host, port })
      callback(null)
    }

    end() {
      ssh2Runtime.endCalls += 1
      this.emit('close')
    }
  }
}

const netRuntime = {
  servers: [] as MockServer[],
  connectCalls: [] as Array<Record<string, unknown>>,
  sockets: [] as MockSocket[],
  failListen: null as Error | null,
  reset() {
    this.servers.length = 0
    this.connectCalls.length = 0
    this.sockets.length = 0
    this.failListen = null
  },
  createSocket(options: { remoteAddress?: string; remotePort?: number } = {}) {
    const socket = new MockSocket(options)
    this.sockets.push(socket)
    return socket
  },
  createServer(handler: (socket: MockSocket) => void) {
    const server = new MockServer(handler)
    netRuntime.servers.push(server)
    return server
  },
  connect(options: Record<string, unknown>) {
    netRuntime.connectCalls.push(options)
    return netRuntime.createSocket({ remoteAddress: String(options.host || 'localhost'), remotePort: Number(options.port || 0) })
  }
}

const sshProxyMock = vi.hoisted(() => {
  const sockets: Array<{ destroyed: boolean; destroy: () => void; id: string }> = []
  const calls: Array<Record<string, unknown>> = []

  const createSocket = (id: string) => {
    const socket = {
      id,
      destroyed: false,
      destroy() {
        socket.destroyed = true
      }
    }
    sockets.push(socket)
    return socket
  }

  return {
    sockets,
    calls,
    reset() {
      sockets.length = 0
      calls.length = 0
    },
    async createSshProxySocketForAsset(asset: unknown, configs: unknown, host: string, port: number) {
      calls.push({ asset, configs, host, port })
      if (!(asset as { needProxy?: boolean } | null | undefined)?.needProxy) return null
      return {
        config: { name: (asset as { proxyName?: string }).proxyName || 'unit-proxy' },
        socket: createSocket(`proxy-${calls.length}`)
      }
    }
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-ssh-tunnels-test'
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store tunnel backend in tests')
})

vi.mock('../src/main/backend/sshProxy', () => ({
  createSshProxySocketForAsset: sshProxyMock.createSshProxySocketForAsset
}))

const loadBackends = async (config: Record<string, unknown> = {}) => {
  vi.resetModules()
  const assetsModulePath = '../src/main/backend/assets'
  const tunnelsModulePath = '../src/main/backend/sshTunnels'
  const assets = await import(assetsModulePath)
  const tunnels = await import(tunnelsModulePath)
  tunnels.configureSshTunnelBackendRuntime({
    getConfig: () => ({
      sshProxyConfigs: [],
      ...config
    }),
    netRuntime: {
      createServer: netRuntime.createServer,
      connect: netRuntime.connect
    } as never,
    ssh2Runtime: {
      Client: ssh2Runtime.Client
    } as never
  })
  return { assets, tunnels }
}

const createPrivateKey = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  }).privateKey

const savePasswordAsset = (assets: Record<string, any>, patch: Record<string, unknown> = {}) => {
  const asset = assets.getAsset('asset-4')
  const saved = assets.saveAsset({
    id: asset.id,
    name: asset.name,
    title: asset.title,
    host: asset.host,
    ip: asset.ip,
    group: asset.group,
    group_name: asset.group_name,
    status: asset.status,
    username: asset.username,
    port: asset.port,
    asset_type: asset.asset_type,
    auth_type: asset.auth_type,
    comment: asset.comment,
    data_source: asset.data_source,
    tags: [...asset.tags],
    favorite: asset.favorite,
    folderUuid: asset.folderUuid,
    organizationId: asset.organizationId,
    needProxy: asset.needProxy,
    proxyName: asset.proxyName,
    keychainId: asset.keychainId,
    password: 'backend-secret',
    ...patch
  })
  expect(saved.ok).toBe(true)
  return saved.data
}

describe('ssh tunnel backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    ssh2Runtime.reset()
    netRuntime.reset()
    sshProxyMock.reset()
  })

  it('rejects missing and unsupported asset ids before mutating asset rows', async () => {
    const { assets, tunnels } = await loadBackends()
    const before = assets.listAssets()

    const missing = await tunnels.startSshTunnel({ assetId: 'missing-host' })
    const local = await tunnels.startSshTunnel({ assetId: 'local-127-1' })
    const organization = await tunnels.startSshTunnel({ assetId: 'asset-5' })

    expect(missing).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_ASSET_NOT_FOUND' })
    expect(local).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_START_FAILED' })
    expect(local.errorMessage).toContain('本地连接不支持 SSH 隧道')
    expect(organization).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_START_FAILED' })
    expect(organization.errorMessage).toContain('只有 SSH 主机资产支持隧道')
    expect(assets.listAssets().assets).toEqual(before.assets)
    expect(ssh2Runtime.connectConfigs).toEqual([])
    expect(netRuntime.servers).toEqual([])
  })

  it('requires backend credentials before saving active tunnel state', async () => {
    const previousAgentSocket = process.env.SSH_AUTH_SOCK
    delete process.env.SSH_AUTH_SOCK
    const { assets, tunnels } = await loadBackends()
    const before = assets.getAsset('asset-4')

    try {
      const result = await tunnels.startSshTunnel({ assetId: 'asset-4', type: 'local_forward', localPort: 3307, remotePort: 3306 })

      expect(result).toMatchObject({ ok: false, errorCode: 'SSH_TUNNEL_START_FAILED' })
      expect(result.errorMessage).toContain('SSH 隧道需要资产密码')
      expect(assets.getAsset('asset-4')?.tunnelState).toBe(before.tunnelState)
      expect(ssh2Runtime.connectConfigs).toEqual([])
      expect(netRuntime.servers).toEqual([])
    } finally {
      if (previousAgentSocket === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previousAgentSocket
    }
  })

  it('starts a local forward by opening ssh2 and forwarding local sockets through forwardOut', async () => {
    const { assets, tunnels } = await loadBackends()
    savePasswordAsset(assets)

    const result = await tunnels.startSshTunnel({
      assetId: 'asset-4',
      type: 'local_forward',
      localPort: 3307,
      remoteHost: '127.0.0.1',
      remotePort: 3306
    })

    expect(result.ok).toBe(true)
    expect(result.data?.tunnel).toMatchObject({
      assetId: 'asset-4',
      tunnelId: 'tunnel-asset-4',
      type: 'local_forward',
      state: 'active',
      localPort: 3307,
      remoteHost: '127.0.0.1',
      remotePort: 3306
    })
    expect(result.data?.assets.find((asset: { id: string }) => asset.id === 'asset-4')).toMatchObject({ tunnelState: 'active' })
    expect(result.data?.tunnel).not.toHaveProperty('client')
    expect(result.data?.tunnel).not.toHaveProperty('server')
    expect(result.data?.tunnel).not.toHaveProperty('sockets')
    expect(ssh2Runtime.connectConfigs).toEqual([
      expect.objectContaining({
        host: '10.11.7.21',
        port: 2222,
        username: 'ops',
        password: 'backend-secret'
      })
    ])
    expect(netRuntime.servers).toHaveLength(1)
    expect(netRuntime.servers[0].listenOptions[0]).toMatchObject({ host: '::1', port: 3307, ipv6Only: false })

    const socket = netRuntime.createSocket({ remoteAddress: '127.0.0.1', remotePort: 55321 })
    netRuntime.servers[0].simulateConnection(socket)

    expect(ssh2Runtime.forwardOutCalls).toEqual([
      {
        srcHost: '127.0.0.1',
        srcPort: 55321,
        dstHost: '127.0.0.1',
        dstPort: 3306
      }
    ])
    await tunnels.stopSshTunnel({ assetId: 'asset-4' })
    expect(netRuntime.servers[0].closeCalls).toBe(1)
    expect(ssh2Runtime.endCalls).toBe(1)
  })

  it('routes tunnel SSH connections through configured SSH proxies', async () => {
    const { assets, tunnels } = await loadBackends({
      sshProxyConfigs: [
        {
          name: 'tunnel-proxy',
          type: 'SOCKS5',
          host: '127.0.0.1',
          port: 1080,
          enableProxyIdentity: false,
          username: '',
          password: ''
        }
      ]
    })
    savePasswordAsset(assets, { needProxy: true, proxyName: 'tunnel-proxy' })

    const started = await tunnels.startSshTunnel({
      assetId: 'asset-4',
      type: 'local_forward',
      localPort: 13306,
      remotePort: 3306
    })

    expect(started.ok).toBe(true)
    expect(sshProxyMock.calls).toEqual([
      {
        asset: {
          needProxy: true,
          proxyName: 'tunnel-proxy'
        },
        configs: [
          {
            name: 'tunnel-proxy',
            type: 'SOCKS5',
            host: '127.0.0.1',
            port: 1080,
            enableProxyIdentity: false,
            username: '',
            password: ''
          }
        ],
        host: '10.11.7.21',
        port: 2222
      }
    ])
    expect(ssh2Runtime.connectConfigs).toEqual([
      expect.objectContaining({
        username: 'ops',
        password: 'backend-secret',
        sock: sshProxyMock.sockets[0]
      })
    ])
    expect(ssh2Runtime.connectConfigs[0]).not.toHaveProperty('host')
    expect(ssh2Runtime.connectConfigs[0]).not.toHaveProperty('port')

    await tunnels.stopSshTunnel({ assetId: 'asset-4' })
    expect(sshProxyMock.sockets[0].destroyed).toBe(true)
  })

  it('authenticates tunnels through configured SSH Agent keychains', async () => {
    const privateKey = createPrivateKey()
    const { assets, tunnels } = await loadBackends({
      terminal: { sshAgentsStatus: true },
      sshAgentKeys: [
        {
          id: 'key-tunnel-agent-test',
          keyChainId: 'key-tunnel-agent-test',
          fingerprint: 'SHA256:tunnel-agent',
          comment: 'tunnel-agent-test',
          keyType: 'RSA'
        }
      ]
    })
    const savedKeychain = assets.saveKeychain({
      id: 'key-tunnel-agent-test',
      name: 'tunnel-agent-test',
      type: 'rsa',
      publicKey: '',
      privateKey
    })
    expect(savedKeychain.ok).toBe(true)

    const started = await tunnels.startSshTunnel({
      assetId: 'asset-4',
      type: 'local_forward',
      localPort: 13307,
      remotePort: 3306
    })

    expect(started.ok).toBe(true)
    expect(ssh2Runtime.connectConfigs).toEqual([
      expect.objectContaining({
        host: '10.11.7.21',
        port: 2222,
        username: 'ops',
        agent: expect.objectContaining({
          getIdentities: expect.any(Function),
          sign: expect.any(Function),
          getStream: expect.any(Function)
        })
      })
    ])
    expect(ssh2Runtime.connectConfigs[0]).not.toHaveProperty('password')
    expect(ssh2Runtime.connectConfigs[0]).not.toHaveProperty('privateKey')

    await tunnels.stopSshTunnel({ assetId: 'asset-4' })
  })

  it('starts and stops a remote forward with forwardIn and unforwardIn cleanup', async () => {
    const { assets, tunnels } = await loadBackends()
    savePasswordAsset(assets)

    const started = await tunnels.startSshTunnel({
      assetId: 'asset-4',
      type: 'remote_forward',
      localPort: 15432,
      remotePort: 4444
    })

    expect(started.ok).toBe(true)
    expect(started.data?.tunnel).toMatchObject({
      type: 'remote_forward',
      state: 'active',
      localPort: 15432,
      remoteHost: 'localhost',
      remotePort: 4444
    })
    expect(ssh2Runtime.forwardInCalls).toEqual([{ host: 'localhost', port: 4444 }])

    const remoteStream = new PassThrough()
    let rejected = false
    ssh2Runtime.clients[0].emit('tcp connection', { destPort: 4444 }, () => remoteStream, () => {
      rejected = true
    })

    expect(rejected).toBe(false)
    expect(netRuntime.connectCalls).toEqual([{ host: 'localhost', port: 15432 }])

    const stopped = await tunnels.stopSshTunnel({ assetId: 'asset-4' })

    expect(stopped.ok).toBe(true)
    expect(stopped.data?.tunnel).toMatchObject({
      assetId: 'asset-4',
      tunnelId: 'tunnel-asset-4',
      type: 'remote_forward',
      state: 'created'
    })
    expect(stopped.data?.message).toContain('隧道已停止 legacy-node')
    expect(ssh2Runtime.unforwardInCalls).toEqual([{ host: 'localhost', port: 4444 }])
    expect(ssh2Runtime.endCalls).toBe(1)
    expect(assets.getAsset('asset-4')).toMatchObject({ tunnelState: 'created' })
  })

  it('starts a dynamic SOCKS tunnel and forwards SOCKS5 CONNECT requests through ssh2', async () => {
    const { assets, tunnels } = await loadBackends()
    savePasswordAsset(assets)

    const started = await tunnels.startSshTunnel({
      assetId: 'asset-4',
      type: 'dynamic_socks',
      localPort: 1081
    })

    expect(started.ok).toBe(true)
    expect(started.data?.tunnel).toMatchObject({
      type: 'dynamic_socks',
      state: 'active',
      localPort: 1081
    })
    expect(netRuntime.servers).toHaveLength(1)

    const socket = netRuntime.createSocket({ remoteAddress: '127.0.0.1', remotePort: 60000 })
    netRuntime.servers[0].simulateConnection(socket)
    socket.emit('data', Buffer.from([0x05, 0x01, 0x00]))
    const host = Buffer.from('example.com')
    socket.emit('data', Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, Buffer.from([0x01, 0xbb])]))

    expect(socket.writes.map((buffer) => [...buffer])).toEqual([
      [0x05, 0x00],
      [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]
    ])
    expect(ssh2Runtime.forwardOutCalls).toEqual([
      {
        srcHost: '127.0.0.1',
        srcPort: 60000,
        dstHost: 'example.com',
        dstPort: 443
      }
    ])

    await tunnels.stopSshTunnel({ assetId: 'asset-4' })
    expect(netRuntime.servers[0].closeCalls).toBe(1)
  })
})
