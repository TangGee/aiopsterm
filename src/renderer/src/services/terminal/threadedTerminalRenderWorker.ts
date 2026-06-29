import type {
  ThreadedTerminalRenderRequest,
  ThreadedTerminalRenderResponse,
  ThreadedTerminalRenderSettings,
  ThreadedTerminalGeometry,
  ThreadedTerminalRenderBackend,
  ThreadedTerminalGpuInfo,
  ThreadedTerminalRenderSurfaceRect,
  ThreadedTerminalScreenLine,
  ThreadedTerminalScreenSnapshot
} from '@/services/terminal/threadedTerminalProtocol'
import { terminalFontSpec } from '@/services/terminal/threadedTerminalMetrics'

type DedicatedWorkerScopeLike = {
  onmessage: ((event: MessageEvent<ThreadedTerminalRenderRequest>) => void) | null
  postMessage: (message: ThreadedTerminalRenderResponse) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

type RenderSurface = {
  terminalId: string
  groupId: string
  renderGroupId: string
  rect: ThreadedTerminalRenderSurfaceRect
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  width: number
  height: number
  dpr: number
  settings: ThreadedTerminalRenderSettings
  geometry: ThreadedTerminalGeometry
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

type WebglRenderGroupResources = {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  buffer: WebGLBuffer
  texture: WebGLTexture
  gpu: ThreadedTerminalGpuInfo
  positionLocation: number
  texCoordLocation: number
  samplerLocation: WebGLUniformLocation | null
  textureWidth: number
  textureHeight: number
}

type RenderGroup = {
  renderGroupId: string
  canvas: OffscreenCanvas
  paintCanvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
  webgl?: WebglRenderGroupResources
  backend: ThreadedTerminalRenderBackend
  width: number
  height: number
  dpr: number
  surfaces: Set<string>
}

const workerScope = self as unknown as DedicatedWorkerScopeLike
const groups = new Map<string, RenderGroup>()
const surfaces = new Map<string, RenderSurface>()
const dirtyRenderGroups = new Set<string>()
const perfIntervalMs = 1000
const frameIntervalMs = 16
const nowMs = () => globalThis.performance?.now?.() ?? Date.now()
let frameTimer: ReturnType<typeof setTimeout> | null = null

const post = (message: ThreadedTerminalRenderResponse) => workerScope.postMessage(message)

const fontSpec = terminalFontSpec

const runChars = (run: { text: string; chars?: string[] }) => run.chars || Array.from(run.text || '')
const runWidths = (run: { text: string; chars?: string[]; widths?: number[] }) => {
  const chars = runChars(run)
  return chars.map((_char, index) => Math.max(1, run.widths?.[index] || 1))
}
const runColumns = (run: { text: string; chars?: string[]; widths?: number[]; columns?: number }) =>
  Math.max(1, run.columns || runWidths(run).reduce((total, width) => total + width, 0) || Array.from(run.text || '').length || 1)

const parseCssColor = (value: string) => {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const raw = hex[1].length === 3 ? hex[1].split('').map((item) => `${item}${item}`).join('') : hex[1]
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16)
    }
  }
  const rgb = value.trim().match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i)
  if (!rgb) return null
  return {
    r: Math.max(0, Math.min(255, Number.parseInt(rgb[1], 10))),
    g: Math.max(0, Math.min(255, Number.parseInt(rgb[2], 10))),
    b: Math.max(0, Math.min(255, Number.parseInt(rgb[3], 10)))
  }
}

const blendColor = (from: string, to: string, amount: number) => {
  const source = parseCssColor(from)
  const target = parseCssColor(to)
  if (!source || !target) return from
  const clamped = Math.max(0, Math.min(1, amount))
  const mix = (left: number, right: number) => Math.round(left + (right - left) * clamped)
  return `rgb(${mix(source.r, target.r)}, ${mix(source.g, target.g)}, ${mix(source.b, target.b)})`
}

