import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createAiPanelModelPopupShellRuntime } from '@/services/ai/aiPanelModelPopupShellRuntime'
import type { AiModelCatalogOption } from '@shared/contracts/appRuntime'
import type { AiCommandCatalogOption, AiContextCategoryInfo, AiContextOption } from '@shared/contracts/aiChat'

const host = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'hosts',
  ...input
})

const doc = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'docs',
  contextType: 'doc',
  ...input
})

const skill = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'skills',
  ...input
})

const command = (input: Partial<AiCommandCatalogOption> & Pick<AiCommandCatalogOption, 'id' | 'name' | 'command'>): AiCommandCatalogOption => ({
  label: input.name,
  path: `${input.id}.md`,
  ...input
})

const availableModels: AiModelCatalogOption[] = [
  { id: 'gpt-5-Thinking', label: 'gpt-5-Thinking', displayName: 'GPT 5 Thinking', detail: 'reasoning', apiProvider: 'openai' },
  { id: 'qwen-coder', label: 'qwen-coder', displayName: 'Qwen Coder', detail: 'local coding', apiProvider: 'ollama' }
]

const lockedModels: AiModelCatalogOption[] = [
  { id: 'gpt-5-pro', label: 'gpt-5-pro', detail: 'premium', tier: 'VIP', locked: true }
]

const createHarness = () => {
  const selectedModelName = ref('gpt-5-Thinking')
  const currentAvailableModels = ref(availableModels.map((model) => ({ ...model })))
  const currentLockedModels = ref(lockedModels.map((model) => ({ ...model })))
  const settingsModelCount = ref(1)
  const selectedCommandId = ref<string | null>('rollback')
  const selectedCommandRef = ref<{ command: string; label?: string; path?: string } | null>(null)
  const editHosts = ref<AiContextOption[]>([])
  const categories: AiContextCategoryInfo[] = [
    { id: 'hosts', label: 'Hosts', options: [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })] },
    {
      id: 'docs',
      label: 'Docs',
      options: [
        doc({ id: 'runbook', label: 'Runbook.md', relPath: 'Runbook.md', parentRelPath: '' }),
        doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands', parentRelPath: '' }),
        doc({ id: 'nested', label: 'Summary.md', relPath: 'commands/Summary.md', parentRelPath: 'commands' })
      ]
    },
    { id: 'skills', label: 'Skills', options: [] }
  ]
  const openedHosts = [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })]
  const selectedContexts = [host({ id: 'prod', label: '10.0.0.8', detail: 'prod' })]
  const skillOptions = [skill({ id: 'summarizer', label: 'Summarizer' })]
  const commands = [
    command({ id: 'rollback', name: 'rollback-plan', command: '/rollback' }),
    command({ id: 'summary', name: 'Summary to Doc', command: '/summary' })
  ]
  const calls = {
    selectModel: vi.fn(async (modelId: string) => {
      selectedModelName.value = modelId
      return true
    }),
    closeContextPopup: vi.fn(),
    closeCommandPopup: vi.fn(),
    closePopups: vi.fn(),
    openModelSettings: vi.fn(),
    openModelLogin: vi.fn(async () => undefined),
    afterDomUpdate: vi.fn(async () => undefined)
  }
  const runtime = createAiPanelModelPopupShellRuntime({
    chatModeOptions: () => [
      { id: 'agent', label: 'Agent', detail: 'agent mode' },
      { id: 'cmd', label: 'Command', detail: 'command mode' }
    ],
    availableModels: () => currentAvailableModels.value,
    lockedModels: () => currentLockedModels.value,
    settingsModelCount: () => settingsModelCount.value,
    selectedModelName: () => selectedModelName.value,
    selectModel: calls.selectModel,
    closeContextPopup: calls.closeContextPopup,
    closeCommandPopup: calls.closeCommandPopup,
    closePopups: calls.closePopups,
    openModelSettings: calls.openModelSettings,
    openModelLogin: calls.openModelLogin,
    afterDomUpdate: calls.afterDomUpdate,
    measureText: (text) => text.length * 10,
    lockedModelTooltip: (tier) => `upgrade ${tier}`,
    categories: () => categories,
    commandOptions: () => commands,
    openedHosts: () => openedHosts,
    selectedContexts: () => selectedContexts,
    editHostContexts: () => editHosts.value,
    skillOptions: () => skillOptions,
    selectedCommandId: () => selectedCommandId.value,
    selectedCommandRef: () => selectedCommandRef.value,
    iconForKind: (kind) => `icon:${kind}`
  })
  return {
    calls,
    runtime,
    setAvailableModels: (models: AiModelCatalogOption[]) => {
      currentAvailableModels.value = models
    },
    setLockedModels: (models: AiModelCatalogOption[]) => {
      currentLockedModels.value = models
    },
    setSettingsModelCount: (count: number) => {
      settingsModelCount.value = count
    },
    setSelectedCommandId: (id: string | null) => {
      selectedCommandId.value = id
    },
    setSelectedCommandRef: (ref: { command: string; label?: string; path?: string } | null) => {
      selectedCommandRef.value = ref
    },
    setEditHosts: (hosts: AiContextOption[]) => {
      editHosts.value = hosts
    }
  }
}

