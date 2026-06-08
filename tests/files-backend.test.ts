import { mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-files-test'
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
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
})

beforeEach(() => {
  resetFileSessionCatalog?.()
})

describe('files backend content boundary', () => {
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

  it('returns create mode for missing remote files and persists writes', async () => {
    const path = `/home/staging/new-${Date.now()}.txt`
    const missing = await readFileContent(path, { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })

    expect(missing.ok).toBe(true)
    expect(missing.data).toMatchObject({ action: 'create', content: '' })

    const saved = await writeFileContent(path, 'created through backend\n', { kind: 'remote', sessionId: 'ssh-staging', host: 'staging-app' })
    expect(saved.ok).toBe(true)

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
    expect((await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })).find((entry) => entry.path === renamedPath)?.mode).toBe('-700')

    const deleted = await mutateFileEntry({ kind: 'delete', path: renamedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(deleted.ok).toBe(true)
    expect((await listFiles('/home/staging', { kind: 'remote', sessionId: 'ssh-staging' })).map((entry) => entry.path)).not.toContain(renamedPath)
  })

  it('copies and moves remote entries through the mutation boundary', async () => {
    const sourcePath = `/home/staging/copy-move-${Date.now()}.txt`
    const copiedPath = sourcePath.replace('.txt', '-copy.txt')
    const movedPath = sourcePath.replace('.txt', '-moved.txt')
    await writeFileContent(sourcePath, 'copy move remote content\n', { kind: 'remote', sessionId: 'ssh-staging' })

    const copied = await mutateFileEntry({ kind: 'copy', srcPath: sourcePath, targetPath: copiedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(copied.ok).toBe(true)
    expect((await readFileContent(copiedPath, { kind: 'remote', sessionId: 'ssh-staging' })).data?.content).toBe('copy move remote content\n')

    const moved = await mutateFileEntry({ kind: 'move', srcPath: sourcePath, targetPath: movedPath }, { kind: 'remote', sessionId: 'ssh-staging' })
    expect(moved.ok).toBe(true)
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
      expect((await listFiles(dir, { kind: 'local', sessionId: 'local' })).find((entry) => entry.name === 'renamed.txt')?.mode).toBe('-600')

      const deleted = await mutateFileEntry({ kind: 'delete', path: renamedPath }, { kind: 'local', sessionId: 'local' })
      expect(deleted.ok).toBe(true)
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
      expect((await readFileContent(copiedPath, { kind: 'local', sessionId: 'local' })).data?.content).toBe('local copy move content\n')

      const moved = await mutateFileEntry({ kind: 'move', srcPath: sourcePath, targetPath: movedPath }, { kind: 'local', sessionId: 'local' })
      expect(moved.ok).toBe(true)
      const names = (await listFiles(dir, { kind: 'local', sessionId: 'local' })).map((entry) => entry.name)
      expect(names).toContain('copied.txt')
      expect(names).toContain('moved.txt')
      expect(names).not.toContain('source.txt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
