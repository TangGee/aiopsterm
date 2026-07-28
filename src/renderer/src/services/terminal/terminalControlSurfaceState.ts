import { ref } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlText,
  isRecord,
  type ControlProjectState,
  type ControlSurfaceResumeBindingState,
  type ControlSurfaceTelemetryState,
  type ControlWorkspaceEnvironmentState,
  type ControlWorkspaceGroupState,
  type ControlWorkspaceRemoteState,
  type TerminalControlSurfaceView,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type {
  ControlAiAttentionSummary,
  ControlManagedAiSessionSummary,
  ControlSplitGroupSummary,
  ControlSurfaceSummary,
  ControlSurfaceTelemetrySummary,
  ControlTerminalSummary,
  ControlWorkspaceGroupSummary,
  ControlWorkspaceRemoteSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

type TerminalControlSurfaceStateDependencies = {
  workspace: WorkspaceStore
  terminalViews: Map<string, TerminalControlSurfaceView>
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
}

export const createTerminalControlSurfaceState = ({
  workspace,
  terminalViews,
  isWelcomePlaceholderPanel
}: TerminalControlSurfaceStateDependencies) => {
  const controlWorkspaceGroups = ref<ControlWorkspaceGroupState[]>([])
  const controlSurfaceResumeBindings = ref<Record<string, ControlSurfaceResumeBindingState>>({})
  const controlProjectStates = ref<Record<string, ControlProjectState>>({})
  const controlSurfaceTelemetry = ref<Record<string, ControlSurfaceTelemetryState>>({})
  const controlWorkspaceRemote = ref<ControlWorkspaceRemoteState | null>(null)
  const controlWorkspaceEnvironment = ref<ControlWorkspaceEnvironmentState>({ env: {}, updatedAt: Date.now() })
  const lastActiveControlPanelId = ref('')
  const controlFlashingPanelIds = ref<string[]>([])

  const normalizeWorkspaceGroupId = (value: unknown) => {
    const text = controlText(value)
    if (!text) return ''
    const refMatch = text.match(/^workspace_group:(\d+)$/i)
    if (!refMatch) return text
    const index = Number(refMatch[1])
    if (!Number.isFinite(index) || index < 1) return text
    return controlWorkspaceGroups.value[index - 1]?.id || text
  }

  const workspaceGroupRefForControl = (groupId: string) => {
    const index = controlWorkspaceGroups.value.findIndex((group) => group.id === groupId)
    return index >= 0 ? `workspace_group:${index + 1}` : groupId
  }

  const panelMatchesControlId = (panel: TerminalPanel, id: string) => panel.id === id || panel.sessionId === id

  const selectableControlPanels = () => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel))

  const panelRefForControl = (panelId: string) => {
    const panels = selectableControlPanels()
    const index = panels.findIndex((panel) => panel.id === panelId)
    return index >= 0 ? `surface:${index + 1}` : panelId
  }

  const resolveControlPanelId = (value: unknown) => {
    const id = controlText(value)
    if (!id) return ''
    const panel = workspace.panels.find((item) => panelMatchesControlId(item, id))
    return panel?.id || ''
  }

  const resolveControlSurfacePanel = (params: Record<string, unknown> = {}) => {
    const panelId = controlText(params.panelId || params.surfaceId || params.surface_id || params.tabId || params.tab_id)
    const sessionId = controlText(params.sessionId || params.terminalSessionId || params.terminal_session_id || params.terminalId || params.terminal_id)
    if (panelId || sessionId) {
      return workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId || panel.id === sessionId || panel.sessionId === sessionId) || null
    }
    return workspace.panels.find((panel) => panel.id === workspace.activePanelId) || workspace.panels[0] || null
  }

  const resolveControlSourceSurfacePanel = (params: Record<string, unknown> = {}) => {
    const panelId = controlText(params.surfaceId || params.surface_id || params.tabId || params.tab_id || params.panelId || params.panel_id || params.id || params.target)
    const sessionId = controlText(params.sessionId || params.terminalSessionId || params.terminal_session_id || params.terminalId || params.terminal_id)
    if (panelId || sessionId) {
      return workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId || panel.id === sessionId || panel.sessionId === sessionId) || null
    }
    return workspace.panels.find((panel) => panel.id === workspace.activePanelId) || workspace.panels[0] || null
  }

  const controlPanelIndexFromValue = (value: unknown) => {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) return null
    return Math.floor(numberValue)
  }

  const resolveControlPanePanel = (params: Record<string, unknown> = {}, keyPrefix = '') => {
    const prefixed = (key: string) => (keyPrefix ? `${keyPrefix}${key.charAt(0).toUpperCase()}${key.slice(1)}` : key)
    const snakePrefix = keyPrefix ? `${keyPrefix}_` : ''
    const panelId = controlText(
      params[prefixed('paneId')] ||
        params[prefixed('panelId')] ||
        params[prefixed('surfaceId')] ||
        params[prefixed('pane_id')] ||
        params[prefixed('panel_id')] ||
        params[prefixed('surface_id')] ||
        params[`${snakePrefix}pane_id`] ||
        params[`${snakePrefix}panel_id`] ||
        params[`${snakePrefix}surface_id`]
    )
    const sessionId = controlText(
      params[prefixed('sessionId')] ||
        params[prefixed('terminalSessionId')] ||
        params[prefixed('terminal_session_id')] ||
        params[`${snakePrefix}session_id`] ||
        params[`${snakePrefix}terminal_session_id`]
    )
    if (panelId || sessionId) {
      return workspace.panels.find((panel) => panel.id === panelId || panel.sessionId === panelId || panel.id === sessionId || panel.sessionId === sessionId) || null
    }
    return workspace.panels.find((panel) => panel.id === workspace.activePanelId) || workspace.panels[0] || null
  }

  const resolveWorkspaceGroup = (value: unknown) => {
    const groupId = normalizeWorkspaceGroupId(value)
    return controlWorkspaceGroups.value.find((group) => group.id === groupId || workspaceGroupRefForControl(group.id) === groupId) || null
  }

  const pruneWorkspaceGroups = () => {
    const panelIds = new Set(workspace.panels.map((panel) => panel.id))
    controlWorkspaceGroups.value = controlWorkspaceGroups.value
      .map((group) => {
        const memberPanelIds = group.memberPanelIds.filter((panelId) => panelIds.has(panelId))
        const anchorPanelId = panelIds.has(group.anchorPanelId) ? group.anchorPanelId : memberPanelIds[0] || ''
        return { ...group, anchorPanelId, memberPanelIds: [...new Set(memberPanelIds)] }
      })
      .filter((group) => group.anchorPanelId && group.memberPanelIds.length)
    controlSurfaceResumeBindings.value = Object.fromEntries(Object.entries(controlSurfaceResumeBindings.value).filter(([panelId]) => panelIds.has(panelId)))
    controlProjectStates.value = Object.fromEntries(Object.entries(controlProjectStates.value).filter(([panelId]) => panelIds.has(panelId)))
    controlSurfaceTelemetry.value = Object.fromEntries(Object.entries(controlSurfaceTelemetry.value).filter(([panelId]) => panelIds.has(panelId)))
    if (controlWorkspaceRemote.value && !panelIds.has(controlWorkspaceRemote.value.surfaceId)) controlWorkspaceRemote.value = null
  }

  const groupForPanelId = (panelId: string) => {
    pruneWorkspaceGroups()
    return controlWorkspaceGroups.value.find((group) => group.memberPanelIds.includes(panelId)) || null
  }

  const terminalKindForControl = (panel: TerminalPanel): ControlTerminalSummary['kind'] => {
    if (panel.sshSession) return 'ssh'
    if (panel.sessionId || panel.terminalLifecycle?.kind === 'local') return 'local'
    return 'unknown'
  }

  const terminalSummaryForControl = (panel: TerminalPanel): ControlTerminalSummary => {
    const view = terminalViews.get(panel.id)
    const lifecycle = panel.terminalLifecycle
    return {
      panelId: panel.id,
      panel_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      terminalId: panel.id,
      terminal_id: panel.id,
      ...(panel.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
      title: panel.title,
      ...(panel.titleSource ? { titleSource: panel.titleSource, title_source: panel.titleSource } : {}),
      kind: terminalKindForControl(panel),
      active: panel.id === workspace.activePanelId,
      connected: Boolean(panel.sessionId),
      status: panel.status,
      cwd: panel.cwd,
      ...(lifecycle?.shell ? { shell: lifecycle.shell } : {}),
      ...(typeof lifecycle?.processId === 'number' ? { processId: lifecycle.processId } : {}),
      ...(typeof lifecycle?.processGroupId === 'number' ? { processGroupId: lifecycle.processGroupId } : {}),
      ...(panel.sshSession?.host ? { host: panel.sshSession.host } : {}),
      ...(panel.sshSession?.port ? { port: panel.sshSession.port } : {}),
      ...(panel.sshSession?.username ? { username: panel.sshSession.username } : {}),
      ...(panel.sshSession?.assetId ? { assetId: panel.sshSession.assetId } : {}),
      ...(panel.sshSession?.assetName ? { assetName: panel.sshSession.assetName } : {}),
      ...(view ? { cols: view.terminal.cols, rows: view.terminal.rows } : {})
    }
  }

  const surfaceTelemetrySummaryForControl = (state?: ControlSurfaceTelemetryState): ControlSurfaceTelemetrySummary | undefined => {
    if (!state) return undefined
    return {
      ...(state.ttyName ? { ttyName: state.ttyName, tty_name: state.ttyName } : {}),
      ...(state.shellState ? { shellState: state.shellState, shell_state: state.shellState } : {}),
      ...(typeof state.lastShellStateAt === 'number' ? { lastShellStateAt: state.lastShellStateAt, last_shell_state_at: state.lastShellStateAt } : {}),
      ...(typeof state.lastTtyAt === 'number' ? { lastTtyAt: state.lastTtyAt, last_tty_at: state.lastTtyAt } : {}),
      ...(typeof state.lastPortsKickAt === 'number' ? { lastPortsKickAt: state.lastPortsKickAt, last_ports_kick_at: state.lastPortsKickAt } : {}),
      ...(state.lastPortsKickReason ? { lastPortsKickReason: state.lastPortsKickReason, last_ports_kick_reason: state.lastPortsKickReason } : {})
    }
  }

  const surfaceSummaryForControl = (panel: TerminalPanel): ControlSurfaceSummary => {
    const workspaceGroup = groupForPanelId(panel.id)
    const resumeBinding = controlSurfaceResumeBindings.value[panel.id]
    const telemetry = surfaceTelemetrySummaryForControl(controlSurfaceTelemetry.value[panel.id])
    const terminalSurface = isTerminalWorkspacePanel(panel)
    return {
      panelId: panel.id,
      panel_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      title: panel.title,
      ...(panel.titleSource ? { titleSource: panel.titleSource, title_source: panel.titleSource } : {}),
      surfaceKind: panel.kind === 'knowledge'
        ? 'knowledge'
        : panel.kind === 'managed-ai-session'
          ? 'managed-ai-session'
          : panel.kind === 'local-file'
            ? 'local-file'
            : 'terminal',
      active: panel.id === workspace.activePanelId,
      status: panel.status,
      cwd: panel.cwd,
      ...(panel.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
      ...(terminalSurface ? { terminalKind: terminalKindForControl(panel), connected: Boolean(panel.sessionId) } : {}),
      ...(panel.split ? { split: panel.split } : {}),
      ...(panel.splitSourceId ? { splitSourceId: panel.splitSourceId } : {}),
      ...(panel.splitGroupId ? { splitGroupId: panel.splitGroupId } : {}),
      ...(typeof panel.splitOrder === 'number' ? { splitOrder: panel.splitOrder } : {}),
      ...(workspaceGroup ? { workspaceGroupId: workspaceGroup.id, workspaceGroupName: workspaceGroup.name } : {}),
      ...(resumeBinding ? { resumeBinding, resume_binding: resumeBinding } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...(panel.knowledge
        ? {
            knowledge: {
              relPath: panel.knowledge.relPath,
              isImage: panel.knowledge.isImage,
              ...(typeof panel.knowledge.startLine === 'number' ? { startLine: panel.knowledge.startLine } : {}),
              ...(typeof panel.knowledge.endLine === 'number' ? { endLine: panel.knowledge.endLine } : {})
            }
          }
        : {}),
      ...(panel.managedAiSession
        ? {
            managedAiSession: {
              source: panel.managedAiSession.source,
              sessionId: panel.managedAiSession.sessionId
            }
          }
        : {}),
      ...(panel.localFile ? { localFile: { filePath: panel.localFile.filePath } } : {})
    }
  }

  const splitGroupsForControl = (surfaces: ControlSurfaceSummary[]): ControlSplitGroupSummary[] => {
    const groups = new Map<string, ControlSurfaceSummary[]>()
    surfaces.forEach((surface) => {
      const groupId = surface.splitGroupId || (surface.split ? surface.splitSourceId || surface.panelId : '')
      if (!groupId) return
      groups.set(groupId, [...(groups.get(groupId) || []), surface])
    })
    return [...groups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([id, items]) => {
        const directions = new Set(items.map((item) => item.split).filter(Boolean))
        return {
          id,
          panelIds: items.map((item) => item.panelId),
          count: items.length,
          ...(items.some((item) => item.active) ? { activePanelId: items.find((item) => item.active)?.panelId } : {}),
          direction: directions.size === 1 ? ([...directions][0] as 'right' | 'below') : 'mixed'
        }
      })
  }

  const workspaceGroupSummaryForControl = (group: ControlWorkspaceGroupState): ControlWorkspaceGroupSummary => ({
    id: group.id,
    ref: workspaceGroupRefForControl(group.id),
    name: group.name,
    anchorPanelId: group.anchorPanelId,
    memberPanelIds: [...group.memberPanelIds],
    memberCount: group.memberPanelIds.length,
    collapsed: group.collapsed,
    pinned: group.pinned,
    index: group.index,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    ...(group.cwd ? { cwd: group.cwd } : {}),
    ...(group.color ? { color: group.color } : {}),
    ...(group.icon ? { icon: group.icon } : {}),
    active: group.memberPanelIds.includes(workspace.activePanelId)
  })

  const remoteStateForControlPanel = (panel?: TerminalPanel | null) => {
    if (!panel?.sshSession) return 'local'
    if (panel.sessionId && (panel.status === 'running' || panel.status === 'ready' || panel.status === 'connecting')) return 'connected'
    if (panel.status === 'connecting') return 'connecting'
    if (panel.status === 'error') return 'error'
    return 'disconnected'
  }

  const remoteDisplayTargetForControl = (panel?: TerminalPanel | null, state?: ControlWorkspaceRemoteState | null) => {
    const ssh = panel?.sshSession
    const username = ssh?.username || state?.username
    const host = ssh?.host || state?.host || state?.destination
    const port = ssh?.port || state?.port
    if (!host) return ''
    return `${username ? `${username}@` : ''}${host}${port && port !== 22 ? `:${port}` : ''}`
  }

  const workspaceRemoteSummaryForControl = (): ControlWorkspaceRemoteSummary | null => {
    pruneWorkspaceGroups()
    const configured = controlWorkspaceRemote.value
    const configuredPanel = configured ? workspace.panels.find((panel) => panel.id === configured.surfaceId) || null : null
    const activePanel = workspace.panels.find((panel) => panel.id === workspace.activePanelId && panel.sshSession) || null
    const firstSshPanel = workspace.panels.find((panel) => panel.sshSession) || null
    const panel = configuredPanel || activePanel || firstSshPanel
    const ssh = panel?.sshSession
    if (!configured && !ssh) {
      return {
        configured: false,
        state: 'local',
        connectionState: 'local',
        connection_state: 'local'
      }
    }
    const state = panel ? remoteStateForControlPanel(panel) : 'configured'
    const displayTarget = remoteDisplayTargetForControl(panel, configured)
    return {
      configured: true,
      state,
      connectionState: state,
      connection_state: state,
      ...(displayTarget ? { displayTarget, display_target: displayTarget, remoteDisplayTarget: displayTarget, remote_display_target: displayTarget } : {}),
      ...(panel ? { surfaceId: panel.id, surface_id: panel.id, panelId: panel.id } : configured ? { surfaceId: configured.surfaceId, surface_id: configured.surfaceId, panelId: configured.surfaceId } : {}),
      ...(panel?.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
      transport: configured?.transport || 'ssh',
      ...(ssh?.host || configured?.host ? { host: ssh?.host || configured?.host, destination: ssh?.host || configured?.destination } : {}),
      ...(ssh?.port || configured?.port ? { port: ssh?.port || configured?.port } : {}),
      ...(ssh?.username || configured?.username ? { username: ssh?.username || configured?.username } : {}),
      ...(ssh?.assetId || configured?.assetId ? { assetId: ssh?.assetId || configured?.assetId } : {}),
      ...(ssh?.assetName || configured?.assetName ? { assetName: ssh?.assetName || configured?.assetName } : {}),
      ...(ssh?.proxyName || configured?.proxyName ? { proxyName: ssh?.proxyName || configured?.proxyName } : {}),
      ...((typeof ssh?.needProxy === 'boolean' || typeof configured?.needProxy === 'boolean') ? { needProxy: Boolean(ssh?.needProxy ?? configured?.needProxy) } : {}),
      ...(typeof configured?.foregroundAuthReadyAt === 'number' ? { foregroundAuthReadyAt: configured.foregroundAuthReadyAt, foreground_auth_ready_at: configured.foregroundAuthReadyAt } : {}),
      ...(typeof configured?.updatedAt === 'number' ? { updatedAt: configured.updatedAt, updated_at: configured.updatedAt } : {})
    }
  }

  const aiAttentionSummaryForControl = (item: (typeof workspace.pendingAiAttentionItems)[number]): ControlAiAttentionSummary => ({
    id: item.id,
    source: item.source,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    priority: item.priority,
    createdAt: item.createdAt,
    ...(item.conversationId ? { conversationId: item.conversationId } : {}),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.surfaceId ? { surfaceId: item.surfaceId } : {}),
    ...(item.notificationId ? { notificationId: item.notificationId } : {})
  })

  const managedAiSessionSummaryForControl = (session: (typeof workspace.managedAiSessions)[number]): ControlManagedAiSessionSummary => ({
    id: session.id,
    source: session.source,
    title: session.title,
    summary: session.summary,
    state: session.state,
    lastEvent: session.lastEvent,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    needsInput: session.state === 'needsInput',
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
    ...(session.toolName ? { toolName: session.toolName } : {}),
    ...(session.launchCommand ? { launchCommand: session.launchCommand } : {}),
    ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
    ...(typeof session.processId === 'number' ? { processId: session.processId } : {}),
    ...(typeof session.parentProcessId === 'number' ? { parentProcessId: session.parentProcessId } : {}),
    ...(typeof session.processGroupId === 'number' ? { processGroupId: session.processGroupId } : {}),
    ...(session.agentLifecycle ? { agentLifecycle: session.agentLifecycle } : {}),
    ...(typeof session.terminalProcessId === 'number' ? { terminalProcessId: session.terminalProcessId } : {}),
    ...(typeof session.terminalActivityAt === 'number' ? { terminalActivityAt: session.terminalActivityAt } : {}),
    ...(session.hibernated ? { hibernated: true } : {}),
    ...(typeof session.hibernatedAt === 'number' ? { hibernatedAt: session.hibernatedAt } : {}),
    ...(session.hibernationReason ? { hibernationReason: session.hibernationReason } : {}),
    ...(session.hibernatedTerminalSessionId ? { hibernatedTerminalSessionId: session.hibernatedTerminalSessionId } : {}),
    eventCount: session.events.length,
    decisionCount: session.decisions.length
  })

  const workspaceEnvironmentSummaryForControl = () => {
    const keys = Object.keys(controlWorkspaceEnvironment.value.env).sort()
    return {
      keys,
      count: keys.length,
      updatedAt: controlWorkspaceEnvironment.value.updatedAt,
      updated_at: controlWorkspaceEnvironment.value.updatedAt
    }
  }

  const workspaceSnapshotForControl = (): ControlWorkspaceSnapshot => {
    pruneWorkspaceGroups()
    const terminals = workspace.panels.filter((panel) => isTerminalWorkspacePanel(panel)).map(terminalSummaryForControl)
    const surfaces = workspace.panels.map(surfaceSummaryForControl)
    const splitGroups = splitGroupsForControl(surfaces)
    const workspaceGroups = controlWorkspaceGroups.value.map(workspaceGroupSummaryForControl)
    const attentionItems = workspace.pendingAiAttentionItems.map(aiAttentionSummaryForControl)
    const managedAiSessions = workspace.managedAiSessions.map(managedAiSessionSummaryForControl)
    const remote = workspaceRemoteSummaryForControl()
    const environmentSummary = workspaceEnvironmentSummaryForControl()
    return {
      generatedAt: Date.now(),
      mode: workspace.mode,
      activeModule: workspace.activeModule,
      activePanelId: workspace.activePanelId,
      workspaces: [
        {
          id: 'main',
          title: 'Main Workspace',
          autoTitle: null,
          auto_title: null,
          titleSource: 'system',
          title_source: 'system',
          active: true,
          mode: workspace.mode,
          activeModule: workspace.activeModule,
          activePanelId: workspace.activePanelId,
          remoteDisplayTarget: remote?.remoteDisplayTarget || null,
          remote_display_target: remote?.remote_display_target || null,
          remoteConnectionState: remote?.connectionState || 'local',
          remote_connection_state: remote?.connection_state || 'local',
          remote
        }
      ],
      terminals,
      surfaces,
      splitGroups,
      workspaceGroups,
      notifications: workspace.controlNotifications.map((notification) => ({ ...notification })),
      managedAiSessions,
      agentHibernation: { ...workspace.agentHibernationConfig },
      remote,
      workspaceEnvironment: environmentSummary,
      workspace_environment: {
        keys: environmentSummary.keys,
        count: environmentSummary.count,
        updated_at: environmentSummary.updated_at
      },
      attention: {
        unreadCount: workspace.aiAttentionUnreadCount,
        items: attentionItems,
        ...(attentionItems[0] ? { current: attentionItems[0] } : {})
      },
      counts: {
        terminals: terminals.length,
        connectedTerminals: terminals.filter((terminal) => terminal.connected).length,
        surfaces: surfaces.length,
        splitGroups: splitGroups.length,
        workspaceGroups: workspaceGroups.length,
        notifications: workspace.controlNotifications.length,
        unreadNotifications: workspace.controlNotifications.filter((notification) => !notification.read).length,
        managedAiSessions: managedAiSessions.length,
        managedAiNeedsInput: managedAiSessions.filter((session) => session.needsInput).length,
        attentionItems: attentionItems.length
      }
    }
  }

  const cleanWorkspaceEnvironmentForControl = (value: unknown) => {
    if (!isRecord(value)) return {}
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry : controlText(entry)] as const)
        .filter(([key, entry]) => key && entry && !key.includes('\0') && !key.includes('=') && !entry.includes('\0'))
    )
  }

  const recordLastActiveControlPanel = (panelId: string) => {
    lastActiveControlPanelId.value = panelId
  }

  return {
    controlWorkspaceGroups,
    controlSurfaceResumeBindings,
    controlProjectStates,
    controlSurfaceTelemetry,
    controlWorkspaceRemote,
    controlWorkspaceEnvironment,
    lastActiveControlPanelId,
    controlFlashingPanelIds,
    cleanWorkspaceEnvironmentForControl,
    controlPanelIndexFromValue,
    managedAiSessionSummaryForControl,
    panelMatchesControlId,
    panelRefForControl,
    pruneWorkspaceGroups,
    recordLastActiveControlPanel,
    remoteStateForControlPanel,
    resolveControlPanePanel,
    resolveControlPanelId,
    resolveControlSourceSurfacePanel,
    resolveControlSurfacePanel,
    resolveWorkspaceGroup,
    surfaceSummaryForControl,
    surfaceTelemetrySummaryForControl,
    terminalKindForControl,
    terminalSummaryForControl,
    workspaceGroupSummaryForControl,
    workspaceRemoteSummaryForControl,
    workspaceSnapshotForControl
  }
}

export type TerminalControlSurfaceState = ReturnType<typeof createTerminalControlSurfaceState>
