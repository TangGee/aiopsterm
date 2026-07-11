import type {
  DatabaseSqlExecuteInput,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlInput,
  DatabaseTableDdlResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from './contracts/database'
import {
  databaseCatalogBackendRuntimeContext
} from './databaseCatalogBackendRuntime'
import {
  clickHouseColumnsForTable,
  clickHouseErrorCode,
  clickHouseErrorMessage,
  clickHouseExecute,
  clickHouseMutateTable,
  clickHouseMutationPlanData,
  clickHouseQueryTable,
  clickHouseTableDdl,
  isClickHouseConnection,
  isPrestoConnection,
  prestoExecute,
  prestoMutationUnsupported,
  prestoQueryTable,
  prestoTableDdl
} from './databaseHttpEngines'
import {
  databaseMutationPlanData,
  databaseMutationPlanErrorCode,
  databaseMutationPlanErrorMessage,
  inputKnownColumns
} from './databaseMutationPlanner'
import {
  isRelationalConnection,
  relationalColumnsForTable,
  relationalErrorCode,
  relationalErrorMessage,
  relationalExecute,
  relationalFallbackCode,
  relationalMutateTable,
  relationalQueryTable,
  relationalTableDdl,
  type RelationalDatabaseType
} from './databaseRelationalEngines'
import {
  normalizeSql,
  withDatabaseSqlExecutionRecord
} from './databaseSqlExecution'
import {
  mutateDatabaseSeedTable,
  planDatabaseSeedTableMutation,
  queryDatabaseSeedTable,
  resolveDatabaseSeedSqlRows,
  getDatabaseSeedTableDdl
} from './databaseSeedTableRuntime'
import {
  isRealSqliteConnection,
  sqliteExecute,
  sqliteMutationPlan,
  sqliteMutateTable,
  sqliteQueryTable,
  sqliteTableDdl
} from './databaseSqliteRuntime'
import {
  columnsForRows,
  trim
} from './databaseTableRuntime'

export {
  configureDatabaseRuntime,
  connectDatabaseConnection,
  createDatabaseCatalog,
  createDatabaseGroup,
  deleteDatabaseGroup,
  disconnectDatabaseConnection,
  listDatabaseCatalog,
  moveDatabaseConnection,
  moveDatabaseGroup,
  refreshDatabaseConnection,
  removeDatabaseConnection,
  renameDatabaseGroup,
  resetDatabaseBackendSeed,
  saveDatabaseConnection,
  testDatabaseConnection
} from './databaseCatalogBackendRuntime'

export type {
  DatabaseRuntimeConfig
} from './databaseCatalogBackendRuntime'

export async function executeDatabaseSql(input: DatabaseSqlExecuteInput): Promise<DatabaseSqlExecuteResult> {
  databaseCatalogBackendRuntimeContext.ensureStateLoaded()
  const startedAt = Date.now()
  const rawSql = trim(input.sql)
  const sql = normalizeSql(input.sql || '')
  if (!trim(input.connectionId)) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }, startedAt)
  }
  if (!rawSql) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_SQL_EMPTY', errorMessage: 'SQL is required.' }, startedAt)
  }
  if (/drop\s+database|syntax_error/i.test(sql)) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_SQL_REJECTED', errorMessage: 'Backend SQL executor rejected this statement.' }, startedAt)
  }

  const connection = databaseCatalogBackendRuntimeContext.findConnection(input.connectionId)
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return withDatabaseSqlExecutionRecord(await sqliteExecute(connection, rawSql, startedAt), startedAt)
  }
  if (!connection) {
    return withDatabaseSqlExecutionRecord({ ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }, startedAt)
  }
  if (!databaseCatalogBackendRuntimeContext.shouldUseSeedData()) {
    if (isClickHouseConnection(connection)) return withDatabaseSqlExecutionRecord(await clickHouseExecute(connection, rawSql, startedAt), startedAt)
    if (isPrestoConnection(connection)) return withDatabaseSqlExecutionRecord(await prestoExecute(connection, rawSql, startedAt), startedAt)
    if (isRelationalConnection(connection)) return withDatabaseSqlExecutionRecord(await relationalExecute(connection, rawSql, startedAt), startedAt)
    return withDatabaseSqlExecutionRecord(
      { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine execution is not wired in this aiopsterm backend yet.' },
      startedAt
    )
  }

  const resolved = resolveDatabaseSeedSqlRows(input, sql)
  if (!resolved.ok) {
    return withDatabaseSqlExecutionRecord(
      {
        ok: false,
        errorCode: resolved.errorCode,
        errorMessage: resolved.errorMessage
      },
      startedAt
    )
  }
  const rows = resolved.rows

  return withDatabaseSqlExecutionRecord(
    {
      ok: true,
      data: {
        columns: columnsForRows(rows),
        rows,
        rowCount: rows.length,
        durationMs: Math.max(1, Date.now() - startedAt)
      }
    },
    startedAt
  )
}

