import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'

const requireNative = createRequire(__filename)
const Database = requireNative('better-sqlite3')

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-assets-sqlite-test'
  }
}))

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/assets'
  return import(modulePath)
}

const withAssetDatabase = async <T>(run: (databasePath: string) => Promise<T>) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-assets-sqlite-'))
  try {
    return await run(join(dir, 'assets.db'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('assets sqlite backend seed boundary', () => {
  beforeEach(() => {
    vi.resetModules()
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
})
