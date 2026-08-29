import { randomBytes, randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { sendWindowEvent } from '@shared/windowEvents'
import type {
  ControlNotificationRecord,
  ControlRequest,
  ControlResponse,
  ControlTerminalSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'
import {
  authStatusPayload,
  feedbackSubmitPayload,
  unsupportedAuthStatusPayload
} from './controlSocketCompatibilityRuntime'
import {
  handleSessionControlRequest,
  publishControlEvent
} from './controlSocketStateRuntime'
import {
  configureControlSocketRendererMutationRuntime,
  publishRendererMutationEvent
} from './controlSocketRendererMutationRuntime'
import {
  controlSocketCapabilities,
  handleSystemMemoryControlRequest,
  handleSystemTopControlRequest,
  handleSystemTreeControlRequest
} from './controlSocketSystemRuntime'

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
  configureControlSocketRendererMutationRuntime({ publishControlEvent })
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
          `aio terminal read-screen --panel ${activeTerminal.panelId} --lines 80`,
          'terminal.read_screen',
          { panelId: activeTerminal.panelId, surfaceId: activeTerminal.panelId, sessionId: activeTerminal.sessionId, lines: 80, tailLines: 80 }
        )
      : null,
    activeTerminal
      ? commandSuggestion(
          'Send text to active terminal',
          `aio terminal send --panel ${activeTerminal.panelId} --text <text>`,
          'terminal.send_text',
          { panelId: activeTerminal.panelId, surfaceId: activeTerminal.panelId, sessionId: activeTerminal.sessionId, text: '<text>' }
        )
      : null,
    pendingAiSessions[0]
      ? commandSuggestion(
          'Open next pending AI session',
          `aio feed jump ${pendingAiSessions[0].pendingRequestId || pendingAiSessions[0].id}`,
          'feed.jump',
          { workstream_id: pendingAiSessions[0].pendingRequestId || pendingAiSessions[0].id, source: pendingAiSessions[0].source }
        )
      : null,
    unreadNotifications[0]
      ? commandSuggestion(
          'Open next unread notification',
          'aio jump-to-unread',
          'notification.jump_to_unread',
          {}
        )
      : null,
    commandSuggestion('List all surfaces', 'aio surface list', 'surface.list', {}),
    commandSuggestion('List managed AI sessions', 'aio agent session list --all', 'agent.session.list', {})
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
    'settings.get',
    'settings.put',
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
      unsupported_reason: 'The local control socket does not expose a cloud authentication sign-in URL.',
      url: null
    })
  }
  if (method === 'auth.begin_sign_in') return ok(unsupportedAuthStatusPayload('begin_sign_in'))
  if (method === 'auth.sign_out') return ok(unsupportedAuthStatusPayload('sign_out'))
  if (method === 'feedback.submit') return feedbackSubmitPayload(params)
  if (method === 'session.restore_previous') return handleSessionControlRequest('session.restore', { ...params, id: params.id || 'latest' })
  if (method === 'system.tree') return handleSystemTreeControlRequest(params)
  if (method === 'system.top') return handleSystemTopControlRequest(params)
  if (method === 'system.memory') return handleSystemMemoryControlRequest(params)
  if (method === 'settings.open' || method === 'settings.get' || method === 'settings.put' || method === 'feedback.open' || method === 'extension.sidebar.snapshot') {
    return dispatchRendererControlRequest(method, params, { focus: (method === 'settings.open' || method === 'feedback.open') && params.activate !== false })
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
  'file.open',
  'file.editor.open'
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
    unsupported_reason: 'Attach tickets currently describe only the local control socket; a mobile network listener is not available.'
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
