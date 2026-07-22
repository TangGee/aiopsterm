import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { createRequire } from 'module'
import { dirname, isAbsolute, join, resolve } from 'path'
import {
  productSessionSurfaces,
  type ProductSessionChangeEvent,
  type ProductSessionClassicContext,
  type ProductSessionContextRef,
  type ProductSessionCreateInput,
  type ProductSessionDatabaseContext,
  type ProductSessionListInput,
  type ProductSessionNativeBinding,
  type ProductSessionNativeBindingSelector,
  type ProductSessionProjectionMessage,
  type ProductSessionProjectionMessageInput,
  type ProductSessionProjectionPage,
  type ProductSessionProjectionPageInput,
  type ProductSessionProjectionRevision,
  type ProductSessionProjectionRevisionInput,
  type ProductSessionRecord,
  type ProductSessionSurface,
  type ProductSessionTarget,
  type ProductSessionTargetKind,
  type ProductSessionUpdateInput
} from '@shared/contracts/productSessions'

type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint }

type SqliteStatement = {
  all(...args: unknown[]): unknown[]
  get(...args: unknown[]): unknown
  run(...args: unknown[]): SqliteRunResult
}

export type ProductSessionRegistrySqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

export type ProductSessionRegistrySqliteFactory = new (path: string) => ProductSessionRegistrySqliteDatabase

export type ProductSessionRegistryConfig = {
  userDataPath?: string
  databasePath?: string
  sqliteFactory?: ProductSessionRegistrySqliteFactory
  now?: () => number
  createId?: () => string
}

export type ProductSessionRegistry = {
  create(input: ProductSessionCreateInput): ProductSessionRecord
  get(id: string): ProductSessionRecord | null
  list(input?: ProductSessionListInput): ProductSessionRecord[]
  update(input: ProductSessionUpdateInput): ProductSessionRecord | null
  delete(id: string): boolean
  deleteIfUnchanged(id: string, updatedAt: number): boolean
  findByNativeBinding(selector: ProductSessionNativeBindingSelector): ProductSessionRecord | null
  replaceProjectionMessages(id: string, messages: ProductSessionProjectionMessageInput[]): number
  upsertProjectionMessages(id: string, messages: ProductSessionProjectionMessageInput[]): number
  reviseProjectionMessages(id: string, input: ProductSessionProjectionRevisionInput): ProductSessionProjectionRevision
  listProjectionMessages(id: string, input?: ProductSessionProjectionPageInput): ProductSessionProjectionPage
  subscribe(listener: (event: ProductSessionChangeEvent) => void): () => void
  close(): void
}

type ProductSessionRow = {
  id: string
  surface: string
  title: string
  is_open: number
  project_root: string | null
  last_known_cwd: string | null
  target_kind: string | null
  target_panel_id: string | null
  target_terminal_session_id: string | null
  target_asset_id: string | null
  target_connection_id: string | null
  target_label: string | null
  target_host: string | null
  target_port: number | null
  target_username: string | null
  target_asset_name: string | null
  database_connection_id: string | null
  database_name: string | null
  database_schema_name: string | null
  native_engine: string | null
  native_session_id: string | null
  native_profile: string | null
  native_scope_key_b64: string | null
  classic_context_json: string | null
  created_at: number
  updated_at: number
}

type ProductSessionProjectionMessageRow = {
  message_id: string
  ordinal: number
  payload_json: string
  created_at: number
  updated_at: number
}

const requireNative = createRequire(__filename)
const PRODUCT_SESSION_SCHEMA_VERSION = 5
const MAX_LIST_LIMIT = 1000
const MAX_PROJECTION_PAGE_LIMIT = 200
const MAX_PROJECTION_MESSAGE_BYTES = 40 * 1024 * 1024
const MAX_PROJECTION_REVISION_REPLACEMENTS = 10
const MAX_PROJECTION_SEED_MESSAGES = 200
const MAX_PROJECTION_SEED_BYTES = 2 * 1024 * 1024
const MAX_CLASSIC_CONTEXT_REFS = 64
const MAX_CLASSIC_CONTEXT_JSON_BYTES = 128 * 1024
const surfaceSet = new Set<string>(productSessionSurfaces)
const targetKindSet = new Set<ProductSessionTargetKind>(['local', 'ssh', 'unknown'])
const contextKindSet = new Set<ProductSessionContextRef['kind']>(['hosts', 'docs', 'images', 'skills', 'chats'])
const contextTypeSet = new Set<NonNullable<ProductSessionContextRef['contextType']>>(['file', 'dir', 'doc', 'image'])

export class ProductSessionRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ProductSessionRegistryError'
  }
}

const invalid = (code: string, message: string): never => {
  throw new ProductSessionRegistryError(code, message)
}

const normalizedText = (
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
  allowNul = false,
  trim = true
) => {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return undefined
    return invalid('PRODUCT_SESSION_FIELD_INVALID', `${field} must be a string.`)
  }
  const text = trim ? value.trim() : value
  if (!value.trim()) {
    if (!required) return undefined
    return invalid('PRODUCT_SESSION_FIELD_REQUIRED', `${field} is required.`)
  }
  if (!allowNul && text.includes('\0')) {
    return invalid('PRODUCT_SESSION_FIELD_INVALID', `${field} must not contain NUL.`)
  }
  if (Buffer.from(text, 'utf8').toString('utf8') !== text) {
    return invalid('PRODUCT_SESSION_FIELD_INVALID', `${field} must be losslessly encodable as UTF-8.`)
  }
  if (text.length > maxLength) return invalid('PRODUCT_SESSION_FIELD_TOO_LONG', `${field} is too long.`)
  return text
}

const requiredText = (value: unknown, field: string, maxLength: number) => normalizedText(value, field, maxLength, true)!
const optionalText = (value: unknown, field: string, maxLength: number) => normalizedText(value, field, maxLength)
const requiredExactText = (value: unknown, field: string, maxLength: number) =>
  normalizedText(value, field, maxLength, true, false, false)!
const optionalExactText = (value: unknown, field: string, maxLength: number) =>
  normalizedText(value, field, maxLength, false, false, false)

const optionalPort = (value: unknown, field: string) => {
  if (value === undefined || value === null) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return invalid('PRODUCT_SESSION_FIELD_INVALID', `${field} must be an integer between 1 and 65535.`)
  }
  return port
}

