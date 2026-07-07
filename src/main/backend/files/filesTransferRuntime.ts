import { randomUUID } from 'crypto'
import { basename as getLocalBasename, dirname as getLocalDirname } from 'path'
import type {
  FileContentOptions,
  FileEntryMutation,
  FileListOptions,
  FileTransferTask,
  FileTransferTaskCancelInput,
  FileTransferTaskCancelResult,
  FileTransferTaskEvent
} from '@shared/contracts/files'
import { remoteBasename, remoteDirname } from './filesPathRuntime'

type BackendFileTransferTaskPayload = {
  type: FileTransferTask['type']
  name: string
  source: string
  target: string
  progress?: number
  speed?: string
  status?: FileTransferTask['status']
  stage?: FileTransferTask['stage']
  isGroup?: boolean
  fromHost?: string
  toHost?: string
  totalFiles?: number
  finishedFiles?: number
  children?: BackendFileTransferTaskPayload[]
}

export type RemoteCopyTransferStats = {
  bytes: number
  fileCount: number
  itemKind: 'file' | 'directory'
  children: BackendFileTransferTaskPayload[]
}

export type FileTransferAbortControl = {
  cancelled: boolean
  onCancel: (handler: () => void) => () => void
  cancel: () => void
  assertActive: () => void
}

const cloneFileTransferTask = (task: FileTransferTask): FileTransferTask => ({
  ...task,
  ...(task.children ? { children: task.children.map(cloneFileTransferTask) } : {})
})

const activeFileTransferTasks = new Map<string, FileTransferTask>()
const activeFileTransferControls = new Map<string, FileTransferAbortControl>()

export type FileTransferTaskEventSender = (event: FileTransferTaskEvent) => void

const fileTransferProgressCoalesceMs = 100

type PendingFileTransferProgress = { task: FileTransferTask | null; timer: NodeJS.Timeout }

let fileTransferTaskEventSender: FileTransferTaskEventSender | null = null
const pendingFileTransferProgress = new Map<string, PendingFileTransferProgress>()

export const setFileTransferTaskEventSender = (sender: FileTransferTaskEventSender | null) => {
  fileTransferTaskEventSender = sender
}

