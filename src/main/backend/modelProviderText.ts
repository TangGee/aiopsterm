import { createHash, createHmac } from 'crypto'
import type { AiPreferencesUserConfig, ModelProviderCheckKey, ModelProviderUserConfig, UserConfig } from '@shared/preload'

export type AiProviderResolvedConfig = {
  provider: ModelProviderCheckKey
  config: ModelProviderUserConfig
  modelName: string
}

export type AiProviderTextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AiProviderTextRequest = {
  provider: ModelProviderCheckKey
  config: ModelProviderUserConfig
  endpoint: string
  headers: Record<string, string>
  body: string
  parseText: (payload: unknown) => string
}

export type AiProviderTextRequestOptions = {
  preferences?: Pick<AiPreferencesUserConfig, 'reasoningEffort'>
}

export type AiProviderTextFetchResult =
  | { ok: true; text: string }
  | { ok: false; errorCode: string; errorMessage: string }

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const normalizeText = (value: unknown) => String(value || '').trim()
const jsonStringify = (value: unknown) => JSON.stringify(value)
const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value, 'utf8').digest()
const hmacHex = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value, 'utf8').digest('hex')
const toAmzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '')
const toDateStamp = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '')

const providerFromRawValue = (value: unknown): ModelProviderCheckKey | null => {
  const provider = normalizeText(value)
  if (provider === 'openai-compatible' || provider === 'openai') return 'openai'
  if (provider === 'litellm' || provider === 'bedrock' || provider === 'deepseek' || provider === 'anthropic' || provider === 'ollama' || provider === 'lmstudio') {
    return provider
  }
  return null
}

export function resolveModelProvider(config: UserConfig, requestedModel?: string): AiProviderResolvedConfig | null {
  const modelName = normalizeText(requestedModel) || normalizeText(config.modelName)
  if (!modelName || modelName === 'aiopsterm-local-agent') return null
  const modelSettings = config.modelSettings
  if (!modelSettings) return null
  const option = modelSettings.options?.find((item) => item.name === modelName)
  if (option && (option.locked || !option.checked)) return null
  const rawProvider = option?.apiProvider === 'default' ? config.modelProvider : option?.apiProvider || config.modelProvider
  const provider = providerFromRawValue(rawProvider)
  if (!provider) return null
  const providerConfig = modelSettings.providers?.[provider]
  if (!providerConfig) return null
  return {
    provider,
    modelName,
    config: {
      ...providerConfig,
      modelId: normalizeText(providerConfig.modelId) || modelName
    }
  }
}

