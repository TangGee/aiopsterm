import { createHash, randomUUID } from 'crypto'
import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import type {
  AiAgentSessionEvent,
  AiAgentSessionEventInput,
  AiAgentSessionEventName,
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
  ManagedAiSessionLifecycle,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiNotificationClearResult,
  ManagedAiNotificationDismissInput,
  ManagedAiNotificationListInput,
  ManagedAiNotificationListResult,
  ManagedAiNotificationMarkReadInput,
  ManagedAiNotificationMutationResult,
  ManagedAiNotificationOpenInput,
  ManagedAiNotificationRecord,
  ManagedAiNotificationSelectorInput,
  ManagedAiDecisionMode,
  ManagedAiRequestKind,
  ManagedAiSessionRecord,
  ManagedAiSessionRenameInput,
  ManagedAiSessionReplyInput,
  ManagedAiSessionSnapshot,
  ManagedAiSessionState,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'

export type AgentSessionEventSink = (event: AiAgentSessionEvent) => void
export type ManagedAiSessionEventSink = (event: ManagedAiSessionEvent) => void

type AgentSessionSocketResponse = AiAgentSessionEventResult & {
  status?: 'acknowledged' | 'pending' | 'resolved' | 'timeout'
  agentOutput?: Record<string, unknown>
}

export type AgentSessionEventStreamCategory = 'agent' | 'managed-ai'

export type AgentSessionEventStreamFrame = {
  type: 'event'
  protocol: 'aiopsterm-agent-events'
  version: 1
  boot_id: string
  seq: number
  id: string
  name: string
  category: AgentSessionEventStreamCategory
  source: string
  occurred_at: string
  workspace_id?: string
  surface_id?: string
  terminal_session_id?: string
  payload: Record<string, unknown>
}

export type AgentSessionEventStreamListResult = {
  ok: boolean
  data?: {
    protocol: 'aiopsterm-agent-events'
    version: 1
    bootId: string
    afterSeq: number
    oldestSeq: number
    latestSeq: number
    nextSeq: number
    gap: boolean
    events: AgentSessionEventStreamFrame[]
    count: number
  }
  errorCode?: string
  errorMessage?: string
}

type AgentSessionEventStreamFilters = {
  names: Set<string>
  categories: Set<AgentSessionEventStreamCategory>
  includeHeartbeats: boolean
}

type AgentSessionEventStreamSubscriber = {
  id: string
  socket: Socket
  filters: AgentSessionEventStreamFilters
  heartbeat: NodeJS.Timeout | null
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

export type ManagedAiSessionAutoNamingInput = {
  session: ManagedAiSessionRecord
  prompt: string
}

export type ManagedAiSessionAutoNamingRuntime = {
  enabled?: boolean
  minEventGrowth?: number
  minIntervalMs?: number
  maxContextMessages?: number
  emit?: ManagedAiSessionEventSink
  generateTitle?: (input: ManagedAiSessionAutoNamingInput) => Promise<string | null | undefined>
}

type AgentSessionSocketRuntime = {
  userDataPath: string
  emit: AgentSessionEventSink
}

type PersistedManagedAiSessionSnapshot = ManagedAiSessionSnapshot & {
  version?: number
  agentHibernation?: AgentHibernationConfig
}

type ManagedAiSessionAuditKind =
  | 'event.received'
  | 'event.socket.completed'
  | 'decision.created'
  | 'decision.resolved'
  | 'decision.timeout'
  | 'session.renamed'
  | 'session.auto_named'
  | 'session.auto_name_skipped'
  | 'session.cleared'
  | 'session.hibernated'
  | 'session.woke'
  | 'sessions.bulk'
  | 'notification.dismissed'
  | 'notification.opened'
  | 'notification.mark_read'

type ManagedAiSessionAuditEntry = {
  at: number
  kind: ManagedAiSessionAuditKind
  source?: AiAgentSessionSource
  sessionId?: string
  notificationId?: string
  event?: AiAgentSessionEventName
  state?: ManagedAiSessionState
  title?: string
  summary?: string
  requestId?: string
  requestKind?: ManagedAiRequestKind
  decisionMode?: ManagedAiDecisionMode
  waitTimeoutMs?: number
  toolName?: string
  actionable?: boolean
  decisionKind?: ManagedAiSessionDecisionKind
  decisionId?: string
  status?: AgentSessionSocketResponse['status']
  operation?: ManagedAiSessionBulkInput['operation']
  changed?: number
  errorCode?: string
  reason?: string
}

const storeVersion = 1
const maxSessions = 200
const maxEventsPerSession = 200
const maxDecisionsPerSession = 40
const maxRawKeys = 80
const maxStreamEvents = 2000
const streamHeartbeatIntervalMs = 15_000
const defaultDecisionWaitTimeoutMs = 120_000
const maxDecisionWaitTimeoutMs = 125_000
const maxLaunchCommandLength = 600
const defaultAutoTitleMinEventGrowth = 4
const defaultAutoTitleMinIntervalMs = 180_000
const defaultAutoTitleMaxContextMessages = 8
const defaultAgentHibernationConfig: AgentHibernationConfig = {
  enabled: false,
  idleSeconds: 300,
  maxLiveTerminals: 12,
  confirmationSeconds: 60
}
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
let auditPath = ''
let sessions = new Map<string, ManagedAiSessionRecord>()
let agentHibernationConfig: AgentHibernationConfig = { ...defaultAgentHibernationConfig }
let pendingDecisions = new Map<string, PendingAgentDecision>()
let loadedStore = false
let writeQueue: Promise<void> = Promise.resolve()
let auditQueue: Promise<void> = Promise.resolve()
let streamSeq = 0
const streamBootId = randomUUID()
let streamEvents: AgentSessionEventStreamFrame[] = []
let streamSubscribers = new Map<string, AgentSessionEventStreamSubscriber>()
let autoNamingRuntime: Required<Pick<ManagedAiSessionAutoNamingRuntime, 'enabled' | 'minEventGrowth' | 'minIntervalMs' | 'maxContextMessages'>> &
  Pick<ManagedAiSessionAutoNamingRuntime, 'emit' | 'generateTitle'> = {
  enabled: false,
  minEventGrowth: defaultAutoTitleMinEventGrowth,
  minIntervalMs: defaultAutoTitleMinIntervalMs,
  maxContextMessages: defaultAutoTitleMaxContextMessages
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const shellToken = (value: string) => (/^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : shellQuote(value))

const sessionKey = (source: AiAgentSessionSource, id: string) => `${source}:${id}`

const managedAiNotificationId = (source: AiAgentSessionSource, sessionId: string) => `managed-ai:${source}:${sessionId}`

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

const normalizeRequestKind = (value: unknown): ManagedAiRequestKind | undefined => {
  const normalized = cleanText(value).toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return undefined
  if (normalized === 'permission' || normalized === 'approval' || normalized === 'permissionrequest') return 'permission'
  if (normalized === 'question' || normalized === 'askuserquestion' || normalized === 'askuser') return 'question'
  if (normalized === 'plan' || normalized === 'exitplan' || normalized === 'exitplanmode') return 'plan'
  if (normalized === 'notification' || normalized === 'notify') return 'notification'
  if (normalized === 'telemetry' || normalized === 'info' || normalized === 'event') return 'telemetry'
  return undefined
}

const normalizeDecisionMode = (value: unknown): ManagedAiDecisionMode | undefined => {
  const normalized = cleanText(value).toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return undefined
  if (normalized === 'blocking' || normalized === 'wait' || normalized === 'waitdecision' || normalized === 'waitfordecision') return 'blocking'
  if (normalized === 'telemetry' || normalized === 'readonly' || normalized === 'nonblocking') return 'telemetry'
  if (normalized === 'local' || normalized === 'handled' || normalized === 'advisory') return 'local'
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

const firstNestedRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const nested = nestedRecord(record, key)
    if (Object.keys(nested).length) return nested
  }
  return {}
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

const toolNameFor = (input: Record<string, unknown>) =>
  firstText(input, ['toolName', 'tool_name', 'tool', 'name']) || firstText(firstNestedRecord(input, ['tool', 'tool_input', 'toolInput']), ['name', 'toolName', 'tool_name'])

const isExitPlanTool = (toolName?: string) => cleanText(toolName).toLowerCase().replace(/[\s_-]+/g, '') === 'exitplanmode'

const isAskUserQuestionTool = (toolName?: string) => cleanText(toolName).toLowerCase().replace(/[\s_-]+/g, '') === 'askuserquestion'

const requestKindFor = (source: AiAgentSessionSource, event: AiAgentSessionEventName, input: Record<string, unknown>, toolName?: string): ManagedAiRequestKind => {
  const explicit = normalizeRequestKind(input.requestKind || input.request_kind || input.feedKind || input.feed_kind)
  if (explicit) return explicit
  if (event === 'question' || isAskUserQuestionTool(toolName)) return 'question'
  if (isExitPlanTool(toolName)) return 'plan'
  if (event === 'permission_request') return 'permission'
  if (event === 'notification') return 'notification'
  return 'telemetry'
}

const decisionModeFor = (source: AiAgentSessionSource, event: AiAgentSessionEventName, input: Record<string, unknown>, requestKind: ManagedAiRequestKind): ManagedAiDecisionMode => {
  const explicit = normalizeDecisionMode(input.decisionMode || input.decision_mode)
  if (explicit) return explicit
  const waitForDecision = normalizeBoolean(input.actionable ?? input.waitForDecision ?? input.wait_for_decision)
  if (source === 'claude-code' && waitForDecision === true && (requestKind === 'permission' || requestKind === 'question' || requestKind === 'plan')) return 'blocking'
  if (requestKind === 'permission' || requestKind === 'question' || requestKind === 'plan' || requestKind === 'notification') return 'local'
  return 'telemetry'
}

const actionableFor = (source: AiAgentSessionSource, event: AiAgentSessionEventName, input: Record<string, unknown>, requestKind: ManagedAiRequestKind, decisionMode: ManagedAiDecisionMode) => {
  const explicit = normalizeBoolean(input.actionable ?? input.waitForDecision ?? input.wait_for_decision)
  if (source === 'codex' && event === 'permission_request') return false
  if (typeof explicit === 'boolean') return explicit
  if (decisionMode === 'blocking') return true
  return requestKind === 'permission' || requestKind === 'question' || requestKind === 'plan'
}

const managedAiSessionNeedsInputForEvent = (event: Pick<AiAgentSessionEvent, 'source' | 'event' | 'requestKind' | 'decisionMode' | 'actionable'>) => {
  if (event.source === 'codex' && event.event === 'permission_request') return false
  if (event.requestKind === 'telemetry') return false
  if (event.decisionMode === 'blocking') return true
  if (event.requestKind === 'notification') return true
  return event.actionable === true
}

const eventSummary = (event: AiAgentSessionEventName, input: Record<string, unknown>) =>
  firstText(input, ['summary', 'message', 'body', 'text', 'prompt', 'lastAssistantMessage', 'last_assistant_message']) ||
  questionSummary(input) ||
  (event === 'lifecycle' ? cleanText(input.status || input.lifecycle || input.agentLifecycle || input.agent_lifecycle) : '') ||
  (event === 'stop' ? 'Turn complete' : '')

const managedAiSessionStateForEvent = (
  event: AiAgentSessionEventName,
  previous: ManagedAiSessionState = 'unknown',
  lifecycle?: ManagedAiSessionLifecycle,
  aiEvent?: Pick<AiAgentSessionEvent, 'source' | 'event' | 'requestKind' | 'decisionMode' | 'actionable'>
): ManagedAiSessionState => {
  const lifecycleState = stateForAgentLifecycle(lifecycle)
  if (lifecycleState) return lifecycleState
  if (event === 'session_start') return 'idle'
  if (event === 'prompt_submit' || event === 'pre_tool_use') return 'working'
  if (event === 'permission_request' || event === 'question' || event === 'notification') return aiEvent && managedAiSessionNeedsInputForEvent(aiEvent) ? 'needsInput' : 'working'
  if (event === 'stop') return 'idle'
  if (event === 'session_end') return 'ended'
  return previous
}

const compactString = (value: unknown, maxLength = 240) => {
  const text = cleanText(value)
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

const compactAutoTitle = (value: unknown, currentTitle?: string) => {
  const raw = cleanText(value)
  if (!raw) return undefined
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return undefined
  let title = firstLine.replace(/^[`"'\u201c\u201d]+|[`"'\u201c\u201d.。!?！？:：]+$/g, '').trim()
  title = title
    .replace(/\s+/g, ' ')
    .replace(/^title\s*[:：]\s*/i, '')
    .trim()
  if (!title || title === currentTitle) return undefined
  if (title.length > 50) {
    const prefix = title.slice(0, 50)
    const lastSpace = prefix.lastIndexOf(' ')
    title = (lastSpace > 8 ? prefix.slice(0, lastSpace) : prefix).trim()
  }
  return title || undefined
}

const normalizeAutoNamingPositiveInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

export const configureManagedAiSessionAutoNamingRuntime = (config: ManagedAiSessionAutoNamingRuntime = {}) => {
  autoNamingRuntime = {
    enabled: config.enabled === true,
    minEventGrowth: normalizeAutoNamingPositiveInteger(config.minEventGrowth, defaultAutoTitleMinEventGrowth, 1, 100),
    minIntervalMs: normalizeAutoNamingPositiveInteger(config.minIntervalMs, defaultAutoTitleMinIntervalMs, 30_000, 3_600_000),
    maxContextMessages: normalizeAutoNamingPositiveInteger(config.maxContextMessages, defaultAutoTitleMaxContextMessages, 3, 40),
    emit: config.emit,
    generateTitle: config.generateTitle
  }
}

const recentAutoNamingEvents = (session: ManagedAiSessionRecord) => {
  const useful = session.events.filter((event) => {
    if (!event.summary && !event.title && !event.cwd) return false
    if (event.event === 'lifecycle') return false
    return true
  })
  return useful.slice(-autoNamingRuntime.maxContextMessages)
}

const buildAutoNamingPrompt = (session: ManagedAiSessionRecord) => {
  const lines: string[] = [
    'You name AI coding-agent sessions in a terminal workspace.',
    'Return only a short title, 2-5 words, in the same language as the session content.',
    'No quotes, punctuation, markdown, prefixes, or explanation.',
    ''
  ]
  if (session.autoTitle) {
    lines.push(`Current auto title: ${session.autoTitle}`)
    lines.push('If it is still accurate, return it exactly.')
    lines.push('')
  }
  if (session.cwd) lines.push(`Project path: ${session.cwd}`)
  lines.push(`Agent: ${sourceLabel(session.source)}`)
  lines.push('Recent session events:')
  recentAutoNamingEvents(session).forEach((event) => {
    const eventText = [
      event.event,
      event.summary ? compactString(event.summary, 240) : '',
      event.title && event.title !== event.summary ? compactString(event.title, 120) : '',
      event.cwd && event.cwd !== session.cwd ? `cwd=${event.cwd}` : ''
    ]
      .filter(Boolean)
      .join(' | ')
    if (eventText) lines.push(`- ${eventText}`)
  })
  return lines.join('\n')
}

const autoNamingSkipAudit = (session: ManagedAiSessionRecord, reason: string, at = Date.now()) => {
  appendManagedAiSessionAudit({
    at,
    kind: 'session.auto_name_skipped',
    source: session.source,
    sessionId: session.id,
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary,
    reason
  })
}

const updateAutoNamingAttempt = (session: ManagedAiSessionRecord, attemptedAt: number, eventCount: number) => {
  const key = sessionKey(session.source, session.id)
  const current = sessions.get(key)
  if (!current || current.userTitle) return null
  const next = {
    ...current,
    autoTitleAttemptedAt: attemptedAt,
    autoTitleEventCount: eventCount,
    updatedAt: attemptedAt
  }
  sessions.set(key, next)
  persistSnapshot()
  return next
}

const applyAutoNamingTitle = (session: ManagedAiSessionRecord, title: string, generatedAt: number, eventCount: number) => {
  const key = sessionKey(session.source, session.id)
  const current = sessions.get(key)
  if (!current || current.userTitle) return null
  const next = {
    ...current,
    title,
    autoTitle: title,
    autoTitleGeneratedAt: generatedAt,
    autoTitleAttemptedAt: generatedAt,
    autoTitleEventCount: eventCount,
    updatedAt: generatedAt
  }
  sessions.set(key, next)
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: generatedAt,
    kind: 'session.auto_named',
    source: next.source,
    sessionId: next.id,
    event: next.lastEvent,
    state: next.state,
    title: next.title,
    summary: next.summary
  })
  publishManagedAiStreamFrame('managed_ai.session.renamed', next, { title: next.title, auto: true })
  return next
}

const shouldRunAutoNaming = (session: ManagedAiSessionRecord, event: AiAgentSessionEvent) => {
  if (!autoNamingRuntime.enabled) return 'disabled'
  if (event.event !== 'stop') return 'not-stop'
  if (session.userTitle) return 'manual-title'
  if (typeof autoNamingRuntime.generateTitle !== 'function') return 'missing-generator'
  if (session.events.length < 2) return 'too-short'
  if (!recentAutoNamingEvents(session).length) return 'no-context'
  const now = Date.now()
  if (session.autoTitleAttemptedAt && now - session.autoTitleAttemptedAt < autoNamingRuntime.minIntervalMs) return 'too-soon'
  if (session.autoTitleEventCount && session.events.length - session.autoTitleEventCount < autoNamingRuntime.minEventGrowth) return 'insufficient-growth'
  return ''
}

const maybeRunAutoNaming = (session: ManagedAiSessionRecord, event: AiAgentSessionEvent) => {
  const skipReason = shouldRunAutoNaming(session, event)
  if (skipReason) {
    if (skipReason !== 'disabled' && skipReason !== 'not-stop') autoNamingSkipAudit(session, skipReason)
    return
  }
  const eventCount = session.events.length
  const attemptedAt = Date.now()
  const attempting = updateAutoNamingAttempt(session, attemptedAt, eventCount)
  if (!attempting) return
  const prompt = buildAutoNamingPrompt(attempting)
  void autoNamingRuntime
    .generateTitle!({ session: attempting, prompt })
    .then((rawTitle) => {
      const title = compactAutoTitle(rawTitle, attempting.autoTitle || attempting.title)
      if (!title) {
        autoNamingSkipAudit(attempting, 'empty-title')
        return
      }
      applyAutoNamingTitle(attempting, title, Date.now(), eventCount)
    })
    .catch(() => {
      autoNamingSkipAudit(attempting, 'generator-error')
    })
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

const socketWriteJsonLine = (socket: Socket, value: unknown) => {
  socket.write(`${JSON.stringify(value)}\n`)
}

const normalizeStreamName = (event: AiAgentSessionEventName) =>
  event
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join('')

const compactStreamPayload = (value: Record<string, unknown>) => compactRawValue(value, 0) as Record<string, unknown>

const eventStreamFrame = (
  input: Omit<AgentSessionEventStreamFrame, 'type' | 'protocol' | 'version' | 'boot_id' | 'seq' | 'id' | 'occurred_at'>
): AgentSessionEventStreamFrame => {
  streamSeq += 1
  return {
    type: 'event',
    protocol: 'aiopsterm-agent-events',
    version: 1,
    boot_id: streamBootId,
    seq: streamSeq,
    id: `${streamBootId}-${streamSeq}`,
    occurred_at: new Date().toISOString(),
    ...input,
    payload: compactStreamPayload(input.payload)
  }
}

const streamMatches = (frame: AgentSessionEventStreamFrame, filters: AgentSessionEventStreamFilters) =>
  (!filters.names.size || filters.names.has(frame.name)) && (!filters.categories.size || filters.categories.has(frame.category))

const publishStreamFrame = (frame: AgentSessionEventStreamFrame) => {
  streamEvents.push(frame)
  if (streamEvents.length > maxStreamEvents) streamEvents = streamEvents.slice(-maxStreamEvents)
  streamSubscribers.forEach((subscriber) => {
    if (!streamMatches(frame, subscriber.filters)) return
    socketWriteJsonLine(subscriber.socket, frame)
  })
}

const publishAgentEventStreamFrame = (event: AiAgentSessionEvent, session: ManagedAiSessionRecord) => {
  publishStreamFrame(
    eventStreamFrame({
      name: `agent.hook.${normalizeStreamName(event.event)}`,
      category: 'agent',
      source: event.source,
      workspace_id: event.workspaceId,
      surface_id: event.panelId,
      terminal_session_id: event.terminalSessionId,
      payload: {
        source: event.source,
        event: event.event,
        sessionId: event.sessionId,
        title: session.title,
        summary: event.summary,
        state: session.state,
        requestId: event.requestId,
        requestKind: event.requestKind,
        decisionMode: event.decisionMode,
        waitTimeoutMs: event.waitTimeoutMs,
        toolName: event.toolName,
        actionable: event.actionable,
        cwd: event.cwd,
        transcriptPath: event.transcriptPath,
        processId: event.processId,
        agentLifecycle: event.agentLifecycle
      }
    })
  )
}

const publishManagedAiStreamFrame = (name: string, session: ManagedAiSessionRecord | null, payload: Record<string, unknown>) => {
  const frame = eventStreamFrame({
    name,
    category: 'managed-ai',
    source: session?.source || 'aiopsterm',
    workspace_id: session?.workspaceId,
    surface_id: session?.panelId,
    terminal_session_id: session?.terminalSessionId,
    payload: {
      ...(session
        ? {
            source: session.source,
            sessionId: session.id,
            title: session.title,
            state: session.state,
            lastEvent: session.lastEvent,
            requestKind: session.requestKind,
            decisionMode: session.decisionMode,
            waitTimeoutMs: session.waitTimeoutMs,
            toolName: session.toolName
          }
        : {}),
      ...payload
    }
  })
  publishStreamFrame(frame)
  autoNamingRuntime.emit?.({
    name: frame.name,
    category: 'managed-ai',
    source: frame.source,
    sessionId: cleanOptionalText(frame.payload.sessionId),
    title: cleanOptionalText(frame.payload.title),
    state:
      frame.payload.state === 'idle' || frame.payload.state === 'working' || frame.payload.state === 'needsInput' || frame.payload.state === 'ended' || frame.payload.state === 'unknown'
        ? frame.payload.state
        : undefined,
    payload: frame.payload,
    seq: frame.seq
  })
}

const cleanStringSet = (value: unknown) => {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return new Set(values.map(cleanText).filter(Boolean))
}

const normalizeStreamLimit = (value: unknown) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 100
  return Math.max(1, Math.min(500, Math.floor(number)))
}

const normalizeStreamCategories = (value: unknown) => {
  const raw = cleanStringSet(value)
  const categories = new Set<AgentSessionEventStreamCategory>()
  raw.forEach((item) => {
    if (item === 'agent' || item === 'managed-ai') categories.add(item)
  })
  return categories
}

const streamParamsFrom = (record: Record<string, unknown>) => {
  const params = isRecord(record.params) ? record.params : record
  const after =
    typeof params.after_seq === 'number'
      ? params.after_seq
      : typeof params.afterSeq === 'number'
        ? params.afterSeq
        : typeof params.after === 'number'
          ? params.after
          : 0
  return {
    afterSeq: Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0,
    filters: {
      names: cleanStringSet(params.names || params.name),
      categories: normalizeStreamCategories(params.categories || params.category),
      includeHeartbeats: params.include_heartbeats === false || params.includeHeartbeats === false ? false : true
    } satisfies AgentSessionEventStreamFilters
  }
}

const closeStreamSubscriber = (id: string) => {
  const subscriber = streamSubscribers.get(id)
  if (!subscriber) return
  if (subscriber.heartbeat) clearInterval(subscriber.heartbeat)
  streamSubscribers.delete(id)
}

const startEventStream = (socket: Socket, request: Record<string, unknown>) => {
  const { afterSeq, filters } = streamParamsFrom(request)
  const subscriberId = randomUUID()
  const oldestSeq = streamEvents[0]?.seq || streamSeq + 1
  const replay = streamEvents.filter((frame) => frame.seq > afterSeq && streamMatches(frame, filters))
  const subscriber: AgentSessionEventStreamSubscriber = {
    id: subscriberId,
    socket,
    filters,
    heartbeat: null
  }
  streamSubscribers.set(subscriberId, subscriber)
  socketWriteJsonLine(socket, {
    type: 'ack',
    protocol: 'aiopsterm-agent-events',
    version: 1,
    boot_id: streamBootId,
    subscription_id: subscriberId,
    heartbeat_interval_seconds: streamHeartbeatIntervalMs / 1000,
    replay_count: replay.length,
    resume: {
      after_seq: afterSeq,
      requested_after_seq: afterSeq,
      oldest_seq: oldestSeq,
      latest_seq: streamSeq,
      next_seq: streamSeq + 1,
      gap: afterSeq > 0 && afterSeq < oldestSeq
    },
    filters: {
      names: [...filters.names],
      categories: [...filters.categories]
    }
  })
  replay.forEach((frame) => socketWriteJsonLine(socket, frame))
  if (filters.includeHeartbeats) {
    subscriber.heartbeat = setInterval(() => {
      if (socket.destroyed) {
        closeStreamSubscriber(subscriberId)
        return
      }
      socketWriteJsonLine(socket, {
        type: 'heartbeat',
        protocol: 'aiopsterm-agent-events',
        version: 1,
        boot_id: streamBootId,
        subscription_id: subscriberId,
        latest_seq: streamSeq,
        occurred_at: new Date().toISOString()
      })
    }, streamHeartbeatIntervalMs)
    subscriber.heartbeat.unref()
  }
  socket.on('close', () => closeStreamSubscriber(subscriberId))
  socket.on('error', () => closeStreamSubscriber(subscriberId))
}

export const listManagedAiSessionEvents = (input: Record<string, unknown> = {}): AgentSessionEventStreamListResult => {
  const { afterSeq, filters } = streamParamsFrom(input)
  const limit = normalizeStreamLimit(input.limit)
  const sourceFilter = cleanStringSet(input.sources || input.source)
  const sessionFilter = cleanStringSet(input.sessionIds || input.session_ids || input.sessionId || input.session_id)
  const oldestSeq = streamEvents[0]?.seq || streamSeq + 1
  const events = streamEvents
    .filter((frame) => {
      if (frame.seq <= afterSeq || !streamMatches(frame, filters)) return false
      const source = cleanText(frame.payload.source || frame.source)
      const sessionId = cleanText(frame.payload.sessionId || frame.payload.session_id)
      if (sourceFilter.size && !sourceFilter.has(source)) return false
      if (sessionFilter.size && !sessionFilter.has(sessionId)) return false
      return true
    })
    .slice(0, limit)
  return {
    ok: true,
    data: {
      protocol: 'aiopsterm-agent-events',
      version: 1,
      bootId: streamBootId,
      afterSeq,
      oldestSeq,
      latestSeq: streamSeq,
      nextSeq: streamSeq + 1,
      gap: afterSeq > 0 && afterSeq < oldestSeq,
      events,
      count: events.length
    }
  }
}

const auditPathFor = (userDataPath: string) => join(userDataPath, 'agent-sessions', 'managed-ai-sessions.audit.jsonl')

const appendManagedAiSessionAudit = (entry: ManagedAiSessionAuditEntry) => {
  if (!auditPath) return
  const targetAuditPath = auditPath
  const line = {
    ...entry,
    at: entry.at || Date.now(),
    title: compactString(entry.title, 120),
    summary: compactString(entry.summary, 240)
  }
  auditQueue = auditQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(targetAuditPath), { recursive: true })
      await appendFile(targetAuditPath, `${JSON.stringify(line)}\n`, 'utf-8')
    })
    .catch(() => undefined)
}

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
  requestKind: event.requestKind || 'telemetry',
  decisionMode: event.decisionMode || 'telemetry',
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
  const latestEvent = events.at(-1) as ManagedAiSessionTimelineEvent | undefined
  const storedToolName = cleanOptionalText(value.toolName || value.tool_name)
  const requestKind = normalizeRequestKind(value.requestKind || value.request_kind) || latestEvent?.requestKind || requestKindFor(source, lastEvent, value, storedToolName)
  const decisionMode = normalizeDecisionMode(value.decisionMode || value.decision_mode) || latestEvent?.decisionMode || decisionModeFor(source, lastEvent, value, requestKind)
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
    ...(typeof value.autoTitleEventCount === 'number' && Number.isFinite(value.autoTitleEventCount)
      ? { autoTitleEventCount: Math.max(0, Math.floor(value.autoTitleEventCount)) }
      : {}),
    ...(typeof value.autoTitleAttemptedAt === 'number' && Number.isFinite(value.autoTitleAttemptedAt) ? { autoTitleAttemptedAt: value.autoTitleAttemptedAt } : {}),
    ...(typeof value.autoTitleGeneratedAt === 'number' && Number.isFinite(value.autoTitleGeneratedAt) ? { autoTitleGeneratedAt: value.autoTitleGeneratedAt } : {}),
    ...(cleanOptionalText(value.panelId) ? { panelId: cleanOptionalText(value.panelId) } : {}),
    ...(cleanOptionalText(value.terminalSessionId) ? { terminalSessionId: cleanOptionalText(value.terminalSessionId) } : {}),
    ...(cleanOptionalText(value.workspaceId) ? { workspaceId: cleanOptionalText(value.workspaceId) } : {}),
    ...(cleanOptionalText(value.cwd) ? { cwd: cleanOptionalText(value.cwd) } : {}),
    ...(cleanOptionalText(value.transcriptPath) ? { transcriptPath: cleanOptionalText(value.transcriptPath) } : {}),
    ...(cleanOptionalText(value.pendingRequestId) ? { pendingRequestId: cleanOptionalText(value.pendingRequestId) } : {}),
    requestKind,
    decisionMode,
    ...(cleanPositiveInteger(value.waitTimeoutMs || value.wait_timeout_ms) ? { waitTimeoutMs: cleanPositiveInteger(value.waitTimeoutMs || value.wait_timeout_ms) } : latestEvent?.waitTimeoutMs ? { waitTimeoutMs: latestEvent.waitTimeoutMs } : {}),
    ...(storedToolName ? { toolName: storedToolName } : latestEvent?.toolName ? { toolName: latestEvent.toolName } : {}),
    ...(typeof value.actionable === 'boolean' ? { actionable: value.actionable } : {}),
    ...(cleanOptionalText(value.launchCommand) ? { launchCommand: cleanOptionalText(value.launchCommand) } : {}),
    ...(cleanOptionalText(value.resumeCommand) ? { resumeCommand: cleanOptionalText(value.resumeCommand) } : {}),
    ...(cleanPositiveInteger(value.processId) ? { processId: cleanPositiveInteger(value.processId) } : {}),
    ...(cleanPositiveInteger(value.parentProcessId) ? { parentProcessId: cleanPositiveInteger(value.parentProcessId) } : {}),
    ...(cleanPositiveInteger(value.processGroupId) ? { processGroupId: cleanPositiveInteger(value.processGroupId) } : {}),
    ...(normalizeAgentLifecycle(value.agentLifecycle) ? { agentLifecycle: normalizeAgentLifecycle(value.agentLifecycle) } : {}),
    ...(cleanPositiveInteger(value.terminalProcessId) ? { terminalProcessId: cleanPositiveInteger(value.terminalProcessId) } : {}),
    ...(typeof value.terminalActivityAt === 'number' ? { terminalActivityAt: value.terminalActivityAt } : {}),
    ...(value.hibernated === true ? { hibernated: true } : {}),
    ...(typeof value.hibernatedAt === 'number' && Number.isFinite(value.hibernatedAt) ? { hibernatedAt: value.hibernatedAt } : {}),
    ...(cleanOptionalText(value.hibernationReason) ? { hibernationReason: cleanOptionalText(value.hibernationReason) } : {}),
    ...(cleanOptionalText(value.hibernatedTerminalSessionId) ? { hibernatedTerminalSessionId: cleanOptionalText(value.hibernatedTerminalSessionId) } : {}),
    events: events.slice(-maxEventsPerSession) as ManagedAiSessionTimelineEvent[],
    decisions: decisions.slice(-maxDecisionsPerSession) as ManagedAiSessionDecision[]
  }
}

