import { filesClient } from '@/services/filesClient'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isFileEntryMutationDataForRequest,
  isFileListEntryData,
  isFileTransferOperationData,
  isFileTransferTaskData,
  malformedFilesBackendResultMessage
} from '@/services/filesBackendGuards'
import { fileBrowserRowsForDirectory, normalizeFileBrowserPath } from '@/services/filesRuntime'
import type { FileBrowserRuntimeProps } from '@/services/fileBrowserRuntimeTypes'
import type { useWorkspaceStore } from '@/stores/workspace'
import type {
  FileEntryMutation,
  FileEntryMutationResult,
  FileListOptions,
  FileSessionInfo,
  FileTransferOperation,
  FileTransferOperationResult,
  FileTransferTask
} from '@shared/contracts/files'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>
type OpenDialogBridge = NonNullable<ReturnType<typeof localFilesClient.showOpenDialog>>
type SaveDialogBridge = NonNullable<ReturnType<typeof localFilesClient.showSaveDialog>>

export type FileBrowserBackendRuntime = ReturnType<typeof createFileBrowserBackendRuntime>

export const cleanFileBrowserErrorMessage = (fileError: unknown, fallback: string) => {
  const raw = fileError instanceof Error ? fileError.message : String(fileError || fallback)
  const wrapped = raw.match(/^Error invoking remote method '[^']+': Error:\s*(.+)$/)
  return (wrapped?.[1] || raw || fallback).trim()
}

export const createFileBrowserBackendRuntime = (input: {
  props: FileBrowserRuntimeProps
  workspace: WorkspaceStore
  setFileNotice: (message: string) => void
}) => {
  const { props, workspace, setFileNotice } = input

  const getListOptions = (overrides: Partial<FileListOptions> = {}): FileListOptions => ({
    sessionId: props.session.id,
    kind: props.session.kind,
    host: props.session.host,
    rootPath: props.session.rootPath,
    jumpHostId: props.session.jumpHostId,
    ...overrides
  })

  const getSessionListOptions = (session: FileSessionInfo | undefined, overrides: Partial<FileListOptions> = {}): FileListOptions =>
    session
      ? {
          sessionId: session.id,
          kind: session.kind,
          host: session.host,
          rootPath: session.rootPath,
          jumpHostId: session.jumpHostId,
          ...overrides
        }
      : getListOptions(overrides)

  const pushBackendTransferTask = (task: unknown, fallbackError: string) => {
    if (!isFileTransferTaskData(task)) throw new Error(fallbackError)
    const normalized = workspace.pushFileTransferTask(task as FileTransferTask)
    if (!normalized) throw new Error(fallbackError)
    return normalized
  }

  const applyTransferResult = (
    transfer: FileTransferOperationResult,
    fallbackError: string,
    cancelledNotice: string,
    skippedNotice: string
  ) => {
    if (!transfer?.ok) throw new Error(transfer?.errorMessage || fallbackError)
    const data = transfer.data
    if (!isFileTransferOperationData(data)) throw new Error(malformedFilesBackendResultMessage)
    pushBackendTransferTask(data.task, fallbackError)
    if (data.status === 'cancelled') {
      setFileNotice(cancelledNotice)
      return false
    }
    if (data.status === 'skipped') {
      setFileNotice(skippedNotice)
      return false
    }
    return true
  }

  const loadDirectoryEntries = async (path: string) => {
    const listFiles = filesClient.listFiles()
    if (!listFiles) throw new Error('文件列表服务不可用')
    const list = await listFiles(path, getListOptions())
    if (!Array.isArray(list) || !list.every(isFileListEntryData)) throw new Error(malformedFilesBackendResultMessage)
    return fileBrowserRowsForDirectory(path, list)
  }

  const listDirectoryEntries = async (path: string) => {
    const normalized = normalizeFileBrowserPath(path)
    return (await loadDirectoryEntries(normalized)).rows
  }

  const applyMutationResult = (result: FileEntryMutationResult, mutation: FileEntryMutation, fallbackError: string) => {
    if (!result?.ok) throw new Error(result?.errorMessage || fallbackError)
    const data = result.data
    if (!isFileEntryMutationDataForRequest(data, mutation) || typeof data.path !== 'string' || !data.path.trim()) {
      throw new Error(malformedFilesBackendResultMessage)
    }
    if (mutation.kind !== 'rename') pushBackendTransferTask(data.task, fallbackError)
    return data
  }

  const mutateEntry = async (mutation: FileEntryMutation, fallbackError = '文件操作失败') => {
    const mutateFileEntry = filesClient.mutateFileEntry()
    if (!mutateFileEntry) throw new Error('文件操作服务不可用')
    const result = await mutateFileEntry(mutation, getListOptions())
    return applyMutationResult(result, mutation, fallbackError)
  }

  const runObservedFileTransfer = async (operation: FileTransferOperation, options: FileListOptions) => {
    const transferFileEntry = filesClient.transferFileEntry()
    if (!transferFileEntry) throw new Error('文件传输服务不可用')
    const stopObserving = workspace.observeFileTransferTasks()
    try {
      return await transferFileEntry(operation, options)
    } finally {
      stopObserving()
    }
  }

  const pickLocalPath = async (
    options: Parameters<OpenDialogBridge>[0],
    unavailableMessage: string,
    failureMessage: string
  ) => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      setFileNotice(unavailableMessage)
      return ''
    }
    try {
      const result = await showOpenDialog(options)
      return result?.canceled ? '' : result?.filePaths?.[0] || ''
    } catch {
      setFileNotice(failureMessage)
      return ''
    }
  }

  const pickSavePath = async (
    options: Parameters<SaveDialogBridge>[0],
    unavailableMessage: string,
    failureMessage: string
  ) => {
    const showSaveDialog = localFilesClient.showSaveDialog()
    if (!showSaveDialog) {
      setFileNotice(unavailableMessage)
      return ''
    }
    try {
      const result = await showSaveDialog(options)
      return result?.canceled ? '' : result?.filePath || ''
    } catch {
      setFileNotice(failureMessage)
      return ''
    }
  }

  return {
    getListOptions,
    getSessionListOptions,
    pushBackendTransferTask,
    applyTransferResult,
    loadDirectoryEntries,
    listDirectoryEntries,
    mutateEntry,
    runObservedFileTransfer,
    pickLocalPath,
    pickSavePath
  }
}
