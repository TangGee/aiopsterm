import { createHash } from 'crypto'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { normalizeSecurityConfig } from '../../appConfigRuntime'
import { validateCommandSecurity } from '@shared/commandSecurityRuntime'
import {
  CLINE_AGENT_PROVIDER_FETCH_MAX_BODY_BYTES,
  CLINE_AGENT_PROTOCOL_VERSION,
  type ClineAgentAbortInput,
  type ClineAgentAbortResult,
  type ClineAgentApprovalInput,
  type ClineAgentApprovalResult,
  type ClineAgentProfile,
  type ClineAgentProviderFetchInput,
  type ClineAgentProviderFetchResult,
  type ClineAgentProviderConfig,
  type ClineAgentSeedMessage,
  type ClineAgentSessionStartInput,
  type ClineAgentSidecarCallback,
  type ClineAgentSidecarEvent,
  type ClineAgentTaskEvent,
  type ClineAgentTaskEventData,
  type ClineAgentToolDefinition,
  type ClineAgentTurnResult
} from '@shared/contracts/clineAgent'
import type { UserConfig } from '@shared/contracts/userConfig'
import { sendWindowEvent } from '@shared/windowEvents'
import { logRuntimeEvent } from '../app/runtimeLog'
import { createAiProviderProxyFetch } from '../ai/aiProviderProxyFetch'
import { isAutoApprovableReadOnlyAiChatCommand } from '../ai/aiChatActionRuntime'
import { callCodexTerminalBridgeTool, cancelCodexTerminalBridgeCommand } from '../codex/codexTerminalBridge'
import { callBoundDatabaseAiMcpTool } from '../database/databaseMcp'
import {
  CLINE_DATABASE_TOOL_NAMES,
  CLINE_HOST_COMMAND_TOOL,
  CLINE_HOST_PROPOSAL_TOOL
} from './clineAgentProfiles'
import { currentClineAgentRendererOwner } from './clineAgentOwnerRuntime'
import { ClineAgentSidecarSupervisor } from './clineAgentSidecarSupervisor'

type DatabaseBinding = {
  connectionId: string
  databaseName?: string
  schemaName?: string
}

type AgentTaskBinding = {
  taskId: string
  sessionId: string
  profile: ClineAgentProfile
  useHostProxy: boolean
  ownerWebContentsId?: number
  terminalSessionId?: string
  database?: DatabaseBinding
}

type ActiveTurn = AgentTaskBinding & {
  turnId: string
  lastSeq: number
  providerFetchControllers: Set<AbortController>
  hostCommandIds: Set<string>
  approvedToolCalls: Map<string, ApprovedToolCall>
  toolExecutions: Map<string, ToolExecution>
  resolveApprovalPause?: (event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>) => void
}

type ApprovedToolCall = {
  toolName: string
  inputFingerprint: string
  terminalSessionId: string
}

type ToolExecution = {
  toolName: string
  inputFingerprint: string
  result: Promise<unknown>
}

type PendingApproval = {
  taskId: string
  turnId: string
  sessionId: string
  toolCallId: string
  toolName: string
  inputFingerprint: string
  terminalSessionId: string
  decision: Promise<{ approved: boolean; reason?: string }>
  resolve: (result: { approved: boolean; reason?: string }) => void
}

export type ClineAgentRunInput = {
  profile: ClineAgentProfile
  taskId: string
  turnId: string
  conversationKey: string
  prompt: string
  systemPrompt: string
  provider: ClineAgentProviderConfig
  tools: ClineAgentToolDefinition[]
  initialMessages?: ClineAgentSeedMessage[]
  terminalSessionId?: string
  database?: DatabaseBinding
  metadata?: Record<string, unknown>
  maxIterations?: number
}

export type ClineAgentRunOutcome =
  | { status: 'done'; result: ClineAgentTurnResult }
  | { status: 'approval-required'; event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }> }

