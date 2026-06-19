import { createHash, randomUUID } from 'crypto'
import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import type {
  AiAgentSessionEvent,
  AiAgentSessionEventInput,
  AiAgentSessionEventName,
  AiAgentSessionEventResult,
  AiAgentSessionSource,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionClearInput,
  ManagedAiSessionDecision,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionRenameInput,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot,
  ManagedAiSessionState,
  ManagedAiSessionTimelineEvent
} from '@shared/preload'

export type AgentSessionEventSink = (event: AiAgentSessionEvent) => void

type AgentSessionSocketRuntime = {
  userDataPath: string
  emit: AgentSessionEventSink
}

type PersistedManagedAiSessionSnapshot = ManagedAiSessionSnapshot & {
  version?: number
}

const storeVersion = 1
const maxSessions = 200
const maxEventsPerSession = 200
const maxDecisionsPerSession = 40
const maxRawKeys = 80
const supportedSources = new Set<AiAgentSessionSource>([
  'codex',
  'claude-code',
  'cursor',
  'gemini',
  'copilot',
  'grok',
  'opencode',
  'codebuddy',
  'factory',
  'qoder',
  'antigravity',
  'kiro',
  'hermes-agent',
  'rovodev',
  'amp',
  'pi',
  'omp'
])
const supportedEvents = new Set<AiAgentSessionEventName>([
  'session_start',
  'prompt_submit',
  'pre_tool_use',
  'permission_request',
  'question',
  'notification',
  'stop',
  'session_end'
])
const decisionKinds = new Set<ManagedAiSessionDecisionKind>(['allow', 'deny', 'reply', 'handled'])

let server: Server | null = null
let socketPath = ''
let eventSink: AgentSessionEventSink | null = null
let storePath = ''
let sessions = new Map<string, ManagedAiSessionRecord>()
let loadedStore = false
let writeQueue: Promise<void> = Promise.resolve()

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

const sessionKey = (source: AiAgentSessionSource, id: string) => `${source}:${id}`

const normalizeSource = (value: unknown): AiAgentSessionSource | null => {
  const source = cleanText(value).toLowerCase().replace(/_/g, '-')
  if (!source) return null
  const aliases: Record<string, AiAgentSessionSource> = {
    claude: 'claude-code',
    claude_code: 'claude-code',
    claude_code_cli: 'claude-code',
    'claude-code-cli': 'claude-code',
    cursoragent: 'cursor',
    cursor_agent: 'cursor',
    'cursor-agent': 'cursor',
    gemini_cli: 'gemini',
    'gemini-cli': 'gemini',
    github_copilot: 'copilot',
    'github-copilot': 'copilot',
    agy: 'antigravity',
    rovo: 'rovodev',
    rovo_dev: 'rovodev',
    'rovo-dev': 'rovodev',
    hermes: 'hermes-agent',
    hermes_agent: 'hermes-agent'
  }
  const normalized = aliases[source] || (source as AiAgentSessionSource)
  return supportedSources.has(normalized) ? normalized : null
}

