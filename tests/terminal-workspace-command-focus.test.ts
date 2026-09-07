import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalWorkspaceCommandRuntime,
  createTerminalWorkspaceCommandState
} from '@/services/terminal/terminalWorkspaceCommandRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'

const createRuntime = () => {
  const state = createTerminalWorkspaceCommandState()
  const workspace = {
    activePanelId: 'panel-1',
    panels: [{ id: 'panel-1', kind: 'terminal' }],
    extensionSettings: { autoCompleteStatus: false },
    terminalCommandModelOptions: [],
    selectPanelForLifecycle: vi.fn()
  } as unknown as ReturnType<typeof useWorkspaceStore>
  const focusPanel = vi.fn()
  const menu = { visible: false, panelId: 'panel-1' }
  const termMenu = { visible: true, panelId: 'panel-1' }
  const scope = effectScope()
  const runtime = scope.run(() => createTerminalWorkspaceCommandRuntime({
    workspace, state, menu, termMenu,
    aiButtonPanelId: ref(''),
    activeView: () => undefined,
    estimateTerminalCellSize: () => ({ width: 8, height: 16, hostWidth: 800, hostHeight: 600 }),
    focusActivePanel: vi.fn(),
    focusPanel,
    getTerminalElement: () => null,
    syncTerminalView: vi.fn(),
    terminalViews: new Map(),
    updateSuggestionsPosition: vi.fn()
  }))!
  return { runtime, state, focusPanel, scope, menu, termMenu }
}

describe('terminal menu command focus', () => {
  it('focuses broadcast input when enabled and the terminal after it is disabled', async () => {
    const { runtime, state, focusPanel, scope, termMenu } = createRuntime()
    const input = document.createElement('input')
    document.body.append(input)
    state.globalCommandInput.value = input
    try {
      runtime.toggleGlobalInput()
      await nextTick()
      expect(termMenu.visible).toBe(false)
      expect(document.activeElement).toBe(input)
      expect(focusPanel).not.toHaveBeenCalled()
      runtime.toggleGlobalInput()
      input.remove()
      await nextTick()
      expect(focusPanel).toHaveBeenCalledWith('panel-1')
    } finally {
      input.remove()
      scope.stop()
    }
  })

  it('does not take focus from another input when broadcast input is disabled', async () => {
    const { runtime, state, focusPanel, scope } = createRuntime()
    const input = document.createElement('input')
    document.body.append(input)
    try {
      state.globalInputVisible.value = true
      runtime.toggleGlobalInput()
      input.focus()
      await nextTick()
      expect(focusPanel).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(input)
    } finally {
      input.remove()
      scope.stop()
    }
  })

  it('gives command-line input focus instead of returning it to the terminal', async () => {
    const { runtime, state, focusPanel, scope, termMenu } = createRuntime()
    const input = document.createElement('input')
    document.body.append(input)
    state.commandLineInput.value = input
    try {
      runtime.openCommandLineFromMenu()
      await nextTick()
      expect(termMenu.visible).toBe(false)
      expect(document.activeElement).toBe(input)
      expect(focusPanel).not.toHaveBeenCalled()
    } finally {
      input.remove()
      scope.stop()
    }
  })
})
