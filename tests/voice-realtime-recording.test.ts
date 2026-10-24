import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createRealtimeVoiceRecording } from '@/services/voice/voiceRealtimeRecording'

const setup = () => {
  let feed!: (samples: Float32Array) => void
  const stopCapture = vi.fn(async () => undefined)
  const stopTrack = vi.fn()
  const online = {
    enabled: () => true, start: vi.fn(async () => 'stream'),
    push: vi.fn(async () => ({ text: '今天晴天', final: false })),
    finish: vi.fn(async () => ({ text: '今天晴天。', final: true })),
    cancel: vi.fn(async () => undefined), onPartial: vi.fn(), onRecovery: vi.fn()
  }
  const onText = vi.fn()
  const recording = createRealtimeVoiceRecording({
    online, onText, getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
    createCapture: async (_stream, onSamples) => { feed = onSamples; return { stop: stopCapture } }
  })
  return { recording, online, onText, stopCapture, stopTrack, feed: (count: number) => feed(new Float32Array(count).fill(0.1)) }
}
it('previews continuously and inserts the final punctuated result only once after draining the audio tail', async () => {
  const t = setup(); await t.recording.start()
  t.feed(3500); await flushPromises()
  expect(t.online.onPartial).toHaveBeenCalledWith('今天晴天')
  expect(t.onText).not.toHaveBeenCalled()
  expect(t.online.finish).not.toHaveBeenCalled()
  t.stopCapture.mockImplementationOnce(async () => { t.feed(100) })
  t.recording.stop(); t.recording.stop(); await flushPromises()
  expect(t.online.push.mock.calls.map(args => (args as any)[0].samples.length)).toEqual([1600, 1600, 400])
  expect(t.online.push.mock.calls.map(args => (args as any)[0].sequence)).toEqual([0, 1, 2])
  expect(t.online.finish).toHaveBeenCalledOnce(); expect(t.onText).toHaveBeenCalledTimes(1); expect(t.onText).toHaveBeenCalledWith('今天晴天。')
  expect(t.recording.state.value).toBe('idle'); expect(t.stopTrack).toHaveBeenCalledOnce()
})
it('ignores late recognition after cancellation without inserting text', async () => {
  const t = setup(); let resolve!: (value: { text: string; final: boolean }) => void
  t.online.push.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await t.recording.start(); t.feed(1600); await flushPromises()
  t.recording.cancel(); resolve({ text: '旧录音', final: false }); await flushPromises()
  expect(t.online.cancel).toHaveBeenCalledWith('stream'); expect(t.onText).not.toHaveBeenCalled()
  expect(t.online.onPartial).not.toHaveBeenCalledWith('旧录音'); expect(t.recording.state.value).toBe('idle')
})
it('preserves already recognized text in a recoverable draft when the engine fails', async () => {
  const t = setup(); await t.recording.start(); t.feed(1600); await flushPromises()
  t.online.push.mockRejectedValueOnce(new Error('engine exited'))
  t.feed(1600); await flushPromises()
  expect(t.recording.error.value).toBe('engine exited')
  expect(t.online.onRecovery).toHaveBeenCalledWith('今天晴天')
  expect(t.onText).not.toHaveBeenCalled(); expect(t.online.cancel).toHaveBeenCalledWith('stream')
})
it('cancels a session returned after the user cancelled microphone startup', async () => {
  const t = setup(); let resolve!: (value: string) => void
  t.online.start.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const starting = t.recording.start(); await flushPromises(); t.recording.cancel(); resolve('late')
  await starting
  expect(t.online.cancel).toHaveBeenCalledWith('late'); expect(t.stopTrack).toHaveBeenCalledOnce()
})

it('automatically stops at the model speech endpoint without clicking the microphone', async () => {
  const t = setup()
  t.online.push.mockResolvedValueOnce({ text: '今天晴天', final: false, endpoint: true } as any)
  await t.recording.start(); t.feed(1600); await flushPromises()
  expect(t.online.finish).toHaveBeenCalledWith('stream')
  expect(t.onText).toHaveBeenCalledWith('今天晴天。')
  expect(t.recording.state.value).toBe('idle'); expect(t.stopTrack).toHaveBeenCalledOnce()
})
