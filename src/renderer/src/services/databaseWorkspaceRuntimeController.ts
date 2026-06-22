import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { createDatabaseCatalogConnectionWorkspaceController } from '@/services/databaseCatalogConnectionWorkspaceController'
import { createDatabaseAiWorkspaceController } from '@/services/databaseAiWorkspaceController'
import { createDatabaseSqlDataWorkspaceController } from '@/services/databaseSqlDataWorkspaceController'
import { createDatabaseSqlEditorWorkspaceController } from '@/services/databaseSqlEditorWorkspaceController'
import { createDatabaseWorkspaceCatalogRuntime } from '@/services/databaseWorkspaceCatalogRuntime'
import type { DatabaseMainWorkspaceApi } from '@/components/database/DatabaseMainWorkspace.vue'
import { makeDirtyState } from '@/services/databaseGridRuntime'
import {
  isDatabaseConnectionMutationDataForRequest,
  isDatabaseTableMutationData,
} from '@/services/databaseBackendGuards'
import {
  canCreateDatabaseForConnection,
  collectDescendantGroupIds,
  DB_AI_PANE_MAX_WIDTH,
  DB_AI_PANE_MIN_WIDTH,
  DEFAULT_GROUP_ID,
  formatDdlError,
  groupPathLabel,
  quoteIdentForDialect,
  quoteIdentifier
} from '@/services/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  ContextSubmenu,
  DatabaseOperationConfirmAction,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import { useWorkspaceStore } from '@/stores/workspace'
import type {
  DatabaseConnectionMutationResult,
  DatabaseConnectionInfo,
  DatabaseEngineCode
} from '@shared/contracts/database'

