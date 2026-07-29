<template>
  <header
    class="file-browser-header"
    :class="`session-${sessionKind}`"
  >
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
    <button
      class="file-icon-button"
      :class="{ primary: searchOpen }"
      title="搜索当前目录"
      @click="$emit('toggle-search')"
    >
      <Search />
    </button>
    <div
      v-if="searchOpen"
      class="file-browser-search"
    >
      <Search />
      <input
        ref="searchInput"
        :value="searchQuery"
        placeholder="搜索当前目录中的文件和文件夹"
        @input="$emit('update:search-query', ($event.target as HTMLInputElement).value)"
        @keydown.esc.prevent.stop="$emit('close-search')"
      />
      <button
        v-if="searchQuery"
        title="清空搜索"
        @click="clearSearch"
      >
        <X />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Eye, EyeOff, FolderOpen, RefreshCw, Search, Undo2, Upload, UploadCloud, X } from 'lucide-vue-next'

const props = defineProps<{
  pathInput: string
  searchOpen: boolean
  searchQuery: string
  sessionKind: string
  showHidden: boolean
}>()

const emit = defineEmits<{
  'update:path-input': [value: string]
  'update:search-query': [value: string]
  'update:show-hidden': [value: boolean]
  'clear-search': []
  'close-search': []
  'go-back': []
  'commit-path': []
  'open-local-folder': []
  'queue-upload': [kind: 'file' | 'directory']
  refresh: []
  'toggle-search': []
}>()

const searchInput = ref<HTMLInputElement | null>(null)

const clearSearch = async () => {
  emit('clear-search')
  await nextTick()
  searchInput.value?.focus()
}

watch(
  () => props.searchOpen,
  async (open) => {
    if (!open) return
    await nextTick()
    searchInput.value?.focus()
  }
)
</script>
