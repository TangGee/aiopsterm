import { randomUUID } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { rename, rm, stat } from 'fs/promises'
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
import type { AgentSessionParserDefinition } from '@shared/contracts/agentSessionParsers'
import { builtinAgentSessionParserDefinitions } from '@shared/agentSessionParserConfigRuntime'
import {
  cleanOptionalText,
  cleanText,
  compactString,
  isRecord,
  normalizeSource,
  sessionKey
} from './agentSessionNormalization'
import {
  getJsonlSessionContentRecordInWorker,
  listJsonlSessionContentInWorker,
  rewriteJsonlSessionContentInWorker
} from './agentSessionContentWorkerRuntime'

type AgentSessionContentRuntimeConfig = {
  loadStoreIfNeeded: () => Promise<void>
  getSession: (source: AiAgentSessionSource, sessionId: string) => ManagedAiSessionRecord | null
  getUserDataPath: () => string
  getHomeDir: () => string
  getEnv: () => NodeJS.ProcessEnv
  now: () => number
  getParserDefinition?: (source: AiAgentSessionSource) => AgentSessionParserDefinition | null
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

type ReadSessionContentPageResult = ReadSessionContentResult & {
  total: number
  matchTotal: number
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

type CodexProjectionTransaction = {
  db: SqliteDatabase
  transactionOpen: boolean
}

const defaultLimit = 200
const maxLimit = 500
const defaultMaxContentChars = 16_000
const maxContentCharsLimit = 1_000_000
const maxScanFiles = 2400
const maxDeleteRecordCount = 5000
const jsonlSources = new Set<AiAgentSessionSource>(['codex', 'claude-code'])
const contentMutationQueues = new Map<string, Promise<void>>()
const builtinParsersBySource = new Map(builtinAgentSessionParserDefinitions.map((definition) => [definition.source, definition]))
const codexProjectionTableNames = [
  'thread_items',
  'thread_turns',
  'thread_realtime_items',
  'thread_history_projection_state'
] as const
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

const codexThreadHistoryDatabasePaths = (config: AgentSessionContentRuntimeConfig) => {
  const root = codexHomeFor(config.getEnv(), config.getHomeDir())
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  return entries
    .map((entry) => {
      const match = /^thread_history_(\d+)\.sqlite$/.exec(entry)
      return match ? { path: join(root, entry), version: Number(match[1]) } : null
    })
    .filter((entry): entry is { path: string; version: number } => Boolean(entry))
    .sort((first, second) => second.version - first.version)
    .map((entry) => entry.path)
}

const codexProjectionTablesFor = (db: SqliteDatabase) => {
  const placeholders = codexProjectionTableNames.map(() => '?').join(', ')
  const rows = queryRows<{ name?: string }>(
    db,
    `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${placeholders})`,
    [...codexProjectionTableNames]
  )
  const found = new Set(rows.map((row) => cleanOptionalText(row.name)).filter(Boolean))
  return codexProjectionTableNames.filter((name) => found.has(name))
}

const beginCodexProjectionInvalidation = (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord
): CodexProjectionTransaction[] => {
  if (session.source !== 'codex') return []
  const transactions: CodexProjectionTransaction[] = []
  try {
    for (const path of codexThreadHistoryDatabasePaths(config)) {
      const db = openSqliteDatabase(path, false)
      const transaction: CodexProjectionTransaction = { db, transactionOpen: false }
      try {
        const tables = codexProjectionTablesFor(db)
        if (!tables.length) {
          db.close()
          continue
        }
        db.prepare('BEGIN IMMEDIATE').run()
        transaction.transactionOpen = true
        const containsSession = tables.some((table) =>
          queryRows<{ found?: number }>(db, `SELECT 1 AS found FROM ${table} WHERE thread_id = ? LIMIT 1`, [session.id]).length > 0
        )
        if (!containsSession) {
          db.prepare('ROLLBACK').run()
          transaction.transactionOpen = false
          db.close()
          continue
        }
        tables.forEach((table) => db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(session.id))
        transactions.push(transaction)
      } catch (error) {
        if (transaction.transactionOpen) {
          try {
            db.prepare('ROLLBACK').run()
          } catch {}
        }
        db.close()
        throw error
      }
    }
    return transactions
  } catch (error) {
    transactions.forEach((transaction) => {
      if (transaction.transactionOpen) {
        try {
          transaction.db.prepare('ROLLBACK').run()
        } catch {}
      }
      transaction.db.close()
    })
    throw error
  }
}

const replaceJsonlAndInvalidateCodexProjection = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  tempPath: string,
  path: string
) => {
  const transactions = beginCodexProjectionInvalidation(config, session)
  try {
    await rename(tempPath, path)
    transactions.forEach((transaction) => {
      transaction.db.prepare('COMMIT').run()
      transaction.transactionOpen = false
    })
  } catch (error) {
    transactions.forEach((transaction) => {
      if (!transaction.transactionOpen) return
      try {
        transaction.db.prepare('ROLLBACK').run()
      } catch {}
      transaction.transactionOpen = false
    })
    throw error
  } finally {
    transactions.forEach((transaction) => transaction.db.close())
  }
}

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
      const info = await stat(filePath, { bigint: true })
      parts.push(`${filePath}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`)
    } catch {
      parts.push(`${filePath}:missing`)
    }
  }
  return parts.join('|')
}

