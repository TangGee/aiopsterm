<template>
  <section class="project-files-panel">
    <header class="project-files-header">
      <div
        class="project-files-header-title"
        :title="context?.projectRoot || emptyMessage"
      >
        <FolderTree />
        <strong>{{ projectName }}</strong>
        <span
          v-if="context"
          class="project-files-capability"
          :class="context.capability"
        >
          {{ capabilityLabel }}
        </span>
      </div>
      <div class="project-files-header-actions">
        <button
          type="button"
          :disabled="loadingContext"
          title="Refresh"
          aria-label="Refresh project files"
          @click="refreshAll"
        >
          <RefreshCw :class="{ rotating: loadingContext }" />
        </button>
        <button
          type="button"
          title="Close"
          aria-label="Close project files"
          data-testid="project-files-close"
          @click="$emit('close')"
        >
          <X />
        </button>
      </div>
    </header>
    <div
      v-if="notice"
      class="project-files-notice"
    >
      {{ notice }}
    </div>

    <template v-if="context">
      <section
        class="project-files-recent"
        :style="{ height: `${splitPercent}%` }"
      >
        <div class="project-files-section-title">
          <span>Recent changes</span>
        </div>
        <button
          v-for="entry in context.recent"
          :key="`${entry.path}:${entry.changedAt}`"
          type="button"
          class="project-files-recent-row"
          :disabled="entry.kind === 'deleted'"
          @click="openFile(entry.path)"
          @contextmenu.prevent.stop="openRecentEntryMenu($event, entry)"
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
        <div
          class="project-files-section-title"
          data-testid="project-files-tree-header"
          @contextmenu.prevent="openContextMenu($event, null, '')"
        >
          <span>Project tree</span>
          <button
            type="button"
            data-testid="project-files-create-root"
            title="New file"
            aria-label="New file"
            @click.stop="openMutationDialog('create-file', null, '')"
          >
            <FilePlus2 />
          </button>
        </div>
        <div
          class="project-files-tree-scroll"
          :class="{ 'drop-target': dragSource !== null && !invalidProjectMove(dragSource, '') && dropTargetDirectory === '' }"
          @contextmenu.prevent="openBlankMenu"
          @dragover.prevent="handleRootDragOver"
          @drop.prevent.stop="handleTreeDrop($event, '')"
        >
          <template v-for="row in flatRows" :key="row.key">
            <button
              v-if="row.kind === 'entry'"
              type="button"
              class="project-files-tree-row"
              :class="{ 'drop-target': row.entry.type === 'directory' && dropTargetDirectory === row.entry.relativePath }"
              :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
              draggable="true"
              @click="activateTreeEntry(row.entry)"
              @contextmenu.prevent.stop="openEntryMenu($event, row.entry)"
              @dragstart.stop="handleTreeDragStart($event, row.entry)"
              @dragend="clearTreeDrag"
              @dragover.prevent.stop="handleEntryDragOver($event, row.entry)"
              @drop.prevent.stop="handleEntryDrop($event, row.entry)"
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

    <Teleport to="body">
      <ProjectFilesContextMenu
        v-if="contextMenu.visible"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :entry="contextMenu.entry"
        @create-file="openCreateDialog"
        @rename="openRenameDialog"
        @delete-file="openDeleteDialog"
        @copy-relative-path="copyEntryPath(false)"
        @copy-absolute-path="copyEntryPath(true)"
      />

      <ProjectFilesMutationDialog
        v-if="mutationDialog.visible"
        :kind="mutationDialog.kind"
        :value="mutationDialog.value"
        :message="mutationDialog.message"
        :error="mutationDialog.error"
        :busy="mutationDialog.busy"
        @update:value="mutationDialog.value = $event"
        @confirm="confirmMutationDialog"
        @cancel="closeMutationDialog"
      />
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Link as LinkIcon,
  RefreshCw,
  X
} from 'lucide-vue-next'
import ProjectFilesContextMenu from '@/components/files/ProjectFilesContextMenu.vue'
import ProjectFilesMutationDialog from '@/components/files/ProjectFilesMutationDialog.vue'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { flushProjectFileEditor } from '@/services/files/projectFileEditorSaveRegistry'
import { projectFilesClient } from '@/services/files/projectFilesClient'
import {
  invalidProjectMove,
  joinProjectRelativePath,
  projectAbsolutePath,
  projectMoveTargetPath,
  projectRelativeBasename,
  projectRelativeDirname,
  remapProjectPath
} from '@/services/files/projectFilesInteractionRuntime'
import { useWorkspaceStore } from '@/stores/workspace'
import type {
  ProjectDirectoryEntry,
  ProjectEntryMutationInput,
  ProjectFileContext,
  ProjectFileChangeKind,
  ProjectFileRecentEntry
} from '@shared/contracts/projectFiles'
import type { ManagedAiSessionRecord } from '@shared/contracts/managedAiSessions'

