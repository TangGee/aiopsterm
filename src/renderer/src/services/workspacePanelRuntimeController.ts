import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { AiopsAssetGroupRecord, AiopsAssetInput, AiopsKeychainRecord } from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  createWorkspacePanelBackendRuntime,
  workspacePanelAssetToInput
} from '@/services/workspacePanelBackendRuntime'
import {
  assetGroupAssetCount,
  assetGroupName,
  buildBastionGroups,
  buildDirectGroups,
  collectGroupAssets,
  collectTreeRows,
  filterGroupTree,
  flattenGroups,
  ungroupedGroupName,
  type WorkspacePanelAsset,
  type WorkspacePanelFolder,
  type WorkspacePanelGroup
} from '@/services/workspaceAssetTreeRuntime'
import type { WorkspaceTabKey } from '@/services/workspaceAssetTreeRuntime'
import { createWorkspacePanelHostRuntime } from '@/services/workspacePanelHostRuntime'
import { createWorkspacePanelGroupRuntime } from '@/services/workspacePanelGroupRuntime'
import { createWorkspacePanelDragRuntime } from '@/services/workspacePanelDragRuntime'
import { createWorkspacePanelTunnelRuntime } from '@/services/workspacePanelTunnelRuntime'
import { createWorkspacePanelAssetActionRuntime } from '@/services/workspacePanelAssetActionRuntime'
import { createWorkspacePanelContextRuntime } from '@/services/workspacePanelContextRuntime'
import { createWorkspacePanelAssetInteractionRuntime } from '@/services/workspacePanelAssetInteractionRuntime'

export const useWorkspacePanelRuntime = () => {
  const workspace = useWorkspaceStore()

  const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
    { key: 'direct', label: '直接连接' },
    { key: 'bastion', label: '堡垒机资源' }
  ]

  const activeWorkspace = ref<WorkspaceTabKey>('direct')
  const searchValue = ref('')
  const selectedAssetId = ref<string | null>(null)
  const notice = ref('')

  const workspaceAssets = ref<WorkspacePanelAsset[]>([])

  const customFolders = ref<WorkspacePanelFolder[]>([])
  const directGroupOptions = ref<AiopsAssetGroupRecord[]>([])
  const keychainOptions = ref<AiopsKeychainRecord[]>([])

  const localShellAssets = computed(() => workspaceAssets.value.filter((asset) => asset.isLocalShell))
  const directAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && (asset.asset_type === 'person' || asset.asset_type === 'switch')))
  const organizationAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type === 'organization'))
  const bastionResourceAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && (asset.organizationId || asset.folderUuid)))
  const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
  const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)
  const recentAssetIds = computed(() => workspace.workspacePreferences.recentAssetIds || [])
  const directFolders = computed(() => customFolders.value.filter((folder) => folder.scope === 'direct'))
  const bastionFolders = computed(() => customFolders.value.filter((folder) => folder.scope !== 'direct'))
  const targetMoveFolders = computed(() => (activeWorkspace.value === 'direct' ? directFolders.value : bastionFolders.value))
  const hostGroupOptions = computed(() => {
    if (activeWorkspace.value === 'direct') {
      const folderOptions = directFolders.value.map((folder) => ({ key: folder.uuid, name: folder.name, count: directAssets.value.filter((asset) => assetGroupName(asset) === folder.name).length }))
      const optionNames = new Set(folderOptions.map((group) => group.name))
      return [...folderOptions, ...directGroupOptions.value.filter((group) => !optionNames.has(group.name))]
    }
    return [
      ...organizationAssets.value.map((asset) => ({ key: asset.uuid, name: asset.name, count: 1 })),
      ...bastionFolders.value.map((folder) => ({ key: folder.uuid, name: folder.name, count: bastionResourceAssets.value.filter((asset) => asset.folderUuid === folder.uuid).length }))
    ]
  })
  const isDescendantGroup = (groupKey: string, possibleDescendantKey: string): boolean => {
    const walk = (group: WorkspacePanelGroup): boolean => group.childGroups.some((child) => child.key === possibleDescendantKey || walk(child))
    const root = sourceGroups.value.find((group) => group.key === groupKey) || sourceGroups.value.flatMap((group) => flattenGroups(group)).find((group) => group.key === groupKey)
    return root ? walk(root) : false
  }

  const sourceGroups = computed(() =>
    activeWorkspace.value === 'direct'
      ? buildDirectGroups({
          directAssets: directAssets.value,
          localShellAssets: localShellAssets.value,
          directFolders: directFolders.value,
          recentAssetIds: recentAssetIds.value
        })
      : buildBastionGroups({
          bastionFolders: bastionFolders.value,
          bastionResourceAssets: bastionResourceAssets.value,
          organizationAssets: organizationAssets.value
        })
  )

  const filteredGroups = computed(() => {
    const keyword = searchValue.value.trim().toLowerCase()
    if (!keyword) return sourceGroups.value
    return sourceGroups.value.map((group) => filterGroupTree(group, keyword)).filter((group): group is WorkspacePanelGroup => Boolean(group))
  })

  const visibleTreeRows = computed(() => collectTreeRows(filteredGroups.value, isGroupExpanded))
  const allAssets = computed(() => sourceGroups.value.flatMap(collectGroupAssets))
  const deleteGroupInfo = computed(() => {
    const group = groupByKey(deleteGroupModal.groupKey)
    if (!group) return null
    return {
      key: group.key,
      name: group.title,
      count: group.originalCount,
      kind: group.type
    }
  })

