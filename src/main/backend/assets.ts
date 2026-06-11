import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto'
import { createRequire } from 'module'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import type { Client, ConnectConfig } from 'ssh2'
import type {
  AiopsAssetConnectionTestInfo,
  AiopsAssetConnectionTestInput,
  AiopsAssetConnectionTestResult,
  AiopsAssetExportInput,
  AiopsAssetExportPayload,
  AiopsAssetExportResult,
  AiopsAssetImportConfirmInput,
  AiopsAssetImportConfirmResult,
  AiopsAssetImportPreviewInput,
  AiopsAssetImportPreviewRecord,
  AiopsAssetImportPreviewResult,
  AiopsAssetInput,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupListInput,
  AiopsAssetGroupRecord,
  AiopsAssetGroupRenameInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord,
  AiopsKeychainType,
  AiopsMutationResult,
  AiopsOrganizationAssetRefreshInput,
  AiopsOrganizationAssetRefreshResult,
  SshAgentKeychainOption,
  UserConfig
} from '@shared/preload'
import { parseAssetImportContent, type ImportedAssetDraft } from '@shared/assetImport'
import { createConfiguredSshAgentAuth } from './sshAgent'
import { loadSsh2 } from './ssh2Runtime'
import { createSshProxySocketForAsset, type SshProxySocket } from './sshProxy'

type AssetSecret = {
  password?: string
  privateKey?: string
  passphrase?: string
}

const requireNative = createRequire(__filename)

type AssetStoreShape = {
  assets: AiopsAssetRecord[]
  folders: AiopsCustomFolderRecord[]
  secrets: Record<string, AssetSecret>
  keychains: AiopsKeychainRecord[]
  keychainSecrets: Record<string, AssetSecret>
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

type AssetSshTestClient = Pick<Client, 'connect' | 'end' | 'on' | 'off' | 'once'>

type AssetConnectionRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'sshProxyConfigs' | 'sshAgentKeys' | 'terminal'>
  ssh2Runtime?: { Client: new () => AssetSshTestClient } | null
  now?: () => number
  timeoutMs?: number
}

type AssetBackendRuntimeConfig = AssetConnectionRuntimeConfig & {
  databasePath?: string
  credentialKeyPath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sqliteFactory?: new (path: string) => SqliteDatabase
}

type AssetExportRuntime = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
  writeFile?: (filePath: string, content: string, encoding: 'utf-8') => Promise<void>
  now?: () => Date
}

type ResolvedAssetConnectionTarget = {
  assetId?: string
  host: string
  port: number
  username: string
  authType: AiopsAssetRecord['auth_type']
  password?: string
  privateKey?: string
  passphrase?: string
  authSource: AiopsAssetConnectionTestInfo['authSource']
  needProxy?: boolean
  proxyName?: string
  agent?: ConnectConfig['agent']
  agentKeyCount?: number
}

class AssetConnectionTestError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetConnectionTestError'
  }
}

class AssetExportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetExportError'
  }
}

const defaultFolders: AiopsCustomFolderRecord[] = [
  { uuid: 'custom-folder-a', name: '核心业务', description: '常用堡垒机业务资产' },
  { uuid: 'custom-folder-b', name: '临时排障', description: '短期排障入口' }
]

const seedTimestamp = 1717200000000

const defaultKeychains: AiopsKeychainRecord[] = [
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

const defaultKeychainSecrets: Record<string, AssetSecret> = {
  'key-1': {
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----',
    passphrase: ''
  },
  'key-2': {
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\n-----END RSA PRIVATE KEY-----',
    passphrase: ''
  }
}

const defaultAssetSeedMode = () => process.env.NODE_ENV === 'test' || String(process.env.AIOPSTERM_ASSETS_ENABLE_SEED || '').trim() === '1'

const defaultAssetDatabasePath = () => {
  const envPath = String(process.env.AIOPSTERM_ASSETS_DB_PATH || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-state.db')
}

const defaultAssetCredentialKeyPath = () => {
  const envPath = String(process.env.AIOPSTERM_ASSETS_CREDENTIAL_KEY_FILE || '').trim()
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(envPath)
  return join(app.getPath('userData'), 'aiopsterm-assets-credential.key')
}

type AssetRuntimeState = Required<Pick<AssetBackendRuntimeConfig, 'databasePath' | 'credentialKeyPath' | 'useSeedData' | 'forceFallbackStore'>> & {
  sqliteFactory?: new (path: string) => SqliteDatabase
}

let runtimeConfig: AssetRuntimeState = {
  databasePath: defaultAssetDatabasePath(),
  credentialKeyPath: defaultAssetCredentialKeyPath(),
  useSeedData: defaultAssetSeedMode(),
  forceFallbackStore: false
}

const LOCAL_SHELL_ASSET_ID = 'local-127-1'

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

const defaultAssets: AiopsAssetRecord[] = [
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
    favorite: true
  }
]

const cloneAsset = (asset: AiopsAssetRecord): AiopsAssetRecord => ({
  ...asset,
  tags: [...asset.tags]
})

const withLocalShellAsset = (assets: AiopsAssetRecord[]): AiopsAssetRecord[] => [
  cloneAsset(localShellAsset),
  ...assets.filter((asset) => asset.id !== LOCAL_SHELL_ASSET_ID && asset.uuid !== LOCAL_SHELL_ASSET_ID && !asset.isLocalShell).map(cloneAsset)
]

const cloneFolder = (folder: AiopsCustomFolderRecord): AiopsCustomFolderRecord => ({ ...folder })

const cloneKeychain = (keychain: AiopsKeychainRecord): AiopsKeychainRecord => ({ ...keychain })

const seedAssets = () => defaultAssets.filter((asset) => !asset.isLocalShell).map(cloneAsset)

const seedFolders = () => defaultFolders.map(cloneFolder)

const seedKeychains = () => defaultKeychains.map(cloneKeychain)

const seedKeychainSecrets = () => ({ ...defaultKeychainSecrets })

const emptySeedlessStore = (): AssetStoreShape => ({
  assets: [],
  folders: [],
  secrets: {},
  keychains: [],
  keychainSecrets: {}
})

const seededStore = (): AssetStoreShape => ({
  assets: seedAssets(),
  folders: seedFolders(),
  secrets: {},
  keychains: seedKeychains(),
  keychainSecrets: seedKeychainSecrets()
})

const defaultStoreShape = () => (runtimeConfig.useSeedData ? seededStore() : emptySeedlessStore())

const stableJson = (value: unknown) => JSON.stringify(value)

const seedAssetById = new Map(seedAssets().map((asset) => [asset.id, asset]))
const seedFolderByUuid = new Map(defaultFolders.map((folder) => [folder.uuid, folder]))
const seedKeychainById = new Map(defaultKeychains.map((keychain) => [keychain.id, keychain]))
const hasOwn = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key)

const safeStorageCredentialPrefix = 'as1:'
const localKeyCredentialPrefix = 'ak1:'

const ensureCredentialKeyDir = (filePath: string) => {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

let cachedCredentialKeyPath = ''
let cachedCredentialKey: Buffer | null = null

const readOrCreateCredentialKey = () => {
  if (cachedCredentialKey && cachedCredentialKeyPath === runtimeConfig.credentialKeyPath) return cachedCredentialKey
  cachedCredentialKeyPath = runtimeConfig.credentialKeyPath
  cachedCredentialKey = null
  if (existsSync(runtimeConfig.credentialKeyPath)) {
    const current = readFileSync(runtimeConfig.credentialKeyPath)
    if (current.length === 32) {
      cachedCredentialKey = current
      return cachedCredentialKey
    }
  }
  ensureCredentialKeyDir(runtimeConfig.credentialKeyPath)
  cachedCredentialKey = randomBytes(32)
  writeFileSync(runtimeConfig.credentialKeyPath, cachedCredentialKey, { mode: 0o600 })
  return cachedCredentialKey
}

const safeStorageAvailable = () => {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.())
  } catch {
    return false
  }
}

