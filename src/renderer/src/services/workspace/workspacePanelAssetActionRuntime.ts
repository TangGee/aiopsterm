import { computed, reactive, type ComputedRef, type Ref } from 'vue'

import type { useWorkspaceStore } from '@/stores/workspace'
import type {
  WorkspacePanelAsset,
  WorkspacePanelGroup
} from '@/services/assets/workspaceAssetTreeRuntime'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type WorkspacePanelAssetActionRuntimeInput = {
  workspace: WorkspaceStore
  selectedAssetId: Ref<string | null>
  contextAsset: ComputedRef<WorkspacePanelAsset | null>
  contextGroup: ComputedRef<WorkspacePanelGroup | null>
  workspaceAssets: Ref<WorkspacePanelAsset[]>
  organizationAssets: ComputedRef<WorkspacePanelAsset[]>
  bastionResourceAssets: ComputedRef<WorkspacePanelAsset[]>
  deleteAssetRecord: (assetId: string) => Promise<void>
  removeExpandedGroup: (key: string) => Promise<boolean | void>
  closeContextMenu: () => void
  notice: Ref<string>
}

export const createWorkspacePanelAssetActionRuntime = ({
  workspace,
  selectedAssetId,
  contextAsset,
  contextGroup,
  workspaceAssets,
  organizationAssets,
  bastionResourceAssets,
  deleteAssetRecord,
  removeExpandedGroup,
  closeContextMenu,
  notice
}: WorkspacePanelAssetActionRuntimeInput) => {
  const deleteAssetModal = reactive({ visible: false, assetId: '' })
  const managementModal = reactive({ visible: false, organizationId: '', query: '' })

  const deleteAssetInfo = computed(() => workspaceAssets.value.find((asset) => asset.id === deleteAssetModal.assetId) || null)
  const managedOrganization = computed(() => organizationAssets.value.find((asset) => asset.uuid === managementModal.organizationId) || null)
  const managedOrganizationAssets = computed(() => {
    const keyword = managementModal.query.trim().toLowerCase()
    return bastionResourceAssets.value
      .filter((asset) => !managementModal.organizationId || asset.organizationId === managementModal.organizationId)
      .filter((asset) => {
        if (!keyword) return true
        return `${asset.name} ${asset.host} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
      })
  })

  const closeDeleteAssetModal = () => {
    deleteAssetModal.visible = false
    deleteAssetModal.assetId = ''
  }

  const closeManagementModal = () => {
    managementModal.visible = false
    managementModal.organizationId = ''
    managementModal.query = ''
  }

  const openManagementForOrganization = (organizationId: string) => {
    managementModal.visible = true
    managementModal.organizationId = organizationId
    managementModal.query = ''
    closeContextMenu()
  }

  const openContextOrganizationManagement = () => {
    if (contextAsset.value) openManagementForOrganization(contextAsset.value.uuid)
  }

  const openGroupOrganizationManagement = () => {
    if (contextGroup.value?.organizationId) openManagementForOrganization(contextGroup.value.organizationId)
  }

  const openDeleteGroupOrganization = () => {
    const group = contextGroup.value
    if (!group?.organizationId) return
    deleteAssetModal.visible = true
    deleteAssetModal.assetId = organizationAssets.value.find((asset) => asset.uuid === group.organizationId)?.id || ''
    closeContextMenu()
  }

  const openDeleteContextAsset = () => {
    if (!contextAsset.value || contextAsset.value.isLocalShell) return
    deleteAssetModal.visible = true
    deleteAssetModal.assetId = contextAsset.value.id
    closeContextMenu()
  }

  const confirmDeleteAsset = async () => {
    const asset = deleteAssetInfo.value
    if (!asset) return
    try {
      await deleteAssetRecord(asset.id)
      if (asset.asset_type === 'organization') await removeExpandedGroup(asset.uuid)
      workspace.setSelectedContexts(workspace.selectedContexts.filter((context) => context.id !== asset.id))
      selectedAssetId.value = selectedAssetId.value === asset.id ? null : selectedAssetId.value
      notice.value = `已删除主机 ${asset.name}`
      closeDeleteAssetModal()
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '删除主机失败'
    }
  }

  return {
    deleteAssetModal,
    managementModal,
    deleteAssetInfo,
    managedOrganization,
    managedOrganizationAssets,
    closeDeleteAssetModal,
    closeManagementModal,
    openContextOrganizationManagement,
    openGroupOrganizationManagement,
    openDeleteGroupOrganization,
    openDeleteContextAsset,
    confirmDeleteAsset
  }
}