function appendEndpointPath(baseUrl: string, path: string): string {
  try {
    const parsed = new URL(baseUrl)
    const existing = parsed.pathname.split('/').filter(Boolean)
    const segments = path.split('/').filter(Boolean)
    if (!segments.every((segment, index) => existing[existing.length - segments.length + index] === segment)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/${segments.join('/')}`
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}

function normalizeOpenAiBaseUrl(baseUrl: string): string {
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

function normalizeOpenAiOperationEndpoint(baseUrl: string, path: string): string {
  const normalized = normalizeOpenAiBaseUrl(baseUrl)
  return appendEndpointPath(normalized, path)
}

const normalizeMessages = (messagesOrUserPrompt: string | AiProviderTextMessage[]): AiProviderTextMessage[] => {
  const messages = typeof messagesOrUserPrompt === 'string' ? [{ role: 'user' as const, content: messagesOrUserPrompt }] : messagesOrUserPrompt
  return messages
    .map((message) => ({
      role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: normalizeText(message.content)
    }))
    .filter((message) => message.content)
}

function textFromContentParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .map((part) => {
      if (!isRecord(part)) return ''
      if (part.type === 'text') return normalizeText(part.text)
      if ('text' in part) return normalizeText(part.text)
      return ''
    })
    .join('')
}

function signBedrockRequest(endpoint: string, config: ModelProviderUserConfig, body: string) {
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

export function createProviderTextRequest(
  input: AiProviderResolvedConfig,
  systemPrompt: string,
  messagesOrUserPrompt: string | AiProviderTextMessage[],
  maxTokens: number,
  options: AiProviderTextRequestOptions = {}
): AiProviderTextRequest | null {
  const model = normalizeText(input.config.modelId)
  const apiKey = normalizeText(input.config.apiKey)
  const baseUrl = normalizeText(input.config.baseUrl)
  const messages = normalizeMessages(messagesOrUserPrompt)
  const reasoningEffort = options.preferences?.reasoningEffort
  if (!model || !messages.length) return null

  if (input.provider === 'ollama') {
    const endpoint = appendEndpointPath(baseUrl || 'http://localhost:11434', 'api/chat')
    return {
      provider: input.provider,
      config: input.config,
      endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: jsonStringify({
        model,
        stream: false,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        options: { num_predict: maxTokens }
      }),
      parseText: (payload) => {
        if (!isRecord(payload)) return ''
        return isRecord(payload.message) ? normalizeText(payload.message.content) : normalizeText(payload.response)
      }
    }
  }

  if (input.provider === 'anthropic') {
    if (!apiKey) return null
    const endpoint = appendEndpointPath(baseUrl || 'https://api.anthropic.com', 'v1/messages')
    return {
      provider: input.provider,
      config: input.config,
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: jsonStringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages
      }),
      parseText: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.content)) return ''
        return payload.content.map((part: unknown) => (isRecord(part) && part.type === 'text' ? normalizeText(part.text) : '')).join('')
      }
    }
  }

  if (input.provider === 'bedrock') {
    if (!normalizeText(input.config.awsAccessKey) || !normalizeText(input.config.awsSecretKey)) return null
    const region = normalizeText(input.config.awsRegion) || 'us-east-1'
    const baseEndpoint =
      input.config.awsEndpointSelected && normalizeText(input.config.awsBedrockEndpoint)
        ? normalizeText(input.config.awsBedrockEndpoint)
        : `https://bedrock-runtime.${region}.amazonaws.com`
    const endpoint = appendEndpointPath(baseEndpoint, `model/${encodeURIComponent(model)}/invoke`)
    const body = jsonStringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map((message) => ({
        role: message.role,
        content: [{ type: 'text', text: message.content }]
      }))
    })
    return {
      provider: input.provider,
      config: input.config,
      endpoint,
      headers: signBedrockRequest(endpoint, input.config, body),
      body,
      parseText: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.content)) return ''
        return payload.content.map((part: unknown) => (isRecord(part) && part.type === 'text' ? normalizeText(part.text) : '')).join('')
      }
    }
  }

  if (input.provider === 'lmstudio') {
    const endpoint = normalizeOpenAiOperationEndpoint(baseUrl || 'http://localhost:1234', 'chat/completions')
    return {
      provider: input.provider,
      config: input.config,
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: jsonStringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: maxTokens
      }),
      parseText: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.choices)) return ''
        const first = payload.choices[0]
        if (!isRecord(first)) return ''
        return isRecord(first.message) ? normalizeText(first.message.content) : normalizeText(first.text)
      }
    }
  }

  if (!apiKey) return null

  const endpoint =
    input.provider === 'litellm'
      ? normalizeOpenAiOperationEndpoint(baseUrl || 'http://localhost:4000', 'chat/completions')
      : input.provider === 'deepseek'
        ? normalizeOpenAiOperationEndpoint(baseUrl || 'https://api.deepseek.com', 'chat/completions')
        : input.config.apiFormat === 'responses'
          ? normalizeOpenAiOperationEndpoint(baseUrl || 'https://api.openai.com', 'responses')
          : normalizeOpenAiOperationEndpoint(baseUrl || 'https://api.openai.com', 'chat/completions')

  const useResponses = input.provider === 'openai' && input.config.apiFormat === 'responses'
  return {
    provider: input.provider,
    config: input.config,
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: jsonStringify(
      useResponses
        ? {
            model,
            input: [{ role: 'system', content: systemPrompt }, ...messages],
            max_output_tokens: maxTokens,
            ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {})
          }
        : {
            model,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            max_tokens: maxTokens
          }
    ),
    parseText: (payload) => {
      if (!isRecord(payload)) return ''
      if (Array.isArray(payload.choices)) {
        const first = payload.choices[0]
        if (!isRecord(first)) return ''
        return isRecord(first.message) ? normalizeText(first.message.content) : normalizeText(first.text)
      }
      if (typeof payload.output_text === 'string') return payload.output_text
      if (Array.isArray(payload.output)) {
        return payload.output
          .flatMap((item: unknown) => {
            if (!isRecord(item)) return []
            if (Array.isArray(item.content)) return item.content
            return []
          })
          .map((part: unknown) => (isRecord(part) ? normalizeText(part.text) || textFromContentParts(part.content) : ''))
          .join('')
      }
      return ''
    }
  }
}

