import type { ClineAgentProviderConfig } from '@shared/contracts/clineAgent'
import type { UserConfig } from '@shared/contracts/userConfig'
import { resolveModelProvider } from '../ai/modelProviderText'

const cleanText = (value: unknown) => String(value || '').trim()

const normalizeOpenAiBaseUrl = (rawValue: string) => {
  const raw = cleanText(rawValue)
  if (!raw) return ''
  const skipVersionPrefix = raw.endsWith('#')
  const value = skipVersionPrefix ? raw.slice(0, -1) : raw
  try {
    const parsed = new URL(value)
    if (!skipVersionPrefix && !parsed.pathname.split('/').filter(Boolean).some((segment) => /^v\d+$/i.test(segment))) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1`
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return value
  }
}

export const resolveClineAgentProvider = (
  config: UserConfig,
  requestedModel?: string
): ClineAgentProviderConfig | null => {
  const resolved = resolveModelProvider(config, requestedModel)
  if (!resolved) return null
  const providerConfig = resolved.config
  const common = {
    modelId: cleanText(providerConfig.modelId) || resolved.modelName,
    ...(cleanText(providerConfig.apiKey) ? { apiKey: cleanText(providerConfig.apiKey) } : {}),
    ...(cleanText(providerConfig.baseUrl) ? { baseUrl: cleanText(providerConfig.baseUrl) } : {}),
    ...(config.aiPreferences?.enableExtendedThinking ? { thinking: true } : {}),
    ...(config.aiPreferences?.reasoningEffort ? { reasoningEffort: config.aiPreferences.reasoningEffort } : {}),
    ...(config.aiPreferences?.thinkingBudgetTokens
      ? { thinkingBudgetTokens: Math.max(1024, Math.round(config.aiPreferences.thinkingBudgetTokens)) }
      : {}),
    ...(config.aiPreferences?.needProxy === true ? { useHostProxy: true } : {})
  }

  if (resolved.provider === 'openai') {
    const responses = providerConfig.apiFormat === 'responses'
    const providerId = responses ? 'openai-native' : 'openai-compatible'
    const baseUrl = normalizeOpenAiBaseUrl(providerConfig.baseUrl)
    const knownModels: NonNullable<ClineAgentProviderConfig['knownModels']> = {
      [common.modelId]: {
        id: common.modelId,
        name: common.modelId,
        capabilities: ['streaming', 'tools'],
        status: 'active'
      }
    }
    return {
      ...common,
      providerId,
      ...(baseUrl ? { baseUrl } : {}),
      knownModels,
      providerConfig: {
        providerId,
        clientType: responses ? 'openai' : 'openai-compatible',
        modelId: common.modelId,
        apiKey: common.apiKey,
        baseUrl,
        knownModels,
        capabilities: ['streaming', 'tools']
      }
    }
  }
  if (resolved.provider === 'litellm') return { providerId: 'litellm', ...common }
  if (resolved.provider === 'anthropic') return { providerId: 'anthropic', ...common }
  if (resolved.provider === 'deepseek') return { providerId: 'deepseek', ...common }
  if (resolved.provider === 'ollama') return { providerId: 'ollama', ...common }
  if (resolved.provider === 'lmstudio') return { providerId: 'lmstudio', ...common }
  if (resolved.provider !== 'bedrock') return null

  const accessKey = cleanText(providerConfig.awsAccessKey)
  const secretKey = cleanText(providerConfig.awsSecretKey)
  const sessionToken = cleanText(providerConfig.awsSessionToken)
  const region = cleanText(providerConfig.awsRegion) || 'us-east-1'
  const endpoint = providerConfig.awsEndpointSelected ? cleanText(providerConfig.awsBedrockEndpoint) : ''
  return {
    providerId: 'bedrock',
    ...common,
    providerConfig: {
      providerId: 'bedrock',
      modelId: common.modelId,
      region,
      aws: {
        authentication: 'iam',
        accessKey,
        secretKey,
        ...(sessionToken ? { sessionToken } : {}),
        ...(endpoint ? { endpoint } : {})
      },
      useCrossRegionInference: providerConfig.awsUseCrossRegionInference === true
    }
  }
}
