import type { PrivacyRuntimeApplyInput, PrivacyRuntimeApplyResult, PrivacyRuntimeSnapshot, PrivacyUserConfig } from '@shared/contracts/appRuntime'
import { shouldUseDataSyncBackendDouble } from '@shared/runtimeSwitches'
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
  syncStatus: NonNullable<PrivacyRuntimeSnapshot['syncStatus']>
  syncRunId: string
  syncedScopes: NonNullable<PrivacyRuntimeSnapshot['syncedScopes']>
  telemetry: PrivacyUserConfig['telemetry']
  telemetryConsentVersion: 0 | 1
  dataSync: PrivacyUserConfig['dataSync']
  updatedAt: string
  lastSyncAt: string
  errorMessage: string
}

const privacyStatusValues = new Set(['enabled', 'disabled'])
const telemetryStatusValues = new Set(['undecided', 'enabled', 'disabled'])

const defaultDataSyncStateFilePath = () => {
  const envPath = String(process.env.AIOPSTERM_DATA_SYNC_STATE_FILE || '').trim()
  return envPath ? (isAbsolute(envPath) ? envPath : resolve(envPath)) : resolve(process.cwd(), '.aiopsterm-data-sync-runtime.json')
}

let runtimeConfig: PrivacyRuntimeConfig = {
  dataSyncBackendUrl: String(process.env.AIOPSTERM_DATA_SYNC_BACKEND_URL || '').trim(),
  dataSyncStateFilePath: defaultDataSyncStateFilePath(),
  useDataSyncBackendDouble: shouldUseDataSyncBackendDouble()
}

let runtimeSnapshot: PrivacyRuntimeSnapshot = {
  telemetry: 'enabled',
  dataSync: 'disabled',
  dataSyncRuntime: 'disabled',
  syncStatus: 'disabled',
  syncRunId: '',
  syncedScopes: [],
  appliedAt: new Date(0).toISOString(),
  lastSyncAt: '',
  message: 'Privacy runtime has not been changed in this process.'
}
let runtimeStateLoaded = false
let runtimeLoadedStateFilePath = ''

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isPrivacyStatus = (value: unknown): value is 'enabled' | 'disabled' => typeof value === 'string' && privacyStatusValues.has(value)

const isTelemetryStatus = (value: unknown): value is PrivacyUserConfig['telemetry'] => typeof value === 'string' && telemetryStatusValues.has(value)

const isPrivacyConfig = (value: unknown): value is PrivacyUserConfig =>
  isRecord(value) &&
  isTelemetryStatus(value.telemetry) &&
  (value.telemetryConsentVersion === undefined || value.telemetryConsentVersion === 0 || value.telemetryConsentVersion === 1) &&
  isPrivacyStatus(value.secretRedaction) &&
  isPrivacyStatus(value.dataSync)

const cloneSnapshot = (): PrivacyRuntimeSnapshot => ({
  ...runtimeSnapshot,
  syncedScopes: runtimeSnapshot.syncedScopes ? [...runtimeSnapshot.syncedScopes] : []
})

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

const syncStatusFromState = (value: unknown, dataSync: PrivacyUserConfig['dataSync']): NonNullable<PrivacyRuntimeSnapshot['syncStatus']> => {
  if (dataSync === 'disabled') return 'disabled'
  return value === 'idle' || value === 'syncing' || value === 'synced' || value === 'error' ? value : 'idle'
}

const syncedScopesFromState = (value: unknown): NonNullable<PrivacyRuntimeSnapshot['syncedScopes']> => {
  const allowed = new Set(['config', 'knowledge', 'chat', 'assets', 'skills'])
  if (!Array.isArray(value)) return ['config']
  const scopes = value.filter((scope): scope is NonNullable<PrivacyRuntimeSnapshot['syncedScopes']>[number] => typeof scope === 'string' && allowed.has(scope))
  return scopes.length ? [...new Set(scopes)] : ['config']
}

