<template>
  <main class="db-main">
    <DatabaseWorkspaceTabs
      ref="workspaceTabsRef"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :overflow-open="overflowOpen"
      :db-ai-pane-open="dbAiPaneOpen"
      :can-toggle-db-ai-pane="canToggleDbAiPane"
      @update:active-tab-id="emit('update:activeTabId', $event)"
      @update:overflow-open="emit('update:overflowOpen', $event)"
      @close-tab="emit('closeTab', $event)"
      @open-sql-console="emit('openSqlConsole')"
      @toggle-db-ai-pane="emit('toggleDbAiPane')"
    />

    <DatabaseOverviewPanel
      v-if="activeTab?.kind === 'overview'"
      :database-engines="databaseEngines"
      @toggle-add-menu="emit('toggleAddMenu')"
      @focus-database-search="emit('focusDatabaseSearch')"
      @open-sql-console="emit('openSqlConsole')"
      @open-overview-engine="emit('openOverviewEngine', $event)"
    />

    <DatabaseSqlWorkspace
      v-else-if="activeSqlTab"
      ref="sqlWorkspaceRef"
      v-model:sql-find-query="sqlFindQueryProxy"
      v-model:sql-find-replace="sqlFindReplaceProxy"
      v-model:sql-find-case-sensitive="sqlFindCaseSensitiveProxy"
      :active-sql-tab="activeSqlTab"
      :active-sql-can-run="activeSqlCanRun"
      :active-sql-saving="activeSqlSaving"
      :active-sql-save-title="activeSqlSaveTitle"
      :active-sql-has-text="activeSqlHasText"
      :connections="connections"
      :current-sql-catalogs="currentSqlCatalogs"
      :current-sql-schemas="currentSqlSchemas"
      :active-sql-requires-schema="activeSqlRequiresSchema"
      :sql-pane-resizing="sqlPaneResizing"
      :sql-pane-style="sqlPaneStyle"
      :sql-editor-scroll-top="sqlEditorScrollTop"
      :active-sql-editor-lines="activeSqlEditorLines"
      :sql-editor-active-line="sqlEditorActiveLine"
      :sql-editor-active-line-top="sqlEditorActiveLineTop"
      :sql-find-open="sqlFindOpen"
      :sql-find-summary="sqlFindSummary"
      :sql-find-matches="sqlFindMatches"
      :sql-find-replace-open="sqlFindReplaceOpen"
      :active-sql-is-dirty="activeSqlIsDirty"
      :active-sql-save-state-text="activeSqlSaveStateText"
      :active-sql-editor-line-count="activeSqlEditorLineCount"
      :sql-editor-active-column="sqlEditorActiveColumn"
      :sql-editor-selection-size="sqlEditorSelectionSize"
      :sql-pane-min-percent="sqlPaneMinPercent"
      :sql-pane-max-percent="sqlPaneMaxPercent"
      :sql-pane-editor-percent="sqlPaneEditorPercent"
      :active-sql-result="activeSqlResult"
      :active-sql-result-view-state="activeSqlResultViewState"
      :filtered-sql-rows="filteredSqlRows"
      :paged-sql-rows="pagedSqlRows"
      :sql-diagnose="sqlDiagnose"
      :is-sql-history-closed="isSqlHistoryClosed"
      @run-sql="emit('runSql', $event)"
      @save-active-sql="emit('saveActiveSql', $event)"
      @format-sql="emit('formatSql')"
      @open-db-ai-from-toolbar="emit('openDbAiFromToolbar', $event)"
      @update-sql-tab-connection="emit('updateSqlTabConnection', $event)"
      @update-sql-tab-catalog="emit('updateSqlTabCatalog', $event)"
      @update-sql-tab-schema="emit('updateSqlTabSchema', $event)"
      @update-active-sql="emit('updateActiveSql', $event)"
      @sync-sql-editor-state="emit('syncSqlEditorState', $event)"
      @run-sql-from-shortcut="emit('runSqlFromShortcut')"
      @open-sql-find="emit('openSqlFind', $event)"
      @handle-sql-find-keydown="(event, field) => emit('handleSqlFindKeydown', event, field)"
      @go-to-sql-find-match="emit('goToSqlFindMatch', $event)"
      @toggle-sql-find-replace="emit('toggleSqlFindReplace')"
      @close-sql-find="emit('closeSqlFind', $event)"
      @replace-current-sql-find-match="emit('replaceCurrentSqlFindMatch')"
      @replace-all-sql-find-matches="emit('replaceAllSqlFindMatches')"
      @start-sql-pane-resize="emit('startSqlPaneResize', $event)"
      @reset-sql-pane-split="emit('resetSqlPaneSplit')"
      @update-sql-result-active-tab="emit('updateSqlResultActiveTab', $event)"
      @close-result-tab="emit('closeResultTab', $event)"
      @open-sql-history-result="emit('openSqlHistoryResult', $event)"
      @diagnose-sql-error="emit('diagnoseSqlError', $event)"
      @update-sql-result-page="emit('updateSqlResultPage', $event)"
      @goto-last-sql-result-page="emit('gotoLastSqlResultPage')"
      @update-sql-result-page-size="emit('updateSqlResultPageSize', $event)"
      @export-active-sql-result-page="emit('exportActiveSqlResultPage')"
      @open-active-sql-result-chart="emit('openActiveSqlResultChart')"
      @open-active-sql-result-comment="emit('openActiveSqlResultComment')"
      @cycle-sql-sort="emit('cycleSqlSort', $event)"
      @apply-sql-filter="(column, filter) => emit('applySqlFilter', column, filter)"
    />

    <DatabaseDataWorkspace
      v-else-if="activeDataTab"
      :active-data-tab="activeDataTab"
      :active-data-edit-summary="activeDataEditSummary"
      :active-data-where-pending="activeDataWherePending"
      :paged-data-rows="pagedDataRows"
      :can-edit-data-tab="canEditDataTab"
      :is-data-tab-dirty="isDataTabDirty"
      :data-edit-disabled-reason="dataEditDisabledReason"
      @update-data-page="emit('updateDataPage', $event)"
      @goto-last-data-page="emit('gotoLastDataPage')"
      @update-data-page-size="emit('updateDataPageSize', $event)"
      @refresh-data-total="emit('refreshDataTotal')"
      @refresh-data-tab="emit('refreshDataTab')"
      @add-data-row="emit('addDataRow')"
      @delete-selected-data-row="emit('deleteSelectedDataRow')"
      @undo-data-changes="emit('undoDataChanges')"
      @save-data-changes="emit('saveDataChanges')"
      @export-active-data-page="emit('exportActiveDataPage')"
      @open-active-data-chart="emit('openActiveDataChart')"
      @open-active-data-comment="emit('openActiveDataComment')"
      @update-active-data-where-draft="emit('updateActiveDataWhereDraft', $event)"
      @apply-where="emit('applyWhere')"
      @copy-data-mutation-preview="emit('copyDataMutationPreview')"
      @discard-data-changes="emit('discardDataChanges')"
      @cycle-data-sort="emit('cycleDataSort', $event)"
      @apply-data-filter="(column, filter) => emit('applyDataFilter', column, filter)"
      @set-active-data-selected-row="emit('setActiveDataSelectedRow', $event)"
      @update-data-cell="(rowKey, column, value) => emit('updateDataCell', rowKey, column, value)"
      @update-new-data-row-cell="(rowKey, column, value) => emit('updateNewDataRowCell', rowKey, column, value)"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch, type StyleValue } from 'vue'
