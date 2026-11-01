import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat, utimes, symlink, readlink, chmod } from 'fs/promises'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferEndpoint } from '../src/main/backend/files/filesTransferEndpoint'
import type { FileTransferTaskEvent } from '../src/shared/contracts/files'
const network = vi.hoisted(() => ({ endpoints: new Map<string, unknown>(), changed: false }))
vi.mock('../src/main/backend/files/filesSftpConnectionRuntime', () => ({
  resolveRemoteSftpTarget: (options: { sessionId: string }) => network.endpoints.has(options.sessionId)
    ? { assetId: options.sessionId, host: network.changed ? 'changed' : options.sessionId, username: 'test', port: 22 } : null,
  withRemoteSftp: (target: { assetId: string }, action: (endpoint: unknown) => unknown) => action(network.endpoints.get(target.assetId))
}))
vi.mock('../src/main/backend/files/filesTransferEndpoint', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/main/backend/files/filesTransferEndpoint')>()
  return { ...actual, remoteTransferEndpoint: (endpoint: TransferEndpoint) => endpoint }
})
import { localTransferEndpoint } from '../src/main/backend/files/filesTransferEndpoint'
import { configureFileTransferJobs, submitResumableFileTransfer, controlResumableFileTransfer, listResumableFileTransfers } from '../src/main/backend/files/filesTransferJobs'
import { resetFileTransferRuntimeForTests, setFileTransferTaskEventSender } from '../src/main/backend/files/filesTransferRuntime'

let root: string
let state: string
let source: string
let destination: string
let endpoint: TransferEndpoint
let events: FileTransferTaskEvent[]
const options = { kind: 'remote' as const, sessionId: 'host' }
const task = () => listResumableFileTransfers()[0]
const waitFinished = async () => {
  await vi.waitFor(() => expect(task().status).not.toBe('running'))
  return task()
}
const upload = () => submitResumableFileTransfer({ kind: 'upload-file', localPath: source, remoteDirectory: destination }, options)
const pauseAfterFirstWrite = (action: 'pause' | 'cancel' = 'pause') => {
  const original = endpoint.open
  let paused = false
  const positions: number[] = []
  endpoint.open = async (path, flags) => {
    const handle = await original(path, flags)
    const write = handle.write
    handle.write = async (buffer, position) => {
      positions.push(position)
      await write(buffer, position)
      if (!paused) {
        paused = true
        await controlResumableFileTransfer({ id: task().id, action })
        if (action === 'cancel') expect(await controlResumableFileTransfer({ id: task().id, action: 'pause' })).toMatchObject({ ok: false })
      }
    }
    return handle
  }
  return positions
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aiopsterm-resumable-'))
  state = join(root, 'state.json')
  source = join(root, 'source.bin'); destination = join(root, 'target')
  await mkdir(destination)
  await writeFile(source, Buffer.alloc(700_003, 73))
  network.changed = false
  endpoint = localTransferEndpoint()
  network.endpoints.set('host', endpoint)
  network.endpoints.set('source-host', localTransferEndpoint())
  events = []
  resetFileTransferRuntimeForTests()
  setFileTransferTaskEventSender(event => events.push(event))
  configureFileTransferJobs(state)
})
afterEach(async () => {
  configureFileTransferJobs()
  resetFileTransferRuntimeForTests()
  network.endpoints.clear()
  await rm(root, { recursive: true, force: true })
})

