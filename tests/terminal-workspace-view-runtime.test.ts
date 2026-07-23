import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalWorkspaceViewRuntime } from '@/services/terminal/terminalWorkspaceViewRuntime'
import {
  createEmptyTerminalPanel,
  setTerminalPanelAutoTitleInCollection,
  setTerminalPanelProgressInCollection,
  type TerminalPanel
} from '@/services/terminal/terminalPanelRuntime'
import type { TerminalProgress } from '@/services/terminal/terminalOscRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = []

const terminalClientMocks = vi.hoisted(() => ({
  resizeTerminal: vi.fn(async () => undefined)
}))

const threadedTerminalMocks = vi.hoisted(() => {
  class FakeThreadedTerminal {
    static instances: FakeThreadedTerminal[] = []
    cols = 120
    rows = 40
    buffer = { active: { viewportY: 0, cursorX: 0, cursorY: 0 } }
    options: Record<string, unknown> = {}
    output = ''
    surfaceAttached = false
    titleHandler: ((title: string) => void) | null = null
    progressHandler: ((progress: TerminalProgress | null) => void) | null = null
    loadAddon = vi.fn()
    open = vi.fn(() => {
      this.surfaceAttached = true
    })
    focus = vi.fn()
    clear = vi.fn()
    dispose = vi.fn()
    detachSurface = vi.fn(() => {
      this.surfaceAttached = false
    })
    startCoreOnly = vi.fn()
    setVisibility = vi.fn()
    setSessionId = vi.fn()
    ensureSurfaceAttached = vi.fn(() => {
      this.surfaceAttached = true
      return true
    })
    updateSettings = vi.fn()
    clearSelection = vi.fn()
    scrollToBottom = vi.fn()
    refresh = vi.fn()
    write = vi.fn((data: string, callback?: () => void) => {
      this.output += data
      callback?.()
    })
    writeBackendData = vi.fn((sessionId: string, data: string) => {
      if (!sessionId || !data) return false
      this.output += data
      return true
    })
    constructor() {
      FakeThreadedTerminal.instances.push(this)
    }
    debugInfo() {
      return { surfaceAttached: this.surfaceAttached }
    }
    hasSelection() {
      return false
    }
    getSelection() {
      return ''
    }
    getSelectionPosition() {
      return null
    }
    onData() {
      return { dispose: vi.fn() }
    }
    onResize() {
      return { dispose: vi.fn() }
    }
    onSelectionChange() {
      return { dispose: vi.fn() }
    }
    onTitleChange(handler: (title: string) => void) {
      this.titleHandler = handler
      return { dispose: vi.fn() }
    }
    onProgressChange(handler: (progress: TerminalProgress | null) => void) {
      this.progressHandler = handler
      return { dispose: vi.fn() }
    }
  }

  class FakeThreadedFitAddon {
    fit = vi.fn()
    activate = vi.fn()
    dispose = vi.fn()
  }

  class FakeThreadedSearchAddon {
    findNext = vi.fn(() => false)
    findPrevious = vi.fn(() => false)
    clearDecorations = vi.fn()
    activate = vi.fn()
    dispose = vi.fn()
  }

  return {
    threadedEnabled: false,
    FakeThreadedTerminal,
    FakeThreadedFitAddon,
    FakeThreadedSearchAddon
  }
})

vi.mock('@/services/app/runtimeLogClient', () => ({
  writeRendererRuntimeLog: (level: string, event: string, fields?: Record<string, unknown>) => {
    logs.push({ level, event, fields })
  }
}))

vi.mock('@/services/terminal/terminalClient', () => ({
  terminalClient: {
    resizeTerminal: () => terminalClientMocks.resizeTerminal
  }
}))

vi.mock('@shared/runtimeSwitches', () => ({
  shouldUseTerminalDebugLogs: () => false,
  shouldUseThreadedTerminal: () => threadedTerminalMocks.threadedEnabled
}))

