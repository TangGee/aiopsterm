<template>
  <section class="project-files-panel">
    <header class="project-files-header">
      <div>
        <strong>Project files</strong>
        <small v-if="context">{{ context.projectRoot }}</small>
        <small v-else>{{ emptyMessage }}</small>
      </div>
      <span
        v-if="context"
        class="project-files-capability"
        :class="context.capability"
      >
        {{ capabilityLabel }}
      </span>
    </header>

    <template v-if="context">
      <section
        class="project-files-recent"
        :style="{ height: `${splitPercent}%` }"
      >
        <div class="project-files-section-title">
          <span>Recent changes</span>
          <button type="button" :disabled="loadingContext" @click="refreshContext">Refresh</button>
        </div>
        <button
          v-for="entry in context.recent"
          :key="`${entry.path}:${entry.changedAt}`"
          type="button"
          class="project-files-recent-row"
          :disabled="entry.kind === 'deleted'"
          @click="openFile(entry.path)"
        >
          <span class="project-file-change-kind" :class="entry.kind">{{ changeKindLabel(entry.kind) }}</span>
          <span :title="entry.path">{{ entry.path }}</span>
          <small>{{ formatTime(entry.changedAt) }}</small>
        </button>
        <div v-if="!context.recent.length" class="project-files-empty">No recorded file changes.</div>
      </section>

      <button
        type="button"
        class="project-files-splitter"
        aria-label="Resize recent changes and project tree"
        @mousedown="startResize"
      ></button>

      <section class="project-files-tree">
        <div class="project-files-section-title">
          <span>Project tree</span>
          <button type="button" @click="reloadTree">Refresh</button>
        </div>
        <div class="project-files-tree-scroll">
          <template v-for="row in flatRows" :key="row.key">
            <button
              v-if="row.kind === 'entry'"
              type="button"
              class="project-files-tree-row"
              :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
              @click="activateTreeEntry(row.entry)"
            >
              <ChevronRight
                v-if="row.entry.type === 'directory'"
                :class="{ expanded: expandedDirectories.has(row.entry.relativePath) }"
              />
              <Folder v-if="row.entry.type === 'directory'" />
              <LinkIcon v-else-if="row.entry.type === 'link'" />
              <FileText v-else />
              <span :title="row.entry.relativePath">{{ row.entry.name }}</span>
            </button>
            <button
              v-else
              type="button"
              class="project-files-load-more"
              :style="{ paddingLeft: `${26 + row.depth * 16}px` }"
              @click="loadDirectory(row.directory, true)"
            >
              Load more
            </button>
          </template>
          <div v-if="treeLoading" class="project-files-empty">Loading project tree.</div>
          <div v-else-if="treeError" class="project-files-empty">{{ treeError }}</div>
        </div>
      </section>
    </template>
    <div v-else class="project-files-unavailable">
      <FolderOpen />
      <strong>Project files unavailable</strong>
      <span>{{ emptyMessage }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ChevronRight, FileText, Folder, FolderOpen, Link as LinkIcon } from 'lucide-vue-next'
import { projectFilesClient } from '@/services/files/projectFilesClient'
import { useWorkspaceStore } from '@/stores/workspace'
import type {
  ProjectDirectoryEntry,
  ProjectFileContext,
  ProjectFileChangeKind
} from '@shared/contracts/projectFiles'

type DirectoryState = {
  entries: ProjectDirectoryEntry[]
  nextOffset?: number
  loading: boolean
}

type FlatRow =
  | { kind: 'entry'; key: string; entry: ProjectDirectoryEntry; depth: number }
  | { kind: 'more'; key: string; directory: string; depth: number }

const workspace = useWorkspaceStore()
const context = ref<ProjectFileContext | null>(null)
const emptyMessage = ref('Select a managed AI session that is bound to a local terminal.')
const loadingContext = ref(false)
const treeError = ref('')
const directories = reactive(new Map<string, DirectoryState>())
const expandedDirectories = reactive(new Set<string>())
const splitPercent = ref(Number(localStorage.getItem('aiopsterm.projectFilesSplitPercent')) || 34)
let generation = 0
let offChanged: (() => void) | null = null

const selectedSession = computed(() => workspace.selectedManagedAiSession)
const selectedKey = computed(() => selectedSession.value ? `${selectedSession.value.source}:${selectedSession.value.id}` : '')
const treeLoading = computed(() => directories.get('')?.loading === true)
const capabilityLabel = computed(() => {
  if (context.value?.capability === 'native') return 'Native'
  if (context.value?.capability === 'adapter') return 'Adapter'
  return 'Limited'
})

