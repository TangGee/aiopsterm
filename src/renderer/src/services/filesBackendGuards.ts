import type {
  FileEntryMutation,
  FileEntryMutationResult,
  FileListEntry,
  FileReadContentResult,
  FileSessionCatalog,
  FileSessionFolderDeleteResult,
  FileSessionFolderMutationResult,
  FileSessionFolderRecord,
  FileSessionInfo,
  FileSessionMutationResult,
  FileTransferOperationResult,
  FileTransferTask,
  FileTransferTaskCancelResult,
  FileWriteContentResult
} from '@shared/preload'

export const malformedFilesBackendResultMessage = '文件服务返回数据无效'

export type FileSessionMutationData = NonNullable<FileSessionMutationResult['data']>
export type FileSessionFolderMutationData = NonNullable<FileSessionFolderMutationResult['data']>
export type FileSessionFolderDeleteData = NonNullable<FileSessionFolderDeleteResult['data']>
export type FileReadContentData = NonNullable<FileReadContentResult['data']>
export type FileEntryMutationData = NonNullable<FileEntryMutationResult['data']>
export type FileWriteContentData = NonNullable<FileWriteContentResult['data']> & { task: FileTransferTask }
export type FileTransferOperationData = NonNullable<FileTransferOperationResult['data']> & { task: FileTransferTask }

const fileSessionKinds = new Set(['local', 'remote'])
const fileSessionStatuses = new Set(['active', 'idle', 'error'])
const fileSessionAssetTypes = new Set(['local', 'person', 'organization', 'custom_folder'])
const fileEntryTypes = new Set(['file', 'directory', 'link'])
const fileTransferTypes = new Set(['download', 'upload', 'r2r'])
const fileTransferStatuses = new Set(['running', 'success', 'failed', 'error'])
const fileTransferStages = new Set(['scanning', 'pending'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isOptionalNonEmptyString = (value: unknown) => value === undefined || isNonEmptyString(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNonNegativeFiniteNumber = (value: unknown): value is number => isFiniteNumber(value) && value >= 0

export const isFileSessionInfoData = (value: unknown): value is FileSessionInfo =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.label) &&
  isNonEmptyString(value.host) &&
  isNonEmptyString(value.group) &&
  fileSessionKinds.has(String(value.kind)) &&
  isNonEmptyString(value.rootPath) &&
  fileSessionStatuses.has(String(value.status)) &&
  (value.favorite === undefined || typeof value.favorite === 'boolean') &&
  (value.assetType === undefined || fileSessionAssetTypes.has(String(value.assetType))) &&
  isOptionalNonEmptyString(value.folderUuid) &&
  isOptionalString(value.comment) &&
  isOptionalString(value.errorMsg)

export const isFileSessionFolderRecordData = (value: unknown): value is FileSessionFolderRecord =>
  isRecord(value) && isNonEmptyString(value.uuid) && isNonEmptyString(value.name) && typeof value.description === 'string'

export const isFileSessionCatalogData = (value: unknown): value is FileSessionCatalog => {
  if (!isRecord(value) || !Array.isArray(value.sessions) || !Array.isArray(value.folders)) return false
  if (!value.sessions.every(isFileSessionInfoData) || !value.folders.every(isFileSessionFolderRecordData)) return false
  const sessionIds = new Set<string>()
  for (const session of value.sessions) {
    if (sessionIds.has(session.id)) return false
    sessionIds.add(session.id)
  }
  const folderUuids = new Set<string>()
  for (const folder of value.folders) {
    if (folderUuids.has(folder.uuid)) return false
    folderUuids.add(folder.uuid)
  }
  return value.sessions.every((session) => session.folderUuid === undefined || folderUuids.has(session.folderUuid))
}

export const isFileSessionMutationData = (value: unknown): value is FileSessionMutationData => {
  if (!isRecord(value)) return false
  const record: Record<string, unknown> = value
  if (!isFileSessionCatalogData(value) || !isFileSessionInfoData(record.session)) return false
  const session = record.session as FileSessionInfo
  return value.sessions.some((item) => item.id === session.id)
}

export const isFileSessionFolderMutationData = (value: unknown): value is FileSessionFolderMutationData => {
  if (!isRecord(value)) return false
  const record: Record<string, unknown> = value
  if (!isFileSessionCatalogData(value) || !isFileSessionFolderRecordData(record.folder)) return false
  const folder = record.folder as FileSessionFolderRecord
  return value.folders.some((item) => item.uuid === folder.uuid)
}

export const isFileSessionFolderDeleteData = (value: unknown, expectedUuid?: string): value is FileSessionFolderDeleteData => {
  if (!isRecord(value)) return false
  const record: Record<string, unknown> = value
  if (!isFileSessionCatalogData(value) || !isNonEmptyString(record.folderUuid)) return false
  const folderUuid = record.folderUuid
  if (expectedUuid && folderUuid !== expectedUuid) return false
  return !value.folders.some((folder) => folder.uuid === folderUuid) && !value.sessions.some((session) => session.folderUuid === folderUuid)
}

export const isFileListEntryData = (value: unknown): value is FileListEntry =>
  isRecord(value) &&
  isNonEmptyString(value.name) &&
  isNonEmptyString(value.path) &&
  fileEntryTypes.has(String(value.type)) &&
  isNonNegativeFiniteNumber(value.size) &&
  isFiniteNumber(value.modifiedAt) &&
  isOptionalString(value.mode) &&
  isOptionalString(value.linkTarget)

export const isFileReadContentData = (value: unknown): value is FileReadContentData =>
  isRecord(value) &&
  typeof value.content === 'string' &&
  (value.action === 'edit' || value.action === 'create') &&
  isNonNegativeFiniteNumber(value.size) &&
  isFiniteNumber(value.mtimeMs)

export const isFileTransferTaskData = (value: unknown): value is FileTransferTask => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !fileTransferTypes.has(String(value.type)) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.source) ||
    !isNonEmptyString(value.target) ||
    !isFiniteNumber(value.progress) ||
    typeof value.speed !== 'string' ||
    !fileTransferStatuses.has(String(value.status)) ||
    (value.stage !== undefined && !fileTransferStages.has(String(value.stage))) ||
    (value.isGroup !== undefined && typeof value.isGroup !== 'boolean') ||
    !isOptionalString(value.fromHost) ||
    !isOptionalString(value.toHost) ||
    (value.totalFiles !== undefined && !isNonNegativeFiniteNumber(value.totalFiles)) ||
    (value.finishedFiles !== undefined && !isNonNegativeFiniteNumber(value.finishedFiles))
  ) {
    return false
  }
  return value.children === undefined || (Array.isArray(value.children) && value.children.every(isFileTransferTaskData))
}

