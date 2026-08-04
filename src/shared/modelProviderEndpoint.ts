import type { ModelProviderCheckKey, ModelProviderUserConfig } from './contracts/appRuntime'

export type ModelProviderEndpointResolution = {
  baseUrl: string
  endpoint: string
  operationPath: string
  valid: boolean
  errorMessage: string
}

export type ModelProviderEndpointSuggestion = {
  originalBaseUrl: string
  suggestedBaseUrl: string
  apiPathMode: NonNullable<ModelProviderUserConfig['apiPathMode']>
  apiFormat?: ModelProviderUserConfig['apiFormat']
  reasons: string[]
  endpoint: string
}

const defaultEndpoints: Record<ModelProviderCheckKey, string> = {
  litellm: 'http://localhost:4000',
  openai: 'https://api.openai.com',
  bedrock: '',
  deepseek: 'https://api.deepseek.com',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234'
}

const openAiCompatibleProviders = new Set<ModelProviderCheckKey>(['litellm', 'openai', 'deepseek', 'lmstudio'])

const operationPathFor = (provider: ModelProviderCheckKey, config: ModelProviderUserConfig) => {
  if (provider === 'openai') return config.apiFormat === 'responses' ? 'responses' : 'chat/completions'
  if (provider === 'litellm' || provider === 'deepseek' || provider === 'lmstudio') return 'chat/completions'
  if (provider === 'anthropic') return 'v1/messages'
  if (provider === 'ollama') return 'api/tags'
  return ''
}

const removeTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const appendModelProviderPath = (baseUrl: string, path: string) => {
  if (!path) return removeTrailingSlash(baseUrl)
  try {
    const parsed = new URL(baseUrl)
    const existing = parsed.pathname.split('/').filter(Boolean)
    const segments = path.split('/').filter(Boolean)
    const matches = segments.length > 0 && segments.every((segment, index) => existing[existing.length - segments.length + index]?.toLowerCase() === segment.toLowerCase())
    if (!matches) parsed.pathname = `${removeTrailingSlash(parsed.pathname)}/${segments.join('/')}`
    parsed.search = ''
    parsed.hash = ''
    return removeTrailingSlash(parsed.toString())
  } catch {
    return baseUrl
  }
}

const stripKnownOperationPath = (parsed: URL) => {
  const segments = parsed.pathname.split('/').filter(Boolean)
  const lower = segments.map((segment) => segment.toLowerCase())
  if (lower[lower.length - 1] === 'responses') {
    parsed.pathname = `/${segments.slice(0, -1).join('/')}`
    return true
  }
  if (lower[lower.length - 2] === 'chat' && lower[lower.length - 1] === 'completions') {
    parsed.pathname = `/${segments.slice(0, -2).join('/')}`
    return true
  }
  return false
}

const protocolForHost = (value: string) => (/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value) ? 'http://' : 'https://')

const parseHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  } catch {
    return null
  }
}

export const isValidModelProviderUrl = (value: string) => Boolean(parseHttpUrl(value.trim()))

export const suggestModelProviderEndpoint = (
  provider: ModelProviderCheckKey,
  config: ModelProviderUserConfig
): ModelProviderEndpointSuggestion | null => {
  if (provider === 'bedrock' || config.endpointMode === 'exact') return null
  const originalBaseUrl = String(config.baseUrl || '').trim()
  if (!originalBaseUrl) return null
  const reasons: string[] = []
  let candidate = originalBaseUrl
  let apiPathMode: NonNullable<ModelProviderUserConfig['apiPathMode']> = config.apiPathMode || 'auto'

  if (candidate.endsWith('#')) {
    candidate = candidate.slice(0, -1)
    apiPathMode = 'none'
    reasons.push('legacy-hash')
  }
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    candidate = `${protocolForHost(candidate)}${candidate}`
    reasons.push('protocol')
  }

  const parsed = parseHttpUrl(candidate)
  if (!parsed) return null
  if (stripKnownOperationPath(parsed)) reasons.push('operation-path')
  parsed.search = ''
  parsed.hash = ''
  const hadTrailingSlash = parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
  parsed.pathname = removeTrailingSlash(parsed.pathname) || '/'
  if (hadTrailingSlash) reasons.push('trailing-slash')

  if (openAiCompatibleProviders.has(provider) && apiPathMode !== 'none') {
    const hasVersion = parsed.pathname.split('/').filter(Boolean).some((segment) => /^v\d+$/i.test(segment))
    if (!hasVersion) {
      parsed.pathname = `${removeTrailingSlash(parsed.pathname)}/v1`
      reasons.push('v1')
    }
  }

  const suggestedBaseUrl = removeTrailingSlash(parsed.toString())
  const normalizedOriginal = removeTrailingSlash(originalBaseUrl)
  if (suggestedBaseUrl === normalizedOriginal && apiPathMode === (config.apiPathMode || 'auto')) return null
  const suggestedConfig = { ...config, baseUrl: suggestedBaseUrl, apiPathMode }
  return {
    originalBaseUrl,
    suggestedBaseUrl,
    apiPathMode,
    apiFormat: config.apiFormat,
    reasons,
    endpoint: resolveModelProviderEndpoint(provider, suggestedConfig).endpoint
  }
}

