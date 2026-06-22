import { dirname } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type {
  DatabaseCatalogInfo,
  DatabaseCatalogResult,
  DatabaseConnectionInfo,
  DatabaseConnectionDeleteResult,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseCreateDatabaseInput,
  DatabaseCreateDatabaseResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  DatabaseWorkspaceCatalog,
  DatabaseSqlExecuteInput,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './contracts/database'
import {
  configureDatabaseAiBackendContext,
  getDatabaseAiPaneStateSnapshot,
  replaceDatabaseAiPaneState,
  resetDatabaseAiBackendState
} from './databaseAi'
import {
  cloneDatabaseCatalog,
  cloneDatabaseCatalogRaw,
  cloneDatabaseConnectionForRuntime,
  createDatabaseCatalogForConnection,
  databaseCatalogDefaultsForRuntime,
  databaseGroupDescendantIds,
  databaseNameFromCreateSql,
  defaultCatalogsForSavedConnection,
  nextDatabaseConnectionId,
  nextDatabaseGroupId,
  normalizeDatabaseConnectionSaveDraft,
  normalizedDatabaseGroupId,
  normalizedDatabaseGroupParentId,
  visibleDatabaseConnectionsForRuntime
} from './databaseCatalogRuntime'
import {
  testDatabaseConnectionRuntime
} from './databaseConnectionTestRuntime'
import {
  configureDatabaseCredentialStorage,
  encryptDatabaseCredentialForStorage
} from './databaseCredentialStorage'
import {
  clickHouseCatalogsForConnection,
  clickHouseColumnsForTable,
  clickHouseErrorCode,
  clickHouseErrorMessage,
  clickHouseExecute,
  clickHouseIdentifier,
  clickHouseMutateTable,
  clickHouseMutationPlanData,
  clickHouseQueryTable,
  clickHouseQueryText,
  clickHouseTableDdl,
  configureDatabaseHttpEngines,
  isClickHouseConnection,
  isPrestoConnection,
  prestoCatalogsForConnection,
  prestoErrorCode,
  prestoErrorMessage,
  prestoExecute,
  prestoMutationUnsupported,
  prestoQueryTable,
  prestoTableDdl
} from './databaseHttpEngines'
import {
  databaseMutationPlanData,
  databaseMutationPlanErrorCode,
  databaseMutationPlanErrorMessage,
  inputKnownColumns,
} from './databaseMutationPlanner'
import {
  normalizePersistedState,
  type DatabasePersistedState
} from './databasePersistenceRuntime'
import {
  configureDatabaseRelationalEngines,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  isRelationalConnection,
  relationalCatalogsForConnection,
  relationalColumnsForTable,
  relationalCreateDatabase,
  relationalErrorCode,
  relationalErrorMessage,
  relationalExecute,
  relationalFallbackCode,
  relationalMutateTable,
  relationalQueryTable,
  relationalTableDdl,
  resetDatabaseRelationalRuntime,
  type DatabaseProxySocketResult,
  type MySqlDriver,
  type OracleDriver,
  type PostgresDriver,
  type RelationalDatabaseType,
  type SqlServerDriver
} from './databaseRelationalEngines'
import {
  DEFAULT_DATABASE_GROUP_ID,
  databaseConnectionSeed,
  databaseConnectionSeedIds,
  databaseEngines,
  databaseGroupParentSeed,
  databaseGroupSeed,
} from './databaseSeedData'
import {
  normalizeSql,
  withDatabaseSqlExecutionRecord
} from './databaseSqlExecution'
import {
  databaseSeedColumnsForTableKey,
  databaseSeedTableExistsInBackend,
  databaseSeedTableKeyForContext,
  databaseSeedTableKeysForContext,
  getDatabaseSeedTableDdl,
  mutateDatabaseSeedTable,
  planDatabaseSeedTableMutation,
  queryDatabaseSeedTable,
  resetDatabaseSeedTableRuntime,
  resolveDatabaseSeedSqlRows
} from './databaseSeedTableRuntime'
import {
  configureDatabaseSqliteRuntime,
  isRealSqliteConnection,
  resetDatabaseSqliteRuntime,
  sqliteCatalogsForConnection,
  sqliteExecute,
  sqliteFilePathFromConnection,
  sqliteMutationPlan,
  sqliteMutateTable,
  sqliteQueryTable,
  sqliteTableDdl
} from './databaseSqliteRuntime'
import {
  columnsForRows,
  trim
} from './databaseTableRuntime'
import { shouldUseDatabaseSeedData as runtimeShouldUseDatabaseSeedData } from './runtimeSwitches'

type DatabaseFetch = typeof fetch
export type DatabaseRuntimeConfig = {
  useSeedData?: boolean
  mysqlDriver?: MySqlDriver
  postgresDriver?: PostgresDriver
  oracleDriver?: OracleDriver | null
  sqlServerDriver?: SqlServerDriver | null
  fetch?: DatabaseFetch
  createProxySocket?: (input: DatabaseConnectionTestInput, targetHost: string, targetPort: number, options?: { timeoutMs?: number }) => Promise<DatabaseProxySocketResult | null>
  oracleClientLibDir?: string
  oracleClientConfigDir?: string
  oracleDriverName?: string
  stateFilePath?: string
  credentialKeyPath?: string
}

let databaseRuntimeConfig: DatabaseRuntimeConfig = {}
const databaseConnectionSecrets = new Map<string, string>()
const databaseVerifiedConnections = new Set<string>()

export function configureDatabaseRuntime(config?: DatabaseRuntimeConfig) {
  databaseRuntimeConfig = config ? { ...config } : {}
  databaseLoadedStateFilePath = ''
  configureDatabaseCredentialStorage({
    stateFilePath: databaseRuntimeConfig.stateFilePath,
    credentialKeyPath: databaseRuntimeConfig.credentialKeyPath
  })
  resetDatabaseRelationalRuntime()
  resetDatabaseSqliteRuntime()
}

const shouldUseDatabaseSeedData = () => databaseRuntimeConfig.useSeedData ?? runtimeShouldUseDatabaseSeedData()

const connectionTestInputFromSaved = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => ({
  dbType: connection.dbType,
  name: connection.name,
  host: connection.host,
  port: connection.port,
  user: connection.user,
  password: databaseConnectionSecrets.get(connection.id) || '',
  database: connection.database,
  filePath: connection.filePath,
  readonly: connection.readonly,
  sslMode: connection.sslMode,
  needProxy: connection.needProxy,
  proxyName: connection.proxyName,
  url: connection.url
})

configureDatabaseAiBackendContext({
  ensureStateLoaded: () => ensureDatabaseStateLoaded(),
  persistState: () => persistDatabaseState(),
  tableKeysForContext: (input) => databaseSeedTableKeysForContext(input),
  tableKeyForContext: (input) => databaseSeedTableKeyForContext(input),
  columnsForTableKey: (key) => databaseSeedColumnsForTableKey(key)
})

configureDatabaseHttpEngines({
  get fetch() {
    return databaseRuntimeConfig.fetch
  },
  connectionInputFromSaved: (connection) => connectionTestInputFromSaved(connection),
  refreshConnectionCatalog: async (connectionId, loadCatalogs) => {
    const index = databaseConnections.findIndex((item) => item.id === connectionId)
    if (index < 0) return
    const catalogs = await loadCatalogs({ ...databaseConnections[index] }).catch(() => databaseConnections[index].catalogs)
    databaseConnections[index] = { ...databaseConnections[index], catalogs }
    persistDatabaseState()
  },
  workspaceCatalogFor: (selectedConnectionId) => databaseWorkspaceCatalogFor(selectedConnectionId)
})

configureDatabaseRelationalEngines({
  get mysqlDriver() {
    return databaseRuntimeConfig.mysqlDriver
  },
  get postgresDriver() {
    return databaseRuntimeConfig.postgresDriver
  },
  get oracleDriver() {
    return databaseRuntimeConfig.oracleDriver
  },
  get sqlServerDriver() {
    return databaseRuntimeConfig.sqlServerDriver
  },
  get createProxySocket() {
    return databaseRuntimeConfig.createProxySocket
  },
  get oracleClientLibDir() {
    return databaseRuntimeConfig.oracleClientLibDir
  },
  get oracleClientConfigDir() {
    return databaseRuntimeConfig.oracleClientConfigDir
  },
  get oracleDriverName() {
    return databaseRuntimeConfig.oracleDriverName
  },
  connectionInputFromSaved: (connection) => connectionTestInputFromSaved(connection),
  refreshConnectionCatalog: async (connectionId, loadCatalogs) => {
    const index = databaseConnections.findIndex((item) => item.id === connectionId)
    if (index < 0) return
    const catalogs = await loadCatalogs({ ...databaseConnections[index] }).catch(() => databaseConnections[index].catalogs)
    databaseConnections[index] = { ...databaseConnections[index], catalogs }
    persistDatabaseState()
  },
  workspaceCatalogFor: (selectedConnectionId) => databaseWorkspaceCatalogFor(selectedConnectionId)
})

configureDatabaseSqliteRuntime({
  refreshConnectionCatalog: (connectionId, catalogs) => {
    const index = databaseConnections.findIndex((item) => item.id === connectionId)
    if (index >= 0) databaseConnections[index] = { ...databaseConnections[index], catalogs }
  },
  workspaceCatalogFor: (selectedConnectionId) => databaseWorkspaceCatalogFor(selectedConnectionId)
})

let databaseGroups: DatabaseGroupInfo[] = databaseGroupSeed.map((group) => ({ ...group }))
let databaseGroupParents: Record<string, string | null> = { ...databaseGroupParentSeed }
let databaseConnections: DatabaseConnectionInfo[] = []
let databaseLoadedStateFilePath = ''

const databaseStateFilePath = () => trim(databaseRuntimeConfig.stateFilePath)

const cloneDatabaseConnection = (connection: DatabaseConnectionInfo): DatabaseConnectionInfo =>
  cloneDatabaseConnectionForRuntime(connection, {
    shouldUseSeedData: shouldUseDatabaseSeedData,
    isVerifiedConnection: (connectionId) => databaseVerifiedConnections.has(connectionId),
    seedTableExists: databaseSeedTableExistsInBackend
  })

databaseConnections = databaseConnectionSeed.map(cloneDatabaseConnection)

const applyPersistedDatabaseState = (state: DatabasePersistedState) => {
  databaseGroups = state.groups.map((group) => ({ ...group }))
  databaseGroupParents = { ...state.groupParents }
  databaseConnections = state.connections.map(cloneDatabaseConnection)
  databaseConnectionSecrets.clear()
  Object.entries(state.secrets).forEach(([connectionId, secret]) => {
    if (secret.password) databaseConnectionSecrets.set(connectionId, secret.password)
  })
  if (state.aiPaneState) replaceDatabaseAiPaneState(state.aiPaneState)
}

const ensureDatabaseStateLoaded = () => {
  const filePath = databaseStateFilePath()
  if (!filePath || databaseLoadedStateFilePath === filePath) return
  databaseLoadedStateFilePath = filePath
  if (!existsSync(filePath)) return
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const state = normalizePersistedState(parsed)
    if (state) {
      applyPersistedDatabaseState(state)
      if (state.needsSecretMigration) persistDatabaseState()
    }
  } catch {
    /* Ignore corrupt local state and keep the backend fallback catalog. */
  }
}

