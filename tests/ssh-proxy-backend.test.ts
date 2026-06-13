import net from 'net'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SshProxyConfig } from '../src/shared/preload'

let createSshProxySocket: (config: SshProxyConfig, targetHost: string, targetPort: number, options?: { timeoutMs?: number }) => Promise<net.Socket>
let createSshProxySocketForAsset: (
  asset: { needProxy?: boolean; proxyName?: string },
  configs: SshProxyConfig[],
  targetHost: string,
  targetPort: number,
  options?: { timeoutMs?: number }
) => Promise<{ config: SshProxyConfig; socket: net.Socket } | null>
let resolveSshProxyConfigForAsset: (
  asset: { needProxy?: boolean; proxyName?: string },
  configs: SshProxyConfig[]
) => SshProxyConfig | null

const servers: net.Server[] = []

const listen = (server: net.Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      servers.push(server)
      resolve((server.address() as net.AddressInfo).port)
    })
  })

const closeServer = (server: net.Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve())
  })

const readSocketData = (socket: net.Socket) =>
  new Promise<Buffer>((resolve, reject) => {
    socket.once('data', (chunk) => resolve(Buffer.from(chunk)))
    socket.once('error', reject)
  })

beforeAll(async () => {
  const modulePath = '../src/main/backend/sshProxy'
  const backend = await import(modulePath)
  createSshProxySocket = backend.createSshProxySocket
  createSshProxySocketForAsset = backend.createSshProxySocketForAsset
  resolveSshProxyConfigForAsset = backend.resolveSshProxyConfigForAsset
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('SSH proxy backend boundary', () => {
  const baseProxy = (patch: Partial<SshProxyConfig>): SshProxyConfig => ({
    name: 'unit-proxy',
    type: 'HTTP',
    host: '127.0.0.1',
    port: 1,
    enableProxyIdentity: false,
    username: '',
    password: '',
    ...patch
  })

  it('resolves asset proxy names from backend-confirmed SSH proxy configs', () => {
    const proxy = baseProxy({ name: 'release-proxy', host: 'proxy.internal', port: 18080, type: 'SOCKS5' })

    expect(resolveSshProxyConfigForAsset({ needProxy: false, proxyName: 'release-proxy' }, [proxy])).toBeNull()
    expect(resolveSshProxyConfigForAsset({ needProxy: true, proxyName: ' release-proxy ' }, [proxy])).toEqual(proxy)
    expect(() => resolveSshProxyConfigForAsset({ needProxy: true, proxyName: 'missing-proxy' }, [proxy])).toThrow(
      'SSH proxy config "missing-proxy" is not available.'
    )
  })

  it('opens HTTP CONNECT sockets with proxy authentication before SSH connects', async () => {
    let request = ''
    const server = net.createServer((socket) => {
      socket.once('data', (chunk) => {
        request += chunk.toString('utf8')
        socket.write('HTTP/1.1 200 Connection established\r\n\r\nssh-banner')
      })
    })
    const port = await listen(server)

    const result = await createSshProxySocketForAsset(
      { needProxy: true, proxyName: 'release-proxy' },
      [
        baseProxy({
          name: 'release-proxy',
          type: 'HTTP',
          port,
          enableProxyIdentity: true,
          username: 'ops',
          password: 'secret'
        })
      ],
      'target.example.test',
      2222,
      { timeoutMs: 1000 }
    )

    expect(result?.config.name).toBe('release-proxy')
    expect(request).toContain('CONNECT target.example.test:2222 HTTP/1.1')
    expect(request).toContain(`Proxy-Authorization: Basic ${Buffer.from('ops:secret').toString('base64')}`)
    expect(result?.socket.read()?.toString('utf8')).toBe('ssh-banner')
    result?.socket.destroy()
  })

  it('opens SOCKS5 sockets with username/password authentication', async () => {
    const observed: { greeting?: Buffer; auth?: Buffer; connect?: Buffer } = {}
    const server = net.createServer((socket) => {
      let step = 0
      socket.on('data', (chunk) => {
        if (step === 0) {
          observed.greeting = Buffer.from(chunk)
          socket.write(Buffer.from([0x05, 0x02]))
          step += 1
          return
        }
        if (step === 1) {
          observed.auth = Buffer.from(chunk)
          socket.write(Buffer.from([0x01, 0x00]))
          step += 1
          return
        }
        observed.connect = Buffer.from(chunk)
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90]))
      })
    })
    const port = await listen(server)

    const socket = await createSshProxySocket(
      baseProxy({
        type: 'SOCKS5',
        port,
        enableProxyIdentity: true,
        username: 'ops',
        password: 'secret'
      }),
      'target.example.test',
      2222,
      { timeoutMs: 1000 }
    )

    expect(observed.greeting).toEqual(Buffer.from([0x05, 0x02, 0x00, 0x02]))
    expect(observed.auth).toEqual(Buffer.concat([Buffer.from([0x01, 0x03]), Buffer.from('ops'), Buffer.from([0x06]), Buffer.from('secret')]))
    expect(observed.connect).toEqual(
      Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, 'target.example.test'.length]),
        Buffer.from('target.example.test'),
        Buffer.from([0x08, 0xae])
      ])
    )
    socket.destroy()
  })

  it('opens SOCKS4a sockets with the saved proxy username', async () => {
    let request = Buffer.alloc(0)
    const server = net.createServer((socket) => {
      socket.once('data', (chunk) => {
        request = Buffer.from(chunk)
        socket.write(Buffer.from([0x00, 0x5a, 0x08, 0xae, 127, 0, 0, 1]))
      })
    })
    const port = await listen(server)

    const socket = await createSshProxySocket(
      baseProxy({
        type: 'SOCKS4',
        port,
        enableProxyIdentity: true,
        username: 'ops'
      }),
      'target.example.test',
      2222,
      { timeoutMs: 1000 }
    )

    expect(request.subarray(0, 8)).toEqual(Buffer.from([0x04, 0x01, 0x08, 0xae, 0, 0, 0, 1]))
    expect(request.subarray(8).toString('utf8')).toBe('ops\0target.example.test\0')
    socket.destroy()
  })

  it('opens raw TCP proxy sockets without HTTP or SOCKS handshakes', async () => {
    const observed: Buffer[] = []
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        observed.push(Buffer.from(chunk))
        socket.write('tcp-proxy-echo')
      })
      socket.write('ssh-banner')
    })
    const port = await listen(server)

    const socket = await createSshProxySocket(
      baseProxy({
        type: 'TCP',
        port,
        enableProxyIdentity: true,
        username: 'ignored',
        password: 'ignored'
      }),
      'target.example.test',
      2222,
      { timeoutMs: 1000 }
    )

    await expect(readSocketData(socket).then((chunk) => chunk.toString('utf8'))).resolves.toBe('ssh-banner')
    socket.write('client-bytes')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(observed.map((chunk) => chunk.toString('utf8'))).toEqual(['client-bytes'])
    socket.destroy()
  })
})
