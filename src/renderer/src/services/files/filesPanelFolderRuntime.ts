import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { FileSessionFolderRecord, FileSessionFolderSaveInput, FileSessionInfo, FileSessionPatch } from '@shared/contracts/files'
import type { FilesPanelContextMenuState } from '@/services/files/filesPanelContextRuntime'
import {
  directFilesPanelGroupKey,
  filesPanelDeleteFolderAssetCount,
  flattenFilesPanelGroups,
  type FilesPanelGroup,
  type FilesPanelTab
} from '@/services/files/filesPanelTreeRuntime'

export type FilesPanelMoveModalState = {
  visible: boolean
  sessionId: string
}

export type FilesPanelFolderRuntimeDeps = {
  activeTab: Ref<FilesPanelTab>
  contextMenu: FilesPanelContextMenuState
  contextFolder: ComputedRef<FileSessionFolderRecord | null>
  moveModal: FilesPanelMoveModalState
  currentFolders: ComputedRef<FileSessionFolderRecord[]>
  bastionFolders: ComputedRef<FileSessionFolderRecord[]>
  organizationSessions: ComputedRef<FileSessionInfo[]>
  sourceGroups: ComputedRef<FilesPanelGroup[]>
  getFileSessions: () => FileSessionInfo[]
  updateFileSession: (id: string, patch: FileSessionPatch) => Promise<FileSessionInfo | null>
  saveFileSessionFolder: (folder: FileSessionFolderSaveInput) => Promise<FileSessionFolderRecord | null>
  deleteFileSessionFolder: (uuid: string) => Promise<boolean>
  closeMoveModal: () => void
  removeExpandedGroup: (groupKey: string) => Promise<unknown>
  replaceExpandedGroup: (oldKey: string, newKey: string) => Promise<unknown>
}

export const createFilesPanelFolderRuntime = (deps: FilesPanelFolderRuntimeDeps) => {
  const createFolderModal = reactive({ visible: false })
  const editFolderModal = reactive({ visible: false })
  const deleteFolderModal = reactive({ visible: false, folderUuid: '' })
  const createFolderForm = reactive({ name: '', description: '' })
  const editFolderForm = reactive({ uuid: '', name: '', description: '' })
  const folderFormError = ref('')

  const deleteFolderInfo = computed(() => deps.currentFolders.value.find((item) => item.uuid === deleteFolderModal.folderUuid) || null)
  const deleteFolderAssetCount = computed(() =>
    filesPanelDeleteFolderAssetCount({
      groups: deps.sourceGroups.value,
      sessions: deps.getFileSessions(),
      folderUuid: deleteFolderModal.folderUuid
    })
  )

  const closeContextMenu = () => {
    deps.contextMenu.visible = false
    deps.contextMenu.target = ''
    deps.contextMenu.sessionId = ''
    deps.contextMenu.folderUuid = ''
  }

  const resetFolderForms = () => {
    createFolderForm.name = ''
    createFolderForm.description = ''
    editFolderForm.uuid = ''
    editFolderForm.name = ''
    editFolderForm.description = ''
    folderFormError.value = ''
  }

  const closeCreateFolderModal = () => {
    createFolderModal.visible = false
    resetFolderForms()
  }

  const closeEditFolderModal = () => {
    editFolderModal.visible = false
    resetFolderForms()
  }

  const closeDeleteFolderModal = () => {
    deleteFolderModal.visible = false
    deleteFolderModal.folderUuid = ''
  }

  const moveAssetToFolder = async (folderUuid: string) => {
    const session = deps.getFileSessions().find((item) => item.id === deps.moveModal.sessionId)
    if (!session) return
    const folder = deps.bastionFolders.value.find((item) => item.uuid === folderUuid)
    await deps.updateFileSession(session.id, {
      folderUuid,
      ...(folder && !session.organizationId ? { organizationId: deps.organizationSessions.value[0]?.organizationId || deps.organizationSessions.value[0]?.id } : {})
    })
    deps.closeMoveModal()
  }

  const createFolderFromMoveModal = () => {
    deps.closeMoveModal()
    resetFolderForms()
    createFolderModal.visible = true
  }

  const saveCreatedFolder = async () => {
    const name = createFolderForm.name.trim()
    if (!name) {
      folderFormError.value = '请输入文件夹名称'
      return
    }
    await deps.saveFileSessionFolder({
      name,
      description: createFolderForm.description.trim(),
      scope: deps.activeTab.value === 'direct' ? 'direct' : 'bastion'
    })
    closeCreateFolderModal()
  }

  const editContextFolder = () => {
    const folder = deps.contextFolder.value
    if (!folder) return
    editFolderForm.uuid = folder.uuid
    editFolderForm.name = folder.name
    editFolderForm.description = folder.description
    folderFormError.value = ''
    editFolderModal.visible = true
    closeContextMenu()
  }

  const saveEditedFolder = async () => {
    const name = editFolderForm.name.trim()
    if (!name) {
      folderFormError.value = '请输入文件夹名称'
      return
    }
    const folder = deps.currentFolders.value.find((item) => item.uuid === editFolderForm.uuid)
    const previousKey = folder ? (folder.scope === 'direct' ? directFilesPanelGroupKey(folder.name) : folder.uuid) : editFolderForm.uuid
    const saved = await deps.saveFileSessionFolder({
      ...(folder || {}),
      uuid: editFolderForm.uuid,
      name,
      description: editFolderForm.description.trim(),
      scope: folder?.scope || (deps.activeTab.value === 'direct' ? 'direct' : 'bastion')
    })
    if (folder?.scope === 'direct' && saved) await deps.replaceExpandedGroup(previousKey, directFilesPanelGroupKey(saved.name))
    closeEditFolderModal()
  }

  const deleteContextFolder = () => {
    const folder = deps.contextFolder.value
    if (!folder) return
    deleteFolderModal.folderUuid = folder.uuid
    deleteFolderModal.visible = true
    closeContextMenu()
  }

  const confirmDeleteFolder = async () => {
    const folderUuid = deleteFolderModal.folderUuid
    if (!folderUuid) return
    const group = deps.sourceGroups.value.flatMap(flattenFilesPanelGroups).find((item) => item.folderUuid === folderUuid)
    await deps.deleteFileSessionFolder(folderUuid)
    await deps.removeExpandedGroup(group?.key || folderUuid)
    closeDeleteFolderModal()
  }

  return {
    createFolderModal,
    editFolderModal,
    deleteFolderModal,
    createFolderForm,
    editFolderForm,
    folderFormError,
    deleteFolderInfo,
    deleteFolderAssetCount,
    closeCreateFolderModal,
    closeEditFolderModal,
    closeDeleteFolderModal,
    moveAssetToFolder,
    createFolderFromMoveModal,
    saveCreatedFolder,
    editContextFolder,
    saveEditedFolder,
    deleteContextFolder,
    confirmDeleteFolder
  }
}

export type FilesPanelFolderRuntime = ReturnType<typeof createFilesPanelFolderRuntime>
