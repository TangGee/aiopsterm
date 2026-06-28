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
  screenLines: ThreadedTerminalScreenLine[]
  lastSnapshot: ThreadedTerminalScreenSnapshot | null
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
  const nextWidth = Math.max(1, Math.floor(width))
  const nextHeight = Math.max(1, Math.floor(height))
  const nextDpr = Math.max(1, dpr || 1)
  const changed = surface.width !== nextWidth || surface.height !== nextHeight || surface.dpr !== nextDpr
  surface.width = nextWidth
  surface.height = nextHeight
  surface.dpr = nextDpr
  const pixelWidth = Math.max(1, Math.floor(surface.width * surface.dpr))
  const pixelHeight = Math.max(1, Math.floor(surface.height * surface.dpr))
  if (surface.canvas.width !== pixelWidth) surface.canvas.width = pixelWidth
  if (surface.canvas.height !== pixelHeight) surface.canvas.height = pixelHeight
  surface.context.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0)
  configureMetrics(surface)
  return changed
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

const drawTextCells = (
  surface: RenderSurface,
  text: string,
  x: number,
  row: number,
  options: { fg?: string; bold?: boolean; italic?: boolean; underline?: boolean } = {}
) => {
  if (!text) return
  const chars = Array.from(text)
  const context = surface.context
  context.font = fontSpec(surface.settings, options.bold, options.italic)
  context.fillStyle = options.fg || surface.settings.theme.foreground
  const top = row * surface.cellHeight
  chars.forEach((char, index) => {
    if (char === ' ') return
    context.fillText(char, (x + index) * surface.cellWidth, top + surface.baseline)
  })
  if (options.underline) {
    context.fillRect(x * surface.cellWidth, top + surface.cellHeight - 2, Math.max(surface.cellWidth, chars.length * surface.cellWidth), 1)
  }
}

const drawStyledRuns = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  const context = surface.context
  for (const run of line.cells || []) {
    if (run.bg) {
      context.fillStyle = run.bg
      context.fillRect(run.x * surface.cellWidth, line.y * surface.cellHeight, Math.max(surface.cellWidth, run.text.length * surface.cellWidth), surface.cellHeight)
    }
  }
  for (const run of line.cells || []) {
    drawTextCells(surface, run.text, run.x, line.y, {
      fg: run.fg,
      bold: run.bold,
      italic: run.italic,
      underline: run.underline
    })
  }
}

const drawHighlightRuns = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  for (const run of line.highlights || []) {
    drawTextCells(surface, run.text, run.x, line.y, {
      fg: run.fg,
      bold: run.bold
    })
  }
}

const drawPlainLineText = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  const text = line.text || ''
  if (!text) return
  const styledCells = new Set<number>()
  for (const run of line.cells || []) {
    for (let index = 0; index < Array.from(run.text).length; index += 1) styledCells.add(run.x + index)
  }
  if (!styledCells.size) {
    drawTextCells(surface, text, 0, line.y)
    return
  }
  let segment = ''
  let segmentStart = 0
  Array.from(text).forEach((char, index) => {
    if (styledCells.has(index)) {
      if (segment) {
        drawTextCells(surface, segment, segmentStart, line.y)
        segment = ''
      }
      return
    }
    if (!segment) segmentStart = index
    segment += char
  })
  if (segment) drawTextCells(surface, segment, segmentStart, line.y)
}

const charAtCell = (line: ThreadedTerminalScreenLine | undefined, x: number) => {
  if (!line) return ' '
  const chars = Array.from(line.text || '')
  return chars[x] || ' '
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
    context.fillRect(x, y + 1, surface.cellWidth, Math.max(2, surface.cellHeight - 2))
    drawTextCells(surface, charAtCell(surface.screenLines[snapshot.cursorY], snapshot.cursorX), snapshot.cursorX, snapshot.cursorY, { fg: surface.settings.theme.background })
  }
}

const blankScreenLine = (y: number): ThreadedTerminalScreenLine => ({ y, text: '', cells: [] })

const normalizeScreenLineRows = (lines: ThreadedTerminalScreenLine[]) => {
  lines.forEach((line, index) => {
    line.y = index
  })
  return lines
}

const cloneScreenLine = (line: ThreadedTerminalScreenLine, y = line.y): ThreadedTerminalScreenLine => ({
  ...line,
  y,
  cells: line.cells ? line.cells.map((cell) => ({ ...cell })) : undefined,
  highlights: line.highlights ? line.highlights.map((highlight) => ({ ...highlight })) : undefined
})

