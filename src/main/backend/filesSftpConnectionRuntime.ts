import { createHash } from 'crypto'
import type { FileListOptions } from '@shared/contracts/files'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { ConnectConfig, SFTPWrapper } from 'ssh2'
import { getAsset, getAssetSecret, getKeychainSecret } from './assets'
import { createConfiguredSshAgentAuth } from './sshAgent'
import { defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from './sshDefaults'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'
import { loadSsh2 } from './ssh2Runtime'
import { isFileTransferCancelledError } from './filesTransferRuntime'

export type RemoteSftpTarget = {
  assetId: string
  host: string
  username: string
  port: number
  password?: string
  privateKey?: string
  passphrase?: string
  agent?: ConnectConfig['agent']
  proxyAsset?: {
    needProxy?: boolean
    proxyName?: string
  } | null
}

export type FilesSftpUnsupportedCode = 'FILES_SFTP_UNAVAILABLE' | 'FILES_SFTP_JUMP_UNSUPPORTED'

type RemoteSftpPooledConnection = {
  key: string
  client: { end: () => void }
  sftp: SFTPWrapper
  proxySocket: SshProxySocket | null
  refCount: number
  closing: boolean
  lastUsedAt: number
  closeTimer: ReturnType<typeof setTimeout> | null
}

export type FilesSftpRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  sftpPoolIdleTtlMs?: number
}

type FilesSftpRuntimeState = {
  getConfig?: FilesSftpRuntimeConfig['getConfig']
  sftpPoolIdleTtlMs: number
}

let filesSftpRuntimeConfig: FilesSftpRuntimeState = {
  sftpPoolIdleTtlMs: 30_000
}

const getSshProxyConfigs = () => filesSftpRuntimeConfig.getConfig?.().sshProxyConfigs || []
const getSshAgentRuntimeConfig = () => {
  const config = filesSftpRuntimeConfig.getConfig?.()
  return {
    terminal: config?.terminal,
    sshAgentKeys: config?.sshAgentKeys
  }
}

const textSecret = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const usablePrivateKey = (value: unknown) => {
  const privateKey = textSecret(value)
  if (!privateKey.includes('PRIVATE KEY')) return ''
  const body = privateKey
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('BEGIN') && !line.includes('END'))
    .join('')
  return body.length >= 32 ? privateKey : ''
}

const assetIdCandidates = (sessionId?: string) => {
  const id = textSecret(sessionId)
  return [...new Set([id, id.replace(/^folder_/, '')].filter(Boolean))]
}

export class FilesSftpUnsupportedError extends Error {
  constructor(
    message: string,
    readonly errorCode: FilesSftpUnsupportedCode
  ) {
    super(message)
    this.name = 'FilesSftpUnsupportedError'
  }
}

export const sftpUnavailableMessage = 'SFTP connection is unavailable for this file session.'
const sftpJumpHostUnsupportedMessage =
  '该主机通过跳板机/relay shell 登录，文件管理暂不支持 SFTP。请使用支持 SSH TCP 转发的跳板机，或在终端内使用 scp/rsync。'

export const configureFilesSftpConnectionRuntime = (config: FilesSftpRuntimeConfig = {}) => {
  clearRemoteSftpPool()
  filesSftpRuntimeConfig = {
    sftpPoolIdleTtlMs: Math.max(0, Number(config.sftpPoolIdleTtlMs ?? 30_000) || 0),
    ...(config.getConfig ? { getConfig: config.getConfig } : {})
  }
}