const encryptWithLocalCredentialKey = (plain: string) => {
  const key = readOrCreateCredentialKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${localKeyCredentialPrefix}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`
}

const decryptWithLocalCredentialKey = (cipherText: string) => {
  const body = cipherText.slice(localKeyCredentialPrefix.length)
  const [ivB64, encryptedB64, tagB64] = body.split('.')
  if (!ivB64 || !encryptedB64 || !tagB64) throw new Error('Malformed local asset credential ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', readOrCreateCredentialKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf-8')
}

const encryptCredentialValue = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  if (!value) return ''
  if (value.startsWith(safeStorageCredentialPrefix) || value.startsWith(localKeyCredentialPrefix)) return value
  if (safeStorageAvailable()) {
    return `${safeStorageCredentialPrefix}${safeStorage.encryptString(value).toString('base64')}`
  }
  return encryptWithLocalCredentialKey(value)
}

const decryptCredentialValue = (value: unknown) => {
  if (typeof value !== 'string') return ''
  if (!value) return ''
  if (value.startsWith(safeStorageCredentialPrefix)) {
    try {
      return safeStorage?.decryptString(Buffer.from(value.slice(safeStorageCredentialPrefix.length), 'base64')) || ''
    } catch {
      return ''
    }
  }
  if (value.startsWith(localKeyCredentialPrefix)) {
    try {
      return decryptWithLocalCredentialKey(value)
    } catch {
      return ''
    }
  }
  return value
}

const decryptAssetSecret = (secret: AssetSecret = {}): AssetSecret => ({
  ...(hasOwn(secret, 'password') ? { password: decryptCredentialValue(secret.password) } : {}),
  ...(hasOwn(secret, 'privateKey') ? { privateKey: decryptCredentialValue(secret.privateKey) } : {}),
  ...(hasOwn(secret, 'passphrase') ? { passphrase: decryptCredentialValue(secret.passphrase) } : {})
})

const encryptAssetSecretForStorage = (secret: AssetSecret = {}): AssetSecret => ({
  ...(hasOwn(secret, 'password') ? { password: encryptCredentialValue(secret.password) } : {}),
  ...(hasOwn(secret, 'privateKey') ? { privateKey: encryptCredentialValue(secret.privateKey) } : {}),
  ...(hasOwn(secret, 'passphrase') ? { passphrase: encryptCredentialValue(secret.passphrase) } : {})
})

const assetSecretNeedsEncryption = (secret: AssetSecret = {}) =>
  (['password', 'privateKey', 'passphrase'] as const).some((key) => {
    const value = secret[key]
    return typeof value === 'string' && value.length > 0 && !value.startsWith(safeStorageCredentialPrefix) && !value.startsWith(localKeyCredentialPrefix)
  })

const isUnmodifiedSeedAsset = (asset: AiopsAssetRecord) => {
  const seed = seedAssetById.get(asset.id)
  return Boolean(seed && stableJson(asset) === stableJson(seed))
}

const isUnmodifiedSeedFolder = (folder: AiopsCustomFolderRecord) => {
  const seed = seedFolderByUuid.get(folder.uuid)
  return Boolean(seed && stableJson(folder) === stableJson(seed))
}

const isUnmodifiedSeedKeychain = (keychain: AiopsKeychainRecord, secret?: AssetSecret) => {
  const seed = seedKeychainById.get(keychain.id)
  return Boolean(seed && stableJson(keychain) === stableJson(seed) && stableJson(secret || {}) === stableJson(defaultKeychainSecrets[keychain.id] || {}))
}

const sanitizeAsset = (asset: AiopsAssetRecord, secret?: AssetSecret): AiopsAssetRecord => ({
  ...cloneAsset(asset),
  hasPassword: Boolean(secret?.password || asset.hasPassword),
  hasPrivateKey: Boolean(secret?.privateKey || asset.keychainId || asset.hasPrivateKey)
})

const sanitizeKeychain = (keychain: AiopsKeychainRecord, secret?: AssetSecret, includeSecret = false): AiopsKeychainRecord => ({
  ...cloneKeychain(keychain),
  hasPrivateKey: Boolean(secret?.privateKey || keychain.hasPrivateKey),
  ...(includeSecret && secret?.privateKey ? { privateKey: secret.privateKey } : {}),
  ...(includeSecret && typeof secret?.passphrase === 'string' ? { passphrase: secret.passphrase } : {})
})

const assetConnectionRuntime: AssetConnectionRuntimeConfig = {}

export const configureAssetConnectionRuntime = (config: AssetConnectionRuntimeConfig = {}) => {
  assetConnectionRuntime.getConfig = config.getConfig
  assetConnectionRuntime.ssh2Runtime = config.ssh2Runtime
  assetConnectionRuntime.now = config.now
  assetConnectionRuntime.timeoutMs = config.timeoutMs
}

export const configureAssetBackendRuntime = (config: AssetBackendRuntimeConfig = {}) => {
  runtimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultAssetDatabasePath(),
    credentialKeyPath: config.credentialKeyPath ? (isAbsolute(config.credentialKeyPath) ? config.credentialKeyPath : resolve(config.credentialKeyPath)) : defaultAssetCredentialKeyPath(),
    useSeedData: config.useSeedData ?? defaultAssetSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore),
    ...(config.sqliteFactory ? { sqliteFactory: config.sqliteFactory } : {})
  }
  configureAssetConnectionRuntime(config)
  assetStore = null
  cachedCredentialKeyPath = ''
  cachedCredentialKey = null
}

const assetConnectionNow = () => assetConnectionRuntime.now?.() ?? Date.now()

const assetConnectionTimeoutMs = (input?: AiopsAssetConnectionTestInput) => {
  const candidate = Number(input?.timeoutMs || assetConnectionRuntime.timeoutMs || 15000)
  if (!Number.isFinite(candidate)) return 15000
  return Math.max(1000, Math.min(60000, Math.trunc(candidate)))
}

const getAssetConnectionSsh2Runtime = () =>
  assetConnectionRuntime.ssh2Runtime === undefined ? loadSsh2() : assetConnectionRuntime.ssh2Runtime

const getAssetConnectionRuntimeConfig = () => {
  const config = assetConnectionRuntime.getConfig?.()
  return {
    terminal: config?.terminal,
    sshAgentKeys: config?.sshAgentKeys,
    sshProxyConfigs: config?.sshProxyConfigs || []
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const validPort = (value: unknown) => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

const usablePrivateKey = (value: unknown) => {
  const privateKey = text(value)
  if (!privateKey.includes('PRIVATE KEY')) return ''
  const body = privateKey
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('BEGIN') && !line.includes('END'))
    .join('')
  return body.length >= 32 ? privateKey : ''
}

const assetDraftText = <K extends keyof AiopsAssetInput>(
  draft: AiopsAssetInput | undefined,
  key: K,
  fallback: unknown = ''
) => (draft && hasOwn(draft, key) ? text(draft[key]) : text(fallback))

const assetDraftPort = (draft: AiopsAssetInput | undefined, fallback: unknown) =>
  draft && hasOwn(draft, 'port') ? Number(draft.port) : Number(fallback || 22)

const assetDraftBoolean = <K extends keyof AiopsAssetInput>(
  draft: AiopsAssetInput | undefined,
  key: K,
  fallback: unknown = false
) => (draft && hasOwn(draft, key) ? Boolean(draft[key]) : Boolean(fallback))

const resolveAssetConnectionTarget = (input: AiopsAssetConnectionTestInput = {}): ResolvedAssetConnectionTarget => {
  const draft = input.asset
  const assetId = text(input.assetId || draft?.id)
  const existing = assetId ? getStore().getAsset(assetId) : null
  if (assetId && !existing && !draft) {
    throw new AssetConnectionTestError('ASSET_SSH_TARGET_NOT_FOUND', '资产不存在或已被删除')
  }
  if (existing?.isLocalShell) {
    throw new AssetConnectionTestError('ASSET_SSH_UNSUPPORTED_TARGET', '本地连接不支持 SSH 连通性测试')
  }

  const host = assetDraftText(draft, 'host', existing?.host || existing?.ip)
  const username = assetDraftText(draft, 'username', existing?.username)
  const port = assetDraftPort(draft, existing?.port || 22)
  const authType = ((draft && hasOwn(draft, 'auth_type') ? draft.auth_type : existing?.auth_type) || 'password') as AiopsAssetRecord['auth_type']
  const keychainId = assetDraftText(draft, 'keychainId', existing?.keychainId)
  const needProxy = assetDraftBoolean(draft, 'needProxy', existing?.needProxy)
  const proxyName = assetDraftText(draft, 'proxyName', existing?.proxyName)

  if (!host || !username || !validPort(port)) {
    throw new AssetConnectionTestError('ASSET_SSH_TARGET_REQUIRED', 'SSH 测试需要地址、用户名和 1-65535 的端口')
  }

  const savedSecret = existing?.id ? getStore().getSecret(existing.id) : {}
  const keychainSecret = keychainId ? getStore().getKeychainSecret(keychainId) : {}
  if (authType === 'password') {
    const password = text(draft?.password) || text(savedSecret.password)
    if (!password) throw new AssetConnectionTestError('ASSET_SSH_AUTH_REQUIRED', 'SSH 密码不能为空')
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      password,
      authSource: 'password',
      needProxy,
      proxyName
    }
  }

  const draftPrivateKey = usablePrivateKey(draft?.privateKey)
  const savedPrivateKey = usablePrivateKey(savedSecret.privateKey)
  const keychainPrivateKey = usablePrivateKey(keychainSecret.privateKey)
  const privateKey = draftPrivateKey || savedPrivateKey || keychainPrivateKey
  const passphrase = text(draft?.passphrase) || text(savedSecret.passphrase) || text(keychainSecret.passphrase)
  if (privateKey) {
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      privateKey,
      ...(passphrase ? { passphrase } : {}),
      authSource: keychainPrivateKey && privateKey === keychainPrivateKey ? 'keychain' : 'privateKey',
      needProxy,
      proxyName
    }
  }

  const configuredAgentAuth = createConfiguredSshAgentAuth(getAssetConnectionRuntimeConfig(), (keyChainId) => getStore().getKeychainSecret(keyChainId))
  if (configuredAgentAuth?.agent) {
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      agent: configuredAgentAuth.agent,
      agentKeyCount: configuredAgentAuth.keyCount,
      authSource: 'sshAgent',
      needProxy,
      proxyName
    }
  }
  if (process.env.SSH_AUTH_SOCK) {
    return {
      assetId: existing?.id || assetId || undefined,
      host,
      port: Number(port),
      username,
      authType,
      agent: process.env.SSH_AUTH_SOCK,
      authSource: 'sshAgent',
      needProxy,
      proxyName
    }
  }
  throw new AssetConnectionTestError('ASSET_SSH_AUTH_REQUIRED', 'SSH 测试需要密码、私钥、KeyChain 或 SSH Agent')
}

const connectAssetSshClient = (client: AssetSshTestClient, connectConfig: ConnectConfig, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      client.off('ready', handleReady)
      client.off('error', handleError)
      client.off('close', handleClose)
    }
    const handleReady = () => settle(resolve)
    const handleError = (error: Error) => settle(() => reject(error))
    const handleClose = () => settle(() => reject(new Error('SSH connection closed before ready')))

    timer = setTimeout(() => {
      try {
        client.end()
      } catch {}
      settle(() => reject(new Error(`SSH connection timeout after ${timeoutMs}ms`)))
    }, timeoutMs)
    client.once('ready', handleReady)
    client.once('error', handleError)
    client.once('close', handleClose)
    try {
      client.connect(connectConfig)
    } catch (error) {
      settle(() => reject(error))
    }
  })

const normalizeFolderInput = (input: AiopsCustomFolderSaveInput, existing?: AiopsCustomFolderRecord): AiopsCustomFolderRecord => {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('Folder name is required')
  return {
    uuid: existing?.uuid || `folder-${randomUUID()}`,
    name,
    description: String(input.description ?? existing?.description ?? '').trim()
  }
}

const normalizeAssetInput = (input: AiopsAssetInput, existing?: AiopsAssetRecord): AiopsAssetRecord => {
  const id = input.id || existing?.id || `asset-${randomUUID()}`
  const name = input.name.trim()
  const host = input.host.trim()
  const group = (input.group || input.group_name || existing?.group || 'Hosts').trim()
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags || []
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
    hasPassword: Boolean(input.password || existing?.hasPassword),
    hasPrivateKey: Boolean(input.privateKey || existing?.hasPrivateKey)
  }
}

const detectKeyType = (privateKey = '', publicKey = ''): AiopsKeychainType => {
  const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
  if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
  if (publicAlgorithm === 'ssh-rsa') return 'rsa'
  if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'
  if (privateKey.includes('BEGIN RSA PRIVATE KEY') || privateKey.includes('ssh-rsa')) return 'rsa'
  if (privateKey.includes('BEGIN EC PRIVATE KEY') || privateKey.includes('ecdsa-sha2')) return 'ecdsa'
  if (privateKey.includes('ssh-ed25519')) return 'ed25519'
  return 'rsa'
}

const normalizeKeychainInput = (input: AiopsKeychainInput, existing?: AiopsKeychainRecord): AiopsKeychainRecord => {
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

const normalizeKeychainSecret = (input: AiopsKeychainInput, existingSecret: AssetSecret = {}): AssetSecret => {
  const privateKey = input.privateKey ?? existingSecret.privateKey ?? ''
  if (!privateKey.trim()) throw new Error('Private key is required')
  return {
    ...existingSecret,
    privateKey: privateKey.trim(),
    passphrase: input.passphrase ?? existingSecret.passphrase ?? ''
  }
}

const assertUniqueKeychainName = (keychains: AiopsKeychainRecord[], keychain: AiopsKeychainRecord) => {
  if (keychains.some((item) => item.name === keychain.name && item.id !== keychain.id)) {
    throw new Error(`Keychain already exists: ${keychain.name}`)
  }
}

const keychainFingerprint = (keychain: AiopsKeychainRecord) => {
  const source = keychain.publicKey || keychain.name || keychain.id
  return `SHA256:${createHash('sha256').update(source).digest('base64').replace(/=+$/, '')}`
}

const keychainToSshAgentOption = (keychain: AiopsKeychainRecord): SshAgentKeychainOption => ({
  key: keychain.id,
  label: keychain.name,
  fingerprint: keychainFingerprint(keychain),
  keyType: keychain.type.toUpperCase()
})

const shouldIncludeAssetGroup = (asset: AiopsAssetRecord, input: AiopsAssetGroupListInput = {}) =>
  !asset.isLocalShell && (!input.assetTypes?.length || input.assetTypes.includes(asset.asset_type))

const assetGroupName = (asset: AiopsAssetRecord) => (asset.group || asset.group_name || 'Hosts').trim() || 'Hosts'

const listAssetGroupsFromAssets = (assets: AiopsAssetRecord[], input: AiopsAssetGroupListInput = {}): AiopsAssetGroupRecord[] => {
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

class FallbackAssetStore {
  private store = new Store<AssetStoreShape>({
    projectName: 'aiopsterm',
    name: 'aiopsterm-assets',
    defaults: defaultStoreShape()
  } as ConstructorParameters<typeof Store<AssetStoreShape>>[0] & { projectName: string })

  constructor() {
    if (runtimeConfig.useSeedData) {
      if (!(this.store.get('assets') || []).filter((asset) => !asset.isLocalShell).length) this.store.set('assets', seedAssets())
      if (!(this.store.get('folders') || []).length) this.store.set('folders', seedFolders())
      if (!(this.store.get('keychains') || []).length) this.store.set('keychains', seedKeychains())
      if (!Object.keys(this.store.get('keychainSecrets') || {}).length) this.store.set('keychainSecrets', seedKeychainSecrets())
    } else {
      this.stripLegacySeedData()
    }
    this.migratePlaintextSecrets()
  }

  private migratePlaintextSecrets() {
    const secrets = this.store.get('secrets') || {}
    const keychainSecrets = this.store.get('keychainSecrets') || {}
    if (Object.values(secrets).some(assetSecretNeedsEncryption)) {
      this.store.set('secrets', Object.fromEntries(Object.entries(secrets).map(([id, secret]) => [id, encryptAssetSecretForStorage(secret)])))
    }
    if (Object.values(keychainSecrets).some(assetSecretNeedsEncryption)) {
      this.store.set('keychainSecrets', Object.fromEntries(Object.entries(keychainSecrets).map(([id, secret]) => [id, encryptAssetSecretForStorage(secret)])))
    }
  }

  private stripLegacySeedData() {
    const rawAssets = this.store.get('assets') || []
    const secrets = this.store.get('secrets') || {}
    const assets = rawAssets.filter((asset) => {
      if (asset.id === LOCAL_SHELL_ASSET_ID || asset.uuid === LOCAL_SHELL_ASSET_ID || asset.isLocalShell) return false
      return !isUnmodifiedSeedAsset(asset)
    })
    const assetIds = new Set(assets.map((asset) => asset.id))
    const nextSecrets = Object.fromEntries(Object.entries(secrets).filter(([assetId]) => assetIds.has(assetId)))
    const referencedFolders = new Set(assets.map((asset) => asset.folderUuid).filter((uuid): uuid is string => Boolean(uuid)))
    const folders = (this.store.get('folders') || []).filter((folder) => !isUnmodifiedSeedFolder(folder) || referencedFolders.has(folder.uuid))
    const referencedKeychains = new Set(assets.map((asset) => asset.keychainId).filter((id): id is string => Boolean(id)))
    const keychainSecrets = this.store.get('keychainSecrets') || {}
    const keychains = (this.store.get('keychains') || []).filter(
      (keychain) => !isUnmodifiedSeedKeychain(keychain, decryptAssetSecret(keychainSecrets[keychain.id])) || referencedKeychains.has(keychain.id)
    )
    const keychainIds = new Set(keychains.map((keychain) => keychain.id))
    const nextKeychainSecrets = Object.fromEntries(Object.entries(keychainSecrets).filter(([keychainId]) => keychainIds.has(keychainId)))
    this.store.set('assets', assets)
    this.store.set('secrets', nextSecrets)
    this.store.set('folders', folders)
    this.store.set('keychains', keychains)
    this.store.set('keychainSecrets', nextKeychainSecrets)
  }

  list(): AiopsAssetSnapshot {
    if (!runtimeConfig.useSeedData) this.stripLegacySeedData()
    this.migratePlaintextSecrets()
    const secrets = this.store.get('secrets') || {}
    const assets = withLocalShellAsset(this.store.get('assets') || [])
    return {
      assets: assets.map((asset) => sanitizeAsset(asset, decryptAssetSecret(secrets[asset.id]))),
      folders: (this.store.get('folders') || []).map(cloneFolder)
    }
  }

  getAsset(id: string): AiopsAssetRecord | null {
    return this.list().assets.find((asset) => asset.id === id) || null
  }

  getSecret(id: string): AssetSecret {
    const secrets = this.store.get('secrets') || {}
    const secret = secrets[id] || {}
    if (assetSecretNeedsEncryption(secret)) {
      const encrypted = encryptAssetSecretForStorage(secret)
      this.store.set('secrets', { ...secrets, [id]: encrypted })
      return decryptAssetSecret(encrypted)
    }
    return decryptAssetSecret(secret)
  }

  listKeychains(): AiopsKeychainRecord[] {
    const secrets = this.store.get('keychainSecrets') || {}
    return (this.store.get('keychains') || []).map((keychain) => sanitizeKeychain(keychain, decryptAssetSecret(secrets[keychain.id])))
  }

  getKeychain(id: string): AiopsKeychainRecord | null {
    const keychain = (this.store.get('keychains') || []).find((item) => item.id === id)
    if (!keychain) return null
    return sanitizeKeychain(keychain, this.getKeychainSecret(id), true)
  }

  getKeychainSecret(id: string): AssetSecret {
    const keychainSecrets = this.store.get('keychainSecrets') || {}
    const secret = keychainSecrets[id] || {}
    if (assetSecretNeedsEncryption(secret)) {
      const encrypted = encryptAssetSecretForStorage(secret)
      this.store.set('keychainSecrets', { ...keychainSecrets, [id]: encrypted })
      return decryptAssetSecret(encrypted)
    }
    return decryptAssetSecret(secret)
  }

  saveKeychain(input: AiopsKeychainInput): AiopsKeychainRecord {
    const keychains = this.store.get('keychains') || []
    const index = keychains.findIndex((keychain) => keychain.id === input.id)
    const existing = index >= 0 ? keychains[index] : undefined
    const secrets = { ...(this.store.get('keychainSecrets') || {}) }
    const secret = normalizeKeychainSecret(input, existing ? decryptAssetSecret(secrets[existing.id]) : {})
    const keychain = normalizeKeychainInput(input, existing)
    assertUniqueKeychainName(keychains, keychain)
    const nextKeychains = index >= 0 ? keychains.map((item) => (item.id === keychain.id ? keychain : item)) : [...keychains, keychain]
    secrets[keychain.id] = encryptAssetSecretForStorage(secret)
    this.store.set('keychains', nextKeychains)
    this.store.set('keychainSecrets', secrets)
    return sanitizeKeychain(keychain, secret)
  }

  deleteKeychain(id: string): void {
    this.store.set(
      'keychains',
      (this.store.get('keychains') || []).filter((keychain) => keychain.id !== id)
    )
    const secrets = { ...(this.store.get('keychainSecrets') || {}) }
    delete secrets[id]
    this.store.set('keychainSecrets', secrets)
    this.store.set(
      'assets',
      (this.store.get('assets') || []).map((asset) => (asset.keychainId === id ? { ...asset, keychainId: undefined, hasPrivateKey: false } : asset))
    )
  }

  save(input: AiopsAssetInput): AiopsAssetRecord {
    const assets = this.store.get('assets') || []
    const index = assets.findIndex((asset) => asset.id === input.id)
    const asset = normalizeAssetInput(input, index >= 0 ? assets[index] : undefined)
    const nextAssets = index >= 0 ? assets.map((item) => (item.id === asset.id ? asset : item)) : [...assets, asset]
    const secrets = { ...(this.store.get('secrets') || {}) }
    const secret = {
      ...decryptAssetSecret(secrets[asset.id]),
      ...(input.password ? { password: input.password } : {}),
      ...(input.privateKey ? { privateKey: input.privateKey } : {}),
      ...(input.passphrase ? { passphrase: input.passphrase } : {})
    }
    secrets[asset.id] = encryptAssetSecretForStorage(secret)
    this.store.set('assets', nextAssets)
    this.store.set('secrets', secrets)
    return sanitizeAsset(asset, secret)
  }

  delete(id: string): void {
    this.store.set(
      'assets',
      (this.store.get('assets') || []).filter((asset) => asset.id !== id)
    )
    const secrets = { ...(this.store.get('secrets') || {}) }
    delete secrets[id]
    this.store.set('secrets', secrets)
  }

  saveFolder(folder: AiopsCustomFolderSaveInput): AiopsCustomFolderRecord {
    const folders = this.store.get('folders') || []
    const existing = folder.uuid ? folders.find((item) => item.uuid === folder.uuid) : undefined
    const normalized = normalizeFolderInput(folder, existing)
    const nextFolders = folders.some((item) => item.uuid === normalized.uuid)
      ? folders.map((item) => (item.uuid === normalized.uuid ? normalized : item))
      : [...folders, normalized]
    this.store.set('folders', nextFolders)
    return cloneFolder(normalized)
  }

  deleteFolder(uuid: string): void {
    this.store.set(
      'folders',
      (this.store.get('folders') || []).filter((folder) => folder.uuid !== uuid)
    )
    const nextAssets = (this.store.get('assets') || []).map((asset) => (asset.folderUuid === uuid ? { ...asset, folderUuid: undefined } : asset))
    this.store.set('assets', nextAssets)
  }
}

class SqliteAssetStore {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        secret TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS asset_folders (
        uuid TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_keychains (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        secret TEXT NOT NULL DEFAULT '{}'
      );
    `)
    if (runtimeConfig.useSeedData) this.seed()
    else this.stripLegacySeedData()
    this.migratePlaintextSecrets()
  }

  private seed() {
    const nonLocalAssetCount = this.rawAssets().filter(({ asset }) => !asset.isLocalShell && asset.id !== LOCAL_SHELL_ASSET_ID && asset.uuid !== LOCAL_SHELL_ASSET_ID).length
    if (!nonLocalAssetCount) {
      for (const asset of seedAssets()) {
        this.db.prepare('INSERT INTO assets (id, data, secret) VALUES (?, ?, ?)').run(asset.id, JSON.stringify(asset), '{}')
      }
    }
    const folderCount = this.db.prepare('SELECT COUNT(*) as count FROM asset_folders').get() as { count: number }
    if (!folderCount.count) {
      for (const folder of seedFolders()) {
        this.db.prepare('INSERT INTO asset_folders (uuid, data) VALUES (?, ?)').run(folder.uuid, JSON.stringify(folder))
      }
    }
    const keychainCount = this.db.prepare('SELECT COUNT(*) as count FROM asset_keychains').get() as { count: number }
    if (!keychainCount.count) {
      for (const keychain of seedKeychains()) {
        this.db
          .prepare('INSERT INTO asset_keychains (id, data, secret) VALUES (?, ?, ?)')
          .run(keychain.id, JSON.stringify(keychain), JSON.stringify(encryptAssetSecretForStorage(defaultKeychainSecrets[keychain.id] || {})))
      }
    }
  }

  private migratePlaintextSecrets() {
    const tx = this.db.transaction(() => {
      for (const { asset, secret } of this.rawAssets()) {
        if (assetSecretNeedsEncryption(secret)) {
          this.db.prepare('UPDATE assets SET secret = ? WHERE id = ?').run(JSON.stringify(encryptAssetSecretForStorage(secret)), asset.id)
        }
      }
      for (const { keychain, secret } of this.rawKeychains()) {
        if (assetSecretNeedsEncryption(secret)) {
          this.db.prepare('UPDATE asset_keychains SET secret = ? WHERE id = ?').run(JSON.stringify(encryptAssetSecretForStorage(secret)), keychain.id)
        }
      }
    })
    tx()
  }

  private stripLegacySeedData() {
    const tx = this.db.transaction(() => {
      const rawAssets = this.rawAssets()
      const assetsToKeep = rawAssets.filter(({ asset }) => {
        if (asset.id === LOCAL_SHELL_ASSET_ID || asset.uuid === LOCAL_SHELL_ASSET_ID || asset.isLocalShell) return false
        return !isUnmodifiedSeedAsset(asset)
      })
      const assetIdsToKeep = new Set(assetsToKeep.map(({ asset }) => asset.id))
      for (const { asset } of rawAssets) {
        if (!assetIdsToKeep.has(asset.id)) this.db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id)
      }

      const referencedFolders = new Set(assetsToKeep.map(({ asset }) => asset.folderUuid).filter((uuid): uuid is string => Boolean(uuid)))
      const rawFolders = this.db
        .prepare('SELECT uuid, data FROM asset_folders')
        .all()
        .map((row) => {
          const data = row as { uuid: string; data: string }
          return { uuid: data.uuid, folder: JSON.parse(data.data) as AiopsCustomFolderRecord }
        })
      for (const { uuid, folder } of rawFolders) {
        if (isUnmodifiedSeedFolder(folder) && !referencedFolders.has(folder.uuid)) this.db.prepare('DELETE FROM asset_folders WHERE uuid = ?').run(uuid)
      }

      const referencedKeychains = new Set(assetsToKeep.map(({ asset }) => asset.keychainId).filter((id): id is string => Boolean(id)))
      for (const { keychain, secret } of this.rawKeychains()) {
        if (isUnmodifiedSeedKeychain(keychain, decryptAssetSecret(secret)) && !referencedKeychains.has(keychain.id)) {
          this.db.prepare('DELETE FROM asset_keychains WHERE id = ?').run(keychain.id)
        }
      }
    })
    tx()
  }

  private rawAssets(): Array<{ asset: AiopsAssetRecord; secret: AssetSecret }> {
    return this.db
      .prepare("SELECT data, secret FROM assets ORDER BY json_extract(data, '$.name') ASC")
      .all()
      .map((row) => {
        const data = row as { data: string; secret: string }
        return {
          asset: JSON.parse(data.data) as AiopsAssetRecord,
          secret: JSON.parse(data.secret || '{}') as AssetSecret
        }
      })
  }

  list(): AiopsAssetSnapshot {
    if (!runtimeConfig.useSeedData) this.stripLegacySeedData()
    this.migratePlaintextSecrets()
    const rows = this.rawAssets()
    const rawAssets = withLocalShellAsset(rows.map(({ asset }) => asset))
    const secrets = new Map(rows.map(({ asset, secret }) => [asset.id, secret]))
    return {
      assets: rawAssets.map((asset) => sanitizeAsset(asset, decryptAssetSecret(secrets.get(asset.id)))),
      folders: this.db
        .prepare("SELECT data FROM asset_folders ORDER BY json_extract(data, '$.name') ASC")
        .all()
        .map((row) => cloneFolder(JSON.parse((row as { data: string }).data) as AiopsCustomFolderRecord))
    }
  }

  getAsset(id: string): AiopsAssetRecord | null {
    return this.list().assets.find((asset) => asset.id === id) || null
  }

  getSecret(id: string): AssetSecret {
    const row = this.db.prepare('SELECT secret FROM assets WHERE id = ?').get(id) as { secret: string } | undefined
    if (!row) return {}
    const secret = JSON.parse(row.secret || '{}') as AssetSecret
    if (assetSecretNeedsEncryption(secret)) {
      const encrypted = encryptAssetSecretForStorage(secret)
      this.db.prepare('UPDATE assets SET secret = ? WHERE id = ?').run(JSON.stringify(encrypted), id)
      return decryptAssetSecret(encrypted)
    }
    return decryptAssetSecret(secret)
  }

  private rawKeychains(): Array<{ keychain: AiopsKeychainRecord; secret: AssetSecret }> {
    return this.db
      .prepare("SELECT data, secret FROM asset_keychains ORDER BY json_extract(data, '$.name') ASC")
      .all()
      .map((row) => {
        const data = row as { data: string; secret: string }
        return {
          keychain: JSON.parse(data.data) as AiopsKeychainRecord,
          secret: JSON.parse(data.secret || '{}') as AssetSecret
        }
      })
  }

  listKeychains(): AiopsKeychainRecord[] {
    this.migratePlaintextSecrets()
    return this.rawKeychains().map(({ keychain, secret }) => sanitizeKeychain(keychain, decryptAssetSecret(secret)))
  }

  getKeychain(id: string): AiopsKeychainRecord | null {
    const row = this.db.prepare('SELECT data, secret FROM asset_keychains WHERE id = ?').get(id) as { data: string; secret: string } | undefined
    if (!row) return null
    return sanitizeKeychain(JSON.parse(row.data) as AiopsKeychainRecord, this.getKeychainSecret(id), true)
  }

  getKeychainSecret(id: string): AssetSecret {
    const row = this.db.prepare('SELECT secret FROM asset_keychains WHERE id = ?').get(id) as { secret: string } | undefined
    if (!row) return {}
    const secret = JSON.parse(row.secret || '{}') as AssetSecret
    if (assetSecretNeedsEncryption(secret)) {
      const encrypted = encryptAssetSecretForStorage(secret)
      this.db.prepare('UPDATE asset_keychains SET secret = ? WHERE id = ?').run(JSON.stringify(encrypted), id)
      return decryptAssetSecret(encrypted)
    }
    return decryptAssetSecret(secret)
  }

  save(input: AiopsAssetInput): AiopsAssetRecord {
    const existingRow = input.id ? (this.db.prepare('SELECT data, secret FROM assets WHERE id = ?').get(input.id) as { data: string; secret: string } | undefined) : undefined
    const existingAsset = existingRow ? (JSON.parse(existingRow.data) as AiopsAssetRecord) : undefined
    const existingSecret = existingRow ? decryptAssetSecret(JSON.parse(existingRow.secret || '{}') as AssetSecret) : {}
    const asset = normalizeAssetInput(input, existingAsset)
    const secret = {
      ...existingSecret,
      ...(input.password ? { password: input.password } : {}),
      ...(input.privateKey ? { privateKey: input.privateKey } : {}),
      ...(input.passphrase ? { passphrase: input.passphrase } : {})
    }
    this.db
      .prepare('INSERT INTO assets (id, data, secret) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, secret = excluded.secret')
      .run(asset.id, JSON.stringify(asset), JSON.stringify(encryptAssetSecretForStorage(secret)))
    return sanitizeAsset(asset, secret)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id)
  }

  saveKeychain(input: AiopsKeychainInput): AiopsKeychainRecord {
    const existingRow = input.id
      ? (this.db.prepare('SELECT data, secret FROM asset_keychains WHERE id = ?').get(input.id) as { data: string; secret: string } | undefined)
      : undefined
    const existingKeychain = existingRow ? (JSON.parse(existingRow.data) as AiopsKeychainRecord) : undefined
    const existingSecret = existingRow ? decryptAssetSecret(JSON.parse(existingRow.secret || '{}') as AssetSecret) : {}
    const secret = normalizeKeychainSecret(input, existingSecret)
    const keychain = normalizeKeychainInput(input, existingKeychain)
    assertUniqueKeychainName(this.listKeychains(), keychain)
    this.db
      .prepare('INSERT INTO asset_keychains (id, data, secret) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, secret = excluded.secret')
      .run(keychain.id, JSON.stringify(keychain), JSON.stringify(encryptAssetSecretForStorage(secret)))
    return sanitizeKeychain(keychain, secret)
  }

  deleteKeychain(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM asset_keychains WHERE id = ?').run(id)
      const rows = this.rawAssets()
      for (const { asset, secret } of rows) {
        if (asset.keychainId !== id) continue
        const next = { ...asset, keychainId: undefined, hasPrivateKey: false }
        this.db.prepare('UPDATE assets SET data = ?, secret = ? WHERE id = ?').run(JSON.stringify(next), JSON.stringify(secret), next.id)
      }
    })
    tx()
  }

  saveFolder(folder: AiopsCustomFolderSaveInput): AiopsCustomFolderRecord {
    const existingRow = folder.uuid
      ? (this.db.prepare('SELECT data FROM asset_folders WHERE uuid = ?').get(folder.uuid) as { data: string } | undefined)
      : undefined
    const existing = existingRow ? (JSON.parse(existingRow.data) as AiopsCustomFolderRecord) : undefined
    const normalized = normalizeFolderInput(folder, existing)
    this.db.prepare('INSERT INTO asset_folders (uuid, data) VALUES (?, ?) ON CONFLICT(uuid) DO UPDATE SET data = excluded.data').run(normalized.uuid, JSON.stringify(normalized))
    return cloneFolder(normalized)
  }

  deleteFolder(uuid: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM asset_folders WHERE uuid = ?').run(uuid)
      const rows = this.rawAssets()
      for (const { asset, secret } of rows) {
        if (asset.folderUuid !== uuid) continue
        const next = { ...asset, folderUuid: undefined }
        this.db.prepare('UPDATE assets SET data = ?, secret = ? WHERE id = ?').run(JSON.stringify(next), JSON.stringify(secret), next.id)
      }
    })
    tx()
  }
}

