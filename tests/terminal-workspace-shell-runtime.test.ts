import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalWorkspaceShellRuntime,
  createTerminalWorkspaceShellState
} from '@/services/terminalWorkspaceShellRuntime'
import type { ClipboardTextReadResult } from '@/services/clipboardRuntime'
import type { TerminalView } from '@/services/terminalWorkspaceViewRuntime'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

const createPanel = (patch: Partial<TerminalPanel> = {}): TerminalPanel => ({
  id: 'panel-1',
  title: 'Local',
  cwd: '~',
  output: 'existing output',
  outputSegments: [],
  status: 'ready',
  kind: 'terminal',
  ...patch
})

const createMouseEvent = (patch: Partial<MouseEvent> = {}) => ({
  button: 0,
  clientX: 120,
  clientY: 80,
  ctrlKey: false,
  metaKey: false,
  preventDefault: vi.fn(),
  ...patch
}) as unknown as MouseEvent

const createKeyboardEvent = (patch: Partial<KeyboardEvent> = {}) => ({
  key: '',
  ctrlKey: false,
  metaKey: false,
  preventDefault: vi.fn(),
  ...patch
}) as unknown as KeyboardEvent

const createTerminalView = (selection = '') => ({
  terminal: {
    clear: vi.fn(),
    clearSelection: vi.fn(),
    getSelection: vi.fn(() => selection)
  },
  lastOutput: 'existing output'
}) as unknown as TerminalView

const createWorkspace = (panel = createPanel()) => {
  const panels = [panel]
  const workspace = {
    activePanelId: panel.id,
    canForkSshPanel: vi.fn(() => false),
    closeAllPanels: vi.fn(),
    closeOthers: vi.fn(),
    closePanel: vi.fn((panelId: string) => {
      const target = panels.find((item) => item.id === panelId)
      if (target) target.status = 'closed'
    }),
    createPanel: vi.fn((direction?: 'right' | 'below') => {
      const next = createPanel({
        id: `panel-${panels.length + 1}`,
        title: `Panel ${panels.length + 1}`,
        split: direction
      })
      panels.push(next)
      workspace.activePanelId = next.id
      return next
    }),
    discardPendingTerminalPanel: vi.fn(),
    ensureFileSessionForTerminalPanel: vi.fn(async () => undefined),
    forkSshPanel: vi.fn(),
    panels,
    renamePanel: vi.fn((panelId: string, title: string) => {
      const target = panels.find((item) => item.id === panelId)
      if (target) target.title = title
    }),
    replaceTerminalOutput: vi.fn((panelId: string, output: string) => {
      const target = panels.find((item) => item.id === panelId)
      if (target) target.output = output
    }),
    rightPanelOpen: false,
    runTerminalCommand: vi.fn(async () => ({ status: 'allow' as const })),
    selectedContexts: [] as Array<{ id: string; kind: string; label: string; detail?: string }>,
    sendChat: vi.fn(async () => undefined),
    setTopNotice: vi.fn(),
    terminalSettings: {
      middleMouseEvent: 'contextMenu',
      pinchZoomStatus: true,
      rightMouseEvent: 'contextMenu'
    },
    unsplitPanel: vi.fn()
  }
  return workspace as unknown as WorkspaceStore
}

