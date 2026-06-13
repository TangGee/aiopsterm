<template>
  <section class="files-workspace">
    <div class="files-mode-switch">
      <button
        :class="{ active: workspace.filesUiMode === 'transfer' }"
        @click="workspace.setFilesUiMode('transfer')"
      >
        拖拽模式
      </button>
      <button
        :class="{ active: workspace.filesUiMode === 'default' }"
        @click="workspace.setFilesUiMode('default')"
      >
        默认模式
      </button>
    </div>

    <div
      v-if="workspace.filesUiMode === 'transfer'"
      class="files-transfer-layout"
    >
      <TransferSide
        side="left"
        :session="workspace.selectedLeftFileSession"
        @add="openAddConn('left')"
        @open-file="openFileEditor"
      />
      <div class="files-transfer-divider"></div>
      <TransferSide
        side="right"
        :session="workspace.selectedRightFileSession"
        @add="openAddConn('right')"
        @open-file="openFileEditor"
      />
    </div>

    <div
      v-else
      class="files-default-layout"
    >
      <div
        v-for="session in workspace.fileSessions"
        :key="session.id"
        class="files-default-session"
      >
        <button
          class="files-default-title"
          @click="toggleDefaultSession(session.id)"
        >
          <ChevronDown v-if="expandedDefault.includes(session.id)" />
          <ChevronRight v-else />
          <strong>{{ session.label }}</strong>
          <span v-if="session.errorMsg">SFTP 连接失败：{{ session.errorMsg }}</span>
        </button>
        <FileBrowser
          v-if="expandedDefault.includes(session.id)"
          :session="session"
          ui-mode="default"
          @open-file="openFileEditor"
        />
      </div>
    </div>

    <div
      v-for="editor in fileEditors"
      v-show="editor.visible"
      :key="editor.key"
      class="files-floating-editor"
      :class="{ active: editor.key === activeEditorKey, fullscreen: editor.fullscreen }"
      :style="editor.fullscreen ? undefined : editorGeometry(editor)"
      @click="activeEditorKey = editor.key"
    >
      <header
        class="files-editor-toolbar"
        @mousedown="startEditorDrag($event, editor)"
      >
        <button
          class="primary"
          :disabled="editor.loading"
          @click="saveFileEditor(editor.key, false)"
        >
          <Save />
          保存
        </button>
        <span :title="editor.filePath">{{ editor.action === 'create' ? '新建文件 ' : '编辑文件 ' }}{{ editor.filePath }}</span>
        <div>
          <button
            :title="editor.fullscreen ? '退出全屏' : '全屏'"
            @click="editor.fullscreen = !editor.fullscreen"
          >
            <Minimize2 v-if="editor.fullscreen" />
            <Maximize2 v-else />
          </button>
          <button
            title="关闭"
            @click="requestCloseFileEditor(editor.key)"
          >
            <X />
          </button>
        </div>
      </header>
      <FilesMonacoEditor
        :model-value="editor.content"
        :language="editor.language"
        :readonly="editor.loading"
        @update:model-value="updateFileEditorContent(editor, $event)"
        @save="saveFileEditor(editor.key, false)"
      />
      <footer>
        <span>{{ editor.sessionLabel }} · {{ editor.language }} · {{ editor.error || (editor.loading ? '加载中' : editor.dirty ? '未保存' : editor.saved ? '已保存' : '已打开') }}</span>
      </footer>
      <button
        v-if="!editor.fullscreen"
        class="files-editor-resize-handle"
        title="调整大小"
        @mousedown.stop.prevent="startEditorResize($event, editor)"
      ></button>
    </div>

    <div
      v-if="closeConfirm.visible && closeConfirm.editorKey"
      class="file-modal"
      @click.self="closeConfirm.visible = false"
    >
      <div class="file-modal-card small">
        <header>
          <strong>保存确认</strong>
          <button
            title="关闭"
            @click="closeConfirm.visible = false"
          >
            <X />
          </button>
        </header>
        <p>文件 {{ closeConfirm.filePath }} 有未保存内容，是否保存后关闭？</p>
        <footer>
          <button @click="discardFileEditor(closeConfirm.editorKey)">不保存</button>
          <button @click="closeConfirm.visible = false">取消</button>
          <button
            class="primary"
            @click="saveFileEditor(closeConfirm.editorKey, true)"
          >
            保存
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="addConn.visible"
      class="file-modal"
    >
      <div class="file-modal-card add-conn">
        <header>
          <strong>添加 SFTP 连接</strong>
          <button
            title="关闭"
            @click="addConn.visible = false"
          >
            <X />
          </button>
        </header>
        <div class="add-conn-tabs">
          <button
            :class="{ active: addConn.tab === 'active' }"
            @click="setAddConnTab('active')"
          >
            活跃连接
          </button>
          <button
            :class="{ active: addConn.tab === 'asset' }"
            @click="setAddConnTab('asset')"
          >
            从资产添加
          </button>
        </div>

        <div
          v-if="addConn.tab === 'asset'"
          class="add-conn-search"
        >
          <input
            v-model="addConn.query"
            placeholder="搜索 SFTP 资产"
            @keydown.down.prevent="moveAddConnKeyboard(1)"
            @keydown.up.prevent="moveAddConnKeyboard(-1)"
            @keydown.enter.prevent="confirmAddConnKeyboard"
          />
        </div>

        <div class="add-conn-list">
          <button
            v-for="session in addConnOptions"
            :key="session.id"
            :data-session-id="session.id"
            :class="{ disabled: isSelected(session.id), 'keyboard-selected': session.id === addConn.keyboardSelectedId }"
            @mouseover="!isSelected(session.id) && (addConn.keyboardSelectedId = session.id)"
            @click="!isSelected(session.id) && pickAddConn(session.id)"
          >
            <span>{{ session.label }}</span>
            <small>{{ session.host }}</small>
            <Check v-if="isSelected(session.id)" />
          </button>
          <p v-if="!addConnOptions.length">没有可用连接</p>
        </div>
        <p class="add-conn-hint">
          {{ addConn.tab === 'active' ? '选择当前活跃连接加入文件面板。' : '从资产列表选择 SFTP 主机加入文件面板。' }}
        </p>
      </div>
    </div>

    <TransferProgress />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Check, ChevronDown, ChevronRight, Maximize2, Minimize2, Save, X } from 'lucide-vue-next'
