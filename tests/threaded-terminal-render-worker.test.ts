import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ThreadedTerminalGeometry,
  ThreadedTerminalRenderRequest,
  ThreadedTerminalRenderResponse,
  ThreadedTerminalScreenSnapshot
} from '@/services/terminal/threadedTerminalProtocol'

type TestWorkerScope = {
  onmessage: ((event: MessageEvent<ThreadedTerminalRenderRequest>) => void) | null
  postMessage: (message: ThreadedTerminalRenderResponse) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

class FakeCanvasContext {
  font = ''
  fillStyle = ''
  textBaseline = ''
  operations: Array<{ type: string; text?: string; x: number; y: number; width?: number; height?: number; fillStyle?: string }> = []

  setTransform = vi.fn()
  save = vi.fn()
  restore = vi.fn()
  beginPath = vi.fn()
  rect = vi.fn()
  clip = vi.fn()
  translate = vi.fn()
  clearRect = vi.fn()
  measureText = vi.fn(() => ({ width: 99 }))
  fillRect = vi.fn((x: number, y: number, width: number, height: number) => {
    this.operations.push({ type: 'fillRect', x, y, width, height, fillStyle: this.fillStyle })
  })
  fillText = vi.fn((text: string, x: number, y: number) => {
    this.operations.push({ type: 'fillText', text, x, y, fillStyle: this.fillStyle })
  })
  drawImage = vi.fn()
}

class FakeWebgl2Context {
  readonly VERTEX_SHADER = 35633
  readonly FRAGMENT_SHADER = 35632
  readonly COMPILE_STATUS = 35713
  readonly LINK_STATUS = 35714
  readonly ARRAY_BUFFER = 34962
  readonly STATIC_DRAW = 35044
  readonly TEXTURE_2D = 3553
  readonly TEXTURE_MIN_FILTER = 10241
  readonly TEXTURE_MAG_FILTER = 10240
  readonly NEAREST = 9728
  readonly TEXTURE_WRAP_S = 10242
  readonly TEXTURE_WRAP_T = 10243
  readonly CLAMP_TO_EDGE = 33071
  readonly UNPACK_FLIP_Y_WEBGL = 37440
  readonly RGBA = 6408
  readonly UNSIGNED_BYTE = 5121
  readonly COLOR_BUFFER_BIT = 16384
  readonly FLOAT = 5126
  readonly TEXTURE0 = 33984
  readonly RENDERER = 7937
  readonly VENDOR = 7936
  shaderSource = vi.fn()
  compileShader = vi.fn()
  getShaderParameter = vi.fn(() => true)
  getShaderInfoLog = vi.fn(() => '')
  deleteShader = vi.fn()
  attachShader = vi.fn()
  linkProgram = vi.fn()
  getProgramParameter = vi.fn(() => true)
  getProgramInfoLog = vi.fn(() => '')
  deleteProgram = vi.fn()
  createShader = vi.fn((type: number) => ({ type }))
  createProgram = vi.fn(() => ({}))
  createBuffer = vi.fn(() => ({}))
  createTexture = vi.fn(() => ({}))
  bindBuffer = vi.fn()
  bufferData = vi.fn()
  bindTexture = vi.fn()
  texParameteri = vi.fn()
  pixelStorei = vi.fn()
  getAttribLocation = vi.fn((_program: unknown, name: string) => (name === 'a_position' ? 0 : 1))
  getUniformLocation = vi.fn(() => ({}))
  getExtension = vi.fn((name: string) =>
    name === 'WEBGL_debug_renderer_info'
      ? { UNMASKED_RENDERER_WEBGL: 37446, UNMASKED_VENDOR_WEBGL: 37445 }
      : null
  )
  getParameter = vi.fn((parameter: number) => {
    if (parameter === this.RENDERER) return 'Fake WebGL2 Renderer'
    if (parameter === this.VENDOR) return 'Fake WebGL2 Vendor'
    if (parameter === 37446) return 'Fake Hardware Renderer'
    if (parameter === 37445) return 'Fake Hardware Vendor'
    return undefined
  })
  texImage2D = vi.fn()
  viewport = vi.fn()
  clearColor = vi.fn()
  clear = vi.fn()
  useProgram = vi.fn()
  enableVertexAttribArray = vi.fn()
  vertexAttribPointer = vi.fn()
  activeTexture = vi.fn()
  texSubImage2D = vi.fn()
  uniform1i = vi.fn()
  drawArrays = vi.fn()
  flush = vi.fn()
  deleteBuffer = vi.fn()
  deleteTexture = vi.fn()
}

class FakeOffscreenCanvas {
  width = 0
  height = 0
  readonly context = new FakeCanvasContext()
  readonly webgl2Context?: FakeWebgl2Context

  constructor(width = 0, height = 0, options: { webgl2?: boolean } = {}) {
    this.width = width
    this.height = height
    this.webgl2Context = options.webgl2 ? new FakeWebgl2Context() : undefined
  }

  getContext(kind: string) {
    if (kind === '2d') return this.context
    if (kind === 'webgl2') return this.webgl2Context || null
    return null
  }
}

const snapshot = (): ThreadedTerminalScreenSnapshot => ({
  terminalId: 'render-worker-terminal',
  seq: 1,
  cols: 10,
  rows: 3,
  cursorX: 4,
  cursorY: 0,
  cursorAbsoluteY: 0,
  viewportY: 0,
  baseY: 0,
  lines: [
    {
      y: 0,
      text: 'a你b',
      runs: [{ x: 0, text: 'a你b', chars: ['a', '你', 'b'], widths: [1, 2, 1], columns: 4 }],
      cells: [
        {
          x: 1,
          text: '你',
          chars: ['你'],
          widths: [2],
          columns: 2,
          bg: '#223344',
          fg: '#ffffff',
          bold: true,
          italic: true,
          underline: true
        }
      ]
    }
  ],
  dirtyRows: [0],
  full: true,
  visible: true,
  priority: 'active'
})

const workingSnapshot = (): ThreadedTerminalScreenSnapshot => ({
  terminalId: 'render-worker-terminal',
  seq: 2,
  cols: 10,
  rows: 3,
  cursorX: 7,
  cursorY: 1,
  cursorAbsoluteY: 1,
  viewportY: 0,
  baseY: 0,
  lines: [
    {
      y: 1,
      text: 'Working',
      runs: [{ x: 0, text: 'Working', chars: Array.from('Working'), widths: Array.from('Working').map(() => 1), columns: 7 }],
      cells: [
        {
          x: 0,
          text: 'Working',
          chars: Array.from('Working'),
          widths: Array.from('Working').map(() => 1),
          columns: 7,
          fg: '#c86432',
          bold: true
        }
      ]
    }
  ],
  dirtyRows: [1],
  full: false,
  visible: true,
  priority: 'active'
})

const geometry = (overrides: Partial<ThreadedTerminalGeometry> = {}): ThreadedTerminalGeometry => ({
  seq: 1,
  canvasWidth: 80,
  canvasHeight: 48,
  cols: 10,
  rows: 3,
  cellWidth: 8,
  cellHeight: 13,
  baseline: 10,
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 9,
  ...overrides
})

const attachMessage = (
  overrides: Partial<ThreadedTerminalGeometry> = {}
): ThreadedTerminalRenderRequest => ({
  type: 'attach',
  options: {
    terminalId: 'render-worker-terminal',
    groupId: 'group-1',
    renderGroupId: 'render-group-1',
    rect: {
      x: 0,
      y: 0,
      width: geometry(overrides).canvasWidth,
      height: geometry(overrides).canvasHeight
    },
    settings: {
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 1,
      cursorBlink: false,
      cursorStyle: 'block',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ff00ff'
      }
    },
    geometry: geometry(overrides)
  }
})

