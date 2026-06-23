import { computed, reactive, ref, toRef } from 'vue'
import { createAiPanelChatViewportRuntime } from '@/services/ai/aiPanelChatViewportRuntime'
import {
  createAiPanelConversationViewRuntime,
  type AiPanelConversationLike,
  type AiPanelHistoryLabels
} from '@/services/ai/aiPanelConversationRuntime'
import {
  createAiPanelHistoryRuntime,
  createEmptyAiPanelHistoryRuntimeState,
  type AiPanelHistoryRuntimeLabels
} from '@/services/ai/aiPanelHistoryRuntime'
import { aiPanelChatExportMessage } from '@/services/ai/aiPanelMessageRuntime'
import { malformedAiBackendResultMessage } from '@/services/ai/aiBackendGuards'
import type { AiChatExportInput, AiChatExportResult, AiContentPart } from '@shared/contracts/aiChat'

export type AiPanelChatNavigationMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  contentParts?: AiContentPart[]
  favorite?: boolean
  feedback?: 'up' | 'down'
  executedCommand?: string
  commandExecutionStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
  commandExecutionMessage?: string
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
  followupOptions?: string[]
  selectedOption?: string
  partial?: boolean
  hosts?: Array<{
    id: string
    kind?: string
    label: string
    detail?: string
  }>
}

export type AiPanelChatNavigationI18nKey =
  | 'ai.historyToday'
  | 'ai.historyYesterday'
  | 'ai.historyDaysAgo'
  | 'ai.historyFavoriteGroup'
  | 'ai.untitledChat'
  | 'ai.chatCreated'
  | 'ai.chatCreateFailed'
  | 'ai.chatRestored'
  | 'ai.chatRestoreFailed'
  | 'ai.keepOneTab'
  | 'ai.tabClosed'
  | 'ai.historyTitleUpdated'
  | 'ai.historyTitleUpdateFailed'
  | 'ai.chatDeleted'
  | 'ai.chatDeleteFailed'
  | 'ai.historyFavorited'
  | 'ai.historyUnfavorited'
  | 'ai.historyFavoriteUpdateFailed'

export type AiPanelChatNavigationRuntimeOptions<TConversation extends AiPanelConversationLike, TMessage extends AiPanelChatNavigationMessage> = {
  conversations: () => TConversation[]
  sortedConversations: () => TConversation[]
  selectedConversationId: () => string
  messages: () => TMessage[]
  locale: () => string
  t: (key: AiPanelChatNavigationI18nKey) => string
  createConversation: () => Promise<{ id: string } | null | undefined>
  restoreConversation: (id: string) => Promise<boolean>
  renameConversation: (id: string, title: string) => Promise<boolean>
  deleteConversation: (id: string) => Promise<boolean>
  toggleConversationFavorite: (id: string) => Promise<boolean>
  loadConversations: () => Promise<boolean>
  exportChat: () => ((input: AiChatExportInput) => Promise<AiChatExportResult>) | undefined
  closeContextPopup: () => void
  closeCommandPopup: () => void
  closeModelMenu: () => void
  closePopups: () => void
  afterDomUpdate: (callback?: () => void) => void | Promise<void>
  requestFrame: (callback: () => void) => number
  cancelFrame: (frame: number) => void
  setTimer: (callback: () => void, delay: number) => unknown
  clearTimer: (timer: unknown) => void
}

const historyPageSize = 20

export const createAiPanelChatNavigationRuntime = <
  TConversation extends AiPanelConversationLike,
  TMessage extends AiPanelChatNavigationMessage
