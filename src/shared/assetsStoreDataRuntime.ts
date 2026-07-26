import { createHash, randomUUID } from 'crypto'
import type {
  AiopsAssetGroupListInput,
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType
} from '@shared/contracts/assets'
import type { SshAgentKeychainOption } from '@shared/contracts/appRuntime'

export type AssetSecret = {
  password?: string
  privateKey?: string
  passphrase?: string
  jumpserverToken?: string
}

export type AssetStoreShape = {
  assets: AiopsAssetRecord[]
  folders: AiopsCustomFolderRecord[]
  secrets: Record<string, AssetSecret>
  keychains: AiopsKeychainRecord[]
  keychainSecrets: Record<string, AssetSecret>
}

export const LOCAL_SHELL_ASSET_ID = 'local-127-1'

const localShellAsset: AiopsAssetRecord = {
  id: LOCAL_SHELL_ASSET_ID,
  uuid: LOCAL_SHELL_ASSET_ID,
  name: '127.0.0.1',
  title: '127.0.0.1',
  host: '127.0.0.1',
  ip: '127.0.0.1',
  group: '本地连接',
  group_name: '本地连接',
  status: 'online',
  tags: ['local'],
  username: 'local',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  isLocalShell: true
}

export const defaultAssetFolders: AiopsCustomFolderRecord[] = [
  { uuid: 'direct-folder-prod', name: '生产', description: '生产直连主机', scope: 'direct' },
  { uuid: 'direct-folder-staging', name: '预发', description: '预发直连主机', scope: 'direct' },
  { uuid: 'direct-folder-db', name: '数据库', description: '数据库直连主机', parentUuid: 'direct-folder-prod', scope: 'direct' },
  { uuid: 'direct-folder-maintenance', name: '维护', description: '维护直连主机', scope: 'direct' },
  { uuid: 'custom-folder-a', name: '核心业务', description: '常用堡垒机业务资产', scope: 'bastion' },
  { uuid: 'custom-folder-b', name: '临时排障', description: '短期排障入口', scope: 'bastion' }
]

const seedTimestamp = 1717200000000

export const defaultAssetKeychains: AiopsKeychainRecord[] = [
  {
    id: 'key-1',
    name: 'prod-ed25519',
    type: 'ed25519',
    publicKey: 'ssh-ed25519 AAAA... prod',
    hasPrivateKey: true,
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp
  },
  {
    id: 'key-2',
    name: 'staging-rsa',
    type: 'rsa',
    publicKey: 'ssh-rsa AAAA... staging',
    hasPrivateKey: true,
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp
  }
]

export const defaultAssetKeychainSecrets: Record<string, AssetSecret> = {
  'key-1': {
    privateKey: 'seed-ed25519-private-key-placeholder',
    passphrase: ''
  },
  'key-2': {
    privateKey: 'seed-rsa-private-key-placeholder',
    passphrase: ''
  }
}

export const defaultAssetSecrets: Record<string, AssetSecret> = {
  'asset-5': {
    jumpserverToken: 'seed-private-token'
  }
}

export const defaultAssets: AiopsAssetRecord[] = [
  localShellAsset,
  {
    id: 'asset-1',
    uuid: 'asset-1',
    name: 'prod-bastion',
    title: 'prod-bastion',
    host: '10.24.8.12',
    ip: '10.24.8.12',
    group: '生产',
    group_name: '生产',
    status: 'online',
    tags: ['linux', 'prod'],
    username: 'ops',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '生产入口',
    data_source: 'manual',
    favorite: true,
    folderUuid: 'custom-folder-a',
    organizationId: 'org-1'
  },
  {
    id: 'asset-2',
    uuid: 'asset-2',
    name: 'staging-api',
    title: 'staging-api',
    host: '10.24.12.44',
    ip: '10.24.12.44',
    group: '预发',
    group_name: '预发',
    status: 'online',
    tags: ['linux', 'staging'],
    username: 'deploy',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    keychainId: 'key-2',
    comment: '预发 API',
    data_source: 'manual',
    tunnelState: 'active'
  },
  {
    id: 'asset-3',
    uuid: 'asset-3',
    name: 'mysql-primary',
    title: 'mysql-primary',
    host: '10.32.6.9',
    ip: '10.32.6.9',
    group: '数据库',
    group_name: '数据库',
    status: 'online',
    tags: ['mysql'],
    username: 'dba',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '主库',
    data_source: 'manual',
    folderUuid: 'custom-folder-a',
    organizationId: 'org-1'
  },
  {
    id: 'asset-4',
    uuid: 'asset-4',
    name: 'legacy-node',
    title: 'legacy-node',
    host: '10.11.7.21',
    ip: '10.11.7.21',
    group: '维护',
    group_name: '维护',
    status: 'offline',
    tags: ['audit'],
    username: 'ops',
    port: 2222,
    asset_type: 'person',
    auth_type: 'password',
    comment: '待迁移',
    data_source: 'manual'
  },
  {
    id: 'asset-5',
    uuid: 'org-1',
    name: 'jumpserver-org',
    title: 'jumpserver-org',
    host: 'bastion.internal',
    ip: 'bastion.internal',
    group: '企业',
    group_name: '企业',
    status: 'online',
    tags: ['jumpserver'],
    username: 'sync',
    port: 22,
    asset_type: 'organization',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '同步资产',
    data_source: 'refresh',
    bastionType: 'jumpserver',
    jumpserverApiUrl: 'https://jumpserver.seed.local',
    favorite: true
  }
]

