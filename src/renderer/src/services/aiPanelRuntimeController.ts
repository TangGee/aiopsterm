import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
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
  aiPanelChipLabel,
  type AiPanelEditableRenderOptions
} from '@/services/aiPanelEditableRuntime'
import { createAiPanelContextCommandShellRuntime } from '@/services/aiPanelContextCommandShellRuntime'
import { createAiPanelModelPopupShellRuntime } from '@/services/aiPanelModelPopupShellRuntime'
import {
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
  renderAiPanelMarkdownParts as renderedMarkdownParts
} from '@/services/aiPanelMessageRuntime'
import { createAiPanelActionOrchestrationRuntime } from '@/services/aiPanelActionOrchestrationRuntime'
import { createAiPanelChatNavigationRuntime } from '@/services/aiPanelChatNavigationRuntime'
import { clipboardHasImageItems } from '@/services/aiPanelMediaRuntime'
import {
  aiPanelContextUsageColor,
  aiPanelContextUsageDisplay,
  aiPanelContextUsageTooltip,
  aiPanelContextUsageTrackColor,
  createAiPanelSurfaceRuntime
} from '@/services/aiPanelSurfaceRuntime'
import { createAiPanelAttachmentRuntime } from '@/services/aiPanelAttachmentRuntime'
import { createAiPanelMessageEditRuntime } from '@/services/aiPanelMessageEditRuntime'
import { createAiPanelComposerDomRuntime } from '@/services/aiPanelComposerDomRuntime'
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
import { useI18n } from '@/i18n'
import type {
  AiChipContentPart,
  AiDocChipContentPart,
  AiImageContentPart,
  TerminalPanel
} from '@/stores/workspace'
import type { AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContainerRuntimeProps = { agentMode?: boolean }

export const useAiPanelContainerRuntime = (props: AiPanelContainerRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const { locale, t } = useI18n()
  const agentMode = computed(() => Boolean(props.agentMode))
  type AiChatMode = 'agent' | 'cmd'

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
  const dropActive = ref(false)
  const inputPlaceholderNotice = ref('')
  let classicChatDataLoaded = false
  let getEditHostContextsForPopup = (): AiContextOption[] => []
  const maxHostContexts = 5
  const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))

  const measureUiTextWidthPx = (text: string) => {
    if (!text) return 0
    if (typeof document === 'undefined') return text.length * 7
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return text.length * 7
    context.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
    return context.measureText(text).width
  }

  const aiPanelModelPopupShellRuntime = createAiPanelModelPopupShellRuntime<Component>({
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
    afterDomUpdate: () => nextTick(),
    measureText: measureUiTextWidthPx,
    lockedModelTooltip: (tier) => `模型已锁定，升级 ${tier} 后可用`,
    categories: () => workspace.aiContextCatalog.categories,
    commandOptions: () => workspace.aiCommandOptions,
    openedHosts: () => workspace.aiContextCatalog.openedHosts,
    selectedContexts: () => workspace.selectedContexts,
    editHostContexts: () => getEditHostContextsForPopup(),
    skillOptions: () => workspace.aiSkillContextOptions,
    selectedCommandId: () => workspace.selectedCommandId,
    selectedCommandRef: () => workspace.selectedCommandRef,
    iconForKind: (kind) => aiContextCategoryIcons[kind] || Search
  })
  const {
    aiContextCategories,
    allVisibleHostContextsSelected,
    chatMode,
    closeModeMenu,
    closeModelMenu,
    commandKeyboardIndex,
    commandOptions,
    commandPopupOpen,
    commandQuery,
    commandTarget,
    contextKeyboardIndex,
    contextLevel,
    contextPopupOpen,
    contextQuery,
    contextTarget,
    currentChatMode,
    displayedOpenedHosts,
    displayModelName,
    docsContextOptions,
    docsCurrentRelDir,
    docsDirStack,
    filteredCommands,
    filteredContextOptions,
    filteredLockedModelOptions,
    filteredModelOptions,
    handleModelKeydown,
    hostContextsForPopup,
    isThinkingModelName,
    lockedModelTooltip,
    modeDropdownWidthPx,
    modeMenuOpen,
    modelDropdownWidthPx,
    modelMenuOpen,
    modelQuery,
    modelSearchInputRef,
    openModeOnboarding,
    openModelLogin,
    openModelOnboarding,
    openModelSettings,
    popupInteractionState,
    prepareSendOnboarding,
    selectChatMode,
    selectedCommand,
    selectedCommandRef,
    selectedContextCategory,
    selectedModelLabel,
    selectModel,
    showNoAvailableModelPrompt,
    toggleModelMenu,
    toggleModeMenu,
    visibleContextCategories,
    visibleHostContextOptions
  } = aiPanelModelPopupShellRuntime

  const aiPanelChatNavigationRuntime = createAiPanelChatNavigationRuntime({
    conversations: () => workspace.conversations,
    sortedConversations: () => workspace.sortedConversations,
    selectedConversationId: () => workspace.selectedConversationId,
    messages: () => workspace.chatMessages,
    locale: () => locale.value,
    t,
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
      closeModeMenu()
      closeModelMenu()
    },
    closePopups: () => closePopups(),
    afterDomUpdate: (callback) => (callback ? nextTick(callback) : nextTick()),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frame) => window.cancelAnimationFrame(frame),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (timer) => window.clearTimeout(timer as number)
  })
  const {
    cancelChatScrollFrame,
    cancelHistoryTitleEdit,
    chatExportNotice,
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    clearChatSearch,
    clearHistoryNoticeTimer,
    clearHistorySearch,
    closeChatSearch,
    closeConversationTab,
    closeHistoryMenu,
    conversationTabTooltip,
    createNewAiConversation,
    deleteHistoryConversation,
    displayConversationTitle,
    disposeChatSearchRuntime,
    editHistoryTitle,
    editingHistoryId,
    editingHistoryTitle,
    ensureConversationTab,
    exportCurrentChat,
    filteredHistoryConversations,
    findNextChatMatch,
    findPreviousChatMatch,
    formatHistoryTime,
    groupedVisibleHistory,
    handleChatSearchTermChanged,
    hasMoreHistoryConversations,
    historyFavoriteLabel,
    historyFavoritesOnly,
    historyLoadingMore,
    historyMenuOpen,
    historySearchInputRef,
    historySearchTerm,
    loadMoreHistoryConversations,
    moreActionsMenuOpen,
    openChatSearch,
    openHistoryMenu,
    pruneConversationTabs,
    resetHistoryFilters,
    restoreConversationById,
    restoreConversationFromTab,
    restoreHistoryConversation,
    saveHistoryTitle,
    showNotice: showChatExportNotice,
    syncSearchForMessages,
    toggleHistoryFavorite,
    toggleHistoryMenu,
    toggleMoreActionsMenu,
    visibleConversationTabs
  } = aiPanelChatNavigationRuntime

  const loadClassicChatData = async () => {
    if (classicChatDataLoaded) return
    classicChatDataLoaded = true
    await Promise.all([workspace.refreshAiModelCatalog({ replaceSettingsOptions: false }), workspace.hydrateClassicChatData()])
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

  const aiPanelActionOrchestrationRuntime = createAiPanelActionOrchestrationRuntime({
    messages: () => workspace.chatMessages,
    activePanel: () => workspace.activePanel,
    panels: () => workspace.panels,
    chatMode: () => chatMode.value,
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
    summarizeMessageToSkill: (id) => workspace.summarizeMessageToSkill(id),
    runActiveTerminalCommand: (command, source) => workspace.runActiveTerminalCommand(command, source),
    continueAgentCommandLoop: (input) => workspace.continueAgentCommandLoop(input),
    enableAgentReadOnlyAutoRunForCurrentConversation: () => workspace.enableAgentReadOnlyAutoRunForCurrentConversation(),
    syncCurrentConversationSnapshot: (options) => workspace.syncCurrentConversationSnapshot(options),
    closePopups: () => closePopups(),
    afterDomUpdate: () => nextTick()
  })
  const {
    activeCommandAuditMessage,
    approveMcpResourceAccess,
    approveMcpToolCall,
    canEditActiveCommandAudit,
    closeCommandAuditDialog,
    commandAuditDialog,
    commandAuditTextareaRef,
    copyCommandAuditDraft,
    copyCommandToClipboard,
    copyMessageToClipboard,
    copyRenderedTextToClipboard,
    formatMcpToolArguments,
    openCommandAuditDialog,
    rejectMcpResourceAccess,
    rejectMcpToolCall,
    rejectMessageCommand,
    retryAssistantMessage,
    runCommandAuditDraft,
    runMessageCommand,
    saveCommandAuditDraft,
    setMessageFeedback,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill,
    toggleMessageFavorite
  } = aiPanelActionOrchestrationRuntime

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

  const editableRenderOptions = computed<AiPanelEditableRenderOptions>(() => ({
    iconMarkupByContextKind,
    commandIconMarkup
  }))

  const getChipLabel = aiPanelChipLabel

  const clipboardHasImage = (event: ClipboardEvent) => clipboardHasImageItems(event.clipboardData?.items)

  let openCommandPopupForTargetHandler: (target: 'main' | 'edit') => void | Promise<void> = () => undefined
  let openContextPopupForTargetHandler: (target: 'main' | 'edit', level?: 'main' | AiContextKind) => void = () => undefined
  const openCommandPopupForTarget = (target: 'main' | 'edit') => openCommandPopupForTargetHandler(target)
  const openContextPopupForTarget = (target: 'main' | 'edit', level: 'main' | AiContextKind = 'main') =>
    openContextPopupForTargetHandler(target, level)

  const contextById = (id: string) => workspace.selectedContexts.find((item) => item.id === id) || null

  let insertPastedImageHandler: (() => void | Promise<void>) | undefined
  const aiPanelComposerDomRuntime = createAiPanelComposerDomRuntime({
    renderOptions: () => editableRenderOptions.value,
    selectedCommandId: () => workspace.selectedCommandId,
    selectedCommandRef: () => selectedCommandRef.value,
    contextById,
    streaming: () => streaming.value,
    noModelPrompt: () => showNoAvailableModelPrompt.value,
    chatMode: () => chatMode.value,
    agentMode: () => props.agentMode,
    clipboardHasImage,
    cancelStreaming: () => workspace.cancelStreamingAiChatResponse(),
    sendChat: (text, contentParts, mode) => workspace.sendChat(text, contentParts, undefined, { mode }),
    clearSelectedCommand: () => workspace.selectCommandPreset(null),
    removeContext: (id) => workspace.removeContext(id),
    insertPastedImage: () => insertPastedImageHandler?.(),
    closePopups: () => closePopups(),
    notify: (message) => showInputPlaceholderNotice(message),
    afterDomUpdate: () => nextTick(),
    afterInputSync: () => nextTick(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    shouldMoveCaretAfterRender: () => !contextPopupOpen.value && !commandPopupOpen.value && !modelMenuOpen.value
  })

  const {
    aiPanelComposerRuntime,
    appendVoiceTranscriptionToInput,
    charBeforeCaret: mainCharBeforeCaret,
    draft,
    editableRef,
    fileInputParts,
    handleEditableInput,
    handleSend,
    imageInputParts,
    insertFileChipAtCursor: insertFileChipAtMainCursor,
    insertImageAtCursor: insertImageAtEditableCursor,
    moveEditableCaretToEnd,
    removeTriggerToken: removeMainTriggerToken,
    renderEditableFromState,
    restoreEditableSelection,
    saveEditableSelection,
    setDraft,
    shouldTriggerCommandPopupForPendingSlash: shouldTriggerMainCommandPopupForPendingSlash,
    shouldTriggerCommandPopupForSlash: shouldTriggerMainCommandPopupForSlash,
    shouldTriggerCommandPopupFromEditableText,
    syncingFromEditable
  } = aiPanelComposerDomRuntime
  const composerIsEmpty = computed(() =>
    aiPanelComposerDomRuntime.isEmpty({
      selectedContextCount: workspace.selectedContexts.length,
      selectedCommand: selectedCommand.value
    })
  )

  let insertPastedImageIntoEditHandler: (() => void | Promise<void>) | undefined
  const aiPanelMessageEditRuntime = createAiPanelMessageEditRuntime({
    renderOptions: () => editableRenderOptions.value,
    contextById,
    clipboardHasImage,
    closePopups: () => closePopups(),
    openContextPopupForTarget: (target) => openContextPopupForTarget(target),
    afterDomUpdate: () => nextTick(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    fallbackEditTarget: () => document.querySelector('.user-message-edit-container .message-editable') as HTMLElement | null,
    insertPastedImageIntoEdit: () => insertPastedImageIntoEditHandler?.(),
    resendUserMessageFromParts: (messageId, contentParts, hostContexts) =>
      workspace.resendUserMessageFromParts(messageId, contentParts, hostContexts)
  })

  const {
    editEditableRef,
    editingMessageId,
    editDraft,
    editImageInputParts,
    editFileInputParts,
    editHostContexts,
    cancelMessageEdit,
    confirmMessageEdit,
    editCommandTarget,
    handleEditEditableClick,
    handleEditEditableInput,
    handleEditEditablePaste,
    insertCommandAtEditCursor,
    insertContextAtEditCursor,
    insertFileChipAtEditCursor,
    insertImageAtEditCursor,
    openEditContextPopup,
    removeEditHostContext,
    removeEditTriggerToken,
    restoreEditInputSelection,
    restoreEditSelection,
    saveEditSelection,
    setEditEditableRef,
    setEditHostContexts,
    shouldTriggerCommandPopupForPendingSlash: shouldTriggerEditCommandPopupForPendingSlash,
    shouldTriggerCommandPopupForSlash: shouldTriggerEditCommandPopupForSlash,
    startMessageEdit,
    charBeforeCaret: editCharBeforeCaret
  } = aiPanelMessageEditRuntime
  getEditHostContextsForPopup = () => editHostContexts.value

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
  insertPastedImageHandler = insertPastedImage
  insertPastedImageIntoEditHandler = insertPastedImageIntoEdit

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

  function focusInputForTarget(target: 'main' | 'edit') {
    requestAnimationFrame(() => {
      if (target === 'edit') {
        restoreEditInputSelection()
        return
      }
      restoreEditableSelection()
    })
  }

  const aiPanelContextCommandShellRuntime = createAiPanelContextCommandShellRuntime<Component>({
    state: popupInteractionState,
    maxHostContexts,
    saveSelection: (target) => {
      if (target === 'edit') {
        saveEditSelection()
        return
      }
      saveEditableSelection()
    },
    focusInputForTarget,
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    refreshAiCommandCatalog: () => workspace.refreshAiCommandCatalog(),
    afterDomUpdate: () => nextTick(),
    defer: (callback) => window.setTimeout(callback, 0),
    closeModeMenu,
    closeModelMenu,
    closeCodexTargetPicker,
    closeMoreActionsMenu: () => {
      moreActionsMenuOpen.value = false
    },
    closePanelModeMenu: () => {
      panelModeMenuOpen.value = false
    },
    closeHistoryMenu,
    openChatSearch,
    closeChatSearch,
    editingMessageId: () => editingMessageId.value,
    draft: () => draft.value,
    mainContexts: () => workspace.selectedContexts,
    editHostContexts: () => editHostContexts.value,
    visibleHostContexts: () => visibleHostContextOptions.value,
    editCommandTarget,
    setMainContexts: (contexts) => {
      workspace.selectedContexts = contexts
    },
    setEditHostContexts: (contexts) => {
      editHostContexts.value = contexts
    },
    removeMainTriggerToken,
    removeEditTriggerToken,
    insertContextAtEditCursor,
    insertCommandAtEditCursor,
    restoreEditSelection,
    selectCommandPreset: (id, commandRef) => workspace.selectCommandPreset(id, commandRef),
    setDraft,
    renderEditableFromState,
    moveMainCaretToEnd: moveEditableCaretToEnd,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    displayedOpenedHosts: () => displayedOpenedHosts.value,
    visibleContextCategories: () => visibleContextCategories.value,
    filteredContextOptions: () => filteredContextOptions.value,
    filteredCommands: () => filteredCommands.value,
    handleSend,
    confirmMessageEdit,
    cancelMessageEdit,
    shouldTriggerMainCommandPopupForPendingSlash,
    shouldTriggerEditCommandPopupForPendingSlash,
    shouldTriggerMainCommandPopupForSlash,
    shouldTriggerEditCommandPopupForSlash,
    mainCharBeforeCaret,
    editCharBeforeCaret,
    shouldTriggerCommandPopupFromEditableText,
    aiPanelMode: () => aiPanelMode.value,
    chatSearchOpen: () => chatSearchOpen.value
  })

  const {
    applyCommand,
    applyContext,
    applyHostContextToEdit,
    clearHostContexts,
    closeCommandPopup,
    closeContextPopup,
    closePopups,
    commandSearchInputRef,
    contextSearchInputRef,
    enterDocsDir,
    goBackContextPopup,
    handleCommandKeydown,
    handleContextKeydown,
    handleContextQueryChanged,
    handleEditableKeydown,
    handleEditEditableKeydown,
    handlePanelKeydown,
    isContextSelectedForPopup,
    isEditHostContextSelected,
    openCommandPopupForTarget: shellOpenCommandPopupForTarget,
    openContextCategory,
    openContextPopup,
    openContextPopupForTarget: shellOpenContextPopupForTarget,
    resetDocsContextNavigation,
    returnContextPopupToMain,
    selectAllVisibleHostContexts,
    toggleContextPopup
  } = aiPanelContextCommandShellRuntime
  openCommandPopupForTargetHandler = shellOpenCommandPopupForTarget
  openContextPopupForTargetHandler = shellOpenContextPopupForTarget

  watch(contextQuery, () => {
    handleContextQueryChanged()
  })

  watch(chatSearchTerm, () => {
    handleChatSearchTermChanged()
  })

  watch([historySearchTerm, historyFavoritesOnly], () => {
    resetHistoryFilters()
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
    syncSearchForMessages,
    activeCodexTargetSignature: () => activeCodexTargetSignature.value,
    syncActiveCodexTargetContext,
    terminalSettingsSignature,
    applyCodexTerminalSettingsToAll,
    aiAttentionFocusSequence: () => workspace.aiAttentionFocusRequest.sequence,
    aiAttentionFocusItem: () => workspace.aiAttentionFocusRequest.item,
    focusAiAttentionItem,
    onboardingRequestSequence: () => workspace.onboardingAiRequest.sequence,
    onboardingRequest: () => workspace.onboardingAiRequest as AiPanelOnboardingRequest,
    openModeOnboarding,
    openModelOnboarding,
    openContextPopup,
    prepareSendOnboarding,
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
    cancelChatScrollFrame,
    disposeCodexRuntime: () => aiPanelCodexRuntime.dispose(),
    disposeChatSearchRuntime,
    clearHistoryNoticeTimer,
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
