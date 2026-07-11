import { describe, expect, it } from 'vitest'
import type { DatabaseConnectionInfo } from '../src/shared/contracts/database'
import { clickHouseQueryTable, configureDatabaseHttpEngines } from '../src/shared/databaseHttpEngines'

const connection: DatabaseConnectionInfo = {
  id: 'conn-clickhouse-guard',
  name: 'clickhouse-guard',
  dbType: 'clickhouse',
  env: 'Development',
  groupId: 'group-local',
  host: 'clickhouse.local',
  port: 8123,
  authentication: 'UserAndPassword',
  user: 'default',
  database: 'ops',
  status: 'connected',
  catalogs: []
}

const response = (data: Array<Record<string, unknown>>) =>
  new Response(
    JSON.stringify({
      meta: Object.keys(data[0] ?? {}).map((name) => ({ name, type: 'String' })),
      data,
      rows: data.length
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )

describe('ClickHouse stable base-table guard', () => {
  it('fails strict reads closed without a data SELECT while preserving ordinary table pages', async () => {
    const statements: string[] = []
    let engine = 'MergeTree'
    configureDatabaseHttpEngines({
      fetch: async (_url, init) => {
        const sql = String(init?.body ?? '')
        statements.push(sql)
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
        if (normalized.includes('from system.tables')) return response([{ engine }])
        if (normalized.includes('from system.columns')) {
          return response([{ name: 'event_id', type: 'UInt64', is_in_primary_key: 1 }])
        }
        if (normalized.startsWith('select `event_id` from `ops`.`events`')) return response([{ event_id: 42 }])
        throw new Error(`unexpected ClickHouse query: ${sql}`)
      },
      connectionInputFromSaved: (saved) => ({
        dbType: saved.dbType,
        name: saved.name,
        host: saved.host,
        port: saved.port,
        user: saved.user,
        password: 'secret',
        database: saved.database
      }),
      refreshConnectionCatalog: async () => undefined,
      workspaceCatalogFor: () => undefined
    })

    const strictInput = {
      connectionId: connection.id,
      dbType: 'clickhouse' as const,
      databaseName: 'ops',
      tableName: 'events',
      page: 1,
      pageSize: 20,
      withTotal: false,
      requireStableBaseTable: true
    }
    const strictBaseTable = await clickHouseQueryTable(connection, strictInput, Date.now())
    expect(strictBaseTable).toMatchObject({ ok: false, errorCode: 'DB_TABLE_QUERY_UNSUPPORTED' })
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('FROM system.tables')
    expect(statements.some((sql) => /from\s+`ops`\.`events`/i.test(sql))).toBe(false)

    engine = 'MaterializedView'
    const strictView = await clickHouseQueryTable(connection, strictInput, Date.now())
    expect(strictView).toMatchObject({
      ok: false,
      errorCode: 'DB_TABLE_QUERY_UNSUPPORTED',
      errorMessage: 'Stable database reads are limited to base tables.'
    })
    expect(statements.some((sql) => /from\s+`ops`\.`events`/i.test(sql))).toBe(false)

    statements.length = 0
    const ordinary = await clickHouseQueryTable(
      connection,
      { ...strictInput, requireStableBaseTable: false },
      Date.now()
    )
    expect(ordinary).toMatchObject({ ok: true, data: { columns: ['event_id'], rows: [{ event_id: 42 }] } })
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('FROM system.columns')
    expect(statements[1]).toContain('FROM `ops`.`events`')
  })
})
