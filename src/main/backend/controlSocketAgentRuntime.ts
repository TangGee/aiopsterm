import type { ControlResponse } from '@shared/contracts/control'
import type { AgentHookInstallerSource } from '@shared/contracts/agentHooks'
import type { AiAgentSessionSource, ManagedAiSessionBulkOperation, ManagedAiSessionDecisionKind, ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'
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
import { sendTerminalKey } from './controlSocketTerminalTools'

type ControlSocketAgentEventInput = {
  name: string
  category: string
  source?: string
  workspaceId?: string
  surfaceId?: string
  payload?: Record<string, unknown>
}

type ControlSocketAgentRuntime = {
  userDataPath?: string
  writeTerminal?: (sessionId: string, data: string) => Promise<ControlResponse> | ControlResponse
  handleMobileTerminalControlRequest?: (method: string, params: Record<string, unknown>) => Promise<ControlResponse> | ControlResponse
  publishControlEvent?: (input: ControlSocketAgentEventInput) => void
}

export type ControlSocketAgentResourceSummary = (input: { pid?: number; memoryBytes?: number; residentBytes?: number; virtualBytes?: number; processCount?: number }) => Record<string, unknown>

let agentRuntime: ControlSocketAgentRuntime = {}

export const configureControlSocketAgentRuntime = (runtime: ControlSocketAgentRuntime = {}) => {
  agentRuntime = { ...agentRuntime, ...runtime }
}

export const isControlMobileChatMethod = (method: string) => method.startsWith('mobile.chat.') || method === 'chat.sessions.dump'

export const isControlAgentSessionMethod = (method: string) => method.startsWith('agent.session.') || method.startsWith('agent.sessions.') || method.startsWith('ai.session.')

export const isControlAgentHooksMethod = (method: string) => method.startsWith('agent.hooks.') || method.startsWith('hooks.')

export const isControlFeedMethod = (method: string) => method.startsWith('feed.')

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  const text = cleanText(value)
  if (!text) return []
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const normalizeLimit = (value: unknown, fallback = 50) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(200, Math.floor(numberValue)))
}

const ok = (data: Record<string, unknown> = {}): ControlResponse => ({ ok: true, data })

const fail = (errorCode: string, errorMessage: string, data?: Record<string, unknown>): ControlResponse => ({
  ok: false,
  errorCode,
  errorMessage,
  ...(data ? { data } : {})
})

const publishAgentControlEvent = (input: ControlSocketAgentEventInput) => {
  agentRuntime.publishControlEvent?.(input)
}

const ensureAgentSessionStore = async () => {
  if (agentRuntime.userDataPath) await configureAiAgentSessionStore(agentRuntime.userDataPath)
}

export const codingAgentSummaries = async (resourceSummary: ControlSocketAgentResourceSummary) => {
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

export const handleMobileChatControlRequest = async (method: string, params: Record<string, unknown>) => {
  await ensureAgentSessionStore()
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
      session.terminalSessionId && agentRuntime.writeTerminal
        ? await agentRuntime.writeTerminal(session.terminalSessionId, payload)
        : agentRuntime.handleMobileTerminalControlRequest
          ? await agentRuntime.handleMobileTerminalControlRequest('terminal.paste', { ...target, text, submit_key: params.submit_key || params.submitKey || 'return' })
          : fail('MOBILE_CHAT_TERMINAL_UNAVAILABLE', 'Mobile terminal control is unavailable for this agent session.', { session_id: session.id })
    if (!response.ok) return response
    publishAgentControlEvent({
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
    publishAgentControlEvent({
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
    publishAgentControlEvent({
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
  publishAgentControlEvent({
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

export const handleAgentSessionControlRequest = async (method: string, params: Record<string, unknown>) => {
  await ensureAgentSessionStore()
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
    publishAgentControlEvent({
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
    publishAgentControlEvent({
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
    publishAgentControlEvent({
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

export const handleAgentHooksControlRequest = async (method: string, params: Record<string, unknown>) => {
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

export const handleFeedControlRequest = async (method: string, params: Record<string, unknown>) => {
  await ensureAgentSessionStore()
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
    publishAgentControlEvent({
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
