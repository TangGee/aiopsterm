import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type LocalFilesBridge = Pick<
  AiopsPreloadApi,
  | 'getPathForFile'
  | 'showOpenDialog'
  | 'showSaveDialog'
  | 'saveCustomBackground'
  | 'readLocalFile'
  | 'writeLocalFile'
  | 'stageChatAttachment'
  | 'validateChatImageAttachment'
  | 'prepareChatImageAttachment'
  | 'prepareChatImageAttachmentFromFile'
  | 'prepareChatImageAttachmentFromClipboard'
>

const bridgeMethod = createBridgeMethod<LocalFilesBridge>()

export const localFilesClient = {
  getPathForFile: () => bridgeMethod('getPathForFile'),
  showOpenDialog: () => bridgeMethod('showOpenDialog'),
  showSaveDialog: () => bridgeMethod('showSaveDialog'),
  saveCustomBackground: () => bridgeMethod('saveCustomBackground'),
  readLocalFile: () => bridgeMethod('readLocalFile'),
  writeLocalFile: () => bridgeMethod('writeLocalFile'),
  stageChatAttachment: () => bridgeMethod('stageChatAttachment'),
  validateChatImageAttachment: () => bridgeMethod('validateChatImageAttachment'),
  prepareChatImageAttachment: () => bridgeMethod('prepareChatImageAttachment'),
  prepareChatImageAttachmentFromFile: () => bridgeMethod('prepareChatImageAttachmentFromFile'),
  prepareChatImageAttachmentFromClipboard: () => bridgeMethod('prepareChatImageAttachmentFromClipboard')
}
