import { randomUUID } from 'crypto'
import type { ControlResponse } from '@shared/contracts/control'

type SidebarEventInput = {
  name: string
  category: string
  source?: string
  payload?: Record<string, unknown>
  workspaceId?: string
  surfaceId?: string
}

type ControlSocketSidebarMetadataRuntime = {
  publishControlEvent?: (input: SidebarEventInput) => unknown
}

type SidebarStatusEntry = {
  key: string
  value: string
  icon?: string
  color?: string
  priority: number
  workspaceId: string
  panelId?: string
  updatedAt: number
}

type SidebarProgressEntry = {
  value: number
  label?: string
  workspaceId: string
  updatedAt: number
}

type SidebarLogEntry = {
  id: string
  message: string
  level: 'info' | 'progress' | 'success' | 'warning' | 'error'
  source?: string
  workspaceId: string
  createdAt: number
}

const maxSidebarStatusEntries = 200
const maxSidebarLogEntries = 500

let runtime: ControlSocketSidebarMetadataRuntime = {}
let sidebarStatusEntries = new Map<string, SidebarStatusEntry>()
let sidebarProgressEntries = new Map<string, SidebarProgressEntry>()
let sidebarLogEntries: SidebarLogEntry[] = []

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const cleanPositiveInteger = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return undefined
  return Math.max(1, Math.floor(numberValue))
}

const cleanSidebarWorkspaceId = (params: Record<string, unknown>) => cleanText(params.workspaceId || params.workspace_id || params.workspace || params.tab || params.tab_id) || 'main'

const cleanSidebarPanelId = (params: Record<string, unknown>) => cleanText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.panel)

const cleanSidebarKey = (value: unknown) => {
  const text = cleanText(value)
  return text && text.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

const cleanSidebarText = (value: unknown, max = 240) => {
  const text = cleanText(value)
  return text.length > max ? text.slice(0, max) : text
}

const cleanSidebarLevel = (value: unknown): SidebarLogEntry['level'] => {
  const text = cleanText(value).toLowerCase()
  if (text === 'progress' || text === 'success' || text === 'warning' || text === 'error') return text
  return 'info'
}

const publishSidebarEvent = (input: SidebarEventInput) => {
  runtime.publishControlEvent?.(input)
}

const sidebarStatusForWorkspace = (workspaceId: string) =>
  [...sidebarStatusEntries.values()]
    .filter((entry) => entry.workspaceId === workspaceId)
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))

const sidebarLogsForWorkspace = (workspaceId: string, limit?: number) => {
  const logs = sidebarLogEntries.filter((entry) => entry.workspaceId === workspaceId)
  return limit === undefined ? logs : logs.slice(-limit)
}

const sidebarStatePayload = (workspaceId: string, options: { logLimit?: number } = {}) => {
  const statuses = sidebarStatusForWorkspace(workspaceId)
  const logs = sidebarLogsForWorkspace(workspaceId, options.logLimit)
  const allLogs = sidebarLogsForWorkspace(workspaceId)
  return {
    workspaceId,
    workspace_id: workspaceId,
    statuses,
    statusCount: statuses.length,
    status_count: statuses.length,
    progress: sidebarProgressEntries.get(workspaceId) || null,
    logs,
    logCount: allLogs.length,
    log_count: allLogs.length
  }
}

export const configureControlSocketSidebarMetadataRuntime = (config: ControlSocketSidebarMetadataRuntime = {}) => {
  runtime = { ...runtime, ...config }
}

export const isControlSidebarMetadataMethod = (method: string) =>
  method.startsWith('sidebar.') ||
  [
    'set-status',
    'clear-status',
    'list-status',
    'set-progress',
    'clear-progress',
    'log',
    'clear-log',
    'list-log',
    'sidebar-state'
  ].includes(method)

