import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { appendFile, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { Socket } from 'net'
import type {
  ControlResponse,
  ControlSessionSnapshot
} from '@shared/contracts/control'

type ControlSocketRequest = {
  id?: string
  method?: string
  params?: Record<string, unknown>
}

type ControlSocketStateRuntime = {
  userDataPath?: string
  dispatchRendererControlRequest?: (method: string, params?: Record<string, unknown>, options?: { focus?: boolean }) => Promise<ControlResponse> | ControlResponse
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

type SessionSnapshotStore = {
  version: 1
  snapshots: ControlSessionSnapshot[]
}

export type ControlSocketEventInput = {
  name: string
  category: string
  source?: string
  payload?: Record<string, unknown>
  workspaceId?: string
  surfaceId?: string
}

const eventReplayLimit = 4096
// 超限后批量裁剪，避免每个事件都整段拷贝回放数组。
const eventReplayTrimBatch = 512
// events.jsonl 大小轮转阈值：超过后用内存回放尾部截断重写。
const eventLogMaxBytes = 8 * 1024 * 1024
const eventHeartbeatIntervalMs = 15000
const eventProtocol = 'aiopsterm-events' as const
const maxSessionSnapshots = 20
const maxWaitForNameLength = 128
const maxWaitForSignals = 512
const maxWaitForWaiters = 256
const defaultWaitForTimeoutMs = 30000
const maxWaitForTimeoutMs = 300000

let runtime: ControlSocketStateRuntime = {}
const eventBootId = randomUUID()
let nextEventSeq = 1
let eventLog: ControlEventFrame[] = []
let eventLogStorePath = ''
let eventLogLoadedPath = ''
let eventLogWriteQueue: Promise<void> = Promise.resolve()
// -1 表示尚未探测过磁盘上 events.jsonl 的当前大小。
let eventLogBytes = -1
const eventSubscriptions = new Map<string, ControlEventSubscription>()
let mobileEventSubscriptions = new Map<string, MobileEventSubscription>()
let sessionSnapshotStorePath = ''
let sessionSnapshotLoadedPath = ''
let sessionSnapshots: ControlSessionSnapshot[] = []
let sessionSnapshotWriteQueue: Promise<void> = Promise.resolve()
let waitForSignals = new Map<string, number>()
let waitForWaiters = new Map<string, Set<ControlWaitForWaiter>>()

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

const normalizeWaitForTimeoutMs = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultWaitForTimeoutMs
  return Math.max(1, Math.min(maxWaitForTimeoutMs, Math.round(numberValue)))
}

const normalizeWaitForName = (value: unknown) => {
  const text = cleanText(value)
  if (!text || text.length > maxWaitForNameLength) return ''
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : ''
}

const dispatchRendererControlRequest = (method: string, params: Record<string, unknown> = {}, options: { focus?: boolean } = {}) => {
  if (!runtime.dispatchRendererControlRequest) return Promise.resolve(fail('NO_APP_WINDOW', 'No aiopsterm window is available for this control request.'))
  return runtime.dispatchRendererControlRequest(method, params, options)
}

export const configureControlSocketStateRuntime = (config: ControlSocketStateRuntime = {}) => {
  runtime = { ...runtime, ...config }
  if (config.userDataPath) {
    const nextEventPath = controlSocketEventLogPathFor(config.userDataPath)
    if (eventLogLoadedPath && eventLogLoadedPath !== nextEventPath) eventLogLoadedPath = ''
    if (eventLogStorePath !== nextEventPath) eventLogBytes = -1
    eventLogStorePath = nextEventPath
    const nextSessionPath = controlSocketSessionSnapshotPathFor(config.userDataPath)
    if (sessionSnapshotLoadedPath && sessionSnapshotLoadedPath !== nextSessionPath) sessionSnapshotLoadedPath = ''
    sessionSnapshotStorePath = nextSessionPath
  }
}

export const controlSocketEventLogPathFor = (userDataPath: string) => join(userDataPath, 'control', 'events.jsonl')

export const controlSocketSessionSnapshotPathFor = (userDataPath: string) => join(userDataPath, 'control', 'session-snapshots.json')

export const isControlEventStreamMethod = (method: unknown) => {
  const normalized = cleanText(method)
  return normalized === 'events.stream' || normalized === 'event.stream' || normalized === 'event.subscribe' || normalized === 'events.subscribe'
}

export const isControlEventListMethod = (method: string) => method === 'events.list' || method === 'event.list'

export const isControlMobileEventsMethod = (method: string) => method === 'mobile.events.subscribe' || method === 'mobile.events.unsubscribe'

export const isControlSessionMethod = (method: string) => method.startsWith('session.') || method.startsWith('restore-session.')

export const isControlWaitForMethod = (method: string) => method === 'wait-for' || method === 'wait_for' || method === 'sync.wait_for' || method.startsWith('sync.wait_for.')

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

const boundedPayload = (payload: Record<string, unknown>) => {
  const frameText = JSON.stringify(payload)
  if (Buffer.byteLength(frameText, 'utf8') <= 16_000) return payload
  return {
    payload_truncated: true,
    original_payload_bytes: Buffer.byteLength(frameText, 'utf8')
  }
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

export const loadControlSocketDurableEventLog = async (userDataPath?: string) => {
  if (userDataPath) {
    const nextEventPath = controlSocketEventLogPathFor(userDataPath)
    if (eventLogStorePath !== nextEventPath) eventLogBytes = -1
    eventLogStorePath = nextEventPath
  }
  if (!eventLogStorePath || eventLogLoadedPath === eventLogStorePath) return
  // 先等待在途写入排空，重启加载才能读到完整的审计日志。
  await eventLogWriteQueue.catch(() => undefined)
  eventLogLoadedPath = eventLogStorePath
  eventLog = []
  nextEventSeq = 1
  eventLogBytes = -1
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

// 轮转重写内容：从内存回放尾部倒序取行，字节预算取轮转阈值的一半。
// 只取 seq 不超过当前写入事件的行，后续排队中的事件仍由各自的追加任务落盘。
const rotatedEventLogContent = (maxSeq: number) => {
  const budget = eventLogMaxBytes / 2
  const lines: string[] = []
  let bytes = 0
  for (let index = eventLog.length - 1; index >= 0; index -= 1) {
    if (eventLog[index].seq > maxSeq) continue
    const line = `${JSON.stringify(eventLog[index])}\n`
    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (bytes + lineBytes > budget) break
    lines.push(line)
    bytes += lineBytes
  }
  return lines.reverse().join('')
}

const appendDurableEvent = (event: ControlEventFrame) => {
  if (!eventLogStorePath) return
  const storePath = eventLogStorePath
  const line = `${JSON.stringify(event)}\n`
  eventLogWriteQueue = eventLogWriteQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        if (eventLogBytes < 0) {
          await mkdir(dirname(storePath), { recursive: true })
          try {
            eventLogBytes = (await stat(storePath)).size
          } catch {
            eventLogBytes = 0
          }
        }
        const lineBytes = Buffer.byteLength(line, 'utf8')
        if (eventLogBytes + lineBytes > eventLogMaxBytes) {
          const content = rotatedEventLogContent(event.seq)
          await writeFile(storePath, content, 'utf-8')
          eventLogBytes = Buffer.byteLength(content, 'utf8')
        } else {
          await appendFile(storePath, line, 'utf-8')
          eventLogBytes += lineBytes
        }
      } catch {
        // Event streaming must keep working even if the audit log cannot be written.
      }
    })
}