const normalizeStoredTimelineEvent = (value: Record<string, unknown>, fallbackSource: AiAgentSessionSource, fallbackSessionId: string) => {
  const source = normalizeSource(value.source) || fallbackSource
  const event = normalizeEventName(value.event)
  if (!event) return null
  const receivedAt = typeof value.receivedAt === 'number' ? value.receivedAt : Date.now()
  const toolName = cleanOptionalText(value.toolName || value.tool_name)
  const requestKind = normalizeRequestKind(value.requestKind || value.request_kind) || requestKindFor(source, event, value, toolName)
  const decisionMode = normalizeDecisionMode(value.decisionMode || value.decision_mode) || decisionModeFor(source, event, value, requestKind)
  return {
    source,
    event,
    sessionId: cleanOptionalText(value.sessionId) || fallbackSessionId,
    title: cleanOptionalText(value.title) || sourceLabel(source),
    summary: cleanOptionalText(value.summary) || '',
    receivedAt,
    id: cleanOptionalText(value.id) || `${receivedAt}-${randomUUID()}`,
    requestKind,
    decisionMode,
    ...(cleanOptionalText(value.panelId) ? { panelId: cleanOptionalText(value.panelId) } : {}),
    ...(cleanOptionalText(value.terminalSessionId) ? { terminalSessionId: cleanOptionalText(value.terminalSessionId) } : {}),
    ...(cleanOptionalText(value.workspaceId) ? { workspaceId: cleanOptionalText(value.workspaceId) } : {}),
    ...(cleanOptionalText(value.cwd) ? { cwd: cleanOptionalText(value.cwd) } : {}),
    ...(cleanOptionalText(value.transcriptPath) ? { transcriptPath: cleanOptionalText(value.transcriptPath) } : {}),
    ...(cleanOptionalText(value.requestId) ? { requestId: cleanOptionalText(value.requestId) } : {}),
    ...(cleanPositiveInteger(value.waitTimeoutMs || value.wait_timeout_ms) ? { waitTimeoutMs: cleanPositiveInteger(value.waitTimeoutMs || value.wait_timeout_ms) } : {}),
    ...(toolName ? { toolName } : {}),
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

const normalizeHibernationNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(numberValue)))
}

