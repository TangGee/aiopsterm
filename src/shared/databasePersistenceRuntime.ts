import type {
  DatabaseAiPaneStateSnapshot,
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabaseGroupInfo,
  DatabaseSchemaInfo,
  DatabaseTableInfo
} from './contracts/database'
import { normalizeDatabaseAiPaneState } from './databaseAi'
import {
  decryptDatabaseCredentialFromStorage,
  isDatabaseCredentialCiphertext
} from './databaseCredentialStorage'
import {
  DEFAULT_DATABASE_GROUP_ID,
  supportedDatabaseEngines
} from './databaseSeedData'
import {
  isRecord,
  trim
} from './databaseTableRuntime'

export type DatabasePersistedState = {
  version: 1
  groups: DatabaseGroupInfo[]
  groupParents: Record<string, string | null>
  connections: DatabaseConnectionInfo[]
  secrets: Record<string, { password?: string }>
  aiPaneState?: DatabaseAiPaneStateSnapshot
  needsSecretMigration?: boolean
}

const databaseEnvValues = new Set<DatabaseConnectionInfo['env']>(['Development', 'TEST', 'Staging', 'Production'])
const databaseStatusValues = new Set<DatabaseConnectionInfo['status']>(['idle', 'testing', 'connected', 'failed'])
const postgresSslModeValues = new Set(['', 'disable', 'require', 'verify-ca', 'verify-full'])

const normalizePersistedString = (value: unknown, fallback = '') => {
  const text = trim(value)
  return text || fallback
}

const primaryKeyForColumns = (columns: DatabaseColumnInfo[]) => columns.filter((column) => column.key === 'PK').map((column) => column.name)

const normalizedDatabasePort = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | '') => dbType === 'postgresql' || dbType === 'kingbase'

const normalizePersistedColumn = (value: unknown): DatabaseColumnInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const key = value.key === 'PK' || value.key === 'FK' ? value.key : undefined
  return {
    name,
    type: normalizePersistedString(value.type, 'unknown'),
    nullable: value.nullable !== false,
    ...(key ? { key } : {})
  }
}

const normalizePersistedTable = (value: unknown): DatabaseTableInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const columns = Array.isArray(value.columns)
    ? value.columns.map(normalizePersistedColumn).filter((column): column is DatabaseColumnInfo => Boolean(column))
    : []
  return {
    id: normalizePersistedString(value.id, `tbl-persisted-${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`),
    name,
    columns,
    primaryKey: Array.isArray(value.primaryKey) ? value.primaryKey.map(trim).filter(Boolean) : primaryKeyForColumns(columns)
  }
}

const normalizePersistedSchema = (value: unknown): DatabaseSchemaInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const tables = Array.isArray(value.tables)
    ? value.tables.map(normalizePersistedTable).filter((table): table is DatabaseTableInfo => Boolean(table))
    : []
  const views = Array.isArray(value.views)
    ? value.views.map(normalizePersistedTable).filter((table): table is DatabaseTableInfo => Boolean(table))
    : []
  return {
    name,
    tables,
    views,
    functions: Array.isArray(value.functions) ? value.functions.map(trim).filter(Boolean) : [],
    procedures: Array.isArray(value.procedures) ? value.procedures.map(trim).filter(Boolean) : []
  }
}

const normalizePersistedCatalog = (value: unknown): DatabaseCatalogInfo | null => {
  if (!isRecord(value)) return null
  const name = normalizePersistedString(value.name)
  if (!name) return null
  const tables = Array.isArray(value.tables)
    ? value.tables.map(normalizePersistedTable).filter((table): table is DatabaseTableInfo => Boolean(table))
    : undefined
  const schemas = Array.isArray(value.schemas)
    ? value.schemas.map(normalizePersistedSchema).filter((schema): schema is DatabaseSchemaInfo => Boolean(schema))
    : undefined
  return {
    name,
    ...(schemas ? { schemas } : {}),
    ...(tables ? { tables } : {})
  }
}

const normalizePersistedGroup = (value: unknown): DatabaseGroupInfo | null => {
  if (!isRecord(value)) return null
  const id = normalizePersistedString(value.id)
  const name = normalizePersistedString(value.name)
  if (!id || !name) return null
  return { id, name }
}