export const resolveModelProviderEndpoint = (
  provider: ModelProviderCheckKey,
  config: ModelProviderUserConfig,
  operationPathOverride?: string
): ModelProviderEndpointResolution => {
  const operationPath = operationPathOverride === undefined ? operationPathFor(provider, config) : operationPathOverride
  const rawBaseUrl = String(config.baseUrl || '').trim() || defaultEndpoints[provider]
  if (!rawBaseUrl) {
    return { baseUrl: '', endpoint: '', operationPath, valid: false, errorMessage: 'Endpoint is required.' }
  }
  if (config.endpointMode === 'exact') {
    const valid = isValidModelProviderUrl(rawBaseUrl)
    return {
      baseUrl: rawBaseUrl,
      endpoint: rawBaseUrl,
      operationPath,
      valid,
      errorMessage: valid ? '' : 'Endpoint must be a valid HTTP or HTTPS URL.'
    }
  }

  const legacySkipVersion = rawBaseUrl.endsWith('#')
  const inputBaseUrl = legacySkipVersion ? rawBaseUrl.slice(0, -1) : rawBaseUrl
  const parsed = parseHttpUrl(inputBaseUrl)
  if (!parsed) {
    return {
      baseUrl: inputBaseUrl,
      endpoint: inputBaseUrl,
      operationPath,
      valid: false,
      errorMessage: 'Endpoint must be a valid HTTP or HTTPS URL.'
    }
  }

  stripKnownOperationPath(parsed)
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = removeTrailingSlash(parsed.pathname) || '/'
  const pathMode = legacySkipVersion ? 'none' : config.apiPathMode || 'auto'
  if (openAiCompatibleProviders.has(provider) && pathMode !== 'none') {
    const hasVersion = parsed.pathname.split('/').filter(Boolean).some((segment) => /^v\d+$/i.test(segment))
    if (!hasVersion) parsed.pathname = `${removeTrailingSlash(parsed.pathname)}/v1`
  }
  const baseUrl = removeTrailingSlash(parsed.toString())
  return {
    baseUrl,
    endpoint: appendModelProviderPath(baseUrl, operationPath),
    operationPath,
    valid: true,
    errorMessage: ''
  }
}

export const resolveEquivalentClientBaseUrl = (
  provider: ModelProviderCheckKey,
  config: ModelProviderUserConfig
): string | null => {
  const resolution = resolveModelProviderEndpoint(provider, config)
  if (!resolution.valid) return null
  if (config.endpointMode !== 'exact') return resolution.baseUrl
  const parsed = parseHttpUrl(resolution.endpoint)
  if (!parsed) return null
  const operationPath = operationPathFor(provider, config)
  if (!operationPath) return resolution.endpoint
  const segments = parsed.pathname.split('/').filter(Boolean)
  const operationSegments = operationPath.split('/').filter(Boolean)
  const matches = operationSegments.every(
    (segment, index) => segments[segments.length - operationSegments.length + index]?.toLowerCase() === segment.toLowerCase()
  )
  if (!matches) return null
  parsed.pathname = `/${segments.slice(0, -operationSegments.length).join('/')}`
  return removeTrailingSlash(parsed.toString())
}
