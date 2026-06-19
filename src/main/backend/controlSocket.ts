import { createServer, type Server, type Socket } from 'net'
import { randomUUID } from 'crypto'
import { appendFileSync, existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
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

type AgentVaultEntry = {
  id: string
  name: string
  description?: string
  executable?: string
  launchCommand?: string
  resumeCommand?: string
  forkCommand?: string
  sessionDirectory?: string
  icon?: string
  createdAt: number
  updatedAt: number
}

const defaultTimeoutMs = 5000
const maxTimeoutMs = 30000
const maxNotifications = 500
const eventReplayLimit = 4096
const eventHeartbeatIntervalMs = 15000
const eventProtocol = 'aiopsterm-events' as const
const maxAgentVaultEntries = 200
const maxAgentVaultCommandLength = 2000

let server: Server | null = null
let socketPath = ''
let runtime: ControlSocketRuntime = {}
const pendingRendererRequests = new Map<string, PendingRendererRequest>()
let notifications: ControlNotificationRecord[] = []
const eventBootId = randomUUID()
let nextEventSeq = 1
let eventLog: ControlEventFrame[] = []
let eventLogStorePath = ''
let eventLogLoadedPath = ''
const eventSubscriptions = new Map<string, ControlEventSubscription>()
let agentVaultStorePath = ''
let agentVaultLoadedPath = ''
let agentVaultEntries = new Map<string, AgentVaultEntry>()
let agentVaultWriteQueue: Promise<void> = Promise.resolve()

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

const agentVaultPathFor = (userDataPath: string) => join(userDataPath, 'control', 'agent-vault.json')
const eventLogPathFor = (userDataPath: string) => join(userDataPath, 'control', 'events.jsonl')

const isEventStreamMethod = (method: unknown) => {
  const normalized = cleanText(method)
  return normalized === 'events.stream' || normalized === 'event.stream' || normalized === 'event.subscribe' || normalized === 'events.subscribe'
}

const isEventListMethod = (method: string) => method === 'events.list' || method === 'event.list'

const isAgentVaultMethod = (method: string) => method.startsWith('agent.vault.') || method.startsWith('agent-vault.')

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

const normalizeDurableEvent = (value: unknown): ControlEventFrame | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.type !== 'event' || record.protocol !== eventProtocol) return null
  const seq = Number(record.seq)
  if (!Number.isFinite(seq) || seq < 1) return null
  const name = cleanText(record.name)
  const category = cleanText(record.category)
  const id = cleanText(record.id)
  const bootId = cleanText(record.boot_id)
  const occurredAt = cleanText(record.occurred_at)
  if (!name || !category || !id || !bootId || !occurredAt) return null
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? (record.payload as Record<string, unknown>) : {}
  return {
    type: 'event',
    protocol: eventProtocol,
    version: 1,
    boot_id: bootId,
    seq: Math.floor(seq),
    id,
    name,
    category,
    source: cleanText(record.source) || 'control.socket',
    occurred_at: occurredAt,
    ...(cleanText(record.workspace_id) ? { workspace_id: cleanText(record.workspace_id) } : {}),
    ...(cleanText(record.surface_id) ? { surface_id: cleanText(record.surface_id) } : {}),
    ...(record.pane_id === null || cleanText(record.pane_id) ? { pane_id: record.pane_id === null ? null : cleanText(record.pane_id) } : {}),
    ...(record.window_id === null || cleanText(record.window_id) ? { window_id: record.window_id === null ? null : cleanText(record.window_id) } : {}),
    payload: boundedPayload(payload)
  }
}

