import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ChatHistoryBridge = Pick<
  AiopsPreloadApi,
  | 'listChatConversations'
  | 'createChatConversation'
  | 'updateChatConversation'
  | 'deleteChatConversation'
  | 'restoreChatConversation'
  | 'saveChatMessageMetadata'
>

const bridgeMethod = createBridgeMethod<ChatHistoryBridge>()

export const chatHistoryClient = {
  listChatConversations: () => bridgeMethod('listChatConversations'),
  createChatConversation: () => bridgeMethod('createChatConversation'),
  updateChatConversation: () => bridgeMethod('updateChatConversation'),
  deleteChatConversation: () => bridgeMethod('deleteChatConversation'),
  restoreChatConversation: () => bridgeMethod('restoreChatConversation'),
  saveChatMessageMetadata: () => bridgeMethod('saveChatMessageMetadata')
}
