import net from 'net'
import tls from 'tls'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type { SshProxyConfig } from '@shared/preload'

export type SshProxySocket = net.Socket | tls.TLSSocket

type BufferedSocketState = {
  buffer: Buffer
}

export class SshProxyConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshProxyConnectionError'
  }
}

const defaultProxyTimeoutMs = 30000

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const assertEndpoint = (label: string, host: string, port: number) => {
  if (!host || /[\r\n\0]/.test(host) || host !== host.trim()) {
    throw new SshProxyConnectionError(`${label} host is invalid.`)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SshProxyConnectionError(`${label} port is out of range.`)
  }
}

export const resolveSshProxyConfigForAsset = (
  asset: Pick<AiopsAssetRecord, 'needProxy' | 'proxyName'> | null | undefined,
  configs: SshProxyConfig[] | undefined
): SshProxyConfig | null => {
  if (!asset?.needProxy) return null
  const proxyName = cleanText(asset.proxyName)
  if (!proxyName) {
    throw new SshProxyConnectionError('SSH proxy is enabled for this asset, but no proxy name is saved.')
  }
  const proxyConfig = (configs || []).find((config) => cleanText(config.name) === proxyName)
  if (!proxyConfig) {
    throw new SshProxyConnectionError(`SSH proxy config "${proxyName}" is not available.`)
  }
  return { ...proxyConfig, name: cleanText(proxyConfig.name), host: cleanText(proxyConfig.host), username: cleanText(proxyConfig.username) }
}

const normalizeProxyConfig = (config: SshProxyConfig, targetHost: string, targetPort: number, timeoutMs = defaultProxyTimeoutMs) => {
  const proxy = {
    ...config,
    name: cleanText(config.name),
    host: cleanText(config.host),
    username: cleanText(config.username),
    password: typeof config.password === 'string' ? config.password : '',
    port: Number(config.port),
    timeoutMs
  }
  assertEndpoint('proxy', proxy.host, proxy.port)
  assertEndpoint('target', targetHost, targetPort)
  if (proxy.type === 'SOCKS4' && proxy.enableProxyIdentity && !proxy.username) {
    throw new SshProxyConnectionError('SOCKS4 proxy identity requires a username.')
  }
  if ((proxy.type === 'SOCKS5' || proxy.type === 'HTTP' || proxy.type === 'HTTPS') && proxy.enableProxyIdentity) {
    if (!proxy.username || !proxy.password) {
      throw new SshProxyConnectionError(`${proxy.type} proxy identity requires username and password.`)
    }
  }
  return proxy
}

const connectProxyTransport = (host: string, port: number, timeoutMs: number, useTls: boolean): Promise<SshProxySocket> =>
  new Promise((resolve, reject) => {
    let settled = false
    const socket = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port })
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.off('error', handleError)
      socket.off('connect', handleConnect)
      socket.off('secureConnect', handleConnect)
      callback()
    }
    const handleConnect = () => settle(() => resolve(socket))
    const handleError = (error: Error) => settle(() => reject(new SshProxyConnectionError(`Proxy connection failed: ${error.message}`)))

    timer = setTimeout(() => {
      socket.destroy()
      settle(() => reject(new SshProxyConnectionError(`Proxy connection timeout after ${timeoutMs}ms.`)))
    }, timeoutMs)
    socket.once(useTls ? 'secureConnect' : 'connect', handleConnect)
    socket.once('error', handleError)
  })

const readAtLeast = (socket: SshProxySocket, state: BufferedSocketState, minBytes: number, timeoutMs: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (state.buffer.length >= minBytes) {
      const chunk = state.buffer.subarray(0, minBytes)
      state.buffer = state.buffer.subarray(minBytes)
      resolve(chunk)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (callback: () => void) => {
      if (timer) clearTimeout(timer)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
      callback()
    }
    const tryResolve = () => {
      if (state.buffer.length < minBytes) return false
      const chunk = state.buffer.subarray(0, minBytes)
      state.buffer = state.buffer.subarray(minBytes)
      cleanup(() => resolve(chunk))
      return true
    }
    const handleData = (chunk: Buffer) => {
      state.buffer = Buffer.concat([state.buffer, chunk])
      tryResolve()
    }
    const handleError = (error: Error) => cleanup(() => reject(new SshProxyConnectionError(`Proxy socket error: ${error.message}`)))
    const handleClose = () => cleanup(() => reject(new SshProxyConnectionError('Proxy socket closed during handshake.')))

    timer = setTimeout(() => cleanup(() => reject(new SshProxyConnectionError(`Proxy handshake timeout after ${timeoutMs}ms.`))), timeoutMs)
    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })

