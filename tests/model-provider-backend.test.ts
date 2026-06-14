import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'

let checkModelProvider: (input: {
  provider: 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama'
  config: Record<string, unknown>
  timeoutMs?: number
}) => Promise<any>
let listAiModels: (input?: { modelSettings?: any; localChatBackendAvailable?: boolean }) => Promise<any>

type RequestRecord = {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

beforeAll(async () => {
  const modulePath = '../src/main/backend/modelProviders'
  const backend = await import(modulePath)
  checkModelProvider = backend.checkModelProvider as typeof checkModelProvider
  listAiModels = backend.listAiModels as typeof listAiModels
})

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

const readRequestBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = ''
    request.on('data', (chunk) => {
      body += String(chunk)
    })
    request.on('end', () => resolve(body))
  })

const startProviderServer = async (
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void | Promise<void>
): Promise<{ baseUrl: string; requests: RequestRecord[] }> => {
  const requests: RequestRecord[] = []
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request)
    requests.push({
      method: request.method || '',
      url: request.url || '',
      headers: request.headers,
      body
    })
    await handler(request, response, body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests
  }
}

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

describe('model provider backend boundary', () => {
  it('returns a config-derived cloned AI model catalog for the renderer model selectors', async () => {
    const modelSettings = {
      addModelSwitch: true,
      providers: {
        litellm: { baseUrl: 'http://localhost:4000', apiKey: '', modelId: 'gpt-5' },
        openai: { baseUrl: 'https://api.openai.com', apiKey: '', modelId: 'ops-model', apiFormat: 'responses' },
        bedrock: { baseUrl: '', apiKey: '', modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0' },
        deepseek: { baseUrl: '', apiKey: '', modelId: 'deepseek-chat' },
        anthropic: { baseUrl: 'https://api.anthropic.com', apiKey: '', modelId: 'claude-3-5-sonnet-latest' },
        ollama: { baseUrl: 'http://localhost:11434', apiKey: '', modelId: 'qwen2.5-coder' }
      },
      options: [
        { name: 'gpt-5', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
        { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
        { name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
        { name: 'ops-model', locked: false, checked: true, type: 'custom', apiProvider: 'openai' },
        { name: 'qwen2.5-coder', locked: false, checked: true, type: 'custom', apiProvider: 'ollama' },
        { name: 'custom-maintenance', locked: false, checked: false, type: 'custom', apiProvider: 'openai' }
      ]
    }
    const firstCatalog = await listAiModels({ modelSettings, localChatBackendAvailable: true })
    firstCatalog.chatModels[0].label = 'mutated'
    firstCatalog.settingsModels.push({ name: 'mutated-model', locked: false, checked: true })

    const secondCatalog = await listAiModels({ modelSettings, localChatBackendAvailable: true })

    expect(secondCatalog.chatModels.map((model: { id: string }) => model.id)).toEqual([
      'aiopsterm-local-agent',
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

  it('does not expose unavailable local or unsaved provider model rows from the default catalog', async () => {
    const catalog = await listAiModels()

    expect(catalog.chatModels).toEqual([])
    expect(catalog.settingsModels).toEqual([])
    expect(catalog.settingsModels.some((model: { name: string }) => model.name === 'aiopsterm-local-agent')).toBe(false)
    expect(catalog.chatModels.some((model: { id: string }) => model.id === 'aiopsterm-local-agent')).toBe(false)
    expect(catalog.chatModels.some((model: { id: string }) => model.id === 'ops-model')).toBe(false)
    expect(catalog.chatModels.some((model: { id: string }) => model.id === 'qwen2.5-coder')).toBe(false)
  })

  it('exposes the local placeholder model only when the local chat backend is explicitly available', async () => {
    const catalog = await listAiModels({
      localChatBackendAvailable: true,
      modelSettings: {
        addModelSwitch: true,
        providers: {},
        options: [{ name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' }]
      }
    })

    expect(catalog.chatModels.map((model: { id: string }) => model.id)).toEqual(['aiopsterm-local-agent'])
    expect(catalog.chatModels[0]).toEqual(expect.objectContaining({ label: 'aiopsterm-local-agent', apiProvider: 'default' }))
  })

  it('validates OpenAI-compatible configuration against the live Responses endpoint', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { id: 'resp-test' })
    })
    const result = await checkModelProvider({
      provider: 'openai',
      config: {
        baseUrl: server.baseUrl,
        apiKey: 'sk-test',
        modelId: 'gpt-5',
        apiFormat: 'responses'
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'openai',
      label: 'OpenAI Compatible',
      modelId: 'gpt-5',
      endpoint: `${server.baseUrl}/v1/responses`
    })
    expect(result.data?.message).toContain('validated against the live provider endpoint')
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]).toEqual(expect.objectContaining({ method: 'POST', url: '/v1/responses' }))
    expect(server.requests[0].headers.authorization).toBe('Bearer sk-test')
    expect(JSON.parse(server.requests[0].body)).toEqual({
      model: 'gpt-5',
      input: 'test',
      max_output_tokens: 16
    })
  })

  it('treats trailing hash OpenAI-compatible base URLs as complete endpoints', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { id: 'chat-test', choices: [{ message: { content: 'OK' } }] })
    })
    const result = await checkModelProvider({
      provider: 'openai',
      config: {
        baseUrl: `${server.baseUrl}/api/coding/v3#`,
        apiKey: 'sk-test',
        modelId: 'test-code-model',
        apiFormat: 'chat-completions'
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'openai',
      modelId: 'test-code-model',
      endpoint: `${server.baseUrl}/api/coding/v3`
    })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]).toEqual(expect.objectContaining({ method: 'POST', url: '/api/coding/v3' }))
    expect(JSON.parse(server.requests[0].body)).toEqual({
      model: 'test-code-model',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 1
    })
  })

  it('validates Ollama by listing live models instead of accepting configuration only', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { models: [{ name: 'llama3.1' }] })
    })
    const result = await checkModelProvider({
      provider: 'ollama',
      config: {
        baseUrl: server.baseUrl,
        apiKey: '',
        modelId: 'llama3.1'
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'ollama',
      endpoint: `${server.baseUrl}/api/tags`
    })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]).toMatchObject({ method: 'GET', url: '/api/tags' })
  })

  it('validates LiteLLM and DeepSeek through OpenAI-compatible chat completions probes', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { id: 'chat-test', choices: [{ message: { content: 'OK' } }] })
    })

    await expect(
      checkModelProvider({
        provider: 'litellm',
        config: {
          baseUrl: server.baseUrl,
          apiKey: 'litellm-key',
          modelId: 'gpt-5'
        },
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        provider: 'litellm',
        endpoint: `${server.baseUrl}/v1/chat/completions`
      }
    })
    await expect(
      checkModelProvider({
        provider: 'deepseek',
        config: {
          baseUrl: server.baseUrl,
          apiKey: 'deepseek-key',
          modelId: 'deepseek-chat'
        },
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        provider: 'deepseek',
        endpoint: `${server.baseUrl}/v1/chat/completions`
      }
    })

    expect(server.requests.map((request) => request.url)).toEqual(['/v1/chat/completions', '/v1/chat/completions'])
    expect(server.requests.map((request) => request.headers.authorization)).toEqual(['Bearer litellm-key', 'Bearer deepseek-key'])
  })

  it('returns backend failure metadata when Ollama does not list the requested model', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { models: [{ name: 'mistral' }] })
    })
    const result = await checkModelProvider({
      provider: 'ollama',
      config: {
        baseUrl: server.baseUrl,
        apiKey: '',
        modelId: 'llama3.1'
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('MODEL_PROVIDER_CHECK_FAILED')
    expect(result.errorMessage).toContain("Model 'llama3.1' not found")
    expect(result.data).toMatchObject({
      provider: 'ollama',
      endpoint: `${server.baseUrl}/api/tags`,
      modelId: 'llama3.1'
    })
  })

  it('validates Anthropic through the live messages endpoint with provider headers', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { id: 'msg-test', content: [{ type: 'text', text: 'OK' }] })
    })
    const result = await checkModelProvider({
      provider: 'anthropic',
      config: {
        baseUrl: server.baseUrl,
        apiKey: 'anthropic-key',
        modelId: 'claude-3-5-sonnet-latest'
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.data?.endpoint).toBe(`${server.baseUrl}/v1/messages`)
    expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/v1/messages' })
    expect(server.requests[0].headers['x-api-key']).toBe('anthropic-key')
    expect(server.requests[0].headers['anthropic-version']).toBe('2023-06-01')
    expect(JSON.parse(server.requests[0].body)).toMatchObject({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1
    })
  })

  it('signs and validates Bedrock invoke requests behind the backend boundary', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 200, { content: [{ type: 'text', text: 'OK' }] })
    })
    const result = await checkModelProvider({
      provider: 'bedrock',
      config: {
        baseUrl: '',
        apiKey: '',
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        awsAccessKey: 'AKIATEST',
        awsSecretKey: 'secret-test',
        awsSessionToken: 'session-test',
        awsRegion: 'us-east-1',
        awsEndpointSelected: true,
        awsBedrockEndpoint: server.baseUrl
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.data?.endpoint).toBe(`${server.baseUrl}/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke`)
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      url: '/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke'
    })
    expect(server.requests[0].headers.authorization).toEqual(expect.stringContaining('AWS4-HMAC-SHA256 Credential=AKIATEST/'))
    expect(server.requests[0].headers['x-amz-security-token']).toBe('session-test')
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

  it('rejects invalid provider endpoints before network validation', async () => {
    const result = await checkModelProvider({
      provider: 'litellm',
      config: {
        baseUrl: 'file:///tmp/litellm.sock',
        apiKey: '',
        modelId: 'gpt-5'
      }
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'MODEL_PROVIDER_ENDPOINT_INVALID',
      errorMessage: 'LiteLLM endpoint must use http or https.'
    })
  })

  it('returns provider error responses instead of fabricating successful checks', async () => {
    const server = await startProviderServer((_request, response) => {
      sendJson(response, 401, { error: { message: 'invalid api key' } })
    })
    const result = await checkModelProvider({
      provider: 'openai',
      config: {
        baseUrl: server.baseUrl,
        apiKey: 'bad-key',
        modelId: 'gpt-5',
        apiFormat: 'chat-completions'
      },
      timeoutMs: 1000
    })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('MODEL_PROVIDER_CHECK_FAILED')
    expect(result.errorMessage).toContain('invalid api key')
    expect(result.data).toMatchObject({
      provider: 'openai',
      endpoint: `${server.baseUrl}/v1/chat/completions`,
      message: 'invalid api key'
    })
  })
})
