<template>
  <header class="file-browser-header">
    <button
      class="file-icon-button primary"
      title="回退"
      @click="$emit('go-back')"
    >
      <Undo2 />
    </button>
    <input
      :value="pathInput"
      class="file-path-input"
      @input="$emit('update:path-input', ($event.target as HTMLInputElement).value)"
      @keydown.enter="$emit('commit-path')"
    />
    <button
      v-if="sessionKind === 'local'"
      class="file-icon-button"
      title="打开文件夹"
      @click="$emit('open-local-folder')"
    >
      <FolderOpen />
    </button>
    <button
      v-else
      class="file-icon-button"
      title="上传文件"
      @click="$emit('queue-upload', 'file')"
    >
      <UploadCloud />
    </button>
    <button
      v-if="sessionKind !== 'local'"
      class="file-icon-button"
      title="上传目录"
      @click="$emit('queue-upload', 'directory')"
    >
      <Upload />
    </button>
    <button
      class="file-icon-button"
      :title="showHidden ? '隐藏隐藏文件' : '显示隐藏文件'"
      @click="$emit('update:show-hidden', !showHidden)"
    >
      <Eye v-if="showHidden" />
      <EyeOff v-else />
    </button>
    <button
      class="file-icon-button"
      title="刷新"
      @click="$emit('refresh')"
    >
      <RefreshCw />
    </button>
  </header>
</template>

<script setup lang="ts">
import { Eye, EyeOff, FolderOpen, RefreshCw, Undo2, Upload, UploadCloud } from 'lucide-vue-next'

defineProps<{
  pathInput: string
  sessionKind: string
  showHidden: boolean
}>()

defineEmits<{
  'update:path-input': [value: string]
  'update:show-hidden': [value: boolean]
  'go-back': []
  'commit-path': []
  'open-local-folder': []
  'queue-upload': [kind: 'file' | 'directory']
  refresh: []
}>()
</script>
