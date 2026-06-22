import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { createDatabaseCatalogConnectionWorkspaceController } from '@/services/databaseCatalogConnectionWorkspaceController'
import { databaseClient } from '@/services/databaseClient'
import { createDatabaseAiWorkspaceController } from '@/services/databaseAiWorkspaceController'
import { createDatabaseSqlDataWorkspaceController } from '@/services/databaseSqlDataWorkspaceController'
import { createDatabaseSqlEditorWorkspaceController } from '@/services/databaseSqlEditorWorkspaceController'
import type { DatabaseMainWorkspaceApi } from '@/components/database/DatabaseMainWorkspace.vue'
import {
  makeDirtyState,
} from '@/services/databaseGridRuntime'
import {
  isConnectableDatabaseEngineInfo,
  isDatabaseConnectionDeleteDataForRequest,
  isDatabaseConnectionMutationDataForRequest,
  isDatabaseConnectionSaveDataForRequest,
  isDatabaseConnectionTestData,
  isDatabaseCreateDatabaseDataForRequest,
  isDatabaseGroupDeleteDataForRequest,
  isDatabaseGroupMutationDataForRequest,
  isDatabaseTableMutationData,
  isDatabaseWorkspaceCatalog,
} from '@/services/databaseBackendGuards'
import {
  buildConnectionUrl,
  buildQualifiedTableReference,
  collectDescendantGroupIds,
  columnNodeId,
  connectionText,
  DB_AI_PANE_MAX_WIDTH,
  DB_AI_PANE_MIN_WIDTH,
  DB_IDENT_RE,
  DEFAULT_GROUP_ID,
  defaultSchemaForSqlConnection,
  flattenVisibleGroups,
  formatDdlError,
  groupPathLabel,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  normalizeTableDdlResult,
  parseCreateDatabaseName,
  quoteIdentForDialect,
  quoteIdentifier,
  renderCreateDatabaseTemplate,
  schemaObjectFolderKey,
  schemaRoutineNodeId,
  sqlConnectionRequiresSchema,
  toggleId,
  type SchemaObjectKind,
  type TableDdlResult,
  type VisibleGroupNode
} from '@/services/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  ContextMenuPayload,
  ContextSubmenu,
  DatabaseOperationConfirmAction,
  SqlConsoleContext,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import { useWorkspaceStore } from '@/stores/workspace'