describe('resumable file transfers', () => {
  it('streams and verifies an upload and keeps its completed task', async () => {
    expect(await upload()).toMatchObject({ ok: true, data: { status: 'success', bytes: 700_003, files: 1 } })
    expect(await readFile(join(destination, 'source.bin'))).toEqual(await readFile(source))
    expect(task()).toMatchObject({ status: 'success', progress: 100, resumable: true })
    expect(events.at(-1)?.task.status).toBe('success')
    expect(await readdir(destination)).toEqual(['source.bin'])
  })
  it('resumes after pause and process reload without rewriting the verified prefix', async () => {
    const positions = pauseAfterFirstWrite()
    expect(await upload()).toMatchObject({ ok: true, data: { status: 'paused' } })
    const id = task().id
    const checkpoint = JSON.parse(await readFile(state, 'utf8'))
    checkpoint.jobs[0].task.status = 'running'
    await writeFile(state, JSON.stringify(checkpoint))
    configureFileTransferJobs(state)
    expect(task()).toMatchObject({ id, status: 'paused' })
    expect(await controlResumableFileTransfer({ id, action: 'resume' })).toMatchObject({ ok: true })
    expect(await waitFinished()).toMatchObject({ id, status: 'success' })
    expect(positions).toEqual([0, 262144, 524288])
    expect(await readFile(join(destination, 'source.bin'))).toEqual(await readFile(source))
  })
  it('rejects a changed source even when its size and mtime are unchanged', async () => {
    pauseAfterFirstWrite(); await upload()
    const saved = await stat(source)
    await writeFile(source, Buffer.alloc(saved.size, 90))
    await utimes(source, saved.atime, saved.mtime)
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'error', errorCode: 'source_changed' })
    expect(await readdir(destination)).not.toContain('source.bin')
  })
  it('rejects corrupt partial content instead of appending to it', async () => {
    pauseAfterFirstWrite(); await upload()
    const [partial] = await readdir(destination)
    await writeFile(join(destination, partial), Buffer.alloc(262144, 10))
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'error', errorCode: 'partial_changed' })
  })
  it('retains the old destination on a network failure and retries the incomplete file', async () => {
    await writeFile(join(destination, 'source.bin'), 'original')
    const original = endpoint.open
    let failed = false
    endpoint.open = async (path, flags) => {
      const handle = await original(path, flags); const write = handle.write
      handle.write = async (buffer, position) => {
        if (position > 0 && !failed) { failed = true; throw new Error('Connection lost') }
        await write(buffer, position)
      }
      return handle
    }
    expect(await upload()).toMatchObject({ ok: false })
    expect(await readFile(join(destination, 'source.bin'), 'utf8')).toBe('original')
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'success' })
    expect(await readFile(join(destination, 'source.bin'))).toEqual(await readFile(source))
  })
  it('does not overwrite a destination edited while paused', async () => {
    await writeFile(join(destination, 'source.bin'), 'original')
    pauseAfterFirstWrite(); await upload()
    await writeFile(join(destination, 'source.bin'), 'external modification')
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'error', errorCode: 'target_changed' })
    expect(await readFile(join(destination, 'source.bin'), 'utf8')).toBe('external modification')
  })
  it('retries a directory without writing completed files again and includes empty directories', async () => {
    const directory = join(root, 'folder')
    await mkdir(join(directory, 'empty'), { recursive: true })
    await writeFile(join(directory, 'a'), 'first')
    await writeFile(join(directory, 'b'), 'second')
    const opened: string[] = []
    const original = endpoint.open
    let failed = false
    endpoint.open = async (path, flags) => {
      if (flags === 'wx') {
        opened.push(path)
        if (path.includes('/b.aiopsterm-') && !failed) { failed = true; throw new Error('Connection lost') }
      }
      return original(path, flags)
    }
    expect(await submitResumableFileTransfer({ kind: 'upload-directory', localPath: directory, remoteDirectory: destination }, options)).toMatchObject({ ok: false })
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'success', finishedFiles: 2, totalFiles: 2 })
    expect(opened.filter(path => path.includes('/a.aiopsterm-'))).toHaveLength(1)
    expect(await readdir(join(destination, 'folder', 'empty'))).toEqual([])
    expect(await readFile(join(destination, 'folder', 'b'), 'utf8')).toBe('second')
  })
  it.each(['download-file', 'copy-remote'] as const)('uses the same verified engine for %s', async kind => {
    const targetPath = join(destination, 'result.bin')
    const result = await submitResumableFileTransfer(kind === 'download-file'
      ? { kind, remotePath: source, localPath: targetPath }
      : { kind, remotePath: source, targetPath, sourceOptions: { kind: 'remote', sessionId: 'source-host' } }, options)
    expect(result).toMatchObject({ ok: true, data: { status: 'success' } })
    expect(await readFile(targetPath)).toEqual(await readFile(source))
  })
  it('does not resume onto a changed host identity or store credentials', async () => {
    pauseAfterFirstWrite(); await upload()
    expect(await readFile(state, 'utf8')).not.toMatch(/password|privateKey|passphrase/)
    network.changed = true
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'error', errorCode: 'target_changed' })
  })
  it('rejects repeated resume while a transfer owns the running lease', async () => {
    pauseAfterFirstWrite(); await upload()
    const id = task().id
    const a = controlResumableFileTransfer({ id, action: 'resume' })
    const b = controlResumableFileTransfer({ id, action: 'resume' })
    expect(await a).toMatchObject({ ok: true }); expect(await b).toMatchObject({ ok: false })
    expect(await waitFinished()).toMatchObject({ status: 'success' })
  })
  it('keeps cancellation distinct from failure and removes owned temporary files', async () => {
    pauseAfterFirstWrite(); await upload()
    const id = task().id
    expect(await controlResumableFileTransfer({ id, action: 'cancel' })).toMatchObject({ ok: true })
    expect(task().status).toBe('cancelled')
    expect(await controlResumableFileTransfer({ id, action: 'resume' })).toMatchObject({ ok: false })
    expect(await controlResumableFileTransfer({ id, action: 'remove' })).toMatchObject({ ok: true, data: { removed: id } })
    expect(await readdir(destination)).toEqual([])
    expect(listResumableFileTransfers()).toEqual([])
  })
  it('does not discard a corrupt checkpoint or silently replace it with new jobs', async () => {
    await writeFile(state, '{broken')
    configureFileTransferJobs(state)
    expect(() => listResumableFileTransfers()).toThrow('传输记录读取失败')
    expect(await upload()).toMatchObject({ ok: false })
    expect(await readFile(state, 'utf8')).toBe('{broken')
  })
  it('does not resume or remove twice while temporary-file cleanup is pending', async () => {
    pauseAfterFirstWrite(); await upload()
    const id = task().id
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const unlink = endpoint.unlink
    endpoint.unlink = async path => { await gate; await unlink(path) }
    const removal = controlResumableFileTransfer({ id, action: 'remove' })
    expect(await controlResumableFileTransfer({ id, action: 'resume' })).toMatchObject({ ok: false })
    expect(await controlResumableFileTransfer({ id, action: 'remove' })).toMatchObject({ ok: false })
    release()
    expect(await removal).toMatchObject({ ok: true })
    expect(listResumableFileTransfers()).toEqual([])
  })
  it('retains a task when cleanup fails so cleanup can be retried', async () => {
    pauseAfterFirstWrite(); await upload()
    const id = task().id
    const unlink = endpoint.unlink
    endpoint.unlink = async () => { throw new Error('Connection lost') }
    expect(await controlResumableFileTransfer({ id, action: 'remove' })).toMatchObject({ ok: false })
    expect(task().id).toBe(id)
    endpoint.unlink = unlink
    expect(await controlResumableFileTransfer({ id, action: 'remove' })).toMatchObject({ ok: true })
  })
  it('does not start two jobs writing the same target', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const open = endpoint.open
    endpoint.open = async (path, flags) => { await gate; return open(path, flags) }
    const first = upload()
    expect(await upload()).toMatchObject({ ok: false, errorCode: 'target_busy' })
    release()
    expect(await first).toMatchObject({ ok: true })
    expect(listResumableFileTransfers().map(task => task.status)).toEqual(['success', 'paused'])
  })
  it('copies zero-byte files and symlinks without following their targets', async () => {
    const folder = join(root, 'folder')
    await mkdir(folder)
    await writeFile(join(folder, 'empty'), '')
    await symlink('../missing', join(folder, 'link'))
    expect(await submitResumableFileTransfer({ kind: 'upload-directory', localPath: folder, remoteDirectory: destination }, options)).toMatchObject({ ok: true, data: { files: 2 } })
    expect(await readFile(join(destination, 'folder', 'empty'), 'utf8')).toBe('')
    expect(await readlink(join(destination, 'folder', 'link'))).toBe('../missing')
  })
  it('recovers a rename committed before its completion checkpoint was saved', async () => {
    const rename = endpoint.rename
    let interrupted = false
    endpoint.rename = async (from, to) => {
      await rename(from, to)
      if (!interrupted) { interrupted = true; throw new Error('Interrupted after rename') }
    }
    expect(await upload()).toMatchObject({ ok: false })
    configureFileTransferJobs(state)
    await controlResumableFileTransfer({ id: task().id, action: 'resume' })
    expect(await waitFinished()).toMatchObject({ status: 'success' })
    expect(await readFile(join(destination, 'source.bin'))).toEqual(await readFile(source))
  })
  it('preserves existing destination permissions when replacing a file', async () => {
    await writeFile(join(destination, 'source.bin'), 'old')
    await chmod(join(destination, 'source.bin'), 0o640)
    await chmod(source, 0o755)
    expect(await upload()).toMatchObject({ ok: true })
    expect((await stat(join(destination, 'source.bin'))).mode & 0o777).toBe(0o640)
  })
  it('cancels an active transfer between chunks without committing a partial destination', async () => {
    const positions = pauseAfterFirstWrite('cancel')
    expect(await upload()).toMatchObject({ ok: true, data: { status: 'cancelled' } })
    expect(positions).toEqual([0])
    expect(await readdir(destination)).not.toContain('source.bin')
    expect(await controlResumableFileTransfer({ id: task().id, action: 'remove' })).toMatchObject({ ok: true })
    expect(await readdir(destination)).toEqual([])
  })
  it('enforces the retained-task limit without dropping existing records', async () => {
    pauseAfterFirstWrite(); await upload()
    const checkpoint = JSON.parse(await readFile(state, 'utf8'))
    const original = checkpoint.jobs[0]
    checkpoint.jobs = [original, ...Array.from({ length: 99 }, () => ({ ...original, entries: undefined, task: { ...original.task, id: `transfer-${randomUUID()}` } }))]
    await writeFile(state, JSON.stringify(checkpoint))
    configureFileTransferJobs(state)
    expect(listResumableFileTransfers()).toHaveLength(100)
    expect(await upload()).toMatchObject({ ok: false, errorCode: 'task_limit' })
    expect(listResumableFileTransfers()).toHaveLength(100)
  })
  it('rejects checkpoint entries escaping their target root', async () => {
    pauseAfterFirstWrite(); await upload()
    const checkpoint = JSON.parse(await readFile(state, 'utf8'))
    const job = checkpoint.jobs[0]
    job.entries[0].target = `${job.task.target}/../outside`
    job.entries[0].temporary = `${job.entries[0].target}.aiopsterm-${job.task.id}-0.part`
    await writeFile(state, JSON.stringify(checkpoint))
    configureFileTransferJobs(state)
    expect(() => listResumableFileTransfers()).toThrow('传输记录读取失败')
  })
  it('rejects empty paths before accessing the filesystem', async () => {
    expect(await submitResumableFileTransfer({ kind: 'upload-path', localPath: '', remoteDirectory: destination }, options)).toMatchObject({ ok: false, errorCode: 'invalid_path' })
    expect(listResumableFileTransfers()).toEqual([])
  })
})
