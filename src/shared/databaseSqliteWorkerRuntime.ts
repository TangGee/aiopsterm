import { Worker } from 'node:worker_threads'

export type SqliteWorkerExecuteInput = {
  filePath: string
  readonly: boolean
  sql: string
  params?: unknown[]
  maxRows: number
  // better-sqlite3 的 busy timeout(等待数据库锁的时长上限),不是查询执行超时;
  // 长 CPU 查询仍会占住单个 worker,后续请求在 worker 消息队列里排队。
  busyTimeoutMs: number
}

export type SqliteWorkerStatementInput = {
  sql: string
  params?: unknown[]
}

export type SqliteWorkerTransactionInput = {
  filePath: string
  statements: SqliteWorkerStatementInput[]
  busyTimeoutMs: number
}

export type SqliteWorkerCatalogInput = {
  filePath: string
  busyTimeoutMs: number
}

export type SqliteWorkerExecuteOutcome =
  | { reader: true; columns: string[]; rows: Array<Record<string, unknown>>; truncated: boolean }
  | { reader: false; changes: number }

export type SqliteWorkerCatalogOutcome = {
  name: string
  tables: Array<{
    id: string
    name: string
    columns: Array<{ name: string; type: string; nullable: boolean; key?: 'PK' }>
    primaryKey: string[]
  }>
}

type SqliteWorkerResponse =
  | { id: number; ok: true; reader: true; columns: string[]; rows: Array<Record<string, unknown>>; truncated: boolean }
  | { id: number; ok: true; reader: false; changes: number }
  | { id: number; ok: true; kind: 'transaction'; changes: number }
  | { id: number; ok: true; kind: 'catalog'; catalogs: SqliteWorkerCatalogOutcome[] }
  | { id: number; ok: false; code: string; message: string }

type PendingWorkerRequest<T> = {
  resolve: (outcome: T) => void
  reject: (error: Error) => void
}

type WorkerRequestKind = 'statement' | 'transaction' | 'catalog'

// SQLite 在 worker 线程内同步执行，主线程只做异步等待，避免长查询或大 schema 扫描冻结整个应用。
// eval worker 由 electron-vite 一起打包进主进程 bundle，不需要独立的构建入口。
const SQLITE_WORKER_SOURCE = `
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const Database = require(workerData.betterSqlite3Path)
const sqliteIdentifier = (value) => '"' + String(value || '').replace(/"/g, '""') + '"'
const idPart = (value) => String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-')
const primaryKeyForColumns = (columns) => columns.filter((column) => column.key === 'PK').map((column) => column.name)
const columnsForTable = (db, schemaName, tableName) => {
  const rows = db.prepare('PRAGMA ' + sqliteIdentifier(schemaName) + '.table_xinfo(' + sqliteIdentifier(tableName) + ')').all()
  return rows
    .filter((row) => String(row.name || '').trim() && Number(row.hidden || 0) !== 1)
    .sort((first, second) => Number(first.cid || 0) - Number(second.cid || 0))
    .map((row) => {
      const primaryKeyRank = Number(row.pk || 0)
      const column = {
        name: String(row.name || '').trim(),
        type: String(row.type || '').trim().toUpperCase() || 'TEXT',
        nullable: primaryKeyRank <= 0 && Number(row.notnull || 0) === 0
      }
      if (primaryKeyRank > 0) column.key = 'PK'
      return column
    })
}
const runStatement = (db, request) => {
  const stmt = db.prepare(request.sql)
  const params = Array.isArray(request.params) ? request.params : []
  if (stmt.reader) {
    const columns = stmt.columns().map((column) => String((column && column.name) || '').trim()).filter(Boolean)
    const rows = []
    let truncated = false
    for (const row of stmt.iterate(...params)) {
      if (rows.length >= request.maxRows) {
        truncated = true
        break
      }
      rows.push(row)
    }
    parentPort.postMessage({ id: request.id, ok: true, reader: true, columns, rows, truncated })
    return
  }
  const result = stmt.run(...params)
  parentPort.postMessage({ id: request.id, ok: true, reader: false, changes: Number(result.changes || 0) })
}
const runTransaction = (db, request) => {
  let changes = 0
  db.prepare('BEGIN').run()
  try {
    for (const statement of Array.isArray(request.statements) ? request.statements : []) {
      const stmt = db.prepare(statement.sql)
      const result = stmt.run(...(Array.isArray(statement.params) ? statement.params : []))
      changes += Number(result.changes || 0)
    }
    db.prepare('COMMIT').run()
    parentPort.postMessage({ id: request.id, ok: true, kind: 'transaction', changes })
  } catch (error) {
    try {
      db.prepare('ROLLBACK').run()
    } catch {}
    throw error
  }
}
const runCatalog = (db, request) => {
  const schemaName = 'main'
  const rows = db
    .prepare('SELECT name, type FROM ' + sqliteIdentifier(schemaName) + ".sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
  const tables = rows
    .filter((row) => row.type === 'table' && String(row.name || '').trim())
    .map((row) => {
      const name = String(row.name || '').trim()
      const columns = columnsForTable(db, schemaName, name)
      return {
        id: 'tbl-' + idPart(request.connectionId || 'sqlite') + '-' + idPart(name),
        name,
        columns,
        primaryKey: primaryKeyForColumns(columns)
      }
    })
  parentPort.postMessage({ id: request.id, ok: true, kind: 'catalog', catalogs: [{ name: schemaName, tables }] })
}
parentPort.on('message', (request) => {
  let db = null
  try {
    const kind = request.kind || 'statement'
    db = new Database(request.filePath, { readonly: kind !== 'transaction' && request.readonly !== false, fileMustExist: true, timeout: request.busyTimeoutMs })
    if (kind === 'transaction') runTransaction(db, request)
    else if (kind === 'catalog') runCatalog(db, request)
    else runStatement(db, request)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code || '') : ''
    parentPort.postMessage({ id: request.id, ok: false, code, message: error instanceof Error ? error.message : String(error) })
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        // 关闭失败不影响已经返回的结果。
      }
    }
  }
})
`

