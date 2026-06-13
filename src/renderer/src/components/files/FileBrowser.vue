<template>
  <article
    class="file-browser"
    :class="{ 'transfer-mode': uiMode === 'transfer' }"
  >
    <header class="file-browser-header">
      <button
        class="file-icon-button primary"
        title="回退"
        @click="goBack"
      >
        <Undo2 />
      </button>
      <input
        v-model="pathInput"
        class="file-path-input"
        @keydown.enter="commitPath"
      />
      <button
        v-if="session.kind === 'local'"
        class="file-icon-button"
        title="打开文件夹"
        @click="openLocalFolder"
      >
        <FolderOpen />
      </button>
      <button
        v-else
        class="file-icon-button"
        title="上传文件"
        @click="queueUpload('file')"
      >
        <UploadCloud />
      </button>
      <button
        v-if="session.kind !== 'local'"
        class="file-icon-button"
        title="上传目录"
        @click="queueUpload('directory')"
      >
        <Upload />
      </button>
      <button
        class="file-icon-button"
        :title="showHidden ? '隐藏隐藏文件' : '显示隐藏文件'"
        @click="showHidden = !showHidden"
      >
        <Eye v-if="showHidden" />
        <EyeOff v-else />
      </button>
      <button
        class="file-icon-button"
        title="刷新"
        @click="() => loadEntries()"
      >
        <RefreshCw />
      </button>
    </header>

    <p
      v-if="error"
      class="file-error"
    >
      {{ error }}
    </p>

    <div
      class="file-drop-zone"
      :class="{ active: dragActive, forbidden: dropForbidden }"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="clearFileDropState"
      @drop.prevent="handleDrop"
    >
      <table class="file-table">
        <thead>
          <tr>
            <th>名称</th>
            <th v-if="uiMode !== 'transfer'">权限</th>
            <th>大小</th>
            <th>修改日期</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in visibleEntries"
            :key="entry.path"
            :data-path="entry.path"
            :class="{
              directory: entry.type === 'directory',
              editing: editingPath === entry.path,
              'file-row-drag-target': dropTargetPath === entry.path
            }"
            :draggable="isDraggableEntry(entry)"
            @dragstart="startFileDrag($event, entry)"
            @dragend="clearOutgoingFileDrag"
            @dragover.prevent="handleEntryDragOver($event, entry)"
            @drop.prevent.stop="handleEntryDrop($event, entry)"
            @dblclick="entry.type === 'file' && openFile(entry)"
          >
            <td>
              <div class="file-name-action-wrap">
                <button
                  v-if="editingPath !== entry.path"
                  class="file-name-cell"
                  @click="entry.type === 'directory' && openDirectory(entry)"
                >
                  <FolderFilled v-if="entry.type === 'directory'" />
                  <Link v-else-if="entry.type === 'link'" />
                  <File v-else />
                  <span>{{ entry.name }}</span>
                </button>
                <div
                  v-else
                  class="file-rename-row"
                >
                  <FolderFilled v-if="entry.type === 'directory'" />
                  <File v-else />
                  <input
                    v-model="renameValue"
                    @keydown.enter="confirmRename(entry)"
                    @keydown.esc="cancelRename"
                  />
                  <button
                    title="确认"
                    @click="confirmRename(entry)"
                  >
                    <Check />
                  </button>
                  <button
                    title="取消"
                    @click="cancelRename"
                  >
                    <X />
                  </button>
                </div>

                <div
                  v-if="editingPath !== entry.path && entry.name !== '..'"
                  class="file-row-actions"
                >
                  <button
                    v-if="entry.type === 'file'"
                    title="下载"
                    @click.stop="downloadEntry(entry)"
                  >
                    <Download />
                  </button>
                  <button
                    title="重命名"
                    @click.stop="startRename(entry)"
                  >
                    <Pencil />
                  </button>
                  <button
                    title="权限"
                    @click.stop="openPermissions(entry)"
                  >
                    <Lock />
                  </button>
                  <button
                    title="更多"
                    @click.stop="toggleMore(entry.path)"
                  >
                    <MoreHorizontal />
                  </button>
                </div>
              </div>

              <div
                v-if="moreForPath === entry.path"
                class="file-more-menu"
              >
                <button @click="openMoveDialog(entry, 'copy')">
                  <Copy />
                  复制
                </button>
                <button @click="openMoveDialog(entry, 'move')">
                  <Scissors />
                  移动
                </button>
                <button @click="deleteEntry(entry)">
                  <Trash2 />
                  删除
                </button>
                <button @click="copyPath(entry)">
                  <Link />
                  复制绝对路径
                </button>
              </div>
            </td>
            <td v-if="uiMode !== 'transfer'">{{ entry.mode }}</td>
            <td>{{ entry.type === 'file' ? formatSize(entry.size) : '' }}</td>
            <td>{{ entry.modifiedAt }}</td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="loading"
        class="file-loading"
      >
        读取中...
      </div>
      <div
        v-if="!loading && !visibleEntries.length"
        class="file-empty"
      >
        暂无文件
      </div>
    </div>

    <div
      v-if="permissionsTarget"
      class="file-modal"
    >
      <div class="file-modal-card small permission-modal">
        <header>
          <strong>权限设置 - {{ permissionsTarget.name }}</strong>
          <button
            title="关闭"
            @click="permissionsTarget = null"
          >
            <X />
          </button>
        </header>
        <div class="permission-grid">
          <label
            v-for="group in permissionGroups"
            :key="group.key"
          >
            <span>{{ group.label }}</span>
            <label
              v-for="option in permissionOptions"
              :key="`${group.key}-${option}`"
              class="permission-check"
            >
              <input
                v-model="permissions[group.key]"
                type="checkbox"
                :value="option"
              />
              {{ option }}
            </label>
          </label>
        </div>
        <label class="permission-code">
          <span>权限</span>
          <input
            :value="permissionCode"
            readonly
          />
        </label>
        <label class="permission-recursive">
          <input
            v-model="recursivePermission"
            type="checkbox"
          />
          应用于子目录
        </label>
        <footer>
          <button @click="permissionsTarget = null">取消</button>
          <button
            class="primary"
            @click="confirmPermissions"
          >
            确认
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="deleteDialog.visible && deleteDialog.entry"
      class="file-modal"
    >
      <div class="file-modal-card small file-delete-confirm">
        <header>
          <strong>删除文件</strong>
          <button
            title="关闭"
            @click="closeDeleteDialog"
          >
            <X />
          </button>
        </header>
        <p>
          确认删除
          <strong>{{ deleteDialog.entry.path }}</strong>
          ？
        </p>
        <footer>
          <button @click="closeDeleteDialog">取消</button>
          <button
            class="danger"
            @click="confirmDeleteEntry"
          >
            删除
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="moveDialog.visible && moveDialog.entry"
      class="file-modal"
      @click.self="closeMoveDialog"
    >
      <div class="file-modal-card">
        <header>
          <strong>{{ moveDialog.type === 'move' ? '移动到' : '复制到' }}</strong>
          <button
            title="关闭"
            @click="closeMoveDialog"
          >
            <X />
          </button>
        </header>
        <label class="modal-field">
          <span>来源路径</span>
          <input
            :value="dirname(moveDialog.entry.path)"
            readonly
          />
        </label>
        <div class="modal-field">
          <span>目标路径</span>
          <div
            ref="movePathContainer"
            class="move-target-path"
            @click="startTargetPathEdit"
          >
            <input
              v-if="moveDialog.editingPath"
              v-model="moveDialog.targetPath"
              class="move-target-input"
              placeholder="请输入目标目录"
              @blur="stopTargetPathEdit"
              @keydown.enter="stopTargetPathEdit"
            />
            <div
              v-else
              class="breadcrumb-row move-breadcrumb-row"
            >
              <span
                v-for="(part, index) in targetBreadcrumb"
                :key="`${part}-${index}`"
                class="move-breadcrumb-item"
              >
                <button
                  class="move-breadcrumb-part"
                  @click.stop="jumpTarget(index)"
                >
                  {{ part }}
                </button>
                <button
                  class="move-breadcrumb-menu-trigger"
                  title="打开目录"
                  @click.stop="toggleTargetMenu(index)"
                >
                  <ChevronDown />
                </button>
                <div
                  v-if="moveDialog.activeMenuIndex === index"
                  class="move-dir-menu"
                >
                  <button
                    v-for="dir in targetSubDirs[index] || []"
                    :key="dir.path"
                    @click.stop="enterTargetSubDir(index, dir.name)"
                  >
                    <FolderFilled />
                    {{ dir.name }}
                  </button>
                  <span v-if="!(targetSubDirs[index] || []).length">暂无子目录</span>
                </div>
              </span>
            </div>
            <button
              class="move-path-edit-trigger"
              @click.stop="startTargetPathEdit"
            >
              编辑
            </button>
          </div>
        </div>
        <footer>
          <button @click="closeMoveDialog">取消</button>
          <button
            class="primary"
            @click="confirmMove"
          >
            确认
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="conflictDialog.visible && moveDialog.entry"
      class="file-modal"
      @click.self="handleConflictAction('cancel')"
    >
      <div class="file-modal-card small">
        <header>
          <strong>冲突提示</strong>
          <button
            title="关闭"
            @click="handleConflictAction('cancel')"
          >
            <X />
          </button>
        </header>
        <p>
          文件 <strong>{{ moveDialog.entry.name }}</strong> 已存在于 {{ moveDialog.targetPath }}，请选择处理方式。
        </p>
        <input
          v-model="conflictDialog.newName"
          placeholder="新文件名"
          @keydown.enter="handleConflictAction('rename')"
        />
        <footer>
          <button @click="handleConflictAction('cancel')">取消</button>
          <button @click="handleConflictAction('rename')">重命名</button>
          <button
            class="danger"
            @click="handleConflictAction('overwrite')"
          >
            覆盖
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="fileNotice"
      class="file-browser-notice"
    >
      {{ fileNotice }}
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  Folder as FolderFilled,
  FolderOpen,
  Link,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2,
  Undo2,
  Upload,
  UploadCloud,
  X
} from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import {
  isFileEntryMutationData,
  isFileEntryMutationDataForRequest,
  isFileListEntryData,
  isFileTransferOperationData,
  isFileTransferTaskData,
  malformedFilesBackendResultMessage
} from '@/services/filesBackendGuards'
import type { FileEntryMutation, FileEntryMutationResult, FileListEntry, FileListOptions, FileSessionInfo, FileTransferOperationResult, FileTransferTask } from '@shared/preload'

