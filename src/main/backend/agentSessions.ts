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
  ManagedAiSessionLifecycle,
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

type PersistedManagedAiSessionSnapshot = ManagedAiSessionSnapshot & {
  version?: number
}

const storeVersion = 1
const maxSessions = 200
const maxEventsPerSession = 200
const maxDecisionsPerSession = 40
const maxRawKeys = 80
const defaultDecisionWaitTimeoutMs = 120_000
const maxDecisionWaitTimeoutMs = 125_000
const maxLaunchCommandLength = 600
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
  'lifecycle',
  'stop',
  'session_end'
])
const decisionKinds = new Set<ManagedAiSessionDecisionKind>(['allow', 'always', 'bypass', 'deny', 'reply', 'handled'])

let server: Server | null = null
let socketPath = ''
let eventSink: AgentSessionEventSink | null = null
let storePath = ''
let sessions = new Map<string, ManagedAiSessionRecord>()
let pendingDecisions = new Map<string, PendingAgentDecision>()
let loadedStore = false
let writeQueue: Promise<void> = Promise.resolve()

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const shellToken = (value: string) => (/^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : shellQuote(value))

const sessionKey = (source: AiAgentSessionSource, id: string) => `${source}:${id}`

const pendingDecisionKey = (source: AiAgentSessionSource, sessionId: string, requestId: string) => `${source}:${sessionId}:${requestId}`

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

const normalizeBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }
  return undefined
}

const normalizeWaitTimeoutMs = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number) || number <= 0) return defaultDecisionWaitTimeoutMs
  return Math.max(1000, Math.min(maxDecisionWaitTimeoutMs, Math.round(number)))
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
    lifecycle: 'lifecycle',
    status: 'lifecycle',
    tab_status: 'lifecycle',
    tabstatus: 'lifecycle',
    agent_lifecycle: 'lifecycle',
    agentlifecycle: 'lifecycle',
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

