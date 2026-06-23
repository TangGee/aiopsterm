import { describe, expect, it, vi } from 'vitest'
import {
  aiPanelModeDropdownWidth,
  aiPanelModelCatalogReady,
  aiPanelModelDropdownWidth,
  createAiPanelModelRuntime,
  createEmptyAiPanelModelRuntimeState,
  displayAiPanelModelName,
  filteredAiPanelModels,
  hasAvailableAiPanelModels,
  isThinkingAiPanelModelName,
  modelMatchesAiPanelQuery,
  stripAiPanelThinkingSuffix,
  type AiPanelChatModeOption
} from '@/services/ai/aiPanelModelRuntime'
import type { AiModelCatalogOption } from '@shared/contracts/appRuntime'

const modeOptions: AiPanelChatModeOption[] = [
  { id: 'agent', label: 'Agent', detail: 'agent mode' },
  { id: 'cmd', label: 'Command', detail: 'command mode' }
]

const availableModels: AiModelCatalogOption[] = [
  { id: 'gpt-5-Thinking', label: 'gpt-5-Thinking', displayName: 'GPT 5 Thinking', detail: 'deep reasoning', apiProvider: 'openai' },
  { id: 'qwen2.5-coder', label: 'qwen2.5-coder', displayName: 'Ollama Coder', detail: 'local coding', apiProvider: 'ollama' }
]

const lockedModels: AiModelCatalogOption[] = [
  { id: 'gpt-5-pro', label: 'gpt-5-pro', detail: 'Subscription model', tier: 'VIP', locked: true }
]

const createHarness = () => {
  const state = createEmptyAiPanelModelRuntimeState()
  let selectedModelName = 'gpt-5-Thinking'
  let currentAvailableModels = availableModels.map((model) => ({ ...model }))
  let currentLockedModels = lockedModels.map((model) => ({ ...model }))
  let settingsModelCount = 1
  const calls = {
    selectModel: vi.fn(async (modelId: string) => {
      selectedModelName = modelId
      return modelId !== 'missing'
    }),
    closeContextPopup: vi.fn(),
    closeCommandPopup: vi.fn(),
    closePopups: vi.fn(),
    openModelSettings: vi.fn(),
    openModelLogin: vi.fn(async () => undefined),
    focusModelSearchInput: vi.fn(async () => undefined),
    afterDomUpdate: vi.fn(async () => undefined)
  }
  const runtime = createAiPanelModelRuntime({
    state,
    chatModeOptions: () => modeOptions,
    availableModels: () => currentAvailableModels,
    lockedModels: () => currentLockedModels,
    settingsModelCount: () => settingsModelCount,
    selectedModelName: () => selectedModelName,
    selectModel: calls.selectModel,
    closeContextPopup: calls.closeContextPopup,
    closeCommandPopup: calls.closeCommandPopup,
    closePopups: calls.closePopups,
    openModelSettings: calls.openModelSettings,
    openModelLogin: calls.openModelLogin,
    focusModelSearchInput: calls.focusModelSearchInput,
    afterDomUpdate: calls.afterDomUpdate,
    measureText: (text) => text.length * 10,
    lockedModelTooltip: (tier) => `upgrade ${tier}`
  })
  return {
    calls,
    runtime,
    state,
    setAvailableModels: (models: AiModelCatalogOption[]) => {
      currentAvailableModels = models
    },
    setLockedModels: (models: AiModelCatalogOption[]) => {
      currentLockedModels = models
    },
    setSettingsModelCount: (count: number) => {
      settingsModelCount = count
    },
    selectedModelName: () => selectedModelName
  }
}

