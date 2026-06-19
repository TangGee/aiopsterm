import { createServer, type Server, type Socket } from 'net'
import { randomBytes, randomUUID } from 'crypto'
import { appendFileSync, existsSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import { mkdir, readdir, readFile, readlink, writeFile } from 'fs/promises'
import { freemem, loadavg, totalmem, uptime } from 'os'
import type { BrowserWindow, IpcMain } from 'electron'
import { sendWindowEvent } from '@shared/windowEvents'
import type {
  AgentHookInstallerSource,
  AiAgentSessionSource,
  ControlNotificationFocusRequest,
  ControlNotificationRecord,
  ControlRequest,
  ControlResponse,
  ControlSessionSnapshot,
  ControlTerminalSummary,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionBulkOperation,
  ManagedAiSessionRecord
} from '@shared/preload'
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

type MobileEventSubscription = {
  streamId: string
  topics: string[]
  createdAt: number
  updatedAt: number
  latestSeq: number
}

type ControlWaitForWaiter = {
  id: string
  name: string
  startedAt: number
  timer: NodeJS.Timeout
  resolve: (response: ControlResponse) => void
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

type TerminalBufferEntry = {
  name: string
  text: string
  size: number
  createdAt: number
  updatedAt: number
}

type TmuxCompatHookEntry = {
  event: string
  command: string
  createdAt: number
  updatedAt: number
}

type AgentVaultEntry = {
  id: string
  name: string
  builtIn?: boolean
  description?: string
  executable?: string
  detect?: AgentVaultDetectRule
  sessionIdSource?: AgentVaultSessionIdSource
  launchCommand?: string
  resumeCommand?: string
  forkCommand?: string
  sessionDirectory?: string
  cwd?: 'preserve' | 'ignore'
  icon?: string
  createdAt: number
  updatedAt: number
}

type AgentVaultDetectRule = {
  processName?: string
  argvContains?: string[]
  executableContains?: string
  commandContains?: string[]
}

type AgentVaultSessionIdSource =
  | { type: 'provided' }
  | { type: 'argvOption'; argvOption: string }
  | { type: 'env'; envVar: string }
  | { type: 'fixed'; value: string }
  | { type: 'piSessionFile' }

type AgentVaultProcessSnapshot = {
  pid?: number
  ppid?: number
  pgid?: number
  processName?: string
  executable?: string
  argv: string[]
  commandLine?: string
  cwd?: string
  env?: Record<string, string>
  sessionId?: string
  sessionPath?: string
}

type AgentVaultScanTarget = {
  panelId: string
  sessionId?: string
  title: string
  cwd?: string
  processId: number
  processGroupId?: number
  shell?: string
}

type SessionSnapshotStore = {
  version: 1
  snapshots: ControlSessionSnapshot[]
}

const defaultTimeoutMs = 5000
const maxTimeoutMs = 30000
const maxNotifications = 500
const eventReplayLimit = 4096
const eventHeartbeatIntervalMs = 15000
const eventProtocol = 'aiopsterm-events' as const
const maxAgentVaultEntries = 200
const maxAgentVaultCommandLength = 2000
const maxSessionSnapshots = 20
const maxAgentVaultScanTerminals = 20
const maxAgentVaultScanProcessesPerTerminal = 512
const maxWaitForNameLength = 128
const maxWaitForSignals = 512
const maxWaitForWaiters = 256
const defaultWaitForTimeoutMs = 30000
const maxWaitForTimeoutMs = 300000
const maxSidebarStatusEntries = 200
const maxSidebarLogEntries = 500
const maxTerminalBuffers = 100
const maxTerminalBufferBytes = 1024 * 1024
const maxTmuxCompatHooks = 100
const maxTmuxCompatHookCommandLength = 2000
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
let notifications: ControlNotificationRecord[] = []
const eventBootId = randomUUID()
let nextEventSeq = 1
let eventLog: ControlEventFrame[] = []
let eventLogStorePath = ''
let eventLogLoadedPath = ''
const eventSubscriptions = new Map<string, ControlEventSubscription>()
let mobileEventSubscriptions = new Map<string, MobileEventSubscription>()
let agentVaultStorePath = ''
let agentVaultLoadedPath = ''
let agentVaultEntries = new Map<string, AgentVaultEntry>()
let agentVaultWriteQueue: Promise<void> = Promise.resolve()
let sessionSnapshotStorePath = ''
let sessionSnapshotLoadedPath = ''
let sessionSnapshots: ControlSessionSnapshot[] = []
let sessionSnapshotWriteQueue: Promise<void> = Promise.resolve()
let waitForSignals = new Map<string, number>()
let waitForWaiters = new Map<string, Set<ControlWaitForWaiter>>()
let sidebarStatusEntries = new Map<string, SidebarStatusEntry>()
let sidebarProgressEntries = new Map<string, SidebarProgressEntry>()
let sidebarLogEntries: SidebarLogEntry[] = []
let terminalBuffers = new Map<string, TerminalBufferEntry>()
let tmuxCompatHooks = new Map<string, TmuxCompatHookEntry>()

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeTimeoutMs = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultTimeoutMs
  return Math.max(500, Math.min(maxTimeoutMs, Math.round(numberValue)))
}

const normalizeWaitForTimeoutMs = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultWaitForTimeoutMs
  return Math.max(1, Math.min(maxWaitForTimeoutMs, Math.round(numberValue)))
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

const normalizeWaitForName = (value: unknown) => {
  const text = cleanText(value)
  if (!text || text.length > maxWaitForNameLength) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
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

const cleanTerminalBufferName = (value: unknown) => {
  const text = cleanText(value) || 'default'
  if (text.length > 80) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

const cleanTmuxCompatHookEvent = (value: unknown) => {
  const text = cleanText(value)
  if (!text || text.length > 120) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

const cleanTmuxCompatHookCommand = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || Buffer.byteLength(text, 'utf8') > maxTmuxCompatHookCommandLength) return ''
  return text
}

const terminalBufferText = (params: Record<string, unknown>) => {
  const value = typeof params.text === 'string' ? params.text : typeof params.data === 'string' ? params.data : typeof params.value === 'string' ? params.value : ''
  const bytes = Buffer.byteLength(value, 'utf8')
  if (!value || bytes > maxTerminalBufferBytes) return { text: '', bytes }
  return { text: value, bytes }
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
      notificationCount: notifications.length,
      unreadNotificationCount: notifications.filter((notification) => !notification.read).length,
      eventCount: eventLog.length,
      latestEventSeq: nextEventSeq - 1
    },
    capabilities: controlSocketCapabilities
  })

const agentVaultPathFor = (userDataPath: string) => join(userDataPath, 'control', 'agent-vault.json')
const eventLogPathFor = (userDataPath: string) => join(userDataPath, 'control', 'events.jsonl')
const sessionSnapshotPathFor = (userDataPath: string) => join(userDataPath, 'control', 'session-snapshots.json')

const isEventStreamMethod = (method: unknown) => {
  const normalized = cleanText(method)
  return normalized === 'events.stream' || normalized === 'event.stream' || normalized === 'event.subscribe' || normalized === 'events.subscribe'
}

const isEventListMethod = (method: string) => method === 'events.list' || method === 'event.list'

const isMobileEventsMethod = (method: string) => method === 'mobile.events.subscribe' || method === 'mobile.events.unsubscribe'

const isMobileChatMethod = (method: string) => method.startsWith('mobile.chat.') || method === 'chat.sessions.dump'

const isMobileAttachTicketMethod = (method: string) => method === 'mobile.attach_ticket.create'

const isAgentVaultMethod = (method: string) => method.startsWith('agent.vault.') || method.startsWith('agent-vault.')

const isAgentSessionMethod = (method: string) => method.startsWith('agent.session.') || method.startsWith('agent.sessions.') || method.startsWith('ai.session.')

const isAgentHooksMethod = (method: string) => method.startsWith('agent.hooks.') || method.startsWith('hooks.')

const isFeedMethod = (method: string) => method.startsWith('feed.')

const isSessionMethod = (method: string) => method.startsWith('session.') || method.startsWith('restore-session.')

const isWaitForMethod = (method: string) => method === 'wait-for' || method === 'wait_for' || method === 'sync.wait_for' || method.startsWith('sync.wait_for.')

const isSidebarMetadataMethod = (method: string) =>
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

const cleanAgentVaultTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).slice(0, 20)
  const text = cleanText(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
}

const nestedRecord = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

const normalizeAgentVaultDetectRule = (value: unknown, existing?: AgentVaultDetectRule): AgentVaultDetectRule | undefined => {
  const record = nestedRecord(value)
  const processName = cleanText(record?.processName || record?.process_name || record?.name || existing?.processName)
  const executableContains = cleanText(record?.executableContains || record?.executable_contains || existing?.executableContains)
  const argvContains = cleanAgentVaultTextList(record?.argvContains || record?.argv_contains)
  const commandContains = cleanAgentVaultTextList(record?.commandContains || record?.command_contains)
  const mergedArgvContains = argvContains.length ? argvContains : existing?.argvContains || []
  const mergedCommandContains = commandContains.length ? commandContains : existing?.commandContains || []
  const rule: AgentVaultDetectRule = {
    ...(processName ? { processName } : {}),
    ...(mergedArgvContains.length ? { argvContains: mergedArgvContains } : {}),
    ...(executableContains ? { executableContains } : {}),
    ...(mergedCommandContains.length ? { commandContains: mergedCommandContains } : {})
  }
  return Object.keys(rule).length ? rule : undefined
}

