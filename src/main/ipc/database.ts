import type { IpcMain } from 'electron'
import {
  cancelDatabaseAiDrawerResponse,
  cancelDatabaseAiPaneResponse,
  connectDatabaseConnection,
  createDatabaseAiDrawerRequest,
  createDatabaseAiPaneRequest,
  createDatabaseCatalog,
  createDatabaseGroup,
  deleteDatabaseGroup,
  diagnoseDatabaseSqlError,
  disconnectDatabaseConnection,
  executeDatabaseSql,
  generateDatabaseAiDrawerResponse,
  generateDatabaseAiPaneResponse,
  getDatabaseAiPaneState,
  getDatabaseTableDdl,
  listDatabaseCatalog,
  moveDatabaseConnection,
  moveDatabaseGroup,
  mutateDatabaseTable,
  planDatabaseTableMutation,
  queryDatabaseTable,
  refreshDatabaseConnection,
  removeDatabaseConnection,
  renameDatabaseGroup,
  saveDatabaseAiPaneState,
  saveDatabaseConnection,
  startDatabaseAiDrawerResponse,
  startDatabaseAiPaneResponse,
  testDatabaseConnection
} from '../backend/database/database'
import { getDatabasePageComment, saveDatabasePageComment } from '../backend/database/databaseComments'
import { exportDatabaseRows } from '../backend/database/databaseExport'
import type {
  DatabaseAiDrawerLifecycleInput,
  DatabaseAiDrawerRequestInput,
  DatabaseAiDrawerResponseInput,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneStateSnapshot,
  DatabaseConnectionMoveInput,
  DatabaseConnectionSaveInput,
  DatabaseConnectionTestInput,
  DatabaseCreateDatabaseInput,
  DatabaseExportInput,
  DatabaseGroupCreateInput,
  DatabaseGroupUpdateInput,
  DatabasePageCommentKey,
  DatabasePageCommentSaveInput,
  DatabaseSqlErrorDiagnosisInput,
  DatabaseSqlExecuteInput,
  DatabaseTableDdlInput,
  DatabaseTableMutationInput,
  DatabaseTableMutationPlanInput,
  DatabaseTableQueryInput
} from '@shared/contracts/database'

type RegisterDatabaseIpcInput = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
}

export const registerDatabaseIpc = (ipcMain: IpcMain, input: RegisterDatabaseIpcInput) => {
  ipcMain.handle('database:catalog', () => listDatabaseCatalog())
  ipcMain.handle('database:test-connection', (_event, testInput: DatabaseConnectionTestInput) => testDatabaseConnection(testInput))
  ipcMain.handle('database:save-connection', (_event, saveInput: DatabaseConnectionSaveInput) => saveDatabaseConnection(saveInput))
  ipcMain.handle('database:group:create', (_event, groupInput: DatabaseGroupCreateInput) => createDatabaseGroup(groupInput))
  ipcMain.handle('database:group:rename', (_event, groupInput: DatabaseGroupUpdateInput) => renameDatabaseGroup(groupInput))
  ipcMain.handle('database:group:move', (_event, groupInput: DatabaseGroupUpdateInput) => moveDatabaseGroup(groupInput))
  ipcMain.handle('database:group:delete', (_event, id: string) => deleteDatabaseGroup(id))
  ipcMain.handle('database:connection:move', (_event, moveInput: DatabaseConnectionMoveInput) => moveDatabaseConnection(moveInput))
  ipcMain.handle('database:connection:remove', (_event, connectionId: string) => removeDatabaseConnection(connectionId))
  ipcMain.handle('database:connection:connect', (_event, connectionId: string) => connectDatabaseConnection(connectionId))
  ipcMain.handle('database:connection:disconnect', (_event, connectionId: string) => disconnectDatabaseConnection(connectionId))
  ipcMain.handle('database:connection:refresh', (_event, connectionId: string) => refreshDatabaseConnection(connectionId))
  ipcMain.handle('database:create-database', (_event, createInput: DatabaseCreateDatabaseInput) => createDatabaseCatalog(createInput))
  ipcMain.handle('database:execute-sql', (_event, sqlInput: DatabaseSqlExecuteInput) => executeDatabaseSql(sqlInput))
  ipcMain.handle('database:table-ddl', (_event, ddlInput: DatabaseTableDdlInput) => getDatabaseTableDdl(ddlInput))
  ipcMain.handle('database:query-table', (_event, queryInput: DatabaseTableQueryInput) => queryDatabaseTable(queryInput))
  ipcMain.handle('database:mutation-plan', (_event, mutationInput: DatabaseTableMutationPlanInput) => planDatabaseTableMutation(mutationInput))
  ipcMain.handle('database:mutate-table', (_event, mutationInput: DatabaseTableMutationInput) => mutateDatabaseTable(mutationInput))
  ipcMain.handle('database:export-rows', (_event, exportInput: DatabaseExportInput) => exportDatabaseRows(exportInput, { showSaveDialog: input.showSaveDialog }))
  ipcMain.handle('database:comment:get', (_event, commentInput: DatabasePageCommentKey) => getDatabasePageComment(commentInput))
  ipcMain.handle('database:comment:save', (_event, commentInput: DatabasePageCommentSaveInput) => saveDatabasePageComment(commentInput))
  ipcMain.handle('database:ai-pane-state:get', () => getDatabaseAiPaneState())
  ipcMain.handle('database:ai-pane-state:save', (_event, stateInput: DatabaseAiPaneStateSnapshot) => saveDatabaseAiPaneState(stateInput))
  ipcMain.handle('database:ai-pane-request', (_event, requestInput: DatabaseAiPaneRequestInput) => createDatabaseAiPaneRequest(requestInput))
  ipcMain.handle('database:ai-pane-start', (_event, lifecycleInput: DatabaseAiPaneLifecycleInput) => startDatabaseAiPaneResponse(lifecycleInput))
  ipcMain.handle('database:ai-pane-cancel', (_event, lifecycleInput: DatabaseAiPaneLifecycleInput) => cancelDatabaseAiPaneResponse(lifecycleInput))
  ipcMain.handle('database:ai-pane-response', (_event, responseInput: DatabaseAiPaneResponseInput) => generateDatabaseAiPaneResponse(responseInput))
  ipcMain.handle('database:ai-drawer-request', (_event, requestInput: DatabaseAiDrawerRequestInput) => createDatabaseAiDrawerRequest(requestInput))
  ipcMain.handle('database:ai-drawer-start', (_event, lifecycleInput: DatabaseAiDrawerLifecycleInput) => startDatabaseAiDrawerResponse(lifecycleInput))
  ipcMain.handle('database:ai-drawer-cancel', (_event, lifecycleInput: DatabaseAiDrawerLifecycleInput) => cancelDatabaseAiDrawerResponse(lifecycleInput))
  ipcMain.handle('database:ai-drawer-response', (_event, responseInput: DatabaseAiDrawerResponseInput) => generateDatabaseAiDrawerResponse(responseInput))
  ipcMain.handle('database:ai-diagnose-sql-error', (_event, diagnosisInput: DatabaseSqlErrorDiagnosisInput) => diagnoseDatabaseSqlError(diagnosisInput))
}
