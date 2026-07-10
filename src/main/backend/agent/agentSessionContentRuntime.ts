import { randomUUID } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { openSqliteDatabase, type SqliteDatabase } from '@shared/databaseSqliteRuntime'
import type {
  ManagedAiSessionContentDeleteInput,
  ManagedAiSessionContentDeleteResult,
  ManagedAiSessionContentFormat,
  ManagedAiSessionContentListInput,
  ManagedAiSessionContentListResult,
  ManagedAiSessionContentRecord,
  ManagedAiSessionContentRecordInput,
  ManagedAiSessionContentRecordResult,
  ManagedAiSessionContentRole,
  ManagedAiSessionContentSnapshot,
  ManagedAiSessionContentUpdateInput,
  ManagedAiSessionContentUpdateResult
} from '@shared/contracts/managedAiSessionContent'
import type { AiAgentSessionSource, ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'
import {
  cleanOptionalText,
  cleanText,
  compactString,
  isRecord,
  normalizeSource,
  sessionKey
} from './agentSessionNormalization'

type AgentSessionContentRuntimeConfig = {
  loadStoreIfNeeded: () => Promise<void>
  getSession: (source: AiAgentSessionSource, sessionId: string) => ManagedAiSessionRecord | null
  getUserDataPath: () => string
  getHomeDir: () => string
  getEnv: () => NodeJS.ProcessEnv
  now: () => number
}

type JsonlLineRecord = {
  lineNumber: number
  raw: string
  parsed: Record<string, unknown> | null
}

type TextPointer = {
  pointer: string
  value: string
}

type JsonlRecordLocator = {
  lineNumber: number
  pointer: string
}

type OpenCodeRecordLocator = {
  messageId: string
  partId: string
  field: 'text'
}

type ContentSessionResolve =
  | {
      source: AiAgentSessionSource
      sessionId: string
      session: ManagedAiSessionRecord
    }
  | {
      error: ManagedAiSessionContentListResult
    }

type ReadSessionContentResult = {
  format: ManagedAiSessionContentFormat
  sourceRevision: string
  editable: boolean
  editBlockedReason?: string
  storagePath?: string
  unsupportedReason?: string
  records: ManagedAiSessionContentRecord[]
}

type OpenCodePartRow = {
  message_id?: string
  message_data?: string
  message_created?: number
  part_id?: string
  part_data?: string
}

type OpenCodeSessionRow = {
  id?: string
  title?: string
  directory?: string
  time_updated?: number
}

const defaultLimit = 200
const maxLimit = 500
const defaultMaxContentChars = 16_000
const maxContentCharsLimit = 1_000_000
const maxScanFiles = 2400
const editableSources = new Set<AiAgentSessionSource>(['codex', 'claude-code', 'opencode'])
const jsonlSources = new Set<AiAgentSessionSource>(['codex', 'claude-code'])
const skippedJsonStringKeys = new Set([
  'id',
  'uuid',
  'parentuuid',
  'parentid',
  'sessionid',
  'session_id',
  'conversationid',
  'conversation_id',
  'cwd',
  'version',
  'model',
  'role',
  'type',
  'timestamp',
  'createdat',
  'updatedat',
  'receivedat'
])

const jsonTextValueKeys = new Set([
  'text',
  'inputtext',
  'outputtext',
  'content',
  'message',
  'lastagentmessage',
  'summary',
  'result',
  'output',
  'stdout',
  'stderr',
  'error',
  'arguments',
  'command',
  'query'
])

const contentError = <T>(errorCode: string, errorMessage: string): T => ({ ok: false, errorCode, errorMessage } as T)

const defaultHomeDir = () => process.env.HOME || process.env.USERPROFILE || ''

const normalizePositiveInt = (value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.max(1, Math.min(max, Math.floor(number)))
}

const normalizeOffset = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

const truncateContent = (content: string, maxContentChars: number) => ({
  content: content.length > maxContentChars ? content.slice(0, maxContentChars) : content,
  contentTruncated: content.length > maxContentChars,
  fullLength: content.length
})

const cleanPath = (value: unknown, home = defaultHomeDir()) => {
  const text = cleanOptionalText(value)
  if (!text) return undefined
  return text.replace(/^~(?=$|\/)/, home)
}

const pathInHome = (home: string, relative: string) => join(home || defaultHomeDir(), relative)

const codexHomeFor = (env: NodeJS.ProcessEnv, home: string) => cleanPath(env.CODEX_HOME, home) || pathInHome(home, '.codex')

const claudeHomesFor = (env: NodeJS.ProcessEnv, home: string) => {
  const roots: string[] = []
  const add = (path?: string) => {
    const normalized = cleanPath(path, home)
    if (normalized && !roots.includes(normalized)) roots.push(normalized)
  }
  add(env.CLAUDE_CONFIG_DIR)
  add(pathInHome(home, '.claude'))
  return roots
}

const opencodeConfigPath = (env: NodeJS.ProcessEnv, home: string) => cleanPath(env.OPENCODE_CONFIG_DIR, home) || pathInHome(home, '.local/share/opencode')

const safeJsonParse = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const revisionForFiles = async (paths: string[]) => {
  const parts: string[] = []
  for (const filePath of paths) {
    try {
      const info = await stat(filePath)
      parts.push(`${filePath}:${info.size}:${Math.round(info.mtimeMs)}`)
    } catch {
      parts.push(`${filePath}:missing`)
    }
  }
  return parts.join('|')
}

const sourceIsEditable = (session: ManagedAiSessionRecord | null, source: AiAgentSessionSource) => {
  if (!editableSources.has(source)) return { editable: false, reason: 'This AI source does not expose editable local conversation content yet.' }
  if (session?.state === 'working' || session?.state === 'needsInput') {
    return { editable: false, reason: 'Running or pending-input AI sessions are read-only. Stop or finish the session before editing.' }
  }
  return { editable: true }
}

const safeBackupSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 90) || 'session'

