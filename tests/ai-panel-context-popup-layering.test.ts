import { mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const context = vi.hoisted(() => ({ runtime: null as any }))

vi.mock('@/services/ai/aiPanelContext', () => ({
  useAiPanelRuntimeContext: () => context.runtime
}))

import AiPanelClassicComposer from '@/components/ai/AiPanelClassicComposer.vue'

const makeRuntime = () => {
  const contextPopupOpen = ref(false)
  const commandPopupOpen = ref(false)
  const modeMenuOpen = ref(false)
  const modelMenuOpen = ref(false)
  const host = { id: 'opened-local', kind: 'hosts', label: '127.0.0.1', detail: 'local shell' }
  const applyContext = vi.fn(() => {
    contextPopupOpen.value = false
  })

  return {
    aiChatModeOptions: ref([{ id: 'agent', label: 'Agent' }]),
    aiPanelComposerRuntime: {
      handleClick: vi.fn(),
      handleInput: vi.fn(),
      handlePaste: vi.fn()
    },
    aiPanelMode: ref('classic'),
    allVisibleHostContextsSelected: ref(false),
    applyCommand: vi.fn(),
    applyContext,
    chatMode: ref('agent'),
    clearHostContexts: vi.fn(),
    commandKeyboardIndex: ref(-1),
    commandPopupOpen,
    commandQuery: ref(''),
    commandSearchInputRef: ref(null),
    commandTarget: ref('main'),
    composerIsEmpty: ref(true),
    contextKeyboardIndex: ref(-1),
    contextLevel: ref('main'),
    contextPopupOpen,
    contextQuery: ref(''),
    contextSearchInputRef: ref(null),
    contextUsage: ref({ used: 0, contextWindow: 0, percent: 0 }),
    contextUsageColor: ref('#56b6c2'),
    contextUsageTooltip: ref(''),
    contextUsageTrackColor: ref('transparent'),
    currentChatMode: ref({ id: 'agent', label: 'Agent' }),
    displayedOpenedHosts: ref([host]),
    displayModelName: vi.fn((model) => model.label),
    dropActive: ref(false),
    editableRef: ref(null),
    filteredCommands: ref([]),
    filteredContextOptions: ref([]),
    filteredLockedModelOptions: ref([]),
    filteredModelOptions: ref([]),
    handleCommandKeydown: vi.fn(),
    handleContextKeydown: vi.fn(),
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handleEditableKeydown: vi.fn(),
    handleFileUpload: vi.fn(),
    handleModelKeydown: vi.fn(),
    handleSend: vi.fn(),
    hostContextsForPopup: ref([]),
    inputPlaceholderNotice: ref(''),
    isContextSelectedForPopup: vi.fn((option: { id: string }) => option.id === host.id),
    isThinkingModelName: vi.fn(() => false),
    lockedModelTooltip: vi.fn(() => ''),
    modelDropdownWidthPx: ref(220),
    modelMenuOpen,
    modelQuery: ref(''),
    modelSearchInputRef: ref(null),
    modeDropdownWidthPx: ref(160),
    modeMenuOpen,
    openContextCategory: vi.fn(),
    openImagePicker: vi.fn(),
    returnContextPopupToMain: vi.fn(),
    saveEditableSelection: vi.fn(),
    selectAllVisibleHostContexts: vi.fn(),
    selectChatMode: vi.fn(),
    selectedCommandRef: ref(null),
    selectedModelLabel: ref('ark-code-latest'),
    selectModel: vi.fn(),
    showNoAvailableModelPrompt: ref(false),
    streaming: ref(false),
    t: (key: string) => key,
    toggleContextPopup: vi.fn(() => {
      contextPopupOpen.value = !contextPopupOpen.value
    }),
    toggleModelMenu: vi.fn(),
    toggleModeMenu: vi.fn(),
    toggleVoiceInput: vi.fn(),
    visibleContextCategories: ref([]),
    voiceButtonTitle: ref('voice'),
    voiceRecording: ref(false),
    voiceTranscribing: ref(false),
    workspace: reactive({
      selectedContexts: [],
      config: { modelName: 'ark-code-latest' },
      aiModelOptions: [],
      removeContext: vi.fn(),
      selectCommandPreset: vi.fn()
    })
  }
}

describe('AiPanel classic context popup layering', () => {
  beforeEach(() => {
    context.runtime = makeRuntime()
  })

  it('raises the composer while open and keeps a context row clickable', async () => {
    const wrapper = mount(AiPanelClassicComposer)

    await wrapper.find('.context-trigger-tag').trigger('click')
    expect(wrapper.find('.chat-input').classes()).toContain('popup-open')
    expect(wrapper.find('.context-select-popup').exists()).toBe(true)

    const hostRow = wrapper.find('.context-select-popup .context-option-row')
    expect(hostRow.element.children).toHaveLength(3)
    expect(hostRow.find('.context-option-tail em').text()).toBe('local shell')
    expect(hostRow.find('.context-option-tail svg').exists()).toBe(true)

    await hostRow.trigger('click')
    expect(context.runtime.applyContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'opened-local' })
    )
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)
    expect(wrapper.find('.chat-input').classes()).not.toContain('popup-open')
  })

  it('keeps the popup above the scroll surface and opaque over background images', () => {
    const inputStyles = readFileSync(resolve(__dirname, '../src/renderer/src/styles/ai-panel-composer-input.less'), 'utf8')
    const popupStyles = readFileSync(resolve(__dirname, '../src/renderer/src/styles/ai-panel-composer-select-popups.less'), 'utf8')

    expect(inputStyles).toMatch(/\.chat-input\.popup-open\s*\{[^}]*z-index:\s*45;[^}]*isolation:\s*isolate;/s)
    expect(inputStyles).toMatch(/\.app-shell\.has-app-background \.select-popup\s*\{[^}]*background:\s*var\(--theme-module-active-modal-bg\);/s)
    expect(popupStyles).toMatch(/\.select-popup\s*\{[^}]*pointer-events:\s*auto;/s)
    expect(popupStyles).toMatch(/\.context-select-popup \.context-option-row\s*\{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\) fit-content\(44%\);/s)
    expect(popupStyles).toMatch(/\.context-select-popup \.context-option-tail\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*flex-end;/s)
    expect(popupStyles).toMatch(/\.context-select-popup \.context-option-tail svg\s*\{[^}]*flex:\s*0 0 16px;/s)
  })
})
