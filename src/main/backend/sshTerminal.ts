import type { ClientChannel, ConnectConfig } from 'ssh2'
import type {
  AiopsAssetRecord,
  SshProxyConfig,
  TerminalCreateOptions,
  TerminalDisconnectReason,
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent,
  UserConfig
} from '@shared/preload'
import { shouldUseSshTerminalBackendDouble } from '@shared/runtimeSwitches'
import { applyConfiguredSshAgentAuth } from './sshAgent'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'
import { loadSsh2 } from './ssh2Runtime'
import { createTerminalErrorLifecycleEvent, createTerminalLifecycleEvent, diagnoseSshConnectionError, type SshTerminalConnectionTarget } from './terminal'

type AssetSecret = {
  password?: string
  privateKey?: string
  passphrase?: string
}

type SshTerminalAsset = Partial<
  Pick<
    AiopsAssetRecord,
    | 'id'
    | 'name'
    | 'title'
    | 'host'
    | 'username'
    | 'port'
    | 'asset_type'
    | 'organizationId'
    | 'group_name'
    | 'auth_type'
    | 'needProxy'
    | 'proxyName'
    | 'keychainId'
  >
>

export type SshTerminalTarget = SshTerminalConnectionTarget & {
  asset?: SshTerminalAsset | null
  password?: string
  privateKey?: string
  passphrase?: string
}

export type SshTerminalSession = {
  write(data: string | Buffer): void
  resize(cols: number, rows: number): void
  kill(reason?: TerminalDisconnectReason): void
}

type SshTerminalChannel = Pick<ClientChannel, 'write' | 'on' | 'stderr'> & {
  close?: () => void
  setWindow?: (...args: number[]) => void
}

type SshTerminalClient = {
  on(event: 'ready', listener: () => void): SshTerminalClient
  on(event: 'error', listener: (error: Error) => void): SshTerminalClient
  on(event: 'close' | 'end', listener: () => void): SshTerminalClient
  on(
    event: 'keyboard-interactive',
    listener: (
      name: string,
      instructions: string,
      instructionsLang: string,
      prompts: TerminalKeyboardInteractivePrompt[],
      finish: (responses: string[]) => void
    ) => void
  ): SshTerminalClient
  connect(config: ConnectConfig): unknown
  shell(options: Record<string, unknown>, callback: (error: Error | undefined, stream: SshTerminalChannel) => void): unknown
  end(): unknown
}

type SshTerminalSsh2Runtime = {
  Client: new () => SshTerminalClient
}

type SshTerminalRuntimeUserConfig = {
  sshProxyConfigs?: SshProxyConfig[]
  sshAgentKeys?: UserConfig['sshAgentKeys']
  terminal?: Partial<NonNullable<UserConfig['terminal']>> | null
}

type SshTerminalRuntimeConfig = {
  getConfig?: () => SshTerminalRuntimeUserConfig
  getAsset?: (id: string) => AiopsAssetRecord | null
  getAssetSecret?: (id: string) => AssetSecret
  getKeychainSecret?: (id: string) => AssetSecret
  ssh2Runtime?: SshTerminalSsh2Runtime | null
  createSshProxySocketForAsset?: typeof createSshProxySocketForAsset
  useBackendDouble?: boolean
  readyTimeoutMs?: number
  keepaliveIntervalMs?: number
}

type SshTerminalEventSink = {
  lifecycle: (event: TerminalLifecycleEvent) => void
  exit: (event: TerminalLifecycleEvent, code?: number | null) => void
  data: (chunk: string | Buffer) => void
  keyboardInteractive?: (request: TerminalKeyboardInteractiveRequest) => Promise<string[]>
  keyboardInteractiveResult?: (result: TerminalKeyboardInteractiveResult) => void
  closed?: (id: string) => void
}

export type SshTerminalCreateResult = {
  shell: 'ssh'
  cwd: string
  session: SshTerminalSession | null
  connection: SshTerminalTarget
  lifecycle: TerminalLifecycleEvent
}

const runtimeConfig: SshTerminalRuntimeConfig = {}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const textSecret = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length ? value : undefined
}

