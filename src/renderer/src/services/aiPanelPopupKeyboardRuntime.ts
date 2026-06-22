import type {
  AiPanelPopupEditableKeydownInput,
  createAiPanelPopupInteractionRuntime
} from '@/services/aiPanelPopupInteractionRuntime'
import type { AiPanelMode } from '@/services/aiPanelModeRuntime'
import type { AiCommandCatalogOption, AiContextOption } from '@shared/contracts/aiChat'
import type { AiPanelContextCategoryView } from '@/services/aiPanelPopupRuntime'

export type AiPanelPopupKeyboardRuntimeOptions<TIcon = unknown> = {
  popupInteractionRuntime: Pick<
    ReturnType<typeof createAiPanelPopupInteractionRuntime>,
    | 'handleMainEditableKeydown'
    | 'handleEditEditableKeydown'
    | 'handleContextKeydown'
    | 'handlePanelKeydown'
    | 'handleCommandKeydown'
    | 'handleContextQueryChanged'
  >
  displayedOpenedHosts: () => AiContextOption[]
  visibleContextCategories: () => Array<AiPanelContextCategoryView<TIcon>>
  filteredContextOptions: () => AiContextOption[]
  filteredCommands: () => AiCommandCatalogOption[]
  applyContext: (context: AiContextOption) => void
  applyCommand: (preset: AiCommandCatalogOption) => void
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

export const createAiPanelPopupKeyboardRuntime = <TIcon = unknown>(options: AiPanelPopupKeyboardRuntimeOptions<TIcon>) => {
  const popupEditableKeydownInput = (): AiPanelPopupEditableKeydownInput<TIcon> => ({
    displayedOpenedHosts: options.displayedOpenedHosts(),
    visibleContextCategories: options.visibleContextCategories(),
    filteredContextOptions: options.filteredContextOptions(),
    filteredCommands: options.filteredCommands(),
    applyContext: options.applyContext,
    applyCommand: options.applyCommand,
    handleSend: options.handleSend,
    confirmMessageEdit: options.confirmMessageEdit,
    cancelMessageEdit: options.cancelMessageEdit,
    shouldTriggerCommandPopupForPendingSlash: (target) =>
      target === 'edit'
        ? options.shouldTriggerEditCommandPopupForPendingSlash()
        : options.shouldTriggerMainCommandPopupForPendingSlash(),
    shouldTriggerCommandPopupForSlash: (target) =>
      target === 'edit'
        ? options.shouldTriggerEditCommandPopupForSlash()
        : options.shouldTriggerMainCommandPopupForSlash(),
    getCharBeforeCaret: (target) => (target === 'edit' ? options.editCharBeforeCaret() : options.mainCharBeforeCaret()),
    shouldTriggerCommandPopupFromEditableText: options.shouldTriggerCommandPopupFromEditableText
  })

  const handleEditableKeydown = (event: KeyboardEvent) => {
    options.popupInteractionRuntime.handleMainEditableKeydown(event, popupEditableKeydownInput())
  }

  const handleEditEditableKeydown = (event: KeyboardEvent) => {
    options.popupInteractionRuntime.handleEditEditableKeydown(event, popupEditableKeydownInput())
  }

  const handleContextKeydown = (event: KeyboardEvent) => {
    options.popupInteractionRuntime.handleContextKeydown(event, popupEditableKeydownInput())
  }

  const handlePanelKeydown = (event: KeyboardEvent) => {
    options.popupInteractionRuntime.handlePanelKeydown(event, {
      aiPanelMode: options.aiPanelMode(),
      chatSearchOpen: options.chatSearchOpen()
    })
  }

  const handleCommandKeydown = (event: KeyboardEvent) => {
    options.popupInteractionRuntime.handleCommandKeydown(event, popupEditableKeydownInput())
  }

  return {
    handleCommandKeydown,
    handleContextKeydown,
    handleContextQueryChanged: options.popupInteractionRuntime.handleContextQueryChanged,
    handleEditableKeydown,
    handleEditEditableKeydown,
    handlePanelKeydown,
    popupEditableKeydownInput
  }
}