import DatabaseDataWorkspace from '@/components/database/DatabaseDataWorkspace.vue'
import DatabaseOverviewPanel from '@/components/database/DatabaseOverviewPanel.vue'
import DatabaseSqlWorkspace from '@/components/database/DatabaseSqlWorkspace.vue'
import DatabaseWorkspaceTabs from '@/components/database/DatabaseWorkspaceTabs.vue'
import type {
  DatabaseMainWorkspaceApi,
  DatabaseSqlWorkspaceApi,
  DatabaseWorkspaceTabsApi,
  DataTab,
  DbAiToolbarAction,
  SqlTab
} from '@/components/database/databaseMainWorkspaceTypes'
import type { DatabaseSqlEditorMetrics } from '@/components/database/DatabaseSqlEditor.vue'
import type { DataEditSummary, DbFilter } from '@/services/databaseGridRuntime'
import type { SqlHistory, SqlResult, SqlResultViewState, WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type { TextRange } from '@/services/databaseSqlEditorRuntime'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo, DatabaseEngineInfo } from '@shared/contracts/database'

const props = defineProps<{
  tabs: WorkspaceTab[]
  activeTab: WorkspaceTab | undefined
  activeTabId: string
  overflowOpen: boolean
  dbAiPaneOpen: boolean
  canToggleDbAiPane: boolean
  databaseEngines: DatabaseEngineInfo[]
  activeSqlTab: SqlTab | null
  activeSqlCanRun: boolean
  activeSqlSaving: boolean
  activeSqlSaveTitle: string
  activeSqlHasText: boolean
  connections: DatabaseConnectionInfo[]
  currentSqlCatalogs: DatabaseCatalogInfo[]
  currentSqlSchemas: NonNullable<DatabaseCatalogInfo['schemas']>
  activeSqlRequiresSchema: boolean
  sqlPaneResizing: boolean
  sqlPaneStyle: StyleValue
  sqlEditorScrollTop: number
  activeSqlEditorLines: number[]
  sqlEditorActiveLine: number
  sqlEditorActiveLineTop: number
  sqlFindOpen: boolean
  sqlFindQuery: string
  sqlFindSummary: string
  sqlFindMatches: TextRange[]
  sqlFindReplaceOpen: boolean
  sqlFindCaseSensitive: boolean
  sqlFindReplace: string
  activeSqlIsDirty: boolean
  activeSqlSaveStateText: string
  activeSqlEditorLineCount: number
  sqlEditorActiveColumn: number
  sqlEditorSelectionSize: number
  sqlPaneMinPercent: number
  sqlPaneMaxPercent: number
  sqlPaneEditorPercent: number
  activeSqlResult: SqlResult | null
  activeSqlResultViewState: SqlResultViewState
  filteredSqlRows: Array<Record<string, unknown>>
  pagedSqlRows: Array<Record<string, unknown>>
  sqlDiagnose: {
    running: boolean
    error: string
    success: boolean
    resultId: string
    requestId: string
  }
  activeDataTab: DataTab | null
  activeDataEditSummary: DataEditSummary | null
  activeDataWherePending: boolean
  pagedDataRows: Array<Record<string, unknown>>
  canEditDataTab: (tab: DataTab) => boolean
  isDataTabDirty: (tab: DataTab) => boolean
  dataEditDisabledReason: (tab: DataTab) => string
  isSqlHistoryClosed: (history: SqlHistory) => boolean
}>()

