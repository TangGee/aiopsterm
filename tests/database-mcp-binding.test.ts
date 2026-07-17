import { beforeAll, describe, expect, it } from 'vitest'

let callBoundDatabaseAiMcpTool: any

beforeAll(async () => {
  const modulePath = '../src/main/backend/database/databaseMcp'
  ;({ callBoundDatabaseAiMcpTool } = await import(modulePath))
})

describe('DB AI database MCP binding', () => {
  it('rejects a model-requested database outside the Main-owned session scope', async () => {
    await expect(callBoundDatabaseAiMcpTool(
      'list_tables',
      { databaseName: 'outside' },
      { connectionId: 'connection-1', databaseName: 'orders', schemaName: 'public' }
    )).resolves.toEqual({
      ok: false,
      errorCode: 'DB_MCP_DATABASE_SCOPE_MISMATCH',
      errorMessage: 'The requested database is outside the DB AI session scope.'
    })
  })

  it('rejects a model-requested schema outside the Main-owned session scope', async () => {
    await expect(callBoundDatabaseAiMcpTool(
      'sample_rows',
      { schemaName: 'private', tableName: 'orders' },
      { connectionId: 'connection-1', databaseName: 'orders', schemaName: 'public' }
    )).resolves.toEqual({
      ok: false,
      errorCode: 'DB_MCP_SCHEMA_SCOPE_MISMATCH',
      errorMessage: 'The requested schema is outside the DB AI session scope.'
    })
  })

  it('fails before dispatch when the Product Session has no authoritative connection', async () => {
    await expect(callBoundDatabaseAiMcpTool('list_databases', {}, { connectionId: '' })).resolves.toEqual({
      ok: false,
      errorCode: 'DB_MCP_CONNECTION_REQUIRED',
      errorMessage: 'The DB AI session has no bound database connection.'
    })
  })
})
