import { Worker } from 'node:worker_threads'
import type { ManagedAiSessionContentRecord } from '@shared/contracts/managedAiSessionContent'
import type { AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

type JsonlWorkerReadInput = {
  path: string
  source: AiAgentSessionSource
  sessionId: string
  sessionEditable: boolean
  editBlockedReason?: string
  maxContentChars: number
}

export type JsonlWorkerPageInput = JsonlWorkerReadInput & {
  offset: number
  limit: number
  query?: string
}

export type JsonlWorkerRecordInput = JsonlWorkerReadInput & {
  recordId: string
}

export type JsonlWorkerRewriteInput = {
  path: string
  tempPath: string
  sourceRevision: string
  lineNumber: number
  pointer: string
  operation: 'update' | 'delete'
  content?: string
}

type JsonlWorkerDiagnostics = {
  workerThreadId: number
  workerIsMainThread: boolean
}

export type JsonlWorkerPageOutcome = JsonlWorkerDiagnostics & {
  sourceRevision: string
  total: number
  matchTotal: number
  records: ManagedAiSessionContentRecord[]
}

export type JsonlWorkerRecordOutcome = JsonlWorkerDiagnostics & {
  sourceRevision: string
  record: ManagedAiSessionContentRecord | null
}

export type JsonlWorkerRewriteOutcome = JsonlWorkerDiagnostics & {
  sourceRevision: string
}

type JsonlWorkerRequest =
  | ({ id: number; kind: 'page' } & JsonlWorkerPageInput)
  | ({ id: number; kind: 'record' } & JsonlWorkerRecordInput)
  | ({ id: number; kind: 'rewrite' } & JsonlWorkerRewriteInput)

type JsonlWorkerResponse =
  | { id: number; ok: true; outcome: JsonlWorkerPageOutcome | JsonlWorkerRecordOutcome | JsonlWorkerRewriteOutcome }
  | { id: number; ok: false; code?: string; message: string }

type PendingWorkerRequest<T> = {
  worker: Worker
  resolve: (outcome: T) => void
  reject: (error: Error) => void
}

// The parser is kept in an eval worker so electron-vite does not need a second Main entry.
// Only the requested page or record crosses back to Main; the full parsed transcript stays
// inside the worker and is eligible for collection after each serialized request.
const JSONL_CONTENT_WORKER_SOURCE = String.raw`
'use strict'
const { readFile, stat, writeFile } = require('node:fs/promises')
const { isMainThread, parentPort, threadId } = require('node:worker_threads')

const skippedJsonStringKeys = new Set([
  'id', 'uuid', 'parentuuid', 'parentid', 'sessionid', 'session_id',
  'conversationid', 'conversation_id', 'cwd', 'version', 'model', 'role',
  'type', 'timestamp', 'createdat', 'updatedat', 'receivedat'
])
const jsonTextValueKeys = new Set([
  'text', 'inputtext', 'outputtext', 'content', 'message', 'lastagentmessage',
  'summary', 'result', 'output', 'stdout', 'stderr', 'error', 'arguments',
  'command', 'query'
])

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const cleanText = (value) => typeof value === 'string' ? value.trim() : ''
const workerError = (code, message) => Object.assign(new Error(message), { code })
const safeJsonParse = (value) => {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
const revisionForPath = async (path) => {
  const info = await stat(path, { bigint: true })
  return path + ':' + info.dev + ':' + info.ino + ':' + info.size + ':' + info.mtimeNs + ':' + info.ctimeNs
}
const truncateContent = (content, maxContentChars) => ({
  content: content.length > maxContentChars ? content.slice(0, maxContentChars) : content,
  contentTruncated: content.length > maxContentChars,
  fullLength: content.length
})
const pointerSegment = (value) => String(value).split('~').join('~0').split('/').join('~1')
const decodePointerSegment = (value) => value.replace(/~1/g, '/').replace(/~0/g, '~')
const pointerKeyName = (pointer) => decodePointerSegment(pointer.split('/').filter(Boolean).at(-1) || '').toLowerCase().replace(/[\s_-]+/g, '')
const shouldCollectJsonString = (pointer, value, contextKey = '') => {
  if (!value.trim()) return false
  const key = pointerKeyName(pointer)
  if (!jsonTextValueKeys.has(key) && !jsonTextValueKeys.has(contextKey)) return false
  if (skippedJsonStringKeys.has(key)) return false
  if (key.endsWith('id') && value.length < 160) return false
  return true
}
const collectTextPointers = (value, basePointer = '', contextKey = '') => {
  if (typeof value === 'string') {
    return shouldCollectJsonString(basePointer, value, contextKey) ? [{ pointer: basePointer || '/', value }] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectTextPointers(item, basePointer + '/' + pointerSegment(index), contextKey))
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    if (key.startsWith('_') && key !== '_data') return []
    const normalizedKey = key.toLowerCase().replace(/[\s_-]+/g, '')
    return collectTextPointers(item, basePointer + '/' + pointerSegment(key), jsonTextValueKeys.has(normalizedKey) ? normalizedKey : '')
  })
}
const valueAtPointer = (value, pointer) => {
  if (pointer === '/' || pointer === '') return value
  let current = value
  for (const rawSegment of pointer.split('/').filter(Boolean)) {
    const segment = decodePointerSegment(rawSegment)
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (isRecord(current)) current = current[segment]
    else return undefined
  }
  return current
}
const setValueAtPointer = (value, pointer, nextValue) => {
  if (!isRecord(value) && !Array.isArray(value)) return false
  if (pointer === '/' || pointer === '') return false
  const segments = pointer.split('/').filter(Boolean).map(decodePointerSegment)
  let current = value
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    current = Array.isArray(current) ? current[Number(segment)] : isRecord(current) ? current[segment] : undefined
    if (!isRecord(current) && !Array.isArray(current)) return false
  }
  const last = segments.at(-1)
  if (last === undefined) return false
  if (Array.isArray(current)) {
    const index = Number(last)
    if (!Number.isInteger(index) || typeof current[index] !== 'string') return false
    current[index] = nextValue
    return true
  }
  if (!isRecord(current) || typeof current[last] !== 'string') return false
  current[last] = nextValue
  return true
}
const removeValueAtPointer = (value, pointer) => {
  if (!isRecord(value) && !Array.isArray(value)) return false
  if (pointer === '/' || pointer === '') return false
  const segments = pointer.split('/').filter(Boolean).map(decodePointerSegment)
  let current = value
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    current = Array.isArray(current) ? current[Number(segment)] : isRecord(current) ? current[segment] : undefined
    if (!isRecord(current) && !Array.isArray(current)) return false
  }
  const last = segments.at(-1)
  if (last === undefined) return false
  if (Array.isArray(current)) {
    const index = Number(last)
    if (!Number.isInteger(index) || typeof current[index] !== 'string') return false
    current.splice(index, 1)
    return true
  }
  if (!isRecord(current) || typeof current[last] !== 'string') return false
  delete current[last]
  return true
}
const isInjectedSessionContextText = (content) => {
  const text = content.trimStart().toLowerCase()
  return (
    text.startsWith('# agents.md instructions') ||
    text.startsWith('<environment_context>') ||
    text.startsWith('<permissions instructions>') ||
    text.startsWith('<collaboration_mode>') ||
    text.startsWith('<skills_instructions>') ||
    text.startsWith('<plugins_instructions>')
  )
}
const inferJsonRole = (record, pointer, content = '') => {
  if (isInjectedSessionContextText(content)) return 'developer'
  const message = isRecord(record.message) ? record.message : null
  const payload = isRecord(record.payload) ? record.payload : null
  const directRole = cleanText(record.role || (message && message.role) || (payload && payload.role)).toLowerCase()
  if (['system', 'developer', 'user', 'assistant', 'tool'].includes(directRole)) return directRole
  const type = [record.type, payload && payload.type, message && message.type]
    .map((item) => cleanText(item).toLowerCase())
    .filter(Boolean)
    .join(' ')
  if (type.includes('user')) return 'user'
  if (type.includes('assistant') || type.includes('agent')) return 'assistant'
  if (type.includes('system')) return 'system'
  if (type.includes('tool') || type.includes('function') || pointer.includes('/tool')) return 'tool'
  return 'unknown'
}
const codexPayloadFor = (line) => line.parsed && line.parsed.payload && isRecord(line.parsed.payload) ? line.parsed.payload : null
const codexPayloadTypeFor = (line) => cleanText(codexPayloadFor(line) && codexPayloadFor(line).type)
const isCodexFunctionCallLine = (line) => line.parsed && line.parsed.type === 'response_item' && codexPayloadTypeFor(line) === 'function_call'
const codexCallIdFor = (line) => cleanText(codexPayloadFor(line) && codexPayloadFor(line).call_id)
const collectCodexToolNamesByCallId = (lines) => {
  const namesByCallId = new Map()
  lines.forEach((line) => {
    if (!isCodexFunctionCallLine(line)) return
    const callId = codexCallIdFor(line)
    const name = cleanText(codexPayloadFor(line) && codexPayloadFor(line).name)
    if (callId && name && !namesByCallId.has(callId)) namesByCallId.set(callId, name)
  })
  return namesByCallId
}
const jsonMessageType = (record, toolNamesByCallId) => {
  const message = isRecord(record.message) ? record.message : null
  const payload = isRecord(record.payload) ? record.payload : null
  const payloadType = cleanText(payload && payload.type)
  const callId = cleanText(payload && payload.call_id)
  const toolName = cleanText(payload && payload.name) || (callId && toolNamesByCallId ? toolNamesByCallId.get(callId) || '' : '')
  if (record.type === 'response_item' && payloadType === 'function_call') return toolName ? 'tool call: ' + toolName : 'tool call'
  if (record.type === 'response_item' && payloadType === 'function_call_output') return toolName ? 'tool result: ' + toolName : 'tool result'
  return [cleanText(record.type), cleanText(payload && payload.type), cleanText(message && (message.role || message.type))].filter(Boolean).join(' / ') || 'message'
}
const shouldSkipJsonTextPointer = (line, item) => Boolean(line.parsed && line.parsed.type === 'turn_context' && item.pointer === '/payload/summary')
const jsonlRecordId = (lineNumber, pointer) => 'jsonl:' + lineNumber + ':' + encodeURIComponent(pointer)
const readJsonlLines = async (path, keepRawLines = false) => {
  const raw = await readFile(path, 'utf-8')
  const trailingNewline = raw.endsWith('\n')
  const rawLines = raw.split(/\r?\n/)
  if (trailingNewline) rawLines.pop()
  return {
    rawLines: keepRawLines ? rawLines : undefined,
    trailingNewline,
    lines: rawLines.map((line, index) => ({
      lineNumber: index + 1,
      parsed: line.trim() ? safeJsonParse(line) : null
    }))
  }
}
const selectJsonlRecords = (request, lines, sourceRevision) => {
  const records = []
  let selectedRecord = null
  let total = 0
  let matchTotal = 0
  const query = cleanText(request.query).toLowerCase()
  const toolNamesByCallId = request.source === 'codex' ? collectCodexToolNamesByCallId(lines) : undefined
  lines.forEach((line) => {
    if (!line.parsed) return
    collectTextPointers(line.parsed).forEach((item) => {
      if (shouldSkipJsonTextPointer(line, item)) return
      const ordinal = total
      total += 1
      const recordId = jsonlRecordId(line.lineNumber, item.pointer)
      const locationLabel = 'line ' + line.lineNumber + ' ' + item.pointer
      const role = inferJsonRole(line.parsed, item.pointer, item.value)
      const messageType = jsonMessageType(line.parsed, toolNamesByCallId)
      const matchesQuery = request.kind === 'record' || !query || [role, messageType, locationLabel, item.value].some((value) => String(value).toLowerCase().includes(query))
      if (!matchesQuery) return
      const matchOrdinal = matchTotal
      matchTotal += 1
      const selected = request.kind === 'record'
        ? recordId === request.recordId
        : matchOrdinal >= request.offset && matchOrdinal < request.offset + request.limit
      if (!selected) return
      const truncated = truncateContent(item.value, request.maxContentChars)
      const record = {
        source: request.source,
        sessionId: request.sessionId,
        format: 'jsonl',
        recordId,
        ordinal,
        locationLabel,
        role,
        messageType,
        content: truncated.content,
        contentTruncated: truncated.contentTruncated,
        fullLength: truncated.fullLength,
        editable: request.sessionEditable,
        sourceRevision
      }
      if (request.editBlockedReason) record.editBlockedReason = request.editBlockedReason
      if (request.kind === 'record') selectedRecord = record
      else records.push(record)
    })
  })
  return { total, matchTotal, records, selectedRecord }
}
const executeRead = async (request) => {
  const sourceRevision = await revisionForPath(request.path)
  const { lines } = await readJsonlLines(request.path)
  const selected = selectJsonlRecords(request, lines, sourceRevision)
  const diagnostics = { workerThreadId: threadId, workerIsMainThread: isMainThread }
  if (request.kind === 'record') {
    return { ...diagnostics, sourceRevision, record: selected.selectedRecord }
  }
  return {
    ...diagnostics,
    sourceRevision,
    total: selected.total,
    matchTotal: selected.matchTotal,
    records: selected.records
  }
}
const executeRewrite = async (request) => {
  const sourceRevision = await revisionForPath(request.path)
  if (sourceRevision !== request.sourceRevision) {
    throw workerError('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Reload before saving.')
  }
  const { lines, rawLines, trailingNewline } = await readJsonlLines(request.path, true)
  if (await revisionForPath(request.path) !== request.sourceRevision) {
    throw workerError('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Reload before saving.')
  }
  if (!rawLines) throw workerError('MANAGED_AI_CONTENT_WORKER_FAILED', 'Managed AI content worker did not retain source lines.')
  const line = lines.find((item) => item.lineNumber === request.lineNumber)
  if (!line || !line.parsed || typeof valueAtPointer(line.parsed, request.pointer) !== 'string') {
    throw workerError('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
  }
  if (request.operation === 'update') {
    if (typeof request.content !== 'string' || !setValueAtPointer(line.parsed, request.pointer, request.content)) {
      throw workerError('MANAGED_AI_CONTENT_RECORD_READ_ONLY', 'Managed AI content record is read-only.')
    }
  } else if (!removeValueAtPointer(line.parsed, request.pointer)) {
    throw workerError('MANAGED_AI_CONTENT_RECORD_READ_ONLY', 'Managed AI content record is read-only.')
  }
  const keepLine = request.operation === 'update' || collectTextPointers(line.parsed).some((item) => !shouldSkipJsonTextPointer(line, item))
  const nextLines = []
  rawLines.forEach((raw, index) => {
    const originalLineNumber = index + 1
    if (originalLineNumber !== line.lineNumber) nextLines.push(raw)
    else if (keepLine) nextLines.push(JSON.stringify(line.parsed))
  })
  const suffix = trailingNewline && (request.operation !== 'delete' || nextLines.length) ? '\n' : ''
  await writeFile(request.tempPath, nextLines.join('\n') + suffix, 'utf-8')
  return { workerThreadId: threadId, workerIsMainThread: isMainThread, sourceRevision }
}
const handleRequest = async (request) => {
  try {
    const outcome = request.kind === 'rewrite' ? await executeRewrite(request) : await executeRead(request)
    parentPort.postMessage({ id: request.id, ok: true, outcome })
  } catch (error) {
    parentPort.postMessage({
      id: request.id,
      ok: false,
      code: error && typeof error === 'object' && 'code' in error ? String(error.code || '') : '',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
let queue = Promise.resolve()
parentPort.on('message', (request) => {
  queue = queue.then(() => handleRequest(request), () => handleRequest(request))
})
`

let worker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingWorkerRequest<unknown>>()

const contentWorkerError = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {})