type ClineAgentRuntimeConfig = {
  appPath: string
  resourcesPath: string
  userDataPath: string
  isPackaged: boolean
  getConfig: () => UserConfig
  getWindows?: () => BrowserWindow[]
  env?: NodeJS.ProcessEnv
  createSupervisor?: (options: ConstructorParameters<typeof ClineAgentSidecarSupervisor>[0]) => ClineAgentSidecarSupervisor
}

let runtimeConfig: ClineAgentRuntimeConfig | null = null
let supervisor: ClineAgentSidecarSupervisor | null = null
const taskBindings = new Map<string, AgentTaskBinding>()
const activeTurnsBySession = new Map<string, ActiveTurn>()
const pendingApprovals = new Map<string, PendingApproval>()
const PROVIDER_FETCH_TIMEOUT_MS = 180_000
const HOST_TOOL_OUTPUT_MAX_BYTES = 256 * 1024

const PROFILE_TOOL_NAMES: Record<ClineAgentProfile, readonly string[]> = {
  'classic-chat': [],
  'classic-command': [CLINE_HOST_PROPOSAL_TOOL],
  'classic-agent': [CLINE_HOST_COMMAND_TOOL],
  database: CLINE_DATABASE_TOOL_NAMES
}

const cleanText = (value: unknown) => String(value || '').trim()

const recordInput = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const canonicalJson = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const fields = Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    return `{${fields.join(',')}}`
  }
  return 'null'
}

const toolInputFingerprint = (toolName: string, input: Record<string, unknown>) =>
  createHash('sha256').update(`${toolName}\u0000${canonicalJson(input)}`, 'utf8').digest('hex')

const toolAllowedForProfile = (profile: ClineAgentProfile, toolName: string) =>
  PROFILE_TOOL_NAMES[profile]?.includes(toolName) === true

const validateProfileTools = (profile: ClineAgentProfile, tools: ClineAgentToolDefinition[]) => {
  const expected = PROFILE_TOOL_NAMES[profile]
  if (!expected) throw new Error(`Unknown Cline Agent profile: ${profile}`)
  const names = tools.map((tool) => cleanText(tool.name))
  if (
    names.length !== expected.length ||
    new Set(names).size !== names.length ||
    names.some((name) => !expected.includes(name)) ||
    expected.some((name) => !names.includes(name))
  ) {
    throw new Error(`Cline Agent profile ${profile} requires exactly these tools: ${expected.join(', ') || '(none)'}.`)
  }
  for (const tool of tools) {
    const mustAutoApprove = tool.name !== CLINE_HOST_COMMAND_TOOL
    if (tool.autoApprove !== mustAutoApprove) {
      throw new Error(`Cline Agent tool ${tool.name} has an invalid approval policy for ${profile}.`)
    }
  }
}

const approvalKey = (taskId: string, turnId: string, toolCallId: string) => `${taskId}\u0000${turnId}\u0000${toolCallId}`

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'Unknown Cline Agent error'))

const safeSessionId = (profile: ClineAgentProfile, key: string) => {
  const normalized = cleanText(key) || 'task'
  const slug = normalized.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48) || 'task'
  const digest = createHash('sha256').update(`${profile}\u0000${normalized}`, 'utf8').digest('hex').slice(0, 16)
  return `aiopsterm-${profile}-${slug}-${digest}`
}

const getRuntimeConfig = () => {
  if (!runtimeConfig) throw new Error('Cline Agent runtime is not configured.')
  return runtimeConfig
}

const rejectPendingApprovals = (predicate: (pending: PendingApproval) => boolean, reason: string) => {
  for (const [key, pending] of pendingApprovals) {
    if (!predicate(pending)) continue
    pendingApprovals.delete(key)
    pending.resolve({ approved: false, reason })
  }
}

const abortProviderFetches = (active: ActiveTurn) => {
  for (const controller of active.providerFetchControllers) controller.abort()
  active.providerFetchControllers.clear()
}

