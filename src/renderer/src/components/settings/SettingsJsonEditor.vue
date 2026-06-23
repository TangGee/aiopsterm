<template>
  <div
    class="settings-json-editor"
    :class="{ 'monaco-ready': monacoReady }"
  >
    <div
      ref="containerRef"
      class="settings-json-editor-monaco"
      :data-testid="`${editorClass}-monaco`"
    />
    <textarea
      :class="[editorClass, 'settings-json-editor-fallback']"
      :value="modelValue"
      spellcheck="false"
      @input="emitInput"
      @keydown="handleFallbackKeydown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding'
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController'
import { editorLineHeightPx, resolveEditorFontFamily } from '@/services/common/editorRuntime'
import { ensureMonacoEnvironment } from '@/services/common/monacoRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

ensureMonacoEnvironment()

const props = defineProps<{
  modelValue: string
  editorClass: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'save'): void
}>()

const workspace = useWorkspaceStore()
const containerRef = ref<HTMLElement | null>(null)
const monacoReady = ref(false)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let suppressEditorEmit = false

const monacoTheme = computed(() => (workspace.config.theme === 'light' || document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark'))
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
    theme: monacoTheme.value
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

const createEditor = () => {
  if (!containerRef.value || editor) return
  editor = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: 'json',
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
    padding: { top: 12, bottom: 80 },
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
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
  editor.onDidChangeModelContent(() => {
    if (suppressEditorEmit) return
    const value = editor?.getValue() || ''
    if (value !== props.modelValue) emit('update:modelValue', value)
  })
  monacoReady.value = true
}

const emitInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

const handleFallbackKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    emit('save')
  }
}

onMounted(() => {
  void nextTick(createEditor)
})

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || value === editor.getValue()) return
    suppressEditorEmit = true
    editor.setValue(value)
    suppressEditorEmit = false
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
</script>
