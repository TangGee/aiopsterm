import type {
  DatabaseAiDrawerAction,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneStateContext,
  DatabaseAiPaneStateSnapshot,
  DatabaseAiTargetDialect,
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionDeleteResult,
  DatabaseConnectionInfo,
  DatabaseConnectionMutationResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestResult,
  DatabaseCreateDatabaseResult,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseExportResult,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabasePageCommentKey,
  DatabasePageCommentRecord,
  DatabaseSqlExecutionRecord,
  DatabaseSqlExecuteResult,
  DatabaseTableInfo,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'
import type { LocalFileWriteResult } from '@shared/contracts/localFiles'
import {
  DB_AI_ACTIONS,
  DB_AI_TARGET_DIALECTS,
  DB_ENGINE_CODES,
  DB_ENGINE_OPTION_CODES,
  databasePageCommentKeyId
} from '@/services/database/databaseWorkspaceRuntime'

export type DbAiStatus = DatabaseAiPaneMessageRecord['status']
export type DbAiAction = DatabaseAiDrawerAction
export type DbAiTargetDialect = DatabaseAiTargetDialect
export type DbAiBackendContext = DatabaseAiDrawerResponseInput['context']
export type DbAiRequest = DatabaseAiDrawerRequestRecord
export type DbAiPaneContext = DatabaseAiPaneStateContext
export type DbAiPaneMessage = DatabaseAiPaneMessageRecord
export type DbAiPaneMessageStatus = DatabaseAiPaneMessageRecord['status']

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isDatabaseRows(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord)
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function isLocalFileWriteData(value: unknown, expectedPath: string, expectedContent: string): value is NonNullable<LocalFileWriteResult['data']> {
  const expectedBytes = utf8ByteLength(expectedContent)
  return (
    isRecord(value) &&
    value.filePath === expectedPath &&
    typeof value.bytes === 'number' &&
    Number.isInteger(value.bytes) &&
    value.bytes === expectedBytes &&
    typeof value.size === 'number' &&
    Number.isInteger(value.size) &&
    value.size === expectedBytes &&
    typeof value.mtimeMs === 'number' &&
    Number.isFinite(value.mtimeMs) &&
    value.mtimeMs > 0
  )
}

export function isDbAiStatus(value: unknown): value is DbAiStatus {
  return value === 'queued' || value === 'streaming' || value === 'done' || value === 'error' || value === 'cancelled'
}

export function isDbAiAction(value: unknown): value is DbAiAction {
  return typeof value === 'string' && DB_AI_ACTIONS.includes(value as DbAiAction)
}

export function isDbAiTargetDialect(value: unknown): value is DbAiTargetDialect {
  return typeof value === 'string' && DB_AI_TARGET_DIALECTS.includes(value as DbAiTargetDialect)
}

export function isDatabaseEngineCode(value: unknown): value is DatabaseEngineCode {
  return typeof value === 'string' && DB_ENGINE_CODES.includes(value as DatabaseEngineCode)
}

export function isDatabaseEngineOptionCode(value: unknown): value is DatabaseEngineInfo['code'] {
  return typeof value === 'string' && (DB_ENGINE_OPTION_CODES as readonly string[]).includes(value)
}

export function isDatabaseEngineInfo(value: unknown): value is DatabaseEngineInfo {
  return (
    isRecord(value) &&
    isDatabaseEngineOptionCode(value.code) &&
    (value.connectionCode === undefined || isDatabaseEngineCode(value.connectionCode)) &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.accent === 'string'
  )
}

export function isConnectableDatabaseEngineInfo(value: DatabaseEngineInfo): value is DatabaseEngineInfo & { connectionCode: DatabaseEngineCode } {
  return value.enabled && isDatabaseEngineCode(value.connectionCode)
}

export function isDatabaseColumnInfo(value: unknown): value is DatabaseColumnInfo {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.nullable === 'boolean' &&
    (value.key === undefined || value.key === 'PK' || value.key === 'FK')
  )
}

export function isDatabaseTableInfo(value: unknown): value is DatabaseTableInfo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.columns) &&
    value.columns.every(isDatabaseColumnInfo) &&
    isStringArray(value.primaryKey)
  )
}

