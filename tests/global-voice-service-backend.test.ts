// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { transcribeGlobalVoice } from '../src/main/backend/ai/voiceInputService'
import type { VoiceInputPreferences } from '../src/shared/contracts/voice'

const preferences: VoiceInputPreferences = { mode: 'service', endpoint: '', model: 'speech-model', executablePath: '', modelPath: '', shortcut: '', headsetEnabled: false }
const audio = Buffer.alloc(2048); audio.write('RIFF'); audio.write('WAVE', 8)
afterEach(() => vi.unstubAllGlobals())

describe('independent speech service', () => {
  it.skipIf(process.platform === 'win32')('runs a local engine without a shell and removes temporary audio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-engine-test-'))
    const executable = join(directory, 'test engine')
    const model = join(directory, 'test model.bin')
    const trace = join(directory, 'trace.txt')
    await writeFile(model, 'test model')
    const script = '#!' + process.execPath + '\n' +
      'const fs = require("node:fs"); const args = process.argv.slice(2);' +
      'const audio = args[args.indexOf("-f") + 1]; const output = args[args.indexOf("-of") + 1];' +
      'if (fs.readFileSync(audio).toString("ascii", 0, 4) !== "RIFF") process.exit(2);' +
      'fs.writeFileSync(' + JSON.stringify(trace) + ', audio); fs.writeFileSync(output + ".txt", "local words");'
    await writeFile(executable, script, { mode: 0o700 })
    try {
      const result = await transcribeGlobalVoice({ audioBytes: audio }, { ...preferences, mode: 'local', executablePath: executable, modelPath: model }, new AbortController().signal)
      expect(result).toMatchObject({ ok: true, data: { text: 'local words', provider: 'aiopsterm-local' } })
      const temporaryAudio = await readFile(trace, 'utf8')
      await expect(access(temporaryAudio)).rejects.toThrow()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('posts actual WAV audio and the speech model to the configured endpoint', async () => {
    let body = ''; let authorization = ''
    const server = createServer((request, response) => {
      authorization = request.headers.authorization || ''
      request.on('data', (chunk) => { body += chunk.toString() })
      request.on('end', () => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ text: 'recognized words' })) })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    try {
      const result = await transcribeGlobalVoice({ audioBytes: audio }, { ...preferences, endpoint: `http://127.0.0.1:${address.port}/audio/transcriptions`, apiKey: 'test-key' }, new AbortController().signal)
      expect(result).toMatchObject({ ok: true, data: { text: 'recognized words', model: 'speech-model' } })
      expect(authorization).toBe('Bearer test-key')
      expect(body).toContain('audio/wav'); expect(body).toContain('speech-model'); expect(body).toContain('RIFF')
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
  it('does not contact a service when local recognition is selected', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const result = await transcribeGlobalVoice({ audioBytes: audio }, { ...preferences, mode: 'local' }, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects oversized, empty and already cancelled requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await transcribeGlobalVoice({}, preferences, new AbortController().signal)).ok).toBe(false)
    const controller = new AbortController(); controller.abort()
    expect((await transcribeGlobalVoice({ audioBytes: audio }, preferences, controller.signal)).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
