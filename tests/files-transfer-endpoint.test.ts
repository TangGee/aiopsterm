import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, open, lstat, readFile, rename, rm, writeFile, chmod } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SFTPWrapper } from 'ssh2'
import { localTransferEndpoint, remoteTransferEndpoint } from '../src/main/backend/files/filesTransferEndpoint'
import { copyResumableEntry } from '../src/main/backend/files/filesResumableCopy'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })

describe('SFTP transfer endpoint', () => {
  it('uses offset reads and writes with exclusive temporary creation through the SFTP adapter', async () => {
    root = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-adapter-'))
    const source = join(root, 'source'); const target = join(root, 'target'); const temporary = `${target}.part`
    const payload = Buffer.alloc(700003, 41)
    await writeFile(source, payload)
    const handles = new Map<Buffer, Awaited<ReturnType<typeof open>>>()
    const writes: number[] = []
    const flags: string[] = []
    const callback = <T>(promise: Promise<T>, done: (error: unknown, value?: T) => void) => { void promise.then(value => done(null, value), done) }
    const sftp = {
      lstat: (path: string, done: any) => callback(lstat(path).then(stat => Object.assign(stat, { mtime: stat.mtimeMs / 1000 })), done),
      mkdir: (path: string, done: any) => callback(mkdir(path), done),
      open: (path: string, flag: string, done: any) => {
        flags.push(flag)
        callback(open(path, flag).then(handle => { const key = Buffer.from(String(handles.size)); handles.set(key, handle); return key }), done)
      },
      read: (handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, done: any) => callback(handles.get(handle)!.read(buffer, offset, length, position).then(result => result.bytesRead), done),
      write: (handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, done: any) => {
        writes.push(position); callback(handles.get(handle)!.write(buffer, offset, length, position), done)
      },
      close: (handle: Buffer, done: any) => callback(handles.get(handle)!.close(), done),
      chmod: (path: string, mode: number, done: any) => callback(chmod(path, mode), done),
      rename: (from: string, to: string, done: any) => callback(rename(from, to), done),
      ext_openssh_rename: (_from: string, _to: string, done: any) => done(Object.assign(new Error('Unsupported'), { code: 8 }))
    } as unknown as SFTPWrapper
    const local = localTransferEndpoint()
    await copyResumableEntry(local, remoteTransferEndpoint(sftp), { source, target, temporary, stat: (await local.stat(source))! }, true, { check() {}, save() {}, progress() {} })
    expect(await readFile(target)).toEqual(payload)
    expect(writes).toEqual([0, 262144, 524288])
    expect(flags).toContain('wx')
    expect(await local.stat(temporary)).toBeNull()
  })
  it('does not fall back or delete an original file when atomic rename fails with permission denied', async () => {
    const rename = vi.fn()
    const unlink = vi.fn()
    const endpoint = remoteTransferEndpoint({
      ext_openssh_rename: (_from: string, _to: string, done: any) => done(Object.assign(new Error('Permission denied'), { code: 3 })),
      rename, unlink
    } as unknown as SFTPWrapper)
    await expect(endpoint.rename('/tmp/part', '/data/original')).rejects.toThrow('Permission denied')
    expect(rename).not.toHaveBeenCalled(); expect(unlink).not.toHaveBeenCalled()
  })
})
