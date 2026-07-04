import { watch, type FSWatcher, statSync } from 'fs'
import { open, stat } from 'fs/promises'
import {
  cleanOptionalText,
  cleanText,
  firstText,
  isRecord
} from './agentSessionNormalization'
import type { AiAgentSessionEvent, AiAgentSessionEventInput } from '@shared/contracts/managedAiSessions'

type CodexTranscriptMonitorOptions = {
  publishEvent: (event: AiAgentSessionEventInput) => void
  now?: () => number
  pollMs?: number
  maxDurationMs?: number
  maxBytes?: number
}

type CodexTranscriptMonitorStartInput = {
  event: AiAgentSessionEvent
  raw: Record<string, unknown>
}

type CodexTranscriptUserInputCandidate = {
  callId: string
  question?: string
  questions?: unknown[]
}

type CodexTranscriptReadResult = {
  candidate?: CodexTranscriptUserInputCandidate
  terminal: boolean
}

type CodexTranscriptMonitorRecord = {
  key: string
  sessionId: string
  transcriptPath: string
  turnId?: string
  startOffset: number
  startedAt: number
  event: AiAgentSessionEvent
  raw: Record<string, unknown>
  publishedCallIds: Set<string>
  timer?: NodeJS.Timeout
  watcher?: FSWatcher
  scanning: boolean
  scanAgain: boolean
  disposed: boolean
}

const defaultPollMs = 1000
const defaultMaxDurationMs = 4 * 60 * 60 * 1000
const defaultMaxBytes = 512 * 1024
const requestUserInputToolName = 'request_user_input'

