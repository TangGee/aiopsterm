import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type {
  AiChatConversationDeleteResult,
  AiChatConversationMutationResult,
  AiChatConversationRecord,
  AiChatConversationRestoreResult,
  AiChatConversationUpdateInput,
  AiChatHistoryListResult,
  AiChatHistoryMessage,
  AiChatMessageMetadataInput,
  AiChatMessageMetadataResult
} from '@shared/preload'

type ChatHistoryStoreShape = {
  conversations: AiChatConversationRecord[]
  messagesByConversationId: Record<string, AiChatHistoryMessage[]>
  selectedConversationId: string
}

type ChatHistoryHostContext = NonNullable<AiChatHistoryMessage['hosts']>[number]

const nowText = () => '刚刚'

const cloneConversation = (conversation: AiChatConversationRecord): AiChatConversationRecord => ({ ...conversation })

const cloneMessage = (message: AiChatHistoryMessage): AiChatHistoryMessage => ({
  ...message,
  hosts: message.hosts ? message.hosts.map((host) => ({ ...host })) : undefined
})

const cloneMessages = (messages: AiChatHistoryMessage[]) => messages.map(cloneMessage)

const seedTime = 1780488000000

const defaultState = (): ChatHistoryStoreShape => ({
  selectedConversationId: 'conv-1',
  conversations: [
    {
      id: 'conv-1',
      title: '生产巡检',
      summary: '分析磁盘、负载和服务状态',
      updatedAt: '刚刚',
      ts: seedTime,
      ipAddress: '10.24.8.12'
    },
    {
      id: 'conv-2',
      title: 'K8s 发布失败',
      summary: '检查 Pod 事件和镜像拉取',
      updatedAt: '今天',
      ts: seedTime - 1000 * 60 * 45,
      ipAddress: 'prod-cluster'
    },
    {
      id: 'conv-3',
      title: '数据库慢查询',
      summary: '梳理慢日志和索引建议',
      updatedAt: '昨天',
      ts: seedTime - 1000 * 60 * 60 * 24,
      ipAddress: '10.32.6.9'
    }
  ],
  messagesByConversationId: {
    'conv-1': [
      { id: 'hist-conv-1-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-1-user', role: 'user', text: '分析磁盘、负载和服务状态', hosts: [{ id: 'history-host-conv-1', kind: 'hosts', label: '10.24.8.12', detail: '生产巡检' }] },
      { id: 'hist-conv-1-assistant', role: 'assistant', text: '生产巡检历史包含磁盘容量、负载趋势和核心服务状态检查记录。', state: 'done' }
    ],
    'conv-2': [
      { id: 'hist-conv-2-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-2-user', role: 'user', text: '检查 Pod 事件和镜像拉取', hosts: [{ id: 'history-host-conv-2', kind: 'hosts', label: 'prod-cluster', detail: 'K8s 发布失败' }] },
      { id: 'hist-conv-2-assistant', role: 'assistant', text: 'K8s 发布失败历史包含 Pod 事件、镜像拉取状态和回滚检查记录。', state: 'done' }
    ],
    'conv-3': [
      { id: 'hist-conv-3-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-3-user', role: 'user', text: '梳理慢日志和索引建议', hosts: [{ id: 'history-host-conv-3', kind: 'hosts', label: '10.32.6.9', detail: '数据库慢查询' }] },
      { id: 'hist-conv-3-assistant', role: 'assistant', text: '数据库慢查询历史包含慢日志摘要、疑似缺失索引和 SQL 优化建议。', state: 'done' }
    ]
  }
})

const normalizeText = (value: unknown) => String(value || '').trim()

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeMessages = (messages: unknown): AiChatHistoryMessage[] => {
  if (!Array.isArray(messages)) return []
  return messages
    .map((item, index): AiChatHistoryMessage | null => {
      if (!isRecord(item)) return null
      const role = item.role === 'user' || item.role === 'assistant' || item.role === 'system' ? item.role : null
      const text = normalizeText(item.text)
      if (!role || !text) return null
      const hosts = Array.isArray(item.hosts)
        ? item.hosts
            .map((host): ChatHistoryHostContext | null => {
              if (!isRecord(host)) return null
              const label = normalizeText(host.label)
              if (!label) return null
              return {
                id: normalizeText(host.id) || `history-host-${index}`,
                kind: 'hosts',
                label,
                detail: normalizeText(host.detail) || undefined
              }
            })
            .filter(Boolean) as AiChatHistoryMessage['hosts']
        : undefined
      return {
        id: normalizeText(item.id) || `history-message-${index + 1}`,
        role,
        text,
        hosts: hosts?.length ? hosts : undefined,
        state: item.state === 'streaming' || item.state === 'done' ? item.state : undefined,
        favorite: item.favorite === undefined ? undefined : Boolean(item.favorite),
        feedback: item.feedback === 'up' || item.feedback === 'down' ? item.feedback : undefined
      }
    })
    .filter(Boolean) as AiChatHistoryMessage[]
}

