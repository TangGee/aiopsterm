<template>
  <section class="project-file-editor">
    <header>
      <div>
        <strong>{{ panel.projectFile?.relativePath }}</strong>
        <small>{{ panel.projectFile?.projectRoot }}</small>
      </div>
      <button
        type="button"
        :disabled="loading || !dirty"
        @click="save(false)"
      >
        Save
      </button>
    </header>
    <div
      v-if="conflict"
      class="project-file-conflict"
    >
      <span>{{ conflict }}</span>
      <button type="button" @click="reload(true)">Reload from disk</button>
      <button type="button" :disabled="loading" @click="save(true)">Overwrite</button>
    </div>
    <div
      v-if="error"
      class="project-file-error"
    >
      {{ error }}
    </div>
    <FilesMonacoEditor
      v-else
      v-model="content"
      :language="language"
      :readonly="loading"
      @save="save(false)"
    />
    <footer>
      <span>{{ loading ? 'Loading' : dirty ? 'Unsaved' : 'Saved' }}</span>
      <span>{{ panel.projectFile?.relativePath }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FilesMonacoEditor from '@/components/files/FilesMonacoEditor.vue'
import { projectFilesClient } from '@/services/files/projectFilesClient'
import { filesWorkspaceEditorLanguage } from '@/services/files/filesWorkspaceEditorRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { ProjectFileWatchEvent } from '@shared/contracts/projectFiles'

const props = defineProps<{ panel: TerminalPanel }>()

const content = ref('')
const originContent = ref('')
const mtimeMs = ref(0)
const size = ref(0)
const loading = ref(true)
const error = ref('')
const conflict = ref('')
const watchId = `project-file-editor-${props.panel.id}`
let offWatch: (() => void) | null = null

const projectFile = computed(() => props.panel.projectFile)
const dirty = computed(() => content.value !== originContent.value)
const language = computed(() => filesWorkspaceEditorLanguage(projectFile.value?.relativePath || ''))

watch(dirty, (value) => {
  if (props.panel.projectFile) props.panel.projectFile.dirty = value
}, { immediate: true })

const contextInput = () => ({
  source: projectFile.value!.source,
  sessionId: projectFile.value!.sessionId,
  relativePath: projectFile.value!.relativePath
})

const reload = async (discardDirty = false) => {
  if (!projectFile.value || (dirty.value && !discardDirty)) {
    if (dirty.value) conflict.value = 'The file changed on disk while this editor has unsaved changes.'
    return
  }
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
    mtimeMs.value = result.data.mtimeMs
    size.value = result.data.size
    conflict.value = ''
  } finally {
    loading.value = false
  }
}

const save = async (overwrite: boolean) => {
  if (!projectFile.value || loading.value || (!dirty.value && !overwrite)) return
  const write = projectFilesClient.writeFile()
  if (!write) {
    error.value = 'Project file service is unavailable.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await write({
      ...contextInput(),
      content: content.value,
      expectedMtimeMs: mtimeMs.value,
      expectedSize: size.value,
      overwrite
    })
    if (!result.ok || !result.data) {
      if (result.errorCode === 'PROJECT_FILE_CONFLICT') conflict.value = result.errorMessage || 'The file changed on disk.'
      else error.value = result.errorMessage || 'Unable to save the project file.'
      return
    }
    originContent.value = content.value
    mtimeMs.value = result.data.mtimeMs
    size.value = result.data.size
    conflict.value = ''
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await reload(true)
  const onWatch = projectFilesClient.onWatchEvent()
  offWatch = onWatch?.((event: ProjectFileWatchEvent) => {
    if (event.watchId !== watchId) return
    if (dirty.value) {
      conflict.value = event.kind === 'deleted'
        ? 'The file was deleted on disk while this editor has unsaved changes.'
        : 'The file changed on disk while this editor has unsaved changes.'
      return
    }
    if (event.kind === 'deleted') {
      error.value = 'The file was deleted on disk.'
      return
    }
    void reload(false)
  }) || null
  const startWatch = projectFilesClient.startWatch()
  if (startWatch && projectFile.value) await startWatch({ ...contextInput(), watchId })
})

onBeforeUnmount(() => {
  offWatch?.()
  const stopWatch = projectFilesClient.stopWatch()
  if (stopWatch) void stopWatch(watchId)
  if (props.panel.projectFile) props.panel.projectFile.dirty = false
})
</script>
