import { nextTick } from 'vue'
import type { SettingSectionKey } from '@/config/settings'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlBool,
  controlFail,
  controlOk,
  controlText,
  type ControlWorkspaceEnvironmentState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type {
  ControlNotificationFocusRequest,
  ControlNotificationRecord,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'
import type { UserConfig } from '@shared/contracts/userConfig'

type TerminalControlSurfaceWorkspaceDependencies = {
  workspace: WorkspaceStore
  controlWorkspaceEnvironment: { value: ControlWorkspaceEnvironmentState }
  resolveControlSelectablePanel: (value: unknown) => { id: string; titleSource?: string } | null
  controlTargetValue: (params: Record<string, unknown>) => unknown
  surfaceSummaryForControl: (panel: any) => Record<string, unknown>
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
}

const controlSettingsTargetAliases: Record<string, SettingSectionKey> = {
  account: 'billing',
  accounts: 'billing',
  agent: 'aiNotifications',
  agents: 'aiNotifications',
  ai: 'aiRemoteHostManagement',
  'ai-hooks': 'aiNotifications',
  'ai-preferences': 'aiRemoteHostManagement',
  'ai-remote-host-management': 'aiRemoteHostManagement',
  aihooks: 'aiNotifications',
  ainotifications: 'aiNotifications',
  'ai-notifications': 'aiNotifications',
  airemotehostmanagement: 'aiRemoteHostManagement',
  billing: 'billing',
  docs: 'docs',
  documentation: 'docs',
  extensions: 'extensions',
  extension: 'extensions',
  general: 'general',
  hooks: 'aiNotifications',
  keyboard: 'shortcuts',
  keybindings: 'shortcuts',
  mcp: 'mcp',
  exportmcp: 'exportMcp',
  'export-mcp': 'exportMcp',
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

const invalidSettingPathSegments = new Set(['__proto__', 'prototype', 'constructor'])

const settingsPathSegments = (path: unknown) =>
  controlText(path)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)

const isValidSettingsPath = (segments: string[]) =>
  Boolean(segments.length) &&
  segments.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment) && !invalidSettingPathSegments.has(segment))

const readSettingsPathValue = (source: unknown, segments: string[]) => {
  let current = source as Record<string, unknown> | undefined
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = current[segment] as Record<string, unknown> | undefined
  }
  return current as unknown
}

const settingsPatchFromPath = (segments: string[], value: unknown) => {
  const root: Record<string, unknown> = {}
  let current = root
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    current[segment] = {}
    current = current[segment] as Record<string, unknown>
  })
  return root as Partial<UserConfig>
}

export const createTerminalControlSurfaceWorkspaceHandlers = ({
  workspace,
  controlWorkspaceEnvironment,
  resolveControlSelectablePanel,
  controlTargetValue,
  surfaceSummaryForControl,
  workspaceSnapshotForControl
}: TerminalControlSurfaceWorkspaceDependencies) => {
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
      current_directory: isTerminalWorkspacePanel(workspace.activePanel) ? workspace.activePanel.cwd : '',
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

  const handleSettingsOpenControlRequest = async (params: Record<string, unknown>) => {
    const requestedTarget = controlText(params.target || params.section || params.page || 'general') || 'general'
    const section = resolveControlSettingsSection(requestedTarget)
    if (!section) return controlFail('SETTINGS_TARGET_INVALID', 'Unknown settings target.', { target: requestedTarget })
    workspace.setWorkspaceMode('terminal')
    workspace.setActiveModule('settings')
    workspace.setLeftPanelOpen(true)
    workspace.setRightPanelOpen(false)
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

  const handleSettingsValueControlRequest = async (method: string, params: Record<string, unknown>) => {
    const path = controlText(params.path || params.key)
    const segments = settingsPathSegments(path)
    if (!isValidSettingsPath(segments)) return controlFail('SETTINGS_PATH_INVALID', 'Settings path must use dot-separated config keys.', { path })
    if (method === 'settings.get') {
      const value = readSettingsPathValue(workspace.config, segments)
      return controlOk({
        setting: {
          path,
          value
        },
        raw: controlBool(params.raw, false)
      })
    }
    if (method === 'settings.put') {
      await workspace.saveConfig(settingsPatchFromPath(segments, params.value))
      const value = readSettingsPathValue(workspace.config, segments)
      return controlOk({
        saved: true,
        setting: {
          path,
          value
        }
      })
    }
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  const handleFeedbackOpenControlRequest = async () => {
    const opened = await workspace.openSettingsExternalAction('反馈页面')
    return controlOk({
      opened,
      unsupported: !opened,
      ...(opened ? {} : { unsupportedReason: 'Feedback report bridge is unavailable or failed.' })
    })
  }

  const handleExtensionSidebarSnapshotControlRequest = (params: Record<string, unknown>) => {
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

  const handleNotificationControlRequest = (method: string, params: Record<string, unknown>) => {
    if (method === 'notification.sync') {
      const notifications = Array.isArray(params.notifications) ? (params.notifications as ControlNotificationRecord[]) : []
      workspace.applyControlNotificationSnapshot(notifications)
      return controlOk({ count: notifications.length })
    }
    if (method === 'notification.open') {
      const focusRequest = params as ControlNotificationFocusRequest
      if (!focusRequest.notification) return controlFail('NOTIFICATION_PAYLOAD_INVALID', 'Notification focus payload is invalid.')
      const focused = workspace.focusControlNotification(focusRequest)
      return controlOk({ focused })
    }
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  return {
    handleExtensionSidebarSnapshotControlRequest,
    handleFeedbackOpenControlRequest,
    handleNotificationControlRequest,
    handleSettingsOpenControlRequest,
    handleSettingsValueControlRequest,
    handleWorkspaceMetadataControlRequest
  }
}
