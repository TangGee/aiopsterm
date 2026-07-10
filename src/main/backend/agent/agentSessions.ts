import { randomUUID } from 'crypto'
import { createServer, type Server, type Socket } from 'net'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir, stat } from 'fs/promises'
import { platformSocketPath } from '../app/platformRuntime'
import { logRuntimeEvent } from '../app/runtimeLog'
import {
  createAgentSessionEventStreamRuntime,
  type AgentSessionEventStreamListResult
} from './agentSessionEventStreamRuntime'
import { createAgentSessionAuditRuntime, type ManagedAiSessionAuditKind } from './agentSessionAuditRuntime'
import {
  createAgentSessionAutoNamingRuntime,
  type ManagedAiSessionAutoNamingRuntime
} from './agentSessionAutoNamingRuntime'
import {
  createAgentSessionImportRuntime,
  type ImportedAgentSession
} from './agentSessionImportRuntime'
import { createAgentSessionContentRuntime } from './agentSessionContentRuntime'
import { disposeAgentSessionContentWorker } from './agentSessionContentWorkerRuntime'
import { createCodexTranscriptMonitorRuntime } from './agentSessionCodexTranscriptMonitor'
import { createAgentSessionGitRuntime, type ManagedAiSessionGitInfo } from './agentSessionGitRuntime'
import { createAgentSessionStoreRuntime } from './agentSessionStoreRuntime'
import {
  autoTitleFor,
  cleanOptionalText,
  cleanText,
  compactRawValue,
  compactString,
  decisionKinds,
  defaultAgentHibernationConfig,
  firstText,
  isRecord,
  managedAiSessionAllowsResume,
  managedAiSessionStateForEvent,
  nestedRecord,
  normalizeAgentHibernationConfig,
  normalizeAiAgentSessionEventInput,
  normalizeSource,
  normalizeWaitTimeoutMs,
  pendingDecisionKey,
  resumeCommandFor,
  sessionKey,
  sourceLabel,
  normalizeRecordEvent
} from './agentSessionNormalization'
import { createAgentSessionNotificationRuntime } from './agentSessionNotificationRuntime'
import type {
  AiAgentSessionEvent,
  AiAgentSessionEventInput,
  AiAgentSessionEventResult,
  AiAgentSessionSource,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiSessionEvent,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionClearInput,
  ManagedAiSessionDecision,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionHibernateInput,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiNotificationClearResult,
  ManagedAiNotificationDismissInput,
  ManagedAiNotificationListInput,
  ManagedAiNotificationListResult,
  ManagedAiNotificationMarkReadInput,
  ManagedAiNotificationMutationResult,
  ManagedAiNotificationOpenInput,
  ManagedAiSessionRecord,
  ManagedAiSessionRenameInput,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot
} from '@shared/contracts/managedAiSessions'
import type {
  ManagedAiSessionContentDeleteInput,
  ManagedAiSessionContentDeleteResult,
  ManagedAiSessionContentListInput,
  ManagedAiSessionContentListResult,
  ManagedAiSessionContentRecordInput,
  ManagedAiSessionContentRecordResult,
  ManagedAiSessionContentUpdateInput,
  ManagedAiSessionContentUpdateResult
} from '@shared/contracts/managedAiSessionContent'

export { normalizeAiAgentSessionEventInput } from './agentSessionNormalization'
export type { ManagedAiSessionAutoNamingInput, ManagedAiSessionAutoNamingRuntime } from './agentSessionAutoNamingRuntime'

export type { AgentSessionEventStreamCategory, AgentSessionEventStreamFrame, AgentSessionEventStreamListResult } from './agentSessionEventStreamRuntime'

export type AgentSessionEventSink = (event: AiAgentSessionEvent) => void

type AgentSessionSocketResponse = AiAgentSessionEventResult & {
  status?: 'acknowledged' | 'pending' | 'resolved' | 'timeout'
  agentOutput?: Record<string, unknown>
}

type PendingAgentDecision = {
  source: AiAgentSessionSource
  sessionId: string
  requestId: string
  event: AiAgentSessionEvent
  raw: Record<string, unknown>
  timer: NodeJS.Timeout
  resolve: (response: AgentSessionSocketResponse) => void
}

type AgentSessionSocketRuntime = {
  userDataPath: string
  emit: AgentSessionEventSink
}

const storeVersion = 1
const maxEventsPerSession = 200
const maxDecisionsPerSession = 40

let server: Server | null = null
let socketPath = ''
let eventSink: AgentSessionEventSink | null = null
let sessions = new Map<string, ManagedAiSessionRecord>()
let agentHibernationConfig: AgentHibernationConfig = { ...defaultAgentHibernationConfig }
let pendingDecisions = new Map<string, PendingAgentDecision>()
let emitManagedAiSessionEvent: (event: ManagedAiSessionEvent) => void = () => undefined
let isManagedAiTerminalSessionLive: ((sessionId: string) => boolean) | null = null

export const configureManagedAiSessionTerminalLiveness = (resolver?: (sessionId: string) => boolean) => {
  isManagedAiTerminalSessionLive = resolver || null
}

const agentSessionEventStreamRuntime = createAgentSessionEventStreamRuntime({
  compactRawValue,
  cleanText,
  cleanOptionalText,
  emitManagedAiSessionEvent: (event) => emitManagedAiSessionEvent(event)
})

const publishAgentEventStreamFrame = agentSessionEventStreamRuntime.publishAgentEventStreamFrame
const publishManagedAiStreamFrame = agentSessionEventStreamRuntime.publishManagedAiStreamFrame
const auditRuntime = createAgentSessionAuditRuntime({ compactString })
const appendManagedAiSessionAudit = auditRuntime.appendManagedAiSessionAudit
const storeRuntime = createAgentSessionStoreRuntime({
  storeVersion,
  getSnapshot: () => snapshot(),
  getAgentHibernationConfig: () => agentHibernationConfig,
  applyLoadedStore: (loaded) => {
    sessions = loaded.sessions
    agentHibernationConfig = loaded.agentHibernationConfig
  }
})
const importRuntime = createAgentSessionImportRuntime()
const gitRuntime = createAgentSessionGitRuntime()
const autoNamingRuntime = createAgentSessionAutoNamingRuntime({
  getSession: (key) => sessions.get(key),
  setSession: (key, session) => {
    sessions.set(key, session)
  },
  persistSnapshot: () => persistSnapshot(),
  appendManagedAiSessionAudit,
  publishManagedAiStreamFrame
})
const codexTranscriptMonitorRuntime = createCodexTranscriptMonitorRuntime({
  publishEvent: (event) => {
    publishAiAgentSessionEvent(event, eventSink)
  }
})

const notificationRuntime = createAgentSessionNotificationRuntime({
  loadStoreIfNeeded: () => loadStoreIfNeeded(),
  getSnapshot: () => snapshot(),
  getSession: (source, sessionId) => sessions.get(sessionKey(source, sessionId)) || null,
  getSessions: () => [...sessions.values()],
  deleteSession: (source, sessionId) => sessions.delete(sessionKey(source, sessionId)),
  persistSnapshot: () => persistSnapshot(),
  replyManagedAiSession: (input) => replyManagedAiSession(input),
  bulkManagedAiSessions: (input) => bulkManagedAiSessions(input),
  appendManagedAiSessionAudit,
  publishManagedAiStreamFrame
})
emitManagedAiSessionEvent = autoNamingRuntime.emitManagedAiSessionEvent

export const configureManagedAiSessionAutoNamingRuntime = (config?: ManagedAiSessionAutoNamingRuntime) => {
  autoNamingRuntime.configure(config)
}

export const listManagedAiSessionEvents = (input: Record<string, unknown> = {}): AgentSessionEventStreamListResult =>
  agentSessionEventStreamRuntime.listManagedAiSessionEvents(input)

