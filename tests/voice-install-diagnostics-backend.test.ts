// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureRuntimeLog, writeRuntimeLog } from '../src/main/backend/app/runtimeLog'
import { downloadVoiceArchive } from '../src/main/backend/ai/voiceModelDownload'

let root: string
const timing = { responseTimeoutMs: 30, idleTimeoutMs: 30, retryDelayMs: 1 }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'voice-diagnostics-'))
  configureRuntimeLog({ getLogDir: () => root })
})
afterEach(async () => {
  await writeRuntimeLog('info', 'test.flush')
  configureRuntimeLog()
  await rm(root, { recursive: true, force: true })
})
const entries = async () => {
  await writeRuntimeLog('info', 'test.flush')
  return (await readFile(join(root, 'aiopsterm-runtime.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
}

it('persists every timeout attempt and final failure with a common installation identifier', async () => {
  await expect(downloadVoiceArchive(
    'https://example.test/archive', join(root, 'archive'), '', new AbortController().signal, vi.fn(),
    vi.fn(() => new Promise<Response>(() => {})), timing, { installationId: 'timeout-test', asset: 'engine' }
  )).rejects.toThrow('3 attempts')
  const logs = await entries()
  const attempts = logs.filter(entry => entry.event === 'voice.install.download.attempt-failed')
  expect(attempts.map(entry => entry.attempt)).toEqual([1, 2, 3])
  expect(attempts.map(entry => entry.willRetry)).toEqual([true, true, false])
  expect(attempts.every(entry => entry.error.message.includes('waiting for the server response'))).toBe(true)
  expect(logs.find(entry => entry.event === 'voice.install.download.failed')).toMatchObject({
    installationId: 'timeout-test', asset: 'engine', source: 'https://example.test/archive',
    received: 0, elapsedMs: expect.any(Number), error: { stack: expect.any(String) }
  })
  expect(new Set(logs.filter(entry => entry.downloadId).map(entry => entry.downloadId)).size).toBe(1)
})

it('records recovery and checksum completion while removing URL credentials and signed query strings', async () => {
  const data = Buffer.from('model archive')
  const hash = createHash('sha256').update(data).digest('hex')
  const source = 'https://user:password@example.test/archive?signature=private-secret'
  const error = new Error(`Request failed: ${source}`, { cause: new Error(`Connection refused: ${source}`) })
  const fetcher = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(
    new Response(data, { headers: { 'content-length': String(data.length) } })
  )
  await downloadVoiceArchive(source, join(root, 'archive'), hash, new AbortController().signal, vi.fn(), fetcher, timing)
  const logs = await entries()
  expect(logs.find(entry => entry.event === 'voice.install.download.attempt-failed').error.cause.message)
    .toBe('Connection refused: https://example.test/archive')
  expect(logs.map(entry => entry.event)).toContain('voice.install.download.checksum-started')
  expect(logs.find(entry => entry.event === 'voice.install.download.completed').received).toBe(data.length)
  expect(JSON.stringify(logs)).not.toContain('password')
  expect(JSON.stringify(logs)).not.toContain('private-secret')
})

it('distinguishes checksum failures from network failures in the persisted log', async () => {
  await expect(downloadVoiceArchive(
    'https://example.test/archive', join(root, 'archive'), 'incorrect-hash',
    new AbortController().signal, vi.fn(), vi.fn(async () => new Response('archive')), timing
  )).rejects.toThrow('checksum mismatch')
  const logs = await entries()
  expect(logs.find(entry => entry.event === 'voice.install.download.failed').error.message).toContain('checksum mismatch')
  expect(logs.filter(entry => entry.event === 'voice.install.download.attempt-failed')).toHaveLength(0)
})

it('records exhausted API quota and its reset time without retrying the forbidden request', async () => {
  const fetcher = vi.fn(async () => new Response('rate limit exceeded', {
    status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792512004' }
  }))
  await expect(downloadVoiceArchive('https://api.github.com/repos/example/releases/assets/1',
    join(root, 'archive'), '', new AbortController().signal, vi.fn(), fetcher, timing))
    .rejects.toThrow('GitHub download API rate limit exceeded (HTTP 403). Retry after')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const logs = await entries()
  expect(logs.find(entry => entry.event === 'voice.install.download.response')).toMatchObject({
    status: 403, rateLimitRemaining: '0', rateLimitReset: '1792512004'
  })
  expect(logs.find(entry => entry.event === 'voice.install.download.attempt-failed').willRetry).toBe(false)
})
