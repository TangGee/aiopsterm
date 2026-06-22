import {
  isAiChatConversationDeleteData,
  isAiChatConversationMutationData,
  isAiChatConversationRestoreData,
  isAiChatHistorySnapshotData,
  isAiChatMessageMetadataData
} from '@/services/aiChatBackendGuards'
import { malformedAiBackendResultMessage } from '@/services/aiBackendGuards'
import { chatHistoryClient } from '@/services/chatHistoryClient'
import type { I18nKey } from '@/i18n/messages'
import type {
  AiChatConversationRecord,
  AiChatHistoryHostContext,
  AiChatHistoryMessage,
  AiContextOption
} from '@shared/contracts/aiChat'
import type { ChatMessage, ConversationItem, WorkspaceAiChatControllerState } from '@/services/workspaceAiChatTypes'

export type WorkspaceAiChatHistoryRuntime = ReturnType<typeof createWorkspaceAiChatHistoryRuntime>

const autoNamedConversationTitles = new Set([
  '新会话',
  '新建会话',
  '未命名会话',
  '新建對話',
  '未命名對話',
  'New chat',
  'Untitled chat',
  'New Chat',
  'Untitled Chat',
  '新しいチャット',
  '無題のチャット',
  '새 채팅',
  '제목 없는 채팅',
  'Neuer Chat',
  'Unbenannter Chat',
  'Nouveau chat',
  'Chat sans titre',
  'Nuova chat',
  'Chat senza titolo',
  'Nova conversa',
  'Conversa sem título',
  'Новый чат',
  'Чат без названия',
  'محادثة جديدة',
  'محادثة بلا عنوان'
])

export const cloneStructuredValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isAutoNamedConversationTitle = (title: string) => autoNamedConversationTitles.has(title.trim())

const conversationTitleFromPrompt = (prompt: string) => {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized
}

export const cloneConversationRecord = (conversation: AiChatConversationRecord): ConversationItem => ({
  id: conversation.id,
  title: conversation.title,
  summary: conversation.summary,
  updatedAt: conversation.updatedAt,
  ts: conversation.ts,
  ipAddress: conversation.ipAddress,
  favorite: conversation.favorite
})

const historyHostToContext = (host: AiChatHistoryHostContext): AiContextOption => ({
  id: host.id,
  kind: 'hosts',
  label: host.label,
  detail: host.detail
})

export const chatHistoryMessageToChatMessage = (message: AiChatHistoryMessage): ChatMessage => ({
  id: message.id,
  role: message.role,
  text: message.text,
  contentParts: message.contentParts ? cloneStructuredValue(message.contentParts) : undefined,
  hosts: message.hosts?.map(historyHostToContext),
  state: message.state,
  favorite: message.favorite,
  feedback: message.feedback,
  executedCommand: message.executedCommand,
  commandExecutionStatus: message.commandExecutionStatus,
  commandExecutionMessage: message.commandExecutionMessage,
  ask: message.ask,
  say: message.say,
  action: message.action,
  commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined,
  mcpToolCall: message.mcpToolCall ? cloneStructuredValue(message.mcpToolCall) : undefined,
  mcpResourceAccess: message.mcpResourceAccess ? cloneStructuredValue(message.mcpResourceAccess) : undefined,
  followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
  selectedOption: message.selectedOption,
  partial: message.partial
})

export const chatMessageToHistoryMessage = (message: ChatMessage): AiChatHistoryMessage | null => {
  const text = message.text.trim()
  if (!text) return null
  const hosts = message.hosts
    ?.filter((host) => host.kind === 'hosts' && host.label.trim())
    .map((host): AiChatHistoryHostContext => ({
      id: host.id,
      kind: 'hosts',
      label: host.label,
      detail: host.detail
    }))
  return {
    id: message.id,
    role: message.role,
    text,
    hosts: hosts?.length ? hosts : undefined,
    state: message.state,
    favorite: message.favorite,
    feedback: message.feedback,
    contentParts: message.contentParts ? cloneStructuredValue(message.contentParts) : undefined,
    executedCommand: message.executedCommand,
    commandExecutionStatus: message.commandExecutionStatus,
    commandExecutionMessage: message.commandExecutionMessage,
    ask: message.ask,
    say: message.say,
    action: message.action,
    commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined,
    mcpToolCall: message.mcpToolCall ? cloneStructuredValue(message.mcpToolCall) : undefined,
    mcpResourceAccess: message.mcpResourceAccess ? cloneStructuredValue(message.mcpResourceAccess) : undefined,
    followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
    selectedOption: message.selectedOption,
    partial: message.partial
  }
}

