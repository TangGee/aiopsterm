import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseWorkspaceCatalogRuntime } from '@/services/databaseWorkspaceCatalogRuntime'
import { makeDataMutationPlanState, makeDirtyState } from '@/services/databaseGridRuntime'
import { columnNodeId, schemaObjectFolderKey } from '@/services/databaseWorkspaceRuntime'
import type { WorkspaceTab } from '@/services/databaseWorkspaceTypes'
import type { DatabaseConnectionInfo, DatabaseWorkspaceCatalog } from '@shared/contracts/database'

const connection: DatabaseConnectionInfo = {
  id: 'conn-orders',
  name: 'orders-postgres',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-child',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'readonly',
  hasPassword: true,
  database: 'orders',
  status: 'connected',
  catalogs: [
    {
      name: 'orders',
      schemas: [
        {
          name: 'public',
          tables: [
            {
              id: 'tbl-orders',
              name: 'orders',
              columns: [{ name: 'id', type: 'integer', nullable: false, key: 'PK' }],
              primaryKey: ['id']
            }
          ],
          views: [],
          functions: ['calculate_order_age(order_id bigint)'],
          procedures: []
        }
      ]
    }
  ]
}

const catalog: DatabaseWorkspaceCatalog = {
  engines: [{ code: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' }],
  groups: [
    { id: 'group-root', name: 'Root' },
    { id: 'group-child', name: 'Child' }
  ],
  groupParents: { 'group-root': null, 'group-child': 'group-root' },
  connections: [connection],
  defaults: {
    selectedNodeId: schemaObjectFolderKey(connection.id, 'orders', 'public', 'tables'),
    expandedGroupIds: ['group-root'],
    expandedConnectionIds: [connection.id],
    expandedCatalogIds: [`${connection.id}:orders`],
    expandedSchemaIds: [`${connection.id}:orders:public`],
    expandedSchemaObjectFolderIds: [schemaObjectFolderKey(connection.id, 'orders', 'public', 'tables')]
  }
}

describe('databaseWorkspaceCatalogRuntime', () => {
  it('owns catalog tree projection, node selection, and SQL context repair', () => {
    const tabs = ref<WorkspaceTab[]>([
      { id: 'tab-overview', kind: 'overview', title: 'Overview' },
      {
        id: 'tab-sql',
        kind: 'sql',
        title: 'Query 1',
        connectionId: connection.id,
        catalogName: 'stale',
        schemaName: '',
        sql: '',
        savedSql: '',
        saving: false,
        saveError: null,
        resultTabs: [],
        activeResultTabId: 'overview',
        history: []
      },
      {
        id: 'tab-data',
        kind: 'data',
        title: 'missing',
        connectionId: connection.id,
        catalogName: 'orders',
        schemaName: 'public',
        tableId: 'missing-table',
        tableName: 'missing',
        columns: [],
        sourceRows: [],
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
        knownColumns: [],
        durationMs: 1,
        dirtyState: makeDirtyState([{ id: 1 }], ['id']),
        undoStack: [],
        mutationPlan: makeDataMutationPlanState(),
        saving: false,
        saveError: null
      }
    ])
    const activeTabId = ref('tab-overview')
    const markDataTabMissing = vi.fn((tab: Extract<WorkspaceTab, { kind: 'data' }>, message: string) => {
      tab.error = message
      tab.rows = []
      tab.total = 0
    })
    const runtime = createDatabaseWorkspaceCatalogRuntime(
      {
        tabs,
        activeTab: computed(() => tabs.value.find((tab) => tab.id === activeTabId.value)),
        activeSqlTab: computed(() => {
          const tab = tabs.value.find((item) => item.id === activeTabId.value)
          return tab?.kind === 'sql' ? tab : null
        })
      },
      {
        showNotice: vi.fn(),
        errorToMessage: (error) => (error instanceof Error ? error.message : String(error)),
        markDataTabMissing,
        syncCatalogDependents: vi.fn()
      }
    )

    runtime.applyDatabaseCatalog(catalog)

    expect(runtime.visibleGroupNodes.value.map((group) => [group.id, group.depth])).toEqual([
      ['group-root', 0],
      ['group-child', 1]
    ])
    expect(runtime.connectionsByGroup('group-child').map((item) => item.id)).toEqual([connection.id])
    expect(tabs.value[1]).toMatchObject({ catalogName: 'orders', schemaName: 'public' })
    expect(markDataTabMissing).toHaveBeenCalledWith(tabs.value[2], 'Table no longer exists in the backend catalog')
    expect(runtime.resolveSqlConsoleContext()).toEqual({ connectionId: connection.id, catalogName: 'orders', schemaName: 'public' })

    activeTabId.value = 'tab-sql'
    expect(runtime.activeSqlCanRun.value).toBe(true)
    runtime.updateSqlTabSchema({ target: { value: 'public' } } as unknown as Event)
    expect(tabs.value[1]).toMatchObject({ schemaName: 'public', tableId: undefined, tableName: undefined })

    runtime.toggleGroup('group-root')
    expect(runtime.expandedGroups.value).toEqual([])
    runtime.selectColumnNode(connection.catalogs[0].schemas![0].tables[0], connection.catalogs[0].schemas![0].tables[0].columns[0])
    expect(runtime.selectedNodeId.value).toBe(columnNodeId('tbl-orders', 'id'))
  })
})
