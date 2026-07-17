import { closeAiConversationTab, nextAiHistoryPageAfterDelete, type AiPanelConversationLike } from '@/services/ai/aiPanelConversationRuntime'
import { isAiChatExportData, malformedAiBackendResultMessage } from '@/services/ai/aiBackendGuards'
import { productSessionClient } from '@/services/ai/productSessionClient'
import type { AiChatExportInput, AiChatExportResult } from '@shared/contracts/aiChat'

export type AiPanelHistoryRuntimeState = {
  chatSearchOpen: boolean
  moreActionsMenuOpen: boolean
  historyMenuOpen: boolean
  historySearchTerm: string
  historyFavoritesOnly: boolean
  historyCurrentPage: number
  historyLoadingMore: boolean
  editingHistoryId: string | null
  editingHistoryTitle: string
  chatExportNotice: string
  openConversationTabIds: string[]
}

export type AiPanelHistoryRuntimeLabels = {
  chatCreated: () => string
  chatCreateFailed: () => string
  chatRestored: () => string
  chatRestoreFailed: () => string
  tabClosed: () => string
  tabCloseFailed: () => string
  tabCloseRollbackFailed: () => string
  historyTitleUpdated: () => string
  historyTitleUpdateFailed: () => string
  chatDeleted: () => string
  chatDeleteFailed: () => string
  historyFavorited: () => string
  historyUnfavorited: () => string
  historyFavoriteUpdateFailed: () => string
  activeTurnNavigationBlocked: () => string
  exportEmpty: () => string
  exportUnavailable: () => string
  exportFailed: (message: string) => string
  exportMalformed: () => string
  exportSuccess: () => string
}

export type AiPanelHistoryRuntimeOptions<TConversation extends AiPanelConversationLike> = {
  state: AiPanelHistoryRuntimeState
  conversations: () => TConversation[]
  selectedConversationId: () => string
  visibleTabs: () => TConversation[]
  visibleHistoryCount: () => number
  chatMessageCount: () => number
  hasActiveTurn: () => boolean
  cancelActiveTurn?: () => Promise<boolean>
  currentConversationTitle: () => string
  exportMessages: () => AiChatExportInput['messages']
  createConversation: () => Promise<{ id: string } | null | undefined>
  deselectConversation: (expectedConversationId: string) => Promise<boolean>
  restoreConversation: (id: string) => Promise<boolean>
  renameConversation: (id: string, title: string) => Promise<boolean>
  deleteConversation: (id: string) => Promise<boolean>
  toggleConversationFavorite: (id: string) => Promise<boolean>
  loadConversations: () => Promise<boolean>
  exportChat: () => ((input: AiChatExportInput) => Promise<AiChatExportResult>) | undefined
  closeContextPopup: () => void
  closeCommandPopup: () => void
  closeModelMenu: () => void
  focusHistorySearchInput: () => void | Promise<void>
  focusHistoryTitleInput: () => void | Promise<void>
  setNoticeTimer: (callback: () => void, delay: number) => unknown
  clearNoticeTimer: (timer: unknown) => void
  labels: AiPanelHistoryRuntimeLabels
}

export const createEmptyAiPanelHistoryRuntimeState = (): AiPanelHistoryRuntimeState => ({
  chatSearchOpen: false,
  moreActionsMenuOpen: false,
  historyMenuOpen: false,
  historySearchTerm: '',
  historyFavoritesOnly: false,
  historyCurrentPage: 1,
  historyLoadingMore: false,
  editingHistoryId: null,
  editingHistoryTitle: '',
  chatExportNotice: '',
  openConversationTabIds: []
})

