import { existsSync } from 'fs'
import type {
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult
} from './contracts/database'
import {
  clickHouseEndpointFor,
  clickHouseErrorCode,
  clickHouseErrorMessage,
  clickHouseQueryJson,
  prestoEndpointFor,
  prestoErrorCode,
  prestoErrorMessage,
  prestoQuery
} from './databaseHttpEngines'
import {
  testRelationalDatabaseConnection
} from './databaseRelationalEngines'
import {
  databaseEngineVersions,
  supportedDatabaseEngines
} from './databaseSeedData'
import {
  isSqliteFileExtension,
  openSqliteDatabase,
  sqliteErrorCode,
  sqliteErrorMessage,
  sqliteFilePathFromTestInput,
  sqlitePathFromUrl,
  type SqliteDatabase
} from './databaseSqliteRuntime'
import { trim } from './databaseTableRuntime'

type DatabaseConnectionTestRuntimeDeps = {
  shouldUseSeedData: () => boolean
}

const databaseProxyRequested = (input: Pick<DatabaseConnectionTestInput, 'needProxy' | 'proxyName'>) => !!input.needProxy || !!trim(input.proxyName)

const databaseProxyUnsupportedFor = (dbType: DatabaseConnectionTestInput['dbType']) => {
  if (dbType === 'oracle') {
    return {
      errorCode: 'DB_PROXY_ORACLE_UNSUPPORTED',
      errorMessage: 'Database SSH proxy is not supported for Oracle connect strings in this version.'
    }
  }
  if (dbType === 'clickhouse') {
    return {
      errorCode: 'DB_PROXY_CLICKHOUSE_UNSUPPORTED',
      errorMessage: 'Database SSH proxy is not supported for ClickHouse HTTP connections in this version.'
    }
  }
  if (dbType === 'presto') {
    return {
      errorCode: 'DB_PROXY_PRESTO_UNSUPPORTED',
      errorMessage: 'Database SSH proxy is not supported for Presto HTTP connections in this version.'
    }
  }
  return null
}

const rowValue = (row: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
    const found = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase())
    if (found) return row[found]
  }
  return undefined
}

const endpointFor = (input: DatabaseConnectionTestInput) => {
  if (input.dbType === 'sqlite') return trim(input.filePath) || sqlitePathFromUrl(trim(input.url))
  if (input.dbType === 'oracle' && trim(input.url)) return trim(input.url)
  if (input.dbType === 'presto') return prestoEndpointFor(input)
  const host = trim(input.host)
  const port = typeof input.port === 'number' && Number.isFinite(input.port) ? input.port : null
  return port ? `${host}:${port}` : host
}

export const connectionUsesDatabaseProxy = databaseProxyRequested

