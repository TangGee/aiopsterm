import type {
  AiPreferencesUserConfig,
  KnowledgeSearchRuntimeSnapshot,
  ModelOptionUserConfig,
  ModelSettingsUserConfig
} from '@shared/contracts/appRuntime'
import { isLegacyLocalModelName } from '@shared/modelConfigBoundary'
import {
  defaultAiPreferencesConfig,
  defaultModelSettingsConfig,
  modelApiFormats,
  modelOptionTypes,
  proxyTypeValues,
  reasoningEffortValues,
  type AiPreferenceSettings,
  type KnowledgeSearchRuntimeApplyData,
  type ModelProviderKey,
  type ModelProviderSettings,
  type SettingsModelOption
} from './workspaceConfigDefaults'
import { isRecord, numberInRange, stringFromOptions } from './workspaceConfigPrimitives'

export const normalizeModelSettingsOptions = (source: unknown, fallback: ModelOptionUserConfig[] = []) => {
  const rawOptions = Array.isArray(source) ? source : fallback
  const seenNames = new Set<string>()
  const options: ModelOptionUserConfig[] = []
  let changed = !Array.isArray(source)
  rawOptions.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || isLegacyLocalModelName(name) || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : ''
    const locked = Boolean(item.locked)
    const type = stringFromOptions(item.type, modelOptionTypes, locked ? 'standard' : 'custom')
    const option: ModelOptionUserConfig = {
      name,
      displayName: displayName && displayName !== name ? displayName : undefined,
      locked,
      checked: item.checked !== undefined ? Boolean(item.checked) : true,
      type,
      apiProvider: typeof item.apiProvider === 'string' && item.apiProvider.trim() ? item.apiProvider.trim() : 'default'
    }
    options.push(option)
    const allowedKeys = new Set(['name', 'displayName', 'locked', 'checked', 'type', 'apiProvider'])
    if (
      item.name !== option.name ||
      item.displayName !== option.displayName ||
      item.locked !== option.locked ||
      item.checked !== option.checked ||
      item.type !== option.type ||
      item.apiProvider !== option.apiProvider ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized: options,
    changed
  }
}

export const isVisibleModelSettingsOption = (model: ModelOptionUserConfig | SettingsModelOption) => model.name !== 'aiopsterm-local-agent'

export const isAiPreferencesSnapshot = (source: unknown): source is AiPreferencesUserConfig => {
  if (!isRecord(source) || !isRecord(source.proxy)) return false
  return (
    typeof source.enableExtendedThinking === 'boolean' &&
    typeof source.thinkingBudgetTokens === 'number' &&
    Number.isFinite(source.thinkingBudgetTokens) &&
    typeof source.autoExecuteReadOnlyCommands === 'boolean' &&
    typeof source.commandOutputFilteringEnabled === 'boolean' &&
    typeof source.kbSearchEnabled === 'boolean' &&
    typeof source.experienceExtractionEnabled === 'boolean' &&
    typeof source.managedAiAutoNamingEnabled === 'boolean' &&
    typeof source.autoApproval === 'boolean' &&
    reasoningEffortValues.includes(source.reasoningEffort as AiPreferenceSettings['reasoningEffort']) &&
    typeof source.needProxy === 'boolean' &&
    proxyTypeValues.includes(source.proxy.type as AiPreferenceSettings['proxy']['type']) &&
    typeof source.proxy.host === 'string' &&
    typeof source.proxy.port === 'number' &&
    Number.isFinite(source.proxy.port) &&
    typeof source.proxy.enableProxyIdentity === 'boolean' &&
    typeof source.proxy.username === 'string' &&
    typeof source.proxy.password === 'string' &&
    typeof source.shellIntegrationTimeout === 'number' &&
    Number.isFinite(source.shellIntegrationTimeout)
  )
}

export const isKnowledgeSearchRuntimeSnapshotForRequest = (source: unknown, expectedEnabled: boolean): source is KnowledgeSearchRuntimeApplyData =>
  isRecord(source) &&
  source.enabled === expectedEnabled &&
  source.source === 'settings' &&
  typeof source.appliedAt === 'string' &&
  source.appliedAt.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const normalizeThinkingBudget = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value === 0) return 0
  return Math.min(6553, Math.max(1024, Math.round(value)))
}