type FileBrowserEntry = Omit<FileListEntry, 'mode' | 'modifiedAt'> & {
  mode: string
  modifiedAt: string
}

const props = defineProps<{
  session: FileSessionInfo
  uiMode: 'transfer' | 'default'
  panelSide?: 'left' | 'right'
}>()

const emit = defineEmits<{
  (event: 'openFile', payload: { filePath: string; sessionId: string; sessionLabel: string; host: string }): void
}>()

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

type AiopsBridge = NonNullable<typeof window.aiops>
type OpenDialogBridge = NonNullable<AiopsBridge['showOpenDialog']>
type SaveDialogBridge = NonNullable<AiopsBridge['showSaveDialog']>

const permissionGroups = [
  { key: 'owner' as const, label: '所有者' },
  { key: 'group' as const, label: '用户组' },
  { key: 'public' as const, label: '公共组' }
]
const permissionOptions = ['读', '写', '执行']
const permissionToModePrefix = (type: FileBrowserEntry['type']) => {
  if (type === 'directory') return 'd'
  if (type === 'link') return 'l'
  return '-'
}
const permissionCode = computed(() => {
  const score = (items: string[]) => (items.includes('读') ? 4 : 0) + (items.includes('写') ? 2 : 0) + (items.includes('执行') ? 1 : 0)
  return `${score(permissions.owner)}${score(permissions.group)}${score(permissions.public)}`
})
const visibleEntries = computed(() => {
  if (showHidden.value) return entries.value
  return entries.value.filter((entry) => entry.name === '..' || !entry.name.startsWith('.'))
})
const targetBreadcrumb = computed(() => ['/', ...moveDialog.targetPath.split('/').filter(Boolean)])

