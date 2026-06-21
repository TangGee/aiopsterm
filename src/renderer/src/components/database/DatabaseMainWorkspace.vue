<template>
  <main class="db-main">
    <div class="db-workspace-tabs">
      <div class="db-workspace-tab-scroll">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :ref="(el) => registerWorkspaceTabRef(tab.id, el)"
          class="db-workspace-tab"
          :class="{ active: activeTabId === tab.id }"
          type="button"
          @click="emit('update:activeTabId', tab.id)"
        >
          <LayoutDashboard v-if="tab.kind === 'overview'" />
          <Table2 v-else-if="tab.kind === 'data'" />
          <SquareTerminal v-else />
          <span>{{ tab.title }}</span>
          <button
            v-if="tab.kind !== 'overview'"
            type="button"
            title="Close"
            @click.stop="emit('closeTab', tab.id)"
          >
            <X />
          </button>
        </button>
        <button
          class="db-workspace-add-tab"
          type="button"
          title="New SQL"
          @click="emit('openSqlConsole')"
        >
          <Plus />
        </button>
      </div>
      <div class="db-tab-overflow">
        <button
          type="button"
          class="db-ai-pane-toggle"
          :class="{ active: dbAiPaneOpen }"
          title="Toggle DB AI Pane"
          :disabled="!canToggleDbAiPane"
          @click="emit('toggleDbAiPane')"
        >
          <BrainCircuit />
        </button>
        <button
          type="button"
          title="Tabs"
          @click="emit('update:overflowOpen', !overflowOpen)"
        >
          <MoreHorizontal />
        </button>
        <div
          v-if="overflowOpen"
          class="db-tab-menu"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            @click="selectOverflowTab(tab.id)"
          >
            {{ tab.title }}
          </button>
        </div>
      </div>
    </div>

    <section
      v-if="activeTab?.kind === 'overview'"
      class="db-overview"
    >
      <div class="db-overview-hero">
        <div class="db-overview-header">
          <span class="db-overview-eyebrow">Overview</span>
          <h2>Overview</h2>
          <p>Manage connections, browse schema trees, open table data, and run SQL consoles from the Database workspace.</p>
        </div>
        <div class="db-overview-tips">
          <button
            type="button"
            @click="emit('toggleAddMenu')"
          >
            <strong>+</strong>
            <span>Create connection</span>
          </button>
          <button
            type="button"
            @click="emit('focusDatabaseSearch')"
          >
            <strong>/</strong>
            <span>Explore schemas</span>
          </button>
          <button
            type="button"
            @click="emit('openSqlConsole')"
          >
            <strong>SQL</strong>
            <span>Query console</span>
          </button>
        </div>
      </div>
      <div class="db-overview-panel">
        <header>
          <div>
            <strong>New Connection</strong>
            <p>Choose a database engine to start a connection profile.</p>
          </div>
          <em title="Database engines">{{ databaseEngines.length }}</em>
        </header>
        <div class="db-engine-grid">
          <button
            v-for="engine in databaseEngines"
            :key="`${engine.name}-${engine.code}`"
            type="button"
            :title="`New ${engine.name} connection`"
            @click="emit('openOverviewEngine', engine)"
          >
            <span
              class="db-engine-dot"
              :style="{ background: engine.accent }"
            />
            <span class="db-engine-name">{{ engine.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <section
      v-else-if="activeSqlTab"
      class="db-sql-workspace"
    >
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
              <span
                class="db-result-tab-title"
              >
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

    <section
      v-else-if="activeDataTab"
      class="db-data-workspace"
    >
      <DataGridToolbar
        :page="activeDataTab.page"
        :page-size="activeDataTab.pageSize"
        :total="activeDataTab.total"
        :can-edit="canEditDataTab(activeDataTab)"
        :has-selection="!!activeDataTab.selectedRowKey"
        :can-undo="activeDataTab.undoStack.length > 0"
        :is-dirty="isDataTabDirty(activeDataTab)"
        :edit-disabled-reason="dataEditDisabledReason(activeDataTab)"
        :can-export="!activeDataTab.loading && !activeDataTab.error && pagedDataRows.length > 0"
        export-title="Export current table page"
        :can-chart="!activeDataTab.loading && !activeDataTab.error && pagedDataRows.length > 0"
        chart-title="Chart current table page"
        :can-comment="!activeDataTab.loading && !activeDataTab.error"
        comment-title="Comment current table page"
        @goto-page="emit('updateDataPage', $event)"
        @goto-last-page="emit('gotoLastDataPage')"
        @change-page-size="emit('updateDataPageSize', $event)"
        @refresh-total="emit('refreshDataTotal')"
        @refresh="emit('refreshDataTab')"
        @add-row="emit('addDataRow')"
        @delete-row="emit('deleteSelectedDataRow')"
        @undo="emit('undoDataChanges')"
        @save="emit('saveDataChanges')"
        @export="emit('exportActiveDataPage')"
        @chart="emit('openActiveDataChart')"
        @comment="emit('openActiveDataComment')"
      />
      <div class="db-where-bar">
        <span class="db-where-table"><Table2 /> {{ activeDataTab.tableName }}</span>
        <i />
        <input
          :value="activeDataTab.whereDraft"
          aria-label="WHERE condition"
          :class="{ pending: activeDataWherePending }"
          placeholder="Input WHERE condition"
          @input="emit('updateActiveDataWhereDraft', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="emit('applyWhere')"
        />
        <button
          type="button"
          title="Apply filter"
          :class="{ pending: activeDataWherePending }"
          @click="emit('applyWhere')"
        >
          <Play />
        </button>
      </div>
      <section
        v-if="activeDataEditSummary?.isDirty"
        class="db-edit-summary"
        :class="{ error: !!activeDataEditSummary.error, warning: !!activeDataEditSummary.warning && !activeDataEditSummary.error }"
      >
        <div class="db-edit-summary-counts">
          <span><strong>{{ activeDataEditSummary.newRows }}</strong> New</span>
          <span><strong>{{ activeDataEditSummary.updatedRows }}</strong> Updated</span>
          <span><strong>{{ activeDataEditSummary.deletedRows }}</strong> Deleted</span>
          <span><strong>{{ activeDataEditSummary.undoDepth }}</strong> Undo</span>
          <span><strong>{{ activeDataEditSummary.statementCount }}</strong> SQL</span>
        </div>
        <p
          v-if="activeDataEditSummary.error || activeDataEditSummary.warning || activeDataTab.saveError"
          class="db-edit-summary-message"
        >
          {{ activeDataTab.saveError || activeDataEditSummary.error || activeDataEditSummary.warning }}
        </p>
        <pre>{{ activeDataEditSummary.preview || 'No SQL statement will be generated until a new row contains at least one value.' }}</pre>
        <div class="db-edit-summary-actions">
          <button
            type="button"
            :disabled="!activeDataEditSummary.preview || activeDataTab.saving"
            @click="emit('copyDataMutationPreview')"
          >
            Copy Preview
          </button>
          <button
            type="button"
            :disabled="activeDataTab.saving"
            @click="emit('discardDataChanges')"
          >
            Discard All
          </button>
        </div>
      </section>
      <div class="db-data-grid-shell">
        <div
          v-if="activeDataTab.loading"
          class="db-data-loading"
        >
          Loading table data
        </div>
        <div
          v-else-if="activeDataTab.error"
          class="db-result-error"
        >
          <span>{{ activeDataTab.error }}</span>
        </div>
        <ResultGrid
          v-else
          :columns="activeDataTab.columns"
          :rows="pagedDataRows"
          :source-rows="activeDataTab.sourceRows"
          :sort="activeDataTab.sort"
          :filters="activeDataTab.filters"
          :start-row-index="(activeDataTab.page - 1) * activeDataTab.pageSize + 1"
          :selected-key="activeDataTab.selectedRowKey || undefined"
          :primary-key="activeDataTab.primaryKey"
          :new-rows="activeDataTab.dirtyState.newRows"
          :deleted-row-keys="activeDataTab.dirtyState.deletedRowKeys"
          :updated-cells="activeDataTab.dirtyState.updatedCells"
          :editable="canEditDataTab(activeDataTab)"
          @sort="emit('cycleDataSort', $event)"
          @filter="(column, filter) => emit('applyDataFilter', column, filter)"
          @select-row="emit('setActiveDataSelectedRow', $event)"
          @cell-edit="(rowKey, column, value) => emit('updateDataCell', rowKey, column, value)"
          @new-row-cell-edit="(rowKey, column, value) => emit('updateNewDataRowCell', rowKey, column, value)"
        />
      </div>
      <DataStatusBar
        :error="activeDataTab.error || undefined"
        :duration-ms="activeDataTab.durationMs"
        :row-count="activeDataTab.rowCount"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance, type StyleValue } from 'vue'
import {
  AlignLeft,
  BrainCircuit,
  CornerDownRight,
  FileSearch,
  Languages,
  LayoutDashboard,
  Lightbulb,
  MoreHorizontal,
  Play,
  Plus,
  Save,
  SaveAll,
  Search,
  SquareTerminal,
  Table2,
  TextCursorInput,
  WandSparkles,
  X
} from 'lucide-vue-next'
import DataGridToolbar from '@/components/database/DataGridToolbar.vue'
import DataStatusBar from '@/components/database/DataStatusBar.vue'
import DatabaseSqlEditor, { type DatabaseSqlEditorMetrics } from '@/components/database/DatabaseSqlEditor.vue'
import ResultGrid from '@/components/database/ResultGrid.vue'
import type { DataEditSummary, DbFilter } from '@/services/databaseGridRuntime'
import type { DbAiAction } from '@/services/databaseBackendGuards'
import type { SqlHistory, SqlResult, SqlResultViewState, WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type { TextRange } from '@/services/databaseSqlEditorRuntime'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo, DatabaseEngineInfo } from '@shared/contracts/database'

type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>
type DataTab = Extract<WorkspaceTab, { kind: 'data' }>
type DbAiToolbarAction = Extract<DbAiAction, 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete'>

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

const sqlEditorRef = ref<DatabaseMainWorkspaceApi | null>(null)
const sqlFindInputRef = ref<HTMLInputElement | null>(null)
const sqlReplaceInputRef = ref<HTMLInputElement | null>(null)
const workspaceTabRefs = new Map<string, HTMLElement>()

const activeSqlText = computed({
  get() {
    return props.activeSqlTab?.sql ?? ''
  },
  set(value: string) {
    emit('updateActiveSql', value)
  }
})

function registerWorkspaceTabRef(tabId: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) workspaceTabRefs.set(tabId, el)
  else workspaceTabRefs.delete(tabId)
}

function scrollActiveWorkspaceTabIntoView(tabId: string) {
  void nextTick(() => {
    const tabEl = workspaceTabRefs.get(tabId)
    if (typeof tabEl?.scrollIntoView === 'function') {
      tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
}

function selectOverflowTab(tabId: string) {
  emit('update:activeTabId', tabId)
  scrollActiveWorkspaceTabIntoView(tabId)
  emit('update:overflowOpen', false)
}

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
  const length = props.activeSqlTab?.sql.length ?? 0
  return { start: length, end: length }
}

function getText() {
  return sqlEditorRef.value?.getText() ?? props.activeSqlTab?.sql ?? ''
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
  return sqlEditorRef.value?.getCursorOffset() ?? props.activeSqlTab?.sql.length ?? 0
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
