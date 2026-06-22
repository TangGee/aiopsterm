import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord
} from '@shared/contracts/assets'
import {
  assetsPanelAssetToInput,
  createAssetsPanelBackendRuntime
} from '@/services/assetsPanelBackendRuntime'
import type { AssetsPanelAsset } from '@/services/assetsPanelTreeRuntime'

const originalAiops = window.aiops
const malformedMessage = '资产服务返回数据无效'

afterEach(() => {
  window.aiops = originalAiops
})

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const makeAsset = (patch: Partial<AiopsAssetRecord> = {}): AiopsAssetRecord => ({
  id: 'asset-1',
  uuid: 'asset-1',
  name: 'Production',
  title: 'Production',
  host: '127.0.0.1',
  ip: '127.0.0.1',
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
  name: 'Production',
  description: '',
  scope: 'direct',
  ...patch
})

const group: AiopsAssetGroupRecord = {
  key: 'Default',
  name: 'Default',
  count: 1
}

const makeSnapshot = (
  assets: AiopsAssetRecord[] = [makeAsset()],
  folders: AiopsCustomFolderRecord[] = [makeFolder()]
): AiopsAssetSnapshot => ({
  assets: clone(assets),
  folders: clone(folders)
})

const makeRuntime = () => {
  const assets = ref<AssetsPanelAsset[]>([])
  const customFolders = ref<AiopsCustomFolderRecord[]>([])
  const assetGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const assetGroupOptionsReady = ref(false)
  const runtime = createAssetsPanelBackendRuntime({
    assets,
    customFolders,
    assetGroupOptions,
    assetGroupOptionsReady
  })
  return {
    runtime,
    assets,
    customFolders,
    assetGroupOptions,
    assetGroupOptionsReady
  }
}

const installAssetBridge = (input: {
  snapshot?: AiopsAssetSnapshot
  groups?: AiopsAssetGroupRecord[]
  saveAssetResult?: unknown
  deleteAssetResult?: unknown
  saveFolderResult?: unknown
  refreshOrganizationResult?: unknown
}) => {
  window.aiops = {
    ...originalAiops,
    listAssets: vi.fn(async () => clone(input.snapshot || makeSnapshot())),
    listAssetGroups: vi.fn(async () => clone(input.groups || [group])),
    saveAsset: vi.fn(async () => input.saveAssetResult) as any,
    deleteAsset: vi.fn(async () => input.deleteAssetResult) as any,
    saveAssetFolder: vi.fn(async () => input.saveFolderResult) as any,
    refreshOrganizationAssets: vi.fn(async () => input.refreshOrganizationResult) as any
  }
}