type DirectoryState = {
  entries: ProjectDirectoryEntry[]
  nextOffset?: number
  loading: boolean
}

type FlatRow =
  | { kind: 'entry'; key: string; entry: ProjectDirectoryEntry; depth: number }
  | { kind: 'more'; key: string; directory: string; depth: number }

defineEmits<{
  close: []
}>()
const props = defineProps<{
  session?: ManagedAiSessionRecord | null
}>()

const workspace = useWorkspaceStore()
const context = ref<ProjectFileContext | null>(null)
const emptyMessage = ref('Select a managed AI session that is bound to a local terminal.')
const loadingContext = ref(false)
const treeError = ref('')
const directories = reactive(new Map<string, DirectoryState>())
const expandedDirectories = reactive(new Set<string>())
const splitPercent = ref(Number(localStorage.getItem('aiopsterm.projectFilesSplitPercent')) || 34)
const notice = ref('')
const dragSource = ref<ProjectDirectoryEntry | null>(null)
const dropTargetDirectory = ref('')
const contextMenu = reactive<{
  visible: boolean
  x: number
  y: number
  entry: ProjectDirectoryEntry | null
  targetDirectory: string
}>({
  visible: false,
  x: 0,
  y: 0,
  entry: null,
  targetDirectory: ''
})
const mutationDialog = reactive<{
  visible: boolean
  kind: 'create-file' | 'rename' | 'delete-file'
  entry: ProjectDirectoryEntry | null
  targetDirectory: string
  value: string
  message: string
  error: string
  busy: boolean
}>({
  visible: false,
  kind: 'create-file',
  entry: null,
  targetDirectory: '',
  value: '',
  message: '',
  error: '',
  busy: false
})
let generation = 0
let offChanged: (() => void) | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null

const selectedKey = computed(() => props.session
  ? [
      props.session.source,
      props.session.id,
      props.session.terminalSessionId || '',
      props.session.cwd || '',
      props.session.canonicalCwd || ''
    ].join(':')
  : '')
const treeLoading = computed(() => directories.get('')?.loading === true)
const projectName = computed(() => {
  if (!context.value?.projectRoot) return 'Project files'
  return context.value.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || context.value.projectRoot
})
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

const sessionInput = () => props.session
  ? { source: props.session.source, sessionId: props.session.id }
  : null

const showNotice = (message: string) => {
  notice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
    noticeTimer = null
  }, 2400)
}

const closeContextMenu = () => {
  contextMenu.visible = false
  contextMenu.entry = null
}

const openContextMenu = (event: MouseEvent, entry: ProjectDirectoryEntry | null, targetDirectory: string) => {
  contextMenu.x = Math.max(8, Math.min(event.clientX, window.innerWidth - 224))
  contextMenu.y = Math.max(8, Math.min(event.clientY, window.innerHeight - 248))
  contextMenu.entry = entry
  contextMenu.targetDirectory = targetDirectory
  contextMenu.visible = true
}

const openBlankMenu = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.project-files-tree-row')) return
  openContextMenu(event, null, '')
}

const openEntryMenu = (event: MouseEvent, entry: ProjectDirectoryEntry) => {
  openContextMenu(
    event,
    entry,
    entry.type === 'directory' ? entry.relativePath : projectRelativeDirname(entry.relativePath)
  )
}