const persistDatabaseState = () => {
  const filePath = databaseStateFilePath()
  if (!filePath) return
  try {
    const state: DatabasePersistedState = {
      version: 1,
      groups: databaseGroups.map((group) => ({ ...group })),
      groupParents: { ...databaseGroupParents },
      connections: visibleDatabaseConnections().map(cloneDatabaseConnection),
      secrets: Object.fromEntries(
        Array.from(databaseConnectionSecrets.entries()).map(([connectionId, password]) => [connectionId, { password: encryptDatabaseCredentialForStorage(password) }])
      ),
      aiPaneState: getDatabaseAiPaneStateSnapshot()
    }
    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tempPath, filePath)
    databaseLoadedStateFilePath = filePath
  } catch {
    /* Persistence must not turn a successful database action into a UI failure. */
  }
}

const visibleDatabaseConnections = () =>
  visibleDatabaseConnectionsForRuntime({
    connections: databaseConnections,
    shouldUseSeedData: shouldUseDatabaseSeedData(),
    seedConnectionIds: databaseConnectionSeedIds,
    isVerifiedConnection: (connectionId) => databaseVerifiedConnections.has(connectionId),
    hasConnectionSecret: (connectionId) => databaseConnectionSecrets.has(connectionId)
  })

const databaseWorkspaceCatalogFor = (selectedConnectionId = 'conn-prod-pg'): DatabaseWorkspaceCatalog => ({
  engines: databaseEngines.map((engine) => ({ ...engine })),
  groups: databaseGroups.map((group) => ({ ...group })),
  groupParents: { ...databaseGroupParents },
  connections: visibleDatabaseConnections().map(cloneDatabaseConnection),
  defaults: databaseCatalogDefaultsForRuntime({
    selectedConnectionId,
    visibleConnections: visibleDatabaseConnections(),
    groups: databaseGroups,
    shouldUseSeedData: shouldUseDatabaseSeedData()
  })
})

