import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import WebSocket from 'ws'
import type { VoiceInputPreferences } from '@shared/contracts/voice'

// The official sherpa-onnx engine package ships a websocket server next to the
// one-shot CLI. Running it as a resident process keeps the ~200MB model loaded,
// so a segment only pays inference time instead of process spawn + model load.
const serverBinaryName = process.platform === 'win32' ? 'sherpa-onnx-offline-websocket-server.exe' : 'sherpa-onnx-offline-websocket-server'
const readyMarker = 'Listening on'

type ResidentServer = { key: string; child: ChildProcess; port: number }
let resident: ResidentServer | undefined
let starting: Promise<ResidentServer> | undefined
let brokenKey = ''

const serverKey = (preferences: VoiceInputPreferences) => [preferences.executablePath, preferences.modelPath, preferences.tokensPath].join('\n')

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    const port = typeof address === 'object' && address ? address.port : 0
    probe.close(() => (port ? resolve(port) : reject(new Error('No free loopback port for the voice engine.'))))
  })
})

const startServer = (preferences: VoiceInputPreferences, binary: string, signal: AbortSignal) => new Promise<ResidentServer>((resolve, reject) => {
  let port = 0
  let settled = false
  let child: ChildProcess | undefined
  const settle = (error?: Error, server?: ResidentServer) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (error) { child?.kill(); reject(error) } else if (server) resolve(server)
  }
  const onAbort = () => settle(new Error('Recognition cancelled.'))
  // Model loading takes a few seconds on first start; the IPC layer may cancel earlier.
  const timer = setTimeout(() => settle(new Error('The voice engine did not start in time.')), 60_000)
  signal.addEventListener('abort', onAbort, { once: true })
  void freePort().then((found) => {
    port = found
    signal.throwIfAborted()
    child = spawn(binary, [
      `--port=${port}`,
      '--num-io-threads=1',
      '--num-work-threads=3',
      '--num-threads=4',
      `--sense-voice-model=${preferences.modelPath}`,
      `--tokens=${preferences.tokensPath || ''}`,
      '--sense-voice-language=auto',
      '--sense-voice-use-itn=1'
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.once('error', (error) => settle(error))
    child.stderr?.on('data', (chunk: Buffer) => { if (chunk.toString('utf8').includes(readyMarker)) settle(undefined, { key: serverKey(preferences), child: child!, port }) })
    child.once('exit', (code) => {
      settle(new Error(`The voice engine exited during startup (code ${code ?? 'unknown'}).`))
      if (resident?.child === child) resident = undefined
    })
  }).catch((error: unknown) => settle(error instanceof Error ? error : new Error(String(error))))
})

const ensureServer = async (preferences: VoiceInputPreferences, binary: string, signal: AbortSignal) => {
  const key = serverKey(preferences)
  const alive = () => (resident?.key === key && !resident.child.killed && resident.child.exitCode === null ? resident : undefined)
  const current = alive()
  if (current) return current
  if (starting) await starting.catch(() => undefined)
  const started = alive()
  if (started) return started
  if (brokenKey === key) throw new Error('The voice engine failed to start before. Update voice settings or reinstall the local engine to retry.')
  shutdownVoiceEngineServer()
  starting = (async () => {
    try {
      resident = await startServer(preferences, binary, signal)
      brokenKey = ''
      return resident
    } catch (error) {
      if (!signal.aborted) brokenKey = key
      throw error
    } finally { starting = undefined }
  })()
  return starting
}

export const shutdownVoiceEngineServer = () => {
  const current = resident
  resident = undefined
  try { current?.child.kill() } catch { /* The process may already be gone. */ }
}

export const decodeWavPcm16Mono = (wav: Buffer): { samples: Float32Array; sampleRate: number } => {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Local recognition requires WAV audio. Use the global voice button.')
  let format = 0
  let channels = 0
  let bits = 0
  let sampleRate = 0
  let data: Buffer | undefined
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (body + size > wav.length) break
    if (id === 'fmt ') { format = wav.readUInt16LE(body); channels = wav.readUInt16LE(body + 2); sampleRate = wav.readUInt32LE(body + 4); bits = wav.readUInt16LE(body + 14) }
    if (id === 'data') data = wav.subarray(body, body + size)
    offset = body + size + (size % 2)
  }
  if (format !== 1 || channels !== 1 || bits !== 16 || !sampleRate || !data?.length) throw new Error('Local recognition requires 16-bit mono PCM WAV audio.')
  const count = data.length >> 1
  const samples = new Float32Array(count)
  for (let index = 0; index < count; index++) samples[index] = data.readInt16LE(index * 2) / 32768
  return { samples, sampleRate }
}

// Offline websocket protocol: 4-byte little-endian sample rate, 4-byte payload
// byte length, then float32 PCM frames, split into <=10KiB binary messages. The
// server answers with one JSON text message containing the recognition result.
export const transcribeViaSenseVoiceServer = async (preferences: VoiceInputPreferences, wav: Buffer, signal: AbortSignal): Promise<string> => {
  const binary = join(dirname(preferences.executablePath), serverBinaryName)
  if (!existsSync(binary)) throw new Error('The resident voice engine is unavailable in this installation.')
  const { samples, sampleRate } = decodeWavPcm16Mono(wav)
  const server = await ensureServer(preferences, binary, signal)
  signal.throwIfAborted()
  const payload = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const header = Buffer.alloc(8)
  header.writeUInt32LE(sampleRate, 0)
  header.writeUInt32LE(payload.length, 4)
  return new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
    let settled = false
    const settle = (error?: Error, text?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      try { socket.close() } catch { /* The socket may already be closed. */ }
      if (error) reject(error)
      else resolve(text ?? '')
    }
    const onAbort = () => settle(new Error('Recognition cancelled.'))
    const timer = setTimeout(() => settle(new Error('The voice engine did not answer in time.')), 110_000)
    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('error', (error) => settle(error instanceof Error ? error : new Error(String(error))))
    socket.once('open', () => {
      const message = Buffer.concat([header, payload])
      for (let offset = 0; offset < message.length; offset += 10240) socket.send(message.subarray(offset, Math.min(offset + 10240, message.length)))
    })
    socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return
      try {
        const result = JSON.parse(data.toString()) as { text?: unknown }
        settle(undefined, typeof result.text === 'string' ? result.text : '')
      } catch { settle(new Error('The voice engine returned an invalid result.')) }
    })
  })
}