const openRecentEntryMenu = (event: MouseEvent, entry: ProjectFileRecentEntry) => {
  if (entry.kind === 'deleted') return
  const directoryEntry: ProjectDirectoryEntry = {
    name: projectRelativeBasename(entry.path),
    relativePath: entry.path,
    type: 'file',
    size: 0,
    modifiedAt: entry.changedAt
  }
  openEntryMenu(event, directoryEntry)
}

const openMutationDialog = (
  kind: 'create-file' | 'rename' | 'delete-file',
  entry: ProjectDirectoryEntry | null,
  targetDirectory: string
) => {
  mutationDialog.visible = true
  mutationDialog.kind = kind
  mutationDialog.entry = entry
  mutationDialog.targetDirectory = targetDirectory
  mutationDialog.value = kind === 'rename' && entry ? entry.name : ''
  mutationDialog.message = kind === 'delete-file' && entry
    ? `Delete ${entry.relativePath}? This cannot be undone.`
    : targetDirectory ? `Location: ${targetDirectory}` : 'Location: project root'
  mutationDialog.error = ''
  mutationDialog.busy = false
  closeContextMenu()
}

const openCreateDialog = () => openMutationDialog('create-file', null, contextMenu.targetDirectory)
const openRenameDialog = () => {
  if (contextMenu.entry) openMutationDialog('rename', contextMenu.entry, projectRelativeDirname(contextMenu.entry.relativePath))
}
const openDeleteDialog = () => {
  if (contextMenu.entry) openMutationDialog('delete-file', contextMenu.entry, projectRelativeDirname(contextMenu.entry.relativePath))
}

const closeMutationDialog = () => {
  if (mutationDialog.busy) return
  mutationDialog.visible = false
  mutationDialog.entry = null
  mutationDialog.error = ''
}

const copyEntryPath = async (absolute: boolean) => {
  const entry = contextMenu.entry
  const projectRoot = context.value?.projectRoot
  if (!entry || !projectRoot) return
  const text = absolute ? projectAbsolutePath(projectRoot, entry.relativePath) : entry.relativePath
  const copied = await copyTextToClipboard(text)
  showNotice(copied ? `${absolute ? 'Absolute' : 'Relative'} path copied` : 'Unable to copy path')
  closeContextMenu()
}

const validEntryName = (value: string) => {
  const name = value.trim()
  return name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\') ? name : ''
}

const openPanelsAffectedBy = (entry: ProjectDirectoryEntry) => workspace.panels.filter((panel) => {
  const projectFile = panel.projectFile
  if (panel.kind !== 'project-file' || !projectFile || projectFile.projectRoot !== context.value?.projectRoot) return false
  return projectFile.relativePath === entry.relativePath ||
    (entry.type === 'directory' && projectFile.relativePath.startsWith(`${entry.relativePath}/`))
})

const flushAffectedEditors = async (entry: ProjectDirectoryEntry) => {
  for (const panel of openPanelsAffectedBy(entry)) {
    if (!panel.projectFile?.dirty) continue
    if (!await flushProjectFileEditor(panel.id)) return false
  }
  return true
}

const remapOpenEditors = (entry: ProjectDirectoryEntry, nextPath: string) => {
  for (const panel of openPanelsAffectedBy(entry)) {
    if (!panel.projectFile) continue
    panel.projectFile.relativePath = remapProjectPath(
      panel.projectFile.relativePath,
      entry.relativePath,
      nextPath,
      entry.type
    )
    panel.title = projectRelativeBasename(panel.projectFile.relativePath)
  }
}

const mutateEntry = async (input: ProjectEntryMutationInput) => {
  const mutate = projectFilesClient.mutateEntry()
  if (!mutate) return { ok: false as const, errorMessage: 'Project file mutation service is unavailable.' }
  return mutate(input)
}

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
  const state: DirectoryState = current || reactive({ entries: [], loading: false })
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
  const session = props.session
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

