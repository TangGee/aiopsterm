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
import { getThreadedTerminalDebugStats, isThreadedTerminalHost } from '@/services/terminal/threadedTerminalRuntime'
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

type TerminalStressHarnessResult = {
  profile: TerminalStressProfileName
  foreground: number
  background: number
  durationMs: number
  writtenBytes: number
  writes: TerminalStressWriteSummary
  frames: number
  avgFrameMs: number
  p95FrameMs: number
  p99FrameMs: number
  maxFrameMs: number
  panels: number
  threaded: ReturnType<typeof getThreadedTerminalDebugStats>
  paintLatency: TerminalStressMetricSummary
  paintFrameMs: TerminalStressMetricSummary
  paintRows: TerminalStressMetricSummary
  paintScrollRows: TerminalStressMetricSummary
  paintFullFrames: number
  paintFullReasons: Record<string, number>
  paintRepaintReasons: Record<string, number>
  realEchoLatency: TerminalStressMetricSummary & { available: boolean; error?: string }
  memory: TerminalStressMemorySummary
  queues: TerminalStressQueueSummary
  switches: TerminalStressSwitchSummary
  canvasCount: {
    before: number
    after: number
  }
  errors: string[]
}

type TerminalStressMetricSummary = {
  samples: number
  avg: number
  p50: number
  p95: number
  p99: number
  max: number
}

type TerminalStressMemorySample = {
  at: number
  phase: string
  jsHeapUsedBytes?: number
  jsHeapTotalBytes?: number
  jsHeapLimitBytes?: number
  workingSetSizeKb?: number
  privateBytesKb?: number
  canvasCount: number
  threadedHostCount: number
  gcRuns?: number
}

type TerminalStressMemorySummary = {
  samples: TerminalStressMemorySample[]
  jsHeapUsedDeltaBytes?: number
  jsHeapUsedMaxBytes?: number
  workingSetDeltaKb?: number
  workingSetMaxKb?: number
  gcSupported: boolean
  gcRuns: number
  endBeforeGcHeapUsedBytes?: number
  endAfterGcHeapUsedBytes?: number
  postGcHeapDeltaBytes?: number
}

type TerminalStressQueueSample = {
  at: number
  ingressPanels: number
  ingressBytes: number
  ingressChunks: number
  historyPanels: number
  historyBytes: number
}

type TerminalStressQueueSummary = {
  samples: TerminalStressQueueSample[]
  maxIngressPanels: number
  maxIngressBytes: number
  maxIngressChunks: number
  maxHistoryPanels: number
  maxHistoryBytes: number
}

type TerminalStressSwitchSummary = {
  enabled: boolean
  intervalMs: number
  count: number
  failed: number
  paintLatency: TerminalStressMetricSummary
}

type TerminalStressProfileName = 'frame-small-chunk' | 'pty-burst' | 'mixed-background' | 'mixed-switch'

type TerminalStressProfile = {
  foregroundIntervalMs: number
  backgroundIntervalMs: number
  foregroundChunks: number
  backgroundChunks: number
  foregroundLinesPerChunk: number
  backgroundLinesPerChunk: number
  foregroundPayloadBytes: number
  backgroundPayloadBytes: number
}

