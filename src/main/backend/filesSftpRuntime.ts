import { createHash } from 'crypto'
import { dirname as getLocalDirname, join } from 'path'
import { mkdir, open as openFile, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import type {
  FileContentOptions,
  FileEntryMutation,
  FileEntryMutationResult,
  FileListEntry,
  FileListOptions,
  FileReadContentResult,
  FileTransferOperationResult,
  FileTransferTask,
  FileWriteContentResult
} from '@shared/contracts/files'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { ConnectConfig, FileEntry as SftpFileEntry, SFTPWrapper, Stats as SftpStats } from 'ssh2'
import { getAsset, getAssetSecret, getKeychainSecret } from './assets'
import { createConfiguredSshAgentAuth } from './sshAgent'
import { defaultSshKeepaliveIntervalMs, defaultSshReadyTimeoutMs } from './sshDefaults'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'
import { loadSsh2 } from './ssh2Runtime'
import { ensureTextSize, modeString, normalizeRemotePath, remoteBasename, remoteDirname, sortFileEntries, validateFileContentVersion } from './filesPathRuntime'
import {
  addActiveFileTransferChild,
  cancelRunningFileTransferTask,
  completeRunningFileTransferTask,
  createBackendFileTransferTask,
  createFileTransferAbortControl,
  createRemoteCopyTransferTask,
  createRunningFileTransferTask,
  fileTransferTaskHosts,
  finishActiveFileTransferTask,
  isFileTransferCancelledError,
  registerActiveFileTransferTask,
  remoteCopyChildTask,
  remoteCopyResultFileCount,
  transferByteCount,
  transferCancelledError,
  transferFromHost,
  transferToHost,
  updateActiveFileTransferTask,
  updateRunningFileTransferProgress,
  updateSingleFileTransferProgress,
  writeContentTask,
  type FileTransferAbortControl,
  type RemoteCopyTransferStats
} from './filesTransferRuntime'

type RemoteSftpTarget = {
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

type FilesSftpUnsupportedCode = 'FILES_SFTP_UNAVAILABLE' | 'FILES_SFTP_JUMP_UNSUPPORTED'

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

type SftpFileHandle = unknown
type SftpLowLevelWrapper = SFTPWrapper & {
  open(path: string, flags: string, callback: (error: Error | null, handle?: SftpFileHandle) => void): void
  read(handle: SftpFileHandle, buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null, bytesRead?: number) => void): void
  write(handle: SftpFileHandle, buffer: Buffer, offset: number, length: number, position: number, callback: (error?: Error | null) => void): void
  close(handle: SftpFileHandle, callback: (error?: Error | null) => void): void
}
type SftpReadlinkWrapper = SFTPWrapper & {
  readlink(path: string, callback: (error: Error | null, target?: string) => void): void
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

export const configureFilesSftpRuntime = (config: FilesSftpRuntimeConfig = {}) => {
  clearRemoteSftpPool()
  filesSftpRuntimeConfig = {
    sftpPoolIdleTtlMs: Math.max(0, Number(config.sftpPoolIdleTtlMs ?? 30_000) || 0),
    ...(config.getConfig ? { getConfig: config.getConfig } : {})
  }
}

const getSshProxyConfigs = () => filesSftpRuntimeConfig.getConfig?.().sshProxyConfigs || []
const getSshAgentRuntimeConfig = () => {
  const config = filesSftpRuntimeConfig.getConfig?.()
  return {
    terminal: config?.terminal,
    sshAgentKeys: config?.sshAgentKeys
  }
}

const seedTime = new Date('2026-06-04T05:10:00.000Z').getTime()

const parentDirectoryEntry = (path: string): FileListEntry => ({
  name: '..',
  path,
  type: 'directory',
  size: 0,
  modifiedAt: seedTime,
  mode: 'drwxr-xr-x'
})

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

const sftpUnavailableMessage = 'SFTP connection is unavailable for this file session.'
const sftpJumpHostUnsupportedMessage =
  '该主机通过跳板机/relay shell 登录，文件管理暂不支持 SFTP。请使用支持 SSH TCP 转发的跳板机，或在终端内使用 scp/rsync。'

export { sftpUnavailableMessage }

const resolveRemoteSftpTarget = (options: FileListOptions): RemoteSftpTarget | null => {
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

const sftpErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'SFTP operation failed'))
export const isFilesSftpUnsupportedError = (error: unknown): error is FilesSftpUnsupportedError => error instanceof FilesSftpUnsupportedError
export const sftpUnavailableError = (errorCode: FilesSftpUnsupportedCode = 'FILES_SFTP_UNAVAILABLE', errorMessage = sftpUnavailableMessage) => ({
  ok: false as const,
  errorCode,
  errorMessage
})

const isNotFoundError = (error: unknown) => {
  const code = (error as { code?: unknown } | undefined)?.code
  const message = sftpErrorMessage(error).toLowerCase()
  return code === 'ENOENT' || code === 2 || message.includes('no such file') || message.includes('not found')
}

const fileError = (error: unknown, errorCode: string) => {
  if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
  const code = (error as { code?: unknown } | undefined)?.code
  if (isNotFoundError(error)) return { ok: false as const, errorCode: 'not_found', errorMessage: 'File entry not found' }
  if (code === 'EACCES' || code === 'EPERM' || sftpErrorMessage(error).toLowerCase().includes('permission')) {
    return { ok: false as const, errorCode: 'permission', errorMessage: 'Permission denied' }
  }
  return { ok: false as const, errorCode, errorMessage: sftpErrorMessage(error) }
}

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

const withRemoteSftp = async <T>(target: RemoteSftpTarget, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> => {
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

const sftpStat = (sftp: SFTPWrapper, path: string) =>
  new Promise<SftpStats>((resolve, reject) => {
    sftp.stat(path, (error, stats) => (error ? reject(error) : resolve(stats)))
  })

const sftpReadFile = (sftp: SFTPWrapper, path: string) =>
  new Promise<Buffer>((resolve, reject) => {
    sftp.readFile(path, (error, content) => (error ? reject(error) : resolve(Buffer.isBuffer(content) ? content : Buffer.from(String(content)))))
  })

const sftpWriteFile = (sftp: SFTPWrapper, path: string, content: Buffer) =>
  new Promise<void>((resolve, reject) => {
    sftp.writeFile(path, content, (error) => (error ? reject(error) : resolve()))
  })

const isSftpLowLevelWrapper = (sftp: SFTPWrapper): sftp is SftpLowLevelWrapper => {
  const candidate = sftp as Partial<SftpLowLevelWrapper>
  return (
    typeof candidate.open === 'function' &&
    typeof candidate.read === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.close === 'function'
  )
}

const sftpCloseHandle = (sftp: SftpLowLevelWrapper, handle: SftpFileHandle) =>
  new Promise<void>((resolve, reject) => {
    sftp.close(handle, (error) => (error ? reject(error) : resolve()))
  })

const cancellableTransferPromise = <T>(control: FileTransferAbortControl, executor: (settle: (error: Error | null, value?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = control.onCancel(() => {
      if (settled) return
      settled = true
      reject(transferCancelledError())
    })
    try {
      executor((error, value) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve(value as T)
      })
    } catch (error) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
  })

const sftpOpenCancellable = (sftp: SftpLowLevelWrapper, path: string, flags: string, control: FileTransferAbortControl) =>
  cancellableTransferPromise<SftpFileHandle>(control, (settle) => {
    sftp.open(path, flags, (error, handle) => settle(error || (!handle ? new Error('SFTP file handle is unavailable') : null), handle))
  })

const sftpReadChunkCancellable = (
  sftp: SftpLowLevelWrapper,
  handle: SftpFileHandle,
  buffer: Buffer,
  length: number,
  position: number,
  control: FileTransferAbortControl
) =>
  cancellableTransferPromise<number>(control, (settle) => {
    sftp.read(handle, buffer, 0, length, position, (error, bytesRead) => settle(error, bytesRead || 0))
  })

const sftpWriteChunkCancellable = (
  sftp: SftpLowLevelWrapper,
  handle: SftpFileHandle,
  buffer: Buffer,
  length: number,
  position: number,
  control: FileTransferAbortControl
) =>
  cancellableTransferPromise<void>(control, (settle) => {
    sftp.write(handle, buffer, 0, length, position, (error) => settle(error || null))
  })

const sftpRename = (sftp: SFTPWrapper, oldPath: string, newPath: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.rename(oldPath, newPath, (error) => (error ? reject(error) : resolve()))
  })

const sftpUnlink = (sftp: SFTPWrapper, path: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.unlink(path, (error) => (error ? reject(error) : resolve()))
  })

const sftpRmdir = (sftp: SFTPWrapper, path: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.rmdir(path, (error) => (error ? reject(error) : resolve()))
  })

