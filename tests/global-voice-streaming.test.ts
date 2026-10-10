import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { VoiceTranscriptionInput } from '@shared/contracts/voice'
import { createStreamingVoiceRecording } from '@/services/voice/voiceStreamingRecording'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const success = (text: string) => ({ ok: true as const, data: { text, provider: 'aiopsterm-local' as const } })
const setup = (transcribe = vi.fn(async (_input: VoiceTranscriptionInput) => success('hello'))) => {
  let feed!: (samples: Float32Array) => void
  const trackStop = vi.fn()
  const captureStop = vi.fn(async () => undefined)
  const onText = vi.fn()
  const cancelTranscription = vi.fn()
  const runtime = createStreamingVoiceRecording({
    transcribe, onText, cancelTranscription,
    getUserMedia: async () => ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream,
    createCapture: async (_stream, onSamples) => { feed = onSamples; return { stop: captureStop } }
  })
  const audio = (seconds: number, value = 0.1) => {
    for (let remaining = Math.round(seconds * 16000); remaining > 0; remaining -= 160) feed(new Float32Array(Math.min(remaining, 160)).fill(value))
  }
  return { runtime, audio, trackStop, captureStop, onText, transcribe, cancelTranscription }
}
afterEach(() => vi.useRealTimers())

describe('incremental voice recording', () => {
  it('emits a phrase while still recording and flushes the final tail once', async () => {
    const test = setup()
    await test.runtime.start()
    test.audio(0.5); test.audio(0.4, 0)
    await flushPromises()
    expect(test.onText).toHaveBeenCalledWith('hello')
    expect(test.runtime.state.value).toBe('recording')
    expect(test.trackStop).not.toHaveBeenCalled()
    test.audio(0.3)
    test.runtime.stop(); test.runtime.stop()
    await flushPromises()
    expect(test.onText).toHaveBeenCalledTimes(2)
    expect(test.transcribe.mock.calls.map(([input]) => input.durationMs)).toEqual([900, 300])
    expect(test.captureStop).toHaveBeenCalledOnce()
    expect(test.trackStop).toHaveBeenCalledOnce()
    expect(test.runtime.state.value).toBe('idle')
  })
  it('serializes continuous speech segments and keeps their order after stop', async () => {
    const first = deferred<ReturnType<typeof success>>()
    const transcribe = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(success('second'))
    const test = setup(transcribe)
    await test.runtime.start()
    test.audio(5)
    expect(transcribe).toHaveBeenCalledOnce()
    test.runtime.stop()
    await flushPromises()
    expect(test.runtime.state.value).toBe('transcribing')
    first.resolve(success('first'))
    await flushPromises()
    expect(test.onText.mock.calls).toEqual([['first'], ['second']])
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(transcribe.mock.calls[0][0].requestId).not.toBe(transcribe.mock.calls[1][0].requestId)
    const wav = new DataView(transcribe.mock.calls[0][0].audioBytes)
    expect(wav.getUint32(24, true)).toBe(16000)
    expect(wav.getUint32(40, true)).toBe(80000)
    expect(test.runtime.state.value).toBe('idle')
  })
  it('cancels pending and queued segments and rejects late output after restarting', async () => {
    const old = deferred<ReturnType<typeof success>>()
    const transcribe = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(success('new'))
    const test = setup(transcribe)
    await test.runtime.start(); test.audio(5)
    test.runtime.cancel()
    expect(test.cancelTranscription).toHaveBeenCalledWith(transcribe.mock.calls[0][0].requestId)
    await test.runtime.start(); test.audio(0.5); test.audio(0.4, 0)
    old.resolve(success('stale'))
    await flushPromises()
    expect(test.onText.mock.calls).toEqual([['new']])
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(test.runtime.state.value).toBe('recording')
    test.runtime.cancel()
  })
  it('continues recording when a noise segment contains no recognized speech', async () => {
    const transcribe = vi.fn().mockResolvedValueOnce({ ok: false, errorCode: 'VOICE_NO_SPEECH' }).mockResolvedValue(success('speech'))
    const test = setup(transcribe)
    await test.runtime.start(); test.audio(2.5)
    await flushPromises()
    expect(test.runtime.state.value).toBe('recording')
    test.audio(2.5)
    await flushPromises()
    expect(test.onText.mock.calls).toEqual([['speech']])
    expect(test.runtime.error.value).toBe('')
    test.runtime.cancel()
  })
  it('drops silence instead of submitting empty requests', async () => {
    const test = setup()
    await test.runtime.start(); test.audio(6, 0); test.runtime.stop()
    await flushPromises()
    expect(test.transcribe).not.toHaveBeenCalled()
    expect(test.runtime.state.value).toBe('idle')
  })
  it('releases the microphone and reports recognition failures', async () => {
    const test = setup(vi.fn().mockResolvedValue({ ok: false, errorMessage: 'Service unavailable' }))
    await test.runtime.start(); test.audio(2.5)
    await flushPromises()
    expect(test.runtime.error.value).toBe('Service unavailable')
    expect(test.runtime.state.value).toBe('idle')
    expect(test.trackStop).toHaveBeenCalledOnce()
    expect(test.onText).not.toHaveBeenCalled()
  })
  it('stops at sixty seconds and ignores permission granted after cancellation', async () => {
    vi.useFakeTimers()
    const test = setup()
    await test.runtime.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(test.runtime.state.value).toBe('idle')
    expect(test.trackStop).toHaveBeenCalledOnce()
    const permission = deferred<MediaStream>()
    const stop = vi.fn()
    const createCapture = vi.fn()
    const runtime = createStreamingVoiceRecording({ transcribe: vi.fn(), onText: vi.fn(), getUserMedia: () => permission.promise, createCapture })
    const starting = runtime.start()
    runtime.cancel()
    permission.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await starting
    expect(stop).toHaveBeenCalledOnce()
    expect(createCapture).not.toHaveBeenCalled()
  })
})
