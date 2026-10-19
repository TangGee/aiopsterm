// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shutdownVoiceEngineServer } from '../src/main/backend/ai/voiceEngineServer'
import { transcribeGlobalVoice } from '../src/main/backend/ai/voiceInputService'
import { encodeVoiceWav } from '../src/renderer/src/services/voice/voiceWav'
import type { VoiceInputPreferences } from '../src/shared/contracts/voice'

const wav = encodeVoiceWav([new Float32Array(16000).fill(0.01)], 16000)
const base: VoiceInputPreferences = { mode: 'local', localEngine: 'sensevoice', endpoint: '', model: '', executablePath: '', modelPath: '', shortcut: '', headsetEnabled: false }

const fakeCli = (trace: string) => '#!' + process.execPath + '\n' +
  'const fs = require("node:fs"); fs.writeFileSync(' + JSON.stringify(trace) + ', "cli");' +
  'process.stdout.write(JSON.stringify({ text: "<|zh|><|NEUTRAL|>命令行兜底结果。" }));'

const fakeServer = (log: string, options: { exit?: boolean } = {}) => '#!' + process.execPath + '\n' +
  `const fs = require("node:fs"); fs.appendFileSync(${JSON.stringify(log)}, "start " + process.pid + "\\n");` +
  'if (' + String(Boolean(options.exit)) + ') process.exit(1);' +
  `const { WebSocketServer } = require(${JSON.stringify(join(process.cwd(), 'node_modules', 'ws'))});` +
  'const port = Number(process.argv.find((a) => a.startsWith("--port=")).split("=")[1]);' +
  'const wss = new WebSocketServer({ port, host: "127.0.0.1" }, () => process.stderr.write("Listening on: " + port + "\\n"));' +
  'wss.on("connection", (socket) => {' +
  '  fs.appendFileSync(' + JSON.stringify(log) + ', "conn " + process.pid + "\\n");' +
  '  let chunks = [], expected = -1;' +
  '  socket.on("message", (data) => {' +
  '    chunks.push(data); const all = Buffer.concat(chunks);' +
  '    if (expected < 0 && all.length >= 8) expected = 8 + all.readUInt32LE(4);' +
  '    if (expected > 0 && all.length >= expected) {' +
  '      socket.send(JSON.stringify({ text: "<|zh|><|NEUTRAL|>常驻识别结果。" }));' +
  '      chunks = []; expected = -1;' +
  '    }' +
  '  })' +
  '})'

const setup = async (makeServerScript: (log: string) => string) => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-server-test-'))
  const log = join(directory, 'server.log')
  const trace = join(directory, 'cli.trace')
  const executablePath = join(directory, 'sherpa-onnx-offline')
  await writeFile(executablePath, fakeCli(trace), { mode: 0o700 })
  await writeFile(join(directory, 'sherpa-onnx-offline-websocket-server'), makeServerScript(log), { mode: 0o700 })
  const modelPath = join(directory, 'model.int8.onnx')
  const tokensPath = join(directory, 'tokens.txt')
  await writeFile(modelPath, 'model'); await writeFile(tokensPath, 'tokens')
  return { directory, log, trace, preferences: { ...base, executablePath, modelPath, tokensPath } }
}

afterEach(() => shutdownVoiceEngineServer())

describe.skipIf(process.platform === 'win32')('resident sensevoice engine server', () => {
  it('keeps one engine process alive across requests and strips meta tags', async () => {
    const { directory, log, trace, preferences } = await setup((log) => fakeServer(log))
    try {
      const first = await transcribeGlobalVoice({ audioBytes: wav }, preferences, new AbortController().signal)
      const second = await transcribeGlobalVoice({ audioBytes: wav }, preferences, new AbortController().signal)
      expect(first).toMatchObject({ ok: true, data: { text: '常驻识别结果。', provider: 'aiopsterm-local' } })
      expect(second).toMatchObject({ ok: true, data: { text: '常驻识别结果。', provider: 'aiopsterm-local' } })
      const lines = (await readFile(log, 'utf8')).trim().split('\n')
      expect(lines.filter((line) => line.startsWith('start '))).toHaveLength(1)
      expect(lines.filter((line) => line.startsWith('conn '))).toHaveLength(2)
      // The one-shot CLI must not run when the resident engine answered.
      await expect(access(trace)).rejects.toThrow()
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)

  it('stops the engine process on shutdown', async () => {
    const { directory, log, preferences } = await setup((log) => fakeServer(log))
    try {
      await transcribeGlobalVoice({ audioBytes: wav }, preferences, new AbortController().signal)
      const pid = Number((await readFile(log, 'utf8')).match(/^start (\d+)$/m)?.[1])
      expect(pid).toBeGreaterThan(0)
      shutdownVoiceEngineServer()
      let running = true
      for (let attempt = 0; attempt < 50 && running; attempt++) {
        try { process.kill(pid, 0) } catch { running = false }
        if (running) await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(running).toBe(false)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)

  it('falls back to the one-shot CLI when the engine fails to start, and remembers it', async () => {
    const { directory, log, trace, preferences } = await setup((log) => fakeServer(log, { exit: true }))
    try {
      const first = await transcribeGlobalVoice({ audioBytes: wav }, preferences, new AbortController().signal)
      const second = await transcribeGlobalVoice({ audioBytes: wav }, preferences, new AbortController().signal)
      expect(first).toMatchObject({ ok: true, data: { text: '命令行兜底结果。', provider: 'aiopsterm-local' } })
      expect(second).toMatchObject({ ok: true, data: { text: '命令行兜底结果。', provider: 'aiopsterm-local' } })
      // A broken engine is not retried for the same engine/model/tokens paths.
      expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(1)
      expect(await readFile(trace, 'utf8')).toBe('cli')
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)

  it('falls back to the one-shot CLI when the server binary is missing', async () => {
    const { directory, trace, preferences } = await setup((log) => fakeServer(log))
    await rm(join(directory, 'sherpa-onnx-offline-websocket-server'))
    try {
      const result = await transcribeGlobalVoice({ audioBytes: wav }, preferences, new AbortController().signal)
      expect(result).toMatchObject({ ok: true, data: { text: '命令行兜底结果。', provider: 'aiopsterm-local' } })
      expect(await readFile(trace, 'utf8')).toBe('cli')
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 30_000)
})
