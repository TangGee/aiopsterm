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
      @blur="emit('blur')"
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
import { loadMonaco, resolveMonacoLanguageId, type MonacoModule } from '@/services/common/monacoRuntime'
import { useTextEditorContextMenu } from '@/services/common/textEditorContextMenuRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  modelValue: string
  language?: string
  filePath?: string
  modelUri?: string
  minimap?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'save'): void
  (event: 'blur'): void
}>()

const workspace = useWorkspaceStore()
const containerRef = ref<HTMLElement | null>(null)
const fallbackRef = ref<HTMLTextAreaElement | null>(null)
const monacoReady = ref(false)
let monacoApi: MonacoModule | null = null
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let ownsModel = false
let editorContextMenuDisposable: { dispose(): void } | null = null
let suppressEditorEmit = false
let suppressFallbackEmit = false
const resolvedLanguage = ref('plaintext')

const editorMenu = useTextEditorContextMenu({
  getEditor: () => editor,
  isReadonly: () => Boolean(props.readonly),
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
    minimap: { enabled: props.minimap ?? settings.minimap },
    mouseWheelZoom: settings.mouseWheelZoom,
    theme: monacoTheme.value,
    readOnly: !!props.readonly
  }
})

const updateResolvedLanguage = () => {
  const requested = props.language?.trim()
  if (requested && requested !== 'auto') {
    resolvedLanguage.value = requested === 'text' ? 'plaintext' : requested
    return
  }
  resolvedLanguage.value = monacoApi
    ? resolveMonacoLanguageId(monacoApi.languages.getLanguages(), props.filePath || '', props.modelValue)
    : 'plaintext'
}

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

const resolveModelUri = () => {
  if (!monacoApi) return null
  const path = props.modelUri || props.filePath
  if (!path) return null
  return path.includes('://') ? monacoApi.Uri.parse(path) : monacoApi.Uri.file(path)
}

const createEditor = () => {
  if (!containerRef.value || editor || !monacoApi) return
  const uri = resolveModelUri()
  model = uri ? monacoApi.editor.getModel(uri) : null
  if (!model) {
    model = monacoApi.editor.createModel(props.modelValue, resolvedLanguage.value, uri || undefined)
    ownsModel = true
  } else {
    monacoApi.editor.setModelLanguage(model, resolvedLanguage.value)
  }
  editor = monacoApi.editor.create(containerRef.value, {
    model,
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
  editorContextMenuDisposable = editor.onContextMenu?.((event) => editorMenu.open(event.event.browserEvent)) || null
  editor.onDidChangeModelContent(() => {
    if (suppressEditorEmit) return
    const value = editor?.getValue() || ''
    syncFallbackValue(value)
    if (value !== props.modelValue) emit('update:modelValue', value)
  })
  editor.onDidBlurEditorWidget?.(() => {
    if (!editorMenu.menu.visible) emit('blur')
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
  updateResolvedLanguage()
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
  () => [props.language, props.filePath, props.modelValue.split(/\r?\n/, 1)[0]],
  () => {
    updateResolvedLanguage()
    const model = editor?.getModel()
    if (!model || !monacoApi) return
    monacoApi.editor.setModelLanguage(model, resolvedLanguage.value)
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
  if (ownsModel) model?.dispose()
  model = null
  ownsModel = false
})

defineExpose({ focus })
</script>