const textForeground = (
  surface: RenderSurface,
  options: { fg?: string; bold?: boolean; dim?: boolean; hidden?: boolean }
) => {
  if (options.hidden) return surface.settings.theme.background
  let color = options.fg || surface.settings.theme.foreground
  if (options.bold && !options.fg) color = surface.settings.theme.brightWhite || blendColor(color, '#ffffff', 0.3)
  if (options.dim) color = blendColor(color, surface.settings.theme.background, 0.45)
  return color
}

const rectsEqual = (left: ThreadedTerminalRenderSurfaceRect, right: ThreadedTerminalRenderSurfaceRect) =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height

const webglVertexSource = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`

const webglFragmentSource = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_texCoord);
}`

const compileWebglShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create WebGL shader.')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader compile error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

const createWebglProgram = (gl: WebGL2RenderingContext) => {
  const vertexShader = compileWebglShader(gl, gl.VERTEX_SHADER, webglVertexSource)
  const fragmentShader = compileWebglShader(gl, gl.FRAGMENT_SHADER, webglFragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create WebGL program.')
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown program link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

const getWebglStringParameter = (gl: WebGL2RenderingContext, parameter: number) => {
  try {
    const value = gl.getParameter(parameter)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

const readWebglGpuInfo = (gl: WebGL2RenderingContext): ThreadedTerminalGpuInfo => {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as
    | { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number }
    | null
  return {
    renderer: getWebglStringParameter(gl, gl.RENDERER),
    vendor: getWebglStringParameter(gl, gl.VENDOR),
    unmaskedRenderer: debugInfo ? getWebglStringParameter(gl, debugInfo.UNMASKED_RENDERER_WEBGL) : undefined,
    unmaskedVendor: debugInfo ? getWebglStringParameter(gl, debugInfo.UNMASKED_VENDOR_WEBGL) : undefined
  }
}

const createWebglResources = (canvas: OffscreenCanvas): WebglRenderGroupResources | null => {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false
  }) as WebGL2RenderingContext | null
  if (!gl) return null
  const program = createWebglProgram(gl)
  const buffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (!buffer || !texture) throw new Error('Unable to create WebGL buffer or texture.')
  const vertices = new Float32Array([
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    -1, 1, 0, 1,
    1, -1, 1, 0,
    1, 1, 1, 1
  ])
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  return {
    gl,
    program,
    buffer,
    texture,
    gpu: readWebglGpuInfo(gl),
    positionLocation: gl.getAttribLocation(program, 'a_position'),
    texCoordLocation: gl.getAttribLocation(program, 'a_texCoord'),
    samplerLocation: gl.getUniformLocation(program, 'u_texture'),
    textureWidth: 0,
    textureHeight: 0
  }
}

const createPaintSurface = (canvas: OffscreenCanvas, width: number, height: number, requestedBackend?: ThreadedTerminalRenderBackend) => {
  if (requestedBackend === 'webgl2' && typeof OffscreenCanvas !== 'undefined') {
    const paintCanvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
    const context = paintCanvas.getContext('2d', { alpha: true })
    if (context) {
      const webgl = createWebglResources(canvas)
      if (webgl) {
        return { backend: 'webgl2' as const, paintCanvas, context, webgl }
      }
    }
  }
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null
  return { backend: '2d' as const, paintCanvas: canvas, context, webgl: undefined }
}

const resizeWebglTexture = (webgl: WebglRenderGroupResources, pixelWidth: number, pixelHeight: number) => {
  if (webgl.textureWidth === pixelWidth && webgl.textureHeight === pixelHeight) return
  const gl = webgl.gl
  gl.bindTexture(gl.TEXTURE_2D, webgl.texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  webgl.textureWidth = pixelWidth
  webgl.textureHeight = pixelHeight
}

const markRenderGroupDirty = (renderGroupId: string) => {
  if (groups.get(renderGroupId)?.webgl) dirtyRenderGroups.add(renderGroupId)
}

const markSurfaceDirty = (surface: RenderSurface) => markRenderGroupDirty(surface.renderGroupId)

const presentRenderGroup = (group: RenderGroup) => {
  const webgl = group.webgl
  if (!webgl) return
  const gl = webgl.gl
  const pixelWidth = Math.max(1, Math.floor(group.width * group.dpr))
  const pixelHeight = Math.max(1, Math.floor(group.height * group.dpr))
  resizeWebglTexture(webgl, pixelWidth, pixelHeight)
  gl.viewport(0, 0, pixelWidth, pixelHeight)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(webgl.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, webgl.buffer)
  if (webgl.positionLocation >= 0) {
    gl.enableVertexAttribArray(webgl.positionLocation)
    gl.vertexAttribPointer(webgl.positionLocation, 2, gl.FLOAT, false, 16, 0)
  }
  if (webgl.texCoordLocation >= 0) {
    gl.enableVertexAttribArray(webgl.texCoordLocation)
    gl.vertexAttribPointer(webgl.texCoordLocation, 2, gl.FLOAT, false, 16, 8)
  }
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, webgl.texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, group.paintCanvas)
  if (webgl.samplerLocation) gl.uniform1i(webgl.samplerLocation, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  gl.flush()
}

const presentDirtyRenderGroups = () => {
  if (!dirtyRenderGroups.size) return
  const dirty = Array.from(dirtyRenderGroups)
  dirtyRenderGroups.clear()
  dirty.forEach((renderGroupId) => {
    const group = groups.get(renderGroupId)
    if (group) presentRenderGroup(group)
  })
}

const disposeWebglResources = (resources?: WebglRenderGroupResources) => {
  if (!resources) return
  const gl = resources.gl
  gl.deleteBuffer(resources.buffer)
  gl.deleteTexture(resources.texture)
  gl.deleteProgram(resources.program)
}

const applyGeometry = (surface: RenderSurface, geometry: ThreadedTerminalGeometry) => {
  const context = surface.context
  context.font = fontSpec(surface.settings)
  context.textBaseline = 'alphabetic'
  surface.geometry = geometry
  surface.cellWidth = Math.max(1, geometry.cellWidth)
  surface.cellHeight = Math.max(1, geometry.cellHeight)
  surface.baseline = Math.max(1, geometry.baseline)
}

const resizeGroupCanvas = (group: RenderGroup, width: number, height: number, dpr: number) => {
  const nextWidth = Math.max(1, Math.floor(width))
  const nextHeight = Math.max(1, Math.floor(height))
  const nextDpr = Math.max(1, dpr || 1)
  const changed =
    group.width !== nextWidth ||
    group.height !== nextHeight ||
    group.dpr !== nextDpr
  group.width = nextWidth
  group.height = nextHeight
  group.dpr = nextDpr
  const pixelWidth = Math.max(1, Math.floor(group.width * group.dpr))
  const pixelHeight = Math.max(1, Math.floor(group.height * group.dpr))
  if (group.canvas.width !== pixelWidth) group.canvas.width = pixelWidth
  if (group.canvas.height !== pixelHeight) group.canvas.height = pixelHeight
  if (group.paintCanvas.width !== pixelWidth) group.paintCanvas.width = pixelWidth
  if (group.paintCanvas.height !== pixelHeight) group.paintCanvas.height = pixelHeight
  group.context.setTransform(group.dpr, 0, 0, group.dpr, 0, 0)
  if (group.webgl) resizeWebglTexture(group.webgl, pixelWidth, pixelHeight)
  return changed
}

const clearSurfaceRect = (surface: RenderSurface, rect: ThreadedTerminalRenderSurfaceRect = surface.rect) => {
  const context = surface.context
  context.save()
  context.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0)
  context.clearRect(rect.x, rect.y, rect.width, rect.height)
  context.restore()
  markSurfaceDirty(surface)
}

const withSurfaceClip = (surface: RenderSurface, draw: () => void) => {
  const context = surface.context
  context.save()
  context.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0)
  context.beginPath()
  context.rect(surface.rect.x, surface.rect.y, surface.rect.width, surface.rect.height)
  context.clip()
  context.translate(surface.rect.x, surface.rect.y)
  draw()
  context.restore()
}

const resizeSurface = (
  surface: RenderSurface,
  geometry: ThreadedTerminalGeometry,
  rect: ThreadedTerminalRenderSurfaceRect
) => {
  const previousRect = surface.rect
  const nextRect = {
    x: Math.max(0, Math.round(rect.x * 100) / 100),
    y: Math.max(0, Math.round(rect.y * 100) / 100),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height))
  }
  const group = groups.get(surface.renderGroupId)
  const nextDpr = Math.max(1, group?.dpr || surface.dpr || 1)
  const changed =
    !rectsEqual(surface.rect, nextRect) ||
    surface.width !== nextRect.width ||
    surface.height !== nextRect.height ||
    surface.dpr !== nextDpr ||
    surface.geometry.seq !== geometry.seq
  if (!rectsEqual(previousRect, nextRect)) clearSurfaceRect(surface, previousRect)
  surface.rect = nextRect
  surface.width = nextRect.width
  surface.height = nextRect.height
  surface.dpr = nextDpr
  applyGeometry(surface, geometry)
  return changed
}

