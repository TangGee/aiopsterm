import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'
import type {
  AiModelCatalog,
  AiModelCatalogInput,
  AiModelCatalogOption,
  ModelOptionUserConfig,
  ModelProviderCheckResult,
  ModelProviderCheckKey,
  ModelProviderUserConfig
} from '@shared/contracts/appRuntime'
import { isLegacyLocalModelName, isLegacyLocalModelProvider } from '@shared/modelConfigBoundary'

type ModelProviderBridge = Pick<AiopsPreloadApi, 'checkModelProvider' | 'listAiModels'>

export type ModelProviderCheckData = NonNullable<ModelProviderCheckResult['data']>

export const malformedModelProviderResultMessage = '模型 Provider 检查服务返回数据无效'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const defaultAiModelCatalog: AiModelCatalog = {
  chatModels: [],
  lockedChatModels: [],
  settingsModels: []
}

const modelOptionTypes: NonNullable<ModelOptionUserConfig['type']>[] = ['standard', 'custom']

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) =>
  typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback

const bridgeMethod = createBridgeMethod<ModelProviderBridge>()

export const modelProviderClient = {
  checkModelProvider: () => bridgeMethod('checkModelProvider'),
  listAiModels: () => bridgeMethod('listAiModels')
}

const normalizeModelSettingsOptions = (source: unknown, fallback: ModelOptionUserConfig[] = []) => {
  const rawOptions = Array.isArray(source) ? source : fallback
  const seenNames = new Set<string>()
  const options: ModelOptionUserConfig[] = []
  rawOptions.forEach((item) => {
    if (!isRecord(item)) return
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || isLegacyLocalModelName(name) || seenNames.has(name)) return
    seenNames.add(name)
    const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : ''
    const locked = Boolean(item.locked)
    options.push({
      name,
      displayName: displayName && displayName !== name ? displayName : undefined,
      locked,
      checked: item.checked !== undefined ? Boolean(item.checked) : true,
      type: stringFromOptions(item.type, modelOptionTypes, locked ? 'standard' : 'custom'),
      apiProvider: typeof item.apiProvider === 'string' && item.apiProvider.trim() ? item.apiProvider.trim() : 'default'
    })
  })
  return options
}

const normalizeAiModelOption = (source: unknown): AiModelCatalogOption | null => {
  if (!isRecord(source)) return null
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const displayName = typeof source.displayName === 'string' ? source.displayName.trim() : ''
  const label = typeof source.label === 'string' && source.label.trim() ? source.label.trim() : displayName || id
  if (!id || !label || isLegacyLocalModelName(id)) return null
  if (typeof source.apiProvider === 'string' && isLegacyLocalModelProvider(source.apiProvider)) return null
  const locked = Boolean(source.locked)
  return {
    id,
    label,
    detail: typeof source.detail === 'string' ? source.detail.trim() : '',
    displayName: displayName && displayName !== id ? displayName : undefined,
    checked: source.checked !== undefined ? Boolean(source.checked) : true,
    locked,
    tier: typeof source.tier === 'string' ? source.tier.trim() : undefined,
    type: stringFromOptions(source.type, modelOptionTypes, locked ? 'standard' : 'standard'),
    apiProvider: typeof source.apiProvider === 'string' && source.apiProvider.trim() ? source.apiProvider.trim() : 'default'
  }
}

export const normalizeAiModelCatalog = (source?: Partial<AiModelCatalog> | null): AiModelCatalog => {
  const incoming = isRecord(source) ? source : {}
  const chatModels = (Array.isArray(incoming.chatModels) ? incoming.chatModels : defaultAiModelCatalog.chatModels)
    .map(normalizeAiModelOption)
    .filter((model): model is AiModelCatalogOption => Boolean(model))
  const lockedChatModels = (Array.isArray(incoming.lockedChatModels) ? incoming.lockedChatModels : defaultAiModelCatalog.lockedChatModels)
    .map(normalizeAiModelOption)
    .filter((model): model is AiModelCatalogOption => Boolean(model))
    .map((model) => ({ ...model, locked: true }))
  const settingsModels = normalizeModelSettingsOptions(
    Array.isArray(incoming.settingsModels) ? incoming.settingsModels : defaultAiModelCatalog.settingsModels,
    defaultAiModelCatalog.settingsModels
  )
  return { chatModels, lockedChatModels, settingsModels }
}

export const listAiModelCatalog = async (input: AiModelCatalogInput) => {
  const listAiModels = modelProviderClient.listAiModels()
  return listAiModels ? normalizeAiModelCatalog(await listAiModels(input)) : null
}

export const isModelProviderCheckDataForRequest = (
  source: unknown,
  provider: ModelProviderCheckKey,
  expectedConfig: ModelProviderUserConfig
): source is ModelProviderCheckData => {
  if (
    !isRecord(source) ||
    source.provider !== provider ||
    typeof source.label !== 'string' ||
    source.label.trim() === '' ||
    typeof source.modelId !== 'string' ||
    source.modelId.trim() !== expectedConfig.modelId.trim() ||
    typeof source.endpoint !== 'string' ||
    source.endpoint.trim() === '' ||
    typeof source.message !== 'string' ||
    source.message.trim() === '' ||
    typeof source.durationMs !== 'number' ||
    !Number.isFinite(source.durationMs) ||
    source.durationMs < 0
  ) {
    return false
  }
  if (source.suggestion === undefined) return true
  if (!isRecord(source.suggestion)) return false
  const apiFormat = source.suggestion.apiFormat
  const apiPathMode = source.suggestion.apiPathMode
  return (
    typeof source.suggestion.baseUrl === 'string' &&
    source.suggestion.baseUrl.trim() !== '' &&
    typeof source.suggestion.endpoint === 'string' &&
    source.suggestion.endpoint.trim() !== '' &&
    Array.isArray(source.suggestion.reasons) &&
    source.suggestion.reasons.every((reason) => typeof reason === 'string' && reason.trim() !== '') &&
    (apiFormat === undefined || apiFormat === 'chat-completions' || apiFormat === 'responses') &&
    (apiPathMode === undefined || apiPathMode === 'auto' || apiPathMode === 'v1' || apiPathMode === 'none')
  )
}
