import type { ComputedRef, Ref } from 'vue'
import { isDatabaseTableMutationData } from '@/services/database/databaseBackendGuards'
import {
  buildQualifiedTableReference,
  formatDdlError,
  type TableDdlResult
} from '@/services/database/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  DatabaseDangerConfirmState,
  DatabaseDdlModalState,
  WorkspaceTab
} from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseTableInfo,
  DatabaseTableMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE = 'Backend table mutation returned malformed result data.'

type DatabaseCatalogTableContext = {
  connectionId: string
  catalogName: string
  schemaName: string
  tableId: string
  tableName: string
}

type DatabaseCatalogTableActionState = {
  contextMenu: Ref<ContextMenu | null>
  activeSqlTab: ComputedRef<Extract<WorkspaceTab, { kind: 'sql' }> | null>
  ddlModal: DatabaseDdlModalState
  dangerConfirm: DatabaseDangerConfirmState
  expandedTables: Ref<string[]>
  selectedNodeId: Ref<string | null>
}

type DatabaseCatalogTableActionDeps = {
  showNotice: (text: string) => void
  copyText: (value: string) => Promise<boolean>
  closeMenus: () => void
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  findTable: (connectionId: string, catalogName: string, tableId: string, schemaName?: string) => DatabaseTableInfo | null
  openSqlConsole: (connectionId?: string) => void
  applyDatabaseCatalog: (catalog: DatabaseWorkspaceCatalog) => void
  databaseNodeExists: (id: string | null) => boolean
  fetchTableDdl: (ctx: {
    connectionId: string
    catalogName: string
    schemaName?: string
    tableId: string
    tableName: string
  }) => Promise<TableDdlResult>
}

type DatabaseCatalogTableActionHooks = {
  openTable: (connectionId: string, catalogName: string, table: DatabaseTableInfo, schemaName?: string) => void
  mutateDatabaseTableThroughBackend: (input: {
    connectionId: string
    databaseName: string
    schemaName?: string
    tableName: string
    mutations: Array<{ kind: 'drop' | 'truncate' }>
  }) => Promise<DatabaseTableMutationResult>
  dataTabsMatching: (ctx: DatabaseCatalogTableContext) => Array<Extract<WorkspaceTab, { kind: 'data' }>>
  reloadDataTab: (tab: Extract<WorkspaceTab, { kind: 'data' }>, options?: { withTotal?: boolean; preserveDirty?: boolean; notice?: string }) => Promise<void>
  tabIdsMatching: (ctx: DatabaseCatalogTableContext) => Set<string>
  cleanupDroppedTableUi: (
    ctx: DatabaseCatalogTableContext,
    removedTabIds: Set<string>,
    options: {
      ddlOpen: boolean
      setDdlOpen: (open: boolean) => void
      expandedTables: Ref<string[]>
      selectedNodeId: Ref<string | null>
      databaseNodeExists: (id: string | null) => boolean
    }
  ) => void
  openDbAi: (
    action: 'drop' | 'truncate',
    sql: string,
    context: string,
    options: {
      connectionId: string
      dbType: string
      databaseName: string
      schemaName?: string
      tableName: string
      contextSummary: string
    }
  ) => void
}

export const createDatabaseCatalogTableActionRuntime = (
  state: DatabaseCatalogTableActionState,
  deps: DatabaseCatalogTableActionDeps,
  hooks: DatabaseCatalogTableActionHooks
) => {
  const {
    contextMenu,
    activeSqlTab,
    ddlModal,
    dangerConfirm,
    expandedTables,
    selectedNodeId
  } = state
  const {
    showNotice,
    copyText,
    closeMenus,
    findConnection,
    findTable,
    openSqlConsole,
    applyDatabaseCatalog,
    databaseNodeExists,
    fetchTableDdl
  } = deps

  const currentTableMenu = () => {
    const menu = contextMenu.value
    return menu?.type === 'table' ? menu : null
  }

  const tableContextFromDangerConfirm = (): DatabaseCatalogTableContext => ({
    connectionId: dangerConfirm.connectionId,
    catalogName: dangerConfirm.catalogName,
    schemaName: dangerConfirm.schemaName,
    tableId: dangerConfirm.tableId,
    tableName: dangerConfirm.tableName
  })

  function openContextTable() {
    const menu = currentTableMenu()
    if (!menu) return
    const table = findTable(menu.connectionId, menu.catalogName, menu.tableId, menu.schemaName)
    if (table) hooks.openTable(menu.connectionId, menu.catalogName, table, menu.schemaName)
    closeMenus()
  }

  function openContextSql() {
    const menu = currentTableMenu()
    if (!menu) return
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
    const menu = currentTableMenu()
    if (!menu) return
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

  async function copySelectSql() {
    const menu = currentTableMenu()
    if (!menu) return
    const connection = findConnection(menu.connectionId)
    const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
    if (await copyText(`SELECT * FROM ${qualified}`)) showNotice('SELECT copied')
    closeMenus()
  }

  async function copyTableDdlFromContext() {
    const menu = currentTableMenu()
    if (!menu) return
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
    const menu = currentTableMenu()
    if (!menu) return
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
    hooks.dataTabsMatching(tableContextFromDangerConfirm()).forEach((tab) => {
      void hooks.reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false, notice: 'Table truncated through backend table store' })
    })
    showNotice('Table truncated through backend table store')
    return true
  }

  async function applyBackendTableDrop() {
    const table = findTable(dangerConfirm.connectionId, dangerConfirm.catalogName, dangerConfirm.tableId, dangerConfirm.schemaName || undefined)
    if (!table) return false
    const droppedContext = tableContextFromDangerConfirm()
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

  return {
    cancelDangerousTableAction,
    closeDdlModal,
    confirmDangerousTableAction,
    copyDdl,
    copySelectSql,
    copyTableDdlFromContext,
    openContextSql,
    openContextTable,
    openDdlModalFromContext,
    requestDangerousTableAction,
    updateDangerConfirmText
  }
}
