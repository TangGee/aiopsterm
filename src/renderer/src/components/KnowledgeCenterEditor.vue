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
      class="kb-markdown-preview"
      v-html="markdownHtml"
    ></div>

    <textarea
      v-else
      ref="editorRef"
      v-model="content"
      class="kb-editor-textarea"
      spellcheck="false"
      @input="scheduleSave"
    ></textarea>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Eye, Maximize2, Pencil, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  relPath: string
  isImage?: boolean
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
const editorRef = ref<HTMLTextAreaElement | null>(null)
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

const minImageScale = 0.1
const maxImageScale = 10
const zoomStep = 0.25

const relPath = computed(() => props.relPath)
const isImage = computed(() => Boolean(props.isImage))
const isMarkdown = computed(() => /\.(md|markdown)$/i.test(relPath.value))
const title = computed(() => relPath.value.split('/').pop() || 'KnowledgeCenter')
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
    }
  } catch (loadError) {
    if (token !== loadToken) return
    error.value = loadError instanceof Error ? loadError.message : String(loadError)
  } finally {
    if (token === loadToken) loading.value = false
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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const escapeAttribute = (value: string) => escapeHtml(value).replace(/`/g, '&#96;')

const isLocalResource = (src: string) => Boolean(src) && !/^(https?:|data:|blob:|mailto:|#)/i.test(src)

const safeImageSource = (src: string, imageSources: Map<string, string>) => {
  if (imageSources.has(src)) return imageSources.get(src)!
  if (/^https?:/i.test(src) || /^data:image\//i.test(src) || /^blob:/i.test(src)) return src
  return '#'
}

const resolveMarkdownResource = (src: string) => {
  if (src.startsWith('/')) return src.replace(/^\/+/, '')
  return createRelPath(getParentRelDir(relPath.value), src)
}

const collectMarkdownImages = (source: string) => {
  const refs = new Set<string>()
  const pattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of source.matchAll(pattern)) {
    const src = match[1].trim()
    if (isLocalResource(src)) refs.add(src)
  }
  return refs
}

const loadMarkdownImage = async (src: string) => {
  const imageRelPath = resolveMarkdownResource(src)
  if (imageCache.has(imageRelPath)) return imageCache.get(imageRelPath)!
  if (!window.aiops?.kbReadFile) return null
  try {
    const result = await window.aiops.kbReadFile(imageRelPath, 'base64')
    const dataUrl = `data:${result.mimeType || 'application/octet-stream'};base64,${result.content}`
    imageCache.set(imageRelPath, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}

const renderInline = (source: string, imageSources: Map<string, string>) => {
  const placeholders: string[] = []
  const hold = (html: string) => {
    placeholders.push(html)
    return `\u0000${placeholders.length - 1}\u0000`
  }
  let text = source
    .replace(/`([^`]+)`/g, (_match, code: string) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt: string, src: string) =>
      hold(`<img src="${escapeAttribute(safeImageSource(src, imageSources))}" alt="${escapeAttribute(alt)}" />`)
    )
    .replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label: string, href: string) => {
      const safeHref = /^(https?:|mailto:|#)/i.test(href) ? href : '#'
      return hold(`<a href="${escapeAttribute(safeHref)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    })
  text = escapeHtml(text)
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => placeholders[Number(index)] || '')
}

const splitTableRow = (line: string) =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

const tableAlignment = (cell: string) => {
  const trimmed = cell.trim()
  if (/^:-+:$/.test(trimmed)) return 'center'
  if (/^-+:$/.test(trimmed)) return 'right'
  if (/^:-+$/.test(trimmed)) return 'left'
  return ''
}

const renderMarkdown = (source: string, imageSources: Map<string, string>) => {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```([\w-]+)?\s*$/)
    if (fence) {
      const language = fence[1] || ''
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      html.push(`<pre><code${language ? ` class="language-${escapeAttribute(language)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2], imageSources)}</h${level}>`)
      index += 1
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*[-*+]\s+/, ''), imageSources)}</li>`)
        index += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*\d+[.)]\s+/, ''), imageSources)}</li>`)
        index += 1
      }
      html.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      html.push(`<blockquote>${quoteLines.map((item) => renderInline(item, imageSources)).join('<br>')}</blockquote>`)
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const headers = splitTableRow(line)
      const aligns = splitTableRow(lines[index + 1]).map(tableAlignment)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      const headerHtml = headers
        .map((cell, cellIndex) => `<th${aligns[cellIndex] ? ` style="text-align: ${aligns[cellIndex]}"` : ''}>${renderInline(cell, imageSources)}</th>`)
        .join('')
      const rowsHtml = rows
        .map((row) => `<tr>${row.map((cell, cellIndex) => `<td${aligns[cellIndex] ? ` style="text-align: ${aligns[cellIndex]}"` : ''}>${renderInline(cell, imageSources)}</td>`).join('')}</tr>`)
        .join('')
      html.push(`<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`)
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index])
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    html.push(`<p>${renderInline(paragraph.join(' '), imageSources)}</p>`)
  }
  return html.join('\n')
}

const renderMarkdownPreview = async () => {
  const token = ++previewToken
  if (!isMarkdown.value) {
    markdownHtml.value = ''
    return
  }
  const imageSources = new Map<string, string>()
  const refs = collectMarkdownImages(content.value)
  await Promise.all(
    [...refs].map(async (src) => {
      const dataUrl = await loadMarkdownImage(src)
      if (dataUrl) imageSources.set(src, dataUrl)
    })
  )
  if (token !== previewToken) return
  markdownHtml.value = renderMarkdown(content.value, imageSources)
}

const imageExtensionFromMime = (mimeType: string) => {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/bmp') return 'bmp'
  if (normalized === 'image/svg+xml') return 'svg'
  return 'png'
}

const insertAtCursor = (value: string) => {
  const textarea = editorRef.value
  if (!textarea) {
    content.value += value
    return
  }
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  content.value = `${content.value.slice(0, start)}${value}${content.value.slice(end)}`
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.selectionStart = start + value.length
    textarea.selectionEnd = start + value.length
  })
}

const handlePaste = async (event: ClipboardEvent) => {
  if (!isMarkdown.value || isImage.value || mode.value !== 'editor') return
  const items = event.clipboardData?.items ? Array.from(event.clipboardData.items) : []
  const item = items.find((entry) => entry.type.startsWith('image/'))
  const file = item?.getAsFile()
  if (!file || !window.aiops?.kbWriteFile) return
  event.preventDefault()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read pasted image'))
    reader.readAsDataURL(file)
  })
  const base64 = dataUrl.split(',')[1] || ''
  if (!base64) return
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `pasted-image-${timestamp}.${imageExtensionFromMime(file.type)}`
  const imageRelPath = createRelPath(getParentRelDir(relPath.value), fileName)
  await window.aiops.kbWriteFile(imageRelPath, base64, 'base64')
  imageCache.set(imageRelPath, dataUrl)
  insertAtCursor(`![](${fileName})`)
  dirty.value = true
  scheduleSave()
  void renderMarkdownPreview()
  void workspace.refreshKnowledgeTree()
}

watch(() => [props.relPath, props.isImage] as const, loadFile)

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
