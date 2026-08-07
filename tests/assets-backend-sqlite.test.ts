import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'

const electronSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plain: string) => Buffer.from(plain, 'utf-8')),
  decryptString: vi.fn((cipher: Buffer) => cipher.toString('utf-8'))
}))

const requireNative = createRequire(__filename)
const Database = requireNative('better-sqlite3')

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-assets-sqlite-test'
  },
  safeStorage: electronSafeStorage
}))

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/assets/assets'
  return import(modulePath)
}

const withAssetDatabase = async <T>(run: (databasePath: string) => Promise<T>) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-assets-sqlite-'))
  try {
    return await run(join(dir, 'assets.db'))
  } finally {
    const modulePath = '../src/main/backend/assets/assets'
    const backend = await import(modulePath)
    backend.configureAssetBackendRuntime({ forceFallbackStore: true })
    await rm(dir, { recursive: true, force: true })
  }
}

const readSqliteStorageArtifacts = async (databasePath: string) => {
  const artifacts = await Promise.all(
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map(async (path) => {
      try {
        return await readFile(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0)
        throw error
      }
    })
  )
  return Buffer.concat(artifacts).toString('utf-8')
}

describe('assets sqlite backend seed boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    electronSafeStorage.decryptString.mockClear()
  })

  it('starts non-seed SQLite asset runtime with only the local shell system asset', async () => {
    await withAssetDatabase(async (databasePath) => {
      const backend = await loadBackend()
      backend.configureAssetBackendRuntime({ databasePath, useSeedData: false, sqliteFactory: Database })

      const snapshot = backend.listAssets()

      expect(snapshot.assets).toHaveLength(1)
      expect(snapshot.assets[0]).toEqual(expect.objectContaining({ id: 'local-127-1', isLocalShell: true }))
      expect(snapshot.folders).toEqual([])
      expect(backend.listSshAgentKeychainOptions()).toEqual([])
    })
  })

  it('strips unmodified legacy SQLite seed assets in non-seed runtime while preserving user edits', async () => {
    await withAssetDatabase(async (databasePath) => {
      const backend = await loadBackend()
      backend.configureAssetBackendRuntime({ databasePath, useSeedData: true, sqliteFactory: Database })
      expect(backend.listAssets().assets.some((asset: { id: string }) => asset.id === 'asset-1')).toBe(true)
      const edited = backend.saveAsset({
        id: 'asset-1',
        name: 'sqlite-user-prod',
        title: 'sqlite-user-prod',
        host: '10.24.8.12',
        username: 'ops',
        port: 22,
        asset_type: 'person',
        auth_type: 'keyBased',
        group: '生产',
        group_name: '生产',
        tags: ['linux', 'prod'],
        keychainId: 'key-1',
        folderUuid: 'custom-folder-a'
      })
      expect(edited.ok).toBe(true)

      backend.configureAssetBackendRuntime({ databasePath, useSeedData: false, sqliteFactory: Database })
      const snapshot = backend.listAssets()

      expect(snapshot.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'local-127-1', isLocalShell: true }),
          expect.objectContaining({ id: 'asset-1', title: 'sqlite-user-prod' })
        ])
      )
      expect(snapshot.assets.some((asset: { id: string }) => ['asset-2', 'asset-3', 'asset-4', 'asset-5'].includes(asset.id))).toBe(false)
      expect(snapshot.folders).toContainEqual(expect.objectContaining({ uuid: 'custom-folder-a' }))
      expect(backend.listSshAgentKeychainOptions()).toContainEqual(expect.objectContaining({ key: 'key-1' }))
      expect(backend.listSshAgentKeychainOptions().some((option: { key: string }) => option.key === 'key-2')).toBe(false)
    })
  })

  it('stores asset and keychain secrets encrypted while resolving plaintext only inside the backend', async () => {
    await withAssetDatabase(async (databasePath) => {
      const credentialKeyPath = join(databasePath, '..', 'asset-credential.key')
      const backend = await loadBackend()
      backend.configureAssetBackendRuntime({ databasePath, credentialKeyPath, useSeedData: false, sqliteFactory: Database })

      const savedAsset = backend.saveAsset({
        name: 'encrypted-secret-host',
        title: 'encrypted-secret-host',
        host: '10.77.1.7',
        username: 'ops',
        port: 22,
        asset_type: 'person',
        auth_type: 'password',
        group: '测试',
        group_name: '测试',
        tags: ['manual'],
        password: 'plain-ssh-password'
      })
      const savedKeychain = backend.saveKeychain({
        name: 'encrypted-keychain',
        type: 'ed25519',
        publicKey: 'ssh-ed25519 AAAA encrypted',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-private-key-material\n-----END OPENSSH PRIVATE KEY-----',
        passphrase: 'plain-passphrase'
      })
      const savedJumpserver = backend.saveAsset({
        name: 'jumpserver-encrypted',
        title: 'jumpserver-encrypted',
        host: 'jumpserver.example.com',
        username: 'api-user',
        port: 22,
        asset_type: 'organization',
        auth_type: 'password',
        group: '企业',
        group_name: '企业',
        tags: ['jumpserver'],
        bastionType: 'jumpserver',
        jumpserverApiUrl: 'https://jumpserver.example.com',
        jumpserverToken: 'plain-jumpserver-token'
      })

      expect(savedAsset.ok).toBe(true)
      expect(savedAsset.data).toEqual(expect.objectContaining({ hasPassword: true }))
      expect(savedAsset.data).toEqual(expect.not.objectContaining({ password: 'plain-ssh-password' }))
      expect(savedKeychain.ok).toBe(true)
      expect(savedKeychain.data).toEqual(expect.objectContaining({ hasPrivateKey: true }))
      expect(savedJumpserver.data).toEqual(expect.objectContaining({ hasJumpserverToken: true }))

      const rawText = await readSqliteStorageArtifacts(databasePath)
      expect(rawText).not.toContain('plain-ssh-password')
      expect(rawText).not.toContain('secret-private-key-material')
      expect(rawText).not.toContain('plain-passphrase')
      expect(rawText).not.toContain('plain-jumpserver-token')
      expect(rawText).toContain('ak1:')

      expect(backend.getAssetSecret(savedAsset.data!.id)).toEqual(expect.objectContaining({ password: 'plain-ssh-password' }))
      expect(backend.getAssetSecret(savedJumpserver.data!.id)).toEqual(expect.objectContaining({ jumpserverToken: 'plain-jumpserver-token' }))
      expect(backend.getKeychainSecret(savedKeychain.data!.id)).toEqual(
        expect.objectContaining({
          privateKey: expect.stringContaining('secret-private-key-material'),
          passphrase: 'plain-passphrase'
        })
      )
      expect(await readFile(credentialKeyPath)).toHaveLength(32)

      const clearedAsset = backend.saveAsset({
        id: savedAsset.data!.id,
        name: 'encrypted-secret-host',
        title: 'encrypted-secret-host',
        host: '10.77.1.7',
        username: 'ops',
        port: 22,
        asset_type: 'person',
        auth_type: 'password',
        group: '测试',
        group_name: '测试',
        tags: ['manual'],
        password: ''
      })
      expect(clearedAsset.ok).toBe(true)
      expect(clearedAsset.data).toEqual(expect.objectContaining({ hasPassword: false }))
      expect(backend.getAssetSecret(savedAsset.data!.id)).toEqual({})
    })
  })

  it('lists historical system-encrypted assets and keychains without decrypting until detail access', async () => {
    await withAssetDatabase(async (databasePath) => {
      const db = new Database(databasePath)
      db.exec(`
        CREATE TABLE assets (id TEXT PRIMARY KEY, data TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE asset_folders (uuid TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE asset_keychains (id TEXT PRIMARY KEY, data TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '{}');
      `)
      db.prepare('INSERT INTO assets (id, data, secret) VALUES (?, ?, ?)').run(
        'lazy-system-secret-host',
        JSON.stringify({
          id: 'lazy-system-secret-host',
          uuid: 'lazy-system-secret-host',
          name: 'lazy-system-secret-host',
          title: 'lazy-system-secret-host',
          host: '10.77.1.9',
          ip: '10.77.1.9',
          group: 'test',
          group_name: 'test',
          status: 'online',
          tags: [],
          username: 'ops',
          port: 22,
          asset_type: 'person',
          auth_type: 'password',
          data_source: 'manual'
        }),
        JSON.stringify({ password: `as1:${Buffer.from('lazy-system-password').toString('base64')}` })
      )
      db.prepare('INSERT INTO asset_keychains (id, data, secret) VALUES (?, ?, ?)').run(
        'lazy-system-keychain',
        JSON.stringify({
          id: 'lazy-system-keychain',
          name: 'lazy-system-keychain',
          type: 'ed25519',
          publicKey: '',
          createdAt: 1717200000000,
          updatedAt: 1717200000000
        }),
        JSON.stringify({ privateKey: `as1:${Buffer.from('lazy-system-private-key').toString('base64')}` })
      )
      db.close()

      const backend = await loadBackend()
      backend.configureAssetBackendRuntime({
        databasePath,
        useSeedData: false,
        sqliteFactory: Database,
        credentialStorageBackend: 'system',
        safeStorage: electronSafeStorage
      })

      expect(backend.listAssets().assets).toContainEqual(expect.objectContaining({ id: 'lazy-system-secret-host', hasPassword: true }))
      expect(backend.listKeychains()).toContainEqual(expect.objectContaining({ id: 'lazy-system-keychain', hasPrivateKey: true }))
      expect(backend.listSshAgentKeychainOptions()).toContainEqual(expect.objectContaining({ key: 'lazy-system-keychain' }))
      expect(electronSafeStorage.decryptString).not.toHaveBeenCalled()

      expect(backend.getAssetSecret('lazy-system-secret-host')).toEqual({ password: 'lazy-system-password' })
      expect(electronSafeStorage.decryptString).toHaveBeenCalledTimes(1)
      expect(backend.getKeychainSecret('lazy-system-keychain')).toEqual({ privateKey: 'lazy-system-private-key' })
      expect(electronSafeStorage.decryptString).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps direct and bastion custom folder trees isolated in SQLite storage', async () => {
    await withAssetDatabase(async (databasePath) => {
      const backend = await loadBackend()
      backend.configureAssetBackendRuntime({ databasePath, useSeedData: false, sqliteFactory: Database })

      const directRoot = backend.saveAssetFolder({ name: '业务目录', description: 'direct root', scope: 'direct' })
      const bastionRoot = backend.saveAssetFolder({ name: '业务目录', description: 'bastion root', scope: 'bastion' })

      expect(directRoot.ok).toBe(true)
      expect(bastionRoot.ok).toBe(true)
      expect(directRoot.data?.uuid).not.toBe(bastionRoot.data?.uuid)
      expect(backend.saveAssetFolder({ name: '直连子目录', scope: 'direct', parentUuid: directRoot.data!.uuid }).ok).toBe(true)
      expect(backend.saveAssetFolder({ name: '堡垒机子目录', scope: 'bastion', parentUuid: bastionRoot.data!.uuid }).ok).toBe(true)

      const bastionUnderDirect = backend.saveAssetFolder({ name: '错误堡垒机子目录', scope: 'bastion', parentUuid: directRoot.data!.uuid })
      const directUnderBastion = backend.saveAssetFolder({ name: '错误直连子目录', scope: 'direct', parentUuid: bastionRoot.data!.uuid })

      expect(bastionUnderDirect.ok).toBe(false)
      expect(bastionUnderDirect.errorMessage).toContain('Folder parent scope mismatch')
      expect(directUnderBastion.ok).toBe(false)
      expect(directUnderBastion.errorMessage).toContain('Folder parent scope mismatch')
    })
  })

  it('migrates legacy plaintext SQLite secrets to encrypted storage on startup', async () => {
    await withAssetDatabase(async (databasePath) => {
      const credentialKeyPath = join(databasePath, '..', 'asset-credential.key')
      const db = new Database(databasePath)
      db.exec(`
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
      db.prepare('INSERT INTO assets (id, data, secret) VALUES (?, ?, ?)').run(
        'legacy-secret-host',
        JSON.stringify({
          id: 'legacy-secret-host',
          uuid: 'legacy-secret-host',
          name: 'legacy-secret-host',
          title: 'legacy-secret-host',
          host: '10.77.1.8',
          ip: '10.77.1.8',
          group: '测试',
          group_name: '测试',
          status: 'online',
          tags: ['legacy'],
          username: 'ops',
          port: 22,
          asset_type: 'person',
          auth_type: 'password',
          data_source: 'manual',
          hasPassword: true
        }),
        JSON.stringify({ password: 'legacy-plain-password' })
      )
      db.prepare('INSERT INTO asset_keychains (id, data, secret) VALUES (?, ?, ?)').run(
        'legacy-keychain',
        JSON.stringify({
          id: 'legacy-keychain',
          name: 'legacy-keychain',
          type: 'rsa',
          publicKey: '',
          hasPrivateKey: true,
          createdAt: 1717200000000,
          updatedAt: 1717200000000
        }),
        JSON.stringify({
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nlegacy-private-key-material\n-----END RSA PRIVATE KEY-----',
          passphrase: 'legacy-passphrase'
        })
      )
      db.close()

      const backend = await loadBackend()
      backend.configureAssetBackendRuntime({ databasePath, credentialKeyPath, useSeedData: false, sqliteFactory: Database })

      expect(backend.getAssetSecret('legacy-secret-host')).toEqual({ password: 'legacy-plain-password' })
      expect(backend.getKeychainSecret('legacy-keychain')).toEqual(
        expect.objectContaining({
          privateKey: expect.stringContaining('legacy-private-key-material'),
          passphrase: 'legacy-passphrase'
        })
      )

      const rawText = await readSqliteStorageArtifacts(databasePath)
      expect(rawText).not.toContain('legacy-plain-password')
      expect(rawText).not.toContain('legacy-private-key-material')
      expect(rawText).not.toContain('legacy-passphrase')
      expect(rawText).toContain('ak1:')
    })
  })
})