const backupDirFor = (userDataPath: string, source: AiAgentSessionSource, sessionId: string) =>
  join(userDataPath || defaultHomeDir(), 'agent-sessions', 'content-backups', source, safeBackupSegment(sessionId))

const cleanupBackups = async (backupDir: string) => {
  let entries: string[]
  try {
    entries = readdirSync(backupDir)
  } catch {
    return
  }
  const files = entries
    .map((entry) => {
      const path = join(backupDir, entry)
      try {
        const item = statSync(path)
        return item.isFile() ? { path, mtimeMs: item.mtimeMs } : null
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ path: string; mtimeMs: number }>
  await Promise.all(files.sort((first, second) => second.mtimeMs - first.mtimeMs).slice(20).map((file) => rm(file.path, { force: true })))
}

const backupFiles = async (input: {
  userDataPath: string
  source: AiAgentSessionSource
  sessionId: string
  paths: string[]
  now: number
}) => {
  const backupDir = backupDirFor(input.userDataPath, input.source, input.sessionId)
  await mkdir(backupDir, { recursive: true })
  const stamp = new Date(input.now).toISOString().replace(/[:.]/g, '-')
  let firstBackupPath = ''
  for (const path of input.paths) {
    if (!existsSync(path)) continue
    const target = join(backupDir, `${stamp}-${safeBackupSegment(basename(path))}.bak`)
    await copyFile(path, target)
    if (!firstBackupPath) firstBackupPath = target
  }
  await cleanupBackups(backupDir)
  return firstBackupPath || undefined
}

const collectFiles = (root: string, extension = '.jsonl') => {
  const out: Array<{ path: string; mtimeMs: number }> = []
  const stack = [root]
  while (stack.length && out.length < maxScanFiles) {
    const current = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry)
      let item
      try {
        item = statSync(path)
      } catch {
        continue
      }
      if (item.isDirectory()) {
        stack.push(path)
      } else if (item.isFile() && path.endsWith(extension)) {
        out.push({ path, mtimeMs: item.mtimeMs })
        if (out.length >= maxScanFiles) break
      }
    }
  }
  return out.sort((first, second) => second.mtimeMs - first.mtimeMs)
}

const findJsonlTranscriptPath = (session: ManagedAiSessionRecord | null, source: AiAgentSessionSource, config: AgentSessionContentRuntimeConfig) => {
  const transcriptPath = cleanOptionalText(session?.transcriptPath)
  if (transcriptPath && existsSync(transcriptPath)) return transcriptPath
  const home = config.getHomeDir()
  const env = config.getEnv()
  if (source === 'codex') {
    const files = collectFiles(join(codexHomeFor(env, home), 'sessions'))
    return files.find((file) => resolve(file.path).replace(/\.[^.]+$/, '').split(/[\\/]/).pop() === session?.id)?.path
  }
  if (source === 'claude-code') {
    for (const claudeHome of claudeHomesFor(env, home)) {
      const files = collectFiles(join(claudeHome, 'projects'))
      const match = files.find((file) => resolve(file.path).replace(/\.[^.]+$/, '').split(/[\\/]/).pop() === session?.id)
      if (match) return match.path
    }
  }
  return undefined
}

const readJsonlLines = async (path: string): Promise<{ lines: JsonlLineRecord[]; trailingNewline: boolean }> => {
  const raw = await readFile(path, 'utf-8')
  const trailingNewline = raw.endsWith('\n')
  const rawLines = raw.split(/\r?\n/)
  if (trailingNewline) rawLines.pop()
  return {
    trailingNewline,
    lines: rawLines.map((line, index) => ({
      lineNumber: index + 1,
      raw: line,
      parsed: line.trim() ? safeJsonParse(line) : null
    }))
  }
}

