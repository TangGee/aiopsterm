import { describe, expect, it, vi } from 'vitest'
import {
  createAiPanelPopupInteractionRuntime,
  createEmptyAiPanelPopupInteractionState
} from '@/services/ai/aiPanelPopupInteractionRuntime'
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

const command = (input: Partial<AiCommandCatalogOption> & Pick<AiCommandCatalogOption, 'id' | 'name' | 'command'>): AiCommandCatalogOption => ({
  label: input.name,
  path: `${input.id}.md`,
  ...input
})

const keyEvent = (key: string, input: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    isComposing: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...input
  }) as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }

const createHarness = () => {
  const state = createEmptyAiPanelPopupInteractionState()
  const calls = {
    saveSelection: vi.fn(),
    focusInputForTarget: vi.fn(),
    focusContextSearchInput: vi.fn(),
    focusCommandSearchInput: vi.fn(),
    refreshAiContextCatalog: vi.fn(async () => true),
    refreshAiCommandCatalog: vi.fn(async () => true),
    afterDomUpdate: vi.fn(async () => true),
    defer: vi.fn((callback: () => void) => callback()),
    closeModeMenu: vi.fn(),
    closeModelMenu: vi.fn(),
    closeCodexTargetPicker: vi.fn(),
    closeMoreActionsMenu: vi.fn(),
    closePanelModeMenu: vi.fn(),
    closeHistoryMenu: vi.fn(),
    openChatSearch: vi.fn(),
    closeChatSearch: vi.fn()
  }
  const runtime = createAiPanelPopupInteractionRuntime({
    state,
    ...calls
  })
  return {
    calls,
    runtime,
    state
  }
}

const contextInput = (input: Partial<Parameters<ReturnType<typeof createAiPanelPopupInteractionRuntime>['handleContextKeydown']>[1]> = {}) => {
  const prod = host({ id: 'prod', label: '10.0.0.8' })
  const docsCategory: AiContextCategoryInfo = { id: 'docs', label: 'Docs', options: [] }
  return {
    displayedOpenedHosts: [prod],
    visibleContextCategories: [docsCategory],
    filteredContextOptions: [doc({ id: 'runbook', label: 'Runbook.md' })],
    applyContext: vi.fn(),
    ...input
  }
}

const commandInput = (input: Partial<Parameters<ReturnType<typeof createAiPanelPopupInteractionRuntime>['handleCommandKeydown']>[1]> = {}) => ({
  filteredCommands: [command({ id: 'rollback', name: 'rollback', command: '/rollback' })],
  applyCommand: vi.fn(),
  ...input
})

const editableInput = (
  input: Partial<Parameters<ReturnType<typeof createAiPanelPopupInteractionRuntime>['handleMainEditableKeydown']>[1]> = {}
) => ({
  ...contextInput(),
  ...commandInput(),
  handleSend: vi.fn(),
  confirmMessageEdit: vi.fn(),
  cancelMessageEdit: vi.fn(),
  shouldTriggerCommandPopupForPendingSlash: vi.fn(() => true),
  shouldTriggerCommandPopupForSlash: vi.fn(() => true),
  getCharBeforeCaret: vi.fn(() => '/'),
  shouldTriggerCommandPopupFromEditableText: vi.fn(() => true),
  ...input
})