vi.mock('@/services/terminal/threadedTerminalRuntime', () => ({
  setThreadedTerminalDataConsumedSink: vi.fn(),
  ThreadedTerminalFitAddon: threadedTerminalMocks.FakeThreadedFitAddon,
  ThreadedTerminalSearchAddon: threadedTerminalMocks.FakeThreadedSearchAddon,
  createThreadedTerminalHost: () => new threadedTerminalMocks.FakeThreadedTerminal(),
  hasTerminalDropFilePayload: (dataTransfer: DataTransfer | null | undefined) => Boolean(dataTransfer?.files?.length),
  isThreadedTerminalHost: (value: unknown) => value instanceof threadedTerminalMocks.FakeThreadedTerminal,
  terminalDropInputText: (dataTransfer: DataTransfer | null | undefined) =>
    Array.from(dataTransfer?.files || [])
      .map((file) => String((file as File & { path?: string }).path || '').trim())
      .filter(Boolean)
      .map((path) => (path.includes(' ') ? `'${path}'` : path))
      .join(' '),
  threadedTerminalCapability: () => ({ supported: true }),
  threadedTerminalPriorityFor: (terminalId: string, activeTerminalId: string, visible: boolean) =>
    terminalId === activeTerminalId ? 'active' : visible ? 'visible' : 'background'
}))

class FakeFit {
  fit = vi.fn()
  activate = vi.fn()
  dispose = vi.fn()
}

class FakeSearch {
  findNext = vi.fn(() => false)
  findPrevious = vi.fn(() => false)
  clearDecorations = vi.fn()
  activate = vi.fn()
  dispose = vi.fn()
}

class FakeTerminal {
  static instances: FakeTerminal[] = []
  cols = 120
  rows = 40
  buffer = { active: { viewportY: 0, cursorX: 0, cursorY: 0 } }
  options: Record<string, unknown> = {}
  loadAddon = vi.fn()
  open = vi.fn()
  focus = vi.fn()
  clear = vi.fn()
  dispose = vi.fn()
  clearSelection = vi.fn()
  scrollToBottom = vi.fn()
  refresh = vi.fn()
  input = vi.fn()
  write = vi.fn((data: string, callback?: () => void) => {
    this.output += data
    callback?.()
  })
  output = ''
  dataHandler: ((data: string) => void) | null = null
  resizeHandler: ((size: { cols: number; rows: number }) => void) | null = null
  selectionHandler: (() => void) | null = null
  titleHandler: ((title: string) => void) | null = null
  oscHandlers = new Map<number, (data: string) => boolean | Promise<boolean>>()
  parser = {
    registerOscHandler: (ident: number, handler: (data: string) => boolean | Promise<boolean>) => {
      this.oscHandlers.set(ident, handler)
      return { dispose: vi.fn() }
    }
  }
  constructor(options: Record<string, unknown> = {}) {
    this.options = { ...options }
    FakeTerminal.instances.push(this)
  }
  hasSelection() {
    return false
  }
  getSelection() {
    return ''
  }
  getSelectionPosition() {
    return null
  }
  onData(handler: (data: string) => void) {
    this.dataHandler = handler
    return { dispose: vi.fn() }
  }
  onResize(handler: (size: { cols: number; rows: number }) => void) {
    this.resizeHandler = handler
    return { dispose: vi.fn() }
  }
  onSelectionChange(handler: () => void) {
    this.selectionHandler = handler
    return { dispose: vi.fn() }
  }
  onTitleChange(handler: (title: string) => void) {
    this.titleHandler = handler
    return { dispose: vi.fn() }
  }
}

const flushFrames = async (count = 1) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    await Promise.resolve()
  }
}

const flushOutput = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await Promise.resolve()
}

const droppedFileEvent = (type: 'dragover' | 'drop', path: string) => {
  const file = new File([''], path.split('/').pop() || 'dropped.txt')
  Object.defineProperty(file, 'path', { configurable: true, value: path })
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const dataTransfer = {
    files: [file],
    types: ['Files'],
    dropEffect: 'none',
    getData: vi.fn(() => '')
  }
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer })
  return { event, dataTransfer }
}

