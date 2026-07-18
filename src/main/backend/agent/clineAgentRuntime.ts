import { createHash } from 'crypto'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { normalizeSecurityConfig } from '../../appConfigRuntime'
import { validateCommandSecurity } from '@shared/commandSecurityRuntime'
import {
  CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES,
  CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES,
  CLINE_AGENT_PROTOCOL_VERSION,
  CLINE_AGENT_MAX_HOST_TARGETS,
  type ClineAgentAbortInput,
  type ClineAgentAbortResult,
  type ClineAgentApprovalInput,
  type ClineAgentApprovalResult,
  type ClineAgentHostTarget,
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
import type { McpResourceReadInput, McpResourceReadResult } from '@shared/contracts/mcp'
import { sendWindowEvent } from '@shared/windowEvents'
import { logRuntimeEvent } from '../app/runtimeLog'
import { createAiProviderProxyFetch } from '../ai/aiProviderProxyFetch'
import { callCodexTerminalBridgeTool, cancelCodexTerminalBridgeCommand } from '../codex/codexTerminalBridge'
import { callBoundDatabaseAiMcpTool } from '../database/databaseMcp'
import {
  CLINE_DATABASE_TOOL_NAMES,
  CLINE_HOST_COMMAND_TOOL,
  CLINE_HOST_PROPOSAL_TOOL
} from './clineAgentProfiles'
import { currentClineAgentRendererOwner } from './clineAgentOwnerRuntime'
import { ClineAgentSidecarSupervisor } from './clineAgentSidecarSupervisor'
import {
  CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL,
  CLASSIC_AGENT_HOSTLESS_TOOL_NAMES,
  CLASSIC_AGENT_PROFILE_AUXILIARY_TOOL_NAMES,
  CLASSIC_AGENT_READ_HOST_FILE_TOOL,
  CLASSIC_AGENT_READ_HOST_COMMAND_OUTPUT_TOOL,
  CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL,
  classicAgentToolRequiresApproval,
  classicAgentToolUsesHost,
  createClassicAgentToolRuntime,
  isClassicAgentControlledTool,
  type ClassicAgentToolRuntimeOptions
} from './classicAgentTools'
import { createClineAgentOutputStore, type ClineAgentOutputStore } from './clineAgentOutputStore'

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
  hostTargets: ReadonlyMap<string, ClineAgentHostTarget>
  mcpResources: ReadonlyMap<string, BoundMcpResource>
  database?: DatabaseBinding
}

type BoundMcpResource = {
  serverName: string
  uri: string
}

type ActiveTurn = AgentTaskBinding & {
  turnId: string
  lastSeq: number
  terminalEventType?: TerminalTaskEventType
  abortReason?: string
  providerFetchControllers: Set<AbortController>
  databaseToolControllers: Set<AbortController>
  hostCommandIds: Set<string>
  approvedToolCalls: Map<string, ApprovedToolCall>
  toolExecutions: Map<string, ToolExecution>
  settled: Promise<void>
  resolveSettled: () => void
  resolveApprovalPause?: (event: Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>) => void
}

type TerminalTaskEventType = Extract<ClineAgentTaskEvent, { type: 'done' | 'cancelled' | 'error' }>['type']

type ApprovedToolCall = {
  toolName: string
  inputFingerprint: string
  bindingFingerprint: string
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
  bindingFingerprint: string
  targetId?: string
  targetLabel?: string
  terminalSessionId?: string
  serverName?: string
  resourceUri?: string
  autoApprovable: boolean
  decision: Promise<{ approved: boolean; reason?: string }>
  resolve: (result: { approved: boolean; reason?: string }) => void
}

export type ClineAgentRunInput = {
  profile: ClineAgentProfile
  taskId: string
  turnId: string
  conversationKey: string
  prompt: string
  userImages?: string[]
  systemPrompt: string
  provider: ClineAgentProviderConfig
  tools: ClineAgentToolDefinition[]
  initialMessages?: ClineAgentSeedMessage[]
  replaceTranscript?: boolean
  hostTargets?: ClineAgentHostTarget[]
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
  searchKnowledgeBase?: ClassicAgentToolRuntimeOptions['searchKnowledgeBase']
  readMcpResource?: (input: McpResourceReadInput) => Promise<McpResourceReadResult>
  outputStore?: ClineAgentOutputStore
  getWindows?: () => BrowserWindow[]
  env?: NodeJS.ProcessEnv
  createSupervisor?: (options: ConstructorParameters<typeof ClineAgentSidecarSupervisor>[0]) => ClineAgentSidecarSupervisor
}

let runtimeConfig: ClineAgentRuntimeConfig | null = null
let supervisor: ClineAgentSidecarSupervisor | null = null
let classicAgentToolRuntime: ReturnType<typeof createClassicAgentToolRuntime> | null = null
let clineAgentOutputStore: ClineAgentOutputStore | null = null
const taskBindings = new Map<string, AgentTaskBinding>()
const activeTurnsBySession = new Map<string, ActiveTurn>()
const sessionStopsById = new Map<string, Promise<boolean>>()
const pendingApprovals = new Map<string, PendingApproval>()
const readOnlyAutoApprovalSessions = new Set<string>()
const PROVIDER_FETCH_TIMEOUT_MS = 180_000
const HOST_TOOL_OUTPUT_MAX_BYTES = 256 * 1024
export const CLINE_AGENT_SESSION_STOP_GRACE_MS = 1_500

const PROFILE_TOOL_NAMES: Record<ClineAgentProfile, readonly string[]> = {
  'classic-chat': [],
  'classic-command': [CLINE_HOST_PROPOSAL_TOOL],
  'classic-agent': [...CLASSIC_AGENT_PROFILE_AUXILIARY_TOOL_NAMES, CLINE_HOST_COMMAND_TOOL],
  database: CLINE_DATABASE_TOOL_NAMES
}

const cleanText = (value: unknown) => String(value || '').trim()

