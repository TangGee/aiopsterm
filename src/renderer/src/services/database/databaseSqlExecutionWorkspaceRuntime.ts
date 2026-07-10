import { computed, reactive, type ComputedRef } from 'vue'
import { applyFilters, applySort, type DbFilter } from '@/services/database/databaseGridRuntime'
import { currentSqlStatement, firstStatement, formatSqlText, splitSqlStatements } from '@/services/database/databaseSqlEditorRuntime'
import {
  appendSqlHistoryFromExecution,
  applySqlResultFilter,
  closeSqlResultTab,
  createRunningSqlResult,
  createSqlResultViewState,
  cycleSqlResultSort,
  defaultSqlFileName as runtimeDefaultSqlFileName,
  emptySqlResultViewState,
  fileNameFromPath,
  gotoLastSqlResultPage as gotoLastSqlResultPageState,
  isSqlHistoryClosed as isRuntimeSqlHistoryClosed,
  openSqlHistoryResult as openRuntimeSqlHistoryResult,
  patchSqlResult,
  setSqlResultPage,
  setSqlResultPageSize,
  sqlOutcomeFromBackendResult,
  type SqlTab
} from '@/services/database/databaseSqlDataRuntime'
import { isLocalFileWriteData } from '@/services/database/databaseBackendGuards'
import { databaseCatalogDisplayName } from '@/services/database/databaseWorkspaceRuntime'
import type { SqlHistory, SqlResultViewState } from '@/services/database/databaseWorkspaceTypes'
import type { DatabaseConnectionInfo, DatabaseSqlExecuteInput, DatabaseSqlExecuteResult } from '@shared/contracts/database'
import type { LocalFileWriteResult } from '@shared/contracts/localFiles'

type SqlSavePathResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; filePath: string }
  | { ok: false; error: string }

type SqlFileSaveResult =
  | { ok: true; result: LocalFileWriteResult }
  | { ok: false; error: string }

type DatabaseSqlExecutionWorkspaceRuntimeState = {
  activeSqlTab: ComputedRef<SqlTab | null>
  activeSqlCanRun: ComputedRef<boolean>
}

type DatabaseSqlExecutionWorkspaceRuntimeDeps = {
  showNotice: (message: string) => void
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
  getSqlSelectionRange: () => { start: number; end: number }
  setEditorSql: (nextSql: string, selectionStart: number, selectionEnd?: number) => void
  backend: {
    executeSql: (input: DatabaseSqlExecuteInput) => Promise<DatabaseSqlExecuteResult>
    pickSqlSavePath: (defaultPath: string) => Promise<SqlSavePathResult>
    saveSqlFile: (filePath: string, content: string) => Promise<SqlFileSaveResult>
    sqlFileWriterUnavailableError: () => string
  }
}

const SQL_FILE_WRITE_MALFORMED_MESSAGE = 'SQL file writer returned malformed result data.'

