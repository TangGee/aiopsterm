import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ThreadedTerminalHost,
  quoteTerminalDropPath,
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

const clipboardRuntime = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
  readTextFromClipboard: vi.fn(async () => ({ ok: true, text: 'pasted-text' }))
}))

vi.mock('@/services/app/clipboardRuntime', () => clipboardRuntime)

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
      if ((message as { type?: string }).type === 'read-selection') {
        const request = message as { requestId?: string; terminalId?: string }
        this.onmessage?.({
          data: {
            type: 'read-selection-result',
            requestId: request.requestId,
            terminalId: request.terminalId,
            text: 'worker selection text'
          }
        } as MessageEvent)
      }
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
      if ((message as { type?: string }).type === 'attach-group') {
        const options = (message as { options?: { renderGroupId?: string; backend?: string; width?: number; height?: number } }).options
        this.onmessage?.({
          data: {
            type: 'group-attached',
            renderGroupId: options?.renderGroupId,
            backend: options?.backend || '2d',
            gpu: {
              renderer: 'Fake Runtime Renderer',
              vendor: 'Fake Runtime Vendor',
              unmaskedRenderer: 'Fake Runtime Hardware Renderer',
              unmaskedVendor: 'Fake Runtime Hardware Vendor'
            },
            width: options?.width || 0,
            height: options?.height || 0
          }
        } as MessageEvent)
      }
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: vi.fn(() => ({ width: 8 })),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: [] })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => []),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn()
  } as unknown as CanvasRenderingContext2D)
}

type HostOverrides = Partial<ConstructorParameters<typeof ThreadedTerminalHost>[0]>

const createHostOptions = (overrides: HostOverrides = {}): ConstructorParameters<typeof ThreadedTerminalHost>[0] => ({
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
    priority: 'active',
    ...overrides
  })

const createHost = (overrides: HostOverrides = {}) =>
  new ThreadedTerminalHost(createHostOptions(overrides))

const setHostElementSize = (hostElement: HTMLElement, width: number, height: number) => {
  Object.defineProperties(hostElement, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height }
  })
}

const createHostElement = () => {
  const grid = document.createElement('div')
  grid.className = 'terminal-grid'
  setHostElementSize(grid, 900, 500)
  const hostElement = document.createElement('div')
  hostElement.className = 'xterm-host'
  setHostElementSize(hostElement, 800, 400)
  grid.appendChild(hostElement)
  document.body.appendChild(grid)
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

const coreWorkers = async () => {
  const coreModule = await import('@/services/terminal/threadedTerminalCoreWorker?worker')
  return (coreModule.default as any).instances as Array<{ onmessage: ((event: MessageEvent) => void) | null }>
}

const drainMicrotasks = async (count = 4) => {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

const droppedFileEvent = (type: 'dragover' | 'drop', paths: string[]) => {
  const files = paths.map((path, index) => {
    const file = new File([''], path.split('/').pop() || `file-${index}`)
    Object.defineProperty(file, 'path', { configurable: true, value: path })
    return file
  })
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const dataTransfer = {
    files,
    types: ['Files'],
    dropEffect: 'none',
    getData: vi.fn(() => '')
  }
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: dataTransfer
  })
  return { event, dataTransfer }
}

