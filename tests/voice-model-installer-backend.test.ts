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

describe('voice model installation', () => {
  it.each([['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']] as const)('selects pinned CPU packages for %s/%s', (platform, arch) => {
    expect(voiceInstallEnvironment(platform, arch).autoInstallSupported).toBe(true)
    const assets = voiceInstallAssets(platform, arch)
    expect(assets).toHaveLength(2)
    for (const asset of assets) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(asset.url).toMatch(/^https:\/\/github.com\/k2-fsa\/sherpa-onnx\/releases\/download\//)
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