export const isFileWriteContentData = (value: unknown): value is FileWriteContentData =>
  isRecord(value) && isNonNegativeFiniteNumber(value.size) && isFiniteNumber(value.mtimeMs) && isFileTransferTaskData(value.task)

export const isFileEntryMutationData = (value: unknown, mutationKind: FileEntryMutation['kind']): value is FileEntryMutationData => {
  if (!isRecord(value) || !isNonNegativeFiniteNumber(value.affected) || !isFiniteNumber(value.mtimeMs)) return false
  if (value.path !== undefined && !isNonEmptyString(value.path)) return false
  if (value.mode !== undefined && typeof value.mode !== 'string') return false
  return mutationKind === 'rename' || isFileTransferTaskData(value.task)
}

export const isFileEntryMutationDataForRequest = (value: unknown, mutation: FileEntryMutation): value is FileEntryMutationData => {
  if (!isFileEntryMutationData(value, mutation.kind)) return false
  const path = value.path
  const task = isRecord(value) && isFileTransferTaskData(value.task) ? value.task : undefined
  if (mutation.kind === 'rename') return path === mutation.newPath
  if (!task || task.status !== 'success') return false
  if (mutation.kind === 'delete') return path === mutation.path && task.source === mutation.path
  if (mutation.kind === 'chmod') return path === mutation.path && value.mode === mutation.mode && task.source === mutation.path
  return path === mutation.targetPath && task.source === mutation.srcPath && task.target === mutation.targetPath
}

export const isFileTransferOperationData = (value: unknown): value is FileTransferOperationData =>
  isRecord(value) &&
  (value.status === 'success' || value.status === 'cancelled' || value.status === 'skipped') &&
  isNonEmptyString(value.source) &&
  isNonEmptyString(value.target) &&
  isNonNegativeFiniteNumber(value.bytes) &&
  isNonNegativeFiniteNumber(value.files) &&
  isFiniteNumber(value.mtimeMs) &&
  (value.itemKind === undefined || value.itemKind === 'file' || value.itemKind === 'directory') &&
  isFileTransferTaskData(value.task)

export const isFileTransferTaskCancelData = (value: unknown): value is FileTransferTaskCancelResult['data'] =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  Array.isArray(value.taskIds) &&
  value.taskIds.every(isNonEmptyString) &&
  (value.status === 'aborted' || value.status === 'not_found')
