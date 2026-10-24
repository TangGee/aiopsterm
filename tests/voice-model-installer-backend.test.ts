// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadVoiceArchive, voiceInstallAssets, voiceInstallEnvironment } from '../src/main/backend/ai/voiceModelInstaller'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
const target = async () => { directory = await mkdtemp(join(tmpdir(), 'voice-download-test-')); return join(directory, 'archive') }
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const fastTiming = { responseTimeoutMs: 50, idleTimeoutMs: 50, retryDelayMs: 1 }

describe('voice model installation', () => {
  it.each([['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']] as const)('selects pinned CPU packages for %s/%s', (platform, arch) => {
    expect(voiceInstallEnvironment(platform, arch).autoInstallSupported).toBe(true)
    const assets = voiceInstallAssets(platform, arch)
    expect(assets).toHaveLength(4)
    for (const asset of assets) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(['github.com', 'registry.npmjs.org']).toContain(new URL(asset.url).hostname)
      expect(asset.url).not.toContain('gpu')
    }
  })
  it('does not install an incompatible binary on unsupported architectures', () => {
    expect(voiceInstallEnvironment('win32', 'arm64').autoInstallSupported).toBe(false)
    expect(() => voiceInstallAssets('linux', 'riscv64')).toThrow('unavailable')
  })
  it('streams downloads, reports real bytes and verifies the checksum', async () => {
    const data = Buffer.from('test archive')
    const path = await target(); const progress = vi.fn()
    await downloadVoiceArchive('https://example.test/archive', path, hash(data), new AbortController().signal, progress,
      vi.fn(async () => new Response(data, { headers: { 'content-length': String(data.length) } })) as typeof fetch)
    expect(hash(await readFile(path))).toBe(hash(data))
    expect(progress).toHaveBeenLastCalledWith(data.length, data.length)
  })
  it('assembles range downloads in order and removes temporary parts', async () => {
    const data = Buffer.alloc(17 * 1024 * 1024)
    for (let index = 0; index < data.length; index++) data[index] = index % 251
    const path = await target(); const progress = vi.fn()
    const fetcher = vi.fn(async (_url, options) => {
      const range = options?.headers?.Range as string | undefined
      if (!range) return new Response(data, { headers: { 'content-length': String(data.length), 'accept-ranges': 'bytes' } })
      const [start, end] = range.slice(6).split('-').map(Number)
      return new Response(data.subarray(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${data.length}` } })
    })
    await downloadVoiceArchive('https://example.test/archive', path, hash(data), new AbortController().signal, progress, fetcher as typeof fetch)
    expect(hash(await readFile(path))).toBe(hash(data))
    expect(await readdir(directory)).toEqual(['archive'])
    expect(fetcher).toHaveBeenCalledTimes(10)
    expect(progress).toHaveBeenLastCalledWith(data.length, data.length)
  })
  it('downloads a large API fallback in one request instead of exhausting quota with ranges', async () => {
    const data = Buffer.alloc(17 * 1024 * 1024, 5)
    const path = await target()
    const fetcher = vi.fn(async () => new Response(data, {
      headers: { 'content-length': String(data.length), 'accept-ranges': 'bytes' }
    }))
    await downloadVoiceArchive('https://api.github.com/repos/example/releases/assets/1', path,
      hash(data), new AbortController().signal, vi.fn(), fetcher as typeof fetch)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(hash(await readFile(path))).toBe(hash(data))
  })
  it('removes corrupt or incomplete downloads so retry can replace them', async () => {
    const path = await target(); const data = Buffer.from('corrupt')
    await expect(downloadVoiceArchive('https://example.test/archive', path, hash(Buffer.from('expected')), new AbortController().signal, vi.fn(),
      vi.fn(async () => new Response(data)) as typeof fetch)).rejects.toThrow('checksum')
    expect(await readdir(directory)).toEqual([])
    await expect(downloadVoiceArchive('https://example.test/archive', path, hash(data), new AbortController().signal, vi.fn(),
      vi.fn(async () => new Response(data, { headers: { 'content-length': '100' } })) as typeof fetch)).rejects.toThrow('incomplete')
    expect(await readdir(directory)).toEqual([])
  })
  it('cancels downloads and cleans up partial files', async () => {
    const path = await target(); const controller = new AbortController()
    const body = new ReadableStream({ start(stream) { stream.enqueue(Buffer.alloc(2048)) } })
    await expect(downloadVoiceArchive('https://example.test/archive', path, '', controller.signal, () => controller.abort(),
      vi.fn(async () => new Response(body)) as typeof fetch)).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  })
  it('rejects HTTP failures and invalid range responses', async () => {
    const path = await target()
    await expect(downloadVoiceArchive('https://example.test/archive', path, '', new AbortController().signal, vi.fn(),
      vi.fn(async () => new Response('unavailable', { status: 503 })) as typeof fetch)).rejects.toThrow('503')
    const fetcher = vi.fn(async (_url, options) => options?.headers?.Range
      ? new Response('bad range', { status: 200 })
      : new Response('', { headers: { 'content-length': String(17 * 1024 * 1024), 'accept-ranges': 'bytes' } }))
    await expect(downloadVoiceArchive('https://example.test/archive', path, '', new AbortController().signal, vi.fn(), fetcher as typeof fetch)).rejects.toThrow('range')
    expect(await readdir(directory)).toEqual([])
  })
})

it('automatically retries transient connection failures before downloading', async () => {
  const path = await target(); const data = Buffer.from('retry success')
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('connection timeout')).mockResolvedValueOnce(new Response(data))
  await downloadVoiceArchive('https://example.test/archive', path, hash(data), new AbortController().signal, vi.fn(), fetcher as typeof fetch)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(hash(await readFile(path))).toBe(hash(data))
})

it('bounds requests that never return headers and cleans up after retry exhaustion', async () => {
  const path = await target()
  const fetcher = vi.fn(() => new Promise<Response>(() => {}))
  await expect(downloadVoiceArchive('https://example.test/archive', path, '', new AbortController().signal, vi.fn(),
    fetcher as typeof fetch, fastTiming)).rejects.toThrow('waiting for the server response')
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(await readdir(directory)).toEqual([])
})

it('retries a stalled single stream without counting failed bytes twice', async () => {
  const path = await target()
  const data = Buffer.from('complete archive')
  const cancelled = vi.fn()
  const progress = vi.fn()
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream({
      start(stream) { stream.enqueue(data.subarray(0, 3)) },
      cancel: cancelled
    }), { headers: { 'content-length': String(data.length) } }))
    .mockImplementation(async () => new Response(data, { headers: { 'content-length': String(data.length) } }))
  await downloadVoiceArchive('https://example.test/archive', path, hash(data), new AbortController().signal, progress,
    fetcher as typeof fetch, fastTiming)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(cancelled).toHaveBeenCalledTimes(1)
  expect(hash(await readFile(path))).toBe(hash(data))
  expect(progress.mock.calls.every(([received]) => received <= data.length)).toBe(true)
  expect(progress).toHaveBeenLastCalledWith(data.length, data.length)
})

it('reports persistent body stalls instead of waiting for the installation deadline', async () => {
  const path = await target()
  const fetcher = vi.fn(async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(Buffer.from('partial')) }
  })))
  await expect(downloadVoiceArchive('https://example.test/archive', path, '', new AbortController().signal, vi.fn(),
    fetcher as typeof fetch, fastTiming)).rejects.toThrow('no data received')
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(await readdir(directory)).toEqual([])
})

it('allows a slow stream to continue while bytes keep arriving', async () => {
  const path = await target()
  const data = Buffer.alloc(10, 7)
  let sent = 0
  const fetcher = vi.fn(async () => new Response(new ReadableStream({
    async pull(stream) {
      await new Promise(resolve => setTimeout(resolve, 30))
      if (sent === data.length) stream.close()
      else stream.enqueue(data.subarray(sent, ++sent))
    }
  }), { headers: { 'content-length': String(data.length) } }))
  await downloadVoiceArchive('https://example.test/archive', path, hash(data), new AbortController().signal, vi.fn(),
    fetcher as typeof fetch, { ...fastTiming, idleTimeoutMs: 150 })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(hash(await readFile(path))).toBe(hash(data))
})

it('retries only a stalled range and refreshes the original asset URL', async () => {
  const path = await target()
  const data = Buffer.alloc(17 * 1024 * 1024, 13)
  const url = 'https://example.test/archive'
  const attempts = new Map<string, number>()
  const progress = vi.fn()
  const fetcher = vi.fn(async (requestedUrl, options) => {
    expect(requestedUrl).toBe(url)
    expect(options.cache).toBe('no-store')
    const range = options.headers.Range as string | undefined
    if (!range) {
      const response = new Response(data, { headers: { 'content-length': String(data.length), 'accept-ranges': 'bytes' } })
      Object.defineProperty(response, 'url', { value: 'https://expired.example.test/signed-asset' })
      return response
    }
    attempts.set(range, (attempts.get(range) || 0) + 1)
    const [start, end] = range.slice(6).split('-').map(Number)
    const body = start === 0 && attempts.get(range) === 1
      ? new ReadableStream({ start(stream) { stream.enqueue(data.subarray(0, 100)) } })
      : data.subarray(start, end + 1)
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${data.length}` } })
  })
  await downloadVoiceArchive(url, path, hash(data), new AbortController().signal, progress, fetcher as typeof fetch,
    { ...fastTiming, idleTimeoutMs: 150 })
  expect(attempts.get('bytes=0-2097151')).toBe(2)
  expect([...attempts.values()].filter(value => value === 1)).toHaveLength(8)
  expect(hash(await readFile(path))).toBe(hash(data))
  expect(progress.mock.calls.every(([received]) => received <= data.length)).toBe(true)
  expect(progress).toHaveBeenLastCalledWith(data.length, data.length)
  expect(await readdir(directory)).toEqual(['archive'])
})

it('cancels stalled concurrent bodies without starting retries or leaving parts', async () => {
  const path = await target()
  const controller = new AbortController()
  const cancelled = vi.fn()
  const fetcher = vi.fn(async (_url, options) => {
    const range = options.headers.Range as string | undefined
    const total = 17 * 1024 * 1024
    if (!range) return new Response('', { headers: { 'content-length': String(total), 'accept-ranges': 'bytes' } })
    const [start, end] = range.slice(6).split('-').map(Number)
    return new Response(new ReadableStream({
      start(stream) { stream.enqueue(Buffer.from('partial')) },
      cancel: cancelled
    }), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${total}` } })
  })
  const pending = downloadVoiceArchive('https://example.test/archive', path, '', controller.signal, vi.fn(),
    fetcher as typeof fetch, { ...fastTiming, idleTimeoutMs: 1000 })
  const rejected = expect(pending).rejects.toThrow('User cancelled')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(9))
  controller.abort(new Error('User cancelled'))
  await rejected
  expect(fetcher).toHaveBeenCalledTimes(9)
  expect(cancelled).toHaveBeenCalledTimes(8)
  expect(await readdir(directory)).toEqual([])
})
