import { nextTick, reactive, type ComponentPublicInstance, type ComputedRef, type Ref } from 'vue'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { mirrorTextToClipboardQuietly } from '@/services/app/clipboardRuntime'
import { writeRendererRuntimeLog as writeRuntimeLog } from '@/services/app/runtimeLogClient'
import { terminalClient } from '@/services/terminal/terminalClient'
import type { TerminalPanel, TerminalSettings, useWorkspaceStore } from '@/stores/workspace'
import type { TerminalCommandSuggestion } from '@shared/contracts/terminalTools'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>
type XtermRuntimeOptions = XtermTerminal['options'] & { termName?: string }
type TerminalSuggestion = TerminalCommandSuggestion

export type TerminalView = {
  terminal: XtermTerminal
  fit: FitAddon
  search: SearchAddon
  lastOutput: string
  suppressInputReplyDepth?: number
  lastFitCols?: number
  lastFitRows?: number
  resizeObserver?: ResizeObserver
}

type TerminalWorkspaceViewRuntimeInput = {
  workspace: WorkspaceStore
  visibleTerminalPanels: ComputedRef<TerminalPanel[]>
  aiButtonPanelId: Ref<string>
  aiButtonPosition: { top: number; right: number }
  suggestionPanel: { panelId: string }
  suggestionPosition: { left: number; top: number }
  suggestionItems: Ref<TerminalSuggestion[]>
  aiSuggestLoading: Ref<boolean>
  writeXtermInput: (panelId: string, data: string) => void | Promise<void>
}

const terminalContentPaddingTop = 10
const terminalContentPaddingBottom = 16
const terminalAiButtonHeight = 32
const terminalFloatingGap = 8
const terminalBottomSafePx = 16

