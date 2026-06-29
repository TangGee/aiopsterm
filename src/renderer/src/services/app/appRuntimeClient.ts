import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'
import type {
  AppUpdateCheckResult,
  AppUpdateDownloadResult,
  AppUpdateInstallResult,
  AppUpdateProgressEvent,
  SettingsDocumentationResult
} from '@shared/contracts/appRuntime'

type AppRuntimeBridge = Pick<
  AiopsPreloadApi,
  | 'getConfig'
  | 'saveConfig'
  | 'getGpuFeatureStatus'
  | 'applyPrivacyRuntimeSettings'
  | 'applyKnowledgeSearchRuntimeSetting'
  | 'checkUpdate'
  | 'downloadAppUpdate'
  | 'installAppUpdate'
  | 'onAppUpdateProgress'
  | 'consumeDeepLinks'
  | 'onDeepLink'
  | 'openLogDir'
  | 'writeRuntimeLog'
  | 'openSettingsDocumentation'
  | 'submitSettingsFeedbackReport'
>

export type AppUpdateDownloadData = NonNullable<AppUpdateDownloadResult['data']>
export type AppUpdateInstallData = NonNullable<AppUpdateInstallResult['data']>

export const appUpdateStatusMessage = '更新后端返回了无效结果'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const bridgeMethod = createBridgeMethod<AppRuntimeBridge>()

export const appRuntimeClient = {
  getConfig: () => bridgeMethod('getConfig'),
  saveConfig: () => bridgeMethod('saveConfig'),
  getGpuFeatureStatus: () => bridgeMethod('getGpuFeatureStatus'),
  applyPrivacyRuntimeSettings: () => bridgeMethod('applyPrivacyRuntimeSettings'),
  applyKnowledgeSearchRuntimeSetting: () => bridgeMethod('applyKnowledgeSearchRuntimeSetting'),
  checkUpdate: () => bridgeMethod('checkUpdate'),
  downloadAppUpdate: () => bridgeMethod('downloadAppUpdate'),
  installAppUpdate: () => bridgeMethod('installAppUpdate'),
  onAppUpdateProgress: () => bridgeMethod('onAppUpdateProgress'),
  consumeDeepLinks: () => bridgeMethod('consumeDeepLinks'),
  onDeepLink: () => bridgeMethod('onDeepLink'),
  openLogDir: () => bridgeMethod('openLogDir'),
  writeRuntimeLog: () => bridgeMethod('writeRuntimeLog'),
  openSettingsDocumentation: () => bridgeMethod('openSettingsDocumentation'),
  submitSettingsFeedbackReport: () => bridgeMethod('submitSettingsFeedbackReport')
}

export const isOpenPathResult = (result: unknown): result is { path: string } => isRecord(result) && typeof result.path === 'string' && Boolean(result.path.trim())

export const isSettingsDocumentationResult = (result: unknown): result is SettingsDocumentationResult => {
  if (!isRecord(result) || typeof result.path !== 'string' || !result.path.trim()) return false
  const title = result.title
  const content = result.content
  return typeof title === 'string' && Boolean(title.trim()) && typeof content === 'string'
}

const appUpdateChannels: AppUpdateCheckResult['channel'][] = ['local', 'manual', 'auto']

const isAppUpdateSignatureInfo = (source: unknown) =>
  isRecord(source) &&
  (source.algorithm === 'ed25519' || source.algorithm === 'rsa-sha256') &&
  source.verified === true &&
  (source.keyId === undefined || typeof source.keyId === 'string')

export const isAppUpdateCheckResult = (source: unknown): source is AppUpdateCheckResult => {
  if (!isRecord(source)) return false
  if (typeof source.available !== 'boolean' || !appUpdateChannels.includes(source.channel as AppUpdateCheckResult['channel'])) return false
  if (source.isUpdateAvailable !== undefined && typeof source.isUpdateAvailable !== 'boolean') return false
  if (source.versionInfo !== undefined) {
    if (!isRecord(source.versionInfo) || !isNonEmptyString(source.versionInfo.version)) return false
    if (source.versionInfo.channel !== undefined && typeof source.versionInfo.channel !== 'string') return false
  }
  if (source.updateInfo !== undefined && source.updateInfo !== null) {
    if (!isRecord(source.updateInfo) || !isNonEmptyString(source.updateInfo.version)) return false
    if (source.updateInfo.channel !== undefined && typeof source.updateInfo.channel !== 'string') return false
    if (source.updateInfo.fileName !== undefined && typeof source.updateInfo.fileName !== 'string') return false
    const updateSize = source.updateInfo.size
    if (updateSize !== undefined && (typeof updateSize !== 'number' || !Number.isFinite(updateSize) || updateSize < 0)) return false
    if (source.updateInfo.sha256 !== undefined && typeof source.updateInfo.sha256 !== 'string') return false
    if (source.updateInfo.notes !== undefined && typeof source.updateInfo.notes !== 'string') return false
    if (source.updateInfo.signature !== undefined && !isAppUpdateSignatureInfo(source.updateInfo.signature)) return false
  }
  return true
}

export const resolveUpdateVersion = (result?: AppUpdateCheckResult | null) => result?.updateInfo?.version || result?.versionInfo?.version || ''

export const hasAvailableAppUpdate = (result: AppUpdateCheckResult) => Boolean(result.available || result.isUpdateAvailable || result.updateInfo)

export const isAppUpdateDownloadData = (source: unknown, version: string): source is AppUpdateDownloadData =>
  isRecord(source) &&
  source.version === version &&
  source.status === 'downloaded' &&
  source.percent === 100 &&
  isNonEmptyString(source.filePath) &&
  typeof source.size === 'number' &&
  Number.isFinite(source.size) &&
  source.size >= 0 &&
  (source.sha256 === undefined || typeof source.sha256 === 'string') &&
  (source.signature === undefined || isAppUpdateSignatureInfo(source.signature)) &&
  isNonEmptyString(source.message)

export const isAppUpdateInstallData = (source: unknown, version: string): source is AppUpdateInstallData =>
  isRecord(source) &&
  source.version === version &&
  source.status === 'install-requested' &&
  isNonEmptyString(source.filePath) &&
  typeof source.size === 'number' &&
  Number.isFinite(source.size) &&
  source.size >= 0 &&
  (source.sha256 === undefined || typeof source.sha256 === 'string') &&
  (source.signature === undefined || isAppUpdateSignatureInfo(source.signature)) &&
  isRecord(source.handoff) &&
  source.handoff.kind === 'os-open' &&
  source.handoff.accepted === true &&
  isNonEmptyString(source.requestedAt) &&
  isNonEmptyString(source.message)

export const isAppUpdateProgressEvent = (source: unknown): source is AppUpdateProgressEvent =>
  isRecord(source) &&
  (source.status === 'downloading' || source.status === 'downloaded' || source.status === 'error') &&
  isNonEmptyString(source.version) &&
  typeof source.percent === 'number' &&
  Number.isFinite(source.percent) &&
  (source.message === undefined || typeof source.message === 'string')
