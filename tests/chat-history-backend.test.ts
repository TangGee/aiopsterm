import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
    }

    set(key: keyof T, value: T[keyof T]) {
      this.store[key] = value
    }
  }

  return { default: MockStore }
})

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/chatHistory'
  return import(modulePath)
}

describe('AI chat history backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('lists backend-owned seed conversations', async () => {
    const backend = await loadBackend()
    const result = backend.listChatConversations()

    expect(result.ok).toBe(true)
    expect(result.data.selectedConversationId).toBe('conv-1')
    expect(result.data.conversations.map((conversation: { id: string }) => conversation.id)).toEqual(['conv-1', 'conv-2', 'conv-3'])
  })

  it('validates rename input and persists title/favorite mutations', async () => {
    const backend = await loadBackend()

    expect(backend.updateChatConversation({ id: 'conv-2', title: '   ' })).toEqual({
      ok: false,
      errorCode: 'CHAT_HISTORY_TITLE_REQUIRED',
      errorMessage: 'Conversation title is required.'
    })

    const renamed = backend.updateChatConversation({ id: 'conv-2', title: 'K8s 发布复盘', favorite: true })
    expect(renamed.ok).toBe(true)
    expect(renamed.data.conversation).toMatchObject({ id: 'conv-2', title: 'K8s 发布复盘', favorite: true })
    expect(renamed.data.selectedConversationId).toBe('conv-1')

    const list = backend.listChatConversations()
    expect(list.data.selectedConversationId).toBe('conv-1')
    expect(list.data.conversations.find((conversation: { id: string }) => conversation.id === 'conv-2')).toMatchObject({
      title: 'K8s 发布复盘',
      favorite: true
    })
  })

  it('restores backend message snapshots without renderer-generated summaries', async () => {
    const backend = await loadBackend()
    const restored = backend.restoreChatConversation('conv-2')

    expect(restored.ok).toBe(true)
    expect(restored.data.conversation.id).toBe('conv-2')
    expect(restored.data.messages.at(0).text).toContain('历史会话已从 aiopsterm 后端恢复')
    expect(restored.data.messages.at(-1).text).toContain('K8s 发布失败历史包含 Pod 事件')
    expect(restored.data.messages.at(-1).text).not.toContain('本地历史摘要')
    expect(restored.data.messages.find((message: { role: string }) => message.role === 'user')?.hosts?.[0]).toMatchObject({
      kind: 'hosts',
      label: 'prod-cluster'
    })
  })

  it('creates, updates message snapshots, and deletes conversations behind the boundary', async () => {
    const backend = await loadBackend()
    const created = backend.createChatConversation()

    expect(created.ok).toBe(true)
    expect(created.data.conversation).toMatchObject({ title: '新会话', summary: '等待输入运维目标' })
    expect(created.data.selectedConversationId).toBe(created.data.conversation.id)

    const saved = backend.updateChatConversation({
      id: created.data.conversation.id,
      summary: '检查发布状态',
      messages: [
        { id: 'history-user', role: 'user', text: '检查发布状态', hosts: [{ id: 'history-host', kind: 'hosts', label: 'prod-cluster' }] },
        { id: 'history-assistant', role: 'assistant', text: '发布状态检查完成。', state: 'done' }
      ]
    })
    expect(saved.ok).toBe(true)
    expect(saved.data.selectedConversationId).toBe(created.data.conversation.id)

    const restored = backend.restoreChatConversation(created.data.conversation.id)
    expect(restored.data.messages).toEqual([
      { id: 'history-user', role: 'user', text: '检查发布状态', hosts: [{ id: 'history-host', kind: 'hosts', label: 'prod-cluster' }] },
      { id: 'history-assistant', role: 'assistant', text: '发布状态检查完成。', state: 'done' }
    ])

    const metadata = backend.saveChatMessageMetadata({
      conversationId: created.data.conversation.id,
      messageId: 'history-assistant',
      favorite: true,
      feedback: 'up'
    })
    expect(metadata.ok).toBe(true)
    expect(metadata.data.messages.find((message: { id: string }) => message.id === 'history-assistant')).toMatchObject({
      favorite: true,
      feedback: 'up'
    })
    const clearedFeedback = backend.saveChatMessageMetadata({
      conversationId: created.data.conversation.id,
      messageId: 'history-assistant',
      feedback: null
    })
    expect(clearedFeedback.ok).toBe(true)
    expect(clearedFeedback.data.messages.find((message: { id: string }) => message.id === 'history-assistant')).toMatchObject({
      favorite: true
    })
    expect(clearedFeedback.data.messages.find((message: { id: string }) => message.id === 'history-assistant')?.feedback).toBeUndefined()
    expect(backend.restoreChatConversation(created.data.conversation.id).data.messages.at(-1)).toEqual({
      id: 'history-assistant',
      role: 'assistant',
      text: '发布状态检查完成。',
      state: 'done',
      favorite: true
    })

    const deleted = backend.deleteChatConversation(created.data.conversation.id)
    expect(deleted.ok).toBe(true)
    expect(deleted.data.conversations.some((conversation: { id: string }) => conversation.id === created.data.conversation.id)).toBe(false)
    expect(backend.restoreChatConversation(created.data.conversation.id)).toEqual({
      ok: false,
      errorCode: 'CHAT_HISTORY_NOT_FOUND',
      errorMessage: 'Conversation not found.'
    })
  })
})
