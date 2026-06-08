import { randomUUID } from 'crypto'
import { basename as getLocalBasename, dirname as getLocalDirname, join } from 'path'
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
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
  FileTransferTaskRecordInput,
  FileTransferTaskRecordResult,
  FileWriteContentResult
} from '@shared/preload'
import type { ConnectConfig, FileEntry as SftpFileEntry, SFTPWrapper, Stats as SftpStats } from 'ssh2'
import { getAsset, getAssetSecret, getKeychainSecret } from './assets'
import { loadSsh2 } from './ssh2Runtime'

type BackendFileEntry = FileListEntry & { mode: string }
type RemoteSftpTarget = {
  assetId: string
  host: string
  username: string
  port: number
  password?: string
  privateKey?: string
  passphrase?: string
  agent?: string
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
  const agent =
    !password && !privateKey && process.env.AIOPSTERM_FILES_SFTP_AGENT === '1' ? textSecret(process.env.SSH_AUTH_SOCK) : ''
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
    ...(agent ? { agent } : {})
  }
}

const sftpErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'SFTP operation failed'))

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

const withRemoteSftp = async <T>(target: RemoteSftpTarget, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> => {
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

  return new Promise<T>((resolve, reject) => {
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
    }
    client
      .once('ready', () => {
        client.sftp((error, sftp) => {
          if (error || !sftp) {
            settle(() => reject(error || new Error('SFTP session is unavailable')))
            closeClient()
            return
          }
          operation(sftp)
            .then((result) => settle(() => resolve(result)))
            .catch((operationError) => settle(() => reject(operationError)))
            .finally(closeClient)
        })
      })
      .once('error', (error) => settle(() => reject(error)))
      .once('close', () => {
        if (!settled) settle(() => reject(new Error('SFTP connection closed before it became ready')))
      })
    client.connect(connectConfig)
  })
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

const listRemoteFilesViaSftp = async (directory: string, options: FileListOptions): Promise<FileListEntry[] | null> => {
  const target = resolveRemoteSftpTarget(options)
  if (!target) return null
  const path = normalizeRemotePath(directory)
  return withRemoteSftp(target, async (sftp) => {
    const rows = (await sftpReaddir(sftp, path))
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .slice(0, 500)
      .map((item) => sftpEntryToFileListEntry(path, item))
    const parent = path === '/' ? [] : [entry('..', dirname(path), 'directory', 0, 'drwxr-xr-x', seedTime)]
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

const remoteSeedTree: Record<string, BackendFileEntry[]> = {
  '/home/deploy': [
    entry('.env.production', '/home/deploy/.env.production', 'file', 2048, '-rw-------'),
    entry('apps', '/home/deploy/apps', 'directory'),
    entry('logs', '/home/deploy/logs', 'directory'),
    entry('release-note.md', '/home/deploy/release-note.md', 'file', 18432),
    entry('current', '/home/deploy/current', 'link')
  ],
  '/home/deploy/apps': [entry('api', '/home/deploy/apps/api', 'directory'), entry('worker', '/home/deploy/apps/worker', 'directory'), entry('deploy.sh', '/home/deploy/apps/deploy.sh', 'file', 9216, '-rwxr-xr-x')],
  '/home/deploy/logs': [entry('.rotate-state', '/home/deploy/logs/.rotate-state', 'file', 512), entry('api.log', '/home/deploy/logs/api.log', 'file', 493568), entry('worker.log', '/home/deploy/logs/worker.log', 'file', 278528)],
  '/home/ops': [entry('scripts', '/home/ops/scripts', 'directory'), entry('readme.txt', '/home/ops/readme.txt', 'file', 4096)],
  '/home/staging': [entry('boot', '/home/staging/boot', 'directory'), entry('release-note.md', '/home/staging/release-note.md', 'file', 2048)],
  '/home/staging/boot': [entry('app.ini', '/home/staging/boot/app.ini', 'file', 1024)]
}

const remoteFileContents: Record<string, { content: string; mtimeMs: number }> = {
  '/home/deploy/.env.production': { content: 'APP_ENV=production\nLOG_LEVEL=info\n', mtimeMs: seedTime },
  '/home/deploy/release-note.md': { content: '# Production release\n\n- API gateway rollout\n- Worker health checks\n', mtimeMs: seedTime },
  '/home/deploy/apps/deploy.sh': {
    content: '#!/usr/bin/env bash\nset -euo pipefail\nnpm run build\nsystemctl restart aiops-api\n',
    mtimeMs: seedTime
  },
  '/home/deploy/logs/api.log': {
    content: '2026-06-04T05:10:00Z info api started\n2026-06-04T05:12:20Z warn slow request /orders\n',
    mtimeMs: seedTime
  },
  '/home/deploy/logs/worker.log': { content: '2026-06-04T05:09:42Z info worker started\n', mtimeMs: seedTime },
  '/home/ops/readme.txt': { content: 'Ops scripts live in ./scripts.\n', mtimeMs: seedTime },
  '/home/staging/release-note.md': { content: '# Staging release\n\n- Validate migration plan\n- Confirm smoke tests\n', mtimeMs: seedTime },
  '/home/staging/boot/app.ini': { content: '[app]\nenv=staging\nport=8080\n', mtimeMs: seedTime }
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

let fileSessionCatalog: FileSessionCatalog = {
  sessions: defaultFileSessions.map((session) => ({ ...session })),
  folders: defaultFileSessionFolders.map((folder) => ({ ...folder }))
}

const cloneSession = (session: FileSessionInfo): FileSessionInfo => ({ ...session })
const cloneFolder = (folder: FileSessionFolderRecord): FileSessionFolderRecord => ({ ...folder })
const cloneFileSessionCatalog = (): FileSessionCatalog => ({
  sessions: fileSessionCatalog.sessions.map(cloneSession),
  folders: fileSessionCatalog.folders.map(cloneFolder)
})

const fileSessionResult = <T>(data: T) => ({ ok: true, data })

const cloneFileTransferTask = (task: FileTransferTask): FileTransferTask => ({
  ...task,
  ...(task.children ? { children: task.children.map(cloneFileTransferTask) } : {})
})

const activeFileTransferTasks = new Map<string, FileTransferTask>()

const normalizeTransferStatus = (status: unknown): FileTransferTask['status'] => {
  if (status === 'running' || status === 'failed' || status === 'error' || status === 'success') return status
  return 'success'
}

const normalizeTransferProgress = (progress: unknown, status: FileTransferTask['status']) => {
  if (typeof progress === 'number' && Number.isFinite(progress)) return Math.max(0, Math.min(100, Math.round(progress)))
  return status === 'success' ? 100 : 0
}

type FileTransferTaskRecordPayload = Omit<FileTransferTaskRecordInput, 'children'> & {
  children?: FileTransferTaskRecordPayload[]
}

const createFileTransferTaskRecord = (input: FileTransferTaskRecordPayload): FileTransferTask => {
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
    ...(input.children?.length ? { children: input.children.map((child) => createFileTransferTaskRecord(child)) } : {})
  }
}

const taskRecordPayload = (input: FileTransferTaskRecordInput): FileTransferTaskRecordPayload => ({
  ...input,
  ...(input.children?.length ? { children: input.children.map((child) => taskRecordPayload(child)) } : {})
})

const transferFromHost = (options: FileListOptions) => options.fromHost || options.host
const transferToHost = (options: FileListOptions) => options.toHost || options.host

const registerActiveFileTransferTask = (task: FileTransferTask) => {
  if (task.status !== 'running') return
  activeFileTransferTasks.set(task.id, cloneFileTransferTask(task))
}

const createCompletedFileTransferTask = (input: FileTransferTaskRecordPayload) => cloneFileTransferTask(createFileTransferTaskRecord({ progress: 100, status: 'success', speed: '完成', ...input }))

const fileTransferTaskHosts = (options: FileListOptions) => ({
  ...(transferFromHost(options) ? { fromHost: transferFromHost(options) } : {}),
  ...(transferToHost(options) ? { toHost: transferToHost(options) } : {})
})

const taskBasename = (path: string, options: FileListOptions) => (options.kind === 'remote' ? basename(path) : getLocalBasename(path))
const taskDirname = (path: string, options: FileListOptions) => (options.kind === 'remote' ? dirname(path) : getLocalDirname(path))

const writeContentTask = (path: string, options: FileContentOptions) =>
  createCompletedFileTransferTask({
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
    return createCompletedFileTransferTask({
      type: 'r2r',
      name: `chmod ${taskBasename(resultPath, options)}`,
      source: resultPath,
      target: mutation.recursive ? 'recursive permissions' : 'permissions',
      ...fileTransferTaskHosts(options)
    })
  }
  if (mutation.kind === 'delete') {
    return createCompletedFileTransferTask({
      type: 'r2r',
      name: `delete ${taskBasename(resultPath, options)}`,
      source: resultPath,
      target: taskDirname(resultPath, options),
      ...fileTransferTaskHosts(options)
    })
  }
  const source = mutation.srcPath
  return createCompletedFileTransferTask({
    type: 'r2r',
    name: taskBasename(resultPath, options),
    source,
    target: resultPath,
    ...fileTransferTaskHosts(options)
  })
}

export const recordFileTransferTask = async (input: FileTransferTaskRecordInput): Promise<FileTransferTaskRecordResult> => {
  try {
    const task = createFileTransferTaskRecord(taskRecordPayload(input))
    registerActiveFileTransferTask(task)
    return { ok: true, data: { task: cloneFileTransferTask(task) } }
  } catch (error) {
    return { ok: false, errorCode: 'FILES_TRANSFER_TASK_INVALID', errorMessage: error instanceof Error ? error.message : 'Invalid transfer task.' }
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
  taskIds.forEach((taskId) => activeFileTransferTasks.delete(taskId))
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

export const saveFileSessionFromSftpPayload = async (payload: FileSessionSftpPayload): Promise<FileSessionMutationResult> => {
  const id = payloadString(payload, ['uuid', 'id', 'assetId', 'host', 'ip'])
  const host = payloadString(payload, ['host', 'ip']) || id
  if (!id || !host) {
    return { ok: false, errorCode: 'FILES_SESSION_PAYLOAD_INVALID', errorMessage: 'SFTP asset payload requires an id or host.' }
  }
  const username = payloadString(payload, ['username', 'user', 'loginName']) || 'deploy'
  const rootPath = payloadString(payload, ['rootPath', 'homePath', 'cwd']) || (username ? `/home/${username}` : '/home/deploy')
  const rawAssetType = payloadString(payload, ['asset_type', 'assetType']).toLowerCase()
  const session: FileSessionInfo = {
    id,
    label: payloadString(payload, ['title', 'hostname', 'name', 'label']) || host,
    host,
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
  const rootPath = terminalContextString(context.cwd) || (username ? `/home/${username}` : '/home/deploy')
  return saveFileSession({
    id,
    label: title,
    host,
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

const ensureLocalFileSession = () => {
  if (fileSessionCatalog.sessions.some((session) => session.id === 'local')) return
  fileSessionCatalog.sessions.unshift(cloneSession(defaultFileSessions[0]))
}

export const listFileSessionCatalog = async (): Promise<FileSessionCatalogResult> => {
  ensureLocalFileSession()
  return fileSessionResult(cloneFileSessionCatalog())
}

export const saveFileSession = async (session: FileSessionInfo): Promise<FileSessionMutationResult> => {
  const normalized = normalizeSession(session)
  if (!normalized) {
    return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
  }
  fileSessionCatalog.sessions = fileSessionCatalog.sessions.some((item) => item.id === normalized.id)
    ? fileSessionCatalog.sessions.map((item) => (item.id === normalized.id ? normalized : item))
    : [...fileSessionCatalog.sessions, normalized]
  return fileSessionResult({ ...cloneFileSessionCatalog(), session: cloneSession(normalized) })
}

export const updateFileSession = async (id: string, patch: FileSessionPatch): Promise<FileSessionMutationResult> => {
  const session = fileSessionCatalog.sessions.find((item) => item.id === id)
  if (!session) return { ok: false, errorCode: 'FILES_SESSION_NOT_FOUND', errorMessage: 'File session not found.' }
  const normalized = normalizeSession({ ...session, ...patch, id })
  if (!normalized) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
  fileSessionCatalog.sessions = fileSessionCatalog.sessions.map((item) => (item.id === id ? normalized : item))
  return fileSessionResult({ ...cloneFileSessionCatalog(), session: cloneSession(normalized) })
}

export const deleteFileSession = async (id: string): Promise<FileSessionCatalogResult> => {
  if (id === 'local') return { ok: false, errorCode: 'FILES_SESSION_LOCAL_REQUIRED', errorMessage: 'Local file session cannot be deleted.' }
  fileSessionCatalog.sessions = fileSessionCatalog.sessions.filter((session) => session.id !== id)
  return fileSessionResult(cloneFileSessionCatalog())
}

const normalizeFileSessionFolderInput = (folder: FileSessionFolderSaveInput, existing?: FileSessionFolderRecord): FileSessionFolderRecord | null => {
  const name = String(folder.name || '').trim()
  if (!name) return null
  return {
    uuid: existing?.uuid || `files-folder-${randomUUID()}`,
    name,
    description: String(folder.description ?? existing?.description ?? '').trim()
  }
}

export const saveFileSessionFolder = async (folder: FileSessionFolderSaveInput): Promise<FileSessionFolderMutationResult> => {
  const existing = folder.uuid ? fileSessionCatalog.folders.find((item) => item.uuid === folder.uuid) : undefined
  const normalized = normalizeFileSessionFolderInput(folder, existing)
  if (!normalized) return { ok: false, errorCode: 'FILES_FOLDER_NAME_REQUIRED', errorMessage: 'Folder name is required.' }
  fileSessionCatalog.folders = fileSessionCatalog.folders.some((item) => item.uuid === normalized.uuid)
    ? fileSessionCatalog.folders.map((item) => (item.uuid === normalized.uuid ? normalized : item))
    : [...fileSessionCatalog.folders, normalized]
  return fileSessionResult({ ...cloneFileSessionCatalog(), folder: cloneFolder(normalized) })
}

export const deleteFileSessionFolder = async (uuid: string): Promise<FileSessionFolderDeleteResult> => {
  const folderUuid = String(uuid || '').trim()
  if (!folderUuid) return { ok: false, errorCode: 'FILES_FOLDER_UUID_REQUIRED', errorMessage: 'Folder uuid is required.' }
  fileSessionCatalog.folders = fileSessionCatalog.folders.filter((folder) => folder.uuid !== folderUuid)
  fileSessionCatalog.sessions = fileSessionCatalog.sessions.map((session) =>
    session.folderUuid === folderUuid ? { ...session, folderUuid: undefined, group: '最近连接' } : session
  )
  return fileSessionResult({ ...cloneFileSessionCatalog(), folderUuid })
}

export const __resetFileSessionCatalogForTests = () => {
  fileSessionCatalog = {
    sessions: defaultFileSessions.map(cloneSession),
    folders: defaultFileSessionFolders.map(cloneFolder)
  }
  activeFileTransferTasks.clear()
}

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

  const rows = (remoteSeedTree[path] || []).map((item) => ({ ...item }))
  const parent = path === '/' ? [] : [entry('..', dirname(path), 'directory', 0, 'drwxr-xr-x', seedTime)]
  return [...parent, ...sortEntries(rows)]
}

const maxTextBytes = 1024 * 1024

const ensureTextSize = (size: number) => {
  if (size > maxTextBytes) throw new Error('File too large')
}

const findRemoteEntry = (path: string) => Object.values(remoteSeedTree).flat().find((item) => item.path === path)

const findRemoteEntryParent = (path: string) => {
  const parentPath = dirname(path)
  const entries = remoteSeedTree[parentPath] || []
  const index = entries.findIndex((item) => item.path === path)
  return { parentPath, entries, index }
}

const renameRemoteContentPath = (oldPath: string, newPath: string) => {
  if (!(oldPath in remoteFileContents)) return
  remoteFileContents[newPath] = remoteFileContents[oldPath]
  delete remoteFileContents[oldPath]
}

const updateRemotePathPrefix = (oldPrefix: string, newPrefix: string, modifiedAt: number) => {
  Object.values(remoteSeedTree)
    .flat()
    .forEach((item) => {
      if (item.path === oldPrefix || item.path.startsWith(`${oldPrefix}/`)) {
        item.path = item.path.replace(oldPrefix, newPrefix)
        item.modifiedAt = modifiedAt
      }
    })
  Object.keys(remoteFileContents).forEach((path) => {
    if (path === oldPrefix || path.startsWith(`${oldPrefix}/`)) {
      remoteFileContents[path.replace(oldPrefix, newPrefix)] = remoteFileContents[path]
      delete remoteFileContents[path]
    }
  })
  Object.keys(remoteSeedTree).forEach((path) => {
    if (path === oldPrefix || path.startsWith(`${oldPrefix}/`)) {
      remoteSeedTree[path.replace(oldPrefix, newPrefix)] = remoteSeedTree[path]
      delete remoteSeedTree[path]
    }
  })
}

const cloneRemoteEntryTree = (sourcePath: string, targetPath: string, modifiedAt: number) => {
  const source = findRemoteEntry(sourcePath)
  if (!source) return false
  const targetParentPath = dirname(targetPath)
  if (findRemoteEntry(targetPath)) return false
  if (!remoteSeedTree[targetParentPath]) remoteSeedTree[targetParentPath] = []
  const cloned = { ...source, name: basename(targetPath), path: targetPath, modifiedAt }
  remoteSeedTree[targetParentPath].push(cloned)
  if (source.type === 'directory') {
    const childEntries = remoteSeedTree[sourcePath] || []
    if (!remoteSeedTree[targetPath]) remoteSeedTree[targetPath] = []
    childEntries.forEach((child) => {
      const childTargetPath = child.path.replace(sourcePath, targetPath)
      cloneRemoteEntryTree(child.path, childTargetPath, modifiedAt)
    })
  } else if (sourcePath in remoteFileContents) {
    remoteFileContents[targetPath] = { ...remoteFileContents[sourcePath], mtimeMs: modifiedAt }
  }
  return true
}

const removeRemotePath = (path: string, recursive = false) => {
  const entry = findRemoteEntry(path)
  if (entry?.type === 'directory' && !recursive && (remoteSeedTree[path] || []).length) {
    return { ok: false as const, errorCode: 'directory_not_empty', errorMessage: 'Directory is not empty' }
  }
  const { entries, index } = findRemoteEntryParent(path)
  if (index >= 0) entries.splice(index, 1)
  delete remoteFileContents[path]
  Object.keys(remoteFileContents).forEach((contentPath) => {
    if (contentPath.startsWith(`${path}/`)) delete remoteFileContents[contentPath]
  })
  Object.keys(remoteSeedTree).forEach((treePath) => {
    if (treePath === path || treePath.startsWith(`${path}/`)) delete remoteSeedTree[treePath]
  })
  return { ok: true as const }
}

const upsertRemoteFileEntry = (path: string, size: number, modifiedAt: number) => {
  const parentPath = dirname(path)
  const name = path.split('/').filter(Boolean).at(-1) || path
  const existing = findRemoteEntry(path)
  if (existing) {
    existing.size = size
    existing.modifiedAt = modifiedAt
    existing.type = 'file'
    return
  }
  if (!remoteSeedTree[parentPath]) remoteSeedTree[parentPath] = []
  remoteSeedTree[parentPath].push(entry(name, path, 'file', size, '-rw-r--r--', modifiedAt))
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

  const entry = findRemoteEntry(path)
  if (entry && entry.type !== 'file') return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
  if (!entry && !(path in remoteFileContents)) return { ok: true, data: { content: '', action: 'create', size: 0, mtimeMs: Date.now() } }
  const content = remoteFileContents[path]?.content ?? ''
  const size = Buffer.byteLength(content, 'utf-8')
  ensureTextSize(size)
  return { ok: true, data: { content, action: 'edit', size, mtimeMs: remoteFileContents[path]?.mtimeMs ?? entry?.modifiedAt ?? seedTime } }
}

export const writeFileContent = async (filePath: string, content: string, options: FileContentOptions = {}): Promise<FileWriteContentResult> => {
  const path = options.kind === 'remote' ? normalizeRemotePath(filePath) : String(filePath || '').trim()
  if (!path) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
  const text = typeof content === 'string' ? content : String(content)
  const size = Buffer.byteLength(text, 'utf-8')
  ensureTextSize(size)
  if (options.kind !== 'remote') {
    try {
      await mkdir(getLocalDirname(path), { recursive: true })
      await writeFile(path, text, 'utf-8')
      const metadata = await stat(path)
      return { ok: true, data: { size: metadata.size, mtimeMs: metadata.mtimeMs, task: writeContentTask(path, options) } }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
      return { ok: false, errorCode: 'write_failed', errorMessage: (error as Error).message }
    }
  }

  const sftpWrite = await writeRemoteFileViaSftp(path, Buffer.from(text, 'utf-8'), options)
  if (sftpWrite) return sftpWrite

  const modifiedAt = Date.now()
  remoteFileContents[path] = { content: text, mtimeMs: modifiedAt }
  upsertRemoteFileEntry(path, size, modifiedAt)
  return { ok: true, data: { size, mtimeMs: modifiedAt, task: writeContentTask(path, options) } }
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

const mutateRemoteFileEntry = async (mutation: FileEntryMutation): Promise<FileEntryMutationResult> => {
  const modifiedAt = Date.now()
  if (mutation.kind === 'rename') {
    const oldPath = normalizeRemotePath(mutation.oldPath)
    const newPath = normalizeRemotePath(mutation.newPath)
    const targetParentPath = dirname(newPath)
    const source = findRemoteEntry(oldPath)
    if (!source) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (findRemoteEntry(newPath)) return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
    const sourceParent = findRemoteEntryParent(oldPath)
    if (sourceParent.index >= 0) sourceParent.entries.splice(sourceParent.index, 1)
    if (!remoteSeedTree[targetParentPath]) remoteSeedTree[targetParentPath] = []
    source.name = basename(newPath)
    source.path = newPath
    source.modifiedAt = modifiedAt
    remoteSeedTree[targetParentPath].push(source)
    if (source.type === 'directory') updateRemotePathPrefix(oldPath, newPath, modifiedAt)
    else renameRemoteContentPath(oldPath, newPath)
    return { ok: true, data: { affected: 1, path: newPath, mtimeMs: modifiedAt } }
  }
  if (mutation.kind === 'delete') {
    const path = normalizeRemotePath(mutation.path)
    if (!findRemoteEntry(path) && !(path in remoteFileContents)) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    const removed = removeRemotePath(path, mutation.recursive)
    if (!removed.ok) return removed
    return { ok: true, data: { affected: 1, path, mtimeMs: modifiedAt } }
  }
  if (mutation.kind === 'copy' || mutation.kind === 'move') {
    const srcPath = normalizeRemotePath(mutation.srcPath)
    const targetPath = normalizeRemotePath(mutation.targetPath)
    if (srcPath === targetPath) return { ok: true, data: { affected: 0, path: targetPath, mtimeMs: modifiedAt } }
    if (!findRemoteEntry(srcPath) && !(srcPath in remoteFileContents)) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    const existingTarget = findRemoteEntry(targetPath)
    if (existingTarget || targetPath in remoteFileContents) {
      if (!mutation.overwrite) return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
      removeRemotePath(targetPath, true)
    }
    const copied = cloneRemoteEntryTree(srcPath, targetPath, modifiedAt)
    if (!copied) return { ok: false, errorCode: 'copy_failed', errorMessage: 'Copy failed' }
    if (mutation.kind === 'move') removeRemotePath(srcPath, true)
    return { ok: true, data: { affected: 1, path: targetPath, mtimeMs: modifiedAt } }
  }
  const path = normalizeRemotePath(mutation.path)
  const entry = findRemoteEntry(path)
  if (!entry) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
  if (!/^[0-7]{3,4}$/.test(mutation.mode)) return { ok: false, errorCode: 'invalid_mode', errorMessage: 'Permission mode must be octal' }
  const prefix = entry.type === 'directory' ? 'd' : entry.type === 'link' ? 'l' : '-'
  entry.mode = `${prefix}${mutation.mode.slice(-3)}`
  entry.modifiedAt = modifiedAt
  return { ok: true, data: { affected: 1, path, mode: mutation.mode.slice(-3), mtimeMs: modifiedAt } }
}

export const mutateFileEntry = async (mutation: FileEntryMutation, options: FileListOptions = {}): Promise<FileEntryMutationResult> => {
  const result = options.kind === 'remote' ? (await mutateRemoteFileEntryViaSftp(mutation, options)) || (await mutateRemoteFileEntry(mutation)) : await mutateLocalFileEntry(mutation)
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
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const stats = await sftpStat(sftp, source)
      if (sftpEntryType(stats) !== 'file') return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
      const content = await sftpReadFile(sftp, source)
      await mkdir(getLocalDirname(destination), { recursive: true })
      await writeFile(destination, content)
      const task = createFileTransferTaskRecord({
        type: 'download',
        name: basename(source),
        source,
        target: destination,
        progress: 100,
        speed: '完成',
        status: 'success',
        fromHost: transferFromHost(options),
        ...(options.toHost ? { toHost: options.toHost } : {})
      })
      return { ok: true, data: { status: 'success', source, target: destination, bytes: content.length, files: 1, mtimeMs, itemKind: 'file', task } }
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
      const children: FileTransferTaskRecordPayload[] = []
      const downloadDirectory = async (remoteDir: string, localDir: string) => {
        await mkdir(localDir, { recursive: true })
        const rows = (await sftpReaddir(sftp, remoteDir))
          .filter((row) => row.filename !== '.' && row.filename !== '..')
          .sort((left, right) => left.filename.localeCompare(right.filename))
        for (const row of rows) {
          const remoteChild = normalizeRemotePath(`${remoteDir}/${row.filename}`)
          const localChild = join(localDir, row.filename)
          if (sftpEntryType(row.attrs as Partial<SftpStats>) === 'directory') {
            await downloadDirectory(remoteChild, localChild)
            continue
          }
          const content = await sftpReadFile(sftp, remoteChild)
          await mkdir(getLocalDirname(localChild), { recursive: true })
          await writeFile(localChild, content)
          bytes += content.length
          fileCount += 1
          children.push({
            type: 'download',
            name: row.filename,
            source: remoteChild,
            target: localChild,
            progress: 100,
            speed: '完成',
            status: 'success',
            fromHost: transferFromHost(options),
            ...(options.toHost ? { toHost: options.toHost } : {}),
            stage: 'pending'
          })
        }
      }
      await downloadDirectory(source, destination)
      const task = createFileTransferTaskRecord({
        type: 'download',
        name: remoteDirectoryDownloadName(source),
        source,
        target: destination,
        progress: 100,
        speed: '完成',
        status: 'success',
        fromHost: transferFromHost(options),
        ...(options.toHost ? { toHost: options.toHost } : {}),
        stage: 'scanning',
        isGroup: true,
        totalFiles: fileCount,
        finishedFiles: fileCount,
        ...(children.length ? { children } : {})
      })
      return { ok: true, data: { status: 'success', source, target: destination, bytes, files: Math.max(fileCount, 1), mtimeMs, itemKind: 'directory', task } }
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
  try {
    return await withRemoteSftp(target, async (sftp) => {
      const content = await readFile(source)
      await ensureRemoteParentDirs(sftp, dirname(destination))
      await sftpWriteFile(sftp, destination, content)
      const task = createFileTransferTaskRecord({
        type: 'upload',
        name,
        source,
        target: destination,
        progress: 100,
        speed: '完成',
        status: 'success',
        ...(options.fromHost ? { fromHost: options.fromHost } : {}),
        toHost: transferToHost(options),
        stage: 'pending'
      })
      return { ok: true, data: { status: 'success', source, target: destination, bytes: content.length, files: 1, mtimeMs, itemKind: 'file', task } }
    })
  } catch (error) {
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
      const children: FileTransferTaskRecordPayload[] = []
      const uploadDirectory = async (localDir: string, remoteDir: string) => {
        await ensureRemoteDirectoryViaSftp(sftp, remoteDir)
        const rows = (await readdir(localDir, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
        for (const row of rows) {
          const localChild = join(localDir, row.name)
          const remoteChild = normalizeRemotePath(`${remoteDir}/${row.name}`)
          if (row.isDirectory()) {
            await uploadDirectory(localChild, remoteChild)
            continue
          }
          if (!row.isFile()) continue
          const content = await readFile(localChild)
          await sftpWriteFile(sftp, remoteChild, content)
          bytes += content.length
          fileCount += 1
          children.push({
            type: 'upload',
            name: row.name,
            source: localChild,
            target: remoteChild,
            progress: 100,
            speed: '完成',
            status: 'success',
            ...(options.fromHost ? { fromHost: options.fromHost } : {}),
            toHost: transferToHost(options),
            stage: 'pending'
          })
        }
      }
      await uploadDirectory(source, destination)
      const task = createFileTransferTaskRecord({
        type: 'upload',
        name,
        source,
        target: destination,
        progress: 100,
        speed: '完成',
        status: 'success',
        ...(options.fromHost ? { fromHost: options.fromHost } : {}),
        toHost: transferToHost(options),
        stage: 'scanning',
        isGroup: true,
        totalFiles: fileCount,
        finishedFiles: fileCount,
        ...(children.length ? { children } : {})
      })
      return { ok: true, data: { status: 'success', source, target: destination, bytes, files: Math.max(fileCount, 1), mtimeMs, itemKind: 'directory', task } }
    })
  } catch (error) {
    return fileError(error, 'transfer_failed')
  }
}

const downloadRemoteDirectoryFromSeed = async (remotePath: string, localDirectory: string, options: FileListOptions): Promise<FileTransferOperationResult> => {
  const source = normalizeRemotePath(remotePath)
  const entry = findRemoteEntry(source)
  if (entry && entry.type !== 'directory') return { ok: false, errorCode: 'not_directory', errorMessage: 'Source must be a directory' }
  if (!entry && !(source in remoteSeedTree)) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
  const destination = join(String(localDirectory || '').trim(), remoteDirectoryDownloadName(source))
  const mtimeMs = Date.now()
  let bytes = 0
  let fileCount = 0
  const children: FileTransferTaskRecordPayload[] = []
  const downloadDirectory = async (remoteDir: string, localDir: string) => {
    await mkdir(localDir, { recursive: true })
    for (const row of sortEntries((remoteSeedTree[remoteDir] || []).map((item) => ({ ...item })))) {
      const localChild = join(localDir, row.name)
      if (row.type === 'directory') {
        await downloadDirectory(row.path, localChild)
        continue
      }
      if (row.type !== 'file') continue
      const content = Buffer.from(remoteFileContents[row.path]?.content || '', 'utf-8')
      await mkdir(getLocalDirname(localChild), { recursive: true })
      await writeFile(localChild, content)
      bytes += content.length
      fileCount += 1
      children.push({
        type: 'download',
        name: row.name,
        source: row.path,
        target: localChild,
        progress: 100,
        speed: '完成',
        status: 'success',
        fromHost: transferFromHost(options),
        ...(options.toHost ? { toHost: options.toHost } : {}),
        stage: 'pending'
      })
    }
  }
  await downloadDirectory(source, destination)
  const task = createFileTransferTaskRecord({
    type: 'download',
    name: remoteDirectoryDownloadName(source),
    source,
    target: destination,
    progress: 100,
    speed: '完成',
    status: 'success',
    fromHost: transferFromHost(options),
    ...(options.toHost ? { toHost: options.toHost } : {}),
    stage: 'scanning',
    isGroup: true,
    totalFiles: fileCount,
    finishedFiles: fileCount,
    ...(children.length ? { children } : {})
  })
  return { ok: true, data: { status: 'success', source, target: destination, bytes, files: Math.max(fileCount, 1), mtimeMs, itemKind: 'directory', task } }
}

export const transferFileEntry = async (operation: FileTransferOperation, options: FileListOptions = {}): Promise<FileTransferOperationResult> => {
  const mtimeMs = Date.now()
  try {
    if (operation.kind === 'copy-remote') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = normalizeRemotePath(operation.targetPath)
      const result =
        (await mutateRemoteFileEntryViaSftp({ kind: 'copy', srcPath: source, targetPath: target, overwrite: operation.overwrite }, options)) ||
        (await mutateRemoteFileEntry({ kind: 'copy', srcPath: source, targetPath: target, overwrite: operation.overwrite }))
      if (!result.ok) return { ok: false, errorCode: result.errorCode, errorMessage: result.errorMessage }
      const readResult = await readFileContent(result.data?.path || target, { ...options, kind: 'remote' })
      const bytes = readResult.ok ? Buffer.byteLength(readResult.data?.content || '', 'utf-8') : 0
      const task = createFileTransferTaskRecord({
        type: 'r2r',
        name: basename(source),
        source,
        target: result.data?.path || target,
        progress: 100,
        speed: '完成',
        status: 'success',
        fromHost: transferFromHost(options),
        toHost: transferToHost(options)
      })
      return { ok: true, data: { status: 'success', source, target: result.data?.path || target, bytes, files: 1, mtimeMs, task } }
    }
    if (operation.kind === 'download-file') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = String(operation.localPath || '').trim()
      if (!source || !target) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      const sftpResult = await downloadRemoteFileViaSftp(source, target, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      const readResult = await readFileContent(source, { ...options, kind: 'remote' })
      if (!readResult.ok) return { ok: false, errorCode: readResult.errorCode, errorMessage: readResult.errorMessage }
      await mkdir(getLocalDirname(target), { recursive: true })
      const content = readResult.data?.content ?? ''
      await writeFile(target, content, 'utf-8')
      const task = createFileTransferTaskRecord({
        type: 'download',
        name: basename(source),
        source,
        target,
        progress: 100,
        speed: '完成',
        status: 'success',
        fromHost: transferFromHost(options),
        ...(options.toHost ? { toHost: options.toHost } : {})
      })
      return { ok: true, data: { status: 'success', source, target, bytes: Buffer.byteLength(content, 'utf-8'), files: 1, mtimeMs, task } }
    }
    if (operation.kind === 'download-directory') {
      const source = normalizeRemotePath(operation.remotePath)
      const target = String(operation.localDirectory || '').trim()
      if (!source || !target) return { ok: false, errorCode: 'invalid_path', errorMessage: 'File path is required' }
      const sftpResult = await downloadRemoteDirectoryViaSftp(source, target, { ...options, kind: 'remote' })
      if (sftpResult) return sftpResult
      return downloadRemoteDirectoryFromSeed(source, target, { ...options, kind: 'remote' })
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
      if (!remoteSeedTree[remoteDirectory]) remoteSeedTree[remoteDirectory] = []
      if (!findRemoteEntry(target)) remoteSeedTree[remoteDirectory].push(entry(name, target, 'directory', 0, 'drwxr-xr-x', mtimeMs))
      if (!remoteSeedTree[target]) remoteSeedTree[target] = []
      const task = createFileTransferTaskRecord({
        type: 'upload',
        name,
        source: localPath,
        target,
        progress: 100,
        speed: '完成',
        status: 'success',
        ...(options.fromHost ? { fromHost: options.fromHost } : {}),
        toHost: transferToHost(options),
        stage: 'scanning',
        isGroup: true,
        totalFiles: 1,
        finishedFiles: 1
      })
      return { ok: true, data: { status: 'success', source: localPath, target, bytes: 0, files: 1, mtimeMs, itemKind: 'directory', task } }
    }
    if (!metadata.isFile()) return { ok: false, errorCode: 'not_file', errorMessage: 'Source must be a file' }
    const sftpResult = await uploadRemoteFileViaSftp(localPath, remoteDirectory, name, { ...options, kind: 'remote' })
    if (sftpResult) return sftpResult
    const content = await readFile(localPath, 'utf-8')
    await writeFileContent(target, content, { ...options, kind: 'remote' })
    const task = createFileTransferTaskRecord({
      type: 'upload',
      name,
      source: localPath,
      target,
      progress: 100,
      speed: '完成',
      status: 'success',
      ...(options.fromHost ? { fromHost: options.fromHost } : {}),
      toHost: transferToHost(options),
      stage: 'pending'
    })
    return {
      ok: true,
      data: { status: 'success', source: localPath, target, bytes: Buffer.byteLength(content, 'utf-8'), files: 1, mtimeMs, itemKind: 'file', task }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    return { ok: false, errorCode: 'transfer_failed', errorMessage: (error as Error).message }
  }
}

export const listFileTransferTasks = async (): Promise<FileTransferTask[]> =>
  Array.from(activeFileTransferTasks.values()).map(cloneFileTransferTask)
