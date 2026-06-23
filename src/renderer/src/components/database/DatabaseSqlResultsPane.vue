<template>
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
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import DataGridToolbar from '@/components/database/DataGridToolbar.vue'
import DataStatusBar from '@/components/database/DataStatusBar.vue'
import ResultGrid from '@/components/database/ResultGrid.vue'
import type { DatabaseSqlHistoryRules, SqlTab } from '@/components/database/databaseMainWorkspaceTypes'
import type { DbFilter } from '@/services/database/databaseGridRuntime'
import type { SqlHistory, SqlResult, SqlResultViewState } from '@/services/database/databaseWorkspaceTypes'

defineProps<{
  activeSqlTab: SqlTab
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
</script>
