import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  executeSqliteStatementInWorker,
  SQLITE_WORKER_REQUEST_CANCELLED
} from '../src/shared/databaseSqliteWorkerRuntime'

describe('database SQLite worker physical cancellation', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('terminates an abortable dedicated worker and leaves the shared worker available', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aiopsterm-sqlite-worker-cancel-'))
    tempDirs.push(directory)
    const filePath = join(directory, 'cancel.sqlite3')
    const sqlite = new Database(filePath)
    sqlite.exec('CREATE TABLE health (id INTEGER PRIMARY KEY, status TEXT NOT NULL); INSERT INTO health (status) VALUES (\'ok\');')
    sqlite.close()

    const controller = new AbortController()
    const startedAt = Date.now()
    const pending = executeSqliteStatementInWorker({
      filePath,
      readonly: true,
      sql: `WITH RECURSIVE counter(value) AS (
        VALUES(0)
        UNION ALL
        SELECT value + 1 FROM counter WHERE value < 1000000000
      ) SELECT SUM(value) AS total FROM counter`,
      maxRows: 1,
      busyTimeoutMs: 5000
    }, { signal: controller.signal })

    await new Promise((resolve) => setTimeout(resolve, 150))
    controller.abort('test_cancelled')

    await expect(pending).rejects.toMatchObject({ code: SQLITE_WORKER_REQUEST_CANCELLED })
    expect(Date.now() - startedAt).toBeLessThan(2000)

    await expect(executeSqliteStatementInWorker({
      filePath,
      readonly: true,
      sql: 'SELECT status FROM health WHERE id = 1',
      maxRows: 1,
      busyTimeoutMs: 5000
    })).resolves.toMatchObject({
      reader: true,
      rows: [{ status: 'ok' }]
    })
  })
})
