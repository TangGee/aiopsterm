import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import { editorLineHeightPx, type EditorRuntimeSettings } from '@/services/editorRuntime'
import {
  findSqlTextMatches,
  firstSqlFindMatchAtOrAfter,
  sqlCursorPosition,
  type TextRange
} from '@/services/databaseSqlEditorRuntime'
import type { WorkspaceTab } from '@/services/databaseWorkspaceTypes'

export type DatabaseSqlEditorMetrics = {
  line: number
  column: number
  selectionSize: number
  scrollTop: number
}

export type DatabaseSqlEditorWorkspaceApi = {
  getSelectedText(): string
  getTextUntilCursor(): string
  getCursorOffset(): number
  getSelectionRange(): TextRange
  setSelectionRange(start: number, end?: number): void
  focus(): void
  focusSqlFindInput(target: 'query' | 'replace'): void
}

type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>

type DatabaseSqlEditorWorkspaceControllerState = {
  activeSqlTab: ComputedRef<SqlTab | null>
  sqlEditorRef: Ref<DatabaseSqlEditorWorkspaceApi | null>
  editorSettings: Ref<EditorRuntimeSettings>
}

type DatabaseSqlEditorWorkspaceControllerDeps = {
  showNotice: (message: string) => void
}

const SQL_PANE_DEFAULT_PERCENT = 45
const SQL_PANE_MIN_PERCENT = 20
const SQL_PANE_MAX_PERCENT = 80

