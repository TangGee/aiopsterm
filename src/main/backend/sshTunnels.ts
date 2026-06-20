import net from 'net'
import type { Duplex } from 'stream'
import type { Client, ClientChannel, ConnectConfig, TcpConnectionDetails } from 'ssh2'
import type {
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelRecord,
  AiopsSshTunnelStartInput,
  AiopsSshTunnelStopInput,
  AiopsSshTunnelType
} from '@shared/contracts/assets'
import type { UserConfig } from '@shared/contracts/userConfig'
import { getAsset, getAssetSecret, getKeychainSecret, listAssets, saveAsset } from './assets'
import { applyConfiguredSshAgentAuth } from './sshAgent'
import { loadSsh2 } from './ssh2Runtime'
import { defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from './sshDefaults'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'

type TunnelClient = Pick<Client, 'connect' | 'end' | 'forwardIn' | 'forwardOut' | 'unforwardIn' | 'on' | 'off' | 'once'>
type TunnelSocket = net.Socket
type TunnelServer = net.Server
type TunnelNetRuntime = Pick<typeof net, 'connect' | 'createServer'>

type ActiveSshTunnel = AiopsSshTunnelRecord & {
  client: TunnelClient
  server?: TunnelServer
  sockets: Set<TunnelSocket>
  streams: Set<Duplex>
  proxySocket?: SshProxySocket | null
  remoteTcpHandler?: (details: TcpConnectionDetails, accept: () => ClientChannel | undefined, reject: () => void) => void
}

type SshTunnelBackendRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  netRuntime?: TunnelNetRuntime
  ssh2Runtime?: { Client: new () => TunnelClient } | null
}

const activeTunnels = new Map<string, ActiveSshTunnel>()
const defaultTunnelType: AiopsSshTunnelType = 'local_forward'
const sshLocalhost = 'localhost'
const loopbackIpv4 = '127.0.0.1'
const loopbackIpv6 = '::1'
const defaultLocalForwardPort = 3306
const defaultDynamicSocksPort = 1080
const tunnelRuntimeConfig: SshTunnelBackendRuntimeConfig = {}

export const configureSshTunnelBackendRuntime = (config: SshTunnelBackendRuntimeConfig = {}) => {
  tunnelRuntimeConfig.getConfig = config.getConfig
  tunnelRuntimeConfig.netRuntime = config.netRuntime
  tunnelRuntimeConfig.ssh2Runtime = config.ssh2Runtime
}

const getNetRuntime = () => tunnelRuntimeConfig.netRuntime || net
const getSsh2Runtime = () => (tunnelRuntimeConfig.ssh2Runtime === undefined ? loadSsh2() : tunnelRuntimeConfig.ssh2Runtime)
const getSshRuntimeConfig = () => {
  const config = tunnelRuntimeConfig.getConfig?.()
  return {
    terminal: config?.terminal,
    sshAgentKeys: config?.sshAgentKeys,
    sshProxyConfigs: config?.sshProxyConfigs || []
  }
}

