import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import {
  getKnowledgeEditorParentRelDir,
  knowledgeEditorImageMimeFromPath,
  knowledgeEditorLanguageFromPath
} from '@/services/knowledgeEditorPathRuntime'
import { renderKnowledgeMarkdownPreview } from '@/services/knowledgeMarkdownPreviewRuntime'
import {
  isKnowledgePastedImageResultData,
  isKnowledgeReadResultData,
  isKnowledgeWriteResultData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledgeBackendGuards'
import { knowledgeClient } from '@/services/knowledgeClient'
import { useWorkspaceStore } from '@/stores/workspace'
import type { KnowledgeEditorMode, KnowledgeImageViewerApi, KnowledgeMarkdownPreviewApi, KnowledgeTextEditorApi } from '@/services/knowledgeEditorTypes'

type KnowledgeEditorRuntimeProps = {
  relPath: string
  isImage?: boolean
  startLine?: number
  endLine?: number
  jumpToken?: number
}

type KnowledgeEditorRuntimeOptions = {
  textEditorRef: Ref<KnowledgeTextEditorApi | null>
  imageViewerRef: Ref<KnowledgeImageViewerApi | null>
  markdownPreviewRef: Ref<KnowledgeMarkdownPreviewApi | null>
}

export const useKnowledgeEditorRuntime = (props: KnowledgeEditorRuntimeProps, options: KnowledgeEditorRuntimeOptions) => {
  const workspace = useWorkspaceStore()
  const content = ref('')
  const imageDataUrl = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const error = ref('')
  const mode = ref<KnowledgeEditorMode>('editor')
  const markdownHtml = ref('')
  let saveTimer: number | null = null
  let loadToken = 0
  let previewToken = 0
  const imageCache = new Map<string, string>()

  const relPath = computed(() => props.relPath)
  const isImage = computed(() => Boolean(props.isImage))
  const isMarkdown = computed(() => /\.(md|markdown)$/i.test(relPath.value))
  const title = computed(() => relPath.value.split('/').pop() || 'KnowledgeCenter')
  const language = computed(() => knowledgeEditorLanguageFromPath(relPath.value))
  const statusText = computed(() => {
    if (loading.value) return 'loading'
    if (saving.value) return 'saving'
    if (dirty.value) return 'unsaved'
    return 'saved'
  })
  const mermaidTheme = computed<'dark' | 'default'>(() => {
    const root = document.documentElement
    return root.classList.contains('theme-light') || root.dataset.theme === 'light' ? 'default' : 'dark'
  })

  const clearSaveTimer = () => {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  const resetImageView = () => {
    options.imageViewerRef.value?.resetZoom()
  }

  const jumpToRequestedLineRange = async () => {
    if (isImage.value || !props.startLine) return
    await nextTick()
    options.textEditorRef.value?.revealLineRange(props.startLine, props.endLine || props.startLine)
  }

  const loadMarkdownImage = async (imageRelPath: string) => {
    if (!imageRelPath) return null
    if (imageCache.has(imageRelPath)) return imageCache.get(imageRelPath)!
    const kbReadFile = knowledgeClient.kbReadFile()
    if (!kbReadFile) return null
    try {
      const result = await kbReadFile(imageRelPath, 'base64')
      if (!isKnowledgeReadResultData(result, 'base64')) throw new Error(malformedKnowledgeBackendResultMessage)
      const mimeType =
        result.mimeType && result.mimeType !== 'application/octet-stream'
          ? result.mimeType
          : knowledgeEditorImageMimeFromPath(imageRelPath) || result.mimeType || 'application/octet-stream'
      const dataUrl = `data:${mimeType};base64,${result.content}`
      imageCache.set(imageRelPath, dataUrl)
      return dataUrl
    } catch {
      return null
    }
  }

  const renderMarkdownPreview = async () => {
    const token = ++previewToken
    if (!isMarkdown.value) {
      markdownHtml.value = ''
      return
    }

    const result = await renderKnowledgeMarkdownPreview({
      content: content.value,
      relPath: relPath.value,
      loadImageDataUrl: loadMarkdownImage
    })
    if (token !== previewToken) return
    markdownHtml.value = result.html
    if (result.hasMermaid) {
      await nextTick()
      if (token === previewToken) await options.markdownPreviewRef.value?.renderMermaid(mermaidTheme.value)
    }
  }

  const loadFile = async () => {
    const token = ++loadToken
    clearSaveTimer()
    resetImageView()
    mode.value = 'editor'
    loading.value = true
    saving.value = false
    dirty.value = false
    error.value = ''
    content.value = ''
    imageDataUrl.value = ''
    markdownHtml.value = ''
    try {
      const kbReadFile = knowledgeClient.kbReadFile()
      if (!kbReadFile) {
        throw new Error('Knowledge bridge unavailable')
      }
      if (isImage.value) {
        const result = await kbReadFile(relPath.value, 'base64')
        if (token !== loadToken) return
        if (!isKnowledgeReadResultData(result, 'base64')) throw new Error(malformedKnowledgeBackendResultMessage)
        imageDataUrl.value = `data:${result.mimeType || 'application/octet-stream'};base64,${result.content}`
      } else {
        const result = await kbReadFile(relPath.value)
        if (token !== loadToken) return
        if (!isKnowledgeReadResultData(result)) throw new Error(malformedKnowledgeBackendResultMessage)
        content.value = result.content
        if (isMarkdown.value) void renderMarkdownPreview()
        void jumpToRequestedLineRange()
      }
    } catch (loadError) {
      if (token !== loadToken) return
      error.value = loadError instanceof Error ? loadError.message : String(loadError)
    } finally {
      if (token === loadToken) {
        loading.value = false
        void jumpToRequestedLineRange()
      }
    }
  }

  const saveNow = async () => {
    if (isImage.value || loading.value || !dirty.value) return
    clearSaveTimer()
    saving.value = true
    error.value = ''
    try {
      const kbWriteFile = knowledgeClient.kbWriteFile()
      if (!kbWriteFile) {
        throw new Error('Knowledge bridge unavailable')
      }
      const result = await kbWriteFile(relPath.value, content.value)
      if (!isKnowledgeWriteResultData(result) || result.relPath.trim() !== relPath.value) throw new Error(malformedKnowledgeBackendResultMessage)
      dirty.value = false
    } catch (saveError) {
      error.value = saveError instanceof Error ? saveError.message : String(saveError)
    } finally {
      saving.value = false
    }
  }

  const scheduleSave = () => {
    if (isImage.value) return
    dirty.value = true
    clearSaveTimer()
    saveTimer = window.setTimeout(() => {
      void saveNow()
    }, 800)
  }

  const updateContent = (value: string) => {
    content.value = value
    scheduleSave()
  }

  const insertAtCursor = (value: string) => {
    if (options.textEditorRef.value?.insertAtCursor) {
      options.textEditorRef.value.insertAtCursor(value)
      return
    }
    content.value += value
  }

  const handlePaste = async (event: ClipboardEvent) => {
    if (!isMarkdown.value || isImage.value || mode.value !== 'editor') return
    const items = event.clipboardData?.items ? Array.from(event.clipboardData.items) : []
    const hasImage = items.some((entry) => entry.type.startsWith('image/'))
    if (!hasImage) return
    event.preventDefault()
    error.value = ''
    const pasteImage = knowledgeClient.kbPasteImageFromClipboard()
    if (!pasteImage) {
      error.value = 'Knowledge image paste service unavailable'
      return
    }
    try {
      const result = await pasteImage(getKnowledgeEditorParentRelDir(relPath.value))
      if (!isKnowledgePastedImageResultData(result)) throw new Error(malformedKnowledgeBackendResultMessage)
      imageCache.set(result.relPath, result.dataUrl)
      insertAtCursor(`![](${result.fileName})`)
      dirty.value = true
      scheduleSave()
      void renderMarkdownPreview()
      void workspace.refreshKnowledgeTree()
    } catch (pasteError) {
      error.value = pasteError instanceof Error ? pasteError.message : 'Failed to paste image'
    }
  }

  watch(() => [props.relPath, props.isImage] as const, loadFile)

  watch(
    () => props.jumpToken,
    () => {
      if (props.startLine) mode.value = 'editor'
      void jumpToRequestedLineRange()
    }
  )

  watch(
    options.textEditorRef,
    () => {
      void jumpToRequestedLineRange()
    },
    { flush: 'post' }
  )

  watch([content, isMarkdown, mode], () => {
    if (mode.value === 'preview' && isMarkdown.value) void renderMarkdownPreview()
  })

  onMounted(loadFile)

  onBeforeUnmount(() => {
    clearSaveTimer()
    if (dirty.value) {
      void saveNow()
    }
    imageCache.clear()
  })

  return {
    content,
    imageDataUrl,
    loading,
    saving,
    dirty,
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
  }
}
