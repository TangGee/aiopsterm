import { describe, expect, it } from 'vitest'
import { transcribeVoiceInput } from '@shared/voice'

describe('voice transcription backend', () => {
  it('returns local backend transcription text for development input', () => {
    const result = transcribeVoiceInput({ durationMs: 1500, source: 'local-dev' })

    expect(result).toEqual({
      ok: true,
      data: {
        text: '语音输入：请检查当前主机状态',
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

    const tooLarge = transcribeVoiceInput({ audioSize: 51 * 1024 * 1024 })
    expect(tooLarge).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_TOO_LARGE'
      })
    )
  })
})