const asTunnelError = (errorCode: string, errorMessage: string): AiopsSshTunnelMutationResult => ({
  ok: false,
  errorCode,
  errorMessage
})

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const validPort = (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535

const normalizeTunnelType = (type?: AiopsSshTunnelType): AiopsSshTunnelType =>
  type === 'remote_forward' || type === 'dynamic_socks' || type === 'local_forward' ? type : defaultTunnelType

const tunnelIdForAsset = (assetId: string, explicitTunnelId?: string) => {
  const id = text(explicitTunnelId)
  return id || `tunnel-${assetId}`
}

const assertTunnelAsset = (assetId?: string): AiopsAssetRecord | null => {
  const id = text(assetId)
  if (!id) return null
  const asset = getAsset(id)
  if (!asset) return null
  if (asset.isLocalShell) throw new Error('本地连接不支持 SSH 隧道')
  if (asset.asset_type !== 'person') throw new Error('只有 SSH 主机资产支持隧道')
  if (!asset.host && !asset.ip) throw new Error('隧道主机地址不能为空')
  return asset
}

const assetToTunnelInput = (asset: AiopsAssetRecord, tunnelState: AiopsAssetRecord['tunnelState']): AiopsAssetInput => ({
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
  tunnelState,
  needProxy: asset.needProxy,
  proxyName: asset.proxyName,
  keychainId: asset.keychainId
})

const saveTunnelState = (asset: AiopsAssetRecord, tunnelState: AiopsAssetRecord['tunnelState']) => {
  const saved = saveAsset(assetToTunnelInput(asset, tunnelState))
  if (!saved.ok || !saved.data) throw new Error(saved.errorMessage || '隧道状态保存失败')
  return saved.data
}

const publicTunnelRecord = (tunnel: AiopsSshTunnelRecord): AiopsSshTunnelRecord => ({
  assetId: tunnel.assetId,
  tunnelId: tunnel.tunnelId,
  type: tunnel.type,
  state: tunnel.state,
  ...(tunnel.localPort !== undefined ? { localPort: tunnel.localPort } : {}),
  ...(tunnel.remoteHost !== undefined ? { remoteHost: tunnel.remoteHost } : {}),
  ...(tunnel.remotePort !== undefined ? { remotePort: tunnel.remotePort } : {}),
  ...(tunnel.startedAt !== undefined ? { startedAt: tunnel.startedAt } : {}),
  ...(tunnel.stoppedAt !== undefined ? { stoppedAt: tunnel.stoppedAt } : {})
})

const resultWithSnapshot = (tunnel: AiopsSshTunnelRecord, message: string): AiopsSshTunnelMutationResult => ({
  ok: true,
  data: {
    ...listAssets(),
    tunnel: publicTunnelRecord(tunnel),
    message
  }
})

const usablePrivateKey = (value: unknown) => {
  const privateKey = text(value)
  if (!privateKey.includes('PRIVATE KEY')) return ''
  const body = privateKey
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('BEGIN') && !line.includes('END'))
    .join('')
  return body.length >= 32 ? privateKey : ''
}

const buildConnectConfig = async (asset: AiopsAssetRecord, proxyTargetHost: string, proxyTargetPort: number) => {
  const secret = getAssetSecret(asset.id)
  const keychainSecret = asset.keychainId ? getKeychainSecret(asset.keychainId) : {}
  const password = text(secret.password)
  const privateKey = usablePrivateKey(secret.privateKey) || usablePrivateKey(keychainSecret.privateKey)
  const passphrase = text(secret.passphrase) || text(keychainSecret.passphrase)
  const host = text(asset.host || asset.ip)
  const username = text(asset.username)
  const port = Number(asset.port ?? 22)
  if (!host || !username || !validPort(port)) throw new Error('SSH 隧道主机需要地址、用户名和有效端口')

  const connectConfig: ConnectConfig = {
    host,
    port,
    username,
    readyTimeout: defaultSshReadyTimeoutMs,
    keepaliveInterval: defaultSshKeepaliveIntervalMs
  }
  if (password) connectConfig.password = password
  if (privateKey) connectConfig.privateKey = privateKey
  if (passphrase) connectConfig.passphrase = passphrase

  const runtimeConfig = getSshRuntimeConfig()
  applyConfiguredSshAgentAuth(connectConfig, runtimeConfig, (keyChainId) => getKeychainSecret(keyChainId), {
    enableForward: false,
    overrideExistingAgent: false
  })
  if (!connectConfig.password && !connectConfig.privateKey && !connectConfig.agent && process.env.SSH_AUTH_SOCK) connectConfig.agent = process.env.SSH_AUTH_SOCK

  const proxy = await createSshProxySocketForAsset(
    { needProxy: Boolean(asset.needProxy), proxyName: asset.proxyName },
    runtimeConfig.sshProxyConfigs,
    proxyTargetHost || host,
    validPort(proxyTargetPort) ? proxyTargetPort : port
  )
  if (proxy) {
    connectConfig.sock = proxy.socket
    delete connectConfig.host
    delete connectConfig.port
  }
  if (!connectConfig.password && !connectConfig.privateKey && !connectConfig.agent) {
    proxy?.socket.destroy()
    throw new Error('SSH 隧道需要资产密码、私钥、KeyChain 或 SSH Agent')
  }
  return { connectConfig, proxySocket: proxy?.socket || null, host, port }
}

const connectSshClient = (client: TunnelClient, connectConfig: ConnectConfig) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const cleanup = () => {
      client.off('ready', handleReady)
      client.off('error', handleError)
      client.off('close', handleClose)
    }
    const handleReady = () => settle(resolve)
    const handleError = (error: Error) => settle(() => reject(error))
    const handleClose = () => settle(() => reject(new Error('SSH tunnel connection closed before ready')))
    client.once('ready', handleReady)
    client.once('error', handleError)
    client.once('close', handleClose)
    client.connect(connectConfig)
  })

