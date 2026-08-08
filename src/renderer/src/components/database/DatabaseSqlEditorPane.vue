<template>
  <div
    class="db-sql-editor-shell"
    @click="focusSqlEditor"
  >
    <div
      class="db-sql-editor-gutter"
      :style="{ transform: `translateY(-${sqlEditorScrollTop}px)` }"
      aria-hidden="true"
    >
      <span
        v-for="line in activeSqlEditorLines"
        :key="line"
        :class="{ active: line === sqlEditorActiveLine }"
      >
        {{ line }}
      </span>
    </div>
    <div class="db-sql-editor-surface">
      <div
        class="db-sql-editor-active-line"
        :style="{ transform: `translateY(${sqlEditorActiveLineTop}px)` }"
        aria-hidden="true"
      />
      <DatabaseSqlEditor
        ref="sqlEditorRef"
        v-model="activeSqlText"
        :run-disabled="!activeSqlCanRun"
        :save-disabled="activeSqlSaving"
        :format-disabled="!activeSqlTab.connectionId"
        @metrics="emit('syncSqlEditorState', $event)"
        @run="emit('runSql', $event)"
        @save="emit('saveActiveSql', false)"
        @format="emit('formatSql')"
        @open-find="emit('openSqlFind', $event)"
      />
    </div>
    <div
      v-if="sqlFindOpen"
      class="db-sql-find-panel"
      @click.stop
    >
      <div class="db-sql-find-row">
        <Search />
        <input
          ref="sqlFindInputRef"
          :value="sqlFindQuery"
          :aria-label="t('database.sql.find.findInSql')"
          :placeholder="t('database.sql.find.find')"
          @input="emit('update:sqlFindQuery', ($event.target as HTMLInputElement).value)"
          @keydown="(event) => emit('handleSqlFindKeydown', event, 'query')"
        />
        <span class="db-sql-find-count">{{ localizedSqlFindSummary }}</span>
        <button
          type="button"
          :title="t('database.sql.find.previousMatch')"
          :disabled="sqlFindMatches.length === 0"
          @click="emit('goToSqlFindMatch', -1)"
        >
          ↑
        </button>
        <button
          type="button"
          :title="t('database.sql.find.nextMatch')"
          :disabled="sqlFindMatches.length === 0"
          @click="emit('goToSqlFindMatch', 1)"
        >
          ↓
        </button>
        <button
          type="button"
          :title="t('database.sql.find.toggleReplace')"
          :class="{ active: sqlFindReplaceOpen }"
          @click="emit('toggleSqlFindReplace')"
        >
          {{ t('database.sql.find.replace') }}
        </button>
        <button
          type="button"
          :title="t('database.sql.find.matchCase')"
          :class="{ active: sqlFindCaseSensitive }"
          @click="emit('update:sqlFindCaseSensitive', !sqlFindCaseSensitive)"
        >
          Aa
        </button>
        <button
          type="button"
          :title="t('database.sql.find.close')"
          @click="emit('closeSqlFind', true)"
        >
          <X />
        </button>
      </div>
      <div
        v-if="sqlFindReplaceOpen"
        class="db-sql-find-row replace"
      >
        <span />
        <input
          ref="sqlReplaceInputRef"
          :value="sqlFindReplace"
          :aria-label="t('database.sql.find.replaceInSql')"
          :placeholder="t('database.sql.find.replace')"
          @input="emit('update:sqlFindReplace', ($event.target as HTMLInputElement).value)"
          @keydown="(event) => emit('handleSqlFindKeydown', event, 'replace')"
        />
        <button
          type="button"
          :title="t('database.sql.find.replaceCurrent')"
          :disabled="sqlFindMatches.length === 0"
          @click="emit('replaceCurrentSqlFindMatch')"
        >
          {{ t('database.sql.find.replace') }}
        </button>
        <button
          type="button"
          :title="t('database.sql.find.replaceAll')"
          :disabled="sqlFindMatches.length === 0"
          @click="emit('replaceAllSqlFindMatches')"
        >
          {{ t('database.sql.find.all') }}
        </button>
      </div>
    </div>
    <footer class="db-sql-editor-footer">
      <span
        v-if="activeSqlTab"
        class="db-sql-save-state"
        :class="{ dirty: activeSqlIsDirty, saving: activeSqlSaving, error: Boolean(activeSqlTab.saveError) }"
        :title="activeSqlTab.filePath || activeSqlTab.saveError || undefined"
      >
        {{ localizedActiveSqlSaveStateText }}
      </span>
      <span>{{ editorLineCountText }}</span>
      <span>{{ t('database.sql.editor.position', { line: sqlEditorActiveLine, column: sqlEditorActiveColumn }) }}</span>
      <span v-if="sqlEditorSelectionSize">{{ t('database.sql.editor.selectedCount', { count: sqlEditorSelectionSize }) }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import DatabaseSqlEditor, { type DatabaseSqlEditorMetrics } from '@/components/database/DatabaseSqlEditor.vue'
import type { DatabaseSqlWorkspaceApi, SqlTab } from '@/components/database/databaseMainWorkspaceTypes'
import type { TextRange } from '@/services/database/databaseSqlEditorRuntime'

const props = defineProps<{
  activeSqlTab: SqlTab
  activeSqlCanRun: boolean
  activeSqlSaving: boolean
  sqlEditorScrollTop: number
  activeSqlEditorLines: number[]
  sqlEditorActiveLine: number
  sqlEditorActiveLineTop: number
  sqlFindOpen: boolean
  sqlFindQuery: string
  sqlFindSummary: string
  sqlFindMatches: TextRange[]
  sqlFindReplaceOpen: boolean
  sqlFindCaseSensitive: boolean
  sqlFindReplace: string
  activeSqlIsDirty: boolean
  activeSqlSaveStateText: string
  activeSqlEditorLineCount: number
  sqlEditorActiveColumn: number
  sqlEditorSelectionSize: number
}>()

const emit = defineEmits<{
  'update:sqlFindQuery': [value: string]
  'update:sqlFindReplace': [value: string]
  'update:sqlFindCaseSensitive': [value: boolean]
  updateActiveSql: [value: string]
  syncSqlEditorState: [metrics?: DatabaseSqlEditorMetrics]
  runSql: [mode: 'all' | 'current']
  saveActiveSql: [forceSaveAs: boolean]
  formatSql: []
  openSqlFind: [replace: boolean]
  handleSqlFindKeydown: [event: KeyboardEvent, field: 'query' | 'replace']
  goToSqlFindMatch: [direction: 1 | -1]
  toggleSqlFindReplace: []
  closeSqlFind: [refocusEditor: boolean]
  replaceCurrentSqlFindMatch: []
  replaceAllSqlFindMatches: []
}>()

const sqlEditorRef = ref<DatabaseSqlWorkspaceApi | null>(null)
const sqlFindInputRef = ref<HTMLInputElement | null>(null)
const sqlReplaceInputRef = ref<HTMLInputElement | null>(null)
const { t } = useI18n()

const localizedSqlFindSummary = computed(() => {
  if (props.sqlFindSummary === 'Find') return t('database.sql.find.find')
  if (props.sqlFindSummary === 'No results') return t('database.sql.find.noResults')
  return props.sqlFindSummary
})

const localizedActiveSqlSaveStateText = computed(() => {
  if (props.activeSqlSaveStateText === 'Saving...') return t('database.sql.save.savingProgress')
  if (props.activeSqlSaveStateText === 'Unsaved changes') return t('database.sql.save.unsavedChanges')
  if (props.activeSqlSaveStateText === 'Not saved') return t('database.sql.save.notSaved')
  if (props.activeSqlSaveStateText.startsWith('Saved: ')) {
    return t('database.sql.save.savedFile', { file: props.activeSqlSaveStateText.slice('Saved: '.length) })
  }
  return props.activeSqlSaveStateText
})

const editorLineCountText = computed(() =>
  props.activeSqlEditorLineCount === 1
    ? t('database.sql.editor.lineCount.one', { count: props.activeSqlEditorLineCount })
    : t('database.sql.editor.lineCount.many', { count: props.activeSqlEditorLineCount })
)

const activeSqlText = computed({
  get() {
    return props.activeSqlTab.sql
  },
  set(value: string) {
    emit('updateActiveSql', value)
  }
})

function focusSqlEditor(event?: MouseEvent) {
  if (event?.target instanceof HTMLTextAreaElement || event?.target instanceof HTMLInputElement || event?.target instanceof HTMLButtonElement) return
  sqlEditorRef.value?.focus()
}

function focusSqlFindInput(target: 'query' | 'replace') {
  void nextTick(() => {
    const input = target === 'replace' ? sqlReplaceInputRef.value : sqlFindInputRef.value
    input?.focus()
    input?.select()
  })
}

function fallbackRange(): TextRange {
  const length = props.activeSqlTab.sql.length
  return { start: length, end: length }
}

function getText() {
  return sqlEditorRef.value?.getText() ?? props.activeSqlTab.sql
}

function getSelectedText() {
  return sqlEditorRef.value?.getSelectedText() ?? ''
}

function getTextUntilCursor() {
  return sqlEditorRef.value?.getTextUntilCursor() ?? getText().slice(0, getCursorOffset())
}

function getCurrentStatement() {
  return sqlEditorRef.value?.getCurrentStatement() ?? ''
}

function getCurrentStatementRange() {
  return sqlEditorRef.value?.getCurrentStatementRange() ?? fallbackRange()
}

function getCursorOffset() {
  return sqlEditorRef.value?.getCursorOffset() ?? props.activeSqlTab.sql.length
}

function getSelectionRange() {
  return sqlEditorRef.value?.getSelectionRange() ?? fallbackRange()
}

function setSelectionRange(start: number, end?: number) {
  sqlEditorRef.value?.setSelectionRange(start, end)
}

function replaceAll(next: string) {
  sqlEditorRef.value?.replaceAll(next)
}

function replaceSelection(next: string) {
  sqlEditorRef.value?.replaceSelection(next)
}

function replaceRange(next: string, range: TextRange) {
  sqlEditorRef.value?.replaceRange(next, range)
}

function insertAtCursor(next: string) {
  sqlEditorRef.value?.insertAtCursor(next)
}

function focus() {
  sqlEditorRef.value?.focus()
}

defineExpose<DatabaseSqlWorkspaceApi>({
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
  focus,
  focusSqlFindInput
})
</script>