const normalizePath = (path: string) => {
  const next = path.trim().replace(/\/+/g, '/')
  return next === '' ? '/' : next
}

const joinPath = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

const dirname = (path: string) => {
  const index = path.lastIndexOf('/')
  if (index <= 0) return '/'
  return path.slice(0, index)
}

const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const getLocalPathName = (path: string, fallback = 'upload') => path.split(/[\\/]/).filter(Boolean).at(-1) || fallback

const formatDate = (time: number) => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const getListOptions = (overrides: Partial<FileListOptions> = {}): FileListOptions => ({
  sessionId: props.session.id,
  kind: props.session.kind,
  host: props.session.host,
  rootPath: props.session.rootPath,
  ...overrides
})

const getSessionListOptions = (session: FileSessionInfo | undefined, overrides: Partial<FileListOptions> = {}): FileListOptions =>
  session
    ? {
        sessionId: session.id,
        kind: session.kind,
        host: session.host,
        rootPath: session.rootPath,
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
    fileNotice.value = cancelledNotice
    return false
  }
  if (data.status === 'skipped') {
    fileNotice.value = skippedNotice
    return false
  }
  return true
}

const mapFileEntry = (entry: FileListEntry): FileBrowserEntry => ({
  name: entry.name,
  path: entry.path,
  type: entry.type,
  mode: entry.mode || (entry.type === 'directory' ? 'drwxr-xr-x' : entry.type === 'link' ? 'lrwxrwxrwx' : '-rw-r--r--'),
  size: entry.size,
  modifiedAt: formatDate(entry.modifiedAt)
})

