import { computed, nextTick, type ComputedRef, type Ref } from 'vue'
import {
  addDataRowState,
  buildDataEditSummary,
  deleteSelectedDataRowState,
  isDirtyStateDirty,
  undoDataChangesState,
  updateDataCellState,
  updateNewDataRowCellState,
  type DataMutationPlanState,
  type DbFilter
} from '@/services/database/databaseGridRuntime'
import {
  applyDataFilter as applyDataFilterState,
  applyDataQueryResult,
  applyDataWhere,
  buildDataMutationInput,
  buildDataMutationPlanInput as buildRuntimeDataMutationPlanInput,
  buildDataQueryInput,
  createDataTab,
  cycleDataSort as cycleDataSortState,
  dataEditDisabledReason as runtimeDataEditDisabledReason,
  gotoLastDataPage as gotoLastDataPageState,
  resetDataDirtyState,
  resetDataMutationPlan as resetRuntimeDataMutationPlan,
  setDataMutationPlanError,
  setDataMutationPlanLoading,
  setDataMutationPlanPreview,
  setDataPage,
  setDataPageSize,
  updateDataWhereDraft,
  type DataTab
} from '@/services/database/databaseSqlDataRuntime'
import {
  isDatabaseTableMutationData,
  isDatabaseTableMutationPlanData,
  isDatabaseTableQueryData
} from '@/services/database/databaseBackendGuards'
import type { WorkspaceTab } from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseTableInfo,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from '@shared/contracts/database'

export type DatabaseTableContext = {
  connectionId: string
  catalogName: string
  schemaName?: string
  tableId?: string
  tableName: string
}

type TableReloadOptions = { withTotal?: boolean; preserveDirty?: boolean; notice?: string }

type DatabaseDataTabWorkspaceRuntimeState = {
  tabs: Ref<WorkspaceTab[]>
  activeTabId: Ref<string>
  activeDataTab: ComputedRef<DataTab | null>
}

type DatabaseDataTabWorkspaceRuntimeDeps = {
  showNotice: (message: string) => void
  copyText: (value: string) => Promise<boolean>
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  findTable: (connectionId: string, catalogName: string, tableId: string, schemaName?: string) => DatabaseTableInfo | null
  tableContextMatches: (tab: Extract<WorkspaceTab, { kind: 'sql' | 'data' }>, ctx: DatabaseTableContext) => boolean
  backend: {
    queryTable: (input: DatabaseTableQueryInput) => Promise<DatabaseTableQueryResult>
    planTableMutation: (input: DatabaseTableMutationPlanInput) => Promise<DatabaseTableMutationPlanResult>
    mutateTable: (input: DatabaseTableMutationInput) => Promise<DatabaseTableMutationResult>
  }
}

const DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE = 'Backend table mutation returned malformed result data.'

