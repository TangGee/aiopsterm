import { app } from 'electron'
import Store from 'electron-store'
import { createRequire } from 'module'
import { isAbsolute, join, resolve } from 'path'
import type {
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsKeychainRecord
} from '@shared/contracts/assets'
import { shouldUseAssetsSeedData } from '@shared/runtimeSwitches'
import {
  assetSecretNeedsEncryption,
  configureAssetCredentialRuntime,
  decryptAssetSecret,
  encryptAssetSecretForStorage,
  type AssetSecret
} from './assetsCredentialRuntime'
import {
  LOCAL_SHELL_ASSET_ID,
  assertFolderParent,
  assertUniqueKeychainName,
  assetGroupName,
  cloneFolder,
  defaultAssetKeychainSecrets,
  defaultAssetStoreShape,
  isUnmodifiedSeedAsset,
  isUnmodifiedSeedFolder,
  isUnmodifiedSeedKeychain,
  keychainToSshAgentOption,
  listAssetGroupsFromAssets,
  mergeAssetSecretInput,
  normalizeAssetInput,
  normalizeFolderInput,
  normalizeKeychainInput,
  normalizeKeychainSecret,
  sanitizeAsset,
  sanitizeKeychain,
  seedAssets,
  seedFolders,
  seedKeychains,
  seedKeychainSecrets,
  shouldIncludeAssetGroup,
  withLocalShellAsset,
  type AssetStoreShape
} from './assetsStoreDataRuntime'

export type { AssetSecret } from './assetsCredentialRuntime'
export {
  LOCAL_SHELL_ASSET_ID,
  assetGroupName,
  keychainToSshAgentOption,
  listAssetGroupsFromAssets,
  shouldIncludeAssetGroup
} from './assetsStoreDataRuntime'

const requireNative = createRequire(__filename)

export type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

export type AssetStoreRuntimeConfig = {
  databasePath?: string
  credentialKeyPath?: string
  useSeedData?: boolean
  forceFallbackStore?: boolean
  sqliteFactory?: new (path: string) => SqliteDatabase
}

export type AssetStore = {
  list(): AiopsAssetSnapshot
  getAsset(id: string): AiopsAssetRecord | null
  getSecret(id: string): AssetSecret
  listKeychains(): AiopsKeychainRecord[]
  getKeychain(id: string): AiopsKeychainRecord | null
  getKeychainSecret(id: string): AssetSecret
  saveKeychain(input: AiopsKeychainInput): AiopsKeychainRecord
  deleteKeychain(id: string): void
  save(input: AiopsAssetInput): AiopsAssetRecord
  delete(id: string): void
  saveFolder(folder: AiopsCustomFolderSaveInput): AiopsCustomFolderRecord
  deleteFolder(uuid: string): void
}

const defaultAssetSeedMode = shouldUseAssetsSeedData

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

type AssetRuntimeState = Required<Pick<AssetStoreRuntimeConfig, 'databasePath' | 'credentialKeyPath' | 'useSeedData' | 'forceFallbackStore'>> & {
  sqliteFactory?: new (path: string) => SqliteDatabase
}

let runtimeConfig: AssetRuntimeState = {
  databasePath: defaultAssetDatabasePath(),
  credentialKeyPath: defaultAssetCredentialKeyPath(),
  useSeedData: defaultAssetSeedMode(),
  forceFallbackStore: false
}

export const configureAssetStoreRuntime = (config: AssetStoreRuntimeConfig = {}) => {
  runtimeConfig = {
    databasePath: config.databasePath ? (isAbsolute(config.databasePath) ? config.databasePath : resolve(config.databasePath)) : defaultAssetDatabasePath(),
    credentialKeyPath: config.credentialKeyPath ? (isAbsolute(config.credentialKeyPath) ? config.credentialKeyPath : resolve(config.credentialKeyPath)) : defaultAssetCredentialKeyPath(),
    useSeedData: config.useSeedData ?? defaultAssetSeedMode(),
    forceFallbackStore: Boolean(config.forceFallbackStore),
    ...(config.sqliteFactory ? { sqliteFactory: config.sqliteFactory } : {})
  }
  assetStore = null
  configureAssetCredentialRuntime({ credentialKeyPath: runtimeConfig.credentialKeyPath })
}

configureAssetCredentialRuntime({ credentialKeyPath: runtimeConfig.credentialKeyPath })

class FallbackAssetStore {
  private store = new Store<AssetStoreShape>({
    projectName: 'aiopsterm',
    name: 'aiopsterm-assets',
    defaults: defaultAssetStoreShape(runtimeConfig.useSeedData)
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
    const secret = mergeAssetSecretInput(decryptAssetSecret(secrets[asset.id]), input)
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
    assertFolderParent(folders, normalized)
    const nextFolders = folders.some((item) => item.uuid === normalized.uuid)
      ? folders.map((item) => (item.uuid === normalized.uuid ? normalized : item))
      : [...folders, normalized]
    this.store.set('folders', nextFolders)
    return cloneFolder(normalized)
  }

  deleteFolder(uuid: string): void {
    this.store.set(
      'folders',
      (this.store.get('folders') || [])
        .filter((folder) => folder.uuid !== uuid)
        .map((folder) => (folder.parentUuid === uuid ? { ...folder, parentUuid: undefined } : folder))
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
          .run(keychain.id, JSON.stringify(keychain), JSON.stringify(encryptAssetSecretForStorage(defaultAssetKeychainSecrets[keychain.id] || {})))
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
    const secret = mergeAssetSecretInput(existingSecret, input)
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
    const folderRows = this.db.prepare('SELECT data FROM asset_folders').all() as Array<{ data: string }>
    const folders = folderRows.map((row) => JSON.parse(row.data) as AiopsCustomFolderRecord)
    assertFolderParent(folders, normalized)
    this.db.prepare('INSERT INTO asset_folders (uuid, data) VALUES (?, ?) ON CONFLICT(uuid) DO UPDATE SET data = excluded.data').run(normalized.uuid, JSON.stringify(normalized))
    return cloneFolder(normalized)
  }

  deleteFolder(uuid: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM asset_folders WHERE uuid = ?').run(uuid)
      const folderRows = this.db.prepare('SELECT uuid, data FROM asset_folders').all()
      for (const row of folderRows) {
        const data = row as { uuid: string; data: string }
        const folder = JSON.parse(data.data) as AiopsCustomFolderRecord
        if (folder.parentUuid !== uuid) continue
        const next = { ...folder, parentUuid: undefined }
        this.db.prepare('UPDATE asset_folders SET data = ? WHERE uuid = ?').run(JSON.stringify(next), data.uuid)
      }
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

let assetStore: AssetStore | null = null

const createStore = (): AssetStore => {
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

export const getAssetStore = (): AssetStore => {
  if (!assetStore) assetStore = createStore()
  return assetStore
}
