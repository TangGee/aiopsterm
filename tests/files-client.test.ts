import { afterEach, describe, expect, it, vi } from 'vitest'
import { filesClient } from '@/services/files/filesClient'
import type {
  FileEntryMutationResult,
  FileListEntry,
  FileReadContentResult,
  FileSessionCatalog,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
  FileSessionInfo,
  FileSessionMutationResult,
  FileTransferOperationResult,
  FileTransferTaskCancelResult,
  FileTransferTask,
  FileWriteContentResult
} from '@shared/contracts/files'

const originalAiops = window.aiops

const fileSession: FileSessionInfo = {
  id: 'local',
  label: 'Local',
  host: 'localhost',
  group: 'Local',
  kind: 'local',
  rootPath: '/',
  status: 'active',
  assetType: 'local'
}

const catalog: FileSessionCatalog = {
  sessions: [fileSession],
  folders: []
}

const mutationResult: FileSessionMutationResult = {
  ok: true,
  data: {
    ...catalog,
    session: fileSession
  }
}

const transferTask: FileTransferTask = {
  id: 'task-1',
  type: 'download',
  name: 'app.log',
  source: '/remote/app.log',
  target: '/tmp/app.log',
  progress: 50,
  speed: '1MB/s',
  status: 'running'
}

const fileEntry: FileListEntry = {
  name: 'app.log',
  path: '/var/log/app.log',
  type: 'file',
  size: 42,
  modifiedAt: 1781913600000,
  mode: '-rw-r--r--'
}

const fileReadResult: FileReadContentResult = {
  ok: true,
  data: {
    content: 'hello',
    action: 'edit',
    mtimeMs: 1781913600000,
    size: 5
  }
}

const fileWriteResult: FileWriteContentResult = {
  ok: true,
  data: {
    mtimeMs: 1781913601000,
    size: 7,
    task: transferTask
  }
}

const fileEntryMutationResult: FileEntryMutationResult = {
  ok: true,
  data: {
    affected: 1,
    path: '/var/log/app-renamed.log',
    mtimeMs: 1781913601000,
    task: transferTask
  }
}

