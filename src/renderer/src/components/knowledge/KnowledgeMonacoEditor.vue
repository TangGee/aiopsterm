<template>
  <div
    class="kb-monaco-editor"
    :class="{ 'monaco-ready': monacoReady }"
    data-testid="kb-editor-monaco"
    @click="focus"
  >
    <div
      ref="containerRef"
      class="kb-monaco-surface"
    />
    <textarea
      ref="fallbackRef"
      class="kb-editor-textarea kb-editor-fallback"
      :value="modelValue"
      spellcheck="false"
      @input="handleFallbackInput"
      @keydown="handleFallbackKeydown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { editorLineHeightPx, resolveEditorFontFamily } from '@/services/common/editorRuntime'
import { loadMonaco, type MonacoModule } from '@/services/common/monacoRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

export interface KnowledgeTextRange {
  start: number
  end: number
}

const props = defineProps<{
  modelValue: string
  language: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'save'): void
}>()

const workspace = useWorkspaceStore()
const containerRef = ref<HTMLElement | null>(null)
const fallbackRef = ref<HTMLTextAreaElement | null>(null)
const monacoReady = ref(false)
let monacoApi: MonacoModule | null = null
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let suppressEditorEmit = false
let suppressFallbackEmit = false
let pendingRevealRange: { startLine: number; endLine: number } | null = null

const monacoTheme = computed(() => (workspace.config.theme === 'light' || document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark'))
const normalizedLanguage = computed(() => (props.language === 'text' ? 'plaintext' : props.language || 'plaintext'))
const editorOptions = computed<monaco.editor.IStandaloneEditorConstructionOptions>(() => {
  const settings = workspace.editorSettings
  return {
    fontFamily: resolveEditorFontFamily(settings.fontFamily),
    fontSize: settings.fontSize,
    lineHeight: editorLineHeightPx(settings),
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap,
    minimap: { enabled: settings.minimap },
    mouseWheelZoom: settings.mouseWheelZoom,
    theme: monacoTheme.value,
    readOnly: !!props.readonly
  }
})

const clampOffset = (offset: number, text = getText()) => Math.max(0, Math.min(offset, text.length))

const applyModelOptions = () => {
  const model = editor?.getModel()
  if (!model) return
  model.updateOptions({
    tabSize: workspace.editorSettings.tabSize,
    indentSize: workspace.editorSettings.tabSize,
    insertSpaces: true
  })
}

const syncFallbackValue = (value: string) => {
  const fallback = fallbackRef.value
  if (!fallback || fallback.value === value) return
  suppressFallbackEmit = true
  fallback.value = value
  suppressFallbackEmit = false
}

const createEditor = () => {
  if (!containerRef.value || editor || !monacoApi) return
  editor = monacoApi.editor.create(containerRef.value, {
    value: props.modelValue,
    language: normalizedLanguage.value,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    folding: true,
    matchBrackets: 'always',
    renderLineHighlight: 'line',
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    glyphMargin: false,
    lineDecorationsWidth: 0,
    contextmenu: false,
    padding: { top: 14, bottom: 60 },
    scrollbar: {
      useShadows: false,
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8
    },
    find: {
      seedSearchStringFromSelection: 'selection',
      autoFindInSelection: 'multiline'
    },
    stickyScroll: { enabled: false },
    insertSpaces: true,
    detectIndentation: false,
    ...editorOptions.value
  })
  applyModelOptions()
  editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => emit('save'))
  editor.onDidChangeModelContent(() => {
    if (suppressEditorEmit) return
    const value = editor?.getValue() || ''
    syncFallbackValue(value)
    if (value !== props.modelValue) emit('update:modelValue', value)
  })
  monacoReady.value = true
  if (pendingRevealRange) {
    const range = pendingRevealRange
    void nextTick(() => revealLineRange(range.startLine, range.endLine))
  }
}

const handleFallbackInput = (event: Event) => {
  if (suppressFallbackEmit) return
  const value = (event.target as HTMLTextAreaElement).value
  if (editor && value !== editor.getValue()) {
    suppressEditorEmit = true
    editor.setValue(value)
    suppressEditorEmit = false
  }
  emit('update:modelValue', value)
}

const handleFallbackKeydown = (event: KeyboardEvent) => {
  const shouldSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
  if (!shouldSave) return
  event.preventDefault()
  event.stopPropagation()
  emit('save')
}

const getText = () => fallbackRef.value?.value ?? editor?.getValue() ?? props.modelValue

const getSelectionRange = (): KnowledgeTextRange => {
  const model = editor?.getModel()
  const selection = editor?.getSelection()
  if (model && selection) {
    return {
      start: model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn }),
      end: model.getOffsetAt({ lineNumber: selection.endLineNumber, column: selection.endColumn })
    }
  }
  const fallback = fallbackRef.value
  const text = fallback?.value ?? props.modelValue
  if (!fallback) return { start: text.length, end: text.length }
  return {
    start: Math.max(0, Math.min(fallback.selectionStart, fallback.selectionEnd, text.length)),
    end: Math.max(0, Math.min(Math.max(fallback.selectionStart, fallback.selectionEnd), text.length))
  }
}