export function isDatabaseSchemaInfo(value: unknown): value is { name: string; tables: DatabaseTableInfo[]; views?: DatabaseTableInfo[]; functions?: string[]; procedures?: string[] } {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.tables) &&
    value.tables.every(isDatabaseTableInfo) &&
    (value.views === undefined || (Array.isArray(value.views) && value.views.every(isDatabaseTableInfo))) &&
    (value.functions === undefined || isStringArray(value.functions)) &&
    (value.procedures === undefined || isStringArray(value.procedures))
  )
}

export function isDatabaseCatalogInfo(value: unknown): value is DatabaseCatalogInfo {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.schemas === undefined || (Array.isArray(value.schemas) && value.schemas.every(isDatabaseSchemaInfo))) &&
    (value.tables === undefined || (Array.isArray(value.tables) && value.tables.every(isDatabaseTableInfo)))
  )
}

export function isDatabaseConnectionEnv(value: unknown): value is DatabaseConnectionInfo['env'] {
  return value === 'Development' || value === 'TEST' || value === 'Staging' || value === 'Production'
}

export function isDatabaseConnectionStatus(value: unknown): value is DatabaseConnectionInfo['status'] {
  return value === 'idle' || value === 'testing' || value === 'connected' || value === 'failed'
}

export function isDatabaseConnectionInfo(value: unknown): value is DatabaseConnectionInfo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isDatabaseEngineCode(value.dbType) &&
    isDatabaseConnectionEnv(value.env) &&
    typeof value.groupId === 'string' &&
    typeof value.host === 'string' &&
    (value.port === null || (typeof value.port === 'number' && Number.isFinite(value.port))) &&
    value.authentication === 'UserAndPassword' &&
    typeof value.user === 'string' &&
    (value.hasPassword === undefined || typeof value.hasPassword === 'boolean') &&
    typeof value.database === 'string' &&
    (value.filePath === undefined || typeof value.filePath === 'string') &&
    (value.readonly === undefined || typeof value.readonly === 'boolean') &&
    (value.sslMode === undefined ||
      value.sslMode === '' ||
      value.sslMode === 'disable' ||
      value.sslMode === 'require' ||
      value.sslMode === 'verify-ca' ||
      value.sslMode === 'verify-full') &&
    (value.needProxy === undefined || typeof value.needProxy === 'boolean') &&
    (value.proxyName === undefined || typeof value.proxyName === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    isDatabaseConnectionStatus(value.status) &&
    Array.isArray(value.catalogs) &&
    value.catalogs.every(isDatabaseCatalogInfo)
  )
}

export function isDatabaseGroupInfo(value: unknown): value is DatabaseGroupInfo {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

export function isStringNullRecord(value: unknown): value is Record<string, string | null> {
  return isRecord(value) && Object.values(value).every((item) => item === null || typeof item === 'string')
}

export function isDatabaseCatalogDefaults(value: unknown): value is DatabaseWorkspaceCatalog['defaults'] {
  return (
    isRecord(value) &&
    (value.selectedNodeId === null || typeof value.selectedNodeId === 'string') &&
    isStringArray(value.expandedGroupIds) &&
    isStringArray(value.expandedConnectionIds) &&
    isStringArray(value.expandedCatalogIds) &&
    isStringArray(value.expandedSchemaIds) &&
    isStringArray(value.expandedSchemaObjectFolderIds)
  )
}

export function isDatabaseWorkspaceCatalog(value: unknown): value is DatabaseWorkspaceCatalog {
  return (
    isRecord(value) &&
    Array.isArray(value.engines) &&
    value.engines.every(isDatabaseEngineInfo) &&
    Array.isArray(value.groups) &&
    value.groups.every(isDatabaseGroupInfo) &&
    isStringNullRecord(value.groupParents) &&
    Array.isArray(value.connections) &&
    value.connections.every(isDatabaseConnectionInfo) &&
    isDatabaseCatalogDefaults(value.defaults)
  )
}

export function isDatabaseConnectionTestData(value: unknown): value is NonNullable<DatabaseConnectionTestResult['data']> {
  return (
    isRecord(value) &&
    isDatabaseEngineCode(value.dbType) &&
    typeof value.serverVersion === 'string' &&
    typeof value.endpoint === 'string' &&
    isNonNegativeNumber(value.durationMs)
  )
}

export function isDatabaseConnectionSaveData(value: unknown): value is NonNullable<DatabaseConnectionSaveResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseConnectionInfo(record.connection) && typeof record.message === 'string'
}