export const handleSidebarMetadataControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = method.startsWith('sidebar.') ? method.slice('sidebar.'.length) : method
  const workspaceId = cleanSidebarWorkspaceId(params)
  if (action === 'state' || action === 'sidebar-state') {
    const limit = cleanPositiveInteger(params.limit)
    return ok(sidebarStatePayload(workspaceId, { ...(limit ? { logLimit: limit } : {}) }))
  }
  if (action === 'status.set' || action === 'set-status') {
    const key = cleanSidebarKey(params.key || params.name)
    const value = cleanSidebarText(params.value || params.text || params.message)
    if (!key || !value) return fail('SIDEBAR_STATUS_INVALID', 'set-status requires a valid key and value.')
    const priorityValue = Number(params.priority)
    const priority = Number.isFinite(priorityValue) ? Math.max(-9999, Math.min(9999, Math.round(priorityValue))) : 0
    const entry: SidebarStatusEntry = {
      key,
      value,
      ...(cleanSidebarText(params.icon, 80) ? { icon: cleanSidebarText(params.icon, 80) } : {}),
      ...(cleanSidebarText(params.color, 40) ? { color: cleanSidebarText(params.color, 40) } : {}),
      priority,
      workspaceId,
      ...(cleanSidebarPanelId(params) ? { panelId: cleanSidebarPanelId(params) } : {}),
      updatedAt: Date.now()
    }
    sidebarStatusEntries.set(`${workspaceId}:${key}`, entry)
    if (sidebarStatusEntries.size > maxSidebarStatusEntries) {
      const oldest = [...sidebarStatusEntries.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0]?.[0]
      if (oldest) sidebarStatusEntries.delete(oldest)
    }
    publishSidebarEvent({ name: 'sidebar.status.set', category: 'sidebar', payload: { workspace_id: workspaceId, key, priority } })
    return ok({ status: entry, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'status.clear' || action === 'clear-status') {
    const key = cleanSidebarKey(params.key || params.name)
    if (!key) return fail('SIDEBAR_STATUS_KEY_INVALID', 'clear-status requires a valid key.')
    const removed = sidebarStatusEntries.delete(`${workspaceId}:${key}`)
    publishSidebarEvent({ name: 'sidebar.status.cleared', category: 'sidebar', payload: { workspace_id: workspaceId, key, removed } })
    return ok({ removed, key, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'status.list' || action === 'list-status') return ok({ statuses: sidebarStatusForWorkspace(workspaceId), count: sidebarStatusForWorkspace(workspaceId).length, workspaceId, workspace_id: workspaceId })
  if (action === 'progress.set' || action === 'set-progress') {
    const rawValue = Number(params.value ?? params.progress)
    if (!Number.isFinite(rawValue)) return fail('SIDEBAR_PROGRESS_INVALID', 'set-progress requires a numeric value.')
    const progress: SidebarProgressEntry = {
      value: Math.max(0, Math.min(1, rawValue)),
      ...(cleanSidebarText(params.label) ? { label: cleanSidebarText(params.label) } : {}),
      workspaceId,
      updatedAt: Date.now()
    }
    sidebarProgressEntries.set(workspaceId, progress)
    publishSidebarEvent({ name: 'sidebar.progress.set', category: 'sidebar', payload: { workspace_id: workspaceId, value: progress.value } })
    return ok(sidebarStatePayload(workspaceId))
  }
  if (action === 'progress.clear' || action === 'clear-progress') {
    const removed = sidebarProgressEntries.delete(workspaceId)
    publishSidebarEvent({ name: 'sidebar.progress.cleared', category: 'sidebar', payload: { workspace_id: workspaceId, removed } })
    return ok({ removed, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'log.append' || action === 'log') {
    const message = cleanSidebarText(params.message || params.text || params.value, 1000)
    if (!message) return fail('SIDEBAR_LOG_MESSAGE_REQUIRED', 'log requires a message.')
    const entry: SidebarLogEntry = {
      id: randomUUID(),
      message,
      level: cleanSidebarLevel(params.level),
      ...(cleanSidebarText(params.source, 80) ? { source: cleanSidebarText(params.source, 80) } : {}),
      workspaceId,
      createdAt: Date.now()
    }
    sidebarLogEntries = [...sidebarLogEntries, entry].slice(-maxSidebarLogEntries)
    publishSidebarEvent({ name: 'sidebar.log.appended', category: 'sidebar', payload: { workspace_id: workspaceId, level: entry.level, source: entry.source || '' } })
    return ok({ log: entry, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'log.clear' || action === 'clear-log') {
    const before = sidebarLogEntries.length
    sidebarLogEntries = sidebarLogEntries.filter((entry) => entry.workspaceId !== workspaceId)
    const changed = before - sidebarLogEntries.length
    publishSidebarEvent({ name: 'sidebar.log.cleared', category: 'sidebar', payload: { workspace_id: workspaceId, changed } })
    return ok({ changed, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'log.list' || action === 'list-log') {
    const limit = cleanPositiveInteger(params.limit)
    const logs = sidebarLogsForWorkspace(workspaceId, limit)
    return ok({ logs, count: logs.length, total: sidebarLogsForWorkspace(workspaceId).length, workspaceId, workspace_id: workspaceId })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm sidebar metadata method: ${method}`)
}

export const resetControlSocketSidebarMetadataRuntime = () => {
  sidebarStatusEntries.clear()
  sidebarProgressEntries.clear()
  sidebarLogEntries = []
}
