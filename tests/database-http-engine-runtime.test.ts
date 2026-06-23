import { describe, expect, it } from 'vitest'
import type {
  DatabaseConnectionInfo,
  DatabaseConnectionTestInput,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'
import {
  clickHouseBaseUrlFrom,
  clickHouseExecute,
  clickHouseMutationPlanData,
  clickHouseQueryJson,
  configureDatabaseHttpEngines,
  isClickHouseConnection,
  isPrestoConnection,
  prestoBaseUrlFrom,
  prestoExecute,
  prestoMutationUnsupported,
  prestoQuery
} from '@shared/databaseHttpEngines'

type RequestRecord = {
  url: string
  method: string
  body: string
  authorization?: string
  contentType?: string
  prestoUser?: string
  prestoCatalog?: string
  prestoSchema?: string
}

const emptyWorkspaceCatalog = (): DatabaseWorkspaceCatalog => ({
  engines: [],
  groups: [],
  groupParents: {},
  connections: [],
  defaults: {
    selectedNodeId: null,
    expandedGroupIds: [],
    expandedConnectionIds: [],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  }
})

const requestRecord = (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): RequestRecord => {
  const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers as HeadersInit)
  return {
    url: String(url),
    method: String(init?.method || 'GET'),
    body: String(init?.body ?? ''),
    authorization: headers.get('Authorization') || undefined,
    contentType: headers.get('Content-Type') || undefined,
    prestoUser: headers.get('X-Presto-User') || undefined,
    prestoCatalog: headers.get('X-Presto-Catalog') || undefined,
    prestoSchema: headers.get('X-Presto-Schema') || undefined
  }
}

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const configureHttpRuntime = (fetchImpl: typeof fetch, inputOverrides: Partial<DatabaseConnectionTestInput> = {}) => {
  const refreshes: string[] = []
  const workspaceCatalog = emptyWorkspaceCatalog()
  configureDatabaseHttpEngines({
    fetch: fetchImpl,
    connectionInputFromSaved: (connection) => ({
      dbType: connection.dbType,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: 'pw',
      database: connection.database,
      filePath: connection.filePath,
      readonly: connection.readonly,
      sslMode: connection.sslMode,
      needProxy: connection.needProxy,
      proxyName: connection.proxyName,
      url: connection.url,
      ...inputOverrides
    }),
    refreshConnectionCatalog: async (connectionId) => {
      refreshes.push(connectionId)
    },
    workspaceCatalogFor: () => workspaceCatalog
  })
  return { refreshes, workspaceCatalog }
}

const clickHouseConnection = (): DatabaseConnectionInfo => ({
  id: 'conn-clickhouse',
  name: 'runtime-clickhouse',
  dbType: 'clickhouse',
  env: 'Production',
  groupId: 'group-prod',
  host: 'clickhouse.local',
  port: null,
  authentication: 'UserAndPassword',
  user: 'default',
  database: 'ops',
  status: 'connected',
  catalogs: []
})

const prestoConnection = (): DatabaseConnectionInfo => ({
  id: 'conn-presto',
  name: 'runtime-presto',
  dbType: 'presto',
  env: 'Production',
  groupId: 'group-prod',
  host: 'presto.local',
  port: null,
  authentication: 'UserAndPassword',
  user: 'ops',
  database: 'hive',
  status: 'connected',
  catalogs: []
})

