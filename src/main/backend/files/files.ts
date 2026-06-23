import { dirname as getLocalDirname, join } from 'path'
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from 'fs/promises'
import type {
  FileSessionCatalogResult,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
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
  FileTransferOperation,
  FileTransferOperationResult,
  FileWriteContentResult
} from '@shared/contracts/files'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { AiopsAssetInput } from '@shared/contracts/assets'
import { deleteAssetFolder, getAsset, listAssets, saveAsset, saveAssetFolder } from '../assets/assets'
import { ensureTextSize, modeString, normalizeRemotePath, sortFileEntries as sortEntries, validateFileContentVersion } from './filesPathRuntime'
import {
  cloneFileSessionCatalog,
  cloneFolder,
  cloneSession,
  configureFilesSessionCatalogRuntime,
  dropFileSessionCatalogCacheForTests,
  fileSessionFromSftpPayload,
  fileSessionFromTerminalContext,
  loadFileSessionCatalog,
  mergeAssetCatalogIntoFileSessions,
  normalizeFileSessionFolderInput,
  normalizeSession,
  resetFileSessionCatalogForTests,
  saveFileSessionCatalog,
  terminalContextAssetId,
  type SqliteDatabase
} from './filesSessionCatalogRuntime'
import {
  clearRemoteSftpPool,
  configureFilesSftpRuntime,
  copyRemoteTransferViaSftp,
  downloadRemoteDirectoryViaSftp,
  downloadRemoteFileViaSftp,
  isFilesSftpUnsupportedError,
  listRemoteFilesViaSftp,
  mutateRemoteFileEntryViaSftp,
  readRemoteFileViaSftp,
  sftpUnavailableError,
  sftpUnavailableMessage,
  uploadRemoteDirectoryViaSftp,
  uploadRemoteFileViaSftp,
  writeRemoteFileViaSftp
} from './filesSftpRuntime'
import { mutationTask, resetFileTransferRuntimeForTests, writeContentTask } from './filesTransferRuntime'
export { getRemoteSftpPoolSnapshotForTests as __getRemoteSftpPoolSnapshotForTests } from './filesSftpRuntime'
export { cancelFileTransferTask, listFileTransferTasks } from './filesTransferRuntime'

type FilesBackendRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  databasePath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sqliteFactory?: new (path: string) => SqliteDatabase
  sftpPoolIdleTtlMs?: number
}

export const configureFilesBackendRuntime = (config: FilesBackendRuntimeConfig = {}) => {
  clearRemoteSftpPool()
  configureFilesSftpRuntime({ getConfig: config.getConfig, sftpPoolIdleTtlMs: config.sftpPoolIdleTtlMs })
  configureFilesSessionCatalogRuntime(config)
}

const findAssetFolder = (uuid: string) => listAssets().folders.find((folder) => folder.uuid === uuid)

const fileSessionAssetSnapshot = () => {
  const snapshot = listAssets()
  return { assets: snapshot.assets, folders: snapshot.folders }
}

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

const fileSessionResult = <T>(data: T) => ({ ok: true, data })

export const saveFileSessionFromSftpPayload = async (payload: FileSessionSftpPayload): Promise<FileSessionMutationResult> => {
  const result = fileSessionFromSftpPayload(payload)
  if (!result.ok) return result
  return saveFileSession(result.session)
}

export const saveFileSessionFromTerminalContext = async (context: FileSessionTerminalContext): Promise<FileSessionMutationResult> => {
  const assetId = terminalContextAssetId(context)
  const result = fileSessionFromTerminalContext(context, assetId ? getAsset(assetId) : null)
  if (!result.ok) return result
  return saveFileSession(result.session)
}

export const listFileSessionCatalog = async (): Promise<FileSessionCatalogResult> => {
  const catalog = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog(), fileSessionAssetSnapshot())
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
  const catalog = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog(), fileSessionAssetSnapshot())
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
    }, fileSessionAssetSnapshot())
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
    const merged = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog(), fileSessionAssetSnapshot())
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
    const merged = mergeAssetCatalogIntoFileSessions(loadFileSessionCatalog(), fileSessionAssetSnapshot())
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
  dropFileSessionCatalogCacheForTests()
}

export const __resetFileSessionCatalogForTests = () => {
  resetFileSessionCatalogForTests()
  resetFileTransferRuntimeForTests()
  clearRemoteSftpPool()
}

export const listFiles = async (directory: string, options: FileListOptions = {}): Promise<FileListEntry[]> => {
  if (options.kind !== 'remote') {
    const path = String(directory || '.').trim() || '.'
    const entries = await readdir(path, { withFileTypes: true })
    const result = await Promise.all(
      entries.slice(0, 500).map(async (item) => {
        const fullPath = join(path, item.name)
        const metadata = await lstat(fullPath)
        const type = item.isDirectory() ? ('directory' as const) : item.isSymbolicLink() ? ('link' as const) : ('file' as const)
        const linkTarget = type === 'link' ? await readlink(fullPath).catch(() => '') : ''
        return {
          name: item.name,
          path: fullPath,
          type,
          size: metadata.size,
          modifiedAt: metadata.mtimeMs,
          mode: modeString(type, metadata.mode),
          ...(linkTarget ? { linkTarget } : {})
        }
      })
    )
    return sortEntries(result)
  }

  const path = normalizeRemotePath(directory)
  let sftpRows: FileListEntry[] | null
  try {
    sftpRows = await listRemoteFilesViaSftp(path, options)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) throw new Error(error.message)
    throw error
  }
  if (sftpRows) return sftpRows
  throw new Error(sftpUnavailableMessage)
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
  let sftpRead: FileReadContentResult | null
  try {
    sftpRead = await readRemoteFileViaSftp(path, options)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    throw error
  }
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

  let sftpWrite: FileWriteContentResult | null
  try {
    sftpWrite = await writeRemoteFileViaSftp(path, Buffer.from(text, 'utf-8'), options)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    throw error
  }
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
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    if (code === 'EEXIST') return { ok: false, errorCode: 'target_exists', errorMessage: 'Target already exists' }
    return { ok: false, errorCode: 'mutation_failed', errorMessage: (error as Error).message }
  }
}

export const mutateFileEntry = async (mutation: FileEntryMutation, options: FileListOptions = {}): Promise<FileEntryMutationResult> => {
  let result: FileEntryMutationResult
  try {
    result = options.kind === 'remote' ? (await mutateRemoteFileEntryViaSftp(mutation, options)) || sftpUnavailableError('FILES_SFTP_UNAVAILABLE') : await mutateLocalFileEntry(mutation)
  } catch (error) {
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    throw error
  }
  if (!result.ok || !result.data?.path) return result
  const task = mutationTask(mutation, result.data.path, options)
  return task ? { ...result, data: { ...result.data, task } } : result
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
    if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, errorCode: 'permission', errorMessage: 'Permission denied' }
    return { ok: false, errorCode: 'transfer_failed', errorMessage: (error as Error).message }
  }
}