const dropPendingFileTransferProgress = (taskId: string) => {
  const pending = pendingFileTransferProgress.get(taskId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingFileTransferProgress.delete(taskId)
}

const emitFileTransferTaskEvent = (kind: FileTransferTaskEvent['kind'], task: FileTransferTask) => {
  fileTransferTaskEventSender?.({ kind, task: cloneFileTransferTask(task) })
}

// 同一任务 100ms 内的进度变化合并成一条推送：首次立即发送，窗口内只保留最后一次并在窗口结束时补发
const emitFileTransferProgressEvent = (task: FileTransferTask) => {
  if (!fileTransferTaskEventSender) return
  const pending = pendingFileTransferProgress.get(task.id)
  if (pending) {
    pending.task = cloneFileTransferTask(task)
    return
  }
  emitFileTransferTaskEvent('progress', task)
  const taskId = task.id
  const entry: PendingFileTransferProgress = {
    task: null,
    timer: setTimeout(() => {
      pendingFileTransferProgress.delete(taskId)
      if (entry.task) fileTransferTaskEventSender?.({ kind: 'progress', task: entry.task })
    }, fileTransferProgressCoalesceMs)
  }
  pendingFileTransferProgress.set(taskId, entry)
}

export const transferCancelledError = () => Object.assign(new Error('File transfer cancelled'), { code: 'FILES_TRANSFER_CANCELLED' })

export const isFileTransferCancelledError = (error: unknown) =>
  (error as { code?: unknown } | undefined)?.code === 'FILES_TRANSFER_CANCELLED' ||
  (error as { __cancelled?: unknown } | undefined)?.__cancelled === true

export const createFileTransferAbortControl = (): FileTransferAbortControl => {
  const cancelHandlers = new Set<() => void>()
  const control: FileTransferAbortControl = {
    cancelled: false,
    onCancel: (handler) => {
      if (control.cancelled) {
        handler()
        return () => {}
      }
      cancelHandlers.add(handler)
      return () => {
        cancelHandlers.delete(handler)
      }
    },
    cancel: () => {
      if (control.cancelled) return
      control.cancelled = true
      cancelHandlers.forEach((handler) => {
        try {
          handler()
        } catch {}
      })
      cancelHandlers.clear()
    },
    assertActive: () => {
      if (control.cancelled) throw transferCancelledError()
    }
  }
  return control
}

const normalizeTransferStatus = (status: unknown): FileTransferTask['status'] => {
  if (status === 'running' || status === 'failed' || status === 'error' || status === 'success') return status
  return 'success'
}

const normalizeTransferProgress = (progress: unknown, status: FileTransferTask['status']) => {
  if (typeof progress === 'number' && Number.isFinite(progress)) return Math.max(0, Math.min(100, Math.round(progress)))
  return status === 'success' ? 100 : 0
}

export const createBackendFileTransferTask = (input: BackendFileTransferTaskPayload): FileTransferTask => {
  const type = input.type === 'download' || input.type === 'upload' || input.type === 'r2r' ? input.type : 'r2r'
  const name = String(input.name || '').trim()
  const source = String(input.source || '').trim()
  const target = String(input.target || '').trim()
  if (!name || !source || !target) throw new Error('File transfer task name, source, and target are required.')
  const status = normalizeTransferStatus(input.status)
  return {
    id: `transfer-${randomUUID()}`,
    type,
    name,
    source,
    target,
    progress: normalizeTransferProgress(input.progress, status),
    speed: String(input.speed || (status === 'success' ? '完成' : 'pending')),
    status,
    ...(input.stage === 'scanning' || input.stage === 'pending' ? { stage: input.stage } : {}),
    ...(input.isGroup ? { isGroup: true } : {}),
    ...(input.fromHost ? { fromHost: String(input.fromHost) } : {}),
    ...(input.toHost ? { toHost: String(input.toHost) } : {}),
    ...(typeof input.totalFiles === 'number' && Number.isFinite(input.totalFiles) ? { totalFiles: Math.max(0, Math.round(input.totalFiles)) } : {}),
    ...(typeof input.finishedFiles === 'number' && Number.isFinite(input.finishedFiles)
      ? { finishedFiles: Math.max(0, Math.round(input.finishedFiles)) }
      : {}),
    ...(input.children?.length ? { children: input.children.map((child) => createBackendFileTransferTask(child)) } : {})
  }
}

export const transferFromHost = (options: FileListOptions) => options.fromHost || options.host
export const transferToHost = (options: FileListOptions) => options.toHost || options.host

const fileTransferTaskIds = (task: FileTransferTask) => [task.id, ...(task.children || []).map((child) => child.id)]

const registerFileTransferTaskControl = (task: FileTransferTask, control: FileTransferAbortControl) => {
  fileTransferTaskIds(task).forEach((taskId) => activeFileTransferControls.set(taskId, control))
}

export const registerActiveFileTransferTask = (task: FileTransferTask, control?: FileTransferAbortControl) => {
  if (task.status !== 'running') return
  activeFileTransferTasks.set(task.id, cloneFileTransferTask(task))
  if (control) registerFileTransferTaskControl(task, control)
  emitFileTransferTaskEvent('registered', task)
}

export const updateActiveFileTransferTask = (task: FileTransferTask, control?: FileTransferAbortControl) => {
  if (task.status !== 'running' || !activeFileTransferTasks.has(task.id)) return
  activeFileTransferTasks.set(task.id, cloneFileTransferTask(task))
  if (control) registerFileTransferTaskControl(task, control)
  emitFileTransferProgressEvent(task)
}

const deleteActiveFileTransferTaskIds = (taskIds: Iterable<string>) => {
  for (const taskId of taskIds) {
    activeFileTransferTasks.delete(taskId)
    activeFileTransferControls.delete(taskId)
    dropPendingFileTransferProgress(taskId)
  }
}

export const finishActiveFileTransferTask = (task: FileTransferTask) => {
  deleteActiveFileTransferTaskIds(fileTransferTaskIds(task))
  emitFileTransferTaskEvent('finished', task)
}

export const addActiveFileTransferChild = (task: FileTransferTask, child: FileTransferTask, control: FileTransferAbortControl) => {
  task.children = [...(task.children || []), child]
  task.totalFiles = task.children.length
  registerFileTransferTaskControl(task, control)
  updateActiveFileTransferTask(task, control)
}

export const updateRunningFileTransferProgress = (task: FileTransferTask, control: FileTransferAbortControl) => {
  const totalFiles = task.totalFiles || task.children?.length || 0
  const finishedFiles = task.finishedFiles || 0
  task.progress = totalFiles > 0 ? Math.max(0, Math.min(99, Math.round((finishedFiles / totalFiles) * 100))) : 0
  updateActiveFileTransferTask(task, control)
}

export const completeRunningFileTransferTask = (task: FileTransferTask, fileCount: number) => {
  task.status = 'success'
  task.progress = 100
  task.speed = '完成'
  task.totalFiles = fileCount
  task.finishedFiles = fileCount
  task.children?.forEach((child) => {
    child.status = 'success'
    child.progress = 100
    child.speed = '完成'
  })
  finishActiveFileTransferTask(task)
  return cloneFileTransferTask(task)
}

export const cancelRunningFileTransferTask = (task: FileTransferTask) => {
  task.status = 'failed'
  task.speed = '已取消'
  task.progress = Math.min(task.progress, 99)
  task.children?.forEach((child) => {
    if (child.status === 'success') return
    child.status = 'failed'
    child.speed = '已取消'
    child.progress = Math.min(child.progress, 99)
  })
  finishActiveFileTransferTask(task)
  return cloneFileTransferTask(task)
}

export const createCompletedBackendFileTransferTask = (input: BackendFileTransferTaskPayload) =>
  cloneFileTransferTask(createBackendFileTransferTask({ progress: 100, status: 'success', speed: '完成', ...input }))

export const createRunningFileTransferTask = (input: BackendFileTransferTaskPayload) =>
  createBackendFileTransferTask({
    progress: 0,
    status: 'running',
    speed: 'pending',
    stage: 'pending',
    ...input
  })

export const transferByteCount = (value: unknown) => {
  const bytes = Number(value)
  return Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0
}

const formatTransferBytes = (bytes: number) => {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export const updateSingleFileTransferProgress = (
  task: FileTransferTask,
  control: FileTransferAbortControl,
  transferredBytes: number,
  totalBytes: number,
  stageText: string
) => {
  task.progress = totalBytes > 0 ? Math.max(1, Math.min(99, Math.round((transferredBytes / totalBytes) * 100))) : 0
  task.speed = totalBytes > 0 ? `${stageText} ${formatTransferBytes(transferredBytes)} / ${formatTransferBytes(totalBytes)}` : `${stageText} ${formatTransferBytes(transferredBytes)}`
  updateActiveFileTransferTask(task, control)
}

export const fileTransferTaskHosts = (options: FileListOptions) => ({
  ...(transferFromHost(options) ? { fromHost: transferFromHost(options) } : {}),
  ...(transferToHost(options) ? { toHost: transferToHost(options) } : {})
})

export const remoteCopyResultFileCount = (stats: RemoteCopyTransferStats) => (stats.itemKind === 'directory' ? Math.max(stats.fileCount, 1) : 1)

export const remoteCopyChildTask = (name: string, source: string, target: string, options: FileListOptions): BackendFileTransferTaskPayload => ({
  type: 'r2r',
  name,
  source,
  target,
  progress: 100,
  speed: '完成',
  status: 'success',
  stage: 'pending',
  ...fileTransferTaskHosts(options)
})

export const createRemoteCopyTransferTask = (source: string, target: string, stats: RemoteCopyTransferStats, options: FileListOptions) =>
  createBackendFileTransferTask({
    type: 'r2r',
    name: remoteBasename(source),
    source,
    target,
    progress: 100,
    speed: '完成',
    status: 'success',
    ...fileTransferTaskHosts(options),
    ...(stats.itemKind === 'directory'
      ? {
          stage: 'scanning' as const,
          isGroup: true,
          totalFiles: stats.fileCount,
          finishedFiles: stats.fileCount,
          ...(stats.children.length ? { children: stats.children } : {})
        }
      : {})
  })

const taskBasename = (path: string, options: FileListOptions) => (options.kind === 'remote' ? remoteBasename(path) : getLocalBasename(path))
const taskDirname = (path: string, options: FileListOptions) => (options.kind === 'remote' ? remoteDirname(path) : getLocalDirname(path))

export const writeContentTask = (path: string, options: FileContentOptions) =>
  createCompletedBackendFileTransferTask({
    type: 'r2r',
    name: `save ${taskBasename(path, options)}`,
    source: path,
    target: path,
    speed: '已保存',
    ...fileTransferTaskHosts(options)
  })

export const mutationTask = (mutation: FileEntryMutation, resultPath: string, options: FileListOptions): FileTransferTask | undefined => {
  if (mutation.kind === 'rename') return undefined
  if (mutation.kind === 'chmod') {
    return createCompletedBackendFileTransferTask({
      type: 'r2r',
      name: `chmod ${taskBasename(resultPath, options)}`,
      source: resultPath,
      target: mutation.recursive ? 'recursive permissions' : 'permissions',
      ...fileTransferTaskHosts(options)
    })
  }
  if (mutation.kind === 'delete') {
    return createCompletedBackendFileTransferTask({
      type: 'r2r',
      name: `delete ${taskBasename(resultPath, options)}`,
      source: resultPath,
      target: taskDirname(resultPath, options),
      ...fileTransferTaskHosts(options)
    })
  }
  const source = mutation.srcPath
  return createCompletedBackendFileTransferTask({
    type: 'r2r',
    name: taskBasename(resultPath, options),
    source,
    target: resultPath,
    ...fileTransferTaskHosts(options)
  })
}

const findActiveFileTransferTaskIds = (id: string) => {
  const taskId = String(id || '').trim()
  if (!taskId) return []
  const direct = activeFileTransferTasks.get(taskId)
  if (direct) return [direct.id, ...(direct.children || []).map((child) => child.id)]
  for (const task of activeFileTransferTasks.values()) {
    if (task.children?.some((child) => child.id === taskId)) {
      return [task.id, ...(task.children || []).map((child) => child.id)]
    }
  }
  return []
}

export const cancelFileTransferTask = async (input: FileTransferTaskCancelInput): Promise<FileTransferTaskCancelResult> => {
  const id = String(input?.id || '').trim()
  const taskIds = findActiveFileTransferTaskIds(id)
  if (!id) return { ok: false, errorCode: 'FILES_TRANSFER_TASK_ID_REQUIRED', errorMessage: 'File transfer task id is required.' }
  if (!taskIds.length) return { ok: true, data: { id, taskIds: [], status: 'not_found' } }
  const controls = new Set(taskIds.map((taskId) => activeFileTransferControls.get(taskId)).filter((control): control is FileTransferAbortControl => !!control))
  controls.forEach((control) => control.cancel())
  deleteActiveFileTransferTaskIds(taskIds)
  return { ok: true, data: { id, taskIds, status: 'aborted' } }
}

export const resetFileTransferRuntimeForTests = () => {
  activeFileTransferTasks.clear()
  activeFileTransferControls.clear()
  pendingFileTransferProgress.forEach((pending) => clearTimeout(pending.timer))
  pendingFileTransferProgress.clear()
  fileTransferTaskEventSender = null
}

export const listFileTransferTasks = async (): Promise<FileTransferTask[]> =>
  Array.from(activeFileTransferTasks.values()).map(cloneFileTransferTask)