const abortAllProviderFetches = () => {
  for (const active of activeTurnsBySession.values()) abortProviderFetches(active)
}

const abortHostCommands = (active: ActiveTurn, reason: string) => {
  for (const commandId of active.hostCommandIds) cancelCodexTerminalBridgeCommand(commandId, reason)
  active.hostCommandIds.clear()
}

const abortAllHostCommands = (reason: string) => {
  for (const active of activeTurnsBySession.values()) abortHostCommands(active, reason)
}

const emitTaskEvent = (event: ClineAgentTaskEvent) => {
  const active = activeTurnsBySession.get(event.sessionId)
  if (!active || active.taskId !== event.taskId || active.turnId !== event.turnId) return
  active.lastSeq = Math.max(active.lastSeq, event.seq)
  const windows = getRuntimeConfig().getWindows?.() || []
  const target = active.ownerWebContentsId === undefined
    ? undefined
    : windows.find((window) => window.webContents.id === active.ownerWebContentsId)
  const delivered = sendWindowEvent(target, 'cline-agent:task-event', event)
  logRuntimeEvent(event.type === 'error' ? 'error' : 'debug', 'cline-agent.task-event', {
    taskId: event.taskId,
    turnId: event.turnId,
    sessionId: event.sessionId,
    type: event.type,
    seq: event.seq,
    delivered
  })
}

const nextTaskEvent = <T extends ClineAgentTaskEventData>(
  active: ActiveTurn,
  event: T
) => ({
  protocolVersion: CLINE_AGENT_PROTOCOL_VERSION,
  sessionId: active.sessionId,
  taskId: active.taskId,
  turnId: active.turnId,
  seq: ++active.lastSeq,
  at: new Date().toISOString(),
  ...event
}) as ClineAgentTaskEvent

const handleSidecarEvent = (message: ClineAgentSidecarEvent) => {
  if (message.event !== 'agent.task') return
  const event = message.payload as ClineAgentTaskEvent
  const active = activeTurnsBySession.get(event.sessionId)
  if (!active || active.taskId !== event.taskId || active.turnId !== event.turnId) return
  emitTaskEvent({ ...event, seq: active.lastSeq + 1 } as ClineAgentTaskEvent)
}

const bindingForCallback = (payload: Record<string, unknown>) => {
  const sessionId = cleanText(payload.sessionId)
  const taskId = cleanText(payload.taskId)
  const turnId = cleanText(payload.turnId)
  const active = activeTurnsBySession.get(sessionId)
  if (!active || active.taskId !== taskId || active.turnId !== turnId) {
    throw new Error('Stale or mismatched Cline Agent callback.')
  }
  return active
}

const truncateUtf8 = (value: string, maxBytes: number) => {
  const source = Buffer.from(value, 'utf8')
  if (source.byteLength <= maxBytes) return { value, originalBytes: source.byteLength, truncated: false }
  let end = maxBytes
  while (end > 0 && (source[end] & 0xc0) === 0x80) end -= 1
  return { value: source.subarray(0, end).toString('utf8'), originalBytes: source.byteLength, truncated: true }
}

const boundedHostToolResult = (response: Awaited<ReturnType<typeof callCodexTerminalBridgeTool>>) => {
  const data = { ...(response.data || {}) }
  if (typeof data.output === 'string') {
    const output = truncateUtf8(data.output, HOST_TOOL_OUTPUT_MAX_BYTES)
    data.output = output.value
    if (output.truncated) {
      data.outputTruncated = true
      data.originalOutputBytes = output.originalBytes
    }
  }
  return {
    target: response.target,
    ...data
  }
}

