<template>
  <div
    class="files-monaco-editor"
    :class="{ 'monaco-ready': monacoReady }"
    data-testid="files-editor-monaco"
    @click="focus"
  >
    <div
      ref="containerRef"
      class="files-monaco-surface"
    />
    <textarea
      ref="fallbackRef"
      class="files-editor-body files-editor-fallback"
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
    contextmenu: false,
    padding: { top: 12, bottom: 48 },
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

defineExpose({ focus })
</script>
