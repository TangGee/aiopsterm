import type { DatabaseTableMutation } from '@shared/contracts/database'

export type DbFilter =
  | { column: string; operator: 'like' | 'eq' | 'neq'; value: string }
  | { column: string; operator: 'in'; values: string[] }
  | { column: string; operator: 'isnull' | 'notnull' }

export type DbSort = { column: string; direction: 'asc' | 'desc' } | null
export type DbOrderBy = Array<{ column: string; direction: 'asc' | 'desc' }>
export type ResultStatus = 'running' | 'ok' | 'error'
export type DbFilterValueEntry = { value: string; label: string; count: number }

export type DirtyState = {
  newRows: Array<{ tmpId: string; values: Record<string, unknown> }>
  deletedRowKeys: Set<string>
  updatedCells: Map<string, Record<string, unknown>>
  originalRows: Map<string, Record<string, unknown>>
}

export type EditOp =
  | { kind: 'add'; tmpId: string }
  | { kind: 'delete'; rowKey: string; snapshot: Record<string, unknown> }
  | { kind: 'update'; rowKey: string; column: string; oldValue: unknown; newValue: unknown }

export type DataEditSummary = {
  isDirty: boolean
  newRows: number
  updatedRows: number
  deletedRows: number
  undoDepth: number
  statementCount: number
  preview: string
  warning: string
  error: string
}

export type DataMutationPlanState = {
  key: string
  loading: boolean
  statementCount: number
  preview: string
  warning: string
  error: string
}

export type DataEditTabState = {
  columns: string[]
  dirtyState: DirtyState
  undoStack: EditOp[]
  selectedRowKey: string | null
  saveError: string | null
}

export type DataEditStateResult = {
  changed: boolean
  notice?: string
}

export const DB_FILTER_NULL = '__AIOPSTERM_DB_NULL__'

export function parseWhereRaw(whereRaw: string): DbFilter[] {
  const raw = whereRaw.trim()
  if (!raw) return []
  const match = raw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (!match) return []
  return [
    {
      column: match[1],
      operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq',
      value: match[3]
    }
  ]
}

export function parseOrderByRaw(orderByRaw: string, knownColumns: string[]): DbOrderBy {
  const raw = orderByRaw.trim().replace(/^order\s+by\s+/i, '')
  if (!raw) return []
  const knownColumnMap = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  return raw
    .split(',')
    .map((item) => item.trim())
    .map((item) => {
      const match = item.match(
        /^((?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*))*)(?:\s+(asc|desc))?(?:\s+nulls\s+(?:first|last))?$/i
      )
      if (!match) return null
      const column = normalizeOrderByIdentifier(match[1])
      const knownColumn = knownColumnMap.get(column.toLowerCase())
      if (!knownColumn) return null
      return {
        column: knownColumn,
        direction: (match[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc'
      }
    })
    .filter((item): item is DbOrderBy[number] => item !== null)
}

export function normalizeOrderByIdentifier(value: string) {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

export function applyFilters(rows: Array<Record<string, unknown>>, filters: DbFilter[]) {
  if (!filters.length) return rows
  return rows.filter((row) => filters.every((filter) => matchesFilter(row[filter.column], filter)))
}

export function matchesFilter(value: unknown, filter: DbFilter) {
  const normalized = normalizeFilterValue(value)
  if (filter.operator === 'isnull') return normalized === null
  if (filter.operator === 'notnull') return normalized !== null
  if (normalized === null) return false
  if (filter.operator === 'like') return normalized.toLowerCase().includes(filter.value.toLowerCase())
  if (filter.operator === 'eq') return normalized === filter.value
  if (filter.operator === 'neq') return normalized !== filter.value
  if (filter.operator === 'in') return filter.values.includes(normalized)
  return true
}

export function applySort(rows: Array<Record<string, unknown>>, sort: DbSort) {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const av = a[sort.column]
    const bv = b[sort.column]
    const factor = sort.direction === 'asc' ? 1 : -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor
  })
}

export function applyOrderBySort(rows: Array<Record<string, unknown>>, orderBy: DbOrderBy) {
  if (!orderBy.length) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const item of orderBy) {
        const result = compareDataValue(a.row[item.column], b.row[item.column])
        if (result !== 0) return item.direction === 'asc' ? result : -result
      }
      return a.index - b.index
    })
    .map((item) => item.row)
}

export function compareDataValue(a: unknown, b: unknown) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const aTime = typeof a === 'string' ? Date.parse(a) : Number.NaN
  const bTime = typeof b === 'string' ? Date.parse(b) : Number.NaN
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function nextSort(current: DbSort, column: string): DbSort {
  if (!current || current.column !== column) return { column, direction: 'asc' }
  if (current.direction === 'asc') return { column, direction: 'desc' }
  return null
}

