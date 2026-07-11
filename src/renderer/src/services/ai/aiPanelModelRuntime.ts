import type { AiModelCatalogOption } from '@shared/contracts/appRuntime'

export type AiPanelChatMode = 'agent' | 'cmd' | 'chat'

export type AiPanelChatModeOption = {
  id: AiPanelChatMode
  label: string
  detail: string
}

export type AiPanelModelRuntimeState = {
  chatMode: AiPanelChatMode
  modeMenuOpen: boolean
  modelMenuOpen: boolean
  modelQuery: string
}

export type AiPanelModelRuntimeOptions = {
  state: AiPanelModelRuntimeState
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
  focusModelSearchInput: () => void | Promise<void>
  afterDomUpdate: () => void | Promise<void>
  measureText: (text: string) => number
  lockedModelTooltip: (tier: string) => string
}

const SELECT_CHROME_PX = 48
const THINKING_ICON_SELECT_EXTRA_PX = 22
const DROPDOWN_ROW_CHROME_PX = 52
const LOCK_ROW_ICON_EXTRA_PX = 22
const VIP_TAG_ROW_EXTRA_PX = 36

export const createEmptyAiPanelModelRuntimeState = (): AiPanelModelRuntimeState => ({
  chatMode: 'agent',
  modeMenuOpen: false,
  modelMenuOpen: false,
  modelQuery: ''
})

export const stripAiPanelThinkingSuffix = (modelName: string) => modelName.replace(/-Thinking$/, '')

export const displayAiPanelModelName = (model: { id?: string; label?: string; displayName?: string } | string) =>
  typeof model === 'string' ? stripAiPanelThinkingSuffix(model) : model.displayName || stripAiPanelThinkingSuffix(model.label || model.id || '')

export const isThinkingAiPanelModelName = (modelName: string) => modelName.endsWith('-Thinking')

export const modelMatchesAiPanelQuery = (
  model: { id: string; label: string; detail?: string; tier?: string; displayName?: string },
  query: string,
  displayName: (model: { id?: string; label?: string; displayName?: string } | string) => string = displayAiPanelModelName
) => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return `${model.id} ${model.label} ${displayName(model)} ${model.detail || ''} ${model.tier || ''}`.toLowerCase().includes(keyword)
}

export const filteredAiPanelModels = (models: AiModelCatalogOption[], query: string) =>
  models.filter((model) => modelMatchesAiPanelQuery(model, query))

export const aiPanelModelCatalogReady = (input: {
  availableModels: AiModelCatalogOption[]
  lockedModels: AiModelCatalogOption[]
  settingsModelCount: number
}) => input.availableModels.length > 0 || input.lockedModels.length > 0 || input.settingsModelCount > 0

export const hasAvailableAiPanelModels = (models: AiModelCatalogOption[]) => models.some((model) => !model.locked)

export const aiPanelModeDropdownWidth = (options: AiPanelChatModeOption[], measureText: (text: string) => number) => {
  const maxWidth = options.reduce((max, option) => {
    const width = Math.ceil(measureText(option.label)) + DROPDOWN_ROW_CHROME_PX
    return Math.max(max, width)
  }, 0)
  return Math.min(Math.max(maxWidth, 96), 400)
}

export const aiPanelModelDropdownWidth = (
  availableModels: AiModelCatalogOption[],
  lockedModels: AiModelCatalogOption[],
  measureText: (text: string) => number,
  displayName: (model: { id?: string; label?: string; displayName?: string } | string) => string = displayAiPanelModelName
) => {
  const availableMaxWidth = availableModels.reduce((max, model) => {
    const thinkingExtra = isThinkingAiPanelModelName(model.id) ? THINKING_ICON_SELECT_EXTRA_PX : 0
    const width = Math.ceil(measureText(displayName(model))) + SELECT_CHROME_PX + thinkingExtra
    return Math.max(max, width)
  }, 0)
  const lockedMaxWidth = lockedModels.reduce((max, model) => {
    const width = Math.ceil(measureText(model.label)) + DROPDOWN_ROW_CHROME_PX + LOCK_ROW_ICON_EXTRA_PX + VIP_TAG_ROW_EXTRA_PX
    return Math.max(max, width)
  }, 0)
  const maxWidth = Math.max(availableMaxWidth, lockedMaxWidth)
  return Math.min(Math.max(maxWidth, 120), 720)
}

