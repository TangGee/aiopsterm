import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import type {
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsCustomFolderSaveInput,
  AiopsKeychainRecord
} from '@shared/contracts/assets'
import { useWorkspaceStore } from '@/stores/workspace'
import { assetsClient } from '@/services/assetsClient'
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
} from '@/services/assetBackendGuards'
import { openLocalTerminalLaunch, openSshTerminalLaunch } from '@/services/terminalLaunchRuntime'
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

export const useWorkspacePanelRuntime = () => {
  const workspace = useWorkspaceStore()

  const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
    { key: 'direct', label: '直接连接' },
    { key: 'bastion', label: '堡垒机资源' }
  ]

  const activeWorkspace = ref<WorkspaceTabKey>('direct')
  const searchValue = ref('')
  const selectedAssetId = ref<string | null>(null)
  const contextMenuAssetId = ref<string | null>(null)
  const contextMenuGroupKey = ref<string | null>(null)
  const blankContextMenuVisible = ref(false)
  const contextMenuPosition = reactive({ x: 0, y: 0 })
  const refreshingGroupKey = ref('')
  const notice = ref('')
  const commentAssetId = ref('')
  const editingComment = ref('')

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
  const contextAsset = computed(() => allAssets.value.find((asset) => asset.id === contextMenuAssetId.value) || null)
  const contextGroup = computed(() => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === contextMenuGroupKey.value) || null)
  const canCommentContextAsset = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell)
  const canMoveContextAsset = computed(
    () => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell && contextAsset.value.asset_type !== 'organization' && !contextAsset.value.folderUuid
  )
  const canRemoveContextAssetFromFolder = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value?.folderUuid && !contextAsset.value.isLocalShell)
  const canConnectContextAsset = computed(() => !!contextAsset.value)
  const canCreateChildInContextGroup = computed(() => !!contextGroup.value && (contextGroup.value.type === 'direct-group' || contextGroup.value.type === 'custom-folder'))
  const canCreateHostInContextGroup = computed(() => !!contextGroup.value && contextGroup.value.type !== 'system')
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

const findEditableAsset = (assetId: string) => workspaceAssets.value.find((item) => item.id === assetId) || null

const toAssetInput = (asset: WorkspacePanelAsset, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
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

const loadDirectGroupOptions = async () => {
  const listAssetGroups = assetsClient.listAssetGroups()
  if (typeof listAssetGroups !== 'function') throw new Error('资产分组服务不可用')
  const groups = await listAssetGroups({
    assetTypes: ['person', 'switch']
  })
  if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
  return groups.map((group) => ({ ...group }))
}

const refreshAssets = async () => {
  const listAssets = assetsClient.listAssets()
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  return applyWorkspaceAssetState(snapshot, groups)
}

const loadWorkspaceAssetRefresh = async () => {
  const listAssets = assetsClient.listAssets()
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  return { snapshot, groups }
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

const saveAssetRecord = async (input: AiopsAssetInput) => {
  const saveAsset = assetsClient.saveAsset()
  if (typeof saveAsset !== 'function') {
    throw new Error('资产保存服务不可用')
  }
  const result = await saveAsset(input)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
  const saved = result.data
  if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
  const { snapshot, groups } = await loadWorkspaceAssetRefresh()
  if (!snapshot.assets.some((asset) => asset.id === saved.id)) throw new Error(malformedAssetBackendResultMessage)
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
  if (snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
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

const closeMenus = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
}

const closeContextMenu = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
}

const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
  const menuWidth = 160
  const estimatedMenuHeight = 6 + menuItemCount * 30
  let left = event.clientX
  let top = event.clientY
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 5
  }
  if (top + estimatedMenuHeight > window.innerHeight) {
    top = event.clientY - estimatedMenuHeight
    if (top < 0) top = 5
  }
  contextMenuPosition.x = left
  contextMenuPosition.y = top
}

const countAssetMenuItems = (asset: WorkspacePanelAsset) => {
  const items = [
    asset.favorite !== undefined,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && asset.asset_type !== 'organization' && !asset.folderUuid,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && !!asset.folderUuid,
    asset.asset_type === 'person' && !asset.isLocalShell,
    true,
    !asset.isLocalShell,
    asset.asset_type !== 'organization' && !asset.isLocalShell,
    asset.asset_type === 'organization',
    asset.asset_type === 'organization',
    !asset.isLocalShell
  ]
  return items.filter(Boolean).length
}

const countGroupMenuItems = (group: WorkspacePanelGroup) =>
  [
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type !== 'system',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.refreshable,
    group.type === 'organization',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type === 'organization'
  ].filter(Boolean).length

