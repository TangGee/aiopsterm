import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'
import {
  buildFilesPanelGroups,
  collectFilesPanelTreeRows,
  directFilesPanelGroupKey,
  displayFilesPanelSession,
  filesPanelFolderForGroup,
  filesPanelFoldersForTab,
  filesPanelGroupSessionCount,
  filterFilesPanelGroups,
  findFilesPanelGroup
} from '@/services/files/filesPanelTreeRuntime'
import { createFilesPanelContextRuntime } from '@/services/files/filesPanelContextRuntime'
import { createFilesPanelSessionRuntime } from '@/services/files/filesPanelSessionRuntime'
import { createFilesPanelFolderRuntime } from '@/services/files/filesPanelFolderRuntime'

type CustomFolder = FileSessionFolderRecord

export const useFilesPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const activeTab = ref<'direct' | 'bastion'>('direct')
  const query = ref('')
  const selectedId = ref('local')
  const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
  const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)
  const recentSessionIds = computed(() => workspace.workspacePreferences.recentAssetIds || [])
  const customFolders = computed<CustomFolder[]>(() => workspace.fileSessionFolders)
  const directFolders = computed(() => filesPanelFoldersForTab(customFolders.value, 'direct'))
  const bastionFolders = computed(() => filesPanelFoldersForTab(customFolders.value, 'bastion'))
  const currentFolders = computed(() => (activeTab.value === 'direct' ? directFolders.value : bastionFolders.value))
  const organizationSessions = computed(() => workspace.fileSessions.filter((session) => session.kind === 'remote' && session.assetType === 'organization'))

  const isGroupExpanded = (key: string) => !!query.value.trim() || expandedGroups.value.includes(key)
  const sourceGroups = computed(() =>
    buildFilesPanelGroups({
      tab: activeTab.value,
      sessions: workspace.fileSessions,
      folders: customFolders.value,
      recentSessionIds: recentSessionIds.value
    })
  )
  const filteredGroups = computed(() => filterFilesPanelGroups(sourceGroups.value, query.value))
  const visibleTreeRows = computed(() => collectFilesPanelTreeRows(filteredGroups.value, isGroupExpanded))
  const groupByKey = (key: string) => findFilesPanelGroup(sourceGroups.value, key)
  const folderByGroup = (group: ReturnType<typeof groupByKey>) =>
    filesPanelFolderForGroup({
      group,
      directFolders: directFolders.value,
      bastionFolders: bastionFolders.value
    })

  const toggleGroup = async (key: string) => {
    const next = expandedGroups.value.includes(key) ? expandedGroups.value.filter((item) => item !== key) : [...expandedGroups.value, key]
    await workspace.updateWorkspacePreferences({ expandedGroups: next })
  }

  const toggleDisplayMode = async () => {
    await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
  }

  const removeExpandedGroup = async (groupKey: string) => {
    if (!expandedGroups.value.includes(groupKey)) return true
    return workspace.updateWorkspacePreferences({ expandedGroups: expandedGroups.value.filter((item) => item !== groupKey) })
  }

  const replaceExpandedGroup = async (oldKey: string, newKey: string) => {
    if (!expandedGroups.value.includes(oldKey)) return true
    return workspace.updateWorkspacePreferences({ expandedGroups: expandedGroups.value.map((item) => (item === oldKey ? newKey : item)) })
  }

  let sessionRuntime: ReturnType<typeof createFilesPanelSessionRuntime> | null = null
  const contextRuntime = createFilesPanelContextRuntime({
    activeTab,
    selectedId,
    getFileSessions: () => workspace.fileSessions,
    groupByKey,
    folderByGroup,
    clearSessionClickTimer: () => sessionRuntime?.clearSessionClickTimer()
  })

  sessionRuntime = createFilesPanelSessionRuntime({
    selectedId,
    contextMenu: contextRuntime.contextMenu,
    contextSession: contextRuntime.contextSession,
    getFileSessions: () => workspace.fileSessions,
    getSelectedLeftFileSessionId: () => workspace.selectedLeftFileSessionId,
    setFilesUiMode: (mode) => workspace.setFilesUiMode(mode),
    openFileSession: (sessionId, side) => workspace.openFileSession(sessionId, side),
    updateFileSession: (id, patch) => workspace.updateFileSession(id, patch)
  })

  const folderRuntime = createFilesPanelFolderRuntime({
    activeTab,
    contextMenu: contextRuntime.contextMenu,
    contextFolder: contextRuntime.contextFolder,
    moveModal: sessionRuntime.moveModal,
    currentFolders,
    bastionFolders,
    organizationSessions,
    sourceGroups,
    getFileSessions: () => workspace.fileSessions,
    updateFileSession: (id, patch) => workspace.updateFileSession(id, patch),
    saveFileSessionFolder: (folder) => workspace.saveFileSessionFolder(folder),
    deleteFileSessionFolder: (uuid) => workspace.deleteFileSessionFolder(uuid),
    closeMoveModal: sessionRuntime.closeMoveModal,
    removeExpandedGroup,
    replaceExpandedGroup
  })

  const displaySession = (session: FileSessionInfo) => displayFilesPanelSession(session, showIpMode.value)
  const filesGroupSessionCount = filesPanelGroupSessionCount

  watch(activeTab, () => {
    sessionRuntime?.clearSessionClickTimer()
    query.value = ''
    selectedId.value = ''
    sessionRuntime?.cancelComment()
    contextRuntime.closeContextMenu()
    sessionRuntime?.closeMoveModal()
    folderRuntime.closeCreateFolderModal()
    folderRuntime.closeEditFolderModal()
    folderRuntime.closeDeleteFolderModal()
  })

  onBeforeUnmount(() => {
    sessionRuntime?.clearSessionClickTimer()
  })

  onMounted(() => {
    void workspace.refreshFileSessionCatalog()
  })

  return {
    activeTab,
    query,
    selectedId,
    commentSessionId: sessionRuntime.commentSessionId,
    editingComment: sessionRuntime.editingComment,
    contextMenu: contextRuntime.contextMenu,
    moveModal: sessionRuntime.moveModal,
    createFolderModal: folderRuntime.createFolderModal,
    editFolderModal: folderRuntime.editFolderModal,
    deleteFolderModal: folderRuntime.deleteFolderModal,
    createFolderForm: folderRuntime.createFolderForm,
    editFolderForm: folderRuntime.editFolderForm,
    folderFormError: folderRuntime.folderFormError,
    showIpMode,
    currentFolders,
    visibleTreeRows,
    contextSession: contextRuntime.contextSession,
    contextMenuOptions: contextRuntime.contextMenuOptions,
    deleteFolderInfo: folderRuntime.deleteFolderInfo,
    deleteFolderAssetCount: folderRuntime.deleteFolderAssetCount,
    filesGroupSessionCount,
    displaySession,
    isGroupExpanded,
    toggleGroup,
    toggleDisplayMode,
    closeContextMenu: contextRuntime.closeContextMenu,
    closeMoveModal: sessionRuntime.closeMoveModal,
    closeCreateFolderModal: folderRuntime.closeCreateFolderModal,
    closeEditFolderModal: folderRuntime.closeEditFolderModal,
    closeDeleteFolderModal: folderRuntime.closeDeleteFolderModal,
    handleSessionClick: sessionRuntime.handleSessionClick,
    openSession: sessionRuntime.openSession,
    onDragStart: sessionRuntime.onDragStart,
    openContextMenu: contextRuntime.openContextMenu,
    openFolderContextMenu: contextRuntime.openFolderContextMenu,
    saveComment: sessionRuntime.saveComment,
    cancelComment: sessionRuntime.cancelComment,
    toggleContextFavorite: sessionRuntime.toggleContextFavorite,
    commentContextSession: sessionRuntime.commentContextSession,
    moveContextSession: sessionRuntime.moveContextSession,
    moveAssetToFolder: folderRuntime.moveAssetToFolder,
    removeFromFolderContextSession: sessionRuntime.removeFromFolderContextSession,
    createFolderFromMoveModal: folderRuntime.createFolderFromMoveModal,
    saveCreatedFolder: folderRuntime.saveCreatedFolder,
    editContextFolder: folderRuntime.editContextFolder,
    saveEditedFolder: folderRuntime.saveEditedFolder,
    deleteContextFolder: folderRuntime.deleteContextFolder,
    confirmDeleteFolder: folderRuntime.confirmDeleteFolder,
    directFilesPanelGroupKey
  }
}