const failPendingRequestsForWorker = (target: Worker, error: Error) => {
  for (const [id, pending] of pendingRequests) {
    if (pending.worker !== target) continue
    pendingRequests.delete(id)
    pending.reject(error)
  }
}

const ensureContentWorker = () => {
  if (worker) return worker
  const created = new Worker(JSONL_CONTENT_WORKER_SOURCE, { eval: true })
  created.on('message', (response: JsonlWorkerResponse) => {
    const pending = pendingRequests.get(response.id)
    if (!pending || pending.worker !== created) return
    pendingRequests.delete(response.id)
    if (![...pendingRequests.values()].some((request) => request.worker === created)) created.unref()
    if (!response.ok) {
      pending.reject(contentWorkerError(response.message, response.code || undefined))
      return
    }
    pending.resolve(response.outcome)
  })
  created.on('error', (error) => {
    if (worker === created) worker = null
    failPendingRequestsForWorker(created, contentWorkerError(error instanceof Error ? error.stack || error.message : String(error), 'MANAGED_AI_CONTENT_WORKER_FAILED'))
  })
  created.on('exit', (code) => {
    if (worker === created) worker = null
    failPendingRequestsForWorker(created, contentWorkerError(`Managed AI content worker exited unexpectedly (${code}).`, 'MANAGED_AI_CONTENT_WORKER_FAILED'))
  })
  created.unref()
  worker = created
  return created
}