const serializeContentMutation = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = contentMutationQueues.get(key) || Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => current)
  contentMutationQueues.set(key, tail)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (contentMutationQueues.get(key) === tail) contentMutationQueues.delete(key)
  }
}

const parserForSource = (config: AgentSessionContentRuntimeConfig, source: AiAgentSessionSource) =>
  config.getParserDefinition?.(source) || builtinParsersBySource.get(source) || null

const sourceUsesJsonl = (config: AgentSessionContentRuntimeConfig, source: AiAgentSessionSource) =>
  jsonlSources.has(source) || parserForSource(config, source)?.storage.kind === 'jsonl'

const sourceEditState = (config: AgentSessionContentRuntimeConfig, source: AiAgentSessionSource) => {
  if (source !== 'opencode' && !sourceUsesJsonl(config, source)) {
    return { editable: false, reason: 'This AI source does not expose writable local conversation content.' }
  }
  return { editable: true }
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

const parseJsonlRecordId = (recordId: string): JsonlRecordLocator | null => {
  const match = /^jsonl:(\d+):(.+)$/.exec(recordId)
  if (!match) return null
  const lineNumber = Number(match[1])
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) return null
  return { lineNumber, pointer: decodeURIComponent(match[2]) }
}

const deleteRecordIdsForInput = (input: ManagedAiSessionContentDeleteInput) => {
  const values = Array.isArray(input.recordIds) && input.recordIds.length ? input.recordIds : [input.recordId]
  return [...new Set(values.map((value) => cleanOptionalText(value)).filter((value): value is string => Boolean(value)))]
}

const queryRows = <T extends Record<string, unknown>>(db: SqliteDatabase, sql: string, params: unknown[] = []) => {
  const statement = db.prepare(sql)
  return (params.length ? statement.all(...params) : statement.all()) as T[]
}

const openCodeDbPath = (config: AgentSessionContentRuntimeConfig) => join(opencodeConfigPath(config.getEnv(), config.getHomeDir()), 'opencode.db')

const opencodeRevisionPaths = (dbPath: string) => [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]

const contentMutationKey = (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord) => {
  if (session.source === 'opencode') return `opencode:${openCodeDbPath(config)}`
  const transcriptPath = findJsonlTranscriptPath(session, session.source, config)
  return transcriptPath ? `jsonl:${transcriptPath}` : `session:${sessionKey(session.source, session.id)}`
}

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
    const text = typeof partData?.text === 'string' && partData.text.trim()
      ? partData.text
      : partData
        ? JSON.stringify(partData, null, 2)
        : ''
    if (!text.trim()) return
    const type = cleanText(partData?.type) || 'part'
    const partEditable = input.sessionEditable
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
      ...(partEditable ? {} : { editBlockedReason: input.editBlockedReason }),
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

