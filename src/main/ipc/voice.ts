import type { IpcMain } from 'electron'
import { transcribeVoiceInput } from '../backend/ai/voice'
import type { VoiceTranscriptionInput } from '@shared/contracts/voice'

export const registerVoiceIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('voice:transcribe', (_event, input?: VoiceTranscriptionInput) => transcribeVoiceInput(input))
}
