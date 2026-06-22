import { nextTick, type ComputedRef, type Ref, type WritableComputedRef } from 'vue'
import { databaseClient } from '@/services/databaseClient'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isConnectableDatabaseEngineInfo,
  isDatabaseConnectionDeleteDataForRequest,
  isDatabaseConnectionMutationDataForRequest,
  isDatabaseConnectionSaveDataForRequest,
  isDatabaseConnectionTestData,
  isDatabaseCreateDatabaseDataForRequest,
  isDatabaseGroupDeleteDataForRequest,
  isDatabaseGroupMutationDataForRequest,
  isDatabaseTableMutationData
} from '@/services/databaseBackendGuards'
import {
  buildConnectionUrl,
  buildQualifiedTableReference,
  collectDescendantGroupIds,
  DEFAULT_GROUP_ID,
  formatDdlError,
  groupPathLabel,
  isMysqlCompatibleDbType,
  isPostgresCompatibleDbType,
  normalizeTableDdlResult,
  parseCreateDatabaseName,
  type TableDdlResult
} from '@/services/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  ContextMenuPayload,
  ContextSubmenu,
  SqlConsoleContext,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import type { useWorkspaceStore } from '@/stores/workspace'
import type {
  DatabaseConnectionDeleteResult,
  DatabaseConnectionInfo,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseCreateDatabaseResult,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  DatabaseTableInfo,
  DatabaseTableMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE = 'Database connection test backend returned malformed result data.'
const DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE = 'Database connection save backend returned malformed result data.'
const DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE = 'Database group backend returned malformed result data.'
const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'
const DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE = 'Create database backend returned malformed result data.'
const DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE = 'Backend table mutation returned malformed result data.'

type DatabaseCatalogConnectionState = {
  databaseEngines: Ref<DatabaseEngineInfo[]>
  groups: Ref<DatabaseGroupInfo[]>
  groupParentById: Record<string, string | null>
  connections: Ref<DatabaseConnectionInfo[]>
  keyword: Ref<string>
  sidebarCollapsed: Ref<boolean>
  databaseSidebarTreeRef: Ref<{ focusSearch: () => void; addButtonRect: () => DOMRect | null } | null>
  expandedGroups: Ref<string[]>
  expandedConnections: Ref<string[]>
  expandedCatalogs: Ref<string[]>
  expandedSchemas: Ref<string[]>
  expandedSchemaObjectFolders: Ref<string[]>
  expandedTables: Ref<string[]>
  selectedNodeId: Ref<string | null>
  overflowOpen: Ref<boolean>
  addMenuOpen: Ref<boolean>
  addMenuPosition: Ref<{ x: number; y: number }>
  contextMenu: Ref<ContextMenu | null>
  contextSubmenu: Ref<ContextSubmenu>
  editingGroupId: Ref<string | null>
  editingGroupName: Ref<string>
  tabs: Ref<WorkspaceTab[]>
  activeTabId: Ref<string>
  activeSqlTab: ComputedRef<Extract<WorkspaceTab, { kind: 'sql' }> | null>
  connectionModalOpen: Ref<boolean>
  connectionModalMode: Ref<'create' | 'edit'>
  connectionFeedback: Ref<string>
  connectionFeedbackKind: Ref<'info' | 'error'>
  connectionErrors: Ref<string[]>
  connectionUrlDirty: Ref<boolean>
  passwordVisible: Ref<boolean>
  connectionTesting: Ref<boolean>
  connectionSaving: Ref<boolean>
  connectionDraft: any
  createDatabaseModal: any
  ddlModal: any
  dangerConfirm: any
  operationConfirm: any
  connectionUrl: WritableComputedRef<string>
  createDatabaseCanSubmit: ComputedRef<boolean>
  databaseSshProxyNames: ComputedRef<Set<string>>
}

type DatabaseCatalogConnectionDeps = {
  workspaceStore: ReturnType<typeof useWorkspaceStore>
  showNotice: (text: string) => void
  copyText: (value: string) => Promise<boolean>
  errorToMessage: (error: unknown) => string
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  applyDatabaseCatalog: (catalog: DatabaseWorkspaceCatalog) => void
  applyDatabaseCatalogMutationResult: <T extends DatabaseWorkspaceCatalog>(
    result: { ok: boolean; data?: unknown; errorMessage?: string },
    fallbackError: string,
    isData?: (value: unknown) => value is T,
    malformedError?: string
  ) => boolean
  databaseCatalogMutationData: <T extends DatabaseWorkspaceCatalog>(
    result: { ok: boolean; data?: unknown; errorMessage?: string },
    fallbackError: string,
    isData?: (value: unknown) => value is T,
    malformedError?: string
  ) => T | null
  databaseNodeExists: (id: string | null) => boolean
  repairTabsForConnection: (connectionId: string) => void
  findTable: (connectionId: string, catalogName: string, tableId: string, schemaName?: string) => DatabaseTableInfo | null
  openSqlConsole: (connectionId?: string) => void
  renderDefaultSql: (connection: DatabaseConnectionInfo | undefined, catalog: { name: string; tables?: DatabaseTableInfo[] } | undefined, schemaName?: string) => string
}

type DatabaseCatalogConnectionHooks = {
  openTable: (connectionId: string, catalogName: string, table: DatabaseTableInfo, schemaName?: string) => void
  mutateDatabaseTableThroughBackend: (input: any) => Promise<DatabaseTableMutationResult>
  dataTabsMatching: (ctx: any) => any[]
  reloadDataTab: (tab: any, options?: any) => Promise<void>
  tabIdsMatching: (ctx: any) => Set<string>
  cleanupDroppedTableUi: (ctx: any, removedTabIds: Set<string>, options: any) => void
  openDbAi: (...args: any[]) => void
}

export const createDatabaseCatalogConnectionWorkspaceController = (
  state: DatabaseCatalogConnectionState,
  deps: DatabaseCatalogConnectionDeps,
  hooks: DatabaseCatalogConnectionHooks
) => {
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
  } = state
  const {
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
  } = deps

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
    if (table) hooks.openTable(menu.connectionId, menu.catalogName, table, menu.schemaName)
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
    hooks.openDbAi(dangerConfirm.action, dangerConfirm.sql, context, {
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
    const result = await hooks.mutateDatabaseTableThroughBackend({
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
    hooks.dataTabsMatching({
      connectionId: dangerConfirm.connectionId,
      catalogName: dangerConfirm.catalogName,
      schemaName: dangerConfirm.schemaName,
      tableId: dangerConfirm.tableId,
      tableName: dangerConfirm.tableName
    }).forEach((tab) => {
      void hooks.reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false, notice: 'Table truncated through backend table store' })
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
    const removedTabIds = hooks.tabIdsMatching(droppedContext)
    const shouldCloseDdlModal =
      ddlModal.open &&
      ddlModal.connectionId === droppedContext.connectionId &&
      ddlModal.catalogName === droppedContext.catalogName &&
      (ddlModal.schemaName || '') === (droppedContext.schemaName || '') &&
      (ddlModal.tableId === droppedContext.tableId || ddlModal.tableName === droppedContext.tableName)
    const result = await hooks.mutateDatabaseTableThroughBackend({
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
    hooks.cleanupDroppedTableUi(droppedContext, removedTabIds, {
      ddlOpen: shouldCloseDdlModal,
      setDdlOpen: (open: boolean) => {
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

  function clearConnectionFeedback() {
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
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


  return {
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
  }
}