const createSyncRunId = () => `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const normalizeRuntimeState = (value: unknown): DataSyncRuntimeState | null => {
  if (!isRecord(value)) return null
  const telemetry = value.telemetry === 'disabled' ? 'disabled' : 'enabled'
  const dataSync = isPrivacyStatus(value.dataSync) ? value.dataSync : 'disabled'
  const runtime =
    value.runtime === 'backend-double' || value.runtime === 'service' || value.runtime === 'local-file'
      ? value.runtime
      : dataSync === 'enabled'
        ? resolveDataSyncRuntime()
        : 'disabled'
  const syncStatus = syncStatusFromState(value.syncStatus || value.status, dataSync)
  return {
    version: 1,
    enabled: Boolean(value.enabled) && dataSync === 'enabled',
    runtime: dataSync === 'enabled' ? runtime : 'disabled',
    syncStatus,
    syncRunId: dataSync === 'enabled' && typeof value.syncRunId === 'string' ? value.syncRunId.trim() : '',
    syncedScopes: dataSync === 'enabled' ? syncedScopesFromState(value.syncedScopes) : [],
    telemetry,
    telemetryConsentVersion: 1,
    dataSync,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.trim() ? value.updatedAt : new Date(0).toISOString(),
    lastSyncAt: dataSync === 'enabled' && typeof value.lastSyncAt === 'string' && value.lastSyncAt.trim() ? value.lastSyncAt : '',
    errorMessage: syncStatus === 'error' && typeof value.errorMessage === 'string' ? value.errorMessage.trim() : ''
  }
}

const applyRuntimeStateSnapshot = (state: DataSyncRuntimeState, message = 'Privacy runtime restored from local data sync state.') => {
  runtimeSnapshot = {
    telemetry: state.telemetry,
    dataSync: state.dataSync,
    dataSyncRuntime: state.dataSync === 'enabled' ? state.runtime : 'disabled',
    syncStatus: state.dataSync === 'enabled' ? state.syncStatus : 'disabled',
    syncRunId: state.dataSync === 'enabled' ? state.syncRunId : '',
    syncedScopes: state.dataSync === 'enabled' ? [...state.syncedScopes] : [],
    appliedAt: state.updatedAt,
    stateFilePath: dataSyncStateFilePath(),
    lastSyncAt: state.lastSyncAt,
    ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
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
      dataSyncRuntime: runtimeSnapshot.dataSync === 'enabled' ? resolveDataSyncRuntime() : 'disabled',
      syncStatus: runtimeSnapshot.dataSync === 'enabled' ? runtimeSnapshot.syncStatus || 'idle' : 'disabled',
      syncRunId: runtimeSnapshot.dataSync === 'enabled' ? runtimeSnapshot.syncRunId || '' : '',
      syncedScopes: runtimeSnapshot.dataSync === 'enabled' ? runtimeSnapshot.syncedScopes || ['config'] : []
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
      syncStatus: 'error',
      syncRunId: '',
      syncedScopes: [],
      message: 'Privacy runtime state file is corrupt; keeping current in-process defaults.'
    }
  }
}

const persistRuntimeState = (nextPrivacy: PrivacyUserConfig, dataSyncRuntime: PrivacyRuntimeSnapshot['dataSyncRuntime']) => {
  const now = new Date().toISOString()
  const stateFilePath = dataSyncStateFilePath()
  const enabled = nextPrivacy.dataSync === 'enabled'
  const state: DataSyncRuntimeState = {
    version: 1,
    enabled,
    runtime: enabled ? dataSyncRuntime : 'disabled',
    syncStatus: enabled ? 'synced' : 'disabled',
    syncRunId: enabled ? runtimeSnapshot.syncRunId || createSyncRunId() : '',
    syncedScopes: enabled ? ['config'] : [],
    telemetry: nextPrivacy.telemetry,
    telemetryConsentVersion: nextPrivacy.telemetryConsentVersion === 1 ? 1 : 0,
    dataSync: nextPrivacy.dataSync,
    updatedAt: now,
    lastSyncAt: enabled ? now : runtimeSnapshot.lastSyncAt || '',
    errorMessage: ''
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
        : shouldUseDataSyncBackendDouble()
  }
  runtimeStateLoaded = false
  runtimeLoadedStateFilePath = ''
}

export const resetPrivacyRuntimeForTests = () => {
  runtimeSnapshot = {
    telemetry: 'enabled',
    dataSync: 'disabled',
    dataSyncRuntime: 'disabled',
    syncStatus: 'disabled',
    syncRunId: '',
    syncedScopes: [],
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
      syncStatus: previousPrivacy.dataSync === 'enabled' ? 'error' : 'disabled',
      syncRunId: runtimeSnapshot.syncRunId || '',
      syncedScopes: previousPrivacy.dataSync === 'enabled' ? runtimeSnapshot.syncedScopes || ['config'] : [],
      appliedAt: new Date().toISOString(),
      stateFilePath: dataSyncStateFilePath(),
      errorMessage: 'Data sync enable failed because no backend service is configured.',
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