export const testDatabaseConnectionRuntime = async (
  input: DatabaseConnectionTestInput,
  deps: DatabaseConnectionTestRuntimeDeps
): Promise<DatabaseConnectionTestResult> => {
  const startedAt = Date.now()
  if (!supportedDatabaseEngines.has(input.dbType)) {
    return { ok: false, errorCode: 'DB_UNSUPPORTED_ENGINE', errorMessage: `Unsupported database engine: ${input.dbType}` }
  }

  if (!trim(input.name)) {
    return { ok: false, errorCode: 'DB_CONNECTION_NAME_REQUIRED', errorMessage: 'Connection name is required.' }
  }

  if (input.dbType === 'sqlite') {
    const filePath = sqliteFilePathFromTestInput(input)
    if (!filePath) {
      return { ok: false, errorCode: 'DB_SQLITE_FILE_REQUIRED', errorMessage: 'SQLite file path is required.' }
    }
    if (!isSqliteFileExtension(filePath)) {
      return { ok: false, errorCode: 'DB_SQLITE_EXTENSION', errorMessage: 'SQLite file should end with .db, .sqlite, or .sqlite3.' }
    }
    if (!existsSync(filePath)) {
      return { ok: false, errorCode: 'DB_SQLITE_FILE_NOT_FOUND', errorMessage: 'SQLite file does not exist.' }
    }
    let db: SqliteDatabase | null = null
    try {
      db = openSqliteDatabase(filePath, input.readonly !== false)
      const rows = db.prepare('SELECT sqlite_version() AS version').all()
      const version = String(rows[0]?.version ?? '').trim()
      return {
        ok: true,
        data: {
          dbType: input.dbType,
          serverVersion: version ? `SQLite ${version}` : databaseEngineVersions.sqlite,
          endpoint: endpointFor(input),
          durationMs: Math.max(1, Date.now() - startedAt)
        }
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: sqliteErrorCode(error, 'DB_SQLITE_OPEN_FAILED'),
        errorMessage: sqliteErrorMessage(error, 'SQLite connection test failed.')
      }
    } finally {
      db?.close()
    }
  } else {
    const hasOracleConnectString = input.dbType === 'oracle' && !!trim(input.url)
    if (hasOracleConnectString && !/(jdbc:oracle|:\/\/|:)/i.test(trim(input.url))) {
      return { ok: false, errorCode: 'DB_ORACLE_CONNECT_STRING', errorMessage: 'Oracle connect string is not valid enough for backend validation.' }
    }
    if (!hasOracleConnectString) {
      if (!trim(input.host)) {
        return { ok: false, errorCode: 'DB_HOST_REQUIRED', errorMessage: 'Database host is required.' }
      }
      if (typeof input.port !== 'number' || !Number.isFinite(input.port) || input.port <= 0) {
        return { ok: false, errorCode: 'DB_PORT_REQUIRED', errorMessage: 'Database port is required.' }
      }
    }
    if (!trim(input.user)) {
      return { ok: false, errorCode: 'DB_USER_REQUIRED', errorMessage: 'Database user is required.' }
    }
    if (databaseProxyRequested(input) && !trim(input.proxyName)) {
      return { ok: false, errorCode: 'DB_PROXY_REQUIRED', errorMessage: 'Database SSH proxy name is required.' }
    }
    if (databaseProxyRequested(input)) {
      const unsupported = databaseProxyUnsupportedFor(input.dbType)
      if (unsupported) return { ok: false, ...unsupported }
    }
  }

  if (!deps.shouldUseSeedData()) {
    if (input.dbType === 'clickhouse') {
      try {
        const result = await clickHouseQueryJson<{ version?: string }>(input, 'SELECT version() AS version', trim(input.database))
        const version = trim(rowValue(result.rows[0] ?? {}, 'version', 'VERSION'))
        return {
          ok: true,
          data: {
            dbType: 'clickhouse',
            serverVersion: version ? `ClickHouse ${version}` : 'ClickHouse',
            endpoint: clickHouseEndpointFor(input),
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      } catch (error) {
        return {
          ok: false,
          errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_CONNECTION_FAILED'),
          errorMessage: clickHouseErrorMessage(error, 'ClickHouse connection failed.')
        }
      }
    }
    if (input.dbType === 'presto') {
      try {
        const result = await prestoQuery<{ version?: string }>(input, 'SELECT node_version AS version FROM system.runtime.nodes LIMIT 1', {
          databaseName: trim(input.database),
          schemaName: ''
        })
        const version = trim(rowValue(result.rows[0] ?? {}, 'version', 'VERSION'))
        return {
          ok: true,
          data: {
            dbType: 'presto',
            serverVersion: version ? `Presto ${version}` : 'Presto',
            endpoint: prestoEndpointFor(input),
            durationMs: Math.max(1, Date.now() - startedAt)
          }
        }
      } catch (error) {
        return {
          ok: false,
          errorCode: prestoErrorCode(error, 'DB_PRESTO_CONNECTION_FAILED'),
          errorMessage: prestoErrorMessage(error, 'Presto connection failed.')
        }
      }
    }
    return testRelationalDatabaseConnection(input, startedAt)
  }

  return {
    ok: true,
    data: {
      dbType: input.dbType,
      serverVersion: databaseEngineVersions[input.dbType],
      endpoint: endpointFor(input),
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}
