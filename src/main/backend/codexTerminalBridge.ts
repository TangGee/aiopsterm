import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir } from 'fs/promises'
import type { BrowserWindow } from 'electron'
import type { CodexSessionTargetContext } from '@shared/preload'

export type CodexTerminalBridgeSession = {
  id: string
  kind: 'local' | 'ssh'
  host?: string
  cwd?: string
  window: BrowserWindow
  write(data: string | Buffer): void
  target?: CodexSessionTargetContext
}

type PendingCommand = {
  id: string
  sessionId: string
  startedAt: number
  markerStart: string
  markerEndPrefix: string
  output: string
  resolve: (value: CodexBridgeResponse) => void
  timer: NodeJS.Timeout
}

type CodexBridgeResponse = {
  ok: boolean
  errorCode?: string
  errorMessage?: string
  target?: CodexSessionTargetContext
  data?: {
    commandId?: string
    command?: string
    output?: string
    exitCode?: number | null
    durationMs?: number
  }
}

type CodexTerminalBridgeRequest = {
  id?: string
  method?: string
  params?: Record<string, unknown>
}

const sessions = new Map<string, CodexTerminalBridgeSession>()
const pendingCommands = new Map<string, PendingCommand>()

let server: Server | null = null
let socketPath = ''
let preferredSessionId = ''

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeTimeoutMs = (value: unknown) => {
  const timeout = Number(value)
  if (!Number.isFinite(timeout)) return 30000
  return Math.max(1000, Math.min(180000, Math.round(timeout)))
}

const bridgeSocketPathFor = (userDataPath: string) => {
  if (process.platform === 'win32') return `\\\\.\\pipe\\aiopsterm-codex-${process.pid}`
  return join(userDataPath, 'codex-agent', `aiopsterm-codex-${process.pid}.sock`)
}

export const getCodexTerminalBridgeSocketPath = () => socketPath

export const setCodexTerminalBridgePreferredSession = (sessionId?: string) => {
  preferredSessionId = cleanText(sessionId)
}

export const registerCodexTerminalBridgeSession = (session: CodexTerminalBridgeSession) => {
  sessions.set(session.id, session)
}

export const unregisterCodexTerminalBridgeSession = (id: string) => {
  sessions.delete(id)
  for (const [commandId, pending] of pendingCommands.entries()) {
    if (pending.sessionId !== id) continue
    clearTimeout(pending.timer)
    pendingCommands.delete(commandId)
    pending.resolve({
      ok: false,
      errorCode: 'TERMINAL_SESSION_CLOSED',
      errorMessage: 'The selected aiopsterm terminal session closed before command output completed.'
    })
  }
}

export const appendCodexTerminalBridgeData = (sessionId: string, chunk: string | Buffer) => {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  if (!text) return
  for (const [commandId, pending] of pendingCommands.entries()) {
    if (pending.sessionId !== sessionId) continue
    pending.output += text
    const completed = extractCompletedMarkedOutput(pending.output, pending.markerStart, pending.markerEndPrefix)
    if (!completed) continue
    clearTimeout(pending.timer)
    pendingCommands.delete(commandId)
    pending.resolve({
      ok: true,
      target: sessions.get(sessionId)?.target,
      data: {
        commandId,
        output: completed.output.trim(),
        exitCode: completed.exitCode,
        durationMs: Date.now() - pending.startedAt
      }
    })
  }
}

const stripTerminalControl = (value: string) =>
  value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '')

const extractMarkedOutput = (value: string, markerStart: string) => {
  const cleaned = stripTerminalControl(value)
  const lines = cleaned.split('\n')
  let startLineIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === markerStart) startLineIndex = index
  }
  if (startLineIndex >= 0) return lines.slice(startLineIndex + 1).join('\n')
  const fallbackIndex = cleaned.lastIndexOf(markerStart)
  return fallbackIndex >= 0 ? cleaned.slice(fallbackIndex + markerStart.length) : cleaned
}

const extractCompletedMarkedOutput = (value: string, markerStart: string, markerEndPrefix: string) => {
  const cleaned = stripTerminalControl(value)
  const lines = cleaned.split('\n')
  let endLineIndex = -1
  let exitCode: number | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith(markerEndPrefix)) continue
    const rawCode = line.slice(markerEndPrefix.length).trim()
    if (!/^-?\d+$/.test(rawCode)) continue
    endLineIndex = index
    exitCode = Number(rawCode)
    break
  }
  if (endLineIndex < 0) return null
  const beforeEnd = lines.slice(0, endLineIndex).join('\n')
  return {
    output: extractMarkedOutput(beforeEnd, markerStart),
    exitCode
  }
}

const targetContextForSession = (session: CodexTerminalBridgeSession): CodexSessionTargetContext => ({
  kind: session.kind,
  sessionId: session.id,
  label: session.target?.label || session.target?.assetName || session.target?.host || (session.kind === 'local' ? 'Local terminal' : 'SSH terminal'),
  ...(session.host ? { host: session.host } : {}),
  ...(session.cwd ? { cwd: session.cwd } : {}),
  ...(session.target || {})
})

