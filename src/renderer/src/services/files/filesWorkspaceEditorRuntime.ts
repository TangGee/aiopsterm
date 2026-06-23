import { reactive, ref } from 'vue'
import type { FileContentOptions, FileSessionInfo, FileTransferTask } from '@shared/contracts/files'
import {
  isFileReadContentData,
  isFileTransferTaskData,
  isFileWriteContentData,
  malformedFilesBackendResultMessage
} from '@/services/files/filesBackendGuards'

export type FileEditorState = {
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

export type FilesWorkspaceEditorOpenPayload = {
  filePath: string
  sessionId: string
  sessionLabel: string
  host: string
}

type FilesWorkspaceBackendResult = {
  ok: boolean
  data?: unknown
  errorMessage?: string
}

export type FilesWorkspaceReadFileContent = (filePath: string, options: FileContentOptions) => Promise<FilesWorkspaceBackendResult>
export type FilesWorkspaceWriteFileContent = (filePath: string, content: string, options: FileContentOptions) => Promise<FilesWorkspaceBackendResult>

export type FilesWorkspaceEditorRuntimeDeps = {
  getFileSessions: () => FileSessionInfo[]
  readFileContent: () => FilesWorkspaceReadFileContent | undefined
  writeFileContent: () => FilesWorkspaceWriteFileContent | undefined
  pushFileTransferTask: (task: FileTransferTask) => FileTransferTask | null | undefined
  getViewport?: () => { width: number; height: number }
}

const defaultViewport = () => ({
  width: typeof window === 'undefined' ? 1024 : window.innerWidth,
  height: typeof window === 'undefined' ? 768 : window.innerHeight
})

export const filesWorkspaceEditorLanguage = (filePath: string) => {
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

export const createFilesWorkspaceEditorRuntime = (deps: FilesWorkspaceEditorRuntimeDeps) => {
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

  const viewport = () => deps.getViewport?.() || defaultViewport()

  const fileContentOptions = (
    payload: { sessionId: string; host: string },
    overrides: Pick<FileContentOptions, 'expectedAction' | 'expectedMtimeMs' | 'expectedSize' | 'overwrite'> = {}
  ): FileContentOptions => {
    const session = deps.getFileSessions().find((item) => item.id === payload.sessionId)
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
    const normalized = deps.pushFileTransferTask(task)
    if (!normalized) throw new Error(fallbackError)
    return normalized
  }

  const createEditorDraft = (payload: FilesWorkspaceEditorOpenPayload): FileEditorState => {
    const { width: viewportWidth, height: viewportHeight } = viewport()
    return {
      key: `${payload.sessionId}:${payload.filePath}`,
      filePath: payload.filePath,
      sessionId: payload.sessionId,
      sessionLabel: payload.sessionLabel,
      host: payload.host,
      content: '',
      originContent: '',
      action: 'edit',
      originMtimeMs: 0,
      originSize: 0,
      language: filesWorkspaceEditorLanguage(payload.filePath),
      loading: true,
      dirty: false,
      saved: false,
      error: '',
      visible: true,
      fullscreen: false,
      x: Math.max(24, Math.round(viewportWidth / 2 - 450)),
      y: Math.max(24, Math.round(viewportHeight / 2 - 310)),
      width: Math.min(900, Math.max(620, viewportWidth - 96)),
      height: Math.min(620, Math.max(420, viewportHeight - 96))
    }
  }

  const openFileEditor = async (payload: FilesWorkspaceEditorOpenPayload) => {
    const key = `${payload.sessionId}:${payload.filePath}`
    const existing = fileEditors.value.find((editor) => editor.key === key)
    if (existing) {
      existing.visible = true
      activeEditorKey.value = key
      return
    }
    const draft = createEditorDraft(payload)
    fileEditors.value.push(draft)
    const editor = fileEditors.value[fileEditors.value.length - 1]
    activeEditorKey.value = key
    try {
      const readFileContent = deps.readFileContent()
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
    const { width: viewportWidth, height: viewportHeight } = viewport()
    editor.width = Math.max(420, Math.min(editor.width, viewportWidth - 24))
    editor.height = Math.max(280, Math.min(editor.height, viewportHeight - 48))
    editor.x = Math.max(12, Math.min(editor.x, viewportWidth - editor.width - 12))
    editor.y = Math.max(12, Math.min(editor.y, viewportHeight - editor.height - 12))
  }

  const startEditorDrag = (event: MouseEvent, editor: FileEditorState) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (editor.fullscreen || target?.closest('button') || target?.closest('textarea') || target?.closest('.files-monaco-editor')) return
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

  const saveFileEditor = async (key: string, needClose: boolean) => {
    const editor = fileEditors.value.find((item) => item.key === key)
    if (!editor || editor.loading) return
    editor.loading = true
    editor.error = ''
    try {
      const writeFileContent = deps.writeFileContent()
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

  const handleEditorKeydown = (event: KeyboardEvent) => {
    const shouldSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
    if (!shouldSave || !activeEditorKey.value) return
    const editor = fileEditors.value.find((item) => item.key === activeEditorKey.value)
    if (!editor) return
    event.preventDefault()
    void saveFileEditor(editor.key, false)
  }

  const markEditorDirty = (editor: FileEditorState) => {
    editor.dirty = editor.content !== editor.originContent
    if (editor.dirty) editor.saved = false
  }

  const updateFileEditorContent = (editor: FileEditorState, value: string) => {
    editor.content = value
    markEditorDirty(editor)
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

  return {
    fileEditors,
    activeEditorKey,
    closeConfirm,
    editorGeometry,
    startEditorDrag,
    startEditorResize,
    handleEditorPointerMove,
    stopEditorPointer,
    handleEditorKeydown,
    updateFileEditorContent,
    openFileEditor,
    saveFileEditor,
    discardFileEditor,
    requestCloseFileEditor
  }
}

export type FilesWorkspaceEditorRuntime = ReturnType<typeof createFilesWorkspaceEditorRuntime>