const normalizeAgentVaultSessionIdSource = (value: unknown, existing?: AgentVaultSessionIdSource): AgentVaultSessionIdSource | undefined => {
  const record = nestedRecord(value)
  const rawType = cleanText(record?.type || value || existing?.type)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (!rawType) return existing
  if (rawType === 'provided') return { type: 'provided' }
  if (rawType === 'argvoption' || rawType === 'argv') {
    const argvOption = cleanText(record?.argvOption || record?.argv_option || record?.option || (existing?.type === 'argvOption' ? existing.argvOption : ''))
    return argvOption ? { type: 'argvOption', argvOption } : existing
  }
  if (rawType === 'env' || rawType === 'environment') {
    const envVar = cleanText(record?.envVar || record?.env_var || record?.name || (existing?.type === 'env' ? existing.envVar : ''))
    return envVar ? { type: 'env', envVar } : existing
  }
  if (rawType === 'fixed' || rawType === 'constant') {
    const fixed = cleanText(record?.value || record?.sessionId || record?.session_id || (existing?.type === 'fixed' ? existing.value : ''))
    return fixed ? { type: 'fixed', value: fixed } : existing
  }
  if (rawType === 'pisessionfile') return { type: 'piSessionFile' }
  return existing
}

const normalizeAgentVaultCwdMode = (value: unknown, existing?: AgentVaultEntry['cwd']) => {
  const text = cleanText(value).toLowerCase()
  if (text === 'preserve' || text === 'keep') return 'preserve'
  if (text === 'ignore' || text === 'none') return 'ignore'
  return existing
}

const cloneAgentVaultEntry = (entry: AgentVaultEntry): AgentVaultEntry => JSON.parse(JSON.stringify(entry)) as AgentVaultEntry

const sortedAgentVaultEntries = () => [...agentVaultEntries.values()].sort((left, right) => left.id.localeCompare(right.id)).map(cloneAgentVaultEntry)

const agentVaultPayload = (agent?: AgentVaultEntry | null) => ({
  agents: sortedAgentVaultEntries(),
  count: agentVaultEntries.size,
  ...(agent ? { agent: cloneAgentVaultEntry(agent) } : {})
})

const cloneSessionSnapshot = (snapshot: ControlSessionSnapshot): ControlSessionSnapshot => JSON.parse(JSON.stringify(snapshot)) as ControlSessionSnapshot

const normalizeSessionPanelSnapshot = (value: unknown): ControlSessionSnapshot['panels'][number] | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = cleanText(record.id)
  const title = cleanText(record.title) || id
  const kind = record.kind === 'knowledge' ? 'knowledge' : 'terminal'
  if (!id || !title) return null
  const terminalKind = record.terminalKind === 'ssh' || record.terminalKind === 'local' || record.terminalKind === 'unknown' ? record.terminalKind : undefined
  const split = record.split === 'right' || record.split === 'below' ? record.split : undefined
  const splitOrder = Number(record.splitOrder)
  const knowledge = record.knowledge && typeof record.knowledge === 'object' && !Array.isArray(record.knowledge) ? (record.knowledge as Record<string, unknown>) : null
  const sshSession = record.sshSession && typeof record.sshSession === 'object' && !Array.isArray(record.sshSession) ? (record.sshSession as Record<string, unknown>) : null
  const resumeBinding = record.resumeBinding && typeof record.resumeBinding === 'object' && !Array.isArray(record.resumeBinding) ? (record.resumeBinding as Record<string, unknown>) : null
  const command = cleanText(resumeBinding?.command)
  return {
    id,
    title,
    kind,
    ...(cleanText(record.cwd) ? { cwd: cleanText(record.cwd) } : {}),
    ...(cleanText(record.status) ? { status: cleanText(record.status) } : {}),
    ...(terminalKind ? { terminalKind } : {}),
    ...(split ? { split } : {}),
    ...(cleanText(record.splitSourceId) ? { splitSourceId: cleanText(record.splitSourceId) } : {}),
    ...(cleanText(record.splitGroupId) ? { splitGroupId: cleanText(record.splitGroupId) } : {}),
    ...(Number.isFinite(splitOrder) ? { splitOrder: Math.floor(splitOrder) } : {}),
    ...(sshSession && cleanText(sshSession.host)
      ? {
          sshSession: {
            host: cleanText(sshSession.host),
            port: Math.max(1, Math.min(65535, Math.floor(Number(sshSession.port) || 22))),
            username: cleanText(sshSession.username) || 'root',
            ...(cleanText(sshSession.assetId) ? { assetId: cleanText(sshSession.assetId) } : {}),
            ...(cleanText(sshSession.assetName) ? { assetName: cleanText(sshSession.assetName) } : {}),
            ...(cleanText(sshSession.assetType) ? { assetType: cleanText(sshSession.assetType) } : {}),
            ...(cleanText(sshSession.organizationId) ? { organizationId: cleanText(sshSession.organizationId) } : {}),
            ...(cleanText(sshSession.jumpHostId) ? { jumpHostId: cleanText(sshSession.jumpHostId) } : {}),
            ...(cleanText(sshSession.authType) ? { authType: cleanText(sshSession.authType) } : {}),
            ...(typeof sshSession.needProxy === 'boolean' ? { needProxy: sshSession.needProxy } : {}),
            ...(cleanText(sshSession.proxyName) ? { proxyName: cleanText(sshSession.proxyName) } : {}),
            ...(cleanText(sshSession.forkFromConnectionId) ? { forkFromConnectionId: cleanText(sshSession.forkFromConnectionId) } : {})
          }
        }
      : {}),
    ...(knowledge && cleanText(knowledge.relPath)
      ? {
          knowledge: {
            relPath: cleanText(knowledge.relPath),
            isImage: knowledge.isImage === true,
            ...(Number.isFinite(knowledge.startLine) ? { startLine: Math.floor(Number(knowledge.startLine)) } : {}),
            ...(Number.isFinite(knowledge.endLine) ? { endLine: Math.floor(Number(knowledge.endLine)) } : {})
          }
        }
      : {}),
    ...(resumeBinding && command
      ? {
          resumeBinding: {
            ...(cleanText(resumeBinding.name) ? { name: cleanText(resumeBinding.name) } : {}),
            ...(cleanText(resumeBinding.kind) ? { kind: cleanText(resumeBinding.kind) } : {}),
            command,
            ...(cleanText(resumeBinding.cwd) ? { cwd: cleanText(resumeBinding.cwd) } : {}),
            ...(cleanText(resumeBinding.checkpointId || resumeBinding.checkpoint_id) ? { checkpointId: cleanText(resumeBinding.checkpointId || resumeBinding.checkpoint_id), checkpoint_id: cleanText(resumeBinding.checkpointId || resumeBinding.checkpoint_id) } : {}),
            ...(cleanText(resumeBinding.source) ? { source: cleanText(resumeBinding.source) } : {}),
            autoResume: resumeBinding.autoResume === true || resumeBinding.auto_resume === true,
            ...(cleanText(resumeBinding.approvalPolicy || resumeBinding.approval_policy) ? { approvalPolicy: cleanText(resumeBinding.approvalPolicy || resumeBinding.approval_policy), approval_policy: cleanText(resumeBinding.approvalPolicy || resumeBinding.approval_policy) } : {}),
            ...(cleanText(resumeBinding.approvalRecordId || resumeBinding.approval_record_id) ? { approvalRecordId: cleanText(resumeBinding.approvalRecordId || resumeBinding.approval_record_id), approval_record_id: cleanText(resumeBinding.approvalRecordId || resumeBinding.approval_record_id) } : {}),
            ...(Number.isFinite(resumeBinding.trustedAt) || Number.isFinite(resumeBinding.trusted_at)
              ? {
                  trustedAt: Number.isFinite(resumeBinding.trustedAt) ? Number(resumeBinding.trustedAt) : Number(resumeBinding.trusted_at),
                  trusted_at: Number.isFinite(resumeBinding.trusted_at) ? Number(resumeBinding.trusted_at) : Number(resumeBinding.trustedAt)
                }
              : {}),
            ...(cleanText(resumeBinding.trustReason || resumeBinding.trust_reason) ? { trustReason: cleanText(resumeBinding.trustReason || resumeBinding.trust_reason), trust_reason: cleanText(resumeBinding.trustReason || resumeBinding.trust_reason) } : {}),
            updatedAt: Number.isFinite(resumeBinding.updatedAt) ? Number(resumeBinding.updatedAt) : Date.now(),
            updated_at: Number.isFinite(resumeBinding.updated_at) ? Number(resumeBinding.updated_at) : Number.isFinite(resumeBinding.updatedAt) ? Number(resumeBinding.updatedAt) : Date.now()
          }
        }
      : {})
  }
}

