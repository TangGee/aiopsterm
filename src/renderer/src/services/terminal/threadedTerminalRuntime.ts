import CoreWorker from '@/services/terminal/threadedTerminalCoreWorker?worker'
import RenderWorker from '@/services/terminal/threadedTerminalRenderWorker?worker'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import { copyTextToClipboard, readTextFromClipboard } from '@/services/app/clipboardRuntime'
import { shouldUseTerminalDebugLogs, terminalRenderBackend } from '@shared/runtimeSwitches'
import {
  fallbackTerminalCellMetrics,
  measureTerminalCellMetrics,
  terminalFontSpec
} from '@/services/terminal/threadedTerminalMetrics'
import type {
  ThreadedTerminalCellMetrics,
  ThreadedTerminalCoreRequest,
  ThreadedTerminalCoreResponse,
  ThreadedTerminalCreateOptions,
  ThreadedTerminalFullReason,
  ThreadedTerminalGeometry,
  ThreadedTerminalGpuInfo,
  ThreadedTerminalHostCapability,
  ThreadedTerminalKeywordHighlightConfig,
  ThreadedTerminalPriority,
  ThreadedTerminalRenderBackend,
  ThreadedTerminalRenderRequest,
  ThreadedTerminalRenderResponse,
  ThreadedTerminalRenderSettings,
  ThreadedTerminalRenderSurfaceRect,
  ThreadedTerminalScreenLine,
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
  keywordHighlight?: ThreadedTerminalKeywordHighlightConfig
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

type ThreadedTerminalSelectionPoint = {
  x: number
  y: number
}

type ThreadedTerminalSelectionMode = 'char' | 'word' | 'line'

type ThreadedTerminalSelection = {
  anchor: ThreadedTerminalSelectionPoint
  focus: ThreadedTerminalSelectionPoint
  selecting: boolean
  mode: ThreadedTerminalSelectionMode
  origin?: ThreadedTerminalSelectionPoint
}

type ThreadedTerminalFitOptions = {
  allowUnstable?: boolean
  forceMetrics?: boolean
}

type ThreadedTerminalBufferActive = {
  cursorX: number
  cursorY: number
  viewportY: number
  baseY: number
  length: number
  getLine: (index: number) => ThreadedTerminalBufferLine | undefined
}

type ThreadedTerminalOptions = ThreadedTerminalSettings & {
  termName?: string
  scrollback?: number
}

type ThreadedTerminalRenderGroupHandle = {
  renderGroupId: string
  surface: ThreadedTerminalSurface
  container: HTMLElement
  canvas: HTMLCanvasElement
  attached: boolean
  requestedBackend: ThreadedTerminalRenderBackend
  backend?: ThreadedTerminalRenderBackend
  gpu?: ThreadedTerminalGpuInfo
  width: number
  height: number
  dpr: number
  hosts: Set<string>
}

type ThreadedTerminalRenderGroupResolution = {
  renderGroupId: string
  container: HTMLElement
}

const defaultWordSeparators = new Set(Array.from(' ()[]{}\'"`'))

declare global {
  interface Window {
    __AIOPSTERM_THREADED_TERMINAL_DEBUG__?: {
      stats: () => ThreadedTerminalDebugStats
    }
  }
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
  renderGroups: Array<{
    renderGroupId: string
    surface: ThreadedTerminalSurface
    hosts: number
    attached: boolean
    requestedBackend: ThreadedTerminalRenderBackend
    backend?: ThreadedTerminalRenderBackend
    gpu?: ThreadedTerminalGpuInfo
    width: number
    height: number
    dpr: number
  }>
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

export type ThreadedTerminalHostDebugSnapshot = {
  text: string
  cols: number
  rows: number
  viewportY: number
  baseY: number
  lines: ThreadedTerminalScreenLine[]
  lastFrameSeq: number
}

export type ThreadedTerminalPaintMeasure = {
  terminalId: string
  latencyMs: number
  frameMs: number
  paintedRows: number
  full: boolean
  fullReason?: ThreadedTerminalFullReason
  repaintReason?: ThreadedTerminalFullReason
  scrollDeltaRows?: number
  seq: number
}

const requestMap = new Map<string, ReadScreenPending>()
const hostMap = new Map<string, ThreadedTerminalHost>()
const renderGroupMap = new Map<string, ThreadedTerminalRenderGroupHandle>()
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

const clonePlain = <T>(value: T): T => {
  if (value === null || value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

const cloneTheme = (theme: ThreadedTerminalTheme): ThreadedTerminalTheme => ({ ...clonePlain(theme) })

const cloneKeywordHighlightConfig = (config: ThreadedTerminalKeywordHighlightConfig): ThreadedTerminalKeywordHighlightConfig =>
  config ? clonePlain(config) : config

const renderSettingsFor = (
  settings: ThreadedTerminalSettings,
  theme: ThreadedTerminalTheme,
): ThreadedTerminalRenderSettings => ({
  fontFamily: settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: settings.fontSize || 12,
  lineHeight: settings.lineHeight || 1,
  cursorBlink: settings.cursorBlink,
  cursorStyle: settings.cursorStyle || 'block',
  theme: cloneTheme(theme)
})

const settingsSignatureFor = (settings: ThreadedTerminalSettings, theme: ThreadedTerminalTheme) =>
  [
    settings.terminalType || 'xterm-256color',
    settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    settings.fontSize || 12,
    settings.lineHeight || 1,
    settings.cursorBlink ? '1' : '0',
    settings.cursorStyle || 'block',
    settings.scrollBack || 1000,
    theme.background,
    theme.foreground,
    theme.cursor,
    theme.selectionBackground || ''
  ].join('\u001f')

const logThreadedTerminal = (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => {
  if (level === 'debug' && !shouldUseTerminalDebugLogs()) return
  writeRendererRuntimeLog(level, event, fields)
}

const useThreadedTerminalDiagnostics = () => shouldUseTerminalDebugLogs()

const terminalScrollbarWidthPx = 10
const terminalScrollbarThumbMinPx = 28
const terminalMinimumStableHostWidthPx = 24
const terminalMinimumStableHostHeightPx = 24
const workspaceRenderGroupId = 'workspace-main'
const codexRenderGroupId = 'codex-side'
const defaultRenderBackend = (): ThreadedTerminalRenderBackend => terminalRenderBackend()

const blankScreenLine = (y: number): ThreadedTerminalScreenLine => ({ y, text: '', cells: [] })

const cloneCellRuns = (runs?: ThreadedTerminalScreenLine['cells']) => runs?.map((cell) => ({
  ...cell,
  chars: cell.chars ? [...cell.chars] : undefined,
  widths: cell.widths ? [...cell.widths] : undefined
}))

const runChars = (run: { text: string; chars?: string[] }) => run.chars || Array.from(run.text || '')
const runWidths = (run: { text: string; chars?: string[]; widths?: number[] }) => {
  const chars = runChars(run)
  return chars.map((_char, index) => Math.max(1, run.widths?.[index] || 1))
}

const postCore = (handle: ThreadedTerminalCoreHandle, message: ThreadedTerminalCoreRequest, transfer?: Transferable[]) => {
  handle.worker.postMessage(message, transfer || [])
}

const postRender = (message: ThreadedTerminalRenderRequest, transfer?: Transferable[]) => {
  if (!renderWorker) ensureRenderWorker()
  renderWorker?.postMessage(message, transfer || [])
}

const renderGroupIdForSurface = (surface: ThreadedTerminalSurface) =>
  surface === 'codex' ? codexRenderGroupId : workspaceRenderGroupId

const resolveRenderGroupForHost = (host: HTMLElement, surface: ThreadedTerminalSurface): ThreadedTerminalRenderGroupResolution | null => {
  if (!host.isConnected) return null
  const renderGroupId = renderGroupIdForSurface(surface)
  const container =
    surface === 'codex'
      ? (host.closest('.ai-codex-xterm-stack') as HTMLElement | null)
      : (host.closest('.terminal-grid') as HTMLElement | null)
  if (!container?.isConnected) return null
  return { renderGroupId, container }
}

const ensureRenderGroupCanvas = (container: HTMLElement, surface: ThreadedTerminalSurface, renderGroupId: string) => {
  const existing = container.querySelector<HTMLCanvasElement>(`:scope > .threaded-terminal-render-group-canvas[data-render-group-id="${renderGroupId}"]`)
  if (existing) return existing
  const style = window.getComputedStyle(container)
  if (style.position === 'static') container.style.position = 'relative'
  const canvas = document.createElement('canvas')
  canvas.className = 'threaded-terminal-render-group-canvas'
  canvas.dataset.renderGroupId = renderGroupId
  canvas.dataset.surface = surface
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '0'
  })
  container.prepend(canvas)
  return canvas
}

const groupSizeForContainer = (container: HTMLElement) => {
  const rect = container.getBoundingClientRect()
  return {
    width: Math.max(1, Math.floor(container.clientWidth || rect.width || 1)),
    height: Math.max(1, Math.floor(container.clientHeight || rect.height || 1)),
    dpr: window.devicePixelRatio || 1
  }
}

const isRenderableBox = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  const width = Math.floor(element.clientWidth || rect.width || 0)
  const height = Math.floor(element.clientHeight || rect.height || 0)
  return width >= terminalMinimumStableHostWidthPx && height >= terminalMinimumStableHostHeightPx
}

const ensureRenderGroup = (host: HTMLElement, surface: ThreadedTerminalSurface) => {
  const resolved = resolveRenderGroupForHost(host, surface)
  if (!resolved) return null
  const { renderGroupId, container } = resolved
  const previous = renderGroupMap.get(renderGroupId)
  if (previous && previous.container !== container) {
    postRender({ type: 'dispose-group', renderGroupId })
    previous.canvas.remove()
    previous.hosts.forEach((terminalId) => hostMap.get(terminalId)?.markSurfaceDetachedByRenderGroup(renderGroupId))
    renderGroupMap.delete(renderGroupId)
  }
  const size = groupSizeForContainer(container)
  let group = renderGroupMap.get(renderGroupId)
  if (!group) {
    const canvas = ensureRenderGroupCanvas(container, surface, renderGroupId)
    group = {
      renderGroupId,
      surface,
      container,
      canvas,
      attached: false,
      requestedBackend: defaultRenderBackend(),
      width: size.width,
      height: size.height,
      dpr: size.dpr,
      hosts: new Set()
    }
    renderGroupMap.set(renderGroupId, group)
  }
  if (!group.attached) {
    const offscreen = group.canvas.transferControlToOffscreen()
    group.attached = true
    group.width = size.width
    group.height = size.height
    group.dpr = size.dpr
    logThreadedTerminal('debug', 'renderer.threaded-terminal.render-group-attach', {
      renderGroupId,
      surface,
      width: size.width,
      height: size.height,
      dpr: size.dpr
    })
    postRender(
      {
        type: 'attach-group',
        options: {
          renderGroupId,
          canvas: offscreen,
          devicePixelRatio: size.dpr,
          width: size.width,
          height: size.height,
          backend: group.requestedBackend
        }
      },
      [offscreen]
    )
  } else if (group.width !== size.width || group.height !== size.height || group.dpr !== size.dpr) {
    group.width = size.width
    group.height = size.height
    group.dpr = size.dpr
    logThreadedTerminal('debug', 'renderer.threaded-terminal.render-group-resize', {
      renderGroupId,
      surface,
      width: size.width,
      height: size.height,
      dpr: size.dpr
    })
    postRender({
      type: 'resize-group',
      renderGroupId,
      devicePixelRatio: size.dpr,
      width: size.width,
      height: size.height
    })
  }
  return group
}

const detachHostFromRenderGroups = (terminalId: string) => {
  renderGroupMap.forEach((group, renderGroupId) => {
    if (!group.hosts.delete(terminalId) || group.hosts.size) return
    postRender({ type: 'dispose-group', renderGroupId })
    group.canvas.remove()
    renderGroupMap.delete(renderGroupId)
  })
}

const removeHostFromOtherRenderGroups = (terminalId: string, keepRenderGroupId: string) => {
  renderGroupMap.forEach((group, renderGroupId) => {
    if (renderGroupId === keepRenderGroupId) return
    group.hosts.delete(terminalId)
  })
}

const rectForHostInGroup = (host: HTMLElement, group: ThreadedTerminalRenderGroupHandle): ThreadedTerminalRenderSurfaceRect => {
  const hostRect = host.getBoundingClientRect()
  const groupRect = group.container.getBoundingClientRect()
  return {
    x: hostRect.left - groupRect.left,
    y: hostRect.top - groupRect.top,
    width: Math.max(1, Math.floor(host.clientWidth || hostRect.width || 1) - terminalScrollbarWidthPx),
    height: Math.max(1, Math.floor(host.clientHeight || hostRect.height || 1))
  }
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
  if (message.type === 'group-attached') {
    const group = renderGroupMap.get(message.renderGroupId)
    if (group) {
      group.backend = message.backend
      group.gpu = message.gpu
      group.canvas.dataset.backend = message.backend
      if (message.gpu?.renderer) group.canvas.dataset.gpuRenderer = message.gpu.renderer
      if (message.gpu?.vendor) group.canvas.dataset.gpuVendor = message.gpu.vendor
      if (message.gpu?.unmaskedRenderer) group.canvas.dataset.gpuUnmaskedRenderer = message.gpu.unmaskedRenderer
      if (message.gpu?.unmaskedVendor) group.canvas.dataset.gpuUnmaskedVendor = message.gpu.unmaskedVendor
    }
    logThreadedTerminal('debug', 'renderer.threaded-terminal.render-group-attached', {
      renderGroupId: message.renderGroupId,
      backend: message.backend,
      gpu: message.gpu,
      width: message.width,
      height: message.height
    })
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

const isCopyShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  if (key !== 'c') return false
  if (event.shiftKey && (event.ctrlKey || event.metaKey) && !event.altKey) return true
  return event.metaKey && !event.ctrlKey && !event.altKey
}

const isPasteShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  if (key !== 'v') return false
  if (event.shiftKey && (event.ctrlKey || event.metaKey) && !event.altKey) return true
  return event.metaKey && !event.ctrlKey && !event.altKey
}

const keyEventToInput = (event: KeyboardEvent) => {
  if (event.defaultPrevented) return ''
  if (event.isComposing || event.key === 'Process') return ''
  if (event.key === 'Enter') return '\r'
  if (event.key === 'Tab') return '\t'
  if (event.key === 'Backspace') return '\x7f'
  if (event.key === 'Escape') return '\x1b'
  if (event.key === 'ArrowUp') return '\x1b[A'
  if (event.key === 'ArrowDown') return '\x1b[B'
  if (event.key === 'ArrowRight') return '\x1b[C'
  if (event.key === 'ArrowLeft') return '\x1b[D'
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.length === 1) {
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
  private renderSurfaceElement: HTMLElement | null = null
  private inputElement: HTMLTextAreaElement | null = null
  private scrollbar: HTMLElement | null = null
  private scrollbarThumb: HTMLElement | null = null
  private selectionLayer: HTMLElement | null = null
  private eventController: AbortController | null = null
  private surfaceAttached = false
  private resizeObserver: ResizeObserver | null = null
  private dataHandlers = new Set<EventHandler<string>>()
  private resizeHandlers = new Set<ResizeHandler>()
  private selectionHandlers = new Set<SelectionHandler>()
  private customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null
  private snapshotLines: string[] = []
  private snapshotScreenLines: ThreadedTerminalScreenLine[] = []
  private lastSnapshot: ThreadedTerminalScreenSnapshot | null = null
  private lastRenderFrame: RenderFrameAck | null = null
  private renderGroup: ThreadedTerminalRenderGroupHandle | null = null
  private lastSurfaceLayout: { renderGroupId: string; x: number; y: number; width: number; height: number; geometrySeq: number } | null = null
  private geometrySeq = 0
  private geometry: ThreadedTerminalGeometry | null = null
  private pendingFitFrame: number | null = null
  private pendingSurfaceAttachFrame: number | null = null
  private surfaceAttachRetryBudget = 0
  private lastStableFit: { width: number; height: number; cols: number; rows: number } | null = null
  private cellMetricsSignature = ''
  private lastSmallGeometryLogSignature = ''
  private lastSmallLayoutLogSignature = ''
  private pendingSmallLayoutFrame: number | null = null
  private selection: ThreadedTerminalSelection | null = null
  private cellMetrics: ThreadedTerminalCellMetrics = fallbackTerminalCellMetrics({
    fontSize: 12,
    lineHeight: 1
  })
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
  private theme: ThreadedTerminalTheme
  private keywordHighlight?: ThreadedTerminalKeywordHighlightConfig
  private settingsSignature: string
  private scrollbarDrag: { startClientY: number; startViewportY: number; max: number; trackHeight: number; thumbHeight: number } | null = null
  private composing = false
  private skipNextInputText: string | null = null
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
    const normalizedSettings = normalizeSettings(options.settings)
    this.options = {
      ...normalizedSettings,
      scrollback: normalizedSettings.scrollBack,
      termName: normalizedSettings.terminalType
    }
    this.theme = cloneTheme(options.theme)
    this.keywordHighlight = cloneKeywordHighlightConfig(options.keywordHighlight)
    this.settingsSignature = settingsSignatureFor(normalizedSettings, this.theme)
    this.cellMetrics = fallbackTerminalCellMetrics(this.options)
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
        baseY: 0,
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
    if (this.disposed) return
    if (this.host) {
      if (this.host !== element) {
        this.detachSurface()
      } else {
        this.ensureSurfaceAttached()
        this.bindDomEvents()
        return
      }
    }
    this.host = element
    element.classList.add('threaded-terminal-host')
    element.tabIndex = element.tabIndex >= 0 ? element.tabIndex : 0
    element.style.position = element.style.position || 'relative'
    const renderSurface = document.createElement('div')
    renderSurface.className = 'threaded-terminal-surface'
    renderSurface.setAttribute('aria-hidden', 'true')
    Object.assign(renderSurface.style, {
      position: 'absolute',
      inset: `0 ${terminalScrollbarWidthPx}px 0 0`,
      pointerEvents: 'none'
    })
    const selectionLayer = document.createElement('div')
    selectionLayer.className = 'threaded-terminal-selection-layer'
    selectionLayer.setAttribute('aria-hidden', 'true')
    Object.assign(selectionLayer.style, {
      position: 'absolute',
      inset: `0 ${terminalScrollbarWidthPx}px 0 0`,
      pointerEvents: 'none',
      mixBlendMode: 'screen'
    })
    const scrollbar = document.createElement('div')
    scrollbar.className = 'threaded-terminal-scrollbar'
    scrollbar.setAttribute('role', 'scrollbar')
    scrollbar.setAttribute('aria-label', 'Terminal scrollback')
    scrollbar.setAttribute('aria-orientation', 'vertical')
    scrollbar.setAttribute('aria-valuemin', '0')
    scrollbar.setAttribute('aria-valuemax', '0')
    scrollbar.setAttribute('aria-valuenow', '0')
    Object.assign(scrollbar.style, {
      position: 'absolute',
      top: '0',
      right: '0',
      width: `${terminalScrollbarWidthPx}px`,
      height: '100%',
      margin: '0',
      padding: '3px 3px',
      boxSizing: 'border-box',
      cursor: 'default',
      userSelect: 'none'
    })
    const scrollbarThumb = document.createElement('div')
    scrollbarThumb.className = 'threaded-terminal-scrollbar-thumb'
    Object.assign(scrollbarThumb.style, {
      position: 'absolute',
      left: '3px',
      right: '3px',
      top: '3px',
      minHeight: `${terminalScrollbarThumbMinPx}px`,
      borderRadius: '999px',
      opacity: '0',
      transition: 'opacity 120ms ease, background-color 120ms ease'
    })
    scrollbar.appendChild(scrollbarThumb)
    const inputElement = document.createElement('textarea')
    inputElement.className = 'threaded-terminal-input'
    inputElement.setAttribute('aria-label', 'Terminal input')
    inputElement.setAttribute('autocapitalize', 'off')
    inputElement.setAttribute('autocomplete', 'off')
    inputElement.setAttribute('autocorrect', 'off')
    inputElement.setAttribute('spellcheck', 'false')
    inputElement.wrap = 'off'
    inputElement.tabIndex = 0
    Object.assign(inputElement.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '1px',
      height: `${Math.max(1, Number(this.options.fontSize || 12))}px`,
      opacity: '0',
      border: '0',
      padding: '0',
      margin: '0',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      background: 'transparent',
      color: 'transparent',
      caretColor: 'transparent',
      pointerEvents: 'none'
    })
    element.replaceChildren(renderSurface, selectionLayer, scrollbar, inputElement)
    this.renderSurfaceElement = renderSurface
    this.selectionLayer = selectionLayer
    this.scrollbar = scrollbar
    this.scrollbarThumb = scrollbarThumb
    this.inputElement = inputElement
    this.applyScrollbarTheme()
    try {
      if (this.fit({ allowUnstable: false })) this.ensureCoreAndSurface()
      else this.scheduleFit()
    } catch (error) {
      logThreadedTerminal('error', 'renderer.threaded-terminal.open-failed', {
        terminalId: this.terminalId,
        sessionId: this.sessionId,
        groupId: this.groupId,
        surface: this.surface,
        message: error instanceof Error ? error.message : String(error),
        ...this.logFields
      })
      throw error
    }
    this.bindDomEvents()
  }

  ensureSurfaceAttached(options: { forceGeometry?: boolean } = {}) {
    if (this.disposed || !this.host) return false
    const fit = this.fit({ allowUnstable: Boolean(options.forceGeometry), forceMetrics: options.forceGeometry })
    if (!fit) {
      this.scheduleFit()
      return false
    }
    this.ensureCoreAndSurface()
    return this.surfaceAttached
  }

  startCoreOnly() {
    if (this.disposed || this.coreCreated) return
    this.visible = false
    this.priority = 'background'
    this.createCore(this.initialData)
  }

  focus() {
    this.focusInput()
  }

  clear() {
    this.snapshotLines = []
    this.snapshotScreenLines = []
    this.buffer.active.length = 0
    this.clearSelection()
    if (this.coreCreated) postCore(this.coreHandle, { type: 'clear', terminalId: this.terminalId })
    if (this.surfaceAttached) postRender({ type: 'clear', terminalId: this.terminalId })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.detachSurface()
    this.dataHandlers.clear()
    this.resizeHandlers.clear()
    this.selectionHandlers.clear()
    this.rejectFrameWaiters('Threaded terminal disposed.')
    if (this.coreCreated) postCore(this.coreHandle, { type: 'dispose', terminalId: this.terminalId })
    this.coreHandle.terminals.delete(this.terminalId)
    hostMap.delete(this.terminalId)
  }

  detachSurface() {
    const hadSurface = this.surfaceAttached
    this.eventController?.abort()
    this.eventController = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.pendingFitFrame !== null) {
      cancelAnimationFrame(this.pendingFitFrame)
      this.pendingFitFrame = null
    }
    if (this.pendingSurfaceAttachFrame !== null) {
      cancelAnimationFrame(this.pendingSurfaceAttachFrame)
      this.pendingSurfaceAttachFrame = null
    }
    this.surfaceAttachRetryBudget = 0
    if (this.pendingSmallLayoutFrame !== null) {
      cancelAnimationFrame(this.pendingSmallLayoutFrame)
      this.pendingSmallLayoutFrame = null
    }
    if (this.host) {
      this.host.classList.remove('threaded-terminal-host')
      this.host.replaceChildren()
    }
    this.host = null
    this.renderSurfaceElement = null
    this.inputElement = null
    this.scrollbar = null
    this.scrollbarThumb = null
    this.selectionLayer = null
    this.eventController = null
    this.surfaceAttached = false
    this.renderGroup = null
    this.lastSurfaceLayout = null
    this.geometry = null
    this.lastStableFit = null
    this.selection = null
    this.composing = false
    this.skipNextInputText = null
    if (hadSurface) {
      postRender({ type: 'dispose', terminalId: this.terminalId })
      detachHostFromRenderGroups(this.terminalId)
    }
    if (!this.disposed) {
      this.visible = false
      this.priority = 'background'
      if (this.coreCreated) postCore(this.coreHandle, { type: 'visibility', terminalId: this.terminalId, visible: false, priority: 'background' })
    }
  }

  markSurfaceDetachedByRenderGroup(renderGroupId: string) {
    if (this.lastSurfaceLayout?.renderGroupId !== renderGroupId && this.renderGroup?.renderGroupId !== renderGroupId) return
    this.surfaceAttached = false
    this.renderGroup = null
    this.lastSurfaceLayout = null
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
    if (!this.coreCreated) return
    postCore(this.coreHandle, { type: 'scroll-to-bottom', terminalId: this.terminalId })
  }

  scrollLines(amount: number) {
    const normalized = Math.trunc(amount)
    if (!normalized || !this.coreCreated) return
    postCore(this.coreHandle, { type: 'scroll-lines', terminalId: this.terminalId, amount: normalized })
  }

  scrollToLine(line: number) {
    if (!this.coreCreated) return
    const normalized = Math.max(0, Math.trunc(line))
    postCore(this.coreHandle, { type: 'scroll-to-line', terminalId: this.terminalId, line: normalized })
  }

  getSelection() {
    return this.selectionText()
  }

  getSelectionPosition() {
    const range = this.normalizedSelection()
    if (!range) return null
    return {
      start: { x: range.start.x, y: range.start.y },
      end: { x: range.end.x, y: range.end.y }
    }
  }

  hasSelection() {
    return Boolean(this.normalizedSelection())
  }

  clearSelection() {
    if (!this.selection) return
    this.selection = null
    this.renderSelection()
    this.emitSelectionChange()
  }

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
    this.buffer.active.baseY = snapshot.baseY
    this.buffer.active.length = Math.max(snapshot.baseY + snapshot.rows, snapshot.viewportY + snapshot.rows, snapshot.lines.length)
    this.updateInputPosition()
    if (snapshot.full || !this.snapshotLines.length || Math.abs(snapshot.scrollDeltaRows || 0) >= snapshot.rows) {
      this.snapshotLines = Array.from({ length: snapshot.rows }, () => '')
      this.snapshotScreenLines = Array.from({ length: snapshot.rows }, (_item, row) => blankScreenLine(row))
    } else {
      if (this.snapshotLines.length < snapshot.rows) {
        this.snapshotLines.push(...Array.from({ length: snapshot.rows - this.snapshotLines.length }, () => ''))
        this.snapshotScreenLines.push(...Array.from({ length: snapshot.rows - this.snapshotScreenLines.length }, (_item, row) => blankScreenLine(this.snapshotScreenLines.length + row)))
      } else if (this.snapshotLines.length > snapshot.rows) {
        this.snapshotLines = this.snapshotLines.slice(0, snapshot.rows)
        this.snapshotScreenLines = this.snapshotScreenLines.slice(0, snapshot.rows)
      }
      const scrollDeltaRows = snapshot.scrollDeltaRows || 0
      if (scrollDeltaRows > 0) {
        this.snapshotLines = this.snapshotLines.slice(scrollDeltaRows).concat(Array.from({ length: scrollDeltaRows }, () => ''))
        this.snapshotScreenLines = this.snapshotScreenLines.slice(scrollDeltaRows).concat(Array.from({ length: scrollDeltaRows }, (_item, row) => blankScreenLine(snapshot.rows - scrollDeltaRows + row)))
      } else if (scrollDeltaRows < 0) {
        this.snapshotLines = Array.from({ length: Math.abs(scrollDeltaRows) }, () => '').concat(this.snapshotLines.slice(0, snapshot.rows + scrollDeltaRows))
        this.snapshotScreenLines = Array.from({ length: Math.abs(scrollDeltaRows) }, (_item, row) => blankScreenLine(row)).concat(this.snapshotScreenLines.slice(0, snapshot.rows + scrollDeltaRows))
      }
    }
    snapshot.lines.forEach((line) => {
      this.snapshotLines[line.y] = line.text
      this.snapshotScreenLines[line.y] = {
        ...line,
        runs: cloneCellRuns(line.runs),
        cells: cloneCellRuns(line.cells),
        highlights: line.highlights ? line.highlights.map((highlight) => ({ ...highlight, chars: highlight.chars ? [...highlight.chars] : undefined, widths: highlight.widths ? [...highlight.widths] : undefined })) : undefined
      }
    })
    this.snapshotScreenLines.forEach((line, row) => {
      line.y = row
    })
    this.updateScrollbar()
    this.renderSelection()
  }

  paintSnapshot(snapshot: ThreadedTerminalScreenSnapshot) {
    if (!this.surfaceAttached || !snapshot.visible || !this.visible) return
    postRender({ type: 'screen', snapshot })
  }

  applyRenderFrame(frame: Extract<ThreadedTerminalRenderResponse, { type: 'frame' }>) {
    const ack: RenderFrameAck = { ...frame, at: nowMs() }
    this.lastRenderFrame = ack
    this.resolveFrameWaiters(ack)
  }

  setVisibility(visible: boolean, priority: ThreadedTerminalPriority) {
    const unchanged = this.visible === visible && this.priority === priority
    this.visible = visible
    this.priority = priority
    if (visible && !this.surfaceAttached && this.host) this.ensureSurfaceAttached({ forceGeometry: true })
    if (visible && !this.surfaceAttached) this.scheduleSurfaceAttachRetry({ forceGeometry: true, attempts: 8 })
    if (unchanged && (!visible || this.surfaceAttached || !this.host)) return
    if (this.coreCreated) postCore(this.coreHandle, { type: 'visibility', terminalId: this.terminalId, visible, priority })
    if (this.surfaceAttached) postRender({ type: 'visibility', terminalId: this.terminalId, visible })
    if (visible && this.surfaceAttached && this.lastSnapshot) {
      postRender({
        type: 'screen',
        snapshot: this.fullSnapshotFromCache('visibility')
      })
    }
  }

  setPriority(priority: ThreadedTerminalPriority) {
    if (this.priority === priority) return
    this.priority = priority
    if (this.coreCreated) postCore(this.coreHandle, { type: 'priority', terminalId: this.terminalId, priority })
  }

  updateKeywordHighlight(config: ThreadedTerminalKeywordHighlightConfig) {
    this.keywordHighlight = cloneKeywordHighlightConfig(config)
    if (!this.coreCreated) return
    postCore(this.coreHandle, { type: 'keyword-highlight', terminalId: this.terminalId, config: this.keywordHighlight })
  }

  updateSettings(settings: ThreadedTerminalSettings, theme: ThreadedTerminalTheme = this.theme) {
    const normalized = normalizeSettings(settings)
    const nextTheme = cloneTheme(theme)
    const nextSignature = settingsSignatureFor(normalized, nextTheme)
    if (nextSignature === this.settingsSignature) return
    this.settingsSignature = nextSignature
    this.theme = nextTheme
    this.applyScrollbarTheme()
    this.options.terminalType = normalized.terminalType
    this.options.fontFamily = normalized.fontFamily
    this.options.fontSize = normalized.fontSize
    this.options.lineHeight = normalized.lineHeight
    this.options.cursorBlink = normalized.cursorBlink
    this.options.cursorStyle = normalized.cursorStyle
    this.options.scrollBack = normalized.scrollBack
    this.options.scrollback = normalized.scrollBack
    this.options.termName = normalized.terminalType
    this.fit({ allowUnstable: true, forceMetrics: true })
    if (this.visible && !this.surfaceAttached && this.host) this.ensureSurfaceAttached({ forceGeometry: true })
    if (!this.coreCreated) return
    postCore(this.coreHandle, { type: 'settings', terminalId: this.terminalId, settings: normalized, theme: this.theme })
    if (this.surfaceAttached && this.geometry) {
      postRender({
        type: 'settings',
        terminalId: this.terminalId,
        settings: renderSettingsFor(normalized, this.theme),
        geometry: this.geometry
      })
    }
  }

  readScreen(tailLines?: number) {
    if (!this.coreCreated) {
      return Promise.resolve({ text: this.snapshotLines.slice(-(tailLines || this.rows)).join('\n').replace(/\s+$/g, ''), cols: this.cols, rows: this.rows })
    }
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

  async writeAndMeasurePaint(data: string, timeoutMs = 2000, options: { settlePendingFrame?: boolean } = {}): Promise<ThreadedTerminalPaintMeasure> {
    const previousPriority = this.priority
    let afterSeq = this.lastRenderFrame?.seq || 0
    const startedAt = nowMs()
    if (this.visible && this.priority !== 'active') this.setPriority('active')
    if (options.settlePendingFrame) {
      await this.waitForNextRenderFrame(afterSeq, 120).then((frame) => {
        afterSeq = frame.seq
      }).catch(() => undefined)
    }
    const framePromise = this.waitForNextRenderFrame(afterSeq, timeoutMs)
    this.write(data)
    try {
      const frame = await framePromise
      return {
        terminalId: this.terminalId,
        latencyMs: Math.max(0, frame.at - startedAt),
        frameMs: frame.frameMs,
        paintedRows: frame.paintedRows,
        full: Boolean(frame.full),
        fullReason: frame.fullReason,
        repaintReason: frame.repaintReason,
        scrollDeltaRows: frame.scrollDeltaRows,
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
      surfaceAttached: this.surfaceAttached,
      lastSnapshotSeq: this.lastSnapshot?.seq || 0,
      lastFrameSeq: this.lastRenderFrame?.seq || 0,
      lastFrameAt: this.lastRenderFrame?.at || 0
    }
  }

  debugSnapshot(): ThreadedTerminalHostDebugSnapshot {
    return {
      text: this.snapshotLines.join('\n').replace(/\s+$/g, ''),
      cols: this.cols,
      rows: this.rows,
      viewportY: this.buffer.active.viewportY,
      baseY: this.buffer.active.baseY,
      lines: this.snapshotScreenLines.map((line, row) => ({
        ...line,
        y: row,
        runs: cloneCellRuns(line.runs) || [],
        cells: cloneCellRuns(line.cells) || [],
        highlights: line.highlights?.map((highlight) => ({
          ...highlight,
          chars: highlight.chars ? [...highlight.chars] : undefined,
          widths: highlight.widths ? [...highlight.widths] : undefined
        })) || []
      })),
      lastFrameSeq: this.lastRenderFrame?.seq || 0
    }
  }

  fit(options: ThreadedTerminalFitOptions = {}) {
    if (!this.host) return false
    const rect = this.host.getBoundingClientRect()
    const width = Math.floor(this.host.clientWidth || rect.width || 0)
    const height = Math.floor(this.host.clientHeight || rect.height || 0)
    if (this.shouldDeferUnstableFit(width, height)) {
      if (this.lastStableFit || options.allowUnstable) this.scheduleFit()
      return false
    }
    const geometry = this.computeGeometry(width, height, options)
    this.geometry = geometry
    this.lastStableFit = { width, height, cols: geometry.cols, rows: geometry.rows }
    if (useThreadedTerminalDiagnostics()) this.logSmallGeometryDiagnostic(width, height, geometry)
    this.syncRenderSurfaceLayout(geometry)
    if (useThreadedTerminalDiagnostics()) this.logSmallLayoutDiagnostic('after-fit', geometry, width, height)
    this.resize(geometry.cols, geometry.rows)
    this.updateInputPosition()
    this.updateScrollbar()
    this.renderSelection()
    this.ensureCoreAndSurface()
    if (useThreadedTerminalDiagnostics()) this.scheduleSmallLayoutDiagnostic(geometry, width, height)
    return true
  }

  private metricsSignatureFor(settings: Pick<ThreadedTerminalOptions, 'fontFamily' | 'fontSize' | 'lineHeight'>) {
    return [settings.fontFamily || '', settings.fontSize || '', settings.lineHeight || ''].join('\u001f')
  }

  private ensureCellMetrics(force = false) {
    const signature = this.metricsSignatureFor(this.options)
    if (!force && this.cellMetricsSignature === signature && this.cellMetrics.width > 0 && this.cellMetrics.height > 0) return
    this.cellMetricsSignature = signature
    let context: CanvasRenderingContext2D | null = null
    try {
      context = document.createElement('canvas').getContext('2d')
    } catch {
      context = null
    }
    this.cellMetrics = measureTerminalCellMetrics(context, this.options)
  }

  private computeGeometry(width: number, height: number, options: ThreadedTerminalFitOptions = {}): ThreadedTerminalGeometry {
    this.ensureCellMetrics(options.forceMetrics)
    const metrics = this.cellMetrics
    const canvasWidth = Math.max(1, width - terminalScrollbarWidthPx)
    const canvasHeight = Math.max(1, height)
    const cols = Math.max(2, Math.floor(canvasWidth / metrics.width))
    const rows = Math.max(1, Math.floor(canvasHeight / metrics.height))
    const gridWidth = cols * metrics.width
    const gridHeight = rows * metrics.height
    return {
      seq: ++this.geometrySeq,
      canvasWidth,
      canvasHeight,
      cols,
      rows,
      cellWidth: metrics.width,
      cellHeight: metrics.height,
      baseline: metrics.baseline,
      paddingLeft: 0,
      paddingRight: Math.max(0, canvasWidth - gridWidth),
      paddingTop: 0,
      paddingBottom: Math.max(0, canvasHeight - gridHeight)
    }
  }

  private logSmallGeometryDiagnostic(hostWidth: number, hostHeight: number, geometry: ThreadedTerminalGeometry) {
    if (!useThreadedTerminalDiagnostics() || geometry.cols > 16) return
    const surfaceRect = this.renderSurfaceElement?.getBoundingClientRect()
    const signature = [
      geometry.cols,
      geometry.rows,
      geometry.canvasWidth,
      geometry.canvasHeight,
      geometry.cellWidth,
      geometry.cellHeight,
      geometry.paddingRight,
      geometry.paddingBottom,
      hostWidth,
      hostHeight,
      Math.round((window.devicePixelRatio || 1) * 100) / 100
    ].join(':')
    if (signature === this.lastSmallGeometryLogSignature) return
    this.lastSmallGeometryLogSignature = signature
    logThreadedTerminal('info', 'renderer.threaded-terminal.small-geometry', {
      terminalId: this.terminalId,
      sessionId: this.sessionId,
      groupId: this.groupId,
      surface: this.surface,
      hostWidth,
      hostHeight,
      canvasClientWidth: this.renderSurfaceElement?.clientWidth || 0,
      canvasClientHeight: this.renderSurfaceElement?.clientHeight || 0,
      canvasRectWidth: surfaceRect?.width || 0,
      canvasRectHeight: surfaceRect?.height || 0,
      dpr: window.devicePixelRatio || 1,
      cols: geometry.cols,
      rows: geometry.rows,
      canvasWidth: geometry.canvasWidth,
      canvasHeight: geometry.canvasHeight,
      cellWidth: geometry.cellWidth,
      cellHeight: geometry.cellHeight,
      baseline: geometry.baseline,
      paddingLeft: geometry.paddingLeft,
      paddingRight: geometry.paddingRight,
      paddingTop: geometry.paddingTop,
      paddingBottom: geometry.paddingBottom,
      fontFamily: this.options.fontFamily,
      fontSize: this.options.fontSize,
      lineHeight: this.options.lineHeight,
      ...this.logFields
    })
  }

  private roundedRectFields(rect?: DOMRect | null) {
    if (!rect) return null
    return {
      left: Math.round(rect.left * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100
    }
  }

  private elementBoxFields(element?: HTMLElement | null) {
    if (!element) return null
    const style = window.getComputedStyle(element)
    return {
      rect: this.roundedRectFields(element.getBoundingClientRect()),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      display: style.display,
      position: style.position,
      overflow: style.overflow,
      boxSizing: style.boxSizing,
      gridTemplateRows: style.gridTemplateRows,
      gridTemplateColumns: style.gridTemplateColumns,
      flex: style.flex
    }
  }

  private logSmallLayoutDiagnostic(stage: 'after-fit' | 'next-frame', geometry: ThreadedTerminalGeometry, measuredHostWidth: number, measuredHostHeight: number) {
    if (!useThreadedTerminalDiagnostics() || geometry.cols > 16 || !this.host) return
    const canvas = this.renderSurfaceElement
    const pane = this.host.closest('.terminal-pane') as HTMLElement | null
    const grid = this.host.closest('.terminal-grid') as HTMLElement | null
    const title = pane?.querySelector<HTMLElement>('.pane-title') || null
    const canvasRect = canvas?.getBoundingClientRect() || null
    const visibleCanvasWidth = canvasRect?.width || 0
    const gridPixelWidth = geometry.cols * geometry.cellWidth
    const clippedColumns = visibleCanvasWidth > 0
      ? Math.max(0, gridPixelWidth - visibleCanvasWidth) / Math.max(1, geometry.cellWidth)
      : null
    const signature = [
      stage,
      geometry.seq,
      geometry.cols,
      measuredHostWidth,
      measuredHostHeight,
      Math.round((visibleCanvasWidth || 0) * 100) / 100,
      this.host.clientWidth,
      canvas?.clientWidth || 0,
      pane?.clientWidth || 0
    ].join(':')
    if (signature === this.lastSmallLayoutLogSignature) return
    this.lastSmallLayoutLogSignature = signature
    logThreadedTerminal('info', 'renderer.threaded-terminal.small-layout', {
      terminalId: this.terminalId,
      sessionId: this.sessionId,
      groupId: this.groupId,
      surface: this.surface,
      stage,
      measuredHostWidth,
      measuredHostHeight,
      cols: geometry.cols,
      rows: geometry.rows,
      cellWidth: geometry.cellWidth,
      cellHeight: geometry.cellHeight,
      canvasWidth: geometry.canvasWidth,
      canvasHeight: geometry.canvasHeight,
      gridPixelWidth,
      gridPixelHeight: geometry.rows * geometry.cellHeight,
      paddingRight: geometry.paddingRight,
      visibleCanvasWidth,
      visibleCanvasHeight: canvasRect?.height || 0,
      clippedColumns,
      host: this.elementBoxFields(this.host),
      canvas: this.elementBoxFields(canvas),
      pane: this.elementBoxFields(pane),
      grid: this.elementBoxFields(grid),
      title: this.elementBoxFields(title),
      scrollbar: this.elementBoxFields(this.scrollbar),
      renderGroup: this.renderGroup
        ? {
            renderGroupId: this.renderGroup.renderGroupId,
            width: this.renderGroup.width,
            height: this.renderGroup.height,
            dpr: this.renderGroup.dpr,
            hosts: this.renderGroup.hosts.size,
            canvas: this.elementBoxFields(this.renderGroup.canvas)
          }
        : null,
      dpr: window.devicePixelRatio || 1,
      ...this.logFields
    })
  }

  private scheduleSmallLayoutDiagnostic(geometry: ThreadedTerminalGeometry, measuredHostWidth: number, measuredHostHeight: number) {
    if (!useThreadedTerminalDiagnostics() || geometry.cols > 16 || this.pendingSmallLayoutFrame !== null || this.disposed) return
    this.pendingSmallLayoutFrame = requestAnimationFrame(() => {
      this.pendingSmallLayoutFrame = null
      if (this.disposed || this.geometry?.seq !== geometry.seq) return
      this.logSmallLayoutDiagnostic('next-frame', geometry, measuredHostWidth, measuredHostHeight)
    })
  }

  private shouldDeferUnstableFit(width: number, height: number) {
    if (width >= terminalMinimumStableHostWidthPx && height >= terminalMinimumStableHostHeightPx) return false
    if (!this.lastStableFit) return true
    return this.lastStableFit.cols > 2 || this.lastStableFit.rows > 1
  }

  private scheduleFit() {
    if (this.pendingFitFrame !== null || this.disposed) return
    this.pendingFitFrame = requestAnimationFrame(() => {
      this.pendingFitFrame = null
      this.fit()
    })
  }

  private scheduleSurfaceAttachRetry(options: { forceGeometry?: boolean; attempts?: number } = {}) {
    if (this.disposed || !this.visible || this.surfaceAttached) return
    this.surfaceAttachRetryBudget = Math.max(this.surfaceAttachRetryBudget, options.attempts ?? 6)
    if (this.pendingSurfaceAttachFrame !== null) return
    this.pendingSurfaceAttachFrame = requestAnimationFrame(() => {
      this.pendingSurfaceAttachFrame = null
      if (this.disposed || !this.visible || this.surfaceAttached) return
      const attached = this.ensureSurfaceAttached({ forceGeometry: options.forceGeometry })
      if (attached || !this.visible || this.disposed) {
        this.surfaceAttachRetryBudget = 0
        return
      }
      this.surfaceAttachRetryBudget -= 1
      if (this.surfaceAttachRetryBudget > 0) this.scheduleSurfaceAttachRetry({ forceGeometry: options.forceGeometry, attempts: this.surfaceAttachRetryBudget })
    })
  }

  private ensureCoreAndSurface() {
    if (!this.geometry || this.disposed) return
    if (!this.coreCreated) this.createCore(this.initialData)
    if (!this.surfaceAttached && this.host && this.visible) this.attachSurface()
  }

  private canAttachRenderSurface() {
    if (!this.host || !this.visible) return false
    const resolved = resolveRenderGroupForHost(this.host, this.surface)
    if (!resolved) return false
    return isRenderableBox(this.host) && isRenderableBox(resolved.container)
  }

  private focusInput() {
    ;(this.inputElement || this.host)?.focus({ preventScroll: true })
  }

  private resetInputElement() {
    if (this.inputElement) this.inputElement.value = ''
  }

  private updateInputPosition() {
    if (!this.inputElement) return
    const cursorAbsoluteY = this.lastSnapshot?.cursorAbsoluteY ?? this.buffer.active.viewportY + this.buffer.active.cursorY
    const cursorViewportY = cursorAbsoluteY - this.buffer.active.viewportY
    const geometry = this.geometry
    const left = (geometry?.paddingLeft || 0) + Math.max(0, Math.min(this.cols - 1, this.buffer.active.cursorX)) * this.cellMetrics.width
    const top = (geometry?.paddingTop || 0) + Math.max(0, Math.min(this.rows - 1, cursorViewportY)) * this.cellMetrics.height
    this.inputElement.style.left = `${left}px`
    this.inputElement.style.top = `${top}px`
    this.inputElement.style.height = `${Math.max(1, this.cellMetrics.height)}px`
    this.inputElement.style.font = terminalFontSpec(this.options)
  }

  private async copySelectionToClipboard(event?: ClipboardEvent | KeyboardEvent) {
    const text = this.selectionText()
    if (!text) return false
    event?.preventDefault()
    event?.stopPropagation()
    if (event && 'clipboardData' in event) event.clipboardData?.setData('text/plain', text)
    await copyTextToClipboard(text)
    return true
  }

  private async pasteFromClipboard() {
    const clipboardRead = await readTextFromClipboard()
    if (clipboardRead.ok && clipboardRead.text) this.input(clipboardRead.text)
  }

  private handleKeyboardEvent(event: KeyboardEvent) {
    if (this.customKeyHandler && this.customKeyHandler(event) === false) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    if (isCopyShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      void this.copySelectionToClipboard()
      return true
    }
    if (isPasteShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      void this.pasteFromClipboard()
      return true
    }
    const input = keyEventToInput(event)
    if (!input) return false
    event.preventDefault()
    event.stopPropagation()
    this.resetInputElement()
    this.input(input)
    return true
  }

  private handleInputElementValue() {
    if (!this.inputElement || this.composing) return
    const text = this.inputElement.value
    if (!text) return
    this.resetInputElement()
    if (this.skipNextInputText && text === this.skipNextInputText) {
      this.skipNextInputText = null
      return
    }
    this.skipNextInputText = null
    this.input(text)
  }

  private emitSelectionChange() {
    this.selectionHandlers.forEach((handler) => handler())
  }

  private normalizedSelection() {
    if (!this.selection) return null
    const anchor = this.selection.anchor
    const focus = this.selection.focus
    if (anchor.x === focus.x && anchor.y === focus.y) return null
    const anchorBeforeFocus = anchor.y < focus.y || (anchor.y === focus.y && anchor.x <= focus.x)
    const start = anchorBeforeFocus ? anchor : focus
    const end = anchorBeforeFocus ? focus : anchor
    if (start.x === end.x && start.y === end.y) return null
    return { start, end }
  }

  private textForSelectionRow(row: number, startX: number, endX: number) {
    const visibleRow = row - this.buffer.active.viewportY
    const screenLine = this.snapshotScreenLines[visibleRow]
    if (screenLine?.runs?.length) {
      let text = ''
      for (const run of screenLine.runs) {
        const chars = runChars(run)
        const widths = runWidths(run)
        let cellX = run.x
        chars.forEach((char, index) => {
          const width = widths[index]
          const cellEnd = cellX + width
          if (cellEnd > startX && cellX < endX) text += char
          cellX = cellEnd
        })
      }
      return text.replace(/\s+$/g, '')
    }
    const line = this.snapshotLines[visibleRow] || ''
    const chars = Array.from(line.padEnd(Math.max(0, endX), ' '))
    return chars.slice(Math.max(0, startX), Math.max(0, endX)).join('').replace(/\s+$/g, '')
  }

  private screenLineForBufferRow(row: number) {
    return this.snapshotScreenLines[row - this.buffer.active.viewportY]
  }

  private lineTextForBufferRow(row: number) {
    return this.snapshotLines[row - this.buffer.active.viewportY] || ''
  }

  private lineCellEntriesForBufferRow(row: number) {
    const screenLine = this.screenLineForBufferRow(row)
    if (screenLine?.runs?.length) {
      const entries: Array<{ char: string; start: number; end: number }> = []
      for (const run of screenLine.runs) {
        const chars = runChars(run)
        const widths = runWidths(run)
        let cellX = run.x
        chars.forEach((char, index) => {
          const width = widths[index]
          entries.push({ char, start: cellX, end: cellX + width })
          cellX += width
        })
      }
      return entries
    }
    return Array.from(this.lineTextForBufferRow(row)).map((char, index) => ({ char, start: index, end: index + 1 }))
  }

  private charIndexAtCell(row: number, x: number) {
    const entries = this.lineCellEntriesForBufferRow(row)
    if (!entries.length) return 0
    const index = entries.findIndex((entry) => entry.end > x)
    return Math.max(0, index >= 0 ? index : entries.length - 1)
  }

  private cellXForCharIndex(row: number, charIndex: number) {
    const entries = this.lineCellEntriesForBufferRow(row)
    if (!entries.length) return Math.max(0, charIndex)
    if (charIndex <= 0) return entries[0].start
    if (charIndex >= entries.length) return entries[entries.length - 1].end
    return entries[charIndex].start
  }

  private selectionText() {
    const range = this.normalizedSelection()
    if (!range) return ''
    const lines: string[] = []
    for (let row = range.start.y; row <= range.end.y; row += 1) {
      const startX = row === range.start.y ? range.start.x : 0
      const endX = row === range.end.y ? range.end.x : this.cols
      const lineText = this.textForSelectionRow(row, startX, endX)
      if (row > range.start.y && this.screenLineForBufferRow(row)?.wrapped) {
        lines[lines.length - 1] = `${lines[lines.length - 1] || ''}${lineText}`
      } else {
        lines.push(lineText)
      }
    }
    return lines.join('\n').replace(/\s+$/g, '')
  }

  private pointFromMouseEvent(event: MouseEvent): ThreadedTerminalSelectionPoint {
    const rect = this.renderSurfaceElement?.getBoundingClientRect() || this.host?.getBoundingClientRect()
    const left = (rect?.left || 0) + (this.geometry?.paddingLeft || 0)
    const top = (rect?.top || 0) + (this.geometry?.paddingTop || 0)
    const x = Math.max(0, Math.min(this.cols, Math.floor((event.clientX - left) / Math.max(1, this.cellMetrics.width))))
    const y = Math.max(0, Math.min(this.rows - 1, Math.floor((event.clientY - top) / Math.max(1, this.cellMetrics.height))))
    return { x, y: this.buffer.active.viewportY + y }
  }

  private isWordSeparator(char: string) {
    return defaultWordSeparators.has(char)
  }

  private wordSelectionAt(point: ThreadedTerminalSelectionPoint) {
    const entries = this.lineCellEntriesForBufferRow(point.y)
    const chars = entries.map((entry) => entry.char)
    if (!chars.length) return null
    const index = this.charIndexAtCell(point.y, point.x)
    const selectedChar = chars[index]
    if (selectedChar === undefined) return null
    if (selectedChar === ' ') {
      let start = index
      let end = index + 1
      while (start > 0 && chars[start - 1] === ' ') start -= 1
      while (end < chars.length && chars[end] === ' ') end += 1
      return { start: { x: this.cellXForCharIndex(point.y, start), y: point.y }, end: { x: this.cellXForCharIndex(point.y, end), y: point.y } }
    }
    let start = index
    let end = index + 1
    while (start > 0 && !this.isWordSeparator(chars[start - 1] || '')) start -= 1
    while (end < chars.length && !this.isWordSeparator(chars[end] || '')) end += 1
    let startRow = point.y
    let endRow = point.y
    while (start === 0 && this.screenLineForBufferRow(startRow)?.wrapped) {
      const previousChars = this.lineCellEntriesForBufferRow(startRow - 1).map((entry) => entry.char)
      if (!previousChars.length || this.isWordSeparator(previousChars[previousChars.length - 1] || '')) break
      startRow -= 1
      start = previousChars.length
      while (start > 0 && !this.isWordSeparator(previousChars[start - 1] || '')) start -= 1
    }
    while (end === chars.length && this.screenLineForBufferRow(endRow + 1)?.wrapped) {
      const nextChars = this.lineCellEntriesForBufferRow(endRow + 1).map((entry) => entry.char)
      if (!nextChars.length || this.isWordSeparator(nextChars[0] || '')) break
      endRow += 1
      end = 0
      while (end < nextChars.length && !this.isWordSeparator(nextChars[end] || '')) end += 1
    }
    return {
      start: { x: this.cellXForCharIndex(startRow, start), y: startRow },
      end: { x: this.cellXForCharIndex(endRow, end), y: endRow }
    }
  }

  private paragraphSelectionAt(point: ThreadedTerminalSelectionPoint) {
    let startRow = point.y
    let endRow = point.y
    while (startRow > this.buffer.active.viewportY && this.screenLineForBufferRow(startRow)?.wrapped) startRow -= 1
    const viewportEnd = this.buffer.active.viewportY + this.rows - 1
    while (endRow < viewportEnd && this.screenLineForBufferRow(endRow + 1)?.wrapped) endRow += 1
    return { start: { x: 0, y: startRow }, end: { x: this.cols, y: endRow } }
  }

  private expandSelectionPoint(point: ThreadedTerminalSelectionPoint, mode: ThreadedTerminalSelectionMode) {
    if (mode === 'word') return this.wordSelectionAt(point)
    if (mode === 'line') return this.paragraphSelectionAt(point)
    return { start: point, end: point }
  }

  private updateActiveSelectionFocus(point: ThreadedTerminalSelectionPoint) {
    if (!this.selection) return
    if (this.selection.mode === 'char') {
      this.selection.focus = point
      return
    }
    const origin = this.selection.origin || this.selection.anchor
    const originRange = this.expandSelectionPoint(origin, this.selection.mode)
    const focusRange = this.expandSelectionPoint(point, this.selection.mode)
    if (!originRange || !focusRange) return
    const focusBeforeOrigin = point.y < origin.y || (point.y === origin.y && point.x < origin.x)
    this.selection.anchor = focusBeforeOrigin ? originRange.end : originRange.start
    this.selection.focus = focusBeforeOrigin ? focusRange.start : focusRange.end
  }

  private beginSelection(point: ThreadedTerminalSelectionPoint, mode: ThreadedTerminalSelectionMode) {
    const range = this.expandSelectionPoint(point, mode)
    if (!range) {
      this.selection = null
      return
    }
    this.selection = {
      anchor: range.start,
      focus: range.end,
      selecting: true,
      mode,
      origin: point
    }
  }

  private renderSelection() {
    if (!this.selectionLayer) return
    this.selectionLayer.replaceChildren()
    const range = this.normalizedSelection()
    if (!range) return
    const viewportY = this.buffer.active.viewportY
    const firstRow = Math.max(range.start.y, viewportY)
    const lastRow = Math.min(range.end.y, viewportY + this.rows - 1)
    if (lastRow < firstRow) return
    const color = this.theme.selectionBackground || '#2d4059'
    for (let row = firstRow; row <= lastRow; row += 1) {
      const startX = row === range.start.y ? range.start.x : 0
      const endX = row === range.end.y ? range.end.x : this.cols
      if (endX <= startX) continue
      const rect = document.createElement('div')
      rect.className = 'threaded-terminal-selection-rect'
      rect.style.position = 'absolute'
      rect.style.left = `${(this.geometry?.paddingLeft || 0) + startX * this.cellMetrics.width}px`
      rect.style.top = `${(this.geometry?.paddingTop || 0) + (row - viewportY) * this.cellMetrics.height}px`
      rect.style.width = `${(endX - startX) * this.cellMetrics.width}px`
      rect.style.height = `${this.cellMetrics.height}px`
      rect.style.background = color
      this.selectionLayer.appendChild(rect)
    }
  }

  private updateScrollbar() {
    if (!this.scrollbar) return
    const max = Math.max(0, this.buffer.active.baseY)
    const value = Math.max(0, Math.min(max, this.buffer.active.viewportY))
    this.scrollbar.setAttribute('aria-valuemax', String(max))
    this.scrollbar.setAttribute('aria-valuenow', String(value))
    this.scrollbar.dataset.max = String(max)
    this.scrollbar.dataset.value = String(value)
    this.applyScrollbarTheme()
    if (!this.scrollbarThumb) return
    const trackHeight = Math.max(1, this.scrollbar.clientHeight - 6)
    const totalRows = Math.max(this.rows, max + this.rows)
    const thumbHeight = max > 0 ? Math.max(terminalScrollbarThumbMinPx, Math.floor((this.rows / totalRows) * trackHeight)) : 0
    const travel = Math.max(0, trackHeight - thumbHeight)
    const top = max > 0 && travel > 0 ? Math.round((value / max) * travel) + 3 : 3
    this.scrollbarThumb.style.height = `${thumbHeight}px`
    this.scrollbarThumb.style.transform = `translateY(${top - 3}px)`
    this.scrollbarThumb.style.opacity = max > 0 ? '1' : '0'
  }

  private applyScrollbarTheme() {
    if (!this.scrollbar) return
    this.scrollbar.style.background = this.theme.scrollbarTrack || 'rgb(43 50 66 / 0.4)'
    if (this.scrollbarThumb) {
      const hovering = this.scrollbarThumb.dataset.hover === '1' || this.scrollbarThumb.dataset.dragging === '1'
      this.scrollbarThumb.style.background = hovering
        ? this.theme.scrollbarThumbHover || this.theme.cursor
        : this.theme.scrollbarThumb || 'rgb(137 147 168 / 0.68)'
    }
  }

  private scrollLineFromTrackPosition(clientY: number) {
    if (!this.scrollbar || !this.scrollbarThumb) return this.buffer.active.viewportY
    const max = Math.max(0, this.buffer.active.baseY)
    if (!max) return 0
    const rect = this.scrollbar.getBoundingClientRect()
    const trackHeight = Math.max(1, rect.height - 6)
    const thumbHeight = Math.max(terminalScrollbarThumbMinPx, this.scrollbarThumb.offsetHeight || terminalScrollbarThumbMinPx)
    const travel = Math.max(1, trackHeight - thumbHeight)
    const y = Math.max(0, Math.min(travel, clientY - rect.top - 3 - thumbHeight / 2))
    return Math.round((y / travel) * max)
  }

  private scrollLineFromDrag(event: MouseEvent) {
    if (!this.scrollbarDrag) return this.buffer.active.viewportY
    const travel = Math.max(1, this.scrollbarDrag.trackHeight - this.scrollbarDrag.thumbHeight)
    const delta = event.clientY - this.scrollbarDrag.startClientY
    return Math.round(this.scrollbarDrag.startViewportY + (delta / travel) * this.scrollbarDrag.max)
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
      theme: cloneTheme(this.theme),
      keywordHighlight: cloneKeywordHighlightConfig(this.keywordHighlight)
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

  private attachSurface() {
    if (!this.host || this.surfaceAttached) return
    const capability = threadedTerminalCapability()
    if (!capability.supported) throw new Error(capability.reason || 'threaded terminal unsupported')
    if (!this.canAttachRenderSurface()) {
      this.scheduleFit()
      return
    }
    if (!this.geometry) {
      if (!this.fit()) return
      if (this.surfaceAttached) return
    }
    const geometry = this.geometry
    if (!geometry) return
    const group = ensureRenderGroup(this.host, this.surface)
    if (!group) {
      this.scheduleFit()
      return
    }
    const rect = rectForHostInGroup(this.host, group)
    this.renderGroup = group
    group.hosts.add(this.terminalId)
    removeHostFromOtherRenderGroups(this.terminalId, group.renderGroupId)
    this.surfaceAttached = true
    this.lastSurfaceLayout = {
      renderGroupId: group.renderGroupId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      geometrySeq: geometry.seq
    }
    logThreadedTerminal('debug', 'renderer.threaded-terminal.surface-attach', {
      terminalId: this.terminalId,
      sessionId: this.sessionId,
      groupId: this.groupId,
      surface: this.surface,
      renderGroupId: group.renderGroupId,
      rect,
      cols: geometry.cols,
      rows: geometry.rows,
      hasSnapshot: Boolean(this.lastSnapshot),
      visible: this.visible,
      ...this.logFields
    })
    postRender({
      type: 'attach',
      options: {
        terminalId: this.terminalId,
        groupId: this.groupId,
        renderGroupId: group.renderGroupId,
        rect,
        settings: renderSettingsFor(normalizeSettings(this.options), this.theme),
        geometry
      }
    })
    if (this.lastSnapshot && this.visible) {
      postRender({
        type: 'screen',
        snapshot: this.fullSnapshotFromCache('visibility')
      })
    }
  }

  private bindDomEvents() {
    if (!this.host) return
    const host = this.host
    const inputElement = this.inputElement
    this.eventController?.abort()
    this.eventController = new AbortController()
    const signal = this.eventController.signal
    host.addEventListener('focus', () => this.focusInput(), { signal })
    host.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement | null)?.closest?.('.threaded-terminal-scrollbar')) return
      event.preventDefault()
      this.focusInput()
      const point = this.pointFromMouseEvent(event)
      const mode: ThreadedTerminalSelectionMode = event.detail >= 3 ? 'line' : event.detail === 2 ? 'word' : 'char'
      this.beginSelection(point, mode)
      this.renderSelection()
      this.emitSelectionChange()
    }, { signal })
    host.addEventListener('mousemove', (event) => {
      if (!this.selection?.selecting) return
      event.preventDefault()
      this.updateActiveSelectionFocus(this.pointFromMouseEvent(event))
      this.renderSelection()
      this.emitSelectionChange()
    }, { signal })
    window.addEventListener('mouseup', (event) => {
      if (this.scrollbarDrag) {
        this.scrollbarDrag = null
        if (this.scrollbarThumb) {
          delete this.scrollbarThumb.dataset.dragging
          this.applyScrollbarTheme()
        }
        return
      }
      if (!this.selection?.selecting) return
      this.updateActiveSelectionFocus(this.pointFromMouseEvent(event))
      this.selection.selecting = false
      this.renderSelection()
      this.emitSelectionChange()
    }, { signal })
    host.addEventListener('copy', (event) => {
      void this.copySelectionToClipboard(event)
    }, { signal })
    const handleKeydown = (event: KeyboardEvent) => {
      this.handleKeyboardEvent(event)
    }
    host.addEventListener('keydown', handleKeydown, { signal })
    inputElement?.addEventListener('keydown', handleKeydown, { signal })
    host.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') || ''
      if (!text) return
      event.preventDefault()
      this.resetInputElement()
      this.input(text)
    }, { signal })
    inputElement?.addEventListener('compositionstart', () => {
      this.composing = true
      this.skipNextInputText = null
    }, { signal })
    inputElement?.addEventListener('compositionend', (event) => {
      this.composing = false
      const text = event.data || inputElement.value
      this.resetInputElement()
      if (text) {
        this.skipNextInputText = text
        this.input(text)
      }
    }, { signal })
    inputElement?.addEventListener('input', () => {
      this.handleInputElementValue()
    }, { signal })
    this.scrollbar?.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      this.focusInput()
      const max = Math.max(0, this.buffer.active.baseY)
      if (!max) return
      if ((event.target as HTMLElement | null)?.classList.contains('threaded-terminal-scrollbar-thumb')) {
        const trackHeight = Math.max(1, (this.scrollbar?.clientHeight || 1) - 6)
        const thumbHeight = Math.max(terminalScrollbarThumbMinPx, this.scrollbarThumb?.offsetHeight || terminalScrollbarThumbMinPx)
        this.scrollbarDrag = {
          startClientY: event.clientY,
          startViewportY: this.buffer.active.viewportY,
          max,
          trackHeight,
          thumbHeight
        }
        if (this.scrollbarThumb) {
          this.scrollbarThumb.dataset.dragging = '1'
          this.applyScrollbarTheme()
        }
        return
      }
      this.scrollToLine(this.scrollLineFromTrackPosition(event.clientY))
    }, { signal })
    this.scrollbarThumb?.addEventListener('mouseenter', () => {
      if (!this.scrollbarThumb) return
      this.scrollbarThumb.dataset.hover = '1'
      this.applyScrollbarTheme()
    }, { signal })
    this.scrollbarThumb?.addEventListener('mouseleave', () => {
      if (!this.scrollbarThumb) return
      delete this.scrollbarThumb.dataset.hover
      this.applyScrollbarTheme()
    }, { signal })
    window.addEventListener('mousemove', (event) => {
      if (!this.scrollbarDrag) return
      event.preventDefault()
      this.scrollToLine(Math.max(0, Math.min(this.scrollbarDrag.max, this.scrollLineFromDrag(event))))
    }, { signal })
    host.addEventListener('wheel', (event) => {
      const lineHeight = Math.max(1, Number(this.options.fontSize || 12) * Number(this.options.lineHeight || 1))
      const deltaRows = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * Math.max(1, this.rows - 1)
          : event.deltaY / lineHeight
      const rows = Math.trunc(deltaRows)
      if (!rows) return
      event.preventDefault()
      this.scrollLines(rows)
    }, { passive: false, signal })
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleFit())
      this.resizeObserver.observe(host)
    }
  }

  private syncRenderSurfaceLayout(geometry = this.geometry) {
    if (!this.host || !this.surfaceAttached) return
    if (!geometry) return
    if (!this.canAttachRenderSurface()) {
      this.scheduleFit()
      return
    }
    const group = ensureRenderGroup(this.host, this.surface)
    if (!group) {
      this.markSurfaceDetachedByRenderGroup(this.lastSurfaceLayout?.renderGroupId || this.renderGroup?.renderGroupId || '')
      this.scheduleFit()
      return
    }
    if (!this.surfaceAttached) {
      this.attachSurface()
      return
    }
    const rect = rectForHostInGroup(this.host, group)
    this.renderGroup = group
    if (
      this.lastSurfaceLayout &&
      this.lastSurfaceLayout.renderGroupId === group.renderGroupId &&
      this.lastSurfaceLayout.x === rect.x &&
      this.lastSurfaceLayout.y === rect.y &&
      this.lastSurfaceLayout.width === rect.width &&
      this.lastSurfaceLayout.height === rect.height &&
      this.lastSurfaceLayout.geometrySeq === geometry.seq
    ) {
      return
    }
    this.lastSurfaceLayout = {
      renderGroupId: group.renderGroupId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      geometrySeq: geometry.seq
    }
    postRender({
      type: 'resize',
      terminalId: this.terminalId,
      rect,
      geometry
    })
  }

  private fullSnapshotFromCache(reason: ThreadedTerminalFullReason): ThreadedTerminalScreenSnapshot {
    const snapshot = this.lastSnapshot
    const rows = snapshot?.rows || this.rows
    const lines = Array.from({ length: rows }, (_item, row) => ({
      y: row,
      text: this.snapshotLines[row] || '',
      runs: cloneCellRuns(this.snapshotScreenLines[row]?.runs) || [],
      cells: cloneCellRuns(this.snapshotScreenLines[row]?.cells) || [],
      highlights: this.snapshotScreenLines[row]?.highlights?.map((highlight) => ({ ...highlight, chars: highlight.chars ? [...highlight.chars] : undefined, widths: highlight.widths ? [...highlight.widths] : undefined })) || [],
      wrapped: this.snapshotScreenLines[row]?.wrapped
    }))
    return {
      terminalId: this.terminalId,
      seq: snapshot?.seq || 0,
      cols: snapshot?.cols || this.cols,
      rows,
      cursorX: snapshot?.cursorX || this.buffer.active.cursorX,
      cursorY: snapshot?.cursorY || this.buffer.active.cursorY,
      cursorAbsoluteY: snapshot?.cursorAbsoluteY,
      viewportY: snapshot?.viewportY || this.buffer.active.viewportY,
      baseY: snapshot?.baseY || this.buffer.active.viewportY,
      lines,
      dirtyRows: lines.map((line) => line.y),
      full: true,
      fullReason: reason,
      repaintReason: reason,
      scrollDeltaRows: 0,
      visible: this.visible,
      priority: this.priority
    }
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
    renderGroups: Array.from(renderGroupMap.values()).map((group) => ({
      renderGroupId: group.renderGroupId,
      surface: group.surface,
      hosts: group.hosts.size,
      attached: group.attached,
      requestedBackend: group.requestedBackend,
      backend: group.backend,
      gpu: group.gpu,
      width: group.width,
      height: group.height,
      dpr: group.dpr
    })),
    renderDebug: { ...renderDebug },
    hostCount: hostMap.size,
    hosts: Array.from(hostMap.values()).map((host) => host.debugInfo())
  }
}

if (typeof window !== 'undefined') {
  window.__AIOPSTERM_THREADED_TERMINAL_DEBUG__ = {
    stats: getThreadedTerminalDebugStats
  }
}
