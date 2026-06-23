import { nextTick } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import {
  controlBool,
  controlFail,
  controlOk,
  controlText,
  type ControlSurfaceTelemetryState,
  type TerminalControlSurfaceView,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type {
  ControlResponse,
  ControlSurfaceSummary,
  ControlSurfaceTelemetrySummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

type TerminalControlSurfaceOperationDependencies = {
  workspace: WorkspaceStore
  terminalViews: Map<string, TerminalControlSurfaceView>
  controlSurfaceTelemetry: { value: Record<string, ControlSurfaceTelemetryState> }
  controlFlashingPanelIds: { value: string[] }
  isWelcomePlaceholderPanel: (panel?: TerminalPanel | null) => boolean
  resolveControlPanelId: (value: unknown) => string
  resolveControlSourceSurfacePanel: (params?: Record<string, unknown>) => TerminalPanel | null
  resolveControlPanePanel: (params?: Record<string, unknown>, keyPrefix?: string) => TerminalPanel | null
  panelMatchesControlId: (panel: TerminalPanel, id: string) => boolean
  panelRefForControl: (panelId: string) => string
  controlPanelIndexFromValue: (value: unknown) => number | null
  resolveControlSelectablePanel: (value: unknown) => TerminalPanel | null
  controlTargetValue: (params: Record<string, unknown>) => unknown
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  surfaceTelemetrySummaryForControl: (state?: ControlSurfaceTelemetryState) => ControlSurfaceTelemetrySummary | undefined
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
  scheduleVisibleTerminalFit: (options?: { scrollToBottom?: boolean; frames?: number; forceGeometry?: boolean }) => void
}

export const normalizePaneLayoutDirection = (value: unknown) => {
  const direction = controlText(value).toLowerCase()
  if (direction === 'below' || direction === 'down' || direction === 'vertical') return 'below'
  return 'right'
}

export const createTerminalControlSurfaceOperationHandlers = ({
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
  scheduleVisibleTerminalFit
}: TerminalControlSurfaceOperationDependencies) => {
  let controlFlashTimer: number | null = null

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

  const selectableControlPanels = () => workspace.panels.filter((panel) => !isWelcomePlaceholderPanel(panel))

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

  const handleWorkspaceActionControlRequest = async (params: Record<string, unknown>): Promise<ControlResponse> => {
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

  const handleSurfaceOperationsControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
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

  const dispose = () => {
    if (controlFlashTimer) {
      window.clearTimeout(controlFlashTimer)
      controlFlashTimer = null
    }
  }

  return {
    handleWorkspaceActionControlRequest,
    handleSurfaceOperationsControlRequest,
    dispose
  }
}