export const publishControlEvent = (input: ControlSocketEventInput) => {
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
  eventLog.push(event)
  if (eventLog.length > eventReplayLimit + eventReplayTrimBatch) eventLog.splice(0, eventLog.length - eventReplayLimit)
  appendDurableEvent(event)
  for (const subscription of eventSubscriptions.values()) {
    if (eventMatchesFilters(event, subscription.filters)) writeEventFrame(subscription.socket, event)
  }
  return event
}

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
                  trusted_at: Number.isFinite(resumeBinding.trusted_at) ? Number(resumeBinding.trusted_at) : Number.isFinite(resumeBinding.trustedAt) ? Number(resumeBinding.trustedAt) : undefined
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
  const activeCenterSurface = cleanText(record.activeCenterSurface)
  if (!activeCenterSurface) return null
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
    activeCenterSurface,
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

export const loadControlSessionSnapshotStore = async (userDataPath?: string) => {
  if (userDataPath) sessionSnapshotStorePath = controlSocketSessionSnapshotPathFor(userDataPath)
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

const sessionSnapshotFor = (value: unknown) => {
  const id = cleanText(value)
  if (!id || id === 'latest') return sortedSessionSnapshots()[0] || null
  return sessionSnapshots.find((snapshot) => snapshot.id === id || snapshot.name === id) || null
}

export const handleSessionControlRequest = async (method: string, params: Record<string, unknown>) => {
  await loadControlSessionSnapshotStore(runtime.userDataPath)
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

export const listEvents = (params: Record<string, unknown>) => {
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

export const handleMobileEventsControlRequest = (method: string, params: Record<string, unknown>) => {
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

export const startEventStream = (socket: Socket, request: ControlSocketRequest) => {
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

export const handleWaitForControlRequest = async (method: string, params: Record<string, unknown>) => {
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

export const controlSocketStateSummary = () => ({
  eventCount: eventLog.length,
  latestEventSeq: nextEventSeq - 1
})

// 等待审计日志异步写入队列排空（关闭前或测试断言前使用）。
export const flushControlSocketDurableEventLog = () => eventLogWriteQueue.catch(() => undefined)

export const listEventsForTesting = () => eventLog

export const listSessionSnapshotsForTesting = () => sortedSessionSnapshots()

export const eventSubscriptionCountForTesting = () => eventSubscriptions.size

export const mobileEventSubscriptionCountForTesting = () => mobileEventSubscriptions.size

export const listMobileEventSubscriptionsForTesting = () => [...mobileEventSubscriptions.values()].sort((left, right) => left.streamId.localeCompare(right.streamId))

export const closeControlSocketStateRuntime = () => {
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
  eventLog = []
  nextEventSeq = 1
  eventLogLoadedPath = ''
  eventLogStorePath = ''
  // 在途写入让其自然排空保证审计完整，这里只重置大小探测状态。
  eventLogBytes = -1
  sessionSnapshots = []
  sessionSnapshotLoadedPath = ''
  sessionSnapshotStorePath = ''
  sessionSnapshotWriteQueue = Promise.resolve()
}
