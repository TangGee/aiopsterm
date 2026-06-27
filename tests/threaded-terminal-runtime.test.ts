import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ThreadedTerminalHost,
  threadedTerminalCapability,
  threadedTerminalDefaultWorkerCount,
  threadedTerminalPriorityFor
} from '@/services/terminal/threadedTerminalRuntime'

const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = []

vi.mock('@/services/app/runtimeLogClient', () => ({
  writeRendererRuntimeLog: (level: string, event: string, fields?: Record<string, unknown>) => {
    logs.push({ level, event, fields })
  }
}))

vi.mock('@/services/terminal/threadedTerminalCoreWorker?worker', () => ({
  default: class FakeCoreWorker {
    static instances: FakeCoreWorker[] = []
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    messages: unknown[] = []
    constructor() {
      FakeCoreWorker.instances.push(this)
    }
    postMessage(message: unknown) {
      this.messages.push(message)
    }
  }
}))

vi.mock('@/services/terminal/threadedTerminalRenderWorker?worker', () => ({
  default: class FakeRenderWorker {
    static instances: FakeRenderWorker[] = []
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    messages: unknown[] = []
    constructor() {
      FakeRenderWorker.instances.push(this)
    }
    postMessage(message: unknown) {
      this.messages.push(message)
    }
  }
}))

const installOffscreenCanvasSupport = () => {
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: class TestWorker {}
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
    configurable: true,
    value() {
      return {
        width: 0,
        height: 0,
        getContext: vi.fn()
      }
    }
  })
}

const createHost = () =>
  new ThreadedTerminalHost({
    terminalId: 'panel-1',
    sessionId: 'terminal-1',
    groupId: 'group-1',
    surface: 'workspace',
    settings: {
      terminalType: 'xterm-256color',
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollBack: 2000
    },
    theme: {
      background: '#090b10',
      foreground: '#d7dae3',
      cursor: '#8ccf7e',
      selectionBackground: '#2d4059'
    },
    initialData: 'ready\n',
    visible: true,
    priority: 'active'
  })

afterEach(() => {
  document.body.replaceChildren()
  delete (HTMLCanvasElement.prototype as any).transferControlToOffscreen
  delete (globalThis as any).Worker
  logs.length = 0
  vi.restoreAllMocks()
})

describe('threadedTerminalRuntime', () => {
  it('detects OffscreenCanvas capability explicitly', () => {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class TestWorker {}
    })
    delete (HTMLCanvasElement.prototype as any).transferControlToOffscreen
    expect(threadedTerminalCapability()).toEqual({ supported: false, reason: 'offscreen-canvas-unavailable' })

    installOffscreenCanvasSupport()
    expect(threadedTerminalCapability()).toEqual({ supported: true })
  })

  it('sizes the core worker pool conservatively from hardware concurrency', () => {
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(4)
    expect(threadedTerminalDefaultWorkerCount()).toBe(1)

    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8)
    expect(threadedTerminalDefaultWorkerCount()).toBe(2)

    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(16)
    expect(threadedTerminalDefaultWorkerCount()).toBe(3)
  })

  it('maps active, visible, and background priorities', () => {
    expect(threadedTerminalPriorityFor('panel-1', 'panel-1', true)).toBe('active')
    expect(threadedTerminalPriorityFor('panel-2', 'panel-1', true)).toBe('visible')
    expect(threadedTerminalPriorityFor('panel-2', 'panel-1', false)).toBe('background')
  })

  it('opens a canvas host and sends create, resize, data, visibility, and dispose messages', async () => {
    installOffscreenCanvasSupport()
    const hostElement = document.createElement('div')
    Object.defineProperties(hostElement, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 400 }
    })
    document.body.appendChild(hostElement)

    const host = createHost()
    host.open(hostElement)
    expect(hostElement.querySelector('.threaded-terminal-canvas')).toBeTruthy()
    host.write('chunk\n')
    host.setVisibility(false, 'background')
    host.dispose()

    const coreModule = await import('@/services/terminal/threadedTerminalCoreWorker?worker')
    const renderModule = await import('@/services/terminal/threadedTerminalRenderWorker?worker')
    const coreMessages = (coreModule.default as any).instances.flatMap((worker: { messages: unknown[] }) => worker.messages)
    const renderWorker = (renderModule.default as any).instances[0]

    expect(coreMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create', options: expect.objectContaining({ terminalId: 'panel-1', priority: 'active' }), initialData: 'ready\n' }),
        expect.objectContaining({ type: 'data', terminalId: 'panel-1', data: 'chunk\n' }),
        expect.objectContaining({ type: 'visibility', terminalId: 'panel-1', visible: false, priority: 'background' }),
        expect.objectContaining({ type: 'dispose', terminalId: 'panel-1' })
      ])
    )
    expect(renderWorker.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attach', options: expect.objectContaining({ terminalId: 'panel-1', groupId: 'group-1' }) }),
        expect.objectContaining({ type: 'visibility', terminalId: 'panel-1', visible: false }),
        expect.objectContaining({ type: 'dispose', terminalId: 'panel-1' })
      ])
    )
  })
})
