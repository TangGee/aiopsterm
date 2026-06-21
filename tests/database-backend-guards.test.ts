import { describe, expect, it } from 'vitest'
import {
  isConnectableDatabaseEngineInfo,
  isDatabaseConnectionDeleteDataForRequest,
  isDatabaseConnectionMutationDataForRequest,
  isDatabaseConnectionSaveDataForRequest,
  isDatabaseConnectionTestData,
  isDatabaseCreateDatabaseDataForRequest,
  isDatabaseExportData,
  isDatabaseGroupDeleteDataForRequest,
  isDatabaseGroupMutationDataForRequest,
  isDatabasePageCommentGetData,
  isDatabasePageCommentSaveData,
  isDatabaseSqlExecuteData,
  isDatabaseTableMutationData,
  isDatabaseTableMutationPlanData,
  isDatabaseTableQueryData,
  isDatabaseWorkspaceCatalog,
  isDbAiDrawerRequestRecord,
  isDbAiDrawerResponseData,
  isDbAiPaneLifecycleData,
  isDbAiPaneRequestData,
  isDbAiPaneResponseData,
  isDbAiPaneStateSnapshot,
  isLocalFileWriteData
} from '@/services/databaseBackendGuards'
import type {
  DatabaseAiDrawerRequestRecord,
  DatabaseAiPaneMessageRecord,
  DatabaseConnectionInfo,
  DatabaseConnectionSaveInput,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const connection: DatabaseConnectionInfo = {
  id: 'conn-main',
  name: 'orders-postgres',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-prod',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'readonly',
  hasPassword: true,
  database: 'orders',
  sslMode: 'require',
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
  engines: [{ code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' }],
  groups: [{ id: 'group-prod', name: 'Production' }],
  groupParents: { 'group-prod': null },
  connections: [connection],
  defaults: {
    selectedNodeId: connection.id,
    expandedGroupIds: ['group-prod'],
    expandedConnectionIds: [connection.id],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
}

const aiMessage: DatabaseAiPaneMessageRecord = {
  id: 'assistant-1',
  requestId: 'pane-request-1',
  role: 'assistant',
  status: 'done',
  content: 'Use the orders primary key.',
  contextSummary: 'orders / public',
  createdAt: 1781884800000,
  updatedAt: 1781884801000
}

const aiRequest: DatabaseAiDrawerRequestRecord = {
  id: 'drawer-request-1',
  action: 'explain',
  label: 'Explain',
  status: 'done',
  contextSummary: 'orders / public',
  sourceSql: 'select * from orders',
  text: 'Explanation',
  targetDialect: 'postgresql',
  backendContext: { connectionId: connection.id, dbType: 'postgresql', databaseName: 'orders', schemaName: 'public' },
  createdAt: 1781884800000,
  updatedAt: 1781884801000
}

describe('databaseBackendGuards', () => {
  it('validates workspace catalog envelopes and connectable engines', () => {
    expect(isDatabaseWorkspaceCatalog(catalog)).toBe(true)
    expect(isDatabaseWorkspaceCatalog({ ...catalog, groupParents: { 'group-prod': 1 } })).toBe(false)
    expect(isConnectableDatabaseEngineInfo(catalog.engines[0])).toBe(true)
    expect(isConnectableDatabaseEngineInfo({ ...catalog.engines[0], enabled: false })).toBe(false)
  })

  it('matches connection, group, and catalog mutation results to their request inputs', () => {
    const saveInput: DatabaseConnectionSaveInput = {
      mode: 'edit',
      id: connection.id,
      connection: {
        dbType: 'postgresql',
        name: ' orders-postgres ',
        env: 'Production',
        groupId: 'group-prod',
        authentication: 'UserAndPassword',
        user: ' readonly ',
        readonly: false,
        sslMode: 'require',
        needProxy: false
      }
    }

    expect(isDatabaseConnectionSaveDataForRequest({ ...catalog, connection, message: 'saved' }, saveInput)).toBe(true)
    expect(isDatabaseConnectionSaveDataForRequest({ ...catalog, connection: { ...connection, id: 'other' }, message: 'saved' }, saveInput)).toBe(false)
    expect(isDatabaseGroupMutationDataForRequest({ ...catalog, group: catalog.groups[0], message: 'renamed' }, { id: 'group-prod', parentId: null, name: 'Production' })).toBe(true)
    expect(isDatabaseGroupDeleteDataForRequest({ ...catalog, groups: [], deletedGroupId: 'group-prod', message: 'deleted' }, 'group-prod')).toBe(true)
    expect(isDatabaseConnectionMutationDataForRequest({ ...catalog, connection, message: 'connected' }, { connectionId: connection.id, status: 'connected' })).toBe(true)
    expect(isDatabaseConnectionDeleteDataForRequest({ ...catalog, connections: [], connectionId: connection.id, message: 'removed' }, connection.id)).toBe(true)
    expect(isDatabaseCreateDatabaseDataForRequest({ ...catalog, connection, catalog: connection.catalogs[0], message: 'created' }, connection.id, 'orders')).toBe(true)
  })

  it('validates SQL, table mutation, export, comments, and local file results', () => {
    const execution = { id: 'exec-1', status: 'ok' as const, message: '1 row', durationMs: 8, rowCount: 1, createdAt: '2026-06-21T00:00:00.000Z' }

    expect(isDatabaseConnectionTestData({ dbType: 'postgresql', serverVersion: '16', endpoint: '127.0.0.1:5432', durationMs: 12 })).toBe(true)
    expect(isDatabaseSqlExecuteData({ columns: ['id'], rows: [{ id: 1 }], rowCount: 1, durationMs: 8, execution })).toBe(true)
    expect(isDatabaseTableQueryData({ columns: ['id'], rows: [{ id: 1 }], rowCount: 1, durationMs: 8, total: null, knownColumns: ['id'] })).toBe(true)
    expect(isDatabaseTableMutationPlanData({ statements: [{ kind: 'update', sql: 'update orders set id = ?', params: [1], preview: 'update' }], statementCount: 1, preview: 'update', warning: '' })).toBe(true)
    expect(isDatabaseTableMutationData({ affected: 1, durationMs: 9, catalog }, { requireCatalog: true })).toBe(true)
    expect(isDatabaseExportData({ exported: 1, fileName: 'orders.csv', filePath: '/tmp/orders.csv', bytes: 8, csv: 'id\n1\n' })).toBe(false)
    expect(isDatabaseExportData({ exported: 1, fileName: 'orders.csv', filePath: '/tmp/orders.csv', bytes: 5, csv: 'id\n1\n' })).toBe(true)
    expect(isLocalFileWriteData({ filePath: '/tmp/query.sql', bytes: 9, size: 9, mtimeMs: 1781884800000 }, '/tmp/query.sql', 'select 1;')).toBe(true)

    const key = { scope: 'table-page' as const, connectionId: connection.id, databaseName: 'orders', schemaName: 'public', tableName: 'orders' }
    const record = { ...key, comment: 'Review slow rows', updatedAt: 1781884800000 }
    expect(isDatabasePageCommentGetData({ record }, key)).toBe(true)
    expect(isDatabasePageCommentSaveData({ record, message: 'Comment saved' }, key)).toBe(true)
    expect(isDatabasePageCommentGetData({ record: { ...record, tableName: 'other' } }, key)).toBe(false)
  })

  it('validates DB AI pane and drawer payload contracts', () => {
    const userMessage = { ...aiMessage, id: 'user-1', role: 'user' as const, content: 'Explain this SQL' }

    expect(isDbAiPaneStateSnapshot({ open: true, width: 420, context: { connectionId: connection.id, catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' }, draft: '', messages: [aiMessage] })).toBe(true)
    expect(isDbAiPaneRequestData({ requestId: aiMessage.requestId, userMessage, assistantMessage: aiMessage })).toBe(true)
    expect(isDbAiPaneLifecycleData({ assistantMessage: aiMessage }, { requestId: aiMessage.requestId, assistantMessageId: aiMessage.id })).toBe(true)
    expect(isDbAiPaneResponseData({ requestId: aiMessage.requestId, assistantMessage: aiMessage, text: aiMessage.content, provider: 'aiopsterm-local', durationMs: 16 }, { requestId: aiMessage.requestId, assistantMessageId: aiMessage.id })).toBe(true)

    expect(isDbAiDrawerRequestRecord(aiRequest, aiRequest.id)).toBe(true)
    expect(isDbAiDrawerRequestRecord({ ...aiRequest, targetDialect: 'sqlserver' })).toBe(false)
    expect(isDbAiDrawerResponseData({ request: aiRequest, text: 'Explanation', reasoning: 'Because', sql: 'select * from orders', provider: 'aiopsterm-local', durationMs: 18 }, aiRequest.id)).toBe(true)
  })
})
