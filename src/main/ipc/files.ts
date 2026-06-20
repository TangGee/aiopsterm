import type { IpcMain } from 'electron'
import {
  cancelFileTransferTask,
  deleteFileSession,
  deleteFileSessionFolder,
  listFileSessionCatalog,
  listFileTransferTasks,
  listFiles,
  mutateFileEntry,
  readFileContent,
  saveFileSession,
  saveFileSessionFolder,
  saveFileSessionFromSftpPayload,
  saveFileSessionFromTerminalContext,
  transferFileEntry,
  updateFileSession,
  writeFileContent
} from '../backend/files'
import type {
  FileContentOptions,
  FileEntryMutation,
  FileListOptions,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionPatch,
  FileSessionSftpPayload,
  FileSessionTerminalContext,
  FileTransferOperation,
  FileTransferTaskCancelInput
} from '@shared/contracts/files'

export const registerFilesIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('files:sessions:catalog', () => listFileSessionCatalog())
  ipcMain.handle('files:sessions:save', (_event, session: FileSessionInfo) => saveFileSession(session))
  ipcMain.handle('files:sessions:save-from-sftp-payload', (_event, payload: FileSessionSftpPayload) => saveFileSessionFromSftpPayload(payload))
  ipcMain.handle('files:sessions:save-from-terminal-context', (_event, context: FileSessionTerminalContext) =>
    saveFileSessionFromTerminalContext(context)
  )
  ipcMain.handle('files:sessions:update', (_event, id: string, patch: FileSessionPatch) => updateFileSession(id, patch))
  ipcMain.handle('files:sessions:delete', (_event, id: string) => deleteFileSession(id))
  ipcMain.handle('files:sessions:folder:save', (_event, folder: FileSessionFolderSaveInput) => saveFileSessionFolder(folder))
  ipcMain.handle('files:sessions:folder:delete', (_event, uuid: string) => deleteFileSessionFolder(uuid))
  ipcMain.handle('files:list', async (_event, directory: string, options?: FileListOptions) => listFiles(directory, options))
  ipcMain.handle('files:read-content', async (_event, filePath: string, options?: FileContentOptions) => readFileContent(filePath, options))
  ipcMain.handle('files:write-content', async (_event, filePath: string, content: string, options?: FileContentOptions) =>
    writeFileContent(filePath, content, options)
  )
  ipcMain.handle('files:mutate-entry', async (_event, mutation: FileEntryMutation, options?: FileListOptions) =>
    mutateFileEntry(mutation, options)
  )
  ipcMain.handle('files:transfer-entry', async (_event, operation: FileTransferOperation, options?: FileListOptions) =>
    transferFileEntry(operation, options)
  )
  ipcMain.handle('files:transfer-task:cancel', async (_event, input: FileTransferTaskCancelInput) => cancelFileTransferTask(input))
  ipcMain.handle('files:list-transfer-tasks', async () => listFileTransferTasks())
}
