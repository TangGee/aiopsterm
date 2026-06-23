import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord,
  AiopsKeychainRecord
} from '@shared/contracts/assets'
import {
  createWorkspacePanelBackendRuntime,
  workspacePanelAssetToInput
} from '@/services/workspace/workspacePanelBackendRuntime'
import type {
  WorkspacePanelAsset,
  WorkspacePanelFolder
} from '@/services/assets/workspaceAssetTreeRuntime'

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

const keychain: AiopsKeychainRecord = {
  id: 'key-1',
  name: 'prod-ed25519',
  type: 'ed25519',
  publicKey: 'ssh-ed25519 AAAA',
  hasPrivateKey: true,
  createdAt: 1781884800000,
  updatedAt: 1781884800000
}

const makeSnapshot = (
  assets: AiopsAssetRecord[] = [makeAsset()],
  folders: AiopsCustomFolderRecord[] = [makeFolder()]
): AiopsAssetSnapshot => ({
  assets: clone(assets),
  folders: clone(folders)
})

const makeRuntime = () => {
  const workspaceAssets = ref<WorkspacePanelAsset[]>([])
  const customFolders = ref<WorkspacePanelFolder[]>([])
  const directGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const keychainOptions = ref<AiopsKeychainRecord[]>([])
  const runtime = createWorkspacePanelBackendRuntime({
    workspaceAssets,
    customFolders,
    directGroupOptions,
    keychainOptions
  })
  return {
    runtime,
    workspaceAssets,
    customFolders,
    directGroupOptions,
    keychainOptions
  }
}

const installAssetBridge = (input: {
  snapshot?: AiopsAssetSnapshot
  groups?: AiopsAssetGroupRecord[]
  keychains?: AiopsKeychainRecord[]
  saveAssetResult?: unknown
  deleteAssetResult?: unknown
  saveFolderResult?: unknown
  deleteFolderResult?: unknown
  refreshOrganizationResult?: unknown
}) => {
  window.aiops = {
    ...originalAiops,
    listAssets: vi.fn(async () => clone(input.snapshot || makeSnapshot())),
    listAssetGroups: vi.fn(async () => clone(input.groups || [group])),
    listKeychains: vi.fn(async () => clone(input.keychains || [keychain])),
    saveAsset: vi.fn(async () => input.saveAssetResult) as any,
    deleteAsset: vi.fn(async () => input.deleteAssetResult) as any,
    saveAssetFolder: vi.fn(async () => input.saveFolderResult) as any,
    deleteAssetFolder: vi.fn(async () => input.deleteFolderResult) as any,
    refreshOrganizationAssets: vi.fn(async () => input.refreshOrganizationResult) as any
  }
}