const projectionOrdinal = (value: unknown, field: string) => {
  const ordinal = Number(value)
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    return invalid('PRODUCT_SESSION_PROJECTION_CURSOR_INVALID', `${field} must be a non-negative integer.`)
  }
  return ordinal
}

const projectionPayloadJson = (value: unknown, field: string) => {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch {
    return invalid('PRODUCT_SESSION_PROJECTION_MESSAGE_INVALID', `${field} must be JSON serializable.`)
  }
  if (encoded === undefined) {
    return invalid('PRODUCT_SESSION_PROJECTION_MESSAGE_INVALID', `${field} must be JSON serializable.`)
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PROJECTION_MESSAGE_BYTES) {
    return invalid(
      'PRODUCT_SESSION_PROJECTION_MESSAGE_TOO_LARGE',
      `${field} exceeds ${MAX_PROJECTION_MESSAGE_BYTES} bytes.`
    )
  }
  return encoded
}

const projectionMessageInput = (
  value: ProductSessionProjectionMessageInput,
  index: number
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('PRODUCT_SESSION_PROJECTION_MESSAGE_INVALID', `messages[${index}] must be an object.`)
  }
  return {
    messageId: requiredExactText(value.messageId, `messages[${index}].messageId`, 1024),
    payloadJson: projectionPayloadJson(value.payload, `messages[${index}].payload`)
  }
}

const projectionMessageInputs = (messages: ProductSessionProjectionMessageInput[]) => {
  if (!Array.isArray(messages)) {
    return invalid('PRODUCT_SESSION_PROJECTION_MESSAGE_INVALID', 'messages must be an array.')
  }
  const normalized = messages.map(projectionMessageInput)
  const ids = new Set<string>()
  for (const message of normalized) {
    if (ids.has(message.messageId)) {
      return invalid(
        'PRODUCT_SESSION_PROJECTION_MESSAGE_CONFLICT',
        `Projection message id is duplicated: ${message.messageId}`
      )
    }
    ids.add(message.messageId)
  }
  return normalized
}

const projectionRevisionInput = (value: ProductSessionProjectionRevisionInput) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('PRODUCT_SESSION_PROJECTION_REVISION_INVALID', 'revision input must be an object.')
  }
  if (!Array.isArray(value.replacementMessages)) {
    return invalid(
      'PRODUCT_SESSION_PROJECTION_REPLACEMENTS_INVALID',
      'replacementMessages must be an array.'
    )
  }
  if (value.replacementMessages.length < 1 || value.replacementMessages.length > MAX_PROJECTION_REVISION_REPLACEMENTS) {
    return invalid(
      'PRODUCT_SESSION_PROJECTION_REPLACEMENTS_INVALID',
      `replacementMessages must contain between 1 and ${MAX_PROJECTION_REVISION_REPLACEMENTS} messages.`
    )
  }
  return {
    fromMessageId: requiredExactText(value.fromMessageId, 'fromMessageId', 1024),
    replacementMessages: projectionMessageInputs(value.replacementMessages)
  }
}

const projectionMessageFromRow = (row: ProductSessionProjectionMessageRow): ProductSessionProjectionMessage => {
  let payload: unknown
  try {
    payload = JSON.parse(row.payload_json)
  } catch {
    return invalid('PRODUCT_SESSION_DATA_INVALID', 'Stored Product Session projection message is invalid.')
  }
  return {
    messageId: requiredExactText(row.message_id, 'stored projection message id', 1024),
    ordinal: projectionOrdinal(row.ordinal, 'stored projection ordinal'),
    payload,
    createdAt: storedTimestamp(row.created_at, 'projection createdAt'),
    updatedAt: storedTimestamp(row.updated_at, 'projection updatedAt')
  }
}

const normalizedOpenState = (value: unknown, field: string, fallback: boolean) => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') return invalid('PRODUCT_SESSION_FIELD_INVALID', `${field} must be a boolean.`)
  return value
}

const normalizeSurface = (value: unknown): ProductSessionSurface => {
  const surface = requiredText(value, 'surface', 64)
  if (!surfaceSet.has(surface)) return invalid('PRODUCT_SESSION_SURFACE_INVALID', `Unsupported product session surface: ${surface}`)
  return surface as ProductSessionSurface
}

const normalizeTarget = (value: ProductSessionTarget | null | undefined): ProductSessionTarget | undefined => {
  if (value === null || value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('PRODUCT_SESSION_TARGET_INVALID', 'target must be an object.')
  }
  const kind = requiredText(value.kind, 'target.kind', 32) as ProductSessionTargetKind
  if (!targetKindSet.has(kind)) return invalid('PRODUCT_SESSION_TARGET_INVALID', `Unsupported target kind: ${kind}`)
  const panelId = optionalExactText(value.panelId, 'target.panelId', 512)
  const terminalSessionId = optionalExactText(value.terminalSessionId, 'target.terminalSessionId', 512)
  const assetId = optionalExactText(value.assetId, 'target.assetId', 512)
  const connectionId = optionalExactText(value.connectionId, 'target.connectionId', 512)
  const label = optionalText(value.label, 'target.label', 512)
  const host = optionalExactText(value.host, 'target.host', 512)
  const port = optionalPort(value.port, 'target.port')
  const username = optionalExactText(value.username, 'target.username', 512)
  const assetName = optionalText(value.assetName, 'target.assetName', 512)
  return {
    kind,
    ...(panelId ? { panelId } : {}),
    ...(terminalSessionId ? { terminalSessionId } : {}),
    ...(assetId ? { assetId } : {}),
    ...(connectionId ? { connectionId } : {}),
    ...(label ? { label } : {}),
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(username ? { username } : {}),
    ...(assetName ? { assetName } : {})
  }
}

const normalizeDatabase = (
  value: ProductSessionDatabaseContext | null | undefined
): ProductSessionDatabaseContext | undefined => {
  if (value === null || value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('PRODUCT_SESSION_DATABASE_INVALID', 'database must be an object.')
  }
  const connectionId = requiredExactText(value.connectionId, 'database.connectionId', 512)
  const databaseName = optionalExactText(value.databaseName, 'database.databaseName', 512)
  const schemaName = optionalExactText(value.schemaName, 'database.schemaName', 512)
  return {
    connectionId,
    ...(databaseName ? { databaseName } : {}),
    ...(schemaName ? { schemaName } : {})
  }
}

