<template>
  <div class="snippets-toolbar">
    <template v-if="!isSearchActive">
      <div class="snippets-toolbar-left">
        <button
          v-if="selectedGroupUuid"
          class="icon-only"
          title="返回"
          @click="$emit('back')"
        >
          <ArrowLeft />
        </button>
        <strong v-if="selectedGroupUuid">{{ currentGroupName }}</strong>
        <button
          v-else
          class="text-button"
          @click="$emit('add-group')"
        >
          <FolderPlus />
          命令组
        </button>
      </div>
      <div class="snippets-toolbar-right">
        <button
          class="icon-only macro-btn"
          :class="{ recording: isMacroRecording }"
          :title="isMacroRecording ? '停止录制' : '宏录制'"
          @click="$emit('toggle-macro')"
        >
          <Video />
        </button>
        <button
          class="icon-only"
          title="新建快捷命令"
          @click="$emit('add-command')"
        >
          <FileTerminal />
        </button>
        <button
          class="icon-only"
          title="搜索"
          @click="$emit('activate-search')"
        >
          <Search />
        </button>
      </div>
    </template>
    <label
      v-else
      class="snippet-search"
    >
      <Search />
      <input
        ref="searchInput"
        :value="searchQuery"
        placeholder="搜索"
        @input="$emit('update:search-query', ($event.target as HTMLInputElement).value)"
        @blur="$emit('search-blur')"
        @keydown.enter="$emit('search-blur')"
      />
      <button
        v-if="searchQuery"
        type="button"
        title="清空搜索"
        @mousedown.prevent
        @click="$emit('clear-search')"
      >
        <X />
      </button>
    </label>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, FileTerminal, FolderPlus, Search, Video, X } from 'lucide-vue-next'

defineProps<{
  isSearchActive: boolean
  selectedGroupUuid: string | null
  currentGroupName: string
  isMacroRecording: boolean
  searchQuery: string
}>()

defineEmits<{
  back: []
  'add-group': []
  'toggle-macro': []
  'add-command': []
  'activate-search': []
  'update:search-query': [value: string]
  'search-blur': []
  'clear-search': []
}>()

const searchInput = ref<HTMLInputElement | null>(null)

defineExpose({
  searchInput
})
</script>
