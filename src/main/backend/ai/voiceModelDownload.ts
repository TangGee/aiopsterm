import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

const maxArchiveSize = 600 * 1024 * 1024
const maxAttempts = 3
type DownloadTiming = { responseTimeoutMs: number; idleTimeoutMs: number; retryDelayMs: number }
const defaultTiming: DownloadTiming = { responseTimeoutMs: 20_000, idleTimeoutMs: 30_000, retryDelayMs: 400 }

class InvalidDownload extends Error {}

// Keep the request signal alive until its body has finished, not just its headers.
const withResponse = async <T>(
  fetcher: typeof fetch, url: string, headers: Record<string, string>, signal: AbortSignal,
  timing: DownloadTiming,
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
    if (!response.ok || !response.body) {
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
  signal: AbortSignal, timing: DownloadTiming, operation: () => Promise<T>
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { return await operation() } catch (error) {
      signal.throwIfAborted()
      const code = (error as NodeJS.ErrnoException)?.code
      if (error instanceof InvalidDownload || ['ENOSPC', 'EACCES', 'EROFS'].includes(code || '')) throw error
      if (attempt + 1 >= maxAttempts) {
        throw new Error(`Voice download failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`)
      }
      await delay(timing.retryDelayMs * (attempt + 1), undefined, { signal })
    }
  }
}

export const downloadVoiceArchive = async (
  url: string, destination: string, expectedHash: string, signal: AbortSignal,
  report: (received: number, total: number) => void, fetcher: typeof fetch = fetch,
  timing: DownloadTiming = defaultTiming
): Promise<void> => {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const parts: string[] = []
  const bytes: number[] = [0]
  let total = 0
  let lastReport = 0
  let completed = false
  const progress = (force = false) => {
    if (force || Date.now() - lastReport > 150) {
      report(bytes.reduce((sum, value) => sum + value, 0), total)
      lastReport = Date.now()
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
    const ranged = await retryDownload(controller.signal, timing, async () => {
      bytes[0] = 0
      progress(true)
      return withResponse(fetcher, url, {}, controller.signal, timing, async (response, requestSignal, activity) => {
        total = Number(response.headers.get('content-length')) || 0
        if (total < 0 || !Number.isSafeInteger(total) || total > maxArchiveSize) throw new InvalidDownload('Voice download exceeded the expected size.')
        progress(true)
        if (total > 16 * 1024 * 1024 && response.headers.get('accept-ranges') === 'bytes') return true
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
            await retryDownload(controller.signal, timing, async () => {
              // Only discard bytes from this failed attempt; completed parts stay intact.
              bytes[index] = 0
              progress(true)
              // Request the original asset URL so redirects can refresh expired CDN links.
              await withResponse(fetcher, url, { Range: `bytes=${start}-${end}` }, controller.signal, timing, async (part, requestSignal, activity) => {
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
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(destination, { signal: controller.signal })) hash.update(chunk)
    if (hash.digest('hex') !== expectedHash) throw new InvalidDownload('Voice download checksum mismatch. Retry the download.')
    controller.signal.throwIfAborted()
    const received = bytes.reduce((sum, value) => sum + value, 0)
    report(received, total || received)
    completed = true
  } finally {
    signal.removeEventListener('abort', abort)
    controller.abort()
    await Promise.all(parts.map((path) => rm(path, { force: true })))
    if (!completed) await rm(destination, { force: true })
  }
}