export const databaseRequestText = (value: unknown) => String(value ?? '').trim()

export function isDatabaseConnectionSaveDataForRequest(value: unknown, input: DatabaseConnectionSaveInput): value is NonNullable<DatabaseConnectionSaveResult['data']> {
  if (!isDatabaseConnectionSaveData(value)) return false
  const saved = value.connection
  if (input.mode === 'edit' && input.id && saved.id !== input.id) return false
  const expected = input.connection
  const expectedProxyName = expected.dbType !== 'sqlite' && expected.needProxy ? databaseRequestText(expected.proxyName) : ''
  return (
    saved.name === databaseRequestText(expected.name) &&
    saved.dbType === expected.dbType &&
    saved.env === (expected.env || 'Development') &&
    saved.groupId === expected.groupId &&
    saved.authentication === (expected.authentication || 'UserAndPassword') &&
    (expected.dbType === 'sqlite' || saved.user === databaseRequestText(expected.user)) &&
    (expected.dbType !== 'sqlite' || (saved.filePath || '') === databaseRequestText(expected.filePath)) &&
    Boolean(saved.readonly) === Boolean(expected.readonly) &&
    (saved.sslMode || '') === (expected.sslMode || '') &&
    Boolean(saved.needProxy) === Boolean(expectedProxyName) &&
    (saved.proxyName || '') === expectedProxyName &&
    value.connections.some((connection) => connection.id === saved.id)
  )
}

export function isDatabaseGroupMutationData(value: unknown): value is NonNullable<DatabaseGroupMutationResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseGroupInfo(record.group) && typeof record.message === 'string'
}

export function isDatabaseGroupMutationDataForRequest(
  value: unknown,
  options: { id?: string; parentId?: string | null; name?: string }
): value is NonNullable<DatabaseGroupMutationResult['data']> {
  if (!isDatabaseGroupMutationData(value)) return false
  if (options.id && value.group.id !== options.id) return false
  if (options.name !== undefined && value.group.name !== options.name) return false
  if (options.parentId !== undefined && (value.groupParents[value.group.id] ?? null) !== options.parentId) return false
  return value.groups.some((group) => group.id === value.group.id)
}

export function isDatabaseGroupDeleteData(value: unknown): value is NonNullable<DatabaseGroupDeleteResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return typeof record.deletedGroupId === 'string' && typeof record.message === 'string'
}

export function isDatabaseGroupDeleteDataForRequest(value: unknown, deletedGroupId: string): value is NonNullable<DatabaseGroupDeleteResult['data']> {
  return isDatabaseGroupDeleteData(value) && value.deletedGroupId === deletedGroupId && !value.groups.some((group) => group.id === deletedGroupId)
}

export function isDatabaseConnectionMutationData(value: unknown): value is NonNullable<DatabaseConnectionMutationResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseConnectionInfo(record.connection) && typeof record.message === 'string'
}

export function isDatabaseConnectionMutationDataForRequest(
  value: unknown,
  options: { connectionId: string; groupId?: string; status?: DatabaseConnectionInfo['status'] }
): value is NonNullable<DatabaseConnectionMutationResult['data']> {
  if (!isDatabaseConnectionMutationData(value)) return false
  if (value.connection.id !== options.connectionId) return false
  if (options.groupId !== undefined && value.connection.groupId !== options.groupId) return false
  if (options.status !== undefined && value.connection.status !== options.status) return false
  return value.connections.some((connection) => connection.id === options.connectionId)
}

export function isDatabaseConnectionDeleteData(value: unknown): value is NonNullable<DatabaseConnectionDeleteResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return typeof record.connectionId === 'string' && typeof record.message === 'string'
}

export function isDatabaseConnectionDeleteDataForRequest(value: unknown, connectionId: string): value is NonNullable<DatabaseConnectionDeleteResult['data']> {
  return isDatabaseConnectionDeleteData(value) && value.connectionId === connectionId && !value.connections.some((connection) => connection.id === connectionId)
}

