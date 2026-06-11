import type { PrivacyRuntimeApplyInput, PrivacyRuntimeApplyResult, PrivacyRuntimeSnapshot, PrivacyUserConfig } from '@shared/preload'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'

type PrivacyRuntimeConfig = {
  dataSyncBackendUrl?: string
  dataSyncStateFilePath?: string
  useDataSyncBackendDouble?: boolean
}

type DataSyncRuntimeState = {
  version: 1
  enabled: boolean
  runtime: PrivacyRuntimeSnapshot['dataSyncRuntime']
  telemetry: PrivacyUserConfig['telemetry']
  dataSync: PrivacyUserConfig['dataSync']
  updatedAt: string
  lastSyncAt: string
}

const privacyStatusValues = new Set(['enabled', 'disabled'])

const defaultDataSyncStateFilePath = () => {
  const envPath = String(process.env.AIOPSTERM_DATA_SYNC_STATE_FILE || '').trim()
  return envPath ? (isAbsolute(envPath) ? envPath : resolve(envPath)) : resolve(process.cwd(), '.aiopsterm-data-sync-runtime.json')
}

let runtimeConfig: PrivacyRuntimeConfig = {
  dataSyncBackendUrl: String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_URL || '').trim(),
  dataSyncStateFilePath: defaultDataSyncStateFilePath(),
  useDataSyncBackendDouble: String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE || '').trim() === '1'
}

let runtimeSnapshot: PrivacyRuntimeSnapshot = {
  telemetry: 'enabled',
  dataSync: 'disabled',
  dataSyncRuntime: 'disabled',
  appliedAt: new Date(0).toISOString(),
  message: 'Privacy runtime has not been changed in this process.'
}
let runtimeStateLoaded = false
let runtimeLoadedStateFilePath = ''

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
  if (runtimeConfig.dataSyncBackendUrl) return true
  return Boolean(runtimeConfig.dataSyncStateFilePath)
}

const resolveDataSyncRuntime = (): PrivacyRuntimeSnapshot['dataSyncRuntime'] => {
  if (runtimeConfig.useDataSyncBackendDouble) return 'backend-double'
  if (runtimeConfig.dataSyncBackendUrl) return 'service'
  return 'local-file'
}

const dataSyncStateFilePath = () => runtimeConfig.dataSyncStateFilePath || defaultDataSyncStateFilePath()

const normalizeRuntimeState = (value: unknown): DataSyncRuntimeState | null => {
  if (!isRecord(value)) return null
  const telemetry = isPrivacyStatus(value.telemetry) ? value.telemetry : 'enabled'
  const dataSync = isPrivacyStatus(value.dataSync) ? value.dataSync : 'disabled'
  const runtime =
    value.runtime === 'backend-double' || value.runtime === 'service' || value.runtime === 'local-file'
      ? value.runtime
      : dataSync === 'enabled'
        ? resolveDataSyncRuntime()
        : 'disabled'
  return {
    version: 1,
    enabled: Boolean(value.enabled) && dataSync === 'enabled',
    runtime: dataSync === 'enabled' ? runtime : 'disabled',
    telemetry,
    dataSync,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt : new Date(0).toISOString(),
    lastSyncAt: typeof value.lastSyncAt === 'string' && value.lastSyncAt.trim() ? value.lastSyncAt : ''
  }
}

const applyRuntimeStateSnapshot = (state: DataSyncRuntimeState, message = 'Privacy runtime restored from local data sync state.') => {
  runtimeSnapshot = {
    telemetry: state.telemetry,
    dataSync: state.dataSync,
    dataSyncRuntime: state.dataSync === 'enabled' ? state.runtime : 'disabled',
    appliedAt: state.updatedAt,
    stateFilePath: dataSyncStateFilePath(),
    lastSyncAt: state.lastSyncAt,
    message
  }
}

