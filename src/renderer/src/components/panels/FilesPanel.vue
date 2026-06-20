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
      <template
        v-for="row in visibleTreeRows"
        :key="row.key"
      >
        <button
          v-if="row.kind === 'group'"
          class="files-tree-group-row"
          :class="{ 'custom-folder': row.group.type === 'custom-folder' || row.group.type === 'direct-group' }"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          @click="toggleGroup(row.group.key)"
          @contextmenu.prevent="openFolderContextMenu($event, row.group.key)"
        >
          <ChevronDown v-if="isGroupExpanded(row.group.key)" />
          <ChevronRight v-else />
          <span>{{ row.group.name }}</span>
          <small>({{ filesGroupSessionCount(row.group) }})</small>
        </button>

        <button
          v-else
          class="files-tree-session"
          draggable="true"
          :class="{ selected: selectedId === row.session.id }"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          @click="handleSessionClick(row.session.id)"
          @dblclick="openSession(row.session.id)"
          @contextmenu.prevent="openContextMenu($event, row.session.id)"
          @dragstart="onDragStart($event, row.session.id)"
        >
          <Folder />
          <span>{{ displaySession(row.session) }}</span>
          <span
            v-if="commentSessionId === row.session.id"
            class="files-comment-edit"
            @click.stop
          >
            <input
              v-model="editingComment"
              placeholder="备注"
              @keydown.enter.prevent="saveComment(row.session.id)"
              @keydown.esc.prevent="cancelComment"
            />
            <button
              type="button"
              @click="saveComment(row.session.id)"
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
          <em v-else-if="row.session.comment">({{ row.session.comment }})</em>
        </button>
      </template>
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
          v-if="currentFolders.length === 0"
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
            v-for="folder in currentFolders"
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
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'

type CustomFolder = FileSessionFolderRecord

type ContextMenuTarget = 'session' | 'folder' | ''

type FilesGroup = {
  name: string
  key: string
  sessions: FileSessionInfo[]
  childGroups: FilesGroup[]
  originalCount: number
  type: 'system' | 'direct-group' | 'organization' | 'custom-folder'
  parentKey?: string
  folderUuid?: string
  organizationId?: string
  groupName?: string
  description?: string
}

type FilesTreeRow =
  | { key: string; kind: 'group'; group: FilesGroup; depth: number }
  | { key: string; kind: 'session'; session: FileSessionInfo; depth: number; parentGroupKey: string }

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
const recentSessionIds = computed(() => workspace.workspacePreferences.recentAssetIds || [])
const customFolders = computed<CustomFolder[]>(() => workspace.fileSessionFolders)
const directFolders = computed(() => customFolders.value.filter((folder) => folder.scope === 'direct'))
const bastionFolders = computed(() => customFolders.value.filter((folder) => folder.scope !== 'direct'))
const currentFolders = computed(() => (activeTab.value === 'direct' ? directFolders.value : bastionFolders.value))

const ungroupedGroupName = '未分组'
const normalizeDirectGroupName = (name?: string) => {
  const trimmed = String(name || '').trim()
  return !trimmed || trimmed === 'Hosts' ? ungroupedGroupName : trimmed
}
const sessionGroupName = (session: FileSessionInfo) => normalizeDirectGroupName(session.group)
const directGroupKey = (name: string) => `group-${name}`

const makeGroup = (input: Omit<FilesGroup, 'sessions' | 'childGroups'> & Partial<Pick<FilesGroup, 'sessions' | 'childGroups'>>): FilesGroup => ({
  ...input,
  sessions: input.sessions || [],
  childGroups: input.childGroups || []
})

const localSessions = computed(() => workspace.fileSessions.filter((session) => session.kind === 'local'))
const directSessions = computed(() => workspace.fileSessions.filter((session) => session.kind === 'remote' && session.assetType !== 'organization'))
const organizationSessions = computed(() => workspace.fileSessions.filter((session) => session.kind === 'remote' && session.assetType === 'organization'))
const bastionResourceSessions = computed(() =>
  workspace.fileSessions.filter((session) => {
    if (session.kind !== 'remote' || session.assetType === 'organization') return false
    const folder = session.folderUuid ? customFolders.value.find((item) => item.uuid === session.folderUuid) : null
    return Boolean(session.organizationId || (folder && folder.scope !== 'direct'))
  })
)

