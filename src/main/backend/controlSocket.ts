import { createServer, type Server, type Socket } from 'net'
import { randomBytes, randomUUID } from 'crypto'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir, readdir, readFile } from 'fs/promises'
import { freemem, loadavg, totalmem, uptime } from 'os'
import type { BrowserWindow, IpcMain } from 'electron'
import { sendWindowEvent } from '@shared/windowEvents'
import type {
  ControlNotificationRecord,
  ControlRequest,
  ControlResponse,
  ControlTerminalSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'
import type { AgentHookInstallerSource } from '@shared/contracts/agentHooks'
import type { AiAgentSessionSource, ManagedAiSessionBulkOperation, ManagedAiSessionDecisionKind, ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'
import {
  bulkManagedAiSessions,
  clearManagedAiSession,
  configureAiAgentSessionStore,
  listManagedAiSessions,
  publishAiAgentSessionEvent,
  renameManagedAiSession,
  replyManagedAiSession
} from './agentSessions'
import { installAgentHook, listAgentHookInstallers, uninstallAgentHook } from './agentHookInstaller'
import {
  agentVaultPathFor,
  configureAgentVaultRuntime,
  handleAgentVaultControlRequest,
  loadAgentVaultStore,
  prepareAgentVaultTeamLaunchParams,
  resetAgentVaultRuntimeState,
  sortedAgentVaultEntries
} from './controlSocketAgentVault'
import {
  configureControlSocketTerminalTools,
  handleTerminalBufferControlRequest,
  handleTmuxCompatControlRequest,
  listTerminalBuffers,
  listTmuxCompatHooks,
  resetControlSocketTerminalTools,
  sendTerminalKey,
  sendTerminalText,
  terminalPanelId
} from './controlSocketTerminalTools'
import {
  clearNotifications,
  closeControlSocketStateRuntime,
  configureControlSocketStateRuntime,
  controlSocketEventLogPathFor as eventLogPathFor,
  controlSocketSessionSnapshotPathFor as sessionSnapshotPathFor,
  controlSocketStateSummary,
  createCallerNotification,
  createNotification,
  createTargetedNotification,
  dismissNotification,
  eventSubscriptionCountForTesting,
  handleMobileEventsControlRequest,
  handleSessionControlRequest,
  handleSidebarMetadataControlRequest,
  handleWaitForControlRequest,
  isControlEventListMethod as isEventListMethod,
  isControlEventStreamMethod as isEventStreamMethod,
  isControlMobileEventsMethod as isMobileEventsMethod,
  isControlSessionMethod as isSessionMethod,
  isControlSidebarMetadataMethod as isSidebarMetadataMethod,
  isControlWaitForMethod as isWaitForMethod,
  jumpToUnreadNotification,
  listEvents,
  listEventsForTesting,
  listMobileEventSubscriptionsForTesting,
  listNotifications,
  listNotificationsForTesting,
  listSessionSnapshotsForTesting,
  loadControlSessionSnapshotStore as loadSessionSnapshotStore,
  loadControlSocketDurableEventLog as loadDurableEventLog,
  markNotificationRead,
  mobileEventSubscriptionCountForTesting,
  openNotification,
  publishControlEvent,
  startEventStream
} from './controlSocketStateRuntime'

type ControlSocketRequest = {
  id?: string
  method?: string
  params?: Record<string, unknown>
}

type ControlSocketRuntime = {
  userDataPath?: string
  getWindows?: () => BrowserWindow[]
  focusWindow?: (window?: BrowserWindow) => BrowserWindow | null
  getDisplays?: () => Array<{
    id?: number
    label?: string
    bounds?: { x: number; y: number; width: number; height: number }
    workArea?: { x: number; y: number; width: number; height: number }
  }>
  writeTerminal?: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
  showNotification?: (notification: ControlNotificationRecord) => void
}

type PendingRendererRequest = {
  resolve: (response: ControlResponse) => void
  timer: NodeJS.Timeout
}

const defaultTimeoutMs = 5000
const maxTimeoutMs = 30000
const controlSocketCapabilities = [
  'ping',
  'system.ping',
  'system.capabilities',
  'system.identify',
  'system.tree',
  'system.top',
  'system.memory',
  'auth.login',
  'auth.status',
  'auth.sign_in_url',
  'auth.begin_sign_in',
  'auth.sign_out',
  'vm.compat',
  'remotes.compat',
  'sidebar.custom',
  'settings.open',
  'feedback.open',
  'feedback.submit',
  'extension.sidebar.snapshot',
  'window.control',
  'app.focus',
  'project.compat',
  'file.open',
  'markdown.open',
  'workspace.snapshot',
  'workspace.context',
  'workspace.list',
  'workspace.current',
  'workspace.env',
  'workspace.auto_title',
  'workspace.remote',
  'workspace.group',
  'session.restore',
  'surface.list',
  'surface.current',
  'surface.operations',
  'surface.telemetry',
  'surface.resume',
  'surface.create',
  'mobile.host',
  'mobile.workspace',
  'mobile.terminal',
  'mobile.chat',
  'mobile.attach_ticket',
  'terminal.list',
  'terminal.focus',
  'terminal.read_screen',
  'terminal.clear_history',
  'terminal.respawn',
  'pane.layout',
  'pane.navigation',
  'pane.create',
  'terminal.send_text',
  'terminal.send_key',
  'terminal.buffer',
  'tmux.compat',
  'remote.tmux.compat',
  'notification',
  'notification.targeted',
  'events.stream',
  'events.list',
  'mobile.events',
  'sync.wait_for',
  'sidebar.metadata',
  'agent.hibernation',
  'agent.team',
  'agent.vault',
  'agent.session',
  'agent.hooks',
  'feed'
]

let server: Server | null = null
let socketPath = ''
let runtime: ControlSocketRuntime = {}
const pendingRendererRequests = new Map<string, PendingRendererRequest>()
const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeTimeoutMs = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultTimeoutMs
  return Math.max(500, Math.min(maxTimeoutMs, Math.round(numberValue)))
}

const normalizeLimit = (value: unknown, fallback = 50) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(200, Math.floor(numberValue)))
}

const cleanTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  const text = cleanText(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const socketPathFor = (userDataPath: string) => {
  if (process.platform === 'win32') return `\\\\.\\pipe\\aiopsterm-control-${process.pid}`
  return join(userDataPath, 'control', `aiopsterm-control-${process.pid}.sock`)
}

const systemCapabilities = () =>
  ok({
    protocol: 'aiopsterm-control',
    version: 1,
    app: {
      name: 'aiopsterm',
      version: process.env.npm_package_version || '0.1.0'
    },
    process: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron
    },
    socketPath,
    capabilities: controlSocketCapabilities
  })

const systemIdentify = (params: Record<string, unknown> = {}) =>
  ok({
    protocol: 'aiopsterm-control',
    version: 1,
    app: {
      name: 'aiopsterm',
      version: process.env.npm_package_version || '0.1.0'
    },
    socketPath,
    process: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    },
    caller: params.caller && typeof params.caller === 'object' && !Array.isArray(params.caller) ? params.caller : {},
    focused: {},
    runtime: {
      userDataPath: runtime.userDataPath || '',
      windowCount: runtime.getWindows ? runtime.getWindows().filter((window) => !window.isDestroyed()).length : 0,
      ...controlSocketStateSummary()
    },
    capabilities: controlSocketCapabilities
  })

const isMobileChatMethod = (method: string) => method.startsWith('mobile.chat.') || method === 'chat.sessions.dump'

const isMobileAttachTicketMethod = (method: string) => method === 'mobile.attach_ticket.create'

const isAgentVaultMethod = (method: string) => method.startsWith('agent.vault.') || method.startsWith('agent-vault.')

const isAgentSessionMethod = (method: string) => method.startsWith('agent.session.') || method.startsWith('agent.sessions.') || method.startsWith('ai.session.')

const isAgentHooksMethod = (method: string) => method.startsWith('agent.hooks.') || method.startsWith('hooks.')

const isFeedMethod = (method: string) => method.startsWith('feed.')

const isCloudVmMethod = (method: string) => method.startsWith('vm.')

const isCloudRemotesMethod = (method: string) => method.startsWith('remotes.')

const isSidebarCustomMethod = (method: string) => method.startsWith('sidebar.custom.')

const isTerminalBufferMethod = (method: string) =>
  method.startsWith('terminal.buffer.') ||
  method.startsWith('buffer.') ||
  ['set-buffer', 'paste-buffer', 'list-buffers', 'show-buffer', 'showb', 'save-buffer', 'saveb'].includes(method)

const isTmuxCompatMethod = (method: string) =>
  method.startsWith('tmux.') ||
  [
    'set-hook',
    'show-hooks',
    'show-options',
    'show-option',
    'show',
    'set-option',
    'set',
    'set-window-option',
    'setw',
    'source-file',
    'refresh-client',
    'attach-session',
    'detach-client',
    'popup',
    'bind-key',
    'unbind-key',
    'copy-mode'
  ].includes(method)

const appWindows = () => runtime.getWindows?.().filter((window) => !window.isDestroyed()) || []

const windowNumericId = (window: BrowserWindow, index: number) => {
  const id = Number((window as unknown as { id?: number }).id)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : index + 1
}

const windowControlId = (window: BrowserWindow, index: number) => `window:${windowNumericId(window, index)}`

const normalizeWindowSelector = (value: unknown) => {
  const text = cleanText(value)
  if (!text) return ''
  return text.startsWith('window:') ? text.slice('window:'.length) : text
}

const resolveControlWindow = (params: Record<string, unknown> = {}) => {
  const windows = appWindows()
  const selector = normalizeWindowSelector(params.windowId || params.window_id || params.id || params.window)
  if (!selector) return activeWindow()
  return (
    windows.find((window, index) => {
      const numericId = String(windowNumericId(window, index))
      return selector === numericId || selector === String(index) || selector === String(index + 1) || selector === windowControlId(window, index)
    }) || null
  )
}

const windowSummary = (window: BrowserWindow, index: number) => {
  const id = windowControlId(window, index)
  const numericId = windowNumericId(window, index)
  const bounds = typeof window.getBounds === 'function' ? window.getBounds() : undefined
  return {
    id,
    windowId: id,
    window_id: id,
    electronId: numericId,
    electron_id: numericId,
    ref: id,
    index,
    key: window.isFocused(),
    focused: window.isFocused(),
    visible: typeof window.isVisible === 'function' ? window.isVisible() : true,
    minimized: typeof window.isMinimized === 'function' ? window.isMinimized() : false,
    workspaceCount: 1,
    workspace_count: 1,
    selectedWorkspaceId: 'main',
    selected_workspace_id: 'main',
    selectedWorkspaceRef: 'workspace:1',
    selected_workspace_ref: 'workspace:1',
    ...(bounds ? { bounds } : {})
  }
}

