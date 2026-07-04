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
import { isThreadedTerminalHost } from '@/services/terminal/threadedTerminalRuntime'
import { useI18n } from '@/i18n'
import type { TerminalStressQueueSample } from '@/services/terminal/terminalStressHarness'
import type { TerminalDataEvent } from '@shared/contracts/terminalSessions'
import { shouldUseTerminalDebugLogs, shouldUseTerminalStressHarness } from '@shared/runtimeSwitches'

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

type TerminalHistoryBatch = {
  data: string
  bytes: number
}

type TerminalIngressBatch = {
  data: string
  bytes: number
  chunks: number
  zmodemMs: number
  dueAt: number
}

type TerminalThreadedDirectIngress = {
  sessionId: string
  panel: TerminalPanel
  bytes: number
}

const terminalDataSummaryDebugIntervalMs = 1000
const terminalDataSummaryFormalIntervalMs = 10_000
const terminalDataSummaryDebugChunkThreshold = 50
const terminalDataSummaryFormalChunkThreshold = 1000
const terminalDataSummaryDebugByteThreshold = 1024 * 1024
const terminalDataSummaryFormalByteThreshold = 8 * 1024 * 1024
const terminalDataSlowThresholdMs = 16
const terminalHistoryFlushMs = 500
const terminalHistoryMaxBatchBytes = 256 * 1024
const terminalHistoryFlushPanelsPerSlice = 2
const terminalHistoryVisibleMirrorTailBytes = 128 * 1024
const terminalHistoryBackgroundMirrorTailBytes = 32 * 1024
const terminalThreadedVisibleMirrorTailBytes = 32 * 1024
const terminalThreadedBackgroundMirrorTailBytes = 8 * 1024
const terminalThreadedHistoryFlushMs = 1000
const terminalIngressActiveFlushMs = 8
const terminalIngressVisibleFlushMs = 16
const terminalIngressBackgroundFlushMs = 64
const terminalIngressMaxBatchBytes = 64 * 1024
const terminalIngressFlushPanelsPerSlice = 8

