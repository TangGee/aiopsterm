import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-assets-test'
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { defaults?: T }) {
      this.store = JSON.parse(JSON.stringify(options?.defaults || {}))
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store asset backend in tests')
})

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/assets'
  return import(modulePath)
}

describe('assets backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('owns the local shell system asset and protects it from asset mutations', async () => {
    const backend = await loadBackend()
    const snapshot = backend.listAssets()

    expect(snapshot.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-127-1',
          host: '127.0.0.1',
          group_name: '本地连接',
          isLocalShell: true
        })
      ])
    )

    const saved = backend.saveAsset({
      id: 'local-127-1',
      name: 'client-local-overwrite',
      title: 'client-local-overwrite',
      host: '127.0.0.1',
      username: 'local',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '本地连接',
      group_name: '本地连接',
      tags: ['local']
    })
    const deleted = backend.deleteAsset('local-127-1')

    expect(saved.ok).toBe(false)
    expect(saved.errorMessage).toContain('系统资产')
    expect(deleted.ok).toBe(false)
    expect(deleted.errorMessage).toContain('系统资产')
    expect(backend.listAssets().assets.find((asset: { id: string }) => asset.id === 'local-127-1')).toEqual(
      expect.objectContaining({ name: '127.0.0.1', isLocalShell: true })
    )
  })

  it('owns asset id generation when saving new assets', async () => {
    const backend = await loadBackend()
    const saved = backend.saveAsset({
      name: 'backend-owned-host',
      title: 'backend-owned-host',
      host: '10.77.1.5',
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['manual']
    })

    expect(saved.ok).toBe(true)
    expect(saved.data?.id).toMatch(/^asset-/)
    expect(saved.data?.id).not.toMatch(/^asset-local-|^managed-local-|^asset-import-/)
    expect(backend.listAssets().assets.some((asset: { id: string }) => asset.id === saved.data?.id)).toBe(true)
  })

  it('normalizes optional asset username behind the backend boundary', async () => {
    const backend = await loadBackend()
    const saved = backend.saveAsset({
      name: 'backend-default-user-host',
      title: 'backend-default-user-host',
      host: '10.77.1.6',
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['manual']
    })

    expect(saved.ok).toBe(true)
    expect(saved.data).toEqual(expect.objectContaining({ username: 'root', port: 22 }))
  })

  it('owns custom folder uuid generation and only updates existing folders by uuid', async () => {
    const backend = await loadBackend()
    const created = backend.saveAssetFolder({ name: '后端文件夹', description: 'backend-owned folder' })

    expect(created.ok).toBe(true)
    expect(created.data?.uuid).toMatch(/^folder-/)
    expect(backend.listAssets().folders).toContainEqual(expect.objectContaining({ uuid: created.data?.uuid, name: '后端文件夹' }))

    const updated = backend.saveAssetFolder({ uuid: created.data!.uuid, name: '后端归档', description: 'updated' })
    expect(updated.ok).toBe(true)
    expect(updated.data).toMatchObject({ uuid: created.data!.uuid, name: '后端归档', description: 'updated' })

    const ignoredClientUuid = backend.saveAssetFolder({ uuid: 'custom-folder-client-draft', name: '客户端草稿', description: 'client draft' })
    expect(ignoredClientUuid.ok).toBe(true)
    expect(ignoredClientUuid.data?.uuid).toMatch(/^folder-/)
    expect(ignoredClientUuid.data?.uuid).not.toBe('custom-folder-client-draft')
  })

  it('owns asset group listing, renaming, and deletion from backend asset rows', async () => {
    const backend = await loadBackend()

    expect(backend.listAssetGroups({ assetTypes: ['person'] })).toEqual(
      expect.arrayContaining([
        { key: 'group-生产', name: '生产', count: 1 },
        { key: 'group-预发', name: '预发', count: 1 }
      ])
    )

    const renamed = backend.renameAssetGroup({ oldName: '生产', newName: '生产归档', assetTypes: ['person'] })
    expect(renamed.ok).toBe(true)
    expect(renamed.data?.assets.find((asset: { id: string }) => asset.id === 'asset-1')).toMatchObject({
      group: '生产归档',
      group_name: '生产归档'
    })
    expect(backend.listAssetGroups({ assetTypes: ['person'] })).toContainEqual({ key: 'group-生产归档', name: '生产归档', count: 1 })

    const deleted = backend.deleteAssetGroup({ name: '生产归档', fallbackName: '未分组', assetTypes: ['person'] })
    expect(deleted.ok).toBe(true)
    expect(deleted.data?.assets.find((asset: { id: string }) => asset.id === 'asset-1')).toMatchObject({
      group: '未分组',
      group_name: '未分组'
    })
    expect(backend.listAssetGroups({ assetTypes: ['person'] })).toContainEqual({ key: 'group-未分组', name: '未分组', count: 1 })
  })

  it('derives SSH Agent keychain options from backend-owned keychains', async () => {
    const backend = await loadBackend()
    const options = backend.listSshAgentKeychainOptions()

    expect(options).toContainEqual({
      key: 'key-1',
      label: 'prod-ed25519',
      fingerprint: 'SHA256:KW/btgUSM+Gu9ht4gyd2CMSZB/1setTDE0+Uik88xGE',
      keyType: 'ED25519'
    })
    expect(options).toContainEqual({
      key: 'key-2',
      label: 'staging-rsa',
      fingerprint: 'SHA256:/+3Ox/lagG69520s5FqjN11505yiwGiXccCtpZYvucc',
      keyType: 'RSA'
    })
    expect(options.every((option: Record<string, unknown>) => !('privateKey' in option) && !('passphrase' in option))).toBe(true)
  })

  it('refreshes organization assets and returns a backend-owned snapshot', async () => {
    const backend = await loadBackend()
    const refreshed = backend.refreshOrganizationAssets({ organizationId: 'asset-5' })

    expect(refreshed.ok).toBe(true)
    expect(refreshed.data).toMatchObject({ refreshed: 1, created: 1, updated: 0 })
    expect(refreshed.data?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'asset-5-synced',
          title: 'jumpserver-org-synced-asset',
          data_source: 'refresh',
          organizationId: 'org-1',
          tags: ['jumpserver', 'synced']
        })
      ])
    )

    const refreshedAgain = backend.refreshOrganizationAssets({ organizationId: 'asset-5' })
    expect(refreshedAgain.data).toMatchObject({ refreshed: 1, created: 0, updated: 1 })
    expect(refreshedAgain.data?.assets.filter((asset: { id: string }) => asset.id === 'asset-5-synced')).toHaveLength(1)
  })
})
