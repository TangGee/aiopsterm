import { createHash, randomUUID } from 'crypto'
import { realpathSync } from 'fs'
import type {
  AiAgentSessionEvent,
  AiAgentSessionEventName,
  AiAgentSessionEventResult,
  AiAgentSessionSource,
  AgentHibernationConfig,
  ManagedAiDecisionMode,
  ManagedAiRequestKind,
  ManagedAiSessionDecision,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionLifecycle,
  ManagedAiSessionRecord,
  ManagedAiSessionState,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'

const maxRawKeys = 80
const maxEventsPerSession = 200
const maxDecisionsPerSession = 40
const defaultDecisionWaitTimeoutMs = 120_000
const maxDecisionWaitTimeoutMs = 125_000
const maxLaunchCommandLength = 600

export const defaultAgentHibernationConfig: AgentHibernationConfig = {
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

export const decisionKinds = new Set<ManagedAiSessionDecisionKind>(['allow', 'always', 'bypass', 'deny', 'reply', 'handled'])

export const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

export const canonicalCwdFor = (cwd?: string, provided?: unknown) => {
  const explicit = cleanOptionalText(provided)
  if (explicit) return explicit
  const path = cleanOptionalText(cwd)
  if (!path) return undefined
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const shellToken = (value: string) => (/^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : shellQuote(value))

export const sessionKey = (source: AiAgentSessionSource, id: string) => `${source}:${id}`

export const managedAiNotificationId = (source: AiAgentSessionSource, sessionId: string) => `managed-ai:${source}:${sessionId}`

export const pendingDecisionKey = (source: AiAgentSessionSource, sessionId: string, requestId: string) => `${source}:${sessionId}:${requestId}`

export const normalizeSource = (value: unknown): AiAgentSessionSource | null => {
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

const normalizeTimestamp = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

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

export const normalizeWaitTimeoutMs = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number) || number <= 0) return defaultDecisionWaitTimeoutMs
  return Math.max(1000, Math.min(maxDecisionWaitTimeoutMs, Math.round(number)))
}

export const normalizeEventName = (value: unknown): AiAgentSessionEventName | null => {
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

export const firstText = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const text = cleanOptionalText(record[key])
    if (text) return text
  }
  return undefined
}

