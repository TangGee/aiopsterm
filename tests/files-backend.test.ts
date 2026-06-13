import { generateKeyPairSync } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ssh2Mock = vi.hoisted(() => {
  type MockNode = {
    type: 'file' | 'directory' | 'link'
    content?: Buffer
    mode: number
    mtime: number
  }

  const nodes = new Map<string, MockNode>()
  const connectConfigs: Array<Record<string, unknown>> = []
  const calls: Array<Record<string, unknown>> = []
  const handles = new Map<number, { path: string; flags: string; closed: boolean; writes: Map<number, Buffer> }>()
  let nextHandle = 1
  const readFileDelays = new Map<
    string,
    Array<{
      released: Promise<void>
      release: () => void
      reached: Promise<void>
      markReached: () => void
    }>
  >()
  const writeFileDelays = new Map<
    string,
    Array<{
      released: Promise<void>
      release: () => void
      reached: Promise<void>
      markReached: () => void
    }>
  >()

  const normalize = (path: string) => {
    const normalized = String(path || '/')
      .trim()
      .replace(/\/+/g, '/')
    return normalized || '/'
  }

  const dirname = (path: string) => {
    const normalized = normalize(path)
    const index = normalized.lastIndexOf('/')
    return index <= 0 ? '/' : normalized.slice(0, index)
  }

  const basename = (path: string) => normalize(path).split('/').filter(Boolean).at(-1) || path

  const ensureDirectory = (path: string) => {
    const normalized = normalize(path)
    if (!nodes.has(normalized)) nodes.set(normalized, { type: 'directory', mode: 0o040755, mtime: 1_717_200_000 })
  }

  const putFile = (path: string, content: string, mode = 0o100644) => {
    const normalized = normalize(path)
    ensureDirectory(dirname(normalized))
    nodes.set(normalized, { type: 'file', content: Buffer.from(content, 'utf-8'), mode, mtime: 1_717_200_100 })
  }

  const missingError = (path: string) => Object.assign(new Error(`No such file ${path}`), { code: 2 })

  const attrsFor = (node: MockNode) => ({
    mode: node.mode,
    size: node.content?.length || 0,
    mtime: node.mtime,
    isDirectory: () => node.type === 'directory',
    isFile: () => node.type === 'file',
    isSymbolicLink: () => node.type === 'link'
  })

  const takeDelay = (
    delays: Map<
      string,
      Array<{
        released: Promise<void>
        release: () => void
        reached: Promise<void>
        markReached: () => void
      }>
    >,
    path: string
  ) => {
    const queue = delays.get(path)
    const delay = queue?.shift()
    if (queue && queue.length === 0) delays.delete(path)
    return delay
  }

  const sftp = {
    readdir(path: string, callback: (error: Error | null, entries?: Array<Record<string, unknown>>) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'readdir', path: normalized })
      const node = nodes.get(normalized)
      if (!node) {
        callback(missingError(normalized))
        return
      }
      if (node.type !== 'directory') {
        callback(Object.assign(new Error(`${normalized} is not a directory`), { code: 'ENOTDIR' }))
        return
      }
      const rows = [...nodes.entries()]
        .filter(([entryPath]) => entryPath !== normalized && dirname(entryPath) === normalized)
        .map(([entryPath, entryNode]) => ({
          filename: basename(entryPath),
          attrs: attrsFor(entryNode)
        }))
      callback(null, rows)
    },
    stat(path: string, callback: (error: Error | null, stats?: Record<string, unknown>) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'stat', path: normalized })
      const node = nodes.get(normalized)
      if (!node) {
        callback(missingError(normalized))
        return
      }
      callback(null, attrsFor(node))
    },
    readFile(path: string, callback: (error: Error | null, content?: Buffer) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'readFile', path: normalized })
      const complete = () => {
        const node = nodes.get(normalized)
        if (!node) {
          callback(missingError(normalized))
          return
        }
        if (node.type !== 'file') {
          callback(Object.assign(new Error(`${normalized} is not a file`), { code: 'EISDIR' }))
          return
        }
        callback(null, Buffer.from(node.content || Buffer.alloc(0)))
      }
      const delay = takeDelay(readFileDelays, normalized)
      if (!delay) {
        complete()
        return
      }
      delay.markReached()
      delay.released.then(() => {
        complete()
      })
    },
    writeFile(path: string, content: Buffer, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'writeFile', path: normalized, content: Buffer.from(content).toString('utf-8') })
      const complete = () => {
        if (!nodes.has(dirname(normalized))) {
          callback(missingError(dirname(normalized)))
          return
        }
        nodes.set(normalized, { type: 'file', content: Buffer.from(content), mode: 0o100644, mtime: 1_717_200_200 })
        callback(null)
      }
      const delay = takeDelay(writeFileDelays, normalized)
      if (!delay) {
        complete()
        return
      }
      delay.markReached()
      delay.released.then(() => {
        complete()
      })
    },
    open(path: string, flags: string, callback: (error: Error | null, handle?: number) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'open', path: normalized, flags })
      if (flags.includes('r')) {
        const node = nodes.get(normalized)
        if (!node) {
          callback(missingError(normalized))
          return
        }
        if (node.type !== 'file') {
          callback(Object.assign(new Error(`${normalized} is not a file`), { code: 'EISDIR' }))
          return
        }
      }
      if (flags.includes('w') && !nodes.has(dirname(normalized))) {
        callback(missingError(dirname(normalized)))
        return
      }
      const handle = nextHandle++
      handles.set(handle, { path: normalized, flags, closed: false, writes: new Map() })
      callback(null, handle)
    },
    read(handle: number, buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null, bytesRead?: number) => void) {
      const entry = handles.get(handle)
      const normalized = entry?.path || ''
      calls.push({ method: 'read', path: normalized, offset, length, position })
      const complete = () => {
        if (!entry || entry.closed) {
          callback(Object.assign(new Error('SFTP handle closed'), { code: 'HANDLE_CLOSED' }))
          return
        }
        const node = nodes.get(normalized)
        if (!node) {
          callback(missingError(normalized))
          return
        }
        if (node.type !== 'file') {
          callback(Object.assign(new Error(`${normalized} is not a file`), { code: 'EISDIR' }))
          return
        }
        const content = node.content || Buffer.alloc(0)
        const chunk = content.subarray(position, Math.min(content.length, position + length))
        chunk.copy(buffer, offset)
        callback(null, chunk.length)
      }
      const delay = takeDelay(readFileDelays, normalized)
      if (!delay) {
        complete()
        return
      }
      delay.markReached()
      delay.released.then(() => {
        complete()
      })
    },
    write(handle: number, buffer: Buffer, offset: number, length: number, position: number, callback: (error?: Error | null) => void) {
      const entry = handles.get(handle)
      const normalized = entry?.path || ''
      const content = Buffer.from(buffer.subarray(offset, offset + length))
      calls.push({ method: 'write', path: normalized, offset, length, position, content: content.toString('utf-8') })
      const complete = () => {
        if (!entry || entry.closed) {
          callback(Object.assign(new Error('SFTP handle closed'), { code: 'HANDLE_CLOSED' }))
          return
        }
        if (!nodes.has(dirname(normalized))) {
          callback(missingError(dirname(normalized)))
          return
        }
        entry.writes.set(position, content)
        callback(null)
      }
      const delay = takeDelay(writeFileDelays, normalized)
      if (!delay) {
        complete()
        return
      }
      delay.markReached()
      delay.released.then(() => {
        complete()
      })
    },
    close(handle: number, callback: (error?: Error | null) => void) {
      const entry = handles.get(handle)
      calls.push({ method: 'close', path: entry?.path || '' })
      if (!entry) {
        callback(null)
        return
      }
      if (!entry.closed && entry.flags.includes('w')) {
        const orderedWrites = [...entry.writes.entries()].sort(([left], [right]) => left - right)
        const totalBytes = orderedWrites.reduce((max, [position, chunk]) => Math.max(max, position + chunk.length), 0)
        const content = Buffer.alloc(totalBytes)
        orderedWrites.forEach(([position, chunk]) => chunk.copy(content, position))
        nodes.set(entry.path, { type: 'file', content, mode: 0o100644, mtime: 1_717_200_200 })
      }
      entry.closed = true
      handles.delete(handle)
      callback(null)
    },
    rename(oldPath: string, newPath: string, callback: (error?: Error | null) => void) {
      const normalizedOld = normalize(oldPath)
      const normalizedNew = normalize(newPath)
      calls.push({ method: 'rename', oldPath: normalizedOld, newPath: normalizedNew })
      const node = nodes.get(normalizedOld)
      if (!node) {
        callback(missingError(normalizedOld))
        return
      }
      if (!nodes.has(dirname(normalizedNew))) {
        callback(missingError(dirname(normalizedNew)))
        return
      }
      nodes.set(normalizedNew, { ...node, mtime: 1_717_200_300 })
      nodes.delete(normalizedOld)
      for (const [entryPath, entryNode] of [...nodes.entries()]) {
        if (!entryPath.startsWith(`${normalizedOld}/`)) continue
        nodes.set(entryPath.replace(normalizedOld, normalizedNew), { ...entryNode, mtime: 1_717_200_300 })
        nodes.delete(entryPath)
      }
      callback(null)
    },
    unlink(path: string, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'unlink', path: normalized })
      const node = nodes.get(normalized)
      if (!node) {
        callback(missingError(normalized))
        return
      }
      if (node.type === 'directory') {
        callback(Object.assign(new Error(`${normalized} is a directory`), { code: 'EISDIR' }))
        return
      }
      nodes.delete(normalized)
      callback(null)
    },
    rmdir(path: string, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'rmdir', path: normalized })
      const node = nodes.get(normalized)
      if (!node) {
        callback(missingError(normalized))
        return
      }
      if (node.type !== 'directory') {
        callback(Object.assign(new Error(`${normalized} is not a directory`), { code: 'ENOTDIR' }))
        return
      }
      if ([...nodes.keys()].some((entryPath) => dirname(entryPath) === normalized && entryPath !== normalized)) {
        callback(Object.assign(new Error(`${normalized} is not empty`), { code: 'ENOTEMPTY' }))
        return
      }
      if (normalized !== '/') nodes.delete(normalized)
      callback(null)
    },
    chmod(path: string, mode: number, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'chmod', path: normalized, mode })
      const node = nodes.get(normalized)
      if (!node) {
        callback(missingError(normalized))
        return
      }
      const typeMode = node.type === 'directory' ? 0o040000 : node.type === 'link' ? 0o120000 : 0o100000
      nodes.set(normalized, { ...node, mode: typeMode | (mode & 0o777), mtime: 1_717_200_300 })
      callback(null)
    },
    mkdir(path: string, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'mkdir', path: normalized })
      const parent = dirname(normalized)
      if (normalized !== '/' && !nodes.has(parent)) {
        callback(missingError(parent))
        return
      }
      if (!nodes.has(normalized)) nodes.set(normalized, { type: 'directory', mode: 0o040755, mtime: 1_717_200_200 })
      callback(null)
    }
  }

  class Client {
    private handlers = new Map<string, (...args: unknown[]) => void>()

    once(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler)
      return this
    }

    connect(config: Record<string, unknown>) {
      connectConfigs.push(config)
      queueMicrotask(() => this.handlers.get('ready')?.())
    }

    sftp(callback: (error: Error | null, wrapper?: typeof sftp) => void) {
      calls.push({ method: 'sftp' })
      callback(null, sftp)
    }

    end() {
      calls.push({ method: 'end' })
    }
  }

  const reset = () => {
    nodes.clear()
    handles.clear()
    nextHandle = 1
    connectConfigs.length = 0
    calls.length = 0
    readFileDelays.forEach((delays) => delays.forEach((delay) => delay.release()))
    readFileDelays.clear()
    writeFileDelays.forEach((delays) => delays.forEach((delay) => delay.release()))
    writeFileDelays.clear()
    ensureDirectory('/')
    ensureDirectory('/srv')
    ensureDirectory('/srv/logs')
    ensureDirectory('/srv/archive')
    putFile('/srv/note.txt', 'remote note from sftp\n')
    putFile('/srv/logs/app.log', 'hello log\n', 0o100600)
  }

  reset()

  return {
    Client,
    reset,
    pauseReadFile(path: string) {
      const normalized = normalize(path)
      let release!: () => void
      let markReached!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const reached = new Promise<void>((resolve) => {
        markReached = resolve
      })
      readFileDelays.set(normalized, [...(readFileDelays.get(normalized) || []), { released, release, reached, markReached }])
      return { release, reached }
    },
    pauseWriteFile(path: string) {
      const normalized = normalize(path)
      let release!: () => void
      let markReached!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const reached = new Promise<void>((resolve) => {
        markReached = resolve
      })
      writeFileDelays.set(normalized, [...(writeFileDelays.get(normalized) || []), { released, release, reached, markReached }])
      return { release, reached }
    },
    connectConfigs,
    calls,
    nodes
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-files-test'
  }
}))

