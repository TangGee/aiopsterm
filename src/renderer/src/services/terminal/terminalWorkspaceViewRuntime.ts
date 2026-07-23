import { nextTick, reactive, type ComponentPublicInstance, type ComputedRef, type Ref } from 'vue'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { mirrorTextToClipboardQuietly } from '@/services/app/clipboardRuntime'
import { writeRendererRuntimeLog as writeRuntimeLog } from '@/services/app/runtimeLogClient'
import { terminalClient } from '@/services/terminal/terminalClient'
import { terminalThemeForAppTheme, type TerminalSurfaceMode } from '@/services/terminal/terminalThemeRuntime'
import {
  terminalShortcutActionForEvent,
  type TerminalShortcutAction
} from '@/services/terminal/terminalKeyboardShortcuts'
import {
  normalizeTerminalProgramTitle,
  parseTerminalCurrentDirectoryOsc,
  parseTerminalProgressOsc,
  type TerminalProgress
} from '@/services/terminal/terminalOscRuntime'
import {
  ThreadedTerminalFitAddon,
  ThreadedTerminalSearchAddon,
  createThreadedTerminalHost,
  isThreadedTerminalHost,
  terminalDropInputText,
  hasTerminalDropFilePayload,
  threadedTerminalCapability,
  threadedTerminalPriorityFor
} from '@/services/terminal/threadedTerminalRuntime'
import type { TerminalPanel, TerminalSettings, useWorkspaceStore } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalCommandSuggestion } from '@shared/contracts/terminalTools'
import { shouldUseTerminalDebugLogs, shouldUseThreadedTerminal } from '@shared/runtimeSwitches'
import { findTerminalHttpLinks, isTerminalLinkActivation, terminalColumnAtTextIndex } from '@/services/terminal/terminalLinkRuntime'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>
type XtermRuntimeOptions = XtermTerminal['options'] & { termName?: string; minimumContrastRatio?: number }
type TerminalSuggestion = TerminalCommandSuggestion
type TerminalBufferLineLike = { translateToString: (trimRight?: boolean) => string; isWrapped?: boolean }
type XtermLike = {
  cols: number
  rows: number
  options: XtermRuntimeOptions
  buffer: {
    active: {
      viewportY: number
      cursorX: number
      cursorY: number
      length?: number
      getLine?: (index: number) => TerminalBufferLineLike | undefined
    }
  }
  loadAddon: (addon: any) => void
  open: (element: HTMLElement) => void
  focus: () => void
  clear: () => void
  dispose: () => void
  write: (data: string, callback?: () => void) => void
  writeBackendData?: (sessionId: string, data: string) => boolean
  setSessionId?: (sessionId?: string) => void
  input?: (data: string, wasUserInput?: boolean) => void
  attachCustomKeyEventHandler?: (handler: (event: KeyboardEvent) => boolean) => void
  scrollLines?: (amount: number) => void
  scrollPages?: (pageCount: number) => void
  scrollToTop?: () => void
  scrollToLine?: (line: number) => void
  scrollToBottom: () => void
  refresh: (start: number, end: number) => void
  ensureSurfaceAttached?: (options?: { forceGeometry?: boolean }) => boolean
  getSelection: () => string
  getSelectionPosition: () => { start: { y: number }; end: { y: number } } | null | undefined
  hasSelection: () => boolean
  clearSelection?: () => void
  parser?: {
    registerOscHandler?: (ident: number, callback: (data: string) => boolean | Promise<boolean>) => unknown
  }
  onData: (handler: (data: string) => void) => unknown
  onResize: (handler: (size: { cols: number; rows: number }) => unknown) => unknown
  onSelectionChange: (handler: () => void) => unknown
  onTitleChange?: (handler: (title: string) => void) => unknown
  onProgressChange?: (handler: (progress: TerminalProgress | null) => void) => unknown
  onCwdChange?: (handler: (cwd: string) => void) => unknown
  registerLinkProvider?: (provider: {
    provideLinks: (line: number, callback: (links: Array<{
      range: { start: { x: number; y: number }; end: { x: number; y: number } }
      text: string
      activate: (event: MouseEvent, text: string) => void
      decorations?: { pointerCursor?: boolean; underline?: boolean }
    }> | undefined) => void) => void
  }) => { dispose: () => void }
}
type AddonLike = {
  activate: (terminal: any) => void
  dispose: () => void
}
type FitLike = Pick<FitAddon, 'fit'> & AddonLike
type SearchLike = Pick<SearchAddon, 'findNext' | 'findPrevious' | 'clearDecorations'> & AddonLike

export type TerminalView = {
  terminal: XtermLike
  fit: FitLike
  search: SearchLike
  lastOutput: string
  openedElement?: HTMLElement
  domDisposables?: Array<() => void>
  outputQueue?: TerminalOutputWriteQueue
  outputPerf?: TerminalOutputPerfSummary
  clearPendingOutput?: () => void
  suppressInputReplyDepth?: number
  lastFitCols?: number
  lastFitRows?: number
  resizeObserver?: ResizeObserver
}

export type TerminalKeyboardShortcutHandler = (panelId: string, action: TerminalShortcutAction, event: KeyboardEvent) => boolean

type TerminalOutputPerfSummary = {
  chunks: number
  writes: number
  bytes: number
  firstAt: number
  lastAt: number
  writeMs: number
  queueMs: number
  highlightMs: number
  maxWriteMs: number
  maxQueueMs: number
  maxHighlightMs: number
  maxChunkBytes: number
  maxBatchBytes: number
  maxPendingBytes: number
  maxPendingChunks: number
  resets: number
}

type TerminalQueuedOutput = {
  chunks: number
  data: string
  bytes: number
  queuedAt: number
  highlightMs: number
  maxChunkBytes: number
  reset: boolean
  suppressInputReplies: boolean
}

type TerminalOutputWriteQueue = {
  pending: TerminalQueuedOutput[]
  pendingBytes: number
  pendingChunks: number
  scheduledFlush: unknown | null
  inFlight: boolean
  clearAfterInFlight: boolean
  scrollToBottomAfterFlush: boolean
  disposed: boolean
}

type TerminalWorkspaceViewRuntimeInput = {
  workspace: WorkspaceStore
  visibleTerminalPanels: ComputedRef<TerminalPanel[]>
  terminalWorkspaceVisible?: ComputedRef<boolean>
  aiButtonPanelId: Ref<string>
  aiButtonPosition: { top: number; right: number }
  suggestionPanel: { panelId: string }
  suggestionPosition: { left: number; top: number }
  suggestionItems: Ref<TerminalSuggestion[]>
  aiSuggestLoading: Ref<boolean>
  writeXtermInput: (panelId: string, data: string) => void | Promise<void>
  shouldSuppressTerminalFocus?: (panelId: string) => boolean
  terminalConstructor?: new (options: ConstructorParameters<typeof XtermTerminal>[0]) => XtermLike
  fitConstructor?: new () => FitLike
  searchConstructor?: new () => SearchLike
}

