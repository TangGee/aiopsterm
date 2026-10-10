import { ref } from 'vue'
import type { RecordingOptions } from './voiceRecording'
import { createVoicePcmCapture, type VoicePcmCapture, type VoicePcmFactory } from './voicePcmCapture'
import { encodeVoiceWav } from './voiceWav'

const rate = 16000

export const createStreamingVoiceRecording = (options: RecordingOptions & { createCapture?: VoicePcmFactory }) => {
  const state = ref<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const error = ref('')
  const startedAt = ref(0)
  let generation = 0
  let stream: MediaStream | null = null
  let capture: VoicePcmCapture | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestId: string | undefined
  let frames: Float32Array[] = []
  let length = 0
  let voiced = 0
  let silence = 0
  let queue: Float32Array[] = []
  let processing = false
  let finishing = false

  const resetSegment = () => { frames = []; length = 0; voiced = 0; silence = 0 }
  const release = () => {
    clearTimeout(timer)
    const previous = capture
    capture = null
    void previous?.stop().catch(() => undefined)
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    options.onStream?.(null)
  }
  const cancel = () => {
    generation++
    if (requestId) options.cancelTranscription?.(requestId)
    requestId = undefined
    release()
    resetSegment()
    queue = []
    processing = false
    finishing = false
    state.value = 'idle'
  }
  const fail = (cause: unknown) => {
    cancel()
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  const drain = async (run: number) => {
    if (processing || run !== generation) return
    processing = true
    try {
      while (queue.length && run === generation) {
        const samples = queue.shift()!
        const audioBytes = encodeVoiceWav([samples], rate)
        requestId = crypto.randomUUID()
        const result = await options.transcribe({ requestId, audioBytes, audioSize: audioBytes.byteLength, audioFormat: 'wav', durationMs: samples.length / rate * 1000, source: 'browser' })
        if (run !== generation) return
        requestId = undefined
        if (!result.ok) {
          if (result.errorCode === 'VOICE_NO_SPEECH') continue
          throw new Error(result.errorMessage || result.errorCode)
        }
        const text = result.data?.text?.trim()
        if (text) options.onText(text)
      }
    } catch (cause) {
      if (run === generation) fail(cause)
    } finally {
      if (run === generation) {
        processing = false
        if (finishing) state.value = 'idle'
      }
    }
  }
  const flush = (run: number) => {
    // Drop silence, including the quiet tail after the last committed phrase.
    if (voiced >= rate * 0.08) {
      const samples = new Float32Array(length)
      let offset = 0
      for (const frame of frames) { samples.set(frame, offset); offset += frame.length }
      queue.push(samples)
    }
    resetSegment()
    void drain(run)
  }
  const stop = () => {
    if (state.value !== 'recording') return
    state.value = 'transcribing'
    clearTimeout(timer)
    const run = generation
    const current = capture
    capture = null
    void (async () => {
      try {
        // The worklet acknowledges only after all preceding PCM frames have arrived.
        await current?.stop()
        if (run !== generation) return
        release()
        finishing = true
        flush(run)
      } catch (cause) { if (run === generation) fail(cause) }
    })()
  }
  const start = async () => {
    if (state.value !== 'idle') return
    const run = ++generation
    state.value = 'starting'
    error.value = ''
    finishing = false
    try {
      const acquired = await (options.getUserMedia?.() ?? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }))
      if (run !== generation) { acquired.getTracks().forEach((track) => track.stop()); return }
      stream = acquired
      const current = await (options.createCapture ?? createVoicePcmCapture)(acquired, (samples) => {
        if (run !== generation) return
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        frames.push(samples)
        length += samples.length
        if (rms >= 0.008) { voiced += samples.length; silence = 0 }
        else silence += samples.length
        // End on a short pause, or cap continuous speech at 2.5 seconds.
        if (length >= rate * 2.5 || (voiced >= rate * 0.08 && silence >= rate * 0.4)) flush(run)
      })
      if (run !== generation) { void current.stop().catch(() => undefined); return }
      capture = current
      options.onStream?.(stream)
      startedAt.value = Date.now()
      state.value = 'recording'
      timer = setTimeout(stop, 60_000)
    } catch (cause) { if (run === generation) fail(cause) }
  }
  return { state, error, startedAt, start, stop, cancel }
}
