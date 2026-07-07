import { computed, type Ref } from 'vue'
import {
  isFileSessionCatalogData,
  isFileSessionFolderDeleteData,
  isFileSessionFolderMutationData,
  isFileSessionInfoData,
  isFileSessionMutationData,
  isFileTransferTaskCancelData,
  isFileTransferTaskData,
  malformedFilesBackendResultMessage
} from '@/services/files/filesBackendGuards'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'
import { filesClient } from '@/services/files/filesClient'
import {
  affectedFileTransferTaskIds as affectedFileTransferTaskIdsRuntime,
  cloneFileSessionCatalog,
  defaultFileOpenSide,
  defaultFileSessionSide,
  fileSessionTerminalContextForPanel,
  fileTransferOverallPercent,
  fileTransferTaskRemovalDelay,
  findFileSession,
  findFileSessionForSftpPayload,
  groupFileTransferTasks,
  hasRunningFileTransferTasks as hasRunningFileTransferTasksRuntime,
  markFileTransferTasksCancelled as markFileTransferTasksCancelledRuntime,
  mergeFileTransferTaskSnapshot as mergeFileTransferTaskSnapshotRuntime,
  nextSelectedFileSessionIds,
  normalizeFileSessionFolderSaveInput,
  normalizeFileTransferTask,
  normalizeFileTransferTaskSnapshot,
  openFileSessionSelection,
  upsertFileTransferTask
} from '@/services/files/filesRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type {
  FileSessionCatalog,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionPatch,
  FileTransferTask,
  FileTransferTaskEvent
} from '@shared/contracts/files'

export type FilesUiMode = 'transfer' | 'default'

const fileTransferTaskEventBridge = createBridgeMethod<Pick<AiopsPreloadApi, 'onFileTransferTaskEvent'>>()

type WorkspaceFilesControllerState = {
  filesUiMode: Ref<FilesUiMode>
  fileSessions: Ref<FileSessionInfo[]>
  fileSessionFolders: Ref<FileSessionFolderRecord[]>
  selectedLeftFileSessionId: Ref<string | null>
  selectedRightFileSessionId: Ref<string | null>
  fileTransferTasks: Ref<FileTransferTask[]>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
}

type WorkspaceFilesControllerDeps = {
  setTopNotice: (message: string) => void
  setActiveModule: (key: 'files') => void
}