const loadDurableEventLog = async (userDataPath?: string) => {
  if (userDataPath) eventLogStorePath = eventLogPathFor(userDataPath)
  if (!eventLogStorePath || eventLogLoadedPath === eventLogStorePath) return
  eventLogLoadedPath = eventLogStorePath
  eventLog = []
  nextEventSeq = 1
  if (!existsSync(eventLogStorePath)) return
  try {
    const raw = await readFile(eventLogStorePath, 'utf-8')
    const events: ControlEventFrame[] = []
    let maxSeq = 0
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = normalizeDurableEvent(JSON.parse(trimmed) as unknown)
        if (!event) continue
        events.push(event)
        maxSeq = Math.max(maxSeq, event.seq)
      } catch {
        // Keep reading the rest of the audit log if one JSONL line is corrupt.
      }
    }
    eventLog = events.slice(-eventReplayLimit)
    nextEventSeq = maxSeq + 1
  } catch {
    eventLog = []
    nextEventSeq = 1
  }
}

const appendDurableEvent = (event: ControlEventFrame) => {
  if (!eventLogStorePath) return
  try {
    appendFileSync(eventLogStorePath, `${JSON.stringify(event)}\n`, 'utf-8')
  } catch {
    // Event streaming must keep working even if the audit log cannot be written.
  }
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
  appendDurableEvent(event)
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

const normalizeAgentVaultId = (value: unknown) => cleanText(value).toLowerCase()

const isValidAgentVaultId = (value: string) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)

const cleanAgentVaultCommand = (value: unknown) => {
  const text = cleanText(value)
  return text && text.length <= maxAgentVaultCommandLength ? text : ''
}

const cloneAgentVaultEntry = (entry: AgentVaultEntry): AgentVaultEntry => ({ ...entry })

const sortedAgentVaultEntries = () => [...agentVaultEntries.values()].sort((left, right) => left.id.localeCompare(right.id)).map(cloneAgentVaultEntry)

const agentVaultPayload = (agent?: AgentVaultEntry | null) => ({
  agents: sortedAgentVaultEntries(),
  count: agentVaultEntries.size,
  ...(agent ? { agent: cloneAgentVaultEntry(agent) } : {})
})

const normalizeAgentVaultEntry = (value: unknown, existing?: AgentVaultEntry): AgentVaultEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = normalizeAgentVaultId(record.id || existing?.id)
  if (!id || !isValidAgentVaultId(id)) return null
  const name = cleanText(record.name) || existing?.name || id
  const launchCommand = cleanAgentVaultCommand(record.launchCommand || record.launch_command || record.launch || record.command) || existing?.launchCommand
  const resumeCommand = cleanAgentVaultCommand(record.resumeCommand || record.resume_command || record.resume) || existing?.resumeCommand
  const forkCommand = cleanAgentVaultCommand(record.forkCommand || record.fork_command || record.fork) || existing?.forkCommand
  if (!launchCommand && !resumeCommand && !forkCommand) return null
  const now = Date.now()
  return {
    id,
    name,
    ...(cleanText(record.description) || existing?.description ? { description: cleanText(record.description) || existing?.description } : {}),
    ...(cleanText(record.executable) || existing?.executable ? { executable: cleanText(record.executable) || existing?.executable } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(forkCommand ? { forkCommand } : {}),
    ...(cleanText(record.sessionDirectory || record.session_directory || record.sessionDir) || existing?.sessionDirectory
      ? { sessionDirectory: cleanText(record.sessionDirectory || record.session_directory || record.sessionDir) || existing?.sessionDirectory }
      : {}),
    ...(cleanText(record.icon || record.iconAssetName) || existing?.icon ? { icon: cleanText(record.icon || record.iconAssetName) || existing?.icon } : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

const loadAgentVaultStore = async (userDataPath?: string) => {
  if (userDataPath) agentVaultStorePath = agentVaultPathFor(userDataPath)
  if (!agentVaultStorePath || agentVaultLoadedPath === agentVaultStorePath) return
  agentVaultEntries = new Map()
  agentVaultLoadedPath = agentVaultStorePath
  if (!existsSync(agentVaultStorePath)) return
  try {
    const raw = await readFile(agentVaultStorePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).agents) ? ((parsed as Record<string, unknown>).agents as unknown[]) : []
    for (const item of items.slice(0, maxAgentVaultEntries)) {
      const entry = normalizeAgentVaultEntry(item)
      if (entry) agentVaultEntries.set(entry.id, entry)
    }
  } catch {
    agentVaultEntries = new Map()
  }
}

const persistAgentVaultStore = async () => {
  if (!agentVaultStorePath) return
  const payload = {
    version: 1,
    agents: sortedAgentVaultEntries()
  }
  agentVaultWriteQueue = agentVaultWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(agentVaultStorePath), { recursive: true })
      await writeFile(agentVaultStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    })
  await agentVaultWriteQueue
}

