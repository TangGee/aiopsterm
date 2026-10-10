import type { ModelProviderCheckKey } from './appRuntime'
import type { AiopsMutationResult } from './common'

export type VoiceTranscriptionInput = {
  audioData?: string
  audioBytes?: ArrayBuffer | Uint8Array | number[]
  audioFormat?: string
  audioSize?: number
  durationMs?: number
  source?: 'browser'
  requestId?: string
}

export type VoiceTranscriptionProvider = 'aiopsterm-local' | ModelProviderCheckKey

export type VoiceTranscriptionResult = AiopsMutationResult<{
  text: string
  provider: VoiceTranscriptionProvider
  model?: string
}>

export type VoiceInputPreferences = {
  mode: 'local' | 'service'
  endpoint: string
  model: string
  apiKey?: string
  hasApiKey?: boolean
  executablePath: string
  modelPath: string
  shortcut: string
  headsetEnabled: boolean
  position?: { right: number; bottom: number }
}

export type VoiceInputStatus = {
  preferences: VoiceInputPreferences
  shortcutRegistered: boolean
  headsetRegistered: boolean
}

export type VoiceInputTrigger = { source: 'shortcut' | 'headset'; background: boolean }