const flatRows = computed(() => {
  const rows: FlatRow[] = []
  const appendDirectory = (directory: string, depth: number) => {
    const state = directories.get(directory)
    for (const entry of state?.entries || []) {
      rows.push({ kind: 'entry', key: entry.relativePath, entry, depth })
      if (entry.type === 'directory' && expandedDirectories.has(entry.relativePath)) {
        appendDirectory(entry.relativePath, depth + 1)
      }
    }
    if (state?.nextOffset !== undefined) rows.push({ kind: 'more', key: `more:${directory}:${state.nextOffset}`, directory, depth })
  }
  appendDirectory('', 0)
  return rows
})

const sessionInput = () => selectedSession.value
  ? { source: selectedSession.value.source, sessionId: selectedSession.value.id }
  : null

const refreshContext = async () => {
  const input = sessionInput()
  const requestGeneration = ++generation
  if (!input) {
    context.value = null
    emptyMessage.value = 'Select a managed AI session that is bound to a local terminal.'
    return
  }
  const getContext = projectFilesClient.getContext()
  if (!getContext) {
    context.value = null
    emptyMessage.value = 'Project file service is unavailable.'
    return
  }
  loadingContext.value = true
  try {
    const result = await getContext(input)
    if (requestGeneration !== generation) return
    if (!result.ok || !result.data) {
      context.value = null
      emptyMessage.value = result.errorMessage || 'This AI session has no eligible local project.'
      directories.clear()
      expandedDirectories.clear()
      return
    }
    const rootChanged = context.value?.projectRoot !== result.data.projectRoot
    context.value = result.data
    if (rootChanged || !directories.has('')) {
      directories.clear()
      expandedDirectories.clear()
      await loadDirectory('')
    }
  } finally {
    if (requestGeneration === generation) loadingContext.value = false
  }
}

const loadDirectory = async (relativeDirectory: string, append = false) => {
  const input = sessionInput()
  const list = projectFilesClient.listDirectory()
  if (!input || !list) return
  const current = directories.get(relativeDirectory)
  if (current?.loading) return
  const state: DirectoryState = current || { entries: [], loading: false }
  state.loading = true
  directories.set(relativeDirectory, state)
  treeError.value = ''
  const requestGeneration = generation
  try {
    const result = await list({
      ...input,
      relativeDirectory,
      offset: append ? state.nextOffset || 0 : 0,
      limit: 200
    })
    if (requestGeneration !== generation) return
    if (!result.ok || !result.data) {
      treeError.value = result.errorMessage || 'Unable to read the project directory.'
      return
    }
    state.entries = append ? [...state.entries, ...result.data.entries] : result.data.entries
    state.nextOffset = result.data.nextOffset
  } finally {
    state.loading = false
  }
}

const activateTreeEntry = (entry: ProjectDirectoryEntry) => {
  if (entry.type === 'file') {
    openFile(entry.relativePath)
    return
  }
  if (entry.type !== 'directory') return
  if (expandedDirectories.has(entry.relativePath)) {
    expandedDirectories.delete(entry.relativePath)
    return
  }
  expandedDirectories.add(entry.relativePath)
  if (!directories.has(entry.relativePath)) void loadDirectory(entry.relativePath)
}

const openFile = (relativePath: string) => {
  const session = selectedSession.value
  if (!session || !context.value) return
  workspace.openProjectFile({
    source: session.source,
    sessionId: session.id,
    projectRoot: context.value.projectRoot,
    relativePath
  })
}

const reloadTree = () => {
  directories.clear()
  expandedDirectories.clear()
  void loadDirectory('')
}

const changeKindLabel = (kind: ProjectFileChangeKind) => ({
  created: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R'
}[kind])

const formatTime = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const startResize = (event: MouseEvent) => {
  const host = (event.currentTarget as HTMLElement).closest('.project-files-panel')
  if (!(host instanceof HTMLElement)) return
  const rect = host.getBoundingClientRect()
  const move = (moveEvent: MouseEvent) => {
    splitPercent.value = Math.max(20, Math.min(70, ((moveEvent.clientY - rect.top) / rect.height) * 100))
  }
  const stop = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', stop)
    localStorage.setItem('aiopsterm.projectFilesSplitPercent', String(Math.round(splitPercent.value)))
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', stop)
}

watch(selectedKey, () => void refreshContext(), { immediate: true })

const onChanged = projectFilesClient.onChanged()
offChanged = onChanged?.((nextContext: ProjectFileContext) => {
  if (!context.value || nextContext.projectRoot !== context.value.projectRoot) return
  context.value = nextContext
}) || null

onBeforeUnmount(() => offChanged?.())
</script>
