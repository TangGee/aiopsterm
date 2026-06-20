import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type DatabaseBridge = Pick<
  AiopsPreloadApi,
  | 'listDatabaseCatalog'
  | 'testDatabaseConnection'
  | 'saveDatabaseConnection'
  | 'createDatabaseGroup'
  | 'renameDatabaseGroup'
  | 'moveDatabaseGroup'
  | 'deleteDatabaseGroup'
  | 'moveDatabaseConnection'
  | 'removeDatabaseConnection'
  | 'connectDatabaseConnection'
  | 'disconnectDatabaseConnection'
  | 'refreshDatabaseConnection'
  | 'createDatabaseCatalog'
  | 'executeDatabaseSql'
  | 'getDatabaseTableDdl'
  | 'queryDatabaseTable'
  | 'planDatabaseTableMutation'
  | 'mutateDatabaseTable'
  | 'exportDatabaseRows'
  | 'getDatabasePageComment'
  | 'saveDatabasePageComment'
  | 'getDatabaseAiPaneState'
  | 'saveDatabaseAiPaneState'
  | 'createDatabaseAiPaneRequest'
  | 'startDatabaseAiPaneResponse'
  | 'cancelDatabaseAiPaneResponse'
  | 'generateDatabaseAiPaneResponse'
  | 'createDatabaseAiDrawerRequest'
  | 'startDatabaseAiDrawerResponse'
  | 'cancelDatabaseAiDrawerResponse'
  | 'generateDatabaseAiDrawerResponse'
  | 'diagnoseDatabaseSqlError'
>

const bridgeMethod = <Name extends keyof DatabaseBridge>(name: Name): DatabaseBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as DatabaseBridge[Name]) : undefined
}

export const databaseClient = {
  listDatabaseCatalog: () => bridgeMethod('listDatabaseCatalog'),
  testDatabaseConnection: () => bridgeMethod('testDatabaseConnection'),
  saveDatabaseConnection: () => bridgeMethod('saveDatabaseConnection'),
  createDatabaseGroup: () => bridgeMethod('createDatabaseGroup'),
  renameDatabaseGroup: () => bridgeMethod('renameDatabaseGroup'),
  moveDatabaseGroup: () => bridgeMethod('moveDatabaseGroup'),
  deleteDatabaseGroup: () => bridgeMethod('deleteDatabaseGroup'),
  moveDatabaseConnection: () => bridgeMethod('moveDatabaseConnection'),
  removeDatabaseConnection: () => bridgeMethod('removeDatabaseConnection'),
  connectDatabaseConnection: () => bridgeMethod('connectDatabaseConnection'),
  disconnectDatabaseConnection: () => bridgeMethod('disconnectDatabaseConnection'),
  refreshDatabaseConnection: () => bridgeMethod('refreshDatabaseConnection'),
  createDatabaseCatalog: () => bridgeMethod('createDatabaseCatalog'),
  executeDatabaseSql: () => bridgeMethod('executeDatabaseSql'),
  getDatabaseTableDdl: () => bridgeMethod('getDatabaseTableDdl'),
  queryDatabaseTable: () => bridgeMethod('queryDatabaseTable'),
  planDatabaseTableMutation: () => bridgeMethod('planDatabaseTableMutation'),
  mutateDatabaseTable: () => bridgeMethod('mutateDatabaseTable'),
  exportDatabaseRows: () => bridgeMethod('exportDatabaseRows'),
  getDatabasePageComment: () => bridgeMethod('getDatabasePageComment'),
  saveDatabasePageComment: () => bridgeMethod('saveDatabasePageComment'),
  getDatabaseAiPaneState: () => bridgeMethod('getDatabaseAiPaneState'),
  saveDatabaseAiPaneState: () => bridgeMethod('saveDatabaseAiPaneState'),
  createDatabaseAiPaneRequest: () => bridgeMethod('createDatabaseAiPaneRequest'),
  startDatabaseAiPaneResponse: () => bridgeMethod('startDatabaseAiPaneResponse'),
  cancelDatabaseAiPaneResponse: () => bridgeMethod('cancelDatabaseAiPaneResponse'),
  generateDatabaseAiPaneResponse: () => bridgeMethod('generateDatabaseAiPaneResponse'),
  createDatabaseAiDrawerRequest: () => bridgeMethod('createDatabaseAiDrawerRequest'),
  startDatabaseAiDrawerResponse: () => bridgeMethod('startDatabaseAiDrawerResponse'),
  cancelDatabaseAiDrawerResponse: () => bridgeMethod('cancelDatabaseAiDrawerResponse'),
  generateDatabaseAiDrawerResponse: () => bridgeMethod('generateDatabaseAiDrawerResponse'),
  diagnoseDatabaseSqlError: () => bridgeMethod('diagnoseDatabaseSqlError')
}
