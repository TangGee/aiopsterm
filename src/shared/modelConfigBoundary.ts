import type { UserConfig } from './contracts/userConfig'

export type ModelConfigDefaults = Pick<UserConfig, 'modelProvider' | 'modelName'>

const modelProviders = new Set<UserConfig['modelProvider']>([
  'local',
  'litellm',
  'openai-compatible',
  'ollama',
  'lmstudio',
  'bedrock',
  'deepseek',
  'anthropic'
])

const legacyLocalModelProviders = new Set(['mock'])
const legacyLocalModelNames = new Set(['mock-ops-agent', 'ops-local-agent'])

export const isLegacyLocalModelProvider = (value: unknown) => legacyLocalModelProviders.has(String(value || '').trim())

export const isLegacyLocalModelName = (value: unknown) => legacyLocalModelNames.has(String(value || '').trim())

export const normalizeConfigModelProvider = (value: unknown, defaults: ModelConfigDefaults): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'local' || isLegacyLocalModelProvider(provider)) return 'local'
  if (modelProviders.has(provider as UserConfig['modelProvider'])) return provider as UserConfig['modelProvider']
  return defaults.modelProvider
}

export const normalizeConfigModelName = (value: unknown, defaults: ModelConfigDefaults) => {
  const modelName = String(value || '').trim()
  if (!modelName || isLegacyLocalModelName(modelName)) return defaults.modelName
  return modelName
}