export const cloneAsset = (asset: AiopsAssetRecord): AiopsAssetRecord => ({
  ...asset,
  tags: [...asset.tags]
})

export const cloneFolder = (folder: AiopsCustomFolderRecord): AiopsCustomFolderRecord => ({ ...folder })

export const cloneKeychain = (keychain: AiopsKeychainRecord): AiopsKeychainRecord => ({ ...keychain })

export const withLocalShellAsset = (assets: AiopsAssetRecord[]): AiopsAssetRecord[] => [
  cloneAsset(localShellAsset),
  ...assets.filter((asset) => asset.id !== LOCAL_SHELL_ASSET_ID && asset.uuid !== LOCAL_SHELL_ASSET_ID && !asset.isLocalShell).map(cloneAsset)
]

export const seedAssets = () => defaultAssets.filter((asset) => !asset.isLocalShell).map(cloneAsset)

export const seedFolders = () => defaultAssetFolders.map(cloneFolder)

export const seedKeychains = () => defaultAssetKeychains.map(cloneKeychain)

const cloneSecret = (secret: AssetSecret): AssetSecret => ({ ...secret })

export const seedKeychainSecrets = () => Object.fromEntries(Object.entries(defaultAssetKeychainSecrets).map(([id, secret]) => [id, cloneSecret(secret)]))

export const seedAssetSecrets = () => Object.fromEntries(Object.entries(defaultAssetSecrets).map(([id, secret]) => [id, cloneSecret(secret)]))

export const emptySeedlessStore = (): AssetStoreShape => ({
  assets: [],
  folders: [],
  secrets: {},
  keychains: [],
  keychainSecrets: {}
})

export const seededStore = (): AssetStoreShape => ({
  assets: seedAssets(),
  folders: seedFolders(),
  secrets: seedAssetSecrets(),
  keychains: seedKeychains(),
  keychainSecrets: seedKeychainSecrets()
})

export const defaultAssetStoreShape = (useSeedData: boolean) => (useSeedData ? seededStore() : emptySeedlessStore())

const stableJson = (value: unknown) => JSON.stringify(value)
const seedAssetById = new Map(seedAssets().map((asset) => [asset.id, asset]))
const seedFolderByUuid = new Map(defaultAssetFolders.map((folder) => [folder.uuid, folder]))
const seedKeychainById = new Map(defaultAssetKeychains.map((keychain) => [keychain.id, keychain]))

export const hasOwn = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key)

export const isUnmodifiedSeedAsset = (asset: AiopsAssetRecord) => {
  const seed = seedAssetById.get(asset.id)
  return Boolean(seed && stableJson(asset) === stableJson(seed))
}

export const isUnmodifiedSeedFolder = (folder: AiopsCustomFolderRecord) => {
  const seed = seedFolderByUuid.get(folder.uuid)
  return Boolean(seed && stableJson(folder) === stableJson(seed))
}

export const isUnmodifiedSeedKeychain = (keychain: AiopsKeychainRecord, secret?: AssetSecret) => {
  const seed = seedKeychainById.get(keychain.id)
  return Boolean(seed && stableJson(keychain) === stableJson(seed) && stableJson(secret || {}) === stableJson(defaultAssetKeychainSecrets[keychain.id] || {}))
}

export const sanitizeAsset = (asset: AiopsAssetRecord, secret?: AssetSecret): AiopsAssetRecord => ({
  ...cloneAsset(asset),
  hasPassword: Boolean(secret?.password || asset.hasPassword),
  hasPrivateKey: Boolean(secret?.privateKey || asset.keychainId || asset.hasPrivateKey),
  hasJumpserverToken: Boolean(secret?.jumpserverToken || asset.hasJumpserverToken)
})

