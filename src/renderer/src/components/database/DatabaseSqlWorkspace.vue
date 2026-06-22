<template>
  <section class="db-sql-workspace">
    <div class="db-sql-toolbar">
      <button
        type="button"
        class="db-sql-toolbar-btn db-sql-toolbar-run"
        title="Run all"
        :disabled="!activeSqlCanRun"
        @click="emit('runSql', 'all')"
      >
        <Play />
      </button>
      <button
        type="button"
        class="db-sql-toolbar-btn db-sql-toolbar-run-current"
        title="Run current statement"
        :disabled="!activeSqlCanRun"
        @click="emit('runSql', 'current')"
      >
        <CornerDownRight />
      </button>
      <button
        type="button"
        class="db-sql-toolbar-btn db-sql-toolbar-explain"
        title="Explain"
        :disabled="!activeSqlCanRun"
        @click="emit('runSql', 'explain')"
      >
        <Lightbulb />
      </button>
      <span class="db-toolbar-divider" />
      <button
        type="button"
        class="db-sql-toolbar-btn db-sql-toolbar-save"
        :disabled="!activeSqlTab || activeSqlSaving"
        :title="activeSqlSaveTitle"
        @click="emit('saveActiveSql', false)"
      >
        <Save />
      </button>
      <button
        type="button"
        class="db-sql-toolbar-btn db-sql-toolbar-save-as"
        :disabled="!activeSqlTab || activeSqlSaving"
        title="Save As"
        @click="emit('saveActiveSql', true)"
      >
        <SaveAll />
      </button>
      <button
        type="button"
        class="db-sql-toolbar-btn db-sql-toolbar-format"
        :disabled="!activeSqlTab.connectionId"
        title="Format"
        @click="emit('formatSql')"
      >
        <AlignLeft />
      </button>
      <span class="db-toolbar-divider" />
      <span class="db-ai-toolbar">
        <button
          type="button"
          title="AI Explain SQL"
          :disabled="!activeSqlHasText"
          @click="emit('openDbAiFromToolbar', 'explain')"
        >
          <BrainCircuit />
        </button>
        <button
          type="button"
          title="AI Optimize SQL"
          :disabled="!activeSqlHasText"
          @click="emit('openDbAiFromToolbar', 'optimize')"
        >
          <WandSparkles />
        </button>
        <button
          type="button"
          title="AI Convert SQL"
          :disabled="!activeSqlHasText"
          @click="emit('openDbAiFromToolbar', 'convert')"
        >
          <Languages />
        </button>
        <button
          type="button"
          title="AI Complete SQL"
          :disabled="!activeSqlTab"
          @click="emit('openDbAiFromToolbar', 'complete')"
        >
          <TextCursorInput />
        </button>
        <button
          type="button"
          title="AI NL2SQL"
          :disabled="!activeSqlTab"
          @click="emit('openDbAiFromToolbar', 'nl2sql')"
        >
          <FileSearch />
        </button>
      </span>
      <span class="db-toolbar-spacer" />
      <select
        class="db-picker db-picker--connection"
        :value="activeSqlTab.connectionId"
        :disabled="connections.length === 0"
        @change="emit('updateSqlTabConnection', $event)"
      >
        <option
          value=""
          disabled
        >
          Connection
        </option>
        <option
          v-for="connection in connections"
          :key="connection.id"
          :value="connection.id"
        >
          {{ connection.name }}{{ connection.status === 'testing' ? ' [connecting...]' : '' }}
        </option>
      </select>
      <select
        class="db-picker db-picker--database"
        :value="activeSqlTab.catalogName"
        :disabled="currentSqlCatalogs.length === 0"
        @change="emit('updateSqlTabCatalog', $event)"
      >
        <option
          value=""
          disabled
        >
          Database
        </option>
        <option
          v-for="catalog in currentSqlCatalogs"
          :key="catalog.name"
          :value="catalog.name"
        >
          {{ catalog.name }}
        </option>
      </select>
      <select
        v-if="activeSqlRequiresSchema"
        class="db-picker db-picker--schema"
        :value="activeSqlTab.schemaName"
        :disabled="currentSqlSchemas.length === 0"
        @change="emit('updateSqlTabSchema', $event)"
      >
        <option
          value=""
          disabled
        >
          Schema
        </option>
        <option
          v-for="schema in currentSqlSchemas"
          :key="schema.name"
          :value="schema.name"
        >
          {{ schema.name }}
        </option>
      </select>
    </div>
    <div
      class="db-sql-panes"
      :class="{ resizing: sqlPaneResizing }"
      :style="sqlPaneStyle"
    >
      <div
        class="db-sql-editor-shell"
        @click="focusSqlEditor"
      >
        <div
          class="db-sql-editor-gutter"
          :style="{ transform: `translateY(-${sqlEditorScrollTop}px)` }"
          aria-hidden="true"
        >
          <span
            v-for="line in activeSqlEditorLines"
            :key="line"
            :class="{ active: line === sqlEditorActiveLine }"
          >
            {{ line }}
          </span>
        </div>
        <div class="db-sql-editor-surface">
          <div
            class="db-sql-editor-active-line"
            :style="{ transform: `translateY(${sqlEditorActiveLineTop}px)` }"
            aria-hidden="true"
          />
          <DatabaseSqlEditor
            ref="sqlEditorRef"
            v-model="activeSqlText"
            @metrics="emit('syncSqlEditorState', $event)"
            @run="emit('runSqlFromShortcut')"
            @open-find="emit('openSqlFind', $event)"
          />
        </div>
        <div
          v-if="sqlFindOpen"
          class="db-sql-find-panel"
          @click.stop
        >
          <div class="db-sql-find-row">
            <Search />
            <input
              ref="sqlFindInputRef"
              :value="sqlFindQuery"
              aria-label="Find in SQL"
              placeholder="Find"
              @input="emit('update:sqlFindQuery', ($event.target as HTMLInputElement).value)"
              @keydown="(event) => emit('handleSqlFindKeydown', event, 'query')"
            />
            <span class="db-sql-find-count">{{ sqlFindSummary }}</span>
            <button
              type="button"
              title="Previous match"
              :disabled="sqlFindMatches.length === 0"
              @click="emit('goToSqlFindMatch', -1)"
            >
              ↑
            </button>
            <button
              type="button"
              title="Next match"
              :disabled="sqlFindMatches.length === 0"
              @click="emit('goToSqlFindMatch', 1)"
            >
              ↓
            </button>
            <button
              type="button"
              title="Toggle replace"
              :class="{ active: sqlFindReplaceOpen }"
              @click="emit('toggleSqlFindReplace')"
            >
              Replace
            </button>
            <button
              type="button"
              title="Match case"
              :class="{ active: sqlFindCaseSensitive }"
              @click="emit('update:sqlFindCaseSensitive', !sqlFindCaseSensitive)"
            >
              Aa
            </button>
            <button
              type="button"
              title="Close find"
              @click="emit('closeSqlFind', true)"
            >
              <X />
            </button>
          </div>
          <div
            v-if="sqlFindReplaceOpen"
            class="db-sql-find-row replace"
          >
            <span />
            <input
              ref="sqlReplaceInputRef"
              :value="sqlFindReplace"
              aria-label="Replace in SQL"
              placeholder="Replace"
              @input="emit('update:sqlFindReplace', ($event.target as HTMLInputElement).value)"
              @keydown="(event) => emit('handleSqlFindKeydown', event, 'replace')"
            />
            <button
              type="button"
              title="Replace current"
              :disabled="sqlFindMatches.length === 0"
              @click="emit('replaceCurrentSqlFindMatch')"
            >
              Replace
            </button>
            <button
              type="button"
              title="Replace all"
              :disabled="sqlFindMatches.length === 0"
              @click="emit('replaceAllSqlFindMatches')"
            >
              All
            </button>
          </div>
        </div>
        <footer class="db-sql-editor-footer">
          <span
            v-if="activeSqlTab"
            class="db-sql-save-state"
            :class="{ dirty: activeSqlIsDirty, saving: activeSqlSaving, error: Boolean(activeSqlTab.saveError) }"
            :title="activeSqlTab.filePath || activeSqlTab.saveError || undefined"
          >
            {{ activeSqlSaveStateText }}
          </span>
          <span>{{ activeSqlEditorLineCount }} lines</span>
          <span>Ln {{ sqlEditorActiveLine }}, Col {{ sqlEditorActiveColumn }}</span>
          <span v-if="sqlEditorSelectionSize">{{ sqlEditorSelectionSize }} selected</span>
        </footer>
      </div>
      <button
        type="button"
        class="db-sql-splitter"
        title="Resize SQL editor and results"
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
      <div class="db-sql-results">
        <div
          class="db-result-tabs"
          role="tablist"
        >
          <div
            role="tab"
            tabindex="0"
            :aria-selected="activeSqlTab.activeResultTabId === 'overview'"
            :class="{ active: activeSqlTab.activeResultTabId === 'overview' }"
            @click="emit('updateSqlResultActiveTab', 'overview')"
            @keydown.enter.prevent="emit('updateSqlResultActiveTab', 'overview')"
            @keydown.space.prevent="emit('updateSqlResultActiveTab', 'overview')"
          >
            Overview
          </div>
          <div
            v-for="result in activeSqlTab.resultTabs"
            :key="result.id"
            role="tab"
            tabindex="0"
            :aria-selected="activeSqlTab.activeResultTabId === result.id"
            :title="result.title"
            :class="{ active: activeSqlTab.activeResultTabId === result.id }"
            @click="emit('updateSqlResultActiveTab', result.id)"
            @keydown.enter.prevent="emit('updateSqlResultActiveTab', result.id)"
            @keydown.space.prevent="emit('updateSqlResultActiveTab', result.id)"
          >
            <span
              class="db-result-dot"
              :class="result.status"
            />
            <span class="db-result-tab-title">
              {{ result.title }}
            </span>
            <button
              type="button"
              class="db-result-tab-close"
              aria-label="Close result tab"
              @click.stop="emit('closeResultTab', result.id)"
            >
              <X />
            </button>
          </div>
        </div>

        <div
          v-if="activeSqlTab.activeResultTabId === 'overview'"
          class="db-sql-overview"
        >
          <p v-if="!activeSqlTab.history.length">Run SQL to create a result tab.</p>
          <table v-else>
            <thead>
              <tr>
                <th>SQL</th>
                <th>Message</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="history in activeSqlTab.history"
                :key="history.id"
                :class="{ closed: isSqlHistoryClosed(history), error: history.status === 'error' }"
                :data-execution-id="history.id"
                :title="history.createdAt"
                @click="emit('openSqlHistoryResult', history)"
              >
                <td>
                  <span
                    class="db-result-dot"
                    :class="history.status"
                  />
                  <code>{{ history.sql }}</code>
                </td>
                <td>
                  <strong :class="history.status">{{ history.message }}</strong>
                </td>
                <td>{{ history.durationMs }}ms</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-else-if="activeSqlResult">
          <div
            v-if="activeSqlResult.status === 'running'"
            class="db-result-running"
          >
            <span
              class="db-result-dot running"
              aria-hidden="true"
            />
            <div>
              <strong>Running query</strong>
              <small>{{ activeSqlResult.title }}</small>
              <p>{{ activeSqlResult.sql }}</p>
            </div>
          </div>
          <div
            v-else-if="activeSqlResult.status === 'error'"
            class="db-result-error"
          >
            <span class="db-result-error-text">{{ activeSqlResult.error }}</span>
            <span
              v-if="sqlDiagnose.success && sqlDiagnose.resultId === activeSqlResult.id"
              class="db-result-diagnose-success"
            >
              Diagnosed and replaced editor SQL
            </span>
            <span
              v-if="sqlDiagnose.error && sqlDiagnose.resultId === activeSqlResult.id"
              class="db-result-diagnose-error"
            >
              {{ sqlDiagnose.error }}
            </span>
            <button
              type="button"
              class="db-result-diagnose-btn"
              :class="{ loading: sqlDiagnose.running && sqlDiagnose.resultId === activeSqlResult.id }"
              :disabled="sqlDiagnose.running && sqlDiagnose.resultId === activeSqlResult.id"
              @click="emit('diagnoseSqlError', activeSqlResult)"
            >
              <span
                v-if="sqlDiagnose.running && sqlDiagnose.resultId === activeSqlResult.id"
                class="db-result-diagnose-spinner"
                aria-hidden="true"
              />
              <span v-else>Diagnose</span>
            </button>
          </div>
          <template v-else>
            <DataGridToolbar
              :page="activeSqlResultViewState.page"
              :page-size="activeSqlResultViewState.pageSize"
              :total="filteredSqlRows.length"
              :hide-refresh="true"
              :can-export="activeSqlResult.status === 'ok' && pagedSqlRows.length > 0"
              export-title="Export current SQL result page"
              :can-chart="activeSqlResult.status === 'ok' && pagedSqlRows.length > 0"
              chart-title="Chart current SQL result page"
              :can-comment="activeSqlResult.status === 'ok'"
              comment-title="Comment current SQL result"
              @goto-page="emit('updateSqlResultPage', $event)"
              @goto-last-page="emit('gotoLastSqlResultPage')"
              @change-page-size="emit('updateSqlResultPageSize', $event)"
              @export="emit('exportActiveSqlResultPage')"
              @chart="emit('openActiveSqlResultChart')"
              @comment="emit('openActiveSqlResultComment')"
            />
            <ResultGrid
              class="db-sql-result-grid"
              :columns="activeSqlResult.columns"
              :rows="pagedSqlRows"
              :source-rows="activeSqlResult.rows"
              :sort="activeSqlResultViewState.sort"
              :filters="activeSqlResultViewState.filters"
              :start-row-index="(activeSqlResultViewState.page - 1) * activeSqlResultViewState.pageSize + 1"
              @sort="emit('cycleSqlSort', $event)"
              @filter="(column, filter) => emit('applySqlFilter', column, filter)"
            />
          </template>
          <DataStatusBar
            :status="activeSqlResult.status"
            :error="activeSqlResult.error || undefined"
            :message="activeSqlResult.message"
            :duration-ms="activeSqlResult.durationMs"
            :row-count="activeSqlResult.rowCount"
          />
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, type StyleValue } from 'vue'
import {
  AlignLeft,
  BrainCircuit,
  CornerDownRight,
  FileSearch,
  Languages,
  Lightbulb,
  Play,
  Save,
  SaveAll,
  Search,
  TextCursorInput,
  WandSparkles,
  X
} from 'lucide-vue-next'
import DataGridToolbar from '@/components/database/DataGridToolbar.vue'
import DataStatusBar from '@/components/database/DataStatusBar.vue'
import DatabaseSqlEditor, { type DatabaseSqlEditorMetrics } from '@/components/database/DatabaseSqlEditor.vue'
import ResultGrid from '@/components/database/ResultGrid.vue'
import type {
  DatabaseSqlHistoryRules,
  DatabaseSqlWorkspaceApi,
  DbAiToolbarAction,
  SqlTab
} from '@/components/database/databaseMainWorkspaceTypes'
import type { DbFilter } from '@/services/databaseGridRuntime'
import type { SqlHistory, SqlResult, SqlResultViewState } from '@/services/databaseWorkspaceTypes'
import type { TextRange } from '@/services/databaseSqlEditorRuntime'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'

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

