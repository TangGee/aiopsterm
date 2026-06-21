import { nextTick, ref } from 'vue'
import type { SettingSectionKey } from '@/config/settings'
import type { TerminalPanel } from '@/stores/workspace'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  isRecord,
  isTerminalKillSuccess,
  terminalControlBufferText,
  type ControlProjectState,
  type ControlSurfaceResumeBindingState,
  type ControlSurfaceTelemetryState,
  type ControlWorkspaceEnvironmentState,
  type ControlWorkspaceGroupState,
  type ControlWorkspaceRemoteState,
  type TerminalControlSurfaceDependencies,
  type TerminalControlSurfaceView
} from '@/services/terminalControlSurfaceCore'
import { createTerminalControlSurfaceAgentHandlers } from '@/services/terminalControlSurfaceAgents'
import { createTerminalControlSurfaceMobileHandlers } from '@/services/terminalControlSurfaceMobile'
import { createTerminalControlSurfaceSessionHandlers } from '@/services/terminalControlSurfaceSessions'
import { terminalClient } from '@/services/terminalClient'
import type {
  ControlAiAttentionSummary,
  ControlManagedAiSessionSummary,
  ControlNotificationFocusRequest,
  ControlNotificationRecord,
  ControlRequest,
  ControlResponse,
  ControlSplitGroupSummary,
  ControlSurfaceSummary,
  ControlSurfaceTelemetrySummary,
  ControlTerminalSummary,
  ControlWorkspaceGroupSummary,
  ControlWorkspaceRemoteSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

export type {
  TerminalControlSurfaceDependencies,
  TerminalControlSurfaceView
} from '@/services/terminalControlSurfaceCore'

export const createTerminalControlSurfaceRuntime = ({
  workspace,
  terminalViews,
  visibleTerminalPanels,
  isWelcomePlaceholderPanel,
  terminalViewSize,
  startSshTerminalForPanel,
  disconnectTerminalPanel,
  scheduleVisibleTerminalFit
}: TerminalControlSurfaceDependencies) => {
const controlWorkspaceGroups = ref<ControlWorkspaceGroupState[]>([])
const controlSurfaceResumeBindings = ref<Record<string, ControlSurfaceResumeBindingState>>({})
const controlProjectStates = ref<Record<string, ControlProjectState>>({})
const controlSurfaceTelemetry = ref<Record<string, ControlSurfaceTelemetryState>>({})
const controlWorkspaceRemote = ref<ControlWorkspaceRemoteState | null>(null)
const controlWorkspaceEnvironment = ref<ControlWorkspaceEnvironmentState>({ env: {}, updatedAt: Date.now() })
const lastActiveControlPanelId = ref('')
const controlFlashingPanelIds = ref<string[]>([])
let controlFlashTimer: number | null = null

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

const resolveControlAnchorPanel = (params: Record<string, unknown> = {}, anchor: 'before' | 'after') => {
  const pascal = anchor.charAt(0).toUpperCase() + anchor.slice(1)
  const panelId = controlText(
    params[`${anchor}SurfaceId`] ||
      params[`${anchor}_surface_id`] ||
      params[`${anchor}PanelId`] ||
      params[`${anchor}_panel_id`] ||
      params[`${anchor}PaneId`] ||
      params[`${anchor}_pane_id`] ||
      params[anchor] ||
      params[`target${pascal}SurfaceId`] ||
      params[`target_${anchor}_surface_id`]
  )
  if (!panelId) return null
  return workspace.panels.find((panel) => panelMatchesControlId(panel, panelId) || panel.title === panelId) || null
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
  return {
    panelId: panel.id,
    panel_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    title: panel.title,
    ...(panel.titleSource ? { titleSource: panel.titleSource, title_source: panel.titleSource } : {}),
    surfaceKind: panel.kind === 'knowledge' ? 'knowledge' : 'terminal',
    active: panel.id === workspace.activePanelId,
    status: panel.status,
    cwd: panel.cwd,
    ...(panel.sessionId ? { sessionId: panel.sessionId, session_id: panel.sessionId, terminalSessionId: panel.sessionId, terminal_session_id: panel.sessionId } : {}),
    ...(panel.kind === 'knowledge' ? {} : { terminalKind: terminalKindForControl(panel), connected: Boolean(panel.sessionId) }),
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
      : {})
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

const workspaceSnapshotForControl = (): ControlWorkspaceSnapshot => {
  pruneWorkspaceGroups()
  const terminals = workspace.panels.filter((panel) => panel.kind !== 'knowledge').map(terminalSummaryForControl)
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

const controlSettingsTargetAliases: Record<string, SettingSectionKey> = {
  account: 'billing',
  accounts: 'billing',
  agent: 'ai',
  agents: 'ai',
  ai: 'ai',
  'ai-preferences': 'ai',
  aihooks: 'ai',
  billing: 'billing',
  docs: 'docs',
  documentation: 'docs',
  extensions: 'extensions',
  extension: 'extensions',
  general: 'general',
  hooks: 'ai',
  keyboard: 'shortcuts',
  keybindings: 'shortcuts',
  mcp: 'mcp',
  model: 'models',
  models: 'models',
  privacy: 'privacy',
  rules: 'rules',
  security: 'privacy',
  shortcuts: 'shortcuts',
  skills: 'skills',
  terminal: 'terminal',
  terminals: 'terminal',
  theme: 'general',
  trusted: 'trustedDevices',
  trusteddevices: 'trustedDevices',
  'trusted-devices': 'trustedDevices',
  updates: 'about',
  about: 'about'
}

const resolveControlSettingsSection = (value: unknown): SettingSectionKey | null => {
  const target = controlText(value || 'general')
  if (!target) return 'general'
  const normalized = target.replace(/[_\s]+/g, '-')
  return controlSettingsTargetAliases[normalized.toLowerCase()] || null
}

const normalizeControlKnowledgePath = (value: unknown) => {
  const text = controlText(value)
  if (!text) return ''
  return text.replace(/^kb:/i, '').replace(/^knowledge:\/\//i, '').replace(/^\/+/, '').replace(/\\/g, '/')
}

const findControlKnowledgeNode = async (relPath: string) => {
  let node = relPath ? workspace.findKnowledgeNode(relPath) : null
  if (node) return node
  await workspace.refreshKnowledgeTree()
  node = relPath ? workspace.findKnowledgeNode(relPath) : null
  return node
}

const controlKnowledgeOpenRange = (params: Record<string, unknown>) => {
  const startLine = controlNumber(params.startLine || params.start_line || params.line, 0, 0, 1_000_000)
  const endLine = controlNumber(params.endLine || params.end_line, 0, 0, 1_000_000)
  return startLine > 0
    ? {
        startLine,
        ...(endLine > 0 ? { endLine } : {})
      }
    : undefined
}

const focusControlSurfacePanel = async (panel: TerminalPanel, requestedFocus = true) => {
  workspace.mode = 'terminal'
  workspace.activeModule = 'workspace'
  workspace.activePanelId = panel.id
  await nextTick()
  if (requestedFocus && panel.kind !== 'knowledge') terminalViews.get(panel.id)?.terminal.focus()
}

const controlFileOpenRawPaths = (params: Record<string, unknown>) => {
  if (Array.isArray(params.paths)) return params.paths.map(controlText).filter(Boolean)
  if (Array.isArray(params.path)) return params.path.map(controlText).filter(Boolean)
  const rawPath = controlText(params.path || params.filePath || params.file_path || params.relPath || params.rel_path)
  return rawPath ? [rawPath] : []
}

const openControlKnowledgeFiles = async (params: Record<string, unknown>, method: string) => {
  const rawPaths = controlFileOpenRawPaths(params)
  if (!rawPaths.length) return controlFail('FILE_PATH_REQUIRED', `${method} requires a path.`)
  const openedPanels: TerminalPanel[] = []
  const unsupported: Array<{ path: string; relPath: string; unsupportedReason: string }> = []
  const sourcePanel = resolveControlSourceSurfacePanel(params)
  const previousActivePanelId = workspace.activePanelId
  for (const rawPath of rawPaths) {
    const relPath = normalizeControlKnowledgePath(rawPath)
    const node = await findControlKnowledgeNode(relPath)
    if (!node || node.type !== 'file') {
      const absolute = rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)
      unsupported.push({
        path: rawPath,
        relPath,
        unsupportedReason: absolute
          ? 'aiopsterm does not yet expose arbitrary local files as shared work-panel surfaces; import or create the file in Knowledge first.'
          : 'The requested knowledge file was not found.'
      })
      continue
    }
    const panel = workspace.openKnowledgeFile(relPath, controlKnowledgeOpenRange(params))
    if (panel) openedPanels.push(panel)
  }
  const primary = openedPanels[openedPanels.length - 1] || null
  if (!primary && unsupported.length) {
    const allUnsupported = unsupported.every((item) => rawPaths.includes(item.path))
    return controlOk({
      opened: false,
      unsupported: allUnsupported,
      unsupportedReason: unsupported[0].unsupportedReason,
      path: unsupported[0].path,
      paths: rawPaths,
      relPath: unsupported[0].relPath,
      rel_path: unsupported[0].relPath,
      failures: unsupported,
      method
    })
  }
  if (!primary) return controlFail('KNOWLEDGE_FILE_OPEN_FAILED', 'Knowledge file could not be opened.', { paths: rawPaths })
  if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
    workspace.activePanelId = previousActivePanelId
  } else {
    await focusControlSurfacePanel(primary, false)
  }
  const surfaces = openedPanels.map((panel) => surfaceSummaryForControl(panel))
  return controlOk({
    opened: true,
    path: primary.knowledge?.relPath || primary.cwd,
    paths: openedPanels.map((panel) => panel.knowledge?.relPath || panel.cwd || panel.id),
    relPath: primary.knowledge?.relPath || '',
    rel_path: primary.knowledge?.relPath || '',
    surfaceId: primary.id,
    surface_id: primary.id,
    surfaceRef: panelRefForControl(primary.id),
    surface_ref: panelRefForControl(primary.id),
    panelId: primary.id,
    paneId: primary.id,
    pane_id: primary.id,
    sourceSurfaceId: sourcePanel?.id || null,
    source_surface_id: sourcePanel?.id || null,
    workspaceId: 'main',
    workspace_id: 'main',
    surface: surfaceSummaryForControl(primary),
    surfaces,
    failures: unsupported,
    unsupported: unsupported.length > 0,
    ...(unsupported[0] ? { unsupportedReason: unsupported[0].unsupportedReason } : {}),
    snapshot: workspaceSnapshotForControl()
  })
}

const projectStatePayloadForControl = (state: ControlProjectState, panel?: TerminalPanel | null) => ({
  surface_id: state.surfaceId,
  surfaceId: state.surfaceId,
  project_url: state.projectUrl,
  projectUrl: state.projectUrl,
  active_tab: state.activeTab,
  activeTab: state.activeTab,
  selected_scheme: state.selectedScheme,
  selectedScheme: state.selectedScheme,
  selected_configuration: state.selectedConfiguration,
  selectedConfiguration: state.selectedConfiguration,
  selected_target_id: state.selectedTargetId,
  selectedTargetId: state.selectedTargetId,
  selected_file: state.selectedFile,
  selectedFile: state.selectedFile,
  settings_filter: state.settingsFilter,
  settingsFilter: state.settingsFilter,
  load_state: panel?.kind === 'knowledge' ? 'loaded' : 'unsupported',
  loadState: panel?.kind === 'knowledge' ? 'loaded' : 'unsupported',
  unsupported: true,
  unsupportedReason: 'aiopsterm stores project.open compatibility metadata; Xcode schemes, targets, and build settings do not have a native aiopsterm project panel yet.',
  ...(panel ? { surface: surfaceSummaryForControl(panel) } : {})
})

const resolveControlProjectPanel = (params: Record<string, unknown>) => {
  const surface = resolveControlSourceSurfacePanel(params)
  if (surface && controlProjectStates.value[surface.id]) return surface
  const surfaceId = controlText(params.surfaceId || params.surface_id || params.panelId || params.panel_id)
  if (surfaceId) return workspace.panels.find((panel) => panel.id === surfaceId && controlProjectStates.value[panel.id]) || null
  const active = workspace.panels.find((panel) => panel.id === workspace.activePanelId)
  if (active && controlProjectStates.value[active.id]) return active
  const firstProjectSurfaceId = Object.keys(controlProjectStates.value)[0]
  return firstProjectSurfaceId ? workspace.panels.find((panel) => panel.id === firstProjectSurfaceId) || null : null
}

const handleProjectFileControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'markdown.open' || method === 'file.open') return openControlKnowledgeFiles(params, method)

  if (method === 'project.open') {
    const rawPath = controlText(params.path || params.projectPath || params.project_path)
    if (!rawPath) return controlFail('PROJECT_PATH_REQUIRED', 'project.open requires a path.')
    const existingFile = await findControlKnowledgeNode(normalizeControlKnowledgePath(rawPath))
    const previousActivePanelId = workspace.activePanelId
    let panel: TerminalPanel | null = null
    if (existingFile?.type === 'file') {
      panel = workspace.openKnowledgeFile(existingFile.relPath)
    } else {
      panel = resolveControlSourceSurfacePanel(params)
      if (!panel || panel.kind === 'knowledge') panel = workspace.createPanel()
      const title = rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath || 'Project'
      workspace.renamePanel(panel.id, title)
      panel.cwd = rawPath
    }
    if (!panel) return controlFail('PROJECT_OPEN_FAILED', 'Project surface could not be opened.')
    controlProjectStates.value = {
      ...controlProjectStates.value,
      [panel.id]: {
        surfaceId: panel.id,
        projectUrl: rawPath,
        activeTab: 'files',
        selectedScheme: '',
        selectedConfiguration: '',
        selectedTargetId: '',
        selectedFile: existingFile?.type === 'file' ? existingFile.relPath : '',
        settingsFilter: '',
        updatedAt: Date.now()
      }
    }
    if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    } else {
      await focusControlSurfacePanel(panel, false)
    }
    return controlOk({
      opened: true,
      path: rawPath,
      window_id: 'main',
      windowId: 'main',
      workspace_id: 'main',
      workspaceId: 'main',
      pane_id: panel.id,
      paneId: panel.id,
      surface_id: panel.id,
      surfaceId: panel.id,
      surface: surfaceSummaryForControl(panel),
      project: projectStatePayloadForControl(controlProjectStates.value[panel.id], panel),
      snapshot: workspaceSnapshotForControl()
    })
  }

  if (method === 'project.get_state') {
    const panel = resolveControlProjectPanel(params)
    if (!panel) return controlFail('PROJECT_SURFACE_NOT_FOUND', 'Project surface not found.')
    return controlOk(projectStatePayloadForControl(controlProjectStates.value[panel.id], panel))
  }

  const panel = resolveControlProjectPanel(params)
  if (!panel) return controlFail('PROJECT_SURFACE_NOT_FOUND', 'Project surface not found.')
  const state = { ...controlProjectStates.value[panel.id], updatedAt: Date.now() }
  if (method === 'project.set_tab') {
    const tab = controlText(params.tab) || 'files'
    const validTabs = new Set(['files', 'targets', 'buildSettings', 'schemes'])
    if (!validTabs.has(tab)) return controlFail('PROJECT_TAB_INVALID', 'tab must be one of files|targets|buildSettings|schemes.', { tab })
    state.activeTab = tab
  } else if (method === 'project.set_scheme') {
    state.selectedScheme = controlText(params.name || params.scheme)
  } else if (method === 'project.set_configuration') {
    state.selectedConfiguration = controlText(params.name || params.configuration)
  } else if (method === 'project.set_selected_target') {
    state.selectedTargetId = controlText(params.name || params.target || params.targetId || params.target_id)
  } else if (method === 'project.set_selected_file') {
    state.selectedFile = controlText(params.path || params.file || params.filePath || params.file_path)
  } else if (method === 'project.set_settings_filter') {
    state.settingsFilter = controlText(params.text || params.filter || params.query)
  } else {
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }
  controlProjectStates.value = { ...controlProjectStates.value, [panel.id]: state }
  return controlOk(projectStatePayloadForControl(state, panel))
}

