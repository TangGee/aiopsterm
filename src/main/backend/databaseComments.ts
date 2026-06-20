import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type {
  DatabasePageCommentGetResult,
  DatabasePageCommentKey,
  DatabasePageCommentRecord,
  DatabasePageCommentSaveInput,
  DatabasePageCommentSaveResult
} from '@shared/contracts/database'

type DatabaseCommentsRuntimeConfig = {
  stateFilePath?: string
  now?: () => number
}

type DatabaseCommentsSnapshot = {
  records: Record<string, DatabasePageCommentRecord>
}

class DatabaseCommentsError extends Error {
  constructor(
    public errorCode: string,
    message: string
  ) {
    super(message)
    this.name = 'DatabaseCommentsError'
  }
}

const DEFAULT_COMMENT_STATE_FILE = 'database-comments.json'
const MAX_COMMENT_LENGTH = 5000

let runtimeConfig: DatabaseCommentsRuntimeConfig = {}
let memorySnapshot: DatabaseCommentsSnapshot = { records: {} }

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const normalizeText = (value: unknown) => String(value || '').trim()

const errorResult = <T>(error: unknown): { ok: false; errorCode: string; errorMessage: string } => ({
  ok: false,
  errorCode: error instanceof DatabaseCommentsError ? error.errorCode : 'DATABASE_COMMENT_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Database page comment failed.')
})

const stateFilePath = () => runtimeConfig.stateFilePath || DEFAULT_COMMENT_STATE_FILE

const sanitizeKey = (input: DatabasePageCommentKey): DatabasePageCommentKey => {
  const scope = input?.scope
  if (scope !== 'sql-result' && scope !== 'table-page') {
    throw new DatabaseCommentsError('DATABASE_COMMENT_INVALID_SCOPE', 'Database page comment scope is invalid.')
  }
  const connectionId = normalizeText(input.connectionId)
  const databaseName = normalizeText(input.databaseName)
  if (!connectionId || !databaseName) {
    throw new DatabaseCommentsError('DATABASE_COMMENT_INVALID_KEY', 'Database page comment requires a connection and database.')
  }
  const schemaName = normalizeText(input.schemaName)
  const tableName = normalizeText(input.tableName)
  const resultId = normalizeText(input.resultId)
  const sql = normalizeText(input.sql)
  if (scope === 'table-page' && !tableName) {
    throw new DatabaseCommentsError('DATABASE_COMMENT_INVALID_KEY', 'Database table page comment requires a table name.')
  }
  if (scope === 'sql-result' && !resultId && !sql) {
    throw new DatabaseCommentsError('DATABASE_COMMENT_INVALID_KEY', 'Database SQL result comment requires a result id or SQL text.')
  }
  return {
    scope,
    connectionId,
    databaseName,
    ...(schemaName ? { schemaName } : {}),
    ...(tableName ? { tableName } : {}),
    ...(resultId ? { resultId } : {}),
    ...(sql ? { sql } : {})
  }
}

const commentKeyId = (key: DatabasePageCommentKey) =>
  [
    key.scope,
    key.connectionId,
    key.databaseName,
    key.schemaName || '',
    key.tableName || '',
    key.resultId || '',
    key.sql || ''
  ].join('\u001f')

const normalizeRecord = (value: unknown): DatabasePageCommentRecord | null => {
  if (!isRecord(value)) return null
  try {
    const key = sanitizeKey(value as DatabasePageCommentKey)
    const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0
    return {
      ...key,
      comment: typeof value.comment === 'string' ? value.comment.slice(0, MAX_COMMENT_LENGTH) : '',
      updatedAt
    }
  } catch {
    return null
  }
}

const normalizeSnapshot = (value: unknown): DatabaseCommentsSnapshot => {
  if (!isRecord(value)) return { records: {} }
  const records: Record<string, DatabasePageCommentRecord> = {}
  const source = isRecord(value.records) ? value.records : {}
  for (const record of Object.values(source)) {
    const normalized = normalizeRecord(record)
    if (normalized) records[commentKeyId(normalized)] = normalized
  }
  return { records }
}

async function readSnapshot(): Promise<DatabaseCommentsSnapshot> {
  const filePath = stateFilePath()
  if (!runtimeConfig.stateFilePath) return memorySnapshot
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    const snapshot = normalizeSnapshot(parsed)
    memorySnapshot = snapshot
    return snapshot
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      memorySnapshot = { records: {} }
      return memorySnapshot
    }
    throw new DatabaseCommentsError('DATABASE_COMMENT_STATE_UNAVAILABLE', 'Database page comments state is unavailable.')
  }
}

async function writeSnapshot(snapshot: DatabaseCommentsSnapshot): Promise<void> {
  memorySnapshot = snapshot
  if (!runtimeConfig.stateFilePath) return
  const filePath = stateFilePath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
}

const emptyRecord = (key: DatabasePageCommentKey): DatabasePageCommentRecord => ({
  ...key,
  comment: '',
  updatedAt: 0
})

export function configureDatabaseCommentsRuntime(config?: DatabaseCommentsRuntimeConfig) {
  runtimeConfig = config || {}
  memorySnapshot = { records: {} }
}

export async function getDatabasePageComment(input: DatabasePageCommentKey): Promise<DatabasePageCommentGetResult> {
  try {
    const key = sanitizeKey(input)
    const snapshot = await readSnapshot()
    const record = snapshot.records[commentKeyId(key)] || emptyRecord(key)
    return { ok: true, data: { record } }
  } catch (error) {
    return errorResult(error)
  }
}

export async function saveDatabasePageComment(input: DatabasePageCommentSaveInput): Promise<DatabasePageCommentSaveResult> {
  try {
    const key = sanitizeKey(input?.key)
    const comment = typeof input?.comment === 'string' ? input.comment : ''
    if (comment.length > MAX_COMMENT_LENGTH) {
      throw new DatabaseCommentsError('DATABASE_COMMENT_TOO_LONG', `Database page comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`)
    }
    const snapshot = await readSnapshot()
    const record: DatabasePageCommentRecord = {
      ...key,
      comment,
      updatedAt: runtimeConfig.now?.() || Date.now()
    }
    snapshot.records[commentKeyId(key)] = record
    await writeSnapshot(snapshot)
    return {
      ok: true,
      data: {
        record,
        message: comment.trim() ? 'Comment saved' : 'Comment cleared'
      }
    }
  } catch (error) {
    return errorResult(error)
  }
}