export const createDatabaseSqlExecutionWorkspaceRuntime = (
  state: DatabaseSqlExecutionWorkspaceRuntimeState,
  deps: DatabaseSqlExecutionWorkspaceRuntimeDeps
) => {
  const { activeSqlTab, activeSqlCanRun } = state
  const { showNotice, findConnection, getSelectedSqlText, getSqlCursorOffset, getSqlSelectionRange, setEditorSql, backend } = deps

  const resultSeq = { value: 1 }
  const sqlResultViewStateById = reactive<Record<string, SqlResultViewState>>({})

  const activeSqlResult = computed(() => {
    const tab = activeSqlTab.value
    if (!tab || tab.activeResultTabId === 'overview') return null
    return tab.resultTabs.find((result) => result.id === tab.activeResultTabId) ?? null
  })

  const activeSqlResultViewState = computed(() => {
    const result = activeSqlResult.value
    return result ? getOrCreateSqlResultViewState(result.id) : emptySqlResultViewState
  })

  const filteredSqlRows = computed(() => {
    const result = activeSqlResult.value
    if (!result || result.status === 'error') return []
    const state = activeSqlResultViewState.value
    return applySort(applyFilters(result.rows, state.filters), state.sort)
  })

  const pagedSqlRows = computed(() => {
    const result = activeSqlResult.value
    if (!result || result.status === 'error') return []
    const state = activeSqlResultViewState.value
    const start = (state.page - 1) * state.pageSize
    return filteredSqlRows.value.slice(start, start + state.pageSize)
  })

  const getOrCreateSqlResultViewState = (resultId: string): SqlResultViewState => {
    let state = sqlResultViewStateById[resultId]
    if (!state) {
      state = createSqlResultViewState()
      sqlResultViewStateById[resultId] = state
    }
    return state
  }

  const updateActiveSql = (value: string) => {
    const tab = activeSqlTab.value
    if (!tab) return
    tab.sql = value
  }

  const runSql = async (mode: 'all' | 'current' | 'explain') => {
    const tab = activeSqlTab.value
    if (!tab || !activeSqlCanRun.value) return
    const sql = resolveSqlForRun(tab, mode)
    const statements = splitSqlStatements(sql)
    if (!statements.length) {
      showNotice('SQL is empty')
      return
    }
    await appendSqlExecutions(tab, statements)
  }

  const appendSqlExecution = async (tab: SqlTab, sql: string) => {
    const statements = splitSqlStatements(sql)
    if (!statements.length) return
    await appendSqlExecutions(tab, statements)
  }

  const appendSqlExecutions = async (tab: SqlTab, statements: string[]) => {
    const results = prepareSqlExecutionResults(tab, statements)
    if (!results.length) return
    tab.activeResultTabId = results[0].id

    for (let index = 0; index < statements.length; index += 1) {
      const sql = statements[index]
      const result = results[index]
      const response = await executeSqlThroughBackend(tab, sql)
      const outcome = sqlOutcomeFromBackendResult(response)

      patchSqlResult(tab, result.id, outcome.payload)
      if (outcome.execution) {
        appendSqlHistoryFromExecution(tab, result, sql, outcome.execution)
      }
    }
  }

  const prepareSqlExecutionResults = (tab: SqlTab, statements: string[]) => {
    const reusable = tab.resultTabs.filter((result) => result.status !== 'running' && !result.pinned)
    if (statements.length === 1) {
      const activeIndex = reusable.findIndex((result) => result.id === tab.activeResultTabId)
      if (activeIndex > 0) reusable.unshift(...reusable.splice(activeIndex, 1))
    }
    const reusableIds = reusable.slice(0, statements.length).map((result) => result.id)
    reusable.slice(statements.length).forEach((result) => closeSqlResultTab(tab, result.id, sqlResultViewStateById))

    return statements.map((sql, index) => {
      const running = createRunningSqlResult(tab, sql, resultSeq.value++, index + 1)
      const reusableId = reusableIds[index]
      if (!reusableId) {
        tab.resultTabs.push(running)
        return running
      }
      const resultIndex = tab.resultTabs.findIndex((result) => result.id === reusableId)
      if (resultIndex === -1) {
        tab.resultTabs.push(running)
        return running
      }
      tab.history.forEach((history) => {
        if (history.resultTabId === reusableId) history.resultTabId = null
      })
      delete sqlResultViewStateById[reusableId]
      const reused = { ...running, id: reusableId }
      tab.resultTabs[resultIndex] = reused
      return reused
    })
  }

  const runSqlFromShortcut = () => {
    const selected = getSelectedSqlText()
    void runSql(selected.trim() ? 'current' : 'all')
  }

  const resolveSqlForRun = (tab: SqlTab, mode: 'all' | 'current' | 'explain') => {
    if (mode === 'all') return tab.sql.trim()
    if (mode === 'current') return getSelectedSqlText().trim() || currentSqlStatement(tab.sql, getSqlCursorOffset()).trim()
    const statement = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || firstStatement(tab.sql)
    return statement ? `EXPLAIN ${stripExplainPrefix(statement)}` : ''
  }

  const executeSqlThroughBackend = async (tab: SqlTab, sql: string): Promise<DatabaseSqlExecuteResult> => {
    const connection = findConnection(tab.connectionId)
    return backend.executeSql({
      connectionId: tab.connectionId,
      dbType: connection?.dbType,
      sql,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName
    })
  }

  const defaultSqlFileName = (tab: SqlTab) => {
    const connection = findConnection(tab.connectionId)
    const catalogDisplayName = databaseCatalogDisplayName(connection, { name: tab.catalogName })
    return runtimeDefaultSqlFileName(tab, connection?.name, catalogDisplayName)
  }

  const pickSqlSavePath = async (tab: SqlTab) => {
    return backend.pickSqlSavePath(tab.filePath || defaultSqlFileName(tab))
  }

  const saveActiveSql = async (forceSaveAs: boolean) => {
    const tab = activeSqlTab.value
    if (!tab || tab.saving) return
    const writerUnavailable = backend.sqlFileWriterUnavailableError()
    if (writerUnavailable) {
      tab.saveError = writerUnavailable
      showNotice(tab.saveError)
      return
    }
    tab.saving = true
    tab.saveError = null
    try {
      let targetPath = forceSaveAs ? '' : tab.filePath || ''
      if (!targetPath) {
        const picked = await pickSqlSavePath(tab)
        if (!picked.ok) {
          tab.saveError = picked.error
          showNotice(tab.saveError)
          return
        }
        if (picked.canceled) {
          showNotice('SQL save cancelled')
          return
        }
        targetPath = picked.filePath
      }
      const write = await backend.saveSqlFile(targetPath, tab.sql)
      if (!write.ok) {
        tab.saveError = write.error
        showNotice(tab.saveError)
        return
      }
      if (write.result?.ok !== true) {
        tab.saveError = write.result?.errorMessage || 'SQL file save failed'
        showNotice(tab.saveError)
        return
      }
      if (!isLocalFileWriteData(write.result.data, targetPath, tab.sql)) {
        tab.saveError = SQL_FILE_WRITE_MALFORMED_MESSAGE
        showNotice(tab.saveError)
        return
      }
      tab.filePath = targetPath
      tab.savedSql = tab.sql
      tab.saveError = null
      showNotice(`SQL saved to ${fileNameFromPath(targetPath)}`)
    } finally {
      tab.saving = false
    }
  }

  const stripExplainPrefix = (sql: string) => sql.replace(/^\s*explain\s+/i, '').trim()

  const closeResultTab = (resultId: string) => {
    const tab = activeSqlTab.value
    if (!tab) return
    closeSqlResultTab(tab, resultId, sqlResultViewStateById)
  }

  const openSqlHistoryResult = (history: SqlHistory) => {
    const tab = activeSqlTab.value
    if (!tab) return
    openRuntimeSqlHistoryResult(tab, history)
  }

  const isSqlHistoryClosed = (history: SqlHistory) => isRuntimeSqlHistoryClosed(activeSqlTab.value, history)

  const updateSqlResultActiveTab = (resultTabId: string) => {
    const tab = activeSqlTab.value
    if (!tab) return
    tab.activeResultTabId = resultTabId
  }

  const toggleResultTabPinned = (resultId: string) => {
    const tab = activeSqlTab.value
    const result = tab?.resultTabs.find((item) => item.id === resultId)
    if (!result) return
    result.pinned = !result.pinned
  }

  const updateSqlResultPage = (page: number) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    setSqlResultPage(state, page, filteredSqlRows.value.length)
  }

  const updateSqlResultPageSize = (size: number) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    setSqlResultPageSize(state, size, filteredSqlRows.value.length)
  }

  const gotoLastSqlResultPage = () => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    gotoLastSqlResultPageState(state, filteredSqlRows.value.length)
  }

  const cycleSqlSort = (column: string) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    cycleSqlResultSort(state, column)
  }

  const applySqlFilter = (column: string, filter: DbFilter | null) => {
    const result = activeSqlResult.value
    if (!result) return
    const state = getOrCreateSqlResultViewState(result.id)
    applySqlResultFilter(state, column, filter)
  }

  const formatSql = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    const range = getSqlSelectionRange()
    const hasSelection = range.start !== range.end
    const source = hasSelection ? tab.sql.slice(range.start, range.end) : tab.sql
    if (!source.trim()) {
      showNotice('SQL is empty')
      return
    }
    const formatted = formatSqlText(source)
    if (hasSelection) {
      const nextSql = `${tab.sql.slice(0, range.start)}${formatted}${tab.sql.slice(range.end)}`
      setEditorSql(nextSql, range.start, range.start + formatted.length)
    } else {
      setEditorSql(formatted, formatted.length)
    }
    showNotice('SQL formatted')
  }

  return {
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
    toggleResultTabPinned,
    updateSqlResultPage,
    updateSqlResultPageSize,
    gotoLastSqlResultPage,
    cycleSqlSort,
    applySqlFilter,
    formatSql
  }
}