const sftpChmod = (sftp: SFTPWrapper, path: string, mode: number) =>
  new Promise<void>((resolve, reject) => {
    sftp.chmod(path, mode, (error) => (error ? reject(error) : resolve()))
  })

const sftpMkdir = (sftp: SFTPWrapper, path: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.mkdir(path, (error) => (error ? reject(error) : resolve()))
  })

const sftpReaddir = (sftp: SFTPWrapper, path: string) =>
  new Promise<SftpFileEntry[]>((resolve, reject) => {
    sftp.readdir(path, (error, entries) => (error ? reject(error) : resolve(entries || [])))
  })

const sftpReadlink = (sftp: SFTPWrapper, path: string) => {
  const reader = sftp as Partial<SftpReadlinkWrapper>
  if (typeof reader.readlink !== 'function') return Promise.resolve('')
  return new Promise<string>((resolve) => {
    reader.readlink!(path, (error, target) => resolve(error ? '' : String(target || '')))
  })
}

const remotePathExistsAsDirectory = async (sftp: SFTPWrapper, path: string) => {
  try {
    const stats = await sftpStat(sftp, path)
    return sftpEntryType(stats) === 'directory'
  } catch (error) {
    if (isNotFoundError(error)) return false
    throw error
  }
}

const sftpEntryType = (attrs: Partial<SftpStats>): FileListEntry['type'] => {
  if (typeof attrs.isDirectory === 'function' && attrs.isDirectory()) return 'directory'
  if (typeof attrs.isSymbolicLink === 'function' && attrs.isSymbolicLink()) return 'link'
  if (typeof attrs.isFile === 'function' && attrs.isFile()) return 'file'
  const mode = Number(attrs.mode || 0) & 0o170000
  if (mode === 0o040000) return 'directory'
  if (mode === 0o120000) return 'link'
  return 'file'
}