const auditPathFor = (userDataPath: string) => join(userDataPath, 'agent-sessions', 'managed-ai-sessions.audit.jsonl')

const auditEventReceived = (event: AiAgentSessionEvent, session: ManagedAiSessionRecord) => {
  appendManagedAiSessionAudit({
    at: event.receivedAt,
    kind: 'event.received',
    source: event.source,
    sessionId: event.sessionId,
    event: event.event,
    state: session.state,
    title: session.title,
    summary: event.summary,
    requestId: event.requestId,
    requestKind: event.requestKind,
    decisionMode: event.decisionMode,
    waitTimeoutMs: event.waitTimeoutMs,
    toolName: event.toolName,
    actionable: event.actionable
  })
}

const auditSocketCompleted = (event: AiAgentSessionEvent, response: AgentSessionSocketResponse) => {
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'event.socket.completed',
    source: event.source,
    sessionId: event.sessionId,
    event: event.event,
    title: event.title,
    summary: event.summary,
    requestId: event.requestId,
    requestKind: event.requestKind,
    decisionMode: event.decisionMode,
    waitTimeoutMs: event.waitTimeoutMs,
    toolName: event.toolName,
    actionable: event.actionable,
    status: response.status,
    errorCode: response.ok ? undefined : response.errorCode
  })
}

const auditDecisionCreated = (session: ManagedAiSessionRecord, decision: ManagedAiSessionDecision, kind: ManagedAiSessionAuditKind = 'decision.created') => {
  appendManagedAiSessionAudit({
    at: decision.createdAt,
    kind,
    source: session.source,
    sessionId: session.id,
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary,
    requestId: session.pendingRequestId,
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    waitTimeoutMs: session.waitTimeoutMs,
    toolName: session.toolName,
    decisionKind: decision.kind,
    decisionId: decision.id
  })
}

const snapshot = (): ManagedAiSessionSnapshot => ({
  sessions: [...sessions.values()]
    .sort((first, second) => second.lastActivityAt - first.lastActivityAt)
    .map((session) => ({
      ...session,
      events: [...session.events],
      decisions: [...session.decisions]
    }))
})

const loadStoreIfNeeded = storeRuntime.loadStoreIfNeeded
const storePathFor = storeRuntime.storePathFor
const contentRuntime = createAgentSessionContentRuntime({
  loadStoreIfNeeded: () => loadStoreIfNeeded(),
  getSession: (source, sessionId) => sessions.get(sessionKey(source, sessionId)) || null,
  getUserDataPath: () => storeUserDataPath,
  getHomeDir: () => process.env.HOME || process.env.USERPROFILE || '',
  getEnv: () => process.env,
  now: () => Date.now()
})

// 内存 sessions 为权威数据；hook 事件高频触发时按去抖窗口合并整库落盘，进程退出时同步兜底一次。
const persistDebounceMs = 400
let persistTimer: NodeJS.Timeout | null = null
let persistDirty = false
let storeUserDataPath = ''

const persistSnapshotOnExit = () => {
  if (!persistDirty || !storeUserDataPath) return
  persistDirty = false
  try {
    const storePath = storePathFor(storeUserDataPath)
    const payload = {
      version: storeVersion,
      agentHibernation: agentHibernationConfig,
      ...snapshot()
    }
    mkdirSync(dirname(storePath), { recursive: true })
    const tempPath = `${storePath}.${process.pid}.exit.tmp`
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    renameSync(tempPath, storePath)
  } catch {
    /* 退出兜底写盘失败时已无恢复手段，保持静默。 */
  }
}

const flushPersistSnapshotNow = () => {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (!persistDirty) return
  persistDirty = false
  process.removeListener('exit', persistSnapshotOnExit)
  storeRuntime.persistSnapshot()
}

const persistSnapshot = () => {
  if (!persistDirty) {
    persistDirty = true
    process.once('exit', persistSnapshotOnExit)
  }
  if (persistTimer) return
  persistTimer = setTimeout(flushPersistSnapshotNow, persistDebounceMs)
  persistTimer.unref()
}

export const configureAiAgentSessionStore = async (userDataPath: string) => {
  importScanGeneration += 1
  gitRefreshGeneration += 1
  cancelScheduledImportScan()
  cancelScheduledGitRefresh()
  lastImportScanCompletedAt = 0
  lastGitRefreshCompletedAt = 0
  flushPersistSnapshotNow()
  storeUserDataPath = userDataPath
  codexTranscriptMonitorRuntime.reset()
  auditRuntime.configure(auditPathFor(userDataPath))
  importRuntime.configure({
    enabled: process.env.NODE_ENV !== 'test' && process.env.AIOPSTERM_AGENT_SESSION_IMPORT_DISABLED !== '1'
  })
  await storeRuntime.configure(userDataPath)
}

export const configureManagedAiSessionImportRuntime = (config?: Parameters<typeof importRuntime.configure>[0]) => {
  importScanGeneration += 1
  cancelScheduledImportScan()
  lastImportScanCompletedAt = 0
  importRuntime.configure(config)
}

export const configureManagedAiSessionGitRuntime = (config?: Parameters<typeof gitRuntime.configure>[0]) => {
  gitRefreshGeneration += 1
  cancelScheduledGitRefresh()
  gitRuntime.configure(config)
  gitInfoCacheByCwd.clear()
  lastGitRefreshCompletedAt = 0
}

const withGitInfo = <T extends ManagedAiSessionRecord | ImportedAgentSession>(session: T, gitInfo: ManagedAiSessionGitInfo): T => {
  if (!gitInfo.gitStatusUpdatedAt && !gitInfo.gitBranch) return session
  return {
    ...session,
    gitBranch: gitInfo.gitBranch,
    gitDirty: gitInfo.gitBranch && typeof gitInfo.gitDirty === 'boolean' ? gitInfo.gitDirty : undefined,
    ...(gitInfo.gitStatusUpdatedAt ? { gitStatusUpdatedAt: gitInfo.gitStatusUpdatedAt } : {})
  }
}

// git 探测结果按 (repoPath, HEAD mtime) 缓存：HEAD 未变化时直接复用，跳过 git 子进程。
type GitInfoCacheEntry = { headMtimeMs: number; info: ManagedAiSessionGitInfo }
const gitInfoCacheByCwd = new Map<string, GitInfoCacheEntry>()

const gitHeadMtimeFor = async (cwd: string) => {
  try {
    return (await stat(join(cwd, '.git', 'HEAD'))).mtimeMs
  } catch {
    return null
  }
}

const gitInfoForCwdCached = async (cwd: string): Promise<ManagedAiSessionGitInfo> => {
  const headMtimeMs = await gitHeadMtimeFor(cwd)
  if (headMtimeMs === null) return gitRuntime.gitInfoForCwd(cwd)
  const cached = gitInfoCacheByCwd.get(cwd)
  if (cached && cached.headMtimeMs === headMtimeMs) return cached.info
  const info = await gitRuntime.gitInfoForCwd(cwd)
  if (info.gitBranch) gitInfoCacheByCwd.set(cwd, { headMtimeMs, info })
  return info
}

const backgroundRefreshCooldownMs = 30_000
let lastImportScanCompletedAt = 0
let lastGitRefreshCompletedAt = 0