const rememberPaintedSnapshot = (surface: RenderSurface, snapshot: ThreadedTerminalScreenSnapshot) => {
  const scrollDeltaRows = snapshot.scrollDeltaRows || 0
  if (snapshot.full || !surface.lastSnapshot || Math.abs(scrollDeltaRows) >= snapshot.rows) {
    surface.screenLines = Array.from({ length: snapshot.rows }, (_item, row) => blankScreenLine(row))
  } else {
    if (surface.screenLines.length < snapshot.rows) {
      surface.screenLines.push(...Array.from({ length: snapshot.rows - surface.screenLines.length }, (_item, row) => blankScreenLine(surface.screenLines.length + row)))
    } else if (surface.screenLines.length > snapshot.rows) {
      surface.screenLines = surface.screenLines.slice(0, snapshot.rows)
    }
    if (scrollDeltaRows > 0) {
      surface.screenLines = surface.screenLines.slice(scrollDeltaRows).concat(Array.from({ length: scrollDeltaRows }, (_item, row) => blankScreenLine(snapshot.rows - scrollDeltaRows + row)))
    } else if (scrollDeltaRows < 0) {
      const movedRows = Math.max(0, snapshot.rows + scrollDeltaRows)
      surface.screenLines = Array.from({ length: Math.abs(scrollDeltaRows) }, (_item, row) => blankScreenLine(row)).concat(surface.screenLines.slice(0, movedRows))
    }
    normalizeScreenLineRows(surface.screenLines)
  }
  for (const line of snapshot.lines) {
    if (line.y >= 0 && line.y < snapshot.rows) surface.screenLines[line.y] = cloneScreenLine(line)
  }
  normalizeScreenLineRows(surface.screenLines)
  surface.lastSnapshot = {
    ...snapshot,
    full: true,
    fullReason: snapshot.fullReason,
    repaintReason: snapshot.repaintReason,
    scrollDeltaRows: 0,
    lines: surface.screenLines.map((line, row) => cloneScreenLine(line, row)),
    dirtyRows: surface.screenLines.map((_line, row) => row)
  }
}

const scrollSurface = (surface: RenderSurface, deltaRows: number) => {
  if (!deltaRows || Math.abs(deltaRows) >= Math.max(1, Math.floor(surface.height / surface.cellHeight))) return false
  const context = surface.context
  const deltaY = Math.round(deltaRows * surface.cellHeight * surface.dpr) / surface.dpr
  const pixelWidth = surface.canvas.width
  const pixelDeltaY = Math.round(Math.abs(deltaY) * surface.dpr)
  if (deltaRows > 0) {
    const sourcePixelHeight = Math.max(0, surface.canvas.height - pixelDeltaY)
    if (sourcePixelHeight > 0) context.drawImage(surface.canvas, 0, pixelDeltaY, pixelWidth, sourcePixelHeight, 0, 0, surface.width, sourcePixelHeight / surface.dpr)
  } else {
    const sourcePixelHeight = Math.max(0, surface.canvas.height - pixelDeltaY)
    if (sourcePixelHeight > 0) context.drawImage(surface.canvas, 0, 0, pixelWidth, sourcePixelHeight, 0, pixelDeltaY / surface.dpr, surface.width, sourcePixelHeight / surface.dpr)
  }
  return true
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
  else if (snapshot.scrollDeltaRows) scrollSurface(surface, snapshot.scrollDeltaRows)
  for (const line of snapshot.lines) {
    fillBackground(surface, line.y)
    context.font = fontSpec(surface.settings)
    drawPlainLineText(surface, line)
    drawStyledRuns(surface, line)
    drawHighlightRuns(surface, line)
  }
  rememberPaintedSnapshot(surface, snapshot)
  drawCursor(surface, snapshot)
  context.restore()
  const frameMs = nowMs() - startedAt
  surface.frames += 1
  surface.totalFrameMs += frameMs
  surface.maxFrameMs = Math.max(surface.maxFrameMs, frameMs)
  post({
    type: 'frame',
    terminalId: surface.terminalId,
    seq: snapshot.seq,
    frameMs,
    paintedRows: snapshot.lines.length,
    full: snapshot.full,
    fullReason: snapshot.fullReason,
    repaintReason: snapshot.repaintReason,
    scrollDeltaRows: snapshot.scrollDeltaRows
  })
  emitPerfIfDue(surface)
}