const backendRuntime = createWorkspacePanelBackendRuntime({
  workspaceAssets,
  customFolders,
  directGroupOptions,
  keychainOptions
})
const {
  applyWorkspaceAssetSnapshot,
  applyWorkspaceAssetState,
  loadDirectGroupOptions,
  refreshAssets,
  loadKeychainOptions,
  saveAssetRecord,
  deleteAssetRecord,
  saveFolderRecord,
  deleteFolderRecord,
  refreshOrganizationAssets
} = backendRuntime

const findEditableAsset = (assetId: string) => workspaceAssets.value.find((item) => item.id === assetId) || null

const toAssetInput = (asset: WorkspacePanelAsset, patch: Partial<AiopsAssetInput> = {}) => workspacePanelAssetToInput(asset, patch)

const isGroupExpanded = (key: string) => !!searchValue.value.trim() || expandedGroups.value.includes(key)

const updateExpandedGroups = (next: string[]) => workspace.updateWorkspacePreferences({ expandedGroups: [...new Set(next)] })

const toggleGroup = async (key: string) => {
  const next = expandedGroups.value.includes(key)
    ? expandedGroups.value.filter((item) => item !== key)
    : [...expandedGroups.value, key]
  await updateExpandedGroups(next)
}

const expandGroup = async (key: string) => {
  if (!expandedGroups.value.includes(key)) {
    return updateExpandedGroups([...expandedGroups.value, key])
  }
  return true
}

const removeExpandedGroup = async (key: string) => {
  if (expandedGroups.value.includes(key)) {
    return updateExpandedGroups(expandedGroups.value.filter((item) => item !== key))
  }
  return true
}

const replaceExpandedGroup = async (oldKey: string, newKey: string) => {
  if (!expandedGroups.value.includes(oldKey)) return true
  return updateExpandedGroups(expandedGroups.value.map((item) => (item === oldKey ? newKey : item)))
}

const groupByKey = (key: string) => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === key) || null

const contextRuntime = createWorkspacePanelContextRuntime({
  activeWorkspace,
  selectedAssetId,
  allAssets,
  sourceGroups,
  groupByKey
})

const {
  contextMenuAssetId,
  contextMenuGroupKey,
  blankContextMenuVisible,
  contextMenuPosition,
  contextAsset,
  contextGroup,
  canCommentContextAsset,
  canMoveContextAsset,
  canRemoveContextAssetFromFolder,
  canConnectContextAsset,
  canCreateChildInContextGroup,
  canCreateHostInContextGroup,
  closeMenus,
  closeContextMenu,
  openContextMenu,
  openGroupContextMenu,
  openBlankContextMenu
} = contextRuntime

const folderByGroup = (group: WorkspacePanelGroup | null) => {
  if (!group) return null
  if (group.type === 'direct-group') {
    return directFolders.value.find((folder) => folder.name === group.groupName || folder.uuid === group.folderUuid) || null
  }
  if (group.type === 'custom-folder') {
    return bastionFolders.value.find((folder) => folder.uuid === group.folderUuid) || null
  }
  return null
}