export async function getDatabaseTableDdl(input: DatabaseTableDdlInput): Promise<DatabaseTableDdlResult> {
  databaseCatalogBackendRuntimeContext.ensureStateLoaded()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const connection = databaseCatalogBackendRuntimeContext.findConnection(input.connectionId)
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return await sqliteTableDdl(connection, input)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!databaseCatalogBackendRuntimeContext.shouldUseSeedData()) {
    if (isClickHouseConnection(connection)) return clickHouseTableDdl(connection, input)
    if (isPrestoConnection(connection)) return prestoTableDdl(connection, input)
    if (isRelationalConnection(connection)) return relationalTableDdl(connection, input)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine DDL lookup is not wired in this aiopsterm backend yet.' }
  }

  return getDatabaseSeedTableDdl(input)
}

export async function queryDatabaseTable(input: DatabaseTableQueryInput): Promise<DatabaseTableQueryResult> {
  databaseCatalogBackendRuntimeContext.ensureStateLoaded()
  const startedAt = Date.now()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }

  const connection = databaseCatalogBackendRuntimeContext.findConnection(input.connectionId)
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return await sqliteQueryTable(connection, input, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!databaseCatalogBackendRuntimeContext.shouldUseSeedData()) {
    if (isClickHouseConnection(connection)) return clickHouseQueryTable(connection, input, startedAt)
    if (isPrestoConnection(connection)) return prestoQueryTable(connection, input, startedAt)
    if (isRelationalConnection(connection)) return relationalQueryTable(connection, input, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table query is not wired in this aiopsterm backend yet.' }
  }

  return queryDatabaseSeedTable(input, startedAt)
}

