import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { createWorkspacePanelContextRuntime } from '@/services/workspace/workspacePanelContextRuntime'
import type { WorkspacePanelAsset, WorkspacePanelGroup } from '@/services/assets/workspaceAssetTreeRuntime'

const asset = (patch: Partial<WorkspacePanelAsset> & Pick<WorkspacePanelAsset, 'id' | 'name'>): WorkspacePanelAsset => ({
  uuid: patch.id,
  title: patch.name,
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
  favorite: false,
  ...patch
})

const group = (patch: Partial<WorkspacePanelGroup> & Pick<WorkspacePanelGroup, 'key' | 'title'>): WorkspacePanelGroup => ({
  children: [],
  childGroups: [],
  originalCount: 0,
  type: 'direct-group',
  menu: true,
  ...patch
})

describe('workspacePanelContextRuntime', () => {
  it('owns Workspace panel context menu targets, positioning, and capability projection', () => {
    const activeWorkspace = ref<'direct' | 'bastion'>('bastion')
    const selectedAssetId = ref<string | null>(null)
    const prod = asset({ id: 'prod', uuid: 'prod', name: 'prod-bastion' })
    const foldered = asset({ id: 'foldered', uuid: 'foldered', name: 'foldered-host', folderUuid: 'folder-1' })
    const org = group({ key: 'org-1', title: 'jumpserver-org', type: 'organization', organizationId: 'org-1', refreshable: true })
    const runtime = createWorkspacePanelContextRuntime({
      activeWorkspace,
      selectedAssetId,
      allAssets: computed(() => [prod, foldered]),
      sourceGroups: computed(() => [org]),
      groupByKey: (key) => (key === org.key ? org : null),
      getViewport: () => ({ width: 240, height: 160 })
    })

    runtime.openContextMenu(new MouseEvent('contextmenu', { clientX: 230, clientY: 150 }), prod.id)
    expect(selectedAssetId.value).toBe(prod.id)
    expect(runtime.contextMenuAssetId.value).toBe(prod.id)
    expect(runtime.contextMenuPosition.x).toBeLessThan(230)
    expect(runtime.contextMenuPosition.y).toBeLessThan(150)
    expect(runtime.contextAsset.value?.id).toBe(prod.id)
    expect(runtime.canCommentContextAsset.value).toBe(true)
    expect(runtime.canMoveContextAsset.value).toBe(true)
    expect(runtime.canRemoveContextAssetFromFolder.value).toBe(false)

    runtime.openContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 20 }), foldered.id)
    expect(runtime.canMoveContextAsset.value).toBe(false)
    expect(runtime.canRemoveContextAssetFromFolder.value).toBe(true)

    activeWorkspace.value = 'direct'
    expect(runtime.canCommentContextAsset.value).toBe(false)

    runtime.openGroupContextMenu(new MouseEvent('contextmenu'), org.key)
    expect(runtime.contextMenuGroupKey.value).toBe(org.key)
    expect(runtime.contextMenuAssetId.value).toBeNull()
    expect(runtime.contextGroup.value?.key).toBe(org.key)
    expect(runtime.canCreateHostInContextGroup.value).toBe(true)
    expect(runtime.canCreateChildInContextGroup.value).toBe(false)

    runtime.openBlankContextMenu(new MouseEvent('contextmenu'))
    expect(runtime.blankContextMenuVisible.value).toBe(true)

    runtime.closeMenus()
    expect(runtime.contextMenuAssetId.value).toBeNull()
    expect(runtime.contextMenuGroupKey.value).toBeNull()
    expect(runtime.blankContextMenuVisible.value).toBe(false)
  })
})
