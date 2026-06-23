import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createWorkspacePanelAssetInteractionRuntime } from '@/services/workspacePanelAssetInteractionRuntime'
import type { WorkspacePanelAsset } from '@/services/workspaceAssetTreeRuntime'
import type { AiopsAssetInput } from '@shared/contracts/assets'

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

describe('workspacePanelAssetInteractionRuntime', () => {
  it('owns Workspace panel asset connect, favorite, comment, and organization refresh interactions', async () => {
    const assets = [
      asset({ id: 'prod', uuid: 'prod', name: 'prod-bastion', favorite: false, comment: 'old' }),
      asset({ id: 'org-1', uuid: 'org-uuid', name: 'jumpserver-org', asset_type: 'organization' })
    ]
    const selectedAssetId = ref<string | null>(null)
    const contextMenuAssetId = ref<string | null>('prod')
    const notice = ref('')
    const closeContextMenu = vi.fn()
    const refreshOrganizationAssets = vi.fn(async () => true)
    const expandGroup = vi.fn(async () => true)
    const savedInputs: AiopsAssetInput[] = []
    const workspace = {
      activePanelId: 'panel-1',
      terminalSettings: { terminalType: 'xterm' },
      selectedContexts: [] as Array<{ id: string; kind: string; label: string; detail: string }>,
      createPanel: vi.fn(function (this: any) {
        this.activePanelId = 'panel-2'
      }),
      renamePanel: vi.fn(),
      replaceTerminalOutput: vi.fn(),
      discardPendingTerminalPanel: vi.fn(),
      applyLocalTerminalSession: vi.fn(),
      applySshTerminalSession: vi.fn(),
      registerSshSession: vi.fn(),
      updateWorkspacePreferences: vi.fn(async () => true)
    } as any
    const openSshTerminalLaunch = vi.fn(async () => ({ id: 'panel-2' }))
    const runtime = createWorkspacePanelAssetInteractionRuntime({
      workspace,
      selectedAssetId,
      contextMenuAssetId,
      contextAsset: computed(() => assets.find((item) => item.id === contextMenuAssetId.value) || null),
      allAssets: computed(() => assets),
      recentAssetIds: computed(() => ['previous']),
      organizationAssets: computed(() => assets.filter((item) => item.asset_type === 'organization')),
      findEditableAsset: (assetId) => assets.find((item) => item.id === assetId) || null,
      toAssetInput: (nextAsset, patch = {}) => ({ ...nextAsset, ...patch }) as AiopsAssetInput,
      saveAssetRecord: vi.fn(async (input) => {
        savedInputs.push(input)
        const existing = assets.find((item) => item.id === input.id)
        if (!existing) throw new Error('missing asset')
        Object.assign(existing, input)
        return existing
      }),
      refreshOrganizationAssets,
      expandGroup,
      closeContextMenu,
      notice,
      openSshTerminalLaunch
    })

    await runtime.connectAsset('prod')
    expect(selectedAssetId.value).toBe('prod')
    expect(openSshTerminalLaunch).toHaveBeenCalled()
    expect(workspace.selectedContexts).toEqual([{ id: 'prod', kind: 'hosts', label: '10.0.0.1', detail: 'prod-bastion' }])
    expect(workspace.updateWorkspacePreferences).toHaveBeenCalledWith({ recentAssetIds: ['prod', 'previous'] })

    await runtime.toggleFavorite()
    expect(savedInputs.at(-1)).toMatchObject({ id: 'prod', favorite: true })
    expect(notice.value).toBe('已收藏 prod-bastion')
    expect(closeContextMenu).toHaveBeenCalled()

    runtime.openContextComment()
    expect(runtime.commentAssetId.value).toBe('prod')
    expect(runtime.editingComment.value).toBe('old')
    runtime.editingComment.value = '  new note  '
    await runtime.saveComment('prod')
    expect(savedInputs.at(-1)).toMatchObject({ id: 'prod', comment: 'new note' })
    expect(runtime.commentAssetId.value).toBe('')
    expect(notice.value).toBe('已更新备注 new note')

    contextMenuAssetId.value = 'org-1'
    runtime.refreshContextOrganization()
    await Promise.resolve()
    await Promise.resolve()
    expect(refreshOrganizationAssets).toHaveBeenCalledWith('org-1')
    expect(expandGroup).toHaveBeenCalledWith('org-uuid')
    expect(notice.value).toBe('jumpserver-org 资源已刷新')
  })
})