const loadDirectoryEntries = async (path: string) => {
  if (typeof window.aiops?.listFiles !== 'function') throw new Error('文件列表服务不可用')
  const list = await window.aiops.listFiles(path, getListOptions())
  if (!Array.isArray(list) || !list.every(isFileListEntryData)) throw new Error(malformedFilesBackendResultMessage)
  const rows = list.map(mapFileEntry)
  if (rows.some((entry) => entry.name === '..') || path === '/') return rows
  return [{ name: '..', path: dirname(path), type: 'directory' as const, mode: 'drwxr-xr-x', size: 0, modifiedAt: '' }, ...rows]
}

const listDirectoryEntries = async (path: string) => {
  const normalized = normalizePath(path)
  return loadDirectoryEntries(normalized)
}

const applyMutationResult = (result: FileEntryMutationResult, mutation: FileEntryMutation, fallbackError: string) => {
  if (!result?.ok) throw new Error(result?.errorMessage || fallbackError)
  const data = result.data
  if (!isFileEntryMutationDataForRequest(data, mutation) || typeof data.path !== 'string' || !data.path.trim()) throw new Error(malformedFilesBackendResultMessage)
  if (mutation.kind !== 'rename') pushBackendTransferTask(data.task, fallbackError)
  return data
}

const mutateEntry = async (mutation: FileEntryMutation, fallbackError = '文件操作失败') => {
  const result = await window.aiops.mutateFileEntry(mutation, getListOptions())
  return applyMutationResult(result, mutation, fallbackError)
}

const runObservedFileTransfer = async (operation: Parameters<AiopsBridge['transferFileEntry']>[0], options: FileListOptions) => {
  const stopObserving = workspace.observeFileTransferTasks()
  try {
    return await window.aiops.transferFileEntry(operation, options)
  } finally {
    stopObserving()
  }
}

const pickLocalPath = async (
  options: Parameters<OpenDialogBridge>[0],
  unavailableMessage: string,
  failureMessage: string
) => {
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
    fileNotice.value = unavailableMessage
    return ''
  }
  try {
    const result = await showOpenDialog(options)
    return result?.canceled ? '' : result?.filePaths?.[0] || ''
  } catch {
    fileNotice.value = failureMessage
    return ''
  }
}

const pickSavePath = async (
  options: Parameters<SaveDialogBridge>[0],
  unavailableMessage: string,
  failureMessage: string
) => {
  const showSaveDialog = window.aiops?.showSaveDialog
  if (typeof showSaveDialog !== 'function') {
    fileNotice.value = unavailableMessage
    return ''
  }
  try {
    const result = await showSaveDialog(options)
    return result?.canceled ? '' : result?.filePath || ''
  } catch {
    fileNotice.value = failureMessage
    return ''
  }
}

const clearTargetSubDirs = () => {
  Object.keys(targetSubDirs).forEach((key) => {
    delete targetSubDirs[Number(key)]
  })
}

