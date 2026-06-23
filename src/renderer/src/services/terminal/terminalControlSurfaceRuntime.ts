import { createTerminalControlSurfaceAgentHandlers } from '@/services/terminal/terminalControlSurfaceAgents'
import { createTerminalControlSurfaceDispatcher } from '@/services/terminal/terminalControlSurfaceDispatcher'
import { createTerminalControlSurfaceGroupHandlers } from '@/services/terminal/terminalControlSurfaceGroups'
import { createTerminalControlSurfaceMobileHandlers } from '@/services/terminal/terminalControlSurfaceMobile'
import { createTerminalControlSurfacePaneHandlers } from '@/services/terminal/terminalControlSurfacePanes'
import { createTerminalControlSurfaceProjectFileHandlers } from '@/services/terminal/terminalControlSurfaceProjectFiles'
import { createTerminalControlSurfaceRemoteHandlers } from '@/services/terminal/terminalControlSurfaceRemote'
import { createTerminalControlSurfaceResumeHandlers } from '@/services/terminal/terminalControlSurfaceResume'
import { createTerminalControlSurfaceSessionHandlers } from '@/services/terminal/terminalControlSurfaceSessions'
import { createTerminalControlSurfaceState } from '@/services/terminal/terminalControlSurfaceState'
import { createTerminalControlSurfaceWorkspaceHandlers } from '@/services/terminal/terminalControlSurfaceWorkspace'
import type {
  TerminalControlSurfaceDependencies,
  TerminalControlSurfaceView
} from '@/services/terminal/terminalControlSurfaceCore'

export type {
  TerminalControlSurfaceDependencies,
  TerminalControlSurfaceView
} from '@/services/terminal/terminalControlSurfaceCore'

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