const normalizeHostTargets = (input: ClineAgentHostTarget[] | undefined): Map<string, ClineAgentHostTarget> => {
  const source = input || []
  if (source.length > CLINE_AGENT_MAX_HOST_TARGETS) {
    throw new Error(`Classic Agent supports at most ${CLINE_AGENT_MAX_HOST_TARGETS} host targets.`)
  }
  const targets = new Map<string, ClineAgentHostTarget>()
  const terminalSessionIds = new Set<string>()
  for (const rawTarget of source) {
    const targetId = cleanText(rawTarget?.targetId)
    const terminalSessionId = cleanText(rawTarget?.terminalSessionId)
    const label = cleanText(rawTarget?.label)
    const kind = rawTarget?.kind
    const cwd = cleanText(rawTarget?.cwd)
    if (!targetId || !terminalSessionId || !label || (kind !== 'local' && kind !== 'ssh')) {
      throw new Error('Each Classic host target requires targetId, terminalSessionId, label, and a valid kind.')
    }
    if (targets.has(targetId)) throw new Error(`Classic host targetId is duplicated: ${targetId}`)
    if (terminalSessionIds.has(terminalSessionId)) {
      throw new Error(`Classic terminalSessionId is duplicated: ${terminalSessionId}`)
    }
    targets.set(targetId, {
      targetId,
      terminalSessionId,
      label,
      kind,
      ...(cwd ? { cwd } : {})
    })
    terminalSessionIds.add(terminalSessionId)
  }
  return targets
}

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

const mcpResourceKey = (serverName: string, uri: string) => `${serverName}\u0000${uri}`

const normalizeBoundMcpResources = (config: UserConfig): Map<string, BoundMcpResource> => {
  const resources = new Map<string, BoundMcpResource>()
  let remainingChars = 12_000
  for (const server of (config.mcpServers || []).slice(0, 20)) {
    const serverName = cleanText(server?.name).slice(0, 128)
    if (!serverName || server.disabled || server.status === 'disabled') continue
    for (const resource of (server.resources || []).slice(0, 50)) {
      if (resources.size >= 50 || remainingChars <= 0) break
      const uri = cleanText(resource?.uri).slice(0, 2048)
      if (!uri) continue
      const catalogRecord = JSON.stringify({
        serverName,
        uri,
        name: cleanText(resource?.name).slice(0, 200),
        description: cleanText(resource?.description).slice(0, 500)
      })
      if (catalogRecord.length > remainingChars) break
      resources.set(mcpResourceKey(serverName, uri), { serverName, uri })
      remainingChars -= catalogRecord.length
    }
  }
  return resources
}

const assertApprovalInputKeys = (input: Record<string, unknown>, allowed: readonly string[]) => {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(input).find((key) => !allowedKeys.has(key))
  if (unexpected) throw new Error(`Unexpected approval input field: ${unexpected}`)
}

const approvalText = (value: unknown, field: string, maxLength: number) => {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${field} is invalid.`)
  }
  return text
}

const approvalOptionalText = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  const text = value.trim()
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${field} is invalid.`)
  return text
}

const approvalInteger = (value: unknown, fallback: number, min: number, max: number, field: string) => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} is invalid.`)
  }
  return value
}

const approvalBoolean = (value: unknown, fallback: boolean, field: string) => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${field} is invalid.`)
  return value
}

type ToolApprovalDescriptor = {
  input: Record<string, unknown>
  bindingFingerprint: string
  targetId?: string
  targetLabel?: string
  terminalSessionId?: string
  serverName?: string
  resourceUri?: string
  autoApprovable: boolean
  reason?: string
}

const hostApprovalDescriptor = (
  target: ClineAgentHostTarget,
  input: Record<string, unknown>,
  options: Pick<ToolApprovalDescriptor, 'autoApprovable' | 'reason'>
): ToolApprovalDescriptor => ({
  input,
  bindingFingerprint: toolInputFingerprint('host-approval-binding', {
    targetId: target.targetId,
    targetLabel: target.label,
    terminalSessionId: target.terminalSessionId
  }),
  targetId: target.targetId,
  targetLabel: target.label,
  terminalSessionId: target.terminalSessionId,
  autoApprovable: options.autoApprovable,
  ...(options.reason ? { reason: options.reason } : {})
})

const sensitiveToolApprovalDescriptor = (
  active: ActiveTurn,
  toolName: string,
  input: Record<string, unknown>
): ToolApprovalDescriptor => {
  if (toolName === CLASSIC_AGENT_READ_HOST_FILE_TOOL) {
    assertApprovalInputKeys(input, ['targetId', 'path', 'offset', 'limit'])
    const target = hostTargetForToolInput(active, input, { required: true })
    if (!target) throw new Error('The selected aiopsterm host target is unavailable.')
    const path = approvalText(input.path, 'path', 2048)
    if (path.startsWith('-')) throw new Error('path cannot begin with "-".')
    return hostApprovalDescriptor(target, {
      targetId: target.targetId,
      path,
      offset: approvalInteger(input.offset, 0, 0, 10_000_000, 'offset'),
      limit: approvalInteger(input.limit, 200, 1, 500, 'limit')
    }, { autoApprovable: false })
  }
  if (toolName === CLASSIC_AGENT_SEARCH_HOST_FILES_TOOL) {
    assertApprovalInputKeys(input, [
      'targetId',
      'kind',
      'path',
      'pattern',
      'include',
      'caseSensitive',
      'contextLines',
      'limit'
    ])
    const target = hostTargetForToolInput(active, input, { required: true })
    if (!target) throw new Error('The selected aiopsterm host target is unavailable.')
    const kind = approvalText(input.kind, 'kind', 16)
    if (kind !== 'name' && kind !== 'content') throw new Error('kind is invalid.')
    const path = input.path === undefined ? '.' : approvalText(input.path, 'path', 2048)
    if (path.startsWith('-')) throw new Error('path cannot begin with "-".')
    const pattern = approvalText(input.pattern, 'pattern', kind === 'name' ? 256 : 512)
    const normalized: Record<string, unknown> = {
      targetId: target.targetId,
      kind,
      path,
      pattern,
      limit: approvalInteger(input.limit, kind === 'name' ? 100 : 50, 1, 200, 'limit')
    }
    if (kind === 'name') {
      if (input.include !== undefined || input.caseSensitive !== undefined || input.contextLines !== undefined) {
        throw new Error('Content search fields are invalid for a name search.')
      }
    } else {
      const include = approvalOptionalText(input.include, 'include', 128)
      if (include && !/^[a-zA-Z0-9._*?\[\]-]+$/.test(include)) throw new Error('include is invalid.')
      if (include) normalized.include = include
      normalized.caseSensitive = approvalBoolean(input.caseSensitive, false, 'caseSensitive')
      normalized.contextLines = approvalInteger(input.contextLines, 0, 0, 5, 'contextLines')
    }
    return hostApprovalDescriptor(target, normalized, { autoApprovable: false })
  }
  if (toolName === CLASSIC_AGENT_ACCESS_MCP_RESOURCE_TOOL) {
    assertApprovalInputKeys(input, ['serverName', 'uri'])
    const serverName = approvalText(input.serverName, 'serverName', 128)
    const uri = approvalText(input.uri, 'uri', 2048)
    const resource = active.mcpResources.get(mcpResourceKey(serverName, uri))
    if (!resource) throw new Error('MCP resource is not enabled for this Cline Agent turn.')
    return {
      input: { serverName: resource.serverName, uri: resource.uri },
      bindingFingerprint: toolInputFingerprint('mcp-resource-approval-binding', resource),
      serverName: resource.serverName,
      resourceUri: resource.uri,
      autoApprovable: false
    }
  }
  throw new Error(`Tool does not use sensitive approval: ${toolName}`)
}

