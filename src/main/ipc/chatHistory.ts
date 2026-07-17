import type { IpcMain } from 'electron'
import {
  createChatConversation,
  deleteChatConversation,
  deselectChatConversation,
  getChatConversationMessages,
  listChatConversations,
  restoreChatConversation,
  saveChatMessageMetadata,
  updateChatConversation
} from '../backend/chat/chatHistory'
import type {
  AiChatConversationDeleteResult,
  AiChatConversationRecord,
  AiChatHistoryMessage,
  AiChatConversationUpdateInput,
  AiChatMessageMetadataInput
} from '@shared/contracts/aiChat'

type RegisterChatHistoryIpcInput = {
  syncProductSession?: (
    conversation: AiChatConversationRecord,
    options?: { isOpen?: boolean; createIsOpen?: boolean; projectionMessages?: AiChatHistoryMessage[] }
  ) => void
  deleteProductSession?: (id: string) => Promise<{ id: string; deleted: boolean }>
}

export const registerChatHistoryIpc = (ipcMain: IpcMain, input: RegisterChatHistoryIpcInput = {}) => {
  const syncClosedProductSessions = () => {
    const result = listChatConversations()
    if (result.ok) {
      result.data?.conversations.forEach((conversation) => {
        input.syncProductSession?.(conversation, { createIsOpen: false })
      })
    }
    return result
  }

  // Agents is the only closed-session catalog, so legacy Classic projections
  // must be indexed before any renderer chooses whether to open Classic mode.
  syncClosedProductSessions()

  ipcMain.handle('chat-history:list', () => syncClosedProductSessions())
  ipcMain.handle('chat-history:deselect', (_event, expectedConversationId: string) => deselectChatConversation(expectedConversationId))
  ipcMain.handle('chat-history:create', () => {
    const result = createChatConversation()
    if (result.ok && result.data?.conversation) input.syncProductSession?.(result.data.conversation, { isOpen: true })
    return result
  })
  ipcMain.handle('chat-history:update', (_event, updateInput: AiChatConversationUpdateInput) => {
    const result = updateChatConversation(updateInput)
    if (result.ok && result.data?.conversation) {
      const submittedIds = new Set((updateInput.messages || []).map((message) => message.id))
      const stored = updateInput.messages ? getChatConversationMessages(updateInput.id) : null
      const projectionMessages = stored?.ok && stored.data
        ? stored.data.messages.filter((message) => submittedIds.has(message.id))
        : undefined
      input.syncProductSession?.(result.data.conversation, {
        ...(projectionMessages ? { projectionMessages } : {})
      })
    }
    return result
  })
  ipcMain.handle('chat-history:delete', async (_event, id: string) => {
    if (!input.deleteProductSession) return deleteChatConversation(id)
    const snapshot = listChatConversations()
    const conversation = snapshot.data?.conversations.find((candidate) => candidate.id === id)
    if (!snapshot.ok || !conversation) {
      return {
        ok: false,
        errorCode: 'CHAT_HISTORY_NOT_FOUND',
        errorMessage: 'Conversation not found.'
      } satisfies AiChatConversationDeleteResult
    }
    input.syncProductSession?.(conversation, { createIsOpen: false })
    try {
      const deleted = await input.deleteProductSession(id)
      if (!deleted.deleted) {
        return {
          ok: false,
          errorCode: 'PRODUCT_SESSION_DELETE_FAILED',
          errorMessage: 'Product session could not be permanently deleted.'
        } satisfies AiChatConversationDeleteResult
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: 'PRODUCT_SESSION_DELETE_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error)
      } satisfies AiChatConversationDeleteResult
    }
    const remaining = listChatConversations()
    return {
      ok: true,
      data: {
        deletedId: id,
        conversations: remaining.data?.conversations || [],
        selectedConversationId: remaining.data?.selectedConversationId || ''
      }
    } satisfies AiChatConversationDeleteResult
  })
  ipcMain.handle('chat-history:restore', (_event, id: string) => {
    const result = restoreChatConversation(id)
    if (result.ok && result.data?.conversation) input.syncProductSession?.(result.data.conversation, { isOpen: true })
    return result
  })
  ipcMain.handle('chat-history:message-metadata', (_event, metadataInput: AiChatMessageMetadataInput) => {
    const result = saveChatMessageMetadata(metadataInput)
    if (result.ok && result.data?.conversation) input.syncProductSession?.(result.data.conversation)
    return result
  })
}
