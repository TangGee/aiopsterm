import type {
  AiopsAssetConnectionTestInfo,
  AiopsAssetExportResult,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupRecord,
  AiopsAssetGroupRenameInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewRecord,
  AiopsAssetImportPreviewResult,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsOrganizationAssetRefreshResult,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
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

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const hasOwn = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key)

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

export const isAiopsAssetGroupRecord = (value: unknown): value is AiopsAssetGroupRecord => {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.key) && isNonEmptyString(value.name) && isNonNegativeInteger(value.count)
}

export const isAiopsAssetGroupListData = (value: unknown): value is AiopsAssetGroupRecord[] =>
  Array.isArray(value) && value.every(isAiopsAssetGroupRecord)

const optionalTextMatches = (actual: unknown, expected: unknown) => {
  if (expected === undefined) return true
  return text(actual) === text(expected)
}

const optionalExactMatches = (actual: unknown, expected: unknown) => expected === undefined || actual === expected

const optionalPortMatches = (actual: unknown, expected: unknown) => expected === undefined || Number(actual) === Number(expected)

const optionalBooleanMatches = (actual: unknown, expected: unknown) => expected === undefined || Boolean(actual) === Boolean(expected)

const optionalPresentStringMatches = (actual: unknown, input: object, key: keyof AiopsAssetInput) =>
  !hasOwn(input, key) || (input as AiopsAssetInput)[key] === undefined
    ? !hasOwn(input, key) || actual === undefined || text(actual) === ''
    : text(actual) === text((input as AiopsAssetInput)[key])

export const isAiopsSavedAssetRecord = (value: unknown, input: AiopsAssetInput): value is AiopsAssetRecord => {
  if (!isAiopsAssetRecord(value)) return false
  const expectedId = text(input.id)
  if (expectedId && value.id !== expectedId) return false
  const expectedName = text(input.name)
  if (expectedName && value.name !== expectedName) return false
  const expectedTitle = text(input.title || input.name)
  if (expectedTitle && value.title !== expectedTitle) return false
  if (!optionalTextMatches(value.host, input.host)) return false
  if (!optionalTextMatches(value.ip, input.ip || input.host)) return false
  if (!optionalTextMatches(value.group, input.group || input.group_name)) return false
  if (!optionalTextMatches(value.group_name, input.group_name || input.group)) return false
  if (!optionalTextMatches(value.username, input.username)) return false
  if (!optionalPortMatches(value.port, input.port)) return false
  if (!optionalExactMatches(value.status, input.status)) return false
  if (!optionalExactMatches(value.asset_type, input.asset_type)) return false
  if (!optionalExactMatches(value.auth_type, input.auth_type)) return false
  if (!optionalTextMatches(value.comment, input.comment)) return false
  if (!optionalExactMatches(value.data_source, input.data_source)) return false
  if (!optionalBooleanMatches(value.favorite, input.favorite)) return false
  if (!optionalPresentStringMatches(value.folderUuid, input, 'folderUuid')) return false
  if (!optionalPresentStringMatches(value.organizationId, input, 'organizationId')) return false
  if (!optionalExactMatches(value.tunnelState, input.tunnelState)) return false
  if (!optionalBooleanMatches(value.needProxy, input.needProxy)) return false
  if (!optionalPresentStringMatches(value.proxyName, input, 'proxyName')) return false
  if (!optionalPresentStringMatches(value.keychainId, input, 'keychainId')) return false
  return true
}

export const isAiopsDeletedAssetData = (value: unknown, expectedId: string): value is { id: string } => {
  if (!isRecord(value)) return false
  return value.id === expectedId
}

export const isAiopsSavedCustomFolderRecord = (
  value: unknown,
  input: AiopsCustomFolderSaveInput
): value is AiopsCustomFolderRecord => {
  if (!isAiopsCustomFolderRecord(value)) return false
  if (input.uuid && value.uuid !== input.uuid) return false
  if (value.name !== text(input.name)) return false
  if (hasOwn(input, 'description') && value.description !== text(input.description)) return false
  return true
}

export const isAiopsDeletedCustomFolderData = (value: unknown, expectedUuid: string): value is { uuid: string } => {
  if (!isRecord(value)) return false
  return value.uuid === expectedUuid
}

const shouldIncludeAssetForGroupMutation = (
  asset: AiopsAssetRecord,
  input: Pick<AiopsAssetGroupRenameInput | AiopsAssetGroupDeleteInput, 'assetTypes'>
) => !asset.isLocalShell && (!input.assetTypes?.length || input.assetTypes.includes(asset.asset_type))

const assetGroupName = (asset: AiopsAssetRecord) => text(asset.group || asset.group_name) || 'Hosts'

export const isAiopsAssetGroupRenameSnapshot = (value: unknown, input: AiopsAssetGroupRenameInput): value is AiopsAssetSnapshot => {
  if (!isAiopsAssetSnapshot(value)) return false
  const oldName = text(input.oldName)
  const newName = text(input.newName)
  if (!oldName || !newName) return false
  const groupAssets = value.assets.filter((asset) => shouldIncludeAssetForGroupMutation(asset, input))
  if (oldName === newName) return groupAssets.some((asset) => assetGroupName(asset) === newName)
  return groupAssets.some((asset) => assetGroupName(asset) === newName) && !groupAssets.some((asset) => assetGroupName(asset) === oldName)
}

export const isAiopsAssetGroupDeleteSnapshot = (value: unknown, input: AiopsAssetGroupDeleteInput): value is AiopsAssetSnapshot => {
  if (!isAiopsAssetSnapshot(value)) return false
  const name = text(input.name)
  if (!name) return false
  const groupAssets = value.assets.filter((asset) => shouldIncludeAssetForGroupMutation(asset, input))
  return !groupAssets.some((asset) => assetGroupName(asset) === name)
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
  if (value.type === 'dynamic_socks' && (value.remoteHost !== undefined || value.remotePort !== undefined)) return false
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
