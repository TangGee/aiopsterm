import type {
  ControlNotificationFocusRequest,
  ControlNotificationRecord,
  ControlResponse
} from '@shared/contracts/control'
import { logRuntimeEvent } from '../app/runtimeLog'

type ControlSocketNotificationEventInput = {
  name: string
  category: string
  source?: string
  payload?: Record<string, unknown>
  workspaceId?: string
  surfaceId?: string
}

type ControlSocketNotificationRuntime = {
  dispatchRendererControlRequest?: (method: string, params?: Record<string, unknown>, options?: { focus?: boolean }) => Promise<ControlResponse> | ControlResponse
  showNotification?: (notification: ControlNotificationRecord) => void
  publishControlEvent?: (input: ControlSocketNotificationEventInput) => unknown
}

const maxNotifications = 500

let runtime: ControlSocketNotificationRuntime = {}
let notifications: ControlNotificationRecord[] = []

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const normalizeLimit = (value: unknown, fallback = 50) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(200, Math.floor(numberValue)))
}

const cleanControlMetadataText = (value: unknown, max = 120) => {
  const text = cleanText(value)
  if (!text) return ''
  return text.length > max ? text.slice(0, max) : text
}

const cleanNotificationLevel = (value: unknown): ControlNotificationRecord['level'] => {
  const text = cleanText(value).toLowerCase()
  if (text === 'success' || text === 'warning' || text === 'error' || text === 'approval' || text === 'done') return text
  return 'info'
}

