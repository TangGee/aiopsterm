import CoreWorker from '@/services/terminal/threadedTerminalCoreWorker?worker'
import RenderWorker from '@/services/terminal/threadedTerminalRenderWorker?worker'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import type {
  ThreadedTerminalCoreRequest,
  ThreadedTerminalCoreResponse,
  ThreadedTerminalCreateOptions,
  ThreadedTerminalHostCapability,
  ThreadedTerminalPriority,
  ThreadedTerminalRenderRequest,
  ThreadedTerminalRenderResponse,
  ThreadedTerminalRenderSettings,
  ThreadedTerminalScreenSnapshot,
  ThreadedTerminalSettings,
  ThreadedTerminalSurface,
  ThreadedTerminalTheme
} from '@/services/terminal/threadedTerminalProtocol'

type DisposableLike = { dispose: () => void }
type EventHandler<T> = (value: T) => void
type ResizeHandler = (size: { cols: number; rows: number }) => unknown
type SelectionHandler = () => void
type RenderFrameAck = Extract<ThreadedTerminalRenderResponse, { type: 'frame' }> & { at: number }

type ThreadedTerminalInitOptions = {
  terminalId: string
  sessionId?: string
  groupId: string
  surface: ThreadedTerminalSurface
  settings: ThreadedTerminalSettings
  theme: ThreadedTerminalTheme
  initialData?: string
  visible?: boolean
  priority?: ThreadedTerminalPriority
  inputHandler?: (data: string) => void
  resizeHandler?: (cols: number, rows: number) => void
  logFields?: Record<string, unknown>
}

type ThreadedTerminalCoreHandle = {
  id: number
  worker: Worker
  terminals: Set<string>
  pendingBytes: number
  ready: boolean
  created: number
  screens: number
  perf: number
  errors: number
  lastError?: string
}

type ThreadedTerminalRenderDebug = {
  ready: boolean
  attached: number
  frames: number
  perf: number
  errors: number
  lastError?: string
}

type ReadScreenPending = {
  resolve: (value: { text: string; cols: number; rows: number }) => void
  reject: (error: Error) => void
}

type ThreadedTerminalBufferLine = {
  translateToString: (trimRight?: boolean) => string
}

type ThreadedTerminalBufferActive = {
  cursorX: number
  cursorY: number
  viewportY: number
  length: number
  getLine: (index: number) => ThreadedTerminalBufferLine | undefined
}

type ThreadedTerminalOptions = ThreadedTerminalSettings & {
  termName?: string
  scrollback?: number
}

export type ThreadedTerminalDebugStats = {
  supported: boolean
  capabilityReason?: string
  coreWorkers: number
  coreDebug: Array<{
    workerId: number
    ready: boolean
    terminals: number
    created: number
    screens: number
    perf: number
    errors: number
    pendingBytes: number
    lastError?: string
  }>
  renderWorkerActive: boolean
  renderDebug: {
    ready: boolean
    attached: number
    frames: number
    perf: number
    errors: number
    lastError?: string
  }
  hostCount: number
  hosts: Array<{
    terminalId: string
    sessionId?: string
    groupId: string
    surface: ThreadedTerminalSurface
    workerId: number
    visible: boolean
    priority: ThreadedTerminalPriority
    cols: number
    rows: number
    coreCreated: boolean
    surfaceAttached: boolean
    lastSnapshotSeq: number
    lastFrameSeq: number
    lastFrameAt: number
  }>
}

export type ThreadedTerminalPaintMeasure = {
  terminalId: string
  latencyMs: number
  frameMs: number
  paintedRows: number
  seq: number
}

const requestMap = new Map<string, ReadScreenPending>()
const hostMap = new Map<string, ThreadedTerminalHost>()
let corePool: ThreadedTerminalCoreHandle[] | null = null
let renderWorker: Worker | null = null
let requestSeq = 0
const renderDebug: ThreadedTerminalRenderDebug = {
  ready: false,
  attached: 0,
  frames: 0,
  perf: 0,
  errors: 0
}

const encoder = new TextEncoder()
const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
const textByteLength = (value: string) => encoder.encode(value).length