let assetStore: FallbackAssetStore | SqliteAssetStore | null = null

const createStore = () => {
  if (runtimeConfig.sqliteFactory) {
    return new SqliteAssetStore(new runtimeConfig.sqliteFactory(runtimeConfig.databasePath))
  }
  try {
    if (runtimeConfig.forceFallbackStore) throw new Error('force fallback asset store')
    // Native SQLite is preferred. If the Electron ABI has not been rebuilt yet,
    // the backend falls back to electron-store without changing renderer APIs.
    const Database = runtimeConfig.sqliteFactory || (requireNative('better-sqlite3') as new (path: string) => SqliteDatabase)
    return new SqliteAssetStore(new Database(runtimeConfig.databasePath))
  } catch {
    return new FallbackAssetStore()
  }
}

const getStore = () => {
  if (!assetStore) assetStore = createStore()
  return assetStore
}

const asResult = <T>(fn: () => T): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'ASSET_BACKEND_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

class AssetImportError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'AssetImportError'
  }
}

const assetImportFileName = (filePath: string) => basename(filePath.replace(/\\/g, '/')) || filePath

const assetImportErrorResult = <T>(error: unknown, fallbackCode = 'ASSET_IMPORT_FAILED', fallbackMessage = '资产导入失败。'): AiopsMutationResult<T> => {
  if (error instanceof AssetImportError) {
    return { ok: false, errorCode: error.errorCode, errorMessage: error.message }
  }
  return {
    ok: false,
    errorCode: fallbackCode,
    errorMessage: error instanceof Error ? error.message : String(error || fallbackMessage)
  }
}