const pointerSegment = (value: string | number) => String(value).replace(/~/g, '~0').replace(/\//g, '~1')

const decodePointerSegment = (value: string) => value.replace(/~1/g, '/').replace(/~0/g, '~')

const pointerKeyName = (pointer: string) => decodePointerSegment(pointer.split('/').filter(Boolean).at(-1) || '').toLowerCase().replace(/[\s_-]+/g, '')

const shouldCollectJsonString = (pointer: string, value: string, contextKey = '') => {
  if (!value.trim()) return false
  const key = pointerKeyName(pointer)
  if (!jsonTextValueKeys.has(key) && !jsonTextValueKeys.has(contextKey)) return false
  if (skippedJsonStringKeys.has(key)) return false
  if (key.endsWith('id') && value.length < 160) return false
  return true
}

const collectTextPointers = (value: unknown, basePointer = '', contextKey = ''): TextPointer[] => {
  if (typeof value === 'string') {
    return shouldCollectJsonString(basePointer, value, contextKey) ? [{ pointer: basePointer || '/', value }] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectTextPointers(item, `${basePointer}/${pointerSegment(index)}`, contextKey))
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    if (key.startsWith('_') && key !== '_data') return []
    const normalizedKey = key.toLowerCase().replace(/[\s_-]+/g, '')
    return collectTextPointers(item, `${basePointer}/${pointerSegment(key)}`, jsonTextValueKeys.has(normalizedKey) ? normalizedKey : '')
  })
}

