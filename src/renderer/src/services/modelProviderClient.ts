import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type { ModelProviderCheckResult, ModelProviderCheckKey, ModelProviderUserConfig } from '@shared/contracts/appRuntime'

type ModelProviderBridge = Pick<AiopsPreloadApi, 'checkModelProvider'>

export type ModelProviderCheckData = NonNullable<ModelProviderCheckResult['data']>

export const malformedModelProviderResultMessage = '模型 Provider 检查服务返回数据无效'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const bridgeMethod = <Name extends keyof ModelProviderBridge>(name: Name): ModelProviderBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as ModelProviderBridge[Name]) : undefined
}

export const modelProviderClient = {
  checkModelProvider: () => bridgeMethod('checkModelProvider')
}

export const isModelProviderCheckDataForRequest = (
  source: unknown,
  provider: ModelProviderCheckKey,
  expectedConfig: ModelProviderUserConfig
): source is ModelProviderCheckData =>
  isRecord(source) &&
  source.provider === provider &&
  typeof source.label === 'string' &&
  source.label.trim() !== '' &&
  typeof source.modelId === 'string' &&
  source.modelId.trim() === expectedConfig.modelId.trim() &&
  typeof source.endpoint === 'string' &&
  source.endpoint.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== '' &&
  typeof source.durationMs === 'number' &&
  Number.isFinite(source.durationMs) &&
  source.durationMs >= 0