describe('aiPanelModelPopupShellRuntime', () => {
  it('owns model menu refs, filtering, selection, and onboarding state as one shell', async () => {
    const { calls, runtime, setAvailableModels, setSettingsModelCount } = createHarness()

    expect(runtime.chatMode.value).toBe('agent')
    expect(runtime.currentChatMode.value.label).toBe('Agent')
    expect(runtime.selectedModelLabel.value).toBe('GPT 5 Thinking')
    expect(runtime.displayModelName('gpt-5-Thinking')).toBe('gpt-5')
    expect(runtime.isThinkingModelName('gpt-5-Thinking')).toBe(true)

    runtime.toggleModeMenu()
    expect(runtime.modeMenuOpen.value).toBe(true)
    expect(calls.closeContextPopup).toHaveBeenCalled()
    expect(calls.closeCommandPopup).toHaveBeenCalled()

    await runtime.toggleModelMenu()
    expect(runtime.modelMenuOpen.value).toBe(true)
    expect(runtime.modeMenuOpen.value).toBe(false)
    expect(calls.afterDomUpdate).toHaveBeenCalled()

    runtime.modelQuery.value = 'qwen'
    expect(runtime.filteredModelOptions.value.map((model) => model.id)).toEqual(['qwen-coder'])
    await runtime.handleModelKeydown({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent)
    expect(calls.selectModel).toHaveBeenCalledWith('qwen-coder')
    expect(runtime.modelMenuOpen.value).toBe(false)
    expect(runtime.selectedModelLabel.value).toBe('Qwen Coder')

    runtime.openModeOnboarding()
    expect(runtime.chatMode.value).toBe('cmd')
    expect(runtime.modeMenuOpen.value).toBe(true)
    await runtime.openModelOnboarding()
    expect(runtime.modelMenuOpen.value).toBe(true)
    runtime.prepareSendOnboarding()
    expect(runtime.chatMode.value).toBe('agent')

    setAvailableModels([])
    setSettingsModelCount(1)
    expect(runtime.showNoAvailableModelPrompt.value).toBe(true)
    expect(runtime.filteredLockedModelOptions.value.map((model) => model.id)).toEqual(['gpt-5-pro'])
    expect(runtime.lockedModelTooltip('VIP')).toBe('upgrade VIP')
    expect(runtime.modeDropdownWidthPx.value).toBeGreaterThanOrEqual(96)
    expect(runtime.modelDropdownWidthPx.value).toBeGreaterThanOrEqual(120)

    runtime.openModelSettings()
    expect(calls.closePopups).toHaveBeenCalled()
    await runtime.openModelLogin()
    expect(calls.openModelLogin).toHaveBeenCalled()
  })

  it('projects popup state and view data from the same shell boundary', () => {
    const { runtime, setEditHosts, setSelectedCommandId, setSelectedCommandRef } = createHarness()

    expect(runtime.popupInteractionState.contextPopupOpen).toBe(false)
    runtime.contextPopupOpen.value = true
    runtime.contextLevel.value = 'docs'
    expect(runtime.popupInteractionState.contextPopupOpen).toBe(true)
    expect(runtime.aiContextCategories.value[0]).toMatchObject({ id: 'hosts', icon: 'icon:hosts' })
    expect(runtime.selectedContextCategory.value?.id).toBe('docs')
    expect(runtime.docsContextOptions.value.map((option) => option.label)).toEqual(['commands', 'Runbook.md'])
    expect(runtime.displayedOpenedHosts.value.map((option) => option.id)).toEqual(['prod'])
    expect(runtime.hostContextsForPopup.value.map((context) => context.id)).toEqual(['prod'])
    expect(runtime.commandOptions.value.map((preset) => preset.id)).toEqual(['rollback', 'summary'])
    expect(runtime.filteredCommands.value.map((preset) => preset.id)).toEqual(['rollback', 'summary'])
    expect(runtime.selectedCommand.value?.id).toBe('rollback')
    expect(runtime.selectedCommandRef.value).toEqual({ command: '/rollback', label: 'rollback-plan', path: 'rollback.md' })

    runtime.docsCurrentRelDir.value = 'commands'
    expect(runtime.docsContextOptions.value.map((option) => option.id)).toEqual(['nested'])

    runtime.contextLevel.value = 'skills'
    runtime.contextQuery.value = 'sum'
    expect(runtime.filteredContextOptions.value.map((option) => option.id)).toEqual(['summarizer'])

    runtime.contextLevel.value = 'hosts'
    runtime.contextTarget.value = 'edit'
    runtime.contextQuery.value = ''
    setEditHosts([host({ id: 'stage', label: '10.0.0.9' })])
    expect(runtime.visibleHostContextOptions.value.map((option) => option.id)).toEqual(['prod'])
    expect(runtime.hostContextsForPopup.value.map((context) => context.id)).toEqual(['stage'])
    expect(runtime.allVisibleHostContextsSelected.value).toBe(false)

    runtime.commandQuery.value = 'sum'
    expect(runtime.filteredCommands.value.map((preset) => preset.id)).toEqual(['summary'])
    setSelectedCommandId('missing-command')
    expect(runtime.selectedCommand.value).toBeNull()
    expect(runtime.selectedCommandRef.value).toEqual({ command: 'missing-command', label: 'missing-command' })
    setSelectedCommandRef({ command: '/custom', label: 'Custom', path: 'custom.md' })
    expect(runtime.selectedCommandRef.value).toEqual({ command: '/custom', label: 'Custom', path: 'custom.md' })
  })
})