const setSelectionRange = (start: number, end = start) => {
  const text = getText()
  const safeStart = clampOffset(start, text)
  const safeEnd = clampOffset(end, text)
  const fallback = fallbackRef.value
  if (fallback) {
    fallback.value = text
    fallback.setSelectionRange(safeStart, safeEnd)
  }
  const model = editor?.getModel()
  if (editor && model) {
    const startPosition = model.getPositionAt(safeStart)
    const endPosition = model.getPositionAt(safeEnd)
    editor.setSelection({
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column
    })
    editor.revealPositionInCenterIfOutsideViewport?.(endPosition)
  }
}

const replaceRange = (next: string, range = getSelectionRange()) => {
  const text = getText()
  const start = clampOffset(Math.min(range.start, range.end), text)
  const end = clampOffset(Math.max(range.start, range.end), text)
  const value = `${text.slice(0, start)}${next}${text.slice(end)}`
  const cursor = start + next.length
  if (editor && editor.getModel()) {
    suppressEditorEmit = true
    editor.setValue(value)
    suppressEditorEmit = false
  }
  syncFallbackValue(value)
  emit('update:modelValue', value)
  void nextTick(() => setSelectionRange(cursor))
}

const insertAtCursor = (next: string) => replaceRange(next, getSelectionRange())

const revealLineRange = (startLine: number, endLine = startLine) => {
  const safeStart = Math.max(1, Math.floor(startLine || 1))
  const safeEnd = Math.max(safeStart, Math.floor(endLine || safeStart))
  pendingRevealRange = { startLine: safeStart, endLine: safeEnd }
  const fallback = fallbackRef.value
  if (fallback) {
    const lines = getText().split('\n')
    const startOffset = lines.slice(0, safeStart - 1).join('\n').length + (safeStart > 1 ? 1 : 0)
    const endOffset = lines.slice(0, safeEnd).join('\n').length
    fallback.setSelectionRange(clampOffset(startOffset), clampOffset(endOffset))
  }
  const model = editor?.getModel()
  if (editor && model) {
    const maxLine = model.getLineCount()
    const start = Math.min(safeStart, maxLine)
    const end = Math.min(safeEnd, maxLine)
    editor.setSelection({
      startLineNumber: start,
      startColumn: 1,
      endLineNumber: end,
      endColumn: model.getLineMaxColumn(end)
    })
    editor.revealLineInCenter?.(start)
    editor.focus()
    pendingRevealRange = null
  } else {
    fallback?.focus()
  }
}

const focus = () => {
  if (editor) {
    editor.focus()
    return
  }
  fallbackRef.value?.focus()
}

onMounted(async () => {
  syncFallbackValue(props.modelValue)
  monacoApi = await loadMonaco()
  await nextTick()
  createEditor()
})

watch(
  () => props.modelValue,
  (value) => {
    syncFallbackValue(value)
    if (!editor || value === editor.getValue()) return
    suppressEditorEmit = true
    editor.setValue(value)
    suppressEditorEmit = false
  }
)

watch(
  normalizedLanguage,
  (language) => {
    const model = editor?.getModel()
    if (!model || !monacoApi) return
    monacoApi.editor.setModelLanguage(model, language)
  }
)

watch(
  editorOptions,
  (options) => {
    if (!editor) return
    editor.updateOptions(options)
    applyModelOptions()
    editor.layout()
  },
  { deep: true }
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})

defineExpose({
  getText,
  getSelectionRange,
  setSelectionRange,
  revealLineRange,
  replaceRange,
  insertAtCursor,
  focus
})
</script>
