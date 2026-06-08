import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
    },
    writeFile(path: string, content: Buffer, callback: (error?: Error | null) => void) {
      const normalized = normalize(path)
      calls.push({ method: 'writeFile', path: normalized, content: Buffer.from(content).toString('utf-8') })
      if (!nodes.has(dirname(normalized))) {
        callback(missingError(dirname(normalized)))
        return
      }
      nodes.set(normalized, { type: 'file', content: Buffer.from(content), mode: 0o100644, mtime: 1_717_200_200 })
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
    connectConfigs.length = 0
    calls.length = 0
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

  return { default: MockStore }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store files backend in tests')
})

vi.mock('../src/main/backend/ssh2Runtime', () => ({
  loadSsh2: () => ({ Client: ssh2Mock.Client })
}))

let readFileContent: (filePath: string, options?: Record<string, unknown>) => Promise<any>
let writeFileContent: (filePath: string, content: string, options?: Record<string, unknown>) => Promise<any>
let listFiles: (directory: string, options?: Record<string, unknown>) => Promise<any[]>
let mutateFileEntry: (mutation: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>
let transferFileEntry: (operation: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>
let listFileTransferTasks: () => Promise<any[]>
let recordFileTransferTask: (input: Record<string, unknown>) => Promise<any>
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
let saveAsset: (asset: any) => any

beforeAll(async () => {
  const modulePath = '../src/main/backend/files'
  const backend = await import(modulePath)
  readFileContent = backend.readFileContent
  writeFileContent = backend.writeFileContent
  listFiles = backend.listFiles
  mutateFileEntry = backend.mutateFileEntry
  transferFileEntry = backend.transferFileEntry
  listFileTransferTasks = backend.listFileTransferTasks
  recordFileTransferTask = backend.recordFileTransferTask
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
  const assetsModulePath = '../src/main/backend/assets'
  saveAsset = (await import(assetsModulePath)).saveAsset
})

beforeEach(() => {
  resetFileSessionCatalog?.()
  ssh2Mock.reset()
})

describe('files backend content boundary', () => {
  const saveSftpAsset = () => {
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
      password: 'backend-secret'
    })
    expect(saved.ok).toBe(true)
    return saved.data.id
  }

  it('loads and mutates file session catalog behind the main-process boundary', async () => {
    const initial = await listFileSessionCatalog()
    expect(initial.ok).toBe(true)
    expect(initial.data.sessions).toEqual([
      expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' }),
      expect.objectContaining({ id: 'asset-1', label: 'prod-bastion', host: '10.24.8.12' }),
      expect.objectContaining({ id: 'folder_asset-2', folderUuid: 'files-folder-a' })
    ])
    expect(initial.data.folders).toEqual([
      expect.objectContaining({ uuid: 'files-folder-a', name: '核心业务' }),
      expect.objectContaining({ uuid: 'files-folder-b', name: '临时排障' })
    ])

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

  it('records file transfer task identities behind the main-process boundary', async () => {
    const recorded = await recordFileTransferTask({
      id: 'client-transfer-draft',
      type: 'download',
      name: 'api.log',
      source: '/home/deploy/logs/api.log',
      target: '/tmp/api.log',
      progress: 160,
      speed: '1 MB/s',
      status: 'running',
      fromHost: 'prod-bastion',
      toHost: 'local',
      children: [
        {
          id: 'client-transfer-child',
          type: 'download',
          name: 'api-part.log',
          source: '/home/deploy/logs/api-part.log',
          target: '/tmp/api-part.log',
          progress: -10,
          status: 'running'
        }
      ]
    })

    expect(recorded.ok).toBe(true)
    expect(recorded.data.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^transfer-/),
        type: 'download',
        name: 'api.log',
        source: '/home/deploy/logs/api.log',
        target: '/tmp/api.log',
        progress: 100,
        speed: '1 MB/s',
        status: 'running',
        fromHost: 'prod-bastion',
        toHost: 'local',
        children: [
          expect.objectContaining({
            id: expect.stringMatching(/^transfer-/),
            type: 'download',
            name: 'api-part.log',
            progress: 0,
            status: 'running'
          })
        ]
      })
    )
    expect(recorded.data.task.id).not.toBe('client-transfer-draft')
    expect(recorded.data.task.children[0].id).not.toBe('client-transfer-child')
    await expect(listFileTransferTasks()).resolves.toEqual([expect.objectContaining({ id: recorded.data.task.id, status: 'running' })])

    const cancelled = await cancelFileTransferTask({ id: recorded.data.task.children[0].id })
    expect(cancelled).toEqual({
      ok: true,
      data: {
        id: recorded.data.task.children[0].id,
        taskIds: [recorded.data.task.id, recorded.data.task.children[0].id],
        status: 'aborted'
      }
    })
    await expect(listFileTransferTasks()).resolves.toEqual([])
    await expect(cancelFileTransferTask({ id: recorded.data.task.id })).resolves.toMatchObject({
      ok: true,
      data: { id: recorded.data.task.id, taskIds: [], status: 'not_found' }
    })

    await expect(recordFileTransferTask({ type: 'download', name: '', source: '', target: '' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'FILES_TRANSFER_TASK_INVALID'
    })
  })

  it('reads remote seed content behind the main-process file boundary', async () => {
    const result = await readFileContent('/home/staging/release-note.md', { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      action: 'edit',
      content: expect.stringContaining('Staging release')
    })
  })

  it('keeps credentialless development assets on the seed backend even when an SSH agent socket exists', async () => {
    const originalAgent = process.env.SSH_AUTH_SOCK
    const originalFilesAgent = process.env.AIOPSTERM_FILES_SFTP_AGENT
    process.env.SSH_AUTH_SOCK = '/tmp/aiopsterm-test-agent.sock'
    delete process.env.AIOPSTERM_FILES_SFTP_AGENT
    try {
      const rows = await listFiles('/home/deploy', { kind: 'remote', sessionId: 'asset-1', host: 'prod-bastion' })

      expect(rows.map((entry) => entry.name)).toContain('release-note.md')
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
          { method: 'writeFile', path: '/srv/archive/binary.bin', content: uploadBytes.toString('utf-8') },
          { method: 'readFile', path: '/srv/archive/remote.bin' }
        ])
      )
    } finally {
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

  it('returns create mode for missing remote files and persists writes', async () => {
    const path = `/home/staging/new-${Date.now()}.txt`
    const missing = await readFileContent(path, { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })

    expect(missing.ok).toBe(true)
    expect(missing.data).toMatchObject({ action: 'create', content: '' })

    const saved = await writeFileContent(path, 'created through backend\n', { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })
    expect(saved.ok).toBe(true)
    expect(saved.data.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^transfer-/),
        type: 'r2r',
        name: expect.stringContaining('new-'),
        source: path,
        target: path,
        fromHost: 'staging-app',
        toHost: 'staging-app',
        status: 'success',
        speed: '已保存'
      })
    )

    const reread = await readFileContent(path, { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })
    expect(reread.ok).toBe(true)
    expect(reread.data).toMatchObject({ action: 'edit', content: 'created through backend\n' })
  })

  it('renames, chmods, and deletes remote entries through the mutation boundary', async () => {
    const sourcePath = `/home/staging/mutate-${Date.now()}.txt`
    const renamedPath = sourcePath.replace('.txt', '-renamed.txt')
    await writeFileContent(sourcePath, 'remote mutation content\n', { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })

    const renamed = await mutateFileEntry({ kind: 'rename', oldPath: sourcePath, newPath: renamedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(renamed.ok).toBe(true)

    const afterRename = await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })
    expect(afterRename.map((entry) => entry.path)).toContain(renamedPath)
    expect(afterRename.map((entry) => entry.path)).not.toContain(sourcePath)

    const chmodded = await mutateFileEntry({ kind: 'chmod', path: renamedPath, mode: '700' }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(chmodded.ok).toBe(true)
    expect(chmodded.data.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^transfer-/),
        type: 'r2r',
        name: expect.stringContaining('chmod mutate-'),
        source: renamedPath,
        target: 'permissions',
        status: 'success'
      })
    )
    expect((await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })).find((entry) => entry.path === renamedPath)?.mode).toBe('-700')

    const deleted = await mutateFileEntry({ kind: 'delete', path: renamedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(deleted.ok).toBe(true)
    expect(deleted.data.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^transfer-/),
        type: 'r2r',
        name: expect.stringContaining('delete mutate-'),
        source: renamedPath,
        target: '/home/staging',
        status: 'success'
      })
    )
    expect((await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })).map((entry) => entry.path)).not.toContain(renamedPath)
  })

  it('copies and moves remote entries through the mutation boundary', async () => {
    const sourcePath = `/home/staging/copy-move-${Date.now()}.txt`
    const copiedPath = sourcePath.replace('.txt', '-copy.txt')
    const movedPath = sourcePath.replace('.txt', '-moved.txt')
    await writeFileContent(sourcePath, 'copy move remote content\n', { kind: 'remote', sessionId: 'ssh-staging' })

    const copied = await mutateFileEntry({ kind: 'copy', srcPath: sourcePath, targetPath: copiedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(copied.ok).toBe(true)
    expect(copied.data.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^transfer-/),
        type: 'r2r',
        name: expect.stringContaining('copy-move-'),
        source: sourcePath,
        target: copiedPath,
        status: 'success'
      })
    )
    expect((await readFileContent(copiedPath, { kind: 'remote', sessionId: 'ssh-staging' })).data?.content).toBe('copy move remote content\n')

    const moved = await mutateFileEntry({ kind: 'move', srcPath: sourcePath, targetPath: movedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(moved.ok).toBe(true)
    expect(moved.data.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^transfer-/),
        type: 'r2r',
        source: sourcePath,
        target: movedPath,
        status: 'success'
      })
    )
    const paths = (await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })).map((entry) => entry.path)
    expect(paths).toContain(copiedPath)
    expect(paths).toContain(movedPath)
    expect(paths).not.toContain(sourcePath)
  })

  it('uploads local files into remote seed content and downloads remote files locally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-file-transfer-'))
    const localUpload = join(dir, 'upload.txt')
    const localDownload = join(dir, 'download.txt')
    try {
      await writeFileContent(localUpload, 'uploaded through transfer boundary\n', { kind: 'local', sessionId: 'local' })
      const uploaded = await transferFileEntry(
        { kind: 'upload-file', localPath: localUpload, remoteDirectory: '/home/staging' },
        { kind: 'remote', sessionId: 'ssh-staging', fromHost: '127.0.0.1', toHost: 'staging-app' }
      )
      expect(uploaded.ok).toBe(true)
      expect(uploaded.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'upload',
          name: 'upload.txt',
          source: localUpload,
          target: '/home/staging/upload.txt',
          progress: 100,
          speed: '完成',
          status: 'success',
          stage: 'pending',
          fromHost: '127.0.0.1',
          toHost: 'staging-app'
        })
      )
      expect((await readFileContent('/home/staging/upload.txt', { kind: 'remote', sessionId: 'ssh-staging' })).data?.content).toBe(
        'uploaded through transfer boundary\n'
      )

      const downloaded = await transferFileEntry(
        { kind: 'download-file', remotePath: '/home/staging/upload.txt', localPath: localDownload },
        { kind: 'remote', sessionId: 'ssh-staging', fromHost: 'staging-app', toHost: '127.0.0.1' }
      )
      expect(downloaded.ok).toBe(true)
      expect(downloaded.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'download',
          name: 'upload.txt',
          source: '/home/staging/upload.txt',
          target: localDownload,
          progress: 100,
          speed: '完成',
          status: 'success',
          fromHost: 'staging-app',
          toHost: '127.0.0.1'
        })
      )
      expect((await readFileContent(localDownload, { kind: 'local', sessionId: 'local' })).data?.content).toBe('uploaded through transfer boundary\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('downloads remote seed directories locally through the transfer boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-seed-dir-download-'))
    try {
      const downloadedDirectory = await transferFileEntry(
        { kind: 'download-directory', remotePath: '/home/staging/boot', localDirectory: dir },
        { kind: 'remote', sessionId: 'ssh-staging', fromHost: 'staging-app', toHost: '127.0.0.1' }
      )
      const content = '[app]\nenv=staging\nport=8080\n'
      expect(downloadedDirectory.ok).toBe(true)
      expect(downloadedDirectory.data).toEqual(
        expect.objectContaining({
          status: 'success',
          source: '/home/staging/boot',
          target: join(dir, 'boot'),
          bytes: Buffer.byteLength(content, 'utf-8'),
          files: 1,
          itemKind: 'directory',
          task: expect.objectContaining({
            type: 'download',
            name: 'boot',
            source: '/home/staging/boot',
            target: join(dir, 'boot'),
            stage: 'scanning',
            isGroup: true,
            totalFiles: 1,
            finishedFiles: 1,
            fromHost: 'staging-app',
            toHost: '127.0.0.1',
            status: 'success'
          })
        })
      )
      expect(await readFile(join(dir, 'boot', 'app.ini'), 'utf-8')).toBe(content)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns backend-owned task records for remote copies and directory uploads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-transfer-task-meta-'))
    const localDirectory = join(dir, 'release-dir')
    try {
      await mkdir(localDirectory)
      const remoteCopyTarget = `/home/staging/release-note-copy-${Date.now()}.md`

      const copied = await transferFileEntry(
        { kind: 'copy-remote', remotePath: '/home/staging/release-note.md', targetPath: remoteCopyTarget },
        { kind: 'remote', sessionId: 'ssh-staging', fromHost: 'staging-app', toHost: 'prod-bastion' }
      )
      expect(copied.ok).toBe(true)
      expect(copied.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'r2r',
          name: 'release-note.md',
          source: '/home/staging/release-note.md',
          target: remoteCopyTarget,
          progress: 100,
          speed: '完成',
          status: 'success',
          fromHost: 'staging-app',
          toHost: 'prod-bastion'
        })
      )

      const uploadedDirectory = await transferFileEntry(
        { kind: 'upload-directory', localPath: localDirectory, remoteDirectory: '/home/staging' },
        { kind: 'remote', sessionId: 'ssh-staging', fromHost: '127.0.0.1', toHost: 'staging-app' }
      )
      expect(uploadedDirectory.ok).toBe(true)
      expect(uploadedDirectory.data).toMatchObject({ source: localDirectory, target: '/home/staging/release-dir', itemKind: 'directory' })
      expect(uploadedDirectory.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'upload',
          name: 'release-dir',
          source: localDirectory,
          target: '/home/staging/release-dir',
          progress: 100,
          speed: '完成',
          status: 'success',
          stage: 'scanning',
          isGroup: true,
          fromHost: '127.0.0.1',
          toHost: 'staging-app',
          totalFiles: 1,
          finishedFiles: 1
        })
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uploads a dropped local path through the transfer boundary after backend type detection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-os-drop-transfer-'))
    const localUpload = join(dir, 'dropped.log')
    const localDirectory = join(dir, 'dropped-dir')
    try {
      await writeFileContent(localUpload, 'dropped through transfer boundary\n', { kind: 'local', sessionId: 'local' })
      await mkdir(localDirectory)

      const uploadedFile = await transferFileEntry(
        { kind: 'upload-path', localPath: localUpload, remoteDirectory: '/home/staging' },
        { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' }
      )
      expect(uploadedFile.ok).toBe(true)
      expect(uploadedFile.data).toMatchObject({ target: '/home/staging/dropped.log', itemKind: 'file' })
      expect(uploadedFile.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'upload',
          name: 'dropped.log',
          source: localUpload,
          target: '/home/staging/dropped.log',
          stage: 'pending',
          toHost: 'staging-app',
          status: 'success'
        })
      )
      expect((await readFileContent('/home/staging/dropped.log', { kind: 'remote', sessionId: 'ssh-staging' })).data?.content).toBe(
        'dropped through transfer boundary\n'
      )

      const uploadedDirectory = await transferFileEntry(
        { kind: 'upload-path', localPath: localDirectory, remoteDirectory: '/home/staging' },
        { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' }
      )
      expect(uploadedDirectory.ok).toBe(true)
      expect(uploadedDirectory.data).toMatchObject({ target: '/home/staging/dropped-dir', itemKind: 'directory', bytes: 0 })
      expect(uploadedDirectory.data.task).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^transfer-/),
          type: 'upload',
          name: 'dropped-dir',
          source: localDirectory,
          target: '/home/staging/dropped-dir',
          stage: 'scanning',
          isGroup: true,
          toHost: 'staging-app',
          status: 'success'
        })
      )
      expect((await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })).map((entry) => entry.path)).toContain(
        '/home/staging/dropped-dir'
      )
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
