<template>
  <section class="files-side-panel">
    <header class="files-side-header">
      <h2>文件管理</h2>
    </header>

    <div class="files-source-tabs">
      <button
        :class="{ active: activeTab === 'direct' }"
        @click="activeTab = 'direct'"
      >
        直接连接
      </button>
      <button
        :class="{ active: activeTab === 'bastion' }"
        @click="activeTab = 'bastion'"
      >
        堡垒机资源
      </button>
    </div>

    <div class="files-tree-toolbar">
      <label class="files-search">
        <Search />
        <input
          v-model="query"
          placeholder="搜索"
          @input="closeContextMenu"
        />
      </label>
      <button
        class="workspace-button"
        :title="showIpMode ? '显示主机名' : '显示 IP'"
        @click="toggleDisplayMode"
      >
        <RefreshCw />
      </button>
    </div>

    <div class="files-tree-list">
      <div
        v-for="group in visibleGroups"
        :key="group.key"
        class="files-tree-group"
      >
        <button
          class="files-tree-group-row"
          :class="{ 'custom-folder': group.isCustomFolder }"
          @click="toggleGroup(group.key)"
          @contextmenu.prevent="openFolderContextMenu($event, group.key)"
        >
          <ChevronDown v-if="isGroupExpanded(group.key)" />
          <ChevronRight v-else />
          <span>{{ group.name }}</span>
          <small>({{ group.count }})</small>
        </button>

        <div
          v-if="isGroupExpanded(group.key)"
          class="files-tree-children"
        >
          <button
            v-for="session in group.sessions"
            :key="session.id"
            class="files-tree-session"
            draggable="true"
            :class="{ selected: selectedId === session.id }"
            @click="handleSessionClick(session.id)"
            @dblclick="openSession(session.id)"
            @contextmenu.prevent="openContextMenu($event, session.id)"
            @dragstart="onDragStart($event, session.id)"
          >
            <Folder />
            <span>{{ displaySession(session) }}</span>
            <span
              v-if="commentSessionId === session.id"
              class="files-comment-edit"
              @click.stop
            >
              <input
                v-model="editingComment"
                placeholder="备注"
                @keydown.enter.prevent="saveComment(session.id)"
                @keydown.esc.prevent="cancelComment"
              />
              <button
                type="button"
                @click="saveComment(session.id)"
              >
                <Check />
              </button>
              <button
                type="button"
                @click="cancelComment"
              >
                <X />
              </button>
            </span>
            <em v-else-if="session.comment">({{ session.comment }})</em>
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="contextMenu.visible"
      class="asset-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <button
        v-if="contextMenuOptions.favorite"
        @click="toggleContextFavorite"
      >
        <Star />
        {{ contextSession?.favorite ? '取消收藏' : '加入收藏' }}
      </button>
      <button
        v-if="contextMenuOptions.comment"
        @click="commentContextSession"
      >
        <MessageSquare />
        {{ contextSession?.comment ? '编辑备注' : '添加备注' }}
      </button>
      <button
        v-if="contextMenuOptions.move"
        @click="moveContextSession"
      >
        <FolderInput />
        移动到文件夹
      </button>
      <button
        v-if="contextMenuOptions.remove"
        class="delete"
        @click="removeFromFolderContextSession"
      >
        <FolderMinus />
        从文件夹移除
      </button>
      <button
        v-if="contextMenuOptions.editFolder"
        @click="editContextFolder"
      >
        <Pencil />
        编辑文件夹
      </button>
      <button
        v-if="contextMenuOptions.deleteFolder"
        class="delete"
        @click="deleteContextFolder"
      >
        <Trash2 />
        删除文件夹
      </button>
    </div>

    <div
      v-if="moveModal.visible"
      class="files-folder-modal-backdrop"
      @click.self="closeMoveModal"
    >
      <section class="files-folder-modal">
        <header>
          <h3>移动到文件夹</h3>
          <button
            type="button"
            @click="closeMoveModal"
          >
            <X />
          </button>
        </header>
        <div
          v-if="customFolders.length === 0"
          class="files-folder-empty"
        >
          <p>暂无文件夹</p>
          <button @click="createFolderFromMoveModal">创建文件夹</button>
        </div>
        <div
          v-else
          class="files-folder-list"
        >
          <p>选择文件夹:</p>
          <button
            v-for="folder in customFolders"
            :key="folder.uuid"
            class="files-folder-option"
            @click="moveAssetToFolder(folder.uuid)"
          >
            <strong>{{ folder.name }}</strong>
            <small v-if="folder.description">{{ folder.description }}</small>
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="createFolderModal.visible"
      class="files-folder-modal-backdrop"
      @click.self="closeCreateFolderModal"
    >
      <section class="files-folder-modal">
        <header>
          <h3>创建文件夹</h3>
          <button
            type="button"
            @click="closeCreateFolderModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form"
          @submit.prevent="saveCreatedFolder"
        >
          <label>
            <span>文件夹名称 *</span>
            <input
              v-model="createFolderForm.name"
              placeholder="请输入文件夹名称"
            />
          </label>
          <label>
            <span>文件夹描述</span>
            <textarea
              v-model="createFolderForm.description"
              rows="3"
              placeholder="请输入文件夹描述"
            />
          </label>
          <p
            v-if="folderFormError"
            class="files-folder-error"
          >
            {{ folderFormError }}
          </p>
          <footer>
            <button
              type="button"
              @click="closeCreateFolderModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              确定
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="editFolderModal.visible"
      class="files-folder-modal-backdrop"
      @click.self="closeEditFolderModal"
    >
      <section class="files-folder-modal">
        <header>
          <h3>编辑文件夹</h3>
          <button
            type="button"
            @click="closeEditFolderModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form"
          @submit.prevent="saveEditedFolder"
        >
          <label>
            <span>文件夹名称 *</span>
            <input
              v-model="editFolderForm.name"
              placeholder="请输入文件夹名称"
            />
          </label>
          <label>
            <span>文件夹描述</span>
            <textarea
              v-model="editFolderForm.description"
              rows="3"
              placeholder="请输入文件夹描述"
            />
          </label>
          <p
            v-if="folderFormError"
            class="files-folder-error"
          >
            {{ folderFormError }}
          </p>
          <footer>
            <button
              type="button"
              @click="closeEditFolderModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              确定
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="deleteFolderModal.visible && deleteFolderInfo"
      class="files-folder-modal-backdrop"
      @click.self="closeDeleteFolderModal"
    >
      <section class="files-folder-modal files-folder-confirm">
        <header>
          <h3>删除文件夹</h3>
          <button
            type="button"
            @click="closeDeleteFolderModal"
          >
            <X />
          </button>
        </header>
        <div class="files-folder-confirm-body">
          <p v-if="deleteFolderAssetCount > 0">
            确定删除文件夹 {{ deleteFolderInfo.name }}？文件夹内 {{ deleteFolderAssetCount }} 个资产将移出文件夹。
          </p>
          <p v-else>确定删除文件夹 {{ deleteFolderInfo.name }}？</p>
        </div>
        <footer>
          <button
            type="button"
            @click="closeDeleteFolderModal"
          >
            取消
          </button>
          <button
            type="button"
            class="danger"
            @click="confirmDeleteFolder"
          >
            删除
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, Folder, FolderInput, FolderMinus, MessageSquare, Pencil, RefreshCw, Search, Star, Trash2, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/preload'

