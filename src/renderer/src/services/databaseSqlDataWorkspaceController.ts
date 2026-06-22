import { reactive, type ComputedRef, type Ref } from 'vue'
import {
  createDatabaseDataTabWorkspaceRuntime,
  type DatabaseTableContext
} from '@/services/databaseDataTabWorkspaceRuntime'
import { createDatabaseSqlDataBackend } from '@/services/databaseSqlDataBackend'
import { createDatabaseSqlExecutionWorkspaceRuntime } from '@/services/databaseSqlExecutionWorkspaceRuntime'
import {
  buildDataPageExportInput,
  buildSqlResultExportInput,
  dataPageChartSource,
  dataPageCommentKey,
  sqlResultChartSource,
  sqlResultCommentKey,
  type DataTab,
  type SqlTab
} from '@/services/databaseSqlDataRuntime'
import {
  isDatabaseExportData,
  isDatabasePageCommentGetData,
  isDatabasePageCommentSaveData
} from '@/services/databaseBackendGuards'
import {
  buildChartSummary,
  databasePageCommentKeyId,
  type DatabaseChartSource
} from '@/services/databaseWorkspaceRuntime'
import type {
  DatabaseChartModalState,
  DatabaseCommentModalState,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseExportInput,
  DatabasePageCommentKey,
  DatabaseTableInfo
} from '@shared/contracts/database'

type TableContext = DatabaseTableContext

type DatabaseSqlDataWorkspaceControllerState = {
  tabs: Ref<WorkspaceTab[]>
  activeTabId: Ref<string>
  activeSqlTab: ComputedRef<SqlTab | null>
  activeDataTab: ComputedRef<DataTab | null>
  activeSqlCanRun: ComputedRef<boolean>
}

type DatabaseSqlDataWorkspaceControllerDeps = {
  showNotice: (message: string) => void
  copyText: (value: string) => Promise<boolean>
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  errorToMessage: (error: unknown) => string
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  findTable: (connectionId: string, catalogName: string, tableId: string, schemaName?: string) => DatabaseTableInfo | null
  tableContextMatches: (tab: Extract<WorkspaceTab, { kind: 'sql' | 'data' }>, ctx: TableContext) => boolean
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
  getSqlSelectionRange: () => { start: number; end: number }
  setEditorSql: (nextSql: string, selectionStart: number, selectionEnd?: number) => void
}

