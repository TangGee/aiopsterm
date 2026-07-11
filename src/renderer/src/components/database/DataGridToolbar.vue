<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/i18n'

const pageSizes = [10, 50, 100, 500, 1000, 5000, 10000]
const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total?: number | null
    canEdit?: boolean
    hasSelection?: boolean
    canUndo?: boolean
    isDirty?: boolean
    editDisabledReason?: string
    hideRefresh?: boolean
    canExport?: boolean
    exportTitle?: string
    canChart?: boolean
    chartTitle?: string
    canComment?: boolean
    commentTitle?: string
  }>(),
  {
    total: null,
    canEdit: false,
    hasSelection: false,
    canUndo: false,
    isDirty: false,
    editDisabledReason: '',
    hideRefresh: false,
    canExport: false,
    exportTitle: '',
    canChart: false,
    chartTitle: '',
    canComment: false,
    commentTitle: ''
  }
)

const emit = defineEmits<{
  (event: 'gotoPage', page: number): void
  (event: 'gotoLastPage'): void
  (event: 'changePageSize', size: number): void
  (event: 'refreshTotal'): void
  (event: 'refresh'): void
  (event: 'add-row'): void
  (event: 'delete-row'): void
  (event: 'undo'): void
  (event: 'save'): void
  (event: 'export'): void
  (event: 'chart'): void
  (event: 'comment'): void
}>()

const pageCount = computed(() =>
  props.total === null || props.total === undefined ? null : Math.max(1, Math.ceil(Math.max(0, props.total) / Math.max(1, props.pageSize)))
)
const atFirstPage = computed(() => props.page <= 1)
const atLastPage = computed(() => pageCount.value !== null && props.page >= pageCount.value)
const localizedEditDisabledReason = computed(() => {
  if (props.editDisabledReason === 'Connection is unavailable') return t('database.data.edit.connectionUnavailable')
  if (props.editDisabledReason === 'Connection is readonly') return t('database.data.edit.connectionReadonly')
  if (props.editDisabledReason === 'View editing is disabled in this version') return t('database.data.edit.viewDisabled')
  if (props.editDisabledReason === 'Table is unavailable') return t('database.data.edit.tableUnavailable')
  return props.editDisabledReason
})
const editingDisabledTitle = computed(() => localizedEditDisabledReason.value || t('database.grid.toolbar.editingDisabled'))
const addRowTitle = computed(() => (props.canEdit ? t('database.grid.toolbar.addRow') : editingDisabledTitle.value))
const deleteRowTitle = computed(() => {
  if (!props.canEdit) return editingDisabledTitle.value
  if (!props.hasSelection) return t('database.grid.toolbar.selectRowBeforeDeleting')
  return t('database.grid.toolbar.deleteRow')
})
const undoTitle = computed(() => (props.canUndo ? t('database.grid.toolbar.undo') : t('database.grid.toolbar.nothingToUndo')))
const saveTitle = computed(() => {
  if (!props.canEdit) return editingDisabledTitle.value
  if (!props.isDirty) return t('database.grid.toolbar.noChangesToSave')
  return t('database.grid.toolbar.saveChanges')
})

function gotoPage(page: number) {
  emit('gotoPage', Number.isFinite(page) && page > 0 ? Math.floor(page) : 1)
}

function changePageSize(size: number) {
  emit('changePageSize', Number.isFinite(size) && size > 0 ? Math.floor(size) : 100)
}
</script>

<template>
  <div class="db-toolbar">
    <div class="db-toolbar-group">
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-first"
        :disabled="atFirstPage"
        :title="t('database.grid.toolbar.firstPage')"
        @click="gotoPage(1)"
      >
        ⏮
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-prev"
        :disabled="atFirstPage"
        :title="t('database.grid.toolbar.previousPage')"
        @click="gotoPage(page - 1)"
      >
        ⏴
      </button>
      <input
        :value="page"
        type="number"
        min="1"
        @input="gotoPage(Number(($event.target as HTMLInputElement).value) || 1)"
      />
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-next"
        :title="t('database.grid.toolbar.nextPage')"
        @click="gotoPage(page + 1)"
      >
        ⏵
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-last"
        :disabled="pageCount === null || atLastPage"
        :title="t('database.grid.toolbar.lastPage')"
        @click="emit('gotoLastPage')"
      >
        ⏭
      </button>
      <select
        :value="pageSize"
        @change="changePageSize(Number(($event.target as HTMLSelectElement).value))"
      >
        <option
          v-for="size in pageSizes"
          :key="size"
          :value="size"
        >
          {{ size }}
        </option>
      </select>
      <span
        class="db-toolbar-total"
        :title="t('database.grid.toolbar.refreshTotal')"
        @click="emit('refreshTotal')"
      >{{ t('database.grid.toolbar.total') }}
        <span
          v-if="total === null || total === undefined"
          class="db-toolbar-total-unknown"
        >?</span>
        <template v-else> {{ total }}</template>
      </span>
    </div>
    <div class="db-toolbar-group">
      <button
        v-if="!hideRefresh"
        type="button"
        class="db-toolbar-btn db-toolbar-btn-refresh"
        :title="t('database.common.refresh')"
        @click="emit('refresh')"
      >
        ↻
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-add-row"
        :disabled="!canEdit"
        :title="addRowTitle"
        @click="emit('add-row')"
      >
        +
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-delete-row"
        :disabled="!canEdit || !hasSelection"
        :title="deleteRowTitle"
        @click="emit('delete-row')"
      >
        -
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-undo"
        :disabled="!canUndo"
        :title="undoTitle"
        @click="emit('undo')"
      >
        ↶
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-save"
        :disabled="!canEdit || !isDirty"
        :title="saveTitle"
        @click="emit('save')"
      >
        💾
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-chart"
        :disabled="!canChart"
        :title="canChart ? (chartTitle || t('database.grid.toolbar.chart')) : t('database.grid.toolbar.noRowsToChart')"
        @click="emit('chart')"
      >
        📊
      </button>
    </div>
    <span class="db-toolbar-spacer" />
    <button
      type="button"
      :disabled="!canExport"
      class="db-toolbar-btn db-toolbar-export"
      :title="canExport ? (exportTitle || t('database.grid.toolbar.exportCsv')) : t('database.grid.toolbar.noRowsToExport')"
      @click="emit('export')"
    >
      {{ t('database.common.export') }} ▾
    </button>
  </div>
</template>
