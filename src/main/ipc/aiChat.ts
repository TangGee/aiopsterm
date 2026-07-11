import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { cancelAiChatResponse, createAiChatExchangeRequest, generateAiChatResponse } from '../backend/ai/aiChat'
import { withClineAgentRendererOwner } from '../backend/agent/clineAgentOwnerRuntime'
import type { AiChatCancelInput, AiChatExchangeRequestInput, AiChatResponseInput } from '@shared/contracts/aiChat'

type RegisterAiChatIpcInput = {
  isTrustedTerminalSession?: (event: IpcMainInvokeEvent, terminalSessionId: string) => boolean
}

const terminalSessionError = () => ({
  ok: false as const,
  errorCode: 'AI_CHAT_TERMINAL_SESSION_INVALID',
  errorMessage: 'The selected terminal session is unavailable for this window.'
})

export const registerAiChatIpc = (ipcMain: IpcMain, runtime: RegisterAiChatIpcInput = {}) => {
  const runWithTrustedTerminal = <T extends { terminalSessionId?: string }>(
    event: IpcMainInvokeEvent,
    input: T,
    callback: () => unknown
  ) => {
    const terminalSessionId = String(input?.terminalSessionId || '').trim()
    if (terminalSessionId && runtime.isTrustedTerminalSession && !runtime.isTrustedTerminalSession(event, terminalSessionId)) {
      return terminalSessionError()
    }
    return withClineAgentRendererOwner(event.sender.id, callback)
  }

  ipcMain.handle('ai:chat-exchange-request', (event, input: AiChatExchangeRequestInput) =>
    runWithTrustedTerminal(event, input, () => createAiChatExchangeRequest(input))
  )
  ipcMain.handle('ai:chat-response', (event, input: AiChatResponseInput) =>
    runWithTrustedTerminal(event, input, () => generateAiChatResponse(input))
  )
  ipcMain.handle('ai:chat-response:cancel', (event, input: AiChatCancelInput) =>
    withClineAgentRendererOwner(event.sender.id, () => cancelAiChatResponse(input))
  )
}