const normalizeAgentHibernationConfig = (value: unknown, fallback: AgentHibernationConfig = agentHibernationConfig): AgentHibernationConfig => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : fallback.enabled,
    idleSeconds: normalizeHibernationNumber(record.idleSeconds, fallback.idleSeconds, 5, 604800),
    maxLiveTerminals: normalizeHibernationNumber(record.maxLiveTerminals, fallback.maxLiveTerminals, 1, 256),
    confirmationSeconds: normalizeHibernationNumber(record.confirmationSeconds, fallback.confirmationSeconds, 0, 3600)
  }
}

const persistSnapshot = () => {
  if (!storePath) return
  const targetStorePath = storePath
  const payload: PersistedManagedAiSessionSnapshot = {
    version: storeVersion,
    agentHibernation: agentHibernationConfig,
    ...snapshot()
  }
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(targetStorePath), { recursive: true })
      await writeFile(targetStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    })
}

const loadStoreIfNeeded = async () => {
  if (loadedStore || !storePath) return
  loadedStore = true
  if (!existsSync(storePath)) return
  try {
    const raw = String(await readFile(storePath, 'utf-8'))
    const parsed = JSON.parse(raw) as PersistedManagedAiSessionSnapshot
    agentHibernationConfig = normalizeAgentHibernationConfig(parsed.agentHibernation, defaultAgentHibernationConfig)
    const loaded = Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeStoredSession).filter(Boolean) : []
    sessions = new Map((loaded as ManagedAiSessionRecord[]).map((session) => [sessionKey(session.source, session.id), session]))
  } catch {
    sessions = new Map()
    agentHibernationConfig = { ...defaultAgentHibernationConfig }
  }
}

