import type { IpcMain } from 'electron'
import { listAiCommandCatalog } from '../backend/aiCommands'
import { listAiContextCatalog } from '../backend/aiContext'
import { listAiTodoSnapshot } from '../backend/aiTodos'

export const registerAiCatalogIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('ai:todo-snapshot', () => listAiTodoSnapshot())
  ipcMain.handle('ai:context-catalog', () => listAiContextCatalog())
  ipcMain.handle('ai:command-catalog', () => listAiCommandCatalog())
}
