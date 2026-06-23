import { type ComputedRef, type Ref } from 'vue'
import { createDatabaseCatalogConnectionBackend } from '@/services/database/databaseCatalogConnectionBackend'
import { createDatabaseCatalogTableActionRuntime } from '@/services/database/databaseCatalogTableActionRuntime'
import { createDatabaseCatalogTreeRuntime } from '@/services/database/databaseCatalogTreeRuntime'
import { createDatabaseConnectionFormRuntime } from '@/services/database/databaseConnectionFormRuntime'
import {
  isDatabaseConnectionMutationDataForRequest
} from '@/services/database/databaseBackendGuards'
import {
  type TableDdlResult
} from '@/services/database/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  ContextSubmenu,
  DatabaseConnectionDraft,
  DatabaseCreateDatabaseModalState,
  DatabaseDangerConfirmState,
  DatabaseDdlModalState,
  WorkspaceTab,
  DatabaseOperationConfirmState
} from '@/services/database/databaseWorkspaceTypes'
import type { useWorkspaceStore } from '@/stores/workspace'
import type {
  DatabaseConnectionInfo,
  DatabaseConnectionMutationResult,
  DatabaseEngineInfo,
  DatabaseGroupInfo,
  DatabaseTableInfo,
  DatabaseTableMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'

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
  let closeMenusImpl: () => void = () => {}
  const closeMenus = () => closeMenusImpl()
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

  const treeRuntime = createDatabaseCatalogTreeRuntime(
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
      operationConfirm
    },
    {
      showNotice,
      copyText,
      findConnection,
      applyDatabaseCatalog,
      applyDatabaseCatalogMutationResult,
      databaseCatalogMutationData,
      repairTabsForConnection,
      openConnectionModal: formRuntime.openConnectionModal,
      editConnectionDraft: formRuntime.editConnection
    },
    backend
  )
  closeMenusImpl = treeRuntime.closeMenus

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
    cancelOperationConfirm,
    confirmOperation,
    copyContextName,
    engineAccent,
    engineName,
    closeContextSubmenuSoon
  } = treeRuntime

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

  const tableActionRuntime = createDatabaseCatalogTableActionRuntime(
    {
      contextMenu,
      activeSqlTab,
      ddlModal,
      dangerConfirm,
      expandedTables,
      selectedNodeId
    },
    {
      showNotice,
      copyText,
      closeMenus,
      findConnection,
      findTable,
      openSqlConsole,
      applyDatabaseCatalog,
      databaseNodeExists,
      fetchTableDdl
    },
    hooks
  )

  const {
    openContextTable,
    openContextSql,
    openDdlModalFromContext,
    copySelectSql,
    copyTableDdlFromContext,
    requestDangerousTableAction,
    cancelDangerousTableAction,
    updateDangerConfirmText,
    confirmDangerousTableAction,
    copyDdl,
    closeDdlModal
  } = tableActionRuntime

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
