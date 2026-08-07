import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type {
  DatabaseCatalogResult,
  DatabaseConnectionDeleteResult,
  DatabaseConnectionInfo,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseCreateDatabaseInput,
  DatabaseCreateDatabaseResult,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  DatabaseWorkspaceCatalog
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
  decryptDatabaseCredentialFromStorage,
  encryptDatabaseCredentialForStorage,
  type SafeStorageLike
} from './databaseCredentialStorage'
import {
  clickHouseCatalogsForConnection,
  clickHouseErrorCode,
  clickHouseErrorMessage,
  clickHouseIdentifier,
  clickHouseQueryText,
  configureDatabaseHttpEngines,
  isClickHouseConnection,
  isPrestoConnection,
  prestoCatalogsForConnection
} from './databaseHttpEngines'
import {
  DATABASE_PERSISTED_STATE_VERSION,
  normalizePersistedState,
  type DatabasePersistedState
} from './databasePersistenceRuntime'
import {
  configureDatabaseRelationalEngines,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  isRelationalConnection,
  relationalCatalogsForConnection,
  relationalCreateDatabase,
  relationalErrorCode,
  relationalErrorMessage,
  relationalFallbackCode,
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
  databaseGroupSeed
} from './databaseSeedData'
import {
  databaseSeedTableExistsInBackend,
  resetDatabaseSeedTableRuntime
} from './databaseSeedTableRuntime'
import {
  configureDatabaseSqliteRuntime,
  isRealSqliteConnection,
  resetDatabaseSqliteRuntime,
  sqliteCatalogsForConnectionAsync
} from './databaseSqliteRuntime'
import { trim } from './databaseTableRuntime'
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
  credentialStorageBackend?: 'system' | 'local'
  safeStorage?: SafeStorageLike | null
}

let databaseRuntimeConfig: DatabaseRuntimeConfig = {}
const databaseConnectionSecrets = new Map<string, string>()
const databaseStoredConnectionSecrets = new Map<string, string>()
const databaseVerifiedConnections = new Set<string>()

export function configureDatabaseRuntime(config?: DatabaseRuntimeConfig) {
  databaseRuntimeConfig = config ? { ...config } : {}
  databaseLoadedStateFilePath = ''
  configureDatabaseCredentialStorage({
    stateFilePath: databaseRuntimeConfig.stateFilePath,
    credentialKeyPath: databaseRuntimeConfig.credentialKeyPath,
    storageBackend: databaseRuntimeConfig.credentialStorageBackend,
    ...(Object.prototype.hasOwnProperty.call(databaseRuntimeConfig, 'safeStorage') ? { safeStorage: databaseRuntimeConfig.safeStorage } : {})
  })
  resetDatabaseRelationalRuntime()
  resetDatabaseSqliteRuntime()
}

const shouldUseDatabaseSeedData = () => databaseRuntimeConfig.useSeedData ?? runtimeShouldUseDatabaseSeedData()

const databaseConnectionPassword = (connectionId: string) => {
  const cached = databaseConnectionSecrets.get(connectionId)
  if (cached) return cached
  const stored = databaseStoredConnectionSecrets.get(connectionId)
  if (!stored) return ''
  const password = decryptDatabaseCredentialFromStorage(stored)
  if (password) databaseConnectionSecrets.set(connectionId, password)
  return password
}

const hasDatabaseConnectionSecret = (connectionId: string) =>
  databaseConnectionSecrets.has(connectionId) || databaseStoredConnectionSecrets.has(connectionId)

const setDatabaseConnectionSecret = (connectionId: string, password: string) => {
  databaseStoredConnectionSecrets.delete(connectionId)
  if (password) databaseConnectionSecrets.set(connectionId, password)
  else databaseConnectionSecrets.delete(connectionId)
}

const deleteDatabaseConnectionSecret = (connectionId: string) => {
  databaseConnectionSecrets.delete(connectionId)
  databaseStoredConnectionSecrets.delete(connectionId)
}

