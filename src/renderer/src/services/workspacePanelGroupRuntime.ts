import { reactive, ref, type ComputedRef, type Ref } from 'vue'

import type { AiopsAssetGroupRecord, AiopsAssetInput, AiopsCustomFolderSaveInput } from '@shared/contracts/assets'
import { assetsClient } from '@/services/assetsClient'
import {
  isAiopsAssetGroupDeleteSnapshot,
  isAiopsAssetGroupRenameSnapshot,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import {
  directGroupKey,
  folderGroupKey,
  ungroupedGroupName,
  type WorkspacePanelAsset,
  type WorkspacePanelFolder,
  type WorkspacePanelGroup,
  type WorkspaceTabKey
} from '@/services/workspaceAssetTreeRuntime'

type FolderModalMode = 'create' | 'edit-custom' | 'edit-direct'

type WorkspacePanelGroupRuntimeInput = {
  activeWorkspace: Ref<WorkspaceTabKey>
  customFolders: Ref<WorkspacePanelFolder[]>
  directFolders: ComputedRef<WorkspacePanelFolder[]>
  bastionFolders: ComputedRef<WorkspacePanelFolder[]>
  organizationAssets: ComputedRef<WorkspacePanelAsset[]>
  contextMenuAssetId: Ref<string | null>
  contextGroup: ComputedRef<WorkspacePanelGroup | null>
  groupByKey: (key: string) => WorkspacePanelGroup | null
  groupTargetPatch: (group: WorkspacePanelGroup | null, sourceAsset?: WorkspacePanelAsset) => Partial<AiopsAssetInput>
  folderByGroup: (group: WorkspacePanelGroup | null) => WorkspacePanelFolder | null
  findEditableAsset: (assetId: string) => WorkspacePanelAsset | null
  toAssetInput: (asset: WorkspacePanelAsset, patch?: Partial<AiopsAssetInput>) => AiopsAssetInput
  saveAssetRecord: (input: AiopsAssetInput) => Promise<WorkspacePanelAsset>
  saveFolderRecord: (folder: AiopsCustomFolderSaveInput) => Promise<WorkspacePanelFolder>
  deleteFolderRecord: (folderUuid: string) => Promise<void>
  loadDirectGroupOptions: () => Promise<AiopsAssetGroupRecord[]>
  applyWorkspaceAssetState: (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => unknown
  refreshAssets: () => Promise<unknown>
  expandGroup: (key: string) => Promise<boolean | void>
  removeExpandedGroup: (key: string) => Promise<boolean | void>
  replaceExpandedGroup: (oldKey: string, newKey: string) => Promise<boolean | void>
  closeContextMenu: () => void
  notice: Ref<string>
}

export const createWorkspacePanelGroupRuntime = ({
  activeWorkspace,
  customFolders,
  directFolders,
  bastionFolders,
  organizationAssets,
  contextMenuAssetId,
  contextGroup,
  groupByKey,
  groupTargetPatch,
  folderByGroup,
  findEditableAsset,
  toAssetInput,
  saveAssetRecord,
  saveFolderRecord,
  deleteFolderRecord,
  loadDirectGroupOptions,
  applyWorkspaceAssetState,
  refreshAssets,
  expandGroup,
  removeExpandedGroup,
  replaceExpandedGroup,
  closeContextMenu,
  notice
}: WorkspacePanelGroupRuntimeInput) => {
  const folderModal = reactive({ visible: false, mode: 'create' as FolderModalMode, targetKey: '', parentKey: '', fromMove: false })
  const folderForm = reactive({ name: '', description: '' })
  const folderFormError = ref('')
  const moveModal = reactive({ visible: false, assetId: '' })
  const deleteGroupModal = reactive({ visible: false, groupKey: '' })

  const openCreateFolder = (parentGroup?: WorkspacePanelGroup | null) => {
    folderModal.visible = true
    folderModal.mode = 'create'
    folderModal.targetKey = ''
    folderModal.parentKey = parentGroup?.key || ''
    folderModal.fromMove = false
    folderForm.name = ''
    folderForm.description = ''
    folderFormError.value = ''
    closeContextMenu()
  }

  const openCreateFolderFromMoveModal = () => {
    moveModal.visible = false
    openCreateFolder()
    folderModal.fromMove = true
  }

  const closeFolderModal = () => {
    folderModal.visible = false
    folderModal.targetKey = ''
    folderModal.parentKey = ''
    folderModal.fromMove = false
    folderForm.name = ''
    folderForm.description = ''
    folderFormError.value = ''
  }

  const closeMoveModal = () => {
    moveModal.visible = false
    moveModal.assetId = ''
  }

  const closeDeleteGroupModal = () => {
    deleteGroupModal.visible = false
    deleteGroupModal.groupKey = ''
  }

  const saveFolderForm = async () => {
    const name = folderForm.name.trim()
    if (!name) {
      folderFormError.value = '请输入文件夹名称'
      return
    }
    const scopedFolders = activeWorkspace.value === 'direct' ? directFolders.value : bastionFolders.value
    const duplicateCustomFolder = scopedFolders.some((folder) => folder.name === name && folder.uuid !== folderModal.targetKey)
    if (duplicateCustomFolder) {
      folderFormError.value = '文件夹名称已存在'
      return
    }

    if (folderModal.mode === 'create') {
      let parentUuid = ''
      const parentGroup = folderModal.parentKey ? groupByKey(folderModal.parentKey) : null
      if (parentGroup && (parentGroup.type === 'direct-group' || parentGroup.type === 'custom-folder')) {
        const parentFolder = folderByGroup(parentGroup)
        if (parentFolder) {
          parentUuid = parentFolder.uuid
        } else if (parentGroup.type === 'direct-group') {
          try {
            const createdParent = await saveFolderRecord({
              name: parentGroup.title,
              description: '',
              scope: 'direct'
            })
            parentUuid = createdParent.uuid
          } catch (error) {
            folderFormError.value = error instanceof Error ? error.message : '父分组保存失败'
            return
          }
        }
      }
      const folder: AiopsCustomFolderSaveInput = {
        name,
        description: folderForm.description.trim(),
        scope: activeWorkspace.value === 'direct' ? 'direct' : 'bastion',
        ...(parentUuid ? { parentUuid } : {})
      }
      try {
        const saved = await saveFolderRecord(folder)
        await expandGroup(activeWorkspace.value === 'direct' ? directGroupKey(saved.name) : saved.uuid)
        if (parentGroup) await expandGroup(parentGroup.key)
        notice.value = `已创建文件夹 ${saved.name}`
        closeFolderModal()
      } catch (error) {
        folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
      }
      return
    }

    if (folderModal.mode === 'edit-custom') {
      const folder = customFolders.value.find((item) => item.uuid === folderModal.targetKey)
      if (folder) {
        try {
          const saved = await saveFolderRecord({ ...folder, name, description: folderForm.description.trim() })
          notice.value = `已更新文件夹 ${saved.name}`
        } catch (error) {
          folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
          return
        }
      }
      closeFolderModal()
      return
    }

    const oldGroupName = folderModal.targetKey.replace(/^group-/, '')
    const oldKey = `group-${oldGroupName}`
    const newKey = `group-${name}`
    const existingFolder = directFolders.value.find((folder) => folder.name === oldGroupName || directGroupKey(folder.name) === folderModal.targetKey)
    const currentGroup = groupByKey(folderModal.targetKey)
    if (existingFolder && currentGroup?.originalCount === 0) {
      try {
        const saved = await saveFolderRecord({ ...existingFolder, name, description: folderForm.description.trim(), scope: 'direct' })
        await replaceExpandedGroup(oldKey, directGroupKey(saved.name))
        notice.value = `已更新分组 ${saved.name}`
        closeFolderModal()
      } catch (error) {
        folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
      }
      return
    }
    const input = {
      oldName: oldGroupName,
      newName: name,
      assetTypes: ['person' as const, 'switch' as const]
    }
    try {
      const renameAssetGroup = assetsClient.renameAssetGroup()
      if (typeof renameAssetGroup !== 'function') throw new Error('资产分组保存服务不可用')
      const result = await renameAssetGroup(input)
      if (!result?.ok) throw new Error(result?.errorMessage || '分组保存失败')
      if (!isAiopsAssetGroupRenameSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
      if (existingFolder) {
        await saveFolderRecord({ ...existingFolder, name, description: folderForm.description.trim(), scope: 'direct' })
      }
      await refreshAssets()
      await replaceExpandedGroup(oldKey, newKey)
      notice.value = `已更新分组 ${name}`
      closeFolderModal()
    } catch (error) {
      folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
    }
  }

  const folderNameByUuid = (folderUuid?: string) => customFolders.value.find((folder) => folder.uuid === folderUuid)?.name || ''

  const moveAssetToGroup = async (assetId: string, targetGroup: WorkspacePanelGroup | null) => {
    const asset = findEditableAsset(assetId)
    if (!asset || asset.isLocalShell || asset.asset_type === 'organization') return false
    try {
      await saveAssetRecord(toAssetInput(asset, groupTargetPatch(targetGroup, asset)))
      if (targetGroup) await expandGroup(targetGroup.key)
      return true
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '移动资产失败'
      return false
    }
  }

  const ensureDirectFolderForGroup = async (group: WorkspacePanelGroup) => {
    const existing = folderByGroup(group)
    if (existing) return existing
    return saveFolderRecord({ name: group.title, description: '', scope: 'direct' })
  }

  const moveGroupToParent = async (
    groupKey: string,
    parentGroup: WorkspacePanelGroup | null,
    isDescendantGroup: (groupKey: string, possibleDescendantKey: string) => boolean
  ) => {
    const group = groupByKey(groupKey)
    if (!group || group.type === 'system' || group.type === 'organization') return false
    if (parentGroup && (parentGroup.key === group.key || isDescendantGroup(group.key, parentGroup.key))) return false
    try {
      const folder =
        group.type === 'direct-group'
          ? await ensureDirectFolderForGroup(group)
          : customFolders.value.find((item) => item.uuid === group.folderUuid)
      if (!folder) return false
      const parentFolder =
        parentGroup && (parentGroup.type === 'direct-group' || parentGroup.type === 'custom-folder')
          ? parentGroup.type === 'direct-group'
            ? await ensureDirectFolderForGroup(parentGroup)
            : customFolders.value.find((item) => item.uuid === parentGroup.folderUuid)
          : null
      const saved = await saveFolderRecord({
        ...folder,
        parentUuid: parentFolder?.uuid || undefined,
        scope: activeWorkspace.value === 'direct' ? 'direct' : 'bastion'
      })
      if (parentGroup) await expandGroup(parentGroup.key)
      await expandGroup(activeWorkspace.value === 'direct' ? directGroupKey(saved.name) : saved.uuid)
      return true
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '移动分组失败'
      return false
    }
  }

  const openMoveModal = (assetId: string) => {
    moveModal.visible = true
    moveModal.assetId = assetId
    closeContextMenu()
  }

  const openMoveModalFromContext = () => {
    if (contextMenuAssetId.value) openMoveModal(contextMenuAssetId.value)
  }

  const moveAssetToFolder = async (folderUuid: string) => {
    const asset = findEditableAsset(moveModal.assetId)
    if (!asset) return
    const folder = customFolders.value.find((item) => item.uuid === folderUuid)
    const targetGroup = folder ? groupByKey(folderGroupKey(folder)) : null
    try {
      await saveAssetRecord(toAssetInput(asset, targetGroup ? groupTargetPatch(targetGroup, asset) : { folderUuid, organizationId: asset.organizationId || organizationAssets.value[0]?.uuid }))
      await expandGroup(targetGroup?.key || folderUuid)
      closeMoveModal()
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '移动资产失败'
    }
  }

  const removeAssetFromFolder = async (assetId: string) => {
    const asset = findEditableAsset(assetId)
    if (!asset || !asset.folderUuid) return
    try {
      await saveAssetRecord(toAssetInput(asset, groupTargetPatch(null, asset)))
      if (asset.organizationId) await expandGroup(asset.organizationId)
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '移除资产失败'
    }
    closeContextMenu()
  }

  const removeContextAssetFromFolder = () => {
    if (contextMenuAssetId.value) removeAssetFromFolder(contextMenuAssetId.value)
  }

  const openEditGroup = () => {
    const group = contextGroup.value
    if (!group) return
    folderModal.visible = true
    folderModal.targetKey = group.key
    folderModal.mode = group.type === 'custom-folder' ? 'edit-custom' : 'edit-direct'
    folderForm.name = group.title
    folderForm.description = group.type === 'custom-folder' ? customFolders.value.find((folder) => folder.uuid === group.folderUuid)?.description || '' : ''
    folderFormError.value = ''
    closeContextMenu()
  }

  const openDeleteGroup = () => {
    if (!contextGroup.value) return
    deleteGroupModal.visible = true
    deleteGroupModal.groupKey = contextGroup.value.key
    closeContextMenu()
  }

  const confirmDeleteGroup = () => {
    const group = groupByKey(deleteGroupModal.groupKey)
    if (!group) return
    if (group.type === 'custom-folder') {
      deleteFolderRecord(group.folderUuid || group.key)
        .then(async () => {
          await removeExpandedGroup(group.key)
          notice.value = `已删除文件夹 ${group.title}`
          closeDeleteGroupModal()
        })
        .catch((error) => {
          notice.value = error instanceof Error ? error.message : '删除文件夹失败'
        })
      return
    }
    if (group.type === 'direct-group' && group.groupName) {
      if (group.originalCount === 0 && group.folderUuid) {
        deleteFolderRecord(group.folderUuid)
          .then(async () => {
            await removeExpandedGroup(group.key)
            notice.value = `已删除分组 ${group.title}`
            closeDeleteGroupModal()
          })
          .catch((error) => {
            notice.value = error instanceof Error ? error.message : '删除分组失败'
          })
        return
      }
      const deleteAssetGroup = assetsClient.deleteAssetGroup()
      if (typeof deleteAssetGroup !== 'function') {
        notice.value = '资产分组删除服务不可用'
        return
      }
      const input = {
        name: group.groupName,
        fallbackName: ungroupedGroupName,
        assetTypes: ['person' as const, 'switch' as const]
      }
      deleteAssetGroup(input)
        .then(async (result) => {
          if (!result?.ok) throw new Error(result?.errorMessage || '删除分组失败')
          if (!isAiopsAssetGroupDeleteSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
          const groups = await loadDirectGroupOptions()
          applyWorkspaceAssetState(result.data, groups)
          if (group.folderUuid) {
            await deleteFolderRecord(group.folderUuid)
          }
          await removeExpandedGroup(group.key)
          notice.value = `已删除分组 ${group.title}`
          closeDeleteGroupModal()
        })
        .catch((error) => {
          notice.value = error instanceof Error ? error.message : '删除分组失败'
        })
      return
    }
    closeDeleteGroupModal()
  }

  return {
    folderModal,
    folderForm,
    folderFormError,
    moveModal,
    deleteGroupModal,
    openCreateFolder,
    openCreateFolderFromMoveModal,
    closeFolderModal,
    closeMoveModal,
    closeDeleteGroupModal,
    saveFolderForm,
    folderNameByUuid,
    moveAssetToGroup,
    moveGroupToParent,
    openMoveModal,
    openMoveModalFromContext,
    moveAssetToFolder,
    removeAssetFromFolder,
    removeContextAssetFromFolder,
    openEditGroup,
    openDeleteGroup,
    confirmDeleteGroup
  }
}
