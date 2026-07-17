import { describe, expect, it, vi } from 'vitest'
import { createAiPanelContextCommandShellRuntime } from '@/services/ai/aiPanelContextCommandShellRuntime'
import { createEmptyAiPanelPopupInteractionState } from '@/services/ai/aiPanelPopupInteractionRuntime'
import type { AiChipContentPart } from '@/stores/workspace'
import type { AiCommandCatalogOption, AiContextOption } from '@shared/contracts/aiChat'

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
  }) as unknown as KeyboardEvent

const createHarness = () => {
  const state = createEmptyAiPanelPopupInteractionState()
  const prod = host({ id: 'prod', label: '10.0.0.8' })
  const runbook = doc({ id: 'runbook', label: 'Runbook.md' })
  const rollback = command({ id: 'rollback', name: 'Rollback', command: '/rollback' })
  const store = {
    draft: 'deploy /',
    mainContexts: [] as AiContextOption[],
    editHostContexts: [] as AiContextOption[],
    visibleHostContexts: [host({ id: 'local', label: '127.0.0.1', isLocalShell: true }), prod],
    editCommandTarget: document.createElement('div') as HTMLElement | null
  }
  const calls = {
    saveSelection: vi.fn(),
    focusInputForTarget: vi.fn(),
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
    closeChatSearch: vi.fn(),
    removeMainTriggerToken: vi.fn(),
    removeEditTriggerToken: vi.fn(),
    insertContextAtEditCursor: vi.fn(),
    insertCommandAtEditCursor: vi.fn((_target: HTMLElement | null, _part: AiChipContentPart) => true),
    restoreEditSelection: vi.fn(),
    selectCommandPreset: vi.fn(),
    renderEditableFromState: vi.fn(),
    moveMainCaretToEnd: vi.fn(),
    handleSend: vi.fn(),
    confirmMessageEdit: vi.fn(),
    cancelMessageEdit: vi.fn(),
    shouldTriggerMainCommandPopupForPendingSlash: vi.fn(() => true),
    shouldTriggerEditCommandPopupForPendingSlash: vi.fn(() => true),
    shouldTriggerMainCommandPopupForSlash: vi.fn(() => true),
    shouldTriggerEditCommandPopupForSlash: vi.fn(() => true),
    mainCharBeforeCaret: vi.fn(() => '/'),
    editCharBeforeCaret: vi.fn(() => '/'),
    shouldTriggerCommandPopupFromEditableText: vi.fn(() => true)
  }
  const runtime = createAiPanelContextCommandShellRuntime({
    state,
    maxHostContexts: 2,
    saveSelection: calls.saveSelection,
    focusInputForTarget: calls.focusInputForTarget,
    refreshAiContextCatalog: calls.refreshAiContextCatalog,
    refreshAiCommandCatalog: calls.refreshAiCommandCatalog,
    afterDomUpdate: calls.afterDomUpdate,
    defer: calls.defer,
    closeModeMenu: calls.closeModeMenu,
    closeModelMenu: calls.closeModelMenu,
    closeCodexTargetPicker: calls.closeCodexTargetPicker,
    closeMoreActionsMenu: calls.closeMoreActionsMenu,
    closePanelModeMenu: calls.closePanelModeMenu,
    closeHistoryMenu: calls.closeHistoryMenu,
    openChatSearch: calls.openChatSearch,
    closeChatSearch: calls.closeChatSearch,
    editingMessageId: () => null,
    draft: () => store.draft,
    mainContexts: () => store.mainContexts,
    editHostContexts: () => store.editHostContexts,
    visibleHostContexts: () => store.visibleHostContexts,
    editCommandTarget: () => store.editCommandTarget,
    setMainContexts: (contexts) => {
      store.mainContexts = contexts
    },
    setEditHostContexts: (contexts) => {
      store.editHostContexts = contexts
    },
    removeMainTriggerToken: calls.removeMainTriggerToken,
    removeEditTriggerToken: calls.removeEditTriggerToken,
    insertContextAtEditCursor: calls.insertContextAtEditCursor,
    insertCommandAtEditCursor: calls.insertCommandAtEditCursor,
    restoreEditSelection: calls.restoreEditSelection,
    selectCommandPreset: calls.selectCommandPreset,
    setDraft: (value) => {
      store.draft = value
    },
    renderEditableFromState: calls.renderEditableFromState,
    moveMainCaretToEnd: calls.moveMainCaretToEnd,
    requestFrame: (callback) => {
      callback()
      return 1
    },
    displayedOpenedHosts: () => [prod],
    visibleContextCategories: () => [{ id: 'docs', label: 'Docs', options: [runbook], icon: 'docs-icon' }],
    filteredContextOptions: () => [runbook],
    filteredCommands: () => [rollback],
    handleSend: calls.handleSend,
    confirmMessageEdit: calls.confirmMessageEdit,
    cancelMessageEdit: calls.cancelMessageEdit,
    shouldTriggerMainCommandPopupForPendingSlash: calls.shouldTriggerMainCommandPopupForPendingSlash,
    shouldTriggerEditCommandPopupForPendingSlash: calls.shouldTriggerEditCommandPopupForPendingSlash,
    shouldTriggerMainCommandPopupForSlash: calls.shouldTriggerMainCommandPopupForSlash,
    shouldTriggerEditCommandPopupForSlash: calls.shouldTriggerEditCommandPopupForSlash,
    mainCharBeforeCaret: calls.mainCharBeforeCaret,
    editCharBeforeCaret: calls.editCharBeforeCaret,
    shouldTriggerCommandPopupFromEditableText: calls.shouldTriggerCommandPopupFromEditableText,
    aiPanelMode: () => 'classic',
    chatSearchOpen: () => false
  })
  return {
    calls,
    prod,
    rollback,
    runbook,
    runtime,
    state,
    store
  }
}

