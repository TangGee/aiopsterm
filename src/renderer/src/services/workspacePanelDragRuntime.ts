import { reactive, ref, type ComputedRef } from 'vue'

import type {
  WorkspacePanelAsset,
  WorkspacePanelGroup,
  WorkspacePanelTreeRow
} from '@/services/workspaceAssetTreeRuntime'

type WorkspacePanelDragRuntimeInput = {
  visibleTreeRows: ComputedRef<WorkspacePanelTreeRow[]>
  groupByKey: (key: string) => WorkspacePanelGroup | null
  isDescendantGroup: (groupKey: string, possibleDescendantKey: string) => boolean
  moveAssetToGroup: (assetId: string, targetGroup: WorkspacePanelGroup | null) => Promise<boolean>
  moveGroupToParent: (
    groupKey: string,
    parentGroup: WorkspacePanelGroup | null,
    isDescendantGroup: (groupKey: string, possibleDescendantKey: string) => boolean
  ) => Promise<boolean>
}

export const createWorkspacePanelDragRuntime = ({
  visibleTreeRows,
  groupByKey,
  isDescendantGroup,
  moveAssetToGroup,
  moveGroupToParent
}: WorkspacePanelDragRuntimeInput) => {
  const dragState = reactive({ kind: '' as '' | 'asset' | 'group', assetId: '', groupKey: '' })
  const dragOverGroupKey = ref('')
  const dragOverAssetId = ref('')

  const canDragAsset = (asset: WorkspacePanelAsset) => !asset.isLocalShell && asset.asset_type !== 'organization'
  const canDragGroup = (group: WorkspacePanelGroup) => group.type === 'direct-group' || group.type === 'custom-folder'

  const clearDragState = () => {
    dragState.kind = ''
    dragState.assetId = ''
    dragState.groupKey = ''
    dragOverGroupKey.value = ''
    dragOverAssetId.value = ''
  }

  const handleAssetDragStart = (event: DragEvent, asset: WorkspacePanelAsset) => {
    if (!event.dataTransfer || !canDragAsset(asset)) return
    dragState.kind = 'asset'
    dragState.assetId = asset.id
    dragState.groupKey = ''
    const aiContextPayload = {
      contextType: 'host',
      id: asset.id,
      kind: 'hosts',
      label: asset.host || asset.ip || asset.name,
      detail: asset.name || asset.title || asset.group_name,
      host: asset.host || asset.ip || asset.name,
      port: Number(asset.port) || 22,
      username: asset.username || 'root',
      assetName: asset.name || asset.title || asset.host || asset.ip,
      isLocalShell: Boolean(asset.isLocalShell)
    }
    const serialized = JSON.stringify(aiContextPayload)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-aiopsterm-workspace-asset', asset.id)
    event.dataTransfer.setData('application/x-aiopsterm-context', serialized)
    event.dataTransfer.setData('text/html', `<span data-aiopsterm-context="${encodeURIComponent(serialized)}"></span>`)
    event.dataTransfer.setData('text/plain', asset.name)
  }

  const handleGroupDragStart = (event: DragEvent, group: WorkspacePanelGroup) => {
    if (!event.dataTransfer || !canDragGroup(group)) return
    dragState.kind = 'group'
    dragState.groupKey = group.key
    dragState.assetId = ''
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-aiopsterm-workspace-group', group.key)
    event.dataTransfer.setData('text/plain', group.title)
  }

  const draggedAssetId = (event: DragEvent) => event.dataTransfer?.getData('application/x-aiopsterm-workspace-asset') || (dragState.kind === 'asset' ? dragState.assetId : '')
  const draggedGroupKey = (event: DragEvent) => event.dataTransfer?.getData('application/x-aiopsterm-workspace-group') || (dragState.kind === 'group' ? dragState.groupKey : '')

  const handleGroupDragOver = (event: DragEvent, group: WorkspacePanelGroup) => {
    const assetId = draggedAssetId(event)
    const groupKey = draggedGroupKey(event)
    if (!assetId && !groupKey) return
    if (groupKey && (groupKey === group.key || isDescendantGroup(groupKey, group.key))) return
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dragOverGroupKey.value = group.key
  }

  const handleGroupDragLeave = (groupKey: string) => {
    if (dragOverGroupKey.value === groupKey) dragOverGroupKey.value = ''
  }

  const handleGroupDrop = async (event: DragEvent, group: WorkspacePanelGroup) => {
    const assetId = draggedAssetId(event)
    const groupKey = draggedGroupKey(event)
    if (assetId) await moveAssetToGroup(assetId, group)
    else if (groupKey) await moveGroupToParent(groupKey, group, isDescendantGroup)
    clearDragState()
  }

  const handleAssetDragOver = (event: DragEvent, asset: WorkspacePanelAsset) => {
    if (!draggedAssetId(event) && !draggedGroupKey(event)) return
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dragOverAssetId.value = asset.id
  }

  const handleAssetDragLeave = (assetId: string) => {
    if (dragOverAssetId.value === assetId) dragOverAssetId.value = ''
  }

  const handleAssetDrop = async (event: DragEvent, asset: WorkspacePanelAsset) => {
    const row = visibleTreeRows.value.find((item) => item.kind === 'asset' && item.asset.id === asset.id)
    const targetGroup = row?.kind === 'asset' ? groupByKey(row.parentGroupKey) : null
    const draggedId = draggedAssetId(event)
    if (draggedId && draggedId !== asset.id) await moveAssetToGroup(draggedId, targetGroup)
    clearDragState()
  }

  const handleBlankDragOver = (event: DragEvent) => {
    if (!draggedAssetId(event) && !draggedGroupKey(event)) return
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  const handleBlankDragLeave = (event: DragEvent) => {
    const target = event.currentTarget as HTMLElement | null
    const related = event.relatedTarget as Node | null
    if (!target || !related || !target.contains(related)) {
      dragOverGroupKey.value = ''
      dragOverAssetId.value = ''
    }
  }

  const handleBlankDrop = async (event: DragEvent) => {
    if ((event.target as HTMLElement | null)?.closest('.workspace-folder-row, .workspace-host-row')) return
    const assetId = draggedAssetId(event)
    const groupKey = draggedGroupKey(event)
    if (assetId) await moveAssetToGroup(assetId, null)
    else if (groupKey) await moveGroupToParent(groupKey, null, isDescendantGroup)
    clearDragState()
  }

  return {
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
  }
}