const handleWindowControlRequest = async (method: string, params: Record<string, unknown>) => {
  const windows = appWindows()
  if (method === 'window.list') {
    return ok({
      windows: windows.map(windowSummary),
      count: windows.length
    })
  }
  if (method === 'window.current') {
    const window = resolveControlWindow(params)
    if (!window) return fail('WINDOW_NOT_FOUND', 'Current window was not found.')
    const index = Math.max(0, windows.indexOf(window))
    const summary = windowSummary(window, index)
    return ok({
      window: summary,
      windowId: summary.windowId,
      window_id: summary.window_id,
      window_ref: summary.ref
    })
  }
  if (method === 'window.focus') {
    const window = resolveControlWindow(params)
    if (!window) return fail('WINDOW_NOT_FOUND', 'Window was not found.')
    runtime.focusWindow?.(window)
    const index = Math.max(0, windows.indexOf(window))
    const summary = windowSummary(window, index)
    publishControlEvent({
      name: 'window.focused',
      category: 'window',
      source: 'control.socket',
      payload: { window_id: summary.window_id, electron_id: summary.electron_id }
    })
    return ok({
      window: summary,
      windowId: summary.windowId,
      window_id: summary.window_id,
      window_ref: summary.ref,
      focused: true
    })
  }
  if (method === 'window.displays') {
    const displays = runtime.getDisplays?.() || []
    if (!displays.length) {
      return ok({
        displays: [],
        count: 0,
        unsupported: true,
        unsupportedReason: 'No display runtime is available for this aiopsterm control socket.'
      })
    }
    return ok({
      displays: displays.map((display, index) => ({
        name: cleanText(display.label) || `Display ${index + 1}`,
        index,
        displayId: display.id ?? null,
        display_id: display.id ?? null,
        main: index === 0,
        frame: display.bounds || null,
        bounds: display.bounds || null,
        workArea: display.workArea || null,
        work_area: display.workArea || null
      })),
      count: displays.length
    })
  }
  if (method === 'window.create') {
    return ok({
      created: false,
      unsupported: true,
      unsupportedReason: 'Creating native Electron windows through the control socket is not supported yet.'
    })
  }
  if (method === 'window.close') {
    const requestedWindowId = cleanText(params.windowId || params.window_id || params.id || params.window)
    return ok({
      windowId: requestedWindowId,
      window_id: requestedWindowId,
      closed: false,
      unsupported: true,
      unsupportedReason: 'Closing native Electron windows through the control socket is disabled to avoid closing user work unexpectedly.'
    })
  }
  if (method === 'window.display') {
    const requestedDisplay = cleanText(params.display || params.name || params.target)
    return ok({
      display: requestedDisplay,
      moved: [],
      changed: false,
      unsupported: true,
      unsupportedReason: 'Moving native Electron windows between displays through the control socket is not supported yet.'
    })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm window method: ${method}`)
}

const systemTreeFromSnapshot = (snapshot: Record<string, unknown>) => {
  const surfaces = Array.isArray(snapshot.surfaces) ? (snapshot.surfaces as Record<string, unknown>[]) : []
  const activePanelId = cleanText(snapshot.activePanelId)
  const windows = appWindows()
  const active = activeWindow()
  const window = active || windows[0] || null
  const windowIndex = window ? Math.max(0, windows.indexOf(window)) : 0
  const windowId = window ? windowControlId(window, windowIndex) : 'window:1'
  const paneNodes = surfaces.map((surface, index) => {
    const panelId = cleanText(surface.panelId || surface.id || surface.surfaceId || surface.surface_id) || `surface-${index + 1}`
    const surfaceNode = {
      id: panelId,
      ref: `surface:${index + 1}`,
      index,
      type: cleanText(surface.surfaceKind || surface.type || surface.kind) || 'terminal',
      title: cleanText(surface.title) || panelId,
      focused: panelId === activePanelId,
      selected: panelId === activePanelId,
      selected_in_pane: true,
      pane_id: panelId,
      pane_ref: `pane:${index + 1}`,
      index_in_pane: 0,
      tty: cleanText(surface.sessionId || surface.terminalSessionId) || null,
      url: null
    }
    return {
      id: panelId,
      ref: `pane:${index + 1}`,
      index,
      focused: panelId === activePanelId,
      surface_ids: [panelId],
      surface_refs: [surfaceNode.ref],
      selected_surface_id: panelId,
      selected_surface_ref: surfaceNode.ref,
      surface_count: 1,
      surfaces: [surfaceNode]
    }
  })
  const workspaceNode = {
    id: 'main',
    ref: 'workspace:1',
    index: 0,
    title: 'Main Workspace',
    description: null,
    selected: true,
    pinned: true,
    panes: paneNodes
  }
  return {
    active: {
      window_id: windowId,
      window_ref: windowId,
      workspace_id: 'main',
      workspace_ref: 'workspace:1',
      pane_id: activePanelId || null,
      surface_id: activePanelId || null
    },
    caller: null,
    windows: [
      {
        id: windowId,
        ref: windowId,
        index: windowIndex,
        key: true,
        visible: true,
        workspace_count: 1,
        selected_workspace_id: 'main',
        selected_workspace_ref: 'workspace:1',
        workspaces: [workspaceNode]
      }
    ]
  }
}

const boolParam = (value: unknown) => {
  if (typeof value === 'boolean') return value
  const text = cleanText(value).toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off'].includes(text)) return false
  return undefined
}

const intParam = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(numberValue) || Math.floor(numberValue) !== numberValue) return undefined
  return numberValue
}

const topGroupLimitParam = (params: Record<string, unknown>) => {
  const value = intParam(params.top_group_limit ?? params.topGroupLimit ?? params.group_limit ?? params.groupLimit)
  if (value === undefined) return { value: 12 }
  if (value < 1 || value > 100) return { error: fail('INVALID_PARAMS', 'top_group_limit must be an integer from 1 to 100.', { field: 'top_group_limit' }) }
  return { value }
}

const resourceSummary = (input: { pid?: number; memoryBytes?: number; residentBytes?: number; virtualBytes?: number; processCount?: number }) => {
  const pid = Number.isFinite(input.pid) && input.pid ? Math.floor(input.pid) : 0
  const pids = pid > 0 ? [pid] : []
  return {
    cpu_percent: 0,
    memory_bytes: Math.max(0, Math.floor(input.memoryBytes || 0)),
    resident_bytes: Math.max(0, Math.floor(input.residentBytes || input.memoryBytes || 0)),
    virtual_bytes: Math.max(0, Math.floor(input.virtualBytes || 0)),
    process_count: input.processCount ?? pids.length,
    pids,
    missing_pids: [],
    memory_source_fallback_pids: [],
    memory_source_fallback_count: 0,
    resident_memory_source_fallback_pids: [],
    resident_memory_source_fallback_count: 0,
    unavailable_memory_pids: [],
    unavailable_memory_count: 0,
    unavailable_resident_memory_pids: [],
    unavailable_resident_memory_count: 0
  }
}

const nodeProcessMemorySample = () => {
  const usage = process.memoryUsage()
  return {
    pid: process.pid,
    name: 'aiopsterm',
    executable: process.execPath,
    resources: resourceSummary({
      pid: process.pid,
      memoryBytes: usage.rss,
      residentBytes: usage.rss,
      virtualBytes: usage.heapTotal,
      processCount: 1
    }),
    memory: {
      rss_bytes: usage.rss,
      heap_total_bytes: usage.heapTotal,
      heap_used_bytes: usage.heapUsed,
      external_bytes: usage.external,
      array_buffers_bytes: usage.arrayBuffers
    }
  }
}

const systemTopSamplePayload = (includeProcesses: boolean) => ({
  sampled_at: new Date().toISOString(),
  source: 'node.process.memoryUsage+os',
  cpu_source: 'unavailable',
  memory_source: 'node.process.memoryUsage.rss',
  memory_fallback_source: 'node.process.memoryUsage.rss',
  resident_memory_source: 'node.process.memoryUsage.rss',
  resident_memory_sources: ['node.process.memoryUsage.rss'],
  resident_memory_fallback_source: 'node.process.memoryUsage.rss',
  process_details: includeProcesses,
  platform: process.platform,
  load_average: loadavg(),
  uptime_seconds: uptime()
})

const systemMemoryDiagnostic = (topGroupLimit = 12) => {
  const processSample = nodeProcessMemorySample()
  const memory = processSample.memory
  const totalBytes = totalmem()
  const freeBytes = freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const processGroup = {
    id: 'aiopsterm',
    name: 'aiopsterm',
    rss_bytes: memory.rss_bytes,
    resident_bytes: memory.rss_bytes,
    process_count: 1,
    pids: [process.pid],
    top_attribution: null,
    attributions: []
  }
  return {
    sampled_at: new Date().toISOString(),
    app: {
      pid: process.pid,
      name: 'aiopsterm',
      path: process.execPath,
      resources: processSample.resources,
      physical_footprint_bytes: memory.rss_bytes,
      resident_bytes: memory.rss_bytes,
      memory_source: 'node.process.memoryUsage.rss',
      resident_memory_source: 'node.process.memoryUsage.rss'
    },
    children: {
      root_pid: process.pid,
      recursive_rss_bytes: 0,
      process_count: 0,
      pids: [],
      groups: topGroupLimit > 0 ? [processGroup].slice(0, topGroupLimit) : []
    },
    system: {
      total_bytes: totalBytes,
      free_bytes: freeBytes,
      used_bytes: usedBytes
    },
    node: memory,
    summary: `aiopsterm RSS ${memory.rss_bytes} bytes; system memory ${usedBytes}/${totalBytes} bytes used`
  }
}

const codingAgentSummaries = async () => {
  try {
    const response = await listManagedAiSessions()
    const sessions = response.ok && Array.isArray(response.data?.sessions) ? (response.data.sessions as ManagedAiSessionRecord[]) : []
    const groups = new Map<string, { displayName: string; sessions: ManagedAiSessionRecord[]; pids: Set<number> }>()
    for (const session of sessions) {
      const key = session.source
      const existing = groups.get(key) || { displayName: key, sessions: [], pids: new Set<number>() }
      existing.sessions.push(session)
      for (const pid of [session.processId, session.terminalProcessId]) {
        if (typeof pid === 'number' && Number.isFinite(pid) && pid > 0) existing.pids.add(Math.floor(pid))
      }
      groups.set(key, existing)
    }
    return [...groups.entries()].map(([id, group]) => ({
      id,
      display_name: group.displayName,
      asset_name: id,
      resources: resourceSummary({
        pid: [...group.pids][0],
        processCount: group.pids.size || group.sessions.length
      }),
      session_count: group.sessions.length,
      sessions: group.sessions.map((session) => ({
        id: session.id,
        source: session.source,
        title: session.title,
        state: session.state,
        lifecycle: session.agentLifecycle || null,
        workspace_id: session.workspaceId || null,
        surface_id: session.panelId || null,
        terminal_session_id: session.terminalSessionId || null,
        cwd: session.cwd || null,
        last_activity_at: session.lastActivityAt
      }))
    }))
  } catch {
    return []
  }
}

const workspaceSnapshotOrNull = async (params: Record<string, unknown>) => {
  const response = await dispatchRendererControlRequest('workspace.snapshot', params)
  if (!response.ok) return { snapshot: null, warning: response }
  const snapshot = response.data?.snapshot && typeof response.data.snapshot === 'object' ? (response.data.snapshot as Record<string, unknown>) : null
  if (!snapshot) return { snapshot: null, warning: fail('SYSTEM_TOP_SNAPSHOT_INVALID', 'Renderer returned an invalid workspace snapshot.') }
  return { snapshot, warning: null }
}

const asWorkspaceSnapshot = (value: Record<string, unknown>): ControlWorkspaceSnapshot => value as unknown as ControlWorkspaceSnapshot

const targetFlagsForContext = (target: { panelId?: string; sessionId?: string; terminalSessionId?: string }) => ({
  ...(target.panelId ? { panelId: target.panelId, surfaceId: target.panelId } : {}),
  ...(target.sessionId || target.terminalSessionId ? { sessionId: target.sessionId || target.terminalSessionId, terminalSessionId: target.sessionId || target.terminalSessionId } : {})
})

const commandSuggestion = (label: string, command: string, method: string, params: Record<string, unknown> = {}) => ({
  label,
  command,
  rpc: { method, params }
})

const surfaceContextSummary = (surface: ControlWorkspaceSnapshot['surfaces'][number]) => ({
  panelId: surface.panelId,
  surfaceId: surface.panelId,
  title: surface.title,
  kind: surface.surfaceKind,
  active: surface.active,
  connected: surface.connected === true,
  ...(surface.sessionId ? { sessionId: surface.sessionId, terminalSessionId: surface.sessionId } : {}),
  ...(surface.terminalKind ? { terminalKind: surface.terminalKind } : {}),
  ...(surface.cwd ? { cwd: surface.cwd } : {}),
  ...(surface.splitGroupId ? { splitGroupId: surface.splitGroupId } : {}),
  ...(surface.knowledge ? { knowledge: surface.knowledge } : {})
})

const terminalContextSummary = (terminal: ControlTerminalSummary) => ({
  panelId: terminal.panelId,
  surfaceId: terminal.panelId,
  sessionId: terminal.sessionId,
  terminalSessionId: terminal.sessionId,
  title: terminal.title,
  kind: terminal.kind,
  active: terminal.active,
  connected: terminal.connected === true,
  ...(terminal.cwd ? { cwd: terminal.cwd } : {}),
  ...(terminal.shell ? { shell: terminal.shell } : {}),
  ...(terminal.kind === 'ssh' ? { ssh: { host: terminal.host, port: terminal.port, username: terminal.username, assetId: terminal.assetId, assetName: terminal.assetName } } : {}),
  ...(terminal.cols ? { columns: terminal.cols, cols: terminal.cols } : {}),
  ...(terminal.rows ? { rows: terminal.rows } : {})
})

const managedAiContextSummary = (session: ControlWorkspaceSnapshot['managedAiSessions'][number]) => ({
  id: session.id,
  sessionId: session.id,
  source: session.source,
  title: session.title,
  summary: session.summary,
  state: session.state,
  needsInput: session.needsInput,
  requestKind: session.requestKind,
  decisionMode: session.decisionMode,
  ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
  ...(session.panelId ? { panelId: session.panelId, surfaceId: session.panelId } : {}),
  ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
  ...(session.cwd ? { cwd: session.cwd } : {}),
  ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
  lastActivityAt: session.lastActivityAt
})

const workspaceContextPayload = async (params: Record<string, unknown>) => {
  const response = await dispatchRendererControlRequest('workspace.snapshot', params)
  if (!response.ok) return response
  const rawSnapshot = response.data?.snapshot && typeof response.data.snapshot === 'object' ? (response.data.snapshot as Record<string, unknown>) : null
  if (!rawSnapshot) return fail('WORKSPACE_CONTEXT_SNAPSHOT_INVALID', 'Renderer returned an invalid workspace snapshot.')
  const snapshot = asWorkspaceSnapshot(rawSnapshot)
  const activeSurface = snapshot.surfaces.find((surface) => surface.panelId === snapshot.activePanelId) || snapshot.surfaces.find((surface) => surface.active) || snapshot.surfaces[0] || null
  const activeTerminal =
    snapshot.terminals.find((terminal) => terminal.panelId === activeSurface?.panelId || terminal.sessionId === activeSurface?.sessionId) ||
    snapshot.terminals.find((terminal) => terminal.active) ||
    snapshot.terminals[0] ||
    null
  const writableTerminals = snapshot.terminals.filter((terminal) => terminal.connected === true)
  const pendingAiSessions = snapshot.managedAiSessions.filter((session) => session.needsInput || session.state === 'needsInput')
  const activeAiSessions = snapshot.managedAiSessions.filter((session) => session.panelId === activeSurface?.panelId || session.terminalSessionId === activeTerminal?.sessionId)
  const unreadNotifications = snapshot.notifications.filter((notification) => !notification.read)
  const suggestions = [
    activeTerminal
      ? commandSuggestion(
          'Read active terminal screen',
          `aiopsterm-control terminal read-screen --panel ${activeTerminal.panelId} --lines 80`,
          'terminal.read_screen',
          { panelId: activeTerminal.panelId, surfaceId: activeTerminal.panelId, sessionId: activeTerminal.sessionId, lines: 80, tailLines: 80 }
        )
      : null,
    activeTerminal
      ? commandSuggestion(
          'Send text to active terminal',
          `aiopsterm-control terminal send --panel ${activeTerminal.panelId} --text <text>`,
          'terminal.send_text',
          { panelId: activeTerminal.panelId, surfaceId: activeTerminal.panelId, sessionId: activeTerminal.sessionId, text: '<text>' }
        )
      : null,
    pendingAiSessions[0]
      ? commandSuggestion(
          'Open next pending AI session',
          `aiopsterm-control feed jump ${pendingAiSessions[0].pendingRequestId || pendingAiSessions[0].id}`,
          'feed.jump',
          { workstream_id: pendingAiSessions[0].pendingRequestId || pendingAiSessions[0].id, source: pendingAiSessions[0].source }
        )
      : null,
    unreadNotifications[0]
      ? commandSuggestion(
          'Open next unread notification',
          'aiopsterm-control jump-to-unread',
          'notification.jump_to_unread',
          {}
        )
      : null,
    commandSuggestion('List all surfaces', 'aiopsterm-control surface list', 'surface.list', {}),
    commandSuggestion('List managed AI sessions', 'aiopsterm-control agent session list --all', 'agent.session.list', {})
  ].filter(Boolean)
  return ok({
    generatedAt: Date.now(),
    workspace: snapshot.workspaces.find((workspace) => workspace.active) || snapshot.workspaces[0] || null,
    activeSurface: activeSurface ? surfaceContextSummary(activeSurface) : null,
    activeTerminal: activeTerminal ? terminalContextSummary(activeTerminal) : null,
    writableTerminals: writableTerminals.map(terminalContextSummary),
    pendingAiSessions: pendingAiSessions.map(managedAiContextSummary),
    activeAiSessions: activeAiSessions.map(managedAiContextSummary),
    unreadNotifications: unreadNotifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      subtitle: notification.subtitle,
      body: notification.body,
      source: notification.source,
      level: notification.level,
      group: notification.group,
      ...targetFlagsForContext({ panelId: notification.panelId, sessionId: notification.sessionId })
    })),
    attention: snapshot.attention,
    counts: {
      ...snapshot.counts,
      writableTerminals: writableTerminals.length,
      pendingAiSessions: pendingAiSessions.length,
      unreadNotifications: unreadNotifications.length
    },
    suggestions,
    snapshot: params.includeSnapshot === true || params.include_snapshot === true ? snapshot : undefined
  })
}

const systemTopPayload = async (params: Record<string, unknown>, options: { memoryOnly?: boolean } = {}) => {
  const includeProcesses = boolParam(params.include_processes ?? params.includeProcesses) ?? false
  const groupLimit = topGroupLimitParam(params)
  if (groupLimit.error) return groupLimit.error
  const { snapshot, warning } = await workspaceSnapshotOrNull(params)
  const tree = snapshot ? systemTreeFromSnapshot(snapshot) : { active: null, caller: null, windows: [] as unknown[] }
  const processSample = nodeProcessMemorySample()
  const memoryDiagnostic = systemMemoryDiagnostic(groupLimit.value)
  const payload = {
    active: tree.active,
    caller: tree.caller,
    sample: systemTopSamplePayload(includeProcesses),
    totals: processSample.resources,
    memory_diagnostic: memoryDiagnostic,
    program_totals: [
      {
        id: 'aiopsterm',
        name: 'aiopsterm',
        resources: processSample.resources
      }
    ],
    coding_agents: await codingAgentSummaries(),
    windows: tree.windows,
    compatibility: {
      source: 'aiopsterm',
      control_compat_shape: true,
      process_scope: 'aiopsterm-main-process',
      renderer_snapshot_available: Boolean(snapshot)
    },
    ...(snapshot ? { snapshot } : {}),
    ...(warning ? { warning: { ok: warning.ok, errorCode: warning.errorCode, errorMessage: warning.errorMessage } } : {})
  }
  if (options.memoryOnly) {
    return ok({
      active: payload.active,
      caller: payload.caller,
      sample: payload.sample,
      memory_diagnostic: payload.memory_diagnostic,
      windows: payload.windows,
      compatibility: payload.compatibility,
      ...(payload.snapshot ? { snapshot: payload.snapshot } : {}),
      ...(payload.warning ? { warning: payload.warning } : {})
    })
  }
  return ok(payload)
}

const authStatusPayload = () => ({
  signed_in: false,
  is_restoring_session: false,
  is_loading: false,
  timed_out: false,
  configured: false,
  local_control_socket: true,
  unsupported: true,
  unsupported_reason: 'aiopsterm does not use control_compat Stack Auth for the local control socket.'
})

const unsupportedAuthStatusPayload = (action: 'begin_sign_in' | 'sign_out') => ({
  ...authStatusPayload(),
  action,
  completed: false,
  unsupported_reason:
    action === 'begin_sign_in'
      ? 'aiopsterm does not use control_compat Stack Auth for the local control socket.'
      : 'aiopsterm has no control_compat Stack Auth session to sign out from.'
})

const feedbackSubmitPayload = (params: Record<string, unknown>) => {
  const email = cleanText(params.email)
  const body = cleanText(params.body || params.message || params.text)
  if (!email) return fail('INVALID_PARAMS', 'Missing email.', { field: 'email' })
  if (!body) return fail('INVALID_PARAMS', 'Missing body.', { field: 'body' })
  const imagePaths = Array.isArray(params.image_paths)
    ? params.image_paths.map(cleanText).filter(Boolean)
    : Array.isArray(params.imagePaths)
      ? params.imagePaths.map(cleanText).filter(Boolean)
      : []
  return ok({
    submitted: false,
    accepted: true,
    local_only: true,
    unsupported: true,
    unsupported_reason: 'aiopsterm accepted the feedback payload locally but has no configured feedback submission service.',
    email,
    body_length: body.length,
    attachment_count: imagePaths.length
  })
}

const cloudUnsupportedData = (method: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  unsupported: true,
  unsupportedReason: 'aiopsterm does not implement control_compat Cloud VM or remote device registry services.',
  unsupported_reason: 'aiopsterm does not implement control_compat Cloud VM or remote device registry services.',
  method
})

const handleCloudVmControlRequest = (method: string, params: Record<string, unknown>) => {
  if (method === 'vm.list') {
    return ok(cloudUnsupportedData(method, { vms: [], count: 0 }))
  }
  if (method === 'vm.create') {
    const idempotencyKey = cleanText(params.idempotency_key || params.idempotencyKey)
    if (!idempotencyKey) return fail('INVALID_PARAMS', 'vm.create requires `idempotency_key`.', { field: 'idempotency_key' })
    return ok(
      cloudUnsupportedData(method, {
        created: false,
        provider: cleanText(params.provider),
        image: cleanText(params.image),
        idempotency_key: idempotencyKey
      })
    )
  }
  if (method === 'vm.destroy') {
    const id = cleanText(params.id || params.vmId || params.vm_id)
    if (!id) return fail('INVALID_PARAMS', 'vm.destroy requires `id`.', { field: 'id' })
    return ok(cloudUnsupportedData(method, { id, destroyed: false }))
  }
  if (method === 'vm.exec') {
    const id = cleanText(params.id || params.vmId || params.vm_id)
    if (!id) return fail('INVALID_PARAMS', 'vm.exec requires `id`.', { field: 'id' })
    const command = cleanText(params.command)
    if (!command) return fail('INVALID_PARAMS', 'vm.exec requires `command`.', { field: 'command' })
    return ok(cloudUnsupportedData(method, { id, command, exit_code: null, stdout: '', stderr: '', executed: false }))
  }
  if (method === 'vm.ssh_info' || method === 'vm.attach_info') {
    const id = cleanText(params.id || params.vmId || params.vm_id)
    if (!id) return fail('INVALID_PARAMS', `${method} requires \`id\`.`, { field: 'id' })
    return ok(
      cloudUnsupportedData(method, {
        id,
        host: null,
        port: null,
        token: null,
        attach_url: null,
        require_daemon: boolParam(params.require_daemon ?? params.requireDaemon) ?? false
      })
    )
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm Cloud VM compatibility method: ${method}`)
}

const handleCloudRemotesControlRequest = (method: string, params: Record<string, unknown>) => {
  if (method === 'remotes.list') return ok(cloudUnsupportedData(method, { remotes: [], count: 0 }))
  if (method === 'remotes.add') {
    const name = cleanText(params.name)
    if (!name) return fail('INVALID_PARAMS', 'remotes.add requires `name`.', { field: 'name' })
    const routes = cleanTextList(params.routes)
    if (!routes.length) return fail('INVALID_PARAMS', 'remotes.add requires at least one route.', { field: 'routes' })
    return ok(cloudUnsupportedData(method, { ok: false, added: false, name, routes, tag: cleanText(params.tag) || null, deviceId: null }))
  }
  if (method === 'remotes.remove') {
    const target = cleanText(params.target || params.name || params.deviceId || params.device_id)
    if (!target) return fail('INVALID_PARAMS', 'remotes.remove requires `target`.', { field: 'target' })
    return ok(cloudUnsupportedData(method, { ok: false, removed: false, target, deviceId: null }))
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm remotes compatibility method: ${method}`)
}

