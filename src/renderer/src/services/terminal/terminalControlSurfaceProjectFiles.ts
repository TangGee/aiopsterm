import { nextTick } from 'vue'
import type { TerminalPanel } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlBool,
  controlFail,
  controlNumber,
  controlOk,
  controlText,
  type ControlProjectState,
  type TerminalControlSurfaceView,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type { ControlSurfaceSummary, ControlWorkspaceSnapshot } from '@shared/contracts/control'
import type { TerminalFocusReason } from '@/services/terminal/terminalWorkspaceViewRuntime'

type TerminalControlSurfaceProjectFileDependencies = {
  workspace: WorkspaceStore
  terminalViews: Map<string, TerminalControlSurfaceView>
  controlProjectStates: { value: Record<string, ControlProjectState> }
  resolveControlSourceSurfacePanel: (params?: Record<string, unknown>) => TerminalPanel | null
  panelRefForControl: (panelId: string) => string
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
  focusTerminalPanel?: (panelId: string, reason: TerminalFocusReason) => void
}

export const createTerminalControlSurfaceProjectFileHandlers = ({
  workspace,
  terminalViews,
  controlProjectStates,
  resolveControlSourceSurfacePanel,
  panelRefForControl,
  surfaceSummaryForControl,
  workspaceSnapshotForControl,
  focusTerminalPanel
}: TerminalControlSurfaceProjectFileDependencies) => {
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
    workspace.activatePanelSurface(panel.id, {
      cause: 'external',
      focusPolicy: requestedFocus ? 'target-primary' : 'preserve'
    })
    await nextTick()
    if (requestedFocus && isTerminalWorkspacePanel(panel)) {
      if (focusTerminalPanel) focusTerminalPanel(panel.id, 'external-request')
      else terminalViews.get(panel.id)?.terminal.focus()
    }
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
    const focus = controlBool(params.focus, true)
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
      const panel = workspace.openKnowledgeFile(relPath, controlKnowledgeOpenRange(params), { activation: 'preserve' })
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
    if (focus) await focusControlSurfacePanel(primary, false)
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

  const openControlLocalEditorFiles = async (params: Record<string, unknown>) => {
    const paths = controlFileOpenRawPaths(params)
    if (!paths.length) return controlFail('FILE_PATH_REQUIRED', 'file.editor.open requires at least one path.')
    const sourcePanel = resolveControlSourceSurfacePanel(params)
    const focus = controlBool(params.focus, true)
    const openedPanels = paths
      .map((filePath) => workspace.openLocalFile(filePath, { activation: 'preserve' }))
      .filter((panel): panel is TerminalPanel => Boolean(panel))
    const primary = openedPanels[openedPanels.length - 1] || null
    if (!primary) return controlFail('LOCAL_FILE_OPEN_FAILED', 'Local files could not be opened.', { paths })
    if (focus) await focusControlSurfacePanel(primary, false)
    const surfaces = openedPanels.map((panel) => surfaceSummaryForControl(panel))
    return controlOk({
      opened: true,
      path: primary.localFile?.filePath || '',
      paths: openedPanels.map((panel) => panel.localFile?.filePath || ''),
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
    if (method === 'file.editor.open') return openControlLocalEditorFiles(params)
    if (method === 'markdown.open' || method === 'file.open') return openControlKnowledgeFiles(params, method)

    if (method === 'project.open') {
      const rawPath = controlText(params.path || params.projectPath || params.project_path)
      if (!rawPath) return controlFail('PROJECT_PATH_REQUIRED', 'project.open requires a path.')
      const existingFile = await findControlKnowledgeNode(normalizeControlKnowledgePath(rawPath))
      const focus = controlBool(params.focus, true)
      let panel: TerminalPanel | null = null
      if (existingFile?.type === 'file') {
        panel = workspace.openKnowledgeFile(existingFile.relPath, undefined, { activation: 'preserve' })
      } else {
        panel = resolveControlSourceSurfacePanel(params)
        if (!panel || !isTerminalWorkspacePanel(panel)) panel = workspace.createPanel({ activation: 'preserve' })
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
      if (focus) await focusControlSurfacePanel(panel, false)
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

  return { handleProjectFileControlRequest }
}