const normalizeWorkspaceGroupSnapshot = (value: unknown): ControlSessionSnapshot['workspaceGroups'][number] | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = cleanText(record.id)
  const name = cleanText(record.name)
  const anchorPanelId = cleanText(record.anchorPanelId)
  const memberPanelIds = Array.isArray(record.memberPanelIds) ? record.memberPanelIds.map(cleanText).filter(Boolean) : []
  if (!id || !name || !anchorPanelId || !memberPanelIds.length) return null
  return {
    id,
    name,
    anchorPanelId,
    memberPanelIds: [...new Set(memberPanelIds)],
    collapsed: record.collapsed === true,
    pinned: record.pinned === true,
    index: Number.isFinite(record.index) ? Math.floor(Number(record.index)) : 0,
    createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : Date.now(),
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : Date.now(),
    ...(cleanText(record.cwd) ? { cwd: cleanText(record.cwd) } : {}),
    ...(cleanText(record.color) ? { color: cleanText(record.color) } : {}),
    ...(cleanText(record.icon) ? { icon: cleanText(record.icon) } : {})
  }
}

const normalizeSessionSnapshot = (value: unknown, fallbackId = 'latest'): ControlSessionSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const panels = Array.isArray(record.panels) ? record.panels.map(normalizeSessionPanelSnapshot).filter((item): item is ControlSessionSnapshot['panels'][number] => Boolean(item)) : []
  if (!panels.length) return null
  const panelIds = new Set(panels.map((panel) => panel.id))
  const workspaceGroups = (Array.isArray(record.workspaceGroups) ? record.workspaceGroups : [])
    .map(normalizeWorkspaceGroupSnapshot)
    .filter((group): group is ControlSessionSnapshot['workspaceGroups'][number] => Boolean(group))
    .map((group) => ({
      ...group,
      anchorPanelId: panelIds.has(group.anchorPanelId) ? group.anchorPanelId : group.memberPanelIds.find((panelId) => panelIds.has(panelId)) || '',
      memberPanelIds: group.memberPanelIds.filter((panelId) => panelIds.has(panelId))
    }))
    .filter((group) => group.anchorPanelId && group.memberPanelIds.length)
    .map((group, index) => ({ ...group, index }))
  const now = Date.now()
  const id = cleanText(record.id) || fallbackId
  return {
    id,
    name: cleanText(record.name) || id,
    version: 1,
    createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : now,
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : now,
    activePanelId: panelIds.has(cleanText(record.activePanelId)) ? cleanText(record.activePanelId) : panels[0].id,
    mode: cleanText(record.mode) || 'terminal',
    activeModule: cleanText(record.activeModule) || 'workspace',
    panels,
    workspaceGroups,
    ...(record.agentHibernation && typeof record.agentHibernation === 'object' && !Array.isArray(record.agentHibernation) ? { agentHibernation: record.agentHibernation as ControlSessionSnapshot['agentHibernation'] } : {}),
    ...(cleanText(record.source) ? { source: cleanText(record.source) } : {})
  }
}

const sortedSessionSnapshots = () => [...sessionSnapshots].sort((left, right) => right.updatedAt - left.updatedAt).map(cloneSessionSnapshot)

