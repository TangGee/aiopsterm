import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-assets-test'
  }
}))

vi.mock('electron-store', () => {
  const stores = new Map<string, Record<string, unknown>>()

  class MockStore<T extends Record<string, unknown>> {
    store: T

    constructor(options?: { name?: string; defaults?: T }) {
      const key = options?.name || 'default'
      if (!stores.has(key)) stores.set(key, JSON.parse(JSON.stringify(options?.defaults || {})))
      this.store = stores.get(key) as T
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key]
    }

    set<K extends keyof T>(key: K, value: T[K]) {
      this.store[key] = value
    }
  }

  return { default: MockStore, __resetMockStores: () => stores.clear() }
})

vi.mock('better-sqlite3', () => {
  throw new Error('force electron-store asset backend in tests')
})

const originalAssetsSeedEnv = process.env.AIOPSTERM_ASSETS_ENABLE_SEED

const restoreAssetsSeedEnv = () => {
  if (originalAssetsSeedEnv === undefined) {
    delete process.env.AIOPSTERM_ASSETS_ENABLE_SEED
  } else {
    process.env.AIOPSTERM_ASSETS_ENABLE_SEED = originalAssetsSeedEnv
  }
}

const loadBackend = async (options: { useDefaultRuntime?: boolean } = {}) => {
  vi.resetModules()
  const storeModule = (await import('electron-store')) as unknown as { __resetMockStores?: () => void }
  storeModule.__resetMockStores?.()
  const modulePath = '../src/main/backend/assets'
  const backend = await import(modulePath)
  if (!options.useDefaultRuntime) {
    backend.configureAssetBackendRuntime({ useSeedData: true, forceFallbackStore: true })
  }
  return backend
}