const emit = defineEmits<{
  'update:activeTabId': [value: string]
  'update:overflowOpen': [value: boolean]
  'update:sqlFindQuery': [value: string]
  'update:sqlFindReplace': [value: string]
  'update:sqlFindCaseSensitive': [value: boolean]
  closeTab: [tabId: string]
  openSqlConsole: []
  toggleDbAiPane: []
  toggleAddMenu: []
  focusDatabaseSearch: []
  openOverviewEngine: [engine: DatabaseEngineInfo]
  runSql: [mode: 'all' | 'current' | 'explain']
  saveActiveSql: [forceSaveAs: boolean]
  formatSql: []
  openDbAiFromToolbar: [action: DbAiToolbarAction]
  updateSqlTabConnection: [event: Event]
  updateSqlTabCatalog: [event: Event]
  updateSqlTabSchema: [event: Event]
  updateActiveSql: [value: string]
  syncSqlEditorState: [metrics?: DatabaseSqlEditorMetrics]
  runSqlFromShortcut: []
  openSqlFind: [replace: boolean]
  handleSqlFindKeydown: [event: KeyboardEvent, field: 'query' | 'replace']
  goToSqlFindMatch: [direction: 1 | -1]
  toggleSqlFindReplace: []
  closeSqlFind: [refocusEditor: boolean]
  replaceCurrentSqlFindMatch: []
  replaceAllSqlFindMatches: []
  startSqlPaneResize: [event: PointerEvent]
  resetSqlPaneSplit: []
  updateSqlResultActiveTab: [resultTabId: string]
  closeResultTab: [resultId: string]
  openSqlHistoryResult: [history: SqlHistory]
  diagnoseSqlError: [result: SqlResult]
  updateSqlResultPage: [page: number]
  gotoLastSqlResultPage: []
  updateSqlResultPageSize: [size: number]
  exportActiveSqlResultPage: []
  openActiveSqlResultChart: []
  openActiveSqlResultComment: []
  cycleSqlSort: [column: string]
  applySqlFilter: [column: string, filter: DbFilter | null]
  updateDataPage: [page: number]
  gotoLastDataPage: []
  updateDataPageSize: [size: number]
  refreshDataTotal: []
  refreshDataTab: []
  addDataRow: []
  deleteSelectedDataRow: []
  undoDataChanges: []
  saveDataChanges: []
  exportActiveDataPage: []
  openActiveDataChart: []
  openActiveDataComment: []
  updateActiveDataWhereDraft: [value: string]
  applyWhere: []
  copyDataMutationPreview: []
  discardDataChanges: []
  cycleDataSort: [column: string]
  applyDataFilter: [column: string, filter: DbFilter | null]
  setActiveDataSelectedRow: [rowKey: string]
  updateDataCell: [rowKey: string, column: string, value: string]
  updateNewDataRowCell: [rowKey: string, column: string, value: string]
}>()