const normalizeNativeBinding = (
  value: ProductSessionNativeBinding | null | undefined
): ProductSessionNativeBinding | undefined => {
  if (value === null || value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('PRODUCT_SESSION_NATIVE_BINDING_INVALID', 'nativeBinding must be an object.')
  }
  const engine = requiredText(value.engine, 'nativeBinding.engine', 128)
  const nativeSessionId = requiredExactText(value.nativeSessionId, 'nativeBinding.nativeSessionId', 1024)
  const profile = optionalText(value.profile, 'nativeBinding.profile', 256)
  const scopeKey = normalizedText(value.scopeKey, 'nativeBinding.scopeKey', 4096, false, true, false)
  return {
    engine,
    nativeSessionId,
    ...(profile ? { profile } : {}),
    ...(scopeKey ? { scopeKey } : {})
  }
}

const normalizeContextRef = (value: ProductSessionContextRef, index: number): ProductSessionContextRef => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('PRODUCT_SESSION_CLASSIC_CONTEXT_INVALID', `classicContext.contexts[${index}] must be an object.`)
  }
  if (['content', 'data', 'unavailable'].some((field) => Object.prototype.hasOwnProperty.call(value, field))) {
    return invalid(
      'PRODUCT_SESSION_CLASSIC_CONTEXT_INVALID',
      `classicContext.contexts[${index}] must not contain content, data, or unavailable state.`
    )
  }
  const prefix = `classicContext.contexts[${index}]`
  const kind = requiredText(value.kind, `${prefix}.kind`, 32) as ProductSessionContextRef['kind']
  if (!contextKindSet.has(kind)) {
    return invalid('PRODUCT_SESSION_CLASSIC_CONTEXT_INVALID', `Unsupported classic context kind: ${kind}`)
  }
  const contextType = value.contextType === undefined
    ? undefined
    : requiredText(value.contextType, `${prefix}.contextType`, 16) as ProductSessionContextRef['contextType']
  if (contextType && !contextTypeSet.has(contextType)) {
    return invalid('PRODUCT_SESSION_CLASSIC_CONTEXT_INVALID', `Unsupported classic context type: ${contextType}`)
  }
  const detail = optionalText(value.detail, `${prefix}.detail`, 2048)
  const assetId = optionalExactText(value.assetId, `${prefix}.assetId`, 512)
  const connectionId = optionalExactText(value.connectionId, `${prefix}.connectionId`, 512)
  const host = optionalExactText(value.host, `${prefix}.host`, 512)
  const port = optionalPort(value.port, `${prefix}.port`)
  const username = optionalExactText(value.username, `${prefix}.username`, 512)
  const relPath = optionalExactText(value.relPath, `${prefix}.relPath`, 4096)
  const mediaType = optionalExactText(value.mediaType, `${prefix}.mediaType`, 256)
  const skillName = optionalExactText(value.skillName, `${prefix}.skillName`, 512)
  const chatSessionId = optionalExactText(value.chatSessionId, `${prefix}.chatSessionId`, 1024)
  return {
    id: requiredExactText(value.id, `${prefix}.id`, 512),
    kind,
    label: requiredText(value.label, `${prefix}.label`, 512),
    ...(detail ? { detail } : {}),
    ...(assetId ? { assetId } : {}),
    ...(connectionId ? { connectionId } : {}),
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(username ? { username } : {}),
    ...(relPath ? { relPath } : {}),
    ...(contextType ? { contextType } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(skillName ? { skillName } : {}),
    ...(chatSessionId ? { chatSessionId } : {})
  }
}

const normalizeClassicContext = (
  value: ProductSessionClassicContext | null | undefined
): ProductSessionClassicContext | undefined => {
  if (value === null || value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.contexts)) {
    return invalid('PRODUCT_SESSION_CLASSIC_CONTEXT_INVALID', 'classicContext must contain a contexts array.')
  }
  if (value.contexts.length > MAX_CLASSIC_CONTEXT_REFS) {
    return invalid(
      'PRODUCT_SESSION_CLASSIC_CONTEXT_TOO_LARGE',
      `classicContext supports at most ${MAX_CLASSIC_CONTEXT_REFS} context references.`
    )
  }
  const contexts = value.contexts.map(normalizeContextRef)
  const normalized: ProductSessionClassicContext = {
    contexts
  }
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_CLASSIC_CONTEXT_JSON_BYTES) {
    return invalid(
      'PRODUCT_SESSION_CLASSIC_CONTEXT_TOO_LARGE',
      `classicContext exceeds ${MAX_CLASSIC_CONTEXT_JSON_BYTES} bytes.`
    )
  }
  return normalized
}

const cloneRecord = (record: ProductSessionRecord): ProductSessionRecord => ({
  ...record,
  ...(record.target ? { target: { ...record.target } } : {}),
  ...(record.database ? { database: { ...record.database } } : {}),
  ...(record.nativeBinding ? { nativeBinding: { ...record.nativeBinding } } : {}),
  ...(record.classicContext
    ? {
        classicContext: {
          contexts: record.classicContext.contexts.map((context) => ({ ...context }))
        }
      }
    : {})
})

const encodeScopeKey = (value: string | undefined) => (value ? Buffer.from(value, 'utf8').toString('base64') : null)

const decodeScopeKey = (value: string | null) => {
  if (!value) return undefined
  const bytes = Buffer.from(value, 'base64')
  const decoded = bytes.toString('utf8')
  if (bytes.toString('base64') !== value || Buffer.from(decoded, 'utf8').toString('base64') !== value) {
    return invalid('PRODUCT_SESSION_DATA_INVALID', 'Stored native scope key is invalid.')
  }
  return decoded
}

const encodeClassicContext = (value: ProductSessionClassicContext | undefined) => {
  if (!value) return null
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CLASSIC_CONTEXT_JSON_BYTES) {
    return invalid('PRODUCT_SESSION_CLASSIC_CONTEXT_TOO_LARGE', `classicContext exceeds ${MAX_CLASSIC_CONTEXT_JSON_BYTES} bytes.`)
  }
  return encoded
}

const decodeClassicContext = (value: string | null): ProductSessionClassicContext | undefined => {
  if (!value) return undefined
  if (Buffer.byteLength(value, 'utf8') > MAX_CLASSIC_CONTEXT_JSON_BYTES) {
    return invalid('PRODUCT_SESSION_DATA_INVALID', 'Stored classic context is too large.')
  }
  try {
    return normalizeClassicContext(JSON.parse(value) as ProductSessionClassicContext)
  } catch {
    return invalid('PRODUCT_SESSION_DATA_INVALID', 'Stored classic context is invalid.')
  }
}

