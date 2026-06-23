import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
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
import type { CodexTargetEventKind } from '@/services/ai/codexTargetRuntime'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

type XtermRuntimeOptions = XtermTerminal['options'] & { termName?: string }

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
  write: (data: string) => void
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
  host: HTMLElement | null
  terminal: TTerminal | null
  fit: TFit | null
  resizeObserver: AiPanelCodexResizeObserverLike | null
}

export type AiPanelCodexSessionClient = typeof codexSessionClient

export type AiPanelCodexTerminalRuntimeLabels = {
  error: () => string
  bridgeMissing: () => string
  startFailed: () => string
  copyEmpty: () => string
  copySuccess: () => string
  copyFailure: () => string
}

export type AiPanelCodexTerminalRuntimeOptions<TConversation extends AiPanelCodexTerminalConversation> = {
  conversations: () => TConversation[]
  activeConversation: () => TConversation | null
  activeConversationId: () => string
  terminalSettings: () => AiPanelCodexTerminalSettings
  currentBoundTarget: (conversation: TConversation) => CodexSessionTargetContext | null
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

export const codexTerminalCopyShortcut = (event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>) => {
  const key = event.key.toLowerCase()
  if (key !== 'c') return false
  if (event.shiftKey && (event.ctrlKey || event.metaKey)) return true
  return event.metaKey && !event.ctrlKey && !event.altKey
}

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

export const createAiPanelCodexTerminalRuntime = <TConversation extends AiPanelCodexTerminalConversation>(
  options: AiPanelCodexTerminalRuntimeOptions<TConversation>
) => {
  const client = options.client || codexSessionClient
  const log = options.log || writeRendererRuntimeLog
  const copyText = options.copyText || copyTextToClipboard
  const requestFrame = options.requestFrame || defaultRequestFrame
  const TerminalConstructor = options.terminalConstructor || XtermTerminal
  const FitConstructor = options.fitConstructor || FitAddon
  const resizeObserverFactory = options.resizeObserverFactory || defaultResizeObserverFactory

  let offData: (() => void) | null = null
  let offLifecycle: (() => void) | null = null
  let offExit: (() => void) | null = null

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
      log('debug', 'renderer.codex.fit-resize', {
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
      log('debug', 'renderer.codex.copy.empty', { source })
      return false
    }
    const copied = await copyText(selectedText)
    options.notify(copied ? options.labels.copySuccess() : options.labels.copyFailure())
    log(copied ? 'debug' : 'warn', copied ? 'renderer.codex.copy' : 'renderer.codex.copy.failed', {
      source,
      bytes: new TextEncoder().encode(selectedText).length
    })
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
    offData = null
    offLifecycle = null
    offExit = null
  }

  const subscribeBridge = () => {
    if (offData || offLifecycle || offExit) return
    const onCodexSessionData = client.onCodexSessionData()
    const onCodexSessionLifecycle = client.onCodexSessionLifecycle()
    const onCodexSessionExit = client.onCodexSessionExit()
    if (!onCodexSessionData && !onCodexSessionLifecycle && !onCodexSessionExit) return
    offData = onCodexSessionData?.((event) => {
      const conversation = options.conversations().find((item) => item.sessionId === event.id)
      conversation?.terminal?.write(event.data)
    }) || null
    offLifecycle = onCodexSessionLifecycle?.((event) => {
      const conversation = options.conversations().find((item) => item.sessionId === event.id)
      if (!conversation) return
      applyCodexLifecycleEvent(conversation, event, options.labels.error())
      if (event.stage === 'ready') {
        options.syncAttentionState(conversation)
        fitTerminal({ force: true, conversation })
      }
      if (event.stage === 'error') options.syncAttentionState(conversation)
      if (event.stage === 'closed') options.syncAttentionState(conversation)
    }) || null
    offExit = onCodexSessionExit?.((event) => {
      const conversation = options.conversations().find((item) => item.sessionId === event.id)
      if (!conversation) return
      applyCodexExitEvent(conversation, event)
      options.syncAttentionState(conversation)
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
      const result = await setCodexSessionTarget(syncPlan.target)
      log(result?.data?.registered ? 'debug' : 'warn', result?.data?.registered ? 'renderer.codex-target.updated' : 'renderer.codex-target.unavailable', {
        sessionId: conversation.sessionId,
        targetSessionId: syncPlan.target.sessionId,
        targetKind: syncPlan.target.kind,
        targetLabel: syncPlan.target.label,
        registered: Boolean(result?.data?.registered)
      })
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
    await setCodexSessionTarget(undefined)
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
    if (applyOptions.refit !== false) fitTerminal({ force: true, conversation })
  }

  const ensureTerminal = (conversation: TConversation) => {
    const element = conversation.host
    if (!element || conversation.terminal) return
    const settings = options.terminalSettings()
    const terminal = new TerminalConstructor({
      allowTransparency: true,
      cursorBlink: settings.cursorBlink,
      convertEol: true,
      cursorStyle: settings.cursorStyle,
      fontFamily: settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: settings.fontSize || 12,
      lineHeight: settings.lineHeight || 1,
      scrollback: settings.scrollBack,
      theme: {
        background: 'rgba(9, 11, 16, 0)',
        foreground: '#d7dae3',
        cursor: '#8ccf7e',
        selectionBackground: '#2d4059'
      }
    }) as AiPanelCodexTerminalLike
    const fit = new FitConstructor()
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
      void syncTargetContext({ force: true, conversation }).finally(() => {
        markPendingTargetDelivered(conversation)
        void writeCodexSession(conversation.sessionId, data)
      })
    })
    terminal.onResize(({ cols, rows }) => {
      const resizeCodexSession = client.resizeCodexSession()
      if (!conversation.sessionId || !resizeCodexSession) return
      conversation.lastFitCols = cols
      conversation.lastFitRows = rows
      void resizeCodexSession(conversation.sessionId, cols, rows)
    })
    const observer = resizeObserverFactory(() => fitTerminal({ conversation }))
    if (observer) {
      conversation.resizeObserver?.disconnect()
      conversation.resizeObserver = observer
      observer.observe(element)
    }
    fitTerminal({ force: true, conversation })
    log('debug', 'renderer.codex-terminal.created', { localId: conversation.id })
  }

  const setHostElement = (conversation: TConversation, element: HTMLElement | null) => {
    conversation.host = element
    if (!conversation.host) {
      conversation.resizeObserver?.disconnect()
      conversation.resizeObserver = null
      return
    }
    ensureTerminal(conversation)
  }

  const startSession = async (conversation: TConversation) => {
    const target = options.currentBoundTarget(conversation)
    if (!target) {
      conversation.status = 'idle'
      conversation.error = ''
      return
    }
    if (conversation.startPromise) return conversation.startPromise
    conversation.startPromise = (async () => {
      await options.afterDomUpdate()
      ensureTerminal(conversation)
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
      fitTerminal({ force: true, conversation })
      const cols = conversation.terminal?.cols || 100
      const rows = conversation.terminal?.rows || 30
      try {
        const session = await createCodexSession({ cols, rows, target })
        applyCodexSessionStarted(conversation, session, target)
        subscribeBridge()
        await syncTargetContext({ force: true, conversation })
        fitTerminal({ force: true, conversation })
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
    if (!sessionId || !killCodexSession) return
    try {
      await killCodexSession(sessionId)
    } catch (error) {
      log('warn', 'renderer.codex-session.kill-failed', {
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const disposeConversation = (conversation: TConversation) => {
    conversation.resizeObserver?.disconnect()
    conversation.resizeObserver = null
    conversation.terminal?.dispose()
    conversation.terminal = null
    conversation.fit = null
  }

  return {
    applyTerminalSettings,
    clearSessionTarget,
    copySelection,
    copySelectionFromContextMenu,
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
    syncActiveBridgeTarget,
    syncTargetContext
  }
}
