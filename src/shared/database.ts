import { randomUUID } from 'crypto'
import type {
  DatabaseColumnFilter,
  DatabaseColumnSort,
  DatabaseAiDrawerAction,
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiTargetDialect,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneRequestResult,
  DatabaseCatalogInfo,
  DatabaseCatalogResult,
  DatabaseCatalogDefaults,
  DatabaseColumnInfo,
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
  DatabaseEngineInfo,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  DatabaseSchemaInfo,
  DatabaseWorkspaceCatalog,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
  DatabaseSqlExecuteInput,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableInfo,
  DatabaseTableMutationInput,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './preload'

const supportedEngines = new Set(['mysql', 'postgresql', 'sqlite', 'oracle'])
const DEFAULT_DATABASE_GROUP_ID = 'group-default'

const engineVersions: Record<DatabaseConnectionTestInput['dbType'], string> = {
  mysql: 'MySQL 8 local backend validation',
  postgresql: 'PostgreSQL 16 local backend validation',
  sqlite: 'SQLite local backend validation',
  oracle: 'Oracle local backend validation'
}

const databaseEngines: DatabaseEngineInfo[] = [
  { code: 'mysql', connectionCode: 'mysql', name: 'MySQL', enabled: true, accent: '#00758f' },
  { code: 'h2', name: 'H2', enabled: false, accent: '#7c3aed' },
  { code: 'oracle', connectionCode: 'oracle', name: 'Oracle', enabled: true, accent: '#c74634' },
  { code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' },
  { code: 'sqlserver', name: 'SQLServer', enabled: false, accent: '#a91d22' },
  { code: 'sqlite', connectionCode: 'sqlite', name: 'SQLite', enabled: true, accent: '#00a1e0' },
  { code: 'mariadb', name: 'MariaDB', enabled: false, accent: '#c0765c' },
  { code: 'clickhouse', name: 'ClickHouse', enabled: false, accent: '#fdd835' },
  { code: 'dm', name: 'DM', enabled: false, accent: '#d946ef' },
  { code: 'presto', name: 'Presto', enabled: false, accent: '#7c2d12' },
  { code: 'db2', name: 'DB2', enabled: false, accent: '#2563eb' },
  { code: 'oceanbase', name: 'OceanBase', enabled: false, accent: '#0ea5e9' },
  { code: 'hive', name: 'Hive', enabled: false, accent: '#f59e0b' },
  { code: 'kingbase', name: 'KingBase', enabled: false, accent: '#dc2626' },
  { code: 'mongodb', name: 'MongoDB', enabled: false, accent: '#4db33d' },
  { code: 'timeplus', name: 'Timeplus', enabled: false, accent: '#14b8a6' }
]

const databaseGroupSeed: DatabaseGroupInfo[] = [
  { id: 'group-default', name: 'Default Group' },
  { id: 'group-prod', name: 'Production' },
  { id: 'group-local', name: 'Local Lab' }
]

const databaseGroupParentSeed: Record<string, string | null> = {
  'group-default': null,
  'group-prod': null,
  'group-local': null
}

const ordersColumns: DatabaseColumnInfo[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'owner', type: 'varchar(64)', nullable: true },
  { name: 'updated_at', type: 'timestamp', nullable: false }
]

const incidentsColumns: DatabaseColumnInfo[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'updated_at', type: 'datetime', nullable: false }
]

const serviceHealthColumns: DatabaseColumnInfo[] = [
  { name: 'id', type: 'int', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'region', type: 'varchar(32)', nullable: false },
  { name: 'latency_ms', type: 'int', nullable: false },
  { name: 'healthy', type: 'tinyint', nullable: false }
]

const metricEventsColumns: DatabaseColumnInfo[] = [
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'event_type', type: 'varchar(32)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'created_at', type: 'datetime', nullable: false }
]

const cacheColumns: DatabaseColumnInfo[] = [
  { name: 'key', type: 'text', nullable: false, key: 'PK' },
  { name: 'value', type: 'text', nullable: true },
  { name: 'ttl_seconds', type: 'integer', nullable: true },
  { name: 'updated_at', type: 'text', nullable: false }
]

const oracleAuditColumns: DatabaseColumnInfo[] = [
  { name: 'event_id', type: 'NUMBER', nullable: false },
  { name: 'actor', type: 'VARCHAR2(64)', nullable: false },
  { name: 'action', type: 'VARCHAR2(64)', nullable: false },
  { name: 'created_at', type: 'TIMESTAMP', nullable: false }
]

