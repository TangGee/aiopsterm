<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import {
  DB_FILTER_NULL,
  distinctFilterValues,
  type DbFilter,
  type DbSort,
  type DirtyState
} from '@/services/database/databaseGridRuntime'

const props = withDefaults(
  defineProps<{
    columns: string[]
    rows: Array<Record<string, unknown>>
    sourceRows?: Array<Record<string, unknown>>
    filters?: DbFilter[]
    sort?: DbSort
    startRowIndex?: number
    selectedKey?: string
    primaryKey?: string[]
    newRows?: DirtyState['newRows']
    deletedRowKeys?: Set<string>
    updatedCells?: Map<string, Record<string, unknown>>
    editable?: boolean
  }>(),
  {
    sourceRows: () => [],
    filters: () => [],
    sort: null,
    startRowIndex: 1,
    selectedKey: '',
    primaryKey: () => [],
    newRows: () => [],
    deletedRowKeys: () => new Set<string>(),
    updatedCells: () => new Map<string, Record<string, unknown>>(),
    editable: false
  }
)

const emit = defineEmits<{
  (event: 'sort', column: string): void
  (event: 'filter', column: string, filter: DbFilter | null): void
  (event: 'select-row', rowKey: string): void
  (event: 'cell-edit', rowKey: string, column: string, value: string): void
  (event: 'new-row-cell-edit', rowKey: string, column: string, value: string): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const editing = ref<{ origin: 'row' | 'new'; rowKey: string; column: string; value: string } | null>(null)
const openFilterColumn = ref<string | null>(null)
const filterPopoverRef = ref<HTMLElement | null>(null)
const filterInputRef = ref<HTMLInputElement | null>(null)
const filterAnchor = ref({ left: 8, top: 8 })
const filterSearch = ref('')
const filterSelection = ref<Set<string>>(new Set())
const filterLoading = ref(false)
const editInputRef = ref<HTMLInputElement | HTMLInputElement[] | null>(null)

const filterValues = computed(() => {
  const column = openFilterColumn.value
  if (!column) return []
  return distinctFilterValues((props.sourceRows.length ? props.sourceRows : props.rows).map((row) => row[column]))
})

const visibleFilterValues = computed(() => {
  const needle = filterSearch.value.trim().toLowerCase()
  if (!needle) return filterValues.value
  return filterValues.value.filter((entry) => entry.label.toLowerCase().includes(needle))
})

const allVisibleSelected = computed(
  () => visibleFilterValues.value.length > 0 && visibleFilterValues.value.every((entry) => filterSelection.value.has(entry.value))
)
const someVisibleSelected = computed(() => visibleFilterValues.value.some((entry) => filterSelection.value.has(entry.value)))
const filterPopoverStyle = computed(() => {
  const width = 260
  const maxHeight = 360
  const viewportWidth = window.innerWidth || 1024
  const viewportHeight = window.innerHeight || 768
  const left = Math.max(8, Math.min(filterAnchor.value.left, viewportWidth - width - 8))
  const top = Math.max(8, Math.min(filterAnchor.value.top, viewportHeight - maxHeight - 8))
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  }
})

function rowKey(row: Record<string, unknown>, index: number) {
  if (props.primaryKey.length) return JSON.stringify(props.primaryKey.map((key) => row[key]))
  return `row-${Math.max(0, props.startRowIndex - 1) + index}`
}

function displayCellValue(row: Record<string, unknown>, key: string, column: string) {
  const patch = props.updatedCells.get(key)
  if (patch && Object.prototype.hasOwnProperty.call(patch, column)) return patch[column]
  return row[column]
}

function formatCellValue(value: unknown) {
  try {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
    if (value instanceof Uint8Array) return new TextDecoder().decode(value)
    if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
    return String(value)
  } catch {
    return '<unrenderable>'
  }
}

function activeFilter(column: string) {
  return props.filters.find((filter) => filter.column === column) ?? null
}

function seedFilterSelection(column: string) {
  const filter = activeFilter(column)
  const next = new Set<string>()
  if (filter?.operator === 'in') filter.values.forEach((value) => next.add(value))
  if (filter?.operator === 'eq' && filter.value !== undefined) next.add(filter.value)
  if (filter?.operator === 'isnull') next.add(DB_FILTER_NULL)
  filterSelection.value = next
}

function openFilter(column: string, event: MouseEvent) {
  event.stopPropagation()
  const trigger = event.currentTarget as HTMLElement | null
  if (trigger) {
    const rect = trigger.getBoundingClientRect()
    filterAnchor.value = { left: rect.left, top: rect.bottom + 2 }
  }
  if (openFilterColumn.value === column) {
    closeFilter()
    return
  }
  openFilterColumn.value = column
  filterLoading.value = true
  filterSearch.value = ''
  seedFilterSelection(column)
  nextTick(() => {
    if (openFilterColumn.value !== column) return
    filterInputRef.value?.focus()
    filterLoading.value = false
  })
}

