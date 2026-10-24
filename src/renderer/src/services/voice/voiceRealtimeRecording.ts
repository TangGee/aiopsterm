import { ref } from 'vue'
import type { VoiceStreamChunk, VoiceStreamResult } from '@shared/contracts/voice'
import { createVoicePcmCapture, type VoicePcmCapture, type VoicePcmFactory } from './voicePcmCapture'

export type RealtimeVoiceOptions = {
  enabled: () => boolean
  start: () => Promise<string>
  push: (input: VoiceStreamChunk) => Promise<VoiceStreamResult>
  finish: (sessionId: string) => Promise<VoiceStreamResult>
  cancel: (sessionId: string) => Promise<void>
  onPartial: (text: string) => void
  onWarning?: (text: string) => void
  onRecovery?: (text: string) => void
}
export const createRealtimeVoiceRecording = (options: {
  online: RealtimeVoiceOptions; onText: (text: string) => void
  onStream?: (stream: MediaStream | null) => void
  getUserMedia?: () => Promise<MediaStream>; createCapture?: VoicePcmFactory
}) => {
  const state = ref<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const error = ref('')
  const startedAt = ref(0)
  let generation = 0
  let sessionId: string | undefined
  let stream: MediaStream | null = null
  let capture: VoicePcmCapture | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let buffered = new Float32Array(1600)
  let offset = 0
  let sequence = 0
  let queuedSamples = 0
  let pending: Promise<void> = Promise.resolve()
  let lastText = ''
  const release = () => {
    clearTimeout(timer)
    const current = capture; capture = null
    void current?.stop().catch(() => undefined)
    stream?.getTracks().forEach(track => track.stop()); stream = null
    options.onStream?.(null)
  }
  const cancel = () => {
    generation++
    const id = sessionId; sessionId = undefined
    if (id) void options.online.cancel(id).catch(() => undefined)
    release(); offset = 0; queuedSamples = 0; pending = Promise.resolve()
    options.online.onPartial(''); state.value = 'idle'
  }
  const fail = (cause: unknown, run: number) => {
    if (run !== generation) return
    if (lastText) options.online.onRecovery?.(lastText)
    cancel(); error.value = cause instanceof Error ? cause.message : String(cause)
  }
  const enqueue = (samples: Float32Array, run: number) => {
    queuedSamples += samples.length
    if (queuedSamples > 16000 * 10) { fail(new Error('Recognition cannot keep up with the microphone. Recording stopped without dropping audio silently.'), run); return }
    const id = sessionId!
    const currentSequence = sequence++
    pending = pending.then(async () => {
      if (run !== generation) return
      const result = await options.online.push({ sessionId: id, samples, sequence: currentSequence })
      if (run !== generation) return
      queuedSamples -= samples.length
      lastText = result.text
      options.online.onPartial(result.text)
      if (result.endpoint) stop()
    }).catch(cause => fail(cause, run))
  }
  const stop = () => {
    if (state.value !== 'recording') return
    state.value = 'transcribing'; clearTimeout(timer)
    const run = generation
    const current = capture; capture = null
    void (async () => {
      try {
        await current?.stop()
        if (run !== generation) return
        release()
        if (offset) { enqueue(buffered.slice(0, offset), run); offset = 0 }
        await pending
        if (run !== generation) return
        const result = await options.online.finish(sessionId!)
        if (run !== generation) return
        sessionId = undefined
        if (result.text) options.onText(result.text)
        options.online.onPartial('')
        if (result.warning) options.online.onWarning?.(result.warning)
        state.value = 'idle'
      } catch (cause) { fail(cause, run) }
    })()
  }
  const start = async () => {
    if (state.value !== 'idle') return
    const run = ++generation
    state.value = 'starting'; error.value = ''; sequence = 0; offset = 0; lastText = ''
    options.online.onPartial('')
    try {
      const acquired = await (options.getUserMedia?.() ?? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }))
      if (run !== generation) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired
      const id = await options.online.start()
      if (run !== generation) { void options.online.cancel(id).catch(() => undefined); return }
      sessionId = id
      const current = await (options.createCapture ?? createVoicePcmCapture)(acquired, samples => {
        if (run !== generation) return
        for (let index = 0; index < samples.length && run === generation;) {
          const count = Math.min(samples.length - index, buffered.length - offset)
          buffered.set(samples.subarray(index, index + count), offset)
          offset += count; index += count
          if (offset === buffered.length) { enqueue(buffered, run); buffered = new Float32Array(1600); offset = 0 }
        }
      })
      if (run !== generation) { void current.stop().catch(() => undefined); return }
      capture = current; options.onStream?.(stream)
      startedAt.value = Date.now(); state.value = 'recording'
      timer = setTimeout(stop, 60_000)
    } catch (cause) { fail(cause, run) }
  }
  return { state, error, startedAt, start, stop, cancel }
}
