import { createServer, type Server, type Socket } from 'net'
import { randomUUID } from 'crypto'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir } from 'fs/promises'
import type { BrowserWindow, IpcMain } from 'electron'
import { sendWindowEvent } from '@shared/windowEvents'
import type { ControlNotificationFocusRequest, ControlNotificationRecord, ControlRequest, ControlResponse } from '@shared/preload'

type ControlSocketRequest = {
  id?: string
  method?: string
  params?: Record<string, unknown>
}

type ControlSocketRuntime = {
  userDataPath?: string
  getWindows?: () => BrowserWindow[]
  focusWindow?: (window?: BrowserWindow) => BrowserWindow | null
  writeTerminal?: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
  showNotification?: (notification: ControlNotificationRecord) => void
}

type PendingRendererRequest = {
  resolve: (response: ControlResponse) => void
  timer: NodeJS.Timeout
}

type ControlEventFrame = {
  type: 'event'
  protocol: 'aiopsterm-events'
  version: 1
  boot_id: string
  seq: number
  id: string
  name: string
  category: string
  source: string
  occurred_at: string
  workspace_id?: string
  surface_id?: string
  pane_id?: string | null
  window_id?: string | null
  payload: Record<string, unknown>
}

type ControlEventFilters = {
  names: Set<string>
  categories: Set<string>
}

type ControlEventSubscription = {
  id: string
  socket: Socket
  filters: ControlEventFilters
  heartbeatTimer?: NodeJS.Timeout
}

const defaultTimeoutMs = 5000
const maxTimeoutMs = 30000
const maxNotifications = 500
const eventReplayLimit = 4096
const eventHeartbeatIntervalMs = 15000
const eventProtocol = 'aiopsterm-events' as const

let server: Server | null = null
let socketPath = ''
let runtime: ControlSocketRuntime = {}
const pendingRendererRequests = new Map<string, PendingRendererRequest>()
let notifications: ControlNotificationRecord[] = []
const eventBootId = randomUUID()
let nextEventSeq = 1
let eventLog: ControlEventFrame[] = []
const eventSubscriptions = new Map<string, ControlEventSubscription>()

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

const normalizeEventAfterSeq = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return undefined
  return Math.floor(numberValue)
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

const isEventStreamMethod = (method: unknown) => {
  const normalized = cleanText(method)
  return normalized === 'events.stream' || normalized === 'event.stream' || normalized === 'event.subscribe' || normalized === 'events.subscribe'
}

const isEventListMethod = (method: string) => method === 'events.list' || method === 'event.list'

const eventFiltersFromParams = (params: Record<string, unknown> = {}): ControlEventFilters => ({
  names: new Set([...cleanTextList(params.names), ...cleanTextList(params.name)]),
  categories: new Set([...cleanTextList(params.categories), ...cleanTextList(params.category)])
})

const eventMatchesFilters = (event: ControlEventFrame, filters: ControlEventFilters) => {
  if (filters.names.size && !filters.names.has(event.name)) return false
  if (filters.categories.size && !filters.categories.has(event.category)) return false
  return true
}

const writeEventFrame = (socket: Socket, frame: Record<string, unknown>) => {
  socket.write(`${JSON.stringify(frame)}\n`)
}