const parseResponsePayload = (body: string): unknown => {
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

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

export async function fetchProviderText(
  request: AiProviderTextRequest,
  options: { fetch?: typeof fetch; timeoutMs?: number; errorCodePrefix?: string; signal?: AbortSignal; maxRetries?: number } = {}
): Promise<AiProviderTextFetchResult> {
  const fetchImpl = options.fetch || fetch
  const timeoutMs = Math.max(500, Math.min(120_000, Math.round(options.timeoutMs || 30_000)))
  const errorCodePrefix = normalizeText(options.errorCodePrefix) || 'AI_PROVIDER'
  const maxRetries = Math.max(0, Math.min(5, Math.round(options.maxRetries || 0)))
  const maxAttempts = maxRetries + 1
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    let abortedByTimeout = false
    const abortFromCaller = () => controller.abort()
    if (options.signal?.aborted) {
      return {
        ok: false,
        errorCode: `${errorCodePrefix}_CANCELLED`,
        errorMessage: 'Provider request was cancelled'
      }
    }
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      abortedByTimeout = true
      controller.abort()
    }, timeoutMs)
    try {
      const response = await fetchImpl(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
      const body =
        typeof response.text === 'function'
          ? await response.text().catch(() => '')
          : typeof response.json === 'function'
            ? jsonStringify(await response.json().catch(() => null))
            : ''
      if (!response.ok) {
        return {
          ok: false,
          errorCode: `${errorCodePrefix}_ERROR`,
          errorMessage: parseProviderError(body, `Provider returned HTTP ${response.status || 'error'}`)
        }
      }
      const payload = parseResponsePayload(body)
      const text = typeof payload === 'string' ? normalizeText(payload) : normalizeText(request.parseText(payload))
      if (!text) {
        return {
          ok: false,
          errorCode: `${errorCodePrefix}_EMPTY`,
          errorMessage: 'Provider returned an empty response'
        }
      }
      return { ok: true, text }
    } catch (error) {
      const wasCancelled = error instanceof Error && error.name === 'AbortError' && options.signal?.aborted && !abortedByTimeout
      const wasTimeout = error instanceof Error && error.name === 'AbortError' && !wasCancelled
      if (wasTimeout && attempt <= maxRetries) continue
      return {
        ok: false,
        errorCode: wasCancelled ? `${errorCodePrefix}_CANCELLED` : wasTimeout ? `${errorCodePrefix}_TIMEOUT` : `${errorCodePrefix}_ERROR`,
        errorMessage:
          wasCancelled
            ? 'Provider request was cancelled'
            : wasTimeout
              ? `Provider request timed out after ${timeoutMs}ms`
              : error instanceof Error
                ? error.message
                : String(error)
      }
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller)
      clearTimeout(timeout)
    }
  }
  return {
    ok: false,
    errorCode: `${errorCodePrefix}_TIMEOUT`,
    errorMessage: `Provider request timed out after ${timeoutMs}ms`
  }
}
