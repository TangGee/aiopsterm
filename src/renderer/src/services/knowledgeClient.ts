import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type KnowledgeBridge = Pick<
  AiopsPreloadApi,
  | 'kbCheckPath'
  | 'kbEnsureRoot'
  | 'kbGetRoot'
  | 'kbListDir'
  | 'kbReadFile'
  | 'kbWriteFile'
  | 'kbPasteImageFromClipboard'
  | 'kbMkdir'
  | 'kbCreateFile'
  | 'kbRename'
  | 'kbDelete'
  | 'kbMove'
  | 'kbCopy'
  | 'kbImportFile'
  | 'kbImportFolder'
  | 'kbSearch'
  | 'kbSearchStatus'
  | 'kbReindex'
  | 'onKbTransferProgress'
>

const bridgeMethod = createBridgeMethod<KnowledgeBridge>()

export const knowledgeClient = {
  kbCheckPath: () => bridgeMethod('kbCheckPath'),
  kbEnsureRoot: () => bridgeMethod('kbEnsureRoot'),
  kbGetRoot: () => bridgeMethod('kbGetRoot'),
  kbListDir: () => bridgeMethod('kbListDir'),
  kbReadFile: () => bridgeMethod('kbReadFile'),
  kbWriteFile: () => bridgeMethod('kbWriteFile'),
  kbPasteImageFromClipboard: () => bridgeMethod('kbPasteImageFromClipboard'),
  kbMkdir: () => bridgeMethod('kbMkdir'),
  kbCreateFile: () => bridgeMethod('kbCreateFile'),
  kbRename: () => bridgeMethod('kbRename'),
  kbDelete: () => bridgeMethod('kbDelete'),
  kbMove: () => bridgeMethod('kbMove'),
  kbCopy: () => bridgeMethod('kbCopy'),
  kbImportFile: () => bridgeMethod('kbImportFile'),
  kbImportFolder: () => bridgeMethod('kbImportFolder'),
  kbSearch: () => bridgeMethod('kbSearch'),
  kbSearchStatus: () => bridgeMethod('kbSearchStatus'),
  kbReindex: () => bridgeMethod('kbReindex'),
  onKbTransferProgress: () => bridgeMethod('onKbTransferProgress')
}
