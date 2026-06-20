import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

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

const bridgeMethod = <Name extends keyof KnowledgeBridge>(name: Name): KnowledgeBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as KnowledgeBridge[Name]) : undefined
}

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