export const sanitizeKeychain = (keychain: AiopsKeychainRecord, secret?: AssetSecret, includeSecret = false): AiopsKeychainRecord => ({
  ...cloneKeychain(keychain),
  hasPrivateKey: Boolean(secret?.privateKey || keychain.hasPrivateKey),
  ...(includeSecret && secret?.privateKey ? { privateKey: secret.privateKey } : {}),
  ...(includeSecret && typeof secret?.passphrase === 'string' ? { passphrase: secret.passphrase } : {})
})

export const normalizeFolderInput = (input: AiopsCustomFolderSaveInput, existing?: AiopsCustomFolderRecord): AiopsCustomFolderRecord => {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('Folder name is required')
  const parentUuid = String(hasOwn(input, 'parentUuid') ? input.parentUuid || '' : existing?.parentUuid || '').trim()
  const inputScope = String(hasOwn(input, 'scope') ? input.scope || 'bastion' : existing?.scope || 'bastion').trim()
  const scope = inputScope === 'direct' ? 'direct' : 'bastion'
  return {
    uuid: existing?.uuid || `folder-${randomUUID()}`,
    name,
    description: String(input.description ?? existing?.description ?? '').trim(),
    ...(parentUuid ? { parentUuid } : {}),
    scope
  }
}

export const folderScope = (folder: Pick<AiopsCustomFolderRecord, 'scope'>) => (folder.scope === 'direct' ? 'direct' : 'bastion')

export const assertFolderParent = (folders: AiopsCustomFolderRecord[], folder: AiopsCustomFolderRecord) => {
  if (!folder.parentUuid) return
  if (folder.parentUuid === folder.uuid) throw new Error('Folder cannot be its own parent')
  const parent = folders.find((item) => item.uuid === folder.parentUuid)
  if (!parent) throw new Error('Parent folder not found')
  if (folderScope(parent) !== folderScope(folder)) throw new Error('Folder parent scope mismatch')

  let cursor: AiopsCustomFolderRecord | undefined = parent
  const seen = new Set<string>([folder.uuid])
  while (cursor?.parentUuid) {
    if (seen.has(cursor.parentUuid)) throw new Error('Folder parent cycle detected')
    seen.add(cursor.uuid)
    cursor = folders.find((item) => item.uuid === cursor?.parentUuid)
  }
}

export const normalizeAssetInput = (input: AiopsAssetInput, existing?: AiopsAssetRecord): AiopsAssetRecord => {
  const id = input.id || existing?.id || `asset-${randomUUID()}`
  const name = input.name.trim()
  const host = input.host.trim()
  const group = (input.group || input.group_name || existing?.group || '未分组').trim() || '未分组'
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags || []
  const hasPassword = hasOwn(input, 'password') ? Boolean(input.password) : Boolean(existing?.hasPassword)
  const hasPrivateKey = hasOwn(input, 'privateKey') ? Boolean(input.privateKey) : Boolean(existing?.hasPrivateKey)
  return {
    id,
    uuid: existing?.uuid || id,
    name,
    title: (input.title || input.name || existing?.title || name).trim(),
    host,
    ip: (input.ip || input.host || existing?.ip || host).trim(),
    group,
    group_name: (input.group_name || input.group || existing?.group_name || group).trim(),
    status: input.status || existing?.status || 'online',
    tags,
    username: (input.username || existing?.username || 'root').trim(),
    port: Number(input.port || existing?.port || 22),
    asset_type: input.asset_type || existing?.asset_type || 'person',
    auth_type: input.auth_type || existing?.auth_type || 'password',
    comment: input.comment ?? existing?.comment ?? '',
    data_source: input.data_source || existing?.data_source || 'manual',
    favorite: input.favorite ?? existing?.favorite ?? false,
    folderUuid: hasOwn(input, 'folderUuid') ? input.folderUuid : existing?.folderUuid,
    organizationId: hasOwn(input, 'organizationId') ? input.organizationId : existing?.organizationId,
    tunnelState: hasOwn(input, 'tunnelState') ? input.tunnelState : existing?.tunnelState,
    needProxy: input.needProxy ?? existing?.needProxy ?? false,
    proxyName: hasOwn(input, 'proxyName') ? input.proxyName : existing?.proxyName,
    keychainId: hasOwn(input, 'keychainId') ? input.keychainId : existing?.keychainId,
    jumpHostId: hasOwn(input, 'jumpHostId') ? input.jumpHostId : existing?.jumpHostId,
    bastionType: hasOwn(input, 'bastionType') ? input.bastionType : existing?.bastionType,
    jumpserverApiUrl: hasOwn(input, 'jumpserverApiUrl') ? input.jumpserverApiUrl?.trim() : existing?.jumpserverApiUrl,
    jumpserverOrgId: hasOwn(input, 'jumpserverOrgId') ? input.jumpserverOrgId?.trim() : existing?.jumpserverOrgId,
    jumpserverAssetId: hasOwn(input, 'jumpserverAssetId') ? input.jumpserverAssetId?.trim() : existing?.jumpserverAssetId,
    hasJumpserverToken: hasOwn(input, 'jumpserverToken') ? Boolean(input.jumpserverToken) : Boolean(existing?.hasJumpserverToken),
    hasPassword,
    hasPrivateKey
  }
}

