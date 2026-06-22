import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { databaseClient } from '@/services/databaseClient'
import { createDatabaseAiWorkspaceController } from '@/services/databaseAiWorkspaceController'
import { createDatabaseSqlDataWorkspaceController } from '@/services/databaseSqlDataWorkspaceController'
import { createDatabaseSqlEditorWorkspaceController } from '@/services/databaseSqlEditorWorkspaceController'
import { localFilesClient } from '@/services/localFilesClient'
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
      closeMenus,
      bridgeErrorMessage,
      copyText,
      findConnection,
      defaultSqlContextForConnection,
      resolveSqlConsoleContext,
      connectConnection: connectDatabaseConnectionForDbAi,
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

  async function toggleConnectionStatus(id: string) {
    const connection = findConnection(id)
    if (!connection) return
    if (connection.status === 'connected') {
      const result = await disconnectDatabaseConnectionViaBackend(id)
      if (
        !applyDatabaseCatalogMutationResult(
          result,
          'Database disconnect failed.',
          (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: id, status: 'idle' }),
          DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
        )
      ) {
        return
      }
      expandedConnections.value = expandedConnections.value.filter((item) => item !== id)
      return
    }
    const result = await connectDatabaseConnectionViaBackend(id)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database connection failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: id, status: 'connected' }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, id]))
  }

  async function refreshConnected() {
    const connected = connections.value.filter((connection) => connection.status === 'connected')
    if (!connected.length) {
      showNotice('No connected database schemas to refresh')
      return
    }
    for (const connection of connected) {
      const result = await refreshDatabaseConnectionViaBackend(connection.id)
      const wasExpanded = expandedConnections.value.includes(connection.id)
      if (
        !applyDatabaseCatalogMutationResult(
          result,
          'Database connection refresh failed.',
          (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: connection.id }),
          DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
        )
      ) {
        return
      }
      if (wasExpanded) expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
    }
    showNotice('Connected database schemas refreshed')
  }

  function toggleAddMenu() {
    if (addMenuOpen.value) {
      addMenuOpen.value = false
      return
    }
    const rect = databaseSidebarTreeRef.value?.addButtonRect()
    addMenuPosition.value = {
      x: rect ? rect.right - 160 : 80,
      y: rect ? rect.bottom + 6 : 44
    }
    contextMenu.value = null
    addMenuOpen.value = true
  }

  function focusDatabaseSearch() {
    sidebarCollapsed.value = false
    keyword.value = ''
    nextTick(() => databaseSidebarTreeRef.value?.focusSearch())
  }

  function clearDatabaseSearch() {
    keyword.value = ''
    nextTick(() => databaseSidebarTreeRef.value?.focusSearch())
  }

  function openOverviewEngine(engine: DatabaseEngineInfo) {
    if (!isConnectableDatabaseEngineInfo(engine)) {
      showNotice(`${engine.name} connection is unavailable`)
      return
    }
    openConnectionModalFromEngine(engine)
  }

  function openConnectionModalFromEngine(engine: DatabaseEngineInfo, groupId?: string) {
    if (!isConnectableDatabaseEngineInfo(engine)) {
      showNotice(`${engine.name} connection is unavailable`)
      return
    }
    openConnectionModal(engine.connectionCode, groupId)
  }

  async function addGroup(parentGroupId: string | null = null) {
    const result = await createDatabaseGroupViaBackend({ name: 'New Group', parentId: parentGroupId })
    const data = databaseCatalogMutationData(
      result,
      'Database group create failed.',
      (value): value is NonNullable<DatabaseGroupMutationResult['data']> => isDatabaseGroupMutationDataForRequest(value, { name: 'New Group', parentId: parentGroupId }),
      DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
    )
    if (!data) return
    applyDatabaseCatalog(data)
    expandedGroups.value = Array.from(new Set([...expandedGroups.value, data.group.id, ...(parentGroupId ? [parentGroupId] : [])]))
    selectedNodeId.value = data.group.id
    editingGroupId.value = data.group.id
    editingGroupName.value = 'New Group'
    closeMenus()
  }

  function startGroupRename(groupId: string) {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) return
    editingGroupId.value = groupId
    editingGroupName.value = group.name
    closeMenus()
  }

  async function commitGroupRename() {
    const id = editingGroupId.value
    if (!id) return
    const name = editingGroupName.value.trim()
    editingGroupId.value = null
    editingGroupName.value = ''
    if (name) {
      const result = await renameDatabaseGroupViaBackend({ id, name })
      applyDatabaseCatalogMutationResult(
        result,
        'Database group rename failed.',
        (value): value is NonNullable<DatabaseGroupMutationResult['data']> => isDatabaseGroupMutationDataForRequest(value, { id, name }),
        DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
      )
    }
  }

  function cancelGroupRename() {
    editingGroupId.value = null
    editingGroupName.value = ''
  }

  function requestDeleteGroup(groupId: string) {
    if (groupId === DEFAULT_GROUP_ID) {
      showNotice('Default Group cannot be deleted')
      closeMenus()
      return
    }
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) return
    operationConfirm.open = true
    operationConfirm.action = 'deleteGroup'
    operationConfirm.targetId = groupId
    operationConfirm.title = 'Delete Group'
    operationConfirm.message = `Delete group "${group.name}"? Child groups move to root and connections move to Default Group in the database workspace catalog.`
    operationConfirm.detail = group.name
    operationConfirm.confirmLabel = 'Delete'
    closeMenus()
  }

  async function deleteGroup(groupId: string) {
    const result = await deleteDatabaseGroupViaBackend(groupId)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database group delete failed.',
        (value): value is NonNullable<DatabaseGroupDeleteResult['data']> => isDatabaseGroupDeleteDataForRequest(value, groupId),
        DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    selectedNodeId.value = groups.value.find((group) => group.id === DEFAULT_GROUP_ID)?.id ?? groups.value[0]?.id ?? null
    closeMenus()
  }

  async function moveGroupTo(groupId: string, parentId: string | null) {
    if (groupId === DEFAULT_GROUP_ID) {
      showNotice('Default Group cannot be moved')
      closeMenus()
      return
    }
    if (parentId === groupId || (parentId && collectDescendantGroupIds(groupId, groups.value, groupParentById).has(parentId))) return
    const result = await moveDatabaseGroupViaBackend({ id: groupId, parentId })
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database group move failed.',
        (value): value is NonNullable<DatabaseGroupMutationResult['data']> => isDatabaseGroupMutationDataForRequest(value, { id: groupId, parentId }),
        DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    if (parentId) expandedGroups.value = Array.from(new Set([...expandedGroups.value, parentId]))
    showNotice(parentId ? `Group moved to ${groupPathLabel(parentId, groups.value, groupParentById)}` : 'Group moved to root')
    closeMenus()
  }

  function openContextMenu(event: MouseEvent, payload: ContextMenuPayload) {
    selectedNodeId.value =
      payload.type === 'group' ? payload.groupId : payload.type === 'connection' ? payload.connectionId : payload.tableId
    addMenuOpen.value = false
    contextSubmenu.value = null
    contextMenu.value = { ...payload, x: event.clientX, y: event.clientY } as ContextMenu
  }

  async function connectFromMenu(connectionId: string) {
    const connectionBefore = findConnection(connectionId)
    if (!connectionBefore) return
    const result =
      connectionBefore.status === 'connected' ? await disconnectDatabaseConnectionViaBackend(connectionId) : await connectDatabaseConnectionViaBackend(connectionId)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        connectionBefore.status === 'connected' ? 'Database disconnect failed.' : 'Database connection failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> =>
          isDatabaseConnectionMutationDataForRequest(value, { connectionId, status: connectionBefore.status === 'connected' ? 'idle' : 'connected' }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    const connection = findConnection(connectionId)
    if (connection?.status === 'connected') {
      expandedConnections.value = Array.from(new Set([...expandedConnections.value, connectionId]))
    } else {
      expandedConnections.value = expandedConnections.value.filter((item) => item !== connectionId)
    }
    showNotice(connection?.status === 'connected' ? 'Connection opened' : 'Connection closed')
    closeMenus()
  }

  async function moveConnectionToGroup(connectionId: string, groupId: string) {
    const connection = findConnection(connectionId)
    if (!connection || connection.groupId === groupId) return
    const result = await moveDatabaseConnectionViaBackend({ connectionId, groupId })
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database connection move failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId, groupId }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    expandedGroups.value = Array.from(new Set([...expandedGroups.value, groupId]))
    showNotice(groupId === DEFAULT_GROUP_ID ? 'Connection moved to root group' : `Connection moved to ${groupPathLabel(groupId, groups.value, groupParentById)}`)
    closeMenus()
  }

  function applyConnectionRefreshUi(connectionId: string, options: { preserveExpanded?: boolean; forceExpand?: boolean; notice?: string } = {}) {
    const connection = findConnection(connectionId)
    if (!connection) return
    const wasExpanded = expandedConnections.value.includes(connectionId)
    const shouldExpand = options.forceExpand ? true : wasExpanded
    if (shouldExpand) {
      expandedConnections.value = Array.from(new Set([...expandedConnections.value, connectionId]))
    }
    const validCatalogNames = new Set(connection.catalogs.map((catalog) => catalog.name))
    expandedCatalogs.value = expandedCatalogs.value.filter((id) => {
      if (!id.startsWith(`${connectionId}:`)) return true
      const [, catalogName] = id.split(':')
      return shouldExpand && validCatalogNames.has(catalogName)
    })
    expandedSchemas.value = expandedSchemas.value.filter((id) => {
      if (!id.startsWith(`${connectionId}:`)) return true
      const [, catalogName, schemaName] = id.split(':')
      const catalog = connection.catalogs.find((item) => item.name === catalogName)
      return shouldExpand && !!catalog?.schemas?.some((schema) => schema.name === schemaName)
    })
    expandedSchemaObjectFolders.value = expandedSchemaObjectFolders.value.filter((id) => {
      if (!id.startsWith(`${connectionId}:`)) return true
      const [, catalogName, schemaName, kind] = id.split(':')
      const catalog = connection.catalogs.find((item) => item.name === catalogName)
      return shouldExpand && !!catalog?.schemas?.some((schema) => schema.name === schemaName) && ['tables', 'views', 'functions', 'procedures'].includes(kind)
    })
    repairTabsForConnection(connectionId)
    if (selectedNodeId.value === connectionId || shouldExpand) selectedNodeId.value = connectionId
    if (options.notice !== '') showNotice(options.notice ?? 'Connection schema refreshed')
  }

  async function refreshConnectionFromMenu(connectionId: string) {
    const connection = findConnection(connectionId)
    if (!connection) return
    const wasExpanded = expandedConnections.value.includes(connectionId)
    const result = await refreshDatabaseConnectionViaBackend(connectionId)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database connection refresh failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    applyConnectionRefreshUi(connectionId, { preserveExpanded: wasExpanded, notice: 'Connection schema refreshed' })
    closeMenus()
  }

  function editConnection(connectionId: string) {
    const connection = findConnection(connectionId)
    if (!connection) return
    connectionModalMode.value = 'edit'
    Object.assign(connectionDraft, {
      id: connection.id,
      dbType: connection.dbType,
      name: connection.name,
      env: connection.env,
      groupId: connection.groupId,
      host: connection.host,
      port: connection.port,
      authentication: connection.authentication,
      user: connection.user,
      password: '',
      database: connection.database,
      filePath: connection.filePath ?? '',
      readonly: !!connection.readonly,
      sslMode: connection.sslMode ?? '',
      needProxy: !!connection.needProxy,
      proxyName: connection.proxyName ?? '',
      url: connection.url ?? ''
    })
    connectionErrors.value = []
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
    connectionUrlDirty.value = !!(connection.url && connection.url !== buildConnectionUrl(connectionDraft))
    passwordVisible.value = false
    connectionTesting.value = false
    connectionSaving.value = false
    connectionModalOpen.value = true
    closeMenus()
  }

  function requestRemoveConnection(connectionId: string) {
    const connection = findConnection(connectionId)
    if (!connection) return
    const relatedTabCount = tabs.value.filter((tab) => tab.kind !== 'overview' && tab.connectionId === connectionId).length
    operationConfirm.open = true
    operationConfirm.action = 'removeConnection'
    operationConfirm.targetId = connectionId
    operationConfirm.title = 'Remove Connection'
    operationConfirm.message = `Remove connection "${connection.name}"?${relatedTabCount ? ` ${relatedTabCount} related workspace tab${relatedTabCount > 1 ? 's' : ''} will close.` : ''}`
    operationConfirm.detail = connection.name
    operationConfirm.confirmLabel = 'Remove'
    closeMenus()
  }

  async function removeConnection(connectionId: string) {
    const removedTabIds = new Set(tabs.value.filter((tab) => tab.kind !== 'overview' && tab.connectionId === connectionId).map((tab) => tab.id))
    const result = await removeDatabaseConnectionViaBackend(connectionId)
    if (!result.ok) {
      showNotice(result.errorMessage || 'Database connection remove failed.')
      return
    }
    if (!isDatabaseConnectionDeleteDataForRequest(result.data, connectionId)) {
      showNotice(DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE)
      return
    }
    applyDatabaseCatalog(result.data)
    expandedConnections.value = expandedConnections.value.filter((id) => id !== connectionId)
    expandedCatalogs.value = expandedCatalogs.value.filter((id) => !id.startsWith(`${connectionId}:`))
    expandedSchemas.value = expandedSchemas.value.filter((id) => !id.startsWith(`${connectionId}:`))
    expandedSchemaObjectFolders.value = expandedSchemaObjectFolders.value.filter((id) => !id.startsWith(`${connectionId}:`))
    tabs.value = tabs.value.filter((tab) => !removedTabIds.has(tab.id))
    if (removedTabIds.has(activeTabId.value)) activeTabId.value = tabs.value[0]?.id ?? 'tab-overview'
    showNotice(result.data.message || 'Connection removed')
    closeMenus()
  }

  function openContextTable() {
    const menu = contextMenu.value
    if (!menu || menu.type !== 'table') return
    const table = findTable(menu.connectionId, menu.catalogName, menu.tableId, menu.schemaName)
    if (table) openTable(menu.connectionId, menu.catalogName, table, menu.schemaName)
    closeMenus()
  }

  function openContextSql() {
    const menu = contextMenu.value
    if (!menu || menu.type !== 'table') return
    const connection = findConnection(menu.connectionId)
    openSqlConsole(menu.connectionId)
    const tab = activeSqlTab.value
    if (tab) {
      tab.catalogName = menu.catalogName
      tab.schemaName = menu.schemaName ?? ''
      tab.tableId = menu.tableId
      tab.tableName = menu.label
      const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
      tab.sql =
        connection?.dbType === 'oracle'
          ? `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;`
          : connection?.dbType === 'sqlserver'
            ? `SELECT TOP (100) *\nFROM ${qualified};`
            : `SELECT *\nFROM ${qualified}\nLIMIT 100;`
    }
    closeMenus()
  }

  async function openDdlModalFromContext() {
    const menu = contextMenu.value
    if (!menu || menu.type !== 'table') return
    ddlModal.open = true
    ddlModal.tableName = menu.label
    ddlModal.ddl = ''
    ddlModal.connectionId = menu.connectionId
    ddlModal.catalogName = menu.catalogName
    ddlModal.schemaName = menu.schemaName ?? ''
    ddlModal.tableId = menu.tableId
    ddlModal.loading = true
    ddlModal.error = ''
    ddlModal.errorCode = ''
    closeMenus()
    const result = await fetchTableDdl({
      connectionId: menu.connectionId,
      catalogName: menu.catalogName,
      schemaName: menu.schemaName,
      tableId: menu.tableId,
      tableName: menu.label
    })
    ddlModal.loading = false
    if (result.ok) {
      ddlModal.ddl = result.ddl
      return
    }
    ddlModal.errorCode = result.errorCode === 'permission' ? 'permission' : 'other'
    ddlModal.error = formatDdlError(result)
    showNotice(ddlModal.error)
  }

  function fetchTableDdl(ctx: {
    connectionId: string
    catalogName: string
    schemaName?: string
    tableId: string
    tableName: string
  }): Promise<TableDdlResult> {
    const getTableDdl = databaseClient.getDatabaseTableDdl()
    if (!getTableDdl) {
      return Promise.resolve({ ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database DDL API is unavailable.' })
    }
    const connection = findConnection(ctx.connectionId)
    return getTableDdl({
      connectionId: ctx.connectionId,
      dbType: connection?.dbType,
      databaseName: ctx.catalogName,
      schemaName: ctx.schemaName,
      tableName: ctx.tableName
    })
      .then(normalizeTableDdlResult)
      .catch((error) => ({ ok: false, errorCode: 'other', errorMessage: errorToMessage(error) }))
  }

  async function copySelectSql() {
    const menu = contextMenu.value
    if (!menu || menu.type !== 'table') return
    const connection = findConnection(menu.connectionId)
    const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
    if (await copyText(`SELECT * FROM ${qualified}`)) showNotice('SELECT copied')
    closeMenus()
  }

  async function copyTableDdlFromContext() {
    const menu = contextMenu.value
    if (!menu || menu.type !== 'table') return
    const result = await fetchTableDdl({
      connectionId: menu.connectionId,
      catalogName: menu.catalogName,
      schemaName: menu.schemaName,
      tableId: menu.tableId,
      tableName: menu.label
    })
    if (!result.ok) {
      showNotice(formatDdlError(result))
      closeMenus()
      return
    }
    if (await copyText(result.ddl)) showNotice('DDL copied')
    closeMenus()
  }

  function requestDangerousTableAction(action: 'drop' | 'truncate') {
    const menu = contextMenu.value
    if (!menu || menu.type !== 'table') return
    const qualified = `${menu.schemaName ? `${menu.schemaName}.` : ''}${menu.label}`
    Object.assign(dangerConfirm, {
      open: true,
      action,
      connectionId: menu.connectionId,
      catalogName: menu.catalogName,
      schemaName: menu.schemaName ?? '',
      tableId: menu.tableId,
      tableName: menu.label,
      sql: action === 'drop' ? `DROP TABLE ${qualified};` : `TRUNCATE TABLE ${qualified};`,
      confirmText: ''
    })
    closeMenus()
  }

  function cancelDangerousTableAction() {
    dangerConfirm.open = false
    dangerConfirm.confirmText = ''
  }

  function updateDangerConfirmText(value: string) {
    dangerConfirm.confirmText = value
  }

  async function confirmDangerousTableAction() {
    if (!dangerConfirm.open || dangerConfirm.confirmText !== dangerConfirm.tableName) return
    const connection = findConnection(dangerConfirm.connectionId)
    const context = [connection?.name, dangerConfirm.catalogName, dangerConfirm.schemaName, dangerConfirm.tableName].filter(Boolean).join(' · ')
    openDbAi(dangerConfirm.action, dangerConfirm.sql, context, {
      connectionId: dangerConfirm.connectionId,
      dbType: connection?.dbType ?? '',
      databaseName: dangerConfirm.catalogName,
      schemaName: dangerConfirm.schemaName || undefined,
      tableName: dangerConfirm.tableName,
      contextSummary: context
    })
    const ok = dangerConfirm.action === 'truncate' ? await applyBackendTableTruncate() : await applyBackendTableDrop()
    if (ok) {
      dangerConfirm.open = false
      dangerConfirm.confirmText = ''
    }
  }

  async function applyBackendTableTruncate() {
    const table = findTable(dangerConfirm.connectionId, dangerConfirm.catalogName, dangerConfirm.tableId, dangerConfirm.schemaName || undefined)
    if (!table) return false
    const result = await mutateDatabaseTableThroughBackend({
      connectionId: dangerConfirm.connectionId,
      databaseName: dangerConfirm.catalogName,
      schemaName: dangerConfirm.schemaName || undefined,
      tableName: dangerConfirm.tableName,
      mutations: [{ kind: 'truncate' }]
    })
    if (!result.ok) {
      showNotice(result.errorMessage || 'Backend table truncate failed')
      return false
    }
    if (!isDatabaseTableMutationData(result.data)) {
      showNotice(DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
      return false
    }
    dataTabsMatching({
      connectionId: dangerConfirm.connectionId,
      catalogName: dangerConfirm.catalogName,
      schemaName: dangerConfirm.schemaName,
      tableId: dangerConfirm.tableId,
      tableName: dangerConfirm.tableName
    }).forEach((tab) => {
      void reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false, notice: 'Table truncated through backend table store' })
    })
    showNotice('Table truncated through backend table store')
    return true
  }

  async function applyBackendTableDrop() {
    const table = findTable(dangerConfirm.connectionId, dangerConfirm.catalogName, dangerConfirm.tableId, dangerConfirm.schemaName || undefined)
    if (!table) return false
    const droppedContext = {
      connectionId: dangerConfirm.connectionId,
      catalogName: dangerConfirm.catalogName,
      schemaName: dangerConfirm.schemaName,
      tableId: dangerConfirm.tableId,
      tableName: dangerConfirm.tableName
    }
    const removedTabIds = tabIdsMatching(droppedContext)
    const shouldCloseDdlModal =
      ddlModal.open &&
      ddlModal.connectionId === droppedContext.connectionId &&
      ddlModal.catalogName === droppedContext.catalogName &&
      (ddlModal.schemaName || '') === (droppedContext.schemaName || '') &&
      (ddlModal.tableId === droppedContext.tableId || ddlModal.tableName === droppedContext.tableName)
    const result = await mutateDatabaseTableThroughBackend({
      connectionId: dangerConfirm.connectionId,
      databaseName: dangerConfirm.catalogName,
      schemaName: dangerConfirm.schemaName || undefined,
      tableName: dangerConfirm.tableName,
      mutations: [{ kind: 'drop' }]
    })
    if (!result.ok) {
      showNotice(result.errorMessage || 'Backend table drop failed')
      return false
    }
    if (!isDatabaseTableMutationData(result.data, { requireCatalog: true })) {
      showNotice(DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
      return false
    }
    if (!result.data.catalog) {
      showNotice(DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
      return false
    }
    applyDatabaseCatalog(result.data.catalog)
    cleanupDroppedTableUi(droppedContext, removedTabIds, {
      ddlOpen: shouldCloseDdlModal,
      setDdlOpen: (open) => {
        ddlModal.open = open
      },
      expandedTables,
      selectedNodeId,
      databaseNodeExists
    })
    showNotice('Table dropped through backend table store')
    return true
  }

  function cancelOperationConfirm() {
    operationConfirm.open = false
    operationConfirm.action = ''
    operationConfirm.targetId = ''
    operationConfirm.title = ''
    operationConfirm.message = ''
    operationConfirm.detail = ''
    operationConfirm.confirmLabel = 'Delete'
  }

  async function confirmOperation() {
    const action = operationConfirm.action
    const targetId = operationConfirm.targetId
    cancelOperationConfirm()
    if (action === 'deleteGroup') {
      await deleteGroup(targetId)
      return
    }
    if (action === 'removeConnection') {
      await removeConnection(targetId)
    }
  }

  async function copyContextName() {
    if (!contextMenu.value) return
    if (await copyText(contextMenu.value.label)) showNotice('Name copied')
    closeMenus()
  }

  function openConnectionModal(dbType: DatabaseEngineCode, groupId = groups.value[0]?.id ?? 'group-default') {
    connectionModalMode.value = 'create'
    const defaultPort =
      dbType === 'postgresql'
        ? 5432
        : dbType === 'kingbase'
          ? 54321
          : dbType === 'oceanbase'
            ? 2881
            : dbType === 'oracle'
              ? 1521
              : dbType === 'sqlserver'
                ? 1433
                : dbType === 'clickhouse'
                  ? 8123
                  : dbType === 'presto'
                    ? 8080
                    : dbType === 'sqlite'
                      ? null
                      : 3306
    Object.assign(connectionDraft, {
      id: '',
      dbType,
      name: `${engineName(dbType).toLowerCase()}-connection`,
      env: 'Development',
      groupId,
      host: '127.0.0.1',
      port: defaultPort,
      authentication: 'UserAndPassword',
      user: dbType === 'sqlite' ? '' : dbType === 'sqlserver' ? 'sa' : dbType === 'clickhouse' ? 'default' : dbType === 'presto' ? 'presto' : 'root',
      password: '',
      database: '',
      filePath: '',
      readonly: dbType === 'sqlite',
      sslMode: '',
      needProxy: false,
      proxyName: '',
      url: ''
    })
    connectionErrors.value = []
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
    connectionUrlDirty.value = false
    passwordVisible.value = false
    connectionTesting.value = false
    connectionSaving.value = false
    connectionModalOpen.value = true
    closeMenus()
  }

  function closeConnectionModal() {
    connectionModalOpen.value = false
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
    connectionErrors.value = []
    connectionUrlDirty.value = false
    passwordVisible.value = false
    connectionTesting.value = false
    connectionSaving.value = false
  }

  function openSshProxyConfigFromConnectionModal() {
    workspaceStore.openSshProxyConfig()
    workspaceStore.openAddSshProxyConfig()
  }

  async function pickSqliteFile() {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'SQLite file picker service is unavailable.'
      return
    }
    let result: Awaited<ReturnType<typeof showOpenDialog>>
    try {
      result = await showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    } catch {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'SQLite file picker failed.'
      return
    }
    const filePath = result && !result.canceled ? result.filePaths?.[0] : ''
    if (!filePath) return
    connectionDraft.filePath = filePath
    connectionDraft.url = `sqlite://${filePath}`
    connectionUrlDirty.value = true
    clearConnectionFeedback()
  }

  function validateConnectionDraft() {
    const errors: string[] = []
    if (!connectionDraft.name.trim()) errors.push('name')
    if (connectionDraft.dbType === 'sqlite') {
      if (!connectionDraft.filePath.trim()) errors.push('filePath')
    } else {
      const hasOracleConnectString = connectionDraft.dbType === 'oracle' && !!connectionDraft.url.trim()
      const hasHost = !!connectionDraft.host.trim()
      const hasPort = typeof connectionDraft.port === 'number' && Number.isFinite(connectionDraft.port) && connectionDraft.port > 0
      if (connectionDraft.dbType !== 'oracle' || !hasOracleConnectString) {
        if (!hasHost) errors.push('host')
        if (!hasPort) errors.push('port')
      }
      if (!connectionDraft.user.trim()) errors.push('user')
      if (connectionDraft.needProxy && (!connectionDraft.proxyName.trim() || !databaseSshProxyNames.value.has(connectionDraft.proxyName.trim()))) {
        errors.push('proxyName')
      }
    }
    connectionErrors.value = errors
    return errors.length === 0
  }

  async function testConnectionDraft() {
    if (connectionTesting.value || connectionSaving.value) return
    if (!validateConnectionDraft()) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'Fix required fields before testing.'
      return
    }
    connectionTesting.value = true
    connectionFeedbackKind.value = 'info'
    connectionFeedback.value = 'Testing connection through local backend...'
    await nextTick()
    const result = await testConnectionDraftViaBackend()
    connectionTesting.value = false
    if (!result.ok) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = databaseConnectionResultMessage(result)
      return
    }
    if (!isDatabaseConnectionTestData(result.data)) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
      return
    }
    connectionFeedbackKind.value = 'info'
    connectionFeedback.value = `Connection successful. (${databaseConnectionResultMessage(result)})`
  }

  function databaseConnectionTestInput(): DatabaseConnectionTestInput {
    return {
      dbType: connectionDraft.dbType,
      name: connectionDraft.name,
      host: connectionDraft.host,
      port: connectionDraft.port,
      user: connectionDraft.user,
      password: connectionDraft.password,
      database: connectionDraft.database,
      filePath: connectionDraft.filePath,
      readonly: connectionDraft.readonly,
      sslMode: connectionDraft.sslMode,
      needProxy: connectionDraft.dbType !== 'sqlite' && connectionDraft.needProxy,
      proxyName: connectionDraft.dbType !== 'sqlite' && connectionDraft.needProxy ? connectionDraft.proxyName.trim() : '',
      url: connectionDraft.url || connectionUrl.value
    }
  }

  function databaseConnectionResultMessage(result: DatabaseConnectionTestResult) {
    if (!result.ok) return result.errorMessage || 'Database connection test failed.'
    if (!isDatabaseConnectionTestData(result.data)) return DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
    return result.data.serverVersion
  }

  async function testConnectionDraftViaBackend(): Promise<DatabaseConnectionTestResult> {
    const testDatabaseConnection = databaseClient.testDatabaseConnection()
    if (!testDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection test API is unavailable.' }
    }
    return testDatabaseConnection(databaseConnectionTestInput())
  }

  async function saveConnectionDraft() {
    if (connectionTesting.value || connectionSaving.value) return
    if (!validateConnectionDraft()) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'Fix required fields before saving.'
      return
    }
    connectionSaving.value = true
    connectionFeedbackKind.value = 'info'
    connectionFeedback.value = 'Saving connection through local backend...'
    await nextTick()
    const testResult = await testConnectionDraftViaBackend()
    if (!testResult.ok) {
      connectionSaving.value = false
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = databaseConnectionResultMessage(testResult)
      return
    }
    if (!isDatabaseConnectionTestData(testResult.data)) {
      connectionSaving.value = false
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
      return
    }
    const saveInput = databaseConnectionSaveInput()
    const saveResult = await saveConnectionDraftViaBackend(saveInput)
    connectionSaving.value = false
    if (!saveResult.ok) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = saveResult.errorMessage || 'Database connection save failed.'
      return
    }
    if (!isDatabaseConnectionSaveDataForRequest(saveResult.data, saveInput)) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE
      return
    }
    applyDatabaseCatalog(saveResult.data)
    selectedNodeId.value = saveResult.data.connection.id
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, saveResult.data.connection.id]))
    closeConnectionModal()
    showNotice(saveResult.data.message || 'Connection saved')
  }

  function databaseConnectionSaveInput(): DatabaseConnectionSaveInput {
    return {
      mode: connectionModalMode.value,
      id: connectionDraft.id || undefined,
      connection: {
        ...databaseConnectionTestInput(),
        env: connectionDraft.env,
        groupId: connectionDraft.groupId,
        authentication: connectionDraft.authentication
      }
    }
  }

  async function saveConnectionDraftViaBackend(input = databaseConnectionSaveInput()): Promise<DatabaseConnectionSaveResult> {
    const saveDatabaseConnection = databaseClient.saveDatabaseConnection()
    if (!saveDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection save API is unavailable.' }
    }
    return saveDatabaseConnection(input)
  }

  async function createDatabaseGroupViaBackend(input: DatabaseGroupCreateInput): Promise<DatabaseGroupMutationResult> {
    const createDatabaseGroup = databaseClient.createDatabaseGroup()
    if (!createDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group create API is unavailable.' }
    }
    return createDatabaseGroup(input)
  }

  async function renameDatabaseGroupViaBackend(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
    const renameDatabaseGroup = databaseClient.renameDatabaseGroup()
    if (!renameDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group rename API is unavailable.' }
    }
    return renameDatabaseGroup(input)
  }

  async function moveDatabaseGroupViaBackend(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
    const moveDatabaseGroup = databaseClient.moveDatabaseGroup()
    if (!moveDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group move API is unavailable.' }
    }
    return moveDatabaseGroup(input)
  }

  async function deleteDatabaseGroupViaBackend(id: string): Promise<DatabaseGroupDeleteResult> {
    const deleteDatabaseGroup = databaseClient.deleteDatabaseGroup()
    if (!deleteDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group delete API is unavailable.' }
    }
    return deleteDatabaseGroup(id)
  }

  async function moveDatabaseConnectionViaBackend(input: DatabaseConnectionMoveInput): Promise<DatabaseConnectionMutationResult> {
    const moveDatabaseConnection = databaseClient.moveDatabaseConnection()
    if (!moveDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection move API is unavailable.' }
    }
    return moveDatabaseConnection(input)
  }

  async function removeDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionDeleteResult> {
    const removeDatabaseConnection = databaseClient.removeDatabaseConnection()
    if (!removeDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection remove API is unavailable.' }
    }
    return removeDatabaseConnection(connectionId)
  }

  async function connectDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    const connectDatabaseConnection = databaseClient.connectDatabaseConnection()
    if (!connectDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection API is unavailable.' }
    }
    return connectDatabaseConnection(connectionId)
  }

  async function connectDatabaseConnectionForDbAi(connectionId: string) {
    const result = await connectDatabaseConnectionViaBackend(connectionId)
    return applyDatabaseCatalogMutationResult(
      result,
      'Database connection failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId, status: 'connected' }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  }

  async function disconnectDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    const disconnectDatabaseConnection = databaseClient.disconnectDatabaseConnection()
    if (!disconnectDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database disconnect API is unavailable.' }
    }
    return disconnectDatabaseConnection(connectionId)
  }

  async function refreshDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    const refreshDatabaseConnection = databaseClient.refreshDatabaseConnection()
    if (!refreshDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database refresh API is unavailable.' }
    }
    return refreshDatabaseConnection(connectionId)
  }

  function openCreateDatabaseModal(connectionId: string) {
    const connection = findConnection(connectionId)
    if (!connection || (!isMysqlCompatibleDbType(connection.dbType) && !isPostgresCompatibleDbType(connection.dbType) && connection.dbType !== 'sqlserver')) return
    createDatabaseModal.open = true
    createDatabaseModal.connectionId = connectionId
    createDatabaseModal.dbType = connection.dbType
    createDatabaseModal.name = ''
    createDatabaseModal.sql = ''
    createDatabaseModal.userEditedSql = false
    createDatabaseModal.lastAppliedTemplate = ''
    createDatabaseModal.submitting = false
    createDatabaseModal.feedback = ''
    createDatabaseModal.feedbackKind = 'info'
    closeMenus()
  }

  function closeCreateDatabaseModal() {
    createDatabaseModal.open = false
    createDatabaseModal.connectionId = ''
    createDatabaseModal.name = ''
    createDatabaseModal.sql = ''
    createDatabaseModal.userEditedSql = false
    createDatabaseModal.lastAppliedTemplate = ''
    createDatabaseModal.submitting = false
    createDatabaseModal.feedback = ''
    createDatabaseModal.feedbackKind = 'info'
  }

  async function createDatabase() {
    const connection = findConnection(createDatabaseModal.connectionId)
    if (!connection) return
    if (!createDatabaseCanSubmit.value) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = 'Fix the database name and SQL before creating.'
      return
    }
    const name = parseCreateDatabaseName(createDatabaseModal.sql) || createDatabaseModal.name.trim()
    if (connection.catalogs.some((catalog) => catalog.name.toLowerCase() === name.toLowerCase())) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = 'Database already exists.'
      return
    }
    createDatabaseModal.submitting = true
    const result = await createDatabaseViaBackend(createDatabaseModal.connectionId, createDatabaseModal.sql, name)
    createDatabaseModal.submitting = false
    if (!result.ok) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = result.errorMessage || 'Create database failed.'
      return
    }
    if (!isDatabaseCreateDatabaseDataForRequest(result.data, createDatabaseModal.connectionId, name)) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE
      return
    }
    applyDatabaseCatalog(result.data)
    selectedNodeId.value = `${result.data.connection.id}:${result.data.catalog.name}`
    closeCreateDatabaseModal()
    showNotice(result.data.message || 'Database created in workspace catalog')
  }

  async function createDatabaseViaBackend(connectionId: string, sql: string, requestedName: string): Promise<DatabaseCreateDatabaseResult> {
    const createDatabaseCatalog = databaseClient.createDatabaseCatalog()
    if (!createDatabaseCatalog) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database create API is unavailable.' }
    }
    return createDatabaseCatalog({ connectionId, sql, requestedName })
  }

  async function copyDdl() {
    if (!ddlModal.ddl.trim()) {
      showNotice('DDL is empty')
      return
    }
    if (await copyText(ddlModal.ddl)) showNotice('DDL copied')
  }

  function closeDdlModal() {
    ddlModal.open = false
  }

  function engineAccent(code: DatabaseEngineCode) {
    return databaseEngines.value.find((engine) => engine.connectionCode === code)?.accent ?? '#8a94a6'
  }

  function engineName(code: DatabaseEngineCode) {
    return databaseEngines.value.find((engine) => engine.connectionCode === code)?.name ?? code
  }

  function closeMenus() {
    addMenuOpen.value = false
    contextMenu.value = null
    contextSubmenu.value = null
    overflowOpen.value = false
  }

  function closeContextSubmenuSoon() {
    contextSubmenu.value = null
  }

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