const refreshGitInfoForSessions = async (generation = gitRefreshGeneration) => {
  const targetsByCwd = new Map<string, string[]>()
  for (const session of sessions.values()) {
    const cwd = session.canonicalCwd || session.cwd || ''
    if (!cwd) continue
    const key = sessionKey(session.source, session.id)
    const keys = targetsByCwd.get(cwd) || []
    if (!keys.includes(key)) keys.push(key)
    targetsByCwd.set(cwd, keys)
  }
  if (!targetsByCwd.size) return 0
  const updates = await Promise.all(
    [...targetsByCwd.entries()].map(async ([cwd, keys]) => ({
      cwd,
      keys,
      gitInfo: await gitInfoForCwdCached(cwd)
    }))
  )
  if (generation !== gitRefreshGeneration) return 0
  let changed = 0
  updates.forEach(({ cwd, keys, gitInfo }) => {
    if (!gitInfo.gitBranch && typeof gitInfo.gitDirty !== 'boolean') return
    for (const key of keys) {
      const session = sessions.get(key)
      if (!session || (session.canonicalCwd || session.cwd || '') !== cwd) continue
      const next = withGitInfo(session, gitInfo)
      const metadataChanged = next.gitBranch !== session.gitBranch || next.gitDirty !== session.gitDirty
      const timestampInitialized = !session.gitStatusUpdatedAt && Boolean(next.gitStatusUpdatedAt)
      if (!metadataChanged && !timestampInitialized) {
        continue
      }
      sessions.set(key, next)
      changed += 1
    }
  })
  if (changed) {
    persistSnapshot()
    appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'sessions.git_refreshed',
      changed
    })
    publishManagedAiStreamFrame('managed_ai.sessions.git_refreshed', null, { changed })
  }
  return changed
}

const upsertSessionForEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) => {
  const key = sessionKey(event.source, event.sessionId)
  const existing = sessions.get(key)
  const timelineEvent = normalizeRecordEvent(event, raw)
  if (existing) {
    const duplicateTimelineEvent = existing.events.some((item) => item.id === timelineEvent.id)
    const staleEvent = event.receivedAt < existing.lastActivityAt ||
      (existing.state === 'ended' && event.event !== 'session_end' && event.receivedAt === existing.lastActivityAt)
    const redundantSessionEnd = existing.state === 'ended' && event.event === 'session_end'
    if (duplicateTimelineEvent || staleEvent || redundantSessionEnd) {
      return { record: existing, applied: false }
    }
  }
  const state = managedAiSessionStateForEvent(event.event, existing?.state, event.agentLifecycle, event)
  const nextAutoTitle = event.event === 'stop' ? autoTitleFor(event, existing) : existing?.autoTitle
  const title = existing?.userTitle || nextAutoTitle || event.title || existing?.title || sourceLabel(event.source)
  const handledAt = state === 'needsInput' ? undefined : existing?.handledAt
  const pendingRequestId = state === 'needsInput' && event.actionable && event.requestId ? event.requestId : undefined
  const requestKind = event.requestKind || existing?.requestKind || 'telemetry'
  const decisionMode = event.decisionMode || existing?.decisionMode || 'telemetry'
  const waitTimeoutMs = event.waitTimeoutMs || existing?.waitTimeoutMs
  const toolName = event.toolName || existing?.toolName
  const cwd = event.cwd || existing?.cwd
  const canonicalCwd = event.canonicalCwd || existing?.canonicalCwd
  const gitBranch = event.gitBranch || existing?.gitBranch
  const gitDirty = typeof event.gitDirty === 'boolean' ? event.gitDirty : existing?.gitDirty
  const gitStatusUpdatedAt = event.gitStatusUpdatedAt || existing?.gitStatusUpdatedAt
  const launchCommand = event.launchCommand || existing?.launchCommand
  const sessionKind = event.sessionKind || existing?.sessionKind
  const parentSessionId = event.parentSessionId || existing?.parentSessionId
  const restorable = event.restorable === false || existing?.restorable === false || sessionKind === 'subagent' || sessionKind === 'internal'
    ? false
    : event.restorable ?? existing?.restorable
  const allowResume = managedAiSessionAllowsResume({ sessionKind, restorable })
  const resumeCommand = allowResume
    ? event.resumeCommand && event.cwd
      ? event.resumeCommand
      : existing?.resumeCommand || resumeCommandFor(event.source, event.sessionId, cwd, launchCommand)
    : undefined
  const processId = event.processId || existing?.processId
  const parentProcessId = event.parentProcessId || existing?.parentProcessId
  const processGroupId = event.processGroupId || existing?.processGroupId
  const agentLifecycle = event.agentLifecycle || existing?.agentLifecycle
  const preserveHibernation = existing?.hibernated === true && event.event !== 'session_start'
  const record: ManagedAiSessionRecord = {
    id: event.sessionId,
    source: event.source,
    title,
    summary: event.summary || existing?.summary || '',
    state,
    lastEvent: event.event,
    lastActivityAt: event.receivedAt,
    createdAt: existing?.createdAt || event.receivedAt,
    updatedAt: Date.now(),
    ...(handledAt ? { handledAt } : {}),
    ...(nextAutoTitle ? { autoTitle: nextAutoTitle } : existing?.autoTitle ? { autoTitle: existing.autoTitle } : {}),
    ...(existing?.userTitle ? { userTitle: existing.userTitle } : {}),
    ...(existing?.autoTitleEventCount ? { autoTitleEventCount: existing.autoTitleEventCount } : {}),
    ...(existing?.autoTitleAttemptedAt ? { autoTitleAttemptedAt: existing.autoTitleAttemptedAt } : {}),
    ...(existing?.autoTitleGeneratedAt ? { autoTitleGeneratedAt: existing.autoTitleGeneratedAt } : {}),
    ...(event.panelId || existing?.panelId ? { panelId: event.panelId || existing?.panelId } : {}),
    ...(event.terminalSessionId || existing?.terminalSessionId ? { terminalSessionId: event.terminalSessionId || existing?.terminalSessionId } : {}),
    ...(event.workspaceId || existing?.workspaceId ? { workspaceId: event.workspaceId || existing?.workspaceId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(canonicalCwd ? { canonicalCwd } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    ...(typeof gitDirty === 'boolean' ? { gitDirty } : {}),
    ...(gitStatusUpdatedAt ? { gitStatusUpdatedAt } : {}),
    ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
    ...(pendingRequestId ? { pendingRequestId } : {}),
    requestKind,
    decisionMode,
    ...(waitTimeoutMs ? { waitTimeoutMs } : {}),
    ...(toolName ? { toolName } : {}),
    ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(sessionKind ? { sessionKind } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(typeof restorable === 'boolean' ? { restorable } : {}),
    ...(processId ? { processId } : {}),
    ...(parentProcessId ? { parentProcessId } : {}),
    ...(processGroupId ? { processGroupId } : {}),
    ...(agentLifecycle ? { agentLifecycle } : {}),
    ...(preserveHibernation ? { hibernated: true } : {}),
    ...(preserveHibernation && existing?.hibernatedAt ? { hibernatedAt: existing.hibernatedAt } : {}),
    ...(preserveHibernation && existing?.hibernationReason ? { hibernationReason: existing.hibernationReason } : {}),
    ...(preserveHibernation && existing?.hibernatedTerminalSessionId ? { hibernatedTerminalSessionId: existing.hibernatedTerminalSessionId } : {}),
    events: [...(existing?.events || []), timelineEvent].slice(-maxEventsPerSession),
    decisions: [...(existing?.decisions || [])].slice(-maxDecisionsPerSession)
  }
  sessions.set(key, record)
  const ordered = [...sessions.values()].sort((first, second) => second.lastActivityAt - first.lastActivityAt)
  sessions = new Map(ordered.map((session) => [sessionKey(session.source, session.id), session]))
  persistSnapshot()
  auditEventReceived(event, record)
  publishAgentEventStreamFrame(event, record)
  autoNamingRuntime.maybeRunAutoNaming(record, event)
  return { record, applied: true }
}

const mergeImportedSession = (imported: ImportedAgentSession) => {
  const key = sessionKey(imported.source, imported.id)
  const existing = sessions.get(key)
  if (!existing) {
    sessions.set(key, {
      ...imported,
      decisions: []
    })
    return true
  }
  const importedEvent = imported.events[0]
  const hasImportedEvent = importedEvent
    ? existing.events.some((event) => event.id === importedEvent.id)
    : true
  const preserveLiveState = existing.state === 'needsInput' || existing.state === 'working'
  const sessionKind = imported.sessionKind || existing.sessionKind
  const parentSessionId = imported.parentSessionId || existing.parentSessionId
  const restorable = imported.restorable === false || existing.restorable === false || sessionKind === 'subagent' || sessionKind === 'internal'
    ? false
    : imported.restorable ?? existing.restorable
  const allowResume = managedAiSessionAllowsResume({ sessionKind, restorable })
  const resumeCommand = allowResume
    ? imported.resumeCommand && imported.cwd && existing.resumeCommand && !existing.resumeCommand.includes('cd ')
      ? imported.resumeCommand
      : existing.resumeCommand || imported.resumeCommand
    : undefined
  const events = hasImportedEvent ? existing.events : [...existing.events, importedEvent].filter(Boolean).slice(-maxEventsPerSession)
  const next: ManagedAiSessionRecord = {
    ...existing,
    title: existing.userTitle || existing.title || imported.title,
    summary: existing.summary || imported.summary,
    state: preserveLiveState ? existing.state : existing.state === 'ended' ? existing.state : imported.state,
    lastEvent: preserveLiveState || existing.lastActivityAt >= imported.lastActivityAt ? existing.lastEvent : imported.lastEvent,
    lastActivityAt: Math.max(existing.lastActivityAt, imported.lastActivityAt),
    createdAt: Math.min(existing.createdAt, imported.createdAt),
    updatedAt: existing.updatedAt,
    ...(existing.cwd || imported.cwd ? { cwd: existing.cwd || imported.cwd } : {}),
    ...(existing.canonicalCwd || imported.canonicalCwd ? { canonicalCwd: existing.canonicalCwd || imported.canonicalCwd } : {}),
    ...(existing.gitBranch || imported.gitBranch ? { gitBranch: existing.gitBranch || imported.gitBranch } : {}),
    ...(typeof existing.gitDirty === 'boolean' || typeof imported.gitDirty === 'boolean'
      ? { gitDirty: typeof existing.gitDirty === 'boolean' ? existing.gitDirty : imported.gitDirty }
      : {}),
    ...(existing.gitStatusUpdatedAt || imported.gitStatusUpdatedAt ? { gitStatusUpdatedAt: existing.gitStatusUpdatedAt || imported.gitStatusUpdatedAt } : {}),
    ...(existing.transcriptPath || imported.transcriptPath ? { transcriptPath: existing.transcriptPath || imported.transcriptPath } : {}),
    requestKind: existing.requestKind || imported.requestKind,
    decisionMode: existing.decisionMode || imported.decisionMode,
    ...(existing.launchCommand || imported.launchCommand ? { launchCommand: existing.launchCommand || imported.launchCommand } : {}),
    resumeCommand,
    ...(sessionKind ? { sessionKind } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(typeof restorable === 'boolean' ? { restorable } : {}),
    agentLifecycle: preserveLiveState ? existing.agentLifecycle : existing.agentLifecycle || imported.agentLifecycle,
    events,
    decisions: existing.decisions
  }
  const changed =
    next.title !== existing.title ||
    next.summary !== existing.summary ||
    next.state !== existing.state ||
    next.lastEvent !== existing.lastEvent ||
    next.lastActivityAt !== existing.lastActivityAt ||
    next.createdAt !== existing.createdAt ||
    next.cwd !== existing.cwd ||
    next.canonicalCwd !== existing.canonicalCwd ||
    next.gitBranch !== existing.gitBranch ||
    next.gitDirty !== existing.gitDirty ||
    next.gitStatusUpdatedAt !== existing.gitStatusUpdatedAt ||
    next.transcriptPath !== existing.transcriptPath ||
    next.requestKind !== existing.requestKind ||
    next.decisionMode !== existing.decisionMode ||
    next.launchCommand !== existing.launchCommand ||
    next.resumeCommand !== existing.resumeCommand ||
    next.sessionKind !== existing.sessionKind ||
    next.parentSessionId !== existing.parentSessionId ||
    next.restorable !== existing.restorable ||
    next.agentLifecycle !== existing.agentLifecycle ||
    next.events !== existing.events
  if (!changed) return false
  sessions.set(key, {
    ...next,
    updatedAt: Date.now()
  })
  return true
}

const importExternalManagedAiSessions = async (generation = importScanGeneration) => {
  let imported: ImportedAgentSession[]
  try {
    imported = await importRuntime.importSessions()
  } catch {
    return 0
  }
  if (generation !== importScanGeneration) return 0
  let changed = 0
  for (const session of imported) {
    if (mergeImportedSession(session)) changed += 1
  }
  if (!changed) return 0
  const ordered = [...sessions.values()].sort((first, second) => second.lastActivityAt - first.lastActivityAt)
  sessions = new Map(ordered.map((session) => [sessionKey(session.source, session.id), session]))
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'sessions.imported',
    changed
  })
  publishManagedAiStreamFrame('managed_ai.sessions.imported', null, { changed })
  return changed
}

// 并发 list 只触发一次导入扫描，后续调用复用同一个在途 Promise。
let importScanInFlight: Promise<number> | null = null
let importScanInFlightGeneration = 0
let scheduledImportScan: Promise<number> | null = null
let scheduledImportScanTimer: NodeJS.Timeout | null = null
let scheduledImportScanResolve: ((changed: number) => void) | null = null
let importScanGeneration = 0

const importExternalManagedAiSessionsOnce = (generation = importScanGeneration) => {
  if (importScanInFlight && importScanInFlightGeneration === generation) return importScanInFlight
  const scan = importExternalManagedAiSessions(generation).catch(() => 0)
  importScanInFlight = scan
  importScanInFlightGeneration = generation
  scan.finally(() => {
    if (generation === importScanGeneration) lastImportScanCompletedAt = Date.now()
    if (importScanInFlight === scan) importScanInFlight = null
  })
  return importScanInFlight
}

const scheduleImportExternalManagedAiSessions = () => {
  if (importScanInFlight && importScanInFlightGeneration === importScanGeneration) return importScanInFlight
  if (scheduledImportScan) return scheduledImportScan
  if (lastImportScanCompletedAt && Date.now() - lastImportScanCompletedAt < backgroundRefreshCooldownMs) return Promise.resolve(0)
  const generation = importScanGeneration
  scheduledImportScan = new Promise<number>((resolve) => {
    scheduledImportScanResolve = resolve
    scheduledImportScanTimer = setTimeout(() => {
      scheduledImportScanTimer = null
      scheduledImportScanResolve = null
      importExternalManagedAiSessionsOnce(generation)
        .then(resolve)
        .catch(() => resolve(0))
        .finally(() => {
          scheduledImportScan = null
        })
    }, 0)
    scheduledImportScanTimer.unref()
  })
  return scheduledImportScan
}

const cancelScheduledImportScan = () => {
  if (scheduledImportScanTimer) {
    clearTimeout(scheduledImportScanTimer)
    scheduledImportScanTimer = null
  }
  scheduledImportScanResolve?.(0)
  scheduledImportScanResolve = null
  scheduledImportScan = null
}

const flushScheduledImportScan = async () => {
  const pending = scheduledImportScan || importScanInFlight
  return pending ? pending.catch(() => 0) : 0
}

// git metadata can be slow in very large repositories. Keep it off the list path and collapse concurrent refreshes.
let gitRefreshInFlight: Promise<number> | null = null
let gitRefreshInFlightGeneration = 0
let scheduledGitRefresh: Promise<number> | null = null
let scheduledGitRefreshTimer: NodeJS.Timeout | null = null
let scheduledGitRefreshResolve: ((changed: number) => void) | null = null
let gitRefreshGeneration = 0

const refreshGitInfoForSessionsOnce = (generation = gitRefreshGeneration) => {
  if (gitRefreshInFlight && gitRefreshInFlightGeneration === generation) return gitRefreshInFlight
  const refresh = refreshGitInfoForSessions(generation).catch(() => 0)
  gitRefreshInFlight = refresh
  gitRefreshInFlightGeneration = generation
  refresh.finally(() => {
    if (generation === gitRefreshGeneration) lastGitRefreshCompletedAt = Date.now()
    if (gitRefreshInFlight === refresh) gitRefreshInFlight = null
  })
  return gitRefreshInFlight
}

const scheduleRefreshGitInfoForSessions = () => {
  if (gitRefreshInFlight && gitRefreshInFlightGeneration === gitRefreshGeneration) return gitRefreshInFlight
  if (scheduledGitRefresh) return scheduledGitRefresh
  if (lastGitRefreshCompletedAt && Date.now() - lastGitRefreshCompletedAt < backgroundRefreshCooldownMs) return Promise.resolve(0)
  const generation = gitRefreshGeneration
  scheduledGitRefresh = new Promise<number>((resolve) => {
    scheduledGitRefreshResolve = resolve
    scheduledGitRefreshTimer = setTimeout(() => {
      scheduledGitRefreshTimer = null
      scheduledGitRefreshResolve = null
      refreshGitInfoForSessionsOnce(generation)
        .then(resolve)
        .catch(() => resolve(0))
        .finally(() => {
          scheduledGitRefresh = null
        })
    }, 0)
    scheduledGitRefreshTimer.unref()
  })
  return scheduledGitRefresh
}

const cancelScheduledGitRefresh = () => {
  if (scheduledGitRefreshTimer) {
    clearTimeout(scheduledGitRefreshTimer)
    scheduledGitRefreshTimer = null
  }
  scheduledGitRefreshResolve?.(0)
  scheduledGitRefreshResolve = null
  scheduledGitRefresh = null
}

const flushScheduledGitRefresh = async () => {
  const pending = scheduledGitRefresh || gitRefreshInFlight
  return pending ? pending.catch(() => 0) : 0
}

export function publishAiAgentSessionEvent(input: AiAgentSessionEventInput, emit: AgentSessionEventSink | null = eventSink) {
  const result = normalizeAiAgentSessionEventInput(input)
  if (!result.ok || !result.data) return result
  const raw = input as Record<string, unknown>
  const upsert = upsertSessionForEvent(result.data, raw)
  if (upsert.applied) {
    emit?.(result.data)
    updateCodexTranscriptMonitor(result.data, raw)
  }
  return result
}

const reconcileManagedAiSessionsWithLiveTerminals = () => {
  const isTerminalSessionLive = isManagedAiTerminalSessionLive
  if (!isTerminalSessionLive) return 0
  const staleSessions = [...sessions.values()].filter((session) =>
    (session.state === 'working' || session.state === 'needsInput') &&
    Boolean(session.terminalSessionId) &&
    !isTerminalSessionLive(session.terminalSessionId || '')
  )
  staleSessions.forEach((session) => {
    publishAiAgentSessionEvent(
      {
        source: session.source,
        event: 'session_end',
        sessionId: session.id,
        title: session.title,
        summary: 'Terminal no longer exists',
        receivedAt: Math.max(Date.now(), session.lastActivityAt + 1),
        agentLifecycle: 'ended',
        ...(session.panelId ? { panelId: session.panelId } : {}),
        ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
        ...(session.sessionKind ? { sessionKind: session.sessionKind } : {}),
        ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
        ...(typeof session.restorable === 'boolean' ? { restorable: session.restorable } : {})
      },
      eventSink
    )
  })
  if (staleSessions.length) {
    logRuntimeEvent('info', 'managed_ai.sessions.terminal-reconciled', {
      changed: staleSessions.length,
      sessions: staleSessions.map((session) => `${session.source}:${session.id}`)
    })
  }
  return staleSessions.length
}

function updateCodexTranscriptMonitor(event: AiAgentSessionEvent, raw: Record<string, unknown>) {
  if (event.source !== 'codex') return
  const turnId = cleanOptionalText(raw.turnId || raw.turn_id)
  if (event.event === 'prompt_submit') {
    codexTranscriptMonitorRuntime.start({ event, raw })
    return
  }
  if (event.event === 'stop' || event.event === 'session_end') {
    codexTranscriptMonitorRuntime.stop(event.sessionId, turnId)
  }
}

const isBlockingAgentEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) =>
  event.source === 'claude-code' &&
  (event.requestKind === 'permission' || event.requestKind === 'question' || event.requestKind === 'plan') &&
  event.decisionMode === 'blocking' &&
  event.actionable === true &&
  Boolean(event.requestId || cleanOptionalText(raw.requestId || raw.request_id || raw.tool_use_id))

const questionAnswersFromMessage = (raw: Record<string, unknown>, message?: string) => {
  const text = cleanText(message)
  if (!text) return {}
  const toolInput = nestedRecord(raw, 'tool_input')
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const answers: Record<string, string> = {}
  ;(lines.length ? lines : [text]).forEach((answer, index) => {
    const question = questions[index] && typeof questions[index] === 'object' && !Array.isArray(questions[index]) ? (questions[index] as Record<string, unknown>) : null
    const key = firstText(question || {}, ['question', 'header', 'prompt']) || `Answer ${index + 1}`
    answers[key] = answer
  })
  return answers
}

const renderClaudeHookOutput = (session: ManagedAiSessionRecord, decision: ManagedAiSessionDecision, pending?: PendingAgentDecision) => {
  const latest = session.events.slice().reverse().find((event) => event.requestId === session.pendingRequestId) || session.events.at(-1)
  const raw = pending?.raw || latest?.raw || {}
  const hookDecision = (behavior: 'allow' | 'deny', options: { message?: string; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] } = {}) => {
    const inner: Record<string, unknown> = { behavior }
    if (behavior === 'deny') inner.message = cleanOptionalText(options.message) || 'User denied permission via aiopsterm.'
    if (options.updatedInput && Object.keys(options.updatedInput).length) inner.updatedInput = options.updatedInput
    if (options.updatedPermissions && options.updatedPermissions.length) inner.updatedPermissions = options.updatedPermissions
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: inner
      }
    }
  }

  if (decision.kind === 'handled') return {}
  if (decision.kind === 'deny') return hookDecision('deny', { message: decision.message })
  if (pending?.event.event === 'question' || session.lastEvent === 'question' || latest?.event === 'question') {
    const toolInput = nestedRecord(raw, 'tool_input')
    const updatedInput = {
      ...toolInput,
      answers: questionAnswersFromMessage(raw, decision.message)
    }
    return hookDecision('allow', { updatedInput })
  }

  const permissionSuggestions = Array.isArray(raw.permission_suggestions) ? raw.permission_suggestions : []
  if (decision.kind === 'always') return hookDecision('allow', { updatedPermissions: permissionSuggestions })
  if (decision.kind === 'bypass') {
    return hookDecision('allow', {
      updatedPermissions: [
        {
          type: 'setMode',
          mode: 'bypassPermissions',
          destination: 'session'
        }
      ]
    })
  }
  return hookDecision('allow')
}