const readUntil = (socket: SshProxySocket, state: BufferedSocketState, marker: Buffer, timeoutMs: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const existingIndex = state.buffer.indexOf(marker)
    if (existingIndex >= 0) {
      const end = existingIndex + marker.length
      const chunk = state.buffer.subarray(0, end)
      state.buffer = state.buffer.subarray(end)
      resolve(chunk)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (callback: () => void) => {
      if (timer) clearTimeout(timer)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
      callback()
    }
    const tryResolve = () => {
      const index = state.buffer.indexOf(marker)
      if (index < 0) return false
      const end = index + marker.length
      const chunk = state.buffer.subarray(0, end)
      state.buffer = state.buffer.subarray(end)
      cleanup(() => resolve(chunk))
      return true
    }
    const handleData = (chunk: Buffer) => {
      state.buffer = Buffer.concat([state.buffer, chunk])
      tryResolve()
    }
    const handleError = (error: Error) => cleanup(() => reject(new SshProxyConnectionError(`Proxy socket error: ${error.message}`)))
    const handleClose = () => cleanup(() => reject(new SshProxyConnectionError('Proxy socket closed during handshake.')))

    timer = setTimeout(() => cleanup(() => reject(new SshProxyConnectionError(`Proxy handshake timeout after ${timeoutMs}ms.`))), timeoutMs)
    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })

const pushBackBufferedBytes = (socket: SshProxySocket, state: BufferedSocketState) => {
  if (!state.buffer.length) return
  socket.unshift(state.buffer)
  state.buffer = Buffer.alloc(0)
}