const repaintLastSnapshot = (surface: RenderSurface, reason: ThreadedTerminalScreenSnapshot['fullReason']) => {
  if (!surface.lastSnapshot) {
    fillBackground(surface)
    return
  }
  paintSnapshot(surface, {
    ...surface.lastSnapshot,
    full: true,
    fullReason: reason,
    scrollDeltaRows: 0,
    repaintReason: reason,
    lines: surface.lastSnapshot.lines
  })
}

const expandSnapshotForRepaint = (surface: RenderSurface, snapshot: ThreadedTerminalScreenSnapshot, reason: ThreadedTerminalScreenSnapshot['fullReason']): ThreadedTerminalScreenSnapshot => {
  if (snapshot.full || !surface.lastSnapshot) return snapshot
  const baseLines = surface.lastSnapshot.lines.map((line, row) => cloneScreenLine(line, row))
  const scrollDeltaRows = snapshot.scrollDeltaRows || 0
  let nextLines = baseLines
  if (Math.abs(scrollDeltaRows) >= snapshot.rows) {
    nextLines = Array.from({ length: snapshot.rows }, (_item, row) => blankScreenLine(row))
  } else if (scrollDeltaRows > 0) {
    nextLines = nextLines.slice(scrollDeltaRows).concat(Array.from({ length: scrollDeltaRows }, (_item, row) => blankScreenLine(snapshot.rows - scrollDeltaRows + row)))
  } else if (scrollDeltaRows < 0) {
    nextLines = Array.from({ length: Math.abs(scrollDeltaRows) }, (_item, row) => blankScreenLine(row)).concat(nextLines.slice(0, snapshot.rows + scrollDeltaRows))
  }
  if (nextLines.length < snapshot.rows) {
    nextLines.push(...Array.from({ length: snapshot.rows - nextLines.length }, (_item, row) => blankScreenLine(nextLines.length + row)))
  } else if (nextLines.length > snapshot.rows) {
    nextLines = nextLines.slice(0, snapshot.rows)
  }
  normalizeScreenLineRows(nextLines)
  for (const line of snapshot.lines) {
    if (line.y >= 0 && line.y < snapshot.rows) nextLines[line.y] = cloneScreenLine(line)
  }
  normalizeScreenLineRows(nextLines)
  return {
    ...snapshot,
    full: true,
    fullReason: reason,
    repaintReason: reason,
    scrollDeltaRows: 0,
    lines: nextLines,
    dirtyRows: nextLines.map((_line, row) => row)
  }
}

const flushPendingPaintAsRepaint = (surface: RenderSurface, reason: ThreadedTerminalScreenSnapshot['fullReason']) => {
  if (!surface.pendingSnapshot) return false
  const snapshot = expandSnapshotForRepaint(surface, surface.pendingSnapshot, reason)
  surface.pendingSnapshot = null
  surface.lastPaintAt = nowMs()
  paintSnapshot(surface, snapshot)
  return true
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
  if (surface.pendingSnapshot) {
    const canMergeDirty =
      !surface.pendingSnapshot.full &&
      !snapshot.full &&
      !surface.pendingSnapshot.scrollDeltaRows &&
      !snapshot.scrollDeltaRows &&
      surface.pendingSnapshot.viewportY === snapshot.viewportY &&
      surface.pendingSnapshot.rows === snapshot.rows &&
      surface.pendingSnapshot.cols === snapshot.cols
    if (canMergeDirty) {
      const lines = new Map<number, ThreadedTerminalScreenLine>()
      surface.pendingSnapshot.lines.forEach((line) => lines.set(line.y, line))
      snapshot.lines.forEach((line) => lines.set(line.y, line))
      surface.pendingSnapshot = {
        ...snapshot,
        lines: Array.from(lines.values()).sort((left, right) => left.y - right.y),
        dirtyRows: Array.from(new Set([...surface.pendingSnapshot.dirtyRows, ...snapshot.dirtyRows])).sort((left, right) => left - right)
      }
      scheduleFrame()
      return
    }
    flushPendingPaint(surface)
  }
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
        screenLines: [],
        lastSnapshot: null,
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
      const changed = resizeCanvas(surface, message.width, message.height, message.devicePixelRatio)
      if (!changed) return
      if (flushPendingPaintAsRepaint(surface, 'resize')) return
      else repaintLastSnapshot(surface, 'resize')
      return
    }
    if (message.type === 'settings') {
      surface.settings = message.settings
      configureMetrics(surface)
      if (flushPendingPaintAsRepaint(surface, 'settings')) return
      else repaintLastSnapshot(surface, 'settings')
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