export function isDatabaseCreateDatabaseData(value: unknown): value is NonNullable<DatabaseCreateDatabaseResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseConnectionInfo(record.connection) && isDatabaseCatalogInfo(record.catalog) && typeof record.message === 'string'
}

export function isDatabaseCreateDatabaseDataForRequest(
  value: unknown,
  connectionId: string,
  requestedName: string
): value is NonNullable<DatabaseCreateDatabaseResult['data']> {
  return (
    isDatabaseCreateDatabaseData(value) &&
    value.connection.id === connectionId &&
    value.catalog.name.toLowerCase() === requestedName.toLowerCase() &&
    value.connections.some((connection) => connection.id === connectionId && connection.catalogs.some((catalog) => catalog.name.toLowerCase() === requestedName.toLowerCase()))
  )
}

export function isDatabaseTableMutationData(value: unknown, options: { requireCatalog?: boolean } = {}): value is NonNullable<DatabaseTableMutationResult['data']> {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.affected) &&
    isNonNegativeNumber(value.durationMs) &&
    (value.catalog === undefined ? !options.requireCatalog : isDatabaseWorkspaceCatalog(value.catalog))
  )
}

export function isDatabaseTableMutationPlanStatement(value: unknown): value is NonNullable<DatabaseTableMutationPlanResult['data']>['statements'][number] {
  return (
    isRecord(value) &&
    (value.kind === 'delete' || value.kind === 'update' || value.kind === 'insert' || value.kind === 'truncate' || value.kind === 'drop') &&
    typeof value.sql === 'string' &&
    Array.isArray(value.params) &&
    typeof value.preview === 'string'
  )
}

export function isDatabaseTableMutationPlanData(value: unknown): value is NonNullable<DatabaseTableMutationPlanResult['data']> {
  return (
    isRecord(value) &&
    Array.isArray(value.statements) &&
    value.statements.every(isDatabaseTableMutationPlanStatement) &&
    isNonNegativeNumber(value.statementCount) &&
    typeof value.preview === 'string' &&
    typeof value.warning === 'string'
  )
}

export function isDbAiBackendContext(value: unknown): value is DbAiBackendContext {
  if (!isRecord(value)) return false
  if (value.connectionId !== undefined && typeof value.connectionId !== 'string') return false
  if (value.dbType !== undefined && value.dbType !== '' && !isDatabaseEngineCode(value.dbType)) return false
  if (value.databaseName !== undefined && typeof value.databaseName !== 'string') return false
  if (value.schemaName !== undefined && typeof value.schemaName !== 'string') return false
  if (value.tableName !== undefined && typeof value.tableName !== 'string') return false
  if (value.contextSummary !== undefined && typeof value.contextSummary !== 'string') return false
  return true
}

export function isDbAiPaneMessageRecord(value: unknown, expected?: { role?: 'user' | 'assistant'; requestId?: string; id?: string }): value is DbAiPaneMessage {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (typeof value.requestId !== 'string' || !value.requestId.trim()) return false
  if (value.role !== 'user' && value.role !== 'assistant') return false
  if (!isDbAiStatus(value.status)) return false
  if (typeof value.content !== 'string' || typeof value.contextSummary !== 'string') return false
  if (!isNonNegativeNumber(value.createdAt) || !isNonNegativeNumber(value.updatedAt)) return false
  if (value.context !== undefined && !isDbAiPaneStateContext(value.context)) return false
  if (value.sqlAction !== undefined) {
    if (!isRecord(value.sqlAction)) return false
    if (!isDbAiAction(value.sqlAction.action)) return false
    if (typeof value.sqlAction.label !== 'string' || typeof value.sqlAction.sourceSql !== 'string' || typeof value.sqlAction.generatedSql !== 'string') return false
    if (!isDbAiTargetDialect(value.sqlAction.targetDialect)) return false
    if (value.sqlAction.transport !== 'pane' && value.sqlAction.transport !== 'drawer') return false
    if (!isDbAiBackendContext(value.sqlAction.context)) return false
  }
  if (expected?.role && value.role !== expected.role) return false
  if (expected?.requestId && value.requestId !== expected.requestId) return false
  if (expected?.id && value.id !== expected.id) return false
  return true
}

