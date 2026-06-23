import { afterEach, describe, expect, it, vi } from 'vitest'
import { databaseClient } from '@/services/database/databaseClient'
import type { DatabaseWorkspaceCatalog } from '@shared/contracts/database'

const originalAiops = window.aiops

const connection = {
  id: 'db-1',
  name: 'Production',
  dbType: 'postgresql' as const,
  env: 'Production' as const,
  groupId: 'group-1',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword' as const,
  user: 'ops',
  hasPassword: true,
  database: 'app',
  status: 'connected' as const,
  catalogs: [{ name: 'app', schemas: [{ name: 'public', tables: [{ id: 'table-1', name: 'orders', columns: [{ name: 'id', type: 'integer', nullable: false, key: 'PK' as const }], primaryKey: ['id'] }] }] }]
}

const catalog: DatabaseWorkspaceCatalog = {
  engines: [{ code: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' }],
  groups: [{ id: 'group-1', name: 'Default' }],
  groupParents: { 'group-1': null },
  connections: [connection],
  defaults: {
    selectedNodeId: connection.id,
    expandedGroupIds: ['group-1'],
    expandedConnectionIds: [connection.id],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
}

const aiPaneMessage = {
  id: 'message-1',
  requestId: 'pane-request-1',
  role: 'assistant' as const,
  status: 'done' as const,
  content: 'Use an index.',
  contextSummary: 'Production',
  createdAt: 1781884800000,
  updatedAt: 1781884800000
}

const aiDrawerRequest = {
  id: 'drawer-request-1',
  action: 'explain' as const,
  label: 'Explain',
  status: 'done' as const,
  contextSummary: 'Production',
  sourceSql: 'select 1',
  text: 'Explanation',
  targetDialect: 'postgresql' as const,
  backendContext: { connectionId: connection.id, databaseName: 'app', schemaName: 'public' },
  createdAt: 1781884800000,
  updatedAt: 1781884800000
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('databaseClient', () => {
  it('returns undefined for unavailable bridge methods and binds Database bridge methods', async () => {
    window.aiops = {
      ...originalAiops,
      listDatabaseCatalog: vi.fn(async () => ({ ok: true, data: catalog })),
      testDatabaseConnection: vi.fn(async () => ({ ok: true, data: { dbType: 'postgresql' as const, serverVersion: '15', endpoint: '127.0.0.1:5432', durationMs: 12 } })),
      saveDatabaseConnection: vi.fn(async () => ({ ok: true, data: { ...catalog, connection, message: 'saved' } })),
      createDatabaseGroup: vi.fn(async () => ({ ok: true, data: { ...catalog, group: catalog.groups[0], message: 'created' } })),
      renameDatabaseGroup: vi.fn(async () => ({ ok: true, data: { ...catalog, group: catalog.groups[0], message: 'renamed' } })),
      moveDatabaseGroup: vi.fn(async () => ({ ok: true, data: { ...catalog, group: catalog.groups[0], message: 'moved' } })),
      deleteDatabaseGroup: vi.fn(async () => ({ ok: true, data: { ...catalog, deletedGroupId: 'group-1', message: 'deleted' } })),
      moveDatabaseConnection: vi.fn(async () => ({ ok: true, data: { ...catalog, connection, message: 'moved' } })),
      removeDatabaseConnection: vi.fn(async () => ({ ok: true, data: { ...catalog, connectionId: connection.id, message: 'removed' } })),
      connectDatabaseConnection: vi.fn(async () => ({ ok: true, data: { ...catalog, connection, message: 'connected' } })),
      disconnectDatabaseConnection: vi.fn(async () => ({ ok: true, data: { ...catalog, connection: { ...connection, status: 'idle' as const }, message: 'disconnected' } })),
      refreshDatabaseConnection: vi.fn(async () => ({ ok: true, data: { ...catalog, connection, message: 'refreshed' } })),
      createDatabaseCatalog: vi.fn(async () => ({ ok: true, data: { ...catalog, connection, catalog: catalog.connections[0].catalogs[0], message: 'created' } })),
      executeDatabaseSql: vi.fn(async () => ({
        ok: true,
        data: { columns: ['id'], rows: [{ id: 1 }], rowCount: 1, durationMs: 8, execution: { id: 'exec-1', status: 'ok' as const, message: '1 row', durationMs: 8, rowCount: 1, createdAt: '2026-06-20T00:00:00.000Z' } }
      })),
      getDatabaseTableDdl: vi.fn(async () => ({ ok: true, data: { ddl: 'create table orders(id integer primary key);' } })),
      queryDatabaseTable: vi.fn(async () => ({ ok: true, data: { columns: ['id'], rows: [{ id: 1 }], rowCount: 1, durationMs: 7, total: 1, knownColumns: ['id'] } })),
      planDatabaseTableMutation: vi.fn(async () => ({ ok: true, data: { statements: [], statementCount: 0, preview: '', warning: '' } })),
      mutateDatabaseTable: vi.fn(async () => ({ ok: true, data: { affected: 1, durationMs: 6, catalog } })),
      exportDatabaseRows: vi.fn(async () => ({ ok: true, data: { exported: 1, fileName: 'orders.csv', bytes: 12 } })),
      getDatabasePageComment: vi.fn(async () => ({ ok: true, data: { record: { scope: 'table-page' as const, connectionId: connection.id, databaseName: 'app', tableName: 'orders', comment: 'hot table', updatedAt: 1781884800000 } } })),
      saveDatabasePageComment: vi.fn(async () => ({ ok: true, data: { record: { scope: 'table-page' as const, connectionId: connection.id, databaseName: 'app', tableName: 'orders', comment: 'hot table', updatedAt: 1781884800000 }, message: 'saved' } })),
      getDatabaseAiPaneState: vi.fn(async () => ({ ok: true, data: { open: true, width: 420, context: { connectionId: connection.id, catalogName: 'app', schemaName: 'public', dbType: 'postgresql' as const }, draft: '', messages: [aiPaneMessage] } })),
      saveDatabaseAiPaneState: vi.fn(async (input) => ({ ok: true, data: input })),
      createDatabaseAiPaneRequest: vi.fn(async () => ({ ok: true, data: { requestId: 'pane-request-1', userMessage: { ...aiPaneMessage, id: 'user-1', role: 'user' as const }, assistantMessage: aiPaneMessage } })),
      startDatabaseAiPaneResponse: vi.fn(async () => ({ ok: true, data: { assistantMessage: { ...aiPaneMessage, status: 'streaming' as const } } })),
      cancelDatabaseAiPaneResponse: vi.fn(async () => ({ ok: true, data: { assistantMessage: { ...aiPaneMessage, status: 'cancelled' as const } } })),
      generateDatabaseAiPaneResponse: vi.fn(async () => ({ ok: true, data: { requestId: 'pane-request-1', assistantMessage: aiPaneMessage, text: aiPaneMessage.content, provider: 'aiopsterm-local' as const, durationMs: 16 } })),
      createDatabaseAiDrawerRequest: vi.fn(async () => ({ ok: true, data: aiDrawerRequest })),
      startDatabaseAiDrawerResponse: vi.fn(async () => ({ ok: true, data: { ...aiDrawerRequest, status: 'streaming' as const } })),
      cancelDatabaseAiDrawerResponse: vi.fn(async () => ({ ok: true, data: { ...aiDrawerRequest, status: 'cancelled' as const } })),
      generateDatabaseAiDrawerResponse: vi.fn(async () => ({ ok: true, data: { request: aiDrawerRequest, text: 'Explanation', reasoning: 'reason', sql: 'select 1', provider: 'aiopsterm-local' as const, durationMs: 18 } })),
      diagnoseDatabaseSqlError: vi.fn(async () => ({ ok: true, data: { request: { ...aiDrawerRequest, action: 'diagnose' as const }, text: 'Fix SQL', reasoning: 'reason', sql: 'select 1', provider: 'aiopsterm-local' as const, durationMs: 18 } }))
    }

    await expect(databaseClient.listDatabaseCatalog()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.testDatabaseConnection()?.({ dbType: 'postgresql', name: 'Production' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.saveDatabaseConnection()?.({ mode: 'create', connection: { dbType: 'postgresql', name: 'Production' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.createDatabaseGroup()?.({ name: 'Default' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.renameDatabaseGroup()?.({ id: 'group-1', name: 'Renamed' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.moveDatabaseGroup()?.({ id: 'group-1', parentId: null })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.deleteDatabaseGroup()?.('group-1')).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.moveDatabaseConnection()?.({ connectionId: connection.id, groupId: 'group-1' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.removeDatabaseConnection()?.(connection.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.connectDatabaseConnection()?.(connection.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.disconnectDatabaseConnection()?.(connection.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.refreshDatabaseConnection()?.(connection.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.createDatabaseCatalog()?.({ connectionId: connection.id, sql: 'create database reporting', requestedName: 'reporting' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.executeDatabaseSql()?.({ connectionId: connection.id, sql: 'select 1' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.getDatabaseTableDdl()?.({ connectionId: connection.id, databaseName: 'app', tableName: 'orders' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.queryDatabaseTable()?.({ connectionId: connection.id, databaseName: 'app', tableName: 'orders', page: 1, pageSize: 100 })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.planDatabaseTableMutation()?.({ connectionId: connection.id, databaseName: 'app', tableName: 'orders', mutations: [] })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.mutateDatabaseTable()?.({ connectionId: connection.id, databaseName: 'app', tableName: 'orders', mutations: [{ kind: 'insert', values: { id: 1 } }] })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.exportDatabaseRows()?.({ title: 'orders', kind: 'table-page', columns: ['id'], rows: [{ id: 1 }] })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.getDatabasePageComment()?.({ scope: 'table-page', connectionId: connection.id, databaseName: 'app', tableName: 'orders' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.saveDatabasePageComment()?.({ key: { scope: 'table-page', connectionId: connection.id, databaseName: 'app', tableName: 'orders' }, comment: 'hot table' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.getDatabaseAiPaneState()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.saveDatabaseAiPaneState()?.({ open: true, width: 420, context: { connectionId: connection.id, catalogName: 'app', schemaName: 'public', dbType: 'postgresql' }, draft: '', messages: [] })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.createDatabaseAiPaneRequest()?.({ prompt: 'Explain schema', context: { connectionId: connection.id, databaseName: 'app' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.startDatabaseAiPaneResponse()?.({ requestId: 'pane-request-1', assistantMessageId: aiPaneMessage.id })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.cancelDatabaseAiPaneResponse()?.({ requestId: 'pane-request-1', assistantMessageId: aiPaneMessage.id })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.generateDatabaseAiPaneResponse()?.({ requestId: 'pane-request-1', assistantMessageId: aiPaneMessage.id, prompt: 'Explain schema', context: { connectionId: connection.id, databaseName: 'app' } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.createDatabaseAiDrawerRequest()?.({ action: 'explain', sourceSql: 'select 1', context: { connectionId: connection.id } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.startDatabaseAiDrawerResponse()?.({ requestId: aiDrawerRequest.id })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.cancelDatabaseAiDrawerResponse()?.({ requestId: aiDrawerRequest.id })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.generateDatabaseAiDrawerResponse()?.({ requestId: aiDrawerRequest.id, action: 'explain', sourceSql: 'select 1', context: { connectionId: connection.id } })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(databaseClient.diagnoseDatabaseSqlError()?.({ requestId: 'diagnose-1', sourceSql: 'select * from', context: { connectionId: connection.id }, errorMessage: 'syntax error' })).resolves.toEqual(expect.objectContaining({ ok: true }))

    expect(window.aiops.listDatabaseCatalog).toHaveBeenCalledTimes(1)
    expect(window.aiops.testDatabaseConnection).toHaveBeenCalledWith({ dbType: 'postgresql', name: 'Production' })
    expect(window.aiops.saveDatabaseConnection).toHaveBeenCalledWith({ mode: 'create', connection: { dbType: 'postgresql', name: 'Production' } })
    expect(window.aiops.deleteDatabaseGroup).toHaveBeenCalledWith('group-1')
    expect(window.aiops.connectDatabaseConnection).toHaveBeenCalledWith(connection.id)
    expect(window.aiops.exportDatabaseRows).toHaveBeenCalledWith({ title: 'orders', kind: 'table-page', columns: ['id'], rows: [{ id: 1 }] })

    window.aiops = {
      ...originalAiops,
      listDatabaseCatalog: undefined as any,
      testDatabaseConnection: undefined as any,
      saveDatabaseConnection: undefined as any,
      createDatabaseGroup: undefined as any,
      renameDatabaseGroup: undefined as any,
      moveDatabaseGroup: undefined as any,
      deleteDatabaseGroup: undefined as any,
      moveDatabaseConnection: undefined as any,
      removeDatabaseConnection: undefined as any,
      connectDatabaseConnection: undefined as any,
      disconnectDatabaseConnection: undefined as any,
      refreshDatabaseConnection: undefined as any,
      createDatabaseCatalog: undefined as any,
      executeDatabaseSql: undefined as any,
      getDatabaseTableDdl: undefined as any,
      queryDatabaseTable: undefined as any,
      planDatabaseTableMutation: undefined as any,
      mutateDatabaseTable: undefined as any,
      exportDatabaseRows: undefined as any,
      getDatabasePageComment: undefined as any,
      saveDatabasePageComment: undefined as any,
      getDatabaseAiPaneState: undefined as any,
      saveDatabaseAiPaneState: undefined as any,
      createDatabaseAiPaneRequest: undefined as any,
      startDatabaseAiPaneResponse: undefined as any,
      cancelDatabaseAiPaneResponse: undefined as any,
      generateDatabaseAiPaneResponse: undefined as any,
      createDatabaseAiDrawerRequest: undefined as any,
      startDatabaseAiDrawerResponse: undefined as any,
      cancelDatabaseAiDrawerResponse: undefined as any,
      generateDatabaseAiDrawerResponse: undefined as any,
      diagnoseDatabaseSqlError: undefined as any
    }
    expect(databaseClient.listDatabaseCatalog()).toBeUndefined()
    expect(databaseClient.testDatabaseConnection()).toBeUndefined()
    expect(databaseClient.saveDatabaseConnection()).toBeUndefined()
    expect(databaseClient.createDatabaseGroup()).toBeUndefined()
    expect(databaseClient.renameDatabaseGroup()).toBeUndefined()
    expect(databaseClient.moveDatabaseGroup()).toBeUndefined()
    expect(databaseClient.deleteDatabaseGroup()).toBeUndefined()
    expect(databaseClient.moveDatabaseConnection()).toBeUndefined()
    expect(databaseClient.removeDatabaseConnection()).toBeUndefined()
    expect(databaseClient.connectDatabaseConnection()).toBeUndefined()
    expect(databaseClient.disconnectDatabaseConnection()).toBeUndefined()
    expect(databaseClient.refreshDatabaseConnection()).toBeUndefined()
    expect(databaseClient.createDatabaseCatalog()).toBeUndefined()
    expect(databaseClient.executeDatabaseSql()).toBeUndefined()
    expect(databaseClient.getDatabaseTableDdl()).toBeUndefined()
    expect(databaseClient.queryDatabaseTable()).toBeUndefined()
    expect(databaseClient.planDatabaseTableMutation()).toBeUndefined()
    expect(databaseClient.mutateDatabaseTable()).toBeUndefined()
    expect(databaseClient.exportDatabaseRows()).toBeUndefined()
    expect(databaseClient.getDatabasePageComment()).toBeUndefined()
    expect(databaseClient.saveDatabasePageComment()).toBeUndefined()
    expect(databaseClient.getDatabaseAiPaneState()).toBeUndefined()
    expect(databaseClient.saveDatabaseAiPaneState()).toBeUndefined()
    expect(databaseClient.createDatabaseAiPaneRequest()).toBeUndefined()
    expect(databaseClient.startDatabaseAiPaneResponse()).toBeUndefined()
    expect(databaseClient.cancelDatabaseAiPaneResponse()).toBeUndefined()
    expect(databaseClient.generateDatabaseAiPaneResponse()).toBeUndefined()
    expect(databaseClient.createDatabaseAiDrawerRequest()).toBeUndefined()
    expect(databaseClient.startDatabaseAiDrawerResponse()).toBeUndefined()
    expect(databaseClient.cancelDatabaseAiDrawerResponse()).toBeUndefined()
    expect(databaseClient.generateDatabaseAiDrawerResponse()).toBeUndefined()
    expect(databaseClient.diagnoseDatabaseSqlError()).toBeUndefined()
  })
})
