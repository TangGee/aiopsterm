import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type LocalFilesBridge = Pick<
  AiopsPreloadApi,
  | 'getPathForFile'
  | 'showOpenDialog'
  | 'showSaveDialog'
  | 'saveCustomBackground'
  | 'saveCustomNotificationSound'
  | 'readLocalFile'
  | 'writeLocalFile'
  | 'readLocalEditorFile'
  | 'writeLocalEditorFile'
  | 'startLocalEditorFileWatch'
  | 'stopLocalEditorFileWatch'
  | 'onLocalEditorFileWatchEvent'
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
  saveCustomNotificationSound: () => bridgeMethod('saveCustomNotificationSound'),
  readLocalFile: () => bridgeMethod('readLocalFile'),
  writeLocalFile: () => bridgeMethod('writeLocalFile'),
  readLocalEditorFile: () => bridgeMethod('readLocalEditorFile'),
  writeLocalEditorFile: () => bridgeMethod('writeLocalEditorFile'),
  startLocalEditorFileWatch: () => bridgeMethod('startLocalEditorFileWatch'),
  stopLocalEditorFileWatch: () => bridgeMethod('stopLocalEditorFileWatch'),
  onLocalEditorFileWatchEvent: () => bridgeMethod('onLocalEditorFileWatchEvent'),
  stageChatAttachment: () => bridgeMethod('stageChatAttachment'),
  validateChatImageAttachment: () => bridgeMethod('validateChatImageAttachment'),
  prepareChatImageAttachment: () => bridgeMethod('prepareChatImageAttachment'),
  prepareChatImageAttachmentFromFile: () => bridgeMethod('prepareChatImageAttachmentFromFile'),
  prepareChatImageAttachmentFromClipboard: () => bridgeMethod('prepareChatImageAttachmentFromClipboard')
}
