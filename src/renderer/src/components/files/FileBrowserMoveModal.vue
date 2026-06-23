<template>
  <div
    v-if="moveDialog.visible && moveDialog.entry"
    class="file-modal"
  >
    <div class="file-modal-card">
      <header>
        <strong>{{ moveDialog.type === 'move' ? '移动到' : '复制到' }}</strong>
        <button
          title="关闭"
          @click="$emit('close-move')"
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
          @click="$emit('start-target-edit')"
        >
          <input
            v-if="moveDialog.editingPath"
            :value="moveDialog.targetPath"
            class="move-target-input"
            placeholder="请输入目标目录"
            @input="$emit('update:target-path', ($event.target as HTMLInputElement).value)"
            @blur="$emit('stop-target-edit')"
            @keydown.enter="$emit('stop-target-edit')"
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
                @click.stop="$emit('jump-target', index)"
              >
                {{ part }}
              </button>
              <button
                class="move-breadcrumb-menu-trigger"
                title="打开目录"
                @click.stop="$emit('toggle-target-menu', index)"
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
                  @click.stop="$emit('enter-target-sub-dir', index, dir.name)"
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
            @click.stop="$emit('start-target-edit')"
          >
            编辑
          </button>
        </div>
      </div>
      <footer>
        <button @click="$emit('close-move')">取消</button>
        <button
          class="primary"
          @click="$emit('confirm-move')"
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
          @click="$emit('conflict-action', 'cancel')"
        >
          <X />
        </button>
      </header>
      <p>
        文件 <strong>{{ moveDialog.entry.name }}</strong> 已存在于 {{ moveDialog.targetPath }}，请选择处理方式。
      </p>
      <input
        :value="conflictDialog.newName"
        placeholder="新文件名"
        @input="$emit('update:conflict-new-name', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('conflict-action', 'rename')"
      />
      <footer>
        <button @click="$emit('conflict-action', 'cancel')">取消</button>
        <button @click="$emit('conflict-action', 'rename')">重命名</button>
        <button
          class="danger"
          @click="$emit('conflict-action', 'overwrite')"
        >
          覆盖
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, Folder as FolderFilled, X } from 'lucide-vue-next'
import type { FileBrowserEntry } from '@/services/files/filesRuntime'

type FileBrowserMoveDialog = {
  visible: boolean
  type: 'move' | 'copy'
  entry: FileBrowserEntry | null
  targetPath: string
  editingPath: boolean
  activeMenuIndex: number | null
}

type FileBrowserConflictDialog = {
  visible: boolean
  newName: string
}

defineProps<{
  moveDialog: FileBrowserMoveDialog
  conflictDialog: FileBrowserConflictDialog
  targetBreadcrumb: string[]
  targetSubDirs: Record<number, FileBrowserEntry[]>
  dirname: (path: string) => string
}>()

defineEmits<{
  'close-move': []
  'start-target-edit': []
  'stop-target-edit': []
  'update:target-path': [value: string]
  'toggle-target-menu': [index: number]
  'enter-target-sub-dir': [index: number, name: string]
  'jump-target': [index: number]
  'confirm-move': []
  'conflict-action': [action: 'cancel' | 'rename' | 'overwrite']
  'update:conflict-new-name': [value: string]
}>()

const movePathContainer = ref<HTMLElement | null>(null)

defineExpose({
  movePathContainer
})
</script>