import FileBrowser from '@/components/files/FileBrowser.vue'
import FilesMonacoEditor from '@/components/files/FilesMonacoEditor.vue'
import TransferProgress from '@/components/files/TransferProgress.vue'
import TransferSide from '@/components/files/TransferSide.vue'
import {
  isFileReadContentData,
  isFileTransferTaskData,
  isFileWriteContentData,
  malformedFilesBackendResultMessage
} from '@/services/filesBackendGuards'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileContentOptions, FileTransferTask } from '@shared/preload'

const workspace = useWorkspaceStore()
const expandedDefault = ref(['local'])
type FileEditorState = {
  key: string
  filePath: string
  sessionId: string
  sessionLabel: string
  host: string
  content: string
  originContent: string
  action: 'edit' | 'create'
  originMtimeMs: number
  originSize: number
  language: string
  loading: boolean
  dirty: boolean
  saved: boolean
  error: string
  visible: boolean
  fullscreen: boolean
  x: number
  y: number
  width: number
  height: number
}
const addConn = reactive<{ visible: boolean; side: 'left' | 'right'; tab: 'active' | 'asset'; query: string; keyboardSelectedId: string }>({
  visible: false,
  side: 'left',
  tab: 'active',
  query: '',
  keyboardSelectedId: ''
})
const fileEditors = ref<FileEditorState[]>([])
const activeEditorKey = ref('')
const closeConfirm = reactive({ visible: false, editorKey: '', filePath: '' })
const editorPointer = reactive<{
  mode: 'drag' | 'resize' | ''
  key: string
  startX: number
  startY: number
  editorX: number
  editorY: number
  width: number
  height: number
}>({
  mode: '',
  key: '',
  startX: 0,
  startY: 0,
  editorX: 0,
  editorY: 0,
  width: 0,
  height: 0
})

const addConnOptions = computed(() => {
  const query = addConn.query.trim().toLowerCase()
  return workspace.fileSessions.filter((session) => {
    if (addConn.tab === 'active' && session.status !== 'active') return false
    if (addConn.tab === 'asset' && session.kind !== 'remote') return false
    if (!query) return true
    return [session.label, session.host, session.group].some((value) => value.toLowerCase().includes(query))
  })
})

const openAddConn = (side: 'left' | 'right') => {
  addConn.side = side
  addConn.visible = true
  addConn.tab = 'active'
  addConn.query = ''
  addConn.keyboardSelectedId = ''
}

const setAddConnTab = (tab: 'active' | 'asset') => {
  addConn.tab = tab
  addConn.query = ''
  addConn.keyboardSelectedId = ''
}

const pickAddConn = (sessionId: string) => {
  workspace.openFileSession(sessionId, addConn.side)
  addConn.visible = false
  addConn.keyboardSelectedId = ''
}