const fillBackground = (surface: RenderSurface, row?: number) => {
  const context = surface.context
  context.fillStyle = surface.settings.theme.background
  if (typeof row === 'number') {
    context.fillRect(0, surface.geometry.paddingTop + row * surface.cellHeight, surface.width, surface.cellHeight)
  } else {
    context.fillRect(0, 0, surface.width, surface.height)
  }
}

const drawTextCells = (
  surface: RenderSurface,
  text: string,
  x: number,
  row: number,
  options: {
    fg?: string
    bold?: boolean
    dim?: boolean
    italic?: boolean
    underline?: boolean
    strikethrough?: boolean
    overline?: boolean
    hidden?: boolean
    chars?: string[]
    widths?: number[]
    columns?: number
  } = {}
) => {
  if (!text) return
  const chars = options.chars || Array.from(text)
  const widths = chars.map((_char, index) => Math.max(1, options.widths?.[index] || 1))
  const context = surface.context
  context.font = fontSpec(surface.settings, options.bold, options.italic)
  context.fillStyle = textForeground(surface, options)
  const left = surface.geometry.paddingLeft
  const top = surface.geometry.paddingTop + row * surface.cellHeight
  let cellOffset = 0
  chars.forEach((char, index) => {
    const drawX = x + cellOffset
    if (!options.hidden && char !== ' ') context.fillText(char, left + drawX * surface.cellWidth, top + surface.baseline)
    cellOffset += widths[index]
  })
  const columns = Math.max(1, options.columns || widths.reduce((total, width) => total + width, 0) || chars.length)
  if (options.underline || options.strikethrough || options.overline) {
    context.fillStyle = textForeground(surface, options)
  }
  if (options.underline) {
    context.fillRect(left + x * surface.cellWidth, top + surface.cellHeight - 2, Math.max(surface.cellWidth, columns * surface.cellWidth), 1)
  }
  if (options.strikethrough) {
    context.fillRect(left + x * surface.cellWidth, top + Math.floor(surface.cellHeight * 0.52), Math.max(surface.cellWidth, columns * surface.cellWidth), 1)
  }
  if (options.overline) {
    context.fillRect(left + x * surface.cellWidth, top + 1, Math.max(surface.cellWidth, columns * surface.cellWidth), 1)
  }
}

