import type {
  DatabaseCatalogDefaults,
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseConnectionSaveInput,
  DatabaseConnectionTestInput,
  DatabaseEngineCode,
  DatabaseGroupInfo,
  DatabaseSchemaInfo,
  DatabaseTableInfo
} from './contracts/database'
import { connectionUsesDatabaseProxy } from './databaseConnectionTestRuntime'
import { databaseFileNameFromPath } from './databaseConnectionNaming'
import {
  clickHouseBaseUrlFrom,
  isClickHouseConnection,
  isPrestoConnection,
  prestoBaseUrlFrom
} from './databaseHttpEngines'
import {
  isPostgresCompatibleDbType,
  isRelationalConnection
} from './databaseRelationalEngines'
import { DEFAULT_DATABASE_GROUP_ID } from './databaseSeedData'
import {
  isRealSqliteConnection,
  sqliteCatalogsForConnection,
  sqlitePathFromUrl
} from './databaseSqliteRuntime'
import { trim } from './databaseTableRuntime'

type DatabaseSeedTableExists = (input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) => boolean

const databaseEnvValues = new Set<DatabaseConnectionInfo['env']>(['Development', 'TEST', 'Staging', 'Production'])
const postgresSslModeValues = new Set(['', 'disable', 'require', 'verify-ca', 'verify-full'])

const cloneDatabaseColumn = (column: DatabaseColumnInfo): DatabaseColumnInfo => ({ ...column })

const cloneDatabaseTable = (table: DatabaseTableInfo): DatabaseTableInfo => ({
  ...table,
  columns: table.columns.map(cloneDatabaseColumn),
  primaryKey: table.primaryKey.slice()
})

export const cloneDatabaseCatalogRaw = (catalog: DatabaseCatalogInfo): DatabaseCatalogInfo => ({
  name: catalog.name,
  ...(catalog.tables ? { tables: catalog.tables.map(cloneDatabaseTable) } : {}),
  ...(catalog.schemas
    ? {
        schemas: catalog.schemas.map((schema) => ({
          name: schema.name,
          tables: schema.tables.map(cloneDatabaseTable),
          views: schema.views?.map(cloneDatabaseTable),
          functions: schema.functions?.slice(),
          procedures: schema.procedures?.slice()
        }))
      }
    : {})
})

export const cloneDatabaseCatalog = (
  connectionId: string,
  catalog: DatabaseCatalogInfo,
  seedTableExists: DatabaseSeedTableExists
): DatabaseCatalogInfo => ({
  name: catalog.name,
  ...(catalog.tables
    ? {
        tables: catalog.tables
          .filter((table) => seedTableExists({ connectionId, databaseName: catalog.name, tableName: table.name }))
          .map(cloneDatabaseTable)
      }
    : {}),
  ...(catalog.schemas
    ? {
        schemas: catalog.schemas.map((schema) => ({
          name: schema.name,
          tables: schema.tables
            .filter((table) => seedTableExists({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name }))
            .map(cloneDatabaseTable),
          views: (schema.views ?? [])
            .filter((table) => seedTableExists({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name }))
            .map(cloneDatabaseTable),
          functions: schema.functions?.slice(),
          procedures: schema.procedures?.slice()
        }))
      }
    : {})
})

export const cloneDatabaseConnectionForRuntime = (
  connection: DatabaseConnectionInfo,
  deps: {
    shouldUseSeedData: () => boolean
    isVerifiedConnection: (connectionId: string) => boolean
    seedTableExists: DatabaseSeedTableExists
  }
): DatabaseConnectionInfo => ({
  ...connection,
  status:
    !deps.shouldUseSeedData() &&
    (isRelationalConnection(connection) || isClickHouseConnection(connection) || isPrestoConnection(connection)) &&
    connection.status === 'connected' &&
    !deps.isVerifiedConnection(connection.id)
      ? 'idle'
      : connection.status,
  catalogs:
    (connection.dbType === 'sqlite' && isRealSqliteConnection(connection)) || !deps.shouldUseSeedData()
      ? connection.catalogs.map(cloneDatabaseCatalogRaw)
      : connection.catalogs.map((catalog) => cloneDatabaseCatalog(connection.id, catalog, deps.seedTableExists))
})

