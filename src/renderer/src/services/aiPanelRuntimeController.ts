import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRef, watch, type Component, type ComponentPublicInstance } from 'vue'
import 'highlight.js/styles/atom-one-dark.css'
import '@xterm/xterm/css/xterm.css'
import {
  Bot,
  Brain,
  BookOpen,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Focus,
  Link2,
  LoaderCircle,
  FileText,
  FolderGit2,
  Image,
  LockKeyhole,
  Maximize2,
  Mic,
  Monitor,
  MinusSquare,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Sparkles,
  Square,
  Star,
  History,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  aiChipPartFromContext,
  aiImagePartFromContext
} from '@/services/aiPanelInputRuntime'
import {
  aiPanelChipLabel,
  aiPanelEditablePlainText,
  createAiPanelChipElement,
  createAiPanelCommandChipElement,
  createAiPanelContextChipElement,
  createAiPanelImageElement,
  extractAiPanelContentPartsFromEditable,
  insertAiPanelChipIntoEditableCursor,
  insertAiPanelImageIntoEditableCursor,
  insertAiPanelPlainTextIntoEditableCursor,
  removeAiPanelTokenBeforeRange,
  removeAiPanelTokenFromEditableCursor,
  renderAiPanelMainEditableFromState,
  renderAiPanelPartsIntoEditable,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import {
  aiPanelCharBeforeCaret,
  moveAiPanelEditableCaretToEnd,
  restoreAiPanelEditableSelection,
  saveAiPanelEditableSelection,
  shouldTriggerAiPanelCommandPopupForPendingSlash,
  shouldTriggerAiPanelCommandPopupForSlash
} from '@/services/aiPanelEditableSelectionRuntime'
import {
  allVisibleAiPanelHostsSelected,
  cloneAiPanelCommandOptions,
  cloneAiPanelContextCategories,
  filteredAiPanelCommands,
  filteredAiPanelContextOptions,
  filteredAiPanelOpenedHosts,
  selectedAiPanelCommand,
  selectedAiPanelCommandRef,
  selectedAiPanelContextCategory,
  sortedAiPanelDocsContextOptions,
  visibleAiPanelContextCategories,
  visibleAiPanelHostContextOptions,
  type AiPanelContextCategoryView
} from '@/services/aiPanelPopupRuntime'
import { createAiPanelContextCommandRuntime } from '@/services/aiPanelContextCommandRuntime'
import {
  createAiPanelPopupInteractionRuntime,
  createEmptyAiPanelPopupInteractionState
} from '@/services/aiPanelPopupInteractionRuntime'
import {
  createAiPanelModelRuntime,
  createEmptyAiPanelModelRuntimeState,
  displayAiPanelModelName,
  isThinkingAiPanelModelName
} from '@/services/aiPanelModelRuntime'
import {
  aiPanelChatExportMessage as chatExportMessage,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandLineCountForMessage,
  commandLineCountForText,
  commandOutputLineCount,
  commandTextForMessage,
  formatAiPanelLineCount as formatLineCount,
  isAiPanelCommandSuggestionMessage as isCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isReadOnlyCommandMessage,
  normalizedCommandOutputText,
  renderAiPanelMarkdownParts as renderedMarkdownParts,
  type AiPanelCommandSuggestionMessage as CommandSuggestionMessage
} from '@/services/aiPanelMessageRuntime'
import { createAiPanelMessageActionRuntime } from '@/services/aiPanelMessageActionRuntime'
import {
  createAiPanelCommandActionRuntime,
  createEmptyAiPanelCommandActionRuntimeState
} from '@/services/aiPanelCommandActionRuntime'
import {
  aiConversationTabTooltip,
  aiHistoryDateLabel,
  displayAiConversationTitle,
  filterAiHistoryConversations,
  formatAiHistoryTime,
  groupAiHistoryConversations,
  hasMoreAiHistoryConversations,
  visibleAiConversationTabs,
  visibleAiHistoryConversations
} from '@/services/aiPanelConversationRuntime'
import { createAiPanelChatSearchRuntime, createEmptyAiPanelChatSearchRuntimeState } from '@/services/aiPanelChatSearchRuntime'
import { createAiPanelHistoryRuntime, createEmptyAiPanelHistoryRuntimeState } from '@/services/aiPanelHistoryRuntime'
import { clipboardHasImageItems } from '@/services/aiPanelMediaRuntime'
import {
  aiPanelContextUsageColor,
  aiPanelContextUsageDisplay,
  aiPanelContextUsageTooltip,
  aiPanelContextUsageTrackColor,
  createAiPanelSurfaceRuntime
} from '@/services/aiPanelSurfaceRuntime'
import { createAiPanelAttachmentRuntime } from '@/services/aiPanelAttachmentRuntime'
import {
  cancelAiPanelMessageEdit,
  prepareAiPanelMessageEditConfirmation,
  removeAiPanelEditPartFromClickTarget,
  startAiPanelMessageEdit,
  syncAiPanelEditStateFromParts
} from '@/services/aiPanelEditRuntime'
import { createAiPanelComposerRuntime, isAiPanelComposerEmpty } from '@/services/aiPanelComposerRuntime'
import { createAiPanelVoiceRuntime } from '@/services/aiPanelVoiceRuntime'
import { aiChatClient } from '@/services/aiChatClient'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { codexTargetContextFromPanel } from '@/services/aiPanelCodexRuntime'
import { createAiPanelCodexConversationRuntime } from '@/services/aiPanelCodexConversationRuntime'
import {
  aiPanelChatMessagesSignature,
  aiPanelEditableStateSignature,
  createAiPanelLifecycleRuntime,
  type AiPanelOnboardingRequest
} from '@/services/aiPanelLifecycleRuntime'
import { malformedAiBackendResultMessage } from '@/services/aiBackendGuards'
import { useI18n } from '@/i18n'
import type {
  AiChipContentPart,
  AiContentPart,
  AiDocChipContentPart,
  AiImageContentPart,
  ConversationItem,
  TerminalPanel
} from '@/stores/workspace'
import type { AiCommandCatalogOption, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContainerRuntimeProps = { agentMode?: boolean }

export const useAiPanelContainerRuntime = (props: AiPanelContainerRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const { locale, t } = useI18n()
  const agentMode = computed(() => Boolean(props.agentMode))
  type AiChatMode = 'agent' | 'cmd'
  type AiContextCategoryView = AiPanelContextCategoryView<Component>

  const aiChatModeOptions: Array<{ id: AiChatMode; label: string; detail: string }> = [
    { id: 'agent', label: 'Agent', detail: '上下文辅助与工具调用' },
    { id: 'cmd', label: 'Command', detail: '生成命令与解释' }
  ]

  const aiContextCategoryIcons: Record<AiContextKind, Component> = {
    hosts: Server,
    docs: FileText,
    images: Image,
    skills: Bot,
    chats: Search
  }
  const draft = ref('')
  const imageInputParts = ref<AiImageContentPart[]>([])
  const fileInputParts = ref<AiDocChipContentPart[]>([])
  const chatScrollRef = ref<HTMLElement | null>(null)
  const editableRef = ref<HTMLElement | null>(null)
  const editEditableRef = ref<HTMLElement | null>(null)
  const chatSearchInputRef = ref<HTMLInputElement | null>(null)
  const historySearchInputRef = ref<HTMLInputElement | null>(null)
  const editingMessageId = ref<string | null>(null)
  const editDraft = ref('')
  const editImageInputParts = ref<AiImageContentPart[]>([])
  const editFileInputParts = ref<AiDocChipContentPart[]>([])
  const editHostContexts = ref<AiContextOption[]>([])
  const modelSearchInputRef = ref<HTMLInputElement | null>(null)
  const contextSearchInputRef = ref<HTMLInputElement | null>(null)
  const commandSearchInputRef = ref<HTMLInputElement | null>(null)
  const savedRange = ref<Range | null>(null)
  const editSavedRange = ref<Range | null>(null)
  const popupInteractionState = reactive(createEmptyAiPanelPopupInteractionState())
  const contextPopupOpen = toRef(popupInteractionState, 'contextPopupOpen')
  const commandPopupOpen = toRef(popupInteractionState, 'commandPopupOpen')
  const contextTarget = toRef(popupInteractionState, 'contextTarget')
  const commandTarget = toRef(popupInteractionState, 'commandTarget')
  const contextLevel = toRef(popupInteractionState, 'contextLevel')
  const contextQuery = toRef(popupInteractionState, 'contextQuery')
  const commandQuery = toRef(popupInteractionState, 'commandQuery')
  const contextKeyboardIndex = toRef(popupInteractionState, 'contextKeyboardIndex')
  const commandKeyboardIndex = toRef(popupInteractionState, 'commandKeyboardIndex')
  const docsCurrentRelDir = toRef(popupInteractionState, 'docsCurrentRelDir')
  const docsDirStack = toRef(popupInteractionState, 'docsDirStack')
  const modelRuntimeState = reactive(createEmptyAiPanelModelRuntimeState())
  const chatMode = toRef(modelRuntimeState, 'chatMode')
  const modeMenuOpen = toRef(modelRuntimeState, 'modeMenuOpen')
  const modelMenuOpen = toRef(modelRuntimeState, 'modelMenuOpen')
  const modelQuery = toRef(modelRuntimeState, 'modelQuery')
  const dropActive = ref(false)
  const syncingFromEditable = ref(false)
  const inputPlaceholderNotice = ref('')
  const historyRuntimeState = reactive(createEmptyAiPanelHistoryRuntimeState())
  const chatSearchRuntimeState = reactive(createEmptyAiPanelChatSearchRuntimeState())
  const commandActionRuntimeState = reactive(createEmptyAiPanelCommandActionRuntimeState())
  const chatSearchOpen = toRef(historyRuntimeState, 'chatSearchOpen')
  const chatSearchTerm = toRef(chatSearchRuntimeState, 'term')
  const chatSearchMatchCount = toRef(chatSearchRuntimeState, 'matchCount')
  const chatSearchCurrentIndex = toRef(chatSearchRuntimeState, 'currentIndex')
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
  const commandAuditTextareaRef = ref<HTMLTextAreaElement | null>(null)
  const commandAuditDialog = toRef(commandActionRuntimeState, 'commandAuditDialog')
  let classicChatDataLoaded = false
  let chatScrollFrame: number | undefined
  const historyPageSize = 20
  const historyFavoriteLabel = computed(() => t('ai.historyFavoriteGroup'))
  const maxHostContexts = 5
  const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))
  const visibleConversationTabs = computed(() => visibleAiConversationTabs(openConversationTabIds.value, workspace.conversations))
  const displayConversationTitle = (conversation: Pick<ConversationItem, 'title'>) =>
    displayAiConversationTitle(conversation, t('ai.untitledChat'))
  const conversationTabTooltip = (conversation: ConversationItem) => aiConversationTabTooltip(conversation, t('ai.untitledChat'))
  const ensureConversationTab = (id: string) => aiPanelHistoryRuntime.ensureConversationTab(id)
  const pruneConversationTabs = () => aiPanelHistoryRuntime.pruneConversationTabs()
  const historyLabels = computed(() => ({
    today: t('ai.historyToday'),
    yesterday: t('ai.historyYesterday'),
    daysAgo: (count: number) => t('ai.historyDaysAgo').replace('{count}', String(count)),
    favoriteGroup: t('ai.historyFavoriteGroup')
  }))
  const filteredHistoryConversations = computed(() =>
    filterAiHistoryConversations(workspace.sortedConversations, historySearchTerm.value, historyFavoritesOnly.value)
  )
  const visibleHistoryConversations = computed(() =>
    visibleAiHistoryConversations(filteredHistoryConversations.value, historyCurrentPage.value, historyPageSize)
  )
  const hasMoreHistoryConversations = computed(() =>
    hasMoreAiHistoryConversations(filteredHistoryConversations.value.length, visibleHistoryConversations.value.length)
  )
  const groupedVisibleHistory = computed(() => {
    const labels = historyLabels.value
    return groupAiHistoryConversations(visibleHistoryConversations.value, (conversation) =>
      historyFavoritesOnly.value ? labels.favoriteGroup : aiHistoryDateLabel(conversation.ts, new Date(), locale.value, labels)
    )
  })

  const aiPanelHistoryRuntime = createAiPanelHistoryRuntime<ConversationItem>({
    state: historyRuntimeState,
    conversations: () => workspace.conversations,
    selectedConversationId: () => workspace.selectedConversationId,
    visibleTabs: () => visibleConversationTabs.value,
    visibleHistoryCount: () => visibleHistoryConversations.value.length,
    chatMessageCount: () => workspace.chatMessages.length,
    currentConversationTitle: () => getCurrentConversationTitle(),
    exportMessages: () => workspace.chatMessages.map(chatExportMessage),
    createConversation: () => workspace.createConversation(),
    restoreConversation: (id) => workspace.restoreConversation(id),
    renameConversation: (id, title) => workspace.renameConversation(id, title),
    deleteConversation: (id) => workspace.deleteConversation(id),
    toggleConversationFavorite: (id) => workspace.toggleConversationFavorite(id),
    loadConversations: () => workspace.loadChatConversationsFromBackend({ restoreIfEmpty: false }),
    exportChat: () => aiChatClient.exportChat(),
    closeContextPopup: () => closeContextPopup(),
    closeCommandPopup: () => closeCommandPopup(),
    closeModelMenu: () => {
      aiPanelModelRuntime.closeModeMenu()
      aiPanelModelRuntime.closeModelMenu()
    },
    focusHistorySearchInput: () => nextTick(() => historySearchInputRef.value?.focus()),
    focusHistoryTitleInput: () =>
      nextTick(() => {
        const input = historySearchInputRef.value?.closest('.ai-history-dropdown')?.querySelector<HTMLInputElement>('.ai-history-title-input')
        input?.focus()
        input?.select()
      }),
    setNoticeTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearNoticeTimer: (timer) => window.clearTimeout(timer as number),
    labels: {
      chatCreated: () => t('ai.chatCreated'),
      chatCreateFailed: () => t('ai.chatCreateFailed'),
      chatRestored: () => t('ai.chatRestored'),
      chatRestoreFailed: () => t('ai.chatRestoreFailed'),
      keepOneTab: () => t('ai.keepOneTab'),
      tabClosed: () => t('ai.tabClosed'),
      historyTitleUpdated: () => t('ai.historyTitleUpdated'),
      historyTitleUpdateFailed: () => t('ai.historyTitleUpdateFailed'),
      chatDeleted: () => t('ai.chatDeleted'),
      chatDeleteFailed: () => t('ai.chatDeleteFailed'),
      historyFavorited: () => t('ai.historyFavorited'),
      historyUnfavorited: () => t('ai.historyUnfavorited'),
      historyFavoriteUpdateFailed: () => t('ai.historyFavoriteUpdateFailed'),
      exportEmpty: () => '当前会话为空，无法导出。',
      exportUnavailable: () => '聊天导出服务不可用。',
      exportFailed: (message) => `导出失败：${message}`,
      exportMalformed: () => `导出失败：${malformedAiBackendResultMessage}`,
      exportSuccess: () => '聊天已导出。'
    }
  })

  const loadClassicChatData = async () => {
    if (classicChatDataLoaded) return
    classicChatDataLoaded = true
    await Promise.all([workspace.refreshAiModelCatalog({ replaceSettingsOptions: false }), workspace.hydrateClassicChatData()])
  }

  const showChatExportNotice = (message: string) => {
    aiPanelHistoryRuntime.showNotice(message)
  }

  const aiPanelCodexRuntime = createAiPanelCodexConversationRuntime({
    agentMode: () => Boolean(props.agentMode),
    activePanel: () => workspace.activePanel,
    panels: () => workspace.panels,
    terminalSettings: () => workspace.terminalSettings,
    aiContextCatalog: () => workspace.aiContextCatalog,
    loadClassicChatData,
    closePopups: () => closePopups(),
    showNotice: showChatExportNotice,
    setTopNotice: (message) => workspace.setTopNotice(message),
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    openTerminalForAiHostContext: (host) => workspace.openTerminalForAiHostContext(host),
    activateTerminalPanel: (panelId) => workspace.activateTerminalPanel(panelId),
    upsertAiAttentionItem: (input) => workspace.upsertAiAttentionItem(input),
    removeAiAttentionItem: (id) => workspace.removeAiAttentionItem(id),
    markAiAttentionHandled: (id) => workspace.markAiAttentionHandled(id),
    afterDomUpdate: () => nextTick(),
    t
  })

  const {
    activeCodexBoundTarget,
    activeCodexConversation,
    activeCodexConversationId,
    activeCodexTargetSignature,
    aiPanelMode,
    applyCodexTerminalSettingsToAll,
    bindCodexTarget,
    bindHostContextToCodex,
    bindTerminalPanelToCodex,
    closeCodexConversation,
    closeCodexTargetPicker,
    codexBoundTargetDetail,
    codexBoundTargetLabel,
    codexConversations,
    codexConversationTitle,
    codexStatusLabel,
    codexTargetPickerOpen,
    codexTargetQuery,
    copyCodexSelectionFromContextMenu,
    createNewCodexConversation,
    currentAiPanelModeLabel,
    currentPanelTarget,
    filteredCodexHostTargets,
    focusAiAttentionItem,
    focusCodexTerminal,
    locateCodexBoundTarget,
    panelModeMenuOpen,
    restartCodexSession,
    selectAiPanelMode,
    selectCodexConversation,
    setCodexTerminalHostRef,
    startInitialMode,
    syncActiveCodexTargetContext,
    terminalSettingsSignature,
    toggleAiPanelModeMenu,
    toggleCodexTargetPicker,
    unbindCodexTarget
  } = aiPanelCodexRuntime

  const closeModelMenu = () => {
    aiPanelModelRuntime.closeModelMenu()
  }

  const formatHistoryTime = (timestamp: number) => formatAiHistoryTime(timestamp, new Date(), locale.value, historyLabels.value)

  const getCurrentConversationTitle = () =>
    workspace.conversations.find((conversation) => conversation.id === workspace.selectedConversationId)?.title || 'Chat Export'

  const aiPanelMessageActionRuntime = createAiPanelMessageActionRuntime({
    messages: () => workspace.chatMessages,
    copyText: copyTextToClipboard,
    notify: showChatExportNotice,
    approveMcpToolCall: (id, options) => workspace.approveAiMcpToolCall(id, options),
    rejectMcpToolCall: (id) => workspace.rejectAiMcpToolCall(id),
    approveMcpResourceAccess: (id) => workspace.approveAiMcpResourceAccess(id),
    rejectMcpResourceAccess: (id) => workspace.rejectAiMcpResourceAccess(id),
    toggleMessageFavorite: (id) => workspace.toggleMessageFavorite(id),
    setMessageFeedback: (id, feedback) => workspace.setMessageFeedback(id, feedback),
    retryAssistantMessage: (id) => workspace.retryAssistantMessage(id),
    summarizeMessageToKnowledge: (id) => workspace.summarizeMessageToKnowledge(id),
    summarizeMessageToSkill: (id) => workspace.summarizeMessageToSkill(id)
  })

  const copyRenderedTextToClipboard = aiPanelMessageActionRuntime.copyRenderedTextToClipboard
  const copyMessageToClipboard = aiPanelMessageActionRuntime.copyMessageToClipboard

  const scrollChatToBottom = () => {
    const root = chatScrollRef.value
    if (!root) return
    root.scrollTop = root.scrollHeight
  }

  const scheduleChatScrollToBottom = () => {
    void nextTick(() => {
      if (chatScrollFrame !== undefined) window.cancelAnimationFrame(chatScrollFrame)
      chatScrollFrame = window.requestAnimationFrame(() => {
        chatScrollFrame = undefined
        scrollChatToBottom()
      })
    })
  }

  const aiPanelChatSearchRuntime = createAiPanelChatSearchRuntime({
    state: chatSearchRuntimeState,
    isOpen: () => chatSearchOpen.value,
    setOpen: (open) => {
      chatSearchOpen.value = open
      if (open) moreActionsMenuOpen.value = false
    },
    root: () => chatScrollRef.value,
    closePopups: () => closePopups(),
    focusSearchInput: () => chatSearchInputRef.value?.focus(),
    afterDomUpdate: () => nextTick(),
    scheduleScrollToBottom: scheduleChatScrollToBottom,
    setSearchTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearSearchTimer: (timer) => window.clearTimeout(timer as number)
  })

  const openChatSearch = () => aiPanelChatSearchRuntime.openSearch()
  const closeChatSearch = () => aiPanelChatSearchRuntime.closeSearch()
  const clearChatSearch = () => aiPanelChatSearchRuntime.clearSearch()
  const findNextChatMatch = () => aiPanelChatSearchRuntime.findNextMatch()
  const findPreviousChatMatch = () => aiPanelChatSearchRuntime.findPreviousMatch()

  const aiPanelCommandActionRuntime = createAiPanelCommandActionRuntime({
    state: commandActionRuntimeState,
    messages: () => workspace.chatMessages,
    activePanel: () => workspace.activePanel,
    panels: () => workspace.panels,
    chatMode: () => chatMode.value,
    copyText: copyTextToClipboard,
    notify: showChatExportNotice,
    runActiveTerminalCommand: (command, source) => workspace.runActiveTerminalCommand(command, source),
    continueAgentCommandLoop: (input) => workspace.continueAgentCommandLoop(input),
    enableAgentReadOnlyAutoRunForCurrentConversation: () => workspace.enableAgentReadOnlyAutoRunForCurrentConversation(),
    syncCurrentConversationSnapshot: (options) => workspace.syncCurrentConversationSnapshot(options)
  })

  const activeCommandAuditMessage = computed(() => aiPanelCommandActionRuntime.activeCommandAuditMessage())
  const canEditActiveCommandAudit = computed(() => aiPanelCommandActionRuntime.canEditActiveCommandAudit())
  const copyCommandToClipboard = aiPanelCommandActionRuntime.copyCommandToClipboard
  const closeCommandAuditDialog = aiPanelCommandActionRuntime.closeCommandAuditDialog
  const saveCommandAuditDraft = aiPanelCommandActionRuntime.saveCommandAuditDraft
  const copyCommandAuditDraft = aiPanelCommandActionRuntime.copyCommandAuditDraft
  const rejectMessageCommand = aiPanelCommandActionRuntime.rejectMessageCommand
  const runMessageCommand = aiPanelCommandActionRuntime.runMessageCommand

  const openCommandAuditDialog = async (message: CommandSuggestionMessage) => {
    aiPanelCommandActionRuntime.openCommandAuditDialog(message)
    closePopups()
    await nextTick()
    commandAuditTextareaRef.value?.focus()
    commandAuditTextareaRef.value?.select()
  }

  const runCommandAuditDraft = aiPanelCommandActionRuntime.runCommandAuditDraft

  const formatMcpToolArguments = aiPanelMessageActionRuntime.formatMcpToolArguments
  const approveMcpToolCall = aiPanelMessageActionRuntime.approveMcpToolCall
  const rejectMcpToolCall = aiPanelMessageActionRuntime.rejectMcpToolCall
  const approveMcpResourceAccess = aiPanelMessageActionRuntime.approveMcpResourceAccess
  const rejectMcpResourceAccess = aiPanelMessageActionRuntime.rejectMcpResourceAccess
  const toggleMessageFavorite = aiPanelMessageActionRuntime.toggleMessageFavorite
  const setMessageFeedback = aiPanelMessageActionRuntime.setMessageFeedback
  const retryAssistantMessage = aiPanelMessageActionRuntime.retryAssistantMessage
  const summarizeMessageToKnowledge = aiPanelMessageActionRuntime.summarizeMessageToKnowledge
  const summarizeMessageToSkill = aiPanelMessageActionRuntime.summarizeMessageToSkill

  const exportCurrentChat = () => aiPanelHistoryRuntime.exportCurrentChat()
  const openHistoryMenu = () => aiPanelHistoryRuntime.openHistoryMenu()
  const closeHistoryMenu = () => aiPanelHistoryRuntime.closeHistoryMenu()
  const toggleHistoryMenu = () => aiPanelHistoryRuntime.toggleHistoryMenu()
  const toggleMoreActionsMenu = () => aiPanelHistoryRuntime.toggleMoreActionsMenu()
  const clearHistorySearch = () => void aiPanelHistoryRuntime.clearHistorySearch()
  const createNewAiConversation = () => aiPanelHistoryRuntime.createNewConversation()
  const restoreConversationById = (id: string, successMessage = t('ai.chatRestored'), failureMessage = t('ai.chatRestoreFailed')) =>
    aiPanelHistoryRuntime.restoreConversationById(id, successMessage, failureMessage)
  const restoreConversationFromTab = (id: string) => aiPanelHistoryRuntime.restoreConversationFromTab(id)
  const closeConversationTab = (id: string) => aiPanelHistoryRuntime.closeConversationTab(id)
  const restoreHistoryConversation = (id: string) => aiPanelHistoryRuntime.restoreHistoryConversation(id)
  const editHistoryTitle = (id: string) => aiPanelHistoryRuntime.editHistoryTitle(id)
  const cancelHistoryTitleEdit = () => aiPanelHistoryRuntime.cancelHistoryTitleEdit()
  const saveHistoryTitle = (id: string) => aiPanelHistoryRuntime.saveHistoryTitle(id)
  const deleteHistoryConversation = (id: string) => aiPanelHistoryRuntime.deleteHistoryConversation(id)
  const toggleHistoryFavorite = (id: string) => aiPanelHistoryRuntime.toggleHistoryFavorite(id)
  const loadMoreHistoryConversations = () => aiPanelHistoryRuntime.loadMoreHistoryConversations(hasMoreHistoryConversations.value)

  type AiCommandOption = AiCommandCatalogOption

  const setEditEditableRef = (el: Element | ComponentPublicInstance | null) => {
    editEditableRef.value = el instanceof HTMLElement ? el : null
  }

  const aiContextCategories = computed<AiContextCategoryView[]>(() =>
    cloneAiPanelContextCategories(workspace.aiContextCatalog.categories, (kind) => aiContextCategoryIcons[kind] || Search)
  )
  const selectedContextCategory = computed(() => selectedAiPanelContextCategory(aiContextCategories.value, contextLevel.value))
  const docsContextOptions = computed<AiContextOption[]>(() =>
    sortedAiPanelDocsContextOptions(selectedContextCategory.value?.options || [], docsCurrentRelDir.value)
  )
  const commandOptions = computed<AiCommandOption[]>(() => cloneAiPanelCommandOptions(workspace.aiCommandOptions))
  const displayedOpenedHosts = computed(() =>
    filteredAiPanelOpenedHosts(workspace.aiContextCatalog.openedHosts, contextQuery.value, chatMode.value)
  )
  const visibleContextCategories = computed(() => visibleAiPanelContextCategories(aiContextCategories.value, chatMode.value))
  const filteredContextOptions = computed(() =>
    filteredAiPanelContextOptions({
      level: contextLevel.value,
      selectedCategoryOptions: selectedContextCategory.value?.options,
      docsOptions: docsContextOptions.value,
      skillOptions: workspace.aiSkillContextOptions,
      query: contextQuery.value
    })
  )
  const visibleHostContextOptions = computed(() => visibleAiPanelHostContextOptions(filteredContextOptions.value))
  const hostContextsForPopup = computed(() =>
    contextTarget.value === 'edit' ? editHostContexts.value : workspace.selectedContexts.filter((context) => context.kind === 'hosts')
  )
  const allVisibleHostContextsSelected = computed(() => allVisibleAiPanelHostsSelected(visibleHostContextOptions.value, hostContextsForPopup.value))
  const filteredCommands = computed(() => filteredAiPanelCommands(commandOptions.value, commandQuery.value))
  const selectedCommand = computed(() => selectedAiPanelCommand(commandOptions.value, workspace.selectedCommandId))
  const composerIsEmpty = computed(() =>
    isAiPanelComposerEmpty({
      draft: draft.value,
      selectedContextCount: workspace.selectedContexts.length,
      images: imageInputParts.value,
      files: fileInputParts.value,
      selectedCommand: selectedCommand.value
    })
  )

  const measureUiTextWidthPx = (text: string) => {
    if (!text) return 0
    if (typeof document === 'undefined') return text.length * 7
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return text.length * 7
    context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
    return context.measureText(text).width
  }

  const aiPanelModelRuntime = createAiPanelModelRuntime({
    state: modelRuntimeState,
    chatModeOptions: () => aiChatModeOptions,
    availableModels: () => workspace.aiModelOptions,
    lockedModels: () => workspace.lockedAiModelOptions,
    settingsModelCount: () => workspace.settingModelOptions.length,
    selectedModelName: () => workspace.config.modelName,
    selectModel: (modelId) => workspace.selectAiModel(modelId),
    closeContextPopup: () => closeContextPopup(),
    closeCommandPopup: () => closeCommandPopup(),
    closePopups: () => closePopups(),
    openModelSettings: () => {
      workspace.setActiveModule('settings')
      workspace.setActiveSettingsSection('models')
    },
    openModelLogin: async () => {
      await workspace.openUserLogin()
    },
    focusModelSearchInput: () => modelSearchInputRef.value?.focus(),
    afterDomUpdate: () => nextTick(),
    measureText: measureUiTextWidthPx,
    lockedModelTooltip: (tier) => `模型已锁定，升级 ${tier} 后可用`
  })

  const currentChatMode = computed(() => aiPanelModelRuntime.currentChatMode())
  const selectedModelLabel = computed(() => aiPanelModelRuntime.selectedModelLabel())
  const filteredModelOptions = computed(() => aiPanelModelRuntime.filteredModelOptions())
  const filteredLockedModelOptions = computed(() => aiPanelModelRuntime.filteredLockedModelOptions())
  const showNoAvailableModelPrompt = computed(() => aiPanelModelRuntime.showNoAvailableModelPrompt())
  const modeDropdownWidthPx = computed(() => aiPanelModelRuntime.modeDropdownWidthPx())
  const modelDropdownWidthPx = computed(() => aiPanelModelRuntime.modelDropdownWidthPx())
  const displayModelName = displayAiPanelModelName
  const isThinkingModelName = isThinkingAiPanelModelName
  const lockedModelTooltip = aiPanelModelRuntime.lockedModelTooltip
  const selectedCommandRef = computed(() => {
    return selectedAiPanelCommandRef(selectedCommand.value, workspace.selectedCommandId, workspace.selectedCommandRef)
  })

  const contextUsage = computed(() => aiPanelContextUsageDisplay(workspace.aiContextUsage))
  const contextUsageColor = computed(() => aiPanelContextUsageColor(contextUsage.value))
  const contextUsageTrackColor = computed(() => aiPanelContextUsageTrackColor())
  const contextUsageTooltip = computed(() => aiPanelContextUsageTooltip(contextUsage.value))

  const commandIconMarkup =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path></svg>'

  const iconMarkupByContextKind: Record<AiContextKind, string> = {
    hosts: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>',
    docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>',
    images: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L6 20"></path></svg>',
    skills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8z"></path><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"></path></svg>',
    chats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>'
  }

  const iconMarkupByChipType: Record<AiChipContentPart['chipType'], string> = {
    doc: iconMarkupByContextKind.docs,
    chat: iconMarkupByContextKind.chats,
    command: commandIconMarkup,
    skill: iconMarkupByContextKind.skills
  }

  const imagePartFromContext = aiImagePartFromContext
  const chipPartFromContext = aiChipPartFromContext

  const removeEditHostContext = (id: string) => {
    editHostContexts.value = editHostContexts.value.filter((context) => context.id !== id)
  }

  const openEditContextPopup = () => {
    openContextPopupForTarget('edit')
  }

  const editableRenderOptions = computed<AiPanelEditableRenderOptions>(() => ({
    iconMarkupByContextKind,
    commandIconMarkup
  }))

  const getChipLabel = aiPanelChipLabel

  const createChipElement = (
    part: AiChipContentPart,
    options: { removableContextId?: string; removableCommand?: boolean; removablePart?: boolean } = {}
  ) => createAiPanelChipElement(part, editableRenderOptions.value, options)

  const insertImageIntoEditableCursor = (editable: HTMLElement | null, part: AiImageContentPart, onInserted: () => void) =>
    insertAiPanelImageIntoEditableCursor(editable, part, onInserted)

  const insertImageAtEditableCursor = (part: AiImageContentPart) => {
    return insertImageIntoEditableCursor(editableRef.value, part, () => {
      imageInputParts.value = [...imageInputParts.value, part]
      handleEditableInput()
    })
  }

  const insertImageAtEditCursor = (part: AiImageContentPart) => {
    return insertImageIntoEditableCursor(editEditableRef.value, part, () => {
      editImageInputParts.value = [...editImageInputParts.value, part]
      handleEditEditableInput()
    })
  }

  const insertContextAtEditCursor = (context: AiContextOption) => {
    const imagePart = imagePartFromContext(context)
    if (imagePart) {
      return insertImageAtEditCursor(imagePart)
    }

    const chipPart = chipPartFromContext(context)
    if (!chipPart) return false
    restoreEditSelection()
    const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
    return insertChipIntoEditableCursor(editTarget, chipPart, handleEditEditableInput, '@')
  }

  const insertFileChipAtMainCursor = (part: AiDocChipContentPart) => {
    restoreEditableSelection()
    return insertChipIntoEditableCursor(editableRef.value, part, () => {
      fileInputParts.value = [...fileInputParts.value, part]
      handleEditableInput()
    }, '@')
  }

  const insertFileChipAtEditCursor = (part: AiDocChipContentPart) => {
    restoreEditSelection()
    const editTarget = editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null)
    return insertChipIntoEditableCursor(editTarget, part, handleEditEditableInput, '@')
  }

  const clipboardHasImage = (event: ClipboardEvent) => clipboardHasImageItems(event.clipboardData?.items)

  const insertPlainTextIntoEditableCursor = (editable: HTMLElement | null, text: string, onInserted: () => void) =>
    insertAiPanelPlainTextIntoEditableCursor(editable, text, onInserted)

  const insertPlainTextAtEditCursor = (text: string) => {
    insertPlainTextIntoEditableCursor(editEditableRef.value, text, handleEditEditableInput)
  }

  const removeTokenBeforeRange = removeAiPanelTokenBeforeRange

  const removeTokenFromEditableCursor = removeAiPanelTokenFromEditableCursor

  const insertChipIntoEditableCursor = (editable: HTMLElement | null, part: AiChipContentPart, onInserted: () => void, triggerToken = '/') =>
    insertAiPanelChipIntoEditableCursor(editable, part, editableRenderOptions.value, onInserted, triggerToken)

  const saveEditSelection = () => {
    editSavedRange.value = saveAiPanelEditableSelection(editEditableRef.value) || editSavedRange.value
  }

  const restoreEditSelection = () => {
    restoreAiPanelEditableSelection(editEditableRef.value, editSavedRange.value)
  }

  const shouldTriggerCommandPopupFromEditableText = () => {
    const text = editablePlainText()
    return /(?:^|\s)\/$/.test(text)
  }

  const openCommandPopupForTarget = (target: 'main' | 'edit') => aiPanelPopupInteractionRuntime.openCommandPopupForTarget(target)

  function openContextPopupForTarget(target: 'main' | 'edit', level: 'main' | AiContextKind = 'main') {
    aiPanelPopupInteractionRuntime.openContextPopupForTarget(target, level)
  }

  const renderPartsIntoEditable = (editable: HTMLElement, parts: AiContentPart[]) =>
    renderAiPanelPartsIntoEditable(editable, parts, editableRenderOptions.value)

  const renderEditableFromState = () => {
    const editable = editableRef.value
    if (!editable) return
    syncingFromEditable.value = true
    const active = document.activeElement === editable
    renderAiPanelMainEditableFromState(
      editable,
      {
        draft: draft.value,
        images: imageInputParts.value,
        files: fileInputParts.value,
        command: selectedCommandRef.value
      },
      editableRenderOptions.value
    )
    if (active && !contextPopupOpen.value && !commandPopupOpen.value && !modelMenuOpen.value) {
      moveEditableCaretToEnd()
    }
    void nextTick(() => {
      syncingFromEditable.value = false
    })
  }

  const setDraft = (value: string) => {
    draft.value = value
    void nextTick(() => {
      renderEditableFromState()
    })
  }

  const editablePlainText = () => {
    return aiPanelEditablePlainText(editableRef.value)
  }

  const contextById = (id: string) => workspace.selectedContexts.find((item) => item.id === id) || null

  const extractEditableContentParts = () => {
    return extractAiPanelContentPartsFromEditable(editableRef.value, { contextById })
  }

  const extractContentPartsFromEditable = (editable: HTMLElement | null) => {
    return extractAiPanelContentPartsFromEditable(editable, { contextById })
  }

  const editableTextFromElement = (editable: HTMLElement | null) => {
    return aiPanelEditablePlainText(editable)
  }

  const renderEditEditableFromParts = (parts: AiContentPart[]) => {
    const editable = editEditableRef.value
    if (!editable) return
    renderPartsIntoEditable(editable, parts)
    const nextState = syncAiPanelEditStateFromParts(parts, editableTextFromElement(editable))
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    requestAnimationFrame(() => {
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      editable.focus()
    })
  }

  const startMessageEdit = async (message: { id: string; role: string; text: string; contentParts?: AiContentPart[]; hosts?: AiContextOption[] }) => {
    const edit = startAiPanelMessageEdit(message)
    if (!edit) return
    editingMessageId.value = edit.state.editingMessageId
    editDraft.value = edit.state.editDraft
    editImageInputParts.value = edit.state.editImageInputParts
    editFileInputParts.value = edit.state.editFileInputParts
    editHostContexts.value = edit.state.editHostContexts
    closePopups()
    await nextTick()
    renderEditEditableFromParts(edit.parts)
  }

  const cancelMessageEdit = () => {
    const nextState = cancelAiPanelMessageEdit()
    editingMessageId.value = nextState.editingMessageId
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    editHostContexts.value = nextState.editHostContexts
    editSavedRange.value = null
  }

  const handleEditEditableInput = () => {
    const nextState = syncAiPanelEditStateFromParts(
      extractContentPartsFromEditable(editEditableRef.value),
      editableTextFromElement(editEditableRef.value)
    )
    editDraft.value = nextState.editDraft
    editImageInputParts.value = nextState.editImageInputParts
    editFileInputParts.value = nextState.editFileInputParts
    saveEditSelection()
  }

  const handleEditEditableClick = (event: MouseEvent) => {
    const removed = removeAiPanelEditPartFromClickTarget(event.target as HTMLElement)
    if (removed) {
      handleEditEditableInput()
      return
    }
    saveEditSelection()
  }

  const handleEditEditablePaste = (event: ClipboardEvent) => {
    if (clipboardHasImage(event)) {
      event.preventDefault()
      void insertPastedImageIntoEdit()
      return
    }

    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') || ''
    insertPlainTextAtEditCursor(text)
  }

  const confirmMessageEdit = async () => {
    const contentParts = extractContentPartsFromEditable(editEditableRef.value)
    const confirmation = prepareAiPanelMessageEditConfirmation(
      {
        editingMessageId: editingMessageId.value,
        editHostContexts: editHostContexts.value
      },
      contentParts
    )
    if (!confirmation) return
    const sent = await workspace.resendUserMessageFromParts(confirmation.messageId, confirmation.contentParts, confirmation.hostContexts)
    if (sent) cancelMessageEdit()
  }

  const handleEditEditableKeydown = (event: KeyboardEvent) => {
    aiPanelPopupInteractionRuntime.handleEditEditableKeydown(event, popupEditableKeydownInput())
  }

  const saveEditableSelection = () => {
    savedRange.value = saveAiPanelEditableSelection(editableRef.value) || savedRange.value
  }

  const moveEditableCaretToEnd = () => {
    savedRange.value = moveAiPanelEditableCaretToEnd(editableRef.value) || savedRange.value
  }

  const aiPanelSurfaceRuntime = createAiPanelSurfaceRuntime({
    state: {
      dropActive,
      inputPlaceholderNotice
    },
    mode: () => aiPanelMode.value,
    selectedConversationId: () => workspace.selectedConversationId,
    panels: () => workspace.panels,
    createConversation: () => workspace.createConversation(),
    addKnowledgeFilesToChat: (relPaths) => workspace.addKnowledgeFilesToChat(relPaths),
    bindTerminalPanelToCodex,
    bindHostContextToCodex,
    draftText: () => draft.value,
    setDraft,
    closePopups: () => closePopups(),
    moveCaretToEnd: moveEditableCaretToEnd,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    setNoticeTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearNoticeTimer: (timer) => window.clearTimeout(timer)
  })

  const showInputPlaceholderNotice = aiPanelSurfaceRuntime.showInputPlaceholderNotice
  const ensureAttachmentConversationId = aiPanelSurfaceRuntime.ensureAttachmentConversationId

  const aiPanelAttachmentRuntime = createAiPanelAttachmentRuntime({
    streaming: () => streaming.value,
    editingMessageId: () => editingMessageId.value,
    ensureConversationId: ensureAttachmentConversationId,
    insertImageAtMainCursor: insertImageAtEditableCursor,
    insertImageAtEditCursor,
    insertFileChipAtMainCursor,
    insertFileChipAtEditCursor,
    notify: showInputPlaceholderNotice
  })

  const {
    insertImageFilePaths,
    insertPastedImage,
    insertPastedImageIntoEdit,
    openImagePicker,
    handleFileUpload
  } = aiPanelAttachmentRuntime

  const aiPanelComposerRuntime = createAiPanelComposerRuntime({
    editable: () => editableRef.value,
    draft: () => draft.value,
    selectedCommandId: () => workspace.selectedCommandId,
    streaming: () => streaming.value,
    noModelPrompt: () => showNoAvailableModelPrompt.value,
    chatMode: () => chatMode.value,
    agentMode: () => props.agentMode,
    clipboardHasImage,
    extractContentParts: extractEditableContentParts,
    cancelStreaming: () => workspace.cancelStreamingAiChatResponse(),
    sendChat: (text, contentParts, mode) => workspace.sendChat(text, contentParts, undefined, { mode }),
    clearSelectedCommand: () => workspace.selectCommandPreset(null),
    removeContext: (id) => workspace.removeContext(id),
    setDraftFromEditable: (value) => {
      draft.value = value
    },
    resetDraft: setDraft,
    setImageInputParts: (parts) => {
      imageInputParts.value = parts
    },
    setFileInputParts: (parts) => {
      fileInputParts.value = parts
    },
    saveSelection: saveEditableSelection,
    setSyncingFromEditable: (value) => {
      syncingFromEditable.value = value
    },
    afterInputSync: () => nextTick(),
    insertPastedImage,
    scheduleCaretToEnd: () => requestAnimationFrame(moveEditableCaretToEnd),
    closePopups: () => closePopups(),
    notify: showInputPlaceholderNotice
  })

  const handleEditableInput = () => aiPanelComposerRuntime.handleInput()
  const insertPlainTextAtEditableCursor = (text: string) => aiPanelComposerRuntime.insertPlainTextAtCursor(text)
  const handleSend = async () => {
    await aiPanelComposerRuntime.send()
  }

  const appendVoiceTranscriptionToInput = (text: string) => {
    restoreEditableSelection()
    insertPlainTextAtEditableCursor(text)
    requestAnimationFrame(moveEditableCaretToEnd)
  }

  const aiPanelVoiceRuntime = createAiPanelVoiceRuntime({
    streaming: () => streaming.value,
    draft: () => draft.value,
    closePopups: () => closePopups(),
    restoreSelection: () => restoreEditableSelection(),
    insertTranscription: appendVoiceTranscriptionToInput,
    afterInsert: () => nextTick(),
    sendAfterTranscription: () => handleSend(),
    notify: showInputPlaceholderNotice
  })

  const { voiceRecording, voiceTranscribing, voiceButtonTitle, toggleVoiceInput } = aiPanelVoiceRuntime

  const handleDragEnter = aiPanelSurfaceRuntime.handleDragEnter
  const handleDragOver = aiPanelSurfaceRuntime.handleDragOver
  const handleDragLeave = aiPanelSurfaceRuntime.handleDragLeave
  const handleDrop = aiPanelSurfaceRuntime.handleDrop

  const closePopups = (options: { restoreCommandFocus?: boolean; restoreContextFocus?: boolean } = {}) => {
    aiPanelPopupInteractionRuntime.closePopups(options)
  }

  const toggleContextPopup = () => aiPanelPopupInteractionRuntime.toggleContextPopup()

  const toggleModeMenu = () => {
    aiPanelModelRuntime.toggleModeMenu()
  }

  const toggleModelMenu = () => void aiPanelModelRuntime.toggleModelMenu()

  const selectChatMode = (mode: AiChatMode) => aiPanelModelRuntime.selectChatMode(mode)

  const selectModel = (modelId: string) => aiPanelModelRuntime.selectModel(modelId)

  const openModelSettings = () => aiPanelModelRuntime.openModelSettings()

  const openModelLogin = () => void aiPanelModelRuntime.openModelLogin()

  const handleModelKeydown = (event: KeyboardEvent) => void aiPanelModelRuntime.handleModelKeydown(event)

  const resetDocsContextNavigation = () => aiPanelPopupInteractionRuntime.resetDocsContextNavigation()
  const enterDocsDir = (context: AiContextOption) => aiPanelPopupInteractionRuntime.enterDocsDir(context)
  const goBackContextPopup = () => aiPanelPopupInteractionRuntime.goBackContextPopup()
  const returnContextPopupToMain = () => aiPanelPopupInteractionRuntime.returnContextPopupToMain()
  const closeContextPopup = (options: { restoreFocus?: boolean } = {}) => aiPanelPopupInteractionRuntime.closeContextPopup(options)

  const moveEditCaretToEnd = () => {
    editSavedRange.value = moveAiPanelEditableCaretToEnd(editEditableRef.value) || editSavedRange.value
  }

  const restoreEditableSelection = () => {
    if (restoreAiPanelEditableSelection(editableRef.value, savedRange.value)) return true
    if (!editableRef.value || !window.getSelection()) return false
    moveEditableCaretToEnd()
    return true
  }

  const restoreEditInputSelection = () => {
    if (restoreAiPanelEditableSelection(editEditableRef.value, editSavedRange.value)) return true
    if (!editEditableRef.value || !window.getSelection()) return false
    moveEditCaretToEnd()
    return true
  }

  function focusInputForTarget(target: 'main' | 'edit') {
    requestAnimationFrame(() => {
      if (target === 'edit') {
        restoreEditInputSelection()
        return
      }
      restoreEditableSelection()
    })
  }

  const aiPanelPopupInteractionRuntime = createAiPanelPopupInteractionRuntime({
    state: popupInteractionState,
    saveSelection: (target) => {
      if (target === 'edit') {
        saveEditSelection()
        return
      }
      saveEditableSelection()
    },
    focusInputForTarget,
    focusContextSearchInput: () => contextSearchInputRef.value?.focus(),
    focusCommandSearchInput: () => commandSearchInputRef.value?.focus(),
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    refreshAiCommandCatalog: () => workspace.refreshAiCommandCatalog(),
    afterDomUpdate: () => nextTick(),
    defer: (callback) => window.setTimeout(callback, 0),
    closeModeMenu: () => aiPanelModelRuntime.closeModeMenu(),
    closeModelMenu: () => aiPanelModelRuntime.closeModelMenu(),
    closeCodexTargetPicker,
    closeMoreActionsMenu: () => {
      moreActionsMenuOpen.value = false
    },
    closePanelModeMenu: () => {
      panelModeMenuOpen.value = false
    },
    closeHistoryMenu,
    openChatSearch,
    closeChatSearch
  })

  const closeCommandPopup = (options: { restoreFocus?: boolean } = {}) => aiPanelPopupInteractionRuntime.closeCommandPopup(options)
  const openContextCategory = (category: AiContextKind) => aiPanelPopupInteractionRuntime.openContextCategory(category)

  const aiPanelContextCommandRuntime = createAiPanelContextCommandRuntime({
    maxHostContexts,
    contextTarget: () => contextTarget.value,
    commandTarget: () => commandTarget.value,
    editingMessageId: () => editingMessageId.value,
    draft: () => draft.value,
    mainContexts: () => workspace.selectedContexts,
    editHostContexts: () => editHostContexts.value,
    visibleHostContexts: () => visibleHostContextOptions.value,
    editCommandTarget: () => editEditableRef.value || (document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null),
    setMainContexts: (contexts) => {
      workspace.selectedContexts = contexts
    },
    setEditHostContexts: (contexts) => {
      editHostContexts.value = contexts
    },
    enterDocsDir,
    closeContextPopup,
    closeCommandPopup,
    removeMainTriggerToken: (token) => removeTokenFromEditableCursor(editableRef.value, savedRange, token, handleEditableInput),
    removeEditTriggerToken: (token) => removeTokenFromEditableCursor(editEditableRef.value, editSavedRange, token, handleEditEditableInput),
    insertContextAtEditCursor,
    insertCommandAtEditCursor: (target, part) => insertChipIntoEditableCursor(target, part, handleEditEditableInput),
    restoreEditSelection,
    selectCommandPreset: (id, commandRef) => workspace.selectCommandPreset(id, commandRef),
    setDraft,
    renderEditableFromState,
    moveMainCaretToEnd: moveEditableCaretToEnd,
    requestFrame: (callback) => window.requestAnimationFrame(callback)
  })

  const selectAllVisibleHostContexts = aiPanelContextCommandRuntime.selectAllVisibleHostContexts
  const clearHostContexts = aiPanelContextCommandRuntime.clearHostContexts
  const isEditHostContextSelected = aiPanelContextCommandRuntime.isEditHostContextSelected
  const isContextSelectedForPopup = aiPanelContextCommandRuntime.isContextSelectedForPopup
  const applyHostContextToEdit = aiPanelContextCommandRuntime.applyHostContextToEdit
  const applyContext = aiPanelContextCommandRuntime.applyContext
  const applyCommand = aiPanelContextCommandRuntime.applyCommand

  const popupEditableKeydownInput = () => ({
    displayedOpenedHosts: displayedOpenedHosts.value,
    visibleContextCategories: visibleContextCategories.value,
    filteredContextOptions: filteredContextOptions.value,
    filteredCommands: filteredCommands.value,
    applyContext,
    applyCommand,
    handleSend,
    confirmMessageEdit,
    cancelMessageEdit,
    shouldTriggerCommandPopupForPendingSlash: (target: 'main' | 'edit') =>
      target === 'edit'
        ? shouldTriggerAiPanelCommandPopupForPendingSlash(editEditableRef.value, editSavedRange.value)
        : shouldTriggerAiPanelCommandPopupForPendingSlash(editableRef.value, savedRange.value),
    shouldTriggerCommandPopupForSlash: (target: 'main' | 'edit') =>
      target === 'edit'
        ? shouldTriggerAiPanelCommandPopupForSlash(editEditableRef.value, editSavedRange.value)
        : shouldTriggerAiPanelCommandPopupForSlash(editableRef.value, savedRange.value),
    getCharBeforeCaret: (target: 'main' | 'edit') =>
      target === 'edit' ? aiPanelCharBeforeCaret(editEditableRef.value, editSavedRange.value) : aiPanelCharBeforeCaret(editableRef.value, savedRange.value),
    shouldTriggerCommandPopupFromEditableText
  })

  const handleEditableKeydown = (event: KeyboardEvent) => {
    aiPanelPopupInteractionRuntime.handleMainEditableKeydown(event, popupEditableKeydownInput())
  }

  const handleContextKeydown = (event: KeyboardEvent) => aiPanelPopupInteractionRuntime.handleContextKeydown(event, popupEditableKeydownInput())

  const handlePanelKeydown = (event: KeyboardEvent) => {
    aiPanelPopupInteractionRuntime.handlePanelKeydown(event, {
      aiPanelMode: aiPanelMode.value,
      chatSearchOpen: chatSearchOpen.value
    })
  }

  const handleCommandKeydown = (event: KeyboardEvent) => aiPanelPopupInteractionRuntime.handleCommandKeydown(event, popupEditableKeydownInput())

  const openContextPopup = (level: 'main' | AiContextKind = 'main') => {
    openContextPopupForTarget('main', level)
  }

  watch(contextQuery, () => {
    aiPanelPopupInteractionRuntime.handleContextQueryChanged()
  })

  watch(chatSearchTerm, () => {
    aiPanelChatSearchRuntime.handleSearchTermChanged()
  })

  watch([historySearchTerm, historyFavoritesOnly], () => {
    aiPanelHistoryRuntime.resetHistoryFilters()
  })

  createAiPanelLifecycleRuntime({
    watch: watch as never,
    onMounted,
    onBeforeUnmount,
    afterDomUpdate: (callback) => nextTick(callback),
    selectedConversationId: () => workspace.selectedConversationId,
    conversationIdsSignature: () => workspace.conversations.map((conversation) => conversation.id).join('|'),
    pruneConversationTabs,
    ensureConversationTab,
    chatMessagesSignature: () => aiPanelChatMessagesSignature(workspace.chatMessages),
    syncSearchForMessages: () => aiPanelChatSearchRuntime.syncSearchForMessages(),
    activeCodexTargetSignature: () => activeCodexTargetSignature.value,
    syncActiveCodexTargetContext,
    terminalSettingsSignature,
    applyCodexTerminalSettingsToAll,
    aiAttentionFocusSequence: () => workspace.aiAttentionFocusRequest.sequence,
    aiAttentionFocusItem: () => workspace.aiAttentionFocusRequest.item,
    focusAiAttentionItem,
    onboardingRequestSequence: () => workspace.onboardingAiRequest.sequence,
    onboardingRequest: () => workspace.onboardingAiRequest as AiPanelOnboardingRequest,
    openModeOnboarding: () => aiPanelModelRuntime.openModeOnboarding(),
    openModelOnboarding: () => aiPanelModelRuntime.openModelOnboarding(),
    openContextPopup,
    prepareSendOnboarding: () => aiPanelModelRuntime.prepareSendOnboarding(),
    closePopups,
    draftText: () => draft.value,
    setDraft,
    editableStateSignature: () =>
      aiPanelEditableStateSignature({
        selectedContexts: workspace.selectedContexts,
        selectedCommandId: workspace.selectedCommandId,
        selectedCommandRef: workspace.selectedCommandRef,
        fileInputParts: fileInputParts.value
      }),
    syncingFromEditable: () => syncingFromEditable.value,
    renderEditableFromState,
    startInitialMode,
    cancelChatScrollFrame: () => {
      if (chatScrollFrame !== undefined) window.cancelAnimationFrame(chatScrollFrame)
    },
    disposeCodexRuntime: () => aiPanelCodexRuntime.dispose(),
    disposeChatSearchRuntime: () => aiPanelChatSearchRuntime.dispose(),
    clearHistoryNoticeTimer: () => aiPanelHistoryRuntime.clearNoticeTimer(),
    disposeSurfaceRuntime: () => aiPanelSurfaceRuntime.dispose(),
    disposeVoiceRuntime: () => aiPanelVoiceRuntime.dispose()
  }).start()

  return {
    activeCodexBoundTarget,
    activeCodexConversation,
    activeCodexConversationId,
    activeCommandAuditMessage,
    agentMode,
    aiChatModeOptions,
    aiPanelComposerRuntime,
    aiPanelMode,
    allVisibleHostContextsSelected,
    applyCommand,
    applyContext,
    approveMcpResourceAccess,
    approveMcpToolCall,
    bindCodexTarget,
    bindHostContextToCodex,
    BookOpen,
    Bot,
    Brain,
    cancelHistoryTitleEdit,
    cancelMessageEdit,
    canEditActiveCommandAudit,
    chatExportNotice,
    chatMode,
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    Check,
    CheckCircle,
    CheckSquare,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleHelp,
    clearChatSearch,
    clearHistorySearch,
    clearHostContexts,
    closeChatSearch,
    closeCodexConversation,
    closeCodexTargetPicker,
    closeCommandAuditDialog,
    closeConversationTab,
    closeHistoryMenu,
    closePopups,
    Code2,
    codexBoundTargetDetail,
    codexBoundTargetLabel,
    codexConversations,
    codexConversationTitle,
    codexStatusLabel,
    codexTargetPickerOpen,
    codexTargetQuery,
    commandAuditDialog,
    commandAuditTextareaRef,
    commandHostForMessage,
    commandHostTooltipForMessage,
    commandKeyboardIndex,
    commandLineCountForMessage,
    commandLineCountForText,
    commandOutputLineCount,
    commandPopupOpen,
    commandQuery,
    commandSearchInputRef,
    commandTarget,
    commandTextForMessage,
    composerIsEmpty,
    confirmMessageEdit,
    contextKeyboardIndex,
    contextLevel,
    contextPopupOpen,
    contextQuery,
    contextSearchInputRef,
    contextUsage,
    contextUsageColor,
    contextUsageTooltip,
    contextUsageTrackColor,
    conversationTabTooltip,
    Copy,
    copyCodexSelectionFromContextMenu,
    copyCommandAuditDraft,
    copyCommandToClipboard,
    copyMessageToClipboard,
    copyRenderedTextToClipboard,
    createNewAiConversation,
    createNewCodexConversation,
    currentAiPanelModeLabel,
    currentChatMode,
    currentPanelTarget,
    deleteHistoryConversation,
    displayConversationTitle,
    displayedOpenedHosts,
    displayModelName,
    Download,
    dropActive,
    editableRef,
    editDraft,
    editFileInputParts,
    editHistoryTitle,
    editHostContexts,
    editImageInputParts,
    editingHistoryId,
    editingHistoryTitle,
    editingMessageId,
    Ellipsis,
    exportCurrentChat,
    FileText,
    filteredCodexHostTargets,
    filteredCommands,
    filteredContextOptions,
    filteredLockedModelOptions,
    filteredModelOptions,
    findNextChatMatch,
    findPreviousChatMatch,
    Focus,
    focusCodexTerminal,
    FolderGit2,
    formatHistoryTime,
    formatLineCount,
    formatMcpToolArguments,
    getChipLabel,
    groupedVisibleHistory,
    handleCommandKeydown,
    handleContextKeydown,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleEditableKeydown,
    handleEditEditableClick,
    handleEditEditableInput,
    handleEditEditableKeydown,
    handleEditEditablePaste,
    handleFileUpload,
    handleModelKeydown,
    handlePanelKeydown,
    handleSend,
    hasMoreHistoryConversations,
    History,
    historyFavoriteLabel,
    historyFavoritesOnly,
    historyLoadingMore,
    historyMenuOpen,
    historySearchInputRef,
    historySearchTerm,
    hostContextsForPopup,
    iconMarkupByChipType,
    Image,
    inputPlaceholderNotice,
    isCommandSuggestionMessage,
    isCommandTerminalActionDisabled,
    isContextSelectedForPopup,
    isReadOnlyCommandMessage,
    isThinkingModelName,
    Link2,
    LoaderCircle,
    loadMoreHistoryConversations,
    locateCodexBoundTarget,
    lockedModelTooltip,
    LockKeyhole,
    Maximize2,
    Mic,
    MinusSquare,
    modelDropdownWidthPx,
    modelMenuOpen,
    modelQuery,
    modelSearchInputRef,
    modeDropdownWidthPx,
    modeMenuOpen,
    Monitor,
    moreActionsMenuOpen,
    normalizedCommandOutputText,
    openChatSearch,
    openCommandAuditDialog,
    openContextCategory,
    openEditContextPopup,
    openImagePicker,
    openModelLogin,
    openModelSettings,
    panelModeMenuOpen,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    rejectMcpResourceAccess,
    rejectMcpToolCall,
    rejectMessageCommand,
    removeEditHostContext,
    renderedMarkdownParts,
    restartCodexSession,
    restoreConversationFromTab,
    restoreHistoryConversation,
    retryAssistantMessage,
    returnContextPopupToMain,
    runCommandAuditDraft,
    runMessageCommand,
    saveCommandAuditDraft,
    saveEditableSelection,
    saveHistoryTitle,
    Search,
    selectAiPanelMode,
    selectAllVisibleHostContexts,
    selectChatMode,
    selectCodexConversation,
    selectedCommandRef,
    selectedModelLabel,
    selectModel,
    Send,
    Server,
    setCodexTerminalHostRef,
    setEditEditableRef,
    setMessageFeedback,
    showNoAvailableModelPrompt,
    Sparkles,
    Square,
    Star,
    streaming,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill,
    t,
    ThumbsDown,
    ThumbsUp,
    toggleAiPanelModeMenu,
    toggleCodexTargetPicker,
    toggleContextPopup,
    toggleHistoryFavorite,
    toggleHistoryMenu,
    toggleMessageFavorite,
    toggleModelMenu,
    toggleModeMenu,
    toggleMoreActionsMenu,
    toggleVoiceInput,
    Trash2,
    unbindCodexTarget,
    Upload,
    visibleContextCategories,
    visibleConversationTabs,
    voiceButtonTitle,
    voiceRecording,
    voiceTranscribing,
    workspace,
    X,
    Zap,
  }
}