const normalizeEventName = (value: unknown): AiAgentSessionEventName | null => {
  const raw = cleanText(value)
  if (!raw) return null
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
  const aliases: Record<string, AiAgentSessionEventName> = {
    afteragent: 'stop',
    after_agent: 'stop',
    afteragentresponse: 'stop',
    after_agent_response: 'stop',
    beforeagent: 'prompt_submit',
    before_agent: 'prompt_submit',
    beforeshellexecution: 'pre_tool_use',
    before_shell_execution: 'pre_tool_use',
    beforesubmitprompt: 'prompt_submit',
    before_submit_prompt: 'prompt_submit',
    on_complete: 'stop',
    on_error: 'stop',
    on_session_end: 'session_end',
    on_session_finalize: 'session_end',
    on_session_reset: 'session_start',
    on_session_start: 'session_start',
    on_tool_permission: 'permission_request',
    post_llm_call: 'stop',
    post_approval_response: 'notification',
    pre_approval_request: 'permission_request',
    pre_llm_call: 'prompt_submit',
    preinvocation: 'prompt_submit',
    pre_invocation: 'prompt_submit',
    pretooluse: 'pre_tool_use',
    pre_tool_use: 'pre_tool_use',
    promptsubmit: 'prompt_submit',
    prompt_submit: 'prompt_submit',
    permissionrequest: 'permission_request',
    permission_request: 'permission_request',
    sessionend: 'session_end',
    session_end: 'session_end',
    sessionstart: 'session_start',
    session_start: 'session_start',
    shell_exec: 'prompt_submit',
    stop: 'stop',
    turn_completion: 'stop',
    userpromptsubmit: 'prompt_submit',
    user_prompt_submit: 'prompt_submit',
    askuserquestion: 'question',
    ask_user_question: 'question',
    question: 'question',
    notification: 'notification',
    notify: 'notification'
  }
  return aliases[normalized] || (supportedEvents.has(normalized as AiAgentSessionEventName) ? (normalized as AiAgentSessionEventName) : null)
}

const firstText = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const text = cleanOptionalText(record[key])
    if (text) return text
  }
  return undefined
}

const nestedRecord = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const baseNameFromPath = (value: unknown) => {
  const text = cleanText(value).replace(/[\\/]+$/, '')
  if (!text) return ''
  return text.split(/[\\/]/).filter(Boolean).pop() || text
}

const sourceLabel = (source: AiAgentSessionSource) => {
  const labels: Record<AiAgentSessionSource, string> = {
    'claude-code': 'Claude Code',
    antigravity: 'Antigravity',
    amp: 'Amp',
    codebuddy: 'CodeBuddy',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
    factory: 'Factory',
    gemini: 'Gemini',
    grok: 'Grok',
    'hermes-agent': 'Hermes Agent',
    kiro: 'Kiro',
    omp: 'OMP',
    opencode: 'OpenCode',
    pi: 'Pi',
    qoder: 'Qoder',
    rovodev: 'Rovo Dev'
  }
  return labels[source] || source
}

const eventTitle = (source: AiAgentSessionSource, event: AiAgentSessionEventName, input: Record<string, unknown>, cwd?: string) =>
  firstText(input, ['title', 'projectTitle', 'project_title', 'workspaceTitle', 'workspace_title']) ||
  (() => {
    const projectName = firstText(input, ['projectName', 'project_name', 'workspaceName', 'workspace_name']) || baseNameFromPath(cwd)
    return projectName ? `${sourceLabel(source)} · ${projectName}` : ''
  })() ||
  (event === 'permission_request'
    ? `${sourceLabel(source)} needs approval`
    : event === 'question'
      ? `${sourceLabel(source)} needs input`
      : event === 'notification'
        ? `${sourceLabel(source)} notification`
        : sourceLabel(source))

const questionSummary = (input: Record<string, unknown>) => {
  const toolInput = nestedRecord(input, 'tool_input')
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : []
  const question = questions.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined
  return question ? firstText(question, ['question', 'header', 'prompt']) : undefined
}

const eventSummary = (event: AiAgentSessionEventName, input: Record<string, unknown>) =>
  firstText(input, ['summary', 'message', 'body', 'text', 'prompt', 'lastAssistantMessage', 'last_assistant_message']) ||
  questionSummary(input) ||
  (event === 'stop' ? 'Turn complete' : '')

const managedAiSessionStateForEvent = (event: AiAgentSessionEventName, previous: ManagedAiSessionState = 'unknown'): ManagedAiSessionState => {
  if (event === 'session_start') return 'idle'
  if (event === 'prompt_submit' || event === 'pre_tool_use') return 'working'
  if (event === 'permission_request' || event === 'question' || event === 'notification') return 'needsInput'
  if (event === 'stop') return 'idle'
  if (event === 'session_end') return 'ended'
  return previous
}

