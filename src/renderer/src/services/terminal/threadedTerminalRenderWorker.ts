import type {
  ThreadedTerminalRenderRequest,
  ThreadedTerminalRenderResponse,
  ThreadedTerminalRenderSettings,
  ThreadedTerminalScreenLine,
  ThreadedTerminalScreenSnapshot
} from '@/services/terminal/threadedTerminalProtocol'

type DedicatedWorkerScopeLike = {
  onmessage: ((event: MessageEvent<ThreadedTerminalRenderRequest>) => void) | null
  postMessage: (message: ThreadedTerminalRenderResponse) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

type RenderSurface = {
  terminalId: string
  groupId: string
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  width: number
  height: number
  dpr: number
  settings: ThreadedTerminalRenderSettings
  cellWidth: number
  cellHeight: number
  baseline: number
  visible: boolean
  frames: number
  totalFrameMs: number
  maxFrameMs: number
  skippedFrames: number
  lastPerfAt: number
  pendingSnapshot: ThreadedTerminalScreenSnapshot | null
  lastPaintAt: number
}

const workerScope = self as unknown as DedicatedWorkerScopeLike
const surfaces = new Map<string, RenderSurface>()
const perfIntervalMs = 1000
const frameIntervalMs = 16
const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
let frameTimer: ReturnType<typeof setTimeout> | null = null

const post = (message: ThreadedTerminalRenderResponse) => workerScope.postMessage(message)

const fontSpec = (settings: ThreadedTerminalRenderSettings, bold = false, italic = false) => {
  const weight = bold ? '700' : '400'
  const style = italic ? 'italic ' : ''
  return `${style}${weight} ${Math.max(8, settings.fontSize)}px ${settings.fontFamily || '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'}`
}

const configureMetrics = (surface: RenderSurface) => {
  const context = surface.context
  context.font = fontSpec(surface.settings)
  context.textBaseline = 'alphabetic'
  const metrics = context.measureText('W')
  surface.cellWidth = Math.max(4, Math.ceil(metrics.width || surface.settings.fontSize * 0.62))
  surface.cellHeight = Math.max(10, Math.ceil(surface.settings.fontSize * (surface.settings.lineHeight || 1)))
  surface.baseline = Math.max(8, Math.floor(surface.cellHeight * 0.78))
}

const resizeCanvas = (surface: RenderSurface, width: number, height: number, dpr: number) => {
  surface.width = Math.max(1, Math.floor(width))
  surface.height = Math.max(1, Math.floor(height))
  surface.dpr = Math.max(1, dpr || 1)
  const pixelWidth = Math.max(1, Math.floor(surface.width * surface.dpr))
  const pixelHeight = Math.max(1, Math.floor(surface.height * surface.dpr))
  if (surface.canvas.width !== pixelWidth) surface.canvas.width = pixelWidth
  if (surface.canvas.height !== pixelHeight) surface.canvas.height = pixelHeight
  surface.context.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0)
  configureMetrics(surface)
}

const fillBackground = (surface: RenderSurface, row?: number) => {
  const context = surface.context
  context.fillStyle = surface.settings.theme.background
  if (typeof row === 'number') {
    context.fillRect(0, row * surface.cellHeight, surface.width, surface.cellHeight)
  } else {
    context.fillRect(0, 0, surface.width, surface.height)
  }
}

const drawText = (
  surface: RenderSurface,
  text: string,
  x: number,
  row: number,
  options: { fg?: string; bold?: boolean; italic?: boolean; underline?: boolean } = {}
) => {
  if (!text) return
  const context = surface.context
  context.font = fontSpec(surface.settings, options.bold, options.italic)
  context.fillStyle = options.fg || surface.settings.theme.foreground
  const left = x * surface.cellWidth
  const top = row * surface.cellHeight
  context.fillText(text, left, top + surface.baseline)
  if (options.underline) {
    context.fillRect(left, top + surface.cellHeight - 2, Math.max(surface.cellWidth, context.measureText(text).width), 1)
  }
}

const drawStyledRuns = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  const context = surface.context
  for (const run of line.cells || []) {
    if (run.bg) {
      context.fillStyle = run.bg
      context.fillRect(run.x * surface.cellWidth, line.y * surface.cellHeight, Math.max(surface.cellWidth, run.text.length * surface.cellWidth), surface.cellHeight)
    }
    drawText(surface, run.text, run.x, line.y, {
      fg: run.fg,
      bold: run.bold,
      italic: run.italic,
      underline: run.underline
    })
  }
}

const drawCursor = (surface: RenderSurface, snapshot: ThreadedTerminalScreenSnapshot) => {
  if (snapshot.cursorY < 0 || snapshot.cursorY >= snapshot.rows) return
  const context = surface.context
  const x = snapshot.cursorX * surface.cellWidth
  const y = snapshot.cursorY * surface.cellHeight
  context.fillStyle = surface.settings.theme.cursor
  if (surface.settings.cursorStyle === 'bar') {
    context.fillRect(x, y + 2, 2, Math.max(2, surface.cellHeight - 4))
  } else if (surface.settings.cursorStyle === 'underline') {
    context.fillRect(x, y + surface.cellHeight - 3, surface.cellWidth, 2)
  } else {
    context.globalAlpha = 0.72
    context.fillRect(x, y + 1, surface.cellWidth, Math.max(2, surface.cellHeight - 2))
    context.globalAlpha = 1
  }
}

