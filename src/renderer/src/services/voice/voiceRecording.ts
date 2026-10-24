import { computed, ref, shallowRef } from 'vue'
import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

import { voiceBlobToWav } from './voiceWav'
import { createStreamingVoiceRecording } from './voiceStreamingRecording'
import { createRealtimeVoiceRecording, type RealtimeVoiceOptions } from './voiceRealtimeRecording'
export { encodeVoiceWav, voiceBlobToWav } from './voiceWav'

export type RecordingOptions = {
  streaming?: boolean
  online?: RealtimeVoiceOptions
  transcribe: (input: VoiceTranscriptionInput) => Promise<VoiceTranscriptionResult>
  cancelTranscription?: (id: string) => void
  onText: (text: string) => void
  getUserMedia?: () => Promise<MediaStream>
  getRecorder?: () => typeof MediaRecorder
  toWav?: (blob: Blob) => Promise<ArrayBuffer>
  onStream?: (stream: MediaStream | null) => void
}

export const createVoiceRecording = (options: RecordingOptions) => {
  if (options.online) {
    const legacy = createStreamingVoiceRecording(options)
    const live = createRealtimeVoiceRecording({ ...options, online: options.online })
    const active = shallowRef(legacy)
    return {
      state: computed(() => active.value.state.value),
      error: computed({ get: () => active.value.error.value, set: value => { active.value.error.value = value } }),
      startedAt: computed(() => active.value.startedAt.value),
      start: () => {
        if (active.value.state.value !== 'idle') return Promise.resolve()
        active.value = options.online!.enabled() ? live : legacy
        return active.value.start()
      },
      stop: () => active.value.stop(), cancel: () => active.value.cancel()
    }
  }
  if (options.streaming) return createStreamingVoiceRecording(options)
  const state = ref<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const error = ref('')
  const startedAt = ref(0)
  let generation = 0
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestId: string | undefined
  let chunks: Blob[] = []

  const release = () => {
    clearTimeout(timer)
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    recorder = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    options.onStream?.(null)
    chunks = []
  }
  const cancel = () => {
    generation++
    if (requestId) options.cancelTranscription?.(requestId)
    requestId = undefined
    release()
    state.value = 'idle'
  }
  const fail = (cause: unknown) => {
    error.value = cause instanceof Error ? cause.message : String(cause)
    release()
    state.value = 'idle'
  }
  const start = async () => {
    if (state.value !== 'idle') return
    const run = ++generation
    state.value = 'starting'
    error.value = ''
    try {
      const acquired = await (options.getUserMedia?.() ?? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }))
      if (run !== generation) { acquired.getTracks().forEach((track) => track.stop()); return }
      stream = acquired
      const Recorder = options.getRecorder?.() ?? MediaRecorder
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((type) => Recorder.isTypeSupported(type))
      recorder = new Recorder(stream, mimeType ? { mimeType } : undefined)
      chunks = []
      recorder.ondataavailable = (event) => { if (run === generation && event.data.size) chunks.push(event.data) }
      recorder.onerror = () => { if (run === generation) fail(new Error('Audio recording failed.')) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType })
        const durationMs = Date.now() - startedAt.value
        release()
        if (run !== generation) return
        state.value = 'transcribing'
        void (async () => {
          try {
            if (durationMs < 220 || !blob.size) throw new Error('Recording is too short.')
            const bytes = await (options.toWav ?? voiceBlobToWav)(blob)
            if (run !== generation) return
            requestId = crypto.randomUUID()
            const result = await options.transcribe({ audioBytes: bytes, audioSize: bytes.byteLength, audioFormat: 'wav', durationMs, source: 'browser', requestId })
            if (run !== generation) return
            requestId = undefined
            if (!result.ok) throw new Error(result.errorMessage || result.errorCode)
            const text = result.data?.text?.trim()
            if (!text) throw new Error('No speech was recognized.')
            options.onText(text)
            state.value = 'idle'
          } catch (cause) { if (run === generation) fail(cause) }
        })()
      }
      recorder.start(100)
      options.onStream?.(stream)
      startedAt.value = Date.now()
      state.value = 'recording'
      timer = setTimeout(stop, 60_000)
    } catch (cause) { if (run === generation) fail(cause) }
  }
  const stop = () => {
    if (state.value !== 'recording') return
    state.value = 'transcribing'
    clearTimeout(timer)
    recorder?.stop()
  }
  return { state, error, startedAt, start, stop, cancel }
}
