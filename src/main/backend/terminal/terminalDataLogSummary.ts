export type TerminalDataLogSummary = {
  chunks: number
  bytes: number
  firstAt: number
  lastAt: number
  maxChunkBytes: number
}

export type TerminalDataLogSummaryFlush = {
  id: string
  summary: TerminalDataLogSummary
  reason: string
}

export type TerminalDataLogSummaryOptions = {
  intervalMs?: number
  chunkThreshold?: number
  now?: () => number
}

export const createTerminalDataLogSummary = (options: TerminalDataLogSummaryOptions = {}) => {
  const intervalMs = options.intervalMs ?? 1000
  const chunkThreshold = options.chunkThreshold ?? 50
  const now = options.now || Date.now
  const summaries = new Map<string, TerminalDataLogSummary>()

  const record = (id: string, bytes: number): TerminalDataLogSummaryFlush | null => {
    const at = now()
    const existing = summaries.get(id)
    if (!existing) {
      summaries.set(id, {
        chunks: 1,
        bytes,
        firstAt: at,
        lastAt: at,
        maxChunkBytes: bytes
      })
      return null
    }
    existing.chunks += 1
    existing.bytes += bytes
    existing.lastAt = at
    existing.maxChunkBytes = Math.max(existing.maxChunkBytes, bytes)
    if (existing.lastAt - existing.firstAt >= intervalMs || existing.chunks >= chunkThreshold) {
      summaries.delete(id)
      return {
        id,
        summary: existing,
        reason: existing.chunks >= chunkThreshold ? 'chunk-threshold' : 'interval'
      }
    }
    return null
  }

  const flush = (id: string, reason: string): TerminalDataLogSummaryFlush | null => {
    const summary = summaries.get(id)
    if (!summary) return null
    summaries.delete(id)
    return { id, summary, reason }
  }

  const flushAll = (reason: string) => {
    const result = [...summaries.entries()].map(([id, summary]) => ({ id, summary, reason }))
    summaries.clear()
    return result
  }

  return { record, flush, flushAll }
}
