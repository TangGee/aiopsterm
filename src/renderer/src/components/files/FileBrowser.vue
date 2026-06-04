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
        @click="loadEntries"
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
            @dblclick="entry.type === 'file' && openFile(entry)"
          >
            <td>
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
      <div class="file-modal-card small">
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
import { mockRemoteFileTree } from '@/data/mockData'
import type { FileSessionInfo, MockFileEntry } from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileListEntry } from '@shared/preload'

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
const entries = ref<MockFileEntry[]>([])
const showHidden = ref(true)
const loading = ref(false)
const error = ref('')
const dragActive = ref(false)
const dropForbidden = ref(false)
const dropTargetPath = ref('')
const editingPath = ref('')
const renameValue = ref('')
const moreForPath = ref('')
const permissionsTarget = ref<MockFileEntry | null>(null)
const recursivePermission = ref(false)
const fileNotice = ref('')
const permissions = reactive<Record<'owner' | 'group' | 'public', string[]>>({
  owner: ['读', '写'],
  group: ['读'],
  public: ['读']
})
const deleteDialog = reactive<{ visible: boolean; entry: MockFileEntry | null }>({
  visible: false,
  entry: null
})
const moveDialog = reactive<{
  visible: boolean
  type: 'move' | 'copy'
  entry: MockFileEntry | null
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
const targetSubDirs = reactive<Record<number, MockFileEntry[]>>({})
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

const permissionGroups = [
  { key: 'owner' as const, label: '所有者' },
  { key: 'group' as const, label: '用户组' },
  { key: 'public' as const, label: '公共组' }
]
const permissionOptions = ['读', '写', '执行']
const permissionToModePrefix = (type: MockFileEntry['type']) => {
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

const formatDate = (time: number) => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const mapLocalEntry = (entry: FileListEntry): MockFileEntry => ({
  name: entry.name,
  path: entry.path,
  type: entry.type === 'directory' ? 'directory' : 'file',
  mode: entry.type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
  size: entry.size,
  modifiedAt: formatDate(entry.modifiedAt)
})

const loadLocalEntries = async () => {
  if (!window.aiops) return []
  const list = await window.aiops.listFiles(currentPath.value)
  const parent = currentPath.value === '/' ? [] : [{ name: '..', path: dirname(currentPath.value), type: 'directory' as const, mode: 'drwxr-xr-x', size: 0, modifiedAt: '' }]
  return [...parent, ...list.map(mapLocalEntry)]
}

const loadRemoteEntries = () => {
  const list = mockRemoteFileTree[currentPath.value] || []
  return list.map((entry) => ({ ...entry }))
}

const listDirectoryEntries = async (path: string) => {
  const normalized = normalizePath(path)
  if (props.session.kind === 'local' && window.aiops) {
    const list = await window.aiops.listFiles(normalized)
    return list.map(mapLocalEntry)
  }
  return (mockRemoteFileTree[normalized] || []).map((entry) => ({ ...entry }))
}

const clearTargetSubDirs = () => {
  Object.keys(targetSubDirs).forEach((key) => {
    delete targetSubDirs[Number(key)]
  })
}

const loadEntries = async () => {
  loading.value = true
  error.value = ''
  try {
    entries.value = props.session.kind === 'local' ? await loadLocalEntries() : loadRemoteEntries()
  } catch (fileError) {
    error.value = fileError instanceof Error ? fileError.message : '读取文件失败'
    entries.value = []
  } finally {
    loading.value = false
  }
}

const commitPath = async () => {
  currentPath.value = normalizePath(pathInput.value)
  await loadEntries()
}

const openDirectory = async (entry: MockFileEntry) => {
  currentPath.value = normalizePath(entry.path)
  pathInput.value = currentPath.value
  await loadEntries()
}

const goBack = async () => {
  currentPath.value = dirname(currentPath.value)
  pathInput.value = currentPath.value
  await loadEntries()
}

const openLocalFolder = async () => {
  const result = await window.aiops?.showOpenDialog?.({
    properties: ['openDirectory'],
    defaultPath: currentPath.value
  })
  const pickedPath = result?.canceled ? '' : result?.filePaths?.[0]
  if (!pickedPath) return
  currentPath.value = normalizePath(pickedPath)
  pathInput.value = currentPath.value
  await loadEntries()
  fileNotice.value = `已打开 ${currentPath.value}`
}

const queueUpload = async (kind: 'file' | 'directory') => {
  if (props.session.kind === 'local') {
    await openLocalFolder()
    return
  }
  const result = await window.aiops?.showOpenDialog?.({
    properties: [kind === 'file' ? 'openFile' : 'openDirectory'],
    defaultPath: currentPath.value
  })
  const localPath = result?.canceled ? '' : result?.filePaths?.[0]
  if (!localPath) return
  const name = localPath.split(/[\\/]/).filter(Boolean).at(-1) || (kind === 'file' ? 'upload-file.txt' : 'upload-directory')
  workspace.pushFileTransferTask({
    type: 'upload',
    name,
    source: localPath,
    target: currentPath.value,
    progress: 8,
    speed: 'pending',
    status: 'running',
    toHost: props.session.host,
    stage: kind === 'directory' ? 'scanning' : 'pending',
    isGroup: kind === 'directory',
    totalFiles: kind === 'directory' ? 3 : undefined,
    finishedFiles: kind === 'directory' ? 0 : undefined
  })
  fileNotice.value = `${name} 已加入上传任务`
}

const setGlobalDragSide = (side: 'left' | 'right' | null) => {
  ;(globalThis as any)[GLOBAL_DND_SIDE_KEY] = side
}

const getGlobalDragSide = () => ((globalThis as any)[GLOBAL_DND_SIDE_KEY] as 'left' | 'right' | null) || null

const isDraggableEntry = (entry: MockFileEntry) => props.uiMode === 'transfer' && !!props.panelSide && entry.name !== '..' && entry.type !== 'link'

const startFileDrag = (event: DragEvent, entry: MockFileEntry) => {
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
  if (entry?.type === 'directory' && entry.name !== '..') return entry.path
  return currentPath.value
}

const getTargetType = () => (props.session.kind === 'local' ? 'local' : 'remote')

const queueCrossTransfer = (payload: FsDragPayload, targetDir: string) => {
  const sourceIsLocal = workspace.fileSessions.find((session) => session.id === payload.fromUuid)?.kind === 'local'
  const targetIsLocal = getTargetType() === 'local'
  const targetPath = payload.isDir ? targetDir : joinPath(targetDir, payload.name)
  const taskType = !sourceIsLocal && targetIsLocal ? 'download' : sourceIsLocal && !targetIsLocal ? 'upload' : 'r2r'
  workspace.pushFileTransferTask({
    type: taskType,
    name: payload.name,
    source: payload.srcPath,
    target: targetPath,
    progress: 18,
    speed: 'pending',
    status: 'running',
    fromHost: workspace.fileSessions.find((session) => session.id === payload.fromUuid)?.host,
    toHost: props.session.host,
    stage: payload.isDir ? 'scanning' : 'pending',
    isGroup: payload.isDir,
    totalFiles: payload.isDir ? 3 : undefined,
    finishedFiles: payload.isDir ? 0 : undefined
  })
  fileNotice.value = `${payload.name} 已加入传输任务`
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
    return
  }
  dropForbidden.value = false
  dragActive.value = true
  const targetDir = getDropTargetDirectory(event)
  dropTargetPath.value = targetDir === currentPath.value ? '' : targetDir
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const clearFileDropState = () => {
  dragActive.value = false
  dropForbidden.value = false
  dropTargetPath.value = ''
}

const handleDrop = (event: DragEvent) => {
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
  workspace.pushFileTransferTask({
    type: 'upload',
    name: 'dropped-item',
    source: 'drag-source',
    target: currentPath.value,
    progress: 12,
    speed: 'pending',
    status: 'running'
  })
}

const startRename = (entry: MockFileEntry) => {
  editingPath.value = entry.path
  renameValue.value = entry.name
  moreForPath.value = ''
}

const confirmRename = (entry: MockFileEntry) => {
  const name = renameValue.value.trim()
  if (name) {
    entry.name = name
    entry.path = `${dirname(entry.path)}/${name}`.replace(/\/+/g, '/')
  }
  cancelRename()
}

const cancelRename = () => {
  editingPath.value = ''
  renameValue.value = ''
}

const openPermissions = (entry: MockFileEntry) => {
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

const confirmPermissions = () => {
  if (!permissionsTarget.value) return
  permissionsTarget.value.mode = `${permissionToModePrefix(permissionsTarget.value.type)}${permissionCode.value}`
  workspace.pushFileTransferTask({
    type: 'r2r',
    name: `chmod ${permissionsTarget.value.name}`,
    source: permissionsTarget.value.path,
    target: recursivePermission.value ? 'recursive permissions' : 'permissions',
    progress: 100,
    speed: '完成',
    status: 'success',
    fromHost: props.session.host,
    toHost: props.session.host
  })
  fileNotice.value = `权限已更新为 ${permissionCode.value}`
  permissionsTarget.value = null
}

const toggleMore = (path: string) => {
  moreForPath.value = moreForPath.value === path ? '' : path
}

const downloadEntry = async (entry: MockFileEntry) => {
  const result = await window.aiops?.showSaveDialog?.({
    defaultPath: entry.name
  })
  const localPath = result?.canceled ? '' : result?.filePath
  if (!localPath) return
  workspace.pushFileTransferTask({
    type: 'download',
    name: entry.name,
    source: entry.path,
    target: localPath,
    progress: 18,
    speed: 'pending',
    status: 'running',
    fromHost: props.session.host
  })
  fileNotice.value = `${entry.name} 已加入下载任务`
}

const openFile = (entry: MockFileEntry) => {
  emit('openFile', {
    filePath: entry.path,
    sessionId: props.session.id,
    sessionLabel: props.session.label,
    host: props.session.host
  })
}

const openMoveDialog = (entry: MockFileEntry, type: 'move' | 'copy') => {
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
    await loadTargetSubDirs(index)
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
  const exists = await targetFileExists(moveDialog.targetPath, targetName)
  if (exists) {
    conflictDialog.newName = await buildConflictName(moveDialog.targetPath, targetName)
    conflictDialog.visible = true
    return
  }
  queueMoveTarget(targetName)
}

const queueMoveTarget = (name: string) => {
  if (!moveDialog.entry) return
  workspace.pushFileTransferTask({
    type: 'r2r',
    name,
    source: moveDialog.entry.path,
    target: `${moveDialog.targetPath}/${name}`.replace(/\/+/g, '/'),
    progress: 20,
    speed: 'pending',
    status: 'running',
    fromHost: props.session.host,
    toHost: props.session.host
  })
  closeMoveDialog()
}

const handleConflictAction = (action: 'cancel' | 'rename' | 'overwrite') => {
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
    queueMoveTarget(name)
    return
  }
  queueMoveTarget(moveDialog.entry?.name || 'file')
}

const deleteEntry = (entry: MockFileEntry) => {
  deleteDialog.entry = entry
  deleteDialog.visible = true
  moreForPath.value = ''
}

const closeDeleteDialog = () => {
  deleteDialog.visible = false
  deleteDialog.entry = null
}

const confirmDeleteEntry = () => {
  const entry = deleteDialog.entry
  if (!entry) return
  entries.value = entries.value.filter((item) => item.path !== entry.path)
  workspace.pushFileTransferTask({
    type: 'r2r',
    name: `delete ${entry.name}`,
    source: entry.path,
    target: currentPath.value,
    progress: 100,
    speed: '完成',
    status: 'success',
    fromHost: props.session.host,
    toHost: props.session.host
  })
  fileNotice.value = '删除成功'
  closeDeleteDialog()
}

const copyPath = async (entry: MockFileEntry) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(entry.path)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = entry.path
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    fileNotice.value = '绝对路径已复制'
  } catch (copyError) {
    fileNotice.value = copyError instanceof Error ? copyError.message : '复制绝对路径失败'
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
    pathInput.value = props.session.rootPath
    currentPath.value = props.session.rootPath
    await loadEntries()
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