export const normalizeAiPreferencesConfig = (source?: Partial<AiPreferencesUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProxy: Record<string, unknown> = isRecord(incoming.proxy) ? incoming.proxy : {}
  const normalized: AiPreferenceSettings = {
    enableExtendedThinking: typeof incoming.enableExtendedThinking === 'boolean' ? incoming.enableExtendedThinking : defaultAiPreferencesConfig.enableExtendedThinking,
    thinkingBudgetTokens: normalizeThinkingBudget(incoming.thinkingBudgetTokens, defaultAiPreferencesConfig.thinkingBudgetTokens),
    autoExecuteReadOnlyCommands:
      typeof incoming.autoExecuteReadOnlyCommands === 'boolean' ? incoming.autoExecuteReadOnlyCommands : defaultAiPreferencesConfig.autoExecuteReadOnlyCommands,
    commandOutputFilteringEnabled:
      typeof incoming.commandOutputFilteringEnabled === 'boolean' ? incoming.commandOutputFilteringEnabled : defaultAiPreferencesConfig.commandOutputFilteringEnabled,
    kbSearchEnabled: typeof incoming.kbSearchEnabled === 'boolean' ? incoming.kbSearchEnabled : defaultAiPreferencesConfig.kbSearchEnabled,
    experienceExtractionEnabled:
      typeof incoming.experienceExtractionEnabled === 'boolean' ? incoming.experienceExtractionEnabled : defaultAiPreferencesConfig.experienceExtractionEnabled,
    managedAiAutoNamingEnabled:
      typeof incoming.managedAiAutoNamingEnabled === 'boolean'
        ? incoming.managedAiAutoNamingEnabled
        : defaultAiPreferencesConfig.managedAiAutoNamingEnabled,
    autoApproval: typeof incoming.autoApproval === 'boolean' ? incoming.autoApproval : defaultAiPreferencesConfig.autoApproval,
    reasoningEffort: stringFromOptions(incoming.reasoningEffort, reasoningEffortValues, defaultAiPreferencesConfig.reasoningEffort),
    needProxy: typeof incoming.needProxy === 'boolean' ? incoming.needProxy : defaultAiPreferencesConfig.needProxy,
    proxy: {
      type: stringFromOptions(incomingProxy.type, proxyTypeValues, defaultAiPreferencesConfig.proxy.type),
      host: typeof incomingProxy.host === 'string' ? incomingProxy.host : defaultAiPreferencesConfig.proxy.host,
      port: numberInRange(incomingProxy.port, defaultAiPreferencesConfig.proxy.port, 1, 65535),
      enableProxyIdentity:
        typeof incomingProxy.enableProxyIdentity === 'boolean' ? incomingProxy.enableProxyIdentity : defaultAiPreferencesConfig.proxy.enableProxyIdentity,
      username: typeof incomingProxy.username === 'string' ? incomingProxy.username : defaultAiPreferencesConfig.proxy.username,
      password: typeof incomingProxy.password === 'string' ? incomingProxy.password : defaultAiPreferencesConfig.proxy.password
    },
    shellIntegrationTimeout: numberInRange(incoming.shellIntegrationTimeout, defaultAiPreferencesConfig.shellIntegrationTimeout, 1, 300)
  }

  if (!normalized.enableExtendedThinking) {
    normalized.thinkingBudgetTokens = 0
  } else if (normalized.thinkingBudgetTokens === 0) {
    normalized.thinkingBudgetTokens = 1024
  }

  const comparable = {
    ...incoming,
    proxy: incomingProxy
  }
  const changed = !isRecord(source) || JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

export const normalizeModelProviderConfig = (source: unknown, fallback: ModelProviderSettings): ModelProviderSettings => {
  const incoming = isRecord(source) ? source : {}
  return {
    baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl.trim() : fallback.baseUrl,
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : fallback.apiKey,
    modelId: typeof incoming.modelId === 'string' && incoming.modelId.trim() ? incoming.modelId.trim() : fallback.modelId,
    ...(fallback.apiFormat || incoming.apiFormat
      ? {
          apiFormat: stringFromOptions(incoming.apiFormat, modelApiFormats, fallback.apiFormat || 'chat-completions')
        }
      : {}),
    ...(fallback.awsAccessKey !== undefined || incoming.awsAccessKey !== undefined
      ? {
          awsAccessKey: typeof incoming.awsAccessKey === 'string' ? incoming.awsAccessKey : fallback.awsAccessKey || ''
        }
      : {}),
    ...(fallback.awsSecretKey !== undefined || incoming.awsSecretKey !== undefined
      ? {
          awsSecretKey: typeof incoming.awsSecretKey === 'string' ? incoming.awsSecretKey : fallback.awsSecretKey || ''
        }
      : {}),
    ...(fallback.awsSessionToken !== undefined || incoming.awsSessionToken !== undefined
      ? {
          awsSessionToken: typeof incoming.awsSessionToken === 'string' ? incoming.awsSessionToken : fallback.awsSessionToken || ''
        }
      : {}),
    ...(fallback.awsRegion !== undefined || incoming.awsRegion !== undefined
      ? {
          awsRegion: typeof incoming.awsRegion === 'string' && incoming.awsRegion.trim() ? incoming.awsRegion.trim() : fallback.awsRegion || 'us-east-1'
        }
      : {}),
    ...(fallback.awsUseCrossRegionInference !== undefined || incoming.awsUseCrossRegionInference !== undefined
      ? {
          awsUseCrossRegionInference:
            typeof incoming.awsUseCrossRegionInference === 'boolean'
              ? incoming.awsUseCrossRegionInference
              : Boolean(fallback.awsUseCrossRegionInference)
        }
      : {}),
    ...(fallback.awsEndpointSelected !== undefined || incoming.awsEndpointSelected !== undefined
      ? {
          awsEndpointSelected: typeof incoming.awsEndpointSelected === 'boolean' ? incoming.awsEndpointSelected : Boolean(fallback.awsEndpointSelected)
        }
      : {}),
    ...(fallback.awsBedrockEndpoint !== undefined || incoming.awsBedrockEndpoint !== undefined
      ? {
          awsBedrockEndpoint: typeof incoming.awsBedrockEndpoint === 'string' ? incoming.awsBedrockEndpoint.trim() : fallback.awsBedrockEndpoint || ''
        }
      : {})
  }
}

export const normalizeModelSettingsConfig = (source?: unknown, fallbackOptions: ModelOptionUserConfig[] = defaultModelSettingsConfig.options) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProviders = isRecord(incoming.providers) ? incoming.providers : {}
  const providers: ModelSettingsUserConfig['providers'] = {
    litellm: normalizeModelProviderConfig(incomingProviders.litellm, defaultModelSettingsConfig.providers.litellm),
    openai: normalizeModelProviderConfig(incomingProviders.openai, defaultModelSettingsConfig.providers.openai),
    bedrock: normalizeModelProviderConfig(incomingProviders.bedrock, defaultModelSettingsConfig.providers.bedrock),
    deepseek: normalizeModelProviderConfig(incomingProviders.deepseek, defaultModelSettingsConfig.providers.deepseek),
    anthropic: normalizeModelProviderConfig(incomingProviders.anthropic, defaultModelSettingsConfig.providers.anthropic),
    ollama: normalizeModelProviderConfig(incomingProviders.ollama, defaultModelSettingsConfig.providers.ollama),
    lmstudio: normalizeModelProviderConfig(incomingProviders.lmstudio, defaultModelSettingsConfig.providers.lmstudio)
  }

  const { normalized: options, changed: optionsChanged } = normalizeModelSettingsOptions(incoming.options, fallbackOptions)
  let changed = !isRecord(source) || !isRecord(incoming.providers) || optionsChanged

  const normalized: ModelSettingsUserConfig = {
    addModelSwitch: typeof incoming.addModelSwitch === 'boolean' ? incoming.addModelSwitch : defaultModelSettingsConfig.addModelSwitch,
    providers,
    options
  }
  if (incoming.addModelSwitch !== normalized.addModelSwitch || JSON.stringify(incomingProviders) !== JSON.stringify(providers)) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

const modelProviderSettingsMatch = (left: ModelProviderSettings, right: ModelProviderSettings) => JSON.stringify(left) === JSON.stringify(right)

export const modelOptionsSnapshotsMatch = (left: ModelOptionUserConfig[], right: ModelOptionUserConfig[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index]
    return (
      Boolean(other) &&
      item.name === other.name &&
      item.displayName === other.displayName &&
      item.locked === other.locked &&
      item.checked === other.checked &&
      item.type === other.type &&
      item.apiProvider === other.apiProvider
    )
  })

export const modelSettingsSnapshotsMatch = (left: ModelSettingsUserConfig, right: ModelSettingsUserConfig) =>
  left.addModelSwitch === right.addModelSwitch &&
  modelProviderSettingsMatch(left.providers.litellm, right.providers.litellm) &&
  modelProviderSettingsMatch(left.providers.openai, right.providers.openai) &&
  modelProviderSettingsMatch(left.providers.bedrock, right.providers.bedrock) &&
  modelProviderSettingsMatch(left.providers.deepseek, right.providers.deepseek) &&
  modelProviderSettingsMatch(left.providers.anthropic, right.providers.anthropic) &&
  modelProviderSettingsMatch(left.providers.ollama, right.providers.ollama) &&
  modelProviderSettingsMatch(left.providers.lmstudio, right.providers.lmstudio) &&
  modelOptionsSnapshotsMatch(left.options, right.options)

export const modelOptionProviderForSavedProvider = (provider: ModelProviderKey): string => (provider === 'openai' ? 'openai' : provider)
