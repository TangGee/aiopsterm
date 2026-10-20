import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createVoiceInstallLog, voiceInstallError, type VoiceInstallLog } from './voiceInstallDiagnostics'

const maxArchiveSize = 600 * 1024 * 1024
const maxAttempts = 3
type DownloadTiming = { responseTimeoutMs: number; idleTimeoutMs: number; retryDelayMs: number }
const defaultTiming: DownloadTiming = { responseTimeoutMs: 20_000, idleTimeoutMs: 30_000, retryDelayMs: 400 }

class InvalidDownload extends Error {}

// Keep the request signal alive until its body has finished, not just its headers.
const withResponse = async <T>(
  fetcher: typeof fetch, url: string, headers: Record<string, string>, signal: AbortSignal,
  timing: DownloadTiming,
  log: VoiceInstallLog,
  consume: (response: Response, signal: AbortSignal, activity: () => void) => Promise<T>
): Promise<T> => {
  signal.throwIfAborted()
  const request = new AbortController()
  const abort = () => request.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout>
  let response: Response | undefined
  const arm = (ms: number, message: string) => {
    clearTimeout(timer)
    timer = setTimeout(() => request.abort(new Error(message)), ms)
  }
  let rejectAborted: (reason: unknown) => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject })
  const onAbort = () => rejectAborted(request.signal.reason)
  request.signal.addEventListener('abort', onAbort, { once: true })
  const cancelBody = (value: Response) => {
    // Cancelling a network body must not itself hold up cancellation or retries.
    if (value.body && !value.body.locked) void value.body.cancel().catch(() => {})
  }
  try {
    arm(timing.responseTimeoutMs, 'Voice download timed out waiting for the server response.')
    const pending = fetcher(url, {
      signal: request.signal, cache: 'no-store',
      headers: { ...(url.startsWith('https://api.github.com/') ? { Accept: 'application/octet-stream' } : {}), ...headers }
    }).then((value) => {
      if (request.signal.aborted) { cancelBody(value); throw request.signal.reason }
      return value
    })
    response = await Promise.race([pending, aborted])
    log('info', 'download.response', {
      range: headers.Range, status: response.status,
      length: response.headers.get('content-length'), contentRange: response.headers.get('content-range'),
      retryAfter: response.headers.get('retry-after'),
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
      rateLimitReset: response.headers.get('x-ratelimit-reset')
    })
    if (!response.ok || !response.body) {
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'))
        const retryAt = reset > 0 && Number.isFinite(new Date(reset * 1000).getTime())
          ? ` Retry after ${new Date(reset * 1000).toISOString()}.` : ''
        throw new InvalidDownload(`GitHub download API rate limit exceeded (HTTP 403).${retryAt}`)
      }
      const message = `Voice download failed (HTTP ${response.status}).`
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw new Error(message)
      throw new InvalidDownload(message)
    }
    const activity = () => arm(timing.idleTimeoutMs, 'Voice download stalled: no data received from the server.')
    activity()
    // The stream pipeline also observes this signal, so it closes files before retry.
    return await consume(response, request.signal, activity)
  } catch (error) {
    signal.throwIfAborted()
    if (request.signal.aborted) throw request.signal.reason
    throw error
  } finally {
    clearTimeout(timer!)
    signal.removeEventListener('abort', abort)
    request.signal.removeEventListener('abort', onAbort)
    request.abort()
    if (response) cancelBody(response)
  }
}

