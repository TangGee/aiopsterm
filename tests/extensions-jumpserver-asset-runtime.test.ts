import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExtensionsJumpserverAssetRuntime } from '@/services/extensions/extensionsJumpserverAssetRuntime'
import type { AiopsAssetRecord, AiopsAssetSnapshot, AiopsCustomFolderRecord } from '@shared/contracts/assets'

const originalAiops = window.aiops

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const makeAsset = (patch: Partial<AiopsAssetRecord> = {}): AiopsAssetRecord => ({
  id: 'asset-1',
  uuid: 'asset-1',
  name: 'asset-1',
  title: 'asset-1',
  host: '10.0.0.1',
  ip: '10.0.0.1',
  group: 'Default',
  group_name: 'Default',
  status: 'online',
  tags: ['manual'],
  username: 'ops',
  port: 22,
  asset_type: 'person',
  auth_type: 'keyBased',
  comment: '',
  data_source: 'manual',
  hasPrivateKey: true,
  ...patch
})

const makeFolder = (patch: Partial<AiopsCustomFolderRecord> = {}): AiopsCustomFolderRecord => ({
  uuid: 'folder-1',
  name: 'Default',
  description: '',
  scope: 'bastion',
  ...patch
})

const makeSnapshot = (
  assets: AiopsAssetRecord[] = [makeAsset()],
  folders: AiopsCustomFolderRecord[] = [makeFolder()]
): AiopsAssetSnapshot => ({
  assets: clone(assets),
  folders: clone(folders)
})

const jumpserverOrganization = () =>
  makeAsset({
    id: 'org-1',
    uuid: 'org-uuid-1',
    name: 'jumpserver-org',
    title: 'jumpserver-org',
    host: 'jumpserver.local',
    ip: '10.90.0.10',
    group: 'Jumpserver',
    group_name: 'Jumpserver',
    username: 'sync',
    asset_type: 'organization',
    tags: ['jumpserver'],
    data_source: 'refresh'
  })

afterEach(() => {
  window.aiops = originalAiops
})

describe('extensionsJumpserverAssetRuntime', () => {
  it('loads Jumpserver assets, derives synced resources, and clones backend snapshots', async () => {
    const organization = jumpserverOrganization()
    const syncedAsset = makeAsset({
      id: 'remote-1',
      uuid: 'remote-1',
      name: 'remote-1',
      title: 'remote-1',
      host: '10.90.0.15',
      ip: '10.90.0.15',
      organizationId: organization.uuid,
      tags: ['database'],
      data_source: 'refresh'
    })
    const localShell = makeAsset({
      id: 'local',
      uuid: 'local',
      name: 'Local',
      title: 'Local',
      isLocalShell: true,
      data_source: 'refresh',
      organizationId: organization.uuid
    })
    const snapshot = makeSnapshot([organization, syncedAsset, localShell])
    window.aiops = {
      ...originalAiops,
      listAssets: vi.fn(async () => snapshot)
    }

    const runtime = createExtensionsJumpserverAssetRuntime({ selectedPluginId: () => 'jumpserverSupport' })

    await expect(runtime.loadJumpserverAssetSnapshot()).resolves.toBe(true)
    expect(runtime.jumpserverOrganizations.value.map((asset) => asset.id)).toEqual([organization.id])
    expect(runtime.jumpserverSyncedAssets.value.map((asset) => asset.id)).toEqual([syncedAsset.id])
    expect(runtime.jumpserverOnlineSyncedAssets.value.map((asset) => asset.id)).toEqual([syncedAsset.id])

    snapshot.assets[0].tags.push('mutated')
    snapshot.folders[0].name = 'Mutated'
    expect(runtime.jumpserverOrganizations.value[0].tags).toEqual(['jumpserver'])
    expect(runtime.jumpserverAssetSnapshot.value.folders[0].name).toBe('Default')
  })

  it('does not load assets when the selected plugin is not Jumpserver', async () => {
    window.aiops = {
      ...originalAiops,
      listAssets: vi.fn(async () => makeSnapshot())
    }
    const runtime = createExtensionsJumpserverAssetRuntime({ selectedPluginId: () => 'Alias' })

    await expect(runtime.loadJumpserverAssetSnapshot()).resolves.toBe(false)
    expect(window.aiops.listAssets).not.toHaveBeenCalled()
    expect(runtime.jumpserverOrganizations.value).toEqual([])
  })

  it('refreshes assets with expected Jumpserver organization validation', async () => {
    const organization = jumpserverOrganization()
    const refreshedAsset = makeAsset({
      id: 'remote-2',
      uuid: 'remote-2',
      name: 'remote-2',
      title: 'remote-2',
      host: '10.90.0.16',
      ip: '10.90.0.16',
      organizationId: organization.uuid,
      data_source: 'refresh'
    })
    const runtime = createExtensionsJumpserverAssetRuntime({ selectedPluginId: () => 'jumpserverSupport' })
    expect(runtime.applyJumpserverRefreshSnapshot(makeSnapshot([organization]))).toBe(true)
    window.aiops = {
      ...originalAiops,
      refreshOrganizationAssets: vi.fn(async () => ({
        ok: true,
        data: {
          ...makeSnapshot([organization, refreshedAsset]),
          organizationId: organization.id,
          refreshed: 1,
          created: 1,
          updated: 0
        }
      }))
    }

    await expect(runtime.refreshJumpserverAssets()).resolves.toBe(true)
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith({ organizationId: organization.id })
    expect(runtime.jumpserverSyncedAssets.value.map((asset) => asset.id)).toEqual([refreshedAsset.id])
    expect(runtime.jumpserverAssetNotice.value).toBe('刷新完成：新增 1，更新 0')
  })

  it('fails closed for missing bridges and malformed refresh payloads', async () => {
    window.aiops = {
      ...originalAiops,
      listAssets: undefined as any,
      refreshOrganizationAssets: undefined as any
    }
    const runtime = createExtensionsJumpserverAssetRuntime({ selectedPluginId: () => 'jumpserverSupport' })
    await expect(runtime.loadJumpserverAssetSnapshot()).resolves.toBe(false)
    expect(runtime.jumpserverAssetError.value).toBe('资产列表服务不可用')
    await expect(runtime.refreshJumpserverAssets('org-1')).resolves.toBe(false)
    expect(runtime.jumpserverAssetError.value).toBe('组织资产刷新服务不可用')

    const organization = jumpserverOrganization()
    runtime.applyJumpserverRefreshSnapshot(makeSnapshot([organization]))
    window.aiops = {
      ...originalAiops,
      refreshOrganizationAssets: vi.fn(async () => ({
        ok: true,
        data: {
          ...makeSnapshot([{ ...organization, tags: [] }]),
          organizationId: organization.id,
          refreshed: 0,
          created: 0,
          updated: 0
        }
      }))
    }

    await expect(runtime.refreshJumpserverAssets(organization.id)).resolves.toBe(false)
    expect(runtime.jumpserverAssetError.value).toBe('资产服务返回数据无效')
  })
})