let worker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingWorkerRequest<unknown>>()

const sqliteWorkerError = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {})

const failAllPendingRequests = (error: Error) => {
  const pending = [...pendingRequests.values()]
  pendingRequests.clear()
  for (const request of pending) request.reject(error)
}

const resolveBetterSqlite3Path = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require.resolve('better-sqlite3')
  } catch {
    throw sqliteWorkerError('SQLite runtime is unavailable. Rebuild better-sqlite3 for the Electron runtime.', 'DB_SQLITE_DRIVER_UNAVAILABLE')
  }
}

const ensureSqliteWorker = (): Worker => {
  if (worker) return worker
  const created = new Worker(SQLITE_WORKER_SOURCE, {
    eval: true,
    workerData: { betterSqlite3Path: resolveBetterSqlite3Path() }
  })
  created.on('message', (response: SqliteWorkerResponse) => {
    const pending = pendingRequests.get(response.id)
    if (!pending) return
    pendingRequests.delete(response.id)
    if (!pendingRequests.size) created.unref()
    if (!response.ok) {
      pending.reject(sqliteWorkerError(response.message, response.code || undefined))
      return
    }
    if ('kind' in response && response.kind === 'transaction') {
      pending.resolve({ changes: response.changes })
      return
    }
    if ('kind' in response && response.kind === 'catalog') {
      pending.resolve(response.catalogs)
      return
    }
    pending.resolve(response.reader ? { reader: true, columns: response.columns, rows: response.rows, truncated: response.truncated } : { reader: false, changes: response.changes })
  })
  created.on('error', (error) => {
    if (worker === created) worker = null
    failAllPendingRequests(sqliteWorkerError(error instanceof Error ? error.message : String(error), 'DB_SQLITE_QUERY_FAILED'))
  })
  created.on('exit', () => {
    if (worker === created) worker = null
    failAllPendingRequests(sqliteWorkerError('SQLite worker exited unexpectedly.', 'DB_SQLITE_QUERY_FAILED'))
  })
  created.unref()
  worker = created
  return created
}

const requestSqliteWorker = <T>(kind: WorkerRequestKind, input: Record<string, unknown>): Promise<T> =>
  new Promise((resolve, reject) => {
    let target: Worker
    try {
      target = ensureSqliteWorker()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const id = nextRequestId
    nextRequestId += 1
    pendingRequests.set(id, { resolve: resolve as (outcome: unknown) => void, reject })
    // 有未完成请求时保持事件循环存活，空闲时 unref 让进程可以正常退出。
    target.ref()
    target.postMessage({ id, kind, ...input })
  })

export const executeSqliteStatementInWorker = (input: SqliteWorkerExecuteInput): Promise<SqliteWorkerExecuteOutcome> =>
  requestSqliteWorker<SqliteWorkerExecuteOutcome>('statement', input)

export const executeSqliteTransactionInWorker = (input: SqliteWorkerTransactionInput): Promise<{ changes: number }> =>
  requestSqliteWorker<{ changes: number }>('transaction', input)

export const loadSqliteCatalogsInWorker = (input: SqliteWorkerCatalogInput & { connectionId: string }): Promise<SqliteWorkerCatalogOutcome[]> =>
  requestSqliteWorker<SqliteWorkerCatalogOutcome[]>('catalog', input)