export const createAiPanelHistoryRuntime = <TConversation extends AiPanelConversationLike>(
  options: AiPanelHistoryRuntimeOptions<TConversation>
) => {
  let noticeTimer: unknown
  const closingConversationIds = new Set<string>()

  const showNotice = (message: string) => {
    options.state.chatExportNotice = message
    if (noticeTimer) options.clearNoticeTimer(noticeTimer)
    noticeTimer = options.setNoticeTimer(() => {
      options.state.chatExportNotice = ''
      noticeTimer = undefined
    }, 2400)
  }

  const clearNoticeTimer = () => {
    if (!noticeTimer) return
    options.clearNoticeTimer(noticeTimer)
    noticeTimer = undefined
  }

  const closeHistoryMenu = () => {
    options.state.historyMenuOpen = false
    options.state.editingHistoryId = null
    options.state.editingHistoryTitle = ''
  }

  const resetHistoryFilters = () => {
    options.state.historyCurrentPage = 1
    options.state.editingHistoryId = null
    options.state.editingHistoryTitle = ''
  }

  const openHistoryMenu = async () => {
    options.state.chatSearchOpen = false
    options.state.moreActionsMenuOpen = false
    options.closeContextPopup()
    options.closeCommandPopup()
    options.closeModelMenu()
    await options.loadConversations()
    options.state.historyMenuOpen = true
    await options.focusHistorySearchInput()
  }

  const toggleHistoryMenu = () => {
    if (options.state.historyMenuOpen) {
      closeHistoryMenu()
      return
    }
    void openHistoryMenu()
  }

  const toggleMoreActionsMenu = () => {
    if (options.state.moreActionsMenuOpen) {
      options.state.moreActionsMenuOpen = false
      return
    }
    closeHistoryMenu()
    options.state.moreActionsMenuOpen = true
  }

  const clearHistorySearch = async () => {
    options.state.historySearchTerm = ''
    await options.focusHistorySearchInput()
  }

  const ensureConversationTab = (id: string) => {
    if (!id || options.state.openConversationTabIds.includes(id) || !options.conversations().some((conversation) => conversation.id === id)) return
    options.state.openConversationTabIds = [...options.state.openConversationTabIds, id]
  }

  const hydrateOpenConversationTabs = async () => {
    const conversationIds = new Set(options.conversations().map((conversation) => conversation.id))
    const selectedId = options.selectedConversationId()
    const selectedIds = selectedId && conversationIds.has(selectedId) ? [selectedId] : []
    const retainedIds = options.state.openConversationTabIds.filter((id) => conversationIds.has(id))
    const fallbackIds = [...new Set([...retainedIds, ...selectedIds])]
    const listProductSessions = productSessionClient.list()
    if (!listProductSessions) {
      options.state.openConversationTabIds = fallbackIds
      return false
    }
    let result
    try {
      result = await listProductSessions({ surface: 'classic', isOpen: true, limit: 200 })
    } catch {
      options.state.openConversationTabIds = fallbackIds
      return false
    }
    if (!result?.ok || !Array.isArray(result.data?.sessions)) {
      options.state.openConversationTabIds = fallbackIds
      return false
    }
    const openIds = result.data.sessions
      .filter((session) => session?.surface === 'classic' && session.isOpen === true && conversationIds.has(session.id))
      .map((session) => session.id)
    options.state.openConversationTabIds = [...new Set(openIds)]
    const selectedIsOpen = selectedId ? openIds.includes(selectedId) : false
    if (selectedIsOpen) return true
    try {
      if (openIds.length) {
        if (await options.restoreConversation(openIds[0])) return true
        if (selectedId) await options.deselectConversation(selectedId)
        return false
      }
      return selectedId ? options.deselectConversation(selectedId) : true
    } catch {
      return false
    }
  }

  const pruneConversationTabs = () => {
    const existingIds = new Set(options.conversations().map((conversation) => conversation.id))
    const nextIds = options.state.openConversationTabIds.filter((id) => existingIds.has(id))
    if (nextIds.length !== options.state.openConversationTabIds.length) options.state.openConversationTabIds = nextIds
  }

  const createNewConversation = async () => {
    const created = await options.createConversation()
    options.state.historySearchTerm = ''
    options.state.historyCurrentPage = 1
    if (created) {
      closeHistoryMenu()
      showNotice(options.labels.chatCreated())
      return true
    }
    showNotice(options.labels.chatCreateFailed())
    return false
  }

  const restoreConversationById = async (
    id: string,
    successMessage = options.labels.chatRestored(),
    failureMessage = options.labels.chatRestoreFailed()
  ) => {
    if (options.state.editingHistoryId) return false
    const restored = await options.restoreConversation(id)
    if (restored) ensureConversationTab(id)
    showNotice(restored ? successMessage : failureMessage)
    return restored
  }

  const restoreConversationFromTab = async (id: string) => {
    if (options.selectedConversationId() === id) return
    closeHistoryMenu()
    await restoreConversationById(id)
  }

  const closeConversationTab = async (id: string) => {
    closeHistoryMenu()
    if (closingConversationIds.has(id)) return
    if (options.selectedConversationId() === id && options.hasActiveTurn()) void options.cancelActiveTurn?.()
    closingConversationIds.add(id)
    try {
      const closeProductSession = productSessionClient.close()
      if (!closeProductSession) {
        showNotice(options.labels.tabCloseFailed())
        return
      }
      const reopenProductSession = async () => {
        const updateProductSession = productSessionClient.update()
        if (!updateProductSession) return false
        try {
          const result = await updateProductSession({ id, isOpen: true })
          return Boolean(result?.ok && result.data?.session?.id === id && result.data.session.isOpen)
        } catch {
          return false
        }
      }
      try {
        const closeResult = await closeProductSession(id)
        if (!closeResult?.ok || closeResult.data?.id !== id) {
          const reopened = await reopenProductSession()
          showNotice(reopened ? closeResult?.errorMessage || options.labels.tabCloseFailed() : options.labels.tabCloseRollbackFailed())
          return
        }
      } catch {
        const reopened = await reopenProductSession()
        showNotice(reopened ? options.labels.tabCloseFailed() : options.labels.tabCloseRollbackFailed())
        return
      }
      const result = closeAiConversationTab(
        options.state.openConversationTabIds,
        options.visibleTabs(),
        options.selectedConversationId(),
        id
      )
      const commitClosedTab = () => {
        options.state.openConversationTabIds = options.state.openConversationTabIds.filter((openId) => openId !== id)
      }
      if (result.status === 'closed') {
        let deselected = false
        try {
          deselected = await options.deselectConversation(id)
        } catch {
          deselected = false
        }
        if (!deselected) {
          if (options.selectedConversationId() !== id) {
            commitClosedTab()
            showNotice(options.labels.tabClosed())
            return
          }
          const reopened = await reopenProductSession()
          let restored = false
          if (reopened) {
            try {
              restored = await options.restoreConversation(id)
            } catch {
              restored = false
            }
          }
          showNotice(reopened && restored ? options.labels.tabCloseFailed() : options.labels.tabCloseRollbackFailed())
          return
        }
      }
      commitClosedTab()
      if (result.status === 'closed-inactive' || result.status === 'closed') {
        showNotice(options.labels.tabClosed())
        return
      }
      await restoreConversationById(result.nextConversationId, options.labels.tabClosed(), options.labels.chatRestoreFailed())
    } finally {
      closingConversationIds.delete(id)
    }
  }

  const restoreHistoryConversation = async (id: string) => {
    const restored = await restoreConversationById(id)
    if (restored) closeHistoryMenu()
  }

  const editHistoryTitle = async (id: string) => {
    const conversation = options.conversations().find((item) => item.id === id)
    if (!conversation) return
    options.state.editingHistoryId = id
    options.state.editingHistoryTitle = conversation.title
    await options.focusHistoryTitleInput()
  }

  const cancelHistoryTitleEdit = () => {
    options.state.editingHistoryId = null
    options.state.editingHistoryTitle = ''
  }

  const saveHistoryTitle = async (id: string) => {
    if (!options.state.editingHistoryId) return
    const saved = await options.renameConversation(id, options.state.editingHistoryTitle)
    cancelHistoryTitleEdit()
    showNotice(saved ? options.labels.historyTitleUpdated() : options.labels.historyTitleUpdateFailed())
  }

  const deleteHistoryConversation = async (id: string) => {
    if (id === options.selectedConversationId() && options.hasActiveTurn()) void options.cancelActiveTurn?.()
    const deleted = await options.deleteConversation(id)
    options.state.historyCurrentPage = nextAiHistoryPageAfterDelete(options.visibleHistoryCount(), options.state.historyCurrentPage)
    showNotice(deleted ? options.labels.chatDeleted() : options.labels.chatDeleteFailed())
  }

  const toggleHistoryFavorite = async (id: string) => {
    const toggled = await options.toggleConversationFavorite(id)
    const conversation = options.conversations().find((item) => item.id === id)
    showNotice(toggled ? (conversation?.favorite ? options.labels.historyFavorited() : options.labels.historyUnfavorited()) : options.labels.historyFavoriteUpdateFailed())
  }

  const loadMoreHistoryConversations = async (hasMore: boolean) => {
    if (options.state.historyLoadingMore || !hasMore) return
    options.state.historyLoadingMore = true
    try {
      const refreshed = await options.loadConversations()
      if (!refreshed) return
      options.state.historyCurrentPage += 1
    } finally {
      options.state.historyLoadingMore = false
    }
  }

  const exportCurrentChat = async () => {
    options.state.moreActionsMenuOpen = false
    if (options.chatMessageCount() === 0) {
      showNotice(options.labels.exportEmpty())
      return
    }
    const exportChat = options.exportChat()
    if (typeof exportChat !== 'function') {
      showNotice(options.labels.exportUnavailable())
      return
    }
    try {
      const result = await exportChat({
        title: options.currentConversationTitle(),
        messages: options.exportMessages()
      })
      if (!result?.ok) {
        showNotice(options.labels.exportFailed(result?.errorMessage || '聊天导出失败。'))
        return
      }
      if (!isAiChatExportData(result.data)) {
        showNotice(options.labels.exportMalformed())
        return
      }
      if (result.data.canceled) return
      showNotice(options.labels.exportSuccess())
    } catch (error) {
      showNotice(options.labels.exportFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  return {
    cancelHistoryTitleEdit,
    clearHistorySearch,
    clearNoticeTimer,
    closeConversationTab,
    closeHistoryMenu,
    createNewConversation,
    deleteHistoryConversation,
    editHistoryTitle,
    ensureConversationTab,
    exportCurrentChat,
    loadMoreHistoryConversations,
    openHistoryMenu,
    hydrateOpenConversationTabs,
    pruneConversationTabs,
    resetHistoryFilters,
    restoreConversationById,
    restoreConversationFromTab,
    restoreHistoryConversation,
    saveHistoryTitle,
    showNotice,
    toggleHistoryFavorite,
    toggleHistoryMenu,
    toggleMoreActionsMenu
  }
}