type CustomSidebarValidationEntry = {
  name: string
  path: string
  kind: 'swift' | 'json'
  ok: boolean
  error: string | null
}

const customSidebarDirectory = () => join(runtime.userDataPath || process.cwd(), 'custom-sidebars')

const customSidebarName = (params: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(params, 'name')) return undefined
  return cleanText(params.name)
}

const customSidebarPathFor = (directory: string, name: string, kind: 'swift' | 'json') => join(directory, `${name}.${kind}`)

const discoverCustomSidebarFiles = async (directory: string, requestedName?: string) => {
  let names: string[] = []
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const byName = new Map<string, { name: string; path: string; kind: 'swift' | 'json' }>()
  for (const entry of names) {
    const match = /^(.+)\.(swift|json)$/i.exec(entry)
    if (!match) continue
    const name = match[1]
    const kind = match[2].toLowerCase() as 'swift' | 'json'
    if (requestedName && requestedName !== name) continue
    const existing = byName.get(name)
    if (existing?.kind === 'swift') continue
    byName.set(name, { name, kind, path: join(directory, entry) })
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

const validateCustomSidebarFile = async (file: { name: string; path: string; kind: 'swift' | 'json' }): Promise<CustomSidebarValidationEntry> => {
  if (file.kind === 'swift') {
    return {
      ...file,
      ok: false,
      error: 'aiopsterm does not execute or interpret control_compat custom Swift sidebars through the control socket.'
    }
  }
  try {
    JSON.parse(await readFile(file.path, 'utf-8'))
    return { ...file, ok: false, error: 'aiopsterm can parse this JSON file, but custom sidebar rendering is not implemented.' }
  } catch (error) {
    return { ...file, ok: false, error: error instanceof Error ? error.message : 'Failed to read sidebar JSON.' }
  }
}

const customSidebarReport = async (name?: string) => {
  const directory = customSidebarDirectory()
  const files = await discoverCustomSidebarFiles(directory, name)
  const entries =
    name && files.length === 0
      ? [
          {
            name,
            path: customSidebarPathFor(directory, name, 'json'),
            kind: 'json' as const,
            ok: false,
            error: 'Sidebar file is missing.'
          }
        ]
      : await Promise.all(files.map(validateCustomSidebarFile))
  return {
    directory,
    valid_count: entries.filter((entry) => entry.ok).length,
    error_count: entries.filter((entry) => !entry.ok).length,
    sidebars: entries,
    unsupported: true,
    unsupportedReason: 'aiopsterm does not implement control_compat custom sidebar rendering or selection.',
    unsupported_reason: 'aiopsterm does not implement control_compat custom sidebar rendering or selection.'
  }
}

const handleSidebarCustomControlRequest = async (method: string, params: Record<string, unknown>) => {
  const name = customSidebarName(params)
  if ((method === 'sidebar.custom.validate' || method === 'sidebar.custom.reload') && name === '') {
    return fail('INVALID_PARAMS', 'Sidebar name must not be empty.')
  }
  if (method === 'sidebar.custom.validate') return ok(await customSidebarReport(name))
  if (method === 'sidebar.custom.reload') {
    const report = await customSidebarReport(name)
    return ok({
      ...report,
      reloaded_count: 0,
      reloaded_names: [],
      reloaded: false
    })
  }
  if (method === 'sidebar.custom.select') {
    if (!name) return fail('INVALID_PARAMS', 'Select requires a sidebar name.', { field: 'name' })
    const report = await customSidebarReport(name)
    return ok({
      ...report,
      selected_name: null,
      selected_provider_id: null,
      selected: false
    })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm custom sidebar compatibility method: ${method}`)
}

const handleSystemCompatibilityRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'auth.login') return ok({ authenticated: true, required: false })
  if (method === 'auth.status') return ok(authStatusPayload())
  if (method === 'auth.sign_in_url') {
    return ok({
      unsupported: true,
      unsupported_reason: 'aiopsterm does not expose a control_compat Stack Auth sign-in URL.',
      url: null
    })
  }
  if (method === 'auth.begin_sign_in') return ok(unsupportedAuthStatusPayload('begin_sign_in'))
  if (method === 'auth.sign_out') return ok(unsupportedAuthStatusPayload('sign_out'))
  if (method === 'feedback.submit') return feedbackSubmitPayload(params)
  if (method === 'session.restore_previous') return handleSessionControlRequest('session.restore', { ...params, id: params.id || 'latest' })
  if (method === 'system.tree') {
    const response = await dispatchRendererControlRequest('workspace.snapshot', params)
    if (!response.ok) return response
    const snapshot = response.data?.snapshot && typeof response.data.snapshot === 'object' ? (response.data.snapshot as Record<string, unknown>) : null
    if (!snapshot) return fail('SYSTEM_TREE_SNAPSHOT_INVALID', 'Renderer returned an invalid workspace snapshot.')
    return ok({
      ...systemTreeFromSnapshot(snapshot),
      snapshot
    })
  }
  if (method === 'system.top') return systemTopPayload(params)
  if (method === 'system.memory') return systemTopPayload(params, { memoryOnly: true })
  if (method === 'settings.open' || method === 'feedback.open' || method === 'extension.sidebar.snapshot') {
    return dispatchRendererControlRequest(method, params, { focus: params.activate !== false })
  }
  if (method === 'app.focus_override.set') {
    const state = cleanText(params.state).toLowerCase()
    let override: boolean | null
    if (state) {
      if (state === 'active') override = true
      else if (state === 'inactive') override = false
      else if (state === 'clear' || state === 'none') override = null
      else return fail('APP_FOCUS_STATE_INVALID', 'Invalid state (active|inactive|clear).', { state })
    } else if (Object.prototype.hasOwnProperty.call(params, 'focused')) {
      override = typeof params.focused === 'boolean' ? params.focused : null
    } else {
      return fail('APP_FOCUS_STATE_REQUIRED', 'Missing state or focused.')
    }
    publishControlEvent({
      name: 'app.focus_override.set',
      category: 'app',
      source: 'control.socket',
      payload: { override }
    })
    return ok({ override })
  }
  if (method === 'app.simulate_active') {
    const window = activeWindow()
    if (window) runtime.focusWindow?.(window)
    publishControlEvent({ name: 'app.simulate_active', category: 'app', source: 'control.socket', payload: {} })
    return ok({ active: Boolean(window) })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm system compatibility method: ${method}`)
}

const projectFileControlMethods = new Set([
  'project.open',
  'project.set_tab',
  'project.set_scheme',
  'project.set_configuration',
  'project.set_selected_target',
  'project.set_selected_file',
  'project.set_settings_filter',
  'project.get_state',
  'markdown.open',
  'file.open'
])

const isProjectFileControlMethod = (method: string) => projectFileControlMethods.has(method)

const cleanPositiveInteger = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return undefined
  const normalized = Math.floor(numberValue)
  return normalized > 0 ? normalized : undefined
}

const managedAiTimelineSummary = (session: ManagedAiSessionRecord, eventLimit: number) =>
  session.events.slice(-eventLimit).map((event) => ({
    id: event.id,
    source: event.source,
    event: event.event,
    sessionId: event.sessionId,
    title: event.title,
    summary: event.summary,
    receivedAt: event.receivedAt,
    requestKind: event.requestKind,
    decisionMode: event.decisionMode,
    ...(event.waitTimeoutMs ? { waitTimeoutMs: event.waitTimeoutMs } : {}),
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : {}),
    ...(event.cwd ? { cwd: event.cwd } : {}),
    ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
    ...(event.agentLifecycle ? { agentLifecycle: event.agentLifecycle } : {})
  }))

const managedAiDecisionSummary = (session: ManagedAiSessionRecord, decisionLimit: number) =>
  session.decisions.slice(-decisionLimit).map((decision) => ({
    id: decision.id,
    kind: decision.kind,
    ...(decision.message ? { message: decision.message } : {}),
    createdAt: decision.createdAt
  }))

const managedAiControlSummary = (
  session: ManagedAiSessionRecord,
  options: { includeEvents?: boolean; includeDecisions?: boolean; eventLimit?: number; decisionLimit?: number } = {}
) => {
  const eventLimit = normalizeLimit(options.eventLimit, 10)
  const decisionLimit = normalizeLimit(options.decisionLimit, 10)
  return {
    source: session.source,
    sessionId: session.id,
    id: session.id,
    title: session.title,
    summary: session.summary,
    state: session.state,
    needsInput: session.state === 'needsInput',
    lastEvent: session.lastEvent,
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    ...(session.waitTimeoutMs ? { waitTimeoutMs: session.waitTimeoutMs } : {}),
    ...(session.toolName ? { toolName: session.toolName } : {}),
    actionable: session.actionable === true,
    ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
    ...(session.launchCommand ? { launchCommand: session.launchCommand } : {}),
    ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
    ...(session.processId ? { processId: session.processId } : {}),
    ...(session.parentProcessId ? { parentProcessId: session.parentProcessId } : {}),
    ...(session.processGroupId ? { processGroupId: session.processGroupId } : {}),
    ...(session.agentLifecycle ? { agentLifecycle: session.agentLifecycle } : {}),
    ...(session.hibernated ? { hibernated: true } : {}),
    ...(session.hibernatedAt ? { hibernatedAt: session.hibernatedAt } : {}),
    ...(session.hibernationReason ? { hibernationReason: session.hibernationReason } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.handledAt ? { handledAt: session.handledAt } : {}),
    eventCount: session.events.length,
    decisionCount: session.decisions.length,
    ...(options.includeEvents ? { events: managedAiTimelineSummary(session, eventLimit) } : {}),
    ...(options.includeDecisions ? { decisions: managedAiDecisionSummary(session, decisionLimit) } : {})
  }
}