const resolvePendingDecision = (session: ManagedAiSessionRecord, decision: ManagedAiSessionDecision) => {
  const requestId = session.pendingRequestId
  if (!requestId) return
  const key = pendingDecisionKey(session.source, session.id, requestId)
  const pending = pendingDecisions.get(key)
  if (!pending) return
  pendingDecisions.delete(key)
  clearTimeout(pending.timer)
  auditDecisionCreated(session, decision, 'decision.resolved')
  pending.resolve({
    ok: true,
    data: session.events.at(-1),
    status: 'resolved',
    agentOutput: session.source === 'claude-code' ? renderClaudeHookOutput(session, decision, pending) : {}
  })
}

const waitForAgentDecision = (event: AiAgentSessionEvent, raw: Record<string, unknown>) =>
  new Promise<AgentSessionSocketResponse>((resolve) => {
    const requestId = event.requestId || cleanOptionalText(raw.requestId || raw.request_id || raw.tool_use_id)
    if (!requestId) {
      resolve({ ok: true, data: event, status: 'acknowledged' })
      return
    }
    const key = pendingDecisionKey(event.source, event.sessionId, requestId)
    const timeoutMs = event.waitTimeoutMs || normalizeWaitTimeoutMs(raw.waitTimeoutMs || raw.wait_timeout_ms)
    const timer = setTimeout(() => {
      pendingDecisions.delete(key)
      appendManagedAiSessionAudit({
        at: Date.now(),
        kind: 'decision.timeout',
        source: event.source,
        sessionId: event.sessionId,
        event: event.event,
        title: event.title,
        summary: event.summary,
        requestId,
        requestKind: event.requestKind,
        decisionMode: event.decisionMode,
        waitTimeoutMs: timeoutMs,
        toolName: event.toolName
      })
      resolve({ ok: true, data: event, status: 'timeout', agentOutput: {} })
    }, timeoutMs)
    pendingDecisions.set(key, {
      source: event.source,
      sessionId: event.sessionId,
      requestId,
      event,
      raw,
      timer,
      resolve
    })
  })