const recordMatchesQuery = (record: ManagedAiSessionContentRecord, query: string) => {
  if (!query) return true
  return [record.role, record.messageType, record.locationLabel, record.content].some((value) =>
    String(value || '').toLowerCase().includes(query)
  )
}

const truncateRecordContent = (record: ManagedAiSessionContentRecord, maxContentChars: number): ManagedAiSessionContentRecord => ({
  ...record,
  ...truncateContent(record.content, maxContentChars),
  fullLength: record.fullLength
})

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
  matchTotal: number
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
  matchTotal: input.matchTotal,
  offset: input.offset,
  limit: input.limit,
  editable: input.editable,
  ...(input.editBlockedReason ? { editBlockedReason: input.editBlockedReason } : {}),
  sessionState: input.session.state,
  ...(input.storagePath ? { storagePath: input.storagePath } : {}),
  ...(input.unsupportedReason ? { unsupportedReason: input.unsupportedReason } : {}),
  records: input.records
})

const readJsonlContentPage = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  maxContentChars: number,
  offset: number,
  limit: number,
  query: string
): Promise<ReadSessionContentPageResult | null> => {
  const path = findJsonlTranscriptPath(session, session.source, config)
  if (!path) return null
  const editState = sourceEditState(config, session.source)
  const page = await listJsonlSessionContentInWorker({
    path,
    source: session.source,
    sessionId: session.id,
    sessionEditable: editState.editable,
    ...(editState.reason ? { editBlockedReason: editState.reason } : {}),
    maxContentChars,
    ...(parserForSource(config, session.source) ? { parserDefinition: parserForSource(config, session.source)! } : {}),
    offset,
    limit,
    ...(query ? { query } : {})
  })
  return {
    format: 'jsonl' as const,
    sourceRevision: page.sourceRevision,
    storagePath: path,
    editable: editState.editable,
    editBlockedReason: editState.reason,
    total: page.total,
    matchTotal: page.matchTotal,
    records: page.records
  }
}

const readJsonlContentRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  recordId: string,
  maxContentChars: number
) => {
  const path = findJsonlTranscriptPath(session, session.source, config)
  if (!path) return undefined
  const editState = sourceEditState(config, session.source)
  const result = await getJsonlSessionContentRecordInWorker({
    path,
    source: session.source,
    sessionId: session.id,
    sessionEditable: editState.editable,
    ...(editState.reason ? { editBlockedReason: editState.reason } : {}),
    maxContentChars,
    recordId,
    ...(parserForSource(config, session.source) ? { parserDefinition: parserForSource(config, session.source)! } : {})
  })
  return result.record
}

const readOpenCodeContent = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, maxContentChars: number): Promise<ReadSessionContentResult | null> => {
  const dbPath = openCodeDbPath(config)
  if (!existsSync(dbPath)) return null
  const sourceRevision = await revisionForFiles(opencodeRevisionPaths(dbPath))
  const editState = sourceEditState(config, session.source)
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

const readNonJsonlContentForSession = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, maxContentChars: number): Promise<ReadSessionContentResult> => {
  if (session.source === 'opencode') {
    const openCode = await readOpenCodeContent(config, session, maxContentChars)
    if (openCode) return openCode
  }
  const sourceRevision = `${session.updatedAt}:${session.events.length}`
  const records = buildEventRecords({ session, sourceRevision, maxContentChars })
  const unsupportedReason = sourceEditState(config, session.source).editable
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

const readContentPageForSession = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  maxContentChars: number,
  offset: number,
  limit: number,
  query: string
): Promise<ReadSessionContentPageResult> => {
  if (sourceUsesJsonl(config, session.source)) {
    const jsonl = await readJsonlContentPage(config, session, maxContentChars, offset, limit, query)
    if (jsonl) return jsonl
  }
  const content = await readNonJsonlContentForSession(config, session, maxContentCharsLimit)
  const matchingRecords = content.records.filter((record) => recordMatchesQuery(record, query))
  return {
    ...content,
    total: content.records.length,
    matchTotal: matchingRecords.length,
    records: paginateRecords(matchingRecords, offset, limit).map((record) => truncateRecordContent(record, maxContentChars))
  }
}

