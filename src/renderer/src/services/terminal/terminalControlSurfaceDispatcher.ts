import {
  controlFail,
  controlOk,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type { ControlRequest, ControlResponse } from '@shared/contracts/control'

type TerminalControlSurfaceDispatcherDependencies = {
  workspace: WorkspaceStore
  sessionControlHandlers: {
    exportSessionSnapshotForControl(params: Record<string, unknown>): Record<string, unknown>
    restoreSessionSnapshotForControl(params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
  }
  mobileControlHandlers: Record<string, any>
  remoteControlHandlers: {
    handleWorkspaceRemoteControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
  }
  groupControlHandlers: {
    handleWorkspaceGroupControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
  }
  paneControlHandlers: Record<string, any>
  resumeControlHandlers: {
    handleSurfaceResumeControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
    handleSurfaceRespawnControlRequest(params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
  }
  agentControlHandlers: {
    handleAgentTeamControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
    handleAgentHibernationControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
  }
  projectFileControlHandlers: {
    handleProjectFileControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
  }
  workspaceControlHandlers: {
    handleSettingsOpenControlRequest(params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
    handleFeedbackOpenControlRequest(): Promise<ControlResponse> | ControlResponse
    handleExtensionSidebarSnapshotControlRequest(params: Record<string, unknown>): ControlResponse
    handleWorkspaceMetadataControlRequest(method: string, params: Record<string, unknown>): Promise<ControlResponse> | ControlResponse
    handleNotificationControlRequest(method: string, params: Record<string, unknown>): ControlResponse
  }
  terminalSummaryForControl(panel: any): Record<string, unknown>
  workspaceSnapshotForControl(): any
}

const paneNavigationMethods = ['workspace.next', 'workspace.previous', 'workspace.last', 'workspace.select', 'workspace.find', 'pane.focus', 'pane.last', 'surface.focus']

const paneManagementMethods = [
  'pane.list',
  'pane.surfaces',
  'pane.create',
  'workspace.create',
  'surface.create',
  'surface.split',
  'workspace.rename',
  'workspace.close',
  'surface.close',
  'workspace.has_session',
  'workspace.select_layout'
]

const surfaceOperationMethods = [
  'surface.move',
  'surface.reorder',
  'surface.action',
  'tab.action',
  'surface.split_off',
  'surface.refresh',
  'surface.health',
  'surface.trigger_flash',
  'surface.report_tty',
  'surface.report_shell_state',
  'surface.ports_kick',
  'workspace.reorder',
  'workspace.reorder_many',
  'workspace.move_to_window',
  'workspace.equalize_splits',
  'workspace.prompt_submit'
]

export const createTerminalControlSurfaceDispatcher = ({
  workspace,
  sessionControlHandlers,
  mobileControlHandlers,
  remoteControlHandlers,
  groupControlHandlers,
  paneControlHandlers,
  resumeControlHandlers,
  agentControlHandlers,
  projectFileControlHandlers,
  workspaceControlHandlers,
  terminalSummaryForControl,
  workspaceSnapshotForControl
}: TerminalControlSurfaceDispatcherDependencies) => {
  const handleControlRequest = async (request: ControlRequest): Promise<ControlResponse> => {
    const params = request.params || {}
    if (request.method === 'session.export') return controlOk({ snapshot: sessionControlHandlers.exportSessionSnapshotForControl(params) })
    if (request.method === 'session.restore') return sessionControlHandlers.restoreSessionSnapshotForControl(params)
    if (request.method === 'settings.open') return workspaceControlHandlers.handleSettingsOpenControlRequest(params)
    if (request.method === 'feedback.open') return workspaceControlHandlers.handleFeedbackOpenControlRequest()
    if (request.method === 'extension.sidebar.snapshot') return workspaceControlHandlers.handleExtensionSidebarSnapshotControlRequest(params)
    if (
      request.method.startsWith('project.') ||
      request.method === 'markdown.open' ||
      request.method === 'file.open'
    ) {
      return projectFileControlHandlers.handleProjectFileControlRequest(request.method, params)
    }
    if (request.method === 'workspace.env' || request.method === 'workspace.set_auto_title') return workspaceControlHandlers.handleWorkspaceMetadataControlRequest(request.method, params)
    if (request.method === 'workspace.action') return paneControlHandlers.handleWorkspaceActionControlRequest(params)
    if (request.method.startsWith('workspace.remote.') || request.method.startsWith('remote.tmux.')) return remoteControlHandlers.handleWorkspaceRemoteControlRequest(request.method, params)
    if (request.method.startsWith('workspace.group.')) return groupControlHandlers.handleWorkspaceGroupControlRequest(request.method, params)
    if (request.method.startsWith('surface.resume.')) return resumeControlHandlers.handleSurfaceResumeControlRequest(request.method, params)
    if (paneNavigationMethods.includes(request.method)) return paneControlHandlers.handlePaneNavigationControlRequest(request.method, params)
    if (paneManagementMethods.includes(request.method)) return paneControlHandlers.handlePaneManagementControlRequest(request.method, params)
    if (request.method.startsWith('pane.')) return paneControlHandlers.handlePaneLayoutControlRequest(request.method, params)
    if (surfaceOperationMethods.includes(request.method)) return paneControlHandlers.handleSurfaceOperationsControlRequest(request.method, params)
    if (request.method === 'surface.respawn' || request.method === 'terminal.respawn') return resumeControlHandlers.handleSurfaceRespawnControlRequest(params)
    if (request.method.startsWith('agent.team.')) return agentControlHandlers.handleAgentTeamControlRequest(request.method, params)
    if (request.method.startsWith('agent-hibernation.') || request.method.startsWith('agent.')) return agentControlHandlers.handleAgentHibernationControlRequest(request.method, params)
    if (request.method === 'workspace.snapshot' || request.method === 'tree' || request.method === 'top') {
      return controlOk({ snapshot: workspaceSnapshotForControl() })
    }
    if (request.method === 'workspace.list' || request.method === 'workspace.current') {
      const snapshot = workspaceSnapshotForControl()
      return controlOk({
        workspaces: snapshot.workspaces,
        count: snapshot.workspaces.length,
        activeWorkspaceId: 'main',
        activePanelId: snapshot.activePanelId,
        mode: snapshot.mode,
        activeModule: snapshot.activeModule
      })
    }
    if (request.method === 'surface.list') {
      const snapshot = workspaceSnapshotForControl()
      return controlOk({
        surfaces: snapshot.surfaces,
        terminals: snapshot.terminals,
        splitGroups: snapshot.splitGroups,
        count: snapshot.surfaces.length,
        activePanelId: snapshot.activePanelId
      })
    }
    if (request.method === 'surface.current') {
      const snapshot = workspaceSnapshotForControl()
      const surface = snapshot.surfaces.find((item: any) => item.panelId === snapshot.activePanelId) || snapshot.surfaces[0] || null
      return controlOk({
        surface,
        activePanelId: snapshot.activePanelId
      })
    }
    if (request.method === 'terminal.list') {
      const terminals = workspace.panels.filter((panel) => panel.kind !== 'knowledge').map(terminalSummaryForControl)
      return controlOk({
        terminals,
        count: terminals.length,
        activePanelId: workspace.activePanelId
      })
    }
    if (request.method === 'mobile.workspace.list') {
      const snapshot = workspaceSnapshotForControl()
      return controlOk({
        workspaces: snapshot.workspaces,
        terminals: snapshot.terminals,
        surfaces: snapshot.surfaces,
        count: snapshot.terminals.length,
        workspace_count: snapshot.workspaces.length,
        activeWorkspaceId: 'main',
        active_workspace_id: 'main',
        activePanelId: snapshot.activePanelId,
        active_panel_id: snapshot.activePanelId
      })
    }
    if (request.method === 'mobile.terminal.input' || request.method === 'terminal.input') return mobileControlHandlers.handleMobileTerminalInputControlRequest(params)
    if (request.method === 'mobile.terminal.paste' || request.method === 'terminal.paste') return mobileControlHandlers.handleMobileTerminalPasteControlRequest(params)
    if (request.method === 'mobile.terminal.replay' || request.method === 'terminal.replay') return mobileControlHandlers.handleMobileTerminalReplayControlRequest(params)
    if (request.method === 'mobile.terminal.viewport' || request.method === 'terminal.viewport') return mobileControlHandlers.handleMobileTerminalViewportControlRequest(params)
    if (request.method === 'mobile.terminal.scroll' || request.method === 'terminal.scroll') {
      return mobileControlHandlers.handleTerminalUnsupportedGestureRequest(params, 'aiopsterm does not expose xterm scroll gesture injection through the renderer control socket yet.')
    }
    if (request.method === 'mobile.terminal.mouse' || request.method === 'terminal.mouse') {
      return mobileControlHandlers.handleTerminalUnsupportedGestureRequest(params, 'aiopsterm does not expose xterm cell mouse injection through the renderer control socket yet.')
    }
    if (request.method === 'terminal.focus') return mobileControlHandlers.handleTerminalFocusControlRequest(params)
    if (request.method === 'terminal.read_screen') return mobileControlHandlers.handleTerminalReadScreenControlRequest(params)
    if (request.method === 'terminal.clear_history') return mobileControlHandlers.clearTerminalHistoryForControl(params)
    if (request.method === 'notification.sync' || request.method === 'notification.open') return workspaceControlHandlers.handleNotificationControlRequest(request.method, params)
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${request.method}`)
  }

  return { handleControlRequest }
}
