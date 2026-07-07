import type { ModelProviderCheckKey } from './appRuntime'
import type { AiopsMutationResult } from './common'

export type DatabaseEngineCode =
  | 'mysql'
  | 'mariadb'
  | 'oceanbase'
  | 'postgresql'
  | 'kingbase'
  | 'sqlite'
  | 'oracle'
  | 'sqlserver'
  | 'clickhouse'
  | 'presto'

export type DatabaseEngineOptionCode =
  | DatabaseEngineCode
  | 'h2'
  | 'clickhouse'
  | 'dm'
  | 'presto'
  | 'db2'
  | 'oceanbase'
  | 'hive'
  | 'kingbase'
  | 'mongodb'
  | 'timeplus'

export type DatabaseEngineInfo = {
  code: DatabaseEngineOptionCode
  connectionCode?: DatabaseEngineCode
  name: string
  enabled: boolean
  accent: string
}

export type DatabaseColumnInfo = {
  name: string
  type: string
  nullable: boolean
  key?: 'PK' | 'FK'
}

export type DatabaseTableInfo = {
  id: string
  name: string
  columns: DatabaseColumnInfo[]
  primaryKey: string[]
}

export type DatabaseSchemaInfo = {
  name: string
  tables: DatabaseTableInfo[]
  views?: DatabaseTableInfo[]
  functions?: string[]
  procedures?: string[]
}

export type DatabaseCatalogInfo = {
  name: string
  schemas?: DatabaseSchemaInfo[]
  tables?: DatabaseTableInfo[]
}

export type DatabaseConnectionInfo = {
  id: string
  name: string
  dbType: DatabaseEngineCode
  env: 'Development' | 'TEST' | 'Staging' | 'Production'
  groupId: string
  host: string
  port: number | null
  authentication: 'UserAndPassword'
  user: string
  hasPassword?: boolean
  database: string
  filePath?: string
  readonly?: boolean
  sslMode?: '' | 'disable' | 'require' | 'verify-ca' | 'verify-full'
  needProxy?: boolean
  proxyName?: string
  url?: string
  status: 'idle' | 'testing' | 'connected' | 'failed'
  catalogs: DatabaseCatalogInfo[]
}

export type DatabaseGroupInfo = {
  id: string
  name: string
}

export type DatabaseCatalogDefaults = {
  selectedNodeId: string | null
  expandedGroupIds: string[]
  expandedConnectionIds: string[]
  expandedCatalogIds: string[]
  expandedSchemaIds: string[]
  expandedSchemaObjectFolderIds: string[]
}

export type DatabaseWorkspaceCatalog = {
  engines: DatabaseEngineInfo[]
  groups: DatabaseGroupInfo[]
  groupParents: Record<string, string | null>
  connections: DatabaseConnectionInfo[]
  defaults: DatabaseCatalogDefaults
}

export type DatabaseCatalogResult = AiopsMutationResult<DatabaseWorkspaceCatalog>

export type DatabaseConnectionTestInput = {
  dbType: DatabaseEngineCode
  name: string
  host?: string
  port?: number | null
  user?: string
  password?: string
  database?: string
  filePath?: string
  readonly?: boolean
  sslMode?: string
  needProxy?: boolean
  proxyName?: string
  url?: string
}

export type DatabaseConnectionTestResult = AiopsMutationResult<{
  dbType: DatabaseEngineCode
  serverVersion: string
  endpoint: string
  durationMs: number
}>

export type DatabaseConnectionSaveInput = {
  mode: 'create' | 'edit'
  id?: string
  connection: DatabaseConnectionTestInput & {
    env?: DatabaseConnectionInfo['env']
    groupId?: string
    authentication?: DatabaseConnectionInfo['authentication']
  }
}

export type DatabaseConnectionSaveResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connection: DatabaseConnectionInfo
    message: string
  }
>

export type DatabaseGroupCreateInput = {
  name: string
  parentId?: string | null
}

export type DatabaseGroupUpdateInput = {
  id: string
  name?: string
  parentId?: string | null
}

export type DatabaseGroupMutationResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    group: DatabaseGroupInfo
    message: string
  }
>

export type DatabaseGroupDeleteResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    deletedGroupId: string
    message: string
  }
>

export type DatabaseConnectionMoveInput = {
  connectionId: string
  groupId?: string | null
}

export type DatabaseConnectionMutationResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connection: DatabaseConnectionInfo
    message: string
  }
>

export type DatabaseConnectionDeleteResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connectionId: string
    message: string
  }
>

export type DatabaseCreateDatabaseInput = {
  connectionId: string
  sql: string
  requestedName?: string
}

export type DatabaseCreateDatabaseResult = AiopsMutationResult<
  DatabaseWorkspaceCatalog & {
    connection: DatabaseConnectionInfo
    catalog: DatabaseCatalogInfo
    message: string
  }
>

export type DatabaseSqlExecuteInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  sql: string
  databaseName?: string
  schemaName?: string
}

export type DatabaseSqlExecutionRecord = {
  id: string
  status: 'ok' | 'error'
  message: string
  durationMs: number
  rowCount: number
  createdAt: string
}

export type DatabaseSqlExecuteResult = AiopsMutationResult<{
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  truncated?: boolean
  execution: DatabaseSqlExecutionRecord
}> & {
  execution?: DatabaseSqlExecutionRecord
}

export type DatabaseTableDdlInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  databaseName: string
  schemaName?: string
  tableName: string
}

export type DatabaseTableDdlResult = AiopsMutationResult<{
  ddl: string
}>

export type DatabaseColumnFilter =
  | { column: string; operator: 'like' | 'eq' | 'neq'; value?: string; values?: string[] }
  | { column: string; operator: 'in'; values?: string[]; value?: string }
  | { column: string; operator: 'isnull' | 'notnull'; value?: string; values?: string[] }

export type DatabaseColumnSort = { column: string; direction: 'asc' | 'desc' }

export type DatabaseTableQueryInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  databaseName: string
  schemaName?: string
  tableName: string
  filters?: DatabaseColumnFilter[]
  sort?: DatabaseColumnSort | null
  whereRaw?: string | null
  orderByRaw?: string | null
  page: number
  pageSize: number
  withTotal?: boolean
}

export type DatabaseTableQueryResult = AiopsMutationResult<{
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  total: number | null
  knownColumns: string[]
}>

export type DatabaseTableMutation =
  | { kind: 'delete'; rowKey: string; primaryKey: string[]; originalRow?: Record<string, unknown> }
  | { kind: 'update'; rowKey: string; primaryKey: string[]; patch: Record<string, unknown>; originalRow?: Record<string, unknown> }
  | { kind: 'insert'; values: Record<string, unknown> }
  | { kind: 'truncate' }
  | { kind: 'drop' }

export type DatabaseTableMutationInput = {
  connectionId: string
  databaseName: string
  schemaName?: string
  tableName: string
  mutations: DatabaseTableMutation[]
}

export type DatabaseTableMutationResult = AiopsMutationResult<{
  affected: number
  durationMs: number
  catalog?: DatabaseWorkspaceCatalog
}>

export type DatabaseTableMutationPlanInput = DatabaseTableMutationInput & {
  dbType?: DatabaseEngineCode
  columns?: string[]
  knownColumns?: string[]
}

export type DatabaseTableMutationPlanStatement = {
  kind: DatabaseTableMutation['kind']
  sql: string
  params: unknown[]
  preview: string
}

export type DatabaseTableMutationPlanResult = AiopsMutationResult<{
  statements: DatabaseTableMutationPlanStatement[]
  statementCount: number
  preview: string
  warning: string
}>

export type DatabaseExportInput = {
  title: string
  kind: 'sql-result' | 'table-page'
  columns: string[]
  rows: Array<Record<string, unknown>>
  metadata?: {
    connectionName?: string
    databaseName?: string
    schemaName?: string
    tableName?: string
    sql?: string
    page?: number
    pageSize?: number
    total?: number | null
  }
}

export type DatabaseExportResult = AiopsMutationResult<{
  exported: number
  fileName: string
  filePath?: string
  bytes?: number
  canceled?: boolean
  csv?: string
}>

export type DatabasePageCommentScope = 'sql-result' | 'table-page'

export type DatabasePageCommentKey = {
  scope: DatabasePageCommentScope
  connectionId: string
  databaseName: string
  schemaName?: string
  tableName?: string
  resultId?: string
  sql?: string
}

export type DatabasePageCommentRecord = DatabasePageCommentKey & {
  comment: string
  updatedAt: number
}

export type DatabasePageCommentGetResult = AiopsMutationResult<{
  record: DatabasePageCommentRecord
}>

