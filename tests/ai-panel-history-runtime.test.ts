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
  tabClosed: () => 'tab closed',
  tabCloseFailed: () => 'tab close failed',
  tabCloseRollbackFailed: () => 'tab close rollback failed',
  historyTitleUpdated: () => 'title updated',
  historyTitleUpdateFailed: () => 'title update failed',
  chatDeleted: () => 'chat deleted',
  chatDeleteFailed: () => 'chat delete failed',
  historyFavorited: () => 'favorited',
  historyUnfavorited: () => 'unfavorited',
  historyFavoriteUpdateFailed: () => 'favorite failed',
  activeTurnNavigationBlocked: () => 'active turn blocks navigation',
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
  let activeTurn = false
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
    cancelActiveTurn: vi.fn(async () => true),
    deselectConversation: vi.fn(async (_expectedConversationId: string) => {
      selectedConversationId = ''
      return true
    }),
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
    hasActiveTurn: () => activeTurn,
    currentConversationTitle: () => 'Current chat',
    exportMessages: calls.exportMessages,
    createConversation: calls.createConversation,
    cancelActiveTurn: calls.cancelActiveTurn,
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
    setActiveTurn: (active: boolean) => {
      activeTurn = active
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
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith('conv-1')
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-2')
    expect(vi.mocked(window.aiops.closeProductSession).mock.invocationCallOrder.at(-1)).toBeLessThan(
      calls.restoreConversation.mock.invocationCallOrder.at(-1)!
    )
    expect(state.chatExportNotice).toBe('tab closed')

    await runtime.restoreHistoryConversation('conv-1')
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-1')
    expect(state.openConversationTabIds).toEqual(['conv-2', 'conv-1'])
    expect(state.historyMenuOpen).toBe(false)

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

  it('hydrates only open Classic product rows and reconciles a closed selected conversation', async () => {
    const { calls, runtime, state } = createHarness()
    state.openConversationTabIds = []
    vi.mocked(window.aiops.listProductSessions).mockResolvedValueOnce({
      ok: true,
      data: {
        sessions: [
          { id: 'conv-2', surface: 'classic', title: 'Second', isOpen: true, createdAt: 1, updatedAt: 4 },
          { id: 'missing', surface: 'classic', title: 'Missing', isOpen: true, createdAt: 1, updatedAt: 3 },
          { id: 'conv-1', surface: 'classic', title: 'First', isOpen: false, createdAt: 1, updatedAt: 2 }
        ]
      }
    })

    await expect(runtime.hydrateOpenConversationTabs()).resolves.toBe(true)

    expect(window.aiops.listProductSessions).toHaveBeenCalledWith({ surface: 'classic', isOpen: true, limit: 200 })
    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-2')
    expect(calls.deselectConversation).not.toHaveBeenCalled()
  })

  it('clears a stale selected projection when the registry has no open Classic sessions', async () => {
    const { calls, runtime, state } = createHarness()
    vi.mocked(window.aiops.listProductSessions).mockResolvedValueOnce({
      ok: true,
      data: { sessions: [] }
    })

    await expect(runtime.hydrateOpenConversationTabs()).resolves.toBe(true)

    expect(state.openConversationTabIds).toEqual([])
    expect(calls.deselectConversation).toHaveBeenCalledWith('conv-1')
    expect(calls.restoreConversation).not.toHaveBeenCalled()
  })

  it('keeps a Classic tab open when product close is rejected', async () => {
    const { calls, runtime, state } = createHarness()
    vi.mocked(window.aiops.closeProductSession).mockResolvedValueOnce({
      ok: false,
      errorCode: 'PRODUCT_SESSION_CLOSE_FAILED',
      errorMessage: 'close rejected'
    })

    await runtime.closeConversationTab('conv-1')

    expect(state.openConversationTabIds).toEqual(['conv-1', 'conv-2'])
    expect(calls.restoreConversation).not.toHaveBeenCalled()
    expect(state.chatExportNotice).toBe('close rejected')
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({ id: 'conv-1', isOpen: true })
  })

  it('closes the final Classic tab into a persisted empty selection without deleting history', async () => {
    const { calls, runtime, state, setSelectedConversationId } = createHarness()
    state.openConversationTabIds = ['conv-1']
    setSelectedConversationId('conv-1')

    await runtime.closeConversationTab('conv-1')

    expect(window.aiops.closeProductSession).toHaveBeenCalledWith('conv-1')
    expect(calls.deselectConversation).toHaveBeenCalledWith('conv-1')
    expect(calls.createConversation).not.toHaveBeenCalled()
    expect(calls.deleteConversation).not.toHaveBeenCalled()
    expect(state.openConversationTabIds).toEqual([])
    expect(state.chatExportNotice).toBe('tab closed')
    expect(vi.mocked(window.aiops.closeProductSession).mock.invocationCallOrder.at(-1)).toBeLessThan(
      calls.deselectConversation.mock.invocationCallOrder.at(-1)!
    )
  })

  it('reopens and reselects the final Classic tab when selection clearing fails', async () => {
    const { calls, runtime, state, setSelectedConversationId } = createHarness()
    state.openConversationTabIds = ['conv-1']
    setSelectedConversationId('conv-1')
    calls.deselectConversation.mockResolvedValueOnce(false)

    await runtime.closeConversationTab('conv-1')

    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({ id: 'conv-1', isOpen: true })
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-1')
    expect(state.openConversationTabIds).toEqual(['conv-1'])
    expect(state.chatExportNotice).toBe('tab close failed')
  })

  it('reports when a rejected Classic close cannot restore the product open state', async () => {
    const { calls, runtime, state } = createHarness()
    vi.mocked(window.aiops.closeProductSession).mockResolvedValueOnce({
      ok: false,
      errorCode: 'PRODUCT_SESSION_CLOSE_FAILED',
      errorMessage: 'close rejected'
    })
    vi.mocked(window.aiops.updateProductSession).mockResolvedValueOnce({
      ok: false,
      errorCode: 'PRODUCT_SESSION_UPDATE_FAILED',
      errorMessage: 'rollback rejected'
    })

    await runtime.closeConversationTab('conv-1')

    expect(state.openConversationTabIds).toEqual(['conv-1', 'conv-2'])
    expect(calls.restoreConversation).not.toHaveBeenCalled()
    expect(state.chatExportNotice).toBe('tab close rollback failed')
  })

  it('coalesces concurrent Classic tab close requests', async () => {
    const { runtime, state } = createHarness()
    let resolveClose!: (value: Awaited<ReturnType<typeof window.aiops.closeProductSession>>) => void
    vi.mocked(window.aiops.closeProductSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolveClose = resolve
    }))

    const firstClose = runtime.closeConversationTab('conv-1')
    const duplicateClose = runtime.closeConversationTab('conv-1')

    expect(window.aiops.closeProductSession).toHaveBeenCalledTimes(1)
    expect(state.openConversationTabIds).toEqual(['conv-1', 'conv-2'])
    resolveClose({ ok: true, data: { id: 'conv-1', stopped: true } })
    await Promise.all([firstClose, duplicateClose])

    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()
  })

  it('preserves a conversation opened while the final Classic product close is pending', async () => {
    const { calls, runtime, state, setSelectedConversationId } = createHarness()
    state.openConversationTabIds = ['conv-1']
    setSelectedConversationId('conv-1')
    let resolveClose!: (value: Awaited<ReturnType<typeof window.aiops.closeProductSession>>) => void
    vi.mocked(window.aiops.closeProductSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolveClose = resolve
    }))

    const close = runtime.closeConversationTab('conv-1')
    await vi.waitFor(() => expect(window.aiops.closeProductSession).toHaveBeenCalledWith('conv-1'))
    state.openConversationTabIds = ['conv-1', 'conv-2']
    setSelectedConversationId('conv-2')
    resolveClose({ ok: true, data: { id: 'conv-1', stopped: true } })
    await close

    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(calls.deselectConversation).not.toHaveBeenCalled()
    expect(calls.restoreConversation).not.toHaveBeenCalled()
    expect(state.chatExportNotice).toBe('tab closed')
  })

  it('preserves a conversation opened while the final Classic selection clear is pending', async () => {
    const { calls, runtime, state, setSelectedConversationId } = createHarness()
    state.openConversationTabIds = ['conv-1']
    setSelectedConversationId('conv-1')
    let resolveDeselect!: (value: boolean) => void
    calls.deselectConversation.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDeselect = resolve
    }))

    const close = runtime.closeConversationTab('conv-1')
    await vi.waitFor(() => expect(calls.deselectConversation).toHaveBeenCalledWith('conv-1'))
    state.openConversationTabIds = ['conv-1', 'conv-2']
    setSelectedConversationId('conv-2')
    resolveDeselect(true)
    await close

    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(calls.restoreConversation).not.toHaveBeenCalled()
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()
    expect(state.chatExportNotice).toBe('tab closed')
  })

  it('does not reopen a closed Classic tab when deselection loses a selection race', async () => {
    const { calls, runtime, state, setSelectedConversationId } = createHarness()
    state.openConversationTabIds = ['conv-1']
    setSelectedConversationId('conv-1')
    let resolveDeselect!: (value: boolean) => void
    calls.deselectConversation.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDeselect = resolve
    }))

    const close = runtime.closeConversationTab('conv-1')
    await vi.waitFor(() => expect(calls.deselectConversation).toHaveBeenCalledWith('conv-1'))
    state.openConversationTabIds = ['conv-1', 'conv-2']
    setSelectedConversationId('conv-2')
    resolveDeselect(false)
    await close

    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(calls.restoreConversation).not.toHaveBeenCalled()
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()
    expect(state.chatExportNotice).toBe('tab closed')
  })

  it('keeps a Classic tab open when the product close bridge is unavailable', async () => {
    const { calls, runtime, state } = createHarness()
    const closeProductSession = window.aiops.closeProductSession
    ;(window.aiops as { closeProductSession?: typeof closeProductSession }).closeProductSession = undefined
    try {
      await runtime.closeConversationTab('conv-1')
      expect(state.openConversationTabIds).toEqual(['conv-1', 'conv-2'])
      expect(calls.restoreConversation).not.toHaveBeenCalled()
      expect(state.chatExportNotice).toBe('tab close failed')
    } finally {
      window.aiops.closeProductSession = closeProductSession
    }
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

  it('allows creating, switching, closing, and deleting while an AI turn is active', async () => {
    const { runtime, state, calls, setActiveTurn, setSelectedConversationId } = createHarness()
    setActiveTurn(true)

    expect(await runtime.createNewConversation()).toBe(true)
    await runtime.restoreConversationFromTab('conv-2')
    setSelectedConversationId('conv-1')
    await runtime.closeConversationTab('conv-1')
    setSelectedConversationId('conv-2')
    await runtime.deleteHistoryConversation('conv-2')

    expect(calls.createConversation).toHaveBeenCalledOnce()
    expect(calls.restoreConversation).toHaveBeenCalledWith('conv-2')
    expect(calls.cancelActiveTurn).toHaveBeenCalledTimes(2)
    expect(calls.deleteConversation).toHaveBeenCalledWith('conv-2')
    expect(state.openConversationTabIds).toEqual(['conv-2'])
    expect(state.chatExportNotice).toBe('chat deleted')
  })
})
