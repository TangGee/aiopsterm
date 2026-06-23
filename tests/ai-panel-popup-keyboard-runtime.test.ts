import { describe, expect, it, vi } from 'vitest'
import { createAiPanelPopupKeyboardRuntime } from '@/services/ai/aiPanelPopupKeyboardRuntime'
import type { AiCommandCatalogOption, AiContextOption } from '@shared/contracts/aiChat'

const host = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'hosts',
  ...input
})

const command = (input: Partial<AiCommandCatalogOption> & Pick<AiCommandCatalogOption, 'id' | 'name' | 'command'>): AiCommandCatalogOption => ({
  label: input.name,
  path: `${input.id}.md`,
  ...input
})

const keyEvent = (key = 'Enter') => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as KeyboardEvent

const createHarness = () => {
  const prod = host({ id: 'prod', label: '10.0.0.8' })
  const rollback = command({ id: 'rollback', name: 'rollback', command: '/rollback' })
  const calls = {
    handleMainEditableKeydown: vi.fn(),
    handleEditEditableKeydown: vi.fn(),
    handleContextKeydown: vi.fn(),
    handlePanelKeydown: vi.fn(),
    handleCommandKeydown: vi.fn(),
    handleContextQueryChanged: vi.fn(),
    applyContext: vi.fn(),
    applyCommand: vi.fn(),
    handleSend: vi.fn(),
    confirmMessageEdit: vi.fn(),
    cancelMessageEdit: vi.fn(),
    shouldTriggerMainCommandPopupForPendingSlash: vi.fn(() => true),
    shouldTriggerEditCommandPopupForPendingSlash: vi.fn(() => false),
    shouldTriggerMainCommandPopupForSlash: vi.fn(() => true),
    shouldTriggerEditCommandPopupForSlash: vi.fn(() => false),
    mainCharBeforeCaret: vi.fn(() => '/'),
    editCharBeforeCaret: vi.fn(() => '@'),
    shouldTriggerCommandPopupFromEditableText: vi.fn(() => true)
  }
  const runtime = createAiPanelPopupKeyboardRuntime({
    popupInteractionRuntime: calls,
    displayedOpenedHosts: () => [prod],
    visibleContextCategories: () => [{ id: 'hosts', label: 'Hosts', options: [prod], icon: 'host-icon' }],
    filteredContextOptions: () => [prod],
    filteredCommands: () => [rollback],
    applyContext: calls.applyContext,
    applyCommand: calls.applyCommand,
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
    chatSearchOpen: () => true
  })
  return {
    calls,
    prod,
    rollback,
    runtime
  }
}

describe('aiPanelPopupKeyboardRuntime', () => {
  it('builds popup keyboard input from injected view state and target-specific caret predicates', () => {
    const { calls, prod, rollback, runtime } = createHarness()

    const input = runtime.popupEditableKeydownInput()
    expect(input.displayedOpenedHosts).toEqual([prod])
    expect(input.visibleContextCategories.map((category) => category.id)).toEqual(['hosts'])
    expect(input.filteredContextOptions).toEqual([prod])
    expect(input.filteredCommands).toEqual([rollback])
    expect(input.shouldTriggerCommandPopupForPendingSlash('main')).toBe(true)
    expect(input.shouldTriggerCommandPopupForPendingSlash('edit')).toBe(false)
    expect(input.shouldTriggerCommandPopupForSlash('main')).toBe(true)
    expect(input.shouldTriggerCommandPopupForSlash('edit')).toBe(false)
    expect(input.getCharBeforeCaret('main')).toBe('/')
    expect(input.getCharBeforeCaret('edit')).toBe('@')
    expect(input.shouldTriggerCommandPopupFromEditableText()).toBe(true)

    input.applyContext(prod)
    input.applyCommand(rollback)
    input.handleSend()
    input.confirmMessageEdit()
    input.cancelMessageEdit()
    expect(calls.applyContext).toHaveBeenCalledWith(prod)
    expect(calls.applyCommand).toHaveBeenCalledWith(rollback)
    expect(calls.handleSend).toHaveBeenCalled()
    expect(calls.confirmMessageEdit).toHaveBeenCalled()
    expect(calls.cancelMessageEdit).toHaveBeenCalled()
  })

  it('delegates editable, context, command, panel, and query handlers to popup interaction runtime', () => {
    const { calls, runtime } = createHarness()
    const event = keyEvent()

    runtime.handleEditableKeydown(event)
    expect(calls.handleMainEditableKeydown).toHaveBeenCalledWith(event, expect.objectContaining({ filteredCommands: expect.any(Array) }))

    runtime.handleEditEditableKeydown(event)
    expect(calls.handleEditEditableKeydown).toHaveBeenCalledWith(event, expect.objectContaining({ filteredContextOptions: expect.any(Array) }))

    runtime.handleContextKeydown(event)
    expect(calls.handleContextKeydown).toHaveBeenCalledWith(event, expect.objectContaining({ displayedOpenedHosts: expect.any(Array) }))

    runtime.handleCommandKeydown(event)
    expect(calls.handleCommandKeydown).toHaveBeenCalledWith(event, expect.objectContaining({ filteredCommands: expect.any(Array) }))

    runtime.handlePanelKeydown(event)
    expect(calls.handlePanelKeydown).toHaveBeenCalledWith(event, { aiPanelMode: 'classic', chatSearchOpen: true })

    runtime.handleContextQueryChanged()
    expect(calls.handleContextQueryChanged).toHaveBeenCalled()
  })
})