const readAssetImportDrafts = async (input: AiopsAssetImportPreviewInput) => {
  const filePath = text(input?.filePath)
  if (!filePath) throw new AssetImportError('ASSET_IMPORT_FILE_REQUIRED', '导入文件路径不能为空。')
  const fileName = assetImportFileName(filePath)
  let content = ''
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    throw new AssetImportError('ASSET_IMPORT_READ_FAILED', error instanceof Error ? error.message : '导入文件读取失败。')
  }
  let drafts: ImportedAssetDraft[] = []
  try {
    drafts = parseAssetImportContent(content, fileName)
  } catch {
    throw new AssetImportError('ASSET_IMPORT_PARSE_FAILED', '导入文件解析失败。')
  }
  if (!drafts.length) throw new AssetImportError('ASSET_IMPORT_EMPTY', '导入文件没有可识别的主机。')
  return { filePath, fileName, drafts }
}

const findAssetImportDuplicate = (assets: AiopsAssetRecord[], draft: ImportedAssetDraft) =>
  assets.find((asset) => !asset.isLocalShell && asset.host === draft.host && asset.username === draft.username && Number(asset.port) === Number(draft.port))

const assetImportPreviewRecord = (draft: ImportedAssetDraft, index: number, assets: AiopsAssetRecord[]): AiopsAssetImportPreviewRecord => {
  const duplicate = findAssetImportDuplicate(assets, draft)
  return {
    previewId: `import-${index}-${draft.host}-${draft.port}`,
    duplicateId: duplicate?.id,
    duplicateTitle: duplicate?.title,
    title: draft.title,
    host: draft.host,
    username: draft.username,
    group: draft.group,
    port: draft.port,
    auth_type: draft.auth_type,
    asset_type: draft.asset_type,
    comment: draft.comment,
    needProxy: draft.needProxy,
    proxyName: draft.proxyName
  }
}

