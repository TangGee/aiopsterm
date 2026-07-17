import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import {
  createAiPanelChatNavigationRuntime,
  type AiPanelChatNavigationMessage
} from '@/services/ai/aiPanelChatNavigationRuntime'
import type { AiPanelConversationLike } from '@/services/ai/aiPanelConversationRuntime'
import type { AiChatExportInput, AiChatExportResult } from '@shared/contracts/aiChat'

const translations: Record<string, string> = {
  'ai.historyToday': 'Today',
  'ai.historyYesterday': 'Yesterday',
  'ai.historyDaysAgo': '{count} days ago',
  'ai.historyFavoriteGroup': 'Favorites',
  'ai.untitledChat': 'Untitled',
  'ai.chatCreated': 'chat created',
  'ai.chatCreateFailed': 'chat create failed',
  'ai.chatRestored': 'chat restored',
  'ai.chatRestoreFailed': 'chat restore failed',
  'ai.tabClosed': 'tab closed',
  'ai.tabCloseFailed': 'tab close failed',
  'ai.tabCloseRollbackFailed': 'tab close rollback failed',
  'ai.historyTitleUpdated': 'title updated',
  'ai.historyTitleUpdateFailed': 'title update failed',
  'ai.chatDeleted': 'chat deleted',
  'ai.chatDeleteFailed': 'chat delete failed',
  'ai.historyFavorited': 'favorited',
  'ai.historyUnfavorited': 'unfavorited',
  'ai.historyFavoriteUpdateFailed': 'favorite failed'
}

const createHarness = () => {
  let conversations: AiPanelConversationLike[] = [
    { id: 'conv-1', title: 'First', summary: 'First summary', ts: Date.now(), favorite: true },
    { id: 'conv-2', title: 'Second', ts: Date.now() - 1000 }
  ]
  let selectedConversationId = 'conv-1'
  let messages: AiPanelChatNavigationMessage[] = [
    { id: 'message-1', role: 'user', text: 'hello', hosts: [{ id: 'host-1', kind: 'hosts', label: 'prod' }] }
  ]
  let exportBridge: ((input: AiChatExportInput) => Promise<AiChatExportResult>) | undefined = vi.fn(async () => ({
    ok: true,
    data: {
      exported: 1,
      fileName: 'chat.md',
      filePath: '/tmp/chat.md',
      bytes: 5,
      markdown: 'hello'
    }
  }))
  const root = document.createElement('div')
  root.innerHTML = '<article class="message" data-message-id="message-1"><p>hello search</p></article>'
  Object.defineProperty(root, 'scrollHeight', { value: 320, configurable: true })
  const historySearchInput = document.createElement('input')
  const historyDropdown = document.createElement('div')
  historyDropdown.className = 'ai-history-dropdown'
  const titleInput = document.createElement('input')
  titleInput.className = 'ai-history-title-input'
  historyDropdown.append(historySearchInput, titleInput)
  document.body.append(historyDropdown)
  const chatSearchInput = document.createElement('input')
  const timers: Array<() => void> = []
  const frameCallbacks: Array<() => void> = []
  const calls = {
    afterDomUpdate: vi.fn(async (callback?: () => void) => callback?.()),
    cancelFrame: vi.fn(),
    clearTimer: vi.fn(),
    closeCommandPopup: vi.fn(),
    closeContextPopup: vi.fn(),
    closeModelMenu: vi.fn(),
    closePopups: vi.fn(),
    createConversation: vi.fn(async () => ({ id: 'conv-3' })),
    deselectConversation: vi.fn(async () => true),
    deleteConversation: vi.fn(async (id: string) => {
      conversations = conversations.filter((conversation) => conversation.id !== id)
      return true
    }),
    loadConversations: vi.fn(async () => true),
    renameConversation: vi.fn(async (id: string, title: string) => {
      conversations = conversations.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation))
      return true
    }),
    requestFrame: vi.fn((callback: () => void) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    }),
    restoreConversation: vi.fn(async (id: string) => {
      selectedConversationId = id
      return true
    }),
    toggleConversationFavorite: vi.fn(async (id: string) => {
      conversations = conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, favorite: !conversation.favorite } : conversation
      )
      return true
    })
  }
  const runtime = createAiPanelChatNavigationRuntime({
    conversations: () => conversations,
    sortedConversations: () => [...conversations].sort((first, second) => second.ts - first.ts),
    selectedConversationId: () => selectedConversationId,
    messages: () => messages,
    locale: () => 'en-US',
    t: (key) => translations[key] || key,
    createConversation: calls.createConversation,
    deselectConversation: calls.deselectConversation,
    restoreConversation: calls.restoreConversation,
    renameConversation: calls.renameConversation,
    deleteConversation: calls.deleteConversation,
    toggleConversationFavorite: calls.toggleConversationFavorite,
    loadConversations: calls.loadConversations,
    exportChat: () => exportBridge,
    closeContextPopup: calls.closeContextPopup,
    closeCommandPopup: calls.closeCommandPopup,
    closeModelMenu: calls.closeModelMenu,
    closePopups: calls.closePopups,
    afterDomUpdate: calls.afterDomUpdate,
    requestFrame: calls.requestFrame,
    cancelFrame: calls.cancelFrame,
    setTimer: (callback) => {
      timers.push(callback)
      return callback
    },
    clearTimer: calls.clearTimer
  })
  runtime.chatScrollRef.value = root
  runtime.historySearchInputRef.value = historySearchInput
  runtime.chatSearchInputRef.value = chatSearchInput

  return {
    calls,
    chatSearchInput,
    conversations: () => conversations,
    frameCallbacks,
    historySearchInput,
    messages: () => messages,
    runtime,
    setExportBridge: (bridge: typeof exportBridge) => {
      exportBridge = bridge
    },
    setMessages: (nextMessages: typeof messages) => {
      messages = nextMessages
    },
    timers
  }
}