export const cleanPositiveInteger = (value: unknown) => {
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    const normalized = Math.floor(Number(value))
    return normalized > 0 ? normalized : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

export const normalizeAgentLifecycle = (value: unknown): ManagedAiSessionLifecycle | undefined => {
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

export const resumeCommandFor = (source: AiAgentSessionSource, sessionId: string, cwd?: string, provided?: unknown) => {
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

export const nestedRecord = (record: Record<string, unknown>, key: string) => {
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

export const sourceLabel = (source: AiAgentSessionSource) => {
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
  if (event === 'stop') return 'notification'
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

export const managedAiSessionStateForEvent = (
  event: AiAgentSessionEventName,
  previous: ManagedAiSessionState = 'unknown',
  lifecycle?: ManagedAiSessionLifecycle,
  aiEvent?: Pick<AiAgentSessionEvent, 'source' | 'event' | 'requestKind' | 'decisionMode' | 'actionable'>
): ManagedAiSessionState => {
  if (event === 'session_end') return 'ended'
  if (event === 'stop') return 'needsInput'
  const lifecycleState = stateForAgentLifecycle(lifecycle)
  if (lifecycleState) return lifecycleState
  if (event === 'session_start') return 'idle'
  if (event === 'prompt_submit' || event === 'pre_tool_use') return 'working'
  if (event === 'permission_request' || event === 'question' || event === 'notification') return aiEvent && managedAiSessionNeedsInputForEvent(aiEvent) ? 'needsInput' : 'working'
  return previous
}

export const compactString = (value: unknown, maxLength = 240) => {
  const text = cleanText(value)
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export const compactAutoTitle = (value: unknown, currentTitle?: string) => {
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

export const normalizeAutoNamingPositiveInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

export const compactRawValue = (value: unknown, depth = 0): unknown => {
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

export const compactRawRecord = (record: Record<string, unknown>) => compactRawValue(record) as Record<string, unknown>

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

export const autoTitleFor = (event: AiAgentSessionEvent, existing?: ManagedAiSessionRecord) => {
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

const createEventId = (event: AiAgentSessionEvent) => {
  const hash = createHash('sha1')
    .update([event.source, event.sessionId, event.event, event.receivedAt, event.summary].join('\0'))
    .digest('hex')
    .slice(0, 12)
  return `${event.receivedAt}-${hash}`
}

export const normalizeRecordEvent = (event: AiAgentSessionEvent, raw: Record<string, unknown>): ManagedAiSessionTimelineEvent => ({
  ...event,
  requestKind: event.requestKind || 'telemetry',
  decisionMode: event.decisionMode || 'telemetry',
  id: createEventId(event),
  raw: compactRawRecord(raw)
})

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeStoredTimelineEvent = (value: Record<string, unknown>, fallbackSource: AiAgentSessionSource, fallbackSessionId: string) => {
  const source = normalizeSource(value.source) || fallbackSource
  const event = normalizeEventName(value.event)
  if (!event) return null
  const receivedAt = typeof value.receivedAt === 'number' ? value.receivedAt : Date.now()
  const toolName = cleanOptionalText(value.toolName || value.tool_name)
  const requestKind = normalizeRequestKind(value.requestKind || value.request_kind) || requestKindFor(source, event, value, toolName)
  const decisionMode = normalizeDecisionMode(value.decisionMode || value.decision_mode) || decisionModeFor(source, event, value, requestKind)
  const cwd = cleanOptionalText(value.cwd)
  const canonicalCwd = canonicalCwdFor(cwd, value.canonicalCwd || value.canonical_cwd || value.realCwd || value.real_cwd || value.realpath)
  const gitBranch = cleanOptionalText(value.gitBranch || value.git_branch)
  const gitDirty = normalizeBoolean(value.gitDirty ?? value.git_dirty)
  const gitStatusUpdatedAt = normalizeTimestamp(value.gitStatusUpdatedAt ?? value.git_status_updated_at)
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
    ...(cwd ? { cwd } : {}),
    ...(canonicalCwd ? { canonicalCwd } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    ...(typeof gitDirty === 'boolean' ? { gitDirty } : {}),
    ...(gitStatusUpdatedAt ? { gitStatusUpdatedAt } : {}),
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

export const normalizeStoredSession = (value: unknown): ManagedAiSessionRecord | null => {
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
  const cwd = cleanOptionalText(value.cwd)
  const canonicalCwd = canonicalCwdFor(cwd, value.canonicalCwd || value.canonical_cwd || value.realCwd || value.real_cwd || value.realpath || latestEvent?.canonicalCwd)
  const gitBranch = cleanOptionalText(value.gitBranch || value.git_branch || latestEvent?.gitBranch)
  const gitDirty = normalizeBoolean(value.gitDirty ?? value.git_dirty ?? latestEvent?.gitDirty)
  const gitStatusUpdatedAt = normalizeTimestamp(value.gitStatusUpdatedAt ?? value.git_status_updated_at ?? latestEvent?.gitStatusUpdatedAt)
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
    ...(cwd ? { cwd } : {}),
    ...(canonicalCwd ? { canonicalCwd } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    ...(typeof gitDirty === 'boolean' ? { gitDirty } : {}),
    ...(gitStatusUpdatedAt ? { gitStatusUpdatedAt } : {}),
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

const normalizeHibernationNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(numberValue)))
}

export const normalizeAgentHibernationConfig = (value: unknown, fallback: AgentHibernationConfig): AgentHibernationConfig => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : fallback.enabled,
    idleSeconds: normalizeHibernationNumber(record.idleSeconds, fallback.idleSeconds, 5, 604800),
    maxLiveTerminals: normalizeHibernationNumber(record.maxLiveTerminals, fallback.maxLiveTerminals, 1, 256),
    confirmationSeconds: normalizeHibernationNumber(record.confirmationSeconds, fallback.confirmationSeconds, 0, 3600)
  }
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
  const canonicalCwd = canonicalCwdFor(cwd, record.canonicalCwd || record.canonical_cwd || record.realCwd || record.real_cwd || record.realpath)
  const gitBranch = cleanOptionalText(record.gitBranch || record.git_branch)
  const gitDirty = normalizeBoolean(record.gitDirty ?? record.git_dirty)
  const gitStatusUpdatedAt = normalizeTimestamp(record.gitStatusUpdatedAt ?? record.git_status_updated_at)
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
    ...(canonicalCwd ? { canonicalCwd } : {}),
    ...(gitBranch ? { gitBranch } : {}),
    ...(typeof gitDirty === 'boolean' ? { gitDirty } : {}),
    ...(gitStatusUpdatedAt ? { gitStatusUpdatedAt } : {}),
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
