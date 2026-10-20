import { _electron as electron, test, expect } from '@playwright/test'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isolatedEnvironment } from './support/environment'

test('Electron voice downloader recovers a stalled range over HTTP @voice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aio-voice-download-'))
  const data = Buffer.alloc(17 * 1024 * 1024, 7)
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
  const attempts = new Map<string, number>()
  let stalledConnectionClosed = false
  const server = createServer((request, response) => {
    const range = request.headers.range
    if (!range) {
      response.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes' })
      response.end(data)
      return
    }
    attempts.set(range, (attempts.get(range) || 0) + 1)
    const [start, end] = range.slice(6).split('-').map(Number)
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 })
    if (start === 0 && attempts.get(range) === 1) {
      response.once('close', () => { stalledConnectionClosed = true })
      response.write(data.subarray(0, 100))
      return
    }
    response.end(data.subarray(start, end + 1))
  })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const bundle = join(root, 'downloader.cjs')
    await build({ entryPoints: ['src/main/backend/ai/voiceModelDownload.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: bundle })
    const entry = join(root, 'main.cjs')
    await writeFile(entry, `globalThis.voiceDownloadRegression = require(${JSON.stringify(bundle)}); require('electron').app.whenReady();`)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address')
    const env = Object.fromEntries(Object.entries(await isolatedEnvironment(root))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    app = await electron.launch({ args: [entry], env })
    const destination = join(root, 'archive')
    const progress = await app.evaluate(async ({ net }, input) => {
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(new Error('Download did not recover')), 5000)
      const values: number[] = []
      try {
        await (globalThis as any).voiceDownloadRegression.downloadVoiceArchive(
          input.url, input.destination, input.hash, controller.signal,
          (received: number) => values.push(received), net.fetch.bind(net),
          { responseTimeoutMs: 1000, idleTimeoutMs: 500, retryDelayMs: 10 }
        )
        return values
      } finally { clearTimeout(deadline) }
    }, { url: `http://127.0.0.1:${address.port}/archive`, destination, hash: digest(data) })
    expect(digest(await readFile(destination))).toBe(digest(data))
    expect(attempts.get('bytes=0-2097151')).toBe(2)
    expect([...attempts.values()].filter(value => value === 1)).toHaveLength(8)
    expect(progress.at(-1)).toBe(data.length)
    expect(progress.every(value => value <= data.length)).toBe(true)
    await expect.poll(() => stalledConnectionClosed).toBe(true)
    expect((await readdir(root)).filter(name => /^archive\./.test(name))).toEqual([])
  } finally {
    await app?.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
