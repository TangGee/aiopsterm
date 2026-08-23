import { createServer, type Server, type Socket } from 'net'
import { existsSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import { mkdir } from 'fs/promises'
import type { BrowserWindow } from 'electron'
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'
import { shouldUseTerminalDebugLogs } from '@shared/runtimeSwitches'
import { platformSocketPath } from '../app/platformRuntime'
import { logRuntimeEvent } from '../app/runtimeLog'
import type { TerminalBackgroundCommandOptions, TerminalBackgroundCommandResult } from '../terminal/terminal'

export type CodexTerminalBridgeSession = {
  id: string
  kind: 'local' | 'ssh'
  shell?: string
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
  queuedAt: number
  startedAt?: number
  timeoutMs: number
  wrappedCommand: string
  markerStart: string
  markerEnd: string
  markerEndPrefix: string
  output: string
  state: 'queued' | 'active' | 'interrupting'
  responseSettled: boolean
  interruptOutputStart?: number
  displayPhase: 'suppress-until-start' | 'forward-until-end' | 'done'
  displayBuffer: string
  displayCommandShown: boolean
  displayPromptPrefix: string
  resolve: (value: CodexBridgeResponse) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
  interruptTimer?: NodeJS.Timeout
}

type TerminalCommandQueue = {
  activeCommandId?: string
  queuedCommandIds: string[]
  isolatedReason?: string
  isolatedOutput?: string
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
const terminalCommandQueues = new Map<string, TerminalCommandQueue>()
const terminalOutputHistories = new Map<string, TerminalOutputHistory>()
const runtimeTargetSelections = new Map<string, { sessionId: string; strict: boolean }>()

const terminalBridgeDebugEnabled = () => shouldUseTerminalDebugLogs()

const escapedPtyTail = (value: string) => {
  const tail = value.slice(-384)
  return JSON.stringify(tail).slice(1, -1)
}

const terminalBridgeDebugFields = (pending: PendingCommand) => ({
  operationId: pending.id,
  sessionId: pending.sessionId,
  state: pending.state,
  displayPhase: pending.displayPhase,
  outputBytes: Buffer.byteLength(pending.output, 'utf8'),
  containsStartMarker: pending.output.includes(pending.markerStart),
  containsEndMarker: pending.output.includes(pending.markerEnd),
  containsEndPrefix: pending.output.includes(pending.markerEndPrefix),
  ptyTail: escapedPtyTail(pending.output)
})

let server: Server | null = null
let serverClosePromise: Promise<void> | null = null
let socketPath = ''
let preferredSessionId = ''
let preferredSessionStrict = false

const terminalOutputHistoryMaxLines = 10000
// 只发 \r 不发 \n 的进度流（wget/npm 等）不会触发换行落盘，pending 必须有硬上限。
const terminalOutputHistoryPendingMaxLength = 64 * 1024
export const codexTerminalBridgeInterruptGraceMs = 2_000

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const codexRuntimeIdParam = '__aiopstermCodexRuntimeId'

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

export const updateCodexTerminalBridgeRuntimeTarget = (
  runtimeIdInput: string,
  target?: CodexSessionTargetContext | null
): CodexTerminalBridgeTargetUpdateResult => {
  const runtimeId = cleanText(runtimeIdInput)
  if (!runtimeId) return updateCodexTerminalBridgeSessionTarget(target)
  const sessionId = cleanText(target?.sessionId)
  runtimeTargetSelections.set(runtimeId, { sessionId, strict: true })
  if (!sessionId) return { registered: false, ...(target ? { target } : {}) }
  const session = sessions.get(sessionId)
  if (!session) return { sessionId, registered: false, ...(target ? { target } : {}) }
  if (target) session.target = { ...(session.target || {}), ...target, sessionId }
  if (target?.cwd) session.cwd = target.cwd
  if (target?.host) session.host = target.host
  return { sessionId, target: targetContextForSession(session), registered: true }
}

export const clearCodexTerminalBridgeRuntimeTarget = (runtimeIdInput: string) => {
  const runtimeId = cleanText(runtimeIdInput)
  if (runtimeId) runtimeTargetSelections.delete(runtimeId)
}

export const unregisterCodexTerminalBridgeSession = (id: string) => {
  sessions.delete(id)
  terminalOutputHistories.delete(id)
  clearTerminalCommandQueue(id, {
    ok: false,
    errorCode: 'TERMINAL_SESSION_CLOSED',
    errorMessage: 'The selected aiopsterm terminal session closed before command output completed.'
  })
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
  const pending = activePendingCommandForSession(sessionId)
  if (!pending) {
    const queue = terminalCommandQueues.get(sessionId)
    if (!queue?.isolatedReason) return
    queue.isolatedOutput = `${queue.isolatedOutput || ''}${text}`.slice(-8192)
    const output = stripTerminalControl(queue.isolatedOutput)
    if (output.split('\n').some((line) => isReliableShellPromptBoundary(line))) {
      queue.isolatedReason = undefined
      queue.isolatedOutput = undefined
      cleanupIdleTerminalCommandQueue(sessionId)
    }
    return
  }
  pending.output += text
  const completed = extractCompletedMarkedOutput(pending.output, pending.markerStart, pending.markerEndPrefix)
  if (completed) {
    if (terminalBridgeDebugEnabled()) {
      logRuntimeEvent('info', 'terminal.command-bridge.completed', {
        ...terminalBridgeDebugFields(pending),
        exitCode: completed.exitCode,
        durationMs: pendingCommandDuration(pending)
      })
    }
    if (!pending.responseSettled) {
      settlePendingCommandResponse(pending, {
        ok: true,
        target: sessions.get(sessionId)?.target,
        data: {
          commandId: pending.id,
          output: completed.output.trim(),
          exitCode: completed.exitCode,
          durationMs: pendingCommandDuration(pending)
        }
      })
    }
    releaseActiveTerminalCommand(pending)
    return
  }
  if (pending.state === 'interrupting' && hasInterruptedCommandPromptBoundary(pending)) {
    releaseActiveTerminalCommand(pending)
  }
}

const firstPendingCommandForSession = (sessionId: string) => {
  const pending = activePendingCommandForSession(sessionId)
  return pending?.displayPhase !== 'done' ? pending : null
}

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

const wrappedCommandText = (pending: PendingCommand) => stripTerminalControl(pending.wrappedCommand).trim()

const isShellContinuationLine = (line: string) => /^>\s*/.test(terminalLineText(line).trimStart())

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

const hasShellPromptPrefix = (line: string) =>
  /(?:^|\s)[^\s@]+@[^:\s]+:.*(?:[$#%])\s+/.test(line) ||
  /^\[[^\]\r\n]+@[^\]\r\n]+\s+[^\]\r\n]*\][#$%]\s+/.test(line) ||
  /^(?:PS\s+)?[a-zA-Z]:\\[^>\r\n]*>\s*/.test(line) ||
  /^>\s*/.test(line)

const isReliableShellPromptBoundary = (line: string) => {
  const text = line.trim()
  return (
    /^\[[^\]\r\n]+@[^\]\r\n]+\s+[^\]\r\n]*\][#$%]\s*$/.test(text) ||
    /^[^\s@]+@[^\s:]+(?::[^\r\n]*)?[#$%]\s*$/.test(text) ||
    /^PS\s+.+>\s*$/.test(text)
  )
}

const isCodexBridgeWrapperLine = (line: string, pending: PendingCommand) => {
  const text = lineText(line)
  const wrapped = wrappedCommandText(pending)
  return Boolean(text && (
    text.includes(pending.markerStart) ||
    text.includes(pending.markerEnd) ||
    text.includes('__aiopsterm_status') ||
    (wrapped && text.includes(wrapped))
  ))
}

const codexBridgeInputEchoPromptPrefix = (line: string, pending: PendingCommand) => {
  const text = terminalLineText(line).trimEnd()
  if (!text) return null
  const wrapped = wrappedCommandText(pending)
  const wrappedIndex = wrapped ? text.lastIndexOf(wrapped) : -1
  if (wrappedIndex >= 0) return text.slice(0, wrappedIndex)
  if (!hasShellPromptPrefix(text)) return null
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
        continue
      }
      if (promptPrefix !== null || isCodexBridgeWrapperLine(next.line, pending) || isShellContinuationLine(next.line)) continue
      visible += showPendingCommandEcho(pending)
      visible += next.line
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
    // OSC payloads cannot contain an unescaped ESC. Excluding it prevents a
    // malformed or concatenated OSC sequence from consuming command markers
    // until a later ESC-ST terminator.
    .replace(/(?:\u001b\]|\u009d)[^\u0007\u009c\u001b]*(?:\u0007|\u009c|\u001b\\)/g, '')

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

