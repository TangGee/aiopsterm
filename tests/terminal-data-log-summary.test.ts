import { describe, expect, it } from 'vitest'

type TerminalDataLogSummaryRuntime = {
  createTerminalDataLogSummary: (options?: { intervalMs?: number; chunkThreshold?: number; now?: () => number }) => {
    record: (id: string, bytes: number) => unknown
    flush: (id: string, reason: string) => unknown
  }
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/terminal/terminalDataLogSummary'
  return (await import(modulePath)) as TerminalDataLogSummaryRuntime
}

describe('terminalDataLogSummary', () => {
  it('aggregates terminal data chunks until the chunk threshold is reached', async () => {
    const { createTerminalDataLogSummary } = await loadRuntime()
    let now = 100
    const summary = createTerminalDataLogSummary({ chunkThreshold: 3, intervalMs: 1000, now: () => now })

    expect(summary.record('terminal-1', 4)).toBeNull()
    now += 10
    expect(summary.record('terminal-1', 6)).toBeNull()
    now += 10

    expect(summary.record('terminal-1', 2)).toEqual({
      id: 'terminal-1',
      reason: 'chunk-threshold',
      summary: {
        chunks: 3,
        bytes: 12,
        firstAt: 100,
        lastAt: 120,
        maxChunkBytes: 6
      }
    })
    expect(summary.flush('terminal-1', 'session-closed')).toBeNull()
  })

  it('flushes pending terminal data on demand', async () => {
    const { createTerminalDataLogSummary } = await loadRuntime()
    const summary = createTerminalDataLogSummary({ now: () => 200 })

    summary.record('terminal-1', 5)

    expect(summary.flush('terminal-1', 'session-closed')).toEqual({
      id: 'terminal-1',
      reason: 'session-closed',
      summary: {
        chunks: 1,
        bytes: 5,
        firstAt: 200,
        lastAt: 200,
        maxChunkBytes: 5
      }
    })
  })
})
