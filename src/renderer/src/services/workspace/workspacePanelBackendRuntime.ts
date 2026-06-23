import type { Ref } from 'vue'

import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetSnapshot,
  AiopsCustomFolderSaveInput,
  AiopsKeychainRecord
} from '@shared/contracts/assets'
import { assetsClient } from '@/services/assets/assetsClient'
import {
  isAiopsAssetGroupListData,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsDeletedCustomFolderData,
  isAiopsJumpserverOrganizationAssetRefreshData,
  isAiopsKeychainListData,
  isAiopsSavedAssetRecord,
  isAiopsSavedCustomFolderRecord,
  malformedAssetBackendResultMessage
} from '@/services/assets/assetBackendGuards'
import type {
  WorkspacePanelAsset,
  WorkspacePanelFolder
} from '@/services/assets/workspaceAssetTreeRuntime'

type WorkspacePanelBackendState = {
  workspaceAssets: Ref<WorkspacePanelAsset[]>
  customFolders: Ref<WorkspacePanelFolder[]>
  directGroupOptions: Ref<AiopsAssetGroupRecord[]>
  keychainOptions: Ref<AiopsKeychainRecord[]>
}

export const workspacePanelAssetToInput = (asset: WorkspacePanelAsset, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
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
  jumpHostId: asset.jumpHostId,
  ...patch
})

export const createWorkspacePanelBackendRuntime = ({
  workspaceAssets,
  customFolders,
  directGroupOptions,
  keychainOptions
}: WorkspacePanelBackendState) => {
  const applyWorkspaceAssetSnapshot = (snapshot: unknown) => {
    if (!isAiopsAssetSnapshot(snapshot)) return false
    workspaceAssets.value = snapshot.assets.map((asset) => ({ ...asset, tags: [...asset.tags] }))
    customFolders.value = snapshot.folders.map((folder) => ({ ...folder }))
    return true
  }

  const applyWorkspaceAssetState = (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => {
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
    applyWorkspaceAssetSnapshot(snapshot)
    directGroupOptions.value = groups
    return snapshot
  }

  const loadAssetSnapshot = async () => {
    const listAssets = assetsClient.listAssets()
    if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
    const snapshot = await listAssets()
    if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
    return snapshot
  }

  const loadDirectGroupOptions = async () => {
    const listAssetGroups = assetsClient.listAssetGroups()
    if (typeof listAssetGroups !== 'function') throw new Error('资产分组服务不可用')
    const groups = await listAssetGroups({
      assetTypes: ['person', 'switch']
    })
    if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
    return groups.map((group) => ({ ...group }))
  }

  const loadWorkspaceAssetRefresh = async () => {
    const snapshot = await loadAssetSnapshot()
    const groups = await loadDirectGroupOptions()
    return { snapshot, groups }
  }

  const refreshAssets = async () => {
    const { snapshot, groups } = await loadWorkspaceAssetRefresh()
    return applyWorkspaceAssetState(snapshot, groups)
  }

  const loadKeychainOptions = async () => {
    const listKeychains = assetsClient.listKeychains()
    if (typeof listKeychains !== 'function') {
      keychainOptions.value = []
      return
    }
    const keychains = await listKeychains()
    if (!isAiopsKeychainListData(keychains)) throw new Error(malformedAssetBackendResultMessage)
    keychainOptions.value = keychains.map((keychain) => ({ ...keychain }))
  }

  const assertSnapshotIncludesAsset = (snapshot: AiopsAssetSnapshot, assetId: string) => {
    if (!snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
  }

  const assertSnapshotExcludesAsset = (snapshot: AiopsAssetSnapshot, assetId: string) => {
    if (snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
  }

  const saveAssetRecord = async (input: AiopsAssetInput) => {
    const saveAsset = assetsClient.saveAsset()
    if (typeof saveAsset !== 'function') throw new Error('资产保存服务不可用')
    const result = await saveAsset(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
    const saved = result.data
    if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadWorkspaceAssetRefresh()
    assertSnapshotIncludesAsset(snapshot, saved.id)
    applyWorkspaceAssetState(snapshot, groups)
    return saved
  }

  const deleteAssetRecord = async (assetId: string) => {
    const deleteAsset = assetsClient.deleteAsset()
    if (typeof deleteAsset !== 'function') throw new Error('资产删除服务不可用')
    const result = await deleteAsset(assetId)
    if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
    if (!isAiopsDeletedAssetData(result.data, assetId)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadWorkspaceAssetRefresh()
    assertSnapshotExcludesAsset(snapshot, assetId)
    applyWorkspaceAssetState(snapshot, groups)
  }

  const saveFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
    const saveAssetFolder = assetsClient.saveAssetFolder()
    if (typeof saveAssetFolder !== 'function') throw new Error('文件夹保存服务不可用')
    const result = await saveAssetFolder(folder)
    if (!result?.ok) throw new Error(result?.errorMessage || '文件夹保存失败')
    const saved = result.data
    if (!isAiopsSavedCustomFolderRecord(saved, folder)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadWorkspaceAssetRefresh()
    if (!snapshot.folders.some((item) => item.uuid === saved.uuid)) throw new Error(malformedAssetBackendResultMessage)
    applyWorkspaceAssetState(snapshot, groups)
    return saved
  }

  const deleteFolderRecord = async (folderUuid: string) => {
    const deleteAssetFolder = assetsClient.deleteAssetFolder()
    if (typeof deleteAssetFolder !== 'function') throw new Error('文件夹删除服务不可用')
    const result = await deleteAssetFolder(folderUuid)
    if (!result?.ok) throw new Error(result?.errorMessage || '文件夹删除失败')
    if (!isAiopsDeletedCustomFolderData(result.data, folderUuid)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadWorkspaceAssetRefresh()
    if (snapshot.folders.some((folder) => folder.uuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
    if (snapshot.assets.some((asset) => asset.folderUuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
    applyWorkspaceAssetState(snapshot, groups)
  }

  const refreshOrganizationAssets = async (expectedOrganizationId?: string) => {
    const refresh = assetsClient.refreshOrganizationAssets()
    if (typeof refresh !== 'function') throw new Error('组织资产刷新服务不可用')
    const result = await refresh(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
    if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败')
    if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
    const groups = await loadDirectGroupOptions()
    applyWorkspaceAssetState(result.data, groups)
    return result.data
  }

  return {
    applyWorkspaceAssetSnapshot,
    applyWorkspaceAssetState,
    loadAssetSnapshot,
    loadDirectGroupOptions,
    loadWorkspaceAssetRefresh,
    refreshAssets,
    loadKeychainOptions,
    saveAssetRecord,
    deleteAssetRecord,
    saveFolderRecord,
    deleteFolderRecord,
    refreshOrganizationAssets
  }
}
