import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type FilesBridge = Pick<
  AiopsPreloadApi,
  | 'listFileSessionCatalog'
  | 'saveFileSession'
  | 'saveFileSessionFromSftpPayload'
  | 'saveFileSessionFromTerminalContext'
  | 'updateFileSession'
  | 'saveFileSessionFolder'
  | 'deleteFileSessionFolder'
  | 'cancelFileTransferTask'
  | 'listFileTransferTasks'
>

const bridgeMethod = <Name extends keyof FilesBridge>(name: Name): FilesBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as FilesBridge[Name]) : undefined
}

export const filesClient = {
  listFileSessionCatalog: () => bridgeMethod('listFileSessionCatalog'),
  saveFileSession: () => bridgeMethod('saveFileSession'),
  saveFileSessionFromSftpPayload: () => bridgeMethod('saveFileSessionFromSftpPayload'),
  saveFileSessionFromTerminalContext: () => bridgeMethod('saveFileSessionFromTerminalContext'),
  updateFileSession: () => bridgeMethod('updateFileSession'),
  saveFileSessionFolder: () => bridgeMethod('saveFileSessionFolder'),
  deleteFileSessionFolder: () => bridgeMethod('deleteFileSessionFolder'),
  cancelFileTransferTask: () => bridgeMethod('cancelFileTransferTask'),
  listFileTransferTasks: () => bridgeMethod('listFileTransferTasks')
}