export async function planDatabaseTableMutation(input: DatabaseTableMutationPlanInput): Promise<DatabaseTableMutationPlanResult> {
  databaseCatalogBackendRuntimeContext.ensureStateLoaded()
  if (!trim(input.connectionId)) {
    return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
  }
  if (!trim(input.databaseName)) {
    return { ok: false, errorCode: 'DB_DATABASE_REQUIRED', errorMessage: 'Database name is required.' }
  }
  if (!trim(input.tableName)) {
    return { ok: false, errorCode: 'DB_TABLE_REQUIRED', errorMessage: 'Table name is required.' }
  }
  if (!Array.isArray(input.mutations)) {
    return { ok: false, errorCode: 'DB_MUTATIONS_REQUIRED', errorMessage: 'Table mutations are required.' }
  }

  const connection = databaseCatalogBackendRuntimeContext.findConnection(input.connectionId)
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    try {
      return { ok: true, data: await sqliteMutationPlan(connection, input) }
    } catch (error) {
      return {
        ok: false,
        errorCode: databaseMutationPlanErrorCode(error, 'DB_SQLITE_MUTATION_PLAN_FAILED'),
        errorMessage: databaseMutationPlanErrorMessage(error, 'SQLite table mutation planning failed.')
      }
    }
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }

  if (!databaseCatalogBackendRuntimeContext.shouldUseSeedData()) {
    if (isClickHouseConnection(connection)) {
      try {
        const columns = await clickHouseColumnsForTable(connection, input)
        if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const knownColumns = columns.map((column) => column.name)
        return { ok: true, data: clickHouseMutationPlanData(input, knownColumns.length ? knownColumns : inputKnownColumns(input)) }
      } catch (error) {
        return {
          ok: false,
          errorCode: clickHouseErrorCode(error, 'DB_CLICKHOUSE_MUTATION_PLAN_FAILED'),
          errorMessage: clickHouseErrorMessage(error, 'ClickHouse table mutation planning failed.')
        }
      }
    }
    if (isPrestoConnection(connection)) return prestoMutationUnsupported()
    if (isRelationalConnection(connection)) {
      try {
        const columns = await relationalColumnsForTable(connection, input)
        if (!columns.length && input.mutations.every((mutation) => mutation.kind !== 'drop')) {
          return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        }
        const knownColumns = columns.map((column) => column.name)
        return { ok: true, data: databaseMutationPlanData(connection, input, knownColumns.length ? knownColumns : inputKnownColumns(input)) }
      } catch (error) {
        return {
          ok: false,
          errorCode: relationalErrorCode(error, relationalFallbackCode(connection.dbType as RelationalDatabaseType, 'MUTATION_PLAN_FAILED')),
          errorMessage: relationalErrorMessage(error, 'Database table mutation planning failed.')
        }
      }
    }
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table mutation planning is not wired in this aiopsterm backend yet.' }
  }

  return planDatabaseSeedTableMutation(connection, input)
}

export async function mutateDatabaseTable(input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> {
  databaseCatalogBackendRuntimeContext.ensureStateLoaded()
  const startedAt = Date.now()
  const connection = databaseCatalogBackendRuntimeContext.findConnection(input.connectionId)
  if (connection?.dbType === 'sqlite' && isRealSqliteConnection(connection)) {
    return await sqliteMutateTable(connection, input, startedAt)
  }
  if (!connection) {
    return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  }
  if (!databaseCatalogBackendRuntimeContext.shouldUseSeedData()) {
    if (isClickHouseConnection(connection)) return clickHouseMutateTable(connection, input, startedAt)
    if (isPrestoConnection(connection)) return prestoMutationUnsupported()
    if (isRelationalConnection(connection)) return relationalMutateTable(connection, input, startedAt)
    return { ok: false, errorCode: 'DB_ENGINE_RUNTIME_UNAVAILABLE', errorMessage: 'This database engine table mutations are not wired in this aiopsterm backend yet.' }
  }

  const mutation = mutateDatabaseSeedTable(input)
  if (!mutation.ok) {
    return { ok: false, errorCode: mutation.errorCode, errorMessage: mutation.errorMessage }
  }
  databaseCatalogBackendRuntimeContext.persistState()

  return {
    ok: true,
    data: {
      affected: mutation.affected,
      durationMs: Math.max(1, Date.now() - startedAt),
      catalog: databaseCatalogBackendRuntimeContext.workspaceCatalogFor(input.connectionId)
    }
  }
}

export {
  DATABASE_AI_DRAWER_RESPONSE_MIN_DELAY_MS,
  DATABASE_AI_PANE_RESPONSE_MIN_DELAY_MS,
  cancelDatabaseAiDrawerResponse,
  cancelDatabaseAiPaneResponse,
  configureDatabaseAiRuntime,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  diagnoseDatabaseSqlError,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  getDatabaseAiPaneState,
  saveDatabaseAiPaneState,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse
} from './databaseAi'

export type {
  DatabaseAiContextLoadInput,
  DatabaseAiProviderTextInput,
  DatabaseAiProviderTextMessage,
  DatabaseAiProviderTextResult
} from './databaseAi'