const isSelected = (sessionId: string) => workspace.selectedLeftFileSessionId === sessionId || workspace.selectedRightFileSessionId === sessionId

const selectableAddConnOptions = computed(() => addConnOptions.value.filter((session) => !isSelected(session.id)))

const moveAddConnKeyboard = (delta: number) => {
  const options = selectableAddConnOptions.value
  if (!options.length) {
    addConn.keyboardSelectedId = ''
    return
  }
  const currentIndex = options.findIndex((session) => session.id === addConn.keyboardSelectedId)
  const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : options.length - 1) : (currentIndex + delta + options.length) % options.length
  addConn.keyboardSelectedId = options[nextIndex].id
}

const confirmAddConnKeyboard = () => {
  if (!addConn.keyboardSelectedId || isSelected(addConn.keyboardSelectedId)) return
  pickAddConn(addConn.keyboardSelectedId)
}

const toggleDefaultSession = (sessionId: string) => {
  expandedDefault.value = expandedDefault.value.includes(sessionId)
    ? expandedDefault.value.filter((id) => id !== sessionId)
    : [...expandedDefault.value, sessionId]
}

const getFileLanguage = (filePath: string) => {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    md: 'markdown',
    sh: 'shell',
    py: 'python',
    log: 'log',
    txt: 'text'
  }
  return map[ext] || 'text'
}

const fileContentOptions = (
  payload: { sessionId: string; host: string },
  overrides: Pick<FileContentOptions, 'expectedAction' | 'expectedMtimeMs' | 'expectedSize' | 'overwrite'> = {}
): FileContentOptions => {
  const session = workspace.fileSessions.find((item) => item.id === payload.sessionId)
  return {
    sessionId: payload.sessionId,
    kind: session?.kind ?? (payload.sessionId === 'local' ? 'local' : 'remote'),
    host: payload.host,
    rootPath: session?.rootPath,
    ...overrides
  }
}

const pushBackendTransferTask = (task: unknown, fallbackError: string) => {
  if (!isFileTransferTaskData(task)) throw new Error(fallbackError)
  const normalized = workspace.pushFileTransferTask(task as FileTransferTask)
  if (!normalized) throw new Error(fallbackError)
  return normalized
}

const openFileEditor = async (payload: { filePath: string; sessionId: string; sessionLabel: string; host: string }) => {
  const key = `${payload.sessionId}:${payload.filePath}`
  const existing = fileEditors.value.find((editor) => editor.key === key)
  if (existing) {
    existing.visible = true
    activeEditorKey.value = key
    return
  }
  const draft: FileEditorState = {
    key,
    filePath: payload.filePath,
    sessionId: payload.sessionId,
    sessionLabel: payload.sessionLabel,
    host: payload.host,
    content: '',
    originContent: '',
    action: 'edit',
    originMtimeMs: 0,
    originSize: 0,
    language: getFileLanguage(payload.filePath),
    loading: true,
    dirty: false,
    saved: false,
    error: '',
    visible: true,
    fullscreen: false,
    x: Math.max(24, Math.round(window.innerWidth / 2 - 450)),
    y: Math.max(24, Math.round(window.innerHeight / 2 - 310)),
    width: Math.min(900, Math.max(620, window.innerWidth - 96)),
    height: Math.min(620, Math.max(420, window.innerHeight - 96))
  }
  fileEditors.value.push(draft)
  const editor = fileEditors.value[fileEditors.value.length - 1]
  activeEditorKey.value = key
  try {
    const result = await window.aiops.readFileContent(payload.filePath, fileContentOptions(payload))
    if (!result.ok) {
      editor.error = result.errorMessage || '读取文件失败'
      return
    }
    const data = result.data
    if (!isFileReadContentData(data)) {
      editor.error = malformedFilesBackendResultMessage
      return
    }
    editor.content = data.content
    editor.originContent = data.content
    editor.action = data.action
    editor.originMtimeMs = data.mtimeMs
    editor.originSize = data.size
  } catch (error) {
    editor.error = error instanceof Error ? error.message : '读取文件失败'
  } finally {
    editor.loading = false
  }
}

const editorGeometry = (editor: FileEditorState) => ({
  left: `${editor.x}px`,
  top: `${editor.y}px`,
  width: `${editor.width}px`,
  height: `${editor.height}px`,
  transform: 'none'
})

const clampEditor = (editor: FileEditorState) => {
  editor.width = Math.max(420, Math.min(editor.width, window.innerWidth - 24))
  editor.height = Math.max(280, Math.min(editor.height, window.innerHeight - 48))
  editor.x = Math.max(12, Math.min(editor.x, window.innerWidth - editor.width - 12))
  editor.y = Math.max(12, Math.min(editor.y, window.innerHeight - editor.height - 12))
}