vi.mock('electron-store', () => {
  const stores = new Map<string, Record<string, unknown>>()

  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { name?: string; defaults?: T }) {
      const name = options?.name || 'default'
      if (!stores.has(name)) stores.set(name, JSON.parse(JSON.stringify(options?.defaults || {})))
      this.store = stores.get(name) as T
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore, __resetMockStores: () => stores.clear() }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store files backend in tests')
})

vi.mock('../src/main/backend/ssh2Runtime', () => ({
  loadSsh2: () => ({ Client: ssh2Mock.Client })
}))

const sshProxyMock = vi.hoisted(() => {
  const sockets: Array<{ destroyed: boolean; destroy: () => void; id: string }> = []
  const calls: Array<Record<string, unknown>> = []

  const createSocket = (id: string) => {
    const socket = {
      id,
      destroyed: false,
      destroy() {
        socket.destroyed = true
      }
    }
    sockets.push(socket)
    return socket
  }

  return {
    sockets,
    calls,
    reset() {
      sockets.length = 0
      calls.length = 0
    },
    createSocket,
    async createSshProxySocketForAsset(asset: unknown, configs: unknown, host: string, port: number) {
      calls.push({ asset, configs, host, port })
      if (!(asset as { needProxy?: boolean } | null | undefined)?.needProxy) return null
      return {
        config: { name: (asset as { proxyName?: string }).proxyName || 'unit-proxy' },
        socket: createSocket(`proxy-${calls.length}`)
      }
    }
  }
})

vi.mock('../src/main/backend/sshProxy', () => ({
  createSshProxySocketForAsset: sshProxyMock.createSshProxySocketForAsset
}))

