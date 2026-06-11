import type {
  AiopsAssetConnectionTestInfo,
  AiopsAssetExportResult,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewRecord,
  AiopsAssetImportPreviewResult,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsOrganizationAssetRefreshResult,
  AiopsCustomFolderRecord,
  AiopsKeychainRecord,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelRecord
} from '@shared/preload'

export const malformedAssetBackendResultMessage = '资产服务返回数据无效'

const assetTypes = new Set(['person', 'organization', 'switch'])
const assetAuthTypes = new Set(['password', 'keyBased'])
const assetStatuses = new Set(['online', 'offline', 'unknown'])
const assetDataSources = new Set(['manual', 'refresh', 'import'])
const sshTunnelTypes = new Set(['local_forward', 'remote_forward', 'dynamic_socks'])
const sshTunnelStates = new Set(['created', 'active'])
const connectionAuthSources = new Set(['password', 'privateKey', 'keychain', 'sshAgent'])
const keychainTypes = new Set(['rsa', 'ed25519', 'ecdsa'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'

const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'

const isSafeInteger = (value: unknown) => Number.isSafeInteger(value)

const isPort = (value: unknown): value is number => isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 65535

const isNonNegativeInteger = (value: unknown): value is number => isSafeInteger(value) && Number(value) >= 0

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

export const isAiopsAssetRecord = (value: unknown): value is AiopsAssetRecord => {
  if (!isRecord(value)) return false
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.uuid)) return false
  if (!isNonEmptyString(value.name) || !isNonEmptyString(value.title)) return false
  if (!isNonEmptyString(value.host) || !isNonEmptyString(value.ip)) return false
  if (!isNonEmptyString(value.group) || !isNonEmptyString(value.group_name)) return false
  if (!assetStatuses.has(String(value.status))) return false
  if (!isStringArray(value.tags)) return false
  if (!isNonEmptyString(value.username)) return false
  if (!isPort(value.port)) return false
  if (!assetTypes.has(String(value.asset_type))) return false
  if (!assetAuthTypes.has(String(value.auth_type))) return false
  if (typeof value.comment !== 'string') return false
  if (!assetDataSources.has(String(value.data_source))) return false
  if (!isOptionalBoolean(value.favorite)) return false
  if (!isOptionalString(value.folderUuid) || !isOptionalString(value.organizationId)) return false
  if (value.tunnelState !== undefined && !sshTunnelStates.has(String(value.tunnelState))) return false
  if (!isOptionalBoolean(value.needProxy)) return false
  if (!isOptionalString(value.proxyName) || !isOptionalString(value.keychainId)) return false
  if (!isOptionalBoolean(value.hasPassword) || !isOptionalBoolean(value.hasPrivateKey) || !isOptionalBoolean(value.isLocalShell)) return false
  return true
}

export const isAiopsCustomFolderRecord = (value: unknown): value is AiopsCustomFolderRecord => {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.uuid) && isNonEmptyString(value.name) && typeof value.description === 'string'
}

export const isAiopsAssetSnapshot = (value: unknown): value is AiopsAssetSnapshot => {
  if (!isRecord(value)) return false
  return Array.isArray(value.assets) && Array.isArray(value.folders) && value.assets.every(isAiopsAssetRecord) && value.folders.every(isAiopsCustomFolderRecord)
}

export type AiopsOrganizationAssetRefreshData = NonNullable<AiopsOrganizationAssetRefreshResult['data']>

export const findAiopsOrganizationInSnapshot = (snapshot: AiopsAssetSnapshot, organizationId: string): AiopsAssetRecord | null => {
  const requestedId = organizationId.trim()
  if (!requestedId) return null
  return snapshot.assets.find((asset) => asset.asset_type === 'organization' && (asset.id === requestedId || asset.uuid === requestedId)) || null
}

export const isAiopsOrganizationAssetRefreshData = (
  value: unknown,
  expectedOrganizationId?: string
): value is AiopsOrganizationAssetRefreshData => {
  if (!isAiopsAssetSnapshot(value) || !isRecord(value)) return false
  const record = value as Record<string, unknown>
  if (!isNonNegativeInteger(record.refreshed) || !isNonNegativeInteger(record.created) || !isNonNegativeInteger(record.updated)) return false
  if (record.refreshed !== record.created + record.updated) return false

  const requestedId = expectedOrganizationId?.trim()
  if (!requestedId) {
    return record.organizationId === undefined || typeof record.organizationId === 'string'
  }

  const organization = findAiopsOrganizationInSnapshot(value, requestedId)
  if (!organization) return false
  if (
    record.organizationId !== undefined &&
    record.organizationId !== organization.id &&
    record.organizationId !== organization.uuid &&
    record.organizationId !== requestedId
  ) {
    return false
  }
  return true
}

