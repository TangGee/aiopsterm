export type TerminalDataCoalescerChunk = string | Buffer

export type TerminalDataCoalescerFlush = {
  id: string
  chunk: TerminalDataCoalescerChunk
  chunks: number
  bytes: number
  durationMs: number
  maxChunkBytes: number
}

export type TerminalDataCoalescerOptions = {
  maxBytes?: number
  smallBytes?: number
  mediumBytes?: number
  smallDelayMs?: number
  mediumDelayMs?: number
  bulkDelayMs?: number
  maxDelayMs?: number
  byteLength?: (chunk: TerminalDataCoalescerChunk) => number
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
  onFlush: (flush: TerminalDataCoalescerFlush) => void
}

type TerminalDataCoalescerPending = {
  chunks: TerminalDataCoalescerChunk[]
  bytes: number
  count: number
  firstAt: number
  lastAt: number
  maxChunkBytes: number
  hasBuffer: boolean
  timer: unknown | null
}

const defaultByteLength = (chunk: TerminalDataCoalescerChunk) => (Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk || ''), 'utf8'))

const coalescedChunk = (chunks: TerminalDataCoalescerChunk[], hasBuffer: boolean): TerminalDataCoalescerChunk => {
  if (!hasBuffer) return chunks.map((chunk) => String(chunk || '')).join('')
  return Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8'))))
}

export const createTerminalDataCoalescer = (options: TerminalDataCoalescerOptions) => {
  const maxBytes = options.maxBytes ?? 64 * 1024
  const smallBytes = options.smallBytes ?? 256
  const mediumBytes = options.mediumBytes ?? 1024
  const smallDelayMs = options.smallDelayMs ?? 10
  const mediumDelayMs = options.mediumDelayMs ?? 30
  const bulkDelayMs = options.bulkDelayMs ?? 50
  const maxDelayMs = options.maxDelayMs ?? 16
  const byteLength = options.byteLength || defaultByteLength
  const now = options.now || Date.now
  const setTimer = options.setTimer || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer || ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout))
  const pending = new Map<string, TerminalDataCoalescerPending>()

  const delayFor = (bytes: number) => {
    if (bytes <= 0) return 0
    const tierDelay = bytes < smallBytes ? smallDelayMs : bytes < mediumBytes ? mediumDelayMs : bulkDelayMs
    return Math.max(0, Math.min(tierDelay, maxDelayMs))
  }

  const flush = (id: string, reason = 'manual') => {
    const entry = pending.get(id)
    if (!entry) return null
    pending.delete(id)
    if (entry.timer) clearTimer(entry.timer)
    const chunk = coalescedChunk(entry.chunks, entry.hasBuffer)
    const result: TerminalDataCoalescerFlush = {
      id,
      chunk,
      chunks: entry.count,
      bytes: entry.bytes,
      durationMs: Math.max(0, entry.lastAt - entry.firstAt),
      maxChunkBytes: entry.maxChunkBytes
    }
    void reason
    options.onFlush(result)
    return result
  }

  const schedule = (id: string, entry: TerminalDataCoalescerPending) => {
    if (entry.timer) return
    const delay = delayFor(entry.bytes)
    if (delay <= 0) {
      flush(id, 'immediate')
      return
    }
    entry.timer = setTimer(() => {
      const latest = pending.get(id)
      if (latest) latest.timer = null
      flush(id, 'timer')
    }, delay)
  }

  const push = (id: string, chunk: TerminalDataCoalescerChunk) => {
    const bytes = byteLength(chunk)
    if (!id || bytes <= 0) return null
    const at = now()
    const existing = pending.get(id)
    const entry =
      existing ||
      {
        chunks: [],
        bytes: 0,
        count: 0,
        firstAt: at,
        lastAt: at,
        maxChunkBytes: 0,
        hasBuffer: false,
        timer: null
      }
    entry.chunks.push(chunk)
    entry.bytes += bytes
    entry.count += 1
    entry.lastAt = at
    entry.maxChunkBytes = Math.max(entry.maxChunkBytes, bytes)
    entry.hasBuffer = entry.hasBuffer || Buffer.isBuffer(chunk)
    pending.set(id, entry)
    if (entry.bytes >= maxBytes) return flush(id, 'max-bytes')
    schedule(id, entry)
    return null
  }

  const flushAll = (reason = 'manual') => [...pending.keys()].map((id) => flush(id, reason)).filter(Boolean) as TerminalDataCoalescerFlush[]

  return {
    push,
    flush,
    flushAll,
    pendingCount: () => pending.size
  }
}
