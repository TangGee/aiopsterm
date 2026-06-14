import { createHash, createHmac } from 'crypto'
import type {
  AiModelCatalog,
  AiModelCatalogInput,
  AiopsMutationResult,
  ModelOptionUserConfig,
  ModelProviderCheckInput,
  ModelProviderCheckKey,
  ModelProviderCheckResult,
  ModelProviderUserConfig,
  ModelSettingsUserConfig
} from '@shared/preload'

const defaultSettingsModelOptions: ModelOptionUserConfig[] = []

const lockedCatalogModels: AiModelCatalog['lockedChatModels'] = [
  { id: 'gpt-5-pro', label: 'gpt-5-pro', detail: 'Subscription model', locked: true, checked: true, tier: 'VIP', type: 'standard', apiProvider: 'default' },
  { id: 'ops-large-context', label: 'ops-large-context', detail: 'Large context model', locked: true, checked: true, tier: 'VIP', type: 'standard', apiProvider: 'default' }
]

const cloneModelCatalog = (catalog: AiModelCatalog): AiModelCatalog => ({
  chatModels: catalog.chatModels.map((model) => ({ ...model })),
  lockedChatModels: catalog.lockedChatModels.map((model) => ({ ...model })),
  settingsModels: catalog.settingsModels.map((model) => ({ ...model }))
})

const normalizeText = (value: unknown) => String(value || '').trim()

const modelOptionTypes = new Set(['standard', 'custom'])
const modelProviderKeys = new Set(['default', 'litellm', 'openai', 'bedrock', 'deepseek', 'anthropic', 'ollama'])

const providerLabels: Record<ModelProviderCheckKey, string> = {
  litellm: 'LiteLLM',
  openai: 'OpenAI Compatible',
  bedrock: 'Amazon Bedrock',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  ollama: 'Ollama'
}

const normalizeModelOption = (value: unknown): ModelOptionUserConfig | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = normalizeText(record.name)
  if (!name) return null
  const displayName = normalizeText(record.displayName)
  const locked = typeof record.locked === 'boolean' ? record.locked : false
  const type = modelOptionTypes.has(String(record.type)) ? (record.type as ModelOptionUserConfig['type']) : locked ? 'standard' : 'custom'
  const apiProvider = normalizeText(record.apiProvider) || (locked ? 'default' : 'openai')
  return {
    name,
    displayName: displayName && displayName !== name ? displayName : undefined,
    locked,
    checked: typeof record.checked === 'boolean' ? record.checked : true,
    type,
    apiProvider: modelProviderKeys.has(apiProvider) ? apiProvider : 'default'
  }
}

const normalizeSettingsOptions = (value: unknown): ModelOptionUserConfig[] => {
  const source = Array.isArray(value) ? value : defaultSettingsModelOptions
  const seen = new Set<string>()
  const options: ModelOptionUserConfig[] = []
  for (const item of source) {
    const option = normalizeModelOption(item)
    if (!option || seen.has(option.name)) continue
    seen.add(option.name)
    options.push(option)
  }
  return options
}

const configuredProviderModelIds = (settings?: ModelSettingsUserConfig) => {
  const providers = settings?.providers
  return new Set(
    [providers?.litellm, providers?.openai, providers?.bedrock, providers?.deepseek, providers?.anthropic, providers?.ollama]
      .map((provider) => normalizeText(provider?.modelId))
      .filter(Boolean)
  )
}

const detailForModelOption = (option: ModelOptionUserConfig) => {
  if (option.name === 'aiopsterm-local-agent') return 'Local aiopsterm backend model'
  if (option.name.endsWith('-Thinking')) return 'Extended Thinking model'
  if (option.type === 'custom') return `${providerLabels[(option.apiProvider || 'openai') as ModelProviderCheckKey] || option.apiProvider || 'Custom'} · Model ID: ${option.name}`
  return option.locked ? 'Subscription model' : 'Configured model'
}

const buildModelCatalog = (input: AiModelCatalogInput = {}): AiModelCatalog => {
  const settings = input.modelSettings
  const settingsModels = normalizeSettingsOptions(settings?.options)
  const configuredModelIds = configuredProviderModelIds(settings)
  const chatModels = settingsModels
    .filter((model) => {
      if (!model.checked || model.locked) return false
      if (model.name === 'aiopsterm-local-agent') return input.localChatBackendAvailable === true
      return model.apiProvider === 'default' || configuredModelIds.has(model.name)
    })
    .map((model) => ({
      id: model.name,
      label: model.displayName || model.name,
      detail: detailForModelOption(model),
      displayName: model.displayName,
      checked: model.checked,
      locked: model.locked,
      type: model.type,
      apiProvider: model.apiProvider
    }))
  return {
    chatModels,
    lockedChatModels: lockedCatalogModels.map((model) => ({ ...model })),
    settingsModels
  }
}

