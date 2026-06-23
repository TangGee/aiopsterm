import type { Ref } from 'vue'
import {
  fileBrowserDirname,
  fileBrowserEntryDropDirectory,
  isDraggableFileBrowserEntry,
  joinFileBrowserPath,
  localPathName,
  type FileBrowserEntry
} from '@/services/files/filesRuntime'
import type { FileBrowserBackendRuntime } from '@/services/files/fileBrowserBackendRuntime'
import type { FileBrowserRuntimeProps } from '@/services/files/fileBrowserRuntimeTypes'
import type { useWorkspaceStore } from '@/stores/workspace'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

type FsDragPayload = {
  kind: 'fs-item'
  fromUuid: string
  fromSide: 'left' | 'right'
  srcPath: string
  name: string
  isDir: boolean
}

const FS_DND_MIME = 'application/x-synchro-fs-item'
const FS_DND_TEXT_PREFIX = 'synchro-fs-item:'
const GLOBAL_DND_SIDE_KEY = '__aiopsterm_fs_dnd_from_side__'

export const createFileBrowserTransferRuntime = (input: {
  props: FileBrowserRuntimeProps
  workspace: WorkspaceStore
  backend: FileBrowserBackendRuntime
  currentPath: Ref<string>
  entries: Ref<FileBrowserEntry[]>
  loading: Ref<boolean>
  dragActive: Ref<boolean>
  dropForbidden: Ref<boolean>
  dropTargetPath: Ref<string>
  setFileNotice: (message: string) => void
  loadEntries: (path?: string) => Promise<boolean>
  requireEntriesReload: (path?: string) => Promise<void>
  openLocalFolder: () => Promise<void>
}) => {
  const {
    props,
    workspace,
    backend,
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
  } = input

  const setGlobalDragSide = (side: 'left' | 'right' | null) => {
    ;(globalThis as any)[GLOBAL_DND_SIDE_KEY] = side
  }

  const getGlobalDragSide = () => ((globalThis as any)[GLOBAL_DND_SIDE_KEY] as 'left' | 'right' | null) || null

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

  const isDraggableEntry = (entry: FileBrowserEntry) => isDraggableFileBrowserEntry(entry, props.uiMode, props.panelSide)

  const clearFileDropState = () => {
    dragActive.value = false
    dropForbidden.value = false
    dropTargetPath.value = ''
  }

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

  const queueUpload = async (kind: 'file' | 'directory') => {
    if (props.session.kind === 'local') {
      await openLocalFolder()
      return
    }
    const localPath = await backend.pickLocalPath(
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
      const transfer = await backend.runObservedFileTransfer(
        { kind: kind === 'file' ? 'upload-file' : 'upload-directory', localPath, remoteDirectory: currentPath.value },
        backend.getListOptions()
      )
      if (!backend.applyTransferResult(transfer, '上传失败', `${name} 上传已取消`, `${name} 上传已跳过`)) return
      await requireEntriesReload()
      setFileNotice(`${name} 上传成功`)
    } catch (uploadError) {
      setFileNotice(uploadError instanceof Error ? uploadError.message : '上传失败')
    } finally {
      loading.value = false
    }
  }

  const handleOsFileDrop = async (event: DragEvent) => {
    const localPath = getDroppedLocalPath(event)
    if (!localPath) {
      setFileNotice('无法读取拖入文件路径')
      return
    }
    if (props.session.kind === 'local') {
      const loaded = await loadEntries(fileBrowserDirname(localPath))
      if (loaded) setFileNotice(`已打开 ${currentPath.value}`)
      return
    }

    const name = localPathName(localPath)
    loading.value = true
    try {
      const transfer = await backend.runObservedFileTransfer({ kind: 'upload-path', localPath, remoteDirectory: currentPath.value }, backend.getListOptions())
      if (!backend.applyTransferResult(transfer, '上传失败', `${name} 上传已取消`, `${name} 上传已跳过`)) return
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
          ? backend.getSessionListOptions(sourceSession, { fromHost: sourceSession?.host, toHost: props.session.host })
          : backend.getListOptions({
              fromHost: sourceSession?.host,
              toHost: props.session.host
            })
      const transfer = await backend.runObservedFileTransfer(
        operation,
        transferOptions
      )
      if (!backend.applyTransferResult(transfer, '传输失败', `${payload.name} 传输已取消`, `${payload.name} 传输已跳过`)) return
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
      void queueCrossTransfer(payload, targetDir)
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
      void queueCrossTransfer(payload, targetDir)
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

  return {
    queueUpload,
    isDraggableEntry,
    startFileDrag,
    clearOutgoingFileDrag,
    handleDragOver,
    handleEntryDragOver,
    clearFileDropState,
    handleDrop,
    handleEntryDrop
  }
}