const terminalCommandQueueFor = (sessionId: string) => {
  const existing = terminalCommandQueues.get(sessionId)
  if (existing) return existing
  const queue: TerminalCommandQueue = { queuedCommandIds: [] }
  terminalCommandQueues.set(sessionId, queue)
  return queue
}

const pendingCommandDuration = (pending: PendingCommand) =>
  Math.max(0, Date.now() - (pending.startedAt ?? pending.queuedAt))

const clearPendingCommandTimers = (pending: PendingCommand) => {
  if (pending.timer) clearTimeout(pending.timer)
  if (pending.interruptTimer) clearTimeout(pending.interruptTimer)
  pending.timer = undefined
  pending.interruptTimer = undefined
}

const settlePendingCommandResponse = (pending: PendingCommand, response: CodexBridgeResponse) => {
  if (pending.responseSettled) return
  pending.responseSettled = true
  pending.resolve(response)
}

const rejectPendingCommandResponse = (pending: PendingCommand, error: unknown) => {
  if (pending.responseSettled) return
  pending.responseSettled = true
  pending.reject(error instanceof Error ? error : new Error(String(error)))
}

const activePendingCommandForSession = (sessionId: string) => {
  const activeCommandId = terminalCommandQueues.get(sessionId)?.activeCommandId
  if (!activeCommandId) return null
  const pending = pendingCommands.get(activeCommandId)
  return pending && pending.state !== 'queued' ? pending : null
}

