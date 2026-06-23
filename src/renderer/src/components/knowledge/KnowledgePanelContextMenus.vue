<template>
  <div
    v-if="nodeMenu.visible"
    class="kb-context-menu"
    :style="{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }"
  >
    <button
      v-if="nodeMenu.type === 'file'"
      @click="emit('add-to-chat')"
    >
      添加到聊天
    </button>
    <button
      v-if="nodeMenu.type === 'dir'"
      @click="emit('create-file', nodeMenu.relPath)"
    >
      新建文档
    </button>
    <button
      v-if="nodeMenu.type === 'dir'"
      @click="emit('create-dir', nodeMenu.relPath)"
    >
      新建文件夹
    </button>
    <button
      v-if="nodeMenu.type === 'dir'"
      @click="emit('upload', nodeMenu.relPath)"
    >
      <UploadCloud />
      上传文件
    </button>
    <i v-if="nodeMenu.type === 'dir'"></i>
    <button @click="emit('start-rename', nodeMenu.relPath)">重命名</button>
    <button @click="emit('delete-selection')">删除</button>
    <i></i>
    <button
      v-if="nodeMenu.type === 'file'"
      @click="emit('copy-path')"
    >
      复制路径
    </button>
    <button @click="emit('copy-selection', 'copy')">
      <span>复制</span>
      <em>{{ modifierKey }}C</em>
    </button>
    <button @click="emit('copy-selection', 'cut')">
      <span>剪切</span>
      <em>{{ modifierKey }}X</em>
    </button>
    <button
      :disabled="!clipboardAvailable"
      @click="emit('paste-into', nodeMenu.relPath)"
    >
      <span>粘贴</span>
      <em>{{ modifierKey }}V</em>
    </button>
  </div>

  <div
    v-if="blankMenu.visible"
    class="kb-context-menu"
    :style="{ left: `${blankMenu.x}px`, top: `${blankMenu.y}px` }"
  >
    <button @click="emit('create-file')">新建文档</button>
    <button @click="emit('create-dir')">新建文件夹</button>
    <button
      :disabled="!clipboardAvailable"
      @click="emit('paste-into', '')"
    >
      <span>粘贴</span>
      <em>{{ modifierKey }}V</em>
    </button>
    <button @click="emit('refresh-tree')">刷新</button>
  </div>
</template>

<script setup lang="ts">
import { UploadCloud } from 'lucide-vue-next'
import type { KnowledgePanelBlankMenu, KnowledgePanelNodeMenu } from '@/services/knowledge/knowledgePanelTypes'

defineProps<{
  nodeMenu: KnowledgePanelNodeMenu
  blankMenu: KnowledgePanelBlankMenu
  modifierKey: string
  clipboardAvailable: boolean
}>()

const emit = defineEmits<{
  'add-to-chat': []
  'create-file': [parentRelDir?: string]
  'create-dir': [parentRelDir?: string]
  upload: [targetDirOverride?: string]
  'start-rename': [relPath: string]
  'delete-selection': []
  'copy-path': []
  'copy-selection': [mode: 'copy' | 'cut']
  'paste-into': [relPath: string]
  'refresh-tree': []
}>()
</script>
