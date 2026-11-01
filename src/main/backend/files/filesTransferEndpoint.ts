import { lstat, mkdir, open, readdir, readlink, rename, unlink, symlink, chmod } from 'fs/promises'
import { dirname, join } from 'path'
import type { SFTPWrapper, Stats } from 'ssh2'
import { remoteDirname, normalizeRemotePath } from './filesPathRuntime'
import { isNotFoundError, sftpEntryType, sftpReaddir, sftpRename, sftpUnlink } from './filesSftpOperationsRuntime'

export type TransferStat = { kind: 'file' | 'directory' | 'link'; size: number; mtime: number; mode?: number }
export type TransferHandle = {
  read: (buffer: Buffer, position: number) => Promise<number>
  write: (buffer: Buffer, position: number) => Promise<void>
  close: () => Promise<void>
}
export type TransferEndpoint = {
  stat: (path: string) => Promise<TransferStat | null>
  list: (path: string) => Promise<string[]>
  join: (parent: string, name: string) => string
  parent: (path: string) => string
  mkdir: (path: string) => Promise<void>
  open: (path: string, flags: 'r' | 'r+' | 'wx') => Promise<TransferHandle>
  rename: (from: string, to: string) => Promise<void>
  chmod: (path: string, mode: number) => Promise<void>
  unlink: (path: string) => Promise<void>
  readlink: (path: string) => Promise<string>
  symlink: (value: string, path: string) => Promise<void>
}
const optionalStat = async (read: () => Promise<TransferStat>) => {
  try { return await read() } catch (error) { if (isNotFoundError(error)) return null; throw error }
}
export const localTransferEndpoint = (): TransferEndpoint => ({
  stat: path => optionalStat(async () => {
    const value = await lstat(path)
    if (!value.isFile() && !value.isDirectory() && !value.isSymbolicLink()) throw new Error('Unsupported source file type')
    return { kind: value.isDirectory() ? 'directory' : value.isSymbolicLink() ? 'link' : 'file', size: value.size, mtime: value.mtimeMs, mode: value.mode & 0o777 }
  }),
  list: path => readdir(path), join, parent: dirname,
  mkdir: async path => { await mkdir(path, { recursive: true }) },
  open: async (path, flags) => {
    const handle = await open(path, flags, 0o600)
    return {
      read: async (buffer, position) => (await handle.read(buffer, 0, buffer.length, position)).bytesRead,
      write: async (buffer, position) => {
        let offset = 0
        while (offset < buffer.length) {
          const result = await handle.write(buffer, offset, buffer.length - offset, position + offset)
          if (!result.bytesWritten) throw new Error('File write made no progress')
          offset += result.bytesWritten
        }
      },
      close: () => handle.close()
    }
  },
  rename, unlink, readlink, symlink, chmod
})
export const remoteTransferEndpoint = (sftp: SFTPWrapper): TransferEndpoint => {
  const endpoint: TransferEndpoint = {
    stat: path => optionalStat(() => new Promise<TransferStat>((resolve, reject) => sftp.lstat(path, (error, stats: Stats) => {
      if (error) return reject(error)
      const kind = sftpEntryType(stats)
      if (!stats.isFile() && !stats.isDirectory() && !stats.isSymbolicLink()) return reject(new Error('Unsupported source file type'))
      resolve({ kind, size: stats.size, mtime: Number(stats.mtime) * 1000, mode: stats.mode & 0o777 })
    }))),
    list: async path => (await sftpReaddir(sftp, path)).map(row => row.filename).filter(name => name !== '.' && name !== '..'),
    join: (parent, name) => normalizeRemotePath(`${parent}/${name}`), parent: remoteDirname,
    mkdir: async path => {
      const existing = await endpoint.stat(path)
      if (existing) {
        if (existing.kind !== 'directory') throw new Error('Destination parent is not a directory')
        return
      }
      const parent = remoteDirname(path)
      if (parent !== path) await endpoint.mkdir(parent)
      await new Promise<void>((resolve, reject) => sftp.mkdir(path, error => error ? reject(error) : resolve()))
    },
    open: async (path, flags) => {
      const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(path, flags, (error, handle) => error ? reject(error) : resolve(handle)))
      return {
        read: (buffer, position) => new Promise<number>((resolve, reject) => sftp.read(handle, buffer, 0, buffer.length, position, (error, count) => error ? reject(error) : resolve(count))),
        write: (buffer, position) => new Promise<void>((resolve, reject) => sftp.write(handle, buffer, 0, buffer.length, position, error => error ? reject(error) : resolve())),
        close: () => new Promise<void>((resolve, reject) => sftp.close(handle, error => error ? reject(error) : resolve()))
      }
    },
    rename: async (from, to) => {
      if (typeof sftp.ext_openssh_rename === 'function') {
        try {
          await new Promise<void>((resolve, reject) => sftp.ext_openssh_rename(from, to, error => error ? reject(error) : resolve()))
          return
        } catch (error) {
          // Servers without the OpenSSH extension may still support ordinary rename.
          if ((error as { code?: number }).code !== 8 && !/does not support|unsupported|not supported/i.test(String(error))) throw error
        }
      }
      await sftpRename(sftp, from, to)
    },
    chmod: (path, mode) => new Promise<void>((resolve, reject) => sftp.chmod(path, mode, error => error ? reject(error) : resolve())),
    unlink: path => sftpUnlink(sftp, path),
    readlink: path => new Promise<string>((resolve, reject) => sftp.readlink(path, (error, value) => error ? reject(error) : resolve(value))),
    symlink: (value, path) => new Promise<void>((resolve, reject) => sftp.symlink(value, path, error => error ? reject(error) : resolve()))
  }
  return endpoint
}