export const threadedTerminalCapability = (): ThreadedTerminalHostCapability => {
  if (typeof window === 'undefined') return { supported: false, reason: 'window-unavailable' }
  if (typeof Worker === 'undefined') return { supported: false, reason: 'worker-unavailable' }
  if (typeof HTMLCanvasElement === 'undefined') return { supported: false, reason: 'canvas-unavailable' }
  if (!('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return { supported: false, reason: 'offscreen-canvas-unavailable' }
  return { supported: true }
}

export const threadedTerminalDefaultWorkerCount = () => {
  const cores = Number(globalThis.navigator?.hardwareConcurrency || 4)
  if (cores <= 4) return 1
  if (cores >= 12) return 3
  return 2
}

const nextRequestId = (prefix: string) => `${prefix}-${++requestSeq}-${Math.round(nowMs())}`

const normalizeSettings = (settings: ThreadedTerminalSettings): ThreadedTerminalSettings => ({
  terminalType: settings.terminalType || 'xterm-256color',
  fontFamily: settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: settings.fontSize || 12,
  lineHeight: settings.lineHeight || 1,
  cursorBlink: settings.cursorBlink,
  cursorStyle: settings.cursorStyle || 'block',
  scrollBack: settings.scrollBack || 1000
})

const renderSettingsFor = (settings: ThreadedTerminalSettings, theme: ThreadedTerminalTheme): ThreadedTerminalRenderSettings => ({
  fontFamily: settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: settings.fontSize || 12,
  lineHeight: settings.lineHeight || 1,
  cursorBlink: settings.cursorBlink,
  cursorStyle: settings.cursorStyle || 'block',
  theme
})

const logThreadedTerminal = (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => {
  writeRendererRuntimeLog(level, event, fields)
}

const postCore = (handle: ThreadedTerminalCoreHandle, message: ThreadedTerminalCoreRequest, transfer?: Transferable[]) => {
  handle.worker.postMessage(message, transfer || [])
}

const postRender = (message: ThreadedTerminalRenderRequest, transfer?: Transferable[]) => {
  if (!renderWorker) ensureRenderWorker()
  renderWorker?.postMessage(message, transfer || [])
}

const handleCoreMessage = (handle: ThreadedTerminalCoreHandle, message: ThreadedTerminalCoreResponse) => {
  if (message.type === 'ready') {
    handle.ready = true
    return
  }
  if (message.type === 'created') {
    handle.created += 1
    handle.terminals.add(message.terminalId)
    return
  }
  if (message.type === 'screen') {
    handle.screens += 1
    const host = hostMap.get(message.snapshot.terminalId)
    host?.applySnapshot(message.snapshot)
    host?.paintSnapshot(message.snapshot)
    return
  }
  if (message.type === 'resize') {
    hostMap.get(message.terminalId)?.emitResize(message.cols, message.rows)
    return
  }
  if (message.type === 'data') {
    hostMap.get(message.terminalId)?.emitData(message.data)
    return
  }
  if (message.type === 'read-screen-result') {
    const pending = requestMap.get(message.requestId)
    if (!pending) return
    requestMap.delete(message.requestId)
    pending.resolve({ text: message.text, cols: message.cols, rows: message.rows })
    return
  }
  if (message.type === 'perf') {
    handle.perf += 1
    const host = hostMap.get(message.sample.terminalId)
    if (host) host.coreHandle.pendingBytes = message.sample.pendingBytes
    logThreadedTerminal('debug', 'renderer.threaded-terminal.core-perf', {
      ...message.sample,
      workerId: handle.id
    })
    return
  }
  if (message.type === 'error') {
    handle.errors += 1
    handle.lastError = message.message
    if (message.requestId) {
      const pending = requestMap.get(message.requestId)
      if (pending) {
        requestMap.delete(message.requestId)
        pending.reject(new Error(message.message))
      }
    }
    logThreadedTerminal('warn', 'renderer.threaded-terminal.core-error', {
      workerId: handle.id,
      terminalId: message.terminalId,
      message: message.message
    })
  }
}

const handleRenderMessage = (message: ThreadedTerminalRenderResponse) => {
  if (message.type === 'ready') {
    renderDebug.ready = true
    return
  }
  if (message.type === 'attached') {
    renderDebug.attached += 1
    return
  }
  if (message.type === 'pong') return
  if (message.type === 'frame') {
    renderDebug.frames += 1
    hostMap.get(message.terminalId)?.applyRenderFrame(message)
    return
  }
  if (message.type === 'perf') {
    renderDebug.perf += 1
    logThreadedTerminal('debug', 'renderer.threaded-terminal.render-perf', message)
    return
  }
  if (message.type === 'error') {
    renderDebug.errors += 1
    renderDebug.lastError = message.message
    logThreadedTerminal('warn', 'renderer.threaded-terminal.render-error', {
      terminalId: message.terminalId,
      message: message.message
    })
  }
}

const ensureCorePool = () => {
  if (corePool) return corePool
  const count = threadedTerminalDefaultWorkerCount()
  corePool = Array.from({ length: count }, (_item, index) => {
    const worker = new CoreWorker({ name: `aiopsterm-terminal-core-${index + 1}` })
    const handle: ThreadedTerminalCoreHandle = {
      id: index + 1,
      worker,
      terminals: new Set(),
      pendingBytes: 0,
      ready: false,
      created: 0,
      screens: 0,
      perf: 0,
      errors: 0
    }
    worker.onmessage = (event: MessageEvent<ThreadedTerminalCoreResponse>) => handleCoreMessage(handle, event.data)
    worker.onerror = (event) => {
      logThreadedTerminal('error', 'renderer.threaded-terminal.core-worker-error', {
        workerId: handle.id,
        message: event.message
      })
    }
    return handle
  })
  logThreadedTerminal('info', 'renderer.threaded-terminal.core-pool-created', { workers: count })
  return corePool
}

const ensureRenderWorker = () => {
  if (renderWorker) return renderWorker
  renderWorker = new RenderWorker({ name: 'aiopsterm-terminal-render-group' })
  renderWorker.onmessage = (event: MessageEvent<ThreadedTerminalRenderResponse>) => handleRenderMessage(event.data)
  renderWorker.onerror = (event) => {
    logThreadedTerminal('error', 'renderer.threaded-terminal.render-worker-error', { message: event.message })
  }
  return renderWorker
}

const pickCoreWorker = (terminalId: string) => {
  const pool = ensureCorePool()
  const hash = Array.from(terminalId).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
  const hashed = pool[hash % pool.length]
  const leastLoaded = pool.reduce((best, item) => {
    const bestLoad = best.terminals.size * 1024 * 1024 + best.pendingBytes
    const itemLoad = item.terminals.size * 1024 * 1024 + item.pendingBytes
    return itemLoad < bestLoad ? item : best
  }, hashed)
  return leastLoaded.terminals.size + 2 < hashed.terminals.size ? leastLoaded : hashed
}

const createDisposable = (dispose: () => void): DisposableLike => ({ dispose })

const keyEventToInput = (event: KeyboardEvent) => {
  if (event.defaultPrevented) return ''
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) return event.key
  if (event.key === 'Enter') return '\r'
  if (event.key === 'Tab') return '\t'
  if (event.key === 'Backspace') return '\x7f'
  if (event.key === 'Escape') return '\x1b'
  if (event.key === 'ArrowUp') return '\x1b[A'
  if (event.key === 'ArrowDown') return '\x1b[B'
  if (event.key === 'ArrowRight') return '\x1b[C'
  if (event.key === 'ArrowLeft') return '\x1b[D'
  if ((event.ctrlKey || event.metaKey) && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64)
  }
  return ''
}

export class ThreadedTerminalFitAddon {
  private host: ThreadedTerminalHost | null = null

  activate(terminal: unknown) {
    if (terminal instanceof ThreadedTerminalHost) this.host = terminal
  }

  fit() {
    this.host?.fit()
  }

  dispose() {
    this.host = null
  }
}

export class ThreadedTerminalSearchAddon {
  activate(_terminal: unknown) {}
  dispose() {}
  findNext() {
    return false
  }
  findPrevious() {
    return false
  }
  clearDecorations() {}
}

export class ThreadedTerminalHost {
  readonly options: ThreadedTerminalOptions
  readonly coreHandle: ThreadedTerminalCoreHandle
  cols: number
  rows: number
  buffer: { active: ThreadedTerminalBufferActive }
  private host: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private offscreenTransferred = false
  private resizeObserver: ResizeObserver | null = null
  private dataHandlers = new Set<EventHandler<string>>()
  private resizeHandlers = new Set<ResizeHandler>()
  private selectionHandlers = new Set<SelectionHandler>()
  private customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null
  private snapshotLines: string[] = []
  private lastSnapshot: ThreadedTerminalScreenSnapshot | null = null
  private lastRenderFrame: RenderFrameAck | null = null
  private frameWaiters = new Set<{
    afterSeq: number
    resolve: (frame: RenderFrameAck) => void
    reject: (error: Error) => void
    timeout: number
  }>()
  private disposed = false
  private coreCreated = false
  private visible: boolean
  private priority: ThreadedTerminalPriority
  private readonly theme: ThreadedTerminalTheme
  private readonly groupId: string
  private readonly surface: ThreadedTerminalSurface
  private readonly terminalId: string
  private readonly sessionId?: string
  private readonly initialData?: string
  private readonly resizeHandler?: (cols: number, rows: number) => void
  private readonly logFields?: Record<string, unknown>

  constructor(options: ThreadedTerminalInitOptions) {
    this.terminalId = options.terminalId
    this.sessionId = options.sessionId
    this.groupId = options.groupId
    this.surface = options.surface
    this.visible = options.visible ?? true
    this.priority = options.priority || (this.visible ? 'visible' : 'background')
    this.options = { ...normalizeSettings(options.settings), scrollback: options.settings.scrollBack }
    this.theme = options.theme
    this.initialData = options.initialData
    this.resizeHandler = options.resizeHandler
    this.logFields = options.logFields
    this.cols = 80
    this.rows = 24
    this.buffer = {
      active: {
        cursorX: 0,
        cursorY: 0,
        viewportY: 0,
        length: 0,
        getLine: (index: number) => {
          const text = this.snapshotLines[index]
          if (text === undefined) return undefined
          return { translateToString: (trimRight = false) => (trimRight ? text.replace(/\s+$/g, '') : text) }
        }
      }
    }
    this.coreHandle = pickCoreWorker(options.terminalId)
    hostMap.set(options.terminalId, this)
  }

  loadAddon(addon: unknown) {
    ;(addon as { activate?: (terminal: ThreadedTerminalHost) => void })?.activate?.(this)
  }

  open(element: HTMLElement) {
    if (this.disposed || this.host) return
    this.host = element
    element.classList.add('threaded-terminal-host')
    element.tabIndex = element.tabIndex >= 0 ? element.tabIndex : 0
    element.style.position = element.style.position || 'relative'
    const canvas = document.createElement('canvas')
    canvas.className = 'threaded-terminal-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    element.replaceChildren(canvas)
    this.canvas = canvas
    this.attachCanvas()
    this.bindDomEvents()
    this.fit()
    if (!this.coreCreated) this.createCore(this.initialData)
  }

  startCoreOnly() {
    if (this.disposed || this.coreCreated) return
    this.visible = false
    this.priority = 'background'
    this.createCore(this.initialData)
  }

  focus() {
    this.host?.focus({ preventScroll: true })
  }

  clear() {
    this.snapshotLines = []
    this.buffer.active.length = 0
    postCore(this.coreHandle, { type: 'clear', terminalId: this.terminalId })
    postRender({ type: 'clear', terminalId: this.terminalId })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.detachSurface()
    this.dataHandlers.clear()
    this.resizeHandlers.clear()
    this.selectionHandlers.clear()
    this.rejectFrameWaiters('Threaded terminal disposed.')
    postCore(this.coreHandle, { type: 'dispose', terminalId: this.terminalId })
    this.coreHandle.terminals.delete(this.terminalId)
    hostMap.delete(this.terminalId)
  }

  detachSurface() {
    const hadSurface = this.offscreenTransferred
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.host) {
      this.host.classList.remove('threaded-terminal-host')
      this.host.replaceChildren()
    }
    this.host = null
    this.canvas = null
    this.offscreenTransferred = false
    if (!this.disposed) {
      this.visible = false
      this.priority = 'background'
      if (this.coreCreated) postCore(this.coreHandle, { type: 'visibility', terminalId: this.terminalId, visible: false, priority: 'background' })
    }
    if (hadSurface) postRender({ type: 'dispose', terminalId: this.terminalId })
  }

  write(data: string, callback?: () => void) {
    if (this.disposed || !data) {
      callback?.()
      return
    }
    if (!this.coreCreated) this.createCore(this.initialData)
    this.coreHandle.pendingBytes += textByteLength(data)
    postCore(this.coreHandle, { type: 'data', terminalId: this.terminalId, data })
    callback?.()
  }

  input(data: string) {
    if (this.disposed || !data) return
    if (!this.coreCreated) this.createCore(this.initialData)
    postCore(this.coreHandle, { type: 'input', terminalId: this.terminalId, data })
  }

  resize(cols: number, rows: number) {
    const nextCols = Math.max(2, Math.floor(cols))
    const nextRows = Math.max(1, Math.floor(rows))
    if (nextCols === this.cols && nextRows === this.rows) return
    this.cols = nextCols
    this.rows = nextRows
    if (this.coreCreated) {
      postCore(this.coreHandle, { type: 'resize', terminalId: this.terminalId, cols: nextCols, rows: nextRows })
    }
    this.resizeHandler?.(nextCols, nextRows)
  }

  refresh() {
    this.fit()
  }

  scrollToBottom() {
    postCore(this.coreHandle, { type: 'scroll-to-bottom', terminalId: this.terminalId })
  }

  getSelection() {
    return ''
  }

  getSelectionPosition() {
    return null
  }

  hasSelection() {
    return false
  }

  clearSelection() {}

  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.customKeyHandler = handler
  }

  onData(handler: EventHandler<string>) {
    this.dataHandlers.add(handler)
    return createDisposable(() => this.dataHandlers.delete(handler))
  }

  onResize(handler: ResizeHandler) {
    this.resizeHandlers.add(handler)
    return createDisposable(() => this.resizeHandlers.delete(handler))
  }

  onSelectionChange(handler: SelectionHandler) {
    this.selectionHandlers.add(handler)
    return createDisposable(() => this.selectionHandlers.delete(handler))
  }

  emitData(data: string) {
    this.dataHandlers.forEach((handler) => handler(data))
  }

  emitResize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.resizeHandlers.forEach((handler) => handler({ cols, rows }))
  }

  applySnapshot(snapshot: ThreadedTerminalScreenSnapshot) {
    this.lastSnapshot = snapshot
    this.cols = snapshot.cols
    this.rows = snapshot.rows
    this.buffer.active.cursorX = snapshot.cursorX
    this.buffer.active.cursorY = snapshot.cursorY
    this.buffer.active.viewportY = snapshot.viewportY
    if (snapshot.full || !this.snapshotLines.length) {
      this.snapshotLines = Array.from({ length: snapshot.rows }, () => '')
    }
    snapshot.lines.forEach((line) => {
      this.snapshotLines[line.y] = line.text
    })
    this.buffer.active.length = this.snapshotLines.length
  }

  paintSnapshot(snapshot: ThreadedTerminalScreenSnapshot) {
    if (!this.offscreenTransferred || !snapshot.visible || !this.visible) return
    postRender({ type: 'screen', snapshot })
  }

  applyRenderFrame(frame: Extract<ThreadedTerminalRenderResponse, { type: 'frame' }>) {
    const ack: RenderFrameAck = { ...frame, at: nowMs() }
    this.lastRenderFrame = ack
    this.resolveFrameWaiters(ack)
  }

  setVisibility(visible: boolean, priority: ThreadedTerminalPriority) {
    if (this.visible === visible && this.priority === priority) return
    this.visible = visible
    this.priority = priority
    postCore(this.coreHandle, { type: 'visibility', terminalId: this.terminalId, visible, priority })
    postRender({ type: 'visibility', terminalId: this.terminalId, visible })
  }

  setPriority(priority: ThreadedTerminalPriority) {
    if (this.priority === priority) return
    this.priority = priority
    postCore(this.coreHandle, { type: 'priority', terminalId: this.terminalId, priority })
  }

  updateSettings(settings: ThreadedTerminalSettings, theme: ThreadedTerminalTheme = this.theme) {
    const normalized = normalizeSettings(settings)
    this.options.terminalType = normalized.terminalType
    this.options.fontFamily = normalized.fontFamily
    this.options.fontSize = normalized.fontSize
    this.options.lineHeight = normalized.lineHeight
    this.options.cursorBlink = normalized.cursorBlink
    this.options.cursorStyle = normalized.cursorStyle
    this.options.scrollBack = normalized.scrollBack
    this.options.scrollback = normalized.scrollBack
    this.options.termName = normalized.terminalType
    postCore(this.coreHandle, { type: 'settings', terminalId: this.terminalId, settings: normalized, theme })
    postRender({ type: 'settings', terminalId: this.terminalId, settings: renderSettingsFor(normalized, theme) })
    this.resizeCanvas()
    this.fit()
  }

  readScreen(tailLines?: number) {
    const requestId = nextRequestId('screen')
    postCore(this.coreHandle, { type: 'read-screen', terminalId: this.terminalId, requestId, tailLines })
    return new Promise<{ text: string; cols: number; rows: number }>((resolve, reject) => {
      requestMap.set(requestId, { resolve, reject })
      window.setTimeout(() => {
        if (!requestMap.has(requestId)) return
        requestMap.delete(requestId)
        resolve({ text: this.snapshotLines.slice(-(tailLines || this.rows)).join('\n').replace(/\s+$/g, ''), cols: this.cols, rows: this.rows })
      }, 1500)
    })
  }

  waitForNextRenderFrame(afterSeq = this.lastRenderFrame?.seq || 0, timeoutMs = 2000) {
    return new Promise<RenderFrameAck>((resolve, reject) => {
      if (this.disposed) {
        reject(new Error('Threaded terminal disposed.'))
        return
      }
      const timeout = window.setTimeout(() => {
        this.frameWaiters.delete(waiter)
        reject(new Error(`Timed out waiting for threaded terminal frame after seq ${afterSeq}.`))
      }, Math.max(100, timeoutMs))
      const waiter = { afterSeq, resolve, reject, timeout }
      this.frameWaiters.add(waiter)
      if (this.lastRenderFrame && this.lastRenderFrame.seq > afterSeq) this.resolveFrameWaiters(this.lastRenderFrame)
    })
  }

  async writeAndMeasurePaint(data: string, timeoutMs = 2000): Promise<ThreadedTerminalPaintMeasure> {
    const previousPriority = this.priority
    const afterSeq = this.lastRenderFrame?.seq || 0
    const startedAt = nowMs()
    if (this.visible && this.priority !== 'active') this.setPriority('active')
    const framePromise = this.waitForNextRenderFrame(afterSeq, timeoutMs)
    this.write(data)
    try {
      const frame = await framePromise
      return {
        terminalId: this.terminalId,
        latencyMs: Math.max(0, frame.at - startedAt),
        frameMs: frame.frameMs,
        paintedRows: frame.paintedRows,
        seq: frame.seq
      }
    } finally {
      if (this.visible && previousPriority !== this.priority) this.setPriority(previousPriority)
    }
  }

  debugInfo() {
    return {
      terminalId: this.terminalId,
      sessionId: this.sessionId,
      groupId: this.groupId,
      surface: this.surface,
      workerId: this.coreHandle.id,
      visible: this.visible,
      priority: this.priority,
      cols: this.cols,
      rows: this.rows,
      coreCreated: this.coreCreated,
      surfaceAttached: this.offscreenTransferred,
      lastSnapshotSeq: this.lastSnapshot?.seq || 0,
      lastFrameSeq: this.lastRenderFrame?.seq || 0,
      lastFrameAt: this.lastRenderFrame?.at || 0
    }
  }

  fit() {
    if (!this.host) return
    const rect = this.host.getBoundingClientRect()
    const width = this.host.clientWidth || rect.width || 1
    const height = this.host.clientHeight || rect.height || 1
    const fontSize = Number(this.options.fontSize || 12)
    const lineHeight = Number(this.options.lineHeight || 1)
    const cellHeight = Math.max(10, Math.ceil(fontSize * lineHeight))
    const cellWidth = Math.max(4, Math.ceil(fontSize * 0.62))
    const cols = Math.max(2, Math.floor(width / cellWidth))
    const rows = Math.max(1, Math.floor(height / cellHeight))
    this.resizeCanvas()
    this.resize(cols, rows)
  }

  private createCore(initialData?: string) {
    const options: ThreadedTerminalCreateOptions = {
      terminalId: this.terminalId,
      sessionId: this.sessionId,
      groupId: this.groupId,
      surface: this.surface,
      cols: this.cols,
      rows: this.rows,
      visible: this.visible,
      priority: this.priority,
      settings: normalizeSettings(this.options),
      theme: this.theme
    }
    postCore(this.coreHandle, { type: 'create', requestId: nextRequestId('create'), options, initialData })
    this.coreCreated = true
    logThreadedTerminal('info', 'renderer.threaded-terminal.created', {
      terminalId: this.terminalId,
      sessionId: this.sessionId,
      groupId: this.groupId,
      surface: this.surface,
      workerId: this.coreHandle.id,
      ...this.logFields
    })
  }

  private attachCanvas() {
    if (!this.canvas || this.offscreenTransferred) return
    const capability = threadedTerminalCapability()
    if (!capability.supported) throw new Error(capability.reason || 'threaded terminal unsupported')
    const offscreen = this.canvas.transferControlToOffscreen()
    this.offscreenTransferred = true
    const rect = this.canvas.getBoundingClientRect()
    const width = this.canvas.clientWidth || rect.width || this.host?.clientWidth || 1
    const height = this.canvas.clientHeight || rect.height || this.host?.clientHeight || 1
    const dpr = window.devicePixelRatio || 1
    postRender(
      {
        type: 'attach',
        options: {
          terminalId: this.terminalId,
          groupId: this.groupId,
          canvas: offscreen,
          width,
          height,
          devicePixelRatio: dpr,
          settings: renderSettingsFor(normalizeSettings(this.options), this.theme)
        }
      },
      [offscreen]
    )
  }

  private bindDomEvents() {
    if (!this.host) return
    const host = this.host
    host.addEventListener('keydown', (event) => {
      if (this.customKeyHandler && this.customKeyHandler(event) === false) return
      const input = keyEventToInput(event)
      if (!input) return
      event.preventDefault()
      this.input(input)
    })
    host.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') || ''
      if (!text) return
      event.preventDefault()
      this.input(text)
    })
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fit())
      this.resizeObserver.observe(host)
    }
  }

  private resizeCanvas() {
    if (!this.host || !this.canvas || !this.offscreenTransferred) return
    const rect = this.host.getBoundingClientRect()
    const width = this.host.clientWidth || rect.width || 1
    const height = this.host.clientHeight || rect.height || 1
    postRender({
      type: 'resize',
      terminalId: this.terminalId,
      width,
      height,
      devicePixelRatio: window.devicePixelRatio || 1
    })
  }

  private resolveFrameWaiters(frame: RenderFrameAck) {
    this.frameWaiters.forEach((waiter) => {
      if (frame.seq <= waiter.afterSeq) return
      window.clearTimeout(waiter.timeout)
      this.frameWaiters.delete(waiter)
      waiter.resolve(frame)
    })
  }

  private rejectFrameWaiters(message: string) {
    this.frameWaiters.forEach((waiter) => {
      window.clearTimeout(waiter.timeout)
      waiter.reject(new Error(message))
    })
    this.frameWaiters.clear()
  }
}

