import { nextTick } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  terminalControlBufferText,
  type ControlSurfaceTelemetryState,
  type ControlWorkspaceEnvironmentState,
  type TerminalControlSurfaceView,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import {
  createTerminalControlSurfaceOperationHandlers,
  normalizePaneLayoutDirection
} from '@/services/terminal/terminalControlSurfacePaneOperations'
import type {
  ControlResponse,
  ControlSurfaceSummary,
  ControlSurfaceTelemetrySummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'
import type { TerminalFocusReason } from '@/services/terminal/terminalWorkspaceViewRuntime'

type TerminalControlSurfacePaneDependencies = {
  workspace: WorkspaceStore
  terminalViews: Map<string, TerminalControlSurfaceView>
  controlSurfaceTelemetry: { value: Record<string, ControlSurfaceTelemetryState> }
  controlWorkspaceEnvironment: { value: ControlWorkspaceEnvironmentState }
  lastActiveControlPanelId: { value: string }
  controlFlashingPanelIds: { value: string[] }
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  resolveControlPanelId: (value: unknown) => string
  resolveControlSourceSurfacePanel: (params?: Record<string, unknown>) => TerminalPanel | null
  resolveControlPanePanel: (params?: Record<string, unknown>, keyPrefix?: string) => TerminalPanel | null
  panelMatchesControlId: (panel: TerminalPanel, id: string) => boolean
  panelRefForControl: (panelId: string) => string
  controlPanelIndexFromValue: (value: unknown) => number | null
  cleanWorkspaceEnvironmentForControl: (value: unknown) => Record<string, string>
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  surfaceTelemetrySummaryForControl: (state?: ControlSurfaceTelemetryState) => ControlSurfaceTelemetrySummary | undefined
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
  scheduleVisibleTerminalFit: (options?: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean }) => void
  focusTerminalPanel?: (panelId: string, reason: TerminalFocusReason) => void
}

