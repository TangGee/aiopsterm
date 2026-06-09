<template>
  <section
    class="kb-editor-root"
    @paste.capture="handlePaste"
  >
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
            @click="mode = 'editor'"
          >
            <Pencil />
            编辑
          </button>
          <button
            :class="{ active: mode === 'preview' }"
            @click="mode = 'preview'"
          >
            <Eye />
            预览
          </button>
        </div>
        <em>{{ statusText }}</em>
        <button
          v-if="!isImage"
          :disabled="saving || loading"
          @click="saveNow"
        >
          保存
        </button>
      </div>
    </header>

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

    <div
      v-else-if="isImage"
      class="kb-editor-image"
      @wheel.prevent="handleImageWheel"
    >
      <div
        v-if="imageDataUrl"
        class="kb-editor-image-stage"
        :class="{ draggable: imageScale > 1, dragging: imageDragging }"
        :style="imageStageStyle"
        @mousedown="startImageDrag"
        @mousemove="moveImageDrag"
        @mouseup="stopImageDrag"
        @mouseleave="stopImageDrag"
      >
        <img
          :src="imageDataUrl"
          :alt="relPath"
          draggable="false"
        />
      </div>
      <span v-else>图片无法预览</span>
      <div
        v-if="imageDataUrl"
        class="kb-editor-image-controls"
      >
        <button
          title="缩小"
          @click="zoomOut"
        >
          <ZoomOut />
        </button>
        <b>{{ Math.round(imageScale * 100) }}%</b>
        <button
          title="放大"
          @click="zoomIn"
        >
          <ZoomIn />
        </button>
        <button
          title="重置"
          @click="resetZoom"
        >
          <Maximize2 />
        </button>
      </div>
    </div>

    <div
      v-else-if="mode === 'preview' && isMarkdown"
      ref="previewRef"
      class="kb-markdown-preview"
      v-html="markdownHtml"
    ></div>

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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import 'highlight.js/styles/atom-one-dark.css'
import { Eye, Maximize2, Pencil, ZoomIn, ZoomOut } from 'lucide-vue-next'
import KnowledgeMonacoEditor from '@/components/knowledge/KnowledgeMonacoEditor.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  relPath: string
  isImage?: boolean
  startLine?: number
  endLine?: number
  jumpToken?: number
}>()

const workspace = useWorkspaceStore()
const content = ref('')
const imageDataUrl = ref('')
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const error = ref('')
const mode = ref<'editor' | 'preview'>('editor')
const markdownHtml = ref('')
const editorRef = ref<InstanceType<typeof KnowledgeMonacoEditor> | null>(null)
const previewRef = ref<HTMLDivElement | null>(null)
const imageScale = ref(1)
const imageTranslateX = ref(0)
const imageTranslateY = ref(0)
const imageDragging = ref(false)
const imageDragStartX = ref(0)
const imageDragStartY = ref(0)
let saveTimer: number | null = null
let loadToken = 0
let previewToken = 0
const imageCache = new Map<string, string>()
let mermaidInitialized = false
let lastMermaidTheme: 'dark' | 'default' | null = null

const minImageScale = 0.1
const maxImageScale = 10
const zoomStep = 0.25
const allowedTableAlignments = new Set(['left', 'center', 'right', 'justify'])
const allowedMarkdownTags = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
])
const removedMarkdownTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'])
const markdownTagAttributes: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target', 'title']),
  code: new Set(['class']),
  div: new Set(['class']),
  img: new Set(['alt', 'src', 'title']),
  input: new Set(['checked', 'disabled', 'type']),
  span: new Set(['class']),
  td: new Set(['style']),
  th: new Set(['style'])
}
const markdownClassPattern = /^(hljs|hljs-[\w-]+|language-[\w-]+|mermaid|contains-task-list|task-list-item)$/i

const relPath = computed(() => props.relPath)
const isImage = computed(() => Boolean(props.isImage))
const isMarkdown = computed(() => /\.(md|markdown)$/i.test(relPath.value))
const title = computed(() => relPath.value.split('/').pop() || 'KnowledgeCenter')
const language = computed(() => languageFromPath(relPath.value))
const statusText = computed(() => {
  if (loading.value) return 'loading'
  if (saving.value) return 'saving'
  if (dirty.value) return 'unsaved'
  return 'saved'
})
const imageStageStyle = computed(() => ({
  transform: `translate(${imageTranslateX.value}px, ${imageTranslateY.value}px) scale(${imageScale.value})`,
  cursor: imageScale.value > 1 ? (imageDragging.value ? 'grabbing' : 'grab') : 'default'
}))
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

const getParentRelDir = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

const createRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