const terminalTextEncoder = new TextEncoder()
const terminalTextDecoder = new TextDecoder()
const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
const textByteLength = (value: string) => terminalTextEncoder.encode(value).length
const detachText = (value: string) => (value ? terminalTextDecoder.decode(terminalTextEncoder.encode(value)) : '')
const tailTextByBytes = (value: string, maxBytes: number) => {
  if (!value) return ''
  if (textByteLength(value) <= maxBytes) return detachText(value)
  let start = Math.max(0, value.length - maxBytes)
  while (start < value.length && textByteLength(value.slice(start)) > maxBytes) {
    start += Math.max(1, Math.floor((value.length - start) / 4))
  }
  const nextLine = value.indexOf('\n', start)
  return detachText(value.slice(nextLine >= 0 && nextLine + 1 < value.length ? nextLine + 1 : start))
}
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
  let terminalRuntimeMounted = false
  let uninstallTerminalStressHarness: (() => void) | null = null
  const terminalDataPerf = new Map<string, TerminalDataPerfSummary>()
  const terminalHistoryBatches = new Map<string, TerminalHistoryBatch>()
  const terminalIngressBatches = new Map<string, TerminalIngressBatch>()
  let terminalHistoryFlushTimer: number | null = null
  let terminalHistoryFlushDueAt = 0
  let terminalIngressFlushTimer: number | null = null
  let terminalIngressFlushDueAt = 0
  const terminalDebugLogs = shouldUseTerminalDebugLogs()
  const terminalDataSummaryIntervalMs = terminalDebugLogs ? terminalDataSummaryDebugIntervalMs : terminalDataSummaryFormalIntervalMs
  const terminalDataSummaryChunkThreshold = terminalDebugLogs ? terminalDataSummaryDebugChunkThreshold : terminalDataSummaryFormalChunkThreshold
  const terminalDataSummaryByteThreshold = terminalDebugLogs ? terminalDataSummaryDebugByteThreshold : terminalDataSummaryFormalByteThreshold

  const logTerminalDataSummary = (sessionId: string, summary: TerminalDataPerfSummary, reason: string) => {
    if (!terminalDebugLogs) return
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

  const flushTerminalHistoryBatch = (sessionId: string) => {
    const batch = terminalHistoryBatches.get(sessionId)
    if (!batch) return
    terminalHistoryBatches.delete(sessionId)
    if (!batch.data) return
    const panel = workspace.panels.find((item) => item.id === sessionId || item.sessionId === sessionId)
    if (!panel || panel.kind === 'knowledge') return
    const maxBytes = terminalHistoryMirrorTailBytesForPanel(panel)
    workspace.replaceTerminalOutput(panel.id, tailTextByBytes(`${panel.output || ''}${batch.data}`, maxBytes))
  }

  const flushTerminalHistoryBatches = () => {
    terminalHistoryFlushTimer = null
    terminalHistoryFlushDueAt = 0
    Array.from(terminalHistoryBatches.keys())
      .slice(0, terminalHistoryFlushPanelsPerSlice)
      .forEach(flushTerminalHistoryBatch)
    if (terminalHistoryBatches.size) scheduleTerminalHistoryFlush()
  }

  const scheduleTerminalHistoryFlush = (delayMs = terminalHistoryFlushMs) => {
    const dueAt = nowMs() + delayMs
    if (terminalHistoryFlushTimer !== null) {
      if (dueAt >= terminalHistoryFlushDueAt) return
      window.clearTimeout(terminalHistoryFlushTimer)
    }
    terminalHistoryFlushDueAt = dueAt
    terminalHistoryFlushTimer = window.setTimeout(flushTerminalHistoryBatches, Math.max(0, dueAt - nowMs()))
  }

  const appendTerminalHistoryBatched = (sessionId: string, data: string, options: { flushMs?: number } = {}) => {
    if (!data) return
    const bytes = textByteLength(data)
    const panel = workspace.panels.find((item) => item.id === sessionId || item.sessionId === sessionId)
    const maxBytes = terminalHistoryMirrorTailBytesForPanel(panel)
    const existing = terminalHistoryBatches.get(sessionId)
    const batch = existing || { data: '', bytes: 0 }
    batch.data += data
    batch.bytes += bytes
    if (batch.bytes > maxBytes) {
      batch.data = tailTextByBytes(batch.data, maxBytes)
      batch.bytes = textByteLength(batch.data)
    }
    terminalHistoryBatches.set(sessionId, batch)
    if (batch.bytes >= terminalHistoryMaxBatchBytes) {
      flushTerminalHistoryBatch(sessionId)
      return
    }
    scheduleTerminalHistoryFlush(options.flushMs)
  }

  const sampleTerminalQueues = (): TerminalStressQueueSample => {
    const ingress = Array.from(terminalIngressBatches.values())
    const history = Array.from(terminalHistoryBatches.values())
    return {
      at: nowMs(),
      ingressPanels: terminalIngressBatches.size,
      ingressBytes: ingress.reduce((total, batch) => total + batch.bytes, 0),
      ingressChunks: ingress.reduce((total, batch) => total + batch.chunks, 0),
      historyPanels: terminalHistoryBatches.size,
      historyBytes: history.reduce((total, batch) => total + batch.bytes, 0)
    }
  }

  const terminalIngressDelayForPanel = (panel?: TerminalPanel | null) => {
    if (!panel) return terminalIngressVisibleFlushMs
    if (panel.id === workspace.activePanelId) return terminalIngressActiveFlushMs
    if (visibleTerminalPanels.value.some((item) => item.id === panel.id)) return terminalIngressVisibleFlushMs
    return terminalIngressBackgroundFlushMs
  }

  const applyTerminalDataBatch = (sessionId: string, data: string) => {
    if (!data) return 0
    const appendStartedAt = nowMs()
    const panel = workspace.panels.find((item) => item.id === sessionId || item.sessionId === sessionId)
    const handledLive = panel ? writeLiveTerminalData(sessionId, data) : false
    if (handledLive) {
      appendTerminalHistoryBatched(sessionId, data)
    } else {
      workspace.appendTerminalOutput(sessionId, data)
      if (panel) syncTerminalView(panel)
    }
    return nowMs() - appendStartedAt
  }

  const flushTerminalIngressBatch = (sessionId: string) => {
    const batch = terminalIngressBatches.get(sessionId)
    if (!batch) return
    terminalIngressBatches.delete(sessionId)
    const appendMs = applyTerminalDataBatch(sessionId, batch.data)
    recordTerminalDataPerf(sessionId, {
      bytes: batch.bytes,
      appendMs,
      zmodemMs: batch.zmodemMs,
      handledByZmodem: false
    })
  }

  const scheduleTerminalIngressFlush = () => {
    if (!terminalIngressBatches.size) return
    const now = nowMs()
    const nextDueAt = Math.min(...Array.from(terminalIngressBatches.values()).map((batch) => batch.dueAt))
    if (terminalIngressFlushTimer !== null) {
      if (nextDueAt >= terminalIngressFlushDueAt) return
      window.clearTimeout(terminalIngressFlushTimer)
    }
    terminalIngressFlushDueAt = nextDueAt
    terminalIngressFlushTimer = window.setTimeout(flushTerminalIngressBatches, Math.max(0, nextDueAt - now))
  }

  const flushTerminalIngressBatches = () => {
    terminalIngressFlushTimer = null
    terminalIngressFlushDueAt = 0
    const now = nowMs()
    const dueSessionIds = Array.from(terminalIngressBatches.entries())
      .filter(([, batch]) => batch.dueAt <= now)
      .sort((a, b) => a[1].dueAt - b[1].dueAt)
      .slice(0, terminalIngressFlushPanelsPerSlice)
      .map(([sessionId]) => sessionId)
    dueSessionIds.forEach(flushTerminalIngressBatch)
    scheduleTerminalIngressFlush()
  }

  const queueTerminalIngressData = (sessionId: string, data: string, zmodemMs: number) => {
    if (!data) return
    const bytes = textByteLength(data)
    const existing = terminalIngressBatches.get(sessionId)
    const panel = workspace.panels.find((item) => item.id === sessionId || item.sessionId === sessionId)
    const dueAt = nowMs() + terminalIngressDelayForPanel(panel)
    const batch = existing || { data: '', bytes: 0, chunks: 0, zmodemMs: 0, dueAt }
    batch.data += data
    batch.bytes += bytes
    batch.chunks += 1
    batch.zmodemMs += zmodemMs
    batch.dueAt = Math.min(batch.dueAt, dueAt)
    terminalIngressBatches.set(sessionId, batch)
    if (batch.bytes >= terminalIngressMaxBatchBytes) {
      flushTerminalIngressBatch(sessionId)
      return
    }
    scheduleTerminalIngressFlush()
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
    if (
      summary.lastAt - summary.firstAt >= terminalDataSummaryIntervalMs ||
      summary.chunks >= terminalDataSummaryChunkThreshold ||
      summary.bytes >= terminalDataSummaryByteThreshold
    ) {
      flushTerminalDataPerf(
        sessionId,
        summary.bytes >= terminalDataSummaryByteThreshold
          ? 'byte-threshold'
          : summary.chunks >= terminalDataSummaryChunkThreshold
            ? 'chunk-threshold'
            : 'interval'
      )
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
    setTerminalKeyboardShortcutHandler,
    setTerminalElement,
    syncPanelViews,
    syncTerminalView,
    terminalSettingsSignature,
    terminalViewSize,
    terminalViews,
    terminalFontSizeForPanel,
    terminalOutputMirrorText,
    syncThreadedKeywordHighlight,
    updateFontSize,
    writeLiveTerminalData,
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

  const threadedDirectIngressForEvent = (event: TerminalDataEvent): TerminalThreadedDirectIngress | null => {
    const data = event.data || ''
    if (!event.id || !data) return null
    const panel = workspace.panels.find((item) => item.id === event.id || item.sessionId === event.id)
    if (!panel || panel.kind === 'knowledge') return null
    const view = terminalViews.get(panel.id)
    if (!view || !isThreadedTerminalHost(view.terminal)) return null
    return {
      sessionId: panel.sessionId || panel.id,
      panel,
      bytes: textByteLength(data)
    }
  }

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
    findNext,
    findPrevious,
    focusActivePanel,
    focusCommandDialogInput,
    focusPanel,
    getCommandDialogInput,
    clearSearchFromButton,
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
  setTerminalKeyboardShortcutHandler(handleTerminalKeyboardShortcut)

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

  const terminalHistoryMirrorTailBytesForPanel = (panel?: TerminalPanel | null) => {
    if (!panel || panel.kind === 'knowledge') return terminalHistoryBackgroundMirrorTailBytes
    const view = terminalViews.get(panel.id)
    const threaded = Boolean(view && isThreadedTerminalHost(view.terminal))
    if (panel.id === workspace.activePanelId) return threaded ? terminalThreadedVisibleMirrorTailBytes : terminalHistoryVisibleMirrorTailBytes
    if (visibleTerminalPanels.value.some((item) => item.id === panel.id)) return threaded ? terminalThreadedVisibleMirrorTailBytes : terminalHistoryVisibleMirrorTailBytes
    return threaded ? terminalThreadedBackgroundMirrorTailBytes : terminalHistoryBackgroundMirrorTailBytes
  }

  const handleTerminalData = (event: TerminalDataEvent) => {
    const threaded = threadedDirectIngressForEvent(event)
    if (threaded) {
      const appendStartedAt = nowMs()
      const handledLive = writeLiveTerminalData(threaded.panel.id, event.data)
      const appendMs = nowMs() - appendStartedAt
      if (handledLive) {
        appendTerminalHistoryBatched(threaded.sessionId, event.data, {
          flushMs: terminalThreadedHistoryFlushMs
        })
        recordTerminalDataPerf(threaded.sessionId, {
          bytes: threaded.bytes,
          appendMs,
          zmodemMs: 0,
          handledByZmodem: false
        })
        return
      }
    }
    const zmodemStartedAt = nowMs()
    const handledByZmodem = handleTerminalZmodemData(event)
    const zmodemMs = nowMs() - zmodemStartedAt
    if (handledByZmodem) {
      recordTerminalDataPerf(event.id, {
        bytes: textByteLength(event.data || ''),
        appendMs: 0,
        zmodemMs,
        handledByZmodem
      })
      return
    }
    queueTerminalIngressData(event.id, event.data, zmodemMs)
  }

  const flushAllTerminalIngressBatches = () => {
    Array.from(terminalIngressBatches.keys()).forEach(flushTerminalIngressBatch)
  }

  const flushAllTerminalHistoryBatches = () => {
    Array.from(terminalHistoryBatches.keys()).forEach(flushTerminalHistoryBatch)
  }

  onMounted(() => {
    terminalRuntimeMounted = true
    offData = terminalClient.onTerminalData()?.(handleTerminalData) || null
    offLifecycle = terminalClient.onTerminalLifecycle()?.((event) => workspace.applyTerminalLifecycle(event)) || null
    offExit = terminalClient.onTerminalExit()?.((event) => workspace.applyTerminalExit(event)) || null
    offControlRequest = controlClient.onControlRequest()?.(handleControlRequest) || null
    document.addEventListener('click', closeTerminalMenusFromDocument)
    window.addEventListener('keydown', handleShortcut)
    if (shouldUseTerminalStressHarness()) {
      void import('@/services/terminal/terminalStressHarness').then(({ installTerminalStressHarness }) => {
        if (!terminalRuntimeMounted) return
        uninstallTerminalStressHarness?.()
        uninstallTerminalStressHarness = installTerminalStressHarness({
          workspace,
          visibleTerminalPanels,
          terminalViews,
          getTerminalElement,
          syncPanelViews,
          syncTerminalView,
          scheduleVisibleTerminalFit,
          startLocalTerminalForPanel,
          queueTerminalIngressData,
          flushTerminalIngressBatch,
          flushAllTerminalIngressBatches,
          flushAllTerminalHistoryBatches,
          appendTerminalHistoryBatched,
          sampleQueues: sampleTerminalQueues
        })
      }).catch((error) => {
        writeRendererRuntimeLog('error', 'renderer.terminal-stress.install-failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  })

  onUnmounted(() => {
    terminalRuntimeMounted = false
    uninstallTerminalStressHarness?.()
    uninstallTerminalStressHarness = null
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
    if (terminalIngressFlushTimer !== null) {
      window.clearTimeout(terminalIngressFlushTimer)
      terminalIngressFlushTimer = null
      terminalIngressFlushDueAt = 0
    }
    terminalIngressBatches.clear()
    if (terminalHistoryFlushTimer !== null) {
      window.clearTimeout(terminalHistoryFlushTimer)
      terminalHistoryFlushTimer = null
      terminalHistoryFlushDueAt = 0
    }
    flushTerminalHistoryBatches()
  })

  watch(
    () =>
      workspace.panels
        .filter((panel) => panel.kind !== 'knowledge')
        .map((panel) => `${panel.id}:${panel.title}`)
        .join('|') + `${workspace.extensionSettings.highlightStatus}|${JSON.stringify(workspace.keywordHighlightSettings)}`,
    () => {
      nextTick(() => {
        syncThreadedKeywordHighlight()
        workspace.panels
          .filter((panel) => panel.kind !== 'knowledge')
          .forEach((panel) => {
            const view = terminalViews.get(panel.id)
            if (view && isThreadedTerminalHost(view.terminal)) return
            syncTerminalView(panel)
          })
      })
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
    canForkTerminalMenuPanel,
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
    forkFromTermMenu,
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
    terminalOutputMirrorText,
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
