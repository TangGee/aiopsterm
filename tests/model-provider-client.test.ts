import { afterEach, describe, expect, it, vi } from 'vitest'
import { isModelProviderCheckDataForRequest, modelProviderClient } from '@/services/modelProviderClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('modelProviderClient', () => {
  it('returns undefined for unavailable check bridges and binds available methods', async () => {
    window.aiops = {
      ...originalAiops,
      checkModelProvider: vi.fn(async () => ({
        ok: true,
        data: {
          provider: 'openai',
          label: 'OpenAI Compatible',
          modelId: 'gpt-5',
          endpoint: 'https://api.openai.com/v1/responses',
          message: 'validated',
          durationMs: 12
        }
      } as const))
    }

    await expect(
      modelProviderClient.checkModelProvider()?.({
        provider: 'openai',
        config: { baseUrl: 'https://api.openai.com', apiKey: 'test-key', modelId: 'gpt-5', apiFormat: 'responses' }
      })
    ).resolves.toEqual({
      ok: true,
      data: {
        provider: 'openai',
        label: 'OpenAI Compatible',
        modelId: 'gpt-5',
        endpoint: 'https://api.openai.com/v1/responses',
        message: 'validated',
        durationMs: 12
      }
    })
    expect(window.aiops.checkModelProvider).toHaveBeenCalledWith({
      provider: 'openai',
      config: { baseUrl: 'https://api.openai.com', apiKey: 'test-key', modelId: 'gpt-5', apiFormat: 'responses' }
    })

    window.aiops = { ...originalAiops, checkModelProvider: undefined as any }
    expect(modelProviderClient.checkModelProvider()).toBeUndefined()
  })

  it('validates model provider check payloads against the request', () => {
    const expectedConfig = {
      baseUrl: 'https://gateway.local',
      apiKey: 'test-key',
      modelId: 'ops-model',
      apiFormat: 'chat-completions' as const
    }
    const validResult = {
      provider: 'openai',
      label: 'OpenAI Compatible',
      modelId: 'ops-model',
      endpoint: 'https://gateway.local/v1/chat/completions',
      message: 'validated',
      durationMs: 1
    }

    expect(isModelProviderCheckDataForRequest(validResult, 'openai', expectedConfig)).toBe(true)
    expect(isModelProviderCheckDataForRequest({ ...validResult, provider: 'litellm' }, 'openai', expectedConfig)).toBe(false)
    expect(isModelProviderCheckDataForRequest({ ...validResult, modelId: 'other-model' }, 'openai', expectedConfig)).toBe(false)
    expect(isModelProviderCheckDataForRequest({ ...validResult, message: '   ' }, 'openai', expectedConfig)).toBe(false)
    expect(isModelProviderCheckDataForRequest({ ...validResult, durationMs: -1 }, 'openai', expectedConfig)).toBe(false)
  })
})