const assetImportInput = (draft: ImportedAssetDraft, existing?: AiopsAssetRecord): AiopsAssetInput => ({
  ...(existing ? { id: existing.id } : {}),
  name: draft.title,
  title: draft.title,
  host: draft.host,
  ip: draft.host,
  group: draft.group,
  group_name: draft.group,
  status: 'online',
  tags: ['imported'],
  username: draft.username,
  port: draft.port,
  asset_type: draft.asset_type,
  auth_type: draft.auth_type,
  comment: draft.comment,
  password: draft.password,
  needProxy: draft.needProxy,
  proxyName: draft.proxyName,
  data_source: existing?.data_source || 'manual'
})

const assetExportErrorResult = (error: unknown): AiopsAssetExportResult => ({
  ok: false,
  errorCode: error instanceof AssetExportError ? error.errorCode : 'ASSET_EXPORT_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || '导出文件失败。')
})

const assetExportFileName = (now = new Date()) => `external-reference-assets-${now.toISOString().slice(0, 10)}.json`

const assetExportPayload = (asset: AiopsAssetRecord): AiopsAssetExportPayload => ({
  username: asset.username,
  password: '',
  ip: asset.host || asset.ip,
  label: asset.title || asset.name || asset.host,
  group_name: asset.group_name || asset.group || '',
  auth_type: asset.auth_type || 'password',
  ...(asset.keychainId ? { keyChain: asset.keychainId } : {}),
  port: asset.port || 22,
  asset_type: asset.asset_type || 'person',
  needProxy: Boolean(asset.needProxy),
  proxyName: asset.proxyName || '',
  ...(asset.comment ? { comment: asset.comment } : {})
})

