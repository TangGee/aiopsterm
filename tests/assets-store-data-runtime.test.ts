import { describe, expect, it } from 'vitest'
import type { AiopsAssetRecord, AiopsCustomFolderRecord, AiopsKeychainRecord } from '../src/shared/contracts/assets'
import {
  LOCAL_SHELL_ASSET_ID,
  assertFolderParent,
  assertUniqueKeychainName,
  assetGroupName,
  defaultAssetKeychainSecrets,
  defaultAssetStoreShape,
  detectKeyType,
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
  seedKeychainSecrets,
  seedKeychains,
  withLocalShellAsset
} from '@shared/assetsStoreDataRuntime'

const assetInput = {
  name: 'prod-host',
  host: '10.0.0.8'
}

describe('assets store data runtime', () => {
  it('owns seed/default shape cloning without runtime storage dependencies', () => {
    const seeded = defaultAssetStoreShape(true)
    const seedless = defaultAssetStoreShape(false)
    const secrets = seedKeychainSecrets()

    expect(seeded.assets.map((asset) => asset.id)).toEqual(seedAssets().map((asset) => asset.id))
    expect(seeded.assets.some((asset) => asset.id === LOCAL_SHELL_ASSET_ID)).toBe(false)
    expect(seedless).toEqual({ assets: [], folders: [], secrets: {}, keychains: [], keychainSecrets: {} })
    expect(withLocalShellAsset(seedAssets())[0]).toEqual(expect.objectContaining({ id: LOCAL_SHELL_ASSET_ID, isLocalShell: true }))

    seeded.assets[0].tags.push('mutated')
    expect(seedAssets()[0].tags).not.toContain('mutated')
    secrets['key-1'].privateKey = 'pk'
    expect(defaultAssetKeychainSecrets['key-1'].privateKey).not.toBe('pk')
  })

  it('normalizes assets and explicit secret edits without leaking persistence concerns', () => {
    const existing = normalizeAssetInput({
      id: 'asset-existing',
      name: 'existing',
      host: '10.0.0.7',
      username: 'ops',
      port: 2200,
      group: 'Production',
      tags: ['linux'],
      password: 'pw',
      privateKey: 'pk',
      passphrase: 'pp'
    })
    const updated = normalizeAssetInput(
      {
        id: 'asset-existing',
        name: 'renamed',
        host: '10.0.0.9',
        folderUuid: '',
        keychainId: '',
        tags: []
      },
      existing
    )

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'asset-existing',
        uuid: existing.uuid,
        title: 'renamed',
        username: 'ops',
        port: 2200,
        group: 'Production',
        hasPassword: true,
        hasPrivateKey: true,
        folderUuid: '',
        keychainId: ''
      })
    )
    expect(normalizeAssetInput(assetInput)).toEqual(
      expect.objectContaining({
        title: 'prod-host',
        ip: '10.0.0.8',
        group: '未分组',
        username: 'root',
        port: 22,
        asset_type: 'person',
        auth_type: 'password',
        data_source: 'manual'
      })
    )
    expect(mergeAssetSecretInput({ password: 'pw', privateKey: 'pk', passphrase: 'pp' }, { ...assetInput, password: '', privateKey: '', passphrase: '' })).toEqual({})
  })

  it('keeps folder tree rules pure and scope-aware', () => {
    const root = normalizeFolderInput({ name: 'Direct', scope: 'direct' })
    const child = normalizeFolderInput({ name: 'Child', scope: 'direct', parentUuid: root.uuid })
    const bastionChild = normalizeFolderInput({ name: 'Bastion Child', scope: 'bastion', parentUuid: root.uuid })

    expect(root).toEqual(expect.objectContaining({ name: 'Direct', description: '', scope: 'direct' }))
    expect(() => assertFolderParent([root], child)).not.toThrow()
    expect(() => assertFolderParent([root], bastionChild)).toThrow('Folder parent scope mismatch')
    expect(() => assertFolderParent([], child)).toThrow('Parent folder not found')
    expect(() => assertFolderParent([], { ...root, parentUuid: root.uuid })).toThrow('Folder cannot be its own parent')

    const folders: AiopsCustomFolderRecord[] = [
      { uuid: 'root', name: 'Root', description: '', scope: 'direct' },
      { uuid: 'parent', name: 'Parent', description: '', parentUuid: 'child', scope: 'direct' }
    ]
    expect(() => assertFolderParent(folders, { uuid: 'child', name: 'Child', description: '', parentUuid: 'parent', scope: 'direct' })).toThrow('Folder parent cycle detected')
  })

  it('normalizes keychains, key secrets, uniqueness, and SSH agent projection', () => {
    const existing: AiopsKeychainRecord = {
      id: 'key-existing',
      name: 'existing-key',
      type: 'rsa',
      publicKey: '',
      hasPrivateKey: true,
      createdAt: 1,
      updatedAt: 1
    }
    const normalized = normalizeKeychainInput({ id: 'key-existing', name: ' renamed ', publicKey: 'ssh-ed25519 AAAA demo' }, existing)

    expect(detectKeyType('', 'ssh-rsa AAAA demo')).toBe('rsa')
    expect(detectKeyType('ssh-ed25519 body', '')).toBe('ed25519')
    expect(normalized).toEqual(expect.objectContaining({ id: 'key-existing', name: 'renamed', type: 'ed25519', createdAt: 1, hasPrivateKey: true }))
    expect(normalizeKeychainSecret({ name: 'renamed' }, { privateKey: ' pk ', passphrase: 'pp' })).toEqual({ privateKey: 'pk', passphrase: 'pp' })
    expect(() => normalizeKeychainSecret({ name: 'empty' })).toThrow('Private key is required')
    expect(() => assertUniqueKeychainName([existing], { ...existing, id: 'key-new' })).toThrow('Keychain already exists')
    expect(keychainToSshAgentOption(normalized)).toEqual(expect.objectContaining({ key: 'key-existing', label: 'renamed', keyType: 'ED25519' }))
  })

  it('identifies unmodified seed rows and keeps edited seed rows as user-owned data', () => {
    const seedAsset = seedAssets()[0]
    const seedFolder = seedFolders()[0]
    const seedKeychain = seedKeychains()[0]

    expect(isUnmodifiedSeedAsset(seedAsset)).toBe(true)
    expect(isUnmodifiedSeedAsset({ ...seedAsset, title: 'edited' })).toBe(false)
    expect(isUnmodifiedSeedFolder(seedFolder)).toBe(true)
    expect(isUnmodifiedSeedFolder({ ...seedFolder, description: 'edited' })).toBe(false)
    expect(isUnmodifiedSeedKeychain(seedKeychain, defaultAssetKeychainSecrets[seedKeychain.id])).toBe(true)
    expect(isUnmodifiedSeedKeychain({ ...seedKeychain, name: 'edited' }, defaultAssetKeychainSecrets[seedKeychain.id])).toBe(false)
  })

  it('sanitizes secrets and derives visible asset groups', () => {
    const assets: AiopsAssetRecord[] = [
      normalizeAssetInput({ ...assetInput, id: 'asset-one', group: 'Hosts', asset_type: 'person' }),
      normalizeAssetInput({ ...assetInput, id: 'asset-two', name: 'db', group: 'DB', asset_type: 'person' }),
      normalizeAssetInput({ ...assetInput, id: 'asset-org', name: 'org', group: 'Org', asset_type: 'organization' }),
      { ...normalizeAssetInput({ ...assetInput, id: 'asset-local', group: 'Local' }), isLocalShell: true }
    ]

    expect(sanitizeAsset(assets[0], { password: 'pw' })).toEqual(expect.objectContaining({ hasPassword: true }))
    expect(sanitizeKeychain(seedKeychains()[0], { privateKey: 'pk', passphrase: 'pp' }, true)).toEqual(expect.objectContaining({ hasPrivateKey: true, privateKey: 'pk', passphrase: 'pp' }))
    expect(assetGroupName(assets[0])).toBe('未分组')
    const groups = listAssetGroupsFromAssets(assets, { assetTypes: ['person'] })
    const expectedGroups = [
      { key: 'group-DB', name: 'DB', count: 1 },
      { key: 'group-未分组', name: '未分组', count: 1 }
    ].sort((first, second) => first.name.localeCompare(second.name))
    expect(groups).toEqual(expectedGroups)
  })
})
