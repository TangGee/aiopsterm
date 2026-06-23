import type {
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabasePageCommentKey
} from '@shared/contracts/database'
import type { DataMutationPlanState, DbFilter, DbSort, DirtyState, EditOp, ResultStatus } from '@/services/database/databaseGridRuntime'

export type SqlResult = {
  id: string
  title: string
  sql: string
  status: ResultStatus
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  error: string | null
  message: string
}

export type SqlExecutionPayload = Omit<SqlResult, 'id' | 'title' | 'sql'>

export type SqlExecutionOutcome = {
  payload: SqlExecutionPayload
  execution: import('@shared/contracts/database').DatabaseSqlExecutionRecord | null
}

export type SqlResultViewState = {
  page: number
  pageSize: number
  filters: DbFilter[]
  sort: DbSort
}

export type DbAiPaneQuickPrompt = 'explainActive' | 'schemaSummary' | 'selectSample'

export type SqlHistory = {
  id: string
  resultTabId: string | null
  title: string
  sql: string
  message: string
  status: Exclude<ResultStatus, 'running'>
  durationMs: number
  rowCount: number
  createdAt: string
}

export type WorkspaceTab =
  | {
      id: string
      kind: 'overview'
      title: string
    }
  | {
      id: string
      kind: 'sql'
      title: string
      connectionId: string
      catalogName: string
      schemaName: string
      tableId?: string
      tableName?: string
      readOnly?: boolean
      sql: string
      filePath?: string
      savedSql: string
      saving: boolean
      saveError: string | null
      resultTabs: SqlResult[]
      activeResultTabId: string
      history: SqlHistory[]
    }
  | {
      id: string
      kind: 'data'
      title: string
      connectionId: string
      catalogName: string
      schemaName?: string
      tableId: string
      tableName: string
      columns: string[]
      sourceRows: Array<Record<string, unknown>>
      rows: Array<Record<string, unknown>>
      primaryKey: string[]
      whereRaw: string
      whereDraft: string
      orderByRaw: string
      orderByDraft: string
      page: number
      pageSize: number
      filters: DbFilter[]
      sort: DbSort
      selectedRowKey: string | null
      loading: boolean
      error: string | null
      total: number | null
      rowCount: number
      knownColumns: string[]
      durationMs: number
      dirtyState: DirtyState
      undoStack: EditOp[]
      mutationPlan: DataMutationPlanState
      saving: boolean
      saveError: string | null
    }

export type ContextMenu =
  | { type: 'group'; groupId: string; label: string; x: number; y: number }
  | { type: 'connection'; connectionId: string; label: string; x: number; y: number }
  | {
      type: 'table'
      connectionId: string
      catalogName: string
      schemaName?: string
      tableId: string
      label: string
      x: number
      y: number
    }

export type ContextMenuPayload =
  | Omit<Extract<ContextMenu, { type: 'group' }>, 'x' | 'y'>
  | Omit<Extract<ContextMenu, { type: 'connection' }>, 'x' | 'y'>
  | Omit<Extract<ContextMenu, { type: 'table' }>, 'x' | 'y'>

export type ContextSubmenu = 'groupConnection' | 'groupMove' | 'connectionMove' | 'tableCopy' | null
export type SqlConsoleContext = { connectionId: string; catalogName: string; schemaName: string }
export type DatabaseOperationConfirmAction = 'deleteGroup' | 'removeConnection'

export type DatabaseConnectionDraft = {
  id: string
  dbType: DatabaseEngineCode
  name: string
  env: DatabaseConnectionInfo['env']
  groupId: string
  host: string
  port: number | null
  authentication: DatabaseConnectionInfo['authentication']
  user: string
  password: string
  database: string
  filePath: string
  readonly: boolean
  sslMode: NonNullable<DatabaseConnectionInfo['sslMode']>
  needProxy: boolean
  proxyName: string
  url: string
}

export type DatabaseCreateDatabaseModalState = {
  open: boolean
  connectionId: string
  dbType: Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'sqlserver' | 'clickhouse'>
  name: string
  sql: string
  userEditedSql: boolean
  lastAppliedTemplate: string
  submitting: boolean
  feedback: string
  feedbackKind: 'info' | 'error'
}

export type DatabaseDdlModalState = {
  open: boolean
  tableName: string
  ddl: string
  connectionId: string
  catalogName: string
  schemaName: string
  tableId: string
  loading: boolean
  error: string
  errorCode: '' | 'permission' | 'other'
}

export type DatabaseChartModalState = {
  open: boolean
  summary: import('@/services/database/databaseWorkspaceRuntime').DatabaseChartSummary | null
  error: string
}

export type DatabaseCommentModalState = {
  open: boolean
  title: string
  scopeLabel: string
  key: DatabasePageCommentKey | null
  draft: string
  updatedAt: number
  loading: boolean
  saving: boolean
  error: string
}

export type DatabaseDangerConfirmState = {
  open: boolean
  action: 'drop' | 'truncate'
  connectionId: string
  catalogName: string
  schemaName: string
  tableId: string
  tableName: string
  sql: string
  confirmText: string
}

export type DatabaseOperationConfirmState = {
  open: boolean
  action: DatabaseOperationConfirmAction | ''
  targetId: string
  title: string
  message: string
  detail: string
  confirmLabel: string
}