describe('workspacePanelBackendRuntime', () => {
  it('applies snapshots and projects asset input without sharing mutable records', () => {
    const sourceAsset = makeAsset({ tags: ['manual', 'favorite'] })
    const sourceFolder = makeFolder({ description: 'Direct assets' })
    const sourceSnapshot = makeSnapshot([sourceAsset], [sourceFolder])
    const { runtime, workspaceAssets, customFolders } = makeRuntime()

    expect(runtime.applyWorkspaceAssetSnapshot(sourceSnapshot)).toBe(true)
    sourceSnapshot.assets[0].tags.push('mutated')
    sourceSnapshot.folders[0].name = 'Mutated'

    expect(workspaceAssets.value[0].tags).toEqual(['manual', 'favorite'])
    expect(customFolders.value[0].name).toBe('Production')
    expect(runtime.applyWorkspaceAssetSnapshot({ assets: [] })).toBe(false)

    const input = workspacePanelAssetToInput(workspaceAssets.value[0], { favorite: false })
    workspaceAssets.value[0].tags.push('runtime-mutated')

    expect(input).toMatchObject<Partial<AiopsAssetInput>>({
      id: sourceAsset.id,
      name: sourceAsset.name,
      host: sourceAsset.host,
      favorite: false
    })
    expect(input.tags).toEqual(['manual', 'favorite'])
    expect(input.tags).not.toBe(workspaceAssets.value[0].tags)
  })

  it('refreshes assets, direct groups, and keychains through validated bridge data', async () => {
    const snapshot = makeSnapshot()
    const { runtime, workspaceAssets, customFolders, directGroupOptions, keychainOptions } = makeRuntime()
    installAssetBridge({ snapshot, groups: [group], keychains: [keychain] })

    await expect(runtime.refreshAssets()).resolves.toEqual(snapshot)
    await runtime.loadKeychainOptions()

    expect(workspaceAssets.value).toEqual(snapshot.assets)
    expect(customFolders.value).toEqual(snapshot.folders)
    expect(directGroupOptions.value).toEqual([group])
    expect(keychainOptions.value).toEqual([keychain])
    expect(window.aiops.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person', 'switch'] })

    const keychainBridge = window.aiops.listKeychains
    window.aiops = { ...window.aiops, listKeychains: undefined as any }
    keychainOptions.value = [keychain]
    await runtime.loadKeychainOptions()
    expect(keychainOptions.value).toEqual([])
    window.aiops = { ...window.aiops, listKeychains: keychainBridge }
  })

  it('saves assets only after backend result and refreshed snapshot agree', async () => {
    const originalAsset = makeAsset()
    const savedAsset = makeAsset({ favorite: true })
    const { runtime, workspaceAssets } = makeRuntime()
    installAssetBridge({
      snapshot: makeSnapshot([savedAsset]),
      saveAssetResult: { ok: true, data: savedAsset }
    })

    await expect(runtime.saveAssetRecord(workspacePanelAssetToInput(originalAsset, { favorite: true }))).resolves.toEqual(savedAsset)
    expect(workspaceAssets.value).toEqual([savedAsset])

    const missingSavedAsset = makeAsset({ id: 'asset-2', uuid: 'asset-2', name: 'Missing', title: 'Missing', host: '10.0.0.2', ip: '10.0.0.2' })
    const failing = makeRuntime()
    installAssetBridge({
      snapshot: makeSnapshot([originalAsset]),
      saveAssetResult: { ok: true, data: missingSavedAsset }
    })

    await expect(failing.runtime.saveAssetRecord(workspacePanelAssetToInput(missingSavedAsset))).rejects.toThrow(malformedMessage)
    expect(failing.workspaceAssets.value.some((asset) => asset.id === missingSavedAsset.id)).toBe(false)
  })

  it('deletes assets and folders only after refreshed snapshots remove affected records', async () => {
    const asset = makeAsset({ folderUuid: 'folder-1' })
    const folder = makeFolder()
    const { runtime, workspaceAssets, customFolders } = makeRuntime()
    runtime.applyWorkspaceAssetSnapshot(makeSnapshot([asset], [folder]))
    installAssetBridge({
      snapshot: makeSnapshot([], [folder]),
      deleteAssetResult: { ok: true, data: { id: asset.id } }
    })

    await expect(runtime.deleteAssetRecord(asset.id)).resolves.toBeUndefined()
    expect(workspaceAssets.value).toEqual([])
    expect(customFolders.value).toEqual([folder])

    runtime.applyWorkspaceAssetSnapshot(makeSnapshot([asset], [folder]))
    installAssetBridge({
      snapshot: makeSnapshot([asset], [folder]),
      deleteAssetResult: { ok: true, data: { id: asset.id } }
    })

    await expect(runtime.deleteAssetRecord(asset.id)).rejects.toThrow(malformedMessage)
    expect(workspaceAssets.value).toEqual([asset])

    const folderInput = { name: 'Archive', description: 'Bastion archive', scope: 'bastion' as const }
    const savedFolder = makeFolder({ uuid: 'folder-2', name: 'Archive', description: 'Bastion archive', scope: 'bastion' })
    installAssetBridge({
      snapshot: makeSnapshot([asset], [folder, savedFolder]),
      saveFolderResult: { ok: true, data: savedFolder }
    })

    await expect(runtime.saveFolderRecord(folderInput)).resolves.toEqual(savedFolder)
    expect(customFolders.value.some((item) => item.uuid === savedFolder.uuid)).toBe(true)

    const movedAsset = makeAsset({ folderUuid: undefined })
    installAssetBridge({
      snapshot: makeSnapshot([movedAsset], [savedFolder]),
      deleteFolderResult: { ok: true, data: { uuid: folder.uuid } }
    })

    await expect(runtime.deleteFolderRecord(folder.uuid)).resolves.toBeUndefined()
    expect(customFolders.value.some((item) => item.uuid === folder.uuid)).toBe(false)

    runtime.applyWorkspaceAssetSnapshot(makeSnapshot([asset], [folder]))
    installAssetBridge({
      snapshot: makeSnapshot([asset], []),
      deleteFolderResult: { ok: true, data: { uuid: folder.uuid } }
    })

    await expect(runtime.deleteFolderRecord(folder.uuid)).rejects.toThrow(malformedMessage)
    expect(workspaceAssets.value).toEqual([asset])
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
    const { runtime, workspaceAssets } = makeRuntime()
    installAssetBridge({
      groups: [group],
      refreshOrganizationResult: { ok: true, data: refreshData }
    })

    await expect(runtime.refreshOrganizationAssets(organization.id)).resolves.toEqual(refreshData)
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith({ organizationId: organization.id })
    expect(workspaceAssets.value.map((asset) => asset.id)).toEqual([organization.id, resource.id])

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
