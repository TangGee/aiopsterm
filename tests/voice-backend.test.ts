import { describe, expect, it } from 'vitest'
import { transcribeVoiceInput } from '@shared/voice'

describe('voice transcription backend', () => {
  it('rejects transcription requests without recorded audio data', () => {
    const result = transcribeVoiceInput({ durationMs: 1500 })

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_REQUIRED'
      })
    )
  })

  it('returns local backend transcription text for recorded browser audio input', () => {
    const result = transcribeVoiceInput({
      audioData: 'AAAA',
      audioFormat: 'wav',
      audioSize: 2048,
      durationMs: 1500,
      source: 'browser'
    })

    expect(result).toEqual({
      ok: true,
      data: {
        text: '语音输入：请检查当前主机状态（wav, 2s）',
        provider: 'aiopsterm-local'
      }
    })
  })

  it('normalizes browser audio metadata and rejects oversized input', () => {
    const transcribed = transcribeVoiceInput({
      audioData: 'AAAA',
      audioFormat: 'audio/webm;codecs=opus',
      audioSize: 2048,
      durationMs: 3200,
      source: 'browser'
    })
    expect(transcribed.ok).toBe(true)
    expect(transcribed.data?.text).toContain('ogg-opus')
    expect(transcribed.data?.text).toContain('3s')

    const tooShort = transcribeVoiceInput({
      audioData: 'AAAA',
      audioFormat: 'wav',
      audioSize: 512,
      source: 'browser'
    })
    expect(tooShort).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_TOO_SHORT'
      })
    )

    const tooLarge = transcribeVoiceInput({
      audioData: 'AAAA',
      audioFormat: 'wav',
      audioSize: 51 * 1024 * 1024,
      source: 'browser'
    })
    expect(tooLarge).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_TOO_LARGE'
      })
    )
  })
})