afterEach(() => {
  document.body.replaceChildren()
  delete (HTMLCanvasElement.prototype as any).transferControlToOffscreen
  delete (globalThis as any).Worker
  delete (globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__
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
    expect(hostElement.querySelector('.threaded-terminal-surface')).toBeTruthy()
    expect(document.querySelector('.threaded-terminal-render-group-canvas')).toBeTruthy()
    expect(hostElement.querySelector('.threaded-terminal-selection-layer')).toBeTruthy()
    expect(hostElement.querySelector('.threaded-terminal-scrollbar')).toBeTruthy()
    expect(hostElement.querySelector('.threaded-terminal-input')).toBeInstanceOf(HTMLTextAreaElement)
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
        expect.objectContaining({ type: 'attach-group', options: expect.objectContaining({ renderGroupId: 'workspace-main' }) }),
        expect.objectContaining({ type: 'attach', options: expect.objectContaining({ terminalId: 'panel-1', groupId: 'group-1', renderGroupId: 'workspace-main' }) }),
        expect.objectContaining({ type: 'visibility', terminalId: 'panel-1', visible: false }),
        expect.objectContaining({ type: 'dispose', terminalId: 'panel-1' })
      ])
    )
  })

  it('emits title and progress changes received from the core worker', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const titles: string[] = []
    const progress: unknown[] = []
    host.onTitleChange((title) => titles.push(title))
    host.onProgressChange((item) => progress.push(item))
    host.open(createHostElement())

    const worker = (await coreWorkers())[0]
    worker.onmessage?.({ data: { type: 'title', terminalId: 'panel-1', title: 'vim main.ts' } } as MessageEvent)
    worker.onmessage?.({ data: { type: 'progress', terminalId: 'panel-1', progress: { status: 'running', value: 64, updatedAt: 1 } } } as MessageEvent)
    worker.onmessage?.({ data: { type: 'progress', terminalId: 'panel-1', progress: null } } as MessageEvent)

    expect(titles).toEqual(['vim main.ts'])
    expect(progress).toEqual([{ status: 'running', value: 64, updatedAt: 1 }, null])
    host.dispose()
  })

  it('uses a single host-owned terminal geometry for core sizing and render attach', async () => {
    installOffscreenCanvasSupport()
    const hostElement = createHostElement()
    setHostElementSize(hostElement, 180, 160)

    const host = createHost()
    host.open(hostElement)

    const messages = await workerMessages()
    const createMessage = messages.core.filter((message: any) => message.type === 'create').at(-1) as any
    const attachMessage = messages.render.filter((message: any) => message.type === 'attach').at(-1) as any

    expect(createMessage.options).toEqual(expect.objectContaining({
      cols: 21,
      rows: 10
    }))
    expect(attachMessage.options.geometry).toEqual(expect.objectContaining({
      canvasWidth: 170,
      canvasHeight: 160,
      cols: 21,
      rows: 10,
      cellWidth: 8,
      cellHeight: 15,
      baseline: 11,
      paddingLeft: 0,
      paddingRight: 2,
      paddingTop: 0,
      paddingBottom: 10
    }))
    expect(attachMessage.options.geometry.cols).toBe(createMessage.options.cols)
    expect(attachMessage.options.geometry.rows).toBe(createMessage.options.rows)
    host.dispose()
  })

  it('shares one workspace RenderGroup canvas across multiple threaded hosts', async () => {
    installOffscreenCanvasSupport()
    const firstElement = createHostElement()
    const grid = firstElement.parentElement as HTMLElement
    const secondElement = document.createElement('div')
    secondElement.className = 'xterm-host'
    setHostElementSize(secondElement, 600, 300)
    grid.appendChild(secondElement)

    const before = await workerMessages()
    const firstHost = createHost()
    const secondHost = createHost({
      terminalId: 'panel-2',
      sessionId: 'terminal-2',
      priority: 'visible'
    })

    firstHost.open(firstElement)
    secondHost.open(secondElement)

    const messages = await workerMessages()
    const renderMessages = messages.render.slice(before.render.length)
    expect(document.querySelectorAll('.threaded-terminal-render-group-canvas')).toHaveLength(1)
    expect(renderMessages.filter((message: any) => message.type === 'attach-group')).toHaveLength(1)
    expect(renderMessages.filter((message: any) => message.type === 'attach')).toHaveLength(2)
    expect(firstHost.debugInfo().surfaceAttached).toBe(true)
    expect(secondHost.debugInfo().surfaceAttached).toBe(true)
    expect((await import('@/services/terminal/threadedTerminalRuntime')).getThreadedTerminalDebugStats().renderGroups).toEqual([
      expect.objectContaining({
        renderGroupId: 'workspace-main',
        hosts: 2,
        requestedBackend: '2d',
        backend: '2d'
      })
    ])

    firstHost.dispose()
    secondHost.dispose()
  })

  it('requests WebGL2 RenderGroup backend only when explicitly enabled', async () => {
    installOffscreenCanvasSupport()
    ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = {
      AIOPSTERM_TERMINAL_RENDER_BACKEND: 'webgl2'
    }
    const before = await workerMessages()
    const host = createHost()
    host.open(createHostElement())

    const messages = await workerMessages()
    const renderMessages = messages.render.slice(before.render.length)
    const attachGroup = renderMessages.find((message: any) => message.type === 'attach-group') as any
    expect(attachGroup.options.backend).toBe('webgl2')
    expect((await import('@/services/terminal/threadedTerminalRuntime')).getThreadedTerminalDebugStats().renderGroups).toEqual([
      expect.objectContaining({
        requestedBackend: 'webgl2',
        backend: 'webgl2',
        gpu: expect.objectContaining({ unmaskedRenderer: 'Fake Runtime Hardware Renderer' })
      })
    ])

    host.dispose()
  })

  it('attaches a core-only threaded terminal in place when it becomes visible', async () => {
    installOffscreenCanvasSupport()
    const beforeCreate = await workerMessages()
    const host = createHost({ visible: false, priority: 'background' })
    host.startCoreOnly()
    host.applySnapshot({
      terminalId: 'panel-1',
      seq: 3,
      cols: 80,
      rows: 10,
      cursorX: 6,
      cursorY: 1,
      cursorAbsoluteY: 1,
      viewportY: 0,
      baseY: 0,
      lines: [{ y: 1, text: 'shell ready', cells: [] }],
      dirtyRows: [1],
      full: true,
      visible: true,
      priority: 'active'
    })

    const beforeOpen = await workerMessages()
    expect(beforeOpen.render.slice(beforeCreate.render.length).filter((message: any) => message.type === 'attach')).toEqual([])

    host.open(createHostElement())
    host.setVisibility(true, 'active')

    const afterOpen = await workerMessages()
    const newRenderMessages = afterOpen.render.slice(beforeOpen.render.length)
    expect(newRenderMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'attach-group', options: expect.objectContaining({ renderGroupId: 'workspace-main' }) }),
      expect.objectContaining({ type: 'attach', options: expect.objectContaining({ terminalId: 'panel-1', renderGroupId: 'workspace-main' }) }),
      expect.objectContaining({
        type: 'screen',
        snapshot: expect.objectContaining({
          terminalId: 'panel-1',
          full: true,
          fullReason: 'visibility',
          lines: expect.arrayContaining([expect.objectContaining({ y: 1, text: 'shell ready' })])
        })
      })
    ]))
    expect(afterOpen.core.slice(beforeOpen.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resize', terminalId: 'panel-1' }),
      expect.objectContaining({ type: 'visibility', terminalId: 'panel-1', visible: true, priority: 'active' })
    ]))
    host.dispose()
  })

  it('does not attach a render surface or resize the core while the host is not in a render group container', async () => {
    installOffscreenCanvasSupport()
    const orphan = document.createElement('div')
    orphan.className = 'xterm-host'
    setHostElementSize(orphan, 0, 0)

    const host = createHost({ visible: false, priority: 'background' })
    host.startCoreOnly()
    const beforeOpen = await workerMessages()

    host.open(orphan)
    host.setVisibility(true, 'active')
    host.ensureSurfaceAttached({ forceGeometry: true })

    const afterOrphanOpen = await workerMessages()
    expect(host.debugInfo().surfaceAttached).toBe(false)
    expect(afterOrphanOpen.render.slice(beforeOpen.render.length).filter((message: any) => message.type === 'attach' || message.type === 'attach-group')).toEqual([])
    expect(afterOrphanOpen.core.slice(beforeOpen.core.length)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resize', terminalId: 'panel-1', cols: 2, rows: 1 })
    ]))

    const grid = document.createElement('div')
    grid.className = 'terminal-grid'
    setHostElementSize(grid, 900, 500)
    setHostElementSize(orphan, 800, 400)
    grid.appendChild(orphan)
    document.body.appendChild(grid)

    host.ensureSurfaceAttached({ forceGeometry: true })

    const afterAttach = await workerMessages()
    const attachMessages = afterAttach.render.slice(afterOrphanOpen.render.length)
    expect(host.debugInfo().surfaceAttached).toBe(true)
    expect(attachMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'attach-group', options: expect.objectContaining({ renderGroupId: 'workspace-main' }) }),
      expect.objectContaining({ type: 'attach', options: expect.objectContaining({ terminalId: 'panel-1', renderGroupId: 'workspace-main' }) })
    ]))
    host.dispose()
  })

  it('defers split-pane intermediate zero and tiny sizes instead of resizing the core to 2x1', async () => {
    installOffscreenCanvasSupport()
    const hostElement = createHostElement()
    setHostElementSize(hostElement, 180, 160)
    const host = createHost()
    host.open(hostElement)

    const before = await workerMessages()
    setHostElementSize(hostElement, 2, 1)
    host.fit()

    const afterTiny = await workerMessages()
    const tinyCoreMessages = afterTiny.core.slice(before.core.length)
    const tinyRenderMessages = afterTiny.render.slice(before.render.length)
    expect(tinyCoreMessages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resize', terminalId: 'panel-1', cols: 2, rows: 1 })
    ]))
    expect(tinyRenderMessages.filter((message: any) => message.type === 'resize')).toEqual([])

    setHostElementSize(hostElement, 260, 160)
    host.fit()
    const afterStable = await workerMessages()
    expect(afterStable.core.slice(afterTiny.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resize', terminalId: 'panel-1', cols: 31, rows: 10 })
    ]))
    expect(afterStable.render.slice(afterTiny.render.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resize', terminalId: 'panel-1', geometry: expect.objectContaining({ canvasWidth: 250, cols: 31, rows: 10 }) })
    ]))
    host.dispose()
  })

  it('focuses the hidden input host for keyboard and IME events', () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    host.open(element)

    const input = element.querySelector<HTMLTextAreaElement>('.threaded-terminal-input')
    expect(input).toBeTruthy()
    host.focus()

    expect(document.activeElement).toBe(input)
    host.dispose()
  })

  it('keeps terminal copy and interrupt shortcuts separate', async () => {
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
      lines: [{ y: 0, text: 'copy me', cells: [] }],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active'
    })
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 64, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 64, clientY: 0 }))

    const beforeCopy = await workerMessages()
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'C', ctrlKey: true, shiftKey: true }))
    await Promise.resolve()
    const afterCopy = await workerMessages()
    const copyInputs = afterCopy.core.slice(beforeCopy.core.length).filter((message: any) => message.type === 'input')
    expect(copyInputs).toEqual([])
    expect(afterCopy.core).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'read-selection',
        terminalId: 'panel-1',
        range: { start: { x: 0, y: 0 }, end: { x: 8, y: 0 } }
      })
    ]))
    expect(clipboardRuntime.copyTextToClipboard).toHaveBeenCalledWith('worker selection text')

    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'c', ctrlKey: true }))
    const afterInterrupt = await workerMessages()
    expect(afterInterrupt.core).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: '\x03' })
    ]))
    host.dispose()
  })

  it('sets DOM copy event data synchronously while resolving full selection through the core worker', async () => {
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
      lines: [{ y: 0, text: 'copy me', cells: [] }],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active'
    })
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 64, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 64, clientY: 0 }))

    const setData = vi.fn()
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { configurable: true, value: { setData } })
    element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(setData).toHaveBeenCalledWith('text/plain', 'copy me')
    await drainMicrotasks()
    expect(clipboardRuntime.copyTextToClipboard).toHaveBeenCalledWith('worker selection text')
    host.dispose()
  })

  it('routes focused textarea terminal shortcuts like VTE copy and interrupt shortcuts', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    host.open(element)
    const input = element.querySelector<HTMLTextAreaElement>('.threaded-terminal-input')!
    host.focus()

    const beforeCopy = await workerMessages()
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'C', ctrlKey: true, shiftKey: true }))
    await Promise.resolve()
    const afterCopy = await workerMessages()
    expect(afterCopy.core.slice(beforeCopy.core.length).filter((message: any) => message.type === 'input')).toEqual([])

    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'c', ctrlKey: true }))
    const afterInterrupt = await workerMessages()
    expect(afterInterrupt.core).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: '\x03' })
    ]))
    expect(input.value).toBe('')
    host.dispose()
  })

  it('routes paste shortcuts through clipboard text without typing control characters', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    host.open(element)

    const before = await workerMessages()
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'V', ctrlKey: true, shiftKey: true }))
    await Promise.resolve()
    const after = await workerMessages()

    expect(clipboardRuntime.readTextFromClipboard).toHaveBeenCalled()
    expect(after.core.slice(before.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: 'pasted-text' })
    ]))
    host.dispose()
  })

  it('quotes dropped local file paths and writes them to terminal input', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    host.open(element)

    const dragover = droppedFileEvent('dragover', ['/tmp/report 1.txt'])
    element.dispatchEvent(dragover.event)
    expect(dragover.event.defaultPrevented).toBe(true)
    expect(dragover.dataTransfer.dropEffect).toBe('copy')

    const before = await workerMessages()
    const drop = droppedFileEvent('drop', [
      '/tmp/report 1.txt',
      "/home/ops/that's fine.log"
    ])
    element.dispatchEvent(drop.event)
    const after = await workerMessages()

    expect(drop.event.defaultPrevented).toBe(true)
    expect(after.core.slice(before.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'input',
        terminalId: 'panel-1',
        data: "'/tmp/report 1.txt' '/home/ops/that'\\''s fine.log'"
      })
    ]))
    host.dispose()
  })

  it('keeps safe dropped paths bare', () => {
    expect(quoteTerminalDropPath('/tmp/release-v1.2/app.log')).toBe('/tmp/release-v1.2/app.log')
    expect(quoteTerminalDropPath('/tmp/a b/app.log')).toBe("'/tmp/a b/app.log'")
  })

  it('sends committed textarea input and IME composition text once', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    host.open(element)
    const input = element.querySelector<HTMLTextAreaElement>('.threaded-terminal-input')!

    const beforePlain = await workerMessages()
    input.value = 'hello'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'hello', inputType: 'insertText' }))
    const afterPlain = await workerMessages()
    expect(afterPlain.core.slice(beforePlain.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: 'hello' })
    ]))
    expect(input.value).toBe('')

    const beforeComposition = await workerMessages()
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    input.value = 'zhong'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'zhong', inputType: 'insertCompositionText' }))
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))
    input.value = '中'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '中', inputType: 'insertFromComposition' }))
    const afterComposition = await workerMessages()
    const compositionInputs = afterComposition.core.slice(beforeComposition.core.length).filter((message: any) => message.type === 'input')
    expect(compositionInputs).toEqual([
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: '中' })
    ])
    expect(input.value).toBe('')
    host.dispose()
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
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 40, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 40, clientY: 0 }))

    expect(host.hasSelection()).toBe(true)
    expect(host.getSelection()).toBe('alpha')
    expect(host.getSelectionPosition()).toEqual({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } })
    expect(element.querySelectorAll('.threaded-terminal-selection-rect').length).toBe(1)
    host.dispose()
  })

  it('sends mouse events to mouse-aware terminal apps unless Shift forces selection', async () => {
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
      lines: [{ y: 0, text: 'vim row', cells: [] }],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active',
      modes: {
        applicationCursorKeysMode: true,
        applicationKeypadMode: false,
        bracketedPasteMode: false,
        mouseTrackingMode: 'vt200',
        activeBufferType: 'alternate'
      }
    })

    const beforeMouse = await workerMessages()
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 16, clientY: 30 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 16, clientY: 30 }))
    const afterMouse = await workerMessages()
    expect(afterMouse.core.slice(beforeMouse.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'mouse-event',
        terminalId: 'panel-1',
        event: expect.objectContaining({ action: 'down', button: 'left', col: 2, row: 2 })
      }),
      expect.objectContaining({
        type: 'mouse-event',
        terminalId: 'panel-1',
        event: expect.objectContaining({ action: 'up', button: 'left', col: 2, row: 2 })
      })
    ]))
    expect(host.hasSelection()).toBe(false)

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey: true, clientX: 0, clientY: 0 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, shiftKey: true, clientX: 24, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, shiftKey: true, clientX: 24, clientY: 0 }))
    expect(host.getSelection()).toBe('vim')
    host.dispose()
  })

  it('uses application cursor keys and alternate-screen wheel fallback for Vim-style editors', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
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
      lines: [{ y: 0, text: 'vim row', cells: [] }],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active',
      modes: {
        applicationCursorKeysMode: true,
        applicationKeypadMode: false,
        bracketedPasteMode: false,
        mouseTrackingMode: 'none',
        activeBufferType: 'alternate'
      }
    })

    const before = await workerMessages()
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp', keyCode: 38 }))
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home', keyCode: 36 }))
    element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30, clientX: 20, clientY: 20 }))
    const after = await workerMessages()
    expect(after.core.slice(before.core.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: '\x1bOA' }),
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: '\x1bOH' }),
      expect.objectContaining({ type: 'input', terminalId: 'panel-1', data: '\x1bOB\x1bOB' })
    ]))
    host.dispose()
  })

  it('anchors selection rectangles on the clicked terminal row', () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    const element = createHostElement()
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 800, height: 400, right: 900, bottom: 450, x: 100, y: 50, toJSON: () => ({}) })
    })
    host.open(element)
    const surface = element.querySelector<HTMLElement>('.threaded-terminal-surface')
    expect(surface).toBeTruthy()
    Object.defineProperty(surface, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 50, width: 790, height: 400, right: 890, bottom: 450, x: 100, y: 50, toJSON: () => ({}) })
    })
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
      lines: Array.from({ length: 10 }, (_item, row) => ({ y: row, text: `row-${row}-value`, cells: [] })),
      dirtyRows: Array.from({ length: 10 }, (_item, row) => row),
      full: true,
      visible: true,
      priority: 'active'
    })

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 50 + 3 * 15 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 100 + 55, clientY: 50 + 3 * 15 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 100 + 55, clientY: 50 + 3 * 15 }))

    const rect = element.querySelector<HTMLElement>('.threaded-terminal-selection-rect')
    expect(host.getSelection()).toBe('row-3-')
    expect(host.getSelectionPosition()).toEqual({ start: { x: 0, y: 103 }, end: { x: 6, y: 103 } })
    expect(rect?.style.position).toBe('absolute')
    expect(rect?.style.top).toBe(`${3 * 15}px`)
    host.dispose()
  })

  it('copies soft-wrapped selected rows as one logical line', () => {
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
        { y: 0, text: './.claude/plugins/marketplaces/claude-plugins-official/plugins/security-gui', cells: [] },
        { y: 1, text: 'dance/hooks/diffstate.py', cells: [], wrapped: true }
      ],
      dirtyRows: [0, 1],
      full: true,
      visible: true,
      priority: 'active'
    })

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 9 * 24, clientY: 15 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 9 * 24, clientY: 15 }))

    expect(host.getSelection()).toBe('./.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/hooks/diffstate.py')
    host.dispose()
  })

  it('copies wide glyphs using terminal cell columns', () => {
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
        {
          y: 0,
          text: 'a你b',
          runs: [{ x: 0, text: 'a你b', chars: ['a', '你', 'b'], widths: [1, 2, 1], columns: 4 }],
          cells: []
        }
      ],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active'
    })

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 9, clientY: 0 }))
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 36, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 36, clientY: 0 }))

    expect(host.getSelection()).toBe('你b')
    expect(host.getSelectionPosition()).toEqual({ start: { x: 1, y: 0 }, end: { x: 4, y: 0 } })
    host.dispose()
  })

  it('selects a word on double click and the wrapped logical line on triple click', () => {
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
        { y: 0, text: 'first command-value tail', cells: [] },
        { y: 1, text: 'wrapped-tail next', cells: [], wrapped: true },
        { y: 2, text: 'separate row', cells: [] }
      ],
      dirtyRows: [0, 1, 2],
      full: true,
      visible: true,
      priority: 'active'
    })

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2, clientX: 9 * 8, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 2, clientX: 9 * 8, clientY: 0 }))
    expect(host.getSelection()).toBe('command-value')

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 3, clientX: 9 * 4, clientY: 15 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 3, clientX: 9 * 4, clientY: 15 }))
    expect(host.getSelection()).toBe('first command-value tailwrapped-tail next')
    expect(host.getSelectionPosition()).toEqual({ start: { x: 0, y: 0 }, end: { x: 80, y: 1 } })
    host.dispose()
  })

  it('selects wide-glyph words from terminal cell coordinates', () => {
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
        {
          y: 0,
          text: 'go你好 tail',
          runs: [
            { x: 0, text: 'go你好 tail', chars: ['g', 'o', '你', '好', ' ', 't', 'a', 'i', 'l'], widths: [1, 1, 2, 2, 1, 1, 1, 1, 1], columns: 11 }
          ],
          cells: []
        }
      ],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active'
    })

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2, clientX: 27, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 2, clientX: 27, clientY: 0 }))

    expect(host.getSelection()).toBe('go你好')
    expect(host.getSelectionPosition()).toEqual({ start: { x: 0, y: 0 }, end: { x: 6, y: 0 } })
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

  it('gates threaded terminal perf logs behind the terminal debug switch', async () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    host.startCoreOnly()
    const messages = await workerMessages()
    const coreWorker = (await import('@/services/terminal/threadedTerminalCoreWorker?worker')).default as any
    const renderWorker = (await import('@/services/terminal/threadedTerminalRenderWorker?worker')).default as any
    const core = coreWorker.instances[0]
    const render = renderWorker.instances[0]

    core.onmessage?.({
      data: {
        type: 'perf',
        sample: {
          terminalId: 'panel-1',
          priority: 'active',
          visible: true,
          chunks: 1,
          bytes: 12,
          parseMs: 1,
          snapshotMs: 1,
          flushMs: 1,
          pendingBytes: 0,
          pendingChunks: 0,
          maxPendingBytes: 12,
          droppedPaints: 0
        }
      }
    } as MessageEvent)
    render.onmessage?.({
      data: {
        type: 'perf',
        terminalId: 'panel-1',
        frames: 1,
        avgFrameMs: 2,
        maxFrameMs: 3,
        skippedFrames: 0
      }
    } as MessageEvent)
    expect(logs.filter((log) => log.event.includes('-perf'))).toEqual([])

    ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = {
      AIOPSTERM_TERMINAL_DEBUG_LOGS: '1'
    }
    core.onmessage?.({
      data: {
        type: 'perf',
        sample: {
          terminalId: 'panel-1',
          priority: 'active',
          visible: true,
          chunks: 1,
          bytes: 24,
          parseMs: 1,
          snapshotMs: 1,
          flushMs: 1,
          pendingBytes: 0,
          pendingChunks: 0,
          maxPendingBytes: 24,
          droppedPaints: 0
        }
      }
    } as MessageEvent)
    render.onmessage?.({
      data: {
        type: 'perf',
        terminalId: 'panel-1',
        frames: 2,
        avgFrameMs: 2,
        maxFrameMs: 4,
        skippedFrames: 0
      }
    } as MessageEvent)

    expect(messages.core.length).toBeGreaterThan(0)
    expect(logs.filter((log) => log.event.includes('-perf')).map((log) => log.event)).toEqual([
      'renderer.threaded-terminal.core-perf',
      'renderer.threaded-terminal.render-perf'
    ])
    host.dispose()
  })

  it('returns cloned threaded terminal debug snapshots for stress probes', () => {
    installOffscreenCanvasSupport()
    const host = createHost()
    host.open(createHostElement())
    host.applySnapshot({
      terminalId: 'panel-1',
      seq: 7,
      cols: 80,
      rows: 10,
      cursorX: 0,
      cursorY: 9,
      cursorAbsoluteY: 19,
      viewportY: 10,
      baseY: 10,
      lines: [
        {
          y: 0,
          text: 'styled',
          runs: [{ x: 0, text: 'styled', fg: '#ff0000', chars: ['s'], widths: [1] }],
          cells: [{ x: 0, text: 'styled', fg: '#00ff00', chars: ['s'], widths: [1] }],
          highlights: [{ x: 0, text: 'sty', fg: '#ffff00', chars: ['s'], widths: [1] }]
        }
      ],
      dirtyRows: [0],
      full: true,
      visible: true,
      priority: 'active'
    })

    const snapshot = host.debugSnapshot()
    snapshot.lines[0]!.runs![0]!.fg = '#000000'
    snapshot.lines[0]!.runs![0]!.chars!.push('x')
    snapshot.lines[0]!.cells![0]!.fg = '#000000'
    snapshot.lines[0]!.highlights![0]!.fg = '#000000'

    const nextSnapshot = host.debugSnapshot()
    expect(nextSnapshot.text).toContain('styled')
    expect(nextSnapshot.viewportY).toBe(10)
    expect(nextSnapshot.baseY).toBe(10)
    expect(nextSnapshot.lines[0]?.runs?.[0]).toEqual(expect.objectContaining({ fg: '#ff0000', chars: ['s'] }))
    expect(nextSnapshot.lines[0]?.cells?.[0]).toEqual(expect.objectContaining({ fg: '#00ff00', chars: ['s'] }))
    expect(nextSnapshot.lines[0]?.highlights?.[0]).toEqual(expect.objectContaining({ fg: '#ffff00', chars: ['s'] }))
    host.dispose()
  })
})
