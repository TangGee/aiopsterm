import type { AiopsMutationResult } from './common'

export type AiopsAssetType = 'person' | 'organization' | 'switch'

export type AiopsAssetAuthType = 'password' | 'keyBased'

export type AiopsSshTunnelType = 'local_forward' | 'remote_forward' | 'dynamic_socks'

export type AiopsSshTunnelState = 'created' | 'active'

export type AiopsSshTunnelStartInput = {
  assetId: string
  type?: AiopsSshTunnelType
  localPort?: number
  remoteHost?: string
  remotePort?: number
  tunnelId?: string
}

export type AiopsSshTunnelStopInput = {
  assetId?: string
  tunnelId?: string
}

export type AiopsSshTunnelRecord = {
  assetId: string
  tunnelId: string
  type: AiopsSshTunnelType
  state: AiopsSshTunnelState
  localPort?: number
  remoteHost?: string
  remotePort?: number
  startedAt?: string
  stoppedAt?: string
}

export type AiopsAssetRecord = {
  id: string
  uuid: string
  name: string
  title: string
  host: string
  ip: string
  group: string
  group_name: string
  status: 'online' | 'offline' | 'unknown'
  tags: string[]
  username: string
  port: number
  asset_type: AiopsAssetType
  auth_type: AiopsAssetAuthType
  comment: string
  data_source: 'manual' | 'refresh' | 'import'
  favorite?: boolean
  folderUuid?: string
  organizationId?: string
  tunnelState?: AiopsSshTunnelState
  needProxy?: boolean
  proxyName?: string
  keychainId?: string
  jumpHostId?: string
  hasPassword?: boolean
  hasPrivateKey?: boolean
  isLocalShell?: boolean
}

export type AiopsAssetGroupRecord = {
  key: string
  name: string
  count: number
}

export type AiopsAssetGroupListInput = {
  assetTypes?: AiopsAssetType[]
}

export type AiopsAssetGroupRenameInput = AiopsAssetGroupListInput & {
  oldName: string
  newName: string
}

export type AiopsAssetGroupDeleteInput = AiopsAssetGroupListInput & {
  name: string
  fallbackName?: string
}

export type AiopsAssetInput = {
  id?: string
  name: string
  title?: string
  host: string
  ip?: string
  group?: string
  group_name?: string
  status?: 'online' | 'offline' | 'unknown'
  username?: string
  port?: number
  asset_type?: AiopsAssetType
  auth_type?: AiopsAssetAuthType
  comment?: string
  data_source?: 'manual' | 'refresh' | 'import'
  tags?: string[]
  favorite?: boolean
  folderUuid?: string
  organizationId?: string
  tunnelState?: AiopsSshTunnelState
  needProxy?: boolean
  proxyName?: string
  keychainId?: string
  jumpHostId?: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export type AiopsAssetConnectionTestInput = {
  assetId?: string
  asset?: AiopsAssetInput
  timeoutMs?: number
}

export type AiopsAssetConnectionTestInfo = {
  assetId?: string
  endpoint: string
  host: string
  port: number
  username: string
  authType: AiopsAssetAuthType
  authSource: 'password' | 'privateKey' | 'keychain' | 'sshAgent'
  durationMs: number
  proxyName?: string
  agentKeyCount?: number
}

export type AiopsAssetConnectionTestResult = AiopsMutationResult<AiopsAssetConnectionTestInfo>

export type AiopsAssetEditableSecret = {
  assetId: string
  password?: string
}

export type AiopsKeychainType = 'rsa' | 'ed25519' | 'ecdsa'

export type AiopsKeychainRecord = {
  id: string
  name: string
  type: AiopsKeychainType
  publicKey: string
  privateKey?: string
  passphrase?: string
  hasPrivateKey: boolean
  createdAt: number
  updatedAt: number
}

export type AiopsKeychainInput = {
  id?: string
  name: string
  type?: AiopsKeychainType
  publicKey?: string
  privateKey?: string
  passphrase?: string
}

export type AiopsCustomFolderRecord = {
  uuid: string
  name: string
  description: string
  parentUuid?: string
  scope?: 'direct' | 'bastion'
}

export type AiopsCustomFolderSaveInput = {
  uuid?: string
  name: string
  description?: string
  parentUuid?: string
  scope?: 'direct' | 'bastion'
}

export type AiopsAssetSnapshot = {
  assets: AiopsAssetRecord[]
  folders: AiopsCustomFolderRecord[]
}

export type AiopsOrganizationAssetRefreshInput = {
  organizationId?: string
}

export type AiopsOrganizationAssetRefreshResult = AiopsMutationResult<
  AiopsAssetSnapshot & {
    organizationId?: string
    refreshed: number
    created: number
    updated: number
  }
>

export type AiopsAssetImportPreviewInput = {
  filePath: string
}

export type AiopsAssetImportConfirmInput = AiopsAssetImportPreviewInput & {
  overwrite?: boolean
}

export type AiopsAssetImportPreviewRecord = {
  previewId: string
  duplicateId?: string
  duplicateTitle?: string
  title: string
  host: string
  username: string
  group: string
  port: number
  auth_type: AiopsAssetAuthType
  asset_type: AiopsAssetType
  comment: string
  needProxy?: boolean
  proxyName?: string
}

export type AiopsAssetImportPreviewResult = AiopsMutationResult<{
  filePath: string
  fileName: string
  assets: AiopsAssetImportPreviewRecord[]
  duplicateCount: number
}>

export type AiopsAssetImportConfirmResult = AiopsMutationResult<
  AiopsAssetSnapshot & {
    imported: number
    skipped: number
    created: number
    updated: number
    filePath: string
    fileName: string
  }
>

export type AiopsAssetExportInput = {
  assetIds: string[]
}

export type AiopsAssetExportPayload = {
  username: string
  password: string
  ip: string
  label: string
  group_name: string
  auth_type: AiopsAssetAuthType
  keyChain?: string
  port: number
  asset_type: AiopsAssetType
  needProxy: boolean
  proxyName: string
  comment?: string
}

export type AiopsAssetExportResult = AiopsMutationResult<{
  exported: number
  fileName: string
  filePath?: string
  bytes?: number
  canceled?: boolean
}>

export type AiopsSshTunnelMutationResult = AiopsMutationResult<
  AiopsAssetSnapshot & {
    tunnel: AiopsSshTunnelRecord
    message: string
  }
>
