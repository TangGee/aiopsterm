<template>
  <section class="db-data-workspace">
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
      :export-title="t('database.data.exportCurrentPage')"
      :can-chart="!activeDataTab.loading && !activeDataTab.error && pagedDataRows.length > 0"
      :chart-title="t('database.data.chartCurrentPage')"
      :can-comment="!activeDataTab.loading && !activeDataTab.error"
      :comment-title="t('database.data.commentCurrentPage')"
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
        :aria-label="t('database.data.whereCondition')"
        :class="{ pending: activeDataWherePending }"
        :placeholder="t('database.data.wherePlaceholder')"
        @input="emit('updateActiveDataWhereDraft', ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="emit('applyWhere')"
      />
      <button
        type="button"
        :title="t('database.data.applyFilter')"
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
        <span><strong>{{ activeDataEditSummary.newRows }}</strong> {{ t('database.data.edit.new') }}</span>
        <span><strong>{{ activeDataEditSummary.updatedRows }}</strong> {{ t('database.data.edit.updated') }}</span>
        <span><strong>{{ activeDataEditSummary.deletedRows }}</strong> {{ t('database.data.edit.deleted') }}</span>
        <span><strong>{{ activeDataEditSummary.undoDepth }}</strong> {{ t('database.data.edit.undo') }}</span>
        <span><strong>{{ activeDataEditSummary.statementCount }}</strong> SQL</span>
      </div>
      <p
        v-if="activeDataEditSummary.error || activeDataEditSummary.warning || activeDataTab.saveError"
        class="db-edit-summary-message"
      >
        {{ activeDataTab.saveError || activeDataEditSummary.error || activeDataEditSummary.warning }}
      </p>
      <pre>{{ activeDataEditSummary.preview || t('database.data.edit.noPreview') }}</pre>
      <div class="db-edit-summary-actions">
        <button
          type="button"
          :disabled="!activeDataEditSummary.preview || activeDataTab.saving"
          @click="emit('copyDataMutationPreview')"
        >
          {{ t('database.data.edit.copyPreview') }}
        </button>
        <button
          type="button"
          :disabled="activeDataTab.saving"
          @click="emit('discardDataChanges')"
        >
          {{ t('database.data.edit.discardAll') }}
        </button>
      </div>
    </section>
    <div class="db-data-grid-shell">
      <div
        v-if="activeDataTab.loading"
        class="db-data-loading"
      >
        {{ t('database.data.loading') }}
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
</template>

<script setup lang="ts">
import { Play, Table2 } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import DataGridToolbar from '@/components/database/DataGridToolbar.vue'
import DataStatusBar from '@/components/database/DataStatusBar.vue'
import ResultGrid from '@/components/database/ResultGrid.vue'
import type { DataTab, DatabaseTablePresenterRules } from '@/components/database/databaseMainWorkspaceTypes'
import type { DataEditSummary, DbFilter } from '@/services/database/databaseGridRuntime'

const { t } = useI18n()

defineProps<{
  activeDataTab: DataTab
  activeDataEditSummary: DataEditSummary | null
  activeDataWherePending: boolean
  pagedDataRows: Array<Record<string, unknown>>
  canEditDataTab: DatabaseTablePresenterRules['canEditDataTab']
  isDataTabDirty: DatabaseTablePresenterRules['isDataTabDirty']
  dataEditDisabledReason: DatabaseTablePresenterRules['dataEditDisabledReason']
}>()

const emit = defineEmits<{
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
</script>