const valueAtPointer = (value: unknown, pointer: string) => {
  if (pointer === '/' || pointer === '') return value
  let current: unknown = value
  for (const rawSegment of pointer.split('/').filter(Boolean)) {
    const segment = decodePointerSegment(rawSegment)
    if (Array.isArray(current)) {
      current = current[Number(segment)]
    } else if (isRecord(current)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

const setValueAtPointer = (value: unknown, pointer: string, nextValue: string) => {
  if (!isRecord(value) && !Array.isArray(value)) return false
  if (pointer === '/' || pointer === '') return false
  const segments = pointer.split('/').filter(Boolean).map(decodePointerSegment)
  let current: unknown = value
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

const removeValueAtPointer = (value: unknown, pointer: string) => {
  if (!isRecord(value) && !Array.isArray(value)) return false
  if (pointer === '/' || pointer === '') return false
  const segments = pointer.split('/').filter(Boolean).map(decodePointerSegment)
  let current: unknown = value
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

const isInjectedSessionContextText = (content: string) => {
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

const inferJsonRole = (record: Record<string, unknown>, pointer: string, content = ''): ManagedAiSessionContentRole => {
  if (isInjectedSessionContextText(content)) return 'developer'
  const message = isRecord(record.message) ? record.message : null
  const payload = isRecord(record.payload) ? record.payload : null
  const directRole = cleanText(record.role || message?.role || payload?.role).toLowerCase()
  if (directRole === 'system' || directRole === 'developer' || directRole === 'user' || directRole === 'assistant' || directRole === 'tool') return directRole
  const type = [record.type, payload?.type, message?.type]
    .map((item) => cleanText(item).toLowerCase())
    .filter(Boolean)
    .join(' ')
  if (type.includes('user')) return 'user'
  if (type.includes('assistant') || type.includes('agent')) return 'assistant'
  if (type.includes('system')) return 'system'
  if (type.includes('tool') || type.includes('function') || pointer.includes('/tool')) return 'tool'
  return 'unknown'
}

const jsonMessageType = (record: Record<string, unknown>, toolNamesByCallId?: Map<string, string>) => {
  const message = isRecord(record.message) ? record.message : null
  const payload = isRecord(record.payload) ? record.payload : null
  const payloadType = cleanText(payload?.type)
  const callId = cleanText(payload?.call_id)
  const toolName = cleanText(payload?.name) || (callId ? toolNamesByCallId?.get(callId) || '' : '')
  if (record.type === 'response_item' && payloadType === 'function_call') return toolName ? `tool call: ${toolName}` : 'tool call'
  if (record.type === 'response_item' && payloadType === 'function_call_output') return toolName ? `tool result: ${toolName}` : 'tool result'
  return [cleanText(record.type), cleanText(payload?.type), cleanText(message?.role || message?.type)].filter(Boolean).join(' / ') || 'message'
}

const jsonlRecordId = (lineNumber: number, pointer: string) => `jsonl:${lineNumber}:${encodeURIComponent(pointer)}`

const parseJsonlRecordId = (recordId: string): JsonlRecordLocator | null => {
  const match = /^jsonl:(\d+):(.+)$/.exec(recordId)
  if (!match) return null
  const lineNumber = Number(match[1])
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) return null
  return { lineNumber, pointer: decodeURIComponent(match[2]) }
}

const codexPayloadFor = (line: JsonlLineRecord) => (line.parsed?.payload && isRecord(line.parsed.payload) ? line.parsed.payload : null)

const codexPayloadTypeFor = (line: JsonlLineRecord) => cleanText(codexPayloadFor(line)?.type)

const isCodexFunctionCallLine = (line: JsonlLineRecord) => line.parsed?.type === 'response_item' && codexPayloadTypeFor(line) === 'function_call'

const codexCallIdFor = (line: JsonlLineRecord) => cleanText(codexPayloadFor(line)?.call_id)

const collectCodexToolNamesByCallId = (lines: JsonlLineRecord[]) => {
  const namesByCallId = new Map<string, string>()
  lines.forEach((line) => {
    if (!isCodexFunctionCallLine(line)) return
    const callId = codexCallIdFor(line)
    const name = cleanText(codexPayloadFor(line)?.name)
    if (callId && name && !namesByCallId.has(callId)) namesByCallId.set(callId, name)
  })
  return namesByCallId
}

const shouldSkipJsonTextPointer = (line: JsonlLineRecord, item: TextPointer) => {
  if (line.parsed?.type === 'turn_context' && item.pointer === '/payload/summary') return true
  return false
}

const lineHasVisibleTextPointers = (line: JsonlLineRecord) =>
  Boolean(line.parsed && collectTextPointers(line.parsed).some((item) => !shouldSkipJsonTextPointer(line, item)))

const buildJsonlRecords = (input: {
  source: AiAgentSessionSource
  sessionId: string
  format: ManagedAiSessionContentFormat
  lines: JsonlLineRecord[]
  sourceRevision: string
  sessionEditable: boolean
  editBlockedReason?: string
  maxContentChars: number
}) => {
  const records: ManagedAiSessionContentRecord[] = []
  const toolNamesByCallId = input.source === 'codex' ? collectCodexToolNamesByCallId(input.lines) : undefined
  input.lines.forEach((line) => {
    if (!line.parsed) return
    collectTextPointers(line.parsed).forEach((item) => {
      if (shouldSkipJsonTextPointer(line, item)) return
      const truncated = truncateContent(item.value, input.maxContentChars)
      records.push({
        source: input.source,
        sessionId: input.sessionId,
        format: input.format,
        recordId: jsonlRecordId(line.lineNumber, item.pointer),
        ordinal: records.length,
        locationLabel: `line ${line.lineNumber} ${item.pointer}`,
        role: inferJsonRole(line.parsed!, item.pointer, item.value),
        messageType: jsonMessageType(line.parsed!, toolNamesByCallId),
        content: truncated.content,
        contentTruncated: truncated.contentTruncated,
        fullLength: truncated.fullLength,
        editable: input.sessionEditable,
        ...(input.editBlockedReason ? { editBlockedReason: input.editBlockedReason } : {}),
        sourceRevision: input.sourceRevision
      })
    })
  })
  return records
}

const queryRows = <T extends Record<string, unknown>>(db: SqliteDatabase, sql: string, params: unknown[] = []) => {
  const statement = db.prepare(sql)
  return (params.length ? statement.all(...params) : statement.all()) as T[]
}

const openCodeDbPath = (config: AgentSessionContentRuntimeConfig) => join(opencodeConfigPath(config.getEnv(), config.getHomeDir()), 'opencode.db')

const opencodeRevisionPaths = (dbPath: string) => [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]

const inferOpenCodeRole = (messageData: Record<string, unknown> | null): ManagedAiSessionContentRole => {
  const info = messageData?.info && isRecord(messageData.info) ? messageData.info : null
  const role = cleanText(messageData?.role || info?.role).toLowerCase()
  if (role === 'system' || role === 'developer' || role === 'user' || role === 'assistant' || role === 'tool') return role
  return 'unknown'
}

const openCodeRecordId = (messageId: string, partId: string) => `opencode:${encodeURIComponent(messageId)}:${encodeURIComponent(partId)}:text`

const parseOpenCodeRecordId = (recordId: string): OpenCodeRecordLocator | null => {
  const match = /^opencode:([^:]+):([^:]+):text$/.exec(recordId)
  if (!match) return null
  return { messageId: decodeURIComponent(match[1]), partId: decodeURIComponent(match[2]), field: 'text' }
}

const buildOpenCodeRecords = (input: {
  source: AiAgentSessionSource
  sessionId: string
  rows: OpenCodePartRow[]
  sourceRevision: string
  sessionEditable: boolean
  editBlockedReason?: string
  maxContentChars: number
}) => {
  const records: ManagedAiSessionContentRecord[] = []
  input.rows.forEach((row) => {
    const messageId = cleanOptionalText(row.message_id)
    const partId = cleanOptionalText(row.part_id)
    if (!messageId || !partId) return
    const messageData = row.message_data ? safeJsonParse(row.message_data) : null
    const partData = row.part_data ? safeJsonParse(row.part_data) : null
    const text = typeof partData?.text === 'string' ? partData.text : ''
    if (!text.trim()) return
    const type = cleanText(partData?.type) || 'part'
    const partEditable = input.sessionEditable && (type === 'text' || type === 'reasoning')
    const truncated = truncateContent(text, input.maxContentChars)
    records.push({
      source: input.source,
      sessionId: input.sessionId,
      format: 'opencode-sqlite',
      recordId: openCodeRecordId(messageId, partId),
      ordinal: records.length,
      locationLabel: `message ${messageId} / part ${partId}`,
      role: inferOpenCodeRole(messageData),
      messageType: type,
      content: truncated.content,
      contentTruncated: truncated.contentTruncated,
      fullLength: truncated.fullLength,
      editable: partEditable,
      ...(partEditable ? {} : { editBlockedReason: input.editBlockedReason || `${type} parts are read-only.` }),
      sourceRevision: input.sourceRevision,
      ...(typeof row.message_created === 'number' ? { createdAt: row.message_created } : {})
    })
  })
  return records
}

const buildEventRecords = (input: {
  session: ManagedAiSessionRecord
  sourceRevision: string
  maxContentChars: number
}) =>
  input.session.events.map((event, index) => {
    const raw = event.raw ? `\n\n${JSON.stringify(event.raw, null, 2)}` : ''
    const content = `${event.summary || event.title || event.event}${raw}`
    const truncated = truncateContent(content, input.maxContentChars)
    return {
      source: input.session.source,
      sessionId: input.session.id,
      format: 'events' as const,
      recordId: `events:${index}`,
      ordinal: index,
      locationLabel: event.receivedAt ? new Date(event.receivedAt).toISOString() : `event ${index + 1}`,
      role: 'unknown' as const,
      messageType: event.event,
      content: truncated.content,
      contentTruncated: truncated.contentTruncated,
      fullLength: truncated.fullLength,
      editable: false,
      editBlockedReason: 'Imported event summaries are read-only.',
      sourceRevision: input.sourceRevision,
      createdAt: event.receivedAt
    } satisfies ManagedAiSessionContentRecord
  })

const paginateRecords = <T>(records: T[], offset: number, limit: number) => records.slice(offset, offset + limit)

const resolveSession = async (config: AgentSessionContentRuntimeConfig, sourceValue: unknown, sessionIdValue: unknown): Promise<ContentSessionResolve> => {
  await config.loadStoreIfNeeded()
  const source = normalizeSource(sourceValue)
  const sessionId = cleanOptionalText(sessionIdValue)
  if (!source) return { error: contentError<ManagedAiSessionContentListResult>('MANAGED_AI_CONTENT_SOURCE_INVALID', 'Managed AI session source is invalid.') }
  if (!sessionId) return { error: contentError<ManagedAiSessionContentListResult>('MANAGED_AI_CONTENT_SESSION_ID_REQUIRED', 'Managed AI session id is required.') }
  const session = config.getSession(source, sessionId)
  if (!session) return { error: contentError<ManagedAiSessionContentListResult>('MANAGED_AI_SESSION_NOT_FOUND', 'Managed AI session was not found.') }
  return { source, sessionId, session }
}

const snapshotFromRecords = (input: {
  session: ManagedAiSessionRecord
  format: ManagedAiSessionContentFormat
  sourceRevision: string
  total: number
  offset: number
  limit: number
  editable: boolean
  editBlockedReason?: string
  storagePath?: string
  unsupportedReason?: string
  records: ManagedAiSessionContentRecord[]
}): ManagedAiSessionContentSnapshot => ({
  source: input.session.source,
  sessionId: input.session.id,
  title: input.session.title,
  format: input.format,
  sourceRevision: input.sourceRevision,
  total: input.total,
  offset: input.offset,
  limit: input.limit,
  editable: input.editable,
  ...(input.editBlockedReason ? { editBlockedReason: input.editBlockedReason } : {}),
  sessionState: input.session.state,
  ...(input.storagePath ? { storagePath: input.storagePath } : {}),
  ...(input.unsupportedReason ? { unsupportedReason: input.unsupportedReason } : {}),
  records: input.records
})

const readJsonlContent = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, maxContentChars: number): Promise<ReadSessionContentResult | null> => {
  const path = findJsonlTranscriptPath(session, session.source, config)
  if (!path) return null
  const sourceRevision = await revisionForFiles([path])
  const editState = sourceIsEditable(session, session.source)
  const { lines } = await readJsonlLines(path)
  return {
    format: 'jsonl' as const,
    sourceRevision,
    storagePath: path,
    editable: editState.editable,
    editBlockedReason: editState.reason,
    records: buildJsonlRecords({
      source: session.source,
      sessionId: session.id,
      format: 'jsonl',
      lines,
      sourceRevision,
      sessionEditable: editState.editable,
      ...(editState.reason ? { editBlockedReason: editState.reason } : {}),
      maxContentChars
    })
  }
}

const readOpenCodeContent = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, maxContentChars: number): Promise<ReadSessionContentResult | null> => {
  const dbPath = openCodeDbPath(config)
  if (!existsSync(dbPath)) return null
  const sourceRevision = await revisionForFiles(opencodeRevisionPaths(dbPath))
  const editState = sourceIsEditable(session, session.source)
  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(dbPath, true)
    const rows = queryRows<OpenCodePartRow>(
      db,
      `SELECT m.id AS message_id, m.data AS message_data, m.time_created AS message_created,
              p.id AS part_id, p.data AS part_data
       FROM message m
       LEFT JOIN part p ON p.message_id = m.id
       WHERE m.session_id = ? AND p.id IS NOT NULL
       ORDER BY m.time_created ASC, p.id ASC`,
      [session.id]
    )
    return {
      format: 'opencode-sqlite' as const,
      sourceRevision,
      storagePath: dbPath,
      editable: editState.editable,
      editBlockedReason: editState.reason,
      records: buildOpenCodeRecords({
        source: session.source,
        sessionId: session.id,
        rows,
        sourceRevision,
        sessionEditable: editState.editable,
        ...(editState.reason ? { editBlockedReason: editState.reason } : {}),
        maxContentChars
      })
    }
  } finally {
    db?.close()
  }
}

const readContentForSession = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, maxContentChars: number): Promise<ReadSessionContentResult> => {
  if (jsonlSources.has(session.source)) {
    const jsonl = await readJsonlContent(config, session, maxContentChars)
    if (jsonl) return jsonl
  }
  if (session.source === 'opencode') {
    const openCode = await readOpenCodeContent(config, session, maxContentChars)
    if (openCode) return openCode
  }
  const sourceRevision = `${session.updatedAt}:${session.events.length}`
  const records = buildEventRecords({ session, sourceRevision, maxContentChars })
  const unsupportedReason = editableSources.has(session.source)
    ? 'The local transcript store for this session was not found.'
    : 'This AI source is indexed as events only in this version.'
  return {
    format: records.length ? 'events' as const : 'unsupported' as const,
    sourceRevision,
    editable: false,
    editBlockedReason: unsupportedReason,
    unsupportedReason,
    records
  }
}

const getFullRecord = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, recordId: string, maxContentChars: number) => {
  const content = await readContentForSession(config, session, maxContentChars)
  return content.records.find((record) => record.recordId === recordId) || null
}

const updateJsonlRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  input: ManagedAiSessionContentUpdateInput
): Promise<ManagedAiSessionContentUpdateResult> => {
  const locator = parseJsonlRecordId(input.recordId)
  if (!locator) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_INVALID', 'Managed AI content record id is invalid.')
  const path = findJsonlTranscriptPath(session, session.source, config)
  if (!path) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_STORE_MISSING', 'Managed AI transcript file was not found.')
  const currentRevision = await revisionForFiles([path])
  if (input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Reload before saving.')
  }
  const { lines, trailingNewline } = await readJsonlLines(path)
  const line = lines.find((item) => item.lineNumber === locator.lineNumber)
  if (!line?.parsed || typeof valueAtPointer(line.parsed, locator.pointer) !== 'string') {
    return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
  }
  if (!setValueAtPointer(line.parsed, locator.pointer, input.content)) {
    return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_READ_ONLY', 'Managed AI content record is read-only.')
  }
  const backupPath = await backupFiles({
    userDataPath: config.getUserDataPath(),
    source: session.source,
    sessionId: session.id,
    paths: [path],
    now: config.now()
  })
  const nextLines = lines.map((item) => (item.lineNumber === line.lineNumber ? JSON.stringify(line.parsed) : item.raw))
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(tempPath, nextLines.join('\n') + (trailingNewline ? '\n' : ''), 'utf-8')
  await rename(tempPath, path)
  const nextRevision = await revisionForFiles([path])
  const record = await getFullRecord(config, session, input.recordId, maxContentCharsLimit)
  if (!record) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found after saving.')
  return { ok: true, data: { record: { ...record, sourceRevision: nextRevision }, sourceRevision: nextRevision, ...(backupPath ? { backupPath } : {}) } }
}

const updateOpenCodeRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  input: ManagedAiSessionContentUpdateInput
): Promise<ManagedAiSessionContentUpdateResult> => {
  const locator = parseOpenCodeRecordId(input.recordId)
  if (!locator) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_INVALID', 'Managed AI content record id is invalid.')
  const dbPath = openCodeDbPath(config)
  if (!existsSync(dbPath)) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_STORE_MISSING', 'OpenCode database was not found.')
  const revisionPaths = opencodeRevisionPaths(dbPath)
  const currentRevision = await revisionForFiles(revisionPaths)
  if (input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Reload before saving.')
  }
  let db: SqliteDatabase | null = null
  let backupPath: string | undefined
  try {
    db = openSqliteDatabase(dbPath, false)
    const rows = queryRows<{ data?: string }>(db, 'SELECT data FROM part WHERE id = ? AND message_id = ? AND session_id = ?', [
      locator.partId,
      locator.messageId,
      session.id
    ])
    const data = rows[0]?.data ? safeJsonParse(rows[0].data) : null
    if (!data || typeof data.text !== 'string') {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
    }
    const type = cleanText(data.type)
    if (type !== 'text' && type !== 'reasoning') {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_READ_ONLY', 'Only OpenCode text and reasoning parts are editable.')
    }
    backupPath = await backupFiles({
      userDataPath: config.getUserDataPath(),
      source: session.source,
      sessionId: session.id,
      paths: revisionPaths,
      now: config.now()
    })
    data.text = input.content
    db.prepare('UPDATE part SET data = ? WHERE id = ? AND message_id = ? AND session_id = ?').run(JSON.stringify(data), locator.partId, locator.messageId, session.id)
  } finally {
    db?.close()
  }
  const nextRevision = await revisionForFiles(revisionPaths)
  const record = await getFullRecord(config, session, input.recordId, maxContentCharsLimit)
  if (!record) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found after saving.')
  return { ok: true, data: { record: { ...record, sourceRevision: nextRevision }, sourceRevision: nextRevision, ...(backupPath ? { backupPath } : {}) } }
}

const deleteJsonlRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  input: ManagedAiSessionContentDeleteInput
): Promise<ManagedAiSessionContentDeleteResult> => {
  const locator = parseJsonlRecordId(input.recordId)
  if (!locator) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_INVALID', 'Managed AI content record id is invalid.')
  const path = findJsonlTranscriptPath(session, session.source, config)
  if (!path) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_STORE_MISSING', 'Managed AI transcript file was not found.')
  const currentRevision = await revisionForFiles([path])
  if (input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Reload before deleting.')
  }
  const { lines, trailingNewline } = await readJsonlLines(path)
  const line = lines.find((item) => item.lineNumber === locator.lineNumber)
  if (!line?.parsed || typeof valueAtPointer(line.parsed, locator.pointer) !== 'string') {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
  }
  if (!removeValueAtPointer(line.parsed, locator.pointer)) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_READ_ONLY', 'Managed AI content record is read-only.')
  }
  const keepLine = lineHasVisibleTextPointers(line)
  const backupPath = await backupFiles({
    userDataPath: config.getUserDataPath(),
    source: session.source,
    sessionId: session.id,
    paths: [path],
    now: config.now()
  })
  const nextLines = lines
    .filter((item) => item.lineNumber !== line.lineNumber || keepLine)
    .map((item) => (item.lineNumber === line.lineNumber ? JSON.stringify(line.parsed) : item.raw))
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(tempPath, nextLines.join('\n') + (trailingNewline && nextLines.length ? '\n' : ''), 'utf-8')
  await rename(tempPath, path)
  const nextRevision = await revisionForFiles([path])
  return { ok: true, data: { recordId: input.recordId, sourceRevision: nextRevision, ...(backupPath ? { backupPath } : {}) } }
}

const deleteOpenCodeRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  input: ManagedAiSessionContentDeleteInput
): Promise<ManagedAiSessionContentDeleteResult> => {
  const locator = parseOpenCodeRecordId(input.recordId)
  if (!locator) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_INVALID', 'Managed AI content record id is invalid.')
  const dbPath = openCodeDbPath(config)
  if (!existsSync(dbPath)) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_STORE_MISSING', 'OpenCode database was not found.')
  const revisionPaths = opencodeRevisionPaths(dbPath)
  const currentRevision = await revisionForFiles(revisionPaths)
  if (input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Reload before deleting.')
  }
  let db: SqliteDatabase | null = null
  let backupPath: string | undefined
  try {
    db = openSqliteDatabase(dbPath, false)
    const rows = queryRows<{ data?: string }>(db, 'SELECT data FROM part WHERE id = ? AND message_id = ? AND session_id = ?', [
      locator.partId,
      locator.messageId,
      session.id
    ])
    const data = rows[0]?.data ? safeJsonParse(rows[0].data) : null
    if (!data || typeof data.text !== 'string') {
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
    }
    const type = cleanText(data.type)
    if (type !== 'text' && type !== 'reasoning') {
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_READ_ONLY', 'Only OpenCode text and reasoning parts can be deleted.')
    }
    backupPath = await backupFiles({
      userDataPath: config.getUserDataPath(),
      source: session.source,
      sessionId: session.id,
      paths: revisionPaths,
      now: config.now()
    })
    db.prepare('DELETE FROM part WHERE id = ? AND message_id = ? AND session_id = ?').run(locator.partId, locator.messageId, session.id)
  } finally {
    db?.close()
  }
  const nextRevision = await revisionForFiles(revisionPaths)
  return { ok: true, data: { recordId: input.recordId, sourceRevision: nextRevision, ...(backupPath ? { backupPath } : {}) } }
}

