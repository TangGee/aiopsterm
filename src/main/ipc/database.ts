import type { IpcMain } from 'electron'
import { withClineAgentRendererOwner } from '../backend/agent/clineAgentOwnerRuntime'
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
  DatabaseAiDrawerResponseResult,
  DatabaseAiPaneLifecycleInput,
  DatabaseAiPaneRequestInput,
  DatabaseAiPaneResponseInput,
  DatabaseAiPaneResponseResult,
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
  bindProductSession?: (input: DatabaseAiPaneResponseInput, result: DatabaseAiPaneResponseResult) => Promise<void> | void
  bindDrawerProductSession?: (input: DatabaseAiDrawerResponseInput, result: DatabaseAiDrawerResponseResult) => Promise<void> | void
  syncProductSessionState?: (state: DatabaseAiPaneStateSnapshot) => void
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
  ipcMain.handle('database:ai-pane-state:save', (_event, stateInput: DatabaseAiPaneStateSnapshot) => {
    const result = saveDatabaseAiPaneState(stateInput)
    if (result.ok && result.data) input.syncProductSessionState?.(result.data)
    return result
  })
  ipcMain.handle('database:ai-pane-request', (event, requestInput: DatabaseAiPaneRequestInput) =>
    withClineAgentRendererOwner(event.sender.id, () => createDatabaseAiPaneRequest(requestInput))
  )
  ipcMain.handle('database:ai-pane-start', (event, lifecycleInput: DatabaseAiPaneLifecycleInput) =>
    withClineAgentRendererOwner(event.sender.id, () => startDatabaseAiPaneResponse(lifecycleInput))
  )
  ipcMain.handle('database:ai-pane-cancel', (event, lifecycleInput: DatabaseAiPaneLifecycleInput) =>
    withClineAgentRendererOwner(event.sender.id, () => cancelDatabaseAiPaneResponse(lifecycleInput))
  )
  ipcMain.handle('database:ai-pane-response', async (event, responseInput: DatabaseAiPaneResponseInput) => {
    const result = await withClineAgentRendererOwner(
      event.sender.id,
      () => generateDatabaseAiPaneResponse(responseInput)
    )
    await input.bindProductSession?.(responseInput, result)
    return result
  })
  ipcMain.handle('database:ai-drawer-request', (event, requestInput: DatabaseAiDrawerRequestInput) =>
    withClineAgentRendererOwner(event.sender.id, () => createDatabaseAiDrawerRequest(requestInput))
  )
  ipcMain.handle('database:ai-drawer-start', (event, lifecycleInput: DatabaseAiDrawerLifecycleInput) =>
    withClineAgentRendererOwner(event.sender.id, () => startDatabaseAiDrawerResponse(lifecycleInput))
  )
  ipcMain.handle('database:ai-drawer-cancel', (event, lifecycleInput: DatabaseAiDrawerLifecycleInput) =>
    withClineAgentRendererOwner(event.sender.id, () => cancelDatabaseAiDrawerResponse(lifecycleInput))
  )
  ipcMain.handle('database:ai-drawer-response', async (event, responseInput: DatabaseAiDrawerResponseInput) => {
    const result = await withClineAgentRendererOwner(
      event.sender.id,
      () => generateDatabaseAiDrawerResponse(responseInput)
    )
    const storedConversationId = result.data?.request.conversationId
    await input.bindDrawerProductSession?.(
      storedConversationId ? { ...responseInput, conversationId: storedConversationId } : responseInput,
      result
    )
    return result
  })
  ipcMain.handle('database:ai-diagnose-sql-error', (event, diagnosisInput: DatabaseSqlErrorDiagnosisInput) =>
    withClineAgentRendererOwner(event.sender.id, () => diagnoseDatabaseSqlError(diagnosisInput))
  )
}