export function isDbAiPaneStateContext(value: unknown): value is DbAiPaneContext {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    typeof value.catalogName === 'string' &&
    typeof value.schemaName === 'string' &&
    (value.dbType === '' || isDatabaseEngineCode(value.dbType))
  )
}

function isDbAiPaneSessionSnapshot(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    Boolean(value.conversationId.trim()) &&
    isDbAiPaneStateContext(value.context) &&
    typeof value.draft === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every((message) => isDbAiPaneMessageRecord(message)) &&
    isNonNegativeNumber(value.createdAt) &&
    isNonNegativeNumber(value.updatedAt) &&
    value.updatedAt >= value.createdAt
  )
}

export function isDbAiPaneStateSnapshot(value: unknown): value is DatabaseAiPaneStateSnapshot {
  return (
    isRecord(value) &&
    (value.conversationId === undefined || (typeof value.conversationId === 'string' && Boolean(value.conversationId.trim()))) &&
    typeof value.open === 'boolean' &&
    isNonNegativeNumber(value.width) &&
    isDbAiPaneStateContext(value.context) &&
    typeof value.draft === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every((message) => isDbAiPaneMessageRecord(message)) &&
    (value.archivedSessions === undefined || (
      Array.isArray(value.archivedSessions) && value.archivedSessions.every(isDbAiPaneSessionSnapshot)
    ))
  )
}

export function isDbAiPaneRequestData(value: unknown): value is { requestId: string; userMessage: DbAiPaneMessage; assistantMessage: DbAiPaneMessage } {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !value.requestId.trim()) return false
  return (
    isDbAiPaneMessageRecord(value.userMessage, { role: 'user', requestId: value.requestId }) &&
    isDbAiPaneMessageRecord(value.assistantMessage, { role: 'assistant', requestId: value.requestId })
  )
}

export function isDbAiPaneLifecycleData(value: unknown, expected: { requestId: string; assistantMessageId?: string }): value is { assistantMessage: DbAiPaneMessage } {
  return isRecord(value) && isDbAiPaneMessageRecord(value.assistantMessage, { role: 'assistant', requestId: expected.requestId, id: expected.assistantMessageId })
}

export function isDbAiPaneResponseData(
  value: unknown,
  expected: { requestId: string; assistantMessageId: string }
): value is NonNullable<DatabaseAiPaneResponseResult['data']> {
  return (
    isRecord(value) &&
    value.requestId === expected.requestId &&
    isDbAiPaneMessageRecord(value.assistantMessage, { role: 'assistant', requestId: expected.requestId, id: expected.assistantMessageId }) &&
    typeof value.text === 'string' &&
    typeof value.provider === 'string' &&
    isNonNegativeNumber(value.durationMs)
  )
}

export function isDbAiDrawerRequestRecord(value: unknown, expectedId?: string): value is DbAiRequest {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (value.conversationId !== undefined && (typeof value.conversationId !== 'string' || !value.conversationId.trim())) return false
  if (expectedId && value.id !== expectedId) return false
  return (
    isDbAiAction(value.action) &&
    typeof value.label === 'string' &&
    isDbAiStatus(value.status) &&
    typeof value.contextSummary === 'string' &&
    typeof value.sourceSql === 'string' &&
    typeof value.text === 'string' &&
    isDbAiTargetDialect(value.targetDialect) &&
    isDbAiBackendContext(value.backendContext) &&
    isNonNegativeNumber(value.createdAt) &&
    isNonNegativeNumber(value.updatedAt)
  )
}

export function isDbAiDrawerResponseData(value: unknown, expectedId: string): value is NonNullable<DatabaseAiDrawerResponseResult['data']> {
  return (
    isRecord(value) &&
    isDbAiDrawerRequestRecord(value.request, expectedId) &&
    typeof value.text === 'string' &&
    typeof value.reasoning === 'string' &&
    typeof value.sql === 'string' &&
    typeof value.provider === 'string' &&
    isNonNegativeNumber(value.durationMs)
  )
}

