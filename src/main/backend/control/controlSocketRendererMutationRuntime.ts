import type { ControlResponse } from '@shared/contracts/control'

type RendererMutationEventInput = {
  name: string
  category: string
  source?: string
  payload?: Record<string, unknown>
  workspaceId?: string
  surfaceId?: string
}

type ControlSocketRendererMutationRuntime = {
  publishControlEvent?: (input: RendererMutationEventInput) => unknown
}

let runtime: ControlSocketRendererMutationRuntime = {}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const rendererMutationEventName = (method: string) => {
  if (method === 'project.open') return 'project.opened'
  if (method.startsWith('project.set_')) return 'project.updated'
  if (method === 'markdown.open') return 'markdown.opened'
  if (method === 'file.open') return 'file.opened'
  if (method === 'file.editor.open') return 'file.editor_opened'
  if (method.startsWith('workspace.group.') && method !== 'workspace.group.list') return method.replace('workspace.group.', 'workspace_group.')
  if (method.startsWith('surface.resume.') && !['surface.resume.get', 'surface.resume.show', 'surface.resume.preview', 'surface.resume.autorun.preview'].includes(method)) return method.replace('surface.resume.', 'surface_resume.')
  if (method === 'surface.focus') return 'surface.focused'
  if (method === 'surface.create') return 'surface.created'
  if (method === 'surface.action' || method === 'tab.action') return 'surface.actioned'
  if (method === 'surface.report_tty') return 'surface.tty_reported'
  if (method === 'surface.report_shell_state') return 'surface.shell_state_reported'
  if (method === 'surface.ports_kick') return 'surface.ports_kicked'
  if (method === 'surface.move') return 'surface.moved'
  if (method === 'surface.reorder') return 'surface.reordered'
  if (method === 'surface.drag_to_split' || method === 'surface.split_off') return 'surface.split_off'
  if (method === 'surface.refresh') return 'surface.refreshed'
  if (method === 'surface.trigger_flash') return 'surface.flashed'
  if (method === 'workspace.reorder') return 'workspace.reordered'
  if (method === 'workspace.reorder_many') return 'workspace.reordered_many'
  if (method === 'workspace.equalize_splits') return 'workspace.splits_equalized'
  if (method === 'workspace.prompt_submit') return 'workspace.prompt_submitted'
  if (method === 'workspace.action') return 'workspace.actioned'
  if (method === 'workspace.set_auto_title') return 'workspace.auto_title_set'
  if (method === 'workspace.remote.configure') return 'workspace_remote.configured'
  if (method === 'workspace.remote.reconnect') return 'workspace_remote.reconnected'
  if (method === 'workspace.remote.disconnect') return 'workspace_remote.disconnected'
  if (method === 'workspace.remote.foreground_auth_ready') return 'workspace_remote.foreground_auth_ready'
  if (method === 'workspace.remote.pty_attach_end') return 'workspace_remote.pty_attach_ended'
  if (method === 'workspace.remote.terminal_session_end') return 'workspace_remote.terminal_session_ended'
  if (method.startsWith('workspace.remote.pty_')) return 'workspace_remote.pty_unsupported'
  if (method.startsWith('remote.tmux.')) return 'remote_tmux.unsupported'
  if (method === 'asset.ssh.connect' || method === 'host.ssh.connect') return 'asset.ssh_connected'
  if (method === 'asset.save' || method === 'asset.add' || method === 'host.add') return 'asset.saved'
  if (method === 'pane.break') return 'pane.broken'
  if (method === 'pane.join') return 'pane.joined'
  if (method === 'pane.swap') return 'pane.swapped'
  if (method === 'pane.resize') return 'pane.resize_rejected'
  if (method === 'pane.focus') return 'pane.focused'
  if (method === 'pane.last') return 'pane.focused'
  if (method === 'workspace.select') return 'workspace.selected'
  if (method === 'workspace.next') return 'workspace.selected'
  if (method === 'workspace.previous') return 'workspace.selected'
  if (method === 'workspace.last') return 'workspace.selected'
  if (method === 'workspace.create') return 'workspace.created'
  if (method === 'pane.create') return 'pane.created'
  if (method === 'surface.split') return 'pane.created'
  if (method === 'workspace.rename') return 'workspace.renamed'
  if (method === 'workspace.close') return 'workspace.closed'
  if (method === 'surface.close') return 'pane.closed'
  if (method === 'workspace.select_layout') return 'workspace.layout_selected'
  if (method === 'agent-hibernation.on') return 'agent_hibernation.enabled'
  if (method === 'agent-hibernation.off') return 'agent_hibernation.disabled'
  if (method === 'agent.hibernate') return 'agent.hibernated'
  if (method === 'agent.resume') return 'agent.resumed'
  if (method === 'agent-hibernation.sweep' || method === 'agent.sweep') return 'agent_hibernation.swept'
  if (method === 'agent.team.launch') return 'agent_team.launched'
  return ''
}

