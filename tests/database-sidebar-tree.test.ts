import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DatabaseSidebarTree from '@/components/database/DatabaseSidebarTree.vue'
import type { DatabaseConnectionInfo, DatabaseTableInfo } from '@shared/contracts/database'

const sqliteTable: DatabaseTableInfo = {
  id: 'table-sqlite-events',
  name: 'events',
  columns: [{ name: 'id', type: 'INTEGER', nullable: false, key: 'PK' }],
  primaryKey: ['id']
}

const postgresTable: DatabaseTableInfo = {
  id: 'table-postgres-orders',
  name: 'orders',
  columns: [{ name: 'id', type: 'BIGINT', nullable: false, key: 'PK' }],
  primaryKey: ['id']
}

const sqliteConnection: DatabaseConnectionInfo = {
  id: 'connection-sqlite',
  name: 'events.db',
  dbType: 'sqlite',
  env: 'Development',
  groupId: 'group-default',
  host: 'local',
  port: null,
  authentication: 'UserAndPassword',
  user: '',
  database: 'main',
  filePath: '/tmp/events.db',
  status: 'connected',
  catalogs: [{ name: 'main', tables: [sqliteTable] }]
}

const postgresConnection: DatabaseConnectionInfo = {
  id: 'connection-postgres',
  name: 'orders@db.local:5432',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-default',
  host: 'db.local',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: [
    {
      name: 'orders',
      schemas: [{ name: 'public', tables: [postgresTable], views: [], functions: [], procedures: [] }]
    }
  ]
}

describe('DatabaseSidebarTree', () => {
  it('flattens a single SQLite catalog while retaining main in table actions', async () => {
    const wrapper = mount(DatabaseSidebarTree, {
      props: {
        sidebarCollapsed: false,
        keyword: '',
        visibleGroupNodes: [{ id: 'group-default', name: 'Default Group', depth: 0 }],
        selectedNodeId: null,
        editingGroupId: null,
        editingGroupName: '',
        expandedGroups: ['group-default'],
        expandedConnections: [sqliteConnection.id, postgresConnection.id],
        expandedCatalogs: [`${sqliteConnection.id}:main`, `${postgresConnection.id}:orders`],
        expandedSchemas: [`${postgresConnection.id}:orders:public`],
        expandedSchemaObjectFolders: [`${postgresConnection.id}:orders:public:tables`],
        expandedTables: [sqliteTable.id],
        connectionsByGroup: () => [sqliteConnection, postgresConnection],
        engineAccent: () => '#888888'
      }
    })

    const connectionRows = wrapper.findAll('.db-tree-row.connection')
    const sqliteRow = connectionRows.find((row) => row.text().includes('events.db'))
    const postgresRow = connectionRows.find((row) => row.text().includes('orders@db.local:5432'))
    expect(sqliteRow).toBeDefined()
    expect(postgresRow).toBeDefined()

    const sqliteItem = sqliteRow!.element.parentElement!
    const postgresItem = postgresRow!.element.parentElement!
    expect(sqliteItem.querySelectorAll('.db-tree-row.database')).toHaveLength(0)
    expect(sqliteItem.querySelector('.db-tree-row.folder')?.textContent).toContain('tables')
    expect(sqliteItem.querySelector('.db-tree-row.table')?.textContent).toContain('events')
    expect(postgresItem.querySelector('.db-tree-row.database')?.textContent).toContain('orders')

    const groupRow = wrapper.find('.db-tree-row.group')
    await groupRow.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual(['group-default'])
    expect(wrapper.emitted('toggleGroup')?.at(-1)).toEqual(['group-default'])

    await sqliteRow!.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual([sqliteConnection.id])
    expect(wrapper.emitted('toggleConnection')?.at(-1)).toEqual([sqliteConnection.id])

    const postgresCatalogRow = wrapper.find('.db-tree-row.database')
    await postgresCatalogRow.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual([`${postgresConnection.id}:orders`])
    expect(wrapper.emitted('toggleCatalog')?.at(-1)).toEqual([postgresConnection.id, 'orders'])

    const postgresSchemaRow = wrapper.find('.db-tree-row.schema')
    await postgresSchemaRow.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual([`${postgresConnection.id}:orders:public`])
    expect(wrapper.emitted('toggleSchema')?.at(-1)).toEqual([postgresConnection.id, 'orders', 'public'])

    const schemaTablesFolder = wrapper
      .findAll('.db-tree-row.folder')
      .find((row) => row.find('small').exists() && row.text().includes('tables'))!
    await schemaTablesFolder.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual([`${postgresConnection.id}:orders:public:tables`])
    expect(wrapper.emitted('toggleSchemaObjectFolder')?.at(-1)).toEqual([postgresConnection.id, 'orders', 'public', 'tables'])

    const sqliteFolder = wrapper.findAll('.db-tree-row.folder').find((row) => row.text().trim() === 'tables')!
    await sqliteFolder.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual([`${sqliteConnection.id}:main`])
    expect(wrapper.emitted('toggleCatalog')?.at(-1)).toEqual([sqliteConnection.id, 'main'])
    const catalogToggleCount = wrapper.emitted('toggleCatalog')?.length ?? 0
    await sqliteFolder.find('button').trigger('click')
    expect(wrapper.emitted('toggleCatalog')?.at(-1)).toEqual([sqliteConnection.id, 'main'])
    expect(wrapper.emitted('toggleCatalog')).toHaveLength(catalogToggleCount + 1)

    const sqliteTableRow = wrapper.findAll('.db-tree-row.table').find((row) => row.text().trim() === 'events')!
    const tableToggleCount = wrapper.emitted('toggleTable')?.length ?? 0
    await sqliteTableRow.trigger('click')
    expect(wrapper.emitted('selectNode')?.at(-1)).toEqual([sqliteTable.id])
    expect(wrapper.emitted('toggleTable') ?? []).toHaveLength(tableToggleCount)
    await sqliteTableRow.find('button').trigger('click')
    expect(wrapper.emitted('toggleTable')?.at(-1)).toEqual([sqliteTable.id])
    await sqliteTableRow.trigger('dblclick')
    expect(wrapper.emitted('openTable')?.at(-1)).toEqual([sqliteConnection.id, 'main', sqliteTable])
    await sqliteTableRow.trigger('contextmenu')
    expect(wrapper.emitted('openContextMenu')?.at(-1)?.[1]).toEqual({
      type: 'table',
      connectionId: sqliteConnection.id,
      catalogName: 'main',
      tableId: sqliteTable.id,
      label: sqliteTable.name
    })
  })
})
