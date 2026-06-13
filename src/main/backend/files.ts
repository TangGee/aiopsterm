import { createHash, randomUUID } from 'crypto'
import { app } from 'electron'
import Store from 'electron-store'
import { basename as getLocalBasename, dirname as getLocalDirname, isAbsolute, join, resolve } from 'path'
import { chmod, cp, mkdir, open as openFile, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import type {
  FileSessionCatalog,
  FileSessionCatalogResult,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionMutationResult,
  FileSessionPatch,
  FileSessionSftpPayload,
  FileSessionTerminalContext,
  AiopsAssetInput,
  FileContentOptions,
  FileEntryMutation,
  FileEntryMutationResult,
  FileListEntry,
  FileListOptions,
  FileReadContentResult,
  FileTransferTask,
  FileTransferTaskCancelInput,
  FileTransferTaskCancelResult,
  FileTransferOperation,
  FileTransferOperationResult,
  FileWriteContentResult,
  UserConfig
} from '@shared/preload'
import { shouldUseFilesSeedData } from '@shared/runtimeSwitches'
import type { ConnectConfig, FileEntry as SftpFileEntry, SFTPWrapper, Stats as SftpStats } from 'ssh2'
import { deleteAssetFolder, getAsset, getAssetSecret, getKeychainSecret, listAssets, saveAsset, saveAssetFolder } from './assets'
import { loadSsh2 } from './ssh2Runtime'
import { createConfiguredSshAgentAuth } from './sshAgent'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'

type BackendFileEntry = FileListEntry & { mode: string }
type FileSessionCatalogStoreShape = FileSessionCatalog
type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
}
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

type FilesBackendRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  databasePath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sqliteFactory?: new (path: string) => SqliteDatabase
  sftpPoolIdleTtlMs?: number
}

const defaultFileSessionSeedMode = shouldUseFilesSeedData

const defaultFileSessionDatabasePath = () => {
  const envPath = String(process.env.AIOPSTERM_FILES_DB_PATH || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-state.db')
}

type FilesBackendRuntimeState = Required<Pick<FilesBackendRuntimeConfig, 'databasePath' | 'useSeedData' | 'forceFallbackStore'>> & {
  getConfig?: FilesBackendRuntimeConfig['getConfig']
  sqliteFactory?: new (path: string) => SqliteDatabase
  sftpPoolIdleTtlMs: number
}

let filesRuntimeConfig: FilesBackendRuntimeState = {
  databasePath: defaultFileSessionDatabasePath(),
  useSeedData: defaultFileSessionSeedMode(),
  forceFallbackStore: false,
  sftpPoolIdleTtlMs: 30_000
}

export const configureFilesBackendRuntime = (config: FilesBackendRuntimeConfig = {}) => {
  clearRemoteSftpPool()
  filesRuntimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultFileSessionDatabasePath(),
    useSeedData: config.useSeedData ?? defaultFileSessionSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore),
    sftpPoolIdleTtlMs: Math.max(0, Number(config.sftpPoolIdleTtlMs ?? 30_000) || 0),
    ...(config.getConfig ? { getConfig: config.getConfig } : {}),
    ...(config.sqliteFactory ? { sqliteFactory: config.sqliteFactory } : {})
  }
  fileSessionCatalog = null
  fileSessionCatalogStore = null
}

const getSshProxyConfigs = () => filesRuntimeConfig.getConfig?.().sshProxyConfigs || []
const getSshAgentRuntimeConfig = () => {
  const config = filesRuntimeConfig.getConfig?.()
  return {
    terminal: config?.terminal,
    sshAgentKeys: config?.sshAgentKeys
  }
}

const seedTime = new Date('2026-06-04T05:10:00.000Z').getTime()

const normalizeRemotePath = (path: string) => {
  const normalized = String(path || '/').trim().replace(/\/+/g, '/')
  return normalized || '/'
}

