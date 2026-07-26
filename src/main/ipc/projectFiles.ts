import { BrowserWindow, type IpcMain } from 'electron'
import { broadcastWindowEvent } from '@shared/windowEvents'
import type { ProductSessionRegistry } from '../backend/agent/productSessionRegistry'
import { findManagedAiSessionRecord } from '../backend/agent/agentSessions'
import {
  configureProjectFilesRuntime,
  getProjectFileContext,
  listProjectDirectory,
  mutateProjectEntry,
  readProjectFile,
  startProjectFileWatch,
  stopProjectFileWatch,
  writeProjectFile
} from '../backend/files/projectFiles'
import type {
  ProjectDirectoryListInput,
  ProjectEntryMutationInput,
  ProjectFileContextInput,
  ProjectFileReadInput,
  ProjectFileWatchInput,
  ProjectFileWriteInput
} from '@shared/contracts/projectFiles'

export const registerProjectFilesIpc = (
  ipcMain: IpcMain,
  input: { userDataPath: string; productSessionRegistry: ProductSessionRegistry }
) => {
  configureProjectFilesRuntime({
    userDataPath: input.userDataPath,
    getManagedSession: findManagedAiSessionRecord,
    findProductSession: (source, sessionId) => {
      try {
        return input.productSessionRegistry.findByNativeBinding({ engine: source, nativeSessionId: sessionId })
      } catch {
        return null
      }
    },
    emitWatchEvent: (event) => broadcastWindowEvent(BrowserWindow.getAllWindows(), 'project-files:watch-event', event),
    emitProjectChange: (context) => broadcastWindowEvent(BrowserWindow.getAllWindows(), 'project-files:changed', context)
  })
  ipcMain.handle('project-files:context', (_event, context: ProjectFileContextInput) => getProjectFileContext(context))
  ipcMain.handle('project-files:list', (_event, listInput: ProjectDirectoryListInput) => listProjectDirectory(listInput))
  ipcMain.handle('project-files:mutate', (_event, mutationInput: ProjectEntryMutationInput) => mutateProjectEntry(mutationInput))
  ipcMain.handle('project-files:read', (_event, readInput: ProjectFileReadInput) => readProjectFile(readInput))
  ipcMain.handle('project-files:write', (_event, writeInput: ProjectFileWriteInput) => writeProjectFile(writeInput))
  ipcMain.handle('project-files:watch:start', (_event, watchInput: ProjectFileWatchInput) => startProjectFileWatch(watchInput))
  ipcMain.handle('project-files:watch:stop', (_event, watchId: string) => stopProjectFileWatch(watchId))
}
