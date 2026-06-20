import type { IpcMain } from 'electron'
import {
  createChatConversation,
  deleteChatConversation,
  listChatConversations,
  restoreChatConversation,
  saveChatMessageMetadata,
  updateChatConversation
} from '../backend/chatHistory'
import type { AiChatConversationUpdateInput, AiChatMessageMetadataInput } from '@shared/preload'

export const registerChatHistoryIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('chat-history:list', () => listChatConversations())
  ipcMain.handle('chat-history:create', () => createChatConversation())
  ipcMain.handle('chat-history:update', (_event, input: AiChatConversationUpdateInput) => updateChatConversation(input))
  ipcMain.handle('chat-history:delete', (_event, id: string) => deleteChatConversation(id))
  ipcMain.handle('chat-history:restore', (_event, id: string) => restoreChatConversation(id))
  ipcMain.handle('chat-history:message-metadata', (_event, input: AiChatMessageMetadataInput) => saveChatMessageMetadata(input))
}