const resolveManagedAiControlSession = async (params: Record<string, unknown>) => {
  const sessionId = cleanText(params.sessionId || params.session_id || params.id)
  if (!sessionId) return { error: fail('AGENT_SESSION_ID_REQUIRED', 'Managed AI session id is required.') }
  const source = cleanText(params.source || params.agent)
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) return { error: fail(snapshot.errorCode || 'AGENT_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.') }
  const matches = snapshot.data.sessions.filter((session) => session.id === sessionId && (!source || session.source === source))
  if (!matches.length) return { error: fail('AGENT_SESSION_NOT_FOUND', `Managed AI session was not found: ${source ? `${source}:` : ''}${sessionId}`) }
  if (matches.length > 1) return { error: fail('AGENT_SESSION_SOURCE_REQUIRED', `Multiple managed AI sessions match ${sessionId}; pass source.`) }
  return { session: matches[0], snapshot: snapshot.data }
}

const managedAiSessionMatchesWorkstream = (session: ManagedAiSessionRecord, workstreamId: string) =>
  session.id === workstreamId ||
  session.pendingRequestId === workstreamId ||
  session.panelId === workstreamId ||
  session.terminalSessionId === workstreamId ||
  session.workspaceId === workstreamId ||
  session.events.some((event) => event.id === workstreamId || event.requestId === workstreamId)

const control_compatChatTimestamp = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined
  return new Date(numberValue).toISOString()
}

const control_compatChatAgentKind = (source: string) => (source === 'claude-code' || source === 'claude' ? 'claude' : source === 'codex' ? 'codex' : source)

const control_compatChatState = (session: ManagedAiSessionRecord) => {
  const since = control_compatChatTimestamp(session.lastActivityAt || session.updatedAt || session.createdAt)
  if (session.state === 'needsInput') return { state: 'needs_input', ...(since ? { since } : {}) }
  if (session.state === 'working') return { state: 'working', ...(since ? { since } : {}) }
  if (session.state === 'ended') return { state: 'ended' }
  return { state: 'idle' }
}

const control_compatMobileChatDescriptor = (session: ManagedAiSessionRecord) => ({
  session_id: session.id,
  id: session.id,
  agent_kind: control_compatChatAgentKind(session.source),
  source: session.source,
  kind: 'agent',
  title: session.title || session.summary || session.id,
  ...(session.workspaceId ? { workspace_id: session.workspaceId, workspaceId: session.workspaceId } : {}),
  ...(session.panelId ? { terminal_id: session.panelId, panelId: session.panelId, surface_id: session.panelId } : {}),
  ...(session.terminalSessionId ? { terminal_session_id: session.terminalSessionId, terminalSessionId: session.terminalSessionId } : {}),
  ...(session.cwd ? { cwd: session.cwd, workingDirectory: session.cwd } : {}),
  state: control_compatChatState(session),
  ...(control_compatChatTimestamp(session.lastActivityAt) ? { last_activity_at: control_compatChatTimestamp(session.lastActivityAt), lastActivityAt: session.lastActivityAt } : {}),
  needs_input: session.state === 'needsInput',
  needsInput: session.state === 'needsInput',
  actionable: session.actionable === true,
  event_count: session.events.length,
  decision_count: session.decisions.length,
  updated_at: session.updatedAt,
  created_at: session.createdAt
})

const control_compatChatEventText = (event: ReturnType<typeof managedAiTimelineSummary>[number]) =>
  cleanText(event.summary || event.title || event.toolName || event.event || event.requestId || event.id)

const control_compatChatEventKind = (event: ReturnType<typeof managedAiTimelineSummary>[number], session: ManagedAiSessionRecord) => {
  const text = control_compatChatEventText(event)
  if (event.requestKind === 'permission' || event.requestKind === 'plan') {
    return {
      type: 'permission_request',
      title: event.requestKind === 'plan' ? 'Review plan' : `${session.source} needs permission`,
      subject: text || event.toolName || event.event || 'Permission request'
    }
  }
  if (event.requestKind === 'question') {
    return {
      type: 'question',
      prompt: text || 'Question',
      options: []
    }
  }
  if (event.event === 'session_start') return { type: 'status', event: 'session_started', ...(text ? { detail: text } : {}) }
  if (event.event === 'session_end' || event.event === 'stop') return { type: 'status', event: 'session_ended', ...(text ? { detail: text } : {}) }
  return { type: 'prose', text: text || event.event || 'Session event' }
}

const control_compatChatMessageFromEvent = (event: ReturnType<typeof managedAiTimelineSummary>[number], session: ManagedAiSessionRecord, index: number) => {
  const seq = Math.max(0, index)
  const timestamp = control_compatChatTimestamp(event.receivedAt) || control_compatChatTimestamp(session.lastActivityAt) || new Date(session.updatedAt || Date.now()).toISOString()
  const role = event.requestKind === 'permission' || event.requestKind === 'question' || event.requestKind === 'plan' ? 'agent' : event.event === 'prompt_submit' ? 'user' : 'system'
  return {
    id: event.id || `${session.id}-${seq}`,
    seq,
    role,
    timestamp,
    kind: control_compatChatEventKind(event, session),
    source: event.source,
    event: event.event,
    request_kind: event.requestKind,
    decision_mode: event.decisionMode,
    ...(event.requestId ? { request_id: event.requestId } : {}),
    ...(event.toolName ? { tool_name: event.toolName } : {})
  }
}

const control_compatChatSessionDebugSummary = (session: ManagedAiSessionRecord) => ({
  ...managedAiControlSummary(session, { includeEvents: true, includeDecisions: true, eventLimit: 25, decisionLimit: 25 }),
  descriptor: control_compatMobileChatDescriptor(session)
})

const resolveMobileChatSession = async (params: Record<string, unknown>) => {
  const sessionId = cleanText(params.sessionId || params.session_id || params.id)
  if (!sessionId) return { error: fail('MOBILE_CHAT_SESSION_ID_REQUIRED', 'mobile.chat requires session_id.') }
  const source = cleanText(params.source || params.agent || params.agent_kind)
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) return { error: fail(snapshot.errorCode || 'MOBILE_CHAT_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.') }
  const matches = snapshot.data.sessions.filter((session) => session.id === sessionId && (!source || session.source === source || control_compatChatAgentKind(session.source) === source))
  if (!matches.length) return { error: fail('MOBILE_CHAT_SESSION_NOT_FOUND', `Mobile chat session was not found: ${source ? `${source}:` : ''}${sessionId}`) }
  if (matches.length > 1) return { error: fail('MOBILE_CHAT_SOURCE_REQUIRED', `Multiple mobile chat sessions match ${sessionId}; pass source.`) }
  return { session: matches[0], snapshot: snapshot.data }
}

const mobileChatTerminalTarget = (session: ManagedAiSessionRecord) => {
  if (!session.terminalSessionId && !session.panelId) return null
  return {
    ...(session.terminalSessionId
      ? {
          sessionId: session.terminalSessionId,
          session_id: session.terminalSessionId,
          terminalSessionId: session.terminalSessionId,
          terminal_session_id: session.terminalSessionId
        }
      : {}),
    ...(session.panelId
      ? {
          panelId: session.panelId,
          panel_id: session.panelId,
          surfaceId: session.panelId,
          surface_id: session.panelId,
          terminal_id: session.panelId
        }
      : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId, workspace_id: session.workspaceId } : {})
  }
}

const mobileChatPastePayload = (text: string, submitKey: unknown) => {
  const normalized = cleanText(submitKey || 'return').toLowerCase().replace(/[\s_]+/g, '')
  const suffix = !normalized || normalized === 'return' || normalized === 'enter' ? '\r' : normalized === 'none' ? '' : normalized === 'ctrl+enter' || normalized === 'control+enter' || normalized === 'ctrl-enter' || normalized === 'control-enter' ? '\x1b[13;5u' : null
  if (suffix === null) return null
  return `\x1b[200~${text}\x1b[201~${suffix}`
}

const handleMobileChatControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (runtime.userDataPath) await configureAiAgentSessionStore(runtime.userDataPath)
  if (method === 'mobile.chat.sessions') {
    const snapshot = await listManagedAiSessions()
    if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'MOBILE_CHAT_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
    const workspaceId = cleanText(params.workspace_id || params.workspaceId)
    const source = cleanText(params.source || params.agent || params.agent_kind)
    const includeEnded = params.includeEnded === true || params.include_ended === true
    const limit = normalizeLimit(params.limit, 100)
    const filtered = snapshot.data.sessions.filter((session) => {
      if (workspaceId && session.workspaceId !== workspaceId) return false
      if (source && session.source !== source && control_compatChatAgentKind(session.source) !== source) return false
      if (!includeEnded && session.state === 'ended') return false
      return Boolean(session.panelId || session.terminalSessionId || session.cwd || session.transcriptPath || session.events.length)
    })
    return ok({
      sessions: filtered.slice(0, limit).map(control_compatMobileChatDescriptor),
      count: filtered.length,
      total: snapshot.data.sessions.length,
      needs_input_count: filtered.filter((session) => session.state === 'needsInput').length
    })
  }
  if (method === 'chat.sessions.dump') {
    const snapshot = await listManagedAiSessions()
    if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'MOBILE_CHAT_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
    return ok({
      sessions: snapshot.data.sessions.map(control_compatChatSessionDebugSummary),
      count: snapshot.data.sessions.length,
      needs_input_count: snapshot.data.sessions.filter((session) => session.state === 'needsInput').length
    })
  }
  if (method === 'mobile.chat.history') {
    const resolved = await resolveMobileChatSession(params)
    if (resolved.error) return resolved.error
    const limit = normalizeLimit(params.limit, 100)
    const beforeSeq = Number(params.before_seq || params.beforeSeq)
    const session = resolved.session!
    const events = managedAiTimelineSummary(session, session.events.length || 1)
    const pageEvents = Number.isFinite(beforeSeq) && beforeSeq >= 0 ? events.filter((_event, index) => index < beforeSeq).slice(-limit) : events.slice(-limit)
    const baseSeq = Number.isFinite(beforeSeq) && beforeSeq >= 0 ? Math.max(0, Math.floor(beforeSeq) - pageEvents.length) : Math.max(0, events.length - pageEvents.length)
    return ok({
      messages: pageEvents.map((event, index) => control_compatChatMessageFromEvent(event, session, baseSeq + index)),
      has_more: events.length > pageEvents.length && baseSeq > 0,
      session: control_compatMobileChatDescriptor(session),
      source: 'managed-ai-events',
      transcript_unavailable: Boolean(session.transcriptPath) ? false : true
    })
  }
  if (method === 'mobile.chat.send') {
    const resolved = await resolveMobileChatSession(params)
    if (resolved.error) return resolved.error
    const session = resolved.session!
    const text = typeof params.text === 'string' ? params.text : ''
    const attachments = Array.isArray(params.attachments) ? params.attachments : []
    if (!text && !attachments.length) return fail('MOBILE_CHAT_EMPTY_SEND', 'mobile.chat.send requires text or attachments.')
    if (attachments.length) return fail('MOBILE_CHAT_ATTACHMENTS_UNSUPPORTED', 'mobile.chat.send attachments are not supported yet.', { unsupported: true, session_id: session.id })
    const target = mobileChatTerminalTarget(session)
    if (!target) return fail('MOBILE_CHAT_TERMINAL_NOT_FOUND', "The agent session is not bound to an aiopsterm terminal.", { session_id: session.id })
    const payload = mobileChatPastePayload(text, params.submit_key || params.submitKey || 'return')
    if (payload === null) return fail('MOBILE_CHAT_SUBMIT_KEY_UNSUPPORTED', 'Unsupported submit_key.', { submit_key: cleanText(params.submit_key || params.submitKey) })
    const response =
      session.terminalSessionId && runtime.writeTerminal
        ? await runtime.writeTerminal(session.terminalSessionId, payload)
        : await handleMobileTerminalControlRequest('terminal.paste', { ...target, text, submit_key: params.submit_key || params.submitKey || 'return' })
    if (!response.ok) return response
    publishControlEvent({
      name: 'mobile_chat.sent',
      category: 'agent',
      source: 'control.socket',
      workspaceId: session.workspaceId,
      surfaceId: session.panelId,
      payload: { source: session.source, session_id: session.id, text_length: text.length }
    })
    return ok({ sent: true, submitted: true, session_id: session.id, terminal: response.data || {} })
  }
  if (method === 'mobile.chat.interrupt') {
    const resolved = await resolveMobileChatSession(params)
    if (resolved.error) return resolved.error
    const session = resolved.session!
    const target = mobileChatTerminalTarget(session)
    if (!target) return fail('MOBILE_CHAT_TERMINAL_NOT_FOUND', "The agent session is not bound to an aiopsterm terminal.", { session_id: session.id })
    const hard = params.hard === true
    const response = await sendTerminalKey({ ...target, key: hard ? 'ctrl+c' : 'escape' })
    if (!response.ok) return response
    publishControlEvent({
      name: 'mobile_chat.interrupted',
      category: 'agent',
      source: 'control.socket',
      workspaceId: session.workspaceId,
      surfaceId: session.panelId,
      payload: { source: session.source, session_id: session.id, hard }
    })
    return ok({ interrupted: true, hard, session_id: session.id, terminal: response.data || {} })
  }
  if (method === 'mobile.chat.answer') {
    const resolved = await resolveMobileChatSession(params)
    if (resolved.error) return resolved.error
    const optionIndex = Number(params.option_index ?? params.optionIndex)
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 8) return fail('MOBILE_CHAT_OPTION_INDEX_INVALID', 'mobile.chat.answer option_index must be an integer from 0 to 8.')
    const session = resolved.session!
    const target = mobileChatTerminalTarget(session)
    if (!target) return fail('MOBILE_CHAT_TERMINAL_NOT_FOUND', "The agent session is not bound to an aiopsterm terminal.", { session_id: session.id })
    const response = await sendTerminalKey({ ...target, key: String(optionIndex + 1) })
    if (!response.ok) return response
    publishControlEvent({
      name: 'mobile_chat.answered',
      category: 'agent',
      source: 'control.socket',
      workspaceId: session.workspaceId,
      surfaceId: session.panelId,
      payload: { source: session.source, session_id: session.id, option_index: optionIndex }
    })
    return ok({ answered: true, option_index: optionIndex, session_id: session.id, terminal: response.data || {} })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm mobile chat method: ${method}`)
}

const normalizeAttachTicketTtlSeconds = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 600
  return Math.max(30, Math.min(3600, Math.floor(numberValue)))
}

const attachTicketDeviceId = () => {
  const seed = runtime.userDataPath || process.cwd()
  return `aiopsterm-${Buffer.from(seed).toString('base64url').slice(0, 24) || process.pid}`
}

const handleMobileAttachTicketControlRequest = (params: Record<string, unknown>) => {
  const ttlSeconds = normalizeAttachTicketTtlSeconds(params.ttl_seconds ?? params.ttlSeconds ?? params.ttl)
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString()
  const workspaceId = cleanText(params.scope).toLowerCase() === 'mac' ? '' : cleanText(params.workspace_id || params.workspaceId || params.workspace) || 'main'
  const terminalId = cleanText(params.terminal_id || params.terminalId || params.surface_id || params.surfaceId || params.panelId)
  const authToken = randomBytes(32).toString('base64url')
  const route = {
    id: 'local_control_socket',
    kind: 'websocket',
    endpoint: {
      type: 'url',
      url: socketPath ? `aiopsterm-control://local?socket=${encodeURIComponent(socketPath)}` : 'aiopsterm-control://local'
    },
    priority: 0,
    local_socket_path: socketPath,
    transport_note: 'aiopsterm exposes this ticket for local control-socket automation; it is not a remote mobile network route.'
  }
  const ticket = {
    version: 1,
    workspaceID: workspaceId,
    ...(terminalId ? { terminalID: terminalId } : {}),
    macDeviceID: attachTicketDeviceId(),
    macDisplayName: process.env.HOSTNAME || 'aiopsterm',
    macPairingCompatibilityVersion: 1,
    macAppVersion: process.env.npm_package_version || '0.1.0',
    macAppBuild: process.env.npm_package_version || '0.1.0',
    routes: [
      {
        id: route.id,
        kind: route.kind,
        endpoint: route.endpoint,
        priority: route.priority
      }
    ],
    expiresAt,
    auth_token: authToken
  }
  publishControlEvent({
    name: 'mobile_attach_ticket.created',
    category: 'system',
    source: 'control.socket',
    workspaceId: workspaceId || undefined,
    surfaceId: terminalId || undefined,
    payload: {
      workspace_id: workspaceId,
      terminal_id: terminalId,
      ttl_seconds: ttlSeconds,
      expires_at: expiresAt,
      route_id: route.id,
      route_kind: route.kind
    }
  })
  return ok({
    ticket,
    attach_url: `aiopsterm-control://attach?v=1&socket=${encodeURIComponent(socketPath)}&token=${encodeURIComponent(authToken)}`,
    routes: [route],
    expires_at: expiresAt,
    ttl_seconds: ttlSeconds,
    unsupported_remote: true,
    unsupported_reason: 'aiopsterm currently exposes attach tickets only for the local control socket, not a control_compat mobile network listener.'
  })
}

