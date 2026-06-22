<template>
  <section
    class="kb-editor-root"
    @paste.capture="handlePaste"
  >
    <KnowledgeEditorHeader
      v-model:mode="mode"
      :title="title"
      :rel-path="relPath"
      :status-text="statusText"
      :is-markdown="isMarkdown"
      :is-image="isImage"
    />

    <div
      v-if="loading"
      class="kb-editor-empty"
    >
      正在加载
    </div>

    <div
      v-else-if="error"
      class="kb-editor-empty error"
    >
      {{ error }}
    </div>

    <KnowledgeImageViewer
      v-else-if="isImage"
      ref="imageViewerRef"
      :image-data-url="imageDataUrl"
      :rel-path="relPath"
    />

    <KnowledgeMarkdownPreview
      v-else-if="mode === 'preview' && isMarkdown"
      ref="markdownPreviewRef"
      :html="markdownHtml"
    />

    <KnowledgeMonacoEditor
      v-else
      ref="editorRef"
      :model-value="content"
      :language="language"
      @update:model-value="updateContent"
      @save="saveNow"
    />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import KnowledgeEditorHeader from '@/components/knowledge/KnowledgeEditorHeader.vue'
import KnowledgeImageViewer from '@/components/knowledge/KnowledgeImageViewer.vue'
import KnowledgeMarkdownPreview from '@/components/knowledge/KnowledgeMarkdownPreview.vue'
import KnowledgeMonacoEditor from '@/components/knowledge/KnowledgeMonacoEditor.vue'
import { useKnowledgeEditorRuntime } from '@/services/knowledgeEditorRuntime'
import type { KnowledgeImageViewerApi, KnowledgeMarkdownPreviewApi, KnowledgeTextEditorApi } from '@/services/knowledgeEditorTypes'

const props = defineProps<{
  relPath: string
  isImage?: boolean
  startLine?: number
  endLine?: number
  jumpToken?: number
}>()

const editorRef = ref<KnowledgeTextEditorApi | null>(null)
const imageViewerRef = ref<KnowledgeImageViewerApi | null>(null)
const markdownPreviewRef = ref<KnowledgeMarkdownPreviewApi | null>(null)

const {
  content,
  imageDataUrl,
  loading,
  error,
  mode,
  markdownHtml,
  relPath,
  isImage,
  isMarkdown,
  title,
  language,
  statusText,
  updateContent,
  saveNow,
  handlePaste
} = useKnowledgeEditorRuntime(props, {
  textEditorRef: editorRef,
  imageViewerRef,
  markdownPreviewRef
})
</script>