const terminalContentPaddingTop = 10
const terminalContentPaddingBottom = 16
const terminalAiButtonHeight = 32
const terminalFloatingGap = 8
const terminalBottomSafePx = 16
const terminalOutputSummaryDebugIntervalMs = 1000
const terminalOutputSummaryFormalIntervalMs = 10_000
const terminalOutputSummaryDebugChunkThreshold = 50
const terminalOutputSummaryFormalChunkThreshold = 1000
const terminalOutputSummaryDebugByteThreshold = 1024 * 1024
const terminalOutputSummaryFormalByteThreshold = 8 * 1024 * 1024
const terminalOutputSlowThresholdMs = 16
const terminalOutputMaxWriteBytes = 8 * 1024
const terminalOutputMaxWriteChunks = 32
const terminalOutputCompactPendingChunks = 128
const terminalThreadedLiveOutputTailBytes = 8 * 1024

const nowMs = () => globalThis.performance?.now?.() ?? Date.now()

const terminalTextEncoder = new TextEncoder()
const terminalTextDecoder = new TextDecoder()
const textByteLength = (value: string) => terminalTextEncoder.encode(value).length
const detachText = (value: string) => (value ? terminalTextDecoder.decode(terminalTextEncoder.encode(value)) : '')
const clonePlain = <T>(value: T): T => {
  if (value === null || value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

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

export const createTerminalWorkspaceViewRuntime = ({
  workspace,
  visibleTerminalPanels,
  terminalWorkspaceVisible,
  aiButtonPanelId,
  aiButtonPosition,
  suggestionPanel,
  suggestionPosition,
  suggestionItems,
  aiSuggestLoading,
  writeXtermInput,
  shouldSuppressTerminalFocus,
  terminalConstructor,
  fitConstructor,
  searchConstructor
}: TerminalWorkspaceViewRuntimeInput) => {
  const TerminalConstructor = terminalConstructor || XtermTerminal
  const FitConstructor = fitConstructor || FitAddon
  const SearchConstructor = searchConstructor || SearchAddon
  let threadedTerminalAvailable: boolean | null = null
  const terminalDebugLogs = shouldUseTerminalDebugLogs()
  const terminalOutputSummaryIntervalMs = terminalDebugLogs ? terminalOutputSummaryDebugIntervalMs : terminalOutputSummaryFormalIntervalMs
  const terminalOutputSummaryChunkThreshold = terminalDebugLogs ? terminalOutputSummaryDebugChunkThreshold : terminalOutputSummaryFormalChunkThreshold
  const terminalOutputSummaryByteThreshold = terminalDebugLogs ? terminalOutputSummaryDebugByteThreshold : terminalOutputSummaryFormalByteThreshold
  const writeTerminalDebugLog = (event: string, fields?: Record<string, unknown>) => {
    if (terminalDebugLogs) writeRuntimeLog('debug', event, fields)
  }
  const canUseThreadedTerminal = () => {
    if (terminalConstructor || fitConstructor || searchConstructor) return false
    if (!shouldUseThreadedTerminal()) return false
    if (threadedTerminalAvailable !== null) return threadedTerminalAvailable
    const capability = threadedTerminalCapability()
    if (!capability.supported) {
      writeRuntimeLog('warn', 'renderer.threaded-terminal.unavailable', { reason: capability.reason })
      threadedTerminalAvailable = false
      return false
    }
    threadedTerminalAvailable = true
    return true
  }
  const paneFontSizes = reactive<Record<string, number>>({})
  const terminalElements = new Map<string, HTMLElement>()
  const terminalViews = new Map<string, TerminalView>()
  const terminalViewPanels = new Map<string, TerminalPanel>()
  let terminalKeyboardShortcutHandler: TerminalKeyboardShortcutHandler | null = null
  let terminalFocusIntent = 0

  const requestOutputFlush = (callback: () => void) =>
    typeof window !== 'undefined' && typeof window.setTimeout === 'function' ? window.setTimeout(callback, 0) : setTimeout(callback, 0)

  const cancelOutputFlush = (flush: unknown) => {
    if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') window.clearTimeout(flush as number)
    else clearTimeout(flush as ReturnType<typeof setTimeout>)
  }

  const logTerminalOutputSummary = (panelId: string, summary: TerminalOutputPerfSummary, reason: string) => {
    writeTerminalDebugLog('renderer.terminal-output.summary', {
      panelId,
      reason,
      chunks: summary.chunks,
      writes: summary.writes,
      bytes: summary.bytes,
      durationMs: Math.max(0, Math.round(summary.lastAt - summary.firstAt)),
      writeMs: Math.round(summary.writeMs * 10) / 10,
      queueMs: Math.round(summary.queueMs * 10) / 10,
      highlightMs: Math.round(summary.highlightMs * 10) / 10,
      maxWriteMs: Math.round(summary.maxWriteMs * 10) / 10,
      maxQueueMs: Math.round(summary.maxQueueMs * 10) / 10,
      maxHighlightMs: Math.round(summary.maxHighlightMs * 10) / 10,
      maxChunkBytes: summary.maxChunkBytes,
      maxBatchBytes: summary.maxBatchBytes,
      maxPendingBytes: summary.maxPendingBytes,
      maxPendingChunks: summary.maxPendingChunks,
      resets: summary.resets
    })
  }

  const flushTerminalOutputPerf = (panelId: string, view: TerminalView | undefined, reason: string) => {
    if (!view?.outputPerf) return
    logTerminalOutputSummary(panelId, view.outputPerf, reason)
    view.outputPerf = undefined
  }

  const recordTerminalOutputPerf = (
    panelId: string,
    view: TerminalView,
    metrics: {
      chunks: number
      bytes: number
      writeMs: number
      queueMs: number
      highlightMs: number
      maxChunkBytes: number
      pendingBytes: number
      pendingChunks: number
      reset?: boolean
    }
  ) => {
    const now = nowMs()
    const existing = view.outputPerf
    const summary =
      existing ||
      {
        chunks: 0,
        writes: 0,
        bytes: 0,
        firstAt: now,
        lastAt: now,
        writeMs: 0,
        queueMs: 0,
        highlightMs: 0,
        maxWriteMs: 0,
        maxQueueMs: 0,
        maxHighlightMs: 0,
        maxChunkBytes: 0,
        maxBatchBytes: 0,
        maxPendingBytes: 0,
        maxPendingChunks: 0,
        resets: 0
      }
    summary.chunks += metrics.chunks
    summary.writes += 1
    summary.bytes += metrics.bytes
    summary.lastAt = now
    summary.writeMs += metrics.writeMs
    summary.queueMs += metrics.queueMs
    summary.highlightMs += metrics.highlightMs
    summary.maxWriteMs = Math.max(summary.maxWriteMs, metrics.writeMs)
    summary.maxQueueMs = Math.max(summary.maxQueueMs, metrics.queueMs)
    summary.maxHighlightMs = Math.max(summary.maxHighlightMs, metrics.highlightMs)
    summary.maxChunkBytes = Math.max(summary.maxChunkBytes, metrics.maxChunkBytes)
    summary.maxBatchBytes = Math.max(summary.maxBatchBytes, metrics.bytes)
    summary.maxPendingBytes = Math.max(summary.maxPendingBytes, metrics.pendingBytes)
    summary.maxPendingChunks = Math.max(summary.maxPendingChunks, metrics.pendingChunks)
    if (metrics.reset) summary.resets += 1
    view.outputPerf = summary
    if (terminalDebugLogs && (metrics.writeMs >= terminalOutputSlowThresholdMs || metrics.highlightMs >= terminalOutputSlowThresholdMs)) {
      writeRuntimeLog('warn', 'renderer.terminal-output.slow-write', {
        panelId,
        chunks: metrics.chunks,
        bytes: metrics.bytes,
        writeMs: Math.round(metrics.writeMs * 10) / 10,
        queueMs: Math.round(metrics.queueMs * 10) / 10,
        highlightMs: Math.round(metrics.highlightMs * 10) / 10,
        pendingBytes: metrics.pendingBytes,
        pendingChunks: metrics.pendingChunks,
        reset: Boolean(metrics.reset)
      })
    }
    if (
      summary.lastAt - summary.firstAt >= terminalOutputSummaryIntervalMs ||
      summary.chunks >= terminalOutputSummaryChunkThreshold ||
      summary.bytes >= terminalOutputSummaryByteThreshold
    ) {
      flushTerminalOutputPerf(
        panelId,
        view,
        summary.bytes >= terminalOutputSummaryByteThreshold
          ? 'byte-threshold'
          : summary.chunks >= terminalOutputSummaryChunkThreshold
            ? 'chunk-threshold'
            : 'interval'
      )
    }
  }

  const setXtermTermName = (terminal: XtermLike, terminalType: string) => {
    ;(terminal.options as XtermRuntimeOptions).termName = terminalType || 'xterm-256color'
  }

  const defaultTerminalFontSize = () => workspace.terminalSettings.fontSize || 12
  const terminalFontSizeForPanel = (panelId: string) => paneFontSizes[panelId] || defaultTerminalFontSize()
  const terminalSurfaceMode = (): TerminalSurfaceMode => (workspace.config?.background?.mode === 'none' ? 'base' : 'withBackground')
  const terminalSettingsSignature = () => {
    const settings = workspace.terminalSettings
    return [
      workspace.config?.theme || 'dark',
      terminalSurfaceMode(),
      settings.terminalType,
      settings.fontFamily,
      settings.fontSize,
      settings.lineHeight,
      settings.cursorBlink,
      settings.cursorStyle,
      settings.scrollBack
    ].join('|')
  }
  const terminalTheme = () => terminalThemeForAppTheme(workspace.config?.theme || 'dark', { surfaceMode: terminalSurfaceMode() })
  const threadedKeywordHighlightConfig = () =>
    workspace.extensionSettings.highlightStatus ? clonePlain(workspace.keywordHighlightSettings) : null

  const activeView = () => terminalViews.get(workspace.activePanelId)
  const isTerminalWorkspaceVisible = () => terminalWorkspaceVisible?.value ?? true
  const isTerminalFocusSuppressed = (panelId: string) =>
    Boolean(shouldSuppressTerminalFocus?.(panelId)) ||
    (typeof document !== 'undefined' && Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')))
  const visibleTerminalPanelIds = () => new Set(visibleTerminalPanels.value.map((panel) => panel.id))
  const isTerminalPanelRenderable = (panelId: string) => {
    const element = terminalElements.get(panelId)
    return Boolean(isTerminalWorkspaceVisible() && element?.isConnected && visibleTerminalPanelIds().has(panelId))
  }

  const terminalPriorityForPanel = (panelId: string) => threadedTerminalPriorityFor(panelId, workspace.activePanelId, isTerminalPanelRenderable(panelId))

  const syncThreadedTerminalPriorities = () => {
    terminalViews.forEach((view, panelId) => {
      if (!isThreadedTerminalHost(view.terminal)) return
      const visible = isTerminalPanelRenderable(panelId)
      view.terminal.setVisibility(visible, threadedTerminalPriorityFor(panelId, workspace.activePanelId, visible))
    })
  }

  const syncThreadedKeywordHighlight = () => {
    const config = threadedKeywordHighlightConfig()
    terminalViews.forEach((view) => {
      if (!isThreadedTerminalHost(view.terminal)) return
      view.terminal.updateKeywordHighlight(config)
    })
  }

  const attachTerminalKeyboardShortcutHandler = (panel: TerminalPanel, view: TerminalView) => {
    view.terminal.attachCustomKeyEventHandler?.((event) => {
      const action = terminalShortcutActionForEvent(event)
      if (!action || !terminalKeyboardShortcutHandler) return true
      const handled = terminalKeyboardShortcutHandler(panel.id, action, event)
      if (!handled) return true
      event.preventDefault()
      event.stopPropagation()
      return false
    })
  }

  const bindTerminalViewEvents = (panel: TerminalPanel, view: TerminalView) => {
    view.terminal.onTitleChange?.((title) => {
      const normalizedTitle = normalizeTerminalProgramTitle(title)
      if (!normalizedTitle) return
      workspace.setPanelAutoTitle(panel.id, normalizedTitle)
    })
    view.terminal.onProgressChange?.((progress) => {
      workspace.setPanelProgress(panel.id, progress)
    })
    const updateLocalCwd = (cwd: string) => {
      if (panel.sshSession || !cwd.startsWith('/')) return
      panel.cwd = cwd
    }
    view.terminal.onCwdChange?.(updateLocalCwd)
    view.terminal.parser?.registerOscHandler?.(7, (data) => {
      const cwd = parseTerminalCurrentDirectoryOsc(data)
      if (!cwd) return false
      updateLocalCwd(cwd)
      return true
    })
    view.terminal.parser?.registerOscHandler?.(9, (data) => {
      const change = parseTerminalProgressOsc(data)
      if (change.action === 'ignore') return false
      workspace.setPanelProgress(panel.id, change.action === 'set' ? change.progress : null)
      return true
    })
    view.terminal.onData((data) => {
      if (view.suppressInputReplyDepth) {
        writeTerminalDebugLog('renderer.terminal-input.suppressed-replay-reply', {
          panelId: panel.id,
          bytes: new TextEncoder().encode(data).length
        })
        return
      }
      void writeXtermInput(panel.id, data)
    })
    const linkDisposable = view.terminal.registerLinkProvider?.({
      provideLinks: (lineNumber, callback) => {
        const getLine = view.terminal.buffer.active.getLine
        if (!getLine) return callback(undefined)
        let firstLine = lineNumber - 1
        while (firstLine > 0 && getLine(firstLine)?.isWrapped) firstLine -= 1
        const lines: Array<{ line: number; text: string; offset: number }> = []
        let logicalText = ''
        for (let index = firstLine; ; index += 1) {
          const bufferLine = getLine(index)
          if (!bufferLine) break
          const text = bufferLine.translateToString(true)
          lines.push({ line: index + 1, text, offset: logicalText.length })
          logicalText += text
          if (!getLine(index + 1)?.isWrapped) break
        }
        const segmentForIndex = (index: number) => [...lines].reverse().find((item) => index >= item.offset) || lines[0]
        const links = findTerminalHttpLinks(logicalText)
          .filter((link) => {
            const current = lines.find((item) => item.line === lineNumber)
            return Boolean(current && link.end > current.offset && link.start < current.offset + current.text.length)
          })
          .map((link) => {
          const start = segmentForIndex(link.start)
          const end = segmentForIndex(Math.max(link.start, link.end - 1))
          const endIndex = link.end - end.offset
          return {
          range: {
            start: { x: terminalColumnAtTextIndex(start.text, link.start - start.offset) + 1, y: start.line },
            end: { x: terminalColumnAtTextIndex(end.text, endIndex), y: end.line }
          },
          text: link.text,
          activate: (event: MouseEvent, url: string) => {
            if (isTerminalLinkActivation(event)) void window.aiops.openExternalUrl(url)
          },
          decorations: { pointerCursor: true, underline: true }
        }
        })
        callback(links.length ? links : undefined)
      }
    })
    if (linkDisposable) view.domDisposables = [...(view.domDisposables || []), () => linkDisposable.dispose()]
    const openedElement = view.openedElement
    if (openedElement && !isThreadedTerminalHost(view.terminal)) {
      const handleFileDrag = (event: DragEvent) => {
        if (!hasTerminalDropFilePayload(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      }
      openedElement.addEventListener('dragenter', handleFileDrag)
      openedElement.addEventListener('dragover', handleFileDrag)
      const handleFileDrop = (event: DragEvent) => {
        if (!hasTerminalDropFilePayload(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        const text = terminalDropInputText(event.dataTransfer)
        if (!text) return
        view.terminal.focus()
        if (view.terminal.input) view.terminal.input(text, true)
        else void writeXtermInput(panel.id, text)
      }
      openedElement.addEventListener('drop', handleFileDrop)
      view.domDisposables = [
        ...(view.domDisposables || []),
        () => openedElement.removeEventListener('dragenter', handleFileDrag),
        () => openedElement.removeEventListener('dragover', handleFileDrag),
        () => openedElement.removeEventListener('drop', handleFileDrop)
      ]
    }
    view.terminal.onSelectionChange(() => {
      const selectedText = view.terminal.getSelection()
      if (selectedText.trim()) void mirrorTextToClipboardQuietly(selectedText.trim())
      updateSelectionButtonPosition(panel.id)
    })
    view.terminal.onResize(({ cols, rows }) => {
      writeTerminalDebugLog('renderer.terminal.resize', {
        panelId: panel.id,
        sessionId: panel.sessionId,
        cols,
        rows
      })
      updateSelectionButtonPosition(panel.id)
      updateSuggestionsPosition(panel.id)
    })
  }

  const createThreadedViewForPanel = (panel: TerminalPanel) => {
    const theme = terminalTheme()
    const initialOutput = tailTextByBytes(panel.output, terminalThreadedLiveOutputTailBytes)
    const terminal = createThreadedTerminalHost({
      terminalId: panel.id,
      sessionId: panel.sessionId,
      groupId: panel.splitGroupId || panel.id,
      surface: 'workspace',
      settings: {
        ...workspace.terminalSettings,
        fontSize: terminalFontSizeForPanel(panel.id)
      },
      theme,
      keywordHighlight: threadedKeywordHighlightConfig(),
      initialData: initialOutput,
      visible: isTerminalPanelRenderable(panel.id),
      priority: terminalPriorityForPanel(panel.id),
      logFields: { panelId: panel.id }
    })
    const fit = new ThreadedTerminalFitAddon()
    const searchAddon = new ThreadedTerminalSearchAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(searchAddon)
    const view: TerminalView = { terminal, fit, search: searchAddon, lastOutput: initialOutput }
    view.clearPendingOutput = () => clearQueuedTerminalOutput(view)
    bindTerminalViewEvents(panel, view)
    return view
  }

  const disposeTerminalView = (panelId: string, reason: string) => {
    const view = terminalViews.get(panelId)
    if (!view) return
    clearQueuedTerminalOutput(view, { dispose: true })
    flushTerminalOutputPerf(panelId, view, reason)
    view.resizeObserver?.disconnect()
    view.domDisposables?.forEach((dispose) => dispose())
    view.terminal.dispose()
    terminalViews.delete(panelId)
    terminalViewPanels.delete(panelId)
    delete paneFontSizes[panelId]
  }

  const terminalOutputQueueFor = (view: TerminalView): TerminalOutputWriteQueue => {
    if (view.outputQueue) return view.outputQueue
    view.outputQueue = {
      pending: [],
      pendingBytes: 0,
      pendingChunks: 0,
      scheduledFlush: null,
      inFlight: false,
      clearAfterInFlight: false,
      scrollToBottomAfterFlush: false,
      disposed: false
    }
    return view.outputQueue
  }

  const runTerminalOutputFollowup = (panelId: string, view: TerminalView) => {
    const queue = terminalOutputQueueFor(view)
    const shouldScroll = queue.scrollToBottomAfterFlush
    queue.scrollToBottomAfterFlush = false
    if (queue.disposed) return
    if (shouldScroll) view.terminal.scrollToBottom()
    updateSelectionButtonPosition(panelId)
    updateSuggestionsPosition(panelId)
  }

  const takeQueuedTerminalOutputBatch = (queue: TerminalOutputWriteQueue) => {
    const queued: TerminalQueuedOutput[] = []
    let bytes = 0
    let chunks = 0
    while (queue.pending.length) {
      const next = queue.pending[0]
      const wouldExceedBytes = bytes > 0 && bytes + next.bytes > terminalOutputMaxWriteBytes
      const wouldExceedChunks = chunks > 0 && chunks + next.chunks > terminalOutputMaxWriteChunks
      if (wouldExceedBytes || wouldExceedChunks) break
      queued.push(next)
      bytes += next.bytes
      chunks += next.chunks
      queue.pending.shift()
      queue.pendingBytes = Math.max(0, queue.pendingBytes - next.bytes)
      queue.pendingChunks = Math.max(0, queue.pendingChunks - next.chunks)
      if (bytes >= terminalOutputMaxWriteBytes || chunks >= terminalOutputMaxWriteChunks) break
    }
    return queued
  }

  const flushQueuedTerminalOutput = (panelId: string, view: TerminalView) => {
    const queue = terminalOutputQueueFor(view)
    queue.scheduledFlush = null
    if (queue.disposed || queue.inFlight) return
    if (!isTerminalPanelRenderable(panelId)) return
    if (!queue.pending.length) {
      if (queue.clearAfterInFlight) {
        queue.clearAfterInFlight = false
        view.terminal.clear()
      }
      return
    }

    const pendingBytesAtFlush = queue.pendingBytes
    const pendingChunksAtFlush = queue.pendingChunks
    const queued = takeQueuedTerminalOutputBatch(queue)
    queue.inFlight = true

    const data = queued.map((item) => item.data).join('')
    const bytes = queued.reduce((total, item) => total + item.bytes, 0)
    const chunks = queued.reduce((total, item) => total + item.chunks, 0)
    const highlightMs = queued.reduce((total, item) => total + item.highlightMs, 0)
    const maxChunkBytes = queued.reduce((max, item) => Math.max(max, item.maxChunkBytes), 0)
    const queuedAt = queued.reduce((earliest, item) => Math.min(earliest, item.queuedAt), queued[0]?.queuedAt ?? nowMs())
    const shouldReset = queued.some((item) => item.reset)
    const suppressInputReplies = queued.some((item) => item.suppressInputReplies)
    const queueMs = Math.max(0, nowMs() - queuedAt)
    const startedAt = nowMs()

    if (shouldReset || queue.clearAfterInFlight) {
      queue.clearAfterInFlight = false
      view.terminal.clear()
    }
    if (suppressInputReplies) view.suppressInputReplyDepth = (view.suppressInputReplyDepth || 0) + 1
    const restoreInputReplies = () => {
      if (!suppressInputReplies) return
      view.suppressInputReplyDepth = Math.max(0, (view.suppressInputReplyDepth || 1) - 1)
    }
    const completeWrite = () => {
      restoreInputReplies()
      queue.inFlight = false
      recordTerminalOutputPerf(panelId, view, {
        chunks,
        bytes,
        writeMs: nowMs() - startedAt,
        queueMs,
        highlightMs,
        maxChunkBytes,
        pendingBytes: pendingBytesAtFlush,
        pendingChunks: pendingChunksAtFlush,
        reset: shouldReset
      })
      if (queue.clearAfterInFlight) {
        queue.clearAfterInFlight = false
        if (!queue.disposed) view.terminal.clear()
      }
      runTerminalOutputFollowup(panelId, view)
      if (queue.pending.length && !queue.disposed) scheduleTerminalOutputFlush(panelId, view)
    }
    if (view.terminal.write.length >= 2) view.terminal.write(data, completeWrite)
    else {
      view.terminal.write(data)
      completeWrite()
    }
  }

  const scheduleTerminalOutputFlush = (panelId: string, view: TerminalView) => {
    const queue = terminalOutputQueueFor(view)
    if (queue.disposed || queue.inFlight || queue.scheduledFlush !== null) return
    if (!isTerminalPanelRenderable(panelId)) return
    queue.scheduledFlush = requestOutputFlush(() => flushQueuedTerminalOutput(panelId, view))
  }

  const clearQueuedTerminalOutput = (view: TerminalView, options: { dispose?: boolean } = {}) => {
    const queue = terminalOutputQueueFor(view)
    if (queue.scheduledFlush !== null) {
      cancelOutputFlush(queue.scheduledFlush)
      queue.scheduledFlush = null
    }
    queue.pending = []
    queue.pendingBytes = 0
    queue.pendingChunks = 0
    queue.scrollToBottomAfterFlush = false
    if (options.dispose) {
      queue.disposed = true
      return
    }
    if (queue.inFlight) queue.clearAfterInFlight = true
    else view.terminal.clear()
  }

  const writeTerminalDisplayOutput = (
    panelId: string,
    view: TerminalView,
    data: string,
    options: { suppressInputReplies?: boolean; highlightMs?: number; reset?: boolean; scrollToBottom?: boolean } = {}
  ) => {
    if (!data) return
    const queue = terminalOutputQueueFor(view)
    if (options.reset) {
      queue.pending = []
      queue.pendingBytes = 0
      queue.pendingChunks = 0
      if (queue.scheduledFlush !== null) {
        cancelOutputFlush(queue.scheduledFlush)
        queue.scheduledFlush = null
      }
    }
    const bytes = textByteLength(data)
    queue.pending.push({
      chunks: 1,
      data,
      bytes,
      queuedAt: nowMs(),
      highlightMs: options.highlightMs || 0,
      maxChunkBytes: bytes,
      reset: Boolean(options.reset),
      suppressInputReplies: Boolean(options.suppressInputReplies)
    })
    queue.pendingBytes += bytes
    queue.pendingChunks += 1
    if (queue.pending.length >= terminalOutputCompactPendingChunks) {
      const compacted = queue.pending.map((item) => item.data).join('')
      const compactedBytes = queue.pending.reduce((total, item) => total + item.bytes, 0)
      const compactedChunks = queue.pending.reduce((total, item) => total + item.chunks, 0)
      const queuedAt = queue.pending.reduce((earliest, item) => Math.min(earliest, item.queuedAt), queue.pending[0]?.queuedAt ?? nowMs())
      const highlightMs = queue.pending.reduce((total, item) => total + item.highlightMs, 0)
      const maxChunkBytes = queue.pending.reduce((max, item) => Math.max(max, item.maxChunkBytes), 0)
      const reset = queue.pending.some((item) => item.reset)
      const suppressInputReplies = queue.pending.some((item) => item.suppressInputReplies)
      queue.pending = [
        {
          chunks: compactedChunks,
          data: compacted,
          bytes: compactedBytes,
          queuedAt,
          highlightMs,
          maxChunkBytes,
          reset,
          suppressInputReplies
        }
      ]
      queue.pendingBytes = compactedBytes
      queue.pendingChunks = compactedChunks
    }
    queue.scrollToBottomAfterFlush = queue.scrollToBottomAfterFlush || Boolean(options.scrollToBottom)
    scheduleTerminalOutputFlush(panelId, view)
  }

  const notifyBackendResize = (panelId: string, view: TerminalView) => {
    const panel = workspace.panels.find((item) => item.id === panelId)
    const resizeTerminal = terminalClient.resizeTerminal()
    if (!panel?.sessionId || !resizeTerminal) return
    if (view.lastFitCols === view.terminal.cols && view.lastFitRows === view.terminal.rows) return
    view.lastFitCols = view.terminal.cols
    view.lastFitRows = view.terminal.rows
    resizeTerminal(panel.sessionId, view.terminal.cols, view.terminal.rows)
    writeTerminalDebugLog('renderer.terminal.fit-resize', {
      panelId,
      sessionId: panel.sessionId,
      cols: view.terminal.cols,
      rows: view.terminal.rows
    })
  }

  const resetTerminalHostGeometry = (element: HTMLElement) => {
    element.style.width = ''
    element.style.height = ''
    element.style.maxWidth = ''
    element.style.maxHeight = ''
    const sizedNodes = element.querySelectorAll<HTMLElement>(
      '.xterm, .xterm-rows, .xterm-screen, .xterm-viewport, .xterm-scroll-area, .xterm-screen canvas, .xterm-screen .xterm-decoration-container, .xterm-screen .xterm-selection-layer, .xterm-screen .xterm-link-layer, .xterm-screen .xterm-text-layer'
    )
    sizedNodes.forEach((node) => {
      if (!node) return
      node.style.width = ''
      node.style.height = ''
      node.style.maxWidth = ''
      node.style.maxHeight = ''
      if (node instanceof HTMLCanvasElement) {
        node.removeAttribute('width')
        node.removeAttribute('height')
      }
    })
  }

  const estimateTerminalCellSize = (view: { terminal: XtermLike }, panelId: string) => {
    const terminalElement = terminalElements.get(panelId)
    const rect = terminalElement?.getBoundingClientRect()
    const hostWidth = terminalElement?.clientWidth || rect?.width || view.terminal.cols * 9
    const hostHeight = terminalElement?.clientHeight || rect?.height || view.terminal.rows * 18
    return {
      width: Math.max(6, hostWidth / Math.max(view.terminal.cols, 1)),
      height: Math.max(12, hostHeight / Math.max(view.terminal.rows, 1)),
      hostWidth,
      hostHeight
    }
  }

  const getSelectionVisibleRow = (view: { terminal: XtermLike }, panelId: string) => {
    const selectionPosition = view.terminal.getSelectionPosition()
    const selectedText = view.terminal.getSelection().trim()
    if (!selectionPosition || !selectedText) return null

    const viewportY = view.terminal.buffer.active.viewportY
    const visibleStart = viewportY
    const visibleEnd = viewportY + view.terminal.rows - 1
    const startY = selectionPosition.start.y
    const endY = selectionPosition.end.y
    if ((startY < visibleStart || startY > visibleEnd) && (endY < visibleStart || endY > visibleEnd)) return null

    const visibleSelectionRow = Math.max(visibleStart, Math.min(startY, visibleEnd))
    const terminalElement = terminalElements.get(panelId)
    const hostHeight = terminalElement?.clientHeight || terminalElement?.getBoundingClientRect().height || view.terminal.rows * 18
    const contentHeight = Math.max(0, hostHeight - terminalContentPaddingTop - terminalContentPaddingBottom)
    const cellHeight = Math.max(12, (contentHeight || hostHeight) / Math.max(view.terminal.rows, 1))
    const hostTop = terminalElement?.offsetTop || 0
    const contentTop = hostTop + terminalContentPaddingTop
    const rowIndex = Math.max(0, visibleSelectionRow - viewportY)
    const preferredTop = contentTop + Math.max(0, rowIndex - 2) * cellHeight
    const bottomSafe = Math.max(terminalBottomSafePx, cellHeight * 2)
    const minTop = hostTop + terminalFloatingGap
    const maxTop = hostTop + Math.max(minTop, hostHeight - terminalAiButtonHeight - bottomSafe)
    const aboveSelectionTop = contentTop + rowIndex * cellHeight - terminalAiButtonHeight - terminalFloatingGap
    const top = preferredTop > maxTop ? aboveSelectionTop : preferredTop
    return Math.round(Math.max(minTop, Math.min(top, maxTop)))
  }

  const updateSelectionButtonPosition = (panelId: string) => {
    const view = terminalViews.get(panelId)
    if (!view || !view.terminal.hasSelection()) {
      if (aiButtonPanelId.value === panelId) aiButtonPanelId.value = ''
      return
    }

    const top = getSelectionVisibleRow(view, panelId)
    if (top === null) {
      if (aiButtonPanelId.value === panelId) aiButtonPanelId.value = ''
      return
    }

    aiButtonPosition.top = top
    aiButtonPosition.right = 26
    aiButtonPanelId.value = panelId
  }

  const updateSuggestionsPosition = (panelId = suggestionPanel.panelId) => {
    if (!panelId || suggestionPanel.panelId !== panelId || (!suggestionItems.value.length && !aiSuggestLoading.value)) return
    const view = terminalViews.get(panelId)
    if (!view) return
    const { width: cellWidth, height: cellHeight, hostWidth, hostHeight } = estimateTerminalCellSize(view, panelId)
    const cursorX = view.terminal.buffer.active.cursorX || 0
    const cursorY = view.terminal.buffer.active.cursorY || 0
    const panelWidth = 320
    const estimatedRows = Math.min(6, suggestionItems.value.length + (aiSuggestLoading.value ? 1 : 0))
    const panelHeight = estimatedRows * 30 + 42
    const bufferDistance = Math.max(3, cellHeight * 0.2)
    const cursorLeft = cursorX * cellWidth
    const cursorTop = cursorY * cellHeight
    const belowTop = cursorTop + cellHeight + bufferDistance
    const aboveTop = cursorTop - panelHeight - bufferDistance

    suggestionPosition.left = Math.max(8, Math.min(cursorLeft, Math.max(8, hostWidth - panelWidth - 12)))
    suggestionPosition.top = belowTop + panelHeight > hostHeight ? Math.max(8, aboveTop) : belowTop
  }

  const scheduleTerminalFit = (panelId: string, options: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean } = {}) => {
    const frames = options.frames ?? 2
    const run = (remaining: number) => {
      window.requestAnimationFrame(() => {
        const view = terminalViews.get(panelId)
        const element = terminalElements.get(panelId)
        if (!view || !element?.isConnected) return
        if (!isTerminalPanelRenderable(panelId)) return
        if (options.forceGeometry) resetTerminalHostGeometry(element)
        view.fit.fit()
        view.terminal.ensureSurfaceAttached?.({ forceGeometry: options.forceGeometry })
        notifyBackendResize(panelId, view)
        if (options.forceGeometry) view.terminal.refresh(0, Math.max(0, view.terminal.rows - 1))
        if (options.scrollToBottom) view.terminal.scrollToBottom()
        updateSelectionButtonPosition(panelId)
        updateSuggestionsPosition(panelId)
        if (remaining > 1) run(remaining - 1)
      })
    }
    run(Math.max(1, frames))
  }

  const scheduleVisibleTerminalFit = (options: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean } = {}) => {
    visibleTerminalPanels.value
      .filter((panel) => isTerminalWorkspacePanel(panel))
      .forEach((panel) => scheduleTerminalFit(panel.id, options))
  }

  const scheduleTerminalFocus = (panelId: string, intent: number, frames = 6) => {
    const run = (remaining: number) => {
      nextTick(() => {
        if (intent !== terminalFocusIntent) return
        if (isTerminalFocusSuppressed(panelId)) return
        const view = terminalViews.get(panelId)
        const element = terminalElements.get(panelId)
        if (view && element?.isConnected && isTerminalPanelRenderable(panelId)) {
          view.terminal.focus()
          return
        }
        if (remaining <= 1) return
        const retry = () => run(remaining - 1)
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(retry)
        else requestOutputFlush(retry)
      })
    }
    run(Math.max(1, frames))
  }

  const refitAfterLayoutChange = () => {
    nextTick(() => scheduleVisibleTerminalFit({ scrollToBottom: true, frames: 6, forceGeometry: true }))
  }

  const applyTerminalSettingsToView = (
    panelId: string,
    view: TerminalView,
    settings: TerminalSettings = workspace.terminalSettings,
    options: { preservePaneFontSize?: boolean; refit?: boolean } = {}
  ) => {
    const preservePaneFontSize = options.preservePaneFontSize ?? true
    setXtermTermName(view.terminal, settings.terminalType)
    view.terminal.options.fontFamily = settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
    view.terminal.options.fontSize = preservePaneFontSize && paneFontSizes[panelId] ? paneFontSizes[panelId] : settings.fontSize || defaultTerminalFontSize()
    view.terminal.options.lineHeight = settings.lineHeight || 1
    view.terminal.options.cursorBlink = settings.cursorBlink
    view.terminal.options.cursorStyle = settings.cursorStyle
    view.terminal.options.scrollback = settings.scrollBack
    const theme = terminalTheme()
    view.terminal.options.theme = theme
    view.terminal.options.minimumContrastRatio = theme.minimumContrastRatio
    if (isThreadedTerminalHost(view.terminal)) {
      view.terminal.updateSettings(
        {
          ...settings,
          fontSize: Number(view.terminal.options.fontSize || settings.fontSize || defaultTerminalFontSize())
        },
        theme
      )
    }
    if (options.refit !== false) {
      scheduleTerminalFit(panelId, { scrollToBottom: true, frames: 3, forceGeometry: true })
    }
  }

  const applyTerminalSettingsToAll = () => {
    terminalViews.forEach((view, panelId) => applyTerminalSettingsToView(panelId, view))
    syncThreadedKeywordHighlight()
  }

  const syncTerminalView = (panel: TerminalPanel, options: { suppressInputReplies?: boolean; refit?: boolean } = {}) => {
    if (!isTerminalWorkspacePanel(panel)) return false
    const view = terminalViews.get(panel.id)
    if (!view) return false
    if (!isTerminalPanelRenderable(panel.id)) return false
    if (isThreadedTerminalHost(view.terminal)) {
      view.terminal.setSessionId(panel.sessionId)
      view.terminal.setVisibility(true, terminalPriorityForPanel(panel.id))
      view.terminal.ensureSurfaceAttached({ forceGeometry: options.refit })
      if (options.refit) scheduleTerminalFit(panel.id, { scrollToBottom: true, frames: 3, forceGeometry: true })
      else {
        updateSelectionButtonPosition(panel.id)
        updateSuggestionsPosition(panel.id)
      }
      return true
    }
    const highlightedAt = nowMs()
    const displayOutput = workspace.getHighlightedTerminalOutput(panel.id)
    const highlightMs = nowMs() - highlightedAt
    let wroteOutput = false
    if (displayOutput !== view.lastOutput) {
      if (displayOutput.startsWith(view.lastOutput)) {
        const chunk = displayOutput.slice(view.lastOutput.length)
        writeTerminalDisplayOutput(panel.id, view, chunk, { suppressInputReplies: options.suppressInputReplies, highlightMs, scrollToBottom: true })
      } else {
        writeTerminalDisplayOutput(panel.id, view, displayOutput, { suppressInputReplies: true, highlightMs, reset: true, scrollToBottom: true })
      }
      view.lastOutput = displayOutput
      wroteOutput = true
    } else if (terminalDebugLogs && highlightMs >= terminalOutputSlowThresholdMs) {
      writeRuntimeLog('warn', 'renderer.terminal-output.slow-highlight', {
        panelId: panel.id,
        highlightMs: Math.round(highlightMs * 10) / 10,
        outputBytes: textByteLength(displayOutput)
      })
    }
    if (options.refit) {
      scheduleTerminalFit(panel.id, { scrollToBottom: true })
    } else {
      if (!wroteOutput) {
        const queue = terminalOutputQueueFor(view)
        if (queue.pending.length) scheduleTerminalOutputFlush(panel.id, view)
        updateSelectionButtonPosition(panel.id)
        updateSuggestionsPosition(panel.id)
      }
    }
    return true
  }

  const writeLiveTerminalData = (panelId: string, sessionId: string, data: string) => {
    if (!data || !sessionId) return false
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (!panel || !isTerminalWorkspacePanel(panel)) return false
    if (panel.sessionId !== sessionId) return false
    const view = terminalViews.get(panel.id)
    if (!view || !isThreadedTerminalHost(view.terminal)) return false
    const visible = isTerminalPanelRenderable(panel.id)
    view.terminal.setSessionId(sessionId)
    view.terminal.setVisibility(visible, terminalPriorityForPanel(panel.id))
    return view.terminal.writeBackendData(sessionId, data)
  }

  const terminalOutputMirrorText = (panel: TerminalPanel) => {
    const view = terminalViews.get(panel.id)
    if (view && isThreadedTerminalHost(view.terminal)) return ''
    return panel.output
  }

  const scheduleTerminalViewSync = (
    panel: TerminalPanel,
    options: { suppressInputReplies?: boolean; refit?: boolean } = {},
    attempts = 4
  ) => {
    const run = (remaining: number) => {
      nextTick(() => {
        const currentPanel = workspace.panels.find((item) => item.id === panel.id)
        if (!currentPanel || !isTerminalWorkspacePanel(currentPanel)) return
        if (syncTerminalView(currentPanel, options)) return
        if (remaining <= 0) return
        requestOutputFlush(() => run(remaining - 1))
      })
    }
    run(Math.max(0, attempts))
  }

  const createTerminalView = (panel: TerminalPanel, element: HTMLElement) => {
    if (!isTerminalWorkspacePanel(panel)) return
    const existing = terminalViews.get(panel.id)
    if (existing) {
      if (isThreadedTerminalHost(existing.terminal)) {
        terminalViewPanels.set(panel.id, panel)
        existing.terminal.setSessionId(panel.sessionId)
        const visible = isTerminalPanelRenderable(panel.id)
        existing.terminal.setVisibility(visible, terminalPriorityForPanel(panel.id))
        if (existing.openedElement === element) {
          const surfaceAttached = existing.terminal.debugInfo().surfaceAttached
          if (visible && !surfaceAttached) {
            existing.terminal.ensureSurfaceAttached({ forceGeometry: true })
            scheduleTerminalFit(panel.id, { scrollToBottom: true, frames: 4, forceGeometry: true })
          }
          return
        }
        writeTerminalDebugLog('renderer.terminal-view.threaded-attach-existing', {
          panelId: panel.id,
          hasSession: Boolean(panel.sessionId),
          visible,
          surfaceAttached: existing.terminal.debugInfo().surfaceAttached,
          movedHost: Boolean(existing.openedElement)
        })
        existing.terminal.open(element)
        existing.openedElement = element
        existing.terminal.setVisibility(visible, terminalPriorityForPanel(panel.id))
        existing.terminal.ensureSurfaceAttached({ forceGeometry: true })
        attachTerminalKeyboardShortcutHandler(panel, existing)
        applyTerminalSettingsToView(panel.id, existing, workspace.terminalSettings, { refit: false })
        existing.resizeObserver?.disconnect()
        if (typeof ResizeObserver !== 'undefined') {
          existing.resizeObserver = new ResizeObserver(() => {
            scheduleTerminalFit(panel.id, { frames: 2 })
          })
          existing.resizeObserver.observe(element)
        } else {
          existing.resizeObserver = undefined
        }
        scheduleTerminalFit(panel.id, { scrollToBottom: true, frames: 2, forceGeometry: true })
        return
      }
      if (terminalViewPanels.get(panel.id) !== panel) {
        disposeTerminalView(panel.id, 'panel-replaced')
      } else {
        return
      }
    }
    const theme = terminalTheme()
    const useThreaded = canUseThreadedTerminal()
    const createLegacyView = () => {
      const terminal = new TerminalConstructor({
        allowTransparency: true,
        cursorBlink: workspace.terminalSettings.cursorBlink,
        convertEol: true,
        cursorStyle: workspace.terminalSettings.cursorStyle,
        fontFamily: workspace.terminalSettings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
        fontSize: terminalFontSizeForPanel(panel.id),
        lineHeight: workspace.terminalSettings.lineHeight || 1,
        minimumContrastRatio: theme.minimumContrastRatio,
        scrollback: workspace.terminalSettings.scrollBack,
        theme
      })
      const fit = new FitConstructor()
      const searchAddon = new SearchConstructor()
      terminal.loadAddon(fit)
      terminal.loadAddon(searchAddon)
      return { terminal, fit, search: searchAddon, lastOutput: '' } as TerminalView
    }
    let view: TerminalView = useThreaded ? createThreadedViewForPanel(panel) : createLegacyView()
    let openedThreaded = false
    try {
      writeTerminalDebugLog('renderer.terminal-view.open-start', {
        panelId: panel.id,
        hasSession: Boolean(panel.sessionId),
        threaded: useThreaded
      })
      view.terminal.open(element)
      view.openedElement = element
      openedThreaded = useThreaded
    } catch (error) {
      if (!useThreaded) throw error
      writeRuntimeLog('error', 'renderer.terminal-view.threaded-open-failed', {
        panelId: panel.id,
        hasSession: Boolean(panel.sessionId),
        message: error instanceof Error ? error.message : String(error)
      })
      view.terminal.dispose()
      terminalViews.delete(panel.id)
      element.replaceChildren()
      view = createLegacyView()
      view.terminal.open(element)
      view.openedElement = element
    }
    terminalViews.set(panel.id, view)
    terminalViewPanels.set(panel.id, panel)
    view.clearPendingOutput = () => clearQueuedTerminalOutput(view)
    attachTerminalKeyboardShortcutHandler(panel, view)
    applyTerminalSettingsToView(panel.id, view, workspace.terminalSettings, { refit: false })
    if (typeof ResizeObserver !== 'undefined') {
      view.resizeObserver = new ResizeObserver(() => {
        scheduleTerminalFit(panel.id, { frames: 2 })
      })
      view.resizeObserver.observe(element)
    }
    writeTerminalDebugLog('renderer.terminal-view.created', {
      panelId: panel.id,
      hasSession: Boolean(panel.sessionId),
      threaded: isThreadedTerminalHost(view.terminal),
      requestedThreaded: useThreaded
    })
    if (!isThreadedTerminalHost(view.terminal)) {
      scheduleTerminalViewSync(panel, { suppressInputReplies: Boolean(panel.output), refit: true })
    } else {
      scheduleTerminalFit(panel.id, { scrollToBottom: true, frames: 2 })
    }
    if (!openedThreaded) bindTerminalViewEvents(panel, view)
    if (!isThreadedTerminalHost(view.terminal)) element.querySelector('.xterm-viewport')?.addEventListener(
      'scroll',
      () => {
        updateSelectionButtonPosition(panel.id)
        updateSuggestionsPosition(panel.id)
      },
      { passive: true }
    )
  }

  const setTerminalElement = (panelId: string, element: Element | ComponentPublicInstance | null) => {
    if (!(element instanceof HTMLElement)) {
      terminalElements.delete(panelId)
      const view = terminalViews.get(panelId)
      if (view) {
        if (isThreadedTerminalHost(view.terminal)) {
          view.resizeObserver?.disconnect()
          view.resizeObserver = undefined
          view.openedElement = undefined
          view.terminal.detachSurface()
          return
        }
        disposeTerminalView(panelId, 'view-disposed')
      }
      return
    }
    terminalElements.set(panelId, element)
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (panel && isTerminalWorkspacePanel(panel)) {
      if (isTerminalWorkspaceVisible()) createTerminalView(panel, element)
    }
  }

  const syncPanelViews = () => {
    return nextTick(() => {
      workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel)).forEach((panel) => {
        const existing = terminalViews.get(panel.id)
        if (existing && terminalViewPanels.get(panel.id) !== panel) {
          if (isThreadedTerminalHost(existing.terminal)) {
            existing.terminal.setSessionId(panel.sessionId)
            terminalViewPanels.set(panel.id, panel)
          }
          else disposeTerminalView(panel.id, 'panel-replaced')
        }
        if (existing && isThreadedTerminalHost(existing.terminal)) existing.terminal.setSessionId(panel.sessionId)
        const element = terminalElements.get(panel.id)
        if (isTerminalWorkspaceVisible() && element && visibleTerminalPanelIds().has(panel.id)) createTerminalView(panel, element)
        else if (isTerminalWorkspaceVisible() && canUseThreadedTerminal() && !terminalViews.has(panel.id)) {
          const view = createThreadedViewForPanel(panel)
          if (isThreadedTerminalHost(view.terminal)) view.terminal.startCoreOnly()
          terminalViews.set(panel.id, view)
          terminalViewPanels.set(panel.id, panel)
          writeTerminalDebugLog('renderer.terminal-view.created', {
            panelId: panel.id,
            hasSession: Boolean(panel.sessionId),
            threaded: true,
            coreOnly: true
          })
        }
      })
      for (const panelId of terminalViews.keys()) {
        if (!workspace.panels.some((panel) => panel.id === panelId)) {
          disposeTerminalView(panelId, 'panel-removed')
          terminalElements.delete(panelId)
        }
      }
      syncThreadedTerminalPriorities()
    })
  }

  const terminalViewSize = (panelId: string) => {
    const view = terminalViews.get(panelId)
    view?.fit.fit()
    return {
      cols: view?.terminal.cols || 80,
      rows: view?.terminal.rows || 24
    }
  }

  const updateFontSize = (panelId: string, nextSize: number) => {
    const view = terminalViews.get(panelId)
    if (!view) return
    const normalized = Math.min(24, Math.max(9, nextSize))
    paneFontSizes[panelId] = normalized
    view.terminal.options.fontSize = normalized
    if (isThreadedTerminalHost(view.terminal)) {
      view.terminal.updateSettings(
        {
          ...workspace.terminalSettings,
          fontSize: normalized
        },
        terminalTheme()
      )
    }
    scheduleTerminalFit(panelId, { scrollToBottom: true, frames: 4, forceGeometry: true })
  }

  const focusPanel = (panelId: string) => {
    terminalFocusIntent += 1
    scheduleTerminalFocus(panelId, terminalFocusIntent)
  }

  const getTerminalElement = (panelId: string) => terminalElements.get(panelId) || null

  const focusActivePanel = () => {
    focusPanel(workspace.activePanelId)
  }

  const setTerminalKeyboardShortcutHandler = (handler: TerminalKeyboardShortcutHandler | null) => {
    terminalKeyboardShortcutHandler = handler
    terminalViews.forEach((view, panelId) => {
      const panel = terminalViewPanels.get(panelId) || workspace.panels.find((item) => item.id === panelId)
      if (panel) attachTerminalKeyboardShortcutHandler(panel, view)
    })
  }

  const dispose = () => {
    terminalViews.forEach((view, panelId) => {
      clearQueuedTerminalOutput(view, { dispose: true })
      flushTerminalOutputPerf(panelId, view, 'runtime-disposed')
      view.resizeObserver?.disconnect()
      view.terminal.dispose()
    })
    terminalViews.clear()
    terminalViewPanels.clear()
    terminalElements.clear()
  }

  return {
    activeView,
    applyTerminalSettingsToAll,
    dispose,
    estimateTerminalCellSize,
    focusActivePanel,
    focusPanel,
    getTerminalElement,
    setTerminalKeyboardShortcutHandler,
    refitAfterLayoutChange,
    scheduleTerminalFit,
    scheduleVisibleTerminalFit,
    setTerminalElement,
    syncPanelViews,
    syncTerminalView,
    syncThreadedKeywordHighlight,
    syncThreadedTerminalPriorities,
    terminalSettingsSignature,
    terminalViewSize,
    terminalViews,
    terminalFontSizeForPanel,
    terminalOutputMirrorText,
    updateFontSize,
    writeLiveTerminalData,
    updateSelectionButtonPosition,
    updateSuggestionsPosition
  }
}