const languageFromPath = (path: string) => {
  const lower = path.toLowerCase()
  if (/\.(md|markdown)$/.test(lower)) return 'markdown'
  if (/\.(json|jsonc)$/.test(lower)) return 'json'
  if (/\.(ya?ml)$/.test(lower)) return 'yaml'
  if (/\.(ts|tsx)$/.test(lower)) return 'typescript'
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return 'javascript'
  if (/\.py$/.test(lower)) return 'python'
  if (/\.go$/.test(lower)) return 'go'
  if (/\.rs$/.test(lower)) return 'rust'
  if (/\.(sh|bash|zsh)$/.test(lower)) return 'shell'
  if (/\.sql$/.test(lower)) return 'sql'
  if (/\.(html|htm)$/.test(lower)) return 'html'
  if (/\.css$/.test(lower)) return 'css'
  if (/\.xml$/.test(lower)) return 'xml'
  return 'plaintext'
}

const resetZoom = () => {
  imageScale.value = 1
  imageTranslateX.value = 0
  imageTranslateY.value = 0
  imageDragging.value = false
}

const zoomIn = () => {
  imageScale.value = Math.min(maxImageScale, imageScale.value + zoomStep)
}

const zoomOut = () => {
  imageScale.value = Math.max(minImageScale, imageScale.value - zoomStep)
  if (imageScale.value <= 1) {
    imageTranslateX.value = 0
    imageTranslateY.value = 0
  }
}

const handleImageWheel = (event: WheelEvent) => {
  if (event.deltaY > 0) zoomOut()
  else zoomIn()
}

const startImageDrag = (event: MouseEvent) => {
  if (imageScale.value <= 1) return
  imageDragging.value = true
  imageDragStartX.value = event.clientX - imageTranslateX.value
  imageDragStartY.value = event.clientY - imageTranslateY.value
}

const moveImageDrag = (event: MouseEvent) => {
  if (!imageDragging.value) return
  imageTranslateX.value = event.clientX - imageDragStartX.value
  imageTranslateY.value = event.clientY - imageDragStartY.value
}

const stopImageDrag = () => {
  imageDragging.value = false
}

const jumpToRequestedLineRange = async () => {
  if (isImage.value || !props.startLine) return
  await nextTick()
  editorRef.value?.revealLineRange(props.startLine, props.endLine || props.startLine)
}

const loadFile = async () => {
  const token = ++loadToken
  clearSaveTimer()
  resetZoom()
  mode.value = 'editor'
  loading.value = true
  saving.value = false
  dirty.value = false
  error.value = ''
  content.value = ''
  imageDataUrl.value = ''
  markdownHtml.value = ''
  try {
    if (!window.aiops?.kbReadFile) {
      throw new Error('Knowledge bridge unavailable')
    }
    if (isImage.value) {
      const result = await window.aiops.kbReadFile(relPath.value, 'base64')
      if (token !== loadToken) return
      imageDataUrl.value = `data:${result.mimeType || 'application/octet-stream'};base64,${result.content}`
    } else {
      const result = await window.aiops.kbReadFile(relPath.value)
      if (token !== loadToken) return
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
    if (!window.aiops?.kbWriteFile) {
      throw new Error('Knowledge bridge unavailable')
    }
    await window.aiops.kbWriteFile(relPath.value, content.value)
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

const normalizeRelPath = (path: string) => {
  const output: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      output.pop()
      continue
    }
    output.push(part)
  }
  return output.join('/')
}

const isLocalResource = (src: string) => Boolean(src) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)

const resolveMarkdownResource = (src: string) => {
  const cleanSrc = src.split(/[?#]/, 1)[0] || ''
  if (cleanSrc.startsWith('/')) return normalizeRelPath(cleanSrc.replace(/^\/+/, ''))
  return normalizeRelPath(createRelPath(getParentRelDir(relPath.value), cleanSrc))
}

const imageMimeFromPath = (path: string) => {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return ''
}

const loadMarkdownImage = async (src: string) => {
  const imageRelPath = resolveMarkdownResource(src)
  if (!imageRelPath) return null
  if (imageCache.has(imageRelPath)) return imageCache.get(imageRelPath)!
  if (!window.aiops?.kbReadFile) return null
  try {
    const result = await window.aiops.kbReadFile(imageRelPath, 'base64')
    const mimeType =
      result.mimeType && result.mimeType !== 'application/octet-stream'
        ? result.mimeType
        : imageMimeFromPath(imageRelPath) || result.mimeType || 'application/octet-stream'
    const dataUrl = `data:${mimeType};base64,${result.content}`
    imageCache.set(imageRelPath, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}

const isSafeMarkdownUrl = (value: string, kind: 'href' | 'src') => {
  const url = value.trim()
  if (!url) return false
  if (kind === 'href') return /^(https?:|mailto:|#)/i.test(url)
  return /^(https?:|blob:|data:image\/)/i.test(url)
}

const sanitizeStyle = (value: string) => {
  const declarations = value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const safe = declarations.filter((entry) => {
    const [property, rawValue] = entry.split(':').map((part) => part.trim().toLowerCase())
    return property === 'text-align' && Boolean(rawValue) && allowedTableAlignments.has(rawValue)
  })
  return safe.join('; ')
}

const sanitizeClassValue = (value: string) =>
  value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => markdownClassPattern.test(entry))
    .join(' ')

const sanitizeMarkdownElement = (element: Element) => {
  const tag = element.tagName.toLowerCase()
  if (removedMarkdownTags.has(tag)) {
    element.remove()
    return
  }
  if (!allowedMarkdownTags.has(tag)) {
    element.replaceWith(...Array.from(element.childNodes))
    return
  }

  const allowedAttrs = markdownTagAttributes[tag] || new Set<string>()
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase()
    const value = attr.value
    if (name.startsWith('on') || !allowedAttrs.has(name)) {
      element.removeAttribute(attr.name)
      continue
    }
    if (name === 'href') {
      if (isSafeMarkdownUrl(value, 'href')) {
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noreferrer')
      } else {
        element.removeAttribute(attr.name)
      }
    } else if (name === 'src') {
      if (!isSafeMarkdownUrl(value, 'src')) element.removeAttribute(attr.name)
    } else if (name === 'style') {
      const cleanStyle = sanitizeStyle(value)
      if (cleanStyle) element.setAttribute('style', cleanStyle)
      else element.removeAttribute(attr.name)
    } else if (name === 'class') {
      const cleanClass = sanitizeClassValue(value)
      if (cleanClass) element.setAttribute('class', cleanClass)
      else element.removeAttribute(attr.name)
    } else if (tag === 'input') {
      if (name === 'type' && value !== 'checkbox') element.removeAttribute(attr.name)
      if (name === 'checked') element.setAttribute('checked', '')
      if (name === 'disabled') element.setAttribute('disabled', '')
    }
  }

  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (href && isSafeMarkdownUrl(href, 'href')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noreferrer')
    }
  }
  if (tag === 'input') {
    element.setAttribute('disabled', '')
  }
}

const sanitizeMarkdownHtml = (html: string) => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    sanitizeMarkdownElement(element)
  }
  return doc.body.innerHTML
}