const rendererMutationCategory = (method: string) => {
  if (method.startsWith('project.') || method === 'markdown.open' || method === 'file.open' || method === 'file.editor.open') return 'project'
  if (method.startsWith('workspace.group.')) return 'workspace'
  if (method.startsWith('workspace.')) return 'workspace'
  if (method.startsWith('remote.tmux.')) return 'workspace'
  if (method.startsWith('asset.') || method.startsWith('host.')) return 'asset'
  if (method.startsWith('surface.')) return method === 'surface.split' || method === 'surface.close' ? 'pane' : 'surface'
  if (method.startsWith('pane.')) return 'pane'
  if (method.startsWith('agent-hibernation.') || method.startsWith('agent.')) return 'agent'
  return 'control'
}

export const configureControlSocketRendererMutationRuntime = (config: ControlSocketRendererMutationRuntime = {}) => {
  runtime = { ...runtime, ...config }
}

export const publishRendererMutationEvent = (method: string, params: Record<string, unknown>, response: ControlResponse) => {
  if (!response.ok) return
  const name = rendererMutationEventName(method)
  if (!name) return
  const data = response.data || {}
  if (
    method === 'workspace.set_auto_title' &&
    data.workspaceApplied !== true &&
    data.workspace_applied !== true &&
    data.panelApplied !== true &&
    data.panel_applied !== true &&
    data.recorded !== true
  ) {
    return
  }
  const group = data.group && typeof data.group === 'object' ? (data.group as Record<string, unknown>) : null
  const team = data.team && typeof data.team === 'object' ? (data.team as Record<string, unknown>) : null
  const session = data.session && typeof data.session === 'object' ? (data.session as Record<string, unknown>) : null
  const surface = data.surface && typeof data.surface === 'object' ? (data.surface as Record<string, unknown>) : null
  const pane = data.pane && typeof data.pane === 'object' ? (data.pane as Record<string, unknown>) : null
  const createdSurface = data.createdSurface && typeof data.createdSurface === 'object' ? (data.createdSurface as Record<string, unknown>) : null
  const created_surface = data.created_surface && typeof data.created_surface === 'object' ? (data.created_surface as Record<string, unknown>) : null
  const selectedPane = data.selectedPane && typeof data.selectedPane === 'object' ? (data.selectedPane as Record<string, unknown>) : null
  const createdPane = data.createdPane && typeof data.createdPane === 'object' ? (data.createdPane as Record<string, unknown>) : null
  const closedPane = data.closedPane && typeof data.closedPane === 'object' ? (data.closedPane as Record<string, unknown>) : null
  const renamedPane = data.renamedPane && typeof data.renamedPane === 'object' ? (data.renamedPane as Record<string, unknown>) : null
  const targetPane = data.targetPane && typeof data.targetPane === 'object' ? (data.targetPane as Record<string, unknown>) : null
  const config = data.config && typeof data.config === 'object' ? (data.config as Record<string, unknown>) : null
  const remote = data.remote && typeof data.remote === 'object' ? (data.remote as Record<string, unknown>) : null
  const hibernated = Array.isArray(data.hibernated) ? data.hibernated : []
  runtime.publishControlEvent?.({
    name,
    category: rendererMutationCategory(method),
    source: 'control.socket',
    surfaceId: cleanText(data.surfaceId || data.surface_id || surface?.panelId || pane?.panelId || createdSurface?.panelId || created_surface?.panelId || selectedPane?.panelId || createdPane?.panelId || closedPane?.panelId || renamedPane?.panelId || params.panelId || params.surfaceId || params.paneId),
    payload: {
      method,
      ...(group
        ? {
            group_id: group.id,
            group_ref: group.ref,
            group_name: group.name,
            member_count: group.memberCount
          }
        : {}),
      ...(team
        ? {
            source: team.source,
            requested_count: team.requestedCount,
            launched_count: team.launchedCount,
            approval_count: team.approvalCount,
            failed_count: team.failedCount
          }
        : {}),
      ...(session
        ? {
            session_id: session.id,
            source: session.source,
            state: session.state
          }
        : {}),
      ...(surface ? { surface_id: surface.panelId, surface_kind: surface.surfaceKind } : {}),
      ...(pane
        ? {
            pane_id: pane.panelId,
            panel_id: pane.panelId,
            split_group_id: pane.splitGroupId
          }
        : {}),
      ...(createdSurface || created_surface ? { created_surface_id: cleanText(createdSurface?.panelId || created_surface?.panelId), created_panel_id: cleanText(createdSurface?.panelId || created_surface?.panelId) } : {}),
      ...(selectedPane
        ? {
            selected_pane_id: selectedPane.panelId,
            selected_panel_id: selectedPane.panelId,
            previous_panel_id: cleanText(data.previousActivePanelId),
            action: cleanText(data.action)
          }
        : {}),
      ...(createdPane ? { created_pane_id: createdPane.panelId, created_panel_id: createdPane.panelId } : {}),
      ...(closedPane ? { closed_pane_id: closedPane.panelId, closed_panel_id: closedPane.panelId } : {}),
      ...(renamedPane ? { renamed_pane_id: renamedPane.panelId, renamed_panel_id: renamedPane.panelId, title: renamedPane.title } : {}),
      ...(targetPane
        ? {
            target_pane_id: targetPane.panelId,
            target_panel_id: targetPane.panelId,
            target_split_group_id: targetPane.splitGroupId
          }
        : {}),
      ...(method === 'surface.report_tty' ? { tty_name: cleanText(data.ttyName || data.tty_name || params.ttyName || params.tty_name) } : {}),
      ...(method === 'surface.report_shell_state'
        ? {
            state: cleanText(data.state || data.shellState || data.shell_state || params.state || params.shellState || params.shell_state),
            published: data.published === true
          }
        : {}),
      ...(method === 'surface.ports_kick'
        ? {
            reason: cleanText(data.reason || params.reason) || 'command',
            kicked: data.kicked === true,
            port_scan_started: data.portScanStarted === true || data.port_scan_started === true
          }
        : {}),
      ...(method.startsWith('workspace.remote.') || method.startsWith('remote.tmux.')
        ? {
            remote_state: cleanText(remote?.connection_state || remote?.connectionState || remote?.state),
            remote_display_target: cleanText(remote?.remote_display_target || remote?.remoteDisplayTarget || remote?.displayTarget),
            destination: cleanText(remote?.destination || remote?.host || data.host || params.destination || params.host),
            reconnected: data.reconnected === true,
            disconnected: data.disconnected === true,
            unsupported: data.unsupported === true
          }
        : {}),
      ...(typeof data.unsupportedReason === 'string' ? { unsupported_reason: data.unsupportedReason } : {}),
      ...(method === 'workspace.set_auto_title'
        ? {
            title: cleanText(data.title),
            workspace_applied: data.workspaceApplied === true || data.workspace_applied === true,
            panel_applied: data.panelApplied === true || data.panel_applied === true,
            panel_id: cleanText(data.panel_id || data.panelId || params.panel_id || params.panelId)
          }
        : {}),
      ...(config ? { enabled: config.enabled } : {}),
      ...(method === 'agent-hibernation.sweep' || method === 'agent.sweep'
        ? {
            live_restorable_count: typeof data.liveRestorableCount === 'number' ? data.liveRestorableCount : 0,
            eligible_count: typeof data.eligibleCount === 'number' ? data.eligibleCount : 0,
            selected_count: typeof data.selectedCount === 'number' ? data.selectedCount : 0,
            pending_count: typeof data.pendingCount === 'number' ? data.pendingCount : 0,
            hibernated_count: typeof data.hibernatedCount === 'number' ? data.hibernatedCount : hibernated.length,
            hibernated_sessions: hibernated
              .map((item) => (item && typeof item === 'object' ? { source: (item as Record<string, unknown>).source, session_id: (item as Record<string, unknown>).id } : null))
              .filter(Boolean)
          }
        : {}),
      ...(method.startsWith('surface.resume.') ? { has_resume_binding: Boolean(data.resumeBinding || data.resume_binding) } : {})
    }
  })
}