export const listAiModels = async (input: AiModelCatalogInput = {}): Promise<AiModelCatalog> => cloneModelCatalog(buildModelCatalog(input))

const defaultEndpoints: Record<ModelProviderCheckKey, string> = {
  litellm: 'http://localhost:4000',
  openai: 'https://api.openai.com/v1',
  bedrock: 'bedrock-runtime',
  deepseek: 'https://api.deepseek.com',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434'
}

const normalizeOpenAiEndpoint = (baseUrl: string, apiFormat: ModelProviderUserConfig['apiFormat']) => {
  if (!baseUrl) return ''
  const path = apiFormat === 'responses' ? 'responses' : 'chat/completions'
  return normalizeOpenAiOperationEndpoint(baseUrl, path)
}

const appendEndpointPath = (baseUrl: string, path: string) => {
  try {
    const parsed = new URL(baseUrl)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const pathSegments = path.split('/').filter(Boolean)
    const hasTrailingPath = pathSegments.length > 0 && pathSegments.every((segment, index) => segments[segments.length - pathSegments.length + index] === segment)
    if (!hasTrailingPath) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/${pathSegments.join('/')}`
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}

const normalizeOpenAiBaseUrl = (baseUrl: string) => {
  if (!baseUrl) return ''
  const skipVersionPrefix = baseUrl.endsWith('#')
  const normalizedBaseUrl = skipVersionPrefix ? baseUrl.slice(0, -1) : baseUrl
  try {
    const parsed = new URL(normalizedBaseUrl)
    const hasVersionSegment = parsed.pathname.split('/').filter(Boolean).some((segment) => /^v\d+$/i.test(segment))
    if (!skipVersionPrefix && !hasVersionSegment) parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1`
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return normalizedBaseUrl
  }
}

const normalizeOpenAiOperationEndpoint = (baseUrl: string, path: string) => {
  const normalized = normalizeOpenAiBaseUrl(baseUrl)
  return appendEndpointPath(normalized, path)
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
  if (provider === 'ollama') return ''
  if (!normalizeText(config.apiKey) && provider !== 'bedrock') return 'API key is required.'
  if (provider === 'bedrock' && (!normalizeText(config.awsAccessKey) || !normalizeText(config.awsSecretKey))) {
    return 'AWS access key and secret key are required.'
  }
  return ''
}

const endpointFor = (provider: ModelProviderCheckKey, config: ModelProviderUserConfig) => {
  const baseUrl = normalizeText(config.baseUrl)
  if (provider === 'openai') return normalizeOpenAiEndpoint(baseUrl || defaultEndpoints.openai, config.apiFormat)
  if (provider === 'litellm') return normalizeOpenAiOperationEndpoint(baseUrl || defaultEndpoints.litellm, 'chat/completions')
  if (provider === 'bedrock') {
    const region = normalizeText(config.awsRegion) || 'us-east-1'
    const baseEndpoint =
      config.awsEndpointSelected && normalizeText(config.awsBedrockEndpoint)
        ? normalizeText(config.awsBedrockEndpoint)
        : `https://bedrock-runtime.${region}.amazonaws.com`
    return appendEndpointPath(baseEndpoint, `model/${encodeURIComponent(normalizeText(config.modelId))}/invoke`)
  }
  if (provider === 'deepseek') return normalizeOpenAiOperationEndpoint(baseUrl || defaultEndpoints.deepseek, 'chat/completions')
  if (provider === 'anthropic') return appendEndpointPath(baseUrl || defaultEndpoints.anthropic, 'v1/messages')
  if (provider === 'ollama') return appendEndpointPath(baseUrl || defaultEndpoints.ollama, 'api/tags')
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

const jsonStringify = (value: unknown) => JSON.stringify(value)

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value, 'utf8').digest()

const hmacHex = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value, 'utf8').digest('hex')

const toAmzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '')

const toDateStamp = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '')

const clampTimeoutMs = (value: unknown) => {
  const parsed = Math.round(Number(value) || 0)
  if (!parsed) return 20_000
  return Math.max(500, Math.min(60_000, parsed))
}

const parseErrorMessage = async (response: Response) => {
  const text = await response.text().catch(() => '')
  if (!text) return `${response.status} ${response.statusText}`.trim()
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const error = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : null
      const message = error?.message || record.message || record.error || record.detail
      if (message) return String(message)
    }
  } catch {
    // Plain-text provider errors are useful as-is.
  }
  return text.slice(0, 500)
}

