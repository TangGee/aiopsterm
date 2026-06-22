import type { FileListEntry, FileListOptions } from '@shared/contracts/files'
import type { FileEntry as SftpFileEntry, SFTPWrapper, Stats as SftpStats } from 'ssh2'
import { modeString, normalizeRemotePath, remoteDirname } from './filesPathRuntime'
import { remoteCopyChildTask, transferCancelledError, type FileTransferAbortControl, type RemoteCopyTransferStats } from './filesTransferRuntime'

export type SftpFileHandle = unknown
export type SftpLowLevelWrapper = SFTPWrapper & {
  open(path: string, flags: string, callback: (error: Error | null, handle?: SftpFileHandle) => void): void
  read(handle: SftpFileHandle, buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null, bytesRead?: number) => void): void
  write(handle: SftpFileHandle, buffer: Buffer, offset: number, length: number, position: number, callback: (error?: Error | null) => void): void
  close(handle: SftpFileHandle, callback: (error?: Error | null) => void): void
}

type SftpReadlinkWrapper = SFTPWrapper & {
  readlink(path: string, callback: (error: Error | null, target?: string) => void): void
}

export const sftpErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'SFTP operation failed'))

export const isNotFoundError = (error: unknown) => {
  const code = (error as { code?: unknown } | undefined)?.code
  const message = sftpErrorMessage(error).toLowerCase()
  return code === 'ENOENT' || code === 2 || message.includes('no such file') || message.includes('not found')
}

export const sftpStat = (sftp: SFTPWrapper, path: string) =>
  new Promise<SftpStats>((resolve, reject) => {
    sftp.stat(path, (error, stats) => (error ? reject(error) : resolve(stats)))
  })

export const sftpReadFile = (sftp: SFTPWrapper, path: string) =>
  new Promise<Buffer>((resolve, reject) => {
    sftp.readFile(path, (error, content) => (error ? reject(error) : resolve(Buffer.isBuffer(content) ? content : Buffer.from(String(content)))))
  })

export const sftpWriteFile = (sftp: SFTPWrapper, path: string, content: Buffer) =>
  new Promise<void>((resolve, reject) => {
    sftp.writeFile(path, content, (error) => (error ? reject(error) : resolve()))
  })

export const isSftpLowLevelWrapper = (sftp: SFTPWrapper): sftp is SftpLowLevelWrapper => {
  const candidate = sftp as Partial<SftpLowLevelWrapper>
  return (
    typeof candidate.open === 'function' &&
    typeof candidate.read === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.close === 'function'
  )
}

export const sftpCloseHandle = (sftp: SftpLowLevelWrapper, handle: SftpFileHandle) =>
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

export const sftpOpenCancellable = (sftp: SftpLowLevelWrapper, path: string, flags: string, control: FileTransferAbortControl) =>
  cancellableTransferPromise<SftpFileHandle>(control, (settle) => {
    sftp.open(path, flags, (error, handle) => settle(error || (!handle ? new Error('SFTP file handle is unavailable') : null), handle))
  })

export const sftpReadChunkCancellable = (
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

export const sftpWriteChunkCancellable = (
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

export const sftpRename = (sftp: SFTPWrapper, oldPath: string, newPath: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.rename(oldPath, newPath, (error) => (error ? reject(error) : resolve()))
  })

export const sftpUnlink = (sftp: SFTPWrapper, path: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.unlink(path, (error) => (error ? reject(error) : resolve()))
  })

export const sftpRmdir = (sftp: SFTPWrapper, path: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.rmdir(path, (error) => (error ? reject(error) : resolve()))
  })

export const sftpChmod = (sftp: SFTPWrapper, path: string, mode: number) =>
  new Promise<void>((resolve, reject) => {
    sftp.chmod(path, mode, (error) => (error ? reject(error) : resolve()))
  })

export const sftpMkdir = (sftp: SFTPWrapper, path: string) =>
  new Promise<void>((resolve, reject) => {
    sftp.mkdir(path, (error) => (error ? reject(error) : resolve()))
  })

export const sftpReaddir = (sftp: SFTPWrapper, path: string) =>
  new Promise<SftpFileEntry[]>((resolve, reject) => {
    sftp.readdir(path, (error, entries) => (error ? reject(error) : resolve(entries || [])))
  })

export const sftpReadlink = (sftp: SFTPWrapper, path: string) => {
  const reader = sftp as Partial<SftpReadlinkWrapper>
  if (typeof reader.readlink !== 'function') return Promise.resolve('')
  return new Promise<string>((resolve) => {
    reader.readlink!(path, (error, target) => resolve(error ? '' : String(target || '')))
  })
}

export const remotePathExistsAsDirectory = async (sftp: SFTPWrapper, path: string) => {
  try {
    const stats = await sftpStat(sftp, path)
    return sftpEntryType(stats) === 'directory'
  } catch (error) {
    if (isNotFoundError(error)) return false
    throw error
  }
}

export const sftpEntryType = (attrs: Partial<SftpStats>): FileListEntry['type'] => {
  if (typeof attrs.isDirectory === 'function' && attrs.isDirectory()) return 'directory'
  if (typeof attrs.isSymbolicLink === 'function' && attrs.isSymbolicLink()) return 'link'
  if (typeof attrs.isFile === 'function' && attrs.isFile()) return 'file'
  const mode = Number(attrs.mode || 0) & 0o170000
  if (mode === 0o040000) return 'directory'
  if (mode === 0o120000) return 'link'
  return 'file'
}

export const sftpEntryToFileListEntry = (parentPath: string, item: SftpFileEntry): FileListEntry => {
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

export const hydrateRemoteLinkTargets = async (sftp: SFTPWrapper, entries: FileListEntry[]) =>
  Promise.all(
    entries.map(async (entry) => {
      if (entry.type !== 'link') return entry
      const linkTarget = await sftpReadlink(sftp, entry.path)
      return linkTarget ? { ...entry, linkTarget } : entry
    })
  )

export const ensureRemoteParentDirs = async (sftp: SFTPWrapper, remoteDir: string) => {
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

export const sftpStatOrNull = async (sftp: SFTPWrapper, path: string) => {
  try {
    return await sftpStat(sftp, path)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

export const removeRemotePathViaSftp = async (sftp: SFTPWrapper, path: string, recursive = false) => {
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

export const chmodRemotePathViaSftp = async (sftp: SFTPWrapper, path: string, mode: number, recursive = false) => {
  const stats = await sftpStat(sftp, path)
  await sftpChmod(sftp, path, mode)
  if (!recursive || sftpEntryType(stats) !== 'directory') return
  const children = await sftpReaddir(sftp, path)
  for (const child of children) {
    if (child.filename === '.' || child.filename === '..') continue
    await chmodRemotePathViaSftp(sftp, normalizeRemotePath(`${path}/${child.filename}`), mode, true)
  }
}

export const copyRemotePathViaSftp = async (sftp: SFTPWrapper, sourcePath: string, targetPath: string) => {
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

export const collectRemoteCopyStatsViaSftp = async (
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

export const ensureRemoteDirectoryViaSftp = async (sftp: SFTPWrapper, path: string) => {
  const normalized = normalizeRemotePath(path)
  await ensureRemoteParentDirs(sftp, remoteDirname(normalized))
  await sftpMkdir(sftp, normalized).catch(async (error) => {
    const existing = await sftpStatOrNull(sftp, normalized)
    if (existing && sftpEntryType(existing) === 'directory') return
    throw error
  })
}