export const mergeAssetSecretInput = (existingSecret: AssetSecret, input: AiopsAssetInput): AssetSecret => {
  const secret: AssetSecret = { ...existingSecret }
  if (hasOwn(input, 'password')) {
    if (input.password) secret.password = input.password
    else delete secret.password
  }
  if (hasOwn(input, 'privateKey')) {
    if (input.privateKey) secret.privateKey = input.privateKey
    else delete secret.privateKey
  }
  if (hasOwn(input, 'passphrase')) {
    if (input.passphrase) secret.passphrase = input.passphrase
    else delete secret.passphrase
  }
  if (hasOwn(input, 'jumpserverToken')) {
    if (input.jumpserverToken) secret.jumpserverToken = input.jumpserverToken
    else delete secret.jumpserverToken
  }
  return secret
}

export const detectKeyType = (privateKey = '', publicKey = ''): AiopsKeychainType => {
  const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
  if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
  if (publicAlgorithm === 'ssh-rsa') return 'rsa'
  if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'
  if (privateKey.includes('BEGIN RSA PRIVATE KEY') || privateKey.includes('ssh-rsa')) return 'rsa'
  if (privateKey.includes('BEGIN EC PRIVATE KEY') || privateKey.includes('ecdsa-sha2')) return 'ecdsa'
  if (privateKey.includes('ssh-ed25519')) return 'ed25519'
  return 'rsa'
}

export const normalizeKeychainInput = (input: AiopsKeychainInput, existing?: AiopsKeychainRecord): AiopsKeychainRecord => {
  const now = Date.now()
  const id = input.id || existing?.id || `key-${randomUUID()}`
  const name = input.name.trim()
  if (!name) throw new Error('Keychain name is required')
  const publicKey = (input.publicKey ?? existing?.publicKey ?? '').trim()
  const privateKey = input.privateKey ?? existing?.privateKey ?? ''
  return {
    id,
    name,
    type: input.type || detectKeyType(privateKey, publicKey) || existing?.type || 'rsa',
    publicKey,
    hasPrivateKey: Boolean(input.privateKey || existing?.hasPrivateKey),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

export const normalizeKeychainSecret = (input: AiopsKeychainInput, existingSecret: AssetSecret = {}): AssetSecret => {
  const privateKey = input.privateKey ?? existingSecret.privateKey ?? ''
  if (!privateKey.trim()) throw new Error('Private key is required')
  return {
    ...existingSecret,
    privateKey: privateKey.trim(),
    passphrase: input.passphrase ?? existingSecret.passphrase ?? ''
  }
}

export const assertUniqueKeychainName = (keychains: AiopsKeychainRecord[], keychain: AiopsKeychainRecord) => {
  if (keychains.some((item) => item.name === keychain.name && item.id !== keychain.id)) {
    throw new Error(`Keychain already exists: ${keychain.name}`)
  }
}

const keychainFingerprint = (keychain: AiopsKeychainRecord) => {
  const source = keychain.publicKey || keychain.name || keychain.id
  return `SHA256:${createHash('sha256').update(source).digest('base64').replace(/=+$/, '')}`
}

export const keychainToSshAgentOption = (keychain: AiopsKeychainRecord): SshAgentKeychainOption => ({
  key: keychain.id,
  label: keychain.name,
  fingerprint: keychainFingerprint(keychain),
  keyType: keychain.type.toUpperCase()
})

export const shouldIncludeAssetGroup = (asset: AiopsAssetRecord, input: AiopsAssetGroupListInput = {}) =>
  !asset.isLocalShell && (!input.assetTypes?.length || input.assetTypes.includes(asset.asset_type))

export const assetGroupName = (asset: AiopsAssetRecord) => {
  const group = (asset.group || asset.group_name || '未分组').trim()
  return !group || group === 'Hosts' ? '未分组' : group
}

export const listAssetGroupsFromAssets = (assets: AiopsAssetRecord[], input: AiopsAssetGroupListInput = {}): AiopsAssetGroupRecord[] => {
  const groupCounts = new Map<string, number>()
  assets.filter((asset) => shouldIncludeAssetGroup(asset, input)).forEach((asset) => {
    const group = assetGroupName(asset)
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1)
  })
  return [...groupCounts.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, count]) => ({
      key: `group-${name}`,
      name,
      count
    }))
}
