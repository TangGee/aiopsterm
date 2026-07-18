import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { markRaw } from 'vue'
import {
  applyCodexExitEvent,
  applyCodexLifecycleEvent,
  applyCodexSessionStarted,
  markCodexPendingTargetDelivered as markCodexRuntimePendingTargetDelivered,
  markCodexTargetSyncFailed,
  prepareCodexPendingTargetContext,
  prepareCodexTargetSync,
  type AiPanelCodexConversationRuntimeState
} from '@/services/ai/aiPanelCodexRuntime'
import { codexSessionClient } from '@/services/ai/codexSessionClient'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import { terminalThemeForAppTheme, type TerminalSurfaceMode } from '@/services/terminal/terminalThemeRuntime'
import {
  ThreadedTerminalFitAddon,
  createThreadedTerminalHost,
  isThreadedTerminalHost,
  threadedTerminalCapability,
  type ThreadedTerminalHost
} from '@/services/terminal/threadedTerminalRuntime'
import { isTerminalCopyShortcut } from '@/services/terminal/terminalKeyboardShortcuts'
import type { CodexTargetEventKind } from '@/services/ai/codexTargetRuntime'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import type { CodexSessionKillResult, CodexSessionTargetContext } from '@shared/contracts/codexSessions'
import { shouldUseTerminalDebugLogs, shouldUseThreadedTerminal } from '@shared/runtimeSwitches'

type XtermRuntimeOptions = XtermTerminal['options'] & { termName?: string; minimumContrastRatio?: number }

export type AiPanelCodexTerminalSettings = Pick<
  TerminalSettings,
  'terminalType' | 'fontFamily' | 'fontSize' | 'lineHeight' | 'cursorBlink' | 'cursorStyle' | 'scrollBack'
>

export type AiPanelCodexTerminalLike = {
  cols: number
  rows: number
  options: XtermRuntimeOptions
  loadAddon: (addon: unknown) => void
  open: (element: HTMLElement) => void
  focus: () => void
  clear: () => void
  dispose: () => void
  write: (data: string, callback?: () => void) => void
  getSelection: () => string
  attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => void
  onData: (handler: (data: string) => void) => unknown
  onResize: (handler: (size: { cols: number; rows: number }) => unknown) => unknown
}

export type AiPanelCodexFitLike = {
  fit: () => void
}

export type AiPanelCodexResizeObserverLike = {
  observe: (element: Element) => void
  disconnect: () => void
}

export type AiPanelCodexTerminalConversation<
  TTerminal extends AiPanelCodexTerminalLike = AiPanelCodexTerminalLike,
  TFit extends AiPanelCodexFitLike = AiPanelCodexFitLike
> = AiPanelCodexConversationRuntimeState & {
  nativeThreadId?: string
  projectRoot?: string
  launchMode?: 'new' | 'resume' | 'fork'
  host: HTMLElement | null
  terminal: TTerminal | null
  threadedTerminal?: boolean
  fit: TFit | null
  resizeObserver: AiPanelCodexResizeObserverLike | null
}

export type AiPanelCodexSessionClient = typeof codexSessionClient

export type AiPanelCodexTerminalRuntimeLabels = {
  error: () => string
  bridgeMissing: () => string
  startFailed: () => string
  exitNonZero: () => string
  unsavedSessionRecovered: () => string
  threadedUnavailable: () => string
  copyEmpty: () => string
  copySuccess: () => string
  copyFailure: () => string
}

export type AiPanelCodexTerminalRuntimeOptions<TConversation extends AiPanelCodexTerminalConversation> = {
  conversations: () => TConversation[]
  activeConversation: () => TConversation | null
  activeConversationId: () => string
  terminalSettings: () => AiPanelCodexTerminalSettings
  themeId?: () => string
  terminalSurfaceMode?: () => TerminalSurfaceMode
  currentBoundTarget: (conversation: TConversation) => CodexSessionTargetContext | null
  isConversationVisible?: (conversation: TConversation) => boolean
  syncAttentionState: (conversation: TConversation) => void
  labels: AiPanelCodexTerminalRuntimeLabels
  notify: (message: string) => void
  afterDomUpdate: () => void | Promise<void>
  copyText?: (text: string) => Promise<boolean>
  log?: (level: RuntimeLogLevel, event: string, fields?: Record<string, unknown>) => void
  client?: AiPanelCodexSessionClient
  requestFrame?: (callback: () => void) => unknown
  terminalConstructor?: new (options: ConstructorParameters<typeof XtermTerminal>[0]) => AiPanelCodexTerminalLike
  fitConstructor?: new () => AiPanelCodexFitLike
  resizeObserverFactory?: (callback: ResizeObserverCallback) => AiPanelCodexResizeObserverLike
}

type CodexTerminalOutputPerfSummary = {
  chunks: number
  writes: number
  bytes: number
  firstAt: number
  lastAt: number
  writeMs: number
  queueMs: number
  maxWriteMs: number
  maxQueueMs: number
  maxChunkBytes: number
  maxBatchBytes: number
  maxPendingBytes: number
  maxPendingChunks: number
  clears: number
}

type CodexQueuedOutput = {
  chunks: number
  data: string
  bytes: number
  queuedAt: number
  maxChunkBytes: number
}

