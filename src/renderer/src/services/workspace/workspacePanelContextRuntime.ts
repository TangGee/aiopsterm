import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'

import {
  flattenGroups,
  type WorkspacePanelAsset,
  type WorkspacePanelGroup,
  type WorkspaceTabKey
} from '@/services/assets/workspaceAssetTreeRuntime'

export type WorkspacePanelContextRuntimeDeps = {
  activeWorkspace: Ref<WorkspaceTabKey>
  selectedAssetId: Ref<string | null>
  allAssets: ComputedRef<WorkspacePanelAsset[]>
  sourceGroups: ComputedRef<WorkspacePanelGroup[]>
  groupByKey: (key: string) => WorkspacePanelGroup | null
  getViewport?: () => { width: number; height: number }
}

const viewport = (deps: WorkspacePanelContextRuntimeDeps) =>
  deps.getViewport?.() || {
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight
  }

const countAssetMenuItems = (asset: WorkspacePanelAsset, activeWorkspace: WorkspaceTabKey) => {
  const items = [
    asset.favorite !== undefined,
    activeWorkspace === 'bastion' && !asset.isLocalShell,
    activeWorkspace === 'bastion' && !asset.isLocalShell && asset.asset_type !== 'organization' && !asset.folderUuid,
    activeWorkspace === 'bastion' && !asset.isLocalShell && !!asset.folderUuid,
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

export const createWorkspacePanelContextRuntime = (deps: WorkspacePanelContextRuntimeDeps) => {
  const contextMenuAssetId = ref<string | null>(null)
  const contextMenuGroupKey = ref<string | null>(null)
  const blankContextMenuVisible = ref(false)
  const contextMenuPosition = reactive({ x: 0, y: 0 })

  const contextAsset = computed(() => deps.allAssets.value.find((asset) => asset.id === contextMenuAssetId.value) || null)
  const contextGroup = computed(() => deps.sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === contextMenuGroupKey.value) || null)
  const canCommentContextAsset = computed(() => deps.activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell)
  const canMoveContextAsset = computed(
    () =>
      deps.activeWorkspace.value === 'bastion' &&
      !!contextAsset.value &&
      !contextAsset.value.isLocalShell &&
      contextAsset.value.asset_type !== 'organization' &&
      !contextAsset.value.folderUuid
  )
  const canRemoveContextAssetFromFolder = computed(() => deps.activeWorkspace.value === 'bastion' && !!contextAsset.value?.folderUuid && !contextAsset.value.isLocalShell)
  const canConnectContextAsset = computed(() => !!contextAsset.value)
  const canCreateChildInContextGroup = computed(() => !!contextGroup.value && (contextGroup.value.type === 'direct-group' || contextGroup.value.type === 'custom-folder'))
  const canCreateHostInContextGroup = computed(() => !!contextGroup.value && contextGroup.value.type !== 'system')

  const closeMenus = () => {
    contextMenuAssetId.value = null
    contextMenuGroupKey.value = null
    blankContextMenuVisible.value = false
  }

  const closeContextMenu = () => {
    closeMenus()
  }

  const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
    const menuWidth = 160
    const estimatedMenuHeight = 6 + menuItemCount * 30
    const { width, height } = viewport(deps)
    let left = event.clientX
    let top = event.clientY
    if (left + menuWidth > width) {
      left = width - menuWidth - 5
    }
    if (top + estimatedMenuHeight > height) {
      top = event.clientY - estimatedMenuHeight
      if (top < 0) top = 5
    }
    contextMenuPosition.x = left
    contextMenuPosition.y = top
  }

  const openContextMenu = (event: MouseEvent, assetId: string) => {
    const asset = deps.allAssets.value.find((item) => item.id === assetId)
    if (!asset) return
    contextMenuAssetId.value = assetId
    contextMenuGroupKey.value = null
    blankContextMenuVisible.value = false
    deps.selectedAssetId.value = assetId
    positionContextMenu(event, countAssetMenuItems(asset, deps.activeWorkspace.value))
  }

  const openGroupContextMenu = (event: MouseEvent, groupKey: string) => {
    const group = deps.groupByKey(groupKey)
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

  return {
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
  }
}

export type WorkspacePanelContextRuntime = ReturnType<typeof createWorkspacePanelContextRuntime>
