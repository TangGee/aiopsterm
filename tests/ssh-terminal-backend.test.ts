import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '../src/shared/contracts/terminalSessions'

type RecordedEvents = {
  lifecycle: TerminalLifecycleEvent[]
  data: Array<string | Buffer>
  exit: Array<{ event: TerminalLifecycleEvent; code?: number | null }>
  closed: string[]
}

class MockProxySocket extends PassThrough {
  destroyedFlag = false

  override destroy(error?: Error): this {
    if (!this.destroyedFlag) {
      this.destroyedFlag = true
      this.emit('close', error)
    }
    return this
  }
}

class MockPtyProcess {
  writes: string[] = []
  resizes: Array<{ cols: number; rows: number }> = []
  killed = false
  private dataListeners: Array<(data: string) => void> = []
  private exitListeners: Array<(event: { exitCode: number }) => void> = []

  write(data: string) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows })
  }

  kill() {
    this.killed = true
  }

  onData(callback: (data: string) => void) {
    this.dataListeners.push(callback)
  }

  onExit(callback: (event: { exitCode: number }) => void) {
    this.exitListeners.push(callback)
  }

  emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data))
  }

  emitExit(exitCode: number) {
    this.exitListeners.forEach((listener) => listener({ exitCode }))
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

const createPtyRuntime = () => {
  const processes: MockPtyProcess[] = []
  const spawnCalls: Array<{ shell: string; args: string[]; options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv } }> = []
  return {
    runtime: {
      spawn(shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) {
        const process = new MockPtyProcess()
        processes.push(process)
        spawnCalls.push({ shell, args, options })
        return process
      }
    },
    processes,
    spawnCalls
  }
}

const createSshRuntime = (
  options: { failConnect?: Error | Array<Error | null | undefined>; failShell?: Error; failForwardOut?: Error; manualReady?: boolean } = {}
) => {
  const clients: MockSshClient[] = []
  const connectConfigs: Array<Record<string, unknown>> = []
  const channels: MockSshChannel[] = []
  const execChannels: MockSshChannel[] = []
  const execCommands: string[] = []
  const forwardChannels: MockSshChannel[] = []
  const forwardOutCalls: Array<{ srcIP: string; srcPort: number; dstIP: string; dstPort: number }> = []
  const shellOptions: Array<Record<string, unknown>> = []

  class MockSshClient extends EventEmitter {
    endCalls = 0

    connect(config: Record<string, unknown>) {
      connectConfigs.push(config)
      if (options.manualReady) return
      queueMicrotask(() => {
        const failConnect = Array.isArray(options.failConnect) ? options.failConnect.shift() : options.failConnect
        if (failConnect) this.emit('error', failConnect)
        else this.emit('ready')
      })
    }

    shell(_options: Record<string, unknown>, callback: (error: Error | undefined, stream: MockSshChannel) => void) {
      shellOptions.push(_options)
      const channel = new MockSshChannel()
      channels.push(channel)
      queueMicrotask(() => {
        callback(options.failShell, channel)
      })
    }

    exec(command: string, callback: (error: Error | undefined, stream: MockSshChannel) => void) {
      execCommands.push(command)
      const channel = new MockSshChannel()
      execChannels.push(channel)
      queueMicrotask(() => {
        callback(undefined, channel)
      })
    }

    forwardOut(srcIP: string, srcPort: number, dstIP: string, dstPort: number, callback: (error: Error | undefined, stream: MockSshChannel) => void) {
      forwardOutCalls.push({ srcIP, srcPort, dstIP, dstPort })
      const channel = new MockSshChannel()
      forwardChannels.push(channel)
      queueMicrotask(() => {
        callback(options.failForwardOut, channel)
      })
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
    execChannels,
    execCommands,
    forwardChannels,
    forwardOutCalls,
    shellOptions
  }
}

const waitForMicrotasks = async (count = 1) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  }
}

const createRecorder = (): RecordedEvents => ({
  lifecycle: [],
  data: [],
  exit: [],
  closed: []
})

const loadSshTerminalBackend = async () => {
  const modulePath = '../src/main/backend/ssh/sshTerminal'
  return import(modulePath)
}

const runtimeConfig = (sshProxyConfigs: any[] = []) => ({
  sshProxyConfigs,
  sshAgentKeys: [],
  terminal: { sshAgentsStatus: false }
})

const asRuntime = (runtime: unknown) => runtime as never

const createSink = (events: RecordedEvents) => ({
  lifecycle: (event: TerminalLifecycleEvent) => events.lifecycle.push(event),
  data: (chunk: string | Buffer) => events.data.push(chunk),
  exit: (event: TerminalLifecycleEvent, code?: number | null) => events.exit.push({ event, code }),
  closed: (id: string) => events.closed.push(id)
})

const emitKeyboardInteractive = (
  client: EventEmitter,
  prompts: TerminalKeyboardInteractivePrompt[] = [{ prompt: 'Verification code:', echo: false }],
  extra: { name?: string; instructions?: string } = {}
) =>
  new Promise<string[]>((resolve) => {
    client.emit(
      'keyboard-interactive',
      extra.name || 'keyboard-interactive',
      extra.instructions || 'Enter MFA code',
      '',
      prompts,
      (responses: string[]) => resolve(responses)
    )
  })

