import { computed } from 'vue'
import { createAiPanelComposerDomRuntime, type AiPanelComposerDomCommandRef } from '@/services/aiPanelComposerDomRuntime'
import { createAiPanelContextCommandShellRuntime } from '@/services/aiPanelContextCommandShellRuntime'
import { createAiPanelInputMediaShellRuntime, type AiPanelInputMediaShellRuntimeOptions } from '@/services/aiPanelInputMediaShellRuntime'
import { createAiPanelMessageEditRuntime } from '@/services/aiPanelMessageEditRuntime'
import type { AiPanelEditableRenderOptions } from '@/services/aiPanelEditableRuntime'
import type { AiPanelComposerChatMode, AiPanelComposerResponseMode } from '@/services/aiPanelComposerRuntime'
import type { AiPanelMode } from '@/services/aiPanelModeRuntime'
import type { AiPanelPopupInteractionState } from '@/services/aiPanelPopupInteractionRuntime'
import type { AiPanelContextCategoryView, AiPanelPopupTarget } from '@/services/aiPanelPopupRuntime'
import type { AiChipContentPart } from '@/stores/workspace'
import type {
  AiChatContextUsageSnapshot,
  AiCommandCatalogOption,
  AiContentPart,
  AiContextKind,
  AiContextOption
} from '@shared/contracts/aiChat'

type AiPanelClassicInputTarget = 'main' | 'edit'

type AiPanelClassicInputFocusRestorers = {
  restoreEditInputSelection: () => boolean
  restoreEditableSelection: () => boolean
}

type AiPanelClassicInputCommandPreset = {
  command: string
  label: string
  path: string
}

export type AiPanelClassicInputShellRuntimeOptions<Panel extends { id: string; sessionId?: string | null }, TIcon = unknown> = {
  renderOptions: () => AiPanelEditableRenderOptions
  selectedCommandId: () => string | null | undefined
  selectedCommandRef: () => AiPanelComposerDomCommandRef
  selectedCommand: () => unknown
  contextById: (id: string) => AiContextOption | null | undefined
  selectedContexts: () => AiContextOption[]
  setSelectedContexts: (contexts: AiContextOption[]) => void
  removeContext: (id: string) => void
  clearSelectedCommand: () => void
  selectCommandPreset: (id: string, commandRef: AiPanelClassicInputCommandPreset) => void
  streaming: () => boolean
  noModelPrompt: () => boolean
  chatMode: () => AiPanelComposerChatMode
  agentMode: () => boolean | undefined
  clipboardHasImage: (event: ClipboardEvent) => boolean
  cancelStreaming: () => Promise<unknown>
  sendChat: (text: string, contentParts: AiContentPart[], mode: AiPanelComposerResponseMode) => Promise<boolean>
  resendUserMessageFromParts: (messageId: string, contentParts: AiContentPart[], hostContexts: AiContextOption[]) => Promise<boolean>
  aiPanelMode: () => AiPanelMode
  contextUsageSnapshot: () => Pick<AiChatContextUsageSnapshot, 'used' | 'contextWindow' | 'percent'> | null | undefined
  selectedConversationId: () => string
  panels: () => Panel[]
  createConversation: () => Promise<{ id: string } | null | undefined>
  addKnowledgeFilesToChat: (relPaths: string[]) => Promise<unknown>
  bindTerminalPanelToCodex: (panel: Panel, source: string) => Promise<unknown>
  bindHostContextToCodex: (context: AiContextOption) => Promise<unknown>
  popupState: AiPanelPopupInteractionState
  maxHostContexts: number
  modelMenuOpen: () => boolean
  closeModeMenu: () => void
  closeModelMenu: () => void
  closeCodexTargetPicker: () => void
  closeMoreActionsMenu: () => void
  closePanelModeMenu: () => void
  closeHistoryMenu: () => void
  openChatSearch: () => void | Promise<unknown>
  closeChatSearch: () => void
  chatSearchOpen: () => boolean
  refreshAiContextCatalog: () => Promise<unknown>
  refreshAiCommandCatalog: () => Promise<unknown>
  visibleHostContexts: () => AiContextOption[]
  displayedOpenedHosts: () => AiContextOption[]
  visibleContextCategories: () => Array<AiPanelContextCategoryView<TIcon>>
  filteredContextOptions: () => AiContextOption[]
  filteredCommands: () => AiCommandCatalogOption[]
  afterDomUpdate: () => void | Promise<void>
  defer: (callback: () => void) => void
  requestFrame: (callback: () => void) => number
  setNoticeTimer: (callback: () => void, delay: number) => number
  clearNoticeTimer: (timer: number) => void
  fallbackEditTarget: () => HTMLElement | null
  focusInputForTarget: (target: AiPanelClassicInputTarget, restorers: AiPanelClassicInputFocusRestorers) => void
  attachmentServices?: AiPanelInputMediaShellRuntimeOptions<Panel>['attachmentServices']
  voiceServices?: AiPanelInputMediaShellRuntimeOptions<Panel>['voiceServices']
}