import type {
  DatabaseCatalogInfo, DatabaseColumnInfo, DatabaseConnectionDeleteResult, DatabaseConnectionInfo, DatabaseConnectionMoveInput, DatabaseConnectionMutationResult,
  DatabaseConnectionSaveInput, DatabaseConnectionSaveResult, DatabaseConnectionTestInput, DatabaseConnectionTestResult, DatabaseCreateDatabaseResult,
  DatabaseEngineCode, DatabaseEngineInfo, DatabaseGroupCreateInput, DatabaseGroupDeleteResult, DatabaseGroupInfo,
  DatabaseGroupMutationResult, DatabaseGroupUpdateInput,
  DatabaseTableInfo,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

export const useDatabaseWorkspaceRuntime = () => {

  const DATABASE_CATALOG_MALFORMED_MESSAGE = 'Database catalog backend returned malformed result data.'
  const DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE = 'Database connection test backend returned malformed result data.'
  const DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE = 'Database connection save backend returned malformed result data.'
  const DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE = 'Database group backend returned malformed result data.'
  const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'
  const DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE = 'Create database backend returned malformed result data.'
  const DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE = 'Backend table mutation returned malformed result data.'
  const workspaceStore = useWorkspaceStore()

  const databaseEngines = ref<DatabaseEngineInfo[]>([])
  const groups = ref<DatabaseGroupInfo[]>([])
  const groupParentById = reactive<Record<string, string | null>>({})
  const connections = ref<DatabaseConnectionInfo[]>([])
  const keyword = ref('')
  const sidebarCollapsed = ref(false)
  const databaseSidebarTreeRef = ref<{ focusSearch: () => void; addButtonRect: () => DOMRect | null } | null>(null)
  const expandedGroups = ref<string[]>([])
  const expandedConnections = ref<string[]>([])
  const expandedCatalogs = ref<string[]>([])
  const expandedSchemas = ref<string[]>([])
  const expandedSchemaObjectFolders = ref<string[]>([])
  const expandedTables = ref<string[]>([])
  const selectedNodeId = ref<string | null>(null)
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

  const activeSqlCanRun = computed(() => {
    const tab = activeSqlTab.value
    if (!tab) return false
    return isSqlConsoleContextReady(tab)
  })

  const currentSqlCatalogs = computed(() => {
    const tab = activeSqlTab.value
    return tab ? (findConnection(tab.connectionId)?.catalogs ?? []) : []
  })

  const currentSqlSchemas = computed(() => {
    const tab = activeSqlTab.value
    if (!tab) return []
    const catalog = findConnection(tab.connectionId)?.catalogs.find((item) => item.name === tab.catalogName)
    return catalog?.schemas ?? []
  })

  const activeSqlRequiresSchema = computed(() => {
    const tab = activeSqlTab.value
    const connection = tab ? findConnection(tab.connectionId) : undefined
    return !!connection && sqlConnectionRequiresSchema(connection)
  })

  const databaseSshProxyOptions = computed(() => workspaceStore.sshProxyConfigs.map((config) => ({ ...config })).sort((first, second) => first.name.localeCompare(second.name)))
  const databaseSshProxyNames = computed(() => new Set(databaseSshProxyOptions.value.map((config) => config.name)))
  const databaseProxyAvailable = computed(() => connectionDraft.dbType !== 'sqlite' && databaseSshProxyOptions.value.length > 0)

  const contextConnection = computed(() => {
    const menu = contextMenu.value
    return menu?.type === 'connection' ? (findConnection(menu.connectionId) ?? null) : null
  })

  const contextConnectionConnected = computed(() => contextConnection.value?.status === 'connected')
  const contextConnectionCanCreateDatabase = computed(() => {
    const connection = contextConnection.value
    return (
      !!connection &&
      connection.status === 'connected' &&
      (isMysqlCompatibleDbType(connection.dbType) ||
        isPostgresCompatibleDbType(connection.dbType) ||
        connection.dbType === 'sqlserver' ||
        connection.dbType === 'clickhouse')
    )
  })
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

  const visibleGroups = computed(() => {
    const needle = keyword.value.trim().toLowerCase()
    if (!needle) return groups.value
    return groups.value.filter((group) => {
      if (group.name.toLowerCase().includes(needle)) return true
      return connections.value.some((connection) => connection.groupId === group.id && connectionText(connection).includes(needle))
    })
  })

  const visibleGroupNodes = computed<VisibleGroupNode[]>(() => flattenVisibleGroups(visibleGroups.value, groupParentById))

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

  const connectionUrl = computed({
    get() {
      if (connectionUrlDirty.value && connectionDraft.url.trim()) return connectionDraft.url
      return buildConnectionUrl(connectionDraft)
    },
    set(value: string) {
      connectionUrlDirty.value = true
      connectionDraft.url = value
    }
  })

  function markConnectionUrlAuto() {
    if (!connectionUrlDirty.value) connectionDraft.url = ''
    clearConnectionFeedback()
  }

  function clearConnectionFeedback() {
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
  }

  function repairSqlTabContext(tab: Extract<WorkspaceTab, { kind: 'sql' }>) {
    const connection = findConnection(tab.connectionId)
    if (!connection) {
      tab.connectionId = ''
      tab.catalogName = ''
      tab.schemaName = ''
      tab.tableId = undefined
      tab.tableName = undefined
      return
    }
    const catalog = connection.catalogs.find((item) => item.name === tab.catalogName) ?? connection.catalogs[0]
    if (!catalog) {
      tab.catalogName = ''
      tab.schemaName = ''
      tab.tableId = undefined
      tab.tableName = undefined
      return
    }
    if (tab.catalogName !== catalog.name) {
      tab.catalogName = catalog.name
      tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
      tab.tableId = undefined
      tab.tableName = undefined
      return
    }
    if (sqlConnectionRequiresSchema(connection)) {
      const schema = catalog.schemas?.find((item) => item.name === tab.schemaName)
      if (!schema) {
        tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
        tab.tableId = undefined
        tab.tableName = undefined
        return
      }
      if (tab.tableId && !schema.tables.some((table) => table.id === tab.tableId)) {
        tab.tableId = undefined
        tab.tableName = undefined
      }
      return
    }
    if (tab.schemaName) tab.schemaName = ''
    if (tab.tableId && !(catalog.tables ?? []).some((table) => table.id === tab.tableId)) {
      tab.tableId = undefined
      tab.tableName = undefined
    }
  }

  function repairTabsForConnection(connectionId: string) {
    tabs.value.forEach((tab) => {
      if (tab.kind === 'sql' && tab.connectionId === connectionId) repairSqlTabContext(tab)
      if (tab.kind === 'data' && tab.connectionId === connectionId && !findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)) {
        tab.error = 'Table no longer exists in the refreshed local tree'
        tab.rows = []
        tab.rowCount = 0
        tab.total = 0
        tab.dirtyState = makeDirtyState([], tab.primaryKey)
        tab.undoStack = []
        resetDataMutationPlan(tab)
      }
    })
  }

  function applySqlTabConnectionContext(tab: Extract<WorkspaceTab, { kind: 'sql' }>, connection: DatabaseConnectionInfo) {
    const catalog = connection.catalogs[0]
    tab.connectionId = connection.id
    tab.catalogName = catalog?.name ?? ''
    tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
    tab.tableId = undefined
    tab.tableName = undefined
  }

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

  function updateSqlTabCatalog(event: Event) {
    const tab = activeSqlTab.value
    if (!tab) return
    const catalogName = (event.target as HTMLSelectElement).value
    const connection = findConnection(tab.connectionId)
    const catalog = connection?.catalogs.find((item) => item.name === catalogName)
    tab.catalogName = catalog?.name ?? catalogName
    tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
    tab.tableId = undefined
    tab.tableName = undefined
  }

  function updateSqlTabSchema(event: Event) {
    const tab = activeSqlTab.value
    if (!tab) return
    tab.schemaName = (event.target as HTMLSelectElement).value
    tab.tableId = undefined
    tab.tableName = undefined
  }

  function syncCreateDatabaseTemplate() {
    if (createDatabaseModal.userEditedSql) return
    const next = renderCreateDatabaseTemplate(createDatabaseModal.name, createDatabaseModal.dbType)
    createDatabaseModal.lastAppliedTemplate = next
    createDatabaseModal.sql = next
  }

  function updateCreateDatabaseName(event: Event) {
    createDatabaseModal.name = (event.target as HTMLInputElement).value
    createDatabaseModal.feedback = ''
    syncCreateDatabaseTemplate()
  }

  const createDatabaseSql = computed({
    get() {
      return createDatabaseModal.sql
    },
    set(value: string) {
      if (value !== createDatabaseModal.lastAppliedTemplate) createDatabaseModal.userEditedSql = true
      createDatabaseModal.sql = value
    }
  })

  const createDatabaseNameError = computed(() => {
    const name = createDatabaseModal.name.trim()
    return createDatabaseModal.open && name.length > 0 && !DB_IDENT_RE.test(name)
  })

  const createDatabaseCanSubmit = computed(() => {
    if (!createDatabaseModal.open || createDatabaseModal.submitting) return false
    return DB_IDENT_RE.test(createDatabaseModal.name.trim()) && createDatabaseModal.sql.trim().length > 0
  })

  watch(
    () => activeSqlTab.value && [activeSqlTab.value.connectionId, activeSqlTab.value.catalogName].join('|'),
    () => {
      const tab = activeSqlTab.value
      if (tab) repairSqlTabContext(tab)
    }
  )

  watch(
    [() => connectionDraft.dbType, databaseSshProxyNames],
    () => {
      if (connectionDraft.dbType === 'sqlite') {
        connectionDraft.needProxy = false
        connectionDraft.proxyName = ''
        return
      }
      if (connectionDraft.proxyName && !databaseSshProxyNames.value.has(connectionDraft.proxyName)) {
        connectionDraft.proxyName = ''
      }
    }
  )

  watch(activeTabId, () => {
    syncDbAiPaneContextAfterActiveTabChange()
  })

  function connectionsByGroup(groupId: string) {
    const needle = keyword.value.trim().toLowerCase()
    const list = connections.value.filter((connection) => connection.groupId === groupId)
    if (!needle) return list
    return list.filter((connection) => connectionText(connection).includes(needle))
  }

  function selectNode(id: string) {
    selectedNodeId.value = id
  }

  function toggleGroup(id: string) {
    expandedGroups.value = toggleId(expandedGroups.value, id)
  }

  function toggleConnection(id: string) {
    expandedConnections.value = toggleId(expandedConnections.value, id)
  }

  function toggleCatalog(connectionId: string, catalogName: string) {
    expandedCatalogs.value = toggleId(expandedCatalogs.value, `${connectionId}:${catalogName}`)
  }

  function toggleSchema(connectionId: string, catalogName: string, schemaName: string) {
    expandedSchemas.value = toggleId(expandedSchemas.value, `${connectionId}:${catalogName}:${schemaName}`)
  }

  function toggleSchemaObjectFolder(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind) {
    expandedSchemaObjectFolders.value = toggleId(expandedSchemaObjectFolders.value, schemaObjectFolderKey(connectionId, catalogName, schemaName, kind))
  }

  function toggleTable(tableId: string) {
    expandedTables.value = toggleId(expandedTables.value, tableId)
  }

  function selectColumnNode(table: DatabaseTableInfo, column: DatabaseColumnInfo) {
    selectedNodeId.value = columnNodeId(table.id, column.name)
  }

  function findConnection(id: string) {
    return connections.value.find((connection) => connection.id === id)
  }

  function replaceRecord<T>(target: Record<string, T>, next: Record<string, T>) {
    Object.keys(target).forEach((key) => {
      delete target[key]
    })
    Object.assign(target, next)
  }

  function cloneDatabaseCatalog<T>(value: T): T {
    return structuredClone(value)
  }

  function tableNodeExists(tableId: string) {
    return connections.value.some((connection) =>
      connection.catalogs.some((catalog) => {
        if (catalog.tables?.some((table) => table.id === tableId || table.columns.some((column) => columnNodeId(table.id, column.name) === tableId))) {
          return true
        }
        return (catalog.schemas ?? []).some((schema) => {
          if ([schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'tables'), schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'views'), schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'functions'), schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'procedures')].includes(tableId)) {
            return true
          }
          if ([`${connection.id}:${catalog.name}`, `${connection.id}:${catalog.name}:${schema.name}`].includes(tableId)) return true
          const tableHit = [...schema.tables, ...(schema.views ?? [])].some((table) => table.id === tableId || table.columns.some((column) => columnNodeId(table.id, column.name) === tableId))
          if (tableHit) return true
          return (['functions', 'procedures'] as const).some((kind) =>
            (schema[kind] ?? []).some((routine) => tableId === schemaRoutineNodeId(connection.id, catalog.name, schema.name, kind, routine))
          )
        })
      })
    )
  }

  function databaseNodeExists(id: string | null) {
    if (!id) return false
    if (groups.value.some((group) => group.id === id)) return true
    if (connections.value.some((connection) => connection.id === id)) return true
    return tableNodeExists(id)
  }

  function applyDatabaseCatalog(catalog: DatabaseWorkspaceCatalog) {
    databaseEngines.value = cloneDatabaseCatalog(catalog.engines).filter(isConnectableDatabaseEngineInfo)
    groups.value = cloneDatabaseCatalog(catalog.groups)
    replaceRecord(groupParentById, cloneDatabaseCatalog(catalog.groupParents))
    connections.value = cloneDatabaseCatalog(catalog.connections)
    expandedGroups.value = catalog.defaults.expandedGroupIds.slice()
    expandedConnections.value = catalog.defaults.expandedConnectionIds.slice()
    expandedCatalogs.value = catalog.defaults.expandedCatalogIds.slice()
    expandedSchemas.value = catalog.defaults.expandedSchemaIds.slice()
    expandedSchemaObjectFolders.value = catalog.defaults.expandedSchemaObjectFolderIds.slice()
    selectedNodeId.value = databaseNodeExists(catalog.defaults.selectedNodeId)
      ? catalog.defaults.selectedNodeId
      : connections.value[0]?.id ?? groups.value[0]?.id ?? null
    tabs.value.forEach((tab) => {
      if (tab.kind === 'sql') repairSqlTabContext(tab)
      if (tab.kind === 'data') {
        const table = findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)
        if (!table) {
          tab.error = 'Table no longer exists in the backend catalog'
          tab.rows = []
          tab.rowCount = 0
          tab.total = 0
          tab.dirtyState = makeDirtyState([], tab.primaryKey)
          tab.undoStack = []
          resetDataMutationPlan(tab)
        }
      }
    })
    syncDbAiPaneContextAfterCatalogChange()
  }

  async function loadDatabaseCatalog() {
    const listDatabaseCatalog = databaseClient.listDatabaseCatalog()
    if (!listDatabaseCatalog) {
      showNotice('Database catalog backend is unavailable')
      return
    }
    try {
      const result = await listDatabaseCatalog()
      if (!result.ok) {
        showNotice(result.errorMessage || 'Database catalog backend is unavailable')
        return
      }
      if (!isDatabaseWorkspaceCatalog(result.data)) {
        showNotice(DATABASE_CATALOG_MALFORMED_MESSAGE)
        return
      }
      applyDatabaseCatalog(result.data)
    } catch (error) {
      showNotice(errorToMessage(error))
    }
  }

  type DatabaseCatalogMutationEnvelope = { ok: boolean; data?: unknown; errorMessage?: string }

  function databaseCatalogMutationData<T extends DatabaseWorkspaceCatalog>(
    result: DatabaseCatalogMutationEnvelope,
    fallbackError: string,
    isData: (value: unknown) => value is T = isDatabaseWorkspaceCatalog as (value: unknown) => value is T,
    malformedError = DATABASE_CATALOG_MALFORMED_MESSAGE
  ) {
    if (!result.ok) {
      showNotice(result.errorMessage || fallbackError)
      return null
    }
    if (!isData(result.data)) {
      showNotice(malformedError)
      return null
    }
    return result.data
  }

  function applyDatabaseCatalogMutationResult<T extends DatabaseWorkspaceCatalog>(
    result: { ok: boolean; data?: unknown; errorMessage?: string },
    fallbackError: string,
    isData?: (value: unknown) => value is T,
    malformedError?: string
  ) {
    const data = databaseCatalogMutationData(result, fallbackError, isData, malformedError)
    if (!data) return false
    applyDatabaseCatalog(data)
    return true
  }

  function findTable(connectionId: string, catalogName: string, tableId: string, schemaName?: string) {
    const catalog = findConnection(connectionId)?.catalogs.find((item) => item.name === catalogName)
    if (!catalog) return null
    if (schemaName) {
      const schema = catalog.schemas?.find((item) => item.name === schemaName)
      return [...(schema?.tables ?? []), ...(schema?.views ?? [])].find((table) => table.id === tableId) ?? null
    }
    return catalog.tables?.find((table) => table.id === tableId) ?? null
  }

  function tableByName(connection: DatabaseConnectionInfo | undefined, catalogName: string, schemaName: string | undefined, tableName: string) {
    const catalog = connection?.catalogs.find((item) => item.name === catalogName)
    if (!catalog) return null
    const normalized = tableName.replace(/[`";]/g, '').split('.').pop()?.trim().toLowerCase()
    if (!normalized) return null
    const schema = schemaName ? catalog.schemas?.find((item) => item.name === schemaName) : undefined
    const tables = schemaName ? [...(schema?.tables ?? []), ...(schema?.views ?? [])] : catalog.tables
    return tables?.find((table) => table.name.toLowerCase() === normalized) ?? null
  }

  function tableContextMatches(
    tab: Extract<WorkspaceTab, { kind: 'sql' | 'data' }>,
    ctx: { connectionId: string; catalogName: string; schemaName?: string; tableId?: string; tableName: string }
  ) {
    if (tab.connectionId !== ctx.connectionId || tab.catalogName !== ctx.catalogName) return false
    if ((tab.schemaName || '') !== (ctx.schemaName || '')) return false
    if (tab.kind === 'data') return tab.tableId === ctx.tableId || tab.tableName === ctx.tableName
    return tab.tableId === ctx.tableId || tab.tableName === ctx.tableName
  }

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

  function resolveSqlConsoleContext(explicitConnectionId?: string): SqlConsoleContext {
    const explicitConnection = explicitConnectionId ? findConnection(explicitConnectionId) : null
    if (explicitConnection) return defaultSqlContextForConnection(explicitConnection)

    const active = activeTab.value
    if (active?.kind === 'sql' || active?.kind === 'data') {
      const connection = findConnection(active.connectionId)
      if (connection) {
        const catalogName = active.catalogName || connection.catalogs[0]?.name || ''
        const catalog = connection.catalogs.find((item) => item.name === catalogName) ?? connection.catalogs[0]
        const schemaName =
          active.kind === 'sql'
            ? active.schemaName || pickDefaultSchemaName(catalog)
            : active.schemaName || pickDefaultSchemaName(catalog)
        const context = { connectionId: connection.id, catalogName: catalog?.name ?? catalogName, schemaName: schemaName ?? '' }
        if (isSqlConsoleContextReady(context)) return context
      }
    }

    const selected = resolveSelectedSqlContext()
    if (selected && isSqlConsoleContextReady(selected)) return selected
    return firstReadySqlConsoleContext() ?? selected ?? (connections.value[0] ? defaultSqlContextForConnection(connections.value[0]) : { connectionId: '', catalogName: '', schemaName: '' })
  }

  function isSqlConsoleContextReady(context: SqlConsoleContext | { connectionId: string; catalogName: string; schemaName: string }) {
    const connection = findConnection(context.connectionId)
    if (!connection || !context.catalogName) return false
    const catalog = connection.catalogs.find((item) => item.name === context.catalogName)
    if (!catalog) return false
    if (sqlConnectionRequiresSchema(connection)) return !!context.schemaName && !!catalog.schemas?.some((schema) => schema.name === context.schemaName)
    return true
  }

  function firstReadySqlConsoleContext(): SqlConsoleContext | null {
    for (const connection of connections.value) {
      const context = defaultSqlContextForConnection(connection)
      if (isSqlConsoleContextReady(context)) return context
    }
    return null
  }

  function defaultSqlContextForConnection(connection: DatabaseConnectionInfo): SqlConsoleContext {
    const catalog = connection.catalogs[0]
    return {
      connectionId: connection.id,
      catalogName: catalog?.name ?? '',
      schemaName: defaultSchemaForSqlConnection(connection, catalog)
    }
  }

  function pickDefaultSchemaName(catalog: DatabaseCatalogInfo | undefined) {
    if (!catalog?.schemas?.length) return ''
    return catalog.schemas.find((schema) => schema.name === 'public')?.name ?? catalog.schemas[0]?.name ?? ''
  }

  function resolveSelectedSqlContext(): SqlConsoleContext | null {
    const selectedId = selectedNodeId.value
    if (!selectedId) return null
    const connection = findConnection(selectedId)
    if (connection) return defaultSqlContextForConnection(connection)
    for (const item of connections.value) {
      for (const catalog of item.catalogs) {
        if (`${item.id}:${catalog.name}` === selectedId) {
          return { connectionId: item.id, catalogName: catalog.name, schemaName: pickDefaultSchemaName(catalog) ?? '' }
        }
        for (const schema of catalog.schemas ?? []) {
          if (`${item.id}:${catalog.name}:${schema.name}` === selectedId) {
            return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
          }
          for (const kind of ['tables', 'views', 'functions', 'procedures'] as const) {
            if (selectedId === schemaObjectFolderKey(item.id, catalog.name, schema.name, kind)) {
              return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
            }
          }
          const selectedTable = [...schema.tables, ...(schema.views ?? [])].find(
            (table) => table.id === selectedId || table.columns.some((column) => columnNodeId(table.id, column.name) === selectedId)
          )
          if (selectedTable) return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
          const selectedRoutine = (['functions', 'procedures'] as const).some((kind) =>
            (schema[kind] ?? []).some((routine) => selectedId === schemaRoutineNodeId(item.id, catalog.name, schema.name, kind, routine))
          )
          if (selectedRoutine) return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
        }
        const selectedCatalogTable = catalog.tables?.find(
          (table) => table.id === selectedId || table.columns.some((column) => columnNodeId(table.id, column.name) === selectedId)
        )
        if (selectedCatalogTable) return { connectionId: item.id, catalogName: catalog.name, schemaName: '' }
      }
    }
    return null
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

  function renderDefaultSql(connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined, schemaName?: string) {
    const table = schemaName ? catalog?.schemas?.find((schema) => schema.name === schemaName)?.tables[0] : catalog?.tables?.[0]
    if (!table) return 'select 1;'
    const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', catalog?.name ?? '', schemaName, table.name)
    if (connection?.dbType === 'oracle') return `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;`
    if (connection?.dbType === 'sqlserver') return `SELECT TOP (100) *\nFROM ${qualified};`
    return `SELECT *\nFROM ${qualified}\nLIMIT 100;`
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
      connectionUrl,
      createDatabaseCanSubmit,
      databaseSshProxyNames
    },
    {
      workspaceStore,
      showNotice,
      copyText,
      errorToMessage,
      bridgeErrorMessage,
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
