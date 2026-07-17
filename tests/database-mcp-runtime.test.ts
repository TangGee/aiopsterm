import { describe, expect, it, vi } from 'vitest'
import type {
  DatabaseCatalogResult,
  DatabaseTableExplainPlanInput,
  DatabaseTableDdlInput,
  DatabaseTableIndexInspectionInput,
  DatabaseTableQueryInput,
  DatabaseWorkspaceCatalog
} from '../src/shared/contracts/database'
import {
  createDatabaseMcpToolRuntime,
  DATABASE_MCP_TOOL_NAMES,
  sanitizeDatabaseMcpDdl,
  sanitizeDatabaseMcpSensitiveText,
  type DatabaseMcpDependencyReadOptions
} from '../src/shared/databaseMcpRuntime'

const catalog: DatabaseWorkspaceCatalog = {
  engines: [],
  groups: [{ id: 'group-prod', name: 'Production' }],
  groupParents: { 'group-prod': null },
  defaults: {
    selectedNodeId: 'db-prod',
    expandedGroupIds: [],
    expandedConnectionIds: [],
    expandedCatalogIds: [],
    expandedSchemaIds: [],
    expandedSchemaObjectFolderIds: []
  },
  connections: [
    {
      id: 'db-prod',
      name: 'private-user@10.20.30.40/private-password',
      dbType: 'postgresql',
      env: 'Production',
      groupId: 'group-prod',
      host: '10.20.30.40',
      port: 5432,
      authentication: 'UserAndPassword',
      user: 'private-user',
      hasPassword: true,
      database: 'orders',
      readonly: false,
      sslMode: 'require',
      needProxy: true,
      proxyName: 'private-proxy',
      url: 'postgresql://private-user:private-password@10.20.30.40/orders',
      status: 'connected',
      catalogs: [
        {
          name: 'orders',
          schemas: [
            {
              name: 'public',
              tables: [
                {
                  id: 'orders-table',
                  name: 'orders',
                  columns: [
                    { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
                    { name: 'status', type: 'varchar(32)', nullable: false },
                    { name: 'note', type: 'text', nullable: true }
                  ],
                  primaryKey: ['id']
                }
              ],
              views: [
                {
                  id: 'open-orders-view',
                  name: 'open_orders',
                  columns: [
                    { name: 'id', type: 'bigint', nullable: false },
                    { name: 'status', type: 'varchar(32)', nullable: false }
                  ],
                  primaryKey: []
                }
              ],
              functions: ['calculate_order_age(order_id bigint)'],
              procedures: ['archive_closed_orders(cutoff timestamp)']
            },
            {
              name: 'archive',
              tables: [
                {
                  id: 'archive-orders-table',
                  name: 'orders',
                  columns: [{ name: 'id', type: 'bigint', nullable: false, key: 'PK' }],
                  primaryKey: ['id']
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'db-idle',
      name: 'idle-mysql',
      dbType: 'mysql',
      env: 'TEST',
      groupId: 'group-prod',
      host: '127.0.0.1',
      port: 3306,
      authentication: 'UserAndPassword',
      user: 'idle-user',
      database: 'idle',
      status: 'idle',
      catalogs: []
    }
  ]
}

const createRuntime = (overrides: {
  listCatalog?: () => Promise<DatabaseCatalogResult>
  getTableDdl?: (input: DatabaseTableDdlInput, options?: DatabaseMcpDependencyReadOptions) => Promise<any>
  queryTable?: (input: DatabaseTableQueryInput, options?: DatabaseMcpDependencyReadOptions) => Promise<any>
  inspectTableIndexes?: (input: DatabaseTableIndexInspectionInput, options?: DatabaseMcpDependencyReadOptions) => Promise<any>
  explainTable?: (input: DatabaseTableExplainPlanInput, options?: DatabaseMcpDependencyReadOptions) => Promise<any>
} = {}) => {
  const getTableDdl = vi.fn(
    overrides.getTableDdl ??
      (async () => ({
        ok: true,
        data: { ddl: 'CREATE TABLE public.orders (id bigint PRIMARY KEY, status varchar(32));' }
      }))
  )
  const queryTable = vi.fn(
    overrides.queryTable ??
      (async () => ({
        ok: true,
        data: {
          columns: ['id', 'status', 'note'],
          rows: [{ id: 42n, status: 'open', note: new Uint8Array([1, 2, 3]) }],
          rowCount: 1,
          durationMs: 4,
          total: null,
          knownColumns: ['id', 'status', 'note']
        }
      }))
  )
  const runtime = createDatabaseMcpToolRuntime({
    listCatalog: overrides.listCatalog ?? (async () => ({ ok: true, data: catalog })),
    getTableDdl,
    queryTable,
    ...(overrides.inspectTableIndexes ? { inspectTableIndexes: overrides.inspectTableIndexes } : {}),
    ...(overrides.explainTable ? { explainTable: overrides.explainTable } : {})
  })
  return { runtime, getTableDdl, queryTable }
}

const listedConnectionHandle = async (
  runtime: ReturnType<typeof createDatabaseMcpToolRuntime>,
  dbType: 'postgresql' | 'mysql' = 'postgresql'
) => {
  const result = await runtime.callTool('list_database_connections')
  const connections = Array.isArray(result?.data?.connections) ? result.data.connections : []
  const connection = connections.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).dbType === dbType) as
    | Record<string, unknown>
    | undefined
  return String(connection?.connectionId || '')
}

describe('database MCP runtime', () => {
  it('publishes only the bounded read-only database tool set', () => {
    const { runtime } = createRuntime()
    expect(runtime.definitions.map((tool) => tool.name)).toEqual(DATABASE_MCP_TOOL_NAMES)
    expect(runtime.definitions.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint)).toBe(true)
    expect(runtime.definitions.map((tool) => tool.name)).not.toContain('execute_sql')
  })

  it('lists safe connection projections without credentials or endpoints', async () => {
    const { runtime } = createRuntime()
    const result = await runtime.callTool('list_database_connections', { query: 'postgresql' })
    const handle = String((result?.data?.connections as Array<Record<string, unknown>>)?.[0]?.connectionId || '')

    expect(result).toEqual({
      ok: true,
      data: {
        connections: [
          {
            connectionId: handle,
            label: 'postgresql / Production / 1',
            dbType: 'postgresql',
            environment: 'Production',
            status: 'connected',
            readonly: false,
            catalogCount: 1
          }
        ],
        count: 1
      }
    })
    expect(handle).toMatch(/^db-[a-f0-9]{32}$/)
    expect(handle).not.toContain('db-prod')
    expect(await listedConnectionHandle(runtime)).toBe(handle)
    expect(await listedConnectionHandle(createRuntime().runtime)).not.toBe(handle)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('10.20.30.40')
    expect(serialized).not.toContain('private-user')
    expect(serialized).not.toContain('private-password')
    expect(serialized).not.toContain('private-proxy')
    expect(serialized).not.toContain('orders-postgres')
  })

  it('searches and describes catalog objects with column types and primary keys', async () => {
    const { runtime } = createRuntime()
    const connectionId = await listedConnectionHandle(runtime)
    const search = await runtime.callTool('search_database_objects', {
      connectionId,
      databaseName: 'orders',
      query: 'status',
      kinds: ['table', 'view']
    })
    expect(search?.data).toMatchObject({
      count: 2,
      objects: [
        { kind: 'view', path: 'orders.public.open_orders' },
        { kind: 'table', path: 'orders.public.orders', primaryKey: ['id'] }
      ]
    })

    const described = await runtime.callTool('describe_database_table', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })
    expect(described?.data).toMatchObject({
      table: {
        kind: 'table',
        path: 'orders.public.orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
          { name: 'status', type: 'varchar(32)', nullable: false },
          { name: 'note', type: 'text', nullable: true }
        ]
      }
    })
  })

  it('lists bounded databases, schemas, and tables from one exact connection scope', async () => {
    const { runtime } = createRuntime()
    const connectionId = await listedConnectionHandle(runtime)

    await expect(runtime.callTool('list_databases', { connectionId, databaseName: 'ORDERS' })).resolves.toMatchObject({
      ok: true,
      data: {
        databases: [{ name: 'orders', schemaCount: 2, tableCount: 2, viewCount: 1 }],
        count: 1
      }
    })
    await expect(runtime.callTool('list_schemas', { connectionId, databaseName: 'orders', query: 'pub' })).resolves.toMatchObject({
      ok: true,
      data: { databaseName: 'orders', schemas: [{ name: 'public', tableCount: 1, viewCount: 1 }], count: 1 }
    })
    await expect(runtime.callTool('list_tables', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      kinds: ['table']
    })).resolves.toMatchObject({
      ok: true,
      data: { tables: [{ path: 'orders.public.orders', kind: 'table', primaryKey: ['id'] }], count: 1 }
    })
    await expect(runtime.callTool('list_schemas', { connectionId, databaseName: 'outside' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_MCP_DATABASE_NOT_FOUND'
    })
  })

  it('samples at most 20 rows and counts through the structured withTotal table boundary', async () => {
    const queryTable = vi.fn(async (input: DatabaseTableQueryInput) => ({
      ok: true as const,
      data: {
        columns: input.columns || [],
        rows: [{ id: 1, status: 'open' }],
        rowCount: 1,
        durationMs: 3,
        total: input.withTotal ? 42 : null,
        knownColumns: ['id', 'status', 'note']
      }
    }))
    const { runtime } = createRuntime({ queryTable })
    const selector = {
      connectionId: await listedConnectionHandle(runtime),
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }

    await expect(runtime.callTool('sample_rows', { ...selector, limit: 999 })).resolves.toMatchObject({
      ok: true,
      data: { rows: [{ id: 1, status: 'open' }], limit: 20 }
    })
    expect(queryTable).toHaveBeenNthCalledWith(1, expect.objectContaining({
      page: 1,
      pageSize: 20,
      withTotal: false,
      requireStableBaseTable: true,
      whereRaw: null,
      orderByRaw: null
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))

    await expect(runtime.callTool('count_rows', {
      ...selector,
      filters: [{ column: 'status', operator: 'eq', value: 'open' }]
    })).resolves.toMatchObject({ ok: true, data: { count: 42 } })
    expect(queryTable).toHaveBeenNthCalledWith(2, expect.objectContaining({
      page: 1,
      pageSize: 1,
      withTotal: true,
      filters: [{ column: 'status', operator: 'eq', value: 'open' }],
      requireStableBaseTable: true
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('fails index inspection and explain closed when no structured engine adapter exists', async () => {
    const { runtime, queryTable } = createRuntime()
    const selector = {
      connectionId: await listedConnectionHandle(runtime),
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }

    await expect(runtime.callTool('inspect_indexes', selector)).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_MCP_INDEX_INSPECTION_UNSUPPORTED'
    })
    await expect(runtime.callTool('explain_plan', { ...selector, sql: 'EXPLAIN DELETE FROM orders' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_MCP_EXPLAIN_UNSUPPORTED'
    })
    expect(queryTable).not.toHaveBeenCalled()
    const explainDefinition = runtime.definitions.find((tool) => tool.name === 'explain_plan')
    expect((explainDefinition?.inputSchema as any).properties).not.toHaveProperty('sql')
  })

  it('fails an exact count closed when the structured engine adapter returns no total', async () => {
    const { runtime } = createRuntime()
    await expect(runtime.callTool('count_rows', {
      connectionId: await listedConnectionHandle(runtime),
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_COUNT_UNSUPPORTED' })
  })

  it('bounds and validates structured index and explain adapter output', async () => {
    const inspectTableIndexes = vi.fn(async () => ({
      ok: true as const,
      data: {
        indexes: [{ name: 'orders_pkey', columns: ['ID'], unique: true, primary: true, method: 'btree' }],
        durationMs: 2
      }
    }))
    const explainTable = vi.fn(async (_input: DatabaseTableExplainPlanInput) => ({
      ok: true as const,
      data: {
        format: 'text' as const,
        plan: 'Index Scan from 10.20.30.40 as private-user using orders_pkey',
        durationMs: 4
      }
    }))
    const { runtime } = createRuntime({ inspectTableIndexes, explainTable })
    const selector = {
      connectionId: await listedConnectionHandle(runtime),
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }

    await expect(runtime.callTool('inspect_indexes', selector)).resolves.toMatchObject({
      ok: true,
      data: { indexes: [{ name: 'orders_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' }] }
    })
    const explained = await runtime.callTool('explain_plan', {
      ...selector,
      columns: ['id'],
      sql: 'EXPLAIN DELETE FROM orders'
    })
    expect(explained).toMatchObject({ ok: true, data: { format: 'text', redacted: true } })
    expect(String(explained?.data?.plan)).not.toContain('10.20.30.40')
    expect(String(explained?.data?.plan)).not.toContain('private-user')
    expect(explainTable).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'db-prod',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      columns: ['id'],
      filters: [],
      sort: null
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(explainTable.mock.calls[0]?.[0]).not.toHaveProperty('sql')
  })

  it('propagates cancellation to an active structured database read', async () => {
    let dependencySignal: AbortSignal | undefined
    const queryTable = vi.fn((_input: DatabaseTableQueryInput, options?: DatabaseMcpDependencyReadOptions) => {
      dependencySignal = options?.signal
      return new Promise<never>(() => {})
    })
    const { runtime } = createRuntime({ queryTable })
    const controller = new AbortController()
    const pending = runtime.callTool('sample_rows', {
      connectionId: await listedConnectionHandle(runtime),
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }, { signal: controller.signal })
    await vi.waitFor(() => expect(queryTable).toHaveBeenCalledTimes(1))
    expect(dependencySignal?.aborted).toBe(false)
    controller.abort('operator_cancelled')

    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_REQUEST_CANCELLED' })
    expect(dependencySignal?.aborted).toBe(true)
    expect(dependencySignal?.reason).toBe('operator_cancelled')
  })

  it('releases timed-out leases even when the adapter remains pending', async () => {
    vi.useFakeTimers()
    try {
      const queryTable = vi.fn(() => new Promise<never>(() => {}))
      const { runtime } = createRuntime({ queryTable })
      const selector = {
        connectionId: await listedConnectionHandle(runtime),
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      }
      const timedOutReads = Array.from({ length: 4 }, () => runtime.callTool('sample_rows', selector))
      await vi.advanceTimersByTimeAsync(0)
      expect(queryTable).toHaveBeenCalledTimes(4)

      await vi.advanceTimersByTimeAsync(30_000)
      const results = await Promise.all(timedOutReads)
      expect(results.every((result) => result?.errorCode === 'DB_MCP_READ_TIMEOUT')).toBe(true)

      const controller = new AbortController()
      const replacement = runtime.callTool('sample_rows', selector, { signal: controller.signal })
      await vi.advanceTimersByTimeAsync(0)
      expect(queryTable).toHaveBeenCalledTimes(5)
      controller.abort()
      await expect(replacement).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_REQUEST_CANCELLED' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases cancelled leases while bounding adapters that ignore cancellation', async () => {
    const settlePhysicalReads: Array<(result: unknown) => void> = []
    const queryTable = vi.fn(() => new Promise((resolve) => settlePhysicalReads.push(resolve)))
    const { runtime } = createRuntime({ queryTable })
    const connectionId = await listedConnectionHandle(runtime)
    const selector = {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }
    const controllers = Array.from({ length: 10 }, () => new AbortController())
    const firstReads = controllers.slice(0, 4).map((controller) =>
      runtime.callTool('sample_rows', selector, { signal: controller.signal })
    )
    await vi.waitFor(() => expect(queryTable).toHaveBeenCalledTimes(4))

    controllers.slice(0, 4).forEach((controller) => controller.abort())
    await expect(Promise.all(firstReads)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: false, errorCode: 'DB_MCP_REQUEST_CANCELLED' })
      ])
    )

    const replacement = runtime.callTool('sample_rows', selector, { signal: controllers[4].signal })
    await vi.waitFor(() => expect(queryTable).toHaveBeenCalledTimes(5))
    controllers[4].abort()
    await expect(replacement).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_REQUEST_CANCELLED' })

    const remainingPhysicalCapacity = controllers.slice(5, 8).map((controller) =>
      runtime.callTool('sample_rows', selector, { signal: controller.signal })
    )
    await vi.waitFor(() => expect(queryTable).toHaveBeenCalledTimes(8))
    controllers.slice(5, 8).forEach((controller) => controller.abort())
    await expect(Promise.all(remainingPhysicalCapacity)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: false, errorCode: 'DB_MCP_REQUEST_CANCELLED' })
      ])
    )

    await expect(runtime.callTool('sample_rows', selector, { signal: controllers[8].signal }))
      .resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_READ_CHANNEL_ISOLATED' })
    expect(queryTable).toHaveBeenCalledTimes(8)

    settlePhysicalReads[0]({
      ok: true,
      data: {
        columns: ['id', 'status'],
        rows: [],
        rowCount: 0,
        durationMs: 1,
        total: null,
        knownColumns: ['id', 'status', 'note']
      }
    })
    await Promise.resolve()
    await Promise.resolve()
    const recovered = runtime.callTool('sample_rows', selector, { signal: controllers[9].signal })
    await vi.waitFor(() => expect(queryTable).toHaveBeenCalledTimes(9))
    controllers[9].abort()
    await expect(recovered).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_REQUEST_CANCELLED' })
  })

  it('requires a schema when a table name is ambiguous', async () => {
    const { runtime } = createRuntime()
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('describe_database_table', {
      connectionId,
      databaseName: 'orders',
      tableName: 'orders'
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'DB_MCP_SCHEMA_REQUIRED' })
  })

  it('passes only validated structured filters and bounded pagination to the database backend', async () => {
    const { runtime, queryTable } = createRuntime()
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('query_database_table', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [{ column: 'STATUS', operator: 'eq', value: 'open' }],
      sort: { column: 'id', direction: 'desc' },
      page: 99999,
      pageSize: 99999,
      withTotal: true,
      whereRaw: '1=1; DELETE FROM orders'
    })

    expect(result?.ok).toBe(true)
    expect(queryTable).toHaveBeenCalledWith({
      connectionId: 'db-prod',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      columns: ['id', 'status'],
      filters: [{ column: 'status', operator: 'eq', value: 'open' }],
      sort: { column: 'id', direction: 'desc' },
      whereRaw: null,
      orderByRaw: null,
      page: 1000,
      pageSize: 100,
      withTotal: false,
      requireStableBaseTable: true
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(result?.data).toMatchObject({
      columns: ['id', 'status'],
      omittedColumns: ['note'],
      rows: [{ id: '42', status: 'open' }],
      page: 1000,
      pageSize: 100,
      truncated: false
    })
    expect(JSON.stringify(result)).not.toContain('binary')
  })

  it('caps response rows at pageSize even when a database adapter returns extra rows', async () => {
    const inaccessibleExtraRow = new Proxy({ id: 4, status: 'open' }, {
      ownKeys: () => {
        throw new Error('Rows beyond pageSize must not be projected.')
      }
    })
    const { runtime } = createRuntime({
      queryTable: async () => ({
        ok: true,
        data: {
          columns: ['id', 'status'],
          rows: [
            { id: 1, status: 'open' },
            { id: 2, status: 'open' },
            { id: 3, status: 'open' },
            inaccessibleExtraRow
          ],
          rowCount: 4,
          durationMs: 1,
          total: null,
          knownColumns: ['id', 'status', 'note']
        }
      })
    })
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('query_database_table', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      pageSize: 3
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        rows: [
          { id: 1, status: 'open' },
          { id: 2, status: 'open' },
          { id: 3, status: 'open' }
        ],
        rowCount: 3,
        pageSize: 3,
        truncated: true
      }
    })
  })

  it('rejects unbounded columns in projections, filters, and sorting before querying', async () => {
    const { runtime, queryTable } = createRuntime()
    const selector = {
      connectionId: await listedConnectionHandle(runtime),
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }

    await expect(runtime.callTool('query_database_table', { ...selector, columns: ['note'] })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_MCP_UNBOUNDED_COLUMN_UNSUPPORTED'
    })
    await expect(
      runtime.callTool('query_database_table', { ...selector, filters: [{ column: 'note', operator: 'eq', value: 'secret' }] })
    ).resolves.toMatchObject({ ok: false, errorCode: 'DB_MCP_FILTER_COLUMN_INVALID' })
    await expect(runtime.callTool('query_database_table', { ...selector, sort: { column: 'note', direction: 'asc' } })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_MCP_SORT_INVALID'
    })
    expect(queryTable).not.toHaveBeenCalled()
  })

  it('rejects unknown filter columns before any database query', async () => {
    const { runtime, queryTable } = createRuntime()
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('query_database_table', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [{ column: 'password', operator: 'eq', value: 'x' }]
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'DB_MCP_FILTER_COLUMN_INVALID' })
    expect(queryTable).not.toHaveBeenCalled()
  })

  it('does not forward raw database driver errors to MCP clients', async () => {
    const { runtime } = createRuntime({
      queryTable: async () => ({
        ok: false,
        errorCode: 'DB_POSTGRES_QUERY_FAILED',
        errorMessage: 'connect ECONNREFUSED 10.20.30.40:5432 as private-user'
      })
    })
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('query_database_table', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })
    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_POSTGRES_QUERY_FAILED',
      errorMessage: 'Database table query failed.'
    })
    expect(JSON.stringify(result)).not.toContain('10.20.30.40')
    expect(JSON.stringify(result)).not.toContain('private-user')
  })

  it('maps thrown catalog and database dependency errors without leaking details or leaving deadline timers', async () => {
    vi.useFakeTimers()
    try {
      const catalogFailure = createRuntime({
        listCatalog: async () => {
          throw new Error('state file /home/private/database-workspace.json')
        }
      }).runtime
      await expect(catalogFailure.callTool('list_database_connections')).resolves.toEqual({
        ok: false,
        errorCode: 'DB_MCP_CATALOG_FAILED',
        errorMessage: 'Database catalog could not be loaded.'
      })

      const queryFailure = createRuntime({
        queryTable: async () => {
          throw new Error('connect ECONNREFUSED 10.20.30.40:5432 as private-user')
        }
      }).runtime
      const queryConnectionId = await listedConnectionHandle(queryFailure)
      await expect(
        queryFailure.callTool('query_database_table', {
          connectionId: queryConnectionId,
          databaseName: 'orders',
          schemaName: 'public',
          tableName: 'orders'
        })
      ).resolves.toEqual({ ok: false, errorCode: 'DB_MCP_QUERY_FAILED', errorMessage: 'Database table query failed.' })

      const ddlFailure = createRuntime({
        getTableDdl: async () => {
          throw new Error('failed to read /private/db.sql from 10.20.30.40')
        }
      }).runtime
      const ddlConnectionId = await listedConnectionHandle(ddlFailure)
      await expect(
        ddlFailure.callTool('get_database_table_ddl', {
          connectionId: ddlConnectionId,
          databaseName: 'orders',
          schemaName: 'public',
          tableName: 'orders'
        })
      ).resolves.toEqual({ ok: false, errorCode: 'DB_MCP_DDL_FAILED', errorMessage: 'Database table DDL could not be loaded.' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps DDL returned to MCP clients', async () => {
    const rawDdl = `CREATE TABLE public.orders (note text);\n${'测'.repeat(300 * 1024)}`
    const { runtime, getTableDdl } = createRuntime({
      getTableDdl: async () => ({ ok: true, data: { ddl: rawDdl } })
    })
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('get_database_table_ddl', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(result).toMatchObject({ ok: true, data: { truncated: true, ddlBytes: expect.any(Number) } })
    expect(Number(result?.data?.ddlBytes)).toBeGreaterThan(256 * 1024 - 4)
    expect(Buffer.byteLength(String(result?.data?.ddl || ''), 'utf8')).toBeLessThanOrEqual(256 * 1024)
    expect(String(result?.data?.ddl || '')).not.toContain('\uFFFD')
    expect(getTableDdl).toHaveBeenCalledWith({
      connectionId: 'db-prod',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('redacts database-controlled DDL literals, comments, definers, function bodies, and endpoints', () => {
    const rawDdl = `
      -- private-user should never leave the MCP runtime
      CREATE DEFINER=\`weird\`\`private-user\`@\`10.20.30.40\` VIEW public.safe_view AS
        SELECT 'private-password' AS token;
      /* proxy: private-proxy */
      CREATE FUNCTION public.remote_value() RETURNS text AS $body$
        SELECT dblink('host=10.20.30.40 password=private-password', 'SELECT secret');
      $body$ LANGUAGE sql;
      CREATE TABLE public.metrics (id bigint, note varchar(32) DEFAULT q'[oracle-secret]')
        ENGINE = S3('https://storage.private.invalid/data', 'access-key', 'secret-key');
    `
    const sanitized = sanitizeDatabaseMcpDdl(rawDdl, [
      '10.20.30.40',
      'private-user',
      'weird``private-user',
      'private-proxy',
      'https://storage.private.invalid/data'
    ])

    expect(sanitized).toContain('CREATE DEFINER=[redacted] VIEW public.safe_view')
    expect(sanitized).toContain('$body$[redacted]$body$')
    expect(sanitized).toContain("q'[[redacted]]'")
    for (const secret of [
      'private-user',
      '10.20.30.40',
      'private-password',
      'private-proxy',
      'storage.private.invalid',
      'access-key',
      'secret-key',
      'SELECT secret'
    ]) {
      expect(sanitized).not.toContain(secret)
    }
  })

  it('keeps DDL source truncation Unicode-safe and redacts short login tokens', () => {
    const rawDdl = `${'A'.repeat(512 * 1024 - 1)}\u{1F600}`
    const truncated = sanitizeDatabaseMcpDdl(rawDdl)
    const redacted = sanitizeDatabaseMcpDdl(
      'ALTER TABLE public.orders OWNER TO "sa"; OWNER TO "王"; SERVER db.internal; FILE /x; LABEL db;',
      ['sa', '王', 'db', '/x', 'db.internal']
    )

    expect(truncated).not.toContain('\uFFFD')
    expect(truncated.charCodeAt(truncated.length - 1)).not.toBeGreaterThanOrEqual(0xd800)
    expect(redacted).toContain('OWNER TO "[redacted]"')
    expect(redacted).toContain('OWNER TO "[redacted]"; SERVER [redacted]; FILE [redacted]; LABEL [redacted]')
    expect(redacted).not.toContain('.internal')
    expect(redacted).not.toContain('王')
  })

  it('redacts connection details and credential-shaped values from provider-bound error text', () => {
    const sanitized = sanitizeDatabaseMcpSensitiveText(
      'connect to postgresql://private-user:private-password@10.20.30.40:5432 or 2001:db8::1 failed password=secret-token file /private/orders.db',
      ['private-user', '10.20.30.40', '5432', '/private/orders.db']
    )

    expect(sanitized).toContain('connect to postgresql://[redacted]@[redacted]:[redacted] or [redacted] failed password=[redacted] file [redacted]')
    expect(sanitized).not.toContain('private-user')
    expect(sanitized).not.toContain('private-password')
    expect(sanitized).not.toContain('secret-token')
  })

  it('redacts the saved database login user from returned DDL', async () => {
    const { runtime } = createRuntime({
      getTableDdl: async () => ({
        ok: true,
        data: { ddl: 'CREATE TABLE public.orders (id bigint); ALTER TABLE public.orders OWNER TO "private-user";' }
      })
    })
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('get_database_table_ddl', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(result).toMatchObject({ ok: true, data: { redacted: true } })
    expect(String(result?.data?.ddl)).toContain('OWNER TO "[redacted]"')
    expect(String(result?.data?.ddl)).not.toContain('private-user')
  })

  it('does not default-project unbounded varying-bit or arbitrary-precision numeric values', async () => {
    const unsafeCatalog: DatabaseWorkspaceCatalog = structuredClone(catalog)
    const table = unsafeCatalog.connections[0].catalogs[0].schemas?.[0]?.tables[0]
    if (!table) throw new Error('test table missing')
    table.columns.push(
      { name: 'flags', type: 'bit varying', nullable: false },
      { name: 'huge_number', type: 'numeric', nullable: false },
      { name: 'bounded_number', type: 'numeric(20, 4)', nullable: false }
    )
    const queryTable = vi.fn(async () => ({
      ok: true as const,
      data: {
        columns: ['id', 'status', 'bounded_number'],
        rows: [{ id: 1, status: 'open', bounded_number: '12.5000', flags: '1'.repeat(100_000), huge_number: '9'.repeat(100_000) }],
        rowCount: 1,
        durationMs: 1,
        total: null,
        knownColumns: table.columns.map((column) => column.name)
      }
    }))
    const runtime = createDatabaseMcpToolRuntime({
      listCatalog: async () => ({ ok: true, data: unsafeCatalog }),
      getTableDdl: async () => ({ ok: true, data: { ddl: '' } }),
      queryTable
    })
    const connectionId = await listedConnectionHandle(runtime)
    const result = await runtime.callTool('query_database_table', {
      connectionId,
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(queryTable).toHaveBeenCalledWith(
      expect.objectContaining({ columns: ['id', 'status', 'bounded_number'] }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result?.data).toMatchObject({
      columns: ['id', 'status', 'bounded_number'],
      omittedColumns: ['note', 'flags', 'huge_number'],
      rows: [{ id: 1, status: 'open', bounded_number: '12.5000' }]
    })
  })

  it('requires non-SQLite connections to be explicitly open in aiopsterm', async () => {
    const { runtime, getTableDdl } = createRuntime()
    const connectionId = await listedConnectionHandle(runtime, 'mysql')
    const result = await runtime.callTool('get_database_table_ddl', {
      connectionId,
      databaseName: 'idle',
      tableName: 'missing'
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'DB_MCP_CONNECTION_NOT_CONNECTED' })
    expect(getTableDdl).not.toHaveBeenCalled()
  })

  it('rejects raw saved connection ids externally while allowing the internal DB AI path', async () => {
    const { runtime } = createRuntime()
    const selector = {
      connectionId: 'db-prod',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    }

    await expect(runtime.callTool('describe_database_table', selector)).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_MCP_CONNECTION_NOT_FOUND'
    })
    await expect(runtime.callTool('describe_database_table', selector, { allowInternalConnectionId: true })).resolves.toMatchObject({
      ok: true,
      data: { table: { path: 'orders.public.orders' } }
    })
  })

  it('returns null for methods outside the database MCP namespace', async () => {
    const { runtime } = createRuntime()
    await expect(runtime.callTool('execute_sql', { sql: 'DROP TABLE orders' })).resolves.toBeNull()
  })
})