export const visibleDatabaseConnectionsForRuntime = (input: {
  connections: DatabaseConnectionInfo[]
  shouldUseSeedData: boolean
  seedConnectionIds: Set<string>
  isVerifiedConnection: (connectionId: string) => boolean
  hasConnectionSecret: (connectionId: string) => boolean
}) =>
  input.shouldUseSeedData
    ? input.connections
    : input.connections.filter(
        (connection) =>
          !input.seedConnectionIds.has(connection.id) ||
          input.isVerifiedConnection(connection.id) ||
          input.hasConnectionSecret(connection.id)
      )

const defaultDatabaseCatalogDefaults = (): DatabaseCatalogDefaults => ({
  selectedNodeId: 'conn-prod-pg',
  expandedGroupIds: ['group-default', 'group-prod', 'group-local'],
  expandedConnectionIds: ['conn-prod-pg'],
  expandedCatalogIds: ['conn-prod-pg:orders'],
  expandedSchemaIds: ['conn-prod-pg:orders:public', 'conn-prod-pg:orders:ops'],
  expandedSchemaObjectFolderIds: ['conn-prod-pg:orders:public:tables', 'conn-prod-pg:orders:ops:tables']
})

const schemaHasObjects = (schema: DatabaseSchemaInfo) =>
  schema.tables.length > 0 || (schema.views?.length ?? 0) > 0 || (schema.functions?.length ?? 0) > 0 || (schema.procedures?.length ?? 0) > 0

export const databaseCatalogDefaultsForRuntime = (input: {
  selectedConnectionId?: string
  visibleConnections: DatabaseConnectionInfo[]
  groups: DatabaseGroupInfo[]
  shouldUseSeedData: boolean
}): DatabaseCatalogDefaults => {
  const selectedConnectionId = input.selectedConnectionId || 'conn-prod-pg'
  const baseDefaults = defaultDatabaseCatalogDefaults()
  const selectedConnection = input.visibleConnections.find((connection) => connection.id === selectedConnectionId)
  const selectedGroup = input.groups.find((group) => group.id === selectedConnectionId)
  const expandedGroupIds = input.groups.map((group) => group.id)
  if (!selectedConnection || selectedConnectionId === 'conn-prod-pg') {
    if (!input.shouldUseSeedData && !selectedConnection) {
      const firstConnection = input.visibleConnections[0]
      return {
        selectedNodeId: selectedGroup?.id ?? firstConnection?.id ?? null,
        expandedGroupIds,
        expandedConnectionIds: firstConnection ? [firstConnection.id] : [],
        expandedCatalogIds: [],
        expandedSchemaIds: [],
        expandedSchemaObjectFolderIds: []
      }
    }
    return {
      ...baseDefaults,
      selectedNodeId: selectedGroup?.id ?? baseDefaults.selectedNodeId,
      expandedGroupIds
    }
  }

  const expandedCatalogIds = selectedConnection.catalogs.map((catalog) => `${selectedConnection.id}:${catalog.name}`)
  const expandedSchemaIds = selectedConnection.catalogs.flatMap((catalog) =>
    (catalog.schemas ?? []).filter(schemaHasObjects).map((schema) => `${selectedConnection.id}:${catalog.name}:${schema.name}`)
  )
  const expandedSchemaObjectFolderIds = selectedConnection.catalogs.flatMap((catalog) =>
    (catalog.schemas ?? []).flatMap((schema) => {
      const folderIds: string[] = []
      if (schema.tables.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:tables`)
      if (schema.views?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:views`)
      if (schema.functions?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:functions`)
      if (schema.procedures?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:procedures`)
      return folderIds
    })
  )

  return {
    selectedNodeId: selectedConnection.id,
    expandedGroupIds,
    expandedConnectionIds: Array.from(new Set([...baseDefaults.expandedConnectionIds, selectedConnection.id])),
    expandedCatalogIds: Array.from(new Set([...baseDefaults.expandedCatalogIds, ...expandedCatalogIds])),
    expandedSchemaIds: Array.from(new Set([...baseDefaults.expandedSchemaIds, ...expandedSchemaIds])),
    expandedSchemaObjectFolderIds: Array.from(new Set([...baseDefaults.expandedSchemaObjectFolderIds, ...expandedSchemaObjectFolderIds]))
  }
}

