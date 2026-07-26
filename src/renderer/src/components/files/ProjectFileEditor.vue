<template>
  <section class="project-file-editor">
    <header>
      <div>
        <strong>{{ panel.projectFile?.relativePath }}</strong>
        <small>{{ panel.projectFile?.projectRoot }}</small>
      </div>
    </header>
    <div
      v-if="conflict"
      class="project-file-conflict"
    >
      <span>{{ conflict }}</span>
      <button type="button" :disabled="loading || saving" @click="reload(true)">Reload from disk</button>
      <button type="button" :disabled="loading || saving" @click="save(true, true)">Overwrite</button>
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
      :file-path="projectFile?.relativePath"
      :minimap="false"
      :readonly="loading || !readReady"
      @update:model-value="handleEditorChange"
      @save="save(false, true)"
      @blur="save(false, true)"
    />
    <footer>
      <span :class="statusClass">{{ statusText }}</span>
      <span>{{ panel.projectFile?.relativePath }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FilesMonacoEditor from '@/components/files/FilesMonacoEditor.vue'
import { registerProjectFileEditorFlush } from '@/services/files/projectFileEditorSaveRegistry'
import { projectFilesClient } from '@/services/files/projectFilesClient'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ProjectFileWatchEvent } from '@shared/contracts/projectFiles'

const props = defineProps<{ panel: TerminalPanel }>()
const workspace = useWorkspaceStore()

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
let watchedRelativePath = ''

const projectFile = computed(() => props.panel.projectFile)
const dirty = computed(() => content.value !== originContent.value)
const statusText = computed(() => {
  if (loading.value) return 'Loading'
  if (conflict.value) return 'Conflict'
  if (error.value) return readReady.value ? 'Save failed' : 'Unable to load'
  if (saving.value) return 'Saving'
  return dirty.value ? 'Unsaved' : 'Saved'
})
const statusClass = computed(() => ({
  saving: saving.value,
  dirty: dirty.value && !conflict.value,
  conflict: Boolean(conflict.value),
  error: Boolean(error.value)
}))

watch(dirty, (value) => {
  if (props.panel.projectFile) props.panel.projectFile.dirty = value
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
  if (!projectFile.value || (dirty.value && !discardDirty)) {
    if (dirty.value) conflict.value = 'The file changed on disk while this editor has unsaved changes.'
    return
  }
  clearAutosave()
  conflictEpoch += 1
  const read = projectFilesClient.readFile()
  if (!read) {
    error.value = 'Project file service is unavailable.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await read(contextInput())
    if (!result.ok || !result.data) {
      error.value = result.errorMessage || 'Unable to read the project file.'
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
  if (!projectFile.value || loading.value || !readReady.value || (!dirty.value && !overwrite)) return true
  const write = projectFilesClient.writeFile()
  if (!write) {
    error.value = 'Project file service is unavailable.'
    return false
  }
  const snapshot = content.value
  const snapshotConflictEpoch = conflictEpoch
  saving.value = true
  error.value = ''
  try {
    const result = await write({
      ...contextInput(),
      content: snapshot,
      expectedMtimeMs: mtimeMs.value,
      expectedSize: size.value,
      expectedContentHash: originContentHash.value,
      overwrite
    })
    if (!result.ok || !result.data) {
      if (result.errorCode === 'PROJECT_FILE_CONFLICT') {
        conflictEpoch += 1
        conflict.value = result.errorMessage || 'The file changed on disk.'
      }
      else error.value = result.errorMessage || 'Unable to save the project file.'
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

const handleWatchEvent = (event: ProjectFileWatchEvent) => {
  if (event.watchId !== watchId) return
  if (dirty.value || saving.value) {
    clearAutosave()
    conflictEpoch += 1
    conflict.value = event.kind === 'deleted'
      ? 'The file was deleted on disk while this editor has unsaved changes.'
      : 'The file changed on disk while this editor has unsaved changes.'
    return
  }
  if (event.kind === 'deleted') {
    readReady.value = false
    error.value = 'The file was deleted on disk.'
    return
  }
  void reload(false)
}

const handleWindowBlur = () => {
  if (dirty.value) void save(false, true)
}

const restartWatch = async () => {
  const relativePath = projectFile.value?.relativePath || ''
  if (!mounted || !relativePath || relativePath === watchedRelativePath) return
  const stopWatch = projectFilesClient.stopWatch()
  if (watchedRelativePath && stopWatch) await stopWatch(watchId)
  watchedRelativePath = ''
  const startWatch = projectFilesClient.startWatch()
  if (!startWatch || !projectFile.value) return
  const result = await startWatch({ ...contextInput(), watchId })
  if (result.ok) watchedRelativePath = relativePath
}

onMounted(async () => {
  mounted = true
  unregisterFlush = registerProjectFileEditorFlush(props.panel.id, () => save(false, true))
  window.addEventListener('blur', handleWindowBlur)
  await reload(true)
  const onWatch = projectFilesClient.onWatchEvent()
  offWatch = onWatch?.(handleWatchEvent) || null
  await restartWatch()
})

watch(
  () => projectFile.value?.relativePath,
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
  const stopWatch = projectFilesClient.stopWatch()
  if (stopWatch) void stopWatch(watchId)
  if (props.panel.projectFile) props.panel.projectFile.dirty = false
})
</script>
