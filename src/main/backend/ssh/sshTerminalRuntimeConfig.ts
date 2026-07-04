import type { TerminalCreateOptions, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import { shouldUseSshTerminalBackendDouble } from '@shared/runtimeSwitches'
import { createSshProxySocketForAsset } from './sshProxy'
import { loadSsh2 } from './ssh2Runtime'
import { defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from './sshDefaults'
import { createTerminalErrorLifecycleEvent, createTerminalLifecycleEvent } from '../terminal/terminal'
import type { AssetSecret, SshTerminalCreateResult, SshTerminalEventSink, SshTerminalPtyRuntime, SshTerminalRuntimeConfig, SshTerminalSsh2Runtime, SshTerminalTarget } from './sshTerminalTypes'

export const runtimeConfig: SshTerminalRuntimeConfig = {}

export const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const textSecret = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length ? value : undefined
}

export const setSshTerminalBackendRuntimeConfig = (config: SshTerminalRuntimeConfig = {}) => {
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
}

export const getRuntimeConfig = () =>
  runtimeConfig.getConfig?.() || {
    sshProxyConfigs: [],
    sshAgentKeys: [],
    terminal: undefined
  }

export const getSsh2Runtime = (): SshTerminalSsh2Runtime | null =>
  runtimeConfig.ssh2Runtime === undefined ? (loadSsh2() as SshTerminalSsh2Runtime | null) : runtimeConfig.ssh2Runtime

export const getProxySocketForAsset = () => runtimeConfig.createSshProxySocketForAsset || createSshProxySocketForAsset

export const getPtyRuntime = (): SshTerminalPtyRuntime | null => {
  if (runtimeConfig.loadPty) return runtimeConfig.loadPty()
  try {
    return require('node-pty') as SshTerminalPtyRuntime
  } catch {
    return null
  }
}

export const getEnv = () => runtimeConfig.getEnv?.() || process.env

export const getTerminalType = (options: TerminalCreateOptions) => {
  const terminalType = typeof options.terminalType === 'string' ? options.terminalType.trim() : ''
  return terminalType || 'xterm-256color'
}

export const getSshReadyTimeoutMs = () => runtimeConfig.readyTimeoutMs || defaultSshReadyTimeoutMs

export const getSshKeepaliveIntervalMs = () => runtimeConfig.keepaliveIntervalMs || defaultSshKeepaliveIntervalMs

export const getConfiguredSshControlDir = () => cleanText(runtimeConfig.getSshControlDir?.())

export const resolveAsset = (assetId: string) => runtimeConfig.getAsset?.(assetId) || null

export const resolveAssetSecret = (assetId: string) => runtimeConfig.getAssetSecret?.(assetId) || {}

export const resolveKeychainSecret = (keychainId: string) => runtimeConfig.getKeychainSecret?.(keychainId) || {}

export const shouldUseBackendDouble = () => runtimeConfig.useBackendDouble === true || shouldUseSshTerminalBackendDouble()

export const resolveSshTerminalTarget = (options: TerminalCreateOptions): SshTerminalTarget => {
  const asset = options.assetId ? resolveAsset(options.assetId) : null
  const secret = options.assetId ? resolveAssetSecret(options.assetId) : {}
  const keychainSecret = asset?.keychainId ? resolveKeychainSecret(asset.keychainId) : {}
  const host = cleanText(options.ssh?.host) || cleanText(asset?.host)
  const username = cleanText(options.ssh?.username) || cleanText(asset?.username)
  const port = Number(options.ssh?.port || asset?.port || 22)
  const requestProxyName = cleanText(options.ssh?.proxyName)
  const targetProxyName = asset?.needProxy ? cleanText(asset.proxyName) : requestProxyName
  const requestJumpHostId = cleanText(options.ssh?.jumpHostId)
  return {
    asset: asset || (options.ssh?.needProxy || requestJumpHostId ? { needProxy: Boolean(options.ssh?.needProxy), proxyName: targetProxyName, jumpHostId: requestJumpHostId } : null),
    host,
    username,
    port,
    password: textSecret(options.ssh?.password) || textSecret(secret.password),
    privateKey: textSecret(options.ssh?.privateKey) || textSecret(secret.privateKey) || textSecret(keychainSecret.privateKey),
    passphrase: textSecret(options.ssh?.passphrase) || textSecret(secret.passphrase) || textSecret(keychainSecret.passphrase),
    title: cleanText(options.title) || cleanText(asset?.name) || cleanText(asset?.title) || host
  }
}

export const createLifecycleBase = (id: string, target: SshTerminalTarget) => {
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

export const sendLifecycle = (id: string, sink: SshTerminalEventSink, event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number }) => {
  const payload = createTerminalLifecycleEvent(id, event)
  sink.lifecycle(payload)
  return payload
}

export const sendErrorLifecycle = (
  id: string,
  sink: SshTerminalEventSink,
  error: unknown,
  event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>>
) => {
  const payload = createTerminalErrorLifecycleEvent(id, 'ssh', error, event)
  sink.lifecycle(payload)
  return payload
}

export const failBeforeSession = (
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

export const isValidTarget = (target: SshTerminalTarget) =>
  Boolean(target.host && target.username && Number.isInteger(target.port) && target.port >= 1 && target.port <= 65535)
