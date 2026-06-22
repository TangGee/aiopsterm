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
import type { SFTPWrapper, Stats as SftpStats } from 'ssh2'
import { ensureTextSize, normalizeRemotePath, remoteBasename, remoteDirname, sortFileEntries, validateFileContentVersion } from './filesPathRuntime'
import {
  configureFilesSftpConnectionRuntime,
  isFilesSftpUnsupportedError,
  resolveRemoteSftpTarget,
  sftpUnavailableError,
  sftpUnavailableMessage,
  withRemoteSftp,
  type FilesSftpRuntimeConfig
} from './filesSftpConnectionRuntime'
import {
  chmodRemotePathViaSftp,
  collectRemoteCopyStatsViaSftp,
  copyRemotePathViaSftp,
  ensureRemoteDirectoryViaSftp,
  ensureRemoteParentDirs,
  hydrateRemoteLinkTargets,
  isNotFoundError,
  isSftpLowLevelWrapper,
  remotePathExistsAsDirectory,
  removeRemotePathViaSftp,
  sftpCloseHandle,
  sftpEntryToFileListEntry,
  sftpEntryType,
  sftpErrorMessage,
  sftpOpenCancellable,
  sftpReadChunkCancellable,
  sftpReadFile,
  sftpReaddir,
  sftpRename,
  sftpStat,
  sftpStatOrNull,
  sftpWriteChunkCancellable,
  sftpWriteFile,
  type SftpFileHandle,
  type SftpLowLevelWrapper
} from './filesSftpOperationsRuntime'
import {
  addActiveFileTransferChild,
  cancelRunningFileTransferTask,
  completeRunningFileTransferTask,
  createBackendFileTransferTask,
  createFileTransferAbortControl,
  createRemoteCopyTransferTask,
  createRunningFileTransferTask,
  finishActiveFileTransferTask,
  isFileTransferCancelledError,
  registerActiveFileTransferTask,
  remoteCopyResultFileCount,
  transferByteCount,
  transferFromHost,
  transferToHost,
  updateActiveFileTransferTask,
  updateRunningFileTransferProgress,
  updateSingleFileTransferProgress,
  writeContentTask,
  type FileTransferAbortControl
} from './filesTransferRuntime'

export {
  clearRemoteSftpPool,
  getRemoteSftpPoolSnapshotForTests,
  isFilesSftpUnsupportedError,
  sftpUnavailableError,
  sftpUnavailableMessage,
  FilesSftpUnsupportedError
} from './filesSftpConnectionRuntime'

export const configureFilesSftpRuntime = (config: FilesSftpRuntimeConfig = {}) => {
  configureFilesSftpConnectionRuntime(config)
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

const fileError = (error: unknown, errorCode: string) => {
  if (isFilesSftpUnsupportedError(error)) return sftpUnavailableError(error.errorCode, error.message)
  const code = (error as { code?: unknown } | undefined)?.code
  if (isNotFoundError(error)) return { ok: false as const, errorCode: 'not_found', errorMessage: 'File entry not found' }
  if (code === 'EACCES' || code === 'EPERM' || sftpErrorMessage(error).toLowerCase().includes('permission')) {
    return { ok: false as const, errorCode: 'permission', errorMessage: 'Permission denied' }
  }
  return { ok: false as const, errorCode, errorMessage: sftpErrorMessage(error) }
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