const compactQuestionText = (value: unknown, maxLength = 220) => {
  const text = cleanText(value).replace(/\s+/g, ' ')
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

const readJsonlSlice = async (path: string, maxBytes: number, startOffset?: number) => {
  const info = await stat(path)
  const size = info.size
  const offset = typeof startOffset === 'number' ? Math.min(Math.max(0, startOffset), size) : Math.max(0, size - maxBytes)
  const length = Math.min(maxBytes, Math.max(0, size - offset))
  if (length <= 0) return ''
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const result = await file.read(buffer, 0, length, offset)
    return buffer.subarray(0, result.bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

const parseJsonLine = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const objectPayload = (object: Record<string, unknown>) => {
  const payload = object.payload
  return isRecord(payload) ? payload : {}
}

const payloadTurnId = (payload: Record<string, unknown>) => cleanOptionalText(payload.turn_id || payload.turnId)

const payloadQuestions = (payload: Record<string, unknown>) => (Array.isArray(payload.questions) ? payload.questions : undefined)

const questionTextFromQuestions = (questions?: unknown[]) => {
  const first = questions?.find(isRecord)
  return first ? compactQuestionText(firstText(first, ['question', 'header', 'prompt', 'id'])) : undefined
}

const functionCallArguments = (payload: Record<string, unknown>) => {
  const args = payload.arguments
  if (isRecord(args)) return args
  if (typeof args !== 'string' || !args.trim()) return {}
  try {
    const parsed = JSON.parse(args)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const candidateFromPayload = (
  payload: Record<string, unknown>,
  fallbackTurnId?: string,
  fallbackCallId?: string
): CodexTranscriptUserInputCandidate => {
  const questions = payloadQuestions(payload)
  const question = questionTextFromQuestions(questions)
  const callId =
    cleanOptionalText(payload.call_id || payload.callId || payload.item_id || payload.itemId) ||
    cleanOptionalText(fallbackCallId) ||
    `${payloadTurnId(payload) || fallbackTurnId || 'session'}:${question || requestUserInputToolName}`
  return {
    callId,
    ...(question ? { question } : {}),
    ...(questions ? { questions } : {})
  }
}

const functionCallCandidate = (
  payload: Record<string, unknown>,
  expectedTurnId?: string,
  sawRelevantTurn = true
): CodexTranscriptUserInputCandidate | null => {
  if (payload.type !== 'function_call' || payload.name !== requestUserInputToolName) return null
  const args = functionCallArguments(payload)
  const turnId = payloadTurnId(payload) || payloadTurnId(args)
  if (expectedTurnId) {
    if (turnId && turnId !== expectedTurnId) return null
    if (!turnId && !sawRelevantTurn) return null
  }
  return candidateFromPayload(Object.keys(args).length ? args : payload, turnId || expectedTurnId, cleanOptionalText(payload.call_id || payload.callId))
}

export const readCodexTranscriptUserInputState = async (input: {
  path: string
  turnId?: string
  startOffset?: number
  publishedCallIds?: Set<string>
  maxBytes?: number
}): Promise<CodexTranscriptReadResult> => {
  const expectedTurnId = cleanOptionalText(input.turnId)
  const text = await readJsonlSlice(input.path, input.maxBytes || defaultMaxBytes, expectedTurnId ? undefined : input.startOffset)
  const publishedCallIds = input.publishedCallIds || new Set<string>()
  let sawRelevantTurn = !expectedTurnId
  let candidate: CodexTranscriptUserInputCandidate | undefined
  let terminal = false

  for (const line of text.split(/\r?\n/)) {
    const object = parseJsonLine(line)
    if (!object) continue
    const objectType = cleanText(object.type)

    if (objectType === 'turn_context') {
      const turnId = payloadTurnId(objectPayload(object))
      sawRelevantTurn = expectedTurnId ? turnId === expectedTurnId : true
      continue
    }

    if (objectType === 'response_item') {
      const payload = objectPayload(object)
      const nextCandidate = functionCallCandidate(payload, expectedTurnId, sawRelevantTurn)
      if (nextCandidate && !publishedCallIds.has(nextCandidate.callId)) {
        candidate = nextCandidate
        terminal = false
      }
      continue
    }

    if (objectType !== 'event_msg') continue
    const payload = objectPayload(object)
    const eventType = cleanText(payload.type)
    const turnId = payloadTurnId(payload)
    const matchesTurn = expectedTurnId ? (turnId ? turnId === expectedTurnId : sawRelevantTurn) : true

    if (eventType === 'task_started') {
      sawRelevantTurn = expectedTurnId ? turnId === expectedTurnId : true
      if (sawRelevantTurn) {
        candidate = undefined
        terminal = false
      }
      continue
    }

    if (eventType === requestUserInputToolName && matchesTurn) {
      const nextCandidate = candidateFromPayload(payload, turnId || expectedTurnId)
      if (!publishedCallIds.has(nextCandidate.callId)) {
        candidate = nextCandidate
        terminal = false
      }
      continue
    }

    if ((eventType === 'task_complete' || eventType === 'turn_complete' || eventType === 'turn_aborted') && matchesTurn) {
      sawRelevantTurn = true
      candidate = undefined
      terminal = true
    }
  }

  return { ...(candidate ? { candidate } : {}), terminal }
}

export const createCodexTranscriptMonitorRuntime = (options: CodexTranscriptMonitorOptions) => {
  const monitors = new Map<string, CodexTranscriptMonitorRecord>()
  const now = () => options.now?.() ?? Date.now()
  const pollMs = () => Math.max(250, options.pollMs || defaultPollMs)
  const maxDurationMs = () => Math.max(1000, options.maxDurationMs || defaultMaxDurationMs)
  const maxBytes = () => Math.max(4096, options.maxBytes || defaultMaxBytes)

  const monitorKey = (sessionId: string, transcriptPath: string, turnId?: string) => `${sessionId}:${turnId || transcriptPath}`

  const disposeMonitor = (record: CodexTranscriptMonitorRecord) => {
    if (record.disposed) return
    record.disposed = true
    if (record.timer) clearTimeout(record.timer)
    record.watcher?.close()
    monitors.delete(record.key)
  }

  const scheduleScan = (record: CodexTranscriptMonitorRecord, delayMs = pollMs()) => {
    if (record.disposed) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      void scanMonitor(record)
    }, delayMs)
    record.timer.unref?.()
  }

  const publishQuestion = (record: CodexTranscriptMonitorRecord, candidate: CodexTranscriptUserInputCandidate) => {
    record.publishedCallIds.add(candidate.callId)
    const summary = candidate.question || 'Codex is asking a question'
    options.publishEvent({
      source: 'codex',
      event: 'question',
      sessionId: record.sessionId,
      title: record.event.title,
      summary,
      requestId: candidate.callId,
      requestKind: 'question',
      decisionMode: 'local',
      actionable: true,
      toolName: requestUserInputToolName,
      agentLifecycle: 'needsInput',
      transcriptPath: record.transcriptPath,
      ...(record.event.panelId ? { panelId: record.event.panelId } : {}),
      ...(record.event.terminalSessionId ? { terminalSessionId: record.event.terminalSessionId } : {}),
      ...(record.event.workspaceId ? { workspaceId: record.event.workspaceId } : {}),
      ...(record.event.cwd ? { cwd: record.event.cwd } : {}),
      ...(record.event.canonicalCwd ? { canonicalCwd: record.event.canonicalCwd } : {}),
      ...(record.event.launchCommand ? { launchCommand: record.event.launchCommand } : {}),
      ...(record.event.resumeCommand ? { resumeCommand: record.event.resumeCommand } : {}),
      ...(record.event.processId ? { processId: record.event.processId } : {}),
      ...(record.event.parentProcessId ? { parentProcessId: record.event.parentProcessId } : {}),
      ...(record.event.processGroupId ? { processGroupId: record.event.processGroupId } : {}),
      ...(record.turnId ? { turnId: record.turnId, turn_id: record.turnId } : {}),
      ...(candidate.questions ? { tool_input: { questions: candidate.questions } } : {}),
      receivedAt: now()
    })
  }

  const scanMonitor = async (record: CodexTranscriptMonitorRecord): Promise<void> => {
    if (record.disposed) return
    if (record.scanning) {
      record.scanAgain = true
      return
    }
    record.scanning = true
    record.scanAgain = false
    try {
      if (now() - record.startedAt > maxDurationMs()) {
        disposeMonitor(record)
        return
      }
      const result = await readCodexTranscriptUserInputState({
        path: record.transcriptPath,
        turnId: record.turnId,
        startOffset: record.startOffset,
        publishedCallIds: record.publishedCallIds,
        maxBytes: maxBytes()
      })
      if (result.candidate) publishQuestion(record, result.candidate)
      if (result.terminal) {
        disposeMonitor(record)
        return
      }
    } catch {
      // Transcript files can briefly disappear or be rotated while Codex writes them.
    } finally {
      record.scanning = false
    }
    if (record.scanAgain) {
      scheduleScan(record, 0)
      return
    }
    scheduleScan(record)
  }

  const startWatcher = (record: CodexTranscriptMonitorRecord) => {
    try {
      record.watcher?.close()
      record.watcher = watch(record.transcriptPath, () => scheduleScan(record, 50))
      record.watcher.on('error', () => {
        record.watcher?.close()
        record.watcher = undefined
      })
    } catch {
      record.watcher = undefined
    }
  }

  const start = ({ event, raw }: CodexTranscriptMonitorStartInput) => {
    if (event.source !== 'codex' || event.event !== 'prompt_submit') return
    const transcriptPath = cleanOptionalText(event.transcriptPath || raw.transcriptPath || raw.transcript_path)
    if (!transcriptPath) return
    const turnId = cleanOptionalText(raw.turnId || raw.turn_id)
    const key = monitorKey(event.sessionId, transcriptPath, turnId)
    const existing = monitors.get(key)
    if (existing) {
      existing.event = event
      existing.raw = raw
      scheduleScan(existing, 0)
      return
    }
    const startOffset = turnId
      ? 0
      : (() => {
          try {
            return statSync(transcriptPath).size
          } catch {
            return 0
          }
        })()
    const record: CodexTranscriptMonitorRecord = {
      key,
      sessionId: event.sessionId,
      transcriptPath,
      ...(turnId ? { turnId } : {}),
      startOffset,
      startedAt: now(),
      event,
      raw,
      publishedCallIds: new Set<string>(),
      scanning: false,
      scanAgain: false,
      disposed: false
    }
    monitors.set(key, record)
    startWatcher(record)
    scheduleScan(record, 0)
  }

  const stop = (sessionId: string, turnId?: string) => {
    const targetSessionId = cleanText(sessionId)
    const targetTurnId = cleanOptionalText(turnId)
    monitors.forEach((record) => {
      if (record.sessionId !== targetSessionId) return
      if (targetTurnId && record.turnId && record.turnId !== targetTurnId) return
      disposeMonitor(record)
    })
  }

  const reset = () => {
    monitors.forEach(disposeMonitor)
    monitors.clear()
  }

  const flush = async () => {
    await Promise.all([...monitors.values()].map((record) => scanMonitor(record)))
  }

  return {
    start,
    stop,
    reset,
    flush,
    activeCount: () => monitors.size
  }
}