const startEditorDrag = (event: MouseEvent, editor: FileEditorState) => {
  const target = event.target as HTMLElement
  if (editor.fullscreen || target.closest('button') || target.closest('textarea') || target.closest('.files-monaco-editor')) return
  activeEditorKey.value = editor.key
  editorPointer.mode = 'drag'
  editorPointer.key = editor.key
  editorPointer.startX = event.clientX
  editorPointer.startY = event.clientY
  editorPointer.editorX = editor.x
  editorPointer.editorY = editor.y
  event.preventDefault()
}

const startEditorResize = (event: MouseEvent, editor: FileEditorState) => {
  activeEditorKey.value = editor.key
  editorPointer.mode = 'resize'
  editorPointer.key = editor.key
  editorPointer.startX = event.clientX
  editorPointer.startY = event.clientY
  editorPointer.width = editor.width
  editorPointer.height = editor.height
}

const handleEditorPointerMove = (event: MouseEvent) => {
  if (!editorPointer.mode) return
  const editor = fileEditors.value.find((item) => item.key === editorPointer.key)
  if (!editor) return
  const dx = event.clientX - editorPointer.startX
  const dy = event.clientY - editorPointer.startY
  if (editorPointer.mode === 'drag') {
    editor.x = editorPointer.editorX + dx
    editor.y = editorPointer.editorY + dy
  } else {
    editor.width = editorPointer.width + dx
    editor.height = editorPointer.height + dy
  }
  clampEditor(editor)
}

const stopEditorPointer = () => {
  editorPointer.mode = ''
  editorPointer.key = ''
}

const handleEditorKeydown = (event: KeyboardEvent) => {
  const shouldSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
  if (!shouldSave || !activeEditorKey.value) return
  const editor = fileEditors.value.find((item) => item.key === activeEditorKey.value)
  if (!editor) return
  event.preventDefault()
  saveFileEditor(editor.key, false)
}

const markEditorDirty = (editor: FileEditorState) => {
  editor.dirty = editor.content !== editor.originContent
  if (editor.dirty) editor.saved = false
}

const updateFileEditorContent = (editor: FileEditorState, value: string) => {
  editor.content = value
  markEditorDirty(editor)
}

const saveFileEditor = async (key: string, needClose: boolean) => {
  const editor = fileEditors.value.find((item) => item.key === key)
  if (!editor || editor.loading) return
  editor.loading = true
  editor.error = ''
  try {
    const result = await window.aiops.writeFileContent(
      editor.filePath,
      editor.content,
      fileContentOptions(editor, {
        expectedAction: editor.action,
        expectedMtimeMs: editor.originMtimeMs,
        expectedSize: editor.originSize
      })
    )
    if (!result.ok) {
      editor.error = result.errorMessage || '保存文件失败'
      return
    }
    const data = result.data
    if (!isFileWriteContentData(data)) {
      editor.error = malformedFilesBackendResultMessage
      return
    }
    pushBackendTransferTask(data.task, '保存文件失败')
    editor.originContent = editor.content
    editor.action = 'edit'
    editor.originMtimeMs = data.mtimeMs
    editor.originSize = data.size
    editor.dirty = false
    editor.saved = true
  } catch (error) {
    editor.error = error instanceof Error ? error.message : '保存文件失败'
    return
  } finally {
    editor.loading = false
  }
  closeConfirm.visible = false
  if (needClose) removeFileEditor(key)
}

const removeFileEditor = (key: string) => {
  fileEditors.value = fileEditors.value.filter((editor) => editor.key !== key)
  if (activeEditorKey.value === key) activeEditorKey.value = fileEditors.value.at(-1)?.key || ''
}

const discardFileEditor = (key: string) => {
  closeConfirm.visible = false
  removeFileEditor(key)
}

const requestCloseFileEditor = (key: string) => {
  const editor = fileEditors.value.find((item) => item.key === key)
  if (!editor) return
  if (editor.dirty) {
    closeConfirm.visible = true
    closeConfirm.editorKey = key
    closeConfirm.filePath = editor.filePath
    return
  }
  removeFileEditor(key)
}

onMounted(() => {
  void workspace.refreshFileSessionCatalog()
  window.addEventListener('mousemove', handleEditorPointerMove)
  window.addEventListener('mouseup', stopEditorPointer)
  window.addEventListener('keydown', handleEditorKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleEditorPointerMove)
  window.removeEventListener('mouseup', stopEditorPointer)
  window.removeEventListener('keydown', handleEditorKeydown)
})
</script>