const drawStyledRuns = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  const context = surface.context
  for (const run of line.cells || []) {
    if (run.bg) {
      context.fillStyle = run.bg
      context.fillRect(
        surface.geometry.paddingLeft + run.x * surface.cellWidth,
        surface.geometry.paddingTop + line.y * surface.cellHeight,
        Math.max(surface.cellWidth, runColumns(run) * surface.cellWidth),
        surface.cellHeight
      )
    }
  }
  for (const run of line.cells || []) {
    drawTextCells(surface, run.text, run.x, line.y, {
      fg: run.fg,
      bold: run.bold,
      dim: run.dim,
      italic: run.italic,
      underline: run.underline,
      strikethrough: run.strikethrough,
      overline: run.overline,
      hidden: run.hidden,
      chars: runChars(run),
      widths: runWidths(run),
      columns: runColumns(run)
    })
  }
}

const drawHighlightRuns = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  for (const run of line.highlights || []) {
    drawTextCells(surface, run.text, run.x, line.y, {
      fg: run.fg,
      bold: run.bold,
      chars: runChars(run),
      widths: runWidths(run),
      columns: runColumns(run)
    })
  }
}

const drawPlainLineText = (surface: RenderSurface, line: ThreadedTerminalScreenLine) => {
  const text = line.text || ''
  if (!text) return
  const styledCells = new Set<number>()
  for (const run of line.cells || []) {
    for (let index = 0; index < runColumns(run); index += 1) styledCells.add(run.x + index)
  }
  const plainRuns = line.runs || []
  if (plainRuns.length) {
    for (const run of plainRuns) {
      const chars = runChars(run)
      const widths = runWidths(run)
      const segments: Array<{ x: number; chars: string[]; widths: number[] }> = []
      let current: { x: number; chars: string[]; widths: number[] } | null = null
      let cellX = run.x
      chars.forEach((char, index) => {
        const width = widths[index]
        const covered = Array.from({ length: width }, (_item, offset) => styledCells.has(cellX + offset)).some(Boolean)
        if (covered) {
          current = null
        } else {
          if (!current) {
            current = { x: cellX, chars: [], widths: [] }
            segments.push(current)
          }
          current.chars.push(char)
          current.widths.push(width)
        }
        cellX += width
      })
      segments.forEach((segment) => {
        drawTextCells(surface, segment.chars.join(''), segment.x, line.y, {
          chars: segment.chars,
          widths: segment.widths,
          columns: segment.widths.reduce((total, width) => total + width, 0)
        })
      })
    }
    return
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
  const x = surface.geometry.paddingLeft + snapshot.cursorX * surface.cellWidth
  const y = surface.geometry.paddingTop + snapshot.cursorY * surface.cellHeight
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

const cloneCellRuns = (runs?: ThreadedTerminalScreenLine['cells']) => runs?.map((run) => ({
  ...run,
  chars: run.chars ? [...run.chars] : undefined,
  widths: run.widths ? [...run.widths] : undefined
}))

const cloneHighlightRuns = (runs?: ThreadedTerminalScreenLine['highlights']) => runs?.map((run) => ({
  ...run,
  chars: run.chars ? [...run.chars] : undefined,
  widths: run.widths ? [...run.widths] : undefined
}))

const normalizeScreenLineRows = (lines: ThreadedTerminalScreenLine[]) => {
  lines.forEach((line, index) => {
    line.y = index
  })
  return lines
}

const cloneScreenLine = (line: ThreadedTerminalScreenLine, y = line.y): ThreadedTerminalScreenLine => ({
  ...line,
  y,
  runs: cloneCellRuns(line.runs),
  cells: cloneCellRuns(line.cells),
  highlights: cloneHighlightRuns(line.highlights)
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
  const gridRows = Math.max(1, surface.geometry.rows)
  if (!deltaRows || Math.abs(deltaRows) >= gridRows) return false
  const context = surface.context
  const deltaY = Math.round(deltaRows * surface.cellHeight * surface.dpr) / surface.dpr
  const sourceX = Math.round((surface.rect.x + surface.geometry.paddingLeft) * surface.dpr)
  const sourceY = Math.round((surface.rect.y + surface.geometry.paddingTop) * surface.dpr)
  const pixelWidth = Math.max(1, Math.round(surface.geometry.cols * surface.cellWidth * surface.dpr))
  const gridPixelHeight = Math.max(1, Math.round(surface.geometry.rows * surface.cellHeight * surface.dpr))
  const pixelDeltaY = Math.round(Math.abs(deltaY) * surface.dpr)
  if (deltaRows > 0) {
    const sourcePixelHeight = Math.max(0, gridPixelHeight - pixelDeltaY)
    if (sourcePixelHeight > 0) {
      context.drawImage(
        surface.canvas,
        sourceX,
        sourceY + pixelDeltaY,
        pixelWidth,
        sourcePixelHeight,
        surface.geometry.paddingLeft,
        surface.geometry.paddingTop,
        pixelWidth / surface.dpr,
        sourcePixelHeight / surface.dpr
      )
    }
  } else {
    const sourcePixelHeight = Math.max(0, gridPixelHeight - pixelDeltaY)
    if (sourcePixelHeight > 0) {
      context.drawImage(
        surface.canvas,
        sourceX,
        sourceY,
        pixelWidth,
        sourcePixelHeight,
        surface.geometry.paddingLeft,
        surface.geometry.paddingTop + pixelDeltaY / surface.dpr,
        pixelWidth / surface.dpr,
        sourcePixelHeight / surface.dpr
      )
    }
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
  withSurfaceClip(surface, () => {
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
  })
  markSurfaceDirty(surface)
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
  presentDirtyRenderGroups()
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

const attachGroup = (options: Extract<ThreadedTerminalRenderRequest, { type: 'attach-group' }>['options']) => {
  const paintSurface = createPaintSurface(
    options.canvas,
    Math.max(1, Math.floor(options.width * Math.max(1, options.devicePixelRatio || 1))),
    Math.max(1, Math.floor(options.height * Math.max(1, options.devicePixelRatio || 1))),
    options.backend
  )
  if (!paintSurface) {
    post({ type: 'error', message: `OffscreenCanvas context unavailable for render group ${options.renderGroupId}.` })
    return
  }
  const existing = groups.get(options.renderGroupId)
  if (existing) {
    disposeWebglResources(existing.webgl)
    existing.canvas = options.canvas
    existing.paintCanvas = paintSurface.paintCanvas
    existing.context = paintSurface.context
    existing.webgl = paintSurface.webgl
    existing.backend = paintSurface.backend
    resizeGroupCanvas(existing, options.width, options.height, options.devicePixelRatio)
    existing.surfaces.forEach((terminalId) => {
      const surface = surfaces.get(terminalId)
      if (!surface) return
      surface.canvas = existing.paintCanvas
      surface.context = existing.context
      surface.dpr = existing.dpr
      if (surface.lastSnapshot) repaintLastSnapshot(surface, 'resize')
    })
    presentDirtyRenderGroups()
    post({ type: 'group-attached', renderGroupId: existing.renderGroupId, backend: existing.backend, width: existing.width, height: existing.height, gpu: existing.webgl?.gpu })
    return
  }
  const group: RenderGroup = {
    renderGroupId: options.renderGroupId,
    canvas: options.canvas,
    paintCanvas: paintSurface.paintCanvas,
    context: paintSurface.context,
    webgl: paintSurface.webgl,
    backend: paintSurface.backend,
    width: Math.max(1, Math.floor(options.width)),
    height: Math.max(1, Math.floor(options.height)),
    dpr: Math.max(1, options.devicePixelRatio || 1),
    surfaces: new Set()
  }
  groups.set(group.renderGroupId, group)
  resizeGroupCanvas(group, options.width, options.height, options.devicePixelRatio)
  presentDirtyRenderGroups()
  post({ type: 'group-attached', renderGroupId: group.renderGroupId, backend: group.backend, width: group.width, height: group.height, gpu: group.webgl?.gpu })
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
    if (message.type === 'attach-group') {
      attachGroup(message.options)
      return
    }
    if (message.type === 'resize-group') {
      const group = groups.get(message.renderGroupId)
      if (!group) {
        post({ type: 'error', message: `Render group ${message.renderGroupId} not found.` })
        return
      }
      const changed = resizeGroupCanvas(group, message.width, message.height, message.devicePixelRatio)
      if (!changed) return
      group.surfaces.forEach((terminalId) => {
        const surface = surfaces.get(terminalId)
        if (!surface) return
        surface.dpr = group.dpr
        if (flushPendingPaintAsRepaint(surface, 'resize')) return
        repaintLastSnapshot(surface, 'resize')
      })
      presentDirtyRenderGroups()
      return
    }
    if (message.type === 'dispose-group') {
      const group = groups.get(message.renderGroupId)
      if (!group) return
      group.surfaces.forEach((terminalId) => {
        const surface = surfaces.get(terminalId)
        if (!surface) return
        surface.pendingSnapshot = null
        emitPerfIfDue(surface, true)
        surfaces.delete(terminalId)
      })
      group.surfaces.clear()
      disposeWebglResources(group.webgl)
      groups.delete(message.renderGroupId)
      dirtyRenderGroups.delete(message.renderGroupId)
      if (!surfaces.size && frameTimer) {
        workerScope.clearTimeout(frameTimer)
        frameTimer = null
      }
      return
    }
    if (message.type === 'attach') {
      const group = groups.get(message.options.renderGroupId)
      if (!group) {
        post({ type: 'error', terminalId: message.options.terminalId, message: `Render group ${message.options.renderGroupId} not found.` })
        return
      }
      const rect = {
        x: Math.max(0, Math.round(message.options.rect.x * 100) / 100),
        y: Math.max(0, Math.round(message.options.rect.y * 100) / 100),
        width: Math.max(1, Math.floor(message.options.rect.width)),
        height: Math.max(1, Math.floor(message.options.rect.height))
      }
      const surface: RenderSurface = {
        terminalId: message.options.terminalId,
        groupId: message.options.groupId,
        renderGroupId: message.options.renderGroupId,
        rect,
        canvas: group.canvas,
        context: group.context,
        width: rect.width,
        height: rect.height,
        dpr: group.dpr,
        settings: message.options.settings,
        geometry: message.options.geometry,
        cellWidth: message.options.geometry.cellWidth,
        cellHeight: message.options.geometry.cellHeight,
        baseline: message.options.geometry.baseline,
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
      group.surfaces.add(surface.terminalId)
      resizeSurface(surface, message.options.geometry, rect)
      withSurfaceClip(surface, () => fillBackground(surface))
      markSurfaceDirty(surface)
      presentDirtyRenderGroups()
      post({ type: 'attached', terminalId: surface.terminalId })
      return
    }
    const terminalId = terminalIdForMessage(message)
    const surface = terminalId ? surfaces.get(terminalId) : undefined
    if (!surface) {
      if (
        message.type === 'screen' ||
        message.type === 'visibility' ||
        message.type === 'resize' ||
        message.type === 'settings' ||
        message.type === 'clear' ||
        message.type === 'dispose'
      ) return
      post({ type: 'error', terminalId, message: 'Render surface not found.' })
      return
    }
    if (message.type === 'resize') {
      const changed = resizeSurface(surface, message.geometry, message.rect)
      if (!changed) return
      if (flushPendingPaintAsRepaint(surface, 'resize')) return
      else repaintLastSnapshot(surface, 'resize')
      return
    }
    if (message.type === 'settings') {
      surface.settings = message.settings
      resizeSurface(surface, message.geometry, surface.rect)
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
      withSurfaceClip(surface, () => fillBackground(surface))
      markSurfaceDirty(surface)
      presentDirtyRenderGroups()
      return
    }
    if (message.type === 'dispose') {
      surface.pendingSnapshot = null
      emitPerfIfDue(surface, true)
      clearSurfaceRect(surface)
      presentDirtyRenderGroups()
      groups.get(surface.renderGroupId)?.surfaces.delete(surface.terminalId)
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