const sftpEntryToFileListEntry = (parentPath: string, item: SftpFileEntry): FileListEntry => {
  const type = sftpEntryType(item.attrs as Partial<SftpStats>)
  const path = normalizeRemotePath(`${parentPath}/${item.filename}`)
  const mode = Number(item.attrs?.mode || 0)
  return {
    name: item.filename,
    path,
    type,
    size: Number(item.attrs?.size || 0),
    modifiedAt: Number(item.attrs?.mtime || 0) ? Number(item.attrs.mtime) * 1000 : Date.now(),
    ...(mode ? { mode: modeString(type, mode) } : {})
  }
}

const hydrateRemoteLinkTargets = async (sftp: SFTPWrapper, entries: FileListEntry[]) =>
  Promise.all(
    entries.map(async (entry) => {
      if (entry.type !== 'link') return entry
      const linkTarget = await sftpReadlink(sftp, entry.path)
      return linkTarget ? { ...entry, linkTarget } : entry
    })
  )

const ensureRemoteParentDirs = async (sftp: SFTPWrapper, remoteDir: string) => {
  const normalized = normalizeRemotePath(remoteDir)
  if (normalized === '/') return
  const parts = normalized.split('/').filter(Boolean)
  let cursor = ''
  for (const part of parts) {
    cursor = normalizeRemotePath(`${cursor}/${part}`)
    try {
      const stats = await sftpStat(sftp, cursor)
      if (sftpEntryType(stats) !== 'directory') throw new Error(`${cursor} is not a directory`)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      try {
        await sftpMkdir(sftp, cursor)
      } catch (mkdirError) {
        try {
          const stats = await sftpStat(sftp, cursor)
          if (sftpEntryType(stats) === 'directory') continue
        } catch {}
        throw mkdirError
      }
    }
  }
}

