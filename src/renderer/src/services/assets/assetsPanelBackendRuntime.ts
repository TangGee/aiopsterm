import type { Ref } from 'vue'

import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetSnapshot,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput
} from '@shared/contracts/assets'
import { assetsClient } from '@/services/assets/assetsClient'
import {
  isAiopsAssetGroupListData,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsJumpserverOrganizationAssetRefreshData,
  isAiopsSavedAssetRecord,
  isAiopsSavedCustomFolderRecord,
  malformedAssetBackendResultMessage
} from '@/services/assets/assetBackendGuards'
import type { AssetsPanelAsset } from '@/services/assets/assetsPanelTreeRuntime'

type AssetsPanelBackendState = {
  assets: Ref<AssetsPanelAsset[]>
  customFolders: Ref<AiopsCustomFolderRecord[]>
  assetGroupOptions: Ref<AiopsAssetGroupRecord[]>
  assetGroupOptionsReady: Ref<boolean>
}

export const assetsPanelAssetToInput = (asset: AssetsPanelAsset, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
  id: asset.id,
  name: asset.name,
  title: asset.title,
  host: asset.host,
  ip: asset.ip,
  group: asset.group,
  group_name: asset.group_name,
  status: asset.status,
  username: asset.username,
  port: asset.port,
  asset_type: asset.asset_type,
  auth_type: asset.auth_type,
  comment: asset.comment,
  data_source: asset.data_source,
  tags: [...asset.tags],
  favorite: asset.favorite,
  folderUuid: asset.folderUuid,
  organizationId: asset.organizationId,
  tunnelState: asset.tunnelState,
  needProxy: asset.needProxy,
  proxyName: asset.proxyName,
  keychainId: asset.keychainId,
  ...patch
})

export const createAssetsPanelBackendRuntime = ({
  assets,
  customFolders,
  assetGroupOptions,
  assetGroupOptionsReady
}: AssetsPanelBackendState) => {
  const loadAssetGroupOptions = async () => {
    const listAssetGroups = assetsClient.listAssetGroups()
    if (!listAssetGroups) throw new Error('资产分组服务不可用。')
    const groups = await listAssetGroups({
      assetTypes: ['person', 'switch']
    })
    if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
    return groups.map((group) => ({ ...group }))
  }

  const loadAssetSnapshot = async () => {
    const listAssets = assetsClient.listAssets()
    if (!listAssets) throw new Error('资产列表服务不可用。')
    const snapshot = await listAssets()
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    return snapshot
  }

  const applyAssetGroups = (groups: AiopsAssetGroupRecord[]) => {
    assetGroupOptions.value = groups
    assetGroupOptionsReady.value = true
  }

  const invalidateAssetGroups = () => {
    assetGroupOptions.value = []
    assetGroupOptionsReady.value = false
  }

  const applyAssetSnapshot = (snapshot: unknown) => {
    if (!isAiopsAssetSnapshot(snapshot)) return false
    assets.value = snapshot.assets
      .filter((asset) => !asset.isLocalShell)
      .map((asset) => ({ ...asset, tags: [...asset.tags] }))
    customFolders.value = snapshot.folders.map((folder) => ({ ...folder }))
    return true
  }

  const applyHostManagementState = (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => {
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
    applyAssetSnapshot(snapshot)
    applyAssetGroups(groups)
    return snapshot
  }

  const refreshAssets = async () => {
    const snapshot = await loadAssetSnapshot()
    applyAssetSnapshot(snapshot)
    return snapshot
  }

  const loadHostManagementRefresh = async () => {
    const snapshot = await loadAssetSnapshot()
    const groups = await loadAssetGroupOptions()
    return { snapshot, groups }
  }

  const refreshAssetGroupOptions = async () => {
    applyAssetGroups(await loadAssetGroupOptions())
  }

  const refreshHostManagement = async () => {
    const { snapshot, groups } = await loadHostManagementRefresh()
    applyHostManagementState(snapshot, groups)
    return snapshot
  }

  const assertSnapshotIncludesAsset = (snapshot: AiopsAssetSnapshot, assetId: string) => {
    if (!snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
  }

  const assertSnapshotExcludesAssets = (snapshot: AiopsAssetSnapshot, assetIds: string[]) => {
    if (assetIds.some((id) => snapshot.assets.some((asset) => asset.id === id))) throw new Error(malformedAssetBackendResultMessage)
  }

  const saveAssetRecord = async (input: AiopsAssetInput, options: { requireGroups?: boolean } = {}) => {
    const saveAsset = assetsClient.saveAsset()
    if (!saveAsset) throw new Error('资产保存服务不可用。')
    const result = await saveAsset(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
    const saved = result.data
    if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
    const refresh = options.requireGroups === false ? { snapshot: await loadAssetSnapshot(), groups: null } : await loadHostManagementRefresh()
    assertSnapshotIncludesAsset(refresh.snapshot, saved.id)
    applyAssetSnapshot(refresh.snapshot)
    if (refresh.groups) applyAssetGroups(refresh.groups)
    return saved
  }

  const deleteAssetRecords = async (assetIds: string[], options: { requireGroups?: boolean } = {}) => {
    const deleteAsset = assetsClient.deleteAsset()
    if (!deleteAsset) throw new Error('资产删除服务不可用。')
    for (const id of assetIds) {
      const result = await deleteAsset(id)
      if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
      if (!isAiopsDeletedAssetData(result.data, id)) throw new Error(malformedAssetBackendResultMessage)
    }
    const refresh = options.requireGroups === false ? { snapshot: await loadAssetSnapshot(), groups: null } : await loadHostManagementRefresh()
    assertSnapshotExcludesAssets(refresh.snapshot, assetIds)
    applyAssetSnapshot(refresh.snapshot)
    if (refresh.groups) applyAssetGroups(refresh.groups)
  }

  const saveAssetFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
    const saveAssetFolder = assetsClient.saveAssetFolder()
    if (!saveAssetFolder) throw new Error('目录保存服务不可用。')
    const result = await saveAssetFolder(folder)
    if (!result?.ok) throw new Error(result?.errorMessage || '目录保存失败')
    const saved = result.data
    if (!isAiopsSavedCustomFolderRecord(saved, folder)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadHostManagementRefresh()
    if (!snapshot.folders.some((item) => item.uuid === saved.uuid)) throw new Error(malformedAssetBackendResultMessage)
    applyHostManagementState(snapshot, groups)
    return saved
  }

  const refreshOrganizationAssets = async (expectedOrganizationId?: string, fallbackErrorMessage = '刷新堡垒机资源失败。') => {
    const refreshOrganizationAssets = assetsClient.refreshOrganizationAssets()
    if (!refreshOrganizationAssets) throw new Error('组织资产刷新服务不可用。')
    const result = await refreshOrganizationAssets(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
    if (!result?.ok) throw new Error(result?.errorMessage || fallbackErrorMessage)
    if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
    applyAssetSnapshot(result.data)
    return result.data
  }

  return {
    loadAssetGroupOptions,
    loadAssetSnapshot,
    applyAssetGroups,
    invalidateAssetGroups,
    applyAssetSnapshot,
    applyHostManagementState,
    refreshAssets,
    loadHostManagementRefresh,
    refreshAssetGroupOptions,
    refreshHostManagement,
    saveAssetRecord,
    deleteAssetRecords,
    saveAssetFolderRecord,
    refreshOrganizationAssets
  }
}
