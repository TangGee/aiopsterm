import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import 'highlight.js/styles/atom-one-dark.css'
import '@xterm/xterm/css/xterm.css'
import { useWorkspaceStore } from '@/stores/workspace'
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
import { createAiPanelInputMediaShellRuntime } from '@/services/aiPanelInputMediaShellRuntime'
import { createAiPanelMessageEditRuntime } from '@/services/aiPanelMessageEditRuntime'
import { createAiPanelComposerDomRuntime } from '@/services/aiPanelComposerDomRuntime'
import { createAiPanelPresentationRuntime } from '@/services/aiPanelPresentationRuntime'
import { createAiPanelShellAdapterRuntime } from '@/services/aiPanelShellAdapterRuntime'
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
import type { AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContainerRuntimeProps = { agentMode?: boolean }

export const useAiPanelContainerRuntime = (props: AiPanelContainerRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const { locale, t } = useI18n()
  const agentMode = computed(() => Boolean(props.agentMode))
  let getEditHostContextsForPopup = (): AiContextOption[] => []
  const streaming = computed(() => workspace.chatMessages.some((message) => message.state === 'streaming'))

  const shellAdapter = createAiPanelShellAdapterRuntime({
    refreshClassicCatalog: () => workspace.refreshAiModelCatalog({ replaceSettingsOptions: false }),
    hydrateClassicChatData: () => workspace.hydrateClassicChatData()
  })

  const aiPanelPresentationRuntime = createAiPanelPresentationRuntime({
    icons: shellAdapter.presentationIcons,
    selectedContexts: () => workspace.selectedContexts
  })
  const {
    aiChatModeOptions,
    clipboardHasImage,
    contextById,
    editableRenderOptions,
    getChipLabel,
    iconForKind,
    iconMarkupByChipType,
    measureText
  } = aiPanelPresentationRuntime

  const aiPanelModelPopupShellRuntime = createAiPanelModelPopupShellRuntime({
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
    afterDomUpdate: shellAdapter.afterDomUpdate,
    measureText,
    lockedModelTooltip: (tier) => `模型已锁定，升级 ${tier} 后可用`,
    categories: () => workspace.aiContextCatalog.categories,
    commandOptions: () => workspace.aiCommandOptions,
    openedHosts: () => workspace.aiContextCatalog.openedHosts,
    selectedContexts: () => workspace.selectedContexts,
    editHostContexts: () => getEditHostContextsForPopup(),
    skillOptions: () => workspace.aiSkillContextOptions,
    selectedCommandId: () => workspace.selectedCommandId,
    selectedCommandRef: () => workspace.selectedCommandRef,
    iconForKind
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
    afterDomUpdate: shellAdapter.afterDomUpdate,
    requestFrame: shellAdapter.requestFrame,
    cancelFrame: shellAdapter.cancelFrame,
    setTimer: shellAdapter.setTimer,
    clearTimer: shellAdapter.clearAnyTimer
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

  const aiPanelCodexRuntime = createAiPanelCodexConversationRuntime({
    agentMode: () => Boolean(props.agentMode),
    activePanel: () => workspace.activePanel,
    panels: () => workspace.panels,
    terminalSettings: () => workspace.terminalSettings,
    aiContextCatalog: () => workspace.aiContextCatalog,
    loadClassicChatData: shellAdapter.loadClassicChatData,
    closePopups: () => closePopups(),
    showNotice: showChatExportNotice,
    setTopNotice: (message) => workspace.setTopNotice(message),
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    openTerminalForAiHostContext: (host) => workspace.openTerminalForAiHostContext(host),
    activateTerminalPanel: (panelId) => workspace.activateTerminalPanel(panelId),
    upsertAiAttentionItem: (input) => workspace.upsertAiAttentionItem(input),
    removeAiAttentionItem: (id) => workspace.removeAiAttentionItem(id),
    markAiAttentionHandled: (id) => workspace.markAiAttentionHandled(id),
    afterDomUpdate: shellAdapter.afterDomUpdate,
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
    afterDomUpdate: shellAdapter.afterDomUpdate
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

  let openCommandPopupForTargetHandler: (target: 'main' | 'edit') => void | Promise<void> = () => undefined
  let openContextPopupForTargetHandler: (target: 'main' | 'edit', level?: 'main' | AiContextKind) => void = () => undefined
  const openCommandPopupForTarget = (target: 'main' | 'edit') => openCommandPopupForTargetHandler(target)
  const openContextPopupForTarget = (target: 'main' | 'edit', level: 'main' | AiContextKind = 'main') =>
    openContextPopupForTargetHandler(target, level)

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
    afterDomUpdate: shellAdapter.afterDomUpdate,
    afterInputSync: shellAdapter.afterDomUpdate,
    requestFrame: shellAdapter.requestFrame,
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
    afterDomUpdate: shellAdapter.afterDomUpdate,
    requestFrame: shellAdapter.requestFrame,
    fallbackEditTarget: shellAdapter.queryEditTarget,
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

  const aiPanelInputMediaShellRuntime = createAiPanelInputMediaShellRuntime({
    mode: () => aiPanelMode.value,
    contextUsageSnapshot: () => workspace.aiContextUsage,
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
    streaming: () => streaming.value,
    editingMessageId: () => editingMessageId.value,
    insertImageAtMainCursor: insertImageAtEditableCursor,
    insertImageAtEditCursor,
    insertFileChipAtMainCursor,
    insertFileChipAtEditCursor,
    restoreMainSelection: () => restoreEditableSelection(),
    insertVoiceTranscription: appendVoiceTranscriptionToInput,
    afterVoiceInsert: shellAdapter.afterDomUpdate,
    sendAfterVoiceTranscription: () => handleSend(),
    requestFrame: shellAdapter.requestFrame,
    setNoticeTimer: shellAdapter.setTimer,
    clearNoticeTimer: shellAdapter.clearTimer
  })

  const {
    contextUsage,
    contextUsageColor,
    contextUsageTooltip,
    contextUsageTrackColor,
    dropActive,
    inputPlaceholderNotice,
    showInputPlaceholderNotice,
    insertImageFilePaths,
    insertPastedImage,
    insertPastedImageIntoEdit,
    openImagePicker,
    handleFileUpload,
    voiceRecording,
    voiceTranscribing,
    voiceButtonTitle,
    toggleVoiceInput,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop
  } = aiPanelInputMediaShellRuntime
  insertPastedImageHandler = insertPastedImage
  insertPastedImageIntoEditHandler = insertPastedImageIntoEdit

  const focusInputForTarget = (target: 'main' | 'edit') =>
    shellAdapter.focusInputForTarget(target, {
      restoreEditInputSelection,
      restoreEditableSelection
    })

  const aiPanelContextCommandShellRuntime = createAiPanelContextCommandShellRuntime({
    state: popupInteractionState,
    maxHostContexts: shellAdapter.maxHostContexts,
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
    afterDomUpdate: shellAdapter.afterDomUpdate,
    defer: shellAdapter.defer,
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
    requestFrame: shellAdapter.requestFrame,
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
    afterDomUpdate: shellAdapter.afterDomUpdate,
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
    disposeSurfaceRuntime: () => aiPanelInputMediaShellRuntime.disposeSurfaceRuntime(),
    disposeVoiceRuntime: () => aiPanelInputMediaShellRuntime.disposeVoiceRuntime()
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
    exportCurrentChat,
    filteredCodexHostTargets,
    filteredCommands,
    filteredContextOptions,
    filteredLockedModelOptions,
    filteredModelOptions,
    findNextChatMatch,
    findPreviousChatMatch,
    focusCodexTerminal,
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
    historyFavoriteLabel,
    historyFavoritesOnly,
    historyLoadingMore,
    historyMenuOpen,
    historySearchInputRef,
    historySearchTerm,
    hostContextsForPopup,
    iconMarkupByChipType,
    inputPlaceholderNotice,
    isCommandSuggestionMessage,
    isCommandTerminalActionDisabled,
    isContextSelectedForPopup,
    isReadOnlyCommandMessage,
    isThinkingModelName,
    loadMoreHistoryConversations,
    locateCodexBoundTarget,
    lockedModelTooltip,
    modelDropdownWidthPx,
    modelMenuOpen,
    modelQuery,
    modelSearchInputRef,
    modeDropdownWidthPx,
    modeMenuOpen,
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
    selectAiPanelMode,
    selectAllVisibleHostContexts,
    selectChatMode,
    selectCodexConversation,
    selectedCommandRef,
    selectedModelLabel,
    selectModel,
    setCodexTerminalHostRef,
    setEditEditableRef,
    setMessageFeedback,
    showNoAvailableModelPrompt,
    streaming,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill,
    t,
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
    unbindCodexTarget,
    visibleContextCategories,
    visibleConversationTabs,
    voiceButtonTitle,
    voiceRecording,
    voiceTranscribing,
    workspace
  }
}
