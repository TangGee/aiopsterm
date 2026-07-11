import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { mkdir } from 'fs/promises'
import type { BrowserWindow } from 'electron'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'
import { platformSocketPath } from '../app/platformRuntime'
import type { TerminalBackgroundCommandOptions, TerminalBackgroundCommandResult } from '../terminal/terminal'

export type CodexTerminalBridgeSession = {
  id: string
  kind: 'local' | 'ssh'
  host?: string
  cwd?: string
  window: BrowserWindow
  write(data: string | Buffer): void
  runBackgroundCommand?(options: TerminalBackgroundCommandOptions): Promise<TerminalBackgroundCommandResult>
  target?: CodexSessionTargetContext
}

type PendingCommand = {
  id: string
  sessionId: string
  command: string
  startedAt: number
  markerStart: string
  markerEnd: string
  markerEndPrefix: string
  output: string
  displayPhase: 'suppress-until-start' | 'forward-until-end' | 'done'
  displayBuffer: string
  displayCommandShown: boolean
  displayPromptPrefix: string
  resolve: (value: CodexBridgeResponse) => void
  timer: NodeJS.Timeout
}

type TerminalOutputHistory = {
  lines: string[]
  pending: string
  startOffset: number
  totalLines: number
  updatedAt: number
}

export type CodexBridgeResponse = {
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
const terminalOutputHistories = new Map<string, TerminalOutputHistory>()

let server: Server | null = null
let socketPath = ''
let preferredSessionId = ''
let preferredSessionStrict = false

const terminalOutputHistoryMaxLines = 10000
// 只发 \r 不发 \n 的进度流（wget/npm 等）不会触发换行落盘，pending 必须有硬上限。
const terminalOutputHistoryPendingMaxLength = 64 * 1024

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
  return platformSocketPath(userDataPath, 'aiopsterm-codex', { directory: 'codex-agent' })
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
  terminalOutputHistories.delete(id)
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

const newTerminalOutputHistory = (): TerminalOutputHistory => ({
  lines: [],
  pending: '',
  startOffset: 0,
  totalLines: 0,
  updatedAt: Date.now()
})

const terminalOutputHistoryForSession = (sessionId: string) => {
  const existing = terminalOutputHistories.get(sessionId)
  if (existing) return existing
  const history = newTerminalOutputHistory()
  terminalOutputHistories.set(sessionId, history)
  return history
}

const trimTerminalOutputHistory = (history: TerminalOutputHistory) => {
  const overflow = history.lines.length - terminalOutputHistoryMaxLines
  if (overflow <= 0) return
  history.lines.splice(0, overflow)
  history.startOffset += overflow
}

const terminalClearSequencePattern = /\u001bc|\u001b\[(?:2|3)J/g

const resetTerminalOutputHistory = (history: TerminalOutputHistory) => {
  history.lines = []
  history.pending = ''
  history.startOffset = history.totalLines
}

const appendTerminalOutputHistoryLine = (history: TerminalOutputHistory, line: string) => {
  history.lines.push(line)
  history.totalLines += 1
  trimTerminalOutputHistory(history)
}

// 历史记录里 \r 视为回车覆写：只保留最后一次覆写的内容（wget/npm 进度条场景）。
const applyCarriageReturnOverwrite = (value: string) => value.slice(value.lastIndexOf('\r') + 1)

export const appendCodexTerminalBridgeDisplayData = (sessionId: string, chunk: string | Buffer) => {
  // bridge 服务未启动(从未创建过 codex 会话)时不维护输出历史,终端输出热路径零开销;
  // read_terminal_output 只覆盖首个 codex 会话启动之后产生的输出。
  if (!server) return
  const rawText = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  if (!rawText) return
  const history = terminalOutputHistoryForSession(sessionId)
  if (terminalClearSequencePattern.test(rawText)) {
    resetTerminalOutputHistory(history)
    terminalClearSequencePattern.lastIndex = 0
  }
  const text = stripTerminalControlKeepingCarriageReturns(rawText)
  if (!text) return
  const parts = text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < parts.length - 1; index += 1) {
    appendTerminalOutputHistoryLine(history, applyCarriageReturnOverwrite(`${history.pending}${parts[index]}`))
    history.pending = ''
  }
  history.pending = applyCarriageReturnOverwrite(`${history.pending}${parts[parts.length - 1] || ''}`)
  if (history.pending.length > terminalOutputHistoryPendingMaxLength) {
    history.pending = history.pending.slice(-terminalOutputHistoryPendingMaxLength)
  }
  history.updatedAt = Date.now()
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

const firstPendingCommandForSession = (sessionId: string) =>
  [...pendingCommands.values()]
    .filter((pending) => pending.sessionId === sessionId && pending.displayPhase !== 'done')
    .sort((left, right) => left.startedAt - right.startedAt)[0] || null

const splitNextTerminalLine = (value: string): { line: string; rest: string } | null => {
  const newlineIndex = value.indexOf('\n')
  if (newlineIndex < 0) return null
  return {
    line: value.slice(0, newlineIndex + 1),
    rest: value.slice(newlineIndex + 1)
  }
}

const lineText = (line: string) => stripTerminalControl(line).trim()

const terminalLineText = (line: string) => stripTerminalControl(line).replace(/\n$/g, '')

const isMarkerEndLine = (line: string, markerEndPrefix: string) => {
  const text = lineText(line)
  if (!text.startsWith(markerEndPrefix)) return false
  return /^-?\d+$/.test(text.slice(markerEndPrefix.length).trim())
}

const commandEchoFragments = (command: string) =>
  command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const hasShellPrompt = (line: string) => /(?:^|\s)[^\s@]+@[^:\s]+:.*(?:[$#])\s+/.test(line) || /^>\s*/.test(line)

const isCodexBridgeWrapperLine = (line: string, pending: PendingCommand) => {
  const text = lineText(line)
  return Boolean(text && (text.includes(pending.markerStart) || text.includes(pending.markerEnd) || text.includes('__aiopsterm_status')))
}

const codexBridgeInputEchoPromptPrefix = (line: string, pending: PendingCommand) => {
  const text = terminalLineText(line).trimEnd()
  if (!text || !hasShellPrompt(text)) return null
  const markerIndex = text.indexOf(pending.markerStart)
  if (markerIndex >= 0) {
    const echoIndex = text.lastIndexOf('echo ', markerIndex)
    return echoIndex >= 0 ? text.slice(0, echoIndex) : ''
  }
  for (const fragment of commandEchoFragments(pending.command)) {
    const fragmentIndex = text.indexOf(fragment)
    if (fragmentIndex >= 0) {
      const isolatedShellIndex = text.lastIndexOf('if "${SHELL:-sh}" -c ', fragmentIndex)
      if (isolatedShellIndex >= 0) return text.slice(0, isolatedShellIndex)
      return text.slice(0, fragmentIndex)
    }
  }
  return null
}

const commandDisplayLines = (command: string) => {
  const lines = command.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') return lines.slice(0, -1)
  return lines
}

const visibleCommandEcho = (command: string, promptPrefix: string) => {
  const lines = commandDisplayLines(command)
  return lines.map((line, index) => `${index === 0 ? promptPrefix : '> '}${line}`).join('\r\n') + '\r\n'
}

const showPendingCommandEcho = (pending: PendingCommand, promptPrefix?: string | null) => {
  if (pending.displayCommandShown) return ''
  if (promptPrefix !== undefined && promptPrefix !== null) pending.displayPromptPrefix = promptPrefix
  pending.displayCommandShown = true
  return visibleCommandEcho(pending.command, pending.displayPromptPrefix)
}

export const filterCodexTerminalBridgeDisplayData = (sessionId: string, chunk: string | Buffer): string | Buffer => {
  const pending = firstPendingCommandForSession(sessionId)
  if (!pending) return chunk
  pending.displayBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  let visible = ''
  for (;;) {
    const next = splitNextTerminalLine(pending.displayBuffer)
    if (!next) break
    pending.displayBuffer = next.rest
    if (pending.displayPhase === 'suppress-until-start') {
      const promptPrefix = codexBridgeInputEchoPromptPrefix(next.line, pending)
      if (promptPrefix !== null) pending.displayPromptPrefix = promptPrefix
      if (lineText(next.line) === pending.markerStart) {
        pending.displayPhase = 'forward-until-end'
        if (pending.displayPromptPrefix) visible += showPendingCommandEcho(pending)
      }
      continue
    }
    if (pending.displayPhase === 'forward-until-end') {
      if (isMarkerEndLine(next.line, pending.markerEndPrefix)) {
        pending.displayPhase = 'done'
        visible += showPendingCommandEcho(pending)
        visible += pending.displayBuffer
        pending.displayBuffer = ''
        break
      }
      const promptPrefix = codexBridgeInputEchoPromptPrefix(next.line, pending)
      if (promptPrefix !== null) {
        visible += showPendingCommandEcho(pending, promptPrefix)
        continue
      }
      if (isCodexBridgeWrapperLine(next.line, pending)) continue
      visible += showPendingCommandEcho(pending)
      visible += next.line
    }
  }
  return visible
}

const stripTerminalControlKeepingCarriageReturns = (value: string) =>
  value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')

const stripTerminalControl = (value: string) => stripTerminalControlKeepingCarriageReturns(value).replace(/\r/g, '')

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

export const cancelCodexTerminalBridgeCommand = (commandId: string, reason = 'The command was cancelled.') => {
  const normalizedId = cleanText(commandId)
  const pending = pendingCommands.get(normalizedId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingCommands.delete(normalizedId)
  const session = sessions.get(pending.sessionId)
  try {
    session?.write('\x03')
  } catch {
    // The command is still resolved as cancelled when the terminal closes during interruption.
  }
  pending.resolve({
    ok: false,
    errorCode: 'COMMAND_ABORTED',
    errorMessage: reason,
    target: session ? targetContextForSession(session) : undefined,
    data: {
      commandId: normalizedId,
      command: pending.command,
      mode: 'wait',
      output: stripTerminalControl(pending.output).trim(),
      exitCode: null,
      durationMs: Date.now() - pending.startedAt,
      aborted: true
    }
  })
  return true
}

const terminalSummaryForSession = (session: CodexTerminalBridgeSession) => {
  const target = targetContextForSession(session)
  return {
    sessionId: session.id,
    kind: target.kind || session.kind,
    label: target.label || (session.kind === 'local' ? 'Local terminal' : 'SSH terminal'),
    selected: session.id === preferredSessionId,
    strictSelected: session.id === preferredSessionId && preferredSessionStrict,
    ...(target.panelId ? { panelId: target.panelId } : {}),
    ...(target.host ? { host: target.host } : {}),
    ...(target.port ? { port: target.port } : {}),
    ...(target.username ? { username: target.username } : {}),
    ...(target.assetId ? { assetId: target.assetId } : {}),
    ...(target.assetName ? { assetName: target.assetName } : {}),
    ...(target.cwd ? { cwd: target.cwd } : {})
  }
}

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
  const isolatedCommand = `"\${SHELL:-sh}" -c ${shellQuote(command)}`
  return [
    'echo ',
    shellQuote(markerStart),
    '; if ',
    isolatedCommand,
    '; then __aiopsterm_status=0; else __aiopsterm_status=$?; fi; echo ',
    shellQuote(markerEnd),
    ':$__aiopsterm_status',
    '\n'
  ].join('')
}

const commandMode = (value: unknown): 'wait' | 'return_immediately' | null => {
  const mode = cleanText(value) || 'wait'
  if (mode === 'wait' || mode === 'return_immediately') return mode
  return null
}

const commandExecution = (value: unknown): 'terminal' | 'background' | null => {
  const execution = cleanText(value) || 'terminal'
  if (execution === 'terminal' || execution === 'background') return execution
  return null
}

const runTerminalCommandImmediately = (session: CodexTerminalBridgeSession, command: string, commandId: string, startedAt: number): CodexBridgeResponse => {
  const input = command.endsWith('\n') ? command : `${command}\n`
  session.write(input)
  return {
    ok: true,
    target: targetContextForSession(session),
    data: {
      commandId,
      command,
      mode: 'return_immediately',
      bytes: Buffer.byteLength(input, 'utf8'),
      exitCode: null,
      output: '',
      durationMs: Date.now() - startedAt
    }
  }
}

const runTerminalCommandInBackground = async (
  session: CodexTerminalBridgeSession,
  command: string,
  commandId: string,
  timeoutMs: number,
  startedAt: number
): Promise<CodexBridgeResponse> => {
  if (!session.runBackgroundCommand) {
    return {
      ok: false,
      errorCode: 'BACKGROUND_EXEC_UNSUPPORTED',
      errorMessage: 'The selected aiopsterm terminal session does not support background command execution.',
      target: targetContextForSession(session),
      data: {
        commandId,
        command,
        mode: 'wait',
        execution: 'background',
        output: '',
        exitCode: null,
        durationMs: Date.now() - startedAt
      }
    }
  }
  try {
    const result = await session.runBackgroundCommand({
      command,
      cwd: session.cwd,
      timeoutMs,
      maxOutputBytes: 1024 * 1024
    })
    const ok = !result.timedOut
    return {
      ok,
      ...(ok
        ? {}
        : {
            errorCode: 'COMMAND_TIMEOUT',
            errorMessage: `Background command timed out after ${timeoutMs}ms.`
          }),
      target: targetContextForSession(session),
      data: {
        commandId,
        command,
        mode: 'wait',
        execution: 'background',
        output: result.output.trim(),
        exitCode: result.exitCode,
        durationMs: Math.max(result.durationMs, Date.now() - startedAt),
        timedOut: result.timedOut,
        ...(result.outputTruncated ? { outputTruncated: true } : {})
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'BACKGROUND_EXEC_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      target: targetContextForSession(session),
      data: {
        commandId,
        command,
        mode: 'wait',
        execution: 'background',
        output: '',
        exitCode: null,
        durationMs: Date.now() - startedAt
      }
    }
  }
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
  const mode = commandMode(params.mode)
  if (!mode) {
    return {
      ok: false,
      errorCode: 'INVALID_COMMAND_MODE',
      errorMessage: 'Command mode must be "wait" or "return_immediately".'
    }
  }
  const execution = commandExecution(params.execution)
  if (!execution) {
    return {
      ok: false,
      errorCode: 'INVALID_COMMAND_EXECUTION',
      errorMessage: 'Command execution must be "terminal" or "background".'
    }
  }
  const commandId = (cleanText(params.commandId) || `aiopsterm-${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '_')
  const markerStart = `__AIOPSTERM_CODEX_START_${commandId}__`
  const markerEnd = `__AIOPSTERM_CODEX_END_${commandId}__`
  const markerEndPrefix = `__AIOPSTERM_CODEX_END_${commandId}__:`
  const timeoutMs = normalizeTimeoutMs(params.timeoutMs)
  const startedAt = Date.now()
  if (execution === 'background') {
    if (mode !== 'wait') {
      return {
        ok: false,
        errorCode: 'INVALID_COMMAND_EXECUTION_MODE',
        errorMessage: 'Background execution currently supports only mode "wait".',
        target: targetContextForSession(session),
        data: {
          commandId,
          command,
          mode,
          execution,
          output: '',
          exitCode: null,
          durationMs: Date.now() - startedAt
        }
      }
    }
    return runTerminalCommandInBackground(session, command, commandId, timeoutMs, startedAt)
  }
  if (mode === 'return_immediately') {
    try {
      return runTerminalCommandImmediately(session, command, commandId, startedAt)
    } catch (error) {
      return {
        ok: false,
        errorCode: 'COMMAND_WRITE_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        target: targetContextForSession(session),
        data: {
          commandId,
          command,
          mode,
          output: '',
          exitCode: null,
          durationMs: Date.now() - startedAt
        }
      }
    }
  }
  const wrapped = buildWrappedCommand(command, markerStart, markerEnd)

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
          mode,
          output: stripTerminalControl(pending?.output || '').trim(),
          exitCode: null,
          durationMs: Date.now() - startedAt
        }
      })
    }, timeoutMs)
    pendingCommands.set(commandId, {
      id: commandId,
      sessionId: session.id,
      command,
      startedAt,
      markerStart,
      markerEnd,
      markerEndPrefix,
      output: '',
      displayPhase: 'suppress-until-start',
      displayBuffer: '',
      displayCommandShown: false,
      displayPromptPrefix: '',
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
    data: response.data ? { ...response.data, commandId, command, mode } : response.data
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

const listTerminals = (): CodexBridgeResponse => {
  const terminals = [...sessions.values()].map(terminalSummaryForSession)
  return {
    ok: true,
    data: {
      terminals,
      count: terminals.length,
      selectedSessionId: preferredSessionId || undefined,
      strictSelected: preferredSessionStrict
    }
  }
}

const readTerminalOutput = (params: Record<string, unknown>): CodexBridgeResponse => {
  const session = resolveTargetSession(params)
  if (!session) {
    return {
      ok: false,
      errorCode: 'NO_TERMINAL_SESSION',
      errorMessage: 'No connected aiopsterm terminal session is available.'
    }
  }
  const history = terminalOutputHistories.get(session.id) || newTerminalOutputHistory()
  const offset = normalizeInteger(params.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = normalizeInteger(params.limit, 200, 1, 1000)
  const lines = history.pending ? [...history.lines, history.pending] : [...history.lines]
  const availableStartOffset = history.startOffset
  const availableEndOffset = availableStartOffset + lines.length
  const totalLines = history.totalLines + (history.pending ? 1 : 0)
  const startOffset = Math.max(offset, availableStartOffset)
  const startIndex = Math.max(0, startOffset - availableStartOffset)
  const selected = startOffset >= availableEndOffset ? [] : lines.slice(startIndex, startIndex + limit)
  const nextOffset = startOffset + selected.length
  return {
    ok: true,
    target: targetContextForSession(session),
    data: {
      sessionId: session.id,
      offset,
      startOffset,
      nextOffset,
      limit,
      lines: selected,
      content: selected.join('\n'),
      lineCount: selected.length,
      totalLines,
      availableStartOffset,
      availableEndOffset,
      maxCachedLines: terminalOutputHistoryMaxLines,
      truncated: availableStartOffset > 0 || offset < availableStartOffset,
      updatedAt: history.updatedAt
    }
  }
}

const handleBridgeRequest = async (request: CodexTerminalBridgeRequest): Promise<CodexBridgeResponse> => {
  const params = request.params || {}
  if (request.method === 'list_terminals') return listTerminals()
  if (request.method === 'run_command') return runTerminalCommand(params)
  if (request.method === 'read_terminal_output') return readTerminalOutput(params)
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

export const callCodexTerminalBridgeTool = (
  method: string,
  params: Record<string, unknown> = {}
): Promise<CodexBridgeResponse> => handleBridgeRequest({ method, params })

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
  terminalOutputHistories.clear()
  sessions.clear()
  preferredSessionId = ''
  preferredSessionStrict = false
  server?.close()
  server = null
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}
