import { describe, expect, it } from 'vitest'
import {
  appendModelProviderPath,
  resolveEquivalentClientBaseUrl,
  resolveModelProviderEndpoint,
  suggestModelProviderEndpoint
} from '@shared/modelProviderEndpoint'

const openAiConfig = (baseUrl: string, overrides: Record<string, unknown> = {}) => ({
  baseUrl,
  apiKey: 'test-key',
  modelId: 'gpt-5',
  apiFormat: 'responses' as const,
  endpointMode: 'auto' as const,
  apiPathMode: 'auto' as const,
  ...overrides
})

describe('model provider endpoint resolution', () => {
  it('appends paths with one canonical case-insensitive suffix and no base query', () => {
    expect(appendModelProviderPath('https://gateway.example/API?token=legacy#fragment', 'api')).toBe('https://gateway.example/API')
    expect(appendModelProviderPath('https://gateway.example/base?token=legacy', 'models/list')).toBe(
      'https://gateway.example/base/models/list'
    )
  })

  it('suggests a visible canonical URL for a host-only value', () => {
    const suggestion = suggestModelProviderEndpoint('openai', openAiConfig('api.openai.com'))

    expect(suggestion).toMatchObject({
      originalBaseUrl: 'api.openai.com',
      suggestedBaseUrl: 'https://api.openai.com/v1',
      apiPathMode: 'auto',
      endpoint: 'https://api.openai.com/v1/responses'
    })
    expect(suggestion?.reasons).toEqual(expect.arrayContaining(['protocol', 'v1']))
  })

  it('converts a full operation URL to a reusable visible base URL', () => {
    const suggestion = suggestModelProviderEndpoint('openai', openAiConfig('https://gateway.example/api/responses'))

    expect(suggestion).toMatchObject({
      suggestedBaseUrl: 'https://gateway.example/api/v1',
      endpoint: 'https://gateway.example/api/v1/responses'
    })
  })

  it('uses an exact user endpoint without adding or removing path segments', () => {
    const config = openAiConfig('https://gateway.example/custom/invoke', { endpointMode: 'exact' as const })

    expect(suggestModelProviderEndpoint('openai', config)).toBeNull()
    expect(resolveModelProviderEndpoint('openai', config)).toMatchObject({
      baseUrl: 'https://gateway.example/custom/invoke',
      endpoint: 'https://gateway.example/custom/invoke',
      valid: true
    })
  })

  it('keeps the legacy hash behavior while proposing a visible replacement', () => {
    const config = openAiConfig('https://gateway.example/api/coding/v3#')
    const suggestion = suggestModelProviderEndpoint('openai', config)

    expect(resolveModelProviderEndpoint('openai', config).endpoint).toBe('https://gateway.example/api/coding/v3/responses')
    expect(suggestion).toMatchObject({
      suggestedBaseUrl: 'https://gateway.example/api/coding/v3',
      apiPathMode: 'none',
      endpoint: 'https://gateway.example/api/coding/v3/responses'
    })
  })

  it('derives a client base only when the exact operation suffix is equivalent', () => {
    expect(
      resolveEquivalentClientBaseUrl(
        'openai',
        openAiConfig('https://gateway.example/v1/responses', { endpointMode: 'exact' as const })
      )
    ).toBe('https://gateway.example/v1')
    expect(
      resolveEquivalentClientBaseUrl(
        'openai',
        openAiConfig('https://gateway.example/custom/invoke', { endpointMode: 'exact' as const })
      )
    ).toBeNull()
  })

  it('uses provider-specific operation paths from the same resolver', () => {
    expect(
      resolveModelProviderEndpoint('ollama', {
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        modelId: 'llama3.1',
        endpointMode: 'auto',
        apiPathMode: 'auto'
      }).endpoint
    ).toBe('http://localhost:11434/api/tags')
    expect(
      resolveModelProviderEndpoint(
        'ollama',
        {
          baseUrl: 'http://localhost:11434',
          apiKey: '',
          modelId: 'llama3.1',
          endpointMode: 'auto',
          apiPathMode: 'auto'
        },
        'api/chat'
      ).endpoint
    ).toBe('http://localhost:11434/api/chat')
  })
})
