import { describe, expect, it } from 'vitest'
import {
  createAiPanelContextCommandRuntime,
  type AiPanelContextCommandRuntimeOptions
} from '@/services/ai/aiPanelContextCommandRuntime'
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

const createHarness = (overrides: Partial<AiPanelContextCommandRuntimeOptions> = {}) => {
  const state = {
    contextTarget: 'main' as 'main' | 'edit',
    commandTarget: 'main' as 'main' | 'edit',
    editingMessageId: null as string | null,
    draft: 'deploy /',
    mainContexts: [] as AiContextOption[],
    editHostContexts: [] as AiContextOption[],
    visibleHostContexts: [host({ id: 'local', label: '127.0.0.1', isLocalShell: true }), host({ id: 'prod', label: '10.0.0.8' })],
    editCommandTarget: document.createElement('div') as HTMLElement | null
  }
  const calls = {
    enteredDocs: [] as string[],
    closedContext: [] as Array<{ restoreFocus?: boolean } | undefined>,
    closedCommand: [] as Array<{ restoreFocus?: boolean } | undefined>,
    removedMainTokens: [] as string[],
    removedEditTokens: [] as string[],
    insertedEditContexts: [] as string[],
    insertedEditCommands: [] as AiChipContentPart[],
    restoredEditSelection: 0,
    selectedCommands: [] as Array<{ id: string; commandRef: { command: string; label: string; path: string } }>,
    renderedMain: 0,
    movedMainCaret: 0,
    frameCount: 0
  }
  const runtime = createAiPanelContextCommandRuntime({
    maxHostContexts: 2,
    contextTarget: () => state.contextTarget,
    commandTarget: () => state.commandTarget,
    editingMessageId: () => state.editingMessageId,
    draft: () => state.draft,
    mainContexts: () => state.mainContexts,
    editHostContexts: () => state.editHostContexts,
    visibleHostContexts: () => state.visibleHostContexts,
    editCommandTarget: () => state.editCommandTarget,
    setMainContexts: (contexts) => {
      state.mainContexts = contexts
    },
    setEditHostContexts: (contexts) => {
      state.editHostContexts = contexts
    },
    enterDocsDir: (context) => {
      calls.enteredDocs.push(context.id)
    },
    closeContextPopup: (options) => {
      calls.closedContext.push(options)
    },
    closeCommandPopup: (options) => {
      calls.closedCommand.push(options)
    },
    removeMainTriggerToken: (token) => {
      calls.removedMainTokens.push(token)
    },
    removeEditTriggerToken: (token) => {
      calls.removedEditTokens.push(token)
    },
    insertContextAtEditCursor: (context) => {
      calls.insertedEditContexts.push(context.id)
      return true
    },
    insertCommandAtEditCursor: (_target, part) => {
      calls.insertedEditCommands.push(part)
      return true
    },
    restoreEditSelection: () => {
      calls.restoredEditSelection += 1
    },
    selectCommandPreset: (id, commandRef) => {
      calls.selectedCommands.push({ id, commandRef })
    },
    setDraft: (value) => {
      state.draft = value
    },
    renderEditableFromState: () => {
      calls.renderedMain += 1
    },
    moveMainCaretToEnd: () => {
      calls.movedMainCaret += 1
    },
    requestFrame: (callback) => {
      calls.frameCount += 1
      callback()
      return calls.frameCount
    },
    ...overrides
  })
  return { calls, runtime, state }
}

describe('aiPanelContextCommandRuntime', () => {
  it('selects and clears visible host contexts for main and edit targets', () => {
    const { calls, runtime, state } = createHarness()

    runtime.selectAllVisibleHostContexts()
    expect(state.mainContexts.map((context) => context.id)).toEqual(['prod'])
    expect(calls.renderedMain).toBe(1)
    expect(calls.movedMainCaret).toBe(1)

    runtime.clearHostContexts()
    expect(state.mainContexts).toEqual([])
    expect(calls.renderedMain).toBe(2)
    expect(calls.movedMainCaret).toBe(2)

    state.contextTarget = 'edit'
    runtime.selectAllVisibleHostContexts()
    expect(state.editHostContexts.map((context) => context.id)).toEqual(['prod'])
    runtime.clearHostContexts()
    expect(state.editHostContexts).toEqual([])
  })

  it('applies context plans through injected main/edit side effects', () => {
    const { calls, runtime, state } = createHarness()
    const prod = host({ id: 'prod', label: '10.0.0.8' })
    const runbook = doc({ id: 'runbook', label: 'Runbook.md' })
    const dir = doc({ id: 'dir', label: 'commands', contextType: 'dir', relPath: 'commands' })

    runtime.applyContext(dir)
    expect(calls.enteredDocs).toEqual(['dir'])

    runtime.applyContext(prod)
    expect(calls.removedMainTokens).toEqual(['@'])
    expect(state.mainContexts.map((context) => context.id)).toEqual(['prod'])
    expect(calls.closedContext).toEqual([])

    runtime.applyContext(runbook)
    expect(state.mainContexts.map((context) => context.id)).toEqual(['prod', 'runbook'])
    expect(calls.closedContext.at(-1)).toEqual({ restoreFocus: true })

    state.contextTarget = 'edit'
    runtime.applyContext(prod)
    expect(calls.removedEditTokens).toEqual(['@'])
    expect(state.editHostContexts.map((context) => context.id)).toEqual(['prod'])
    expect(runtime.isContextSelectedForPopup(prod)).toBe(true)

    runtime.applyContext(runbook)
    expect(calls.insertedEditContexts).toEqual(['runbook'])
    expect(calls.closedContext.at(-1)).toEqual({ restoreFocus: true })
  })

  it('applies command plans through edit chips or selected main command state', () => {
    const { calls, runtime, state } = createHarness()
    const rollback = command({ id: 'rollback', name: 'Rollback', command: '/rollback' })

    runtime.applyCommand(rollback)
    expect(calls.selectedCommands).toEqual([
      {
        id: 'rollback',
        commandRef: { command: '/rollback', label: 'Rollback', path: 'rollback.md' }
      }
    ])
    expect(calls.closedCommand).toEqual([undefined])
    expect(state.draft).toBe('deploy ')
    expect(calls.movedMainCaret).toBe(1)

    state.commandTarget = 'edit'
    runtime.applyCommand(rollback)
    expect(calls.restoredEditSelection).toBe(1)
    expect(calls.insertedEditCommands[0]).toEqual({
      type: 'chip',
      chipType: 'command',
      ref: { command: '/rollback', label: 'Rollback', path: 'rollback.md' }
    })
    expect(calls.closedCommand.at(-1)).toEqual({ restoreFocus: true })
  })
})
