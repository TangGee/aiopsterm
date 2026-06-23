import { describe, expect, it, vi } from 'vitest'
import {
  addDataRowState,
  applyFilters,
  applyOrderBySort,
  applySort,
  buildDataEditSummary,
  buildDataMutationPayload,
  deleteSelectedDataRowState,
  distinctFilterValues,
  makeDataMutationPlanState,
  makeDirtyState,
  nextSort,
  parseOrderByRaw,
  parseWhereRaw,
  replaceFilter,
  undoDataChangesState,
  updateDataCellState,
  updateNewDataRowCellState
} from '@/services/database/databaseGridRuntime'

describe('databaseGridRuntime', () => {
  it('filters, sorts, and parses simple data-grid query controls', () => {
    const rows = [
      { id: 2, status: 'open', created: '2026-01-02' },
      { id: 1, status: 'closed', created: '2026-01-01' },
      { id: 3, status: null, created: '2026-01-03' }
    ]

    expect(parseWhereRaw("status = 'open'")).toEqual([{ column: 'status', operator: 'eq', value: 'open' }])
    expect(parseOrderByRaw('order by "created" desc', ['id', 'created'])).toEqual([{ column: 'created', direction: 'desc' }])
    expect(applyFilters(rows, [{ column: 'status', operator: 'notnull' }])).toHaveLength(2)
    expect(applySort(rows, { column: 'id', direction: 'asc' }).map((row) => row.id)).toEqual([1, 2, 3])
    expect(applyOrderBySort(rows, [{ column: 'created', direction: 'desc' }]).map((row) => row.id)).toEqual([3, 2, 1])
    expect(nextSort(null, 'id')).toEqual({ column: 'id', direction: 'asc' })
    expect(replaceFilter([], 'status', { column: 'status', operator: 'eq', value: 'open' })).toEqual([{ column: 'status', operator: 'eq', value: 'open' }])
    expect(distinctFilterValues([null, '', 'open', 'open']).map((entry) => [entry.value, entry.count])).toEqual([
      ['__AIOPSTERM_DB_NULL__', 1],
      ['', 1],
      ['open', 2]
    ])
  })

  it('keeps table edit state transitions independent from the Vue workspace', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1782000000000)
    const tab = {
      columns: ['id', 'status'],
      primaryKey: ['id'],
      dirtyState: makeDirtyState([{ id: 1, status: 'open' }], ['id']),
      undoStack: [],
      selectedRowKey: JSON.stringify([1]),
      saveError: null,
      mutationPlan: makeDataMutationPlanState({ statementCount: 1, preview: 'update' })
    }

    expect(updateDataCellState(tab, JSON.stringify([1]), 'status', 'closed')).toEqual({ changed: true })
    expect(tab.dirtyState.updatedCells.get(JSON.stringify([1]))).toEqual({ status: 'closed' })
    expect(buildDataMutationPayload(tab)).toEqual([
      {
        kind: 'update',
        rowKey: JSON.stringify([1]),
        primaryKey: ['id'],
        patch: { status: 'closed' },
        originalRow: { id: 1, status: 'open' }
      }
    ])
    expect(buildDataEditSummary(tab)).toEqual(expect.objectContaining({ isDirty: true, updatedRows: 1, undoDepth: 1, preview: 'update' }))

    expect(undoDataChangesState(tab)).toEqual({ changed: true, notice: 'Last data edit reverted' })
    expect(tab.dirtyState.updatedCells.size).toBe(0)

    expect(addDataRowState(tab, 'tmp-1')).toEqual({ changed: true, notice: 'New row added locally' })
    expect(updateNewDataRowCellState(tab, 'tmp-1', 'status', 'draft')).toEqual({ changed: true })
    expect(tab.dirtyState.newRows[0].values).toEqual({ id: null, status: 'draft' })
    expect(deleteSelectedDataRowState(tab)).toEqual({ changed: true, notice: 'New row removed' })
    expect(tab.dirtyState.newRows).toEqual([])

    tab.selectedRowKey = JSON.stringify([1])
    expect(deleteSelectedDataRowState(tab)).toEqual({ changed: true, notice: 'Row marked for deletion' })
    expect(buildDataMutationPayload(tab)).toEqual([
      {
        kind: 'delete',
        rowKey: JSON.stringify([1]),
        primaryKey: ['id'],
        originalRow: { id: 1, status: 'open' }
      }
    ])
  })
})