function closeFilter() {
  openFilterColumn.value = null
  filterSearch.value = ''
  filterLoading.value = false
}

function onDocumentMouseDown(event: MouseEvent) {
  if (!openFilterColumn.value) return
  const target = event.target as Node | null
  if (!target) return
  if (filterPopoverRef.value?.contains(target)) return
  if (rootRef.value?.contains(target)) return
  closeFilter()
}

function toggleFilterValue(value: string, checked: boolean) {
  const next = new Set(filterSelection.value)
  if (checked) next.add(value)
  else next.delete(value)
  filterSelection.value = next
}

function toggleAllVisible(checked: boolean) {
  const next = new Set(filterSelection.value)
  visibleFilterValues.value.forEach((entry) => {
    if (checked) next.add(entry.value)
    else next.delete(entry.value)
  })
  filterSelection.value = next
}

function clearFilter() {
  if (openFilterColumn.value) emit('filter', openFilterColumn.value, null)
  closeFilter()
}

function applyFilter() {
  const column = openFilterColumn.value
  if (!column) return
  const selected = Array.from(filterSelection.value)
  if (selected.length === 0 || selected.length === filterValues.value.length) {
    emit('filter', column, null)
    closeFilter()
    return
  }
  const hasNull = selected.includes(DB_FILTER_NULL)
  const values = selected.filter((value) => value !== DB_FILTER_NULL)
  const nextFilter: DbFilter =
    hasNull && values.length === 0
      ? { column, operator: 'isnull' }
      : values.length === 1 && !hasNull
        ? { column, operator: 'eq', value: values[0] }
        : { column, operator: 'in', values }
  emit('filter', column, nextFilter)
  closeFilter()
}

function filterSummary(column: string) {
  const filter = activeFilter(column)
  if (!filter) return 'No filter'
  if (filter.operator === 'in') return `IN (${filter.values.length})`
  if (filter.operator === 'isnull') return 'IS NULL'
  if (filter.operator === 'notnull') return 'IS NOT NULL'
  if (filter.operator === 'eq' || filter.operator === 'neq' || filter.operator === 'like') return `${filter.operator.toUpperCase()} ${filter.value}`
  return 'No filter'
}

function startEdit(origin: 'row' | 'new', key: string, column: string, value: unknown) {
  if (!props.editable) return
  if (origin === 'row' && props.deletedRowKeys.has(key)) return
  editing.value = { origin, rowKey: key, column, value: formatCellValue(value) }
  nextTick(() => {
    const input = Array.isArray(editInputRef.value) ? editInputRef.value.find((item) => item instanceof HTMLInputElement) : editInputRef.value
    if (typeof input?.focus === 'function') input.focus()
    if (typeof input?.select === 'function') input.select()
  })
}

function commit() {
  if (!editing.value) return
  if (editing.value.origin === 'new') emit('new-row-cell-edit', editing.value.rowKey, editing.value.column, editing.value.value)
  else emit('cell-edit', editing.value.rowKey, editing.value.column, editing.value.value)
  editing.value = null
}

let documentMouseDownAttached = false

function attachDocumentMouseDown() {
  if (documentMouseDownAttached) return
  document.addEventListener('mousedown', onDocumentMouseDown, true)
  documentMouseDownAttached = true
}

function detachDocumentMouseDown() {
  if (!documentMouseDownAttached) return
  document.removeEventListener('mousedown', onDocumentMouseDown, true)
  documentMouseDownAttached = false
}

function deactivateGridSurface() {
  closeFilter()
  detachDocumentMouseDown()
}

onMounted(attachDocumentMouseDown)
onActivated(attachDocumentMouseDown)
onDeactivated(deactivateGridSurface)
onBeforeUnmount(deactivateGridSurface)
</script>