let readFileContent: (filePath: string, options?: Record<string, unknown>) => Promise<any>
let writeFileContent: (filePath: string, content: string, options?: Record<string, unknown>) => Promise<any>
let listFiles: (directory: string, options?: Record<string, unknown>) => Promise<any[]>
let mutateFileEntry: (mutation: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>
let transferFileEntry: (operation: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>
let listFileTransferTasks: () => Promise<any[]>
let cancelFileTransferTask: (input: Record<string, unknown>) => Promise<any>
let listFileSessionCatalog: () => Promise<any>
let saveFileSession: (session: Record<string, unknown>) => Promise<any>
let saveFileSessionFromSftpPayload: (payload: Record<string, unknown>) => Promise<any>
let saveFileSessionFromTerminalContext: (context: Record<string, unknown>) => Promise<any>
let updateFileSession: (id: string, patch: Record<string, unknown>) => Promise<any>
let deleteFileSession: (id: string) => Promise<any>
let saveFileSessionFolder: (folder: Record<string, unknown>) => Promise<any>
let deleteFileSessionFolder: (uuid: string) => Promise<any>
let resetFileSessionCatalog: () => void
let dropFileSessionCatalogCache: () => void
let getRemoteSftpPoolSnapshotForTests: () => { active: Array<{ key: string; refCount: number; closing: boolean; hasCloseTimer: boolean }>; pending: number }
let configureFilesBackendRuntime: (config?: {
  getConfig?: () => { sshProxyConfigs?: any[]; sshAgentKeys?: any[]; terminal?: any }
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sftpPoolIdleTtlMs?: number
}) => void
let configureAssetBackendRuntime: (config?: { useSeedData?: boolean; forceFallbackStore?: boolean }) => void
let resetMockStores: (() => void) | undefined
let saveAsset: (asset: any) => any
let saveKeychain: (keychain: any) => any
let filesBackendExports: Record<string, unknown>
const originalFilesSeedEnv = process.env.AIOPSTERM_FILES_ENABLE_SEED

const restoreFilesSeedEnv = () => {
  if (originalFilesSeedEnv === undefined) {
    delete process.env.AIOPSTERM_FILES_ENABLE_SEED
  } else {
    process.env.AIOPSTERM_FILES_ENABLE_SEED = originalFilesSeedEnv
  }
}

beforeAll(async () => {
  const storeModule = (await import('electron-store')) as unknown as { __resetMockStores?: () => void }
  resetMockStores = storeModule.__resetMockStores
  const modulePath = '../src/main/backend/files'
  const backend = await import(modulePath)
  filesBackendExports = backend as Record<string, unknown>
  readFileContent = backend.readFileContent
  writeFileContent = backend.writeFileContent
  listFiles = backend.listFiles
  mutateFileEntry = backend.mutateFileEntry
  transferFileEntry = backend.transferFileEntry
  listFileTransferTasks = backend.listFileTransferTasks
  cancelFileTransferTask = backend.cancelFileTransferTask
  listFileSessionCatalog = backend.listFileSessionCatalog
  saveFileSession = backend.saveFileSession
  saveFileSessionFromSftpPayload = backend.saveFileSessionFromSftpPayload
  saveFileSessionFromTerminalContext = backend.saveFileSessionFromTerminalContext
  updateFileSession = backend.updateFileSession
  deleteFileSession = backend.deleteFileSession
  saveFileSessionFolder = backend.saveFileSessionFolder
  deleteFileSessionFolder = backend.deleteFileSessionFolder
  resetFileSessionCatalog = backend.__resetFileSessionCatalogForTests
  dropFileSessionCatalogCache = backend.__dropFileSessionCatalogCacheForTests
  getRemoteSftpPoolSnapshotForTests = backend.__getRemoteSftpPoolSnapshotForTests
  configureFilesBackendRuntime = backend.configureFilesBackendRuntime
  const assetsModulePath = '../src/main/backend/assets'
  const assetsBackend = await import(assetsModulePath)
  configureAssetBackendRuntime = assetsBackend.configureAssetBackendRuntime
  saveAsset = assetsBackend.saveAsset
  saveKeychain = assetsBackend.saveKeychain
})

beforeEach(() => {
  resetMockStores?.()
  delete process.env.AIOPSTERM_FILES_ENABLE_SEED
  configureAssetBackendRuntime?.({ useSeedData: true, forceFallbackStore: true })
  configureFilesBackendRuntime?.({ useSeedData: true })
  resetFileSessionCatalog?.()
  ssh2Mock.reset()
  sshProxyMock.reset()
})

afterEach(() => {
  restoreFilesSeedEnv()
})

describe('files backend content boundary', () => {
  const saveSftpAsset = (patch: Record<string, unknown> = {}) => {
    const saved = saveAsset({
      id: 'asset-sftp-files-test',
      name: 'sftp-files-test',
      title: 'sftp-files-test',
      host: 'sftp.example.test',
      ip: 'sftp.example.test',
      group: '测试',
      group_name: '测试',
      status: 'online',
      username: 'ops',
      port: 7992,
      asset_type: 'person',
      auth_type: 'password',
      tags: ['sftp'],
      password: 'backend-secret',
      ...patch
    })
    expect(saved.ok).toBe(true)
    return saved.data.id
  }

  const createPrivateKey = () =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: {
        type: 'pkcs1',
        format: 'pem'
      },
      publicKeyEncoding: {
        type: 'pkcs1',
        format: 'pem'
      }
    }).privateKey

  it('loads and mutates file session catalog behind the main-process boundary', async () => {
    const initial = await listFileSessionCatalog()
    expect(initial.ok).toBe(true)
    expect(initial.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' }),
        expect.objectContaining({ id: 'asset-1', label: 'prod-bastion', host: '10.24.8.12' }),
        expect.objectContaining({ id: 'asset-3', folderUuid: 'custom-folder-a' })
      ])
    )
    expect(initial.data.folders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uuid: 'custom-folder-a', name: '核心业务' }),
        expect.objectContaining({ uuid: 'custom-folder-b', name: '临时排障' })
      ])
    )

    const savedFolder = await saveFileSessionFolder({ name: '发布窗口', description: '发布期文件入口' })
    expect(savedFolder.ok).toBe(true)
    expect(savedFolder.data.folder.uuid).toMatch(/^files-folder-/)
    expect(savedFolder.data.folders).toContainEqual(expect.objectContaining({ uuid: savedFolder.data.folder.uuid, name: '发布窗口' }))

    const ignoredClientUuid = await saveFileSessionFolder({ uuid: 'files-folder-client-draft', name: '客户端草稿', description: 'client draft' })
    expect(ignoredClientUuid.ok).toBe(true)
    expect(ignoredClientUuid.data.folder.uuid).toMatch(/^files-folder-/)
    expect(ignoredClientUuid.data.folder.uuid).not.toBe('files-folder-client-draft')

    const savedSession = await saveFileSession({
      id: 'asset-release',
      label: 'release-host',
      host: '10.24.10.11',
      group: '资产',
      kind: 'remote',
      rootPath: '/home/release',
      status: 'active',
      favorite: false,
      assetType: 'person'
    })
    expect(savedSession.ok).toBe(true)
    expect(savedSession.data.session).toEqual(expect.objectContaining({ id: 'asset-release', rootPath: '/home/release' }))

    const droppedSession = await saveFileSessionFromSftpPayload({
      uuid: 'asset-drop-backend',
      host: '10.55.0.9',
      title: 'drop-backend',
      username: 'ops',
      asset_type: 'person',
      comment: 'drag source'
    })
    expect(droppedSession.ok).toBe(true)
    expect(droppedSession.data.session).toEqual(
      expect.objectContaining({
        id: 'asset-drop-backend',
        label: 'drop-backend',
        host: '10.55.0.9',
        rootPath: '/home/ops',
        comment: 'drag source'
      })
    )
    await expect(saveFileSessionFromSftpPayload({ title: 'missing-host' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'FILES_SESSION_PAYLOAD_INVALID'
    })

    const localTerminalSession = await saveFileSessionFromTerminalContext({
      kind: 'local',
      panelTitle: 'zsh',
      panelStatus: 'running',
      sessionId: 'terminal-local-backend',
      cwd: '/home/unit'
    })
    expect(localTerminalSession.ok).toBe(true)
    expect(localTerminalSession.data.session).toEqual(expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/home/unit', status: 'active' }))

    const assetTerminalSession = await saveFileSessionFromTerminalContext({
      kind: 'ssh',
      panelTitle: 'client-title',
      panelStatus: 'closed',
      sessionId: 'terminal-asset-backend',
      cwd: '/tmp/current',
      ssh: {
        connectionId: 'ssh-terminal-asset-backend',
        assetId: 'asset-1',
        host: '10.8.0.9',
        username: 'client-user',
        assetName: 'client-label'
      }
    })
    expect(assetTerminalSession.ok).toBe(true)
    expect(assetTerminalSession.data.session).toEqual(
      expect.objectContaining({
        id: 'asset-1',
        label: 'prod-bastion',
        host: '10.24.8.12',
        group: '生产',
        rootPath: '/tmp/current',
        status: 'idle',
        favorite: true,
        assetType: 'person',
        folderUuid: 'custom-folder-a',
        comment: '生产入口'
      })
    )

    const ephemeralTerminalSession = await saveFileSessionFromTerminalContext({
      kind: 'ssh',
      panelTitle: 'ssh temp',
      panelStatus: 'running',
      sessionId: 'terminal-ephemeral-backend',
      cwd: '/home/temp',
      ssh: {
        connectionId: 'ssh-terminal-ephemeral-backend',
        host: '10.66.0.7',
        username: 'temp',
        assetName: 'temp-host',
        assetType: 'organization'
      }
    })
    expect(ephemeralTerminalSession.ok).toBe(true)
    expect(ephemeralTerminalSession.data.session).toEqual(
      expect.objectContaining({
        id: 'ssh-ssh-terminal-ephemeral-backend',
        label: 'temp-host',
        host: '10.66.0.7',
        group: '终端连接',
        rootPath: '/home/temp',
        assetType: 'organization',
        comment: 'Opened from ssh temp'
      })
    )
    await expect(saveFileSessionFromTerminalContext({ kind: 'ssh', panelTitle: 'missing-host' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'FILES_SESSION_TERMINAL_INVALID'
    })

    const movedSession = await updateFileSession('asset-release', { folderUuid: savedFolder.data.folder.uuid, group: '主机', comment: '发布入口' })
    expect(movedSession.ok).toBe(true)
    expect(movedSession.data.sessions).toContainEqual(
      expect.objectContaining({ id: 'asset-release', folderUuid: savedFolder.data.folder.uuid, group: '主机', comment: '发布入口' })
    )

    const deletedFolder = await deleteFileSessionFolder(savedFolder.data.folder.uuid)
    expect(deletedFolder.ok).toBe(true)
    expect(deletedFolder.data.folders).not.toContainEqual(expect.objectContaining({ uuid: savedFolder.data.folder.uuid }))
    expect(deletedFolder.data.sessions).toContainEqual(expect.objectContaining({ id: 'asset-release', group: '最近连接' }))
    expect(deletedFolder.data.sessions.find((session: any) => session.id === 'asset-release')?.folderUuid).toBeUndefined()

    await expect(deleteFileSession('local')).resolves.toMatchObject({
      ok: false,
      errorCode: 'FILES_SESSION_LOCAL_REQUIRED'
    })

    const deletedSession = await deleteFileSession('asset-release')
    expect(deletedSession.ok).toBe(true)
    expect(deletedSession.data.sessions.some((session: any) => session.id === 'asset-release')).toBe(false)
  })

  it('starts non-seed file session catalog from the backend asset source plus local session', async () => {
    configureFilesBackendRuntime({ useSeedData: false, forceFallbackStore: true })
    resetFileSessionCatalog()

    const catalog = await listFileSessionCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' }),
        expect.objectContaining({ id: 'asset-1', label: 'prod-bastion' }),
        expect.objectContaining({ id: 'asset-2', label: 'staging-api' })
      ])
    )
    expect(catalog.data.folders).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' })]))
  })

  it('does not infer file session seed mode from NODE_ENV test but still follows asset source rows', async () => {
    configureFilesBackendRuntime({ forceFallbackStore: true })
    resetFileSessionCatalog()

    const catalog = await listFileSessionCatalog()

    expect(process.env.NODE_ENV).toBe('test')
    expect(catalog.ok).toBe(true)
    expect(catalog.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' }),
        expect.objectContaining({ id: 'asset-1', label: 'prod-bastion' })
      ])
    )
    expect(catalog.data.folders).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' })]))
  })

  it('loads file session development seeds only when the seed environment switch is enabled', async () => {
    process.env.AIOPSTERM_FILES_ENABLE_SEED = '1'
    configureFilesBackendRuntime({ forceFallbackStore: true })
    resetFileSessionCatalog()

    const catalog = await listFileSessionCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'asset-1', label: 'prod-bastion' }),
        expect.objectContaining({ id: 'asset-2', label: 'staging-api' })
      ])
    )
    expect(catalog.data.folders).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' })]))
  })

  it('keeps development file session seeds available only when seed mode is enabled', async () => {
    configureFilesBackendRuntime({ useSeedData: true, forceFallbackStore: true })
    resetFileSessionCatalog()

    const catalog = await listFileSessionCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local', kind: 'local' }),
        expect.objectContaining({ id: 'asset-1', label: 'prod-bastion' }),
        expect.objectContaining({ id: 'asset-2', label: 'staging-api' })
      ])
    )
    expect(catalog.data.folders).toEqual(
      expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' }), expect.objectContaining({ uuid: 'custom-folder-b' })])
    )
  })

  it('strips unchanged legacy fallback file session seeds in non-seed runtime while preserving user edits', async () => {
    configureFilesBackendRuntime({ useSeedData: true, forceFallbackStore: true })
    resetFileSessionCatalog()
    const edited = await updateFileSession('asset-1', { label: 'user-owned-prod-files', rootPath: '/srv/user-owned', folderUuid: 'custom-folder-a' })
    expect(edited.ok).toBe(true)

    configureFilesBackendRuntime({ useSeedData: false, forceFallbackStore: true })
    const catalog = await listFileSessionCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local', kind: 'local' }),
        expect.objectContaining({ id: 'asset-1', label: 'prod-bastion', rootPath: '/srv/user-owned', folderUuid: 'custom-folder-a' })
      ])
    )
    expect(catalog.data.sessions).toContainEqual(expect.objectContaining({ id: 'asset-2', label: 'staging-api' }))
    expect(catalog.data.folders).toContainEqual(expect.objectContaining({ uuid: 'custom-folder-a' }))
    expect(catalog.data.folders).toContainEqual(expect.objectContaining({ uuid: 'custom-folder-b' }))
  })

  it('starts with only local when both file seeds and asset seeds are disabled', async () => {
    configureAssetBackendRuntime?.({ useSeedData: false, forceFallbackStore: true })
    configureFilesBackendRuntime({ useSeedData: false, forceFallbackStore: true })
    resetFileSessionCatalog()

    const catalog = await listFileSessionCatalog()

    expect(catalog.ok).toBe(true)
    expect(catalog.data.sessions).toEqual([expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' })])
    expect(catalog.data.folders).toEqual([])
  })

  it('persists file session catalog mutations behind the backend store', async () => {
    const savedFolder = await saveFileSessionFolder({ name: '持久化窗口', description: 'reload boundary' })
    expect(savedFolder.ok).toBe(true)

    const savedSession = await saveFileSession({
      id: 'asset-persisted',
      label: 'persisted-host',
      host: '10.24.20.31',
      group: '资产',
      kind: 'remote',
      rootPath: '/srv/persisted',
      status: 'active',
      favorite: true,
      assetType: 'person',
      folderUuid: savedFolder.data.folder.uuid,
      comment: 'stored outside process cache'
    })
    expect(savedSession.ok).toBe(true)

    dropFileSessionCatalogCache()
    const reloaded = await listFileSessionCatalog()
    expect(reloaded.ok).toBe(true)
    expect(reloaded.data.folders).toContainEqual(
      expect.objectContaining({ uuid: savedFolder.data.folder.uuid, name: '持久化窗口', description: 'reload boundary' })
    )
    expect(reloaded.data.sessions).toContainEqual(
      expect.objectContaining({
        id: 'asset-persisted',
        label: 'persisted-host',
        host: '10.24.20.31',
        rootPath: '/srv/persisted',
        folderUuid: savedFolder.data.folder.uuid,
        comment: 'stored outside process cache'
      })
    )

    const deleted = await deleteFileSession('asset-persisted')
    expect(deleted.ok).toBe(true)
    dropFileSessionCatalogCache()
    const afterDelete = await listFileSessionCatalog()
    expect(afterDelete.data.sessions.some((session: any) => session.id === 'asset-persisted')).toBe(false)
  })

  it('starts with an empty transfer task snapshot until runtime transfers report progress', async () => {
    await expect(listFileTransferTasks()).resolves.toEqual([])
  })

  it('does not expose a manual transfer-task recorder at the backend boundary', async () => {
    expect(filesBackendExports.recordFileTransferTask).toBeUndefined()
    await expect(listFileTransferTasks()).resolves.toEqual([])
    await expect(cancelFileTransferTask({ id: 'client-transfer-draft' })).resolves.toMatchObject({
      ok: true,
      data: { id: 'client-transfer-draft', taskIds: [], status: 'not_found' }
    })
  })

  it('fails closed for credentialless remote sessions instead of returning seeded remote files', async () => {
    const originalAgent = process.env.SSH_AUTH_SOCK
    const originalFilesAgent = process.env.AIOPSTERM_FILES_SFTP_AGENT
    process.env.SSH_AUTH_SOCK = '/tmp/aiopsterm-test-agent.sock'
    delete process.env.AIOPSTERM_FILES_SFTP_AGENT
    try {
      await expect(listFiles('/home/deploy', { kind: 'remote', sessionId: 'asset-1', host: 'prod-bastion' })).rejects.toThrow(
        'SFTP connection is unavailable for this file session.'
      )
      await expect(readFileContent('/home/deploy/release-note.md', { kind: 'remote', sessionId: 'asset-1', host: 'prod-bastion' })).resolves.toEqual({
        ok: false,
        errorCode: 'FILES_SFTP_UNAVAILABLE',
        errorMessage: 'SFTP connection is unavailable for this file session.'
      })
      await expect(writeFileContent('/home/deploy/new.txt', 'must not persist\n', { kind: 'remote', sessionId: 'asset-1', host: 'prod-bastion' })).resolves.toEqual({
        ok: false,
        errorCode: 'FILES_SFTP_UNAVAILABLE',
        errorMessage: 'SFTP connection is unavailable for this file session.'
      })
      expect(ssh2Mock.connectConfigs).toEqual([])
    } finally {
      if (originalAgent === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = originalAgent
      if (originalFilesAgent === undefined) delete process.env.AIOPSTERM_FILES_SFTP_AGENT
      else process.env.AIOPSTERM_FILES_SFTP_AGENT = originalFilesAgent
    }
  })

  it('lists, reads, and writes remote files through asset-backed SFTP credentials', async () => {
    const sessionId = saveSftpAsset()

    const rows = await listFiles('/srv', { kind: 'remote', sessionId, host: 'client-host-ignored' })
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '..', path: '/', type: 'directory' }),
      expect.objectContaining({ name: 'archive', path: '/srv/archive', type: 'directory', mode: 'd755' }),
      expect.objectContaining({ name: 'logs', path: '/srv/logs', type: 'directory', mode: 'd755' }),
      expect.objectContaining({ name: 'note.txt', path: '/srv/note.txt', type: 'file', size: 22, mode: '-644' })
    ]))

    const read = await readFileContent('/srv/note.txt', { kind: 'remote', sessionId })
    expect(read).toEqual({
      ok: true,
      data: expect.objectContaining({
        action: 'edit',
        content: 'remote note from sftp\n',
        size: 22
      })
    })

    const written = await writeFileContent('/srv/releases/new.txt', 'created on sftp\n', { kind: 'remote', sessionId, host: 'ui-host' })
    expect(written.ok).toBe(true)
    expect(written.data).toEqual(
      expect.objectContaining({
        size: 16,
        task: expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'r2r',
          name: 'save new.txt',
          source: '/srv/releases/new.txt',
          target: '/srv/releases/new.txt',
          fromHost: 'ui-host',
          toHost: 'ui-host',
          speed: '已保存',
          status: 'success'
        })
      })
    )
    expect(ssh2Mock.nodes.get('/srv/releases/new.txt')?.content?.toString('utf-8')).toBe('created on sftp\n')
    expect(ssh2Mock.connectConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: 'sftp.example.test',
          port: 7992,
          username: 'ops',
          password: 'backend-secret'
        })
      ])
    )
    expect(ssh2Mock.connectConfigs.some((config) => config.host === 'client-host-ignored')).toBe(false)
    expect(ssh2Mock.calls).toEqual(
      expect.arrayContaining([
        { method: 'readdir', path: '/srv' },
        { method: 'readFile', path: '/srv/note.txt' },
        { method: 'mkdir', path: '/srv/releases' },
        { method: 'writeFile', path: '/srv/releases/new.txt', content: 'created on sftp\n' }
      ])
    )
  })

  it('rejects stale remote editor saves before overwriting SFTP content', async () => {
    const sessionId = saveSftpAsset()
    const read = await readFileContent('/srv/note.txt', { kind: 'remote', sessionId, host: 'ui-host' })
    expect(read.ok).toBe(true)
    const openedVersion = read.data!

    ssh2Mock.nodes.set('/srv/note.txt', {
      type: 'file',
      content: Buffer.from('remote note changed elsewhere\n', 'utf-8'),
      mode: 0o100644,
      mtime: 1_717_200_250
    })
    ssh2Mock.calls.length = 0

    const staleSave = await writeFileContent('/srv/note.txt', 'editor stale write\n', {
      kind: 'remote',
      sessionId,
      host: 'ui-host',
      expectedAction: openedVersion.action,
      expectedMtimeMs: openedVersion.mtimeMs,
      expectedSize: openedVersion.size
    })

    expect(staleSave).toMatchObject({
      ok: false,
      errorCode: 'conflict',
      errorMessage: 'File changed on disk. Reload before saving.'
    })
    expect(ssh2Mock.calls).toEqual(expect.arrayContaining([{ method: 'stat', path: '/srv/note.txt' }]))
    expect(ssh2Mock.calls.some((call) => call.method === 'writeFile')).toBe(false)
    expect(ssh2Mock.nodes.get('/srv/note.txt')?.content?.toString('utf-8')).toBe('remote note changed elsewhere\n')
  })

  it('allows remote editor saves when the opened SFTP file version still matches', async () => {
    const sessionId = saveSftpAsset()
    const read = await readFileContent('/srv/note.txt', { kind: 'remote', sessionId, host: 'ui-host' })
    expect(read.ok).toBe(true)
    const openedVersion = read.data!

    const saved = await writeFileContent('/srv/note.txt', 'fresh editor write\n', {
      kind: 'remote',
      sessionId,
      host: 'ui-host',
      expectedAction: openedVersion.action,
      expectedMtimeMs: openedVersion.mtimeMs,
      expectedSize: openedVersion.size
    })

    expect(saved.ok).toBe(true)
    expect(ssh2Mock.nodes.get('/srv/note.txt')?.content?.toString('utf-8')).toBe('fresh editor write\n')
  })

  it('reuses pooled SFTP connections across sequential operations for the same asset', async () => {
    configureFilesBackendRuntime({ sftpPoolIdleTtlMs: 60_000 })
    resetFileSessionCatalog()
    const sessionId = saveSftpAsset()

    const rows = await listFiles('/srv', { kind: 'remote', sessionId, host: 'client-host-ignored' })
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['archive', 'logs', 'note.txt']))
    const read = await readFileContent('/srv/note.txt', { kind: 'remote', sessionId })
    expect(read.ok).toBe(true)
    const written = await writeFileContent('/srv/releases/pooled.txt', 'pooled write\n', { kind: 'remote', sessionId, host: 'ui-host' })
    expect(written.ok).toBe(true)
    const renamed = await mutateFileEntry({ kind: 'rename', oldPath: '/srv/releases/pooled.txt', newPath: '/srv/releases/renamed-pooled.txt' }, { kind: 'remote', sessionId })
    expect(renamed.ok).toBe(true)

    expect(ssh2Mock.connectConfigs).toHaveLength(1)
    expect(ssh2Mock.calls.filter((call) => call.method === 'sftp')).toHaveLength(1)
    expect(ssh2Mock.calls.filter((call) => call.method === 'end')).toHaveLength(0)
    expect(getRemoteSftpPoolSnapshotForTests()).toMatchObject({
      active: [expect.objectContaining({ refCount: 0, closing: false, hasCloseTimer: true })],
      pending: 0
    })
  })

  it('clears pooled SFTP connections when runtime configuration is reloaded', async () => {
    configureFilesBackendRuntime({ sftpPoolIdleTtlMs: 60_000 })
    resetFileSessionCatalog()
    const sessionId = saveSftpAsset()
    await listFiles('/srv', { kind: 'remote', sessionId })
    expect(getRemoteSftpPoolSnapshotForTests().active).toHaveLength(1)

    configureFilesBackendRuntime({ sftpPoolIdleTtlMs: 60_000 })

    expect(getRemoteSftpPoolSnapshotForTests()).toEqual({ active: [], pending: 0 })
    expect(ssh2Mock.calls.filter((call) => call.method === 'end')).toHaveLength(1)
  })

  it('routes asset-backed SFTP connections through configured SSH proxies', async () => {
    configureFilesBackendRuntime({
      sftpPoolIdleTtlMs: 0,
      getConfig: () => ({
        sshProxyConfigs: [
          {
            name: 'release-proxy',
            type: 'SOCKS5',
            host: '127.0.0.1',
            port: 1080,
            enableProxyIdentity: false,
            username: '',
            password: ''
          }
        ]
      })
    })
    const sessionId = saveSftpAsset({ needProxy: true, proxyName: 'release-proxy' })

    const rows = await listFiles('/srv', { kind: 'remote', sessionId, host: 'client-host-ignored' })

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['archive', 'logs', 'note.txt']))
    expect(sshProxyMock.calls).toEqual([
      {
        asset: {
          needProxy: true,
          proxyName: 'release-proxy'
        },
        configs: [
          {
            name: 'release-proxy',
            type: 'SOCKS5',
            host: '127.0.0.1',
            port: 1080,
            enableProxyIdentity: false,
            username: '',
            password: ''
          }
        ],
        host: 'sftp.example.test',
        port: 7992
      }
    ])
    expect(ssh2Mock.connectConfigs).toEqual([
      expect.objectContaining({
        username: 'ops',
        password: 'backend-secret',
        sock: sshProxyMock.sockets[0]
      })
    ])
    expect(ssh2Mock.connectConfigs[0]).not.toHaveProperty('host')
    expect(ssh2Mock.connectConfigs[0]).not.toHaveProperty('port')
    expect(sshProxyMock.sockets[0].destroyed).toBe(true)
  })

  it('authenticates asset-backed SFTP through configured SSH Agent keychains', async () => {
    const privateKey = createPrivateKey()
    const savedKeychain = saveKeychain({
      id: 'key-files-agent-test',
      name: 'files-agent-test',
      type: 'rsa',
      publicKey: '',
      privateKey
    })
    expect(savedKeychain.ok).toBe(true)
    configureFilesBackendRuntime({
      getConfig: () => ({
        sshProxyConfigs: [],
        terminal: { sshAgentsStatus: true },
        sshAgentKeys: [
          {
            id: 'key-files-agent-test',
            keyChainId: 'key-files-agent-test',
            fingerprint: 'SHA256:files-agent',
            comment: 'files-agent-test',
            keyType: 'RSA'
          }
        ]
      })
    })
    const saved = saveAsset({
      id: 'asset-sftp-files-agent-test',
      name: 'sftp-files-agent-test',
      title: 'sftp-files-agent-test',
      host: 'agent-sftp.example.test',
      ip: 'agent-sftp.example.test',
      group: '测试',
      group_name: '测试',
      status: 'online',
      username: 'ops',
      port: 7992,
      asset_type: 'person',
      auth_type: 'keyBased',
      tags: ['sftp', 'agent']
    })
    expect(saved.ok).toBe(true)

    const rows = await listFiles('/srv', { kind: 'remote', sessionId: saved.data.id, host: 'client-host-ignored' })

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['archive', 'logs', 'note.txt']))
    expect(ssh2Mock.connectConfigs).toEqual([
      expect.objectContaining({
        host: 'agent-sftp.example.test',
        port: 7992,
        username: 'ops',
        agent: expect.objectContaining({
          getIdentities: expect.any(Function),
          sign: expect.any(Function),
          getStream: expect.any(Function)
        })
      })
    ])
    expect(ssh2Mock.connectConfigs[0]).not.toHaveProperty('password')
    expect(ssh2Mock.connectConfigs[0]).not.toHaveProperty('privateKey')
    expect(ssh2Mock.connectConfigs[0]).not.toHaveProperty('agentForward')
  })

  it('returns backend errors instead of seed fallback when asset-backed SFTP fails', async () => {
    const sessionId = saveSftpAsset()

    await expect(listFiles('/missing', { kind: 'remote', sessionId })).rejects.toThrow('No such file /missing')

    const read = await readFileContent('/srv/unknown.txt', { kind: 'remote', sessionId })
    expect(read).toMatchObject({ ok: true, data: { action: 'create', content: '' } })
    expect(ssh2Mock.calls).toEqual(expect.arrayContaining([{ method: 'stat', path: '/srv/unknown.txt' }]))
  })

  it('mutates remote entries through asset-backed SFTP operations', async () => {
    const sessionId = saveSftpAsset()

    const renamed = await mutateFileEntry({ kind: 'rename', oldPath: '/srv/note.txt', newPath: '/srv/renamed.txt' }, { kind: 'remote', sessionId })
    expect(renamed.ok).toBe(true)
    expect(ssh2Mock.nodes.has('/srv/note.txt')).toBe(false)
    expect(ssh2Mock.nodes.get('/srv/renamed.txt')?.content?.toString('utf-8')).toBe('remote note from sftp\n')

    const chmodded = await mutateFileEntry({ kind: 'chmod', path: '/srv/renamed.txt', mode: '600' }, { kind: 'remote', sessionId, host: 'sftp-ui' })
    expect(chmodded.ok).toBe(true)
    expect(chmodded.data).toEqual(
      expect.objectContaining({
        mode: '600',
        task: expect.objectContaining({
          type: 'r2r',
          name: 'chmod renamed.txt',
          source: '/srv/renamed.txt',
          target: 'permissions',
          fromHost: 'sftp-ui',
          toHost: 'sftp-ui',
          status: 'success'
        })
      })
    )
    expect(ssh2Mock.nodes.get('/srv/renamed.txt')?.mode).toBe(0o100600)

    const copied = await mutateFileEntry({ kind: 'copy', srcPath: '/srv/renamed.txt', targetPath: '/srv/archive/copied.txt' }, { kind: 'remote', sessionId })
    expect(copied.ok).toBe(true)
    expect(ssh2Mock.nodes.get('/srv/archive/copied.txt')?.content?.toString('utf-8')).toBe('remote note from sftp\n')

    const moved = await mutateFileEntry({ kind: 'move', srcPath: '/srv/renamed.txt', targetPath: '/srv/archive/moved.txt' }, { kind: 'remote', sessionId })
    expect(moved.ok).toBe(true)
    expect(ssh2Mock.nodes.has('/srv/renamed.txt')).toBe(false)
    expect(ssh2Mock.nodes.get('/srv/archive/moved.txt')?.content?.toString('utf-8')).toBe('remote note from sftp\n')

    const deleted = await mutateFileEntry({ kind: 'delete', path: '/srv/archive/copied.txt' }, { kind: 'remote', sessionId })
    expect(deleted.ok).toBe(true)
    expect(deleted.data.task).toEqual(
      expect.objectContaining({
        type: 'r2r',
        name: 'delete copied.txt',
        source: '/srv/archive/copied.txt',
        target: '/srv/archive',
        status: 'success'
      })
    )
    expect(ssh2Mock.nodes.has('/srv/archive/copied.txt')).toBe(false)
    expect(ssh2Mock.calls).toEqual(
      expect.arrayContaining([
        { method: 'rename', oldPath: '/srv/note.txt', newPath: '/srv/renamed.txt' },
        { method: 'chmod', path: '/srv/renamed.txt', mode: 0o600 },
        { method: 'readFile', path: '/srv/renamed.txt' },
        { method: 'writeFile', path: '/srv/archive/copied.txt', content: 'remote note from sftp\n' },
        { method: 'rename', oldPath: '/srv/renamed.txt', newPath: '/srv/archive/moved.txt' },
        { method: 'unlink', path: '/srv/archive/copied.txt' }
      ])
    )
  })

  it('copies remote transfer entries through asset-backed SFTP operations', async () => {
    const sessionId = saveSftpAsset()

    const copied = await transferFileEntry(
      { kind: 'copy-remote', remotePath: '/srv/logs/app.log', targetPath: '/srv/archive/app-copy.log' },
      { kind: 'remote', sessionId, fromHost: 'sftp-source', toHost: 'sftp-target' }
    )
    expect(copied.ok).toBe(true)
    expect(copied.data).toEqual(
      expect.objectContaining({
        status: 'success',
        source: '/srv/logs/app.log',
        target: '/srv/archive/app-copy.log',
        bytes: 10,
        files: 1,
        task: expect.objectContaining({
          type: 'r2r',
          name: 'app.log',
          source: '/srv/logs/app.log',
          target: '/srv/archive/app-copy.log',
          fromHost: 'sftp-source',
          toHost: 'sftp-target',
          status: 'success'
        })
      })
    )
    expect(ssh2Mock.nodes.get('/srv/archive/app-copy.log')?.content?.toString('utf-8')).toBe('hello log\n')
    expect(ssh2Mock.calls).toEqual(
      expect.arrayContaining([
        { method: 'readFile', path: '/srv/logs/app.log' },
        { method: 'writeFile', path: '/srv/archive/app-copy.log', content: 'hello log\n' }
      ])
    )
    expect(ssh2Mock.calls.filter((call) => call.method === 'readFile' && call.path === '/srv/archive/app-copy.log')).toHaveLength(0)
  })

  it('accounts asset-backed remote copy bytes without reading copied content as text', async () => {
    const sessionId = saveSftpAsset()
    const binary = Buffer.from([255, 128, 0, 65, 10])
    ssh2Mock.nodes.set('/srv/archive/source.bin', { type: 'file', content: binary, mode: 0o100600, mtime: 1_717_200_400 })

    const copied = await transferFileEntry(
      { kind: 'copy-remote', remotePath: '/srv/archive/source.bin', targetPath: '/srv/archive/copied.bin' },
      { kind: 'remote', sessionId, fromHost: 'sftp-source', toHost: 'sftp-target' }
    )

    expect(copied.ok).toBe(true)
    expect(copied.data).toEqual(
      expect.objectContaining({
        status: 'success',
        source: '/srv/archive/source.bin',
        target: '/srv/archive/copied.bin',
        bytes: binary.length,
        files: 1,
        itemKind: 'file',
        task: expect.objectContaining({
          type: 'r2r',
          name: 'source.bin',
          source: '/srv/archive/source.bin',
          target: '/srv/archive/copied.bin',
          fromHost: 'sftp-source',
          toHost: 'sftp-target',
          status: 'success'
        })
      })
    )
    expect(ssh2Mock.nodes.get('/srv/archive/copied.bin')?.content).toEqual(binary)
    expect(ssh2Mock.calls.filter((call) => call.method === 'readFile' && call.path === '/srv/archive/copied.bin')).toHaveLength(0)
  })

  it('accounts asset-backed remote directory copies from SFTP stats', async () => {
    const sessionId = saveSftpAsset()
    const nestedBytes = Buffer.from([0, 1, 2, 255])
    ssh2Mock.nodes.set('/srv/logs/nested', { type: 'directory', mode: 0o040755, mtime: 1_717_200_400 })
    ssh2Mock.nodes.set('/srv/logs/nested/trace.bin', { type: 'file', content: nestedBytes, mode: 0o100600, mtime: 1_717_200_400 })

    const copied = await transferFileEntry(
      { kind: 'copy-remote', remotePath: '/srv/logs', targetPath: '/srv/archive/logs-copy' },
      { kind: 'remote', sessionId, fromHost: 'sftp-source', toHost: 'sftp-target' }
    )

    expect(copied.ok).toBe(true)
    expect(copied.data).toEqual(
      expect.objectContaining({
        status: 'success',
        source: '/srv/logs',
        target: '/srv/archive/logs-copy',
        bytes: 14,
        files: 2,
        itemKind: 'directory',
        task: expect.objectContaining({
          type: 'r2r',
          name: 'logs',
          source: '/srv/logs',
          target: '/srv/archive/logs-copy',
          stage: 'scanning',
          isGroup: true,
          totalFiles: 2,
          finishedFiles: 2,
          fromHost: 'sftp-source',
          toHost: 'sftp-target',
          status: 'success',
          children: expect.arrayContaining([
            expect.objectContaining({ type: 'r2r', name: 'app.log', source: '/srv/logs/app.log', target: '/srv/archive/logs-copy/app.log' }),
            expect.objectContaining({ type: 'r2r', name: 'trace.bin', source: '/srv/logs/nested/trace.bin', target: '/srv/archive/logs-copy/nested/trace.bin' })
          ])
        })
      })
    )
    expect(ssh2Mock.nodes.get('/srv/archive/logs-copy')?.type).toBe('directory')
    expect(ssh2Mock.nodes.get('/srv/archive/logs-copy/app.log')?.content?.toString('utf-8')).toBe('hello log\n')
    expect(ssh2Mock.nodes.get('/srv/archive/logs-copy/nested/trace.bin')?.content).toEqual(nestedBytes)
    expect(ssh2Mock.calls.filter((call) => call.method === 'readFile' && call.path === '/srv/archive/logs-copy')).toHaveLength(0)
  })

  it('uploads and downloads asset-backed remote transfer entries through binary-safe SFTP operations', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-binary-transfer-'))
    const localUpload = join(dir, 'binary.bin')
    const localDownload = join(dir, 'downloaded.bin')
    const uploadBytes = Buffer.from([0, 1, 2, 3, 127, 128, 255])
    const downloadBytes = Buffer.from([255, 128, 0, 65, 10])
    try {
      await writeFile(localUpload, uploadBytes)
      ssh2Mock.nodes.set('/srv/archive/remote.bin', { type: 'file', content: downloadBytes, mode: 0o100600, mtime: 1_717_200_400 })

      const uploaded = await transferFileEntry(
        { kind: 'upload-file', localPath: localUpload, remoteDirectory: '/srv/archive' },
        { kind: 'remote', sessionId, fromHost: '127.0.0.1', toHost: 'sftp.example.test' }
      )
      expect(uploaded.ok).toBe(true)
      expect(uploaded.data).toEqual(
        expect.objectContaining({
          status: 'success',
          source: localUpload,
          target: '/srv/archive/binary.bin',
          bytes: uploadBytes.length,
          files: 1,
          itemKind: 'file',
          task: expect.objectContaining({
            type: 'upload',
            name: 'binary.bin',
            source: localUpload,
            target: '/srv/archive/binary.bin',
            fromHost: '127.0.0.1',
            toHost: 'sftp.example.test',
            stage: 'pending',
            status: 'success'
          })
        })
      )
      expect(ssh2Mock.nodes.get('/srv/archive/binary.bin')?.content).toEqual(uploadBytes)

      const downloaded = await transferFileEntry(
        { kind: 'download-file', remotePath: '/srv/archive/remote.bin', localPath: localDownload },
        { kind: 'remote', sessionId, fromHost: 'sftp.example.test', toHost: '127.0.0.1' }
      )
      expect(downloaded.ok).toBe(true)
      expect(downloaded.data).toEqual(
        expect.objectContaining({
          status: 'success',
          source: '/srv/archive/remote.bin',
          target: localDownload,
          bytes: downloadBytes.length,
          files: 1,
          itemKind: 'file',
          task: expect.objectContaining({
            type: 'download',
            name: 'remote.bin',
            source: '/srv/archive/remote.bin',
            target: localDownload,
            fromHost: 'sftp.example.test',
            toHost: '127.0.0.1',
            status: 'success'
          })
        })
      )
      expect(await readFile(localDownload)).toEqual(downloadBytes)
      expect(ssh2Mock.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'open', path: '/srv/archive/binary.bin', flags: 'w' }),
          expect.objectContaining({ method: 'write', path: '/srv/archive/binary.bin', content: uploadBytes.toString('utf-8') }),
          expect.objectContaining({ method: 'open', path: '/srv/archive/remote.bin', flags: 'r' }),
          expect.objectContaining({ method: 'read', path: '/srv/archive/remote.bin' })
        ])
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes byte-level running progress for asset-backed single-file downloads', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-file-download-progress-'))
    const localDownload = join(dir, 'large.bin')
    const downloadBytes = Buffer.alloc(128 * 1024, 7)
    const firstPausedRead = ssh2Mock.pauseReadFile('/srv/archive/large.bin')
    const secondPausedRead = ssh2Mock.pauseReadFile('/srv/archive/large.bin')
    try {
      ssh2Mock.nodes.set('/srv/archive/large.bin', { type: 'file', content: downloadBytes, mode: 0o100600, mtime: 1_717_200_400 })

      const transferPromise = transferFileEntry(
        { kind: 'download-file', remotePath: '/srv/archive/large.bin', localPath: localDownload },
        { kind: 'remote', sessionId, fromHost: 'sftp.example.test', toHost: '127.0.0.1' }
      )

      await firstPausedRead.reached
      let activeTasks = await listFileTransferTasks()
      expect(activeTasks[0]).toEqual(
        expect.objectContaining({
          type: 'download',
          progress: 0,
          speed: 'pending',
          status: 'running'
        })
      )

      firstPausedRead.release()
      await secondPausedRead.reached
      activeTasks = await listFileTransferTasks()
      expect(activeTasks[0]).toEqual(
        expect.objectContaining({
          type: 'download',
          progress: 50,
          speed: '下载中 64 KB / 128 KB',
          status: 'running'
        })
      )

      secondPausedRead.release()
      const downloaded = await transferPromise
      expect(downloaded.ok).toBe(true)
      expect(downloaded.data).toEqual(expect.objectContaining({ status: 'success', bytes: downloadBytes.length }))
      expect(await readFile(localDownload)).toEqual(downloadBytes)
    } finally {
      firstPausedRead.release()
      secondPausedRead.release()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes byte-level running progress for asset-backed single-file uploads', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-file-upload-progress-'))
    const localUpload = join(dir, 'large-upload.bin')
    const uploadBytes = Buffer.alloc(128 * 1024, 9)
    const firstPausedWrite = ssh2Mock.pauseWriteFile('/srv/archive/large-upload.bin')
    const secondPausedWrite = ssh2Mock.pauseWriteFile('/srv/archive/large-upload.bin')
    try {
      await writeFile(localUpload, uploadBytes)

      const transferPromise = transferFileEntry(
        { kind: 'upload-file', localPath: localUpload, remoteDirectory: '/srv/archive' },
        { kind: 'remote', sessionId, fromHost: '127.0.0.1', toHost: 'sftp.example.test' }
      )

      await firstPausedWrite.reached
      let activeTasks = await listFileTransferTasks()
      expect(activeTasks[0]).toEqual(
        expect.objectContaining({
          type: 'upload',
          progress: 50,
          speed: '上传中 64 KB / 128 KB',
          status: 'running'
        })
      )

      firstPausedWrite.release()
      await secondPausedWrite.reached
      activeTasks = await listFileTransferTasks()
      expect(activeTasks[0]).toEqual(
        expect.objectContaining({
          type: 'upload',
          progress: 99,
          speed: '上传中 128 KB / 128 KB',
          status: 'running'
        })
      )

      secondPausedWrite.release()
      const uploaded = await transferPromise
      expect(uploaded.ok).toBe(true)
      expect(uploaded.data).toEqual(expect.objectContaining({ status: 'success', bytes: uploadBytes.length }))
      expect(ssh2Mock.nodes.get('/srv/archive/large-upload.bin')?.content).toEqual(uploadBytes)
    } finally {
      firstPausedWrite.release()
      secondPausedWrite.release()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes and cancels active asset-backed single-file downloads from the backend task boundary', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-file-download-cancel-'))
    const localDownload = join(dir, 'remote.bin')
    const downloadBytes = Buffer.from([255, 128, 0, 65, 10])
    const pausedRead = ssh2Mock.pauseReadFile('/srv/archive/remote.bin')
    try {
      ssh2Mock.nodes.set('/srv/archive/remote.bin', { type: 'file', content: downloadBytes, mode: 0o100600, mtime: 1_717_200_400 })

      const transferPromise = transferFileEntry(
        { kind: 'download-file', remotePath: '/srv/archive/remote.bin', localPath: localDownload },
        { kind: 'remote', sessionId, fromHost: 'sftp.example.test', toHost: '127.0.0.1' }
      )

      await pausedRead.reached
      const activeTasks = await listFileTransferTasks()
      expect(activeTasks).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'download',
          name: 'remote.bin',
          source: '/srv/archive/remote.bin',
          target: localDownload,
          fromHost: 'sftp.example.test',
          toHost: '127.0.0.1',
          progress: 0,
          speed: 'pending',
          status: 'running',
          stage: 'pending'
        })
      ])

      const cancelled = await cancelFileTransferTask({ id: activeTasks[0].id })
      expect(cancelled).toEqual({
        ok: true,
        data: {
          id: activeTasks[0].id,
          taskIds: [activeTasks[0].id],
          status: 'aborted'
        }
      })
      await expect(listFileTransferTasks()).resolves.toEqual([])

      pausedRead.release()
      const downloaded = await transferPromise
      expect(downloaded.ok).toBe(true)
      expect(downloaded.data).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          source: '/srv/archive/remote.bin',
          target: localDownload,
          bytes: 0,
          files: 1,
          itemKind: 'file',
          task: expect.objectContaining({
            id: activeTasks[0].id,
            type: 'download',
            status: 'failed',
            speed: '已取消'
          })
        })
      )
      await expect(readFile(localDownload)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      pausedRead.release()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes and cancels active asset-backed single-file uploads from the backend task boundary', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-file-upload-cancel-'))
    const localUpload = join(dir, 'binary.bin')
    const uploadBytes = Buffer.from([0, 1, 2, 3, 127, 128, 255])
    const pausedWrite = ssh2Mock.pauseWriteFile('/srv/archive/binary.bin')
    try {
      await writeFile(localUpload, uploadBytes)

      const transferPromise = transferFileEntry(
        { kind: 'upload-file', localPath: localUpload, remoteDirectory: '/srv/archive' },
        { kind: 'remote', sessionId, fromHost: '127.0.0.1', toHost: 'sftp.example.test' }
      )

      await pausedWrite.reached
      const activeTasks = await listFileTransferTasks()
      expect(activeTasks).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'upload',
          name: 'binary.bin',
          source: localUpload,
          target: '/srv/archive/binary.bin',
          fromHost: '127.0.0.1',
          toHost: 'sftp.example.test',
          progress: 99,
          speed: '上传中 7 B / 7 B',
          status: 'running',
          stage: 'pending'
        })
      ])

      const cancelled = await cancelFileTransferTask({ id: activeTasks[0].id })
      expect(cancelled).toEqual({
        ok: true,
        data: {
          id: activeTasks[0].id,
          taskIds: [activeTasks[0].id],
          status: 'aborted'
        }
      })
      await expect(listFileTransferTasks()).resolves.toEqual([])

      pausedWrite.release()
      const uploaded = await transferPromise
      expect(uploaded.ok).toBe(true)
      expect(uploaded.data).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          source: localUpload,
          target: '/srv/archive/binary.bin',
          bytes: 0,
          files: 1,
          itemKind: 'file',
          task: expect.objectContaining({
            id: activeTasks[0].id,
            type: 'upload',
            status: 'failed',
            speed: '已取消'
          })
        })
      )
      expect(ssh2Mock.nodes.get('/srv/archive/binary.bin')?.content).not.toEqual(uploadBytes)
    } finally {
      pausedWrite.release()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uploads local directories recursively through asset-backed SFTP operations', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-dir-transfer-'))
    const localDirectory = join(dir, 'release-dir')
    const nestedDirectory = join(localDirectory, 'nested')
    const droppedDirectory = join(dir, 'dropped-dir')
    try {
      await mkdir(nestedDirectory, { recursive: true })
      await mkdir(droppedDirectory, { recursive: true })
      await writeFile(join(localDirectory, 'README.txt'), Buffer.from('release notes\n', 'utf-8'))
      await writeFile(join(nestedDirectory, 'payload.bin'), Buffer.from([0, 1, 2, 255]))
      await writeFile(join(droppedDirectory, 'drop.txt'), Buffer.from('dropped directory file\n', 'utf-8'))

      const uploadedDirectory = await transferFileEntry(
        { kind: 'upload-directory', localPath: localDirectory, remoteDirectory: '/srv/archive' },
        { kind: 'remote', sessionId, fromHost: '127.0.0.1', toHost: 'sftp.example.test' }
      )
      expect(uploadedDirectory.ok).toBe(true)
      expect(uploadedDirectory.data).toEqual(
        expect.objectContaining({
          status: 'success',
          source: localDirectory,
          target: '/srv/archive/release-dir',
          bytes: 18,
          files: 2,
          itemKind: 'directory',
          task: expect.objectContaining({
            type: 'upload',
            name: 'release-dir',
            source: localDirectory,
            target: '/srv/archive/release-dir',
            stage: 'scanning',
            isGroup: true,
            totalFiles: 2,
            finishedFiles: 2,
            fromHost: '127.0.0.1',
            toHost: 'sftp.example.test',
            status: 'success',
            children: expect.arrayContaining([
              expect.objectContaining({ type: 'upload', name: 'README.txt', target: '/srv/archive/release-dir/README.txt', stage: 'pending' }),
              expect.objectContaining({ type: 'upload', name: 'payload.bin', target: '/srv/archive/release-dir/nested/payload.bin', stage: 'pending' })
            ])
          })
        })
      )
      expect(ssh2Mock.nodes.get('/srv/archive/release-dir')?.type).toBe('directory')
      expect(ssh2Mock.nodes.get('/srv/archive/release-dir/nested')?.type).toBe('directory')
      expect(ssh2Mock.nodes.get('/srv/archive/release-dir/README.txt')?.content?.toString('utf-8')).toBe('release notes\n')
      expect(ssh2Mock.nodes.get('/srv/archive/release-dir/nested/payload.bin')?.content).toEqual(Buffer.from([0, 1, 2, 255]))
      expect(ssh2Mock.calls).toEqual(
        expect.arrayContaining([
          { method: 'mkdir', path: '/srv/archive/release-dir' },
          { method: 'mkdir', path: '/srv/archive/release-dir/nested' },
          { method: 'writeFile', path: '/srv/archive/release-dir/README.txt', content: 'release notes\n' },
          { method: 'writeFile', path: '/srv/archive/release-dir/nested/payload.bin', content: Buffer.from([0, 1, 2, 255]).toString('utf-8') }
        ])
      )

      const droppedUpload = await transferFileEntry(
        { kind: 'upload-path', localPath: droppedDirectory, remoteDirectory: '/srv/archive' },
        { kind: 'remote', sessionId, fromHost: '127.0.0.1', toHost: 'sftp.example.test' }
      )
      expect(droppedUpload.ok).toBe(true)
      expect(droppedUpload.data).toMatchObject({
        source: droppedDirectory,
        target: '/srv/archive/dropped-dir',
        bytes: 23,
        files: 1,
        itemKind: 'directory'
      })
      expect(ssh2Mock.nodes.get('/srv/archive/dropped-dir/drop.txt')?.content?.toString('utf-8')).toBe('dropped directory file\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('aborts active asset-backed directory uploads from the backend cancel boundary', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-dir-cancel-'))
    const localDirectory = join(dir, 'release-dir')
    const firstWrite = ssh2Mock.pauseWriteFile('/srv/archive/release-dir/README.txt')
    try {
      await mkdir(localDirectory, { recursive: true })
      await writeFile(join(localDirectory, 'README.txt'), Buffer.from('release notes\n', 'utf-8'))
      await writeFile(join(localDirectory, 'z-after.txt'), Buffer.from('should not upload\n', 'utf-8'))

      const transferPromise = transferFileEntry(
        { kind: 'upload-directory', localPath: localDirectory, remoteDirectory: '/srv/archive' },
        { kind: 'remote', sessionId, fromHost: '127.0.0.1', toHost: 'sftp.example.test' }
      )

      await firstWrite.reached
      const activeTasks = await listFileTransferTasks()
      expect(activeTasks).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'upload',
          name: 'release-dir',
          source: localDirectory,
          target: '/srv/archive/release-dir',
          status: 'running',
          children: [
            expect.objectContaining({
              id: expect.stringMatching(/^transfer-/),
              name: 'README.txt',
              target: '/srv/archive/release-dir/README.txt',
              status: 'running'
            })
          ]
        })
      ])

      const cancelled = await cancelFileTransferTask({ id: activeTasks[0].children[0].id })
      expect(cancelled).toEqual({
        ok: true,
        data: {
          id: activeTasks[0].children[0].id,
          taskIds: [activeTasks[0].id, activeTasks[0].children[0].id],
          status: 'aborted'
        }
      })
      await expect(listFileTransferTasks()).resolves.toEqual([])

      firstWrite.release()
      const uploadedDirectory = await transferPromise
      expect(uploadedDirectory.ok).toBe(true)
      expect(uploadedDirectory.data).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          source: localDirectory,
          target: '/srv/archive/release-dir',
          bytes: 0,
          files: 1,
          itemKind: 'directory',
          task: expect.objectContaining({
            id: activeTasks[0].id,
            status: 'failed',
            speed: '已取消',
            children: [
              expect.objectContaining({
                id: activeTasks[0].children[0].id,
                status: 'failed',
                speed: '已取消'
              })
            ]
          })
        })
      )
      expect(ssh2Mock.nodes.get('/srv/archive/release-dir/README.txt')?.content?.toString('utf-8')).toBe('release notes\n')
      expect(ssh2Mock.nodes.has('/srv/archive/release-dir/z-after.txt')).toBe(false)
      expect(ssh2Mock.calls.filter((call) => call.method === 'writeFile').map((call) => call.path)).toEqual(['/srv/archive/release-dir/README.txt'])
    } finally {
      firstWrite.release()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('downloads remote directories recursively through asset-backed SFTP operations', async () => {
    const sessionId = saveSftpAsset()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-sftp-dir-download-'))
    const nestedBytes = Buffer.from([0, 1, 2, 255])
    try {
      ssh2Mock.nodes.set('/srv/logs/nested', { type: 'directory', mode: 0o040755, mtime: 1_717_200_400 })
      ssh2Mock.nodes.set('/srv/logs/nested/trace.bin', { type: 'file', content: nestedBytes, mode: 0o100600, mtime: 1_717_200_400 })

      const downloadedDirectory = await transferFileEntry(
        { kind: 'download-directory', remotePath: '/srv/logs', localDirectory: dir },
        { kind: 'remote', sessionId, fromHost: 'sftp.example.test', toHost: '127.0.0.1' }
      )
      expect(downloadedDirectory.ok).toBe(true)
      expect(downloadedDirectory.data).toEqual(
        expect.objectContaining({
          status: 'success',
          source: '/srv/logs',
          target: join(dir, 'logs'),
          bytes: 14,
          files: 2,
          itemKind: 'directory',
          task: expect.objectContaining({
            type: 'download',
            name: 'logs',
            source: '/srv/logs',
            target: join(dir, 'logs'),
            stage: 'scanning',
            isGroup: true,
            totalFiles: 2,
            finishedFiles: 2,
            fromHost: 'sftp.example.test',
            toHost: '127.0.0.1',
            status: 'success',
            children: expect.arrayContaining([
              expect.objectContaining({ type: 'download', name: 'app.log', source: '/srv/logs/app.log', target: join(dir, 'logs', 'app.log') }),
              expect.objectContaining({
                type: 'download',
                name: 'trace.bin',
                source: '/srv/logs/nested/trace.bin',
                target: join(dir, 'logs', 'nested', 'trace.bin')
              })
            ])
          })
        })
      )
      expect(await readFile(join(dir, 'logs', 'app.log'))).toEqual(Buffer.from('hello log\n', 'utf-8'))
      expect(await readFile(join(dir, 'logs', 'nested', 'trace.bin'))).toEqual(nestedBytes)
      expect(ssh2Mock.calls).toEqual(
        expect.arrayContaining([
          { method: 'stat', path: '/srv/logs' },
          { method: 'readdir', path: '/srv/logs' },
          { method: 'readdir', path: '/srv/logs/nested' },
          { method: 'readFile', path: '/srv/logs/app.log' },
          { method: 'readFile', path: '/srv/logs/nested/trace.bin' }
        ])
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects credentialless remote mutations and transfers instead of fabricating seed results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-no-sftp-transfer-'))
    const localUpload = join(dir, 'dropped.log')
    const localDirectory = join(dir, 'dropped-dir')
    const remoteOptions = { kind: 'remote' as const, sessionId: 'ssh-staging', host: 'staging-app', fromHost: '127.0.0.1', toHost: 'staging-app' }
    const unavailable = {
      ok: false,
      errorCode: 'FILES_SFTP_UNAVAILABLE',
      errorMessage: 'SFTP connection is unavailable for this file session.'
    }
    try {
      await writeFileContent(localUpload, 'dropped through transfer boundary\n', { kind: 'local', sessionId: 'local' })
      await mkdir(localDirectory)

      await expect(mutateFileEntry({ kind: 'rename', oldPath: '/home/deploy/app.ini', newPath: '/home/deploy/app-v2.ini' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(mutateFileEntry({ kind: 'chmod', path: '/home/deploy/app.ini', mode: '700' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(mutateFileEntry({ kind: 'copy', srcPath: '/home/deploy/app.ini', targetPath: '/home/deploy/app-copy.ini' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(mutateFileEntry({ kind: 'move', srcPath: '/home/deploy/app.ini', targetPath: '/home/deploy/app-moved.ini' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(mutateFileEntry({ kind: 'delete', path: '/home/deploy/app.ini' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'copy-remote', remotePath: '/home/deploy/app.ini', targetPath: '/home/deploy/app-copy.ini' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'download-file', remotePath: '/home/deploy/app.ini', localPath: join(dir, 'app.ini') }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'download-directory', remotePath: '/home/deploy/boot', localDirectory: dir }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'upload-file', localPath: localUpload, remoteDirectory: '/home/deploy' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'upload-directory', localPath: localDirectory, remoteDirectory: '/home/deploy' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'upload-path', localPath: localUpload, remoteDirectory: '/home/deploy' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(transferFileEntry({ kind: 'upload-path', localPath: localDirectory, remoteDirectory: '/home/deploy' }, remoteOptions)).resolves.toEqual(unavailable)
      await expect(listFileTransferTasks()).resolves.toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes and reads local files through the same content API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-files-'))
    const filePath = join(dir, 'note.txt')
    try {
      const missing = await readFileContent(filePath, { kind: 'local', sessionId: 'local', host: 'localhost' })
      expect(missing.ok).toBe(true)
      expect(missing.data?.action).toBe('create')

      const saved = await writeFileContent(filePath, 'local backend content\n', { kind: 'local', sessionId: 'local', host: 'localhost' })
      expect(saved.ok).toBe(true)
      expect(saved.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'r2r',
          name: 'save note.txt',
          source: filePath,
          target: filePath,
          fromHost: 'localhost',
          toHost: 'localhost',
          status: 'success'
        })
      )

      const reread = await readFileContent(filePath, { kind: 'local', sessionId: 'local', host: 'localhost' })
      expect(reread.ok).toBe(true)
      expect(reread.data).toMatchObject({ action: 'edit', content: 'local backend content\n' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects local editor saves when the opened file version is stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-files-conflict-'))
    const filePath = join(dir, 'note.txt')
    try {
      await writeFile(filePath, 'opened local content\n', 'utf-8')
      const opened = await readFileContent(filePath, { kind: 'local', sessionId: 'local', host: 'localhost' })
      expect(opened.ok).toBe(true)

      await writeFile(filePath, 'changed by another editor\n', 'utf-8')
      const staleSave = await writeFileContent(filePath, 'stale overwrite attempt\n', {
        kind: 'local',
        sessionId: 'local',
        host: 'localhost',
        expectedAction: opened.data!.action,
        expectedMtimeMs: opened.data!.mtimeMs,
        expectedSize: opened.data!.size
      })

      expect(staleSave).toMatchObject({
        ok: false,
        errorCode: 'conflict',
        errorMessage: 'File changed on disk. Reload before saving.'
      })
      await expect(readFile(filePath, 'utf-8')).resolves.toBe('changed by another editor\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects local create saves when another process creates the file first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-files-create-conflict-'))
    const filePath = join(dir, 'new-note.txt')
    try {
      const opened = await readFileContent(filePath, { kind: 'local', sessionId: 'local', host: 'localhost' })
      expect(opened).toMatchObject({ ok: true, data: { action: 'create', content: '' } })

      await writeFile(filePath, 'created externally\n', 'utf-8')
      const createSave = await writeFileContent(filePath, 'editor create attempt\n', {
        kind: 'local',
        sessionId: 'local',
        host: 'localhost',
        expectedAction: opened.data!.action,
        expectedMtimeMs: opened.data!.mtimeMs,
        expectedSize: opened.data!.size
      })

      expect(createSave).toMatchObject({
        ok: false,
        errorCode: 'conflict',
        errorMessage: 'File was created by another process. Reload before saving.'
      })
      await expect(readFile(filePath, 'utf-8')).resolves.toBe('created externally\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renames, chmods, and deletes local filesystem entries through the mutation boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-file-mutate-'))
    const sourcePath = join(dir, 'source.txt')
    const renamedPath = join(dir, 'renamed.txt')
    try {
      await writeFileContent(sourcePath, 'local mutation content\n', { kind: 'local', sessionId: 'local' })

      const renamed = await mutateFileEntry({ kind: 'rename', oldPath: sourcePath, newPath: renamedPath }, { kind: 'local', sessionId: 'local' })
      expect(renamed.ok).toBe(true)
      expect((await listFiles(dir, { kind: 'local', sessionId: 'local' })).map((entry) => entry.name)).toContain('renamed.txt')

      const chmodded = await mutateFileEntry({ kind: 'chmod', path: renamedPath, mode: '600' }, { kind: 'local', sessionId: 'local' })
      expect(chmodded.ok).toBe(true)
      expect(chmodded.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          name: 'chmod renamed.txt',
          source: renamedPath,
          target: 'permissions',
          type: 'r2r',
          status: 'success'
        })
      )
      expect((await listFiles(dir, { kind: 'local', sessionId: 'local' })).find((entry) => entry.name === 'renamed.txt')?.mode).toBe('-600')

      const deleted = await mutateFileEntry({ kind: 'delete', path: renamedPath }, { kind: 'local', sessionId: 'local' })
      expect(deleted.ok).toBe(true)
      expect(deleted.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          name: 'delete renamed.txt',
          source: renamedPath,
          target: dir,
          type: 'r2r',
          status: 'success'
        })
      )
      expect((await listFiles(dir, { kind: 'local', sessionId: 'local' })).map((entry) => entry.name)).not.toContain('renamed.txt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('copies and moves local filesystem entries through the mutation boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-file-copy-move-'))
    const sourcePath = join(dir, 'source.txt')
    const copiedPath = join(dir, 'copied.txt')
    const movedPath = join(dir, 'moved.txt')
    try {
      await writeFileContent(sourcePath, 'local copy move content\n', { kind: 'local', sessionId: 'local' })

      const copied = await mutateFileEntry({ kind: 'copy', srcPath: sourcePath, targetPath: copiedPath }, { kind: 'local', sessionId: 'local' })
      expect(copied.ok).toBe(true)
      expect(copied.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          name: 'copied.txt',
          source: sourcePath,
          target: copiedPath,
          type: 'r2r',
          status: 'success'
        })
      )
      expect((await readFileContent(copiedPath, { kind: 'local', sessionId: 'local' })).data?.content).toBe('local copy move content\n')

      const moved = await mutateFileEntry({ kind: 'move', srcPath: sourcePath, targetPath: movedPath }, { kind: 'local', sessionId: 'local' })
      expect(moved.ok).toBe(true)
      expect(moved.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          name: 'moved.txt',
          source: sourcePath,
          target: movedPath,
          type: 'r2r',
          status: 'success'
        })
      )
      const names = (await listFiles(dir, { kind: 'local', sessionId: 'local' })).map((entry) => entry.name)
      expect(names).toContain('copied.txt')
      expect(names).toContain('moved.txt')
      expect(names).not.toContain('source.txt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