export const createDatabaseSqlDataWorkspaceController = (
  state: DatabaseSqlDataWorkspaceControllerState,
  deps: DatabaseSqlDataWorkspaceControllerDeps
) => {
  const { tabs, activeTabId, activeSqlTab, activeDataTab, activeSqlCanRun } = state
  const {
    showNotice,
    copyText,
    bridgeErrorMessage,
    errorToMessage,
    findConnection,
    findTable,
    tableContextMatches,
    getSelectedSqlText,
    getSqlCursorOffset,
    getSqlSelectionRange,
    setEditorSql
  } = deps

  const backend = createDatabaseSqlDataBackend({ bridgeErrorMessage, errorToMessage })

  const chartModal = reactive<DatabaseChartModalState>({
    open: false,
    summary: null,
    error: ''
  })
  const commentModal = reactive<DatabaseCommentModalState>({
    open: false,
    title: '',
    scopeLabel: '',
    key: null,
    draft: '',
    updatedAt: 0,
    loading: false,
    saving: false,
    error: ''
  })

  const {
    activeSqlResult,
    activeSqlResultViewState,
    filteredSqlRows,
    pagedSqlRows,
    updateActiveSql,
    runSql,
    appendSqlExecution,
    runSqlFromShortcut,
    saveActiveSql,
    closeResultTab,
    openSqlHistoryResult,
    isSqlHistoryClosed,
    updateSqlResultActiveTab,
    updateSqlResultPage,
    updateSqlResultPageSize,
    gotoLastSqlResultPage,
    cycleSqlSort,
    applySqlFilter,
    formatSql
  } = createDatabaseSqlExecutionWorkspaceRuntime(
    { activeSqlTab, activeSqlCanRun },
    {
      showNotice,
      findConnection,
      getSelectedSqlText,
      getSqlCursorOffset,
      getSqlSelectionRange,
      setEditorSql,
      backend
    }
  )

  const {
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
  } = createDatabaseDataTabWorkspaceRuntime(
    { tabs, activeTabId, activeDataTab },
    {
      showNotice,
      copyText,
      findConnection,
      findTable,
      tableContextMatches,
      backend
    }
  )

  const exportDatabaseRowsThroughBackend = async (input: DatabaseExportInput) => {
    const result = await backend.exportRows(input)
    if (!result.ok) {
      showNotice(result.errorMessage || 'Database export failed')
      return null
    }
    if (!isDatabaseExportData(result.data)) {
      showNotice('Database export backend returned malformed result data.')
      return null
    }
    if (result.data.canceled) {
      showNotice('Database export cancelled')
      return result.data
    }
    showNotice(`Exported ${result.data.exported} row${result.data.exported === 1 ? '' : 's'} to ${result.data.fileName}`)
    return result.data
  }

  const exportActiveSqlResultPage = () => {
    const tab = activeSqlTab.value
    const result = activeSqlResult.value
    if (!tab || !result || result.status !== 'ok' || !pagedSqlRows.value.length) {
      showNotice('No SQL result rows to export')
      return null
    }
    const connection = findConnection(tab.connectionId)
    return exportDatabaseRowsThroughBackend(buildSqlResultExportInput(tab, result, pagedSqlRows.value, activeSqlResultViewState.value, filteredSqlRows.value.length, connection?.name))
  }

  const exportActiveDataPage = () => {
    const tab = activeDataTab.value
    if (!tab || tab.loading || tab.error || !pagedDataRows.value.length) {
      showNotice('No table rows to export')
      return null
    }
    const connection = findConnection(tab.connectionId)
    return exportDatabaseRowsThroughBackend(buildDataPageExportInput(tab, pagedDataRows.value, connection?.name))
  }

  const openChartModal = (source: DatabaseChartSource) => {
    chartModal.summary = buildChartSummary(source)
    chartModal.error = chartModal.summary ? '' : 'Current page does not contain a numeric column to chart.'
    chartModal.open = true
    if (!chartModal.summary) showNotice(chartModal.error)
  }

  const closeChartModal = () => {
    chartModal.open = false
  }

  const updateCommentDraft = (value: string) => {
    commentModal.draft = value
  }

  const openActiveSqlResultChart = () => {
    const tab = activeSqlTab.value
    const result = activeSqlResult.value
    if (!tab || !result || result.status !== 'ok' || !pagedSqlRows.value.length) {
      showNotice('No SQL result rows to chart')
      return
    }
    openChartModal(sqlResultChartSource(tab, result, pagedSqlRows.value, activeSqlResultViewState.value.page))
  }

  const openActiveDataChart = () => {
    const tab = activeDataTab.value
    if (!tab || tab.loading || tab.error || !pagedDataRows.value.length) {
      showNotice('No table rows to chart')
      return
    }
    openChartModal(dataPageChartSource(tab, pagedDataRows.value))
  }

  const openCommentModal = async (input: { title: string; scopeLabel: string; key: DatabasePageCommentKey }) => {
    commentModal.open = true
    commentModal.title = input.title
    commentModal.scopeLabel = input.scopeLabel
    commentModal.key = input.key
    commentModal.draft = ''
    commentModal.updatedAt = 0
    commentModal.loading = true
    commentModal.saving = false
    commentModal.error = ''
    const result = await backend.getPageComment(input.key)
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(input.key)) return
    commentModal.loading = false
    if (!result.ok) {
      commentModal.error = result.errorMessage || 'Database comment load failed'
      showNotice(commentModal.error)
      return
    }
    if (!isDatabasePageCommentGetData(result.data, input.key)) {
      commentModal.error = 'Database comment backend returned malformed result data.'
      showNotice(commentModal.error)
      return
    }
    commentModal.draft = result.data.record.comment
    commentModal.updatedAt = result.data.record.updatedAt
  }

  const openActiveSqlResultComment = () => {
    const tab = activeSqlTab.value
    const result = activeSqlResult.value
    if (!tab || !result || result.status !== 'ok') {
      showNotice('No SQL result context to comment')
      return
    }
    void openCommentModal({
      title: `${tab.title} - ${result.title}`,
      scopeLabel: `SQL result / ${tab.catalogName}${tab.schemaName ? ` / ${tab.schemaName}` : ''}`,
      key: sqlResultCommentKey(tab, result)
    })
  }

  const openActiveDataComment = () => {
    const tab = activeDataTab.value
    if (!tab || tab.loading || tab.error) {
      showNotice('No table page context to comment')
      return
    }
    void openCommentModal({
      title: `${tab.title} - page ${tab.page}`,
      scopeLabel: [tab.catalogName, tab.schemaName, tab.tableName].filter(Boolean).join(' / '),
      key: dataPageCommentKey(tab)
    })
  }

  const saveActiveComment = async () => {
    const key = commentModal.key
    if (!key || commentModal.loading || commentModal.saving) return
    commentModal.saving = true
    commentModal.error = ''
    const result = await backend.savePageComment(key, commentModal.draft)
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(key)) return
    commentModal.saving = false
    if (!result.ok) {
      commentModal.error = result.errorMessage || 'Database comment save failed'
      showNotice(commentModal.error)
      return
    }
    if (!isDatabasePageCommentSaveData(result.data, key)) {
      commentModal.error = 'Database comment backend returned malformed result data.'
      showNotice(commentModal.error)
      return
    }
    commentModal.draft = result.data.record.comment
    commentModal.updatedAt = result.data.record.updatedAt
    showNotice(result.data.message || 'Comment saved')
  }

  const closeCommentModal = () => {
    if (commentModal.saving) return
    commentModal.open = false
  }

  return {
    chartModal,
    commentModal,
    activeDataEditSummary,
    activeSqlResult,
    activeSqlResultViewState,
    activeDataWherePending,
    pagedDataRows,
    filteredSqlRows,
    pagedSqlRows,
    openTable,
    updateActiveSql,
    runSql,
    appendSqlExecution,
    runSqlFromShortcut,
    saveActiveSql,
    closeResultTab,
    openSqlHistoryResult,
    isSqlHistoryClosed,
    updateSqlResultActiveTab,
    updateSqlResultPage,
    updateSqlResultPageSize,
    gotoLastSqlResultPage,
    cycleSqlSort,
    applySqlFilter,
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
    exportActiveSqlResultPage,
    exportActiveDataPage,
    closeChartModal,
    updateCommentDraft,
    openActiveSqlResultChart,
    openActiveDataChart,
    openActiveSqlResultComment,
    openActiveDataComment,
    saveActiveComment,
    closeCommentModal,
    discardDataChanges,
    copyDataMutationPreview,
    refreshDataTab,
    refreshDataTotal,
    reloadDataTab,
    formatSql,
    cleanupDroppedTableUi,
    dataTabsMatching,
    tabIdsMatching
  }
}
