import type { IpcMain } from 'electron'
import { transcribeVoiceInput } from '../backend/voice'
import type { VoiceTranscriptionInput } from '@shared/preload'

export const registerVoiceIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('voice:transcribe', (_event, input?: VoiceTranscriptionInput) => transcribeVoiceInput(input))
}
