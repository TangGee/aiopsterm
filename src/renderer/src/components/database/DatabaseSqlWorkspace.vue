<template>
  <section class="db-sql-workspace">
    <DatabaseSqlToolbar
      :active-sql-tab="activeSqlTab"
      :active-sql-can-run="activeSqlCanRun"
      :active-sql-saving="activeSqlSaving"
      :active-sql-save-title="activeSqlSaveTitle"
      :active-sql-has-text="activeSqlHasText"
      :connections="connections"
      :current-sql-catalogs="currentSqlCatalogs"
      :current-sql-schemas="currentSqlSchemas"
      :active-sql-requires-schema="activeSqlRequiresSchema"
      @run-sql="emit('runSql', $event)"
      @save-active-sql="emit('saveActiveSql', $event)"
      @format-sql="emit('formatSql')"
      @open-db-ai-from-toolbar="emit('openDbAiFromToolbar', $event)"
      @update-sql-tab-connection="emit('updateSqlTabConnection', $event)"
      @update-sql-tab-catalog="emit('updateSqlTabCatalog', $event)"
      @update-sql-tab-schema="emit('updateSqlTabSchema', $event)"
    />

    <div
      class="db-sql-panes"
      :class="{ resizing: sqlPaneResizing }"
      :style="sqlPaneStyle"
    >
      <DatabaseSqlEditorPane
        ref="sqlEditorPaneRef"
        v-model:sql-find-query="sqlFindQueryProxy"
        v-model:sql-find-replace="sqlFindReplaceProxy"
        v-model:sql-find-case-sensitive="sqlFindCaseSensitiveProxy"
        :active-sql-tab="activeSqlTab"
        :active-sql-saving="activeSqlSaving"
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
      />

      <button
        type="button"
        class="db-sql-splitter"
        :title="t('database.sql.resizePanes')"
        role="separator"
        aria-orientation="horizontal"
        :aria-valuemin="sqlPaneMinPercent"
        :aria-valuemax="sqlPaneMaxPercent"
        :aria-valuenow="Math.round(sqlPaneEditorPercent)"
        @pointerdown="emit('startSqlPaneResize', $event)"
        @dblclick="emit('resetSqlPaneSplit')"
      >
        <span aria-hidden="true" />
      </button>

      <DatabaseSqlResultsPane
        :active-sql-tab="activeSqlTab"
        :active-sql-result="activeSqlResult"
        :active-sql-result-view-state="activeSqlResultViewState"
        :filtered-sql-rows="filteredSqlRows"
        :paged-sql-rows="pagedSqlRows"
        :sql-diagnose="sqlDiagnose"
        :is-sql-history-closed="isSqlHistoryClosed"
        @update-sql-result-active-tab="emit('updateSqlResultActiveTab', $event)"
        @toggle-result-tab-pinned="emit('toggleResultTabPinned', $event)"
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
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, type StyleValue } from 'vue'
import { useI18n } from '@/i18n'
import DatabaseSqlEditorPane from '@/components/database/DatabaseSqlEditorPane.vue'
import DatabaseSqlResultsPane from '@/components/database/DatabaseSqlResultsPane.vue'
import DatabaseSqlToolbar from '@/components/database/DatabaseSqlToolbar.vue'
import type { DatabaseSqlEditorMetrics } from '@/components/database/DatabaseSqlEditor.vue'
import type {
  DatabaseSqlHistoryRules,
  DatabaseSqlWorkspaceApi,
  DbAiToolbarAction,
  SqlTab
} from '@/components/database/databaseMainWorkspaceTypes'
import type { DbFilter } from '@/services/database/databaseGridRuntime'
import type { SqlHistory, SqlResult, SqlResultViewState } from '@/services/database/databaseWorkspaceTypes'
import type { TextRange } from '@/services/database/databaseSqlEditorRuntime'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'

const { t } = useI18n()

const props = defineProps<{
  activeSqlTab: SqlTab
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
    resultTitle: string
    requestId: string
  }
  isSqlHistoryClosed: DatabaseSqlHistoryRules['isSqlHistoryClosed']
}>()

const emit = defineEmits<{
  'update:sqlFindQuery': [value: string]
  'update:sqlFindReplace': [value: string]
  'update:sqlFindCaseSensitive': [value: boolean]
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
  toggleResultTabPinned: [resultId: string]
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
}>()

const sqlEditorPaneRef = ref<DatabaseSqlWorkspaceApi | null>(null)

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
  const length = props.activeSqlTab.sql.length
  return { start: length, end: length }
}

function getText() {
  return sqlEditorPaneRef.value?.getText() ?? props.activeSqlTab.sql
}

function getSelectedText() {
  return sqlEditorPaneRef.value?.getSelectedText() ?? ''
}

function getTextUntilCursor() {
  return sqlEditorPaneRef.value?.getTextUntilCursor() ?? getText().slice(0, getCursorOffset())
}

function getCurrentStatement() {
  return sqlEditorPaneRef.value?.getCurrentStatement() ?? ''
}

function getCurrentStatementRange() {
  return sqlEditorPaneRef.value?.getCurrentStatementRange() ?? fallbackRange()
}

function getCursorOffset() {
  return sqlEditorPaneRef.value?.getCursorOffset() ?? props.activeSqlTab.sql.length
}

function getSelectionRange() {
  return sqlEditorPaneRef.value?.getSelectionRange() ?? fallbackRange()
}

function setSelectionRange(start: number, end?: number) {
  sqlEditorPaneRef.value?.setSelectionRange(start, end)
}

function replaceAll(next: string) {
  sqlEditorPaneRef.value?.replaceAll(next)
}

function replaceSelection(next: string) {
  sqlEditorPaneRef.value?.replaceSelection(next)
}

function replaceRange(next: string, range: TextRange) {
  sqlEditorPaneRef.value?.replaceRange(next, range)
}

function insertAtCursor(next: string) {
  sqlEditorPaneRef.value?.insertAtCursor(next)
}

function focus() {
  sqlEditorPaneRef.value?.focus()
}

function focusSqlFindInput(target: 'query' | 'replace') {
  sqlEditorPaneRef.value?.focusSqlFindInput(target)
}

defineExpose<DatabaseSqlWorkspaceApi>({
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
  focusSqlFindInput
})
</script>
