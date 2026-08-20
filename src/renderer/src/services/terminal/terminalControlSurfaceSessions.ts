import { nextTick } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import { createManagedAiSessionContentViewState, isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlFail,
  controlOk,
  controlText,
  isRecord,
  type ControlSurfaceResumeBindingState,
  type ControlWorkspaceGroupState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import { terminalClient } from '@/services/terminal/terminalClient'
import { isCenterSurface, isModuleKey } from '@/config/navigation'
import type {
  ControlResponse,
  ControlSessionPanelSnapshot,
  ControlSessionRestoreResult,
  ControlSessionSnapshot,
  ControlTerminalSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

type TerminalControlSurfaceSessionDependencies = {
  workspace: WorkspaceStore
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  terminalViewSize: (panelId: string) => { cols: number; rows: number }
  controlWorkspaceGroups: { value: ControlWorkspaceGroupState[] }
  controlSurfaceResumeBindings: { value: Record<string, ControlSurfaceResumeBindingState> }
  pruneWorkspaceGroups: () => void
  terminalKindForControl: (panel: TerminalPanel) => ControlTerminalSummary['kind']
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
}

export const createTerminalControlSurfaceSessionHandlers = ({
  workspace,
  isWelcomePlaceholderPanel,
  terminalViewSize,
  controlWorkspaceGroups,
  controlSurfaceResumeBindings,
  pruneWorkspaceGroups,
  terminalKindForControl,
  workspaceSnapshotForControl
}: TerminalControlSurfaceSessionDependencies) => {
  const sessionPanelSnapshotForControl = (panel: TerminalPanel): ControlSessionPanelSnapshot => {
    const resumeBinding = controlSurfaceResumeBindings.value[panel.id]
    return {
      id: panel.id,
      title: panel.title,
      cwd: panel.cwd,
      kind: panel.kind === 'knowledge' ? 'knowledge' : panel.kind === 'managed-ai-session' ? 'managed-ai-session' : 'terminal',
      status: panel.status,
      ...(isTerminalWorkspacePanel(panel) ? { terminalKind: terminalKindForControl(panel) } : {}),
      ...(panel.split ? { split: panel.split } : {}),
      ...(panel.splitSourceId ? { splitSourceId: panel.splitSourceId } : {}),
      ...(panel.splitGroupId ? { splitGroupId: panel.splitGroupId } : {}),
      ...(typeof panel.splitOrder === 'number' ? { splitOrder: panel.splitOrder } : {}),
      ...(panel.sshSession
        ? {
            sshSession: {
              host: panel.sshSession.host,
              port: panel.sshSession.port,
              username: panel.sshSession.username,
              ...(panel.sshSession.assetId ? { assetId: panel.sshSession.assetId } : {}),
              ...(panel.sshSession.assetName ? { assetName: panel.sshSession.assetName } : {}),
              ...(panel.sshSession.assetType ? { assetType: panel.sshSession.assetType } : {}),
              ...(panel.sshSession.organizationId ? { organizationId: panel.sshSession.organizationId } : {}),
              ...(panel.sshSession.jumpHostId ? { jumpHostId: panel.sshSession.jumpHostId } : {}),
              ...(panel.sshSession.authType ? { authType: panel.sshSession.authType } : {}),
              ...(typeof panel.sshSession.needProxy === 'boolean' ? { needProxy: panel.sshSession.needProxy } : {}),
              ...(panel.sshSession.proxyName ? { proxyName: panel.sshSession.proxyName } : {}),
              ...(panel.sshSession.forkFromConnectionId ? { forkFromConnectionId: panel.sshSession.forkFromConnectionId } : {})
            }
          }
        : {}),
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
      ...(resumeBinding ? { resumeBinding: { ...resumeBinding } } : {})
    }
  }

  const exportSessionSnapshotForControl = (params: Record<string, unknown> = {}): ControlSessionSnapshot => {
    pruneWorkspaceGroups()
    const now = Date.now()
    const id = controlText(params.id || params.name) || 'latest'
    const panels = workspace.panels
      .filter((panel) => !isWelcomePlaceholderPanel(panel) && panel.kind !== 'local-file')
      .map(sessionPanelSnapshotForControl)
    return {
      id,
      name: controlText(params.name) || (id === 'latest' ? 'Latest Session' : id),
      version: 1,
      createdAt: now,
      updatedAt: now,
      activePanelId: panels.some((panel) => panel.id === workspace.activePanelId) ? workspace.activePanelId : panels[0]?.id || 'panel-main',
      mode: workspace.mode,
      activeModule: workspace.activeModule,
      activeCenterSurface: workspace.activeCenterSurface,
      panels: panels.length
        ? panels
        : [
            {
              id: 'panel-main',
              title: 'Terminal',
              cwd: '~',
              kind: 'terminal',
              status: 'ready',
              terminalKind: 'unknown'
            }
          ],
      workspaceGroups: controlWorkspaceGroups.value.map((group, index) => ({ ...group, index })),
      agentHibernation: { ...workspace.agentHibernationConfig },
      source: controlText(params.source) || 'renderer'
    }
  }

  const normalizeSessionRestoreSnapshot = (value: unknown): ControlSessionSnapshot | null => {
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !isModuleKey(value.activeModule) ||
      !isCenterSurface(value.activeCenterSurface) ||
      !Array.isArray(value.panels) ||
      !value.panels.length
    ) return null
    const panels = value.panels.filter((panel): panel is ControlSessionPanelSnapshot => {
      if (!isRecord(panel) || !controlText(panel.id) || !controlText(panel.title)) return false
      return panel.kind === 'terminal' || panel.kind === 'knowledge' || panel.kind === 'managed-ai-session'
    })
    if (!panels.length) return null
    const panelIds = new Set(panels.map((panel) => panel.id))
    const workspaceGroups = (Array.isArray(value.workspaceGroups) ? value.workspaceGroups : [])
      .filter((group): group is ControlWorkspaceGroupState => Boolean(isRecord(group) && controlText(group.id) && controlText(group.name) && Array.isArray(group.memberPanelIds)))
      .map((group, index) => {
        const memberPanelIds = group.memberPanelIds.filter((panelId) => panelIds.has(panelId))
        const anchorPanelId = panelIds.has(group.anchorPanelId) ? group.anchorPanelId : memberPanelIds[0] || ''
        return {
          id: group.id,
          name: group.name,
          anchorPanelId,
          memberPanelIds,
          collapsed: group.collapsed === true,
          pinned: group.pinned === true,
          index,
          createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now(),
          updatedAt: typeof group.updatedAt === 'number' ? group.updatedAt : Date.now(),
          ...(group.cwd ? { cwd: group.cwd } : {}),
          ...(group.color ? { color: group.color } : {}),
          ...(group.icon ? { icon: group.icon } : {})
        }
      })
      .filter((group) => group.anchorPanelId && group.memberPanelIds.length)
    return {
      id: controlText(value.id) || 'latest',
      name: controlText(value.name) || 'Latest Session',
      version: 1,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
      activePanelId: panelIds.has(controlText(value.activePanelId)) ? controlText(value.activePanelId) : panels[0].id,
      mode: controlText(value.mode) || 'terminal',
      activeModule: value.activeModule,
      activeCenterSurface: value.activeCenterSurface,
      panels,
      workspaceGroups,
      ...(isRecord(value.agentHibernation) ? { agentHibernation: value.agentHibernation as ControlSessionSnapshot['agentHibernation'] } : {}),
      ...(controlText(value.source) ? { source: controlText(value.source) } : {})
    }
  }

  const panelFromSessionSnapshot = (item: ControlSessionPanelSnapshot): TerminalPanel => ({
    id: item.id,
    title: item.title,
    cwd: item.cwd || '~',
    output: '',
    outputSegments: [],
    status: item.kind === 'knowledge' || item.kind === 'managed-ai-session' ? 'ready' : item.terminalKind === 'ssh' ? 'closed' : 'ready',
    kind: item.kind,
    ...(item.split ? { split: item.split } : {}),
    ...(item.splitSourceId ? { splitSourceId: item.splitSourceId } : {}),
    ...(item.splitGroupId ? { splitGroupId: item.splitGroupId } : {}),
    ...(typeof item.splitOrder === 'number' ? { splitOrder: item.splitOrder } : {}),
    ...(item.knowledge
      ? {
          knowledge: {
            relPath: item.knowledge.relPath,
            isImage: item.knowledge.isImage,
            ...(typeof item.knowledge.startLine === 'number' ? { startLine: item.knowledge.startLine } : {}),
            ...(typeof item.knowledge.endLine === 'number' ? { endLine: item.knowledge.endLine } : {})
          }
        }
      : {}),
    ...(item.managedAiSession
      ? {
          managedAiSession: {
            source: item.managedAiSession.source,
            sessionId: item.managedAiSession.sessionId,
            contentView: createManagedAiSessionContentViewState()
          }
        }
      : {}),
    ...(item.sshSession
      ? {
          sshSession: {
            host: item.sshSession.host,
            port: item.sshSession.port,
            username: item.sshSession.username,
            assetId: item.sshSession.assetId,
            assetName: item.sshSession.assetName || item.title,
            assetType: item.sshSession.assetType,
            organizationId: item.sshSession.organizationId,
            jumpHostId: item.sshSession.jumpHostId,
            authType: item.sshSession.authType,
            needProxy: item.sshSession.needProxy,
            proxyName: item.sshSession.proxyName || '',
            forkFromConnectionId: item.sshSession.forkFromConnectionId
          }
        }
      : {})
  })

  const closeCurrentTerminalSessionsForRestore = async () => {
    const killTerminal = terminalClient.killTerminal()
    if (!killTerminal) return
    const sessionIds = [...new Set(workspace.panels.map((panel) => panel.sessionId).filter((sessionId): sessionId is string => Boolean(sessionId)))]
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          await killTerminal(sessionId)
        } catch {
          // Restore replaces the visible panels even if an old session already exited.
        }
      })
    )
  }

  const restoreLocalSessionPanel = async (panel: TerminalPanel) => {
    if (!isTerminalWorkspacePanel(panel) || panel.sshSession) return false
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) return false
    await nextTick()
    const size = terminalViewSize(panel.id)
    const restoredTitle = panel.title
    const session = await createTerminal({
      kind: 'local',
      panelId: panel.id,
      workspaceId: 'workspace',
      title: restoredTitle,
      cwd: panel.cwd && panel.cwd !== '~' ? panel.cwd : undefined,
      cols: size.cols,
      rows: size.rows,
      terminalType: workspace.terminalSettings.terminalType
    })
    const connected = workspace.applyLocalTerminalSession(panel.id, session)
    if (connected) {
      workspace.renamePanel(panel.id, restoredTitle)
      return true
    }
    panel.status = 'error'
    return false
  }

  const restoreSessionSnapshotForControl = async (params: Record<string, unknown>): Promise<ControlResponse> => {
    const snapshot = normalizeSessionRestoreSnapshot(params.snapshot)
    if (!snapshot) return controlFail('SESSION_SNAPSHOT_INVALID', 'Session restore snapshot is invalid.')
    await closeCurrentTerminalSessionsForRestore()
    const panels = snapshot.panels.map(panelFromSessionSnapshot)
    const restoredPanels = panels.length ? panels : [panelFromSessionSnapshot({ id: 'panel-main', title: 'Terminal', cwd: '~', kind: 'terminal', status: 'ready', terminalKind: 'unknown' })]
    workspace.restorePanelCollection(restoredPanels, snapshot.activePanelId)
    workspace.setWorkspaceMode(snapshot.mode === 'agents' ? 'agents' : 'terminal')
    workspace.setActiveModule(snapshot.activeModule as Parameters<typeof workspace.setActiveModule>[0])
    workspace.setActiveCenterSurface(snapshot.activeCenterSurface as Parameters<typeof workspace.setActiveCenterSurface>[0])
    controlWorkspaceGroups.value = snapshot.workspaceGroups.map((group, index) => ({ ...group, index }))
    controlSurfaceResumeBindings.value = Object.fromEntries(
      snapshot.panels
        .filter((panel) => panel.resumeBinding?.command)
        .map((panel) => [panel.id, { ...panel.resumeBinding!, autoResume: Boolean(panel.resumeBinding!.autoResume), updatedAt: panel.resumeBinding!.updatedAt || Date.now() }])
    )
    pruneWorkspaceGroups()
    await nextTick()
    let launchedLocalTerminals = 0
    let skippedRemoteTerminals = 0
    for (const panel of workspace.panels) {
      if (!isTerminalWorkspacePanel(panel)) continue
      if (panel.sshSession) {
        skippedRemoteTerminals += 1
        continue
      }
      try {
        if (await restoreLocalSessionPanel(panel)) launchedLocalTerminals += 1
      } catch {
        panel.status = 'error'
      }
    }
    workspace.setTopNotice(`已恢复会话 ${snapshot.name}`)
    const result: ControlSessionRestoreResult = {
      snapshot: workspaceSnapshotForControl(),
      restoredSnapshot: snapshot,
      restoredPanels: snapshot.panels.length,
      restoredWorkspaceGroups: snapshot.workspaceGroups.length,
      restoredResumeBindings: Object.keys(controlSurfaceResumeBindings.value).length,
      launchedLocalTerminals,
      skippedRemoteTerminals
    }
    return controlOk(result as unknown as Record<string, unknown>)
  }

  return {
    exportSessionSnapshotForControl,
    restoreSessionSnapshotForControl
  }
}
