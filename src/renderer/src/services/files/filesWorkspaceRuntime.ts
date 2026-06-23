import { onBeforeUnmount, onMounted } from 'vue'
import { filesClient } from '@/services/files/filesClient'
import { useWorkspaceStore } from '@/stores/workspace'
import { createFilesWorkspaceConnectionRuntime } from '@/services/files/filesWorkspaceConnectionRuntime'
import { createFilesWorkspaceEditorRuntime } from '@/services/files/filesWorkspaceEditorRuntime'
import type { FileTransferTask } from '@shared/contracts/files'

export const useFilesWorkspaceRuntime = () => {
  const workspace = useWorkspaceStore()
  const connectionRuntime = createFilesWorkspaceConnectionRuntime({
    getFileSessions: () => workspace.fileSessions,
    getSelectedLeftFileSessionId: () => workspace.selectedLeftFileSessionId,
    getSelectedRightFileSessionId: () => workspace.selectedRightFileSessionId,
    openFileSession: (sessionId, side) => workspace.openFileSession(sessionId, side)
  })

  const editorRuntime = createFilesWorkspaceEditorRuntime({
    getFileSessions: () => workspace.fileSessions,
    readFileContent: () => filesClient.readFileContent(),
    writeFileContent: () => filesClient.writeFileContent(),
    pushFileTransferTask: (task: FileTransferTask) => workspace.pushFileTransferTask(task)
  })

  onMounted(() => {
    void workspace.refreshFileSessionCatalog()
    window.addEventListener('mousemove', editorRuntime.handleEditorPointerMove)
    window.addEventListener('mouseup', editorRuntime.stopEditorPointer)
    window.addEventListener('keydown', editorRuntime.handleEditorKeydown)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('mousemove', editorRuntime.handleEditorPointerMove)
    window.removeEventListener('mouseup', editorRuntime.stopEditorPointer)
    window.removeEventListener('keydown', editorRuntime.handleEditorKeydown)
  })

  return {
    workspace,
    ...connectionRuntime,
    ...editorRuntime
  }
}
