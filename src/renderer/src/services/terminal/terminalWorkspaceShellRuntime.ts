import { computed, nextTick, reactive, ref, type Ref } from 'vue'
import { copyTextToClipboard, readTextFromClipboard, type ClipboardTextReadResult } from '@/services/app/clipboardRuntime'
import type { TerminalPanel, useWorkspaceStore } from '@/stores/workspace'
import type { PanelDirection } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalView } from '@/services/terminal/terminalWorkspaceViewRuntime'

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
  focusActivePanel: () => void
  focusCommandDialogInput: () => void
  focusPanel: (panelId: string) => void
  getCommandDialogInput: () => HTMLTextAreaElement | null
  hideSuggestions: () => void
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
  const aiButtonPanelId = ref('')
  const aiButtonPosition = reactive({ top: 0, right: 26 })

  return {
    aiButtonPanelId,
    aiButtonPosition,
    menu,
    renameText,
    renamingId,
    termMenu,
    terminalGrid
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
    focusActivePanel,
    focusCommandDialogInput,
    focusPanel,
    getCommandDialogInput,
    hideSuggestions,
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
    termMenu
  } = state
  const afterDomUpdate = deps.afterDomUpdate ?? nextTick
  const copyToClipboard = deps.copyToClipboard ?? copyTextToClipboard
  const readClipboard = deps.readClipboard ?? readTextFromClipboard
  const getViewportSize = deps.getViewportSize ?? (() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }))

  const panelById = (panelId: string) => workspace.panels.find((panel) => panel.id === panelId)

  const canForkSelected = computed(() => workspace.canForkSshPanel(menu.panelId))
  const isTerminalMenuPanel = computed(() => panelById(menu.panelId)?.kind === 'terminal')
  const isReconnectablePanel = (panel?: TerminalPanel | null) => !panel?.sessionId || panel.status === 'closed' || panel.status === 'error'

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

  const connectionActionShortcut = (panel?: TerminalPanel | null) => (panel?.sessionId ? 'Ctrl+D' : 'Enter')

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

  const unsplitSelected = () => {
    workspace.unsplitPanel(menu.panelId)
    menu.visible = false
    refitAfterLayoutChange()
    focusActivePanel()
  }

  const forkSelected = async () => {
    const sourcePanelId = menu.panelId
    const forkPanel = workspace.forkSshPanel(menu.panelId)
    menu.visible = false
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

  const createTerminalFromMenu = () => {
    const panel = workspace.createPanel()
    termMenu.visible = false
    focusPanelAfterDomUpdate(panel.id)
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
    const key = event.key.toLowerCase()
    const hasPrimaryModifier = event.ctrlKey || event.metaKey
    if (hasPrimaryModifier && key === 'f') {
      event.preventDefault()
      openSearchOverlay(workspace.activePanelId)
      return
    }
    if (event.key === 'Escape') {
      menu.visible = false
      termMenu.visible = false
      closeSearchOverlay()
      if (commandDialog.visible) closeCommandDialog()
      hideSuggestions()
      return
    }
    if (hasPrimaryModifier && key === 'k') {
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
    if (hasPrimaryModifier && key === 'l') {
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
    if (hasPrimaryModifier && key === 'm') {
      event.preventDefault()
      await workspace.ensureFileSessionForTerminalPanel(workspace.activePanelId)
    }
  }

  return {
    activatePanel,
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
    forkSelected,
    handleShortcut,
    handleTerminalContextMenu,
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    handleTerminalWheel,
    increaseFontFromMenu,
    isTerminalMenuPanel,
    openFileManagerFromMenu,
    openMenu,
    openTerminalMenu,
    panelById,
    pasteClipboard,
    renameSelected,
    splitFromTermMenu,
    splitSelected,
    startRename,
    togglePanelConnection,
    toggleTabConnectionFromMenu,
    unsplitFromTermMenu,
    unsplitSelected
  }
}

export type TerminalWorkspaceShellRuntime = ReturnType<typeof createTerminalWorkspaceShellRuntime>
