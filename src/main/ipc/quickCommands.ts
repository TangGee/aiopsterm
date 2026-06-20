import type { IpcMain } from 'electron'
import {
  deleteQuickCommandGroup,
  deleteQuickCommandSnippet,
  getQuickCommands,
  planQuickCommandScript,
  reorderQuickCommands,
  saveQuickCommandGroup,
  saveQuickCommandMacro,
  saveQuickCommandSnippet
} from '../backend/quickCommands'
import type {
  QuickCommandGroupSaveInput,
  QuickCommandMacroSaveInput,
  QuickCommandReorderInput,
  QuickCommandScriptPlanInput,
  QuickCommandSnippetSaveInput
} from '@shared/preload'

export const registerQuickCommandsIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('quick-commands:get', () => getQuickCommands())
  ipcMain.handle('quick-commands:group:save', (_event, input: QuickCommandGroupSaveInput) => saveQuickCommandGroup(input))
  ipcMain.handle('quick-commands:group:delete', (_event, uuid: string) => deleteQuickCommandGroup(uuid))
  ipcMain.handle('quick-commands:snippet:save', (_event, input: QuickCommandSnippetSaveInput) => saveQuickCommandSnippet(input))
  ipcMain.handle('quick-commands:macro:save', (_event, input: QuickCommandMacroSaveInput) => saveQuickCommandMacro(input))
  ipcMain.handle('quick-commands:snippet:delete', (_event, id: number) => deleteQuickCommandSnippet(id))
  ipcMain.handle('quick-commands:reorder', (_event, input: QuickCommandReorderInput) => reorderQuickCommands(input))
  ipcMain.handle('quick-commands:script:plan', (_event, input: QuickCommandScriptPlanInput) => planQuickCommandScript(input))
}
