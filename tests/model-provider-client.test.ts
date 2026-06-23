import { afterEach, describe, expect, it, vi } from 'vitest'
import { isModelProviderCheckDataForRequest, listAiModelCatalog, modelProviderClient, normalizeAiModelCatalog } from '@/services/ai/modelProviderClient'

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

  it('returns null for unavailable model catalog bridges and binds available methods', async () => {
    const listAiModels = vi.fn(async (input) => ({
      chatModels: [{ id: 'ops-model', label: 'Ops Model', detail: 'openai / ops-model', apiProvider: 'openai' }],
      lockedChatModels: [],
      settingsModels: input?.modelSettings?.options || []
    }))
    window.aiops = {
      ...originalAiops,
      listAiModels
    }

    await expect(
      listAiModelCatalog({
        modelSettings: {
          addModelSwitch: true,
          providers: {} as any,
          options: [{ name: 'ops-model', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }]
        }
      })
    ).resolves.toEqual({
      chatModels: [expect.objectContaining({ id: 'ops-model', label: 'Ops Model', apiProvider: 'openai' })],
      lockedChatModels: [],
      settingsModels: [expect.objectContaining({ name: 'ops-model', checked: true, apiProvider: 'openai' })]
    })
    expect(listAiModels).toHaveBeenCalledWith({
      modelSettings: expect.objectContaining({
        options: [expect.objectContaining({ name: 'ops-model', apiProvider: 'openai' })]
      })
    })

    window.aiops = { ...originalAiops, listAiModels: undefined as any }
    await expect(listAiModelCatalog({ modelSettings: undefined })).resolves.toBeNull()
    expect(modelProviderClient.listAiModels()).toBeUndefined()
  })

  it('normalizes model catalog rows and rejects legacy local/mock catalog entries', () => {
    expect(
      normalizeAiModelCatalog({
        chatModels: [
          { id: ' mock-ops-agent ', label: 'mock-ops-agent', detail: '', apiProvider: 'mock' },
          { id: 'ops-local-agent', label: 'ops-local-agent', detail: '', apiProvider: 'default' },
          { id: 'ops-model', label: '  ', detail: '  ', displayName: 'Ops Model', apiProvider: 'openai', checked: false },
          { id: 'legacy-provider-row', label: 'Legacy Provider Row', detail: '', apiProvider: 'mock' }
        ],
        lockedChatModels: [
          { id: 'gpt-5-pro', label: 'GPT-5 Pro', detail: 'Entitlement', locked: false, tier: 'VIP', apiProvider: 'default' },
          { id: 'locked-local', label: 'Locked Local', detail: '', apiProvider: 'mock' }
        ],
        settingsModels: [
          { name: 'mock-ops-agent', locked: false, checked: true, type: 'standard', apiProvider: 'mock' },
          { name: 'ops-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
          { name: ' custom-model ', displayName: ' Custom Model ', locked: false, checked: false, type: 'custom', apiProvider: ' openai ' },
          { name: 'custom-model', displayName: 'Duplicate', locked: false, checked: true, type: 'custom', apiProvider: 'openai' },
          { name: 'locked-standard', locked: true, checked: true, type: 'custom', apiProvider: '' }
        ]
      })
    ).toEqual({
      chatModels: [
        expect.objectContaining({
          id: 'ops-model',
          label: 'Ops Model',
          detail: '',
          displayName: 'Ops Model',
          checked: false,
          locked: false,
          type: 'standard',
          apiProvider: 'openai'
        })
      ],
      lockedChatModels: [
        expect.objectContaining({
          id: 'gpt-5-pro',
          label: 'GPT-5 Pro',
          locked: true,
          tier: 'VIP',
          apiProvider: 'default'
        })
      ],
      settingsModels: [
        expect.objectContaining({
          name: 'custom-model',
          displayName: 'Custom Model',
          locked: false,
          checked: false,
          type: 'custom',
          apiProvider: 'openai'
        }),
        expect.objectContaining({
          name: 'locked-standard',
          locked: true,
          checked: true,
          type: 'custom',
          apiProvider: 'default'
        })
      ]
    })
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
