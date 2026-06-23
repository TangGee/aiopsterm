import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseCatalogConnectionBackend } from '@/services/database/databaseCatalogConnectionBackend'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('databaseCatalogConnectionBackend', () => {
  it('centralizes Database connection preload fallbacks', async () => {
    window.aiops = {
      ...originalAiops,
      testDatabaseConnection: undefined as any,
      saveDatabaseConnection: undefined as any,
      createDatabaseGroup: undefined as any,
      connectDatabaseConnection: undefined as any,
      getDatabaseTableDdl: undefined as any
    }
    const backend = createDatabaseCatalogConnectionBackend({ errorToMessage: (error) => String(error) })

    await expect(backend.testConnection({ dbType: 'postgresql', name: 'prod' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.saveConnection({ mode: 'create', connection: { dbType: 'postgresql', name: 'prod' } })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.createGroup({ name: 'New Group' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.connectConnection('conn-1')).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
    await expect(backend.fetchTableDdl({ connectionId: 'conn-1', dbType: 'postgresql', catalogName: 'app', tableName: 'orders' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'DB_PRELOAD_UNAVAILABLE'
    })
  })

  it('normalizes DDL bridge results and converts bridge errors to runtime failures', async () => {
    window.aiops = {
      ...originalAiops,
      getDatabaseTableDdl: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: { ddl: 'create table orders(id integer);' } })
        .mockRejectedValueOnce(new Error('driver unavailable'))
    }
    const backend = createDatabaseCatalogConnectionBackend({ errorToMessage: (error) => (error instanceof Error ? error.message : String(error)) })

    await expect(backend.fetchTableDdl({ connectionId: 'conn-1', dbType: 'postgresql', catalogName: 'app', schemaName: 'public', tableName: 'orders' })).resolves.toEqual({
      ok: true,
      ddl: 'create table orders(id integer);'
    })
    await expect(backend.fetchTableDdl({ connectionId: 'conn-1', dbType: 'postgresql', catalogName: 'app', schemaName: 'public', tableName: 'orders' })).resolves.toEqual({
      ok: false,
      errorCode: 'other',
      errorMessage: 'driver unavailable'
    })
    expect(window.aiops.getDatabaseTableDdl).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      dbType: 'postgresql',
      databaseName: 'app',
      schemaName: 'public',
      tableName: 'orders'
    })
  })
})
