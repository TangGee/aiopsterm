import { computed, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { databaseClient } from '@/services/databaseClient'
import {
  isConnectableDatabaseEngineInfo,
  isDatabaseWorkspaceCatalog
} from '@/services/databaseBackendGuards'
import {
  buildQualifiedTableReference,
  columnNodeId,
  connectionText,
  defaultSchemaForSqlConnection,
  flattenVisibleGroups,
  schemaObjectFolderKey,
  schemaRoutineNodeId,
  sqlConnectionRequiresSchema,
  toggleId,
  type SchemaObjectKind
} from '@/services/databaseWorkspaceRuntime'
import type { SqlConsoleContext, WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseEngineInfo,
  DatabaseGroupInfo,
  DatabaseTableInfo,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_CATALOG_MALFORMED_MESSAGE = 'Database catalog backend returned malformed result data.'

type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>
type DataTab = Extract<WorkspaceTab, { kind: 'data' }>
type TableContext = { connectionId: string; catalogName: string; schemaName?: string; tableId?: string; tableName: string }

type DatabaseWorkspaceCatalogRuntimeState = {
  tabs: Ref<WorkspaceTab[]>
  activeTab: ComputedRef<WorkspaceTab | undefined>
  activeSqlTab: ComputedRef<SqlTab | null>
}

type DatabaseWorkspaceCatalogRuntimeDeps = {
  showNotice: (message: string) => void
  errorToMessage: (error: unknown) => string
  markDataTabMissing: (tab: DataTab, message: string) => void
  syncCatalogDependents: () => void
}

type DatabaseCatalogMutationEnvelope = { ok: boolean; data?: unknown; errorMessage?: string }

export const createDatabaseWorkspaceCatalogRuntime = (
  { tabs, activeTab, activeSqlTab }: DatabaseWorkspaceCatalogRuntimeState,
  { showNotice, errorToMessage, markDataTabMissing, syncCatalogDependents }: DatabaseWorkspaceCatalogRuntimeDeps
) => {
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

  const visibleGroups = computed(() => {
    const needle = keyword.value.trim().toLowerCase()
    if (!needle) return groups.value
    return groups.value.filter((group) => {
      if (group.name.toLowerCase().includes(needle)) return true
      return connections.value.some((connection) => connection.groupId === group.id && connectionText(connection).includes(needle))
    })
  })

  const visibleGroupNodes = computed(() => flattenVisibleGroups(visibleGroups.value, groupParentById))

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

  function findTable(connectionId: string, catalogName: string, tableId: string, schemaName?: string) {
    const catalog = findConnection(connectionId)?.catalogs.find((item) => item.name === catalogName)
    if (!catalog) return null
    if (schemaName) {
      const schema = catalog.schemas?.find((item) => item.name === schemaName)
      return [...(schema?.tables ?? []), ...(schema?.views ?? [])].find((table) => table.id === tableId) ?? null
    }
    return catalog.tables?.find((table) => table.id === tableId) ?? null
  }

  function tableContextMatches(tab: Extract<WorkspaceTab, { kind: 'sql' | 'data' }>, ctx: TableContext) {
    if (tab.connectionId !== ctx.connectionId || tab.catalogName !== ctx.catalogName) return false
    if ((tab.schemaName || '') !== (ctx.schemaName || '')) return false
    if (tab.kind === 'data') return tab.tableId === ctx.tableId || tab.tableName === ctx.tableName
    return tab.tableId === ctx.tableId || tab.tableName === ctx.tableName
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

  function repairSqlTabContext(tab: SqlTab) {
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
        markDataTabMissing(tab, 'Table no longer exists in the refreshed local tree')
      }
    })
  }

  function applySqlTabConnectionContext(tab: SqlTab, connection: DatabaseConnectionInfo) {
    const catalog = connection.catalogs[0]
    tab.connectionId = connection.id
    tab.catalogName = catalog?.name ?? ''
    tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
    tab.tableId = undefined
    tab.tableName = undefined
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
        if (!table) markDataTabMissing(tab, 'Table no longer exists in the backend catalog')
      }
    })
    syncCatalogDependents()
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
    result: DatabaseCatalogMutationEnvelope,
    fallbackError: string,
    isData?: (value: unknown) => value is T,
    malformedError?: string
  ) {
    const data = databaseCatalogMutationData(result, fallbackError, isData, malformedError)
    if (!data) return false
    applyDatabaseCatalog(data)
    return true
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

  function renderDefaultSql(connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined, schemaName?: string) {
    const table = schemaName ? catalog?.schemas?.find((schema) => schema.name === schemaName)?.tables[0] : catalog?.tables?.[0]
    if (!table) return 'select 1;'
    const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', catalog?.name ?? '', schemaName, table.name)
    if (connection?.dbType === 'oracle') return `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;`
    if (connection?.dbType === 'sqlserver') return `SELECT TOP (100) *\nFROM ${qualified};`
    return `SELECT *\nFROM ${qualified}\nLIMIT 100;`
  }

  watch(
    () => activeSqlTab.value && [activeSqlTab.value.connectionId, activeSqlTab.value.catalogName].join('|'),
    () => {
      const tab = activeSqlTab.value
      if (tab) repairSqlTabContext(tab)
    }
  )

  return {
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
    isSqlConsoleContextReady,
    defaultSqlContextForConnection,
    updateSqlTabCatalog,
    updateSqlTabSchema,
    renderDefaultSql
  }
}