export const useDatabaseWorkspaceRuntime = () => {

  const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'
  const workspaceStore = useWorkspaceStore()

  const overflowOpen = ref(false)
  const addMenuOpen = ref(false)
  const addMenuPosition = ref({ x: 0, y: 0 })
  const contextMenu = ref<ContextMenu | null>(null)
  const contextSubmenu = ref<ContextSubmenu>(null)
  const notice = ref('')
  const noticeTimer = ref<number | null>(null)
  const editingGroupId = ref<string | null>(null)
  const editingGroupName = ref('')

  const tabs = ref<WorkspaceTab[]>([{ id: 'tab-overview', kind: 'overview', title: 'Overview' }])
  const activeTabId = ref('tab-overview')
  const sqlEditorRef = ref<DatabaseMainWorkspaceApi | null>(null)

  const connectionModalOpen = ref(false)
  const connectionModalMode = ref<'create' | 'edit'>('create')
  const connectionFeedback = ref('')
  const connectionFeedbackKind = ref<'info' | 'error'>('info')
  const connectionErrors = ref<string[]>([])
  const connectionUrlDirty = ref(false)
  const passwordVisible = ref(false)
  const connectionTesting = ref(false)
  const connectionSaving = ref(false)
  const postgresSslModeOptions = ['disable', 'require', 'verify-ca', 'verify-full'] as const
  const connectionDraft = reactive({
    id: '',
    dbType: 'mysql' as DatabaseEngineCode,
    name: '',
    env: 'Development' as DatabaseConnectionInfo['env'],
    groupId: 'group-default',
    host: '127.0.0.1',
    port: 3306 as number | null,
    authentication: 'UserAndPassword' as DatabaseConnectionInfo['authentication'],
    user: 'root',
    password: '',
    database: '',
    filePath: '',
    readonly: false,
    sslMode: '' as NonNullable<DatabaseConnectionInfo['sslMode']>,
    needProxy: false,
    proxyName: '',
    url: ''
  })

  const createDatabaseModal = reactive({
    open: false,
    connectionId: '',
    dbType: 'mysql' as Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'sqlserver' | 'clickhouse'>,
    name: '',
    sql: '',
    userEditedSql: false,
    lastAppliedTemplate: '',
    submitting: false,
    feedback: '',
    feedbackKind: 'info' as 'info' | 'error'
  })
  const ddlModal = reactive({
    open: false,
    tableName: '',
    ddl: '',
    connectionId: '',
    catalogName: '',
    schemaName: '',
    tableId: '',
    loading: false,
    error: '',
    errorCode: '' as '' | 'permission' | 'other'
  })
  const databaseAiPanelsRef = ref<{ scrollPaneMessagesToBottom: () => void } | null>(null)
  const dangerConfirm = reactive({
    open: false,
    action: 'drop' as 'drop' | 'truncate',
    connectionId: '',
    catalogName: '',
    schemaName: '',
    tableId: '',
    tableName: '',
    sql: '',
    confirmText: ''
  })
  const operationConfirm = reactive({
    open: false,
    action: '' as DatabaseOperationConfirmAction | '',
    targetId: '',
    title: '',
    message: '',
    detail: '',
    confirmLabel: 'Delete'
  })

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value))
  const activeSqlTab = computed(() => (activeTab.value?.kind === 'sql' ? activeTab.value : null))
  const activeDataTab = computed(() => (activeTab.value?.kind === 'data' ? activeTab.value : null))

  const markDataTabMissing = (tab: Extract<WorkspaceTab, { kind: 'data' }>, message: string) => {
    tab.error = message
    tab.rows = []
    tab.rowCount = 0
    tab.total = 0
    tab.dirtyState = makeDirtyState([], tab.primaryKey)
    tab.undoStack = []
    resetDataMutationPlan(tab)
  }

  const catalogRuntime = createDatabaseWorkspaceCatalogRuntime({
    tabs,
    activeTab,
    activeSqlTab
  }, {
    showNotice,
    errorToMessage,
    markDataTabMissing,
    syncCatalogDependents: () => syncDbAiPaneContextAfterCatalogChange()
  })

  const {
    databaseEngines,
    groups,
    groupParentById,
    connections,
    keyword,
    sidebarCollapsed,
    databaseSidebarTreeRef,
    expandedGroups,
    expandedConnections,
    expandedCatalogs,
    expandedSchemas,
    expandedSchemaObjectFolders,
    expandedTables,
    selectedNodeId,
    activeSqlCanRun,
    currentSqlCatalogs,
    currentSqlSchemas,
    activeSqlRequiresSchema,
    visibleGroupNodes,
    connectionsByGroup,
    selectNode,
    toggleGroup,
    toggleConnection,
    toggleCatalog,
    toggleSchema,
    toggleSchemaObjectFolder,
    toggleTable,
    selectColumnNode,
    findConnection,
    findTable,
    tableContextMatches,
    databaseNodeExists,
    repairTabsForConnection,
    applySqlTabConnectionContext,
    applyDatabaseCatalog,
    loadDatabaseCatalog,
    databaseCatalogMutationData,
    applyDatabaseCatalogMutationResult,
    resolveSqlConsoleContext,
    defaultSqlContextForConnection,
    updateSqlTabCatalog,
    updateSqlTabSchema,
    renderDefaultSql
  } = catalogRuntime

  const databaseSshProxyOptions = computed(() => workspaceStore.sshProxyConfigs.map((config) => ({ ...config })).sort((first, second) => first.name.localeCompare(second.name)))
  const databaseSshProxyNames = computed(() => new Set(databaseSshProxyOptions.value.map((config) => config.name)))

  const contextConnection = computed(() => {
    const menu = contextMenu.value
    return menu?.type === 'connection' ? (findConnection(menu.connectionId) ?? null) : null
  })

  const contextConnectionConnected = computed(() => contextConnection.value?.status === 'connected')
  const contextConnectionCanCreateDatabase = computed(() => canCreateDatabaseForConnection(contextConnection.value))
  const connectionMoveTargets = computed(() => {
    const connection = contextConnection.value
    if (!connection) return []
    return groups.value
      .filter((group) => group.id !== connection.groupId)
      .filter((group) => group.id !== DEFAULT_GROUP_ID)
      .map((group) => ({ id: group.id, name: groupPathLabel(group.id, groups.value, groupParentById) }))
  })
  const connectionRootMoveDisabled = computed(() => contextConnection.value?.groupId === DEFAULT_GROUP_ID)

  const activeSqlHasText = computed(() => Boolean(activeSqlTab.value?.sql.trim()))
  const activeSqlSaving = computed(() => Boolean(activeSqlTab.value?.saving))
  const activeSqlIsDirty = computed(() => {
    const tab = activeSqlTab.value
    return !!tab && tab.sql !== tab.savedSql
  })
  const activeSqlSaveTitle = computed(() => {
    const tab = activeSqlTab.value
    if (!tab) return 'Save'
    if (tab.saving) return 'Saving'
    return 'Save'
  })
  const activeSqlSaveStateText = computed(() => {
    const tab = activeSqlTab.value
    if (!tab) return ''
    if (tab.saving) return 'Saving...'
    if (tab.saveError) return tab.saveError
    if (activeSqlIsDirty.value) return tab.filePath ? 'Unsaved changes' : 'Not saved'
    return tab.filePath ? `Saved: ${fileNameFromPath(tab.filePath)}` : 'Not saved'
  })
  const {
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
  } = createDatabaseSqlEditorWorkspaceController(
    {
      activeSqlTab,
      sqlEditorRef,
      editorSettings: computed(() => workspaceStore.editorSettings)
    },
    {
      showNotice
    }
  )
  const {
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
  } = createDatabaseSqlDataWorkspaceController(
    {
      tabs,
      activeTabId,
      activeSqlTab,
      activeDataTab,
      activeSqlCanRun
    },
    {
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
    }
  )
  const databaseWorkspaceStyle = computed(() => ({
    '--db-ai-pane-width': dbAiPaneOpen.value ? `${dbAiPaneWidth.value}px` : '0px',
    '--db-sql-editor-line-height': `${sqlEditorLineHeight.value}px`,
    '--db-sql-editor-font-size': `${workspaceStore.editorSettings.fontSize}px`,
    '--db-sql-editor-tab-size': `${workspaceStore.editorSettings.tabSize}`
  }))
  const {
    dbAiPaneOpen,
    dbAiPaneWidth,
    dbAiPaneResizing,
    dbAiPaneContext,
    dbAiPaneDraft,
    dbAiPaneMessages,
    dbAiOpen,
    dbAiActiveReqId,
    sqlDiagnose,
    dbAiDialectOptions,
    canToggleDbAiPane,
    dbAiPaneConnection,
    dbAiPaneCatalogOptions,
    dbAiPaneSchemaOptions,
    dbAiPaneRequiresSchema,
    dbAiPaneConnectionNeedsConnect,
    dbAiPaneContextTitle,
    dbAiPaneContextSummary,
    dbAiPaneIsStreaming,
    dbAiPaneCanSend,
    dbAiRequestList,
    dbAiTargetDialect,
    dbAiActionLabel,
    dbAiStatus,
    dbAiContextSummary,
    dbAiIsConvertAction,
    dbAiReasoningText,
    dbAiContentText,
    dbAiEmptyState,
    dbAiSql,
    dbAiIsExecutableDialect,
    dbAiCanRunReadOnly,
    dbAiCanCancel,
    dbAiStatusLabel,
    dbAiPaneStatusLabel,
    syncDbAiPaneContextAfterActiveTabChange,
    syncDbAiPaneContextAfterCatalogChange,
    toggleDbAiPane,
    closeDbAiPane,
    useActiveDbAiPaneContext,
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    handleDbAiPaneDraftKeydown,
    sendDbAiPaneQuickPrompt,
    resetDbAiPaneConversation,
    cancelDbAiPaneResponse,
    sendDbAiPaneMessage,
    startDbAiPaneResize,
    stopDbAiPaneResize,
    resetDbAiPaneWidth,
    loadDbAiPaneState,
    persistDbAiPaneState,
    openDbAiFromToolbar,
    openDbAi,
    setActiveDbAiRequest,
    copyDbAiSql,
    replaceDbAiSqlSelection,
    insertDbAiSql,
    runDbAiReadonly,
    cancelDbAiRequest,
    clearDbAiRequest,
    formatDbAiRequestTime,
    clearSqlDiagnoseTimers,
    diagnoseSqlError
  } = createDatabaseAiWorkspaceController(
    {
      connections,
      expandedConnections,
      activeSqlTab,
      activeSqlCanRun,
      currentSqlCatalogs,
      databaseAiPanelsRef
    },
    {
      showNotice,
      closeMenus: () => closeMenus(),
      bridgeErrorMessage,
      copyText,
      findConnection,
      defaultSqlContextForConnection,
      resolveSqlConsoleContext,
      connectConnection: (connectionId: string) => connectDatabaseConnectionForDbAi(connectionId),
      getSelectedSqlText,
      getSqlCursorOffset,
      getSqlSelectionRange,
      getSqlTextUntilCursor,
      renderDefaultSql,
      setEditorSql,
      appendSqlExecution
    }
  )

  const contextGroup = computed(() => {
    const menu = contextMenu.value
    return menu?.type === 'group' ? (groups.value.find((group) => group.id === menu.groupId) ?? null) : null
  })

  const groupRootMoveDisabled = computed(() => !contextGroup.value || groupParentById[contextGroup.value.id] === null)

  const groupMoveTargets = computed(() => {
    const group = contextGroup.value
    if (!group) return []
    const descendants = collectDescendantGroupIds(group.id, groups.value, groupParentById)
    return groups.value
      .filter((target) => target.id !== DEFAULT_GROUP_ID && target.id !== group.id && !descendants.has(target.id))
      .map((target) => ({ id: target.id, name: groupPathLabel(target.id, groups.value, groupParentById) }))
  })

  async function updateSqlTabConnection(event: Event) {
    const tab = activeSqlTab.value
    if (!tab) return
    const connectionId = (event.target as HTMLSelectElement).value
    let connection = findConnection(connectionId)
    if (!connection) {
      tab.connectionId = ''
      tab.catalogName = ''
      tab.schemaName = ''
      return
    }
    if (connection.status !== 'connected' && connection.status !== 'testing') {
      const requestedConnectionId = connection.id
      const result = await connectDatabaseConnectionViaBackend(requestedConnectionId)
      if (
        !applyDatabaseCatalogMutationResult(
          result,
          'Database connection failed.',
          (value): value is NonNullable<DatabaseConnectionMutationResult['data']> =>
            isDatabaseConnectionMutationDataForRequest(value, { connectionId: requestedConnectionId, status: 'connected' }),
          DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
        )
      ) {
        return
      }
      connection = findConnection(connectionId)
      if (!connection) return
      expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
      showNotice('Connection auto-connected for SQL context')
    }
    applySqlTabConnectionContext(tab, connection)
  }

  watch(activeTabId, () => {
    syncDbAiPaneContextAfterActiveTabChange()
  })

  function closeTab(tabId: string) {
    const index = tabs.value.findIndex((tab) => tab.id === tabId)
    if (index <= 0) return
    tabs.value.splice(index, 1)
    if (activeTabId.value === tabId) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id ?? 'tab-overview'
  }

  function nextQueryTitle() {
    const indexes = tabs.value
      .filter((tab) => tab.kind === 'sql')
      .map((tab) => /^Query (\d+)$/.exec(tab.title)?.[1])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value))
    return `Query ${indexes.length ? Math.max(...indexes) + 1 : 1}`
  }

  function openSqlConsole(connectionId?: string) {
    const context = resolveSqlConsoleContext(connectionId)
    const connection = findConnection(context.connectionId)
    const catalog = connection?.catalogs.find((item) => item.name === context.catalogName) ?? connection?.catalogs[0]
    const tab: WorkspaceTab = {
      id: `tab-sql-${Date.now()}`,
      kind: 'sql',
      title: nextQueryTitle(),
      connectionId: context.connectionId,
      catalogName: catalog?.name ?? context.catalogName,
      schemaName: context.schemaName,
      sql: '',
      savedSql: '',
      saving: false,
      saveError: null,
      resultTabs: [],
      activeResultTabId: 'overview',
      history: []
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    closeMenus()
  }

  function errorToMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return 'Backend SQL executor failed.'
  }

  function bridgeErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message.trim()) return error.message
    if (typeof error === 'string' && error.trim()) return error.trim()
    return fallback
  }

  function fileNameFromPath(filePath: string) {
    return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath
  }

  const databaseCatalogConnectionHooks = {
    openTable,
    mutateDatabaseTableThroughBackend,
    dataTabsMatching,
    reloadDataTab,
    tabIdsMatching,
    cleanupDroppedTableUi,
    openDbAi: ((...args: Parameters<typeof openDbAi>) => openDbAi(...args)) as typeof openDbAi
  }

  const {
    toggleConnectionStatus,
    refreshConnected,
    toggleAddMenu,
    focusDatabaseSearch,
    clearDatabaseSearch,
    openOverviewEngine,
    openConnectionModalFromEngine,
    addGroup,
    startGroupRename,
    commitGroupRename,
    cancelGroupRename,
    requestDeleteGroup,
    moveGroupTo,
    openContextMenu,
    connectFromMenu,
    moveConnectionToGroup,
    refreshConnectionFromMenu,
    editConnection,
    requestRemoveConnection,
    openContextTable,
    openContextSql,
    openDdlModalFromContext,
    copySelectSql,
    copyTableDdlFromContext,
    requestDangerousTableAction,
    cancelDangerousTableAction,
    updateDangerConfirmText,
    confirmDangerousTableAction,
    cancelOperationConfirm,
    confirmOperation,
    copyContextName,
    databaseProxyAvailable,
    connectionUrl,
    createDatabaseSql,
    createDatabaseNameError,
    createDatabaseCanSubmit,
    markConnectionUrlAuto,
    updateCreateDatabaseName,
    closeConnectionModal,
    openSshProxyConfigFromConnectionModal,
    pickSqliteFile,
    testConnectionDraft,
    saveConnectionDraft,
    openCreateDatabaseModal,
    closeCreateDatabaseModal,
    createDatabase,
    copyDdl,
    closeDdlModal,
    engineAccent,
    engineName,
    closeMenus,
    closeContextSubmenuSoon,
    connectDatabaseConnectionViaBackend,
    disconnectDatabaseConnectionViaBackend,
    refreshDatabaseConnectionViaBackend,
    connectDatabaseConnectionForDbAi
  } = createDatabaseCatalogConnectionWorkspaceController(
    {
      databaseEngines,
      groups,
      groupParentById,
      connections,
      keyword,
      sidebarCollapsed,
      databaseSidebarTreeRef,
      expandedGroups,
      expandedConnections,
      expandedCatalogs,
      expandedSchemas,
      expandedSchemaObjectFolders,
      expandedTables,
      selectedNodeId,
      overflowOpen,
      addMenuOpen,
      addMenuPosition,
      contextMenu,
      contextSubmenu,
      editingGroupId,
      editingGroupName,
      tabs,
      activeTabId,
      activeSqlTab,
      connectionModalOpen,
      connectionModalMode,
      connectionFeedback,
      connectionFeedbackKind,
      connectionErrors,
      connectionUrlDirty,
      passwordVisible,
      connectionTesting,
      connectionSaving,
      connectionDraft,
      createDatabaseModal,
      ddlModal,
      dangerConfirm,
      operationConfirm,
      databaseSshProxyOptions,
      databaseSshProxyNames
    },
    {
      workspaceStore,
      showNotice,
      copyText,
      errorToMessage,
      findConnection,
      applyDatabaseCatalog,
      applyDatabaseCatalogMutationResult,
      databaseCatalogMutationData,
      databaseNodeExists,
      repairTabsForConnection,
      findTable,
      openSqlConsole,
      renderDefaultSql
    },
    databaseCatalogConnectionHooks
  )
  function showNotice(text: string) {
    notice.value = text
    if (noticeTimer.value) window.clearTimeout(noticeTimer.value)
    noticeTimer.value = window.setTimeout(() => {
      notice.value = ''
      noticeTimer.value = null
    }, 1800)
  }

  async function copyText(value: string) {
    const text = String(value ?? '')
    const copied = await copyTextToClipboard(text)
    if (!copied) showNotice('Copy failed')
    return copied
  }

  function handleWindowClick() {
    closeMenus()
  }

  onMounted(() => {
    void loadDatabaseCatalog().finally(() => loadDbAiPaneState())
    window.addEventListener('click', handleWindowClick)
  })

  onBeforeUnmount(() => {
    stopSqlPaneResize()
    stopDbAiPaneResize()
    clearSqlDiagnoseTimers()
    window.removeEventListener('click', handleWindowClick)
    if (noticeTimer.value) window.clearTimeout(noticeTimer.value)
    persistDbAiPaneState()
  })

  watch(editingGroupId, async (id) => {
    if (!id) return
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('.db-tree-edit')
    input?.focus()
    input?.select()
  })


  return {
    DB_AI_PANE_MIN_WIDTH,
    DB_AI_PANE_MAX_WIDTH,
    DEFAULT_GROUP_ID,
    databaseEngines,
    groups,
    connections,
    keyword,
    sidebarCollapsed,
    databaseSidebarTreeRef,
    expandedGroups,
    expandedConnections,
    expandedCatalogs,
    expandedSchemas,
    expandedSchemaObjectFolders,
    expandedTables,
    selectedNodeId,
    overflowOpen,
    addMenuOpen,
    addMenuPosition,
    contextMenu,
    contextSubmenu,
    notice,
    editingGroupId,
    editingGroupName,
    tabs,
    activeTabId,
    sqlEditorRef,
    connectionModalOpen,
    connectionModalMode,
    connectionFeedback,
    connectionFeedbackKind,
    connectionErrors,
    passwordVisible,
    connectionTesting,
    connectionSaving,
    postgresSslModeOptions,
    connectionDraft,
    createDatabaseModal,
    ddlModal,
    chartModal,
    commentModal,
    databaseAiPanelsRef,
    dangerConfirm,
    operationConfirm,
    activeTab,
    activeSqlTab,
    activeDataTab,
    activeDataEditSummary,
    activeSqlCanRun,
    currentSqlCatalogs,
    currentSqlSchemas,
    activeSqlRequiresSchema,
    databaseSshProxyOptions,
    databaseProxyAvailable,
    contextConnectionConnected,
    contextConnectionCanCreateDatabase,
    connectionMoveTargets,
    connectionRootMoveDisabled,
    activeSqlResult,
    activeSqlResultViewState,
    activeSqlHasText,
    activeSqlSaving,
    activeSqlIsDirty,
    activeSqlSaveTitle,
    activeSqlSaveStateText,
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
    sqlPaneStyle,
    activeSqlEditorLineCount,
    activeSqlEditorLines,
    sqlEditorActiveLineTop,
    sqlFindMatches,
    sqlFindSummary,
    syncSqlEditorState,
    openSqlFind,
    closeSqlFind,
    toggleSqlFindReplace,
    handleSqlFindKeydown,
    goToSqlFindMatch,
    replaceCurrentSqlFindMatch,
    replaceAllSqlFindMatches,
    startSqlPaneResize,
    resetSqlPaneSplit,
    databaseWorkspaceStyle,
    dbAiPaneOpen,
    dbAiPaneWidth,
    dbAiPaneResizing,
    dbAiPaneContext,
    dbAiPaneDraft,
    dbAiPaneMessages,
    dbAiOpen,
    dbAiActiveReqId,
    sqlDiagnose,
    dbAiDialectOptions,
    canToggleDbAiPane,
    dbAiPaneConnection,
    dbAiPaneCatalogOptions,
    dbAiPaneSchemaOptions,
    dbAiPaneRequiresSchema,
    dbAiPaneConnectionNeedsConnect,
    dbAiPaneContextTitle,
    dbAiPaneContextSummary,
    dbAiPaneIsStreaming,
    dbAiPaneCanSend,
    dbAiRequestList,
    dbAiTargetDialect,
    dbAiActionLabel,
    dbAiStatus,
    dbAiContextSummary,
    dbAiIsConvertAction,
    dbAiReasoningText,
    dbAiContentText,
    dbAiEmptyState,
    dbAiSql,
    dbAiIsExecutableDialect,
    dbAiCanRunReadOnly,
    dbAiCanCancel,
    dbAiStatusLabel,
    dbAiPaneStatusLabel,
    toggleDbAiPane,
    closeDbAiPane,
    useActiveDbAiPaneContext,
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    handleDbAiPaneDraftKeydown,
    sendDbAiPaneQuickPrompt,
    resetDbAiPaneConversation,
    cancelDbAiPaneResponse,
    sendDbAiPaneMessage,
    startDbAiPaneResize,
    resetDbAiPaneWidth,
    openDbAiFromToolbar,
    setActiveDbAiRequest,
    copyDbAiSql,
    replaceDbAiSqlSelection,
    insertDbAiSql,
    runDbAiReadonly,
    cancelDbAiRequest,
    clearDbAiRequest,
    formatDbAiRequestTime,
    diagnoseSqlError,
    visibleGroupNodes,
    groupRootMoveDisabled,
    groupMoveTargets,
    activeDataWherePending,
    pagedDataRows,
    filteredSqlRows,
    pagedSqlRows,
    connectionUrl,
    markConnectionUrlAuto,
    updateSqlTabConnection,
    updateSqlTabCatalog,
    updateSqlTabSchema,
    updateCreateDatabaseName,
    createDatabaseSql,
    createDatabaseNameError,
    createDatabaseCanSubmit,
    connectionsByGroup,
    selectNode,
    toggleGroup,
    toggleConnection,
    toggleCatalog,
    toggleSchema,
    toggleSchemaObjectFolder,
    toggleTable,
    selectColumnNode,
    openTable,
    closeTab,
    updateActiveSql,
    openSqlConsole,
    runSql,
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
    updateDataCell,
    updateNewDataRowCell,
    setActiveDataSelectedRow,
    addDataRow,
    deleteSelectedDataRow,
    undoDataChanges,
    saveDataChanges,
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
    formatSql,
    toggleConnectionStatus,
    refreshConnected,
    toggleAddMenu,
    focusDatabaseSearch,
    clearDatabaseSearch,
    openOverviewEngine,
    openConnectionModalFromEngine,
    addGroup,
    startGroupRename,
    commitGroupRename,
    cancelGroupRename,
    requestDeleteGroup,
    moveGroupTo,
    openContextMenu,
    connectFromMenu,
    moveConnectionToGroup,
    refreshConnectionFromMenu,
    editConnection,
    requestRemoveConnection,
    openContextTable,
    openContextSql,
    openDdlModalFromContext,
    copySelectSql,
    copyTableDdlFromContext,
    requestDangerousTableAction,
    cancelDangerousTableAction,
    updateDangerConfirmText,
    confirmDangerousTableAction,
    cancelOperationConfirm,
    confirmOperation,
    copyContextName,
    closeConnectionModal,
    openSshProxyConfigFromConnectionModal,
    pickSqliteFile,
    testConnectionDraft,
    saveConnectionDraft,
    openCreateDatabaseModal,
    closeCreateDatabaseModal,
    createDatabase,
    copyDdl,
    closeDdlModal,
    engineAccent,
    engineName,
    closeContextSubmenuSoon
  }
}