const createRuntime = (options: {
  copyToClipboard?: (text: string) => Promise<boolean>
  readClipboard?: () => Promise<ClipboardTextReadResult>
  selection?: string
  workspace?: WorkspaceStore
} = {}) => {
  const state = createTerminalWorkspaceShellState()
  const workspace = options.workspace ?? createWorkspace()
  const terminalView = createTerminalView(options.selection ?? '')
  const terminalViews = new Map<string, TerminalView>([[workspace.activePanelId, terminalView]])
  const calls = {
    closeCommandDialog: vi.fn(),
    closeSearchOverlay: vi.fn(),
    disconnectTerminalPanel: vi.fn(async () => true),
    focusActivePanel: vi.fn(),
    focusCommandDialogInput: vi.fn(),
    focusPanel: vi.fn(),
    getCommandDialogInput: vi.fn(() => null as HTMLTextAreaElement | null),
    hideSuggestions: vi.fn(),
    openCommandDialog: vi.fn(),
    openSearchOverlay: vi.fn(),
    reconnectTerminalPanel: vi.fn(async (panel: TerminalPanel) => {
      panel.sessionId = 'session-1'
      panel.status = 'running'
      return true
    }),
    refitAfterLayoutChange: vi.fn(),
    scheduleVisibleTerminalFit: vi.fn(),
    startLocalTerminalForPanel: vi.fn(async () => true),
    startSshTerminalForPanel: vi.fn(async () => true),
    syncTerminalView: vi.fn(),
    terminalFontSizeForPanel: vi.fn(() => 12),
    updateFontSize: vi.fn(),
    updateSelectionButtonPosition: vi.fn()
  }
  const commandDialog = { visible: false, panelId: workspace.activePanelId }
  const runtime = createTerminalWorkspaceShellRuntime(
    {
      workspace,
      state,
      terminalViews,
      searchOverlayPanelId: ref(''),
      commandDialog,
      ...calls
    },
    {
      afterDomUpdate: vi.fn(async () => undefined),
      copyToClipboard: options.copyToClipboard ?? vi.fn(async () => true),
      getViewportSize: () => ({ innerWidth: 300, innerHeight: 260 }),
      readClipboard: options.readClipboard ?? vi.fn(async (): Promise<ClipboardTextReadResult> => ({ ok: true, text: 'pwd\n' }))
    }
  )
  return { calls, commandDialog, runtime, state, terminalView, terminalViews, workspace }
}