const sessionSnapshotPayload = (snapshot?: ControlSessionSnapshot | null) => ({
  snapshots: sortedSessionSnapshots(),
  count: sessionSnapshots.length,
  latest: sortedSessionSnapshots()[0] || null,
  ...(snapshot ? { snapshot: cloneSessionSnapshot(snapshot) } : {})
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

const normalizeAgentVaultEntry = (value: unknown, existing?: AgentVaultEntry): AgentVaultEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = normalizeAgentVaultId(record.id || existing?.id)
  if (!id || !isValidAgentVaultId(id)) return null
  const name = cleanText(record.name) || existing?.name || id
  const launchCommand = cleanAgentVaultCommand(record.launchCommand || record.launch_command || record.launch || record.command) || existing?.launchCommand
  const resumeCommand = cleanAgentVaultCommand(record.resumeCommand || record.resume_command || record.resume) || existing?.resumeCommand
  const forkCommand = cleanAgentVaultCommand(record.forkCommand || record.fork_command || record.fork) || existing?.forkCommand
  const flatDetect = {
    processName: record.processName || record.process_name,
    argvContains: record.argvContains || record.argv_contains,
    executableContains: record.executableContains || record.executable_contains,
    commandContains: record.commandContains || record.command_contains
  }
  const detect = normalizeAgentVaultDetectRule(record.detect || flatDetect, existing?.detect)
  const flatSessionSource = record.sessionIdSource || record.session_id_source
    ? record.sessionIdSource || record.session_id_source
    : record.argvOption || record.argv_option
      ? { type: 'argvOption', argvOption: record.argvOption || record.argv_option }
      : record.envVar || record.env_var
        ? { type: 'env', envVar: record.envVar || record.env_var }
        : undefined
  const sessionIdSource = normalizeAgentVaultSessionIdSource(flatSessionSource, existing?.sessionIdSource)
  const cwd = normalizeAgentVaultCwdMode(record.cwd || record.cwdMode || record.cwd_mode, existing?.cwd)
  if (!launchCommand && !resumeCommand && !forkCommand) return null
  const now = Date.now()
  return {
    id,
    name,
    ...(cleanText(record.description) || existing?.description ? { description: cleanText(record.description) || existing?.description } : {}),
    ...(cleanText(record.executable) || existing?.executable ? { executable: cleanText(record.executable) || existing?.executable } : {}),
    ...(detect ? { detect } : {}),
    ...(sessionIdSource ? { sessionIdSource } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(forkCommand ? { forkCommand } : {}),
    ...(cleanText(record.sessionDirectory || record.session_directory || record.sessionDir) || existing?.sessionDirectory
      ? { sessionDirectory: cleanText(record.sessionDirectory || record.session_directory || record.sessionDir) || existing?.sessionDirectory }
      : {}),
    ...(cwd ? { cwd } : {}),
    ...(cleanText(record.icon || record.iconAssetName) || existing?.icon ? { icon: cleanText(record.icon || record.iconAssetName) || existing?.icon } : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

const defaultAgentVaultEntries = (): AgentVaultEntry[] => {
  const now = Date.now()
  return [
    {
      id: 'omp',
      name: 'OMP',
      builtIn: true,
      executable: 'omp',
      detect: { processName: 'omp' },
      sessionIdSource: { type: 'piSessionFile' },
      resumeCommand: '{{executable}} --session {{sessionId}}',
      forkCommand: '{{executable}} --session {{sessionId}} --fork',
      sessionDirectory: '~/.omp/agent/sessions',
      cwd: 'preserve',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'pi',
      name: 'Pi',
      builtIn: true,
      executable: 'pi',
      detect: { processName: 'pi', argvContains: ['pi'] },
      sessionIdSource: { type: 'piSessionFile' },
      resumeCommand: '{{executable}} --session {{sessionId}}',
      forkCommand: '{{executable}} --session {{sessionId}} --fork',
      sessionDirectory: '~/.pi/agent/sessions',
      cwd: 'preserve',
      createdAt: now,
      updatedAt: now
    }
  ]
}

const seedDefaultAgentVaultEntries = () => {
  for (const entry of defaultAgentVaultEntries()) {
    if (!agentVaultEntries.has(entry.id)) agentVaultEntries.set(entry.id, entry)
  }
}

const loadAgentVaultStore = async (userDataPath?: string) => {
  if (userDataPath) agentVaultStorePath = agentVaultPathFor(userDataPath)
  if (!agentVaultStorePath || agentVaultLoadedPath === agentVaultStorePath) return
  agentVaultEntries = new Map()
  seedDefaultAgentVaultEntries()
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
    seedDefaultAgentVaultEntries()
  }
}

const persistAgentVaultStore = async () => {
  if (!agentVaultStorePath) return
  const payload = {
    version: 1,
    agents: sortedAgentVaultEntries().filter((entry) => entry.builtIn !== true)
  }
  agentVaultWriteQueue = agentVaultWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(agentVaultStorePath), { recursive: true })
      await writeFile(agentVaultStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    })
  await agentVaultWriteQueue
}

const loadSessionSnapshotStore = async (userDataPath?: string) => {
  if (userDataPath) sessionSnapshotStorePath = sessionSnapshotPathFor(userDataPath)
  if (!sessionSnapshotStorePath || sessionSnapshotLoadedPath === sessionSnapshotStorePath) return
  sessionSnapshotLoadedPath = sessionSnapshotStorePath
  sessionSnapshots = []
  if (!existsSync(sessionSnapshotStorePath)) return
  try {
    const raw = await readFile(sessionSnapshotStorePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const items = parsed && typeof parsed === 'object' && Array.isArray((parsed as SessionSnapshotStore).snapshots) ? (parsed as SessionSnapshotStore).snapshots : []
    sessionSnapshots = items
      .map((item) => normalizeSessionSnapshot(item))
      .filter((item): item is ControlSessionSnapshot => Boolean(item))
      .slice(0, maxSessionSnapshots)
  } catch {
    sessionSnapshots = []
  }
}

const persistSessionSnapshotStore = async () => {
  if (!sessionSnapshotStorePath) return
  const payload: SessionSnapshotStore = {
    version: 1,
    snapshots: sortedSessionSnapshots().slice(0, maxSessionSnapshots)
  }
  sessionSnapshotWriteQueue = sessionSnapshotWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(sessionSnapshotStorePath), { recursive: true })
      await writeFile(sessionSnapshotStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    })
  await sessionSnapshotWriteQueue
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

const cleanPositiveInteger = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return undefined
  const normalized = Math.floor(numberValue)
  return normalized > 0 ? normalized : undefined
}

const splitCommandLine = (value: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false
  for (const char of value.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

const normalizeAgentVaultProcessSnapshot = (value: unknown): AgentVaultProcessSnapshot | null => {
  const record = nestedRecord(value)
  if (!record) return null
  const commandLine = cleanText(record.commandLine || record.command_line || record.command)
  const argv = Array.isArray(record.argv)
    ? record.argv.map(cleanText).filter(Boolean).slice(0, 200)
    : Array.isArray(record.args)
      ? record.args.map(cleanText).filter(Boolean).slice(0, 200)
      : commandLine
        ? splitCommandLine(commandLine).slice(0, 200)
        : []
  const envRecord = nestedRecord(record.env || record.environment)
  const env = envRecord
    ? Object.fromEntries(
        Object.entries(envRecord)
          .map(([key, val]) => [cleanText(key), cleanText(val)] as const)
          .filter(([key, val]) => key && val)
          .slice(0, 200)
      )
    : undefined
  const executable = cleanText(record.executable || record.exe || record.path || argv[0])
  const processName = cleanText(record.processName || record.process_name || record.name || (executable ? basename(executable) : ''))
  return {
    ...(cleanPositiveInteger(record.pid || record.processId || record.process_id) ? { pid: cleanPositiveInteger(record.pid || record.processId || record.process_id) } : {}),
    ...(cleanPositiveInteger(record.ppid || record.parentProcessId || record.parent_process_id) ? { ppid: cleanPositiveInteger(record.ppid || record.parentProcessId || record.parent_process_id) } : {}),
    ...(cleanPositiveInteger(record.pgid || record.processGroupId || record.process_group_id) ? { pgid: cleanPositiveInteger(record.pgid || record.processGroupId || record.process_group_id) } : {}),
    ...(processName ? { processName } : {}),
    ...(executable ? { executable } : {}),
    argv,
    ...(commandLine ? { commandLine } : argv.length ? { commandLine: argv.join(' ') } : {}),
    ...(cleanText(record.cwd || record.workingDirectory || record.working_directory) ? { cwd: cleanText(record.cwd || record.workingDirectory || record.working_directory) } : {}),
    ...(env ? { env } : {}),
    ...(cleanText(record.sessionId || record.session_id) ? { sessionId: cleanText(record.sessionId || record.session_id) } : {}),
    ...(cleanText(record.sessionPath || record.session_path) ? { sessionPath: cleanText(record.sessionPath || record.session_path) } : {})
  }
}

const normalizedProcessName = (value?: string) => basename(cleanText(value)).toLowerCase()

const agentVaultProcessNameMatches = (candidate: string, expected: string) => {
  const left = normalizedProcessName(candidate)
  const right = normalizedProcessName(expected)
  return Boolean(left && right && (left === right || left.replace(/\.(exe|cmd|bat)$/i, '') === right.replace(/\.(exe|cmd|bat)$/i, '')))
}

const agentVaultEntryMatchesProcess = (entry: AgentVaultEntry, process: AgentVaultProcessSnapshot) => {
  const detect = entry.detect
  const argvText = process.argv.join('\n').toLowerCase()
  const commandText = cleanText(process.commandLine || process.argv.join(' ')).toLowerCase()
  const executableText = cleanText(process.executable).toLowerCase()
  if (detect) {
    if (detect.processName && !agentVaultProcessNameMatches(process.processName || process.executable || process.argv[0] || '', detect.processName)) return false
    if (detect.executableContains && !executableText.includes(detect.executableContains.toLowerCase())) return false
    if (detect.argvContains?.some((needle) => !argvText.includes(needle.toLowerCase()))) return false
    if (detect.commandContains?.some((needle) => !commandText.includes(needle.toLowerCase()))) return false
    return true
  }
  const fallbackNames = [entry.executable, entry.id].map(cleanText).filter(Boolean)
  return fallbackNames.some((name) => agentVaultProcessNameMatches(process.processName || process.executable || process.argv[0] || '', name))
}

const sessionIdFromArgvOption = (argv: string[], option: string) => {
  const optionText = cleanText(option)
  if (!optionText) return undefined
  const prefix = `${optionText}=`
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === optionText) return cleanText(argv[index + 1])
    if (arg.startsWith(prefix)) return cleanText(arg.slice(prefix.length))
  }
  return undefined
}

const agentVaultSessionIdFromProcess = (entry: AgentVaultEntry, process: AgentVaultProcessSnapshot, params: Record<string, unknown>) => {
  const explicit = cleanText(params.sessionId || params.session_id || process.sessionId)
  const source = entry.sessionIdSource || (explicit ? { type: 'provided' as const } : undefined)
  if (!source) return explicit
  if (source.type === 'provided') return explicit
  if (source.type === 'fixed') return source.value
  if (source.type === 'env') return cleanText(process.env?.[source.envVar])
  if (source.type === 'argvOption') return sessionIdFromArgvOption(process.argv, source.argvOption)
  if (source.type === 'piSessionFile') return explicit || cleanText(process.sessionPath)
  return explicit
}

const agentVaultMatchForProcess = (entry: AgentVaultEntry, process: AgentVaultProcessSnapshot, params: Record<string, unknown> = {}, terminal?: AgentVaultScanTarget) => {
  const sessionId = agentVaultSessionIdFromProcess(entry, process, params)
  const sessionPath = cleanText(params.sessionPath || params.session_path || process.sessionPath || sessionId)
  const cwd = entry.cwd === 'ignore' ? '' : cleanText(params.cwd || process.cwd || terminal?.cwd)
  const renderParams = {
    ...params,
    executable: process.executable || entry.executable,
    cwd,
    sessionId,
    session_id: sessionId,
    sessionPath,
    session_path: sessionPath,
    sessionDir: params.sessionDir || params.sessionDirectory || params.session_directory || entry.sessionDirectory
  }
  return {
    agent: cloneAgentVaultEntry(entry),
    matched: true,
    sessionId: sessionId || '',
    ...(sessionPath ? { sessionPath } : {}),
    ...(cwd ? { cwd } : {}),
    ...(terminal
      ? {
          panelId: terminal.panelId,
          ...(terminal.sessionId ? { terminalSessionId: terminal.sessionId } : {}),
          terminalTitle: terminal.title,
          terminalProcessId: terminal.processId
        }
      : {}),
    process: {
      ...(process.pid ? { pid: process.pid } : {}),
      ...(process.ppid ? { ppid: process.ppid } : {}),
      ...(process.pgid ? { pgid: process.pgid } : {}),
      ...(process.processName ? { processName: process.processName } : {}),
      ...(process.executable ? { executable: process.executable } : {}),
      argv: process.argv
    },
    canResume: Boolean(entry.resumeCommand && sessionId),
    canFork: Boolean(entry.forkCommand && sessionId),
    ...(entry.resumeCommand && sessionId ? { resumeCommand: renderAgentVaultTemplate(entry, entry.resumeCommand, renderParams) } : {}),
    ...(entry.forkCommand && sessionId ? { forkCommand: renderAgentVaultTemplate(entry, entry.forkCommand, renderParams) } : {})
  }
}

const agentVaultIdentify = async (params: Record<string, unknown>) => {
  await loadAgentVaultStore(runtime.userDataPath)
  const process = normalizeAgentVaultProcessSnapshot(params.process || params)
  if (!process) return fail('AGENT_VAULT_PROCESS_INVALID', 'Agent vault identify requires a process snapshot.')
  const source = normalizeAgentVaultId(params.id || params.agent || params.source)
  const candidates = (source ? [agentVaultEntryFor(source)].filter(Boolean) : sortedAgentVaultEntries()) as AgentVaultEntry[]
  const matches = candidates
    .filter((entry) => agentVaultEntryMatchesProcess(entry, process))
    .map((entry) => agentVaultMatchForProcess(entry, process, params))
  return ok({
    matches,
    count: matches.length,
    matched: matches.length > 0,
    process
  })
}

const normalizeAgentVaultScanTarget = (value: unknown): AgentVaultScanTarget | null => {
  const record = nestedRecord(value)
  if (!record) return null
  const kind = cleanText(record.kind).toLowerCase()
  const panelId = cleanText(record.panelId || record.panel_id || record.surfaceId || record.surface_id)
  const processId = cleanPositiveInteger(record.processId || record.process_id || record.pid)
  if (!panelId || !processId || (kind && kind !== 'local')) return null
  return {
    panelId,
    ...(cleanText(record.sessionId || record.session_id) ? { sessionId: cleanText(record.sessionId || record.session_id) } : {}),
    title: cleanText(record.title) || panelId,
    ...(cleanText(record.cwd) ? { cwd: cleanText(record.cwd) } : {}),
    processId,
    ...(cleanPositiveInteger(record.processGroupId || record.process_group_id || record.pgid) ? { processGroupId: cleanPositiveInteger(record.processGroupId || record.process_group_id || record.pgid) } : {}),
    ...(cleanText(record.shell) ? { shell: cleanText(record.shell) } : {})
  }
}

const extractProcStatFields = (stat: string) => {
  const end = stat.lastIndexOf(')')
  if (end < 0) return null
  const processName = stat.slice(stat.indexOf('(') + 1, end)
  const fields = stat.slice(end + 2).trim().split(/\s+/)
  const ppid = cleanPositiveInteger(fields[1])
  const pgid = cleanPositiveInteger(fields[2])
  return {
    processName,
    ...(ppid ? { ppid } : {}),
    ...(pgid ? { pgid } : {})
  }
}

const procText = async (path: string) => {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

const procLink = async (path: string) => {
  try {
    return await readlink(path)
  } catch {
    return ''
  }
}

const expandHomePath = (value: string) => {
  const text = cleanText(value)
  if (!text.startsWith('~/')) return text
  const home = cleanText(process.env.HOME)
  return home ? join(home, text.slice(2)) : text
}

const agentVaultSessionPathFromOpenFiles = async (pid: number, entry: AgentVaultEntry) => {
  const sessionDir = expandHomePath(entry.sessionDirectory || '')
  if (!sessionDir) return ''
  let names: string[] = []
  try {
    names = await readdir(`/proc/${pid}/fd`)
  } catch {
    return ''
  }
  for (const name of names.slice(0, 256)) {
    const target = await procLink(`/proc/${pid}/fd/${name}`)
    if (target && target.startsWith(sessionDir)) return target
  }
  return ''
}

const agentVaultSnapshotFromProc = async (pid: number, entries: AgentVaultEntry[]): Promise<AgentVaultProcessSnapshot | null> => {
  const statText = await procText(`/proc/${pid}/stat`)
  const stat = extractProcStatFields(statText)
  if (!stat) return null
  const rawCmdline = await procText(`/proc/${pid}/cmdline`)
  const argv = rawCmdline
    .split('\u0000')
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 200)
  const executable = await procLink(`/proc/${pid}/exe`)
  const cwd = await procLink(`/proc/${pid}/cwd`)
  const commandLine = argv.length ? argv.join(' ') : stat.processName
  const snapshot: AgentVaultProcessSnapshot = {
    pid,
    ...(stat.ppid ? { ppid: stat.ppid } : {}),
    ...(stat.pgid ? { pgid: stat.pgid } : {}),
    processName: stat.processName,
    ...(executable ? { executable } : argv[0] ? { executable: argv[0] } : {}),
    argv,
    ...(commandLine ? { commandLine } : {}),
    ...(cwd ? { cwd } : {})
  }
  for (const entry of entries) {
    if (entry.sessionIdSource?.type !== 'piSessionFile' || !agentVaultEntryMatchesProcess(entry, snapshot)) continue
    const sessionPath = await agentVaultSessionPathFromOpenFiles(pid, entry)
    if (sessionPath) return { ...snapshot, sessionPath }
  }
  return snapshot
}

const scanDescendantProcesses = async (rootPid: number) => {
  const children = new Map<number, number[]>()
  const pids: number[] = []
  let procEntries: string[] = []
  try {
    procEntries = await readdir('/proc')
  } catch {
    return []
  }
  await Promise.all(
    procEntries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        const pid = Number(name)
        const stat = extractProcStatFields(await procText(`/proc/${pid}/stat`))
        if (!stat?.ppid) return
        pids.push(pid)
        children.set(stat.ppid, [...(children.get(stat.ppid) || []), pid])
      })
  )
  const descendants: number[] = []
  const queue = [...(children.get(rootPid) || [])]
  const seen = new Set<number>([rootPid])
  while (queue.length && descendants.length < maxAgentVaultScanProcessesPerTerminal) {
    const pid = queue.shift()
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    descendants.push(pid)
    queue.push(...(children.get(pid) || []))
  }
  return descendants.filter((pid) => pids.includes(pid))
}

