import { createServer, type Server, type Socket } from 'net'
import { randomUUID } from 'crypto'
import { appendFileSync, existsSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import { mkdir, readdir, readFile, readlink, writeFile } from 'fs/promises'
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
import { bulkManagedAiSessions, clearManagedAiSession, configureAiAgentSessionStore, listManagedAiSessions, renameManagedAiSession, replyManagedAiSession } from './agentSessions'
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
const controlSocketCapabilities = [
  'ping',
  'system.capabilities',
  'system.identify',
  'workspace.snapshot',
  'workspace.list',
  'workspace.current',
  'workspace.group',
  'session.restore',
  'surface.list',
  'surface.current',
  'surface.resume',
  'terminal.list',
  'terminal.focus',
  'terminal.read_screen',
  'terminal.send_text',
  'notification',
  'events.stream',
  'events.list',
  'agent.hibernation',
  'agent.team',
  'agent.vault',
  'agent.session',
  'agent.hooks'
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
let agentVaultStorePath = ''
let agentVaultLoadedPath = ''
let agentVaultEntries = new Map<string, AgentVaultEntry>()
let agentVaultWriteQueue: Promise<void> = Promise.resolve()
let sessionSnapshotStorePath = ''
let sessionSnapshotLoadedPath = ''
let sessionSnapshots: ControlSessionSnapshot[] = []
let sessionSnapshotWriteQueue: Promise<void> = Promise.resolve()

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

const isAgentVaultMethod = (method: string) => method.startsWith('agent.vault.') || method.startsWith('agent-vault.')

const isAgentSessionMethod = (method: string) => method.startsWith('agent.session.') || method.startsWith('agent.sessions.') || method.startsWith('ai.session.')

const isAgentHooksMethod = (method: string) => method.startsWith('agent.hooks.') || method.startsWith('hooks.')

const isFeedMethod = (method: string) => method.startsWith('feed.')

const isSessionMethod = (method: string) => method.startsWith('session.') || method.startsWith('restore-session.')

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
  if (action === 'list' || action === 'status') return handleAgentSessionControlRequest('agent.session.list', { ...params, needsInput: params.needsInput ?? params.needs_input ?? true })
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
  if (method.startsWith('surface.resume.') && !['surface.resume.get', 'surface.resume.show', 'surface.resume.preview', 'surface.resume.autorun.preview'].includes(method)) return method.replace('surface.resume.', 'surface_resume.')
  if (method === 'agent-hibernation.on') return 'agent_hibernation.enabled'
  if (method === 'agent-hibernation.off') return 'agent_hibernation.disabled'
  if (method === 'agent.hibernate') return 'agent.hibernated'
  if (method === 'agent.resume') return 'agent.resumed'
  if (method === 'agent-hibernation.sweep' || method === 'agent.sweep') return 'agent_hibernation.swept'
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
  const hibernated = Array.isArray(data.hibernated) ? data.hibernated : []
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
  if (!method || method === 'ping') return ok({ pong: true, socketPath })
  if (method === 'system.capabilities' || method === 'capabilities') return systemCapabilities()
  if (method === 'system.identify' || method === 'identify') return systemIdentify(params)
  if (isEventListMethod(method)) return listEvents(params)
  if (isFeedMethod(method)) return handleFeedControlRequest(method, params)
  if (isAgentHooksMethod(method)) return handleAgentHooksControlRequest(method, params)
  if (isAgentVaultMethod(method)) return handleAgentVaultControlRequest(method, params)
  if (isAgentSessionMethod(method)) return handleAgentSessionControlRequest(method, params)
  if (isSessionMethod(method)) return handleSessionControlRequest(method, params)
  if (
    method === 'workspace.snapshot' ||
    method === 'workspace.list' ||
    method === 'workspace.current' ||
    method.startsWith('workspace.group.') ||
    method === 'surface.list' ||
    method === 'surface.current' ||
    method.startsWith('surface.resume.') ||
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
  pendingRendererRequestCount: () => pendingRendererRequests.size,
  eventSubscriptionCount: () => eventSubscriptions.size
}