const connectionTestInputFromSaved = (connection: DatabaseConnectionInfo): DatabaseConnectionTestInput => ({
  dbType: connection.dbType,
  name: connection.name,
  host: connection.host,
  port: connection.port,
  user: connection.user,
  password: databaseConnectionPassword(connection.id),
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
  tableKeysForContext: (input) => databaseAiCatalogTableKeysForContext(input),
  tableKeyForContext: (input) => databaseAiCatalogTableKeyForContext(input),
  columnsForTableKey: (key) => databaseAiCatalogColumnsForTableKey(key)
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
let databaseReadOnlyStateFilePath = ''

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
  databaseStoredConnectionSecrets.clear()
  Object.entries(state.secrets).forEach(([connectionId, secret]) => {
    if (secret.password) databaseStoredConnectionSecrets.set(connectionId, secret.password)
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
    const persistedVersion = parsed && typeof parsed === 'object' ? Number((parsed as { version?: unknown }).version) : Number.NaN
    if (Number.isFinite(persistedVersion) && persistedVersion > DATABASE_PERSISTED_STATE_VERSION) {
      databaseReadOnlyStateFilePath = filePath
      return
    }
    databaseReadOnlyStateFilePath = ''
    const state = normalizePersistedState(parsed)
    if (state) {
      applyPersistedDatabaseState(state)
      if (state.needsSecretMigration || state.needsStateMigration) persistDatabaseState()
    }
  } catch {
    /* Ignore corrupt local state and keep the backend fallback catalog. */
  }
}

const persistDatabaseState = () => {
  const filePath = databaseStateFilePath()
  if (!filePath) return
  ensureDatabaseStateLoaded()
  if (databaseReadOnlyStateFilePath === filePath) return
  try {
    const state: DatabasePersistedState = {
      version: DATABASE_PERSISTED_STATE_VERSION,
      groups: databaseGroups.map((group) => ({ ...group })),
      groupParents: { ...databaseGroupParents },
      connections: visibleDatabaseConnections().map(cloneDatabaseConnection),
      secrets: Object.fromEntries(
        databaseConnections.flatMap((connection) => {
          const plaintext = databaseConnectionSecrets.get(connection.id)
          const stored = databaseStoredConnectionSecrets.get(connection.id)
          const password = plaintext || stored
          if (!password) return []
          const encrypted = encryptDatabaseCredentialForStorage(password)
          databaseStoredConnectionSecrets.set(connection.id, encrypted)
          return [[connection.id, { password: encrypted }]]
        })
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
    hasConnectionSecret: hasDatabaseConnectionSecret
  })

type DatabaseAiCatalogTableMetadata = {
  key: string
  tableName: string
  columns: string[]
}

const databaseAiCatalogTableMetadataForContext = (input: {
  connectionId: string
  databaseName?: string
  schemaName?: string
}): DatabaseAiCatalogTableMetadata[] => {
  const connectionId = trim(input.connectionId)
  const databaseName = trim(input.databaseName)
  const schemaName = trim(input.schemaName)
  const connection = visibleDatabaseConnections().find((item) => item.id === connectionId)
  if (!connection) return []

  const metadata = new Map<string, DatabaseAiCatalogTableMetadata>()
  const addTables = (catalogName: string, currentSchemaName: string, tables: DatabaseConnectionInfo['catalogs'][number]['tables']) => {
    const sourceTables = tables ?? []
    sourceTables.forEach((table) => {
      const key = `${connectionId}:${catalogName}:${currentSchemaName}:${table.name}`
      metadata.set(key, {
        key,
        tableName: table.name,
        columns: table.columns.map((column) => column.name)
      })
    })
  }

  connection.catalogs.forEach((catalog) => {
    if (databaseName && catalog.name !== databaseName) return
    if (!schemaName) addTables(catalog.name, '', catalog.tables)
    const schemas = catalog.schemas ?? []
    schemas.forEach((schema) => {
      if (schemaName && schema.name !== schemaName) return
      addTables(catalog.name, schema.name, schema.tables)
      addTables(catalog.name, schema.name, schema.views)
    })
  })
  return [...metadata.values()]
}

const databaseAiCatalogTableKeysForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) =>
  databaseAiCatalogTableMetadataForContext(input).map((item) => item.key)

const databaseAiCatalogTableKeyForContext = (input: {
  connectionId: string
  databaseName?: string
  schemaName?: string
  tableName?: string
}) => {
  const tableName = trim(input.tableName)
  if (!tableName) return ''
  const metadata = databaseAiCatalogTableMetadataForContext(input)
  return metadata.find((item) => item.tableName === tableName)?.key
    ?? metadata.find((item) => item.tableName.toLowerCase() === tableName.toLowerCase())?.key
    ?? ''
}

const databaseAiCatalogColumnsForTableKey = (key: string) => {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex < 1) return []
  const connectionId = key.slice(0, separatorIndex)
  return databaseAiCatalogTableMetadataForContext({ connectionId }).find((item) => item.key === key)?.columns.slice() ?? []
}

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

const defaultCatalogsForSavedConnectionAsync = async (connection: Omit<DatabaseConnectionInfo, 'catalogs'>): Promise<DatabaseConnectionInfo['catalogs']> => {
  if (connection.dbType !== 'sqlite') return defaultCatalogsForSavedConnection(connection)
  const catalogs = await sqliteCatalogsForConnectionAsync({ ...connection, catalogs: [] })
  return catalogs ?? [{ name: 'main', tables: [] }]
}

const databaseConnectionById = (connectionId: string) => databaseConnections.find((item) => item.id === trim(connectionId)) ?? null

export const databaseCatalogBackendRuntimeContext = {
  ensureStateLoaded: ensureDatabaseStateLoaded,
  persistState: persistDatabaseState,
  shouldUseSeedData: shouldUseDatabaseSeedData,
  workspaceCatalogFor: databaseWorkspaceCatalogFor,
  findConnection: (connectionId: string) => {
    ensureDatabaseStateLoaded()
    return databaseConnectionById(connectionId)
  }
}

export function resetDatabaseBackendSeed() {
  databaseRuntimeConfig = {}
  databaseLoadedStateFilePath = ''
  databaseReadOnlyStateFilePath = ''
  databaseConnectionSecrets.clear()
  databaseStoredConnectionSecrets.clear()
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

const databaseNameAfterCatalogRefresh = (connection: DatabaseConnectionInfo, catalogs: DatabaseConnectionInfo['catalogs']) => {
  const resolvedName = trim(catalogs[0]?.name)
  if (!resolvedName) return connection.database
  if (connection.dbType === 'oracle' || connection.dbType === 'sqlserver' || isPostgresCompatibleDbType(connection.dbType)) return resolvedName
  return connection.database
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
  deleteDatabaseConnectionSecret(id)
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
  const connection = databaseConnectionById(id)
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
      return applyConnectionFailure(
        id,
        error,
        'DB_CLICKHOUSE_CONNECTION_FAILED',
        'Database connection failed.'
      )
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
      return applyConnectionFailure(
        id,
        error,
        'DB_PRESTO_CONNECTION_FAILED',
        'Database connection failed.'
      )
    }
  }
  if (!shouldUseDatabaseSeedData() && isRelationalConnection(connection)) {
    try {
      const catalogs = await relationalCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection opened', (current) => ({
        ...current,
        status: 'connected',
        database: databaseNameAfterCatalogRefresh(current, catalogs),
        catalogs
      }))
    } catch (error) {
      return applyConnectionFailure(
        id,
        error,
        relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'CONNECTION_FAILED'),
        'Database connection failed.'
      )
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
  const connection = databaseConnectionById(id)
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (connection.dbType === 'sqlite') {
    const catalogs = await sqliteCatalogsForConnectionAsync(connection)
    return databaseConnectionMutation(id, 'Connection schema refreshed', (current) => (catalogs ? { ...current, catalogs } : { ...current }))
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
      return applyConnectionFailure(
        id,
        error,
        'DB_CLICKHOUSE_REFRESH_FAILED',
        'Database schema refresh failed.'
      )
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
      return applyConnectionFailure(
        id,
        error,
        'DB_PRESTO_REFRESH_FAILED',
        'Database schema refresh failed.'
      )
    }
  }
  if (!shouldUseDatabaseSeedData() && isRelationalConnection(connection)) {
    try {
      const catalogs = await relationalCatalogsForConnection(connection)
      databaseVerifiedConnections.add(id)
      return databaseConnectionMutation(id, 'Connection schema refreshed', (current) => ({
        ...current,
        status: 'connected',
        database: databaseNameAfterCatalogRefresh(current, catalogs),
        catalogs
      }))
    } catch (error) {
      return applyConnectionFailure(
        id,
        error,
        relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'REFRESH_FAILED'),
        'Database schema refresh failed.'
      )
    }
  }
  return databaseConnectionMutation(connectionId, 'Connection schema refreshed', (connection) => ({ ...connection }))
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
      ? { ...input.connection, password: databaseConnectionPassword(existing.id) }
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
            : await defaultCatalogsForSavedConnectionAsync({
                id: existing.id,
                ...normalized,
                hasPassword: connectionSecret ? true : existing.hasPassword,
                status: existing.status
              })
    }
    databaseConnections[existingIndex] = saved
    if (connectionSecret) setDatabaseConnectionSecret(saved.id, connectionSecret)
    if (!connectionSecret && !saved.hasPassword) deleteDatabaseConnectionSecret(saved.id)
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
  saved.catalogs = await defaultCatalogsForSavedConnectionAsync(saved)
  databaseConnections.push(saved)
  if (connectionSecret) setDatabaseConnectionSecret(saved.id, connectionSecret)
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