describe('aiPanelChatNavigationRuntime', () => {
  it('owns history refs, conversation view projection, and history actions', async () => {
    const { calls, conversations, runtime } = createHarness()

    runtime.ensureConversationTab('conv-1')
    runtime.ensureConversationTab('conv-2')
    expect(runtime.visibleConversationTabs.value.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2'])
    expect(runtime.conversationTabTooltip(conversations()[0])).toBe('First\nFirst summary')
    expect(runtime.groupedVisibleHistory.value[0].items.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2'])

    await runtime.openHistoryMenu()
    expect(calls.closeContextPopup).toHaveBeenCalled()
    expect(calls.closeCommandPopup).toHaveBeenCalled()
    expect(calls.closeModelMenu).toHaveBeenCalled()
    expect(calls.loadConversations).toHaveBeenCalled()
    expect(document.activeElement).toBe(runtime.historySearchInputRef.value)

    await runtime.editHistoryTitle('conv-2')
    runtime.editingHistoryTitle.value = 'Renamed'
    await runtime.saveHistoryTitle('conv-2')
    expect(conversations().find((conversation) => conversation.id === 'conv-2')?.title).toBe('Renamed')
    expect(runtime.chatExportNotice.value).toBe('title updated')

    await runtime.toggleHistoryFavorite('conv-2')
    expect(runtime.chatExportNotice.value).toBe('favorited')
  })

  it('composes chat search and viewport behavior with history menu state', async () => {
    const { calls, frameCallbacks, runtime, setMessages, timers } = createHarness()

    runtime.toggleMoreActionsMenu()
    expect(runtime.moreActionsMenuOpen.value).toBe(true)
    runtime.chatSearchTerm.value = 'hello'
    await runtime.openChatSearch()
    expect(runtime.chatSearchOpen.value).toBe(true)
    expect(runtime.moreActionsMenuOpen.value).toBe(false)
    expect(calls.closePopups).toHaveBeenCalled()
    expect(runtime.chatSearchMatchCount.value).toBe(1)

    const stop = watch(runtime.chatSearchTerm, () => runtime.handleChatSearchTermChanged())
    runtime.chatSearchTerm.value = 'search'
    await Promise.resolve()
    expect(timers).toHaveLength(1)
    stop()

    await runtime.closeChatSearch()
    setMessages([
      { id: 'message-1', role: 'user', text: 'hello', hosts: [{ id: 'host-1', kind: 'hosts', label: 'prod' }] },
      { id: 'message-2', role: 'user', text: 'new explicit prompt' }
    ])
    await runtime.syncSearchForMessages()
    await Promise.resolve()
    expect(calls.requestFrame).toHaveBeenCalled()
    frameCallbacks[0]()
    expect(runtime.chatScrollRef.value?.scrollTop).toBe(320)

    runtime.disposeChatSearchRuntime()
    expect(calls.clearTimer).toHaveBeenCalled()
  })

  it('exports chat through validated messages and exposes export notices', async () => {
    const { runtime, setExportBridge, setMessages } = createHarness()

    await runtime.exportCurrentChat()
    expect(runtime.chatExportNotice.value).toBe('聊天已导出。')

    setMessages([])
    await runtime.exportCurrentChat()
    expect(runtime.chatExportNotice.value).toBe('当前会话为空，无法导出。')

    setMessages([{ id: 'message-2', role: 'assistant' as const, text: 'answer' }])
    setExportBridge(undefined)
    await runtime.exportCurrentChat()
    expect(runtime.chatExportNotice.value).toBe('聊天导出服务不可用。')

    setExportBridge(vi.fn(async () => ({ ok: true, data: { exported: 1, fileName: '' } } as AiChatExportResult)))
    await runtime.exportCurrentChat()
    expect(runtime.chatExportNotice.value).toContain('AI 服务返回数据无效')
  })
})
