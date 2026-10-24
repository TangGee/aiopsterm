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

export type VoiceTranscriptionProvider = 'aiopsterm-local' | 'doubao' | ModelProviderCheckKey

export type VoiceTranscriptionResult = AiopsMutationResult<{
  text: string
  provider: VoiceTranscriptionProvider
  model?: string
}>

export type VoiceInputPreferences = {
  mode: 'local' | 'service'
  serviceProvider?: 'compatible' | 'doubao'
  doubaoAppId?: string
  localEngine?: 'whisper' | 'sensevoice' | 'zipformer'
  tokensPath?: string
  decoderPath?: string
  joinerPath?: string
  punctuationPath?: string
  endpoint: string
  model: string
  apiKey?: string
  hasApiKey?: boolean
  executablePath: string
  modelPath: string
  shortcut: string
  headsetEnabled: boolean
  showFloatingButton?: boolean
  position?: { right: number; bottom: number }
}

export type VoiceInputStatus = {
  preferences: VoiceInputPreferences
  installation?: VoiceInstallProgress
  environment?: { platform: string; arch: string; autoInstallSupported: boolean }
  shortcutRegistered: boolean
  headsetRegistered: boolean
}

export type VoiceInputTrigger = { source: 'shortcut' | 'headset'; background: boolean }

export type VoiceInstallProgress = {
  phase: 'idle' | 'downloading' | 'extracting' | 'checking' | 'complete' | 'cancelled' | 'error'
  asset?: 'engine' | 'model' | 'punctuation'
  received: number
  total: number
  errorMessage?: string
}

export type VoiceStreamResult = { text: string; final: boolean; endpoint?: boolean; warning?: string }
export type VoiceStreamChunk = { sessionId: string; samples: Float32Array; sequence: number }