const resolveManagedAiControlSessionByRequest = async (params: Record<string, unknown>) => {
  const requestId = cleanText(params.requestId || params.request_id || params.id)
  if (!requestId) return { error: fail('FEED_REQUEST_ID_REQUIRED', 'feed reply requires request_id.') }
  const source = cleanText(params.source || params.agent)
  const snapshot = await listManagedAiSessions()
  if (!snapshot.ok || !snapshot.data) return { error: fail(snapshot.errorCode || 'AGENT_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.') }
  const matches = snapshot.data.sessions.filter(
    (session) =>
      (!source || session.source === source) &&
      (session.pendingRequestId === requestId || session.events.some((event) => event.requestId === requestId || event.id === requestId))
  )
  if (!matches.length) return { error: fail('FEED_REQUEST_NOT_FOUND', `Managed AI request was not found: ${source ? `${source}:` : ''}${requestId}`) }
  if (matches.length > 1) return { error: fail('FEED_REQUEST_SOURCE_REQUIRED', `Multiple managed AI requests match ${requestId}; pass source.`) }
  return { requestId, session: matches[0], snapshot: snapshot.data }
}

const control_compatFeedEventFromParams = (params: Record<string, unknown>) => {
  const nestedEvent = params.event && typeof params.event === 'object' && !Array.isArray(params.event) ? (params.event as Record<string, unknown>) : {}
  const topLevelEventName = typeof params.event === 'string' ? params.event : ''
  const event: Record<string, unknown> = { ...params, ...nestedEvent }
  delete event.event
  if (nestedEvent.event !== undefined) event.event = nestedEvent.event
  const source = cleanText(event.source || event.agent || event.agent_name || event.agentName || params._source || params.source)
  const sessionId = cleanText(
    event.sessionId ||
      event.session_id ||
      event.conversationId ||
      event.conversation_id ||
      event.workstream_id ||
      event.workstreamId ||
      event.id ||
      params.workstream_id ||
      params.workstreamId
  )
  const eventName = cleanText(event.event || event.hookEventName || event.hook_event_name || event.type || event.kind || params.hook_event_name || params.hookEventName || topLevelEventName)
  if (params._source && !event.source && !event.agent) event.source = params._source
  if (source && !event.source) event.source = source
  if (sessionId && !event.sessionId && !event.session_id) event.sessionId = sessionId
  if (eventName && !event.event) event.event = eventName
  if (params.request_id && !event.request_id && !event.requestId) event.request_id = params.request_id
  if (params.requestId && !event.requestId && !event.request_id) event.requestId = params.requestId
  if (params.wait_timeout_seconds !== undefined && event.waitTimeoutMs === undefined && event.wait_timeout_ms === undefined) {
    const seconds = Number(params.wait_timeout_seconds)
    if (Number.isFinite(seconds) && seconds > 0) {
      event.waitTimeoutMs = Math.round(seconds * 1000)
      event.wait_timeout_ms = event.waitTimeoutMs
    }
  }
  if (params.wait === true || params.block === true || Number(params.wait_timeout_seconds) > 0) {
    event.waitForDecision = event.waitForDecision ?? event.wait_for_decision ?? true
    event.wait_for_decision = event.wait_for_decision ?? event.waitForDecision
  }
  return event
}

const feedDecisionKindForPermissionMode = (modeValue: unknown) => {
  const mode = cleanText(modeValue).toLowerCase().replace(/[\s_-]+/g, '')
  if (!mode) return ''
  if (mode === 'once' || mode === 'allow' || mode === 'approve' || mode === 'approved') return 'allow'
  if (mode === 'always' || mode === 'all') return 'always'
  if (mode === 'bypass' || mode === 'bypasspermissions') return 'bypass'
  if (mode === 'deny' || mode === 'denied' || mode === 'reject' || mode === 'rejected') return 'deny'
  return ''
}

const feedDecisionKindForExitPlanMode = (modeValue: unknown) => {
  const mode = cleanText(modeValue).toLowerCase().replace(/[\s_-]+/g, '')
  if (!mode) return ''
  if (mode === 'deny' || mode === 'rejected' || mode === 'reject') return 'deny'
  if (mode === 'bypasspermissions' || mode === 'bypass') return 'bypass'
  if (mode === 'ultraplan' || mode === 'autoaccept' || mode === 'manual' || mode === 'accept' || mode === 'allow' || mode === 'approve') return 'allow'
  return ''
}

const feedReplyMessage = (params: Record<string, unknown>) => {
  const selections = cleanTextList(params.selections || params.selection || params.selected)
  const message = cleanText(params.message || params.feedback || params.answer || params.reply || params.text)
  return selections.length ? selections.join('\n') : message
}

const handleFeedReply = async (
  params: Record<string, unknown>,
  kind: ManagedAiSessionDecisionKind,
  mode: string,
  message = ''
) => {
  const resolved = await resolveManagedAiControlSessionByRequest(params)
  if (resolved.error) return resolved.error
  const result = await replyManagedAiSession({ source: resolved.session!.source, sessionId: resolved.session!.id, kind, ...(message ? { message } : {}) })
  if (!result.ok || !result.data) return fail(result.errorCode || 'FEED_REPLY_FAILED', result.errorMessage || 'Managed AI feed reply failed.')
  const nextSession = result.data.session || resolved.session!
  publishControlEvent({
    name: 'feed.reply',
    category: 'agent',
    source: 'control.socket',
    surfaceId: nextSession.panelId,
    payload: { request_id: resolved.requestId, source: nextSession.source, session_id: nextSession.id, kind, mode, state: nextSession.state }
  })
  return ok({
    delivered: true,
    request_id: resolved.requestId,
    mode,
    kind,
    session: managedAiControlSummary(nextSession, { includeEvents: true, includeDecisions: true }),
    count: result.data.snapshot.sessions.length,
    needsInputCount: result.data.snapshot.sessions.filter((session) => session.state === 'needsInput').length
  })
}

const handleAgentSessionControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (runtime.userDataPath) await configureAiAgentSessionStore(runtime.userDataPath)
  const action = method.startsWith('agent.sessions.')
    ? method.slice('agent.sessions.'.length)
    : method.startsWith('ai.session.')
      ? method.slice('ai.session.'.length)
      : method.slice('agent.session.'.length)
  if (action === 'list') {
    const snapshot = await listManagedAiSessions()
    if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'AGENT_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
    const query = cleanText(params.query).toLowerCase()
    const source = cleanText(params.source || params.agent)
    const state = cleanText(params.state)
    const needsInput = params.needsInput === true || params.needs_input === true
    const includeEvents = params.includeEvents === true || params.include_events === true
    const includeDecisions = params.includeDecisions === true || params.include_decisions === true
    const eventLimit = normalizeLimit(params.eventLimit || params.event_limit, 5)
    const decisionLimit = normalizeLimit(params.decisionLimit || params.decision_limit, 5)
    const limit = normalizeLimit(params.limit, 50)
    const filtered = snapshot.data.sessions.filter((session) => {
      if (source && session.source !== source) return false
      if (state && session.state !== state) return false
      if (needsInput && session.state !== 'needsInput') return false
      if (!query) return true
      return [session.source, session.id, session.title, session.summary, session.cwd || '', session.panelId || '', session.terminalSessionId || ''].some((value) =>
        value.toLowerCase().includes(query)
      )
    })
    return ok({
      sessions: filtered.slice(0, limit).map((session) => managedAiControlSummary(session, { includeEvents, includeDecisions, eventLimit, decisionLimit })),
      count: filtered.length,
      total: snapshot.data.sessions.length,
      needsInputCount: snapshot.data.sessions.filter((session) => session.state === 'needsInput').length
    })
  }
  if (action === 'show' || action === 'get') {
    const resolved = await resolveManagedAiControlSession(params)
    if (resolved.error) return resolved.error
    const includeEvents = params.includeEvents !== false && params.include_events !== false
    const includeDecisions = params.includeDecisions !== false && params.include_decisions !== false
    return ok({
      session: managedAiControlSummary(resolved.session!, {
        includeEvents,
        includeDecisions,
        eventLimit: normalizeLimit(params.eventLimit || params.event_limit, 25),
        decisionLimit: normalizeLimit(params.decisionLimit || params.decision_limit, 25)
      })
    })
  }
  if (action === 'reply' || action === 'approve' || action === 'deny' || action === 'handle') {
    const resolved = await resolveManagedAiControlSession(params)
    if (resolved.error) return resolved.error
    const kind = (
      action === 'approve' ? 'allow' : action === 'deny' ? 'deny' : action === 'handle' ? 'handled' : cleanText(params.kind || params.decision || 'handled')
    ) as ManagedAiSessionDecisionKind
    const message = cleanText(params.message || params.reason || params.answer || params.reply)
    const result = await replyManagedAiSession({ source: resolved.session!.source, sessionId: resolved.session!.id, kind, ...(message ? { message } : {}) })
    if (!result.ok || !result.data) return fail(result.errorCode || 'AGENT_SESSION_REPLY_FAILED', result.errorMessage || 'Managed AI session reply failed.')
    const nextSession = result.data.session || resolved.session!
    publishControlEvent({
      name: 'agent_session.replied',
      category: 'agent',
      source: 'control.socket',
      surfaceId: nextSession.panelId,
      payload: { source: nextSession.source, session_id: nextSession.id, kind, state: nextSession.state }
    })
    return ok({
      session: managedAiControlSummary(nextSession, { includeEvents: true, includeDecisions: true }),
      count: result.data.snapshot.sessions.length,
      needsInputCount: result.data.snapshot.sessions.filter((session) => session.state === 'needsInput').length
    })
  }
  if (action === 'rename') {
    const resolved = await resolveManagedAiControlSession(params)
    if (resolved.error) return resolved.error
    const title = cleanText(params.title || params.name)
    if (!title) return fail('AGENT_SESSION_TITLE_REQUIRED', 'Managed AI session title is required.')
    const result = await renameManagedAiSession({ source: resolved.session!.source, sessionId: resolved.session!.id, title })
    if (!result.ok || !result.data) return fail(result.errorCode || 'AGENT_SESSION_RENAME_FAILED', result.errorMessage || 'Managed AI session rename failed.')
    return ok({ session: managedAiControlSummary(result.data.session || resolved.session!, { includeEvents: true, includeDecisions: true }) })
  }
  if (action === 'clear' || action === 'delete' || action === 'remove') {
    const resolved = await resolveManagedAiControlSession(params)
    if (resolved.error) return resolved.error
    const result = await clearManagedAiSession({ source: resolved.session!.source, sessionId: resolved.session!.id })
    if (!result.ok || !result.data) return fail(result.errorCode || 'AGENT_SESSION_CLEAR_FAILED', result.errorMessage || 'Managed AI session clear failed.')
    publishControlEvent({
      name: 'agent_session.cleared',
      category: 'agent',
      source: 'control.socket',
      surfaceId: resolved.session!.panelId,
      payload: { source: resolved.session!.source, session_id: resolved.session!.id }
    })
    return ok({
      cleared: true,
      session: managedAiControlSummary(resolved.session!),
      count: result.data.snapshot.sessions.length,
      needsInputCount: result.data.snapshot.sessions.filter((session) => session.state === 'needsInput').length
    })
  }
  if (action === 'bulk' || action === 'mark-handled' || action === 'clear-ended' || action === 'clear-all') {
    const operation = (action === 'bulk' ? cleanText(params.operation || params.op) : action) as ManagedAiSessionBulkOperation
    const sources = cleanTextList(params.sources || params.source || params.agent) as AiAgentSessionSource[]
    const sessionIds = cleanTextList(params.sessionIds || params.session_ids || params.id || params.sessionId || params.session_id)
    if (operation === 'clear-all' && params.confirm !== true && params.yes !== true) {
      return fail('AGENT_SESSION_CLEAR_ALL_CONFIRM_REQUIRED', 'Pass confirm=true to clear all managed AI sessions.')
    }
    const result = await bulkManagedAiSessions({ operation, sources, sessionIds })
    if (!result.ok || !result.data) return fail(result.errorCode || 'AGENT_SESSION_BULK_FAILED', result.errorMessage || 'Managed AI session bulk operation failed.')
    publishControlEvent({
      name: 'agent_session.bulk',
      category: 'agent',
      source: 'control.socket',
      payload: { operation, changed: result.data.changed }
    })
    return ok({
      operation,
      changed: result.data.changed,
      sessions: result.data.snapshot.sessions.map((session) => managedAiControlSummary(session)),
      count: result.data.snapshot.sessions.length,
      needsInputCount: result.data.snapshot.sessions.filter((session) => session.state === 'needsInput').length
    })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm agent session method: ${method}`)
}

const cleanAgentHookSourceList = (params: Record<string, unknown>): AgentHookInstallerSource[] => {
  const raw = params.source || params.agent || params.sources || params.agents
  const values = Array.isArray(raw) ? raw : cleanText(raw) ? cleanText(raw).split(',') : []
  return values.map((value) => cleanText(value).toLowerCase().replace(/_/g, '-') as AgentHookInstallerSource).filter(Boolean)
}

const summarizeAgentHookSnapshot = (snapshot: Awaited<ReturnType<typeof listAgentHookInstallers>>) => ({
  installers: snapshot.installers,
  count: snapshot.installers.length,
  installedCount: snapshot.installers.filter((installer) => installer.installed).length,
  readyCount: snapshot.installers.filter((installer) => Boolean(installer.binaryPath)).length,
  missingCount: snapshot.installers.filter((installer) => !installer.binaryPath).length
})

const handleAgentHooksControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = method.startsWith('hooks.') ? method.slice('hooks.'.length) : method.slice('agent.hooks.'.length)
  if (action === 'list' || action === 'status') {
    return ok(summarizeAgentHookSnapshot(await listAgentHookInstallers()))
  }
  if (action === 'install' || action === 'setup') {
    const snapshot = await listAgentHookInstallers()
    const requestedSources = cleanAgentHookSourceList(params)
    const installable = snapshot.installers.filter((installer) => (!requestedSources.length || requestedSources.includes(installer.source)) && (action !== 'setup' || Boolean(installer.binaryPath)))
    const results = []
    for (const installer of installable) {
      const result = await installAgentHook({ source: installer.source })
      results.push({
        source: installer.source,
        ok: result.ok,
        ...(result.data?.status ? { status: result.data.status } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {})
      })
    }
    const nextSnapshot = await listAgentHookInstallers()
    return ok({
      operation: action,
      results,
      installed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      skipped: snapshot.installers
        .filter((installer) => (!requestedSources.length || requestedSources.includes(installer.source)) && action === 'setup' && !installer.binaryPath)
        .map((installer) => ({ source: installer.source, reason: `${installer.binaryName} not found on PATH` })),
      ...summarizeAgentHookSnapshot(nextSnapshot)
    })
  }
  if (action === 'uninstall' || action === 'remove') {
    const snapshot = await listAgentHookInstallers()
    const requestedSources = cleanAgentHookSourceList(params)
    const selected = snapshot.installers.filter((installer) => !requestedSources.length || requestedSources.includes(installer.source))
    const results = []
    for (const installer of selected) {
      const result = await uninstallAgentHook({ source: installer.source })
      results.push({
        source: installer.source,
        ok: result.ok,
        ...(result.data?.status ? { status: result.data.status } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {})
      })
    }
    const nextSnapshot = await listAgentHookInstallers()
    return ok({
      operation: 'uninstall',
      results,
      uninstalled: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      ...summarizeAgentHookSnapshot(nextSnapshot)
    })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm agent hook method: ${method}`)
}

const handleFeedControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (runtime.userDataPath) await configureAiAgentSessionStore(runtime.userDataPath)
  const action = method.slice('feed.'.length)
  if (action === 'list' || action === 'status') {
    const control_compatPendingOnly = typeof params.pending_only === 'boolean' ? params.pending_only : typeof params.pendingOnly === 'boolean' ? params.pendingOnly : undefined
    return handleAgentSessionControlRequest('agent.session.list', { ...params, needsInput: params.needsInput ?? params.needs_input ?? control_compatPendingOnly ?? true })
  }
  if (action === 'jump') {
    const workstreamId = cleanText(params.workstream_id || params.workstreamId || params.sessionId || params.session_id || params.id || params.request_id || params.requestId)
    if (!workstreamId) return fail('FEED_WORKSTREAM_ID_REQUIRED', 'feed.jump requires workstream_id.')
    const snapshot = await listManagedAiSessions()
    if (!snapshot.ok || !snapshot.data) return fail(snapshot.errorCode || 'AGENT_SESSIONS_UNAVAILABLE', snapshot.errorMessage || 'Managed AI sessions are unavailable.')
    const session = snapshot.data.sessions.find((candidate) => managedAiSessionMatchesWorkstream(candidate, workstreamId))
    return ok({
      workstream_id: workstreamId,
      matched: Boolean(session),
      ...(session ? { session: managedAiControlSummary(session), panelId: session.panelId, surfaceId: session.panelId, terminalSessionId: session.terminalSessionId } : {})
    })
  }
  if (action === 'push') {
    const event = control_compatFeedEventFromParams(params)
    const result = publishAiAgentSessionEvent(event, null)
    if (!result.ok || !result.data) return fail(result.errorCode || 'FEED_PUSH_FAILED', result.errorMessage || 'Managed AI feed event was not accepted.')
    const snapshot = await listManagedAiSessions()
    const session = snapshot.data?.sessions.find((candidate) => candidate.source === result.data!.source && candidate.id === result.data!.sessionId)
    publishControlEvent({
      name: 'feed.pushed',
      category: 'agent',
      source: 'control.socket',
      surfaceId: result.data.panelId,
      payload: {
        source: result.data.source,
        session_id: result.data.sessionId,
        event: result.data.event,
        request_id: result.data.requestId,
        request_kind: result.data.requestKind,
        decision_mode: result.data.decisionMode
      }
    })
    return ok({
      status: 'acknowledged',
      waited: false,
      unsupported_wait: Boolean(params.wait === true || params.block === true || Number(params.wait_timeout_seconds) > 0),
      item_id: result.data.requestId || result.data.sessionId,
      request_id: result.data.requestId,
      session_id: result.data.sessionId,
      workstream_id: result.data.sessionId,
      event: managedAiTimelineSummary(
        {
          id: result.data.sessionId,
          source: result.data.source,
          title: result.data.title,
          summary: result.data.summary,
          state: 'unknown',
          lastEvent: result.data.event,
          lastActivityAt: result.data.receivedAt,
          createdAt: result.data.receivedAt,
          updatedAt: result.data.receivedAt,
          requestKind: result.data.requestKind || 'telemetry',
          decisionMode: result.data.decisionMode || 'telemetry',
          events: [
            {
              ...result.data,
              id: `${result.data.receivedAt}-${result.data.event}`,
              requestKind: result.data.requestKind || 'telemetry',
              decisionMode: result.data.decisionMode || 'telemetry'
            }
          ],
          decisions: []
        },
        1
      )[0],
      ...(session ? { session: managedAiControlSummary(session, { includeEvents: true, includeDecisions: true }) } : {})
    })
  }
  if (action === 'permission.reply') {
    const mode = cleanText(params.mode || params.decision || params.kind || 'once') || 'once'
    const kind = feedDecisionKindForPermissionMode(mode)
    if (!kind) return fail('FEED_PERMISSION_MODE_INVALID', 'feed.permission.reply mode must be once, always, all, bypass, or deny.')
    return handleFeedReply(params, kind as ManagedAiSessionDecisionKind, mode, cleanText(params.message || params.reason || params.feedback))
  }
  if (action === 'question.reply') {
    const message = feedReplyMessage(params)
    if (!message) return fail('FEED_QUESTION_REPLY_REQUIRED', 'feed.question.reply requires selections, answer, or message.')
    return handleFeedReply(params, 'reply', 'reply', message)
  }
  if (action === 'exit_plan.reply') {
    const mode = cleanText(params.mode || params.decision || params.kind || 'manual') || 'manual'
    const kind = feedDecisionKindForExitPlanMode(mode)
    if (!kind) return fail('FEED_EXIT_PLAN_MODE_INVALID', 'feed.exit_plan.reply mode must be ultraplan, bypassPermissions, autoAccept, manual, or deny.')
    return handleFeedReply(params, kind as ManagedAiSessionDecisionKind, mode, cleanText(params.feedback || params.message || params.reason))
  }
  if (action === 'mark-handled' || action === 'mark_read' || action === 'mark-read') {
    return handleAgentSessionControlRequest('agent.session.bulk', { ...params, operation: 'mark-handled' })
  }
  if (action === 'clear-ended') return handleAgentSessionControlRequest('agent.session.bulk', { ...params, operation: 'clear-ended' })
  if (action === 'clear') return handleAgentSessionControlRequest('agent.session.bulk', { ...params, operation: 'clear-all', confirm: params.confirm === true || params.yes === true })
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm feed method: ${method}`)
}

const activeWindow = () => {
  const windows = runtime.getWindows?.().filter((window) => !window.isDestroyed()) || []
  return windows.find((window) => window.isFocused()) || windows[0] || null
}

const dispatchRendererControlRequest = (method: string, params: Record<string, unknown> = {}, options: { focus?: boolean } = {}) => {
  const target = activeWindow()
  if (!target) return Promise.resolve(fail('NO_APP_WINDOW', 'No aiopsterm window is available for this control request.'))
  if (options.focus) runtime.focusWindow?.(target)
  const id = randomUUID()
  const timeoutMs = normalizeTimeoutMs(params.timeoutMs)
  const request: ControlRequest = { id, method, params }
  return new Promise<ControlResponse>((resolve) => {
    const timer = setTimeout(() => {
      pendingRendererRequests.delete(id)
      resolve(fail('CONTROL_REQUEST_TIMEOUT', `Control request ${method} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
    pendingRendererRequests.set(id, { resolve, timer })
    const sent = sendWindowEvent(target, 'control:request', request)
    if (!sent) {
      clearTimeout(timer)
      pendingRendererRequests.delete(id)
      resolve(fail('CONTROL_RENDERER_UNAVAILABLE', 'The selected aiopsterm window cannot receive control requests.'))
    }
  })
}

const isMobileTerminalMethod = (method: string) =>
  [
    'mobile.workspace.list',
    'mobile.terminal.create',
    'terminal.create',
    'mobile.terminal.input',
    'terminal.input',
    'mobile.terminal.paste',
    'terminal.paste',
    'mobile.terminal.paste_image',
    'terminal.paste_image',
    'mobile.terminal.replay',
    'terminal.replay',
    'mobile.terminal.viewport',
    'terminal.viewport',
    'mobile.terminal.scroll',
    'terminal.scroll',
    'mobile.terminal.mouse',
    'terminal.mouse'
  ].includes(method)

const mobileHostStatus = async (params: Record<string, unknown>) => {
  const response = await dispatchRendererControlRequest('workspace.snapshot', params)
  const snapshot = response.ok && response.data?.snapshot && typeof response.data.snapshot === 'object' ? (response.data.snapshot as Record<string, unknown>) : null
  return ok({
    app: 'aiopsterm',
    protocol: 'aiopsterm-control',
    version: 1,
    hostname: process.env.HOSTNAME || '',
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    route: 'local-control-socket',
    capabilities: [
      'events.v1',
      'workspace.list.v1',
      'terminal.input.v1',
      'terminal.paste.v1',
      'terminal.replay.v1',
      'terminal.viewport.v1'
    ],
    workspace_count: Array.isArray(snapshot?.workspaces) ? snapshot.workspaces.length : 0,
    terminal_count: Array.isArray(snapshot?.terminals) ? snapshot.terminals.length : 0,
    active_surface_id: cleanText(snapshot?.activePanelId),
    socketPath,
    private: true,
    snapshot
  })
}

const normalizeMobileTerminalMethod = (method: string) => {
  if (method === 'mobile.terminal.create' || method === 'terminal.create') return 'surface.create'
  return method
}

const handleMobileTerminalControlRequest = async (method: string, params: Record<string, unknown>) => {
  if (method === 'mobile.terminal.paste_image' || method === 'terminal.paste_image') {
    return ok({
      workspace_id: cleanText(params.workspace_id || params.workspaceId) || 'main',
      surface_id: cleanText(params.surface_id || params.surfaceId || params.panelId),
      unsupported: true,
      unsupportedReason: 'aiopsterm does not accept image paste payloads through the control socket yet.'
    })
  }
  const rendererMethod = normalizeMobileTerminalMethod(method)
  const response = await dispatchRendererControlRequest(rendererMethod, params, { focus: method.includes('.input') || method.includes('.paste') })
  if (rendererMethod === 'surface.create') publishRendererMutationEvent('surface.create', params, response)
  return response
}

const rendererMutationEventName = (method: string) => {
  if (method === 'project.open') return 'project.opened'
  if (method.startsWith('project.set_')) return 'project.updated'
  if (method === 'markdown.open') return 'markdown.opened'
  if (method === 'file.open') return 'file.opened'
  if (method.startsWith('workspace.group.') && method !== 'workspace.group.list') return method.replace('workspace.group.', 'workspace_group.')
  if (method.startsWith('surface.resume.') && !['surface.resume.get', 'surface.resume.show', 'surface.resume.preview', 'surface.resume.autorun.preview'].includes(method)) return method.replace('surface.resume.', 'surface_resume.')
  if (method === 'surface.focus') return 'surface.focused'
  if (method === 'surface.create') return 'surface.created'
  if (method === 'surface.action' || method === 'tab.action') return 'surface.actioned'
  if (method === 'surface.report_tty') return 'surface.tty_reported'
  if (method === 'surface.report_shell_state') return 'surface.shell_state_reported'
  if (method === 'surface.ports_kick') return 'surface.ports_kicked'
  if (method === 'surface.move') return 'surface.moved'
  if (method === 'surface.reorder') return 'surface.reordered'
  if (method === 'surface.drag_to_split' || method === 'surface.split_off') return 'surface.split_off'
  if (method === 'surface.refresh') return 'surface.refreshed'
  if (method === 'surface.trigger_flash') return 'surface.flashed'
  if (method === 'workspace.reorder') return 'workspace.reordered'
  if (method === 'workspace.reorder_many') return 'workspace.reordered_many'
  if (method === 'workspace.equalize_splits') return 'workspace.splits_equalized'
  if (method === 'workspace.prompt_submit') return 'workspace.prompt_submitted'
  if (method === 'workspace.action') return 'workspace.actioned'
  if (method === 'workspace.set_auto_title') return 'workspace.auto_title_set'
  if (method === 'workspace.remote.configure') return 'workspace_remote.configured'
  if (method === 'workspace.remote.reconnect') return 'workspace_remote.reconnected'
  if (method === 'workspace.remote.disconnect') return 'workspace_remote.disconnected'
  if (method === 'workspace.remote.foreground_auth_ready') return 'workspace_remote.foreground_auth_ready'
  if (method === 'workspace.remote.pty_attach_end') return 'workspace_remote.pty_attach_ended'
  if (method === 'workspace.remote.terminal_session_end') return 'workspace_remote.terminal_session_ended'
  if (method.startsWith('workspace.remote.pty_')) return 'workspace_remote.pty_unsupported'
  if (method.startsWith('remote.tmux.')) return 'remote_tmux.unsupported'
  if (method === 'pane.break') return 'pane.broken'
  if (method === 'pane.join') return 'pane.joined'
  if (method === 'pane.swap') return 'pane.swapped'
  if (method === 'pane.resize') return 'pane.resize_rejected'
  if (method === 'pane.focus') return 'pane.focused'
  if (method === 'pane.last') return 'pane.focused'
  if (method === 'workspace.select') return 'workspace.selected'
  if (method === 'workspace.next') return 'workspace.selected'
  if (method === 'workspace.previous') return 'workspace.selected'
  if (method === 'workspace.last') return 'workspace.selected'
  if (method === 'workspace.create') return 'workspace.created'
  if (method === 'pane.create') return 'pane.created'
  if (method === 'surface.split') return 'pane.created'
  if (method === 'workspace.rename') return 'workspace.renamed'
  if (method === 'workspace.close') return 'workspace.closed'
  if (method === 'surface.close') return 'pane.closed'
  if (method === 'workspace.select_layout') return 'workspace.layout_selected'
  if (method === 'agent-hibernation.on') return 'agent_hibernation.enabled'
  if (method === 'agent-hibernation.off') return 'agent_hibernation.disabled'
  if (method === 'agent.hibernate') return 'agent.hibernated'
  if (method === 'agent.resume') return 'agent.resumed'
  if (method === 'agent-hibernation.sweep' || method === 'agent.sweep') return 'agent_hibernation.swept'
  if (method === 'agent.team.launch') return 'agent_team.launched'
  return ''
}