const workspaceSidebarRowsForControl = (snapshot: ControlWorkspaceSnapshot) =>
  snapshot.workspaces.map((item, index) => ({
    id: item.id,
    ref: item.id === 'main' ? 'workspace:1' : item.id,
    index,
    title: item.title,
    description: null,
    selected: item.active,
    pinned: true,
    root_path: null,
    project_root_path: null,
    branch_summary: null,
    remote_display_target: snapshot.remote?.remote_display_target || item.remote_display_target || null,
    remote_connection_state: snapshot.remote?.connection_state || item.remote_connection_state || 'local',
    remote: snapshot.remote || null,
    current_directory: workspace.activePanel.kind === 'terminal' ? workspace.activePanel.cwd : '',
    custom_color: null,
    unread_count: snapshot.attention.unreadCount,
    latest_notification_text: snapshot.attention.items[0]?.summary || snapshot.attention.items[0]?.title || null,
    latest_conversation_message: null,
    latest_submitted_message: null,
    latest_submitted_at: null,
    listening_ports: [],
    pull_request_urls: [],
    panel_directories: snapshot.terminals.map((terminal) => terminal.cwd || '').filter(Boolean),
    git_branches: []
  }))

const resolveRemoteWorkspacePanelForControl = (params: Record<string, unknown> = {}) => {
  const directPanel = resolveControlSourceSurfacePanel(params)
  if (directPanel && directPanel.kind !== 'knowledge') return directPanel
  const remoteSurfaceId = controlWorkspaceRemote.value?.surfaceId
  if (remoteSurfaceId) {
    const panel = workspace.panels.find((item) => item.id === remoteSurfaceId && item.kind !== 'knowledge')
    if (panel) return panel
  }
  return workspace.panels.find((panel) => panel.id === workspace.activePanelId && panel.kind !== 'knowledge') || workspace.panels.find((panel) => panel.kind !== 'knowledge') || null
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

const handleWorkspaceRemoteControlRequest = async (method: string, params: Record<string, unknown>) => {
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
      (controlWorkspaceRemote.value ? workspace.panels.find((item) => item.id === controlWorkspaceRemote.value?.surfaceId && item.kind !== 'knowledge') || null : null) ||
      workspace.panels.find((item) => item.sshSession && !item.sessionId) ||
      workspace.panels.find((item) => item.kind !== 'knowledge' && !item.sessionId && item.status !== 'running') ||
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
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not expose control_compat remote PTY bridge daemon sessions; use visible SSH terminal surfaces instead.', {
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
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not expose control_compat remote PTY resize for detached bridge sessions; resize the visible SSH terminal surface instead.', {
      session_id: sessionId,
      attachment_id: attachmentId,
      cols,
      rows,
      resized: false
    })
  }

  if (method.startsWith('workspace.remote.pty_')) {
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not expose control_compat remote PTY bridge daemon sessions; use visible SSH terminal surfaces instead.', {
      session_id: controlText(params.sessionId || params.session_id),
      attachment_id: controlText(params.attachmentId || params.attachment_id),
      closed: false,
      detached: false
    })
  }

  if (method.startsWith('remote.tmux.')) {
    return unsupportedRemoteControlPayload(method, 'aiopsterm does not implement control_compat remote tmux control-mode mirroring in the control socket.', {
      host: controlText(params.host || params.destination),
      session: controlText(params.session)
    })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const workspaceGroupPayload = (group?: ControlWorkspaceGroupState | null) => {
  const groups = controlWorkspaceGroups.value.map(workspaceGroupSummaryForControl)
  return {
    groups,
    count: groups.length,
    ...(group ? { group: workspaceGroupSummaryForControl(group) } : {}),
    snapshot: workspaceSnapshotForControl()
  }
}

const paneLayoutPayload = (panel?: TerminalPanel | null, targetPanel?: TerminalPanel | null, extra: Record<string, unknown> = {}) =>
  controlOk({
    ...(panel ? { pane: surfaceSummaryForControl(panel), surface: surfaceSummaryForControl(panel), surfaceId: panel.id, surface_id: panel.id } : {}),
    ...(targetPanel ? { targetPane: surfaceSummaryForControl(targetPanel), targetSurface: surfaceSummaryForControl(targetPanel), targetPaneId: targetPanel.id, target_pane_id: targetPanel.id } : {}),
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const selectedPanePayload = (panel: TerminalPanel, action: string, previousActivePanelId: string) =>
  controlOk({
    workspace: {
      id: 'main',
      title: 'Main Workspace',
      active: true,
      mode: workspace.mode,
      activeModule: workspace.activeModule,
      activePanelId: panel.id
    },
    selectedPane: surfaceSummaryForControl(panel),
    selectedSurface: surfaceSummaryForControl(panel),
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    paneId: panel.id,
    pane_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    surfaceRef: panelRefForControl(panel.id),
    surface_ref: panelRefForControl(panel.id),
    activePanelId: panel.id,
    previousActivePanelId,
    action,
    snapshot: workspaceSnapshotForControl()
  })

const surfaceOperationPayload = (panel: TerminalPanel, action: string, extra: Record<string, unknown> = {}) => {
  const surface = surfaceSummaryForControl(panel)
  return controlOk({
    surface,
    pane: surface,
    movedSurface: surface,
    panelId: panel.id,
    paneId: panel.id,
    pane_id: panel.id,
    surfaceId: panel.id,
    surface_id: panel.id,
    surfaceRef: panelRefForControl(panel.id),
    surface_ref: panelRefForControl(panel.id),
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    action,
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })
}

const normalizedSurfaceAction = (value: unknown) => controlText(value).toLowerCase().replace(/[-\s]+/g, '_')

const closeRelativeControlPanels = async (panel: TerminalPanel, mode: 'left' | 'right' | 'others') => {
  const panels = selectableControlPanels()
  const index = panels.findIndex((item) => item.id === panel.id)
  if (index < 0) return { closed: 0, skipped: 0, closedSurfaces: [] as ControlSurfaceSummary[] }
  const targets =
    mode === 'left'
      ? panels.slice(0, index)
      : mode === 'right'
        ? panels.slice(index + 1)
        : panels.filter((item) => item.id !== panel.id)
  const closedSurfaces: ControlSurfaceSummary[] = []
  let skipped = 0
  for (const target of targets) {
    if (workspace.panels.length <= 1) {
      skipped += 1
      continue
    }
    const snapshot = surfaceSummaryForControl(target)
    workspace.closePanel(target.id)
    closedSurfaces.push(snapshot)
  }
  workspace.activePanelId = panel.id
  await nextTick()
  return { closed: closedSurfaces.length, skipped, closedSurfaces }
}

const handleSurfaceActionControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = normalizedSurfaceAction(params.action || params.name || params.command)
  if (!action) return controlFail('SURFACE_ACTION_REQUIRED', `${method} requires action.`)
  const panel = resolveControlSourceSurfacePanel(params)
  if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
  if (action === 'rename') {
    const title = controlText(params.title || params.name)
    if (!title) return controlFail('SURFACE_ACTION_TITLE_REQUIRED', 'surface.action rename requires title.')
    workspace.renamePanel(panel.id, title)
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', { action, title, extras: { title } })
  }
  if (action === 'clear_name' || action === 'clear_title') {
    workspace.renamePanel(panel.id, `Terminal ${workspace.panels.findIndex((item) => item.id === panel.id) + 1}`, 'system')
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', { action, clearedTitle: true, cleared_title: true })
  }
  if (action === 'pin' || action === 'unpin') {
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      pinned: action === 'pin',
      unsupported: true,
      unsupportedReason: 'aiopsterm does not have per-surface pinning; workspace group pinning is managed through workspace.group.pin.'
    })
  }
  if (action === 'mark_read' || action === 'mark_unread' || action === 'mark_as_unread') {
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      read: action === 'mark_read',
      changed: false,
      unsupported: true,
      unsupportedReason: 'aiopsterm surfaces do not currently store per-surface unread state.'
    })
  }
  if (action === 'new_terminal_right' || action === 'new_terminal_to_right' || action === 'new_terminal_tab_to_right') {
    const previousActivePanelId = workspace.activePanelId
    workspace.activePanelId = panel.id
    const created = workspace.createPanel()
    const title = controlText(params.title || params.newTitle || params.new_title)
    if (title) workspace.renamePanel(created.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory) || panel.cwd
    if (cwd) created.cwd = cwd
    if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      createdSurface: surfaceSummaryForControl(created),
      created_surface: surfaceSummaryForControl(created),
      createdSurfaceId: created.id,
      created_surface_id: created.id,
      extras: { created_surface_id: created.id }
    })
  }
  if (action === 'close_left' || action === 'close_to_left' || action === 'close_right' || action === 'close_to_right' || action === 'close_others' || action === 'close_other_tabs') {
    const mode = action === 'close_left' || action === 'close_to_left' ? 'left' : action === 'close_right' || action === 'close_to_right' ? 'right' : 'others'
    const result = await closeRelativeControlPanels(panel, mode)
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      closed: result.closed,
      skipped: result.skipped,
      skippedPinned: 0,
      skipped_pinned: 0,
      closedSurfaces: result.closedSurfaces,
      closed_surfaces: result.closedSurfaces,
      extras: { closed: result.closed, skipped_pinned: 0 }
    })
  }
  if (action === 'move_to_new_workspace' || action === 'detach_to_workspace' || action === 'detach_to_new_workspace') {
    const changed = workspace.unsplitPanel(panel.id)
    await nextTick()
    return surfaceOperationPayload(panel, 'surface.action', {
      action,
      moved: changed,
      detached: changed,
      unsupported: false
    })
  }
  return controlFail('SURFACE_ACTION_UNKNOWN', `Unknown surface action: ${action}`, { action })
}

