import type { DataEditSummary, DbFilter } from '@/services/database/databaseGridRuntime'
import type { DbAiAction } from '@/services/database/databaseBackendGuards'
import type { SqlHistory, SqlResult, WorkspaceTab } from '@/services/database/databaseWorkspaceTypes'
import type { TextRange } from '@/services/database/databaseSqlEditorRuntime'

export type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>
export type DataTab = Extract<WorkspaceTab, { kind: 'data' }>
export type DbAiToolbarAction = Extract<DbAiAction, 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete'>

export type DatabaseMainWorkspaceApi = {
  getText(): string
  getSelectedText(): string
  getTextUntilCursor(): string
  getCurrentStatement(): string
  getCurrentStatementRange(): TextRange
  getCursorOffset(): number
  getSelectionRange(): TextRange
  setSelectionRange(start: number, end?: number): void
  replaceAll(next: string): void
  replaceSelection(next: string): void
  replaceRange(next: string, range: TextRange): void
  insertAtCursor(next: string): void
  focus(): void
  focusSqlFindInput(target: 'query' | 'replace'): void
  scrollActiveWorkspaceTabIntoView(tabId: string): void
}

export type DatabaseSqlWorkspaceApi = Omit<DatabaseMainWorkspaceApi, 'scrollActiveWorkspaceTabIntoView'>

export type DatabaseWorkspaceTabsApi = {
  scrollActiveWorkspaceTabIntoView(tabId: string): void
}

export type DatabaseTablePresenterRules = {
  canEditDataTab: (tab: DataTab) => boolean
  isDataTabDirty: (tab: DataTab) => boolean
  dataEditDisabledReason: (tab: DataTab) => string
}

export type DatabaseSqlHistoryRules = {
  isSqlHistoryClosed: (history: SqlHistory) => boolean
}

export type DatabaseSqlResultPayload = {
  result: SqlResult
  rows: Array<Record<string, unknown>>
  filteredRows: Array<Record<string, unknown>>
  editSummary: DataEditSummary | null
  filter: DbFilter | null
}