const storedTimestamp = (value: unknown, field: string) => {
  const timestamp = Number(value)
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    return invalid('PRODUCT_SESSION_DATA_INVALID', `Stored ${field} is invalid.`)
  }
  return timestamp
}

const isSqliteConstraintError = (error: unknown) => {
  const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code || '') : ''
  const message = error instanceof Error ? error.message : String(error)
  return code.includes('SQLITE_CONSTRAINT') || /(?:UNIQUE|PRIMARY KEY) constraint failed/i.test(message)
}

const sameNativeSession = (
  left: ProductSessionNativeBinding | undefined,
  right: ProductSessionNativeBinding | undefined
) => left?.engine === right?.engine && left?.nativeSessionId === right?.nativeSessionId

const sameTargetScope = (left: ProductSessionTarget | undefined, right: ProductSessionTarget | undefined) =>
  left?.kind === right?.kind &&
  left?.assetId === right?.assetId &&
  left?.connectionId === right?.connectionId &&
  left?.host === right?.host &&
  left?.port === right?.port &&
  left?.username === right?.username

const sameDatabaseScope = (
  left: ProductSessionDatabaseContext | undefined,
  right: ProductSessionDatabaseContext | undefined
) => left?.connectionId === right?.connectionId &&
  left?.databaseName === right?.databaseName &&
  left?.schemaName === right?.schemaName

const rowToRecord = (row: ProductSessionRow): ProductSessionRecord => {
  const scopeKey = decodeScopeKey(row.native_scope_key_b64)
  const classicContext = decodeClassicContext(row.classic_context_json)
  const target = row.target_kind
    ? {
        kind: row.target_kind as ProductSessionTargetKind,
        ...(row.target_panel_id ? { panelId: row.target_panel_id } : {}),
        ...(row.target_terminal_session_id ? { terminalSessionId: row.target_terminal_session_id } : {}),
        ...(row.target_asset_id ? { assetId: row.target_asset_id } : {}),
        ...(row.target_connection_id ? { connectionId: row.target_connection_id } : {}),
        ...(row.target_label ? { label: row.target_label } : {}),
        ...(row.target_host ? { host: row.target_host } : {}),
        ...(row.target_port ? { port: row.target_port } : {}),
        ...(row.target_username ? { username: row.target_username } : {}),
        ...(row.target_asset_name ? { assetName: row.target_asset_name } : {})
      }
    : undefined
  const database = row.database_connection_id
    ? {
        connectionId: row.database_connection_id,
        ...(row.database_name ? { databaseName: row.database_name } : {}),
        ...(row.database_schema_name ? { schemaName: row.database_schema_name } : {})
      }
    : undefined
  const nativeBinding = row.native_engine && row.native_session_id
    ? {
        engine: row.native_engine,
        nativeSessionId: row.native_session_id,
        ...(row.native_profile ? { profile: row.native_profile } : {}),
        ...(scopeKey ? { scopeKey } : {})
      }
    : undefined
  return {
    id: row.id,
    surface: row.surface as ProductSessionSurface,
    title: row.title,
    isOpen: row.is_open === 1,
    ...(row.project_root ? { projectRoot: row.project_root } : {}),
    ...(row.last_known_cwd ? { lastKnownCwd: row.last_known_cwd } : {}),
    ...(target ? { target } : {}),
    ...(database ? { database } : {}),
    ...(nativeBinding ? { nativeBinding } : {}),
    ...(classicContext ? { classicContext } : {}),
    createdAt: storedTimestamp(row.created_at, 'createdAt'),
    updatedAt: storedTimestamp(row.updated_at, 'updatedAt')
  }
}

const recordParams = (record: ProductSessionRecord) => [
  record.id,
  record.surface,
  record.title,
  record.isOpen ? 1 : 0,
  record.projectRoot ?? null,
  record.lastKnownCwd ?? null,
  record.target?.kind ?? null,
  record.target?.panelId ?? null,
  record.target?.terminalSessionId ?? null,
  record.target?.assetId ?? null,
  record.target?.connectionId ?? null,
  record.target?.label ?? null,
  record.target?.host ?? null,
  record.target?.port ?? null,
  record.target?.username ?? null,
  record.target?.assetName ?? null,
  record.database?.connectionId ?? null,
  record.database?.databaseName ?? null,
  record.database?.schemaName ?? null,
  record.nativeBinding?.engine ?? null,
  record.nativeBinding?.nativeSessionId ?? null,
  record.nativeBinding?.profile ?? null,
  encodeScopeKey(record.nativeBinding?.scopeKey),
  encodeClassicContext(record.classicContext),
  record.createdAt,
  record.updatedAt
]

const defaultSqliteFactory = () => {
  let loaded: ProductSessionRegistrySqliteFactory | { default?: ProductSessionRegistrySqliteFactory }
  try {
    loaded = requireNative('better-sqlite3') as typeof loaded
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return invalid('PRODUCT_SESSION_SQLITE_UNAVAILABLE', `Product session SQLite runtime is unavailable: ${reason}`)
  }
  const factory = typeof loaded === 'function' ? loaded : loaded.default
  if (!factory) return invalid('PRODUCT_SESSION_SQLITE_UNAVAILABLE', 'Product session SQLite runtime is unavailable.')
  return factory
}

const createDefaultSqliteDatabase = (databasePath: string) => {
  const Factory = defaultSqliteFactory()
  try {
    return new Factory(databasePath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return invalid('PRODUCT_SESSION_SQLITE_UNAVAILABLE', `Product session SQLite runtime is unavailable: ${reason}`)
  }
}

export const productSessionRegistryPathFor = (userDataPath: string) =>
  join(requiredExactText(userDataPath, 'userDataPath', 4096), 'product-sessions', 'registry.db')

const databasePathFor = (config: ProductSessionRegistryConfig) => {
  const explicit = optionalExactText(config.databasePath, 'databasePath', 4096)
  const value = explicit || productSessionRegistryPathFor(requiredExactText(config.userDataPath, 'userDataPath', 4096))
  return isAbsolute(value) ? value : resolve(value)
}

const schemaObjectExists = (db: ProductSessionRegistrySqliteDatabase, name: string) =>
  Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))

