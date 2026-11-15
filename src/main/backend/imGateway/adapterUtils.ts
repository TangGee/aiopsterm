import { setTimeout as delay } from 'node:timers/promises'

export const gatewayId = (value: unknown): string => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : ''
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s\x00-\x1f|]/.test(value) ? value : ''
}

export const pngBytes = (image: string, limit = 8 * 1024 * 1024): Buffer => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
  if (!match || match[1].length > Math.ceil(limit / 3) * 4) throw new Error('IM_GATEWAY_IMAGE_INVALID')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length > limit || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('IM_GATEWAY_IMAGE_INVALID')
  return bytes
}

export const textChunks = (text: string, limit: number): string[] => {
  const chars = Array.from(text)
  const chunks: string[] = []
  // Count UTF-16 code units as well as code points, without splitting surrogate pairs.
  let chunk = ''
  for (const char of chars) {
    if (chunk.length + char.length > limit) {
      const boundary = chunk.lastIndexOf('\n') + 1 || chunk.length
      chunks.push(chunk.slice(0, boundary)); chunk = chunk.slice(boundary)
    }
    chunk += char
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

export class AdapterQueue {
  readonly abort = new AbortController()
  private tail: Promise<unknown> = Promise.resolve()
  private nextAt = 0
  constructor(private interval = 350) {}
  get stopped() { return this.abort.signal.aborted }
  stop() { this.abort.abort() }
  run<T>(task: () => Promise<T>, interval = this.interval): Promise<T> {
    const result = this.tail.catch(() => {}).then(async () => {
      if (this.stopped) throw new Error('IM_GATEWAY_STOPPED')
      if (this.nextAt > Date.now()) await delay(this.nextAt - Date.now(), undefined, { signal: this.abort.signal })
      if (this.stopped) throw new Error('IM_GATEWAY_STOPPED')
      this.nextAt = Date.now() + interval
      return task()
    })
    this.tail = result.catch(() => {})
    return result
  }
}
