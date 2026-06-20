import { afterEach, describe, expect, it, vi } from 'vitest'
import { voiceClient } from '@/services/voiceClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('voiceClient', () => {
  it('returns undefined for unavailable bridge methods and binds voice transcription', async () => {
    const input = {
      source: 'browser' as const,
      durationMs: 1500,
      audioBytes: [1, 2, 3],
      audioFormat: 'audio/webm',
      audioSize: 3
    }

    window.aiops = {
      ...originalAiops,
      transcribeVoiceInput: vi.fn(async () => ({
        ok: true,
        data: {
          text: 'check service status',
          provider: 'aiopsterm-local' as const,
          model: 'voice-local'
        }
      }))
    }

    await expect(voiceClient.transcribeVoiceInput()?.(input)).resolves.toEqual({
      ok: true,
      data: {
        text: 'check service status',
        provider: 'aiopsterm-local',
        model: 'voice-local'
      }
    })
    expect(window.aiops.transcribeVoiceInput).toHaveBeenCalledWith(input)

    window.aiops = {
      ...originalAiops,
      transcribeVoiceInput: undefined as any
    }
    expect(voiceClient.transcribeVoiceInput()).toBeUndefined()
  })
})
