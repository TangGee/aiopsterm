import { computed, reactive, ref, type Ref } from 'vue'

import type { AssetsPanelAsset } from '@/services/assetsPanelTreeRuntime'

export type AssetsPanelContextRuntimeDeps = {
  assets: Ref<AssetsPanelAsset[]>
  getViewport?: () => { width: number; height: number }
}

const viewport = (deps: AssetsPanelContextRuntimeDeps) =>
  deps.getViewport?.() || {
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight
  }

export const createAssetsPanelContextRuntime = (deps: AssetsPanelContextRuntimeDeps) => {
  const assetContextMenuId = ref<string | null>(null)
  const assetBlankContextMenuOpen = ref(false)
  const assetGroupContextMenuKey = ref('')
  const contextPosition = reactive({ x: 0, y: 0 })

  const contextAsset = computed(() => deps.assets.value.find((asset) => asset.id === assetContextMenuId.value))

  const closeAssetContextMenus = () => {
    assetContextMenuId.value = null
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = ''
  }

  const positionAssetContextMenu = (event: MouseEvent, menuWidth = 150, menuHeight = 90) => {
    const padding = 10
    const { width, height } = viewport(deps)
    contextPosition.x = Math.max(padding, Math.min(event.clientX, width - menuWidth - padding))
    contextPosition.y = Math.max(padding, Math.min(event.clientY, height - menuHeight - padding))
  }

  const openAssetContextMenu = (event: MouseEvent, assetId: string) => {
    assetContextMenuId.value = assetId
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = ''
    positionAssetContextMenu(event, 150, 220)
  }

  const openAssetBlankContextMenu = (event: MouseEvent) => {
    if ((event.target as HTMLElement | null)?.closest('.asset-tree-group-row, .asset-tree-host-row, .asset-context-menu')) return
    assetContextMenuId.value = null
    assetGroupContextMenuKey.value = ''
    assetBlankContextMenuOpen.value = true
    positionAssetContextMenu(event)
  }

  const openAssetGroupContextMenu = (event: MouseEvent, groupKey: string) => {
    assetContextMenuId.value = null
    assetBlankContextMenuOpen.value = false
    assetGroupContextMenuKey.value = groupKey
    positionAssetContextMenu(event)
  }

  return {
    assetContextMenuId,
    assetBlankContextMenuOpen,
    assetGroupContextMenuKey,
    contextPosition,
    contextAsset,
    closeAssetContextMenus,
    positionAssetContextMenu,
    openAssetContextMenu,
    openAssetBlankContextMenu,
    openAssetGroupContextMenu
  }
}

export type AssetsPanelContextRuntime = ReturnType<typeof createAssetsPanelContextRuntime>