const rendererMutationCategory = (method: string) => {
  if (method.startsWith('project.') || method === 'markdown.open' || method === 'file.open') return 'project'
  if (method.startsWith('workspace.group.')) return 'workspace'
  if (method.startsWith('workspace.')) return 'workspace'
  if (method.startsWith('remote.tmux.')) return 'workspace'
  if (method.startsWith('surface.')) return method === 'surface.split' || method === 'surface.close' ? 'pane' : 'surface'
  if (method.startsWith('pane.')) return 'pane'
  if (method.startsWith('agent-hibernation.') || method.startsWith('agent.')) return 'agent'
  return 'control'
}

const publishRendererMutationEvent = (method: string, params: Record<string, unknown>, response: ControlResponse) => {
  if (!response.ok) return
  const name = rendererMutationEventName(method)
  if (!name) return
  const data = response.data || {}
  if (
    method === 'workspace.set_auto_title' &&
    data.workspaceApplied !== true &&
    data.workspace_applied !== true &&
    data.panelApplied !== true &&
    data.panel_applied !== true &&
    data.recorded !== true
  ) {
    return
  }
  const group = data.group && typeof data.group === 'object' ? (data.group as Record<string, unknown>) : null
  const team = data.team && typeof data.team === 'object' ? (data.team as Record<string, unknown>) : null
  const session = data.session && typeof data.session === 'object' ? (data.session as Record<string, unknown>) : null
  const surface = data.surface && typeof data.surface === 'object' ? (data.surface as Record<string, unknown>) : null
  const pane = data.pane && typeof data.pane === 'object' ? (data.pane as Record<string, unknown>) : null
  const createdSurface = data.createdSurface && typeof data.createdSurface === 'object' ? (data.createdSurface as Record<string, unknown>) : null
  const created_surface = data.created_surface && typeof data.created_surface === 'object' ? (data.created_surface as Record<string, unknown>) : null
  const selectedPane = data.selectedPane && typeof data.selectedPane === 'object' ? (data.selectedPane as Record<string, unknown>) : null
  const createdPane = data.createdPane && typeof data.createdPane === 'object' ? (data.createdPane as Record<string, unknown>) : null
  const closedPane = data.closedPane && typeof data.closedPane === 'object' ? (data.closedPane as Record<string, unknown>) : null
  const renamedPane = data.renamedPane && typeof data.renamedPane === 'object' ? (data.renamedPane as Record<string, unknown>) : null
  const targetPane = data.targetPane && typeof data.targetPane === 'object' ? (data.targetPane as Record<string, unknown>) : null
  const config = data.config && typeof data.config === 'object' ? (data.config as Record<string, unknown>) : null
  const remote = data.remote && typeof data.remote === 'object' ? (data.remote as Record<string, unknown>) : null
  const hibernated = Array.isArray(data.hibernated) ? data.hibernated : []
  publishControlEvent({
    name,
    category: rendererMutationCategory(method),
    source: 'control.socket',
    surfaceId: cleanText(data.surfaceId || data.surface_id || surface?.panelId || pane?.panelId || createdSurface?.panelId || created_surface?.panelId || selectedPane?.panelId || createdPane?.panelId || closedPane?.panelId || renamedPane?.panelId || params.panelId || params.surfaceId || params.paneId),
    payload: {
      method,
      ...(group
        ? {
            group_id: group.id,
            group_ref: group.ref,
            group_name: group.name,
            member_count: group.memberCount
          }
        : {}),
      ...(team
        ? {
            source: team.source,
            requested_count: team.requestedCount,
            launched_count: team.launchedCount,
            approval_count: team.approvalCount,
            failed_count: team.failedCount
          }
        : {}),
      ...(session
        ? {
            session_id: session.id,
            source: session.source,
            state: session.state
          }
        : {}),
      ...(surface ? { surface_id: surface.panelId, surface_kind: surface.surfaceKind } : {}),
      ...(pane
        ? {
            pane_id: pane.panelId,
            panel_id: pane.panelId,
            split_group_id: pane.splitGroupId
          }
        : {}),
      ...(createdSurface || created_surface ? { created_surface_id: cleanText(createdSurface?.panelId || created_surface?.panelId), created_panel_id: cleanText(createdSurface?.panelId || created_surface?.panelId) } : {}),
      ...(selectedPane
        ? {
            selected_pane_id: selectedPane.panelId,
            selected_panel_id: selectedPane.panelId,
            previous_panel_id: cleanText(data.previousActivePanelId),
            action: cleanText(data.action)
          }
        : {}),
      ...(createdPane ? { created_pane_id: createdPane.panelId, created_panel_id: createdPane.panelId } : {}),
      ...(closedPane ? { closed_pane_id: closedPane.panelId, closed_panel_id: closedPane.panelId } : {}),
      ...(renamedPane ? { renamed_pane_id: renamedPane.panelId, renamed_panel_id: renamedPane.panelId, title: renamedPane.title } : {}),
      ...(targetPane
        ? {
            target_pane_id: targetPane.panelId,
            target_panel_id: targetPane.panelId,
            target_split_group_id: targetPane.splitGroupId
          }
        : {}),
      ...(method === 'surface.report_tty' ? { tty_name: cleanText(data.ttyName || data.tty_name || params.ttyName || params.tty_name) } : {}),
      ...(method === 'surface.report_shell_state'
        ? {
            state: cleanText(data.state || data.shellState || data.shell_state || params.state || params.shellState || params.shell_state),
            published: data.published === true
          }
        : {}),
      ...(method === 'surface.ports_kick'
        ? {
            reason: cleanText(data.reason || params.reason) || 'command',
            kicked: data.kicked === true,
            port_scan_started: data.portScanStarted === true || data.port_scan_started === true
          }
        : {}),
      ...(method.startsWith('workspace.remote.') || method.startsWith('remote.tmux.')
        ? {
            remote_state: cleanText(remote?.connection_state || remote?.connectionState || remote?.state),
            remote_display_target: cleanText(remote?.remote_display_target || remote?.remoteDisplayTarget || remote?.displayTarget),
            destination: cleanText(remote?.destination || remote?.host || data.host || params.destination || params.host),
            reconnected: data.reconnected === true,
            disconnected: data.disconnected === true,
            unsupported: data.unsupported === true
          }
        : {}),
      ...(typeof data.unsupportedReason === 'string' ? { unsupported_reason: data.unsupportedReason } : {}),
      ...(method === 'workspace.set_auto_title'
        ? {
            title: cleanText(data.title),
            workspace_applied: data.workspaceApplied === true || data.workspace_applied === true,
            panel_applied: data.panelApplied === true || data.panel_applied === true,
            panel_id: cleanText(data.panel_id || data.panelId || params.panel_id || params.panelId)
          }
        : {}),
      ...(config ? { enabled: config.enabled } : {}),
      ...(method === 'agent-hibernation.sweep' || method === 'agent.sweep'
        ? {
            live_restorable_count: typeof data.liveRestorableCount === 'number' ? data.liveRestorableCount : 0,
            eligible_count: typeof data.eligibleCount === 'number' ? data.eligibleCount : 0,
            selected_count: typeof data.selectedCount === 'number' ? data.selectedCount : 0,
            pending_count: typeof data.pendingCount === 'number' ? data.pendingCount : 0,
            hibernated_count: typeof data.hibernatedCount === 'number' ? data.hibernatedCount : hibernated.length,
            hibernated_sessions: hibernated
              .map((item) => (item && typeof item === 'object' ? { source: (item as Record<string, unknown>).source, session_id: (item as Record<string, unknown>).id } : null))
              .filter(Boolean)
          }
        : {}),
      ...(method.startsWith('surface.resume.') ? { has_resume_binding: Boolean(data.resumeBinding || data.resume_binding) } : {})
    }
  })
}