const withAssetImportFile = async <T>(rows: unknown[], run: (filePath: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-assets-import-'))
  try {
    const filePath = join(dir, 'external-reference-assets.json')
    await writeFile(filePath, JSON.stringify(rows, null, 2), 'utf-8')
    return await run(filePath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const createSshRuntime = (options: { fail?: Error } = {}) => {
  const connectConfigs: Array<Record<string, unknown>> = []
  const clients: Array<EventEmitter & { connect: (config: Record<string, unknown>) => void; end: () => void; ended: boolean }> = []
  class FakeClient extends EventEmitter {
    ended = false

    connect(config: Record<string, unknown>) {
      connectConfigs.push(config)
      queueMicrotask(() => {
        if (options.fail) this.emit('error', options.fail)
        else this.emit('ready')
      })
    }

    end() {
      this.ended = true
      this.emit('end')
    }
  }
  return {
    runtime: {
      Client: class extends FakeClient {
        constructor() {
          super()
          clients.push(this)
        }
      }
    },
    connectConfigs,
    clients
  }
}

describe('assets backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.AIOPSTERM_ASSETS_ENABLE_SEED
  })

  afterEach(() => {
    restoreAssetsSeedEnv()
  })

  it('starts non-seed asset runtime with only the backend-owned local shell asset', async () => {
    const backend = await loadBackend()
    backend.configureAssetBackendRuntime({ useSeedData: false, forceFallbackStore: true })

    const snapshot = backend.listAssets()

    expect(snapshot.assets).toHaveLength(1)
    expect(snapshot.assets[0]).toEqual(expect.objectContaining({ id: 'local-127-1', isLocalShell: true }))
    expect(snapshot.assets.some((asset: { id: string }) => ['asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5'].includes(asset.id))).toBe(false)
    expect(snapshot.folders).toEqual([])
    expect(backend.listSshAgentKeychainOptions()).toEqual([])
  })

  it('does not infer asset seed mode from NODE_ENV test', async () => {
    const backend = await loadBackend({ useDefaultRuntime: true })
    backend.configureAssetBackendRuntime({ forceFallbackStore: true })

    const snapshot = backend.listAssets()

    expect(process.env.NODE_ENV).toBe('test')
    expect(snapshot.assets).toHaveLength(1)
    expect(snapshot.assets[0]).toEqual(expect.objectContaining({ id: 'local-127-1', isLocalShell: true }))
    expect(snapshot.assets.some((asset: { id: string }) => asset.id === 'asset-1')).toBe(false)
    expect(snapshot.folders).toEqual([])
  })

  it('loads asset development seeds only when the seed environment switch is enabled', async () => {
    process.env.AIOPSTERM_ASSETS_ENABLE_SEED = '1'
    const backend = await loadBackend({ useDefaultRuntime: true })
    backend.configureAssetBackendRuntime({ forceFallbackStore: true })

    const snapshot = backend.listAssets()

    expect(snapshot.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'asset-1', title: 'prod-bastion' }),
        expect.objectContaining({ id: 'asset-5', title: 'jumpserver-org', asset_type: 'organization' })
      ])
    )
    expect(snapshot.folders).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' })]))
  })

  it('keeps development asset seeds available only when seed mode is enabled', async () => {
    const backend = await loadBackend()
    backend.configureAssetBackendRuntime({ useSeedData: true, forceFallbackStore: true })

    const snapshot = backend.listAssets()

    expect(snapshot.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-127-1', isLocalShell: true }),
        expect.objectContaining({ id: 'asset-1', title: 'prod-bastion' }),
        expect.objectContaining({ id: 'asset-5', title: 'jumpserver-org', asset_type: 'organization' })
      ])
    )
    expect(snapshot.folders).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' })]))
    expect(backend.listSshAgentKeychainOptions()).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'key-1' }), expect.objectContaining({ key: 'key-2' })]))
  })

  it('strips unmodified legacy fallback seed assets in non-seed runtime while preserving user edits', async () => {
    const backend = await loadBackend()
    backend.configureAssetBackendRuntime({ useSeedData: true, forceFallbackStore: true })
    expect(backend.listAssets().assets.some((asset: { id: string }) => asset.id === 'asset-1')).toBe(true)
    const edited = backend.saveAsset({
      id: 'asset-1',
      name: 'user-owned-prod',
      title: 'user-owned-prod',
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

    backend.configureAssetBackendRuntime({ useSeedData: false, forceFallbackStore: true })
    const snapshot = backend.listAssets()

    expect(snapshot.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-127-1', isLocalShell: true }),
        expect.objectContaining({ id: 'asset-1', title: 'user-owned-prod' })
      ])
    )
    expect(snapshot.assets.some((asset: { id: string }) => ['asset-2', 'asset-3', 'asset-4', 'asset-5'].includes(asset.id))).toBe(false)
    expect(snapshot.folders).toContainEqual(expect.objectContaining({ uuid: 'custom-folder-a' }))
    expect(backend.listSshAgentKeychainOptions()).toContainEqual(expect.objectContaining({ key: 'key-1' }))
    expect(backend.listSshAgentKeychainOptions().some((option: { key: string }) => option.key === 'key-2')).toBe(false)
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

  it('keeps saved host passwords behind the editable-secret backend boundary', async () => {
    const backend = await loadBackend()
    const saved = backend.saveAsset({
      name: 'secret-owned-host',
      title: 'secret-owned-host',
      host: '10.77.1.7',
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['manual'],
      password: 'backend-secret'
    })

    expect(saved.ok).toBe(true)
    expect(saved.data).toEqual(expect.objectContaining({ hasPassword: true }))
    expect(saved.data).toEqual(expect.not.objectContaining({ password: 'backend-secret' }))

    const snapshotAsset = backend.listAssets().assets.find((asset: { id: string }) => asset.id === saved.data?.id)
    expect(snapshotAsset).toEqual(expect.objectContaining({ hasPassword: true }))
    expect(snapshotAsset).toEqual(expect.not.objectContaining({ password: 'backend-secret' }))

    const secret = backend.getAssetEditableSecret(saved.data!.id)
    expect(secret).toEqual({ ok: true, data: { assetId: saved.data!.id, password: 'backend-secret' } })

    const edited = backend.saveAsset({
      id: saved.data!.id,
      name: 'secret-owned-host-edited',
      title: 'secret-owned-host-edited',
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
    expect(edited.ok).toBe(true)
    expect(edited.data).toEqual(expect.objectContaining({ hasPassword: false }))
    expect(backend.getAssetEditableSecret(saved.data!.id)).toEqual({ ok: true, data: { assetId: saved.data!.id } })

    expect(backend.getAssetEditableSecret('local-127-1').ok).toBe(false)
    expect(backend.getAssetEditableSecret('missing-asset').ok).toBe(false)
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

  it('keeps direct and bastion custom folder trees isolated behind the backend boundary', async () => {
    const backend = await loadBackend()
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

  it('tests saved password SSH assets through an injected backend ssh runtime', async () => {
    const backend = await loadBackend()
    const ssh = createSshRuntime()
    backend.configureAssetConnectionRuntime({
      ssh2Runtime: ssh.runtime,
      now: (() => {
        let value = 1000
        return () => {
          value += 23
          return value
        }
      })()
    })
    const saved = backend.saveAsset({
      name: 'ssh-password-host',
      title: 'ssh-password-host',
      host: '10.71.0.8',
      username: 'deploy',
      port: 2222,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['manual'],
      password: 'backend-secret'
    })

    expect(saved.ok).toBe(true)
    expect(saved.data).toEqual(expect.not.objectContaining({ password: 'backend-secret' }))

    const tested = await backend.testAssetConnection({ assetId: saved.data!.id })
    expect(tested).toEqual({
      ok: true,
      data: expect.objectContaining({
        assetId: saved.data!.id,
        endpoint: 'deploy@10.71.0.8:2222',
        host: '10.71.0.8',
        port: 2222,
        username: 'deploy',
        authType: 'password',
        authSource: 'password',
        durationMs: 23
      })
    })
    expect(ssh.connectConfigs.at(-1)).toEqual(
      expect.objectContaining({
        host: '10.71.0.8',
        port: 2222,
        username: 'deploy',
        password: 'backend-secret'
      })
    )
    expect(ssh.clients.at(-1)?.ended).toBe(true)
  })

  it('treats blank edit draft passwords as an explicit cleared host password', async () => {
    const backend = await loadBackend()
    const ssh = createSshRuntime()
    backend.configureAssetConnectionRuntime({ ssh2Runtime: ssh.runtime })
    const saved = backend.saveAsset({
      name: 'ssh-edit-host',
      title: 'ssh-edit-host',
      host: '10.71.0.9',
      username: 'ops',
      port: 22,
      asset_type: 'person',
      auth_type: 'password',
      group: '测试',
      group_name: '测试',
      tags: ['manual'],
      password: 'saved-password'
    })

    const tested = await backend.testAssetConnection({
      assetId: saved.data!.id,
      asset: {
        id: saved.data!.id,
        name: 'ssh-edit-host',
        title: 'ssh-edit-host',
        host: '10.71.0.10',
        username: 'root',
        port: 2200,
        asset_type: 'person',
        auth_type: 'password',
        group: '测试',
        group_name: '测试',
        tags: ['manual'],
        password: ''
      }
    })

    expect(tested).toEqual({
      ok: false,
      errorCode: 'ASSET_SSH_AUTH_REQUIRED',
      errorMessage: 'SSH 密码不能为空'
    })
    expect(ssh.connectConfigs).toEqual([])
  })

  it('fails connection tests closed when credentials or ssh runtime are missing', async () => {
    const backend = await loadBackend()
    backend.configureAssetConnectionRuntime({ ssh2Runtime: null })
    const missingRuntime = await backend.testAssetConnection({
      asset: {
        name: 'runtime-missing-host',
        title: 'runtime-missing-host',
        host: '10.71.0.11',
        username: 'ops',
        port: 22,
        asset_type: 'person',
        auth_type: 'password',
        group: '测试',
        group_name: '测试',
        tags: ['manual'],
        password: 'secret'
      }
    })
    expect(missingRuntime).toEqual({
      ok: false,
      errorCode: 'ASSET_SSH_RUNTIME_UNAVAILABLE',
      errorMessage: 'ssh2 runtime is not available'
    })

    backend.configureAssetConnectionRuntime({ ssh2Runtime: createSshRuntime().runtime })
    const missingAuth = await backend.testAssetConnection({
      asset: {
        name: 'missing-auth-host',
        title: 'missing-auth-host',
        host: '10.71.0.12',
        username: 'ops',
        port: 22,
        asset_type: 'person',
        auth_type: 'password',
        group: '测试',
        group_name: '测试',
        tags: ['manual']
      }
    })
    expect(missingAuth).toEqual({
      ok: false,
      errorCode: 'ASSET_SSH_AUTH_REQUIRED',
      errorMessage: 'SSH 密码不能为空'
    })
  })

  it('returns actionable ssh authentication diagnostics from connection tests', async () => {
    const backend = await loadBackend()
    const ssh = createSshRuntime({
      fail: Object.assign(new Error('Permission denied (publickey).'), { level: 'client-authentication' })
    })
    backend.configureAssetConnectionRuntime({ ssh2Runtime: ssh.runtime })

    const result = await backend.testAssetConnection({
      asset: {
        name: 'password-disabled-host',
        title: 'password-disabled-host',
        host: '10.71.0.13',
        username: 'root',
        port: 22,
        asset_type: 'person',
        auth_type: 'password',
        group: '测试',
        group_name: '测试',
        tags: ['manual'],
        password: 'secret'
      }
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'SSH_AUTH_PASSWORD_DISABLED',
      errorMessage: expect.stringContaining('服务器未开放密码登录')
    })
    expect(result.errorMessage).toContain('PasswordAuthentication')
    expect(ssh.connectConfigs.at(-1)).toEqual(
      expect.objectContaining({
        host: '10.71.0.13',
        username: 'root',
        password: 'secret'
      })
    )
    expect(ssh.clients.at(-1)?.ended).toBe(true)
  })

  it('refreshes organization assets and returns a backend-owned snapshot', async () => {
    const backend = await loadBackend()
    const refreshed = backend.refreshOrganizationAssets({ organizationId: 'asset-5' })

    expect(refreshed.ok).toBe(true)
    expect(refreshed.data).toMatchObject({ organizationId: 'org-1', refreshed: 1, created: 1, updated: 0 })
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
    expect(refreshedAgain.data).toMatchObject({ organizationId: 'org-1', refreshed: 1, created: 0, updated: 1 })
    expect(refreshedAgain.data?.assets.filter((asset: { id: string }) => asset.id === 'asset-5-synced')).toHaveLength(1)
  })

  it('rejects organization refresh for an unknown organization id', async () => {
    const backend = await loadBackend()
    const refreshed = backend.refreshOrganizationAssets({ organizationId: 'missing-org' })

    expect(refreshed).toEqual({
      ok: false,
      errorCode: 'ASSET_BACKEND_ERROR',
      errorMessage: 'Organization asset not found: missing-org'
    })
    expect(backend.listAssets().assets.some((asset: { id: string }) => asset.id.includes('missing-org-synced'))).toBe(false)
  })

  it('previews asset imports in the backend without exposing imported secrets', async () => {
    const backend = await loadBackend()
    await withAssetImportFile(
      [
        { username: 'ops', ip: '10.24.8.12', label: 'prod-bastion-imported', group_name: '生产', port: 22, password: 'imported-secret' },
        { username: 'deploy', ip: '10.55.0.9', label: 'imported-json', group_name: 'Imported', port: 2200, password: 'new-secret' }
      ],
      async (filePath) => {
        const preview = await backend.previewAssetImport({ filePath })

        expect(preview.ok).toBe(true)
        expect(preview.data).toMatchObject({
          filePath,
          fileName: 'external-reference-assets.json',
          duplicateCount: 1
        })
        expect(preview.data?.assets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'prod-bastion-imported',
              host: '10.24.8.12',
              username: 'ops',
              duplicateId: 'asset-1',
              duplicateTitle: 'prod-bastion'
            }),
            expect.objectContaining({
              title: 'imported-json',
              host: '10.55.0.9',
              username: 'deploy',
              duplicateId: undefined
            })
          ])
        )
        expect(preview.data?.assets.some((asset: Record<string, unknown>) => 'password' in asset || 'privateKey' in asset)).toBe(false)
      }
    )
  })

  it('exports selected assets through the backend file boundary without renderer-owned payloads or secrets', async () => {
    const backend = await loadBackend()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-assets-export-'))
    const filePath = join(dir, 'selected-assets.json')
    try {
      const result = await backend.exportAssets(
        { assetIds: ['local-127-1', 'asset-1', 'asset-5'] },
        {
          now: () => new Date('2026-06-10T00:00:00.000Z'),
          showSaveDialog: async (options: { defaultPath: string }) => {
            expect(options.defaultPath).toBe('external-reference-assets-2026-06-10.json')
            return { canceled: false, filePath }
          }
        }
      )

      expect(result).toEqual({
        ok: true,
        data: {
          exported: 1,
          fileName: 'external-reference-assets-2026-06-10.json',
          filePath,
          bytes: expect.any(Number)
        }
      })
      const content = await readFile(filePath, 'utf-8')
      expect(result.data?.bytes).toBe(Buffer.byteLength(content, 'utf8'))
      await expect(stat(filePath)).resolves.toMatchObject({ size: result.data?.bytes })
      const exported = JSON.parse(content)
      expect(exported).toEqual([
        {
          username: 'ops',
          password: '',
          ip: '10.24.8.12',
          label: 'prod-bastion',
          group_name: '生产',
          auth_type: 'keyBased',
          keyChain: 'key-1',
          port: 22,
          asset_type: 'person',
          needProxy: false,
          proxyName: '',
          comment: '生产入口'
        }
      ])
      expect(JSON.stringify(exported)).not.toContain('PRIVATE KEY')
      expect(JSON.stringify(exported)).not.toContain('jumpserver-org')
      expect(JSON.stringify(exported)).not.toContain('127.0.0.1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps asset export modal cancellation and empty selections backend-owned', async () => {
    const backend = await loadBackend()
    const canceled = await backend.exportAssets(
      { assetIds: ['asset-1'] },
      {
        now: () => new Date('2026-06-10T00:00:00.000Z'),
        showSaveDialog: async () => ({ canceled: true })
      }
    )
    expect(canceled).toEqual({
      ok: true,
      data: {
        exported: 0,
        fileName: 'external-reference-assets-2026-06-10.json',
        canceled: true
      }
    })

    const empty = await backend.exportAssets(
      { assetIds: ['local-127-1', 'asset-5'] },
      {
        showSaveDialog: async () => {
          throw new Error('save dialog must not open for empty export')
        }
      }
    )
    expect(empty.ok).toBe(false)
    expect(empty.errorCode).toBe('ASSET_EXPORT_EMPTY')
  })

  it('rejects asset export save paths that cannot be written as absolute files', async () => {
    const backend = await loadBackend()
    const writeFileMock = vi.fn(async () => undefined)

    await expect(
      backend.exportAssets(
        { assetIds: ['asset-1'] },
        {
          now: () => new Date('2026-06-10T00:00:00.000Z'),
          showSaveDialog: async () => ({ canceled: false, filePath: '   ' }),
          writeFile: writeFileMock
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'ASSET_EXPORT_SAVE_PATH_INVALID'
    })

    await expect(
      backend.exportAssets(
        { assetIds: ['asset-1'] },
        {
          now: () => new Date('2026-06-10T00:00:00.000Z'),
          showSaveDialog: async () => ({ canceled: false, filePath: 'relative/assets.json' }),
          writeFile: writeFileMock
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'ASSET_EXPORT_SAVE_PATH_INVALID'
    })

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects asset export writers that cannot confirm the written file', async () => {
    const backend = await loadBackend()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-assets-export-confirm-'))
    const filePath = join(dir, 'selected-assets.json')
    const otherFilePath = join(dir, 'other-assets.json')
    try {
      await expect(
        backend.exportAssets(
          { assetIds: ['asset-1'] },
          {
            showSaveDialog: async () => ({ canceled: false, filePath }),
            writeFile: async (targetPath: string, content: string) => {
              await writeFile(targetPath, content, 'utf-8')
              return { filePath: otherFilePath, bytes: Buffer.byteLength(content, 'utf8') }
            }
          }
        )
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'ASSET_EXPORT_WRITE_CONFIRMATION_INVALID'
      })

      await expect(
        backend.exportAssets(
          { assetIds: ['asset-1'] },
          {
            showSaveDialog: async () => ({ canceled: false, filePath }),
            writeFile: async (targetPath: string, content: string) => {
              await writeFile(targetPath, content, 'utf-8')
              return { filePath: targetPath, bytes: 1 }
            }
          }
        )
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'ASSET_EXPORT_WRITE_CONFIRMATION_INVALID'
      })

      await expect(
        backend.exportAssets(
          { assetIds: ['asset-1'] },
          {
            showSaveDialog: async () => ({ canceled: false, filePath }),
            writeFile: async (targetPath: string) => {
              await writeFile(targetPath, '{"not":"the generated asset export"}', 'utf-8')
            }
          }
        )
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'ASSET_EXPORT_WRITE_CONFIRMATION_INVALID'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('confirms asset imports by re-reading the file and skipping duplicates in the backend', async () => {
    const backend = await loadBackend()
    await withAssetImportFile(
      [
        { username: 'ops', ip: '10.24.8.12', label: 'prod-bastion-imported', group_name: '生产', port: 22, password: 'imported-secret' },
        { username: 'deploy', ip: '10.55.0.9', label: 'imported-json', group_name: 'Imported', port: 2200, password: 'new-secret' }
      ],
      async (filePath) => {
        const result = await backend.confirmAssetImport({ filePath, overwrite: false })

        expect(result.ok).toBe(true)
        expect(result.data).toMatchObject({
          imported: 1,
          skipped: 1,
          created: 1,
          updated: 0,
          filePath,
          fileName: 'external-reference-assets.json'
        })
        expect(result.data?.assets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'asset-1', title: 'prod-bastion' }),
            expect.objectContaining({ title: 'imported-json', host: '10.55.0.9', username: 'deploy', hasPassword: true })
          ])
        )
        expect(result.data?.assets.some((asset: { title: string }) => asset.title === 'prod-bastion-imported')).toBe(false)
      }
    )
  })

  it('confirms asset imports by re-reading the file and overwriting duplicates in the backend', async () => {
    const backend = await loadBackend()
    await withAssetImportFile(
      [
        { username: 'ops', ip: '10.24.8.12', label: 'prod-bastion-imported', group_name: '生产', port: 22, password: 'imported-secret' },
        { username: 'deploy', ip: '10.55.0.9', label: 'imported-json', group_name: 'Imported', port: 2200, password: 'new-secret' }
      ],
      async (filePath) => {
        const result = await backend.confirmAssetImport({ filePath, overwrite: true })

        expect(result.ok).toBe(true)
        expect(result.data).toMatchObject({
          imported: 2,
          skipped: 0,
          created: 1,
          updated: 1,
          filePath,
          fileName: 'external-reference-assets.json'
        })
        expect(result.data?.assets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'asset-1',
              title: 'prod-bastion-imported',
              host: '10.24.8.12',
              username: 'ops',
              hasPassword: true
            }),
            expect.objectContaining({ title: 'imported-json', host: '10.55.0.9', username: 'deploy', hasPassword: true })
          ])
        )
      }
    )
  })
})