export function isDatabaseSqlExecutionRecord(value: unknown): value is DatabaseSqlExecutionRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    (value.status === 'ok' || value.status === 'error') &&
    typeof value.message === 'string' &&
    value.message.trim() !== '' &&
    isNonNegativeNumber(value.durationMs) &&
    isNonNegativeNumber(value.rowCount) &&
    typeof value.createdAt === 'string' &&
    value.createdAt.trim() !== ''
  )
}

export function isDatabaseSqlExecuteData(value: unknown): value is NonNullable<DatabaseSqlExecuteResult['data']> {
  return (
    isRecord(value) &&
    isStringArray(value.columns) &&
    isDatabaseRows(value.rows) &&
    isNonNegativeNumber(value.rowCount) &&
    isNonNegativeNumber(value.durationMs) &&
    isDatabaseSqlExecutionRecord(value.execution) &&
    value.execution.status === 'ok'
  )
}

export function isDatabaseTableQueryData(value: unknown): value is NonNullable<DatabaseTableQueryResult['data']> {
  return (
    isRecord(value) &&
    isStringArray(value.columns) &&
    isDatabaseRows(value.rows) &&
    isNonNegativeNumber(value.rowCount) &&
    isNonNegativeNumber(value.durationMs) &&
    (value.total === null || isNonNegativeNumber(value.total)) &&
    isStringArray(value.knownColumns)
  )
}

export function isDatabaseExportData(value: unknown): value is NonNullable<DatabaseExportResult['data']> {
  if (!isRecord(value)) return false
  if (!isNonNegativeNumber(value.exported)) return false
  if (typeof value.fileName !== 'string' || !value.fileName.trim().endsWith('.csv')) return false
  if (value.canceled !== undefined && typeof value.canceled !== 'boolean') return false
  if (value.csv !== undefined && typeof value.csv !== 'string') return false
  if (value.canceled) return value.exported === 0 && value.filePath === undefined && value.bytes === undefined
  return (
    typeof value.filePath === 'string' &&
    value.filePath.trim().length > 0 &&
    typeof value.bytes === 'number' &&
    Number.isInteger(value.bytes) &&
    value.bytes >= 0 &&
    (typeof value.csv !== 'string' || value.bytes === utf8ByteLength(value.csv))
  )
}

export function isDatabasePageCommentKey(value: unknown, expected?: DatabasePageCommentKey | null): value is DatabasePageCommentKey {
  if (!isRecord(value)) return false
  if (value.scope !== 'sql-result' && value.scope !== 'table-page') return false
  if (typeof value.connectionId !== 'string' || typeof value.databaseName !== 'string') return false
  if (value.schemaName !== undefined && typeof value.schemaName !== 'string') return false
  if (value.tableName !== undefined && typeof value.tableName !== 'string') return false
  if (value.resultId !== undefined && typeof value.resultId !== 'string') return false
  if (value.sql !== undefined && typeof value.sql !== 'string') return false
  const key: DatabasePageCommentKey = {
    scope: value.scope,
    connectionId: value.connectionId,
    databaseName: value.databaseName,
    ...(value.schemaName ? { schemaName: value.schemaName } : {}),
    ...(value.tableName ? { tableName: value.tableName } : {}),
    ...(value.resultId ? { resultId: value.resultId } : {}),
    ...(value.sql ? { sql: value.sql } : {})
  }
  if (!expected) return true
  return databasePageCommentKeyId(key) === databasePageCommentKeyId(expected)
}

export function isDatabasePageCommentRecord(value: unknown, expected?: DatabasePageCommentKey | null): value is DatabasePageCommentRecord {
  if (!isRecord(value) || !isDatabasePageCommentKey(value, expected)) return false
  const record = value as Record<string, unknown>
  return typeof record.comment === 'string' && isNonNegativeNumber(record.updatedAt)
}

export function isDatabasePageCommentGetData(value: unknown, expected: DatabasePageCommentKey): value is { record: DatabasePageCommentRecord } {
  return isRecord(value) && isDatabasePageCommentRecord(value.record, expected)
}

export function isDatabasePageCommentSaveData(value: unknown, expected: DatabasePageCommentKey): value is { record: DatabasePageCommentRecord; message: string } {
  return isRecord(value) && isDatabasePageCommentRecord(value.record, expected) && typeof value.message === 'string'
}