describe('ssh terminal backend runtime', () => {
  beforeEach(async () => {
    const backend = await loadSshTerminalBackend()
    backend.configureSshTerminalBackendRuntime()
  })

  it('opens real ssh2 shell sessions through the backend runtime and keeps status out of terminal data', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    const result = backend.createSshTerminalSession(
      'ssh-unit-1',
      {
        kind: 'ssh',
        ssh: {
          host: '10.71.0.8',
          username: 'deploy',
          port: 2222,
          password: 'secret'
        },
        cols: 120,
        rows: 40,
        terminalType: 'vt220'
      },
      createSink(events)
    )
    result.session?.write('uptime\n')
    result.session?.resize(132, 44)
    await waitForMicrotasks(4)
    result.session?.resize(140, 48)
    ssh.channels[0].emit('data', Buffer.from('remote output\n'))
    ssh.channels[0].stderr.emit('data', 'remote error\n')

    expect(result.session).toBeTruthy()
    expect(result.connection).toEqual(
      expect.objectContaining({
        host: '10.71.0.8',
        username: 'deploy',
        port: 2222,
        password: 'secret'
      })
    )
    expect(ssh.connectConfigs).toEqual([
      expect.objectContaining({
        host: '10.71.0.8',
        port: 2222,
        username: 'deploy',
        password: 'secret',
        readyTimeout: 120000,
        keepaliveInterval: 10000
      })
    ])
    expect(ssh.shellOptions).toEqual([expect.objectContaining({ term: 'vt220', cols: 132, rows: 44 })])
    expect(ssh.channels[0].writes).toEqual(['uptime\n'])
    expect(ssh.channels[0].windows).toContainEqual({ rows: 48, cols: 140, height: 0, width: 0 })
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'connecting', 'connected', 'shell-ready'])
    expect(events.lifecycle[1]).toEqual(
      expect.objectContaining({
        authScope: 'target',
        sshTransport: 'direct',
        targetHost: '10.71.0.8',
        targetPort: 2222,
        targetUsername: 'deploy',
        sshAuthMethods: 'password'
      })
    )
    expect(JSON.stringify(events.lifecycle)).not.toContain('secret')
    expect(events.data.map((chunk) => chunk.toString())).toEqual(['remote output\n', 'remote error\n'])
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain('[aiopsterm]')
  })

  it('reuses direct SSH clients for repeated sessions to the same target', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const firstEvents = createRecorder()
    const secondEvents = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig(),
      getEnv: () => ({ SSH_AUTH_SOCK: '' })
    })

    const first = backend.createSshTerminalSession(
      'ssh-reuse-direct-1',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'deploy', port: 2222, password: 'secret' }, cols: 100, rows: 30 },
      createSink(firstEvents)
    )
    await waitForMicrotasks(4)
    const second = backend.createSshTerminalSession(
      'ssh-reuse-direct-2',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'deploy', port: 2222, password: 'secret' }, cols: 120, rows: 36 },
      createSink(secondEvents)
    )
    await waitForMicrotasks(4)

    expect(first.session).toBeTruthy()
    expect(second.session).toBeTruthy()
    expect(ssh.clients).toHaveLength(1)
    expect(ssh.connectConfigs).toHaveLength(1)
    expect(ssh.shellOptions).toEqual([
      expect.objectContaining({ cols: 100, rows: 30 }),
      expect.objectContaining({ cols: 120, rows: 36 })
    ])
    expect(firstEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'connected', sshTransport: 'direct', connectionReuse: 'created' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'direct', connectionReuse: 'created' })
      ])
    )
    expect(secondEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'connecting', sshTransport: 'direct', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'connected', sshTransport: 'direct', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'direct', connectionReuse: 'reused' })
      ])
    )

    second.session?.kill()
    await waitForMicrotasks(1)
    expect(ssh.clients[0].endCalls).toBe(0)
    first.session?.kill()
    await waitForMicrotasks(1)
    expect(ssh.clients[0].endCalls).toBe(0)
  })

  it('runs background commands through an independent ssh exec channel without visible shell writes', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig(),
      getEnv: () => ({ SSH_AUTH_SOCK: '' })
    })

    const result = backend.createSshTerminalSession(
      'ssh-background-exec-1',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'deploy', port: 2222, password: 'secret' } },
      createSink(events)
    )
    await waitForMicrotasks(4)
    const backgroundPromise = result.session!.runBackgroundCommand!({ command: 'pwd && hostname', cwd: '/srv/app', timeoutMs: 5000 })
    await waitForMicrotasks(1)
    ssh.execChannels[0].emit('data', Buffer.from('/srv/app\n'))
    ssh.execChannels[0].stderr.emit('data', Buffer.from('host-a\n'))
    ssh.execChannels[0].emit('close', 0)
    const background = await backgroundPromise

    expect(ssh.channels[0].writes).toEqual([])
    expect(ssh.execCommands).toEqual(["cd '/srv/app' && pwd && hostname"])
    expect(background).toEqual(
      expect.objectContaining({
        output: '/srv/app\nhost-a\n',
        exitCode: 0,
        timedOut: false
      })
    )
  })

  it('resolves asset secrets, keychain secrets, and proxy sockets before connecting', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const proxySocket = new MockProxySocket()
    const events = createRecorder()
    const proxyCalls: Array<Record<string, unknown>> = []
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () =>
        ({
          id: 'asset-proxy-1',
          name: 'proxy-host',
          title: 'proxy-host',
          host: '10.72.0.9',
          username: 'ops',
          port: 2200,
          asset_type: 'person',
          auth_type: 'keyBased',
          needProxy: true,
          proxyName: 'release-proxy',
          keychainId: 'key-1'
        }) as never,
      getAssetSecret: () => ({ password: 'saved-password' }),
      getKeychainSecret: () => ({ privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----', passphrase: 'phrase' }),
      getConfig: () => runtimeConfig([{ name: 'release-proxy', type: 'HTTP', host: '127.0.0.1', port: 8080, enableProxyIdentity: false }]),
      createSshProxySocketForAsset: async (asset: unknown, configs: unknown, targetHost: unknown, targetPort: unknown) => {
        proxyCalls.push({ asset, configs, targetHost, targetPort })
        return {
          config: { name: 'release-proxy', type: 'HTTP', host: '127.0.0.1', port: 8080, enableProxyIdentity: false },
          socket: proxySocket
        } as never
      }
    })

    const result = backend.createSshTerminalSession('ssh-proxy-1', { kind: 'ssh', assetId: 'asset-proxy-1' }, createSink(events))
    await waitForMicrotasks(4)

    expect(result.connection).toEqual(
      expect.objectContaining({
        host: '10.72.0.9',
        username: 'ops',
        port: 2200,
        password: 'saved-password',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
        passphrase: 'phrase'
      })
    )
    expect(proxyCalls).toEqual([
      expect.objectContaining({
        targetHost: '10.72.0.9',
        targetPort: 2200
      })
    ])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'proxy-opening', 'connecting', 'connected', 'shell-ready'])
    expect(events.lifecycle[1]).toEqual(expect.objectContaining({ proxyName: 'release-proxy' }))
    expect(events.lifecycle[2]).toEqual(
      expect.objectContaining({
        authScope: 'target',
        sshTransport: 'proxy',
        targetHost: '10.72.0.9',
        targetPort: 2200,
        targetUsername: 'ops',
        sshAuthMethods: 'password,privateKey'
      })
    )
    expect(JSON.stringify(events.lifecycle)).not.toContain('saved-password')
    expect(JSON.stringify(events.lifecycle)).not.toContain('BEGIN OPENSSH')
    expect(JSON.stringify(events.lifecycle)).not.toContain('phrase')
    expect(ssh.connectConfigs[0]).toEqual(
      expect.objectContaining({
        username: 'ops',
        password: 'saved-password',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
        passphrase: 'phrase',
        sock: proxySocket
      })
    )
    expect(ssh.connectConfigs[0]).not.toHaveProperty('host')
    expect(ssh.connectConfigs[0]).not.toHaveProperty('port')
  })

  it('reuses proxy-backed SSH target clients after the first proxy connection', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const proxySockets = [new MockProxySocket(), new MockProxySocket()]
    const proxyCalls: Array<Record<string, unknown>> = []
    const firstEvents = createRecorder()
    const secondEvents = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () =>
        ({
          id: 'asset-proxy-reuse',
          name: 'proxy-reuse-host',
          title: 'proxy-reuse-host',
          host: '10.72.0.10',
          username: 'ops',
          port: 2200,
          asset_type: 'person',
          auth_type: 'password',
          needProxy: true,
          proxyName: 'release-proxy'
        }) as never,
      getAssetSecret: () => ({ password: 'saved-password' }),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig([{ name: 'release-proxy', type: 'SOCKS5', host: '127.0.0.1', port: 1080, enableProxyIdentity: false }]),
      createSshProxySocketForAsset: async (asset: unknown, configs: unknown, targetHost: unknown, targetPort: unknown) => {
        proxyCalls.push({ asset, configs, targetHost, targetPort })
        return {
          config: { name: 'release-proxy', type: 'SOCKS5', host: '127.0.0.1', port: 1080, enableProxyIdentity: false },
          socket: proxySockets.shift() || new MockProxySocket()
        } as never
      }
    })

    const first = backend.createSshTerminalSession('ssh-reuse-proxy-1', { kind: 'ssh', assetId: 'asset-proxy-reuse' }, createSink(firstEvents))
    await waitForMicrotasks(4)
    const second = backend.createSshTerminalSession('ssh-reuse-proxy-2', { kind: 'ssh', assetId: 'asset-proxy-reuse' }, createSink(secondEvents))
    await waitForMicrotasks(4)

    expect(first.session).toBeTruthy()
    expect(second.session).toBeTruthy()
    expect(proxyCalls).toHaveLength(1)
    expect(ssh.clients).toHaveLength(1)
    expect(ssh.connectConfigs).toHaveLength(1)
    expect(ssh.shellOptions).toHaveLength(2)
    expect(firstEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'connecting', sshTransport: 'proxy', connectionReuse: 'created' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'proxy', connectionReuse: 'created' })
      ])
    )
    expect(secondEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'connecting', sshTransport: 'proxy', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'connected', sshTransport: 'proxy', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'proxy', connectionReuse: 'reused' })
      ])
    )
  })

  it('bridges ssh keyboard-interactive authentication through the terminal sink', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({ manualReady: true })
    const events = createRecorder()
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const results: TerminalKeyboardInteractiveResult[] = []
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    const result = backend.createSshTerminalSession(
      'ssh-mfa-1',
      { kind: 'ssh', ssh: { host: '203.0.113.10', username: 'root', port: 2222, password: 'secret' } },
      {
        ...createSink(events),
        keyboardInteractive: async (request: TerminalKeyboardInteractiveRequest) => {
          requests.push(request)
          return ['654321']
        },
        keyboardInteractiveResult: (payload: TerminalKeyboardInteractiveResult) => results.push(payload)
      }
    )
    await waitForMicrotasks(3)

    expect(result.session).toBeTruthy()
    expect(ssh.connectConfigs[0]).toEqual(
      expect.objectContaining({
        host: '203.0.113.10',
        port: 2222,
        username: 'root',
        tryKeyboard: true
      })
    )
    expect(result.cwd).toBe('/root')
    expect(events.lifecycle[0]).toEqual(expect.objectContaining({ cwd: '/root' }))

    const responses = await emitKeyboardInteractive(ssh.clients[0], [{ prompt: 'One-time password:', echo: false }], {
      name: 'Dynamic password',
      instructions: 'Enter current token'
    })
    expect(responses).toEqual(['654321'])
    expect(requests).toEqual([
      expect.objectContaining({
        id: 'ssh-mfa-1-keyboard-1',
        connectionId: 'ssh-ssh-mfa-1',
        host: '203.0.113.10',
        port: 2222,
        username: 'root',
        name: 'Dynamic password',
        instructions: 'Enter current token',
        prompts: [{ prompt: 'One-time password:', echo: false }],
        attempts: 1,
        maxAttempts: 1,
        purpose: 'keyboard-interactive',
        authScope: 'target',
        timeoutMs: 180000
      })
    ])
    expect(events.lifecycle.at(-1)).toEqual(
      expect.objectContaining({
        stage: 'connecting',
        message: 'Two-factor authentication required for root@203.0.113.10:2222'
      })
    )

    ssh.clients[0].emit('ready')
    await waitForMicrotasks(3)
    expect(results).toEqual([expect.objectContaining({ id: 'ssh-mfa-1-keyboard-1', authScope: 'target', status: 'success', attempts: 1 })])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'connecting', 'connecting', 'connected', 'shell-ready'])
  })

  it('waits for real authentication failure before prompting for a missing password', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({ manualReady: true })
    const events = createRecorder()
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const results: TerminalKeyboardInteractiveResult[] = []
    const rememberedPasswords: Array<{ assetId: string; password: string }> = []
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () =>
        ({
          id: 'asset-password-empty',
          name: 'test_hhhh',
          title: 'test_hhhh',
          host: '10.71.0.11',
          username: 'root',
          port: 22,
          asset_type: 'person',
          auth_type: 'password'
        }) as never,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig(),
      getEnv: () => ({}),
      rememberAssetPassword: (assetId: string, password: string) => {
        rememberedPasswords.push({ assetId, password })
      }
    })

    const result = backend.createSshTerminalSession('ssh-password-prompt-1', { kind: 'ssh', assetId: 'asset-password-empty' }, {
      ...createSink(events),
      keyboardInteractive: async (request: TerminalKeyboardInteractiveRequest) => {
        requests.push(request)
        return { responses: ['typed-password'], rememberPassword: true }
      },
      keyboardInteractiveResult: (payload: TerminalKeyboardInteractiveResult) => results.push(payload)
    })
    await waitForMicrotasks(3)
    expect(requests).toEqual([])
    expect(ssh.connectConfigs[0]).toEqual(
      expect.objectContaining({
        host: '10.71.0.11',
        username: 'root',
        tryKeyboard: true
      })
    )
    expect(ssh.connectConfigs[0]).not.toHaveProperty('password')

    ssh.clients[0].emit('error', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }))
    await waitForMicrotasks(6)
    ssh.clients[1].emit('ready')
    await waitForMicrotasks(3)

    expect(result.session).toBeTruthy()
    expect(requests).toEqual([
      expect.objectContaining({
        id: 'ssh-password-prompt-1-password',
        host: '10.71.0.11',
        port: 22,
        username: 'root',
        purpose: 'password',
        authScope: 'target',
        assetId: 'asset-password-empty',
        canRememberPassword: true,
        prompts: [{ prompt: 'SSH password for root@10.71.0.11:22:', echo: false }],
        attempts: 1,
        maxAttempts: 1
      })
    ])
    expect(results).toEqual([expect.objectContaining({ id: 'ssh-password-prompt-1-password', authScope: 'target', status: 'success', attempts: 1, final: true })])
    expect(ssh.connectConfigs).toHaveLength(2)
    expect(ssh.connectConfigs[1]).toEqual(
      expect.objectContaining({
        host: '10.71.0.11',
        username: 'root',
        password: 'typed-password',
        tryKeyboard: true
      })
    )
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'connecting', 'connecting', 'connecting', 'connecting', 'connected', 'shell-ready'])
    expect(events.lifecycle[1]).toEqual(expect.objectContaining({ authScope: 'target', sshTransport: 'direct', sshAuthMethods: 'keyboard-interactive' }))
    expect(events.lifecycle[2]).toEqual(expect.objectContaining({ errorCode: 'SSH_AUTH_PASSWORD_REJECTED' }))
    expect(events.lifecycle[3]).toEqual(expect.objectContaining({ authScope: 'target', authPurpose: 'password' }))
    expect(events.lifecycle[4]).toEqual(expect.objectContaining({ authScope: 'target', sshTransport: 'direct', sshAuthMethods: 'password,keyboard-interactive' }))
    expect(JSON.stringify(events.lifecycle)).not.toContain('typed-password')
    expect(rememberedPasswords).toEqual([{ assetId: 'asset-password-empty', password: 'typed-password' }])
  })

  it('reuses an authenticated direct SSH client when a typed password was not saved', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({ manualReady: true })
    const firstEvents = createRecorder()
    const secondEvents = createRecorder()
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const rememberedPasswords: Array<{ assetId: string; password: string }> = []
    const asset = {
      id: 'asset-password-unsaved',
      name: 'unsaved-password-host',
      title: 'unsaved-password-host',
      host: '10.71.0.12',
      username: 'root',
      port: 22,
      asset_type: 'person',
      auth_type: 'password'
    }
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () => asset as never,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig(),
      getEnv: () => ({}),
      rememberAssetPassword: (assetId: string, password: string) => {
        rememberedPasswords.push({ assetId, password })
      }
    })

    const first = backend.createSshTerminalSession('ssh-password-unsaved-1', { kind: 'ssh', assetId: asset.id }, {
      ...createSink(firstEvents),
      keyboardInteractive: async (request: TerminalKeyboardInteractiveRequest) => {
        requests.push(request)
        return { responses: ['typed-password'], rememberPassword: false }
      }
    })
    await waitForMicrotasks(3)
    ssh.clients[0].emit('error', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }))
    await waitForMicrotasks(6)
    ssh.clients[1].emit('ready')
    await waitForMicrotasks(3)

    expect(first.session).toBeTruthy()
    expect(requests).toHaveLength(1)
    expect(rememberedPasswords).toEqual([])
    expect(ssh.connectConfigs).toHaveLength(2)
    expect(ssh.shellOptions).toEqual([expect.objectContaining({ cols: 100, rows: 30 })])

    const second = backend.createSshTerminalSession('ssh-password-unsaved-2', { kind: 'ssh', assetId: asset.id, cols: 120, rows: 36 }, {
      ...createSink(secondEvents),
      keyboardInteractive: async (request: TerminalKeyboardInteractiveRequest) => {
        requests.push(request)
        return { responses: ['should-not-be-requested'], rememberPassword: false }
      }
    })
    await waitForMicrotasks(4)

    expect(second.session).toBeTruthy()
    expect(requests).toHaveLength(1)
    expect(ssh.clients).toHaveLength(2)
    expect(ssh.connectConfigs).toHaveLength(2)
    expect(ssh.shellOptions).toEqual([expect.objectContaining({ cols: 100, rows: 30 }), expect.objectContaining({ cols: 120, rows: 36 })])
    expect(secondEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'connecting', sshTransport: 'direct', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'connected', sshTransport: 'direct', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'direct', connectionReuse: 'reused' })
      ])
    )
    expect(JSON.stringify(firstEvents.lifecycle)).not.toContain('typed-password')
    expect(JSON.stringify(secondEvents.lifecycle)).not.toContain('typed-password')
  })

  it('prompts for a replacement password after a saved password is rejected before exiting', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({
      failConnect: [Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }), null]
    })
    const events = createRecorder()
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const results: TerminalKeyboardInteractiveResult[] = []
    const rememberedPasswords: Array<{ assetId: string; password: string }> = []
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () =>
        ({
          id: 'asset-bad-password',
          name: 'bad-password-host',
          title: 'bad-password-host',
          host: '10.71.0.12',
          username: 'root',
          port: 22,
          asset_type: 'person',
          auth_type: 'password'
        }) as never,
      getAssetSecret: () => ({ password: 'wrong-password' }),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig(),
      rememberAssetPassword: (assetId: string, password: string) => {
        rememberedPasswords.push({ assetId, password })
      }
    })

    backend.createSshTerminalSession('ssh-password-retry-1', { kind: 'ssh', assetId: 'asset-bad-password' }, {
      ...createSink(events),
      keyboardInteractive: async (request: TerminalKeyboardInteractiveRequest) => {
        requests.push(request)
        return { responses: ['correct-password'], rememberPassword: true }
      },
      keyboardInteractiveResult: (payload: TerminalKeyboardInteractiveResult) => results.push(payload)
    })
    await waitForMicrotasks(12)

    expect(requests).toEqual([
      expect.objectContaining({
        id: 'ssh-password-retry-1-password-retry',
        purpose: 'password',
        authScope: 'target',
        assetId: 'asset-bad-password',
        canRememberPassword: true,
        attempts: 2,
        maxAttempts: 2
      })
    ])
    expect(results).toContainEqual(expect.objectContaining({ id: 'ssh-password-retry-1-password-retry', authScope: 'target', status: 'success', final: true }))
    expect(ssh.connectConfigs).toEqual([
      expect.objectContaining({ password: 'wrong-password' }),
      expect.objectContaining({ password: 'correct-password' })
    ])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'connecting', 'connecting', 'connecting', 'connecting', 'connected', 'shell-ready'])
    expect(events.exit).toEqual([])
    expect(rememberedPasswords).toEqual([{ assetId: 'asset-bad-password', password: 'correct-password' }])
  })

  it('forwards jump-host keyboard-interactive authentication before connecting the target through the tunnel', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({ manualReady: true })
    const events = createRecorder()
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const results: TerminalKeyboardInteractiveResult[] = []
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: (assetId: string) => {
        if (assetId === 'asset-target') {
          return {
            id: 'asset-target',
            name: 'target-a',
            title: 'target-a',
            host: '10.80.0.20',
            username: 'deploy',
            port: 22,
            asset_type: 'person',
            auth_type: 'password',
            jumpHostId: 'asset-jump'
          } as never
        }
        if (assetId === 'asset-jump') {
          return {
            id: 'asset-jump',
            name: 'jump-b',
            title: 'jump-b',
            host: '10.80.0.10',
            username: 'ops',
            port: 2222,
            asset_type: 'person',
            auth_type: 'password'
          } as never
        }
        return null
      },
      getAssetSecret: (assetId: string) => (assetId === 'asset-target' ? { password: 'target-password' } : { password: 'jump-password' }),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    backend.createSshTerminalSession('ssh-jump-mfa-1', { kind: 'ssh', assetId: 'asset-target' }, {
      ...createSink(events),
      keyboardInteractive: async (request: TerminalKeyboardInteractiveRequest) => {
        requests.push(request)
        return ['987654']
      },
      keyboardInteractiveResult: (payload: TerminalKeyboardInteractiveResult) => results.push(payload)
    })
    await waitForMicrotasks(3)

    expect(ssh.connectConfigs).toHaveLength(1)
    expect(ssh.connectConfigs[0]).toEqual(expect.objectContaining({ host: '10.80.0.10', port: 2222, username: 'ops', password: 'jump-password' }))

    const jumpResponses = await emitKeyboardInteractive(ssh.clients[0], [{ prompt: 'OTP:', echo: false }], {
      name: 'Jump OTP',
      instructions: 'Enter jump host OTP'
    })
    expect(jumpResponses).toEqual(['987654'])
    expect(requests).toEqual([
      expect.objectContaining({
        id: 'ssh-jump-mfa-1-jump-keyboard-1',
        host: '10.80.0.10',
        port: 2222,
        username: 'ops',
        purpose: 'keyboard-interactive',
        authScope: 'jump',
        prompts: [{ prompt: 'OTP:', echo: false }],
        attempts: 1,
        maxAttempts: 1
      })
    ])

    ssh.clients[0].emit('ready')
    await waitForMicrotasks(4)
    expect(ssh.forwardOutCalls).toEqual([{ srcIP: '127.0.0.1', srcPort: 0, dstIP: '10.80.0.20', dstPort: 22 }])
    expect(ssh.connectConfigs[1]).toEqual(
      expect.objectContaining({
        username: 'deploy',
        password: 'target-password',
        sock: ssh.forwardChannels[0],
        tryKeyboard: true
      })
    )
    expect(ssh.connectConfigs[1]).not.toHaveProperty('host')
    expect(ssh.connectConfigs[1]).not.toHaveProperty('port')

    ssh.clients[1].emit('ready')
    await waitForMicrotasks(3)
    expect(results).toEqual([expect.objectContaining({ id: 'ssh-jump-mfa-1-jump-keyboard-1', authScope: 'jump', status: 'success', attempts: 1 })])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'proxy-opening', 'connecting', 'proxy-opening', 'connecting', 'connected', 'shell-ready'])
    expect(events.lifecycle[1]).toEqual(
      expect.objectContaining({
        authScope: 'jump',
        sshTransport: 'jump',
        jumpHost: '10.80.0.10',
        jumpPort: 2222,
        jumpUsername: 'ops',
        targetHost: '10.80.0.20',
        targetPort: 22,
        targetUsername: 'deploy',
        sshAuthMethods: 'password,keyboard-interactive'
      })
    )
    expect(events.lifecycle[3]).toEqual(
      expect.objectContaining({
        authScope: 'jump',
        sshTransport: 'jump',
        message: 'Opening SSH jump tunnel to deploy@10.80.0.20:22'
      })
    )
    expect(events.lifecycle[4]).toEqual(
      expect.objectContaining({
        authScope: 'target',
        sshTransport: 'jump',
        jumpHost: '10.80.0.10',
        targetHost: '10.80.0.20',
        sshAuthMethods: 'password,keyboard-interactive'
      })
    )
    expect(JSON.stringify(events.lifecycle)).not.toContain('jump-password')
    expect(JSON.stringify(events.lifecycle)).not.toContain('target-password')
  })

  it('reuses jump and target SSH clients for repeated jump-host sessions', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const firstEvents = createRecorder()
    const secondEvents = createRecorder()
    const assets = (assetId: string) => {
      if (assetId === 'asset-target') {
        return {
          id: 'asset-target',
          name: 'target-a',
          title: 'target-a',
          host: '10.80.0.20',
          username: 'deploy',
          port: 22,
          asset_type: 'person',
          auth_type: 'password',
          jumpHostId: 'asset-jump'
        } as never
      }
      if (assetId === 'asset-jump') {
        return {
          id: 'asset-jump',
          name: 'jump-b',
          title: 'jump-b',
          host: '10.80.0.10',
          username: 'ops',
          port: 2222,
          asset_type: 'person',
          auth_type: 'password'
        } as never
      }
      return null
    }
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: assets,
      getAssetSecret: (assetId: string) => (assetId === 'asset-target' ? { password: 'target-password' } : { password: 'jump-password' }),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig(),
      getEnv: () => ({ SSH_AUTH_SOCK: '' })
    })

    const first = backend.createSshTerminalSession('ssh-reuse-jump-1', { kind: 'ssh', assetId: 'asset-target' }, createSink(firstEvents))
    await waitForMicrotasks(8)
    const second = backend.createSshTerminalSession('ssh-reuse-jump-2', { kind: 'ssh', assetId: 'asset-target' }, createSink(secondEvents))
    await waitForMicrotasks(4)

    expect(first.session).toBeTruthy()
    expect(second.session).toBeTruthy()
    expect(ssh.clients).toHaveLength(2)
    expect(ssh.connectConfigs).toHaveLength(2)
    expect(ssh.forwardOutCalls).toHaveLength(1)
    expect(ssh.shellOptions).toHaveLength(2)
    expect(firstEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'proxy-opening', authScope: 'jump', sshTransport: 'jump', connectionReuse: 'created' }),
        expect.objectContaining({ stage: 'connecting', authScope: 'target', sshTransport: 'jump', connectionReuse: 'created' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'jump', connectionReuse: 'created' })
      ])
    )
    expect(secondEvents.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'connecting', authScope: 'target', sshTransport: 'jump', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'connected', sshTransport: 'jump', connectionReuse: 'reused' }),
        expect.objectContaining({ stage: 'shell-ready', sshTransport: 'jump', connectionReuse: 'reused' })
      ])
    )
    expect(JSON.stringify(secondEvents.lifecycle)).not.toContain('jump-password')
    expect(JSON.stringify(secondEvents.lifecycle)).not.toContain('target-password')
  })

  it('falls back to a relay shell when jump-host TCP forwarding is rejected', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({
      manualReady: true,
      failForwardOut: new Error('(SSH) Channel open failure: open failed')
    })
    const pty = createPtyRuntime()
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      loadPty: () => pty.runtime,
      getEnv: () => ({ PATH: '/usr/bin', HOME: '/tmp' }),
      getSshControlDir: () => '/tmp/aiopsterm-ssh-control-vitest-created',
      getAsset: (assetId: string) => {
        if (assetId === 'asset-relay-target') {
          return {
            id: 'asset-relay-target',
            name: 'target-relay-a',
            title: 'target-relay-a',
            host: 'target.internal',
            username: 'root',
            port: 22,
            asset_type: 'person',
            auth_type: 'keyBased',
            jumpHostId: 'asset-relay'
          } as never
        }
        if (assetId === 'asset-relay') {
          return {
            id: 'asset-relay',
            name: 'relay-b',
            title: 'relay-b',
            host: 'relay.example',
            username: 'ops',
            port: 2222,
            asset_type: 'person',
            auth_type: 'password'
          } as never
        }
        return null
      },
      getAssetSecret: (assetId: string) => (assetId === 'asset-relay' ? { password: 'relay-password' } : {}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    const result = backend.createSshTerminalSession(
      'ssh-relay-shell-1',
      { kind: 'ssh', assetId: 'asset-relay-target', cols: 144, rows: 48, terminalType: 'linux' },
      createSink(events)
    )
    result.session?.write('queued-before-relay\n')
    await waitForMicrotasks(2)
    expect(pty.spawnCalls).toEqual([])

    ssh.clients[0].emit('ready')
    await waitForMicrotasks(4)

    expect(ssh.forwardOutCalls).toEqual([{ srcIP: '127.0.0.1', srcPort: 0, dstIP: 'target.internal', dstPort: 22 }])
    expect(pty.spawnCalls).toHaveLength(1)
    const spawn = pty.spawnCalls[0]
    expect(spawn.shell).toBe('ssh')
    expect(spawn.args).toEqual(
      expect.arrayContaining([
        '-F',
        '/dev/null',
        'ControlMaster=auto',
        'ControlPersist=yes',
        'ServerAliveInterval=60',
        'HostKeyAlgorithms=+ssh-rsa',
        'PubkeyAcceptedAlgorithms=+ssh-rsa',
        '-tt',
        '-p',
        '2222',
        'ops@relay.example'
      ])
    )
    expect(spawn.args).toContainEqual(expect.stringMatching(/^ControlPath=\/tmp\/aiopsterm-ssh-control-vitest-created\/cm-[a-f0-9]{24}$/))
    expect(spawn.options).toEqual(
      expect.objectContaining({
        name: 'linux',
        cols: 144,
        rows: 48,
        cwd: '/tmp',
        env: expect.objectContaining({
          PATH: '/usr/bin',
          TERM: 'linux',
          AIOPSTERM_TRANSPORT: 'relay-shell',
          AIOPSTERM_RELAY_HOST: 'relay.example',
          AIOPSTERM_TARGET_HOST: 'target.internal'
        })
      })
    )
    expect(pty.processes[0].writes).toEqual([])
    pty.processes[0].emitData("Please input user's password: ")
    expect(pty.processes[0].writes).toEqual([])
    pty.processes[0].emitData('ops@relay:~$ ')
    expect(pty.processes[0].writes).toHaveLength(1)
    const command = pty.processes[0].writes[0]
    expect(command).toBe("ssh -tt -p 22 -- 'root@target.internal'\n")
    expect(command).not.toContain('queued-before-relay')
    expect(command).not.toContain('__AIO_CTX')
    expect(command).not.toContain('printf')
    expect(command).not.toContain('export')
    expect(command).not.toContain('stty')
    result.session?.write('uptime\n')
    result.session?.resize(120, 36)
    expect(pty.processes[0].writes).toEqual([command, 'uptime\n'])
    expect(pty.processes[0].resizes).toEqual([{ cols: 120, rows: 36 }])

    pty.processes[0].emitData(command)
    pty.processes[0].emitData('target login banner\n[root@target.internal ~]# ')
    expect(pty.processes[0].writes).toEqual([command, 'uptime\n', 'queued-before-relay\n'])

    expect(events.data.map((chunk) => chunk.toString()).join('')).toBe("Please input user's password: ops@relay:~$ target login banner\n[root@target.internal ~]# ")
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain('__AIO_CTX_')
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain(command.trim())
    expect(events.lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'proxy-opening',
          sshTransport: 'relay-shell',
          authScope: 'jump',
          remoteHop: 'unknown',
          endpointConfidence: 'unknown',
          errorCode: 'SSH_JUMP_FORWARD_FAILED',
          errorMessage: 'SSH jump host forward failed: (SSH) Channel open failure: open failed',
          connectionReuse: 'created',
          jumpHost: 'relay.example',
          targetHost: 'target.internal'
        }),
        expect.objectContaining({
          stage: 'connected',
          sshTransport: 'relay-shell',
          authScope: 'jump',
          connectionReuse: 'created',
          remoteHop: 'relay',
          expectedHost: 'relay.example',
          endpointConfidence: 'inferred'
        }),
        expect.objectContaining({
          stage: 'shell-ready',
          sshTransport: 'relay-shell',
          authScope: 'target',
          remoteHop: 'target',
          expectedHost: 'target.internal',
          actualHost: 'target.internal',
          actualUsername: 'root',
          endpointConfidence: 'inferred'
        })
      ])
    )

    pty.processes[0].emitExit(0)
    expect(events.lifecycle.at(-1)).toEqual(expect.objectContaining({ stage: 'closed', sshTransport: 'relay-shell', remoteHop: 'target' }))
    expect(events.closed).toEqual(['ssh-relay-shell-1'])
    expect(result.session).toBeTruthy()
  })

  it('runs relay-shell background commands in a hidden relay pty instead of the visible terminal pty', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime({
      manualReady: true,
      failForwardOut: new Error('(SSH) Channel open failure: open failed')
    })
    const pty = createPtyRuntime()
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      loadPty: () => pty.runtime,
      getEnv: () => ({ PATH: '/usr/bin', HOME: '/tmp' }),
      getSshControlDir: () => '/tmp/aiopsterm-ssh-control-vitest-background',
      getAsset: (assetId: string) => {
        if (assetId === 'asset-relay-target') {
          return {
            id: 'asset-relay-target',
            name: 'target-relay-a',
            title: 'target-relay-a',
            host: 'target.internal',
            username: 'root',
            port: 22,
            asset_type: 'person',
            auth_type: 'keyBased',
            jumpHostId: 'asset-relay'
          } as never
        }
        if (assetId === 'asset-relay') {
          return {
            id: 'asset-relay',
            name: 'relay-b',
            title: 'relay-b',
            host: 'relay.example',
            username: 'ops',
            port: 2222,
            asset_type: 'person',
            auth_type: 'password'
          } as never
        }
        return null
      },
      getAssetSecret: (assetId: string) => (assetId === 'asset-relay' ? { password: 'relay-password' } : {}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    const result = backend.createSshTerminalSession(
      'ssh-relay-background-1',
      { kind: 'ssh', assetId: 'asset-relay-target', cols: 100, rows: 30 },
      createSink(events)
    )
    await waitForMicrotasks(2)
    ssh.clients[0].emit('ready')
    await waitForMicrotasks(4)
    pty.processes[0].emitData('ops@relay:~$ ')
    pty.processes[0].emitData('target login banner\n[root@target.internal ~]# ')
    expect(pty.processes[0].writes).toEqual(["ssh -tt -p 22 -- 'root@target.internal'\n"])

    const backgroundPromise = result.session!.runBackgroundCommand!({ command: 'pwd && hostname', cwd: '/root', timeoutMs: 5000 })
    expect(pty.spawnCalls).toHaveLength(2)
    const hidden = pty.processes[1]
    expect(hidden).not.toBe(pty.processes[0])
    hidden.emitData('ops@relay:~$ ')
    expect(hidden.writes).toEqual(["ssh -tt -p 22 -- 'root@target.internal'\n"])
    hidden.emitData('target login banner\n[root@target.internal ~]# ')
    expect(hidden.writes).toHaveLength(2)
    const command = hidden.writes[1]
    expect(command).toContain("echo '__AIOPSTERM_BACKGROUND_START_")
    expect(command).toContain("cd '/root' && pwd && hostname")
    expect(command).toContain('__aiopsterm_status')
    const commandId = command.match(/__AIOPSTERM_BACKGROUND_START_([a-zA-Z0-9_-]+)__/)?.[1] || ''
    hidden.emitData(`__AIOPSTERM_BACKGROUND_START_${commandId}__\n/root\ntarget.internal\n__AIOPSTERM_BACKGROUND_END_${commandId}__:0\n[root@target.internal ~]# `)
    const background = await backgroundPromise

    expect(pty.processes[0].writes).toEqual(["ssh -tt -p 22 -- 'root@target.internal'\n"])
    expect(background).toEqual(
      expect.objectContaining({
        output: '/root\ntarget.internal',
        exitCode: 0,
        timedOut: false
      })
    )
  })

  it('fails closed when ssh2 runtime is unavailable or target fields are invalid', async () => {
    const backend = await loadSshTerminalBackend()
    const unavailable = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: null,
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    const noRuntime = backend.createSshTerminalSession(
      'ssh-no-runtime',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'ops', port: 22 } },
      createSink(unavailable)
    )
    expect(noRuntime.session).toBeNull()
    expect(unavailable.lifecycle).toEqual([
      expect.objectContaining({
        id: 'ssh-no-runtime',
        stage: 'error',
        message: 'SSH runtime is not available.',
        errorMessage: 'ssh2 runtime is not available. Run npm install and rebuild native modules if needed.'
      })
    ])
    expect(unavailable.exit).toEqual([{ event: unavailable.lifecycle[0], code: 1 }])
    expect(unavailable.data).toEqual([])

    const invalid = createRecorder()
    const invalidResult = backend.createSshTerminalSession('ssh-invalid', { kind: 'ssh', ssh: { host: '', username: '', port: 0 } }, createSink(invalid))
    expect(invalidResult.session).toBeNull()
    expect(invalid.lifecycle).toEqual([
      expect.objectContaining({
        id: 'ssh-invalid',
        stage: 'error',
        message: 'SSH target is invalid.',
        errorMessage: 'SSH target requires host, username, and a valid port.'
      })
    ])
    expect(invalid.exit).toEqual([{ event: invalid.lifecycle[0], code: 1 }])
    expect(invalid.data).toEqual([])
  })

  it('emits structured shell and connection failures without terminal data fabrication', async () => {
    const backend = await loadSshTerminalBackend()
    const shellFailureSsh = createSshRuntime({ failShell: new Error('shell denied') })
    const shellEvents = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(shellFailureSsh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    backend.createSshTerminalSession(
      'ssh-shell-fail',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'ops', port: 22 } },
      createSink(shellEvents)
    )
    await waitForMicrotasks(4)
    expect(shellEvents.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'connecting', 'connected', 'error'])
    expect(shellEvents.lifecycle[3]).toEqual(expect.objectContaining({ message: 'SSH shell failed.', errorMessage: 'shell denied' }))
    expect(shellEvents.exit).toEqual([{ event: shellEvents.lifecycle[3], code: 1 }])
    expect(shellEvents.data).toEqual([])

    const connectFailureSsh = createSshRuntime({ failConnect: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    const connectEvents = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(connectFailureSsh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })
    backend.createSshTerminalSession(
      'ssh-connect-fail',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'ops', port: 22 } },
      createSink(connectEvents)
    )
    await waitForMicrotasks(3)
    expect(connectEvents.lifecycle).toEqual([
      expect.objectContaining({ stage: 'connecting' }),
      expect.objectContaining({
        stage: 'connecting',
        authScope: 'target',
        sshTransport: 'direct',
        targetHost: '10.71.0.8'
      }),
      expect.objectContaining({
        stage: 'error',
        message: 'SSH connection failed.',
        reason: 'network',
        isNetworkDisconnect: true,
        errorCode: 'ECONNRESET',
        errorMessage: 'read ECONNRESET'
      })
    ])
    expect(connectEvents.exit).toEqual([{ event: connectEvents.lifecycle[2], code: 1 }])
    expect(connectEvents.data).toEqual([])
  })

  it('reports ssh authentication failures with actionable diagnostics', async () => {
    const backend = await loadSshTerminalBackend()
    const passwordDisabledSsh = createSshRuntime({
      failConnect: Object.assign(new Error('Permission denied (publickey).'), { level: 'client-authentication' })
    })
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(passwordDisabledSsh.runtime),
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    backend.createSshTerminalSession(
      'ssh-password-disabled',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'root', port: 22, password: 'secret' } },
      createSink(events)
    )
    await waitForMicrotasks(3)

    expect(events.lifecycle).toEqual([
      expect.objectContaining({ stage: 'connecting' }),
      expect.objectContaining({
        stage: 'connecting',
        authScope: 'target',
        sshTransport: 'direct',
        sshAuthMethods: 'password',
        targetHost: '10.71.0.8'
      }),
      expect.objectContaining({
        stage: 'error',
        message: 'SSH connection failed.',
        reason: 'error',
        isNetworkDisconnect: false,
        errorCode: 'SSH_AUTH_PASSWORD_DISABLED',
        errorMessage: expect.stringContaining('服务器未开放密码登录')
      })
    ])
    expect(events.lifecycle[2].errorMessage).toContain('PasswordAuthentication')
    expect(events.exit).toEqual([{ event: events.lifecycle[2], code: 1 }])
    expect(events.data).toEqual([])
  })

  it('closes sessions, proxy sockets, and registry state from the backend kill path', async () => {
    const backend = await loadSshTerminalBackend()
    const ssh = createSshRuntime()
    const proxySocket = new MockProxySocket()
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      ssh2Runtime: asRuntime(ssh.runtime),
      getAsset: () =>
        ({
          id: 'asset-proxy-close',
          name: 'proxy-close',
          host: '10.72.0.10',
          username: 'ops',
          port: 22,
          needProxy: true,
          proxyName: 'release-proxy'
        }) as never,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig([{ name: 'release-proxy', type: 'HTTP', host: '127.0.0.1', port: 8080, enableProxyIdentity: false }]),
      createSshProxySocketForAsset: async () =>
        ({
          config: { name: 'release-proxy', type: 'HTTP', host: '127.0.0.1', port: 8080, enableProxyIdentity: false },
          socket: proxySocket
        }) as never
    })

    const result = backend.createSshTerminalSession('ssh-kill-1', { kind: 'ssh', assetId: 'asset-proxy-close' }, createSink(events))
    await waitForMicrotasks(4)
    result.session?.kill('manual')

    expect(events.lifecycle.map((event) => event.stage)).toEqual(['connecting', 'proxy-opening', 'connecting', 'connected', 'shell-ready', 'closed'])
    expect(events.lifecycle.at(-1)).toEqual(expect.objectContaining({ reason: 'manual', message: 'Terminal closed by user.' }))
    expect(events.exit.at(-1)).toEqual({ event: events.lifecycle.at(-1), code: 0 })
    expect(events.closed).toEqual(['ssh-kill-1'])
    expect(ssh.channels[0].closeCalls).toBe(1)
    expect(proxySocket.destroyedFlag).toBe(false)
    expect(ssh.clients[0].endCalls).toBe(0)

    backend.configureSshTerminalBackendRuntime()
    expect(proxySocket.destroyedFlag).toBe(true)
    expect(ssh.clients[0].endCalls).toBe(1)
  })

  it('uses an explicit backend double only when configured for e2e harnesses', async () => {
    const backend = await loadSshTerminalBackend()
    const events = createRecorder()
    backend.configureSshTerminalBackendRuntime({
      useBackendDouble: true,
      ssh2Runtime: null,
      getAsset: () => null,
      getAssetSecret: () => ({}),
      getKeychainSecret: () => ({}),
      getConfig: () => runtimeConfig()
    })

    const result = backend.createSshTerminalSession(
      'ssh-double-1',
      { kind: 'ssh', ssh: { host: '10.71.0.8', username: 'ops', port: 22 } },
      createSink(events)
    )
    result.session?.write('ignored\n')

    expect(result.session).toBeTruthy()
    expect(events.lifecycle).toEqual([expect.objectContaining({ id: 'ssh-double-1', stage: 'shell-ready' })])
    expect(events.data).toEqual([])
  })
})
