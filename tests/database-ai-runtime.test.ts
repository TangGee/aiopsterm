import { describe, expect, it } from 'vitest'
import {
  applyDbAiPaneStateSnapshot,
  canRunDbAiReadOnly,
  clampDbAiPaneWidth,
  currentDbAiPaneStateSnapshot,
  dbAiBackendContext,
  dbAiBackendContextForIpc,
  dbAiCanCancel,
  dbAiContentText,
  dbAiContextParts,
  dbAiDrawerCreateInput,
  dbAiPaneCanSend,
  dbAiPaneContextSummary,
  dbAiPaneIsStreaming,
  dbAiPaneRequestInput,
  dbAiPaneStatusLabel,
  dbAiQuickPromptText,
  dbAiReasoningText,
  dbAiRequestList,
  dbAiSql,
  dbAiStatusLabel,
  formatDbAiRequestTime,
  isDbAiExecutableDialect,
  normalizeDbAiPaneContext,
  normalizeDbAiTargetDialect,
  patchDbAiRequestRecord,
  planDbAiInsertSql,
  planDbAiReplaceSql,
  removeDbAiRequestRecord
} from '@/services/database/databaseAiRuntime'
import type { DbAiPaneMessage, DbAiRequest } from '@/services/database/databaseBackendGuards'
import type { DatabaseConnectionInfo } from '@shared/contracts/database'

const postgresConnection: DatabaseConnectionInfo = {
  id: 'conn-pg',
  name: 'Orders PG',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: [{ name: 'orders', schemas: [{ name: 'public', tables: [], views: [] }, { name: 'audit', tables: [], views: [] }] }]
}

const mysqlConnection: DatabaseConnectionInfo = {
  ...postgresConnection,
  id: 'conn-mysql',
  name: 'Metrics MySQL',
  dbType: 'mysql',
  database: 'metrics',
  catalogs: [{ name: 'metrics', schemas: [] }]
}

const sqlTab = {
  id: 'tab-sql-1',
  kind: 'sql' as const,
  title: 'Orders Query',
  connectionId: 'conn-pg',
  catalogName: 'orders',
  schemaName: 'public',
  tableName: 'orders',
  sql: 'select * from orders',
  savedSql: 'select * from orders',
  saving: false,
  saveError: null,
  resultTabs: [],
  activeResultTabId: 'overview',
  history: []
}

const request = (overrides: Partial<DbAiRequest> = {}): DbAiRequest => ({
  id: 'req-1',
  action: 'optimize',
  label: 'Optimize',
  status: 'done',
  contextSummary: 'Orders PG · postgresql · orders · public',
  sourceSql: 'select * from orders',
  text: 'Reasoning\nUse index.\n```sql\nselect id from orders;\n```',
  targetDialect: 'postgresql',
  backendContext: { connectionId: 'conn-pg', dbType: 'postgresql', databaseName: 'orders', schemaName: 'public', tableName: 'orders' },
  createdAt: 20,
  updatedAt: 30,
  ...overrides
})

const message = (overrides: Partial<DbAiPaneMessage> = {}): DbAiPaneMessage => ({
  id: 'msg-1',
  requestId: 'pane-1',
  role: 'assistant',
  status: 'streaming',
  content: 'working',
  contextSummary: 'Orders PG',
  createdAt: 10,
  updatedAt: 20,
  ...overrides
})