<template>
  <div
    ref="rootRef"
    class="db-result"
    @click="closeFilter"
  >
    <div
      v-if="columns.length === 0"
      class="db-result-empty"
    >
      No Results
    </div>
    <div
      v-else
      class="db-result-table-wrap"
    >
      <table class="db-result-table">
        <thead>
          <tr>
            <th class="index">#</th>
            <th
              v-for="column in columns"
              :key="column"
            >
              <span
                class="db-th-label"
                @click="emit('sort', column)"
              >
                {{ column }}
              </span>
              <span class="db-th-controls">
                <span
                  v-if="activeFilter(column)"
                  class="db-filter-chip"
                  :title="filterSummary(column)"
                >
                  {{ filterSummary(column) }}
                </span>
                <button
                  type="button"
                  :class="{ active: sort?.column === column }"
                  title="Sort"
                  @click="emit('sort', column)"
                >
                  {{ sort?.column === column ? (sort.direction === 'asc' ? '▲' : '▼') : '⇅' }}
                </button>
                <button
                  type="button"
                  :class="{ active: filters.some((filter) => filter.column === column) }"
                  title="Filter"
                  @click="openFilter(column, $event)"
                >
                  ▾
                </button>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="rowKey(row, index)"
            :class="{
              selected: selectedKey === rowKey(row, index),
              deleted: deletedRowKeys.has(rowKey(row, index)),
              updated: !!updatedCells.get(rowKey(row, index)) && Object.keys(updatedCells.get(rowKey(row, index)) ?? {}).length > 0
            }"
            @click="emit('select-row', rowKey(row, index))"
          >
            <td class="index">{{ startRowIndex + index }}</td>
            <td
              v-for="column in columns"
              :key="column"
              :class="{ updated: !!updatedCells.get(rowKey(row, index)) && Object.prototype.hasOwnProperty.call(updatedCells.get(rowKey(row, index)) ?? {}, column) }"
              @dblclick="startEdit('row', rowKey(row, index), column, displayCellValue(row, rowKey(row, index), column))"
            >
              <input
                v-if="editing?.rowKey === rowKey(row, index) && editing.column === column"
                ref="editInputRef"
                v-model="editing.value"
                autofocus
                @blur="commit"
                @keydown.enter="commit"
                @keydown.escape="editing = null"
              />
              <span
                v-else-if="displayCellValue(row, rowKey(row, index), column) === null || displayCellValue(row, rowKey(row, index), column) === undefined"
                class="db-null"
              >
                &lt;null&gt;
              </span>
              <template v-else>{{ formatCellValue(displayCellValue(row, rowKey(row, index), column)) }}</template>
            </td>
          </tr>
          <tr
            v-for="newRow in newRows"
            :key="newRow.tmpId"
            :class="{ new: true, selected: selectedKey === newRow.tmpId }"
            @click="emit('select-row', newRow.tmpId)"
          >
            <td class="index">*</td>
            <td
              v-for="column in columns"
              :key="column"
              @dblclick="startEdit('new', newRow.tmpId, column, newRow.values[column])"
            >
              <input
                v-if="editing?.rowKey === newRow.tmpId && editing.column === column"
                ref="editInputRef"
                v-model="editing.value"
                autofocus
                @blur="commit"
                @keydown.enter="commit"
                @keydown.escape="editing = null"
              />
              <span
                v-else-if="newRow.values[column] === null || newRow.values[column] === undefined"
                class="db-null"
              >
                &lt;null&gt;
              </span>
              <template v-else>{{ formatCellValue(newRow.values[column]) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-if="openFilterColumn"
      ref="filterPopoverRef"
      class="db-filter-popover"
      :style="filterPopoverStyle"
      @click.stop
    >
      <div class="db-filter-search">
        <span>⌕</span>
        <input
          ref="filterInputRef"
          v-model="filterSearch"
          :placeholder="`Search ${openFilterColumn}`"
          @keydown.enter="applyFilter"
          @keydown.escape="closeFilter"
        />
      </div>
      <label class="db-filter-row all">
        <input
          type="checkbox"
          :checked="allVisibleSelected"
          :indeterminate="someVisibleSelected && !allVisibleSelected"
          @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
        />
        <span>All</span>
        <button
          type="button"
          @click="clearFilter"
        >
          Clear
        </button>
      </label>
      <div
        class="db-filter-list"
        :class="{ loading: filterLoading }"
      >
        <div
          v-if="filterLoading"
          class="db-filter-empty loading"
        >
          Loading...
        </div>
        <label
          v-else-if="visibleFilterValues.length"
          v-for="entry in visibleFilterValues"
          :key="entry.value"
          class="db-filter-row"
        >
          <input
            type="checkbox"
            :checked="filterSelection.has(entry.value)"
            @change="toggleFilterValue(entry.value, ($event.target as HTMLInputElement).checked)"
          />
          <span :title="entry.label">{{ entry.label }}</span>
          <small>({{ entry.count }})</small>
        </label>
        <div
          v-else
          class="db-filter-empty"
        >
          No Results
        </div>
      </div>
      <footer class="db-filter-footer">
        <button
          type="button"
          @click="closeFilter"
        >
          Cancel
        </button>
        <button
          type="button"
          class="primary"
          @click="applyFilter"
        >
          Apply
        </button>
      </footer>
    </div>
  </div>
</template>