export const createWorkspaceFilesController = (state: WorkspaceFilesControllerState, deps: WorkspaceFilesControllerDeps) => {
  const {
    filesUiMode,
    fileSessions,
    fileSessionFolders,
    selectedLeftFileSessionId,
    selectedRightFileSessionId,
    fileTransferTasks,
    activePanelId,
    panels
  } = state
  const { setTopNotice, setActiveModule } = deps

  const fileTransferTaskRemovalTimers = new Map<string, number>()
  let fileTransferTaskObserverCount = 0
  let stopFileTransferTaskEvents: (() => void) | null = null

  const selectedLeftFileSession = computed(() => findFileSession(fileSessions.value, selectedLeftFileSessionId.value))
  const selectedRightFileSession = computed(() => findFileSession(fileSessions.value, selectedRightFileSessionId.value))
  const transferTaskGroups = computed(() => groupFileTransferTasks(fileTransferTasks.value))
  const transferTaskCount = computed(() => fileTransferTasks.value.length)
  const transferOverallPercent = computed(() => fileTransferOverallPercent(fileTransferTasks.value))
  const hasRunningFileTransferTasks = computed(() => hasRunningFileTransferTasksRuntime(fileTransferTasks.value))

  const setFilesUiMode = (mode: FilesUiMode) => {
    filesUiMode.value = mode
  }

  const clearFileTransferTaskRemovalTimer = (id: string) => {
    const timer = fileTransferTaskRemovalTimers.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    fileTransferTaskRemovalTimers.delete(id)
  }

  const normalizedFileTransferTaskSnapshot = (tasks: unknown[]) => {
    if (!tasks.every(isFileTransferTaskData)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return normalizeFileTransferTaskSnapshot(tasks)
  }

  const mergeFileTransferTaskSnapshot = (snapshot: FileTransferTask[], options: { replaceCompleted?: boolean } = {}) => {
    fileTransferTasks.value = mergeFileTransferTaskSnapshotRuntime(fileTransferTasks.value, snapshot, options)
    snapshot.forEach((task) => clearFileTransferTaskRemovalTimer(task.id))
    return true
  }

  const refreshFileTransferTasks = async (options: { replaceCompleted?: boolean } = {}) => {
    const listFileTransferTasksBridge = filesClient.listFileTransferTasks()
    if (!listFileTransferTasksBridge) {
      setTopNotice('文件传输任务加载服务不可用')
      return false
    }
    try {
      const tasks = await listFileTransferTasksBridge()
      if (!Array.isArray(tasks)) {
        setTopNotice(malformedFilesBackendResultMessage)
        return false
      }
      const snapshot = normalizedFileTransferTaskSnapshot(tasks)
      if (!snapshot) return false
      mergeFileTransferTaskSnapshot(snapshot, options)
      return true
    } catch {
      setTopNotice('文件传输任务加载失败')
      return false
    }
  }

  const applyFileSessionCatalog = (catalog: FileSessionCatalog) => {
    if (!isFileSessionCatalogData(catalog)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    const nextCatalog = cloneFileSessionCatalog(catalog)
    fileSessions.value = nextCatalog.sessions
    fileSessionFolders.value = nextCatalog.folders
    const selection = nextSelectedFileSessionIds(fileSessions.value, selectedLeftFileSessionId.value, selectedRightFileSessionId.value)
    selectedLeftFileSessionId.value = selection.left
    selectedRightFileSessionId.value = selection.right
    return catalog
  }

  const refreshFileSessionCatalog = async () => {
    const listFileSessionCatalogBridge = filesClient.listFileSessionCatalog()
    if (!listFileSessionCatalogBridge) {
      setTopNotice('文件会话加载服务不可用')
      return null
    }
    try {
      const result = await listFileSessionCatalogBridge()
      if (!result?.ok || !result.data) {
        setTopNotice(result?.errorMessage || '文件会话加载失败')
        return null
      }
      return applyFileSessionCatalog(result.data)
    } catch {
      setTopNotice('文件会话加载失败')
      return null
    }
  }

  const applyFileSessionRecordMutationResult = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['saveFileSession']>>> | undefined,
    fallbackNotice = '文件会话写入失败'
  ) => {
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || fallbackNotice)
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const applyFileSessionFolderMutationResult = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['saveFileSessionFolder']>>> | undefined,
    fallbackNotice = '文件会话文件夹写入失败'
  ) => {
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || fallbackNotice)
      return null
    }
    if (!isFileSessionFolderMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const applyFileSessionFolderDeleteResult = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['deleteFileSessionFolder']>>> | undefined,
    uuid: string,
    fallbackNotice = '文件会话文件夹删除失败'
  ) => {
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || fallbackNotice)
      return null
    }
    if (!isFileSessionFolderDeleteData(result.data, uuid)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const persistFileSession = async (session: FileSessionInfo) => {
    const saveFileSessionBridge = filesClient.saveFileSession()
    if (!saveFileSessionBridge) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    try {
      return applyFileSessionRecordMutationResult(await saveFileSessionBridge({ ...session }))
    } catch {
      setTopNotice('文件会话写入失败')
      return null
    }
  }

  const updateFileSession = async (id: string, patch: FileSessionPatch) => {
    const session = fileSessions.value.find((item) => item.id === id)
    if (!session) return null
    const updateFileSessionBridge = filesClient.updateFileSession()
    if (!updateFileSessionBridge) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    const previous = { ...session }
    Object.assign(session, patch)
    try {
      const result = await updateFileSessionBridge(id, patch)
      const applied = applyFileSessionRecordMutationResult(result)
      if (!applied) Object.assign(session, previous)
      return applied && result?.data && isFileSessionInfoData(result.data.session) ? result.data.session : null
    } catch {
      Object.assign(session, previous)
      setTopNotice('文件会话写入失败')
      return null
    }
  }

  const saveFileSessionFolder = async (folder: FileSessionFolderSaveInput) => {
    const normalized = normalizeFileSessionFolderSaveInput(folder)
    if (!normalized) return null
    const saveFileSessionFolderBridge = filesClient.saveFileSessionFolder()
    if (!saveFileSessionFolderBridge) {
      setTopNotice('文件会话文件夹写入服务不可用')
      return null
    }
    try {
      const result = await saveFileSessionFolderBridge(normalized)
      const applied = applyFileSessionFolderMutationResult(result, '文件会话文件夹写入失败')
      return applied && result?.data ? result.data.folder : null
    } catch {
      setTopNotice('文件会话文件夹写入失败')
      return null
    }
  }

  const deleteFileSessionFolder = async (uuid: string) => {
    const deleteFileSessionFolderBridge = filesClient.deleteFileSessionFolder()
    if (!deleteFileSessionFolderBridge) {
      setTopNotice('文件会话文件夹删除服务不可用')
      return false
    }
    try {
      const result = await deleteFileSessionFolderBridge(uuid)
      return Boolean(applyFileSessionFolderDeleteResult(result, uuid, '文件会话文件夹删除失败'))
    } catch {
      setTopNotice('文件会话文件夹删除失败')
      return false
    }
  }

  const scheduleFileTransferTaskRemoval = (id: string, delay = 800) => {
    clearFileTransferTaskRemovalTimer(id)
    const timer = window.setTimeout(() => {
      fileTransferTasks.value = fileTransferTasks.value.filter((item) => item.id !== id)
      fileTransferTaskRemovalTimers.delete(id)
    }, delay)
    fileTransferTaskRemovalTimers.set(id, timer)
  }

  const stopFileTransferTaskEventsIfIdle = () => {
    if (fileTransferTaskObserverCount > 0 || hasRunningFileTransferTasks.value || !stopFileTransferTaskEvents) return
    stopFileTransferTaskEvents()
    stopFileTransferTaskEvents = null
  }

  const applyFileTransferTaskEvent = (event: FileTransferTaskEvent) => {
    // 主进程异常中止的任务不会再推送终态，收到 running 态的 finished 事件时直接移除残留项
    if (event.kind === 'finished' && event.task.status === 'running') {
      clearFileTransferTaskRemovalTimer(event.task.id)
      fileTransferTasks.value = fileTransferTasks.value.filter((item) => item.id !== event.task.id)
    } else {
      pushFileTransferTask(event.task)
    }
    if (event.kind === 'finished') stopFileTransferTaskEventsIfIdle()
  }

  const startFileTransferTaskEvents = () => {
    if (stopFileTransferTaskEvents) return
    const onFileTransferTaskEvent = fileTransferTaskEventBridge('onFileTransferTaskEvent')
    if (!onFileTransferTaskEvent) {
      setTopNotice('文件传输任务事件服务不可用')
      return
    }
    stopFileTransferTaskEvents = onFileTransferTaskEvent(applyFileTransferTaskEvent)
  }

  const observeFileTransferTasks = () => {
    fileTransferTaskObserverCount += 1
    startFileTransferTaskEvents()
    void refreshFileTransferTasks()
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      fileTransferTaskObserverCount = Math.max(0, fileTransferTaskObserverCount - 1)
      stopFileTransferTaskEventsIfIdle()
    }
  }

  const selectFileSession = (side: 'left' | 'right', id: string | null) => {
    if (side === 'left') {
      selectedLeftFileSessionId.value = id
      return
    }
    selectedRightFileSessionId.value = id
  }

  const openFileSession = (sessionId: string, side: 'left' | 'right' = defaultFileOpenSide(selectedLeftFileSessionId.value)) => {
    const selection = openFileSessionSelection(fileSessions.value, sessionId, side, selectedLeftFileSessionId.value, selectedRightFileSessionId.value)
    if (!selection.session) return
    selectedLeftFileSessionId.value = selection.left
    selectedRightFileSessionId.value = selection.right
  }

  const fileSideForTerminalPanel = () => defaultFileSessionSide(selectedLeftFileSessionId.value, selectedRightFileSessionId.value)

  const ensureFileSessionForTerminalPanel = async (panelId = activePanelId.value, side: 'left' | 'right' = fileSideForTerminalPanel()) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || panel.kind === 'knowledge') return null
    const saveFileSessionFromTerminalContextBridge = filesClient.saveFileSessionFromTerminalContext()
    if (!saveFileSessionFromTerminalContextBridge) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveFileSessionFromTerminalContextBridge(fileSessionTerminalContextForPanel(panel))
    } catch {
      setTopNotice('文件会话创建失败')
      return null
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }

    if (!applyFileSessionCatalog(result.data)) return null
    const session = result.data.session
    setFilesUiMode('transfer')
    openFileSession(session.id, side)
    setActiveModule('files')
    return session
  }

  const closeFileSession = (side: 'left' | 'right') => {
    selectFileSession(side, null)
  }

  const addRemoteFileSession = async (assetId: string, side: 'left' | 'right' = 'left') => {
    const known = fileSessions.value.find((item) => item.id === assetId)
    if (known) {
      openFileSession(assetId, side)
      return known
    }
    const saveFileSessionFromTerminalContextBridge = filesClient.saveFileSessionFromTerminalContext()
    if (!saveFileSessionFromTerminalContextBridge) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveFileSessionFromTerminalContextBridge({
        kind: 'ssh',
        panelTitle: assetId,
        panelStatus: 'running',
        ssh: {
          assetId
        }
      })
    } catch {
      setTopNotice('文件会话创建失败')
      return null
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    if (!applyFileSessionCatalog(result.data)) return null
    const session = result.data.session
    openFileSession(session.id, side)
    return session
  }

  const addRemoteFileSessionFromSftpPayload = async (payload: Record<string, unknown>, side: 'left' | 'right' = 'left') => {
    const known = findFileSessionForSftpPayload(fileSessions.value, payload)
    if (known) {
      openFileSession(known.id, side)
      return known
    }
    const saveFileSessionFromSftpPayloadBridge = filesClient.saveFileSessionFromSftpPayload()
    if (!saveFileSessionFromSftpPayloadBridge) {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveFileSessionFromSftpPayloadBridge({ ...payload })
    } catch {
      setTopNotice('文件会话创建失败')
      return null
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    if (!applyFileSessionCatalog(result.data)) return null
    const session = result.data.session
    openFileSession(session.id, side)
    return session
  }

  const pushFileTransferTask = (task: FileTransferTask) => {
    if (!isFileTransferTaskData(task)) return null
    const normalized = normalizeFileTransferTask(task)
    if (!normalized) return null
    clearFileTransferTaskRemovalTimer(normalized.id)
    fileTransferTasks.value = upsertFileTransferTask(fileTransferTasks.value, normalized)
    const removalDelay = fileTransferTaskRemovalDelay(normalized)
    if (removalDelay !== null) scheduleFileTransferTaskRemoval(normalized.id, removalDelay)
    return normalized
  }

  const affectedFileTransferTaskIds = (id: string) => affectedFileTransferTaskIdsRuntime(fileTransferTasks.value, id)

  const markFileTransferTasksCancelled = (ids: Iterable<string>) => {
    const taskIds = new Set(ids)
    fileTransferTasks.value = markFileTransferTasksCancelledRuntime(fileTransferTasks.value, taskIds)
    fileTransferTasks.value.filter((task) => taskIds.has(task.id)).forEach((task) => scheduleFileTransferTaskRemoval(task.id, 800))
  }

  const cancelFileTransferTask = async (id: string) => {
    const cancelFileTransferTaskBridge = filesClient.cancelFileTransferTask()
    if (!cancelFileTransferTaskBridge) {
      setTopNotice('取消传输任务服务不可用')
      return false
    }
    let result
    try {
      result = await cancelFileTransferTaskBridge({ id })
    } catch {
      setTopNotice('取消传输任务失败')
      return false
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '取消传输任务失败')
      return false
    }
    if (!isFileTransferTaskCancelData(result.data) || result.data.id !== id) {
      setTopNotice(malformedFilesBackendResultMessage)
      return false
    }
    if (result.data.status !== 'aborted') {
      setTopNotice('传输任务已结束或不存在')
      return false
    }
    markFileTransferTasksCancelled(result.data.taskIds.length ? result.data.taskIds : affectedFileTransferTaskIds(id))
    void refreshFileTransferTasks().finally(stopFileTransferTaskEventsIfIdle)
    return true
  }

  return {
    selectedLeftFileSession,
    selectedRightFileSession,
    transferTaskGroups,
    transferTaskCount,
    transferOverallPercent,
    hasRunningFileTransferTasks,
    refreshFileSessionCatalog,
    refreshFileTransferTasks,
    setFilesUiMode,
    selectFileSession,
    openFileSession,
    ensureFileSessionForTerminalPanel,
    closeFileSession,
    addRemoteFileSession,
    addRemoteFileSessionFromSftpPayload,
    persistFileSession,
    updateFileSession,
    saveFileSessionFolder,
    deleteFileSessionFolder,
    pushFileTransferTask,
    observeFileTransferTasks,
    cancelFileTransferTask
  }
}