const cleanupIdleTerminalCommandQueue = (sessionId: string) => {
  const queue = terminalCommandQueues.get(sessionId)
  if (!queue || queue.isolatedReason || queue.activeCommandId || queue.queuedCommandIds.length) return
  terminalCommandQueues.delete(sessionId)
}

const removeQueuedTerminalCommand = (pending: PendingCommand) => {
  const queue = terminalCommandQueues.get(pending.sessionId)
  if (!queue) return
  queue.queuedCommandIds = queue.queuedCommandIds.filter((commandId) => commandId !== pending.id)
}

const isolatedTerminalCommandResponse = (session: CodexTerminalBridgeSession | undefined, reason: string): CodexBridgeResponse => ({
  ok: false,
  errorCode: 'TERMINAL_COMMAND_CHANNEL_ISOLATED',
  errorMessage: reason,
  ...(session ? { target: targetContextForSession(session) } : {})
})

function clearTerminalCommandQueue(sessionId: string, response: CodexBridgeResponse) {
  const queue = terminalCommandQueues.get(sessionId)
  const commandIds = new Set([
    ...(queue?.activeCommandId ? [queue.activeCommandId] : []),
    ...(queue?.queuedCommandIds || []),
    ...[...pendingCommands.values()].filter((pending) => pending.sessionId === sessionId).map((pending) => pending.id)
  ])
  for (const commandId of commandIds) {
    const pending = pendingCommands.get(commandId)
    if (!pending) continue
    clearPendingCommandTimers(pending)
    pending.displayPhase = 'done'
    settlePendingCommandResponse(pending, response)
    pendingCommands.delete(commandId)
  }
  terminalCommandQueues.delete(sessionId)
}

