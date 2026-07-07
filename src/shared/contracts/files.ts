import type { AiopsMutationResult } from './common'
import type { AiopsCustomFolderRecord, AiopsCustomFolderSaveInput } from './assets'

export type FileSessionKind = 'local' | 'remote'

export type FileSessionInfo = {
  id: string
  label: string
  host: string
  username?: string
  group: string
  kind: FileSessionKind
  rootPath: string
  status: 'active' | 'idle' | 'error'
  favorite?: boolean
  assetType?: 'local' | 'person' | 'organization' | 'custom_folder'
  folderUuid?: string
  organizationId?: string
  jumpHostId?: string
  comment?: string
  errorMsg?: string
}

export type FileSessionFolderRecord = AiopsCustomFolderRecord
export type FileSessionFolderSaveInput = AiopsCustomFolderSaveInput

export type FileSessionCatalog = {
  sessions: FileSessionInfo[]
  folders: FileSessionFolderRecord[]
}

export type FileSessionPatch = Partial<Omit<FileSessionInfo, 'id'>>
export type FileSessionSftpPayload = Record<string, unknown>
export type FileSessionTerminalContext = {
  kind: 'local' | 'ssh'
  panelId?: string
  panelTitle?: string
  panelStatus?: 'ready' | 'running' | 'closed'
  sessionId?: string
  cwd?: string
  ssh?: {
    connectionId?: string
    host?: string
    port?: number
    username?: string
    assetId?: string
    assetName?: string
    assetType?: string
    organizationId?: string
    authType?: string
    needProxy?: boolean
    proxyName?: string
    jumpHostId?: string
    createdAt?: number
    forkFromConnectionId?: string
  }
}

export type FileSessionCatalogResult = AiopsMutationResult<FileSessionCatalog>
export type FileSessionMutationResult = AiopsMutationResult<FileSessionCatalog & { session: FileSessionInfo }>
export type FileSessionFolderMutationResult = AiopsMutationResult<FileSessionCatalog & { folder: FileSessionFolderRecord }>
export type FileSessionFolderDeleteResult = AiopsMutationResult<FileSessionCatalog & { folderUuid: string }>

export type FileListEntry = {
  name: string
  path: string
  type: 'file' | 'directory' | 'link'
  size: number
  modifiedAt: number
  mode?: string
  linkTarget?: string
}

export type FileListOptions = {
  sessionId?: string
  kind?: 'local' | 'remote'
  host?: string
  fromHost?: string
  toHost?: string
  rootPath?: string
  jumpHostId?: string
}

export type FileContentOptions = FileListOptions & {
  expectedAction?: 'edit' | 'create'
  expectedMtimeMs?: number
  expectedSize?: number
  overwrite?: boolean
}

export type FileReadContentResult = AiopsMutationResult<{
  content: string
  action: 'edit' | 'create'
  size: number
  mtimeMs: number
}>

export type FileWriteContentResult = AiopsMutationResult<{
  size: number
  mtimeMs: number
  task?: FileTransferTask
}>

export type FileEntryMutation =
  | { kind: 'rename'; oldPath: string; newPath: string }
  | { kind: 'delete'; path: string; recursive?: boolean }
  | { kind: 'chmod'; path: string; mode: string; recursive?: boolean }
  | { kind: 'copy'; srcPath: string; targetPath: string; overwrite?: boolean }
  | { kind: 'move'; srcPath: string; targetPath: string; overwrite?: boolean }

export type FileEntryMutationResult = AiopsMutationResult<{
  affected: number
  path?: string
  mode?: string
  mtimeMs: number
  task?: FileTransferTask
}>

export type FileTransferOperation =
  | { kind: 'upload-file' | 'upload-directory' | 'upload-path'; localPath: string; remoteDirectory: string }
  | { kind: 'download-file'; remotePath: string; localPath: string }
  | { kind: 'download-directory'; remotePath: string; localDirectory: string }
  | { kind: 'copy-remote'; remotePath: string; targetPath: string; overwrite?: boolean }

export type FileTransferOperationResult = AiopsMutationResult<{
  status: 'success' | 'cancelled' | 'skipped'
  source: string
  target: string
  bytes: number
  files: number
  mtimeMs: number
  itemKind?: 'file' | 'directory'
  task?: FileTransferTask
}>

export type FileTransferTask = {
  id: string
  type: 'download' | 'upload' | 'r2r'
  name: string
  source: string
  target: string
  progress: number
  speed: string
  status: 'running' | 'success' | 'failed' | 'error'
  stage?: 'scanning' | 'pending'
  isGroup?: boolean
  fromHost?: string
  toHost?: string
  totalFiles?: number
  finishedFiles?: number
  children?: FileTransferTask[]
}

export type FileTransferTaskEventKind = 'registered' | 'progress' | 'finished'

export type FileTransferTaskEvent = {
  kind: FileTransferTaskEventKind
  task: FileTransferTask
}

export type FileTransferTaskCancelInput = {
  id: string
}

export type FileTransferTaskCancelResult = AiopsMutationResult<{
  id: string
  taskIds: string[]
  status: 'aborted' | 'not_found'
}>