const agentVaultScanProcesses = async (params: Record<string, unknown>) => {
  if (process.platform !== 'linux') {
    return ok({
      matches: [],
      count: 0,
      matched: false,
      terminals: [],
      scannedProcessCount: 0,
      unsupported: true,
      platform: process.platform,
      message: 'Agent Vault process scanning is currently implemented for Linux /proc only.'
    })
  }
  const snapshotResponse = await dispatchRendererControlRequest('terminal.list', params)
  if (!snapshotResponse.ok) return snapshotResponse
  const terminals = Array.isArray(snapshotResponse.data?.terminals)
    ? (snapshotResponse.data.terminals as unknown[])
        .map(normalizeAgentVaultScanTarget)
        .filter((item): item is AgentVaultScanTarget => Boolean(item))
        .slice(0, maxAgentVaultScanTerminals)
    : []
  const requestedPanelId = cleanText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.panel)
  const requestedSessionId = cleanText(params.sessionId || params.session_id || params.terminalSessionId || params.terminal_session_id || params.session)
  const selectedTerminals = terminals.filter((terminal) => {
    if (requestedPanelId && terminal.panelId !== requestedPanelId) return false
    if (requestedSessionId && terminal.sessionId !== requestedSessionId) return false
    return true
  })
  const source = normalizeAgentVaultId(params.id || params.agent || params.source)
  const candidates = (source ? [agentVaultEntryFor(source)].filter(Boolean) : sortedAgentVaultEntries()) as AgentVaultEntry[]
  const matches: ReturnType<typeof agentVaultMatchForProcess>[] = []
  const scannedProcesses: AgentVaultProcessSnapshot[] = []
  for (const terminal of selectedTerminals) {
    const pids = await scanDescendantProcesses(terminal.processId)
    for (const pid of pids) {
      const processSnapshot = await agentVaultSnapshotFromProc(pid, candidates)
      if (!processSnapshot) continue
      scannedProcesses.push(processSnapshot)
      for (const entry of candidates) {
        if (!agentVaultEntryMatchesProcess(entry, processSnapshot)) continue
        matches.push(agentVaultMatchForProcess(entry, processSnapshot, params, terminal))
      }
    }
  }
  const uniqueMatches = [...new Map(matches.map((match) => [`${match.agent.id}:${match.process.pid || ''}:${match.sessionId}:${match.panelId || ''}`, match])).values()]
  return ok({
    matches: uniqueMatches,
    count: uniqueMatches.length,
    matched: uniqueMatches.length > 0,
    terminals: selectedTerminals,
    scannedProcessCount: scannedProcesses.length,
    scannedProcesses,
    platform: process.platform
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
  if (action === 'identify' || action === 'detect') return agentVaultIdentify(params)
  if (action === 'scan' || action === 'scan-processes') return agentVaultScanProcesses(params)
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm agent vault method: ${method}`)
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

const sessionSnapshotFor = (value: unknown) => {
  const id = cleanText(value)
  if (!id || id === 'latest') return sortedSessionSnapshots()[0] || null
  return sessionSnapshots.find((snapshot) => snapshot.id === id || snapshot.name === id) || null
}

const handleSessionControlRequest = async (method: string, params: Record<string, unknown>) => {
  await loadSessionSnapshotStore(runtime.userDataPath)
  const action = method.startsWith('session.') ? method.slice('session.'.length) : method.slice('restore-session.'.length)
  if (action === 'list') return ok(sessionSnapshotPayload())
  if (action === 'show' || action === 'get') {
    const snapshot = sessionSnapshotFor(params.id || params.name || 'latest')
    if (!snapshot) return fail('SESSION_SNAPSHOT_NOT_FOUND', 'Session snapshot was not found.')
    return ok(sessionSnapshotPayload(snapshot))
  }
  if (action === 'clear' || action === 'delete' || action === 'remove') {
    const snapshot = sessionSnapshotFor(params.id || params.name || 'latest')
    if (!snapshot) return fail('SESSION_SNAPSHOT_NOT_FOUND', 'Session snapshot was not found.')
    sessionSnapshots = sessionSnapshots.filter((item) => item.id !== snapshot.id)
    await persistSessionSnapshotStore()
    publishControlEvent({ name: 'session.cleared', category: 'workspace', payload: { snapshot_id: snapshot.id, snapshot_name: snapshot.name } })
    return ok({ removed: true, removedId: snapshot.id, ...sessionSnapshotPayload() })
  }
  if (action === 'save') {
    const response = await dispatchRendererControlRequest('session.export', params)
    if (!response.ok) return response
    const exported = normalizeSessionSnapshot(response.data?.snapshot, cleanText(params.id || params.name) || 'latest')
    if (!exported) return fail('SESSION_SNAPSHOT_INVALID', 'Renderer returned an invalid session snapshot.')
    const now = Date.now()
    const snapshot: ControlSessionSnapshot = {
      ...exported,
      id: cleanText(params.id || exported.id) || 'latest',
      name: cleanText(params.name || exported.name) || cleanText(params.id || exported.id) || 'Latest Session',
      createdAt: sessionSnapshots.find((item) => item.id === (cleanText(params.id || exported.id) || 'latest'))?.createdAt || exported.createdAt || now,
      updatedAt: now,
      source: cleanText(params.source) || 'manual'
    }
    sessionSnapshots = [snapshot, ...sessionSnapshots.filter((item) => item.id !== snapshot.id)].slice(0, maxSessionSnapshots)
    await persistSessionSnapshotStore()
    publishControlEvent({
      name: 'session.saved',
      category: 'workspace',
      payload: {
        snapshot_id: snapshot.id,
        snapshot_name: snapshot.name,
        panel_count: snapshot.panels.length,
        workspace_group_count: snapshot.workspaceGroups.length
      }
    })
    return ok(sessionSnapshotPayload(snapshot))
  }
  if (action === 'restore' || action === 'run' || action === 'reopen') {
    const snapshot = sessionSnapshotFor(params.id || params.name || 'latest')
    if (!snapshot) return fail('SESSION_SNAPSHOT_NOT_FOUND', 'Session snapshot was not found.')
    const response = await dispatchRendererControlRequest('session.restore', {
      ...params,
      snapshot
    }, { focus: true })
    if (!response.ok) return response
    publishControlEvent({
      name: 'session.restored',
      category: 'workspace',
      payload: {
        snapshot_id: snapshot.id,
        snapshot_name: snapshot.name,
        panel_count: snapshot.panels.length,
        workspace_group_count: snapshot.workspaceGroups.length
      }
    })
    return response
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm session method: ${method}`)
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

const handleMobileEventsControlRequest = (method: string, params: Record<string, unknown>) => {
  if (method === 'mobile.events.subscribe') {
    const streamId = cleanText(params.stream_id || params.streamId) || randomUUID()
    const topics = [...new Set(cleanTextList(params.topics || params.topic || params.categories || params.category))].sort()
    if (!topics.length) return fail('INVALID_PARAMS', 'topics is required')
    const now = Date.now()
    const existing = mobileEventSubscriptions.get(streamId)
    const alreadySubscribed = Boolean(existing)
    mobileEventSubscriptions.set(streamId, {
      streamId,
      topics,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      latestSeq: nextEventSeq - 1
    })
    return ok({
      stream_id: streamId,
      streamId,
      topics,
      already_subscribed: alreadySubscribed,
      alreadySubscribed,
      latest_seq: nextEventSeq - 1,
      event_stream_method: 'events.stream',
      note: 'Use events.stream for live newline-delimited event frames; mobile.events.subscribe records the control_compat-compatible subscription handshake.'
    })
  }
  const streamId = cleanText(params.stream_id || params.streamId)
  const removed = streamId ? mobileEventSubscriptions.delete(streamId) : false
  return ok({
    stream_id: streamId,
    streamId,
    removed,
    latest_seq: nextEventSeq - 1
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

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (subscription.heartbeatTimer) clearInterval(subscription.heartbeatTimer)
    eventSubscriptions.delete(subscriptionId)
  }
  socket.once('close', cleanup)
  socket.once('end', cleanup)
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

const waitForPayload = (name: string, status: 'waiting' | 'signaled' | 'timeout', extra: Record<string, unknown> = {}) => ({
  name,
  status,
  ...extra
})

const trimWaitForSignals = () => {
  if (waitForSignals.size <= maxWaitForSignals) return
  const sorted = [...waitForSignals.entries()].sort((left, right) => left[1] - right[1])
  for (const [name] of sorted.slice(0, Math.max(0, waitForSignals.size - maxWaitForSignals))) waitForSignals.delete(name)
}

const signalWaitFor = (name: string) => {
  const now = Date.now()
  waitForSignals.set(name, now)
  trimWaitForSignals()
  const waiters = waitForWaiters.get(name)
  const count = waiters?.size || 0
  if (waiters) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(ok(waitForPayload(name, 'signaled', { signaledAt: now, signaled_at: now, waitedMs: now - waiter.startedAt, waited_ms: now - waiter.startedAt })))
    }
    waitForWaiters.delete(name)
  }
  publishControlEvent({
    name: 'sync.wait_for.signaled',
    category: 'control',
    source: 'control.socket',
    payload: { name, waiter_count: count }
  })
  return ok(waitForPayload(name, 'signaled', { signaledAt: now, signaled_at: now, waiterCount: count, waiter_count: count }))
}

const waitForSignal = (name: string, timeoutMs: number) => {
  const signaledAt = waitForSignals.get(name)
  if (signaledAt) {
    waitForSignals.delete(name)
    return Promise.resolve(ok(waitForPayload(name, 'signaled', { signaledAt, signaled_at: signaledAt, waitedMs: 0, waited_ms: 0 })))
  }
  const waiterCount = [...waitForWaiters.values()].reduce((count, waiters) => count + waiters.size, 0)
  if (waiterCount >= maxWaitForWaiters) return Promise.resolve(fail('WAIT_FOR_LIMIT_REACHED', `At most ${maxWaitForWaiters} wait-for calls can be pending.`))
  const startedAt = Date.now()
  return new Promise<ControlResponse>((resolve) => {
    const waiter: ControlWaitForWaiter = {
      id: randomUUID(),
      name,
      startedAt,
      timer: setTimeout(() => {
        const waiters = waitForWaiters.get(name)
        waiters?.delete(waiter)
        if (waiters && waiters.size === 0) waitForWaiters.delete(name)
        publishControlEvent({
          name: 'sync.wait_for.timeout',
          category: 'control',
          source: 'control.socket',
          payload: { name, timeout_ms: timeoutMs }
        })
        resolve(fail('WAIT_FOR_TIMEOUT', `wait-for timed out waiting for '${name}'.`, waitForPayload(name, 'timeout', { timeoutMs, timeout_ms: timeoutMs })))
      }, timeoutMs),
      resolve
    }
    waiter.timer.unref?.()
    const waiters = waitForWaiters.get(name) || new Set<ControlWaitForWaiter>()
    waiters.add(waiter)
    waitForWaiters.set(name, waiters)
  })
}

const handleWaitForControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = method.startsWith('sync.wait_for.') ? method.slice('sync.wait_for.'.length) : ''
  const name = normalizeWaitForName(params.name || params.token || params.id || params.key)
  if (!name) return fail('WAIT_FOR_NAME_INVALID', 'wait-for requires a name containing only letters, numbers, dot, underscore, colon, or dash.')
  const signal = action === 'signal' || params.signal === true || params.mode === 'signal'
  if (signal) return signalWaitFor(name)
  const timeoutMs = normalizeWaitForTimeoutMs(params.timeoutMs || params.timeout_ms || (Number.isFinite(Number(params.timeout)) ? Number(params.timeout) * 1000 : undefined))
  publishControlEvent({
    name: 'sync.wait_for.started',
    category: 'control',
    source: 'control.socket',
    payload: { name, timeout_ms: timeoutMs }
  })
  return waitForSignal(name, timeoutMs)
}

