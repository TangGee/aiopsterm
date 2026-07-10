import type { TerminalPanel } from '@/stores/workspace'
import {
  controlFail,
  controlOk,
  controlText,
  type ControlWorkspaceGroupState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type {
  ControlResponse,
  ControlSurfaceSummary,
  ControlWorkspaceGroupSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

type TerminalControlSurfaceGroupDependencies = {
  workspace: WorkspaceStore
  controlWorkspaceGroups: { value: ControlWorkspaceGroupState[] }
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  resolveWorkspaceGroup: (value: unknown) => ControlWorkspaceGroupState | null
  resolveControlPanelId: (value: unknown) => string
  workspaceGroupSummaryForControl: (group: ControlWorkspaceGroupState) => ControlWorkspaceGroupSummary
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
}

export const createTerminalControlSurfaceGroupHandlers = ({
  workspace,
  controlWorkspaceGroups,
  isWelcomePlaceholderPanel,
  resolveWorkspaceGroup,
  resolveControlPanelId,
  workspaceGroupSummaryForControl,
  surfaceSummaryForControl,
  workspaceSnapshotForControl
}: TerminalControlSurfaceGroupDependencies) => {
  const workspaceGroupPayload = (group?: ControlWorkspaceGroupState | null) => {
    const groups = controlWorkspaceGroups.value.map(workspaceGroupSummaryForControl)
    return {
      groups,
      count: groups.length,
      ...(group ? { group: workspaceGroupSummaryForControl(group) } : {}),
      snapshot: workspaceSnapshotForControl()
    }
  }

  const createWorkspaceGroupForControl = (params: Record<string, unknown>) => {
    const panelInputs = [
      ...(Array.isArray(params.childPanelIds) ? params.childPanelIds : []),
      ...(Array.isArray(params.child_workspace_ids) ? params.child_workspace_ids : []),
      ...(Array.isArray(params.workspaceIds) ? params.workspaceIds : []),
      ...(typeof params.from === 'string' ? params.from.split(',') : []),
      ...(typeof params.childWorkspaceIds === 'string' ? params.childWorkspaceIds.split(',') : [])
    ]
    const memberPanelIds = [...new Set(panelInputs.map(resolveControlPanelId).filter(Boolean))]
    if (!memberPanelIds.length) {
      const visiblePanelIds = workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel)).map((panel) => panel.id)
      memberPanelIds.push(...(visiblePanelIds.length ? visiblePanelIds : workspace.panels.map((panel) => panel.id)))
    }
    if (!memberPanelIds.length) return controlFail('WORKSPACE_GROUP_NO_MEMBERS', 'Workspace group needs at least one surface.')
    const anchorPanelId = resolveControlPanelId(params.anchorPanelId || params.anchor_workspace_id) || memberPanelIds[0]
    if (!memberPanelIds.includes(anchorPanelId)) memberPanelIds.unshift(anchorPanelId)
    const now = Date.now()
    const group: ControlWorkspaceGroupState = {
      id: `workspace-group-${now}-${Math.random().toString(16).slice(2)}`,
      name: controlText(params.name) || `Group ${controlWorkspaceGroups.value.length + 1}`,
      anchorPanelId,
      memberPanelIds,
      collapsed: false,
      pinned: params.pinned === true || params.is_pinned === true,
      index: controlWorkspaceGroups.value.length,
      createdAt: now,
      updatedAt: now,
      ...(controlText(params.cwd) ? { cwd: controlText(params.cwd) } : {}),
      ...(controlText(params.color || params.hex || params.customColor) ? { color: controlText(params.color || params.hex || params.customColor) } : {}),
      ...(controlText(params.icon || params.symbol || params.iconSymbol) ? { icon: controlText(params.icon || params.symbol || params.iconSymbol) } : {})
    }
    const assigned = new Set(group.memberPanelIds)
    controlWorkspaceGroups.value = [
      ...controlWorkspaceGroups.value
        .map((item) => ({ ...item, memberPanelIds: item.memberPanelIds.filter((panelId) => !assigned.has(panelId)) }))
        .filter((item) => item.memberPanelIds.length),
      group
    ].map((item, index) => ({ ...item, index }))
    return controlOk(workspaceGroupPayload(group))
  }

  const updateWorkspaceGroupForControl = (params: Record<string, unknown>, update: (group: ControlWorkspaceGroupState) => ControlWorkspaceGroupState | null) => {
    const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
    if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
    const next = update(group)
    if (!next) return controlFail('WORKSPACE_GROUP_UPDATE_REJECTED', 'Workspace group update was rejected.')
    controlWorkspaceGroups.value = controlWorkspaceGroups.value.map((item) => (item.id === group.id ? { ...next, updatedAt: Date.now() } : item))
    return controlOk(workspaceGroupPayload(controlWorkspaceGroups.value.find((item) => item.id === group.id)))
  }

  const addWorkspaceToGroupForControl = (params: Record<string, unknown>) => {
    const panelId = resolveControlPanelId(params.panelId || params.workspaceId || params.workspace_id)
    if (!panelId) return controlFail('WORKSPACE_GROUP_PANEL_NOT_FOUND', 'Surface not found for workspace group add.')
    return updateWorkspaceGroupForControl(params, (group) => {
      controlWorkspaceGroups.value = controlWorkspaceGroups.value
        .map((item) => (item.id === group.id ? item : { ...item, memberPanelIds: item.memberPanelIds.filter((id) => id !== panelId) }))
        .filter((item) => item.memberPanelIds.length)
      return {
        ...group,
        memberPanelIds: [...new Set([...group.memberPanelIds, panelId])],
        anchorPanelId: group.anchorPanelId || panelId
      }
    })
  }

  const removeWorkspaceFromGroupForControl = (params: Record<string, unknown>) => {
    const panelId = resolveControlPanelId(params.panelId || params.workspaceId || params.workspace_id)
    if (!panelId) return controlFail('WORKSPACE_GROUP_PANEL_NOT_FOUND', 'Surface not found for workspace group remove.')
    const group = controlWorkspaceGroups.value.find((item) => item.memberPanelIds.includes(panelId))
    if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Surface is not in a workspace group.')
    controlWorkspaceGroups.value = controlWorkspaceGroups.value
      .map((item) => {
        if (item.id !== group.id) return item
        const memberPanelIds = item.memberPanelIds.filter((id) => id !== panelId)
        const anchorPanelId = item.anchorPanelId === panelId ? memberPanelIds[0] || '' : item.anchorPanelId
        return { ...item, anchorPanelId, memberPanelIds, updatedAt: Date.now() }
      })
      .filter((item) => item.anchorPanelId && item.memberPanelIds.length)
      .map((item, index) => ({ ...item, index }))
    return controlOk(workspaceGroupPayload())
  }

  const closeWorkspaceGroupPanelsForControl = async (panelIds: string[]) => {
    const closedPanelIds: string[] = []
    const killedSessionIds: string[] = []
    for (const panelId of panelIds) {
      const panel = workspace.panels.find((item) => item.id === panelId)
      if (!panel) continue
      const result = await workspace.closePanel(panel.id)
      if (!result.closed) continue
      closedPanelIds.push(panel.id)
      if (result.terminalStatus === 'killed' && result.terminalSessionId) killedSessionIds.push(result.terminalSessionId)
    }
    return { closedPanelIds, killedSessionIds }
  }

  const deleteWorkspaceGroupForControl = async (params: Record<string, unknown>) => {
    const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
    if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
    if (params.confirm !== true && params.force !== true) {
      return controlFail('WORKSPACE_GROUP_DELETE_REQUIRES_CONFIRM', 'Deleting a workspace group closes its surfaces. Pass confirm=true to continue.', {
        group: workspaceGroupSummaryForControl(group)
      })
    }
    const memberPanelIds = [...group.memberPanelIds]
    controlWorkspaceGroups.value = controlWorkspaceGroups.value.filter((item) => item.id !== group.id).map((item, index) => ({ ...item, index }))
    const closed = await closeWorkspaceGroupPanelsForControl(memberPanelIds)
    return controlOk({ deletedPanelIds: memberPanelIds, ...closed, ...workspaceGroupPayload() })
  }

  const handleWorkspaceGroupControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    if (method === 'workspace.group.list') return controlOk(workspaceGroupPayload())
    if (method === 'workspace.group.create') return createWorkspaceGroupForControl(params)
    if (method === 'workspace.group.ungroup') {
      const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
      if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
      controlWorkspaceGroups.value = controlWorkspaceGroups.value.filter((item) => item.id !== group.id).map((item, index) => ({ ...item, index }))
      return controlOk(workspaceGroupPayload())
    }
    if (method === 'workspace.group.delete') return deleteWorkspaceGroupForControl(params)
    if (method === 'workspace.group.rename') {
      const name = controlText(params.name)
      if (!name) return controlFail('WORKSPACE_GROUP_NAME_REQUIRED', 'Workspace group name is required.')
      return updateWorkspaceGroupForControl(params, (group) => ({ ...group, name }))
    }
    if (method === 'workspace.group.collapse') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, collapsed: true }))
    if (method === 'workspace.group.expand') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, collapsed: false }))
    if (method === 'workspace.group.pin') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, pinned: true }))
    if (method === 'workspace.group.unpin') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, pinned: false }))
    if (method === 'workspace.group.set_color') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, color: controlText(params.hex || params.color) || undefined }))
    if (method === 'workspace.group.set_icon') return updateWorkspaceGroupForControl(params, (group) => ({ ...group, icon: controlText(params.symbol || params.icon) || undefined }))
    if (method === 'workspace.group.add') return addWorkspaceToGroupForControl(params)
    if (method === 'workspace.group.remove') return removeWorkspaceFromGroupForControl(params)
    if (method === 'workspace.group.set_anchor') {
      const panelId = resolveControlPanelId(params.panelId || params.workspaceId || params.workspace_id)
      if (!panelId) return controlFail('WORKSPACE_GROUP_PANEL_NOT_FOUND', 'Surface not found for workspace group anchor.')
      return updateWorkspaceGroupForControl(params, (group) => ({
        ...group,
        anchorPanelId: panelId,
        memberPanelIds: [...new Set([panelId, ...group.memberPanelIds])]
      }))
    }
    if (method === 'workspace.group.new_workspace') {
      const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
      if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
      const panel = workspace.createPanel()
      const memberPanelIds = [...new Set([...group.memberPanelIds, panel.id])]
      controlWorkspaceGroups.value = controlWorkspaceGroups.value.map((item) => (item.id === group.id ? { ...item, memberPanelIds, updatedAt: Date.now() } : item))
      return controlOk({ panel: surfaceSummaryForControl(panel), workspace_ref: panel.id, ...workspaceGroupPayload(controlWorkspaceGroups.value.find((item) => item.id === group.id)) })
    }
    if (method === 'workspace.group.focus') {
      const group = resolveWorkspaceGroup(params.groupId || params.group_id || params.id)
      if (!group) return controlFail('WORKSPACE_GROUP_NOT_FOUND', 'Workspace group not found.')
      workspace.activeModule = 'workspace'
      workspace.activePanelId = group.anchorPanelId
      return controlOk(workspaceGroupPayload(group))
    }
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  return {
    workspaceGroupPayload,
    handleWorkspaceGroupControlRequest
  }
}
