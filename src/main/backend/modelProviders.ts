import type {
  AiModelCatalog,
  AiopsMutationResult,
  ModelProviderCheckInput,
  ModelProviderCheckKey,
  ModelProviderCheckResult,
  ModelProviderUserConfig
} from '@shared/preload'

export const MODEL_PROVIDER_CHECK_MIN_DELAY_MS = 220

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

const defaultAiModelCatalog: AiModelCatalog = {
  chatModels: [
    { id: 'aiopsterm-local-agent', label: 'aiopsterm-local-agent', detail: 'Local aiopsterm backend model', checked: true, type: 'standard', apiProvider: 'default' },
    { id: 'gpt-5-Thinking', label: 'gpt-5-Thinking', detail: 'Extended Thinking model', checked: true, type: 'standard', apiProvider: 'default' },
    { id: 'ops-model', label: 'ops-model', detail: 'OpenAI Compatible model', checked: true, type: 'standard', apiProvider: 'openai' },
    { id: 'qwen2.5-coder', label: 'qwen2.5-coder', detail: 'Ollama model', checked: true, type: 'standard', apiProvider: 'ollama' }
  ],
  lockedChatModels: [
    { id: 'gpt-5-pro', label: 'gpt-5-pro', detail: 'Subscription model', locked: true, checked: true, tier: 'VIP', type: 'standard', apiProvider: 'default' },
    { id: 'ops-large-context', label: 'ops-large-context', detail: 'Large context model', locked: true, checked: true, tier: 'VIP', type: 'standard', apiProvider: 'default' }
  ],
  settingsModels: [
    { name: 'gpt-5', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
    { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
    { name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
    { name: 'custom-maintenance', locked: false, checked: false, type: 'custom', apiProvider: 'openai' }
  ]
}

const cloneModelCatalog = (catalog: AiModelCatalog): AiModelCatalog => ({
  chatModels: catalog.chatModels.map((model) => ({ ...model })),
  lockedChatModels: catalog.lockedChatModels.map((model) => ({ ...model })),
  settingsModels: catalog.settingsModels.map((model) => ({ ...model }))
})

export const listAiModels = async (): Promise<AiModelCatalog> => cloneModelCatalog(defaultAiModelCatalog)

const providerLabels: Record<ModelProviderCheckKey, string> = {
  litellm: 'LiteLLM',
  openai: 'OpenAI Compatible',
  bedrock: 'Amazon Bedrock',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  ollama: 'Ollama'
}

const defaultEndpoints: Record<ModelProviderCheckKey, string> = {
  litellm: 'http://localhost:4000',
  openai: 'https://api.openai.com/v1',
  bedrock: 'bedrock-runtime',
  deepseek: 'https://api.deepseek.com',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434'
}

const normalizeText = (value: unknown) => String(value || '').trim()

const normalizeOpenAiEndpoint = (baseUrl: string, apiFormat: ModelProviderUserConfig['apiFormat']) => {
  if (!baseUrl) return ''
  if (baseUrl.endsWith('#')) return baseUrl.slice(0, -1)

  let normalized = baseUrl
  try {
    const parsed = new URL(baseUrl)
    const hasV1 = parsed.pathname.split('/').filter(Boolean).includes('v1')
    if (!hasV1) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1`
      normalized = parsed.toString().replace(/\/$/, '')
    }
  } catch {
    return baseUrl
  }

  const path = apiFormat === 'responses' ? 'responses' : 'chat/completions'
  return `${normalized}${normalized.endsWith('/') ? '' : '/'}${path}`
}

const validateUrl = (value: string, field: string): string | null => {
  if (!value) return `${field} is required.`
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return `${field} must use http or https.`
  } catch {
    return `${field} must be a valid URL.`
  }
  return null
}

const missingSecretMessage = (provider: ModelProviderCheckKey, config: ModelProviderUserConfig) => {
  if (provider === 'ollama' || provider === 'litellm') return ''
  if (!normalizeText(config.apiKey) && provider !== 'bedrock') return 'API key is required.'
  if (provider === 'bedrock' && (!normalizeText(config.awsAccessKey) || !normalizeText(config.awsSecretKey))) {
    return 'AWS access key and secret key are required.'
  }
  return ''
}

const endpointFor = (provider: ModelProviderCheckKey, config: ModelProviderUserConfig) => {
  const baseUrl = normalizeText(config.baseUrl)
  if (provider === 'openai') return normalizeOpenAiEndpoint(baseUrl || defaultEndpoints.openai, config.apiFormat)
  if (provider === 'bedrock') {
    if (config.awsEndpointSelected && normalizeText(config.awsBedrockEndpoint)) return normalizeText(config.awsBedrockEndpoint)
    return `${defaultEndpoints.bedrock}:${normalizeText(config.awsRegion) || 'us-east-1'}`
  }
  if (provider === 'deepseek') return baseUrl || defaultEndpoints.deepseek
  if (provider === 'anthropic') return baseUrl || defaultEndpoints.anthropic
  return baseUrl || defaultEndpoints[provider]
}

const validateProviderConfig = (
  provider: ModelProviderCheckKey,
  config: ModelProviderUserConfig
): AiopsMutationResult<NonNullable<ModelProviderCheckResult['data']>> | null => {
  const modelId = normalizeText(config.modelId)
  if (!modelId) {
    return {
      ok: false,
      errorCode: 'MODEL_PROVIDER_MODEL_REQUIRED',
      errorMessage: 'Model is required.'
    }
  }

  const endpoint = endpointFor(provider, config)
  if (provider !== 'bedrock') {
    const urlError = validateUrl(endpoint, `${providerLabels[provider]} endpoint`)
    if (urlError) {
      return {
        ok: false,
        errorCode: 'MODEL_PROVIDER_ENDPOINT_INVALID',
        errorMessage: urlError
      }
    }
  } else if (config.awsEndpointSelected && normalizeText(config.awsBedrockEndpoint)) {
    const urlError = validateUrl(normalizeText(config.awsBedrockEndpoint), 'Bedrock endpoint')
    if (urlError) {
      return {
        ok: false,
        errorCode: 'MODEL_PROVIDER_ENDPOINT_INVALID',
        errorMessage: urlError
      }
    }
  }

  const secretError = missingSecretMessage(provider, config)
  if (secretError) {
    return {
      ok: false,
      errorCode: 'MODEL_PROVIDER_SECRET_REQUIRED',
      errorMessage: secretError
    }
  }

  return null
}

export const checkModelProvider = async (input: ModelProviderCheckInput): Promise<ModelProviderCheckResult> => {
  const startedAt = Date.now()
  const provider = input.provider
  const config = input.config || ({} as ModelProviderUserConfig)
  const label = providerLabels[provider]
  if (!label) {
    return {
      ok: false,
      errorCode: 'MODEL_PROVIDER_UNSUPPORTED',
      errorMessage: `Unsupported model provider: ${String(provider)}`
    }
  }

  const validation = validateProviderConfig(provider, config)
  if (validation) return validation

  const elapsedMs = Date.now() - startedAt
  if (elapsedMs < MODEL_PROVIDER_CHECK_MIN_DELAY_MS) {
    await wait(MODEL_PROVIDER_CHECK_MIN_DELAY_MS - elapsedMs)
  }

  const endpoint = endpointFor(provider, config)
  const modelId = normalizeText(config.modelId)
  return {
    ok: true,
    data: {
      provider,
      label,
      modelId,
      endpoint,
      message: `${label} configuration validated by aiopsterm backend.`,
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}
