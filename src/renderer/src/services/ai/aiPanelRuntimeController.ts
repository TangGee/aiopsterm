import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import 'highlight.js/styles/atom-one-dark.css'
import '@xterm/xterm/css/xterm.css'
import { useWorkspaceStore } from '@/stores/workspace'
import { createAiPanelClassicInputShellRuntime } from '@/services/ai/aiPanelClassicInputShellRuntime'
import { createAiPanelModelPopupShellRuntime } from '@/services/ai/aiPanelModelPopupShellRuntime'
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
} from '@/services/ai/aiPanelMessageRuntime'
import { createAiPanelActionOrchestrationRuntime } from '@/services/ai/aiPanelActionOrchestrationRuntime'
import { createAiPanelChatNavigationRuntime } from '@/services/ai/aiPanelChatNavigationRuntime'
import { createAiPanelPresentationRuntime } from '@/services/ai/aiPanelPresentationRuntime'
import { createAiPanelShellAdapterRuntime } from '@/services/ai/aiPanelShellAdapterRuntime'
import { aiChatClient } from '@/services/ai/aiChatClient'
import {
  classicClineActivityForMessages,
  isActiveClassicClineTaskMessage
} from '@/services/ai/classicClineTaskRuntime'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { codexTargetContextFromPanel } from '@/services/ai/aiPanelCodexRuntime'
import { createAiPanelCodexConversationRuntime } from '@/services/ai/aiPanelCodexConversationRuntime'
import {
  aiPanelChatMessagesSignature,
  aiPanelEditableStateSignature,
  createAiPanelLifecycleRuntime,
  type AiPanelOnboardingRequest
} from '@/services/ai/aiPanelLifecycleRuntime'
import { useI18n } from '@/i18n'
import { MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE } from '@shared/chatImageAttachment'
import type { AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContainerRuntimeProps = { agentMode?: boolean }

export const useAiPanelContainerRuntime = (props: AiPanelContainerRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const { locale, t } = useI18n()
  const agentMode = computed(() => Boolean(props.agentMode))
  let getEditHostContextsForPopup = (): AiContextOption[] => []
  const streaming = computed(() => workspace.chatMessages.some((message) =>
    message.state === 'streaming' || isActiveClassicClineTaskMessage(message)
  ))
  const classicClineActivity = computed(() => classicClineActivityForMessages(workspace.chatMessages))

  const shellAdapter = createAiPanelShellAdapterRuntime({
    refreshClassicCatalog: () => workspace.refreshAiModelCatalog({ replaceSettingsOptions: false }),
    hydrateClassicChatData: () => workspace.hydrateClassicChatData({
      restoreIfEmpty: false,
      restoreSelection: false
    })
  })

  const aiPanelPresentationRuntime = createAiPanelPresentationRuntime({
    icons: shellAdapter.presentationIcons,
    selectedContexts: () => workspace.selectedContexts,
    translate: t
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
    chatModeOptions: () => aiChatModeOptions.value,
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
    createConversation: (initialContexts) => workspace.createConversation(initialContexts),
    cancelActiveTurn: () => workspace.cancelStreamingAiChatResponse(),
    deselectConversation: (expectedConversationId) => workspace.deselectConversation(expectedConversationId),
    restoreConversation: (id) => workspace.restoreConversation(id),
    renameConversation: (id, title) => workspace.renameConversation(id, title),
    deleteConversation: (id) => workspace.deleteConversation(id),
    toggleConversationFavorite: (id) => workspace.toggleConversationFavorite(id),
    loadConversations: () => workspace.loadChatConversationsFromBackend({
      restoreIfEmpty: false,
      restoreSelection: false
    }),
    loadOlderMessages: () => workspace.loadOlderConversationMessages(),
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
    activateChatViewport,
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
    handleChatScroll,
    handleChatUserScrollIntent,
    handleChatSearchTermChanged,
    hasMoreHistoryConversations,
    historyFavoriteLabel,
    historyFavoritesOnly,
    historyLoadingMore,
    historyMenuOpen,
    historySearchInputRef,
    historySearchTerm,
    hydrateOpenConversationTabs,
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
    visibleChatMessages,
    visibleConversationTabs
  } = aiPanelChatNavigationRuntime

  const aiPanelCodexRuntime = createAiPanelCodexConversationRuntime({
    agentMode: () => Boolean(props.agentMode),
    activePanel: () => workspace.activePanel,
    activePanelId: () => workspace.activePanelId,
    panels: () => workspace.panels,
    terminalSettings: () => workspace.terminalSettings,
    themeId: () => workspace.config.theme,
    terminalSurfaceMode: () => (workspace.config.background.mode === 'none' ? 'base' : 'withBackground'),
    aiContextCatalog: () => workspace.aiContextCatalog,
    loadClassicChatData: async () => {
      await shellAdapter.loadClassicChatData()
      await hydrateOpenConversationTabs()
    },
    closePopups: () => closePopups(),
    showNotice: showChatExportNotice,
    setTopNotice: (message) => workspace.setTopNotice(message),
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    openTerminalForAiHostContext: (host, restoreOptions) => workspace.openTerminalForAiHostContext(host, restoreOptions),
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
    aiPanelWorkspaceLinkMode,
    aiPanelMode,
    applyCodexTerminalSettingsToAll,
    bindCodexTarget,
    bindHostContextToCodex,
    bindTerminalPanelToCodex,
    closeCodexConversation,
    closeCodexHistoryMenu,
    closeCodexTargetPicker,
    codexBoundTargetDetail,
    codexBoundTargetLabel,
    codexConversations,
    codexConversationTitle,
    codexHistoryMenuOpen,
    codexSessionHistory,
    codexStatusLabel,
    codexTargetPickerOpen,
    codexTargetQuery,
    codexWorkspaceLinkNotice,
    copyCodexSelectionFromContextMenu,
    pasteCodexClipboardFromContextMenu,
    createNewCodexConversation,
    currentAiPanelModeLabel,
    currentPanelTarget,
    filteredCodexHostTargets,
    focusAiAttentionItem,
    handleCodexTerminalClosed,
    focusCodexTerminal,
    locateCodexBoundTarget,
    panelModeMenuOpen,
    restartCodexSession,
    restoreCodexProductSession,
    selectAiPanelMode,
    selectCodexConversation,
    setCodexTerminalHostRef,
    startInitialMode,
    syncActiveCodexTargetContext,
    terminalSettingsSignature,
    toggleAiPanelModeMenu,
    toggleAiPanelWorkspaceLinkMode,
    toggleCodexTargetPicker,
    toggleCodexHistoryMenu,
    unbindCodexTarget
  } = aiPanelCodexRuntime

  let knownLiveTerminalPanels = new Map(
    workspace.panels
      .filter((panel) => panel.sessionId && panel.status !== 'closed' && panel.status !== 'error')
      .map((panel) => [panel.id, { panelId: panel.id, terminalSessionId: panel.sessionId || '' }])
  )
  let terminalClosureQueue = Promise.resolve()
  const stopProductSessionTerminalLifecycle = watch(
    () => workspace.panels
      .map((panel) => `${panel.id}:${panel.sessionId || ''}:${panel.status || ''}:${panel.kind || ''}`)
      .join('|'),
    () => {
      const nextLive = new Map(
        workspace.panels
          .filter((panel) => panel.sessionId && panel.status !== 'closed' && panel.status !== 'error')
          .map((panel) => [panel.id, { panelId: panel.id, terminalSessionId: panel.sessionId || '' }])
      )
      const closed = [...knownLiveTerminalPanels.values()].filter((panel) => !nextLive.has(panel.panelId))
      knownLiveTerminalPanels = nextLive
      if (!closed.length) return
      terminalClosureQueue = terminalClosureQueue.then(async () => {
        for (const panel of closed) {
          await handleCodexTerminalClosed(panel.panelId, panel.terminalSessionId)
          const classicIds = await workspace.handleClassicTerminalClosed(panel.panelId, panel.terminalSessionId)
          for (const id of classicIds) await closeConversationTab(id)
        }
      })
    },
    { flush: 'sync' }
  )

  const aiPanelActionOrchestrationRuntime = createAiPanelActionOrchestrationRuntime({
    messages: () => workspace.chatMessages,
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
    runTerminalCommand: (panelId, command, source) => workspace.runTerminalCommand(panelId, command, { source, writeToShell: true }),
    continueAgentCommandLoop: (input) => workspace.continueAgentCommandLoop(input),
    enableAgentReadOnlyAutoRunForCurrentConversation: () => workspace.enableAgentReadOnlyAutoRunForCurrentConversation(),
    syncCurrentConversationSnapshot: (options) => workspace.syncCurrentConversationSnapshot(options),
    respondClineAgentApproval: async (input) => {
      const respond = aiChatClient.respondClineAgentApproval()
      if (!respond) return { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_UNAVAILABLE', errorMessage: 'Cline Agent 审批服务不可用。' }
      return respond(input)
    },
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

  const aiPanelClassicInputShellRuntime = createAiPanelClassicInputShellRuntime({
    renderOptions: () => editableRenderOptions.value,
    selectedCommandId: () => workspace.selectedCommandId,
    selectedCommandRef: () => selectedCommandRef.value,
    selectedCommand: () => selectedCommand.value,
    contextById,
    selectedContexts: () => workspace.selectedContexts,
    setSelectedContexts: (contexts) => {
      workspace.selectedContexts = contexts
    },
    removeContext: (id) => workspace.removeContext(id),
    clearSelectedCommand: () => workspace.selectCommandPreset(null),
    selectCommandPreset: (id, commandRef) => workspace.selectCommandPreset(id, commandRef),
    streaming: () => streaming.value,
    noModelPrompt: () => showNoAvailableModelPrompt.value,
    chatMode: () => chatMode.value,
    agentMode: () => props.agentMode,
    clipboardHasImage,
    cancelStreaming: () => workspace.cancelStreamingAiChatResponse(),
    sendChat: (text, contentParts, mode) => workspace.sendChat(text, contentParts, undefined, { mode }),
    resendUserMessageFromParts: (messageId, contentParts, hostContexts) =>
      workspace.resendUserMessageFromParts(messageId, contentParts, hostContexts),
    aiPanelMode: () => aiPanelMode.value,
    contextUsageSnapshot: () => workspace.aiContextUsage,
    selectedConversationId: () => workspace.selectedConversationId,
    panels: () => workspace.panels,
    createConversation: () => workspace.createConversation(workspace.selectedContexts),
    addKnowledgeFilesToChat: (relPaths) => workspace.addKnowledgeFilesToChat(relPaths),
    imageLimitMessage: () => t('ai.imageAttachmentCountLimit', { count: MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE }),
    bindTerminalPanelToCodex,
    bindHostContextToCodex,
    popupState: popupInteractionState,
    maxHostContexts: shellAdapter.maxHostContexts,
    modelMenuOpen: () => modelMenuOpen.value,
    closeModeMenu,
    closeModelMenu,
    closeCodexTargetPicker,
    closeCodexHistoryMenu,
    closeMoreActionsMenu: () => {
      moreActionsMenuOpen.value = false
    },
    closePanelModeMenu: () => {
      panelModeMenuOpen.value = false
    },
    closeHistoryMenu,
    openChatSearch,
    closeChatSearch,
    chatSearchOpen: () => chatSearchOpen.value,
    refreshAiContextCatalog: () => workspace.refreshAiContextCatalog({ hydrateSelection: false }),
    refreshAiCommandCatalog: () => workspace.refreshAiCommandCatalog(),
    visibleHostContexts: () => visibleHostContextOptions.value,
    displayedOpenedHosts: () => displayedOpenedHosts.value,
    visibleContextCategories: () => visibleContextCategories.value,
    filteredContextOptions: () => filteredContextOptions.value,
    filteredCommands: () => filteredCommands.value,
    afterDomUpdate: shellAdapter.afterDomUpdate,
    defer: shellAdapter.defer,
    requestFrame: shellAdapter.requestFrame,
    setNoticeTimer: shellAdapter.setTimer,
    clearNoticeTimer: shellAdapter.clearTimer,
    fallbackEditTarget: shellAdapter.queryEditTarget,
    focusInputForTarget: (target, restorers) => shellAdapter.focusInputForTarget(target, restorers)
  })

  const {
    aiPanelComposerRuntime,
    applyCommand,
    applyContext,
    applyHostContextToEdit,
    cancelMessageEdit,
    clearHostContexts,
    closeCommandPopup,
    closeContextPopup,
    closePopups,
    commandSearchInputRef,
    composerIsEmpty,
    confirmMessageEdit,
    contextSearchInputRef,
    contextUsage,
    contextUsageColor,
    contextUsageTooltip,
    contextUsageTrackColor,
    draft,
    dropActive,
    editableRef,
    editDraft,
    editFileInputParts,
    editHostContexts,
    editImageInputParts,
    editingMessageId,
    enterDocsDir,
    fileInputParts,
    goBackContextPopup,
    handleCommandKeydown,
    handleContextKeydown,
    handleContextQueryChanged,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleEditableInput,
    handleEditableKeydown,
    handleEditEditableClick,
    handleEditEditableInput,
    handleEditEditableKeydown,
    handleEditEditablePaste,
    handleFileUpload,
    handlePanelKeydown,
    handleSend,
    imageInputParts,
    inputPlaceholderNotice,
    isContextSelectedForPopup,
    isEditHostContextSelected,
    openImagePicker,
    openContextCategory,
    openContextPopup,
    openEditContextPopup,
    removeEditHostContext,
    renderEditableFromState,
    resetDocsContextNavigation,
    returnContextPopupToMain,
    saveEditableSelection,
    selectAllVisibleHostContexts,
    setDraft,
    setEditEditableRef,
    setEditHostContexts,
    startMessageEdit,
    syncingFromEditable,
    toggleContextPopup,
    toggleVoiceInput,
    voiceButtonTitle,
    voiceRecording,
    voiceTranscribing
  } = aiPanelClassicInputShellRuntime
  getEditHostContextsForPopup = () => editHostContexts.value

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
    chatMessagesSignature: () => `${workspace.selectedConversationId}|${aiPanelChatMessagesSignature(workspace.chatMessages)}`,
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
    disposeCodexRuntime: () => {
      stopProductSessionTerminalLifecycle()
      aiPanelCodexRuntime.dispose()
    },
    disposeChatSearchRuntime,
    clearHistoryNoticeTimer,
    disposeSurfaceRuntime: () => aiPanelClassicInputShellRuntime.disposeSurfaceRuntime(),
    disposeVoiceRuntime: () => aiPanelClassicInputShellRuntime.disposeVoiceRuntime()
  }).start()

  return {
    activeCodexBoundTarget,
    activeCodexConversation,
    activeCodexConversationId,
    activeCommandAuditMessage,
    activateChatViewport,
    agentMode,
    aiChatModeOptions,
    aiPanelComposerRuntime,
    aiPanelWorkspaceLinkMode,
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
    codexHistoryMenuOpen,
    codexSessionHistory,
    codexStatusLabel,
    codexTargetPickerOpen,
    codexTargetQuery,
    codexWorkspaceLinkNotice,
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
    pasteCodexClipboardFromContextMenu,
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
    handleChatScroll,
    handleChatUserScrollIntent,
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
    restoreCodexProductSession,
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
    selectedContextCategory,
    selectedModelLabel,
    selectModel,
    setCodexTerminalHostRef,
    setEditEditableRef,
    setMessageFeedback,
    showNoAvailableModelPrompt,
    streaming,
    classicClineActivity,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill,
    t,
    toggleAiPanelModeMenu,
    toggleAiPanelWorkspaceLinkMode,
    toggleCodexTargetPicker,
    toggleCodexHistoryMenu,
    toggleContextPopup,
    toggleHistoryFavorite,
    toggleHistoryMenu,
    toggleMessageFavorite,
    toggleModelMenu,
    toggleModeMenu,
    toggleMoreActionsMenu,
    toggleVoiceInput,
    unbindCodexTarget,
    visibleChatMessages,
    visibleContextCategories,
    visibleConversationTabs,
    voiceButtonTitle,
    voiceRecording,
    voiceTranscribing,
    workspace
  }
}
