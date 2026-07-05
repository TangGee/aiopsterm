import { computed, nextTick, reactive, ref, type Ref } from 'vue'
import { copyTextToClipboard, readTextFromClipboard, type ClipboardTextReadResult } from '@/services/app/clipboardRuntime'
import { windowControlsClient } from '@/services/app/windowControlsClient'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'
import type { PanelDirection } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalView } from '@/services/terminal/terminalWorkspaceViewRuntime'
import {
  terminalShortcutActionForEvent,
  type TerminalShortcutAction
} from '@/services/terminal/terminalKeyboardShortcuts'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type TerminalCommandDialogState = {
  visible: boolean
  panelId: string
}

type TerminalWorkspaceShellState = ReturnType<typeof createTerminalWorkspaceShellState>

type TerminalWorkspaceShellRuntimeInput = {
  workspace: WorkspaceStore
  state: TerminalWorkspaceShellState
  terminalViews: Map<string, TerminalView>
  searchOverlayPanelId: Ref<string>
  commandDialog: TerminalCommandDialogState
  closeCommandDialog: () => void
  closeSearchOverlay: () => void
  disconnectTerminalPanel: (panel: TerminalPanel) => Promise<boolean>
  findNext: () => void
  findPrevious: () => void
  focusActivePanel: () => void
  focusCommandDialogInput: () => void
  focusPanel: (panelId: string) => void
  getCommandDialogInput: () => HTMLTextAreaElement | null
  hideSuggestions: () => void
  clearSearchFromButton: () => void
  openCommandDialog: (panelId: string) => void | Promise<void>
  openSearchOverlay: (panelId: string) => void
  reconnectTerminalPanel: (panel: TerminalPanel) => Promise<boolean>
  refitAfterLayoutChange: () => void
  scheduleVisibleTerminalFit: (options?: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean }) => void
  startLocalTerminalForPanel: (panel: TerminalPanel) => Promise<boolean>
  startSshTerminalForPanel: (panel: TerminalPanel) => Promise<boolean>
  syncTerminalView: (panel: TerminalPanel) => void
  terminalFontSizeForPanel: (panelId: string) => number
  updateFontSize: (panelId: string, fontSize: number) => void
  updateSelectionButtonPosition: (panelId: string) => void
}

type TerminalWorkspaceShellDeps = {
  afterDomUpdate?: () => void | Promise<void>
  copyToClipboard?: (text: string) => Promise<boolean>
  getViewportSize?: () => { innerWidth: number; innerHeight: number }
  readClipboard?: () => Promise<ClipboardTextReadResult>
}

export const createTerminalWorkspaceShellState = () => {
  const renamingId = ref('')
  const renameText = ref('')
  const menu = reactive({ visible: false, x: 0, y: 0, panelId: '' })
  const termMenu = reactive({ visible: false, x: 0, y: 0, panelId: '' })
  const terminalGrid = ref<HTMLElement | null>(null)
  const terminalTabs = ref<HTMLElement | null>(null)
  const terminalTabScrollState = reactive({ canScrollLeft: false, canScrollRight: false })
  const aiButtonPanelId = ref('')
  const aiButtonPosition = reactive({ top: 0, right: 26 })

  return {
    aiButtonPanelId,
    aiButtonPosition,
    menu,
    renameText,
    renamingId,
    termMenu,
    terminalGrid,
    terminalTabs,
    terminalTabScrollState
  }
}

