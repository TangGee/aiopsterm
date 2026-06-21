import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { filesClient } from '@/services/filesClient'
import {
  fileBrowserDirname,
  fileBrowserEntryDropDirectory,
  fileBrowserRenamePath,
  fileBrowserRowsForDirectory,
  fileBrowserTargetBreadcrumb,
  fileBrowserTargetPathForBreadcrumbIndex,
  filePermissionCode,
  formatFileSize,
  isDraggableFileBrowserEntry,
  joinFileBrowserPath,
  localPathName,
  nextFileBrowserSortState,
  normalizeFileBrowserPath,
  parseFilePermissionMode,
  uniqueConflictFileName,
  visibleFileBrowserEntries,
  type FileBrowserEntry
} from '@/services/filesRuntime'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isFileEntryMutationDataForRequest,
  isFileListEntryData,
  isFileTransferOperationData,
  isFileTransferTaskData,
  malformedFilesBackendResultMessage
} from '@/services/filesBackendGuards'
import type {
  FileEntryMutation,
  FileEntryMutationResult,
  FileListOptions,
  FileSessionInfo,
  FileTransferOperation,
  FileTransferOperationResult,
  FileTransferTask
} from '@shared/contracts/files'

export type FileBrowserRuntimeProps = {
  session: FileSessionInfo
  uiMode: 'transfer' | 'default'
  panelSide?: 'left' | 'right'
}

export type FileBrowserOpenFilePayload = {
  filePath: string
  sessionId: string
  sessionLabel: string
  host: string
}

type FileBrowserRuntimeEmit = (event: 'openFile', payload: FileBrowserOpenFilePayload) => void

