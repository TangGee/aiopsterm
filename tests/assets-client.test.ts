import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetsClient } from '@/services/assets/assetsClient'
import type {
  AiopsAssetGroupRecord,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord,
  AiopsKeychainRecord,
  AiopsSshTunnelRecord
} from '@shared/contracts/assets'

const originalAiops = window.aiops

const asset: AiopsAssetRecord = {
  id: 'asset-1',
  uuid: 'asset-1',
  name: 'Production',
  title: 'Production',
  host: '127.0.0.1',
  ip: '127.0.0.1',
  group: 'Default',
  group_name: 'Default',
  status: 'online',
  tags: [],
  username: 'ops',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  hasPassword: true
}

const folder: AiopsCustomFolderRecord = {
  uuid: 'folder-1',
  name: 'Production',
  description: '',
  scope: 'direct'
}

const snapshot: AiopsAssetSnapshot = {
  assets: [asset],
  folders: [folder]
}

const group: AiopsAssetGroupRecord = {
  key: 'Default',
  name: 'Default',
  count: 1
}

const keychain: AiopsKeychainRecord = {
  id: 'key-1',
  name: 'prod-ed25519',
  type: 'ed25519',
  publicKey: 'ssh-ed25519 AAAA',
  hasPrivateKey: true,
  createdAt: 1781884800000,
  updatedAt: 1781884800000
}

const tunnel: AiopsSshTunnelRecord = {
  assetId: asset.id,
  tunnelId: 'tunnel-1',
  type: 'local_forward',
  state: 'active',
  localPort: 15432,
  remoteHost: '127.0.0.1',
  remotePort: 5432
}

const sshAgentKeychainOptions = [
  {
    key: 'agent-key-1',
    label: 'prod-ed25519',
    fingerprint: 'SHA256:prod',
    keyType: 'ED25519'
  }
]

afterEach(() => {
  window.aiops = originalAiops
})