export const createDatabaseDataTabWorkspaceRuntime = (
  state: DatabaseDataTabWorkspaceRuntimeState,
  deps: DatabaseDataTabWorkspaceRuntimeDeps
) => {
  const { tabs, activeTabId, activeDataTab } = state
  const { showNotice, copyText, findConnection, findTable, tableContextMatches, backend } = deps

  const activeDataEditSummary = computed(() => (activeDataTab.value ? buildDataEditSummary(activeDataTab.value) : null))

  const activeDataWherePending = computed(() => {
    const tab = activeDataTab.value
    return !!tab && tab.whereDraft.trim() !== tab.whereRaw
  })

  const pagedDataRows = computed(() => {
    const tab = activeDataTab.value
    if (!tab) return []
    return tab.rows
  })

  const openTable = async (connectionId: string, catalogName: string, table: DatabaseTableInfo, schemaName?: string) => {
    const existing = tabs.value.find((tab) => tab.kind === 'data' && tab.tableId === table.id && tab.connectionId === connectionId) as
      | WorkspaceTab
      | undefined
    if (existing) {
      activeTabId.value = existing.id
      return
    }
    const tab = createDataTab({ connectionId, catalogName, table, schemaName })
    tabs.value.push(tab)
    activeTabId.value = tab.id
    await nextTick()
    const reactiveTab = tabs.value.find((item) => item.id === tab.id && item.kind === 'data') as DataTab | undefined
    if (reactiveTab) await reloadDataTab(reactiveTab, { preserveDirty: false })
  }

  const updateDataPage = (page: number) => {
    const tab = activeDataTab.value
    if (!tab) return
    setDataPage(tab, page)
    void reloadDataTab(tab)
  }

  const updateDataPageSize = (size: number) => {
    const tab = activeDataTab.value
    if (!tab) return
    setDataPageSize(tab, size)
    void reloadDataTab(tab)
  }

  const updateActiveDataWhereDraft = (value: string) => {
    const tab = activeDataTab.value
    if (!tab) return
    updateDataWhereDraft(tab, value)
  }

  const gotoLastDataPage = () => {
    const tab = activeDataTab.value
    if (!tab) return
    void (async () => {
      if (tab.total === null) await refreshDataTotal()
      const total = tab.total ?? tab.rowCount
      gotoLastDataPageState(tab, total)
      await reloadDataTab(tab)
    })()
  }

  const cycleDataSort = (column: string) => {
    const tab = activeDataTab.value
    if (!tab) return
    cycleDataSortState(tab, column)
    void reloadDataTab(tab)
  }

  const applyDataFilter = (column: string, filter: DbFilter | null) => {
    const tab = activeDataTab.value
    if (!tab) return
    applyDataFilterState(tab, column, filter)
    void reloadDataTab(tab)
  }

  const applyWhere = () => {
    const tab = activeDataTab.value
    if (!tab) return
    applyDataWhere(tab)
    void reloadDataTab(tab)
  }

  const canEditDataTab = (tab: DataTab) => dataEditDisabledReason(tab) === ''

  const dataEditDisabledReason = (tab: DataTab) => {
    const connection = findConnection(tab.connectionId)
    const table = findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)
    return runtimeDataEditDisabledReason(tab, { connection, table, isView: isViewTable(tab) })
  }

  const isDataTabDirty = (tab: DataTab) => isDirtyStateDirty(tab.dirtyState)

  const buildDataMutationPlanInput = (tab: DataTab) => {
    const connection = findConnection(tab.connectionId)
    return buildRuntimeDataMutationPlanInput(tab, connection?.dbType)
  }

  const resetDataMutationPlan = (tab: DataTab) => {
    resetRuntimeDataMutationPlan(tab)
  }

  const refreshDataMutationPlan = async (tab: DataTab, force = false): Promise<DataMutationPlanState> => {
    if (!isDataTabDirty(tab)) {
      resetDataMutationPlan(tab)
      return tab.mutationPlan
    }
    const input = buildDataMutationPlanInput(tab)
    const key = JSON.stringify(input)
    if (!force && tab.mutationPlan.key === key && !tab.mutationPlan.loading) return tab.mutationPlan
    setDataMutationPlanLoading(tab, key)
    const result = await backend.planTableMutation(input)
    if (tab.mutationPlan.key !== key) return tab.mutationPlan
    if (!result.ok) {
      setDataMutationPlanError(tab, key, result.errorMessage || 'Backend table mutation planning failed.')
      return tab.mutationPlan
    }
    if (!isDatabaseTableMutationPlanData(result.data)) {
      setDataMutationPlanError(tab, key, DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
      return tab.mutationPlan
    }
    setDataMutationPlanPreview(tab, {
      key,
      statementCount: result.data.statementCount,
      preview: result.data.preview,
      warning: result.data.warning
    })
    return tab.mutationPlan
  }

  const updateDataCell = (rowKey: string, column: string, value: string) => {
    const tab = activeDataTab.value
    if (!tab || !canEditDataTab(tab) || tab.saving) return
    const result = updateDataCellState(tab, rowKey, column, value)
    if (result.changed) void refreshDataMutationPlan(tab)
  }

  const updateNewDataRowCell = (tmpId: string, column: string, value: string) => {
    const tab = activeDataTab.value
    if (!tab || !canEditDataTab(tab) || tab.saving) return
    const result = updateNewDataRowCellState(tab, tmpId, column, value)
    if (result.changed) void refreshDataMutationPlan(tab)
  }

  const setActiveDataSelectedRow = (key: string) => {
    const tab = activeDataTab.value
    if (!tab) return
    tab.selectedRowKey = key
  }

  const addDataRow = () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    const reason = dataEditDisabledReason(tab)
    if (reason) {
      showNotice(reason)
      return
    }
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const result = addDataRowState(tab, tmpId)
    if (result.changed) void refreshDataMutationPlan(tab)
    if (result.notice) showNotice(result.notice)
  }

  const deleteSelectedDataRow = () => {
    const tab = activeDataTab.value
    if (!tab || !tab.selectedRowKey || tab.saving) return
    const reason = dataEditDisabledReason(tab)
    if (reason) {
      showNotice(reason)
      return
    }
    const result = deleteSelectedDataRowState(tab)
    if (result.changed) void refreshDataMutationPlan(tab)
    if (result.notice) showNotice(result.notice)
  }

  const undoDataChanges = () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    const result = undoDataChangesState(tab)
    if (result.changed) void refreshDataMutationPlan(tab)
    if (result.notice) showNotice(result.notice)
  }

  const saveDataChanges = async () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    const reason = dataEditDisabledReason(tab)
    if (reason) {
      tab.saveError = reason
      showNotice(reason)
      return
    }
    const plan = await refreshDataMutationPlan(tab, true)
    if (plan.error) {
      tab.saveError = plan.error
      showNotice(plan.error)
      return
    }
    if (plan.statementCount === 0) {
      tab.saveError = 'No SQL statement will be generated until a new row contains at least one value.'
      showNotice(tab.saveError)
      return
    }
    tab.saving = true
    tab.saveError = null
    await nextTick()
    try {
      const backendResult = await mutateDataTabThroughBackend(tab)
      if (!backendResult.ok) {
        tab.saveError = backendResult.errorMessage || 'Backend table mutation failed.'
        showNotice(tab.saveError)
        return
      }
      if (!isDatabaseTableMutationData(backendResult.data)) {
        tab.saveError = DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE
        showNotice(tab.saveError)
        return
      }
      await reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false })
      showNotice(`Changes saved through backend table store (${plan.statementCount} statement${plan.statementCount > 1 ? 's' : ''})`)
    } finally {
      tab.saving = false
    }
  }

  const mutateDataTabThroughBackend = (tab: DataTab): Promise<DatabaseTableMutationResult> =>
    mutateDatabaseTableThroughBackend(buildDataMutationInput(tab))

  const mutateDatabaseTableThroughBackend = async (input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> => backend.mutateTable(input)

  const discardDataChanges = () => {
    const tab = activeDataTab.value
    if (!tab || tab.saving) return
    resetDataDirtyState(tab)
    showNotice('Local data edits discarded')
  }

  const copyDataMutationPreview = async () => {
    const summary = activeDataEditSummary.value
    if (!summary?.preview) return
    if (await copyText(summary.preview)) showNotice('Mutation preview copied')
  }

  const refreshDataTab = () => {
    const tab = activeDataTab.value
    if (!tab) return
    void reloadDataTab(tab, { notice: 'Table data refreshed' })
  }

  const refreshDataTotal = async () => {
    const tab = activeDataTab.value
    if (!tab) return
    await reloadDataTab(tab, { withTotal: true, preserveDirty: true, notice: 'Table total refreshed' })
  }

  const reloadDataTab = async (tab: DataTab, options: TableReloadOptions = {}) => {
    const preserveDirty = options.preserveDirty ?? true
    tab.loading = true
    tab.error = null
    try {
      const result = await queryDataTabThroughBackend(tab, options.withTotal ?? false)
      if (!result.ok) {
        tab.error = result.errorMessage || 'Backend table query failed.'
        return
      }
      if (!isDatabaseTableQueryData(result.data)) {
        tab.error = 'Backend table query returned malformed result data.'
        return
      }
      const applied = applyDataQueryResult(tab, result.data, preserveDirty)
      if (applied.retry) return reloadDataTab(tab, options)
      if (applied.dirtyPreserved) {
        void refreshDataMutationPlan(tab)
      }
      if (options.notice) showNotice(options.notice)
    } finally {
      tab.loading = false
    }
  }

  const queryDataTabThroughBackend = (tab: DataTab, withTotal: boolean): Promise<DatabaseTableQueryResult> => {
    const connection = findConnection(tab.connectionId)
    return backend.queryTable(buildDataQueryInput(tab, withTotal, connection?.dbType))
  }

  const isViewTable = (tab: DataTab) => {
    const catalog = findConnection(tab.connectionId)?.catalogs.find((item) => item.name === tab.catalogName)
    if (!catalog) return false
    if (tab.schemaName) {
      const schema = catalog.schemas?.find((item) => item.name === tab.schemaName)
      return !!schema?.views?.some((table) => table.id === tab.tableId)
    }
    return false
  }

  const cleanupDroppedTableUi = (
    droppedContext: DatabaseTableContext & { tableId: string },
    removedTabIds: Set<string>,
    options: {
      ddlOpen: boolean
      setDdlOpen: (open: boolean) => void
      expandedTables: Ref<string[]>
      selectedNodeId: Ref<string | null>
      databaseNodeExists: (id: string | null) => boolean
    }
  ) => {
    tabs.value = tabs.value.filter((tab) => !removedTabIds.has(tab.id))
    if (removedTabIds.has(activeTabId.value)) activeTabId.value = tabs.value[0]?.id ?? 'tab-overview'
    options.expandedTables.value = options.expandedTables.value.filter((id) => id !== droppedContext.tableId)
    if (options.ddlOpen) options.setDdlOpen(false)
    const parentNodeId = droppedContext.schemaName
      ? `${droppedContext.connectionId}:${droppedContext.catalogName}:${droppedContext.schemaName}`
      : `${droppedContext.connectionId}:${droppedContext.catalogName}`
    if (
      options.databaseNodeExists(parentNodeId) &&
      (options.selectedNodeId.value === droppedContext.tableId || options.selectedNodeId.value?.startsWith(`${droppedContext.tableId}:column:`))
    ) {
      options.selectedNodeId.value = parentNodeId
    }
  }

  const dataTabsMatching = (context: DatabaseTableContext) =>
    tabs.value.filter((tab): tab is DataTab => tab.kind === 'data' && tableContextMatches(tab, context))

  const tabIdsMatching = (context: DatabaseTableContext) =>
    new Set(tabs.value.filter((tab) => tab.kind !== 'overview' && tableContextMatches(tab, context)).map((tab) => tab.id))

  return {
    activeDataEditSummary,
    activeDataWherePending,
    pagedDataRows,
    openTable,
    updateDataPage,
    updateDataPageSize,
    updateActiveDataWhereDraft,
    gotoLastDataPage,
    cycleDataSort,
    applyDataFilter,
    applyWhere,
    canEditDataTab,
    dataEditDisabledReason,
    isDataTabDirty,
    resetDataMutationPlan,
    refreshDataMutationPlan,
    updateDataCell,
    updateNewDataRowCell,
    setActiveDataSelectedRow,
    addDataRow,
    deleteSelectedDataRow,
    undoDataChanges,
    saveDataChanges,
    mutateDatabaseTableThroughBackend,
    discardDataChanges,
    copyDataMutationPreview,
    refreshDataTab,
    refreshDataTotal,
    reloadDataTab,
    cleanupDroppedTableUi,
    dataTabsMatching,
    tabIdsMatching
  }
}
