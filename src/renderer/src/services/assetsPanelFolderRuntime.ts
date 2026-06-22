import { reactive, ref, type ComputedRef, type Ref } from 'vue'

import type {
  AiopsAssetGroupRecord,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput
} from '@shared/contracts/assets'
import { assetsClient } from '@/services/assetsClient'
import {
  isAiopsSavedCustomFolderRecord,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import {
  directGroupKey,
  flattenAssetGroups,
  type AssetsPanelGroup
} from '@/services/assetsPanelTreeRuntime'

type AssetsPanelFolderRuntimeInput = {
  assetGroups: ComputedRef<AssetsPanelGroup[]>
  bastionAssetFolders: ComputedRef<AiopsCustomFolderRecord[]>
  expandedAssetGroupKeys: Ref<string[]>
  expandedManagedGroupKeys: Ref<string[]>
  assetGroupByKey: (key: string, scope?: 'direct' | 'bastion') => AssetsPanelGroup | null
  assetFolderByGroup: (group: AssetsPanelGroup | null, scope?: 'direct' | 'bastion') => AiopsCustomFolderRecord | null
  loadHostManagementRefresh: () => Promise<{ snapshot: unknown; groups: AiopsAssetGroupRecord[] }>
  applyHostManagementState: (snapshot: unknown, groups: AiopsAssetGroupRecord[]) => unknown
  closeAssetContextMenus: () => void
  importNotice: Ref<string>
}

export const createAssetsPanelFolderRuntime = ({
  assetGroups,
  bastionAssetFolders,
  expandedAssetGroupKeys,
  expandedManagedGroupKeys,
  assetGroupByKey,
  assetFolderByGroup,
  loadHostManagementRefresh,
  applyHostManagementState,
  closeAssetContextMenus,
  importNotice
}: AssetsPanelFolderRuntimeInput) => {
  const assetFolderModal = reactive<{ visible: boolean; parentKey: string; scope: 'direct' | 'bastion' }>({ visible: false, parentKey: '', scope: 'direct' })
  const assetFolderForm = reactive({ name: '', description: '' })
  const assetFolderFormError = ref('')

  const saveAssetFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
    const saveAssetFolder = assetsClient.saveAssetFolder()
    if (!saveAssetFolder) throw new Error('目录保存服务不可用。')
    const result = await saveAssetFolder(folder)
    if (!result?.ok) throw new Error(result?.errorMessage || '目录保存失败')
    if (!isAiopsSavedCustomFolderRecord(result.data, folder)) throw new Error(malformedAssetBackendResultMessage)
    const { snapshot, groups } = await loadHostManagementRefresh()
    applyHostManagementState(snapshot, groups)
    return result.data
  }

  const ensureAssetFolderForGroup = async (group: AssetsPanelGroup, scope: 'direct' | 'bastion' = 'direct') => {
    const existing = assetFolderByGroup(group, scope)
    if (existing) return existing
    return saveAssetFolderRecord({ name: group.title, description: '', scope })
  }

  const openCreateAssetFolder = (parentGroup?: AssetsPanelGroup | null, scope: 'direct' | 'bastion' = 'direct') => {
    assetFolderModal.visible = true
    assetFolderModal.parentKey = parentGroup?.key || ''
    assetFolderModal.scope = scope
    assetFolderForm.name = ''
    assetFolderForm.description = ''
    assetFolderFormError.value = ''
    closeAssetContextMenus()
  }

  const openCreateAssetFolderFromContext = (groupKey = '') => {
    openCreateAssetFolder(groupKey ? assetGroupByKey(groupKey, 'direct') : null)
  }

  const closeAssetFolderModal = () => {
    assetFolderModal.visible = false
    assetFolderModal.parentKey = ''
    assetFolderModal.scope = 'direct'
    assetFolderForm.name = ''
    assetFolderForm.description = ''
    assetFolderFormError.value = ''
  }

  const submitAssetFolderForm = async () => {
    const name = assetFolderForm.name.trim()
    if (!name) {
      assetFolderFormError.value = '请输入目录名称'
      return
    }
    const duplicate =
      assetFolderModal.scope === 'direct'
        ? flattenAssetGroups(assetGroups.value).some((group) => group.title === name)
        : bastionAssetFolders.value.some((folder) => folder.name === name)
    if (duplicate) {
      assetFolderFormError.value = '目录名称已存在'
      return
    }
    let parentUuid = ''
    const parentGroup = assetFolderModal.parentKey ? assetGroupByKey(assetFolderModal.parentKey, assetFolderModal.scope) : null
    if (parentGroup) {
      try {
        parentUuid = (await ensureAssetFolderForGroup(parentGroup, assetFolderModal.scope)).uuid
      } catch (error) {
        assetFolderFormError.value = error instanceof Error ? error.message : '父目录保存失败'
        return
      }
    }
    try {
      const saved = await saveAssetFolderRecord({
        name,
        description: assetFolderForm.description.trim(),
        scope: assetFolderModal.scope,
        ...(parentUuid ? { parentUuid } : {})
      })
      if (assetFolderModal.scope === 'direct') {
        expandedAssetGroupKeys.value = Array.from(new Set([...expandedAssetGroupKeys.value, directGroupKey(saved.name), ...(parentGroup ? [parentGroup.key] : [])]))
      } else {
        expandedManagedGroupKeys.value = Array.from(new Set([...expandedManagedGroupKeys.value, `managed-folder-${saved.uuid}`, ...(parentGroup ? [parentGroup.key] : [])]))
      }
      importNotice.value = `已创建目录 ${saved.name}。`
      closeAssetFolderModal()
    } catch (error) {
      assetFolderFormError.value = error instanceof Error ? error.message : '目录保存失败'
    }
  }

  return {
    assetFolderModal,
    assetFolderForm,
    assetFolderFormError,
    saveAssetFolderRecord,
    openCreateAssetFolder,
    openCreateAssetFolderFromContext,
    closeAssetFolderModal,
    submitAssetFolderForm
  }
}