export const createTerminalWorkspaceShellRuntime = (
  {
    workspace,
    state,
    terminalViews,
    searchOverlayPanelId,
    commandDialog,
    closeCommandDialog,
    closeSearchOverlay,
    disconnectTerminalPanel,
    findNext,
    findPrevious,
    focusActivePanel,
    focusCommandDialogInput,
    focusPanel,
    getCommandDialogInput,
    hideSuggestions,
    clearSearchFromButton,
    openCommandDialog,
    openSearchOverlay,
    reconnectTerminalPanel,
    refitAfterLayoutChange,
    scheduleVisibleTerminalFit,
    startLocalTerminalForPanel,
    startSshTerminalForPanel,
    syncTerminalView,
    terminalFontSizeForPanel,
    updateFontSize,
    updateSelectionButtonPosition
  }: TerminalWorkspaceShellRuntimeInput,
  deps: TerminalWorkspaceShellDeps = {}
) => {
  const {
    aiButtonPanelId,
    menu,
    renameText,
    renamingId,
    termMenu,
    terminalTabs,
    terminalTabScrollState
  } = state
  const afterDomUpdate = deps.afterDomUpdate ?? nextTick
  const copyToClipboard = deps.copyToClipboard ?? copyTextToClipboard
  const readClipboard = deps.readClipboard ?? readTextFromClipboard
  const getViewportSize = deps.getViewportSize ?? (() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }))

  const panelById = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)
  const terminalPanels = () => workspace.panels.filter((panel) => panel.kind !== 'knowledge')
  const keyboardEventTargetElement = (event: KeyboardEvent) => (event.target instanceof Element ? event.target : null)
  const isTerminalKeyboardTarget = (event: KeyboardEvent) =>
    Boolean(keyboardEventTargetElement(event)?.closest('.xterm-host, .threaded-terminal-host'))
  const compactShortcut = (shortcut: string) => shortcut.replace(/\s+/g, '').toLowerCase()
  const terminalDefaultShortcutOverridden = (actionId: string, defaultShortcut: string) => {
    const shortcut = workspace.settingsShortcuts.find((item) => item.id === actionId)?.shortcut
    return Boolean(shortcut && compactShortcut(shortcut) !== compactShortcut(defaultShortcut))
  }

  const canForkSelected = computed(() => workspace.canForkSshPanel(menu.panelId))
  const canForkTerminalMenuPanel = computed(() => workspace.canForkSshPanel(termMenu.panelId))
  const isTerminalMenuPanel = computed(() => panelById(menu.panelId)?.kind === 'terminal')
  const isReconnectablePanel = (panel?: TerminalPanel | null) => !panel?.sessionId || panel.status === 'closed' || panel.status === 'error'
  const terminalTabsMaxScrollLeft = (element: HTMLElement) => Math.max(0, element.scrollWidth - element.clientWidth)
  const terminalTabScrollStep = (element: HTMLElement) => Math.max(160, Math.round(element.clientWidth * 0.72))
  const scrollTerminalTabsTo = (element: HTMLElement, left: number, behavior: ScrollBehavior = 'auto') => {
    const target = Math.max(0, Math.min(left, terminalTabsMaxScrollLeft(element)))
    if (typeof element.scrollTo === 'function') element.scrollTo({ left: target, behavior })
    else element.scrollLeft = target
  }

  const updateTerminalTabScrollState = () => {
    const element = terminalTabs.value
    if (!element) {
      terminalTabScrollState.canScrollLeft = false
      terminalTabScrollState.canScrollRight = false
      return
    }
    const maxScrollLeft = terminalTabsMaxScrollLeft(element)
    if (element.scrollLeft < 0 || element.scrollLeft > maxScrollLeft) {
      element.scrollLeft = Math.max(0, Math.min(element.scrollLeft, maxScrollLeft))
    }
    terminalTabScrollState.canScrollLeft = element.scrollLeft > 1
    terminalTabScrollState.canScrollRight = element.scrollLeft < maxScrollLeft - 1
  }

  const updateTerminalTabScrollStateSoon = () => {
    updateTerminalTabScrollState()
    window.requestAnimationFrame?.(() => updateTerminalTabScrollState())
    window.setTimeout(updateTerminalTabScrollState, 180)
  }

  const scrollTerminalTabs = (direction: 'left' | 'right') => {
    const element = terminalTabs.value
    if (!element) return
    const left = terminalTabScrollStep(element) * (direction === 'left' ? -1 : 1)
    scrollTerminalTabsTo(element, element.scrollLeft + left, 'smooth')
    updateTerminalTabScrollStateSoon()
  }

  const scrollActiveTerminalTabIntoView = () => {
    const element = terminalTabs.value
    const activeTab = element?.querySelector<HTMLElement>('.terminal-tab.active') || null
    if (element && activeTab) {
      const viewLeft = element.scrollLeft
      const viewRight = viewLeft + element.clientWidth
      const tabLeft = activeTab.offsetLeft
      const tabRight = tabLeft + activeTab.offsetWidth
      if (tabLeft < viewLeft) scrollTerminalTabsTo(element, tabLeft)
      else if (tabRight > viewRight) scrollTerminalTabsTo(element, tabRight - element.clientWidth)
    }
    updateTerminalTabScrollStateSoon()
  }

  const focusPanelAfterDomUpdate = (panelId: string) => {
    void Promise.resolve(afterDomUpdate()).then(() => focusPanel(panelId))
  }

  const connectionActionLabel = (panel?: TerminalPanel | null) => {
    if (!panel?.sessionId) {
      if (panel?.sshSession) return panel.status === 'ready' ? '连接 SSH' : '重新连接'
      return panel?.status === 'ready' ? '打开本地 shell' : '重新连接'
    }
    return '断开连接'
  }

  const connectionActionShortcut = (panel?: TerminalPanel | null) => (panel?.sessionId ? '' : 'Enter')

  const clampFloatingMenuPosition = (event: MouseEvent, width: number, height: number) => {
    const padding = 8
    const viewport = getViewportSize()
    const maxX = Math.max(padding, viewport.innerWidth - width - padding)
    const maxY = Math.max(padding, viewport.innerHeight - height - padding)
    return {
      x: Math.max(padding, Math.min(event.clientX, maxX)),
      y: Math.max(padding, Math.min(event.clientY, maxY))
    }
  }

  const closeTerminalMenusFromDocument = () => {
    menu.visible = false
    termMenu.visible = false
  }

  const activatePanel = (panelId: string) => {
    workspace.activePanelId = panelId
    focusPanel(panelId)
  }

  const openMenu = (event: MouseEvent, panelId: string) => {
    const position = clampFloatingMenuPosition(event, 154, 320)
    menu.visible = true
    menu.x = position.x
    menu.y = position.y
    menu.panelId = panelId
    termMenu.visible = false
    aiButtonPanelId.value = ''
  }

  const openTerminalMenu = (event: MouseEvent, panelId: string) => {
    const position = clampFloatingMenuPosition(event, 214, 560)
    workspace.activePanelId = panelId
    hideSuggestions()
    termMenu.visible = true
    termMenu.x = position.x
    termMenu.y = position.y
    termMenu.panelId = panelId
    menu.visible = false
    aiButtonPanelId.value = ''
  }

  const handleTerminalContextMenu = async (panelId: string, event: MouseEvent) => {
    workspace.activePanelId = panelId
    switch (workspace.terminalSettings.rightMouseEvent) {
      case 'paste':
        await pasteClipboard(panelId)
        break
      case 'contextMenu':
        openTerminalMenu(event, panelId)
        break
      case 'none':
        termMenu.visible = false
        aiButtonPanelId.value = ''
        break
    }
  }

  const handleTerminalMouseDown = async (panelId: string, event: MouseEvent) => {
    workspace.activePanelId = panelId
    if (event.button !== 1) return
    event.preventDefault()
    switch (workspace.terminalSettings.middleMouseEvent) {
      case 'paste':
        await pasteClipboard(panelId)
        break
      case 'contextMenu':
        openTerminalMenu(event, panelId)
        break
      case 'closeTab':
        workspace.closePanel(panelId)
        termMenu.visible = false
        break
      case 'none':
        termMenu.visible = false
        aiButtonPanelId.value = ''
        break
    }
  }

  const handleTerminalMouseUp = (panelId: string, event: MouseEvent) => {
    if (event.button !== 0 || termMenu.visible || searchOverlayPanelId.value === panelId) {
      aiButtonPanelId.value = ''
      return
    }
    updateSelectionButtonPosition(panelId)
  }

  const startRename = (panelId: string, title: string) => {
    renamingId.value = panelId
    renameText.value = title
  }

  const finishRename = () => {
    workspace.renamePanel(renamingId.value, renameText.value)
    renamingId.value = ''
  }

  const closeSelected = () => {
    workspace.closePanel(menu.panelId)
    menu.visible = false
  }

  const closeTab = (panelId: string) => {
    workspace.closePanel(panelId)
    menu.visible = false
    termMenu.visible = false
    void Promise.resolve(afterDomUpdate()).then(() => scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 3, forceGeometry: true }))
  }

  const closeOtherTabsFromMenu = () => {
    workspace.activePanelId = menu.panelId
    workspace.closeOthers()
    menu.visible = false
  }

  const closeAllTabsFromMenu = () => {
    workspace.closeAllPanels()
    menu.visible = false
  }

  const renameSelected = () => {
    startRename(menu.panelId, panelById(menu.panelId)?.title || '')
    menu.visible = false
  }

  const cloneSelected = () => {
    const source = workspace.panels.find((panel) => panel.id === menu.panelId)
    const sourcePanelId = source?.id
    workspace.createPanel()
    const clonedPanelId = workspace.activePanelId
    if (source) {
      workspace.renamePanel(clonedPanelId, `${source.title} copy`)
      const panel = panelById(clonedPanelId)
      if (panel) {
        panel.cwd = source.cwd
        panel.sshSession = source.sshSession
          ? {
              ...source.sshSession,
              connectionId: undefined,
              sourcePanelId
            }
          : undefined
      }
    }
    menu.visible = false
    focusPanelAfterDomUpdate(clonedPanelId)
  }

  const connectSplitPanelFromSource = async (panel: TerminalPanel, sourcePanel?: TerminalPanel | null) => {
    if (!sourcePanel?.sessionId || isReconnectablePanel(sourcePanel)) return false
    return panel.sshSession ? startSshTerminalForPanel(panel) : startLocalTerminalForPanel(panel)
  }

  const createSplitPanel = async (direction: PanelDirection, sourcePanelId: string) => {
    const sourcePanel = panelById(sourcePanelId)
    workspace.activePanelId = sourcePanelId
    const panel = workspace.createPanel(direction)
    await afterDomUpdate()
    focusPanel(panel.id)
    void connectSplitPanelFromSource(panel, sourcePanel).finally(() => focusPanel(panel.id))
    return panel
  }

  const splitSelected = (direction: PanelDirection) => {
    void createSplitPanel(direction, menu.panelId)
    menu.visible = false
  }

  const localTerminalOptionsFromSource = (panelId: string) => {
    const source = panelById(panelId)
    if (!source || source.sshSession || !source.sessionId || !source.cwd?.trim()) return {}
    return { cwd: source.cwd.trim() }
  }

  const openLocalTerminalFromSource = async (sourcePanelId: string) => {
    const connected = await workspace.openLocalTerminalPanel(localTerminalOptionsFromSource(sourcePanelId))
    if (connected) {
      await afterDomUpdate()
      focusPanel(connected.id)
    }
    return connected
  }

  const unsplitSelected = () => {
    workspace.unsplitPanel(menu.panelId)
    menu.visible = false
    refitAfterLayoutChange()
    focusActivePanel()
  }

  const forkSshFromPanel = async (sourcePanelId: string) => {
    const forkPanel = workspace.forkSshPanel(sourcePanelId)
    menu.visible = false
    termMenu.visible = false
    if (!forkPanel) return
    const pendingSsh = forkPanel.sshSession ? { ...forkPanel.sshSession } : null
    const connected = await startSshTerminalForPanel(forkPanel)
    if (!connected) {
      workspace.discardPendingTerminalPanel(forkPanel.id, sourcePanelId)
      return
    }
    focusPanelAfterDomUpdate(forkPanel.id)
    const ssh = forkPanel.sshSession
    if (!ssh) return
    const contextId = pendingSsh?.assetId || ssh.assetId || ssh.connectionId || forkPanel.id
    workspace.selectedContexts = [
      ...workspace.selectedContexts.filter((item) => item.id !== contextId),
      {
        id: contextId,
        kind: 'hosts',
        label: pendingSsh?.host || ssh.host,
        detail: `${pendingSsh?.assetName || ssh.assetName} fork`
      }
    ]
  }

  const forkSelected = async () => {
    await forkSshFromPanel(menu.panelId)
  }

  const forkFromTermMenu = async () => {
    await forkSshFromPanel(termMenu.panelId || workspace.activePanelId)
  }

  const copySelection = async (panelId = workspace.activePanelId) => {
    const selectedText = terminalViews.get(panelId)?.terminal.getSelection()
    if (selectedText) {
      const copied = await copyToClipboard(selectedText)
      workspace.setTopNotice(copied ? '终端内容已复制' : '终端复制失败')
    }
    menu.visible = false
    termMenu.visible = false
  }

  const pasteClipboard = async (panelId = workspace.activePanelId) => {
    const clipboardRead = await readClipboard()
    if (!clipboardRead.ok) {
      workspace.setTopNotice(clipboardRead.error === 'unavailable' ? '终端剪贴板读取服务不可用' : clipboardRead.message || '终端剪贴板读取失败')
      termMenu.visible = false
      return
    }
    const text = clipboardRead.text
    if (!text) {
      termMenu.visible = false
      return
    }
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') {
      termMenu.visible = false
      return
    }
    const result = await workspace.runTerminalCommand(panel.id, text, {
      inputText: text,
      shellText: text,
      writeToShell: true,
      source: 'direct'
    })
    if (result?.status === 'allow') syncTerminalView(panel)
    menu.visible = false
    termMenu.visible = false
  }

  const clearTerminal = (panelId = workspace.activePanelId) => {
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') return
    workspace.replaceTerminalOutput(panel.id, '')
    const view = terminalViews.get(panelId)
    view?.clearPendingOutput?.()
    if (!view?.clearPendingOutput) view?.terminal.clear()
    if (view) view.lastOutput = ''
    menu.visible = false
    termMenu.visible = false
  }

  const increaseFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, terminalFontSizeForPanel(panelId) + 1)
  const decreaseFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, terminalFontSizeForPanel(panelId) - 1)
  const resetFont = (panelId = workspace.activePanelId) => updateFontSize(panelId, workspace.terminalSettings.fontSize || 12)

  const increaseFontFromMenu = () => {
    increaseFont(termMenu.panelId || workspace.activePanelId)
    termMenu.visible = false
    menu.visible = false
  }

  const decreaseFontFromMenu = () => {
    decreaseFont(termMenu.panelId || workspace.activePanelId)
    termMenu.visible = false
    menu.visible = false
  }

  const handleTerminalWheel = (panelId: string, event: WheelEvent) => {
    if (!workspace.terminalSettings.pinchZoomStatus || (!event.ctrlKey && !event.metaKey)) return
    event.preventDefault()
    if (event.deltaY < 0) increaseFont(panelId)
    if (event.deltaY > 0) decreaseFont(panelId)
  }

  const scrollTerminalViewport = (panelId: string, action: TerminalShortcutAction['type']) => {
    const terminal = terminalViews.get(panelId)?.terminal
    if (!terminal) return false
    if (action === 'scrollLineUp') {
      terminal.scrollLines?.(-1)
      return true
    }
    if (action === 'scrollLineDown') {
      terminal.scrollLines?.(1)
      return true
    }
    if (action === 'scrollPageUp') {
      if (terminal.scrollPages) terminal.scrollPages(-1)
      else terminal.scrollLines?.(-Math.max(1, terminal.rows - 1))
      return true
    }
    if (action === 'scrollPageDown') {
      if (terminal.scrollPages) terminal.scrollPages(1)
      else terminal.scrollLines?.(Math.max(1, terminal.rows - 1))
      return true
    }
    if (action === 'scrollTop') {
      if (terminal.scrollToTop) terminal.scrollToTop()
      else terminal.scrollToLine?.(0)
      return true
    }
    if (action === 'scrollBottom') {
      terminal.scrollToBottom()
      return true
    }
    return false
  }

  const commandMarkerLinesForPanel = (panel: TerminalPanel) => {
    let line = 0
    const markers: number[] = []
    const segments = panel.outputSegments?.length ? panel.outputSegments : [{ text: panel.output, scope: 'output' as const }]
    segments.forEach((segment) => {
      if (segment.scope === 'input' && segment.text.trim()) markers.push(line)
      line += (segment.text.match(/\n/g) || []).length
    })
    return markers.filter((marker, index, list) => index === 0 || marker !== list[index - 1])
  }

  const jumpToKnownCommand = (panelId: string, direction: -1 | 1) => {
    const panel = panelById(panelId)
    const terminal = terminalViews.get(panelId)?.terminal
    if (!panel || !terminal?.scrollToLine) return false
    const markers = commandMarkerLinesForPanel(panel)
    if (!markers.length) return true
    const viewportY = terminal.buffer.active.viewportY || 0
    const target =
      direction < 0
        ? [...markers].reverse().find((line) => line < viewportY) ?? markers.at(-1)
        : markers.find((line) => line > viewportY) ?? markers[0]
    if (target === undefined) return true
    terminal.scrollToLine(target)
    return true
  }

  const moveActiveTab = (panelId: string, direction: -1 | 1) => {
    const index = workspace.panels.findIndex((panel) => panel.id === panelId)
    if (index < 0) return false
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= workspace.panels.length) return false
    const [panel] = workspace.panels.splice(index, 1)
    workspace.panels.splice(targetIndex, 0, panel)
    workspace.activePanelId = panel.id
    void Promise.resolve(afterDomUpdate()).then(() => scheduleVisibleTerminalFit({ scrollToBottom: false, frames: 2, forceGeometry: true }))
    return true
  }

  const switchRelativeTab = (delta: -1 | 1) => {
    const panels = terminalPanels()
    if (panels.length <= 1) return false
    const index = panels.findIndex((panel) => panel.id === workspace.activePanelId)
    const currentIndex = index >= 0 ? index : 0
    const target = panels[(currentIndex + delta + panels.length) % panels.length]
    if (!target) return false
    activatePanel(target.id)
    return true
  }

  const switchToSpecificTerminalTab = (digit: number) => {
    const panels = terminalPanels()
    const index = digit === 10 ? 9 : digit - 1
    const target = panels[index]
    if (!target) return false
    activatePanel(target.id)
    return true
  }

  const handleTerminalKeyboardShortcut = (panelId: string, action: TerminalShortcutAction, event?: KeyboardEvent) => {
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') return false
    workspace.activePanelId = panelId
    switch (action.type) {
      case 'copy':
        void copySelection(panelId)
        return true
      case 'paste':
        void pasteClipboard(panelId)
        return true
      case 'search':
        void openSearchOverlay(panelId)
        return true
      case 'searchNext':
        findNext()
        return true
      case 'searchPrevious':
        findPrevious()
        return true
      case 'searchClear':
        clearSearchFromButton()
        return true
      case 'newWindow':
        void windowControlsClient.newWindow()?.()
        return true
      case 'closeWindow':
        void windowControlsClient.closeWindow()?.()
        return true
      case 'fullscreen':
        void windowControlsClient.toggleFullScreen()?.()
        return true
      case 'newTab':
        if (terminalDefaultShortcutOverridden('newTerminal', 'Ctrl+Shift+T')) return false
        void openLocalTerminalFromSource(panelId)
        termMenu.visible = false
        return true
      case 'forkSsh':
        if (!workspace.canForkSshPanel(panelId)) return false
        void forkSshFromPanel(panelId)
        return true
      case 'closeTab':
        closeTab(panelId)
        return true
      case 'commandDialog':
        if (commandDialog.visible) {
          const activeInput = getCommandDialogInput()
          if (document.activeElement === activeInput) focusPanel(commandDialog.panelId)
          else focusCommandDialogInput()
        } else {
          void openCommandDialog(panelId)
        }
        return true
      case 'clear':
        clearTerminal(panelId)
        return true
      case 'fileManager':
        void workspace.ensureFileSessionForTerminalPanel(panelId)
        return true
      case 'zoomIn':
        increaseFont(panelId)
        return true
      case 'zoomOut':
        decreaseFont(panelId)
        return true
      case 'zoomReset':
        resetFont(panelId)
        return true
      case 'previousTab':
        return switchRelativeTab(-1)
      case 'nextTab':
        return switchRelativeTab(1)
      case 'moveTabLeft':
        return moveActiveTab(panelId, -1)
      case 'moveTabRight':
        return moveActiveTab(panelId, 1)
      case 'specificTab':
        if (terminalDefaultShortcutOverridden('switchToSpecificTab', 'Alt')) return false
        return switchToSpecificTerminalTab(action.digit)
      case 'scrollLineUp':
      case 'scrollLineDown':
      case 'scrollPageUp':
      case 'scrollPageDown':
      case 'scrollTop':
      case 'scrollBottom':
        return scrollTerminalViewport(panelId, action.type)
      case 'previousCommand':
        return jumpToKnownCommand(panelId, -1)
      case 'nextCommand':
        return jumpToKnownCommand(panelId, 1)
    }
    event?.preventDefault()
    return false
  }

  const togglePanelConnection = async (panelId: string) => {
    const panel = panelById(panelId)
    if (!panel || panel.kind === 'knowledge') return
    const wasNeverConnected = !panel.sessionId && panel.status === 'ready'
    if (!panel.sessionId) {
      const connected = await reconnectTerminalPanel(panel)
      if (connected) workspace.setTopNotice(wasNeverConnected && !panel.sshSession ? '本地 shell 已打开' : '终端已重新连接')
    } else {
      const disconnected = await disconnectTerminalPanel(panel)
      if (disconnected) workspace.setTopNotice('终端已断开连接')
    }
    syncTerminalView(panel)
    focusPanel(panelId)
    termMenu.visible = false
  }

  const toggleTabConnectionFromMenu = async () => {
    await togglePanelConnection(menu.panelId)
    menu.visible = false
  }

  const createTerminalFromMenu = async () => {
    const sourcePanelId = termMenu.panelId || workspace.activePanelId
    termMenu.visible = false
    await openLocalTerminalFromSource(sourcePanelId)
  }

  const closeTerminalFromMenu = () => {
    workspace.closePanel(termMenu.panelId)
    termMenu.visible = false
  }

  const splitFromTermMenu = (direction: PanelDirection) => {
    void createSplitPanel(direction, termMenu.panelId)
    termMenu.visible = false
  }

  const unsplitFromTermMenu = () => {
    workspace.unsplitPanel(termMenu.panelId)
    termMenu.visible = false
    refitAfterLayoutChange()
    focusActivePanel()
  }

  const openFileManagerFromMenu = () => {
    void workspace.ensureFileSessionForTerminalPanel(termMenu.panelId || workspace.activePanelId)
    termMenu.visible = false
  }

  const chatSelectionToAi = (panelId: string) => {
    const view = terminalViews.get(panelId)
    const selected = view?.terminal.getSelection().trim()
    if (selected) {
      workspace.rightPanelOpen = true
      workspace.selectedContexts = [
        ...workspace.selectedContexts.filter((item) => item.id !== `terminal-${panelId}`),
        { id: `terminal-${panelId}`, kind: 'hosts', label: `Terminal selection: ${selected.slice(0, 24)}` }
      ]
      void workspace.sendChat(`Terminal output:\n\`\`\`\n${selected}\n\`\`\``, undefined, undefined, { skipKnowledgeSearch: true })
      view?.terminal.clearSelection?.()
    }
    aiButtonPanelId.value = ''
  }

  const handleShortcut = async (event: KeyboardEvent) => {
    if (workspace.shortcutRecording.actionId) return
    const terminalAction = terminalShortcutActionForEvent(event)
    if (terminalAction && isTerminalKeyboardTarget(event) && handleTerminalKeyboardShortcut(workspace.activePanelId, terminalAction, event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const key = event.key.toLowerCase()
    const hasPrimaryModifier = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') {
      menu.visible = false
      termMenu.visible = false
      closeSearchOverlay()
      if (commandDialog.visible) closeCommandDialog()
      hideSuggestions()
      return
    }
    if (hasPrimaryModifier && event.shiftKey && key === 'k') {
      event.preventDefault()
      if (commandDialog.visible) {
        const activeInput = getCommandDialogInput()
        if (document.activeElement === activeInput) {
          focusPanel(commandDialog.panelId)
        } else {
          focusCommandDialogInput()
        }
        return
      }
      void openCommandDialog(workspace.activePanelId)
      return
    }
    if (hasPrimaryModifier && event.shiftKey && key === 'l') {
      event.preventDefault()
      clearTerminal()
      return
    }
    if (hasPrimaryModifier && event.key === '=') {
      event.preventDefault()
      increaseFont(workspace.activePanelId)
      return
    }
    if (hasPrimaryModifier && event.key === '-') {
      event.preventDefault()
      decreaseFont(workspace.activePanelId)
      return
    }
    if (hasPrimaryModifier && event.shiftKey && key === 'm') {
      event.preventDefault()
      await workspace.ensureFileSessionForTerminalPanel(workspace.activePanelId)
    }
  }

  return {
    activatePanel,
    canForkTerminalMenuPanel,
    canForkSelected,
    chatSelectionToAi,
    clearTerminal,
    cloneSelected,
    closeAllTabsFromMenu,
    closeOtherTabsFromMenu,
    closeSelected,
    closeTab,
    closeTerminalFromMenu,
    closeTerminalMenusFromDocument,
    connectionActionLabel,
    connectionActionShortcut,
    copySelection,
    createSplitPanel,
    createTerminalFromMenu,
    decreaseFontFromMenu,
    finishRename,
    forkFromTermMenu,
    forkSelected,
    handleShortcut,
    handleTerminalContextMenu,
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    handleTerminalWheel,
    handleTerminalKeyboardShortcut,
    increaseFontFromMenu,
    isTerminalMenuPanel,
    openFileManagerFromMenu,
    openMenu,
    openTerminalMenu,
    panelById,
    pasteClipboard,
    renameSelected,
    scrollActiveTerminalTabIntoView,
    scrollTerminalTabs,
    splitFromTermMenu,
    splitSelected,
    startRename,
    togglePanelConnection,
    toggleTabConnectionFromMenu,
    updateTerminalTabScrollState,
    unsplitFromTermMenu,
    unsplitSelected
  }
}

export type TerminalWorkspaceShellRuntime = ReturnType<typeof createTerminalWorkspaceShellRuntime>
