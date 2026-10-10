import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceRecording, encodeVoiceWav } from '@/services/voice/voiceRecording'

const pending = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
const setup = () => {
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  const instances: Recorder[] = []
  class Recorder {
    static isTypeSupported = () => true
    state = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { instances.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.() }
  }
  const transcribe = vi.fn(async () => ({ ok: true as const, data: { text: 'hello', provider: 'aiopsterm-local' as const } }))
  const onText = vi.fn()
  const getUserMedia = vi.fn(async () => stream)
  const cancelTranscription = vi.fn()
  const toWav = vi.fn(async () => new ArrayBuffer(2048))
  const options = { transcribe, onText, getUserMedia, cancelTranscription, toWav, getRecorder: () => Recorder as unknown as typeof MediaRecorder }
  return { options, stopTrack, stream, instances }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('global voice recording', () => {
  it('records once, releases the microphone before transcription, and returns text', async () => {
    vi.useFakeTimers()
    const fixture = setup(); const runtime = createVoiceRecording(fixture.options)
    await runtime.start(); await runtime.start()
    expect(fixture.instances).toHaveLength(1)
    vi.advanceTimersByTime(1000); runtime.stop(); runtime.stop()
    await settle()
    expect(fixture.stopTrack).toHaveBeenCalledOnce()
    expect(fixture.options.transcribe).toHaveBeenCalledOnce()
    expect(fixture.options.onText).toHaveBeenCalledWith('hello')
    expect(runtime.state.value).toBe('idle')
  })
  it('stops a microphone acquired after cancellation without starting a recorder', async () => {
    const fixture = setup(); const permission = pending<MediaStream>()
    fixture.options.getUserMedia.mockReturnValue(permission.promise)
    const runtime = createVoiceRecording(fixture.options)
    const start = runtime.start(); runtime.cancel(); permission.resolve(fixture.stream); await start
    expect(fixture.instances).toHaveLength(0)
    expect(fixture.stopTrack).toHaveBeenCalledOnce()
    expect(runtime.state.value).toBe('idle')
  })
  it('ignores late transcription results after cancellation and cancels the request', async () => {
    vi.useFakeTimers()
    const fixture = setup(); const result = pending<Awaited<ReturnType<typeof fixture.options.transcribe>>>()
    fixture.options.transcribe.mockReturnValue(result.promise)
    const runtime = createVoiceRecording(fixture.options)
    await runtime.start(); vi.advanceTimersByTime(1000); runtime.stop(); await settle()
    runtime.cancel(); result.resolve({ ok: true, data: { text: 'late', provider: 'aiopsterm-local' } }); await settle()
    expect(fixture.options.cancelTranscription).toHaveBeenCalledOnce()
    expect(fixture.options.onText).not.toHaveBeenCalled()
    expect(runtime.state.value).toBe('idle')
  })
  it('does not submit audio when cancelled during WAV conversion', async () => {
    vi.useFakeTimers()
    const fixture = setup(); const conversion = pending<ArrayBuffer>()
    fixture.options.toWav.mockReturnValue(conversion.promise)
    const runtime = createVoiceRecording(fixture.options)
    await runtime.start(); vi.advanceTimersByTime(1000); runtime.stop(); runtime.cancel()
    conversion.resolve(new ArrayBuffer(2048)); await settle()
    expect(fixture.options.transcribe).not.toHaveBeenCalled()
  })
  it('stops automatically at 60 seconds and handles permission rejection', async () => {
    vi.useFakeTimers()
    const fixture = setup(); const runtime = createVoiceRecording(fixture.options)
    await runtime.start(); vi.advanceTimersByTime(60_000); await settle()
    expect(fixture.options.onText).toHaveBeenCalledOnce()
    fixture.options.getUserMedia.mockRejectedValue(new Error('Permission denied'))
    await runtime.start()
    expect(runtime.state.value).toBe('idle')
    expect(runtime.error.value).toBe('Permission denied')
  })
  it('encodes signed 16-bit mono WAV with a truthful sample rate', () => {
    const wav = encodeVoiceWav([Float32Array.from([-1, 0, 1])], 16000)
    const view = new DataView(wav)
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(46, true)).toBe(0)
    expect(view.getInt16(48, true)).toBe(32767)
  })
})