const groupTargetPatch = (group: WorkspacePanelGroup | null, sourceAsset?: WorkspacePanelAsset): Partial<AiopsAssetInput> => {
  if (!group) {
    if (activeWorkspace.value === 'direct') {
      return { group: ungroupedGroupName, group_name: ungroupedGroupName, folderUuid: undefined }
    }
    if (activeWorkspace.value === 'bastion' && sourceAsset?.asset_type !== 'organization') {
      return { folderUuid: undefined, organizationId: organizationAssets.value[0]?.uuid || sourceAsset?.organizationId }
    }
    return { folderUuid: undefined }
  }
  if (group.type === 'direct-group') {
    return { group: group.groupName || group.title, group_name: group.groupName || group.title, folderUuid: undefined }
  }
  if (group.type === 'custom-folder') {
    return { folderUuid: group.folderUuid || group.key, organizationId: sourceAsset?.organizationId || organizationAssets.value[0]?.uuid }
  }
  if (group.type === 'organization') {
    return { folderUuid: undefined, organizationId: group.organizationId || group.key }
  }
  return {}
}

const groupRuntime = createWorkspacePanelGroupRuntime({
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
})

const hostRuntime = createWorkspacePanelHostRuntime({
  workspace,
  activeWorkspace,
  workspaceAssets,
  keychainOptions,
  organizationAssets,
  contextAsset,
  groupByKey,
  groupTargetPatch,
  findEditableAsset,
  saveAssetRecord,
  loadKeychainOptions,
  expandGroup,
  closeContextMenu,
  notice
})

const tunnelRuntime = createWorkspacePanelTunnelRuntime({
  contextMenuAssetId,
  findEditableAsset,
  applyWorkspaceAssetSnapshot,
  closeContextMenu,
  notice
})

const assetActionRuntime = createWorkspacePanelAssetActionRuntime({
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
})

const dragRuntime = createWorkspacePanelDragRuntime({
  visibleTreeRows,
  groupByKey,
  isDescendantGroup,
  moveAssetToGroup: groupRuntime.moveAssetToGroup,
  moveGroupToParent: groupRuntime.moveGroupToParent
})

const {
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
  openMoveModal,
  openMoveModalFromContext,
  moveAssetToFolder,
  removeAssetFromFolder,
  removeContextAssetFromFolder,
  openEditGroup,
  openDeleteGroup,
  confirmDeleteGroup
} = groupRuntime

const {
  hostModal,
  hostForm,
  hostFormError,
  hostTestLoading,
  hostTestMessage,
  hostTestOk,
  hostPasswordVisible,
  hostJumpPasswordVisible,
  hostChildModal,
  hostChildFormError,
  hostKeyForm,
  hostKeyDragOver,
  hostJumpForm,
  jumpHostOptions,
  hostModalTitle,
  openHostKeyImportDialog,
  handleHostKeyDrop,
  saveHostProxyForm,
  saveHostKeyForm,
  saveHostJumpHostForm,
  openCreateHost,
  closeHostModal,
  closeHostChildModal,
  openKeyManagementFromHostForm,
  openProxyManagementFromHostForm,
  openJumpHostCreateFromHostForm,
  editContextAsset,
  cloneContextAsset,
  testHostFormConnection,
  saveHostForm
} = hostRuntime

const {
  tunnelModal,
  tunnelForm,
  tunnelFormError,
  tunnelSubmitting,
  tunnelAsset,
  tunnelTypeOptions,
  closeTunnelModal,
  toggleTunnel,
  startTunnelFromModal,
  handleTunnelTypeChange
} = tunnelRuntime

const {
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
} = assetActionRuntime

const {
  dragOverGroupKey,
  dragOverAssetId,
  canDragAsset,
  canDragGroup,
  clearDragState,
  handleAssetDragStart,
  handleGroupDragStart,
  handleGroupDragOver,
  handleGroupDragLeave,
  handleGroupDrop,
  handleAssetDragOver,
  handleAssetDragLeave,
  handleAssetDrop,
  handleBlankDragOver,
  handleBlankDragLeave,
  handleBlankDrop
} = dragRuntime

const assetInteractionRuntime = createWorkspacePanelAssetInteractionRuntime({
  workspace,
  selectedAssetId,
  contextMenuAssetId,
  contextAsset,
  allAssets,
  recentAssetIds,
  organizationAssets,
  findEditableAsset,
  toAssetInput,
  saveAssetRecord,
  refreshOrganizationAssets,
  expandGroup,
  closeContextMenu,
  notice
})

const {
  refreshingGroupKey,
  commentAssetId,
  editingComment,
  selectAsset,
  connectAsset,
  connectContextAsset,
  toggleFavorite,
  openContextComment,
  saveComment,
  cancelComment,
  refreshGroup,
  refreshContextOrganization
} = assetInteractionRuntime