const buildDirectGroups = (): FilesGroup[] => {
  const foldersByName = new Map(directFolders.value.map((folder) => [folder.name, folder]))
  const groupNames = [
    ...new Set([...directFolders.value.map((folder) => folder.name), ...directSessions.value.map((session) => sessionGroupName(session))])
  ].filter(Boolean)
  const groupsByName = new Map<string, FilesGroup>()
  groupNames.forEach((name) => {
    const folder = foldersByName.get(name)
    const parentFolder = folder?.parentUuid ? directFolders.value.find((item) => item.uuid === folder.parentUuid) : null
    const sessions = directSessions.value.filter((session) => sessionGroupName(session) === name)
    groupsByName.set(
      name,
      makeGroup({
        key: directGroupKey(name),
        name,
        sessions,
        originalCount: sessions.length,
        type: 'direct-group',
        groupName: name,
        ...(folder ? { folderUuid: folder.uuid, description: folder.description } : {}),
        ...(parentFolder ? { parentKey: directGroupKey(parentFolder.name) } : {})
      })
    )
  })

  const roots: FilesGroup[] = []
  groupsByName.forEach((group) => {
    const parent = group.parentKey ? [...groupsByName.values()].find((item) => item.key === group.parentKey) : null
    if (parent && parent.key !== group.key) {
      parent.childGroups.push(group)
      return
    }
    roots.push(group)
  })

  const recentSessions = recentSessionIds.value.map((id) => directSessions.value.find((session) => session.id === id)).filter((session): session is FileSessionInfo => !!session)
  const groups = [
    makeGroup({
      key: 'recent_connections',
      name: '最近连接',
      sessions: recentSessions,
      originalCount: recentSessions.length,
      type: 'system'
    }),
    ...roots,
    makeGroup({
      key: 'local_connections',
      name: '本地连接',
      sessions: localSessions.value,
      originalCount: localSessions.value.length,
      type: 'system'
    })
  ]
  return groups.filter((group) => group.sessions.length > 0 || group.childGroups.length > 0 || group.type !== 'system')
}

const buildBastionGroups = (): FilesGroup[] => {
  const folderGroupsByUuid = new Map(
    bastionFolders.value.map((folder) => {
      const sessions = bastionResourceSessions.value.filter((session) => session.folderUuid === folder.uuid)
      return [
        folder.uuid,
        makeGroup({
          key: folder.uuid,
          name: folder.name,
          sessions,
          originalCount: sessions.length,
          type: 'custom-folder' as const,
          folderUuid: folder.uuid,
          description: folder.description,
          ...(folder.parentUuid ? { parentKey: folder.parentUuid } : {})
        })
      ] as const
    })
  )
  const folderRoots: FilesGroup[] = []
  folderGroupsByUuid.forEach((group) => {
    const parent = group.parentKey ? folderGroupsByUuid.get(group.parentKey) : null
    if (parent && parent.key !== group.key) parent.childGroups.push(group)
    else folderRoots.push(group)
  })

  const organizationGroups = organizationSessions.value.map((organization) => {
    const organizationId = organization.organizationId || organization.id
    const sessions = [
      organization,
      ...bastionResourceSessions.value.filter((session) => !session.folderUuid && (!session.organizationId || session.organizationId === organizationId))
    ]
    return makeGroup({
      key: organizationId,
      name: organization.label,
      sessions,
      originalCount: sessions.length,
      type: 'organization' as const,
      organizationId
    })
  })
  return [...organizationGroups, ...folderRoots]
}

const sourceGroups = computed(() => (activeTab.value === 'direct' ? buildDirectGroups() : buildBastionGroups()))

const matchesSession = (session: FileSessionInfo, keyword: string) =>
  !keyword ||
  [session.label, session.host, session.username, session.group, session.comment]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keyword))

const filterGroupTree = (group: FilesGroup, keyword: string): FilesGroup | null => {
  const groupMatches = !keyword || [group.name, group.description, group.folderUuid].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword))
  const childGroups = group.childGroups.map((child) => filterGroupTree(child, keyword)).filter((child): child is FilesGroup => Boolean(child))
  const sessions = groupMatches ? group.sessions : group.sessions.filter((session) => matchesSession(session, keyword))
  if (!groupMatches && childGroups.length === 0 && sessions.length === 0) return null
  return { ...group, sessions, childGroups }
}

const filteredGroups = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return sourceGroups.value
  return sourceGroups.value.map((group) => filterGroupTree(group, keyword)).filter((group): group is FilesGroup => Boolean(group))
})

