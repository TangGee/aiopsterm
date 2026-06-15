import { randomUUID } from 'crypto'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import type {
  AiopsAssetRecord,
  SshProxyConfig,
  TerminalCreateOptions,
  TerminalDisconnectReason,
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
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
    | 'jumpHostId'
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

type SshTerminalChannel = ClientChannel

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
  forwardOut?(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: (error: Error | undefined, stream: SshTerminalChannel) => void
  ): unknown
  end(): unknown
}

type SshAuthScope = 'target' | 'jump'

class SshJumpForwardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshJumpForwardError'
  }
}

type SshTerminalPtyProcess = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
}

type SshTerminalPtyRuntime = {
  spawn(shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): SshTerminalPtyProcess
}

type SshTerminalWritable = {
  write(data: string | Buffer): unknown
  close?: () => unknown
  setWindow?: (...args: number[]) => void
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
  rememberAssetPassword?: (assetId: string, password: string) => void | Promise<void>
  loadPty?: () => SshTerminalPtyRuntime | null
  getEnv?: () => NodeJS.ProcessEnv
  useBackendDouble?: boolean
  readyTimeoutMs?: number
  keepaliveIntervalMs?: number
}

type SshTerminalEventSink = {
  lifecycle: (event: TerminalLifecycleEvent) => void
  exit: (event: TerminalLifecycleEvent, code?: number | null) => void
  data: (chunk: string | Buffer) => void
  keyboardInteractive?: (request: TerminalKeyboardInteractiveRequest) => Promise<string[] | TerminalKeyboardInteractiveResponse>
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
  runtimeConfig.rememberAssetPassword = config.rememberAssetPassword
  runtimeConfig.loadPty = config.loadPty
  runtimeConfig.getEnv = config.getEnv
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

const getPtyRuntime = (): SshTerminalPtyRuntime | null => {
  if (runtimeConfig.loadPty) return runtimeConfig.loadPty()
  try {
    return require('node-pty') as SshTerminalPtyRuntime
  } catch {
    return null
  }
}

const getEnv = () => runtimeConfig.getEnv?.() || process.env

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

const maxKeyboardInteractiveAttempts = () => 1

const normalizeKeyboardInteractivePrompts = (prompts: TerminalKeyboardInteractivePrompt[] = []): TerminalKeyboardInteractivePrompt[] =>
  prompts
    .map((prompt) => ({
      prompt: cleanText(prompt?.prompt) || 'Verification code:',
      echo: prompt?.echo === true
    }))
    .filter((prompt) => prompt.prompt)

const terminalAuthLabel = (target: Pick<SshTerminalTarget, 'username' | 'host' | 'port'>) => `${target.username}@${target.host}:${target.port}`

const createPasswordPrompt = (target: SshTerminalTarget): TerminalKeyboardInteractivePrompt[] => [
  {
    prompt: `SSH password for ${terminalAuthLabel(target)}:`,
    echo: false
  }
]

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const sshDestination = (target: Pick<SshTerminalTarget, 'username' | 'host'>) => `${target.username}@${target.host}`

const relayMarkerLine = (token: string, boundary: 'BEGIN' | 'END') => `__AIO_CTX_${boundary}_${token}__`

const relayProbeCommand = (token: string, hop: 'relay' | 'target', expectedHost: string) => {
  const begin = shellSingleQuote(`${relayMarkerLine(token, 'BEGIN')}\n`)
  const end = shellSingleQuote(`${relayMarkerLine(token, 'END')}\n`)
  return [
    `printf ${begin}`,
    `printf ${shellSingleQuote(`hop=${hop}\n`)}`,
    `printf ${shellSingleQuote('expected=%s\n')} ${shellSingleQuote(expectedHost)}`,
    `printf ${shellSingleQuote('user=%s\n')} "$(id -un 2>/dev/null || whoami 2>/dev/null || printf unknown)"`,
    `printf ${shellSingleQuote('host=%s\n')} "$(hostname -f 2>/dev/null || hostname 2>/dev/null || printf unknown)"`,
    `printf ${shellSingleQuote('pwd=%s\n')} "$PWD"`,
    `printf ${end}`
  ].join('; ')
}

const relayShellCommand = (sessionToken: string, jumpTarget: SshTerminalTarget, target: SshTerminalTarget) => {
  const targetToken = `${sessionToken}_target`
  const relayToken = `${sessionToken}_relay`
  const targetCommand = [
    relayProbeCommand(targetToken, 'target', target.host),
    'export AIOPSTERM_HOP=target',
    `export AIOPSTERM_TARGET_HOST=${shellSingleQuote(target.host)}`,
    `export AIOPSTERM_EXPECTED_HOST=${shellSingleQuote(target.host)}`,
    `export AIOPSTERM_SESSION_ID=${shellSingleQuote(sessionToken)}`,
    'exec "${SHELL:-/bin/sh}"'
  ].join('; ')
  const nestedSsh = ['ssh', '-tt', '-p', String(target.port), '--', shellSingleQuote(sshDestination(target)), shellSingleQuote(targetCommand)].join(' ')
  return {
    sessionToken,
    relayToken,
    targetToken,
    command: [
      relayProbeCommand(relayToken, 'relay', jumpTarget.host),
      'export AIOPSTERM_HOP=relay',
      `export AIOPSTERM_RELAY_HOST=${shellSingleQuote(jumpTarget.host)}`,
      `export AIOPSTERM_SESSION_ID=${shellSingleQuote(sessionToken)}`,
      nestedSsh
    ].join('; ')
  }
}

const parseRelayProbe = (value: string) => {
  const record: Record<string, string> = {}
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    record[line.slice(0, index)] = line.slice(index + 1)
  }
  return record
}

