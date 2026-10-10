import { mkdtemp, mkdir, open, readFile, readdir, stat, lstat, readlink, symlink, rename, unlink, rmdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import type { FileListOptions, FileTransferTaskEvent } from '../src/shared/contracts/files'

const connections = vi.hoisted(() => ({ hosts: new Map<string, unknown>(), used: [] as string[] }))
vi.mock('../src/main/backend/files/filesSftpConnectionRuntime', () => ({
  resolveRemoteSftpTarget: (options: FileListOptions) => connections.hosts.has(options.sessionId || '') ? { assetId: options.sessionId, host: options.host, username: options.sessionId, port: 22 } : null,
  sftpUnavailableError: () => ({ ok: false, errorCode: 'FILES_SFTP_UNAVAILABLE' }),
  withRemoteSftp: async (target: { assetId: string }, operation: (sftp: unknown) => Promise<unknown>) => {
    connections.used.push(target.assetId)
    return operation(connections.hosts.get(target.assetId))
  }
}))
import { copyBetweenRemoteHosts } from '../src/main/backend/files/filesCrossHostTransferRuntime'
import { cancelFileTransferTask, listFileTransferTasks, resetFileTransferRuntimeForTests, setFileTransferTaskEventSender } from '../src/main/backend/files/filesTransferRuntime'

const sourceOptions = { kind: 'remote' as const, sessionId: 'source', host: 'same-host' }
const targetOptions = { kind: 'remote' as const, sessionId: 'target', host: 'same-host' }
let roots: string[] = []
let writes: number[] = []
let events: FileTransferTaskEvent[] = []
const createHost = async () => {
  const root = await mkdtemp(join(tmpdir(), 'aiopsterm-transfer-'))
  roots.push(root)
  const path = (name: string) => join(root, name)
  const callback = <T>(promise: Promise<T>, done: (error: unknown, result?: T) => void) => { void promise.then(value => done(null, value), error => done(error)) }
  const sftp = {
    stat: (name: string, done: any) => callback(stat(path(name)), done),
    lstat: (name: string, done: any) => callback(lstat(path(name)), done),
    mkdir: (name: string, done: any) => callback(mkdir(path(name)), done),
    readdir: (name: string, done: any) => callback(readdir(path(name)).then(names => Promise.all(names.map(async filename => ({ filename, attrs: await lstat(path(`${name}/${filename}`)) })))), done),
    readlink: (name: string, done: any) => callback(readlink(path(name)), done),
    symlink: (value: string, name: string, done: any) => callback(symlink(value, path(name)), done),
    rename: (from: string, to: string, done: any) => callback(rename(path(from), path(to)), done),
    unlink: (name: string, done: any) => callback(unlink(path(name)), done),
    rmdir: (name: string, done: any) => callback(rmdir(path(name)), done),
    open: (name: string, flags: string, done: any) => callback(open(path(name), flags), done),
    close: (handle: Awaited<ReturnType<typeof open>>, done: any) => callback(handle.close(), done),
    read: (handle: Awaited<ReturnType<typeof open>>, buffer: Buffer, offset: number, length: number, position: number, done: any) => callback(handle.read(buffer, offset, length, position).then(r => r.bytesRead), done),
    write: (handle: Awaited<ReturnType<typeof open>>, buffer: Buffer, offset: number, length: number, position: number, done: any) => {
      writes.push(length)
      callback(handle.write(buffer, offset, length, position), done)
    }
  } as unknown as SFTPWrapper
  return { root, sftp, path }
}

beforeEach(() => {
  roots = []; writes = []; events = []
  connections.hosts.clear(); connections.used = []
  resetFileTransferRuntimeForTests()
  setFileTransferTaskEventSender(event => events.push(event))
})
afterEach(async () => {
  resetFileTransferRuntimeForTests()
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
})

const setup = async () => {
  const source = await createHost(); const target = await createHost()
  connections.hosts.set('source', source.sftp); connections.hosts.set('target', target.sftp)
  return { source, target }
}

describe('cross host SFTP transfers', () => {
  it('reads the source session and streams to a different account even when host and path match', async () => {
    const { source, target } = await setup()
    const payload = Buffer.alloc(200_003, 71)
    await writeFile(source.path('/data.bin'), payload)
    const result = await copyBetweenRemoteHosts('/data.bin', '/data.bin', false, sourceOptions, targetOptions)
    expect(result).toMatchObject({ ok: true, data: { bytes: payload.length, files: 1, status: 'success', task: { status: 'success', progress: 100 } } })
    expect(await readFile(target.path('/data.bin'))).toEqual(payload)
    expect(await readFile(source.path('/data.bin'))).toEqual(payload)
    expect(connections.used).toEqual(['source', 'target'])
    expect(Math.max(...writes)).toBeLessThanOrEqual(64 * 1024)
    expect(events.some(event => event.kind === 'progress' && event.task.speed === '传输中' && !event.task.stage)).toBe(true)
    expect(await listFileTransferTasks()).toEqual([])
  })

  it('copies nested and empty directories and preserves links without traversing them', async () => {
    const { source, target } = await setup()
    await mkdir(source.path('/release/nested'), { recursive: true })
    await mkdir(source.path('/release/empty'))
    await writeFile(source.path('/release/nested/file.txt'), 'release payload')
    await symlink('nested/file.txt', source.path('/release/link.txt'))
    const result = await copyBetweenRemoteHosts('/release', '/incoming/release', false, sourceOptions, targetOptions)
    expect(result).toMatchObject({ ok: true, data: { files: 2, itemKind: 'directory' } })
    expect(await readFile(target.path('/incoming/release/nested/file.txt'), 'utf8')).toBe('release payload')
    expect(await readdir(target.path('/incoming/release/empty'))).toEqual([])
    expect(await readlink(target.path('/incoming/release/link.txt'))).toBe('nested/file.txt')
  })

  it('protects existing targets and only replaces them when overwrite is explicit', async () => {
    const { source, target } = await setup()
    await writeFile(source.path('/file'), 'new'); await writeFile(target.path('/file'), 'old')
    expect(await copyBetweenRemoteHosts('/file', '/file', false, sourceOptions, targetOptions)).toMatchObject({ ok: false, errorCode: 'target_exists' })
    expect(await readFile(target.path('/file'), 'utf8')).toBe('old')
    expect(await copyBetweenRemoteHosts('/file', '/file', true, sourceOptions, targetOptions)).toMatchObject({ ok: true })
    expect(await readFile(target.path('/file'), 'utf8')).toBe('new')
  })

  it('cancels a running copy without leaving a partial target or changing the source', async () => {
    const { source, target } = await setup()
    await writeFile(source.path('/file'), Buffer.alloc(200_000, 65))
    const write = target.sftp.write.bind(target.sftp)
    target.sftp.write = ((...args: Parameters<SFTPWrapper['write']>) => {
      const done = args[5]
      args[5] = (error) => {
        void listFileTransferTasks().then(async tasks => {
          await cancelFileTransferTask({ id: tasks[0].id })
          done(error)
        })
      }
      write(...args)
    }) as SFTPWrapper['write']
    expect(await copyBetweenRemoteHosts('/file', '/file', false, sourceOptions, targetOptions)).toMatchObject({ ok: true, data: { status: 'cancelled', task: { status: 'failed' } } })
    expect(await readdir(target.root)).toEqual([])
    expect((await stat(source.path('/file'))).size).toBe(200_000)
    expect(await listFileTransferTasks()).toEqual([])
  })

  it('closes a target handle that arrives after cancellation and removes the temporary file', async () => {
    const { source, target } = await setup()
    await writeFile(source.path('/file'), 'payload')
    const originalOpen = target.sftp.open.bind(target.sftp)
    let finishOpen: () => void = () => {}
    let reached: () => void = () => {}
    const opened = new Promise<void>(resolve => { reached = resolve })
    target.sftp.open = ((path: string, flags: Parameters<SFTPWrapper['open']>[1], done: (error: Error | undefined, handle: Buffer) => void) => {
      originalOpen(path, flags, (error, handle) => {
        finishOpen = () => done(error, handle)
        reached()
      })
    }) as SFTPWrapper['open']
    const close = vi.spyOn(target.sftp, 'close')
    const pending = copyBetweenRemoteHosts('/file', '/file', false, sourceOptions, targetOptions)
    await opened
    const tasks = await listFileTransferTasks()
    await cancelFileTransferTask({ id: tasks[0].id })
    expect(await pending).toMatchObject({ ok: true, data: { status: 'cancelled' } })
    finishOpen()
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await readdir(target.root)).toEqual([]))
  })

  it('preserves the original destination when reading the source fails during an overwrite', async () => {
    const { source, target } = await setup()
    await writeFile(source.path('/file'), 'new')
    await writeFile(target.path('/file'), 'original')
    source.sftp.read = ((_handle, _buffer, _offset, _length, _position, done) => {
      done(new Error('Source connection lost'), 0, Buffer.alloc(0), 0)
    }) as SFTPWrapper['read']
    expect(await copyBetweenRemoteHosts('/file', '/file', true, sourceOptions, targetOptions)).toMatchObject({ ok: false, errorMessage: 'Source connection lost' })
    expect(await readFile(target.path('/file'), 'utf8')).toBe('original')
    expect(await readdir(target.root)).toEqual(['file'])
    expect(await listFileTransferTasks()).toEqual([])
  })

  it('does not use the target connection when the source session is unavailable', async () => {
    await setup()
    const result = await copyBetweenRemoteHosts('/file', '/file', false, { ...sourceOptions, sessionId: 'missing' }, targetOptions)
    expect(result).toMatchObject({ ok: false, errorCode: 'FILES_SFTP_UNAVAILABLE' })
    expect(connections.used).toEqual([])
  })

  it('rejects same-session self copies and descendant copies before touching files', async () => {
    await setup()
    for (const target of ['/release', '/release/nested']) {
      expect(await copyBetweenRemoteHosts('/release', target, true, sourceOptions, sourceOptions)).toMatchObject({ ok: false, errorCode: 'invalid_target' })
    }
    expect(connections.used).toEqual([])
  })
})