export type DatabasePageCommentSaveInput = {
  key: DatabasePageCommentKey
  comment: string
}

export type DatabasePageCommentSaveResult = AiopsMutationResult<{
  record: DatabasePageCommentRecord
  message: string
}>

export type DatabaseAiPaneMessageInput = {
  role: 'user' | 'assistant'
  content: string
}

export type DatabaseAiPaneMessageRecord = {
  id: string
  requestId: string
  role: 'user' | 'assistant'
  status: 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'
  content: string
  contextSummary: string
  createdAt: number
  updatedAt: number
}

export type DatabaseAiPaneStateContext = {
  connectionId: string
  catalogName: string
  schemaName: string
  dbType: DatabaseEngineCode | ''
}

export type DatabaseAiPaneStateSnapshot = {
  open: boolean
  width: number
  context: DatabaseAiPaneStateContext
  draft: string
  messages: DatabaseAiPaneMessageRecord[]
}

export type DatabaseAiPaneStateResult = AiopsMutationResult<DatabaseAiPaneStateSnapshot>

export type DatabaseAiPaneResponseInput = {
  requestId?: string
  assistantMessageId?: string
  prompt: string
  context: {
    connectionId: string
    dbType?: DatabaseEngineCode | ''
    databaseName: string
    schemaName?: string
    contextSummary?: string
  }
  activeSql?: string
  messages?: DatabaseAiPaneMessageInput[]
}

export type DatabaseAiPaneRequestInput = DatabaseAiPaneResponseInput

export type DatabaseAiPaneRequestResult = AiopsMutationResult<{
  requestId: string
  userMessage: DatabaseAiPaneMessageRecord
  assistantMessage: DatabaseAiPaneMessageRecord
}>

export type DatabaseAiPaneLifecycleInput = {
  requestId: string
  assistantMessageId?: string
}

export type DatabaseAiPaneLifecycleResult = AiopsMutationResult<{
  assistantMessage: DatabaseAiPaneMessageRecord
}>

export type DatabaseAiResponseProvider = 'aiopsterm-local' | ModelProviderCheckKey

export type DatabaseAiPaneResponseResult = AiopsMutationResult<{
  requestId: string
  assistantMessage: DatabaseAiPaneMessageRecord
  text: string
  provider: DatabaseAiResponseProvider
  durationMs: number
}>

export type DatabaseAiDrawerAction = 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete' | 'diagnose' | 'drop' | 'truncate'

export type DatabaseAiTargetDialect = DatabaseEngineCode | 'mssql'

export type DatabaseAiDrawerResponseInput = {
  requestId?: string
  action: DatabaseAiDrawerAction
  sourceSql: string
  targetDialect?: DatabaseAiTargetDialect
  context: {
    connectionId?: string
    dbType?: DatabaseEngineCode | ''
    databaseName?: string
    schemaName?: string
    tableName?: string
    contextSummary?: string
  }
  errorMessage?: string
}

export type DatabaseAiDrawerRequestRecord = {
  id: string
  action: DatabaseAiDrawerAction
  label: string
  status: 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'
  contextSummary: string
  sourceSql: string
  text: string
  targetDialect: DatabaseAiTargetDialect
  backendContext: DatabaseAiDrawerResponseInput['context']
  createdAt: number
  updatedAt: number
}

export type DatabaseAiDrawerRequestInput = DatabaseAiDrawerResponseInput

export type DatabaseAiDrawerRequestResult = AiopsMutationResult<DatabaseAiDrawerRequestRecord>

export type DatabaseAiDrawerLifecycleInput = {
  requestId: string
}

export type DatabaseAiDrawerLifecycleResult = AiopsMutationResult<DatabaseAiDrawerRequestRecord>

export type DatabaseAiDrawerResponseResult = AiopsMutationResult<{
  request: DatabaseAiDrawerRequestRecord
  text: string
  reasoning: string
  sql: string
  provider: DatabaseAiResponseProvider
  durationMs: number
}>

export type DatabaseSqlErrorDiagnosisInput = {
  requestId?: string
  sourceSql: string
  targetDialect?: DatabaseAiTargetDialect
  context: DatabaseAiDrawerResponseInput['context']
  errorMessage: string
}

export type DatabaseSqlErrorDiagnosisResult = DatabaseAiDrawerResponseResult