const emitPerfIfDue = (surface: RenderSurface, force = false) => {
  const now = nowMs()
  if (!force && now - surface.lastPerfAt < perfIntervalMs) return
  if (!surface.frames && !surface.skippedFrames && !force) return
  post({
    type: 'perf',
    terminalId: surface.terminalId,
    frames: surface.frames,
    avgFrameMs: surface.frames ? surface.totalFrameMs / surface.frames : 0,
    maxFrameMs: surface.maxFrameMs,
    skippedFrames: surface.skippedFrames
  })
  surface.frames = 0
  surface.totalFrameMs = 0
  surface.maxFrameMs = 0
  surface.skippedFrames = 0
  surface.lastPerfAt = now
}

const paintSnapshot = (surface: RenderSurface, snapshot: ThreadedTerminalScreenSnapshot) => {
  if (!surface.visible || !snapshot.visible) {
    surface.skippedFrames += 1
    emitPerfIfDue(surface)
    return
  }
  const startedAt = nowMs()
  const context = surface.context
  context.save()
  context.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0)
  if (snapshot.full) fillBackground(surface)
  for (const line of snapshot.lines) {
    fillBackground(surface, line.y)
    context.font = fontSpec(surface.settings)
    drawText(surface, line.text, 0, line.y)
    drawStyledRuns(surface, line)
  }
  drawCursor(surface, snapshot)
  context.restore()
  const frameMs = nowMs() - startedAt
  surface.frames += 1
  surface.totalFrameMs += frameMs
  surface.maxFrameMs = Math.max(surface.maxFrameMs, frameMs)
  post({ type: 'frame', terminalId: surface.terminalId, seq: snapshot.seq, frameMs, paintedRows: snapshot.lines.length })
  emitPerfIfDue(surface)
}

const flushPendingPaint = (surface: RenderSurface) => {
  if (!surface.pendingSnapshot) return
  const snapshot = surface.pendingSnapshot
  surface.pendingSnapshot = null
  surface.lastPaintAt = nowMs()
  paintSnapshot(surface, snapshot)
}

const flushFrame = () => {
  frameTimer = null
  surfaces.forEach((surface) => {
    if (!surface.pendingSnapshot) return
    flushPendingPaint(surface)
  })
  if (Array.from(surfaces.values()).some((surface) => surface.pendingSnapshot)) scheduleFrame()
}

const scheduleFrame = () => {
  if (frameTimer) return
  frameTimer = workerScope.setTimeout(flushFrame, frameIntervalMs)
}

const schedulePaintSnapshot = (surface: RenderSurface, snapshot: ThreadedTerminalScreenSnapshot) => {
  surface.pendingSnapshot = snapshot
  scheduleFrame()
}

const terminalIdForMessage = (message: ThreadedTerminalRenderRequest) => {
  if (message.type === 'screen') return message.snapshot.terminalId
  if ('terminalId' in message) return message.terminalId
  return undefined
}

const handleMessage = (message: ThreadedTerminalRenderRequest) => {
  try {
    if (message.type === 'ping') {
      post({ type: 'pong', requestId: message.requestId })
      return
    }
    if (message.type === 'attach') {
      const context = message.options.canvas.getContext('2d', { alpha: true })
      if (!context) {
        post({ type: 'error', terminalId: message.options.terminalId, message: '2D OffscreenCanvas context unavailable.' })
        return
      }
      const surface: RenderSurface = {
        terminalId: message.options.terminalId,
        groupId: message.options.groupId,
        canvas: message.options.canvas,
        context,
        width: message.options.width,
        height: message.options.height,
        dpr: message.options.devicePixelRatio,
        settings: message.options.settings,
        cellWidth: 8,
        cellHeight: 16,
        baseline: 12,
        visible: true,
        frames: 0,
        totalFrameMs: 0,
        maxFrameMs: 0,
        skippedFrames: 0,
        lastPerfAt: nowMs(),
        pendingSnapshot: null,
        lastPaintAt: 0
      }
      surfaces.set(surface.terminalId, surface)
      resizeCanvas(surface, message.options.width, message.options.height, message.options.devicePixelRatio)
      fillBackground(surface)
      post({ type: 'attached', terminalId: surface.terminalId })
      return
    }
    const terminalId = terminalIdForMessage(message)
    const surface = terminalId ? surfaces.get(terminalId) : undefined
    if (!surface) {
      if (message.type === 'screen' || message.type === 'visibility' || message.type === 'dispose') return
      post({ type: 'error', terminalId, message: 'Render surface not found.' })
      return
    }
    if (message.type === 'resize') {
      if (surface.pendingSnapshot) flushPendingPaint(surface)
      resizeCanvas(surface, message.width, message.height, message.devicePixelRatio)
      fillBackground(surface)
      return
    }
    if (message.type === 'settings') {
      if (surface.pendingSnapshot) flushPendingPaint(surface)
      surface.settings = message.settings
      configureMetrics(surface)
      fillBackground(surface)
      return
    }
    if (message.type === 'screen') {
      schedulePaintSnapshot(surface, message.snapshot)
      return
    }
    if (message.type === 'visibility') {
      surface.visible = message.visible
      return
    }
    if (message.type === 'clear') {
      surface.pendingSnapshot = null
      fillBackground(surface)
      return
    }
    if (message.type === 'dispose') {
      surface.pendingSnapshot = null
      emitPerfIfDue(surface, true)
      surfaces.delete(surface.terminalId)
      if (!surfaces.size && frameTimer) {
        workerScope.clearTimeout(frameTimer)
        frameTimer = null
      }
    }
  } catch (error) {
    post({
      type: 'error',
      terminalId: 'terminalId' in message ? message.terminalId : undefined,
      requestId: 'requestId' in message ? message.requestId : undefined,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

workerScope.onmessage = (event: MessageEvent<ThreadedTerminalRenderRequest>) => handleMessage(event.data)
post({ type: 'ready' })
