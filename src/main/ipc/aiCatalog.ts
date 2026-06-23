import type { IpcMain } from 'electron'
import { listAiCommandCatalog } from '../backend/ai/aiCommands'
import { listAiContextCatalog } from '../backend/ai/aiContext'
import { listAiTodoSnapshot } from '../backend/ai/aiTodos'

export const registerAiCatalogIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('ai:todo-snapshot', () => listAiTodoSnapshot())
  ipcMain.handle('ai:context-catalog', () => listAiContextCatalog())
  ipcMain.handle('ai:command-catalog', () => listAiCommandCatalog())
}