const storePathFor = (userDataPath: string) => join(userDataPath, 'agent-sessions', 'managed-ai-sessions.json')

export const configureAiAgentSessionStore = async (userDataPath: string) => {
  const nextStorePath = storePathFor(userDataPath)
  const nextAuditPath = auditPathFor(userDataPath)
  if (storePath !== nextStorePath) {
    storePath = nextStorePath
    auditPath = nextAuditPath
    loadedStore = false
    sessions = new Map()
    agentHibernationConfig = { ...defaultAgentHibernationConfig }
  } else {
    auditPath = nextAuditPath
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
  const toolName = toolNameFor(record)
  const requestKind = requestKindFor(source, event, record, toolName)
  const decisionMode = decisionModeFor(source, event, record, requestKind)
  const waitTimeoutInput = record.waitTimeoutMs ?? record.wait_timeout_ms
  const waitTimeoutMs = decisionMode === 'blocking' || waitTimeoutInput !== undefined ? normalizeWaitTimeoutMs(waitTimeoutInput) : undefined
  const actionable = actionableFor(source, event, record, requestKind, decisionMode)
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
    requestKind,
    decisionMode,
    ...(waitTimeoutMs ? { waitTimeoutMs } : {}),
    ...(toolName ? { toolName } : {}),
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
  const launchCommand = event.launchCommand || existing?.launchCommand
  const resumeCommand = event.resumeCommand && event.cwd ? event.resumeCommand : existing?.resumeCommand || resumeCommandFor(event.source, event.sessionId, cwd, launchCommand)
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
    ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
    ...(pendingRequestId ? { pendingRequestId } : {}),
    requestKind,
    decisionMode,
    ...(waitTimeoutMs ? { waitTimeoutMs } : {}),
    ...(toolName ? { toolName } : {}),
    ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
    ...(launchCommand ? { launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(processId ? { processId } : {}),
    ...(parentProcessId ? { parentProcessId } : {}),
    ...(processGroupId ? { processGroupId } : {}),
    ...(agentLifecycle ? { agentLifecycle } : {}),
    ...(preserveHibernation ? { hibernated: true } : {}),
    ...(preserveHibernation && existing?.hibernatedAt ? { hibernatedAt: existing.hibernatedAt } : {}),
    ...(preserveHibernation && existing?.hibernationReason ? { hibernationReason: existing.hibernationReason } : {}),
    ...(preserveHibernation && existing?.hibernatedTerminalSessionId ? { hibernatedTerminalSessionId: existing.hibernatedTerminalSessionId } : {}),
    events: [...(existing?.events || []), normalizeRecordEvent(event, raw)].slice(-maxEventsPerSession),
    decisions: [...(existing?.decisions || [])].slice(-maxDecisionsPerSession)
  }
  sessions.set(key, record)
  const ordered = [...sessions.values()].sort((first, second) => second.lastActivityAt - first.lastActivityAt)
  sessions = new Map(ordered.slice(0, maxSessions).map((session) => [sessionKey(session.source, session.id), session]))
  persistSnapshot()
  auditEventReceived(event, record)
  publishAgentEventStreamFrame(event, record)
  maybeRunAutoNaming(record, event)
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
  const waiter = isBlockingAgentEvent(result.data, raw) ? waitForAgentDecision(result.data, raw) : null
  upsertSessionForEvent(result.data, raw)
  emit?.(result.data)
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
  return { ok: true, data: snapshot() }
}

export const listManagedAiNotifications = async (input: ManagedAiNotificationListInput = {}): Promise<ManagedAiNotificationListResult> => {
  await loadStoreIfNeeded()
  return { ok: true, data: listManagedAiNotificationPayload(input) }
}

const mutationError = (errorCode: string, errorMessage: string): ManagedAiSessionMutationResult => ({ ok: false, errorCode, errorMessage })

const bulkError = (errorCode: string, errorMessage: string): ManagedAiSessionBulkResult => ({ ok: false, errorCode, errorMessage })

const hibernationError = (errorCode: string, errorMessage: string): ManagedAiSessionHibernateResult => ({ ok: false, errorCode, errorMessage })

const notificationMutationError = (errorCode: string, errorMessage: string): ManagedAiNotificationMutationResult => ({ ok: false, errorCode, errorMessage })

const notificationClearError = (errorCode: string, errorMessage: string): ManagedAiNotificationClearResult => ({ ok: false, errorCode, errorMessage })

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
  agentHibernationConfig = normalizeAgentHibernationConfig(input)
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
  if (!session.resumeCommand) return hibernationError('AGENT_HIBERNATION_RESUME_UNAVAILABLE', 'Managed AI session has no resume command.')
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

const notificationReadStateForSession = (session: ManagedAiSessionRecord) => session.state !== 'needsInput' || Boolean(session.handledAt)

const notificationForSession = (session: ManagedAiSessionRecord): ManagedAiNotificationRecord => {
  const read = notificationReadStateForSession(session)
  return {
    id: managedAiNotificationId(session.source, session.id),
    source: session.source,
    sessionId: session.id,
    title: session.title,
    summary: session.summary,
    body: session.summary,
    state: session.state,
    event: session.lastEvent,
    read,
    isRead: read,
    needsInput: session.state === 'needsInput',
    requestKind: session.requestKind,
    decisionMode: session.decisionMode,
    ...(session.waitTimeoutMs ? { waitTimeoutMs: session.waitTimeoutMs } : {}),
    ...(session.toolName ? { toolName: session.toolName } : {}),
    ...(typeof session.actionable === 'boolean' ? { actionable: session.actionable } : {}),
    ...(session.pendingRequestId ? { pendingRequestId: session.pendingRequestId } : {}),
    ...(session.panelId ? { panelId: session.panelId } : {}),
    ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.handledAt ? { readAt: session.handledAt } : {})
  }
}

const allManagedAiNotifications = () => snapshot().sessions.map(notificationForSession)

const normalizeNotificationLimit = (value: unknown) => Math.min(cleanPositiveInteger(value) || 50, maxSessions)

const listManagedAiNotificationPayload = (input: ManagedAiNotificationListInput = {}) => {
  const source = normalizeSource(input.source)
  const query = cleanText(input.query).toLowerCase()
  const unreadOnly = input.unread === true && input.read !== true
  const readOnly = input.read === true && input.unread !== true
  const limit = normalizeNotificationLimit(input.limit)
  const all = allManagedAiNotifications()
  const filtered = all.filter((notification) => {
    if (source && notification.source !== source) return false
    if (unreadOnly && notification.read) return false
    if (readOnly && !notification.read) return false
    if (!query) return true
    return [
      notification.id,
      notification.source,
      notification.sessionId,
      notification.title,
      notification.summary,
      notification.cwd || '',
      notification.panelId || '',
      notification.terminalSessionId || ''
    ].some((value) => value.toLowerCase().includes(query))
  })
  return {
    notifications: filtered.slice(0, limit),
    count: filtered.length,
    total: all.length,
    unreadCount: all.filter((notification) => !notification.read).length
  }
}

const notificationPartsFromId = (id: string) => {
  const match = id.match(/^managed-ai:([^:]+):(.+)$/)
  if (!match) return null
  const source = normalizeSource(match[1])
  const sessionId = cleanOptionalText(match[2])
  return source && sessionId ? { source, sessionId } : null
}

const resolveNotificationSession = (input: ManagedAiNotificationSelectorInput = {}) => {
  const id = cleanText(input.id)
  if (id.startsWith('managed-ai:') && !notificationPartsFromId(id)) {
    return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_ID_INVALID', 'Managed AI notification id is invalid.') }
  }
  const parsed = notificationPartsFromId(id)
  const source = parsed?.source || normalizeSource(input.source)
  const sessionId = parsed?.sessionId || cleanOptionalText(input.sessionId) || (!id.startsWith('managed-ai:') ? cleanOptionalText(id) : undefined)
  if (source && sessionId) {
    const session = sessions.get(sessionKey(source, sessionId))
    if (!session) return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_NOT_FOUND', 'Managed AI notification was not found.') }
    return { session }
  }
  if (sessionId) {
    const matches = [...sessions.values()].filter((session) => session.id === sessionId)
    if (!matches.length) return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_NOT_FOUND', 'Managed AI notification was not found.') }
    if (matches.length > 1) {
      return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_SOURCE_REQUIRED', 'Multiple managed AI notifications match this sessionId; pass source.') }
    }
    return { session: matches[0] }
  }
  return { error: notificationMutationError('MANAGED_AI_NOTIFICATION_SELECTOR_REQUIRED', 'Managed AI notification id or sessionId is required.') }
}

const focusRequestForSession = (session: ManagedAiSessionRecord) => ({
  source: session.source,
  sessionId: session.id,
  ...(session.panelId ? { panelId: session.panelId } : {}),
  ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {})
})

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
  await loadStoreIfNeeded()
  if (input?.all === true) {
    const result = await bulkManagedAiSessions({ operation: 'mark-handled' })
    if (!result.ok || !result.data) return notificationMutationError(result.errorCode || 'MANAGED_AI_NOTIFICATION_MARK_READ_FAILED', result.errorMessage || 'Managed AI notification mark read failed.')
    appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'notification.mark_read',
      changed: result.data.changed
    })
    publishManagedAiStreamFrame('managed_ai.notification.mark_read', null, {
      changed: result.data.changed,
      all: true
    })
    return {
      ok: true,
      data: {
        changed: result.data.changed,
        notifications: listManagedAiNotificationPayload().notifications,
        snapshot: result.data.snapshot
      }
    }
  }

  const resolved = resolveNotificationSession(input || {})
  if (resolved.error) return resolved.error
  const session = resolved.session!
  if (notificationReadStateForSession(session)) {
    return {
      ok: true,
      data: {
        changed: 0,
        notification: notificationForSession(session),
        notifications: listManagedAiNotificationPayload().notifications,
        snapshot: snapshot()
      }
    }
  }
  const result = await replyManagedAiSession({ source: session.source, sessionId: session.id, kind: 'handled' })
  if (!result.ok || !result.data) return notificationMutationError(result.errorCode || 'MANAGED_AI_NOTIFICATION_MARK_READ_FAILED', result.errorMessage || 'Managed AI notification mark read failed.')
  const next = result.data.session || getSessionForInput(session.source, session.id) || session
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'notification.mark_read',
    source: session.source,
    sessionId: session.id,
    notificationId: managedAiNotificationId(session.source, session.id),
    changed: 1
  })
  publishManagedAiStreamFrame('managed_ai.notification.mark_read', next, {
    notificationId: managedAiNotificationId(session.source, session.id),
    changed: 1
  })
  return {
    ok: true,
    data: {
      changed: 1,
      notification: notificationForSession(next),
      notifications: listManagedAiNotificationPayload().notifications,
      snapshot: result.data.snapshot
    }
  }
}

