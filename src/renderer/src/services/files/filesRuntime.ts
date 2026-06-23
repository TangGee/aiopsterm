import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type {
  FileSessionCatalog,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionTerminalContext,
  FileListEntry,
  FileTransferTask
} from '@shared/contracts/files'

export type FileSide = 'left' | 'right'
export type FileTransferTaskGroups = {
  download: FileTransferTask[]
  upload: FileTransferTask[]
  r2r: FileTransferTask[]
}
export type FileBrowserEntry = Omit<FileListEntry, 'mode' | 'modifiedAt'> & {
  mode: string
  modifiedAt: string
  modifiedAtMs: number
  linkTarget?: string
}
export type FileBrowserSortState = {
  key: 'name' | 'size' | 'modifiedAt'
  direction: 'asc' | 'desc'
}
export type FilePermissionSelection = Record<'owner' | 'group' | 'public', string[]>
export type FileSessionSelection = { left: string | null; right: string | null }
export type FileSessionSelectionSnapshot = FileSessionSelection & {
  leftSession: FileSessionInfo | null
  rightSession: FileSessionInfo | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const cloneFileSessionCatalog = (catalog: FileSessionCatalog): FileSessionCatalog => ({
  sessions: catalog.sessions.map((session) => ({ ...session })),
  folders: catalog.folders.map((folder) => ({ ...folder }))
})

export const findFileSession = (sessions: FileSessionInfo[], id: string | null) => sessions.find((session) => session.id === id) || null

export const nextSelectedFileSessionIds = (
  sessions: FileSessionInfo[],
  selectedLeftId: string | null,
  selectedRightId: string | null
): FileSessionSelection => {
  const hasSession = (id: string | null) => Boolean(id && sessions.some((session) => session.id === id))
  const fallbackRight = sessions.some((session) => session.id === 'local') ? 'local' : sessions[0]?.id || null
  return {
    left: hasSession(selectedLeftId) ? selectedLeftId : null,
    right: hasSession(selectedRightId) ? selectedRightId : fallbackRight
  }
}

export const defaultFileSessionSide = (selectedLeftId: string | null, selectedRightId: string | null): FileSide => {
  if (!selectedLeftId) return 'left'
  if (!selectedRightId) return 'right'
  return 'left'
}

export const defaultFileOpenSide = (selectedLeftId: string | null): FileSide => (selectedLeftId ? 'right' : 'left')

export const openFileSessionSelection = (
  sessions: FileSessionInfo[],
  sessionId: string,
  side: FileSide,
  selectedLeftId: string | null,
  selectedRightId: string | null
): { left: string | null; right: string | null; session: FileSessionInfo | null } => {
  const session = findFileSession(sessions, sessionId)
  if (!session) return { left: selectedLeftId, right: selectedRightId, session: null }
  return {
    left: side === 'left' ? session.id : selectedLeftId,
    right: side === 'right' ? session.id : selectedRightId,
    session
  }
}

export const selectedFileSessionSnapshot = (
  sessions: FileSessionInfo[],
  selectedLeftId: string | null,
  selectedRightId: string | null
): FileSessionSelectionSnapshot => ({
  left: selectedLeftId,
  right: selectedRightId,
  leftSession: findFileSession(sessions, selectedLeftId),
  rightSession: findFileSession(sessions, selectedRightId)
})

const sftpPayloadId = (payload: Record<string, unknown>) => String(payload.uuid || payload.id || payload.assetId || '').trim()
const sftpPayloadHost = (payload: Record<string, unknown>) => String(payload.host || payload.ip || '').trim()

export const findFileSessionForSftpPayload = (sessions: FileSessionInfo[], payload: Record<string, unknown>) => {
  const payloadId = sftpPayloadId(payload)
  const payloadHost = sftpPayloadHost(payload)
  return sessions.find((session) => (payloadId && session.id === payloadId) || (payloadHost && session.host === payloadHost)) || null
}

export const isSelectedFileSessionSftpPayload = (selection: FileSessionSelectionSnapshot, payload: Record<string, unknown>) => {
  const payloadId = sftpPayloadId(payload)
  const payloadHost = sftpPayloadHost(payload)
  return [selection.leftSession, selection.rightSession].some((session) => {
    if (!session) return false
    if (payloadId && session.id === payloadId) return true
    return Boolean(payloadHost && session.host === payloadHost)
  })
}

export const normalizeFileSessionFolderSaveInput = (folder: FileSessionFolderSaveInput): FileSessionFolderSaveInput | null => {
  const name = folder.name.trim()
  if (!name) return null
  return {
    ...(folder.uuid ? { uuid: folder.uuid } : {}),
    name,
    description: (folder.description || '').trim(),
    ...(folder.parentUuid ? { parentUuid: folder.parentUuid } : {}),
    ...(folder.scope ? { scope: folder.scope } : {})
  }
}

export const fileSessionPanelStatus = (status: TerminalPanel['status']): FileSessionTerminalContext['panelStatus'] => {
  if (status === 'error') return 'closed'
  if (status === 'connecting') return 'running'
  return status
}

export const fileSessionTerminalContextForPanel = (panel: TerminalPanel): FileSessionTerminalContext => {
  const ssh = panel.sshSession
  const hasSshBackendConnection = Boolean(ssh?.connectionId)
  return {
    kind: ssh ? 'ssh' : 'local',
    panelId: panel.id,
    panelTitle: panel.title,
    panelStatus: fileSessionPanelStatus(panel.status),
    sessionId: ssh && !hasSshBackendConnection ? undefined : panel.sessionId,
    cwd: ssh && !hasSshBackendConnection ? undefined : panel.cwd,
    ...(ssh
      ? {
          ssh: {
            connectionId: ssh.connectionId,
            host: ssh.host,
            port: ssh.port,
            username: ssh.username,
            assetId: ssh.assetId,
            assetName: ssh.assetName,
            assetType: ssh.assetType,
            organizationId: ssh.organizationId,
            jumpHostId: ssh.jumpHostId,
            authType: ssh.authType,
            needProxy: ssh.needProxy,
            proxyName: ssh.proxyName,
            createdAt: ssh.createdAt,
            forkFromConnectionId: ssh.forkFromConnectionId
          }
        }
      : {})
  }
}

export const permissionToModePrefix = (type: FileBrowserEntry['type']) => {
  if (type === 'directory') return 'd'
  if (type === 'link') return 'l'
  return '-'
}

export const filePermissionCode = (permissions: FilePermissionSelection) => {
  const score = (items: string[]) => (items.includes('读') ? 4 : 0) + (items.includes('写') ? 2 : 0) + (items.includes('执行') ? 1 : 0)
  return `${score(permissions.owner)}${score(permissions.group)}${score(permissions.public)}`
}

export const parseFilePermissionMode = (mode: string): FilePermissionSelection | null => {
  const digits = mode.match(/[0-7]{3}$/)?.[0]
  if (!digits) return null
  const applyDigit = (digit: string) => {
    const value = Number(digit)
    const next: string[] = []
    if (value & 4) next.push('读')
    if (value & 2) next.push('写')
    if (value & 1) next.push('执行')
    return next
  }
  return {
    owner: applyDigit(digits[0]),
    group: applyDigit(digits[1]),
    public: applyDigit(digits[2])
  }
}

export const visibleFileBrowserEntries = (
  entries: FileBrowserEntry[],
  showHidden: boolean,
  sortState: FileBrowserSortState
) => {
  const visible = showHidden ? entries : entries.filter((entry) => entry.name === '..' || !entry.name.startsWith('.'))
  const parentRows = visible.filter((entry) => entry.name === '..')
  const rows = visible.filter((entry) => entry.name !== '..')
  const direction = sortState.direction === 'asc' ? 1 : -1
  const typeRank = (entry: FileBrowserEntry) => (entry.type === 'directory' ? 0 : entry.type === 'link' ? 1 : 2)
  const compareName = (left: FileBrowserEntry, right: FileBrowserEntry) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  rows.sort((left, right) => {
    const rankDelta = typeRank(left) - typeRank(right)
    if (rankDelta !== 0) return rankDelta
    if (sortState.key === 'name') return compareName(left, right) * direction
    if (sortState.key === 'size') {
      const sizeDelta = left.size - right.size
      return (sizeDelta === 0 ? compareName(left, right) : sizeDelta) * direction
    }
    const dateDelta = left.modifiedAtMs - right.modifiedAtMs
    return (dateDelta === 0 ? compareName(left, right) : dateDelta) * direction
  })
  return [...parentRows, ...rows]
}

export const nextFileBrowserSortState = (sortState: FileBrowserSortState, key: FileBrowserSortState['key']): FileBrowserSortState => {
  if (sortState.key === key) {
    return {
      key,
      direction: sortState.direction === 'asc' ? 'desc' : 'asc'
    }
  }
  return {
    key,
    direction: key === 'modifiedAt' ? 'desc' : 'asc'
  }
}

export const normalizeFileBrowserPath = (path: string) => {
  const next = path.trim().replace(/\/+/g, '/')
  return next === '' ? '/' : next
}

export const joinFileBrowserPath = (...parts: string[]) => normalizeFileBrowserPath(parts.join('/'))

export const fileBrowserDirname = (path: string) => {
  const index = path.lastIndexOf('/')
  if (index <= 0) return '/'
  return path.slice(0, index)
}

export const fileBrowserTargetBreadcrumb = (targetPath: string) => ['/', ...targetPath.split('/').filter(Boolean)]

export const fileBrowserTargetPathForBreadcrumbIndex = (targetPath: string, index: number) => {
  const parts = fileBrowserTargetBreadcrumb(targetPath).slice(0, index + 1)
  return normalizeFileBrowserPath(parts[0] === '/' ? `/${parts.slice(1).join('/')}` : parts.join('/'))
}

export const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export const localPathName = (path: string, fallback = 'upload') => path.split(/[\\/]/).filter(Boolean).at(-1) || fallback

export const formatFileModifiedAt = (time: number) => {
  if (!time) return ''
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const defaultFileBrowserMode = (entry: Pick<FileListEntry, 'type' | 'mode'>) =>
  entry.mode || (entry.type === 'directory' ? 'drwxr-xr-x' : entry.type === 'link' ? 'lrwxrwxrwx' : '-rw-r--r--')

export const mapFileBrowserEntry = (entry: FileListEntry): FileBrowserEntry => ({
  name: entry.name,
  path: entry.path,
  type: entry.type,
  mode: defaultFileBrowserMode(entry),
  size: entry.size,
  modifiedAt: formatFileModifiedAt(entry.modifiedAt),
  modifiedAtMs: entry.modifiedAt,
  linkTarget: entry.linkTarget
})

export const resolveListedDirectoryPath = (requestedPath: string, rows: FileBrowserEntry[]) => {
  const firstChild = rows.find((entry) => entry.name !== '..')
  if (!firstChild) return requestedPath
  const parentPath = fileBrowserDirname(firstChild.path)
  return parentPath || requestedPath
}

export const fileBrowserRowsForDirectory = (requestedPath: string, entries: FileListEntry[]) => {
  const rows = entries.map(mapFileBrowserEntry)
  const listedDirectoryPath = resolveListedDirectoryPath(requestedPath, rows)
  if (rows.some((entry) => entry.name === '..') || listedDirectoryPath === '/') {
    return { rows, path: listedDirectoryPath }
  }
  return {
    rows: [
      { name: '..', path: fileBrowserDirname(listedDirectoryPath), type: 'directory' as const, mode: 'drwxr-xr-x', size: 0, modifiedAt: '', modifiedAtMs: 0 },
      ...rows
    ],
    path: listedDirectoryPath
  }
}

export const canAttemptOpenFileBrowserDirectory = (entry: FileBrowserEntry) =>
  entry.name === '..' || entry.type === 'directory' || entry.type === 'link'

export const isDraggableFileBrowserEntry = (entry: FileBrowserEntry, uiMode: 'transfer' | 'default', panelSide?: FileSide) =>
  uiMode === 'transfer' && Boolean(panelSide) && entry.name !== '..' && entry.type !== 'link'

export const fileBrowserEntryDropDirectory = (entry: FileBrowserEntry | null | undefined, currentPath: string) => {
  if (entry?.type === 'directory' && entry.name !== '..') return entry.path
  return currentPath
}

export const fileBrowserRenamePath = (entryPath: string, nextName: string) => joinFileBrowserPath(fileBrowserDirname(entryPath), nextName)

export const uniqueConflictFileName = (existingNames: Iterable<string>, name: string) => {
  const names = new Set(existingNames)
  const dotIndex = name.lastIndexOf('.')
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name
  const ext = dotIndex > 0 ? name.slice(dotIndex) : ''
  let index = 1
  let candidate = `${base}_${index}${ext}`
  while (names.has(candidate)) {
    index += 1
    candidate = `${base}_${index}${ext}`
  }
  return candidate
}

export const groupFileTransferTasks = (tasks: FileTransferTask[]): FileTransferTaskGroups => ({
  download: tasks.filter((task) => task.type === 'download'),
  upload: tasks.filter((task) => task.type === 'upload'),
  r2r: tasks.filter((task) => task.type === 'r2r')
})

export const fileTransferOverallPercent = (tasks: FileTransferTask[]) => {
  if (!tasks.length) return 0
  const sum = tasks.reduce((acc, task) => acc + task.progress, 0)
  return Math.round(sum / tasks.length)
}

export const hasRunningFileTransferTasks = (tasks: FileTransferTask[]) => tasks.some((task) => task.status === 'running')

export const normalizeFileTransferTask = (value: unknown): FileTransferTask | null => {
  if (!isRecord(value)) return null
  const type = value.type === 'download' || value.type === 'upload' || value.type === 'r2r' ? value.type : null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const source = typeof value.source === 'string' ? value.source : ''
  const target = typeof value.target === 'string' ? value.target : ''
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : ''
  if (!id || !type || !name || !source || !target) return null
  const status =
    value.status === 'running' || value.status === 'success' || value.status === 'failed' || value.status === 'error'
      ? value.status
      : 'running'
  const progress = typeof value.progress === 'number' && Number.isFinite(value.progress) ? Math.min(100, Math.max(0, Math.round(value.progress))) : 0
  const stage = value.stage === 'scanning' || value.stage === 'pending' ? value.stage : undefined
  const task: FileTransferTask = {
    id,
    type,
    name,
    source,
    target,
    progress,
    speed: typeof value.speed === 'string' && value.speed.trim() ? value.speed : status === 'running' ? 'pending' : '',
    status,
    ...(stage ? { stage } : {}),
    ...(value.isGroup === true ? { isGroup: true } : {}),
    ...(typeof value.fromHost === 'string' && value.fromHost ? { fromHost: value.fromHost } : {}),
    ...(typeof value.toHost === 'string' && value.toHost ? { toHost: value.toHost } : {}),
    ...(typeof value.totalFiles === 'number' && Number.isFinite(value.totalFiles) ? { totalFiles: Math.max(0, Math.round(value.totalFiles)) } : {}),
    ...(typeof value.finishedFiles === 'number' && Number.isFinite(value.finishedFiles)
      ? { finishedFiles: Math.max(0, Math.round(value.finishedFiles)) }
      : {})
  }
  const children = Array.isArray(value.children) ? value.children.map(normalizeFileTransferTask).filter((child): child is FileTransferTask => Boolean(child)) : []
  if (children.length) task.children = children
  return task
}

export const normalizeFileTransferTaskSnapshot = (tasks: unknown[]) => tasks.map(normalizeFileTransferTask).filter((task): task is FileTransferTask => Boolean(task))

export const mergeFileTransferTaskSnapshot = (
  currentTasks: FileTransferTask[],
  snapshot: FileTransferTask[],
  options: { replaceCompleted?: boolean } = {}
) => {
  if (options.replaceCompleted === true) return snapshot.map((task) => ({ ...task, children: task.children?.map((child) => ({ ...child })) }))
  const activeIds = new Set(snapshot.map((task) => task.id))
  const finished = currentTasks.filter((task) => task.status !== 'running' && !activeIds.has(task.id))
  return [...snapshot, ...finished].map((task) => ({ ...task, children: task.children?.map((child) => ({ ...child })) }))
}

export const upsertFileTransferTask = (tasks: FileTransferTask[], task: FileTransferTask) => [task, ...tasks.filter((item) => item.id !== task.id)]

export const fileTransferTaskRemovalDelay = (task: FileTransferTask) => {
  if (task.status === 'success') return 2500
  if (task.status === 'failed' || task.status === 'error') return 8000
  return null
}

export const affectedFileTransferTaskIds = (tasks: FileTransferTask[], id: string) => {
  const taskIds = new Set<string>([id])
  tasks.forEach((item) => {
    if (item.children?.some((child) => child.id === id)) {
      taskIds.add(item.id)
      item.children?.forEach((child) => taskIds.add(child.id))
    }
    if (item.id === id && item.children?.length) {
      item.children.forEach((child) => taskIds.add(child.id))
    }
  })
  return taskIds
}

export const markFileTransferTasksCancelled = (tasks: FileTransferTask[], ids: Iterable<string>) => {
  const taskIds = new Set(ids)
  return tasks.map((task) => {
    if (!taskIds.has(task.id)) return task
    return {
      ...task,
      status: 'failed' as const,
      speed: '已取消',
      progress: Math.min(task.progress, 99),
      children: task.children?.map((child) => ({
        ...child,
        status: 'failed' as const,
        speed: '已取消',
        progress: Math.min(child.progress, 99)
      }))
    }
  })
}
