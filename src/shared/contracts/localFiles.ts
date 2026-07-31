import type { AiopsMutationResult } from './common'

export type FileDialogFilter = {
  name: string
  extensions: string[]
}

export type OpenDialogOptions = {
  defaultPath?: string
  properties: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory'>
  filters?: FileDialogFilter[]
}

export type OpenDialogResult = {
  canceled: boolean
  filePaths: string[]
}

export type SaveDialogOptions = {
  defaultPath?: string
  filters?: FileDialogFilter[]
}

export type SaveDialogResult = {
  canceled: boolean
  filePath?: string
}

export type LocalFileReadResult = {
  content: string
  mtimeMs: number
  size: number
}

export type LocalFileWriteResult = AiopsMutationResult<{
  filePath: string
  bytes: number
  size: number
  mtimeMs: number
}>

export type EnsureLocalDirectoryInput = {
  directoryPath: string
  createIfMissing: boolean
}

export type EnsureLocalDirectoryResult = AiopsMutationResult<{
  directoryPath: string
  created: boolean
}>

export type LocalEditorFileInspectResult = AiopsMutationResult<{
  filePath: string
  size: number
  mtimeMs: number
}>

export type LocalEditorFileReadResult = AiopsMutationResult<{
  filePath: string
  content: string
  contentHash: string
  size: number
  mtimeMs: number
}>

export type LocalEditorFileWriteInput = {
  filePath: string
  content: string
  expectedMtimeMs?: number
  expectedSize?: number
  expectedContentHash?: string
  overwrite?: boolean
}

export type LocalEditorFileWriteResult = AiopsMutationResult<{
  filePath: string
  contentHash: string
  size: number
  mtimeMs: number
}>

export type LocalEditorFileWatchInput = {
  filePath: string
  watchId: string
}

export type LocalEditorFileWatchResult = AiopsMutationResult<{
  filePath: string
  watchId: string
  watched: boolean
  fallback: boolean
}>

export type LocalEditorFileWatchEvent = {
  filePath: string
  watchId: string
  kind: 'modified' | 'deleted'
  changedAt: number
}

export type ChatAttachmentStageResult = {
  mode: 'local'
  taskId: string
  srcAbsPath: string
  refPath: string
  name: string
  size: number
  stagedPath: string
}

export type ChatImageAttachmentMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export type ChatImageAttachmentPrepareInput = {
  mediaType?: string
  data?: string
  name?: string
  size?: number
}

export type ChatImageAttachmentValidateInput = Omit<ChatImageAttachmentPrepareInput, 'data'>

export type ChatImageAttachmentFileInput = {
  filePath: string
  name?: string
}

export type ChatImageAttachmentClipboardInput = {
  name?: string
}

export type ChatImageAttachmentValidateResult = AiopsMutationResult<{
  mediaType: ChatImageAttachmentMediaType
  name?: string
  size: number
}>

export type ChatImageAttachmentPrepareResult = AiopsMutationResult<{
  type: 'image'
  mediaType: ChatImageAttachmentMediaType
  data: string
  name?: string
  size: number
}>