const normalizePersistedConnection = (value: unknown, knownGroupIds: Set<string>): DatabaseConnectionInfo | null => {
  if (!isRecord(value)) return null
  const id = normalizePersistedString(value.id)
  const name = normalizePersistedString(value.name)
  const dbType = typeof value.dbType === 'string' && supportedDatabaseEngines.has(value.dbType as DatabaseEngineCode) ? (value.dbType as DatabaseEngineCode) : null
  if (!id || !name || !dbType) return null
  const port = normalizedDatabasePort(typeof value.port === 'number' ? value.port : Number(value.port))
  const sslMode = postgresSslModeValues.has(String(value.sslMode ?? '')) ? (String(value.sslMode ?? '') as DatabaseConnectionInfo['sslMode']) : ''
  const proxyName = dbType !== 'sqlite' && value.needProxy === true ? normalizePersistedString(value.proxyName) : ''
  return {
    id,
    name,
    dbType,
    env: typeof value.env === 'string' && databaseEnvValues.has(value.env as DatabaseConnectionInfo['env']) ? (value.env as DatabaseConnectionInfo['env']) : 'Development',
    groupId: knownGroupIds.has(trim(value.groupId)) ? trim(value.groupId) : DEFAULT_DATABASE_GROUP_ID,
    host: normalizePersistedString(value.host, dbType === 'sqlite' ? 'local' : ''),
    port: dbType === 'sqlite' ? null : port,
    authentication: 'UserAndPassword',
    user: dbType === 'sqlite' ? '' : normalizePersistedString(value.user),
    hasPassword: value.hasPassword === true,
    database: normalizePersistedString(value.database),
    filePath: dbType === 'sqlite' ? normalizePersistedString(value.filePath) || undefined : undefined,
    readonly: dbType === 'sqlite' ? value.readonly !== false : undefined,
    sslMode: isPostgresCompatibleDbType(dbType) || dbType === 'sqlserver' ? sslMode : '',
    needProxy: proxyName ? true : undefined,
    proxyName: proxyName || undefined,
    url: normalizePersistedString(value.url) || undefined,
    status:
      typeof value.status === 'string' && databaseStatusValues.has(value.status as DatabaseConnectionInfo['status'])
        ? (value.status as DatabaseConnectionInfo['status'])
        : 'idle',
    catalogs: Array.isArray(value.catalogs)
      ? value.catalogs.map(normalizePersistedCatalog).filter((catalog): catalog is DatabaseCatalogInfo => Boolean(catalog))
      : []
  }
}

export const normalizePersistedState = (value: unknown): DatabasePersistedState | null => {
  if (!isRecord(value)) return null
  const groups = Array.isArray(value.groups)
    ? value.groups.map(normalizePersistedGroup).filter((group): group is DatabaseGroupInfo => Boolean(group))
    : []
  if (!groups.some((group) => group.id === DEFAULT_DATABASE_GROUP_ID)) {
    groups.unshift({ id: DEFAULT_DATABASE_GROUP_ID, name: 'Default Group' })
  }
  const knownGroupIds = new Set(groups.map((group) => group.id))
  const groupParents: Record<string, string | null> = {}
  const rawParents = isRecord(value.groupParents) ? value.groupParents : {}
  groups.forEach((group) => {
    const parentId = trim(rawParents[group.id])
    groupParents[group.id] = parentId && parentId !== group.id && knownGroupIds.has(parentId) ? parentId : null
  })
  const connections = Array.isArray(value.connections)
    ? value.connections.map((connection) => normalizePersistedConnection(connection, knownGroupIds)).filter((connection): connection is DatabaseConnectionInfo => Boolean(connection))
    : []
  const secrets: DatabasePersistedState['secrets'] = {}
  const rawSecrets = isRecord(value.secrets) ? value.secrets : {}
  let needsSecretMigration = false
  connections.forEach((connection) => {
    const secret = rawSecrets[connection.id]
    if (isRecord(secret) && typeof secret.password === 'string' && secret.password) {
      const password = decryptDatabaseCredentialFromStorage(secret.password)
      if (password) {
        secrets[connection.id] = { password }
        connection.hasPassword = true
        if (!isDatabaseCredentialCiphertext(secret.password)) needsSecretMigration = true
      }
    }
  })
  return {
    version: 1,
    groups,
    groupParents,
    connections,
    secrets,
    aiPaneState: isRecord(value.aiPaneState) ? normalizeDatabaseAiPaneState(value.aiPaneState) : undefined,
    needsSecretMigration
  }
}