describe('aiPanelPopupInteractionRuntime', () => {
  it('opens and closes context and command popups through injected side effects', async () => {
    const { calls, runtime, state } = createHarness()

    runtime.openContextPopupForTarget('edit', 'docs')
    expect(state.contextPopupOpen).toBe(true)
    expect(state.contextTarget).toBe('edit')
    expect(state.contextLevel).toBe('docs')
    expect(calls.saveSelection).toHaveBeenCalledWith('edit')
    expect(calls.refreshAiContextCatalog).toHaveBeenCalled()

    runtime.closeContextPopup({ restoreFocus: true })
    expect(state.contextPopupOpen).toBe(false)
    expect(state.contextTarget).toBe('main')
    expect(calls.focusInputForTarget).toHaveBeenCalledWith('edit')

    await runtime.openCommandPopupForTarget('main')
    expect(state.commandPopupOpen).toBe(true)
    expect(state.commandTarget).toBe('main')
    expect(calls.refreshAiCommandCatalog).toHaveBeenCalled()
    expect(calls.focusCommandSearchInput).toHaveBeenCalled()

    runtime.closeCommandPopup({ restoreFocus: true })
    expect(state.commandPopupOpen).toBe(false)
    expect(calls.focusInputForTarget).toHaveBeenCalledWith('main')
  })

  it('navigates docs folders and returns context popup to main level', () => {
    const { runtime, state } = createHarness()
    const dir = doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands' })

    expect(runtime.enterDocsDir(dir)).toBe(true)
    expect(state.docsCurrentRelDir).toBe('commands')
    expect(state.docsDirStack).toEqual([''])

    expect(runtime.goBackDocsDir()).toBe(true)
    expect(state.docsCurrentRelDir).toBe('')

    state.contextLevel = 'skills'
    state.contextQuery = 'skill'
    state.contextKeyboardIndex = 2
    runtime.returnContextPopupToMain()
    expect(state.contextLevel).toBe('main')
    expect(state.contextQuery).toBe('')
    expect(state.contextKeyboardIndex).toBe(-1)
  })

  it('handles context and command popup keyboard navigation and selection', async () => {
    const { runtime, state } = createHarness()
    const context = contextInput()
    const commandMenu = commandInput()

    state.contextPopupOpen = true
    state.contextLevel = 'main'
    runtime.handleContextKeydown(keyEvent('ArrowDown'), context)
    expect(state.contextKeyboardIndex).toBe(0)
    runtime.handleContextKeydown(keyEvent('Enter'), context)
    expect(context.applyContext).toHaveBeenCalledWith(context.displayedOpenedHosts[0])

    state.contextLevel = 'docs'
    state.contextKeyboardIndex = -1
    runtime.handleContextKeydown(keyEvent('ArrowUp'), context)
    expect(state.contextKeyboardIndex).toBe(0)
    runtime.handleContextKeydown(keyEvent('Enter'), context)
    expect(context.applyContext).toHaveBeenCalledWith(context.filteredContextOptions[0])

    state.commandPopupOpen = true
    runtime.handleCommandKeydown(keyEvent('ArrowDown'), commandMenu)
    expect(state.commandKeyboardIndex).toBe(0)
    runtime.handleCommandKeydown(keyEvent('Enter'), commandMenu)
    expect(commandMenu.applyCommand).toHaveBeenCalledWith(commandMenu.filteredCommands[0])
  })

  it('handles main and edit editable shortcut branches', async () => {
    const { runtime, state } = createHarness()
    const input = editableInput()

    runtime.handleMainEditableKeydown(keyEvent('Enter'), input)
    expect(input.handleSend).toHaveBeenCalled()

    runtime.handleMainEditableKeydown(keyEvent('@'), input)
    expect(state.contextPopupOpen).toBe(true)
    expect(state.contextTarget).toBe('main')

    runtime.handleMainEditableKeydown(keyEvent('/'), input)
    await Promise.resolve()
    expect(state.commandPopupOpen).toBe(true)
    expect(state.commandTarget).toBe('main')

    runtime.handleEditEditableKeydown(keyEvent('@'), input)
    expect(state.contextPopupOpen).toBe(true)
    expect(state.contextTarget).toBe('edit')

    runtime.handleEditEditableKeydown(keyEvent('/'), input)
    await Promise.resolve()
    expect(state.commandPopupOpen).toBe(true)
    expect(state.commandTarget).toBe('edit')

    state.contextPopupOpen = false
    state.commandPopupOpen = false
    runtime.handleEditEditableKeydown(keyEvent('Escape'), input)
    expect(input.cancelMessageEdit).toHaveBeenCalled()
  })

  it('handles panel shortcuts for search, popup closing, and codex escape', () => {
    const { calls, runtime, state } = createHarness()

    runtime.handlePanelKeydown(keyEvent('f', { metaKey: true }), { aiPanelMode: 'classic', chatSearchOpen: false })
    expect(calls.openChatSearch).toHaveBeenCalled()

    runtime.handlePanelKeydown(keyEvent('Escape'), { aiPanelMode: 'classic', chatSearchOpen: true })
    expect(calls.closeChatSearch).toHaveBeenCalled()

    state.commandPopupOpen = true
    runtime.handlePanelKeydown(keyEvent('Escape'), { aiPanelMode: 'classic', chatSearchOpen: false })
    expect(state.commandPopupOpen).toBe(false)

    runtime.handlePanelKeydown(keyEvent('Escape'), { aiPanelMode: 'codex', chatSearchOpen: false })
    expect(calls.closeCodexTargetPicker).toHaveBeenCalled()
  })

  it('resets context keyboard index when query changes', () => {
    const { runtime, state } = createHarness()
    state.contextKeyboardIndex = 3
    runtime.handleContextQueryChanged()
    expect(state.contextKeyboardIndex).toBe(-1)
  })
})
