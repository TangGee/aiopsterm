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
    <TextEditorContextMenu
      :visible="editorMenu.menu.visible"
      :x="editorMenu.menu.x"
      :y="editorMenu.menu.y"
      :items="editorMenu.items.value"
      @select="editorMenu.execute"
      @close="editorMenu.close(true)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import TextEditorContextMenu from '@/components/common/TextEditorContextMenu.vue'
import { editorLineHeightPx, resolveEditorFontFamily } from '@/services/common/editorRuntime'
import { loadMonaco, type MonacoModule } from '@/services/common/monacoRuntime'
import { useTextEditorContextMenu } from '@/services/common/textEditorContextMenuRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

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
let monacoApi: MonacoModule | null = null
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let editorContextMenuDisposable: { dispose(): void } | null = null
let suppressEditorEmit = false

const editorMenu = useTextEditorContextMenu({
  getEditor: () => editor,
  onSave: () => emit('save')
})

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
  if (!containerRef.value || editor || !monacoApi) return
  editor = monacoApi.editor.create(containerRef.value, {
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
    contextmenu: false,
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
  editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => emit('save'))
  editorContextMenuDisposable = editor.onContextMenu?.((event) => editorMenu.open(event.event.browserEvent)) || null
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

onMounted(async () => {
  monacoApi = await loadMonaco()
  await nextTick()
  createEditor()
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
  editorContextMenuDisposable?.dispose()
  editorContextMenuDisposable = null
  editor?.dispose()
  editor = null
})
</script>