const isolateTerminalCommandQueue = (pending: PendingCommand, reason: string, error?: unknown) => {
  const queue = terminalCommandQueueFor(pending.sessionId)
  const session = sessions.get(pending.sessionId)
  clearPendingCommandTimers(pending)
  pending.displayPhase = 'done'
  queue.activeCommandId = undefined
  queue.isolatedReason = reason
  queue.isolatedOutput = ''
  if (error !== undefined) rejectPendingCommandResponse(pending, error)
  else settlePendingCommandResponse(pending, isolatedTerminalCommandResponse(session, reason))
  pendingCommands.delete(pending.id)

  const queuedIds = queue.queuedCommandIds.splice(0)
  for (const commandId of queuedIds) {
    const queued = pendingCommands.get(commandId)
    if (!queued) continue
    clearPendingCommandTimers(queued)
    settlePendingCommandResponse(queued, isolatedTerminalCommandResponse(session, reason))
    pendingCommands.delete(commandId)
  }
}

const releaseActiveTerminalCommand = (pending: PendingCommand) => {
  const queue = terminalCommandQueues.get(pending.sessionId)
  clearPendingCommandTimers(pending)
  pending.displayPhase = 'done'
  pendingCommands.delete(pending.id)
  if (queue?.activeCommandId === pending.id) queue.activeCommandId = undefined
  dispatchNextTerminalCommand(pending.sessionId)
  cleanupIdleTerminalCommandQueue(pending.sessionId)
}

const hasInterruptedCommandPromptBoundary = (pending: PendingCommand) => {
  const start = pending.interruptOutputStart ?? pending.output.length
  const output = stripTerminalControl(pending.output.slice(start))
  return output.split('\n').some((line) => isReliableShellPromptBoundary(line))
}

const beginActiveTerminalCommandInterrupt = (pending: PendingCommand, response: CodexBridgeResponse) => {
  if (pending.state !== 'active') return
  const session = sessions.get(pending.sessionId)
  clearPendingCommandTimers(pending)
  pending.state = 'interrupting'
  pending.interruptOutputStart = pending.output.length
  settlePendingCommandResponse(pending, response)
  try {
    if (!session) throw new Error('The selected aiopsterm terminal session is unavailable during interruption.')
    session.write('\x03')
  } catch (error) {
    isolateTerminalCommandQueue(
      pending,
      'The terminal command channel was isolated because interruption could not be delivered safely.',
      error
    )
    return
  }
  pending.interruptTimer = setTimeout(() => {
    if (pendingCommands.get(pending.id) !== pending || pending.state !== 'interrupting') return
    isolateTerminalCommandQueue(
      pending,
      'The terminal command channel was isolated because the interrupted command did not reach a reliable shell boundary.'
    )
  }, codexTerminalBridgeInterruptGraceMs)
}

function dispatchNextTerminalCommand(sessionId: string) {
  const queue = terminalCommandQueues.get(sessionId)
  if (!queue || queue.activeCommandId || queue.isolatedReason) return
  const session = sessions.get(sessionId)
  for (;;) {
    const commandId = queue.queuedCommandIds.shift()
    if (!commandId) {
      cleanupIdleTerminalCommandQueue(sessionId)
      return
    }
    const pending = pendingCommands.get(commandId)
    if (!pending || pending.state !== 'queued') continue
    if (!session) {
      settlePendingCommandResponse(pending, {
        ok: false,
        errorCode: 'TERMINAL_SESSION_CLOSED',
        errorMessage: 'The selected aiopsterm terminal session closed before command execution started.'
      })
      pendingCommands.delete(commandId)
      continue
    }
    queue.activeCommandId = commandId
    pending.state = 'active'
    pending.startedAt = Date.now()
    if (terminalBridgeDebugEnabled()) {
      logRuntimeEvent('info', 'terminal.command-bridge.started', {
        operationId: pending.id,
        sessionId: pending.sessionId,
        terminalKind: session.kind,
        timeoutMs: pending.timeoutMs,
        wrappedBytes: Buffer.byteLength(pending.wrappedCommand, 'utf8'),
        markerStartBytes: Buffer.byteLength(pending.markerStart, 'utf8'),
        markerEndBytes: Buffer.byteLength(pending.markerEnd, 'utf8')
      })
    }
    pending.timer = setTimeout(() => {
      if (pendingCommands.get(commandId) !== pending || pending.state !== 'active') return
      if (terminalBridgeDebugEnabled()) {
        logRuntimeEvent('warn', 'terminal.command-bridge.timeout', {
          ...terminalBridgeDebugFields(pending),
          timeoutMs: pending.timeoutMs,
          durationMs: pendingCommandDuration(pending)
        })
      }
      beginActiveTerminalCommandInterrupt(pending, {
        ok: false,
        errorCode: 'COMMAND_TIMEOUT',
        errorMessage: `Command timed out after ${pending.timeoutMs}ms.`,
        target: targetContextForSession(session),
        data: {
          commandId,
          command: pending.command,
          mode: 'wait',
          output: stripTerminalControl(pending.output).trim(),
          exitCode: null,
          durationMs: pendingCommandDuration(pending)
        }
      })
    }, pending.timeoutMs)
    try {
      session.write(pending.wrappedCommand)
    } catch (error) {
      isolateTerminalCommandQueue(
        pending,
        'The terminal command channel was isolated because command delivery failed.',
        error
      )
    }
    return
  }
}