type CodexTerminalOutputWriteQueue = {
  pending: CodexQueuedOutput[]
  pendingBytes: number
  pendingChunks: number
  scheduledFlush: unknown | null
  inFlight: boolean
  clearAfterInFlight: boolean
  disposed: boolean
}

type CodexTerminalOutputState = {
  queue: CodexTerminalOutputWriteQueue
  perf?: CodexTerminalOutputPerfSummary
}

export const codexTerminalCopyShortcut = isTerminalCopyShortcut

const setXtermTermName = (terminal: AiPanelCodexTerminalLike, terminalType: string) => {
  terminal.options.termName = terminalType || 'xterm-256color'
}

const defaultRequestFrame = (callback: () => void) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback)
  callback()
  return 0
}

const defaultResizeObserverFactory = (callback: ResizeObserverCallback) => {
  if (typeof ResizeObserver === 'undefined') return null
  return new ResizeObserver(callback)
}

const codexOutputSummaryIntervalMs = 1000
const codexOutputSummaryChunkThreshold = 50
const codexOutputSlowThresholdMs = 16
const codexOutputMaxWriteBytes = 8 * 1024
const codexOutputMaxWriteChunks = 32
const codexOutputCompactPendingChunks = 128

const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
const textByteLength = (value: string) => new TextEncoder().encode(value).length

