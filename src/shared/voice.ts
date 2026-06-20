import type { VoiceTranscriptionInput, VoiceTranscriptionProvider, VoiceTranscriptionResult } from './contracts/voice'

const supportedAudioFormats = new Set(['wav', 'pcm', 'ogg-opus', 'speex', 'silk', 'mp3', 'm4a', 'aac', 'amr'])
const maxAudioBytes = 50 * 1024 * 1024
const localVoiceModelName = 'aiopsterm-local-agent'

export type VoiceTranscriptionProviderInput = {
  audioData: string
  audioFormat: string
  audioSize: number
  durationMs: number
  source: VoiceTranscriptionInput['source']
  modelName: string
}

export type VoiceTranscriptionProviderResult =
  | {
      ok: true
      text: string
      provider: VoiceTranscriptionProvider
      model?: string
    }
  | {
      ok: false
      errorCode: string
      errorMessage: string
      provider?: VoiceTranscriptionProvider
      model?: string
    }

export type VoiceTranscriptionRuntime = {
  getModelName?: () => string | undefined
  transcribe?: (input: VoiceTranscriptionProviderInput) => Promise<VoiceTranscriptionProviderResult>
}

let voiceTranscriptionRuntime: VoiceTranscriptionRuntime = {}

const normalizeText = (value: unknown) => String(value || '').trim()

const audioBytesFromInput = (value: unknown): Uint8Array | null => {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value as ArrayBuffer)
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
  }
  if (!Array.isArray(value)) return null
  if (!value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null
  return new Uint8Array(value)
}

const bytesToBase64 = (bytes: Uint8Array) => {
  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: { from: (value: Uint8Array) => { toString: (encoding: 'base64') => string } }
  }).Buffer
  if (bufferCtor?.from) return bufferCtor.from(bytes).toString('base64')
  const btoaImpl = (globalThis as typeof globalThis & { btoa?: (value: string) => string }).btoa
  if (!btoaImpl) return ''
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoaImpl(binary)
}

const normalizeAudioPayload = (input: Partial<VoiceTranscriptionInput>) => {
  const audioBytes = audioBytesFromInput(input.audioBytes)
  if (audioBytes) {
    return {
      audioData: audioBytes.byteLength <= maxAudioBytes ? bytesToBase64(audioBytes) : '',
      audioSize: audioBytes.byteLength,
      hasAudioPayload: true
    }
  }
  const audioData = normalizeText(input.audioData)
  const metadataAudioSize = Number(input.audioSize || 0)
  return {
    audioData,
    audioSize: Number.isFinite(metadataAudioSize) ? metadataAudioSize : 0,
    hasAudioPayload: Boolean(audioData)
  }
}

const normalizeAudioFormat = (value?: string) => {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return 'wav'
  if (normalized.includes('ogg') || normalized.includes('opus') || normalized.includes('webm')) return 'ogg-opus'
  if (normalized.includes('mpeg')) return 'mp3'
  return supportedAudioFormats.has(normalized) ? normalized : 'wav'
}

const voiceModelName = () => normalizeText(voiceTranscriptionRuntime.getModelName?.()) || localVoiceModelName

const shouldUseVoiceProvider = (modelName: string) => normalizeText(modelName) !== '' && normalizeText(modelName) !== localVoiceModelName

export function configureVoiceTranscriptionRuntime(config?: VoiceTranscriptionRuntime) {
  voiceTranscriptionRuntime = config || {}
}

export const transcribeVoiceInput = async (input: Partial<VoiceTranscriptionInput> = {}): Promise<VoiceTranscriptionResult> => {
  const { audioData, audioSize, hasAudioPayload } = normalizeAudioPayload(input)
  if (!hasAudioPayload || audioSize <= 0) {
    return {
      ok: false,
      errorCode: 'VOICE_AUDIO_REQUIRED',
      errorMessage: 'Audio data is required for voice transcription.'
    }
  }
  if (audioSize < 1024) {
    return {
      ok: false,
      errorCode: 'VOICE_AUDIO_TOO_SHORT',
      errorMessage: 'Audio recording is too short.'
    }
  }
  if (audioSize > maxAudioBytes) {
    return {
      ok: false,
      errorCode: 'VOICE_AUDIO_TOO_LARGE',
      errorMessage: 'Audio file exceeds 50 MiB.'
    }
  }
  if (!audioData) {
    return {
      ok: false,
      errorCode: 'VOICE_AUDIO_INVALID',
      errorMessage: 'Recorded audio data could not be encoded for transcription.'
    }
  }

  const modelName = voiceModelName()
  if (!shouldUseVoiceProvider(modelName)) {
    return {
      ok: false,
      errorCode: 'VOICE_LOCAL_TRANSCRIBER_UNAVAILABLE',
      errorMessage: 'Local voice transcription is not configured.'
    }
  }

  if (!voiceTranscriptionRuntime.transcribe) {
    return {
      ok: false,
      errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE',
      errorMessage: 'Voice transcription provider is unavailable.'
    }
  }

  const providerResponse = await voiceTranscriptionRuntime.transcribe({
    audioData,
    audioFormat: normalizeAudioFormat(input.audioFormat),
    audioSize,
    durationMs: Math.max(0, Number(input.durationMs || 0)),
    source: input.source,
    modelName
  })
  if (!providerResponse.ok) {
    return {
      ok: false,
      errorCode: providerResponse.errorCode,
      errorMessage: providerResponse.errorMessage
    }
  }
  const text = normalizeText(providerResponse.text)
  if (!text) {
    return {
      ok: false,
      errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_EMPTY',
      errorMessage: 'Voice transcription provider returned an empty response.'
    }
  }
  return {
    ok: true,
    data: {
      text,
      provider: providerResponse.provider,
      model: providerResponse.model || modelName
    }
  }
}