const retryDownload = async <T>(
  signal: AbortSignal, timing: DownloadTiming, log: VoiceInstallLog, operation: () => Promise<T>
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const started = Date.now()
    try { return await operation() } catch (error) {
      signal.throwIfAborted()
      const code = (error as NodeJS.ErrnoException)?.code
      const permanent = error instanceof InvalidDownload || ['ENOSPC', 'EACCES', 'EROFS'].includes(code || '')
      log('warn', 'download.attempt-failed', {
        attempt: attempt + 1, maxAttempts, willRetry: !permanent && attempt + 1 < maxAttempts,
        elapsedMs: Date.now() - started, error: voiceInstallError(error)
      })
      if (permanent) throw error
      if (attempt + 1 >= maxAttempts) {
        throw new Error(`Voice download failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      await delay(timing.retryDelayMs * (attempt + 1), undefined, { signal })
    }
  }
}

export const downloadVoiceArchive = async (
  url: string, destination: string, expectedHash: string, signal: AbortSignal,
  report: (received: number, total: number) => void, fetcher: typeof fetch = fetch,
  timing: DownloadTiming = defaultTiming, context: Record<string, unknown> = {}
): Promise<void> => {
  const source = new URL(url)
  const log = createVoiceInstallLog({
    ...context, downloadId: randomUUID(), source: `${source.origin}${source.pathname}`
  })
  const started = Date.now()
  log('info', 'download.started', { ...timing, maxAttempts })
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const parts: string[] = []
  const bytes: number[] = [0]
  let total = 0
  let lastReport = 0
  let completed = false
  let lastLog = 0
  const progress = (force = false) => {
    if (force || Date.now() - lastReport > 150) {
      report(bytes.reduce((sum, value) => sum + value, 0), total)
      lastReport = Date.now()
      if (Date.now() - lastLog >= 10_000) {
        log('info', 'download.progress', { received: bytes.reduce((sum, value) => sum + value, 0), total, elapsedMs: Date.now() - started })
        lastLog = Date.now()
      }
    }
  }
  const consume = async (
    response: Response, path: string, index: number, expected: number,
    requestSignal: AbortSignal, activity: () => void
  ) => {
    const tracker = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      activity()
      bytes[index] += chunk.length
      if (bytes[index] > (expected || maxArchiveSize)) {
        callback(new InvalidDownload('Voice download exceeded the expected size.'))
        return
      }
      progress()
      callback(null, chunk)
    } })
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), tracker,
      createWriteStream(path, { mode: 0o600 }), { signal: requestSignal }
    )
    if (expected && bytes[index] !== expected) throw new Error('Voice download was incomplete.')
  }
  try {
    const ranged = await retryDownload(controller.signal, timing, log, async () => {
      bytes[0] = 0
      progress(true)
      return withResponse(fetcher, url, {}, controller.signal, timing, log, async (response, requestSignal, activity) => {
        total = Number(response.headers.get('content-length')) || 0
        if (total < 0 || !Number.isSafeInteger(total) || total > maxArchiveSize) throw new InvalidDownload('Voice download exceeded the expected size.')
        progress(true)
        // Each API redirect consumes anonymous quota. Stream it with one request.
        if (source.hostname !== 'api.github.com' && total > 16 * 1024 * 1024 && response.headers.get('accept-ranges') === 'bytes') return true
        await consume(response, destination, 0, total, requestSignal, activity)
        return false
      })
    })
    if (ranged) {
      const partSize = 2 * 1024 * 1024
      const count = Math.ceil(total / partSize)
      for (let index = 0; index < count; index++) { parts.push(`${destination}.${index}`); bytes[index] = 0 }
      let nextPart = 0
      const workers = Array.from({ length: Math.min(8, count) }, async () => {
        try {
          while (nextPart < count) {
            const index = nextPart++
            const start = index * partSize
            const end = Math.min(total - 1, start + partSize - 1)
            const rangeLog: VoiceInstallLog = (level, event, fields) => log(level, event, { ...fields, range: `bytes=${start}-${end}` })
            await retryDownload(controller.signal, timing, rangeLog, async () => {
              // Only discard bytes from this failed attempt; completed parts stay intact.
              bytes[index] = 0
              progress(true)
              // Request the original asset URL so redirects can refresh expired CDN links.
              await withResponse(fetcher, url, { Range: `bytes=${start}-${end}` }, controller.signal, timing, rangeLog, async (part, requestSignal, activity) => {
                if (part.status !== 206 || part.headers.get('content-range') !== `bytes ${start}-${end}/${total}`) {
                  throw new InvalidDownload('The download server returned an invalid byte range. Retry the installation.')
                }
                await consume(part, parts[index], index, end - start + 1, requestSignal, activity)
              })
            })
          }
        } catch (error) {
          if (!controller.signal.aborted) controller.abort(error)
          throw error
        }
      })
      await Promise.allSettled(workers)
      controller.signal.throwIfAborted()
      await pipeline(Readable.from((async function* () {
        for (const path of parts) for await (const chunk of createReadStream(path)) yield chunk
      })()), createWriteStream(destination, { mode: 0o600 }), { signal: controller.signal })
    }
    controller.signal.throwIfAborted()
    log('info', 'download.checksum-started')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(destination, { signal: controller.signal })) hash.update(chunk)
    if (hash.digest('hex') !== expectedHash) throw new InvalidDownload('Voice download checksum mismatch. Retry the download.')
    controller.signal.throwIfAborted()
    const received = bytes.reduce((sum, value) => sum + value, 0)
    report(received, total || received)
    completed = true
    log('info', 'download.completed', { received, total, elapsedMs: Date.now() - started })
  } catch (error) {
    log(signal.aborted ? 'info' : 'error', signal.aborted ? 'download.cancelled' : 'download.failed', {
      received: bytes.reduce((sum, value) => sum + value, 0), total,
      elapsedMs: Date.now() - started, error: voiceInstallError(error)
    })
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    controller.abort()
    await Promise.all(parts.map((path) => rm(path, { force: true })))
    if (!completed) await rm(destination, { force: true })
  }
}
