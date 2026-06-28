import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
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
  measureText = vi.fn(() => ({ width: 8 }))
  fillRect = vi.fn((x: number, y: number, width: number, height: number) => {
    this.operations.push({ type: 'fillRect', x, y, width, height, fillStyle: this.fillStyle })
  })
  fillText = vi.fn((text: string, x: number, y: number) => {
    this.operations.push({ type: 'fillText', text, x, y, fillStyle: this.fillStyle })
  })
  drawImage = vi.fn()
}

class FakeOffscreenCanvas {
  width = 0
  height = 0
  readonly context = new FakeCanvasContext()

  getContext(kind: string) {
    return kind === '2d' ? this.context : null
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

describe('threadedTerminalRenderWorker', () => {
  let originalSelfDescriptor: PropertyDescriptor | undefined
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
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: scope
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
  })

  const send = (message: ThreadedTerminalRenderRequest) => {
    scope.onmessage?.({ data: message } as MessageEvent<ThreadedTerminalRenderRequest>)
  }

  it('paints wide glyphs at their xterm cell columns', async () => {
    send({
      type: 'attach',
      options: {
        terminalId: 'render-worker-terminal',
        groupId: 'group-1',
        canvas: canvas as unknown as OffscreenCanvas,
        width: 80,
        height: 48,
        devicePixelRatio: 1,
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
        }
      }
    })
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
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 1 })]))
  })

  it('paints cursor-addressed ANSI style changes with the new RGB foreground', async () => {
    send({
      type: 'attach',
      options: {
        terminalId: 'render-worker-terminal',
        groupId: 'group-1',
        canvas: canvas as unknown as OffscreenCanvas,
        width: 80,
        height: 48,
        devicePixelRatio: 1,
        settings: {
          fontFamily: 'JetBrains Mono',
          fontSize: 13,
          lineHeight: 1,
          cursorBlink: false,
          cursorStyle: 'bar',
          theme: {
            background: '#000000',
            foreground: '#ffffff',
            cursor: '#ff00ff'
          }
        }
      }
    })
    send({ type: 'screen', snapshot: workingSnapshot() })

    await vi.advanceTimersByTimeAsync(16)

    const workingOps = canvas.context.operations.filter((operation) => operation.type === 'fillText' && 'Working'.includes(operation.text || ''))
    expect(workingOps).toHaveLength(7)
    expect(workingOps.every((operation) => operation.fillStyle === '#c86432')).toBe(true)
    expect(canvas.context.font).toContain('400')
    expect(canvas.context.font).not.toContain('700')
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'frame', terminalId: 'render-worker-terminal', seq: 2, paintedRows: 1 })]))
  })
})