const sftpStatOrNull = async (sftp: SFTPWrapper, path: string) => {
  try {
    return await sftpStat(sftp, path)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

const removeRemotePathViaSftp = async (sftp: SFTPWrapper, path: string, recursive = false) => {
  const stats = await sftpStat(sftp, path)
  const type = sftpEntryType(stats)
  if (type !== 'directory') {
    await sftpUnlink(sftp, path)
    return
  }
  if (recursive) {
    const children = await sftpReaddir(sftp, path)
    for (const child of children) {
      if (child.filename === '.' || child.filename === '..') continue
      await removeRemotePathViaSftp(sftp, normalizeRemotePath(`${path}/${child.filename}`), true)
    }
  }
  await sftpRmdir(sftp, path)
}

const chmodRemotePathViaSftp = async (sftp: SFTPWrapper, path: string, mode: number, recursive = false) => {
  const stats = await sftpStat(sftp, path)
  await sftpChmod(sftp, path, mode)
  if (!recursive || sftpEntryType(stats) !== 'directory') return
  const children = await sftpReaddir(sftp, path)
  for (const child of children) {
    if (child.filename === '.' || child.filename === '..') continue
    await chmodRemotePathViaSftp(sftp, normalizeRemotePath(`${path}/${child.filename}`), mode, true)
  }
}

const copyRemotePathViaSftp = async (sftp: SFTPWrapper, sourcePath: string, targetPath: string) => {
  const sourceStats = await sftpStat(sftp, sourcePath)
  const sourceType = sftpEntryType(sourceStats)
  if (sourceType !== 'directory') {
    await ensureRemoteParentDirs(sftp, remoteDirname(targetPath))
    await sftpWriteFile(sftp, targetPath, await sftpReadFile(sftp, sourcePath))
    return
  }
  await ensureRemoteParentDirs(sftp, remoteDirname(targetPath))
  await sftpMkdir(sftp, targetPath).catch(async (error) => {
    const existing = await sftpStatOrNull(sftp, targetPath)
    if (!existing || sftpEntryType(existing) !== 'directory') throw error
  })
  const children = await sftpReaddir(sftp, sourcePath)
  for (const child of children) {
    if (child.filename === '.' || child.filename === '..') continue
    await copyRemotePathViaSftp(sftp, normalizeRemotePath(`${sourcePath}/${child.filename}`), normalizeRemotePath(`${targetPath}/${child.filename}`))
  }
}

const collectRemoteCopyStatsViaSftp = async (
  sftp: SFTPWrapper,
  sourcePath: string,
  targetPath: string,
  options: FileListOptions
): Promise<RemoteCopyTransferStats> => {
  const stats = await sftpStat(sftp, sourcePath)
  if (sftpEntryType(stats) !== 'directory') {
    return { bytes: Number(stats.size || 0), fileCount: 1, itemKind: 'file', children: [] }
  }

  const result: RemoteCopyTransferStats = { bytes: 0, fileCount: 0, itemKind: 'directory', children: [] }
  const collect = async (remoteDir: string, copiedDir: string) => {
    const rows = (await sftpReaddir(sftp, remoteDir))
      .filter((row) => row.filename !== '.' && row.filename !== '..')
      .sort((left, right) => left.filename.localeCompare(right.filename))
    for (const row of rows) {
      const sourceChild = normalizeRemotePath(`${remoteDir}/${row.filename}`)
      const targetChild = normalizeRemotePath(`${copiedDir}/${row.filename}`)
      const rowType = sftpEntryType(row.attrs as Partial<SftpStats>)
      if (rowType === 'directory') {
        await collect(sourceChild, targetChild)
        continue
      }
      const bytes = Number((row.attrs as Partial<SftpStats>)?.size || 0)
      result.bytes += bytes
      result.fileCount += 1
      result.children.push(remoteCopyChildTask(row.filename, sourceChild, targetChild, options))
    }
  }
  await collect(sourcePath, targetPath)
  return result
}

export const listRemoteFilesViaSftp = async (directory: string, options: FileListOptions): Promise<FileListEntry[] | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const path = normalizeRemotePath(directory)
  return withRemoteSftp(target, async (sftp) => {
    const readablePath = path === '/' || (await remotePathExistsAsDirectory(sftp, path)) ? path : '/'
    const rows = (await sftpReaddir(sftp, readablePath))
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .slice(0, 500)
      .map((item) => sftpEntryToFileListEntry(readablePath, item))
    const hydratedRows = await hydrateRemoteLinkTargets(sftp, rows)
    const parent = readablePath === '/' ? [] : [parentDirectoryEntry(remoteDirname(readablePath))]
    return [...parent, ...sortFileEntries(hydratedRows)]
  })
}

export const readRemoteFileViaSftp = async (filePath: string, options: FileContentOptions): Promise<FileReadContentResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const path = normalizeRemotePath(filePath)
  try {
    return await withRemoteSftp(target, async (sftp) => {
      let stats: SftpStats
      try {
        stats = await sftpStat(sftp, path)
      } catch (error) {
        if (isNotFoundError(error)) return { ok: true, data: { content: '', action: 'create', size: 0, mtimeMs: Date.now() } }
        throw error
      }
      if (sftpEntryType(stats) !== 'file') return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
      ensureTextSize(Number(stats.size || 0))
      const content = await sftpReadFile(sftp, path)
      ensureTextSize(content.length)
      return {
        ok: true,
        data: {
          content: content.toString('utf-8'),
          action: 'edit',
          size: content.length,
          mtimeMs: Number(stats.mtime || 0) ? Number(stats.mtime) * 1000 : Date.now()
        }
      }
    })
  } catch (error) {
    return fileError(error, 'read_failed')
  }
}

const validateRemoteFileContentVersion = async (
  sftp: SFTPWrapper,
  path: string,
  options: FileContentOptions
): Promise<FileWriteContentResult | null> => {
  if (options.overwrite) return null
  const stats = await sftpStatOrNull(sftp, path)
  return validateFileContentVersion(
    stats
      ? {
          exists: true,
          type: sftpEntryType(stats),
          size: Number(stats.size || 0),
          mtimeMs: Number(stats.mtime || 0) ? Number(stats.mtime) * 1000 : 0
        }
      : { exists: false },
    options
  )
}

export const writeRemoteFileViaSftp = async (filePath: string, content: Buffer, options: FileContentOptions): Promise<FileWriteContentResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const path = normalizeRemotePath(filePath)
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const conflict = await validateRemoteFileContentVersion(sftp, path, options)
      if (conflict) return conflict
      await ensureRemoteParentDirs(sftp, remoteDirname(path))
      await sftpWriteFile(sftp, path, content)
      const stats = await sftpStat(sftp, path)
      return {
        ok: true,
        data: {
          size: Number(stats.size || content.length),
          mtimeMs: Number(stats.mtime || 0) ? Number(stats.mtime) * 1000 : Date.now(),
          task: writeContentTask(path, options)
        }
      }
    })
  } catch (error) {
    return fileError(error, 'write_failed')
  }
}