const fileTransferResult: FileTransferOperationResult = {
  ok: true,
  data: {
    status: 'success',
    source: fileEntry.path,
    target: '/tmp/app.log',
    bytes: 42,
    files: 1,
    mtimeMs: 1781913601000,
    itemKind: 'file',
    task: transferTask
  }
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('filesClient', () => {
  it('returns undefined for unavailable bridge methods and binds Files bridge methods', async () => {
    window.aiops = {
      ...originalAiops,
      listFileSessionCatalog: vi.fn(async () => ({ ok: true, data: catalog })),
      saveFileSession: vi.fn(async () => mutationResult),
      saveFileSessionFromSftpPayload: vi.fn(async () => mutationResult),
      saveFileSessionFromTerminalContext: vi.fn(async () => mutationResult),
      updateFileSession: vi.fn(async () => mutationResult),
      saveFileSessionFolder: vi.fn(
        async (folder): Promise<FileSessionFolderMutationResult> => ({
          ok: true,
          data: {
            ...catalog,
            folder: {
              uuid: folder.uuid || 'folder-1',
              name: folder.name,
              description: folder.description || '',
              ...(folder.parentUuid ? { parentUuid: folder.parentUuid } : {}),
              ...(folder.scope ? { scope: folder.scope } : {})
            }
          }
        })
      ),
      deleteFileSessionFolder: vi.fn(
        async (folderUuid): Promise<FileSessionFolderDeleteResult> => ({
          ok: true,
          data: {
            ...catalog,
            folderUuid
          }
        })
      ),
      listFiles: vi.fn(async () => [fileEntry]),
      readFileContent: vi.fn(async () => fileReadResult),
      writeFileContent: vi.fn(async () => fileWriteResult),
      mutateFileEntry: vi.fn(async () => fileEntryMutationResult),
      transferFileEntry: vi.fn(async () => fileTransferResult),
      cancelFileTransferTask: vi.fn(
        async (input): Promise<FileTransferTaskCancelResult> => ({ ok: true, data: { id: input.id, status: 'aborted', taskIds: [input.id] } })
      ),
      listFileTransferTasks: vi.fn(async () => [transferTask])
    }

    await expect(filesClient.listFileSessionCatalog()?.()).resolves.toEqual({ ok: true, data: catalog })
    await expect(filesClient.saveFileSession()?.(fileSession)).resolves.toEqual(mutationResult)
    await expect(filesClient.saveFileSessionFromSftpPayload()?.({ host: '10.0.0.1', username: 'ops' })).resolves.toEqual(mutationResult)
    await expect(filesClient.saveFileSessionFromTerminalContext()?.({ kind: 'local', panelTitle: 'Shell', panelStatus: 'running' })).resolves.toEqual(
      mutationResult
    )
    await expect(filesClient.updateFileSession()?.('local', { label: 'Local files' })).resolves.toEqual(mutationResult)
    await expect(filesClient.saveFileSessionFolder()?.({ name: 'Production' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ folder: expect.objectContaining({ name: 'Production' }) }) })
    )
    await expect(filesClient.deleteFileSessionFolder()?.('folder-1')).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ folderUuid: 'folder-1' }) })
    )
    await expect(filesClient.listFiles()?.('/var/log', { sessionId: fileSession.id, kind: fileSession.kind })).resolves.toEqual([fileEntry])
    await expect(filesClient.readFileContent()?.(fileEntry.path, { sessionId: fileSession.id, kind: fileSession.kind })).resolves.toEqual(fileReadResult)
    await expect(filesClient.writeFileContent()?.(fileEntry.path, 'updated', { sessionId: fileSession.id, kind: fileSession.kind })).resolves.toEqual(
      fileWriteResult
    )
    await expect(
      filesClient.mutateFileEntry()?.(
        { kind: 'rename', oldPath: fileEntry.path, newPath: '/var/log/app-renamed.log' },
        { sessionId: fileSession.id, kind: fileSession.kind }
      )
    ).resolves.toEqual(fileEntryMutationResult)
    await expect(filesClient.transferFileEntry()?.({ kind: 'download-file', remotePath: fileEntry.path, localPath: '/tmp/app.log' }, { sessionId: fileSession.id, kind: fileSession.kind })).resolves.toEqual(fileTransferResult)
    await expect(filesClient.cancelFileTransferTask()?.({ id: 'task-1' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ id: 'task-1', status: 'aborted' }) })
    )
    await expect(filesClient.listFileTransferTasks()?.()).resolves.toEqual([expect.objectContaining({ id: 'task-1' })])

    expect(window.aiops.saveFileSession).toHaveBeenCalledWith(fileSession)
    expect(window.aiops.saveFileSessionFromSftpPayload).toHaveBeenCalledWith({ host: '10.0.0.1', username: 'ops' })
    expect(window.aiops.saveFileSessionFromTerminalContext).toHaveBeenCalledWith({ kind: 'local', panelTitle: 'Shell', panelStatus: 'running' })
    expect(window.aiops.updateFileSession).toHaveBeenCalledWith('local', { label: 'Local files' })
    expect(window.aiops.saveFileSessionFolder).toHaveBeenCalledWith({ name: 'Production' })
    expect(window.aiops.deleteFileSessionFolder).toHaveBeenCalledWith('folder-1')
    expect(window.aiops.listFiles).toHaveBeenCalledWith('/var/log', { sessionId: fileSession.id, kind: fileSession.kind })
    expect(window.aiops.readFileContent).toHaveBeenCalledWith(fileEntry.path, { sessionId: fileSession.id, kind: fileSession.kind })
    expect(window.aiops.writeFileContent).toHaveBeenCalledWith(fileEntry.path, 'updated', { sessionId: fileSession.id, kind: fileSession.kind })
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'rename', oldPath: fileEntry.path, newPath: '/var/log/app-renamed.log' },
      { sessionId: fileSession.id, kind: fileSession.kind }
    )
    expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
      { kind: 'download-file', remotePath: fileEntry.path, localPath: '/tmp/app.log' },
      { sessionId: fileSession.id, kind: fileSession.kind }
    )
    expect(window.aiops.cancelFileTransferTask).toHaveBeenCalledWith({ id: 'task-1' })

    window.aiops = {
      ...originalAiops,
      listFileSessionCatalog: undefined as any,
      saveFileSession: undefined as any,
      saveFileSessionFromSftpPayload: undefined as any,
      saveFileSessionFromTerminalContext: undefined as any,
      updateFileSession: undefined as any,
      saveFileSessionFolder: undefined as any,
      deleteFileSessionFolder: undefined as any,
      listFiles: undefined as any,
      readFileContent: undefined as any,
      writeFileContent: undefined as any,
      mutateFileEntry: undefined as any,
      transferFileEntry: undefined as any,
      cancelFileTransferTask: undefined as any,
      listFileTransferTasks: undefined as any
    }
    expect(filesClient.listFileSessionCatalog()).toBeUndefined()
    expect(filesClient.saveFileSession()).toBeUndefined()
    expect(filesClient.saveFileSessionFromSftpPayload()).toBeUndefined()
    expect(filesClient.saveFileSessionFromTerminalContext()).toBeUndefined()
    expect(filesClient.updateFileSession()).toBeUndefined()
    expect(filesClient.saveFileSessionFolder()).toBeUndefined()
    expect(filesClient.deleteFileSessionFolder()).toBeUndefined()
    expect(filesClient.listFiles()).toBeUndefined()
    expect(filesClient.readFileContent()).toBeUndefined()
    expect(filesClient.writeFileContent()).toBeUndefined()
    expect(filesClient.mutateFileEntry()).toBeUndefined()
    expect(filesClient.transferFileEntry()).toBeUndefined()
    expect(filesClient.cancelFileTransferTask()).toBeUndefined()
    expect(filesClient.listFileTransferTasks()).toBeUndefined()
  })
})