>(
  options: AiPanelChatNavigationRuntimeOptions<TConversation, TMessage>
) => {
  const historySearchInputRef = ref<HTMLInputElement | null>(null)
  const historyRuntimeState = reactive(createEmptyAiPanelHistoryRuntimeState())
  const moreActionsMenuOpen = toRef(historyRuntimeState, 'moreActionsMenuOpen')
  const historyMenuOpen = toRef(historyRuntimeState, 'historyMenuOpen')
  const historySearchTerm = toRef(historyRuntimeState, 'historySearchTerm')
  const historyFavoritesOnly = toRef(historyRuntimeState, 'historyFavoritesOnly')
  const historyCurrentPage = toRef(historyRuntimeState, 'historyCurrentPage')
  const historyLoadingMore = toRef(historyRuntimeState, 'historyLoadingMore')
  const editingHistoryId = toRef(historyRuntimeState, 'editingHistoryId')
  const editingHistoryTitle = toRef(historyRuntimeState, 'editingHistoryTitle')
  const chatExportNotice = toRef(historyRuntimeState, 'chatExportNotice')
  const openConversationTabIds = toRef(historyRuntimeState, 'openConversationTabIds')

  const historyLabels = computed<AiPanelHistoryLabels>(() => ({
    today: options.t('ai.historyToday'),
    yesterday: options.t('ai.historyYesterday'),
    daysAgo: (count) => options.t('ai.historyDaysAgo').replace('{count}', String(count)),
    favoriteGroup: options.t('ai.historyFavoriteGroup')
  }))

  const aiPanelConversationViewRuntime = createAiPanelConversationViewRuntime<TConversation>({
    openIds: () => openConversationTabIds.value,
    conversations: options.conversations,
    sortedConversations: options.sortedConversations,
    historySearchTerm: () => historySearchTerm.value,
    historyFavoritesOnly: () => historyFavoritesOnly.value,
    historyCurrentPage: () => historyCurrentPage.value,
    historyPageSize,
    locale: options.locale,
    labels: () => historyLabels.value,
    untitledLabel: () => options.t('ai.untitledChat')
  })
  const {
    conversationTabTooltip,
    displayConversationTitle,
    filteredHistoryConversations,
    formatHistoryTime,
    groupedVisibleHistory,
    hasMoreHistoryConversations,
    historyFavoriteLabel,
    visibleConversationTabs,
    visibleHistoryConversations
  } = aiPanelConversationViewRuntime

  const currentConversationTitle = () =>
    options.conversations().find((conversation) => conversation.id === options.selectedConversationId())?.title || 'Chat Export'

  const historyRuntimeLabels: AiPanelHistoryRuntimeLabels = {
    chatCreated: () => options.t('ai.chatCreated'),
    chatCreateFailed: () => options.t('ai.chatCreateFailed'),
    chatRestored: () => options.t('ai.chatRestored'),
    chatRestoreFailed: () => options.t('ai.chatRestoreFailed'),
    keepOneTab: () => options.t('ai.keepOneTab'),
    tabClosed: () => options.t('ai.tabClosed'),
    historyTitleUpdated: () => options.t('ai.historyTitleUpdated'),
    historyTitleUpdateFailed: () => options.t('ai.historyTitleUpdateFailed'),
    chatDeleted: () => options.t('ai.chatDeleted'),
    chatDeleteFailed: () => options.t('ai.chatDeleteFailed'),
    historyFavorited: () => options.t('ai.historyFavorited'),
    historyUnfavorited: () => options.t('ai.historyUnfavorited'),
    historyFavoriteUpdateFailed: () => options.t('ai.historyFavoriteUpdateFailed'),
    exportEmpty: () => '当前会话为空，无法导出。',
    exportUnavailable: () => '聊天导出服务不可用。',
    exportFailed: (message) => `导出失败：${message}`,
    exportMalformed: () => `导出失败：${malformedAiBackendResultMessage}`,
    exportSuccess: () => '聊天已导出。'
  }

  const aiPanelHistoryRuntime = createAiPanelHistoryRuntime<TConversation>({
    state: historyRuntimeState,
    conversations: options.conversations,
    selectedConversationId: options.selectedConversationId,
    visibleTabs: () => visibleConversationTabs.value,
    visibleHistoryCount: () => visibleHistoryConversations.value.length,
    chatMessageCount: () => options.messages().length,
    currentConversationTitle,
    exportMessages: () => options.messages().map(aiPanelChatExportMessage),
    createConversation: options.createConversation,
    restoreConversation: options.restoreConversation,
    renameConversation: options.renameConversation,
    deleteConversation: options.deleteConversation,
    toggleConversationFavorite: options.toggleConversationFavorite,
    loadConversations: options.loadConversations,
    exportChat: options.exportChat,
    closeContextPopup: options.closeContextPopup,
    closeCommandPopup: options.closeCommandPopup,
    closeModelMenu: options.closeModelMenu,
    focusHistorySearchInput: () => options.afterDomUpdate(() => historySearchInputRef.value?.focus()),
    focusHistoryTitleInput: () =>
      options.afterDomUpdate(() => {
        const input = historySearchInputRef.value?.closest('.ai-history-dropdown')?.querySelector<HTMLInputElement>('.ai-history-title-input')
        input?.focus()
        input?.select()
      }),
    setNoticeTimer: options.setTimer,
    clearNoticeTimer: options.clearTimer,
    labels: historyRuntimeLabels
  })

  const aiPanelChatViewportRuntime = createAiPanelChatViewportRuntime({
    historyState: historyRuntimeState,
    closePopups: options.closePopups,
    closeMoreActionsMenu: () => {
      moreActionsMenuOpen.value = false
    },
    afterDomUpdate: options.afterDomUpdate,
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
    setSearchTimer: options.setTimer,
    clearSearchTimer: options.clearTimer
  })
  const {
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    cancelChatScrollFrame,
    clearChatSearch,
    closeChatSearch,
    findNextChatMatch,
    findPreviousChatMatch,
    openChatSearch
  } = aiPanelChatViewportRuntime

  return {
    cancelChatScrollFrame,
    cancelHistoryTitleEdit: () => aiPanelHistoryRuntime.cancelHistoryTitleEdit(),
    chatExportNotice,
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    clearChatSearch,
    clearHistorySearch: () => void aiPanelHistoryRuntime.clearHistorySearch(),
    clearHistoryNoticeTimer: () => aiPanelHistoryRuntime.clearNoticeTimer(),
    closeChatSearch,
    closeConversationTab: (id: string) => aiPanelHistoryRuntime.closeConversationTab(id),
    closeHistoryMenu: () => aiPanelHistoryRuntime.closeHistoryMenu(),
    conversationTabTooltip,
    createNewAiConversation: () => aiPanelHistoryRuntime.createNewConversation(),
    deleteHistoryConversation: (id: string) => aiPanelHistoryRuntime.deleteHistoryConversation(id),
    displayConversationTitle,
    disposeChatSearchRuntime: () => aiPanelChatViewportRuntime.dispose(),
    editHistoryTitle: (id: string) => aiPanelHistoryRuntime.editHistoryTitle(id),
    editingHistoryId,
    editingHistoryTitle,
    ensureConversationTab: (id: string) => aiPanelHistoryRuntime.ensureConversationTab(id),
    exportCurrentChat: () => aiPanelHistoryRuntime.exportCurrentChat(),
    filteredHistoryConversations,
    findNextChatMatch,
    findPreviousChatMatch,
    formatHistoryTime,
    groupedVisibleHistory,
    handleChatSearchTermChanged: () => aiPanelChatViewportRuntime.handleSearchTermChanged(),
    hasMoreHistoryConversations,
    historyFavoriteLabel,
    historyFavoritesOnly,
    historyLoadingMore,
    historyMenuOpen,
    historySearchInputRef,
    historySearchTerm,
    loadMoreHistoryConversations: () => aiPanelHistoryRuntime.loadMoreHistoryConversations(hasMoreHistoryConversations.value),
    moreActionsMenuOpen,
    openChatSearch,
    openHistoryMenu: () => aiPanelHistoryRuntime.openHistoryMenu(),
    pruneConversationTabs: () => aiPanelHistoryRuntime.pruneConversationTabs(),
    resetHistoryFilters: () => aiPanelHistoryRuntime.resetHistoryFilters(),
    restoreConversationById: (id: string, successMessage?: string, failureMessage?: string) =>
      aiPanelHistoryRuntime.restoreConversationById(id, successMessage, failureMessage),
    restoreConversationFromTab: (id: string) => aiPanelHistoryRuntime.restoreConversationFromTab(id),
    restoreHistoryConversation: (id: string) => aiPanelHistoryRuntime.restoreHistoryConversation(id),
    saveHistoryTitle: (id: string) => aiPanelHistoryRuntime.saveHistoryTitle(id),
    showNotice: (message: string) => aiPanelHistoryRuntime.showNotice(message),
    syncSearchForMessages: () => aiPanelChatViewportRuntime.syncSearchForMessages(),
    toggleHistoryFavorite: (id: string) => aiPanelHistoryRuntime.toggleHistoryFavorite(id),
    toggleHistoryMenu: () => aiPanelHistoryRuntime.toggleHistoryMenu(),
    toggleMoreActionsMenu: () => aiPanelHistoryRuntime.toggleMoreActionsMenu(),
    visibleConversationTabs,
    visibleHistoryConversations
  }
}