const compactString = (value: unknown, maxLength = 240) => {
  const text = cleanText(value)
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

const compactRawValue = (value: unknown, depth = 0): unknown => {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return compactString(value, 600)
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactRawValue(item, depth + 1))
  if (typeof value === 'object' && depth < 3) {
    const out: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>)
      .slice(0, maxRawKeys)
      .forEach(([key, item]) => {
        out[key] = compactRawValue(item, depth + 1)
      })
    return out
  }
  return undefined
}

const compactRawRecord = (record: Record<string, unknown>) => compactRawValue(record) as Record<string, unknown>

const wordsForAutoTitle = (text: string) =>
  text
    .replace(/[^\p{L}\p{N}\s._/-]+/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .slice(0, 5)

const isGenericAutoTitleCandidate = (text: string) => {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return (
    normalized === 'turn complete' ||
    normalized === 'done' ||
    normalized === 'complete' ||
    normalized === 'session complete' ||
    normalized === 'session ended' ||
    /^[a-z0-9_-]+:\s+/.test(normalized) ||
    normalized.endsWith(' turn complete')
  )
}

const autoTitleFor = (event: AiAgentSessionEvent, existing?: ManagedAiSessionRecord) => {
  if (existing?.userTitle) return existing.title
  const candidates = [
    event.summary,
    event.title.includes('·') ? event.title.split('·').pop() : event.title,
    event.cwd ? baseNameFromPath(event.cwd) : '',
    existing?.cwd ? baseNameFromPath(existing.cwd) : ''
  ]
  for (const candidate of candidates) {
    const text = cleanText(candidate)
    if (!text || isGenericAutoTitleCandidate(text)) continue
    const words = wordsForAutoTitle(text)
    if (words.length >= 2) return words.slice(0, 5).join(' ')
    if (!existing && words.length === 1 && text === baseNameFromPath(text)) return `${sourceLabel(event.source)} · ${words[0]}`
  }
  return existing?.autoTitle || existing?.title || event.title || sourceLabel(event.source)
}

const normalizeRecordEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>): ManagedAiSessionTimelineEvent => ({
  ...event,
  id: createEventId(event),
  raw: compactRawRecord(raw)
})

