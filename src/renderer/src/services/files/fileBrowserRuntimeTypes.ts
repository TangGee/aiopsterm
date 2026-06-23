import type { FileBrowserEntry, FileBrowserSortState, FilePermissionSelection, FileSide } from '@/services/files/filesRuntime'
import type { FileSessionInfo } from '@shared/contracts/files'

export type FileBrowserRuntimeProps = {
  session: FileSessionInfo
  uiMode: 'transfer' | 'default'
  panelSide?: FileSide
}

export type FileBrowserOpenFilePayload = {
  filePath: string
  sessionId: string
  sessionLabel: string
  host: string
}

export type FileBrowserRuntimeEmit = (event: 'openFile', payload: FileBrowserOpenFilePayload) => void

export type FileBrowserPermissionKey = keyof FilePermissionSelection

export type FileBrowserDeleteDialogState = {
  visible: boolean
  entry: FileBrowserEntry | null
}

export type FileBrowserMoveDialogState = {
  visible: boolean
  type: 'move' | 'copy'
  entry: FileBrowserEntry | null
  targetPath: string
  editingPath: boolean
  activeMenuIndex: number | null
}

export type FileBrowserConflictDialogState = {
  visible: boolean
  newName: string
}

export type FileBrowserSortRuntimeState = FileBrowserSortState