export const configureSshTerminalBackendRuntime = (config: SshTerminalRuntimeConfig = {}) => {
  runtimeConfig.getConfig = config.getConfig
  runtimeConfig.getAsset = config.getAsset
  runtimeConfig.getAssetSecret = config.getAssetSecret
  runtimeConfig.getKeychainSecret = config.getKeychainSecret
  runtimeConfig.ssh2Runtime = config.ssh2Runtime
  runtimeConfig.createSshProxySocketForAsset = config.createSshProxySocketForAsset
  runtimeConfig.useBackendDouble = config.useBackendDouble
  runtimeConfig.readyTimeoutMs = config.readyTimeoutMs
  runtimeConfig.keepaliveIntervalMs = config.keepaliveIntervalMs
}

const getRuntimeConfig = () =>
  runtimeConfig.getConfig?.() || {
    sshProxyConfigs: [],
    sshAgentKeys: [],
    terminal: undefined
  }

const getSsh2Runtime = (): SshTerminalSsh2Runtime | null =>
  runtimeConfig.ssh2Runtime === undefined ? (loadSsh2() as SshTerminalSsh2Runtime | null) : runtimeConfig.ssh2Runtime

const getProxySocketForAsset = () => runtimeConfig.createSshProxySocketForAsset || createSshProxySocketForAsset

const resolveAsset = (assetId: string) => runtimeConfig.getAsset?.(assetId) || null

const resolveAssetSecret = (assetId: string) => runtimeConfig.getAssetSecret?.(assetId) || {}

const resolveKeychainSecret = (keychainId: string) => runtimeConfig.getKeychainSecret?.(keychainId) || {}

const shouldUseBackendDouble = () => runtimeConfig.useBackendDouble === true || shouldUseSshTerminalBackendDouble()

export const resolveSshTerminalTarget = (options: TerminalCreateOptions): SshTerminalTarget => {
  const asset = options.assetId ? resolveAsset(options.assetId) : null
  const secret = options.assetId ? resolveAssetSecret(options.assetId) : {}
  const keychainSecret = asset?.keychainId ? resolveKeychainSecret(asset.keychainId) : {}
  const host = cleanText(options.ssh?.host) || cleanText(asset?.host)
  const username = cleanText(options.ssh?.username) || cleanText(asset?.username)
  const port = Number(options.ssh?.port || asset?.port || 22)
  const requestProxyName = cleanText(options.ssh?.proxyName)
  const targetProxyName = asset?.needProxy ? cleanText(asset.proxyName) : requestProxyName
  return {
    asset: asset || (options.ssh?.needProxy ? { needProxy: true, proxyName: targetProxyName } : null),
    host,
    username,
    port,
    password: textSecret(options.ssh?.password) || textSecret(secret.password),
    privateKey: textSecret(options.ssh?.privateKey) || textSecret(secret.privateKey) || textSecret(keychainSecret.privateKey),
    passphrase: textSecret(options.ssh?.passphrase) || textSecret(secret.passphrase) || textSecret(keychainSecret.passphrase),
    title: cleanText(options.title) || cleanText(asset?.name) || cleanText(asset?.title) || host
  }
}

const createLifecycleBase = (id: string, target: SshTerminalTarget) => {
  const cwd = target.username ? `/home/${target.username}` : '~'
  return {
    cwd,
    lifecycleBase: {
      kind: 'ssh' as const,
      shell: 'ssh',
      cwd,
      host: target.host,
      port: target.port,
      username: target.username,
      connectionId: `ssh-${id}`
    }
  }
}

const sendLifecycle = (id: string, sink: SshTerminalEventSink, event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number }) => {
  const payload = createTerminalLifecycleEvent(id, event)
  sink.lifecycle(payload)
  return payload
}

const sendErrorLifecycle = (
  id: string,
  sink: SshTerminalEventSink,
  error: unknown,
  event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>>
) => {
  const payload = createTerminalErrorLifecycleEvent(id, 'ssh', error, event)
  sink.lifecycle(payload)
  return payload
}

