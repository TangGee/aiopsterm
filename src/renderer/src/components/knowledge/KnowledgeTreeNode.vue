<template>
  <div class="kb-tree-node-wrap">
    <div
      class="kb-tree-node"
      :class="{ selected, editing, 'drag-over': dragOver }"
      :style="{ paddingLeft: `${level * 16 + 6}px` }"
      :draggable="!editing"
      @click="handleSelect"
      @dblclick="handleDoubleClick"
      @contextmenu="handleContextMenu"
      @dragstart="emit('drag-start', $event, node)"
      @dragover="emit('drag-over', $event, node)"
      @dragleave="emit('drag-leave', node)"
      @dragend="emit('drag-end')"
      @drop="emit('drop-node', $event, node)"
    >
      <button
        v-if="node.type === 'dir'"
        class="kb-expand-button"
        @click.stop="emit('toggle', node.relPath)"
      >
        <ChevronDown v-if="expanded" />
        <ChevronRight v-else />
      </button>
      <span
        v-else
        class="kb-expand-spacer"
      ></span>
      <Folder
        v-if="node.type === 'dir'"
        class="kb-node-icon"
      />
      <File
        v-else
        class="kb-node-icon"
      />
      <input
        v-if="editing"
        class="kb-rename-input"
        :value="editingName"
        autofocus
        @input="emit('rename-input', ($event.target as HTMLInputElement).value)"
        @keydown.stop="handleRenameKeydown"
        @blur="emit('cancel-rename')"
      />
      <template v-else>
        <span class="kb-title-text">{{ node.title }}</span>
        <em
          class="kb-node-kind"
          :class="nodeKindClass"
        >
          {{ nodeKindLabel }}
        </em>
      </template>
    </div>

    <KnowledgeTreeNode
      v-for="child in expandedChildren"
      :key="child.relPath"
      :node="child"
      :level="level + 1"
      :editing-key="editingKey"
      :editing-name="editingName"
      :drag-over-rel-path="dragOverRelPath"
      :expanded-keys="expandedKeys"
      :selected-keys="selectedKeys"
      @select="(relPath, multi) => emit('select', relPath, multi)"
      @toggle="emit('toggle', $event)"
      @context="(event, child) => emit('context', event, child)"
      @drag-start="(event, child) => emit('drag-start', event, child)"
      @drag-over="(event, child) => emit('drag-over', event, child)"
      @drag-leave="emit('drag-leave', $event)"
      @drag-end="emit('drag-end')"
      @drop-node="(event, child) => emit('drop-node', event, child)"
      @rename-input="emit('rename-input', $event)"
      @confirm-rename="emit('confirm-rename')"
      @cancel-rename="emit('cancel-rename')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-vue-next'
import { getKnowledgeParent } from '@/services/knowledgeRuntime'
import type { KnowledgeNode } from '@shared/contracts/knowledgeBase'

const props = defineProps<{
  node: KnowledgeNode
  level: number
  editingKey: string
  editingName: string
  dragOverRelPath: string
  expandedKeys: string[]
  selectedKeys: string[]
}>()

const emit = defineEmits<{
  select: [relPath: string, multi: boolean]
  toggle: [relPath: string]
  context: [event: MouseEvent, node: KnowledgeNode]
  'drag-start': [event: DragEvent, node: KnowledgeNode]
  'drag-over': [event: DragEvent, node: KnowledgeNode]
  'drag-leave': [node: KnowledgeNode]
  'drag-end': []
  'drop-node': [event: DragEvent, node: KnowledgeNode]
  'rename-input': [value: string]
  'confirm-rename': []
  'cancel-rename': []
}>()

const expanded = computed(() => props.expandedKeys.includes(props.node.relPath))
const selected = computed(() => props.selectedKeys.includes(props.node.relPath))
const editing = computed(() => props.editingKey === props.node.relPath)
const dragOver = computed(() => props.dragOverRelPath === props.node.relPath || (props.node.type === 'file' && props.dragOverRelPath === getKnowledgeParent(props.node.relPath)))
const expandedChildren = computed(() => (props.node.type === 'dir' && expanded.value ? props.node.children || [] : []))
const isDocument = computed(() => /\.(md|markdown)$/i.test(props.node.relPath))
const nodeKindClass = computed(() => (props.node.type === 'dir' ? 'folder' : isDocument.value ? 'document' : 'file'))
const nodeKindLabel = computed(() => {
  if (props.node.type === 'dir') return '文件夹'
  return isDocument.value ? '文档' : '文件'
})

const handleSelect = (event: MouseEvent) => {
  event.stopPropagation()
  emit('select', props.node.relPath, event.ctrlKey || event.metaKey)
}

const handleDoubleClick = (event: MouseEvent) => {
  event.stopPropagation()
  if (props.node.type === 'dir') emit('toggle', props.node.relPath)
}

const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  emit('context', event, props.node)
}

const handleRenameKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') emit('confirm-rename')
  if (event.key === 'Escape') emit('cancel-rename')
}
</script>
