<template>
  <div class="kb-toolbar">
    <label class="kb-search">
      <input
        :value="searchQuery"
        placeholder="搜索"
        @input="emit('update:search-query', ($event.target as HTMLInputElement).value)"
      />
      <Search />
    </label>
    <div class="kb-add-wrapper">
      <button
        class="kb-add-button"
        title="添加"
        @click="emit('update:addMenuOpen', !addMenuOpen)"
      >
        <Plus />
      </button>
      <div
        v-if="addMenuOpen"
        class="kb-add-menu"
      >
        <button @click="emit('upload')">
          <UploadCloud />
          上传文件
        </button>
        <button @click="emit('create-file')">
          <FilePlus />
          新建文档
        </button>
        <button @click="emit('create-dir')">
          <FolderPlus />
          新建文件夹
        </button>
        <i></i>
        <button @click="emit('refresh')">
          <RefreshCw />
          刷新
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FilePlus, FolderPlus, Plus, RefreshCw, Search, UploadCloud } from 'lucide-vue-next'

defineProps<{
  searchQuery: string
  addMenuOpen: boolean
}>()

const emit = defineEmits<{
  'update:search-query': [value: string]
  'update:addMenuOpen': [value: boolean]
  upload: []
  'create-file': []
  'create-dir': []
  refresh: []
}>()
</script>
