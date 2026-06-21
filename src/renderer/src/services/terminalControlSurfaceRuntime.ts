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
import { createTerminalControlSurfaceGroupHandlers } from '@/services/terminalControlSurfaceGroups'
import { createTerminalControlSurfaceMobileHandlers } from '@/services/terminalControlSurfaceMobile'
import { createTerminalControlSurfacePaneHandlers } from '@/services/terminalControlSurfacePanes'
import { createTerminalControlSurfaceRemoteHandlers } from '@/services/terminalControlSurfaceRemote'
import { createTerminalControlSurfaceResumeHandlers } from '@/services/terminalControlSurfaceResume'
import { createTerminalControlSurfaceSessionHandlers } from '@/services/terminalControlSurfaceSessions'
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

const selectableControlPanels = () => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel))

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

const remoteControlHandlers = createTerminalControlSurfaceRemoteHandlers({
  workspace,
  controlWorkspaceRemote,
  resolveControlSourceSurfacePanel,
  remoteStateForControlPanel,
  workspaceRemoteSummaryForControl,
  workspaceSnapshotForControl,
  surfaceSummaryForControl,
  startSshTerminalForPanel,
  disconnectTerminalPanel
})

const groupControlHandlers = createTerminalControlSurfaceGroupHandlers({
  workspace,
  controlWorkspaceGroups,
  isWelcomePlaceholderPanel,
  resolveWorkspaceGroup,
  resolveControlPanelId,
  workspaceGroupSummaryForControl,
  surfaceSummaryForControl,
  workspaceSnapshotForControl
})

const paneControlHandlers = createTerminalControlSurfacePaneHandlers({
  workspace,
  terminalViews,
  controlSurfaceTelemetry,
  controlWorkspaceEnvironment,
  lastActiveControlPanelId,
  controlFlashingPanelIds,
  isWelcomePlaceholderPanel,
  resolveControlPanelId,
  resolveControlSourceSurfacePanel,
  resolveControlPanePanel,
  panelMatchesControlId,
  panelRefForControl,
  controlPanelIndexFromValue,
  cleanWorkspaceEnvironmentForControl,
  surfaceSummaryForControl,
  surfaceTelemetrySummaryForControl,
  workspaceSnapshotForControl,
  scheduleVisibleTerminalFit
})

const { resolveControlSelectablePanel, controlTargetValue } = paneControlHandlers

const resumeControlHandlers = createTerminalControlSurfaceResumeHandlers({
  workspace,
  controlSurfaceResumeBindings,
  resolveControlSurfacePanel,
  surfaceSummaryForControl,
  terminalSummaryForControl,
  workspaceSnapshotForControl
})

const agentControlHandlers = createTerminalControlSurfaceAgentHandlers({
  workspace,
  visibleTerminalPanels,
  controlWorkspaceGroups,
  terminalViewSize,
  surfaceSummaryForControl,
  terminalSummaryForControl,
  workspaceGroupSummaryForControl,
  workspaceGroupPayload: groupControlHandlers.workspaceGroupPayload,
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
  if (request.method === 'workspace.action') return paneControlHandlers.handleWorkspaceActionControlRequest(params)
  if (request.method.startsWith('workspace.remote.') || request.method.startsWith('remote.tmux.')) return remoteControlHandlers.handleWorkspaceRemoteControlRequest(request.method, params)
  if (request.method.startsWith('workspace.group.')) return groupControlHandlers.handleWorkspaceGroupControlRequest(request.method, params)
  if (request.method.startsWith('surface.resume.')) return resumeControlHandlers.handleSurfaceResumeControlRequest(request.method, params)
  if (['workspace.next', 'workspace.previous', 'workspace.last', 'workspace.select', 'workspace.find', 'pane.focus', 'pane.last', 'surface.focus'].includes(request.method)) {
    return paneControlHandlers.handlePaneNavigationControlRequest(request.method, params)
  }
  if (['pane.list', 'pane.surfaces', 'pane.create', 'workspace.create', 'surface.create', 'surface.split', 'workspace.rename', 'workspace.close', 'surface.close', 'workspace.has_session', 'workspace.select_layout'].includes(request.method)) {
    return paneControlHandlers.handlePaneManagementControlRequest(request.method, params)
  }
  if (request.method.startsWith('pane.')) return paneControlHandlers.handlePaneLayoutControlRequest(request.method, params)
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
    return paneControlHandlers.handleSurfaceOperationsControlRequest(request.method, params)
  }
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
  paneControlHandlers.dispose()
}

return {
  controlFlashingPanelIds,
  handleControlRequest,
  recordLastActiveControlPanel,
  dispose
}
}
