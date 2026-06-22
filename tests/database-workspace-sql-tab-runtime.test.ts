import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseWorkspaceSqlTabRuntime } from '@/services/databaseWorkspaceSqlTabRuntime'
import type { WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseConnectionMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const makeConnection = (overrides: Partial<DatabaseConnectionInfo> = {}): DatabaseConnectionInfo => ({
  id: 'conn-orders',
  name: 'orders-db',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-root',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: [
    {
      name: 'orders',
      schemas: [{ name: 'public', tables: [], views: [] }]
    },
    {
      name: 'reporting',
      schemas: [{ name: 'mart', tables: [], views: [] }]
    }
  ],
  ...overrides
})

const makeCatalog = (connection: DatabaseConnectionInfo): DatabaseWorkspaceCatalog => ({
  engines: [{ code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' }],
  groups: [{ id: 'group-root', name: 'Root' }],
  groupParents: { 'group-root': null },
  connections: [connection],
  defaults: {
    selectedNodeId: connection.id,
    expandedGroupIds: ['group-root'],
    expandedConnectionIds: [connection.id],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
})

const makeSqlTab = (overrides: Partial<Extract<WorkspaceTab, { kind: 'sql' }>> = {}): Extract<WorkspaceTab, { kind: 'sql' }> => ({
  id: 'tab-sql-1',
  kind: 'sql',
  title: 'Query 1',
  connectionId: 'conn-orders',
  catalogName: 'orders',
  schemaName: 'public',
  sql: '',
  savedSql: '',
  saving: false,
  saveError: null,
  resultTabs: [],
  activeResultTabId: 'overview',
  history: [],
  ...overrides
})

const makeRuntime = (options: { connection?: DatabaseConnectionInfo; tabs?: WorkspaceTab[]; activeTabId?: string } = {}) => {
  let connection = options.connection ?? makeConnection()
  const tabs = ref<WorkspaceTab[]>(options.tabs ?? [{ id: 'tab-overview', kind: 'overview', title: 'Overview' }, makeSqlTab()])
  const activeTabId = ref(options.activeTabId ?? 'tab-sql-1')
  const expandedConnections = ref<string[]>([])
  const notices: string[] = []
  const applySqlTabConnectionContext = vi.fn((tab: Extract<WorkspaceTab, { kind: 'sql' }>, nextConnection: DatabaseConnectionInfo) => {
    tab.connectionId = nextConnection.id
    tab.catalogName = nextConnection.catalogs[0]?.name ?? ''
    tab.schemaName = nextConnection.catalogs[0]?.schemas?.[0]?.name ?? ''
  })
  const deps = {
    showNotice: vi.fn((text: string) => notices.push(text)),
    closeMenus: vi.fn(),
    findConnection: vi.fn((id: string) => (id === connection.id ? connection : undefined)),
    resolveSqlConsoleContext: vi.fn((connectionId?: string) => ({
      connectionId: connectionId ?? connection.id,
      catalogName: connection.catalogs[1]?.name ?? connection.catalogs[0]?.name ?? '',
      schemaName: connection.catalogs[1]?.schemas?.[0]?.name ?? connection.catalogs[0]?.schemas?.[0]?.name ?? ''
    })),
    applyDatabaseCatalogMutationResult: vi.fn(<T extends DatabaseWorkspaceCatalog>(
      result: { ok: boolean; data?: unknown; errorMessage?: string },
      _fallbackError: string,
      isData?: (value: unknown) => value is T
    ) => {
      if (!result.ok || (isData && !isData(result.data))) return false
      const data = result.data as Partial<NonNullable<DatabaseConnectionMutationResult['data']>> | undefined
      if (data?.connection) connection = data.connection
      return true
    }),
    applySqlTabConnectionContext,
    connectConnection: vi.fn(async (connectionId: string): Promise<DatabaseConnectionMutationResult> => {
      const connected = makeConnection({ id: connectionId, status: 'connected' })
      return {
        ok: true,
        data: {
          ...makeCatalog(connected),
          connection: connected,
          message: 'Connection opened'
        }
      }
    }),
    createSqlTabId: vi.fn(() => `tab-sql-${tabs.value.length}`)
  }
  const runtime = createDatabaseWorkspaceSqlTabRuntime(
    {
      tabs,
      activeTabId,
      activeSqlTab: computed(() => {
        const tab = tabs.value.find((item) => item.id === activeTabId.value)
        return tab?.kind === 'sql' ? tab : null
      }),
      expandedConnections
    },
    deps
  )

  return {
    activeTabId,
    deps,
    expandedConnections,
    notices,
    runtime,
    tabs
  }
}

describe('databaseWorkspaceSqlTabRuntime', () => {
  it('projects SQL save state and creates SQL consoles from resolved context', () => {
    const { activeTabId, deps, runtime, tabs } = makeRuntime({
      tabs: [
        { id: 'tab-overview', kind: 'overview', title: 'Overview' },
        makeSqlTab({ id: 'tab-sql-1', title: 'Query 1', sql: 'select 1', savedSql: 'select 1', filePath: '/tmp/query-one.sql' }),
        makeSqlTab({ id: 'tab-sql-3', title: 'Query 3' })
      ]
    })
    activeTabId.value = 'tab-sql-1'

    expect(runtime.activeSqlHasText.value).toBe(true)
    expect(runtime.activeSqlSaving.value).toBe(false)
    expect(runtime.activeSqlIsDirty.value).toBe(false)
    expect(runtime.activeSqlSaveTitle.value).toBe('Save')
    expect(runtime.activeSqlSaveStateText.value).toBe('Saved: query-one.sql')

    const active = tabs.value[1]
    if (active.kind !== 'sql') throw new Error('expected sql tab')
    active.sql = 'select 2'
    expect(runtime.activeSqlIsDirty.value).toBe(true)
    expect(runtime.activeSqlSaveStateText.value).toBe('Unsaved changes')
    active.filePath = undefined
    expect(runtime.activeSqlSaveStateText.value).toBe('Not saved')
    active.saving = true
    expect(runtime.activeSqlSaveTitle.value).toBe('Saving')
    expect(runtime.activeSqlSaveStateText.value).toBe('Saving...')
    active.saving = false
    active.saveError = 'Disk full'
    expect(runtime.activeSqlSaveStateText.value).toBe('Disk full')

    runtime.openSqlConsole('conn-orders')

    expect(deps.resolveSqlConsoleContext).toHaveBeenCalledWith('conn-orders')
    expect(deps.closeMenus).toHaveBeenCalledTimes(1)
    expect(tabs.value.at(-1)).toMatchObject({
      id: 'tab-sql-3',
      kind: 'sql',
      title: 'Query 4',
      connectionId: 'conn-orders',
      catalogName: 'reporting',
      schemaName: 'mart',
      sql: ''
    })
    expect(activeTabId.value).toBe('tab-sql-3')
  })

  it('closes tabs with active-tab fallback while keeping overview protected', () => {
    const { activeTabId, runtime, tabs } = makeRuntime({
      tabs: [
        { id: 'tab-overview', kind: 'overview', title: 'Overview' },
        makeSqlTab({ id: 'tab-sql-1', title: 'Query 1' }),
        makeSqlTab({ id: 'tab-sql-2', title: 'Query 2' })
      ],
      activeTabId: 'tab-sql-2'
    })

    runtime.closeTab('tab-overview')
    expect(tabs.value.map((tab) => tab.id)).toEqual(['tab-overview', 'tab-sql-1', 'tab-sql-2'])

    runtime.closeTab('tab-sql-2')
    expect(tabs.value.map((tab) => tab.id)).toEqual(['tab-overview', 'tab-sql-1'])
    expect(activeTabId.value).toBe('tab-sql-1')
  })

  it('auto-connects idle SQL tab connections before applying SQL context', async () => {
    const idle = makeConnection({ status: 'idle' })
    const { deps, expandedConnections, notices, runtime, tabs } = makeRuntime({ connection: idle })
    const select = { value: idle.id }

    await runtime.updateSqlTabConnection({ target: select } as unknown as Event)

    expect(deps.connectConnection).toHaveBeenCalledWith('conn-orders')
    expect(deps.applyDatabaseCatalogMutationResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      'Database connection failed.',
      expect.any(Function),
      'Database connection backend returned malformed result data.'
    )
    expect(expandedConnections.value).toEqual(['conn-orders'])
    expect(notices).toContain('Connection auto-connected for SQL context')
    expect(deps.applySqlTabConnectionContext).toHaveBeenCalledWith(tabs.value[1], expect.objectContaining({ id: 'conn-orders', status: 'connected' }))
  })

  it('fails closed for missing or malformed SQL tab connection changes', async () => {
    const idle = makeConnection({ status: 'idle' })
    const { deps, expandedConnections, runtime, tabs } = makeRuntime({ connection: idle })
    const active = tabs.value[1]
    if (active.kind !== 'sql') throw new Error('expected sql tab')

    const missingSelect = { value: 'missing' }
    await runtime.updateSqlTabConnection({ target: missingSelect } as unknown as Event)
    expect(active).toMatchObject({ connectionId: '', catalogName: '', schemaName: '' })

    active.connectionId = 'conn-orders'
    active.catalogName = 'orders'
    active.schemaName = 'public'
    deps.applyDatabaseCatalogMutationResult.mockReturnValueOnce(false)
    const select = { value: idle.id }
    await runtime.updateSqlTabConnection({ target: select } as unknown as Event)

    expect(deps.applySqlTabConnectionContext).not.toHaveBeenCalled()
    expect(expandedConnections.value).toEqual([])
    expect(active).toMatchObject({ connectionId: 'conn-orders', catalogName: 'orders', schemaName: 'public' })
  })
})