const displayAsset = (asset: WorkspacePanelAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const toggleDisplayMode = async () => {
  await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const closeMenusFromDocument = () => closeMenus()

onMounted(() => {
  document.addEventListener('click', closeMenusFromDocument)
  Promise.all([workspace.hydrateConfig(), refreshAssets(), loadKeychainOptions()]).catch((error) => {
    notice.value = error instanceof Error ? error.message : '资产加载失败'
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenusFromDocument)
})

watch(activeWorkspace, () => {
  closeMenus()
  closeMoveModal()
  closeFolderModal()
  closeDeleteGroupModal()
  closeHostModal()
  closeTunnelModal()
  closeDeleteAssetModal()
  closeManagementModal()
  cancelComment()
  searchValue.value = ''
  selectedAssetId.value = null
})

watch(
  () => tunnelForm.type,
  (type, previousType) => {
    if (!tunnelModal.visible || type === previousType) return
    handleTunnelTypeChange(type, previousType)
  }
)

  return {
    workspace,
    workspaceTabs,
    activeWorkspace,
    searchValue,
    selectedAssetId,
    contextMenuAssetId,
    contextMenuGroupKey,
    blankContextMenuVisible,
    contextMenuPosition,
    refreshingGroupKey,
    notice,
    commentAssetId,
    editingComment,
    dragOverGroupKey,
    dragOverAssetId,
    keychainOptions,
    folderModal,
    folderForm,
    folderFormError,
    moveModal,
    deleteGroupModal,
    hostModal,
    hostForm,
    hostFormError,
    hostTestLoading,
    hostTestMessage,
    hostTestOk,
    hostPasswordVisible,
    hostJumpPasswordVisible,
    hostChildModal,
    hostChildFormError,
    hostKeyForm,
    hostKeyDragOver,
    hostJumpForm,
    deleteAssetModal,
    managementModal,
    tunnelModal,
    tunnelForm,
    tunnelFormError,
    tunnelSubmitting,
    showIpMode,
    targetMoveFolders,
    hostGroupOptions,
    jumpHostOptions,
    assetGroupAssetCount,
    visibleTreeRows,
    contextAsset,
    contextGroup,
    canCommentContextAsset,
    canMoveContextAsset,
    canRemoveContextAssetFromFolder,
    canConnectContextAsset,
    canCreateChildInContextGroup,
    canCreateHostInContextGroup,
    tunnelAsset,
    hostModalTitle,
    tunnelTypeOptions,
    deleteAssetInfo,
    deleteGroupInfo,
    managedOrganization,
    managedOrganizationAssets,
    openHostKeyImportDialog,
    handleHostKeyDrop,
    saveHostProxyForm,
    saveHostKeyForm,
    saveHostJumpHostForm,
    isGroupExpanded,
    toggleGroup,
    closeMenus,
    openCreateFolder,
    openCreateFolderFromMoveModal,
    openCreateHost,
    closeFolderModal,
    closeMoveModal,
    closeDeleteGroupModal,
    closeHostModal,
    closeTunnelModal,
    closeDeleteAssetModal,
    closeManagementModal,
    saveFolderForm,
    displayAsset,
    folderNameByUuid,
    toggleDisplayMode,
    selectAsset,
    connectAsset,
    openContextMenu,
    openGroupContextMenu,
    openBlankContextMenu,
    canDragAsset,
    canDragGroup,
    clearDragState,
    handleAssetDragStart,
    handleGroupDragStart,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
    handleAssetDragOver,
    handleAssetDragLeave,
    handleAssetDrop,
    handleBlankDragOver,
    handleBlankDragLeave,
    handleBlankDrop,
    connectContextAsset,
    toggleFavorite,
    openContextComment,
    saveComment,
    cancelComment,
    toggleTunnel,
    startTunnelFromModal,
    openMoveModal,
    openMoveModalFromContext,
    moveAssetToFolder,
    removeAssetFromFolder,
    removeContextAssetFromFolder,
    refreshGroup,
    refreshContextOrganization,
    openContextOrganizationManagement,
    openGroupOrganizationManagement,
    openEditGroup,
    openDeleteGroup,
    openDeleteGroupOrganization,
    confirmDeleteGroup,
    closeHostChildModal,
    openKeyManagementFromHostForm,
    openProxyManagementFromHostForm,
    openJumpHostCreateFromHostForm,
    editContextAsset,
    cloneContextAsset,
    testHostFormConnection,
    saveHostForm,
    openDeleteContextAsset,
    confirmDeleteAsset
  }
}
