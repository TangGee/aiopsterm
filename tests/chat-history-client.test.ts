import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatHistoryClient } from '@/services/ai/chatHistoryClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('chatHistoryClient', () => {
  it('returns undefined for unavailable bridge methods and binds chat history methods', async () => {
    window.aiops = {
      ...originalAiops,
      listChatConversations: vi.fn(async () => ({
        ok: true,
        data: { conversations: [], selectedConversationId: '' }
      })),
      deselectChatConversation: vi.fn(async () => ({
        ok: true,
        data: { conversations: [], selectedConversationId: '' }
      })),
      createChatConversation: vi.fn(async () => ({
        ok: true,
        data: {
          conversation: { id: 'conv-1', title: 'New Chat', summary: '', updatedAt: '2026-06-20T00:00:00.000Z', ts: 1 },
          conversations: [{ id: 'conv-1', title: 'New Chat', summary: '', updatedAt: '2026-06-20T00:00:00.000Z', ts: 1 }],
          selectedConversationId: 'conv-1'
        }
      })),
      updateChatConversation: vi.fn(async (input) => ({
        ok: true,
        data: {
          conversation: { id: input.id, title: input.title || 'New Chat', summary: input.summary || '', updatedAt: '2026-06-20T00:00:00.000Z', ts: 2 },
          conversations: [{ id: input.id, title: input.title || 'New Chat', summary: input.summary || '', updatedAt: '2026-06-20T00:00:00.000Z', ts: 2 }],
          selectedConversationId: input.id
        }
      })),
      deleteChatConversation: vi.fn(async (id) => ({
        ok: true,
        data: { deletedId: id, conversations: [], selectedConversationId: '' }
      })),
      restoreChatConversation: vi.fn(async (id) => ({
        ok: true,
        data: {
          conversation: { id, title: 'Restored', summary: '', updatedAt: '2026-06-20T00:00:00.000Z', ts: 3 },
          messages: []
        }
      })),
      saveChatMessageMetadata: vi.fn(async (input) => ({
        ok: true,
        data: {
          conversation: { id: input.conversationId, title: 'Restored', summary: '', updatedAt: '2026-06-20T00:00:00.000Z', ts: 4 },
          messages: []
        }
      }))
    }

    await expect(chatHistoryClient.listChatConversations()?.()).resolves.toEqual({
      ok: true,
      data: { conversations: [], selectedConversationId: '' }
    })
    await expect(chatHistoryClient.deselectChatConversation()?.('conv-1')).resolves.toEqual({
      ok: true,
      data: { conversations: [], selectedConversationId: '' }
    })
    await expect(chatHistoryClient.createChatConversation()?.()).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ selectedConversationId: 'conv-1' }) })
    )
    await expect(chatHistoryClient.updateChatConversation()?.({ id: 'conv-1', title: 'Renamed' })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ selectedConversationId: 'conv-1' }) })
    )
    await expect(chatHistoryClient.deleteChatConversation()?.('conv-1')).resolves.toEqual({
      ok: true,
      data: { deletedId: 'conv-1', conversations: [], selectedConversationId: '' }
    })
    await expect(chatHistoryClient.restoreChatConversation()?.('conv-2')).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ conversation: expect.objectContaining({ id: 'conv-2' }) }) })
    )
    await expect(chatHistoryClient.saveChatMessageMetadata()?.({ conversationId: 'conv-2', messageId: 'msg-1', favorite: true })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ conversation: expect.objectContaining({ id: 'conv-2' }) }) })
    )

    expect(window.aiops.listChatConversations).toHaveBeenCalledTimes(1)
    expect(window.aiops.deselectChatConversation).toHaveBeenCalledWith('conv-1')
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith({ id: 'conv-1', title: 'Renamed' })
    expect(window.aiops.deleteChatConversation).toHaveBeenCalledWith('conv-1')
    expect(window.aiops.restoreChatConversation).toHaveBeenCalledWith('conv-2')
    expect(window.aiops.saveChatMessageMetadata).toHaveBeenCalledWith({ conversationId: 'conv-2', messageId: 'msg-1', favorite: true })

    window.aiops = {
      ...originalAiops,
      listChatConversations: undefined as any,
      deselectChatConversation: undefined as any,
      createChatConversation: undefined as any,
      updateChatConversation: undefined as any,
      deleteChatConversation: undefined as any,
      restoreChatConversation: undefined as any,
      saveChatMessageMetadata: undefined as any
    }
    expect(chatHistoryClient.listChatConversations()).toBeUndefined()
    expect(chatHistoryClient.deselectChatConversation()).toBeUndefined()
    expect(chatHistoryClient.createChatConversation()).toBeUndefined()
    expect(chatHistoryClient.updateChatConversation()).toBeUndefined()
    expect(chatHistoryClient.deleteChatConversation()).toBeUndefined()
    expect(chatHistoryClient.restoreChatConversation()).toBeUndefined()
    expect(chatHistoryClient.saveChatMessageMetadata()).toBeUndefined()
  })
})
