import {
  configureVoiceTranscriptionRuntime,
  transcribeVoiceInput,
  type VoiceTranscriptionProviderInput,
  type VoiceTranscriptionProviderResult
} from '@shared/voice'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { ModelProviderCheckKey, ModelProviderUserConfig } from '@shared/contracts/appRuntime'
import { resolveModelProviderEndpoint } from '@shared/modelProviderEndpoint'
import { resolveModelProvider } from './modelProviderText'

type VoiceBackendRuntimeConfig = {
  getConfig?: () => UserConfig
  fetch?: typeof fetch
  timeoutMs?: number
}

const normalizeText = (value: unknown) => String(value || '').trim()
const openAiSpeechProviders = new Set<ModelProviderCheckKey>(['openai', 'litellm'])

const audioMimeType = (format: string) => {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'ogg-opus':
      return 'audio/ogg'
    case 'pcm':
      return 'audio/wav'
    default:
      return `audio/${format || 'wav'}`
  }
}

const audioFileExtension = (format: string) => {
  if (format === 'ogg-opus') return 'ogg'
  if (format === 'pcm') return 'wav'
  return format || 'wav'
}

const parseResponsePayload = (body: string): unknown => {
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const parseProviderError = (body: string, fallback: string) => {
  if (!body) return fallback
  try {
    const parsed = JSON.parse(body) as unknown
    if (isRecord(parsed)) {
      const error = isRecord(parsed.error) ? parsed.error : null
      const message = error?.message || parsed.message || parsed.error || parsed.detail
      if (message) return String(message)
    }
  } catch {
    // Plain text provider errors are useful as-is.
  }
  return body.slice(0, 500)
}

const textFromProviderPayload = (payload: unknown) => {
  if (typeof payload === 'string') return normalizeText(payload)
  if (!isRecord(payload)) return ''
  if (typeof payload.text === 'string') return normalizeText(payload.text)
  if (typeof payload.transcript === 'string') return normalizeText(payload.transcript)
  const data = payload.data
  return isRecord(data) && typeof data.text === 'string' ? normalizeText(data.text) : ''
}

async function transcribeWithModelProvider(
  input: VoiceTranscriptionProviderInput,
  config: VoiceBackendRuntimeConfig
): Promise<VoiceTranscriptionProviderResult> {
  const userConfig = config.getConfig?.()
  if (!userConfig) {
    return {
      ok: false,
      errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE',
      errorMessage: 'Voice transcription provider is unavailable.'
    }
  }

  const providerConfig = resolveModelProvider(userConfig, input.modelName)
  if (!providerConfig) {
    return {
      ok: false,
      errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE',
      errorMessage: 'Voice transcription provider is unavailable.'
    }
  }
  if (!openAiSpeechProviders.has(providerConfig.provider)) {
    return {
      ok: false,
      errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_UNSUPPORTED',
      errorMessage: `${providerConfig.provider} does not expose an OpenAI-compatible speech transcription endpoint.`,
      provider: providerConfig.provider
    }
  }

  const apiKey = normalizeText(providerConfig.config.apiKey)
  const model = normalizeText(providerConfig.config.modelId) || providerConfig.modelName
  if (!apiKey || !model) {
    return {
      ok: false,
      errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_UNAVAILABLE',
      errorMessage: 'Voice transcription provider is unavailable.',
      provider: providerConfig.provider
    }
  }

  const audioBytes = Buffer.from(input.audioData, 'base64')
  if (!audioBytes.byteLength) {
    return {
      ok: false,
      errorCode: 'VOICE_AUDIO_INVALID',
      errorMessage: 'Recorded audio data is not valid base64.',
      provider: providerConfig.provider
    }
  }

  const formData = new FormData()
  formData.append('model', model)
  formData.append('language', 'zh')
  formData.append('response_format', 'json')
  formData.append(
    'file',
    new Blob([audioBytes], { type: audioMimeType(input.audioFormat) }),
    `voice-input.${audioFileExtension(input.audioFormat)}`
  )

  const endpoint = resolveModelProviderEndpoint(providerConfig.provider, providerConfig.config, 'audio/transcriptions').endpoint
  const fetchImpl = config.fetch || fetch
  const timeoutMs = Math.max(500, Math.min(120_000, Math.round(config.timeoutMs || 60_000)))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData,
      signal: controller.signal
    })
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      return {
        ok: false,
        errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_ERROR',
        errorMessage: parseProviderError(body, `Provider returned HTTP ${response.status || 'error'}`),
        provider: providerConfig.provider
      }
    }
    const text = textFromProviderPayload(parseResponsePayload(body))
    if (!text) {
      return {
        ok: false,
        errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_EMPTY',
        errorMessage: 'Voice transcription provider returned an empty response.',
        provider: providerConfig.provider
      }
    }
    return {
      ok: true,
      text,
      provider: providerConfig.provider,
      model: providerConfig.modelName
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof Error && error.name === 'AbortError' ? 'VOICE_TRANSCRIPTION_PROVIDER_TIMEOUT' : 'VOICE_TRANSCRIPTION_PROVIDER_ERROR',
      errorMessage:
        error instanceof Error && error.name === 'AbortError'
          ? `Voice transcription provider timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      provider: providerConfig.provider
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function configureVoiceBackendRuntime(config?: VoiceBackendRuntimeConfig) {
  configureVoiceTranscriptionRuntime(
    config
      ? {
          getModelName: () => normalizeText(config.getConfig?.().modelName) || 'aiopsterm-local-agent',
          transcribe: (input) => transcribeWithModelProvider(input, config)
        }
      : undefined
  )
}

export { configureVoiceTranscriptionRuntime, transcribeVoiceInput }
