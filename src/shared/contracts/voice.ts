import type { ModelProviderCheckKey } from './appRuntime'
import type { AiopsMutationResult } from './common'

export type VoiceTranscriptionInput = {
  audioData?: string
  audioBytes?: ArrayBuffer | Uint8Array | number[]
  audioFormat?: string
  audioSize?: number
  durationMs?: number
  source?: 'browser'
}

export type VoiceTranscriptionProvider = 'aiopsterm-local' | ModelProviderCheckKey

export type VoiceTranscriptionResult = AiopsMutationResult<{
  text: string
  provider: VoiceTranscriptionProvider
  model?: string
}>