const getFullRecord = async (config: AgentSessionContentRuntimeConfig, session: ManagedAiSessionRecord, recordId: string, maxContentChars: number) => {
  if (sourceUsesJsonl(config, session.source)) {
    const jsonlRecord = await readJsonlContentRecord(config, session, recordId, maxContentChars)
    if (jsonlRecord !== undefined) return jsonlRecord
  }
  const content = await readNonJsonlContentForSession(config, session, maxContentChars)
  return content.records.find((record) => record.recordId === recordId) || null
}

const workerMutationError = <T>(error: unknown, operation: 'save' | 'delete'): T | null => {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
  if (code === 'MANAGED_AI_CONTENT_REVISION_CONFLICT') {
    return contentError<T>(code, `Conversation content changed on disk. Reload before ${operation === 'save' ? 'saving' : 'deleting'}.`)
  }
  if (code === 'MANAGED_AI_CONTENT_RECORD_NOT_FOUND') {
    return contentError<T>(code, 'Managed AI content record was not found.')
  }
  if (code === 'MANAGED_AI_CONTENT_RECORD_READ_ONLY') {
    return contentError<T>(code, 'Managed AI content record is read-only.')
  }
  return null
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
  if (!input.force && input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Confirm overwrite to continue.')
  }
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let renamed = false
  try {
    await rewriteJsonlSessionContentInWorker({
      path,
      tempPath,
      sourceRevision: currentRevision,
      lineNumber: locator.lineNumber,
      pointer: locator.pointer,
      operation: 'update',
      content: input.content
    })
    await replaceJsonlAndInvalidateCodexProjection(config, session, tempPath, path)
    renamed = true
    const nextRevision = await revisionForFiles([path])
    const record = await getFullRecord(config, session, input.recordId, maxContentCharsLimit)
    const savedRecord: ManagedAiSessionContentRecord = record
      ? { ...record, sourceRevision: nextRevision }
      : {
          source: session.source,
          sessionId: session.id,
          format: 'jsonl',
          recordId: input.recordId,
          ordinal: Math.max(0, locator.lineNumber - 1),
          locationLabel: `line ${locator.lineNumber} ${locator.pointer}`,
          role: 'unknown',
          messageType: locator.pointer === '/' && safeJsonParse(input.content) ? 'raw-json' : 'message',
          content: input.content,
          contentTruncated: false,
          fullLength: input.content.length,
          editable: true,
          sourceRevision: nextRevision
        }
    return { ok: true, data: { record: savedRecord, sourceRevision: nextRevision } }
  } catch (error) {
    const result = workerMutationError<ManagedAiSessionContentUpdateResult>(error, 'save')
    if (result) return result
    throw error
  } finally {
    if (!renamed) await rm(tempPath, { force: true })
  }
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
  if (!input.force && input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Confirm overwrite to continue.')
  }
  let db: SqliteDatabase | null = null
  let transactionOpen = false
  try {
    db = openSqliteDatabase(dbPath, false)
    db.prepare('BEGIN IMMEDIATE').run()
    transactionOpen = true
    const rows = queryRows<{ data?: string }>(db, 'SELECT data FROM part WHERE id = ? AND message_id = ? AND session_id = ?', [
      locator.partId,
      locator.messageId,
      session.id
    ])
    const data = rows[0]?.data ? safeJsonParse(rows[0].data) : null
    if (!data) {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
    }
    const nextData = typeof data.text === 'string' ? { ...data, text: input.content } : safeJsonParse(input.content)
    if (!nextData) {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_INVALID_JSON', 'Structured conversation content must be valid JSON object text.')
    }
    const updated = db.prepare('UPDATE part SET data = ? WHERE id = ? AND message_id = ? AND session_id = ?').run(
      JSON.stringify(nextData),
      locator.partId,
      locator.messageId,
      session.id
    )
    if (updated.changes !== 1) {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
    }
    db.prepare('COMMIT').run()
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      try {
        db?.prepare('ROLLBACK').run()
      } catch {}
    }
    db?.close()
  }
  const nextRevision = await revisionForFiles(revisionPaths)
  const record = await getFullRecord(config, session, input.recordId, maxContentCharsLimit)
  if (!record) return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found after saving.')
  return { ok: true, data: { record: { ...record, sourceRevision: nextRevision }, sourceRevision: nextRevision } }
}

const deleteJsonlRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  input: ManagedAiSessionContentDeleteInput
): Promise<ManagedAiSessionContentDeleteResult> => {
  const recordIds = deleteRecordIdsForInput(input)
  const locators = recordIds.map(parseJsonlRecordId)
  if (!locators.length || locators.some((locator) => !locator)) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_INVALID', 'Managed AI content record id is invalid.')
  }
  const anchor = locators[0]!
  const path = findJsonlTranscriptPath(session, session.source, config)
  if (!path) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_STORE_MISSING', 'Managed AI transcript file was not found.')
  const currentRevision = await revisionForFiles([path])
  if (!input.force && input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Confirm overwrite to continue.')
  }
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let renamed = false
  try {
    await rewriteJsonlSessionContentInWorker({
      path,
      tempPath,
      sourceRevision: currentRevision,
      lineNumber: anchor.lineNumber,
      pointer: anchor.pointer,
      operation: 'delete',
      recordLocators: locators as JsonlRecordLocator[],
      ...(input.deleteFollowing ? { deleteFollowing: true } : {}),
      ...(parserForSource(config, session.source) ? { parserDefinition: parserForSource(config, session.source)! } : {})
    })
    await replaceJsonlAndInvalidateCodexProjection(config, session, tempPath, path)
    renamed = true
    const nextRevision = await revisionForFiles([path])
    return { ok: true, data: { recordId: input.recordId, recordIds, sourceRevision: nextRevision } }
  } catch (error) {
    const result = workerMutationError<ManagedAiSessionContentDeleteResult>(error, 'delete')
    if (result) return result
    throw error
  } finally {
    if (!renamed) await rm(tempPath, { force: true })
  }
}

const deleteOpenCodeRecord = async (
  config: AgentSessionContentRuntimeConfig,
  session: ManagedAiSessionRecord,
  input: ManagedAiSessionContentDeleteInput
): Promise<ManagedAiSessionContentDeleteResult> => {
  const recordIds = deleteRecordIdsForInput(input)
  const locators = recordIds.map(parseOpenCodeRecordId)
  if (!locators.length || locators.some((locator) => !locator)) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_INVALID', 'Managed AI content record id is invalid.')
  }
  const anchor = locators[0]!
  const dbPath = openCodeDbPath(config)
  if (!existsSync(dbPath)) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_STORE_MISSING', 'OpenCode database was not found.')
  const revisionPaths = opencodeRevisionPaths(dbPath)
  const currentRevision = await revisionForFiles(revisionPaths)
  if (!input.force && input.sourceRevision !== currentRevision) {
    return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_REVISION_CONFLICT', 'Conversation content changed on disk. Confirm overwrite to continue.')
  }
  let db: SqliteDatabase | null = null
  let transactionOpen = false
  try {
    db = openSqliteDatabase(dbPath, false)
    db.prepare('BEGIN IMMEDIATE').run()
    transactionOpen = true
    if (input.deleteFollowing) {
      const rows = queryRows<{ message_created?: number }>(
        db,
        `SELECT m.time_created AS message_created
         FROM message m
         JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ? AND p.session_id = ? AND m.id = ? AND p.id = ?`,
        [session.id, session.id, anchor.messageId, anchor.partId]
      )
      const messageCreated = rows[0]?.message_created
      if (typeof messageCreated !== 'number') {
        return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
      }
      db.prepare(
        `DELETE FROM part
         WHERE session_id = ? AND id IN (
           SELECT p.id FROM part p
           JOIN message m ON m.id = p.message_id
           WHERE m.session_id = ? AND p.session_id = ?
             AND (m.time_created > ? OR (m.time_created = ? AND p.id > ?))
         )`
      ).run(session.id, session.id, session.id, messageCreated, messageCreated, anchor.partId)
    } else {
      for (const locator of locators as OpenCodeRecordLocator[]) {
        const rows = queryRows<{ data?: string }>(db, 'SELECT data FROM part WHERE id = ? AND message_id = ? AND session_id = ?', [
          locator.partId,
          locator.messageId,
          session.id
        ])
        if (!rows[0]?.data) {
          return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
        }
      }
      for (const locator of locators as OpenCodeRecordLocator[]) {
        const deleted = db.prepare('DELETE FROM part WHERE id = ? AND message_id = ? AND session_id = ?').run(
          locator.partId,
          locator.messageId,
          session.id
        )
        if (deleted.changes !== 1) {
          return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_NOT_FOUND', 'Managed AI content record was not found.')
        }
      }
    }
    db.prepare('COMMIT').run()
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      try {
        db?.prepare('ROLLBACK').run()
      } catch {}
    }
    db?.close()
  }
  const nextRevision = await revisionForFiles(revisionPaths)
  return { ok: true, data: { recordId: input.recordId, recordIds, sourceRevision: nextRevision } }
}

