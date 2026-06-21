import { createTerminalControlSurfaceAgentHandlers } from '@/services/terminalControlSurfaceAgents'
import { createTerminalControlSurfaceDispatcher } from '@/services/terminalControlSurfaceDispatcher'
import { createTerminalControlSurfaceGroupHandlers } from '@/services/terminalControlSurfaceGroups'
import { createTerminalControlSurfaceMobileHandlers } from '@/services/terminalControlSurfaceMobile'
import { createTerminalControlSurfacePaneHandlers } from '@/services/terminalControlSurfacePanes'
import { createTerminalControlSurfaceProjectFileHandlers } from '@/services/terminalControlSurfaceProjectFiles'
import { createTerminalControlSurfaceRemoteHandlers } from '@/services/terminalControlSurfaceRemote'
import { createTerminalControlSurfaceResumeHandlers } from '@/services/terminalControlSurfaceResume'
import { createTerminalControlSurfaceSessionHandlers } from '@/services/terminalControlSurfaceSessions'
import { createTerminalControlSurfaceState } from '@/services/terminalControlSurfaceState'
import { createTerminalControlSurfaceWorkspaceHandlers } from '@/services/terminalControlSurfaceWorkspace'
import type {
  TerminalControlSurfaceDependencies,
  TerminalControlSurfaceView
} from '@/services/terminalControlSurfaceCore'

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
  const state = createTerminalControlSurfaceState({
    workspace,
    terminalViews,
    isWelcomePlaceholderPanel
  })

  const sessionControlHandlers = createTerminalControlSurfaceSessionHandlers({
    workspace,
    isWelcomePlaceholderPanel,
    terminalViewSize,
    controlWorkspaceGroups: state.controlWorkspaceGroups,
    controlSurfaceResumeBindings: state.controlSurfaceResumeBindings,
    pruneWorkspaceGroups: state.pruneWorkspaceGroups,
    terminalKindForControl: state.terminalKindForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl
  })

  const mobileControlHandlers = createTerminalControlSurfaceMobileHandlers({
    workspace,
    terminalViews,
    terminalSummaryForControl: state.terminalSummaryForControl
  })

  const remoteControlHandlers = createTerminalControlSurfaceRemoteHandlers({
    workspace,
    controlWorkspaceRemote: state.controlWorkspaceRemote,
    resolveControlSourceSurfacePanel: state.resolveControlSourceSurfacePanel,
    remoteStateForControlPanel: state.remoteStateForControlPanel,
    workspaceRemoteSummaryForControl: state.workspaceRemoteSummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    startSshTerminalForPanel,
    disconnectTerminalPanel
  })

  const groupControlHandlers = createTerminalControlSurfaceGroupHandlers({
    workspace,
    controlWorkspaceGroups: state.controlWorkspaceGroups,
    isWelcomePlaceholderPanel,
    resolveWorkspaceGroup: state.resolveWorkspaceGroup,
    resolveControlPanelId: state.resolveControlPanelId,
    workspaceGroupSummaryForControl: state.workspaceGroupSummaryForControl,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl
  })

  const paneControlHandlers = createTerminalControlSurfacePaneHandlers({
    workspace,
    terminalViews,
    controlSurfaceTelemetry: state.controlSurfaceTelemetry,
    controlWorkspaceEnvironment: state.controlWorkspaceEnvironment,
    lastActiveControlPanelId: state.lastActiveControlPanelId,
    controlFlashingPanelIds: state.controlFlashingPanelIds,
    isWelcomePlaceholderPanel,
    resolveControlPanelId: state.resolveControlPanelId,
    resolveControlSourceSurfacePanel: state.resolveControlSourceSurfacePanel,
    resolveControlPanePanel: state.resolveControlPanePanel,
    panelMatchesControlId: state.panelMatchesControlId,
    panelRefForControl: state.panelRefForControl,
    controlPanelIndexFromValue: state.controlPanelIndexFromValue,
    cleanWorkspaceEnvironmentForControl: state.cleanWorkspaceEnvironmentForControl,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    surfaceTelemetrySummaryForControl: state.surfaceTelemetrySummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl,
    scheduleVisibleTerminalFit
  })

  const resumeControlHandlers = createTerminalControlSurfaceResumeHandlers({
    workspace,
    controlSurfaceResumeBindings: state.controlSurfaceResumeBindings,
    resolveControlSurfacePanel: state.resolveControlSurfacePanel,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    terminalSummaryForControl: state.terminalSummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl
  })

  const agentControlHandlers = createTerminalControlSurfaceAgentHandlers({
    workspace,
    visibleTerminalPanels,
    controlWorkspaceGroups: state.controlWorkspaceGroups,
    terminalViewSize,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    terminalSummaryForControl: state.terminalSummaryForControl,
    workspaceGroupSummaryForControl: state.workspaceGroupSummaryForControl,
    workspaceGroupPayload: groupControlHandlers.workspaceGroupPayload,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl,
    managedAiSessionSummaryForControl: state.managedAiSessionSummaryForControl
  })

  const projectFileControlHandlers = createTerminalControlSurfaceProjectFileHandlers({
    workspace,
    terminalViews,
    controlProjectStates: state.controlProjectStates,
    resolveControlSourceSurfacePanel: state.resolveControlSourceSurfacePanel,
    panelRefForControl: state.panelRefForControl,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl
  })

  const workspaceControlHandlers = createTerminalControlSurfaceWorkspaceHandlers({
    workspace,
    controlWorkspaceEnvironment: state.controlWorkspaceEnvironment,
    resolveControlSelectablePanel: paneControlHandlers.resolveControlSelectablePanel,
    controlTargetValue: paneControlHandlers.controlTargetValue,
    surfaceSummaryForControl: state.surfaceSummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl
  })

  const { handleControlRequest } = createTerminalControlSurfaceDispatcher({
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
    terminalSummaryForControl: state.terminalSummaryForControl,
    workspaceSnapshotForControl: state.workspaceSnapshotForControl
  })

  const dispose = () => {
    paneControlHandlers.dispose()
  }

  return {
    controlFlashingPanelIds: state.controlFlashingPanelIds,
    handleControlRequest,
    recordLastActiveControlPanel: state.recordLastActiveControlPanel,
    dispose
  }
}