export const createDatabaseSqlEditorWorkspaceController = (
  state: DatabaseSqlEditorWorkspaceControllerState,
  deps: DatabaseSqlEditorWorkspaceControllerDeps
) => {
  const { activeSqlTab, sqlEditorRef, editorSettings } = state
  const { showNotice } = deps

  const sqlPaneEditorPercent = ref(SQL_PANE_DEFAULT_PERCENT)
  const sqlPaneResizing = ref(false)
  const sqlEditorScrollTop = ref(0)
  const sqlEditorActiveLine = ref(1)
  const sqlEditorActiveColumn = ref(1)
  const sqlEditorSelectionSize = ref(0)
  const sqlFindOpen = ref(false)
  const sqlFindReplaceOpen = ref(false)
  const sqlFindQuery = ref('')
  const sqlFindReplace = ref('')
  const sqlFindCaseSensitive = ref(false)
  const sqlFindActiveIndex = ref(-1)
  let sqlPaneResizeElement: HTMLElement | null = null

  const sqlEditorLineHeight = computed(() => editorLineHeightPx(editorSettings.value))
  const sqlPaneStyle = computed(() => ({
    '--db-sql-editor-percent': `${sqlPaneEditorPercent.value}%`,
    '--db-sql-result-percent': `${100 - sqlPaneEditorPercent.value}%`,
    '--db-sql-editor-ratio': `${sqlPaneEditorPercent.value}fr`,
    '--db-sql-result-ratio': `${100 - sqlPaneEditorPercent.value}fr`
  }))
  const activeSqlEditorLineCount = computed(() => Math.max(1, (activeSqlTab.value?.sql.match(/\n/g)?.length ?? 0) + 1))
  const activeSqlEditorLines = computed(() => Array.from({ length: activeSqlEditorLineCount.value }, (_, index) => index + 1))
  const sqlEditorActiveLineTop = computed(() => Math.max(0, (sqlEditorActiveLine.value - 1) * sqlEditorLineHeight.value - sqlEditorScrollTop.value))
  const sqlFindMatches = computed<TextRange[]>(() => findSqlTextMatches(activeSqlTab.value?.sql ?? '', sqlFindQuery.value, sqlFindCaseSensitive.value))
  const sqlFindSummary = computed(() => {
    if (!sqlFindQuery.value) return 'Find'
    if (!sqlFindMatches.value.length) return 'No results'
    return `${sqlFindActiveIndex.value >= 0 ? sqlFindActiveIndex.value + 1 : 0}/${sqlFindMatches.value.length}`
  })

  const getSelectedSqlText = () => sqlEditorRef.value?.getSelectedText() ?? ''

  const getSqlCursorOffset = () => {
    const editor = sqlEditorRef.value
    if (!editor) return activeSqlTab.value?.sql.length ?? 0
    return editor.getCursorOffset()
  }

  const getSqlSelectionRange = (): TextRange => {
    const editor = sqlEditorRef.value
    const length = activeSqlTab.value?.sql.length ?? 0
    if (!editor) return { start: length, end: length }
    return editor.getSelectionRange()
  }

  const getSqlTextUntilCursor = () => activeSqlTab.value?.sql.slice(0, getSqlCursorOffset()) ?? ''

  const syncSqlEditorState = (metrics?: DatabaseSqlEditorMetrics) => {
    if (!metrics) {
      const tab = activeSqlTab.value
      const position = sqlCursorPosition(tab?.sql ?? '', sqlEditorRef.value?.getCursorOffset() ?? 0)
      sqlEditorActiveLine.value = Math.max(1, Math.min(position.line, activeSqlEditorLineCount.value))
      sqlEditorActiveColumn.value = Math.max(1, position.column)
      sqlEditorSelectionSize.value = 0
      sqlEditorScrollTop.value = 0
      return
    }
    sqlEditorActiveLine.value = Math.max(1, Math.min(metrics.line, activeSqlEditorLineCount.value))
    sqlEditorActiveColumn.value = Math.max(1, metrics.column)
    sqlEditorSelectionSize.value = Math.max(0, metrics.selectionSize)
    sqlEditorScrollTop.value = Math.max(0, metrics.scrollTop)
  }

  const setSqlEditorSelection = (selectionStart: number, selectionEnd = selectionStart) => {
    void nextTick(() => {
      const editor = sqlEditorRef.value
      const sql = activeSqlTab.value?.sql ?? ''
      if (!editor) return
      const start = Math.max(0, Math.min(selectionStart, sql.length))
      const end = Math.max(0, Math.min(selectionEnd, sql.length))
      editor.setSelectionRange(start, end)
      syncSqlEditorState()
    })
  }

  const setEditorSql = (nextSql: string, selectionStart: number, selectionEnd = selectionStart) => {
    const tab = activeSqlTab.value
    if (!tab) return
    tab.sql = nextSql
    void nextTick(() => {
      const editor = sqlEditorRef.value
      if (!editor) return
      const start = Math.max(0, Math.min(selectionStart, nextSql.length))
      const end = Math.max(0, Math.min(selectionEnd, nextSql.length))
      editor.focus()
      editor.setSelectionRange(start, end)
      syncSqlEditorState()
    })
  }

  const openSqlFind = (replace: boolean) => {
    if (!activeSqlTab.value) return
    const selected = getSelectedSqlText()
    if (selected && !selected.includes('\n')) sqlFindQuery.value = selected
    sqlFindOpen.value = true
    sqlFindReplaceOpen.value = replace || sqlFindReplaceOpen.value
    alignSqlFindIndexToSelection()
    sqlEditorRef.value?.focusSqlFindInput(replace && sqlFindQuery.value ? 'replace' : 'query')
  }

  const closeSqlFind = (refocusEditor = false) => {
    sqlFindOpen.value = false
    sqlFindReplaceOpen.value = false
    if (refocusEditor) sqlEditorRef.value?.focus()
  }

  const toggleSqlFindReplace = () => {
    sqlFindReplaceOpen.value = !sqlFindReplaceOpen.value
    sqlEditorRef.value?.focusSqlFindInput(sqlFindReplaceOpen.value ? 'replace' : 'query')
  }

  const handleSqlFindKeydown = (event: KeyboardEvent, field: 'query' | 'replace') => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSqlFind(true)
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (field === 'replace') {
      replaceCurrentSqlFindMatch()
      return
    }
    goToSqlFindMatch(event.shiftKey ? -1 : 1)
  }

  const alignSqlFindIndexToSelection = () => {
    const editor = sqlEditorRef.value
    const matches = sqlFindMatches.value
    if (!editor || !matches.length) {
      sqlFindActiveIndex.value = matches.length ? 0 : -1
      return
    }
    const start = editor.getSelectionRange().start
    sqlFindActiveIndex.value = matches.findIndex((match) => match.start === start)
  }

  const selectSqlFindMatch = (index: number) => {
    const matches = sqlFindMatches.value
    if (!matches.length) {
      sqlFindActiveIndex.value = -1
      return
    }
    const nextIndex = ((index % matches.length) + matches.length) % matches.length
    const match = matches[nextIndex]
    sqlFindActiveIndex.value = nextIndex
    setSqlEditorSelection(match.start, match.end)
  }

  const goToSqlFindMatch = (direction: 1 | -1) => {
    const matches = sqlFindMatches.value
    if (!matches.length) {
      sqlFindActiveIndex.value = -1
      return
    }
    if (sqlFindActiveIndex.value < 0) {
      const cursor = sqlEditorRef.value?.getSelectionRange().end ?? 0
      const index = direction > 0 ? firstSqlFindMatchAtOrAfter(cursor, matches) : firstSqlFindMatchAtOrAfter(cursor, matches) - 1
      selectSqlFindMatch(index)
      return
    }
    selectSqlFindMatch(sqlFindActiveIndex.value + direction)
  }

  const replaceCurrentSqlFindMatch = () => {
    const matches = sqlFindMatches.value
    if (!matches.length) return
    const selectedStart = sqlEditorRef.value?.getSelectionRange().start ?? -1
    const activeIndex = matches.findIndex((match) => match.start === selectedStart)
    const match = matches[activeIndex >= 0 ? activeIndex : Math.max(0, sqlFindActiveIndex.value)]
    const sql = activeSqlTab.value?.sql ?? ''
    const nextSql = `${sql.slice(0, match.start)}${sqlFindReplace.value}${sql.slice(match.end)}`
    const nextCursor = match.start + sqlFindReplace.value.length
    setEditorSql(nextSql, match.start, nextCursor)
    void nextTick(() => {
      const nextMatches = sqlFindMatches.value
      sqlFindActiveIndex.value = nextMatches.length ? firstSqlFindMatchAtOrAfter(nextCursor, nextMatches) : -1
      if (nextMatches.length) selectSqlFindMatch(sqlFindActiveIndex.value)
    })
  }

  const replaceAllSqlFindMatches = () => {
    const matches = sqlFindMatches.value
    const sql = activeSqlTab.value?.sql ?? ''
    if (!matches.length) return
    const nextSql = matches
      .slice()
      .reverse()
      .reduce((text, match) => `${text.slice(0, match.start)}${sqlFindReplace.value}${text.slice(match.end)}`, sql)
    setEditorSql(nextSql, matches[0].start, matches[0].start + sqlFindReplace.value.length)
    sqlFindActiveIndex.value = -1
    showNotice(`Replaced ${matches.length} match${matches.length > 1 ? 'es' : ''}`)
  }

  const clampSqlPanePercent = (value: number) => {
    if (!Number.isFinite(value)) return SQL_PANE_DEFAULT_PERCENT
    return Math.min(SQL_PANE_MAX_PERCENT, Math.max(SQL_PANE_MIN_PERCENT, value))
  }

  const updateSqlPaneSplitFromPointer = (event: PointerEvent | MouseEvent) => {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    const panes = sqlPaneResizeElement ?? target?.closest<HTMLElement>('.db-sql-panes') ?? document.querySelector<HTMLElement>('.db-sql-panes')
    if (!panes) return
    const rect = panes.getBoundingClientRect()
    if (!rect.height) return
    const raw = ((event.clientY - rect.top) / rect.height) * 100
    sqlPaneEditorPercent.value = Math.round(clampSqlPanePercent(raw) * 10) / 10
  }

  const handleSqlPaneResizeMove = (event: PointerEvent | MouseEvent) => {
    if (!sqlPaneResizing.value) return
    updateSqlPaneSplitFromPointer(event)
  }

  const stopSqlPaneResize = () => {
    if (!sqlPaneResizing.value) return
    sqlPaneResizing.value = false
    sqlPaneResizeElement = null
    window.removeEventListener('pointermove', handleSqlPaneResizeMove)
    window.removeEventListener('pointerup', stopSqlPaneResize)
    window.removeEventListener('mousemove', handleSqlPaneResizeMove)
    window.removeEventListener('mouseup', stopSqlPaneResize)
  }

  const startSqlPaneResize = (event: PointerEvent) => {
    event.preventDefault()
    sqlPaneResizeElement = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.db-sql-panes') ?? null
    sqlPaneResizing.value = true
    updateSqlPaneSplitFromPointer(event)
    window.addEventListener('pointermove', handleSqlPaneResizeMove)
    window.addEventListener('pointerup', stopSqlPaneResize)
    window.addEventListener('mousemove', handleSqlPaneResizeMove)
    window.addEventListener('mouseup', stopSqlPaneResize)
  }

  const resetSqlPaneSplit = () => {
    sqlPaneEditorPercent.value = SQL_PANE_DEFAULT_PERCENT
  }

  watch(
    () => [activeSqlTab.value?.id ?? '', activeSqlTab.value?.sql ?? ''] as const,
    async () => {
      await nextTick()
      syncSqlEditorState()
    },
    { immediate: true }
  )

  watch([sqlFindQuery, sqlFindCaseSensitive, () => activeSqlTab.value?.id ?? ''], () => {
    const matches = sqlFindMatches.value
    if (!sqlFindOpen.value || !matches.length) {
      sqlFindActiveIndex.value = -1
      return
    }
    alignSqlFindIndexToSelection()
  })

  return {
    SQL_PANE_MIN_PERCENT,
    SQL_PANE_MAX_PERCENT,
    sqlPaneEditorPercent,
    sqlPaneResizing,
    sqlEditorScrollTop,
    sqlEditorActiveLine,
    sqlEditorActiveColumn,
    sqlEditorSelectionSize,
    sqlFindOpen,
    sqlFindReplaceOpen,
    sqlFindQuery,
    sqlFindReplace,
    sqlFindCaseSensitive,
    sqlEditorLineHeight,
    sqlPaneStyle,
    activeSqlEditorLineCount,
    activeSqlEditorLines,
    sqlEditorActiveLineTop,
    sqlFindMatches,
    sqlFindSummary,
    getSelectedSqlText,
    getSqlCursorOffset,
    getSqlSelectionRange,
    getSqlTextUntilCursor,
    syncSqlEditorState,
    setEditorSql,
    openSqlFind,
    closeSqlFind,
    toggleSqlFindReplace,
    handleSqlFindKeydown,
    goToSqlFindMatch,
    replaceCurrentSqlFindMatch,
    replaceAllSqlFindMatches,
    startSqlPaneResize,
    stopSqlPaneResize,
    resetSqlPaneSplit
  }
}