const failureResult = (
  provider: ModelProviderCheckKey,
  label: string,
  endpoint: string,
  modelId: string,
  startedAt: number,
  message: string,
  errorCode = 'MODEL_PROVIDER_CHECK_FAILED'
): ModelProviderCheckResult => ({
  ok: false,
  errorCode,
  errorMessage: `${label} validation failed: ${message}`,
  data: {
    provider,
    label,
    modelId,
    endpoint,
    message,
    durationMs: Math.max(1, Date.now() - startedAt)
  }
})

const successResult = (
  provider: ModelProviderCheckKey,
  label: string,
  endpoint: string,
  modelId: string,
  startedAt: number
): ModelProviderCheckResult => ({
  ok: true,
  data: {
    provider,
    label,
    modelId,
    endpoint,
    message: `${label} configuration validated against the live provider endpoint.`,
    durationMs: Math.max(1, Date.now() - startedAt)
  }
})

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

const createOpenAiCompatibleRequest = (provider: ModelProviderCheckKey, config: ModelProviderUserConfig) => {
  const model = normalizeText(config.modelId)
  const apiKey = normalizeText(config.apiKey)
  const useResponses = provider === 'openai' && config.apiFormat === 'responses'
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || 'noop'}`
    },
    body: jsonStringify(
      useResponses
        ? {
            model,
            input: 'test',
            max_output_tokens: 16
          }
        : {
            model,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1
          }
    )
  }
}

const createAnthropicRequest = (config: ModelProviderUserConfig) => ({
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': normalizeText(config.apiKey),
    'anthropic-version': '2023-06-01'
  },
  body: jsonStringify({
    model: normalizeText(config.modelId),
    max_tokens: 1,
    system: "This is a connection test. Respond with only the word 'OK'.",
    messages: [{ role: 'user', content: 'Connection test' }]
  })
})

const createBedrockPayload = (config: ModelProviderUserConfig) =>
  jsonStringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Connection test' }]
      }
    ]
  })

const signBedrockRequest = (endpoint: string, config: ModelProviderUserConfig, body: string) => {
  const url = new URL(endpoint)
  const region = normalizeText(config.awsRegion) || 'us-east-1'
  const accessKey = normalizeText(config.awsAccessKey)
  const secretKey = normalizeText(config.awsSecretKey)
  const sessionToken = normalizeText(config.awsSessionToken)
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = toDateStamp(now)
  const payloadHash = sha256Hex(body)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  }
  if (sessionToken) headers['x-amz-security-token'] = sessionToken

  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join('')
  const canonicalRequest = ['POST', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 'bedrock'), 'aws4_request')
  const signature = hmacHex(signingKey, stringToSign)

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}

const performProviderCheck = async (
  provider: ModelProviderCheckKey,
  config: ModelProviderUserConfig,
  endpoint: string,
  timeoutMs: number
) => {
  if (provider === 'ollama') {
    const response = await fetchWithTimeout(endpoint, { method: 'GET' }, timeoutMs)
    if (!response.ok) return { ok: false as const, message: await parseErrorMessage(response) }
    const payload = (await response.json().catch(() => null)) as { models?: Array<{ name?: string; model?: string }> } | null
    const models = Array.isArray(payload?.models) ? payload.models : []
    const modelId = normalizeText(config.modelId)
    const exists = models.some((model) => model.name === modelId || model.model === modelId)
    if (!exists) {
      const available = models.map((model) => model.name || model.model).filter(Boolean).join(', ')
      return { ok: false as const, message: `Model '${modelId}' not found.${available ? ` Available models: ${available}` : ''}` }
    }
    return { ok: true as const }
  }

  const request =
    provider === 'anthropic'
      ? createAnthropicRequest(config)
      : provider === 'bedrock'
        ? {
            headers: signBedrockRequest(endpoint, config, createBedrockPayload(config)),
            body: createBedrockPayload(config)
          }
        : createOpenAiCompatibleRequest(provider, config)

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: request.headers,
      body: request.body
    },
    timeoutMs
  )
  if (!response.ok) return { ok: false as const, message: await parseErrorMessage(response) }
  await response.text().catch(() => '')
  return { ok: true as const }
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

  const endpoint = endpointFor(provider, config)
  const modelId = normalizeText(config.modelId)
  try {
    const check = await performProviderCheck(provider, config, endpoint, clampTimeoutMs(input.timeoutMs))
    if (!check.ok) return failureResult(provider, label, endpoint, modelId, startedAt, check.message)
    return successResult(provider, label, endpoint, modelId, startedAt)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return failureResult(provider, label, endpoint, modelId, startedAt, `Timed out after ${clampTimeoutMs(input.timeoutMs)}ms.`, 'MODEL_PROVIDER_TIMEOUT')
    }
    return failureResult(provider, label, endpoint, modelId, startedAt, error instanceof Error ? error.message : String(error))
  }
}