const confirmMutationDialog = async () => {
  const input = sessionInput()
  if (!input || !context.value || mutationDialog.busy) return
  const entry = mutationDialog.entry
  let relativePath = entry?.relativePath || ''
  let targetRelativePath: string | undefined
  if (mutationDialog.kind !== 'delete-file') {
    const name = validEntryName(mutationDialog.value)
    if (!name) {
      mutationDialog.error = 'Enter a name without path separators.'
      return
    }
    if (mutationDialog.kind === 'create-file') relativePath = joinProjectRelativePath(mutationDialog.targetDirectory, name)
    else targetRelativePath = joinProjectRelativePath(mutationDialog.targetDirectory, name)
  }
  if (entry && !await flushAffectedEditors(entry)) {
    mutationDialog.error = 'Resolve the open editor conflict before changing this entry.'
    return
  }
  mutationDialog.busy = true
  mutationDialog.error = ''
  try {
    const result = await mutateEntry({
      ...input,
      kind: mutationDialog.kind,
      relativePath,
      ...(targetRelativePath ? { targetRelativePath } : {})
    })
    if (!result.ok || !result.data) {
      mutationDialog.error = result.errorMessage || 'Unable to change the project entry.'
      return
    }
    if (entry && targetRelativePath) remapOpenEditors(entry, result.data.relativePath)
    mutationDialog.visible = false
    mutationDialog.entry = null
    reloadTree()
    if (mutationDialog.kind === 'create-file') openFile(result.data.relativePath)
    showNotice({
      'create-file': 'File created',
      rename: 'Entry renamed',
      'delete-file': 'File deleted'
    }[mutationDialog.kind])
  } finally {
    mutationDialog.busy = false
  }
}

const clearTreeDrag = () => {
  dragSource.value = null
  dropTargetDirectory.value = ''
}

const handleTreeDragStart = (event: DragEvent, entry: ProjectDirectoryEntry) => {
  dragSource.value = entry
  dropTargetDirectory.value = ''
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-aiopsterm-project-entry', entry.relativePath)
}

const handleTreeDragOver = (event: DragEvent, targetDirectory: string) => {
  const source = dragSource.value
  if (!source || invalidProjectMove(source, targetDirectory)) {
    dropTargetDirectory.value = ''
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }
  dropTargetDirectory.value = targetDirectory
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const handleRootDragOver = (event: DragEvent) => handleTreeDragOver(event, '')

const handleEntryDragOver = (event: DragEvent, entry: ProjectDirectoryEntry) => {
  if (entry.type !== 'directory') {
    dropTargetDirectory.value = ''
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }
  handleTreeDragOver(event, entry.relativePath)
}

const handleEntryDrop = (event: DragEvent, entry: ProjectDirectoryEntry) => {
  if (entry.type !== 'directory') {
    clearTreeDrag()
    return
  }
  void handleTreeDrop(event, entry.relativePath)
}

const handleTreeDrop = async (event: DragEvent, targetDirectory: string) => {
  const entry = dragSource.value
  if (!entry || invalidProjectMove(entry, targetDirectory)) {
    clearTreeDrag()
    return
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const input = sessionInput()
  if (!input || !await flushAffectedEditors(entry)) {
    showNotice('Resolve the open editor conflict before moving this entry')
    clearTreeDrag()
    return
  }
  const targetRelativePath = projectMoveTargetPath(entry, targetDirectory)
  const result = await mutateEntry({
    ...input,
    kind: 'move',
    relativePath: entry.relativePath,
    targetRelativePath
  })
  if (!result.ok || !result.data) {
    showNotice(result.errorMessage || 'Unable to move the project entry')
    clearTreeDrag()
    return
  }
  remapOpenEditors(entry, result.data.relativePath)
  reloadTree()
  showNotice('Entry moved')
  clearTreeDrag()
}

const refreshAll = async () => {
  const previousRoot = context.value?.projectRoot
  await refreshContext()
  if (context.value?.projectRoot === previousRoot) reloadTree()
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

const handleGlobalPointerDown = () => closeContextMenu()
const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || (!contextMenu.visible && !mutationDialog.visible)) return
  event.preventDefault()
  event.stopPropagation()
  closeContextMenu()
  closeMutationDialog()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleGlobalPointerDown)
  document.addEventListener('keydown', handleGlobalKeydown, true)
})

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
  document.removeEventListener('pointerdown', handleGlobalPointerDown)
  document.removeEventListener('keydown', handleGlobalKeydown, true)
  offChanged?.()
})
</script>