const normalizeState = (source?: Partial<ChatHistoryStoreShape>): ChatHistoryStoreShape => {
  const fallback = defaultState()
  const rawConversations = Array.isArray(source?.conversations) ? source.conversations : fallback.conversations
  const conversations = rawConversations
    .map((item, index): AiChatConversationRecord | null => {
      if (!isRecord(item)) return null
      const id = normalizeText(item.id) || `conv-${index + 1}`
      const title = normalizeText(item.title) || 'New Chat'
      return {
        id,
        title,
        summary: normalizeText(item.summary) || title,
        updatedAt: normalizeText(item.updatedAt) || nowText(),
        ts: typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now() - index,
        ipAddress: normalizeText(item.ipAddress) || undefined,
        favorite: Boolean(item.favorite)
      }
    })
    .filter(Boolean) as AiChatConversationRecord[]
  const nextMessages: Record<string, AiChatHistoryMessage[]> = {}
  const rawMessages = isRecord(source?.messagesByConversationId) ? source.messagesByConversationId : fallback.messagesByConversationId
  conversations.forEach((conversation) => {
    const messages = normalizeMessages(rawMessages[conversation.id])
    nextMessages[conversation.id] = messages.length
      ? messages
      : [
          { id: `history-${conversation.id}-user`, role: 'user', text: conversation.summary || conversation.title },
          { id: `history-${conversation.id}-assistant`, role: 'assistant', text: `${conversation.title} history restored from aiopsterm backend.`, state: 'done' }
        ]
  })
  const selectedConversationId = conversations.some((item) => item.id === source?.selectedConversationId)
    ? String(source?.selectedConversationId)
    : conversations[0]?.id || ''
  return { conversations, messagesByConversationId: nextMessages, selectedConversationId }
}

class ChatHistoryStore {
  private store: Store<ChatHistoryStoreShape> | null = null
  private memory = defaultState()

  constructor() {
    try {
      this.store = new Store<ChatHistoryStoreShape>({
        name: 'aiopsterm-chat-history',
        defaults: defaultState()
      })
    } catch {
      this.store = null
    }
  }

  get(): ChatHistoryStoreShape {
    const normalized = normalizeState(this.store ? this.store.store : this.memory)
    this.save(normalized)
    return normalizeState(normalized)
  }

  save(state: ChatHistoryStoreShape) {
    const normalized = normalizeState(state)
    if (this.store) {
      this.store.set('conversations', normalized.conversations)
      this.store.set('messagesByConversationId', normalized.messagesByConversationId)
      this.store.set('selectedConversationId', normalized.selectedConversationId)
    } else {
      this.memory = normalizeState(normalized)
    }
  }
}

const store = new ChatHistoryStore()

const successSnapshot = (state: ChatHistoryStoreShape): AiChatHistoryListResult => ({
  ok: true,
  data: {
    conversations: state.conversations.map(cloneConversation),
    selectedConversationId: state.selectedConversationId
  }
})

const mutationResult = (state: ChatHistoryStoreShape, conversation: AiChatConversationRecord): AiChatConversationMutationResult => ({
  ok: true,
  data: {
    conversation: cloneConversation(conversation),
    conversations: state.conversations.map(cloneConversation),
    selectedConversationId: state.selectedConversationId
  }
})

const errorResult = <T>(errorCode: string, errorMessage: string): { ok: false; errorCode: string; errorMessage: string } => ({
  ok: false,
  errorCode,
  errorMessage
})

export const listChatConversations = (): AiChatHistoryListResult => successSnapshot(store.get())