export function resetDatabaseBackendSeed() {
  databaseRuntimeConfig = {}
  databaseLoadedStateFilePath = ''
  databaseConnectionSecrets.clear()
  databaseVerifiedConnections.clear()
  resetDatabaseSeedTableRuntime()
  databaseGroups = databaseGroupSeed.map((group) => ({ ...group }))
  databaseGroupParents = { ...databaseGroupParentSeed }
  databaseConnections = databaseConnectionSeed.map(cloneDatabaseConnection)
  resetDatabaseAiBackendState()
}

export async function listDatabaseCatalog(): Promise<DatabaseCatalogResult> {
  ensureDatabaseStateLoaded()
  return {
    ok: true,
    data: databaseWorkspaceCatalogFor()
  }
}

export async function createDatabaseGroup(input: DatabaseGroupCreateInput): Promise<DatabaseGroupMutationResult> {
  ensureDatabaseStateLoaded()
  const name = trim(input.name) || 'New Group'
  const parentId = normalizedDatabaseGroupParentId(input.parentId, databaseGroups)
  const group: DatabaseGroupInfo = {
    id: nextDatabaseGroupId(name, databaseGroups),
    name
  }
  databaseGroups.push(group)
  databaseGroupParents[group.id] = parentId
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(group.id),
      group: { ...group },
      message: 'Group created'
    }
  }
}