const groupByKey = (key: string) => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === key) || null

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

const displayAsset = (asset: WorkspacePanelAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const toggleDisplayMode = async () => {
  await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const selectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
}

const connectAsset = async (assetId: string) => {
  selectedAssetId.value = assetId
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) {
    return
  }
  const previousActivePanelId = workspace.activePanelId
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  const panelId = workspace.activePanelId
  const discardPendingPanel = () => workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
  const launchContext = {
    panelId,
    terminalType: workspace.terminalSettings.terminalType,
    discardPendingPanel,
    setNotice: (message: string) => {
      notice.value = message
    },
    applyLocalTerminalSession: workspace.applyLocalTerminalSession,
    applySshTerminalSession: workspace.applySshTerminalSession,
    registerSshSession: workspace.registerSshSession,
    renamePanel: workspace.renamePanel
  }
  if (asset.isLocalShell) {
    const panel = await openLocalTerminalLaunch(launchContext, { title: asset.name })
    if (!panel) return
    notice.value = `已打开本地 shell ${asset.host}`
  } else {
    const panel = await openSshTerminalLaunch(launchContext, asset, { title: asset.name })
    if (!panel) return
  }
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
    { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name }
  ]
  if (!asset.isLocalShell) {
    await workspace.updateWorkspacePreferences({
      recentAssetIds: [asset.id, ...recentAssetIds.value.filter((id) => id !== asset.id)].slice(0, 10)
    })
  }
}

const openContextMenu = (event: MouseEvent, assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  contextMenuAssetId.value = assetId
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = false
  selectedAssetId.value = assetId
  positionContextMenu(event, countAssetMenuItems(asset))
}

const openGroupContextMenu = (event: MouseEvent, groupKey: string) => {
  const group = groupByKey(groupKey)
  if (!group || !group.menu) return
  contextMenuGroupKey.value = groupKey
  contextMenuAssetId.value = null
  blankContextMenuVisible.value = false
  positionContextMenu(event, countGroupMenuItems(group))
}

const openBlankContextMenu = (event: MouseEvent) => {
  if ((event.target as HTMLElement | null)?.closest('.workspace-folder-row, .workspace-host-row, .asset-context-menu')) return
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
  blankContextMenuVisible.value = true
  positionContextMenu(event, 2)
}

const connectContextAsset = () => {
  if (contextMenuAssetId.value) connectAsset(contextMenuAssetId.value)
  closeContextMenu()
}

const toggleFavorite = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  if (asset) {
    const nextFavorite = !Boolean(asset.favorite)
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { favorite: nextFavorite }))
      notice.value = saved.favorite ? `已收藏 ${saved.name}` : `已取消收藏 ${saved.name}`
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '收藏状态保存失败'
    }
  }
  closeContextMenu()
}

const openCommentEditor = (assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  commentAssetId.value = assetId
  editingComment.value = asset.comment || ''
}

const openContextComment = () => {
  if (contextMenuAssetId.value) openCommentEditor(contextMenuAssetId.value)
  closeContextMenu()
}

const saveComment = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (asset) {
    const nextComment = editingComment.value.trim()
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { comment: nextComment }))
      notice.value = saved.comment ? `已更新备注 ${saved.comment}` : '已清空备注'
      cancelComment()
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '备注保存失败'
    }
    return
  }
  cancelComment()
}

const cancelComment = () => {
  commentAssetId.value = ''
  editingComment.value = ''
}

const refreshGroup = async (groupKey: string) => {
  refreshingGroupKey.value = groupKey
  notice.value = '正在刷新堡垒机资源'
  const organization = organizationAssets.value.find((asset) => asset.uuid === groupKey)
  try {
    const expectedOrganizationId = organization?.id
    const refreshOrganizationAssets = assetsClient.refreshOrganizationAssets()
    if (typeof refreshOrganizationAssets !== 'function') throw new Error('组织资产刷新服务不可用')
    const result = await refreshOrganizationAssets(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
    if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败')
    if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
    const groups = await loadDirectGroupOptions()
    applyWorkspaceAssetState(result.data, groups)
    if (organization) await expandGroup(organization.uuid)
    notice.value = organization ? `${organization.name} 资源已刷新` : '堡垒机资源已刷新'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败'
  } finally {
    refreshingGroupKey.value = ''
    closeContextMenu()
  }
}

const refreshContextOrganization = () => {
  if (contextAsset.value) refreshGroup(contextAsset.value.uuid)
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