const collectGroupSessions = (group: FilesGroup): FileSessionInfo[] => [...group.sessions, ...group.childGroups.flatMap(collectGroupSessions)]
const filesGroupSessionCount = (group: FilesGroup) => collectGroupSessions(group).length
const collectTreeRows = (groups: FilesGroup[], depth = 0): FilesTreeRow[] =>
  groups.flatMap((group) => {
    const rows: FilesTreeRow[] = [{ key: `files-group-${group.key}`, kind: 'group', group, depth }]
    if (isGroupExpanded(group.key)) {
      rows.push(...collectTreeRows(group.childGroups, depth + 1))
      rows.push(...group.sessions.map((session) => ({ key: `files-session-${group.key}-${session.id}`, kind: 'session' as const, session, depth: depth + 1, parentGroupKey: group.key })))
    }
    return rows
  })
const visibleTreeRows = computed(() => collectTreeRows(filteredGroups.value))

const flattenGroups = (group: FilesGroup): FilesGroup[] => [group, ...group.childGroups.flatMap(flattenGroups)]
const groupByKey = (key: string) => sourceGroups.value.flatMap(flattenGroups).find((group) => group.key === key) || null
const folderByGroup = (group: FilesGroup | null) => {
  if (!group) return null
  if (group.type === 'direct-group') return directFolders.value.find((folder) => folder.uuid === group.folderUuid || folder.name === group.groupName) || null
  if (group.type === 'custom-folder') return bastionFolders.value.find((folder) => folder.uuid === group.folderUuid) || null
  return null
}

const contextSession = computed(() => (contextMenu.target === 'session' ? workspace.fileSessions.find((item) => item.id === contextMenu.sessionId) || null : null))
const contextGroup = computed(() => (contextMenu.target === 'folder' ? groupByKey(contextMenu.folderUuid) : null))
const contextFolder = computed(() => folderByGroup(contextGroup.value))
const deleteFolderInfo = computed(() => currentFolders.value.find((item) => item.uuid === deleteFolderModal.folderUuid) || null)
const deleteFolderAssetCount = computed(() => {
  const group = sourceGroups.value.flatMap(flattenGroups).find((item) => item.folderUuid === deleteFolderModal.folderUuid)
  return group ? filesGroupSessionCount(group) : workspace.fileSessions.filter((session) => session.folderUuid === deleteFolderModal.folderUuid).length
})

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
  const canManageFolders = activeTab.value === 'bastion'
  return {
    favorite: session?.favorite !== undefined,
    comment: isOrganizationAsset(session) && !sessionKey.startsWith('common_'),
    move: canManageFolders && isOrganizationAsset(session) && session?.assetType !== 'organization' && !sessionKey.startsWith('common_'),
    remove: canManageFolders && isOrganizationAsset(session) && !!session?.folderUuid,
    editFolder: false,
    deleteFolder: false
  }
}

const buildFolderContextOptions = (folder: CustomFolder | null, group: FilesGroup | null = contextGroup.value): ContextMenuOptions => ({
  ...emptyContextOptions,
  editFolder: activeTab.value === 'bastion' && !!folder && group?.type === 'custom-folder',
  deleteFolder: activeTab.value === 'bastion' && !!folder && group?.type === 'custom-folder'
})

const contextMenuOptions = computed(() => {
  if (contextMenu.target === 'session') return buildSessionContextOptions(contextSession.value)
  if (contextMenu.target === 'folder') return buildFolderContextOptions(contextFolder.value, contextGroup.value)
  return emptyContextOptions
})

const countContextOptions = (options: ContextMenuOptions) => Object.values(options).filter(Boolean).length

const displaySession = (session: FileSessionInfo) => (showIpMode.value ? session.host : session.label)

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
  const group = groupByKey(groupKey)
  const folder = folderByGroup(group)
  if (!folder) return
  event.preventDefault()
  event.stopPropagation()
  clearSessionClickTimer()
  const menuItemCount = countContextOptions(buildFolderContextOptions(folder, group))
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
  const previousKey = folder ? (folder.scope === 'direct' ? directGroupKey(folder.name) : folder.uuid) : editFolderForm.uuid
  const saved = await workspace.saveFileSessionFolder({
    ...(folder || {}),
    uuid: editFolderForm.uuid,
    name,
    description: editFolderForm.description.trim(),
    scope: folder?.scope || (activeTab.value === 'direct' ? 'direct' : 'bastion')
  })
  if (folder?.scope === 'direct' && saved) await replaceExpandedGroup(previousKey, directGroupKey(saved.name))
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
  const group = sourceGroups.value.flatMap(flattenGroups).find((item) => item.folderUuid === folderUuid)
  await workspace.deleteFileSessionFolder(folderUuid)
  await removeExpandedGroup(group?.key || folderUuid)
  closeDeleteFolderModal()
}
</script>