export async function renameDatabaseGroup(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
  ensureDatabaseStateLoaded()
  const group = databaseGroups.find((item) => item.id === trim(input.id))
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  const name = trim(input.name)
  if (!name) {
    return { ok: false, errorCode: 'DB_GROUP_NAME_REQUIRED', errorMessage: 'Group name is required.' }
  }

  group.name = name
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(group.id),
      group: { ...group },
      message: 'Group renamed'
    }
  }
}

export async function moveDatabaseGroup(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
  ensureDatabaseStateLoaded()
  const groupId = trim(input.id)
  const group = databaseGroups.find((item) => item.id === groupId)
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  if (groupId === DEFAULT_DATABASE_GROUP_ID) {
    return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be moved.' }
  }

  const parentId = input.parentId === undefined ? (databaseGroupParents[groupId] ?? null) : normalizedDatabaseGroupParentId(input.parentId, databaseGroups)
  if (parentId === groupId || (parentId && databaseGroupDescendantIds(groupId, databaseGroups, databaseGroupParents).has(parentId))) {
    return { ok: false, errorCode: 'DB_GROUP_PARENT_INVALID', errorMessage: 'Group cannot be moved into itself or one of its children.' }
  }

  databaseGroupParents[groupId] = parentId
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(group.id),
      group: { ...group },
      message: parentId ? 'Group moved' : 'Group moved to root'
    }
  }
}

export async function deleteDatabaseGroup(id: string): Promise<DatabaseGroupDeleteResult> {
  ensureDatabaseStateLoaded()
  const groupId = trim(id)
  const group = databaseGroups.find((item) => item.id === groupId)
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  if (groupId === DEFAULT_DATABASE_GROUP_ID) {
    return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be deleted.' }
  }

  databaseGroups = databaseGroups.filter((item) => item.id !== groupId)
  for (const child of databaseGroups) {
    if ((databaseGroupParents[child.id] ?? null) === groupId) databaseGroupParents[child.id] = null
  }
  delete databaseGroupParents[groupId]
  databaseConnections = databaseConnections.map((connection) =>
    connection.groupId === groupId ? { ...connection, groupId: DEFAULT_DATABASE_GROUP_ID } : connection
  )
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(DEFAULT_DATABASE_GROUP_ID),
      deletedGroupId: groupId,
      message: 'Group deleted'
    }
  }
}

const databaseConnectionMutation = (
  connectionId: string,
  message: string,
  mutate: (connection: DatabaseConnectionInfo) => DatabaseConnectionInfo
): DatabaseConnectionMutationResult => {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const index = databaseConnections.findIndex((connection) => connection.id === id)
  if (index === -1) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  const saved = mutate(databaseConnections[index])
  databaseConnections[index] = saved
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      message
    }
  }
}

