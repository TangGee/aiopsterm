import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { createAssetsPanelContextRuntime } from '@/services/assetsPanelContextRuntime'
import type { AssetsPanelAsset } from '@/services/assetsPanelTreeRuntime'

const asset = (patch: Partial<AssetsPanelAsset> & Pick<AssetsPanelAsset, 'id' | 'title'>): AssetsPanelAsset => ({
  uuid: patch.id,
  name: patch.title,
  host: '10.0.0.1',
  ip: '10.0.0.1',
  group: 'Default',
  group_name: 'Default',
  status: 'online',
  tags: [],
  username: 'ops',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  ...patch
})

describe('assetsPanelContextRuntime', () => {
  it('owns Assets panel context menu target state and viewport positioning', () => {
    const assets = ref([asset({ id: 'asset-1', title: 'prod-bastion' })])
    const runtime = createAssetsPanelContextRuntime({
      assets,
      getViewport: () => ({ width: 220, height: 150 })
    })

    runtime.openAssetContextMenu(new MouseEvent('contextmenu', { clientX: 210, clientY: 145 }), 'asset-1')
    expect(runtime.assetContextMenuId.value).toBe('asset-1')
    expect(runtime.assetBlankContextMenuOpen.value).toBe(false)
    expect(runtime.assetGroupContextMenuKey.value).toBe('')
    expect(runtime.contextAsset.value?.title).toBe('prod-bastion')
    expect(runtime.contextPosition.x).toBeLessThan(210)
    expect(runtime.contextPosition.y).toBe(10)

    runtime.openAssetGroupContextMenu(new MouseEvent('contextmenu', { clientX: 40, clientY: 60 }), 'group-Prod')
    expect(runtime.assetContextMenuId.value).toBeNull()
    expect(runtime.assetGroupContextMenuKey.value).toBe('group-Prod')
    expect(runtime.assetBlankContextMenuOpen.value).toBe(false)

    runtime.openAssetBlankContextMenu(new MouseEvent('contextmenu', { clientX: 25, clientY: 35 }))
    expect(runtime.assetContextMenuId.value).toBeNull()
    expect(runtime.assetGroupContextMenuKey.value).toBe('')
    expect(runtime.assetBlankContextMenuOpen.value).toBe(true)
    expect(runtime.contextPosition).toMatchObject({ x: 25, y: 35 })

    runtime.closeAssetContextMenus()
    expect(runtime.assetContextMenuId.value).toBeNull()
    expect(runtime.assetGroupContextMenuKey.value).toBe('')
    expect(runtime.assetBlankContextMenuOpen.value).toBe(false)
  })
})
