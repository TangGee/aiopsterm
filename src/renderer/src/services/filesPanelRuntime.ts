import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'
import {
  buildFilesPanelFolderContextOptions,
  buildFilesPanelGroups,
  buildFilesPanelSessionContextOptions,
  collectFilesPanelTreeRows,
  countFilesPanelContextOptions,
  directFilesPanelGroupKey,
  displayFilesPanelSession,
  emptyFilesPanelContextOptions,
  filesPanelDeleteFolderAssetCount,
  filesPanelFolderForGroup,
  filesPanelFoldersForTab,
  filesPanelGroupSessionCount,
  filterFilesPanelGroups,
  findFilesPanelGroup,
  flattenFilesPanelGroups
} from '@/services/filesPanelTreeRuntime'

type CustomFolder = FileSessionFolderRecord

type ContextMenuTarget = 'session' | 'folder' | ''

export const useFilesPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const activeTab = ref<'direct' | 'bastion'>('direct')
  const query = ref('')
  const selectedId = ref('local')
  const commentSessionId = ref('')
  const editingComment = ref('')
  const contextMenu = reactive({ visible: false, x: 0, y: 0, target: '' as ContextMenuTarget, sessionId: '', folderUuid: '' })
  const moveModal = reactive({ visible: false, sessionId: '' })
  const createFolderModal = reactive({ visible: false })
  const editFolderModal = reactive({ visible: false })
  const deleteFolderModal = reactive({ visible: false, folderUuid: '' })
  const createFolderForm = reactive({ name: '', description: '' })
  const editFolderForm = reactive({ uuid: '', name: '', description: '' })
  const folderFormError = ref('')
  const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
  const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)
  let sessionClickTimer: number | null = null
  const recentSessionIds = computed(() => workspace.workspacePreferences.recentAssetIds || [])
  const customFolders = computed<CustomFolder[]>(() => workspace.fileSessionFolders)
  const directFolders = computed(() => filesPanelFoldersForTab(customFolders.value, 'direct'))
  const bastionFolders = computed(() => filesPanelFoldersForTab(customFolders.value, 'bastion'))
  const currentFolders = computed(() => (activeTab.value === 'direct' ? directFolders.value : bastionFolders.value))
  const organizationSessions = computed(() => workspace.fileSessions.filter((session) => session.kind === 'remote' && session.assetType === 'organization'))

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

  const contextSession = computed(() => (contextMenu.target === 'session' ? workspace.fileSessions.find((item) => item.id === contextMenu.sessionId) || null : null))
  const contextGroup = computed(() => (contextMenu.target === 'folder' ? groupByKey(contextMenu.folderUuid) : null))
  const contextFolder = computed(() => folderByGroup(contextGroup.value))
  const deleteFolderInfo = computed(() => currentFolders.value.find((item) => item.uuid === deleteFolderModal.folderUuid) || null)
  const deleteFolderAssetCount = computed(() =>
    filesPanelDeleteFolderAssetCount({
      groups: sourceGroups.value,
      sessions: workspace.fileSessions,
      folderUuid: deleteFolderModal.folderUuid
    })
  )

  const contextMenuOptions = computed(() => {
    if (contextMenu.target === 'session') return buildFilesPanelSessionContextOptions(contextSession.value, activeTab.value)
    if (contextMenu.target === 'folder') return buildFilesPanelFolderContextOptions(contextFolder.value, contextGroup.value, activeTab.value)
    return emptyFilesPanelContextOptions
  })

  const filesGroupSessionCount = filesPanelGroupSessionCount

  const displaySession = (session: FileSessionInfo) => displayFilesPanelSession(session, showIpMode.value)

  const isGroupExpanded = (key: string) => !!query.value.trim() || expandedGroups.value.includes(key)

  const toggleGroup = async (key: string) => {
  const next = expandedGroups.value.includes(key) ? expandedGroups.value.filter((item) => item !== key) : [...expandedGroups.value, key]
  await workspace.updateWorkspacePreferences({ expandedGroups: next })
  }

  const toggleDisplayMode = async () => {
  await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
  }

  const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
  const menuWidth = 160
  const estimatedMenuHeight = 4 + 2 + menuItemCount * 25
  let left = event.clientX
  let top = event.clientY
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 5
  }
  if (top + estimatedMenuHeight > window.innerHeight) {
    top = event.clientY - estimatedMenuHeight
    if (top < 0) top = 5
  }
  contextMenu.x = left
  contextMenu.y = top
  }

  const removeExpandedGroup = async (groupKey: string) => {
  if (!expandedGroups.value.includes(groupKey)) return true
  return workspace.updateWorkspacePreferences({ expandedGroups: expandedGroups.value.filter((item) => item !== groupKey) })
  }

  const replaceExpandedGroup = async (oldKey: string, newKey: string) => {
  if (!expandedGroups.value.includes(oldKey)) return true
  return workspace.updateWorkspacePreferences({ expandedGroups: expandedGroups.value.map((item) => (item === oldKey ? newKey : item)) })
  }

  const resetFolderForms = () => {
  createFolderForm.name = ''
  createFolderForm.description = ''
  editFolderForm.uuid = ''
  editFolderForm.name = ''
  editFolderForm.description = ''
  folderFormError.value = ''
  }

  const closeContextMenu = () => {
  contextMenu.visible = false
  contextMenu.target = ''
  contextMenu.sessionId = ''
  contextMenu.folderUuid = ''
  }

  const closeMoveModal = () => {
  moveModal.visible = false
  moveModal.sessionId = ''
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

  const clearSessionClickTimer = () => {
  if (sessionClickTimer) {
    window.clearTimeout(sessionClickTimer)
    sessionClickTimer = null
  }
  }

  watch(activeTab, () => {
  clearSessionClickTimer()
  query.value = ''
  selectedId.value = ''
  cancelComment()
  closeContextMenu()
  closeMoveModal()
  closeCreateFolderModal()
  closeEditFolderModal()
  closeDeleteFolderModal()
  })

  onBeforeUnmount(() => {
  clearSessionClickTimer()
  })

  onMounted(() => {
  void workspace.refreshFileSessionCatalog()
  })

  const handleSessionClick = (sessionId: string) => {
  if (commentSessionId.value === sessionId) return
  clearSessionClickTimer()
  selectedId.value = sessionId
  sessionClickTimer = window.setTimeout(() => {
    openSession(sessionId)
    sessionClickTimer = null
  }, 250)
  }

  const openSession = (sessionId: string) => {
  if (commentSessionId.value === sessionId) return
  clearSessionClickTimer()
  selectedId.value = sessionId
  workspace.setFilesUiMode('transfer')
  workspace.openFileSession(sessionId, workspace.selectedLeftFileSessionId ? 'right' : 'left')
  }

  const buildSftpDragPayload = (session: FileSessionInfo) => ({
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

  const onDragStart = (event: DragEvent, sessionId: string) => {
  const session = workspace.fileSessions.find((item) => item.id === sessionId)
  if (!session) return
  const payload = buildSftpDragPayload(session)
  event.dataTransfer?.setData('application/x-asset-sftp', JSON.stringify(payload))
  event.dataTransfer?.setData('application/x-aiopsterm-file-session', sessionId)
  event.dataTransfer?.setData('text/plain', session.label || session.host || sessionId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  const openContextMenu = (event: MouseEvent, sessionId: string) => {
  clearSessionClickTimer()
  const session = workspace.fileSessions.find((item) => item.id === sessionId)
  if (!session) return
  const menuItemCount = countFilesPanelContextOptions(buildFilesPanelSessionContextOptions(session, activeTab.value))
  if (!menuItemCount) {
    closeContextMenu()
    return
  }
  positionContextMenu(event, menuItemCount)
  selectedId.value = sessionId
  contextMenu.visible = true
  contextMenu.target = 'session'
  contextMenu.sessionId = sessionId
  contextMenu.folderUuid = ''
  }

  const openFolderContextMenu = (event: MouseEvent, groupKey: string) => {
  const group = groupByKey(groupKey)
  const folder = folderByGroup(group)
  if (!folder) return
  event.preventDefault()
  event.stopPropagation()
  clearSessionClickTimer()
  const menuItemCount = countFilesPanelContextOptions(buildFilesPanelFolderContextOptions(folder, group, activeTab.value))
  if (!menuItemCount) {
    closeContextMenu()
    return
  }
  positionContextMenu(event, menuItemCount)
  selectedId.value = ''
  contextMenu.visible = true
  contextMenu.target = 'folder'
  contextMenu.sessionId = ''
  contextMenu.folderUuid = group?.key || folder.uuid
  }

  const beginCommentEdit = () => {
  const session = contextSession.value
  if (!session) return
  commentSessionId.value = session.id
  editingComment.value = session.comment || ''
  contextMenu.visible = false
  }

  const saveComment = async (sessionId: string) => {
  const session = workspace.fileSessions.find((item) => item.id === sessionId)
  if (session) {
    await workspace.updateFileSession(session.id, { comment: editingComment.value })
  }
  cancelComment()
  }

  const cancelComment = () => {
  commentSessionId.value = ''
  editingComment.value = ''
  }

  const toggleContextFavorite = () => {
  const session = contextSession.value
  if (session && session.favorite !== undefined) {
    const nextFavorite = !session.favorite
    void workspace.updateFileSession(session.id, { favorite: nextFavorite })
  }
  contextMenu.visible = false
  }

  const commentContextSession = () => {
  beginCommentEdit()
  }

  const moveContextSession = () => {
  const session = contextSession.value
  if (session) {
    moveModal.visible = true
    moveModal.sessionId = session.id
  }
  contextMenu.visible = false
  }

  const moveAssetToFolder = async (folderUuid: string) => {
  const session = workspace.fileSessions.find((item) => item.id === moveModal.sessionId)
  if (!session) return
  const folder = bastionFolders.value.find((item) => item.uuid === folderUuid)
  await workspace.updateFileSession(session.id, { folderUuid, ...(folder && !session.organizationId ? { organizationId: organizationSessions.value[0]?.organizationId || organizationSessions.value[0]?.id } : {}) })
  closeMoveModal()
  }

  const removeFromFolderContextSession = async () => {
  const session = contextSession.value
  if (session) {
    await workspace.updateFileSession(session.id, { folderUuid: undefined })
  }
  contextMenu.visible = false
  }

  const createFolderFromMoveModal = () => {
  closeMoveModal()
  resetFolderForms()
  createFolderModal.visible = true
  }

  const saveCreatedFolder = async () => {
  const name = createFolderForm.name.trim()
  if (!name) {
    folderFormError.value = '请输入文件夹名称'
    return
  }
  await workspace.saveFileSessionFolder({
    name,
    description: createFolderForm.description.trim(),
    scope: activeTab.value === 'direct' ? 'direct' : 'bastion'
  })
  closeCreateFolderModal()
  }

  const editContextFolder = () => {
  const folder = contextFolder.value
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
  const folder = currentFolders.value.find((item) => item.uuid === editFolderForm.uuid)
  const previousKey = folder ? (folder.scope === 'direct' ? directFilesPanelGroupKey(folder.name) : folder.uuid) : editFolderForm.uuid
  const saved = await workspace.saveFileSessionFolder({
    ...(folder || {}),
    uuid: editFolderForm.uuid,
    name,
    description: editFolderForm.description.trim(),
    scope: folder?.scope || (activeTab.value === 'direct' ? 'direct' : 'bastion')
  })
  if (folder?.scope === 'direct' && saved) await replaceExpandedGroup(previousKey, directFilesPanelGroupKey(saved.name))
  closeEditFolderModal()
  }

  const deleteContextFolder = () => {
  const folder = contextFolder.value
  if (!folder) return
  deleteFolderModal.folderUuid = folder.uuid
  deleteFolderModal.visible = true
  closeContextMenu()
  }

  const confirmDeleteFolder = async () => {
  const folderUuid = deleteFolderModal.folderUuid
  if (!folderUuid) return
  const group = sourceGroups.value.flatMap(flattenFilesPanelGroups).find((item) => item.folderUuid === folderUuid)
  await workspace.deleteFileSessionFolder(folderUuid)
  await removeExpandedGroup(group?.key || folderUuid)
  closeDeleteFolderModal()
  }

  return {
    activeTab,
    query,
    selectedId,
    commentSessionId,
    editingComment,
    contextMenu,
    moveModal,
    createFolderModal,
    editFolderModal,
    deleteFolderModal,
    createFolderForm,
    editFolderForm,
    folderFormError,
    showIpMode,
    currentFolders,
    visibleTreeRows,
    contextSession,
    contextMenuOptions,
    deleteFolderInfo,
    deleteFolderAssetCount,
    filesGroupSessionCount,
    displaySession,
    isGroupExpanded,
    toggleGroup,
    toggleDisplayMode,
    closeContextMenu,
    closeMoveModal,
    closeCreateFolderModal,
    closeEditFolderModal,
    closeDeleteFolderModal,
    handleSessionClick,
    openSession,
    onDragStart,
    openContextMenu,
    openFolderContextMenu,
    saveComment,
    cancelComment,
    toggleContextFavorite,
    commentContextSession,
    moveContextSession,
    moveAssetToFolder,
    removeFromFolderContextSession,
    createFolderFromMoveModal,
    saveCreatedFolder,
    editContextFolder,
    saveEditedFolder,
    deleteContextFolder,
    confirmDeleteFolder
  }
}
