import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

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

const bridgeMethod = <Name extends keyof LocalFilesBridge>(name: Name): LocalFilesBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as LocalFilesBridge[Name]) : undefined
}

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