const failBeforeSession = (
  id: string,
  target: SshTerminalTarget,
  sink: SshTerminalEventSink,
  error: unknown,
  message: string,
  code = 1
): SshTerminalCreateResult => {
  const { cwd, lifecycleBase } = createLifecycleBase(id, target)
  const lifecycle = sendErrorLifecycle(id, sink, error, {
    ...lifecycleBase,
    code,
    message
  })
  sink.exit(lifecycle, code)
  return {
    shell: 'ssh',
    cwd,
    session: null,
    connection: target,
    lifecycle
  }
}

const isValidTarget = (target: SshTerminalTarget) =>
  Boolean(target.host && target.username && Number.isInteger(target.port) && target.port >= 1 && target.port <= 65535)

const keyboardInteractiveTimeoutMs = () => 180000

const maxKeyboardInteractiveAttempts = () => 5

const normalizeKeyboardInteractivePrompts = (prompts: TerminalKeyboardInteractivePrompt[] = []): TerminalKeyboardInteractivePrompt[] =>
  prompts
    .map((prompt) => ({
      prompt: cleanText(prompt?.prompt) || 'Verification code:',
      echo: prompt?.echo === true
    }))
    .filter((prompt) => prompt.prompt)

const createBackendDoubleSession = (
  id: string,
  target: SshTerminalTarget,
  sink: SshTerminalEventSink
): SshTerminalCreateResult => {
  const { cwd, lifecycleBase } = createLifecycleBase(id, target)
  let closed = false
  const session: SshTerminalSession = {
    write: () => undefined,
    resize: () => undefined,
    kill(reason: TerminalDisconnectReason = 'manual') {
      if (closed) return
      closed = true
      sink.closed?.(id)
      const lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'closed',
        code: 0,
        reason,
        isNetworkDisconnect: false,
        message: reason === 'manual' ? 'Terminal closed by user.' : 'SSH terminal closed.'
      })
      sink.exit(lifecycle, 0)
    }
  }
  const lifecycle = createTerminalLifecycleEvent(id, {
    ...lifecycleBase,
    stage: 'shell-ready',
    message: target.host ? `SSH shell ready ${target.username}@${target.host}:${target.port}` : 'SSH shell ready.'
  })
  sink.lifecycle(lifecycle)
  return {
    shell: 'ssh',
    cwd,
    session,
    connection: target,
    lifecycle
  }
}