export const mutateRemoteFileEntryViaSftp = async (mutation: FileEntryMutation, options: FileListOptions): Promise<FileEntryMutationResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const modifiedAt = Date.now()
  try {
    return await withRemoteSftp(target, async (sftp) => {
      if (mutation.kind === 'rename') {
        const oldPath = normalizeRemotePath(mutation.oldPath)
        const newPath = normalizeRemotePath(mutation.newPath)
        if (oldPath === newPath) return { ok: true, data: { affected: 0, path: newPath, mtimeMs: modifiedAt } }
        if (await sftpStatOrNull(sftp, newPath)) return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
        await ensureRemoteParentDirs(sftp, remoteDirname(newPath))
        await sftpRename(sftp, oldPath, newPath)
        const stats = await sftpStat(sftp, newPath)
        return { ok: true, data: { affected: 1, path: newPath, mtimeMs: Number(stats.mtime || 0) ? Number(stats.mtime) * 1000 : modifiedAt } }
      }
      if (mutation.kind === 'delete') {
        const path = normalizeRemotePath(mutation.path)
        await removeRemotePathViaSftp(sftp, path, Boolean(mutation.recursive))
        return { ok: true, data: { affected: 1, path, mtimeMs: modifiedAt } }
      }
      if (mutation.kind === 'copy' || mutation.kind === 'move') {
        const srcPath = normalizeRemotePath(mutation.srcPath)
        const targetPath = normalizeRemotePath(mutation.targetPath)
        if (srcPath === targetPath) return { ok: true, data: { affected: 0, path: targetPath, mtimeMs: modifiedAt } }
        const existingTarget = await sftpStatOrNull(sftp, targetPath)
        if (existingTarget) {
          if (!mutation.overwrite) return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
          await removeRemotePathViaSftp(sftp, targetPath, true)
        }
        await ensureRemoteParentDirs(sftp, remoteDirname(targetPath))
        if (mutation.kind === 'move') {
          await sftpRename(sftp, srcPath, targetPath)
        } else {
          await copyRemotePathViaSftp(sftp, srcPath, targetPath)
        }
        const stats = await sftpStat(sftp, targetPath)
        return { ok: true, data: { affected: 1, path: targetPath, mtimeMs: Number(stats.mtime || 0) ? Number(stats.mtime) * 1000 : modifiedAt } }
      }
      const path = normalizeRemotePath(mutation.path)
      if (!/^[0-7]{3,4}$/.test(mutation.mode)) return { ok: false, errorCode: 'invalid_mode', errorMessage: 'Permission mode must be octal' }
      const mode = Number.parseInt(mutation.mode, 8)
      await chmodRemotePathViaSftp(sftp, path, mode, Boolean(mutation.recursive))
      const stats = await sftpStat(sftp, path)
      return {
        ok: true,
        data: {
          affected: 1,
          path,
          mode: mutation.mode.slice(-3),
          mtimeMs: Number(stats.mtime || 0) ? Number(stats.mtime) * 1000 : modifiedAt
        }
      }
    })
  } catch (error) {
    return fileError(error, 'mutation_failed')
  }
}

const FILE_TRANSFER_CHUNK_SIZE = 64 * 1024

const fileTransferCancelledResult = (
  source: string,
  target: string,
  bytes: number,
  files: number,
  mtimeMs: number,
  itemKind: 'file' | 'directory',
  task: FileTransferTask
): FileTransferOperationResult => ({
  ok: true,
  data: {
    status: 'cancelled',
    source,
    target,
    bytes,
    files: Math.max(files, 1),
    mtimeMs,
    itemKind,
    task
  }
})

const downloadRemoteFileStreamViaSftp = async (
  sftp: SftpLowLevelWrapper,
  remotePath: string,
  localPath: string,
  totalBytes: number,
  task: FileTransferTask,
  control: FileTransferAbortControl
) => {
  await mkdir(getLocalDirname(localPath), { recursive: true })
  control.assertActive()

  let remoteHandle: SftpFileHandle | null = null
  const localFile = await openFile(localPath, 'w')
  let transferredBytes = 0
  let remoteClosed = false
  let localClosed = false
  const closeRemote = () => {
    if (!remoteHandle || remoteClosed) return
    remoteClosed = true
    sftp.close(remoteHandle, () => {})
  }
  const closeLocal = () => {
    if (localClosed) return
    localClosed = true
    void localFile.close().catch(() => {})
  }
  const cleanupCancel = control.onCancel(() => {
    closeRemote()
    closeLocal()
  })

  try {
    remoteHandle = await sftpOpenCancellable(sftp, remotePath, 'r', control)
    const buffer = Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE)
    for (;;) {
      control.assertActive()
      const bytesRead = await sftpReadChunkCancellable(sftp, remoteHandle, buffer, FILE_TRANSFER_CHUNK_SIZE, transferredBytes, control)
      if (bytesRead <= 0) break
      control.assertActive()
      await localFile.write(buffer, 0, bytesRead, transferredBytes)
      transferredBytes += bytesRead
      updateSingleFileTransferProgress(task, control, transferredBytes, totalBytes, '下载中')
    }
    control.assertActive()
    return transferredBytes
  } finally {
    const cancelled = control.cancelled
    cleanupCancel()
    if (!localClosed) {
      localClosed = true
      try {
        await localFile.close()
      } catch {}
    }
    if (remoteHandle && !remoteClosed) {
      remoteClosed = true
      try {
        await sftpCloseHandle(sftp, remoteHandle)
      } catch {}
    }
    if (cancelled) {
      try {
        await unlink(localPath)
      } catch {}
    }
  }
}

