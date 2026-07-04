import { freemem, loadavg, totalmem, uptime } from 'os'
import type { BrowserWindow } from 'electron'
import type { ControlResponse } from '@shared/contracts/control'
import { codingAgentSummaries } from './controlSocketAgentRuntime'
import { controlSocketNotificationSummary } from './controlSocketNotificationRuntime'
import { controlSocketStateSummary } from './controlSocketStateRuntime'

type ControlSocketSystemRuntime = {
  userDataPath?: string
  socketPath?: string
  getWindows?: () => BrowserWindow[]
  dispatchRendererControlRequest?: (method: string, params?: Record<string, unknown>, options?: { focus?: boolean }) => Promise<ControlResponse> | ControlResponse
}

export const controlSocketCapabilities = [
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
  'settings.values',
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
  'asset.hosts',
  'asset.ssh',
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

let runtime: ControlSocketSystemRuntime = {}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const currentSocketPath = () => runtime.socketPath || ''

const appWindows = () => runtime.getWindows?.().filter((window) => !window.isDestroyed()) || []

const activeWindow = () => {
  const windows = appWindows()
  return windows.find((window) => window.isFocused()) || windows[0] || null
}

const windowNumericId = (window: BrowserWindow, index: number) => {
  const id = Number((window as unknown as { id?: number }).id)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : index + 1
}

const windowControlId = (window: BrowserWindow, index: number) => `window:${windowNumericId(window, index)}`

const dispatchRendererControlRequest = (method: string, params: Record<string, unknown> = {}, options: { focus?: boolean } = {}) => {
  if (!runtime.dispatchRendererControlRequest) return Promise.resolve(fail('NO_APP_WINDOW', 'No aiopsterm window is available for this control request.'))
  return runtime.dispatchRendererControlRequest(method, params, options)
}

export const configureControlSocketSystemRuntime = (config: ControlSocketSystemRuntime = {}) => {
  runtime = { ...runtime, ...config }
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
      windowCount: appWindows().length,
      ...controlSocketStateSummary(),
      ...controlSocketNotificationSummary()
    },
    capabilities: controlSocketCapabilities
  })

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

const workspaceSnapshotOrNull = async (params: Record<string, unknown>) => {
  const response = await dispatchRendererControlRequest('workspace.snapshot', params)
  if (!response.ok) return { snapshot: null, warning: response }
  const snapshot = response.data?.snapshot && typeof response.data.snapshot === 'object' ? (response.data.snapshot as Record<string, unknown>) : null
  if (!snapshot) return { snapshot: null, warning: fail('SYSTEM_TOP_SNAPSHOT_INVALID', 'Renderer returned an invalid workspace snapshot.') }
  return { snapshot, warning: null }
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

export const handleSystemTreeControlRequest = async (params: Record<string, unknown>) => {
  const response = await dispatchRendererControlRequest('workspace.snapshot', params)
  if (!response.ok) return response
  const snapshot = response.data?.snapshot && typeof response.data.snapshot === 'object' ? (response.data.snapshot as Record<string, unknown>) : null
  if (!snapshot) return fail('SYSTEM_TREE_SNAPSHOT_INVALID', 'Renderer returned an invalid workspace snapshot.')
  return ok({
    ...systemTreeFromSnapshot(snapshot),
    snapshot
  })
}

export const handleSystemTopControlRequest = (params: Record<string, unknown>) => systemTopPayload(params)

export const handleSystemMemoryControlRequest = (params: Record<string, unknown>) => systemTopPayload(params, { memoryOnly: true })

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