const databaseConnectionSeed: DatabaseConnectionInfo[] = [
  {
    id: 'conn-prod-pg',
    name: 'orders-postgres',
    dbType: 'postgresql',
    env: 'Production',
    groupId: 'group-prod',
    host: '10.32.6.9',
    port: 5432,
    authentication: 'UserAndPassword',
    user: 'readonly',
    hasPassword: true,
    database: 'orders',
    sslMode: 'require',
    url: 'jdbc:postgresql://10.32.6.9:5432/orders',
    status: 'connected',
    catalogs: [
      {
        name: 'orders',
        schemas: [
          {
            name: 'public',
            tables: [{ id: 'tbl-orders', name: 'orders', columns: ordersColumns, primaryKey: ['id'] }],
            views: [{ id: 'view-public-open-orders', name: 'open_orders_v', columns: ordersColumns, primaryKey: ['id'] }],
            functions: ['notify_order_owner(order_id bigint)', 'calculate_order_age(order_id bigint)'],
            procedures: ['archive_closed_orders(cutoff timestamp)']
          },
          {
            name: 'ops',
            tables: [{ id: 'tbl-pg-incidents', name: 'ops_incidents', columns: incidentsColumns, primaryKey: ['id'] }],
            views: [{ id: 'view-ops-active-incidents', name: 'active_incidents_v', columns: incidentsColumns, primaryKey: ['id'] }],
            functions: ['incident_priority(severity text)'],
            procedures: ['rotate_incident_partitions()']
          }
        ]
      }
    ]
  },
  {
    id: 'conn-metrics-mysql',
    name: 'metrics-mysql',
    dbType: 'mysql',
    env: 'Staging',
    groupId: 'group-default',
    host: '10.32.6.18',
    port: 3306,
    authentication: 'UserAndPassword',
    user: 'ops',
    hasPassword: true,
    database: 'metrics',
    url: 'jdbc:mysql://10.32.6.18:3306/metrics',
    status: 'idle',
    catalogs: [
      {
        name: 'metrics',
        tables: [
          { id: 'tbl-service-health', name: 'service_health', columns: serviceHealthColumns, primaryKey: ['id'] },
          { id: 'tbl-mysql-incidents', name: 'ops_incidents', columns: incidentsColumns, primaryKey: ['id'] },
          { id: 'tbl-metric-events', name: 'metric_events', columns: metricEventsColumns, primaryKey: [] }
        ]
      }
    ]
  },
  {
    id: 'conn-oracle-audit',
    name: 'audit-oracle',
    dbType: 'oracle',
    env: 'TEST',
    groupId: 'group-default',
    host: '10.32.6.28',
    port: 1521,
    authentication: 'UserAndPassword',
    user: 'audit',
    hasPassword: true,
    database: 'ORCLPDB1',
    url: '10.32.6.28:1521/ORCLPDB1',
    status: 'connected',
    catalogs: [
      {
        name: 'ORCLPDB1',
        schemas: [
          {
            name: 'OPS',
            tables: [{ id: 'tbl-oracle-audit-log', name: 'AUDIT_LOG', columns: oracleAuditColumns, primaryKey: [] }]
          }
        ]
      }
    ]
  },
  {
    id: 'conn-local-cache',
    name: 'local-cache',
    dbType: 'sqlite',
    env: 'Development',
    groupId: 'group-local',
    host: 'local',
    port: null,
    authentication: 'UserAndPassword',
    user: '',
    database: 'cache.db',
    filePath: '/tmp/aiopsterm/cache.db',
    readonly: true,
    url: 'sqlite:///tmp/aiopsterm/cache.db',
    status: 'idle',
    catalogs: [
      {
        name: 'cache.db',
        tables: [{ id: 'tbl-cache-entries', name: 'cache_entries', columns: cacheColumns, primaryKey: ['key'] }]
      }
    ]
  }
]

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const sqlitePathFromUrl = (url: string) => {
  const trimmed = trim(url)
  if (!trimmed.toLowerCase().startsWith('sqlite://')) return ''
  return trimmed.replace(/^sqlite:\/\//i, '')
}

const endpointFor = (input: DatabaseConnectionTestInput) => {
  if (input.dbType === 'sqlite') return trim(input.filePath) || sqlitePathFromUrl(trim(input.url))
  if (input.dbType === 'oracle' && trim(input.url)) return trim(input.url)
  const host = trim(input.host)
  const port = typeof input.port === 'number' && Number.isFinite(input.port) ? input.port : null
  return port ? `${host}:${port}` : host
}

const queryRows: Record<string, Array<Record<string, unknown>>> = {
  'conn-prod-pg:orders:public:orders': [
    { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' },
    { id: 1002, service: 'orders-worker', status: 'mitigated', owner: 'bob', updated_at: '2026-06-03 09:44:00' },
    { id: 1003, service: 'k8s-ingress', status: 'watching', owner: null, updated_at: '2026-06-02 22:01:00' },
    { id: 1004, service: 'billing-sync', status: 'closed', owner: 'carol', updated_at: '2026-06-02 18:22:00' }
  ],
  'conn-prod-pg:orders:public:open_orders_v': [
    { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' }
  ],
  'conn-prod-pg:orders:ops:ops_incidents': [
    { id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' },
    { id: 9002, service: 'search', severity: 'P2', status: 'triaged', updated_at: '2026-06-03 08:04:00' }
  ],
  'conn-prod-pg:orders:ops:active_incidents_v': [{ id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' }],
  'conn-metrics-mysql:metrics::service_health': [
    { id: 1, service: 'api-gateway', region: 'shanghai', latency_ms: 28, healthy: true },
    { id: 2, service: 'worker', region: 'hangzhou', latency_ms: 73, healthy: true },
    { id: 3, service: 'queue', region: 'shenzhen', latency_ms: 211, healthy: false }
  ],
  'conn-metrics-mysql:metrics::ops_incidents': [
    { id: 7001, service: 'metrics-api', severity: 'P2', status: 'watching', updated_at: '2026-06-03 07:52:00' },
    { id: 7002, service: 'prometheus', severity: 'P3', status: 'closed', updated_at: '2026-06-02 16:31:00' }
  ],
  'conn-metrics-mysql:metrics::metric_events': [
    { service: 'api-gateway', event_type: 'deploy', severity: 'info', created_at: '2026-06-03 10:42:00' },
    { service: 'queue', event_type: 'lag', severity: 'warning', created_at: '2026-06-03 10:58:00' }
  ],
  'conn-oracle-audit:ORCLPDB1:OPS:AUDIT_LOG': [
    { event_id: 501, actor: 'deploy-bot', action: 'RELEASE_START', created_at: '2026-06-03 08:10:00' },
    { event_id: 502, actor: 'ops-user', action: 'MANUAL_APPROVE', created_at: '2026-06-03 08:16:00' }
  ],
  'conn-local-cache:cache.db::cache_entries': [
    { key: 'session:1001', value: 'payment-api', ttl_seconds: 3600, updated_at: '2026-06-03 09:00:00' },
    { key: 'feature:rollout', value: 'enabled', ttl_seconds: null, updated_at: '2026-06-02 23:20:00' }
  ]
}

const tableDdl: Record<string, { ddl: string; error?: { code: 'permission' | 'other'; message: string } }> = {
  'conn-prod-pg:orders:public:orders': {
    ddl:
      'CREATE TABLE public.orders (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  owner VARCHAR(64),\n  updated_at TIMESTAMP NOT NULL\n);'
  },
  'conn-prod-pg:orders:public:open_orders_v': {
    ddl:
      'CREATE VIEW public.open_orders_v AS\nSELECT id, service, status, owner, updated_at\nFROM public.orders\nWHERE status <> \'closed\';',
    error: { code: 'permission', message: 'DDL requires elevated catalog permission.' }
  },
  'conn-prod-pg:orders:ops:ops_incidents': {
    ddl:
      'CREATE TABLE ops.ops_incidents (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  severity VARCHAR(16) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  updated_at TIMESTAMP NOT NULL\n);'
  },
  'conn-prod-pg:orders:ops:active_incidents_v': {
    ddl:
      'CREATE VIEW ops.active_incidents_v AS\nSELECT id, service, severity, status, updated_at\nFROM ops.ops_incidents\nWHERE status <> \'closed\';'
  },
  'conn-metrics-mysql:metrics::service_health': {
    ddl:
      'CREATE TABLE `service_health` (\n  `id` INT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `region` VARCHAR(32) NOT NULL,\n  `latency_ms` INT NOT NULL,\n  `healthy` TINYINT NOT NULL,\n  PRIMARY KEY (`id`)\n);'
  },
  'conn-metrics-mysql:metrics::ops_incidents': {
    ddl:
      'CREATE TABLE `ops_incidents` (\n  `id` BIGINT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `status` VARCHAR(32) NOT NULL,\n  `updated_at` DATETIME NOT NULL,\n  PRIMARY KEY (`id`)\n);'
  },
  'conn-metrics-mysql:metrics::metric_events': {
    ddl:
      'CREATE TABLE `metric_events` (\n  `service` VARCHAR(80) NOT NULL,\n  `event_type` VARCHAR(32) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `created_at` DATETIME NOT NULL\n);'
  },
  'conn-oracle-audit:ORCLPDB1:OPS:AUDIT_LOG': {
    ddl:
      'CREATE TABLE OPS.AUDIT_LOG (\n  event_id NUMBER NOT NULL,\n  actor VARCHAR2(64) NOT NULL,\n  action VARCHAR2(64) NOT NULL,\n  created_at TIMESTAMP NOT NULL\n);'
  },
  'conn-local-cache:cache.db::cache_entries': {
    ddl:
      'CREATE TABLE cache_entries (\n  key TEXT PRIMARY KEY,\n  value TEXT,\n  ttl_seconds INTEGER,\n  updated_at TEXT NOT NULL\n);'
  }
}

const cloneRows = (rows: Record<string, Array<Record<string, unknown>>>) =>
  Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.map((row) => ({ ...row }))]))

const columnsForRows = (rows: Array<Record<string, unknown>>) => Object.keys(rows[0] ?? {})

const cloneColumns = (columns: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, value.slice()]))

const tableRows = cloneRows(queryRows)
const tableColumns = cloneColumns(Object.fromEntries(Object.entries(queryRows).map(([key, rows]) => [key, columnsForRows(rows)])))
const tableDdlEntries = Object.fromEntries(Object.entries(tableDdl).map(([key, value]) => [key, { ddl: value.ddl, error: value.error ? { ...value.error } : undefined }]))

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

const tableExistsInBackend = (input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) => {
  const key = `${input.connectionId}:${input.databaseName}:${input.schemaName || ''}:${input.tableName}`
  return hasOwn(tableRows, key) || hasOwn(tableDdlEntries, key)
}

const cloneDatabaseColumn = (column: DatabaseColumnInfo): DatabaseColumnInfo => ({ ...column })

const cloneDatabaseTable = (table: DatabaseTableInfo): DatabaseTableInfo => ({
  ...table,
  columns: table.columns.map(cloneDatabaseColumn),
  primaryKey: table.primaryKey.slice()
})

const cloneDatabaseCatalog = (connectionId: string, catalog: DatabaseCatalogInfo): DatabaseCatalogInfo => ({
  name: catalog.name,
  ...(catalog.tables
    ? {
        tables: catalog.tables
          .filter((table) => tableExistsInBackend({ connectionId, databaseName: catalog.name, tableName: table.name }))
          .map(cloneDatabaseTable)
      }
    : {}),
  ...(catalog.schemas
    ? {
        schemas: catalog.schemas.map((schema) => ({
          name: schema.name,
          tables: schema.tables
            .filter((table) => tableExistsInBackend({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name }))
            .map(cloneDatabaseTable),
          views: (schema.views ?? [])
            .filter((table) => tableExistsInBackend({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name }))
            .map(cloneDatabaseTable),
          functions: schema.functions?.slice(),
          procedures: schema.procedures?.slice()
        }))
      }
    : {})
})

const cloneDatabaseConnection = (connection: DatabaseConnectionInfo): DatabaseConnectionInfo => ({
  ...connection,
  catalogs: connection.catalogs.map((catalog) => cloneDatabaseCatalog(connection.id, catalog))
})

let databaseGroups: DatabaseGroupInfo[] = databaseGroupSeed.map((group) => ({ ...group }))
let databaseGroupParents: Record<string, string | null> = { ...databaseGroupParentSeed }
let databaseConnections: DatabaseConnectionInfo[] = databaseConnectionSeed.map(cloneDatabaseConnection)

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

const databaseCatalogDefaultsFor = (selectedConnectionId = 'conn-prod-pg'): DatabaseCatalogDefaults => {
  const baseDefaults = defaultDatabaseCatalogDefaults()
  const selectedConnection = databaseConnections.find((connection) => connection.id === selectedConnectionId)
  const selectedGroup = databaseGroups.find((group) => group.id === selectedConnectionId)
  const expandedGroupIds = databaseGroups.map((group) => group.id)
  if (!selectedConnection || selectedConnectionId === 'conn-prod-pg') {
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

const databaseWorkspaceCatalogFor = (selectedConnectionId = 'conn-prod-pg'): DatabaseWorkspaceCatalog => ({
  engines: databaseEngines.map((engine) => ({ ...engine })),
  groups: databaseGroups.map((group) => ({ ...group })),
  groupParents: { ...databaseGroupParents },
  connections: databaseConnections.map(cloneDatabaseConnection),
  defaults: databaseCatalogDefaultsFor(selectedConnectionId)
})

const databaseEnvValues = new Set<DatabaseConnectionInfo['env']>(['Development', 'TEST', 'Staging', 'Production'])
const postgresSslModeValues = new Set(['', 'disable', 'require', 'verify-ca', 'verify-full'])

const basenameFromPath = (value: string) => {
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || 'main'
}

const slugForConnectionId = (value: string) =>
  trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'database'

const slugForGroupId = (value: string) =>
  trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'group'

const nextDatabaseConnectionId = (name: string) => {
  const base = `conn-${slugForConnectionId(name)}`
  let candidate = base
  let suffix = 2
  while (databaseConnections.some((connection) => connection.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const nextDatabaseGroupId = (name: string) => {
  const base = `group-${slugForGroupId(name)}`
  let candidate = base
  let suffix = 2
  while (databaseGroups.some((group) => group.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const databaseGroupExists = (groupId: string | null | undefined) => !!groupId && databaseGroups.some((group) => group.id === groupId)

const normalizedDatabaseGroupId = (groupId: string | null | undefined) => {
  const id = trim(groupId)
  return databaseGroupExists(id) ? id : DEFAULT_DATABASE_GROUP_ID
}

const normalizedDatabaseGroupParentId = (groupId: string | null | undefined) => {
  const id = trim(groupId)
  return databaseGroupExists(id) ? id : null
}

const databaseGroupDescendantIds = (groupId: string) => {
  const out = new Set<string>()
  const visit = (parentId: string) => {
    for (const group of databaseGroups) {
      if ((databaseGroupParents[group.id] ?? null) === parentId) {
        out.add(group.id)
        visit(group.id)
      }
    }
  }
  visit(groupId)
  return out
}

const normalizedDatabasePort = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

const buildSavedConnectionUrl = (
  input: DatabaseConnectionTestInput,
  normalized: Pick<DatabaseConnectionInfo, 'dbType' | 'host' | 'port' | 'database' | 'filePath'>
) => {
  const rawUrl = trim(input.url)
  if (rawUrl) return rawUrl
  if (normalized.dbType === 'sqlite') return `sqlite://${normalized.filePath || ''}`
  const port = normalized.port ? `:${normalized.port}` : ''
  const database = normalized.database ? `/${normalized.database}` : ''
  if (normalized.dbType === 'oracle') return `${normalized.host}${port}${database}`
  const scheme = normalized.dbType === 'postgresql' ? 'jdbc:postgresql' : 'jdbc:mysql'
  return `${scheme}://${normalized.host}${port}${database}`
}

const defaultCatalogsForSavedConnection = (connection: Omit<DatabaseConnectionInfo, 'catalogs'>): DatabaseCatalogInfo[] => {
  const catalogName = trim(connection.database)
  if (!catalogName) return []
  if (connection.dbType === 'postgresql') {
    return [{ name: catalogName, schemas: [{ name: 'public', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'oracle') {
    return [{ name: catalogName, schemas: [{ name: 'OPS', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  return [{ name: catalogName, tables: [] }]
}

const createDatabaseCatalogForConnection = (connection: DatabaseConnectionInfo, name: string): DatabaseCatalogInfo =>
  connection.dbType === 'postgresql'
    ? { name, schemas: [{ name: 'public', tables: [], views: [], functions: [], procedures: [] }] }
    : { name, tables: [] }

const unquoteDatabaseIdentifier = (value: string) => {
  const token = trim(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  return token
}

const databaseNameFromCreateSql = (sql: string) => {
  const match = trim(sql).match(/^create\s+database\s+(?:if\s+not\s+exists\s+)?(`(?:``|[^`])+`|"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_]*)\s*;?$/i)
  return match ? unquoteDatabaseIdentifier(match[1]) : ''
}

const normalizeDatabaseConnectionSaveDraft = (
  input: DatabaseConnectionSaveInput['connection']
): Omit<DatabaseConnectionInfo, 'id' | 'status' | 'catalogs' | 'hasPassword'> => {
  const isSqlite = input.dbType === 'sqlite'
  const hasOracleConnectString = input.dbType === 'oracle' && !!trim(input.url)
  const filePath = isSqlite ? trim(input.filePath) || sqlitePathFromUrl(trim(input.url)) : ''
  const database = isSqlite ? basenameFromPath(filePath) : trim(input.database)
  const host = isSqlite ? 'local' : hasOracleConnectString ? 'connect-string' : trim(input.host)
  const port = isSqlite || hasOracleConnectString ? null : normalizedDatabasePort(input.port)
  const sslMode: DatabaseConnectionInfo['sslMode'] =
    input.dbType === 'postgresql' && postgresSslModeValues.has(input.sslMode ?? '') ? ((input.sslMode || '') as DatabaseConnectionInfo['sslMode']) : ''
  const normalized = {
    name: trim(input.name),
    dbType: input.dbType,
    env: input.env && databaseEnvValues.has(input.env) ? input.env : 'Development',
    groupId: normalizedDatabaseGroupId(input.groupId),
    host,
    port,
    authentication: input.authentication === 'UserAndPassword' ? input.authentication : 'UserAndPassword',
    user: isSqlite ? '' : trim(input.user),
    database,
    filePath: isSqlite ? filePath : undefined,
    readonly: isSqlite ? !!input.readonly : undefined,
    sslMode
  }
  return {
    ...normalized,
    url: buildSavedConnectionUrl(input, normalized)
  }
}

export function resetDatabaseBackendSeed() {
  Object.keys(tableRows).forEach((key) => {
    delete tableRows[key]
  })
  Object.keys(tableColumns).forEach((key) => {
    delete tableColumns[key]
  })
  Object.assign(tableRows, cloneRows(queryRows))
  Object.assign(tableColumns, cloneColumns(Object.fromEntries(Object.entries(queryRows).map(([key, rows]) => [key, columnsForRows(rows)]))))
  Object.keys(tableDdlEntries).forEach((key) => {
    delete tableDdlEntries[key]
  })
  Object.assign(tableDdlEntries, Object.fromEntries(Object.entries(tableDdl).map(([key, value]) => [key, { ddl: value.ddl, error: value.error ? { ...value.error } : undefined }])))
  databaseGroups = databaseGroupSeed.map((group) => ({ ...group }))
  databaseGroupParents = { ...databaseGroupParentSeed }
  databaseConnections = databaseConnectionSeed.map(cloneDatabaseConnection)
  databaseAiPaneMessages.clear()
  databaseAiDrawerRequests.clear()
}

export async function listDatabaseCatalog(): Promise<DatabaseCatalogResult> {
  return {
    ok: true,
    data: databaseWorkspaceCatalogFor()
  }
}

export async function createDatabaseGroup(input: DatabaseGroupCreateInput): Promise<DatabaseGroupMutationResult> {
  const name = trim(input.name) || 'New Group'
  const parentId = normalizedDatabaseGroupParentId(input.parentId)
  const group: DatabaseGroupInfo = {
    id: nextDatabaseGroupId(name),
    name
  }
  databaseGroups.push(group)
  databaseGroupParents[group.id] = parentId

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
  const group = databaseGroups.find((item) => item.id === trim(input.id))
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  const name = trim(input.name)
  if (!name) {
    return { ok: false, errorCode: 'DB_GROUP_NAME_REQUIRED', errorMessage: 'Group name is required.' }
  }

  group.name = name
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
  const groupId = trim(input.id)
  const group = databaseGroups.find((item) => item.id === groupId)
  if (!group) {
    return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  }
  if (groupId === DEFAULT_DATABASE_GROUP_ID) {
    return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be moved.' }
  }

  const parentId = input.parentId === undefined ? (databaseGroupParents[groupId] ?? null) : normalizedDatabaseGroupParentId(input.parentId)
  if (parentId === groupId || (parentId && databaseGroupDescendantIds(groupId).has(parentId))) {
    return { ok: false, errorCode: 'DB_GROUP_PARENT_INVALID', errorMessage: 'Group cannot be moved into itself or one of its children.' }
  }

  databaseGroupParents[groupId] = parentId
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
  const id = trim(connectionId)
  const index = databaseConnections.findIndex((connection) => connection.id === id)
  if (index === -1) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  const saved = mutate(databaseConnections[index])
  databaseConnections[index] = saved
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
  const groupId = normalizedDatabaseGroupId(input.groupId)
  return databaseConnectionMutation(input.connectionId, groupId === DEFAULT_DATABASE_GROUP_ID ? 'Connection moved to root group' : 'Connection moved', (connection) => ({
    ...connection,
    groupId
  }))
}

export async function removeDatabaseConnection(connectionId: string): Promise<DatabaseConnectionDeleteResult> {
  const id = trim(connectionId)
  const index = databaseConnections.findIndex((connection) => connection.id === id)
  if (index === -1) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  databaseConnections = databaseConnections.filter((connection) => connection.id !== id)
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(),
      connectionId: id,
      message: 'Connection removed'
    }
  }
}

export async function connectDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  return databaseConnectionMutation(connectionId, 'Connection opened', (connection) => ({
    ...connection,
    status: 'connected'
  }))
}

export async function disconnectDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  return databaseConnectionMutation(connectionId, 'Connection closed', (connection) => ({
    ...connection,
    status: 'idle'
  }))
}

export async function refreshDatabaseConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  return databaseConnectionMutation(connectionId, 'Connection schema refreshed', (connection) => ({ ...connection }))
}

const normalizeSql = (sql: string) => sql.trim().replace(/\s+/g, ' ')

export const DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS = 500
export const DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS = 260

const databaseAiPaneMessages = new Map<string, DatabaseAiPaneMessageRecord>()
const databaseAiDrawerRequests = new Map<string, DatabaseAiDrawerRequestRecord>()

const databaseAiPaneMessageRecord = (
  input: {
    requestId: string
    role: 'user' | 'assistant'
    status: DatabaseAiPaneMessageRecord['status']
    content: string
    contextSummary: string
    createdAt: number
  },
  id = `dbai-pane-message-${randomUUID()}`
): DatabaseAiPaneMessageRecord => ({
  id,
  requestId: input.requestId,
  role: input.role,
  status: input.status,
  content: input.content,
  contextSummary: input.contextSummary,
  createdAt: input.createdAt,
  updatedAt: input.createdAt
})

const cloneDatabaseAiPaneMessageRecord = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({ ...message })

const storeDatabaseAiPaneMessage = (message: DatabaseAiPaneMessageRecord) => {
  databaseAiPaneMessages.set(message.id, cloneDatabaseAiPaneMessageRecord(message))
  return message
}

const findDatabaseAiPaneAssistantMessage = (input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneMessageRecord | null => {
  const assistantMessageId = trim(input.assistantMessageId)
  if (assistantMessageId) {
    const message = databaseAiPaneMessages.get(assistantMessageId)
    if (message?.role === 'assistant') return cloneDatabaseAiPaneMessageRecord(message)
  }
  const requestId = trim(input.requestId)
  if (!requestId) return null
  return (
    Array.from(databaseAiPaneMessages.values())
      .filter((message) => message.role === 'assistant' && message.requestId === requestId)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}

const updateDatabaseAiPaneAssistantMessage = (
  input: DatabaseAiPaneLifecycleInput,
  patch: Partial<Pick<DatabaseAiPaneMessageRecord, 'status' | 'content' | 'updatedAt'>>
): DatabaseAiPaneMessageRecord | null => {
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return null
  const updated: DatabaseAiPaneMessageRecord = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? Date.now()
  }
  databaseAiPaneMessages.set(updated.id, cloneDatabaseAiPaneMessageRecord(updated))
  return updated
}

const cloneDatabaseAiDrawerRequestRecord = (request: DatabaseAiDrawerRequestRecord): DatabaseAiDrawerRequestRecord => ({
  ...request,
  backendContext: { ...request.backendContext }
})

const storeDatabaseAiDrawerRequest = (request: DatabaseAiDrawerRequestRecord) => {
  databaseAiDrawerRequests.set(request.id, cloneDatabaseAiDrawerRequestRecord(request))
  return request
}

const findDatabaseAiDrawerRequest = (input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerRequestRecord | null => {
  const requestId = trim(input.requestId)
  if (!requestId) return null
  const request = databaseAiDrawerRequests.get(requestId)
  return request ? cloneDatabaseAiDrawerRequestRecord(request) : null
}

const updateDatabaseAiDrawerRequest = (
  input: DatabaseAiDrawerLifecycleInput,
  patch: Partial<Pick<DatabaseAiDrawerRequestRecord, 'status' | 'text' | 'targetDialect' | 'updatedAt'>>
): DatabaseAiDrawerRequestRecord | null => {
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return null
  const updated = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? Date.now()
  }
  databaseAiDrawerRequests.set(updated.id, cloneDatabaseAiDrawerRequestRecord(updated))
  return updated
}

const databaseAiPaneContextSummary = (input: DatabaseAiPaneResponseInput) =>
  trim(input.context.contextSummary) ||
  [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')

const databaseAiPaneErrorResponse = (
  input: DatabaseAiPaneResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string
): DatabaseAiPaneResponseResult => {
  const requestId = trim(input.requestId) || `dbai-pane-request-${randomUUID()}`
  const contextSummary = databaseAiPaneContextSummary(input)
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  let assistantMessage: DatabaseAiPaneMessageRecord
  if (existing && existing.status !== 'cancelled') {
    assistantMessage =
      updateDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: existing.id }, { status: 'error', content: errorMessage }) ?? existing
  } else {
    assistantMessage =
      existing ??
      storeDatabaseAiPaneMessage(
        databaseAiPaneMessageRecord(
          {
            requestId,
            role: 'assistant',
            status: 'error',
            content: errorMessage,
            contextSummary,
            createdAt: startedAt
          },
          input.assistantMessageId || `dbai-pane-message-${randomUUID()}`
        )
      )
  }

  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      requestId,
      assistantMessage,
      text: assistantMessage.content,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

const databaseAiDrawerErrorResponse = (
  input: DatabaseAiDrawerResponseInput,
  startedAt: number,
  errorCode: string,
  errorMessage: string
): DatabaseAiDrawerResponseResult => {
  const requestId = trim(input.requestId)
  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  const targetDialect = drawerTargetDialect(input)
  const text = `Reasoning\n- ${errorMessage}`
  let request: DatabaseAiDrawerRequestRecord
  if (existing && existing.status !== 'cancelled') {
    request = updateDatabaseAiDrawerRequest({ requestId: existing.id }, { status: 'error', text, targetDialect }) ?? existing
  } else {
    request =
      existing ??
      storeDatabaseAiDrawerRequest({
        id: requestId || `dbai-drawer-request-${randomUUID()}`,
        action: input.action,
        label: databaseAiDrawerActionName(input.action),
        status: 'error',
        contextSummary: trim(input.context.contextSummary),
        sourceSql: input.sourceSql,
        text,
        targetDialect,
        backendContext: {
          connectionId: trim(input.context.connectionId),
          dbType: input.context.dbType || '',
          databaseName: trim(input.context.databaseName),
          schemaName: trim(input.context.schemaName) || undefined,
          tableName: trim(input.context.tableName) || undefined,
          contextSummary: trim(input.context.contextSummary) || undefined
        },
        createdAt: startedAt,
        updatedAt: Date.now()
      })
  }

  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      request,
      text: request.text,
      reasoning: request.text,
      sql: '',
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

const databaseAiDrawerActionName = (action: DatabaseAiDrawerAction) => {
  switch (action) {
    case 'explain':
      return 'Explain SQL'
    case 'nl2sql':
      return 'Natural Language to SQL'
    case 'optimize':
      return 'Optimize SQL'
    case 'convert':
      return 'Convert SQL'
    case 'complete':
      return 'Complete SQL'
    case 'diagnose':
      return 'Diagnose SQL'
    case 'truncate':
      return 'Truncate Table'
    case 'drop':
      return 'Drop Table'
    default:
      return action
  }
}

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

const unquoteIdentifier = (value: string) => value.replace(/^[`"\[]|[`"\]]$/g, '').replace(/""/g, '"').replace(/``/g, '`').replace(/]]/g, ']')

const tableNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w.-]+[`"\]]?)?)/i)
  if (!match) return ''
  const parts = match[1]
    .split('.')
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean)
  return parts.at(-1) || ''
}

const keyParts = (key: string) => {
  const [connectionId, databaseName, schemaName, tableName] = key.split(':')
  return { connectionId, databaseName, schemaName, tableName }
}

const tableKeysForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) =>
  Object.keys(tableRows)
    .filter((key) => {
      const parts = keyParts(key)
      if (parts.connectionId !== input.connectionId) return false
      if (input.databaseName && parts.databaseName !== input.databaseName) return false
      if (input.schemaName && parts.schemaName !== input.schemaName) return false
      return true
    })
    .sort()

const firstTableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string }) => tableKeysForContext(input)[0] || ''

const quoteIdentifier = (value: string, dbType: DatabaseConnectionTestInput['dbType']) => {
  const raw = String(value || '')
  if (dbType === 'mysql') return `\`${raw.replace(/`/g, '``')}\``
  return `"${raw.replace(/"/g, '""')}"`
}

const qualifiedTableReference = (input: { dbType?: DatabaseConnectionTestInput['dbType'] | ''; databaseName?: string; schemaName?: string; tableName: string }) => {
  const dbType = input.dbType && supportedEngines.has(input.dbType) ? input.dbType : 'postgresql'
  const table = quoteIdentifier(input.tableName, dbType)
  if ((dbType === 'postgresql' || dbType === 'oracle') && input.schemaName) return `${quoteIdentifier(input.schemaName, dbType)}.${table}`
  if (dbType === 'sqlite' && input.databaseName) return `${quoteIdentifier(input.databaseName, dbType)}.${table}`
  return table
}

const sampleSelectForContext = (input: DatabaseAiPaneResponseInput) => {
  const key = firstTableKeyForContext({
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  if (!key) return 'select 1;'
  const parts = keyParts(key)
  const qualified = qualifiedTableReference({
    dbType: input.context.dbType || 'postgresql',
    databaseName: parts.databaseName,
    schemaName: parts.schemaName,
    tableName: parts.tableName
  })
  return input.context.dbType === 'oracle' ? `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;` : `SELECT *\nFROM ${qualified}\nLIMIT 100;`
}

const schemaSummaryForContext = (input: DatabaseAiPaneResponseInput) => {
  const keys = tableKeysForContext({
    connectionId: input.context.connectionId,
    databaseName: input.context.databaseName,
    schemaName: input.context.schemaName || ''
  })
  if (!keys.length) return ['- No table metadata is available behind the local DB AI backend boundary.']
  const grouped = new Map<string, string[]>()
  keys.forEach((key) => {
    const parts = keyParts(key)
    const group = parts.schemaName || parts.databaseName || 'default'
    const columns = tableColumns[key] ?? columnsForRows(tableRows[key] ?? [])
    const label = `${parts.tableName}(${columns.length} columns)`
    grouped.set(group, [...(grouped.get(group) ?? []), label])
  })
  return [...grouped.entries()].map(([group, tables]) => `- ${group}: ${tables.slice(0, 5).join(', ')}`)
}

const drawerDbType = (input: DatabaseAiDrawerResponseInput) =>
  input.context.dbType && supportedEngines.has(input.context.dbType) ? input.context.dbType : 'postgresql'

const drawerTargetDialect = (input: DatabaseAiDrawerResponseInput): DatabaseAiTargetDialect => input.targetDialect || drawerDbType(input)

const quoteDrawerIdentifier = (value: string, dialect: DatabaseAiTargetDialect) => {
  const raw = String(value || '').replace(/^[`"\[]|[`"\]]$/g, '')
  if (dialect === 'mysql') return `\`${raw.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

const dialectLabel = (dialect: DatabaseAiTargetDialect) => {
  if (dialect === 'postgresql') return 'PostgreSQL'
  if (dialect === 'mysql') return 'MySQL'
  if (dialect === 'sqlite') return 'SQLite'
  if (dialect === 'oracle') return 'Oracle'
  if (dialect === 'mssql') return 'SQL Server'
  return dialect
}

const stripSqlTerminator = (sql: string) => sql.trim().replace(/;+$/, '').trim()

const ensureSqlTerminated = (sql: string) => {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

const extractSqlLimit = (sql: string) => {
  const limitMatch = sql.match(/\blimit\s+(\d+)\b/i)
  if (limitMatch) return Number(limitMatch[1])
  const fetchMatch = sql.match(/\bfetch\s+first\s+(\d+)\s+rows\s+only\b/i)
  if (fetchMatch) return Number(fetchMatch[1])
  const topMatch = sql.match(/\btop\s*\(\s*(\d+)\s*\)/i)
  if (topMatch) return Number(topMatch[1])
  return null
}

const addDialectLimit = (sql: string, dialect: DatabaseAiTargetDialect, fallbackLimit: number) => {
  const limit = extractSqlLimit(sql) ?? fallbackLimit
  let withoutLimit = stripSqlTerminator(sql)
    .replace(/\s+limit\s+\d+\s*$/i, '')
    .replace(/\s+fetch\s+first\s+\d+\s+rows\s+only\s*$/i, '')
  const topMatch = withoutLimit.match(/^\s*select\s+top\s*\(\s*(\d+)\s*\)\s+/i)
  if (topMatch) withoutLimit = withoutLimit.replace(/^\s*select\s+top\s*\(\s*\d+\s*\)\s+/i, 'SELECT ')
  const resolvedLimit = Number(topMatch?.[1] ?? limit)
  if (dialect === 'oracle') return ensureSqlTerminated(`${withoutLimit}\nFETCH FIRST ${resolvedLimit} ROWS ONLY`)
  if (dialect === 'mssql') return ensureSqlTerminated(withoutLimit.replace(/^\s*select\s+/i, `SELECT TOP (${resolvedLimit}) `))
  return ensureSqlTerminated(`${withoutLimit}\nLIMIT ${resolvedLimit}`)
}

const stripLeadingSqlComments = (sql: string) => {
  let next = sql.trim()
  let changed = true
  while (changed) {
    const before = next
    next = next.replace(/^--[^\n]*(?:\n|$)/, '').replace(/^\/\*[\s\S]*?\*\//, '').trimStart()
    changed = next !== before
  }
  return next
}

const isReadOnlySql = (sql: string) => {
  const cleaned = stripLeadingSqlComments(sql).trim()
  if (!/^(select|with|explain)\b/i.test(cleaned)) return false
  return !/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|execute)\b/i.test(cleaned)
}

const drawerTableReference = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const explicitTable = trim(input.context.tableName) || tableNameFromSql(input.sourceSql)
  const connectionId = trim(input.context.connectionId)
  const databaseName = trim(input.context.databaseName)
  const schemaName = trim(input.context.schemaName) || schemaNameFromSql(input.sourceSql)
  const key = explicitTable
    ? tableKeyForContext({ connectionId, databaseName, schemaName, tableName: explicitTable })
    : firstTableKeyForContext({ connectionId, databaseName, schemaName })
  const parts = key ? keyParts(key) : { databaseName, schemaName, tableName: explicitTable || 'orders' }
  if ((dialect === 'postgresql' || dialect === 'oracle' || dialect === 'mssql') && parts.schemaName) {
    return `${quoteDrawerIdentifier(parts.schemaName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  }
  if (dialect === 'sqlite' && parts.databaseName) return `${quoteDrawerIdentifier(parts.databaseName, dialect)}.${quoteDrawerIdentifier(parts.tableName, dialect)}`
  return quoteDrawerIdentifier(parts.tableName, dialect)
}

const buildDrawerNl2Sql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const tableRef = drawerTableReference(input, dialect)
  if (dialect === 'oracle') {
    return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nFETCH FIRST 20 ROWS ONLY;`
  }
  if (dialect === 'mssql') {
    return `SELECT TOP (20) id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC;`
  }
  return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nLIMIT 20;`
}

const completeDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const fallback = `SELECT *\nFROM ${drawerTableReference(input, dialect)}`
  const base = stripSqlTerminator(input.sourceSql.trim() || fallback)
  let completed = base
  if (/\bwhere\s*$/i.test(completed)) {
    completed = `${completed} status = 'open'`
  } else if (!/\bwhere\b/i.test(completed) && /^\s*(select|with)\b/i.test(completed)) {
    completed = `${completed}\nWHERE status = 'open'`
  }
  return addDialectLimit(completed, dialect, 100)
}

const optimizeDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const fallback = `SELECT id, service, status, owner, updated_at\nFROM ${drawerTableReference(input, dialect)}`
  const base = stripSqlTerminator(input.sourceSql.trim() || fallback)
  const compact = base.replace(/\bselect\s+\*/i, 'SELECT id, service, status, owner, updated_at')
  return addDialectLimit(compact, dialect, 100)
}

const convertDrawerSqlToDialect = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const normalized = stripSqlTerminator(input.sourceSql.trim() || 'SELECT 1')
  const quoted = normalized
    .replace(/"([^"]+)"/g, (_match, value: string) => quoteDrawerIdentifier(value, dialect))
    .replace(/`([^`]+)`/g, (_match, value: string) => quoteDrawerIdentifier(value, dialect))
    .replace(/\[([^\]]+)\]/g, (_match, value: string) => quoteDrawerIdentifier(value, dialect))
  return addDialectLimit(quoted, dialect, extractSqlLimit(normalized) ?? 100)
}

const diagnoseDrawerSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  const tableRef = drawerTableReference(input, dialect)
  if (dialect === 'oracle') return `SELECT *\nFROM ${tableRef}\nFETCH FIRST 100 ROWS ONLY;`
  if (dialect === 'mssql') return `SELECT TOP (100) *\nFROM ${tableRef};`
  return `SELECT *\nFROM ${tableRef}\nLIMIT 100;`
}

const buildDrawerGeneratedSql = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action === 'convert') return convertDrawerSqlToDialect(input, dialect)
  if (input.action === 'diagnose') return diagnoseDrawerSql(input, dialect)
  if (input.action === 'nl2sql') return buildDrawerNl2Sql(input, dialect)
  if (input.action === 'complete') return completeDrawerSql(input, dialect)
  if (input.action === 'optimize') return optimizeDrawerSql(input, dialect)
  return ensureSqlTerminated(input.sourceSql.trim() || 'SELECT 1')
}

const isExecutableDrawerDialect = (input: DatabaseAiDrawerResponseInput, dialect: DatabaseAiTargetDialect) => {
  if (input.action !== 'convert') return true
  if (dialect === 'mssql') return false
  return drawerDbType(input) === dialect
}

const buildDrawerReasoning = (input: DatabaseAiDrawerResponseInput, generatedSql: string, dialect: DatabaseAiTargetDialect) => {
  const contextLine =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName, input.context.tableName].filter(Boolean).join(' · ')
  const lines = ['Reasoning', '- Read the active database context and selected editor range through the aiopsterm backend boundary.']
  if (contextLine) lines.push(`- Context: ${contextLine}.`)
  lines.push('- 当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。')
  if (input.action === 'convert') {
    lines.push(`- Converted the SQL text to ${dialectLabel(dialect)} syntax.`)
    lines.push(isExecutableDrawerDialect(input, dialect) ? '- Target dialect matches the active connection, so read-only execution can be enabled.' : '- Target dialect is text-only for this connection.')
  } else if (input.action === 'diagnose') {
    lines.push('- Built a conservative read-only statement that can verify the referenced table.')
    if (trim(input.errorMessage)) lines.push(`- Diagnosis input error: ${trim(input.errorMessage)}.`)
  } else if (input.action === 'drop' || input.action === 'truncate') {
    lines.push('- Preserved the destructive SQL as generated text only; execution remains blocked by the read-only guard.')
  } else if (input.action === 'nl2sql') {
    lines.push('- Mapped the request to the first visible table in the current database context.')
  } else if (input.action === 'complete') {
    lines.push('- Completed the current statement with a bounded read-only predicate.')
  } else if (input.action === 'optimize') {
    lines.push('- Kept the query read-only and added a safer bounded projection for review.')
  } else {
    lines.push('- Kept the source SQL available for editor actions and review.')
  }
  lines.push(`- Generated SQL is ${isReadOnlySql(generatedSql) ? 'read-only' : 'not read-only'} before any execution action.`)
  if (input.sourceSql.trim() && input.sourceSql !== generatedSql) {
    lines.push('- The original editor SQL remains unchanged until Copy, Replace, Insert, or Run ReadOnly is chosen.')
  }
  return lines.join('\n')
}

const composeDrawerResponseText = (reasoning: string, generatedSql: string) => `${reasoning}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``

const schemaNameFromSql = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?)\s*\.\s*([`"\[]?[\w.-]+[`"\]]?)/i)
  return match ? unquoteIdentifier(match[1].trim()) : ''
}

const tableRowsForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) => {
  const tableName = trim(input.tableName)
  const candidates = [
    `${input.connectionId}:${input.databaseName || ''}:${input.schemaName || ''}:${tableName}`,
    `${input.connectionId}:${input.databaseName || ''}::${tableName}`
  ]
  const found = candidates.map((key) => tableRows[key]).find(Boolean)
  return found?.map((row) => ({ ...row })) ?? null
}

const tableKeyForContext = (input: { connectionId: string; databaseName?: string; schemaName?: string; tableName?: string }) => {
  const tableName = trim(input.tableName)
  const candidates = [
    `${input.connectionId}:${input.databaseName || ''}:${input.schemaName || ''}:${tableName}`,
    `${input.connectionId}:${input.databaseName || ''}::${tableName}`
  ]
  return candidates.find((key) => tableRows[key]) || ''
}

const findRowsForSql = (input: DatabaseSqlExecuteInput, sql: string) => {
  const tableName = tableNameFromSql(sql)
  const explicitSchema = schemaNameFromSql(sql)
  return tableRowsForContext({
    connectionId: input.connectionId,
    databaseName: input.databaseName,
    schemaName: explicitSchema || input.schemaName || '',
    tableName
  })
}

const fallbackRowsForSql = (sql: string) => {
  if (/^\s*select\s+1\b/i.test(sql)) return [{ result: 1, message: 'backend query ok' }]
  return [{ result: 1, message: 'backend query ok' }]
}

const normalizeFilterValue = (value: unknown) => {
  if (value === null || value === undefined) return null
  return String(value)
}

const matchesFilter = (value: unknown, filter: DatabaseColumnFilter) => {
  const normalized = normalizeFilterValue(value)
  if (filter.operator === 'isnull') return normalized === null
  if (filter.operator === 'notnull') return normalized !== null
  if (normalized === null) return false
  if (filter.operator === 'like') return normalized.toLowerCase().includes(String(filter.value ?? '').toLowerCase())
  if (filter.operator === 'eq') return normalized === String(filter.value ?? '')
  if (filter.operator === 'neq') return normalized !== String(filter.value ?? '')
  if (filter.operator === 'in') return (filter.values ?? []).map(String).includes(normalized)
  return true
}

const parseWhereRaw = (whereRaw: string | null | undefined): DatabaseColumnFilter[] => {
  const raw = trim(whereRaw)
  if (!raw) return []
  const match = raw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (!match) return []
  return [
    {
      column: match[1],
      operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq',
      value: match[3]
    }
  ]
}

const filterRows = (rows: Array<Record<string, unknown>>, filters: DatabaseColumnFilter[]) => {
  if (!filters.length) return rows
  return rows.filter((row) => filters.every((filter) => matchesFilter(row[filter.column], filter)))
}

const sortRows = (rows: Array<Record<string, unknown>>, sort: DatabaseColumnSort | null | undefined) => {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const av = a[sort.column]
    const bv = b[sort.column]
    const factor = sort.direction === 'asc' ? 1 : -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor
  })
}

const normalizeOrderByIdentifier = (value: string) => {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

const parseOrderByRaw = (orderByRaw: string | null | undefined, knownColumns: string[]): DatabaseColumnSort | null => {
  const raw = trim(orderByRaw).replace(/^order\s+by\s+/i, '')
  if (!raw) return null
  const knownColumnMap = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  const first = raw.split(',')[0]?.trim() || ''
  const match = first.match(
    /^((?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*))*)(?:\s+(asc|desc))?/i
  )
  if (!match) return null
  const column = normalizeOrderByIdentifier(match[1])
  const knownColumn = knownColumnMap.get(column.toLowerCase())
  if (!knownColumn) return null
  return { column: knownColumn, direction: match[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
}

const rowKeyFor = (row: Record<string, unknown>, primaryKey: string[], index: number) => {
  if (!primaryKey.length) return `row-${index}`
  return JSON.stringify(primaryKey.map((column) => row[column] ?? null))
}

export async function testDatabaseConnection(input: DatabaseConnectionTestInput): Promise<DatabaseConnectionTestResult> {
  const startedAt = Date.now()
  if (!supportedEngines.has(input.dbType)) {
    return { ok: false, errorCode: 'DB_UNSUPPORTED_ENGINE', errorMessage: `Unsupported database engine: ${input.dbType}` }
  }

  if (!trim(input.name)) {
    return { ok: false, errorCode: 'DB_CONNECTION_NAME_REQUIRED', errorMessage: 'Connection name is required.' }
  }

  if (input.dbType === 'sqlite') {
    const filePath = trim(input.filePath) || sqlitePathFromUrl(trim(input.url))
    if (!filePath) {
      return { ok: false, errorCode: 'DB_SQLITE_FILE_REQUIRED', errorMessage: 'SQLite file path is required.' }
    }
    if (!/\.(db|sqlite|sqlite3)$/i.test(filePath)) {
      return { ok: false, errorCode: 'DB_SQLITE_EXTENSION', errorMessage: 'SQLite file should end with .db, .sqlite, or .sqlite3.' }
    }
  } else {
    const hasOracleConnectString = input.dbType === 'oracle' && !!trim(input.url)
    if (hasOracleConnectString && !/(jdbc:oracle|:\/\/|:)/i.test(trim(input.url))) {
      return { ok: false, errorCode: 'DB_ORACLE_CONNECT_STRING', errorMessage: 'Oracle connect string is not valid enough for backend validation.' }
    }
    if (!hasOracleConnectString) {
      if (!trim(input.host)) {
        return { ok: false, errorCode: 'DB_HOST_REQUIRED', errorMessage: 'Database host is required.' }
      }
      if (typeof input.port !== 'number' || !Number.isFinite(input.port) || input.port <= 0) {
        return { ok: false, errorCode: 'DB_PORT_REQUIRED', errorMessage: 'Database port is required.' }
      }
    }
    if (!trim(input.user)) {
      return { ok: false, errorCode: 'DB_USER_REQUIRED', errorMessage: 'Database user is required.' }
    }
  }

  return {
    ok: true,
    data: {
      dbType: input.dbType,
      serverVersion: engineVersions[input.dbType],
      endpoint: endpointFor(input),
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

export async function saveDatabaseConnection(input: DatabaseConnectionSaveInput): Promise<DatabaseConnectionSaveResult> {
  const testResult = await testDatabaseConnection(input.connection)
  if (!testResult.ok) {
    return {
      ok: false,
      errorCode: testResult.errorCode || 'DB_CONNECTION_SAVE_FAILED',
      errorMessage: testResult.errorMessage || 'Database connection validation failed.'
    }
  }

  const normalized = normalizeDatabaseConnectionSaveDraft(input.connection)

  if (input.mode === 'edit') {
    const existingIndex = databaseConnections.findIndex((connection) => connection.id === input.id)
    if (existingIndex === -1) {
      return {
        ok: false,
        errorCode: 'DB_CONNECTION_NOT_FOUND',
        errorMessage: 'Database connection was not found.'
      }
    }

    const existing = databaseConnections[existingIndex]
    const saved: DatabaseConnectionInfo = {
      id: existing.id,
      ...normalized,
      hasPassword: trim(input.connection.password) ? true : existing.hasPassword,
      status: existing.status,
      catalogs:
        existing.dbType === normalized.dbType && existing.database === normalized.database
          ? existing.catalogs.map((catalog) => cloneDatabaseCatalog(existing.id, catalog))
          : defaultCatalogsForSavedConnection({
              id: existing.id,
              ...normalized,
              hasPassword: trim(input.connection.password) ? true : existing.hasPassword,
              status: existing.status
            })
    }
    databaseConnections[existingIndex] = saved
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
    id: nextDatabaseConnectionId(normalized.name),
    ...normalized,
    hasPassword: !!trim(input.connection.password),
    status: 'idle',
    catalogs: []
  }
  saved.catalogs = defaultCatalogsForSavedConnection(saved)
  databaseConnections.push(saved)

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
  const connectionIndex = databaseConnections.findIndex((connection) => connection.id === trim(input.connectionId))
  const connection = connectionIndex >= 0 ? databaseConnections[connectionIndex] : null
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (connection.dbType !== 'mysql' && connection.dbType !== 'postgresql') {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_UNSUPPORTED', errorMessage: 'Create Database is only available for MySQL and PostgreSQL connections.' }
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

  const catalog = createDatabaseCatalogForConnection(connection, name)
  const saved: DatabaseConnectionInfo = {
    ...connection,
    catalogs: [...connection.catalogs.map((item) => cloneDatabaseCatalog(connection.id, item)), catalog]
  }
  databaseConnections[connectionIndex] = saved

  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogFor(saved.id),
      connection: cloneDatabaseConnection(saved),
      catalog: cloneDatabaseCatalog(saved.id, catalog),
      message: 'Database created in workspace catalog'
    }
  }
}

export async function executeDatabaseSql(input: DatabaseSqlExecuteInput): Promise<DatabaseSqlExecuteResult> {
  const startedAt = Date.now()
  const sql = normalizeSql(input.sql || '')
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!sql) {
    return { ok: false, errorCode: 'DB_SQL_EMPTY', errorMessage: 'SQL is required.' }
  }
  if (/drop\s+database|syntax_error/i.test(sql)) {
    return { ok: false, errorCode: 'DB_SQL_REJECTED', errorMessage: 'Backend SQL executor rejected this statement.' }
  }

  const explained = /^explain\b/i.test(sql)
  const rows = explained
    ? [
        { step: 1, operation: 'Seq Scan', relation: tableNameFromSql(sql) || 'derived', cost: '0.00..12.40', rows: 4 },
        { step: 2, operation: 'Limit', relation: 'result', cost: '0.00..1.00', rows: 1 }
      ]
    : (findRowsForSql(input, sql) ?? fallbackRowsForSql(sql))

  return {
    ok: true,
    data: {
      columns: columnsForRows(rows),
      rows,
      rowCount: rows.length,
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

export async function getDatabaseTableDdl(input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> {
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const key = tableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const entry = tableDdlEntries[key]
  if (!entry?.ddl.trim()) {
    return { ok: false, errorCode: 'other', errorMessage: 'DDL is empty.' }
  }
  if (entry.error) {
    return { ok: false, errorCode: entry.error.code, errorMessage: entry.error.message }
  }
  return { ok: true, data: { ddl: entry.ddl } }
}

export async function queryDatabaseTable(input: DatabaseTableQueryInput): Promise<DatabaseTableQueryResult> {
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

  const tableKey = tableKeyForContext(input)
  if (!tableKey) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const sourceRows = tableRows[tableKey].map((row) => ({ ...row }))

  const knownColumns = tableColumns[tableKey]?.slice() ?? columnsForRows(sourceRows)
  const filters = [...parseWhereRaw(input.whereRaw), ...(input.filters ?? [])]
  const filteredRows = filterRows(sourceRows, filters)
  const sort = input.sort ?? parseOrderByRaw(input.orderByRaw, knownColumns)
  const rows = sortRows(filteredRows, sort)
  const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(input.pageSize) || 100)))
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const start = (page - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize).map((row) => ({ ...row }))

  return {
    ok: true,
    data: {
      columns: knownColumns,
      rows: pageRows,
      rowCount: pageRows.length,
      durationMs: Math.max(1, Date.now() - startedAt),
      total: input.withTotal ? rows.length : null,
      knownColumns
    }
  }
}

export async function mutateDatabaseTable(input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> {
  const startedAt = Date.now()
  const key = tableKeyForContext(input)
  if (!key) {
    return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  }
  const rows = tableRows[key]
  let affected = 0

  input.mutations.forEach((mutation) => {
    if (mutation.kind === 'drop') {
      affected += rows.length
      delete tableRows[key]
      delete tableColumns[key]
      delete tableDdlEntries[key]
      return
    }
    if (mutation.kind === 'truncate') {
      affected += rows.length
      rows.splice(0, rows.length)
      return
    }
    if (mutation.kind === 'insert') {
      rows.push({ ...mutation.values })
      affected += 1
      return
    }

    const index = rows.findIndex((row, rowIndex) => rowKeyFor(row, mutation.primaryKey, rowIndex) === mutation.rowKey)
    if (index < 0) return

    if (mutation.kind === 'delete') {
      rows.splice(index, 1)
      affected += 1
      return
    }

    rows[index] = { ...rows[index], ...mutation.patch }
    affected += 1
  })

  return {
    ok: true,
    data: {
      affected,
      durationMs: Math.max(1, Date.now() - startedAt),
      catalog: databaseWorkspaceCatalogFor(input.connectionId)
    }
  }
}

export async function createDatabaseAiPaneRequest(input: DatabaseAiPaneRequestInput): Promise<DatabaseAiPaneRequestResult> {
  const startedAt = Date.now()
  const prompt = trim(input.prompt)
  if (!prompt) return { ok: false, errorCode: 'DB_AI_PROMPT_REQUIRED', errorMessage: 'Prompt is required.' }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.context.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  const requestId = `dbai-pane-request-${randomUUID()}`
  const contextSummary =
    trim(input.context.contextSummary) ||
    [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')
  const userCreatedAt = startedAt
  const userMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord({
      requestId,
      role: 'user',
      status: 'done',
      content: prompt,
      contextSummary,
      createdAt: userCreatedAt
    })
  )
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord({
      requestId,
      role: 'assistant',
      status: 'queued',
      content: '',
      contextSummary,
      createdAt: userCreatedAt + 1
    })
  )
  return {
    ok: true,
    data: {
      requestId,
      userMessage,
      assistantMessage
    }
  }
}

export function startDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'cancelled' || existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, { status: 'streaming' })
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export function cancelDatabaseAiPaneResponse(input: DatabaseAiPaneLifecycleInput): DatabaseAiPaneLifecycleResult {
  const existing = findDatabaseAiPaneAssistantMessage(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
  if (existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
  const assistantMessage = updateDatabaseAiPaneAssistantMessage(input, {
    status: 'cancelled',
    content: existing.content || 'Response cancelled before the first chunk.'
  })
  return assistantMessage ? { ok: true, data: { assistantMessage } } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
}

export async function generateDatabaseAiPaneResponse(input: DatabaseAiPaneResponseInput): Promise<DatabaseAiPaneResponseResult> {
  const startedAt = Date.now()
  const prompt = trim(input.prompt)
  if (!prompt) return databaseAiPaneErrorResponse(input, startedAt, 'DB_AI_PROMPT_REQUIRED', 'Prompt is required.')
  if (!trim(input.context.connectionId)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }
  if (!trim(input.context.databaseName)) {
    return databaseAiPaneErrorResponse(input, startedAt, 'DB_DATABASE_REQUIRED', 'Database name is required.')
  }

  const promptLower = prompt.toLowerCase()
  const contextLine = databaseAiPaneContextSummary(input)
  const recentTurns = (input.messages || []).filter((message) => message.role === 'user').slice(-4).length
  const selectSql = sampleSelectForContext(input)
  const lines = [`Context: ${contextLine}`, '当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。', `Recent user turns: ${recentTurns}`]

  if (promptLower.includes('explain') || promptLower.includes('解释')) {
    lines.push(
      '',
      'I read the active SQL editor and current database context.',
      'Execution notes:',
      '- Keep the query read-only before running it from the workbench.',
      '- Verify WHERE clauses before widening result sets.',
      '- Check indexes on join/filter columns if latency grows.',
      '',
      'Suggested next SQL:',
      '```sql',
      selectSql,
      '```'
    )
  } else if (promptLower.includes('schema') || promptLower.includes('table') || promptLower.includes('表')) {
    lines.push('', 'Schema summary:', ...schemaSummaryForContext(input), '', 'Recommended starting point:', '```sql', selectSql, '```')
  } else if (promptLower.includes('select') || promptLower.includes('query') || promptLower.includes('sql')) {
    const key = firstTableKeyForContext({
      connectionId: input.context.connectionId,
      databaseName: input.context.databaseName,
      schemaName: input.context.schemaName || ''
    })
    const tableName = key ? keyParts(key).tableName : ''
    lines.push('', `Generated a conservative read-only query${tableName ? ` for ${tableName}` : ''}.`, '', '```sql', selectSql, '```')
  } else {
    lines.push(
      '',
      'I can help inspect schema metadata, draft read-only SQL, explain editor SQL, and suggest optimization checks in this database workspace.',
      '',
      '```sql',
      selectSql,
      '```'
    )
  }

  const elapsedMs = Date.now() - startedAt
  if (elapsedMs < DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const requestId = input.requestId || `dbai-pane-request-${randomUUID()}`
  const text = lines.join('\n')
  const existing = findDatabaseAiPaneAssistantMessage({ requestId, assistantMessageId: input.assistantMessageId })
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        requestId,
        assistantMessage: existing,
        text: existing.content,
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  }
  const assistantMessage = storeDatabaseAiPaneMessage(
    databaseAiPaneMessageRecord(
      {
        requestId,
        role: 'assistant',
        status: 'done',
        content: text,
        contextSummary: contextLine,
        createdAt: existing?.createdAt ?? startedAt
      },
      input.assistantMessageId || existing?.id || `dbai-pane-message-${randomUUID()}`
    )
  )
  assistantMessage.updatedAt = Date.now()
  databaseAiPaneMessages.set(assistantMessage.id, cloneDatabaseAiPaneMessageRecord(assistantMessage))
  return {
    ok: true,
    data: {
      requestId,
      assistantMessage,
      text,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}

export async function createDatabaseAiDrawerRequest(input: DatabaseAiDrawerRequestInput): Promise<DatabaseAiDrawerRequestResult> {
  const now = Date.now()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return { ok: false, errorCode: 'DB_AI_ACTION_INVALID', errorMessage: 'DB AI action is not supported.' }
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return { ok: false, errorCode: 'DB_AI_SQL_REQUIRED', errorMessage: 'SQL is required.' }
  }
  if (!trim(input.context.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }

  const request: DatabaseAiDrawerRequestRecord = {
    id: `dbai-drawer-request-${randomUUID()}`,
    action,
    label: databaseAiDrawerActionName(action),
    status: 'queued',
    contextSummary: trim(input.context.contextSummary),
    sourceSql: input.sourceSql,
    text: '',
    targetDialect: drawerTargetDialect(input),
    backendContext: {
      connectionId: trim(input.context.connectionId),
      dbType: input.context.dbType || '',
      databaseName: trim(input.context.databaseName),
      schemaName: trim(input.context.schemaName) || undefined,
      tableName: trim(input.context.tableName) || undefined,
      contextSummary: trim(input.context.contextSummary) || undefined
    },
    createdAt: now,
    updatedAt: now
  }
  return { ok: true, data: storeDatabaseAiDrawerRequest(request) }
}

export function startDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'cancelled') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'streaming', text: '' })
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export function cancelDatabaseAiDrawerResponse(input: DatabaseAiDrawerLifecycleInput): DatabaseAiDrawerLifecycleResult {
  const existing = findDatabaseAiDrawerRequest(input)
  if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
  if (existing.status === 'done' || existing.status === 'error') return { ok: true, data: existing }
  const request = updateDatabaseAiDrawerRequest(input, { status: 'cancelled' })
  return request ? { ok: true, data: request } : { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
}

export async function generateDatabaseAiDrawerResponse(input: DatabaseAiDrawerResponseInput): Promise<DatabaseAiDrawerResponseResult> {
  const startedAt = Date.now()
  const action = input.action
  const validActions: DatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
  if (!validActions.includes(action)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_ACTION_INVALID', 'DB AI action is not supported.')
  }
  if (action !== 'nl2sql' && action !== 'complete' && action !== 'diagnose' && !trim(input.sourceSql)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_AI_SQL_REQUIRED', 'SQL is required.')
  }
  if (!trim(input.context.connectionId)) {
    return databaseAiDrawerErrorResponse(input, startedAt, 'DB_CONNECTION_REQUIRED', 'Database connection is required.')
  }

  const dialect = drawerTargetDialect(input)
  const generatedSql = buildDrawerGeneratedSql(input, dialect)
  const reasoning = buildDrawerReasoning(input, generatedSql, dialect)
  const requestId = trim(input.requestId)
  const elapsedMs = Date.now() - startedAt
  if (elapsedMs < DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS) {
    await wait(DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  const existing = requestId ? findDatabaseAiDrawerRequest({ requestId }) : null
  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      data: {
        request: existing,
        text: existing.text,
        reasoning: '',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    }
  }

  const text = composeDrawerResponseText(reasoning, generatedSql)
  const request =
    existing && requestId
      ? updateDatabaseAiDrawerRequest({ requestId }, { status: 'done', text, targetDialect: dialect })
      : storeDatabaseAiDrawerRequest({
          id: requestId || `dbai-drawer-request-${randomUUID()}`,
          action,
          label: databaseAiDrawerActionName(action),
          status: 'done',
          contextSummary: trim(input.context.contextSummary),
          sourceSql: input.sourceSql,
          text,
          targetDialect: dialect,
          backendContext: {
            connectionId: trim(input.context.connectionId),
            dbType: input.context.dbType || '',
            databaseName: trim(input.context.databaseName),
            schemaName: trim(input.context.schemaName) || undefined,
            tableName: trim(input.context.tableName) || undefined,
            contextSummary: trim(input.context.contextSummary) || undefined
          },
          createdAt: startedAt,
          updatedAt: Date.now()
        })

  if (!request) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }

  return {
    ok: true,
    data: {
      request,
      text,
      reasoning,
      sql: generatedSql,
      provider: 'aiopsterm-local',
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}