const createWorkspace = (panel: TerminalPanel) =>
  ({
    activePanelId: panel.id,
    panels: [panel],
    terminalSettings: {
      terminalType: 'xterm-256color',
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollBack: 2000
    },
    config: {
      theme: 'light',
      background: {
        mode: 'none'
      }
    },
    extensionSettings: { highlightStatus: false },
    keywordHighlightSettings: {},
    getHighlightedTerminalOutput: (panelId: string) => (panelId === panel.id ? panel.output : ''),
    setPanelAutoTitle: (panelId: string, title: string) => setTerminalPanelAutoTitleInCollection([panel], panelId, title),
    setPanelProgress: (panelId: string, progress: TerminalProgress | null) => setTerminalPanelProgressInCollection([panel], panelId, progress)
  }) as unknown as WorkspaceStore

const createRuntime = (
  panel = createEmptyTerminalPanel('panel-1', 'Local'),
  visiblePanels?: { value: TerminalPanel[] },
  options: { threaded?: boolean; terminalWorkspaceVisible?: { value: boolean }; suppressTerminalFocus?: { value: boolean } } = {}
) => {
  const workspace = createWorkspace(panel)
  const input: Parameters<typeof createTerminalWorkspaceViewRuntime>[0] = {
    workspace,
    visibleTerminalPanels: computed(() => visiblePanels?.value || workspace.panels),
    terminalWorkspaceVisible: computed(() => options.terminalWorkspaceVisible?.value ?? true),
    aiButtonPanelId: ref(''),
    aiButtonPosition: { top: 0, right: 0 },
    suggestionPanel: { panelId: '' },
    suggestionPosition: { left: 0, top: 0 },
    suggestionItems: ref([]),
    aiSuggestLoading: ref(false),
    writeXtermInput: vi.fn(),
    shouldSuppressTerminalFocus: (panelId) => panelId === panel.id && Boolean(options.suppressTerminalFocus?.value)
  }
  if (!options.threaded) {
    input.terminalConstructor = FakeTerminal as any
    input.fitConstructor = FakeFit as any
    input.searchConstructor = FakeSearch as any
  }
  const runtime = createTerminalWorkspaceViewRuntime(input)
  return { runtime, workspace, panel }
}

afterEach(() => {
  document.body.replaceChildren()
  FakeTerminal.instances = []
  threadedTerminalMocks.threadedEnabled = false
  threadedTerminalMocks.FakeThreadedTerminal.instances = []
  terminalClientMocks.resizeTerminal.mockClear()
  logs.length = 0
  vi.restoreAllMocks()
})

