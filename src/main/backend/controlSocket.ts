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

const defaultTimeoutMs = 5000
const maxTimeoutMs = 30000
const maxNotifications = 500

let server: Server | null = null
let socketPath = ''
let runtime: ControlSocketRuntime = {}
const pendingRendererRequests = new Map<string, PendingRendererRequest>()
let notifications: ControlNotificationRecord[] = []

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
  return runtime.writeTerminal(sessionId, text)
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
  return ok({ changed, ...(notification ? { notification } : {}), ...notificationPayload() })
}

const dismissNotification = (params: Record<string, unknown>) => {
  const before = notifications.length
  if (params.allRead === true || params.all_read === true) {
    notifications = notifications.filter((notification) => !notification.read)
    syncNotificationsToRenderer()
    return ok({ changed: before - notifications.length, ...notificationPayload() })
  }
  const target = resolveNotification(params)
  if (!target) return fail('NOTIFICATION_NOT_FOUND', 'Notification was not found.')
  if (!target.read) return fail('NOTIFICATION_UNREAD', 'Unread notification must be marked read before dismissal.')
  notifications = notifications.filter((notification) => notification.id !== target.id)
  syncNotificationsToRenderer()
  return ok({ changed: 1, notification: target, ...notificationPayload() })
}

const clearNotifications = () => {
  const changed = notifications.length
  notifications = []
  syncNotificationsToRenderer()
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
  return ok({ changed: target.read ? 0 : 1, notification, focusRequest, focus: focusResponse.data, ...notificationPayload() })
}

const jumpToUnreadNotification = async () => {
  const notification = notifications.find((item) => !item.read)
  if (!notification) return ok({ changed: 0, notifications, count: notifications.length, unreadCount: 0 })
  return openNotification({ id: notification.id })
}

const handleControlRequest = async (request: ControlSocketRequest): Promise<ControlResponse> => {
  const method = cleanText(request.method)
  const params = request.params || {}
  if (!method || method === 'ping') return ok({ pong: true, socketPath })
  if (
    method === 'workspace.snapshot' ||
    method === 'workspace.list' ||
    method === 'workspace.current' ||
    method.startsWith('workspace.group.') ||
    method === 'surface.list' ||
    method === 'surface.current' ||
    method === 'tree' ||
    method === 'top'
  ) {
    return dispatchRendererControlRequest(method, params)
  }
  if (method === 'list_workspaces') return dispatchRendererControlRequest('workspace.list', params)
  if (method === 'list_surfaces') return dispatchRendererControlRequest('surface.list', params)
  if (method === 'terminal.list' || method === 'list_terminals' || method === 'debug.terminals') return dispatchRendererControlRequest('terminal.list', params)
  if (method === 'terminal.focus' || method === 'focus_terminal' || method === 'focus-panel') {
    return dispatchRendererControlRequest('terminal.focus', params, { focus: true })
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
    socket.on('data', (chunk) => {
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
  notifications = []
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}

export const invokeControlSocketMethod = (method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params })

export const __testing = {
  handleControlRequest,
  listNotifications: () => notifications,
  pendingRendererRequestCount: () => pendingRendererRequests.size
}