export const nextDatabaseConnectionId = (name: string, connections: DatabaseConnectionInfo[]) => {
  const base = `conn-${slugForId(name, 'database')}`
  let candidate = base
  let suffix = 2
  while (connections.some((connection) => connection.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

export const nextDatabaseGroupId = (name: string, groups: DatabaseGroupInfo[]) => {
  const base = `group-${slugForId(name, 'group')}`
  let candidate = base
  let suffix = 2
  while (groups.some((group) => group.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const slugForId = (value: string, fallback: string) =>
  trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || fallback

export const databaseGroupExists = (groupId: string | null | undefined, groups: DatabaseGroupInfo[]) =>
  !!groupId && groups.some((group) => group.id === groupId)

export const normalizedDatabaseGroupId = (groupId: string | null | undefined, groups: DatabaseGroupInfo[]) => {
  const id = trim(groupId)
  return databaseGroupExists(id, groups) ? id : DEFAULT_DATABASE_GROUP_ID
}

export const normalizedDatabaseGroupParentId = (groupId: string | null | undefined, groups: DatabaseGroupInfo[]) => {
  const id = trim(groupId)
  return databaseGroupExists(id, groups) ? id : null
}

export const databaseGroupDescendantIds = (
  groupId: string,
  groups: DatabaseGroupInfo[],
  groupParents: Record<string, string | null>
) => {
  const out = new Set<string>()
  const visit = (parentId: string) => {
    for (const group of groups) {
      if ((groupParents[group.id] ?? null) === parentId) {
        out.add(group.id)
        visit(group.id)
      }
    }
  }
  visit(groupId)
  return out
}

const normalizedDatabasePort = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

const jdbcSchemeForDbType = (dbType: DatabaseEngineCode) =>
  dbType === 'postgresql'
    ? 'jdbc:postgresql'
    : dbType === 'kingbase'
      ? 'jdbc:kingbase8'
      : dbType === 'sqlserver'
        ? 'jdbc:sqlserver'
        : dbType === 'clickhouse' || dbType === 'presto'
          ? 'http'
          : dbType === 'mariadb'
            ? 'jdbc:mariadb'
            : dbType === 'oceanbase'
              ? 'jdbc:oceanbase'
              : 'jdbc:mysql'

const buildSavedConnectionUrl = (
  input: DatabaseConnectionTestInput,
  normalized: Pick<DatabaseConnectionInfo, 'dbType' | 'host' | 'port' | 'database' | 'filePath'>
) => {
  const rawUrl = trim(input.url)
  if (rawUrl) return rawUrl
  if (normalized.dbType === 'sqlite') return `sqlite://${normalized.filePath || ''}`
  if (normalized.dbType === 'clickhouse') return clickHouseBaseUrlFrom(normalized)
  if (normalized.dbType === 'presto') return prestoBaseUrlFrom(normalized)
  const port = normalized.port ? `:${normalized.port}` : ''
  const database = normalized.database ? `/${normalized.database}` : ''
  if (normalized.dbType === 'oracle') return `${normalized.host}${port}${database}`
  const scheme = jdbcSchemeForDbType(normalized.dbType)
  return `${scheme}://${normalized.host}${port}${database}`
}

export const defaultCatalogsForSavedConnection = (connection: Omit<DatabaseConnectionInfo, 'catalogs'>): DatabaseCatalogInfo[] => {
  const catalogName = trim(connection.database)
  if (!catalogName) return []
  if (connection.dbType === 'sqlite') {
    const sqliteCatalogs = sqliteCatalogsForConnection({ ...connection, catalogs: [] })
    return sqliteCatalogs ?? [{ name: 'main', tables: [] }]
  }
  if (isPostgresCompatibleDbType(connection.dbType)) {
    return [{ name: catalogName, schemas: [{ name: 'public', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'oracle') {
    const schemaName = trim(connection.user).toUpperCase()
    return [{ name: catalogName, schemas: schemaName ? [{ name: schemaName, tables: [], views: [], functions: [], procedures: [] }] : [] }]
  }
  if (connection.dbType === 'sqlserver') {
    return [{ name: catalogName, schemas: [{ name: 'dbo', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'presto') {
    return [{ name: catalogName, schemas: [] }]
  }
  return [{ name: catalogName, tables: [] }]
}

export const createDatabaseCatalogForConnection = (connection: DatabaseConnectionInfo, name: string): DatabaseCatalogInfo =>
  isPostgresCompatibleDbType(connection.dbType) || connection.dbType === 'sqlserver'
    ? { name, schemas: [{ name: isPostgresCompatibleDbType(connection.dbType) ? 'public' : 'dbo', tables: [], views: [], functions: [], procedures: [] }] }
    : { name, tables: [] }

const unquoteDatabaseIdentifier = (value: string) => {
  const token = trim(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  if (token.startsWith('[') && token.endsWith(']')) return token.slice(1, -1).replace(/]]/g, ']')
  return token
}

export const databaseNameFromCreateSql = (sql: string) => {
  const match = trim(sql).match(/^create\s+database\s+(?:if\s+not\s+exists\s+)?(`(?:``|[^`])+`|"(?:""|[^"])+"|\[(?:]]|[^\]])+\]|[A-Za-z_][A-Za-z0-9_]*)\s*;?$/i)
  return match ? unquoteDatabaseIdentifier(match[1]) : ''
}

export const normalizeDatabaseConnectionSaveDraft = (
  input: DatabaseConnectionSaveInput['connection'],
  groups: DatabaseGroupInfo[]
): Omit<DatabaseConnectionInfo, 'id' | 'status' | 'catalogs' | 'hasPassword'> => {
  const isSqlite = input.dbType === 'sqlite'
  const hasOracleConnectString = input.dbType === 'oracle' && !!trim(input.url)
  const filePath = isSqlite ? trim(input.filePath) || sqlitePathFromUrl(trim(input.url)) : ''
  const database = isSqlite ? databaseFileNameFromPath(filePath) || 'main' : trim(input.database)
  const host = isSqlite ? 'local' : hasOracleConnectString ? 'connect-string' : trim(input.host)
  const port = isSqlite || hasOracleConnectString ? null : normalizedDatabasePort(input.port)
  const sslMode: DatabaseConnectionInfo['sslMode'] =
    isPostgresCompatibleDbType(input.dbType) && postgresSslModeValues.has(input.sslMode ?? '') ? ((input.sslMode || '') as DatabaseConnectionInfo['sslMode']) : ''
  const proxyName = !isSqlite && connectionUsesDatabaseProxy(input) ? trim(input.proxyName) : ''
  const normalized = {
    name: trim(input.name),
    dbType: input.dbType,
    env: input.env && databaseEnvValues.has(input.env) ? input.env : 'Development',
    groupId: normalizedDatabaseGroupId(input.groupId, groups),
    host,
    port,
    authentication: input.authentication === 'UserAndPassword' ? input.authentication : 'UserAndPassword',
    user: isSqlite ? '' : trim(input.user),
    database,
    filePath: isSqlite ? filePath : undefined,
    readonly: isSqlite ? !!input.readonly : undefined,
    sslMode,
    needProxy: !isSqlite && !!proxyName ? true : undefined,
    proxyName: !isSqlite && proxyName ? proxyName : undefined
  }
  return {
    ...normalized,
    url: buildSavedConnectionUrl(input, normalized)
  }
}