export function replaceFilter(filters: DbFilter[], column: string, filter: DbFilter | null) {
  const next = filters.filter((item) => item.column !== column)
  return filter ? [...next, filter] : next
}

export function distinctFilterValues(values: unknown[]): DbFilterValueEntry[] {
  const map = new Map<string, DbFilterValueEntry>()
  values.forEach((value) => {
    const normalized = normalizeFilterValue(value)
    const key = normalized ?? DB_FILTER_NULL
    const label = normalized === null ? '<null>' : normalized === '' ? '<empty>' : normalized
    const existing = map.get(key)
    if (existing) existing.count += 1
    else map.set(key, { value: key, label, count: 1 })
  })
  return Array.from(map.values()).sort((a, b) => {
    if (a.value === DB_FILTER_NULL) return -1
    if (b.value === DB_FILTER_NULL) return 1
    return a.label.localeCompare(b.label)
  })
}

export function normalizeFilterValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function clampPage(page: number, total: number, pageSize: number) {
  const max = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(1, Math.floor(page)), max)
}

export function buildRowKey(row: Record<string, unknown>, primaryKey: string[], index: number) {
  if (!primaryKey.length) return `row-${index}`
  return JSON.stringify(primaryKey.map((key) => row[key]))
}

export function makeDirtyState(rows: Array<Record<string, unknown>>, primaryKey: string[]): DirtyState {
  return {
    newRows: [],
    deletedRowKeys: new Set<string>(),
    updatedCells: new Map<string, Record<string, unknown>>(),
    originalRows: makeOriginalRows(rows, primaryKey)
  }
}

export function makeOriginalRows(rows: Array<Record<string, unknown>>, primaryKey: string[]) {
  const originalRows = new Map<string, Record<string, unknown>>()
  rows.forEach((row, index) => {
    originalRows.set(buildRowKey(row, primaryKey, index), { ...row })
  })
  return originalRows
}

export function cloneDirtyState(dirtyState: DirtyState): DirtyState {
  return {
    newRows: dirtyState.newRows.map((row) => ({ tmpId: row.tmpId, values: { ...row.values } })),
    deletedRowKeys: new Set(dirtyState.deletedRowKeys),
    updatedCells: new Map(Array.from(dirtyState.updatedCells.entries()).map(([key, patch]) => [key, { ...patch }])),
    originalRows: new Map(Array.from(dirtyState.originalRows.entries()).map(([key, row]) => [key, { ...row }]))
  }
}

export function isDirtyStateDirty(dirtyState: DirtyState) {
  return dirtyState.newRows.length > 0 || dirtyState.deletedRowKeys.size > 0 || dirtyState.updatedCells.size > 0
}

export function makeDataMutationPlanState(overrides: Partial<DataMutationPlanState> = {}): DataMutationPlanState {
  return {
    key: '',
    loading: false,
    statementCount: 0,
    preview: '',
    warning: '',
    error: '',
    ...overrides
  }
}

export function buildDataEditSummary(tab: {
  dirtyState: DirtyState
  undoStack: EditOp[]
  mutationPlan: DataMutationPlanState
}): DataEditSummary {
  const newRows = tab.dirtyState.newRows.length
  const updatedRows = tab.dirtyState.updatedCells.size
  const deletedRows = tab.dirtyState.deletedRowKeys.size
  const isDirty = newRows > 0 || updatedRows > 0 || deletedRows > 0
  const plan = isDirty ? tab.mutationPlan : makeDataMutationPlanState()
  return {
    isDirty,
    newRows,
    updatedRows,
    deletedRows,
    undoDepth: tab.undoStack.length,
    statementCount: plan.statementCount,
    preview: plan.preview,
    warning: plan.warning,
    error: plan.error
  }
}

export function buildDataMutationPayload(tab: { dirtyState: DirtyState; primaryKey: string[] }): DatabaseTableMutation[] {
  return [
    ...Array.from(tab.dirtyState.deletedRowKeys).map((rowKey) => {
      const snapshot = tab.dirtyState.originalRows.get(rowKey)
      return {
        kind: 'delete' as const,
        rowKey,
        primaryKey: tab.primaryKey.slice(),
        ...(snapshot ? { originalRow: { ...snapshot } } : {})
      }
    }),
    ...Array.from(tab.dirtyState.updatedCells.entries()).map(([rowKey, patch]) => {
      const snapshot = tab.dirtyState.originalRows.get(rowKey)
      return {
        kind: 'update' as const,
        rowKey,
        primaryKey: tab.primaryKey.slice(),
        patch: { ...patch },
        ...(snapshot ? { originalRow: { ...snapshot } } : {})
      }
    }),
    ...tab.dirtyState.newRows.map((row) => ({ kind: 'insert' as const, values: { ...row.values } }))
  ]
}

