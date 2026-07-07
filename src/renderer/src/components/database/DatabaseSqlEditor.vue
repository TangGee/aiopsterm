<template>
  <div
    class="db-sql-monaco-editor"
    :class="{ 'monaco-ready': monacoReady }"
    @click="focus"
  >
    <div
      ref="containerRef"
      class="db-sql-monaco-surface"
      data-testid="db-sql-editor-monaco"
    />
    <textarea
      ref="fallbackRef"
      class="db-sql-editor db-sql-editor-fallback"
      :value="modelValue"
      spellcheck="false"
      @input="handleFallbackInput"
      @scroll="emitFallbackMetrics"
      @click="emitFallbackMetrics"
      @keyup="emitFallbackMetrics"
      @select="emitFallbackMetrics"
      @keydown="handleFallbackKeydown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { editorIndent, editorLineHeightPx, resolveEditorFontFamily } from '@/services/common/editorRuntime'
import { loadMonaco, type MonacoModule } from '@/services/common/monacoRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

export interface DatabaseSqlEditorMetrics {
  line: number
  column: number
  selectionSize: number
  scrollTop: number
}

export interface TextRange {
  start: number
  end: number
}

const props = defineProps<{
  modelValue: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'run', mode: 'all' | 'current'): void
  (event: 'open-find', replace: boolean): void
  (event: 'metrics', metrics: DatabaseSqlEditorMetrics): void
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

const clampOffset = (offset: number, text = props.modelValue) => Math.max(0, Math.min(offset, text.length))

const fallbackSelectionRange = (): TextRange => {
  const fallback = fallbackRef.value
  const text = fallback?.value ?? props.modelValue
  const length = text.length
  if (!fallback) return { start: length, end: length }
  const start = Math.max(0, Math.min(Math.min(fallback.selectionStart, fallback.selectionEnd), length))
  const end = Math.max(0, Math.min(Math.max(fallback.selectionStart, fallback.selectionEnd), length))
  return { start, end }
}

const syncFallbackSelection = (start: number, end = start) => {
  const fallback = fallbackRef.value
  if (!fallback) return
  const text = fallback.value || editor?.getValue() || props.modelValue
  const safeStart = clampOffset(start, text)
  const safeEnd = clampOffset(end, text)
  fallback.value = text
  fallback.setSelectionRange(safeStart, safeEnd)
  emitFallbackMetrics()
}

const positionFromOffset = (text: string, offset: number) => {
  const clamped = clampOffset(offset, text)
  const before = text.slice(0, clamped)
  const line = before ? before.split('\n').length : 1
  const lastBreak = before.lastIndexOf('\n')
  return { line, column: clamped - lastBreak }
}

const selectionToRange = (selection: monaco.Selection): monaco.IRange => ({
  startLineNumber: selection.startLineNumber,
  startColumn: selection.startColumn,
  endLineNumber: selection.endLineNumber,
  endColumn: selection.endColumn
})

const monacoSelectionRange = (): TextRange => {
  const model = editor?.getModel()
  const selection = editor?.getSelection()
  if (!model || !selection) return fallbackSelectionRange()
  return {
    start: model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn }),
    end: model.getOffsetAt({ lineNumber: selection.endLineNumber, column: selection.endColumn })
  }
}

const emitFallbackMetrics = () => {
  const fallback = fallbackRef.value
  const text = fallback?.value ?? props.modelValue
  const range = fallbackSelectionRange()
  const position = positionFromOffset(text, range.start)
  emit('metrics', {
    line: position.line,
    column: position.column,
    selectionSize: Math.max(0, range.end - range.start),
    scrollTop: fallback?.scrollTop ?? 0
  })
}