export const createThreadedTerminalHost = (options: ThreadedTerminalInitOptions) => new ThreadedTerminalHost(options)

export const isThreadedTerminalHost = (value: unknown): value is ThreadedTerminalHost => value instanceof ThreadedTerminalHost

export const threadedTerminalPriorityFor = (terminalId: string, activeTerminalId: string, visible: boolean): ThreadedTerminalPriority => {
  if (terminalId === activeTerminalId) return 'active'
  return visible ? 'visible' : 'background'
}

export const getThreadedTerminalDebugStats = (): ThreadedTerminalDebugStats => {
  const capability = threadedTerminalCapability()
  return {
    supported: capability.supported,
    capabilityReason: capability.reason,
    coreWorkers: corePool?.length || 0,
    coreDebug: (corePool || []).map((handle) => ({
      workerId: handle.id,
      ready: handle.ready,
      terminals: handle.terminals.size,
      created: handle.created,
      screens: handle.screens,
      perf: handle.perf,
      errors: handle.errors,
      pendingBytes: handle.pendingBytes,
      lastError: handle.lastError
    })),
    renderWorkerActive: Boolean(renderWorker),
    renderDebug: { ...renderDebug },
    hostCount: hostMap.size,
    hosts: Array.from(hostMap.values()).map((host) => host.debugInfo())
  }
}
