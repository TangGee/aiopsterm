import { reactive, ref, type ComputedRef, type Ref } from 'vue'

import type { useWorkspaceStore } from '@/stores/workspace'
import { openSshTerminalLaunch } from '@/services/terminal/terminalLaunchRuntime'
import type { AssetsPanelAsset } from '@/services/assets/assetsPanelTreeRuntime'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

export type AssetsPanelConfirmState = {
  open: boolean
  title: string
  message: string
  expectedText: string
  action: null | (() => void | Promise<void>)
}

export type AssetsPanelAssetInteractionRuntimeDeps = {
  workspace: WorkspaceStore
  assets: Ref<AssetsPanelAsset[]>
  activeAssetView: Ref<string>
  selectedAssetId: Ref<string | null>
  contextAsset: ComputedRef<AssetsPanelAsset | undefined>
  selectedManagedRows: Ref<string[]>
  editorOpen: Ref<boolean>
  editMode: Ref<boolean>
  deleteAssetRecords: (assetIds: string[], options?: { requireGroups?: boolean }) => Promise<void>
  pruneDeletedRows: (assetIds: string[]) => void
  removeExportIds: (assetIds: string[]) => void
  refreshOrganizationAssets: (expectedOrganizationId?: string, fallbackErrorMessage?: string) => Promise<unknown>
  openAssetManagement: (organizationId?: string | null) => void
  closeAssetContextMenus: () => void
  importNotice: Ref<string>
  openSshTerminalLaunch?: typeof openSshTerminalLaunch
}

export const createAssetsPanelAssetInteractionRuntime = (deps: AssetsPanelAssetInteractionRuntimeDeps) => {
  const confirmInput = ref('')
  const confirmState = reactive<AssetsPanelConfirmState>({
    open: false,
    title: '',
    message: '',
    expectedText: '',
    action: null
  })

  const deleteAssets = async (assetIds: string[]) => {
    try {
      await deps.deleteAssetRecords(assetIds, { requireGroups: deps.activeAssetView.value === 'assetConfig' })
      const idSet = new Set(assetIds)
      deps.pruneDeletedRows(assetIds)
      deps.selectedAssetId.value = deps.selectedAssetId.value && idSet.has(deps.selectedAssetId.value) ? null : deps.selectedAssetId.value
      deps.removeExportIds(assetIds)
      deps.importNotice.value = `已删除 ${assetIds.length} 个主机。`
    } catch (error) {
      deps.importNotice.value = error instanceof Error ? error.message : '删除主机失败。'
    }
  }

  const removeAsset = (assetId: string | null) => {
    if (!assetId) return
    const asset = deps.assets.value.find((item) => item.id === assetId)
    if (!asset) return
    deps.closeAssetContextMenus()
    confirmState.open = true
    confirmState.title = '删除主机'
    confirmState.message = `确定删除 ${asset.title}？此操作会更新本地资产库。`
    confirmState.expectedText = asset.title
    confirmState.action = () => deleteAssets([assetId])
    confirmInput.value = ''
  }

  const confirmBulkDelete = () => {
    if (!deps.selectedManagedRows.value.length) return
    confirmState.open = true
    confirmState.title = '批量删除主机'
    confirmState.message = `确定删除选中的 ${deps.selectedManagedRows.value.length} 个主机？`
    confirmState.expectedText = ''
    confirmState.action = () => deleteAssets([...deps.selectedManagedRows.value])
    confirmInput.value = ''
  }

  const connectAsset = async (assetId: string | null) => {
    if (!assetId) return
    const asset = deps.assets.value.find((item) => item.id === assetId)
    if (!asset) {
      deps.closeAssetContextMenus()
      return
    }
    deps.selectedAssetId.value = asset.id
    const previousActivePanelId = deps.workspace.activePanelId
    deps.workspace.createPanel()
    deps.workspace.renamePanel(deps.workspace.activePanelId, asset.name || asset.title)
    deps.workspace.replaceTerminalOutput(deps.workspace.activePanelId, '')
    const panelId = deps.workspace.activePanelId
    const discardPendingPanel = () => deps.workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
    const connected = await (deps.openSshTerminalLaunch || openSshTerminalLaunch)(
      {
        panelId,
        terminalType: deps.workspace.terminalSettings.terminalType,
        discardPendingPanel,
        setNotice: (message) => {
          deps.importNotice.value = message
          deps.closeAssetContextMenus()
        },
        applyLocalTerminalSession: deps.workspace.applyLocalTerminalSession,
        applySshTerminalSession: deps.workspace.applySshTerminalSession,
        registerSshSession: deps.workspace.registerSshSession
      },
      asset,
      { title: asset.name || asset.title }
    )
    if (!connected) return
    deps.workspace.selectedContexts = [
      ...deps.workspace.selectedContexts.filter((item) => item.id !== asset.id),
      { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name || asset.title }
    ]
    deps.editorOpen.value = false
    deps.editMode.value = false
    if (deps.workspace.onboardingActiveTour === 'addAndConnectHost') {
      deps.workspace.nextOnboardingStep()
    }
    deps.workspace.setActiveModule('workspace')
    deps.closeAssetContextMenus()
  }

  const refreshOrganizationAsset = async () => {
    if (deps.contextAsset.value) {
      const title = deps.contextAsset.value.title
      try {
        const expectedOrganizationId = deps.contextAsset.value.id
        await deps.refreshOrganizationAssets(expectedOrganizationId, '刷新堡垒机资源失败。')
        deps.importNotice.value = `已刷新堡垒机资源 ${title}。`
      } catch (error) {
        deps.importNotice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败。'
      }
    }
    deps.closeAssetContextMenus()
  }

  const openOrganizationManagement = () => {
    deps.openAssetManagement(deps.contextAsset.value?.asset_type === 'organization' ? deps.contextAsset.value.id : null)
  }

  const closeConfirm = () => {
    confirmState.open = false
    confirmState.action = null
    confirmInput.value = ''
  }

  const runConfirmAction = async () => {
    if (confirmState.expectedText && confirmInput.value !== confirmState.expectedText) return
    await confirmState.action?.()
    closeConfirm()
  }

  return {
    confirmInput,
    confirmState,
    deleteAssets,
    removeAsset,
    confirmBulkDelete,
    connectAsset,
    refreshOrganizationAsset,
    openOrganizationManagement,
    closeConfirm,
    runConfirmAction
  }
}

export type AssetsPanelAssetInteractionRuntime = ReturnType<typeof createAssetsPanelAssetInteractionRuntime>
