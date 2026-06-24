import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useTerminalControlSurface, type TerminalControlSurfaceView } from '@/composables/useTerminalControlSurface'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { controlClient } from '@/services/app/controlClient'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import { terminalClient } from '@/services/terminal/terminalClient'
import { createTerminalWorkspaceCommandRuntime, createTerminalWorkspaceCommandState } from '@/services/terminal/terminalWorkspaceCommandRuntime'
import { createTerminalWorkspaceContextRuntime } from '@/services/terminal/terminalWorkspaceContextRuntime'
import { createTerminalWorkspaceLayoutRuntime } from '@/services/terminal/terminalWorkspaceLayoutRuntime'
import { createTerminalWorkspaceSessionRuntime } from '@/services/terminal/terminalWorkspaceSessionRuntime'
import { createTerminalWorkspaceShellRuntime, createTerminalWorkspaceShellState } from '@/services/terminal/terminalWorkspaceShellRuntime'
import { createTerminalWorkspaceViewRuntime } from '@/services/terminal/terminalWorkspaceViewRuntime'
import { createTerminalWorkspaceZmodemShellRuntime } from '@/services/terminal/terminalWorkspaceZmodemShellRuntime'
import { useI18n } from '@/i18n'
import type { TerminalDataEvent } from '@shared/contracts/terminalSessions'

type TerminalDataPerfSummary = {
  chunks: number
  bytes: number
  firstAt: number
  lastAt: number
  appendMs: number
  zmodemMs: number
  maxAppendMs: number
  maxZmodemMs: number
  maxChunkBytes: number
  zmodemChunks: number
}

const terminalDataSummaryIntervalMs = 1000
const terminalDataSummaryChunkThreshold = 50
const terminalDataSlowThresholdMs = 16

const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
const textByteLength = (value: string) => new TextEncoder().encode(value).length

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
  const terminalDataPerf = new Map<string, TerminalDataPerfSummary>()

  const logTerminalDataSummary = (sessionId: string, summary: TerminalDataPerfSummary, reason: string) => {
    writeRendererRuntimeLog('debug', 'renderer.terminal-data.summary', {
      sessionId,
      reason,
      chunks: summary.chunks,
      bytes: summary.bytes,
      durationMs: Math.max(0, Math.round(summary.lastAt - summary.firstAt)),
      appendMs: Math.round(summary.appendMs * 10) / 10,
      zmodemMs: Math.round(summary.zmodemMs * 10) / 10,
      maxAppendMs: Math.round(summary.maxAppendMs * 10) / 10,
      maxZmodemMs: Math.round(summary.maxZmodemMs * 10) / 10,
      maxChunkBytes: summary.maxChunkBytes,
      zmodemChunks: summary.zmodemChunks
    })
  }

  const flushTerminalDataPerf = (sessionId: string, reason: string) => {
    const summary = terminalDataPerf.get(sessionId)
    if (!summary) return
    logTerminalDataSummary(sessionId, summary, reason)
    terminalDataPerf.delete(sessionId)
  }

  const recordTerminalDataPerf = (
    sessionId: string,
    metrics: { bytes: number; appendMs: number; zmodemMs: number; handledByZmodem: boolean }
  ) => {
    const now = nowMs()
    const existing = terminalDataPerf.get(sessionId)
    const summary =
      existing ||
      {
        chunks: 0,
        bytes: 0,
        firstAt: now,
        lastAt: now,
        appendMs: 0,
        zmodemMs: 0,
        maxAppendMs: 0,
        maxZmodemMs: 0,
        maxChunkBytes: 0,
        zmodemChunks: 0
      }
    summary.chunks += 1
    summary.bytes += metrics.bytes
    summary.lastAt = now
    summary.appendMs += metrics.appendMs
    summary.zmodemMs += metrics.zmodemMs
    summary.maxAppendMs = Math.max(summary.maxAppendMs, metrics.appendMs)
    summary.maxZmodemMs = Math.max(summary.maxZmodemMs, metrics.zmodemMs)
    summary.maxChunkBytes = Math.max(summary.maxChunkBytes, metrics.bytes)
    if (metrics.handledByZmodem) summary.zmodemChunks += 1
    terminalDataPerf.set(sessionId, summary)
    if (metrics.appendMs >= terminalDataSlowThresholdMs || metrics.zmodemMs >= terminalDataSlowThresholdMs) {
      writeRendererRuntimeLog('warn', 'renderer.terminal-data.slow-handle', {
        sessionId,
        bytes: metrics.bytes,
        appendMs: Math.round(metrics.appendMs * 10) / 10,
        zmodemMs: Math.round(metrics.zmodemMs * 10) / 10,
        handledByZmodem: metrics.handledByZmodem
      })
    }
    if (summary.lastAt - summary.firstAt >= terminalDataSummaryIntervalMs || summary.chunks >= terminalDataSummaryChunkThreshold) {
      flushTerminalDataPerf(sessionId, summary.chunks >= terminalDataSummaryChunkThreshold ? 'chunk-threshold' : 'interval')
    }
  }
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
    appendData: (sessionId, data) => {
      workspace.appendTerminalOutput(sessionId, data)
      const panel = workspace.panels.find((item) => item.id === sessionId || item.sessionId === sessionId)
      if (panel) syncTerminalView(panel)
    },
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
    const zmodemStartedAt = nowMs()
    const handledByZmodem = handleTerminalZmodemData(event)
    const zmodemMs = nowMs() - zmodemStartedAt
    let appendMs = 0
    if (!handledByZmodem) {
      const appendStartedAt = nowMs()
      workspace.appendTerminalOutput(event.id, event.data)
      appendMs = nowMs() - appendStartedAt
      const panel = workspace.panels.find((item) => item.id === event.id || item.sessionId === event.id)
      if (panel) syncTerminalView(panel)
    }
    recordTerminalDataPerf(event.id, {
      bytes: textByteLength(event.data || ''),
      appendMs,
      zmodemMs,
      handledByZmodem
    })
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
    terminalDataPerf.forEach((_summary, sessionId) => flushTerminalDataPerf(sessionId, 'runtime-unmounted'))
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
        .map((panel) => `${panel.id}:${panel.title}`)
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
      nextTick(() => visibleTerminalPanels.value.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => syncTerminalView(panel)))
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