export const resolveRemoteSftpTarget = (options: FileListOptions): RemoteSftpTarget | null => {
  if (options.kind !== 'remote') return null
  if (textSecret(options.jumpHostId)) throw new FilesSftpUnsupportedError(sftpJumpHostUnsupportedMessage, 'FILES_SFTP_JUMP_UNSUPPORTED')
  const asset = assetIdCandidates(options.sessionId)
    .map((id) => getAsset(id))
    .find((item) => item && !item.isLocalShell)
  if (!asset) return null
  if (asset.jumpHostId) throw new FilesSftpUnsupportedError(sftpJumpHostUnsupportedMessage, 'FILES_SFTP_JUMP_UNSUPPORTED')

  const secret = getAssetSecret(asset.id)
  const keychainSecret = asset.keychainId ? getKeychainSecret(asset.keychainId) : {}
  const password = textSecret(secret.password)
  const privateKey = usablePrivateKey(secret.privateKey) || usablePrivateKey(keychainSecret.privateKey)
  const passphrase = textSecret(secret.passphrase) || textSecret(keychainSecret.passphrase)
  const configuredAgent =
    !password && !privateKey ? createConfiguredSshAgentAuth(getSshAgentRuntimeConfig(), (keyChainId) => getKeychainSecret(keyChainId))?.agent : undefined
  const agent = configuredAgent || (!password && !privateKey && process.env.AIOPSTERM_FILES_SFTP_AGENT === '1' ? textSecret(process.env.SSH_AUTH_SOCK) : '')
  const host = textSecret(asset.host || asset.ip || options.host)
  const username = textSecret(asset.username)
  const port = Number(asset.port || 22)
  if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!password && !privateKey && !agent) return null
  return {
    assetId: asset.id,
    host,
    username,
    port,
    ...(password ? { password } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(agent ? { agent } : {}),
    proxyAsset: {
      needProxy: Boolean(asset.needProxy),
      proxyName: asset.proxyName
    }
  }
}

export const isFilesSftpUnsupportedError = (error: unknown): error is FilesSftpUnsupportedError => error instanceof FilesSftpUnsupportedError
export const sftpUnavailableError = (errorCode: FilesSftpUnsupportedCode = 'FILES_SFTP_UNAVAILABLE', errorMessage = sftpUnavailableMessage) => ({
  ok: false as const,
  errorCode,
  errorMessage
})

const remoteSftpPool = new Map<string, RemoteSftpPooledConnection>()
const remoteSftpPendingConnections = new Map<string, Promise<RemoteSftpPooledConnection>>()

const remoteSftpTargetKey = (target: RemoteSftpTarget) => {
  const secretFingerprint = createHash('sha256')
    .update([target.password || '', target.privateKey || '', target.passphrase || '', target.agent ? 'agent' : ''].join('\0'))
    .digest('hex')
    .slice(0, 16)
  return [
    target.assetId,
    target.host,
    target.port,
    target.username,
    target.proxyAsset?.needProxy ? target.proxyAsset.proxyName || 'proxy' : 'direct',
    secretFingerprint
  ].join('|')
}

const closeRemoteSftpConnection = (connection: RemoteSftpPooledConnection) => {
  if (connection.closing) return
  connection.closing = true
  if (connection.closeTimer) {
    clearTimeout(connection.closeTimer)
    connection.closeTimer = null
  }
  remoteSftpPool.delete(connection.key)
  try {
    connection.client.end()
  } catch {}
  try {
    connection.proxySocket?.destroy()
  } catch {}
}

const scheduleRemoteSftpConnectionClose = (connection: RemoteSftpPooledConnection) => {
  if (connection.refCount > 0 || connection.closing) return
  const ttl = filesSftpRuntimeConfig.sftpPoolIdleTtlMs
  if (connection.closeTimer) clearTimeout(connection.closeTimer)
  if (ttl <= 0) {
    closeRemoteSftpConnection(connection)
    return
  }
  connection.closeTimer = setTimeout(() => {
    if (connection.refCount <= 0) closeRemoteSftpConnection(connection)
  }, ttl)
}

export const clearRemoteSftpPool = () => {
  remoteSftpPendingConnections.clear()
  for (const connection of [...remoteSftpPool.values()]) closeRemoteSftpConnection(connection)
}