export const createSshTerminalSession = (
  id: string,
  options: TerminalCreateOptions,
  sink: SshTerminalEventSink
): SshTerminalCreateResult => {
  const target = resolveSshTerminalTarget(options)
  const { cwd, lifecycleBase } = createLifecycleBase(id, target)

  if (!isValidTarget(target)) {
    return failBeforeSession(id, target, sink, new Error('SSH target requires host, username, and a valid port.'), 'SSH target is invalid.')
  }

  if (shouldUseBackendDouble()) {
    return createBackendDoubleSession(id, target, sink)
  }

  const ssh2 = getSsh2Runtime()
  if (!ssh2) {
    return failBeforeSession(
      id,
      target,
      sink,
      new Error('ssh2 runtime is not available. Run npm install and rebuild native modules if needed.'),
      'SSH runtime is not available.'
    )
  }

  const client = new ssh2.Client()
  let stream: SshTerminalChannel | null = null
  let proxySocket: SshProxySocket | null = null
  let closed = false
  let cols = options.cols || 100
  let rows = options.rows || 30
  const pendingWrites: Array<string | Buffer> = []
  let keyboardInteractiveAttempts = 0
  let activeKeyboardInteractiveRequestId = ''
  let hasConfiguredAgentAuth = false

  let lifecycle = sendLifecycle(id, sink, {
    ...lifecycleBase,
    stage: 'connecting',
    message: `Connecting ${target.username}@${target.host}:${target.port}`
  })

  const finish = (
    code: number | null,
    reason: TerminalDisconnectReason,
    event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> = {}
  ) => {
    if (closed) return
    closed = true
    sink.closed?.(id)
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...event,
      stage: reason === 'error' || reason === 'network' ? 'error' : 'closed',
      code,
      reason,
      isNetworkDisconnect: reason === 'network' || event.isNetworkDisconnect === true,
      message:
        event.message ||
        (reason === 'manual'
          ? 'Terminal closed by user.'
          : reason === 'process'
            ? 'Terminal process exited.'
            : reason === 'network'
              ? 'SSH connection closed by network.'
              : 'SSH terminal closed.')
    })
    sink.exit(lifecycle, code)
  }

  const fail = (
    error: unknown,
    message: string,
    code = 1,
    event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> = {}
  ) => {
    if (closed) return
    closed = true
    sink.closed?.(id)
    lifecycle = sendErrorLifecycle(id, sink, error, {
      ...lifecycleBase,
      ...event,
      code,
      message
    })
    sink.exit(lifecycle, code)
  }

  const sshConnectionErrorEvent = (error: unknown): Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> => {
    const diagnosis = diagnoseSshConnectionError(error, {
      authType: target.asset?.auth_type,
      hasPassword: Boolean(target.password),
      hasPrivateKey: Boolean(target.privateKey),
      hasAgent: hasConfiguredAgentAuth,
      tryKeyboard: Boolean(sink.keyboardInteractive),
      username: target.username,
      host: target.host,
      port: target.port
    })
    return {
      reason: diagnosis.reason,
      isNetworkDisconnect: diagnosis.isNetworkDisconnect,
      errorCode: diagnosis.errorCode,
      errorMessage: diagnosis.errorMessage
    }
  }

  const session: SshTerminalSession = {
    write(data: string | Buffer) {
      if (closed) return
      if (stream) {
        stream.write(data)
      } else {
        pendingWrites.push(data)
      }
    },
    resize(nextCols: number, nextRows: number) {
      cols = nextCols
      rows = nextRows
      if (stream && typeof (stream as unknown as { setWindow?: (...args: number[]) => void }).setWindow === 'function') {
        ;(stream as unknown as { setWindow: (...args: number[]) => void }).setWindow(rows, cols, 0, 0)
      }
    },
    kill(reason: TerminalDisconnectReason = 'manual') {
      finish(0, reason)
      try {
        if (stream?.close) stream.close()
      } catch {}
      try {
        proxySocket?.destroy()
      } catch {}
      try {
        client.end()
      } catch {}
    }
  }

  client
    .on('keyboard-interactive', (name, instructions, _instructionsLang, prompts, finishKeyboardInteractive) => {
      const requestId = `${id}-keyboard-${keyboardInteractiveAttempts + 1}`
      const maxAttempts = maxKeyboardInteractiveAttempts()
      if (keyboardInteractiveAttempts >= maxAttempts) {
        sink.keyboardInteractiveResult?.({
          id: requestId,
          status: 'failed',
          attempts: keyboardInteractiveAttempts,
          final: true,
          errorMessage: 'Maximum two-factor authentication attempts reached.'
        })
        finishKeyboardInteractive([])
        return
      }
      keyboardInteractiveAttempts += 1
      activeKeyboardInteractiveRequestId = requestId
      const request: TerminalKeyboardInteractiveRequest = {
        id: requestId,
        connectionId: `ssh-${id}`,
        host: target.host,
        port: target.port,
        username: target.username,
        ...(target.title ? { title: target.title } : {}),
        ...(cleanText(name) ? { name: cleanText(name) } : {}),
        ...(cleanText(instructions) ? { instructions: cleanText(instructions) } : {}),
        prompts: normalizeKeyboardInteractivePrompts(prompts),
        attempts: keyboardInteractiveAttempts,
        maxAttempts,
        timeoutMs: keyboardInteractiveTimeoutMs()
      }
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'connecting',
        message: `Two-factor authentication required for ${target.username}@${target.host}:${target.port}`
      })
      void (async () => {
        try {
          if (!sink.keyboardInteractive) throw new Error('Two-factor authentication prompt service is unavailable.')
          const responses = await sink.keyboardInteractive(request)
          finishKeyboardInteractive(Array.isArray(responses) ? responses.map((value) => String(value || '')) : [])
        } catch (error) {
          const isTimeout = error instanceof Error && /timed out|timeout/i.test(error.message)
          const isCancel = error instanceof Error && /cancel/i.test(error.message)
          activeKeyboardInteractiveRequestId = ''
          sink.keyboardInteractiveResult?.({
            id: requestId,
            status: isTimeout ? 'timeout' : isCancel ? 'canceled' : 'failed',
            attempts: keyboardInteractiveAttempts,
            final: true,
            errorMessage: error instanceof Error ? error.message : 'Two-factor authentication failed.'
          })
          finishKeyboardInteractive([])
        }
      })()
    })
    .on('ready', () => {
      if (closed) return
      if (activeKeyboardInteractiveRequestId) {
        sink.keyboardInteractiveResult?.({
          id: activeKeyboardInteractiveRequestId,
          status: 'success',
          attempts: keyboardInteractiveAttempts
        })
        activeKeyboardInteractiveRequestId = ''
      }
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'connected',
        message: `SSH connected ${target.username}@${target.host}:${target.port}`
      })
      client.shell({ term: 'xterm-256color', cols, rows }, (error, channel) => {
        if (error) {
          fail(error, 'SSH shell failed.', 1)
          return
        }
        stream = channel
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'shell-ready',
          message: `SSH shell ready ${target.username}@${target.host}:${target.port}`
        })
        while (pendingWrites.length) {
          stream.write(pendingWrites.shift() || '')
        }
        channel.on('data', (chunk: Buffer | string) => sink.data(chunk))
        channel.stderr.on('data', (chunk: Buffer | string) => sink.data(chunk))
        channel.on('close', () => finish(0, 'process'))
      })
    })
    .on('error', (error) => {
      const diagnosticEvent = sshConnectionErrorEvent(error)
      if (activeKeyboardInteractiveRequestId) {
        sink.keyboardInteractiveResult?.({
          id: activeKeyboardInteractiveRequestId,
          status: 'failed',
          attempts: keyboardInteractiveAttempts,
          final: true,
          errorMessage: diagnosticEvent.errorMessage || (error instanceof Error ? error.message : 'SSH authentication failed.')
        })
        activeKeyboardInteractiveRequestId = ''
      }
      fail(error, 'SSH connection failed.', 1, diagnosticEvent)
    })
    .on('close', () => finish(null, 'unknown'))
    .on('end', () => finish(null, 'unknown'))

  const connectConfig: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.username,
    tryKeyboard: Boolean(sink.keyboardInteractive),
    readyTimeout: runtimeConfig.readyTimeoutMs || 20000,
    keepaliveInterval: runtimeConfig.keepaliveIntervalMs || 10000
  }
  if (target.password) connectConfig.password = target.password
  if (target.privateKey) connectConfig.privateKey = target.privateKey
  if (target.passphrase) connectConfig.passphrase = target.passphrase
  const configuredAgentAuth = applyConfiguredSshAgentAuth(connectConfig, getRuntimeConfig(), (keyChainId) => resolveKeychainSecret(keyChainId), {
    enableForward: true,
    overrideExistingAgent: false
  })
  hasConfiguredAgentAuth = Boolean(configuredAgentAuth)
  if (!configuredAgentAuth && !target.password && !target.privateKey && process.env.SSH_AUTH_SOCK) {
    connectConfig.agent = process.env.SSH_AUTH_SOCK
    hasConfiguredAgentAuth = true
  }

  void (async () => {
    try {
      const proxy = await getProxySocketForAsset()(target.asset, getRuntimeConfig().sshProxyConfigs, target.host, target.port)
      if (proxy) {
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'proxy-opening',
          proxyName: proxy.config.name,
          message: `Opening SSH proxy ${proxy.config.name}`
        })
        proxySocket = proxy.socket
        connectConfig.sock = proxy.socket
        delete connectConfig.host
        delete connectConfig.port
      }
      if (closed) {
        proxySocket?.destroy()
        return
      }
      client.connect(connectConfig)
    } catch (error) {
      fail(error, 'SSH proxy tunnel failed.', 1)
    }
  })()

  return {
    shell: 'ssh',
    cwd,
    session,
    connection: target,
    lifecycle
  }
}