const boundedPreview = (value: unknown, max = 160) => {
  const text = cleanText(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

const boundedPayload = (payload: Record<string, unknown>) => {
  const frameText = JSON.stringify(payload)
  if (Buffer.byteLength(frameText, 'utf8') <= 16_000) return payload
  return {
    payload_truncated: true,
    original_payload_bytes: Buffer.byteLength(frameText, 'utf8')
  }
}

const publishControlEvent = (input: {
  name: string
  category: string
  source?: string
  payload?: Record<string, unknown>
  workspaceId?: string
  surfaceId?: string
}) => {
  const seq = nextEventSeq++
  const event: ControlEventFrame = {
    type: 'event',
    protocol: eventProtocol,
    version: 1,
    boot_id: eventBootId,
    seq,
    id: `${eventBootId}-${seq}`,
    name: input.name,
    category: input.category,
    source: input.source || 'control.socket',
    occurred_at: new Date().toISOString(),
    ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
    ...(input.surfaceId ? { surface_id: input.surfaceId } : {}),
    payload: boundedPayload(input.payload || {})
  }
  eventLog = [...eventLog, event].slice(-eventReplayLimit)
  for (const subscription of eventSubscriptions.values()) {
    if (eventMatchesFilters(event, subscription.filters)) writeEventFrame(subscription.socket, event)
  }
  return event
}

const notificationEventPayload = (notification: ControlNotificationRecord) => ({
  notification_id: notification.id,
  notificationId: notification.id,
  title_preview: boundedPreview(notification.title),
  title_length: notification.title.length,
  subtitle_length: notification.subtitle?.length || 0,
  body_length: notification.body?.length || 0,
  read: notification.read,
  ...(notification.panelId ? { panel_id: notification.panelId, panelId: notification.panelId } : {}),
  ...(notification.sessionId ? { session_id: notification.sessionId, sessionId: notification.sessionId } : {}),
  ...(notification.source ? { source: notification.source } : {})
})

const listEvents = (params: Record<string, unknown>) => {
  const filters = eventFiltersFromParams(params)
  const afterSeq = normalizeEventAfterSeq(params.after_seq ?? params.after)
  const limit = normalizeLimit(params.limit, 100)
  const events = eventLog.filter((event) => (afterSeq === undefined || event.seq > afterSeq) && eventMatchesFilters(event, filters)).slice(-limit)
  return ok({
    protocol: eventProtocol,
    boot_id: eventBootId,
    events,
    count: events.length,
    latest_seq: nextEventSeq - 1,
    oldest_seq: eventLog[0]?.seq ?? null,
    next_seq: nextEventSeq
  })
}

const startEventStream = (socket: Socket, request: ControlSocketRequest) => {
  const params = request.params || {}
  const filters = eventFiltersFromParams(params)
  const requestedAfterSeq = normalizeEventAfterSeq(params.after_seq ?? params.after)
  const latestSeq = nextEventSeq - 1
  const oldestSeq = eventLog[0]?.seq ?? nextEventSeq
  const afterSeq = requestedAfterSeq ?? latestSeq
  const replay = eventLog.filter((event) => event.seq > afterSeq && eventMatchesFilters(event, filters))
  const gap = requestedAfterSeq !== undefined && ((eventLog.length > 0 && requestedAfterSeq < oldestSeq - 1) || requestedAfterSeq > latestSeq)
  const subscriptionId = randomUUID()
  const includeHeartbeats = params.include_heartbeats !== false && params.includeHeartbeats !== false
  const subscription: ControlEventSubscription = {
    id: subscriptionId,
    socket,
    filters
  }

  const cleanup = () => {
    if (subscription.heartbeatTimer) clearInterval(subscription.heartbeatTimer)
    eventSubscriptions.delete(subscriptionId)
  }
  socket.once('close', cleanup)
  socket.once('error', cleanup)

  writeEventFrame(socket, {
    type: 'ack',
    protocol: eventProtocol,
    version: 1,
    boot_id: eventBootId,
    request_id: request.id || null,
    subscription_id: subscriptionId,
    heartbeat_interval_seconds: includeHeartbeats ? eventHeartbeatIntervalMs / 1000 : 0,
    replay_count: replay.length,
    resume: {
      after_seq: afterSeq,
      requested_after_seq: requestedAfterSeq ?? null,
      oldest_seq: eventLog[0]?.seq ?? null,
      latest_seq: latestSeq,
      next_seq: nextEventSeq,
      gap
    },
    filters: {
      names: [...filters.names],
      categories: [...filters.categories]
    }
  })

  eventSubscriptions.set(subscriptionId, subscription)
  for (const event of replay) writeEventFrame(socket, event)
  if (includeHeartbeats) {
    subscription.heartbeatTimer = setInterval(() => {
      writeEventFrame(socket, {
        type: 'heartbeat',
        protocol: eventProtocol,
        version: 1,
        boot_id: eventBootId,
        subscription_id: subscriptionId,
        latest_seq: nextEventSeq - 1,
        occurred_at: new Date().toISOString()
      })
    }, eventHeartbeatIntervalMs)
    subscription.heartbeatTimer.unref?.()
  }
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

const syncNotificationsToRenderer = () => {
  void dispatchRendererControlRequest('notification.sync', notificationPayload())
}

const terminalSessionId = (params: Record<string, unknown>) => cleanText(params.sessionId || params.terminalSessionId)

const terminalWriteData = (params: Record<string, unknown>) => {
  if (typeof params.text === 'string') return params.text
  if (typeof params.data === 'string') return params.data
  return ''
}

const sendTerminalText = async (params: Record<string, unknown>) => {
  const sessionId = terminalSessionId(params)
  const text = terminalWriteData(params)
  if (!sessionId) return fail('TERMINAL_SESSION_REQUIRED', 'sessionId is required.')
  if (!text) return fail('TERMINAL_TEXT_REQUIRED', 'text is required.')
  if (!runtime.writeTerminal) return fail('TERMINAL_WRITE_UNAVAILABLE', 'Terminal write runtime is not available.')
  const response = await runtime.writeTerminal(sessionId, text)
  if (response.ok) {
    publishControlEvent({
      name: 'terminal.text_sent',
      category: 'terminal',
      payload: {
        session_id: sessionId,
        sessionId,
        text_length: text.length,
        bytes: Buffer.byteLength(text, 'utf8')
      }
    })
  }
  return response
}

const notificationPayload = (items = notifications, params: Record<string, unknown> = {}) => {
  const query = cleanText(params.query).toLowerCase()
  const unreadOnly = params.unread === true && params.read !== true
  const readOnly = params.read === true && params.unread !== true
  const limit = normalizeLimit(params.limit)
  const filtered = items.filter((notification) => {
    if (unreadOnly && notification.read) return false
    if (readOnly && !notification.read) return false
    if (!query) return true
    return [notification.id, notification.title, notification.subtitle || '', notification.body || '', notification.panelId || '', notification.sessionId || '', notification.source || '']
      .join('\n')
      .toLowerCase()
      .includes(query)
  })
  return {
    notifications: filtered.slice(0, limit),
    count: Math.min(filtered.length, limit),
    total: filtered.length,
    unreadCount: notifications.filter((notification) => !notification.read).length
  }
}

const createNotification = (params: Record<string, unknown>) => {
  const title = cleanText(params.title) || 'Notification'
  const subtitle = cleanText(params.subtitle)
  const body = typeof params.body === 'string' ? params.body.trim() : ''
  const now = Date.now()
  const notification: ControlNotificationRecord = {
    id: cleanText(params.id) || `notification-${now}-${Math.random().toString(16).slice(2)}`,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(body ? { body } : {}),
    read: false,
    isRead: false,
    createdAt: now,
    updatedAt: now,
    ...(cleanText(params.panelId || params.surfaceId) ? { panelId: cleanText(params.panelId || params.surfaceId) } : {}),
    ...(cleanText(params.sessionId || params.terminalSessionId) ? { sessionId: cleanText(params.sessionId || params.terminalSessionId), terminalSessionId: cleanText(params.sessionId || params.terminalSessionId) } : {}),
    ...(cleanText(params.workspaceId) ? { workspaceId: cleanText(params.workspaceId) } : {}),
    ...(cleanText(params.source) ? { source: cleanText(params.source) } : {})
  }
  notifications = [notification, ...notifications.filter((item) => item.id !== notification.id)].slice(0, maxNotifications)
  syncNotificationsToRenderer()
  runtime.showNotification?.(notification)
  publishControlEvent({
    name: 'notification.created',
    category: 'notification',
    source: 'notification.store',
    surfaceId: notification.panelId,
    workspaceId: notification.workspaceId,
    payload: notificationEventPayload(notification)
  })
  return ok({ notification, ...notificationPayload() })
}

const resolveNotification = (params: Record<string, unknown>) => {
  const id = cleanText(params.id || params.notificationId)
  if (!id) return null
  return notifications.find((notification) => notification.id === id) || null
}

const listNotifications = (params: Record<string, unknown>) => ok(notificationPayload(notifications, params))

const markNotificationRead = (params: Record<string, unknown>) => {
  const now = Date.now()
  let changed = 0
  const all = params.all === true
  const target = all ? null : resolveNotification(params)
  if (!all && !target) return fail('NOTIFICATION_NOT_FOUND', 'Notification was not found.')
  notifications = notifications.map((notification) => {
    if (!all && notification.id !== target?.id) return notification
    if (notification.read) return notification
    changed += 1
    return { ...notification, read: true, isRead: true, readAt: now, updatedAt: now }
  })
  syncNotificationsToRenderer()
  const notification = target ? notifications.find((item) => item.id === target.id) : undefined
  if (changed) {
    publishControlEvent({
      name: all ? 'notification.marked_read_all' : 'notification.marked_read',
      category: 'notification',
      source: 'notification.store',
      payload: {
        changed,
        ...(notification ? notificationEventPayload(notification) : {})
      }
    })
  }
  return ok({ changed, ...(notification ? { notification } : {}), ...notificationPayload() })
}

const dismissNotification = (params: Record<string, unknown>) => {
  const before = notifications.length
  if (params.allRead === true || params.all_read === true) {
    notifications = notifications.filter((notification) => !notification.read)
    syncNotificationsToRenderer()
    const changed = before - notifications.length
    if (changed) publishControlEvent({ name: 'notification.dismissed_read', category: 'notification', source: 'notification.store', payload: { changed } })
    return ok({ changed, ...notificationPayload() })
  }
  const target = resolveNotification(params)
  if (!target) return fail('NOTIFICATION_NOT_FOUND', 'Notification was not found.')
  if (!target.read) return fail('NOTIFICATION_UNREAD', 'Unread notification must be marked read before dismissal.')
  notifications = notifications.filter((notification) => notification.id !== target.id)
  syncNotificationsToRenderer()
  publishControlEvent({
    name: 'notification.dismissed',
    category: 'notification',
    source: 'notification.store',
    surfaceId: target.panelId,
    workspaceId: target.workspaceId,
    payload: notificationEventPayload(target)
  })
  return ok({ changed: 1, notification: target, ...notificationPayload() })
}

const clearNotifications = () => {
  const changed = notifications.length
  notifications = []
  syncNotificationsToRenderer()
  if (changed) publishControlEvent({ name: 'notification.cleared', category: 'notification', source: 'notification.store', payload: { changed } })
  return ok({ changed, ...notificationPayload() })
}

const openNotification = async (params: Record<string, unknown>) => {
  const target = resolveNotification(params)
  if (!target) return fail('NOTIFICATION_NOT_FOUND', 'Notification was not found.')
  const now = Date.now()
  notifications = notifications.map((notification) => (notification.id === target.id ? { ...notification, read: true, isRead: true, readAt: notification.readAt || now, updatedAt: now } : notification))
  const notification = notifications.find((item) => item.id === target.id) || target
  syncNotificationsToRenderer()
  const focusRequest: ControlNotificationFocusRequest = {
    notification,
    ...(notification.panelId ? { panelId: notification.panelId } : {}),
    ...(notification.sessionId ? { sessionId: notification.sessionId } : {}),
    ...(notification.terminalSessionId ? { terminalSessionId: notification.terminalSessionId } : {})
  }
  const focusResponse = await dispatchRendererControlRequest('notification.open', focusRequest as unknown as Record<string, unknown>, { focus: true })
  if (!focusResponse.ok) return focusResponse
  publishControlEvent({
    name: 'notification.opened',
    category: 'notification',
    source: 'notification.store',
    surfaceId: notification.panelId,
    workspaceId: notification.workspaceId,
    payload: notificationEventPayload(notification)
  })
  return ok({ changed: target.read ? 0 : 1, notification, focusRequest, focus: focusResponse.data, ...notificationPayload() })
}

const jumpToUnreadNotification = async () => {
  const notification = notifications.find((item) => !item.read)
  if (!notification) return ok({ changed: 0, notifications, count: notifications.length, unreadCount: 0 })
  return openNotification({ id: notification.id })
}

const rendererMutationEventName = (method: string) => {
  if (method.startsWith('workspace.group.') && method !== 'workspace.group.list') return method.replace('workspace.group.', 'workspace_group.')
  if (method.startsWith('surface.resume.') && method !== 'surface.resume.get' && method !== 'surface.resume.show') return method.replace('surface.resume.', 'surface_resume.')
  if (method === 'agent-hibernation.on') return 'agent_hibernation.enabled'
  if (method === 'agent-hibernation.off') return 'agent_hibernation.disabled'
  if (method === 'agent.hibernate') return 'agent.hibernated'
  if (method === 'agent.resume') return 'agent.resumed'
  if (method === 'agent.team.launch') return 'agent_team.launched'
  return ''
}

const rendererMutationCategory = (method: string) => {
  if (method.startsWith('workspace.group.')) return 'workspace'
  if (method.startsWith('surface.resume.')) return 'surface'
  if (method.startsWith('agent-hibernation.') || method.startsWith('agent.')) return 'agent'
  return 'control'
}

const publishRendererMutationEvent = (method: string, params: Record<string, unknown>, response: ControlResponse) => {
  if (!response.ok) return
  const name = rendererMutationEventName(method)
  if (!name) return
  const data = response.data || {}
  const group = data.group && typeof data.group === 'object' ? (data.group as Record<string, unknown>) : null
  const team = data.team && typeof data.team === 'object' ? (data.team as Record<string, unknown>) : null
  const session = data.session && typeof data.session === 'object' ? (data.session as Record<string, unknown>) : null
  const surface = data.surface && typeof data.surface === 'object' ? (data.surface as Record<string, unknown>) : null
  const config = data.config && typeof data.config === 'object' ? (data.config as Record<string, unknown>) : null
  publishControlEvent({
    name,
    category: rendererMutationCategory(method),
    source: 'control.socket',
    surfaceId: cleanText(data.surfaceId || data.surface_id || surface?.panelId || params.panelId || params.surfaceId),
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
      ...(config ? { enabled: config.enabled } : {}),
      ...(method.startsWith('surface.resume.') ? { has_resume_binding: Boolean(data.resumeBinding || data.resume_binding) } : {})
    }
  })
}

const handleControlRequest = async (request: ControlSocketRequest): Promise<ControlResponse> => {
  const method = cleanText(request.method)
  const params = request.params || {}
  if (!method || method === 'ping') return ok({ pong: true, socketPath })
  if (isEventListMethod(method)) return listEvents(params)
  if (
    method === 'workspace.snapshot' ||
    method === 'workspace.list' ||
    method === 'workspace.current' ||
    method.startsWith('workspace.group.') ||
    method === 'surface.list' ||
    method === 'surface.current' ||
    method.startsWith('surface.resume.') ||
    method.startsWith('agent-hibernation.') ||
    method.startsWith('agent.') ||
    method.startsWith('agent.team.') ||
    method === 'tree' ||
    method === 'top'
  ) {
    const response = await dispatchRendererControlRequest(method, params)
    publishRendererMutationEvent(method, params, response)
    return response
  }
  if (method === 'list_workspaces') return dispatchRendererControlRequest('workspace.list', params)
  if (method === 'list_surfaces') return dispatchRendererControlRequest('surface.list', params)
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
  if (method === 'terminal.read_screen' || method === 'read-screen') return dispatchRendererControlRequest('terminal.read_screen', params)
  if (method === 'terminal.send_text' || method === 'send' || method === 'send-panel') return sendTerminalText(params)
  if (method === 'notification.create' || method === 'notify') return createNotification(params)
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
  for (const subscription of eventSubscriptions.values()) {
    if (subscription.heartbeatTimer) clearInterval(subscription.heartbeatTimer)
    subscription.socket.destroy()
  }
  eventSubscriptions.clear()
  notifications = []
  eventLog = []
  nextEventSeq = 1
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}

export const invokeControlSocketMethod = (method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params })

export const __testing = {
  handleControlRequest,
  listEvents: () => eventLog,
  listNotifications: () => notifications,
  pendingRendererRequestCount: () => pendingRendererRequests.size,
  eventSubscriptionCount: () => eventSubscriptions.size
}