type CustomFolder = FileSessionFolderRecord

type ContextMenuTarget = 'session' | 'folder' | ''

type FilesGroup = {
  name: string
  key: string
  count: number
  sessions: FileSessionInfo[]
  isCustomFolder?: boolean
  description?: string
}

type ContextMenuOptions = {
  favorite: boolean
  comment: boolean
  move: boolean
  remove: boolean
  editFolder: boolean
  deleteFolder: boolean
}

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
const customFolders = computed<CustomFolder[]>(() => workspace.fileSessionFolders)

const filesGroupKeys: Record<string, string> = {
  最近连接: 'recent_connections',
  主机: 'files-hosts',
  本地连接: 'local_connections'
}

const sourceSessions = computed(() => {
  const sessions = workspace.fileSessions
  if (activeTab.value === 'direct') return sessions
  return sessions.filter((session) => session.kind === 'remote')
})

const visibleGroups = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const matchesSession = (session: FileSessionInfo) => {
    if (!keyword) return true
    return [session.label, session.host, session.group, session.comment].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword))
  }
  const matchesFolder = (folder: CustomFolder) => {
    if (!keyword) return true
    return [folder.name, folder.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword))
  }
  const map = new Map<string, FilesGroup>()
  sourceSessions.value
    .filter((session) => {
      const folder = session.folderUuid ? customFolders.value.find((item) => item.uuid === session.folderUuid) : null
      return !folder && matchesSession(session)
    })
    .forEach((session) => {
      const groupName = session.group === '最近连接' || session.group === '本地连接' ? session.group : '主机'
      const groupKey = filesGroupKeys[groupName] || `files-${groupName}`
      const existing = map.get(groupKey)
      if (existing) {
        existing.sessions = [...existing.sessions, session]
        existing.count += 1
        return
      }
      map.set(groupKey, { name: groupName, key: groupKey, count: 1, sessions: [session] })
    })
  const folderGroups = customFolders.value
    .map((folder) => {
      const folderSessions = sourceSessions.value.filter((session) => session.folderUuid === folder.uuid)
      const folderMatched = matchesFolder(folder)
      const visibleSessions = folderMatched ? folderSessions : folderSessions.filter(matchesSession)
      if (keyword && !folderMatched && visibleSessions.length === 0) return null
      return {
        name: folder.name,
        key: folder.uuid,
        description: folder.description,
        count: folderSessions.length,
        sessions: visibleSessions,
        isCustomFolder: true
      }
    })
    .filter(Boolean) as FilesGroup[]
  return [...Array.from(map.values()), ...folderGroups]
})

