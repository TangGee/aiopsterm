import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { filesClient } from '@/services/filesClient'
import {
  isFileReadContentData,
  isFileTransferTaskData,
  isFileWriteContentData,
  malformedFilesBackendResultMessage
} from '@/services/filesBackendGuards'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileContentOptions, FileTransferTask } from '@shared/contracts/files'

export const useFilesWorkspaceRuntime = () => {
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
      const readFileContent = filesClient.readFileContent()
      if (!readFileContent) throw new Error('读取文件服务不可用')
      const result = await readFileContent(payload.filePath, fileContentOptions(payload))
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
      const writeFileContent = filesClient.writeFileContent()
      if (!writeFileContent) throw new Error('文件保存服务不可用')
      const result = await writeFileContent(
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

  return {
    workspace,
    expandedDefault,
    addConn,
    fileEditors,
    activeEditorKey,
    closeConfirm,
    addConnOptions,
    openAddConn,
    setAddConnTab,
    pickAddConn,
    isSelected,
    moveAddConnKeyboard,
    confirmAddConnKeyboard,
    toggleDefaultSession,
    openFileEditor,
    editorGeometry,
    startEditorDrag,
    startEditorResize,
    updateFileEditorContent,
    saveFileEditor,
    discardFileEditor,
    requestCloseFileEditor
  }
}