export async function moveDatabaseConnection(input: DatabaseConnectionMoveInput): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  const groupId = normalizedDatabaseGroupId(input.groupId, databaseGroups)
  return databaseConnectionMutation(input.connectionId, groupId === DEFAULT_DATABASE_GROUP_ID ? 'Connection moved to root group' : 'Connection moved', (connection) => ({
    ...connection,
    groupId
  }))
}

export async function removeDatabaseConnection(connectionId: string): Promise<DatabaseConnectionDeleteResult> {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const index = databaseConnections.findIndex((connection) => connection.id === id)
  if (index === -1) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  databaseConnections = databaseConnections.filter((connection) => connection.id !== id)
  databaseConnectionSecrets.delete(id)
  databaseVerifiedConnections.delete(id)
  persistDatabaseState()
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(),
      connectionId: id,
      message: 'Connection removed'
    }
  }
}

const applyConnectionFailure = (connectionId: string, error: unknown, fallbackCode: string, fallbackMessage: string) => {
  const index = databaseConnections.findIndex((connection) => connection.id === connectionId)
  if (index >= 0) databaseConnections[index] = { ...databaseConnections[index], status: 'failed' }
  return {
    ok: false as const,
    errorCode: relationalErrorCode(error, fallbackCode),
    errorMessage: relationalErrorMessage(error, fallbackMessage)
  }
}

export async function connectDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const connection = databaseConnections.find((item) => item.id === id)
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData() && isClickHouseConnection(connection)) {
    try {
      const catalogs = await clickHouseCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection opened', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        'DB_CLICKHOUSE_CONNECTION_FAILED',
        'Database connection failed.'
      )
      return failed
    }
  }
  if (!shouldUseDatabaseSeedData() && isPrestoConnection(connection)) {
    try {
      const catalogs = await prestoCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection opened', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        'DB_PRESTO_CONNECTION_FAILED',
        'Database connection failed.'
      )
      return failed
    }
  }
  if (!shouldUseDatabaseSeedData() && isRelationalConnection(connection)) {
    try {
      const catalogs = await relationalCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection opened', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'CONNECTION_FAILED'),
        'Database connection failed.'
      )
      return failed
    }
  }
  return databaseConnectionMutation(connectionId, 'Connection opened', (connection) => ({
    ...connection,
    status: 'connected'
  }))
}

export async function disconnectDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  databaseVerifiedConnections.delete(trim(connectionId))
  return databaseConnectionMutation(connectionId, 'Connection closed', (connection) => ({
    ...connection,
    status: 'idle'
  }))
}

export async function refreshDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  ensureDatabaseStateLoaded()
  const id = trim(connectionId)
  const connection = databaseConnections.find((item) => item.id === id)
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData() && isClickHouseConnection(connection)) {
    try {
      const catalogs = await clickHouseCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection schema refreshed', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        'DB_CLICKHOUSE_REFRESH_FAILED',
        'Database schema refresh failed.'
      )
      return failed
    }
  }
  if (!shouldUseDatabaseSeedData() && isPrestoConnection(connection)) {
    try {
      const catalogs = await prestoCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection schema refreshed', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        'DB_PRESTO_REFRESH_FAILED',
        'Database schema refresh failed.'
      )
      return failed
    }
  }
  if (!shouldUseDatabaseSeedData() && isRelationalConnection(connection)) {
    try {
      const catalogs = await relationalCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection schema refreshed', (current) => ({
        ...current,
        status: 'connected',
        catalogs
      }))
    } catch (error) {
      const failed = applyConnectionFailure(
        id,
        error,
        relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'REFRESH_FAILED'),
        'Database schema refresh failed.'
      )
      return failed
    }
  }
  return databaseConnectionMutation(connectionId, 'Connection schema refreshed', (connection) => {
    if (connection.dbType !== 'sqlite') return { ...connection }
    const catalogs = sqliteCatalogsForConnection(connection)
    return catalogs ? { ...connection, catalogs } : { ...connection }
  })
}

export async function testDatabaseConnection(input: DatabaseConnectionTestInput): Promise<DatabaseConnectionTestResult> {
  ensureDatabaseStateLoaded()
  return testDatabaseConnectionRuntime(input, { shouldUseSeedData: shouldUseDatabaseSeedData })
}

