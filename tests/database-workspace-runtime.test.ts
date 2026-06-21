import { describe, expect, it } from 'vitest'
import {
  buildChartSummary,
  buildConnectionUrl,
  buildQualifiedTableReference,
  collectDescendantGroupIds,
  columnNodeId,
  databasePageCommentKeyId,
  defaultSchemaForSqlConnection,
  flattenVisibleGroups,
  formatDdlError,
  groupPathLabel,
  normalizeTableDdlResult,
  parseCreateDatabaseName,
  quoteIdentForDialect,
  renderCreateDatabaseTemplate,
  schemaObjectFolderKey,
  schemaObjectFolders,
  schemaRoutineNodeId,
  sqlConnectionRequiresSchema,
  toggleId
} from '@/services/databaseWorkspaceRuntime'
import type { DatabaseConnectionInfo, DatabaseGroupInfo } from '@shared/contracts/database'

const groups: DatabaseGroupInfo[] = [
  { id: 'root', name: 'Root' },
  { id: 'child', name: 'Child' },
  { id: 'leaf', name: 'Leaf' }
]

const groupParents = { root: null, child: 'root', leaf: 'child' }

const postgresConnection: DatabaseConnectionInfo = {
  id: 'conn-pg',
  name: 'orders-pg',
  dbType: 'postgresql',
  env: 'Production',
  groupId: 'root',
  host: '127.0.0.1',
  port: 5432,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'orders',
  status: 'connected',
  catalogs: [{ name: 'orders', schemas: [{ name: 'public', tables: [], views: [] }] }]
}

describe('databaseWorkspaceRuntime', () => {
  it('builds connection URLs and SQL context defaults per engine', () => {
    expect(buildConnectionUrl({ dbType: 'sqlite', filePath: '/tmp/app.db' })).toBe('sqlite:///tmp/app.db')
    expect(buildConnectionUrl({ dbType: 'postgresql', host: 'db.local', port: 5432, database: 'orders' })).toBe('jdbc:postgresql://db.local:5432/orders')
    expect(buildConnectionUrl({ dbType: 'clickhouse', host: 'click.local', port: 8123, database: 'ignored' })).toBe('http://click.local:8123')
    expect(sqlConnectionRequiresSchema(postgresConnection)).toBe(true)
    expect(defaultSchemaForSqlConnection(postgresConnection, postgresConnection.catalogs[0])).toBe('public')
  })

  it('formats identifiers, qualified table names, and create-database statements', () => {
    expect(quoteIdentForDialect('order`line', 'mysql')).toBe('`order``line`')
    expect(quoteIdentForDialect('order]line', 'sqlserver')).toBe('[order]]line]')
    expect(buildQualifiedTableReference('presto', 'hive', 'ops', 'events')).toBe('"hive"."ops"."events"')
    expect(buildQualifiedTableReference('postgresql', 'orders', 'public', 'orders')).toBe('"public"."orders"')
    expect(renderCreateDatabaseTemplate('reporting', 'postgresql')).toBe('CREATE DATABASE "reporting";')
    expect(parseCreateDatabaseName('CREATE DATABASE IF NOT EXISTS "reporting";')).toBe('reporting')
    expect(parseCreateDatabaseName('select 1')).toBe('')
  })

  it('derives tree ids, folders, and group hierarchy projections', () => {
    expect(toggleId(['a'], 'a')).toEqual([])
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b'])
    expect(columnNodeId('table-1', 'id')).toBe('table-1:column:id')
    expect(schemaObjectFolderKey('conn', 'catalog', 'public', 'tables')).toBe('conn:catalog:public:tables')
    expect(schemaRoutineNodeId('conn', 'catalog', 'public', 'functions', 'age()')).toBe('conn:catalog:public:functions:age()')
    expect(schemaObjectFolders({ tables: [{ id: 'tbl', name: 'orders', columns: [], primaryKey: [] }], functions: ['age()'] }).map((folder) => [folder.kind, folder.count])).toEqual([
      ['tables', 1],
      ['views', 0],
      ['functions', 1],
      ['procedures', 0]
    ])
    expect(flattenVisibleGroups(groups, groupParents).map((group) => [group.id, group.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['leaf', 2]
    ])
    expect(groupPathLabel('leaf', groups, groupParents)).toBe('Root / Child / Leaf')
    expect([...collectDescendantGroupIds('root', groups, groupParents)]).toEqual(['child', 'leaf'])
  })

  it('summarizes charts, normalizes comments, and formats DDL failures', () => {
    const summary = buildChartSummary({
      title: 'Orders',
      scopeLabel: 'page 1',
      columns: ['service', 'count'],
      rows: [
        { service: 'api', count: 2 },
        { service: 'api', count: '3' },
        { service: 'worker', count: 1 }
      ]
    })
    expect(summary).toEqual(expect.objectContaining({ title: 'Orders', categoryColumn: 'service', valueColumn: 'count', rowCount: 3 }))
    expect(summary?.bars.map((bar) => [bar.label, bar.value])).toEqual([
      ['api', 5],
      ['worker', 1]
    ])
    expect(databasePageCommentKeyId({ scope: 'table-page', connectionId: 'conn', databaseName: 'orders', tableName: 'orders' })).toBe('table-page\u001fconn\u001forders\u001f\u001forders\u001f\u001f')
    expect(normalizeTableDdlResult({ ok: true, data: { ddl: 'CREATE TABLE orders(id integer);' } })).toEqual({ ok: true, ddl: 'CREATE TABLE orders(id integer);' })
    expect(normalizeTableDdlResult({ ok: true, data: { ddl: '' } })).toEqual({ ok: false, errorCode: 'other', errorMessage: 'Database DDL backend returned malformed result data.' })
    expect(formatDdlError({ ok: false, errorCode: 'permission', errorMessage: 'denied' })).toBe('DDL permission denied: denied')
  })
})