describe('assetsClient', () => {
  it('returns undefined for unavailable bridge methods and binds Assets bridge methods', async () => {
    window.aiops = {
      ...originalAiops,
      listAssets: vi.fn(async () => snapshot),
      listAssetGroups: vi.fn(async () => [group]),
      renameAssetGroup: vi.fn(async () => ({ ok: true, data: snapshot })),
      deleteAssetGroup: vi.fn(async () => ({ ok: true, data: snapshot })),
      saveAsset: vi.fn(async () => ({ ok: true, data: asset })),
      getAssetEditableSecret: vi.fn(async () => ({ ok: true, data: { assetId: asset.id, password: 'unit-pw' } })),
      testAssetConnection: vi.fn(async () => ({
        ok: true,
        data: {
          assetId: asset.id,
          endpoint: `${asset.host}:${asset.port}`,
          host: asset.host,
          port: asset.port,
          username: asset.username,
          authType: asset.auth_type,
          authSource: 'password' as const,
          durationMs: 12
        }
      })),
      deleteAsset: vi.fn(async () => ({ ok: true, data: { id: asset.id } })),
      refreshOrganizationAssets: vi.fn(async () => ({ ok: true, data: { ...snapshot, organizationId: 'org-1', refreshed: 1, created: 0, updated: 1 } })),
      previewAssetImport: vi.fn(async () => ({
        ok: true,
        data: {
          filePath: '/tmp/assets.json',
          fileName: 'assets.json',
          assets: [
            {
              previewId: 'preview-1',
              title: asset.title,
              host: asset.host,
              username: asset.username,
              group: asset.group_name,
              port: asset.port,
              auth_type: asset.auth_type,
              asset_type: asset.asset_type,
              comment: asset.comment
            }
          ],
          duplicateCount: 0
        }
      })),
      confirmAssetImport: vi.fn(async () => ({ ok: true, data: { ...snapshot, imported: 1, skipped: 0, created: 1, updated: 0, filePath: '/tmp/assets.json', fileName: 'assets.json' } })),
      exportAssets: vi.fn(async () => ({ ok: true, data: { exported: 1, fileName: 'assets.json', bytes: 24 } })),
      startSshTunnel: vi.fn(async () => ({ ok: true, data: { ...snapshot, tunnel, message: 'started' } })),
      stopSshTunnel: vi.fn(async () => ({ ok: true, data: { ...snapshot, tunnel: { ...tunnel, state: 'created' as const }, message: 'stopped' } })),
      saveAssetFolder: vi.fn(async () => ({ ok: true, data: folder })),
      deleteAssetFolder: vi.fn(async () => ({ ok: true, data: { uuid: folder.uuid } })),
      listKeychains: vi.fn(async () => [keychain]),
      listSshAgentKeychainOptions: vi.fn(async () => sshAgentKeychainOptions),
      getKeychain: vi.fn(async () => keychain),
      saveKeychain: vi.fn(async () => ({ ok: true, data: keychain })),
      deleteKeychain: vi.fn(async () => ({ ok: true, data: { id: keychain.id } }))
    }

    await expect(assetsClient.listAssets()?.()).resolves.toEqual(snapshot)
    await expect(assetsClient.listAssetGroups()?.({ assetTypes: ['person'] })).resolves.toEqual([group])
    await expect(assetsClient.renameAssetGroup()?.({ oldName: 'Default', newName: 'Prod' })).resolves.toEqual({ ok: true, data: snapshot })
    await expect(assetsClient.deleteAssetGroup()?.({ name: 'Default' })).resolves.toEqual({ ok: true, data: snapshot })
    await expect(assetsClient.saveAsset()?.({ name: 'Production', host: '127.0.0.1' })).resolves.toEqual({ ok: true, data: asset })
    await expect(assetsClient.getAssetEditableSecret()?.(asset.id)).resolves.toEqual({ ok: true, data: { assetId: asset.id, password: 'unit-pw' } })
    await expect(assetsClient.testAssetConnection()?.({ assetId: asset.id })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(assetsClient.deleteAsset()?.(asset.id)).resolves.toEqual({ ok: true, data: { id: asset.id } })
    await expect(assetsClient.refreshOrganizationAssets()?.({ organizationId: 'org-1' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(assetsClient.previewAssetImport()?.({ filePath: '/tmp/assets.json' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(assetsClient.confirmAssetImport()?.({ filePath: '/tmp/assets.json' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(assetsClient.exportAssets()?.({ assetIds: [asset.id] })).resolves.toEqual({ ok: true, data: { exported: 1, fileName: 'assets.json', bytes: 24 } })
    await expect(assetsClient.startSshTunnel()?.({ assetId: asset.id })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(assetsClient.stopSshTunnel()?.({ assetId: asset.id, tunnelId: tunnel.tunnelId })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(assetsClient.saveAssetFolder()?.({ name: folder.name, scope: 'direct' })).resolves.toEqual({ ok: true, data: folder })
    await expect(assetsClient.deleteAssetFolder()?.(folder.uuid)).resolves.toEqual({ ok: true, data: { uuid: folder.uuid } })
    await expect(assetsClient.listKeychains()?.()).resolves.toEqual([keychain])
    await expect(assetsClient.listSshAgentKeychainOptions()?.()).resolves.toEqual(sshAgentKeychainOptions)
    await expect(assetsClient.getKeychain()?.(keychain.id)).resolves.toEqual(keychain)
    await expect(assetsClient.saveKeychain()?.({ name: keychain.name })).resolves.toEqual({ ok: true, data: keychain })
    await expect(assetsClient.deleteKeychain()?.(keychain.id)).resolves.toEqual({ ok: true, data: { id: keychain.id } })

    expect(window.aiops.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person'] })
    expect(window.aiops.saveAsset).toHaveBeenCalledWith({ name: 'Production', host: '127.0.0.1' })
    expect(window.aiops.startSshTunnel).toHaveBeenCalledWith({ assetId: asset.id })
    expect(window.aiops.deleteKeychain).toHaveBeenCalledWith(keychain.id)

    window.aiops = {
      ...originalAiops,
      listAssets: undefined as any,
      listAssetGroups: undefined as any,
      renameAssetGroup: undefined as any,
      deleteAssetGroup: undefined as any,
      saveAsset: undefined as any,
      getAssetEditableSecret: undefined as any,
      testAssetConnection: undefined as any,
      deleteAsset: undefined as any,
      refreshOrganizationAssets: undefined as any,
      previewAssetImport: undefined as any,
      confirmAssetImport: undefined as any,
      exportAssets: undefined as any,
      startSshTunnel: undefined as any,
      stopSshTunnel: undefined as any,
      saveAssetFolder: undefined as any,
      deleteAssetFolder: undefined as any,
      listKeychains: undefined as any,
      listSshAgentKeychainOptions: undefined as any,
      getKeychain: undefined as any,
      saveKeychain: undefined as any,
      deleteKeychain: undefined as any
    }
    expect(assetsClient.listAssets()).toBeUndefined()
    expect(assetsClient.listAssetGroups()).toBeUndefined()
    expect(assetsClient.renameAssetGroup()).toBeUndefined()
    expect(assetsClient.deleteAssetGroup()).toBeUndefined()
    expect(assetsClient.saveAsset()).toBeUndefined()
    expect(assetsClient.getAssetEditableSecret()).toBeUndefined()
    expect(assetsClient.testAssetConnection()).toBeUndefined()
    expect(assetsClient.deleteAsset()).toBeUndefined()
    expect(assetsClient.refreshOrganizationAssets()).toBeUndefined()
    expect(assetsClient.previewAssetImport()).toBeUndefined()
    expect(assetsClient.confirmAssetImport()).toBeUndefined()
    expect(assetsClient.exportAssets()).toBeUndefined()
    expect(assetsClient.startSshTunnel()).toBeUndefined()
    expect(assetsClient.stopSshTunnel()).toBeUndefined()
    expect(assetsClient.saveAssetFolder()).toBeUndefined()
    expect(assetsClient.deleteAssetFolder()).toBeUndefined()
    expect(assetsClient.listKeychains()).toBeUndefined()
    expect(assetsClient.listSshAgentKeychainOptions()).toBeUndefined()
    expect(assetsClient.getKeychain()).toBeUndefined()
    expect(assetsClient.saveKeychain()).toBeUndefined()
    expect(assetsClient.deleteKeychain()).toBeUndefined()
  })
})