type TerminalStressWriteSummary = {
  foregroundWrites: number
  backgroundWrites: number
  foregroundChunks: number
  backgroundChunks: number
  foregroundBytes: number
  backgroundBytes: number
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

declare global {
  interface Window {
    __AIOPSTERM_TERMINAL_STRESS__?: {
      run: (options?: { foreground?: number; background?: number; durationMs?: number; switchIntervalMs?: number; profile?: TerminalStressProfileName }) => Promise<TerminalStressHarnessResult>
    }
  }
}

const terminalDataSummaryIntervalMs = 1000
const terminalDataSummaryChunkThreshold = 50
const terminalDataSlowThresholdMs = 16
const terminalHistoryFlushMs = 500
const terminalHistoryMaxBatchBytes = 256 * 1024
const terminalHistoryFlushPanelsPerSlice = 2
const terminalHistoryVisibleMirrorTailBytes = 128 * 1024
const terminalHistoryBackgroundMirrorTailBytes = 32 * 1024
const terminalThreadedVisibleMirrorTailBytes = 32 * 1024
const terminalThreadedBackgroundMirrorTailBytes = 8 * 1024
const terminalIngressActiveFlushMs = 8
const terminalIngressVisibleFlushMs = 16
const terminalIngressBackgroundFlushMs = 64
const terminalIngressMaxBatchBytes = 64 * 1024
const terminalIngressFlushPanelsPerSlice = 8
const terminalStressProfiles: Record<TerminalStressProfileName, TerminalStressProfile> = {
  'frame-small-chunk': {
    foregroundIntervalMs: 16,
    backgroundIntervalMs: 16,
    foregroundChunks: 1,
    backgroundChunks: 1,
    foregroundLinesPerChunk: 1,
    backgroundLinesPerChunk: 1,
    foregroundPayloadBytes: 96,
    backgroundPayloadBytes: 96
  },
  'pty-burst': {
    foregroundIntervalMs: 64,
    backgroundIntervalMs: 128,
    foregroundChunks: 4,
    backgroundChunks: 4,
    foregroundLinesPerChunk: 2,
    backgroundLinesPerChunk: 3,
    foregroundPayloadBytes: 128,
    backgroundPayloadBytes: 160
  },
  'mixed-background': {
    foregroundIntervalMs: 16,
    backgroundIntervalMs: 96,
    foregroundChunks: 1,
    backgroundChunks: 4,
    foregroundLinesPerChunk: 1,
    backgroundLinesPerChunk: 2,
    foregroundPayloadBytes: 96,
    backgroundPayloadBytes: 160
  },
  'mixed-switch': {
    foregroundIntervalMs: 16,
    backgroundIntervalMs: 96,
    foregroundChunks: 1,
    backgroundChunks: 4,
    foregroundLinesPerChunk: 1,
    backgroundLinesPerChunk: 2,
    foregroundPayloadBytes: 96,
    backgroundPayloadBytes: 160
  }
}

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
const terminalStressHarnessEnabled = () => {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  if (viteEnv?.VITE_AIOPSTERM_TERMINAL_STRESS === '1') return true
  try {
    return typeof process !== 'undefined' && process.env?.AIOPSTERM_TERMINAL_STRESS === '1'
  } catch {
    return false
  }
}

const terminalStressMetricSummary = (values: number[]): TerminalStressMetricSummary => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * value)))] || 0
  return {
    samples: sorted.length,
    avg: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1] || 0
  }
}
const findLastStressSample = (samples: TerminalStressMemorySample[], phase: string) => {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index]?.phase === phase) return samples[index]
  }
  return undefined
}
const terminalStressProfileFor = (name?: string): { name: TerminalStressProfileName; profile: TerminalStressProfile } => {
  if (name && name in terminalStressProfiles) {
    const profileName = name as TerminalStressProfileName
    return { name: profileName, profile: terminalStressProfiles[profileName] }
  }
  return { name: 'mixed-switch', profile: terminalStressProfiles['mixed-switch'] }
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
  const terminalDataPerf = new Map<string, TerminalDataPerfSummary>()
  const terminalHistoryBatches = new Map<string, TerminalHistoryBatch>()
  const terminalIngressBatches = new Map<string, TerminalIngressBatch>()
  let terminalHistoryFlushTimer: number | null = null
  let terminalIngressFlushTimer: number | null = null
  let terminalIngressFlushDueAt = 0

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
    Array.from(terminalHistoryBatches.keys())
      .slice(0, terminalHistoryFlushPanelsPerSlice)
      .forEach(flushTerminalHistoryBatch)
    if (terminalHistoryBatches.size) scheduleTerminalHistoryFlush()
  }

  const scheduleTerminalHistoryFlush = () => {
    if (terminalHistoryFlushTimer !== null) return
    terminalHistoryFlushTimer = window.setTimeout(flushTerminalHistoryBatches, terminalHistoryFlushMs)
  }

  const appendTerminalHistoryBatched = (sessionId: string, data: string) => {
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
    scheduleTerminalHistoryFlush()
  }

  const sampleStressQueues = (): TerminalStressQueueSample => {
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

  const summarizeStressQueues = (samples: TerminalStressQueueSample[]): TerminalStressQueueSummary => ({
    samples,
    maxIngressPanels: samples.reduce((max, sample) => Math.max(max, sample.ingressPanels), 0),
    maxIngressBytes: samples.reduce((max, sample) => Math.max(max, sample.ingressBytes), 0),
    maxIngressChunks: samples.reduce((max, sample) => Math.max(max, sample.ingressChunks), 0),
    maxHistoryPanels: samples.reduce((max, sample) => Math.max(max, sample.historyPanels), 0),
    maxHistoryBytes: samples.reduce((max, sample) => Math.max(max, sample.historyBytes), 0)
  })

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

  const terminalHistoryMirrorTailBytesForPanel = (panel?: TerminalPanel | null) => {
    if (!panel || panel.kind === 'knowledge') return terminalHistoryBackgroundMirrorTailBytes
    const view = terminalViews.get(panel.id)
    const threaded = Boolean(view && isThreadedTerminalHost(view.terminal))
    if (panel.id === workspace.activePanelId) return threaded ? terminalThreadedVisibleMirrorTailBytes : terminalHistoryVisibleMirrorTailBytes
    if (visibleTerminalPanels.value.some((item) => item.id === panel.id)) return threaded ? terminalThreadedVisibleMirrorTailBytes : terminalHistoryVisibleMirrorTailBytes
    return threaded ? terminalThreadedBackgroundMirrorTailBytes : terminalHistoryBackgroundMirrorTailBytes
  }

  const handleTerminalData = (event: TerminalDataEvent) => {
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

  const ensureStressPanels = async (foreground: number, background: number) => {
    const targetForeground = Math.max(1, foreground)
    const targetBackground = Math.max(0, background)
    while (workspace.panels.filter((panel) => panel.kind !== 'knowledge' && panel.splitGroupId).length < targetForeground) {
      const active = workspace.panels.find((panel) => panel.id === workspace.activePanelId && panel.kind !== 'knowledge') || workspace.panels.find((panel) => panel.kind !== 'knowledge')
      if (active) workspace.activePanelId = active.id
      const panel = workspace.createPanel(workspace.panels.filter((item) => item.splitGroupId).length % 2 === 0 ? 'right' : 'below')
      panel.title = `Stress FG ${workspace.panels.length}`
      panel.sessionId = panel.sessionId || `stress-fg-${panel.id}`
      panel.status = 'running'
      await nextTick()
    }
    while (workspace.panels.filter((panel) => panel.kind !== 'knowledge').length < targetForeground + targetBackground) {
      const panel = workspace.createPanel()
      panel.title = `Stress BG ${workspace.panels.length}`
      panel.sessionId = panel.sessionId || `stress-bg-${panel.id}`
      panel.status = 'running'
    }
    const foregroundPanel = workspace.panels.find((panel) => panel.kind !== 'knowledge' && panel.splitGroupId)
    if (foregroundPanel) workspace.activePanelId = foregroundPanel.id
    await nextTick()
    syncPanelViews()
    await nextTick()
  }

  const runStressGarbageCollection = async (runs = 2) => {
    const globalWithGc = globalThis as typeof globalThis & { gc?: () => void }
    if (typeof globalWithGc.gc !== 'function') return { supported: false, runs: 0 }
    for (let index = 0; index < runs; index += 1) {
      globalWithGc.gc()
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    return { supported: true, runs }
  }

  const sampleStressMemory = async (phase = 'sample', gcRuns?: number): Promise<TerminalStressMemorySample> => {
    const performanceMemory = (performance as Performance & {
      memory?: {
        usedJSHeapSize?: number
        totalJSHeapSize?: number
        jsHeapSizeLimit?: number
      }
    }).memory
    const processLike = (globalThis as {
      process?: {
        getProcessMemoryInfo?: () => Promise<{ workingSetSize?: number; privateBytes?: number }>
      }
    }).process
    let processMemory: { workingSetSize?: number; privateBytes?: number } | undefined
    try {
      processMemory = processLike?.getProcessMemoryInfo ? await processLike.getProcessMemoryInfo() : undefined
    } catch {
      processMemory = undefined
    }
    return {
      at: nowMs(),
      phase,
      jsHeapUsedBytes: performanceMemory?.usedJSHeapSize,
      jsHeapTotalBytes: performanceMemory?.totalJSHeapSize,
      jsHeapLimitBytes: performanceMemory?.jsHeapSizeLimit,
      workingSetSizeKb: processMemory?.workingSetSize,
      privateBytesKb: processMemory?.privateBytes,
      canvasCount: document.querySelectorAll('canvas').length,
      threadedHostCount: getThreadedTerminalDebugStats().hostCount,
      gcRuns
    }
  }

  const summarizeStressMemory = (samples: TerminalStressMemorySample[]): TerminalStressMemorySummary => {
    const first = samples[0]
    const last = samples.at(-1)
    const postGc = findLastStressSample(samples, 'post-gc')
    const endBeforeGc = findLastStressSample(samples, 'end-before-gc')
    const jsHeapValues = samples.map((sample) => sample.jsHeapUsedBytes).filter((value): value is number => typeof value === 'number')
    const workingSetValues = samples.map((sample) => sample.workingSetSizeKb).filter((value): value is number => typeof value === 'number')
    const gcRuns = samples.reduce((total, sample) => total + (sample.gcRuns || 0), 0)
    return {
      samples,
      jsHeapUsedDeltaBytes:
        typeof first?.jsHeapUsedBytes === 'number' && typeof last?.jsHeapUsedBytes === 'number'
          ? last.jsHeapUsedBytes - first.jsHeapUsedBytes
          : undefined,
      jsHeapUsedMaxBytes: jsHeapValues.length ? Math.max(...jsHeapValues) : undefined,
      workingSetDeltaKb:
        typeof first?.workingSetSizeKb === 'number' && typeof last?.workingSetSizeKb === 'number'
          ? last.workingSetSizeKb - first.workingSetSizeKb
          : undefined,
      workingSetMaxKb: workingSetValues.length ? Math.max(...workingSetValues) : undefined,
      gcSupported: samples.some((sample) => typeof sample.gcRuns === 'number'),
      gcRuns,
      endBeforeGcHeapUsedBytes: endBeforeGc?.jsHeapUsedBytes,
      endAfterGcHeapUsedBytes: postGc?.jsHeapUsedBytes,
      postGcHeapDeltaBytes:
        typeof first?.jsHeapUsedBytes === 'number' && typeof postGc?.jsHeapUsedBytes === 'number'
          ? postGc.jsHeapUsedBytes - first.jsHeapUsedBytes
          : undefined
    }
  }

  const measureStressPaintLatency = async (
    panels: TerminalPanel[],
    samples: number[],
    frameSamples: number[],
    rowSamples: number[],
    scrollRowSamples: number[],
    fullReasons: string[],
    repaintReasons: string[],
    errors: string[]
  ) => {
    const candidates = panels
      .map((panel) => ({ panel, view: terminalViews.get(panel.id) }))
      .filter((item) => item.view && isThreadedTerminalHost(item.view.terminal))
      .slice(0, Math.min(3, panels.length))
    await Promise.all(candidates.map(async ({ panel, view }, index) => {
      try {
        const marker = `p${index}\n`
        if (!view || !isThreadedTerminalHost(view.terminal)) return
        const terminal = view.terminal
        const result = await terminal.writeAndMeasurePaint(marker, 3000).catch(async (error) => {
          const screen = await terminal.readScreen(20).catch(() => ({ text: '' }))
          errors.push(`${error instanceof Error ? error.message : String(error)}; coreScreenHasMarker=${screen.text.includes(marker.trim())}`)
          return null
        })
        if (!result) return
        samples.push(result.latencyMs)
        frameSamples.push(result.frameMs)
        if (result.full) fullReasons.push(result.fullReason || 'unknown')
        else if (result.repaintReason) repaintReasons.push(result.repaintReason)
        else if (result.scrollDeltaRows) scrollRowSamples.push(result.paintedRows)
        else rowSamples.push(result.paintedRows)
        const sessionOrPanelId = panel.sessionId || panel.id
        appendTerminalHistoryBatched(sessionOrPanelId, marker)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }))
  }

  const measureRealEchoLatency = async (errors: string[]) => {
    const isRealLocalSession = (sessionId?: string) => Boolean(sessionId && !sessionId.startsWith('stress-'))
    let panel =
      workspace.panels.find((item) => item.kind !== 'knowledge' && !item.sshSession && isRealLocalSession(item.sessionId)) ||
      workspace.panels.find((item) => item.kind !== 'knowledge' && !item.sshSession && !item.sessionId)
    if (!panel) {
      panel = workspace.createPanel()
      panel.title = 'Stress Echo PTY'
      panel.status = 'ready'
      await nextTick()
      syncPanelViews()
    }
    if (!panel || panel.kind === 'knowledge') return { available: false, samples: [], error: 'No terminal panel available.' }
    if (!isRealLocalSession(panel.sessionId)) {
      panel.sessionId = undefined
      const connected = await startLocalTerminalForPanel(panel)
      if (!connected || !isRealLocalSession(panel.sessionId)) return { available: false, samples: [], error: 'Local terminal could not be started.' }
      await nextTick()
      syncTerminalView(panel)
    }
    const writeTerminal = terminalClient.writeTerminal()
    if (!writeTerminal) return { available: false, samples: [], error: 'Terminal write bridge unavailable.' }
    const samples: number[] = []
    const sessionId = panel.sessionId
    if (!sessionId) return { available: false, samples, error: 'Local terminal session id is unavailable.' }
    for (let index = 0; index < 5; index += 1) {
      const marker = `__AIOPSTERM_ECHO_${Date.now()}_${index}__`
      const startedAt = nowMs()
      try {
        await new Promise<void>((resolve, reject) => {
          let unsubscribe: (() => void) | undefined
          const timeout = window.setTimeout(() => {
            unsubscribe?.()
            reject(new Error(`Timed out waiting for PTY echo marker ${marker}.`))
          }, 3000)
          unsubscribe = terminalClient.onTerminalData()?.((event) => {
            if (event.id !== sessionId || !event.data.includes(marker)) return
            window.clearTimeout(timeout)
            unsubscribe?.()
            samples.push(nowMs() - startedAt)
            resolve()
          })
          if (!unsubscribe) {
            window.clearTimeout(timeout)
            reject(new Error('Terminal data bridge unavailable.'))
          }
          void writeTerminal(sessionId, `printf '${marker}\\n'\r`).then((result) => {
            if (result?.ok) return
            window.clearTimeout(timeout)
            unsubscribe?.()
            reject(new Error(result?.errorMessage || 'Terminal write was rejected.'))
          }).catch((error) => {
            window.clearTimeout(timeout)
            unsubscribe?.()
            reject(error instanceof Error ? error : new Error(String(error)))
          })
        })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    }
    return { available: samples.length > 0, samples, error: samples.length ? undefined : 'No real PTY echo samples were collected.' }
  }

  const runTerminalStressHarness = async (stressOptions: { foreground?: number; background?: number; durationMs?: number; switchIntervalMs?: number; profile?: TerminalStressProfileName } = {}) => {
    const foreground = Math.max(1, stressOptions.foreground || 10)
    const background = Math.max(0, stressOptions.background || 40)
    const durationMs = Math.max(1000, stressOptions.durationMs || 20 * 60 * 1000)
    const switchIntervalMs = Math.max(0, stressOptions.switchIntervalMs ?? 5000)
    const { name: profileName, profile } = terminalStressProfileFor(stressOptions.profile)
    const errors: string[] = []
    await ensureStressPanels(foreground, background)
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    const terminalPanels = workspace.panels.filter((panel) => panel.kind !== 'knowledge')
    let foregroundPanels = visibleTerminalPanels.value.filter((panel) => panel.kind !== 'knowledge').slice(0, foreground)
    let backgroundPanels = terminalPanels.filter((panel) => !foregroundPanels.some((visible) => visible.id === panel.id)).slice(0, background)
    const currentForegroundPanels = () => visibleTerminalPanels.value.filter((panel) => panel.kind !== 'knowledge').slice(0, foreground)
    const rafIntervals: number[] = []
    const paintLatencySamples: number[] = []
    const paintFrameSamples: number[] = []
    const paintRowSamples: number[] = []
    const paintScrollRowSamples: number[] = []
    const paintFullReasons: string[] = []
    const paintRepaintReasons: string[] = []
    const switchPaintLatencySamples: number[] = []
    const memorySamples: TerminalStressMemorySample[] = []
    const queueSamples: TerminalStressQueueSample[] = []
    const writeStats: TerminalStressWriteSummary = {
      foregroundWrites: 0,
      backgroundWrites: 0,
      foregroundChunks: 0,
      backgroundChunks: 0,
      foregroundBytes: 0,
      backgroundBytes: 0
    }
    let writtenBytes = 0
    let running = true
    let lastFrame = nowMs()
    let frames = 0
    let foregroundCursor = 0
    let backgroundCursor = 0
    let switchCount = 0
    let switchFailed = 0
    let paintProbeActive = false
    let switchProbeActive = false
    let pendingPaintProbe = false
    let pendingSwitchProbe = false
    memorySamples.push(await sampleStressMemory('start'))
    queueSamples.push(sampleStressQueues())
    const canvasCountBefore = memorySamples[0]?.canvasCount || 0
    const trackFrame = () => {
      const now = nowMs()
      rafIntervals.push(now - lastFrame)
      lastFrame = now
      frames += 1
      if (running) window.requestAnimationFrame(trackFrame)
    }
    window.requestAnimationFrame(trackFrame)
    const makeStressChunk = (prefix: string, panelIndex: number, burstIndex: number, lines: number, payloadBytes: number) => {
      const payload = 'x'.repeat(Math.max(1, payloadBytes))
      return Array.from({ length: Math.max(1, lines) }, (_line, lineIndex) =>
        `${prefix}-${panelIndex}.${burstIndex}.${lineIndex} ${nowMs().toFixed(1)} ${payload}`
      ).join('\n') + '\n'
    }
    const writePanel = (
      panel: TerminalPanel,
      prefix: 'fg' | 'bg',
      index: number,
      options: { chunks: number; linesPerChunk: number; payloadBytes: number }
    ) => {
      const statPrefix = prefix === 'fg' ? 'foreground' : 'background'
      writeStats[`${statPrefix}Writes` as 'foregroundWrites' | 'backgroundWrites'] += 1
      for (let chunkIndex = 0; chunkIndex < Math.max(1, options.chunks); chunkIndex += 1) {
        const data = makeStressChunk(prefix, index, chunkIndex, options.linesPerChunk, options.payloadBytes)
        const bytes = textByteLength(data)
        writtenBytes += bytes
        writeStats[`${statPrefix}Chunks` as 'foregroundChunks' | 'backgroundChunks'] += 1
        writeStats[`${statPrefix}Bytes` as 'foregroundBytes' | 'backgroundBytes'] += bytes
        queueTerminalIngressData(panel.sessionId || panel.id, data, 0)
      }
    }
    const foregroundTimer = window.setInterval(() => {
      currentForegroundPanels().forEach((panel, index) =>
        writePanel(panel, 'fg', index, {
          chunks: profile.foregroundChunks,
          linesPerChunk: profile.foregroundLinesPerChunk,
          payloadBytes: profile.foregroundPayloadBytes
        })
      )
    }, profile.foregroundIntervalMs)
    const backgroundTimer = window.setInterval(() => {
      const visibleIds = new Set(visibleTerminalPanels.value.map((panel) => panel.id))
      terminalPanels
        .filter((panel) => !visibleIds.has(panel.id))
        .slice(0, background)
        .forEach((panel, index) =>
          writePanel(panel, 'bg', index, {
            chunks: profile.backgroundChunks,
            linesPerChunk: profile.backgroundLinesPerChunk,
            payloadBytes: profile.backgroundPayloadBytes
          })
        )
    }, profile.backgroundIntervalMs)
    const switchVisibleBackgroundPanel = async () => {
      if (!running || switchIntervalMs <= 0) return
      if (switchProbeActive) return
      if (paintProbeActive) {
        pendingSwitchProbe = true
        return
      }
      switchProbeActive = true
      try {
        foregroundPanels = visibleTerminalPanels.value.filter((panel) => panel.kind !== 'knowledge').slice(0, foreground)
        backgroundPanels = terminalPanels.filter((panel) => !foregroundPanels.some((visible) => visible.id === panel.id)).slice(0, background)
        if (!foregroundPanels.length || !backgroundPanels.length) return
        const outgoing = foregroundPanels[foregroundCursor % foregroundPanels.length]
        const incoming = backgroundPanels[backgroundCursor % backgroundPanels.length]
        foregroundCursor += 1
        backgroundCursor += 1
        if (!outgoing || !incoming || outgoing.id === incoming.id) return
        const target = foregroundPanels.find((panel) => panel.id !== outgoing.id) || outgoing
        workspace.unsplitPanel(outgoing.id)
        await nextTick()
        workspace.attachPanelToSplit(incoming.id, target.id, backgroundCursor % 2 === 0 ? 'right' : 'below')
        workspace.activePanelId = incoming.id
        await nextTick()
        syncPanelViews()
        await nextTick()
        scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 2, forceGeometry: true })
        switchCount += 1
        const view = terminalViews.get(incoming.id)
        if (view && isThreadedTerminalHost(view.terminal)) {
          const marker = `s${switchCount}\n`
          const result = await view.terminal.writeAndMeasurePaint(marker, 3000)
          switchPaintLatencySamples.push(result.latencyMs)
          appendTerminalHistoryBatched(incoming.sessionId || incoming.id, marker)
        }
      } catch (error) {
        switchFailed += 1
        errors.push(error instanceof Error ? error.message : String(error))
      } finally {
        switchProbeActive = false
        if (pendingPaintProbe) {
          pendingPaintProbe = false
          void measureCurrentForegroundPaintLatency()
        }
      }
    }
    const measureCurrentForegroundPaintLatency = async () => {
      if (paintProbeActive) return
      if (switchProbeActive) {
        pendingPaintProbe = true
        return
      }
      paintProbeActive = true
      try {
        await measureStressPaintLatency(
          currentForegroundPanels(),
          paintLatencySamples,
          paintFrameSamples,
          paintRowSamples,
          paintScrollRowSamples,
          paintFullReasons,
          paintRepaintReasons,
          errors
        )
      } finally {
        paintProbeActive = false
        if (pendingSwitchProbe) {
          pendingSwitchProbe = false
          void switchVisibleBackgroundPanel()
        }
      }
    }
    const memoryTimer = window.setInterval(() => {
      void sampleStressMemory().then((sample) => memorySamples.push(sample)).catch((error) => errors.push(error instanceof Error ? error.message : String(error)))
    }, Math.max(1000, Math.min(10_000, Math.floor(durationMs / 6))))
    const queueTimer = window.setInterval(() => {
      queueSamples.push(sampleStressQueues())
    }, 1000)
    const latencyTimer = window.setInterval(() => {
      void measureCurrentForegroundPaintLatency()
    }, Math.max(1000, Math.min(5000, Math.floor(durationMs / 12))))
    const switchTimer = switchIntervalMs > 0 ? window.setInterval(() => {
      void switchVisibleBackgroundPanel()
    }, switchIntervalMs) : null
    await measureCurrentForegroundPaintLatency()
    await new Promise((resolve) => window.setTimeout(resolve, durationMs))
    running = false
    window.clearInterval(foregroundTimer)
    window.clearInterval(backgroundTimer)
    window.clearInterval(memoryTimer)
    window.clearInterval(queueTimer)
    window.clearInterval(latencyTimer)
    if (switchTimer !== null) window.clearInterval(switchTimer)
    Array.from(terminalIngressBatches.keys()).forEach(flushTerminalIngressBatch)
    Array.from(terminalHistoryBatches.keys()).forEach(flushTerminalHistoryBatch)
    queueSamples.push(sampleStressQueues())
    await measureCurrentForegroundPaintLatency()
    memorySamples.push(await sampleStressMemory('end-before-gc'))
    const gcResult = await runStressGarbageCollection(2)
    memorySamples.push(await sampleStressMemory('post-gc', gcResult.supported ? gcResult.runs : undefined))
    const realEcho = await measureRealEchoLatency(errors)
    const sorted = rafIntervals.slice(5).sort((a, b) => a - b)
    const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * value)))] || 0
    const memory = summarizeStressMemory(memorySamples)
    const realEchoSummary = terminalStressMetricSummary(realEcho.samples)
    return {
      profile: profileName,
      foreground: foregroundPanels.length,
      background: backgroundPanels.length,
      durationMs,
      writtenBytes,
      writes: writeStats,
      frames,
      avgFrameMs: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
      p95FrameMs: percentile(0.95),
      p99FrameMs: percentile(0.99),
      maxFrameMs: sorted[sorted.length - 1] || 0,
      panels: terminalPanels.length,
      threaded: getThreadedTerminalDebugStats(),
      paintLatency: terminalStressMetricSummary(paintLatencySamples),
      paintFrameMs: terminalStressMetricSummary(paintFrameSamples),
      paintRows: terminalStressMetricSummary(paintRowSamples),
      paintScrollRows: terminalStressMetricSummary(paintScrollRowSamples),
      paintFullFrames: paintFullReasons.length,
      paintFullReasons: paintFullReasons.reduce<Record<string, number>>((summary, reason) => {
        summary[reason] = (summary[reason] || 0) + 1
        return summary
      }, {}),
      paintRepaintReasons: paintRepaintReasons.reduce<Record<string, number>>((summary, reason) => {
        summary[reason] = (summary[reason] || 0) + 1
        return summary
      }, {}),
      realEchoLatency: {
        ...realEchoSummary,
        available: realEcho.available,
        error: realEcho.error
      },
      memory,
      queues: summarizeStressQueues(queueSamples),
      switches: {
        enabled: switchIntervalMs > 0,
        intervalMs: switchIntervalMs,
        count: switchCount,
        failed: switchFailed,
        paintLatency: terminalStressMetricSummary(switchPaintLatencySamples)
      },
      canvasCount: {
        before: canvasCountBefore,
        after: memorySamples.at(-1)?.canvasCount || 0
      },
      errors
    }
  }

  onMounted(() => {
    offData = terminalClient.onTerminalData()?.(handleTerminalData) || null
    offLifecycle = terminalClient.onTerminalLifecycle()?.((event) => workspace.applyTerminalLifecycle(event)) || null
    offExit = terminalClient.onTerminalExit()?.((event) => workspace.applyTerminalExit(event)) || null
    offControlRequest = controlClient.onControlRequest()?.(handleControlRequest) || null
    document.addEventListener('click', closeTerminalMenusFromDocument)
    window.addEventListener('keydown', handleShortcut)
    if (terminalStressHarnessEnabled()) {
      window.__AIOPSTERM_TERMINAL_STRESS__ = { run: runTerminalStressHarness }
    }
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
    if (terminalIngressFlushTimer !== null) {
      window.clearTimeout(terminalIngressFlushTimer)
      terminalIngressFlushTimer = null
      terminalIngressFlushDueAt = 0
    }
    terminalIngressBatches.clear()
    if (terminalHistoryFlushTimer !== null) {
      window.clearTimeout(terminalHistoryFlushTimer)
      terminalHistoryFlushTimer = null
    }
    flushTerminalHistoryBatches()
    if (window.__AIOPSTERM_TERMINAL_STRESS__?.run === runTerminalStressHarness) {
      delete window.__AIOPSTERM_TERMINAL_STRESS__
    }
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