describe('terminalWorkspaceShellRuntime', () => {
  it('owns floating menu state, pointer policies, and tab rename actions', async () => {
    const { calls, runtime, state, workspace } = createRuntime()

    runtime.openMenu(createMouseEvent({ clientX: 999, clientY: 999 }), 'panel-1')
    expect(state.menu.visible).toBe(true)
    expect(state.menu.x).toBe(138)
    expect(state.menu.y).toBe(8)

    await runtime.handleTerminalContextMenu('panel-1', createMouseEvent({ clientX: 999, clientY: 999 }))
    expect(workspace.activePanelId).toBe('panel-1')
    expect(calls.hideSuggestions).toHaveBeenCalledTimes(1)
    expect(state.termMenu.visible).toBe(true)
    expect(state.termMenu.x).toBe(78)
    expect(state.menu.visible).toBe(false)

    runtime.closeTerminalMenusFromDocument()
    expect(state.menu.visible).toBe(false)
    expect(state.termMenu.visible).toBe(false)

    workspace.terminalSettings.middleMouseEvent = 'closeTab'
    const mouseDown = createMouseEvent({ button: 1 })
    await runtime.handleTerminalMouseDown('panel-1', mouseDown)
    expect(mouseDown.preventDefault).toHaveBeenCalledTimes(1)
    expect(workspace.closePanel).toHaveBeenCalledWith('panel-1')

    runtime.startRename('panel-1', 'Local')
    state.renameText.value = 'Renamed'
    runtime.finishRename()
    expect(workspace.renamePanel).toHaveBeenCalledWith('panel-1', 'Renamed')
    expect(state.renamingId.value).toBe('')
  })

  it('owns terminal copy, paste, clear, font, and selection-to-AI shell actions', async () => {
    const { calls, runtime, state, terminalView, workspace } = createRuntime({
      selection: 'selected output',
      copyToClipboard: vi.fn(async () => true)
    })
    state.menu.visible = true
    state.termMenu.visible = true

    await runtime.copySelection('panel-1')
    expect(workspace.setTopNotice).toHaveBeenCalledWith('终端内容已复制')
    expect(state.menu.visible).toBe(false)
    expect(state.termMenu.visible).toBe(false)

    await runtime.pasteClipboard('panel-1')
    expect(workspace.runTerminalCommand).toHaveBeenCalledWith('panel-1', 'pwd\n', {
      inputText: 'pwd\n',
      shellText: 'pwd\n',
      writeToShell: true,
      source: 'direct'
    })
    expect(calls.syncTerminalView).toHaveBeenCalledWith(workspace.panels[0])

    runtime.clearTerminal('panel-1')
    expect(workspace.replaceTerminalOutput).toHaveBeenCalledWith('panel-1', '')
    expect(terminalView.terminal.clear).toHaveBeenCalledTimes(1)
    expect(terminalView.lastOutput).toBe('')

    runtime.handleTerminalWheel('panel-1', createMouseEvent({ ctrlKey: true, deltaY: -1 } as Partial<WheelEvent>) as WheelEvent)
    runtime.handleTerminalWheel('panel-1', createMouseEvent({ ctrlKey: true, deltaY: 1 } as Partial<WheelEvent>) as WheelEvent)
    expect(calls.updateFontSize).toHaveBeenNthCalledWith(1, 'panel-1', 13)
    expect(calls.updateFontSize).toHaveBeenNthCalledWith(2, 'panel-1', 11)

    state.aiButtonPanelId.value = 'panel-1'
    runtime.chatSelectionToAi('panel-1')
    expect(workspace.rightPanelOpen).toBe(true)
    expect(workspace.selectedContexts).toEqual([
      { id: 'terminal-panel-1', kind: 'hosts', label: 'Terminal selection: selected output' }
    ])
    expect(workspace.sendChat).toHaveBeenCalledWith('Terminal output:\n```\nselected output\n```', undefined, undefined, { skipKnowledgeSearch: true })
    expect(terminalView.terminal.clearSelection).toHaveBeenCalledTimes(1)
    expect(state.aiButtonPanelId.value).toBe('')
  })

  it('owns keyboard shortcuts and clipboard read fallback notices', async () => {
    const { calls, commandDialog, runtime, state, workspace } = createRuntime({
      readClipboard: vi.fn(async (): Promise<ClipboardTextReadResult> => ({ ok: false, error: 'unavailable', message: 'missing bridge' }))
    })
    state.menu.visible = true
    state.termMenu.visible = true

    const searchShortcut = createKeyboardEvent({ ctrlKey: true, key: 'f' })
    await runtime.handleShortcut(searchShortcut)
    expect(searchShortcut.preventDefault).toHaveBeenCalledTimes(1)
    expect(calls.openSearchOverlay).toHaveBeenCalledWith('panel-1')

    await runtime.pasteClipboard('panel-1')
    expect(workspace.setTopNotice).toHaveBeenCalledWith('终端剪贴板读取服务不可用')

    const commandShortcut = createKeyboardEvent({ ctrlKey: true, key: 'k' })
    await runtime.handleShortcut(commandShortcut)
    expect(calls.openCommandDialog).toHaveBeenCalledWith('panel-1')

    commandDialog.visible = true
    await runtime.handleShortcut(createKeyboardEvent({ ctrlKey: true, key: 'k' }))
    expect(calls.focusCommandDialogInput).toHaveBeenCalledTimes(1)

    await runtime.handleShortcut(createKeyboardEvent({ ctrlKey: true, key: 'l' }))
    expect(workspace.replaceTerminalOutput).toHaveBeenCalledWith('panel-1', '')

    await runtime.handleShortcut(createKeyboardEvent({ ctrlKey: true, key: 'm' }))
    expect(workspace.ensureFileSessionForTerminalPanel).toHaveBeenCalledWith('panel-1')

    await runtime.handleShortcut(createKeyboardEvent({ key: 'Escape' }))
    expect(state.menu.visible).toBe(false)
    expect(state.termMenu.visible).toBe(false)
    expect(calls.closeSearchOverlay).toHaveBeenCalledTimes(1)
    expect(calls.closeCommandDialog).toHaveBeenCalledTimes(1)
    expect(calls.hideSuggestions).toHaveBeenCalled()
  })
})
