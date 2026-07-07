import { randomUUID } from 'crypto'
import type {
  DatabaseSqlExecutionRecord,
  DatabaseSqlExecuteResult
} from './contracts/database'

export type DatabaseSqlExecuteRawData = Omit<NonNullable<DatabaseSqlExecuteResult['data']>, 'execution'>

export type DatabaseSqlExecuteRawResult = {
  ok: boolean
  data?: DatabaseSqlExecuteRawData
  errorCode?: string
  errorMessage?: string
}

export const normalizeSql = (sql: string) => sql.trim().replace(/\s+/g, ' ')

const sqlExecutionTimestamp = () => new Date().toISOString()

const createDatabaseSqlExecutionRecord = (input: {
  status: DatabaseSqlExecutionRecord['status']
  message: string
  durationMs: number
  rowCount: number
}): DatabaseSqlExecutionRecord => ({
  id: `sql-exec-${randomUUID()}`,
  status: input.status,
  message: input.message,
  durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
  rowCount: Math.max(0, Math.round(Number(input.rowCount) || 0)),
  createdAt: sqlExecutionTimestamp()
})

const databaseSqlExecutionMessage = (rowCount: number, truncated: boolean) =>
  truncated
    ? `Execution OK (first ${rowCount} row${rowCount === 1 ? '' : 's'}, result truncated)`
    : `Execution OK (${rowCount} row${rowCount === 1 ? '' : 's'})`

export const withDatabaseSqlExecutionRecord = (result: DatabaseSqlExecuteRawResult, startedAt: number): DatabaseSqlExecuteResult => {
  if (result.ok && result.data) {
    const durationMs = Math.max(1, Math.round(Number(result.data.durationMs) || Date.now() - startedAt))
    const rowCount = Math.max(0, Math.round(Number(result.data.rowCount) || 0))
    const execution = createDatabaseSqlExecutionRecord({
      status: 'ok',
      message: databaseSqlExecutionMessage(rowCount, result.data.truncated === true),
      durationMs,
      rowCount
    })
    return {
      ...result,
      data: {
        ...result.data,
        durationMs,
        rowCount,
        execution
      }
    }
  }

  const durationMs = Math.max(1, Date.now() - startedAt)
  const execution = createDatabaseSqlExecutionRecord({
    status: 'error',
    message: result.errorMessage || result.errorCode || 'Database SQL execution failed.',
    durationMs,
    rowCount: 0
  })
  return {
    ok: false,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    execution
  }
}
