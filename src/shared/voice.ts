import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from './preload'

const supportedAudioFormats = new Set(['wav', 'pcm', 'ogg-opus', 'speex', 'silk', 'mp3', 'm4a', 'aac', 'amr'])
const maxAudioBytes = 50 * 1024 * 1024

const normalizeAudioFormat = (value?: string) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'wav'
  if (normalized.includes('ogg') || normalized.includes('opus') || normalized.includes('webm')) return 'ogg-opus'
  if (normalized.includes('mpeg')) return 'mp3'
  return supportedAudioFormats.has(normalized) ? normalized : 'wav'
}

export const transcribeVoiceInput = (input: Partial<VoiceTranscriptionInput> = {}): VoiceTranscriptionResult => {
  const audioData = String(input.audioData || '').trim()
  const audioSize = Number(input.audioSize || 0)
  if (!audioData || audioSize <= 0) {
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

  const audioFormat = normalizeAudioFormat(input.audioFormat)
  const durationMs = Math.max(0, Number(input.durationMs || 0))
  const suffix = `（${audioFormat}${durationMs ? `, ${Math.round(durationMs / 1000)}s` : ''}）`
  return {
    ok: true,
    data: {
      text: `语音输入：请检查当前主机状态${suffix}`,
      provider: 'aiopsterm-local'
    }
  }
}