const createRelayProbeFilter = (
  tokens: Set<string>,
  onProbe: (probe: Record<string, string>) => void,
  onData: (chunk: string) => void
) => {
  let buffer = ''
  const beginPattern = /__AIO_CTX_BEGIN_([A-Za-z0-9_-]+)__/g
  const beginLiteral = '__AIO_CTX_BEGIN_'
  const maxPartialMarkerLength = 96
  const safeEmitIndex = (value: string) => {
    for (let index = Math.max(0, value.length - maxPartialMarkerLength); index < value.length; index += 1) {
      const suffix = value.slice(index)
      if (beginLiteral.startsWith(suffix)) return index
      if (suffix.startsWith(beginLiteral) && /^[A-Za-z0-9_-]*$/.test(suffix.slice(beginLiteral.length))) return index
    }
    return value.length
  }
  const handle = (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      beginPattern.lastIndex = 0
      const begin = beginPattern.exec(buffer)
      if (!begin) {
        const emitIndex = safeEmitIndex(buffer)
        if (emitIndex > 0) {
          const emit = buffer.slice(0, emitIndex)
          buffer = buffer.slice(emitIndex)
          if (emit) onData(emit)
        }
        return
      }
      if (begin.index > 0) {
        const emit = buffer.slice(0, begin.index)
        buffer = buffer.slice(begin.index)
        if (emit) onData(emit)
        continue
      }
      const token = begin[1]
      if (!tokens.has(token)) {
        const emit = buffer.slice(0, begin[0].length)
        buffer = buffer.slice(begin[0].length)
        if (emit) onData(emit)
        continue
      }
      const endMarker = relayMarkerLine(token, 'END')
      const endIndex = buffer.indexOf(endMarker)
      if (endIndex < 0) return
      const beginMarker = begin[0]
      const body = buffer.slice(beginMarker.length, endIndex)
      buffer = buffer.slice(endIndex + endMarker.length)
      onProbe(parseRelayProbe(body))
    }
  }
  const flush = () => {
    if (buffer) onData(buffer)
    buffer = ''
  }
  return { handle, flush }
}

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

  let client = new ssh2.Client()
  let stream: SshTerminalWritable | null = null
  let proxySocket: SshProxySocket | null = null
  let relayPty: SshTerminalPtyProcess | null = null
  let closed = false
  let cols = options.cols || 100
  let rows = options.rows || 30
  const pendingWrites: Array<string | Buffer> = []
  const keyboardInteractiveStates = new Map<string, { attempts: number; activeRequestId: string }>()
  const pendingRememberPasswords = new Map<string, { assetId: string; password: string }>()
  let hasConfiguredAgentAuth = false
  let targetPasswordRetryUsed = false
  let jumpClient: SshTerminalClient | null = null
  let jumpStream: SshTerminalChannel | null = null
  const staleTargetClients = new Set<SshTerminalClient>()

  let lifecycle = sendLifecycle(id, sink, {
    ...lifecycleBase,
    stage: 'connecting',
    message: `Connecting ${target.username}@${target.host}:${target.port}`
  })

  const cleanupJumpTransport = () => {
    try {
      jumpStream?.close?.()
    } catch {}
    try {
      jumpClient?.end()
    } catch {}
    jumpStream = null
    jumpClient = null
  }

  const cleanupProxyTransport = () => {
    try {
      proxySocket?.destroy()
    } catch {}
    proxySocket = null
  }

  const cleanupRelayShell = () => {
    const activePty = relayPty
    relayPty = null
    if (activePty) stream = null
    try {
      activePty?.kill()
    } catch {}
  }

  const cleanupTransports = () => {
    cleanupJumpTransport()
    cleanupProxyTransport()
    cleanupRelayShell()
  }

  const finish = (
    code: number | null,
    reason: TerminalDisconnectReason,
    event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> = {}
  ) => {
    if (closed) return
    closed = true
    cleanupTransports()
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
    cleanupTransports()
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
      stream?.setWindow?.(rows, cols, 0, 0)
    },
    kill(reason: TerminalDisconnectReason = 'manual') {
      finish(0, reason)
      try {
        if (stream?.close) stream.close()
      } catch {}
      try {
        client.end()
      } catch {}
    }
  }

  const keyboardState = (scope: string) => {
    const existing = keyboardInteractiveStates.get(scope)
    if (existing) return existing
    const created = { attempts: 0, activeRequestId: '' }
    keyboardInteractiveStates.set(scope, created)
    return created
  }

  const keyboardRequestId = (scope: string, attempt: number) => (scope === 'target' ? `${id}-keyboard-${attempt}` : `${id}-${scope}-keyboard-${attempt}`)

  const sendActiveKeyboardResult = (scope: SshAuthScope, result: Omit<TerminalKeyboardInteractiveResult, 'id' | 'attempts' | 'authScope'>) => {
    const state = keyboardState(scope)
    if (!state.activeRequestId) return
    sink.keyboardInteractiveResult?.({
      id: state.activeRequestId,
      authScope: scope,
      attempts: state.attempts,
      ...result
    })
    state.activeRequestId = ''
  }

  const normalizeKeyboardResponse = (value: string[] | TerminalKeyboardInteractiveResponse): TerminalKeyboardInteractiveResponse => {
    if (Array.isArray(value)) {
      return { responses: value.map((item) => String(item || '')).slice(0, 8) }
    }
    if (typeof value === 'object' && value) {
      return {
        responses: Array.isArray(value.responses) ? value.responses.map((item) => String(item || '')).slice(0, 8) : [],
        ...(value.rememberPassword === true ? { rememberPassword: true } : {})
      }
    }
    return { responses: [] }
  }

  const rememberableAssetId = (authTarget: SshTerminalTarget) => cleanText(authTarget.asset?.id)

  const rememberPasswordWhenReady = (scope: SshAuthScope, authTarget: SshTerminalTarget, password: string, rememberPassword?: boolean) => {
    const assetId = rememberableAssetId(authTarget)
    if (rememberPassword && assetId && password) {
      pendingRememberPasswords.set(scope, { assetId, password })
      return
    }
    pendingRememberPasswords.delete(scope)
  }

  const commitRememberedPassword = (scope: SshAuthScope) => {
    const pending = pendingRememberPasswords.get(scope)
    if (!pending) return
    pendingRememberPasswords.delete(scope)
    void runtimeConfig.rememberAssetPassword?.(pending.assetId, pending.password)
  }

  const attachKeyboardInteractive = (authClient: SshTerminalClient, authTarget: SshTerminalTarget, scope: SshAuthScope) => {
    authClient.on('keyboard-interactive', (name, instructions, _instructionsLang, prompts, finishKeyboardInteractive) => {
      const state = keyboardState(scope)
      const requestId = keyboardRequestId(scope, state.attempts + 1)
      const maxAttempts = maxKeyboardInteractiveAttempts()
      if (state.attempts >= maxAttempts) {
        sink.keyboardInteractiveResult?.({
          id: requestId,
          authScope: scope,
          status: 'failed',
          attempts: state.attempts,
          final: true,
          errorMessage: 'Maximum two-factor authentication attempts reached.'
        })
        finishKeyboardInteractive([])
        return
      }
      state.attempts += 1
      state.activeRequestId = requestId
      const request: TerminalKeyboardInteractiveRequest = {
        id: requestId,
        connectionId: `ssh-${id}`,
        host: authTarget.host,
        port: authTarget.port,
        username: authTarget.username,
        purpose: 'keyboard-interactive',
        authScope: scope,
        ...(authTarget.title ? { title: authTarget.title } : {}),
        ...(cleanText(name) ? { name: cleanText(name) } : {}),
        ...(cleanText(instructions) ? { instructions: cleanText(instructions) } : {}),
        prompts: normalizeKeyboardInteractivePrompts(prompts),
        attempts: state.attempts,
        maxAttempts,
        timeoutMs: keyboardInteractiveTimeoutMs()
      }
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'connecting',
        authScope: scope,
        authPurpose: 'keyboard-interactive',
        message: `Two-factor authentication required for ${terminalAuthLabel(authTarget)}`
      })
      void (async () => {
        try {
          if (!sink.keyboardInteractive) throw new Error('Two-factor authentication prompt service is unavailable.')
          const response = normalizeKeyboardResponse(await sink.keyboardInteractive(request))
          finishKeyboardInteractive(response.responses)
        } catch (error) {
          const isTimeout = error instanceof Error && /timed out|timeout/i.test(error.message)
          const isCancel = error instanceof Error && /cancel/i.test(error.message)
          state.activeRequestId = ''
          sink.keyboardInteractiveResult?.({
            id: requestId,
            authScope: scope,
            status: isTimeout ? 'timeout' : isCancel ? 'canceled' : 'failed',
            attempts: state.attempts,
            final: true,
            errorMessage: error instanceof Error ? error.message : 'Two-factor authentication failed.'
          })
          finishKeyboardInteractive([])
        }
      })()
    })
  }

  const passwordRequestId = (scope: string, attempt: number) => {
    const suffix = attempt <= 1 ? 'password' : 'password-retry'
    return scope === 'target' ? `${id}-${suffix}` : `${id}-${scope}-${suffix}`
  }

  const requestPassword = async (authTarget: SshTerminalTarget, scope: SshAuthScope, input: { attempt?: number; rejected?: boolean } = {}) => {
    const attempt = Math.max(1, Math.trunc(Number(input.attempt || 1)))
    const requestId = passwordRequestId(scope, attempt)
    if (!sink.keyboardInteractive) {
      throw new Error(`SSH password is required for ${terminalAuthLabel(authTarget)}.`)
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connecting',
      authScope: scope,
      authPurpose: 'password',
      message: `SSH password required for ${terminalAuthLabel(authTarget)}`
    })
    const request: TerminalKeyboardInteractiveRequest = {
      id: requestId,
      connectionId: `ssh-${id}`,
      host: authTarget.host,
      port: authTarget.port,
      username: authTarget.username,
      purpose: 'password',
      authScope: scope,
      ...(rememberableAssetId(authTarget) ? { assetId: rememberableAssetId(authTarget), canRememberPassword: true } : {}),
      ...(authTarget.title ? { title: authTarget.title } : {}),
      name: 'SSH password',
      instructions: input.rejected
        ? 'The saved SSH password was rejected. Enter a new password to retry this connection.'
        : 'Enter the SSH password to continue this connection.',
      prompts: createPasswordPrompt(authTarget),
      attempts: attempt,
      maxAttempts: input.rejected ? 2 : 1,
      timeoutMs: keyboardInteractiveTimeoutMs()
    }
    try {
      const response = normalizeKeyboardResponse(await sink.keyboardInteractive(request))
      const password = String(response.responses[0] || '')
      if (!password) throw new Error(`SSH password is required for ${terminalAuthLabel(authTarget)}.`)
      authTarget.password = password
      rememberPasswordWhenReady(scope, authTarget, password, response.rememberPassword)
      sink.keyboardInteractiveResult?.({ id: requestId, authScope: scope, status: 'success', attempts: attempt, final: true })
    } catch (error) {
      const isTimeout = error instanceof Error && /timed out|timeout/i.test(error.message)
      const isCancel = error instanceof Error && /cancel/i.test(error.message)
      sink.keyboardInteractiveResult?.({
        id: requestId,
        authScope: scope,
        status: isTimeout ? 'timeout' : isCancel ? 'canceled' : 'failed',
        attempts: attempt,
        final: true,
        errorMessage: error instanceof Error ? error.message : 'SSH password prompt failed.'
      })
      throw error
    }
  }

  const authMethodsLabel = (connectConfig: ConnectConfig, hasAgentAuth: boolean) => {
    const methods = [
      connectConfig.password ? 'password' : '',
      connectConfig.privateKey ? 'privateKey' : '',
      hasAgentAuth ? 'agent' : '',
      connectConfig.tryKeyboard ? 'keyboard-interactive' : ''
    ].filter(Boolean)
    return methods.length ? methods.join(',') : 'none'
  }

  const createConnectConfig = (authTarget: SshTerminalTarget) => {
    const connectConfig: ConnectConfig = {
      host: authTarget.host,
      port: authTarget.port,
      username: authTarget.username,
      tryKeyboard: Boolean(sink.keyboardInteractive),
      readyTimeout: runtimeConfig.readyTimeoutMs || 20000,
      keepaliveInterval: runtimeConfig.keepaliveIntervalMs || 10000
    }
    if (authTarget.password) connectConfig.password = authTarget.password
    if (authTarget.privateKey) connectConfig.privateKey = authTarget.privateKey
    if (authTarget.passphrase) connectConfig.passphrase = authTarget.passphrase
    const configuredAgentAuth = applyConfiguredSshAgentAuth(connectConfig, getRuntimeConfig(), (keyChainId) => resolveKeychainSecret(keyChainId), {
      enableForward: true,
      overrideExistingAgent: false
    })
    let hasAgentAuth = Boolean(configuredAgentAuth)
    const env = getEnv()
    if (!configuredAgentAuth && !authTarget.password && !authTarget.privateKey && env.SSH_AUTH_SOCK) {
      connectConfig.agent = env.SSH_AUTH_SOCK
      hasAgentAuth = true
    }
    return { connectConfig, hasAgentAuth }
  }

  const resolveJumpHostTarget = () => {
    const jumpHostId = cleanText(target.asset?.jumpHostId)
    if (!jumpHostId) return null
    const jumpTarget = resolveSshTerminalTarget({ kind: 'ssh', assetId: jumpHostId })
    if (!isValidTarget(jumpTarget)) {
      throw new Error('Jump host target requires host, username, and a valid port.')
    }
    return jumpTarget
  }

  const openJumpHostTunnel = async (jumpTarget: SshTerminalTarget): Promise<SshTerminalChannel> => {
    const jump = new ssh2.Client()
    attachKeyboardInteractive(jump, jumpTarget, 'jump')
    const { connectConfig, hasAgentAuth } = createConnectConfig(jumpTarget)
    const jumpProxy = await getProxySocketForAsset()(jumpTarget.asset, getRuntimeConfig().sshProxyConfigs, jumpTarget.host, jumpTarget.port)
    if (jumpProxy) {
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'proxy-opening',
        authScope: 'jump',
        sshTransport: 'proxy',
        targetHost: jumpTarget.host,
        targetPort: jumpTarget.port,
        targetUsername: jumpTarget.username,
        proxyName: jumpProxy.config.name,
        message: `Opening SSH proxy ${jumpProxy.config.name} for jump host`
      })
      proxySocket = jumpProxy.socket
      connectConfig.sock = jumpProxy.socket
      delete connectConfig.host
      delete connectConfig.port
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'proxy-opening',
      authScope: 'jump',
      sshTransport: 'jump',
      jumpHost: jumpTarget.host,
      jumpPort: jumpTarget.port,
      jumpUsername: jumpTarget.username,
      targetHost: target.host,
      targetPort: target.port,
      targetUsername: target.username,
      sshAuthMethods: authMethodsLabel(connectConfig, hasAgentAuth),
      message: `Opening SSH jump host ${terminalAuthLabel(jumpTarget)}`
    })

    return new Promise<SshTerminalChannel>((resolve, reject) => {
      let settled = false
      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        sendActiveKeyboardResult('jump', {
          status: 'failed',
          final: true,
          errorMessage: error.message
        })
        try {
          jump.end()
        } catch {}
        reject(error)
      }
      jump
        .on('ready', () => {
          if (closed) {
            rejectOnce(new Error('SSH session closed before jump host was ready.'))
            return
          }
          sendActiveKeyboardResult('jump', { status: 'success' })
          commitRememberedPassword('jump')
          if (typeof jump.forwardOut !== 'function') {
            rejectOnce(new SshJumpForwardError('SSH jump host runtime does not support forwardOut.'))
            return
          }
          lifecycle = sendLifecycle(id, sink, {
            ...lifecycleBase,
            stage: 'proxy-opening',
            authScope: 'jump',
            sshTransport: 'jump',
            jumpHost: jumpTarget.host,
            jumpPort: jumpTarget.port,
            jumpUsername: jumpTarget.username,
            targetHost: target.host,
            targetPort: target.port,
            targetUsername: target.username,
            message: `Opening SSH jump tunnel to ${terminalAuthLabel(target)}`
          })
          jump.forwardOut('127.0.0.1', 0, target.host, target.port, (error, channel) => {
            if (error) {
              rejectOnce(new SshJumpForwardError(`SSH jump host forward failed: ${error.message}`))
              return
            }
            if (settled) {
              try {
                channel.close?.()
              } catch {}
              return
            }
            settled = true
            jumpClient = jump
            jumpStream = channel
            resolve(channel)
          })
        })
        .on('error', (error) => rejectOnce(new Error(`SSH jump host connection failed: ${error.message}`)))
        .on('close', () => rejectOnce(new Error('SSH jump host connection closed before tunnel was ready.')))
      try {
        jump.connect(connectConfig)
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  const relayShellLifecycleFields = (jumpTarget: SshTerminalTarget) => ({
    sshTransport: 'relay-shell' as const,
    jumpHost: jumpTarget.host,
    jumpPort: jumpTarget.port,
    jumpUsername: jumpTarget.username,
    targetHost: target.host,
    targetPort: target.port,
    targetUsername: target.username
  })

  const openRelayShellFallback = (jumpTarget: SshTerminalTarget, fallbackReason: unknown) => {
    if (closed) return
    const ptyRuntime = getPtyRuntime()
    const fallbackMessage = fallbackReason instanceof Error ? fallbackReason.message : String(fallbackReason || 'SSH jump host forward failed.')
    if (!ptyRuntime) {
      throw new Error(`SSH jump TCP forwarding failed and relay shell runtime is unavailable. ${fallbackMessage}`)
    }
    cleanupJumpTransport()
    cleanupProxyTransport()

    const sessionToken = randomUUID().replace(/-/g, '')
    const relayShell = relayShellCommand(sessionToken, jumpTarget, target)
    const lifecycleFields = relayShellLifecycleFields(jumpTarget)
    let remoteHop: TerminalLifecycleEvent['remoteHop'] = 'unknown'
    let endpointConfidence: TerminalLifecycleEvent['endpointConfidence'] = 'unknown'
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...lifecycleFields,
      stage: 'proxy-opening',
      authScope: 'jump',
      remoteHop,
      endpointConfidence,
      errorCode: 'SSH_JUMP_FORWARD_FAILED',
      errorMessage: fallbackMessage,
      message: 'SSH jump TCP forwarding failed; starting relay shell fallback.'
    })

    const filter = createRelayProbeFilter(
      new Set([relayShell.relayToken, relayShell.targetToken]),
      (probe) => {
        const hop = probe.hop === 'target' ? 'target' : probe.hop === 'relay' ? 'relay' : 'unknown'
        remoteHop = hop
        endpointConfidence = hop === 'unknown' ? 'unknown' : 'confirmed'
        const expectedHost = hop === 'target' ? target.host : hop === 'relay' ? jumpTarget.host : cleanText(probe.expected)
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          ...lifecycleFields,
          stage: hop === 'target' ? 'shell-ready' : 'connected',
          authScope: hop === 'target' ? 'target' : 'jump',
          remoteHop,
          expectedHost,
          actualHost: cleanText(probe.host),
          actualUsername: cleanText(probe.user),
          endpointConfidence,
          message:
            hop === 'target'
              ? `SSH target shell ready via relay ${terminalAuthLabel(target)}`
              : hop === 'relay'
                ? `SSH relay shell connected ${terminalAuthLabel(jumpTarget)}`
                : 'SSH relay shell endpoint probe completed.'
        })
      },
      (chunk) => sink.data(chunk)
    )

    const relayEnv = {
      ...getEnv(),
      AIOPSTERM_SESSION_ID: sessionToken,
      AIOPSTERM_TRANSPORT: 'relay-shell',
      AIOPSTERM_RELAY_HOST: jumpTarget.host,
      AIOPSTERM_TARGET_HOST: target.host
    }
    const args = ['-tt', '-p', String(jumpTarget.port), sshDestination(jumpTarget), relayShell.command]
    const ptyProcess = ptyRuntime.spawn('ssh', args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: relayEnv
    })
    relayPty = ptyProcess
    stream = {
      write(data: string | Buffer) {
        ptyProcess.write(typeof data === 'string' ? data : data.toString('utf8'))
      },
      setWindow(nextRows: number, nextCols: number) {
        ptyProcess.resize(nextCols, nextRows)
      },
      close() {
        ptyProcess.kill()
      }
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...lifecycleFields,
      stage: 'connecting',
      authScope: 'jump',
      remoteHop,
      endpointConfidence,
      message: `Opening SSH relay shell ${terminalAuthLabel(jumpTarget)}`
    })
    while (pendingWrites.length) {
      stream.write(pendingWrites.shift() || '')
    }
    ptyProcess.onData((chunk) => filter.handle(chunk))
    ptyProcess.onExit((event) => {
      filter.flush()
      if (relayPty === ptyProcess) relayPty = null
      if (stream?.close) stream = null
      finish(Number.isFinite(event.exitCode) ? event.exitCode : null, 'process', {
        ...lifecycleFields,
        remoteHop,
        endpointConfidence,
        message: 'SSH relay shell exited.'
      })
    })
  }

  const openTargetTransportAndConnect = async (authClient: SshTerminalClient) => {
    const jumpTarget = resolveJumpHostTarget()
    let tunnel: SshTerminalChannel | null = null
    if (jumpTarget) {
      try {
        tunnel = await openJumpHostTunnel(jumpTarget)
      } catch (error) {
        if (error instanceof SshJumpForwardError) {
          staleTargetClients.add(authClient)
          try {
            authClient.end()
          } catch {}
          openRelayShellFallback(jumpTarget, error)
          return
        }
        throw error
      }
    }

    const { connectConfig, hasAgentAuth } = createConnectConfig(target)
    hasConfiguredAgentAuth = hasAgentAuth

    if (jumpTarget) {
      connectConfig.sock = tunnel as ConnectConfig['sock']
      delete connectConfig.host
      delete connectConfig.port
    } else {
      const proxy = await getProxySocketForAsset()(target.asset, getRuntimeConfig().sshProxyConfigs, target.host, target.port)
      if (proxy) {
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'proxy-opening',
          authScope: 'target',
          sshTransport: 'proxy',
          targetHost: target.host,
          targetPort: target.port,
          targetUsername: target.username,
          proxyName: proxy.config.name,
          message: `Opening SSH proxy ${proxy.config.name}`
        })
        proxySocket = proxy.socket
        connectConfig.sock = proxy.socket
        delete connectConfig.host
        delete connectConfig.port
      }
    }
    if (closed) {
      cleanupTransports()
      return
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connecting',
      authScope: 'target',
      sshTransport: jumpTarget ? 'jump' : connectConfig.sock ? 'proxy' : 'direct',
      ...(jumpTarget
        ? {
            jumpHost: jumpTarget.host,
            jumpPort: jumpTarget.port,
            jumpUsername: jumpTarget.username
          }
        : {}),
      targetHost: target.host,
      targetPort: target.port,
      targetUsername: target.username,
      sshAuthMethods: authMethodsLabel(connectConfig, hasAgentAuth),
      message: `Connecting SSH target ${terminalAuthLabel(target)}`
    })
    authClient.connect(connectConfig)
  }

  const retryTargetPassword = async (failedClient: SshTerminalClient, diagnosticEvent: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>>) => {
    if (targetPasswordRetryUsed || closed || !sink.keyboardInteractive) return false
    const authType = cleanText(target.asset?.auth_type).toLowerCase()
    const canRetryRejectedPassword = Boolean(target.password) && diagnosticEvent.errorCode === 'SSH_AUTH_PASSWORD_REJECTED'
    const canPromptMissingPassword =
      !target.password &&
      !target.privateKey &&
      authType !== 'keybased' &&
      (diagnosticEvent.errorCode === 'SSH_AUTH_PASSWORD_REJECTED' ||
        diagnosticEvent.errorCode === 'SSH_AUTH_FAILED' ||
        diagnosticEvent.errorCode === 'SSH_AUTH_METHOD_UNAVAILABLE')
    if (!canRetryRejectedPassword && !canPromptMissingPassword) return false
    targetPasswordRetryUsed = true
    staleTargetClients.add(failedClient)
    sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connecting',
      errorCode: diagnosticEvent.errorCode,
      errorMessage: diagnosticEvent.errorMessage,
      message: canRetryRejectedPassword ? `SSH password rejected for ${terminalAuthLabel(target)}` : `SSH password required for ${terminalAuthLabel(target)}`
    })
    cleanupTransports()
    try {
      await requestPassword(target, 'target', {
        attempt: canRetryRejectedPassword ? 2 : 1,
        rejected: canRetryRejectedPassword
      })
      if (closed) return true
      try {
        failedClient.end()
      } catch {}
      client = new ssh2.Client()
      attachTargetClient(client)
      await openTargetTransportAndConnect(client)
      return true
    } catch (error) {
      fail(error, 'SSH connection failed.', 1, diagnosticEvent)
      return true
    }
  }

  const attachTargetClient = (authClient: SshTerminalClient) => {
    attachKeyboardInteractive(authClient, target, 'target')

    authClient
      .on('ready', () => {
        if (closed) return
        sendActiveKeyboardResult('target', { status: 'success' })
        commitRememberedPassword('target')
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'connected',
          message: `SSH connected ${target.username}@${target.host}:${target.port}`
        })
        authClient.shell({ term: 'xterm-256color', cols, rows }, (error, channel) => {
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
        sendActiveKeyboardResult('target', {
          status: 'failed',
          final: true,
          errorMessage: diagnosticEvent.errorMessage || (error instanceof Error ? error.message : 'SSH authentication failed.')
        })
        void (async () => {
          if (await retryTargetPassword(authClient, diagnosticEvent)) return
          fail(error, 'SSH connection failed.', 1, diagnosticEvent)
        })()
      })
      .on('close', () => {
        if (staleTargetClients.has(authClient) || authClient !== client) return
        finish(null, 'unknown')
      })
      .on('end', () => {
        if (staleTargetClients.has(authClient) || authClient !== client) return
        finish(null, 'unknown')
      })
  }

  attachTargetClient(client)

  void (async () => {
    try {
      await openTargetTransportAndConnect(client)
    } catch (error) {
      fail(error, 'SSH connection preparation failed.', 1)
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