export const useFileBrowserRuntime = (props: FileBrowserRuntimeProps, emit: FileBrowserRuntimeEmit) => {

  const workspace = useWorkspaceStore()
  const pathInput = ref(props.session.rootPath)
  const currentPath = ref(props.session.rootPath)
  const entries = ref<FileBrowserEntry[]>([])
  const showHidden = ref(true)
  const loading = ref(false)
  const error = ref('')
  const dragActive = ref(false)
  const dropForbidden = ref(false)
  const dropTargetPath = ref('')
  const editingPath = ref('')
  const renameValue = ref('')
  const moreForPath = ref('')
  const selectedPath = ref('')
  const permissionsTarget = ref<FileBrowserEntry | null>(null)
  const recursivePermission = ref(false)
  const fileNotice = ref('')
  const permissions = reactive<Record<'owner' | 'group' | 'public', string[]>>({
    owner: ['读', '写'],
    group: ['读'],
    public: ['读']
  })
  const deleteDialog = reactive<{ visible: boolean; entry: FileBrowserEntry | null }>({
    visible: false,
    entry: null
  })
  const moveDialog = reactive<{
    visible: boolean
    type: 'move' | 'copy'
    entry: FileBrowserEntry | null
    targetPath: string
    editingPath: boolean
    activeMenuIndex: number | null
  }>({
    visible: false,
    type: 'copy',
    entry: null,
    targetPath: props.session.rootPath,
    editingPath: false,
    activeMenuIndex: null
  })
  const conflictDialog = reactive({ visible: false, newName: '' })
  const targetSubDirs = reactive<Record<number, FileBrowserEntry[]>>({})
  const movePathContainer = ref<HTMLElement | null>(null)
  let fileNoticeTimer: number | null = null
  const sortState = reactive<{ key: 'name' | 'size' | 'modifiedAt'; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  })

  const FS_DND_MIME = 'application/x-synchro-fs-item'
  const FS_DND_TEXT_PREFIX = 'synchro-fs-item:'
  const GLOBAL_DND_SIDE_KEY = '__aiopsterm_fs_dnd_from_side__'

  type FsDragPayload = {
    kind: 'fs-item'
    fromUuid: string
    fromSide: 'left' | 'right'
    srcPath: string
    name: string
    isDir: boolean
  }

  type OpenDialogBridge = NonNullable<ReturnType<typeof localFilesClient.showOpenDialog>>
  type SaveDialogBridge = NonNullable<ReturnType<typeof localFilesClient.showSaveDialog>>

  const permissionGroups = [
    { key: 'owner' as const, label: '所有者' },
    { key: 'group' as const, label: '用户组' },
    { key: 'public' as const, label: '公共组' }
  ]
  const permissionOptions = ['读', '写', '执行']
  const permissionCode = computed(() => filePermissionCode(permissions))
  const visibleEntries = computed(() => visibleFileBrowserEntries(entries.value, showHidden.value, sortState))
  const targetBreadcrumb = computed(() => fileBrowserTargetBreadcrumb(moveDialog.targetPath))
  const dirname = fileBrowserDirname
  const formatSize = formatFileSize

  const setFileNotice = (message: string) => {
    fileNotice.value = message
    if (fileNoticeTimer) window.clearTimeout(fileNoticeTimer)
    if (!message) return
    fileNoticeTimer = window.setTimeout(() => {
      fileNotice.value = ''
      fileNoticeTimer = null
    }, 4500)
  }

  const cleanFileErrorMessage = (fileError: unknown, fallback: string) => {
    const raw = fileError instanceof Error ? fileError.message : String(fileError || fallback)
    const wrapped = raw.match(/^Error invoking remote method '[^']+': Error:\s*(.+)$/)
    return (wrapped?.[1] || raw || fallback).trim()
  }

  const toggleSort = (key: typeof sortState.key) => {
    const nextSort = nextFileBrowserSortState(sortState, key)
    sortState.key = nextSort.key
    sortState.direction = nextSort.direction
  }

  const getListOptions = (overrides: Partial<FileListOptions> = {}): FileListOptions => ({
    sessionId: props.session.id,
    kind: props.session.kind,
    host: props.session.host,
    rootPath: props.session.rootPath,
    jumpHostId: props.session.jumpHostId,
    ...overrides
  })

  const getSessionListOptions = (session: FileSessionInfo | undefined, overrides: Partial<FileListOptions> = {}): FileListOptions =>
    session
      ? {
          sessionId: session.id,
          kind: session.kind,
          host: session.host,
          rootPath: session.rootPath,
          jumpHostId: session.jumpHostId,
          ...overrides
        }
      : getListOptions(overrides)

  const pushBackendTransferTask = (task: unknown, fallbackError: string) => {
    if (!isFileTransferTaskData(task)) throw new Error(fallbackError)
    const normalized = workspace.pushFileTransferTask(task as FileTransferTask)
    if (!normalized) throw new Error(fallbackError)
    return normalized
  }

  const applyTransferResult = (transfer: FileTransferOperationResult, fallbackError: string, cancelledNotice: string, skippedNotice: string) => {
    if (!transfer?.ok) throw new Error(transfer?.errorMessage || fallbackError)
    const data = transfer.data
    if (!isFileTransferOperationData(data)) throw new Error(malformedFilesBackendResultMessage)
    pushBackendTransferTask(data.task, fallbackError)
    if (data.status === 'cancelled') {
      setFileNotice(cancelledNotice)
      return false
    }
    if (data.status === 'skipped') {
      setFileNotice(skippedNotice)
      return false
    }
    return true
  }

  const loadDirectoryEntries = async (path: string) => {
    const listFiles = filesClient.listFiles()
    if (!listFiles) throw new Error('文件列表服务不可用')
    const list = await listFiles(path, getListOptions())
    if (!Array.isArray(list) || !list.every(isFileListEntryData)) throw new Error(malformedFilesBackendResultMessage)
    return fileBrowserRowsForDirectory(path, list)
  }

  const listDirectoryEntries = async (path: string) => {
    const normalized = normalizeFileBrowserPath(path)
    return (await loadDirectoryEntries(normalized)).rows
  }

  const applyMutationResult = (result: FileEntryMutationResult, mutation: FileEntryMutation, fallbackError: string) => {
    if (!result?.ok) throw new Error(result?.errorMessage || fallbackError)
    const data = result.data
    if (!isFileEntryMutationDataForRequest(data, mutation) || typeof data.path !== 'string' || !data.path.trim()) throw new Error(malformedFilesBackendResultMessage)
    if (mutation.kind !== 'rename') pushBackendTransferTask(data.task, fallbackError)
    return data
  }

  const mutateEntry = async (mutation: FileEntryMutation, fallbackError = '文件操作失败') => {
    const mutateFileEntry = filesClient.mutateFileEntry()
    if (!mutateFileEntry) throw new Error('文件操作服务不可用')
    const result = await mutateFileEntry(mutation, getListOptions())
    return applyMutationResult(result, mutation, fallbackError)
  }

  const runObservedFileTransfer = async (operation: FileTransferOperation, options: FileListOptions) => {
    const transferFileEntry = filesClient.transferFileEntry()
    if (!transferFileEntry) throw new Error('文件传输服务不可用')
    const stopObserving = workspace.observeFileTransferTasks()
    try {
      return await transferFileEntry(operation, options)
    } finally {
      stopObserving()
    }
  }

  const pickLocalPath = async (
    options: Parameters<OpenDialogBridge>[0],
    unavailableMessage: string,
    failureMessage: string
  ) => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      setFileNotice(unavailableMessage)
      return ''
    }
    try {
      const result = await showOpenDialog(options)
      return result?.canceled ? '' : result?.filePaths?.[0] || ''
    } catch {
      setFileNotice(failureMessage)
      return ''
    }
  }

  const pickSavePath = async (
    options: Parameters<SaveDialogBridge>[0],
    unavailableMessage: string,
    failureMessage: string
  ) => {
    const showSaveDialog = localFilesClient.showSaveDialog()
    if (!showSaveDialog) {
      setFileNotice(unavailableMessage)
      return ''
    }
    try {
      const result = await showSaveDialog(options)
      return result?.canceled ? '' : result?.filePath || ''
    } catch {
      setFileNotice(failureMessage)
      return ''
    }
  }

  const clearTargetSubDirs = () => {
    Object.keys(targetSubDirs).forEach((key) => {
      delete targetSubDirs[Number(key)]
    })
  }

  const loadEntries = async (path = currentPath.value, options: { preserveOnFailure?: boolean } = {}) => {
    const normalizedPath = normalizeFileBrowserPath(path)
    loading.value = true
    error.value = ''
    try {
      const result = await loadDirectoryEntries(normalizedPath)
      entries.value = result.rows
      currentPath.value = result.path
      pathInput.value = result.path
      if (!entries.value.some((entry) => entry.path === selectedPath.value)) selectedPath.value = ''
      return true
    } catch (fileError) {
      error.value = cleanFileErrorMessage(fileError, '读取文件失败')
      if (options.preserveOnFailure === false) entries.value = []
      return false
    } finally {
      loading.value = false
    }
  }

  const requireEntriesReload = async (path = currentPath.value) => {
    if (!(await loadEntries(path))) throw new Error(error.value || '文件列表加载失败')
  }

  const commitPath = async () => {
    const loaded = await loadEntries(pathInput.value)
    if (!loaded) pathInput.value = currentPath.value
  }

  const openDirectory = async (entry: FileBrowserEntry) => {
    selectedPath.value = entry.path
    const loaded = await loadEntries(entry.path, { preserveOnFailure: true })
    if (!loaded && entry.type === 'link') {
      pathInput.value = currentPath.value
      setFileNotice(error.value || '软连接已选中，不能作为目录展开')
    }
  }

  const handleNameAreaClick = (entry: FileBrowserEntry) => {
    selectedPath.value = entry.path
    if (entry.type === 'file') return
    void openDirectory(entry)
  }

  const handleRowDoubleClick = (entry: FileBrowserEntry) => {
    if (entry.type === 'file') {
      selectedPath.value = entry.path
      openFile(entry)
      return
    }
    handleNameAreaClick(entry)
  }

  const goBack = async () => {
    await loadEntries(dirname(currentPath.value))
  }

  const openLocalFolder = async () => {
    const pickedPath = await pickLocalPath(
      {
        properties: ['openDirectory'],
        defaultPath: currentPath.value
      },
      '打开文件夹对话框服务不可用',
      '打开文件夹对话框失败'
    )
    if (!pickedPath) return
    const loaded = await loadEntries(pickedPath)
    if (loaded) setFileNotice(`已打开 ${currentPath.value}`)
  }

  const queueUpload = async (kind: 'file' | 'directory') => {
    if (props.session.kind === 'local') {
      await openLocalFolder()
      return
    }
    const localPath = await pickLocalPath(
      {
        properties: [kind === 'file' ? 'openFile' : 'openDirectory'],
        defaultPath: currentPath.value
      },
      kind === 'file' ? '上传文件选择对话框服务不可用' : '上传目录选择对话框服务不可用',
      kind === 'file' ? '上传文件选择对话框失败' : '上传目录选择对话框失败'
    )
    if (!localPath) return
    const name = localPathName(localPath, kind === 'file' ? 'upload-file.txt' : 'upload-directory')
    loading.value = true
    try {
      const transfer = await runObservedFileTransfer(
        { kind: kind === 'file' ? 'upload-file' : 'upload-directory', localPath, remoteDirectory: currentPath.value },
        getListOptions()
      )
      if (!applyTransferResult(transfer, '上传失败', `${name} 上传已取消`, `${name} 上传已跳过`)) return
      await requireEntriesReload()
      setFileNotice(`${name} 上传成功`)
    } catch (uploadError) {
      setFileNotice(uploadError instanceof Error ? uploadError.message : '上传失败')
    } finally {
      loading.value = false
    }
  }

  const setGlobalDragSide = (side: 'left' | 'right' | null) => {
    ;(globalThis as any)[GLOBAL_DND_SIDE_KEY] = side
  }

  const getGlobalDragSide = () => ((globalThis as any)[GLOBAL_DND_SIDE_KEY] as 'left' | 'right' | null) || null

  const isDraggableEntry = (entry: FileBrowserEntry) => isDraggableFileBrowserEntry(entry, props.uiMode, props.panelSide)

  const startFileDrag = (event: DragEvent, entry: FileBrowserEntry) => {
    if (!isDraggableEntry(entry) || !event.dataTransfer || !props.panelSide) return
    const payload: FsDragPayload = {
      kind: 'fs-item',
      fromUuid: props.session.id,
      fromSide: props.panelSide,
      srcPath: entry.path,
      name: entry.name,
      isDir: entry.type === 'directory'
    }
    const raw = JSON.stringify(payload)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(FS_DND_MIME, raw)
    event.dataTransfer.setData('text/plain', `${FS_DND_TEXT_PREFIX}${raw}`)
    setGlobalDragSide(props.panelSide)
    dropTargetPath.value = ''
    dropForbidden.value = false
  }

  const clearOutgoingFileDrag = () => {
    setGlobalDragSide(null)
    clearFileDropState()
  }

  const readFsDragPayload = (event: DragEvent): FsDragPayload | null => {
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return null
    let raw = dataTransfer.getData(FS_DND_MIME) || ''
    if (!raw) {
      const text = dataTransfer.getData('text/plain') || ''
      raw = text.startsWith(FS_DND_TEXT_PREFIX) ? text.slice(FS_DND_TEXT_PREFIX.length) : ''
    }
    if (!raw) return null
    try {
      const payload = JSON.parse(raw) as Partial<FsDragPayload>
      if (payload.kind !== 'fs-item' || !payload.fromSide || !payload.fromUuid || !payload.srcPath || !payload.name) return null
      return payload as FsDragPayload
    } catch {
      return null
    }
  }

  const getDropTargetDirectory = (event: DragEvent) => {
    const row = (event.target as HTMLElement | null)?.closest?.('tr') as HTMLTableRowElement | null
    const rowPath = row?.dataset?.path || ''
    const entry = entries.value.find((item) => item.path === rowPath)
    return fileBrowserEntryDropDirectory(entry, currentPath.value)
  }

  const getTargetType = () => (props.session.kind === 'local' ? 'local' : 'remote')

  const getDroppedLocalPath = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files || [])
    const filePath = files.map((file) => String((file as File & { path?: string }).path || '').trim()).find(Boolean)
    return filePath || ''
  }

  const handleOsFileDrop = async (event: DragEvent) => {
    const localPath = getDroppedLocalPath(event)
    if (!localPath) {
      setFileNotice('无法读取拖入文件路径')
      return
    }
    if (props.session.kind === 'local') {
      const loaded = await loadEntries(dirname(localPath))
      if (loaded) setFileNotice(`已打开 ${currentPath.value}`)
      return
    }

    const name = localPathName(localPath)
    loading.value = true
    try {
      const transfer = await runObservedFileTransfer({ kind: 'upload-path', localPath, remoteDirectory: currentPath.value }, getListOptions())
      if (!applyTransferResult(transfer, '上传失败', `${name} 上传已取消`, `${name} 上传已跳过`)) return
      await requireEntriesReload()
      setFileNotice(`${name} 上传成功`)
    } catch (uploadError) {
      setFileNotice(uploadError instanceof Error ? uploadError.message : '上传失败')
    } finally {
      loading.value = false
    }
  }

  const queueCrossTransfer = async (payload: FsDragPayload, targetDir: string) => {
    const sourceSession = workspace.fileSessions.find((session) => session.id === payload.fromUuid)
    const sourceIsLocal = sourceSession?.kind === 'local'
    const targetIsLocal = getTargetType() === 'local'
    const targetPath = payload.isDir ? targetDir : joinFileBrowserPath(targetDir, payload.name)
    loading.value = true
    try {
      const operation = sourceIsLocal
        ? { kind: payload.isDir ? ('upload-directory' as const) : ('upload-file' as const), localPath: payload.srcPath, remoteDirectory: targetDir }
        : targetIsLocal
          ? payload.isDir
            ? { kind: 'download-directory' as const, remotePath: payload.srcPath, localDirectory: targetDir }
            : { kind: 'download-file' as const, remotePath: payload.srcPath, localPath: targetPath }
          : { kind: 'copy-remote' as const, remotePath: payload.srcPath, targetPath }
      const transferOptions =
        targetIsLocal && !sourceIsLocal
          ? getSessionListOptions(sourceSession, { fromHost: sourceSession?.host, toHost: props.session.host })
          : getListOptions({
              fromHost: sourceSession?.host,
              toHost: props.session.host
            })
      const transfer = await runObservedFileTransfer(
        operation,
        transferOptions
      )
      if (!applyTransferResult(transfer, '传输失败', `${payload.name} 传输已取消`, `${payload.name} 传输已跳过`)) return
      await requireEntriesReload()
      setFileNotice(`${payload.name} 传输成功`)
    } catch (transferError) {
      const message = transferError instanceof Error ? transferError.message : '传输失败'
      setFileNotice(message.includes('传输失败') ? message : `传输失败：${message}`)
    } finally {
      loading.value = false
    }
  }

  const handleDragOver = (event: DragEvent) => {
    const sourceSide = getGlobalDragSide()
    const payload = readFsDragPayload(event)
    const dragSourceSide = payload?.fromSide || sourceSide || null
    if (dragSourceSide && props.panelSide && dragSourceSide === props.panelSide) {
      dropForbidden.value = true
      dragActive.value = false
      dropTargetPath.value = ''
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      return
    }
    if (!payload || !dragSourceSide || !props.panelSide) {
      dropForbidden.value = false
      dragActive.value = true
      if (event.dataTransfer && getDroppedLocalPath(event)) event.dataTransfer.dropEffect = 'copy'
      return
    }
    dropForbidden.value = false
    dragActive.value = true
    const targetDir = getDropTargetDirectory(event)
    dropTargetPath.value = targetDir === currentPath.value ? '' : targetDir
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  const handleEntryDragOver = (event: DragEvent, entry: FileBrowserEntry) => {
    if (entry.type !== 'directory' || entry.name === '..') return handleDragOver(event)
    handleDragOver(event)
    if (!dropForbidden.value) dropTargetPath.value = entry.path
  }

  const clearFileDropState = () => {
    dragActive.value = false
    dropForbidden.value = false
    dropTargetPath.value = ''
  }

  const handleDrop = async (event: DragEvent) => {
    const payload = readFsDragPayload(event)
    const sourceSide = getGlobalDragSide()
    if (payload && props.panelSide) {
      const targetDir = getDropTargetDirectory(event)
      clearOutgoingFileDrag()
      if (!sourceSide || payload.fromSide === props.panelSide || payload.fromUuid === props.session.id) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        setFileNotice('同侧文件拖拽不可用')
        return
      }
      queueCrossTransfer(payload, targetDir)
      return
    }
    clearFileDropState()
    const sessionId = event.dataTransfer?.getData('application/x-aiopsterm-file-session')
    if (sessionId && props.panelSide) {
      workspace.openFileSession(sessionId, props.panelSide)
      return
    }
    await handleOsFileDrop(event)
  }

  const handleEntryDrop = async (event: DragEvent, entry: FileBrowserEntry) => {
    if (entry.type !== 'directory' || entry.name === '..') {
      await handleDrop(event)
      return
    }
    const payload = readFsDragPayload(event)
    const sourceSide = getGlobalDragSide()
    const targetDir = fileBrowserEntryDropDirectory(entry, currentPath.value)
    if (payload && props.panelSide) {
      clearOutgoingFileDrag()
      if (!sourceSide || payload.fromSide === props.panelSide || payload.fromUuid === props.session.id) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        setFileNotice('同侧文件拖拽不可用')
        return
      }
      queueCrossTransfer(payload, targetDir)
      return
    }
    clearFileDropState()
    const sessionId = event.dataTransfer?.getData('application/x-aiopsterm-file-session')
    if (sessionId && props.panelSide) {
      workspace.openFileSession(sessionId, props.panelSide)
      return
    }
    await handleOsFileDrop(event)
  }

  const startRename = (entry: FileBrowserEntry) => {
    editingPath.value = entry.path
    renameValue.value = entry.name
    moreForPath.value = ''
  }

  const confirmRename = async (entry: FileBrowserEntry) => {
    const name = renameValue.value.trim()
    if (!name) {
      setFileNotice('请输入新文件名')
      return
    }
    const newPath = fileBrowserRenamePath(entry.path, name)
    if (newPath === entry.path) {
      cancelRename()
      return
    }
    loading.value = true
    try {
      await mutateEntry({ kind: 'rename', oldPath: entry.path, newPath }, '重命名失败')
      await requireEntriesReload()
      cancelRename()
      setFileNotice('重命名成功')
    } catch (renameError) {
      setFileNotice(renameError instanceof Error ? renameError.message : '重命名失败')
    } finally {
      loading.value = false
    }
  }

  const cancelRename = () => {
    editingPath.value = ''
    renameValue.value = ''
  }

  const openPermissions = (entry: FileBrowserEntry) => {
    permissionsTarget.value = entry
    moreForPath.value = ''
    recursivePermission.value = false
    parsePermissionMode(entry.mode)
  }

  const parsePermissionMode = (mode: string) => {
    const parsed = parseFilePermissionMode(mode)
    if (!parsed) return
    permissions.owner = parsed.owner
    permissions.group = parsed.group
    permissions.public = parsed.public
  }

  const confirmPermissions = async () => {
    if (!permissionsTarget.value) return
    const target = permissionsTarget.value
    loading.value = true
    try {
      await mutateEntry({ kind: 'chmod', path: target.path, mode: permissionCode.value, recursive: recursivePermission.value }, '权限更新失败')
      await requireEntriesReload()
      setFileNotice(`权限已更新为 ${permissionCode.value}`)
      permissionsTarget.value = null
    } catch (permissionError) {
      setFileNotice(permissionError instanceof Error ? permissionError.message : '权限更新失败')
    } finally {
      loading.value = false
    }
  }

  const toggleMore = (path: string) => {
    moreForPath.value = moreForPath.value === path ? '' : path
  }

  const downloadEntry = async (entry: FileBrowserEntry) => {
    const localPath = await pickSavePath(
      {
        defaultPath: entry.name
      },
      '下载保存对话框服务不可用',
      '下载保存对话框失败'
    )
    if (!localPath) return
    loading.value = true
    try {
      const transfer = await runObservedFileTransfer({ kind: 'download-file', remotePath: entry.path, localPath }, getListOptions())
      if (!applyTransferResult(transfer, '下载失败', `${entry.name} 下载已取消`, `${entry.name} 下载已跳过`)) return
      setFileNotice(`${entry.name} 下载成功`)
    } catch (downloadError) {
      setFileNotice(downloadError instanceof Error ? downloadError.message : '下载失败')
    } finally {
      loading.value = false
    }
  }

  const openFile = (entry: FileBrowserEntry) => {
    emit('openFile', {
      filePath: entry.path,
      sessionId: props.session.id,
      sessionLabel: props.session.label,
      host: props.session.host
    })
  }

  const openMoveDialog = (entry: FileBrowserEntry, type: 'move' | 'copy') => {
    moveDialog.visible = true
    moveDialog.type = type
    moveDialog.entry = entry
    moveDialog.targetPath = dirname(entry.path)
    moveDialog.editingPath = false
    moveDialog.activeMenuIndex = null
    conflictDialog.visible = false
    conflictDialog.newName = ''
    clearTargetSubDirs()
    moreForPath.value = ''
  }

  const closeMoveDialog = () => {
    moveDialog.visible = false
    moveDialog.entry = null
    moveDialog.editingPath = false
    moveDialog.activeMenuIndex = null
    conflictDialog.visible = false
    conflictDialog.newName = ''
    clearTargetSubDirs()
  }

  const getTargetPathForIndex = (index: number) => {
    return fileBrowserTargetPathForBreadcrumbIndex(moveDialog.targetPath, index)
  }

  const startTargetPathEdit = () => {
    moveDialog.editingPath = true
    moveDialog.activeMenuIndex = null
  }

  const stopTargetPathEdit = () => {
    moveDialog.targetPath = normalizeFileBrowserPath(moveDialog.targetPath)
    moveDialog.editingPath = false
  }

  const loadTargetSubDirs = async (index: number) => {
    const list = await listDirectoryEntries(getTargetPathForIndex(index))
    targetSubDirs[index] = list.filter((entry) => entry.type === 'directory' && entry.name !== '..')
  }

  const toggleTargetMenu = async (index: number) => {
    moveDialog.activeMenuIndex = moveDialog.activeMenuIndex === index ? null : index
    if (moveDialog.activeMenuIndex === index) {
      try {
        await loadTargetSubDirs(index)
      } catch (targetError) {
        moveDialog.activeMenuIndex = null
        setFileNotice(targetError instanceof Error ? targetError.message : '文件列表加载失败')
      }
    }
  }

  const enterTargetSubDir = (index: number, name: string) => {
    const basePath = getTargetPathForIndex(index)
    moveDialog.targetPath = joinFileBrowserPath(basePath, name)
    moveDialog.editingPath = false
    moveDialog.activeMenuIndex = null
    clearTargetSubDirs()
  }

  const getTargetDirectoryNames = async (targetPath: string) => {
    if (normalizeFileBrowserPath(targetPath) === normalizeFileBrowserPath(currentPath.value)) {
      return entries.value.map((entry) => entry.name).filter((name) => name !== '..')
    }
    const list = await listDirectoryEntries(targetPath)
    return list.map((entry) => entry.name).filter((name) => name !== '..')
  }

  const targetFileExists = async (targetPath: string, name: string) => {
    return (await getTargetDirectoryNames(targetPath)).includes(name)
  }

  const buildConflictName = async (targetPath: string, name: string) => {
    return uniqueConflictFileName(await getTargetDirectoryNames(targetPath), name)
  }

  const confirmMove = async () => {
    if (!moveDialog.entry) return
    moveDialog.targetPath = normalizeFileBrowserPath(moveDialog.targetPath)
    moveDialog.editingPath = false
    moveDialog.activeMenuIndex = null
    const targetName = moveDialog.entry.name
    try {
      const exists = await targetFileExists(moveDialog.targetPath, targetName)
      if (exists) {
        conflictDialog.newName = await buildConflictName(moveDialog.targetPath, targetName)
        conflictDialog.visible = true
        return
      }
    } catch (targetError) {
      setFileNotice(targetError instanceof Error ? targetError.message : '文件列表加载失败')
      return
    }
    queueMoveTarget(targetName)
  }

  const queueMoveTarget = async (name: string, overwrite = false) => {
    if (!moveDialog.entry) return
    const entry = moveDialog.entry
    const targetPath = joinFileBrowserPath(moveDialog.targetPath, name)
    loading.value = true
    try {
      await mutateEntry(
        { kind: moveDialog.type, srcPath: entry.path, targetPath, overwrite },
        moveDialog.type === 'copy' ? '复制失败' : '移动失败'
      )
      if (dirname(targetPath) === currentPath.value || moveDialog.type === 'move') await requireEntriesReload()
      setFileNotice(moveDialog.type === 'copy' ? '复制成功' : '移动成功')
      closeMoveDialog()
    } catch (moveError) {
      const fallback = moveDialog.type === 'copy' ? '复制失败' : '移动失败'
      const message = moveError instanceof Error ? moveError.message : fallback
      setFileNotice(message.includes(fallback) ? message : `${fallback}：${message}`)
    } finally {
      loading.value = false
    }
  }

  const handleConflictAction = async (action: 'cancel' | 'rename' | 'overwrite') => {
    if (action === 'cancel') {
      conflictDialog.visible = false
      return
    }
    if (action === 'rename') {
      const name = conflictDialog.newName.trim()
      if (!name) {
        setFileNotice('请输入新文件名')
        return
      }
      await queueMoveTarget(name)
      return
    }
    await queueMoveTarget(moveDialog.entry?.name || 'file', true)
  }

  const deleteEntry = (entry: FileBrowserEntry) => {
    deleteDialog.entry = entry
    deleteDialog.visible = true
    moreForPath.value = ''
  }

  const closeDeleteDialog = () => {
    deleteDialog.visible = false
    deleteDialog.entry = null
  }

  const confirmDeleteEntry = async () => {
    const entry = deleteDialog.entry
    if (!entry) return
    loading.value = true
    try {
      await mutateEntry({ kind: 'delete', path: entry.path, recursive: entry.type === 'directory' }, '删除失败')
      await requireEntriesReload()
      setFileNotice('删除成功')
      closeDeleteDialog()
    } catch (deleteError) {
      setFileNotice(deleteError instanceof Error ? deleteError.message : '删除失败')
    } finally {
      loading.value = false
    }
  }

  const copyPath = async (entry: FileBrowserEntry) => {
    const copied = await copyTextToClipboard(entry.path)
    if (copied) {
      setFileNotice('绝对路径已复制')
    } else {
      setFileNotice('复制绝对路径失败')
    }
    moreForPath.value = ''
  }

  const jumpTarget = (index: number) => {
    moveDialog.targetPath = getTargetPathForIndex(index)
    moveDialog.editingPath = false
    moveDialog.activeMenuIndex = null
    clearTargetSubDirs()
  }

  const onGlobalClick = (event: MouseEvent) => {
    if (!moveDialog.visible || !movePathContainer.value) return
    if (!movePathContainer.value.contains(event.target as Node)) {
      moveDialog.editingPath = false
      moveDialog.activeMenuIndex = null
    }
  }

  watch(
    () => props.session.id,
    async () => {
      currentPath.value = normalizeFileBrowserPath(props.session.rootPath)
      pathInput.value = currentPath.value
      entries.value = []
      await loadEntries(currentPath.value, { preserveOnFailure: false })
    }
  )

  onMounted(() => {
    loadEntries()
    document.addEventListener('click', onGlobalClick)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', onGlobalClick)
    if (fileNoticeTimer) window.clearTimeout(fileNoticeTimer)
  })

  return {
    pathInput,
    showHidden,
    loading,
    error,
    dragActive,
    dropForbidden,
    dropTargetPath,
    editingPath,
    renameValue,
    moreForPath,
    selectedPath,
    permissionsTarget,
    recursivePermission,
    fileNotice,
    permissions,
    deleteDialog,
    moveDialog,
    conflictDialog,
    targetSubDirs,
    movePathContainer,
    sortState,
    permissionGroups,
    permissionOptions,
    permissionCode,
    visibleEntries,
    targetBreadcrumb,
    dirname,
    formatSize,
    toggleSort,
    loadEntries,
    commitPath,
    openLocalFolder,
    queueUpload,
    isDraggableEntry,
    startFileDrag,
    clearOutgoingFileDrag,
    handleDragOver,
    handleEntryDragOver,
    clearFileDropState,
    handleDrop,
    handleEntryDrop,
    handleNameAreaClick,
    handleRowDoubleClick,
    goBack,
    startRename,
    confirmRename,
    cancelRename,
    openPermissions,
    confirmPermissions,
    toggleMore,
    downloadEntry,
    openMoveDialog,
    closeMoveDialog,
    startTargetPathEdit,
    stopTargetPathEdit,
    toggleTargetMenu,
    enterTargetSubDir,
    confirmMove,
    handleConflictAction,
    deleteEntry,
    closeDeleteDialog,
    confirmDeleteEntry,
    copyPath,
    jumpTarget
  }
}