export async function saveDatabaseConnection(input: DatabaseConnectionSaveInput): Promise<DatabaseConnectionSaveResult> {
  ensureDatabaseStateLoaded()
  const existingIndex = input.mode === 'edit' ? databaseConnections.findIndex((connection) => connection.id === trim(input.id)) : -1
  if (input.mode === 'edit' && existingIndex === -1) {
    return {
      ok: false,
      errorCode: 'DB_CONNECTION_NOT_FOUND',
      errorMessage: 'Database connection was not found.'
    }
  }
  const existing = existingIndex >= 0 ? databaseConnections[existingIndex] : null
  const connectionSecret = trim(input.connection.password)
  const validationConnection =
    input.mode === 'edit' && !connectionSecret && existing?.hasPassword
      ? { ...input.connection, password: databaseConnectionSecrets.get(existing.id) || '' }
      : input.connection
  const testResult = await testDatabaseConnection(validationConnection)
  if (!testResult.ok) {
    return {
      ok: false,
      errorCode: testResult.errorCode || 'DB_CONNECTION_SAVE_FAILED',
      errorMessage: testResult.errorMessage || 'Database connection validation failed.'
    }
  }

  const normalized = normalizeDatabaseConnectionSaveDraft(input.connection, databaseGroups)

  if (input.mode === 'edit') {
    const existing = databaseConnections[existingIndex]
    const saved: DatabaseConnectionInfo = {
      id: existing.id,
      ...normalized,
      hasPassword: connectionSecret ? true : existing.hasPassword,
      status:
        existing.dbType === normalized.dbType &&
        existing.host === normalized.host &&
        existing.port === normalized.port &&
        existing.database === normalized.database &&
        existing.needProxy === normalized.needProxy &&
        existing.proxyName === normalized.proxyName
          ? existing.status
          : 'idle',
      catalogs:
        existing.dbType === normalized.dbType && existing.database === normalized.database && shouldUseDatabaseSeedData()
          ? existing.catalogs.map((catalog) => cloneDatabaseCatalog(existing.id, catalog, databaseSeedTableExistsInBackend))
          : defaultCatalogsForSavedConnection({
              id: existing.id,
              ...normalized,
              hasPassword: connectionSecret ? true : existing.hasPassword,
              status: existing.status
            })
    }
    databaseConnections[existingIndex] = saved
    if (connectionSecret) databaseConnectionSecrets.set(saved.id, connectionSecret)
    if (!connectionSecret && !saved.hasPassword) databaseConnectionSecrets.delete(saved.id)
    databaseVerifiedConnections.delete(saved.id)
    persistDatabaseState()
    return {
      ok: true,
      data: {
        ...databaseWorkspaceCatalogFor(saved.id),
        connection: cloneDatabaseConnection(saved),
        message: 'Connection saved'
      }
    }
  }

  const saved: DatabaseConnectionInfo = {
    id: nextDatabaseConnectionId(normalized.name, databaseConnections),
    ...normalized,
    hasPassword: !!connectionSecret,
    status: 'idle',
    catalogs: []
  }
  saved.catalogs = defaultCatalogsForSavedConnection(saved)
  databaseConnections.push(saved)
  if (connectionSecret) databaseConnectionSecrets.set(saved.id, connectionSecret)
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      message: 'Connection saved'
    }
  }
}