describe('aiPanelContextCommandShellRuntime', () => {
  it('composes popup interaction refs, context application, and close-all menu coordination', () => {
    const { calls, prod, runtime, state, store } = createHarness()

    runtime.openContextPopupForTarget('edit', 'docs')
    expect(state).toMatchObject({ contextPopupOpen: true, contextTarget: 'edit', contextLevel: 'docs' })
    expect(calls.saveSelection).toHaveBeenCalledWith('edit')
    expect(calls.refreshAiContextCatalog).toHaveBeenCalled()

    runtime.applyContext(prod)
    expect(calls.removeEditTriggerToken).toHaveBeenCalledWith('@')
    expect(store.editHostContexts.map((context) => context.id)).toEqual(['prod'])
    expect(state.contextPopupOpen).toBe(false)
    expect(calls.focusInputForTarget).toHaveBeenCalledWith('edit')

    runtime.openContextPopup()
    expect(state.contextTarget).toBe('main')
    runtime.applyContext(prod)
    expect(state.contextPopupOpen).toBe(false)
    expect(calls.focusInputForTarget).toHaveBeenCalledWith('main')

    runtime.openContextPopup('hosts')
    runtime.applyContext(prod)
    expect(state.contextPopupOpen).toBe(true)
    expect(store.mainContexts).toEqual([])

    runtime.selectAllVisibleHostContexts()
    expect(store.mainContexts.map((context) => context.id)).toEqual(['prod'])
    expect(calls.renderEditableFromState).toHaveBeenCalled()
    expect(calls.moveMainCaretToEnd).toHaveBeenCalled()
    expect(runtime.isContextSelectedForPopup(prod)).toBe(true)

    runtime.closePopups()
    expect(calls.closeCodexTargetPicker).toHaveBeenCalled()
    expect(calls.closeMoreActionsMenu).toHaveBeenCalled()
    expect(calls.closePanelModeMenu).toHaveBeenCalled()
    expect(calls.closeHistoryMenu).toHaveBeenCalled()
    expect(calls.closeModelMenu).toHaveBeenCalled()
  })

  it('composes command application and keyboard handlers through one shell boundary', async () => {
    const { calls, rollback, runtime, state, store } = createHarness()

    await runtime.openCommandPopupForTarget('main')
    expect(state.commandPopupOpen).toBe(true)
    expect(calls.refreshAiCommandCatalog).toHaveBeenCalled()

    runtime.applyCommand(rollback)
    expect(calls.selectCommandPreset).toHaveBeenCalledWith('rollback', {
      command: '/rollback',
      label: 'Rollback',
      path: 'rollback.md'
    })
    expect(store.draft).toBe('deploy ')

    await runtime.openCommandPopupForTarget('edit')
    runtime.handleCommandKeydown(keyEvent('ArrowDown'))
    expect(state.commandKeyboardIndex).toBe(0)
    runtime.handleCommandKeydown(keyEvent('Enter'))
    expect(calls.restoreEditSelection).toHaveBeenCalled()
    expect(calls.insertCommandAtEditCursor).toHaveBeenCalledWith(
      store.editCommandTarget,
      expect.objectContaining({ chipType: 'command' })
    )

    runtime.handleEditableKeydown(keyEvent('Enter'))
    expect(calls.handleSend).toHaveBeenCalled()

    runtime.handlePanelKeydown(keyEvent('f', { metaKey: true }))
    expect(calls.openChatSearch).toHaveBeenCalled()

    state.contextKeyboardIndex = 3
    runtime.handleContextQueryChanged()
    expect(state.contextKeyboardIndex).toBe(-1)
  })
})
