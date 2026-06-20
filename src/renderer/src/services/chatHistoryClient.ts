import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type ChatHistoryBridge = Pick<
  AiopsPreloadApi,
  | 'listChatConversations'
  | 'createChatConversation'
  | 'updateChatConversation'
  | 'deleteChatConversation'
  | 'restoreChatConversation'
  | 'saveChatMessageMetadata'
>

const bridgeMethod = <Name extends keyof ChatHistoryBridge>(name: Name): ChatHistoryBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as ChatHistoryBridge[Name]) : undefined
}

export const chatHistoryClient = {
  listChatConversations: () => bridgeMethod('listChatConversations'),
  createChatConversation: () => bridgeMethod('createChatConversation'),
  updateChatConversation: () => bridgeMethod('updateChatConversation'),
  deleteChatConversation: () => bridgeMethod('deleteChatConversation'),
  restoreChatConversation: () => bridgeMethod('restoreChatConversation'),
  saveChatMessageMetadata: () => bridgeMethod('saveChatMessageMetadata')
}
