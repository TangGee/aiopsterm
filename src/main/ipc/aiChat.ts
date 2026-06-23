import type { IpcMain } from 'electron'
import { cancelAiChatResponse, createAiChatExchangeRequest, generateAiChatResponse } from '../backend/ai/aiChat'
import type { AiChatCancelInput, AiChatExchangeRequestInput, AiChatResponseInput } from '@shared/contracts/aiChat'

export const registerAiChatIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('ai:chat-exchange-request', (_event, input: AiChatExchangeRequestInput) => createAiChatExchangeRequest(input))
  ipcMain.handle('ai:chat-response', (_event, input: AiChatResponseInput) => generateAiChatResponse(input))
  ipcMain.handle('ai:chat-response:cancel', (_event, input: AiChatCancelInput) => cancelAiChatResponse(input))
}