const storedSchemaVersion = (db: ProductSessionRegistrySqliteDatabase) => {
  const version = db.prepare("SELECT value FROM product_session_registry_meta WHERE key = 'schema_version'").get() as
    | { value?: unknown }
    | undefined
  const parsed = Number(version?.value)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

const assertSupportedSchemaVersion = (db: ProductSessionRegistrySqliteDatabase) => {
  const version = storedSchemaVersion(db)
  if (version !== PRODUCT_SESSION_SCHEMA_VERSION) {
    invalid('PRODUCT_SESSION_SCHEMA_UNSUPPORTED', `Unsupported product session registry schema version: ${version || 'missing'}`)
  }
}

const initializeSchema = (db: ProductSessionRegistrySqliteDatabase) => {
  db.exec('PRAGMA busy_timeout=5000;')
  const hasMeta = schemaObjectExists(db, 'product_session_registry_meta')
  const existingVersion = hasMeta ? storedSchemaVersion(db) : 0
  if (hasMeta) {
    if (existingVersion < 1 || existingVersion > PRODUCT_SESSION_SCHEMA_VERSION) {
      invalid('PRODUCT_SESSION_SCHEMA_UNSUPPORTED', `Unsupported product session registry schema version: ${existingVersion || 'missing'}`)
    }
  } else if (schemaObjectExists(db, 'product_sessions')) {
    invalid('PRODUCT_SESSION_SCHEMA_UNSUPPORTED', 'Product session registry schema version is missing.')
  }

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA secure_delete=ON;
    PRAGMA foreign_keys=ON;
  `)
  try {
    db.exec('BEGIN IMMEDIATE;')
    db.exec(`
    CREATE TABLE IF NOT EXISTS product_session_registry_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_sessions (
      id TEXT PRIMARY KEY,
      surface TEXT NOT NULL CHECK(surface IN ('classic', 'database', 'codex')),
      title TEXT NOT NULL DEFAULT '',
      is_open INTEGER NOT NULL DEFAULT 1 CHECK(is_open IN (0, 1)),
      project_root TEXT,
      last_known_cwd TEXT,
      target_kind TEXT CHECK(target_kind IN ('local', 'ssh', 'unknown')),
      target_panel_id TEXT,
      target_terminal_session_id TEXT,
      target_asset_id TEXT,
      target_connection_id TEXT,
      target_label TEXT,
      target_host TEXT,
      target_port INTEGER CHECK(target_port BETWEEN 1 AND 65535),
      target_username TEXT,
      target_asset_name TEXT,
      database_connection_id TEXT,
      database_name TEXT,
      database_schema_name TEXT,
      native_engine TEXT,
      native_session_id TEXT,
      native_profile TEXT,
      native_scope_key_b64 TEXT,
      classic_context_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK(target_kind IS NOT NULL OR (
        target_panel_id IS NULL AND target_terminal_session_id IS NULL AND target_asset_id IS NULL AND
        target_connection_id IS NULL AND target_label IS NULL AND target_host IS NULL AND target_port IS NULL AND
        target_username IS NULL AND target_asset_name IS NULL
      )),
      CHECK(database_connection_id IS NOT NULL OR (database_name IS NULL AND database_schema_name IS NULL)),
      CHECK((native_engine IS NULL AND native_session_id IS NULL AND native_profile IS NULL AND native_scope_key_b64 IS NULL) OR
        (native_engine IS NOT NULL AND native_session_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS product_session_projection_messages (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(session_id, message_id),
      UNIQUE(session_id, ordinal),
      FOREIGN KEY(session_id) REFERENCES product_sessions(id) ON DELETE CASCADE
    );
    `)
    if (existingVersion === 1) {
      db.exec('ALTER TABLE product_sessions ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0 CHECK(is_open IN (0, 1));')
    }
    if (existingVersion === 1 || existingVersion === 2) {
      db.exec('ALTER TABLE product_sessions ADD COLUMN classic_context_json TEXT;')
    }
    db.exec(`
    DROP INDEX IF EXISTS idx_product_sessions_native_binding;
    CREATE INDEX IF NOT EXISTS idx_product_sessions_native_lookup
      ON product_sessions(native_engine, native_session_id)
      WHERE native_engine IS NOT NULL AND native_session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_sessions_updated_at ON product_sessions(updated_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_product_sessions_surface_updated ON product_sessions(surface, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_product_sessions_project_root ON product_sessions(project_root);
    CREATE INDEX IF NOT EXISTS idx_product_sessions_target_asset ON product_sessions(target_asset_id);
    CREATE INDEX IF NOT EXISTS idx_product_sessions_target_connection ON product_sessions(target_connection_id);
    CREATE INDEX IF NOT EXISTS idx_product_sessions_database_connection ON product_sessions(database_connection_id);
    CREATE INDEX IF NOT EXISTS idx_product_sessions_surface_open_updated ON product_sessions(surface, is_open, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_product_session_projection_page
      ON product_session_projection_messages(session_id, ordinal DESC);
    INSERT OR IGNORE INTO product_session_registry_meta (key, value) VALUES ('schema_version', '${PRODUCT_SESSION_SCHEMA_VERSION}');
    UPDATE product_session_registry_meta SET value = '${PRODUCT_SESSION_SCHEMA_VERSION}' WHERE key = 'schema_version';
    COMMIT;
  `)
  } catch (error) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      // The failing statement may have ended the transaction already.
    }
    throw error
  }
  assertSupportedSchemaVersion(db)
}

const resetOpenSessions = (db: ProductSessionRegistrySqliteDatabase) => {
  db.prepare('UPDATE product_sessions SET is_open = 0 WHERE is_open = 1').run()
}

class SqliteProductSessionRegistry implements ProductSessionRegistry {
  private closed = false
  private readonly listeners = new Set<(event: ProductSessionChangeEvent) => void>()

  constructor(
    private readonly db: ProductSessionRegistrySqliteDatabase,
    private readonly now: () => number,
    private readonly createId: () => string
  ) {
    initializeSchema(db)
    resetOpenSessions(db)
  }

  private assertOpen() {
    if (this.closed) invalid('PRODUCT_SESSION_REGISTRY_CLOSED', 'Product session registry is closed.')
  }

  private timestamp() {
    const value = Math.round(this.now())
    if (!Number.isSafeInteger(value) || value < 0) invalid('PRODUCT_SESSION_TIME_INVALID', 'Product session timestamp is invalid.')
    return value
  }

  private nextTimestamp(previous: number) {
    if (!Number.isSafeInteger(previous) || previous < 0 || previous === Number.MAX_SAFE_INTEGER) {
      return invalid('PRODUCT_SESSION_TIME_INVALID', 'Product session timestamp cannot be advanced safely.')
    }
    return Math.max(this.timestamp(), previous + 1)
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const result = operation()
      this.db.exec('COMMIT;')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // Preserve the operation error when SQLite already ended the transaction.
      }
      throw error
    }
  }

  private notify(event: ProductSessionChangeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event.type === 'deleted' ? { ...event } : { ...event, session: cloneRecord(event.session) })
      } catch {
        // Observers cannot roll back an already committed registry mutation.
      }
    }
  }

  create(input: ProductSessionCreateInput): ProductSessionRecord {
    this.assertOpen()
    const id = input.id === undefined
      ? requiredExactText(this.createId(), 'generated id', 512)
      : requiredExactText(input.id, 'id', 512)
    if (this.get(id)) invalid('PRODUCT_SESSION_ID_CONFLICT', `Product session already exists: ${id}`)
    const createdAt = this.timestamp()
    const projectRoot = optionalExactText(input.projectRoot, 'projectRoot', 4096)
    const lastKnownCwd = optionalExactText(input.lastKnownCwd, 'lastKnownCwd', 4096)
    const target = normalizeTarget(input.target)
    const database = normalizeDatabase(input.database)
    const nativeBinding = normalizeNativeBinding(input.nativeBinding)
    const classicContext = normalizeClassicContext(input.classicContext)
    const record: ProductSessionRecord = {
      id,
      surface: normalizeSurface(input.surface),
      title: optionalText(input.title, 'title', 256) || '',
      isOpen: normalizedOpenState(input.isOpen, 'isOpen', true),
      ...(projectRoot ? { projectRoot } : {}),
      ...(lastKnownCwd ? { lastKnownCwd } : {}),
      ...(target ? { target } : {}),
      ...(database ? { database } : {}),
      ...(nativeBinding ? { nativeBinding } : {}),
      ...(classicContext ? { classicContext } : {}),
      createdAt,
      updatedAt: createdAt
    }
    try {
      this.db
        .prepare(`
        INSERT INTO product_sessions (
          id, surface, title, is_open, project_root, last_known_cwd,
          target_kind, target_panel_id, target_terminal_session_id, target_asset_id, target_connection_id, target_label,
          target_host, target_port, target_username, target_asset_name,
          database_connection_id, database_name, database_schema_name,
          native_engine, native_session_id, native_profile, native_scope_key_b64,
          classic_context_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(...recordParams(record))
    } catch (error) {
      if (!isSqliteConstraintError(error)) throw error
      if (this.get(record.id)) invalid('PRODUCT_SESSION_ID_CONFLICT', `Product session already exists: ${record.id}`)
      invalid('PRODUCT_SESSION_WRITE_CONFLICT', 'Product session could not be created because its identity changed concurrently.')
    }
    const created = cloneRecord(record)
    this.notify({ type: 'created', id: created.id, session: created })
    return created
  }

  get(idInput: string): ProductSessionRecord | null {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    const row = this.db.prepare('SELECT * FROM product_sessions WHERE id = ?').get(id) as ProductSessionRow | undefined
    return row ? rowToRecord(row) : null
  }

  list(input: ProductSessionListInput = {}): ProductSessionRecord[] {
    this.assertOpen()
    const where: string[] = []
    const params: unknown[] = []
    if (input.surface !== undefined) {
      where.push('surface = ?')
      params.push(normalizeSurface(input.surface))
    }
    if (input.isOpen !== undefined) {
      where.push('is_open = ?')
      params.push(normalizedOpenState(input.isOpen, 'isOpen', true) ? 1 : 0)
    }
    const filters: Array<[unknown, string, string, number, boolean]> = [
      [input.projectRoot, 'projectRoot', 'project_root', 4096, true],
      [input.targetAssetId, 'targetAssetId', 'target_asset_id', 512, true],
      [input.targetConnectionId, 'targetConnectionId', 'target_connection_id', 512, true],
      [input.databaseConnectionId, 'databaseConnectionId', 'database_connection_id', 512, true],
      [input.nativeEngine, 'nativeEngine', 'native_engine', 128, false]
    ]
    for (const [value, field, column, maxLength, exact] of filters) {
      if (value === undefined) continue
      where.push(`${column} = ?`)
      params.push(exact ? requiredExactText(value, field, maxLength) : requiredText(value, field, maxLength))
    }
    const rawLimit = input.limit ?? 200
    if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) invalid('PRODUCT_SESSION_LIMIT_INVALID', 'limit must be a positive integer.')
    const rawOffset = input.offset ?? 0
    if (!Number.isSafeInteger(rawOffset) || rawOffset < 0) invalid('PRODUCT_SESSION_OFFSET_INVALID', 'offset must be a non-negative integer.')
    const limit = Math.min(MAX_LIST_LIMIT, rawLimit)
    const sql = `SELECT * FROM product_sessions${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`
    return (this.db.prepare(sql).all(...params, limit, rawOffset) as ProductSessionRow[]).map(rowToRecord)
  }

  update(input: ProductSessionUpdateInput): ProductSessionRecord | null {
    this.assertOpen()
    const existing = this.get(input.id)
    if (!existing) return null
    const projectRoot = input.projectRoot === undefined
      ? existing.projectRoot
      : optionalExactText(input.projectRoot, 'projectRoot', 4096)
    const lastKnownCwd = input.lastKnownCwd === undefined
      ? existing.lastKnownCwd
      : optionalExactText(input.lastKnownCwd, 'lastKnownCwd', 4096)
    const target = input.target === undefined ? existing.target : normalizeTarget(input.target)
    const database = input.database === undefined ? existing.database : normalizeDatabase(input.database)
    const nativeBinding = input.nativeBinding === undefined ? existing.nativeBinding : normalizeNativeBinding(input.nativeBinding)
    const classicContext = input.classicContext === undefined
      ? existing.classicContext
      : normalizeClassicContext(input.classicContext)
    const nativeScopeChanged = existing.projectRoot !== projectRoot ||
      !sameTargetScope(existing.target, target) ||
      !sameDatabaseScope(existing.database, database)
    const nativeBindingScopeChanged = Boolean(
      existing.nativeBinding &&
      nativeBinding &&
      sameNativeSession(existing.nativeBinding, nativeBinding) &&
      existing.nativeBinding.scopeKey !== nativeBinding.scopeKey
    )
    if (
      nativeBindingScopeChanged ||
      (nativeScopeChanged &&
        existing.nativeBinding &&
        (input.nativeBinding === undefined || sameNativeSession(existing.nativeBinding, nativeBinding)))
    ) {
      invalid(
        'PRODUCT_SESSION_CONTEXT_REBIND_REQUIRED',
        'Changing project, target, database, or scope context requires a new or cleared native session binding.'
      )
    }
    const next: ProductSessionRecord = {
      id: existing.id,
      surface: existing.surface,
      title: input.title === undefined ? existing.title : optionalText(input.title, 'title', 256) || '',
      isOpen: normalizedOpenState(input.isOpen, 'isOpen', existing.isOpen),
      ...(projectRoot ? { projectRoot } : {}),
      ...(lastKnownCwd ? { lastKnownCwd } : {}),
      ...(target ? { target } : {}),
      ...(database ? { database } : {}),
      ...(nativeBinding ? { nativeBinding } : {}),
      ...(classicContext ? { classicContext } : {}),
      createdAt: existing.createdAt,
      updatedAt: this.nextTimestamp(existing.updatedAt)
    }
    let result: SqliteRunResult | null = null
    try {
      result = this.db
        .prepare(`
        UPDATE product_sessions SET
          surface = ?, title = ?, is_open = ?, project_root = ?, last_known_cwd = ?,
          target_kind = ?, target_panel_id = ?, target_terminal_session_id = ?, target_asset_id = ?, target_connection_id = ?, target_label = ?,
          target_host = ?, target_port = ?, target_username = ?, target_asset_name = ?,
          database_connection_id = ?, database_name = ?, database_schema_name = ?,
          native_engine = ?, native_session_id = ?, native_profile = ?, native_scope_key_b64 = ?,
          classic_context_json = ?, created_at = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `)
        .run(...recordParams(next).slice(1), next.id, existing.updatedAt)
    } catch (error) {
      if (!isSqliteConstraintError(error)) throw error
      invalid('PRODUCT_SESSION_UPDATE_CONFLICT', 'Product session could not be updated because its binding changed concurrently.')
    }
    const updateResult = result ?? invalid('PRODUCT_SESSION_UPDATE_FAILED', 'Product session update did not return a result.')
    if (updateResult.changes === 0) {
      if (!this.get(existing.id)) return null
      invalid('PRODUCT_SESSION_UPDATE_CONFLICT', 'Product session changed concurrently. Reload it before updating.')
    }
    const updated = cloneRecord(next)
    this.notify({ type: 'updated', id: updated.id, session: updated })
    return updated
  }

  delete(idInput: string): boolean {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    const deleted = this.db.prepare('DELETE FROM product_sessions WHERE id = ?').run(id).changes > 0
    if (deleted) this.notify({ type: 'deleted', id })
    return deleted
  }

  deleteIfUnchanged(idInput: string, updatedAtInput: number): boolean {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    const updatedAt = Number(updatedAtInput)
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      invalid('PRODUCT_SESSION_TIME_INVALID', 'updatedAt must be a non-negative safe integer.')
    }
    const deleted = this.db
      .prepare('DELETE FROM product_sessions WHERE id = ? AND updated_at = ?')
      .run(id, updatedAt).changes > 0
    if (deleted) this.notify({ type: 'deleted', id })
    return deleted
  }

  findByNativeBinding(selector: ProductSessionNativeBindingSelector): ProductSessionRecord | null {
    this.assertOpen()
    const engine = requiredText(selector.engine, 'nativeBinding.engine', 128)
    const nativeSessionId = requiredExactText(selector.nativeSessionId, 'nativeBinding.nativeSessionId', 1024)
    const row = this.db
      .prepare('SELECT * FROM product_sessions WHERE native_engine = ? AND native_session_id = ? ORDER BY updated_at DESC, id ASC LIMIT 1')
      .get(engine, nativeSessionId) as ProductSessionRow | undefined
    return row ? rowToRecord(row) : null
  }

  replaceProjectionMessages(idInput: string, messages: ProductSessionProjectionMessageInput[]) {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    if (!this.get(id)) {
      return invalid('PRODUCT_SESSION_NOT_FOUND', `Product session was not found: ${id}`)
    }
    const normalized = projectionMessageInputs(messages)
    const timestamp = this.timestamp()
    return this.transaction(() => {
      this.db.prepare('DELETE FROM product_session_projection_messages WHERE session_id = ?').run(id)
      const insert = this.db.prepare(`
        INSERT INTO product_session_projection_messages (
          session_id, message_id, ordinal, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      normalized.forEach((message, ordinal) => {
        insert.run(id, message.messageId, ordinal, message.payloadJson, timestamp, timestamp)
      })
      return normalized.length
    })
  }

  upsertProjectionMessages(idInput: string, messages: ProductSessionProjectionMessageInput[]) {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    if (!this.get(id)) {
      return invalid('PRODUCT_SESSION_NOT_FOUND', `Product session was not found: ${id}`)
    }
    const normalized = projectionMessageInputs(messages)
    if (!normalized.length) return 0
    const timestamp = this.timestamp()
    return this.transaction(() => {
      const maximum = this.db
        .prepare('SELECT MAX(ordinal) AS ordinal FROM product_session_projection_messages WHERE session_id = ?')
        .get(id) as { ordinal?: unknown } | undefined
      let nextOrdinal = maximum?.ordinal === null || maximum?.ordinal === undefined
        ? 0
        : projectionOrdinal(maximum.ordinal, 'stored maximum projection ordinal') + 1
      const existingStatement = this.db.prepare(`
        SELECT ordinal FROM product_session_projection_messages WHERE session_id = ? AND message_id = ?
      `)
      const updateStatement = this.db.prepare(`
        UPDATE product_session_projection_messages
        SET payload_json = ?, updated_at = ?
        WHERE session_id = ? AND message_id = ?
      `)
      const insertStatement = this.db.prepare(`
        INSERT INTO product_session_projection_messages (
          session_id, message_id, ordinal, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const message of normalized) {
        const existing = existingStatement.get(id, message.messageId) as { ordinal?: unknown } | undefined
        if (existing) {
          updateStatement.run(message.payloadJson, timestamp, id, message.messageId)
          continue
        }
        insertStatement.run(id, message.messageId, nextOrdinal, message.payloadJson, timestamp, timestamp)
        nextOrdinal += 1
      }
      return normalized.length
    })
  }

  reviseProjectionMessages(
    idInput: string,
    revisionInput: ProductSessionProjectionRevisionInput
  ): ProductSessionProjectionRevision {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    if (!this.get(id)) {
      return invalid('PRODUCT_SESSION_NOT_FOUND', `Product session was not found: ${id}`)
    }
    const revision = projectionRevisionInput(revisionInput)
    const target = this.db.prepare(`
      SELECT ordinal
      FROM product_session_projection_messages
      WHERE session_id = ? AND message_id = ?
    `).get(id, revision.fromMessageId) as { ordinal?: unknown } | undefined
    if (!target) {
      return invalid(
        'PRODUCT_SESSION_PROJECTION_MESSAGE_NOT_FOUND',
        `Projection message was not found: ${revision.fromMessageId}`
      )
    }
    const targetOrdinal = projectionOrdinal(target.ordinal, 'stored revision target ordinal')
    const prefixCountRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM product_session_projection_messages
      WHERE session_id = ? AND ordinal < ?
    `).get(id, targetOrdinal) as { count?: unknown } | undefined
    const seedTotalMessages = Number(prefixCountRow?.count)
    if (!Number.isSafeInteger(seedTotalMessages) || seedTotalMessages < 0) {
      return invalid('PRODUCT_SESSION_DATA_INVALID', 'Stored Product Session projection prefix count is invalid.')
    }
    const seedCandidates = this.db.prepare(`
      SELECT message_id, ordinal, payload_json, created_at, updated_at
      FROM product_session_projection_messages
      WHERE session_id = ? AND ordinal < ?
      ORDER BY ordinal DESC
      LIMIT ?
    `).all(id, targetOrdinal, MAX_PROJECTION_SEED_MESSAGES) as ProductSessionProjectionMessageRow[]
    const seedRowsDescending: ProductSessionProjectionMessageRow[] = []
    let seedPayloadBytes = 0
    for (const row of seedCandidates) {
      const payloadBytes = Buffer.byteLength(row.payload_json, 'utf8')
      if (seedRowsDescending.length > 0 && seedPayloadBytes + payloadBytes > MAX_PROJECTION_SEED_BYTES) break
      seedRowsDescending.push(row)
      seedPayloadBytes += payloadBytes
    }
    const seedMessages = seedRowsDescending.reverse().map(projectionMessageFromRow)
    const seedOmittedMessages = Math.max(0, seedTotalMessages - seedMessages.length)
    const timestamp = this.timestamp()

    return this.transaction(() => {
      const deletedMessages = this.db.prepare(`
        DELETE FROM product_session_projection_messages
        WHERE session_id = ? AND ordinal >= ?
      `).run(id, targetOrdinal).changes
      const insert = this.db.prepare(`
        INSERT INTO product_session_projection_messages (
          session_id, message_id, ordinal, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      revision.replacementMessages.forEach((message, index) => {
        insert.run(id, message.messageId, targetOrdinal + index, message.payloadJson, timestamp, timestamp)
      })
      return {
        deletedMessages,
        appendedMessages: revision.replacementMessages.length,
        totalMessages: seedTotalMessages + revision.replacementMessages.length,
        seedMessages,
        seedTotalMessages,
        seedOmittedMessages,
        seedPayloadBytes
      }
    })
  }

  listProjectionMessages(idInput: string, input: ProductSessionProjectionPageInput = {}): ProductSessionProjectionPage {
    this.assertOpen()
    const id = requiredExactText(idInput, 'id', 512)
    if (!this.get(id)) {
      return invalid('PRODUCT_SESSION_NOT_FOUND', `Product session was not found: ${id}`)
    }
    const rawLimit = input.limit ?? 40
    if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) {
      return invalid('PRODUCT_SESSION_PROJECTION_LIMIT_INVALID', 'limit must be a positive integer.')
    }
    const limit = Math.min(MAX_PROJECTION_PAGE_LIMIT, rawLimit)
    const beforeOrdinal = input.beforeOrdinal === undefined
      ? undefined
      : projectionOrdinal(input.beforeOrdinal, 'beforeOrdinal')
    const rows = (beforeOrdinal === undefined
      ? this.db.prepare(`
          SELECT message_id, ordinal, payload_json, created_at, updated_at
          FROM product_session_projection_messages
          WHERE session_id = ?
          ORDER BY ordinal DESC
          LIMIT ?
        `).all(id, limit + 1)
      : this.db.prepare(`
          SELECT message_id, ordinal, payload_json, created_at, updated_at
          FROM product_session_projection_messages
          WHERE session_id = ? AND ordinal < ?
          ORDER BY ordinal DESC
          LIMIT ?
        `).all(id, beforeOrdinal, limit + 1)) as ProductSessionProjectionMessageRow[]
    const hasMore = rows.length > limit
    const pageRows = (hasMore ? rows.slice(0, limit) : rows).reverse()
    const messages = pageRows.map(projectionMessageFromRow)
    const total = this.db
      .prepare('SELECT COUNT(*) AS count FROM product_session_projection_messages WHERE session_id = ?')
      .get(id) as { count?: unknown } | undefined
    const totalMessages = Number(total?.count)
    if (!Number.isSafeInteger(totalMessages) || totalMessages < 0) {
      return invalid('PRODUCT_SESSION_DATA_INVALID', 'Stored Product Session projection count is invalid.')
    }
    return {
      messages,
      hasMore,
      nextBeforeOrdinal: hasMore && messages.length ? messages[0].ordinal : null,
      totalMessages
    }
  }

  subscribe(listener: (event: ProductSessionChangeEvent) => void) {
    this.assertOpen()
    if (typeof listener !== 'function') invalid('PRODUCT_SESSION_LISTENER_INVALID', 'Product session listener must be a function.')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    if (this.closed) return
    this.listeners.clear()
    this.db.close()
    this.closed = true
  }
}

export const createProductSessionRegistry = (config: ProductSessionRegistryConfig): ProductSessionRegistry => {
  const databasePath = databasePathFor(config)
  mkdirSync(dirname(databasePath), { recursive: true })
  const db = config.sqliteFactory ? new config.sqliteFactory(databasePath) : createDefaultSqliteDatabase(databasePath)
  try {
    return new SqliteProductSessionRegistry(
      db,
      config.now || (() => Date.now()),
      config.createId || (() => `ps-${randomUUID()}`)
    )
  } catch (error) {
    try {
      db.close()
    } catch {
      // Preserve the initialization error; close can be retried only by the driver.
    }
    throw error
  }
}

export const productSessionRegistrySchemaVersion = PRODUCT_SESSION_SCHEMA_VERSION
