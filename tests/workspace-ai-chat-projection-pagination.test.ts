import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createWorkspaceAiChatHistoryRuntime } from '@/services/ai/workspaceAiChatHistoryRuntime'
import type { AiChatHistoryMessage } from '@shared/contracts/aiChat'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

const historyMessage = (index: number): AiChatHistoryMessage => ({
  id: `message-${index}`,
  role: index % 2 ? 'assistant' : 'user',
  text: `message ${index}`,
  state: 'done'
})

const projectionMessage = (index: number) => ({
  messageId: `message-${index}`,
  ordinal: index,
  payload: historyMessage(index),
  createdAt: 1,
  updatedAt: 1
})

describe('Classic Product Session projection pagination', () => {
  it('restores the latest page and prepends older pages without involving the Cline request path', async () => {
    const listProjection = vi.fn(async (_id: string, input?: { beforeOrdinal?: number }) => {
      if (input?.beforeOrdinal === 40) {
        return {
          ok: true as const,
          data: {
            messages: Array.from({ length: 40 }, (_, index) => projectionMessage(index)),
            hasMore: false,
            nextBeforeOrdinal: null,
            totalMessages: 120
          }
        }
      }
      return {
        ok: true as const,
        data: {
          messages: Array.from({ length: 80 }, (_, index) => projectionMessage(index + 40)),
          hasMore: true,
          nextBeforeOrdinal: 40,
          totalMessages: 120
        }
      }
    })
    const restoreChatConversation = vi.fn(async () => ({
      ok: true as const,
      data: {
        conversation: {
          id: 'classic-paged',
          title: 'Paged',
          summary: '',
          updatedAt: 'now',
          ts: 1
        },
        messages: [historyMessage(119)],
        totalMessages: 120,
        returnedMessages: 1,
        truncated: true
      }
    }))
    const generateAiChatResponse = vi.fn()
    const updateChatConversation = vi.fn(async (input: any) => ({
      ok: true as const,
      data: {
        conversation: { id: input.id, title: 'Paged', summary: '', updatedAt: 'now', ts: 2 },
        conversations: [{ id: input.id, title: 'Paged', summary: '', updatedAt: 'now', ts: 2 }],
        selectedConversationId: input.id
      }
    }))
    window.aiops = {
      ...originalAiops,
      restoreChatConversation,
      listProductSessionProjectionMessages: listProjection,
      generateAiChatResponse,
      updateChatConversation
    }
    const chatMessages = ref<any[]>([])
    const runtime = createWorkspaceAiChatHistoryRuntime({
      state: {
        conversations: ref([]),
        selectedConversationId: ref(''),
        chatMessages,
        aiContextUsage: ref(null)
      },
      setTopNotice: vi.fn(),
      i18nText: vi.fn(() => '') as any
    })

    expect(await runtime.restoreChatMessagesFromBackend('classic-paged')).toBe(true)
    expect(chatMessages.value).toHaveLength(80)
    expect(chatMessages.value[0].id).toBe('message-40')
    expect(chatMessages.value.at(-1)?.id).toBe('message-119')
    expect(await runtime.updateConversationSnapshot('classic-paged', chatMessages.value)).toBe(true)
    expect(updateChatConversation.mock.calls[0][0].messages[0]).toMatchObject({
      id: 'aiopsterm-history-truncated',
      say: 'context_truncated'
    })

    expect(await runtime.loadOlderConversationMessages()).toBe(40)
    expect(chatMessages.value).toHaveLength(120)
    expect(chatMessages.value[0].id).toBe('message-0')
    expect(runtime.currentClineSeedMessages()).toHaveLength(80)
    expect(runtime.currentClineSeedMessages()[0].id).toBe('message-40')
    expect(runtime.currentClineSeedMessages(true)).toHaveLength(120)
    expect(runtime.currentClineSeedMessages(true)[0].id).toBe('message-0')
    expect(listProjection).toHaveBeenNthCalledWith(2, 'classic-paged', { beforeOrdinal: 40, limit: 80 })
    expect(restoreChatConversation).toHaveBeenCalledTimes(1)
    expect(generateAiChatResponse).not.toHaveBeenCalled()
  })

  it('backfills the legacy JSON cache when a Product Session has no projection rows yet', async () => {
    const messages = [historyMessage(0), historyMessage(1)]
    const replaceProjection = vi.fn(async () => ({ ok: true as const, data: { count: messages.length } }))
    window.aiops = {
      ...originalAiops,
      restoreChatConversation: vi.fn(async () => ({
        ok: true as const,
        data: {
          conversation: { id: 'classic-legacy', title: 'Legacy', summary: '', updatedAt: 'now', ts: 1 },
          messages,
          truncated: false
        }
      })),
      listProductSessionProjectionMessages: vi.fn(async () => ({
        ok: true as const,
        data: { messages: [], hasMore: false, nextBeforeOrdinal: null, totalMessages: 0 }
      })),
      replaceProductSessionProjectionMessages: replaceProjection
    }
    const runtime = createWorkspaceAiChatHistoryRuntime({
      state: {
        conversations: ref([]),
        selectedConversationId: ref(''),
        chatMessages: ref([]),
        aiContextUsage: ref(null)
      },
      setTopNotice: vi.fn(),
      i18nText: vi.fn(() => '') as any
    })

    expect(await runtime.restoreChatMessagesFromBackend('classic-legacy')).toBe(true)
    await Promise.resolve()
    expect(replaceProjection).toHaveBeenCalledWith(
      'classic-legacy',
      messages.map((message) => ({ messageId: message.id, payload: message }))
    )
  })
})