const handleWorkspaceActionControlRequest = async (params: Record<string, unknown>) => {
  const panel = resolveControlSelectablePanel(controlTargetValue(params)) || resolveControlSourceSurfacePanel(params)
  const action = normalizedSurfaceAction(params.action || params.name || params.command)
  if (!action) return controlFail('WORKSPACE_ACTION_REQUIRED', 'workspace.action requires action.')
  if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
  const response = await handleSurfaceActionControlRequest('workspace.action', { ...params, surfaceId: panel.id, surface_id: panel.id, panelId: panel.id, panel_id: panel.id, action })
  if (!response.ok) return response
  return controlOk({
    ...(response.data || {}),
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    action
  })
}

const movePanelInControlOrder = (panel: TerminalPanel, params: Record<string, unknown>) => {
  const panels = workspace.panels
  const currentIndex = panels.findIndex((item) => item.id === panel.id)
  if (currentIndex < 0) return { changed: false, fromIndex: -1, toIndex: -1 }
  let targetIndex = controlPanelIndexFromValue(params.index)
  const beforePanel = resolveControlAnchorPanel(params, 'before')
  const afterPanel = resolveControlAnchorPanel(params, 'after')
  if (beforePanel) targetIndex = panels.findIndex((item) => item.id === beforePanel.id)
  if (afterPanel) targetIndex = panels.findIndex((item) => item.id === afterPanel.id) + 1
  if (targetIndex === null || !Number.isFinite(targetIndex)) targetIndex = currentIndex
  targetIndex = Math.max(0, Math.min(panels.length - 1, targetIndex))
  const [moved] = panels.splice(currentIndex, 1)
  if (currentIndex < targetIndex) targetIndex -= 1
  panels.splice(Math.max(0, Math.min(panels.length, targetIndex)), 0, moved)
  const toIndex = panels.findIndex((item) => item.id === panel.id)
  return { changed: currentIndex !== toIndex, fromIndex: currentIndex, toIndex }
}

const surfaceHealthForControl = (panel: TerminalPanel, index: number) => {
  const view = terminalViews.get(panel.id)
  return {
    ...surfaceSummaryForControl(panel),
    id: panel.id,
    ref: panelRefForControl(panel.id),
    index: index + 1,
    selected: panel.id === workspace.activePanelId,
    mounted: panel.kind === 'knowledge' ? true : Boolean(view),
    viewReady: panel.kind === 'knowledge' ? true : Boolean(view),
    view_ready: panel.kind === 'knowledge' ? true : Boolean(view),
    inWindow: true,
    in_window: true,
    cols: view?.terminal.cols,
    rows: view?.terminal.rows,
    status: panel.status
  }
}