const emitMonacoMetrics = () => {
  const model = editor?.getModel()
  const position = editor?.getPosition()
  if (!model || !position) {
    emitFallbackMetrics()
    return
  }
  const range = monacoSelectionRange()
  emit('metrics', {
    line: position.lineNumber,
    column: position.column,
    selectionSize: Math.max(0, range.end - range.start),
    scrollTop: editor?.getScrollTop() ?? 0
  })
  syncFallbackSelection(range.start, range.end)
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

const createEditor = () => {
  if (!containerRef.value || editor || !monacoApi) return
  editor = monacoApi.editor.create(containerRef.value, {
    value: props.modelValue,
    language: 'sql',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    folding: true,
    matchBrackets: 'always',
    renderLineHighlight: 'line',
    lineNumbers: 'off',
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
  editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter, () => emit('run', getSelectedText().trim() ? 'current' : 'all'))
  editor.onDidChangeModelContent(() => {
    if (suppressEditorEmit) return
    const value = editor?.getValue() || ''
    syncFallbackValue(value)
    if (value !== props.modelValue) emit('update:modelValue', value)
    emitMonacoMetrics()
  })
  editor.onDidChangeCursorPosition(emitMonacoMetrics)
  editor.onDidChangeCursorSelection(emitMonacoMetrics)
  editor.onDidScrollChange(emitMonacoMetrics)
  monacoReady.value = true
  emitMonacoMetrics()
}

const syncFallbackValue = (value: string) => {
  const fallback = fallbackRef.value
  if (!fallback || fallback.value === value) return
  suppressFallbackEmit = true
  fallback.value = value
  suppressFallbackEmit = false
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
  emitFallbackMetrics()
}

const handleFallbackKeydown = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 'enter') {
    event.preventDefault()
    emit('run', getSelectedText().trim() ? 'current' : 'all')
    return
  }
  if ((event.metaKey || event.ctrlKey) && key === 'f') {
    event.preventDefault()
    emit('open-find', false)
    return
  }
  if ((event.metaKey || event.ctrlKey) && key === 'h') {
    event.preventDefault()
    emit('open-find', true)
    return
  }
  if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    applyFallbackIndent(event.shiftKey)
  }
}

const applyFallbackIndent = (outdent: boolean) => {
  const fallback = fallbackRef.value
  if (!fallback) return
  const text = fallback.value
  const start = fallback.selectionStart
  const end = fallback.selectionEnd
  const edit = start === end ? indentCursor(text, start, outdent) : indentSelection(text, start, end, outdent)
  syncFallbackEmitValue(edit.sql, edit.selectionStart, edit.selectionEnd)
}

const syncFallbackEmitValue = (value: string, selectionStart: number, selectionEnd = selectionStart) => {
  const fallback = fallbackRef.value
  if (fallback) {
    fallback.value = value
    fallback.setSelectionRange(clampOffset(selectionStart, value), clampOffset(selectionEnd, value))
  }
  if (editor && value !== editor.getValue()) {
    suppressEditorEmit = true
    editor.setValue(value)
    suppressEditorEmit = false
  }
  emit('update:modelValue', value)
  emitFallbackMetrics()
  void nextTick(() => {
    const nextFallback = fallbackRef.value
    if (!nextFallback) return
    nextFallback.setSelectionRange(clampOffset(selectionStart, value), clampOffset(selectionEnd, value))
    emitFallbackMetrics()
  })
}

const indentText = () => editorIndent(workspace.editorSettings)

const indentCursor = (sql: string, cursor: number, outdent: boolean) => {
  const indent = indentText()
  if (!outdent) {
    return {
      sql: `${sql.slice(0, cursor)}${indent}${sql.slice(cursor)}`,
      selectionStart: cursor + indent.length,
      selectionEnd: cursor + indent.length
    }
  }
  const lineStart = sql.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const lineEnd = sql.indexOf('\n', lineStart)
  const line = sql.slice(lineStart, lineEnd === -1 ? sql.length : lineEnd)
  const remove = indentRemoval(line)
  if (!remove) return { sql, selectionStart: cursor, selectionEnd: cursor }
  const removedBeforeCursor = cursor >= lineStart + remove ? remove : Math.max(0, cursor - lineStart)
  return {
    sql: `${sql.slice(0, lineStart)}${line.slice(remove)}${sql.slice(lineEnd === -1 ? sql.length : lineEnd)}`,
    selectionStart: cursor - removedBeforeCursor,
    selectionEnd: cursor - removedBeforeCursor
  }
}

const indentSelection = (sql: string, selectionStart: number, selectionEnd: number, outdent: boolean) => {
  const indent = indentText()
  const range = lineRangeForSelection(sql, selectionStart, selectionEnd)
  const block = sql.slice(range.start, range.end)
  const lines = block.split('\n')
  if (!outdent) {
    const nextBlock = lines.map((line) => `${indent}${line}`).join('\n')
    return {
      sql: `${sql.slice(0, range.start)}${nextBlock}${sql.slice(range.end)}`,
      selectionStart: selectionStart + indent.length,
      selectionEnd: selectionEnd + indent.length * lines.length
    }
  }

  const removals: Array<{ position: number; length: number }> = []
  let offset = range.start
  const nextLines = lines.map((line) => {
    const remove = indentRemoval(line)
    if (remove) removals.push({ position: offset, length: remove })
    offset += line.length + 1
    return line.slice(remove)
  })
  const removedBefore = (position: number) =>
    removals.reduce((total, removal) => {
      if (position <= removal.position) return total
      if (position >= removal.position + removal.length) return total + removal.length
      return total + (position - removal.position)
    }, 0)
  return {
    sql: `${sql.slice(0, range.start)}${nextLines.join('\n')}${sql.slice(range.end)}`,
    selectionStart: selectionStart - removedBefore(selectionStart),
    selectionEnd: selectionEnd - removedBefore(selectionEnd)
  }
}

