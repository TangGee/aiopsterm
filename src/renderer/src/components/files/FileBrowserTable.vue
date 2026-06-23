<template>
  <div
    class="file-drop-zone"
    :class="{ active: dragActive, forbidden: dropForbidden }"
    @dragenter.prevent="$emit('drag-enter')"
    @dragover.prevent.stop="$emit('drag-over', $event)"
    @dragleave.prevent="$emit('clear-drop-state')"
    @drop.prevent.stop="$emit('drop', $event)"
  >
    <table class="file-table">
      <thead>
        <tr>
          <th>
            <button
              class="file-sort-button"
              :class="{ active: sortState.key === 'name' }"
              @click="$emit('toggle-sort', 'name')"
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
              @click="$emit('toggle-sort', 'size')"
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
              @click="$emit('toggle-sort', 'modifiedAt')"
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
          v-for="entry in entries"
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
          @dragstart="$emit('file-drag-start', $event, entry)"
          @dragend="$emit('file-drag-end')"
          @dragover.prevent="$emit('entry-drag-over', $event, entry)"
          @drop.prevent.stop="$emit('entry-drop', $event, entry)"
          @dblclick="$emit('row-double-click', entry)"
        >
          <td @click="editingPath !== entry.path && $emit('name-area-click', entry)">
            <div class="file-name-action-wrap">
              <button
                v-if="editingPath !== entry.path"
                class="file-name-cell"
                @click.stop="$emit('name-area-click', entry)"
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
                  :value="renameValue"
                  @input="$emit('update:rename-value', ($event.target as HTMLInputElement).value)"
                  @keydown.enter="$emit('confirm-rename', entry)"
                  @keydown.esc="$emit('cancel-rename')"
                />
                <button
                  title="确认"
                  @click="$emit('confirm-rename', entry)"
                >
                  <Check />
                </button>
                <button
                  title="取消"
                  @click="$emit('cancel-rename')"
                >
                  <X />
                </button>
              </div>
            </div>
          </td>
          <td v-if="uiMode !== 'transfer'">{{ entry.mode }}</td>
          <td>{{ entry.type === 'file' ? formatSize(entry.size || 0) : '' }}</td>
          <td>{{ entry.modifiedAt }}</td>
          <td class="file-actions-cell">
            <div
              v-if="editingPath !== entry.path && entry.name !== '..'"
              class="file-row-actions"
              @click.stop
            >
              <button
                v-if="entry.type === 'file'"
                title="下载"
                @click.stop="$emit('download', entry)"
              >
                <Download />
              </button>
              <button
                title="重命名"
                @click.stop="$emit('start-rename', entry)"
              >
                <Pencil />
              </button>
              <button
                title="权限"
                @click.stop="$emit('open-permissions', entry)"
              >
                <Lock />
              </button>
              <button
                title="更多"
                @click.stop="$emit('toggle-more', entry.path)"
              >
                <MoreHorizontal />
              </button>
            </div>

            <div
              v-if="moreForPath === entry.path"
              class="file-more-menu"
            >
              <button @click="$emit('open-move-dialog', entry, 'copy')">
                <Copy />
                复制
              </button>
              <button @click="$emit('open-move-dialog', entry, 'move')">
                <Scissors />
                移动
              </button>
              <button @click="$emit('delete-entry', entry)">
                <Trash2 />
                删除
              </button>
              <button @click="$emit('copy-path', entry)">
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
      v-if="!loading && !entries.length"
      class="file-empty"
    >
      暂无文件
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  File,
  Folder as FolderFilled,
  Link,
  Lock,
  MoreHorizontal,
  Pencil,
  Scissors,
  Trash2,
  X
} from 'lucide-vue-next'
import type { FileBrowserEntry, FileBrowserSortState } from '@/services/files/filesRuntime'

defineProps<{
  uiMode: 'transfer' | 'default'
  entries: FileBrowserEntry[]
  loading: boolean
  dragActive: boolean
  dropForbidden: boolean
  dropTargetPath: string
  editingPath: string
  renameValue: string
  moreForPath: string
  selectedPath: string
  sortState: FileBrowserSortState
  formatSize: (size: number) => string
  isDraggableEntry: (entry: FileBrowserEntry) => boolean
}>()

defineEmits<{
  'drag-enter': []
  'drag-over': [event: DragEvent]
  'clear-drop-state': []
  drop: [event: DragEvent]
  'toggle-sort': [key: FileBrowserSortState['key']]
  'file-drag-start': [event: DragEvent, entry: FileBrowserEntry]
  'file-drag-end': []
  'entry-drag-over': [event: DragEvent, entry: FileBrowserEntry]
  'entry-drop': [event: DragEvent, entry: FileBrowserEntry]
  'row-double-click': [entry: FileBrowserEntry]
  'name-area-click': [entry: FileBrowserEntry]
  'update:rename-value': [value: string]
  'confirm-rename': [entry: FileBrowserEntry]
  'cancel-rename': []
  download: [entry: FileBrowserEntry]
  'start-rename': [entry: FileBrowserEntry]
  'open-permissions': [entry: FileBrowserEntry]
  'toggle-more': [path: string]
  'open-move-dialog': [entry: FileBrowserEntry, type: 'move' | 'copy']
  'delete-entry': [entry: FileBrowserEntry]
  'copy-path': [entry: FileBrowserEntry]
}>()
</script>
