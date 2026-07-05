import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ThreadedTerminalCoreRequest,
  ThreadedTerminalCoreResponse,
  ThreadedTerminalCreateOptions,
  ThreadedTerminalScreenSnapshot
} from '@/services/terminal/threadedTerminalProtocol'

type TestWorkerScope = {
  onmessage: ((event: MessageEvent<ThreadedTerminalCoreRequest>) => void) | null
  postMessage: (message: ThreadedTerminalCoreResponse) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

const createOptions = (): ThreadedTerminalCreateOptions => ({
  terminalId: 'core-worker-terminal',
  sessionId: 'session-1',
  groupId: 'group-1',
  surface: 'workspace',
  cols: 24,
  rows: 5,
  visible: true,
  priority: 'active',
  settings: {
    terminalType: 'xterm-256color',
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    lineHeight: 1,
    cursorBlink: false,
    cursorStyle: 'block',
    scrollBack: 100
  },
  theme: {
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#ffffff'
  }
})

const waitFor = async <T>(callback: () => T | undefined | false, timeoutMs = 1500): Promise<T> => {
  const startedAt = Date.now()
  for (;;) {
    const value = callback()
    if (value) return value
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for threaded core worker test condition.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const latestScreen = (messages: ThreadedTerminalCoreResponse[]) =>
  messages.filter((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'screen' }> => message.type === 'screen').at(-1)?.snapshot

const visibleText = (snapshot: ThreadedTerminalScreenSnapshot) => snapshot.lines.map((line) => line.text.trim()).join('\n')

describe('threadedTerminalCoreWorker', () => {
  let originalSelfDescriptor: PropertyDescriptor | undefined
  let scope: TestWorkerScope
  let messages: ThreadedTerminalCoreResponse[]

  beforeEach(async () => {
    vi.resetModules()
    messages = []
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
    await import('@/services/terminal/threadedTerminalCoreWorker')
    await waitFor(() => messages.some((message) => message.type === 'ready'))
  })

  afterEach(() => {
    scope.onmessage?.({ data: { type: 'dispose', terminalId: createOptions().terminalId } } as MessageEvent<ThreadedTerminalCoreRequest>)
    if (originalSelfDescriptor) {
      Object.defineProperty(globalThis, 'self', originalSelfDescriptor)
    } else {
      delete (globalThis as { self?: unknown }).self
    }
  })

  const send = (message: ThreadedTerminalCoreRequest) => {
    scope.onmessage?.({ data: message } as MessageEvent<ThreadedTerminalCoreRequest>)
  }

  const createTerminal = async () => {
    send({ type: 'create', requestId: 'create-1', options: createOptions() })
    await waitFor(() => messages.some((message) => message.type === 'created'))
  }

  it('keeps the visible snapshot at the bottom while output grows', async () => {
    await createTerminal()
    send({
      type: 'data',
      terminalId: createOptions().terminalId,
      data: Array.from({ length: 18 }, (_item, index) => `line-${index}\n`).join('')
    })

    const first = await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && visibleText(snapshot).includes('line-17') ? snapshot : undefined
    })
    expect(first.viewportY).toBe(first.baseY)

    send({ type: 'data', terminalId: createOptions().terminalId, data: 'after-find\n' })
    const next = await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && snapshot.seq > first.seq && visibleText(snapshot).includes('after-find') ? snapshot : undefined
    })

    expect(next.viewportY).toBe(next.baseY)
    expect(visibleText(next)).toContain('after-find')
  })

  it('emits title and progress protocol events from OSC sequences', async () => {
    await createTerminal()
    send({ type: 'data', terminalId: createOptions().terminalId, data: '\x1b]2;Build active\x07' })

    const title = await waitFor(() =>
      messages.find((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'title' }> => message.type === 'title' && message.title === 'Build active')
    )
    expect(title).toEqual({ type: 'title', terminalId: createOptions().terminalId, title: 'Build active' })

    const titleCount = messages.filter((message) => message.type === 'title').length
    send({ type: 'data', terminalId: createOptions().terminalId, data: '\x1b]2;root@tlinux:~\x07' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(messages.filter((message) => message.type === 'title')).toHaveLength(titleCount)

    send({ type: 'data', terminalId: createOptions().terminalId, data: '\x1b]9;4;1;33\x07' })
    const progress = await waitFor(() =>
      messages.find((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'progress' }> => message.type === 'progress' && message.progress?.value === 33)
    )
    expect(progress).toEqual({
      type: 'progress',
      terminalId: createOptions().terminalId,
      progress: expect.objectContaining({ status: 'running', value: 33 })
    })

    send({ type: 'data', terminalId: createOptions().terminalId, data: '\x1b]9;4;0;0\x07' })
    const reset = await waitFor(() =>
      messages.find((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'progress' }> => message.type === 'progress' && message.progress === null)
    )
    expect(reset).toEqual({ type: 'progress', terminalId: createOptions().terminalId, progress: null })
  })

  it('preserves user scrollback on output and returns to bottom on input', async () => {
    await createTerminal()
    send({
      type: 'data',
      terminalId: createOptions().terminalId,
      data: Array.from({ length: 18 }, (_item, index) => `line-${index}\n`).join('')
    })
    const bottom = await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && visibleText(snapshot).includes('line-17') ? snapshot : undefined
    })

    send({ type: 'scroll-lines', terminalId: createOptions().terminalId, amount: -3 })
    const scrolled = await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && snapshot.seq > bottom.seq && snapshot.viewportY < snapshot.baseY ? snapshot : undefined
    })

    send({ type: 'data', terminalId: createOptions().terminalId, data: 'background-output\n' })
    const stillScrolled = await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && snapshot.seq > scrolled.seq ? snapshot : undefined
    })
    expect(stillScrolled.viewportY).toBeLessThan(stillScrolled.baseY)

    send({ type: 'input', terminalId: createOptions().terminalId, data: 'x' })
    const afterInput = await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && snapshot.seq > stillScrolled.seq && snapshot.viewportY === snapshot.baseY ? snapshot : undefined
    })
    expect(afterInput.viewportY).toBe(afterInput.baseY)
  })

  it('exports xterm cell widths for wide glyph rendering', async () => {
    await createTerminal()
    send({ type: 'data', terminalId: createOptions().terminalId, data: 'a你b\n' })

    const snapshot = await waitFor(() => {
      const next = latestScreen(messages)
      return next?.lines.some((line) => line.text.includes('a你b')) ? next : undefined
    })
    const line = snapshot.lines.find((item) => item.text.includes('a你b'))
    expect(line?.runs?.[0]).toMatchObject({
      x: 0,
      text: expect.stringContaining('a你b'),
      chars: expect.arrayContaining(['a', '你', 'b'])
    })
    expect(line?.runs?.[0].widths?.slice(0, 3)).toEqual([1, 2, 1])
    expect(line?.runs?.[0].columns).toBeGreaterThanOrEqual(4)
  })

  it('emits a dirty row when only ANSI style changes on a cursor-addressed TUI row', async () => {
    await createTerminal()
    send({ type: 'data', terminalId: createOptions().terminalId, data: 'top\nstatus\nprompt\n' })
    const initial = await waitFor(() => {
      const next = latestScreen(messages)
      return next && visibleText(next).includes('prompt') ? next : undefined
    })

    send({
      type: 'data',
      terminalId: createOptions().terminalId,
      data: '\x1b[2;1H\x1b[38;2;10;20;30mWorking\x1b[39m\x1b[4;1H'
    })
    const firstFrame = await waitFor(() => {
      const next = latestScreen(messages)
      return next && next.seq > initial.seq && next.lines.some((line) => line.text.includes('Working')) ? next : undefined
    })
    const firstWorkingLine = firstFrame.lines.find((line) => line.text.includes('Working'))
    expect(firstWorkingLine?.cells?.[0]).toMatchObject({ x: 0, fg: '#0a141e', bold: undefined })

    send({
      type: 'data',
      terminalId: createOptions().terminalId,
      data: '\x1b[2;1H\x1b[1;38;2;200;100;50mWorking\x1b[0m\x1b[4;1H'
    })
    const secondFrame = await waitFor(() => {
      const next = latestScreen(messages)
      return next && next.seq > firstFrame.seq && next.lines.some((line) => line.text.includes('Working')) ? next : undefined
    })
    const secondWorkingLine = secondFrame.lines.find((line) => line.text.includes('Working'))

    expect(secondFrame.dirtyRows).toContain(firstWorkingLine?.y)
    expect(secondWorkingLine?.cells?.[0]).toMatchObject({ x: 0, fg: '#c86432', bold: true })
  })

  it('uses the shared dirty snapshot path for Codex and workspace terminal output', async () => {
    send({
      type: 'create',
      requestId: 'create-codex-1',
      options: {
        ...createOptions(),
        terminalId: 'core-worker-codex',
        sessionId: 'codex-session-1',
        surface: 'codex'
      }
    })
    await waitFor(() => messages.some((message) => message.type === 'created' && message.terminalId === 'core-worker-codex'))
    await waitFor(() => {
      const snapshot = messages
        .filter((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'screen' }> => message.type === 'screen')
        .find((message) => message.snapshot.terminalId === 'core-worker-codex' && message.snapshot.fullReason === 'create')
      return snapshot?.snapshot
    })

    send({
      type: 'data',
      terminalId: 'core-worker-codex',
      data: 'Codex\n\x1b[2;1HWorking\x1b[K\x1b[3;1H'
    })
    const codexFrame = await waitFor(() => {
      const next = latestScreen(messages.filter((message) => message.type !== 'screen' || message.snapshot.terminalId === 'core-worker-codex'))
      return next && visibleText(next).includes('Working') && next.fullReason !== 'create' ? next : undefined
    })

    expect(codexFrame.full).toBe(false)
    expect(codexFrame.dirtyRows).toContain(1)

    await createTerminal()
    send({ type: 'data', terminalId: createOptions().terminalId, data: 'workspace\n' })
    const workspaceFrame = await waitFor(() => {
      const next = latestScreen(messages.filter((message) => message.type !== 'screen' || message.snapshot.terminalId === createOptions().terminalId))
      return next && visibleText(next).includes('workspace') && next.fullReason !== 'create' ? next : undefined
    })
    expect(workspaceFrame.full).toBe(false)
  })

  it('reads selected text from the full scrollback buffer with wrapped rows and wide glyph cells', async () => {
    await createTerminal()
    send({
      type: 'data',
      terminalId: createOptions().terminalId,
      data: [
        'line-0\n',
        'wide-你-tail\n',
        'soft-wrap-part-one-',
        'part-two\n',
        'line-4\n',
        'line-5\n',
        'line-6\n',
        'line-7\n',
        'line-8\n'
      ].join('')
    })
    await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot && snapshot.baseY > 0 ? snapshot : undefined
    })

    send({
      type: 'read-selection',
      terminalId: createOptions().terminalId,
      requestId: 'selection-1',
      range: {
        start: { x: 5, y: 1 },
        end: { x: 8, y: 3 }
      }
    })

    const result = await waitFor(() =>
      messages.find((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'read-selection-result' }> =>
        message.type === 'read-selection-result' && message.requestId === 'selection-1'
      )
    )
    expect(result.text).toContain('你-')
    expect(result.text).toContain('soft-wrap-part-one-part-two')
  })

  it('forwards xterm mouse tracking reports through the core worker', async () => {
    await createTerminal()
    send({ type: 'data', terminalId: createOptions().terminalId, data: '\x1b[?1000h\x1b[?1006h' })
    await waitFor(() => {
      const snapshot = latestScreen(messages)
      return snapshot?.modes?.mouseTrackingMode === 'vt200' ? snapshot : undefined
    })

    send({
      type: 'mouse-event',
      terminalId: createOptions().terminalId,
      event: {
        x: 8,
        y: 10,
        col: 1,
        row: 2,
        button: 'left',
        action: 'down'
      }
    })

    const data = await waitFor(() =>
      messages.find((message): message is Extract<ThreadedTerminalCoreResponse, { type: 'data' }> =>
        message.type === 'data' && message.data.includes('\x1b[<0;2;3M')
      )
    )
    expect(data.data).toBe('\x1b[<0;2;3M')
  })
})
