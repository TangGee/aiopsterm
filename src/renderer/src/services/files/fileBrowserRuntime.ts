import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { windowControlsClient } from '@/services/app/windowControlsClient'
import { createFileBrowserBackendRuntime, cleanFileBrowserErrorMessage } from '@/services/files/fileBrowserBackendRuntime'
import { createFileBrowserEntryActionRuntime } from '@/services/files/fileBrowserEntryActionRuntime'
import { createFileBrowserTransferRuntime } from '@/services/files/fileBrowserTransferRuntime'
import {
  createFileBrowserPathRuntime,
  fileBrowserPathStyleForSession,
  filePermissionCode,
  formatFileSize,
  nextFileBrowserSortState,
  visibleFileBrowserEntries,
  type FileBrowserEntry,
  type FilePermissionSelection,
  type FileBrowserSortState
} from '@/services/files/filesRuntime'
import type {
  FileBrowserConflictDialogState,
  FileBrowserDeleteDialogState,
  FileBrowserMoveDialogState,
  FileBrowserOpenFilePayload,
  FileBrowserRuntimeEmit,
  FileBrowserRuntimeProps
} from '@/services/files/fileBrowserRuntimeTypes'
import { useWorkspaceStore } from '@/stores/workspace'

export type { FileBrowserOpenFilePayload, FileBrowserRuntimeProps } from '@/services/files/fileBrowserRuntimeTypes'

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
  const permissions = reactive<FilePermissionSelection>({
    owner: ['读', '写'],
    group: ['读'],
    public: ['读']
  })
  const deleteDialog = reactive<FileBrowserDeleteDialogState>({
    visible: false,
    entry: null
  })
  const moveDialog = reactive<FileBrowserMoveDialogState>({
    visible: false,
    type: 'copy',
    entry: null,
    targetPath: props.session.rootPath,
    editingPath: false,
    activeMenuIndex: null
  })
  const conflictDialog = reactive<FileBrowserConflictDialogState>({ visible: false, newName: '' })
  const targetSubDirs = reactive<Record<number, FileBrowserEntry[]>>({})
  const movePathContainer = ref<HTMLElement | null>(null)
  const platform = ref('')
  const sortState = reactive<FileBrowserSortState>({
    key: 'name',
    direction: 'asc'
  })

  let fileNoticeTimer: number | null = null

  const permissionGroups = [
    { key: 'owner' as const, label: '所有者' },
    { key: 'group' as const, label: '用户组' },
    { key: 'public' as const, label: '公共组' }
  ]
  const permissionOptions = ['读', '写', '执行']
  const permissionCode = computed(() => filePermissionCode(permissions))
  const visibleEntries = computed(() => visibleFileBrowserEntries(entries.value, showHidden.value, sortState))
  const pathRuntime = computed(() => createFileBrowserPathRuntime(fileBrowserPathStyleForSession(props.session, platform.value)))
  const targetBreadcrumb = computed(() => pathRuntime.value.targetBreadcrumb(moveDialog.targetPath))
  const dirname = (path: string) => pathRuntime.value.dirname(path)
  const formatSize = formatFileSize

  const refreshPlatform = async () => {
    if (props.session.kind !== 'local') {
      platform.value = ''
      return
    }
    platform.value = (await windowControlsClient.platform()?.()) || ''
  }

  const setFileNotice = (message: string) => {
    fileNotice.value = message
    if (fileNoticeTimer) window.clearTimeout(fileNoticeTimer)
    if (!message) return
    fileNoticeTimer = window.setTimeout(() => {
      fileNotice.value = ''
      fileNoticeTimer = null
    }, 4500)
  }

  const backend = createFileBrowserBackendRuntime({
    props,
    workspace,
    setFileNotice,
    pathRuntime
  })

  const toggleSort = (key: typeof sortState.key) => {
    const nextSort = nextFileBrowserSortState(sortState, key)
    sortState.key = nextSort.key
    sortState.direction = nextSort.direction
  }

  const loadEntries = async (path = currentPath.value, options: { preserveOnFailure?: boolean } = {}) => {
    const normalizedPath = pathRuntime.value.normalize(path)
    loading.value = true
    error.value = ''
    try {
      const result = await backend.loadDirectoryEntries(normalizedPath)
      entries.value = result.rows
      currentPath.value = result.path
      pathInput.value = result.path
      if (!entries.value.some((entry) => entry.path === selectedPath.value)) selectedPath.value = ''
      return true
    } catch (fileError) {
      error.value = cleanFileBrowserErrorMessage(fileError, '读取文件失败')
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

  const openLocalFolder = async () => {
    const pickedPath = await backend.pickLocalPath(
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

  const transferRuntime = createFileBrowserTransferRuntime({
    props,
    workspace,
    backend,
    pathRuntime,
    currentPath,
    entries,
    loading,
    dragActive,
    dropForbidden,
    dropTargetPath,
    setFileNotice,
    loadEntries,
    requireEntriesReload,
    openLocalFolder
  })

  const entryActionRuntime = createFileBrowserEntryActionRuntime({
    props,
    emit,
    backend,
    pathRuntime,
    pathInput,
    currentPath,
    entries,
    loading,
    error,
    editingPath,
    renameValue,
    moreForPath,
    selectedPath,
    permissionsTarget,
    recursivePermission,
    permissions,
    deleteDialog,
    moveDialog,
    conflictDialog,
    targetSubDirs,
    movePathContainer,
    permissionCode,
    setFileNotice,
    loadEntries,
    requireEntriesReload
  })

  watch(
    () => props.session.id,
    async () => {
      await refreshPlatform()
      currentPath.value = pathRuntime.value.normalize(props.session.rootPath)
      pathInput.value = currentPath.value
      entries.value = []
      await loadEntries(currentPath.value, { preserveOnFailure: false })
    }
  )

  onMounted(() => {
    void (async () => {
      await refreshPlatform()
      await loadEntries()
    })()
    document.addEventListener('click', entryActionRuntime.onGlobalClick)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', entryActionRuntime.onGlobalClick)
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
    queueUpload: transferRuntime.queueUpload,
    isDraggableEntry: transferRuntime.isDraggableEntry,
    startFileDrag: transferRuntime.startFileDrag,
    clearOutgoingFileDrag: transferRuntime.clearOutgoingFileDrag,
    handleDragOver: transferRuntime.handleDragOver,
    handleEntryDragOver: transferRuntime.handleEntryDragOver,
    clearFileDropState: transferRuntime.clearFileDropState,
    handleDrop: transferRuntime.handleDrop,
    handleEntryDrop: transferRuntime.handleEntryDrop,
    handleNameAreaClick: entryActionRuntime.handleNameAreaClick,
    handleRowDoubleClick: entryActionRuntime.handleRowDoubleClick,
    goBack: entryActionRuntime.goBack,
    startRename: entryActionRuntime.startRename,
    confirmRename: entryActionRuntime.confirmRename,
    cancelRename: entryActionRuntime.cancelRename,
    openPermissions: entryActionRuntime.openPermissions,
    confirmPermissions: entryActionRuntime.confirmPermissions,
    toggleMore: entryActionRuntime.toggleMore,
    downloadEntry: entryActionRuntime.downloadEntry,
    openMoveDialog: entryActionRuntime.openMoveDialog,
    closeMoveDialog: entryActionRuntime.closeMoveDialog,
    startTargetPathEdit: entryActionRuntime.startTargetPathEdit,
    stopTargetPathEdit: entryActionRuntime.stopTargetPathEdit,
    toggleTargetMenu: entryActionRuntime.toggleTargetMenu,
    enterTargetSubDir: entryActionRuntime.enterTargetSubDir,
    confirmMove: entryActionRuntime.confirmMove,
    handleConflictAction: entryActionRuntime.handleConflictAction,
    deleteEntry: entryActionRuntime.deleteEntry,
    closeDeleteDialog: entryActionRuntime.closeDeleteDialog,
    confirmDeleteEntry: entryActionRuntime.confirmDeleteEntry,
    copyPath: entryActionRuntime.copyPath,
    jumpTarget: entryActionRuntime.jumpTarget
  }
}