export const createWorkspaceAiChatHistoryRuntime = (input: {
  state: Pick<WorkspaceAiChatControllerState, 'conversations' | 'selectedConversationId' | 'chatMessages' | 'aiContextUsage'>
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
}) => {
  const { state, setTopNotice, i18nText } = input
  const { conversations, selectedConversationId, chatMessages, aiContextUsage } = state

  const clearAiContextUsage = () => {
    aiContextUsage.value = null
  }

  const currentChatHistoryMessages = () => chatMessages.value.map(chatMessageToHistoryMessage).filter(Boolean) as AiChatHistoryMessage[]

  const applyChatHistorySnapshot = (snapshot: { conversations: AiChatConversationRecord[]; selectedConversationId: string }) => {
    conversations.value = snapshot.conversations.map(cloneConversationRecord)
    selectedConversationId.value = conversations.value.some((conversation) => conversation.id === snapshot.selectedConversationId)
      ? snapshot.selectedConversationId
      : conversations.value[0]?.id || ''
  }

  const applyChatMessageSnapshot = (messages: AiChatHistoryMessage[]) => {
    chatMessages.value = messages.map(chatHistoryMessageToChatMessage)
    clearAiContextUsage()
  }

  const upsertConversationRecord = (conversation: AiChatConversationRecord) => {
    const existing = conversations.value.find((item) => item.id === conversation.id)
    const nextConversation = cloneConversationRecord(conversation)
    conversations.value = existing
      ? conversations.value.map((item) => (item.id === nextConversation.id ? nextConversation : item))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    return nextConversation
  }

  const restoreChatMessagesFromBackend = async (id: string) => {
    const restoreChatConversation = chatHistoryClient.restoreChatConversation()
    if (!restoreChatConversation) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await restoreChatConversation(id)
    } catch {
      setTopNotice('会话历史加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || '会话历史加载失败')
      return false
    }
    if (!isAiChatConversationRestoreData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    const data = result.data
    upsertConversationRecord(data.conversation)
    chatMessages.value = data.messages.map(chatHistoryMessageToChatMessage)
    if (data.truncated) {
      setTopNotice(i18nText('ai.historyRestoreTruncated', { count: data.returnedMessages ?? data.messages.length }))
    }
    clearAiContextUsage()
    return true
  }

  const loadChatConversationsFromBackend = async (options: { restoreIfEmpty?: boolean } = {}) => {
    const listChatConversations = chatHistoryClient.listChatConversations()
    if (!listChatConversations) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await listChatConversations()
    } catch {
      setTopNotice('会话历史加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || '会话历史加载失败')
      return false
    }
    if (!isAiChatHistorySnapshotData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    applyChatHistorySnapshot(result.data)
    if (options.restoreIfEmpty !== false && chatMessages.value.length === 0 && selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    }
    return true
  }

  const updateCurrentConversationSnapshot = async (summary?: string, options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) => {
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
      return false
    }
    let id = selectedConversationId.value
    if (!id || !conversations.value.some((conversation) => conversation.id === id)) {
      const createChatConversation = chatHistoryClient.createChatConversation()
      if (!createChatConversation) {
        if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
        return false
      }
      const created = await createChatConversation()
      if (!created?.ok || !isAiChatConversationMutationData(created.data)) {
        if (options.notifyFailure) setTopNotice(created?.errorMessage || '会话历史写入失败')
        return false
      }
      applyChatHistorySnapshot({
        conversations: created.data.conversations,
        selectedConversationId: created.data.selectedConversationId
      })
      id = created.data.conversation.id
    }
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const nextTitle = summary && isAutoNamedConversationTitle(conversation.title) ? conversationTitleFromPrompt(summary) || conversation.title : conversation.title
    const result = await updateChatConversation({
      id,
      title: nextTitle,
      summary: summary || conversation.summary,
      favorite: conversation.favorite,
      messages: currentChatHistoryMessages()
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) {
      if (options.notifyFailure) setTopNotice(result?.errorMessage || '会话历史写入失败')
      return false
    }
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const syncCurrentConversationSnapshot = (options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) =>
    updateCurrentConversationSnapshot(undefined, options)

  const createConversation = async () => {
    const createChatConversation = chatHistoryClient.createChatConversation()
    if (!createChatConversation) return null
    const result = await createChatConversation()
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return null
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    await restoreChatMessagesFromBackend(result.data.conversation.id)
    return conversations.value.find((conversation) => conversation.id === result.data!.conversation.id) || cloneConversationRecord(result.data.conversation)
  }

  const deleteConversation = async (id: string) => {
    const deleteChatConversation = chatHistoryClient.deleteChatConversation()
    if (!deleteChatConversation) return false
    const result = await deleteChatConversation(id)
    if (!result?.ok || !isAiChatConversationDeleteData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    if (selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    } else {
      chatMessages.value = []
      clearAiContextUsage()
    }
    return true
  }

  const selectConversation = (id: string) => {
    selectedConversationId.value = id
    clearAiContextUsage()
  }

  const updateConversationMetadata = async (id: string, input: { title?: string; favorite?: boolean }) => {
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const nextTitle = input.title === undefined ? conversation.title : input.title.trim()
    if (!nextTitle) return false
    const result = await updateChatConversation({
      id,
      title: nextTitle,
      summary: conversation.summary,
      favorite: input.favorite ?? conversation.favorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const renameConversation = (id: string, title: string) => updateConversationMetadata(id, { title })

  const toggleConversationFavorite = (id: string) => {
    const conversation = conversations.value.find((item) => item.id === id)
    return conversation ? updateConversationMetadata(id, { favorite: !conversation.favorite }) : Promise.resolve(false)
  }

  const restoreConversation = async (id: string) => {
    const restored = await restoreChatMessagesFromBackend(id)
    if (restored) return true
    if (await loadChatConversationsFromBackend({ restoreIfEmpty: false })) {
      return restoreChatMessagesFromBackend(id)
    }
    return false
  }

  const applyMessageMetadataSnapshot = (messageId: string, messages: AiChatHistoryMessage[]) => {
    const snapshot = messages.find((message) => message.id === messageId)
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!snapshot || !message) return false
    message.favorite = snapshot.favorite
    message.feedback = snapshot.feedback
    return true
  }

  const saveMessageMetadata = async (id: string, input: { favorite?: boolean; feedback?: 'up' | 'down' | null }) => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    const saveChatMessageMetadata = chatHistoryClient.saveChatMessageMetadata()
    if (!saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const result = await saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      ...input
    })
    if (!result?.ok || !isAiChatMessageMetadataData(result.data)) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const setMessageFeedback = async (id: string, feedback: 'up' | 'down') => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message) return false
    return saveMessageMetadata(id, { feedback: message.feedback === feedback ? null : feedback })
  }

  const toggleMessageFavorite = async (id: string) => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message) return false
    return saveMessageMetadata(id, { favorite: !message.favorite })
  }

  return {
    clearAiContextUsage,
    currentChatHistoryMessages,
    applyChatHistorySnapshot,
    applyChatMessageSnapshot,
    upsertConversationRecord,
    restoreChatMessagesFromBackend,
    loadChatConversationsFromBackend,
    updateCurrentConversationSnapshot,
    syncCurrentConversationSnapshot,
    createConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation,
    setMessageFeedback,
    toggleMessageFavorite
  }
}