describe('database HTTP engine runtimes', () => {
  it('keeps the compatibility facade stable while normalizing HTTP endpoints', () => {
    expect(clickHouseBaseUrlFrom({ host: ' clickhouse.local ', port: null, url: '' })).toBe('http://clickhouse.local:8123')
    expect(clickHouseBaseUrlFrom({ host: 'ignored', port: 9000, url: 'https://clickhouse.example:9440/root///' })).toBe(
      'https://clickhouse.example:9440/root'
    )
    expect(prestoBaseUrlFrom({ host: ' presto.local ', port: null, url: '' })).toBe('http://presto.local:8080')
    expect(prestoBaseUrlFrom({ host: 'ignored', port: 8181, url: 'http://presto.example:7777/v1///' })).toBe(
      'http://presto.example:7777/v1'
    )
    expect(isClickHouseConnection(clickHouseConnection())).toBe(true)
    expect(isPrestoConnection(prestoConnection())).toBe(true)
  })

  it('executes ClickHouse JSON queries with runtime fetch injection, database selection, and auth headers', async () => {
    const requests: RequestRecord[] = []
    const fetchDouble: typeof fetch = async (url, init) => {
      requests.push(requestRecord(url, init))
      return jsonResponse({
        meta: [
          { name: 'event_id', type: 'UInt64' },
          { name: 'service', type: 'String' }
        ],
        data: [{ event_id: 42, service: 'api' }],
        rows: 1
      })
    }
    configureHttpRuntime(fetchDouble)

    const result = await clickHouseQueryJson<{ event_id: number; service: string }>(
      {
        dbType: 'clickhouse',
        name: 'runtime-clickhouse',
        host: 'clickhouse.local',
        port: null,
        user: 'default',
        password: 'pw',
        database: 'ops'
      },
      'SELECT event_id, service FROM events;',
      'ops'
    )

    expect(result).toMatchObject({
      columns: ['event_id', 'service'],
      rows: [{ event_id: 42, service: 'api' }]
    })
    expect(requests).toEqual([
      expect.objectContaining({
        url: 'http://clickhouse.local:8123/?database=ops',
        method: 'POST',
        body: 'SELECT event_id, service FROM events FORMAT JSON',
        contentType: 'text/plain; charset=utf-8',
        authorization: `Basic ${Buffer.from('default:pw').toString('base64')}`
      })
    ])
  })

  it('keeps ClickHouse non-query execution and JSON parse failures in the ClickHouse runtime', async () => {
    const nonQueryRequests: RequestRecord[] = []
    configureHttpRuntime(async (url, init) => {
      nonQueryRequests.push(requestRecord(url, init))
      return new Response('', { status: 200 })
    })

    const execution = await clickHouseExecute(clickHouseConnection(), 'CREATE DATABASE `ops_archive`', Date.now() - 10)
    expect(execution).toMatchObject({
      ok: true,
      data: {
        columns: [],
        rows: [],
        rowCount: 0
      }
    })
    expect(nonQueryRequests[0]).toMatchObject({
      url: 'http://clickhouse.local:8123/?database=ops',
      body: 'CREATE DATABASE `ops_archive`'
    })

    configureHttpRuntime(async () => new Response('not json', { status: 200 }))
    await expect(
      clickHouseQueryJson(
        {
          dbType: 'clickhouse',
          name: 'runtime-clickhouse',
          host: 'clickhouse.local',
          port: 8123,
          user: 'default',
          password: 'pw',
          database: 'ops'
        },
        'SELECT 1'
      )
    ).rejects.toMatchObject({ code: 'DB_CLICKHOUSE_JSON_INVALID' })
  })

  it('builds ClickHouse mutation previews inside the ClickHouse protocol runtime', () => {
    const plan = clickHouseMutationPlanData(
      {
        connectionId: 'conn-clickhouse',
        databaseName: 'ops',
        tableName: 'events',
        mutations: [
          {
            kind: 'update',
            rowKey: JSON.stringify([42]),
            primaryKey: ['event_id'],
            patch: { service: 'api-edited', status: 'triaged' },
            originalRow: { event_id: 42, service: 'api', status: 'open' }
          },
          { kind: 'insert', values: { event_id: 43, service: 'worker', status: 'open', ignored: 'out-of-schema' } },
          {
            kind: 'delete',
            rowKey: JSON.stringify([42]),
            primaryKey: ['event_id'],
            originalRow: { event_id: 42, service: 'api-edited', status: 'triaged' }
          }
        ]
      },
      ['event_id', 'service', 'status']
    )

    expect(plan).toMatchObject({ statementCount: 3, warning: '' })
    if (!plan) throw new Error('Expected ClickHouse mutation plan data.')
    expect(plan.preview).toContain("ALTER TABLE `ops`.`events` UPDATE `service` = 'api-edited', `status` = 'triaged' WHERE `event_id` = 42;")
    expect(plan.preview).toContain("INSERT INTO `ops`.`events` (`event_id`, `service`, `status`) VALUES (43, 'worker', 'open');")
    expect(plan.preview).toContain('ALTER TABLE `ops`.`events` DELETE WHERE `event_id` = 42;')

    const fallbackGuardPlan = clickHouseMutationPlanData(
      {
        connectionId: 'conn-clickhouse',
        databaseName: 'ops',
        tableName: 'events',
        mutations: [
          {
            kind: 'delete',
            rowKey: '',
            primaryKey: [],
            originalRow: { event_id: 42, service: 'api' }
          }
        ]
      },
      ['event_id', 'service']
    )
    if (!fallbackGuardPlan) throw new Error('Expected ClickHouse fallback mutation plan data.')
    expect(fallbackGuardPlan.warning).toContain('No primary key detected')
    expect(fallbackGuardPlan.preview).toContain("DELETE WHERE `event_id` = 42 AND `service` = 'api';")
  })

  it('executes multi-page Presto queries with runtime fetch injection and request headers', async () => {
    const requests: RequestRecord[] = []
    const fetchDouble: typeof fetch = async (url, init) => {
      const request = requestRecord(url, init)
      requests.push(request)
      if (request.method === 'POST') {
        return jsonResponse({
          id: 'query-1',
          columns: [
            { name: 'event_id', type: 'bigint' },
            { name: 'service', type: 'varchar' }
          ],
          data: [[77, 'api']],
          nextUri: 'http://presto.local:8080/v1/statement/query-1/1'
        })
      }
      return jsonResponse({
        id: 'query-1',
        data: [[78, 'worker']]
      })
    }
    configureHttpRuntime(fetchDouble)

    const result = await prestoQuery<{ event_id: number; service: string }>(
      {
        dbType: 'presto',
        name: 'runtime-presto',
        host: 'presto.local',
        port: null,
        user: 'ops',
        password: 'pw',
        database: 'hive'
      },
      'SELECT event_id, service FROM hive.ops.events',
      { databaseName: 'hive', schemaName: 'ops' }
    )

    expect(result).toMatchObject({
      columns: ['event_id', 'service'],
      rows: [
        { event_id: 77, service: 'api' },
        { event_id: 78, service: 'worker' }
      ]
    })
    expect(requests).toEqual([
      expect.objectContaining({
        url: 'http://presto.local:8080/v1/statement',
        method: 'POST',
        body: 'SELECT event_id, service FROM hive.ops.events',
        prestoUser: 'ops',
        prestoCatalog: 'hive',
        prestoSchema: 'ops',
        authorization: `Basic ${Buffer.from('ops:pw').toString('base64')}`
      }),
      expect.objectContaining({
        url: 'http://presto.local:8080/v1/statement/query-1/1',
        method: 'GET',
        prestoUser: 'ops',
        prestoCatalog: 'hive',
        prestoSchema: 'ops',
        authorization: `Basic ${Buffer.from('ops:pw').toString('base64')}`
      })
    ])
  })

  it('maps Presto query errors and keeps mutation rejection in the Presto runtime', async () => {
    configureHttpRuntime(async () =>
      jsonResponse({
        id: 'query-error',
        error: {
          message: 'line 1:8: table not found',
          errorName: 'TABLE_NOT_FOUND'
        }
      })
    )

    const execution = await prestoExecute(prestoConnection(), 'SELECT * FROM missing_table', Date.now() - 10)
    expect(execution).toMatchObject({
      ok: false,
      errorCode: 'DB_PRESTO_QUERY_FAILED',
      errorMessage: 'line 1:8: table not found'
    })
    expect(prestoMutationUnsupported()).toEqual({
      ok: false,
      errorCode: 'DB_PRESTO_MUTATION_UNSUPPORTED',
      errorMessage: 'Presto table editing is not supported by this aiopsterm backend.'
    })
  })
})