const toolAllowedForProfile = (profile: ClineAgentProfile, toolName: string) =>
  PROFILE_TOOL_NAMES[profile]?.includes(toolName) === true

const validateProfileTools = (
  profile: ClineAgentProfile,
  tools: ClineAgentToolDefinition[],
  hostTargetCount = 0
) => {
  const configured = PROFILE_TOOL_NAMES[profile]
  const expected = profile === 'classic-agent' && hostTargetCount === 0
    ? CLASSIC_AGENT_HOSTLESS_TOOL_NAMES
    : configured
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
    const mustAutoApprove = tool.name !== CLINE_HOST_COMMAND_TOOL && !classicAgentToolRequiresApproval(tool.name)
    if (tool.autoApprove !== mustAutoApprove) {
      throw new Error(`Cline Agent tool ${tool.name} has an invalid approval policy for ${profile}.`)
    }
  }
}

const approvalKey = (taskId: string, turnId: string, toolCallId: string) => `${taskId}\u0000${turnId}\u0000${toolCallId}`

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'Unknown Cline Agent error'))

const safeSessionId = (profile: ClineAgentProfile, key: string) => {
  const normalized = cleanText(key) || 'task'
  const namespace = profile.startsWith('classic-') ? 'classic' : profile
  const slug = normalized.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48) || 'task'
  const digest = createHash('sha256').update(`${namespace}\u0000${normalized}`, 'utf8').digest('hex').slice(0, 16)
  return `aiopsterm-${namespace}-${slug}-${digest}`
}

export const clineAgentSessionIdFor = (profile: ClineAgentProfile, conversationKey: string) =>
  safeSessionId(profile, conversationKey)

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

const abortDatabaseTools = (active: ActiveTurn) => {
  for (const controller of active.databaseToolControllers) controller.abort()
  active.databaseToolControllers.clear()
}

const abortAllDatabaseTools = () => {
  for (const active of activeTurnsBySession.values()) abortDatabaseTools(active)
}

const abortHostCommands = (active: ActiveTurn, reason: string) => {
  for (const commandId of active.hostCommandIds) cancelCodexTerminalBridgeCommand(commandId, reason)
  active.hostCommandIds.clear()
}

const abortAllHostCommands = (reason: string) => {
  for (const active of activeTurnsBySession.values()) abortHostCommands(active, reason)
}

const abortActiveTurnWork = (active: ActiveTurn, reason: string, markAborted = true) => {
  if (markAborted) active.abortReason ||= reason
  abortProviderFetches(active)
  abortDatabaseTools(active)
  abortHostCommands(active, reason)
}

const activeTurnAbortError = (active: ActiveTurn) =>
  Object.assign(new Error(active.abortReason || 'The Cline Agent turn was cancelled.'), { name: 'AbortError' })

const releaseActiveTurn = (active: ActiveTurn) => {
  active.resolveSettled()
  if (activeTurnsBySession.get(active.sessionId) === active) activeTurnsBySession.delete(active.sessionId)
  const binding = taskBindings.get(active.taskId)
  if (binding?.sessionId === active.sessionId) taskBindings.delete(active.taskId)
}

const settleActiveTurns = () => {
  for (const active of activeTurnsBySession.values()) active.resolveSettled()
}

const waitForTurnGrace = async (settled: Promise<unknown>) => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CLINE_AGENT_SESSION_STOP_GRACE_MS)
    timer.unref?.()
  })
  const completed = await Promise.race([settled.then(() => true, () => true), timeout])
  if (timer) clearTimeout(timer)
  return completed
}

const waitForSessionStopGrace = async (
  manager: ClineAgentSidecarSupervisor,
  request: Promise<unknown>,
  sessionId: string
) => {
  let requestError: unknown
  const observed = request.then(
    () => true,
    (error) => {
      requestError = error
      return false
    }
  )
  const completed = await waitForTurnGrace(observed)
  if (completed && await observed) return true
  const reason = requestError
    ? `session.stop failed: ${errorMessage(requestError)}`
    : `session.stop exceeded ${CLINE_AGENT_SESSION_STOP_GRACE_MS}ms`
  logRuntimeEvent('warn', 'cline-agent.session-stop-isolating', {
    sessionId,
    graceMs: CLINE_AGENT_SESSION_STOP_GRACE_MS,
    ...(requestError ? { errorMessage: errorMessage(requestError) } : {})
  })
  await manager.forceTerminate(reason)
  logRuntimeEvent('info', 'cline-agent.session-stop-isolated', { sessionId })
  return true
}

const waitForAbortingTurn = async (sessionId: string, active: ActiveTurn) => {
  if (!active.abortReason) throw new Error('This Cline Agent conversation already has an active turn.')
  if (await waitForTurnGrace(active.settled)) return
  const manager = ensureSupervisor()
  logRuntimeEvent('warn', 'cline-agent.turn-abort-isolating', {
    taskId: active.taskId,
    turnId: active.turnId,
    sessionId,
    graceMs: CLINE_AGENT_SESSION_STOP_GRACE_MS
  })
  await manager.forceTerminate(`Aborted turn ${active.turnId} did not settle within ${CLINE_AGENT_SESSION_STOP_GRACE_MS}ms`)
  abortActiveTurnWork(active, active.abortReason)
  releaseActiveTurn(active)
  logRuntimeEvent('info', 'cline-agent.turn-abort-isolated', { taskId: active.taskId, turnId: active.turnId, sessionId })
}

