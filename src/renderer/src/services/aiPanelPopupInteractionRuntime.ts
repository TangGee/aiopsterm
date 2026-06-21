import {
  backAiPanelDocsDir,
  enterAiPanelDocsDir,
  mainContextKeyboardSelection,
  nextAiPanelPopupKeyboardIndex,
  resetAiPanelDocsNavigation,
  type AiPanelContextCategoryView,
  type AiPanelPopupTarget
} from '@/services/aiPanelPopupRuntime'
import type { AiCommandCatalogOption, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'
import type { AiPanelMode } from '@/services/aiPanelModeRuntime'

export type AiPanelPopupInteractionState = {
  contextPopupOpen: boolean
  commandPopupOpen: boolean
  contextTarget: AiPanelPopupTarget
  commandTarget: AiPanelPopupTarget
  contextLevel: 'main' | AiContextKind
  contextQuery: string
  commandQuery: string
  contextKeyboardIndex: number
  commandKeyboardIndex: number
  docsCurrentRelDir: string
  docsDirStack: string[]
}

export type AiPanelPopupInteractionOptions = {
  state: AiPanelPopupInteractionState
  saveSelection: (target: AiPanelPopupTarget) => void
  focusInputForTarget: (target: AiPanelPopupTarget) => void
  focusContextSearchInput: () => void
  focusCommandSearchInput: () => void
  refreshAiContextCatalog: () => Promise<unknown>
  refreshAiCommandCatalog: () => Promise<unknown>
  afterDomUpdate: () => Promise<unknown> | unknown
  defer: (callback: () => void) => void
  closeModeMenu: () => void
  closeModelMenu: () => void
  closeCodexTargetPicker: () => void
  closeMoreActionsMenu: () => void
  closePanelModeMenu: () => void
  closeHistoryMenu: () => void
  openChatSearch: () => void | Promise<unknown>
  closeChatSearch: () => void
}

export type AiPanelPopupContextKeydownInput<TIcon = unknown> = {
  displayedOpenedHosts: AiContextOption[]
  visibleContextCategories: Array<AiPanelContextCategoryView<TIcon>>
  filteredContextOptions: AiContextOption[]
  applyContext: (context: AiContextOption) => void
}

export type AiPanelPopupCommandKeydownInput = {
  filteredCommands: AiCommandCatalogOption[]
  applyCommand: (preset: AiCommandCatalogOption) => void
}

export type AiPanelPopupEditableKeydownInput<TIcon = unknown> = AiPanelPopupContextKeydownInput<TIcon> &
  AiPanelPopupCommandKeydownInput & {
    handleSend: () => void | Promise<unknown>
    confirmMessageEdit: () => void | Promise<unknown>
    cancelMessageEdit: () => void
    shouldTriggerCommandPopupForPendingSlash: (target: AiPanelPopupTarget) => boolean
    shouldTriggerCommandPopupForSlash: (target: AiPanelPopupTarget) => boolean
    getCharBeforeCaret: (target: AiPanelPopupTarget) => string | null
    shouldTriggerCommandPopupFromEditableText: () => boolean
  }

export const createEmptyAiPanelPopupInteractionState = (): AiPanelPopupInteractionState => ({
  contextPopupOpen: false,
  commandPopupOpen: false,
  contextTarget: 'main',
  commandTarget: 'main',
  contextLevel: 'main',
  contextQuery: '',
  commandQuery: '',
  contextKeyboardIndex: -1,
  commandKeyboardIndex: -1,
  docsCurrentRelDir: '',
  docsDirStack: []
})

const preventPopupKeyEvent = (event: KeyboardEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

export const createAiPanelPopupInteractionRuntime = (options: AiPanelPopupInteractionOptions) => {
  const { state } = options

  const resetDocsContextNavigation = () => {
    const next = resetAiPanelDocsNavigation()
    state.docsCurrentRelDir = next.currentRelDir
    state.docsDirStack = next.dirStack
    state.contextQuery = next.query
    state.contextKeyboardIndex = next.keyboardIndex
  }

  const closeAuxiliaryMenus = () => {
    options.closeModeMenu()
    options.closeModelMenu()
  }

  const focusContextSearchInput = () => {
    void Promise.resolve(options.afterDomUpdate()).then(() => {
      if (state.contextPopupOpen) options.focusContextSearchInput()
    })
  }

  const enterDocsDir = (context: AiContextOption) => {
    const next = enterAiPanelDocsDir({ currentRelDir: state.docsCurrentRelDir, dirStack: state.docsDirStack }, context)
    if (!next) return false
    state.docsCurrentRelDir = next.currentRelDir
    state.docsDirStack = next.dirStack
    state.contextQuery = next.query
    state.contextKeyboardIndex = next.keyboardIndex
    focusContextSearchInput()
    return true
  }

  const goBackDocsDir = () => {
    const next = backAiPanelDocsDir({ dirStack: state.docsDirStack })
    if (!next) return false
    state.docsCurrentRelDir = next.currentRelDir
    state.docsDirStack = next.dirStack
    state.contextQuery = next.query
    state.contextKeyboardIndex = next.keyboardIndex
    focusContextSearchInput()
    return true
  }

  const returnContextPopupToMain = () => {
    state.contextLevel = 'main'
    state.contextQuery = ''
    state.contextKeyboardIndex = -1
    resetDocsContextNavigation()
    focusContextSearchInput()
  }

  const goBackContextPopup = () => {
    if (state.contextLevel === 'docs' && goBackDocsDir()) return true
    returnContextPopupToMain()
    return true
  }

  const closeContextPopup = (input: { restoreFocus?: boolean } = {}) => {
    const previousTarget = state.contextTarget
    const wasOpen = state.contextPopupOpen
    state.contextPopupOpen = false
    state.contextTarget = 'main'
    returnContextPopupToMain()
    if (wasOpen && input.restoreFocus) options.focusInputForTarget(previousTarget)
    return wasOpen
  }

  const closeCommandPopup = (input: { restoreFocus?: boolean } = {}) => {
    const previousTarget = state.commandTarget
    const wasOpen = state.commandPopupOpen
    state.commandPopupOpen = false
    state.commandTarget = 'main'
    state.commandQuery = ''
    state.commandKeyboardIndex = -1
    if (wasOpen && input.restoreFocus) options.focusInputForTarget(previousTarget)
    return wasOpen
  }

  const openCommandPopupForTarget = async (target: AiPanelPopupTarget) => {
    options.saveSelection(target)
    await options.refreshAiCommandCatalog()
    state.commandTarget = target
    state.commandPopupOpen = true
    closeContextPopup()
    closeAuxiliaryMenus()
    state.commandQuery = ''
    state.commandKeyboardIndex = -1
    await options.afterDomUpdate()
    options.focusCommandSearchInput()
  }

  const openContextPopupForTarget = (target: AiPanelPopupTarget, level: 'main' | AiContextKind = 'main') => {
    options.saveSelection(target)
    state.contextTarget = target
    state.contextPopupOpen = true
    closeCommandPopup()
    closeAuxiliaryMenus()
    state.contextLevel = level
    state.contextQuery = ''
    state.contextKeyboardIndex = -1
    if (level === 'docs') resetDocsContextNavigation()
    void options.refreshAiContextCatalog()
    focusContextSearchInput()
  }

  const closePopups = (input: { restoreCommandFocus?: boolean; restoreContextFocus?: boolean } = {}) => {
    closeContextPopup({ restoreFocus: input.restoreContextFocus })
    closeCommandPopup({ restoreFocus: input.restoreCommandFocus })
    options.closeCodexTargetPicker()
    options.closeMoreActionsMenu()
    options.closeModeMenu()
    options.closePanelModeMenu()
    options.closeModelMenu()
    options.closeHistoryMenu()
  }

  const toggleContextPopup = () => {
    if (state.contextPopupOpen) {
      closeContextPopup({ restoreFocus: true })
      return false
    }
    openContextPopupForTarget('main')
    return true
  }

  const openContextCategory = async (category: AiContextKind) => {
    state.contextLevel = category
    state.contextQuery = ''
    state.contextKeyboardIndex = -1
    if (category === 'docs') resetDocsContextNavigation()
    focusContextSearchInput()
    await options.refreshAiContextCatalog()
    focusContextSearchInput()
  }

  const handleContextQueryChanged = () => {
    state.contextKeyboardIndex = -1
  }

  const selectContextKeyboardItem = <TIcon>(input: AiPanelPopupContextKeydownInput<TIcon>) => {
    if (state.contextLevel === 'main') {
      const selection = mainContextKeyboardSelection(state.contextKeyboardIndex, input.displayedOpenedHosts, input.visibleContextCategories)
      if (selection.kind === 'host') input.applyContext(selection.context)
      if (selection.kind === 'category') void openContextCategory(selection.category.id)
      return selection.kind !== 'none'
    }
    const option = input.filteredContextOptions[state.contextKeyboardIndex]
    if (!option) return false
    input.applyContext(option)
    return true
  }

  const selectCommandKeyboardItem = (input: AiPanelPopupCommandKeydownInput) => {
    const preset = input.filteredCommands[state.commandKeyboardIndex]
    if (!preset) return false
    input.applyCommand(preset)
    return true
  }

  const handleContextKeydown = <TIcon>(event: KeyboardEvent, input: AiPanelPopupContextKeydownInput<TIcon>) => {
    const listLength =
      state.contextLevel === 'main' ? input.displayedOpenedHosts.length + input.visibleContextCategories.length : input.filteredContextOptions.length
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      state.contextKeyboardIndex = nextAiPanelPopupKeyboardIndex(state.contextKeyboardIndex, listLength, 'down', {
        mainLevel: state.contextLevel === 'main'
      })
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      state.contextKeyboardIndex = nextAiPanelPopupKeyboardIndex(state.contextKeyboardIndex, listLength, 'up', {
        mainLevel: state.contextLevel === 'main'
      })
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectContextKeyboardItem(input)
      return true
    }
    if (event.key === 'Escape') {
      preventPopupKeyEvent(event)
      if (state.contextLevel !== 'main') {
        goBackContextPopup()
      } else {
        closeContextPopup({ restoreFocus: true })
      }
      return true
    }
    if (event.key === 'Backspace' && state.contextQuery === '' && state.contextLevel !== 'main') {
      event.preventDefault()
      goBackContextPopup()
      return true
    }
    return false
  }

  const handleCommandKeydown = (event: KeyboardEvent, input: AiPanelPopupCommandKeydownInput) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      state.commandKeyboardIndex = nextAiPanelPopupKeyboardIndex(state.commandKeyboardIndex, input.filteredCommands.length, 'down')
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      state.commandKeyboardIndex = nextAiPanelPopupKeyboardIndex(state.commandKeyboardIndex, input.filteredCommands.length, 'up')
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectCommandKeyboardItem(input)
      return true
    }
    if (event.key === 'Escape') {
      preventPopupKeyEvent(event)
      closeCommandPopup({ restoreFocus: true })
      return true
    }
    return false
  }

  const handleMainEditableKeydown = <TIcon>(event: KeyboardEvent, input: AiPanelPopupEditableKeydownInput<TIcon>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void input.handleSend()
      return true
    }
    if (event.key === '@' && !event.isComposing) {
      options.defer(() => openContextPopupForTarget('main'))
      return true
    }
    if (event.key === '/' && !event.isComposing) {
      const shouldOpenAfterKey = input.shouldTriggerCommandPopupForPendingSlash('main')
      options.defer(() => {
        options.saveSelection('main')
        const hasInsertedSlashToken = input.shouldTriggerCommandPopupFromEditableText()
        if (!shouldOpenAfterKey && input.getCharBeforeCaret('main') !== '/' && !hasInsertedSlashToken) return
        if (!shouldOpenAfterKey && !input.shouldTriggerCommandPopupForSlash('main') && !hasInsertedSlashToken) return
        void openCommandPopupForTarget('main')
      })
      return true
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void input.handleSend()
      return true
    }
    if (event.key === 'Escape' && state.contextPopupOpen && state.contextTarget === 'main') {
      preventPopupKeyEvent(event)
      if (state.contextLevel !== 'main') {
        goBackContextPopup()
      } else {
        closeContextPopup({ restoreFocus: true })
      }
      return true
    }
    if (event.key === 'Escape' && state.commandPopupOpen && state.commandTarget === 'main') {
      preventPopupKeyEvent(event)
      closeCommandPopup({ restoreFocus: true })
      return true
    }
    return false
  }

  const handleEditEditableKeydown = <TIcon>(event: KeyboardEvent, input: AiPanelPopupEditableKeydownInput<TIcon>) => {
    if (event.key === '@' && !event.isComposing) {
      options.defer(() => openContextPopupForTarget('edit'))
      return true
    }
    if (event.key === '/' && !event.isComposing) {
      const shouldOpenAfterKey = input.shouldTriggerCommandPopupForPendingSlash('edit')
      options.defer(() => {
        options.saveSelection('edit')
        if (!shouldOpenAfterKey && input.getCharBeforeCaret('edit') !== '/') return
        if (!shouldOpenAfterKey && !input.shouldTriggerCommandPopupForSlash('edit')) return
        void openCommandPopupForTarget('edit')
      })
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (state.contextPopupOpen && state.contextTarget === 'edit') {
        if (state.contextLevel !== 'main') {
          goBackContextPopup()
        } else {
          closeContextPopup({ restoreFocus: true })
        }
        return true
      }
      if (state.commandPopupOpen && state.commandTarget === 'edit') {
        closeCommandPopup({ restoreFocus: true })
        return true
      }
      input.cancelMessageEdit()
      return true
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      if (state.contextPopupOpen && state.contextTarget === 'edit') {
        selectContextKeyboardItem(input)
        return true
      }
      if (state.commandPopupOpen && state.commandTarget === 'edit') {
        selectCommandKeyboardItem(input)
        return true
      }
      void input.confirmMessageEdit()
      return true
    }
    return false
  }

  const handlePanelKeydown = (
    event: KeyboardEvent,
    input: {
      aiPanelMode: AiPanelMode
      chatSearchOpen: boolean
    }
  ) => {
    if (input.aiPanelMode === 'codex') {
      if (event.key === 'Escape') closePopups()
      return event.key === 'Escape'
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      preventPopupKeyEvent(event)
      void options.openChatSearch()
      return true
    }
    if (event.key !== 'Escape') return false
    if (input.chatSearchOpen) {
      preventPopupKeyEvent(event)
      options.closeChatSearch()
      return true
    }
    if (state.contextPopupOpen) {
      preventPopupKeyEvent(event)
      if (state.contextLevel !== 'main') {
        goBackContextPopup()
      } else {
        closeContextPopup({ restoreFocus: true })
      }
      return true
    }
    if (state.commandPopupOpen) {
      preventPopupKeyEvent(event)
      closeCommandPopup({ restoreFocus: true })
      return true
    }
    return false
  }

  return {
    closeCommandPopup,
    closeContextPopup,
    closePopups,
    enterDocsDir,
    focusContextSearchInput,
    goBackContextPopup,
    goBackDocsDir,
    handleCommandKeydown,
    handleContextKeydown,
    handleContextQueryChanged,
    handleEditEditableKeydown,
    handleMainEditableKeydown,
    handlePanelKeydown,
    openCommandPopupForTarget,
    openContextCategory,
    openContextPopupForTarget,
    resetDocsContextNavigation,
    returnContextPopupToMain,
    toggleContextPopup
  }
}
