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
})