const ensureRuntimeStateLoaded = () => {
  const stateFilePath = dataSyncStateFilePath()
  if (runtimeStateLoaded && runtimeLoadedStateFilePath === stateFilePath) return
  runtimeStateLoaded = true
  runtimeLoadedStateFilePath = stateFilePath
  if (!existsSync(stateFilePath)) {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      stateFilePath,
      dataSyncRuntime: runtimeSnapshot.dataSync === 'enabled' ? resolveDataSyncRuntime() : 'disabled'
    }
    return
  }
  try {
    const state = normalizeRuntimeState(JSON.parse(readFileSync(stateFilePath, 'utf-8')) as unknown)
    if (state) applyRuntimeStateSnapshot(state)
  } catch {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      stateFilePath,
      dataSyncRuntime: 'disabled',
      message: 'Privacy runtime state file is corrupt; keeping current in-process defaults.'
    }
  }
}

const persistRuntimeState = (nextPrivacy: PrivacyUserConfig, dataSyncRuntime: PrivacyRuntimeSnapshot['dataSyncRuntime']) => {
  const now = new Date().toISOString()
  const stateFilePath = dataSyncStateFilePath()
  const state: DataSyncRuntimeState = {
    version: 1,
    enabled: nextPrivacy.dataSync === 'enabled',
    runtime: nextPrivacy.dataSync === 'enabled' ? dataSyncRuntime : 'disabled',
    telemetry: nextPrivacy.telemetry,
    dataSync: nextPrivacy.dataSync,
    updatedAt: now,
    lastSyncAt: nextPrivacy.dataSync === 'enabled' ? now : runtimeSnapshot.lastSyncAt || ''
  }
  mkdirSync(dirname(stateFilePath), { recursive: true })
  const tempPath = `${stateFilePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tempPath, stateFilePath)
  applyRuntimeStateSnapshot(state, nextPrivacy.dataSync === 'enabled' ? '隐私运行时设置已应用，数据同步已启用' : '隐私运行时设置已应用')
}

export const configurePrivacyRuntime = (config: PrivacyRuntimeConfig = {}) => {
  runtimeConfig = {
    dataSyncBackendUrl:
      config.dataSyncBackendUrl !== undefined ? String(config.dataSyncBackendUrl || '').trim() : String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_URL || '').trim(),
    dataSyncStateFilePath:
      config.dataSyncStateFilePath !== undefined
        ? isAbsolute(String(config.dataSyncStateFilePath || '').trim())
          ? String(config.dataSyncStateFilePath || '').trim()
          : resolve(String(config.dataSyncStateFilePath || '').trim() || defaultDataSyncStateFilePath())
        : defaultDataSyncStateFilePath(),
    useDataSyncBackendDouble:
      config.useDataSyncBackendDouble !== undefined
        ? Boolean(config.useDataSyncBackendDouble)
        : String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE || '').trim() === '1'
  }
  runtimeStateLoaded = false
  runtimeLoadedStateFilePath = ''
}

export const resetPrivacyRuntimeForTests = () => {
  runtimeSnapshot = {
    telemetry: 'enabled',
    dataSync: 'disabled',
    dataSyncRuntime: 'disabled',
    appliedAt: new Date(0).toISOString(),
    stateFilePath: dataSyncStateFilePath(),
    lastSyncAt: '',
    message: 'Privacy runtime has not been changed in this process.'
  }
  runtimeStateLoaded = true
  runtimeLoadedStateFilePath = dataSyncStateFilePath()
}

export const getPrivacyRuntimeSnapshot = () => {
  ensureRuntimeStateLoaded()
  return cloneSnapshot()
}

export const applyPrivacyRuntimeSettings = (input: PrivacyRuntimeApplyInput): PrivacyRuntimeApplyResult => {
  ensureRuntimeStateLoaded()
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
      stateFilePath: dataSyncStateFilePath(),
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
  try {
    persistRuntimeState(nextPrivacy, runtime)
  } catch (error) {
    return errorResult('DATA_SYNC_STATE_WRITE_FAILED', error instanceof Error ? error.message : '数据同步状态写入失败')
  }
  return {
    ok: true,
    data: cloneSnapshot()
  }
}