const publishAiAgentSessionSocketEvent = async (input: AiAgentSessionEventInput, emit: AgentSessionEventSink | null): Promise<AgentSessionSocketResponse> => {
  const result = normalizeAiAgentSessionEventInput(input)
  if (!result.ok || !result.data) return result
  const raw = input as Record<string, unknown>
  const upsert = upsertSessionForEvent(result.data, raw)
  if (!upsert.applied) {
    const response: AgentSessionSocketResponse = { ...result, status: 'acknowledged' }
    auditSocketCompleted(result.data, response)
    return response
  }
  const waiter = isBlockingAgentEvent(result.data, raw) ? waitForAgentDecision(result.data, raw) : null
  emit?.(result.data)
  updateCodexTranscriptMonitor(result.data, raw)
  if (!waiter) {
    const response: AgentSessionSocketResponse = { ...result, status: 'acknowledged' }
    auditSocketCompleted(result.data, response)
    return response
  }
  const response = await waiter
  auditSocketCompleted(result.data, response)
  return response
}

export const listManagedAiSessions = async (): Promise<ManagedAiSessionListResult> => {
  await loadStoreIfNeeded()
  reconcileManagedAiSessionsWithLiveTerminals()
  // 本地历史导入和 git 探测都可能碰到大量文件/慢仓库。列表先返回快照，后台变更再发事件驱动前端刷新。
  scheduleImportExternalManagedAiSessions()
  scheduleRefreshGitInfoForSessions()
  return { ok: true, data: snapshot() }
}

const prepareManagedAiContentAccess = async (input: Pick<ManagedAiSessionContentListInput, 'source' | 'sessionId'>) => {
  await loadStoreIfNeeded()
  const source = normalizeSource(input?.source)
  const sessionId = cleanOptionalText(input?.sessionId)
  const existedBeforeImport = Boolean(source && sessionId && sessions.has(sessionKey(source, sessionId)))
  let importAttempted = false
  if (source && sessionId && !existedBeforeImport) {
    importAttempted = true
    await importExternalManagedAiSessionsOnce()
  }
  return { source, sessionId, existedBeforeImport, importAttempted }
}

const logManagedAiContentAccess = (event: string, level: 'info' | 'warn', fields: Record<string, unknown>) => {
  logRuntimeEvent(level, event, fields)
}

export const listManagedAiSessionContent = async (input: ManagedAiSessionContentListInput): Promise<ManagedAiSessionContentListResult> => {
  const startedAt = Date.now()
  let access: Awaited<ReturnType<typeof prepareManagedAiContentAccess>> | null = null
  try {
    access = await prepareManagedAiContentAccess(input)
    const result = await contentRuntime.list(input)
    logManagedAiContentAccess(result.ok ? 'managed_ai.content.list' : 'managed_ai.content.list.failed', result.ok ? 'info' : 'warn', {
      source: access.source || input?.source,
      sessionId: access.sessionId || input?.sessionId,
      durationMs: Date.now() - startedAt,
      existedBeforeImport: access.existedBeforeImport,
      importAttempted: access.importAttempted,
      ok: result.ok,
      ...(result.ok && result.data
        ? {
            format: result.data.format,
            executionThread: result.data.format === 'jsonl' ? 'worker' : 'main',
            records: result.data.records.length,
            total: result.data.total,
            offset: result.data.offset,
            limit: result.data.limit
          }
        : {
            errorCode: result.errorCode
          })
    })
    return result
  } catch (error) {
    logManagedAiContentAccess('managed_ai.content.list.failed', 'warn', {
      source: access?.source || input?.source,
      sessionId: access?.sessionId || input?.sessionId,
      durationMs: Date.now() - startedAt,
      existedBeforeImport: access?.existedBeforeImport,
      importAttempted: access?.importAttempted,
      error
    })
    throw error
  }
}

export const getManagedAiSessionContentRecord = async (input: ManagedAiSessionContentRecordInput): Promise<ManagedAiSessionContentRecordResult> => {
  const startedAt = Date.now()
  let access: Awaited<ReturnType<typeof prepareManagedAiContentAccess>> | null = null
  try {
    access = await prepareManagedAiContentAccess(input)
    const result = await contentRuntime.getRecord(input)
    logManagedAiContentAccess(result.ok ? 'managed_ai.content.get-record' : 'managed_ai.content.get-record.failed', result.ok ? 'info' : 'warn', {
      source: access.source || input?.source,
      sessionId: access.sessionId || input?.sessionId,
      recordId: input?.recordId,
      durationMs: Date.now() - startedAt,
      existedBeforeImport: access.existedBeforeImport,
      importAttempted: access.importAttempted,
      ok: result.ok,
      ...(result.ok && result.data
        ? {
            format: result.data.record.format,
            executionThread: result.data.record.format === 'jsonl' ? 'worker' : 'main',
            fullLength: result.data.record.fullLength,
            truncated: result.data.record.contentTruncated
          }
        : {
            errorCode: result.errorCode
          })
    })
    return result
  } catch (error) {
    logManagedAiContentAccess('managed_ai.content.get-record.failed', 'warn', {
      source: access?.source || input?.source,
      sessionId: access?.sessionId || input?.sessionId,
      recordId: input?.recordId,
      durationMs: Date.now() - startedAt,
      existedBeforeImport: access?.existedBeforeImport,
      importAttempted: access?.importAttempted,
      error
    })
    throw error
  }
}

export const updateManagedAiSessionContentRecord = async (input: ManagedAiSessionContentUpdateInput): Promise<ManagedAiSessionContentUpdateResult> => {
  await loadStoreIfNeeded()
  return contentRuntime.updateRecord(input)
}

export const deleteManagedAiSessionContentRecord = async (input: ManagedAiSessionContentDeleteInput): Promise<ManagedAiSessionContentDeleteResult> => {
  const startedAt = Date.now()
  let access: Awaited<ReturnType<typeof prepareManagedAiContentAccess>> | null = null
  try {
    access = await prepareManagedAiContentAccess(input)
    const result = await contentRuntime.deleteRecord(input)
    logManagedAiContentAccess(result.ok ? 'managed_ai.content.delete-record' : 'managed_ai.content.delete-record.failed', result.ok ? 'info' : 'warn', {
      source: access.source || input?.source,
      sessionId: access.sessionId || input?.sessionId,
      recordId: input?.recordId,
      durationMs: Date.now() - startedAt,
      existedBeforeImport: access.existedBeforeImport,
      importAttempted: access.importAttempted,
      ok: result.ok,
      ...(result.ok && result.data
        ? {
            sourceRevision: result.data.sourceRevision,
            backedUp: Boolean(result.data.backupPath)
          }
        : {
            errorCode: result.errorCode
          })
    })
    return result
  } catch (error) {
    logManagedAiContentAccess('managed_ai.content.delete-record.failed', 'warn', {
      source: access?.source || input?.source,
      sessionId: access?.sessionId || input?.sessionId,
      recordId: input?.recordId,
      durationMs: Date.now() - startedAt,
      existedBeforeImport: access?.existedBeforeImport,
      importAttempted: access?.importAttempted,
      error
    })
    throw error
  }
}