const handleControlRequest = async (request: ControlSocketRequest): Promise<ControlResponse> => {
  const method = cleanText(request.method)
  const params = request.params || {}
  if (!method || method === 'ping' || method === 'system.ping') return ok({ pong: true, socketPath })
  if (method === 'system.capabilities' || method === 'capabilities') return systemCapabilities()
  if (method === 'system.identify' || method === 'identify') return systemIdentify(params)
  if (method === 'workspace.context' || method === 'context') return workspaceContextPayload(params)
  if (method === 'mobile.host.status') return mobileHostStatus(params)
  if (
    method === 'auth.login' ||
    method === 'auth.status' ||
    method === 'auth.sign_in_url' ||
    method === 'auth.begin_sign_in' ||
    method === 'auth.sign_out' ||
    method === 'session.restore_previous' ||
    method === 'system.tree' ||
    method === 'system.top' ||
    method === 'system.memory' ||
    method === 'settings.open' ||
    method === 'feedback.open' ||
    method === 'feedback.submit' ||
    method === 'extension.sidebar.snapshot' ||
    method === 'app.focus_override.set' ||
    method === 'app.simulate_active'
  ) {
    return handleSystemCompatibilityRequest(method, params)
  }
  if (method.startsWith('window.')) return handleWindowControlRequest(method, params)
  if (isWaitForMethod(method)) return handleWaitForControlRequest(method, params)
  if (isSidebarCustomMethod(method)) return handleSidebarCustomControlRequest(method, params)
  if (isSidebarMetadataMethod(method)) return handleSidebarMetadataControlRequest(method, params)
  if (isTerminalBufferMethod(method)) return handleTerminalBufferControlRequest(method, params)
  if (isTmuxCompatMethod(method)) return handleTmuxCompatControlRequest(method, params)
  if (isEventListMethod(method)) return listEvents(params)
  if (isMobileEventsMethod(method)) return handleMobileEventsControlRequest(method, params)
  if (isMobileChatMethod(method)) return handleMobileChatControlRequest(method, params)
  if (isMobileAttachTicketMethod(method)) return handleMobileAttachTicketControlRequest(params)
  if (isFeedMethod(method)) return handleFeedControlRequest(method, params)
  if (isCloudVmMethod(method)) return handleCloudVmControlRequest(method, params)
  if (isCloudRemotesMethod(method)) return handleCloudRemotesControlRequest(method, params)
  if (isAgentHooksMethod(method)) return handleAgentHooksControlRequest(method, params)
  if (isAgentVaultMethod(method)) return handleAgentVaultControlRequest(method, params)
  if (isAgentSessionMethod(method)) return handleAgentSessionControlRequest(method, params)
  if (isSessionMethod(method)) return handleSessionControlRequest(method, params)
  if (isMobileTerminalMethod(method)) return handleMobileTerminalControlRequest(method, params)
  if (isProjectFileControlMethod(method)) {
    const response = await dispatchRendererControlRequest(method, params, { focus: ['project.open', 'markdown.open', 'file.open'].includes(method) && params.focus !== false })
    publishRendererMutationEvent(method, params, response)
    return response
  }
  if (
    method === 'workspace.snapshot' ||
    method === 'workspace.list' ||
    method === 'workspace.current' ||
    method.startsWith('workspace.group.') ||
    method === 'surface.list' ||
    method === 'surface.current' ||
    method.startsWith('surface.resume.') ||
    method === 'surface.focus' ||
    method === 'surface.create' ||
    method === 'surface.report_tty' ||
    method === 'surface.report_shell_state' ||
    method === 'surface.ports_kick' ||
    method === 'workspace.next' ||
    method === 'workspace.previous' ||
    method === 'workspace.last' ||
    method === 'workspace.select' ||
    method === 'workspace.find' ||
    method === 'workspace.create' ||
    method === 'workspace.rename' ||
    method === 'workspace.close' ||
    method === 'workspace.reorder' ||
    method === 'workspace.reorder_many' ||
    method === 'workspace.move_to_window' ||
    method === 'workspace.equalize_splits' ||
    method === 'workspace.prompt_submit' ||
    method === 'workspace.action' ||
    method === 'workspace.env' ||
    method === 'workspace.set_auto_title' ||
    method.startsWith('workspace.remote.') ||
    method.startsWith('remote.tmux.') ||
    method === 'workspace.has_session' ||
    method === 'workspace.select_layout' ||
    method === 'pane.list' ||
    method === 'pane.surfaces' ||
    method === 'pane.create' ||
    method === 'pane.focus' ||
    method === 'pane.last' ||
    method === 'surface.split' ||
    method === 'surface.close' ||
    method === 'surface.move' ||
    method === 'surface.reorder' ||
    method === 'surface.action' ||
    method === 'tab.action' ||
    method === 'surface.drag_to_split' ||
    method === 'surface.split_off' ||
    method === 'surface.refresh' ||
    method === 'surface.health' ||
    method === 'surface.trigger_flash' ||
    method === 'pane.break' ||
    method === 'pane.join' ||
    method === 'pane.swap' ||
    method === 'pane.resize' ||
    method.startsWith('session.') ||
    method.startsWith('agent-hibernation.') ||
    method.startsWith('agent.') ||
    method.startsWith('agent.team.') ||
    method === 'tree' ||
    method === 'top'
  ) {
    const rendererParamsOrResponse = method === 'agent.team.launch' ? await prepareAgentVaultTeamLaunchParams(params) : params
    if ('ok' in rendererParamsOrResponse && rendererParamsOrResponse.ok === false) return rendererParamsOrResponse as ControlResponse
    const rendererParams = rendererParamsOrResponse as Record<string, unknown>
    const response = await dispatchRendererControlRequest(method, rendererParams)
    publishRendererMutationEvent(method, rendererParams, response)
    return response
  }
  if (method === 'list_workspaces') return dispatchRendererControlRequest('workspace.list', params)
  if (method === 'list_surfaces') return dispatchRendererControlRequest('surface.list', params)
  if (method === 'refresh-surfaces' || method === 'refresh_surfaces') {
    const response = await dispatchRendererControlRequest('surface.refresh', params)
    publishRendererMutationEvent('surface.refresh', params, response)
    return response
  }
  if (method === 'surface-health' || method === 'surface_health') return dispatchRendererControlRequest('surface.health', params)
  if (method === 'trigger-flash' || method === 'trigger_flash') {
    const response = await dispatchRendererControlRequest('surface.trigger_flash', params, { focus: true })
    publishRendererMutationEvent('surface.trigger_flash', params, response)
    return response
  }
  if (method === 'move-surface') {
    const response = await dispatchRendererControlRequest('surface.move', params)
    publishRendererMutationEvent('surface.move', params, response)
    return response
  }
  if (method === 'reorder-surface') {
    const response = await dispatchRendererControlRequest('surface.reorder', params)
    publishRendererMutationEvent('surface.reorder', params, response)
    return response
  }
  if (method === 'split-off' || method === 'drag-surface-to-split') {
    const response = await dispatchRendererControlRequest('surface.split_off', params)
    publishRendererMutationEvent('surface.split_off', params, response)
    return response
  }
  if (method === 'reorder-workspace') {
    const response = await dispatchRendererControlRequest('workspace.reorder', params)
    publishRendererMutationEvent('workspace.reorder', params, response)
    return response
  }
  if (method === 'reorder-workspaces') {
    const response = await dispatchRendererControlRequest('workspace.reorder_many', params)
    publishRendererMutationEvent('workspace.reorder_many', params, response)
    return response
  }
  if (method === 'move-workspace-to-window') {
    const response = await dispatchRendererControlRequest('workspace.move_to_window', params)
    publishRendererMutationEvent('workspace.move_to_window', params, response)
    return response
  }
  if (method === 'new-workspace') {
    const response = await dispatchRendererControlRequest('workspace.create', params, { focus: params.focus !== false })
    publishRendererMutationEvent('workspace.create', params, response)
    return response
  }
  if (method === 'current-workspace') return dispatchRendererControlRequest('workspace.current', params)
  if (method === 'select-workspace') {
    const response = await dispatchRendererControlRequest('workspace.select', params, { focus: true })
    publishRendererMutationEvent('workspace.select', params, response)
    return response
  }
  if (method === 'close-workspace') {
    const response = await dispatchRendererControlRequest('workspace.close', params)
    publishRendererMutationEvent('workspace.close', params, response)
    return response
  }
  if (method === 'list-panels') return dispatchRendererControlRequest('surface.list', params)
  if (method === 'list-pane-surfaces') return dispatchRendererControlRequest('pane.surfaces', params)
  if (method === 'close-surface') {
    const response = await dispatchRendererControlRequest('surface.close', params)
    publishRendererMutationEvent('surface.close', params, response)
    return response
  }
  if (method === 'surface-focus' || method === 'focus-surface') {
    const response = await dispatchRendererControlRequest('surface.focus', params, { focus: true })
    publishRendererMutationEvent('surface.focus', params, response)
    return response
  }
  if (method === 'create-surface' || method === 'new-surface') {
    const response = await dispatchRendererControlRequest('surface.create', params, { focus: params.focus === true })
    publishRendererMutationEvent('surface.create', params, response)
    return response
  }
  if (method === 'create-pane') {
    const response = await dispatchRendererControlRequest('pane.create', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.create', params, response)
    return response
  }
  if (method === 'report_tty' || method === 'report-tty') {
    const response = await dispatchRendererControlRequest('surface.report_tty', params)
    publishRendererMutationEvent('surface.report_tty', params, response)
    return response
  }
  if (method === 'report_shell_state' || method === 'report-shell-state') {
    const response = await dispatchRendererControlRequest('surface.report_shell_state', params)
    publishRendererMutationEvent('surface.report_shell_state', params, response)
    return response
  }
  if (method === 'ports_kick' || method === 'ports-kick') {
    const response = await dispatchRendererControlRequest('surface.ports_kick', params)
    publishRendererMutationEvent('surface.ports_kick', params, response)
    return response
  }
  if (method === 'new-split' || method === 'new-pane') {
    const response = await dispatchRendererControlRequest('surface.split', params, { focus: params.focus === true })
    publishRendererMutationEvent('surface.split', params, response)
    return response
  }
  if (method === 'list-windows' || method === 'lsw') return dispatchRendererControlRequest('workspace.list', params)
  if (method === 'current-window' || method === 'currentw') return dispatchRendererControlRequest('workspace.current', params)
  if (method === 'list-panes' || method === 'lsp') return dispatchRendererControlRequest('pane.list', params)
  if (method === 'new-window' || method === 'neww') {
    const response = await dispatchRendererControlRequest('workspace.create', params, { focus: params.focus !== false })
    publishRendererMutationEvent('workspace.create', params, response)
    return response
  }
  if (method === 'split-window' || method === 'splitw') {
    const response = await dispatchRendererControlRequest('surface.split', params, { focus: params.focus !== false })
    publishRendererMutationEvent('surface.split', params, response)
    return response
  }
  if (method === 'rename-window' || method === 'renamew' || method === 'rename-workspace') {
    const response = await dispatchRendererControlRequest('workspace.rename', params)
    publishRendererMutationEvent('workspace.rename', params, response)
    return response
  }
  if (method === 'kill-window' || method === 'killw') {
    const response = await dispatchRendererControlRequest('workspace.close', params)
    publishRendererMutationEvent('workspace.close', params, response)
    return response
  }
  if (method === 'kill-pane' || method === 'killp') {
    const response = await dispatchRendererControlRequest('surface.close', params)
    publishRendererMutationEvent('surface.close', params, response)
    return response
  }
  if (method === 'has-session' || method === 'has') return dispatchRendererControlRequest('workspace.has_session', params)
  if (method === 'select-layout') {
    const response = await dispatchRendererControlRequest('workspace.select_layout', params)
    publishRendererMutationEvent('workspace.select_layout', params, response)
    return response
  }
  if (method === 'next-window' || method === 'nextw') {
    const response = await dispatchRendererControlRequest('workspace.next', params, { focus: true })
    publishRendererMutationEvent('workspace.next', params, response)
    return response
  }
  if (method === 'previous-window' || method === 'prev-window' || method === 'previousw' || method === 'prevw') {
    const response = await dispatchRendererControlRequest('workspace.previous', params, { focus: true })
    publishRendererMutationEvent('workspace.previous', params, response)
    return response
  }
  if (method === 'last-window' || method === 'lastw') {
    const response = await dispatchRendererControlRequest('workspace.last', params, { focus: true })
    publishRendererMutationEvent('workspace.last', params, response)
    return response
  }
  if (method === 'select-window' || method === 'selectw') {
    const response = await dispatchRendererControlRequest('workspace.select', params, { focus: true })
    publishRendererMutationEvent('workspace.select', params, response)
    return response
  }
  if (method === 'select-pane' || method === 'selectp' || method === 'focus-pane') {
    const response = await dispatchRendererControlRequest('pane.focus', params, { focus: true })
    publishRendererMutationEvent('pane.focus', params, response)
    return response
  }
  if (method === 'last-pane' || method === 'lastp') {
    const response = await dispatchRendererControlRequest('pane.last', params, { focus: true })
    publishRendererMutationEvent('pane.last', params, response)
    return response
  }
  if (method === 'find-window' || method === 'findw') return dispatchRendererControlRequest('workspace.find', params, { focus: params.select === true })
  if (method === 'break-pane' || method === 'breakp') {
    const response = await dispatchRendererControlRequest('pane.break', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.break', params, response)
    return response
  }
  if (method === 'join-pane' || method === 'joinp') {
    const response = await dispatchRendererControlRequest('pane.join', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.join', params, response)
    return response
  }
  if (method === 'swap-pane' || method === 'swapp') {
    const response = await dispatchRendererControlRequest('pane.swap', params, { focus: params.focus === true })
    publishRendererMutationEvent('pane.swap', params, response)
    return response
  }
  if (method === 'resize-pane' || method === 'resizep') {
    const response = await dispatchRendererControlRequest('pane.resize', params)
    publishRendererMutationEvent('pane.resize', params, response)
    return response
  }
  if (method === 'terminal.list' || method === 'list_terminals' || method === 'debug.terminals') return dispatchRendererControlRequest('terminal.list', params)
  if (method === 'terminal.focus' || method === 'focus_terminal' || method === 'focus-panel') {
    const response = await dispatchRendererControlRequest('terminal.focus', params, { focus: true })
    if (response.ok) {
      const data = response.data || {}
      const terminal = data.terminal && typeof data.terminal === 'object' ? (data.terminal as Record<string, unknown>) : null
      publishControlEvent({
        name: 'terminal.focused',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: cleanText(terminal?.panelId || params.panelId),
        payload: {
          panel_id: cleanText(terminal?.panelId || params.panelId),
          session_id: cleanText(terminal?.sessionId || params.sessionId)
        }
      })
    }
    return response
  }
  if (method === 'terminal.read_screen' || method === 'surface.read_text' || method === 'capture-pane' || method === 'read-screen') return dispatchRendererControlRequest('terminal.read_screen', params)
  if (method === 'terminal.clear_history' || method === 'surface.clear_history' || method === 'clear-history') {
    const response = await dispatchRendererControlRequest('terminal.clear_history', params)
    if (response.ok) {
      const data = response.data || {}
      const terminal = data.terminal && typeof data.terminal === 'object' ? (data.terminal as Record<string, unknown>) : null
      publishControlEvent({
        name: 'terminal.history_cleared',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: cleanText(terminal?.panelId || params.panelId || params.surfaceId),
        payload: {
          panel_id: cleanText(terminal?.panelId || params.panelId || params.surfaceId),
          session_id: cleanText(terminal?.sessionId || params.sessionId || params.terminalSessionId)
        }
      })
    }
    return response
  }
  if (method === 'terminal.respawn' || method === 'surface.respawn' || method === 'respawn-pane') {
    const response = await dispatchRendererControlRequest('surface.respawn', params)
    if (response.ok) {
      const data = response.data || {}
      const surface = data.surface && typeof data.surface === 'object' ? (data.surface as Record<string, unknown>) : null
      const terminal = data.terminal && typeof data.terminal === 'object' ? (data.terminal as Record<string, unknown>) : null
      const decision = data.decision && typeof data.decision === 'object' ? (data.decision as Record<string, unknown>) : null
      publishControlEvent({
        name: 'terminal.respawn_requested',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: cleanText(surface?.panelId || terminal?.panelId || params.panelId || params.surfaceId),
        payload: {
          panel_id: cleanText(surface?.panelId || terminal?.panelId || params.panelId || params.surfaceId),
          session_id: cleanText(terminal?.sessionId || params.sessionId || params.terminalSessionId),
          command_length: cleanText(data.command || params.command || params.tmux_start_command).length,
          decision_status: cleanText(decision?.status)
        }
      })
    }
    return response
  }
  if (method === 'terminal.send_text' || method === 'surface.send_text' || method === 'send' || method === 'send-panel') return sendTerminalText(params)
  if (method === 'terminal.send_key' || method === 'surface.send_key' || method === 'send-key' || method === 'send-key-panel') return sendTerminalKey(params)
  if (method === 'notification.create' || method === 'notify') return createNotification(params)
  if (method === 'notification.create_for_caller') return createCallerNotification(params)
  if (method === 'notification.create_for_surface' || method === 'notify-surface') return createTargetedNotification(method, params)
  if (method === 'notification.create_for_target' || method === 'notify-target') return createTargetedNotification(method, params)
  if (method === 'notification.list' || method === 'list-notifications') return listNotifications(params)
  if (method === 'notification.mark_read' || method === 'mark-notification-read') return markNotificationRead(params)
  if (method === 'notification.dismiss' || method === 'dismiss-notification') return dismissNotification(params)
  if (method === 'notification.clear' || method === 'clear-notifications') return clearNotifications()
  if (method === 'notification.open' || method === 'open-notification') return openNotification(params)
  if (method === 'notification.jump_to_unread' || method === 'jump-to-unread') return jumpToUnreadNotification()
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm control method: ${method}`)
}

const writeSocketResponse = (socket: Socket, id: string | undefined, response: ControlResponse) => {
  socket.write(`${JSON.stringify({ id, ...response })}\n`)
}

export const configureControlSocketRuntime = (config: ControlSocketRuntime = {}) => {
  runtime = { ...runtime, ...config }
  configureControlSocketStateRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {}),
    dispatchRendererControlRequest,
    showNotification: runtime.showNotification
  })
  configureAgentVaultRuntime({
    ...(runtime.userDataPath ? { userDataPath: runtime.userDataPath } : {}),
    dispatchRendererControlRequest,
    publishControlEvent
  })
  configureControlSocketTerminalTools({
    writeTerminal: runtime.writeTerminal,
    dispatchRendererControlRequest,
    publishControlEvent
  })
}

export const getControlSocketPath = () => socketPath

export const registerControlSocketIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('control:invoke', (_event, method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params }))
  ipcMain.handle('control:response', (_event, id: string, response: ControlResponse) => {
    const pending = pendingRendererRequests.get(id)
    if (!pending) return false
    clearTimeout(pending.timer)
    pendingRendererRequests.delete(id)
    pending.resolve(response)
    return true
  })
}

export const ensureControlSocketServer = async (userDataPath: string) => {
  if (server && socketPath) return socketPath
  socketPath = socketPathFor(userDataPath)
  runtime = { ...runtime, userDataPath }
  configureControlSocketStateRuntime({ userDataPath, dispatchRendererControlRequest, showNotification: runtime.showNotification })
  configureAgentVaultRuntime({ userDataPath, dispatchRendererControlRequest, publishControlEvent })
  configureControlSocketTerminalTools({ writeTerminal: runtime.writeTerminal, dispatchRendererControlRequest, publishControlEvent })
  await loadDurableEventLog(userDataPath)
  await loadAgentVaultStore(userDataPath)
  await loadSessionSnapshotStore(userDataPath)
  await configureAiAgentSessionStore(userDataPath)
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    let buffer = ''
    let streaming = false
    socket.on('data', (chunk) => {
      if (streaming) return
      buffer += chunk.toString('utf8')
      for (;;) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex < 0) return
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue
        let request: ControlSocketRequest
        try {
          request = JSON.parse(line) as ControlSocketRequest
        } catch (error) {
          writeSocketResponse(socket, undefined, fail('INVALID_JSON', error instanceof Error ? error.message : String(error)))
          continue
        }
        if (isEventStreamMethod(request.method)) {
          streaming = true
          startEventStream(socket, request)
          return
        }
        void handleControlRequest(request)
          .then((response) => writeSocketResponse(socket, request.id, response))
          .catch((error) => writeSocketResponse(socket, request.id, fail('CONTROL_REQUEST_FAILED', error instanceof Error ? error.message : String(error))))
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    const failListen = (error: Error) => {
      server?.off('listening', done)
      reject(error)
    }
    const done = () => {
      server?.off('error', failListen)
      resolve()
    }
    server?.once('error', failListen)
    server?.once('listening', done)
    server?.listen(socketPath)
  })
  return socketPath
}

export const closeControlSocketServer = () => {
  for (const pending of pendingRendererRequests.values()) {
    clearTimeout(pending.timer)
    pending.resolve(fail('CONTROL_SOCKET_CLOSED', 'aiopsterm control socket closed before the renderer replied.'))
  }
  pendingRendererRequests.clear()
  closeControlSocketStateRuntime()
  resetControlSocketTerminalTools()
  resetAgentVaultRuntimeState()
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}

export const invokeControlSocketMethod = (method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params })

export const __testing = {
  handleControlRequest,
  listEvents: listEventsForTesting,
  eventLogPathFor,
  listSessionSnapshots: listSessionSnapshotsForTesting,
  sessionSnapshotPathFor,
  listAgentVaultEntries: () => sortedAgentVaultEntries(),
  agentVaultPathFor,
  listNotifications: listNotificationsForTesting,
  listTerminalBuffers,
  listTmuxCompatHooks,
  pendingRendererRequestCount: () => pendingRendererRequests.size,
  eventSubscriptionCount: eventSubscriptionCountForTesting,
  mobileEventSubscriptionCount: mobileEventSubscriptionCountForTesting,
  listMobileEventSubscriptions: listMobileEventSubscriptionsForTesting
}