const sqlEditorRef = ref<DatabaseSqlWorkspaceApi | null>(null)
const sqlFindInputRef = ref<HTMLInputElement | null>(null)
const sqlReplaceInputRef = ref<HTMLInputElement | null>(null)

const activeSqlText = computed({
  get() {
    return props.activeSqlTab.sql
  },
  set(value: string) {
    emit('updateActiveSql', value)
  }
})

function focusSqlEditor(event?: MouseEvent) {
  if (event?.target instanceof HTMLTextAreaElement || event?.target instanceof HTMLInputElement || event?.target instanceof HTMLButtonElement) return
  sqlEditorRef.value?.focus()
}

function focusSqlFindInput(target: 'query' | 'replace') {
  void nextTick(() => {
    const input = target === 'replace' ? sqlReplaceInputRef.value : sqlFindInputRef.value
    input?.focus()
    input?.select()
  })
}

function fallbackRange(): TextRange {
  const length = props.activeSqlTab.sql.length
  return { start: length, end: length }
}

function getText() {
  return sqlEditorRef.value?.getText() ?? props.activeSqlTab.sql
}

function getSelectedText() {
  return sqlEditorRef.value?.getSelectedText() ?? ''
}

function getTextUntilCursor() {
  return sqlEditorRef.value?.getTextUntilCursor() ?? getText().slice(0, getCursorOffset())
}

function getCurrentStatement() {
  return sqlEditorRef.value?.getCurrentStatement() ?? ''
}

function getCurrentStatementRange() {
  return sqlEditorRef.value?.getCurrentStatementRange() ?? fallbackRange()
}

function getCursorOffset() {
  return sqlEditorRef.value?.getCursorOffset() ?? props.activeSqlTab.sql.length
}

function getSelectionRange() {
  return sqlEditorRef.value?.getSelectionRange() ?? fallbackRange()
}

function setSelectionRange(start: number, end?: number) {
  sqlEditorRef.value?.setSelectionRange(start, end)
}

function replaceAll(next: string) {
  sqlEditorRef.value?.replaceAll(next)
}

function replaceSelection(next: string) {
  sqlEditorRef.value?.replaceSelection(next)
}

function replaceRange(next: string, range: TextRange) {
  sqlEditorRef.value?.replaceRange(next, range)
}

function insertAtCursor(next: string) {
  sqlEditorRef.value?.insertAtCursor(next)
}

function focus() {
  sqlEditorRef.value?.focus()
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
