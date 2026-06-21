<script setup lang="ts">
import { computed } from 'vue'

const pageSizes = [10, 50, 100, 500, 1000, 5000, 10000]

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
    exportTitle: 'Export CSV',
    canChart: false,
    chartTitle: 'Chart',
    canComment: false,
    commentTitle: 'Comment'
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
const addRowTitle = computed(() => (props.canEdit ? 'Add row' : props.editDisabledReason || 'Editing is disabled for this result'))
const deleteRowTitle = computed(() => {
  if (!props.canEdit) return props.editDisabledReason || 'Editing is disabled for this result'
  if (!props.hasSelection) return 'Select a row before deleting'
  return 'Delete row'
})
const undoTitle = computed(() => (props.canUndo ? 'Undo' : 'Nothing to undo'))
const saveTitle = computed(() => {
  if (!props.canEdit) return props.editDisabledReason || 'Editing is disabled for this result'
  if (!props.isDirty) return 'No changes to save'
  return 'Save changes'
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
        title="First page"
        @click="gotoPage(1)"
      >
        ⏮
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-prev"
        :disabled="atFirstPage"
        title="Previous page"
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
        title="Next page"
        @click="gotoPage(page + 1)"
      >
        ⏵
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-last"
        :disabled="pageCount === null || atLastPage"
        title="Last page"
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
        title="Refresh total"
        @click="emit('refreshTotal')"
      >Total:
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
        title="Refresh"
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
        :title="canChart ? chartTitle : 'No rows to chart'"
        @click="emit('chart')"
      >
        📊
      </button>
      <button
        type="button"
        class="db-toolbar-btn db-toolbar-btn-comment"
        :disabled="!canComment"
        :title="canComment ? commentTitle : 'No page context for comment'"
        @click="emit('comment')"
      >
        💬
      </button>
    </div>
    <span class="db-toolbar-spacer" />
    <button
      type="button"
      :disabled="!canExport"
      class="db-toolbar-btn db-toolbar-export"
      :title="canExport ? exportTitle : 'No rows to export'"
      @click="emit('export')"
    >
      Export ▾
    </button>
  </div>
</template>