const replaceLocalMarkdownImages = async (doc: Document) => {
  const tasks = Array.from(doc.querySelectorAll('img')).map(async (img) => {
    const src = img.getAttribute('src') || ''
    if (!isLocalResource(src)) return
    const dataUrl = await loadMarkdownImage(src)
    if (dataUrl) img.setAttribute('src', dataUrl)
  })
  await Promise.all(tasks)
}

const normalizeTableAlignments = (doc: Document) => {
  for (const cell of Array.from(doc.querySelectorAll('th[align], td[align]'))) {
    const align = (cell.getAttribute('align') || '').toLowerCase()
    cell.removeAttribute('align')
    if (allowedTableAlignments.has(align)) cell.setAttribute('style', `text-align: ${align}`)
  }
}

const highlightCodeBlocks = (doc: Document) => {
  let hasMermaid = false
  for (const code of Array.from(doc.querySelectorAll<HTMLElement>('pre code'))) {
    const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-'))
    const language = languageClass?.replace(/^language-/, '').toLowerCase()
    const source = code.textContent || ''

    if (language === 'mermaid') {
      const container = doc.createElement('div')
      container.className = 'mermaid'
      container.textContent = source
      code.parentElement?.replaceWith(container)
      hasMermaid = true
      continue
    }

    const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(source, { language }) : hljs.highlightAuto(source)
    code.innerHTML = highlighted.value
    code.classList.add('hljs')
    if (language) code.classList.add(`language-${language}`)
  }
  return hasMermaid
}

const ensureMermaidInitialized = () => {
  const theme = mermaidTheme.value
  if (mermaidInitialized && lastMermaidTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme
  })
  mermaidInitialized = true
  lastMermaidTheme = theme
}

const renderMermaidInPreview = async () => {
  const container = previewRef.value
  if (!container) return
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'))
  if (nodes.length === 0) return
  ensureMermaidInitialized()
  try {
    await mermaid.run({ nodes })
  } catch (runError) {
    console.warn('Failed to render knowledge markdown Mermaid diagram', runError)
  }
}

const renderMarkdownPreview = async () => {
  const token = ++previewToken
  if (!isMarkdown.value) {
    markdownHtml.value = ''
    return
  }

  const rawHtml = await marked.parse(content.value || '', {
    async: false,
    gfm: true,
    breaks: false
  })
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(rawHtml), 'text/html')
  await replaceLocalMarkdownImages(doc)
  normalizeTableAlignments(doc)
  const hasMermaid = highlightCodeBlocks(doc)
  if (token !== previewToken) return
  markdownHtml.value = sanitizeMarkdownHtml(doc.body.innerHTML)
  if (hasMermaid) {
    await nextTick()
    if (token === previewToken) await renderMermaidInPreview()
  }
}

const insertAtCursor = (value: string) => {
  if (editorRef.value?.insertAtCursor) {
    editorRef.value.insertAtCursor(value)
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
  const pasteImage = window.aiops?.kbPasteImageFromClipboard
  if (typeof pasteImage !== 'function') {
    error.value = 'Knowledge image paste service unavailable'
    return
  }
  try {
    const result = await pasteImage(getParentRelDir(relPath.value))
    if (!result?.relPath || !result.fileName || !result.dataUrl) {
      throw new Error('Knowledge image paste returned invalid result')
    }
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
    editorRef,
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
</script>