const resolveAssetExportSelection = (input: AiopsAssetExportInput): AiopsAssetRecord[] => {
  const selectedIds = Array.from(new Set((Array.isArray(input?.assetIds) ? input.assetIds : []).map(text).filter(Boolean)))
  if (!selectedIds.length) throw new AssetExportError('ASSET_EXPORT_EMPTY', '请选择要导出的主机。')
  const selectedSet = new Set(selectedIds)
  const assets = getStore()
    .list()
    .assets.filter((asset) => selectedSet.has(asset.id) && !asset.isLocalShell && asset.asset_type !== 'organization' && asset.host && asset.username)
  if (!assets.length) throw new AssetExportError('ASSET_EXPORT_EMPTY', '没有可导出的主机。')
  return assets
}

const assertUserEditableAsset = (id?: string) => {
  if (id === LOCAL_SHELL_ASSET_ID) throw new Error('本地连接是系统资产，不能编辑或删除')
}

const refreshedAssetForOrganization = (organization: AiopsAssetRecord, index: number): AiopsAssetInput => {
  const baseName = organization.title || organization.name || organization.host || 'organization'
  const hostOctet = 15 + index
  return {
    id: `${organization.id}-synced`,
    name: `${baseName}-synced-asset`,
    title: `${baseName}-synced-asset`,
    host: `10.90.0.${hostOctet}`,
    ip: `10.90.0.${hostOctet}`,
    group: organization.group || organization.group_name || '企业',
    group_name: organization.group_name || organization.group || '企业',
    status: 'online',
    tags: ['jumpserver', 'synced'],
    username: 'jump',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    comment: '刷新来源资产',
    data_source: 'refresh',
    organizationId: organization.uuid || organization.id,
    keychainId: organization.keychainId
  }
}