export const dismissManagedAiNotification = async (input: ManagedAiNotificationDismissInput): Promise<ManagedAiNotificationMutationResult> => {
  await loadStoreIfNeeded()
  if (input?.allRead === true || input?.all_read === true) {
    const readSessions = snapshot().sessions.filter((session) => notificationReadStateForSession(session))
    let changed = 0
    readSessions.forEach((session) => {
      if (!sessions.delete(sessionKey(session.source, session.id))) return
      changed += 1
    })
    if (changed) persistSnapshot()
    appendManagedAiSessionAudit({
      at: Date.now(),
      kind: 'notification.dismissed',
      changed
    })
    publishManagedAiStreamFrame('managed_ai.notification.dismissed', null, {
      changed,
      allRead: true
    })
    return {
      ok: true,
      data: {
        changed,
        notifications: listManagedAiNotificationPayload().notifications,
        snapshot: snapshot()
      }
    }
  }

  const resolved = resolveNotificationSession(input || {})
  if (resolved.error) return resolved.error
  const session = resolved.session!
  if (!notificationReadStateForSession(session)) {
    return notificationMutationError('MANAGED_AI_NOTIFICATION_UNREAD', 'Unread managed AI notification must be marked read before dismissing.')
  }
  sessions.delete(sessionKey(session.source, session.id))
  persistSnapshot()
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'notification.dismissed',
    source: session.source,
    sessionId: session.id,
    notificationId: managedAiNotificationId(session.source, session.id),
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary,
    changed: 1
  })
  publishManagedAiStreamFrame('managed_ai.notification.dismissed', session, {
    notificationId: managedAiNotificationId(session.source, session.id),
    changed: 1
  })
  return {
    ok: true,
    data: {
      changed: 1,
      notification: notificationForSession(session),
      notifications: listManagedAiNotificationPayload().notifications,
      snapshot: snapshot()
    }
  }
}