const uploadRemoteFileStreamViaSftp = async (
  sftp: SftpLowLevelWrapper,
  localPath: string,
  remotePath: string,
  totalBytes: number,
  task: FileTransferTask,
  control: FileTransferAbortControl
) => {
  let remoteHandle: SftpFileHandle | null = null
  const localFile = await openFile(localPath, 'r')
  let transferredBytes = 0
  let remoteClosed = false
  let localClosed = false
  const closeRemote = () => {
    if (!remoteHandle || remoteClosed) return
    remoteClosed = true
    sftp.close(remoteHandle, () => {})
  }
  const closeLocal = () => {
    if (localClosed) return
    localClosed = true
    void localFile.close().catch(() => {})
  }
  const cleanupCancel = control.onCancel(() => {
    closeRemote()
    closeLocal()
  })

  try {
    remoteHandle = await sftpOpenCancellable(sftp, remotePath, 'w', control)
    const buffer = Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE)
    for (;;) {
      control.assertActive()
      const { bytesRead } = await localFile.read(buffer, 0, FILE_TRANSFER_CHUNK_SIZE, transferredBytes)
      if (bytesRead <= 0) break
      control.assertActive()
      updateSingleFileTransferProgress(task, control, transferredBytes + bytesRead, totalBytes, '上传中')
      await sftpWriteChunkCancellable(sftp, remoteHandle, buffer, bytesRead, transferredBytes, control)
      transferredBytes += bytesRead
      updateSingleFileTransferProgress(task, control, transferredBytes, totalBytes, '上传中')
    }
    control.assertActive()
    return transferredBytes
  } finally {
    cleanupCancel()
    if (!localClosed) {
      localClosed = true
      try {
        await localFile.close()
      } catch {}
    }
    if (remoteHandle && !remoteClosed) {
      remoteClosed = true
      try {
        await sftpCloseHandle(sftp, remoteHandle)
      } catch {}
    }
  }
}

export const downloadRemoteFileViaSftp = async (remotePath: string, localPath: string, options: FileListOptions): Promise<FileTransferOperationResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const source = normalizeRemotePath(remotePath)
  const destination = String(localPath || '').trim()
  const mtimeMs = Date.now()
  let task: FileTransferTask | null = null
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const stats = await sftpStat(sftp, source)
      if (sftpEntryType(stats) !== 'file') return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
      const control = createFileTransferAbortControl()
      task = createRunningFileTransferTask({
        type: 'download',
        name: remoteBasename(source),
        source,
        target: destination,
        fromHost: transferFromHost(options),
        ...(options.toHost ? { toHost: options.toHost } : {})
      })
      registerActiveFileTransferTask(task, control)
      control.assertActive()
      const totalBytes = transferByteCount((stats as { size?: unknown }).size)
      let bytes = 0
      if (isSftpLowLevelWrapper(sftp)) {
        bytes = await downloadRemoteFileStreamViaSftp(sftp, source, destination, totalBytes, task, control)
      } else {
        const content = await sftpReadFile(sftp, source)
        control.assertActive()
        task.progress = 90
        task.speed = '写入中'
        updateActiveFileTransferTask(task, control)
        await mkdir(getLocalDirname(destination), { recursive: true })
        control.assertActive()
        await writeFile(destination, content)
        bytes = content.length
      }
      control.assertActive()
      return {
        ok: true,
        data: { status: 'success', source, target: destination, bytes, files: 1, mtimeMs, itemKind: 'file', task: completeRunningFileTransferTask(task, 1) }
      }
    })
  } catch (error) {
    if (task && isFileTransferCancelledError(error)) {
      return fileTransferCancelledResult(source, destination, 0, 1, mtimeMs, 'file', cancelRunningFileTransferTask(task))
    }
    if (task) finishActiveFileTransferTask(task)
    return fileError(error, 'transfer_failed')
  }
}