export const listAssets = (): AiopsAssetSnapshot => getStore().list()
export const listAssetGroups = (input: AiopsAssetGroupListInput = {}): AiopsAssetGroupRecord[] => listAssetGroupsFromAssets(getStore().list().assets, input)
export const getAsset = (id: string): AiopsAssetRecord | null => getStore().getAsset(id)
export const getAssetSecret = (id: string): AssetSecret => getStore().getSecret(id)
export const getKeychainSecret = (id: string): AssetSecret => getStore().getKeychainSecret(id)
export const saveAsset = (input: AiopsAssetInput): AiopsMutationResult<AiopsAssetRecord> =>
  asResult(() => {
    assertUserEditableAsset(input.id)
    return getStore().save(input)
  })
export const testAssetConnection = async (input: AiopsAssetConnectionTestInput = {}): Promise<AiopsAssetConnectionTestResult> => {
  const start = assetConnectionNow()
  let client: AssetSshTestClient | null = null
  let proxySocket: SshProxySocket | null = null
  try {
    const target = resolveAssetConnectionTarget(input)
    const ssh2 = getAssetConnectionSsh2Runtime()
    if (!ssh2) {
      return {
        ok: false,
        errorCode: 'ASSET_SSH_RUNTIME_UNAVAILABLE',
        errorMessage: 'ssh2 runtime is not available'
      }
    }

    const timeoutMs = assetConnectionTimeoutMs(input)
    const connectConfig: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000
    }
    if (target.password) connectConfig.password = target.password
    if (target.privateKey) connectConfig.privateKey = target.privateKey
    if (target.passphrase) connectConfig.passphrase = target.passphrase
    if (target.agent) connectConfig.agent = target.agent

    const runtimeConfig = getAssetConnectionRuntimeConfig()
    const proxy = await createSshProxySocketForAsset(
      { needProxy: Boolean(target.needProxy), proxyName: target.proxyName },
      runtimeConfig.sshProxyConfigs,
      target.host,
      target.port,
      { timeoutMs }
    )
    if (proxy) {
      proxySocket = proxy.socket
      connectConfig.sock = proxy.socket
      delete connectConfig.host
      delete connectConfig.port
    }

    client = new ssh2.Client()
    await connectAssetSshClient(client, connectConfig, timeoutMs)
    const durationMs = Math.max(0, assetConnectionNow() - start)
    return {
      ok: true,
      data: {
        assetId: target.assetId,
        endpoint: `${target.username}@${target.host}:${target.port}`,
        host: target.host,
        port: target.port,
        username: target.username,
        authType: target.authType,
        authSource: target.authSource,
        durationMs,
        ...(proxy ? { proxyName: proxy.config.name } : target.needProxy && target.proxyName ? { proxyName: target.proxyName } : {}),
        ...(target.agentKeyCount ? { agentKeyCount: target.agentKeyCount } : {})
      }
    }
  } catch (error) {
    if (error instanceof AssetConnectionTestError) {
      return { ok: false, errorCode: error.errorCode, errorMessage: error.message }
    }
    return {
      ok: false,
      errorCode: 'ASSET_SSH_CONNECT_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  } finally {
    try {
      client?.end()
    } catch {}
    try {
      proxySocket?.destroy()
    } catch {}
  }
}
export const deleteAsset = (id: string): AiopsMutationResult<{ id: string }> =>
  asResult(() => {
    assertUserEditableAsset(id)
    getStore().delete(id)
    return { id }
  })
