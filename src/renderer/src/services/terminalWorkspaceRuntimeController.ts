import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useTerminalControlSurface, type TerminalControlSurfaceView } from '@/composables/useTerminalControlSurface'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { controlClient } from '@/services/controlClient'
import { terminalClient } from '@/services/terminalClient'
import { createTerminalWorkspaceCommandRuntime, createTerminalWorkspaceCommandState } from '@/services/terminalWorkspaceCommandRuntime'
import { createTerminalWorkspaceContextRuntime } from '@/services/terminalWorkspaceContextRuntime'
import { createTerminalWorkspaceLayoutRuntime } from '@/services/terminalWorkspaceLayoutRuntime'
import { createTerminalWorkspaceSessionRuntime } from '@/services/terminalWorkspaceSessionRuntime'
import { createTerminalWorkspaceShellRuntime, createTerminalWorkspaceShellState } from '@/services/terminalWorkspaceShellRuntime'
import { createTerminalWorkspaceViewRuntime } from '@/services/terminalWorkspaceViewRuntime'
import { createTerminalWorkspaceZmodemShellRuntime } from '@/services/terminalWorkspaceZmodemShellRuntime'
import { useI18n } from '@/i18n'
import type { TerminalDataEvent } from '@shared/contracts/terminalSessions'

export const useTerminalWorkspaceContainerRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()
  const shellState = createTerminalWorkspaceShellState()
  const {
    aiButtonPanelId,
    aiButtonPosition,
    menu,
    renameText,
    renamingId,
    termMenu,
    terminalGrid
  } = shellState
  const commandState = createTerminalWorkspaceCommandState()
  const {
    activeSuggestion,
    aiSuggestLoading,
    command,
    commandDialog,
    commandDialogInput,
    commandDialogRef,
    commandLineInput,
    commandLinePanelId,
    globalCommand,
    globalInputVisible,
    hasAiSuggestion,
    search,
    searchMatchCount,
    searchMatchIndex,
    searchOverlayInput,
    searchOverlayPanelId,
    suggestionItems,
    suggestionPanel,
    suggestionPosition,
    suggestionSelectionMode
  } = commandState
  let offData: (() => void) | null = null
  let offLifecycle: (() => void) | null = null
  let offExit: (() => void) | null = null
  let offControlRequest: (() => void) | null = null
  const isWelcomePlaceholderPanel = (panel?: TerminalPanel | null) =>
    Boolean(
      panel &&
        panel.id === 'panel-main' &&
        panel.kind !== 'knowledge' &&
        panel.title === '欢迎' &&
        !panel.sessionId &&
        !panel.output &&
        !panel.outputSegments.length &&
        !panel.sshSession &&
        panel.status === 'ready' &&
        !panel.split &&
        !panel.splitGroupId
    )
  const layoutEffects = {
    focusActivePanel: () => focusActivePanel(),
    refitAfterLayoutChange: () => refitAfterLayoutChange()
  }
  const {
    activeTerminalPanel,
    connectedTerminalPanels,
    handlePaneDragEnter,
    handlePaneDragLeave,
    handlePaneDragOver,
    handlePaneDrop,
    handleTabBarDragLeave,
    handleTabBarDragOver,
    handleTabBarDrop,
    handleTabDragEnd,
    handleTabDragEnter,
    handleTabDragLeave,
    handleTabDragOver,
    handleTabDragStart,
    handleTabDrop,
    paneDragOverPanelId,
    showTerminalDashboard,
    splitLayoutItems,
    tabBarDragOver,
    tabDragOverPanelId,
    terminalGridClasses,
    visibleTerminalPanels,
    visibleTerminalTabPanels
  } = createTerminalWorkspaceLayoutRuntime({
    workspace,
    isWelcomePlaceholderPanel,
    effects: layoutEffects
  })

  const {
    activeTerminalContextBar,
    panelNeedsAiAttention,
    terminalStatusLabel,
    terminalTabKindBadge,
    terminalTabMeta,
    terminalTabTooltip
  } = createTerminalWorkspaceContextRuntime({
    workspace,
    activeTerminalPanel,
    isWelcomePlaceholderPanel,
    t
  })
  const openAiSessionsFromContextBar = () => {
    workspace.activeModule = 'aiSessions'
    workspace.leftPanelOpen = true
  }
  const refreshAiSessionsFromContextBar = async () => {
    const refreshed = await workspace.refreshManagedAiSessions()
    if (!refreshed && !workspace.managedAiSessionsError) workspace.setTopNotice(t('terminal.context.refreshFailed'))
  }
  const focusActiveTerminalFromContextBar = () => {
    const panel = activeTerminalPanel.value
    if (!panel || panel.kind === 'knowledge') return
    workspace.activeModule = 'workspace'
    workspace.activePanelId = panel.id
    focusPanel(panel.id)
  }
  const copyActiveTerminalContext = async () => {
    const context = activeTerminalContextBar.value
    if (!context) return
    const copied = await copyTextToClipboard(context.text)
    workspace.setTopNotice(copied ? t('terminal.context.copied') : t('terminal.context.copyFailed'))
  }

  const terminalZmodemShellRuntime = createTerminalWorkspaceZmodemShellRuntime({
    getApi: () => window.aiops,
    appendData: (sessionId, data) => workspace.appendTerminalOutput(sessionId, data),
    onNotice: (message) => workspace.setTopNotice(message)
  })
  const {
    cancelZmodemTransfer,
    formatZmodemBytes,
    handleTerminalData: handleTerminalZmodemData,
    zmodemPercent,
    zmodemProgress
  } = terminalZmodemShellRuntime

  let writeXtermInput: (panelId: string, data: string) => void | Promise<void> = () => undefined

  const {
    activeView,
    applyTerminalSettingsToAll,
    dispose: disposeTerminalViews,
    estimateTerminalCellSize,
    focusActivePanel,
    focusPanel,
    getTerminalElement,
    refitAfterLayoutChange,
    scheduleTerminalFit,
    scheduleVisibleTerminalFit,
    setTerminalElement,
    syncPanelViews,
    syncTerminalView,
    terminalSettingsSignature,
    terminalViewSize,
    terminalViews,
    terminalFontSizeForPanel,
    updateFontSize,
    updateSelectionButtonPosition,
    updateSuggestionsPosition
  } = createTerminalWorkspaceViewRuntime({
    workspace,
    visibleTerminalPanels,
    aiButtonPanelId,
    aiButtonPosition,
    suggestionPanel,
    suggestionPosition,
    suggestionItems,
    aiSuggestLoading,
    writeXtermInput: (panelId, data) => writeXtermInput(panelId, data)
  })

  const terminalSessionRuntime = createTerminalWorkspaceSessionRuntime({
    workspace,
    terminalViewSize,
    afterDomUpdate: () => nextTick()
  })
  const {
    disconnectTerminalPanel,
    reconnectTerminalPanel,
    startLocalTerminalForPanel,
    startSshTerminalForPanel
  } = terminalSessionRuntime
  writeXtermInput = terminalSessionRuntime.writeXtermInput

  const {
    applyGeneratedCommand,
    applySuggestion,
    approveSecurityPrompt,
    cancelSecurityPrompt,
    clearSearchFromButton,
    closeCommandDialog,
    closeCommandLine,
    closeSearchOverlay,
    commandDialogStyle,
    commandLineStyle,
    enterSuggestionSelection,
    findNext,
    findPrevious,
    focusCommandDialogInput,
    getCommandDialogInput,
    hideCommandDialogForActivePanel,
    hideSuggestions,
    moveSuggestion,
    openCommandDialog,
    openCommandDialogFromTabMenu,
    openCommandDialogFromTermMenu,
    openCommandLineFromMenu,
    openSearchOverlay,
    resizeCommandDialogInput,
    sendCommand,
    sendGlobalCommand,
    submitCommandDialog,
    toggleGlobalInput,
    triggerAiSuggestion,
    updateSuggestions
  } = createTerminalWorkspaceCommandRuntime({
    workspace,
    state: commandState,
    menu,
    termMenu,
    aiButtonPanelId,
    activeView,
    estimateTerminalCellSize,
    focusActivePanel,
    focusPanel,
    getTerminalElement,
    syncTerminalView,
    terminalViews,
    updateSuggestionsPosition
  })

  const {
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
  } = createTerminalWorkspaceShellRuntime({
    workspace,
    state: shellState,
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
  }, {
    afterDomUpdate: () => nextTick()
  })

  const terminalControlSurface = useTerminalControlSurface({
    workspace,
    terminalViews: terminalViews as unknown as Map<string, TerminalControlSurfaceView>,
    visibleTerminalPanels,
    isWelcomePlaceholderPanel,
    terminalViewSize,
    startSshTerminalForPanel,
    disconnectTerminalPanel,
    scheduleVisibleTerminalFit
  })
  const controlFlashingPanelIds = terminalControlSurface.controlFlashingPanelIds
  const handleControlRequest = terminalControlSurface.handleControlRequest

  const handleTerminalData = (event: TerminalDataEvent) => {
    if (!handleTerminalZmodemData(event)) {
      workspace.appendTerminalOutput(event.id, event.data)
    }
  }

  onMounted(() => {
    offData = terminalClient.onTerminalData()?.(handleTerminalData) || null
    offLifecycle = terminalClient.onTerminalLifecycle()?.((event) => workspace.applyTerminalLifecycle(event)) || null
    offExit = terminalClient.onTerminalExit()?.((event) => workspace.applyTerminalExit(event)) || null
    offControlRequest = controlClient.onControlRequest()?.(handleControlRequest) || null
    document.addEventListener('click', closeTerminalMenusFromDocument)
    window.addEventListener('keydown', handleShortcut)
  })

  onUnmounted(() => {
    offData?.()
    offLifecycle?.()
    offExit?.()
    offControlRequest?.()
    terminalControlSurface.dispose()
    terminalZmodemShellRuntime.dispose()
    disposeTerminalViews()
    document.removeEventListener('click', closeTerminalMenusFromDocument)
    window.removeEventListener('keydown', handleShortcut)
  })

  watch(
    () =>
      workspace.panels
        .filter((panel) => panel.kind !== 'knowledge')
        .map((panel) => `${panel.id}:${panel.output.length}:${panel.outputSegments?.length || 0}:${panel.title}`)
        .join('|') + `${workspace.extensionSettings.highlightStatus}|${JSON.stringify(workspace.keywordHighlightSettings)}`,
    () => {
      nextTick(() => workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel)))
    }
  )

  watch(
    () => workspace.panels.map((panel) => panel.id).join('|'),
    syncPanelViews
  )

  watch(
    terminalSettingsSignature,
    applyTerminalSettingsToAll
  )

  watch(
    () => splitLayoutItems.value.map(({ panel, style }) => `${panel.id}:${panel.splitGroupId || ''}:${panel.split || ''}:${JSON.stringify(style)}`).join('|'),
    () => {
      refitAfterLayoutChange()
    },
    { flush: 'post' }
  )

  watch(
    () => workspace.activePanelId,
    (panelId, previousPanelId) => {
      if (previousPanelId && previousPanelId !== panelId && workspace.panels.some((panel) => panel.id === previousPanelId)) {
        terminalControlSurface.recordLastActiveControlPanel(previousPanelId)
      }
      hideCommandDialogForActivePanel(panelId)
    }
  )

  return {
    activeSuggestion,
    activeTerminalContextBar,
    activatePanel,
    aiButtonPanelId,
    aiButtonPosition,
    aiSuggestLoading,
    applyGeneratedCommand,
    applySuggestion,
    approveSecurityPrompt,
    canForkSelected,
    cancelSecurityPrompt,
    cancelZmodemTransfer,
    chatSelectionToAi,
    clearSearchFromButton,
    clearTerminal,
    cloneSelected,
    closeAllTabsFromMenu,
    closeCommandDialog,
    closeCommandLine,
    closeOtherTabsFromMenu,
    closeSearchOverlay,
    closeSelected,
    closeTab,
    closeTerminalFromMenu,
    command,
    commandDialog,
    commandDialogInput,
    commandDialogRef,
    commandDialogStyle,
    commandLineInput,
    commandLinePanelId,
    commandLineStyle,
    connectedTerminalPanels,
    connectionActionLabel,
    connectionActionShortcut,
    controlFlashingPanelIds,
    copyActiveTerminalContext,
    copySelection,
    createTerminalFromMenu,
    decreaseFontFromMenu,
    enterSuggestionSelection,
    findNext,
    findPrevious,
    finishRename,
    forkSelected,
    formatZmodemBytes,
    focusActiveTerminalFromContextBar,
    globalCommand,
    globalInputVisible,
    handlePaneDragEnter,
    handlePaneDragLeave,
    handlePaneDragOver,
    handlePaneDrop,
    handleTabBarDragLeave,
    handleTabBarDragOver,
    handleTabBarDrop,
    handleTabDragEnd,
    handleTabDragEnter,
    handleTabDragLeave,
    handleTabDragOver,
    handleTabDragStart,
    handleTabDrop,
    handleTerminalContextMenu,
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    handleTerminalWheel,
    hasAiSuggestion,
    increaseFontFromMenu,
    isTerminalMenuPanel,
    menu,
    moveSuggestion,
    openAiSessionsFromContextBar,
    openCommandDialogFromTabMenu,
    openCommandDialogFromTermMenu,
    openCommandLineFromMenu,
    openFileManagerFromMenu,
    openMenu,
    openSearchOverlay,
    panelById,
    paneDragOverPanelId,
    panelNeedsAiAttention,
    pasteClipboard,
    refreshAiSessionsFromContextBar,
    renameSelected,
    renameText,
    renamingId,
    resizeCommandDialogInput,
    search,
    searchMatchCount,
    searchMatchIndex,
    searchOverlayInput,
    searchOverlayPanelId,
    sendCommand,
    sendGlobalCommand,
    setTerminalElement,
    showTerminalDashboard,
    splitFromTermMenu,
    splitLayoutItems,
    splitSelected,
    startRename,
    submitCommandDialog,
    suggestionItems,
    suggestionPanel,
    suggestionPosition,
    suggestionSelectionMode,
    t,
    tabBarDragOver,
    tabDragOverPanelId,
    termMenu,
    terminalGrid,
    terminalGridClasses,
    terminalStatusLabel,
    terminalTabKindBadge,
    terminalTabMeta,
    terminalTabTooltip,
    toggleGlobalInput,
    togglePanelConnection,
    toggleTabConnectionFromMenu,
    triggerAiSuggestion,
    unsplitFromTermMenu,
    unsplitSelected,
    updateSuggestions,
    visibleTerminalTabPanels,
    workspace,
    zmodemPercent,
    zmodemProgress,
  }
}