describe('assetsPanelBackendRuntime', () => {
  it('applies snapshots for Assets panel state without local shell or shared mutable records', () => {
    const localShell = makeAsset({
      id: 'local-shell',
      uuid: 'local-shell',
      name: 'Local Shell',
      title: 'Local Shell',
      isLocalShell: true
    })
    const sourceAsset = makeAsset({ tags: ['manual', 'favorite'] })
    const sourceFolder = makeFolder({ description: 'Direct assets' })
    const sourceSnapshot = makeSnapshot([localShell, sourceAsset], [sourceFolder])
    const { runtime, assets, customFolders } = makeRuntime()

    expect(runtime.applyAssetSnapshot(sourceSnapshot)).toBe(true)
    sourceSnapshot.assets[1].tags.push('mutated')
    sourceSnapshot.folders[0].name = 'Mutated'

    expect(assets.value.map((asset) => asset.id)).toEqual([sourceAsset.id])
    expect(assets.value[0].tags).toEqual(['manual', 'favorite'])
    expect(customFolders.value[0].name).toBe('Production')
    expect(runtime.applyAssetSnapshot({ assets: [] })).toBe(false)

    const input = assetsPanelAssetToInput(assets.value[0], { favorite: false })
    assets.value[0].tags.push('runtime-mutated')
    expect(input).toMatchObject<Partial<AiopsAssetInput>>({
      id: sourceAsset.id,
      name: sourceAsset.name,
      host: sourceAsset.host,
      favorite: false
    })
    expect(input.tags).toEqual(['manual', 'favorite'])
    expect(input.tags).not.toBe(assets.value[0].tags)
  })

  it('refreshes host management state with validated asset groups', async () => {
    const snapshot = makeSnapshot()
    const { runtime, assets, customFolders, assetGroupOptions, assetGroupOptionsReady } = makeRuntime()
    installAssetBridge({ snapshot, groups: [group] })

    await expect(runtime.refreshHostManagement()).resolves.toEqual(snapshot)

    expect(assets.value).toEqual(snapshot.assets)
    expect(customFolders.value).toEqual(snapshot.folders)
    expect(assetGroupOptions.value).toEqual([group])
    expect(assetGroupOptionsReady.value).toBe(true)
    expect(window.aiops.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person', 'switch'] })

    runtime.invalidateAssetGroups()
    expect(assetGroupOptions.value).toEqual([])
    expect(assetGroupOptionsReady.value).toBe(false)
  })

  it('saves and deletes assets only after refreshed snapshots prove the mutation', async () => {
    const originalAsset = makeAsset()
    const savedAsset = makeAsset({ favorite: true })
    const { runtime, assets } = makeRuntime()
    installAssetBridge({
      snapshot: makeSnapshot([savedAsset]),
      saveAssetResult: { ok: true, data: savedAsset }
    })

    await expect(runtime.saveAssetRecord(assetsPanelAssetToInput(originalAsset, { favorite: true }))).resolves.toEqual(savedAsset)
    expect(assets.value).toEqual([savedAsset])

    const missingSavedAsset = makeAsset({
      id: 'asset-2',
      uuid: 'asset-2',
      name: 'Missing',
      title: 'Missing',
      host: '10.0.0.2',
      ip: '10.0.0.2'
    })
    const failingSave = makeRuntime()
    installAssetBridge({
      snapshot: makeSnapshot([originalAsset]),
      saveAssetResult: { ok: true, data: missingSavedAsset }
    })

    await expect(failingSave.runtime.saveAssetRecord(assetsPanelAssetToInput(missingSavedAsset))).rejects.toThrow(malformedMessage)
    expect(failingSave.assets.value.some((asset) => asset.id === missingSavedAsset.id)).toBe(false)

    runtime.applyAssetSnapshot(makeSnapshot([savedAsset]))
    installAssetBridge({
      snapshot: makeSnapshot([]),
      deleteAssetResult: { ok: true, data: { id: savedAsset.id } }
    })

    await expect(runtime.deleteAssetRecords([savedAsset.id])).resolves.toBeUndefined()
    expect(assets.value).toEqual([])

    runtime.applyAssetSnapshot(makeSnapshot([savedAsset]))
    installAssetBridge({
      snapshot: makeSnapshot([savedAsset]),
      deleteAssetResult: { ok: true, data: { id: savedAsset.id } }
    })
    await expect(runtime.deleteAssetRecords([savedAsset.id])).rejects.toThrow(malformedMessage)
    expect(assets.value).toEqual([savedAsset])
  })

  it('saves folders only after refreshed snapshots include the saved folder', async () => {
    const asset = makeAsset()
    const originalFolder = makeFolder()
    const savedFolder = makeFolder({ uuid: 'folder-2', name: 'Archive', description: 'Bastion archive', scope: 'bastion' })
    const { runtime, customFolders } = makeRuntime()
    installAssetBridge({
      snapshot: makeSnapshot([asset], [originalFolder, savedFolder]),
      saveFolderResult: { ok: true, data: savedFolder }
    })

    await expect(runtime.saveAssetFolderRecord({ name: savedFolder.name, description: savedFolder.description, scope: savedFolder.scope })).resolves.toEqual(savedFolder)
    expect(customFolders.value.map((folder) => folder.uuid)).toEqual([originalFolder.uuid, savedFolder.uuid])

    const failing = makeRuntime()
    installAssetBridge({
      snapshot: makeSnapshot([asset], [originalFolder]),
      saveFolderResult: { ok: true, data: savedFolder }
    })

    await expect(failing.runtime.saveAssetFolderRecord({ name: savedFolder.name, description: savedFolder.description, scope: savedFolder.scope })).rejects.toThrow(malformedMessage)
    expect(failing.customFolders.value.some((folder) => folder.uuid === savedFolder.uuid)).toBe(false)
  })

  it('refreshes Jumpserver organization assets with expected organization validation', async () => {
    const organization = makeAsset({
      id: 'org-1',
      uuid: 'org-uuid-1',
      name: 'jumpserver-org',
      title: 'jumpserver-org',
      host: 'jumpserver.local',
      ip: '10.90.0.10',
      group: 'Jumpserver',
      group_name: 'Jumpserver',
      username: 'admin',
      asset_type: 'organization',
      tags: ['jumpserver'],
      data_source: 'refresh'
    })
    const resource = makeAsset({
      id: 'asset-remote-1',
      uuid: 'asset-remote-1',
      name: 'mysql-primary',
      title: 'mysql-primary',
      host: '10.90.0.15',
      ip: '10.90.0.15',
      group: 'Jumpserver',
      group_name: 'Jumpserver',
      organizationId: organization.uuid,
      data_source: 'refresh'
    })
    const refreshData = {
      ...makeSnapshot([organization, resource], [makeFolder({ scope: 'bastion' })]),
      organizationId: organization.id,
      refreshed: 1,
      created: 0,
      updated: 1
    }
    const { runtime, assets } = makeRuntime()
    installAssetBridge({
      refreshOrganizationResult: { ok: true, data: refreshData }
    })

    await expect(runtime.refreshOrganizationAssets(organization.id)).resolves.toEqual(refreshData)
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith({ organizationId: organization.id })
    expect(assets.value.map((asset) => asset.id)).toEqual([organization.id, resource.id])

    installAssetBridge({
      refreshOrganizationResult: {
        ok: true,
        data: {
          ...refreshData,
          organizationId: 'other-org'
        }
      }
    })
    await expect(runtime.refreshOrganizationAssets(organization.id)).rejects.toThrow(malformedMessage)

    const nonJumpserverOrganization = makeAsset({
      id: 'org-plain',
      uuid: 'org-plain',
      name: 'plain-org',
      title: 'plain-org',
      host: 'plain.local',
      ip: '10.90.0.20',
      asset_type: 'organization',
      tags: []
    })
    installAssetBridge({
      refreshOrganizationResult: {
        ok: true,
        data: {
          ...makeSnapshot([nonJumpserverOrganization], []),
          organizationId: nonJumpserverOrganization.id,
          refreshed: 0,
          created: 0,
          updated: 0
        }
      }
    })
    await expect(runtime.refreshOrganizationAssets(nonJumpserverOrganization.id)).rejects.toThrow(malformedMessage)
  })
})