export const createAgentSessionContentRuntime = (config: AgentSessionContentRuntimeConfig) => {
  const list = async (input: ManagedAiSessionContentListInput): Promise<ManagedAiSessionContentListResult> => {
    const resolved = await resolveSession(config, input?.source, input?.sessionId)
    if ('error' in resolved) return resolved.error
    const limit = normalizePositiveInt(input?.limit, defaultLimit, maxLimit)
    const offset = normalizeOffset(input?.offset)
    const query = cleanOptionalText(input?.query)?.toLowerCase() || ''
    const maxContentChars = normalizePositiveInt(input?.maxContentChars, defaultMaxContentChars, maxContentCharsLimit)
    try {
      const content = await readContentPageForSession(config, resolved.session, maxContentChars, offset, limit, query)
      return {
        ok: true,
        data: snapshotFromRecords({
          session: resolved.session,
          format: content.format,
          sourceRevision: content.sourceRevision,
          total: content.total,
          matchTotal: content.matchTotal,
          offset,
          limit,
          editable: content.editable,
          ...(content.editBlockedReason ? { editBlockedReason: content.editBlockedReason } : {}),
          ...(content.storagePath ? { storagePath: content.storagePath } : {}),
          ...(content.unsupportedReason ? { unsupportedReason: content.unsupportedReason } : {}),
          records: content.records
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
    const editState = sourceEditState(config, resolved.source)
    if (!editState.editable) {
      return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_READ_ONLY', editState.reason || 'Managed AI session content is read-only.')
    }
    try {
      return await serializeContentMutation(contentMutationKey(config, resolved.session), async () => {
        if (resolved.source === 'opencode') return updateOpenCodeRecord(config, resolved.session, input)
        if (sourceUsesJsonl(config, resolved.source)) return updateJsonlRecord(config, resolved.session, input)
        return contentError<ManagedAiSessionContentUpdateResult>('MANAGED_AI_CONTENT_UNSUPPORTED', 'This AI source does not support content editing yet.')
      })
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
    const recordIds = deleteRecordIdsForInput(input)
    if (!recordIds.length || recordIds.length > maxDeleteRecordCount) {
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_IDS_INVALID', `Managed AI content deletion requires between 1 and ${maxDeleteRecordCount} record ids.`)
    }
    if (!recordIds.includes(recordId) || (input.deleteFollowing && recordIds.length !== 1)) {
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_RECORD_IDS_INVALID', 'Managed AI content deletion record ids do not match the requested operation.')
    }
    if (!cleanOptionalText(input?.sourceRevision)) return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_REVISION_REQUIRED', 'Managed AI content source revision is required.')
    const editState = sourceEditState(config, resolved.source)
    if (!editState.editable) {
      return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_READ_ONLY', editState.reason || 'Managed AI session content is read-only.')
    }
    try {
      return await serializeContentMutation(contentMutationKey(config, resolved.session), async () => {
        if (resolved.source === 'opencode') return deleteOpenCodeRecord(config, resolved.session, input)
        if (sourceUsesJsonl(config, resolved.source)) return deleteJsonlRecord(config, resolved.session, input)
        return contentError<ManagedAiSessionContentDeleteResult>('MANAGED_AI_CONTENT_UNSUPPORTED', 'This AI source does not support content deletion yet.')
      })
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
