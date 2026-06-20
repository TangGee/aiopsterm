import { createHash } from 'crypto'
import { mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import type { UserConfig } from '@shared/preload'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type {
  TerminalCreateOptions,
  TerminalDisconnectReason,
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '@shared/contracts/terminalSessions'
import { shouldUseSshTerminalBackendDouble } from '@shared/runtimeSwitches'
import { applyConfiguredSshAgentAuth } from './sshAgent'
import { createSshProxySocketForAsset, resolveSshProxyConfigForAsset, type SshProxySocket } from './sshProxy'
import { loadSsh2 } from './ssh2Runtime'
import { defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from './sshDefaults'
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
  getSshControlDir?: () => string
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

type PooledSshClient = {
  key: string
  client: SshTerminalClient
  createdAt: number
  lastUsedAt: number
  dispose?: () => void
}

const pooledTargetClients = new Map<string, PooledSshClient>()
const pooledJumpClients = new Map<string, PooledSshClient>()
const jumpForwardUnsupportedKeys = new Set<string>()

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
  runtimeConfig.getSshControlDir = config.getSshControlDir
  runtimeConfig.useBackendDouble = config.useBackendDouble
  runtimeConfig.readyTimeoutMs = config.readyTimeoutMs
  runtimeConfig.keepaliveIntervalMs = config.keepaliveIntervalMs
  clearSshConnectionPools()
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

const getTerminalType = (options: TerminalCreateOptions) => {
  const terminalType = typeof options.terminalType === 'string' ? options.terminalType.trim() : ''
  return terminalType || 'xterm-256color'
}

const clearPool = (pool: Map<string, PooledSshClient>) => {
  for (const entry of new Set(pool.values())) {
    try {
      entry.client.end()
    } catch {}
    try {
      entry.dispose?.()
    } catch {}
  }
  pool.clear()
}

const clearSshConnectionPools = () => {
  clearPool(pooledTargetClients)
  clearPool(pooledJumpClients)
  jumpForwardUnsupportedKeys.clear()
}

const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24)

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const secretFingerprint = (value: unknown) => {
  const text = typeof value === 'string' ? value : ''
  return text ? shortHash(text) : ''
}

const authPoolIdentity = (target: SshTerminalTarget) => {
  const env = getEnv()
  const config = getRuntimeConfig()
  const sshAgentKeys = Array.isArray(config.sshAgentKeys)
    ? config.sshAgentKeys
        .map((item) => (typeof item === 'object' && item ? cleanText((item as Record<string, unknown>).id || (item as Record<string, unknown>).key) : ''))
        .filter(Boolean)
        .sort()
    : []
  return {
    assetId: cleanText(target.asset?.id),
    authType: cleanText(target.asset?.auth_type),
    keychainId: cleanText(target.asset?.keychainId),
    password: secretFingerprint(target.password),
    privateKey: secretFingerprint(target.privateKey),
    passphrase: secretFingerprint(target.passphrase),
    agentEnabled: config.terminal?.sshAgentsStatus === true,
    sshAgentKeys,
    envAgent: cleanText(env.SSH_AUTH_SOCK)
  }
}

const targetEndpointIdentity = (target: Pick<SshTerminalTarget, 'host' | 'port' | 'username'>) => ({
  host: cleanText(target.host).toLowerCase(),
  port: Number(target.port || 22),
  username: cleanText(target.username)
})

const proxyPoolIdentity = (proxy: SshProxyConfig | undefined | null) =>
  proxy
    ? {
        name: cleanText(proxy.name),
        type: cleanText(proxy.type),
        host: cleanText(proxy.host).toLowerCase(),
        port: Number(proxy.port || 0),
        enableProxyIdentity: proxy.enableProxyIdentity === true,
        username: cleanText(proxy.username),
        password: secretFingerprint(proxy.password)
      }
    : null

const targetPoolKey = (transport: 'direct' | 'proxy' | 'jump', authTarget: SshTerminalTarget, context: { proxy?: SshProxyConfig | null; jump?: SshTerminalTarget | null }) =>
  shortHash(
    stableJson({
      kind: 'target',
      transport,
      target: targetEndpointIdentity(authTarget),
      auth: authPoolIdentity(authTarget),
      proxy: proxyPoolIdentity(context.proxy),
      jump: context.jump
        ? {
            endpoint: targetEndpointIdentity(context.jump),
            auth: authPoolIdentity(context.jump)
          }
        : null
    })
  )

const authenticatedTargetPoolKey = (
  transport: 'direct' | 'proxy' | 'jump',
  authTarget: SshTerminalTarget,
  context: { proxy?: SshProxyConfig | null; jump?: SshTerminalTarget | null }
) =>
  shortHash(
    stableJson({
      kind: 'authenticated-target',
      transport,
      target: {
        assetId: cleanText(authTarget.asset?.id),
        endpoint: targetEndpointIdentity(authTarget)
      },
      proxy: proxyPoolIdentity(context.proxy),
      jump: context.jump
        ? {
            assetId: cleanText(context.jump.asset?.id),
            endpoint: targetEndpointIdentity(context.jump)
          }
        : null
    })
  )

const jumpPoolKey = (jumpTarget: SshTerminalTarget) =>
  shortHash(
    stableJson({
      kind: 'jump',
      endpoint: targetEndpointIdentity(jumpTarget),
      auth: authPoolIdentity(jumpTarget)
    })
  )

const removePooledClient = (pool: Map<string, PooledSshClient>, key: string, client?: SshTerminalClient) => {
  const entry = pool.get(key)
  if (!entry || (client && entry.client !== client)) return
  pool.delete(key)
  try {
    entry.dispose?.()
  } catch {}
}

const removePooledClientAliases = (pool: Map<string, PooledSshClient>, client: SshTerminalClient) => {
  const removed = new Set<PooledSshClient>()
  for (const [entryKey, entry] of pool) {
    if (entry.client !== client) continue
    pool.delete(entryKey)
    removed.add(entry)
  }
  for (const entry of removed) {
    try {
      entry.dispose?.()
    } catch {}
  }
}

const findPooledClientEntry = (pool: Map<string, PooledSshClient>, client: SshTerminalClient) => {
  for (const entry of pool.values()) {
    if (entry.client === client) return entry
  }
  return null
}

const rememberPooledClient = (pool: Map<string, PooledSshClient>, key: string, client: SshTerminalClient, dispose?: () => void) => {
  const now = Date.now()
  const existing = pool.get(key)
  if (existing?.client === client) {
    existing.lastUsedAt = now
    if (dispose && !existing.dispose) existing.dispose = dispose
    return existing
  }
  if (existing) {
    try {
      existing.client.end()
    } catch {}
    removePooledClientAliases(pool, existing.client)
  }
  const clientEntry = findPooledClientEntry(pool, client)
  if (clientEntry) {
    clientEntry.lastUsedAt = now
    if (dispose && !clientEntry.dispose) clientEntry.dispose = dispose
    pool.set(key, clientEntry)
    return clientEntry
  }
  const entry = { key, client, createdAt: now, lastUsedAt: now, dispose }
  pool.set(key, entry)
  client.on('close', () => removePooledClientAliases(pool, client))
  client.on('end', () => removePooledClientAliases(pool, client))
  client.on('error', () => removePooledClientAliases(pool, client))
  return entry
}

const rememberPooledClientAliases = (pool: Map<string, PooledSshClient>, keys: string[], client: SshTerminalClient, dispose?: () => void) => {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))
  if (!uniqueKeys.length) throw new Error('At least one SSH connection pool key is required.')
  const primary = rememberPooledClient(pool, uniqueKeys[0], client, dispose)
  for (const key of uniqueKeys.slice(1)) {
    const existing = pool.get(key)
    if (existing?.client === client) {
      existing.lastUsedAt = Date.now()
      continue
    }
    if (existing) {
      try {
        existing.client.end()
      } catch {}
      removePooledClientAliases(pool, existing.client)
    }
    pool.set(key, primary)
  }
  return primary
}

