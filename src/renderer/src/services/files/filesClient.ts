import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type FilesBridge = Pick<
  AiopsPreloadApi,
  | 'listFileSessionCatalog'
  | 'saveFileSession'
  | 'saveFileSessionFromSftpPayload'
  | 'saveFileSessionFromTerminalContext'
  | 'updateFileSession'
  | 'saveFileSessionFolder'
  | 'deleteFileSessionFolder'
  | 'listFiles'
  | 'readFileContent'
  | 'writeFileContent'
  | 'mutateFileEntry'
  | 'transferFileEntry'
  | 'cancelFileTransferTask'
  | 'listFileTransferTasks'
>

const bridgeMethod = createBridgeMethod<FilesBridge>()

export const filesClient = {
  listFileSessionCatalog: () => bridgeMethod('listFileSessionCatalog'),
  saveFileSession: () => bridgeMethod('saveFileSession'),
  saveFileSessionFromSftpPayload: () => bridgeMethod('saveFileSessionFromSftpPayload'),
  saveFileSessionFromTerminalContext: () => bridgeMethod('saveFileSessionFromTerminalContext'),
  updateFileSession: () => bridgeMethod('updateFileSession'),
  saveFileSessionFolder: () => bridgeMethod('saveFileSessionFolder'),
  deleteFileSessionFolder: () => bridgeMethod('deleteFileSessionFolder'),
  listFiles: () => bridgeMethod('listFiles'),
  readFileContent: () => bridgeMethod('readFileContent'),
  writeFileContent: () => bridgeMethod('writeFileContent'),
  mutateFileEntry: () => bridgeMethod('mutateFileEntry'),
  transferFileEntry: () => bridgeMethod('transferFileEntry'),
  cancelFileTransferTask: () => bridgeMethod('cancelFileTransferTask'),
  listFileTransferTasks: () => bridgeMethod('listFileTransferTasks')
}