const cleanPositiveInteger = (value: unknown) => {
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const normalized = Math.floor(Number(value))
    return normalized > 0 ? normalized : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

const normalizeAgentLifecycle = (value: unknown): ManagedAiSessionLifecycle | undefined => {
  const normalized = cleanText(value).toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return undefined
  if (normalized === 'idle' || normalized === 'done' || normalized === 'ready' || normalized === 'completed') return 'idle'
  if (normalized === 'running' || normalized === 'working' || normalized === 'thinking' || normalized === 'reading' || normalized === 'busy') return 'running'
  if (normalized === 'needsinput' || normalized === 'waiting' || normalized === 'blocked' || normalized === 'approval' || normalized === 'question') return 'needsInput'
  if (normalized === 'ended' || normalized === 'closed' || normalized === 'exited' || normalized === 'stopped') return 'ended'
  if (normalized === 'unknown') return 'unknown'
  return undefined
}

const stateForAgentLifecycle = (lifecycle?: ManagedAiSessionLifecycle): ManagedAiSessionState | undefined => {
  if (lifecycle === 'running') return 'working'
  if (lifecycle === 'idle') return 'idle'
  if (lifecycle === 'needsInput') return 'needsInput'
  if (lifecycle === 'ended') return 'ended'
  if (lifecycle === 'unknown') return 'unknown'
  return undefined
}

const commandTokens = (command: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false
  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

const safeLaunchFlags = new Set([
  '-m',
  '--model',
  '--model-id',
  '--sandbox',
  '--approval',
  '--approval-policy',
  '--permission-mode',
  '--config',
  '--settings',
  '--profile',
  '--cwd',
  '-C',
  '--cd'
])

const blockedLaunchFlags = new Set([
  '-p',
  '--prompt',
  '--api-key',
  '--token',
  '--auth-token',
  '--resume',
  '-r',
  '--session',
  '--session-id',
  '--conversation',
  '--execute',
  'exec',
  'review'
])

const sanitizeLaunchCommand = (value: unknown) => {
  const text = cleanText(value)
  if (!text) return undefined
  const tokens = commandTokens(text).slice(0, 80)
  if (!tokens.length) return undefined
  const executable = tokens[0]
  const base = executable.split(/[\\/]/).pop() || executable
  const preserved = [base]
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    const [flagName] = token.split('=', 1)
    if (blockedLaunchFlags.has(token) || blockedLaunchFlags.has(flagName)) {
      if (!token.includes('=') && index + 1 < tokens.length) index += 1
      continue
    }
    if (safeLaunchFlags.has(token)) {
      if (index + 1 < tokens.length) {
        preserved.push(token, tokens[index + 1])
        index += 1
      }
      continue
    }
    if ([...safeLaunchFlags].some((flag) => token.startsWith(`${flag}=`))) {
      preserved.push(token)
    }
  }
  return preserved.map(shellToken).join(' ').slice(0, maxLaunchCommandLength)
}

const resumeCommandFor = (source: AiAgentSessionSource, sessionId: string, cwd?: string, provided?: unknown) => {
  const explicit = sanitizeLaunchCommand(provided)
  if (explicit && /\b(resume|--resume|-r|--session|--session-id)\b/.test(explicit)) return cwd ? `cd ${shellQuote(cwd)} && ${explicit}` : explicit
  const id = shellQuote(sessionId)
  const command =
    source === 'codex'
      ? `codex resume ${id}`
      : source === 'claude-code'
        ? `claude --resume ${id}`
        : source === 'grok'
          ? `grok -r ${id}`
          : source === 'opencode'
            ? `opencode --session ${id}`
            : source === 'cursor'
              ? `cursor-agent --resume ${id}`
              : source === 'gemini'
                ? `gemini --resume ${id}`
                : source === 'kiro'
                  ? `kiro-cli chat --resume-id ${id}`
                  : source === 'copilot'
                    ? `copilot --resume ${id}`
                    : source === 'codebuddy'
                      ? `codebuddy --resume ${id}`
                      : source === 'factory'
                        ? `droid --resume ${id}`
                        : source === 'qoder'
                          ? `qodercli --resume ${id}`
                          : ''
  if (!command) return undefined
  return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command
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
  (event === 'lifecycle' ? cleanText(input.status || input.lifecycle || input.agentLifecycle || input.agent_lifecycle) : '') ||
  (event === 'stop' ? 'Turn complete' : '')

const managedAiSessionStateForEvent = (
  event: AiAgentSessionEventName,
  previous: ManagedAiSessionState = 'unknown',
  lifecycle?: ManagedAiSessionLifecycle
): ManagedAiSessionState => {
  const lifecycleState = stateForAgentLifecycle(lifecycle)
  if (lifecycleState) return lifecycleState
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
    ...(cleanOptionalText(value.pendingRequestId) ? { pendingRequestId: cleanOptionalText(value.pendingRequestId) } : {}),
    ...(typeof value.actionable === 'boolean' ? { actionable: value.actionable } : {}),
    ...(cleanOptionalText(value.launchCommand) ? { launchCommand: cleanOptionalText(value.launchCommand) } : {}),
    ...(cleanOptionalText(value.resumeCommand) ? { resumeCommand: cleanOptionalText(value.resumeCommand) } : {}),
    ...(cleanPositiveInteger(value.processId) ? { processId: cleanPositiveInteger(value.processId) } : {}),
    ...(cleanPositiveInteger(value.parentProcessId) ? { parentProcessId: cleanPositiveInteger(value.parentProcessId) } : {}),
    ...(cleanPositiveInteger(value.processGroupId) ? { processGroupId: cleanPositiveInteger(value.processGroupId) } : {}),
    ...(normalizeAgentLifecycle(value.agentLifecycle) ? { agentLifecycle: normalizeAgentLifecycle(value.agentLifecycle) } : {}),
    ...(cleanPositiveInteger(value.terminalProcessId) ? { terminalProcessId: cleanPositiveInteger(value.terminalProcessId) } : {}),
    ...(typeof value.terminalActivityAt === 'number' ? { terminalActivityAt: value.terminalActivityAt } : {}),
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
    ...(cleanOptionalText(value.requestId) ? { requestId: cleanOptionalText(value.requestId) } : {}),
    ...(typeof value.actionable === 'boolean' ? { actionable: value.actionable } : {}),
    ...(cleanOptionalText(value.launchCommand) ? { launchCommand: cleanOptionalText(value.launchCommand) } : {}),
    ...(cleanOptionalText(value.resumeCommand) ? { resumeCommand: cleanOptionalText(value.resumeCommand) } : {}),
    ...(cleanPositiveInteger(value.processId) ? { processId: cleanPositiveInteger(value.processId) } : {}),
    ...(cleanPositiveInteger(value.parentProcessId) ? { parentProcessId: cleanPositiveInteger(value.parentProcessId) } : {}),
    ...(cleanPositiveInteger(value.processGroupId) ? { processGroupId: cleanPositiveInteger(value.processGroupId) } : {}),
    ...(normalizeAgentLifecycle(value.agentLifecycle) ? { agentLifecycle: normalizeAgentLifecycle(value.agentLifecycle) } : {}),
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
  const requestId = cleanOptionalText(record.requestId || record.request_id || record.tool_use_id)
  const actionable = normalizeBoolean(record.actionable ?? record.waitForDecision ?? record.wait_for_decision)
  const launchCommand = sanitizeLaunchCommand(record.launchCommand || record.launch_command)
  const resumeCommand = resumeCommandFor(source, sessionId, cwd, record.resumeCommand || record.resume_command || record.launchCommand || record.launch_command)
  const processId = cleanPositiveInteger(record.processId || record.process_id || record.pid || process.env.AIOPSTERM_AGENT_PID)
  const parentProcessId = cleanPositiveInteger(record.parentProcessId || record.parent_process_id || record.ppid || process.env.PPID)
  const processGroupId = cleanPositiveInteger(record.processGroupId || record.process_group_id || record.pgid)
  const agentLifecycle = normalizeAgentLifecycle(record.agentLifecycle || record.agent_lifecycle || record.lifecycle || record.status)
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
    ...(transcriptPath ? { transcriptPath } : {}),
    ...(requestId ? { requestId } : {}),
    ...(typeof actionable === 'boolean' ? { actionable } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(processId ? { processId } : {}),
    ...(parentProcessId ? { parentProcessId } : {}),
    ...(processGroupId ? { processGroupId } : {}),
    ...(agentLifecycle ? { agentLifecycle } : {})
  }
  return { ok: true, data: normalized }
}

const upsertSessionForEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) => {
  const key = sessionKey(event.source, event.sessionId)
  const existing = sessions.get(key)
  const state = managedAiSessionStateForEvent(event.event, existing?.state, event.agentLifecycle)
  const nextAutoTitle = event.event === 'stop' ? autoTitleFor(event, existing) : existing?.autoTitle
  const title = existing?.userTitle || nextAutoTitle || event.title || existing?.title || sourceLabel(event.source)
  const handledAt = state === 'needsInput' ? undefined : existing?.handledAt
  const pendingRequestId = state === 'needsInput' && event.actionable && event.requestId ? event.requestId : undefined
  const cwd = event.cwd || existing?.cwd
  const launchCommand = event.launchCommand || existing?.launchCommand
  const resumeCommand = event.resumeCommand && event.cwd ? event.resumeCommand : existing?.resumeCommand || resumeCommandFor(event.source, event.sessionId, cwd, launchCommand)
  const processId = event.processId || existing?.processId
  const parentProcessId = event.parentProcessId || existing?.parentProcessId
  const processGroupId = event.processGroupId || existing?.processGroupId
  const agentLifecycle = event.agentLifecycle || existing?.agentLifecycle
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
    ...(cwd ? { cwd } : {}),
    ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
    ...(pendingRequestId ? { pendingRequestId } : {}),
    ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(processId ? { processId } : {}),
    ...(parentProcessId ? { parentProcessId } : {}),
    ...(processGroupId ? { processGroupId } : {}),
    ...(agentLifecycle ? { agentLifecycle } : {}),
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

const isBlockingAgentEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>) =>
  event.source === 'claude-code' &&
  (event.event === 'permission_request' || event.event === 'question') &&
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
    const timeoutMs = normalizeWaitTimeoutMs(raw.waitTimeoutMs || raw.wait_timeout_ms)
    const timer = setTimeout(() => {
      pendingDecisions.delete(key)
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
  const waiter = isBlockingAgentEvent(result.data, raw) ? waitForAgentDecision(result.data, raw) : null
  upsertSessionForEvent(result.data, raw)
  emit?.(result.data)
  if (!waiter) return { ...result, status: 'acknowledged' }
  return waiter
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

const writeSocketResponse = (socket: Socket, response: AgentSessionSocketResponse) => {
  socket.write(`${JSON.stringify(response)}\n`)
}

const handleSocketLine = async (socket: Socket, line: string, emit: AgentSessionEventSink) => {
  try {
    writeSocketResponse(socket, await publishAiAgentSessionSocketEvent(JSON.parse(line) as AiAgentSessionEventInput, emit))
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
  pendingDecisions.forEach((pending) => {
    clearTimeout(pending.timer)
    pending.resolve({ ok: true, status: 'timeout', agentOutput: {} })
  })
  pendingDecisions = new Map()
}

export const __testing = {
  sourceLabel,
  storePathFor,
  managedAiSessionStateForEvent,
  autoTitleFor
}
