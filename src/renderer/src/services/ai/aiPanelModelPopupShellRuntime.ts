import { computed, reactive, ref, toRef } from 'vue'
import {
  createAiPanelModelRuntime,
  createEmptyAiPanelModelRuntimeState,
  displayAiPanelModelName,
  isThinkingAiPanelModelName,
  type AiPanelChatMode,
  type AiPanelChatModeOption
} from '@/services/ai/aiPanelModelRuntime'
import { createAiPanelPopupViewRuntime } from '@/services/ai/aiPanelPopupRuntime'
import {
  createEmptyAiPanelPopupInteractionState,
  type AiPanelPopupInteractionState
} from '@/services/ai/aiPanelPopupInteractionRuntime'
import type { AiModelCatalogOption } from '@shared/contracts/appRuntime'
import type { AiCommandCatalogOption, AiContextCategoryInfo, AiContextKind, AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelModelPopupShellRuntimeOptions<TIcon = unknown> = {
  chatModeOptions: () => AiPanelChatModeOption[]
  availableModels: () => AiModelCatalogOption[]
  lockedModels: () => AiModelCatalogOption[]
  settingsModelCount: () => number
  selectedModelName: () => string
  selectModel: (modelId: string) => Promise<boolean>
  closeContextPopup: () => void
  closeCommandPopup: () => void
  closePopups: () => void
  openModelSettings: () => void
  openModelLogin: () => void | Promise<void>
  afterDomUpdate: () => void | Promise<void>
  measureText: (text: string) => number
  lockedModelTooltip: (tier: string) => string
  categories: () => AiContextCategoryInfo[]
  commandOptions: () => AiCommandCatalogOption[]
  openedHosts: () => AiContextOption[]
  selectedContexts: () => AiContextOption[]
  editHostContexts: () => AiContextOption[]
  skillOptions: () => AiContextOption[]
  selectedCommandId: () => string | null | undefined
  selectedCommandRef: () => { command: string; label?: string; path?: string } | null | undefined
  iconForKind: (kind: AiContextKind) => TIcon
}

export const createAiPanelModelPopupShellRuntime = <TIcon = unknown>(options: AiPanelModelPopupShellRuntimeOptions<TIcon>) => {
  const modelSearchInputRef = ref<HTMLInputElement | null>(null)

  const popupInteractionState = reactive(createEmptyAiPanelPopupInteractionState()) as AiPanelPopupInteractionState
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

  const modelRuntime = createAiPanelModelRuntime({
    state: modelRuntimeState,
    chatModeOptions: options.chatModeOptions,
    availableModels: options.availableModels,
    lockedModels: options.lockedModels,
    settingsModelCount: options.settingsModelCount,
    selectedModelName: options.selectedModelName,
    selectModel: options.selectModel,
    closeContextPopup: options.closeContextPopup,
    closeCommandPopup: options.closeCommandPopup,
    closePopups: options.closePopups,
    openModelSettings: options.openModelSettings,
    openModelLogin: options.openModelLogin,
    focusModelSearchInput: () => modelSearchInputRef.value?.focus(),
    afterDomUpdate: options.afterDomUpdate,
    measureText: options.measureText,
    lockedModelTooltip: options.lockedModelTooltip
  })

  const popupViewRuntime = createAiPanelPopupViewRuntime<TIcon>({
    categories: options.categories,
    commandOptions: options.commandOptions,
    openedHosts: options.openedHosts,
    selectedContexts: options.selectedContexts,
    editHostContexts: options.editHostContexts,
    skillOptions: options.skillOptions,
    selectedCommandId: options.selectedCommandId,
    selectedCommandRef: options.selectedCommandRef,
    contextTarget: () => contextTarget.value,
    contextLevel: () => contextLevel.value,
    contextQuery: () => contextQuery.value,
    commandQuery: () => commandQuery.value,
    docsCurrentRelDir: () => docsCurrentRelDir.value,
    chatMode: () => chatMode.value,
    iconForKind: options.iconForKind
  })

  const currentChatMode = computed(() => modelRuntime.currentChatMode())
  const selectedModelLabel = computed(() => modelRuntime.selectedModelLabel())
  const filteredModelOptions = computed(() => modelRuntime.filteredModelOptions())
  const filteredLockedModelOptions = computed(() => modelRuntime.filteredLockedModelOptions())
  const showNoAvailableModelPrompt = computed(() => modelRuntime.showNoAvailableModelPrompt())
  const modeDropdownWidthPx = computed(() => modelRuntime.modeDropdownWidthPx())
  const modelDropdownWidthPx = computed(() => modelRuntime.modelDropdownWidthPx())

  return {
    aiContextCategories: popupViewRuntime.aiContextCategories,
    allVisibleHostContextsSelected: popupViewRuntime.allVisibleHostContextsSelected,
    chatMode,
    closeModeMenu: modelRuntime.closeModeMenu,
    closeModelMenu: modelRuntime.closeModelMenu,
    commandKeyboardIndex,
    commandOptions: popupViewRuntime.commandOptions,
    commandPopupOpen,
    commandQuery,
    commandTarget,
    contextKeyboardIndex,
    contextLevel,
    contextPopupOpen,
    contextQuery,
    contextTarget,
    currentChatMode,
    displayedOpenedHosts: popupViewRuntime.displayedOpenedHosts,
    displayModelName: displayAiPanelModelName,
    docsContextOptions: popupViewRuntime.docsContextOptions,
    docsCurrentRelDir,
    docsDirStack,
    filteredCommands: popupViewRuntime.filteredCommands,
    filteredContextOptions: popupViewRuntime.filteredContextOptions,
    filteredLockedModelOptions,
    filteredModelOptions,
    handleModelKeydown: modelRuntime.handleModelKeydown,
    hostContextsForPopup: popupViewRuntime.hostContextsForPopup,
    isThinkingModelName: isThinkingAiPanelModelName,
    lockedModelTooltip: modelRuntime.lockedModelTooltip,
    modeDropdownWidthPx,
    modeMenuOpen,
    modelDropdownWidthPx,
    modelMenuOpen,
    modelQuery,
    modelSearchInputRef,
    openModeOnboarding: modelRuntime.openModeOnboarding,
    openModelLogin: modelRuntime.openModelLogin,
    openModelOnboarding: modelRuntime.openModelOnboarding,
    openModelSettings: modelRuntime.openModelSettings,
    popupInteractionState,
    prepareSendOnboarding: modelRuntime.prepareSendOnboarding,
    selectChatMode: (mode: AiPanelChatMode) => modelRuntime.selectChatMode(mode),
    selectedCommand: popupViewRuntime.selectedCommand,
    selectedCommandRef: popupViewRuntime.selectedCommandRef,
    selectedContextCategory: popupViewRuntime.selectedContextCategory,
    selectedModelLabel,
    selectModel: modelRuntime.selectModel,
    showNoAvailableModelPrompt,
    toggleModelMenu: modelRuntime.toggleModelMenu,
    toggleModeMenu: modelRuntime.toggleModeMenu,
    visibleContextCategories: popupViewRuntime.visibleContextCategories,
    visibleHostContextOptions: popupViewRuntime.visibleHostContextOptions
  }
}