export const listManagedAiNotifications = async (input: ManagedAiNotificationListInput = {}): Promise<ManagedAiNotificationListResult> => {
  return notificationRuntime.list(input)
}

const mutationError = (errorCode: string, errorMessage: string): ManagedAiSessionMutationResult => ({ ok: false, errorCode, errorMessage })

const bulkError = (errorCode: string, errorMessage: string): ManagedAiSessionBulkResult => ({ ok: false, errorCode, errorMessage })

const hibernationError = (errorCode: string, errorMessage: string): ManagedAiSessionHibernateResult => ({ ok: false, errorCode, errorMessage })

const getSessionForInput = (sourceValue: unknown, sessionIdValue: unknown) => {
  const source = normalizeSource(sourceValue)
  const sessionId = cleanOptionalText(sessionIdValue)
  if (!source || !sessionId) return null
  return sessions.get(sessionKey(source, sessionId)) || null
}

const resolveSessionForSelector = (input: Pick<ManagedAiSessionHibernateInput, 'source' | 'sessionId'>) => {
  const source = normalizeSource(input?.source)
  const sessionId = cleanOptionalText(input?.sessionId)
  if (!sessionId) return { error: hibernationError('MANAGED_AI_SESSION_ID_REQUIRED', 'Managed AI session id is required.') }
  if (source) {
    const session = sessions.get(sessionKey(source, sessionId))
    if (!session) return { error: hibernationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.') }
    return { session }
  }
  const matches = [...sessions.values()].filter((session) => session.id === sessionId)
  if (!matches.length) return { error: hibernationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.') }
  if (matches.length > 1) return { error: hibernationError('MANAGED_AI_SESSION_SOURCE_REQUIRED', 'Multiple managed AI sessions match this sessionId; pass source.') }
  return { session: matches[0] }
}

export const getAgentHibernationConfig = async (): Promise<AgentHibernationConfigResult> => {
  await loadStoreIfNeeded()
  return { ok: true, data: { config: { ...agentHibernationConfig } } }
}

export const setAgentHibernationConfig = async (input: Partial<AgentHibernationConfig> = {}): Promise<AgentHibernationConfigResult> => {
  await loadStoreIfNeeded()
  agentHibernationConfig = normalizeAgentHibernationConfig(input, agentHibernationConfig)
  persistSnapshot()
  return { ok: true, data: { config: { ...agentHibernationConfig } } }
}

export const hibernateManagedAiSession = async (input: ManagedAiSessionHibernateInput): Promise<ManagedAiSessionHibernateResult> => {
  await loadStoreIfNeeded()
  if (!agentHibernationConfig.enabled) return hibernationError('AGENT_HIBERNATION_DISABLED', 'Agent hibernation is disabled.')
  const resolved = resolveSessionForSelector(input)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') return hibernationError('AGENT_HIBERNATION_NEEDS_INPUT', 'Managed AI session needs input and cannot hibernate.')
  if (!managedAiSessionAllowsResume(session) || !session.resumeCommand) return hibernationError('AGENT_HIBERNATION_RESUME_UNAVAILABLE', 'Managed AI session has no resume command.')
  const now = Date.now()
  const next: ManagedAiSessionRecord = {
    ...session,
    hibernated: true,
    hibernatedAt: now,
    hibernationReason: cleanOptionalText(input.reason) || 'manual',
    hibernatedTerminalSessionId: cleanOptionalText(input.terminalSessionId) || session.terminalSessionId,
    state: session.state === 'working' ? 'idle' : session.state,
    agentLifecycle: session.agentLifecycle === 'running' ? 'idle' : session.agentLifecycle,
    updatedAt: now
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: now,
    kind: 'session.hibernated',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary,
    reason: next.hibernationReason
  })
  publishManagedAiStreamFrame('managed_ai.session.hibernated', next, { reason: next.hibernationReason })
  return { ok: true, data: { session: next, snapshot: snapshot(), config: { ...agentHibernationConfig } } }
}

export const wakeManagedAiSession = async (input: ManagedAiSessionHibernateInput): Promise<ManagedAiSessionHibernateResult> => {
  await loadStoreIfNeeded()
  const resolved = resolveSessionForSelector(input)
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const now = Date.now()
  const {
    hibernated: _hibernated,
    hibernatedAt: _hibernatedAt,
    hibernationReason: _hibernationReason,
    hibernatedTerminalSessionId: _hibernatedTerminalSessionId,
    ...rest
  } = session
  const next: ManagedAiSessionRecord = {
    ...rest,
    updatedAt: now
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: now,
    kind: 'session.woke',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary,
    reason: cleanOptionalText(input.reason) || 'manual'
  })
  publishManagedAiStreamFrame('managed_ai.session.woke', next, { reason: cleanOptionalText(input.reason) || 'manual' })
  return { ok: true, data: { session: next, snapshot: snapshot(), config: { ...agentHibernationConfig } } }
}

export const replyManagedAiSession = async (input: ManagedAiSessionReplyInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const session = getSessionForInput(input?.source, input?.sessionId)
  if (!session) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  const kind = cleanText(input.kind) as ManagedAiSessionDecisionKind
  if (!decisionKinds.has(kind)) return mutationError('MANAGED_AI_SESSION_DECISION_INVALID', 'Managed AI session decision kind is invalid.')
  const decision: ManagedAiSessionDecision = {
    id: randomUUID(),
    kind,
    ...(cleanOptionalText(input.message) ? { message: cleanOptionalText(input.message) } : {}),
    createdAt: Date.now()
  }
  const { pendingRequestId: _pendingRequestId, ...sessionWithoutPending } = session
  const next: ManagedAiSessionRecord = {
    ...sessionWithoutPending,
    state: session.state === 'needsInput' ? 'idle' : session.state,
    handledAt: decision.createdAt,
    updatedAt: decision.createdAt,
    decisions: [...session.decisions, decision].slice(-maxDecisionsPerSession)
  }
  resolvePendingDecision(session, decision)
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  auditDecisionCreated(session, decision)
  publishManagedAiStreamFrame('managed_ai.decision.created', next, {
    decisionKind: decision.kind,
    decisionId: decision.id,
    requestId: session.pendingRequestId
  })
  return { ok: true, data: { session: next, snapshot: snapshot() } }
}

export const renameManagedAiSession = async (input: ManagedAiSessionRenameInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const session = getSessionForInput(input?.source, input?.sessionId)
  if (!session) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  const title = compactString(input.title, 80)
  if (!title) return mutationError('MANAGED_AI_SESSION_TITLE_REQUIRED', 'Managed AI session title is required.')
  const updatedAt = Date.now()
  const next: ManagedAiSessionRecord = {
    ...session,
    title,
    userTitle: title,
    updatedAt
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: updatedAt,
    kind: 'session.renamed',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary
  })
  publishManagedAiStreamFrame('managed_ai.session.renamed', next, { title: next.title })
  return { ok: true, data: { session: next, snapshot: snapshot() } }
}

