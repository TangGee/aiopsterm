import { Worker } from 'node:worker_threads'

export type SqliteWorkerExecuteInput = {
  filePath: string
  readonly: boolean
  sql: string
  maxRows: number
  // better-sqlite3 的 busy timeout(等待数据库锁的时长上限),不是查询执行超时;
  // 长 CPU 查询仍会占住单个 worker,后续请求在 worker 消息队列里排队。
  busyTimeoutMs: number
}

export type SqliteWorkerExecuteOutcome =
  | { reader: true; columns: string[]; rows: Array<Record<string, unknown>>; truncated: boolean }
  | { reader: false; changes: number }

type SqliteWorkerResponse =
  | { id: number; ok: true; reader: true; columns: string[]; rows: Array<Record<string, unknown>>; truncated: boolean }
  | { id: number; ok: true; reader: false; changes: number }
  | { id: number; ok: false; code: string; message: string }

type PendingWorkerRequest = {
  resolve: (outcome: SqliteWorkerExecuteOutcome) => void
  reject: (error: Error) => void
}

// 用户 SQL 在 worker 线程内同步执行，主线程只做异步等待，避免长查询冻结整个应用。
// eval worker 由 electron-vite 一起打包进主进程 bundle，不需要独立的构建入口。
const SQLITE_WORKER_SOURCE = `
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const Database = require(workerData.betterSqlite3Path)
parentPort.on('message', (request) => {
  let db = null
  try {
    db = new Database(request.filePath, { readonly: request.readonly, fileMustExist: true, timeout: request.busyTimeoutMs })
    const stmt = db.prepare(request.sql)
    if (stmt.reader) {
      const columns = stmt.columns().map((column) => String((column && column.name) || '').trim()).filter(Boolean)
      const rows = []
      let truncated = false
      for (const row of stmt.iterate()) {
        if (rows.length >= request.maxRows) {
          truncated = true
          break
        }
        rows.push(row)
      }
      parentPort.postMessage({ id: request.id, ok: true, reader: true, columns, rows, truncated })
      return
    }
    const result = stmt.run()
    parentPort.postMessage({ id: request.id, ok: true, reader: false, changes: Number(result.changes || 0) })
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
const pendingRequests = new Map<number, PendingWorkerRequest>()

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

export const executeSqliteStatementInWorker = (input: SqliteWorkerExecuteInput): Promise<SqliteWorkerExecuteOutcome> =>
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
    pendingRequests.set(id, { resolve, reject })
    // 有未完成请求时保持事件循环存活，空闲时 unref 让进程可以正常退出。
    target.ref()
    target.postMessage({ id, ...input })
  })
