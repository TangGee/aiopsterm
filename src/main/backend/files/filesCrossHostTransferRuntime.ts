import { randomUUID } from 'crypto'
import type { FileListOptions, FileTransferOperationResult } from '@shared/contracts/files'
import type { SFTPWrapper, Stats } from 'ssh2'
import { normalizeRemotePath, remoteBasename, remoteDirname } from './filesPathRuntime'
import { resolveRemoteSftpTarget, sftpUnavailableError, withRemoteSftp } from './filesSftpConnectionRuntime'
import {
  ensureRemoteDirectoryViaSftp, ensureRemoteParentDirs, removeRemotePathViaSftp,
  sftpCloseHandle, sftpEntryType, sftpOpenCancellable, sftpReadChunkCancellable,
  sftpReaddir, sftpRename, sftpStatOrNull, sftpUnlink, sftpWriteChunkCancellable,
  type SftpFileHandle, type SftpLowLevelWrapper
} from './filesSftpOperationsRuntime'
import {
  cancelRunningFileTransferTask, completeRunningFileTransferTask, createFileTransferAbortControl,
  createRunningFileTransferTask, finishActiveFileTransferTask, isFileTransferCancelledError,
  registerActiveFileTransferTask, updateActiveFileTransferTask, updateSingleFileTransferProgress
} from './filesTransferRuntime'

export const copyBetweenRemoteHosts = async (
  source: string,
  destination: string,
  overwrite: boolean | undefined,
  sourceOptions: FileListOptions,
  targetOptions: FileListOptions
): Promise<FileTransferOperationResult> => {
  const sourceTarget = resolveRemoteSftpTarget({ ...sourceOptions, kind: 'remote' })
  const destinationTarget = resolveRemoteSftpTarget({ ...targetOptions, kind: 'remote' })
  if (!sourceTarget || !destinationTarget) return sftpUnavailableError()
  const sameHost = sourceTarget.host === destinationTarget.host && sourceTarget.port === destinationTarget.port && sourceTarget.username === destinationTarget.username
  if (sameHost && (destination === source || destination.startsWith(`${source.replace(/\/$/, '')}/`))) {
    return { ok: false, errorCode: 'invalid_target', errorMessage: 'Cannot copy a remote path onto itself or into its own directory.' }
  }
  const control = createFileTransferAbortControl()
  const task = createRunningFileTransferTask({ type: 'r2r', name: remoteBasename(source), source, target: destination, fromHost: sourceTarget.host, toHost: destinationTarget.host })
  let bytes = 0
  let files = 0
  let itemKind: 'file' | 'directory' = 'file'
  registerActiveFileTransferTask(task, control)
  try {
    await withRemoteSftp(sourceTarget, (reader) => withRemoteSftp(destinationTarget, async (writer) => {
      const rootStats = await new Promise<Stats>((resolve, reject) => reader.lstat(source, (error, stats) => error ? reject(error) : resolve(stats)))
      itemKind = sftpEntryType(rootStats) === 'directory' ? 'directory' : 'file'
      task.isGroup = itemKind === 'directory'
      delete task.stage
      task.speed = '传输中'
      updateActiveFileTransferTask(task, control)
      const copy = async (from: string, to: string, stats: Partial<Stats>) => {
        control.assertActive()
        const existing = await sftpStatOrNull(writer, to)
        if (existing && !overwrite) throw Object.assign(new Error('Target already exists'), { code: 'target_exists' })
        const kind = sftpEntryType(stats)
        if (kind === 'directory') {
          if (existing && sftpEntryType(existing) !== 'directory') await removeRemotePathViaSftp(writer, to, true)
          await ensureRemoteDirectoryViaSftp(writer, to)
          for (const child of await sftpReaddir(reader, from)) {
            if (child.filename === '.' || child.filename === '..') continue
            await copy(normalizeRemotePath(`${from}/${child.filename}`), normalizeRemotePath(`${to}/${child.filename}`), child.attrs)
          }
          return
        }
        task.totalFiles = files + 1
        updateActiveFileTransferTask(task, control)
        await ensureRemoteParentDirs(writer, remoteDirname(to))
        const temporary = `${to}.aiopsterm-${randomUUID()}.part`
        try {
          if (kind === 'link') {
            const link = await new Promise<string>((resolve, reject) => reader.readlink(from, (error, value) => error ? reject(error) : resolve(value)))
            control.assertActive()
            await new Promise<void>((resolve, reject) => writer.symlink(link, temporary, (error) => error ? reject(error) : resolve()))
          } else {
            await copyFile(reader, writer, from, temporary, Number(stats.size || 0))
          }
          control.assertActive()
          if (existing) await removeRemotePathViaSftp(writer, to, true)
          await sftpRename(writer, temporary, to)
        } finally {
          await sftpUnlink(writer, temporary).catch(() => {})
        }
        files += 1
        task.finishedFiles = files
        task.speed = `已传输 ${files} 个文件`
        updateActiveFileTransferTask(task, control)
      }
      const copyFile = async (reader: SFTPWrapper, writer: SFTPWrapper, from: string, to: string, size: number) => {
        let readHandle: SftpFileHandle | undefined
        let writeHandle: SftpFileHandle | undefined
        const input = reader as SftpLowLevelWrapper
        const output = writer as SftpLowLevelWrapper
        try {
          readHandle = await sftpOpenCancellable(input, from, 'r', control)
          control.assertActive()
          writeHandle = await sftpOpenCancellable(output, to, 'wx', control, () => {
            void sftpUnlink(writer, to).catch(() => {})
          })
          const buffer = Buffer.alloc(64 * 1024)
          let position = 0
          for (;;) {
            control.assertActive()
            const count = await sftpReadChunkCancellable(input, readHandle, buffer, buffer.length, position, control)
            if (!count) break
            control.assertActive()
            await sftpWriteChunkCancellable(output, writeHandle, buffer, count, position, control)
            position += count
            bytes += count
            updateSingleFileTransferProgress(task, control, position, size, '传输中')
          }
        } finally {
          const results = await Promise.allSettled([
            ...(readHandle ? [sftpCloseHandle(input, readHandle)] : []),
            ...(writeHandle ? [sftpCloseHandle(output, writeHandle)] : [])
          ])
          if (!control.cancelled) {
            const failed = results.find((result) => result.status === 'rejected')
            if (failed?.status === 'rejected') throw failed.reason
          }
        }
      }
      await copy(source, destination, rootStats)
      control.assertActive()
    }))
    return { ok: true, data: { status: 'success', source, target: destination, bytes, files, itemKind, mtimeMs: Date.now(), task: completeRunningFileTransferTask(task, files) } }
  } catch (error) {
    if (isFileTransferCancelledError(error)) {
      return { ok: true, data: { status: 'cancelled', source, target: destination, bytes, files, itemKind, mtimeMs: Date.now(), task: cancelRunningFileTransferTask(task) } }
    }
    delete task.stage
    task.status = 'error'
    task.speed = error instanceof Error ? error.message : '传输失败'
    finishActiveFileTransferTask(task)
    return { ok: false, errorCode: (error as { code?: string })?.code === 'target_exists' ? 'target_exists' : 'transfer_failed', errorMessage: task.speed }
  }
}
