import { describe, expect, it, vi } from 'vitest'
import type { FileSessionCatalog } from '../src/shared/contracts/files'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-files-session-catalog-runtime-test'
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private store: T

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

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/files/filesSessionCatalogRuntime'
  return import(modulePath)
}

const assetSnapshot = () => ({
  assets: [
    {
      id: 'asset-1',
      uuid: 'asset-1-uuid',
      name: 'prod-bastion',
      title: 'prod-bastion',
      host: '10.24.8.12',
      ip: '10.24.8.12',
      group: '生产',
      group_name: '生产',
      status: 'online' as const,
      username: 'deploy',
      asset_type: 'person' as const,
      comment: '生产入口',
      favorite: true,
      folderUuid: 'custom-folder-a',
      organizationId: '',
      jumpHostId: '',
      isLocalShell: false
    },
    {
      id: 'org-1',
      uuid: 'org-1-uuid',
      name: 'org-prod',
      title: 'org-prod',
      host: '10.24.9.10',
      ip: '10.24.9.10',
      group: '',
      group_name: '',
      status: 'offline' as const,
      username: 'root',
      asset_type: 'organization' as const,
      comment: '',
      favorite: false,
      folderUuid: '',
      organizationId: '',
      jumpHostId: 'jump-1',
      isLocalShell: false
    }
  ],
  folders: [{ uuid: 'custom-folder-a', name: '核心业务', description: 'from assets', scope: 'bastion' as const }]
})

describe('filesSessionCatalogRuntime', () => {
  it('normalizes catalogs, strips unmodified legacy seeds outside seed mode, and keeps local session', async () => {
    const runtime = await loadRuntime()
    runtime.configureFilesSessionCatalogRuntime({ useSeedData: false, forceFallbackStore: true })

    const normalized = runtime.normalizeFileSessionCatalog(runtime.fileSessionSeedCatalog())

    expect(normalized.sessions).toEqual([expect.objectContaining({ id: 'local', kind: 'local', rootPath: '/' })])
    expect(normalized.folders).toEqual([])
  })

  it('merges backend asset snapshots while preserving user-owned session fields', async () => {
    const runtime = await loadRuntime()
    runtime.configureFilesSessionCatalogRuntime({ useSeedData: false, forceFallbackStore: true })
    const catalog: FileSessionCatalog = {
      sessions: [
        { id: 'local', label: 'Local', host: '127.0.0.1', group: '本地连接', kind: 'local', rootPath: '/', status: 'active', assetType: 'local' },
        {
          id: 'asset-1',
          label: 'old-label',
          host: 'old-host',
          group: '用户分组',
          kind: 'remote',
          rootPath: '/srv/user-owned',
          status: 'idle',
          favorite: false,
          assetType: 'person',
          comment: 'user comment'
        },
        {
          id: 'custom-session',
          label: 'custom',
          host: '10.1.1.1',
          group: '手动',
          kind: 'remote',
          rootPath: '/data',
          status: 'active',
          assetType: 'person'
        }
      ],
      folders: [{ uuid: 'custom-local', name: '本地目录', description: 'custom' }]
    }

    const merged = runtime.mergeAssetCatalogIntoFileSessions(catalog, assetSnapshot())

    expect(merged.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local', rootPath: '/' }),
        expect.objectContaining({
          id: 'asset-1',
          label: 'prod-bastion',
          host: '10.24.8.12',
          group: '用户分组',
          rootPath: '/srv/user-owned',
          status: 'idle',
          favorite: true,
          folderUuid: 'custom-folder-a',
          comment: 'user comment'
        }),
        expect.objectContaining({
          id: 'org-1',
          group: '堡垒机资源',
          rootPath: '/root',
          status: 'idle',
          assetType: 'organization',
          organizationId: 'org-1-uuid',
          jumpHostId: 'jump-1'
        }),
        expect.objectContaining({ id: 'custom-session', rootPath: '/data' })
      ])
    )
    expect(merged.folders).toEqual(
      expect.arrayContaining([expect.objectContaining({ uuid: 'custom-folder-a' }), expect.objectContaining({ uuid: 'custom-local' })])
    )
  })

  it('builds SFTP payload and terminal-context sessions without filesystem or asset imports', async () => {
    const runtime = await loadRuntime()

    expect(
      runtime.fileSessionFromSftpPayload({
        uuid: 'drop-1',
        host: '10.55.0.9',
        title: 'drop-host',
        username: 'ops',
        asset_type: 'organization',
        comment: 'drag source'
      })
    ).toEqual({
      ok: true,
      session: expect.objectContaining({
        id: 'drop-1',
        label: 'drop-host',
        host: '10.55.0.9',
        rootPath: '/home/ops',
        assetType: 'organization',
        comment: 'drag source'
      })
    })

    expect(runtime.fileSessionFromSftpPayload({ title: 'missing-host' })).toEqual({
      ok: false,
      errorCode: 'FILES_SESSION_PAYLOAD_INVALID',
      errorMessage: 'SFTP asset payload requires an id or host.'
    })

    expect(
      runtime.fileSessionFromTerminalContext({
        kind: 'ssh',
        panelTitle: 'ssh temp',
        panelStatus: 'running',
        sessionId: 'terminal-ephemeral',
        cwd: '/home/temp',
        ssh: { connectionId: 'connection-1', host: '10.66.0.7', username: 'temp', assetName: 'temp-host' }
      })
    ).toEqual({
      ok: true,
      session: expect.objectContaining({
        id: 'ssh-connection-1',
        label: 'temp-host',
        host: '10.66.0.7',
        group: '终端连接',
        rootPath: '/home/temp',
        comment: 'Opened from ssh temp'
      })
    })
  })
})