export const createTerminalControlSurfacePaneHandlers = ({
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
  scheduleVisibleTerminalFit,
  focusTerminalPanel
}: TerminalControlSurfacePaneDependencies) => {
  const requestExternalTerminalFocus = (panelId: string) => {
    if (focusTerminalPanel) focusTerminalPanel(panelId, 'external-request')
    else terminalViews.get(panelId)?.terminal.focus()
  }
  const paneLayoutPayload = (panel?: TerminalPanel | null, targetPanel?: TerminalPanel | null, extra: Record<string, unknown> = {}) =>
    controlOk({
      ...(panel ? { pane: surfaceSummaryForControl(panel), surface: surfaceSummaryForControl(panel), surfaceId: panel.id, surface_id: panel.id } : {}),
      ...(targetPanel
        ? { targetPane: surfaceSummaryForControl(targetPanel), targetSurface: surfaceSummaryForControl(targetPanel), targetPaneId: targetPanel.id, target_pane_id: targetPanel.id }
        : {}),
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

  const selectableControlPanels = () => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel))

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

  const operationHandlers = createTerminalControlSurfaceOperationHandlers({
    workspace,
    terminalViews,
    controlSurfaceTelemetry,
    controlFlashingPanelIds,
    isWelcomePlaceholderPanel,
    resolveControlPanelId,
    resolveControlSourceSurfacePanel,
    resolveControlPanePanel,
    panelMatchesControlId,
    panelRefForControl,
    controlPanelIndexFromValue,
    resolveControlSelectablePanel,
    controlTargetValue,
    surfaceSummaryForControl,
    surfaceTelemetrySummaryForControl,
    workspaceSnapshotForControl,
    scheduleVisibleTerminalFit,
    focusTerminalPanel
  })

  const focusControlPanel = async (panel: TerminalPanel, action: string) => {
    const previousActivePanelId = workspace.activePanelId
    workspace.activatePanelSurface(panel.id, { cause: 'external' })
    await nextTick()
    if (isTerminalWorkspacePanel(panel)) requestExternalTerminalFocus(panel.id)
    return selectedPanePayload(panel, action, previousActivePanelId)
  }

  const focusControlPanelByOffset = async (offset: number, action: string) => {
    const panels = selectableControlPanels()
    if (!panels.length) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
    const activeIndex = Math.max(0, panels.findIndex((panel) => panel.id === workspace.activePanelId))
    const nextIndex = (activeIndex + offset + panels.length) % panels.length
    return focusControlPanel(panels[nextIndex], action)
  }

  const handlePaneNavigationControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
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
            surfaceKind: panel.kind === 'knowledge' ? 'knowledge' : panel.kind === 'managed-ai-session' ? 'managed-ai-session' : 'terminal',
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

  const handlePaneManagementControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    if (method === 'workspace.close_idle') {
      const result = await workspace.closeIdlePanels()
      const data = { idleCleanup: result, ...result }
      if (!result.ok) {
        return controlFail('WORKSPACE_IDLE_CLEANUP_PARTIAL', 'Some idle windows could not be closed.', data)
      }
      return controlOk(data)
    }
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
      const panel = workspace.createPanel({ activation: 'preserve' })
      const title = controlText(params.title || params.name)
      if (title) workspace.renamePanel(panel.id, title)
      const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
      if (cwd) panel.cwd = cwd
      const workspaceEnv = cleanWorkspaceEnvironmentForControl(params.workspace_env || params.workspaceEnv)
      if (Object.keys(workspaceEnv).length) {
        controlWorkspaceEnvironment.value = { env: workspaceEnv, updatedAt: Date.now() }
      }
      if (focus) workspace.activatePanelSurface(panel.id, { cause: 'external' })
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
      const panel = workspace.createPanel({ anchorPanelId: pane?.id, activation: 'preserve' })
      const title = controlText(params.title || params.name)
      if (title) workspace.renamePanel(panel.id, title)
      const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
      if (cwd) panel.cwd = cwd
      if (focus) workspace.activatePanelSurface(panel.id, { cause: 'external' })
      await nextTick()
      if (focus) requestExternalTerminalFocus(panel.id)
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
      const focus = controlBool(params.focus, true)
      const panel = workspace.createPanel({
        split: normalizePaneLayoutDirection(params.direction || params.split),
        anchorPanelId: target.id,
        activation: 'preserve'
      })
      const title = controlText(params.title || params.name)
      if (title) workspace.renamePanel(panel.id, title)
      const cwd = controlText(params.cwd || params.workingDirectory || params.working_directory)
      if (cwd) panel.cwd = cwd
      if (focus) workspace.activatePanelSurface(panel.id, { cause: 'external' })
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
      const result = await workspace.closePanel(panel.id)
      if (!result.closed) return controlFail('PANE_CLOSE_FAILED', 'Terminal could not be closed.', { panelId: panel.id, terminalStatus: result.terminalStatus })
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

  const handlePaneLayoutControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
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
      const focus = controlBool(params.focus, false)
      const changed = workspace.unsplitPanel(panel.id, { activation: 'preserve' })
      if (focus) workspace.activatePanelSurface(panel.id, { cause: 'external' })
      await nextTick()
      if (focus) requestExternalTerminalFocus(panel.id)
      return paneLayoutPayload(panel, null, { changed, broken: changed })
    }

    if (method === 'pane.join') {
      const panel = resolveControlPanePanel(params)
      const targetPanel = resolveControlPanePanel(params, 'target')
      if (!panel) return controlFail('PANE_NOT_FOUND', 'Pane not found.')
      if (!targetPanel) return controlFail('TARGET_PANE_NOT_FOUND', 'Target pane not found.')
      if (panel.id === targetPanel.id) return controlFail('PANE_TARGET_INVALID', 'Source and target panes must be different.')
      const focus = controlBool(params.focus, false)
      const changed = workspace.attachPanelToSplit(
        panel.id,
        targetPanel.id,
        normalizePaneLayoutDirection(params.direction || params.split),
        { activation: 'preserve' }
      )
      if (focus) workspace.activatePanelSurface(panel.id, { cause: 'external' })
      await nextTick()
      if (focus) requestExternalTerminalFocus(panel.id)
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
      workspace.swapPanelPositions(panel.id, targetPanel.id)
      if (controlBool(params.focus, false)) {
        workspace.activatePanelSurface(targetPanel.id, { cause: 'external' })
      }
      await nextTick()
      if (controlBool(params.focus, false)) requestExternalTerminalFocus(workspace.activePanelId)
      return paneLayoutPayload(panel, targetPanel, { changed: true, swapped: true })
    }

    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  return {
    resolveControlSelectablePanel,
    controlTargetValue,
    handleWorkspaceActionControlRequest: operationHandlers.handleWorkspaceActionControlRequest,
    handlePaneNavigationControlRequest,
    handlePaneManagementControlRequest,
    handlePaneLayoutControlRequest,
    handleSurfaceOperationsControlRequest: operationHandlers.handleSurfaceOperationsControlRequest,
    dispose: operationHandlers.dispose
  }
}