export const copyRemoteTransferViaSftp = async (
  remotePath: string,
  targetPath: string,
  overwrite: boolean | undefined,
  options: FileListOptions
): Promise<FileTransferOperationResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const source = normalizeRemotePath(remotePath)
  const destination = normalizeRemotePath(targetPath)
  const mtimeMs = Date.now()
  try {
    return await withRemoteSftp(target, async (sftp) => {
      if (source !== destination) {
        const existingTarget = await sftpStatOrNull(sftp, destination)
        if (existingTarget) {
          if (!overwrite) return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
          await removeRemotePathViaSftp(sftp, destination, true)
        }
        await ensureRemoteParentDirs(sftp, remoteDirname(destination))
      }
      const stats = await collectRemoteCopyStatsViaSftp(sftp, source, destination, options)
      if (source !== destination) await copyRemotePathViaSftp(sftp, source, destination)
      const task = createRemoteCopyTransferTask(source, destination, stats, options)
      return {
        ok: true,
        data: {
          status: 'success',
          source,
          target: destination,
          bytes: stats.bytes,
          files: remoteCopyResultFileCount(stats),
          mtimeMs,
          itemKind: stats.itemKind,
          task
        }
      }
    })
  } catch (error) {
    return fileError(error, 'transfer_failed')
  }
}

const remoteDirectoryDownloadName = (path: string) => {
  const normalized = normalizeRemotePath(path)
  return normalized === '/' ? 'root' : remoteBasename(normalized)
}

export const downloadRemoteDirectoryViaSftp = async (
  remotePath: string,
  localDirectory: string,
  options: FileListOptions
): Promise<FileTransferOperationResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const source = normalizeRemotePath(remotePath)
  const destination = join(String(localDirectory || '').trim(), remoteDirectoryDownloadName(source))
  const mtimeMs = Date.now()
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const stats = await sftpStat(sftp, source)
      if (sftpEntryType(stats) !== 'directory') return { ok: false, errorCode: 'not_directory', errorMessage: 'Source must be a directory' }
      let bytes = 0
      let fileCount = 0
      const control = createFileTransferAbortControl()
      const task = createBackendFileTransferTask({
        type: 'download',
        name: remoteDirectoryDownloadName(source),
        source,
        target: destination,
        progress: 0,
        speed: 'pending',
        status: 'running',
        fromHost: transferFromHost(options),
        ...(options.toHost ? { toHost: options.toHost } : {}),
        stage: 'scanning',
        isGroup: true,
        totalFiles: 0,
        finishedFiles: 0
      })
      registerActiveFileTransferTask(task, control)
      const downloadDirectory = async (remoteDir: string, localDir: string) => {
        control.assertActive()
        await mkdir(localDir, { recursive: true })
        control.assertActive()
        const rows = (await sftpReaddir(sftp, remoteDir))
          .filter((row) => row.filename !== '.' && row.filename !== '..')
          .sort((left, right) => left.filename.localeCompare(right.filename))
        for (const row of rows) {
          control.assertActive()
          const remoteChild = normalizeRemotePath(`${remoteDir}/${row.filename}`)
          const localChild = join(localDir, row.filename)
          if (sftpEntryType(row.attrs as Partial<SftpStats>) === 'directory') {
            await downloadDirectory(remoteChild, localChild)
            continue
          }
          const child = createBackendFileTransferTask({
            type: 'download',
            name: row.filename,
            source: remoteChild,
            target: localChild,
            progress: 0,
            speed: 'pending',
            status: 'running',
            fromHost: transferFromHost(options),
            ...(options.toHost ? { toHost: options.toHost } : {}),
            stage: 'pending'
          })
          addActiveFileTransferChild(task, child, control)
          const content = await sftpReadFile(sftp, remoteChild)
          control.assertActive()
          await mkdir(getLocalDirname(localChild), { recursive: true })
          control.assertActive()
          await writeFile(localChild, content)
          control.assertActive()
          bytes += content.length
          fileCount += 1
          child.progress = 100
          child.speed = '完成'
          child.status = 'success'
          task.finishedFiles = fileCount
          updateRunningFileTransferProgress(task, control)
        }
      }
      try {
        await downloadDirectory(source, destination)
      } catch (error) {
        if (isFileTransferCancelledError(error)) {
          return fileTransferCancelledResult(source, destination, bytes, fileCount, mtimeMs, 'directory', cancelRunningFileTransferTask(task))
        }
        finishActiveFileTransferTask(task)
        throw error
      }
      return {
        ok: true,
        data: {
          status: 'success',
          source,
          target: destination,
          bytes,
          files: Math.max(fileCount, 1),
          mtimeMs,
          itemKind: 'directory',
          task: completeRunningFileTransferTask(task, fileCount)
        }
      }
    })
  } catch (error) {
    return fileError(error, 'transfer_failed')
  }
}

