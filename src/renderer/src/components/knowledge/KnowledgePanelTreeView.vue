<template>
  <div
    class="kb-tree-wrapper"
    @click="emit('clear-blank-selection', $event)"
    @contextmenu.prevent="emit('open-blank-menu', $event)"
    @dragover.prevent="emit('root-drag-over', $event)"
    @dragleave="emit('root-drag-leave', $event)"
    @drop.prevent="emit('root-drop', $event)"
  >
    <div
      class="kb-tree-scroll"
      :class="{ 'drag-over-root': dragOverRoot }"
    >
      <div
        v-if="searchVisible"
        class="kb-search-results"
      >
        <div class="kb-search-results-header">
          <span>内容搜索</span>
          <small v-if="searchLoading">索引中...</small>
          <small v-else>{{ searchResults.length }} results</small>
        </div>
        <button
          v-for="result in searchResults"
          :key="`${result.path}:${result.startLine}`"
          class="kb-search-result"
          @click.stop="emit('open-search-result', result)"
        >
          <strong>{{ result.path }}</strong>
          <span>Lines {{ result.startLine }}-{{ result.endLine }} · {{ result.matchCount }} matches</span>
          <small>{{ result.snippet }}</small>
        </button>
        <div
          v-if="!searchLoading && !searchResults.length"
          class="kb-search-empty"
        >
          {{ searchError || '没有内容搜索结果' }}
        </div>
      </div>
      <KnowledgeTreeNode
        v-for="node in filteredTree"
        :key="node.relPath"
        :node="node"
        :level="0"
        :editing-key="editingKey"
        :editing-name="editingName"
        :drag-over-rel-path="dragOverRelPath"
        :expanded-keys="expandedKeys"
        :selected-keys="selectedKeys"
        @select="(relPath, multi) => emit('select-node', relPath, multi)"
        @toggle="emit('toggle-expanded', $event)"
        @context="(event, node) => emit('open-node-menu', event, node)"
        @drag-start="(event, node) => emit('drag-start', event, node)"
        @drag-over="(event, node) => emit('drag-over', event, node)"
        @drag-leave="emit('drag-leave', $event)"
        @drag-end="emit('drag-end')"
        @drop-node="(event, node) => emit('drop-node', event, node)"
        @rename-input="emit('update:editingName', $event)"
        @confirm-rename="emit('confirm-rename')"
        @cancel-rename="emit('cancel-rename')"
      />
    </div>

    <div class="kb-capacity-bar">
      <Cloud :class="{ syncing: importJobCount > 0 }" />
      <div class="kb-capacity-info">
        <div class="kb-capacity-label">我的容量</div>
        <div class="kb-capacity-value">{{ formatCapacity(usedBytes) }} / {{ formatCapacity(totalBytes) }}</div>
        <div class="progress">
          <span :style="{ width: `${capacityPercent}%` }"></span>
        </div>
      </div>
      <button
        class="kb-capacity-detail-link"
        @click.stop="emit('show-capacity-detail')"
      >
        明细
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Cloud } from 'lucide-vue-next'
import KnowledgeTreeNode from '@/components/knowledge/KnowledgeTreeNode.vue'
import type { KnowledgeBaseSearchResult, KnowledgeNode } from '@shared/contracts/knowledgeBase'

defineProps<{
  searchVisible: boolean
  searchLoading: boolean
  searchResults: KnowledgeBaseSearchResult[]
  searchError: string
  filteredTree: KnowledgeNode[]
  editingKey: string
  editingName: string
  dragOverRelPath: string
  dragOverRoot: boolean
  expandedKeys: string[]
  selectedKeys: string[]
  importJobCount: number
  usedBytes: number
  totalBytes: number
  capacityPercent: number
}>()

const emit = defineEmits<{
  'clear-blank-selection': [event: MouseEvent]
  'open-blank-menu': [event: MouseEvent]
  'root-drag-over': [event: DragEvent]
  'root-drag-leave': [event: DragEvent]
  'root-drop': [event: DragEvent]
  'open-search-result': [result: KnowledgeBaseSearchResult]
  'select-node': [relPath: string, multi: boolean]
  'toggle-expanded': [relPath: string]
  'open-node-menu': [event: MouseEvent, node: KnowledgeNode]
  'drag-start': [event: DragEvent, node: KnowledgeNode]
  'drag-over': [event: DragEvent, node: KnowledgeNode]
  'drag-leave': [node: KnowledgeNode]
  'drag-end': []
  'drop-node': [event: DragEvent, node: KnowledgeNode]
  'update:editingName': [value: string]
  'confirm-rename': []
  'cancel-rename': []
  'show-capacity-detail': []
}>()

const formatCapacity = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}
</script>