describe('aiPanelModelRuntime', () => {
  it('derives model names, filtering, catalog readiness, and dropdown widths', () => {
    expect(stripAiPanelThinkingSuffix('gpt-5-Thinking')).toBe('gpt-5')
    expect(displayAiPanelModelName('gpt-5-Thinking')).toBe('gpt-5')
    expect(displayAiPanelModelName(availableModels[1])).toBe('Ollama Coder')
    expect(isThinkingAiPanelModelName('gpt-5-Thinking')).toBe(true)
    expect(modelMatchesAiPanelQuery(availableModels[1], 'ollama')).toBe(true)
    expect(filteredAiPanelModels(availableModels, 'qwen').map((model) => model.id)).toEqual(['qwen2.5-coder'])
    expect(hasAvailableAiPanelModels(availableModels)).toBe(true)
    expect(aiPanelModelCatalogReady({ availableModels: [], lockedModels, settingsModelCount: 0 })).toBe(true)
    expect(aiPanelModelCatalogReady({ availableModels: [], lockedModels: [], settingsModelCount: 0 })).toBe(false)
    expect(aiPanelModeDropdownWidth(modeOptions, (text) => text.length * 10)).toBeGreaterThanOrEqual(96)
    expect(aiPanelModelDropdownWidth(availableModels, lockedModels, (text) => text.length * 10)).toBeGreaterThanOrEqual(120)
  })

  it('owns mode and model menu state with injected focus and popup closure', async () => {
    const { calls, runtime, state } = createHarness()
    runtime.toggleModeMenu()
    expect(state.modeMenuOpen).toBe(true)
    expect(state.modelMenuOpen).toBe(false)
    expect(calls.closeContextPopup).toHaveBeenCalled()
    expect(calls.closeCommandPopup).toHaveBeenCalled()

    await runtime.toggleModelMenu()
    expect(state.modelMenuOpen).toBe(true)
    expect(state.modeMenuOpen).toBe(false)
    expect(calls.afterDomUpdate).toHaveBeenCalled()
    expect(calls.focusModelSearchInput).toHaveBeenCalled()

    runtime.selectChatMode('cmd')
    expect(state.chatMode).toBe('cmd')
    expect(runtime.currentChatMode().label).toBe('Command')

    state.modelQuery = 'qwen'
    expect(runtime.filteredModelOptions().map((model) => model.id)).toEqual(['qwen2.5-coder'])
    await runtime.handleModelKeydown({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() })
    expect(calls.selectModel).toHaveBeenCalledWith('qwen2.5-coder')
    expect(state.modelMenuOpen).toBe(false)
    expect(runtime.selectedModelLabel()).toBe('Ollama Coder')
  })

  it('handles locked-only enter, escape, onboarding, empty catalog, settings, and login flows', async () => {
    const { calls, runtime, setAvailableModels, setSettingsModelCount, state } = createHarness()
    await runtime.openModelMenu()
    state.modelQuery = 'pro'
    await runtime.handleModelKeydown({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() })
    expect(calls.selectModel).not.toHaveBeenCalled()
    expect(state.modelMenuOpen).toBe(true)

    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    await runtime.handleModelKeydown({ key: 'Escape', preventDefault, stopPropagation })
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(state.modelMenuOpen).toBe(false)
    expect(state.modelQuery).toBe('')

    setAvailableModels([])
    setSettingsModelCount(1)
    expect(runtime.showNoAvailableModelPrompt()).toBe(true)
    setSettingsModelCount(0)
    expect(runtime.showNoAvailableModelPrompt()).toBe(true)

    runtime.openModeOnboarding()
    expect(state).toMatchObject({ chatMode: 'cmd', modeMenuOpen: true, modelMenuOpen: false })
    await runtime.openModelOnboarding()
    expect(state).toMatchObject({ modeMenuOpen: false, modelMenuOpen: true, modelQuery: '' })
    runtime.prepareSendOnboarding()
    expect(state.chatMode).toBe('agent')

    runtime.openModelSettings()
    expect(calls.closePopups).toHaveBeenCalled()
    expect(calls.openModelSettings).toHaveBeenCalled()
    await runtime.openModelLogin()
    expect(calls.openModelLogin).toHaveBeenCalled()
    expect(runtime.lockedModelTooltip('VIP')).toBe('upgrade VIP')
  })
})