const contextSession = computed(() => (contextMenu.target === 'session' ? workspace.fileSessions.find((item) => item.id === contextMenu.sessionId) || null : null))
const contextFolder = computed(() => (contextMenu.target === 'folder' ? customFolders.value.find((item) => item.uuid === contextMenu.folderUuid) || null : null))
const deleteFolderInfo = computed(() => customFolders.value.find((item) => item.uuid === deleteFolderModal.folderUuid) || null)
const deleteFolderAssetCount = computed(() => workspace.fileSessions.filter((session) => session.folderUuid === deleteFolderModal.folderUuid).length)

const isOrganizationAsset = (session: FileSessionInfo | null) => session?.assetType === 'person' || session?.assetType === 'organization'

const emptyContextOptions: ContextMenuOptions = {
  favorite: false,
  comment: false,
  move: false,
  remove: false,
  editFolder: false,
  deleteFolder: false
}

const buildSessionContextOptions = (session: FileSessionInfo | null): ContextMenuOptions => {
  const sessionKey = session?.id || ''
  return {
    favorite: session?.favorite !== undefined,
    comment: isOrganizationAsset(session) && !sessionKey.startsWith('common_'),
    move: isOrganizationAsset(session) && !sessionKey.startsWith('common_') && !sessionKey.startsWith('folder_'),
    remove: isOrganizationAsset(session) && sessionKey.startsWith('folder_') && !!session?.folderUuid,
    editFolder: false,
    deleteFolder: false
  }
}

const buildFolderContextOptions = (folder: CustomFolder | null): ContextMenuOptions => ({
  ...emptyContextOptions,
  editFolder: !!folder,
  deleteFolder: !!folder
})

const contextMenuOptions = computed(() => {
  if (contextMenu.target === 'session') return buildSessionContextOptions(contextSession.value)
  if (contextMenu.target === 'folder') return buildFolderContextOptions(contextFolder.value)
  return emptyContextOptions
})

const countContextOptions = (options: ContextMenuOptions) => Object.values(options).filter(Boolean).length

const displaySession = (session: FileSessionInfo) => (showIpMode.value ? session.host : session.label)

const isGroupExpanded = (key: string) => !!query.value.trim() || expandedGroups.value.includes(key)

const toggleGroup = (key: string) => {
  const next = expandedGroups.value.includes(key) ? expandedGroups.value.filter((item) => item !== key) : [...expandedGroups.value, key]
  workspace.updateWorkspacePreferences({ expandedGroups: next })
}

const toggleDisplayMode = () => {
  workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
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

const removeExpandedGroup = (groupKey: string) => {
  if (!expandedGroups.value.includes(groupKey)) return
  workspace.updateWorkspacePreferences({ expandedGroups: expandedGroups.value.filter((item) => item !== groupKey) })
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
  username: session.kind === 'remote' ? 'deploy' : undefined,
  organizationId: undefined,
  sshType: session.kind,
  asset_type: session.kind === 'remote' ? 'person' : 'local',
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
  const menuItemCount = countContextOptions(buildSessionContextOptions(session))
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
  const folder = customFolders.value.find((item) => item.uuid === groupKey)
  if (!folder) return
  event.preventDefault()
  event.stopPropagation()
  clearSessionClickTimer()
  const menuItemCount = countContextOptions(buildFolderContextOptions(folder))
  if (!menuItemCount) {
    closeContextMenu()
    return
  }
  positionContextMenu(event, menuItemCount)
  selectedId.value = ''
  contextMenu.visible = true
  contextMenu.target = 'folder'
  contextMenu.sessionId = ''
  contextMenu.folderUuid = folder.uuid
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
    void workspace.updateFileSession(session.id, { favorite: nextFavorite, group: nextFavorite ? '最近连接' : '主机' })
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
  await workspace.updateFileSession(session.id, { folderUuid, group: '主机' })
  closeMoveModal()
}

const removeFromFolderContextSession = async () => {
  const session = contextSession.value
  if (session) {
    await workspace.updateFileSession(session.id, { folderUuid: undefined, group: '最近连接' })
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
    description: createFolderForm.description.trim()
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
  await workspace.saveFileSessionFolder({ uuid: editFolderForm.uuid, name, description: editFolderForm.description.trim() })
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
  await workspace.deleteFileSessionFolder(folderUuid)
  removeExpandedGroup(folderUuid)
  closeDeleteFolderModal()
}
</script>
