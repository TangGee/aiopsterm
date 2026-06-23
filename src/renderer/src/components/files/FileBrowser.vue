<template>
  <article
    class="file-browser"
    :class="{ 'transfer-mode': uiMode === 'transfer' }"
  >
    <FileBrowserHeader
      v-model:path-input="pathInput"
      v-model:show-hidden="showHidden"
      :session-kind="session.kind"
      @go-back="goBack"
      @commit-path="commitPath"
      @open-local-folder="openLocalFolder"
      @queue-upload="queueUpload"
      @refresh="() => loadEntries()"
    />

    <p
      v-if="error"
      class="file-error"
    >
      {{ error }}
    </p>

    <FileBrowserTable
      v-model:rename-value="renameValue"
      :ui-mode="uiMode"
      :entries="visibleEntries"
      :loading="loading"
      :drag-active="dragActive"
      :drop-forbidden="dropForbidden"
      :drop-target-path="dropTargetPath"
      :editing-path="editingPath"
      :more-for-path="moreForPath"
      :selected-path="selectedPath"
      :sort-state="sortState"
      :format-size="formatSize"
      :is-draggable-entry="isDraggableEntry"
      @drag-enter="dragActive = true"
      @drag-over="handleDragOver"
      @clear-drop-state="clearFileDropState"
      @drop="handleDrop"
      @toggle-sort="toggleSort"
      @file-drag-start="startFileDrag"
      @file-drag-end="clearOutgoingFileDrag"
      @entry-drag-over="handleEntryDragOver"
      @entry-drop="handleEntryDrop"
      @row-double-click="handleRowDoubleClick"
      @name-area-click="handleNameAreaClick"
      @confirm-rename="confirmRename"
      @cancel-rename="cancelRename"
      @download="downloadEntry"
      @start-rename="startRename"
      @open-permissions="openPermissions"
      @toggle-more="toggleMore"
      @open-move-dialog="openMoveDialog"
      @delete-entry="deleteEntry"
      @copy-path="copyPath"
    />

    <FileBrowserPermissionsModal
      v-model:recursive-permission="recursivePermission"
      :target="permissionsTarget"
      :permission-groups="permissionGroups"
      :permission-options="permissionOptions"
      :permissions="permissions"
      :permission-code="permissionCode"
      @close="permissionsTarget = null"
      @confirm="confirmPermissions"
      @toggle-permission="togglePermission"
    />

    <FileBrowserDeleteModal
      :visible="deleteDialog.visible"
      :entry="deleteDialog.entry"
      @close="closeDeleteDialog"
      @confirm="confirmDeleteEntry"
    />

    <FileBrowserMoveModal
      ref="moveModalRef"
      :move-dialog="moveDialog"
      :conflict-dialog="conflictDialog"
      :target-breadcrumb="targetBreadcrumb"
      :target-sub-dirs="targetSubDirs"
      :dirname="dirname"
      @close-move="closeMoveDialog"
      @start-target-edit="startTargetPathEdit"
      @stop-target-edit="stopTargetPathEdit"
      @update:target-path="moveDialog.targetPath = $event"
      @toggle-target-menu="toggleTargetMenu"
      @enter-target-sub-dir="enterTargetSubDir"
      @jump-target="jumpTarget"
      @confirm-move="confirmMove"
      @conflict-action="handleConflictAction"
      @update:conflict-new-name="conflictDialog.newName = $event"
    />

    <div
      v-if="fileNotice"
      class="file-browser-notice"
    >
      {{ fileNotice }}
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import FileBrowserDeleteModal from '@/components/files/FileBrowserDeleteModal.vue'
import FileBrowserHeader from '@/components/files/FileBrowserHeader.vue'
import FileBrowserMoveModal from '@/components/files/FileBrowserMoveModal.vue'
import FileBrowserPermissionsModal from '@/components/files/FileBrowserPermissionsModal.vue'
import FileBrowserTable from '@/components/files/FileBrowserTable.vue'
import { useFileBrowserRuntime, type FileBrowserOpenFilePayload, type FileBrowserRuntimeProps } from '@/services/files/fileBrowserRuntime'

type PermissionKey = 'owner' | 'group' | 'public'

const props = defineProps<FileBrowserRuntimeProps>()
const emit = defineEmits<{
  (event: 'openFile', payload: FileBrowserOpenFilePayload): void
}>()

const moveModalRef = ref<InstanceType<typeof FileBrowserMoveModal> | null>(null)

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

watch(
  () => moveModalRef.value?.movePathContainer ?? null,
  (container) => {
    movePathContainer.value = container
  },
  { immediate: true, flush: 'post' }
)

const togglePermission = (key: PermissionKey, option: string, checked: boolean) => {
  const current = permissions[key]
  permissions[key] = checked ? Array.from(new Set([...current, option])) : current.filter((item) => item !== option)
}
</script>