const resolveTargetSession = (params: Record<string, unknown>): CodexTerminalBridgeSession | null => {
  const requestedSessionId = cleanText(params.sessionId)
  if (requestedSessionId) return sessions.get(requestedSessionId) || null
  if (preferredSessionId && sessions.has(preferredSessionId)) return sessions.get(preferredSessionId) || null
  const candidates = [...sessions.values()].filter((session) => session.kind === 'ssh')
  return candidates[candidates.length - 1] || [...sessions.values()][0] || null
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const buildWrappedCommand = (command: string, markerStart: string, markerEnd: string) => {
  return [
    'echo ',
    shellQuote(markerStart),
    '; ',
    command,
    '; __aiopsterm_status=$?; echo ',
    shellQuote(markerEnd),
    ':$__aiopsterm_status',
    '\n'
  ].join('')
}

const runTerminalCommand = async (params: Record<string, unknown>): Promise<CodexBridgeResponse> => {
  const session = resolveTargetSession(params)
  if (!session) {
    return {
      ok: false,
      errorCode: 'NO_TERMINAL_SESSION',
      errorMessage: 'No connected aiopsterm terminal session is available. Select or connect a terminal before running remote commands.'
    }
  }
  const command = cleanText(params.command)
  if (!command) {
    return { ok: false, errorCode: 'EMPTY_COMMAND', errorMessage: 'Command must not be empty.' }
  }
  const commandId = (cleanText(params.commandId) || `aiopsterm-${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '_')
  const markerStart = `__AIOPSTERM_CODEX_START_${commandId}__`
  const markerEndPrefix = `__AIOPSTERM_CODEX_END_${commandId}__:`
  const timeoutMs = normalizeTimeoutMs(params.timeoutMs)
  const startedAt = Date.now()
  const wrapped = buildWrappedCommand(command, markerStart, `__AIOPSTERM_CODEX_END_${commandId}__`)

  return new Promise<CodexBridgeResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = pendingCommands.get(commandId)
      pendingCommands.delete(commandId)
      resolve({
        ok: false,
        errorCode: 'COMMAND_TIMEOUT',
        errorMessage: `Command timed out after ${timeoutMs}ms.`,
        target: targetContextForSession(session),
        data: {
          commandId,
          command,
          output: stripTerminalControl(pending?.output || '').trim(),
          exitCode: null,
          durationMs: Date.now() - startedAt
        }
      })
    }, timeoutMs)
    pendingCommands.set(commandId, {
      id: commandId,
      sessionId: session.id,
      startedAt,
      markerStart,
      markerEndPrefix,
      output: '',
      resolve,
      timer
    })
    try {
      session.write(wrapped)
    } catch (error) {
      clearTimeout(timer)
      pendingCommands.delete(commandId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  }).then((response) => ({
    ...response,
    target: response.target || targetContextForSession(session),
    data: response.data ? { ...response.data, commandId, command } : response.data
  }))
}

const targetContext = (params: Record<string, unknown>): CodexBridgeResponse => {
  const session = resolveTargetSession(params)
  if (!session) {
    return {
      ok: false,
      errorCode: 'NO_TERMINAL_SESSION',
      errorMessage: 'No connected aiopsterm terminal session is available.'
    }
  }
  return { ok: true, target: targetContextForSession(session) }
}

const handleBridgeRequest = async (request: CodexTerminalBridgeRequest): Promise<CodexBridgeResponse> => {
  const params = request.params || {}
  if (request.method === 'run_command') return runTerminalCommand(params)
  if (request.method === 'target_context') return targetContext(params)
  return {
    ok: false,
    errorCode: 'UNKNOWN_METHOD',
    errorMessage: `Unknown aiopsterm bridge method: ${request.method || ''}`
  }
}

const writeSocketResponse = (socket: Socket, id: string | undefined, response: CodexBridgeResponse) => {
  socket.write(`${JSON.stringify({ id, ...response })}\n`)
}

export const ensureCodexTerminalBridgeServer = async (userDataPath: string) => {
  if (server && socketPath) return socketPath
  socketPath = bridgeSocketPathFor(userDataPath)
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const newlineIndex = buffer.indexOf('\n')
        if (newlineIndex < 0) return
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue
        let request: CodexTerminalBridgeRequest
        try {
          request = JSON.parse(line) as CodexTerminalBridgeRequest
        } catch (error) {
          writeSocketResponse(socket, undefined, {
            ok: false,
            errorCode: 'INVALID_JSON',
            errorMessage: error instanceof Error ? error.message : String(error)
          })
          continue
        }
        void handleBridgeRequest(request)
          .then((response) => writeSocketResponse(socket, request.id, response))
          .catch((error) =>
            writeSocketResponse(socket, request.id, {
              ok: false,
              errorCode: 'BRIDGE_REQUEST_FAILED',
              errorMessage: error instanceof Error ? error.message : String(error)
            })
          )
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      server?.off('listening', done)
      reject(error)
    }
    const done = () => {
      server?.off('error', fail)
      resolve()
    }
    server?.once('error', fail)
    server?.once('listening', done)
    server?.listen(socketPath)
  })
  return socketPath
}

export const closeCodexTerminalBridgeServer = () => {
  for (const pending of pendingCommands.values()) clearTimeout(pending.timer)
  pendingCommands.clear()
  sessions.clear()
  preferredSessionId = ''
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}
