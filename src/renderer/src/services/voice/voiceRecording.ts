import { ref } from 'vue'
import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

export const encodeVoiceWav = (channels: Float32Array[], sampleRate: number): ArrayBuffer => {
  const length = channels[0]?.length || 0
  const output = new ArrayBuffer(44 + length * 2)
  const view = new DataView(output)
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true)
  for (let index = 0; index < length; index++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length))
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return output
}

export const voiceBlobToWav = async (blob: Blob) => {
  const context = new AudioContext({ sampleRate: 16000 })
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000)
    const source = offline.createBufferSource()
    source.buffer = audio
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return encodeVoiceWav([rendered.getChannelData(0)], 16000)
  } finally {
    await context.close()
  }
}

type RecordingOptions = {
  transcribe: (input: VoiceTranscriptionInput) => Promise<VoiceTranscriptionResult>
  cancelTranscription?: (id: string) => void
  onText: (text: string) => void
  getUserMedia?: () => Promise<MediaStream>
  getRecorder?: () => typeof MediaRecorder
  toWav?: (blob: Blob) => Promise<ArrayBuffer>
  onStream?: (stream: MediaStream | null) => void
}

export const createVoiceRecording = (options: RecordingOptions) => {
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
