import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import type { AiAgentSessionEvent, AiAgentSessionEventInput, AiAgentSessionEventResult } from '@shared/preload'

export type AgentSessionEventSink = (event: AiAgentSessionEvent) => void

type AgentSessionSocketRuntime = {
  userDataPath: string
  emit: AgentSessionEventSink
}

const supportedSources = new Set(['codex', 'claude-code', 'claude'])
const supportedEvents = new Set<AiAgentSessionEvent['event']>([
  'session_start',
  'prompt_submit',
  'pre_tool_use',
  'permission_request',
  'question',
  'notification',
  'stop',
  'session_end'
])

let server: Server | null = null
let socketPath = ''
let eventSink: AgentSessionEventSink | null = null

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const cleanOptionalText = (value: unknown) => {
  const text = cleanText(value)
  return text || undefined
}

const normalizeSource = (value: unknown): AiAgentSessionEvent['source'] | null => {
  const source = cleanText(value).toLowerCase()
  if (!supportedSources.has(source)) return null
  return source === 'claude' ? 'claude-code' : (source as AiAgentSessionEvent['source'])
}

const normalizeEventName = (value: unknown): AiAgentSessionEvent['event'] | null => {
  const raw = cleanText(value)
  if (!raw) return null
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
  const aliases: Record<string, AiAgentSessionEvent['event']> = {
    sessionstart: 'session_start',
    session_start: 'session_start',
    userpromptsubmit: 'prompt_submit',
    user_prompt_submit: 'prompt_submit',
    promptsubmit: 'prompt_submit',
    prompt_submit: 'prompt_submit',
    pretooluse: 'pre_tool_use',
    pre_tool_use: 'pre_tool_use',
    permissionrequest: 'permission_request',
    permission_request: 'permission_request',
    askuserquestion: 'question',
    ask_user_question: 'question',
    question: 'question',
    notification: 'notification',
    notify: 'notification',
    stop: 'stop',
    sessionend: 'session_end',
    session_end: 'session_end'
  }
  return aliases[normalized] || (supportedEvents.has(normalized as AiAgentSessionEvent['event']) ? (normalized as AiAgentSessionEvent['event']) : null)
}

const firstText = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const text = cleanOptionalText(record[key])
    if (text) return text
  }
  return undefined
}

const eventTitle = (source: AiAgentSessionEvent['source'], event: AiAgentSessionEvent['event'], input: Record<string, unknown>) =>
  firstText(input, ['title', 'summary']) ||
  (event === 'permission_request'
    ? `${source} needs approval`
    : event === 'question'
      ? `${source} needs input`
      : event === 'notification'
        ? `${source} notification`
        : source)

const eventSummary = (event: AiAgentSessionEvent['event'], input: Record<string, unknown>) =>
  firstText(input, ['summary', 'message', 'body', 'text', 'prompt', 'lastAssistantMessage', 'last_assistant_message']) ||
  (event === 'stop' ? 'Turn complete' : '')

export const normalizeAiAgentSessionEventInput = (input: unknown, now = Date.now()): AiAgentSessionEventResult => {
  if (!input || typeof input !== 'object') {
    return { ok: false, errorCode: 'AI_AGENT_EVENT_INVALID', errorMessage: 'AI agent event must be a JSON object.' }
  }
  const record = input as Record<string, unknown>
  const source = normalizeSource(record.source || record.agent || record.agentName || record.agent_name)
  if (!source) {
    return { ok: false, errorCode: 'AI_AGENT_EVENT_SOURCE_INVALID', errorMessage: 'AI agent event source must be codex or claude-code.' }
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
  const cwd = cleanOptionalText(record.cwd || record.workingDirectory || record.working_directory)
  const transcriptPath = cleanOptionalText(record.transcriptPath || record.transcript_path)
  const normalized: AiAgentSessionEvent = {
    source,
    event,
    sessionId,
    title: eventTitle(source, event, record),
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

export const publishAiAgentSessionEvent = (input: AiAgentSessionEventInput, emit: AgentSessionEventSink | null = eventSink) => {
  const result = normalizeAiAgentSessionEventInput(input)
  if (!result.ok || !result.data) return result
  emit?.(result.data)
  return result
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

export const getAiAgentSessionSocketPath = () => socketPath

export const ensureAiAgentSessionServer = async ({ userDataPath, emit }: AgentSessionSocketRuntime) => {
  eventSink = emit
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
