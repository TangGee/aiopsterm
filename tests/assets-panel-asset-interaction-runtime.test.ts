import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createAssetsPanelAssetInteractionRuntime } from '@/services/assetsPanelAssetInteractionRuntime'
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

describe('assetsPanelAssetInteractionRuntime', () => {
  it('owns Assets panel delete confirmation, SSH connect, and organization refresh interactions', async () => {
    const prod = asset({ id: 'prod', title: 'prod-bastion', name: 'prod-bastion' })
    const org = asset({ id: 'org-1', uuid: 'org-uuid', title: 'jumpserver-org', name: 'jumpserver-org', asset_type: 'organization' })
    const assets = ref([prod, org])
    const activeAssetView = ref('assetConfig')
    const selectedAssetId = ref<string | null>(null)
    const contextAssetId = ref('prod')
    const selectedManagedRows = ref(['managed-1', 'managed-2'])
    const editorOpen = ref(true)
    const editMode = ref(true)
    const importNotice = ref('')
    const closeAssetContextMenus = vi.fn()
    const deleteAssetRecords = vi.fn(async (assetIds: string[]) => {
      assets.value = assets.value.filter((item) => !assetIds.includes(item.id))
    })
    const pruneDeletedRows = vi.fn()
    const removeExportIds = vi.fn()
    const refreshOrganizationAssets = vi.fn(async () => true)
    const openAssetManagement = vi.fn()
    const workspace = {
      activePanelId: 'panel-1',
      terminalSettings: { terminalType: 'xterm' },
      selectedContexts: [] as Array<{ id: string; kind: string; label: string; detail: string }>,
      onboardingActiveTour: 'addAndConnectHost',
      createPanel: vi.fn(function (this: any) {
        this.activePanelId = 'panel-2'
      }),
      renamePanel: vi.fn(),
      replaceTerminalOutput: vi.fn(),
      discardPendingTerminalPanel: vi.fn(),
      applyLocalTerminalSession: vi.fn(),
      applySshTerminalSession: vi.fn(),
      registerSshSession: vi.fn(),
      nextOnboardingStep: vi.fn(),
      setActiveModule: vi.fn()
    } as any
    const openSshTerminalLaunch = vi.fn(async () => ({ id: 'panel-2' }))
    const runtime = createAssetsPanelAssetInteractionRuntime({
      workspace,
      assets,
      activeAssetView,
      selectedAssetId,
      contextAsset: computed(() => assets.value.find((item) => item.id === contextAssetId.value)),
      selectedManagedRows,
      editorOpen,
      editMode,
      deleteAssetRecords,
      pruneDeletedRows,
      removeExportIds,
      refreshOrganizationAssets,
      openAssetManagement,
      closeAssetContextMenus,
      importNotice,
      openSshTerminalLaunch
    })

    runtime.removeAsset('prod')
    expect(runtime.confirmState).toMatchObject({
      open: true,
      title: '删除主机',
      expectedText: 'prod-bastion'
    })
    await runtime.runConfirmAction()
    expect(deleteAssetRecords).not.toHaveBeenCalled()

    runtime.confirmInput.value = 'prod-bastion'
    await runtime.runConfirmAction()
    expect(deleteAssetRecords).toHaveBeenCalledWith(['prod'], { requireGroups: true })
    expect(pruneDeletedRows).toHaveBeenCalledWith(['prod'])
    expect(removeExportIds).toHaveBeenCalledWith(['prod'])
    expect(importNotice.value).toBe('已删除 1 个主机。')
    expect(runtime.confirmState.open).toBe(false)

    contextAssetId.value = 'org-1'
    await runtime.connectAsset('org-1')
    expect(selectedAssetId.value).toBe('org-1')
    expect(openSshTerminalLaunch).toHaveBeenCalled()
    expect(workspace.selectedContexts).toEqual([{ id: 'org-1', kind: 'hosts', label: '10.0.0.1', detail: 'jumpserver-org' }])
    expect(editorOpen.value).toBe(false)
    expect(editMode.value).toBe(false)
    expect(workspace.nextOnboardingStep).toHaveBeenCalled()
    expect(workspace.setActiveModule).toHaveBeenCalledWith('workspace')

    await runtime.refreshOrganizationAsset()
    expect(refreshOrganizationAssets).toHaveBeenCalledWith('org-1', '刷新堡垒机资源失败。')
    expect(importNotice.value).toBe('已刷新堡垒机资源 jumpserver-org。')

    runtime.openOrganizationManagement()
    expect(openAssetManagement).toHaveBeenCalledWith('org-1')

    runtime.confirmBulkDelete()
    expect(runtime.confirmState).toMatchObject({
      open: true,
      title: '批量删除主机',
      expectedText: ''
    })
  })
})
