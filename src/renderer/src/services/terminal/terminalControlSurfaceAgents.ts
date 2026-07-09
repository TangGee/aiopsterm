import { nextTick, ref } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  type ControlWorkspaceGroupState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import { terminalClient } from '@/services/terminal/terminalClient'
import type {
  ControlAgentTeamLaunchMember,
  ControlAgentTeamLaunchResult,
  ControlAgentTeamLaunchSource,
  ControlManagedAiSessionSummary,
  ControlResponse,
  ControlSurfaceSummary,
  ControlTerminalSummary,
  ControlWorkspaceGroupSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'
import type { TerminalSessionInfo } from '@shared/contracts/terminalSessions'

type AgentSession = WorkspaceStore['managedAiSessions'][number]

type TerminalControlSurfaceAgentDependencies = {
  workspace: WorkspaceStore
  visibleTerminalPanels: Readonly<{ value: TerminalPanel[] }>
  controlWorkspaceGroups: Readonly<{ value: ControlWorkspaceGroupState[] }> & { value: ControlWorkspaceGroupState[] }
  terminalViewSize: (panelId: string) => { cols: number; rows: number }
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  terminalSummaryForControl: (panel: TerminalPanel) => ControlTerminalSummary
  workspaceGroupSummaryForControl: (group: ControlWorkspaceGroupState) => ControlWorkspaceGroupSummary
  workspaceGroupPayload: (group?: ControlWorkspaceGroupState | null) => Record<string, unknown>
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
  managedAiSessionSummaryForControl: (session: AgentSession) => ControlManagedAiSessionSummary
}

type AgentHibernationReaperCandidate = {
  session: AgentSession
  panel: TerminalPanel
  terminalSessionId: string
  lastActivityAt: number
  fingerprint: string
}

type AgentHibernationPendingConfirmation = {
  fingerprint: string
  sampledAt: number
  dueAt: number
}

const normalizeAgentTeamSource = (value: unknown): ControlAgentTeamLaunchSource => {
  const source = controlText(value).toLowerCase()
  if (source === 'claude' || source === 'claude-code' || source === 'claude_code') return 'claude-code'
  if (source === 'custom') return 'custom'
  return 'codex'
}

const shellQuoteForControl = (value: string) => `'${value.replace(/'/g, `'\"'\"'`)}'`

const buildAgentTeamCommand = (params: Record<string, unknown>, source: ControlAgentTeamLaunchSource, index: number) => {
  const custom = controlText(params.command || params.shell || params.commandText)
  const cwd = controlText(params.cwd)
  const prompt = controlText(params.prompt || params.message || params.instruction)
  const role = controlText(params.role || params.agentRole)
  const model = controlText(params.model)
  const prefix = cwd ? `cd ${shellQuoteForControl(cwd)} && ` : ''
  if (custom) {
    return custom
      .replace(/\{\{index\}\}/g, String(index))
      .replace(/\{\{cwd\}\}/g, cwd)
      .replace(/\{\{prompt\}\}/g, prompt)
      .replace(/\{\{role\}\}/g, role)
      .replace(/\{\{model\}\}/g, model)
  }
  const promptSuffix = prompt ? ` ${shellQuoteForControl(prompt)}` : ''
  if (source === 'claude-code') {
    const modelArgs = model ? ` --model ${shellQuoteForControl(model)}` : ''
    return `${prefix}claude${modelArgs}${promptSuffix}`
  }
  const modelArgs = model ? ` --model ${shellQuoteForControl(model)}` : ''
  return `${prefix}codex${modelArgs}${promptSuffix}`
}

export const createTerminalControlSurfaceAgentHandlers = ({
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
}: TerminalControlSurfaceAgentDependencies) => {
  const agentHibernationConfirmations = ref<Record<string, AgentHibernationPendingConfirmation>>({})

  const createAgentTeamGroup = (params: Record<string, unknown>, panelIds: string[], source: ControlAgentTeamLaunchSource, cwd: string) => {
    const now = Date.now()
    const name = controlText(params.name || params.groupName || params.title) || `${source === 'claude-code' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Agent'} Team`
    const group: ControlWorkspaceGroupState = {
      id: `workspace-group-${now}-${Math.random().toString(16).slice(2)}`,
      name,
      anchorPanelId: panelIds[0],
      memberPanelIds: [...new Set(panelIds)],
      collapsed: false,
      pinned: controlBool(params.pinned, true),
      index: controlWorkspaceGroups.value.length,
      createdAt: now,
      updatedAt: now,
      ...(cwd ? { cwd } : {}),
      color: controlText(params.color || params.hex) || '#3b82f6',
      icon: controlText(params.icon || params.symbol) || 'bot'
    }
    const assigned = new Set(group.memberPanelIds)
    controlWorkspaceGroups.value = [
      ...controlWorkspaceGroups.value
        .map((item) => ({ ...item, memberPanelIds: item.memberPanelIds.filter((panelId) => !assigned.has(panelId)) }))
        .filter((item) => item.memberPanelIds.length),
      group
    ].map((item, index) => ({ ...item, index }))
    return group
  }

  const createLocalAgentTeamTerminal = async (panel: TerminalPanel, title: string, cwd: string) => {
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) {
      throw new Error('本地终端启动服务不可用')
    }
    await nextTick()
    const size = terminalViewSize(panel.id)
    const session = (await createTerminal({
      kind: 'local',
      panelId: panel.id,
      workspaceId: 'workspace',
      title,
      ...(cwd ? { cwd } : {}),
      cols: size.cols,
      rows: size.rows,
      terminalType: workspace.terminalSettings.terminalType
    })) as TerminalSessionInfo
    const connected = workspace.applyLocalTerminalSession(panel.id, session)
    if (!connected) throw new Error('本地终端启动失败')
    workspace.renamePanel(panel.id, title)
    return connected
  }

  const handleAgentTeamControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    if (method !== 'agent.team.launch') return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
    const source = normalizeAgentTeamSource(params.source || params.agent)
    const count = controlNumber(params.count || params.n, 2, 1, 12)
    const cwd = controlText(params.cwd) || (isTerminalWorkspacePanel(workspace.activePanel) ? workspace.activePanel.cwd : '')
    const focus = controlBool(params.focus, true)
    const members: ControlAgentTeamLaunchMember[] = []
    const panelIds: string[] = []
    const previousActivePanelId = workspace.activePanelId

    for (let index = 1; index <= count; index += 1) {
      const panel = workspace.createPanel()
      const title = `${source === 'claude-code' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Agent'} ${index}`
      workspace.renamePanel(panel.id, title)
      panelIds.push(panel.id)
      const command = buildAgentTeamCommand(params, source, index)
      try {
        const connected = await createLocalAgentTeamTerminal(panel, title, cwd)
        const decision = await workspace.runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
        members.push({
          index,
          source,
          command,
          panel: surfaceSummaryForControl(connected),
          terminal: terminalSummaryForControl(connected),
          status: decision.status === 'allow' ? 'launched' : decision.status === 'needs-approval' ? 'needs-approval' : 'failed',
          ...(decision.status !== 'allow' && decision.status !== 'needs-approval' ? { errorMessage: 'Agent team command was not launched.' } : {})
        })
      } catch (error) {
        members.push({
          index,
          source,
          command,
          panel: surfaceSummaryForControl(panel),
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Agent team terminal launch failed.'
        })
      }
    }

    const group = createAgentTeamGroup(params, panelIds, source, cwd)
    workspace.activeModule = 'workspace'
    if (focus && panelIds[0]) workspace.activePanelId = panelIds[0]
    if (!focus && workspace.panels.some((panel) => panel.id === previousActivePanelId)) workspace.activePanelId = previousActivePanelId
    const team: ControlAgentTeamLaunchResult = {
      source,
      ...(cwd ? { cwd } : {}),
      requestedCount: count,
      launchedCount: members.filter((member) => member.status === 'launched').length,
      approvalCount: members.filter((member) => member.status === 'needs-approval').length,
      failedCount: members.filter((member) => member.status === 'failed').length,
      group: workspaceGroupSummaryForControl(group),
      members,
      snapshot: workspaceSnapshotForControl()
    }
    workspace.setTopNotice(`已创建 ${team.launchedCount} 个 ${source === 'claude-code' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Agent'} Team 会话`)
    return controlOk({ team, ...workspaceGroupPayload(group) })
  }

  const agentHibernationCandidateKey = (candidate: AgentHibernationReaperCandidate) => `${candidate.session.source}:${candidate.session.id}`

  const agentHibernationFingerprint = (session: AgentSession, panel: TerminalPanel, terminalSessionId: string) =>
    [
      session.source,
      session.id,
      terminalSessionId,
      session.terminalProcessId || '',
      session.processId || '',
      session.parentProcessId || '',
      session.processGroupId || '',
      session.agentLifecycle || '',
      session.state || '',
      session.terminalActivityAt || '',
      panel.sessionId || '',
      panel.status || ''
    ].join('|')

  const agentHibernationActivityAt = (session: AgentSession) => {
    const value = Math.max(
      typeof session.terminalActivityAt === 'number' ? session.terminalActivityAt : 0,
      typeof session.lastActivityAt === 'number' ? session.lastActivityAt : 0,
      typeof session.createdAt === 'number' ? session.createdAt : 0
    )
    return value > 0 ? value : Date.now()
  }

  const liveRestorableAgentSessions = () => {
    const sessions: AgentHibernationReaperCandidate[] = []
    workspace.managedAiSessions.forEach((session) => {
      if (session.hibernated || !session.resumeCommand?.trim()) return
      const targetId = session.panelId || session.terminalSessionId
      const panel = targetId ? workspace.panels.find((item) => item.id === targetId || item.sessionId === targetId) : null
      if (!panel || !isTerminalWorkspacePanel(panel) || !panel.sessionId || panel.status === 'closed' || panel.status === 'error') return
      sessions.push({
        session,
        panel,
        terminalSessionId: panel.sessionId,
        lastActivityAt: agentHibernationActivityAt(session),
        fingerprint: agentHibernationFingerprint(session, panel, panel.sessionId)
      })
    })
    return sessions
  }

  const agentHibernationEligibleCandidates = (now: number) => {
    const config = workspace.agentHibernationConfig
    const liveRestorable = liveRestorableAgentSessions()
    const liveRestorableCount = liveRestorable.length
    const excess = liveRestorableCount - config.maxLiveTerminals
    const visiblePanelIds = new Set(visibleTerminalPanels.value.map((panel) => panel.id))
    if (!config.enabled || excess <= 0) {
      return { liveRestorableCount, excess: Math.max(0, excess), selected: [] as AgentHibernationReaperCandidate[], eligible: [] as AgentHibernationReaperCandidate[] }
    }
    const idleMs = config.idleSeconds * 1000
    const eligible = liveRestorable
      .filter((candidate) => {
        const { session, panel } = candidate
        if (visiblePanelIds.has(panel.id)) return false
        if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') return false
        if (session.state === 'working' || session.agentLifecycle === 'running') return false
        if (session.state === 'ended' || session.agentLifecycle === 'ended') return false
        return now - candidate.lastActivityAt >= idleMs
      })
      .sort((left, right) => {
        if (left.lastActivityAt === right.lastActivityAt) return agentHibernationCandidateKey(left).localeCompare(agentHibernationCandidateKey(right))
        return left.lastActivityAt - right.lastActivityAt
      })
    return { liveRestorableCount, excess, eligible, selected: eligible.slice(0, excess) }
  }

  const pruneAgentHibernationConfirmations = (selected: AgentHibernationReaperCandidate[]) => {
    const selectedKeys = new Set(selected.map(agentHibernationCandidateKey))
    agentHibernationConfirmations.value = Object.fromEntries(Object.entries(agentHibernationConfirmations.value).filter(([key]) => selectedKeys.has(key)))
  }

  const agentHibernationReaperPayload = (
    selected: AgentHibernationReaperCandidate[],
    hibernated: ControlManagedAiSessionSummary[],
    pending: AgentHibernationReaperCandidate[],
    skipped: Array<{ sessionId: string; source: string; reason: string }>,
    liveRestorableCount: number,
    eligibleCount: number,
    excess: number
  ): Record<string, unknown> => ({
    config: { ...workspace.agentHibernationConfig },
    liveRestorableCount,
    eligibleCount,
    excess,
    selectedCount: selected.length,
    pendingCount: pending.length,
    hibernatedCount: hibernated.length,
    candidates: selected.map((candidate) => ({
      session: managedAiSessionSummaryForControl(candidate.session),
      panel: surfaceSummaryForControl(candidate.panel),
      terminalSessionId: candidate.terminalSessionId,
      lastActivityAt: candidate.lastActivityAt,
      idleSeconds: Math.max(0, Math.floor((Date.now() - candidate.lastActivityAt) / 1000))
    })),
    pending: pending.map((candidate) => {
      const confirmation = agentHibernationConfirmations.value[agentHibernationCandidateKey(candidate)]
      return {
        sessionId: candidate.session.id,
        source: candidate.session.source,
        dueAt: confirmation?.dueAt,
        sampledAt: confirmation?.sampledAt
      }
    }),
    hibernated,
    skipped,
    snapshot: workspaceSnapshotForControl()
  })

  const sweepAgentHibernationReaper = async (params: Record<string, unknown>, previewOnly = false) => {
    await workspace.refreshAgentHibernationConfig()
    const now = Date.now()
    const { liveRestorableCount, excess, eligible, selected } = agentHibernationEligibleCandidates(now)
    pruneAgentHibernationConfirmations(selected)
    const pending: AgentHibernationReaperCandidate[] = []
    const hibernated: ControlManagedAiSessionSummary[] = []
    const skipped: Array<{ sessionId: string; source: string; reason: string }> = []
    if (previewOnly || !workspace.agentHibernationConfig.enabled) {
      return controlOk(agentHibernationReaperPayload(selected, hibernated, pending, skipped, liveRestorableCount, eligible.length, excess))
    }
    const confirmationSeconds = controlBool(params.confirm, true) ? workspace.agentHibernationConfig.confirmationSeconds : 0
    for (const candidate of selected) {
      const key = agentHibernationCandidateKey(candidate)
      if (confirmationSeconds > 0) {
        const confirmation = agentHibernationConfirmations.value[key]
        if (!confirmation || confirmation.fingerprint !== candidate.fingerprint) {
          agentHibernationConfirmations.value = {
            ...agentHibernationConfirmations.value,
            [key]: {
              fingerprint: candidate.fingerprint,
              sampledAt: now,
              dueAt: now + confirmationSeconds * 1000
            }
          }
          pending.push(candidate)
          continue
        }
        if (now < confirmation.dueAt) {
          pending.push(candidate)
          continue
        }
      }
      const ok = await workspace.hibernateManagedAiSession(candidate.session.source, candidate.session.id, controlText(params.reason) || 'auto-reaper')
      if (ok) {
        delete agentHibernationConfirmations.value[key]
        const updatedSession = workspace.managedAiSessions.find((session) => session.source === candidate.session.source && session.id === candidate.session.id) || candidate.session
        hibernated.push(managedAiSessionSummaryForControl(updatedSession))
      } else {
        skipped.push({ sessionId: candidate.session.id, source: candidate.session.source, reason: 'hibernate-failed' })
      }
    }
    return controlOk(agentHibernationReaperPayload(selected, hibernated, pending, skipped, liveRestorableCount, eligible.length, excess))
  }

  const handleAgentHibernationControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    if (method === 'agent-hibernation.status' || method === 'agent.status') {
      await workspace.refreshAgentHibernationConfig()
      return controlOk({
        config: { ...workspace.agentHibernationConfig },
        sessions: workspace.managedAiSessions.map(managedAiSessionSummaryForControl),
        snapshot: workspaceSnapshotForControl()
      })
    }
    if (method === 'agent-hibernation.on') {
      const changed = await workspace.setAgentHibernationEnabled(true)
      return changed ? controlOk({ config: { ...workspace.agentHibernationConfig } }) : controlFail('AGENT_HIBERNATION_ENABLE_FAILED', 'Agent hibernation could not be enabled.')
    }
    if (method === 'agent-hibernation.off') {
      const changed = await workspace.setAgentHibernationEnabled(false)
      return changed ? controlOk({ config: { ...workspace.agentHibernationConfig } }) : controlFail('AGENT_HIBERNATION_DISABLE_FAILED', 'Agent hibernation could not be disabled.')
    }
    if (method === 'agent-hibernation.preview' || method === 'agent.preview') {
      return sweepAgentHibernationReaper(params, true)
    }
    if (method === 'agent-hibernation.sweep' || method === 'agent.sweep') {
      return sweepAgentHibernationReaper(params)
    }
    const source = controlText(params.source)
    const sessionId = controlText(params.sessionId || params.session_id || params.id)
    if (!sessionId) return controlFail('AGENT_SESSION_ID_REQUIRED', 'Managed AI session id is required.')
    const session = workspace.managedAiSessions.find((item) => item.id === sessionId && (!source || item.source === source))
    if (!session) return controlFail('AGENT_SESSION_NOT_FOUND', 'Managed AI session was not found.')
    if (method === 'agent.hibernate') {
      const ok = await workspace.hibernateManagedAiSession(session.source, session.id, controlText(params.reason) || 'manual')
      return ok ? controlOk({ session: managedAiSessionSummaryForControl(session), snapshot: workspaceSnapshotForControl() }) : controlFail('AGENT_HIBERNATE_FAILED', 'Managed AI session hibernation failed.')
    }
    if (method === 'agent.resume') {
      const ok = await workspace.resumeManagedAiSession(session.source, session.id)
      return ok ? controlOk({ session: managedAiSessionSummaryForControl(session), snapshot: workspaceSnapshotForControl() }) : controlFail('AGENT_RESUME_FAILED', 'Managed AI session resume failed.')
    }
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  return {
    handleAgentTeamControlRequest,
    handleAgentHibernationControlRequest
  }
}
