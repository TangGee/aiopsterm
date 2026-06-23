import type { IpcMain } from 'electron'
import { deleteAliasCommand, listAliasCommands, saveAliasCommand } from '../backend/quick-commands/aliases'
import type { AliasCommandDeleteInput, AliasCommandSaveInput } from '@shared/contracts/aliases'

export const registerAliasesIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('aliases:list', (_event, query?: string) => listAliasCommands(query || ''))
  ipcMain.handle('aliases:save', (_event, input: AliasCommandSaveInput) => saveAliasCommand(input))
  ipcMain.handle('aliases:delete', (_event, input: AliasCommandDeleteInput) => deleteAliasCommand(input))
}