const executeHostTool = async (
  active: ActiveTurn,
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
  inputFingerprint: string
) => {
  const command = cleanText(input.command)
  if (!command) throw new Error('Host command is required.')
  if (active.profile === 'classic-command' && toolName === CLINE_HOST_PROPOSAL_TOOL) {
    return { command, rationale: cleanText(input.rationale) }
  }
  if (active.profile !== 'classic-agent' || toolName !== CLINE_HOST_COMMAND_TOOL) {
    throw new Error(`Tool is not available in ${active.profile}: ${toolName}`)
  }
  const terminalSessionId = cleanText(active.terminalSessionId)
  if (!terminalSessionId) throw new Error('The selected aiopsterm terminal session is unavailable.')
  const approval = active.approvedToolCalls.get(toolCallId)
  if (
    !approval ||
    approval.toolName !== toolName ||
    approval.inputFingerprint !== inputFingerprint ||
    approval.terminalSessionId !== terminalSessionId
  ) {
    throw new Error('The host command tool call has not been approved by aiopsterm main.')
  }
  const commandId = `cline_${createHash('sha256')
    .update(`${active.taskId}\u0000${active.turnId}\u0000${toolCallId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`
  active.hostCommandIds.add(commandId)
  let response: Awaited<ReturnType<typeof callCodexTerminalBridgeTool>>
  try {
    response = await callCodexTerminalBridgeTool('run_command', {
      sessionId: terminalSessionId,
      commandId,
      command,
      timeoutMs: input.timeoutMs,
      mode: 'wait',
      execution: 'terminal'
    })
  } finally {
    active.hostCommandIds.delete(commandId)
  }
  if (!response.ok) throw new Error(response.errorMessage || 'Host command failed.')
  return boundedHostToolResult(response)
}

const executeDatabaseTool = async (active: ActiveTurn, toolName: string, input: Record<string, unknown>) => {
  if (!active.database) throw new Error('The DB AI session has no database binding.')
  const result = await callBoundDatabaseAiMcpTool(toolName, input, active.database)
  if (!result) throw new Error(`Unknown database tool: ${toolName}`)
  if (!result.ok) throw new Error(result.errorMessage || 'Database tool failed.')
  return result.data || {}
}

const providerFetchHeaders = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Cline Agent provider fetch headers.')
  const headers = new Headers()
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof headerValue !== 'string') throw new Error('Invalid Cline Agent provider fetch header value.')
    headers.set(key, headerValue)
  }
  const result: Record<string, string> = {}
  headers.forEach((headerValue, key) => {
    result[key] = headerValue
  })
  return result
}

const executeProviderFetch = async (active: ActiveTurn, payload: Record<string, unknown>): Promise<ClineAgentProviderFetchResult> => {
  if (!active.useHostProxy) throw new Error('Host proxy fetch is not enabled for this Cline Agent task.')
  const input = payload as ClineAgentProviderFetchInput
  const url = cleanText(input.url)
  const method = cleanText(input.method).toUpperCase() || 'GET'
  if (!url || !/^[A-Z]+$/.test(method)) throw new Error('Invalid Cline Agent provider fetch request.')
  const headers = providerFetchHeaders(input.headers)
  const body = input.bodyBase64 ? Buffer.from(input.bodyBase64, 'base64') : undefined
  if (body && body.byteLength > CLINE_AGENT_PROVIDER_FETCH_MAX_BODY_BYTES) {
    throw new Error(`Cline Agent provider request body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_BODY_BYTES} bytes.`)
  }
  const proxyFetch = createAiProviderProxyFetch(getRuntimeConfig().getConfig().aiPreferences, {
    maxResponseBytes: CLINE_AGENT_PROVIDER_FETCH_MAX_BODY_BYTES
  })
  if (!proxyFetch) throw new Error('AI provider proxy is enabled for this task, but its configuration is invalid or unavailable.')
  const controller = new AbortController()
  active.providerFetchControllers.add(controller)
  const timer = setTimeout(() => controller.abort(), PROVIDER_FETCH_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await proxyFetch(url, {
      method,
      headers,
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: controller.signal
    })
    const responseBody = Buffer.from(await response.arrayBuffer())
    if (responseBody.byteLength > CLINE_AGENT_PROVIDER_FETCH_MAX_BODY_BYTES) {
      throw new Error(`Cline Agent provider response body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_BODY_BYTES} bytes.`)
    }
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: responseBody.toString('base64')
    }
  } finally {
    clearTimeout(timer)
    active.providerFetchControllers.delete(controller)
  }
}

const requestHostApproval = (active: ActiveTurn, payload: Record<string, unknown>) => {
  const toolCallId = cleanText(payload.toolCallId)
  const toolName = cleanText(payload.toolName)
  const input = recordInput(payload.input)
  const command = cleanText(input.command)
  const terminalSessionId = cleanText(active.terminalSessionId)
  if (
    active.profile !== 'classic-agent' ||
    !toolCallId ||
    toolName !== CLINE_HOST_COMMAND_TOOL ||
    !toolAllowedForProfile(active.profile, toolName) ||
    !command ||
    !terminalSessionId
  ) {
    return Promise.resolve({ approved: false, reason: 'Invalid host command approval request.' })
  }
  const inputFingerprint = toolInputFingerprint(toolName, input)
  const approved = active.approvedToolCalls.get(toolCallId)
  if (approved) {
    const matches = approved.toolName === toolName &&
      approved.inputFingerprint === inputFingerprint &&
      approved.terminalSessionId === terminalSessionId
    return Promise.resolve(matches
      ? { approved: true }
      : { approved: false, reason: 'Approval request does not match the previously approved tool call.' })
  }
  const key = approvalKey(active.taskId, active.turnId, toolCallId)
  const existing = pendingApprovals.get(key)
  if (existing) {
    if (
      existing.toolName !== toolName ||
      existing.inputFingerprint !== inputFingerprint ||
      existing.terminalSessionId !== terminalSessionId
    ) {
      return Promise.resolve({ approved: false, reason: 'Duplicate approval request does not match the pending tool call.' })
    }
    return existing.decision
  }
  const security = validateCommandSecurity(normalizeSecurityConfig(getRuntimeConfig().getConfig().securityConfig), command)
  if (!security.isAllowed && !security.requiresApproval) {
    return Promise.resolve({ approved: false, reason: security.reason || 'Command blocked by aiopsterm security policy.' })
  }
  if (
    getRuntimeConfig().getConfig().aiPreferences?.autoApproval === true &&
    !security.requiresApproval &&
    isAutoApprovableReadOnlyAiChatCommand(command)
  ) {
    active.approvedToolCalls.set(toolCallId, { toolName, inputFingerprint, terminalSessionId })
    return Promise.resolve({ approved: true })
  }
  const event = nextTaskEvent(active, {
    type: 'approval-requested',
    toolCallId,
    toolName,
    terminalSessionId,
    input,
    iteration: Math.max(0, Math.round(Number(payload.iteration) || 0)),
    reason: security.reason
  }) as Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>
  let resolveDecision: PendingApproval['resolve'] = () => undefined
  const rawDecision = new Promise<{ approved: boolean; reason?: string }>((resolve) => {
    resolveDecision = resolve
  })
  const decision = rawDecision.then((result) => {
    if (result.approved) active.approvedToolCalls.set(toolCallId, { toolName, inputFingerprint, terminalSessionId })
    return result
  })
  pendingApprovals.set(key, {
    taskId: active.taskId,
    turnId: active.turnId,
    sessionId: active.sessionId,
    toolCallId,
    toolName,
    inputFingerprint,
    terminalSessionId,
    decision,
    resolve: resolveDecision
  })
  emitTaskEvent(event)
  active.resolveApprovalPause?.(event)
  active.resolveApprovalPause = undefined
  return decision
}

const executeToolCallback = (active: ActiveTurn, payload: Record<string, unknown>) => {
  const toolCallId = cleanText(payload.toolCallId)
  const toolName = cleanText(payload.toolName)
  const input = recordInput(payload.input)
  if (!toolCallId || !toolName) throw new Error('Cline Agent tool callback is missing toolCallId or toolName.')
  if (!toolAllowedForProfile(active.profile, toolName)) {
    throw new Error(`Tool is not available in ${active.profile}: ${toolName}`)
  }
  const inputFingerprint = toolInputFingerprint(toolName, input)
  const existing = active.toolExecutions.get(toolCallId)
  if (existing) {
    if (existing.toolName !== toolName || existing.inputFingerprint !== inputFingerprint) {
      throw new Error('Cline Agent reused a toolCallId with a different tool name or input.')
    }
    return existing.result
  }
  const result = Promise.resolve().then(() => {
    if (toolName === CLINE_HOST_COMMAND_TOOL || toolName === CLINE_HOST_PROPOSAL_TOOL) {
      return executeHostTool(active, toolName, toolCallId, input, inputFingerprint)
    }
    if (active.profile === 'database') return executeDatabaseTool(active, toolName, input)
    throw new Error(`Tool is not available in ${active.profile}: ${toolName}`)
  })
  active.toolExecutions.set(toolCallId, { toolName, inputFingerprint, result })
  return result
}

const handleSidecarCallback = async (message: ClineAgentSidecarCallback) => {
  const payload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
    ? message.payload as Record<string, unknown>
    : {}
  const active = bindingForCallback(payload)
  if (message.callback === 'approval.request') return requestHostApproval(active, payload)
  if (message.callback === 'provider.fetch') return executeProviderFetch(active, payload)
  if (message.callback === 'tool.execute') return executeToolCallback(active, payload)
  throw new Error(`Unsupported Cline Agent callback: ${message.callback}`)
}

const ensureSupervisor = () => {
  if (supervisor) return supervisor
  const config = getRuntimeConfig()
  const options: ConstructorParameters<typeof ClineAgentSidecarSupervisor>[0] = {
    appPath: config.appPath,
    resourcesPath: config.resourcesPath,
    userDataPath: config.userDataPath,
    isPackaged: config.isPackaged,
    env: config.env,
    onEvent: handleSidecarEvent,
    onCallback: handleSidecarCallback,
    onExit: ({ errorMessage: exitError }) => {
      for (const active of activeTurnsBySession.values()) {
        abortProviderFetches(active)
        abortHostCommands(active, exitError)
        emitTaskEvent(nextTaskEvent(active, { type: 'status', status: 'interrupted', message: exitError }))
      }
      rejectPendingApprovals(() => true, exitError)
    },
    log: (level, event, data) => logRuntimeEvent(level, event, data)
  }
  supervisor = config.createSupervisor ? config.createSupervisor(options) : new ClineAgentSidecarSupervisor(options)
  return supervisor
}

export const configureClineAgentRuntime = (config?: ClineAgentRuntimeConfig) => {
  runtimeConfig = config || null
  if (!config) {
    abortAllProviderFetches()
    abortAllHostCommands('Cline Agent runtime was reconfigured.')
    rejectPendingApprovals(() => true, 'Cline Agent runtime was reconfigured.')
    supervisor = null
    taskBindings.clear()
    activeTurnsBySession.clear()
    pendingApprovals.clear()
  }
}

export const runClineAgentTurn = async (input: ClineAgentRunInput): Promise<ClineAgentRunOutcome> => {
  const taskId = cleanText(input.taskId)
  const turnId = cleanText(input.turnId)
  const prompt = cleanText(input.prompt)
  if (!taskId || !turnId || !prompt) throw new Error('Cline Agent taskId, turnId, and prompt are required.')
  validateProfileTools(input.profile, input.tools)
  const terminalSessionId = cleanText(input.terminalSessionId)
  const database = input.database
    ? {
        connectionId: cleanText(input.database.connectionId),
        ...(cleanText(input.database.databaseName) ? { databaseName: cleanText(input.database.databaseName) } : {}),
        ...(cleanText(input.database.schemaName) ? { schemaName: cleanText(input.database.schemaName) } : {})
      }
    : undefined
  if (input.profile === 'classic-agent' && !terminalSessionId) {
    throw new Error('Classic Agent requires a trusted terminal session binding.')
  }
  if (input.profile === 'database' && !database?.connectionId) {
    throw new Error('DB AI requires a trusted database connection binding.')
  }
  const sessionId = safeSessionId(input.profile, input.conversationKey)
  const ownerWebContentsId = currentClineAgentRendererOwner()
  if (activeTurnsBySession.has(sessionId)) throw new Error('This Cline Agent conversation already has an active turn.')
  if (taskBindings.has(taskId)) throw new Error('This Cline Agent task id is already active.')
  const binding: AgentTaskBinding = {
    taskId,
    sessionId,
    profile: input.profile,
    useHostProxy: input.provider.useHostProxy === true,
    ...(ownerWebContentsId ? { ownerWebContentsId } : {}),
    ...(terminalSessionId ? { terminalSessionId } : {}),
    ...(database ? { database } : {})
  }
  taskBindings.set(taskId, binding)
  const active: ActiveTurn = {
    ...binding,
    turnId,
    lastSeq: 0,
    providerFetchControllers: new Set(),
    hostCommandIds: new Set(),
    approvedToolCalls: new Map(),
    toolExecutions: new Map()
  }
  activeTurnsBySession.set(sessionId, active)
  const startInput: ClineAgentSessionStartInput = {
    sessionId,
    profile: input.profile,
    systemPrompt: input.systemPrompt,
    provider: input.provider,
    tools: input.tools,
    initialMessages: input.initialMessages,
    metadata: { ...(input.metadata || {}), taskId, turnId },
    maxIterations: input.maxIterations
  }
  try {
    const manager = ensureSupervisor()
    emitTaskEvent(nextTaskEvent(active, { type: 'status', status: 'starting' }))
    await manager.request('session.start', startInput)
    const pause = new Promise<Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>>((resolve) => {
      active.resolveApprovalPause = resolve
    })
    const send = manager.request<ClineAgentTurnResult>('session.send', { sessionId, taskId, turnId, prompt })
    void send
      .catch(() => undefined)
      .finally(() => {
        abortProviderFetches(active)
        abortHostCommands(active, 'The Cline Agent turn ended.')
        rejectPendingApprovals(
          (pending) => pending.taskId === taskId && pending.turnId === turnId && pending.sessionId === sessionId,
          'The Cline Agent turn ended before approval completed.'
        )
        const current = activeTurnsBySession.get(sessionId)
        if (current?.turnId !== turnId) return
        activeTurnsBySession.delete(sessionId)
        const currentBinding = taskBindings.get(taskId)
        if (currentBinding?.sessionId === sessionId) taskBindings.delete(taskId)
      })
    if (input.profile !== 'classic-agent') return { status: 'done', result: await send }
    const outcome = await Promise.race([
      send.then((result) => ({ status: 'done' as const, result })),
      pause.then((event) => ({ status: 'approval-required' as const, event }))
    ])
    return outcome
  } catch (error) {
    abortProviderFetches(active)
    abortHostCommands(active, 'The Cline Agent turn failed.')
    rejectPendingApprovals(
      (pending) => pending.taskId === taskId && pending.turnId === turnId && pending.sessionId === sessionId,
      'The Cline Agent turn failed before approval completed.'
    )
    activeTurnsBySession.delete(sessionId)
    const currentBinding = taskBindings.get(taskId)
    if (currentBinding?.sessionId === sessionId) taskBindings.delete(taskId)
    throw error
  }
}

export const respondClineAgentApproval = (
  input: ClineAgentApprovalInput,
  ownerWebContentsId?: number
): ClineAgentApprovalResult => {
  const effectiveOwnerWebContentsId = ownerWebContentsId ?? currentClineAgentRendererOwner()
  const taskId = cleanText(input.taskId)
  const turnId = cleanText(input.turnId)
  const toolCallId = cleanText(input.toolCallId)
  const terminalSessionId = cleanText(input.terminalSessionId)
  const key = approvalKey(taskId, turnId, toolCallId)
  const pending = pendingApprovals.get(key)
  const binding = taskBindings.get(taskId)
  const active = pending ? activeTurnsBySession.get(pending.sessionId) : undefined
  if (
    !pending ||
    !binding ||
    !active ||
    !terminalSessionId ||
    pending.taskId !== taskId ||
    pending.turnId !== turnId ||
    pending.terminalSessionId !== terminalSessionId ||
    binding.sessionId !== pending.sessionId ||
    binding.terminalSessionId !== terminalSessionId ||
    active.taskId !== taskId ||
    active.turnId !== turnId ||
    active.terminalSessionId !== terminalSessionId ||
    (effectiveOwnerWebContentsId !== undefined && binding.ownerWebContentsId !== effectiveOwnerWebContentsId)
  ) {
    return { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_NOT_FOUND', errorMessage: 'The Cline Agent approval is no longer pending.' }
  }
  pendingApprovals.delete(key)
  pending.resolve({ approved: input.approved === true, reason: cleanText(input.reason) || undefined })
  return {
    ok: true,
    data: { taskId, turnId, toolCallId, terminalSessionId, status: input.approved ? 'approved' : 'rejected' }
  }
}

export const abortClineAgentTask = async (
  input: ClineAgentAbortInput,
  ownerWebContentsId?: number
): Promise<ClineAgentAbortResult> => {
  const effectiveOwnerWebContentsId = ownerWebContentsId ?? currentClineAgentRendererOwner()
  const taskId = cleanText(input.taskId)
  const binding = taskBindings.get(taskId)
  if (!binding || (effectiveOwnerWebContentsId !== undefined && binding.ownerWebContentsId !== effectiveOwnerWebContentsId)) {
    return { ok: false, errorCode: 'CLINE_AGENT_TASK_NOT_FOUND', errorMessage: 'Cline Agent task was not found.' }
  }
  const active = activeTurnsBySession.get(binding.sessionId)
  if (input.turnId && active?.turnId !== input.turnId) {
    return { ok: false, errorCode: 'CLINE_AGENT_TURN_MISMATCH', errorMessage: 'Cline Agent turn no longer matches the active turn.' }
  }
  rejectPendingApprovals(
    (pending) => pending.taskId === taskId && (!input.turnId || pending.turnId === input.turnId),
    cleanText(input.reason) || 'The operator cancelled the Agent turn.'
  )
  if (active) {
    abortProviderFetches(active)
    abortHostCommands(active, cleanText(input.reason) || 'The operator cancelled the Agent turn.')
    try {
      await ensureSupervisor().request('session.abort', {
        sessionId: binding.sessionId,
        reason: cleanText(input.reason) || 'user_abort'
      })
    } finally {
      abortProviderFetches(active)
      abortHostCommands(active, cleanText(input.reason) || 'The operator cancelled the Agent turn.')
    }
  }
  return { ok: true, data: { taskId, ...(input.turnId ? { turnId: input.turnId } : {}), status: 'cancelled' } }
}

export const closeClineAgentRuntime = async () => {
  rejectPendingApprovals(() => true, 'aiopsterm is shutting down.')
  abortAllProviderFetches()
  abortAllHostCommands('aiopsterm is shutting down.')
  try {
    await supervisor?.shutdown()
  } finally {
    abortAllProviderFetches()
    abortAllHostCommands('aiopsterm is shutting down.')
    supervisor = null
    activeTurnsBySession.clear()
    taskBindings.clear()
  }
}

export const clineAgentDataDir = () => join(getRuntimeConfig().userDataPath, 'cline-agent')