const waitForSessionLifecycle = async (sessionId: string, register: () => void) => {
  const stopping = sessionStopsById.get(sessionId)
  if (stopping) {
    const stopped = await stopping
    if (!stopped) throw new Error('The Cline Agent session could not be stopped before restart.')
  }
  const active = activeTurnsBySession.get(sessionId)
  if (active) await waitForAbortingTurn(sessionId, active)
  if (activeTurnsBySession.has(sessionId)) throw new Error('This Cline Agent conversation already has an active turn.')
  register()
}

const emitTaskEvent = (event: ClineAgentTaskEvent) => {
  const active = activeTurnsBySession.get(event.sessionId)
  if (!active || active.taskId !== event.taskId || active.turnId !== event.turnId) return
  if (active.terminalEventType) return
  const terminalEventType: TerminalTaskEventType | undefined =
    event.type === 'done' || event.type === 'cancelled' || event.type === 'error' ? event.type : undefined
  if (terminalEventType) active.terminalEventType = terminalEventType
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

const emitTurnResultTerminal = (active: ActiveTurn, result: ClineAgentTurnResult) => {
  if (active.terminalEventType) return
  emitTaskEvent(nextTaskEvent(active, result.finishReason === 'aborted'
    ? { type: 'cancelled', reason: 'aborted' }
    : {
        type: 'done',
        text: result.text,
        finishReason: result.finishReason,
        iterations: result.iterations,
        usage: result.usage
      }))
}

const emitTurnFailureTerminal = (active: ActiveTurn, error: unknown) => {
  if (active.terminalEventType) return
  emitTaskEvent(nextTaskEvent(active, {
    type: 'error',
    errorCode: 'CLINE_AGENT_TURN_FAILED',
    errorMessage: errorMessage(error),
    recoverable: false
  }))
}

const emitTurnCancelledTerminal = (active: ActiveTurn, reason: string) => {
  if (active.terminalEventType) return
  emitTaskEvent(nextTaskEvent(active, { type: 'cancelled', reason }))
}

const handleSidecarEvent = (message: ClineAgentSidecarEvent) => {
  if (message.event !== 'agent.task') return
  const event = message.payload as ClineAgentTaskEvent
  const active = activeTurnsBySession.get(event.sessionId)
  if (!active || active.taskId !== event.taskId || active.turnId !== event.turnId) return
  if (
    event.type === 'tool-call' &&
    (
      event.toolName === CLINE_HOST_COMMAND_TOOL ||
      event.toolName === CLINE_HOST_PROPOSAL_TOOL ||
      classicAgentToolUsesHost(event.toolName)
    )
  ) {
    const targetId = cleanText(recordInput(event.input).targetId)
    const target = active.hostTargets.get(targetId)
    emitTaskEvent({
      ...event,
      seq: active.lastSeq + 1,
      ...(target
        ? {
            targetId: target.targetId,
            targetLabel: target.label,
            terminalSessionId: target.terminalSessionId
          }
        : {})
    } as ClineAgentTaskEvent)
    return
  }
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

const boundedHostToolResult = async (
  response: Awaited<ReturnType<typeof callCodexTerminalBridgeTool>>,
  target: ClineAgentHostTarget,
  active: ActiveTurn,
  toolCallId: string
) => {
  const data = { ...(response.data || {}) }
  if (typeof data.output === 'string') {
    const capturedOutput = data.output
    const output = truncateUtf8(capturedOutput, HOST_TOOL_OUTPUT_MAX_BYTES)
    data.output = output.value
    if ((output.truncated || data.outputTruncated === true) && capturedOutput) {
      try {
        if (!clineAgentOutputStore) throw new Error('Cline Agent output store is unavailable.')
        const stored = await clineAgentOutputStore.write({
          sessionId: active.sessionId,
          taskId: active.taskId,
          turnId: active.turnId,
          toolCallId,
          content: capturedOutput
        })
        data.outputFileRef = stored.fileRef
        data.outputFileBytes = stored.bytes
        data.outputFileComplete = data.outputTruncated !== true
      } catch (error) {
        data.outputFileUnavailable = true
        logRuntimeEvent('warn', 'cline-agent.output-offload-failed', {
          taskId: active.taskId,
          turnId: active.turnId,
          sessionId: active.sessionId,
          toolCallId,
          errorMessage: errorMessage(error)
        })
      }
    }
    if (output.truncated) {
      data.outputTruncated = true
      data.originalOutputBytes = output.originalBytes
    }
  }
  return {
    targetId: target.targetId,
    targetLabel: target.label,
    target: response.target,
    ...data
  }
}

const hostTargetForToolInput = (
  active: ActiveTurn,
  input: Record<string, unknown>,
  options: { required: boolean }
) => {
  const targetId = cleanText(input.targetId)
  if (!targetId) {
    if (options.required || active.hostTargets.size) throw new Error('A bound host targetId is required.')
    return undefined
  }
  const target = active.hostTargets.get(targetId)
  if (!target) throw new Error(`Host target is not allowed for this Cline Agent turn: ${targetId}`)
  return target
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
    const target = hostTargetForToolInput(active, input, { required: false })
    return {
      command,
      rationale: cleanText(input.rationale),
      ...(target ? { targetId: target.targetId, targetLabel: target.label } : {})
    }
  }
  if (active.profile !== 'classic-agent' || toolName !== CLINE_HOST_COMMAND_TOOL) {
    throw new Error(`Tool is not available in ${active.profile}: ${toolName}`)
  }
  const target = hostTargetForToolInput(active, input, { required: true })
  if (!target) throw new Error('The selected aiopsterm host target is unavailable.')
  const { targetId, terminalSessionId } = target
  const bindingFingerprint = hostApprovalDescriptor(target, input, { autoApprovable: false }).bindingFingerprint
  const approval = active.approvedToolCalls.get(toolCallId)
  if (
    !approval ||
    approval.toolName !== toolName ||
    approval.inputFingerprint !== inputFingerprint ||
    approval.bindingFingerprint !== bindingFingerprint
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
  const responseSessionId = cleanText(response.target?.sessionId)
  if (responseSessionId && responseSessionId !== terminalSessionId) {
    throw new Error('Host command result came from a different terminal session than the approved target.')
  }
  return boundedHostToolResult(response, target, active, toolCallId)
}

const readHostCommandOutput = (active: ActiveTurn, input: Record<string, unknown>) => {
  if (!clineAgentOutputStore) throw new Error('Cline Agent output store is unavailable.')
  const unexpected = Object.keys(input).find((key) => key !== 'fileRef' && key !== 'offset' && key !== 'maxBytes')
  if (unexpected) throw new Error(`Unexpected Cline Agent output input field: ${unexpected}`)
  const fileRef = cleanText(input.fileRef)
  if (!fileRef) throw new Error('Cline Agent output fileRef is required.')
  if (input.offset !== undefined && (!Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 8 * 1024 * 1024)) {
    throw new Error('Cline Agent output offset is invalid.')
  }
  if (input.maxBytes !== undefined && (!Number.isInteger(input.maxBytes) || Number(input.maxBytes) < 1 || Number(input.maxBytes) > 128 * 1024)) {
    throw new Error('Cline Agent output maxBytes is invalid.')
  }
  return clineAgentOutputStore.read({
    sessionId: active.sessionId,
    fileRef,
    ...(input.offset !== undefined ? { offset: Number(input.offset) } : {}),
    ...(input.maxBytes !== undefined ? { maxBytes: Number(input.maxBytes) } : {})
  })
}

const executeDatabaseTool = async (
  active: ActiveTurn,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal
) => {
  if (!active.database) throw new Error('The DB AI session has no database binding.')
  if (active.abortReason || signal.aborted) throw activeTurnAbortError(active)
  const result = await callBoundDatabaseAiMcpTool(toolName, input, active.database, { signal })
  if (active.abortReason || signal.aborted) throw activeTurnAbortError(active)
  if (!result) throw new Error(`Unknown database tool: ${toolName}`)
  if (!result.ok) {
    return {
      ok: false,
      errorCode: cleanText(result.errorCode) || 'DB_MCP_TOOL_FAILED',
      errorMessage: cleanText(result.errorMessage) || 'Database tool failed.'
    }
  }
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
  if (active.abortReason) throw activeTurnAbortError(active)
  if (!active.useHostProxy) throw new Error('Host proxy fetch is not enabled for this Cline Agent task.')
  const input = payload as ClineAgentProviderFetchInput
  const url = cleanText(input.url)
  const method = cleanText(input.method).toUpperCase() || 'GET'
  if (!url || !/^[A-Z]+$/.test(method)) throw new Error('Invalid Cline Agent provider fetch request.')
  const headers = providerFetchHeaders(input.headers)
  const body = input.bodyBase64 ? Buffer.from(input.bodyBase64, 'base64') : undefined
  if (body && body.byteLength > CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES) {
    throw new Error(`Cline Agent provider request body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES} bytes.`)
  }
  const proxyFetch = createAiProviderProxyFetch(getRuntimeConfig().getConfig().aiPreferences, {
    maxResponseBytes: CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES
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
    if (responseBody.byteLength > CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES) {
      throw new Error(`Cline Agent provider response body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES} bytes.`)
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

const requestToolApproval = (active: ActiveTurn, payload: Record<string, unknown>) => {
  if (active.abortReason) return Promise.resolve({ approved: false, reason: active.abortReason })
  const toolCallId = cleanText(payload.toolCallId)
  const toolName = cleanText(payload.toolName)
  const input = recordInput(payload.input)
  const rejectionCode = active.profile !== 'classic-agent'
    ? 'profile-not-classic-agent'
    : !toolCallId
      ? 'missing-tool-call-id'
      : !toolAllowedForProfile(active.profile, toolName)
        ? 'tool-not-allowed'
        : toolName !== CLINE_HOST_COMMAND_TOOL && !classicAgentToolRequiresApproval(toolName)
          ? 'tool-does-not-require-approval'
          : ''
  if (rejectionCode) {
    logRuntimeEvent('warn', 'cline-agent.tool-approval-invalid', {
      taskId: active.taskId,
      turnId: active.turnId,
      sessionId: active.sessionId,
      toolCallId,
      toolName,
      rejectionCode,
      hostTargetCount: active.hostTargets.size
    })
    return Promise.resolve({ approved: false, reason: 'Invalid Cline Agent tool approval request.' })
  }
  let descriptor: ToolApprovalDescriptor
  try {
    if (toolName === CLINE_HOST_COMMAND_TOOL) {
      assertApprovalInputKeys(input, ['targetId', 'command', 'requiresApproval', 'timeoutMs'])
      const command = cleanText(input.command)
      const target = hostTargetForToolInput(active, input, { required: true })
      if (!command || !target) throw new Error('Host command and target are required.')
      if (input.requiresApproval !== undefined && typeof input.requiresApproval !== 'boolean') {
        throw new Error('requiresApproval is invalid.')
      }
      const displayInput: Record<string, unknown> = {
        targetId: target.targetId,
        command,
        requiresApproval: input.requiresApproval !== false
      }
      if (input.timeoutMs !== undefined) {
        displayInput.timeoutMs = approvalInteger(input.timeoutMs, 30_000, 1_000, 180_000, 'timeoutMs')
      }
      const security = validateCommandSecurity(normalizeSecurityConfig(getRuntimeConfig().getConfig().securityConfig), command)
      if (!security.isAllowed && !security.requiresApproval) {
        return Promise.resolve({ approved: false, reason: security.reason || 'Command blocked by aiopsterm security policy.' })
      }
      descriptor = hostApprovalDescriptor(target, displayInput, {
        autoApprovable: !security.requiresApproval && input.requiresApproval === false,
        reason: security.reason
      })
    } else {
      descriptor = sensitiveToolApprovalDescriptor(active, toolName, input)
    }
  } catch (error) {
    logRuntimeEvent('warn', 'cline-agent.tool-approval-invalid', {
      taskId: active.taskId,
      turnId: active.turnId,
      sessionId: active.sessionId,
      toolCallId,
      toolName,
      rejectionCode: 'invalid-tool-input',
      errorMessage: errorMessage(error),
      hostTargetCount: active.hostTargets.size
    })
    return Promise.resolve({
      approved: false,
      reason: toolName === CLINE_HOST_COMMAND_TOOL
        ? 'Invalid host command approval request.'
        : 'Invalid Cline Agent sensitive tool approval request.'
    })
  }
  const inputFingerprint = toolInputFingerprint(toolName, input)
  const approved = active.approvedToolCalls.get(toolCallId)
  if (approved) {
    const matches = approved.toolName === toolName &&
      approved.inputFingerprint === inputFingerprint &&
      approved.bindingFingerprint === descriptor.bindingFingerprint
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
      existing.bindingFingerprint !== descriptor.bindingFingerprint
    ) {
      return Promise.resolve({ approved: false, reason: 'Duplicate approval request does not match the pending tool call.' })
    }
    return existing.decision
  }
  const preferences = getRuntimeConfig().getConfig().aiPreferences
  if (
    descriptor.autoApprovable &&
    (
      preferences?.autoExecuteReadOnlyCommands === true ||
      preferences?.autoApproval === true ||
      readOnlyAutoApprovalSessions.has(active.sessionId)
    )
  ) {
    active.approvedToolCalls.set(toolCallId, {
      toolName,
      inputFingerprint,
      bindingFingerprint: descriptor.bindingFingerprint
    })
    return Promise.resolve({ approved: true })
  }
  const event = nextTaskEvent(active, {
    type: 'approval-requested',
    toolCallId,
    toolName,
    ...(descriptor.targetId ? { targetId: descriptor.targetId } : {}),
    ...(descriptor.targetLabel ? { targetLabel: descriptor.targetLabel } : {}),
    ...(descriptor.terminalSessionId ? { terminalSessionId: descriptor.terminalSessionId } : {}),
    ...(descriptor.serverName ? { serverName: descriptor.serverName } : {}),
    ...(descriptor.resourceUri ? { resourceUri: descriptor.resourceUri } : {}),
    input: descriptor.input,
    iteration: Math.max(0, Math.round(Number(payload.iteration) || 0)),
    autoApprovable: descriptor.autoApprovable,
    reason: descriptor.reason
  }) as Extract<ClineAgentTaskEvent, { type: 'approval-requested' }>
  let resolveDecision: PendingApproval['resolve'] = () => undefined
  const rawDecision = new Promise<{ approved: boolean; reason?: string }>((resolve) => {
    resolveDecision = resolve
  })
  const decision = rawDecision.then((result) => {
    if (result.approved) {
      active.approvedToolCalls.set(toolCallId, {
        toolName,
        inputFingerprint,
        bindingFingerprint: descriptor.bindingFingerprint
      })
    }
    return result
  })
  pendingApprovals.set(key, {
    taskId: active.taskId,
    turnId: active.turnId,
    sessionId: active.sessionId,
    toolCallId,
    toolName,
    inputFingerprint,
    bindingFingerprint: descriptor.bindingFingerprint,
    ...(descriptor.targetId ? { targetId: descriptor.targetId } : {}),
    ...(descriptor.targetLabel ? { targetLabel: descriptor.targetLabel } : {}),
    ...(descriptor.terminalSessionId ? { terminalSessionId: descriptor.terminalSessionId } : {}),
    ...(descriptor.serverName ? { serverName: descriptor.serverName } : {}),
    ...(descriptor.resourceUri ? { resourceUri: descriptor.resourceUri } : {}),
    autoApprovable: descriptor.autoApprovable,
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
    if (active.abortReason) throw activeTurnAbortError(active)
    if (toolName === CLINE_HOST_COMMAND_TOOL || toolName === CLINE_HOST_PROPOSAL_TOOL) {
      return executeHostTool(active, toolName, toolCallId, input, inputFingerprint)
    }
    if (active.profile === 'classic-agent' && toolName === CLASSIC_AGENT_READ_HOST_COMMAND_OUTPUT_TOOL) {
      return readHostCommandOutput(active, input)
    }
    if (active.profile === 'classic-agent' && isClassicAgentControlledTool(toolName)) {
      if (!classicAgentToolRuntime) throw new Error('Classic Agent controlled tools are not configured.')
      if (classicAgentToolRequiresApproval(toolName)) {
        const descriptor = sensitiveToolApprovalDescriptor(active, toolName, input)
        const approval = active.approvedToolCalls.get(toolCallId)
        if (
          !approval ||
          approval.toolName !== toolName ||
          approval.inputFingerprint !== inputFingerprint ||
          approval.bindingFingerprint !== descriptor.bindingFingerprint
        ) {
          throw new Error(`The ${toolName} tool call has not been approved by aiopsterm main.`)
        }
      }
      const commandId = classicAgentToolUsesHost(toolName)
        ? `cline_${createHash('sha256')
            .update(`${active.taskId}\u0000${active.turnId}\u0000${toolCallId}`, 'utf8')
            .digest('hex')
            .slice(0, 32)}`
        : undefined
      if (commandId) active.hostCommandIds.add(commandId)
      return classicAgentToolRuntime.execute({
        sessionId: active.sessionId,
        hostTargets: active.hostTargets,
        ...(commandId ? { hostCommandId: commandId } : {})
      }, toolName, input).finally(() => {
        if (commandId) active.hostCommandIds.delete(commandId)
      })
    }
    if (active.profile === 'database') {
      const controller = new AbortController()
      active.databaseToolControllers.add(controller)
      return executeDatabaseTool(active, toolName, input, controller.signal)
        .finally(() => active.databaseToolControllers.delete(controller))
    }
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
  if (message.callback === 'approval.request') return requestToolApproval(active, payload)
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
        abortActiveTurnWork(active, exitError)
        if (!active.terminalEventType) {
          emitTaskEvent(nextTaskEvent(active, {
            type: 'error',
            errorCode: 'CLINE_AGENT_SIDECAR_EXITED',
            errorMessage: exitError,
            recoverable: false
          }))
        }
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
  clineAgentOutputStore = config
    ? config.outputStore || createClineAgentOutputStore({ rootPath: join(config.userDataPath, 'cline-agent-output') })
    : null
  if (clineAgentOutputStore) {
    void clineAgentOutputStore.prune().catch((error) => logRuntimeEvent('warn', 'cline-agent.output-prune-failed', {
      errorMessage: errorMessage(error)
    }))
  }
  classicAgentToolRuntime = config
    ? createClassicAgentToolRuntime({
        userDataPath: config.userDataPath,
        searchKnowledgeBase: config.searchKnowledgeBase,
        getMcpServers: () => config.getConfig().mcpServers || [],
        readMcpResource: config.readMcpResource
      })
    : null
  if (!config) {
    abortAllProviderFetches()
    abortAllDatabaseTools()
    abortAllHostCommands('Cline Agent runtime was reconfigured.')
    rejectPendingApprovals(() => true, 'Cline Agent runtime was reconfigured.')
    supervisor = null
    taskBindings.clear()
    settleActiveTurns()
    activeTurnsBySession.clear()
    sessionStopsById.clear()
    pendingApprovals.clear()
    readOnlyAutoApprovalSessions.clear()
  }
}

export const runClineAgentTurn = async (input: ClineAgentRunInput): Promise<ClineAgentRunOutcome> => {
  const taskId = cleanText(input.taskId)
  const turnId = cleanText(input.turnId)
  const prompt = cleanText(input.prompt)
  if (!taskId || !turnId || !prompt) throw new Error('Cline Agent taskId, turnId, and prompt are required.')
  if (!input.profile.startsWith('classic-') && input.hostTargets?.length) {
    throw new Error(`Host targets are not available in ${input.profile}.`)
  }
  const hostTargets = input.profile.startsWith('classic-')
    ? normalizeHostTargets(input.hostTargets)
    : new Map<string, ClineAgentHostTarget>()
  const mcpResources = input.profile === 'classic-agent'
    ? normalizeBoundMcpResources(getRuntimeConfig().getConfig())
    : new Map<string, BoundMcpResource>()
  validateProfileTools(input.profile, input.tools, hostTargets.size)
  const database = input.database
    ? {
        connectionId: cleanText(input.database.connectionId),
        ...(cleanText(input.database.databaseName) ? { databaseName: cleanText(input.database.databaseName) } : {}),
        ...(cleanText(input.database.schemaName) ? { schemaName: cleanText(input.database.schemaName) } : {})
      }
    : undefined
  if (input.profile === 'database' && !database?.connectionId) {
    throw new Error('DB AI requires a trusted database connection binding.')
  }
  const sessionId = safeSessionId(input.profile, input.conversationKey)
  const ownerWebContentsId = currentClineAgentRendererOwner()
  const binding: AgentTaskBinding = {
    taskId,
    sessionId,
    profile: input.profile,
    useHostProxy: input.provider.useHostProxy === true,
    ...(ownerWebContentsId ? { ownerWebContentsId } : {}),
    hostTargets,
    mcpResources,
    ...(database ? { database } : {})
  }
  let resolveSettled: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  const active: ActiveTurn = {
    ...binding,
    turnId,
    lastSeq: 0,
    providerFetchControllers: new Set(),
    databaseToolControllers: new Set(),
    hostCommandIds: new Set(),
    approvedToolCalls: new Map(),
    toolExecutions: new Map(),
    settled,
    resolveSettled
  }
  await waitForSessionLifecycle(sessionId, () => {
    if (taskBindings.has(taskId)) throw new Error('This Cline Agent task id is already active.')
    taskBindings.set(taskId, binding)
    activeTurnsBySession.set(sessionId, active)
  })
  const startInput: ClineAgentSessionStartInput = {
    sessionId,
    profile: input.profile,
    systemPrompt: input.systemPrompt,
    provider: input.provider,
    tools: input.tools,
    initialMessages: input.initialMessages,
    replaceTranscript: input.replaceTranscript === true || undefined,
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
    const send = manager.request<ClineAgentTurnResult>('session.send', {
      sessionId,
      taskId,
      turnId,
      prompt,
      ...(input.userImages?.length ? { userImages: input.userImages } : {})
    })
    const monitoredSend = send.then(
      (result) => {
        emitTurnResultTerminal(active, result)
        return result
      },
      async (error) => {
        const terminalWasMissing = !active.terminalEventType
        emitTurnFailureTerminal(active, error)
        if (terminalWasMissing) {
          try {
            await manager.request('session.abort', { sessionId, reason: 'main_turn_request_failed' })
          } catch (abortError) {
            logRuntimeEvent('warn', 'cline-agent.turn-failure-abort-failed', {
              taskId,
              turnId,
              sessionId,
              errorMessage: errorMessage(abortError)
            })
          }
        }
        throw error
      }
    )
    const settledSend = monitoredSend.finally(() => {
      abortActiveTurnWork(active, 'The Cline Agent turn ended.', false)
      rejectPendingApprovals(
        (pending) => pending.taskId === taskId && pending.turnId === turnId && pending.sessionId === sessionId,
        'The Cline Agent turn ended before approval completed.'
      )
      releaseActiveTurn(active)
    })
    void settledSend.catch(() => undefined)
    const canRequireOperatorApproval = input.tools.some((tool) => tool.autoApprove === false)
    if (!canRequireOperatorApproval) return { status: 'done', result: await settledSend }
    const outcome = await Promise.race([
      settledSend.then((result) => ({ status: 'done' as const, result })),
      pause.then((event) => ({ status: 'approval-required' as const, event }))
    ])
    return outcome
  } catch (error) {
    abortActiveTurnWork(active, 'The Cline Agent turn failed.')
    rejectPendingApprovals(
      (pending) => pending.taskId === taskId && pending.turnId === turnId && pending.sessionId === sessionId,
      'The Cline Agent turn failed before approval completed.'
    )
    releaseActiveTurn(active)
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
  const toolName = cleanText(input.toolName)
  const targetId = cleanText(input.targetId)
  const targetLabel = cleanText(input.targetLabel)
  const terminalSessionId = cleanText(input.terminalSessionId)
  const serverName = cleanText(input.serverName)
  const resourceUri = cleanText(input.resourceUri)
  const key = approvalKey(taskId, turnId, toolCallId)
  const pending = pendingApprovals.get(key)
  const binding = taskBindings.get(taskId)
  const active = pending ? activeTurnsBySession.get(pending.sessionId) : undefined
  const bindingTarget = binding?.hostTargets.get(targetId)
  const activeTarget = active?.hostTargets.get(targetId)
  const hostBindingMatches = Boolean(
    pending?.targetId &&
    targetId &&
    targetLabel &&
    terminalSessionId &&
    !serverName &&
    !resourceUri &&
    pending.targetId === targetId &&
    pending.targetLabel === targetLabel &&
    pending.terminalSessionId === terminalSessionId &&
    bindingTarget?.terminalSessionId === terminalSessionId &&
    bindingTarget.label === targetLabel &&
    activeTarget?.terminalSessionId === terminalSessionId &&
    activeTarget.label === targetLabel
  )
  const currentMcpResources = pending?.serverName
    ? normalizeBoundMcpResources(getRuntimeConfig().getConfig())
    : new Map<string, BoundMcpResource>()
  const resourceKey = mcpResourceKey(serverName, resourceUri)
  const resourceBindingMatches = Boolean(
    pending?.serverName &&
    serverName &&
    resourceUri &&
    !targetId &&
    !targetLabel &&
    !terminalSessionId &&
    pending.serverName === serverName &&
    pending.resourceUri === resourceUri &&
    binding?.mcpResources.has(resourceKey) &&
    active?.mcpResources.has(resourceKey) &&
    currentMcpResources.has(resourceKey)
  )
  if (
    !pending ||
    !binding ||
    !active ||
    !toolName ||
    typeof input.approved !== 'boolean' ||
    pending.taskId !== taskId ||
    pending.turnId !== turnId ||
    pending.toolName !== toolName ||
    binding.sessionId !== pending.sessionId ||
    active.taskId !== taskId ||
    active.turnId !== turnId ||
    (!hostBindingMatches && !resourceBindingMatches) ||
    (effectiveOwnerWebContentsId !== undefined && binding.ownerWebContentsId !== effectiveOwnerWebContentsId)
  ) {
    return { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_NOT_FOUND', errorMessage: 'The Cline Agent approval is no longer pending.' }
  }
  const enableReadOnlyAutoRun = input.approved === true && input.enableReadOnlyAutoRun === true
  if (input.enableReadOnlyAutoRun === true && !enableReadOnlyAutoRun) {
    return { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_INVALID', errorMessage: 'Read-only auto-run requires an approved Cline Agent command.' }
  }
  if (enableReadOnlyAutoRun && (pending.toolName !== CLINE_HOST_COMMAND_TOOL || !pending.autoApprovable)) {
    return { ok: false, errorCode: 'CLINE_AGENT_READ_ONLY_AUTO_RUN_DENIED', errorMessage: 'This command is not eligible for read-only auto-run.' }
  }
  if (enableReadOnlyAutoRun) readOnlyAutoApprovalSessions.add(pending.sessionId)
  pendingApprovals.delete(key)
  pending.resolve({ approved: input.approved === true, reason: cleanText(input.reason) || undefined })
  return {
    ok: true,
    data: {
      taskId,
      turnId,
      toolCallId,
      toolName,
      ...(hostBindingMatches ? { targetId, targetLabel, terminalSessionId } : {}),
      ...(resourceBindingMatches ? { serverName, resourceUri } : {}),
      status: input.approved ? 'approved' : 'rejected',
      ...(enableReadOnlyAutoRun ? { readOnlyAutoRunEnabled: true } : {})
    }
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
    const reason = cleanText(input.reason) || 'The operator cancelled the Agent turn.'
    abortActiveTurnWork(active, reason)
    emitTurnCancelledTerminal(active, reason)
    void ensureSupervisor().request('session.abort', {
      sessionId: binding.sessionId,
      reason: cleanText(input.reason) || 'user_abort'
    })
      .catch((error) => logRuntimeEvent('warn', 'cline-agent.task-abort-failed', {
        taskId,
        turnId: active.turnId,
        sessionId: binding.sessionId,
        errorMessage: errorMessage(error)
      }))
  }
  return { ok: true, data: { taskId, ...(input.turnId ? { turnId: input.turnId } : {}), status: 'cancelled' } }
}

export const closeClineAgentRuntime = async () => {
  rejectPendingApprovals(() => true, 'aiopsterm is shutting down.')
  abortAllProviderFetches()
  abortAllDatabaseTools()
  abortAllHostCommands('aiopsterm is shutting down.')
  try {
    await supervisor?.shutdown()
  } finally {
    abortAllProviderFetches()
    abortAllDatabaseTools()
    abortAllHostCommands('aiopsterm is shutting down.')
    supervisor = null
    settleActiveTurns()
    activeTurnsBySession.clear()
    sessionStopsById.clear()
    taskBindings.clear()
    readOnlyAutoApprovalSessions.clear()
  }
}

export const stopClineAgentSession = async (sessionIdInput: string): Promise<boolean> => {
  const sessionId = cleanText(sessionIdInput)
  if (!sessionId || !supervisor) return false
  const existing = sessionStopsById.get(sessionId)
  if (existing) return existing
  const manager = supervisor
  const stopping = (async () => {
    const active = activeTurnsBySession.get(sessionId)
    if (active) {
      rejectPendingApprovals(
        (pending) => pending.sessionId === sessionId,
        'The product session was closed.'
      )
      abortActiveTurnWork(active, 'The product session was closed.')
      emitTurnCancelledTerminal(active, 'The product session was closed.')
    }
    const stopped = await waitForSessionStopGrace(
      manager,
      manager.request('session.stop', { sessionId }),
      sessionId
    )
    if (active) {
      abortActiveTurnWork(active, 'The product session was closed.')
      releaseActiveTurn(active)
    }
    for (const [taskId, binding] of taskBindings) {
      if (binding.sessionId === sessionId) taskBindings.delete(taskId)
    }
    return stopped
  })()
  sessionStopsById.set(sessionId, stopping)
  try {
    return await stopping
  } finally {
    if (sessionStopsById.get(sessionId) === stopping) sessionStopsById.delete(sessionId)
  }
}

export const deleteClineAgentSession = async (sessionIdInput: string) => {
  const sessionId = cleanText(sessionIdInput)
  if (!sessionId) return false
  const stopping = sessionStopsById.get(sessionId)
  if (stopping) await stopping
  const manager = ensureSupervisor()
  const active = activeTurnsBySession.get(sessionId)
  if (active) {
    rejectPendingApprovals(
      (pending) => pending.sessionId === sessionId,
      'The product session was permanently deleted.'
    )
    abortActiveTurnWork(active, 'The product session was permanently deleted.')
    emitTurnCancelledTerminal(active, 'The product session was permanently deleted.')
    try {
      await manager.request('session.abort', { sessionId, reason: 'product_session_deleted' })
    } catch {
      // session.delete below is the authoritative persistent deletion operation.
    } finally {
      abortActiveTurnWork(active, 'The product session was permanently deleted.')
    }
  }
  const result = await manager.request<{ sessionId: string; deleted: boolean }>('session.delete', { sessionId })
  if (result.deleted && clineAgentOutputStore) {
    try {
      await clineAgentOutputStore.deleteSession(sessionId)
    } catch (error) {
      logRuntimeEvent('warn', 'cline-agent.output-delete-failed', {
        sessionId,
        errorMessage: errorMessage(error)
      })
    }
  }
  readOnlyAutoApprovalSessions.delete(sessionId)
  if (active) releaseActiveTurn(active)
  for (const [taskId, binding] of taskBindings) {
    if (binding.sessionId === sessionId) taskBindings.delete(taskId)
  }
  return result.deleted
}

export const clineAgentDataDir = () => join(getRuntimeConfig().userDataPath, 'cline-agent')
