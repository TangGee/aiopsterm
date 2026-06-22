import { computed, type ComputedRef, type Ref } from 'vue'
import { isDatabaseConnectionMutationDataForRequest } from '@/services/databaseBackendGuards'
import type { SqlConsoleContext, WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseConnectionMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'

type SqlTab = Extract<WorkspaceTab, { kind: 'sql' }>

type DatabaseWorkspaceSqlTabState = {
  tabs: Ref<WorkspaceTab[]>
  activeTabId: Ref<string>
  activeSqlTab: ComputedRef<SqlTab | null>
  expandedConnections: Ref<string[]>
}

type DatabaseWorkspaceSqlTabDeps = {
  showNotice: (text: string) => void
  closeMenus: () => void
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  resolveSqlConsoleContext: (connectionId?: string) => SqlConsoleContext
  applyDatabaseCatalogMutationResult: <T extends DatabaseWorkspaceCatalog>(
    result: { ok: boolean; data?: unknown; errorMessage?: string },
    fallbackError: string,
    isData?: (value: unknown) => value is T,
    malformedError?: string
  ) => boolean
  applySqlTabConnectionContext: (tab: SqlTab, connection: DatabaseConnectionInfo) => void
  connectConnection: (connectionId: string) => Promise<DatabaseConnectionMutationResult>
  createSqlTabId?: () => string
}

const fileNameFromPath = (filePath: string) => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath

export const createDatabaseWorkspaceSqlTabRuntime = (
  state: DatabaseWorkspaceSqlTabState,
  deps: DatabaseWorkspaceSqlTabDeps
) => {
  const {
    tabs,
    activeTabId,
    activeSqlTab,
    expandedConnections
  } = state
  const {
    showNotice,
    closeMenus,
    findConnection,
    resolveSqlConsoleContext,
    applyDatabaseCatalogMutationResult,
    applySqlTabConnectionContext,
    connectConnection
  } = deps
  const createSqlTabId = deps.createSqlTabId ?? (() => `tab-sql-${Date.now()}`)

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

  const nextQueryTitle = () => {
    const indexes = tabs.value
      .filter((tab) => tab.kind === 'sql')
      .map((tab) => /^Query (\d+)$/.exec(tab.title)?.[1])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value))
    return `Query ${indexes.length ? Math.max(...indexes) + 1 : 1}`
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
      const result = await connectConnection(requestedConnectionId)
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

  function closeTab(tabId: string) {
    const index = tabs.value.findIndex((tab) => tab.id === tabId)
    if (index <= 0) return
    tabs.value.splice(index, 1)
    if (activeTabId.value === tabId) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id ?? 'tab-overview'
  }

  function openSqlConsole(connectionId?: string) {
    const context = resolveSqlConsoleContext(connectionId)
    const connection = findConnection(context.connectionId)
    const catalog = connection?.catalogs.find((item) => item.name === context.catalogName) ?? connection?.catalogs[0]
    const tab: WorkspaceTab = {
      id: createSqlTabId(),
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

  return {
    activeSqlHasText,
    activeSqlSaving,
    activeSqlIsDirty,
    activeSqlSaveTitle,
    activeSqlSaveStateText,
    closeTab,
    openSqlConsole,
    updateSqlTabConnection
  }
}