const createRemoteSftpConnection = async (target: RemoteSftpTarget, key: string): Promise<RemoteSftpPooledConnection> => {
  const ssh2 = loadSsh2()
  if (!ssh2) throw new Error('ssh2 runtime is not available')

  const client = new ssh2.Client()
  const connectConfig: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.username,
    readyTimeout: defaultSshReadyTimeoutMs,
    keepaliveInterval: defaultSshKeepaliveIntervalMs
  }
  if (target.password) connectConfig.password = target.password
  if (target.privateKey) connectConfig.privateKey = target.privateKey
  if (target.passphrase) connectConfig.passphrase = target.passphrase
  if (target.agent) connectConfig.agent = target.agent
  let proxySocket: SshProxySocket | null = null
  const proxy = await createSshProxySocketForAsset(target.proxyAsset, getSshProxyConfigs(), target.host, target.port)
  if (proxy) {
    proxySocket = proxy.socket
    connectConfig.sock = proxy.socket
    delete connectConfig.host
    delete connectConfig.port
  }

  return new Promise<RemoteSftpPooledConnection>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    const closeClient = () => {
      try {
        client.end()
      } catch {}
      try {
        proxySocket?.destroy()
      } catch {}
    }
    client
      .once('ready', () => {
        client.sftp((error, sftp) => {
          if (error || !sftp) {
            settle(() => reject(error || new Error('SFTP session is unavailable')))
            closeClient()
            return
          }
          const connection: RemoteSftpPooledConnection = {
            key,
            client,
            sftp,
            proxySocket,
            refCount: 0,
            closing: false,
            lastUsedAt: Date.now(),
            closeTimer: null
          }
          client.once('error', () => closeRemoteSftpConnection(connection))
          client.once('close', () => closeRemoteSftpConnection(connection))
          settle(() => resolve(connection))
        })
      })
      .once('error', (error) =>
        settle(() => {
          closeClient()
          reject(error)
        })
      )
      .once('close', () => {
        if (!settled)
          settle(() => {
            closeClient()
            reject(new Error('SFTP connection closed before it became ready'))
          })
      })
    client.connect(connectConfig)
  })
}

const acquireRemoteSftpConnection = async (target: RemoteSftpTarget) => {
  const key = remoteSftpTargetKey(target)
  const existing = remoteSftpPool.get(key)
  if (existing && !existing.closing) {
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer)
      existing.closeTimer = null
    }
    existing.refCount += 1
    existing.lastUsedAt = Date.now()
    return existing
  }
  const pending =
    remoteSftpPendingConnections.get(key) ||
    createRemoteSftpConnection(target, key)
      .then((connection) => {
        remoteSftpPool.set(key, connection)
        return connection
      })
      .finally(() => {
        remoteSftpPendingConnections.delete(key)
      })
  if (!remoteSftpPendingConnections.has(key)) remoteSftpPendingConnections.set(key, pending)
  const connection = await pending
  if (connection.closeTimer) {
    clearTimeout(connection.closeTimer)
    connection.closeTimer = null
  }
  connection.refCount += 1
  connection.lastUsedAt = Date.now()
  return connection
}

const releaseRemoteSftpConnection = (connection: RemoteSftpPooledConnection, invalidate = false) => {
  connection.refCount = Math.max(0, connection.refCount - 1)
  connection.lastUsedAt = Date.now()
  if (invalidate) {
    closeRemoteSftpConnection(connection)
    return
  }
  scheduleRemoteSftpConnectionClose(connection)
}

export const withRemoteSftp = async <T>(target: RemoteSftpTarget, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> => {
  const connection = await acquireRemoteSftpConnection(target)
  let invalidate = false
  try {
    return await operation(connection.sftp)
  } catch (error) {
    invalidate = !isFileTransferCancelledError(error)
    throw error
  } finally {
    releaseRemoteSftpConnection(connection, invalidate)
  }
}

export const getRemoteSftpPoolSnapshotForTests = () => ({
  active: [...remoteSftpPool.values()].map((connection) => ({
    key: connection.key,
    refCount: connection.refCount,
    closing: connection.closing,
    hasCloseTimer: Boolean(connection.closeTimer)
  })),
  pending: remoteSftpPendingConnections.size
})