const lineRangeForSelection = (sql: string, selectionStart: number, selectionEnd: number): TextRange => {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, sql.length))
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), sql.length))
  const lineStart = sql.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const adjustedEnd = end > start && sql[end - 1] === '\n' ? end - 1 : end
  const nextBreak = sql.indexOf('\n', adjustedEnd)
  return { start: lineStart, end: nextBreak === -1 ? sql.length : nextBreak }
}

const indentRemoval = (line: string) => {
  const indent = indentText()
  if (line.startsWith('\t')) return 1
  if (line.startsWith(indent)) return indent.length
  if (line.startsWith(' ')) return 1
  return 0
}

const getText = () => fallbackRef.value?.value ?? editor?.getValue() ?? props.modelValue

const getSelectedText = () => {
  const range = fallbackSelectionRange()
  return getText().slice(range.start, range.end)
}

const replaceRange = (next: string, range: TextRange) => {
  const text = getText()
  const start = clampOffset(Math.min(range.start, range.end), text)
  const end = clampOffset(Math.max(range.start, range.end), text)
  const model = editor?.getModel()
  if (editor && model && monacoApi) {
    const monacoRange = new monacoApi.Range(
      model.getPositionAt(start).lineNumber,
      model.getPositionAt(start).column,
      model.getPositionAt(end).lineNumber,
      model.getPositionAt(end).column
    )
    editor.executeEdits('aiopsterm-sql-range', [{ range: monacoRange, text: next, forceMoveMarkers: true }])
    const cursor = start + next.length
    syncFallbackEmitValue(`${text.slice(0, start)}${next}${text.slice(end)}`, cursor)
    editor.setPosition(model.getPositionAt(cursor))
    editor.focus()
  } else {
    const value = `${text.slice(0, start)}${next}${text.slice(end)}`
    emit('update:modelValue', value)
    void nextTick(() => syncFallbackSelection(start + next.length))
  }
}

const replaceAll = (next: string) => replaceRange(next, { start: 0, end: getText().length })

const replaceSelection = (next: string) => {
  const range = getSelectionRange()
  if (range.start === range.end) return
  replaceRange(next, range)
}

const insertAtCursor = (next: string) => {
  const range = getSelectionRange()
  replaceRange(next, range)
}

const getCursorOffset = () => {
  return fallbackSelectionRange().start
}

const getSelectionRange = () => fallbackSelectionRange()

const getTextUntilCursor = () => getText().slice(0, getCursorOffset())

const getCurrentStatementRange = () => {
  const sql = getText()
  let start = 0
  let end = sql.length
  const offset = clampOffset(getCursorOffset(), sql)
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== ';') continue
    if (index < offset) start = index + 1
    else {
      end = index
      break
    }
  }
  while (start < end && /\s/.test(sql[start])) start += 1
  while (end > start && /\s/.test(sql[end - 1])) end -= 1
  return { start, end }
}

const getCurrentStatement = () => {
  const range = getCurrentStatementRange()
  return getText().slice(range.start, range.end).trim()
}

const setSelectionRange = (start: number, end = start) => {
  const text = getText()
  const safeStart = clampOffset(start, text)
  const safeEnd = clampOffset(end, text)
  const fallback = fallbackRef.value
  if (fallback) {
    fallback.value = text
    fallback.setSelectionRange(safeStart, safeEnd)
    emitFallbackMetrics()
  }
  const model = editor?.getModel()
  if (editor && model) {
    editor.setSelection({
      startLineNumber: model.getPositionAt(safeStart).lineNumber,
      startColumn: model.getPositionAt(safeStart).column,
      endLineNumber: model.getPositionAt(safeEnd).lineNumber,
      endColumn: model.getPositionAt(safeEnd).column
    })
    editor.revealPositionInCenterIfOutsideViewport?.(model.getPositionAt(safeEnd))
    editor.focus()
    return
  }
}

const focus = () => {
  if (editor) {
    editor.focus()
    emitMonacoMetrics()
    return
  }
  fallbackRef.value?.focus()
  emitFallbackMetrics()
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
    emitMonacoMetrics()
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
  getSelectedText,
  getTextUntilCursor,
  getCurrentStatement,
  getCurrentStatementRange,
  getCursorOffset,
  getSelectionRange,
  setSelectionRange,
  replaceAll,
  replaceSelection,
  replaceRange,
  insertAtCursor,
  focus
})
</script>