const triggerControlFlash = (panel: TerminalPanel) => {
  controlFlashingPanelIds.value = [...new Set([...controlFlashingPanelIds.value, panel.id])]
  if (controlFlashTimer) window.clearTimeout(controlFlashTimer)
  controlFlashTimer = window.setTimeout(() => {
    controlFlashingPanelIds.value = controlFlashingPanelIds.value.filter((id) => id !== panel.id)
    controlFlashTimer = null
  }, 900)
}

const selectableControlPanels = () => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel))

const resolveControlSelectablePanel = (value: unknown) => {
  const target = controlText(value)
  const panels = selectableControlPanels()
  if (!target || target === 'main' || target === 'workspace' || target === 'workspace:1') {
    return panels.find((panel) => panel.id === workspace.activePanelId) || panels[0] || null
  }
  const indexMatch = target.match(/^(?:window|pane|surface|workspace):(\d+)$/i)
  const numericIndex = indexMatch ? Number(indexMatch[1]) : Number(target)
  if (Number.isInteger(numericIndex) && numericIndex > 0 && numericIndex <= panels.length) return panels[numericIndex - 1]
  return panels.find((panel) => panelMatchesControlId(panel, target) || panel.title === target) || null
}

const focusControlPanel = async (panel: TerminalPanel, action: string) => {
  const previousActivePanelId = workspace.activePanelId
  workspace.activeModule = 'workspace'
  workspace.activePanelId = panel.id
  await nextTick()
  terminalViews.get(panel.id)?.terminal.focus()
  return selectedPanePayload(panel, action, previousActivePanelId)
}

const focusControlPanelByOffset = async (offset: number, action: string) => {
  const panels = selectableControlPanels()
  if (!panels.length) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
  const activeIndex = Math.max(0, panels.findIndex((panel) => panel.id === workspace.activePanelId))
  const nextIndex = (activeIndex + offset + panels.length) % panels.length
  return focusControlPanel(panels[nextIndex], action)
}

const controlTargetValue = (params: Record<string, unknown>) =>
  params.panelId ||
  params.surfaceId ||
  params.paneId ||
  params.workspaceId ||
  params.panel_id ||
  params.surface_id ||
  params.pane_id ||
  params.workspace_id ||
  params.target ||
  params.id

const handlePaneNavigationControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'workspace.next') return focusControlPanelByOffset(1, 'next')
  if (method === 'workspace.previous') return focusControlPanelByOffset(-1, 'previous')
  if (method === 'workspace.last' || method === 'pane.last') {
    const target = resolveControlSelectablePanel(lastActiveControlPanelId.value)
    if (target) return focusControlPanel(target, method === 'pane.last' ? 'last-pane' : 'last-window')
    return focusControlPanelByOffset(-1, method === 'pane.last' ? 'last-pane' : 'last-window')
  }
  if (method === 'workspace.select') {
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    return focusControlPanel(panel, 'select-window')
  }
  if (method === 'pane.focus') {
    const panel = resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    return focusControlPanel(panel, 'select-pane')
  }
  if (method === 'surface.focus') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    return focusControlPanel(panel, 'surface.focus')
  }
  if (method === 'workspace.find') {
    const query = controlText(params.query || params.q || params.text)
    const includeContent = controlBool(params.content ?? params.includeContent ?? params.include_content, false)
    const queryLower = query.toLowerCase()
    const matches = selectableControlPanels()
      .map((panel, index) => {
        const titleMatch = !queryLower || panel.title.toLowerCase().includes(queryLower)
        const cwdMatch = Boolean(queryLower && panel.cwd.toLowerCase().includes(queryLower))
        const view = terminalViews.get(panel.id)
        const content = includeContent ? `${panel.output || ''}\n${view ? terminalControlBufferText(view, Math.max(1, view.terminal.rows || 30)) : ''}` : ''
        const contentMatch = Boolean(queryLower && includeContent && content.toLowerCase().includes(queryLower))
        const reason = titleMatch ? 'title' : cwdMatch ? 'cwd' : contentMatch ? 'content' : ''
        if (!reason) return null
        return {
          index: index + 1,
          panelId: panel.id,
          id: panel.id,
          title: panel.title,
          kind: panel.kind,
          surfaceKind: panel.kind === 'knowledge' ? 'knowledge' : 'terminal',
          active: panel.id === workspace.activePanelId,
          cwd: panel.cwd,
          reason
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (controlBool(params.select, false) && matches[0]) {
      const panel = workspace.panels.find((item) => item.id === matches[0].panelId)
      if (panel) {
        const selected = await focusControlPanel(panel, 'find-window')
        return controlOk({ ...(selected.data || {}), matches, selected: matches[0], count: matches.length })
      }
    }
    return controlOk({ matches, count: matches.length, query, includeContent })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const managementPanelPayload = (panel: TerminalPanel, action: string, key: 'createdPane' | 'closedPane' | 'renamedPane' = 'createdPane', extra: Record<string, unknown> = {}) =>
  controlOk({
    [key]: surfaceSummaryForControl(panel),
    panelId: panel.id,
    surfaceId: panel.id,
    action,
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const handlePaneManagementControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'pane.list') {
    const panels = selectableControlPanels()
    return controlOk({
      panes: panels.map((panel, index) => ({ ...surfaceSummaryForControl(panel), index: index + 1 })),
      surfaces: panels.map(surfaceSummaryForControl),
      count: panels.length,
      activePanelId: workspace.activePanelId
    })
  }
  if (method === 'pane.surfaces') {
    const panel = resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const surface = surfaceSummaryForControl(panel)
    return controlOk({
      workspaceId: 'main',
      workspace_id: 'main',
      paneId: panel.id,
      pane_id: panel.id,
      panelId: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surfaces: [{ ...surface, id: panel.id, ref: 'surface:1', index: 1, selected: true }],
      count: 1,
      activePanelId: workspace.activePanelId
    })
  }
  if (method === 'workspace.create') {
    const focus = controlBool(params.focus, true)
    const previousActivePanelId = workspace.activePanelId
    const panel = workspace.createPanel()
    const title = controlText(params.title || params.name)
    if (title) workspace.renamePanel(panel.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
    if (cwd) panel.cwd = cwd
    const workspaceEnv = cleanWorkspaceEnvironmentForControl(params.workspace_env || params.workspaceEnv)
    if (Object.keys(workspaceEnv).length) {
      controlWorkspaceEnvironment.value = { env: workspaceEnv, updatedAt: Date.now() }
    }
    if (!focus && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    return managementPanelPayload(panel, 'new-window', 'createdPane', { previousActivePanelId })
  }
  if (method === 'surface.create') {
    const type = controlText(params.type).toLowerCase()
    const url = controlText(params.url)
    if (url || (type && !['terminal', 'local', 'shell'].includes(type))) {
      return controlFail('SURFACE_CREATE_TYPE_UNSUPPORTED', 'surface.create only supports local terminal surfaces.', {
        ...(type ? { type } : {})
      })
    }
    const pane = resolveControlPanePanel(params)
    if (controlText(params.paneId || params.pane_id || params.panelId || params.panel_id || params.surfaceId || params.surface_id) && !pane) {
      return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    }
    const focus = controlBool(params.focus, false)
    const previousActivePanelId = workspace.activePanelId
    if (pane) workspace.activePanelId = pane.id
    const panel = workspace.createPanel()
    const title = controlText(params.title || params.name)
    if (title) workspace.renamePanel(panel.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
    if (cwd) panel.cwd = cwd
    if (!focus && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (focus) terminalViews.get(panel.id)?.terminal.focus()
    return managementPanelPayload(panel, 'surface.create', 'createdPane', {
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      paneId: panel.id,
      pane_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surfaceRef: panelRefForControl(panel.id),
      surface_ref: panelRefForControl(panel.id),
      surface: surfaceSummaryForControl(panel),
      pane: surfaceSummaryForControl(panel),
      type: type || 'terminal',
      previousActivePanelId,
      ...(pane ? { targetPane: surfaceSummaryForControl(pane), targetPaneId: pane.id, target_pane_id: pane.id } : {})
    })
  }
  if (method === 'surface.split' || method === 'pane.create') {
    if (method === 'pane.create') {
      const type = controlText(params.type).toLowerCase().replace(/[-_\s]/g, '')
      if (type === 'agentsession') {
        return controlFail('PANE_AGENT_SESSION_UNSUPPORTED', 'agent-session is only supported by surface.create.', {
          type: controlText(params.type) || 'agentSession'
        })
      }
    }
    const target = resolveControlPanePanel(params, 'target') || resolveControlPanePanel(params)
    if (!target) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const previousActivePanelId = workspace.activePanelId
    workspace.activePanelId = target.id
    const panel = workspace.createPanel(normalizePaneLayoutDirection(params.direction || params.split))
    const title = controlText(params.title || params.name)
    if (title) workspace.renamePanel(panel.id, title)
    const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
    if (cwd) panel.cwd = cwd
    if (!controlBool(params.focus, true) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    return managementPanelPayload(panel, method === 'pane.create' ? 'pane.create' : 'split-window', 'createdPane', {
      targetPane: surfaceSummaryForControl(target),
      previousActivePanelId,
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      paneId: panel.id,
      pane_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surfaceRef: panelRefForControl(panel.id),
      surface_ref: panelRefForControl(panel.id),
      surface: surfaceSummaryForControl(panel),
      pane: surfaceSummaryForControl(panel),
      createdSurface: surfaceSummaryForControl(panel),
      created_surface: surfaceSummaryForControl(panel),
      type: controlText(params.type) || 'terminal'
    })
  }
  if (method === 'workspace.rename') {
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    const title = controlText(params.title || params.name)
    if (!title) return controlFail('WORKSPACE_TITLE_REQUIRED', 'Workspace title is required.')
    workspace.renamePanel(panel.id, title)
    await nextTick()
    return managementPanelPayload(panel, 'rename-window', 'renamedPane', { title })
  }
  if (method === 'workspace.close' || method === 'surface.close') {
    const panel = method === 'workspace.close' ? resolveControlSelectablePanel(controlTargetValue(params)) : resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const snapshot = surfaceSummaryForControl(panel)
    workspace.closePanel(panel.id)
    await nextTick()
    return controlOk({
      closedPane: snapshot,
      closedSurface: snapshot,
      panelId: snapshot.panelId,
      surfaceId: snapshot.panelId,
      action: method === 'workspace.close' ? 'kill-window' : 'kill-pane',
      snapshot: workspaceSnapshotForControl()
    })
  }
  if (method === 'workspace.has_session') {
    const target = controlText(controlTargetValue(params))
    const panel = resolveControlSelectablePanel(target)
    return controlOk({
      exists: Boolean(panel),
      target: target || 'main',
      ...(panel ? { panel: surfaceSummaryForControl(panel), workspace: surfaceSummaryForControl(panel) } : {})
    })
  }
  if (method === 'workspace.select_layout') {
    const layout = controlText(params.layout || params.name) || 'default'
    const supported = ['default', 'even-horizontal', 'even-vertical', 'tiled', 'main-vertical', 'main-horizontal'].includes(layout)
    return controlOk({
      layout,
      applied: supported,
      unsupported: !supported,
      ...(supported ? {} : { unsupportedReason: `Unsupported layout: ${layout}` }),
      snapshot: workspaceSnapshotForControl()
    })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const workspaceMetadataPayload = (extra: Record<string, unknown> = {}) =>
  controlOk({
    window_id: null,
    window_ref: null,
    workspaceId: 'main',
    workspace_id: 'main',
    workspaceRef: 'workspace:1',
    workspace_ref: 'workspace:1',
    ...extra,
    snapshot: workspaceSnapshotForControl()
  })

const handleWorkspaceMetadataControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'workspace.env') {
    const explicitTarget = controlText(params.workspaceId || params.workspace_id || params.surfaceId || params.surface_id || params.panelId || params.panel_id || params.paneId || params.pane_id || params.terminalId || params.terminal_id)
    if (explicitTarget && explicitTarget !== 'main' && !resolveControlSelectablePanel(explicitTarget)) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    const env = { ...controlWorkspaceEnvironment.value.env }
    return workspaceMetadataPayload({
      env,
      count: Object.keys(env).length,
      keys: Object.keys(env).sort()
    })
  }

  if (method === 'workspace.set_auto_title') {
    const enabled = true
    if (controlBool(params.probe, false)) {
      const panel = resolveControlSelectablePanel(controlTargetValue(params))
      return workspaceMetadataPayload({
        enabled,
        summarizer_agent: null,
        workspace_user_owned: panel ? panel.titleSource === 'user' : false,
        panel_user_owned: panel ? panel.titleSource === 'user' : false
      })
    }
    const failure = controlText(params.failure)
    if (failure) {
      return workspaceMetadataPayload({
        enabled,
        recorded: true,
        failure,
        agent: controlText(params.agent)
      })
    }
    const title = controlText(params.title || params.name)
    if (!title) return controlFail('WORKSPACE_TITLE_REQUIRED', 'Workspace title is required.', { enabled })
    const panel =
      resolveControlSelectablePanel(controlTargetValue(params)) ||
      (controlText(params.workspaceId || params.workspace_id) ? workspace.panels.find((item) => item.id === workspace.activePanelId) || null : null)
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.', { enabled })
    const result = workspace.setPanelAutoTitle(panel.id, title, {
      panelOnlyIfMultiple: controlBool(params.panelOnlyIfMultiple ?? params.panel_only_if_multiple, false)
    })
    await nextTick()
    return workspaceMetadataPayload({
      enabled,
      title,
      workspaceApplied: result.applied,
      workspace_applied: result.applied,
      panelApplied: result.applied,
      panel_applied: result.applied,
      workspaceUserOwned: result.userOwned,
      workspace_user_owned: result.userOwned,
      panelUserOwned: result.userOwned,
      panel_user_owned: result.userOwned,
      panelId: panel.id,
      panel_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      surface: surfaceSummaryForControl(panel)
    })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const normalizePaneLayoutDirection = (value: unknown) => {
  const direction = controlText(value).toLowerCase()
  if (direction === 'below' || direction === 'down' || direction === 'vertical') return 'below'
  return 'right'
}

const normalizeSurfaceShellState = (value: unknown): ControlSurfaceTelemetryState['shellState'] | '' => {
  const state = controlText(value).toLowerCase()
  if (state === 'prompt' || state === 'running' || state === 'unknown') return state
  return ''
}

const normalizePortsKickReason = (value: unknown): NonNullable<ControlSurfaceTelemetryState['lastPortsKickReason']> | '' => {
  const reason = controlText(value || 'command').toLowerCase()
  if (reason === 'command' || reason === 'refresh') return reason
  return ''
}

const handlePaneLayoutControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'pane.resize') {
    const panel = resolveControlPanePanel(params)
    return paneLayoutPayload(panel, null, {
      resized: false,
      unsupported: true,
      unsupportedReason: 'aiopsterm split panes currently use an equal-size layout and do not store per-pane dimensions.',
      direction: controlText(params.direction) || 'right',
      amount: controlNumber(params.amount, 1, 1, 999)
    })
  }

  if (method === 'pane.break') {
    const panel = resolveControlPanePanel(params)
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const previousActivePanelId = workspace.activePanelId
    const changed = workspace.unsplitPanel(panel.id)
    if (!controlBool(params.focus, false) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return paneLayoutPayload(panel, null, { changed, broken: changed })
  }

  if (method === 'pane.join') {
    const panel = resolveControlPanePanel(params)
    const targetPanel = resolveControlPanePanel(params, 'target')
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    if (!targetPanel) return controlFail('TARGET_PANE_NOT_FOUND', 'Target pane not found.')
    if (panel.id === targetPanel.id) return controlFail('PANE_TARGET_INVALID', 'Source and target panes must be different.')
    const previousActivePanelId = workspace.activePanelId
    const changed = workspace.attachPanelToSplit(panel.id, targetPanel.id, normalizePaneLayoutDirection(params.direction || params.split))
    if (!controlBool(params.focus, false) && workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return paneLayoutPayload(panel, targetPanel, { changed, joined: changed })
  }

  if (method === 'pane.swap') {
    const panel = resolveControlPanePanel(params)
    const targetPanel = resolveControlPanePanel(params, 'target')
    if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    if (!targetPanel) return controlFail('TARGET_PANE_NOT_FOUND', 'Target pane not found.')
    if (panel.id === targetPanel.id) return controlFail('PANE_TARGET_INVALID', 'Source and target panes must be different.')
    const panelIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    const targetIndex = workspace.panels.findIndex((item) => item.id === targetPanel.id)
    if (panelIndex < 0 || targetIndex < 0) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const previousActivePanelId = workspace.activePanelId
    const sourceSplit = panel.split
    const sourceSplitSourceId = panel.splitSourceId
    const sourceSplitGroupId = panel.splitGroupId
    const sourceSplitOrder = panel.splitOrder
    panel.split = targetPanel.split
    panel.splitSourceId = targetPanel.splitSourceId === panel.id ? targetPanel.id : targetPanel.splitSourceId
    panel.splitGroupId = targetPanel.splitGroupId
    panel.splitOrder = targetPanel.splitOrder
    targetPanel.split = sourceSplit
    targetPanel.splitSourceId = sourceSplitSourceId === targetPanel.id ? panel.id : sourceSplitSourceId
    targetPanel.splitGroupId = sourceSplitGroupId
    targetPanel.splitOrder = sourceSplitOrder
    const movedPanel = workspace.panels[panelIndex]
    workspace.panels[panelIndex] = workspace.panels[targetIndex]
    workspace.panels[targetIndex] = movedPanel
    if (controlBool(params.focus, false)) {
      workspace.activePanelId = targetPanel.id
    } else if (workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    terminalViews.get(workspace.activePanelId)?.terminal.focus()
    return paneLayoutPayload(panel, targetPanel, { changed: true, swapped: true })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const handleSurfaceOperationsControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'surface.action' || method === 'tab.action') return handleSurfaceActionControlRequest(method, params)

  if (method === 'surface.report_tty') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const ttyName = controlText(params.ttyName || params.tty_name || params.tty)
    if (!ttyName) return controlFail('SURFACE_TTY_REQUIRED', 'surface.report_tty requires tty_name.')
    const now = Date.now()
    const previous = controlSurfaceTelemetry.value[panel.id] || {}
    const telemetry: ControlSurfaceTelemetryState = { ...previous, ttyName, lastTtyAt: now }
    controlSurfaceTelemetry.value = { ...controlSurfaceTelemetry.value, [panel.id]: telemetry }
    return surfaceOperationPayload(panel, 'surface.report_tty', {
      ttyName,
      tty_name: ttyName,
      telemetry: surfaceTelemetrySummaryForControl(telemetry),
      recorded: true
    })
  }

  if (method === 'surface.report_shell_state') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const shellState = normalizeSurfaceShellState(params.state || params.shellState || params.shell_state || params.activity)
    if (!shellState) return controlFail('SURFACE_SHELL_STATE_INVALID', 'state must be prompt, running, or unknown.')
    const now = Date.now()
    const previous = controlSurfaceTelemetry.value[panel.id] || {}
    const telemetry: ControlSurfaceTelemetryState = { ...previous, shellState, lastShellStateAt: now }
    controlSurfaceTelemetry.value = { ...controlSurfaceTelemetry.value, [panel.id]: telemetry }
    return surfaceOperationPayload(panel, 'surface.report_shell_state', {
      state: shellState,
      shellState,
      shell_state: shellState,
      telemetry: surfaceTelemetrySummaryForControl(telemetry),
      published: true
    })
  }

  if (method === 'surface.ports_kick') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const reason = normalizePortsKickReason(params.reason)
    if (!reason) return controlFail('SURFACE_PORTS_KICK_REASON_INVALID', 'reason must be command or refresh.')
    const now = Date.now()
    const previous = controlSurfaceTelemetry.value[panel.id] || {}
    const telemetry: ControlSurfaceTelemetryState = { ...previous, lastPortsKickAt: now, lastPortsKickReason: reason }
    controlSurfaceTelemetry.value = { ...controlSurfaceTelemetry.value, [panel.id]: telemetry }
    return surfaceOperationPayload(panel, 'surface.ports_kick', {
      reason,
      telemetry: surfaceTelemetrySummaryForControl(telemetry),
      kicked: true,
      portScanStarted: false,
      port_scan_started: false,
      unsupported: false
    })
  }

  if (method === 'surface.health') {
    const panels = selectableControlPanels()
    return controlOk({
      workspaceId: 'main',
      workspace_id: 'main',
      workspaceRef: 'workspace:1',
      workspace_ref: 'workspace:1',
      surfaces: panels.map(surfaceHealthForControl),
      count: panels.length,
      activePanelId: workspace.activePanelId
    })
  }

  if (method === 'surface.refresh' || method === 'workspace.equalize_splits') {
    await nextTick()
    scheduleVisibleTerminalFit({ scrollToBottom: false, frames: 4, forceGeometry: true })
    return controlOk({
      workspaceId: 'main',
      workspace_id: 'main',
      refreshed: workspace.panels.filter((panel) => panel.kind !== 'knowledge').length,
      equalized: method === 'workspace.equalize_splits',
      action: method,
      snapshot: workspaceSnapshotForControl()
    })
  }

  if (method === 'surface.trigger_flash') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    triggerControlFlash(panel)
    workspace.activeModule = 'workspace'
    workspace.activePanelId = panel.id
    await nextTick()
    terminalViews.get(panel.id)?.terminal.focus()
    return surfaceOperationPayload(panel, 'surface.trigger_flash', { flashed: true })
  }

  if (method === 'surface.reorder' || method === 'surface.move') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const previousActivePanelId = workspace.activePanelId
    const targetPane = method === 'surface.move' ? resolveControlPanePanel(params) : null
    let changed = false
    let fromIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    let toIndex = fromIndex
    if (targetPane && targetPane.id !== panel.id) {
      changed = workspace.attachPanelToSplit(panel.id, targetPane.id, normalizePaneLayoutDirection(params.direction || params.split))
      toIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    } else {
      const moved = movePanelInControlOrder(panel, params)
      changed = moved.changed
      fromIndex = moved.fromIndex
      toIndex = moved.toIndex
    }
    if (controlBool(params.focus, false)) {
      workspace.activePanelId = panel.id
    } else if (workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return surfaceOperationPayload(panel, method === 'surface.move' ? 'surface.move' : 'surface.reorder', {
      changed,
      moved: changed,
      reordered: changed,
      fromIndex,
      from_index: fromIndex,
      toIndex,
      to_index: toIndex,
      index: toIndex,
      ...(targetPane ? { targetPane: surfaceSummaryForControl(targetPane), targetPaneId: targetPane.id, target_pane_id: targetPane.id } : {})
    })
  }

  if (method === 'surface.split_off') {
    const panel = resolveControlSourceSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    const previousActivePanelId = workspace.activePanelId
    const changed = workspace.unsplitPanel(panel.id)
    if (controlBool(params.focus, false)) {
      workspace.activePanelId = panel.id
    } else if (workspace.panels.some((item) => item.id === previousActivePanelId)) {
      workspace.activePanelId = previousActivePanelId
    }
    await nextTick()
    if (controlBool(params.focus, false)) terminalViews.get(panel.id)?.terminal.focus()
    return surfaceOperationPayload(panel, 'surface.split_off', {
      changed,
      splitOff: changed,
      split_off: changed,
      direction: controlText(params.direction) || 'right'
    })
  }

  if (method === 'workspace.reorder' || method === 'workspace.reorder_many') {
    if (method === 'workspace.reorder_many') {
      const orderInput = Array.isArray(params.workspaceIds)
        ? params.workspaceIds
        : Array.isArray(params.workspace_ids)
          ? params.workspace_ids
          : typeof params.order === 'string'
            ? params.order.split(',')
            : []
      if (!orderInput.length) return controlFail('WORKSPACE_REORDER_ORDER_REQUIRED', 'Workspace reorder requires an order.')
      const desired = orderInput.map(resolveControlPanelId).filter(Boolean)
      if (!desired.length) return controlFail('WORKSPACE_REORDER_ORDER_INVALID', 'Workspace reorder order did not match any surfaces.')
      const current = workspace.panels
      const desiredSet = new Set(desired)
      const known = current.filter((panel) => desiredSet.has(panel.id))
      const missing = desired.filter((id) => !known.some((panel) => panel.id === id))
      if (missing.length) return controlFail('WORKSPACE_REORDER_SURFACE_NOT_FOUND', 'One or more reorder surfaces were not found.', { missing })
      const untouched = current.filter((panel) => !desiredSet.has(panel.id))
      const fromOrder = current.map((panel) => panel.id)
      const dryRun = controlBool(params.dryRun ?? params.dry_run, false)
      if (!dryRun) workspace.panels = [...known.sort((a, b) => desired.indexOf(a.id) - desired.indexOf(b.id)), ...untouched]
      const toOrder = (dryRun ? current : workspace.panels).map((panel) => panel.id)
      return controlOk({
        workspaceId: 'main',
        workspace_id: 'main',
        dryRun,
        dry_run: dryRun,
        changed: fromOrder.join('\u0000') !== toOrder.join('\u0000'),
        order: toOrder,
        snapshot: workspaceSnapshotForControl()
      })
    }
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    const dryRun = controlBool(params.dryRun ?? params.dry_run, false)
    const fromIndex = workspace.panels.findIndex((item) => item.id === panel.id)
    let move = { changed: false, fromIndex, toIndex: fromIndex }
    if (!dryRun) move = movePanelInControlOrder(panel, params)
    return controlOk({
      workspaceId: panel.id,
      workspace_id: panel.id,
      workspaceRef: panelRefForControl(panel.id),
      workspace_ref: panelRefForControl(panel.id),
      dryRun,
      dry_run: dryRun,
      fromIndex: move.fromIndex,
      from_index: move.fromIndex,
      toIndex: move.toIndex,
      to_index: move.toIndex,
      index: move.toIndex,
      changed: move.changed,
      snapshot: workspaceSnapshotForControl()
    })
  }

  if (method === 'workspace.move_to_window') {
    return controlOk({
      workspaceId: controlText(params.workspaceId || params.workspace_id) || 'main',
      workspace_id: controlText(params.workspaceId || params.workspace_id) || 'main',
      windowId: controlText(params.windowId || params.window_id) || 'main',
      window_id: controlText(params.windowId || params.window_id) || 'main',
      moved: false,
      unsupported: true,
      unsupportedReason: 'aiopsterm currently exposes one shared main work panel in one Electron window; moving workspaces between native windows is not supported.'
    })
  }

  if (method === 'workspace.prompt_submit') {
    const panel = resolveControlSelectablePanel(controlTargetValue(params))
    if (!panel) return controlFail('WORKSPACE_NOT_FOUND', 'Workspace or panel not found.')
    if (panel.kind === 'knowledge') return controlFail('WORKSPACE_PROMPT_TERMINAL_REQUIRED', 'Prompt submit requires a terminal surface.')
    const message = controlText(params.message || params.prompt || params.text || params.body)
    if (!message) return controlFail('WORKSPACE_PROMPT_REQUIRED', 'Prompt submit requires message text.')
    const shellText = message.endsWith('\n') ? message : `${message}\n`
    const decision = await workspace.runTerminalCommand(panel.id, message, { source: 'agent', inputText: shellText, shellText, writeToShell: true })
    return controlOk({
      workspaceId: panel.id,
      workspace_id: panel.id,
      surfaceId: panel.id,
      surface_id: panel.id,
      messageRecorded: decision.status === 'allow',
      message_recorded: decision.status === 'allow',
      decision,
      status: decision.status,
      messagePreview: message.slice(0, 120),
      message_preview: message.slice(0, 120)
    })
  }

  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
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
  const killTerminal = terminalClient.killTerminal()
  for (const panelId of panelIds) {
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (!panel) continue
    if (panel.sessionId && killTerminal) {
      const sessionId = panel.sessionId
      try {
        const result = await killTerminal(sessionId)
        if (result?.ok && isTerminalKillSuccess(result, sessionId)) killedSessionIds.push(sessionId)
      } catch {
        // Closing a group is best effort after explicit confirmation; the UI panel is still removed.
      }
    }
    workspace.closePanel(panel.id)
    closedPanelIds.push(panel.id)
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

const handleWorkspaceGroupControlRequest = async (method: string, params: Record<string, unknown>) => {
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

const cleanSurfaceResumeEnvironment = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry.trim() : ''] as const)
    .filter(([key, entry]) => key && entry && !/(token|password|passwd|secret|api[_-]?key|credential|auth|bearer)/i.test(key))
  return entries.length ? Object.fromEntries(entries) : undefined
}

const cleanWorkspaceEnvironmentForControl = (value: unknown) => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry : controlText(entry)] as const)
      .filter(([key, entry]) => key && entry && !key.includes('\0') && !key.includes('=') && !entry.includes('\0'))
  )
}

const workspaceEnvironmentSummaryForControl = () => {
  const keys = Object.keys(controlWorkspaceEnvironment.value.env).sort()
  return {
    keys,
    count: keys.length,
    updatedAt: controlWorkspaceEnvironment.value.updatedAt,
    updated_at: controlWorkspaceEnvironment.value.updatedAt
  }
}

const surfaceResumeBindingPayload = (binding?: ControlSurfaceResumeBindingState | null) => {
  if (!binding) return null
  const trustedAt = typeof binding.trustedAt === 'number' ? binding.trustedAt : binding.trusted_at
  return {
    ...binding,
    checkpoint_id: binding.checkpointId || binding.checkpoint_id,
    auto_resume: binding.autoResume,
    approval_policy: binding.approvalPolicy || binding.approval_policy,
    approval_record_id: binding.approvalRecordId || binding.approval_record_id,
    ...(typeof trustedAt === 'number' ? { trustedAt, trusted_at: trustedAt } : {}),
    trust_reason: binding.trustReason || binding.trust_reason,
    updated_at: binding.updatedAt
  }
}

const surfaceResumeFingerprint = (panel: TerminalPanel, binding: ControlSurfaceResumeBindingState) =>
  [
    controlText(binding.kind) || 'surface-resume',
    controlText(binding.command),
    controlText(binding.cwd || panel.cwd),
    controlText(binding.checkpointId || binding.checkpoint_id),
    controlText(binding.source)
  ].join('\u001f')

const surfaceResumeTrustId = (panel: TerminalPanel, binding: ControlSurfaceResumeBindingState) =>
  `surface-resume:${panel.id}:${surfaceResumeFingerprint(panel, binding)}`

const isSurfaceResumeTrustedForAuto = (panel: TerminalPanel, binding?: ControlSurfaceResumeBindingState | null) => {
  if (!binding?.command.trim()) return false
  const trustedAt = typeof binding.trustedAt === 'number' ? binding.trustedAt : binding.trusted_at
  const approvalRecordId = binding.approvalRecordId || binding.approval_record_id
  return Boolean(
    binding.autoResume === true &&
      (binding.approvalPolicy || binding.approval_policy) === 'auto' &&
      approvalRecordId &&
      typeof trustedAt === 'number' &&
      approvalRecordId === surfaceResumeTrustId(panel, binding)
  )
}

const surfaceResumePayload = (panel: TerminalPanel, cleared = false) => {
  const binding = surfaceResumeBindingPayload(controlSurfaceResumeBindings.value[panel.id])
  return {
    surface: surfaceSummaryForControl(panel),
    terminal: panel.kind === 'knowledge' ? null : terminalSummaryForControl(panel),
    surfaceId: panel.id,
    surface_id: panel.id,
    surface_ref: panel.id,
    workspaceId: 'main',
    workspace_id: 'main',
    workspace_ref: 'main',
    cleared,
    resumeBinding: binding,
    resume_binding: binding,
    trusted: isSurfaceResumeTrustedForAuto(panel, controlSurfaceResumeBindings.value[panel.id]),
    snapshot: workspaceSnapshotForControl()
  }
}

const surfaceResumePreviewItems = (params: Record<string, unknown> = {}) =>
  workspace.panels
    .filter((panel) => panel.kind !== 'knowledge')
    .map((panel) => {
      const binding = controlSurfaceResumeBindings.value[panel.id]
      const trusted = isSurfaceResumeTrustedForAuto(panel, binding)
      const reason = !binding?.command.trim()
        ? 'missing-binding'
        : panel.kind === 'knowledge'
          ? 'not-terminal'
          : !panel.sessionId
            ? 'terminal-not-connected'
            : binding.autoResume !== true
              ? 'manual'
              : !trusted
                ? 'untrusted'
                : 'ready'
      return {
        panel,
        binding,
        trusted,
        reason,
        ready: reason === 'ready'
      }
    })
    .filter((item) => {
      const panelId = controlText(params.panelId || params.surfaceId)
      const sessionId = controlText(params.sessionId || params.terminalSessionId)
      if (panelId && item.panel.id !== panelId) return false
      if (sessionId && item.panel.sessionId !== sessionId) return false
      return item.binding || params.includeAll === true || params.include_all === true
    })

const surfaceResumeAutoPayload = (items = surfaceResumePreviewItems()) => ({
  candidates: items.map((item) => ({
    surface: surfaceSummaryForControl(item.panel),
    terminal: terminalSummaryForControl(item.panel),
    resumeBinding: surfaceResumeBindingPayload(item.binding),
    resume_binding: surfaceResumeBindingPayload(item.binding),
    trusted: item.trusted,
    ready: item.ready,
    reason: item.reason
  })),
  count: items.length,
  readyCount: items.filter((item) => item.ready).length,
  trustedCount: items.filter((item) => item.trusted).length,
  snapshot: workspaceSnapshotForControl()
})

const handleSurfaceResumeControlRequest = async (method: string, params: Record<string, unknown>) => {
  const panel = resolveControlSurfacePanel(params)
  if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
  if (method === 'surface.resume.set') {
    const command = controlText(params.command || params.shell || params.shellCommand)
    if (!command) return controlFail('SURFACE_RESUME_COMMAND_REQUIRED', 'Resume command is required.')
    const now = Date.now()
    const checkpointId = controlText(params.checkpointId || params.checkpoint_id || params.checkpoint)
    const approvalPolicy = controlText(params.approvalPolicy || params.approval_policy)
    const approvalRecordId = controlText(params.approvalRecordId || params.approval_record_id)
    const environment = cleanSurfaceResumeEnvironment(params.environment)
    const binding: ControlSurfaceResumeBindingState = {
      ...(controlText(params.name) ? { name: controlText(params.name) } : {}),
      ...(controlText(params.kind) ? { kind: controlText(params.kind) } : {}),
      command,
      ...(controlText(params.cwd) || panel.cwd ? { cwd: controlText(params.cwd) || panel.cwd } : {}),
      ...(checkpointId ? { checkpointId, checkpoint_id: checkpointId } : {}),
      ...(controlText(params.source) ? { source: controlText(params.source) } : {}),
      ...(environment ? { environment } : {}),
      autoResume: controlBool(params.autoResume ?? params.auto_resume, false),
      ...(approvalPolicy ? { approvalPolicy, approval_policy: approvalPolicy } : {}),
      ...(approvalRecordId ? { approvalRecordId, approval_record_id: approvalRecordId } : {}),
      ...(typeof params.trustedAt === 'number' ? { trustedAt: params.trustedAt, trusted_at: params.trustedAt } : {}),
      ...(controlText(params.trustReason || params.trust_reason) ? { trustReason: controlText(params.trustReason || params.trust_reason), trust_reason: controlText(params.trustReason || params.trust_reason) } : {}),
      updatedAt: now,
      updated_at: now
    }
    controlSurfaceResumeBindings.value = { ...controlSurfaceResumeBindings.value, [panel.id]: binding }
    return controlOk(surfaceResumePayload(panel))
  }
  if (method === 'surface.resume.get' || method === 'surface.resume.show') {
    return controlOk(surfaceResumePayload(panel))
  }
  if (method === 'surface.resume.clear') {
    const existing = controlSurfaceResumeBindings.value[panel.id]
    if (!existing) return controlOk(surfaceResumePayload(panel, false))
    const expectedCheckpoint = controlText(params.checkpointId || params.checkpoint_id || params.checkpoint)
    const expectedSource = controlText(params.source)
    if (expectedCheckpoint && existing.checkpointId !== expectedCheckpoint && existing.checkpoint_id !== expectedCheckpoint) {
      return controlFail('SURFACE_RESUME_CHECKPOINT_MISMATCH', 'Resume binding checkpoint does not match.', { resumeBinding: surfaceResumeBindingPayload(existing), resume_binding: surfaceResumeBindingPayload(existing) })
    }
    if (expectedSource && existing.source !== expectedSource) {
      return controlFail('SURFACE_RESUME_SOURCE_MISMATCH', 'Resume binding source does not match.', { resumeBinding: surfaceResumeBindingPayload(existing), resume_binding: surfaceResumeBindingPayload(existing) })
    }
    const next = { ...controlSurfaceResumeBindings.value }
    delete next[panel.id]
    controlSurfaceResumeBindings.value = next
    return controlOk(surfaceResumePayload(panel, true))
  }
  if (method === 'surface.resume.trust' || method === 'surface.resume.approve') {
    const existing = controlSurfaceResumeBindings.value[panel.id]
    if (!existing?.command.trim()) return controlFail('SURFACE_RESUME_BINDING_NOT_FOUND', 'Surface has no resume binding.')
    const policy = controlText(params.policy || params.approvalPolicy || params.approval_policy || 'auto').toLowerCase()
    if (policy !== 'auto' && policy !== 'manual') return controlFail('SURFACE_RESUME_POLICY_INVALID', 'Resume trust policy must be auto or manual.')
    const now = Date.now()
    const trusted: ControlSurfaceResumeBindingState = {
      ...existing,
      autoResume: policy === 'auto',
      auto_resume: policy === 'auto',
      approvalPolicy: policy,
      approval_policy: policy,
      approvalRecordId: policy === 'auto' ? surfaceResumeTrustId(panel, existing) : undefined,
      approval_record_id: policy === 'auto' ? surfaceResumeTrustId(panel, existing) : undefined,
      trustedAt: now,
      trusted_at: now,
      trustReason: controlText(params.reason || params.trustReason || params.trust_reason) || 'manual-trust',
      trust_reason: controlText(params.reason || params.trustReason || params.trust_reason) || 'manual-trust',
      updatedAt: now,
      updated_at: now
    }
    controlSurfaceResumeBindings.value = { ...controlSurfaceResumeBindings.value, [panel.id]: trusted }
    return controlOk(surfaceResumePayload(panel))
  }
  if (method === 'surface.resume.preview' || method === 'surface.resume.autorun.preview') {
    return controlOk(surfaceResumeAutoPayload(surfaceResumePreviewItems(params)))
  }
  if (method === 'surface.resume.autorun' || method === 'surface.resume.run_auto') {
    const items = surfaceResumePreviewItems(params)
    const ready = items.filter((item) => item.ready && item.binding?.command.trim())
    if (!ready.length) return controlOk({ ...surfaceResumeAutoPayload(items), ranCount: 0, decisions: [] })
    const decisions = []
    for (const item of ready) {
      const decision = await workspace.runTerminalCommand(item.panel.id, item.binding!.command, { source: 'agent', writeToShell: true })
      decisions.push({
        panelId: item.panel.id,
        sessionId: item.panel.sessionId,
        status: decision.status,
        decision
      })
    }
    return controlOk({ ...surfaceResumeAutoPayload(items), ranCount: decisions.length, decisions })
  }
  if (method === 'surface.resume.run') {
    if (panel.kind === 'knowledge') return controlFail('SURFACE_RESUME_TERMINAL_REQUIRED', 'Resume command can only run in a terminal surface.')
    const binding = controlSurfaceResumeBindings.value[panel.id]
    if (!binding?.command.trim()) return controlFail('SURFACE_RESUME_BINDING_NOT_FOUND', 'Surface has no resume binding.')
    const decision = await workspace.runTerminalCommand(panel.id, binding.command, { source: 'agent', writeToShell: true })
    return controlOk({ ...surfaceResumePayload(panel), decision })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
}

const defaultRespawnCommand = 'exec ${SHELL:-/bin/bash} -l'

const handleSurfaceRespawnControlRequest = async (params: Record<string, unknown>) => {
  const panel = resolveControlSurfacePanel(params)
  if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
  if (panel.kind === 'knowledge') return controlFail('SURFACE_RESPAWN_TERMINAL_REQUIRED', 'Respawn command can only run in a terminal surface.')
  const command = controlText(params.command || params.tmux_start_command || params.shell || params.shellCommand) || defaultRespawnCommand
  const decision = await workspace.runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
  return controlOk({
    surface: surfaceSummaryForControl(panel),
    terminal: terminalSummaryForControl(panel),
    surfaceId: panel.id,
    surface_id: panel.id,
    command,
    decision,
    snapshot: workspaceSnapshotForControl()
  })
}

const sessionControlHandlers = createTerminalControlSurfaceSessionHandlers({
  workspace,
  isWelcomePlaceholderPanel,
  terminalViewSize,
  controlWorkspaceGroups,
  controlSurfaceResumeBindings,
  pruneWorkspaceGroups,
  terminalKindForControl,
  workspaceSnapshotForControl
})

const mobileControlHandlers = createTerminalControlSurfaceMobileHandlers({
  workspace,
  terminalViews,
  terminalSummaryForControl
})

const agentControlHandlers = createTerminalControlSurfaceAgentHandlers({
  workspace,
  visibleTerminalPanels,
  controlWorkspaceGroups,
  terminalViewSize,
  surfaceSummaryForControl,
  terminalSummaryForControl,
  workspaceGroupSummaryForControl,
  workspaceGroupPayload,
  workspaceSnapshotForControl,
  managedAiSessionSummaryForControl
})

const handleControlRequest = async (request: ControlRequest): Promise<ControlResponse> => {
  const params = request.params || {}
  if (request.method === 'session.export') return controlOk({ snapshot: sessionControlHandlers.exportSessionSnapshotForControl(params) })
  if (request.method === 'session.restore') return sessionControlHandlers.restoreSessionSnapshotForControl(params)
  if (request.method === 'settings.open') {
    const requestedTarget = controlText(params.target || params.section || params.page || 'general') || 'general'
    const section = resolveControlSettingsSection(requestedTarget)
    if (!section) return controlFail('SETTINGS_TARGET_INVALID', 'Unknown settings target.', { target: requestedTarget })
    workspace.mode = 'terminal'
    workspace.activeModule = 'settings'
    workspace.leftPanelOpen = true
    workspace.rightPanelOpen = false
    workspace.setActiveSettingsSection(section)
    await nextTick()
    return controlOk({
      opened: true,
      target: section,
      requestedTarget,
      requested_target: requestedTarget,
      activeModule: workspace.activeModule,
      active_module: workspace.activeModule
    })
  }
  if (request.method === 'feedback.open') {
    const opened = await workspace.openSettingsExternalAction('反馈页面')
    return controlOk({
      opened,
      unsupported: !opened,
      ...(opened ? {} : { unsupportedReason: 'Feedback report bridge is unavailable or failed.' })
    })
  }
  if (request.method === 'extension.sidebar.snapshot') {
    const snapshot = workspaceSnapshotForControl()
    return controlOk({
      seq: snapshot.generatedAt,
      sequence: snapshot.generatedAt,
      window_id: controlText(params.windowId || params.window_id) || null,
      window_ref: controlText(params.windowId || params.window_id) || null,
      selected_workspace_id: 'main',
      selected_workspace_ref: 'workspace:1',
      workspaces: workspaceSidebarRowsForControl(snapshot),
      snapshot
    })
  }
  if (
    request.method.startsWith('project.') ||
    request.method === 'markdown.open' ||
    request.method === 'file.open'
  ) {
    return handleProjectFileControlRequest(request.method, params)
  }
  if (request.method === 'workspace.env' || request.method === 'workspace.set_auto_title') return handleWorkspaceMetadataControlRequest(request.method, params)
  if (request.method === 'workspace.action') return handleWorkspaceActionControlRequest(params)
  if (request.method.startsWith('workspace.remote.') || request.method.startsWith('remote.tmux.')) return handleWorkspaceRemoteControlRequest(request.method, params)
  if (request.method.startsWith('workspace.group.')) return handleWorkspaceGroupControlRequest(request.method, params)
  if (request.method.startsWith('surface.resume.')) return handleSurfaceResumeControlRequest(request.method, params)
  if (['workspace.next', 'workspace.previous', 'workspace.last', 'workspace.select', 'workspace.find', 'pane.focus', 'pane.last', 'surface.focus'].includes(request.method)) {
    return handlePaneNavigationControlRequest(request.method, params)
  }
  if (['pane.list', 'pane.surfaces', 'pane.create', 'workspace.create', 'surface.create', 'surface.split', 'workspace.rename', 'workspace.close', 'surface.close', 'workspace.has_session', 'workspace.select_layout'].includes(request.method)) {
    return handlePaneManagementControlRequest(request.method, params)
  }
  if (request.method.startsWith('pane.')) return handlePaneLayoutControlRequest(request.method, params)
  if (
    [
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
    ].includes(request.method)
  ) {
    return handleSurfaceOperationsControlRequest(request.method, params)
  }
  if (request.method === 'surface.respawn' || request.method === 'terminal.respawn') return handleSurfaceRespawnControlRequest(params)
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
    const surface = snapshot.surfaces.find((item) => item.panelId === snapshot.activePanelId) || snapshot.surfaces[0] || null
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
  if (request.method === 'terminal.focus') {
    return mobileControlHandlers.handleTerminalFocusControlRequest(params)
  }
  if (request.method === 'terminal.read_screen') {
    return mobileControlHandlers.handleTerminalReadScreenControlRequest(params)
  }
  if (request.method === 'terminal.clear_history') return mobileControlHandlers.clearTerminalHistoryForControl(params)
  if (request.method === 'notification.sync') {
    const notifications = Array.isArray(params.notifications) ? (params.notifications as ControlNotificationRecord[]) : []
    workspace.applyControlNotificationSnapshot(notifications)
    return controlOk({ count: notifications.length })
  }
  if (request.method === 'notification.open') {
    const focusRequest = params as ControlNotificationFocusRequest
    if (!focusRequest.notification) return controlFail('NOTIFICATION_PAYLOAD_INVALID', 'Notification focus payload is invalid.')
    const focused = workspace.focusControlNotification(focusRequest)
    return controlOk({ focused })
  }
  return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${request.method}`)
}

const recordLastActiveControlPanel = (panelId: string) => {
  lastActiveControlPanelId.value = panelId
}

const dispose = () => {
  if (controlFlashTimer) {
    window.clearTimeout(controlFlashTimer)
    controlFlashTimer = null
  }
}

return {
  controlFlashingPanelIds,
  handleControlRequest,
  recordLastActiveControlPanel,
  dispose
}
}