const agentVaultEntryFor = (value: unknown) => {
  const id = normalizeAgentVaultId(value)
  return id ? agentVaultEntries.get(id) || null : null
}

const renderAgentVaultTemplate = (entry: AgentVaultEntry, template: string, params: Record<string, unknown>, options: { preserveDynamic?: boolean } = {}) => {
  const dynamic = new Set(['index', 'count', 'cwd', 'prompt', 'role', 'model'])
  const values: Record<string, string> = {
    agentId: entry.id,
    agentName: entry.name,
    executable: cleanText(params.executable) || entry.executable || entry.id,
    cwd: cleanText(params.cwd),
    prompt: cleanText(params.prompt || params.message || params.instruction),
    role: cleanText(params.role || params.agentRole),
    model: cleanText(params.model),
    index: cleanText(params.index) || '1',
    count: cleanText(params.count) || cleanText(params.n) || '1',
    sessionId: cleanText(params.sessionId || params.session_id),
    sessionPath: cleanText(params.sessionPath || params.session_path),
    sessionDir: cleanText(params.sessionDir || params.sessionDirectory || params.session_directory) || entry.sessionDirectory || ''
  }
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key: string) => {
    if (options.preserveDynamic && dynamic.has(key)) return match
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  })
}

const handleAgentVaultControlRequest = async (method: string, params: Record<string, unknown>) => {
  await loadAgentVaultStore(runtime.userDataPath)
  const action = method.startsWith('agent-vault.') ? method.slice('agent-vault.'.length) : method.slice('agent.vault.'.length)
  if (action === 'list') return ok(agentVaultPayload())
  if (action === 'register' || action === 'set') {
    if (agentVaultEntries.size >= maxAgentVaultEntries && !agentVaultEntryFor(params.id)) {
      return fail('AGENT_VAULT_LIMIT_REACHED', `Agent vault supports at most ${maxAgentVaultEntries} entries.`)
    }
    const existing = agentVaultEntryFor(params.id)
    const entry = normalizeAgentVaultEntry(params, existing || undefined)
    if (!entry) return fail('AGENT_VAULT_ENTRY_INVALID', 'Agent vault entry needs a valid id and at least one launch/resume/fork command template.')
    agentVaultEntries.set(entry.id, entry)
    await persistAgentVaultStore()
    publishControlEvent({
      name: existing ? 'agent_vault.updated' : 'agent_vault.registered',
      category: 'agent',
      payload: { agent_id: entry.id, agent_name: entry.name, has_launch: Boolean(entry.launchCommand), has_resume: Boolean(entry.resumeCommand), has_fork: Boolean(entry.forkCommand) }
    })
    return ok(agentVaultPayload(entry))
  }
  if (action === 'get') {
    const entry = agentVaultEntryFor(params.id || params.agent || params.source)
    if (!entry) return fail('AGENT_VAULT_ENTRY_NOT_FOUND', 'Agent vault entry was not found.')
    return ok(agentVaultPayload(entry))
  }
  if (action === 'remove' || action === 'delete' || action === 'unset') {
    const entry = agentVaultEntryFor(params.id || params.agent || params.source)
    if (!entry) return fail('AGENT_VAULT_ENTRY_NOT_FOUND', 'Agent vault entry was not found.')
    agentVaultEntries.delete(entry.id)
    await persistAgentVaultStore()
    publishControlEvent({ name: 'agent_vault.removed', category: 'agent', payload: { agent_id: entry.id, agent_name: entry.name } })
    return ok({ removed: true, removedId: entry.id, ...agentVaultPayload() })
  }
  if (action === 'render') {
    const entry = agentVaultEntryFor(params.id || params.agent || params.source)
    if (!entry) return fail('AGENT_VAULT_ENTRY_NOT_FOUND', 'Agent vault entry was not found.')
    const kind = cleanText(params.kind || params.commandKind || params.command_kind || 'launch') || 'launch'
    const template = kind === 'resume' ? entry.resumeCommand : kind === 'fork' ? entry.forkCommand : entry.launchCommand
    if (!template) return fail('AGENT_VAULT_TEMPLATE_NOT_FOUND', `Agent vault entry has no ${kind} command template.`)
    return ok({ agent: cloneAgentVaultEntry(entry), kind, command: renderAgentVaultTemplate(entry, template, params) })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm agent vault method: ${method}`)
}

const prepareAgentTeamLaunchParams = async (params: Record<string, unknown>): Promise<Record<string, unknown> | ControlResponse> => {
  await loadAgentVaultStore(runtime.userDataPath)
  const source = normalizeAgentVaultId(params.source || params.agent)
  const explicitCommand = cleanAgentVaultCommand(params.command || params.shell || params.commandText)
  if (!source || explicitCommand || source === 'codex' || source === 'claude' || source === 'claude-code' || source === 'claude_code' || source === 'custom') return params
  const entry = agentVaultEntryFor(source)
  if (!entry) return params
  if (!entry.launchCommand) return fail('AGENT_VAULT_LAUNCH_UNAVAILABLE', `Agent vault entry ${entry.id} has no launch command template.`)
  return {
    ...params,
    source: 'custom',
    agentVaultId: entry.id,
    agentVaultName: entry.name,
    command: renderAgentVaultTemplate(entry, entry.launchCommand, params, { preserveDynamic: true }),
    name: cleanText(params.name || params.groupName || params.title) || `${entry.name} Team`,
    groupName: cleanText(params.groupName || params.name || params.title) || `${entry.name} Team`
  }
}

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
  if (isAgentVaultMethod(method)) return handleAgentVaultControlRequest(method, params)
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
    const rendererParamsOrResponse = method === 'agent.team.launch' ? await prepareAgentTeamLaunchParams(params) : params
    if ('ok' in rendererParamsOrResponse && rendererParamsOrResponse.ok === false) return rendererParamsOrResponse as ControlResponse
    const rendererParams = rendererParamsOrResponse as Record<string, unknown>
    const response = await dispatchRendererControlRequest(method, rendererParams)
    publishRendererMutationEvent(method, rendererParams, response)
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
  if (config.userDataPath) {
    agentVaultStorePath = agentVaultPathFor(config.userDataPath)
    if (agentVaultLoadedPath && agentVaultLoadedPath !== agentVaultStorePath) agentVaultLoadedPath = ''
    eventLogStorePath = eventLogPathFor(config.userDataPath)
    if (eventLogLoadedPath && eventLogLoadedPath !== eventLogStorePath) eventLogLoadedPath = ''
  }
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
  await loadDurableEventLog(userDataPath)
  await loadAgentVaultStore(userDataPath)
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
  eventLogLoadedPath = ''
  eventLogStorePath = ''
  agentVaultEntries = new Map()
  agentVaultLoadedPath = ''
  agentVaultStorePath = ''
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}

export const invokeControlSocketMethod = (method: string, params?: Record<string, unknown>) => handleControlRequest({ method, params })

export const __testing = {
  handleControlRequest,
  listEvents: () => eventLog,
  eventLogPathFor,
  listAgentVaultEntries: () => sortedAgentVaultEntries(),
  agentVaultPathFor,
  listNotifications: () => notifications,
  pendingRendererRequestCount: () => pendingRendererRequests.size,
  eventSubscriptionCount: () => eventSubscriptions.size
}
