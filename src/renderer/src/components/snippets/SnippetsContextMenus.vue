<template>
  <div
    v-if="commandMenu.visible"
    class="snippet-context-menu"
    :style="{ left: `${commandMenu.x}px`, top: `${commandMenu.y}px` }"
  >
    <button @click="$emit('run-command-all-tabs')">
      <PlayCircle />
      全部窗口执行
    </button>
    <button @click="$emit('edit-command')">
      <Pencil />
      编辑
    </button>
    <button @click="$emit('delete-command')">
      <Trash2 />
      删除
    </button>
  </div>

  <div
    v-if="groupMenu.visible"
    class="snippet-context-menu"
    :style="{ left: `${groupMenu.x}px`, top: `${groupMenu.y}px` }"
  >
    <button @click="$emit('edit-group')">
      <Pencil />
      编辑
    </button>
    <button @click="$emit('delete-group')">
      <Trash2 />
      删除
    </button>
  </div>
</template>

<script setup lang="ts">
import { Pencil, PlayCircle, Trash2 } from 'lucide-vue-next'
import type { SnippetsCommandMenu, SnippetsGroupMenu } from '@/services/snippetsPanelTypes'

defineProps<{
  commandMenu: SnippetsCommandMenu
  groupMenu: SnippetsGroupMenu
}>()

defineEmits<{
  'run-command-all-tabs': []
  'edit-command': []
  'delete-command': []
  'edit-group': []
  'delete-group': []
}>()
</script>
