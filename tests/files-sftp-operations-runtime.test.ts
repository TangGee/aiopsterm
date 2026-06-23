import { describe, expect, it } from 'vitest'
import type { FileListEntry } from '../src/shared/contracts/files'

type SftpStatsLike = {
  mode: number
  size?: number
  mtime?: number
  isDirectory?: () => boolean
  isFile?: () => boolean
  isSymbolicLink?: () => boolean
}

type SftpEntryLike = {
  filename: string
  attrs: SftpStatsLike
}

type SftpRuntime = {
  isNotFoundError: (error: unknown) => boolean
  sftpEntryType: (attrs: Partial<SftpStatsLike>) => FileListEntry['type']
  sftpEntryToFileListEntry: (parentPath: string, item: SftpEntryLike) => FileListEntry
  ensureRemoteParentDirs: (sftp: unknown, remoteDir: string) => Promise<void>
  copyRemotePathViaSftp: (sftp: unknown, sourcePath: string, targetPath: string) => Promise<void>
  removeRemotePathViaSftp: (sftp: unknown, path: string, recursive?: boolean) => Promise<void>
  collectRemoteCopyStatsViaSftp: (sftp: unknown, sourcePath: string, targetPath: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>
  sftpOpenCancellable: (sftp: unknown, path: string, flags: string, control: FakeAbortControl) => Promise<unknown>
}

type FakeAbortControl = {
  cancelled: boolean
  onCancel: (handler: () => void) => () => void
  cancel: () => void
  assertActive: () => void
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/files/filesSftpOperationsRuntime'
  return (await import(modulePath)) as SftpRuntime
}

const createAbortControl = (): FakeAbortControl => {
  const handlers = new Set<() => void>()
  const control: FakeAbortControl = {
    cancelled: false,
    onCancel: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    cancel: () => {
      control.cancelled = true
      handlers.forEach((handler) => handler())
      handlers.clear()
    },
    assertActive: () => {
      if (control.cancelled) throw Object.assign(new Error('File transfer cancelled'), { code: 'FILES_TRANSFER_CANCELLED' })
    }
  }
  return control
}

const createMemorySftp = () => {
  type Node = { type: 'file' | 'directory'; content?: Buffer; mode: number; mtime: number }
  const nodes = new Map<string, Node>([['/', { type: 'directory', mode: 0o040755, mtime: 100 }]])
  const calls: Array<Record<string, unknown>> = []
  const normalize = (path: string) => {
    const normalized = String(path || '/').replace(/\/+/g, '/')
    return normalized === '' ? '/' : normalized
  }
  const dirname = (path: string) => {
    const normalized = normalize(path)
    const index = normalized.lastIndexOf('/')
    return index <= 0 ? '/' : normalized.slice(0, index)
  }
  const basename = (path: string) => normalize(path).split('/').filter(Boolean).at(-1) || ''
  const missing = (path: string) => Object.assign(new Error(`No such file ${path}`), { code: 2 })
  const attrsFor = (node: Node): SftpStatsLike => ({
    mode: node.mode,
    size: node.content?.length || 0,
    mtime: node.mtime,
    isDirectory: () => node.type === 'directory',
    isFile: () => node.type === 'file',
    isSymbolicLink: () => false
  })
  const ensureDirectoryNode = (path: string) => {
    const normalized = normalize(path)
    nodes.set(normalized, { type: 'directory', mode: 0o040755, mtime: 100 })
  }
  const putFile = (path: string, content: string) => {
    const normalized = normalize(path)
    ensureDirectoryNode(dirname(normalized))
    nodes.set(normalized, { type: 'file', content: Buffer.from(content, 'utf-8'), mode: 0o100644, mtime: 200 })
  }
  const sftp = {
    stat(path: string, callback: (error: Error | null, stats?: SftpStatsLike) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'stat', path: normalized })
      const node = nodes.get(normalized)
      callback(node ? null : missing(normalized), node ? attrsFor(node) : undefined)
    },
    mkdir(path: string, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'mkdir', path: normalized })
      if (!nodes.has(dirname(normalized))) {
        callback(missing(dirname(normalized)))
        return
      }
      ensureDirectoryNode(normalized)
      callback(null)
    },
    readdir(path: string, callback: (error: Error | null, entries?: SftpEntryLike[]) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'readdir', path: normalized })
      const node = nodes.get(normalized)
      if (!node) {
        callback(missing(normalized))
        return
      }
      callback(
        null,
        [...nodes.entries()]
          .filter(([entryPath]) => entryPath !== normalized && dirname(entryPath) === normalized)
          .map(([entryPath, entryNode]) => ({ filename: basename(entryPath), attrs: attrsFor(entryNode) }))
      )
    },
    readFile(path: string, callback: (error: Error | null, content?: Buffer) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'readFile', path: normalized })
      const node = nodes.get(normalized)
      callback(node?.type === 'file' ? null : missing(normalized), node?.type === 'file' ? Buffer.from(node.content || Buffer.alloc(0)) : undefined)
    },
    writeFile(path: string, content: Buffer, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'writeFile', path: normalized, content: content.toString('utf-8') })
      if (!nodes.has(dirname(normalized))) {
        callback(missing(dirname(normalized)))
        return
      }
      nodes.set(normalized, { type: 'file', content: Buffer.from(content), mode: 0o100644, mtime: 300 })
      callback(null)
    },
    unlink(path: string, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'unlink', path: normalized })
      nodes.delete(normalized)
      callback(null)
    },
    rmdir(path: string, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'rmdir', path: normalized })
      nodes.delete(normalized)
      callback(null)
    },
    open(_path: string, _flags: string, callback: (error: Error | null, handle?: number) => void) {
      calls.push({ method: 'open', path: _path, flags: _flags })
      setTimeout(() => callback(null, 1), 10)
    }
  }
  return { sftp, nodes, calls, putFile, ensureDirectoryNode }
}