const closeTunnelResources = (tunnel: ActiveSshTunnel) => {
  try {
    tunnel.server?.close()
  } catch {}
  tunnel.server = undefined
  for (const socket of tunnel.sockets) {
    try {
      socket.destroy()
    } catch {}
  }
  tunnel.sockets.clear()
  for (const stream of tunnel.streams) {
    try {
      stream.destroy()
    } catch {}
  }
  tunnel.streams.clear()
  try {
    tunnel.proxySocket?.destroy()
  } catch {}
  try {
    tunnel.client.end()
  } catch {}
}

const cleanupTunnel = async (tunnelId: string) => {
  const tunnel = activeTunnels.get(tunnelId)
  if (!tunnel) return null
  if (tunnel.type === 'remote_forward' && tunnel.remoteTcpHandler && tunnel.remotePort) {
    try {
      tunnel.client.off('tcp connection', tunnel.remoteTcpHandler)
      await new Promise<void>((resolve) => {
        try {
          tunnel.client.unforwardIn(sshLocalhost, tunnel.remotePort!, () => resolve())
        } catch {
          resolve()
        }
      })
    } catch {}
  }
  closeTunnelResources(tunnel)
  activeTunnels.delete(tunnelId)
  return tunnel
}

const listenServer = (server: TunnelServer, options: net.ListenOptions) =>
  new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(options)
  })

const isIpv6LoopbackUnavailable = (error: unknown) => {
  const code = String((error as NodeJS.ErrnoException | undefined)?.code || '')
  return code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL'
}

const listenLocalServer = (server: TunnelServer, port: number) =>
  listenServer(server, { port, host: loopbackIpv6, ipv6Only: false }).catch(async (error) => {
    if (!isIpv6LoopbackUnavailable(error)) throw error
    await listenServer(server, { port, host: loopbackIpv4 })
  })

const addSocket = (tunnel: ActiveSshTunnel, socket: TunnelSocket) => {
  tunnel.sockets.add(socket)
  socket.once('close', () => tunnel.sockets.delete(socket))
}

const addStream = (tunnel: ActiveSshTunnel, stream: Duplex) => {
  tunnel.streams.add(stream)
  stream.once('close', () => tunnel.streams.delete(stream))
}

const pipeSocketToForwardOut = (client: TunnelClient, tunnel: ActiveSshTunnel, socket: TunnelSocket, targetHost: string, targetPort: number) => {
  const srcHost = socket.remoteAddress || loopbackIpv4
  const srcPort = socket.remotePort || 0
  client.forwardOut(srcHost, srcPort, targetHost, targetPort, (error, stream) => {
    if (error || !stream) {
      socket.destroy()
      return
    }
    const sshStream = stream as unknown as Duplex
    addStream(tunnel, sshStream)
    socket.pipe(sshStream).pipe(socket)
    socket.on('error', () => sshStream.destroy())
    sshStream.on('error', () => socket.destroy())
  })
}

const startLocalForwardTunnel = async (tunnel: ActiveSshTunnel, netRuntime: TunnelNetRuntime) => {
  const remotePort = tunnel.remotePort
  if (!validPort(remotePort)) throw new Error('local_forward tunnel requires a valid remotePort')
  const remoteHost = text(tunnel.remoteHost) || sshLocalhost
  const server = netRuntime.createServer((socket) => {
    addSocket(tunnel, socket)
    pipeSocketToForwardOut(tunnel.client, tunnel, socket, remoteHost, remotePort!)
  })
  tunnel.server = server
  await listenLocalServer(server, tunnel.localPort!)
}

