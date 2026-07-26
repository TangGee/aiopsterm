import type {
  ExtensionInstallProgress,
  ExtensionPluginCancelResult,
  ExtensionPluginListResult,
  ExtensionPluginOperation,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig,
  ExtensionAssetProviderSyncResult,
  ExtensionSubscriptionResult
} from '@shared/contracts/extensions'

export const malformedExtensionBackendResultMessage = '扩展服务返回数据无效'

const extensionIconKeys = new Set(['runbook', 'cloud', 'private', 'local'])
const extensionSources = new Set(['builtin', 'store', 'local', 'development'])
const extensionKinds = new Set(['content', 'provider', 'runtime'])
const extensionOperations = new Set<ExtensionPluginOperation>(['install', 'update', 'uninstall', 'package'])
const extensionInstallStages = new Set(['downloading', 'verifying', 'installing', 'done', 'error', 'cancelled', ''])
const extensionConnectionLogStatuses = new Set(['progress', 'success', 'error'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'

const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

const isNonNegativeFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

const isExtensionFunctionConfig = (value: unknown) => isRecord(value) && isNonEmptyString(value.title) && typeof value.desc === 'string'

const isExtensionConnectionLogConfig = (value: unknown) =>
  isRecord(value) && typeof value.time === 'string' && extensionConnectionLogStatuses.has(String(value.status)) && typeof value.message === 'string'

const isExtensionCommandContribution = (value: unknown) =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.title) &&
  typeof value.description === 'string' &&
  (value.command === undefined || isNonEmptyString(value.command))

const isExtensionProviderField = (value: unknown) =>
  isRecord(value) &&
  isNonEmptyString(value.key) &&
  isNonEmptyString(value.label) &&
  value.type === 'textarea' &&
  typeof value.required === 'boolean' &&
  isOptionalString(value.defaultValue)

const isExtensionAssetProviderContribution = (value: unknown) =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.name) &&
  typeof value.description === 'string' &&
  (value.adapter === 'json-assets' || value.adapter === 'runtime') &&
  Array.isArray(value.fields) &&
  value.fields.every(isExtensionProviderField)

export const isExtensionPluginRuntimeConfig = (value: unknown): value is ExtensionPluginRuntimeConfig => {
  if (!isRecord(value)) return false
  if (!isNonEmptyString(value.pluginId) || !isNonEmptyString(value.name) || !isNonEmptyString(value.description)) return false
  if (!extensionKinds.has(String(value.kind))) return false
  if (!extensionIconKeys.has(String(value.iconKey)) || !isNonEmptyString(value.tabName)) return false
  if (typeof value.show !== 'boolean' || typeof value.isPlugin !== 'boolean') return false
  if (typeof value.installed !== 'boolean' || typeof value.hasUpdate !== 'boolean') return false
  if (!isOptionalString(value.installedVersion) || !isOptionalString(value.latestVersion)) return false
  if (!isOptionalBoolean(value.installable) || !isOptionalBoolean(value.required) || !isOptionalBoolean(value.isDraggedOnly)) return false
  if (!isOptionalBoolean(value.isPrivate)) return false
  if (value.source !== undefined && !extensionSources.has(String(value.source))) return false
  if (!isOptionalString(value.lastUpdated) || !isOptionalString(value.installedAt)) return false
  if (
    !isOptionalString(value.packagePath) ||
    !isOptionalString(value.storePackagePath) ||
    !isOptionalString(value.packageUrl) ||
    !isOptionalString(value.packageSha256) ||
    !isOptionalString(value.subscriptionUrl)
  ) return false
  if (value.size !== undefined && !isNonNegativeFiniteNumber(value.size)) return false
  if (!isOptionalString(value.readme) || !isOptionalString(value.detailSummary)) return false
  if (value.categories !== undefined && !isStringArray(value.categories)) return false
  if (value.guideSteps !== undefined && !isStringArray(value.guideSteps)) return false
  if (value.functions !== undefined && (!Array.isArray(value.functions) || !value.functions.every(isExtensionFunctionConfig))) return false
  if (value.commands !== undefined && (!Array.isArray(value.commands) || !value.commands.every(isExtensionCommandContribution))) return false
  if (value.assetProviders !== undefined && (!Array.isArray(value.assetProviders) || !value.assetProviders.every(isExtensionAssetProviderContribution))) return false
  if (value.connectionLog !== undefined && (!Array.isArray(value.connectionLog) || !value.connectionLog.every(isExtensionConnectionLogConfig))) return false
  return true
}

export type ExtensionPluginOperationData = NonNullable<ExtensionPluginOperationResult['data']>
export type ExtensionSubscriptionData = NonNullable<ExtensionSubscriptionResult['data']>
export type ExtensionPluginCancelData = NonNullable<ExtensionPluginCancelResult['data']>

export const isExtensionPluginListData = (value: unknown): value is NonNullable<ExtensionPluginListResult['data']> =>
  Array.isArray(value) && value.every(isExtensionPluginRuntimeConfig)

export const isExtensionPluginOperationData = (
  value: unknown,
  expectedOperation?: ExtensionPluginOperation
): value is ExtensionPluginOperationData => {
  if (!isRecord(value)) return false
  if (!extensionOperations.has(value.operation as ExtensionPluginOperation)) return false
  if (expectedOperation && value.operation !== expectedOperation) return false
  return isExtensionPluginRuntimeConfig(value.plugin) && isNonEmptyString(value.message)
}

export const isExtensionSubscriptionData = (value: unknown): value is ExtensionSubscriptionData =>
  isRecord(value) && isNonEmptyString(value.pluginId) && isNonEmptyString(value.url) && isNonEmptyString(value.message)

export const isExtensionPluginCancelData = (value: unknown): value is ExtensionPluginCancelData =>
  isRecord(value) && isNonEmptyString(value.pluginId) && value.stage === 'cancelled' && value.percent === 0 && isNonEmptyString(value.message)

export const isExtensionAssetProviderSyncData = (
  value: unknown
): value is NonNullable<ExtensionAssetProviderSyncResult['data']> =>
  isRecord(value) &&
  isNonEmptyString(value.pluginId) &&
  isNonEmptyString(value.providerId) &&
  Number.isInteger(value.imported) &&
  Number(value.imported) >= 0 &&
  Array.isArray(value.assets) &&
  value.assets.length === value.imported

export const isExtensionInstallProgressData = (value: unknown): value is ExtensionInstallProgress => {
  if (!isRecord(value)) return false
  if (!isNonEmptyString(value.pluginId) || !extensionOperations.has(value.operation as ExtensionPluginOperation)) return false
  return (
    extensionInstallStages.has(String(value.stage)) &&
    isNonNegativeFiniteNumber(value.percent) &&
    value.percent <= 100 &&
    isOptionalString(value.message) &&
    isOptionalString(value.requestId)
  )
}