export async function createDatabaseCatalog(input: DatabaseCreateDatabaseInput): Promise<DatabaseCreateDatabaseResult> {
  ensureDatabaseStateLoaded()
  const connectionIndex = databaseConnections.findIndex((connection) => connection.id === trim(input.connectionId))
  const connection = connectionIndex >= 0 ? databaseConnections[connectionIndex] : null
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (connection.dbType === 'presto') {
    return {
      ok: false,
      errorCode: 'DB_CREATE_DATABASE_UNSUPPORTED',
      errorMessage: 'Create Database is not supported for Presto connections.'
    }
  }
  if (!isMysqlCompatibleDbType(connection.dbType) && !isPostgresCompatibleDbType(connection.dbType) && connection.dbType !== 'sqlserver' && connection.dbType !== 'clickhouse') {
    return {
      ok: false,
      errorCode: 'DB_CREATE_DATABASE_UNSUPPORTED',
      errorMessage: 'Create Database is only available for MySQL-compatible, PostgreSQL-compatible, SQL Server, and ClickHouse connections.'
    }
  }

  const name = databaseNameFromCreateSql(input.sql) || trim(input.requestedName)
  if (!name) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_SQL_INVALID', errorMessage: 'CREATE DATABASE statement is required.' }
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_NAME_INVALID', errorMessage: 'Database name must start with a letter or underscore and contain only letters, numbers, and underscores.' }
  }
  if (connection.catalogs.some((catalog) => catalog.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_DUPLICATE', errorMessage: 'Database already exists.' }
  }

  if (!shouldUseDatabaseSeedData()) {
    try {
      if (isRelationalConnection(connection)) {
        await relationalCreateDatabase(connection, input.sql, name)
      } else {
        await clickHouseQueryText(connectionTestInputFromSaved(connection), input.sql || `CREATE DATABASE ${clickHouseIdentifier(name)}`)
      }
    } catch (error) {
      return {
        ok: false,
        errorCode:
          connection.dbType === 'clickhouse'
            ? clickHouseErrorCode(error, 'DB_CLICKHOUSE_CREATE_DATABASE_FAILED')
            : relationalErrorCode(
                error,
                isMysqlCompatibleDbType(connection.dbType)
                  ? 'DB_MYSQL_CREATE_DATABASE_FAILED'
                  : connection.dbType === 'sqlserver'
                    ? 'DB_SQLSERVER_CREATE_DATABASE_FAILED'
                    : relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'CREATE_DATABASE_FAILED')
              ),
        errorMessage: connection.dbType === 'clickhouse' ? clickHouseErrorMessage(error, 'Create database failed.') : relationalErrorMessage(error, 'Create database failed.')
      }
    }
  }

  const catalog = createDatabaseCatalogForConnection(connection, name)
  const saved: DatabaseConnectionInfo = {
    ...connection,
    catalogs: [...connection.catalogs.map((item) => (shouldUseDatabaseSeedData() ? cloneDatabaseCatalog(connection.id, item, databaseSeedTableExistsInBackend) : cloneDatabaseCatalogRaw(item))), catalog]
  }
  databaseConnections[connectionIndex] = saved
  persistDatabaseState()

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      catalog: cloneDatabaseCatalog(saved.id, catalog, databaseSeedTableExistsInBackend),
      message: 'Database created in workspace catalog'
    }
  }
}

export async function executeDatabaseSql(input: DatabaseSqlExecuteInput): Promise<DatabaseSqlExecuteResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  const rawSql = trim(input.sql)
  const sql = normalizeSql(input.sql || '')
  if (!trim(input.connectionId)) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }, startedAt)
  }
  if (!rawSql) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_SQL_EMPTY', errorMessage: 'SQL is required.' }, startedAt)
  }
  if (/drop\s+database|syntax_error/i.test(sql)) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_SQL_REJECTED', errorMessage: 'Backend SQL executor rejected this statement.' }, startedAt)
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return withDatabaseSqlExecutionRecord(sqliteExecute(connection, rawSql, startedAt), startedAt)
  }
  if (!connection) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }, startedAt)
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isClickHouseConnection(connection)) return withDatabaseSqlExecutionRecord(await clickHouseExecute(connection, rawSql, startedAt), startedAt)
    if (isPrestoConnection(connection)) return withDatabaseSqlExecutionRecord(await prestoExecute(connection, rawSql, startedAt), startedAt)
    if (isRelationalConnection(connection)) return withDatabaseSqlExecutionRecord(await relationalExecute(connection, rawSql, startedAt), startedAt)
    return withDatabaseSqlExecutionRecord(
      { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine execution is not wired in this aiopsterm backend yet.' },
      startedAt
    )
  }

  const resolved = resolveDatabaseSeedSqlRows(input, sql)
  if (!resolved.ok) {
    return withDatabaseSqlExecutionRecord(
      {
        ok: false,
        errorCode: resolved.errorCode,
        errorMessage: resolved.errorMessage
      },
      startedAt
    )
  }
  const rows = resolved.rows

  return withDatabaseSqlExecutionRecord(
    {
      ok: true,
      data: {
        columns: columnsForRows(rows),
        rows,
        rowCount: rows.length,
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    },
    startedAt
  )
}

export async function getDatabaseTableDdl(input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> {
  ensureDatabaseStateLoaded()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteTableDdl(connection, input)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isClickHouseConnection(connection)) return clickHouseTableDdl(connection, input)
    if (isPrestoConnection(connection)) return prestoTableDdl(connection, input)
    if (isRelationalConnection(connection)) return relationalTableDdl(connection, input)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine DDL lookup is not wired in this aiopsterm backend yet.' }
  }

  return getDatabaseSeedTableDdl(input)
}

