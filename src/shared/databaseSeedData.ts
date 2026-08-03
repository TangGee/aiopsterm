import type {
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseGroupInfo
} from './contracts/database'

export const supportedDatabaseEngines: ReadonlySet<DatabaseEngineCode> = new Set<DatabaseEngineCode>([
  'mysql',
  'mariadb',
  'oceanbase',
  'postgresql',
  'kingbase',
  'sqlite',
  'oracle',
  'sqlserver',
  'clickhouse',
  'presto'
])

export const DEFAULT_DATABASE_GROUP_ID = 'group-default'

export const databaseEngineVersions: Record<DatabaseConnectionTestInput['dbType'], string> = {
  mysql: 'MySQL 8 local backend validation',
  mariadb: 'MariaDB local backend validation',
  oceanbase: 'OceanBase MySQL-compatible local backend validation',
  postgresql: 'PostgreSQL 16 local backend validation',
  kingbase: 'KingBase PostgreSQL-compatible local backend validation',
  sqlite: 'SQLite local backend validation',
  oracle: 'Oracle local backend validation',
  sqlserver: 'SQL Server local backend validation',
  clickhouse: 'ClickHouse local backend validation',
  presto: 'Presto local backend validation'
}

export const databaseEngines: DatabaseEngineInfo[] = [
  { code: 'mysql', connectionCode: 'mysql', name: 'MySQL', enabled: true, accent: '#00758f' },
  { code: 'oracle', connectionCode: 'oracle', name: 'Oracle', enabled: true, accent: '#c74634' },
  { code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' },
  { code: 'sqlserver', connectionCode: 'sqlserver', name: 'SQLServer', enabled: true, accent: '#a91d22' },
  { code: 'sqlite', connectionCode: 'sqlite', name: 'SQLite', enabled: true, accent: '#00a1e0' },
  { code: 'mariadb', connectionCode: 'mariadb', name: 'MariaDB', enabled: true, accent: '#c0765c' },
  { code: 'clickhouse', connectionCode: 'clickhouse', name: 'ClickHouse', enabled: true, accent: '#fdd835' },
  { code: 'presto', connectionCode: 'presto', name: 'Presto', enabled: true, accent: '#7c2d12' },
  { code: 'oceanbase', connectionCode: 'oceanbase', name: 'OceanBase', enabled: true, accent: '#0ea5e9' },
  { code: 'kingbase', connectionCode: 'kingbase', name: 'KingBase', enabled: true, accent: '#dc2626' }
]

export const databaseGroupSeed: DatabaseGroupInfo[] = [
  { id: 'group-default', name: 'Default Group' },
  { id: 'group-prod', name: 'Production' },
  { id: 'group-local', name: 'Local Lab' }
]

export const databaseGroupParentSeed: Record<string, string | null> = {
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

export const databaseConnectionSeed: DatabaseConnectionInfo[] = [
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

export const databaseConnectionSeedIds: ReadonlySet<string> = new Set(databaseConnectionSeed.map((connection) => connection.id))

export const databaseSeedQueryRows: Record<string, Array<Record<string, unknown>>> = {
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

export type DatabaseSeedTableDdlEntry = {
  ddl: string
  error?: { code: 'permission' | 'other'; message: string }
}

export const databaseSeedTableDdl: Record<string, DatabaseSeedTableDdlEntry> = {
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
