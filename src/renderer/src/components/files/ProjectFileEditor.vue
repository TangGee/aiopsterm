<template>
  <section class="project-file-editor">
    <header>
      <div>
        <strong>{{ editorPath }}</strong>
        <small>{{ editorRoot }}</small>
      </div>
    </header>
    <div
      v-if="conflict"
      class="project-file-conflict"
    >
      <span>{{ conflict }}</span>
      <button type="button" :disabled="loading || saving" @click="reload(true)">{{ t('projectFiles.editor.reloadDisk') }}</button>
      <button type="button" :disabled="loading || saving" @click="save(true, true)">{{ t('projectFiles.editor.overwrite') }}</button>
    </div>
    <div
      v-if="error"
      class="project-file-error"
    >
      {{ error }}
    </div>
    <FilesMonacoEditor
      :model-value="content"
      language="auto"
      :file-path="editorPath"
      :minimap="false"
      :readonly="loading || !readReady"
      @update:model-value="handleEditorChange"
      @save="save(false, true)"
      @blur="save(false, true)"
    />
    <footer>
      <span :class="statusClass">{{ statusText }}</span>
      <span>{{ editorPath }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FilesMonacoEditor from '@/components/files/FilesMonacoEditor.vue'
import { useI18n } from '@/i18n'
import { registerProjectFileEditorFlush } from '@/services/files/projectFileEditorSaveRegistry'
import { projectFilesClient } from '@/services/files/projectFilesClient'
import { localFilesClient } from '@/services/app/localFilesClient'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ProjectFileWatchEvent } from '@shared/contracts/projectFiles'
import type { LocalEditorFileWatchEvent } from '@shared/contracts/localFiles'

const props = defineProps<{ panel: TerminalPanel }>()
const workspace = useWorkspaceStore()
const { t } = useI18n()

const content = ref('')
const originContent = ref('')
const originContentHash = ref('')
const mtimeMs = ref(0)
const size = ref(0)
const loading = ref(true)
const saving = ref(false)
const readReady = ref(false)
const error = ref('')
const conflict = ref('')
const watchId = `project-file-editor-${props.panel.id}`
const autosaveDelayMs = 1000
let offWatch: (() => void) | null = null
let unregisterFlush: (() => void) | null = null
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let inFlightSave: Promise<boolean> | null = null
let conflictEpoch = 0
let mounted = false
let watchedPath = ''

const projectFile = computed(() => props.panel.projectFile)
const localFile = computed(() => props.panel.localFile)
const editorPath = computed(() => localFile.value?.filePath || projectFile.value?.relativePath || '')
const editorRoot = computed(() => localFile.value ? props.panel.cwd : projectFile.value?.projectRoot || '')
const dirty = computed(() => content.value !== originContent.value)
const statusText = computed(() => {
  if (loading.value) return t('projectFiles.editor.status.loading')
  if (conflict.value) return t('projectFiles.editor.status.conflict')
  if (error.value) return readReady.value ? t('projectFiles.editor.status.saveFailed') : t('projectFiles.editor.status.loadFailed')
  if (saving.value) return t('projectFiles.editor.status.saving')
  return dirty.value ? t('projectFiles.editor.status.unsaved') : t('projectFiles.editor.status.saved')
})
const statusClass = computed(() => ({
  saving: saving.value,
  dirty: dirty.value && !conflict.value,
  conflict: Boolean(conflict.value),
  error: Boolean(error.value)
}))

watch(dirty, (value) => {
  if (props.panel.projectFile) props.panel.projectFile.dirty = value
  if (props.panel.localFile) props.panel.localFile.dirty = value
}, { immediate: true })

const contextInput = () => ({
  source: projectFile.value!.source,
  sessionId: projectFile.value!.sessionId,
  relativePath: projectFile.value!.relativePath
})

const clearAutosave = () => {
  if (!autosaveTimer) return
  clearTimeout(autosaveTimer)
  autosaveTimer = null
}

const scheduleAutosave = () => {
  clearAutosave()
  if (!readReady.value || !dirty.value || conflict.value) return
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void save(false, false)
  }, autosaveDelayMs)
}

const handleEditorChange = (value: string) => {
  if (!readReady.value || value === content.value) return
  content.value = value
  error.value = ''
  scheduleAutosave()
}

const reload = async (discardDirty = false) => {
  if ((!projectFile.value && !localFile.value) || (dirty.value && !discardDirty)) {
    if (dirty.value) conflict.value = t('projectFiles.editor.fileChangedUnsaved')
    return
  }
  clearAutosave()
  conflictEpoch += 1
  loading.value = true
  error.value = ''
  try {
    const result = localFile.value
      ? await localFilesClient.readLocalEditorFile()?.(localFile.value.filePath)
      : await projectFilesClient.readFile()?.(contextInput())
    if (!result) {
      error.value = t('projectFiles.serviceUnavailable')
      return
    }
    if (!result.ok || !result.data) {
      error.value = t('projectFiles.editor.readFailed')
      return
    }
    content.value = result.data.content
    originContent.value = result.data.content
    originContentHash.value = result.data.contentHash
    mtimeMs.value = result.data.mtimeMs
    size.value = result.data.size
    readReady.value = true
    conflict.value = ''
  } finally {
    loading.value = false
  }
}

