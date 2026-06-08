import { beforeAll, describe, expect, it } from 'vitest'

let checkModelProvider: (input: {
  provider: 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama'
  config: Record<string, unknown>
}) => Promise<any>
let listAiModels: () => Promise<any>
let minDelayMs: number

beforeAll(async () => {
  const modulePath = '../src/main/backend/modelProviders'
  const backend = await import(modulePath)
  checkModelProvider = backend.checkModelProvider as typeof checkModelProvider
  listAiModels = backend.listAiModels as typeof listAiModels
  minDelayMs = backend.MODEL_PROVIDER_CHECK_MIN_DELAY_MS
})

describe('model provider backend boundary', () => {
  it('returns a cloned AI model catalog for the renderer model selectors', async () => {
    const firstCatalog = await listAiModels()
    firstCatalog.chatModels[0].label = 'mutated'
    firstCatalog.settingsModels.push({ name: 'mutated-model', locked: false, checked: true })

    const secondCatalog = await listAiModels()

    expect(secondCatalog.chatModels.map((model: { id: string }) => model.id)).toEqual([
      'aiopsterm-local-agent',
      'gpt-5-Thinking',
      'ops-model',
      'qwen2.5-coder'
    ])
    expect(secondCatalog.lockedChatModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-5-pro', locked: true, tier: 'VIP' }),
        expect.objectContaining({ id: 'ops-large-context', locked: true, tier: 'VIP' })
      ])
    )
    expect(secondCatalog.settingsModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard' }),
        expect.objectContaining({ name: 'custom-maintenance', locked: false, checked: false, type: 'custom' })
      ])
    )
    expect(secondCatalog.chatModels[0].label).toBe('aiopsterm-local-agent')
    expect(secondCatalog.settingsModels.some((model: { name: string }) => model.name === 'mutated-model')).toBe(false)
  })

  it('validates OpenAI-compatible configuration and normalizes the Responses endpoint', async () => {
    const startedAt = Date.now()
    const result = await checkModelProvider({
      provider: 'openai',
      config: {
        baseUrl: 'https://models.example.test',
        apiKey: 'sk-test',
        modelId: 'gpt-5',
        apiFormat: 'responses'
      }
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'openai',
      label: 'OpenAI Compatible',
      modelId: 'gpt-5',
      endpoint: 'https://models.example.test/v1/responses'
    })
    expect(result.data?.message).toContain('validated by aiopsterm backend')
    expect(elapsedMs).toBeGreaterThanOrEqual(minDelayMs - 25)
  })

  it('accepts local Ollama checks without requiring an API key', async () => {
    const result = await checkModelProvider({
      provider: 'ollama',
      config: {
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        modelId: 'llama3.1'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'ollama',
      endpoint: 'http://localhost:11434'
    })
  })

  it('rejects missing cloud API keys behind the preload/main boundary', async () => {
    const result = await checkModelProvider({
      provider: 'anthropic',
      config: {
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        modelId: 'claude-3-5-sonnet-latest'
      }
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'MODEL_PROVIDER_SECRET_REQUIRED',
      errorMessage: 'API key is required.'
    })
  })

  it('rejects invalid provider endpoints before the local validation delay', async () => {
    const startedAt = Date.now()
    const result = await checkModelProvider({
      provider: 'litellm',
      config: {
        baseUrl: 'file:///tmp/litellm.sock',
        apiKey: '',
        modelId: 'gpt-5'
      }
    })
    const elapsedMs = Date.now() - startedAt

    expect(result).toEqual({
      ok: false,
      errorCode: 'MODEL_PROVIDER_ENDPOINT_INVALID',
      errorMessage: 'LiteLLM endpoint must use http or https.'
    })
    expect(elapsedMs).toBeLessThan(minDelayMs)
  })
})
