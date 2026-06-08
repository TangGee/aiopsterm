import { beforeEach, describe, expect, it } from 'vitest'
import {
  connectDatabaseConnection,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  createDatabaseCatalog,
  createDatabaseGroup,
  deleteDatabaseGroup,
  disconnectDatabaseConnection,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  executeDatabaseSql,
  getDatabaseTableDdl,
  listDatabaseCatalog,
  moveDatabaseConnection,
  moveDatabaseGroup,
  mutateDatabaseTable,
  queryDatabaseTable,
  refreshDatabaseConnection,
  removeDatabaseConnection,
  renameDatabaseGroup,
  resetDatabaseBackendSeed,
  saveDatabaseConnection,
  testDatabaseConnection
} from '@shared/database'

describe('database backend boundary', () => {
  beforeEach(() => {
    resetDatabaseBackendSeed()
  })

  it('validates PostgreSQL drafts and returns backend probe metadata', async () => {
    const result = await testDatabaseConnection({
      dbType: 'postgresql',
      name: 'orders-postgres',
      host: '127.0.0.1',
      port: 5432,
      user: 'postgres',
      database: 'orders',
      sslMode: 'require'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      dbType: 'postgresql',
      serverVersion: 'PostgreSQL 16 local backend validation',
      endpoint: '127.0.0.1:5432'
    })
    expect(result.data?.durationMs).toBeGreaterThan(0)
  })

  it('lists the database workspace catalog through the backend boundary', async () => {
    const result = await listDatabaseCatalog()

    expect(result.ok).toBe(true)
    expect(result.data?.engines).toHaveLength(16)
    expect(result.data?.engines.filter((engine) => engine.enabled).map((engine) => engine.name)).toEqual(['MySQL', 'Oracle', 'PostgreSQL', 'SQLite'])
    expect(result.data?.groups.map((group) => group.name)).toEqual(['Default Group', 'Production', 'Local Lab'])
    expect(result.data?.groupParents).toEqual({
      'group-default': null,
      'group-prod': null,
      'group-local': null
    })
    expect(result.data?.defaults).toMatchObject({
      selectedNodeId: 'conn-prod-pg',
      expandedConnectionIds: ['conn-prod-pg'],
      expandedCatalogIds: ['conn-prod-pg:orders']
    })

    const ordersConnection = result.data?.connections.find((connection) => connection.id === 'conn-prod-pg')
    const publicSchema = ordersConnection?.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')
    const opsSchema = ordersConnection?.catalogs[0]?.schemas?.find((schema) => schema.name === 'ops')
    expect(ordersConnection).toMatchObject({ name: 'orders-postgres', dbType: 'postgresql', status: 'connected' })
    expect(publicSchema?.tables.map((table) => table.name)).toEqual(['orders'])
    expect(publicSchema?.views?.map((table) => table.name)).toEqual(['open_orders_v'])
    expect(opsSchema?.tables.map((table) => table.name)).toEqual(['ops_incidents'])
    expect(opsSchema?.views?.map((table) => table.name)).toEqual(['active_incidents_v'])

    const metricsConnection = result.data?.connections.find((connection) => connection.id === 'conn-metrics-mysql')
    expect(metricsConnection?.catalogs[0]?.tables?.map((table) => table.name)).toEqual(['service_health', 'ops_incidents', 'metric_events'])
  })

  it('persists database sidebar group and connection menu actions behind the backend boundary', async () => {
    const createGroup = await createDatabaseGroup({ name: 'Unit DB Group', parentId: 'group-default' })
    expect(createGroup.ok).toBe(true)
    expect(createGroup.data?.group).toEqual({ id: 'group-unit-db-group', name: 'Unit DB Group' })
    expect(createGroup.data?.groupParents['group-unit-db-group']).toBe('group-default')

    const renameGroup = await renameDatabaseGroup({ id: 'group-unit-db-group', name: 'Renamed DB Group' })
    expect(renameGroup.ok).toBe(true)
    expect(renameGroup.data?.groups.find((group) => group.id === 'group-unit-db-group')?.name).toBe('Renamed DB Group')

    const moveGroup = await moveDatabaseGroup({ id: 'group-unit-db-group', parentId: null })
    expect(moveGroup.ok).toBe(true)
    expect(moveGroup.data?.groupParents['group-unit-db-group']).toBeNull()

    const moveConnection = await moveDatabaseConnection({ connectionId: 'conn-metrics-mysql', groupId: 'group-unit-db-group' })
    expect(moveConnection.ok).toBe(true)
    expect(moveConnection.data?.connection.groupId).toBe('group-unit-db-group')
    expect(moveConnection.data?.connections.find((connection) => connection.id === 'conn-metrics-mysql')?.groupId).toBe('group-unit-db-group')

    const connect = await connectDatabaseConnection('conn-metrics-mysql')
    expect(connect.ok).toBe(true)
    expect(connect.data?.connection.status).toBe('connected')

    const refresh = await refreshDatabaseConnection('conn-metrics-mysql')
    expect(refresh.ok).toBe(true)
    expect(refresh.data?.connection.catalogs[0]?.tables?.map((table) => table.name)).toContain('service_health')

    const disconnect = await disconnectDatabaseConnection('conn-metrics-mysql')
    expect(disconnect.ok).toBe(true)
    expect(disconnect.data?.connection.status).toBe('idle')

    const deleteGroup = await deleteDatabaseGroup('group-unit-db-group')
    expect(deleteGroup.ok).toBe(true)
    expect(deleteGroup.data?.groups.some((group) => group.id === 'group-unit-db-group')).toBe(false)
    expect(deleteGroup.data?.connections.find((connection) => connection.id === 'conn-metrics-mysql')?.groupId).toBe('group-default')

    const removeConnection = await removeDatabaseConnection('conn-metrics-mysql')
    expect(removeConnection.ok).toBe(true)
    expect(removeConnection.data?.connections.some((connection) => connection.id === 'conn-metrics-mysql')).toBe(false)

    const resetCatalog = await listDatabaseCatalog()
    expect(resetCatalog.data?.connections.some((connection) => connection.id === 'conn-metrics-mysql')).toBe(false)
    resetDatabaseBackendSeed()
    const restoredCatalog = await listDatabaseCatalog()
    expect(restoredCatalog.data?.connections.some((connection) => connection.id === 'conn-metrics-mysql')).toBe(true)
  })

  it('rejects invalid SQLite file extensions behind the preload/main boundary', async () => {
    const result = await testDatabaseConnection({
      dbType: 'sqlite',
      name: 'cache',
      filePath: '/tmp/cache.txt',
      readonly: true
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQLITE_EXTENSION',
      errorMessage: 'SQLite file should end with .db, .sqlite, or .sqlite3.'
    })
  })

  it('allows Oracle connect-string-only drafts', async () => {
    const result = await testDatabaseConnection({
      dbType: 'oracle',
      name: 'hr-oracle-url',
      user: 'hr',
      password: 'secret',
      database: 'ORCLPDB1',
      url: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      dbType: 'oracle',
      serverVersion: 'Oracle local backend validation',
      endpoint: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
    })
  })

  it('saves database connections through the backend catalog boundary', async () => {
    const createResult = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'unit-sqlite',
        filePath: '/tmp/aiopsterm/unit-cache.sqlite3',
        readonly: true,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })

    expect(createResult.ok).toBe(true)
    expect(createResult.data?.connection).toMatchObject({
      id: 'conn-unit-sqlite',
      name: 'unit-sqlite',
      dbType: 'sqlite',
      host: 'local',
      database: 'unit-cache.sqlite3',
      filePath: '/tmp/aiopsterm/unit-cache.sqlite3',
      status: 'idle'
    })
    expect(createResult.data?.connection.catalogs).toEqual([{ name: 'unit-cache.sqlite3', tables: [] }])
    expect(createResult.data?.connections.some((connection) => connection.id === 'conn-unit-sqlite')).toBe(true)
    expect(createResult.data?.defaults.selectedNodeId).toBe('conn-unit-sqlite')

    const editResult = await saveDatabaseConnection({
      mode: 'edit',
      id: 'conn-prod-pg',
      connection: {
        dbType: 'postgresql',
        name: 'orders-pg-edited',
        host: '10.32.6.9',
        port: 5432,
        user: 'readonly',
        password: '',
        database: 'orders',
        sslMode: 'require',
        env: 'Production',
        groupId: 'group-prod',
        authentication: 'UserAndPassword'
      }
    })

    expect(editResult.ok).toBe(true)
    expect(editResult.data?.connection).toMatchObject({
      id: 'conn-prod-pg',
      name: 'orders-pg-edited',
      hasPassword: true
    })
    expect(editResult.data?.connection.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')?.tables.map((table) => table.name)).toEqual([
      'orders'
    ])

    resetDatabaseBackendSeed()
    const resetCatalog = await listDatabaseCatalog()
    expect(resetCatalog.data?.connections.some((connection) => connection.id === 'conn-unit-sqlite')).toBe(false)
    expect(resetCatalog.data?.connections.find((connection) => connection.id === 'conn-prod-pg')?.name).toBe('orders-postgres')
  })

  it('creates database catalogs through the backend boundary', async () => {
    const result = await createDatabaseCatalog({
      connectionId: 'conn-metrics-mysql',
      requestedName: 'ops_metrics',
      sql: 'CREATE DATABASE `ops_metrics`;'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.catalog).toEqual({ name: 'ops_metrics', tables: [] })
    expect(result.data?.connection.catalogs.map((catalog) => catalog.name)).toContain('ops_metrics')
    expect(result.data?.defaults.selectedNodeId).toBe('conn-metrics-mysql')
    expect(result.data?.defaults.expandedCatalogIds).toContain('conn-metrics-mysql:ops_metrics')

    const duplicate = await createDatabaseCatalog({
      connectionId: 'conn-metrics-mysql',
      requestedName: 'ops_metrics',
      sql: 'CREATE DATABASE `ops_metrics`;'
    })

    expect(duplicate.ok).toBe(false)
    expect(duplicate.errorCode).toBe('DB_CREATE_DATABASE_DUPLICATE')
  })

  it('executes SELECT statements from the database backend seed data', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      sql: 'select id, service, status from public.orders order by updated_at desc limit 20'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.columns).toEqual(['id', 'service', 'status', 'owner', 'updated_at'])
    expect(result.data?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'payment-api', status: 'investigating' }),
        expect.objectContaining({ service: 'orders-worker', status: 'mitigated' })
      ])
    )
    expect(result.data?.durationMs).toBeGreaterThan(0)
  })

  it('returns backend explain-plan rows without renderer result generation', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      sql: 'EXPLAIN select * from public.orders'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.columns).toEqual(['step', 'operation', 'relation', 'cost', 'rows'])
    expect(result.data?.rows[0]).toMatchObject({ operation: 'Seq Scan', relation: 'orders' })
  })

  it('rejects empty SQL before execution', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      sql: ''
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQL_EMPTY',
      errorMessage: 'SQL is required.'
    })
  })

  it('reports backend SQL rejections as mutation errors', async () => {
    const result = await executeDatabaseSql({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      sql: 'syntax_error'
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DB_SQL_REJECTED',
      errorMessage: 'Backend SQL executor rejected this statement.'
    })
  })

  it('fetches table DDL through the database backend boundary', async () => {
    const result = await getDatabaseTableDdl({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.ddl).toContain('CREATE TABLE public.orders')
  })

  it('generates DB AI pane responses behind the database backend boundary', async () => {
    const created = await createDatabaseAiPaneRequest({
      prompt: 'Summarize schema and generate a SELECT',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      },
      activeSql: 'select * from public.orders;',
      messages: [{ role: 'user', content: 'previous database question' }]
    })

    expect(created.ok).toBe(true)
    expect(created.data?.requestId).toMatch(/^dbai-pane-request-/)
    expect(created.data?.userMessage).toMatchObject({
      requestId: created.data?.requestId,
      role: 'user',
      status: 'done',
      content: 'Summarize schema and generate a SELECT'
    })
    expect(created.data?.assistantMessage).toMatchObject({
      requestId: created.data?.requestId,
      role: 'assistant',
      status: 'queued',
      content: ''
    })

    const startedAt = Date.now()
    const result = await generateDatabaseAiPaneResponse({
      requestId: created.data!.requestId,
      assistantMessageId: created.data!.assistantMessage.id,
      prompt: 'Summarize schema and generate a SELECT',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      },
      activeSql: 'select * from public.orders;',
      messages: [{ role: 'user', content: 'previous database question' }]
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      requestId: created.data?.requestId,
      provider: 'aiopsterm-local',
      assistantMessage: expect.objectContaining({
        id: created.data?.assistantMessage.id,
        requestId: created.data?.requestId,
        status: 'done'
      })
    })
    expect(result.data?.text).toContain('orders-postgres · postgresql · orders · public')
    expect(result.data?.text).toContain('当前响应由 aiopsterm DB AI 本地后端生成')
    expect(result.data?.text).toContain('orders(5 columns)')
    expect(result.data?.text).toContain('FROM "public"."open_orders_v"')
    expect(elapsedMs).toBeGreaterThanOrEqual(475)
  })

  it('generates DB AI drawer SQL behind the database backend boundary', async () => {
    const created = await createDatabaseAiDrawerRequest({
      action: 'convert',
      sourceSql: 'select id from "public"."orders" where status = \'open\'',
      targetDialect: 'mssql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      }
    })

    expect(created.ok).toBe(true)
    expect(created.data).toMatchObject({
      id: expect.stringMatching(/^dbai-drawer-request-/),
      action: 'convert',
      label: 'Convert SQL',
      status: 'queued',
      contextSummary: 'orders-postgres · postgresql · orders · public',
      sourceSql: 'select id from "public"."orders" where status = \'open\'',
      text: '',
      targetDialect: 'mssql',
      backendContext: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        contextSummary: 'orders-postgres · postgresql · orders · public'
      }
    })

    const startedAt = Date.now()
    const result = await generateDatabaseAiDrawerResponse({
      action: created.data!.action,
      sourceSql: created.data!.sourceSql,
      targetDialect: created.data!.targetDialect,
      context: created.data!.backendContext
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'aiopsterm-local',
      sql: expect.stringContaining('SELECT TOP (100)')
    })
    expect(result.data?.sql).toContain('[public].[orders]')
    expect(result.data?.reasoning).toContain('aiopsterm DB AI 本地后端生成')
    expect(result.data?.text).toContain('```sql')
    expect(elapsedMs).toBeGreaterThanOrEqual(240)
  })

  it('completes drawer SQL from the supplied cursor prefix', async () => {
    const result = await generateDatabaseAiDrawerResponse({
      action: 'complete',
      sourceSql: 'select id from public.orders where',
      targetDialect: 'postgresql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data?.sql).toContain("where status = 'open'")
    expect(result.data?.sql).toContain('LIMIT 100')
  })

  it('diagnoses SQL errors through the drawer backend without renderer SQL generation', async () => {
    const result = await generateDatabaseAiDrawerResponse({
      action: 'diagnose',
      sourceSql: 'select * from public.orders_missing',
      targetDialect: 'postgresql',
      context: {
        connectionId: 'conn-prod-pg',
        dbType: 'postgresql',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      },
      errorMessage: 'relation does not exist'
    })

    expect(result.ok).toBe(true)
    expect(result.data?.sql).toBe('SELECT *\nFROM "public"."orders"\nLIMIT 100;')
    expect(result.data?.reasoning).toContain('Diagnosis input error')
  })

  it('preserves DDL permission errors from the backend boundary', async () => {
    const result = await getDatabaseTableDdl({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'open_orders_v'
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'permission',
      errorMessage: 'DDL requires elevated catalog permission.'
    })
  })

  it('queries table rows with backend filters, paging metadata, and totals', async () => {
    const result = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [],
      sort: null,
      whereRaw: "status = 'investigating'",
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(result.ok).toBe(true)
    expect(result.data?.columns).toEqual(['id', 'service', 'status', 'owner', 'updated_at'])
    expect(result.data?.rows).toEqual([expect.objectContaining({ id: 1001, service: 'payment-api', status: 'investigating' })])
    expect(result.data?.rowCount).toBe(1)
    expect(result.data?.total).toBe(1)
    expect(result.data?.knownColumns).toEqual(['id', 'service', 'status', 'owner', 'updated_at'])
  })

  it('applies table mutations through backend state and supports truncate/drop', async () => {
    const updateResult = await mutateDatabaseTable({
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'update', rowKey: JSON.stringify([1001]), primaryKey: ['id'], patch: { owner: 'dba-oncall' } }]
    })

    expect(updateResult.ok).toBe(true)
    expect(updateResult.data?.affected).toBe(1)

    const updatedRows = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [{ column: 'id', operator: 'eq', value: '1001' }],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(updatedRows.ok).toBe(true)
    expect(updatedRows.data?.rows[0]).toMatchObject({ id: 1001, owner: 'dba-oncall' })

    const truncateResult = await mutateDatabaseTable({
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'truncate' }]
    })

    expect(truncateResult.ok).toBe(true)
    expect(truncateResult.data?.affected).toBe(4)

    const emptyRows = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(emptyRows.ok).toBe(true)
    expect(emptyRows.data?.rows).toEqual([])
    expect(emptyRows.data?.total).toBe(0)

    const dropResult = await mutateDatabaseTable({
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      mutations: [{ kind: 'drop' }]
    })

    expect(dropResult.ok).toBe(true)
    expect(dropResult.data?.affected).toBe(0)
    const mutationPublicSchema = dropResult.data?.catalog?.connections
      .find((connection) => connection.id === 'conn-prod-pg')
      ?.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')
    expect(mutationPublicSchema?.tables.some((table) => table.name === 'orders')).toBe(false)
    expect(mutationPublicSchema?.views?.some((table) => table.name === 'open_orders_v')).toBe(true)

    const droppedRows = await queryDatabaseTable({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders',
      filters: [],
      sort: null,
      whereRaw: null,
      orderByRaw: null,
      page: 1,
      pageSize: 100,
      withTotal: true
    })

    expect(droppedRows.ok).toBe(false)
    expect(droppedRows.errorCode).toBe('DB_TABLE_NOT_FOUND')

    const droppedDdl = await getDatabaseTableDdl({
      connectionId: 'conn-prod-pg',
      dbType: 'postgresql',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })

    expect(droppedDdl.ok).toBe(false)
    expect(droppedDdl.errorCode).toBe('DB_TABLE_NOT_FOUND')

    const catalogAfterDrop = await listDatabaseCatalog()
    const publicSchema = catalogAfterDrop.data?.connections
      .find((connection) => connection.id === 'conn-prod-pg')
      ?.catalogs[0]?.schemas?.find((schema) => schema.name === 'public')
    expect(catalogAfterDrop.ok).toBe(true)
    expect(publicSchema?.tables.some((table) => table.name === 'orders')).toBe(false)
    expect(publicSchema?.views?.some((table) => table.name === 'open_orders_v')).toBe(true)
  })
})
