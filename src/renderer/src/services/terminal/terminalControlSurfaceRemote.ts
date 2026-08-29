import { nextTick } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  type ControlWorkspaceRemoteState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type {
  ControlResponse,
  ControlSurfaceSummary,
  ControlWorkspaceRemoteSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

type TerminalControlSurfaceRemoteDependencies = {
  workspace: WorkspaceStore
  controlWorkspaceRemote: { value: ControlWorkspaceRemoteState | null }
  resolveControlSourceSurfacePanel: (params?: Record<string, unknown>) => TerminalPanel | null
  remoteStateForControlPanel: (panel?: TerminalPanel | null) => string
  workspaceRemoteSummaryForControl: () => ControlWorkspaceRemoteSummary | null
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  startSshTerminalForPanel: (panel: TerminalPanel) => Promise<boolean>
  disconnectTerminalPanel: (panel: TerminalPanel) => Promise<boolean>
}

export const createTerminalControlSurfaceRemoteHandlers = ({
  workspace,
  controlWorkspaceRemote,
  resolveControlSourceSurfacePanel,
  remoteStateForControlPanel,
  workspaceRemoteSummaryForControl,
  workspaceSnapshotForControl,
  surfaceSummaryForControl,
  startSshTerminalForPanel,
  disconnectTerminalPanel
}: TerminalControlSurfaceRemoteDependencies) => {
  const resolveRemoteWorkspacePanelForControl = (params: Record<string, unknown> = {}) => {
    const directPanel = resolveControlSourceSurfacePanel(params)
    if (directPanel && isTerminalWorkspacePanel(directPanel)) return directPanel
    const remoteSurfaceId = controlWorkspaceRemote.value?.surfaceId
    if (remoteSurfaceId) {
      const panel = workspace.panels.find((item) => item.id === remoteSurfaceId && isTerminalWorkspacePanel(item))
      if (panel) return panel
    }
    return workspace.panels.find((panel) => panel.id === workspace.activePanelId && isTerminalWorkspacePanel(panel)) || workspace.panels.find((panel) => isTerminalWorkspacePanel(panel)) || null
  }

  const hasExplicitRemotePanelTarget = (params: Record<string, unknown> = {}) =>
    Boolean(controlText(params.surfaceId || params.surface_id || params.panelId || params.panel_id || params.paneId || params.pane_id || params.target))

  const remoteControlPayload = (extra: Record<string, unknown> = {}) =>
    controlOk({
      window_id: null,
      window_ref: null,
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      remote: workspaceRemoteSummaryForControl(),
      ...extra,
      snapshot: workspaceSnapshotForControl()
    })

  const unsupportedRemoteControlPayload = (method: string, message: string, extra: Record<string, unknown> = {}) =>
    controlOk({
      workspaceId: controlText(extra.workspaceId) || 'main',
      workspace_id: controlText(extra.workspace_id || extra.workspaceId) || 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      method,
      unsupported: true,
      unsupportedReason: message,
      unsupported_reason: message,
      remote: workspaceRemoteSummaryForControl(),
      ...extra
    })

  const handleWorkspaceRemoteControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    if (method === 'workspace.remote.status') return remoteControlPayload({ status: 'ok' })

    if (method === 'workspace.remote.configure') {
      const destination = controlText(params.destination || params.host || params.hostname || params.remoteHost)
      if (!destination) return controlFail('REMOTE_DESTINATION_REQUIRED', 'workspace.remote.configure requires destination.')
      if (destination.startsWith('-') || /[\u0000-\u001f\u007f]/.test(destination)) return controlFail('REMOTE_DESTINATION_INVALID', 'Invalid remote destination.')
      const port = controlNumber(params.port || params.sshPort || params.ssh_port, 22, 1, 65535)
      const username = controlText(params.username || params.user) || (destination.includes('@') ? destination.split('@')[0] : 'root')
      const host = destination.includes('@') ? destination.split('@').slice(1).join('@') || destination : destination
      const requestedPanel = hasExplicitRemotePanelTarget(params) ? resolveRemoteWorkspacePanelForControl(params) : null
      if (hasExplicitRemotePanelTarget(params) && !requestedPanel) return controlFail('REMOTE_SURFACE_NOT_FOUND', 'Remote target surface was not found.')
      if (requestedPanel?.sessionId && !requestedPanel.sshSession) {
        return controlFail('REMOTE_SURFACE_BUSY', 'Target surface is connected to a local terminal; choose an empty or SSH surface.')
      }
      const panel =
        requestedPanel ||
        (controlWorkspaceRemote.value ? workspace.panels.find((item) => item.id === controlWorkspaceRemote.value?.surfaceId && isTerminalWorkspacePanel(item)) || null : null) ||
        workspace.panels.find((item) => item.sshSession && !item.sessionId) ||
        workspace.panels.find((item) => isTerminalWorkspacePanel(item) && !item.sessionId && item.status !== 'running') ||
        workspace.createPanel()
      const assetName = controlText(params.name || params.title || params.assetName || params.asset_name) || destination
      workspace.registerSshSession(panel.id, {
        id: controlText(params.assetId || params.asset_id) || `control-remote:${host}:${port}:${username}`,
        name: assetName,
        title: assetName,
        host,
        port,
        username,
        needProxy: controlBool(params.needProxy ?? params.need_proxy, false),
        proxyName: controlText(params.proxyName || params.proxy_name),
        jumpHostId: controlText(params.jumpHostId || params.jump_host_id)
      })
      workspace.renamePanel(panel.id, assetName)
      controlWorkspaceRemote.value = {
        surfaceId: panel.id,
        transport: 'ssh',
        destination,
        host,
        port,
        username,
        assetId: controlText(params.assetId || params.asset_id) || `control-remote:${host}:${port}:${username}`,
        assetName,
        proxyName: controlText(params.proxyName || params.proxy_name),
        needProxy: controlBool(params.needProxy ?? params.need_proxy, false),
        updatedAt: Date.now()
      }
      const autoConnect = controlBool(params.autoConnect ?? params.auto_connect, false)
      if (autoConnect) await startSshTerminalForPanel(panel)
      await nextTick()
      return remoteControlPayload({
        configured: true,
        autoConnect,
        auto_connect: autoConnect,
        surfaceId: panel.id,
        surface_id: panel.id,
        surface: surfaceSummaryForControl(panel)
      })
    }

    if (method === 'workspace.remote.reconnect') {
      const panel = resolveRemoteWorkspacePanelForControl(params)
      if (!panel?.sshSession) return controlFail('REMOTE_NOT_CONFIGURED', 'Remote workspace is not configured.')
      const connected = await startSshTerminalForPanel(panel)
      await nextTick()
      return remoteControlPayload({
        reconnected: connected,
        connected,
        surfaceId: panel.id,
        surface_id: panel.id,
        surface: surfaceSummaryForControl(panel)
      })
    }

    if (method === 'workspace.remote.disconnect') {
      const panel = resolveRemoteWorkspacePanelForControl(params)
      if (!panel?.sshSession) return controlFail('REMOTE_NOT_CONFIGURED', 'Remote workspace is not configured.')
      let disconnected = true
      if (panel.sessionId) disconnected = await disconnectTerminalPanel(panel)
      const clear = controlBool(params.clear ?? params.clearConfiguration ?? params.clear_configuration, false)
      if (clear) {
        panel.sshSession = undefined
        controlWorkspaceRemote.value = null
      } else if (controlWorkspaceRemote.value?.surfaceId === panel.id) {
        controlWorkspaceRemote.value = { ...controlWorkspaceRemote.value, updatedAt: Date.now() }
      }
      await nextTick()
      return remoteControlPayload({
        disconnected,
        clear,
        cleared: clear,
        surfaceId: panel.id,
        surface_id: panel.id,
        surface: surfaceSummaryForControl(panel)
      })
    }

    if (method === 'workspace.remote.foreground_auth_ready') {
      const panel = resolveRemoteWorkspacePanelForControl(params)
      if (!panel?.sshSession && !controlWorkspaceRemote.value) return controlFail('REMOTE_NOT_CONFIGURED', 'Remote workspace is not configured.')
      const now = Date.now()
      if (controlWorkspaceRemote.value) {
        controlWorkspaceRemote.value = { ...controlWorkspaceRemote.value, foregroundAuthReadyAt: now, updatedAt: now }
      }
      return remoteControlPayload({
        foregroundAuthReady: true,
        foreground_auth_ready: true,
        foregroundAuthReadyAt: now,
        foreground_auth_ready_at: now,
        ...(panel ? { surfaceId: panel.id, surface_id: panel.id, surface: surfaceSummaryForControl(panel) } : {})
      })
    }

    if (method === 'workspace.remote.pty_sessions') {
      const sshPanels = workspace.panels.filter((panel) => panel.sshSession)
      return controlOk({
        all_workspaces: controlBool(params.allWorkspaces ?? params.all_workspaces, false),
        workspace_count: 1,
        sessions: sshPanels.map((panel) => ({
          id: panel.sessionId || panel.id,
          session_id: panel.sessionId || panel.id,
          surface_id: panel.id,
          workspace_id: 'main',
          workspace_ref: 'workspace:1',
          title: panel.title,
          state: remoteStateForControlPanel(panel),
          connected: Boolean(panel.sessionId),
          remote: workspaceRemoteSummaryForControl()
        })),
        errors: [],
        remote: workspaceRemoteSummaryForControl()
      })
    }

    if (method === 'workspace.remote.pty_attach_end') {
      const sessionId = controlText(params.sessionId || params.session_id)
      if (!sessionId) return controlFail('REMOTE_PTY_SESSION_REQUIRED', 'workspace.remote.pty_attach_end requires session_id.')
      const panel = resolveRemoteWorkspacePanelForControl(params)
      return controlOk({
        workspace_id: 'main',
        workspace_ref: 'workspace:1',
        surface_id: panel?.id || controlText(params.surfaceId || params.surface_id),
        surface_ref: panel?.id || controlText(params.surfaceId || params.surface_id),
        session_id: sessionId,
        workspace_found: Boolean(panel),
        cleared_remote_pty_session: false,
        untracked_remote_terminal: !panel,
        remote: workspaceRemoteSummaryForControl()
      })
    }

    if (method === 'workspace.remote.terminal_session_end') {
      const relayPort = controlNumber(params.relayPort || params.relay_port, 0, 0, 65535)
      if (!relayPort) return controlFail('REMOTE_RELAY_PORT_INVALID', 'workspace.remote.terminal_session_end requires relay_port.')
      const panel = resolveRemoteWorkspacePanelForControl(params)
      return controlOk({
        workspace_id: 'main',
        workspace_ref: 'workspace:1',
        surface_id: panel?.id || controlText(params.surfaceId || params.surface_id),
        surface_ref: panel?.id || controlText(params.surfaceId || params.surface_id),
        relay_port: relayPort,
        remote: workspaceRemoteSummaryForControl()
      })
    }

    if (method === 'workspace.remote.pty_bridge') {
      const sessionId = controlText(params.sessionId || params.session_id)
      if (!sessionId) return controlFail('REMOTE_PTY_SESSION_REQUIRED', 'workspace.remote.pty_bridge requires session_id.')
      const attachmentId = controlText(params.attachmentId || params.attachment_id) || `aiopsterm-${Date.now().toString(36)}`
      return unsupportedRemoteControlPayload(method, 'Detached remote PTY bridge sessions are not available; use visible SSH terminal surfaces instead.', {
        session_id: sessionId,
        attachment_id: attachmentId,
        require_existing: controlBool(params.requireExisting ?? params.require_existing, false),
        wait_for_ready: controlBool(params.waitForReady ?? params.wait_for_ready, false),
        command: controlText(params.command),
        bridge_available: false
      })
    }

    if (method === 'workspace.remote.pty_resize') {
      const sessionId = controlText(params.sessionId || params.session_id)
      if (!sessionId) return controlFail('REMOTE_PTY_SESSION_REQUIRED', 'workspace.remote.pty_resize requires session_id.')
      const attachmentId = controlText(params.attachmentId || params.attachment_id)
      if (!attachmentId) return controlFail('REMOTE_PTY_ATTACHMENT_REQUIRED', 'workspace.remote.pty_resize requires attachment_id.')
      const attachmentToken = controlText(params.attachmentToken || params.attachment_token)
      if (!attachmentToken) return controlFail('REMOTE_PTY_ATTACHMENT_TOKEN_REQUIRED', 'workspace.remote.pty_resize requires attachment_token.')
      const cols = controlNumber(params.cols || params.columns, 0, 0, 1000)
      const rows = controlNumber(params.rows, 0, 0, 1000)
      if (!cols || !rows) return controlFail('REMOTE_PTY_SIZE_INVALID', 'workspace.remote.pty_resize requires positive cols and rows.')
      return unsupportedRemoteControlPayload(method, 'Detached remote PTY resize is not available; resize the visible SSH terminal surface instead.', {
        session_id: sessionId,
        attachment_id: attachmentId,
        cols,
        rows,
        resized: false
      })
    }

    if (method.startsWith('workspace.remote.pty_')) {
      return unsupportedRemoteControlPayload(method, 'Detached remote PTY bridge sessions are not available; use visible SSH terminal surfaces instead.', {
        session_id: controlText(params.sessionId || params.session_id),
        attachment_id: controlText(params.attachmentId || params.attachment_id),
        closed: false,
        detached: false
      })
    }

    if (method.startsWith('remote.tmux.')) {
      return unsupportedRemoteControlPayload(method, 'Remote tmux control-mode mirroring is not available through the control socket.', {
        host: controlText(params.host || params.destination),
        session: controlText(params.session)
      })
    }

    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  return {
    handleWorkspaceRemoteControlRequest
  }
}
