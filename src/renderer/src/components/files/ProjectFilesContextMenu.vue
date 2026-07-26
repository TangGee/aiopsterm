<template>
  <div
    class="project-files-context-menu"
    role="menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
    @click.stop
  >
    <button type="button" role="menuitem" @click="$emit('create-file')">
      <FilePlus2 />
      <span>New file</span>
    </button>
    <template v-if="entry">
      <i></i>
      <button type="button" role="menuitem" @click="$emit('rename')">
        <Pencil />
        <span>Rename</span>
      </button>
      <button
        v-if="entry.type !== 'directory'"
        type="button"
        role="menuitem"
        class="danger"
        @click="$emit('delete-file')"
      >
        <Trash2 />
        <span>Delete</span>
      </button>
      <i></i>
      <button type="button" role="menuitem" @click="$emit('copy-relative-path')">
        <Copy />
        <span>Copy relative path</span>
      </button>
      <button type="button" role="menuitem" @click="$emit('copy-absolute-path')">
        <Copy />
        <span>Copy absolute path</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Copy, FilePlus2, Pencil, Trash2 } from 'lucide-vue-next'
import type { ProjectDirectoryEntry } from '@shared/contracts/projectFiles'

defineProps<{
  x: number
  y: number
  entry: ProjectDirectoryEntry | null
}>()

defineEmits<{
  'create-file': []
  rename: []
  'delete-file': []
  'copy-relative-path': []
  'copy-absolute-path': []
}>()
</script>