const saveSnapshot = async (overwrite: boolean) => {
  if ((!projectFile.value && !localFile.value) || loading.value || !readReady.value || (!dirty.value && !overwrite)) return true
  const write = localFile.value
    ? localFilesClient.writeLocalEditorFile()
    : projectFilesClient.writeFile()
  if (!write) {
    error.value = t('projectFiles.serviceUnavailable')
    return false
  }
  const snapshot = content.value
  const snapshotConflictEpoch = conflictEpoch
  saving.value = true
  error.value = ''
  try {
    const result = await write({
      ...(localFile.value ? { filePath: localFile.value.filePath } : contextInput()),
      content: snapshot,
      expectedMtimeMs: mtimeMs.value,
      expectedSize: size.value,
      expectedContentHash: originContentHash.value,
      overwrite
    } as never)
    if (!result.ok || !result.data) {
      if (result.errorCode === 'PROJECT_FILE_CONFLICT' || result.errorCode === 'LOCAL_EDITOR_FILE_CONFLICT') {
        conflictEpoch += 1
        conflict.value = t('projectFiles.editor.fileChanged')
      }
      else error.value = t('projectFiles.editor.saveFailed')
      return false
    }
    if (snapshotConflictEpoch !== conflictEpoch) return false
    originContent.value = snapshot
    originContentHash.value = result.data.contentHash
    mtimeMs.value = result.data.mtimeMs
    size.value = result.data.size
    conflict.value = ''
    return true
  } finally {
    saving.value = false
  }
}

const save = async (overwrite: boolean, drain: boolean): Promise<boolean> => {
  clearAutosave()
  if (inFlightSave) {
    const activeResult = await inFlightSave
    if (!activeResult) return false
    if (drain && dirty.value) return save(false, true)
    if (dirty.value) scheduleAutosave()
    return true
  }
  if (conflict.value && !overwrite) return false
  if (!dirty.value && !overwrite) return true
  const operation = saveSnapshot(overwrite)
  inFlightSave = operation
  const result = await operation
  if (inFlightSave === operation) inFlightSave = null
  if (!result) return false
  if (dirty.value) {
    if (drain) return save(false, true)
    scheduleAutosave()
  }
  return !drain || !dirty.value
}

const handleWatchEvent = (event: ProjectFileWatchEvent | LocalEditorFileWatchEvent) => {
  if (event.watchId !== watchId) return
  if (dirty.value || saving.value) {
    clearAutosave()
    conflictEpoch += 1
    conflict.value = event.kind === 'deleted'
      ? t('projectFiles.editor.fileDeletedUnsaved')
      : t('projectFiles.editor.fileChangedUnsaved')
    return
  }
  if (event.kind === 'deleted') {
    readReady.value = false
    error.value = t('projectFiles.editor.fileDeleted')
    return
  }
  void reload(false)
}

const handleWindowBlur = () => {
  if (dirty.value) void save(false, true)
}

const restartWatch = async () => {
  const filePath = editorPath.value
  if (!mounted || !filePath || filePath === watchedPath) return
  const stopWatch = localFile.value
    ? localFilesClient.stopLocalEditorFileWatch()
    : projectFilesClient.stopWatch()
  if (watchedPath && stopWatch) await stopWatch(watchId)
  watchedPath = ''
  const startWatch = localFile.value
    ? localFilesClient.startLocalEditorFileWatch()
    : projectFilesClient.startWatch()
  if (!startWatch) return
  const input = localFile.value
    ? { filePath: localFile.value.filePath, watchId }
    : { ...contextInput(), watchId }
  const result = await startWatch(input as never)
  if (result.ok) watchedPath = filePath
}

onMounted(async () => {
  mounted = true
  unregisterFlush = registerProjectFileEditorFlush(props.panel.id, () => save(false, true))
  window.addEventListener('blur', handleWindowBlur)
  await reload(true)
  const onWatch = localFile.value
    ? localFilesClient.onLocalEditorFileWatchEvent()
    : projectFilesClient.onWatchEvent()
  offWatch = onWatch?.(handleWatchEvent) || null
  await restartWatch()
})

watch(
  editorPath,
  () => { void restartWatch() }
)

watch(
  () => workspace.activePanelId,
  (nextPanelId, previousPanelId) => {
    if (previousPanelId === props.panel.id && nextPanelId !== props.panel.id && dirty.value) void save(false, true)
  }
)

onBeforeUnmount(() => {
  mounted = false
  clearAutosave()
  window.removeEventListener('blur', handleWindowBlur)
  unregisterFlush?.()
  offWatch?.()
  const stopWatch = localFile.value
    ? localFilesClient.stopLocalEditorFileWatch()
    : projectFilesClient.stopWatch()
  if (stopWatch) void stopWatch(watchId)
  if (props.panel.projectFile) props.panel.projectFile.dirty = false
  if (props.panel.localFile) props.panel.localFile.dirty = false
})
</script>