const getPooledClient = (pool: Map<string, PooledSshClient>, key: string) => {
  const entry = pool.get(key)
  if (!entry) return null
  entry.lastUsedAt = Date.now()
  return entry.client
}

const getPooledClientByKeys = (pool: Map<string, PooledSshClient>, keys: string[]) => {
  for (const key of keys) {
    const client = getPooledClient(pool, key)
    if (client) return client
  }
  return null
}

const isPooledClient = (pool: Map<string, PooledSshClient>, key: string, client: SshTerminalClient) => pool.get(key)?.client === client

const isPooledClientByKeys = (pool: Map<string, PooledSshClient>, keys: string[], client: SshTerminalClient) => keys.some((key) => isPooledClient(pool, key, client))

const getSshControlDir = () => {
  const configured = cleanText(runtimeConfig.getSshControlDir?.())
  const base = configured || join(tmpdir(), `aiopsterm-ssh-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`)
  try {
    mkdirSync(base, { recursive: true, mode: 0o700 })
  } catch {}
  return base
}

const relayControlPath = (jumpTarget: SshTerminalTarget) => join(getSshControlDir(), `cm-${jumpPoolKey(jumpTarget)}`)

const pathExists = (path: string) => {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

const getLocalSshSpawnCwd = () => {
  const env = getEnv()
  const candidates = [cleanText(env.HOME), cleanText(env.USERPROFILE), cleanText(env.PWD)]
  try {
    candidates.push(process.cwd())
  } catch {}
  for (const candidate of candidates) {
    try {
      if (candidate && statSync(candidate).isDirectory()) return candidate
    } catch {}
  }
  return '.'
}

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
  const username = cleanText(target.username)
  const cwd = username ? (username === 'root' ? '/root' : `/home/${username}`) : '~'
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

const relayShellSshArgs = (jumpTarget: SshTerminalTarget) => [
  '-F',
  '/dev/null',
  '-o',
  'ControlMaster=auto',
  '-o',
  'ControlPersist=yes',
  '-o',
  `ControlPath=${relayControlPath(jumpTarget)}`,
  '-o',
  'ServerAliveInterval=60',
  '-o',
  'HostKeyAlgorithms=+ssh-rsa',
  '-o',
  'PubkeyAcceptedAlgorithms=+ssh-rsa',
  '-tt',
  '-p',
  String(jumpTarget.port),
  sshDestination(jumpTarget)
]

const relayShellAuthPromptPattern =
  /(password|passphrase|verification code|verify code|one-time|otp|token|duo|keyboard-interactive|are you sure you want to continue connecting|yes\/no|input.*password)/i

const relayShellReadyPattern = /([$#>]\s*$|[^\s]+@[^\s]+[: ].*[$#>]\s*$)/i
const bracketPromptPattern = /^\[?([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)(?:[^\n]*)[#$>]\s*$/

const stripTerminalControl = (value: string) =>
  value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '\n')

const shouldBootstrapRelayShell = (value: string) => {
  const text = stripTerminalControl(value).trimEnd()
  if (!text.trim()) return false
  const tail = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (tail && relayShellReadyPattern.test(tail)) return true
  if (tail && relayShellAuthPromptPattern.test(tail)) return false
  return relayShellReadyPattern.test(text)
}

const parsePromptEndpoint = (value: string) => {
  const text = stripTerminalControl(value).trimEnd()
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(bracketPromptPattern)
    if (match) return { actualUsername: match[1], actualHost: match[2] }
  }
  return null
}

const hostLooksRelated = (actualHost: string, expectedHost: string) => {
  const actual = actualHost.toLowerCase()
  const expected = expectedHost.toLowerCase()
  return actual === expected || actual.startsWith(`${expected}.`) || expected.startsWith(`${actual}.`)
}

const inferRelayTargetReady = (value: string, jumpTarget: SshTerminalTarget, target: SshTerminalTarget) => {
  const text = stripTerminalControl(value).trimEnd()
  if (!text.trim()) return null
  const tail = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (tail && relayShellAuthPromptPattern.test(tail)) return null
  const endpoint = parsePromptEndpoint(text)
  if (!endpoint) return null
  const isRelayPrompt = endpoint.actualUsername === jumpTarget.username && hostLooksRelated(endpoint.actualHost, jumpTarget.host)
  if (isRelayPrompt) return null
  const hostMatches = hostLooksRelated(endpoint.actualHost, target.host)
  const userMatches = endpoint.actualUsername === target.username
  const promptLooksReady = tail ? relayShellReadyPattern.test(tail) : false
  if (hostMatches || (userMatches && endpoint.actualUsername !== jumpTarget.username) || promptLooksReady) return endpoint
  return null
}

const createHiddenTextFilter = (onData: (chunk: string) => void) => {
  let buffer = ''
  const hidden: string[] = []
  const addHiddenText = (value: string) => {
    const text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!text) return
    const variants = new Set([text, text.replace(/\n/g, '\r\n'), text.replace(/\n/g, '\r')])
    for (const variant of variants) {
      if (variant && !hidden.includes(variant)) hidden.push(variant)
    }
  }
  const safeEmitIndex = (value: string) => {
    const maxLength = Math.max(1, ...hidden.map((item) => item.length))
    for (let index = Math.max(0, value.length - maxLength + 1); index < value.length; index += 1) {
      const suffix = value.slice(index)
      if (hidden.some((item) => item.startsWith(suffix))) return index
    }
    return value.length
  }
  const handle = (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      let matchIndex = -1
      let matchText = ''
      for (const item of hidden) {
        const index = buffer.indexOf(item)
        if (index >= 0 && (matchIndex < 0 || index < matchIndex || (index === matchIndex && item.length > matchText.length))) {
          matchIndex = index
          matchText = item
        }
      }
      if (matchIndex >= 0) {
        if (matchIndex > 0) {
          const emit = buffer.slice(0, matchIndex)
          buffer = buffer.slice(matchIndex)
          if (emit) onData(emit)
        }
        buffer = buffer.slice(matchText.length)
        continue
      }
      const emitIndex = safeEmitIndex(buffer)
      if (emitIndex <= 0) return
      const emit = buffer.slice(0, emitIndex)
      buffer = buffer.slice(emitIndex)
      if (emit) onData(emit)
      return
    }
  }
  const flush = () => {
    if (buffer) onData(buffer)
    buffer = ''
  }
  return { addHiddenText, handle, flush }
}

const relayShellCommand = (target: SshTerminalTarget) => ['ssh', '-tt', '-p', String(target.port), '--', shellSingleQuote(sshDestination(target))].join(' ')

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

  let client: SshTerminalClient | null = null
  let stream: SshTerminalWritable | null = null
  let proxySocket: SshProxySocket | null = null
  let relayPty: SshTerminalPtyProcess | null = null
  let closed = false
  let cols = options.cols || 100
  let rows = options.rows || 30
  const terminalType = getTerminalType(options)
  const pendingWrites: Array<string | Buffer> = []
  const keyboardInteractiveStates = new Map<string, { attempts: number; activeRequestId: string }>()
  const pendingRememberPasswords = new Map<string, { assetId: string; password: string }>()
  let hasConfiguredAgentAuth = false
  let targetPasswordRetryUsed = false
  let jumpClient: SshTerminalClient | null = null
  let jumpClientIsPooled = false
  let jumpStream: SshTerminalChannel | null = null
  let targetClientIsPooled = false
  let targetClientPoolable = false
  let targetClientPoolKey = ''
  let targetClientAuthenticatedPoolKey = ''
  let targetConnectionReuse: TerminalLifecycleEvent['connectionReuse'] = 'created'
  let targetConnectionTransport: TerminalLifecycleEvent['sshTransport'] = 'direct'
  let targetConnectionJump: SshTerminalTarget | null = null
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
    if (!jumpClientIsPooled) {
      try {
        jumpClient?.end()
      } catch {}
    }
    jumpStream = null
    jumpClient = null
    jumpClientIsPooled = false
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
      if (!targetClientIsPooled) {
        try {
          client?.end()
        } catch {}
      }
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

  const openShellOnClient = (authClient: SshTerminalClient) => {
    if (closed) return
    sendActiveKeyboardResult('target', { status: 'success' })
    commitRememberedPassword('target')
    if (targetClientPoolable) {
      const disposeProxySocket = targetConnectionTransport === 'proxy' && proxySocket ? proxySocket : null
      rememberPooledClientAliases(
        pooledTargetClients,
        [targetClientPoolKey, targetClientAuthenticatedPoolKey],
        authClient,
        disposeProxySocket ? () => disposeProxySocket.destroy() : undefined
      )
      if (targetConnectionTransport === 'jump') jumpStream = null
      if (targetConnectionTransport === 'proxy') proxySocket = null
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connected',
      sshTransport: targetConnectionTransport,
      connectionReuse: targetConnectionReuse,
      ...(targetConnectionJump
        ? {
            jumpHost: targetConnectionJump.host,
            jumpPort: targetConnectionJump.port,
            jumpUsername: targetConnectionJump.username
          }
        : {}),
      targetHost: target.host,
      targetPort: target.port,
      targetUsername: target.username,
      message:
        targetConnectionReuse === 'reused'
          ? `SSH connection reused ${target.username}@${target.host}:${target.port}`
          : `SSH connected ${target.username}@${target.host}:${target.port}`
    })
    authClient.shell({ term: terminalType, cols, rows }, (error, channel) => {
      if (error) {
        fail(error, 'SSH shell failed.', 1)
        return
      }
      stream = channel
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'shell-ready',
        sshTransport: targetConnectionTransport,
        connectionReuse: targetConnectionReuse,
        ...(targetConnectionJump
          ? {
              jumpHost: targetConnectionJump.host,
              jumpPort: targetConnectionJump.port,
              jumpUsername: targetConnectionJump.username
            }
          : {}),
        targetHost: target.host,
        targetPort: target.port,
        targetUsername: target.username,
        message: `SSH shell ready ${target.username}@${target.host}:${target.port}`
      })
      while (pendingWrites.length) {
        stream.write(pendingWrites.shift() || '')
      }
      channel.on('data', (chunk: Buffer | string) => sink.data(chunk))
      channel.stderr.on('data', (chunk: Buffer | string) => sink.data(chunk))
      channel.on('close', () => finish(0, 'process'))
    })
  }

  const createConnectConfig = (authTarget: SshTerminalTarget) => {
    const connectConfig: ConnectConfig = {
      host: authTarget.host,
      port: authTarget.port,
      username: authTarget.username,
      tryKeyboard: Boolean(sink.keyboardInteractive),
      readyTimeout: runtimeConfig.readyTimeoutMs || defaultSshReadyTimeoutMs,
      keepaliveInterval: runtimeConfig.keepaliveIntervalMs || defaultSshKeepaliveIntervalMs
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
    const poolKey = jumpPoolKey(jumpTarget)
    if (jumpForwardUnsupportedKeys.has(poolKey)) {
      throw new SshJumpForwardError('SSH jump host TCP forwarding is disabled for this relay in the current app session.')
    }
    const pooledJump = getPooledClient(pooledJumpClients, poolKey)
    if (pooledJump) {
      jumpClient = pooledJump
      jumpClientIsPooled = true
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'proxy-opening',
        authScope: 'jump',
        sshTransport: 'jump',
        connectionReuse: 'reused',
        jumpHost: jumpTarget.host,
        jumpPort: jumpTarget.port,
        jumpUsername: jumpTarget.username,
        targetHost: target.host,
        targetPort: target.port,
        targetUsername: target.username,
        message: `Reusing SSH jump host ${terminalAuthLabel(jumpTarget)}`
      })
      return new Promise<SshTerminalChannel>((resolve, reject) => {
        if (typeof pooledJump.forwardOut !== 'function') {
          jumpForwardUnsupportedKeys.add(poolKey)
          removePooledClient(pooledJumpClients, poolKey, pooledJump)
          reject(new SshJumpForwardError('SSH jump host runtime does not support forwardOut.'))
          return
        }
        pooledJump.forwardOut('127.0.0.1', 0, target.host, target.port, (error, channel) => {
          if (error) {
            jumpForwardUnsupportedKeys.add(poolKey)
            removePooledClient(pooledJumpClients, poolKey, pooledJump)
            try {
              pooledJump.end()
            } catch {}
            reject(new SshJumpForwardError(`SSH jump host forward failed: ${error.message}`))
            return
          }
          jumpStream = channel
          resolve(channel)
        })
      })
    }

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
      connectionReuse: 'created',
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
            jumpForwardUnsupportedKeys.add(poolKey)
            rejectOnce(new SshJumpForwardError('SSH jump host runtime does not support forwardOut.'))
            return
          }
          lifecycle = sendLifecycle(id, sink, {
            ...lifecycleBase,
            stage: 'proxy-opening',
            authScope: 'jump',
            sshTransport: 'jump',
            connectionReuse: 'created',
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
              jumpForwardUnsupportedKeys.add(poolKey)
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
            rememberPooledClient(pooledJumpClients, poolKey, jump)
            jumpClient = jump
            jumpClientIsPooled = true
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

    const relayShell = relayShellCommand(target)
    const lifecycleFields = relayShellLifecycleFields(jumpTarget)
    let remoteHop: TerminalLifecycleEvent['remoteHop'] = 'unknown'
    let endpointConfidence: TerminalLifecycleEvent['endpointConfidence'] = 'unknown'
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...lifecycleFields,
      stage: 'proxy-opening',
      authScope: 'jump',
      connectionReuse: 'created',
      remoteHop,
      endpointConfidence,
      errorCode: 'SSH_JUMP_FORWARD_FAILED',
      errorMessage: fallbackMessage,
      message: 'SSH jump TCP forwarding failed; starting relay shell fallback.'
    })

    const relayDelayedWrites = pendingWrites.splice(0)
    let ptyProcess: SshTerminalPtyProcess | null = null
    const hiddenTextFilter = createHiddenTextFilter((chunk) => sink.data(chunk))
    const writeRelayPty = (data: string) => {
      ptyProcess?.write(data)
    }
    const flushRelayDelayedWrites = () => {
      while (relayDelayedWrites.length) {
        writeRelayPty(String(relayDelayedWrites.shift() || ''))
      }
    }

    const relayEnv = {
      ...getEnv(),
      TERM: terminalType,
      AIOPSTERM_TRANSPORT: 'relay-shell',
      AIOPSTERM_RELAY_HOST: jumpTarget.host,
      AIOPSTERM_TARGET_HOST: target.host
    }
    let bootstrapSent = false
    let bootstrapProbeBuffer = ''
    let targetProbeBuffer = ''
    let targetReadyLogged = false
    let relayConnectionReuse: TerminalLifecycleEvent['connectionReuse'] = 'created'
    const markTargetReady = (endpoint: { actualUsername: string; actualHost: string }) => {
      if (targetReadyLogged || closed) return
      targetReadyLogged = true
      remoteHop = 'target'
      endpointConfidence = 'inferred'
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        ...lifecycleFields,
        stage: 'shell-ready',
        authScope: 'target',
        remoteHop,
        expectedHost: target.host,
        actualHost: cleanText(endpoint.actualHost),
        actualUsername: cleanText(endpoint.actualUsername),
        endpointConfidence,
        message: `SSH target shell inferred via relay ${terminalAuthLabel(target)}`
      })
      flushRelayDelayedWrites()
    }
    const sendBootstrap = () => {
      if (bootstrapSent || closed) return
      bootstrapSent = true
      remoteHop = 'relay'
      endpointConfidence = 'inferred'
      const bootstrapInput = `${relayShell}\n`
      hiddenTextFilter.addHiddenText(bootstrapInput)
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        ...lifecycleFields,
        stage: 'connected',
        authScope: 'jump',
        connectionReuse: relayConnectionReuse,
        remoteHop,
        expectedHost: jumpTarget.host,
        endpointConfidence,
        message: `SSH relay shell connected; starting nested SSH ${terminalAuthLabel(target)}`
      })
      writeRelayPty(bootstrapInput)
    }
    const relayMasterPath = relayControlPath(jumpTarget)
    relayConnectionReuse = pathExists(relayMasterPath) ? 'reused' : 'created'
    const args = relayShellSshArgs(jumpTarget)
    const relayProcess = ptyRuntime.spawn('ssh', args, {
      name: terminalType,
      cols,
      rows,
      cwd: getLocalSshSpawnCwd(),
      env: relayEnv
    })
    ptyProcess = relayProcess
    relayPty = relayProcess
    stream = {
      write(data: string | Buffer) {
        relayProcess.write(typeof data === 'string' ? data : data.toString('utf8'))
      },
      setWindow(nextRows: number, nextCols: number) {
        relayProcess.resize(nextCols, nextRows)
      },
      close() {
        relayProcess.kill()
      }
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...lifecycleFields,
      stage: 'connecting',
      authScope: 'jump',
      connectionReuse: relayConnectionReuse,
      remoteHop,
      endpointConfidence,
      message: `Opening reusable SSH relay shell ${terminalAuthLabel(jumpTarget)}`
    })
    relayProcess.onData((chunk) => {
      if (!bootstrapSent) {
        bootstrapProbeBuffer = `${bootstrapProbeBuffer}${chunk}`.slice(-4096)
        if (shouldBootstrapRelayShell(bootstrapProbeBuffer)) sendBootstrap()
      } else if (!targetReadyLogged) {
        targetProbeBuffer = `${targetProbeBuffer}${chunk}`.slice(-8192)
        const endpoint = inferRelayTargetReady(targetProbeBuffer, jumpTarget, target)
        if (endpoint) markTargetReady(endpoint)
      }
      hiddenTextFilter.handle(chunk)
    })
    relayProcess.onExit((event) => {
      hiddenTextFilter.flush()
      if (relayPty === relayProcess) relayPty = null
      if (stream?.close) stream = null
      finish(Number.isFinite(event.exitCode) ? event.exitCode : null, 'process', {
        ...lifecycleFields,
        remoteHop,
        endpointConfidence,
        message: 'SSH relay shell exited.'
      })
    })
  }

  const openTargetTransportAndConnect = async (authClient?: SshTerminalClient | null) => {
    const jumpTarget = resolveJumpHostTarget()
    let tunnel: SshTerminalChannel | null = null
    let proxyConfigForPool: SshProxyConfig | null = null
    if (!jumpTarget) {
      proxyConfigForPool = resolveSshProxyConfigForAsset(target.asset, getRuntimeConfig().sshProxyConfigs)
      if (proxyConfigForPool) {
        targetConnectionTransport = 'proxy'
        targetClientPoolable = true
        targetClientPoolKey = targetPoolKey('proxy', target, { proxy: proxyConfigForPool })
        targetClientAuthenticatedPoolKey = authenticatedTargetPoolKey('proxy', target, { proxy: proxyConfigForPool })
        const pooledTarget = getPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey])
        if (pooledTarget) {
          targetConnectionReuse = 'reused'
          targetClientIsPooled = true
          if (authClient && authClient !== pooledTarget) staleTargetClients.add(authClient)
          client = pooledTarget
          lifecycle = sendLifecycle(id, sink, {
            ...lifecycleBase,
            stage: 'connecting',
            authScope: 'target',
            sshTransport: 'proxy',
            connectionReuse: 'reused',
            proxyName: proxyConfigForPool.name,
            targetHost: target.host,
            targetPort: target.port,
            targetUsername: target.username,
            message: `Reusing SSH target connection ${terminalAuthLabel(target)}`
          })
          openShellOnClient(pooledTarget)
          return
        }
      }
    }
    if (jumpTarget) {
      targetConnectionJump = jumpTarget
      targetConnectionTransport = 'jump'
      targetClientPoolable = true
      targetClientPoolKey = targetPoolKey('jump', target, { jump: jumpTarget })
      targetClientAuthenticatedPoolKey = authenticatedTargetPoolKey('jump', target, { jump: jumpTarget })
      const pooledTarget = getPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey])
      if (pooledTarget) {
        targetConnectionReuse = 'reused'
        targetClientIsPooled = true
        if (authClient && authClient !== pooledTarget) staleTargetClients.add(authClient)
        client = pooledTarget
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'connecting',
          authScope: 'target',
          sshTransport: 'jump',
          connectionReuse: 'reused',
          jumpHost: jumpTarget.host,
          jumpPort: jumpTarget.port,
          jumpUsername: jumpTarget.username,
          targetHost: target.host,
          targetPort: target.port,
          targetUsername: target.username,
          message: `Reusing SSH target connection ${terminalAuthLabel(target)}`
        })
        openShellOnClient(pooledTarget)
        return
      }
    }
    if (jumpTarget) {
      try {
        tunnel = await openJumpHostTunnel(jumpTarget)
      } catch (error) {
        if (error instanceof SshJumpForwardError) {
          if (authClient) {
            staleTargetClients.add(authClient)
            try {
              authClient.end()
            } catch {}
          }
          openRelayShellFallback(jumpTarget, error)
          return
        }
        throw error
      }
    }

    const { connectConfig, hasAgentAuth } = createConnectConfig(target)
    hasConfiguredAgentAuth = hasAgentAuth
    targetConnectionJump = jumpTarget
    targetConnectionTransport = jumpTarget ? 'jump' : 'direct'

    if (jumpTarget) {
      connectConfig.sock = tunnel as ConnectConfig['sock']
      delete connectConfig.host
      delete connectConfig.port
    } else {
      if (proxyConfigForPool) {
        const proxy = await getProxySocketForAsset()(target.asset, getRuntimeConfig().sshProxyConfigs, target.host, target.port)
        if (!proxy) throw new Error(`SSH proxy config "${proxyConfigForPool.name}" did not create a socket.`)
        proxyConfigForPool = proxy.config
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
        targetConnectionTransport = 'proxy'
      }
    }
    targetClientPoolable = true
    const targetPoolTransport = jumpTarget ? 'jump' : proxyConfigForPool ? 'proxy' : 'direct'
    targetClientPoolKey = targetClientPoolable ? targetPoolKey(targetPoolTransport, target, { proxy: proxyConfigForPool, jump: jumpTarget }) : ''
    targetClientAuthenticatedPoolKey = targetClientPoolable ? authenticatedTargetPoolKey(targetPoolTransport, target, { proxy: proxyConfigForPool, jump: jumpTarget }) : ''
    if (targetClientPoolable) {
      const pooledTarget = getPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey])
      if (pooledTarget) {
        targetConnectionReuse = 'reused'
        targetClientIsPooled = true
        if (authClient && authClient !== pooledTarget) staleTargetClients.add(authClient)
        client = pooledTarget
        cleanupJumpTransport()
        cleanupProxyTransport()
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'connecting',
          authScope: 'target',
          sshTransport: targetConnectionTransport,
          connectionReuse: 'reused',
          targetHost: target.host,
          targetPort: target.port,
          targetUsername: target.username,
          message: `Reusing SSH target connection ${terminalAuthLabel(target)}`
        })
        openShellOnClient(pooledTarget)
        return
      }
    }
    targetConnectionReuse = 'created'
    targetClientIsPooled = targetClientPoolable
    if (closed) {
      cleanupTransports()
      return
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connecting',
      authScope: 'target',
      sshTransport: jumpTarget ? 'jump' : connectConfig.sock ? 'proxy' : 'direct',
      connectionReuse: 'created',
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
    const activeClient = authClient || createTargetClient()
    client = activeClient
    activeClient.connect(connectConfig)
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
      const nextClient = createTargetClient()
      client = nextClient
      await openTargetTransportAndConnect(nextClient)
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
        openShellOnClient(authClient)
      })
      .on('error', (error) => {
        if (targetClientPoolable) removePooledClientAliases(pooledTargetClients, authClient)
        if (targetClientIsPooled && authClient === client && stream) return
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
        if (targetClientPoolable) removePooledClientAliases(pooledTargetClients, authClient)
        if (
          targetClientIsPooled &&
          authClient === client &&
          (stream || isPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey], authClient))
        )
          return
        if (staleTargetClients.has(authClient) || authClient !== client) return
        finish(null, 'unknown')
      })
      .on('end', () => {
        if (targetClientPoolable) removePooledClientAliases(pooledTargetClients, authClient)
        if (
          targetClientIsPooled &&
          authClient === client &&
          (stream || isPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey], authClient))
        )
          return
        if (staleTargetClients.has(authClient) || authClient !== client) return
        finish(null, 'unknown')
      })
  }

  const createTargetClient = () => {
    const authClient = new ssh2.Client()
    attachTargetClient(authClient)
    return authClient
  }

  void (async () => {
    try {
      await openTargetTransportAndConnect()
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