export function updateDataCellState(tab: DataEditTabState, rowKey: string, column: string, value: string): DataEditStateResult {
  tab.saveError = null
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const snapshot = dirtyState.originalRows.get(rowKey)
  if (!snapshot) return { changed: false }
  const currentPatch = dirtyState.updatedCells.get(rowKey) ?? {}
  const oldValue = Object.prototype.hasOwnProperty.call(currentPatch, column) ? currentPatch[column] : snapshot[column]
  if (oldValue === value) return { changed: false }
  const nextPatch = { ...currentPatch, [column]: value }
  if (value === snapshot[column]) delete nextPatch[column]
  if (Object.keys(nextPatch).length) dirtyState.updatedCells.set(rowKey, nextPatch)
  else dirtyState.updatedCells.delete(rowKey)
  tab.dirtyState = dirtyState
  tab.undoStack = [...tab.undoStack, { kind: 'update', rowKey, column, oldValue, newValue: value }]
  return { changed: true }
}

export function updateNewDataRowCellState(tab: DataEditTabState, tmpId: string, column: string, value: string): DataEditStateResult {
  tab.saveError = null
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const newRows = dirtyState.newRows.map((row) => (row.tmpId === tmpId ? { ...row, values: { ...row.values, [column]: value } } : row))
  if (!newRows.some((row) => row.tmpId === tmpId)) return { changed: false }
  tab.dirtyState = { ...dirtyState, newRows }
  return { changed: true }
}

export function addDataRowState(tab: DataEditTabState, tmpId: string): DataEditStateResult {
  tab.saveError = null
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const values: Record<string, unknown> = {}
  tab.columns.forEach((column) => {
    values[column] = null
  })
  tab.dirtyState = { ...dirtyState, newRows: [...dirtyState.newRows, { tmpId, values }] }
  tab.undoStack = [...tab.undoStack, { kind: 'add', tmpId }]
  tab.selectedRowKey = tmpId
  return { changed: true, notice: 'New row added locally' }
}

export function deleteSelectedDataRowState(tab: DataEditTabState): DataEditStateResult {
  if (!tab.selectedRowKey) return { changed: false }
  tab.saveError = null
  const key = tab.selectedRowKey
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const newRowIndex = dirtyState.newRows.findIndex((row) => row.tmpId === key)
  if (newRowIndex >= 0) {
    dirtyState.newRows.splice(newRowIndex, 1)
    const addOpIndex = tab.undoStack.findIndex((op) => op.kind === 'add' && op.tmpId === key)
    const undoStack = tab.undoStack.filter((_, index) => index !== addOpIndex)
    tab.dirtyState = dirtyState
    tab.undoStack = addOpIndex >= 0 ? undoStack : [...tab.undoStack]
    tab.selectedRowKey = null
    return { changed: true, notice: 'New row removed' }
  }
  if (dirtyState.deletedRowKeys.has(key)) return { changed: false }
  const snapshot = dirtyState.originalRows.get(key)
  if (!snapshot) return { changed: false }
  dirtyState.deletedRowKeys.add(key)
  dirtyState.updatedCells.delete(key)
  tab.dirtyState = dirtyState
  tab.undoStack = [...tab.undoStack, { kind: 'delete', rowKey: key, snapshot: { ...snapshot } }]
  tab.selectedRowKey = null
  return { changed: true, notice: 'Row marked for deletion' }
}

export function undoDataChangesState(tab: DataEditTabState): DataEditStateResult {
  tab.saveError = null
  const undoStack = [...tab.undoStack]
  const op = undoStack.pop()
  if (!op) return { changed: false }
  const dirtyState = cloneDirtyState(tab.dirtyState)
  if (op.kind === 'add') {
    dirtyState.newRows = dirtyState.newRows.filter((row) => row.tmpId !== op.tmpId)
  } else if (op.kind === 'delete') {
    dirtyState.deletedRowKeys.delete(op.rowKey)
  } else {
    const snapshot = dirtyState.originalRows.get(op.rowKey)
    if (!snapshot) return { changed: false }
    const patch = { ...(dirtyState.updatedCells.get(op.rowKey) ?? {}) }
    if (op.oldValue === snapshot[op.column]) delete patch[op.column]
    else patch[op.column] = op.oldValue
    if (Object.keys(patch).length) dirtyState.updatedCells.set(op.rowKey, patch)
    else dirtyState.updatedCells.delete(op.rowKey)
  }
  tab.dirtyState = dirtyState
  tab.undoStack = undoStack
  return { changed: true, notice: 'Last data edit reverted' }
}