const attachGroupMessage = (canvas: FakeOffscreenCanvas, backend: '2d' | 'webgl2' = '2d'): ThreadedTerminalRenderRequest => ({
  type: 'attach-group',
  options: {
    renderGroupId: 'render-group-1',
    canvas: canvas as unknown as OffscreenCanvas,
    devicePixelRatio: 1,
    width: 80,
    height: 48,
    backend
  }
})

describe('threadedTerminalRenderWorker', () => {
  let originalSelfDescriptor: PropertyDescriptor | undefined
  let originalOffscreenCanvasDescriptor: PropertyDescriptor | undefined
  let scope: TestWorkerScope
  let messages: ThreadedTerminalRenderResponse[]
  let canvas: FakeOffscreenCanvas

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    messages = []
    canvas = new FakeOffscreenCanvas()
    scope = {
      onmessage: null,
      postMessage: (message) => {
        messages.push(message)
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis)
    }
    originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self')
    originalOffscreenCanvasDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: scope
    })
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      configurable: true,
      value: FakeOffscreenCanvas
    })
    await import('@/services/terminal/threadedTerminalRenderWorker')
    expect(messages).toContainEqual({ type: 'ready' })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalSelfDescriptor) {
      Object.defineProperty(globalThis, 'self', originalSelfDescriptor)
    } else {
      delete (globalThis as { self?: unknown }).self
    }
    if (originalOffscreenCanvasDescriptor) {
      Object.defineProperty(globalThis, 'OffscreenCanvas', originalOffscreenCanvasDescriptor)
    } else {
      delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    }
  })

  const send = (message: ThreadedTerminalRenderRequest) => {
    scope.onmessage?.({ data: message } as MessageEvent<ThreadedTerminalRenderRequest>)
  }

  it('paints wide glyphs at their xterm cell columns', async () => {
    send(attachGroupMessage(canvas))
    send(attachMessage())
    send({ type: 'screen', snapshot: snapshot() })

    await vi.advanceTimersByTimeAsync(16)

    const textOps = canvas.context.operations.filter((operation) => operation.type === 'fillText')
    expect(textOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'a', x: 0 }),
        expect.objectContaining({ text: '你', x: 8 }),
        expect.objectContaining({ text: 'b', x: 24 })
      ])
    )
    expect(canvas.context.fillRect).toHaveBeenCalledWith(8, 0, 16, 13)
    expect(canvas.context.font).toContain('400')
    expect(canvas.context.font).not.toContain('italic')
    expect(canvas.context.measureText).not.toHaveBeenCalled()
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 1 })]))
  })

  it('redraws the ASCII character addressed by a block cursor after a wide glyph', async () => {
    const current = snapshot()
    current.cursorX = 3
    current.lines[0] = {
      y: 0,
      text: 'a你>8',
      runs: [{ x: 0, text: 'a你>8', chars: ['a', '你', '>', '8'], widths: [1, 2, 1, 1], columns: 5 }],
      cells: []
    }

    send(attachGroupMessage(canvas))
    send(attachMessage())
    send({ type: 'screen', snapshot: current })

    await vi.advanceTimersByTimeAsync(16)

    expect(canvas.context.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fillText', text: '>', x: 24, fillStyle: '#000000' }),
      expect.objectContaining({ type: 'fillRect', x: 24, y: 1, width: 8, height: 11, fillStyle: '#ff00ff' })
    ]))
    expect(canvas.context.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fillText', text: '8', x: 24, fillStyle: '#000000' })
    ]))
  })

  it.each([1, 2])('anchors a block cursor in column %s to the full wide glyph', async (cursorX) => {
    const current = snapshot()
    current.cursorX = cursorX

    send(attachGroupMessage(canvas))
    send(attachMessage())
    send({ type: 'screen', snapshot: current })

    await vi.advanceTimersByTimeAsync(16)

    expect(canvas.context.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fillText', text: '你', x: 8, fillStyle: '#000000' }),
      expect.objectContaining({ type: 'fillRect', x: 8, y: 1, width: 16, height: 11, fillStyle: '#ff00ff' })
    ]))
  })

  it('underlines the full width of a wide glyph', async () => {
    const current = snapshot()
    current.cursorX = 1
    const message = attachMessage()
    if (message.type === 'attach') message.options.settings.cursorStyle = 'underline'

    send(attachGroupMessage(canvas))
    send(message)
    send({ type: 'screen', snapshot: current })

    await vi.advanceTimersByTimeAsync(16)

    expect(canvas.context.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fillRect', x: 8, y: 10, width: 16, height: 2, fillStyle: '#ff00ff' })
    ]))
  })

  it('paints cursor-addressed ANSI style changes with the new RGB foreground', async () => {
    send(attachGroupMessage(canvas))
    const message = attachMessage()
    if (message.type === 'attach') message.options.settings.cursorStyle = 'bar'
    send(message)
    send({ type: 'screen', snapshot: workingSnapshot() })

    await vi.advanceTimersByTimeAsync(16)

    const workingOps = canvas.context.operations.filter((operation) => operation.type === 'fillText' && 'Working'.includes(operation.text || ''))
    expect(workingOps).toHaveLength(7)
    expect(workingOps.every((operation) => operation.fillStyle === '#c86432')).toBe(true)
    expect(canvas.context.font).toContain('400')
    expect(canvas.context.font).not.toContain('700')
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 2, paintedRows: 1 })]))
  })

  it('raises low-contrast truecolor foregrounds to the theme foreground', async () => {
    send(attachGroupMessage(canvas))
    const message = attachMessage()
    if (message.type === 'attach') {
      message.options.settings.cursorStyle = 'bar'
      message.options.settings.theme = {
        background: '#f5f7fb',
        contrastBackground: '#f5f7fb',
        foreground: '#172033',
        minimumContrastRatio: 4.5,
        cursor: '#2f6fed'
      }
    }
    send(message)
    send({
      type: 'screen',
      snapshot: {
        ...workingSnapshot(),
        lines: [
          {
            y: 1,
            text: 'dim',
            runs: [{ x: 0, text: 'dim', chars: Array.from('dim'), widths: [1, 1, 1], columns: 3 }],
            cells: [
              {
                x: 0,
                text: 'dim',
                chars: Array.from('dim'),
                widths: [1, 1, 1],
                columns: 3,
                fg: '#d8dde8'
              }
            ]
          }
        ]
      }
    })

    await vi.advanceTimersByTimeAsync(16)

    const dimOps = canvas.context.operations.filter((operation) => operation.type === 'fillText' && 'dim'.includes(operation.text || ''))
    expect(dimOps).toHaveLength(3)
    expect(dimOps.every((operation) => operation.fillStyle === '#172033')).toBe(true)
  })

  it('preserves theme ANSI palette foregrounds instead of flattening them to the default foreground', async () => {
    send(attachGroupMessage(canvas))
    const message = attachMessage()
    if (message.type === 'attach') {
      message.options.settings.cursorStyle = 'bar'
      message.options.settings.theme = {
        background: '#f5f7fb',
        contrastBackground: '#f5f7fb',
        foreground: '#172033',
        minimumContrastRatio: 4.5,
        cursor: '#2f6fed',
        green: '#2f9e44'
      }
    }
    send(message)
    send({
      type: 'screen',
      snapshot: {
        ...workingSnapshot(),
        lines: [
          {
            y: 1,
            text: 'ansi',
            runs: [{ x: 0, text: 'ansi', chars: Array.from('ansi'), widths: [1, 1, 1, 1], columns: 4 }],
            cells: [
              {
                x: 0,
                text: 'ansi',
                chars: Array.from('ansi'),
                widths: [1, 1, 1, 1],
                columns: 4,
                fg: '#2f9e44'
              }
            ]
          }
        ]
      }
    })

    await vi.advanceTimersByTimeAsync(16)

    const ansiOps = canvas.context.operations.filter((operation) => operation.type === 'fillText' && 'ansi'.includes(operation.text || ''))
    expect(ansiOps).toHaveLength(4)
    expect(ansiOps.every((operation) => operation.fillStyle === '#2f9e44')).toBe(true)
  })

  it('paints search highlight backgrounds before highlighted text', async () => {
    send(attachGroupMessage(canvas))
    const message = attachMessage()
    if (message.type === 'attach') message.options.settings.cursorStyle = 'bar'
    send(message)
    const nextSnapshot = workingSnapshot()
    nextSnapshot.lines[0].highlights = [
      {
        x: 0,
        text: 'Work',
        chars: Array.from('Work'),
        widths: Array.from('Work').map(() => 1),
        columns: 4,
        fg: '#111827',
        bg: '#facc15',
        bold: true
      }
    ]
    send({ type: 'screen', snapshot: nextSnapshot })

    await vi.advanceTimersByTimeAsync(16)

    expect(canvas.context.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'fillRect', x: 0, y: 13, width: 32, height: 13, fillStyle: '#facc15' }),
      expect.objectContaining({ type: 'fillText', text: 'W', x: 0, y: 23, fillStyle: '#111827' })
    ]))
  })

  it('clears transparent background rows before painting new Codex TUI text', async () => {
    send(attachGroupMessage(canvas))
    const message = attachMessage()
    if (message.type === 'attach') {
      message.options.settings.theme.background = 'rgba(0, 0, 0, 0)'
      message.options.settings.cursorStyle = 'bar'
    }
    send(message)
    send({ type: 'screen', snapshot: workingSnapshot() })

    await vi.advanceTimersByTimeAsync(16)

    expect(canvas.context.clearRect).toHaveBeenCalledWith(0, 13, 80, 13)
    const clearOrder = canvas.context.clearRect.mock.invocationCallOrder
    const fillOrder = canvas.context.fillRect.mock.invocationCallOrder
    expect(clearOrder[clearOrder.length - 1]).toBeLessThan(fillOrder[fillOrder.length - 1])
    const rowFill = canvas.context.operations.find((operation) => operation.type === 'fillRect' && operation.y === 13)
    expect(rowFill).toBeUndefined()
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 2 })]))
  })

  it('uses host-provided geometry padding instead of remeasuring in the worker', async () => {
    send(attachGroupMessage(canvas))
    send(attachMessage({ paddingLeft: 4, paddingTop: 2, paddingRight: 12, paddingBottom: 7 }))
    send({ type: 'screen', snapshot: snapshot() })

    await vi.advanceTimersByTimeAsync(16)

    const textOps = canvas.context.operations.filter((operation) => operation.type === 'fillText')
    expect(textOps).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'a', x: 4, y: 12 }),
      expect.objectContaining({ text: '你', x: 12, y: 12 }),
      expect.objectContaining({ text: 'b', x: 28, y: 12 })
    ]))
    expect(canvas.context.fillRect).toHaveBeenCalledWith(12, 2, 16, 13)
    expect(canvas.context.measureText).not.toHaveBeenCalled()
  })

  it('clears a hidden shared RenderGroup rect and repaints cached content when visible again', async () => {
    send(attachGroupMessage(canvas))
    const message = attachMessage()
    if (message.type === 'attach') message.options.settings.cursorStyle = 'bar'
    send(message)
    send({ type: 'screen', snapshot: workingSnapshot() })
    await vi.advanceTimersByTimeAsync(16)
    canvas.context.clearRect.mockClear()

    send({ type: 'visibility', terminalId: 'render-worker-terminal', visible: false })

    expect(canvas.context.clearRect).toHaveBeenCalledWith(0, 0, 80, 48)
    expect(messages.filter((item) => item.type === 'frame')).toHaveLength(1)

    send({ type: 'visibility', terminalId: 'render-worker-terminal', visible: true })
    await vi.advanceTimersByTimeAsync(16)

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 2, full: true, fullReason: 'visibility' })
    ]))
  })

  it('uses a WebGL2 render group when requested and available', async () => {
    canvas = new FakeOffscreenCanvas(0, 0, { webgl2: true })
    send(attachGroupMessage(canvas, 'webgl2'))
    send(attachMessage())
    send({ type: 'screen', snapshot: snapshot() })

    await vi.advanceTimersByTimeAsync(16)

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'group-attached',
        renderGroupId: 'render-group-1',
        backend: 'webgl2',
        gpu: expect.objectContaining({ unmaskedRenderer: 'Fake Hardware Renderer' })
      }),
      expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 1 })
    ]))
    expect(canvas.webgl2Context?.texSubImage2D).toHaveBeenCalled()
    expect(canvas.webgl2Context?.drawArrays).toHaveBeenCalled()
    expect(canvas.context.fillText).not.toHaveBeenCalled()
  })

  it('falls back to 2d when WebGL2 is requested but unavailable', () => {
    send(attachGroupMessage(canvas, 'webgl2'))

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'group-attached', renderGroupId: 'render-group-1', backend: '2d' })
    ]))
  })

  it('ignores idempotent lifecycle messages for disposed render surfaces', () => {
    send(attachGroupMessage(canvas))
    const settings = {
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 1,
      cursorBlink: false,
      cursorStyle: 'block' as const,
      theme: { background: '#000', foreground: '#fff', cursor: '#fff' }
    }
    send({
      type: 'resize',
      terminalId: 'missing-terminal',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      geometry: geometry()
    })
    send({
      type: 'settings',
      terminalId: 'missing-terminal',
      settings,
      geometry: geometry()
    })
    send({ type: 'clear', terminalId: 'missing-terminal' })

    expect(messages.filter((message) => message.type === 'error')).toEqual([])
  })
})