const loadEntries = async (path = currentPath.value, options: { preserveOnFailure?: boolean } = {}) => {
  const normalizedPath = normalizePath(path)
  loading.value = true
  error.value = ''
  try {
    entries.value = await loadDirectoryEntries(normalizedPath)
    currentPath.value = normalizedPath
    pathInput.value = normalizedPath
    return true
  } catch (fileError) {
    error.value = fileError instanceof Error ? fileError.message : '读取文件失败'
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
  await loadEntries(entry.path)
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
  if (loaded) fileNotice.value = `已打开 ${currentPath.value}`
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
  const name = getLocalPathName(localPath, kind === 'file' ? 'upload-file.txt' : 'upload-directory')
  loading.value = true
  try {
    const transfer = await runObservedFileTransfer(
      { kind: kind === 'file' ? 'upload-file' : 'upload-directory', localPath, remoteDirectory: currentPath.value },
      getListOptions()
    )
    if (!applyTransferResult(transfer, '上传失败', `${name} 上传已取消`, `${name} 上传已跳过`)) return
    await requireEntriesReload()
    fileNotice.value = `${name} 上传成功`
  } catch (uploadError) {
    fileNotice.value = uploadError instanceof Error ? uploadError.message : '上传失败'
  } finally {
    loading.value = false
  }
}

const setGlobalDragSide = (side: 'left' | 'right' | null) => {
  ;(globalThis as any)[GLOBAL_DND_SIDE_KEY] = side
}

const getGlobalDragSide = () => ((globalThis as any)[GLOBAL_DND_SIDE_KEY] as 'left' | 'right' | null) || null

const isDraggableEntry = (entry: FileBrowserEntry) => props.uiMode === 'transfer' && !!props.panelSide && entry.name !== '..' && entry.type !== 'link'

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

const getEntryDropDirectory = (entry?: FileBrowserEntry | null) => {
  if (entry?.type === 'directory' && entry.name !== '..') return entry.path
  return currentPath.value
}

const getDropTargetDirectory = (event: DragEvent) => {
  const row = (event.target as HTMLElement | null)?.closest?.('tr') as HTMLTableRowElement | null
  const rowPath = row?.dataset?.path || ''
  const entry = entries.value.find((item) => item.path === rowPath)
  return getEntryDropDirectory(entry)
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
    fileNotice.value = '无法读取拖入文件路径'
    return
  }
  if (props.session.kind === 'local') {
    const loaded = await loadEntries(dirname(localPath))
    if (loaded) fileNotice.value = `已打开 ${currentPath.value}`
    return
  }

  const name = getLocalPathName(localPath)
  loading.value = true
  try {
    const transfer = await runObservedFileTransfer({ kind: 'upload-path', localPath, remoteDirectory: currentPath.value }, getListOptions())
    if (!applyTransferResult(transfer, '上传失败', `${name} 上传已取消`, `${name} 上传已跳过`)) return
    await requireEntriesReload()
    fileNotice.value = `${name} 上传成功`
  } catch (uploadError) {
    fileNotice.value = uploadError instanceof Error ? uploadError.message : '上传失败'
  } finally {
    loading.value = false
  }
}

const queueCrossTransfer = async (payload: FsDragPayload, targetDir: string) => {
  const sourceSession = workspace.fileSessions.find((session) => session.id === payload.fromUuid)
  const sourceIsLocal = sourceSession?.kind === 'local'
  const targetIsLocal = getTargetType() === 'local'
  const targetPath = payload.isDir ? targetDir : joinPath(targetDir, payload.name)
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
    fileNotice.value = `${payload.name} 传输成功`
  } catch (transferError) {
    fileNotice.value = transferError instanceof Error ? transferError.message : '传输失败'
  } finally {
    loading.value = false
  }
}

