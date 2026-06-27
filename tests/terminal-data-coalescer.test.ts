import { describe, expect, it } from 'vitest'

type TerminalDataCoalescerFlush = {
  id: string
  chunk: string | Buffer
  chunks: number
  bytes: number
  durationMs: number
  maxChunkBytes: number
}

type TerminalDataCoalescerRuntime = {
  createTerminalDataCoalescer: (options: {
    maxBytes?: number
    smallBytes?: number
    mediumBytes?: number
    smallDelayMs?: number
    mediumDelayMs?: number
    bulkDelayMs?: number
    maxDelayMs?: number
    now?: () => number
    setTimer?: (callback: () => void, delayMs: number) => unknown
    clearTimer?: (timer: unknown) => void
    onFlush: (flush: TerminalDataCoalescerFlush) => void
  }) => {
    push: (id: string, chunk: string | Buffer) => TerminalDataCoalescerFlush | null
    flush: (id: string, reason?: string) => TerminalDataCoalescerFlush | null
  }
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/terminal/terminalDataCoalescer'
  return (await import(modulePath)) as TerminalDataCoalescerRuntime
}

describe('terminalDataCoalescer', () => {
  it('coalesces string terminal data until its timer flushes', async () => {
    const { createTerminalDataCoalescer } = await loadRuntime()
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const flushes: TerminalDataCoalescerFlush[] = []
    let now = 100
    const coalescer = createTerminalDataCoalescer({
      now: () => now,
      setTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs })
        return callback
      },
      clearTimer: () => undefined,
      onFlush: (flush) => flushes.push(flush)
    })

    expect(coalescer.push('terminal-1', 'hello')).toBeNull()
    now += 4
    expect(coalescer.push('terminal-1', ' world')).toBeNull()
    expect(timers).toEqual([{ callback: expect.any(Function), delayMs: 10 }])

    timers[0].callback()

    expect(flushes).toHaveLength(1)
    expect(flushes[0]).toEqual({
      id: 'terminal-1',
      chunk: 'hello world',
      chunks: 2,
      bytes: 11,
      durationMs: 4,
      maxChunkBytes: 6
    })
  })

  it('preserves raw Buffer bytes when coalescing mixed terminal data', async () => {
    const { createTerminalDataCoalescer } = await loadRuntime()
    const flushes: TerminalDataCoalescerFlush[] = []
    const coalescer = createTerminalDataCoalescer({
      setTimer: () => 'timer',
      clearTimer: () => undefined,
      onFlush: (flush) => flushes.push(flush)
    })

    coalescer.push('terminal-raw', Buffer.from([0x2a, 0x2a]))
    coalescer.push('terminal-raw', '\x18B')
    coalescer.flush('terminal-raw', 'manual')

    expect(flushes).toHaveLength(1)
    expect(Buffer.isBuffer(flushes[0].chunk)).toBe(true)
    expect(Array.from(flushes[0].chunk as Buffer)).toEqual([0x2a, 0x2a, 0x18, 0x42])
    expect(flushes[0]).toEqual(expect.objectContaining({ chunks: 2, bytes: 4, maxChunkBytes: 2 }))
  })

  it('flushes immediately when the pending byte limit is reached', async () => {
    const { createTerminalDataCoalescer } = await loadRuntime()
    const flushes: TerminalDataCoalescerFlush[] = []
    const coalescer = createTerminalDataCoalescer({
      maxBytes: 5,
      setTimer: () => 'timer',
      clearTimer: () => undefined,
      onFlush: (flush) => flushes.push(flush)
    })

    const flush = coalescer.push('terminal-1', '12345')

    expect(flush).toEqual(expect.objectContaining({ chunk: '12345', chunks: 1, bytes: 5 }))
    expect(flushes).toEqual([expect.objectContaining({ chunk: '12345', chunks: 1, bytes: 5 })])
  })

  it('uses the bulk merge window by default for large terminal chunks', async () => {
    const { createTerminalDataCoalescer } = await loadRuntime()
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const coalescer = createTerminalDataCoalescer({
      setTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs })
        return callback
      },
      clearTimer: () => undefined,
      onFlush: () => undefined
    })

    coalescer.push('terminal-1', 'x'.repeat(2048))

    expect(timers).toEqual([{ callback: expect.any(Function), delayMs: 50 }])
  })

  it('honors an explicit max delay cap for interactive data', async () => {
    const { createTerminalDataCoalescer } = await loadRuntime()
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const coalescer = createTerminalDataCoalescer({
      maxDelayMs: 16,
      setTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs })
        return callback
      },
      clearTimer: () => undefined,
      onFlush: () => undefined
    })

    coalescer.push('terminal-1', 'x'.repeat(2048))

    expect(timers).toEqual([{ callback: expect.any(Function), delayMs: 16 }])
  })
})