describe('terminalWorkspaceViewRuntime', () => {
  it('focuses the active terminal when its view is created or appears after a pending focus request', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)

    runtime.focusPanel(panel.id)
    const host = document.createElement('div')
    document.body.appendChild(host)
    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)

    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    expect(terminal.focus).toHaveBeenCalled()
  })

  it('lets the theme own xterm transparency when app background mode changes', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime, workspace } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)
    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)

    const terminal = runtime.terminalViews.get(panel.id)?.terminal as unknown as FakeTerminal
    expect(terminal.options.allowTransparency).toBe(true)
    expect((terminal.options.theme as { background?: string }).background).toBe('#f5f7fb')

    ;(workspace.config as any).background.mode = 'custom'
    runtime.applyTerminalSettingsToAll()

    expect((terminal.options.theme as { background?: string }).background).toBe('rgba(245, 247, 251, 0.94)')
  })

  it('does not refocus an active terminal when its existing element ref runs again', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    const aiInput = document.createElement('textarea')
    aiInput.className = 'ai-codex-xterm'
    document.body.append(host, aiInput)
    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)
    const terminal = runtime.terminalViews.get(panel.id)?.terminal as unknown as FakeTerminal
    terminal.focus.mockClear()
    aiInput.focus()

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)
    expect(terminal.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(aiInput)

    runtime.focusPanel(panel.id)
    await flushFrames(2)
    expect(terminal.focus).toHaveBeenCalled()
  })

  it('does not let queued terminal focus steal focus while an overlay suppresses focus', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const suppressTerminalFocus = ref(false)
    const { runtime } = createRuntime(panel, undefined, { suppressTerminalFocus })

    runtime.focusPanel(panel.id)
    suppressTerminalFocus.value = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)

    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    expect(terminal.focus).not.toHaveBeenCalled()

    suppressTerminalFocus.value = false
    runtime.focusPanel(panel.id)
    await flushFrames(2)
    expect(terminal.focus).toHaveBeenCalled()
  })

  it('does not let queued terminal focus steal focus from a modal dialog input', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const input = document.createElement('input')
    dialog.appendChild(input)
    document.body.appendChild(dialog)
    input.focus()

    runtime.focusPanel(panel.id)
    const host = document.createElement('div')
    document.body.appendChild(host)
    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)

    const terminal = runtime.terminalViews.get(panel.id)?.terminal as unknown as FakeTerminal
    expect(terminal.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)

    dialog.remove()
    runtime.focusPanel(panel.id)
    await flushFrames(2)
    expect(terminal.focus).toHaveBeenCalled()
  })

  it('applies terminal program title changes without overriding user-owned tab names', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)
    const terminal = runtime.terminalViews.get(panel.id)?.terminal as unknown as FakeTerminal

    terminal.titleHandler?.('ignored\u0007 control\nClaude Code')
    expect(panel.title).toBe('ignored control Claude Code')
    expect(panel.titleSource).toBe('auto')

    terminal.titleHandler?.('root@tlinux:~')
    expect(panel.title).toBe('ignored control Claude Code')

    panel.title = 'Pinned name'
    panel.titleSource = 'user'
    terminal.titleHandler?.('Shell title')
    expect(panel.title).toBe('Pinned name')
  })

  it('tracks terminal progress OSC 9;4 on legacy xterm views', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)
    const terminal = runtime.terminalViews.get(panel.id)?.terminal as unknown as FakeTerminal

    expect(terminal.oscHandlers.get(9)?.('4;1;42')).toBe(true)
    expect(panel.terminalProgress).toEqual(expect.objectContaining({ status: 'running', value: 42 }))

    expect(terminal.oscHandlers.get(9)?.('4;0;0')).toBe(true)
    expect(panel.terminalProgress).toBeUndefined()
  })

  it('applies threaded terminal title and progress events through the same panel state path', async () => {
    threadedTerminalMocks.threadedEnabled = true
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel, undefined, { threaded: true })
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const terminal = runtime.terminalViews.get(panel.id)?.terminal as InstanceType<typeof threadedTerminalMocks.FakeThreadedTerminal>

    terminal.titleHandler?.('Threaded shell')
    terminal.progressHandler?.({ status: 'indeterminate', updatedAt: 1 })

    expect(panel.title).toBe('Threaded shell')
    expect(panel.terminalProgress).toEqual({ status: 'indeterminate', updatedAt: 1 })
  })

  it('keeps an existing threaded terminal attached in place without repeating hot-path open work', async () => {
    threadedTerminalMocks.threadedEnabled = true
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime, workspace } = createRuntime(panel, undefined, { threaded: true })
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(4)

    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('threaded terminal view was not created')
    const terminal = view.terminal as InstanceType<typeof threadedTerminalMocks.FakeThreadedTerminal>
    const fit = view.fit as InstanceType<typeof threadedTerminalMocks.FakeThreadedFitAddon>
    terminal.open.mockClear()
    terminal.ensureSurfaceAttached.mockClear()
    terminal.updateSettings.mockClear()
    fit.fit.mockClear()
    logs.length = 0

    workspace.panels = [{ ...panel, output: 'new object same terminal' }] as typeof workspace.panels
    runtime.setTerminalElement(panel.id, host)
    runtime.syncPanelViews()
    await flushFrames(2)

    expect(terminal.open).not.toHaveBeenCalled()
    expect(terminal.ensureSurfaceAttached).not.toHaveBeenCalled()
    expect(terminal.updateSettings).not.toHaveBeenCalled()
    expect(fit.fit).not.toHaveBeenCalled()
    expect(logs.some((entry) => entry.event === 'renderer.terminal-view.threaded-attach-existing')).toBe(false)
  })

  it('rebinds an existing threaded terminal before writing live backend data', async () => {
    threadedTerminalMocks.threadedEnabled = true
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel, undefined, { threaded: true })
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const terminal = runtime.terminalViews.get(panel.id)?.terminal as InstanceType<typeof threadedTerminalMocks.FakeThreadedTerminal>

    panel.sessionId = 'terminal-live-1'
    expect(runtime.writeLiveTerminalData(panel.id, panel.sessionId, 'live output\n')).toBe(true)
    expect(terminal.setSessionId).toHaveBeenLastCalledWith('terminal-live-1')
    expect(terminal.writeBackendData).toHaveBeenCalledWith('terminal-live-1', 'live output\n')
    expect(runtime.writeLiveTerminalData(panel.id, 'terminal-stale', 'stale\n')).toBe(false)
  })

  it('does not create a terminal view while the terminal workspace is hidden', async () => {
    threadedTerminalMocks.threadedEnabled = true
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const terminalWorkspaceVisible = ref(false)
    const { runtime } = createRuntime(panel, undefined, { threaded: true, terminalWorkspaceVisible })
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(2)
    expect(runtime.terminalViews.has(panel.id)).toBe(false)
    expect(threadedTerminalMocks.FakeThreadedTerminal.instances).toHaveLength(0)

    terminalWorkspaceVisible.value = true
    await runtime.syncPanelViews()
    await flushFrames(2)

    expect(runtime.terminalViews.has(panel.id)).toBe(true)
    expect(threadedTerminalMocks.FakeThreadedTerminal.instances).toHaveLength(1)
  })

  it('writes incremental terminal output without refitting the view on the hot path', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    panel.sessionId = 'terminal-1'
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    const fit = view.fit as unknown as FakeFit
    fit.fit.mockClear()
    terminal.scrollToBottom.mockClear()

    panel.output = 'codex output\n'
    runtime.syncTerminalView(panel)
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledWith('codex output\n', expect.any(Function))
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1)
    expect(fit.fit).not.toHaveBeenCalled()
    expect(logs.some((entry) => entry.event === 'renderer.terminal-output.summary')).toBe(false)
  })

  it('routes dropped local files into legacy xterm input', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal

    const dragover = droppedFileEvent('dragover', '/tmp/report 1.txt')
    host.dispatchEvent(dragover.event)
    expect(dragover.event.defaultPrevented).toBe(true)
    expect(dragover.dataTransfer.dropEffect).toBe('copy')

    const drop = droppedFileEvent('drop', '/tmp/report 1.txt')
    host.dispatchEvent(drop.event)

    expect(drop.event.defaultPrevented).toBe(true)
    expect(terminal.focus).toHaveBeenCalled()
    expect(terminal.input).toHaveBeenCalledWith("'/tmp/report 1.txt'", true)
  })

  it('coalesces multiple terminal output syncs into one xterm write per flush', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    terminal.write.mockClear()
    terminal.scrollToBottom.mockClear()

    panel.output = 'one'
    runtime.syncTerminalView(panel)
    panel.output = 'onetwo'
    runtime.syncTerminalView(panel)
    panel.output = 'onetwothree'
    runtime.syncTerminalView(panel)
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledWith('onetwothree', expect.any(Function))
    expect(terminal.output).toBe('onetwothree')
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('splits large queued terminal output into bounded xterm write batches', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    terminal.write.mockClear()

    for (let index = 0; index < 40; index += 1) {
      panel.output += `line-${String(index).padStart(2, '0')}:${'x'.repeat(260)}\n`
      runtime.syncTerminalView(panel)
    }
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write.mock.calls[0][0].length).toBeLessThanOrEqual(8 * 1024)
    expect(terminal.output.length).toBeLessThan(panel.output.length)

    await flushOutput()

    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.output).toBe(panel.output)
  })

  it('waits for the current xterm write callback before flushing queued output again', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    const callbacks: Array<() => void> = []
    terminal.write.mockImplementation((data: string, callback?: () => void) => {
      terminal.output += data
      if (callback) callbacks.push(callback)
    })
    terminal.write.mockClear()

    panel.output = 'one'
    runtime.syncTerminalView(panel)
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.output).toBe('one')
    expect(callbacks).toHaveLength(1)

    panel.output = 'onetwo'
    runtime.syncTerminalView(panel)
    panel.output = 'onetwothree'
    runtime.syncTerminalView(panel)
    await flushOutput()
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledTimes(1)
    callbacks.shift()?.()
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.write).toHaveBeenLastCalledWith('twothree', expect.any(Function))
    expect(terminal.output).toBe('onetwothree')
  })

  it('drops pending incremental writes when a reset rewrite is queued before the frame flush', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    terminal.write.mockClear()
    terminal.clear.mockClear()

    panel.output = 'stale'
    runtime.syncTerminalView(panel)
    panel.output = 'fresh'
    runtime.syncTerminalView(panel)
    await flushOutput()

    expect(terminal.clear).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledWith('fresh', expect.any(Function))
    expect(terminal.output).toBe('fresh')
  })

  it('resizes the backend only from scheduled fit notifications', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    panel.sessionId = 'terminal-1'
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    terminalClientMocks.resizeTerminal.mockClear()

    terminal.cols = 100
    terminal.rows = 30
    terminal.resizeHandler?.({ cols: 100, rows: 30 })
    expect(terminalClientMocks.resizeTerminal).not.toHaveBeenCalled()

    runtime.scheduleTerminalFit(panel.id, { frames: 1 })
    await flushFrames(1)
    expect(terminalClientMocks.resizeTerminal).toHaveBeenCalledTimes(1)
    expect(terminalClientMocks.resizeTerminal).toHaveBeenCalledWith('terminal-1', 100, 30)

    terminal.resizeHandler?.({ cols: 100, rows: 30 })
    runtime.scheduleTerminalFit(panel.id, { frames: 1 })
    await flushFrames(1)
    expect(terminalClientMocks.resizeTerminal).toHaveBeenCalledTimes(1)
  })

  it('does not write terminal output performance summaries in formal mode', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    panel.output = 'first chunk\n'
    runtime.syncTerminalView(panel)
    await flushOutput()
    runtime.setTerminalElement(panel.id, null)

    expect(logs.some((entry) => entry.event === 'renderer.terminal-output.summary')).toBe(false)
  })

  it('flushes terminal output even when requestAnimationFrame is not pumping', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const { runtime } = createRuntime(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const stalledFrame = vi.fn(() => 123)
    window.requestAnimationFrame = stalledFrame as any

    try {
      runtime.setTerminalElement(panel.id, host)
      const view = runtime.terminalViews.get(panel.id)
      if (!view) throw new Error('terminal view was not created')
      const terminal = view.terminal as unknown as FakeTerminal
      terminal.write.mockClear()

      panel.output = 'interactive echo'
      runtime.syncTerminalView(panel)
      await flushOutput()

      expect(terminal.write).toHaveBeenCalledTimes(1)
      expect(terminal.output).toBe('interactive echo')
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
    }
  })

  it('does not write hidden terminal panels until they are visible again', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    const visiblePanels = ref<TerminalPanel[]>([panel])
    const { runtime } = createRuntime(panel, visiblePanels)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    await flushFrames(3)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    terminal.write.mockClear()

    visiblePanels.value = []
    panel.output = 'background output'
    runtime.syncTerminalView(panel)
    await flushOutput()

    expect(terminal.write).not.toHaveBeenCalled()
    expect(view.lastOutput).toBe('')

    visiblePanels.value = [panel]
    runtime.syncTerminalView(panel)
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledWith('background output', expect.any(Function))
    expect(terminal.output).toBe('background output')
  })

  it('retries the initial terminal sync when a switched-in panel becomes renderable after mount', async () => {
    const panel = createEmptyTerminalPanel('panel-1', 'Local')
    panel.output = 'restored output'
    const visiblePanels = ref<TerminalPanel[]>([])
    const { runtime } = createRuntime(panel, visiblePanels)
    const host = document.createElement('div')
    document.body.appendChild(host)

    runtime.setTerminalElement(panel.id, host)
    const view = runtime.terminalViews.get(panel.id)
    if (!view) throw new Error('terminal view was not created')
    const terminal = view.terminal as unknown as FakeTerminal
    terminal.write.mockClear()

    await flushOutput()
    expect(terminal.write).not.toHaveBeenCalled()

    visiblePanels.value = [panel]
    await flushOutput()
    await flushOutput()

    expect(terminal.write).toHaveBeenCalledWith('restored output', expect.any(Function))
    expect(terminal.output).toBe('restored output')
  })
})
