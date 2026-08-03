import { ref, type ComputedRef, type Ref } from 'vue'

import type { AiopsAssetInput } from '@shared/contracts/assets'
import type { useWorkspaceStore } from '@/stores/workspace'
import { openLocalTerminalLaunch, openSshTerminalLaunch } from '@/services/terminal/terminalLaunchRuntime'
import type { WorkspacePanelAsset } from '@/services/assets/workspaceAssetTreeRuntime'
import { managedAssetDisplayName, managedAssetEndpoint } from '@shared/assetDisplayRuntime'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

export type WorkspacePanelAssetInteractionRuntimeDeps = {
  workspace: WorkspaceStore
  selectedAssetId: Ref<string | null>
  contextMenuAssetId: Ref<string | null>
  contextAsset: ComputedRef<WorkspacePanelAsset | null>
  allAssets: ComputedRef<WorkspacePanelAsset[]>
  recentAssetIds: ComputedRef<string[]>
  organizationAssets: ComputedRef<WorkspacePanelAsset[]>
  findEditableAsset: (assetId: string) => WorkspacePanelAsset | null
  toAssetInput: (asset: WorkspacePanelAsset, patch?: Partial<AiopsAssetInput>) => AiopsAssetInput
  saveAssetRecord: (input: AiopsAssetInput) => Promise<WorkspacePanelAsset>
  refreshOrganizationAssets: (expectedOrganizationId?: string) => Promise<unknown>
  expandGroup: (key: string) => Promise<boolean | void>
  closeContextMenu: () => void
  notice: Ref<string>
  openLocalTerminalLaunch?: typeof openLocalTerminalLaunch
  openSshTerminalLaunch?: typeof openSshTerminalLaunch
}

export const createWorkspacePanelAssetInteractionRuntime = (deps: WorkspacePanelAssetInteractionRuntimeDeps) => {
  const refreshingGroupKey = ref('')
  const commentAssetId = ref('')
  const editingComment = ref('')

  const selectAsset = (assetId: string) => {
    deps.selectedAssetId.value = assetId
  }

  const connectAsset = async (assetId: string) => {
    deps.selectedAssetId.value = assetId
    const asset = deps.allAssets.value.find((item) => item.id === assetId)
    if (!asset) {
      return
    }
    const previousActivePanelId = deps.workspace.activePanelId
    deps.workspace.createPanel()
    deps.workspace.renamePanel(deps.workspace.activePanelId, asset.name, 'auto')
    deps.workspace.replaceTerminalOutput(deps.workspace.activePanelId, '')
    const panelId = deps.workspace.activePanelId
    const discardPendingPanel = () => deps.workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
    const launchContext = {
      panelId,
      terminalType: deps.workspace.terminalSettings.terminalType,
      discardPendingPanel,
      setNotice: (message: string) => {
        deps.notice.value = message
      },
      applyLocalTerminalSession: deps.workspace.applyLocalTerminalSession,
      applySshTerminalSession: deps.workspace.applySshTerminalSession,
      registerSshSession: deps.workspace.registerSshSession,
      renamePanel: deps.workspace.renamePanel
    }
    if (asset.isLocalShell) {
      const panel = await (deps.openLocalTerminalLaunch || openLocalTerminalLaunch)(launchContext, { title: asset.name })
      if (!panel) return
    } else {
      const panel = await (deps.openSshTerminalLaunch || openSshTerminalLaunch)(launchContext, asset, { title: asset.name })
      if (!panel) return
    }
    const displayName = managedAssetDisplayName(asset)
    const endpoint = managedAssetEndpoint(asset)
    const context = asset.isLocalShell
      ? { id: asset.id, kind: 'hosts' as const, label: asset.host, detail: asset.name }
      : {
          id: asset.id,
          kind: 'hosts' as const,
          label: displayName,
          detail: endpoint,
          assetId: asset.id,
          host: endpoint || displayName,
          port: Number(asset.port) || 22,
          username: asset.username || 'root',
          assetName: displayName
        }
    deps.workspace.setSelectedContexts([
      ...deps.workspace.selectedContexts.filter((item) => item.id !== asset.id),
      context
    ])
    if (!asset.isLocalShell) {
      await deps.workspace.updateWorkspacePreferences({
        recentAssetIds: [asset.id, ...deps.recentAssetIds.value.filter((id) => id !== asset.id)].slice(0, 10)
      })
    }
  }

  const connectContextAsset = () => {
    if (deps.contextMenuAssetId.value) void connectAsset(deps.contextMenuAssetId.value)
    deps.closeContextMenu()
  }

  const toggleFavorite = async () => {
    const asset = deps.findEditableAsset(deps.contextMenuAssetId.value || '')
    if (asset) {
      const nextFavorite = !Boolean(asset.favorite)
      try {
        const saved = await deps.saveAssetRecord(deps.toAssetInput(asset, { favorite: nextFavorite }))
        deps.notice.value = saved.favorite ? `已收藏 ${saved.name}` : `已取消收藏 ${saved.name}`
      } catch (error) {
        deps.notice.value = error instanceof Error ? error.message : '收藏状态保存失败'
      }
    }
    deps.closeContextMenu()
  }

  const openCommentEditor = (assetId: string) => {
    const asset = deps.allAssets.value.find((item) => item.id === assetId)
    if (!asset) return
    commentAssetId.value = assetId
    editingComment.value = asset.comment || ''
  }

  const openContextComment = () => {
    if (deps.contextMenuAssetId.value) openCommentEditor(deps.contextMenuAssetId.value)
    deps.closeContextMenu()
  }

  const saveComment = async (assetId: string) => {
    const asset = deps.findEditableAsset(assetId)
    if (asset) {
      const nextComment = editingComment.value.trim()
      try {
        const saved = await deps.saveAssetRecord(deps.toAssetInput(asset, { comment: nextComment }))
        deps.notice.value = saved.comment ? `已更新备注 ${saved.comment}` : '已清空备注'
        cancelComment()
      } catch (error) {
        deps.notice.value = error instanceof Error ? error.message : '备注保存失败'
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
    deps.notice.value = '正在刷新堡垒机资源'
    const organization = deps.organizationAssets.value.find((asset) => asset.uuid === groupKey)
    try {
      const expectedOrganizationId = organization?.id
      await deps.refreshOrganizationAssets(expectedOrganizationId)
      if (organization) await deps.expandGroup(organization.uuid)
      deps.notice.value = organization ? `${organization.name} 资源已刷新` : '堡垒机资源已刷新'
    } catch (error) {
      deps.notice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败'
    } finally {
      refreshingGroupKey.value = ''
      deps.closeContextMenu()
    }
  }

  const refreshContextOrganization = () => {
    if (deps.contextAsset.value) void refreshGroup(deps.contextAsset.value.uuid)
  }

  return {
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
  }
}

export type WorkspacePanelAssetInteractionRuntime = ReturnType<typeof createWorkspacePanelAssetInteractionRuntime>
