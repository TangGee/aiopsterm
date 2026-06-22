import { databaseClient } from '@/services/databaseClient'
import {
  normalizeTableDdlResult,
  type TableDdlResult
} from '@/services/databaseWorkspaceRuntime'
import type {
  DatabaseConnectionDeleteResult,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseCreateDatabaseResult,
  DatabaseEngineCode,
  DatabaseGroupCreateInput,
  DatabaseGroupDeleteResult,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput
} from '@shared/contracts/database'

type DdlInput = {
  connectionId: string
  dbType?: DatabaseEngineCode
  catalogName: string
  schemaName?: string
  tableName: string
}

type DatabaseCatalogConnectionBackendDeps = {
  errorToMessage: (error: unknown) => string
}

export const createDatabaseCatalogConnectionBackend = ({ errorToMessage }: DatabaseCatalogConnectionBackendDeps) => {
  async function testConnection(input: DatabaseConnectionTestInput): Promise<DatabaseConnectionTestResult> {
    const testDatabaseConnection = databaseClient.testDatabaseConnection()
    if (!testDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection test API is unavailable.' }
    }
    return testDatabaseConnection(input)
  }

  async function saveConnection(input: DatabaseConnectionSaveInput): Promise<DatabaseConnectionSaveResult> {
    const saveDatabaseConnection = databaseClient.saveDatabaseConnection()
    if (!saveDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection save API is unavailable.' }
    }
    return saveDatabaseConnection(input)
  }

  async function createGroup(input: DatabaseGroupCreateInput): Promise<DatabaseGroupMutationResult> {
    const createDatabaseGroup = databaseClient.createDatabaseGroup()
    if (!createDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group create API is unavailable.' }
    }
    return createDatabaseGroup(input)
  }

  async function renameGroup(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
    const renameDatabaseGroup = databaseClient.renameDatabaseGroup()
    if (!renameDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group rename API is unavailable.' }
    }
    return renameDatabaseGroup(input)
  }

  async function moveGroup(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
    const moveDatabaseGroup = databaseClient.moveDatabaseGroup()
    if (!moveDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group move API is unavailable.' }
    }
    return moveDatabaseGroup(input)
  }

  async function deleteGroup(id: string): Promise<DatabaseGroupDeleteResult> {
    const deleteDatabaseGroup = databaseClient.deleteDatabaseGroup()
    if (!deleteDatabaseGroup) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group delete API is unavailable.' }
    }
    return deleteDatabaseGroup(id)
  }

  async function moveConnection(input: DatabaseConnectionMoveInput): Promise<DatabaseConnectionMutationResult> {
    const moveDatabaseConnection = databaseClient.moveDatabaseConnection()
    if (!moveDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection move API is unavailable.' }
    }
    return moveDatabaseConnection(input)
  }

  async function removeConnection(connectionId: string): Promise<DatabaseConnectionDeleteResult> {
    const removeDatabaseConnection = databaseClient.removeDatabaseConnection()
    if (!removeDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection remove API is unavailable.' }
    }
    return removeDatabaseConnection(connectionId)
  }

  async function connectConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    const connectDatabaseConnection = databaseClient.connectDatabaseConnection()
    if (!connectDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection API is unavailable.' }
    }
    return connectDatabaseConnection(connectionId)
  }

  async function disconnectConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    const disconnectDatabaseConnection = databaseClient.disconnectDatabaseConnection()
    if (!disconnectDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database disconnect API is unavailable.' }
    }
    return disconnectDatabaseConnection(connectionId)
  }

  async function refreshConnection(connectionId: string): Promise<DatabaseConnectionMutationResult> {
    const refreshDatabaseConnection = databaseClient.refreshDatabaseConnection()
    if (!refreshDatabaseConnection) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database refresh API is unavailable.' }
    }
    return refreshDatabaseConnection(connectionId)
  }

  async function createDatabase(connectionId: string, sql: string, requestedName: string): Promise<DatabaseCreateDatabaseResult> {
    const createDatabaseCatalog = databaseClient.createDatabaseCatalog()
    if (!createDatabaseCatalog) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database create API is unavailable.' }
    }
    return createDatabaseCatalog({ connectionId, sql, requestedName })
  }

  async function fetchTableDdl(input: DdlInput): Promise<TableDdlResult> {
    const getTableDdl = databaseClient.getDatabaseTableDdl()
    if (!getTableDdl) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database DDL API is unavailable.' }
    }
    try {
      const result = await getTableDdl({
        connectionId: input.connectionId,
        dbType: input.dbType,
        databaseName: input.catalogName,
        schemaName: input.schemaName,
        tableName: input.tableName
      })
      return normalizeTableDdlResult(result)
    } catch (error) {
      return { ok: false, errorCode: 'other', errorMessage: errorToMessage(error) }
    }
  }

  return {
    testConnection,
    saveConnection,
    createGroup,
    renameGroup,
    moveGroup,
    deleteGroup,
    moveConnection,
    removeConnection,
    connectConnection,
    disconnectConnection,
    refreshConnection,
    createDatabase,
    fetchTableDdl
  }
}