export const createChatConversation = (): AiChatConversationMutationResult => {
  const state = store.get()
  const conversation: AiChatConversationRecord = {
    id: `conv-${randomUUID()}`,
    title: '新会话',
    summary: '等待输入运维目标',
    updatedAt: nowText(),
    ts: Math.max(Date.now(), ...state.conversations.map((item) => item.ts), 0) + 1
  }
  state.conversations.unshift(conversation)
  state.selectedConversationId = conversation.id
  state.messagesByConversationId[conversation.id] = [{ id: `history-${conversation.id}-assistant`, role: 'assistant', text: '请输入本次运维目标。', state: 'done' }]
  store.save(state)
  return mutationResult(state, conversation)
}

export const updateChatConversation = (input: AiChatConversationUpdateInput): AiChatConversationMutationResult => {
  const id = normalizeText(input.id)
  if (!id) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatConversationMutationResult
  const state = store.get()
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatConversationMutationResult

  if (input.title !== undefined) {
    const title = normalizeText(input.title)
    if (!title) return errorResult('CHAT_HISTORY_TITLE_REQUIRED', 'Conversation title is required.') as AiChatConversationMutationResult
    conversation.title = title
  }
  if (input.summary !== undefined) conversation.summary = normalizeText(input.summary) || conversation.summary
  if (input.favorite !== undefined) conversation.favorite = Boolean(input.favorite)
  let savedMessages = false
  if (input.messages !== undefined) {
    const messages = normalizeMessages(input.messages)
    if (messages.length) {
      state.messagesByConversationId[id] = messages
      savedMessages = true
    }
  }
  conversation.updatedAt = nowText()
  conversation.ts = Math.max(Date.now(), ...state.conversations.map((item) => item.ts), 0) + 1
  if (savedMessages) state.selectedConversationId = id
  store.save(state)
  return mutationResult(state, conversation)
}

export const deleteChatConversation = (idInput: string): AiChatConversationDeleteResult => {
  const id = normalizeText(idInput)
  if (!id) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatConversationDeleteResult
  const state = store.get()
  if (!state.conversations.some((item) => item.id === id)) {
    return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatConversationDeleteResult
  }
  state.conversations = state.conversations.filter((item) => item.id !== id)
  delete state.messagesByConversationId[id]
  if (state.selectedConversationId === id) state.selectedConversationId = state.conversations[0]?.id || ''
  store.save(state)
  return {
    ok: true,
    data: {
      deletedId: id,
      conversations: state.conversations.map(cloneConversation),
      selectedConversationId: state.selectedConversationId
    }
  }
}

export const restoreChatConversation = (idInput: string): AiChatConversationRestoreResult => {
  const id = normalizeText(idInput)
  if (!id) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatConversationRestoreResult
  const state = store.get()
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatConversationRestoreResult
  state.selectedConversationId = id
  store.save(state)
  return {
    ok: true,
    data: {
      conversation: cloneConversation(conversation),
      messages: cloneMessages(state.messagesByConversationId[id] || [])
    }
  }
}

export const saveChatMessageMetadata = (input: AiChatMessageMetadataInput): AiChatMessageMetadataResult => {
  const conversationId = normalizeText(input.conversationId)
  const messageId = normalizeText(input.messageId)
  if (!conversationId) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatMessageMetadataResult
  if (!messageId) return errorResult('CHAT_HISTORY_MESSAGE_ID_REQUIRED', 'Message id is required.') as AiChatMessageMetadataResult
  const state = store.get()
  const conversation = state.conversations.find((item) => item.id === conversationId)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatMessageMetadataResult
  const messages = state.messagesByConversationId[conversationId] || []
  const message = messages.find((item) => item.id === messageId)
  if (!message) return errorResult('CHAT_HISTORY_MESSAGE_NOT_FOUND', 'Message not found.') as AiChatMessageMetadataResult
  if (input.favorite !== undefined) message.favorite = Boolean(input.favorite)
  if (input.feedback !== undefined) {
    if (input.feedback === 'up' || input.feedback === 'down') {
      message.feedback = input.feedback
    } else {
      delete message.feedback
    }
  }
  state.messagesByConversationId[conversationId] = messages
  store.save(state)
  return {
    ok: true,
    data: {
      conversation: cloneConversation(conversation),
      messages: cloneMessages(messages)
    }
  }
}