export const uploadRemoteFileViaSftp = async (
  localPath: string,
  remoteDirectory: string,
  name: string,
  options: FileListOptions
): Promise<FileTransferOperationResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const source = String(localPath || '').trim()
  const destination = normalizeRemotePath(`${remoteDirectory}/${name}`)
  const mtimeMs = Date.now()
  let task: FileTransferTask | null = null
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const control = createFileTransferAbortControl()
      task = createRunningFileTransferTask({
        type: 'upload',
        name,
        source,
        target: destination,
        ...(options.fromHost ? { fromHost: options.fromHost } : {}),
        toHost: transferToHost(options)
      })
      registerActiveFileTransferTask(task, control)
      control.assertActive()
      const localStats = await stat(source)
      if (!localStats.isFile()) return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
      control.assertActive()
      await ensureRemoteParentDirs(sftp, remoteDirname(destination))
      control.assertActive()
      let bytes = 0
      if (isSftpLowLevelWrapper(sftp)) {
        bytes = await uploadRemoteFileStreamViaSftp(sftp, source, destination, transferByteCount(localStats.size), task, control)
      } else {
        const content = await readFile(source)
        control.assertActive()
        task.progress = 50
        task.speed = '上传中'
        updateActiveFileTransferTask(task, control)
        await sftpWriteFile(sftp, destination, content)
        bytes = content.length
      }
      control.assertActive()
      return {
        ok: true,
        data: { status: 'success', source, target: destination, bytes, files: 1, mtimeMs, itemKind: 'file', task: completeRunningFileTransferTask(task, 1) }
      }
    })
  } catch (error) {
    if (task && isFileTransferCancelledError(error)) {
      return fileTransferCancelledResult(source, destination, 0, 1, mtimeMs, 'file', cancelRunningFileTransferTask(task))
    }
    if (task) finishActiveFileTransferTask(task)
    return fileError(error, 'transfer_failed')
  }
}

const ensureRemoteDirectoryViaSftp = async (sftp: SFTPWrapper, path: string) => {
  const normalized = normalizeRemotePath(path)
  await ensureRemoteParentDirs(sftp, remoteDirname(normalized))
  await sftpMkdir(sftp, normalized).catch(async (error) => {
    const existing = await sftpStatOrNull(sftp, normalized)
    if (existing && sftpEntryType(existing) === 'directory') return
    throw error
  })
}

export const uploadRemoteDirectoryViaSftp = async (
  localPath: string,
  remoteDirectory: string,
  name: string,
  options: FileListOptions
): Promise<FileTransferOperationResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const source = String(localPath || '').trim()
  const destination = normalizeRemotePath(`${remoteDirectory}/${name}`)
  const mtimeMs = Date.now()
  try {
    return await withRemoteSftp(target, async (sftp) => {
      let bytes = 0
      let fileCount = 0
      const control = createFileTransferAbortControl()
      const task = createBackendFileTransferTask({
        type: 'upload',
        name,
        source,
        target: destination,
        progress: 0,
        speed: 'pending',
        status: 'running',
        ...(options.fromHost ? { fromHost: options.fromHost } : {}),
        toHost: transferToHost(options),
        stage: 'scanning',
        isGroup: true,
        totalFiles: 0,
        finishedFiles: 0
      })
      registerActiveFileTransferTask(task, control)
      const uploadDirectory = async (localDir: string, remoteDir: string) => {
        control.assertActive()
        await ensureRemoteDirectoryViaSftp(sftp, remoteDir)
        control.assertActive()
        const rows = (await readdir(localDir, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
        for (const row of rows) {
          control.assertActive()
          const localChild = join(localDir, row.name)
          const remoteChild = normalizeRemotePath(`${remoteDir}/${row.name}`)
          if (row.isDirectory()) {
            await uploadDirectory(localChild, remoteChild)
            continue
          }
          if (!row.isFile()) continue
          const child = createBackendFileTransferTask({
            type: 'upload',
            name: row.name,
            source: localChild,
            target: remoteChild,
            progress: 0,
            speed: 'pending',
            status: 'running',
            ...(options.fromHost ? { fromHost: options.fromHost } : {}),
            toHost: transferToHost(options),
            stage: 'pending'
          })
          addActiveFileTransferChild(task, child, control)
          const content = await readFile(localChild)
          control.assertActive()
          await sftpWriteFile(sftp, remoteChild, content)
          control.assertActive()
          bytes += content.length
          fileCount += 1
          child.progress = 100
          child.speed = '完成'
          child.status = 'success'
          task.finishedFiles = fileCount
          updateRunningFileTransferProgress(task, control)
        }
      }
      try {
        await uploadDirectory(source, destination)
      } catch (error) {
        if (isFileTransferCancelledError(error)) {
          return fileTransferCancelledResult(source, destination, bytes, fileCount, mtimeMs, 'directory', cancelRunningFileTransferTask(task))
        }
        finishActiveFileTransferTask(task)
        throw error
      }
      return {
        ok: true,
        data: {
          status: 'success',
          source,
          target: destination,
          bytes,
          files: Math.max(fileCount, 1),
          mtimeMs,
          itemKind: 'directory',
          task: completeRunningFileTransferTask(task, fileCount)
        }
      }
    })
  } catch (error) {
    return fileError(error, 'transfer_failed')
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