describe('databaseAiRuntime', () => {
  it('normalizes DB AI pane context, labels, width, snapshot, and pane request inputs', () => {
    expect(normalizeDbAiPaneContext({ connectionId: 'conn-pg', catalogName: 'orders', schemaName: 'missing' }, [postgresConnection, mysqlConnection])).toEqual({
      connectionId: 'conn-pg',
      catalogName: 'orders',
      schemaName: 'public',
      dbType: 'postgresql'
    })
    expect(normalizeDbAiPaneContext({ connectionId: 'missing' }, [postgresConnection, mysqlConnection]).connectionId).toBe('conn-pg')
    expect(dbAiPaneContextSummary(postgresConnection, { connectionId: 'conn-pg', catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' })).toBe('Orders PG · postgresql · orders · public')
    expect(dbAiPaneCanSend(' explain ', { connectionId: 'conn-pg', catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' }, false)).toBe(true)
    expect(dbAiPaneIsStreaming([message()])).toBe(true)
    expect(dbAiPaneStatusLabel('cancelled')).toBe('Cancelled')
    expect(clampDbAiPaneWidth(900)).toBe(720)
    expect(clampDbAiPaneWidth(Number.NaN)).toBe(360)

    const snapshot = currentDbAiPaneStateSnapshot({
      open: true,
      width: 800,
      context: { connectionId: 'conn-pg', catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' },
      draft: 'draft',
      messages: Array.from({ length: 25 }, (_, index) => message({ id: `msg-${index}`, content: `${index}`, status: 'done' }))
    })
    expect(snapshot.messages).toHaveLength(24)
    const applied = applyDbAiPaneStateSnapshot(snapshot, (context) => normalizeDbAiPaneContext(context, [postgresConnection]))
    expect(applied).toEqual(expect.objectContaining({ open: true, width: 720, draft: 'draft', context: expect.objectContaining({ schemaName: 'public' }) }))

    expect(dbAiPaneRequestInput({
      prompt: 'Summarize',
      context: { connectionId: 'conn-pg', catalogName: 'orders', schemaName: 'public', dbType: 'postgresql' },
      contextSummary: 'Orders PG',
      activeSql: 'select 1',
      messages: [message({ role: 'user', content: 'older' }), message({ content: 'newer' })]
    })).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({ connectionId: 'conn-pg', databaseName: 'orders', contextSummary: 'Orders PG' }),
        messages: [
          { role: 'user', content: 'older' },
          { role: 'assistant', content: 'newer' }
        ]
      })
    )
  })

  it('derives drawer SQL, status, dialect behavior, request mutation, and backend payloads', () => {
    const done = request()
    expect(dbAiSql(done)).toBe('select id from orders;')
    expect(dbAiReasoningText(done.text)).toBe('Use index.')
    expect(dbAiContentText({ action: 'convert', text: done.text, sql: dbAiSql(done), targetDialect: 'mysql' })).toBe('Generated MySQL SQL preview.')
    expect(dbAiStatusLabel('streaming')).toBe('Streaming')
    expect(dbAiCanCancel('queued')).toBe(true)
    expect(normalizeDbAiTargetDialect('sqlserver')).toBe('mssql')
    expect(normalizeDbAiTargetDialect('kingbase')).toBe('postgresql')
    expect(isDbAiExecutableDialect('convert', 'postgresql', postgresConnection)).toBe(true)
    expect(isDbAiExecutableDialect('convert', 'mysql', postgresConnection)).toBe(false)
    expect(canRunDbAiReadOnly({ activeSqlCanRun: true, action: 'optimize', targetDialect: 'postgresql', connection: postgresConnection, sql: 'select 1' })).toBe(true)
    expect(canRunDbAiReadOnly({ activeSqlCanRun: true, action: 'optimize', targetDialect: 'postgresql', connection: postgresConnection, sql: 'delete from orders' })).toBe(false)

    const requests = {
      'req-1': request({ id: 'req-1', createdAt: 10 }),
      'req-2': request({ id: 'req-2', createdAt: 20 })
    }
    expect(dbAiRequestList(requests).map((item) => item.id)).toEqual(['req-2', 'req-1'])
    expect(patchDbAiRequestRecord(requests, 'req-1', { status: 'streaming' })['req-1'].status).toBe('streaming')
    expect(removeDbAiRequestRecord(requests, 'req-2')).toEqual(expect.objectContaining({ activeReqId: 'req-1', open: true }))

    const context = dbAiBackendContext({ tab: sqlTab, connection: postgresConnection, contextSummary: 'summary' })
    expect(dbAiContextParts(sqlTab, postgresConnection)).toEqual(['Orders PG', 'postgresql', 'orders', 'public'])
    expect(dbAiBackendContextForIpc(context)).toEqual(expect.objectContaining({ connectionId: 'conn-pg', dbType: 'postgresql', databaseName: 'orders', contextSummary: 'summary' }))
    expect(dbAiDrawerCreateInput({ action: 'explain', sourceSql: 'select 1', targetDialect: 'postgresql', context })).toEqual(
      expect.objectContaining({ action: 'explain', sourceSql: 'select 1', targetDialect: 'postgresql', context: expect.objectContaining({ connectionId: 'conn-pg' }) })
    )
  })

  it('plans editor SQL edits, quick prompts, and request time labels', () => {
    expect(planDbAiInsertSql('select 1', { start: 8, end: 8 }, 'select 2')).toEqual({
      nextSql: 'select 1\nselect 2',
      selectionStart: 17,
      notice: 'Generated SQL inserted'
    })
    expect(planDbAiInsertSql('select 1', { start: 0, end: 8 }, 'select 2').notice).toBe('Editor selection replaced')
    expect(planDbAiReplaceSql('select 1; select 2;', { start: 10, end: 18 }, 'select 3', false)).toEqual({
      nextSql: 'select 1; select 3;',
      selectionStart: 10,
      selectionEnd: 18,
      notice: 'Current statement replaced'
    })
    expect(dbAiQuickPromptText('schemaSummary')).toBe('Summarize the current database schema and list useful query entry points.')
    expect(dbAiQuickPromptText('explainActive', 'select 1')).toContain('select 1')
    expect(formatDbAiRequestTime(new Date('2026-06-22T01:02:03Z').getTime())).toMatch(/01:02:03|09:02:03/)
  })
})