export async function queryDatabaseTable(input: DatabaseTableQueryInput): Promise<DatabaseTableQueryResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteQueryTable(connection, input, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isClickHouseConnection(connection)) return clickHouseQueryTable(connection, input, startedAt)
    if (isPrestoConnection(connection)) return prestoQueryTable(connection, input, startedAt)
    if (isRelationalConnection(connection)) return relationalQueryTable(connection, input, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table query is not wired in this aiopsterm backend yet.' }
  }

  return queryDatabaseSeedTable(input, startedAt)
}

export async function planDatabaseTableMutation(input: DatabaseTableMutationPlanInput): Promise<DatabaseTableMutationPlanResult> {
  ensureDatabaseStateLoaded()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }
  if (!Array.isArray(input.mutations)) {
    return { ok: false, errorCode: 'DB_MUTATIONS_REQUIRED', errorMessage: 'Table mutations are required.' }
  }

  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    try {
      return { ok: true, data: sqliteMutationPlan(connection, input) }
    } catch (error) {
      return {
        ok: false,
        errorCode: databaseMutationPlanErrorCode(error, 'DB_SQLITE_MUTATION_PLAN_FAILED'),
        errorMessage: databaseMutationPlanErrorMessage(error, 'SQLite table mutation planning failed.')
      }
    }
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }

  if (!shouldUseDatabaseSeedData()) {
    if (isClickHouseConnection(connection)) {
      try {
        const columns = await clickHouseColumnsForTable(connection, input)
        if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const knownColumns = columns.map((column) => column.name)
        return { ok: true, data: clickHouseMutationPlanData(input, knownColumns.length ? knownColumns : inputKnownColumns(input)) }
      } catch (error) {
        return {
          ok: false,
          errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_MUTATION_PLAN_FAILED'),
          errorMessage: clickHouseErrorMessage(error, 'ClickHouse table mutation planning failed.')
        }
      }
    }
    if (isPrestoConnection(connection)) return prestoMutationUnsupported()
    if (isRelationalConnection(connection)) {
      try {
        const columns = await relationalColumnsForTable(connection, input)
        if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const knownColumns = columns.map((column) => column.name)
        return { ok: true, data: databaseMutationPlanData(connection, input, knownColumns.length ? knownColumns : inputKnownColumns(input)) }
      } catch (error) {
        return {
          ok: false,
          errorCode: relationalErrorCode(error, relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'MUTATION_PLAN_FAILED')),
          errorMessage: relationalErrorMessage(error, 'Database table mutation planning failed.')
        }
      }
    }
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table mutation planning is not wired in this aiopsterm backend yet.' }
  }

  return planDatabaseSeedTableMutation(connection, input)
}

export async function mutateDatabaseTable(input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> {
  ensureDatabaseStateLoaded()
  const startedAt = Date.now()
  const connection = databaseConnections.find((item) => item.id === trim(input.connectionId))
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return sqliteMutateTable(connection, input, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!shouldUseDatabaseSeedData()) {
    if (isClickHouseConnection(connection)) return clickHouseMutateTable(connection, input, startedAt)
    if (isPrestoConnection(connection)) return prestoMutationUnsupported()
    if (isRelationalConnection(connection)) return relationalMutateTable(connection, input, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table mutations are not wired in this aiopsterm backend yet.' }
  }

  const mutation = mutateDatabaseSeedTable(input)
  if (!mutation.ok) {
    return { ok: false, errorCode: mutation.errorCode, errorMessage: mutation.errorMessage }
  }
  persistDatabaseState()

  return {
    ok: true,
    data: {
      affected: mutation.affected,
      durationMs: Math.max(1, Date.now() - startedAt),
      catalog: databaseWorkspaceCatalogFor(input.connectionId)
    }
  }
}

export {
  DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS,
  DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS,
  cancelDatabaseAiDrawerResponse,
  cancelDatabaseAiPaneResponse,
  configureDatabaseAiRuntime,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  diagnoseDatabaseSqlError,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  getDatabaseAiPaneState,
  saveDatabaseAiPaneState,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse
} from './databaseAi'

export type {
  DatabaseAiProviderTextInput,
  DatabaseAiProviderTextMessage,
  DatabaseAiProviderTextResult
} from './databaseAi'