export const createAgentSessionContentRuntime = (config: AgentSessionContentRuntimeConfig) => {
  const list = async (input: ManagedAiSessionContentListInput): Promise<ManagedAiSessionContentListResult> => {
    const resolved = await resolveSession(config, input?.source, input?.sessionId)
    if ('error' in resolved) return resolved.error
    const limit = normalizePositiveInt(input?.limit, defaultLimit, maxLimit)
    const offset = normalizeOffset(input?.offset)
    const maxContentChars = normalizePositiveInt(input?.maxContentChars, defaultMaxContentChars, maxContentCharsLimit)
    try {
      const content = await readContentForSession(config, resolved.session, maxContentChars)
      const records = paginateRecords(content.records, offset, limit)
      return {
        ok: true,
        data: snapshotFromRecords({
          session: resolved.session,
          format: content.format,
          sourceRevision: content.sourceRevision,
          total: content.records.length,
          offset,
          limit,
          editable: content.editable,
          ...(content.editBlockedReason ? { editBlockedReason: content.editBlockedReason } : {}),
          ...(content.storagePath ? { storagePath: content.storagePath } : {}),
          ...(content.unsupportedReason ? { unsupportedReason: content.unsupportedReason } : {}),
          records
        })
      }
    } catch (error) {
      return contentError<ManagedAiSessionContentListResult>(
        'MANAGED_AI_CONTENT_LOAD_FAILED',
        error instanceof Error ? error.message : 'Failed to load managed AI session content.'
      )
    }
  }

  const getRecord = async (input: ManagedAiSessionContentRecordInput): Promise<ManagedAiSessionContentRecordResult> => {
    const resolved = await resolveSession(config, input?.source, input?.sessionId)
    if ('error' in resolved) return resolved.error as ManagedAiSessionContentRecordResult
    const recordId = cleanOptionalText(input?.recordId)
    if (!recordId) return contentError<ManagedAiSessionContentRecordResult>('MANAGED_AI_CONTENT_RECORD_ID_REQUIRED', 'Managed AI content record id is required.')
    const maxContentChars = normalizePositiveInt(input?.maxContentChars, maxContentCharsLimit, maxContentCharsLimit)
    try {
      const record = await getFullRecord(config, resolved.session, recordId, maxContentChars)
      if (!record) return contentError<ManagedAiSessionContentRecordResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
      return { ok: true, data: { record } }
    } catch (error) {
      return contentError<ManagedAiSessionContentRecordResult>(
        'MANAGED_AI_CONTENT_LOAD_FAILED',
        error instanceof Error ? error.message : 'Failed to load managed AI session content record.'
      )
    }
  }

  const updateRecord = async (input: ManagedAiSessionContentUpdateInput): Promise<ManagedAiSessionContentUpdateResult> => {
    const resolved = await resolveSession(config, input?.source, input?.sessionId)
    if ('error' in resolved) return resolved.error as ManagedAiSessionContentUpdateResult
    const recordId = cleanOptionalText(input?.recordId)
    if (!recordId) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_ID_REQUIRED', 'Managed AI content record id is required.')
    if (typeof input?.content !== 'string') return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_REQUIRED', 'Managed AI content must be text.')
    if (!cleanOptionalText(input?.sourceRevision)) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_REVISION_REQUIRED', 'Managed AI content source revision is required.')
    const editState = sourceIsEditable(resolved.session, resolved.source)
    if (!editState.editable) {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_READ_ONLY', editState.reason || 'Managed AI session content is read-only.')
    }
    try {
      if (resolved.source === 'opencode') return updateOpenCodeRecord(config, resolved.session, input)
      if (jsonlSources.has(resolved.source)) return updateJsonlRecord(config, resolved.session, input)
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_UNSUPPORTED', 'This AI source does not support content editing yet.')
    } catch (error) {
      return contentError<ManagedAiSessionContentUpdateResult>(
        'MANAGED_AI_CONTENT_SAVE_FAILED',
        error instanceof Error ? error.message : 'Failed to save managed AI session content.'
      )
    }
  }

  const deleteRecord = async (input: ManagedAiSessionContentDeleteInput): Promise<ManagedAiSessionContentDeleteResult> => {
    const resolved = await resolveSession(config, input?.source, input?.sessionId)
    if ('error' in resolved) return resolved.error as ManagedAiSessionContentDeleteResult
    const recordId = cleanOptionalText(input?.recordId)
    if (!recordId) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_ID_REQUIRED', 'Managed AI content record id is required.')
    if (!cleanOptionalText(input?.sourceRevision)) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_REVISION_REQUIRED', 'Managed AI content source revision is required.')
    const editState = sourceIsEditable(resolved.session, resolved.source)
    if (!editState.editable) {
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_READ_ONLY', editState.reason || 'Managed AI session content is read-only.')
    }
    try {
      if (resolved.source === 'opencode') return deleteOpenCodeRecord(config, resolved.session, input)
      if (jsonlSources.has(resolved.source)) return deleteJsonlRecord(config, resolved.session, input)
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_UNSUPPORTED', 'This AI source does not support content deletion yet.')
    } catch (error) {
      return contentError<ManagedAiSessionContentDeleteResult>(
        'MANAGED_AI_CONTENT_DELETE_FAILED',
        error instanceof Error ? error.message : 'Failed to delete managed AI session content.'
      )
    }
  }

  return {
    list,
    getRecord,
    updateRecord,
    deleteRecord,
    __testing: {
      collectTextPointers,
      parseJsonlRecordId,
      parseOpenCodeRecordId,
      compactPreview: (value: unknown) => compactString(value, 80),
      sessionKey
    }
  }
}
