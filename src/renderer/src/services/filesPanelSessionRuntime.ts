import { reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { FileSessionInfo, FileSessionPatch } from '@shared/contracts/files'
import type { FilesPanelContextMenuState } from '@/services/filesPanelContextRuntime'

export type FilesPanelSessionRuntimeDeps = {
  selectedId: Ref<string>
  contextMenu: FilesPanelContextMenuState
  contextSession: ComputedRef<FileSessionInfo | null>
  getFileSessions: () => FileSessionInfo[]
  getSelectedLeftFileSessionId: () => string | null
  setFilesUiMode: (mode: 'default' | 'transfer') => unknown
  openFileSession: (sessionId: string, side: 'left' | 'right') => unknown
  updateFileSession: (id: string, patch: FileSessionPatch) => Promise<FileSessionInfo | null>
}

export const filesPanelSftpDragPayload = (session: FileSessionInfo) => ({
  uuid: session.id,
  ip: session.host,
  title: session.label,
  hostname: session.label,
  host: session.host,
  port: session.kind === 'remote' ? 22 : undefined,
  username: session.kind === 'remote' ? session.username || 'root' : undefined,
  organizationId: session.organizationId,
  jumpHostId: session.jumpHostId,
  sshType: session.kind,
  asset_type: session.assetType || (session.kind === 'remote' ? 'person' : 'local'),
  proxyCommand: ''
})

export const createFilesPanelSessionRuntime = (deps: FilesPanelSessionRuntimeDeps) => {
  const commentSessionId = ref('')
  const editingComment = ref('')
  const moveModal = reactive({ visible: false, sessionId: '' })
  let sessionClickTimer: number | null = null

  const closeContextMenu = () => {
    deps.contextMenu.visible = false
  }

  const closeMoveModal = () => {
    moveModal.visible = false
    moveModal.sessionId = ''
  }

  const clearSessionClickTimer = () => {
    if (sessionClickTimer) {
      window.clearTimeout(sessionClickTimer)
      sessionClickTimer = null
    }
  }

  const cancelComment = () => {
    commentSessionId.value = ''
    editingComment.value = ''
  }

  const openSession = (sessionId: string) => {
    if (commentSessionId.value === sessionId) return
    clearSessionClickTimer()
    deps.selectedId.value = sessionId
    deps.setFilesUiMode('transfer')
    deps.openFileSession(sessionId, deps.getSelectedLeftFileSessionId() ? 'right' : 'left')
  }

  const handleSessionClick = (sessionId: string) => {
    if (commentSessionId.value === sessionId) return
    clearSessionClickTimer()
    deps.selectedId.value = sessionId
    sessionClickTimer = window.setTimeout(() => {
      openSession(sessionId)
      sessionClickTimer = null
    }, 250)
  }

  const onDragStart = (event: DragEvent, sessionId: string) => {
    const session = deps.getFileSessions().find((item) => item.id === sessionId)
    if (!session) return
    const payload = filesPanelSftpDragPayload(session)
    event.dataTransfer?.setData('application/x-asset-sftp', JSON.stringify(payload))
    event.dataTransfer?.setData('application/x-aiopsterm-file-session', sessionId)
    event.dataTransfer?.setData('text/plain', session.label || session.host || sessionId)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  const beginCommentEdit = () => {
    const session = deps.contextSession.value
    if (!session) return
    commentSessionId.value = session.id
    editingComment.value = session.comment || ''
    closeContextMenu()
  }

  const saveComment = async (sessionId: string) => {
    const session = deps.getFileSessions().find((item) => item.id === sessionId)
    if (session) {
      await deps.updateFileSession(session.id, { comment: editingComment.value })
    }
    cancelComment()
  }

  const toggleContextFavorite = () => {
    const session = deps.contextSession.value
    if (session && session.favorite !== undefined) {
      const nextFavorite = !session.favorite
      void deps.updateFileSession(session.id, { favorite: nextFavorite })
    }
    closeContextMenu()
  }

  const commentContextSession = () => {
    beginCommentEdit()
  }

  const moveContextSession = () => {
    const session = deps.contextSession.value
    if (session) {
      moveModal.visible = true
      moveModal.sessionId = session.id
    }
    closeContextMenu()
  }

  const removeFromFolderContextSession = async () => {
    const session = deps.contextSession.value
    if (session) {
      await deps.updateFileSession(session.id, { folderUuid: undefined })
    }
    closeContextMenu()
  }

  return {
    commentSessionId,
    editingComment,
    moveModal,
    closeMoveModal,
    clearSessionClickTimer,
    handleSessionClick,
    openSession,
    onDragStart,
    saveComment,
    cancelComment,
    toggleContextFavorite,
    commentContextSession,
    moveContextSession,
    removeFromFolderContextSession
  }
}

export type FilesPanelSessionRuntime = ReturnType<typeof createFilesPanelSessionRuntime>
