import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAiPanelHistoryRuntime,
  createEmptyAiPanelHistoryRuntimeState,
  type AiPanelHistoryRuntimeLabels
} from '@/services/ai/aiPanelHistoryRuntime'
import type { AiPanelConversationLike } from '@/services/ai/aiPanelConversationRuntime'
import type { AiChatExportInput, AiChatExportResult } from '@shared/contracts/aiChat'

const labels: AiPanelHistoryRuntimeLabels = {
  chatCreated: () => 'chat created',
  chatCreateFailed: () => 'chat create failed',
  chatRestored: () => 'chat restored',
  chatRestoreFailed: () => 'chat restore failed',
  keepOneTab: () => 'keep one tab',
  tabClosed: () => 'tab closed',
  historyTitleUpdated: () => 'title updated',
  historyTitleUpdateFailed: () => 'title update failed',
  chatDeleted: () => 'chat deleted',
  chatDeleteFailed: () => 'chat delete failed',
  historyFavorited: () => 'favorited',
  historyUnfavorited: () => 'unfavorited',
  historyFavoriteUpdateFailed: () => 'favorite failed',
  exportEmpty: () => 'export empty',
  exportUnavailable: () => 'export unavailable',
  exportFailed: (message) => `export failed: ${message}`,
  exportMalformed: () => 'export malformed',
  exportSuccess: () => 'export success'
}

const conversations: AiPanelConversationLike[] = [
  { id: 'conv-1', title: 'First', ts: 3000, favorite: true },
  { id: 'conv-2', title: 'Second', ts: 2000 },
  { id: 'conv-3', title: 'Third', ts: 1000 }
]

