import type { IpcMain } from 'electron'
import { generateTerminalCommand, getTerminalCommandSuggestions } from '../backend/terminalSuggestions'
import type { TerminalCommandGenerationInput, TerminalCommandSuggestionContext } from '@shared/contracts/terminalTools'

export const registerTerminalToolsIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('terminal:suggestions', (_event, query: string, context?: TerminalCommandSuggestionContext) =>
    getTerminalCommandSuggestions(query, context)
  )
  ipcMain.handle('terminal:command:generate', (_event, input: TerminalCommandGenerationInput) => generateTerminalCommand(input))
}
