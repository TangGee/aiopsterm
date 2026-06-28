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

vi.mock('@/services/app/clipboardRuntime', () => ({
  copyTextToClipboard: vi.fn(async () => true)
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
      selectionBackground: '#2d4059',
      green: '#22c55e',
      brightGreen: '#86efac',
      scrollbarTrack: '#2b324266',
      scrollbarThumb: '#8993a899',
      scrollbarThumbHover: '#56b6c2'
    },
    keywordHighlight: {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: false
        },
        rules: [
          {
            name: 'error',
            enabled: true,
            scope: 'output',
            matchType: 'regex',
            pattern: '(?i)error',
            style: {
              foreground: '#FF0000',
              fontStyle: 'bold'
            }
          }
        ]
      }
    },
    initialData: 'ready\n',
    visible: true,
    priority: 'active'
  })

const createHostElement = () => {
  const hostElement = document.createElement('div')
  Object.defineProperties(hostElement, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 400 }
  })
  document.body.appendChild(hostElement)
  return hostElement
}

const workerMessages = async () => {
  const coreModule = await import('@/services/terminal/threadedTerminalCoreWorker?worker')
  const renderModule = await import('@/services/terminal/threadedTerminalRenderWorker?worker')
  return {
    core: (coreModule.default as any).instances.flatMap((worker: { messages: unknown[] }) => worker.messages),
    render: (renderModule.default as any).instances.flatMap((worker: { messages: unknown[] }) => worker.messages)
  }
}

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
    const hostElement = createHostElement()

    const host = createHost()
    host.open(hostElement)
    expect(hostElement.querySelector('.threaded-terminal-canvas')).toBeTruthy()
    expect(hostElement.querySelector('.threaded-terminal-selection-layer')).toBeTruthy()
    expect(hostElement.querySelector('.threaded-terminal-scrollbar')).toBeTruthy()
    host.write('chunk\n')
    host.setVisibility(false, 'background')
    host.dispose()

    const messages = await workerMessages()

    expect(messages.core).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create', options: expect.objectContaining({ terminalId: 'panel-1', priority: 'active' }), initialData: 'ready\n' }),
        expect.objectContaining({ type: 'data', terminalId: 'panel-1', data: 'chunk\n' }),
        expect.objectContaining({ type: 'visibility', terminalId: 'panel-1', visible: false, priority: 'background' }),
        expect.objectContaining({ type: 'dispose', terminalId: 'panel-1' })
      ])
    )
    expect(messages.render).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attach', options: expect.objectContaining({ terminalId: 'panel-1', groupId: 'group-1' }) }),
        expect.objectContaining({ type: 'visibility', terminalId: 'panel-1', visible: false }),
        expect.objectContaining({ type: 'dispose', terminalId: 'panel-1' })
      ])
    )
  })

  it('passes keyword highlight config to the core worker and updates it independently of settings', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    host.startCoreOnly()
    host.updateKeywordHighlight(null)

    const messages = await workerMessages()
    expect(messages.core).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'create',
          options: expect.objectContaining({
            keywordHighlight: expect.objectContaining({
              'keyword-highlight': expect.objectContaining({ enabled: true })
            })
          })
        }),
        expect.objectContaining({ type: 'keyword-highlight', terminalId: 'panel-1', config: null })
      ])
    )
    host.dispose()
  })

  it('normalizes keyword highlight config before posting worker messages', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const proxyConfig = new Proxy(
      {
        'keyword-highlight': {
          enabled: true,
          applyTo: { output: true, input: false },
          rules: [
            {
              name: 'warn',
              enabled: true,
              scope: 'output',
              matchType: 'literal',
              pattern: 'WARN',
              style: { foreground: '#facc15' }
            }
          ]
        }
      },
      {}
    ) as any
    host.updateKeywordHighlight(proxyConfig)
    host.open(createHostElement())

    const messages = await workerMessages()
    const createMessage = messages.core.filter((message: any) => message.type === 'create').at(-1) as any
    expect(createMessage.options.keywordHighlight).toEqual(proxyConfig)
    expect(createMessage.options.keywordHighlight).not.toBe(proxyConfig)
    host.dispose()
  })

  it('does not send core lifecycle commands before the core terminal is created', async () => {
    installOffscreenCanvasSupport()
    const before = await workerMessages()
    const host = createHost()
    host.scrollToBottom()
    host.scrollLines(1)
    host.scrollToLine(3)
    host.setVisibility(false, 'background')
    host.setPriority('active')
    host.clear()
    host.dispose()

    const after = await workerMessages()
    expect(after.core.slice(before.core.length)).toEqual([])
  })

  it('creates the core before attaching the render surface so terminal data is not lost on attach failure', async () => {
    installOffscreenCanvasSupport()
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value() {
        throw new Error('attach failed')
      }
    })
    const host = createHost()
    expect(() => host.open(createHostElement())).toThrow('attach failed')

    const messages = await workerMessages()
    expect(messages.core).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'create', options: expect.objectContaining({ terminalId: 'panel-1' }), initialData: 'ready\n' })
      ])
    )
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          event: 'renderer.threaded-terminal.open-failed',
          fields: expect.objectContaining({ terminalId: 'panel-1', message: 'attach failed' })
        })
      ])
    )
    host.dispose()
  })

  it('syncs themed threaded scrollbar interaction to core scroll-to-line requests', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    })
    host.open(element)
    host.applySnapshot({
      terminalId: 'panel-1',
      seq: 1,
      cols: 80,
      rows: 10,
      cursorX: 0,
      cursorY: 9,
      cursorAbsoluteY: 109,
      viewportY: 100,
      baseY: 100,
      lines: Array.from({ length: 10 }, (_item, row) => ({ y: row, text: `line-${row}`, cells: [] })),
      dirtyRows: Array.from({ length: 10 }, (_item, row) => row),
      full: true,
      visible: true,
      priority: 'active'
    })

    const scrollbar = element.querySelector<HTMLElement>('.threaded-terminal-scrollbar')
    const thumb = element.querySelector<HTMLElement>('.threaded-terminal-scrollbar-thumb')
    expect(scrollbar?.getAttribute('aria-valuemax')).toBe('100')
    expect(scrollbar?.style.background).toBe('rgba(43, 50, 66, 0.4)')
    expect(thumb?.style.opacity).toBe('1')
    expect(thumb?.style.background).toBe('rgba(137, 147, 168, 0.6)')

    Object.defineProperty(scrollbar, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(scrollbar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 790, top: 0, width: 10, height: 400, right: 800, bottom: 400, x: 790, y: 0, toJSON: () => ({}) })
    })
    Object.defineProperty(thumb, 'offsetHeight', { configurable: true, value: 40 })
    scrollbar!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 795, clientY: 160 }))

    const messages = await workerMessages()
    expect(messages.core).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scroll-to-line', terminalId: 'panel-1' })
    ]))
    host.dispose()
  })

  it('selects visible grid text from the threaded canvas host', () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    })
    host.open(element)
    host.applySnapshot({
      terminalId: 'panel-1',
      seq: 1,
      cols: 80,
      rows: 10,
      cursorX: 0,
      cursorY: 9,
      cursorAbsoluteY: 9,
      viewportY: 0,
      baseY: 0,
      lines: [
        { y: 0, text: 'alpha beta', cells: [] },
        { y: 1, text: 'gamma', cells: [] }
      ],
      dirtyRows: [0, 1],
      full: true,
      visible: true,
      priority: 'active'
    })

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 48, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 48, clientY: 0 }))

    expect(host.hasSelection()).toBe(true)
    expect(host.getSelection()).toBe('alpha')
    expect(host.getSelectionPosition()).toEqual({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } })
    expect(element.querySelectorAll('.threaded-terminal-selection-rect').length).toBe(1)
    host.dispose()
  })

  it('skips duplicate threaded settings but forwards real changes', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    host.open(createHostElement())

    const before = await workerMessages()
    const settings = {
      terminalType: 'xterm-256color',
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: 'bar' as const,
      scrollBack: 2000
    }
    const theme = {
      background: '#090b10',
      foreground: '#d7dae3',
      cursor: '#8ccf7e',
      selectionBackground: '#2d4059'
    }

    host.updateSettings(settings, theme)
    host.updateSettings({ ...settings }, { ...theme })

    const afterDuplicates = await workerMessages()
    const duplicateCoreMessages = afterDuplicates.core.slice(before.core.length)
    const duplicateRenderMessages = afterDuplicates.render.slice(before.render.length)
    expect(duplicateCoreMessages.filter((message: any) => message.type === 'settings')).toHaveLength(0)
    expect(duplicateRenderMessages.filter((message: any) => message.type === 'settings')).toHaveLength(0)

    host.updateSettings({ ...settings, fontSize: 14 }, theme)

    const afterChange = await workerMessages()
    const changedCoreMessages = afterChange.core.slice(afterDuplicates.core.length)
    const changedRenderMessages = afterChange.render.slice(afterDuplicates.render.length)
    expect(changedCoreMessages.filter((message: any) => message.type === 'settings')).toEqual([
      expect.objectContaining({ type: 'settings', terminalId: 'panel-1', settings: expect.objectContaining({ fontSize: 14 }) })
    ])
    expect(changedRenderMessages.filter((message: any) => message.type === 'settings')).toEqual([
      expect.objectContaining({ type: 'settings', terminalId: 'panel-1', settings: expect.objectContaining({ fontSize: 14 }) })
    ])

    host.dispose()
  })
})