export const createAiPanelModelRuntime = (options: AiPanelModelRuntimeOptions) => {
  const closeModelMenu = () => {
    options.state.modelMenuOpen = false
    options.state.modelQuery = ''
  }

  const closeModeMenu = () => {
    options.state.modeMenuOpen = false
  }

  const currentChatMode = () => options.chatModeOptions().find((option) => option.id === options.state.chatMode) || options.chatModeOptions()[0]

  const selectedModelLabel = () => {
    const model = options.availableModels().find((item) => item.id === options.selectedModelName())
    return model ? displayAiPanelModelName(model) : displayAiPanelModelName(options.selectedModelName())
  }

  const filteredModelOptions = () => filteredAiPanelModels(options.availableModels(), options.state.modelQuery)

  const filteredLockedModelOptions = () => filteredAiPanelModels(options.lockedModels(), options.state.modelQuery)

  const modelCatalogReady = () =>
    aiPanelModelCatalogReady({
      availableModels: options.availableModels(),
      lockedModels: options.lockedModels(),
      settingsModelCount: options.settingsModelCount()
    })

  const showNoAvailableModelPrompt = () => modelCatalogReady() && !hasAvailableAiPanelModels(options.availableModels())

  const modeDropdownWidthPx = () => aiPanelModeDropdownWidth(options.chatModeOptions(), options.measureText)

  const modelDropdownWidthPx = () => aiPanelModelDropdownWidth(options.availableModels(), options.lockedModels(), options.measureText)

  const toggleModeMenu = () => {
    options.state.modeMenuOpen = !options.state.modeMenuOpen
    closeModelMenu()
    options.closeContextPopup()
    options.closeCommandPopup()
  }

  const openModelMenu = async () => {
    options.state.modelQuery = ''
    options.state.modelMenuOpen = true
    options.state.modeMenuOpen = false
    options.closeContextPopup()
    options.closeCommandPopup()
    await options.afterDomUpdate()
    await options.focusModelSearchInput()
  }

  const toggleModelMenu = async () => {
    if (options.state.modelMenuOpen) {
      closeModelMenu()
      return
    }
    await openModelMenu()
  }

  const selectChatMode = (mode: AiPanelChatMode) => {
    options.state.chatMode = mode
    closeModeMenu()
  }

  const selectModel = async (modelId: string) => {
    const saved = await options.selectModel(modelId)
    if (saved) closeModelMenu()
    return saved
  }

  const openModelSettings = () => {
    options.closePopups()
    options.openModelSettings()
  }

  const openModelLogin = async () => {
    options.closePopups()
    await options.openModelLogin()
  }

  const handleModelKeydown = async (event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeModelMenu()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const model = filteredModelOptions()[0]
    if (model) await selectModel(model.id)
  }

  const openModeOnboarding = () => {
    options.state.chatMode = 'cmd'
    options.state.modeMenuOpen = true
    closeModelMenu()
    options.closeContextPopup()
    options.closeCommandPopup()
  }

  const openModelOnboarding = () => openModelMenu()

  const prepareSendOnboarding = () => {
    options.state.chatMode = 'agent'
  }

  return {
    closeModeMenu,
    closeModelMenu,
    currentChatMode,
    filteredLockedModelOptions,
    filteredModelOptions,
    handleModelKeydown,
    lockedModelTooltip: options.lockedModelTooltip,
    modeDropdownWidthPx,
    modelDropdownWidthPx,
    openModeOnboarding,
    openModelLogin,
    openModelMenu,
    openModelOnboarding,
    openModelSettings,
    prepareSendOnboarding,
    selectChatMode,
    selectModel,
    selectedModelLabel,
    showNoAvailableModelPrompt,
    toggleModeMenu,
    toggleModelMenu
  }
}