const isIpv4Address = (host: string) => {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

const ipv4Bytes = (host: string) => Buffer.from(host.split('.').map((part) => Number(part)))

const targetAddressBytes = (host: string) => {
  if (isIpv4Address(host)) return Buffer.concat([Buffer.from([0x01]), ipv4Bytes(host)])
  const domain = Buffer.from(host, 'utf8')
  if (domain.length > 255) throw new SshProxyConnectionError('Target host is too long for SOCKS5 domain encoding.')
  return Buffer.concat([Buffer.from([0x03, domain.length]), domain])
}

const createHttpProxySocket = async (config: SshProxyConfig, targetHost: string, targetPort: number, timeoutMs: number): Promise<SshProxySocket> => {
  const proxy = normalizeProxyConfig(config, targetHost, targetPort, timeoutMs)
  const socket = await connectProxyTransport(proxy.host, proxy.port, timeoutMs, proxy.type === 'HTTPS')
  const state = { buffer: Buffer.alloc(0) }
  let headers = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n`
  if (proxy.enableProxyIdentity) {
    headers += `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`
  }
  headers += '\r\n'
  socket.write(headers)
  const response = (await readUntil(socket, state, Buffer.from('\r\n\r\n'), timeoutMs)).toString('utf8')
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(response.split(/\r?\n/, 1)[0] || '')) {
    const status = response.split(/\r?\n/, 1)[0] || 'unknown status'
    socket.destroy()
    throw new SshProxyConnectionError(`HTTP proxy CONNECT failed: ${status}`)
  }
  pushBackBufferedBytes(socket, state)
  return socket
}

const createTcpProxySocket = async (config: SshProxyConfig, targetHost: string, targetPort: number, timeoutMs: number): Promise<net.Socket> => {
  const proxy = normalizeProxyConfig(config, targetHost, targetPort, timeoutMs)
  return (await connectProxyTransport(proxy.host, proxy.port, timeoutMs, false)) as net.Socket
}

const createSocks4ProxySocket = async (config: SshProxyConfig, targetHost: string, targetPort: number, timeoutMs: number): Promise<net.Socket> => {
  const proxy = normalizeProxyConfig(config, targetHost, targetPort, timeoutMs)
  const socket = (await connectProxyTransport(proxy.host, proxy.port, timeoutMs, false)) as net.Socket
  const state = { buffer: Buffer.alloc(0) }
  const port = Buffer.alloc(2)
  port.writeUInt16BE(targetPort, 0)
  const user = Buffer.from(proxy.enableProxyIdentity ? proxy.username : '', 'utf8')
  const address = isIpv4Address(targetHost) ? ipv4Bytes(targetHost) : Buffer.from([0, 0, 0, 1])
  const hostSuffix = isIpv4Address(targetHost) ? Buffer.alloc(0) : Buffer.from(`${targetHost}\0`, 'utf8')
  socket.write(Buffer.concat([Buffer.from([0x04, 0x01]), port, address, user, Buffer.from([0x00]), hostSuffix]))
  const response = await readAtLeast(socket, state, 8, timeoutMs)
  if (response[1] !== 0x5a) {
    socket.destroy()
    throw new SshProxyConnectionError(`SOCKS4 proxy CONNECT failed with code ${response[1]}.`)
  }
  pushBackBufferedBytes(socket, state)
  return socket
}

const readSocks5Address = async (socket: SshProxySocket, state: BufferedSocketState, addressType: number, timeoutMs: number) => {
  if (addressType === 0x01) return readAtLeast(socket, state, 4 + 2, timeoutMs)
  if (addressType === 0x04) return readAtLeast(socket, state, 16 + 2, timeoutMs)
  if (addressType === 0x03) {
    const length = (await readAtLeast(socket, state, 1, timeoutMs))[0]
    return readAtLeast(socket, state, length + 2, timeoutMs)
  }
  throw new SshProxyConnectionError(`SOCKS5 proxy returned unsupported address type ${addressType}.`)
}

const createSocks5ProxySocket = async (config: SshProxyConfig, targetHost: string, targetPort: number, timeoutMs: number): Promise<net.Socket> => {
  const proxy = normalizeProxyConfig(config, targetHost, targetPort, timeoutMs)
  const socket = (await connectProxyTransport(proxy.host, proxy.port, timeoutMs, false)) as net.Socket
  const state = { buffer: Buffer.alloc(0) }
  socket.write(proxy.enableProxyIdentity ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]))
  const greeting = await readAtLeast(socket, state, 2, timeoutMs)
  if (greeting[0] !== 0x05 || greeting[1] === 0xff) {
    socket.destroy()
    throw new SshProxyConnectionError('SOCKS5 proxy did not accept an authentication method.')
  }
  if (greeting[1] === 0x02) {
    const username = Buffer.from(proxy.username, 'utf8')
    const password = Buffer.from(proxy.password, 'utf8')
    if (username.length > 255 || password.length > 255) throw new SshProxyConnectionError('SOCKS5 proxy credentials are too long.')
    socket.write(Buffer.concat([Buffer.from([0x01, username.length]), username, Buffer.from([password.length]), password]))
    const authResponse = await readAtLeast(socket, state, 2, timeoutMs)
    if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
      socket.destroy()
      throw new SshProxyConnectionError('SOCKS5 proxy authentication failed.')
    }
  }
  const port = Buffer.alloc(2)
  port.writeUInt16BE(targetPort, 0)
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), targetAddressBytes(targetHost), port]))
  const responseHead = await readAtLeast(socket, state, 4, timeoutMs)
  if (responseHead[0] !== 0x05 || responseHead[1] !== 0x00) {
    socket.destroy()
    throw new SshProxyConnectionError(`SOCKS5 proxy CONNECT failed with code ${responseHead[1]}.`)
  }
  await readSocks5Address(socket, state, responseHead[3], timeoutMs)
  pushBackBufferedBytes(socket, state)
  return socket
}

export const createSshProxySocket = async (
  config: SshProxyConfig,
  targetHost: string,
  targetPort: number,
  options: { timeoutMs?: number } = {}
): Promise<SshProxySocket> => {
  const timeoutMs = options.timeoutMs || defaultProxyTimeoutMs
  if (config.type === 'HTTP' || config.type === 'HTTPS') return createHttpProxySocket(config, targetHost, targetPort, timeoutMs)
  if (config.type === 'SOCKS4') return createSocks4ProxySocket(config, targetHost, targetPort, timeoutMs)
  if (config.type === 'SOCKS5') return createSocks5ProxySocket(config, targetHost, targetPort, timeoutMs)
  if (config.type === 'TCP') return createTcpProxySocket(config, targetHost, targetPort, timeoutMs)
  throw new SshProxyConnectionError(`Unsupported SSH proxy type: ${(config as { type?: string }).type || 'unknown'}.`)
}

export const createSshProxySocketForAsset = async (
  asset: Pick<AiopsAssetRecord, 'needProxy' | 'proxyName'> | null | undefined,
  configs: SshProxyConfig[] | undefined,
  targetHost: string,
  targetPort: number,
  options: { timeoutMs?: number } = {}
): Promise<{ config: SshProxyConfig; socket: SshProxySocket } | null> => {
  const config = resolveSshProxyConfigForAsset(asset, configs)
  if (!config) return null
  return {
    config,
    socket: await createSshProxySocket(config, targetHost, targetPort, options)
  }
}