export const clearManagedAiSession = async (input: ManagedAiSessionClearInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const source = normalizeSource(input?.source)
  const sessionId = cleanOptionalText(input?.sessionId)
  if (!source || !sessionId) return mutationError('MANAGED_AI_SESSION_INPUT_INVALID', 'Managed AI session source and sessionId are required.')
  const key = sessionKey(source, sessionId)
  const session = sessions.get(key)
  if (!session) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  sessions.delete(key)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'session.cleared',
    source,
    sessionId,
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary
  })
  publishManagedAiStreamFrame('managed_ai.session.cleared', session, {})
  return { ok: true, data: { snapshot: snapshot() } }
}

export const bulkManagedAiSessions = async (input: ManagedAiSessionBulkInput): Promise<ManagedAiSessionBulkResult> => {
  await loadStoreIfNeeded()
  const operation = input?.operation
  if (operation !== 'mark-handled' && operation !== 'clear-ended' && operation !== 'clear-all') {
    return bulkError('MANAGED_AI_SESSION_BULK_OPERATION_INVALID', 'Managed AI session bulk operation is invalid.')
  }
  const sourceFilter = new Set((Array.isArray(input.sources) ? input.sources.map(normalizeSource).filter(Boolean) : []) as AiAgentSessionSource[])
  const idFilter = new Set(Array.isArray(input.sessionIds) ? input.sessionIds.map(cleanText).filter(Boolean) : [])
  const matches = (session: ManagedAiSessionRecord) =>
    (!sourceFilter.size || sourceFilter.has(session.source)) && (!idFilter.size || idFilter.has(session.id))
  let changed = 0
  const now = Date.now()
  if (operation === 'mark-handled') {
    sessions.forEach((session, key) => {
      if (!matches(session) || session.state !== 'needsInput') return
      changed += 1
      const decision: ManagedAiSessionDecision = { id: randomUUID(), kind: 'handled', createdAt: now }
      sessions.set(key, {
        ...session,
        state: 'idle',
        handledAt: now,
        updatedAt: now,
        decisions: [...session.decisions, decision].slice(-maxDecisionsPerSession)
      })
    })
  } else if (operation === 'clear-ended') {
    sessions.forEach((session, key) => {
      if (!matches(session) || session.state !== 'ended') return
      changed += 1
      sessions.delete(key)
    })
  } else {
    sessions.forEach((session, key) => {
      if (!matches(session)) return
      changed += 1
      sessions.delete(key)
    })
  }
  if (changed) persistSnapshot()
  appendManagedAiSessionAudit({
    at: now,
    kind: 'sessions.bulk',
    operation,
    changed
  })
  publishManagedAiStreamFrame('managed_ai.sessions.bulk', null, {
    operation,
    changed,
    sources: [...sourceFilter],
    sessionIds: [...idFilter]
  })
  return { ok: true, data: { changed, snapshot: snapshot() } }
}

export const markManagedAiNotificationRead = async (input: ManagedAiNotificationMarkReadInput): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.markRead(input)
}

export const dismissManagedAiNotification = async (input: ManagedAiNotificationDismissInput): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.dismiss(input)
}

export const clearManagedAiNotifications = async (): Promise<ManagedAiNotificationClearResult> => {
  return notificationRuntime.clear()
}

export const openManagedAiNotification = async (input: ManagedAiNotificationOpenInput): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.open(input)
}

export const jumpToUnreadManagedAiNotification = async (): Promise<ManagedAiNotificationMutationResult> => {
  return notificationRuntime.jumpToUnread()
}

const writeSocketResponse = (socket: Socket, response: AgentSessionSocketResponse) => {
  socket.write(`${JSON.stringify(response)}\n`)
}

const isEventStreamRequest = (record: unknown) => {
  if (!isRecord(record)) return false
  const method = cleanText(record.method || record.type || record.command).toLowerCase()
  return method === 'events.stream' || method === 'stream' || method === 'agent.events.stream'
}

const handleSocketLine = async (socket: Socket, line: string, emit: AgentSessionEventSink) => {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    if (isEventStreamRequest(parsed)) {
      agentSessionEventStreamRuntime.startEventStream(socket, parsed)
      return
    }
    writeSocketResponse(socket, await publishAiAgentSessionSocketEvent(parsed as AiAgentSessionEventInput, emit))
  } catch {
    writeSocketResponse(socket, {
      ok: false,
      errorCode: 'AI_AGENT_EVENT_JSON_INVALID',
      errorMessage: 'AI agent event socket payload must be newline-delimited JSON.'
    })
  }
}

export const agentSessionSocketPathFor = (userDataPath: string) => {
  return platformSocketPath(userDataPath, 'aiopsterm-agent-sessions', { directory: 'agent-sessions' })
}

export const agentHookScriptResourcePathFor = (appPath: string, resourcesPath: string) => {
  const scriptName = 'aiopsterm-agent-hook.js'
  const candidates = [join(resourcesPath, scriptName), join(resourcesPath, 'resources', scriptName), join(appPath, 'resources', scriptName)]
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export const agentHookScriptPathFor = (appPath: string, resourcesPath: string, userDataPath?: string) => {
  const source = agentHookScriptResourcePathFor(appPath, resourcesPath)
  const userData = cleanText(userDataPath)
  if (!userData) return source
  const stablePath = join(userData, 'agent-hooks', 'aiopsterm-agent-hook.js')
  try {
    mkdirSync(dirname(stablePath), { recursive: true })
    copyFileSync(source, stablePath)
    return stablePath
  } catch {
    return source
  }
}

export const getAiAgentSessionSocketPath = () => socketPath

export const ensureAiAgentSessionServer = async ({ userDataPath, emit }: AgentSessionSocketRuntime) => {
  eventSink = emit
  await configureAiAgentSessionStore(userDataPath)
  if (server && socketPath) return socketPath
  socketPath = agentSessionSocketPathFor(userDataPath)
  if (process.platform !== 'win32') {
    await mkdir(join(userDataPath, 'agent-sessions'), { recursive: true })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) handleSocketLine(socket, line, emit)
        newlineIndex = buffer.indexOf('\n')
      }
    })
    socket.on('end', () => {
      const line = buffer.trim()
      if (line) handleSocketLine(socket, line, emit)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(socketPath, () => {
      server?.off('error', reject)
      resolve()
    })
  })
  return socketPath
}

export const closeAiAgentSessionServer = () => {
  void disposeAgentSessionContentWorker()
  flushPersistSnapshotNow()
  const existing = server
  server = null
  if (existing) existing.close()
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
  eventSink = null
  pendingDecisions.forEach((pending) => {
    clearTimeout(pending.timer)
    appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'decision.timeout',
      source: pending.source,
      sessionId: pending.sessionId,
      event: pending.event.event,
      title: pending.event.title,
      summary: pending.event.summary,
      requestId: pending.requestId
    })
    pending.resolve({ ok: true, status: 'timeout', agentOutput: {} })
  })
  pendingDecisions = new Map()
  agentSessionEventStreamRuntime.closeEventStreams()
  codexTranscriptMonitorRuntime.reset()
}

export const __testing = {
  sourceLabel,
  storePathFor,
  auditPathFor,
  managedAiSessionStateForEvent,
  autoTitleFor,
  streamBootId: agentSessionEventStreamRuntime.streamBootId,
  streamEventCount: agentSessionEventStreamRuntime.streamEventCount,
  streamLatestSeq: agentSessionEventStreamRuntime.streamLatestSeq,
  flushManagedAiSessionImports: () => flushScheduledImportScan(),
  flushManagedAiSessionGitRefresh: () => flushScheduledGitRefresh(),
  flushManagedAiSessionWrites: async () => {
    flushPersistSnapshotNow()
    await storeRuntime.flush()
    await auditRuntime.flush()
  },
  flushCodexTranscriptMonitors: () => codexTranscriptMonitorRuntime.flush(),
  activeCodexTranscriptMonitorCount: () => codexTranscriptMonitorRuntime.activeCount()
}