export const clearManagedAiNotifications = async (): Promise<ManagedAiNotificationClearResult> => {
  await loadStoreIfNeeded()
  const result = await bulkManagedAiSessions({ operation: 'clear-all' })
  if (!result.ok || !result.data) {
    return notificationClearError(result.errorCode || 'MANAGED_AI_NOTIFICATIONS_CLEAR_FAILED', result.errorMessage || 'Managed AI notifications clear failed.')
  }
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'notification.dismissed',
    changed: result.data.changed
  })
  publishManagedAiStreamFrame('managed_ai.notification.cleared', null, {
    changed: result.data.changed
  })
  return {
    ok: true,
    data: {
      changed: result.data.changed,
      notifications: [],
      snapshot: result.data.snapshot
    }
  }
}

export const openManagedAiNotification = async (input: ManagedAiNotificationOpenInput): Promise<ManagedAiNotificationMutationResult> => {
  await loadStoreIfNeeded()
  const resolved = resolveNotificationSession(input || {})
  if (resolved.error) return resolved.error
  const session = resolved.session!
  const focusRequest = focusRequestForSession(session)
  appendManagedAiSessionAudit({
    at: Date.now(),
    kind: 'notification.opened',
    source: session.source,
    sessionId: session.id,
    notificationId: managedAiNotificationId(session.source, session.id),
    event: session.lastEvent,
    state: session.state,
    title: session.title,
    summary: session.summary
  })
  publishManagedAiStreamFrame('managed_ai.notification.opened', session, {
    notificationId: managedAiNotificationId(session.source, session.id)
  })
  return {
    ok: true,
    data: {
      changed: 0,
      notification: notificationForSession(session),
      notifications: listManagedAiNotificationPayload().notifications,
      snapshot: snapshot(),
      focusRequest
    }
  }
}

export const jumpToUnreadManagedAiNotification = async (): Promise<ManagedAiNotificationMutationResult> => {
  await loadStoreIfNeeded()
  const notification = listManagedAiNotificationPayload({ unread: true, limit: 1 }).notifications[0]
  if (!notification) {
    return {
      ok: true,
      data: {
        changed: 0,
        notifications: listManagedAiNotificationPayload().notifications,
        snapshot: snapshot()
      }
    }
  }
  return openManagedAiNotification({ id: notification.id })
}

const writeSocketResponse = (socket: Socket, response: AgentSessionSocketResponse) => {
  socketWriteJsonLine(socket, response)
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
      startEventStream(socket, parsed)
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
  streamSubscribers.forEach((subscriber) => {
    if (subscriber.heartbeat) clearInterval(subscriber.heartbeat)
    subscriber.socket.destroy()
  })
  streamSubscribers = new Map()
}

export const __testing = {
  sourceLabel,
  storePathFor,
  auditPathFor,
  managedAiSessionStateForEvent,
  autoTitleFor,
  streamBootId,
  streamEventCount: () => streamEvents.length,
  streamLatestSeq: () => streamSeq,
  flushManagedAiSessionWrites: async () => {
    await writeQueue
    await auditQueue
  }
}
