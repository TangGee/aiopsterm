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
      @dragover.prevent.stop="handleDragOver"
      @dragleave.prevent="clearFileDropState"
      @drop.prevent.stop="handleDrop"
    >
      <table class="file-table">
        <thead>
          <tr>
            <th>
              <button
                class="file-sort-button"
                :class="{ active: sortState.key === 'name' }"
                @click="toggleSort('name')"
              >
                名称
                <span class="file-sort-indicator">
                  <ChevronUp :class="{ active: sortState.key === 'name' && sortState.direction === 'asc' }" />
                  <ChevronDown :class="{ active: sortState.key === 'name' && sortState.direction === 'desc' }" />
                </span>
              </button>
            </th>
            <th v-if="uiMode !== 'transfer'">权限</th>
            <th>
              <button
                class="file-sort-button"
                :class="{ active: sortState.key === 'size' }"
                @click="toggleSort('size')"
              >
                大小
                <span class="file-sort-indicator">
                  <ChevronUp :class="{ active: sortState.key === 'size' && sortState.direction === 'asc' }" />
                  <ChevronDown :class="{ active: sortState.key === 'size' && sortState.direction === 'desc' }" />
                </span>
              </button>
            </th>
            <th>
              <button
                class="file-sort-button"
                :class="{ active: sortState.key === 'modifiedAt' }"
                @click="toggleSort('modifiedAt')"
              >
                修改日期
                <span class="file-sort-indicator">
                  <ChevronUp :class="{ active: sortState.key === 'modifiedAt' && sortState.direction === 'asc' }" />
                  <ChevronDown :class="{ active: sortState.key === 'modifiedAt' && sortState.direction === 'desc' }" />
                </span>
              </button>
            </th>
            <th class="file-actions-heading">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in visibleEntries"
            :key="entry.path"
            :data-path="entry.path"
            :class="{
              directory: entry.type === 'directory',
              link: entry.type === 'link',
              editing: editingPath === entry.path,
              selected: selectedPath === entry.path,
              'file-row-drag-target': dropTargetPath === entry.path
            }"
            :draggable="isDraggableEntry(entry)"
            @dragstart="startFileDrag($event, entry)"
            @dragend="clearOutgoingFileDrag"
            @dragover.prevent="handleEntryDragOver($event, entry)"
            @drop.prevent.stop="handleEntryDrop($event, entry)"
            @dblclick="handleRowDoubleClick(entry)"
          >
            <td @click="editingPath !== entry.path && handleNameAreaClick(entry)">
              <div class="file-name-action-wrap">
                <button
                  v-if="editingPath !== entry.path"
                  class="file-name-cell"
                  @click.stop="handleNameAreaClick(entry)"
                >
                  <FolderFilled v-if="entry.type === 'directory'" />
                  <Link v-else-if="entry.type === 'link'" />
                  <File v-else />
                  <span>{{ entry.name }}</span>
                  <small
                    v-if="entry.type === 'link' && entry.linkTarget"
                    class="file-link-target"
                  >
                    -> {{ entry.linkTarget }}
                  </small>
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

              </div>
            </td>
            <td v-if="uiMode !== 'transfer'">{{ entry.mode }}</td>
            <td>{{ entry.type === 'file' ? formatSize(entry.size) : '' }}</td>
            <td>{{ entry.modifiedAt }}</td>
            <td class="file-actions-cell">
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
import {
  Check,
  ChevronDown,
  ChevronUp,
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
import { useFileBrowserRuntime, type FileBrowserOpenFilePayload, type FileBrowserRuntimeProps } from '@/services/fileBrowserRuntime'

const props = defineProps<FileBrowserRuntimeProps>()
const emit = defineEmits<{
  (event: 'openFile', payload: FileBrowserOpenFilePayload): void
}>()

const {
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
} = useFileBrowserRuntime(props, emit)
</script>