const requestContentWorker = <T>(request: Omit<JsonlWorkerRequest, 'id'>): Promise<T> =>
  new Promise((resolve, reject) => {
    let target: Worker
    try {
      target = ensureContentWorker()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const id = nextRequestId
    nextRequestId += 1
    pendingRequests.set(id, { worker: target, resolve: resolve as (outcome: unknown) => void, reject })
    target.ref()
    try {
      target.postMessage({ id, ...request })
    } catch (error) {
      pendingRequests.delete(id)
      if (![...pendingRequests.values()].some((pending) => pending.worker === target)) target.unref()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

export const listJsonlSessionContentInWorker = (input: JsonlWorkerPageInput) =>
  requestContentWorker<JsonlWorkerPageOutcome>({ kind: 'page', ...input })

export const getJsonlSessionContentRecordInWorker = (input: JsonlWorkerRecordInput) =>
  requestContentWorker<JsonlWorkerRecordOutcome>({ kind: 'record', ...input })

export const rewriteJsonlSessionContentInWorker = (input: JsonlWorkerRewriteInput) =>
  requestContentWorker<JsonlWorkerRewriteOutcome>({ kind: 'rewrite', ...input })

export const disposeAgentSessionContentWorker = async () => {
  const target = worker
  if (!target) return
  worker = null
  failPendingRequestsForWorker(target, contentWorkerError('Managed AI content worker disposed.', 'MANAGED_AI_CONTENT_WORKER_FAILED'))
  await target.terminate()
}
