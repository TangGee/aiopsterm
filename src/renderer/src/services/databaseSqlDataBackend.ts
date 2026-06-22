import { databaseClient } from '@/services/databaseClient'
import { localFilesClient } from '@/services/localFilesClient'
import type {
  DatabaseExportInput,
  DatabaseExportResult,
  DatabasePageCommentGetResult,
  DatabasePageCommentKey,
  DatabasePageCommentSaveResult,
  DatabaseSqlExecuteInput,
  DatabaseSqlExecuteResult,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryInput,
  DatabaseTableQueryResult
} from '@shared/contracts/database'
import type { LocalFileWriteResult, SaveDialogResult } from '@shared/contracts/localFiles'

const DATABASE_SQL_EXECUTOR_UNAVAILABLE_MESSAGE = 'Database SQL executor service unavailable'
const DATABASE_TABLE_QUERY_UNAVAILABLE_MESSAGE = 'Database table query service unavailable'
const DATABASE_TABLE_MUTATION_PLAN_UNAVAILABLE_MESSAGE = 'Database table mutation planner service unavailable'
const DATABASE_TABLE_MUTATION_UNAVAILABLE_MESSAGE = 'Database table mutation service unavailable'

type DatabaseSqlDataBackendDeps = {
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  errorToMessage: (error: unknown) => string
}

export type SqlSavePathResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; filePath: string }
  | { ok: false; error: string }

export type SqlFileSaveResult =
  | { ok: true; result: LocalFileWriteResult }
  | { ok: false; error: string }

export const createDatabaseSqlDataBackend = ({ bridgeErrorMessage, errorToMessage }: DatabaseSqlDataBackendDeps) => {
  async function executeSql(input: DatabaseSqlExecuteInput): Promise<DatabaseSqlExecuteResult> {
    const executeDatabaseSql = databaseClient.executeDatabaseSql()
    if (!executeDatabaseSql) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: DATABASE_SQL_EXECUTOR_UNAVAILABLE_MESSAGE }
    }
    try {
      return await executeDatabaseSql(input)
    } catch (error) {
      return { ok: false, errorCode: 'DB_SQL_EXECUTOR_FAILED', errorMessage: bridgeErrorMessage(error, 'Backend SQL executor failed.') }
    }
  }

  async function pickSqlSavePath(defaultPath: string): Promise<SqlSavePathResult> {
    const showSaveDialog = localFilesClient.showSaveDialog()
    if (!showSaveDialog) {
      return { ok: false, error: 'SQL save dialog service unavailable' }
    }
    try {
      const result: SaveDialogResult | undefined = await showSaveDialog({
        defaultPath,
        filters: [{ name: 'SQL Files', extensions: ['sql'] }]
      })
      if (!result || result.canceled || !result.filePath) return { ok: true, canceled: true }
      return { ok: true, canceled: false, filePath: result.filePath }
    } catch (error) {
      return { ok: false, error: bridgeErrorMessage(error, 'SQL save dialog failed') }
    }
  }

  async function saveSqlFile(filePath: string, content: string): Promise<SqlFileSaveResult> {
    const writeLocalFile = localFilesClient.writeLocalFile()
    if (!writeLocalFile) {
      return { ok: false, error: 'SQL file writer service unavailable' }
    }
    try {
      return { ok: true, result: await writeLocalFile(filePath, content) }
    } catch (error) {
      return { ok: false, error: bridgeErrorMessage(error, 'SQL file save failed') }
    }
  }

  function sqlFileWriterUnavailableError() {
    return localFilesClient.writeLocalFile() ? '' : 'SQL file writer service unavailable'
  }

  async function planTableMutation(input: DatabaseTableMutationPlanInput): Promise<DatabaseTableMutationPlanResult> {
    const planDatabaseTableMutation = databaseClient.planDatabaseTableMutation()
    if (!planDatabaseTableMutation) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: DATABASE_TABLE_MUTATION_PLAN_UNAVAILABLE_MESSAGE }
    }
    try {
      return await planDatabaseTableMutation(input)
    } catch (error) {
      return { ok: false, errorCode: 'DB_TABLE_MUTATION_PLAN_FAILED', errorMessage: errorToMessage(error) }
    }
  }

  async function mutateTable(input: DatabaseTableMutationInput): Promise<DatabaseTableMutationResult> {
    const mutateDatabaseTable = databaseClient.mutateDatabaseTable()
    if (!mutateDatabaseTable) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: DATABASE_TABLE_MUTATION_UNAVAILABLE_MESSAGE }
    }
    try {
      return await mutateDatabaseTable(input)
    } catch (error) {
      return { ok: false, errorCode: 'DB_TABLE_MUTATION_FAILED', errorMessage: bridgeErrorMessage(error, 'Backend table mutation failed.') }
    }
  }

  async function exportRows(input: DatabaseExportInput): Promise<DatabaseExportResult> {
    const exportDatabaseRows = databaseClient.exportDatabaseRows()
    if (!exportDatabaseRows) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database export service unavailable' }
    }
    try {
      return await exportDatabaseRows(input)
    } catch (error) {
      return { ok: false, errorCode: 'DB_EXPORT_FAILED', errorMessage: errorToMessage(error) }
    }
  }

  async function getPageComment(key: DatabasePageCommentKey): Promise<DatabasePageCommentGetResult> {
    const getDatabasePageComment = databaseClient.getDatabasePageComment()
    if (!getDatabasePageComment) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database comment service unavailable' }
    }
    try {
      return await getDatabasePageComment(key)
    } catch (error) {
      return { ok: false, errorCode: 'DB_COMMENT_LOAD_FAILED', errorMessage: bridgeErrorMessage(error, 'Database comment load failed') }
    }
  }

  async function savePageComment(key: DatabasePageCommentKey, comment: string): Promise<DatabasePageCommentSaveResult> {
    const saveDatabasePageComment = databaseClient.saveDatabasePageComment()
    if (!saveDatabasePageComment) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database comment service unavailable' }
    }
    try {
      return await saveDatabasePageComment({ key, comment })
    } catch (error) {
      return { ok: false, errorCode: 'DB_COMMENT_SAVE_FAILED', errorMessage: bridgeErrorMessage(error, 'Database comment save failed') }
    }
  }

  async function queryTable(input: DatabaseTableQueryInput): Promise<DatabaseTableQueryResult> {
    const queryDatabaseTable = databaseClient.queryDatabaseTable()
    if (!queryDatabaseTable) {
      return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: DATABASE_TABLE_QUERY_UNAVAILABLE_MESSAGE }
    }
    try {
      return await queryDatabaseTable(input)
    } catch (error) {
      return { ok: false, errorCode: 'DB_TABLE_QUERY_FAILED', errorMessage: bridgeErrorMessage(error, 'Backend table query failed.') }
    }
  }

  return {
    executeSql,
    pickSqlSavePath,
    saveSqlFile,
    sqlFileWriterUnavailableError,
    planTableMutation,
    mutateTable,
    exportRows,
    getPageComment,
    savePageComment,
    queryTable
  }
}