describe('filesSftpOperationsRuntime', () => {
  it('projects SFTP entry types and list entries from attrs', async () => {
    const runtime = await loadRuntime()

    expect(runtime.sftpEntryType({ isDirectory: () => true, mode: 0o040755 })).toBe('directory')
    expect(runtime.sftpEntryType({ isSymbolicLink: () => true, mode: 0o120777 })).toBe('link')
    expect(runtime.sftpEntryType({ mode: 0o100644 })).toBe('file')
    expect(runtime.sftpEntryToFileListEntry('/srv', { filename: 'note.txt', attrs: { mode: 0o100644, size: 12, mtime: 200 } })).toEqual(
      expect.objectContaining({
        name: 'note.txt',
        path: '/srv/note.txt',
        type: 'file',
        size: 12,
        modifiedAt: 200000,
        mode: '-644'
      })
    )
  })

  it('creates missing parent directories before recursive remote copies and removals', async () => {
    const runtime = await loadRuntime()
    const { sftp, nodes, calls, putFile } = createMemorySftp()
    putFile('/src/app.txt', 'app')
    putFile('/src/nested/config.yml', 'config')

    await runtime.copyRemotePathViaSftp(sftp, '/src', '/deploy/current')

    expect(nodes.get('/deploy/current/app.txt')?.content?.toString('utf-8')).toBe('app')
    expect(nodes.get('/deploy/current/nested/config.yml')?.content?.toString('utf-8')).toBe('config')
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'mkdir', path: '/deploy' })]))

    const stats = await runtime.collectRemoteCopyStatsViaSftp(sftp, '/deploy/current', '/backup/current', { kind: 'remote', host: 'sftp-host' })
    expect(stats).toEqual(
      expect.objectContaining({
        bytes: 9,
        fileCount: 2,
        itemKind: 'directory',
        children: expect.arrayContaining([expect.objectContaining({ source: '/deploy/current/app.txt', target: '/backup/current/app.txt' })])
      })
    )

    await runtime.removeRemotePathViaSftp(sftp, '/deploy', true)
    expect(nodes.has('/deploy/current/app.txt')).toBe(false)
    expect(nodes.has('/deploy')).toBe(false)
  })

  it('rejects cancellable operations with the shared file-transfer cancellation marker', async () => {
    const runtime = await loadRuntime()
    const { sftp } = createMemorySftp()
    const control = createAbortControl()
    const pending = runtime.sftpOpenCancellable(sftp, '/slow.txt', 'r', control)

    control.cancel()

    await expect(pending).rejects.toMatchObject({ code: 'FILES_TRANSFER_CANCELLED' })
  })
})