export const renameAssetGroup = (input: AiopsAssetGroupRenameInput): AiopsMutationResult<AiopsAssetSnapshot> =>
  asResult(() => {
    const oldName = input.oldName.trim()
    const newName = input.newName.trim()
    if (!oldName || !newName) throw new Error('Asset group name is required')
    const store = getStore()
    const snapshot = store.list()
    let updated = 0
    snapshot.assets
      .filter((asset) => shouldIncludeAssetGroup(asset, input) && assetGroupName(asset) === oldName)
      .forEach((asset) => {
        assertUserEditableAsset(asset.id)
        store.save({ ...asset, group: newName, group_name: newName })
        updated += 1
      })
    if (!updated) throw new Error(`Asset group not found: ${oldName}`)
    return store.list()
  })
export const deleteAssetGroup = (input: AiopsAssetGroupDeleteInput): AiopsMutationResult<AiopsAssetSnapshot> =>
  asResult(() => {
    const name = input.name.trim()
    const fallbackName = (input.fallbackName || '未分组').trim() || '未分组'
    if (!name) throw new Error('Asset group name is required')
    const store = getStore()
    const snapshot = store.list()
    let updated = 0
    snapshot.assets
      .filter((asset) => shouldIncludeAssetGroup(asset, input) && assetGroupName(asset) === name)
      .forEach((asset) => {
        assertUserEditableAsset(asset.id)
        store.save({ ...asset, group: fallbackName, group_name: fallbackName })
        updated += 1
      })
    if (!updated) throw new Error(`Asset group not found: ${name}`)
    return store.list()
  })
export const refreshOrganizationAssets = (input: AiopsOrganizationAssetRefreshInput = {}): AiopsOrganizationAssetRefreshResult =>
  asResult(() => {
    const store = getStore()
    const snapshot = store.list()
    const organizations = snapshot.assets.filter(
      (asset) =>
        asset.asset_type === 'organization' &&
        (!input.organizationId || asset.id === input.organizationId || asset.uuid === input.organizationId)
    )
    if (input.organizationId && organizations.length === 0) {
      throw new Error(`Organization asset not found: ${input.organizationId}`)
    }
    let created = 0
    let updated = 0

    organizations.forEach((organization, index) => {
      const draft = refreshedAssetForOrganization(organization, index)
      const existing = store.getAsset(draft.id!)
      store.save(draft)
      if (existing) updated += 1
      else created += 1
    })

    return {
      ...store.list(),
      ...(input.organizationId && organizations[0] ? { organizationId: organizations[0].uuid || organizations[0].id } : {}),
      refreshed: created + updated,
      created,
      updated
    }
  })
export const previewAssetImport = async (input: AiopsAssetImportPreviewInput): Promise<AiopsAssetImportPreviewResult> => {
  try {
    const { filePath, fileName, drafts } = await readAssetImportDrafts(input)
    const snapshot = getStore().list()
    const assets = drafts.map((draft, index) => assetImportPreviewRecord(draft, index, snapshot.assets))
    return {
      ok: true,
      data: {
        filePath,
        fileName,
        assets,
        duplicateCount: assets.filter((asset) => asset.duplicateId).length
      }
    }
  } catch (error) {
    return assetImportErrorResult(error)
  }
}
export const confirmAssetImport = async (input: AiopsAssetImportConfirmInput): Promise<AiopsAssetImportConfirmResult> => {
  try {
    const { filePath, fileName, drafts } = await readAssetImportDrafts(input)
    const store = getStore()
    let imported = 0
    let skipped = 0
    let created = 0
    let updated = 0

    for (const draft of drafts) {
      const existing = findAssetImportDuplicate(store.list().assets, draft)
      if (existing && !input.overwrite) {
        skipped += 1
        continue
      }
      store.save(assetImportInput(draft, existing))
      imported += 1
      if (existing) updated += 1
      else created += 1
    }

    return {
      ok: true,
      data: {
        ...store.list(),
        imported,
        skipped,
        created,
        updated,
        filePath,
        fileName
      }
    }
  } catch (error) {
    return assetImportErrorResult(error)
  }
}
export const exportAssets = async (input: AiopsAssetExportInput, runtime: AssetExportRuntime): Promise<AiopsAssetExportResult> => {
  try {
    if (!runtime?.showSaveDialog) throw new AssetExportError('ASSET_EXPORT_SAVE_DIALOG_UNAVAILABLE', '导出保存对话框服务不可用。')
    const assets = resolveAssetExportSelection(input)
    const payload = assets.map(assetExportPayload)
    const fileName = assetExportFileName(runtime.now?.() || new Date())
    const saveResult = await runtime.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    })
    if (saveResult?.canceled || !saveResult?.filePath) {
      return {
        ok: true,
        data: {
          exported: 0,
          fileName,
          canceled: true
        }
      }
    }
    await (runtime.writeFile || writeFile)(saveResult.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return {
      ok: true,
      data: {
        exported: payload.length,
        fileName,
        filePath: saveResult.filePath
      }
    }
  } catch (error) {
    return assetExportErrorResult(error)
  }
}
export const listKeychains = (): AiopsKeychainRecord[] => getStore().listKeychains()
export const listSshAgentKeychainOptions = (): SshAgentKeychainOption[] =>
  listKeychains().filter((keychain) => keychain.hasPrivateKey).map(keychainToSshAgentOption)
export const getKeychain = (id: string): AiopsKeychainRecord | null => getStore().getKeychain(id)
export const saveKeychain = (input: AiopsKeychainInput): AiopsMutationResult<AiopsKeychainRecord> => asResult(() => getStore().saveKeychain(input))
export const deleteKeychain = (id: string): AiopsMutationResult<{ id: string }> =>
  asResult(() => {
    getStore().deleteKeychain(id)
    return { id }
  })
export const saveAssetFolder = (folder: AiopsCustomFolderSaveInput): AiopsMutationResult<AiopsCustomFolderRecord> => asResult(() => getStore().saveFolder(folder))
export const deleteAssetFolder = (uuid: string): AiopsMutationResult<{ uuid: string }> =>
  asResult(() => {
    getStore().deleteFolder(uuid)
    return { uuid }
  })
