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
  data?: Record<string, unknown>
}

export type CodexTerminalBridgeTargetUpdateResult = {
  sessionId?: string
  target?: CodexSessionTargetContext
  registered: boolean
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
let preferredSessionStrict = false

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeBoolean = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : fallback)

const normalizeInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numberValue)))
}

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

export const setCodexTerminalBridgePreferredSession = (sessionId?: string, options: { strict?: boolean } = {}) => {
  preferredSessionId = cleanText(sessionId)
  preferredSessionStrict = Boolean(options.strict)
}

export const registerCodexTerminalBridgeSession = (session: CodexTerminalBridgeSession) => {
  sessions.set(session.id, session)
}

export const updateCodexTerminalBridgeSessionTarget = (target?: CodexSessionTargetContext | null): CodexTerminalBridgeTargetUpdateResult => {
  const sessionId = cleanText(target?.sessionId)
  setCodexTerminalBridgePreferredSession(sessionId, { strict: true })
  if (!sessionId) {
    return {
      registered: false,
      ...(target ? { target } : {})
    }
  }
  const session = sessions.get(sessionId)
  if (!session) {
    return {
      sessionId,
      registered: false,
      ...(target ? { target } : {})
    }
  }
  if (target) session.target = { ...(session.target || {}), ...target, sessionId }
  if (target?.cwd) session.cwd = target.cwd
  if (target?.host) session.host = target.host
  return {
    sessionId,
    target: targetContextForSession(session),
    registered: true
  }
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
  if (preferredSessionId) {
    const preferred = sessions.get(preferredSessionId) || null
    if (preferred || preferredSessionStrict) return preferred
  }
  if (preferredSessionStrict) return null
  const candidates = [...sessions.values()].filter((session) => session.kind === 'ssh')
  return candidates[candidates.length - 1] || [...sessions.values()][0] || null
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const outputLines = (output: unknown) =>
  String(output || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

const remoteBasePattern = (basePath: string, pattern: string) => {
  if (pattern.startsWith('/')) return pattern
  const cleanBase = basePath.replace(/\/+$/g, '') || '.'
  if (cleanBase === '.') return `./${pattern}`
  return `${cleanBase}/${pattern}`
}

const parseGrepMatches = (output: string) =>
  outputLines(output)
    .map((line) => {
      const match = line.match(/^(.+):(\d+):(.*)$/)
      if (!match) return null
      return {
        path: match[1],
        line: Number(match[2]),
        text: match[3]
      }
    })
    .filter((match): match is { path: string; line: number; text: string } => Boolean(match))

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

const runStructuredReadOnlyCommand = async (
  params: Record<string, unknown>,
  command: string,
  transform: (responseData: Record<string, unknown>) => Record<string, unknown>,
  options: { okExitCodes?: number[]; errorCode: string; errorMessage: string }
): Promise<CodexBridgeResponse> => {
  const response = await runTerminalCommand({
    sessionId: params.sessionId,
    timeoutMs: params.timeoutMs,
    command
  })
  if (!response.ok) return response
  const responseData = response.data || {}
  const exitCode = typeof responseData.exitCode === 'number' ? responseData.exitCode : null
  const okExitCodes = options.okExitCodes || [0]
  if (exitCode !== null && !okExitCodes.includes(exitCode)) {
    return {
      ok: false,
      errorCode: options.errorCode,
      errorMessage: options.errorMessage,
      target: response.target,
      data: {
        ...responseData,
        ...transform(responseData)
      }
    }
  }
  return {
    ok: true,
    target: response.target,
    data: {
      ...responseData,
      ...transform(responseData)
    }
  }
}

const readRemoteFile = async (params: Record<string, unknown>): Promise<CodexBridgeResponse> => {
  const filePath = cleanText(params.path)
  if (!filePath) return { ok: false, errorCode: 'FILE_PATH_REQUIRED', errorMessage: 'File path is required.' }
  const offset = normalizeInteger(params.offset, 0, 0, 10_000_000)
  const limit = normalizeInteger(params.limit, 200, 1, 1000)
  const startLine = offset + 1
  const endLine = offset + limit
  const command = `LC_ALL=C sed -n ${shellQuote(`${startLine},${endLine}p`)} ${shellQuote(filePath)}`
  return runStructuredReadOnlyCommand(
    params,
    command,
    (data) => ({
      path: filePath,
      offset,
      limit,
      content: String(data.output || '')
    }),
    {
      errorCode: 'READ_FILE_FAILED',
      errorMessage: `Failed to read remote file: ${filePath}`
    }
  )
}

const globRemoteFiles = async (params: Record<string, unknown>): Promise<CodexBridgeResponse> => {
  const pattern = cleanText(params.pattern)
  if (!pattern) return { ok: false, errorCode: 'GLOB_PATTERN_REQUIRED', errorMessage: 'Glob pattern is required.' }
  const basePath = cleanText(params.path) || '.'
  const limit = normalizeInteger(params.limit, 200, 1, 2000)
  const sort = cleanText(params.sort) === 'none' ? 'none' : 'path'
  const hasPathPattern = pattern.includes('/') || pattern.includes('*') || pattern.includes('?') || pattern.includes('[')
  const matchExpression = hasPathPattern ? `-path ${shellQuote(remoteBasePattern(basePath, pattern))}` : `-name ${shellQuote(pattern)}`
  const sortPipe = sort === 'none' ? '' : ' | LC_ALL=C sort'
  const command = `test -e ${shellQuote(basePath)} && LC_ALL=C find ${shellQuote(basePath)} ${matchExpression} -print${sortPipe} | head -n ${limit}`
  return runStructuredReadOnlyCommand(
    params,
    command,
    (data) => {
      const entries = outputLines(data.output)
      return {
        pattern,
        path: basePath,
        limit,
        sort,
        entries,
        count: entries.length
      }
    },
    {
      errorCode: 'GLOB_SEARCH_FAILED',
      errorMessage: `Failed to search remote files for pattern: ${pattern}`
    }
  )
}

const grepRemoteFiles = async (params: Record<string, unknown>): Promise<CodexBridgeResponse> => {
  const pattern = cleanText(params.pattern)
  if (!pattern) return { ok: false, errorCode: 'GREP_PATTERN_REQUIRED', errorMessage: 'Search pattern is required.' }
  const basePath = cleanText(params.path) || '.'
  const include = cleanText(params.include)
  const caseSensitive = normalizeBoolean(params.case_sensitive, false)
  const contextLines = normalizeInteger(params.context_lines, 0, 0, 5)
  const maxMatches = normalizeInteger(params.max_matches, 100, 1, 1000)
  const flags = ['-R', '-n', '-I', '-E', '-m', String(maxMatches)]
  if (!caseSensitive) flags.push('-i')
  if (contextLines > 0) flags.push('-C', String(contextLines))
  const includeArg = include ? `${shellQuote(`--include=${include}`)} ` : ''
  const command = `test -e ${shellQuote(basePath)} || exit 2; LC_ALL=C grep ${flags.join(' ')} ${includeArg}-- ${shellQuote(pattern)} ${shellQuote(basePath)}`
  return runStructuredReadOnlyCommand(
    params,
    command,
    (data) => {
      const output = String(data.output || '')
      const matches = contextLines === 0 ? parseGrepMatches(output) : []
      return {
        pattern,
        path: basePath,
        ...(include ? { include } : {}),
        caseSensitive,
        contextLines,
        maxMatches,
        output,
        matches,
        count: matches.length || outputLines(output).length
      }
    },
    {
      okExitCodes: [0, 1],
      errorCode: 'GREP_SEARCH_FAILED',
      errorMessage: `Failed to search remote file contents for pattern: ${pattern}`
    }
  )
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
  if (request.method === 'read_file') return readRemoteFile(params)
  if (request.method === 'glob_search') return globRemoteFiles(params)
  if (request.method === 'grep_search') return grepRemoteFiles(params)
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
  preferredSessionStrict = false
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}
