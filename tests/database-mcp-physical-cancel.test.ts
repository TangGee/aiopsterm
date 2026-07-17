import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  configureDatabaseRuntime,
  resetDatabaseBackendSeed,
  saveDatabaseConnection
} from '../src/shared/databaseRuntime'

let callBoundDatabaseAiMcpTool: (
  name: string,
  args: Record<string, unknown>,
  binding: { connectionId: string; databaseName?: string; schemaName?: string },
  options?: { signal?: AbortSignal }
) => Promise<any>

beforeAll(async () => {
  const modulePath = '../src/main/backend/database/databaseMcp'
  ;({ callBoundDatabaseAiMcpTool } = await import(modulePath))
})

describe('DB AI MCP production SQLite cancellation', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    resetDatabaseBackendSeed()
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('physically cancels every bound SQLite read adapter without exhausting the read channel', async () => {
    resetDatabaseBackendSeed()
    const directory = await mkdtemp(join(tmpdir(), 'aiopsterm-db-mcp-cancel-'))
    tempDirs.push(directory)
    const filePath = join(directory, 'cancel.sqlite3')
    const sqlite = new Database(filePath)
    sqlite.exec(`
      CREATE TABLE metrics (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX idx_metrics_value ON metrics(value);
      INSERT INTO metrics (value) VALUES ('healthy');
    `)
    sqlite.close()

    configureDatabaseRuntime({
      useSeedData: false,
      stateFilePath: join(directory, 'database-workspace.json'),
      credentialKeyPath: join(directory, 'database-credentials.key')
    })
    const saved = await saveDatabaseConnection({
      mode: 'create',
      connection: {
        dbType: 'sqlite',
        name: 'physical-cancel-sqlite',
        filePath,
        readonly: true,
        env: 'Development',
        groupId: 'group-local',
        authentication: 'UserAndPassword'
      }
    })
    expect(saved.ok).toBe(true)
    const connectionId = saved.data?.connection.id || ''
    const binding = { connectionId, databaseName: 'main' }

    const lock = new Database(filePath)
    lock.exec('BEGIN EXCLUSIVE')
    try {
      const reads = [
        { name: 'get_database_table_ddl', args: { tableName: 'metrics' } },
        { name: 'sample_rows', args: { tableName: 'metrics', columns: ['id'], limit: 1 } },
        { name: 'inspect_indexes', args: { tableName: 'metrics' } },
        {
          name: 'explain_plan',
          args: { tableName: 'metrics', columns: ['id'], filters: [], sort: { column: 'id', direction: 'asc' } }
        }
      ]

      for (const read of reads) {
        for (let cycle = 0; cycle < 9; cycle += 1) {
          const controller = new AbortController()
          const pending = callBoundDatabaseAiMcpTool(read.name, read.args, binding, { signal: controller.signal })
          setTimeout(() => controller.abort(`cycle_${cycle}_${read.name}`), 75)
          await expect(pending).resolves.toMatchObject({
            ok: false,
            errorCode: 'DB_MCP_REQUEST_CANCELLED'
          })
        }
      }
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(callBoundDatabaseAiMcpTool(
      'get_database_table_ddl',
      { tableName: 'metrics' },
      binding
    )).resolves.toMatchObject({ ok: true, data: { ddl: expect.stringContaining('CREATE TABLE metrics') } })
  })
})