const createEventId = (event: AiAgentSessionEvent) => {
  const hash = createHash('sha1')
    .update([event.source, event.sessionId, event.event, event.receivedAt, event.summary].join('\0'))
    .digest('hex')
    .slice(0, 12)
  return `${event.receivedAt}-${hash}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeStoredSession = (value: unknown): ManagedAiSessionRecord | null => {
  if (!isRecord(value)) return null
  const source = normalizeSource(value.source)
  const id = cleanOptionalText(value.id)
  const lastEvent = normalizeEventName(value.lastEvent)
  if (!source || !id || !lastEvent) return null
  const now = Date.now()
  const events = Array.isArray(value.events)
    ? value.events.filter(isRecord).map((item) => normalizeStoredTimelineEvent(item, source, id)).filter(Boolean)
    : []
  const decisions = Array.isArray(value.decisions)
    ? value.decisions.filter(isRecord).map(normalizeStoredDecision).filter(Boolean)
    : []
  return {
    id,
    source,
    title: cleanOptionalText(value.title) || sourceLabel(source),
    summary: cleanOptionalText(value.summary) || '',
    state: value.state === 'idle' || value.state === 'working' || value.state === 'needsInput' || value.state === 'ended' || value.state === 'unknown' ? value.state : 'unknown',
    lastEvent,
    lastActivityAt: typeof value.lastActivityAt === 'number' ? value.lastActivityAt : now,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
    ...(typeof value.handledAt === 'number' ? { handledAt: value.handledAt } : {}),
    ...(cleanOptionalText(value.autoTitle) ? { autoTitle: cleanOptionalText(value.autoTitle) } : {}),
    ...(cleanOptionalText(value.userTitle) ? { userTitle: cleanOptionalText(value.userTitle) } : {}),
    ...(cleanOptionalText(value.panelId) ? { panelId: cleanOptionalText(value.panelId) } : {}),
    ...(cleanOptionalText(value.terminalSessionId) ? { terminalSessionId: cleanOptionalText(value.terminalSessionId) } : {}),
    ...(cleanOptionalText(value.workspaceId) ? { workspaceId: cleanOptionalText(value.workspaceId) } : {}),
    ...(cleanOptionalText(value.cwd) ? { cwd: cleanOptionalText(value.cwd) } : {}),
    ...(cleanOptionalText(value.transcriptPath) ? { transcriptPath: cleanOptionalText(value.transcriptPath) } : {}),
    events: events.slice(-maxEventsPerSession) as ManagedAiSessionTimelineEvent[],
    decisions: decisions.slice(-maxDecisionsPerSession) as ManagedAiSessionDecision[]
  }
}

const normalizeStoredTimelineEvent = (value: Record<string, unknown>, fallbackSource: AiAgentSessionSource, fallbackSessionId: string) => {
  const source = normalizeSource(value.source) || fallbackSource
  const event = normalizeEventName(value.event)
  if (!event) return null
  const receivedAt = typeof value.receivedAt === 'number' ? value.receivedAt : Date.now()
  return {
    source,
    event,
    sessionId: cleanOptionalText(value.sessionId) || fallbackSessionId,
    title: cleanOptionalText(value.title) || sourceLabel(source),
    summary: cleanOptionalText(value.summary) || '',
    receivedAt,
    id: cleanOptionalText(value.id) || `${receivedAt}-${randomUUID()}`,
    ...(cleanOptionalText(value.panelId) ? { panelId: cleanOptionalText(value.panelId) } : {}),
    ...(cleanOptionalText(value.terminalSessionId) ? { terminalSessionId: cleanOptionalText(value.terminalSessionId) } : {}),
    ...(cleanOptionalText(value.workspaceId) ? { workspaceId: cleanOptionalText(value.workspaceId) } : {}),
    ...(cleanOptionalText(value.cwd) ? { cwd: cleanOptionalText(value.cwd) } : {}),
    ...(cleanOptionalText(value.transcriptPath) ? { transcriptPath: cleanOptionalText(value.transcriptPath) } : {}),
    ...(isRecord(value.raw) ? { raw: compactRawRecord(value.raw) } : {})
  } satisfies ManagedAiSessionTimelineEvent
}

const normalizeStoredDecision = (value: Record<string, unknown>) => {
  const kind = cleanText(value.kind) as ManagedAiSessionDecisionKind
  if (!decisionKinds.has(kind)) return null
  return {
    id: cleanOptionalText(value.id) || randomUUID(),
    kind,
    ...(cleanOptionalText(value.message) ? { message: cleanOptionalText(value.message) } : {}),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  } satisfies ManagedAiSessionDecision
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

const persistSnapshot = () => {
  if (!storePath) return
  const payload: PersistedManagedAiSessionSnapshot = {
    version: storeVersion,
    ...snapshot()
  }
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(storePath), { recursive: true })
      await writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    })
}

const loadStoreIfNeeded = async () => {
  if (loadedStore || !storePath) return
  loadedStore = true
  if (!existsSync(storePath)) return
  try {
    const raw = String(await readFile(storePath, 'utf-8'))
    const parsed = JSON.parse(raw) as PersistedManagedAiSessionSnapshot
    const loaded = Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeStoredSession).filter(Boolean) : []
    sessions = new Map((loaded as ManagedAiSessionRecord[]).map((session) => [sessionKey(session.source, session.id), session]))
  } catch {
    sessions = new Map()
  }
}

const storePathFor = (userDataPath: string) => join(userDataPath, 'agent-sessions', 'managed-ai-sessions.json')

export const configureAiAgentSessionStore = async (userDataPath: string) => {
  const nextStorePath = storePathFor(userDataPath)
  if (storePath !== nextStorePath) {
    storePath = nextStorePath
    loadedStore = false
    sessions = new Map()
  }
  await mkdir(join(userDataPath, 'agent-sessions'), { recursive: true })
  await loadStoreIfNeeded()
}

export const normalizeAiAgentSessionEventInput = (input: unknown, now = Date.now()): AiAgentSessionEventResult => {
  if (!input || typeof input !== 'object') {
    return { ok: false, errorCode: 'AI_AGENT_EVENT_INVALID', errorMessage: 'AI agent event must be a JSON object.' }
  }
  const record = input as Record<string, unknown>
  const source = normalizeSource(record.source || record.agent || record.agentName || record.agent_name)
  if (!source) {
    return { ok: false, errorCode: 'AI_AGENT_EVENT_SOURCE_INVALID', errorMessage: 'AI agent event source is not supported.' }
  }
  const sessionId = firstText(record, ['sessionId', 'session_id', 'conversationId', 'conversation_id', 'id'])
  if (!sessionId) {
    return { ok: false, errorCode: 'AI_AGENT_EVENT_SESSION_REQUIRED', errorMessage: 'AI agent event sessionId is required.' }
  }
  const event = normalizeEventName(record.event || record.hookEventName || record.hook_event_name || record.type || record.kind)
  if (!event) {
    return { ok: false, errorCode: 'AI_AGENT_EVENT_NAME_INVALID', errorMessage: 'AI agent event name is not supported.' }
  }
  const panelId = cleanOptionalText(record.panelId || record.panel_id || record.surfaceId || record.surface_id)
  const terminalSessionId = cleanOptionalText(record.terminalSessionId || record.terminal_session_id || record.terminalId || record.terminal_id)
  const workspaceId = cleanOptionalText(record.workspaceId || record.workspace_id)
  const cwd = cleanOptionalText(record.cwd || record.workingDirectory || record.working_directory || record.project_dir || record.projectDir || record.project_path || record.projectPath)
  const transcriptPath = cleanOptionalText(record.transcriptPath || record.transcript_path)
  const normalized: AiAgentSessionEvent = {
    source,
    event,
    sessionId,
    title: eventTitle(source, event, record, cwd),
    summary: eventSummary(event, record),
    receivedAt: typeof record.receivedAt === 'number' && Number.isFinite(record.receivedAt) ? record.receivedAt : now,
    ...(panelId ? { panelId } : {}),
    ...(terminalSessionId ? { terminalSessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(transcriptPath ? { transcriptPath } : {})
  }
  return { ok: true, data: normalized }
}

const upsertSessionForEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) => {
  const key = sessionKey(event.source, event.sessionId)
  const existing = sessions.get(key)
  const state = managedAiSessionStateForEvent(event.event, existing?.state)
  const nextAutoTitle = event.event === 'stop' ? autoTitleFor(event, existing) : existing?.autoTitle
  const title = existing?.userTitle || nextAutoTitle || event.title || existing?.title || sourceLabel(event.source)
  const handledAt = state === 'needsInput' ? undefined : existing?.handledAt
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
    ...(event.panelId || existing?.panelId ? { panelId: event.panelId || existing?.panelId } : {}),
    ...(event.terminalSessionId || existing?.terminalSessionId ? { terminalSessionId: event.terminalSessionId || existing?.terminalSessionId } : {}),
    ...(event.workspaceId || existing?.workspaceId ? { workspaceId: event.workspaceId || existing?.workspaceId } : {}),
    ...(event.cwd || existing?.cwd ? { cwd: event.cwd || existing?.cwd } : {}),
    ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
    events: [...(existing?.events || []), normalizeRecordEvent(event, raw)].slice(-maxEventsPerSession),
    decisions: [...(existing?.decisions || [])].slice(-maxDecisionsPerSession)
  }
  sessions.set(key, record)
  const ordered = [...sessions.values()].sort((first, second) => second.lastActivityAt - first.lastActivityAt)
  sessions = new Map(ordered.slice(0, maxSessions).map((session) => [sessionKey(session.source, session.id), session]))
  persistSnapshot()
  return record
}

export const publishAiAgentSessionEvent = (input: AiAgentSessionEventInput, emit: AgentSessionEventSink | null = eventSink) => {
  const result = normalizeAiAgentSessionEventInput(input)
  if (!result.ok || !result.data) return result
  upsertSessionForEvent(result.data, input as Record<string, unknown>)
  emit?.(result.data)
  return result
}

export const listManagedAiSessions = async (): Promise<ManagedAiSessionListResult> => {
  await loadStoreIfNeeded()
  return { ok: true, data: snapshot() }
}

const mutationError = (errorCode: string, errorMessage: string): ManagedAiSessionMutationResult => ({ ok: false, errorCode, errorMessage })

const bulkError = (errorCode: string, errorMessage: string): ManagedAiSessionBulkResult => ({ ok: false, errorCode, errorMessage })

const getSessionForInput = (sourceValue: unknown, sessionIdValue: unknown) => {
  const source = normalizeSource(sourceValue)
  const sessionId = cleanOptionalText(sessionIdValue)
  if (!source || !sessionId) return null
  return sessions.get(sessionKey(source, sessionId)) || null
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
  const next: ManagedAiSessionRecord = {
    ...session,
    state: session.state === 'needsInput' ? 'idle' : session.state,
    handledAt: decision.createdAt,
    updatedAt: decision.createdAt,
    decisions: [...session.decisions, decision].slice(-maxDecisionsPerSession)
  }
  sessions.set(sessionKey(next.source, next.id), next)
  persistSnapshot()
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
  return { ok: true, data: { session: next, snapshot: snapshot() } }
}

export const clearManagedAiSession = async (input: ManagedAiSessionClearInput): Promise<ManagedAiSessionMutationResult> => {
  await loadStoreIfNeeded()
  const source = normalizeSource(input?.source)
  const sessionId = cleanOptionalText(input?.sessionId)
  if (!source || !sessionId) return mutationError('MANAGED_AI_SESSION_INPUT_INVALID', 'Managed AI session source and sessionId are required.')
  const key = sessionKey(source, sessionId)
  if (!sessions.has(key)) return mutationError('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.')
  sessions.delete(key)
  persistSnapshot()
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
  return { ok: true, data: { changed, snapshot: snapshot() } }
}

const writeSocketResponse = (socket: Socket, response: AiAgentSessionEventResult) => {
  socket.write(`${JSON.stringify(response)}\n`)
}

const handleSocketLine = (socket: Socket, line: string, emit: AgentSessionEventSink) => {
  try {
    writeSocketResponse(socket, publishAiAgentSessionEvent(JSON.parse(line) as AiAgentSessionEventInput, emit))
  } catch {
    writeSocketResponse(socket, {
      ok: false,
      errorCode: 'AI_AGENT_EVENT_JSON_INVALID',
      errorMessage: 'AI agent event socket payload must be newline-delimited JSON.'
    })
  }
}

export const agentSessionSocketPathFor = (userDataPath: string) => {
  if (process.platform === 'win32') return `\\\\.\\pipe\\aiopsterm-agent-sessions-${process.pid}`
  return join(userDataPath, 'agent-sessions', `aiopsterm-agent-sessions-${process.pid}.sock`)
}

export const agentHookScriptPathFor = (appPath: string, resourcesPath: string) => {
  const scriptName = 'aiopsterm-agent-hook.js'
  const candidates = [join(resourcesPath, scriptName), join(resourcesPath, 'resources', scriptName), join(appPath, 'resources', scriptName)]
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
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
  const existing = server
  server = null
  if (existing) existing.close()
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
  eventSink = null
}

export const __testing = {
  sourceLabel,
  storePathFor,
  managedAiSessionStateForEvent,
  autoTitleFor
}