export const createAiPanelClassicInputShellRuntime = <Panel extends { id: string; sessionId?: string | null }, TIcon = unknown>(
  options: AiPanelClassicInputShellRuntimeOptions<Panel, TIcon>
) => {
  let closePopupsHandler: () => void = () => undefined
  const closePopups = () => closePopupsHandler()

  let showInputPlaceholderNoticeHandler: (message: string) => void = () => undefined
  const showInputPlaceholderNotice = (message: string) => showInputPlaceholderNoticeHandler(message)

  let insertPastedImageHandler: (() => void | Promise<void>) | undefined
  let insertPastedImageIntoEditHandler: (() => void | Promise<void>) | undefined
  const insertPastedImage = () => insertPastedImageHandler?.()
  const insertPastedImageIntoEdit = () => insertPastedImageIntoEditHandler?.()

  let openCommandPopupForTargetHandler: (target: AiPanelClassicInputTarget) => void | Promise<void> = () => undefined
  let openContextPopupForTargetHandler: (target: AiPanelClassicInputTarget, level?: 'main' | AiContextKind) => void = () => undefined
  const openCommandPopupForTarget = (target: AiPanelClassicInputTarget) => openCommandPopupForTargetHandler(target)
  const openContextPopupForTarget = (target: AiPanelClassicInputTarget, level: 'main' | AiContextKind = 'main') =>
    openContextPopupForTargetHandler(target, level)

  const composerDomRuntime = createAiPanelComposerDomRuntime({
    renderOptions: options.renderOptions,
    selectedCommandId: options.selectedCommandId,
    selectedCommandRef: options.selectedCommandRef,
    contextById: options.contextById,
    streaming: options.streaming,
    noModelPrompt: options.noModelPrompt,
    chatMode: options.chatMode,
    agentMode: options.agentMode,
    clipboardHasImage: options.clipboardHasImage,
    cancelStreaming: options.cancelStreaming,
    sendChat: options.sendChat,
    clearSelectedCommand: options.clearSelectedCommand,
    removeContext: options.removeContext,
    insertPastedImage,
    closePopups,
    notify: showInputPlaceholderNotice,
    afterDomUpdate: options.afterDomUpdate,
    afterInputSync: options.afterDomUpdate,
    requestFrame: options.requestFrame,
    shouldMoveCaretAfterRender: () => !options.popupState.contextPopupOpen && !options.popupState.commandPopupOpen && !options.modelMenuOpen()
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
  } = composerDomRuntime

  const composerIsEmpty = computed(() =>
    composerDomRuntime.isEmpty({
      selectedContextCount: options.selectedContexts().length,
      selectedCommand: options.selectedCommand()
    })
  )

  const messageEditRuntime = createAiPanelMessageEditRuntime({
    renderOptions: options.renderOptions,
    contextById: options.contextById,
    clipboardHasImage: options.clipboardHasImage,
    closePopups,
    openContextPopupForTarget: (target) => openContextPopupForTarget(target),
    afterDomUpdate: options.afterDomUpdate,
    requestFrame: options.requestFrame,
    fallbackEditTarget: options.fallbackEditTarget,
    insertPastedImageIntoEdit,
    resendUserMessageFromParts: options.resendUserMessageFromParts
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
  } = messageEditRuntime

  const inputMediaShellRuntime = createAiPanelInputMediaShellRuntime({
    mode: options.aiPanelMode,
    contextUsageSnapshot: options.contextUsageSnapshot,
    selectedConversationId: options.selectedConversationId,
    panels: options.panels,
    createConversation: options.createConversation,
    addKnowledgeFilesToChat: options.addKnowledgeFilesToChat,
    bindTerminalPanelToCodex: options.bindTerminalPanelToCodex,
    bindHostContextToCodex: options.bindHostContextToCodex,
    draftText: () => draft.value,
    setDraft,
    closePopups,
    moveCaretToEnd: moveEditableCaretToEnd,
    streaming: options.streaming,
    editingMessageId: () => editingMessageId.value,
    insertImageAtMainCursor: insertImageAtEditableCursor,
    insertImageAtEditCursor,
    insertFileChipAtMainCursor,
    insertFileChipAtEditCursor,
    restoreMainSelection: () => restoreEditableSelection(),
    insertVoiceTranscription: appendVoiceTranscriptionToInput,
    afterVoiceInsert: options.afterDomUpdate,
    sendAfterVoiceTranscription: () => handleSend(),
    requestFrame: options.requestFrame,
    setNoticeTimer: options.setNoticeTimer,
    clearNoticeTimer: options.clearNoticeTimer,
    attachmentServices: options.attachmentServices,
    voiceServices: options.voiceServices
  })

  const {
    contextUsage,
    contextUsageColor,
    contextUsageTooltip,
    contextUsageTrackColor,
    dropActive,
    inputPlaceholderNotice,
    insertImageFilePaths,
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
  } = inputMediaShellRuntime
  showInputPlaceholderNoticeHandler = inputMediaShellRuntime.showInputPlaceholderNotice
  insertPastedImageHandler = inputMediaShellRuntime.insertPastedImage
  insertPastedImageIntoEditHandler = inputMediaShellRuntime.insertPastedImageIntoEdit

  const focusInputForTarget = (target: AiPanelPopupTarget) =>
    options.focusInputForTarget(target, {
      restoreEditInputSelection,
      restoreEditableSelection
    })

  const contextCommandShellRuntime = createAiPanelContextCommandShellRuntime<TIcon>({
    state: options.popupState,
    maxHostContexts: options.maxHostContexts,
    saveSelection: (target) => {
      if (target === 'edit') {
        saveEditSelection()
        return
      }
      saveEditableSelection()
    },
    focusInputForTarget,
    refreshAiContextCatalog: options.refreshAiContextCatalog,
    refreshAiCommandCatalog: options.refreshAiCommandCatalog,
    afterDomUpdate: options.afterDomUpdate,
    defer: options.defer,
    closeModeMenu: options.closeModeMenu,
    closeModelMenu: options.closeModelMenu,
    closeCodexTargetPicker: options.closeCodexTargetPicker,
    closeMoreActionsMenu: options.closeMoreActionsMenu,
    closePanelModeMenu: options.closePanelModeMenu,
    closeHistoryMenu: options.closeHistoryMenu,
    openChatSearch: options.openChatSearch,
    closeChatSearch: options.closeChatSearch,
    editingMessageId: () => editingMessageId.value,
    draft: () => draft.value,
    mainContexts: options.selectedContexts,
    editHostContexts: () => editHostContexts.value,
    visibleHostContexts: options.visibleHostContexts,
    editCommandTarget,
    setMainContexts: options.setSelectedContexts,
    setEditHostContexts: (contexts) => {
      editHostContexts.value = contexts
    },
    removeMainTriggerToken,
    removeEditTriggerToken,
    insertContextAtEditCursor,
    insertCommandAtEditCursor: (target: HTMLElement | null, part: AiChipContentPart) => insertCommandAtEditCursor(target, part),
    restoreEditSelection,
    selectCommandPreset: options.selectCommandPreset,
    setDraft,
    renderEditableFromState,
    moveMainCaretToEnd: moveEditableCaretToEnd,
    requestFrame: options.requestFrame,
    displayedOpenedHosts: options.displayedOpenedHosts,
    visibleContextCategories: options.visibleContextCategories,
    filteredContextOptions: options.filteredContextOptions,
    filteredCommands: options.filteredCommands,
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
    aiPanelMode: options.aiPanelMode,
    chatSearchOpen: options.chatSearchOpen
  })

  const {
    applyCommand,
    applyContext,
    applyHostContextToEdit,
    clearHostContexts,
    closeCommandPopup,
    closeContextPopup,
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
  } = contextCommandShellRuntime
  closePopupsHandler = contextCommandShellRuntime.closePopups
  openCommandPopupForTargetHandler = shellOpenCommandPopupForTarget
  openContextPopupForTargetHandler = shellOpenContextPopupForTarget

  return {
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
    disposeSurfaceRuntime: inputMediaShellRuntime.disposeSurfaceRuntime,
    disposeVoiceRuntime: inputMediaShellRuntime.disposeVoiceRuntime,
    draft,
    dropActive,
    editableRef,
    editDraft,
    editEditableRef,
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
    handleDragLeave,
    handleDragOver,
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
    insertImageFilePaths,
    isContextSelectedForPopup,
    isEditHostContextSelected,
    openContextCategory,
    openContextPopup,
    openEditContextPopup,
    openImagePicker,
    removeEditHostContext,
    renderEditableFromState,
    resetDocsContextNavigation,
    returnContextPopupToMain,
    saveEditableSelection,
    selectAllVisibleHostContexts,
    setDraft,
    setEditEditableRef,
    setEditHostContexts,
    showInputPlaceholderNotice,
    startMessageEdit,
    syncingFromEditable,
    toggleContextPopup,
    toggleVoiceInput,
    voiceButtonTitle,
    voiceRecording,
    voiceTranscribing
  }
}
