import type { UserConfig } from '@shared/preload'

export type ModelConfigDefaults = Pick<UserConfig, 'modelProvider' | 'modelName'>

const modelProviders = new Set<UserConfig['modelProvider']>([
  'local',
  'litellm',
  'openai-compatible',
  'ollama',
  'bedrock',
  'deepseek',
  'anthropic'
])

const legacyLocalModelNames = new Set(['mock-ops-agent', 'ops-local-agent'])

export const normalizeConfigModelProvider = (value: unknown, defaults: ModelConfigDefaults): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'mock' || provider === 'local') return 'local'
  if (modelProviders.has(provider as UserConfig['modelProvider'])) return provider as UserConfig['modelProvider']
  return defaults.modelProvider
}

export const normalizeConfigModelName = (value: unknown, defaults: ModelConfigDefaults) => {
  const modelName = String(value || '').trim()
  if (!modelName || legacyLocalModelNames.has(modelName)) return defaults.modelName
  return modelName
}
