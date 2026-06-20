import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '../src/shared/contracts/userConfig'

let transcribeVoiceInput: (input?: Record<string, unknown>) => Promise<any>
let configureVoiceBackendRuntime: (config?: { getConfig?: () => UserConfig; fetch?: typeof fetch; timeoutMs?: number }) => void

const browserAudioInput = {
  audioData: Buffer.from(new Uint8Array(2048)).toString('base64'),
  audioFormat: 'audio/webm;codecs=opus',
  audioSize: 2048,
  durationMs: 1500,
  source: 'browser'
}

const browserAudioBytesInput = {
  audioBytes: Uint8Array.from({ length: 2048 }, (_value, index) => index % 255).buffer,
  audioFormat: 'audio/webm;codecs=opus',
  audioSize: 64,
  durationMs: 1500,
  source: 'browser'
}

const openAiVoiceConfig = (provider: 'openai-compatible' | 'litellm' = 'openai-compatible') =>
  ({
    modelName: 'whisper-ops',
    modelProvider: provider,
    modelSettings: {
      addModelSwitch: true,
      options: [{ name: 'whisper-ops', locked: false, checked: true, apiProvider: provider === 'litellm' ? 'litellm' : 'openai' }],
      providers: {
        openai: {
          baseUrl: 'http://127.0.0.1:4010',
          apiKey: 'sk-voice',
          modelId: 'whisper-1',
          apiFormat: 'chat-completions'
        },
        litellm: {
          baseUrl: 'http://127.0.0.1:4020',
          apiKey: 'litellm-voice',
          modelId: 'whisper-proxy'
        }
      }
    }
  }) as UserConfig

beforeAll(async () => {
  const modulePath = '../src/main/backend/voice'
  const backend = await import(modulePath)
  transcribeVoiceInput = backend.transcribeVoiceInput
  configureVoiceBackendRuntime = backend.configureVoiceBackendRuntime
})

afterEach(() => {
  configureVoiceBackendRuntime()
  vi.restoreAllMocks()
})

describe('voice transcription backend', () => {
  it('rejects transcription requests without recorded audio data', async () => {
    const result = await transcribeVoiceInput({ durationMs: 1500 })

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_REQUIRED'
      })
    )
  })

  it('does not fabricate a local transcript when the local voice backend is unavailable', async () => {
    const result = await transcribeVoiceInput(browserAudioInput)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_LOCAL_TRANSCRIBER_UNAVAILABLE'
      })
    )
  })

  it('normalizes browser audio bytes and calls an OpenAI-compatible transcription provider', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: '后端语音 provider 返回的转写文本' })
    })) as unknown as typeof fetch
    configureVoiceBackendRuntime({
      fetch: fetchMock,
      getConfig: () => openAiVoiceConfig()
    })

    const result = await transcribeVoiceInput(browserAudioBytesInput)

    expect(result).toEqual({
      ok: true,
      data: {
        text: '后端语音 provider 返回的转写文本',
        provider: 'openai',
        model: 'whisper-ops'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer sk-voice' },
        body: expect.any(FormData)
      })
    )
    const body = vi.mocked(fetchMock).mock.calls[0]?.[1]?.body as FormData
    expect(body.get('model')).toBe('whisper-1')
    expect(body.get('language')).toBe('zh')
    expect(body.get('response_format')).toBe('json')
    const file = body.get('file') as Blob
    expect(file).toBeInstanceOf(Blob)
    expect(file.type).toBe('audio/ogg')
    expect(file.size).toBe(2048)
  })

  it('keeps compatibility with legacy base64 audio data requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: '旧协议转写' })
    })) as unknown as typeof fetch
    configureVoiceBackendRuntime({
      fetch: fetchMock,
      getConfig: () => openAiVoiceConfig()
    })

    const result = await transcribeVoiceInput(browserAudioInput)

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ text: '旧协议转写', provider: 'openai', model: 'whisper-ops' })
    const body = vi.mocked(fetchMock).mock.calls[0]?.[1]?.body as FormData
    const file = body.get('file') as Blob
    expect(file).toBeInstanceOf(Blob)
    expect(file.size).toBe(2048)
  })

  it('uses the LiteLLM speech endpoint when the selected model provider is LiteLLM', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: 'LiteLLM 转写' })
    })) as unknown as typeof fetch
    configureVoiceBackendRuntime({
      fetch: fetchMock,
      getConfig: () => openAiVoiceConfig('litellm')
    })

    const result = await transcribeVoiceInput({ ...browserAudioInput, audioFormat: 'wav' })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ text: 'LiteLLM 转写', provider: 'litellm', model: 'whisper-ops' })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4020/v1/audio/transcriptions', expect.any(Object))
    const body = vi.mocked(fetchMock).mock.calls[0]?.[1]?.body as FormData
    expect(body.get('model')).toBe('whisper-proxy')
  })

  it('returns structured provider errors instead of fallback transcript text', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'quota exceeded' } })
    })) as unknown as typeof fetch
    configureVoiceBackendRuntime({
      fetch: fetchMock,
      getConfig: () => openAiVoiceConfig()
    })

    const result = await transcribeVoiceInput(browserAudioInput)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_ERROR',
        errorMessage: 'quota exceeded'
      })
    )
  })

  it('rejects too-short, oversized, and unsupported-provider transcription requests', async () => {
    const tooShort = await transcribeVoiceInput({
      ...browserAudioInput,
      audioSize: 512
    })
    expect(tooShort).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_TOO_SHORT'
      })
    )

    const tooLarge = await transcribeVoiceInput({
      ...browserAudioInput,
      audioSize: 51 * 1024 * 1024
    })
    expect(tooLarge).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_AUDIO_TOO_LARGE'
      })
    )

    configureVoiceBackendRuntime({
      getConfig: () =>
        ({
          modelName: 'claude-voice',
          modelProvider: 'anthropic',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'claude-voice', locked: false, checked: true, apiProvider: 'anthropic' }],
            providers: {
              anthropic: {
                baseUrl: 'https://api.anthropic.com',
                apiKey: 'sk-anthropic',
                modelId: 'claude-voice'
              }
            }
          }
        }) as UserConfig
    })

    const unsupported = await transcribeVoiceInput(browserAudioInput)
    expect(unsupported).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'VOICE_TRANSCRIPTION_PROVIDER_UNSUPPORTED',
        errorMessage: expect.stringContaining('anthropic')
      })
    )
  })
})