export const isAiopsAssetConnectionTestInfo = (value: unknown): value is AiopsAssetConnectionTestInfo => {
  if (!isRecord(value)) return false
  if (value.assetId !== undefined && !isNonEmptyString(value.assetId)) return false
  return (
    isNonEmptyString(value.endpoint) &&
    isNonEmptyString(value.host) &&
    isPort(value.port) &&
    isNonEmptyString(value.username) &&
    assetAuthTypes.has(String(value.authType)) &&
    connectionAuthSources.has(String(value.authSource)) &&
    isNonNegativeInteger(value.durationMs) &&
    isOptionalString(value.proxyName) &&
    (value.agentKeyCount === undefined || isNonNegativeInteger(value.agentKeyCount))
  )
}

export const isAiopsKeychainRecord = (value: unknown): value is AiopsKeychainRecord => {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    keychainTypes.has(String(value.type)) &&
    typeof value.publicKey === 'string' &&
    isOptionalString(value.privateKey) &&
    isOptionalString(value.passphrase) &&
    typeof value.hasPrivateKey === 'boolean' &&
    isNonNegativeInteger(value.createdAt) &&
    isNonNegativeInteger(value.updatedAt)
  )
}

export const isAiopsKeychainListData = (value: unknown): value is AiopsKeychainRecord[] =>
  Array.isArray(value) && value.every(isAiopsKeychainRecord)

export const isAiopsKeychainDeleteData = (value: unknown, expectedId: string): value is { id: string } => {
  if (!isRecord(value)) return false
  return value.id === expectedId
}

export const isAiopsAssetImportPreviewRecord = (value: unknown): value is AiopsAssetImportPreviewRecord => {
  if (!isRecord(value)) return false
  if (!isNonEmptyString(value.previewId)) return false
  if (value.duplicateId !== undefined && !isNonEmptyString(value.duplicateId)) return false
  if (value.duplicateTitle !== undefined && typeof value.duplicateTitle !== 'string') return false
  return (
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.host) &&
    isNonEmptyString(value.username) &&
    isNonEmptyString(value.group) &&
    isPort(value.port) &&
    assetAuthTypes.has(String(value.auth_type)) &&
    assetTypes.has(String(value.asset_type)) &&
    typeof value.comment === 'string' &&
    isOptionalBoolean(value.needProxy) &&
    isOptionalString(value.proxyName)
  )
}

export type AiopsAssetImportPreviewData = NonNullable<AiopsAssetImportPreviewResult['data']>
export type AiopsAssetImportConfirmData = NonNullable<AiopsAssetImportConfirmResult['data']>
export type AiopsAssetExportData = NonNullable<AiopsAssetExportResult['data']>
export type AiopsSshTunnelMutationData = NonNullable<AiopsSshTunnelMutationResult['data']>

export const isAiopsAssetImportPreviewData = (value: unknown): value is AiopsAssetImportPreviewData => {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.filePath) &&
    isNonEmptyString(value.fileName) &&
    Array.isArray(value.assets) &&
    value.assets.every(isAiopsAssetImportPreviewRecord) &&
    isNonNegativeInteger(value.duplicateCount) &&
    value.duplicateCount <= value.assets.length
  )
}

export const isAiopsAssetImportConfirmData = (value: unknown): value is AiopsAssetImportConfirmData => {
  if (!isAiopsAssetSnapshot(value) || !isRecord(value)) return false
  const record = value as Record<string, unknown>
  return (
    isNonNegativeInteger(record.imported) &&
    isNonNegativeInteger(record.skipped) &&
    isNonNegativeInteger(record.created) &&
    isNonNegativeInteger(record.updated) &&
    isNonEmptyString(record.filePath) &&
    isNonEmptyString(record.fileName)
  )
}

export const isAiopsAssetExportData = (value: unknown): value is AiopsAssetExportData => {
  if (!isRecord(value)) return false
  if (!isNonNegativeInteger(value.exported) || !isNonEmptyString(value.fileName)) return false
  if (!isOptionalString(value.filePath) || !isOptionalBoolean(value.canceled)) return false
  return value.canceled === true || value.exported > 0
}

const isAiopsSshTunnelRecord = (value: unknown): value is AiopsSshTunnelRecord => {
  if (!isRecord(value)) return false
  if (!isNonEmptyString(value.assetId) || !isNonEmptyString(value.tunnelId)) return false
  if (!sshTunnelTypes.has(String(value.type)) || !sshTunnelStates.has(String(value.state))) return false
  if (value.localPort !== undefined && !isPort(value.localPort)) return false
  if (value.remoteHost !== undefined && !isNonEmptyString(value.remoteHost)) return false
  if (value.remotePort !== undefined && !isPort(value.remotePort)) return false
  if (!isOptionalString(value.startedAt) || !isOptionalString(value.stoppedAt)) return false
  return true
}

export const isAiopsSshTunnelMutationData = (value: unknown): value is AiopsSshTunnelMutationData => {
  if (!isAiopsAssetSnapshot(value) || !isRecord(value)) return false
  const record = value as Record<string, unknown>
  return isAiopsSshTunnelRecord(record.tunnel) && isNonEmptyString(record.message)
}
