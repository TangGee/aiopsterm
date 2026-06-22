<template>
  <header class="kb-editor-header">
    <div>
      <strong>{{ title }}</strong>
      <span>{{ relPath }}</span>
    </div>
    <div class="kb-editor-actions">
      <div
        v-if="isMarkdown && !isImage"
        class="kb-editor-mode"
      >
        <button
          :class="{ active: mode === 'editor' }"
          @click="$emit('update:mode', 'editor')"
        >
          <Pencil />
          源码
        </button>
        <button
          :class="{ active: mode === 'preview' }"
          @click="$emit('update:mode', 'preview')"
        >
          <Eye />
          渲染
        </button>
      </div>
      <em>{{ statusText }}</em>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Eye, Pencil } from 'lucide-vue-next'
import type { KnowledgeEditorMode } from '@/services/knowledgeEditorTypes'

defineProps<{
  title: string
  relPath: string
  statusText: string
  mode: KnowledgeEditorMode
  isMarkdown: boolean
  isImage: boolean
}>()

defineEmits<{
  'update:mode': [value: KnowledgeEditorMode]
}>()
</script>
