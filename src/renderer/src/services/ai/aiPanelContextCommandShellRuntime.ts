import { ref } from 'vue'
import { createAiPanelContextCommandRuntime } from '@/services/ai/aiPanelContextCommandRuntime'
import {
  createAiPanelPopupInteractionRuntime,
  type AiPanelPopupInteractionState
} from '@/services/ai/aiPanelPopupInteractionRuntime'
import { createAiPanelPopupKeyboardRuntime } from '@/services/ai/aiPanelPopupKeyboardRuntime'
import type { AiPanelMode } from '@/services/ai/aiPanelModeRuntime'
import type { AiPanelContextCategoryView, AiPanelPopupTarget } from '@/services/ai/aiPanelPopupRuntime'
import type { AiChipContentPart } from '@/stores/workspace'
import type { AiCommandCatalogOption, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelContextCommandShellRuntimeOptions<TIcon = unknown> = {
  state: AiPanelPopupInteractionState
  maxHostContexts: number
  saveSelection: (target: AiPanelPopupTarget) => void
  focusInputForTarget: (target: AiPanelPopupTarget) => void
  refreshAiContextCatalog: () => Promise<unknown>
  refreshAiCommandCatalog: () => Promise<unknown>
  afterDomUpdate: () => Promise<unknown> | unknown
  defer: (callback: () => void) => void
  closeModeMenu: () => void
  closeModelMenu: () => void
  closeCodexTargetPicker: () => void
  closeCodexHistoryMenu?: () => void
  closeMoreActionsMenu: () => void
  closePanelModeMenu: () => void
  closeHistoryMenu: () => void
  openChatSearch: () => void | Promise<unknown>
  closeChatSearch: () => void
  editingMessageId: () => string | null
  draft: () => string
  mainContexts: () => AiContextOption[]
  editHostContexts: () => AiContextOption[]
  visibleHostContexts: () => AiContextOption[]
  editCommandTarget: () => HTMLElement | null
  setMainContexts: (contexts: AiContextOption[]) => void
  setEditHostContexts: (contexts: AiContextOption[]) => void
  removeMainTriggerToken: (token: '@' | '/') => void
  removeEditTriggerToken: (token: '@' | '/') => void
  insertContextAtEditCursor: (context: AiContextOption) => void | boolean
  insertCommandAtEditCursor: (target: HTMLElement | null, part: AiChipContentPart) => void | boolean
  restoreEditSelection: () => void
  selectCommandPreset: (id: string, commandRef: { command: string; label: string; path: string }) => void
  setDraft: (value: string) => void
  renderEditableFromState: () => void
  moveMainCaretToEnd: () => void
  requestFrame: (callback: () => void) => number
  displayedOpenedHosts: () => AiContextOption[]
  visibleContextCategories: () => Array<AiPanelContextCategoryView<TIcon>>
  filteredContextOptions: () => AiContextOption[]
  filteredCommands: () => AiCommandCatalogOption[]
  handleSend: () => void | Promise<unknown>
  confirmMessageEdit: () => void | Promise<unknown>
  cancelMessageEdit: () => void
  shouldTriggerMainCommandPopupForPendingSlash: () => boolean
  shouldTriggerEditCommandPopupForPendingSlash: () => boolean
  shouldTriggerMainCommandPopupForSlash: () => boolean
  shouldTriggerEditCommandPopupForSlash: () => boolean
  mainCharBeforeCaret: () => string | null
  editCharBeforeCaret: () => string | null
  shouldTriggerCommandPopupFromEditableText: () => boolean
  aiPanelMode: () => AiPanelMode
  chatSearchOpen: () => boolean
}

export const createAiPanelContextCommandShellRuntime = <TIcon = unknown>(options: AiPanelContextCommandShellRuntimeOptions<TIcon>) => {
  const contextSearchInputRef = ref<HTMLInputElement | null>(null)
  const commandSearchInputRef = ref<HTMLInputElement | null>(null)

  const popupInteractionRuntime = createAiPanelPopupInteractionRuntime({
    state: options.state,
    saveSelection: options.saveSelection,
    focusInputForTarget: options.focusInputForTarget,
    focusContextSearchInput: () => contextSearchInputRef.value?.focus(),
    focusCommandSearchInput: () => commandSearchInputRef.value?.focus(),
    refreshAiContextCatalog: options.refreshAiContextCatalog,
    refreshAiCommandCatalog: options.refreshAiCommandCatalog,
    afterDomUpdate: options.afterDomUpdate,
    defer: options.defer,
    closeModeMenu: options.closeModeMenu,
    closeModelMenu: options.closeModelMenu,
    closeCodexTargetPicker: options.closeCodexTargetPicker,
    closeCodexHistoryMenu: options.closeCodexHistoryMenu,
    closeMoreActionsMenu: options.closeMoreActionsMenu,
    closePanelModeMenu: options.closePanelModeMenu,
    closeHistoryMenu: options.closeHistoryMenu,
    openChatSearch: options.openChatSearch,
    closeChatSearch: options.closeChatSearch
  })

  const closeContextPopup = (input: { restoreFocus?: boolean } = {}) => popupInteractionRuntime.closeContextPopup(input)
  const closeCommandPopup = (input: { restoreFocus?: boolean } = {}) => popupInteractionRuntime.closeCommandPopup(input)

  const contextCommandRuntime = createAiPanelContextCommandRuntime({
    maxHostContexts: options.maxHostContexts,
    contextTarget: () => options.state.contextTarget,
    contextLevel: () => options.state.contextLevel,
    commandTarget: () => options.state.commandTarget,
    editingMessageId: options.editingMessageId,
    draft: options.draft,
    mainContexts: options.mainContexts,
    editHostContexts: options.editHostContexts,
    visibleHostContexts: options.visibleHostContexts,
    editCommandTarget: options.editCommandTarget,
    setMainContexts: options.setMainContexts,
    setEditHostContexts: options.setEditHostContexts,
    enterDocsDir: popupInteractionRuntime.enterDocsDir,
    closeContextPopup,
    closeCommandPopup,
    removeMainTriggerToken: options.removeMainTriggerToken,
    removeEditTriggerToken: options.removeEditTriggerToken,
    insertContextAtEditCursor: options.insertContextAtEditCursor,
    insertCommandAtEditCursor: options.insertCommandAtEditCursor,
    restoreEditSelection: options.restoreEditSelection,
    selectCommandPreset: options.selectCommandPreset,
    setDraft: options.setDraft,
    renderEditableFromState: options.renderEditableFromState,
    moveMainCaretToEnd: options.moveMainCaretToEnd,
    requestFrame: options.requestFrame
  })

  const popupKeyboardRuntime = createAiPanelPopupKeyboardRuntime<TIcon>({
    popupInteractionRuntime,
    displayedOpenedHosts: options.displayedOpenedHosts,
    visibleContextCategories: options.visibleContextCategories,
    filteredContextOptions: options.filteredContextOptions,
    filteredCommands: options.filteredCommands,
    applyContext: contextCommandRuntime.applyContext,
    applyCommand: contextCommandRuntime.applyCommand,
    handleSend: options.handleSend,
    confirmMessageEdit: options.confirmMessageEdit,
    cancelMessageEdit: options.cancelMessageEdit,
    shouldTriggerMainCommandPopupForPendingSlash: options.shouldTriggerMainCommandPopupForPendingSlash,
    shouldTriggerEditCommandPopupForPendingSlash: options.shouldTriggerEditCommandPopupForPendingSlash,
    shouldTriggerMainCommandPopupForSlash: options.shouldTriggerMainCommandPopupForSlash,
    shouldTriggerEditCommandPopupForSlash: options.shouldTriggerEditCommandPopupForSlash,
    mainCharBeforeCaret: options.mainCharBeforeCaret,
    editCharBeforeCaret: options.editCharBeforeCaret,
    shouldTriggerCommandPopupFromEditableText: options.shouldTriggerCommandPopupFromEditableText,
    aiPanelMode: options.aiPanelMode,
    chatSearchOpen: options.chatSearchOpen
  })

  const openContextPopupForTarget = (target: AiPanelPopupTarget, level: 'main' | AiContextKind = 'main') =>
    popupInteractionRuntime.openContextPopupForTarget(target, level)

  const openContextPopup = (level: 'main' | AiContextKind = 'main') => {
    openContextPopupForTarget('main', level)
  }

  return {
    applyCommand: contextCommandRuntime.applyCommand,
    applyContext: contextCommandRuntime.applyContext,
    applyHostContextToEdit: contextCommandRuntime.applyHostContextToEdit,
    clearHostContexts: contextCommandRuntime.clearHostContexts,
    closeCommandPopup,
    closeContextPopup,
    closePopups: popupInteractionRuntime.closePopups,
    commandSearchInputRef,
    contextSearchInputRef,
    enterDocsDir: popupInteractionRuntime.enterDocsDir,
    goBackContextPopup: popupInteractionRuntime.goBackContextPopup,
    handleCommandKeydown: popupKeyboardRuntime.handleCommandKeydown,
    handleContextKeydown: popupKeyboardRuntime.handleContextKeydown,
    handleContextQueryChanged: popupKeyboardRuntime.handleContextQueryChanged,
    handleEditableKeydown: popupKeyboardRuntime.handleEditableKeydown,
    handleEditEditableKeydown: popupKeyboardRuntime.handleEditEditableKeydown,
    handlePanelKeydown: popupKeyboardRuntime.handlePanelKeydown,
    isContextSelectedForPopup: contextCommandRuntime.isContextSelectedForPopup,
    isEditHostContextSelected: contextCommandRuntime.isEditHostContextSelected,
    openCommandPopupForTarget: popupInteractionRuntime.openCommandPopupForTarget,
    openContextCategory: popupInteractionRuntime.openContextCategory,
    openContextPopup,
    openContextPopupForTarget,
    resetDocsContextNavigation: popupInteractionRuntime.resetDocsContextNavigation,
    returnContextPopupToMain: popupInteractionRuntime.returnContextPopupToMain,
    selectAllVisibleHostContexts: contextCommandRuntime.selectAllVisibleHostContexts,
    toggleContextPopup: popupInteractionRuntime.toggleContextPopup
  }
}
