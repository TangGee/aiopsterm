import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'

const requireNative = createRequire(__filename)
const Database = requireNative('better-sqlite3')

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-files-sqlite-test'
  }
}))

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/files'
  return import(modulePath)
}

const withFileSessionDatabase = async <T>(run: (databasePath: string) => Promise<T>) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-files-sqlite-'))
  try {
    return await run(join(dir, 'files.db'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('files sqlite session catalog seed boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts non-seed SQLite file session catalog with only the local session', async () => {
    await withFileSessionDatabase(async (databasePath) => {
      const backend = await loadBackend()
      backend.configureFilesBackendRuntime({ databasePath, useSeedData: false, sqliteFactory: Database })
      backend.__resetFileSessionCatalogForTests()

      const catalog = await backend.listFileSessionCatalog()

      expect(catalog.ok).toBe(true)
      expect(catalog.data.sessions).toEqual([expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' })])
      expect(catalog.data.folders).toEqual([])
    })
  })

  it('strips unchanged legacy SQLite file session seeds in non-seed runtime while preserving custom user sessions', async () => {
    await withFileSessionDatabase(async (databasePath) => {
      const backend = await loadBackend()
      backend.configureFilesBackendRuntime({ databasePath, useSeedData: true, sqliteFactory: Database })
      backend.__resetFileSessionCatalogForTests()
      const edited = await backend.saveFileSession({
        id: 'sqlite-custom-files',
        label: 'sqlite-custom-files',
        host: '10.77.0.19',
        group: '资产',
        kind: 'remote',
        rootPath: '/srv/sqlite-user-owned',
        status: 'active',
        favorite: false,
        assetType: 'person'
      })
      expect(edited.ok).toBe(true)

      backend.configureFilesBackendRuntime({ databasePath, useSeedData: false, sqliteFactory: Database })
      const catalog = await backend.listFileSessionCatalog()

      expect(catalog.ok).toBe(true)
      expect(catalog.data.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'local', kind: 'local' }),
          expect.objectContaining({
            id: 'sqlite-custom-files',
            label: 'sqlite-custom-files',
            rootPath: '/srv/sqlite-user-owned'
          })
        ])
      )
      expect(catalog.data.sessions.some((session: { id: string }) => session.id === 'asset-2')).toBe(false)
      expect(catalog.data.folders).toEqual([])
    })
  })
})