const createHarness = () => {
  const state = createEmptyAiPanelHistoryRuntimeState()
  state.openConversationTabIds = ['conv-1', 'conv-2']
  let selectedConversationId = 'conv-1'
  let currentConversations = conversations.map((conversation) => ({ ...conversation }))
  let chatMessageCount = 1
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
  const timers: Array<() => void> = []
  const calls = {
    createConversation: vi.fn(async () => ({ id: 'conv-new' })),
    restoreConversation: vi.fn(async (id: string) => {
      selectedConversationId = id
      return true
    }),
    renameConversation: vi.fn(async (id: string, title: string) => {
      currentConversations = currentConversations.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation))
      return true
    }),
    deleteConversation: vi.fn(async (id: string) => {
      currentConversations = currentConversations.filter((conversation) => conversation.id !== id)
      return true
    }),
    toggleConversationFavorite: vi.fn(async (id: string) => {
      currentConversations = currentConversations.map((conversation) =>
        conversation.id === id ? { ...conversation, favorite: !conversation.favorite } : conversation
      )
      return true
    }),
    loadConversations: vi.fn(async () => true),
    closeContextPopup: vi.fn(),
    closeCommandPopup: vi.fn(),
    closeModelMenu: vi.fn(),
    focusHistorySearchInput: vi.fn(async () => undefined),
    focusHistoryTitleInput: vi.fn(async () => undefined),
    exportMessages: vi.fn(() => [{ id: 'm1', role: 'user' as const, text: 'hello', ts: 1 }])
  }
  const runtime = createAiPanelHistoryRuntime({
    state,
    conversations: () => currentConversations,
    selectedConversationId: () => selectedConversationId,
    visibleTabs: () => currentConversations.filter((conversation) => state.openConversationTabIds.includes(conversation.id)),
    visibleHistoryCount: () => currentConversations.length,
    chatMessageCount: () => chatMessageCount,
    currentConversationTitle: () => 'Current chat',
    exportMessages: calls.exportMessages,
    createConversation: calls.createConversation,
    restoreConversation: calls.restoreConversation,
    renameConversation: calls.renameConversation,
    deleteConversation: calls.deleteConversation,
    toggleConversationFavorite: calls.toggleConversationFavorite,
    loadConversations: calls.loadConversations,
    exportChat: () => exportBridge,
    closeContextPopup: calls.closeContextPopup,
    closeCommandPopup: calls.closeCommandPopup,
    closeModelMenu: calls.closeModelMenu,
    focusHistorySearchInput: calls.focusHistorySearchInput,
    focusHistoryTitleInput: calls.focusHistoryTitleInput,
    setNoticeTimer: (callback) => {
      timers.push(callback)
      return callback
    },
    clearNoticeTimer: vi.fn(),
    labels
  })
  return {
    calls,
    runtime,
    state,
    timers,
    setChatMessageCount: (count: number) => {
      chatMessageCount = count
    },
    setExportBridge: (bridge: typeof exportBridge) => {
      exportBridge = bridge
    },
    setSelectedConversationId: (id: string) => {
      selectedConversationId = id
    },
    conversations: () => currentConversations
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('aiPanelHistoryRuntime', () => {
  it('opens and toggles history and more-actions menu state through one boundary', async () => {
    const { runtime, state, calls, timers } = createHarness()
    state.moreActionsMenuOpen = true
    await runtime.openHistoryMenu()
    expect(state).toMatchObject({
      chatSearchOpen: false,
      moreActionsMenuOpen: false,
      historyMenuOpen: true
    })
    expect(calls.closeContextPopup).toHaveBeenCalled()
    expect(calls.closeCommandPopup).toHaveBeenCalled()
    expect(calls.closeModelMenu).toHaveBeenCalled()
    expect(calls.loadConversations).toHaveBeenCalled()
    expect(calls.focusHistorySearchInput).toHaveBeenCalled()

    runtime.toggleHistoryMenu()
    expect(state.historyMenuOpen).toBe(false)
    runtime.toggleMoreActionsMenu()
    expect(state.moreActionsMenuOpen).toBe(true)
    runtime.showNotice('hello')
    expect(state.chatExportNotice).toBe('hello')
    timers.at(-1)?.()
    expect(state.chatExportNotice).toBe('')
  })

  it('creates, restores, closes, edits, deletes, favorites, and paginates history conversations', async () => {
    const { runtime, state, calls, conversations, setSelectedConversationId } = createHarness()
    expect(await runtime.createNewConversation()).toBe(true)
    expect(state.historySearchTerm).toBe('')
    expect(state.historyCurrentPage).toBe(1)
    expect(state.chatExportNotice).toBe('chat created')

    await runtime.restoreConversationFromTab('conv-2')
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-2')
    expect(state.openConversationTabIds).toEqual(['conv-1', 'conv-2'])

    setSelectedConversationId('conv-1')
    await runtime.closeConversationTab('conv-1')
    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-2')
    expect(state.chatExportNotice).toBe('tab closed')

    await runtime.editHistoryTitle('conv-2')
    expect(state.editingHistoryId).toBe('conv-2')
    expect(state.editingHistoryTitle).toBe('Second')
    expect(calls.focusHistoryTitleInput).toHaveBeenCalled()

    state.editingHistoryTitle = 'Renamed'
    await runtime.saveHistoryTitle('conv-2')
    expect(conversations().find((conversation) => conversation.id === 'conv-2')?.title).toBe('Renamed')
    expect(state.editingHistoryId).toBeNull()
    expect(state.chatExportNotice).toBe('title updated')

    state.historyCurrentPage = 3
    await runtime.deleteHistoryConversation('conv-3')
    expect(state.historyCurrentPage).toBe(3)
    expect(state.chatExportNotice).toBe('chat deleted')

    await runtime.toggleHistoryFavorite('conv-2')
    expect(conversations().find((conversation) => conversation.id === 'conv-2')?.favorite).toBe(true)
    expect(state.chatExportNotice).toBe('favorited')

    await runtime.loadMoreHistoryConversations(true)
    expect(state.historyCurrentPage).toBe(4)
    expect(state.historyLoadingMore).toBe(false)

    state.historySearchTerm = 'First'
    state.historyFavoritesOnly = true
    runtime.resetHistoryFilters()
    expect(state).toMatchObject({ historyCurrentPage: 1, editingHistoryId: null, editingHistoryTitle: '' })
  })

  it('exports the current chat through injected bridge validation', async () => {
    const { runtime, state, calls, setChatMessageCount, setExportBridge } = createHarness()
    await runtime.exportCurrentChat()
    expect(calls.exportMessages).toHaveBeenCalled()
    expect(state.moreActionsMenuOpen).toBe(false)
    expect(state.chatExportNotice).toBe('export success')

    setChatMessageCount(0)
    await runtime.exportCurrentChat()
    expect(state.chatExportNotice).toBe('export empty')

    setChatMessageCount(1)
    setExportBridge(undefined)
    await runtime.exportCurrentChat()
    expect(state.chatExportNotice).toBe('export unavailable')

    setExportBridge(vi.fn(async () => ({ ok: false, errorMessage: 'disk full' })))
    await runtime.exportCurrentChat()
    expect(state.chatExportNotice).toBe('export failed: disk full')

    setExportBridge(vi.fn(async () => ({ ok: true, data: { exported: 1, fileName: '' } } as AiChatExportResult)))
    await runtime.exportCurrentChat()
    expect(state.chatExportNotice).toBe('export malformed')
  })
})