const boundedPreview = (value: unknown, max = 160) => {
  const text = cleanText(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

const dispatchRendererControlRequest = (method: string, params: Record<string, unknown> = {}, options: { focus?: boolean } = {}) => {
  if (!runtime.dispatchRendererControlRequest) return Promise.resolve(fail('NO_APP_WINDOW', 'No aiopsterm window is available for this control request.'))
  return runtime.dispatchRendererControlRequest(method, params, options)
}

const publishNotificationEvent = (input: ControlSocketNotificationEventInput) => {
  runtime.publishControlEvent?.(input)
}

const notificationEventPayload = (notification: ControlNotificationRecord) => ({
  notification_id: notification.id,
  notificationId: notification.id,
  title_preview: boundedPreview(notification.title),
  title_length: notification.title.length,
  subtitle_length: notification.subtitle?.length || 0,
  body_length: notification.body?.length || 0,
  read: notification.read,
  ...(notification.level ? { level: notification.level } : {}),
  ...(notification.group ? { group: notification.group } : {}),
  ...(notification.key ? { key: notification.key } : {}),
  ...(notification.action ? { action: notification.action } : {}),
  ...(notification.url ? { url: notification.url } : {}),
  ...(notification.panelId ? { panel_id: notification.panelId, panelId: notification.panelId } : {}),
  ...(notification.sessionId ? { session_id: notification.sessionId, sessionId: notification.sessionId } : {}),
  ...(notification.source ? { source: notification.source } : {})
})

const notificationPayload = (items = notifications, params: Record<string, unknown> = {}) => {
  const query = cleanText(params.query).toLowerCase()
  const source = cleanControlMetadataText(params.source || params.from).toLowerCase()
  const group = cleanControlMetadataText(params.group).toLowerCase()
  const level = cleanControlMetadataText(params.level || params.severity).toLowerCase()
  const unreadOnly = params.unread === true && params.read !== true
  const readOnly = params.read === true && params.unread !== true
  const limit = normalizeLimit(params.limit)
  const filtered = items.filter((notification) => {
    if (unreadOnly && notification.read) return false
    if (readOnly && !notification.read) return false
    if (source && cleanText(notification.source).toLowerCase() !== source) return false
    if (group && cleanText(notification.group).toLowerCase() !== group) return false
    if (level && cleanText(notification.level).toLowerCase() !== level) return false
    if (!query) return true
    return [
      notification.id,
      notification.title,
      notification.subtitle || '',
      notification.body || '',
      notification.panelId || '',
      notification.sessionId || '',
      notification.source || '',
      notification.level || '',
      notification.group || '',
      notification.key || '',
      notification.action || '',
      notification.url || ''
    ]
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

const syncNotificationsToRenderer = () => {
  const startedAt = Date.now()
  void Promise.resolve(dispatchRendererControlRequest('notification.sync', notificationPayload()))
    .then((response) => {
      logRuntimeEvent(response.ok ? 'debug' : 'warn', response.ok ? 'control.notification.sync' : 'control.notification.sync.failed', {
        durationMs: Date.now() - startedAt,
        count: notifications.length,
        unreadCount: notifications.filter((notification) => !notification.read).length,
        errorCode: response.errorCode,
        errorMessage: response.errorMessage
      })
    })
    .catch((error) => {
      logRuntimeEvent('warn', 'control.notification.sync.error', {
        durationMs: Date.now() - startedAt,
        error
      })
    })
}

const resolveNotification = (params: Record<string, unknown>) => {
  const id = cleanText(params.id || params.notificationId)
  if (!id) return null
  return notifications.find((notification) => notification.id === id) || null
}

export const configureControlSocketNotificationRuntime = (config: ControlSocketNotificationRuntime = {}) => {
  runtime = { ...runtime, ...config }
}

export const createNotification = (params: Record<string, unknown>) => {
  const title = cleanText(params.title) || 'Notification'
  const subtitle = cleanText(params.subtitle)
  const body = typeof params.body === 'string' ? params.body.trim() : ''
  const source = cleanControlMetadataText(params.source || params.from || params.app)
  const level = cleanNotificationLevel(params.level || params.severity)
  const group = cleanControlMetadataText(params.group || params.category)
  const key = cleanControlMetadataText(params.key || params.dedupeKey || params.dedupe_key || params.idempotencyKey || params.idempotency_key)
  const action = cleanControlMetadataText(params.action || params.kind || params.type)
  const url = cleanControlMetadataText(params.url || params.link, 500)
  const now = Date.now()
  const stableId = cleanText(params.id)
  const generatedId = key ? `notification-key-${Buffer.from(JSON.stringify([source, group, key])).toString('base64url').slice(0, 96)}` : `notification-${now}-${Math.random().toString(16).slice(2)}`
  const id = stableId || generatedId
  const existing = notifications.find((item) => item.id === id)
  const notification: ControlNotificationRecord = {
    id,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(body ? { body } : {}),
    level,
    ...(group ? { group } : {}),
    ...(key ? { key } : {}),
    ...(action ? { action } : {}),
    ...(url ? { url } : {}),
    read: false,
    isRead: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ...(cleanText(params.panelId || params.surfaceId) || existing?.panelId ? { panelId: cleanText(params.panelId || params.surfaceId) || existing?.panelId } : {}),
    ...(cleanText(params.sessionId || params.terminalSessionId) || existing?.sessionId || existing?.terminalSessionId
      ? {
          sessionId: cleanText(params.sessionId || params.terminalSessionId) || existing?.sessionId || existing?.terminalSessionId,
          terminalSessionId: cleanText(params.sessionId || params.terminalSessionId) || existing?.terminalSessionId || existing?.sessionId
        }
      : {}),
    ...(cleanText(params.workspaceId) || existing?.workspaceId ? { workspaceId: cleanText(params.workspaceId) || existing?.workspaceId } : {}),
    ...(source ? { source } : {})
  }
  notifications = [notification, ...notifications.filter((item) => item.id !== notification.id)].slice(0, maxNotifications)
  logRuntimeEvent(existing ? 'debug' : 'info', existing ? 'control.notification.updated' : 'control.notification.created', {
    notificationId: notification.id,
    source: notification.source,
    level: notification.level,
    group: notification.group,
    panelId: notification.panelId,
    sessionId: notification.sessionId,
    terminalSessionId: notification.terminalSessionId,
    total: notifications.length,
    unreadCount: notifications.filter((item) => !item.read).length
  })
  syncNotificationsToRenderer()
  runtime.showNotification?.(notification)
  publishNotificationEvent({
    name: 'notification.created',
    category: 'notification',
    source: 'notification.store',
    surfaceId: notification.panelId,
    workspaceId: notification.workspaceId,
    payload: notificationEventPayload(notification)
  })
  return ok({ notification, ...notificationPayload() })
}

export const createTargetedNotification = (method: string, params: Record<string, unknown>) => {
  const surfaceId = cleanText(params.surfaceId || params.surface_id || params.panelId || params.panel_id || params.target)
  if (!surfaceId) return fail('NOTIFICATION_SURFACE_REQUIRED', 'Targeted notification requires surface_id.')
  const workspaceId = cleanText(params.workspaceId || params.workspace_id || params.workspace) || 'main'
  const response = createNotification({
    ...params,
    panelId: surfaceId,
    surfaceId,
    workspaceId,
    workspace_id: workspaceId
  })
  if (!response.ok) return response
  const data = response.data || {}
  return ok({
    ...data,
    workspaceId,
    workspace_id: workspaceId,
    workspaceRef: workspaceId === 'main' ? 'workspace:1' : workspaceId,
    workspace_ref: workspaceId === 'main' ? 'workspace:1' : workspaceId,
    surfaceId,
    surface_id: surfaceId,
    surfaceRef: surfaceId,
    surface_ref: surfaceId,
    targeted: true,
    method
  })
}

export const createCallerNotification = (params: Record<string, unknown>) => {
  const caller = params.caller && typeof params.caller === 'object' && !Array.isArray(params.caller) ? (params.caller as Record<string, unknown>) : {}
  const surfaceId = cleanText(caller.surfaceId || caller.surface_id || caller.panelId || caller.panel_id || params.surfaceId || params.surface_id || params.panelId || params.panel_id)
  const workspaceId = cleanText(caller.workspaceId || caller.workspace_id || params.workspaceId || params.workspace_id || params.workspace) || 'main'
  const response = createNotification({
    ...params,
    ...(surfaceId ? { panelId: surfaceId, surfaceId } : {}),
    workspaceId,
    workspace_id: workspaceId
  })
  if (!response.ok) return response
  return ok({
    ...(response.data || {}),
    workspaceId,
    workspace_id: workspaceId,
    workspaceRef: workspaceId === 'main' ? 'workspace:1' : workspaceId,
    workspace_ref: workspaceId === 'main' ? 'workspace:1' : workspaceId,
    surfaceId: surfaceId || null,
    surface_id: surfaceId || null,
    surfaceRef: surfaceId || null,
    surface_ref: surfaceId || null,
    caller,
    targeted: Boolean(surfaceId),
    method: 'notification.create_for_caller'
  })
}

export const listNotifications = (params: Record<string, unknown>) => ok(notificationPayload(notifications, params))

export const markNotificationRead = (params: Record<string, unknown>) => {
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
    publishNotificationEvent({
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

export const dismissNotification = (params: Record<string, unknown>) => {
  const before = notifications.length
  if (params.allRead === true || params.all_read === true) {
    notifications = notifications.filter((notification) => !notification.read)
    syncNotificationsToRenderer()
    const changed = before - notifications.length
    if (changed) publishNotificationEvent({ name: 'notification.dismissed_read', category: 'notification', source: 'notification.store', payload: { changed } })
    return ok({ changed, ...notificationPayload() })
  }
  const target = resolveNotification(params)
  if (!target) return fail('NOTIFICATION_NOT_FOUND', 'Notification was not found.')
  if (!target.read) return fail('NOTIFICATION_UNREAD', 'Unread notification must be marked read before dismissal.')
  notifications = notifications.filter((notification) => notification.id !== target.id)
  syncNotificationsToRenderer()
  publishNotificationEvent({
    name: 'notification.dismissed',
    category: 'notification',
    source: 'notification.store',
    surfaceId: target.panelId,
    workspaceId: target.workspaceId,
    payload: notificationEventPayload(target)
  })
  return ok({ changed: 1, notification: target, ...notificationPayload() })
}

export const clearNotifications = () => {
  const changed = notifications.length
  notifications = []
  syncNotificationsToRenderer()
  if (changed) publishNotificationEvent({ name: 'notification.cleared', category: 'notification', source: 'notification.store', payload: { changed } })
  return ok({ changed, ...notificationPayload() })
}

export const openNotification = async (params: Record<string, unknown>) => {
  const startedAt = Date.now()
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
  logRuntimeEvent('info', 'control.notification.opened', {
    notificationId: notification.id,
    source: notification.source,
    level: notification.level,
    panelId: notification.panelId,
    sessionId: notification.sessionId,
    terminalSessionId: notification.terminalSessionId,
    durationMs: Date.now() - startedAt
  })
  publishNotificationEvent({
    name: 'notification.opened',
    category: 'notification',
    source: 'notification.store',
    surfaceId: notification.panelId,
    workspaceId: notification.workspaceId,
    payload: notificationEventPayload(notification)
  })
  return ok({ changed: target.read ? 0 : 1, notification, focusRequest, focus: focusResponse.data, ...notificationPayload() })
}

export const jumpToUnreadNotification = async () => {
  const notification = notifications.find((item) => !item.read)
  if (!notification) return ok({ changed: 0, notifications, count: notifications.length, unreadCount: 0 })
  return openNotification({ id: notification.id })
}

export const controlSocketNotificationSummary = () => ({
  notificationCount: notifications.length,
  unreadNotificationCount: notifications.filter((notification) => !notification.read).length
})

export const listNotificationsForTesting = () => notifications

export const resetControlSocketNotificationRuntime = () => {
  notifications = []
}
