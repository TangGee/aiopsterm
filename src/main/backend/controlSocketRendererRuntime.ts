import { randomBytes, randomUUID } from 'crypto'
import { freemem, loadavg, totalmem, uptime } from 'os'
import type { BrowserWindow } from 'electron'
import { sendWindowEvent } from '@shared/windowEvents'
import type {
  ControlNotificationRecord,
  ControlRequest,
  ControlResponse,
  ControlTerminalSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'
import { codingAgentSummaries } from './controlSocketAgentRuntime'
import {
  authStatusPayload,
  feedbackSubmitPayload,
  unsupportedAuthStatusPayload
} from './controlSocketCompatibilityRuntime'
import {
  controlSocketStateSummary,
  handleSessionControlRequest,
  publishControlEvent
} from './controlSocketStateRuntime'

export type ControlSocketRuntime = {
  userDataPath?: string
  socketPath?: string
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

let runtime: ControlSocketRuntime = {}
const pendingRendererRequests = new Map<string, PendingRendererRequest>()

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeTimeoutMs = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultTimeoutMs
  return Math.max(500, Math.min(maxTimeoutMs, Math.round(numberValue)))
}

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const currentSocketPath = () => runtime.socketPath || ''

export const configureControlSocketRendererRuntime = (config: ControlSocketRuntime = {}) => {
  runtime = { ...runtime, ...config }
}

export const pendingRendererRequestCount = () => pendingRendererRequests.size

export const resolvePendingRendererControlResponse = (id: string, response: ControlResponse) => {
  const pending = pendingRendererRequests.get(id)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingRendererRequests.delete(id)
  pending.resolve(response)
  return true
}

export const closePendingRendererControlRequests = () => {
  for (const pending of pendingRendererRequests.values()) {
    clearTimeout(pending.timer)
    pending.resolve(fail('CONTROL_SOCKET_CLOSED', 'aiopsterm control socket closed before the renderer replied.'))
  }
  pendingRendererRequests.clear()
}

export const systemCapabilities = () =>
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
    socketPath: currentSocketPath(),
    capabilities: controlSocketCapabilities
  })

export const systemIdentify = (params: Record<string, unknown> = {}) =>
  ok({
    protocol: 'aiopsterm-control',
    version: 1,
    app: {
      name: 'aiopsterm',
      version: process.env.npm_package_version || '0.1.0'
    },
    socketPath: currentSocketPath(),
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

const activeWindow = () => {
  const windows = appWindows()
  return windows.find((window) => window.isFocused()) || windows[0] || null
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

export const handleWindowControlRequest = async (method: string, params: Record<string, unknown>) => {
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

export const dispatchRendererControlRequest = (method: string, params: Record<string, unknown> = {}, options: { focus?: boolean } = {}) => {
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

export const workspaceContextPayload = async (params: Record<string, unknown>) => {
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
    coding_agents: await codingAgentSummaries(resourceSummary),
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

export const isControlSystemCompatibilityMethod = (method: string) =>
  [
    'auth.login',
    'auth.status',
    'auth.sign_in_url',
    'auth.begin_sign_in',
    'auth.sign_out',
    'session.restore_previous',
    'system.tree',
    'system.top',
    'system.memory',
    'settings.open',
    'feedback.open',
    'feedback.submit',
    'extension.sidebar.snapshot',
    'app.focus_override.set',
    'app.simulate_active'
  ].includes(method)

export const handleControlSystemCompatibilityRequest = async (method: string, params: Record<string, unknown>) => {
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

export const isControlProjectFileMethod = (method: string) => projectFileControlMethods.has(method)

export const isControlMobileAttachTicketMethod = (method: string) => method === 'mobile.attach_ticket.create'

const normalizeAttachTicketTtlSeconds = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 600
  return Math.max(30, Math.min(3600, Math.floor(numberValue)))
}

const attachTicketDeviceId = () => {
  const seed = runtime.userDataPath || process.cwd()
  return `aiopsterm-${Buffer.from(seed).toString('base64url').slice(0, 24) || process.pid}`
}

export const handleMobileAttachTicketControlRequest = (params: Record<string, unknown>) => {
  const ttlSeconds = normalizeAttachTicketTtlSeconds(params.ttl_seconds ?? params.ttlSeconds ?? params.ttl)
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString()
  const workspaceId = cleanText(params.scope).toLowerCase() === 'mac' ? '' : cleanText(params.workspace_id || params.workspaceId || params.workspace) || 'main'
  const terminalId = cleanText(params.terminal_id || params.terminalId || params.surface_id || params.surfaceId || params.panelId)
  const authToken = randomBytes(32).toString('base64url')
  const socketPath = currentSocketPath()
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

export const isControlMobileTerminalMethod = (method: string) =>
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

export const mobileHostStatus = async (params: Record<string, unknown>) => {
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
    socketPath: currentSocketPath(),
    private: true,
    snapshot
  })
}

const normalizeMobileTerminalMethod = (method: string) => {
  if (method === 'mobile.terminal.create' || method === 'terminal.create') return 'surface.create'
  return method
}

export const handleMobileTerminalControlRequest = async (method: string, params: Record<string, unknown>) => {
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

export const publishRendererMutationEvent = (method: string, params: Record<string, unknown>, response: ControlResponse) => {
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