const startRemoteForwardTunnel = async (tunnel: ActiveSshTunnel, netRuntime: TunnelNetRuntime) => {
  const remotePort = tunnel.remotePort
  if (!validPort(remotePort)) throw new Error('remote_forward tunnel requires a valid remotePort')
  await new Promise<void>((resolve, reject) => {
    tunnel.client.forwardIn(sshLocalhost, remotePort!, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  const handler = (details: TcpConnectionDetails, accept: () => ClientChannel | undefined, reject: () => void) => {
    if (details.destPort !== remotePort) return
    const sshStream = accept()
    if (!sshStream) {
      reject()
      return
    }
    const stream = sshStream as unknown as Duplex
    addStream(tunnel, stream)
    const localSocket = netRuntime.connect({ host: sshLocalhost, port: tunnel.localPort! })
    addSocket(tunnel, localSocket)
    localSocket.pipe(stream).pipe(localSocket)
    localSocket.on('error', () => stream.destroy())
    stream.on('error', () => localSocket.destroy())
  }
  tunnel.remoteTcpHandler = handler
  tunnel.client.on('tcp connection', handler)
}

type SocksParseResult =
  | { status: 'incomplete' }
  | { status: 'error'; replyCode: number }
  | { status: 'ok'; host: string; port: number; consumed: number }

const formatIpv6 = (buffer: Buffer) => {
  const blocks: string[] = []
  for (let index = 0; index < 16; index += 2) {
    blocks.push(buffer.readUInt16BE(index).toString(16))
  }
  return blocks.join(':')
}

const parseSocks5ConnectRequest = (buffer: Buffer): SocksParseResult => {
  if (buffer.length < 4) return { status: 'incomplete' }
  if (buffer[0] !== 0x05) return { status: 'error', replyCode: 0x01 }
  if (buffer[1] !== 0x01) return { status: 'error', replyCode: 0x07 }
  const addressType = buffer[3]
  let offset = 4
  let host = ''
  if (addressType === 0x01) {
    if (buffer.length < offset + 4 + 2) return { status: 'incomplete' }
    host = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`
    offset += 4
  } else if (addressType === 0x03) {
    if (buffer.length < offset + 1) return { status: 'incomplete' }
    const domainLength = buffer[offset]
    offset += 1
    if (buffer.length < offset + domainLength + 2) return { status: 'incomplete' }
    host = buffer.subarray(offset, offset + domainLength).toString('utf8')
    offset += domainLength
  } else if (addressType === 0x04) {
    if (buffer.length < offset + 16 + 2) return { status: 'incomplete' }
    host = formatIpv6(buffer.subarray(offset, offset + 16))
    offset += 16
  } else {
    return { status: 'error', replyCode: 0x08 }
  }
  const port = buffer.readUInt16BE(offset)
  offset += 2
  return { status: 'ok', host, port, consumed: offset }
}

const startDynamicSocksTunnel = async (tunnel: ActiveSshTunnel, netRuntime: TunnelNetRuntime) => {
  const server = netRuntime.createServer((socket) => {
    addSocket(tunnel, socket)
    let stage: 'greeting' | 'request' | 'connecting' | 'proxy' = 'greeting'
    let pending = Buffer.alloc(0)
    const writeReply = (replyCode: number) => socket.write(Buffer.from([0x05, replyCode, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    const handleData = (chunk: Buffer) => {
      if (stage === 'proxy') return
      pending = Buffer.concat([pending, chunk])
      if (stage === 'connecting') return
      if (stage === 'greeting') {
        if (pending.length < 2) return
        const methodCount = pending[1]
        if (pending.length < 2 + methodCount) return
        const methods = pending.subarray(2, 2 + methodCount)
        if (!methods.includes(0x00)) {
          socket.end(Buffer.from([0x05, 0xff]))
          return
        }
        socket.write(Buffer.from([0x05, 0x00]))
        pending = pending.subarray(2 + methodCount)
        stage = 'request'
      }
      if (stage !== 'request') return
      const parsed = parseSocks5ConnectRequest(pending)
      if (parsed.status === 'incomplete') return
      if (parsed.status === 'error') {
        writeReply(parsed.replyCode)
        socket.destroy()
        return
      }
      const rest = pending.subarray(parsed.consumed)
      pending = Buffer.alloc(0)
      stage = 'connecting'
      const srcHost = socket.remoteAddress || loopbackIpv4
      const srcPort = socket.remotePort || 0
      tunnel.client.forwardOut(srcHost, srcPort, parsed.host, parsed.port, (error, stream) => {
        if (error || !stream) {
          writeReply(0x01)
          socket.destroy()
          return
        }
        const sshStream = stream as unknown as Duplex
        addStream(tunnel, sshStream)
        stage = 'proxy'
        socket.off('data', handleData)
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        if (rest.length) sshStream.write(rest)
        if (pending.length) {
          sshStream.write(pending)
          pending = Buffer.alloc(0)
        }
        socket.pipe(sshStream).pipe(socket)
        socket.on('error', () => sshStream.destroy())
        sshStream.on('error', () => socket.destroy())
      })
    }
    socket.on('data', handleData)
  })
  tunnel.server = server
  await listenLocalServer(server, tunnel.localPort!)
}

const normalizeTunnelPorts = (type: AiopsSshTunnelType, input: AiopsSshTunnelStartInput, asset: AiopsAssetRecord) => {
  const defaultLocalPort = type === 'dynamic_socks' ? defaultDynamicSocksPort : defaultLocalForwardPort
  const localPort = Number(input.localPort ?? defaultLocalPort)
  const remotePort =
    type === 'dynamic_socks' ? undefined : Number(input.remotePort ?? (type === 'local_forward' ? defaultLocalForwardPort : asset.port ?? 22))
  if (!validPort(localPort)) throw new Error('隧道本地端口无效')
  if ((type === 'local_forward' || type === 'remote_forward') && !validPort(remotePort)) throw new Error('隧道远端端口无效')
  return { localPort, remotePort }
}

export const startSshTunnel = async (input: AiopsSshTunnelStartInput): Promise<AiopsSshTunnelMutationResult> => {
  let tunnel: ActiveSshTunnel | null = null
  try {
    const asset = assertTunnelAsset(input?.assetId)
    if (!asset) return asTunnelError('SSH_TUNNEL_ASSET_NOT_FOUND', '隧道主机不存在')
    const ssh2 = getSsh2Runtime()
    if (!ssh2) return asTunnelError('SSH_TUNNEL_RUNTIME_UNAVAILABLE', 'ssh2 runtime is not available')
    const type = normalizeTunnelType(input.type)
    const tunnelId = tunnelIdForAsset(asset.id, input.tunnelId)
    const { localPort, remotePort } = normalizeTunnelPorts(type, input, asset)
    const remoteHost = type === 'dynamic_socks' ? undefined : text(input.remoteHost) || sshLocalhost
    await cleanupTunnel(tunnelId)

    const client = new ssh2.Client()
    const { connectConfig, proxySocket } = await buildConnectConfig(asset, text(asset.host || asset.ip), Number(asset.port ?? 22))
    tunnel = {
      assetId: asset.id,
      tunnelId,
      type,
      state: 'active',
      localPort,
      ...(remoteHost ? { remoteHost } : {}),
      ...(remotePort ? { remotePort } : {}),
      startedAt: new Date().toISOString(),
      client,
      proxySocket,
      sockets: new Set<TunnelSocket>(),
      streams: new Set<Duplex>()
    }

    await connectSshClient(client, connectConfig)
    const netRuntime = getNetRuntime()
    if (type === 'local_forward') await startLocalForwardTunnel(tunnel, netRuntime)
    else if (type === 'remote_forward') await startRemoteForwardTunnel(tunnel, netRuntime)
    else await startDynamicSocksTunnel(tunnel, netRuntime)

    activeTunnels.set(tunnelId, tunnel)
    saveTunnelState(asset, 'active')
    return resultWithSnapshot(tunnel, `隧道已连接 ${asset.name}`)
  } catch (error) {
    if (tunnel) closeTunnelResources(tunnel)
    return asTunnelError('SSH_TUNNEL_START_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export const stopSshTunnel = async (input: AiopsSshTunnelStopInput): Promise<AiopsSshTunnelMutationResult> => {
  try {
    const assetId = text(input?.assetId)
    const explicitTunnelId = text(input?.tunnelId)
    const tunnelId = explicitTunnelId || tunnelIdForAsset(assetId)
    const activeTunnel = activeTunnels.get(tunnelId)
    const asset = assertTunnelAsset(assetId || activeTunnel?.assetId)
    if (!asset) return asTunnelError('SSH_TUNNEL_ASSET_NOT_FOUND', '隧道主机不存在')
    const stoppedFromRuntime = await cleanupTunnel(tunnelId)
    const stoppedTunnel: AiopsSshTunnelRecord = {
      ...(stoppedFromRuntime || {
        assetId: asset.id,
        tunnelId,
        type: defaultTunnelType
      }),
      assetId: asset.id,
      tunnelId,
      state: 'created',
      stoppedAt: new Date().toISOString()
    }
    saveTunnelState(asset, 'created')
    return resultWithSnapshot(stoppedTunnel, `隧道已停止 ${asset.name}`)
  } catch (error) {
    return asTunnelError('SSH_TUNNEL_STOP_FAILED', error instanceof Error ? error.message : String(error))
  }
}

export const __resetSshTunnelsForTests = async () => {
  for (const tunnelId of [...activeTunnels.keys()]) {
    await cleanupTunnel(tunnelId)
  }
}