const sidebarStatusForWorkspace = (workspaceId: string) =>
  [...sidebarStatusEntries.values()]
    .filter((entry) => entry.workspaceId === workspaceId)
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))

const sidebarLogsForWorkspace = (workspaceId: string, limit?: number) => {
  const logs = sidebarLogEntries.filter((entry) => entry.workspaceId === workspaceId)
  return limit === undefined ? logs : logs.slice(-limit)
}

const sidebarStatePayload = (workspaceId: string, options: { logLimit?: number } = {}) => ({
  workspaceId,
  workspace_id: workspaceId,
  statuses: sidebarStatusForWorkspace(workspaceId),
  statusCount: sidebarStatusForWorkspace(workspaceId).length,
  status_count: sidebarStatusForWorkspace(workspaceId).length,
  progress: sidebarProgressEntries.get(workspaceId) || null,
  logs: sidebarLogsForWorkspace(workspaceId, options.logLimit),
  logCount: sidebarLogsForWorkspace(workspaceId).length,
  log_count: sidebarLogsForWorkspace(workspaceId).length
})

const handleSidebarMetadataControlRequest = async (method: string, params: Record<string, unknown>) => {
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
    publishControlEvent({ name: 'sidebar.status.set', category: 'sidebar', payload: { workspace_id: workspaceId, key, priority } })
    return ok({ status: entry, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'status.clear' || action === 'clear-status') {
    const key = cleanSidebarKey(params.key || params.name)
    if (!key) return fail('SIDEBAR_STATUS_KEY_INVALID', 'clear-status requires a valid key.')
    const removed = sidebarStatusEntries.delete(`${workspaceId}:${key}`)
    publishControlEvent({ name: 'sidebar.status.cleared', category: 'sidebar', payload: { workspace_id: workspaceId, key, removed } })
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
    publishControlEvent({ name: 'sidebar.progress.set', category: 'sidebar', payload: { workspace_id: workspaceId, value: progress.value } })
    return ok(sidebarStatePayload(workspaceId))
  }
  if (action === 'progress.clear' || action === 'clear-progress') {
    const removed = sidebarProgressEntries.delete(workspaceId)
    publishControlEvent({ name: 'sidebar.progress.cleared', category: 'sidebar', payload: { workspace_id: workspaceId, removed } })
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
    publishControlEvent({ name: 'sidebar.log.appended', category: 'sidebar', payload: { workspace_id: workspaceId, level: entry.level, source: entry.source || '' } })
    return ok({ log: entry, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'log.clear' || action === 'clear-log') {
    const before = sidebarLogEntries.length
    sidebarLogEntries = sidebarLogEntries.filter((entry) => entry.workspaceId !== workspaceId)
    const changed = before - sidebarLogEntries.length
    publishControlEvent({ name: 'sidebar.log.cleared', category: 'sidebar', payload: { workspace_id: workspaceId, changed } })
    return ok({ changed, ...sidebarStatePayload(workspaceId) })
  }
  if (action === 'log.list' || action === 'list-log') {
    const limit = cleanPositiveInteger(params.limit)
    const logs = sidebarLogsForWorkspace(workspaceId, limit)
    return ok({ logs, count: logs.length, total: sidebarLogsForWorkspace(workspaceId).length, workspaceId, workspace_id: workspaceId })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm sidebar metadata method: ${method}`)
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

const terminalPanelId = (params: Record<string, unknown>) => cleanText(params.panelId || params.panel_id || params.surfaceId || params.surface_id || params.panel || params.surface)

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

const keyDataForTerminal = (value: unknown) => {
  const raw = cleanText(value)
  if (!raw) return null
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '')
  const namedKeys: Record<string, string> = {
    enter: '\r',
    return: '\r',
    cr: '\r',
    tab: '\t',
    space: ' ',
    escape: '\x1b',
    esc: '\x1b',
    backspace: '\x7f',
    bs: '\x7f',
    delete: '\x1b[3~',
    del: '\x1b[3~',
    insert: '\x1b[2~',
    ins: '\x1b[2~',
    up: '\x1b[A',
    arrowup: '\x1b[A',
    down: '\x1b[B',
    arrowdown: '\x1b[B',
    right: '\x1b[C',
    arrowright: '\x1b[C',
    left: '\x1b[D',
    arrowleft: '\x1b[D',
    home: '\x1b[H',
    end: '\x1b[F',
    pageup: '\x1b[5~',
    pgup: '\x1b[5~',
    pagedown: '\x1b[6~',
    pgdn: '\x1b[6~',
    f1: '\x1bOP',
    f2: '\x1bOQ',
    f3: '\x1bOR',
    f4: '\x1bOS',
    f5: '\x1b[15~',
    f6: '\x1b[17~',
    f7: '\x1b[18~',
    f8: '\x1b[19~',
    f9: '\x1b[20~',
    f10: '\x1b[21~',
    f11: '\x1b[23~',
    f12: '\x1b[24~'
  }
  if (namedKeys[normalized]) return { key: raw, data: namedKeys[normalized] }
  const ctrlMatch = raw.match(/^(?:c|ctrl|control)[+-](.)$/i) || raw.match(/^\^(.)$/)
  if (ctrlMatch?.[1]) {
    const char = ctrlMatch[1].toUpperCase()
    if (char === '?') return { key: raw, data: '\x7f' }
    const code = char.charCodeAt(0)
    if (code >= 64 && code <= 95) return { key: raw, data: String.fromCharCode(code - 64) }
    if (code >= 65 && code <= 90) return { key: raw, data: String.fromCharCode(code - 64) }
  }
  if (raw.length === 1) return { key: raw, data: raw }
  return null
}

const resolveTerminalSessionForInput = async (params: Record<string, unknown>) => {
  const sessionId = terminalSessionId(params)
  if (sessionId) return { sessionId }
  const panelId = terminalPanelId(params)
  if (!panelId) return { error: fail('TERMINAL_SESSION_REQUIRED', 'sessionId is required.') }
  const response = await dispatchRendererControlRequest('terminal.focus', { ...params, panelId, surfaceId: panelId }, { focus: true })
  if (!response.ok) return { error: response }
  const terminal = response.data?.terminal && typeof response.data.terminal === 'object' ? (response.data.terminal as Record<string, unknown>) : null
  const resolvedSessionId = cleanText(terminal?.sessionId || terminal?.terminalSessionId)
  if (!resolvedSessionId) return { error: fail('TERMINAL_SESSION_NOT_FOUND', 'Selected terminal has no connected session id.', { panelId }) }
  return { sessionId: resolvedSessionId, panelId: cleanText(terminal?.panelId || panelId) }
}

const sendTerminalText = async (params: Record<string, unknown>) => {
  const text = terminalWriteData(params)
  if (!text) return fail('TERMINAL_TEXT_REQUIRED', 'text is required.')
  const resolved = await resolveTerminalSessionForInput(params)
  if (resolved.error) return resolved.error
  const sessionId = resolved.sessionId!
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

const sendTerminalKey = async (params: Record<string, unknown>) => {
  const key = keyDataForTerminal(params.key || params.name || params.text || params.data)
  if (!key) return fail('TERMINAL_KEY_UNKNOWN', 'Unknown terminal key. Use names like enter, tab, esc, up, ctrl+c, or a single character.')
  const resolved = await resolveTerminalSessionForInput(params)
  if (resolved.error) return resolved.error
  const sessionId = resolved.sessionId!
  if (!runtime.writeTerminal) return fail('TERMINAL_WRITE_UNAVAILABLE', 'Terminal write runtime is not available.')
  const response = await runtime.writeTerminal(sessionId, key.data)
  if (response.ok) {
    publishControlEvent({
      name: 'terminal.key_sent',
      category: 'terminal',
      payload: {
        session_id: sessionId,
        sessionId,
        ...(resolved.panelId ? { panel_id: resolved.panelId, panelId: resolved.panelId } : {}),
        key: key.key,
        bytes: Buffer.byteLength(key.data, 'utf8')
      }
    })
    response.data = { ...(response.data || {}), key: key.key }
  }
  return response
}

const terminalBufferSummary = (entry: TerminalBufferEntry) => ({
  name: entry.name,
  size: entry.size,
  createdAt: entry.createdAt,
  created_at: entry.createdAt,
  updatedAt: entry.updatedAt,
  updated_at: entry.updatedAt
})

const terminalBufferPayload = (buffer?: TerminalBufferEntry | null) => {
  const buffers = [...terminalBuffers.values()].sort((left, right) => left.name.localeCompare(right.name)).map(terminalBufferSummary)
  return {
    buffers,
    count: buffers.length,
    ...(buffer ? { buffer: terminalBufferSummary(buffer) } : {})
  }
}

const terminalBufferReadPayload = (entry: TerminalBufferEntry) => ({
  buffer: terminalBufferSummary(entry),
  name: entry.name,
  text: entry.text,
  size: entry.size
})

const handleTerminalBufferControlRequest = async (method: string, params: Record<string, unknown>) => {
  const action = method.startsWith('terminal.buffer.')
    ? method.slice('terminal.buffer.'.length)
    : method.startsWith('buffer.')
      ? method.slice('buffer.'.length)
      : method
  if (action === 'list' || action === 'list-buffers') return ok(terminalBufferPayload())
  if (action === 'set' || action === 'set-buffer') {
    const name = cleanTerminalBufferName(params.name || params.buffer || params.bufferName || params.buffer_name)
    if (!name) return fail('TERMINAL_BUFFER_NAME_INVALID', 'Buffer name must use letters, numbers, dot, underscore, colon, or dash.')
    const { text, bytes } = terminalBufferText(params)
    if (!text) {
      return fail(
        bytes > maxTerminalBufferBytes ? 'TERMINAL_BUFFER_TOO_LARGE' : 'TERMINAL_BUFFER_TEXT_REQUIRED',
        bytes > maxTerminalBufferBytes ? `Buffer text exceeds ${maxTerminalBufferBytes} bytes.` : 'set-buffer requires text.'
      )
    }
    const now = Date.now()
    const existing = terminalBuffers.get(name)
    const entry: TerminalBufferEntry = {
      name,
      text,
      size: bytes,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    terminalBuffers.set(name, entry)
    if (terminalBuffers.size > maxTerminalBuffers) {
      const oldest = [...terminalBuffers.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0]
      if (oldest) terminalBuffers.delete(oldest.name)
    }
    publishControlEvent({
      name: 'terminal.buffer.set',
      category: 'terminal',
      source: 'control.socket',
      payload: { buffer_name: name, size: bytes }
    })
    return ok(terminalBufferPayload(entry))
  }
  if (action === 'show' || action === 'show-buffer' || action === 'showb' || action === 'save' || action === 'save-buffer' || action === 'saveb') {
    const name = cleanTerminalBufferName(params.name || params.buffer || params.bufferName || params.buffer_name)
    if (!name) return fail('TERMINAL_BUFFER_NAME_INVALID', 'Buffer name must use letters, numbers, dot, underscore, colon, or dash.')
    const entry = terminalBuffers.get(name)
    if (!entry) return fail('TERMINAL_BUFFER_NOT_FOUND', `Buffer not found: ${name}`)
    return ok({
      ...terminalBufferReadPayload(entry),
      action,
      ...(action === 'save' || action === 'save-buffer' || action === 'saveb' ? { path: cleanText(params.path || params.output || params.file) } : {})
    })
  }
  if (action === 'paste' || action === 'paste-buffer') {
    const name = cleanTerminalBufferName(params.name || params.buffer || params.bufferName || params.buffer_name)
    if (!name) return fail('TERMINAL_BUFFER_NAME_INVALID', 'Buffer name must use letters, numbers, dot, underscore, colon, or dash.')
    const entry = terminalBuffers.get(name)
    if (!entry) return fail('TERMINAL_BUFFER_NOT_FOUND', `Buffer not found: ${name}`)
    const response = await sendTerminalText({ ...params, text: entry.text })
    if (response.ok) {
      response.data = { ...(response.data || {}), buffer: terminalBufferSummary(entry), bufferName: name, buffer_name: name }
      publishControlEvent({
        name: 'terminal.buffer.pasted',
        category: 'terminal',
        source: 'control.socket',
        surfaceId: terminalPanelId(params),
        payload: {
          buffer_name: name,
          size: entry.size,
          session_id: cleanText(response.data.id || response.data.sessionId || params.sessionId || params.terminalSessionId),
          panel_id: terminalPanelId(params)
        }
      })
    }
    return response
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm terminal buffer method: ${method}`)
}

const tmuxCompatHookSummary = (entry: TmuxCompatHookEntry) => ({
  event: entry.event,
  command: entry.command,
  createdAt: entry.createdAt,
  created_at: entry.createdAt,
  updatedAt: entry.updatedAt,
  updated_at: entry.updatedAt
})

const tmuxCompatHooksPayload = (hook?: TmuxCompatHookEntry | null) => {
  const hooks = [...tmuxCompatHooks.values()].sort((left, right) => left.event.localeCompare(right.event)).map(tmuxCompatHookSummary)
  return {
    hooks,
    count: hooks.length,
    ...(hook ? { hook: tmuxCompatHookSummary(hook) } : {})
  }
}

const tmuxCompatOptionPayload = (name: string, value: string) => ({
  option: { name, value },
  name,
  value,
  text: `${name} ${value}`
})

const handleTmuxCompatControlRequest = (method: string, params: Record<string, unknown>) => {
  const action = method.startsWith('tmux.') ? method.slice('tmux.'.length) : method
  if (action === 'hook.list' || action === 'hooks.list' || action === 'show-hooks') return ok(tmuxCompatHooksPayload())
  if (action === 'hook.unset' || action === 'set-hook.unset') {
    const event = cleanTmuxCompatHookEvent(params.event || params.name || params.hook)
    if (!event) return fail('TMUX_HOOK_EVENT_INVALID', 'set-hook --unset requires a valid event name.')
    const existing = tmuxCompatHooks.get(event) || null
    tmuxCompatHooks.delete(event)
    publishControlEvent({
      name: 'tmux.hook.unset',
      category: 'tmux',
      source: 'control.socket',
      payload: { event, removed: Boolean(existing) }
    })
    return ok({ ...tmuxCompatHooksPayload(), event, removed: Boolean(existing) })
  }
  if (action === 'hook.set' || action === 'set-hook' || action === 'set_hook') {
    const list = Boolean(params.list || params.show || params.ls)
    if (list) return ok(tmuxCompatHooksPayload())
    const unset = Boolean(params.unset || params.remove || params.delete)
    if (unset) return handleTmuxCompatControlRequest('tmux.hook.unset', params)
    const event = cleanTmuxCompatHookEvent(params.event || params.name || params.hook)
    if (!event) return fail('TMUX_HOOK_EVENT_INVALID', 'set-hook requires a valid event name.')
    const command = cleanTmuxCompatHookCommand(params.command || params.text || params.value)
    if (!command) return fail('TMUX_HOOK_COMMAND_REQUIRED', `set-hook requires a command no larger than ${maxTmuxCompatHookCommandLength} bytes.`)
    const now = Date.now()
    const existing = tmuxCompatHooks.get(event)
    const entry: TmuxCompatHookEntry = {
      event,
      command,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    tmuxCompatHooks.set(event, entry)
    if (tmuxCompatHooks.size > maxTmuxCompatHooks) {
      const oldest = [...tmuxCompatHooks.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0]
      if (oldest) tmuxCompatHooks.delete(oldest.event)
    }
    publishControlEvent({
      name: 'tmux.hook.set',
      category: 'tmux',
      source: 'control.socket',
      payload: { event }
    })
    return ok(tmuxCompatHooksPayload(entry))
  }
  if (action === 'option.show' || action === 'show-options' || action === 'show-option' || action === 'show') {
    const optionName = cleanText(params.option || params.name || params.optionName || params.option_name) || 'extended-keys'
    if (optionName !== 'extended-keys') return fail('TMUX_OPTION_UNSUPPORTED', `Unsupported tmux compatibility option: ${optionName}`, { option: optionName, unsupported: true })
    return ok({
      ...tmuxCompatOptionPayload(optionName, 'on'),
      valueOnly: Boolean(params.valueOnly || params.value_only || params.v)
    })
  }
  if (['set-option', 'set', 'set-window-option', 'setw', 'source-file', 'refresh-client', 'attach-session', 'detach-client'].includes(action)) {
    return ok({
      command: action,
      accepted: true,
      noop: true,
      reason: 'Accepted as a tmux compatibility no-op.'
    })
  }
  if (['popup', 'bind-key', 'unbind-key', 'copy-mode'].includes(action)) {
    return fail('TMUX_COMPAT_UNSUPPORTED', `${action} is not supported yet in aiopsterm tmux compatibility mode.`, {
      command: action,
      unsupported: true,
      unsupportedReason: `${action} is a recognized tmux compatibility placeholder but is not supported yet.`
    })
  }
  return fail('UNKNOWN_CONTROL_METHOD', `Unknown aiopsterm tmux compatibility method: ${method}`)
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

const createTargetedNotification = (method: string, params: Record<string, unknown>) => {
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
  if (method === 'surface.split_off') return 'surface.split_off'
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
  if (method === 'mobile.host.status') return mobileHostStatus(params)
  if (
    method === 'auth.login' ||
    method === 'auth.status' ||
    method === 'auth.sign_in_url' ||
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
  if (isSidebarMetadataMethod(method)) return handleSidebarMetadataControlRequest(method, params)
  if (isTerminalBufferMethod(method)) return handleTerminalBufferControlRequest(method, params)
  if (isTmuxCompatMethod(method)) return handleTmuxCompatControlRequest(method, params)
  if (isEventListMethod(method)) return listEvents(params)
  if (isMobileEventsMethod(method)) return handleMobileEventsControlRequest(method, params)
  if (isMobileChatMethod(method)) return handleMobileChatControlRequest(method, params)
  if (isMobileAttachTicketMethod(method)) return handleMobileAttachTicketControlRequest(params)
  if (isFeedMethod(method)) return handleFeedControlRequest(method, params)
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
    const rendererParamsOrResponse = method === 'agent.team.launch' ? await prepareAgentTeamLaunchParams(params) : params
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
  if (config.userDataPath) {
    agentVaultStorePath = agentVaultPathFor(config.userDataPath)
    if (agentVaultLoadedPath && agentVaultLoadedPath !== agentVaultStorePath) agentVaultLoadedPath = ''
    eventLogStorePath = eventLogPathFor(config.userDataPath)
    if (eventLogLoadedPath && eventLogLoadedPath !== eventLogStorePath) eventLogLoadedPath = ''
    sessionSnapshotStorePath = sessionSnapshotPathFor(config.userDataPath)
    if (sessionSnapshotLoadedPath && sessionSnapshotLoadedPath !== sessionSnapshotStorePath) sessionSnapshotLoadedPath = ''
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
  for (const subscription of eventSubscriptions.values()) {
    if (subscription.heartbeatTimer) clearInterval(subscription.heartbeatTimer)
    subscription.socket.destroy()
  }
  eventSubscriptions.clear()
  mobileEventSubscriptions.clear()
  for (const waiters of waitForWaiters.values()) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(fail('CONTROL_SOCKET_CLOSED', 'aiopsterm control socket closed before wait-for was signaled.'))
    }
  }
  waitForWaiters.clear()
  waitForSignals.clear()
  sidebarStatusEntries.clear()
  sidebarProgressEntries.clear()
  sidebarLogEntries = []
  terminalBuffers.clear()
  tmuxCompatHooks.clear()
  notifications = []
  eventLog = []
  nextEventSeq = 1
  eventLogLoadedPath = ''
  eventLogStorePath = ''
  agentVaultEntries = new Map()
  agentVaultLoadedPath = ''
  agentVaultStorePath = ''
  sessionSnapshots = []
  sessionSnapshotLoadedPath = ''
  sessionSnapshotStorePath = ''
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
  listSessionSnapshots: () => sortedSessionSnapshots(),
  sessionSnapshotPathFor,
  listAgentVaultEntries: () => sortedAgentVaultEntries(),
  agentVaultPathFor,
  listNotifications: () => notifications,
  listTerminalBuffers: () => [...terminalBuffers.values()].sort((left, right) => left.name.localeCompare(right.name)),
  listTmuxCompatHooks: () => [...tmuxCompatHooks.values()].sort((left, right) => left.event.localeCompare(right.event)),
  pendingRendererRequestCount: () => pendingRendererRequests.size,
  eventSubscriptionCount: () => eventSubscriptions.size,
  mobileEventSubscriptionCount: () => mobileEventSubscriptions.size,
  listMobileEventSubscriptions: () => [...mobileEventSubscriptions.values()].sort((left, right) => left.streamId.localeCompare(right.streamId))
}
