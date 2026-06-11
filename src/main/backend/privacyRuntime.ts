import type { PrivacyRuntimeApplyInput, PrivacyRuntimeApplyResult, PrivacyRuntimeSnapshot, PrivacyUserConfig } from '@shared/preload'

type PrivacyRuntimeConfig = {
  dataSyncBackendUrl?: string
  useDataSyncBackendDouble?: boolean
}

const privacyStatusValues = new Set(['enabled', 'disabled'])

let runtimeConfig: PrivacyRuntimeConfig = {
  dataSyncBackendUrl: String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_URL || '').trim(),
  useDataSyncBackendDouble: String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE || '').trim() === '1'
}

let runtimeSnapshot: PrivacyRuntimeSnapshot = {
  telemetry: 'enabled',
  dataSync: 'disabled',
  dataSyncRuntime: 'disabled',
  appliedAt: new Date(0).toISOString(),
  message: 'Privacy runtime has not been changed in this process.'
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isPrivacyStatus = (value: unknown): value is PrivacyUserConfig['telemetry'] => typeof value === 'string' && privacyStatusValues.has(value)

const isPrivacyConfig = (value: unknown): value is PrivacyUserConfig =>
  isRecord(value) && isPrivacyStatus(value.telemetry) && isPrivacyStatus(value.secretRedaction) && isPrivacyStatus(value.dataSync)

const cloneSnapshot = (): PrivacyRuntimeSnapshot => ({ ...runtimeSnapshot })

const errorResult = (errorCode: string, errorMessage: string): PrivacyRuntimeApplyResult => ({
  ok: false,
  errorCode,
  errorMessage
})

const successResult = (message: string, dataSyncRuntime: PrivacyRuntimeSnapshot['dataSyncRuntime']): PrivacyRuntimeApplyResult => {
  runtimeSnapshot = {
    ...runtimeSnapshot,
    dataSyncRuntime,
    appliedAt: new Date().toISOString(),
    message
  }
  return {
    ok: true,
    data: cloneSnapshot()
  }
}

const hasConfiguredDataSyncService = () => {
  if (runtimeConfig.useDataSyncBackendDouble) return true
  return false
}

const resolveDataSyncRuntime = (): PrivacyRuntimeSnapshot['dataSyncRuntime'] => {
  if (runtimeConfig.useDataSyncBackendDouble) return 'backend-double'
  return 'disabled'
}

export const configurePrivacyRuntime = (config: PrivacyRuntimeConfig = {}) => {
  runtimeConfig = {
    dataSyncBackendUrl:
      config.dataSyncBackendUrl !== undefined ? String(config.dataSyncBackendUrl || '').trim() : String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_URL || '').trim(),
    useDataSyncBackendDouble:
      config.useDataSyncBackendDouble !== undefined
        ? Boolean(config.useDataSyncBackendDouble)
        : String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE || '').trim() === '1'
  }
}

export const resetPrivacyRuntimeForTests = () => {
  runtimeSnapshot = {
    telemetry: 'enabled',
    dataSync: 'disabled',
    dataSyncRuntime: 'disabled',
    appliedAt: new Date(0).toISOString(),
    message: 'Privacy runtime has not been changed in this process.'
  }
}

export const getPrivacyRuntimeSnapshot = () => cloneSnapshot()

export const applyPrivacyRuntimeSettings = (input: PrivacyRuntimeApplyInput): PrivacyRuntimeApplyResult => {
  if (!isRecord(input)) {
    return errorResult('PRIVACY_RUNTIME_INPUT_INVALID', 'Privacy runtime input is invalid.')
  }
  const { previousPrivacy, nextPrivacy } = input
  if (!isPrivacyConfig(previousPrivacy) || !isPrivacyConfig(nextPrivacy)) {
    return errorResult('PRIVACY_RUNTIME_PRIVACY_INVALID', 'Privacy runtime settings are invalid.')
  }

  if (previousPrivacy.dataSync !== nextPrivacy.dataSync && nextPrivacy.dataSync === 'enabled' && !hasConfiguredDataSyncService()) {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      telemetry: previousPrivacy.telemetry,
      dataSync: previousPrivacy.dataSync,
      dataSyncRuntime: previousPrivacy.dataSync === 'enabled' ? resolveDataSyncRuntime() : 'disabled',
      appliedAt: new Date().toISOString(),
      message: 'Data sync enable failed because no backend service is configured.'
    }
    return errorResult('DATA_SYNC_UNAVAILABLE', '数据同步服务未配置，无法启用')
  }

  runtimeSnapshot = {
    ...runtimeSnapshot,
    telemetry: nextPrivacy.telemetry
  }

  if (previousPrivacy.dataSync !== nextPrivacy.dataSync) {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      dataSync: nextPrivacy.dataSync
    }
  }

  const runtime = nextPrivacy.dataSync === 'enabled' ? resolveDataSyncRuntime() : 'disabled'
  return successResult(nextPrivacy.dataSync === 'enabled' ? '隐私运行时设置已应用，数据同步已启用' : '隐私运行时设置已应用', runtime)
}