const handleDragOver = (event: DragEvent) => {
  const sourceSide = getGlobalDragSide()
  const payload = readFsDragPayload(event)
  if (sourceSide && props.panelSide && sourceSide === props.panelSide) {
    dropForbidden.value = true
    dragActive.value = false
    dropTargetPath.value = ''
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }
  if (!payload || !sourceSide || !props.panelSide) {
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
      fileNotice.value = '同侧文件拖拽不可用'
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
  const targetDir = getEntryDropDirectory(entry)
  if (payload && props.panelSide) {
    clearOutgoingFileDrag()
    if (!sourceSide || payload.fromSide === props.panelSide || payload.fromUuid === props.session.id) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      fileNotice.value = '同侧文件拖拽不可用'
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
    fileNotice.value = '请输入新文件名'
    return
  }
  const newPath = `${dirname(entry.path)}/${name}`.replace(/\/+/g, '/')
  if (newPath === entry.path) {
    cancelRename()
    return
  }
  loading.value = true
  try {
    await mutateEntry({ kind: 'rename', oldPath: entry.path, newPath }, '重命名失败')
    await requireEntriesReload()
    cancelRename()
    fileNotice.value = '重命名成功'
  } catch (renameError) {
    fileNotice.value = renameError instanceof Error ? renameError.message : '重命名失败'
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
  const digits = mode.match(/[0-7]{3}$/)?.[0]
  if (!digits) return
  const applyDigit = (digit: string) => {
    const value = Number(digit)
    const next: string[] = []
    if (value & 4) next.push('读')
    if (value & 2) next.push('写')
    if (value & 1) next.push('执行')
    return next
  }
  permissions.owner = applyDigit(digits[0])
  permissions.group = applyDigit(digits[1])
  permissions.public = applyDigit(digits[2])
}

const confirmPermissions = async () => {
  if (!permissionsTarget.value) return
  const target = permissionsTarget.value
  loading.value = true
  try {
    await mutateEntry({ kind: 'chmod', path: target.path, mode: permissionCode.value, recursive: recursivePermission.value }, '权限更新失败')
    await requireEntriesReload()
    fileNotice.value = `权限已更新为 ${permissionCode.value}`
    permissionsTarget.value = null
  } catch (permissionError) {
    fileNotice.value = permissionError instanceof Error ? permissionError.message : '权限更新失败'
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
    fileNotice.value = `${entry.name} 下载成功`
  } catch (downloadError) {
    fileNotice.value = downloadError instanceof Error ? downloadError.message : '下载失败'
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
  const parts = targetBreadcrumb.value.slice(0, index + 1)
  return normalizePath(parts[0] === '/' ? `/${parts.slice(1).join('/')}` : parts.join('/'))
}

const startTargetPathEdit = () => {
  moveDialog.editingPath = true
  moveDialog.activeMenuIndex = null
}

const stopTargetPathEdit = () => {
  moveDialog.targetPath = normalizePath(moveDialog.targetPath)
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
      fileNotice.value = targetError instanceof Error ? targetError.message : '文件列表加载失败'
    }
  }
}

const enterTargetSubDir = (index: number, name: string) => {
  const basePath = getTargetPathForIndex(index)
  moveDialog.targetPath = normalizePath(`${basePath}/${name}`)
  moveDialog.editingPath = false
  moveDialog.activeMenuIndex = null
  clearTargetSubDirs()
}

const getTargetDirectoryNames = async (targetPath: string) => {
  if (normalizePath(targetPath) === normalizePath(currentPath.value)) {
    return entries.value.map((entry) => entry.name).filter((name) => name !== '..')
  }
  const list = await listDirectoryEntries(targetPath)
  return list.map((entry) => entry.name).filter((name) => name !== '..')
}

const targetFileExists = async (targetPath: string, name: string) => {
  return (await getTargetDirectoryNames(targetPath)).includes(name)
}

const buildConflictName = async (targetPath: string, name: string) => {
  const names = new Set(await getTargetDirectoryNames(targetPath))
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

const confirmMove = async () => {
  if (!moveDialog.entry) return
  moveDialog.targetPath = normalizePath(moveDialog.targetPath)
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
    fileNotice.value = targetError instanceof Error ? targetError.message : '文件列表加载失败'
    return
  }
  queueMoveTarget(targetName)
}

const queueMoveTarget = async (name: string, overwrite = false) => {
  if (!moveDialog.entry) return
  const entry = moveDialog.entry
  const targetPath = `${moveDialog.targetPath}/${name}`.replace(/\/+/g, '/')
  loading.value = true
  try {
    await mutateEntry(
      { kind: moveDialog.type, srcPath: entry.path, targetPath, overwrite },
      moveDialog.type === 'copy' ? '复制失败' : '移动失败'
    )
    if (dirname(targetPath) === currentPath.value || moveDialog.type === 'move') await requireEntriesReload()
    fileNotice.value = moveDialog.type === 'copy' ? '复制成功' : '移动成功'
    closeMoveDialog()
  } catch (moveError) {
    fileNotice.value = moveError instanceof Error ? moveError.message : moveDialog.type === 'copy' ? '复制失败' : '移动失败'
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
      fileNotice.value = '请输入新文件名'
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
    fileNotice.value = '删除成功'
    closeDeleteDialog()
  } catch (deleteError) {
    fileNotice.value = deleteError instanceof Error ? deleteError.message : '删除失败'
  } finally {
    loading.value = false
  }
}

const copyPath = async (entry: FileBrowserEntry) => {
  const copied = await copyTextToClipboard(entry.path)
  if (copied) {
    fileNotice.value = '绝对路径已复制'
  } else {
    fileNotice.value = '复制绝对路径失败'
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
    currentPath.value = normalizePath(props.session.rootPath)
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
})
</script>
