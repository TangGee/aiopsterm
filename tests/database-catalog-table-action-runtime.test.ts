import { computed, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseCatalogTableActionRuntime } from '@/services/databaseCatalogTableActionRuntime'
import { makeDataMutationPlanState, makeDirtyState } from '@/services/databaseGridRuntime'
import type { TableDdlResult } from '@/services/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  DatabaseDangerConfirmState,
  DatabaseDdlModalState,
  WorkspaceTab
} from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabaseTableInfo,
  DatabaseTableMutationResult,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const table: DatabaseTableInfo = {
  id: 'tbl-orders',
  name: 'orders',
  columns: [{ name: 'id', type: 'integer', nullable: false, key: 'PK' }],
  primaryKey: ['id']
}

const makeConnection = (dbType: DatabaseEngineCode = 'postgresql'): DatabaseConnectionInfo => ({
  id: 'conn-orders',
  name: 'orders-db',
  dbType,
  env: 'Production',
  groupId: 'group-root',
  host: '127.0.0.1',
  port: dbType === 'postgresql' ? 5432 : 3306,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: [
    {
      name: 'orders',
      schemas: [{ name: 'public', tables: [table], views: [] }]
    }
  ]
})

const makeCatalog = (connections: DatabaseConnectionInfo[] = [makeConnection()]): DatabaseWorkspaceCatalog => ({
  engines: [{ code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' }],
  groups: [{ id: 'group-root', name: 'Root' }],
  groupParents: { 'group-root': null },
  connections,
  defaults: {
    selectedNodeId: null,
    expandedGroupIds: ['group-root'],
    expandedConnectionIds: connections.map((connection) => connection.id),
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
})

const makeTableMenu = (): ContextMenu => ({
  type: 'table',
  connectionId: 'conn-orders',
  catalogName: 'orders',
  schemaName: 'public',
  tableId: 'tbl-orders',
  label: 'orders',
  x: 10,
  y: 20
})

const makeDdlModal = (): DatabaseDdlModalState =>
  reactive({
    open: false,
    tableName: '',
    ddl: '',
    connectionId: '',
    catalogName: '',
    schemaName: '',
    tableId: '',
    loading: false,
    error: '',
    errorCode: ''
  })

const makeDangerConfirm = (): DatabaseDangerConfirmState =>
  reactive({
    open: false,
    action: 'drop',
    connectionId: '',
    catalogName: '',
    schemaName: '',
    tableId: '',
    tableName: '',
    sql: '',
    confirmText: ''
  })

const makeDataTab = (): Extract<WorkspaceTab, { kind: 'data' }> => ({
  id: 'tab-data-orders',
  kind: 'data',
  title: 'orders',
  connectionId: 'conn-orders',
  catalogName: 'orders',
  schemaName: 'public',
  tableId: 'tbl-orders',
  tableName: 'orders',
  columns: ['id'],
  sourceRows: [{ id: 1 }],
  rows: [{ id: 1 }],
  primaryKey: ['id'],
  whereRaw: '',
  whereDraft: '',
  orderByRaw: '',
  orderByDraft: '',
  page: 1,
  pageSize: 100,
  filters: [],
  sort: null,
  selectedRowKey: null,
  loading: false,
  error: null,
  total: 1,
  rowCount: 1,
  knownColumns: ['id'],
  durationMs: 1,
  dirtyState: makeDirtyState([{ id: 1 }], ['id']),
  undoStack: [],
  mutationPlan: makeDataMutationPlanState(),
  saving: false,
  saveError: null
})

const makeRuntime = (options: { dbType?: DatabaseEngineCode; menu?: ContextMenu | null } = {}) => {
  const connection = makeConnection(options.dbType)
  const tabs = ref<WorkspaceTab[]>([
    {
      id: 'tab-sql',
      kind: 'sql',
      title: 'Query 1',
      connectionId: '',
      catalogName: '',
      schemaName: '',
      sql: '',
      savedSql: '',
      saving: false,
      saveError: null,
      resultTabs: [],
      activeResultTabId: 'overview',
      history: []
    }
  ])
  const activeTabId = ref('tab-sql')
  const contextMenu = ref<ContextMenu | null>(options.menu === undefined ? makeTableMenu() : options.menu)
  const ddlModal = makeDdlModal()
  const dangerConfirm = makeDangerConfirm()
  const expandedTables = ref<string[]>(['conn-orders:orders:public:tbl-orders'])
  const selectedNodeId = ref<string | null>('tbl-orders')
  const notices: string[] = []
  const dataTab = makeDataTab()
  const removedTabIds = new Set(['tab-data-orders', 'tab-ddl-orders'])
  const catalogAfterDrop = makeCatalog([{ ...connection, catalogs: [{ name: 'orders', schemas: [{ name: 'public', tables: [], views: [] }] }] }])

  const deps = {
    showNotice: vi.fn((text: string) => notices.push(text)),
    copyText: vi.fn(async () => true),
    closeMenus: vi.fn(() => {
      contextMenu.value = null
    }),
    findConnection: vi.fn((id: string) => (id === connection.id ? connection : undefined)),
    findTable: vi.fn((connectionId: string, catalogName: string, tableId: string) =>
      connectionId === connection.id && catalogName === 'orders' && tableId === table.id ? table : null
    ),
    openSqlConsole: vi.fn((connectionId?: string) => {
      const tab = tabs.value.find((item) => item.id === activeTabId.value)
      if (tab?.kind === 'sql' && connectionId) tab.connectionId = connectionId
    }),
    applyDatabaseCatalog: vi.fn(),
    databaseNodeExists: vi.fn((id: string | null) => id !== 'tbl-orders'),
    fetchTableDdl: vi.fn(async (): Promise<TableDdlResult> => ({ ok: true, ddl: 'CREATE TABLE public.orders (id integer);' }))
  }

  const hooks = {
    openTable: vi.fn(),
    mutateDatabaseTableThroughBackend: vi.fn(async (input): Promise<DatabaseTableMutationResult> => ({
      ok: true,
      data: {
        affected: input.mutations[0]?.kind === 'truncate' ? 1 : 0,
        durationMs: 12,
        ...(input.mutations[0]?.kind === 'drop' ? { catalog: catalogAfterDrop } : {})
      }
    })),
    dataTabsMatching: vi.fn(() => [dataTab]),
    reloadDataTab: vi.fn(async () => undefined),
    tabIdsMatching: vi.fn(() => removedTabIds),
    cleanupDroppedTableUi: vi.fn((_ctx, _removedTabIds, options) => {
      if (options.ddlOpen) options.setDdlOpen(false)
    }),
    openDbAi: vi.fn()
  }

  const runtime = createDatabaseCatalogTableActionRuntime(
    {
      contextMenu,
      activeSqlTab: computed(() => {
        const tab = tabs.value.find((item) => item.id === activeTabId.value)
        return tab?.kind === 'sql' ? tab : null
      }),
      ddlModal,
      dangerConfirm,
      expandedTables,
      selectedNodeId
    },
    deps,
    hooks
  )

  return {
    activeSqlTab: computed(() => {
      const tab = tabs.value.find((item) => item.id === activeTabId.value)
      return tab?.kind === 'sql' ? tab : null
    }),
    catalogAfterDrop,
    contextMenu,
    dataTab,
    dangerConfirm,
    deps,
    ddlModal,
    hooks,
    notices,
    removedTabIds,
    runtime
  }
}

describe('databaseCatalogTableActionRuntime', () => {
  it('opens selected tables and prepares dialect-aware SQL consoles', () => {
    const { activeSqlTab, contextMenu, deps, hooks, runtime } = makeRuntime({ dbType: 'postgresql' })

    runtime.openContextTable()

    expect(hooks.openTable).toHaveBeenCalledWith('conn-orders', 'orders', table, 'public')
    expect(deps.closeMenus).toHaveBeenCalledTimes(1)

    const second = makeRuntime({ dbType: 'sqlserver' })
    second.runtime.openContextSql()
    expect(second.deps.openSqlConsole).toHaveBeenCalledWith('conn-orders')
    expect(second.activeSqlTab.value).toMatchObject({
      connectionId: 'conn-orders',
      catalogName: 'orders',
      schemaName: 'public',
      tableId: 'tbl-orders',
      tableName: 'orders',
      sql: 'SELECT TOP (100) *\nFROM [public].[orders];'
    })

    contextMenu.value = makeTableMenu()
    runtime.openContextSql()
    expect(activeSqlTab.value?.sql).toBe('SELECT *\nFROM "public"."orders"\nLIMIT 100;')
  })

  it('loads DDL into the modal and copies table SQL artifacts', async () => {
    const { contextMenu, deps, ddlModal, notices, runtime } = makeRuntime()

    await runtime.openDdlModalFromContext()
    expect(ddlModal).toMatchObject({
      open: true,
      tableName: 'orders',
      connectionId: 'conn-orders',
      catalogName: 'orders',
      schemaName: 'public',
      tableId: 'tbl-orders',
      loading: false,
      ddl: 'CREATE TABLE public.orders (id integer);',
      error: ''
    })
    expect(deps.fetchTableDdl).toHaveBeenCalledWith({
      connectionId: 'conn-orders',
      catalogName: 'orders',
      schemaName: 'public',
      tableId: 'tbl-orders',
      tableName: 'orders'
    })
    expect(deps.closeMenus).toHaveBeenCalledTimes(1)

    const copySelect = makeRuntime()
    await copySelect.runtime.copySelectSql()
    expect(copySelect.deps.copyText).toHaveBeenCalledWith('SELECT * FROM "public"."orders"')
    expect(copySelect.notices).toContain('SELECT copied')
    expect(copySelect.deps.closeMenus).toHaveBeenCalledTimes(1)

    const copyDdl = makeRuntime()
    await copyDdl.runtime.copyTableDdlFromContext()
    expect(copyDdl.deps.copyText).toHaveBeenCalledWith('CREATE TABLE public.orders (id integer);')
    expect(copyDdl.notices).toContain('DDL copied')

    copyDdl.ddlModal.ddl = ''
    await copyDdl.runtime.copyDdl()
    expect(copyDdl.notices).toContain('DDL is empty')
    copyDdl.ddlModal.ddl = 'CREATE TABLE public.orders (id integer);'
    await copyDdl.runtime.copyDdl()
    expect(copyDdl.notices.filter((notice) => notice === 'DDL copied')).toHaveLength(2)
    copyDdl.runtime.closeDdlModal()
    expect(copyDdl.ddlModal.open).toBe(false)

    contextMenu.value = makeTableMenu()
    deps.fetchTableDdl.mockResolvedValueOnce({ ok: false, errorCode: 'permission', errorMessage: 'denied' })
    await runtime.openDdlModalFromContext()
    expect(ddlModal).toMatchObject({
      loading: false,
      errorCode: 'permission',
      error: 'DDL permission denied: denied'
    })
    expect(notices).toContain('DDL permission denied: denied')
  })

  it('routes truncate through backend mutation and reloads matching data tabs', async () => {
    const { dangerConfirm, dataTab, deps, hooks, notices, runtime } = makeRuntime()

    runtime.requestDangerousTableAction('truncate')
    expect(dangerConfirm).toMatchObject({
      open: true,
      action: 'truncate',
      connectionId: 'conn-orders',
      catalogName: 'orders',
      schemaName: 'public',
      tableId: 'tbl-orders',
      tableName: 'orders',
      sql: 'TRUNCATE TABLE public.orders;',
      confirmText: ''
    })
    expect(deps.closeMenus).toHaveBeenCalledTimes(1)

    runtime.updateDangerConfirmText('orders')
    await runtime.confirmDangerousTableAction()

    expect(hooks.openDbAi).toHaveBeenCalledWith(
      'truncate',
      'TRUNCATE TABLE public.orders;',
      'orders-db · orders · public · orders',
      {
        connectionId: 'conn-orders',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders',
        contextSummary: 'orders-db · orders · public · orders'
      }
    )
    expect(hooks.mutateDatabaseTableThroughBackend).toHaveBeenCalledWith({
      connectionId: 'conn-orders',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'truncate' }]
    })
    expect(hooks.dataTabsMatching).toHaveBeenCalledWith({
      connectionId: 'conn-orders',
      catalogName: 'orders',
      schemaName: 'public',
      tableId: 'tbl-orders',
      tableName: 'orders'
    })
    expect(hooks.reloadDataTab).toHaveBeenCalledWith(dataTab, {
      withTotal: true,
      preserveDirty: false,
      notice: 'Table truncated through backend table store'
    })
    expect(notices).toContain('Table truncated through backend table store')
    expect(dangerConfirm.open).toBe(false)
    expect(dangerConfirm.confirmText).toBe('')
  })

  it('routes drop through backend mutation, applies catalog, and cleans dropped table UI', async () => {
    const { catalogAfterDrop, dangerConfirm, deps, ddlModal, hooks, notices, removedTabIds, runtime } = makeRuntime()
    ddlModal.open = true
    ddlModal.connectionId = 'conn-orders'
    ddlModal.catalogName = 'orders'
    ddlModal.schemaName = 'public'
    ddlModal.tableId = 'tbl-orders'
    ddlModal.tableName = 'orders'

    runtime.requestDangerousTableAction('drop')
    runtime.updateDangerConfirmText('orders')
    await runtime.confirmDangerousTableAction()

    expect(hooks.mutateDatabaseTableThroughBackend).toHaveBeenCalledWith({
      connectionId: 'conn-orders',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'drop' }]
    })
    expect(hooks.tabIdsMatching).toHaveBeenCalledWith({
      connectionId: 'conn-orders',
      catalogName: 'orders',
      schemaName: 'public',
      tableId: 'tbl-orders',
      tableName: 'orders'
    })
    expect(deps.applyDatabaseCatalog).toHaveBeenCalledWith(catalogAfterDrop)
    expect(hooks.cleanupDroppedTableUi).toHaveBeenCalledWith(
      {
        connectionId: 'conn-orders',
        catalogName: 'orders',
        schemaName: 'public',
        tableId: 'tbl-orders',
        tableName: 'orders'
      },
      removedTabIds,
      expect.objectContaining({ ddlOpen: true })
    )
    expect(ddlModal.open).toBe(false)
    expect(notices).toContain('Table dropped through backend table store')
    expect(dangerConfirm.open).toBe(false)
  })

  it('fails closed on malformed backend table mutation results', async () => {
    const { dangerConfirm, hooks, notices, runtime } = makeRuntime()
    hooks.mutateDatabaseTableThroughBackend.mockResolvedValueOnce({ ok: true, data: { affected: 'bad', durationMs: 1 } } as any)

    runtime.requestDangerousTableAction('truncate')
    runtime.updateDangerConfirmText('orders')
    await runtime.confirmDangerousTableAction()

    expect(notices).toContain('Backend table mutation returned malformed result data.')
    expect(dangerConfirm.open).toBe(true)
    expect(dangerConfirm.confirmText).toBe('orders')
    expect(hooks.reloadDataTab).not.toHaveBeenCalled()
  })
})