export const createAiPanelCodexTerminalRuntime = <TConversation extends AiPanelCodexTerminalConversation>(
  options: AiPanelCodexTerminalRuntimeOptions<TConversation>
) => {
  const cancelledStarts = new WeakSet<TConversation>()
  const client = options.client || codexSessionClient
  const log = options.log || writeRendererRuntimeLog
  const terminalDebugLogs = shouldUseTerminalDebugLogs()
  const logDebug = (event: string, fields?: Record<string, unknown>) => {
    if (terminalDebugLogs) log('debug', event, fields)
  }
  const copyText = options.copyText || copyTextToClipboard
  const requestFrame = options.requestFrame || defaultRequestFrame
  const resizeObserverFactory = options.resizeObserverFactory || defaultResizeObserverFactory
  const terminalUnavailableReasonByConversation = new WeakMap<TConversation, string>()
  const shouldUseInjectedTerminal = () => Boolean(options.terminalConstructor && options.fitConstructor)
  const threadedTerminalUnavailableReason = () => {
    if (!shouldUseThreadedTerminal()) return 'threaded terminal switch is disabled'
    const capability = threadedTerminalCapability()
    if (!capability.supported) return capability.reason || 'threaded terminal capability check failed'
    return ''
  }
  const markThreadedTerminalUnavailable = (conversation: TConversation, reason: string) => {
    const error = options.labels.threadedUnavailable()
    if (
      terminalUnavailableReasonByConversation.get(conversation) === reason &&
      conversation.status === 'error' &&
      conversation.error === error
    ) return
    conversation.status = 'error'
    conversation.error = error
    terminalUnavailableReasonByConversation.set(conversation, reason)
    options.syncAttentionState(conversation)
    log('error', 'renderer.codex-threaded-terminal.required', {
      localId: conversation.id,
      sessionId: conversation.sessionId,
      reason
    })
  }

  let offData: (() => void) | null = null
  let offLifecycle: (() => void) | null = null
  let offExit: (() => void) | null = null
  let offThread: (() => void) | null = null
  const pendingSessionStartConversations: TConversation[] = []
  const pendingConversationBySessionId = new Map<string, TConversation>()
  const outputStates = new Map<string, CodexTerminalOutputState>()

  const requestOutputFlush = (callback: () => void) =>
    typeof window !== 'undefined' && typeof window.setTimeout === 'function' ? window.setTimeout(callback, 0) : setTimeout(callback, 0)

  const cancelOutputFlush = (flush: unknown) => {
    if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') window.clearTimeout(flush as number)
    else clearTimeout(flush as ReturnType<typeof setTimeout>)
  }

  const isConversationVisible = (conversation: TConversation) =>
    options.isConversationVisible ? options.isConversationVisible(conversation) : options.activeConversationId() === conversation.id
  const isThreadedConversationTerminal = (conversation: TConversation) => Boolean(conversation.terminal && isThreadedTerminalHost(conversation.terminal))
  const shouldPrepareTerminal = (conversation: TConversation) =>
    Boolean(conversation.sessionId || conversation.startPromise || options.currentBoundTarget(conversation))
  const terminalTheme = () =>
    terminalThemeForAppTheme(options.themeId?.() || 'dark', {
      surface: 'codex',
      surfaceMode: options.terminalSurfaceMode?.() || 'base'
    })

  const syncThreadedConversationSurface = (conversation: TConversation, syncOptions: { forceGeometry?: boolean } = {}) => {
    const terminal = conversation.terminal
    if (!terminal || !isThreadedTerminalHost(terminal)) return
    terminal.setSessionId(conversation.sessionId || undefined)
    const visible = isConversationVisible(conversation)
    terminal.setVisibility(visible, visible ? 'active' : 'background')
    if (visible && syncOptions.forceGeometry) terminal.ensureSurfaceAttached({ forceGeometry: true })
  }

  const activeConversations = () => new Set(options.conversations())

  const removePendingStartConversation = (conversation: TConversation) => {
    const index = pendingSessionStartConversations.indexOf(conversation)
    if (index >= 0) pendingSessionStartConversations.splice(index, 1)
    pendingConversationBySessionId.forEach((value, sessionId) => {
      if (value === conversation) pendingConversationBySessionId.delete(sessionId)
    })
  }

  const rememberPendingStartConversation = (conversation: TConversation) => {
    removePendingStartConversation(conversation)
    pendingSessionStartConversations.push(conversation)
  }

  const conversationForSessionId = (sessionId: string) => {
    const conversations = options.conversations()
    return conversations.find((item) => item.sessionId === sessionId) || pendingConversationBySessionId.get(sessionId) || null
  }

  const claimPendingSessionConversation = (sessionId: string) => {
    const existing = conversationForSessionId(sessionId)
    if (existing) return existing
    const conversations = activeConversations()
    const conversation = pendingSessionStartConversations.find((item) => conversations.has(item) && !item.sessionId)
    if (!conversation) return null
    pendingConversationBySessionId.set(sessionId, conversation)
    conversation.sessionId = sessionId
    syncThreadedConversationSurface(conversation, { forceGeometry: true })
    logDebug('renderer.codex-session.pending-bound', { localId: conversation.id, sessionId })
    return conversation
  }

  const outputStateFor = (conversation: TConversation): CodexTerminalOutputState => {
    const existing = outputStates.get(conversation.id)
    if (existing) return existing
    const state: CodexTerminalOutputState = {
      queue: {
        pending: [],
        pendingBytes: 0,
        pendingChunks: 0,
        scheduledFlush: null,
        inFlight: false,
        clearAfterInFlight: false,
        disposed: false
      }
    }
    outputStates.set(conversation.id, state)
    return state
  }

  const logCodexOutputSummary = (conversation: TConversation, summary: CodexTerminalOutputPerfSummary, reason: string) => {
    logDebug('renderer.codex-output.summary', {
      localId: conversation.id,
      sessionId: conversation.sessionId,
      reason,
      chunks: summary.chunks,
      writes: summary.writes,
      bytes: summary.bytes,
      durationMs: Math.max(0, Math.round(summary.lastAt - summary.firstAt)),
      writeMs: Math.round(summary.writeMs * 10) / 10,
      queueMs: Math.round(summary.queueMs * 10) / 10,
      maxWriteMs: Math.round(summary.maxWriteMs * 10) / 10,
      maxQueueMs: Math.round(summary.maxQueueMs * 10) / 10,
      maxChunkBytes: summary.maxChunkBytes,
      maxBatchBytes: summary.maxBatchBytes,
      maxPendingBytes: summary.maxPendingBytes,
      maxPendingChunks: summary.maxPendingChunks,
      clears: summary.clears
    })
  }

  const flushCodexOutputPerf = (conversation: TConversation, reason: string) => {
    const state = outputStates.get(conversation.id)
    if (!state?.perf) return
    logCodexOutputSummary(conversation, state.perf, reason)
    state.perf = undefined
  }

  const recordCodexOutputPerf = (
    conversation: TConversation,
    metrics: {
      chunks: number
      bytes: number
      writeMs: number
      queueMs: number
      maxChunkBytes: number
      pendingBytes: number
      pendingChunks: number
      cleared?: boolean
    }
  ) => {
    const state = outputStateFor(conversation)
    const now = nowMs()
    const existing = state.perf
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
        maxWriteMs: 0,
        maxQueueMs: 0,
        maxChunkBytes: 0,
        maxBatchBytes: 0,
        maxPendingBytes: 0,
        maxPendingChunks: 0,
        clears: 0
      }
    summary.chunks += metrics.chunks
    summary.writes += 1
    summary.bytes += metrics.bytes
    summary.lastAt = now
    summary.writeMs += metrics.writeMs
    summary.queueMs += metrics.queueMs
    summary.maxWriteMs = Math.max(summary.maxWriteMs, metrics.writeMs)
    summary.maxQueueMs = Math.max(summary.maxQueueMs, metrics.queueMs)
    summary.maxChunkBytes = Math.max(summary.maxChunkBytes, metrics.maxChunkBytes)
    summary.maxBatchBytes = Math.max(summary.maxBatchBytes, metrics.bytes)
    summary.maxPendingBytes = Math.max(summary.maxPendingBytes, metrics.pendingBytes)
    summary.maxPendingChunks = Math.max(summary.maxPendingChunks, metrics.pendingChunks)
    if (metrics.cleared) summary.clears += 1
    state.perf = summary
    if (metrics.writeMs >= codexOutputSlowThresholdMs) {
      log('warn', 'renderer.codex-output.slow-write', {
        localId: conversation.id,
        sessionId: conversation.sessionId,
        chunks: metrics.chunks,
        bytes: metrics.bytes,
        writeMs: Math.round(metrics.writeMs * 10) / 10,
        queueMs: Math.round(metrics.queueMs * 10) / 10,
        pendingBytes: metrics.pendingBytes,
        pendingChunks: metrics.pendingChunks
      })
    }
    if (summary.lastAt - summary.firstAt >= codexOutputSummaryIntervalMs || summary.chunks >= codexOutputSummaryChunkThreshold) {
      flushCodexOutputPerf(conversation, summary.chunks >= codexOutputSummaryChunkThreshold ? 'chunk-threshold' : 'interval')
    }
  }

  const takeQueuedCodexOutputBatch = (queue: CodexTerminalOutputWriteQueue) => {
    const queued: CodexQueuedOutput[] = []
    let bytes = 0
    let chunks = 0
    while (queue.pending.length) {
      const next = queue.pending[0]
      const wouldExceedBytes = bytes > 0 && bytes + next.bytes > codexOutputMaxWriteBytes
      const wouldExceedChunks = chunks > 0 && chunks + next.chunks > codexOutputMaxWriteChunks
      if (wouldExceedBytes || wouldExceedChunks) break
      queued.push(next)
      bytes += next.bytes
      chunks += next.chunks
      queue.pending.shift()
      queue.pendingBytes = Math.max(0, queue.pendingBytes - next.bytes)
      queue.pendingChunks = Math.max(0, queue.pendingChunks - next.chunks)
      if (bytes >= codexOutputMaxWriteBytes || chunks >= codexOutputMaxWriteChunks) break
    }
    return queued
  }

  const scheduleCodexOutputFlush = (conversation: TConversation) => {
    const state = outputStateFor(conversation)
    const queue = state.queue
    if (queue.disposed || queue.inFlight || queue.scheduledFlush !== null) return
    if (!conversation.terminal || !conversation.host?.isConnected) return
    if (!isThreadedConversationTerminal(conversation) && !isConversationVisible(conversation)) return
    if (!queue.pending.length && !queue.clearAfterInFlight) return
    queue.scheduledFlush = requestOutputFlush(() => flushQueuedCodexOutput(conversation))
  }

  const flushQueuedCodexOutput = (conversation: TConversation) => {
    const state = outputStateFor(conversation)
    const queue = state.queue
    queue.scheduledFlush = null
    if (queue.disposed || queue.inFlight) return
    if (!conversation.terminal || !conversation.host?.isConnected) return
    if (!isThreadedConversationTerminal(conversation) && !isConversationVisible(conversation)) return
    if (!queue.pending.length) {
      if (queue.clearAfterInFlight) {
        queue.clearAfterInFlight = false
        conversation.terminal.clear()
      }
      return
    }

    const pendingBytesAtFlush = queue.pendingBytes
    const pendingChunksAtFlush = queue.pendingChunks
    const queued = takeQueuedCodexOutputBatch(queue)
    queue.inFlight = true

    const data = queued.map((item) => item.data).join('')
    const bytes = queued.reduce((total, item) => total + item.bytes, 0)
    const chunks = queued.reduce((total, item) => total + item.chunks, 0)
    const maxChunkBytes = queued.reduce((max, item) => Math.max(max, item.maxChunkBytes), 0)
    const queuedAt = queued.reduce((earliest, item) => Math.min(earliest, item.queuedAt), queued[0]?.queuedAt ?? nowMs())
    const queueMs = Math.max(0, nowMs() - queuedAt)
    const startedAt = nowMs()

    const completeWrite = () => {
      queue.inFlight = false
      if (queue.disposed) return
      const cleared = queue.clearAfterInFlight
      recordCodexOutputPerf(conversation, {
        chunks,
        bytes,
        writeMs: nowMs() - startedAt,
        queueMs,
        maxChunkBytes,
        pendingBytes: pendingBytesAtFlush,
        pendingChunks: pendingChunksAtFlush,
        cleared
      })
      if (queue.clearAfterInFlight) {
        queue.clearAfterInFlight = false
        if (!queue.disposed && conversation.terminal) conversation.terminal.clear()
      }
      if (queue.pending.length && !queue.disposed) scheduleCodexOutputFlush(conversation)
    }

    if (isThreadedConversationTerminal(conversation)) {
      conversation.terminal.write(data)
      completeWrite()
    } else if (conversation.terminal.write.length >= 2) conversation.terminal.write(data, completeWrite)
    else {
      conversation.terminal.write(data)
      completeWrite()
    }
  }

  const writeCodexDisplayOutput = (conversation: TConversation, data: string) => {
    if (!data) return
    const threadedTerminal = isThreadedConversationTerminal(conversation)
    const existingState = outputStates.get(conversation.id)
    const hasQueuedOutput = Boolean(
      existingState &&
        (existingState.queue.pending.length ||
          existingState.queue.inFlight ||
          existingState.queue.scheduledFlush !== null)
    )
    if (threadedTerminal && !hasQueuedOutput) {
      conversation.terminal?.write(data)
      return
    }
    const state = outputStateFor(conversation)
    const queue = state.queue
    if (queue.disposed) queue.disposed = false
    const bytes = textByteLength(data)
    queue.pending.push({
      chunks: 1,
      data,
      bytes,
      queuedAt: nowMs(),
      maxChunkBytes: bytes
    })
    queue.pendingBytes += bytes
    queue.pendingChunks += 1
    if (queue.pending.length >= codexOutputCompactPendingChunks) {
      const compacted = queue.pending.map((item) => item.data).join('')
      const compactedBytes = queue.pending.reduce((total, item) => total + item.bytes, 0)
      const compactedChunks = queue.pending.reduce((total, item) => total + item.chunks, 0)
      const queuedAt = queue.pending.reduce((earliest, item) => Math.min(earliest, item.queuedAt), queue.pending[0]?.queuedAt ?? nowMs())
      const maxChunkBytes = queue.pending.reduce((max, item) => Math.max(max, item.maxChunkBytes), 0)
      queue.pending = [
        {
          chunks: compactedChunks,
          data: compacted,
          bytes: compactedBytes,
          queuedAt,
          maxChunkBytes
        }
      ]
      queue.pendingBytes = compactedBytes
      queue.pendingChunks = compactedChunks
    }
    scheduleCodexOutputFlush(conversation)
  }

  const clearCodexDisplayOutput = (conversation: TConversation, clearOptions: { dispose?: boolean } = {}) => {
    const state = outputStateFor(conversation)
    const queue = state.queue
    if (queue.scheduledFlush !== null) {
      cancelOutputFlush(queue.scheduledFlush)
      queue.scheduledFlush = null
    }
    queue.pending = []
    queue.pendingBytes = 0
    queue.pendingChunks = 0
    if (clearOptions.dispose) {
      queue.disposed = true
      flushCodexOutputPerf(conversation, 'conversation-disposed')
      outputStates.delete(conversation.id)
      return
    }
    if (queue.inFlight) queue.clearAfterInFlight = true
    else conversation.terminal?.clear()
  }

  const fitTerminal = (fitOptions: { force?: boolean; conversation?: TConversation | null } = {}) => {
    const conversation = fitOptions.conversation || options.activeConversation()
    if (!conversation?.terminal || !conversation.fit || !conversation.host?.isConnected) return
    requestFrame(() => {
      if (options.activeConversationId() !== conversation.id) return
      if (!conversation.terminal || !conversation.fit || !conversation.host?.isConnected) return
      conversation.fit.fit()
      const resizeCodexSession = client.resizeCodexSession()
      if (!conversation.sessionId || !resizeCodexSession) return
      if (!fitOptions.force && conversation.terminal.cols === conversation.lastFitCols && conversation.terminal.rows === conversation.lastFitRows) return
      conversation.lastFitCols = conversation.terminal.cols
      conversation.lastFitRows = conversation.terminal.rows
      void resizeCodexSession(conversation.sessionId, conversation.terminal.cols, conversation.terminal.rows)
      logDebug('renderer.codex.fit-resize', {
        sessionId: conversation.sessionId,
        cols: conversation.terminal.cols,
        rows: conversation.terminal.rows
      })
    })
  }

  const focusActiveTerminal = () => {
    options.activeConversation()?.terminal?.focus()
  }

  const copySelection = async (source: 'contextmenu' | 'keyboard') => {
    const selectedText = options.activeConversation()?.terminal?.getSelection() || ''
    if (!selectedText) {
      options.notify(options.labels.copyEmpty())
      logDebug('renderer.codex.copy.empty', { source })
      return false
    }
    const copied = await copyText(selectedText)
    options.notify(copied ? options.labels.copySuccess() : options.labels.copyFailure())
    if (copied) {
      logDebug('renderer.codex.copy', {
        source,
        bytes: new TextEncoder().encode(selectedText).length
      })
    } else {
      log('warn', 'renderer.codex.copy.failed', {
        source,
        bytes: new TextEncoder().encode(selectedText).length
      })
    }
    return copied
  }

  const copySelectionFromContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    focusActiveTerminal()
    void copySelection('contextmenu')
  }

  const disposeSubscriptions = () => {
    offData?.()
    offLifecycle?.()
    offExit?.()
    offThread?.()
    offData = null
    offLifecycle = null
    offExit = null
    offThread = null
  }

  const subscribeBridge = () => {
    if (offData || offLifecycle || offExit || offThread) return
    const onCodexSessionData = client.onCodexSessionData()
    const onCodexSessionLifecycle = client.onCodexSessionLifecycle()
    const onCodexSessionExit = client.onCodexSessionExit()
    const onCodexSessionThread = client.onCodexSessionThread()
    if (!onCodexSessionData && !onCodexSessionLifecycle && !onCodexSessionExit && !onCodexSessionThread) return
    offData = onCodexSessionData?.((event) => {
      const conversation = conversationForSessionId(event.id) || claimPendingSessionConversation(event.id)
      if (conversation) writeCodexDisplayOutput(conversation, event.data)
    }) || null
    offLifecycle = onCodexSessionLifecycle?.((event) => {
      const conversation = conversationForSessionId(event.id) || claimPendingSessionConversation(event.id)
      if (!conversation) return
      const localizedEvent = event.errorCode === 'CODEX_CLI_EXIT_NONZERO'
        ? { ...event, errorMessage: options.labels.exitNonZero() }
        : event
      applyCodexLifecycleEvent(conversation, localizedEvent, options.labels.error())
      if (event.stage === 'ready') {
        options.syncAttentionState(conversation)
        syncThreadedConversationSurface(conversation, { forceGeometry: true })
        fitTerminal({ force: true, conversation })
      }
      if (event.stage === 'error') options.syncAttentionState(conversation)
      if (event.stage === 'closed') options.syncAttentionState(conversation)
      if (event.stage === 'error' || event.stage === 'closed') removePendingStartConversation(conversation)
    }) || null
    offExit = onCodexSessionExit?.((event) => {
      const conversation = conversationForSessionId(event.id) || claimPendingSessionConversation(event.id)
      if (!conversation) return
      const localizedEvent = event.errorCode === 'CODEX_CLI_EXIT_NONZERO'
        ? { ...event, errorMessage: options.labels.exitNonZero() }
        : event
      applyCodexExitEvent(conversation, localizedEvent)
      if (conversation.sessionId === event.id) {
        conversation.sessionId = ''
        syncThreadedConversationSurface(conversation, { forceGeometry: true })
      }
      options.syncAttentionState(conversation)
      removePendingStartConversation(conversation)
    }) || null
    offThread = onCodexSessionThread?.((event) => {
      const conversation = conversationForSessionId(event.id) || claimPendingSessionConversation(event.id)
      if (!conversation) return
      conversation.nativeThreadId = event.threadId
      conversation.launchMode = 'resume'
      if (event.title?.trim()) conversation.title = event.title.trim()
      log('info', 'renderer.codex-thread.bound', {
        localId: conversation.id,
        sessionId: event.id,
        threadId: event.threadId,
        reason: event.reason,
        ...(event.title ? { title: event.title } : {})
      })
    }) || null
  }

  const syncTargetContext = async (syncOptions: { force?: boolean; conversation?: TConversation | null } = {}) => {
    const conversation = syncOptions.conversation || options.activeConversation()
    const setCodexSessionTarget = client.setCodexSessionTarget()
    if (!conversation || !setCodexSessionTarget) return
    const target = options.currentBoundTarget(conversation)
    const syncPlan = prepareCodexTargetSync(conversation, target, syncOptions.force)
    if (!syncPlan) return
    try {
      const result = await setCodexSessionTarget(conversation.sessionId, syncPlan.target)
      const fields = {
        sessionId: conversation.sessionId,
        targetSessionId: syncPlan.target.sessionId,
        targetKind: syncPlan.target.kind,
        targetLabel: syncPlan.target.label,
        registered: Boolean(result?.data?.registered)
      }
      if (result?.data?.registered) logDebug('renderer.codex-target.updated', fields)
      else log('warn', 'renderer.codex-target.unavailable', fields)
    } catch (error) {
      markCodexTargetSyncFailed(conversation)
      log('warn', 'renderer.codex-target.update-failed', {
        sessionId: conversation.sessionId,
        targetSessionId: syncPlan.target.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const syncActiveBridgeTarget = async () => {
    const conversation = options.activeConversation()
    if (!conversation?.sessionId || !conversation.boundTarget || !client.setCodexSessionTarget()) return
    await syncTargetContext({ force: true, conversation })
  }

  const setPendingTargetContext = async (
    conversation: TConversation,
    kind: CodexTargetEventKind,
    target?: CodexSessionTargetContext | null
  ) => {
    const setCodexSessionPendingContext = client.setCodexSessionPendingContext()
    if (!conversation.sessionId || !setCodexSessionPendingContext) return
    const pending = prepareCodexPendingTargetContext(conversation, kind, target)
    if (pending.clear) {
      await setCodexSessionPendingContext(conversation.sessionId, '')
      return
    }
    await setCodexSessionPendingContext(conversation.sessionId, pending.text)
  }

  const clearSessionTarget = async (conversation: TConversation, kind: CodexTargetEventKind = 'unbound') => {
    const setCodexSessionTarget = client.setCodexSessionTarget()
    if (!conversation.sessionId || !setCodexSessionTarget) return
    await setCodexSessionTarget(conversation.sessionId, undefined)
    await setPendingTargetContext(conversation, kind, null)
  }

  const markPendingTargetDelivered = (conversation: TConversation) => {
    markCodexRuntimePendingTargetDelivered(conversation)
  }

  const applyTerminalSettings = (
    conversation: TConversation,
    settings: AiPanelCodexTerminalSettings = options.terminalSettings(),
    applyOptions: { refit?: boolean } = {}
  ) => {
    const terminal = conversation.terminal
    if (!terminal) return
    setXtermTermName(terminal, settings.terminalType)
    terminal.options.fontFamily = settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
    terminal.options.fontSize = settings.fontSize || 12
    terminal.options.lineHeight = settings.lineHeight || 1
    terminal.options.cursorBlink = settings.cursorBlink
    terminal.options.cursorStyle = settings.cursorStyle
    terminal.options.scrollback = settings.scrollBack
    const theme = terminalTheme()
    terminal.options.theme = theme
    terminal.options.minimumContrastRatio = theme.minimumContrastRatio
    if (isThreadedTerminalHost(terminal)) {
      terminal.updateSettings(settings, theme)
    }
    if (applyOptions.refit !== false) fitTerminal({ force: true, conversation })
  }

  const ensureTerminal = (conversation: TConversation) => {
    const element = conversation.host
    if (!element) return false
    if (conversation.terminal) return true
    if (!shouldPrepareTerminal(conversation)) return false
    const settings = options.terminalSettings()
    const theme = terminalTheme()
    const useInjected = shouldUseInjectedTerminal()
    const unavailableReason = useInjected ? '' : threadedTerminalUnavailableReason()
    if (unavailableReason) {
      markThreadedTerminalUnavailable(conversation, unavailableReason)
      return false
    }
    terminalUnavailableReasonByConversation.delete(conversation)
    const terminal = markRaw((useInjected
      ? new options.terminalConstructor!({
          allowTransparency: true,
          cursorBlink: settings.cursorBlink,
          convertEol: true,
          cursorStyle: settings.cursorStyle,
          fontFamily: settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
          fontSize: settings.fontSize || 12,
          lineHeight: settings.lineHeight || 1,
          minimumContrastRatio: theme.minimumContrastRatio,
          scrollback: settings.scrollBack,
          theme
        })
      : createThreadedTerminalHost({
          terminalId: conversation.id,
          sessionId: conversation.sessionId,
          groupId: `codex:${conversation.id}`,
          surface: 'codex',
          settings,
          theme,
          visible: isConversationVisible(conversation),
          priority: isConversationVisible(conversation) ? 'active' : 'background',
          logFields: { localId: conversation.id }
        })) as AiPanelCodexTerminalLike)
    conversation.threadedTerminal = !useInjected
    const fit = markRaw(useInjected ? new options.fitConstructor!() : new ThreadedTerminalFitAddon())
    terminal.loadAddon(fit)
    terminal.open(element)
    conversation.terminal = terminal as TConversation['terminal']
    conversation.fit = fit as TConversation['fit']
    applyTerminalSettings(conversation, settings, { refit: false })
    terminal.attachCustomKeyEventHandler((event) => {
      if (!codexTerminalCopyShortcut(event)) return true
      event.preventDefault()
      event.stopPropagation()
      void copySelection('keyboard')
      return false
    })
    terminal.onData((data) => {
      const writeCodexSession = client.writeCodexSession()
      if (!conversation.sessionId || !writeCodexSession) return
      void syncTargetContext({ conversation }).finally(() => {
        markPendingTargetDelivered(conversation)
        void writeCodexSession(conversation.sessionId, data)
      })
    })
    terminal.onResize(() => undefined)
    const observer = resizeObserverFactory(() => fitTerminal({ conversation }))
    if (observer) {
      conversation.resizeObserver?.disconnect()
      conversation.resizeObserver = markRaw(observer)
      observer.observe(element)
    }
    fitTerminal({ force: true, conversation })
    logDebug('renderer.codex-terminal.created', { localId: conversation.id, threaded: !useInjected, injected: useInjected })
    return true
  }

  const setHostElement = (conversation: TConversation, element: HTMLElement | null) => {
    const previousHost = conversation.host
    conversation.host = element
    if (!conversation.host) {
      conversation.resizeObserver?.disconnect()
      conversation.resizeObserver = null
      return
    }
    if (conversation.terminal && isThreadedTerminalHost(conversation.terminal)) {
      if (conversation.terminal.hostElement() !== conversation.host) {
        conversation.terminal.open(conversation.host)
      }
      syncThreadedConversationSurface(conversation, { forceGeometry: previousHost !== conversation.host })
    } else {
      const created = ensureTerminal(conversation)
      if (conversation.terminal && isThreadedTerminalHost(conversation.terminal)) {
        syncThreadedConversationSurface(conversation, { forceGeometry: true })
      }
      if (!created) return
    }
    scheduleCodexOutputFlush(conversation)
  }

  const startSession = async (conversation: TConversation) => {
    cancelledStarts.delete(conversation)
    const target = options.currentBoundTarget(conversation)
    if (!target) {
      conversation.status = 'idle'
      conversation.error = ''
      return
    }
    if (conversation.startPromise) return conversation.startPromise
    conversation.startPromise = (async () => {
      await options.afterDomUpdate()
      if (!ensureTerminal(conversation)) return
      applyTerminalSettings(conversation, options.terminalSettings(), { refit: false })
      const createCodexSession = client.createCodexSession()
      if (!createCodexSession) {
        conversation.status = 'error'
        conversation.error = options.labels.bridgeMissing()
        options.syncAttentionState(conversation)
        return
      }
      if (conversation.sessionId && conversation.status === 'ready') {
        await syncTargetContext({ force: true, conversation })
        return
      }
      conversation.status = 'starting'
      conversation.error = ''
      rememberPendingStartConversation(conversation)
      subscribeBridge()
      fitTerminal({ force: true, conversation })
      const cols = conversation.terminal?.cols || 100
      const rows = conversation.terminal?.rows || 30
      try {
        const launch = conversation.nativeThreadId
          ? { mode: conversation.launchMode === 'fork' ? 'fork' as const : 'resume' as const, threadId: conversation.nativeThreadId }
          : { mode: 'new' as const }
        const session = await createCodexSession({
          cols,
          rows,
          target,
          productSessionId: conversation.id,
          projectRoot: conversation.projectRoot || target.cwd,
          launch
        })
        if (cancelledStarts.has(conversation)) {
          cancelledStarts.delete(conversation)
          const killCodexSession = client.killCodexSession()
          if (killCodexSession) await killCodexSession(session.id)
          removePendingStartConversation(conversation)
          conversation.status = 'closed'
          return
        }
        const recoveredFromThreadId = String(session.recoveredFromThreadId || '').trim()
        if (recoveredFromThreadId && recoveredFromThreadId === conversation.nativeThreadId) {
          conversation.nativeThreadId = undefined
          conversation.launchMode = 'new'
          options.notify(options.labels.unsavedSessionRecovered())
          log('info', 'renderer.codex-session.unsaved-recovered', {
            localId: conversation.id,
            sessionId: session.id,
            recoveredFromThreadId
          })
        }
        pendingConversationBySessionId.set(session.id, conversation)
        applyCodexSessionStarted(conversation, session, target)
        syncThreadedConversationSurface(conversation, { forceGeometry: true })
        removePendingStartConversation(conversation)
        await syncTargetContext({ force: true, conversation })
        fitTerminal({ force: true, conversation })
        scheduleCodexOutputFlush(conversation)
        focusActiveTerminal()
        log('info', 'renderer.codex-session.started', {
          sessionId: session.id,
          runtimeKind: session.runtimeKind,
          binaryPath: session.binaryPath,
          codexHome: session.codexHome,
          cwd: session.cwd,
          target
        })
      } catch (error) {
        removePendingStartConversation(conversation)
        conversation.status = 'error'
        conversation.error = error instanceof Error && error.message.trim() ? error.message : options.labels.startFailed()
        options.syncAttentionState(conversation)
        log('error', 'renderer.codex-session.start-failed', { message: conversation.error })
      }
    })().finally(() => {
      conversation.startPromise = null
    })
    return conversation.startPromise
  }

  const stopSession = async (conversation: TConversation | null = options.activeConversation()) => {
    const sessionId = conversation?.sessionId
    const killCodexSession = client.killCodexSession()
    if (!sessionId) {
      if (conversation?.startPromise) cancelledStarts.add(conversation)
      return { ok: true, data: { id: '' } } satisfies CodexSessionKillResult
    }
    if (!killCodexSession) {
      const result = {
        ok: false,
        errorCode: 'CODEX_SESSION_BRIDGE_MISSING',
        errorMessage: options.labels.bridgeMissing()
      } satisfies CodexSessionKillResult
      log('warn', 'renderer.codex-session.kill-failed', {
        sessionId,
        errorCode: result.errorCode,
        message: result.errorMessage
      })
      return result
    }
    try {
      const result = await killCodexSession(sessionId)
      if (
        !result.ok &&
        result.errorCode === 'CODEX_SESSION_NOT_FOUND' &&
        (conversation?.status === 'closed' || conversation?.status === 'error')
      ) {
        log('info', 'renderer.codex-session.kill-already-stopped', {
          sessionId,
          status: conversation.status
        })
        return { ok: true, data: { id: sessionId } } satisfies CodexSessionKillResult
      }
      if (result.ok && result.data?.id !== sessionId) {
        log('warn', 'renderer.codex-session.kill-failed', {
          sessionId,
          errorCode: 'CODEX_SESSION_KILL_RESULT_INVALID',
          returnedSessionId: result.data?.id,
          message: 'Codex kill returned an invalid result.'
        })
        return {
          ok: false,
          errorCode: 'CODEX_SESSION_KILL_RESULT_INVALID'
        } satisfies CodexSessionKillResult
      }
      if (!result.ok) {
        log('warn', 'renderer.codex-session.kill-failed', {
          sessionId,
          errorCode: result.errorCode,
          message: result.errorMessage
        })
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('warn', 'renderer.codex-session.kill-failed', {
        sessionId,
        errorCode: 'CODEX_SESSION_KILL_FAILED',
        message
      })
      return {
        ok: false,
        errorCode: 'CODEX_SESSION_KILL_FAILED',
        errorMessage: message
      } satisfies CodexSessionKillResult
    }
  }

  const disposeConversation = (conversation: TConversation) => {
    terminalUnavailableReasonByConversation.delete(conversation)
    conversation.resizeObserver?.disconnect()
    conversation.resizeObserver = null
    clearCodexDisplayOutput(conversation, { dispose: true })
    conversation.terminal?.dispose()
    conversation.terminal = null
    conversation.threadedTerminal = false
    conversation.fit = null
  }

  const syncConversationOutput = (conversation: TConversation | null = options.activeConversation()) => {
    if (!conversation) return
    scheduleCodexOutputFlush(conversation)
  }

  const syncConversationSurfaces = (syncOptions: { forceActiveGeometry?: boolean } = {}) => {
    options.conversations().forEach((conversation) => {
      syncThreadedConversationSurface(conversation, {
        forceGeometry: Boolean(syncOptions.forceActiveGeometry && isConversationVisible(conversation))
      })
    })
  }

  const clearConversationOutput = (conversation: TConversation | null = options.activeConversation()) => {
    if (!conversation) return
    clearCodexDisplayOutput(conversation)
  }

  return {
    applyTerminalSettings,
    clearSessionTarget,
    copySelection,
    copySelectionFromContextMenu,
    clearConversationOutput,
    disposeConversation,
    disposeSubscriptions,
    ensureTerminal,
    fitTerminal,
    focusActiveTerminal,
    markPendingTargetDelivered,
    setHostElement,
    setPendingTargetContext,
    startSession,
    stopSession,
    subscribeBridge,
    syncConversationSurfaces,
    syncConversationOutput,
    syncActiveBridgeTarget,
    syncTargetContext
  }
}