export const cancelCodexTerminalBridgeCommand = (commandId: string, reason = 'The command was cancelled.') => {
  const normalizedId = cleanText(commandId)
  const pending = pendingCommands.get(normalizedId)
  if (!pending || pending.state === 'interrupting' || pending.responseSettled) return false
  const session = sessions.get(pending.sessionId)
  const response: CodexBridgeResponse = {
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
      durationMs: pendingCommandDuration(pending),
      aborted: true
    }
  }
  if (pending.state === 'queued') {
    removeQueuedTerminalCommand(pending)
    settlePendingCommandResponse(pending, response)
    pendingCommands.delete(pending.id)
    cleanupIdleTerminalCommandQueue(pending.sessionId)
    return true
  }
  beginActiveTerminalCommandInterrupt(pending, response)
  return true
}

const targetSelectionForParams = (params: Record<string, unknown>) => {
  const runtimeId = cleanText(params[codexRuntimeIdParam])
  return runtimeId ? runtimeTargetSelections.get(runtimeId) || { sessionId: '', strict: true } : undefined
}

const terminalSummaryForSession = (
  session: CodexTerminalBridgeSession,
  selection = { sessionId: preferredSessionId, strict: preferredSessionStrict }
) => {
  const target = targetContextForSession(session)
  return {
    sessionId: session.id,
    kind: target.kind || session.kind,
    label: target.label || (session.kind === 'local' ? 'Local terminal' : 'SSH terminal'),
    selected: session.id === selection.sessionId,
    strictSelected: session.id === selection.sessionId && selection.strict,
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
  const runtimeSelection = targetSelectionForParams(params)
  if (runtimeSelection) {
    if (!runtimeSelection.sessionId) return null
    return sessions.get(runtimeSelection.sessionId) || null
  }
  const requestedSessionId = cleanText(params.sessionId)
  if (requestedSessionId) return sessions.get(requestedSessionId) || null
  const selectedSessionId = preferredSessionId
  const strict = preferredSessionStrict
  if (selectedSessionId) {
    const preferred = sessions.get(selectedSessionId) || null
    if (preferred || strict) return preferred
  }
  if (strict) return null
  const candidates = [...sessions.values()].filter((session) => session.kind === 'ssh')
  return candidates[candidates.length - 1] || [...sessions.values()][0] || null
}

const unavailableTargetResponse = (params: Record<string, unknown>, fallbackMessage: string): CodexBridgeResponse => {
  const runtimeId = cleanText(params[codexRuntimeIdParam])
  if (runtimeId) {
    return {
      ok: false,
      errorCode: 'CODEX_RUNTIME_TARGET_UNAVAILABLE',
      errorMessage: 'The terminal bound to this embedded Codex runtime is unavailable. Rebind a connected terminal or restart the Codex session.'
    }
  }
  return {
    ok: false,
    errorCode: 'NO_TERMINAL_SESSION',
    errorMessage: fallbackMessage
  }
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

const buildPosixWrappedCommand = (command: string, markerStart: string, markerEnd: string) => {
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

const powershellQuote = (value: string) => `'${value.replace(/'/g, "''")}'`

const powershellEncodedCommand = (script: string) => Buffer.from(script, 'utf16le').toString('base64')

const powershellChildScript = (command: string) => [
  '$global:LASTEXITCODE = $null',
  'try {',
  '  & {',
  command,
  '  }',
  '  $__aiopsterm_ok = $?',
  '  $__aiopsterm_native = $global:LASTEXITCODE',
  '  if ($null -ne $__aiopsterm_native) { exit [int]$__aiopsterm_native }',
  '  if ($__aiopsterm_ok) { exit 0 }',
  '  exit 1',
  '} catch {',
  '  Write-Error $_',
  '  exit 1',
  '}'
].join('\r\n')

const buildPowerShellWrappedCommand = (
  shell: string,
  command: string,
  markerStart: string,
  markerEnd: string
) => {
  const encoded = powershellEncodedCommand(powershellChildScript(command))
  return [
    'Write-Output ',
    powershellQuote(markerStart),
    '; & ',
    powershellQuote(shell),
    ' -NoLogo -NoProfile -NonInteractive -EncodedCommand ',
    encoded,
    '; $__aiopsterm_status=$LASTEXITCODE; Write-Output (',
    powershellQuote(`${markerEnd}:`),
    ' + $__aiopsterm_status)',
    '\r'
  ].join('')
}

const buildCmdWrappedCommand = (
  shell: string,
  command: string,
  markerStart: string,
  markerEnd: string
) => {
  const commandBase64 = Buffer.from(command, 'utf8').toString('base64')
  const script = [
    `Write-Output ${powershellQuote(markerStart)}`,
    `$__aiopsterm_command=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${powershellQuote(commandBase64)}))`,
    `& ${powershellQuote(shell)} /d /s /c $__aiopsterm_command`,
    '$__aiopsterm_status=$LASTEXITCODE',
    'if ($null -eq $__aiopsterm_status) { $__aiopsterm_status=1 }',
    `Write-Output (${powershellQuote(`${markerEnd}:`)} + $__aiopsterm_status)`,
    'exit $__aiopsterm_status'
  ].join('; ')
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${powershellEncodedCommand(script)}\r`
}

const terminalShellName = (session: CodexTerminalBridgeSession) =>
  basename(cleanText(session.shell).replace(/\\/g, '/')).toLowerCase()

const buildWrappedCommand = (
  session: CodexTerminalBridgeSession,
  command: string,
  markerStart: string,
  markerEnd: string
) => {
  if (session.kind !== 'local') return buildPosixWrappedCommand(command, markerStart, markerEnd)
  const shellName = terminalShellName(session)
  const shell = cleanText(session.shell)
  if (shellName.includes('powershell') || shellName === 'pwsh' || shellName === 'pwsh.exe') {
    return buildPowerShellWrappedCommand(shell, command, markerStart, markerEnd)
  }
  if (shellName === 'cmd' || shellName === 'cmd.exe') {
    return buildCmdWrappedCommand(shell, command, markerStart, markerEnd)
  }
  return buildPosixWrappedCommand(command, markerStart, markerEnd)
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
    return unavailableTargetResponse(params, 'No connected aiopsterm terminal session is available. Select or connect a terminal before running remote commands.')
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
    const queue = terminalCommandQueues.get(session.id)
    if (queue?.isolatedReason) return isolatedTerminalCommandResponse(session, queue.isolatedReason)
    if (queue?.activeCommandId || queue?.queuedCommandIds.length) {
      return {
        ok: false,
        errorCode: 'TERMINAL_COMMAND_BUSY',
        errorMessage: 'The selected terminal is currently owned by another aiopsterm command.',
        target: targetContextForSession(session)
      }
    }
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
  const wrapped = buildWrappedCommand(session, command, markerStart, markerEnd)

  return new Promise<CodexBridgeResponse>((resolve, reject) => {
    if (pendingCommands.has(commandId)) {
      resolve({
        ok: false,
        errorCode: 'COMMAND_ID_CONFLICT',
        errorMessage: 'The aiopsterm command id is already pending.',
        target: targetContextForSession(session)
      })
      return
    }
    const queue = terminalCommandQueueFor(session.id)
    if (queue.isolatedReason) {
      resolve(isolatedTerminalCommandResponse(session, queue.isolatedReason))
      return
    }
    const pending: PendingCommand = {
      id: commandId,
      sessionId: session.id,
      command,
      queuedAt: startedAt,
      timeoutMs,
      wrappedCommand: wrapped,
      markerStart,
      markerEnd,
      markerEndPrefix,
      output: '',
      state: 'queued',
      responseSettled: false,
      displayPhase: 'suppress-until-start',
      displayBuffer: '',
      displayCommandShown: false,
      displayPromptPrefix: '',
      resolve,
      reject
    }
    pendingCommands.set(commandId, pending)
    queue.queuedCommandIds.push(commandId)
    dispatchNextTerminalCommand(session.id)
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
  const response = await runTerminalCommand({ ...params, command })
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
    return unavailableTargetResponse(params, 'No connected aiopsterm terminal session is available.')
  }
  return { ok: true, target: targetContextForSession(session) }
}

const listTerminals = (params: Record<string, unknown>): CodexBridgeResponse => {
  const runtimeSelection = targetSelectionForParams(params)
  const selection = runtimeSelection || { sessionId: preferredSessionId, strict: preferredSessionStrict }
  const terminals = [...sessions.values()].map((session) => terminalSummaryForSession(session, selection))
  return {
    ok: true,
    data: {
      terminals,
      count: terminals.length,
      selectedSessionId: selection.sessionId || undefined,
      strictSelected: selection.strict
    }
  }
}

const readTerminalOutput = (params: Record<string, unknown>): CodexBridgeResponse => {
  const session = resolveTargetSession(params)
  if (!session) {
    return unavailableTargetResponse(params, 'No connected aiopsterm terminal session is available.')
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
  if (request.method === 'list_terminals') return listTerminals(params)
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
  if (socket.destroyed || socket.writableEnded) {
    logRuntimeEvent('warn', 'codex.terminal-bridge.response-dropped', { requestId: id, ok: response.ok, errorCode: response.errorCode })
    return
  }
  socket.write(`${JSON.stringify({ id, ...response })}\n`)
}

export const ensureCodexTerminalBridgeServer = async (userDataPath: string) => {
  if (server && socketPath) return socketPath
  if (serverClosePromise) {
    await serverClosePromise
    serverClosePromise = null
  }
  socketPath = bridgeSocketPathFor(userDataPath)
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
    if (existsSync(socketPath)) rmSync(socketPath, { force: true })
  }
  server = createServer((socket) => {
    let buffer = ''
    socket.on('error', (error) => {
      logRuntimeEvent('warn', 'codex.terminal-bridge.socket-error', { error })
      socket.destroy()
    })
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
  for (const sessionId of new Set([...terminalCommandQueues.keys(), ...sessions.keys()])) {
    clearTerminalCommandQueue(sessionId, {
      ok: false,
      errorCode: 'TERMINAL_BRIDGE_CLOSED',
      errorMessage: 'The aiopsterm terminal bridge closed before command output completed.'
    })
  }
  pendingCommands.clear()
  terminalCommandQueues.clear()
  terminalOutputHistories.clear()
  runtimeTargetSelections.clear()
  sessions.clear()
  preferredSessionId = ''
  preferredSessionStrict = false
  const existingServer = server
  server = null
  if (existingServer) serverClosePromise = new Promise((resolve) => existingServer.close(() => resolve()))
  if (socketPath && process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true })
  socketPath = ''
}
