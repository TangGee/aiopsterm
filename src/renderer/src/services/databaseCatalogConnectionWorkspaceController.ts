import { nextTick, type ComputedRef, type Ref } from 'vue'
import { createDatabaseCatalogConnectionBackend } from '@/services/databaseCatalogConnectionBackend'
import { createDatabaseConnectionFormRuntime } from '@/services/databaseConnectionFormRuntime'
import {
  isConnectableDatabaseEngineInfo,
  isDatabaseConnectionDeleteDataForRequest,
  isDatabaseConnectionMutationDataForRequest,
  isDatabaseGroupDeleteDataForRequest,
  isDatabaseGroupMutationDataForRequest,
  isDatabaseTableMutationData
} from '@/services/databaseBackendGuards'
import {
  buildQualifiedTableReference,
  collectDescendantGroupIds,
  DEFAULT_GROUP_ID,
  formatDdlError,
  groupPathLabel,
  type TableDdlResult
} from '@/services/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  ContextMenuPayload,
  ContextSubmenu,
  DatabaseConnectionDraft,
  DatabaseCreateDatabaseModalState,
  DatabaseDangerConfirmState,
  DatabaseDdlModalState,
  SqlConsoleContext,
  WorkspaceTab,
  DatabaseOperationConfirmState
} from '@/services/databaseWorkspaceTypes'
import type { useWorkspaceStore } from '@/stores/workspace'
import type {
  DatabaseConnectionDeleteResult,
  DatabaseConnectionInfo,
  DatabaseConnectionMutationResult,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseGroupDeleteResult,
  DatabaseGroupInfo,
  DatabaseGroupMutationResult,
  DatabaseTableInfo,
  DatabaseTableMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE = 'Database group backend returned malformed result data.'
const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'
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
  connectionDraft: DatabaseConnectionDraft
  createDatabaseModal: DatabaseCreateDatabaseModalState
  ddlModal: DatabaseDdlModalState
  dangerConfirm: DatabaseDangerConfirmState
  operationConfirm: DatabaseOperationConfirmState
  databaseSshProxyOptions: ComputedRef<Array<{ name: string }>>
  databaseSshProxyNames: ComputedRef<Set<string>>
}

type DatabaseCatalogConnectionDeps = {
  workspaceStore: ReturnType<typeof useWorkspaceStore>
  showNotice: (text: string) => void
  copyText: (value: string) => Promise<boolean>
  errorToMessage: (error: unknown) => string
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
    databaseSshProxyOptions,
    databaseSshProxyNames
  } = state
  const {
    workspaceStore,
    showNotice,
    copyText,
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
  const backend = createDatabaseCatalogConnectionBackend({ errorToMessage: deps.errorToMessage })
  const formRuntime = createDatabaseConnectionFormRuntime(
    {
      databaseEngines,
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
      databaseSshProxyOptions,
      databaseSshProxyNames
    },
    {
      findConnection,
      applyDatabaseCatalog,
      showNotice,
      closeMenus,
      openSshProxyConfig: () => workspaceStore.openSshProxyConfig(),
      openAddSshProxyConfig: () => workspaceStore.openAddSshProxyConfig(),
      testConnection: backend.testConnection,
      saveConnection: backend.saveConnection,
      createDatabase: backend.createDatabase
    }
  )

  async function toggleConnectionStatus(id: string) {
    const connection = findConnection(id)
    if (!connection) return
    if (connection.status === 'connected') {
      const result = await backend.disconnectConnection(id)
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
    const result = await backend.connectConnection(id)
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
      const result = await backend.refreshConnection(connection.id)
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
    formRuntime.openConnectionModal(engine.connectionCode, groupId ?? groups.value[0]?.id ?? DEFAULT_GROUP_ID)
  }

  async function addGroup(parentGroupId: string | null = null) {
    const result = await backend.createGroup({ name: 'New Group', parentId: parentGroupId })
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
      const result = await backend.renameGroup({ id, name })
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
    const result = await backend.deleteGroup(groupId)
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
    const result = await backend.moveGroup({ id: groupId, parentId })
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
      connectionBefore.status === 'connected' ? await backend.disconnectConnection(connectionId) : await backend.connectConnection(connectionId)
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
    const result = await backend.moveConnection({ connectionId, groupId })
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
    const result = await backend.refreshConnection(connectionId)
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
    formRuntime.editConnection(connection)
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
    const result = await backend.removeConnection(connectionId)
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
    const connection = findConnection(ctx.connectionId)
    return backend.fetchTableDdl({
      connectionId: ctx.connectionId,
      dbType: connection?.dbType,
      catalogName: ctx.catalogName,
      schemaName: ctx.schemaName,
      tableName: ctx.tableName
    })
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

  async function connectDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    return backend.connectConnection(connectionId)
  }

  async function connectDatabaseConnectionForDbAi(connectionId: string) {
    const result = await backend.connectConnection(connectionId)
    return applyDatabaseCatalogMutationResult(
      result,
      'Database connection failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId, status: 'connected' }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  }

  async function disconnectDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    return backend.disconnectConnection(connectionId)
  }

  async function refreshDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    return backend.refreshConnection(connectionId)
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

  async function saveConnectionDraft() {
    const connection = await formRuntime.saveConnectionDraft()
    if (!connection) return
    selectedNodeId.value = connection.id
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
  }

  async function createDatabase() {
    const selectedCatalogNodeId = await formRuntime.createDatabase()
    if (selectedCatalogNodeId) selectedNodeId.value = selectedCatalogNodeId
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
    databaseProxyAvailable: formRuntime.databaseProxyAvailable,
    connectionUrl: formRuntime.connectionUrl,
    createDatabaseSql: formRuntime.createDatabaseSql,
    createDatabaseNameError: formRuntime.createDatabaseNameError,
    createDatabaseCanSubmit: formRuntime.createDatabaseCanSubmit,
    markConnectionUrlAuto: formRuntime.markConnectionUrlAuto,
    updateCreateDatabaseName: formRuntime.updateCreateDatabaseName,
    closeConnectionModal: formRuntime.closeConnectionModal,
    openSshProxyConfigFromConnectionModal: formRuntime.openSshProxyConfigFromConnectionModal,
    pickSqliteFile: formRuntime.pickSqliteFile,
    testConnectionDraft: formRuntime.testConnectionDraft,
    saveConnectionDraft,
    openCreateDatabaseModal: formRuntime.openCreateDatabaseModal,
    closeCreateDatabaseModal: formRuntime.closeCreateDatabaseModal,
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