const workspaceTabsRef = ref<DatabaseWorkspaceTabsApi | null>(null)
const sqlWorkspaceRef = ref<DatabaseSqlWorkspaceApi | null>(null)

const sqlFindQueryProxy = computed({
  get: () => props.sqlFindQuery,
  set: (value: string) => emit('update:sqlFindQuery', value)
})

const sqlFindReplaceProxy = computed({
  get: () => props.sqlFindReplace,
  set: (value: string) => emit('update:sqlFindReplace', value)
})

const sqlFindCaseSensitiveProxy = computed({
  get: () => props.sqlFindCaseSensitive,
  set: (value: boolean) => emit('update:sqlFindCaseSensitive', value)
})

function fallbackRange(): TextRange {
  const length = props.activeSqlTab?.sql.length ?? 0
  return { start: length, end: length }
}

function getText() {
  return sqlWorkspaceRef.value?.getText() ?? props.activeSqlTab?.sql ?? ''
}

function getSelectedText() {
  return sqlWorkspaceRef.value?.getSelectedText() ?? ''
}

function getTextUntilCursor() {
  return sqlWorkspaceRef.value?.getTextUntilCursor() ?? getText().slice(0, getCursorOffset())
}

function getCurrentStatement() {
  return sqlWorkspaceRef.value?.getCurrentStatement() ?? ''
}

function getCurrentStatementRange() {
  return sqlWorkspaceRef.value?.getCurrentStatementRange() ?? fallbackRange()
}

function getCursorOffset() {
  return sqlWorkspaceRef.value?.getCursorOffset() ?? props.activeSqlTab?.sql.length ?? 0
}

function getSelectionRange() {
  return sqlWorkspaceRef.value?.getSelectionRange() ?? fallbackRange()
}

function setSelectionRange(start: number, end?: number) {
  sqlWorkspaceRef.value?.setSelectionRange(start, end)
}

function replaceAll(next: string) {
  sqlWorkspaceRef.value?.replaceAll(next)
}

function replaceSelection(next: string) {
  sqlWorkspaceRef.value?.replaceSelection(next)
}

function replaceRange(next: string, range: TextRange) {
  sqlWorkspaceRef.value?.replaceRange(next, range)
}

function insertAtCursor(next: string) {
  sqlWorkspaceRef.value?.insertAtCursor(next)
}

function focus() {
  sqlWorkspaceRef.value?.focus()
}

function focusSqlFindInput(target: 'query' | 'replace') {
  sqlWorkspaceRef.value?.focusSqlFindInput(target)
}

function scrollActiveWorkspaceTabIntoView(tabId: string) {
  workspaceTabsRef.value?.scrollActiveWorkspaceTabIntoView(tabId)
}

watch(
  () => props.activeTabId,
  (tabId) => scrollActiveWorkspaceTabIntoView(tabId)
)

defineExpose<DatabaseMainWorkspaceApi>({
  getText,
  getSelectedText,
  getTextUntilCursor,
  getCurrentStatement,
  getCurrentStatementRange,
  getCursorOffset,
  getSelectionRange,
  setSelectionRange,
  replaceAll,
  replaceSelection,
  replaceRange,
  insertAtCursor,
  focus,
  focusSqlFindInput,
  scrollActiveWorkspaceTabIntoView
})
</script>
