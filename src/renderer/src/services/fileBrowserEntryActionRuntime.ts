import type { Ref } from 'vue'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import {
  fileBrowserDirname,
  fileBrowserRenamePath,
  fileBrowserTargetPathForBreadcrumbIndex,
  joinFileBrowserPath,
  normalizeFileBrowserPath,
  parseFilePermissionMode,
  uniqueConflictFileName,
  type FileBrowserEntry,
  type FilePermissionSelection
} from '@/services/filesRuntime'
import type { FileBrowserBackendRuntime } from '@/services/fileBrowserBackendRuntime'
import type {
  FileBrowserConflictDialogState,
  FileBrowserDeleteDialogState,
  FileBrowserMoveDialogState,
  FileBrowserRuntimeEmit,
  FileBrowserRuntimeProps
} from '@/services/fileBrowserRuntimeTypes'

export const createFileBrowserEntryActionRuntime = (input: {
  props: FileBrowserRuntimeProps
  emit: FileBrowserRuntimeEmit
  backend: FileBrowserBackendRuntime
  pathInput: Ref<string>
  currentPath: Ref<string>
  entries: Ref<FileBrowserEntry[]>
  loading: Ref<boolean>
  error: Ref<string>
  editingPath: Ref<string>
  renameValue: Ref<string>
  moreForPath: Ref<string>
  selectedPath: Ref<string>
  permissionsTarget: Ref<FileBrowserEntry | null>
  recursivePermission: Ref<boolean>
  permissions: FilePermissionSelection
  deleteDialog: FileBrowserDeleteDialogState
  moveDialog: FileBrowserMoveDialogState
  conflictDialog: FileBrowserConflictDialogState
  targetSubDirs: Record<number, FileBrowserEntry[]>
  movePathContainer: Ref<HTMLElement | null>
  permissionCode: Ref<string>
  setFileNotice: (message: string) => void
  loadEntries: (path?: string, options?: { preserveOnFailure?: boolean }) => Promise<boolean>
  requireEntriesReload: (path?: string) => Promise<void>
}) => {
  const {
    props,
    emit,
    backend,
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
  } = input

  const clearTargetSubDirs = () => {
    Object.keys(targetSubDirs).forEach((key) => {
      delete targetSubDirs[Number(key)]
    })
  }

  const openFile = (entry: FileBrowserEntry) => {
    emit('openFile', {
      filePath: entry.path,
      sessionId: props.session.id,
      sessionLabel: props.session.label,
      host: props.session.host
    })
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
    await loadEntries(fileBrowserDirname(currentPath.value))
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
      await backend.mutateEntry({ kind: 'rename', oldPath: entry.path, newPath }, '重命名失败')
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

  const parsePermissionMode = (mode: string) => {
    const parsed = parseFilePermissionMode(mode)
    if (!parsed) return
    permissions.owner = parsed.owner
    permissions.group = parsed.group
    permissions.public = parsed.public
  }

  const openPermissions = (entry: FileBrowserEntry) => {
    permissionsTarget.value = entry
    moreForPath.value = ''
    recursivePermission.value = false
    parsePermissionMode(entry.mode)
  }

  const confirmPermissions = async () => {
    if (!permissionsTarget.value) return
    const target = permissionsTarget.value
    loading.value = true
    try {
      await backend.mutateEntry({ kind: 'chmod', path: target.path, mode: permissionCode.value, recursive: recursivePermission.value }, '权限更新失败')
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
    const localPath = await backend.pickSavePath(
      {
        defaultPath: entry.name
      },
      '下载保存对话框服务不可用',
      '下载保存对话框失败'
    )
    if (!localPath) return
    loading.value = true
    try {
      const transfer = await backend.runObservedFileTransfer({ kind: 'download-file', remotePath: entry.path, localPath }, backend.getListOptions())
      if (!backend.applyTransferResult(transfer, '下载失败', `${entry.name} 下载已取消`, `${entry.name} 下载已跳过`)) return
      setFileNotice(`${entry.name} 下载成功`)
    } catch (downloadError) {
      setFileNotice(downloadError instanceof Error ? downloadError.message : '下载失败')
    } finally {
      loading.value = false
    }
  }

  const openMoveDialog = (entry: FileBrowserEntry, type: 'move' | 'copy') => {
    moveDialog.visible = true
    moveDialog.type = type
    moveDialog.entry = entry
    moveDialog.targetPath = fileBrowserDirname(entry.path)
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

  const getTargetPathForIndex = (index: number) => fileBrowserTargetPathForBreadcrumbIndex(moveDialog.targetPath, index)

  const startTargetPathEdit = () => {
    moveDialog.editingPath = true
    moveDialog.activeMenuIndex = null
  }

  const stopTargetPathEdit = () => {
    moveDialog.targetPath = normalizeFileBrowserPath(moveDialog.targetPath)
    moveDialog.editingPath = false
  }

  const loadTargetSubDirs = async (index: number) => {
    const list = await backend.listDirectoryEntries(getTargetPathForIndex(index))
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
    const list = await backend.listDirectoryEntries(targetPath)
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
    void queueMoveTarget(targetName)
  }

  const queueMoveTarget = async (name: string, overwrite = false) => {
    if (!moveDialog.entry) return
    const entry = moveDialog.entry
    const targetPath = joinFileBrowserPath(moveDialog.targetPath, name)
    loading.value = true
    try {
      await backend.mutateEntry(
        { kind: moveDialog.type, srcPath: entry.path, targetPath, overwrite },
        moveDialog.type === 'copy' ? '复制失败' : '移动失败'
      )
      if (fileBrowserDirname(targetPath) === currentPath.value || moveDialog.type === 'move') await requireEntriesReload()
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
      await backend.mutateEntry({ kind: 'delete', path: entry.path, recursive: entry.type === 'directory' }, '删除失败')
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
    setFileNotice(copied ? '绝对路径已复制' : '复制绝对路径失败')
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

  return {
    openFile,
    openDirectory,
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
    jumpTarget,
    onGlobalClick
  }
}