const dirname = (path: string) => {
  const normalized = normalizeRemotePath(path)
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

const basename = (path: string) => normalizeRemotePath(path).split('/').filter(Boolean).at(-1) || path

const entry = (name: string, path: string, type: FileListEntry['type'], size = 0, mode?: string, modifiedAt = seedTime): BackendFileEntry => ({
  name,
  path,
  type,
  size,
  modifiedAt,
  mode: mode || (type === 'directory' ? 'drwxr-xr-x' : type === 'link' ? 'lrwxrwxrwx' : '-rw-r--r--')
})

const modeString = (type: FileListEntry['type'], mode: number) => {
  const prefix = type === 'directory' ? 'd' : type === 'link' ? 'l' : '-'
  return `${prefix}${(mode & 0o777).toString(8).padStart(3, '0')}`
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

const resolveRemoteSftpTarget = (options: FileListOptions): RemoteSftpTarget | null => {
  if (options.kind !== 'remote') return null
  const asset = assetIdCandidates(options.sessionId)
    .map((id) => getAsset(id))
    .find((item) => item && !item.isLocalShell)
  if (!asset) return null

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
const sftpUnavailableMessage = 'SFTP connection is unavailable for this file session.'
const sftpUnavailableError = (errorCode = 'FILES_SFTP_UNAVAILABLE') => ({
  ok: false as const,
  errorCode,
  errorMessage: sftpUnavailableMessage
})

const isNotFoundError = (error: unknown) => {
  const code = (error as { code?: unknown } | undefined)?.code
  const message = sftpErrorMessage(error).toLowerCase()
  return code === 'ENOENT' || code === 2 || message.includes('no such file') || message.includes('not found')
}

const fileError = (error: unknown, errorCode: string) => {
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
  const ttl = filesRuntimeConfig.sftpPoolIdleTtlMs
  if (connection.closeTimer) clearTimeout(connection.closeTimer)
  if (ttl <= 0) {
    closeRemoteSftpConnection(connection)
    return
  }
  connection.closeTimer = setTimeout(() => {
    if (connection.refCount <= 0) closeRemoteSftpConnection(connection)
  }, ttl)
}

const clearRemoteSftpPool = () => {
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
    readyTimeout: 15000,
    keepaliveInterval: 10000
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
    await ensureRemoteParentDirs(sftp, dirname(targetPath))
    await sftpWriteFile(sftp, targetPath, await sftpReadFile(sftp, sourcePath))
    return
  }
  await ensureRemoteParentDirs(sftp, dirname(targetPath))
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

const listRemoteFilesViaSftp = async (directory: string, options: FileListOptions): Promise<FileListEntry[] | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const path = normalizeRemotePath(directory)
  return withRemoteSftp(target, async (sftp) => {
    const readablePath = path === '/' || (await remotePathExistsAsDirectory(sftp, path)) ? path : '/'
    const rows = (await sftpReaddir(sftp, readablePath))
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .slice(0, 500)
      .map((item) => sftpEntryToFileListEntry(readablePath, item))
    const parent = readablePath === '/' ? [] : [entry('..', dirname(readablePath), 'directory', 0, 'drwxr-xr-x', seedTime)]
    return [...parent, ...sortEntries(rows)]
  })
}

const readRemoteFileViaSftp = async (filePath: string, options: FileContentOptions): Promise<FileReadContentResult | null> => {
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

const writeRemoteFileViaSftp = async (filePath: string, content: Buffer, options: FileContentOptions): Promise<FileWriteContentResult | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const path = normalizeRemotePath(filePath)
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const conflict = await validateRemoteFileContentVersion(sftp, path, options)
      if (conflict) return conflict
      await ensureRemoteParentDirs(sftp, dirname(path))
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

const mutateRemoteFileEntryViaSftp = async (mutation: FileEntryMutation, options: FileListOptions): Promise<FileEntryMutationResult | null> => {
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
        await ensureRemoteParentDirs(sftp, dirname(newPath))
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
        await ensureRemoteParentDirs(sftp, dirname(targetPath))
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

const defaultFileSessionFolders: FileSessionFolderRecord[] = [
  {
    uuid: 'files-folder-a',
    name: '核心业务',
    description: '常用远程文件资产'
  },
  {
    uuid: 'files-folder-b',
    name: '临时排障',
    description: '短期调试入口'
  }
]

const defaultFileSessions: FileSessionInfo[] = [
  {
    id: 'local',
    label: 'Local',
    host: '127.0.0.1',
    group: '本地连接',
    kind: 'local',
    rootPath: '/',
    status: 'active',
    assetType: 'local'
  },
  {
    id: 'asset-1',
    label: 'prod-bastion',
    host: '10.24.8.12',
    group: '最近连接',
    kind: 'remote',
    rootPath: '/home/deploy',
    status: 'active',
    favorite: false,
    assetType: 'person',
    comment: '生产入口'
  },
  {
    id: 'folder_asset-2',
    label: 'staging-files',
    host: '10.24.9.20',
    group: '主机',
    kind: 'remote',
    rootPath: '/home/staging',
    status: 'idle',
    favorite: false,
    assetType: 'person',
    folderUuid: 'files-folder-a',
    comment: '预发文件'
  }
]

const fileSessionSeedCatalog = (): FileSessionCatalog => ({
  sessions: defaultFileSessions.map((session) => ({ ...session })),
  folders: defaultFileSessionFolders.map((folder) => ({ ...folder }))
})

const fileSessionSeedlessCatalog = (): FileSessionCatalog => ({
  sessions: [{ ...defaultFileSessions[0] }],
  folders: []
})

const defaultFileSessionCatalog = (): FileSessionCatalog =>
  filesRuntimeConfig.useSeedData ? fileSessionSeedCatalog() : fileSessionSeedlessCatalog()

let fileSessionCatalog: FileSessionCatalog | null = null

const cloneSession = (session: FileSessionInfo): FileSessionInfo => ({ ...session })
const cloneFolder = (folder: FileSessionFolderRecord): FileSessionFolderRecord => ({ ...folder })
const cloneFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => ({
  sessions: catalog.sessions.map(cloneSession),
  folders: catalog.folders.map(cloneFolder)
})

const fileSessionLocalEntry = () => cloneSession(defaultFileSessions[0])
const rootPathForAssetUsername = (username: string, fallback = '/') => {
  const name = textSecret(username)
  if (!name || name === 'local') return fallback
  if (name === 'root') return '/root'
  return `/home/${name}`
}
const seedFileSessionForField = (session?: FileSessionInfo) => (session?.id ? seedFileSessionById.get(session.id) : undefined)
const isUserChangedFileSessionField = <K extends keyof FileSessionInfo>(session: FileSessionInfo | undefined, field: K) => {
  if (!session) return false
  const seed = seedFileSessionForField(session)
  return !seed || stableJson(session[field]) !== stableJson(seed[field])
}

const assetToFileSession = (asset: ReturnType<typeof listAssets>['assets'][number], existing?: FileSessionInfo): FileSessionInfo | null => {
  if (asset.isLocalShell) return null
  const host = textSecret(asset.host || asset.ip)
  const username = textSecret(asset.username)
  if (!asset.id || !host) return null
  const isOrganization = asset.asset_type === 'organization'
  return {
    id: asset.id,
    label: asset.title || asset.name || host,
    host,
    ...(username ? { username } : {}),
    group: isUserChangedFileSessionField(existing, 'group') && existing?.group ? existing.group : asset.group_name || asset.group || (isOrganization ? '堡垒机资源' : '主机'),
    kind: 'remote',
    rootPath: isUserChangedFileSessionField(existing, 'rootPath') && existing?.rootPath ? existing.rootPath : rootPathForAssetUsername(username),
    status: isUserChangedFileSessionField(existing, 'status') && existing?.status ? existing.status : asset.status === 'offline' ? 'idle' : 'active',
    favorite: isUserChangedFileSessionField(existing, 'favorite') && typeof existing?.favorite === 'boolean' ? existing.favorite : Boolean(asset.favorite),
    assetType: isOrganization ? 'organization' : 'person',
    ...(asset.folderUuid ? { folderUuid: asset.folderUuid } : {}),
    ...(isUserChangedFileSessionField(existing, 'comment') && existing?.comment ? { comment: existing.comment } : asset.comment ? { comment: asset.comment } : {})
  }
}

const assetFoldersToFileFolders = (folders: ReturnType<typeof listAssets>['folders']): FileSessionFolderRecord[] =>
  folders.map((folder) => ({ ...folder }))

const findAssetFolder = (uuid: string) => listAssets().folders.find((folder) => folder.uuid === uuid)

const assetInputFromRecord = (asset: ReturnType<typeof listAssets>['assets'][number]): AiopsAssetInput => ({
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
  tags: asset.tags,
  favorite: asset.favorite,
  ...(asset.folderUuid ? { folderUuid: asset.folderUuid } : {}),
  ...(asset.organizationId ? { organizationId: asset.organizationId } : {}),
  ...(asset.tunnelState ? { tunnelState: asset.tunnelState } : {}),
  ...(typeof asset.needProxy === 'boolean' ? { needProxy: asset.needProxy } : {}),
  ...(asset.proxyName ? { proxyName: asset.proxyName } : {}),
  ...(asset.keychainId ? { keychainId: asset.keychainId } : {}),
  ...(asset.jumpHostId ? { jumpHostId: asset.jumpHostId } : {})
})

const syncAssetFromFileSessionPatch = (id: string, patch: FileSessionPatch) => {
  const asset = getAsset(id)
  if (!asset || asset.isLocalShell) return null
  const input = assetInputFromRecord(asset)
  if (Object.prototype.hasOwnProperty.call(patch, 'favorite')) input.favorite = patch.favorite
  if (Object.prototype.hasOwnProperty.call(patch, 'comment')) input.comment = patch.comment || ''
  if (Object.prototype.hasOwnProperty.call(patch, 'folderUuid')) {
    delete input.folderUuid
    const folderUuid = String(patch.folderUuid || '').trim()
    if (folderUuid) input.folderUuid = folderUuid
  }
  const result = saveAsset(input)
  if (!result.ok) {
    return {
      ok: false as const,
      errorCode: result.errorCode || 'FILES_ASSET_SYNC_FAILED',
      errorMessage: result.errorMessage || 'Asset sync failed.'
    }
  }
  return { ok: true as const }
}

const mergeAssetCatalogIntoFileSessions = (catalog: FileSessionCatalog): FileSessionCatalog => {
  const assetSnapshot = listAssets()
  const byId = new Map(catalog.sessions.map((session) => [session.id, session]))
  const local = normalizeSession(byId.get('local') || fileSessionLocalEntry()) || fileSessionLocalEntry()
  const assetSessions = assetSnapshot.assets
    .map((asset) => assetToFileSession(asset, byId.get(asset.id)))
    .filter((session): session is FileSessionInfo => Boolean(session))
  const assetIds = new Set(assetSnapshot.assets.map((asset) => asset.id))
  const customSessions = catalog.sessions.filter((session) => session.id !== 'local' && !assetIds.has(session.id) && !isUnmodifiedSeedFileSession(session))
  const assetFolders = assetFoldersToFileFolders(assetSnapshot.folders)
  const assetFolderIds = new Set(assetFolders.map((folder) => folder.uuid))
  const customFolders = catalog.folders.filter((folder) => !assetFolderIds.has(folder.uuid) && !isUnmodifiedSeedFileSessionFolder(folder))
  return normalizeFileSessionCatalog({
    sessions: [local, ...assetSessions, ...customSessions],
    folders: [...assetFolders, ...customFolders]
  })
}

const stableJson = (value: unknown) => JSON.stringify(value)

const seedFileSessionById = new Map(fileSessionSeedCatalog().sessions.filter((session) => session.id !== 'local').map((session) => [session.id, session]))
const seedFileSessionFolderByUuid = new Map(fileSessionSeedCatalog().folders.map((folder) => [folder.uuid, folder]))

const isUnmodifiedSeedFileSession = (session: FileSessionInfo) => {
  const seed = seedFileSessionById.get(session.id)
  return Boolean(seed && stableJson(session) === stableJson(seed))
}

const isUnmodifiedSeedFileSessionFolder = (folder: FileSessionFolderRecord) => {
  const seed = seedFileSessionFolderByUuid.get(folder.uuid)
  return Boolean(seed && stableJson(folder) === stableJson(seed))
}

const stripLegacySeedFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => {
  const sessions = catalog.sessions.filter((session) => !isUnmodifiedSeedFileSession(session))
  const referencedFolders = new Set(sessions.map((session) => session.folderUuid).filter((uuid): uuid is string => Boolean(uuid)))
  const folders = catalog.folders.filter((folder) => !isUnmodifiedSeedFileSessionFolder(folder) || referencedFolders.has(folder.uuid))
  return { sessions, folders }
}

const fileSessionResult = <T>(data: T) => ({ ok: true, data })

const cloneFileTransferTask = (task: FileTransferTask): FileTransferTask => ({
  ...task,
  ...(task.children ? { children: task.children.map(cloneFileTransferTask) } : {})
})

const activeFileTransferTasks = new Map<string, FileTransferTask>()

type FileTransferAbortControl = {
  cancelled: boolean
  onCancel: (handler: () => void) => () => void
  cancel: () => void
  assertActive: () => void
}

const activeFileTransferControls = new Map<string, FileTransferAbortControl>()

const transferCancelledError = () => Object.assign(new Error('File transfer cancelled'), { code: 'FILES_TRANSFER_CANCELLED' })

const isFileTransferCancelledError = (error: unknown) =>
  (error as { code?: unknown } | undefined)?.code === 'FILES_TRANSFER_CANCELLED' ||
  (error as { __cancelled?: unknown } | undefined)?.__cancelled === true

const createFileTransferAbortControl = (): FileTransferAbortControl => {
  const cancelHandlers = new Set<() => void>()
  const control: FileTransferAbortControl = {
    cancelled: false,
    onCancel: (handler) => {
      if (control.cancelled) {
        handler()
        return () => {}
      }
      cancelHandlers.add(handler)
      return () => {
        cancelHandlers.delete(handler)
      }
    },
    cancel: () => {
      if (control.cancelled) return
      control.cancelled = true
      cancelHandlers.forEach((handler) => {
        try {
          handler()
        } catch {}
      })
      cancelHandlers.clear()
    },
    assertActive: () => {
      if (control.cancelled) throw transferCancelledError()
    }
  }
  return control
}

const normalizeTransferStatus = (status: unknown): FileTransferTask['status'] => {
  if (status === 'running' || status === 'failed' || status === 'error' || status === 'success') return status
  return 'success'
}

const normalizeTransferProgress = (progress: unknown, status: FileTransferTask['status']) => {
  if (typeof progress === 'number' && Number.isFinite(progress)) return Math.max(0, Math.min(100, Math.round(progress)))
  return status === 'success' ? 100 : 0
}

type BackendFileTransferTaskPayload = {
  type: FileTransferTask['type']
  name: string
  source: string
  target: string
  progress?: number
  speed?: string
  status?: FileTransferTask['status']
  stage?: FileTransferTask['stage']
  isGroup?: boolean
  fromHost?: string
  toHost?: string
  totalFiles?: number
  finishedFiles?: number
  children?: BackendFileTransferTaskPayload[]
}

const createBackendFileTransferTask = (input: BackendFileTransferTaskPayload): FileTransferTask => {
  const type = input.type === 'download' || input.type === 'upload' || input.type === 'r2r' ? input.type : 'r2r'
  const name = String(input.name || '').trim()
  const source = String(input.source || '').trim()
  const target = String(input.target || '').trim()
  if (!name || !source || !target) throw new Error('File transfer task name, source, and target are required.')
  const status = normalizeTransferStatus(input.status)
  return {
    id: `transfer-${randomUUID()}`,
    type,
    name,
    source,
    target,
    progress: normalizeTransferProgress(input.progress, status),
    speed: String(input.speed || (status === 'success' ? '完成' : 'pending')),
    status,
    ...(input.stage === 'scanning' || input.stage === 'pending' ? { stage: input.stage } : {}),
    ...(input.isGroup ? { isGroup: true } : {}),
    ...(input.fromHost ? { fromHost: String(input.fromHost) } : {}),
    ...(input.toHost ? { toHost: String(input.toHost) } : {}),
    ...(typeof input.totalFiles === 'number' && Number.isFinite(input.totalFiles) ? { totalFiles: Math.max(0, Math.round(input.totalFiles)) } : {}),
    ...(typeof input.finishedFiles === 'number' && Number.isFinite(input.finishedFiles)
      ? { finishedFiles: Math.max(0, Math.round(input.finishedFiles)) }
      : {}),
    ...(input.children?.length ? { children: input.children.map((child) => createBackendFileTransferTask(child)) } : {})
  }
}

const transferFromHost = (options: FileListOptions) => options.fromHost || options.host
const transferToHost = (options: FileListOptions) => options.toHost || options.host

const fileTransferTaskIds = (task: FileTransferTask) => [task.id, ...(task.children || []).map((child) => child.id)]

const registerFileTransferTaskControl = (task: FileTransferTask, control: FileTransferAbortControl) => {
  fileTransferTaskIds(task).forEach((taskId) => activeFileTransferControls.set(taskId, control))
}

const registerActiveFileTransferTask = (task: FileTransferTask, control?: FileTransferAbortControl) => {
  if (task.status !== 'running') return
  activeFileTransferTasks.set(task.id, cloneFileTransferTask(task))
  if (control) registerFileTransferTaskControl(task, control)
}

const updateActiveFileTransferTask = (task: FileTransferTask, control?: FileTransferAbortControl) => {
  if (task.status !== 'running' || !activeFileTransferTasks.has(task.id)) return
  activeFileTransferTasks.set(task.id, cloneFileTransferTask(task))
  if (control) registerFileTransferTaskControl(task, control)
}

const deleteActiveFileTransferTaskIds = (taskIds: Iterable<string>) => {
  for (const taskId of taskIds) {
    activeFileTransferTasks.delete(taskId)
    activeFileTransferControls.delete(taskId)
  }
}

const finishActiveFileTransferTask = (task: FileTransferTask) => {
  deleteActiveFileTransferTaskIds(fileTransferTaskIds(task))
}

const addActiveFileTransferChild = (task: FileTransferTask, child: FileTransferTask, control: FileTransferAbortControl) => {
  task.children = [...(task.children || []), child]
  task.totalFiles = task.children.length
  registerFileTransferTaskControl(task, control)
  updateActiveFileTransferTask(task, control)
}

const updateRunningFileTransferProgress = (task: FileTransferTask, control: FileTransferAbortControl) => {
  const totalFiles = task.totalFiles || task.children?.length || 0
  const finishedFiles = task.finishedFiles || 0
  task.progress = totalFiles > 0 ? Math.max(0, Math.min(99, Math.round((finishedFiles / totalFiles) * 100))) : 0
  updateActiveFileTransferTask(task, control)
}

const completeRunningFileTransferTask = (task: FileTransferTask, fileCount: number) => {
  task.status = 'success'
  task.progress = 100
  task.speed = '完成'
  task.totalFiles = fileCount
  task.finishedFiles = fileCount
  task.children?.forEach((child) => {
    child.status = 'success'
    child.progress = 100
    child.speed = '完成'
  })
  finishActiveFileTransferTask(task)
  return cloneFileTransferTask(task)
}

const cancelRunningFileTransferTask = (task: FileTransferTask) => {
  task.status = 'failed'
  task.speed = '已取消'
  task.progress = Math.min(task.progress, 99)
  task.children?.forEach((child) => {
    if (child.status === 'success') return
    child.status = 'failed'
    child.speed = '已取消'
    child.progress = Math.min(child.progress, 99)
  })
  finishActiveFileTransferTask(task)
  return cloneFileTransferTask(task)
}

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

const createCompletedBackendFileTransferTask = (input: BackendFileTransferTaskPayload) =>
  cloneFileTransferTask(createBackendFileTransferTask({ progress: 100, status: 'success', speed: '完成', ...input }))

const createRunningFileTransferTask = (input: BackendFileTransferTaskPayload) =>
  createBackendFileTransferTask({
    progress: 0,
    status: 'running',
    speed: 'pending',
    stage: 'pending',
    ...input
  })

const FILE_TRANSFER_CHUNK_SIZE = 64 * 1024

const transferByteCount = (value: unknown) => {
  const bytes = Number(value)
  return Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0
}

const formatTransferBytes = (bytes: number) => {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

const updateSingleFileTransferProgress = (
  task: FileTransferTask,
  control: FileTransferAbortControl,
  transferredBytes: number,
  totalBytes: number,
  stageText: string
) => {
  task.progress = totalBytes > 0 ? Math.max(1, Math.min(99, Math.round((transferredBytes / totalBytes) * 100))) : 0
  task.speed = totalBytes > 0 ? `${stageText} ${formatTransferBytes(transferredBytes)} / ${formatTransferBytes(totalBytes)}` : `${stageText} ${formatTransferBytes(transferredBytes)}`
  updateActiveFileTransferTask(task, control)
}

const fileTransferTaskHosts = (options: FileListOptions) => ({
  ...(transferFromHost(options) ? { fromHost: transferFromHost(options) } : {}),
  ...(transferToHost(options) ? { toHost: transferToHost(options) } : {})
})

type RemoteCopyTransferStats = {
  bytes: number
  fileCount: number
  itemKind: 'file' | 'directory'
  children: BackendFileTransferTaskPayload[]
}

const remoteCopyResultFileCount = (stats: RemoteCopyTransferStats) => (stats.itemKind === 'directory' ? Math.max(stats.fileCount, 1) : 1)

const remoteCopyChildTask = (name: string, source: string, target: string, options: FileListOptions): BackendFileTransferTaskPayload => ({
  type: 'r2r',
  name,
  source,
  target,
  progress: 100,
  speed: '完成',
  status: 'success',
  stage: 'pending',
  ...fileTransferTaskHosts(options)
})

const createRemoteCopyTransferTask = (source: string, target: string, stats: RemoteCopyTransferStats, options: FileListOptions) =>
  createBackendFileTransferTask({
    type: 'r2r',
    name: basename(source),
    source,
    target,
    progress: 100,
    speed: '完成',
    status: 'success',
    ...fileTransferTaskHosts(options),
    ...(stats.itemKind === 'directory'
      ? {
          stage: 'scanning' as const,
          isGroup: true,
          totalFiles: stats.fileCount,
          finishedFiles: stats.fileCount,
          ...(stats.children.length ? { children: stats.children } : {})
        }
      : {})
  })

const taskBasename = (path: string, options: FileListOptions) => (options.kind === 'remote' ? basename(path) : getLocalBasename(path))
const taskDirname = (path: string, options: FileListOptions) => (options.kind === 'remote' ? dirname(path) : getLocalDirname(path))

const writeContentTask = (path: string, options: FileContentOptions) =>
  createCompletedBackendFileTransferTask({
    type: 'r2r',
    name: `save ${taskBasename(path, options)}`,
    source: path,
    target: path,
    speed: '已保存',
    ...fileTransferTaskHosts(options)
  })

const mutationTask = (mutation: FileEntryMutation, resultPath: string, options: FileListOptions): FileTransferTask | undefined => {
  if (mutation.kind === 'rename') return undefined
  if (mutation.kind === 'chmod') {
    return createCompletedBackendFileTransferTask({
      type: 'r2r',
      name: `chmod ${taskBasename(resultPath, options)}`,
      source: resultPath,
      target: mutation.recursive ? 'recursive permissions' : 'permissions',
      ...fileTransferTaskHosts(options)
    })
  }
  if (mutation.kind === 'delete') {
    return createCompletedBackendFileTransferTask({
      type: 'r2r',
      name: `delete ${taskBasename(resultPath, options)}`,
      source: resultPath,
      target: taskDirname(resultPath, options),
      ...fileTransferTaskHosts(options)
    })
  }
  const source = mutation.srcPath
  return createCompletedBackendFileTransferTask({
    type: 'r2r',
    name: taskBasename(resultPath, options),
    source,
    target: resultPath,
    ...fileTransferTaskHosts(options)
  })
}

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

const findActiveFileTransferTaskIds = (id: string) => {
  const taskId = String(id || '').trim()
  if (!taskId) return []
  const direct = activeFileTransferTasks.get(taskId)
  if (direct) return [direct.id, ...(direct.children || []).map((child) => child.id)]
  for (const task of activeFileTransferTasks.values()) {
    if (task.children?.some((child) => child.id === taskId)) {
      return [task.id, ...(task.children || []).map((child) => child.id)]
    }
  }
  return []
}

export const cancelFileTransferTask = async (input: FileTransferTaskCancelInput): Promise<FileTransferTaskCancelResult> => {
  const id = String(input?.id || '').trim()
  const taskIds = findActiveFileTransferTaskIds(id)
  if (!id) return { ok: false, errorCode: 'FILES_TRANSFER_TASK_ID_REQUIRED', errorMessage: 'File transfer task id is required.' }
  if (!taskIds.length) return { ok: true, data: { id, taskIds: [], status: 'not_found' } }
  const controls = new Set(taskIds.map((taskId) => activeFileTransferControls.get(taskId)).filter((control): control is FileTransferAbortControl => !!control))
  controls.forEach((control) => control.cancel())
  deleteActiveFileTransferTaskIds(taskIds)
  return { ok: true, data: { id, taskIds, status: 'aborted' } }
}

const normalizeSession = (session: FileSessionInfo): FileSessionInfo | null => {
  const id = String(session.id || '').trim()
  const label = String(session.label || '').trim()
  const host = String(session.host || '').trim()
  const rootPath = String(session.rootPath || '').trim()
  if (!id || !label || !host || !rootPath) return null
  return {
    id,
    label,
    host,
    ...(session.username ? { username: String(session.username).trim() } : {}),
    group: String(session.group || (session.kind === 'local' ? '本地连接' : '资产')).trim(),
    kind: session.kind === 'local' ? 'local' : 'remote',
    rootPath,
    status: session.status === 'idle' || session.status === 'error' ? session.status : 'active',
    ...(typeof session.favorite === 'boolean' ? { favorite: session.favorite } : {}),
    ...(session.assetType === 'local' || session.assetType === 'person' || session.assetType === 'organization' || session.assetType === 'custom_folder'
      ? { assetType: session.assetType }
      : {}),
    ...(session.folderUuid ? { folderUuid: String(session.folderUuid) } : {}),
    ...(session.comment ? { comment: String(session.comment) } : {}),
    ...(session.errorMsg ? { errorMsg: String(session.errorMsg) } : {})
  }
}

const payloadString = (payload: FileSessionSftpPayload, keys: string[]) => {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

const terminalContextString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const terminalContextStatus = (status: FileSessionTerminalContext['panelStatus']) => (status === 'closed' ? 'idle' : 'active')

const terminalContextAssetType = (assetType?: string): FileSessionInfo['assetType'] => {
  const normalized = terminalContextString(assetType).toLowerCase()
  return normalized.includes('organization') ? 'organization' : 'person'
}

const normalizeFileSessionFolderInput = (folder: FileSessionFolderSaveInput, existing?: FileSessionFolderRecord): FileSessionFolderRecord | null => {
  const name = String(folder.name || '').trim()
  if (!name) return null
  return {
    uuid: existing?.uuid || `files-folder-${randomUUID()}`,
    name,
    description: String(folder.description ?? existing?.description ?? '').trim(),
    ...(folder.parentUuid || existing?.parentUuid ? { parentUuid: folder.parentUuid || existing?.parentUuid } : {}),
    ...(folder.scope || existing?.scope ? { scope: folder.scope || existing?.scope } : {})
  }
}

const normalizeStoredFileSessionFolder = (folder: Partial<FileSessionFolderRecord>): FileSessionFolderRecord | null => {
  const uuid = String(folder.uuid || '').trim()
  const name = String(folder.name || '').trim()
  if (!uuid || !name) return null
  return {
    uuid,
    name,
    description: String(folder.description || '').trim(),
    ...(folder.parentUuid ? { parentUuid: String(folder.parentUuid).trim() } : {}),
    ...(folder.scope === 'direct' || folder.scope === 'bastion' ? { scope: folder.scope } : {})
  }
}

const normalizeFileSessionCatalog = (catalog?: Partial<FileSessionCatalog> | null): FileSessionCatalog => {
  const fallback = defaultFileSessionCatalog()
  const hasSessionRows = Array.isArray(catalog?.sessions)
  const hasFolderRows = Array.isArray(catalog?.folders)
  const sessions = (hasSessionRows ? catalog?.sessions || [] : fallback.sessions)
    .map((session) => normalizeSession(session as FileSessionInfo))
    .filter((session): session is FileSessionInfo => Boolean(session))
  const folders = (hasFolderRows ? catalog?.folders || [] : fallback.folders)
    .map((folder) => normalizeStoredFileSessionFolder(folder as Partial<FileSessionFolderRecord>))
    .filter((folder): folder is FileSessionFolderRecord => Boolean(folder))
  if (!sessions.some((session) => session.id === 'local')) sessions.unshift(fileSessionLocalEntry())
  const normalized = { sessions, folders }
  return filesRuntimeConfig.useSeedData ? normalized : stripLegacySeedFileSessionCatalog(normalized)
}

class FallbackFileSessionCatalogStore {
  private store = new Store<FileSessionCatalogStoreShape>({
    projectName: 'aiopsterm',
    name: 'aiopsterm-file-sessions',
    defaults: defaultFileSessionCatalog()
  } as ConstructorParameters<typeof Store<FileSessionCatalogStoreShape>>[0] & { projectName: string })

  load(): FileSessionCatalog {
    const catalog = normalizeFileSessionCatalog({
      sessions: this.store.get('sessions') || [],
      folders: this.store.get('folders') || []
    })
    if (!filesRuntimeConfig.useSeedData) this.save(catalog)
    return catalog
  }

  save(catalog: FileSessionCatalog): FileSessionCatalog {
    const normalized = normalizeFileSessionCatalog(catalog)
    this.store.set('sessions', normalized.sessions)
    this.store.set('folders', normalized.folders)
    return cloneFileSessionCatalog(normalized)
  }

  reset(): FileSessionCatalog {
    return this.save(defaultFileSessionCatalog())
  }
}

class SqliteFileSessionCatalogStore {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_session_catalog (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `)
  }

  load(): FileSessionCatalog {
    const row = this.db.prepare('SELECT data FROM file_session_catalog WHERE key = ?').get('catalog') as { data: string } | undefined
    if (!row?.data) return this.reset()
    return this.save(JSON.parse(row.data) as FileSessionCatalog)
  }

  save(catalog: FileSessionCatalog): FileSessionCatalog {
    const normalized = normalizeFileSessionCatalog(catalog)
    this.db.prepare('INSERT OR REPLACE INTO file_session_catalog (key, data) VALUES (?, ?)').run('catalog', JSON.stringify(normalized))
    return cloneFileSessionCatalog(normalized)
  }

  reset(): FileSessionCatalog {
    return this.save(defaultFileSessionCatalog())
  }
}

let fileSessionCatalogStore: FallbackFileSessionCatalogStore | SqliteFileSessionCatalogStore | null = null

const createFileSessionCatalogStore = () => {
  if (filesRuntimeConfig.sqliteFactory) return new SqliteFileSessionCatalogStore(new filesRuntimeConfig.sqliteFactory(filesRuntimeConfig.databasePath))
  try {
    if (filesRuntimeConfig.forceFallbackStore) throw new Error('force fallback file-session store')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteFileSessionCatalogStore(new Database(filesRuntimeConfig.databasePath))
  } catch {
    return new FallbackFileSessionCatalogStore()
  }
}

const getFileSessionCatalogStore = () => {
  if (!fileSessionCatalogStore) fileSessionCatalogStore = createFileSessionCatalogStore()
  return fileSessionCatalogStore
}

const loadFileSessionCatalog = () => {
  if (!fileSessionCatalog) fileSessionCatalog = getFileSessionCatalogStore().load()
  return fileSessionCatalog
}

const saveFileSessionCatalog = (catalog: FileSessionCatalog) => {
  fileSessionCatalog = getFileSessionCatalogStore().save(catalog)
  return fileSessionCatalog
}

export const saveFileSessionFromSftpPayload = async (payload: FileSessionSftpPayload): Promise<FileSessionMutationResult> => {
  const id = payloadString(payload, ['uuid', 'id', 'assetId', 'host', 'ip'])
  const host = payloadString(payload, ['host', 'ip']) || id
  if (!id || !host) {
    return { ok: false, errorCode: 'FILES_SESSION_PAYLOAD_INVALID', errorMessage: 'SFTP asset payload requires an id or host.' }
  }
  const username = payloadString(payload, ['username', 'user', 'loginName']) || 'deploy'
  const rootPath = payloadString(payload, ['rootPath', 'homePath', 'cwd']) || rootPathForAssetUsername(username, '/home/deploy')
  const rawAssetType = payloadString(payload, ['asset_type', 'assetType']).toLowerCase()
  const session: FileSessionInfo = {
    id,
    label: payloadString(payload, ['title', 'hostname', 'name', 'label']) || host,
    host,
    username,
    group: payloadString(payload, ['group', 'group_name', 'organizationName']) || '资产',
    kind: 'remote',
    rootPath,
    status: 'active',
    favorite: false,
    assetType: rawAssetType.includes('organization') ? 'organization' : 'person',
    ...(payloadString(payload, ['comment', 'description']) ? { comment: payloadString(payload, ['comment', 'description']) } : {})
  }
  return saveFileSession(session)
}

export const saveFileSessionFromTerminalContext = async (context: FileSessionTerminalContext): Promise<FileSessionMutationResult> => {
  if (context?.kind !== 'ssh') {
    return saveFileSession({
      id: 'local',
      label: 'Local',
      host: '127.0.0.1',
      group: '本地连接',
      kind: 'local',
      rootPath: terminalContextString(context?.cwd) || '/',
      status: terminalContextStatus(context?.panelStatus),
      assetType: 'local'
    })
  }

  const ssh = context.ssh || {}
  const assetId = terminalContextString(ssh.assetId)
  const asset = assetId ? getAsset(assetId) : null
  const connectionId = terminalContextString(ssh.connectionId || context.sessionId)
  const host = asset?.host || terminalContextString(ssh.host)
  const id = asset?.id || assetId || (connectionId ? `ssh-${connectionId}` : host)
  if (!id || !host) {
    return { ok: false, errorCode: 'FILES_SESSION_TERMINAL_INVALID', errorMessage: 'Terminal file session requires an SSH asset, connection id, or host.' }
  }

  const username = asset?.username || terminalContextString(ssh.username) || 'deploy'
  const title = asset?.title || asset?.name || terminalContextString(ssh.assetName) || terminalContextString(context.panelTitle) || host
  const group = asset?.group_name || asset?.group || terminalContextString(ssh.organizationId) || '终端连接'
  const rootPath = terminalContextString(context.cwd) || rootPathForAssetUsername(username, '/home/deploy')
  return saveFileSession({
    id,
    label: title,
    host,
    username,
    group,
    kind: 'remote',
    rootPath,
    status: terminalContextStatus(context.panelStatus),
    favorite: typeof asset?.favorite === 'boolean' ? asset.favorite : false,
    assetType: terminalContextAssetType(asset?.asset_type || ssh.assetType),
    ...(asset?.folderUuid ? { folderUuid: asset.folderUuid } : {}),
    ...(asset?.comment ? { comment: asset.comment } : terminalContextString(context.panelTitle) ? { comment: `Opened from ${context.panelTitle}` } : {})
  })
}

export const listFileSessionCatalog = async (): Promise<FileSessionCatalogResult> => {
  const catalog = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
  saveFileSessionCatalog(catalog)
  return fileSessionResult(cloneFileSessionCatalog(catalog))
}

export const saveFileSession = async (session: FileSessionInfo): Promise<FileSessionMutationResult> => {
  const normalized = normalizeSession(session)
  if (!normalized) {
    return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
  }
  const catalog = loadFileSessionCatalog()
  const saved = saveFileSessionCatalog({
    ...catalog,
    sessions: catalog.sessions.some((item) => item.id === normalized.id)
      ? catalog.sessions.map((item) => (item.id === normalized.id ? normalized : item))
      : [...catalog.sessions, normalized]
  })
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), session: cloneSession(normalized) })
}

export const updateFileSession = async (id: string, patch: FileSessionPatch): Promise<FileSessionMutationResult> => {
  const catalog = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
  const session = catalog.sessions.find((item) => item.id === id)
  if (!session) return { ok: false, errorCode: 'FILES_SESSION_NOT_FOUND', errorMessage: 'File session not found.' }
  const assetSyncResult = syncAssetFromFileSessionPatch(id, patch)
  if (assetSyncResult && !assetSyncResult.ok) {
    return { ok: false, errorCode: assetSyncResult.errorCode, errorMessage: assetSyncResult.errorMessage }
  }
  const normalized = normalizeSession({ ...session, ...patch, id })
  if (!normalized) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
  const saved = saveFileSessionCatalog(
    mergeAssetCatalogIntoFileSessions({
    ...catalog,
    sessions: catalog.sessions.map((item) => (item.id === id ? normalized : item))
    })
  )
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), session: cloneSession(normalized) })
}

export const deleteFileSession = async (id: string): Promise<FileSessionCatalogResult> => {
  if (id === 'local') return { ok: false, errorCode: 'FILES_SESSION_LOCAL_REQUIRED', errorMessage: 'Local file session cannot be deleted.' }
  const catalog = loadFileSessionCatalog()
  return fileSessionResult(
    cloneFileSessionCatalog(
      saveFileSessionCatalog({
        ...catalog,
        sessions: catalog.sessions.filter((session) => session.id !== id)
      })
    )
  )
}

export const saveFileSessionFolder = async (folder: FileSessionFolderSaveInput): Promise<FileSessionFolderMutationResult> => {
  const catalog = loadFileSessionCatalog()
  const assetFolder = folder.uuid ? findAssetFolder(folder.uuid) : undefined
  const existing = assetFolder || (folder.uuid ? catalog.folders.find((item) => item.uuid === folder.uuid) : undefined)
  const normalized = normalizeFileSessionFolderInput(folder, existing)
  if (!normalized) return { ok: false, errorCode: 'FILES_FOLDER_NAME_REQUIRED', errorMessage: 'Folder name is required.' }
  if (assetFolder || normalized.scope === 'bastion') {
    const result = saveAssetFolder({
      ...(assetFolder ? { uuid: normalized.uuid } : {}),
      name: normalized.name,
      description: normalized.description,
      scope: normalized.scope || assetFolder?.scope || 'bastion',
      parentUuid: normalized.parentUuid || assetFolder?.parentUuid
    })
    if (!result.ok) return { ok: false, errorCode: result.errorCode || 'FILES_FOLDER_SAVE_FAILED', errorMessage: result.errorMessage || 'Folder save failed.' }
    if (!result.data) return { ok: false, errorCode: 'FILES_FOLDER_SAVE_FAILED', errorMessage: 'Folder save failed.' }
    const merged = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
    saveFileSessionCatalog(merged)
    return fileSessionResult({ ...cloneFileSessionCatalog(merged), folder: cloneFolder(result.data) })
  }
  const saved = saveFileSessionCatalog({
    ...catalog,
    folders: catalog.folders.some((item) => item.uuid === normalized.uuid)
      ? catalog.folders.map((item) => (item.uuid === normalized.uuid ? normalized : item))
      : [...catalog.folders, normalized]
  })
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), folder: cloneFolder(normalized) })
}

export const deleteFileSessionFolder = async (uuid: string): Promise<FileSessionFolderDeleteResult> => {
  const folderUuid = String(uuid || '').trim()
  if (!folderUuid) return { ok: false, errorCode: 'FILES_FOLDER_UUID_REQUIRED', errorMessage: 'Folder uuid is required.' }
  if (findAssetFolder(folderUuid)) {
    const result = deleteAssetFolder(folderUuid)
    if (!result.ok) return { ok: false, errorCode: result.errorCode || 'FILES_FOLDER_DELETE_FAILED', errorMessage: result.errorMessage || 'Folder delete failed.' }
    const merged = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog())
    saveFileSessionCatalog(merged)
    return fileSessionResult({ ...cloneFileSessionCatalog(merged), folderUuid })
  }
  const catalog = loadFileSessionCatalog()
  const saved = saveFileSessionCatalog({
    folders: catalog.folders.filter((folder) => folder.uuid !== folderUuid),
    sessions: catalog.sessions.map((session) => (session.folderUuid === folderUuid ? { ...session, folderUuid: undefined, group: '最近连接' } : session))
  })
  return fileSessionResult({ ...cloneFileSessionCatalog(saved), folderUuid })
}

export const __dropFileSessionCatalogCacheForTests = () => {
  fileSessionCatalog = null
}

export const __resetFileSessionCatalogForTests = () => {
  fileSessionCatalog = getFileSessionCatalogStore().reset()
  activeFileTransferTasks.clear()
  activeFileTransferControls.clear()
  clearRemoteSftpPool()
}

export const __getRemoteSftpPoolSnapshotForTests = () => ({
  active: [...remoteSftpPool.values()].map((connection) => ({
    key: connection.key,
    refCount: connection.refCount,
    closing: connection.closing,
    hasCloseTimer: Boolean(connection.closeTimer)
  })),
  pending: remoteSftpPendingConnections.size
})

const sortEntries = (entries: FileListEntry[]) =>
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : b.type === 'directory' ? 1 : a.type.localeCompare(b.type)
    return a.name.localeCompare(b.name)
  })

export const listFiles = async (directory: string, options: FileListOptions = {}): Promise<FileListEntry[]> => {
  if (options.kind !== 'remote') {
    const path = String(directory || '.').trim() || '.'
    const entries = await readdir(path, { withFileTypes: true })
    const result = await Promise.all(
      entries.slice(0, 500).map(async (item) => {
        const fullPath = join(path, item.name)
        const metadata = await stat(fullPath)
        return {
          name: item.name,
          path: fullPath,
          type: item.isDirectory() ? ('directory' as const) : item.isSymbolicLink() ? ('link' as const) : ('file' as const),
          size: metadata.size,
          modifiedAt: metadata.mtimeMs,
          mode: modeString(item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'link' : 'file', metadata.mode)
        }
      })
    )
    return sortEntries(result)
  }

  const path = normalizeRemotePath(directory)
  const sftpRows = await listRemoteFilesViaSftp(path, options)
  if (sftpRows) return sftpRows
  throw new Error(sftpUnavailableMessage)
}

const maxTextBytes = 1024 * 1024

const ensureTextSize = (size: number) => {
  if (size > maxTextBytes) throw new Error('File too large')
}

const hasExpectedFileVersion = (options: FileContentOptions) =>
  options.expectedAction === 'edit' ||
  options.expectedAction === 'create' ||
  typeof options.expectedMtimeMs === 'number' ||
  typeof options.expectedSize === 'number'

const fileContentConflict = (message = 'File changed on disk. Reload before saving.'): FileWriteContentResult => ({
  ok: false,
  errorCode: 'conflict',
  errorMessage: message
})

const nearlySameMtime = (left: number, right: number, toleranceMs = 1) => Math.abs(left - right) <= toleranceMs

const validateFileContentVersion = (
  current: { exists: boolean; type?: FileListEntry['type']; size?: number; mtimeMs?: number },
  options: FileContentOptions
): FileWriteContentResult | null => {
  if (options.overwrite || !hasExpectedFileVersion(options)) return null

  if (options.expectedAction === 'create') {
    if (current.exists) return fileContentConflict('File was created by another process. Reload before saving.')
    return null
  }

  if (!current.exists) return fileContentConflict('File was removed on disk. Reload before saving.')
  if (current.type && current.type !== 'file') return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }

  if (typeof options.expectedSize === 'number' && Number(current.size ?? 0) !== options.expectedSize) return fileContentConflict()
  if (typeof options.expectedMtimeMs === 'number' && !nearlySameMtime(Number(current.mtimeMs ?? 0), options.expectedMtimeMs)) return fileContentConflict()

  return null
}

const validateRemoteFileContentVersion = async (
  sftp: SFTPWrapper,
  path: string,
  options: FileContentOptions
): Promise<FileWriteContentResult | null> => {
  if (options.overwrite || !hasExpectedFileVersion(options)) return null
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

export const readFileContent = async (filePath: string, options: FileContentOptions = {}): Promise<FileReadContentResult> => {
  if (options.kind !== 'remote') {
    const path = String(filePath || '').trim()
    if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
    try {
      const metadata = await stat(path)
      if (!metadata.isFile()) return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
      ensureTextSize(metadata.size)
      return { ok: true, data: { content: await readFile(path, 'utf-8'), action: 'edit', size: metadata.size, mtimeMs: metadata.mtimeMs } }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { ok: true, data: { content: '', action: 'create', size: 0, mtimeMs: Date.now() } }
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
      return { ok: false, errorCode: 'read_failed', errorMessage: (error as Error).message }
    }
  }

  const path = normalizeRemotePath(filePath)
  const sftpRead = await readRemoteFileViaSftp(path, options)
  if (sftpRead) return sftpRead
  return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
}

export const writeFileContent = async (filePath: string, content: string, options: FileContentOptions = {}): Promise<FileWriteContentResult> => {
  const path = options.kind === 'remote' ? normalizeRemotePath(filePath) : String(filePath || '').trim()
  if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
  const text = typeof content === 'string' ? content : String(content)
  const size = Buffer.byteLength(text, 'utf-8')
  ensureTextSize(size)
  if (options.kind !== 'remote') {
    try {
      const metadata = await stat(path).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      const conflict = validateFileContentVersion(
        metadata
          ? {
              exists: true,
              type: metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'link',
              size: metadata.size,
              mtimeMs: metadata.mtimeMs
            }
          : { exists: false },
        options
      )
      if (conflict) return conflict
      await mkdir(getLocalDirname(path), { recursive: true })
      await writeFile(path, text, 'utf-8')
      const writtenMetadata = await stat(path)
      return { ok: true, data: { size: writtenMetadata.size, mtimeMs: writtenMetadata.mtimeMs, task: writeContentTask(path, options) } }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
      return { ok: false, errorCode: 'write_failed', errorMessage: (error as Error).message }
    }
  }

  const sftpWrite = await writeRemoteFileViaSftp(path, Buffer.from(text, 'utf-8'), options)
  if (sftpWrite) return sftpWrite
  return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
}

const chmodRecursive = async (path: string, mode: number) => {
  await chmod(path, mode)
  const metadata = await stat(path)
  if (!metadata.isDirectory()) return
  const rows = await readdir(path, { withFileTypes: true })
  await Promise.all(rows.map((item) => chmodRecursive(join(path, item.name), mode)))
}

const mutateLocalFileEntry = async (mutation: FileEntryMutation): Promise<FileEntryMutationResult> => {
  const now = Date.now()
  try {
    if (mutation.kind === 'rename') {
      const oldPath = String(mutation.oldPath || '').trim()
      const newPath = String(mutation.newPath || '').trim()
      if (!oldPath || !newPath) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      await rename(oldPath, newPath)
      const metadata = await stat(newPath)
      return { ok: true, data: { affected: 1, path: newPath, mtimeMs: metadata.mtimeMs } }
    }
    if (mutation.kind === 'delete') {
      const path = String(mutation.path || '').trim()
      if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      await rm(path, { recursive: mutation.recursive ?? true, force: false })
      return { ok: true, data: { affected: 1, path, mtimeMs: now } }
    }
    if (mutation.kind === 'copy' || mutation.kind === 'move') {
      const srcPath = String(mutation.srcPath || '').trim()
      const targetPath = String(mutation.targetPath || '').trim()
      if (!srcPath || !targetPath) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      if (srcPath === targetPath) return { ok: true, data: { affected: 0, path: targetPath, mtimeMs: now } }
      if (mutation.kind === 'copy') {
        await cp(srcPath, targetPath, { recursive: true, force: Boolean(mutation.overwrite), errorOnExist: !mutation.overwrite })
      } else {
        if (mutation.overwrite) await rm(targetPath, { recursive: true, force: true })
        await rename(srcPath, targetPath)
      }
      const metadata = await stat(targetPath)
      return { ok: true, data: { affected: 1, path: targetPath, mtimeMs: metadata.mtimeMs } }
    }
    const path = String(mutation.path || '').trim()
    if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
    const mode = Number.parseInt(mutation.mode, 8)
    if (!/^[0-7]{3,4}$/.test(mutation.mode) || Number.isNaN(mode)) {
      return { ok: false, errorCode: 'invalid_mode', errorMessage: 'Permission mode must be octal' }
    }
    if (mutation.recursive) await chmodRecursive(path, mode)
    else await chmod(path, mode)
    const metadata = await stat(path)
    return { ok: true, data: { affected: 1, path, mode: mutation.mode, mtimeMs: metadata.mtimeMs } }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    if (code === 'EEXIST') return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
    return { ok: false, errorCode: 'mutation_failed', errorMessage: (error as Error).message }
  }
}

export const mutateFileEntry = async (mutation: FileEntryMutation, options: FileListOptions = {}): Promise<FileEntryMutationResult> => {
  const result = options.kind === 'remote' ? (await mutateRemoteFileEntryViaSftp(mutation, options)) || sftpUnavailableError('FILES_SFTP_UNAVAILABLE') : await mutateLocalFileEntry(mutation)
  if (!result.ok || !result.data?.path) return result
  const task = mutationTask(mutation, result.data.path, options)
  return task ? { ...result, data: { ...result.data, task } } : result
}

const downloadRemoteFileViaSftp = async (remotePath: string, localPath: string, options: FileListOptions): Promise<FileTransferOperationResult | null> => {
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
        name: basename(source),
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

const copyRemoteTransferViaSftp = async (
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
        await ensureRemoteParentDirs(sftp, dirname(destination))
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
  return normalized === '/' ? 'root' : basename(normalized)
}

const downloadRemoteDirectoryViaSftp = async (
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

const uploadRemoteFileViaSftp = async (
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
      await ensureRemoteParentDirs(sftp, dirname(destination))
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
  await ensureRemoteParentDirs(sftp, dirname(normalized))
  await sftpMkdir(sftp, normalized).catch(async (error) => {
    const existing = await sftpStatOrNull(sftp, normalized)
    if (existing && sftpEntryType(existing) === 'directory') return
    throw error
  })
}

const uploadRemoteDirectoryViaSftp = async (
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

export const transferFileEntry = async (operation: FileTransferOperation, options: FileListOptions = {}): Promise<FileTransferOperationResult> => {
  try {
    if (operation.kind === 'copy-remote') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = normalizeRemotePath(operation.targetPath)
      const sftpResult = await copyRemoteTransferViaSftp(source, target, operation.overwrite, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }
    if (operation.kind === 'download-file') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = String(operation.localPath || '').trim()
      if (!source || !target) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      const sftpResult = await downloadRemoteFileViaSftp(source, target, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }
    if (operation.kind === 'download-directory') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = String(operation.localDirectory || '').trim()
      if (!source || !target) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      const sftpResult = await downloadRemoteDirectoryViaSftp(source, target, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }

    const localPath = String(operation.localPath || '').trim()
    const remoteDirectory = normalizeRemotePath(operation.remoteDirectory)
    if (!localPath || !remoteDirectory) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
    const metadata = await stat(localPath)
    const name = localPath.split(/[\\/]/).filter(Boolean).at(-1) || 'upload'
    const target = normalizeRemotePath(`${remoteDirectory}/${name}`)
    const uploadKind = operation.kind === 'upload-path' ? (metadata.isDirectory() ? 'upload-directory' : 'upload-file') : operation.kind
    if (uploadKind === 'upload-directory') {
      if (!metadata.isDirectory()) return { ok: false, errorCode: 'not_directory', errorMessage: 'Source must be a directory' }
      const sftpResult = await uploadRemoteDirectoryViaSftp(localPath, remoteDirectory, name, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
    }
    if (!metadata.isFile()) return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
    const sftpResult = await uploadRemoteFileViaSftp(localPath, remoteDirectory, name, { ...options, kind: 'remote' })
    if (sftpResult) return sftpResult
    return sftpUnavailableError('FILES_SFTP_UNAVAILABLE')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    return { ok: false, errorCode: 'transfer_failed', errorMessage: (error as Error).message }
  }
}

export const listFileTransferTasks = async (): Promise<FileTransferTask[]> =>
  Array.from(activeFileTransferTasks.values()).map(cloneFileTransferTask)