export const createTerminalWorkspaceViewRuntime = ({
  workspace,
  visibleTerminalPanels,
  aiButtonPanelId,
  aiButtonPosition,
  suggestionPanel,
  suggestionPosition,
  suggestionItems,
  aiSuggestLoading,
  writeXtermInput
}: TerminalWorkspaceViewRuntimeInput) => {
  const paneFontSizes = reactive<Record<string, number>>({})
  const terminalElements = new Map<string, HTMLElement>()
  const terminalViews = new Map<string, TerminalView>()

  const setXtermTermName = (terminal: XtermTerminal, terminalType: string) => {
    ;(terminal.options as XtermRuntimeOptions).termName = terminalType || 'xterm-256color'
  }

  const defaultTerminalFontSize = () => workspace.terminalSettings.fontSize || 12
  const terminalFontSizeForPanel = (panelId: string) => paneFontSizes[panelId] || defaultTerminalFontSize()
  const terminalSettingsSignature = () => {
    const settings = workspace.terminalSettings
    return [
      settings.terminalType,
      settings.fontFamily,
      settings.fontSize,
      settings.lineHeight,
      settings.cursorBlink,
      settings.cursorStyle,
      settings.scrollBack
    ].join('|')
  }

  const activeView = () => terminalViews.get(workspace.activePanelId)

  const writeTerminalDisplayOutput = (view: TerminalView, data: string, options: { suppressInputReplies?: boolean } = {}) => {
    if (!data) return
    if (!options.suppressInputReplies) {
      view.terminal.write(data)
      return
    }
    view.suppressInputReplyDepth = (view.suppressInputReplyDepth || 0) + 1
    const restoreInputReplies = () => {
      view.suppressInputReplyDepth = Math.max(0, (view.suppressInputReplyDepth || 1) - 1)
    }
    if (view.terminal.write.length >= 2) {
      view.terminal.write(data, restoreInputReplies)
    } else {
      view.terminal.write(data)
      restoreInputReplies()
    }
  }

  const notifyBackendResize = (panelId: string, view: TerminalView) => {
    const panel = workspace.panels.find((item) => item.id === panelId)
    const resizeTerminal = terminalClient.resizeTerminal()
    if (!panel?.sessionId || !resizeTerminal) return
    if (view.lastFitCols === view.terminal.cols && view.lastFitRows === view.terminal.rows) return
    view.lastFitCols = view.terminal.cols
    view.lastFitRows = view.terminal.rows
    resizeTerminal(panel.sessionId, view.terminal.cols, view.terminal.rows)
    writeRuntimeLog('debug', 'renderer.terminal.fit-resize', {
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

  const estimateTerminalCellSize = (view: { terminal: XtermTerminal }, panelId: string) => {
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

  const getSelectionVisibleRow = (view: { terminal: XtermTerminal }, panelId: string) => {
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
        if (options.forceGeometry) resetTerminalHostGeometry(element)
        view.fit.fit()
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
      .filter((panel) => panel.kind !== 'knowledge')
      .forEach((panel) => scheduleTerminalFit(panel.id, options))
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
    if (options.refit !== false) {
      scheduleTerminalFit(panelId, { scrollToBottom: true, frames: 3, forceGeometry: true })
    }
  }

  const applyTerminalSettingsToAll = () => {
    terminalViews.forEach((view, panelId) => applyTerminalSettingsToView(panelId, view))
  }

  const syncTerminalView = (panel: TerminalPanel, options: { suppressInputReplies?: boolean } = {}) => {
    if (panel.kind === 'knowledge') return
    const view = terminalViews.get(panel.id)
    if (!view) return
    const displayOutput = workspace.getHighlightedTerminalOutput(panel.id)
    if (displayOutput !== view.lastOutput) {
      if (displayOutput.startsWith(view.lastOutput)) {
        const chunk = displayOutput.slice(view.lastOutput.length)
        writeTerminalDisplayOutput(view, chunk, { suppressInputReplies: options.suppressInputReplies })
      } else {
        view.terminal.clear()
        writeTerminalDisplayOutput(view, displayOutput, { suppressInputReplies: true })
      }
      view.lastOutput = displayOutput
    }
    scheduleTerminalFit(panel.id, { scrollToBottom: true })
    updateSelectionButtonPosition(panel.id)
    updateSuggestionsPosition(panel.id)
  }

  const createTerminalView = (panel: TerminalPanel, element: HTMLElement) => {
    if (panel.kind === 'knowledge') return
    if (terminalViews.has(panel.id)) return
    const terminal = new XtermTerminal({
      cursorBlink: workspace.terminalSettings.cursorBlink,
      convertEol: true,
      cursorStyle: workspace.terminalSettings.cursorStyle,
      fontFamily: workspace.terminalSettings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: terminalFontSizeForPanel(panel.id),
      lineHeight: workspace.terminalSettings.lineHeight || 1,
      scrollback: workspace.terminalSettings.scrollBack,
      theme: {
        background: '#090b10',
        foreground: '#d7dae3',
        cursor: '#8ccf7e',
        selectionBackground: '#2d4059'
      }
    })
    const fit = new FitAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(searchAddon)
    terminal.open(element)
    const view: TerminalView = { terminal, fit, search: searchAddon, lastOutput: '' }
    applyTerminalSettingsToView(panel.id, view, workspace.terminalSettings, { refit: false })
    if (typeof ResizeObserver !== 'undefined') {
      view.resizeObserver = new ResizeObserver(() => {
        scheduleTerminalFit(panel.id, { frames: 2 })
      })
      view.resizeObserver.observe(element)
    }
    terminalViews.set(panel.id, view)
    writeRuntimeLog('debug', 'renderer.terminal-view.created', {
      panelId: panel.id,
      hasSession: Boolean(panel.sessionId)
    })
    syncTerminalView(panel, { suppressInputReplies: Boolean(panel.output) })
    terminal.onData((data) => {
      if (view.suppressInputReplyDepth) {
        writeRuntimeLog('debug', 'renderer.terminal-input.suppressed-replay-reply', {
          panelId: panel.id,
          bytes: new TextEncoder().encode(data).length
        })
        return
      }
      void writeXtermInput(panel.id, data)
    })
    terminal.onSelectionChange(() => {
      const selectedText = terminal.getSelection()
      if (selectedText.trim()) void mirrorTextToClipboardQuietly(selectedText.trim())
      updateSelectionButtonPosition(panel.id)
    })
    terminal.onResize(({ cols, rows }) => {
      const resizeTerminal = terminalClient.resizeTerminal()
      if (panel.sessionId && resizeTerminal) {
        resizeTerminal(panel.sessionId, cols, rows)
        writeRuntimeLog('debug', 'renderer.terminal.resize', {
          panelId: panel.id,
          sessionId: panel.sessionId,
          cols,
          rows
        })
      }
      updateSelectionButtonPosition(panel.id)
      updateSuggestionsPosition(panel.id)
    })
    element.querySelector('.xterm-viewport')?.addEventListener(
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
        view.resizeObserver?.disconnect()
        view.terminal.dispose()
        terminalViews.delete(panelId)
      }
      return
    }
    terminalElements.set(panelId, element)
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (panel && panel.kind !== 'knowledge') {
      createTerminalView(panel, element)
    }
  }

  const syncPanelViews = () => {
    nextTick(() => {
      workspace.panels.filter((panel) => panel.kind !== 'knowledge').forEach((panel) => {
        const element = terminalElements.get(panel.id)
        if (element) createTerminalView(panel, element)
      })
      for (const panelId of terminalViews.keys()) {
        if (!workspace.panels.some((panel) => panel.id === panelId)) {
          terminalViews.get(panelId)?.terminal.dispose()
          terminalViews.get(panelId)?.resizeObserver?.disconnect()
          terminalViews.delete(panelId)
          terminalElements.delete(panelId)
          delete paneFontSizes[panelId]
        }
      }
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
    scheduleTerminalFit(panelId, { scrollToBottom: true, frames: 4, forceGeometry: true })
  }

  const focusPanel = (panelId: string) => {
    nextTick(() => terminalViews.get(panelId)?.terminal.focus())
  }

  const getTerminalElement = (panelId: string) => terminalElements.get(panelId) || null

  const focusActivePanel = () => {
    focusPanel(workspace.activePanelId)
  }

  const dispose = () => {
    terminalViews.forEach((view) => {
      view.resizeObserver?.disconnect()
      view.terminal.dispose()
    })
    terminalViews.clear()
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
  }
}
