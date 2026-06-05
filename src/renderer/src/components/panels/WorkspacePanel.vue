<template>
  <div class="workspace-tree-panel">
    <div class="workspace-tabs">
      <button
        v-for="tab in workspaceTabs"
        :key="tab.key"
        :class="{ active: activeWorkspace === tab.key }"
        @click="activeWorkspace = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="workspace-manage">
      <div class="workspace-search">
        <input
          v-model="searchValue"
          placeholder="搜索"
          @input="closeMenus"
        />
        <Search />
      </div>
      <button
        class="workspace-button"
        :title="showIpMode ? '显示主机名' : '显示 IP'"
        @click="toggleDisplayMode"
      >
        <Repeat2 />
      </button>
      <div class="workspace-add">
        <button
          class="workspace-button"
          :title="activeWorkspace === 'direct' ? '主机' : '新建'"
          @click="handleAddClick"
        >
          <Laptop v-if="activeWorkspace === 'direct'" />
          <AppWindowMac v-else />
        </button>
        <div
          v-if="addMenuOpen && activeWorkspace === 'bastion'"
          class="workspace-add-menu"
          @click.stop
        >
          <button @click="openCreateFolder">
            <Folder />
            自定义文件夹
          </button>
          <button @click="openCreateHost">
            <Laptop />
            主机
          </button>
        </div>
      </div>
    </div>

    <div class="workspace-tree">
      <section
        v-for="group in filteredGroups"
        :key="group.key"
        class="workspace-group"
        :class="{ 'custom-folder': group.type === 'custom-folder' }"
      >
        <button
          class="workspace-folder-row"
          @click="toggleGroup(group.key)"
          @contextmenu.prevent="openGroupContextMenu($event, group.key)"
        >
          <ChevronDown v-if="isGroupExpanded(group.key)" />
          <ChevronRight v-else />
          <span>{{ group.title }}</span>
          <em>({{ group.originalCount }})</em>
          <span
            v-if="activeWorkspace === 'bastion' && group.refreshable"
            class="workspace-row-action refresh"
            :title="refreshingGroupKey === group.key ? '刷新中' : '刷新'"
            @click.stop="refreshGroup(group.key)"
          >
            <RefreshCw :class="{ spinning: refreshingGroupKey === group.key }" />
          </span>
          <MoreHorizontal
            v-if="group.menu"
            class="workspace-row-more"
            @click.stop="openGroupContextMenu($event, group.key)"
          />
        </button>
        <div
          v-if="isGroupExpanded(group.key)"
          class="workspace-host-list"
        >
          <div
            v-for="asset in group.children"
            :key="`${group.key}-${asset.id}`"
            class="workspace-host-row"
            :class="{ selected: selectedAssetId === asset.id }"
            role="button"
            tabindex="0"
            @click="selectAsset(asset.id)"
            @dblclick="connectAsset(asset.id)"
            @contextmenu.prevent="openContextMenu($event, asset.id)"
          >
            <Laptop />
            <span>{{ displayAsset(asset) }}</span>
            <span
              v-if="commentAssetId === asset.id"
              class="workspace-comment-edit"
              @click.stop
            >
              <input
                v-model="editingComment"
                placeholder="备注"
                @keydown.enter.prevent="saveComment(asset.id)"
                @keydown.esc.prevent="cancelComment"
              />
              <button
                type="button"
                title="保存备注"
                @click="saveComment(asset.id)"
              >
                <Check />
              </button>
              <button
                type="button"
                title="取消备注"
                @click="cancelComment"
              >
                <X />
              </button>
            </span>
            <small v-else-if="asset.comment">({{ asset.comment }})</small>
            <Network
              v-if="asset.tunnelState"
              class="tunnel-icon"
              :class="{ active: asset.tunnelState === 'active' }"
              :title="asset.tunnelState === 'active' ? '隧道已连接' : '隧道已创建'"
            />
            <PlugZap
              v-if="asset.asset_type === 'organization'"
              class="tunnel-icon"
              title="堡垒机资源"
            />
            <MoreHorizontal
              class="workspace-row-more"
              @click.stop="openContextMenu($event, asset.id)"
            />
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="contextMenuAssetId && contextAsset"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button
        v-if="contextAsset.favorite !== undefined"
        @click="toggleFavorite"
      >
        <Star />
        {{ contextAsset.favorite ? '取消收藏' : '加入收藏' }}
      </button>
      <button
        v-if="canCommentContextAsset"
        @click="openContextComment"
      >
        <Pencil />
        {{ contextAsset.comment ? '编辑备注' : '添加备注' }}
      </button>
      <button
        v-if="canMoveContextAsset"
        @click="openMoveModalFromContext"
      >
        <FolderInput />
        移动到文件夹
      </button>
      <button
        v-if="canRemoveContextAssetFromFolder"
        class="delete"
        @click="removeContextAssetFromFolder"
      >
        <FolderMinus />
        从文件夹移除
      </button>
      <button
        v-if="contextAsset.asset_type === 'person'"
        @click="toggleTunnel"
      >
        <Network />
        隧道
      </button>
      <button
        v-if="canConnectContextAsset"
        @click="connectContextAsset"
      >
        <PlugZap />
        连接
      </button>
      <button @click="editContextAsset">
        <Pencil />
        编辑
      </button>
      <button
        v-if="contextAsset.asset_type !== 'organization'"
        @click="cloneContextAsset"
      >
        <Copy />
        克隆
      </button>
      <button
        v-if="contextAsset.asset_type === 'organization'"
        @click="refreshContextOrganization"
      >
        <RefreshCw />
        刷新资产
      </button>
      <button
        v-if="contextAsset.asset_type === 'organization'"
        @click="openContextOrganizationManagement"
      >
        <Database />
        管理资产
      </button>
      <button
        class="delete"
        @click="openDeleteContextAsset"
      >
        <Trash2 />
        删除
      </button>
    </div>

    <div
      v-if="contextMenuGroupKey && contextGroup"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button
        v-if="contextGroup.type === 'custom-folder' || contextGroup.type === 'direct-group'"
        @click="openEditGroup"
      >
        <Pencil />
        编辑文件夹
      </button>
      <button
        v-if="contextGroup.refreshable"
        @click="refreshGroup(contextGroup.key)"
      >
        <RefreshCw />
        刷新
      </button>
      <button
        v-if="contextGroup.type === 'organization'"
        @click="openGroupOrganizationManagement"
      >
        <Database />
        管理资产
      </button>
      <button
        v-if="contextGroup.type === 'custom-folder' || contextGroup.type === 'direct-group'"
        class="delete"
        @click="openDeleteGroup"
      >
        <Trash2 />
        删除文件夹
      </button>
      <button
        v-if="contextGroup.type === 'organization'"
        class="delete"
        @click="openDeleteGroupOrganization"
      >
        <Trash2 />
        删除
      </button>
    </div>

    <div
      v-if="folderModal.visible"
      class="files-folder-modal-backdrop"
      @click.self="closeFolderModal"
    >
      <section class="files-folder-modal workspace-folder-modal">
        <header>
          <h3>{{ folderModal.mode === 'create' ? '创建文件夹' : '编辑文件夹' }}</h3>
          <button
            type="button"
            @click="closeFolderModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form"
          @submit.prevent="saveFolderForm"
        >
          <label>
            <span>文件夹名称 *</span>
            <input
              v-model="folderForm.name"
              placeholder="请输入文件夹名称"
            />
          </label>
          <label>
            <span>文件夹描述</span>
            <textarea
              v-model="folderForm.description"
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
              @click="closeFolderModal"
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
      v-if="moveModal.visible"
      class="files-folder-modal-backdrop"
      @click.self="closeMoveModal"
    >
      <section class="files-folder-modal workspace-folder-modal">
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
          <button @click="openCreateFolderFromMoveModal">创建文件夹</button>
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
      v-if="deleteGroupModal.visible && deleteGroupInfo"
      class="files-folder-modal-backdrop"
      @click.self="closeDeleteGroupModal"
    >
      <section class="files-folder-modal files-folder-confirm workspace-folder-modal">
        <header>
          <h3>{{ deleteGroupInfo.kind === 'direct-group' ? '删除分组' : '删除文件夹' }}</h3>
          <button
            type="button"
            @click="closeDeleteGroupModal"
          >
            <X />
          </button>
        </header>
        <div class="files-folder-confirm-body">
          <p v-if="deleteGroupInfo.count > 0">
            确定删除{{ deleteGroupInfo.kind === 'direct-group' ? '分组' : '文件夹' }} {{ deleteGroupInfo.name }}？其中 {{ deleteGroupInfo.count }} 个主机将移出该{{ deleteGroupInfo.kind === 'direct-group' ? '分组' : '文件夹' }}。
          </p>
          <p v-else>确定删除{{ deleteGroupInfo.kind === 'direct-group' ? '分组' : '文件夹' }} {{ deleteGroupInfo.name }}？</p>
        </div>
        <footer>
          <button
            type="button"
            @click="closeDeleteGroupModal"
          >
            取消
          </button>
          <button
            type="button"
            class="danger"
            @click="confirmDeleteGroup"
          >
            删除
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="hostModal.visible"
      class="files-folder-modal-backdrop"
      @click.self="closeHostModal"
    >
      <section class="files-folder-modal workspace-host-modal">
        <header>
          <h3>{{ hostModalTitle }}</h3>
          <button
            type="button"
            @click="closeHostModal"
          >
            <X />
          </button>
        </header>
        <form
          class="workspace-host-form files-folder-form"
          @submit.prevent="saveHostForm"
        >
          <label>
            <span>设备类型</span>
            <select v-model="hostForm.assetType">
              <option value="person">服务器</option>
              <option value="switch">交换机</option>
              <option value="organization">堡垒机</option>
            </select>
          </label>
          <label>
            <span>主机名 *</span>
            <input
              v-model="hostForm.title"
              placeholder="请输入主机名"
            />
          </label>
          <label>
            <span>地址 *</span>
            <input
              v-model="hostForm.host"
              placeholder="请输入 IP 或 Host"
            />
          </label>
          <label>
            <span>认证方式</span>
            <select v-model="hostForm.authType">
              <option value="password">密码</option>
              <option value="keyBased">密钥</option>
            </select>
          </label>
          <label>
            <span>用户名 *</span>
            <input
              v-model="hostForm.username"
              placeholder="请输入用户名"
            />
          </label>
          <label>
            <span>分组</span>
            <input
              v-model="hostForm.group"
              placeholder="请输入分组"
            />
          </label>
          <label>
            <span>端口 *</span>
            <input
              v-model="hostForm.port"
              inputmode="numeric"
              placeholder="22"
            />
          </label>
          <label class="workspace-host-form-wide">
            <span>备注</span>
            <textarea
              v-model="hostForm.comment"
              rows="3"
              placeholder="请输入备注"
            />
          </label>
          <p
            v-if="hostFormError"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ hostFormError }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              @click="closeHostModal"
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
      v-if="deleteAssetModal.visible && deleteAssetInfo"
      class="files-folder-modal-backdrop"
      @click.self="closeDeleteAssetModal"
    >
      <section class="files-folder-modal files-folder-confirm workspace-folder-modal">
        <header>
          <h3>删除主机</h3>
          <button
            type="button"
            @click="closeDeleteAssetModal"
          >
            <X />
          </button>
        </header>
        <div class="files-folder-confirm-body">
          <p>确定删除主机 {{ deleteAssetInfo.name }}？该主机将从当前工作区资源树移除。</p>
        </div>
        <footer>
          <button
            type="button"
            @click="closeDeleteAssetModal"
          >
            取消
          </button>
          <button
            type="button"
            class="danger"
            @click="confirmDeleteAsset"
          >
            删除
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="managementModal.visible && managedOrganization"
      class="files-folder-modal-backdrop"
      @click.self="closeManagementModal"
    >
      <section class="files-folder-modal workspace-management-modal">
        <header>
          <h3>管理资产 · {{ managedOrganization.name }}</h3>
          <button
            type="button"
            @click="closeManagementModal"
          >
            <X />
          </button>
        </header>
        <div class="workspace-management-body">
          <div class="workspace-management-toolbar">
            <div class="workspace-search">
              <input
                v-model="managementModal.query"
                placeholder="搜索资产"
              />
              <Search />
            </div>
            <button
              class="workspace-button"
              :title="refreshingGroupKey === managedOrganization.uuid ? '刷新中' : '刷新'"
              @click="refreshGroup(managedOrganization.uuid)"
            >
              <RefreshCw :class="{ spinning: refreshingGroupKey === managedOrganization.uuid }" />
            </button>
          </div>
          <div class="workspace-management-list">
            <div
              v-for="asset in managedOrganizationAssets"
              :key="asset.id"
              class="workspace-management-row"
            >
              <span>
                <strong>{{ asset.name }}</strong>
                <small>{{ asset.host }} · {{ asset.username }}:{{ asset.port }}</small>
              </span>
              <em>{{ folderNameByUuid(asset.folderUuid) || asset.comment || '未分组' }}</em>
              <button
                v-if="!asset.folderUuid"
                @click="openMoveModal(asset.id)"
              >
                移动
              </button>
              <button
                v-else
                @click="removeAssetFromFolder(asset.id)"
              >
                移除
              </button>
            </div>
            <div
              v-if="managedOrganizationAssets.length === 0"
              class="workspace-management-empty"
            >
              暂无资产
            </div>
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="notice"
      class="workspace-notice"
    >
      {{ notice }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  AppWindowMac,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Folder,
  FolderInput,
  FolderMinus,
  Laptop,
  MoreHorizontal,
  Network,
  Pencil,
  PlugZap,
  RefreshCw,
  Repeat2,
  Search,
  Star,
  Trash2,
  X
} from 'lucide-vue-next'
import { mockAssets, type MockAsset } from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
type WorkspaceTabKey = 'direct' | 'bastion'
type HostModalMode = 'create' | 'edit' | 'clone'
type FolderModalMode = 'create' | 'edit-custom' | 'edit-direct'
type WorkspaceAssetType = MockAsset['asset_type']

const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
  { key: 'direct', label: '直接连接' },
  { key: 'bastion', label: '堡垒机资源' }
]

type WorkspaceAsset = MockAsset & {
  favorite?: boolean
  tunnelState?: 'created' | 'active'
  folderUuid?: string
  organizationId?: string
  isLocalShell?: boolean
}

type WorkspaceGroup = {
  key: string
  title: string
  children: WorkspaceAsset[]
  originalCount: number
  type: 'system' | 'direct-group' | 'organization' | 'custom-folder'
  refreshable?: boolean
  menu?: boolean
  folderUuid?: string
  groupName?: string
  organizationId?: string
}

type CustomFolder = {
  uuid: string
  name: string
  description: string
}

const defaultDirectGroups = ['生产', '预发', '数据库', '维护']
const activeWorkspace = ref<WorkspaceTabKey>('direct')
const searchValue = ref('')
const addMenuOpen = ref(false)
const selectedAssetId = ref<string | null>(null)
const contextMenuAssetId = ref<string | null>(null)
const contextMenuGroupKey = ref<string | null>(null)
const contextMenuPosition = reactive({ x: 0, y: 0 })
const refreshingGroupKey = ref('')
const notice = ref('')
const commentAssetId = ref('')
const editingComment = ref('')
let hostCreateCounter = 6
let folderCreateCounter = 2

const workspaceAssets = ref<WorkspaceAsset[]>(
  mockAssets.map((asset, index) => ({
    ...asset,
    favorite: index === 0 || asset.asset_type === 'organization',
    folderUuid: asset.id === 'asset-1' || asset.id === 'asset-3' ? 'custom-folder-a' : undefined,
    organizationId: asset.id === 'asset-1' || asset.id === 'asset-3' ? 'org-1' : undefined,
    tunnelState: asset.id === 'asset-3' ? 'created' : asset.id === 'asset-2' ? 'active' : undefined
  }))
)

const customFolders = ref<CustomFolder[]>([
  {
    uuid: 'custom-folder-a',
    name: '核心业务',
    description: '常用堡垒机业务资产'
  },
  {
    uuid: 'custom-folder-b',
    name: '临时排障',
    description: '短期排障入口'
  }
])

const folderModal = reactive({ visible: false, mode: 'create' as FolderModalMode, targetKey: '', fromMove: false })
const folderForm = reactive({ name: '', description: '' })
const folderFormError = ref('')
const moveModal = reactive({ visible: false, assetId: '' })
const deleteGroupModal = reactive({ visible: false, groupKey: '' })
const hostModal = reactive({ visible: false, mode: 'create' as HostModalMode, assetId: '' })
const hostForm = reactive({
  assetType: 'person' as WorkspaceAssetType,
  title: '',
  host: '',
  username: '',
  group: '',
  port: '22',
  authType: 'password' as WorkspaceAsset['auth_type'],
  comment: ''
})
const hostFormError = ref('')
const deleteAssetModal = reactive({ visible: false, assetId: '' })
const managementModal = reactive({ visible: false, organizationId: '', query: '' })

const directAssets = computed(() => workspaceAssets.value.filter((asset) => asset.asset_type === 'person' || asset.asset_type === 'switch'))
const organizationAssets = computed(() => workspaceAssets.value.filter((asset) => asset.asset_type === 'organization'))
const bastionResourceAssets = computed(() => workspaceAssets.value.filter((asset) => asset.asset_type !== 'organization' && (asset.organizationId || asset.folderUuid)))
const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)

const createLocalShellAsset = (): WorkspaceAsset => ({
  id: 'local-127-1',
  uuid: 'local-127-1',
  name: '127.0.0.1',
  title: '127.0.0.1',
  host: '127.0.0.1',
  ip: '127.0.0.1',
  group: '本地连接',
  group_name: '本地连接',
  status: 'online',
  tags: ['local'],
  username: 'local',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  data_source: 'manual',
  comment: '',
  isLocalShell: true
})

const buildDirectGroups = (): WorkspaceGroup[] => {
  const source = directAssets.value
  const recentIds = new Set(['asset-1', 'asset-2'])
  const groupNames = [...new Set([...defaultDirectGroups, ...source.map((asset) => asset.group).filter(Boolean)])]
  const groups: WorkspaceGroup[] = [
    {
      key: 'recent_connections',
      title: '最近连接',
      children: source.filter((asset) => recentIds.has(asset.id)),
      originalCount: source.filter((asset) => recentIds.has(asset.id)).length,
      type: 'system',
      menu: false
    },
    ...groupNames.map((group) => {
      const children = source.filter((asset) => asset.group === group)
      return {
        key: `group-${group}`,
        title: group,
        children,
        originalCount: children.length,
        type: 'direct-group' as const,
        menu: children.length > 0,
        groupName: group
      }
    }),
    {
      key: 'local_connections',
      title: '本地连接',
      children: [createLocalShellAsset()],
      originalCount: 1,
      type: 'system',
      menu: false
    }
  ]
  return groups.filter((group) => group.children.length > 0 || group.key === 'local_connections')
}

const buildBastionGroups = (): WorkspaceGroup[] => {
  const orgGroups = organizationAssets.value.map((org) => {
    const children = [
      org,
      ...bastionResourceAssets.value.filter((asset) => !asset.folderUuid && (!asset.organizationId || asset.organizationId === org.uuid))
    ]
    return {
      key: org.uuid,
      title: org.name,
      children,
      originalCount: children.length,
      type: 'organization' as const,
      refreshable: true,
      menu: true,
      organizationId: org.uuid
    }
  })

  const folderGroups = customFolders.value.map((folder) => {
    const children = bastionResourceAssets.value.filter((asset) => asset.folderUuid === folder.uuid)
    return {
      key: folder.uuid,
      title: folder.name,
      children,
      originalCount: children.length,
      type: 'custom-folder' as const,
      refreshable: false,
      menu: true,
      folderUuid: folder.uuid
    }
  })

  return [...orgGroups, ...folderGroups]
}

const sourceGroups = computed(() => (activeWorkspace.value === 'direct' ? buildDirectGroups() : buildBastionGroups()))

const filteredGroups = computed(() => {
  const keyword = searchValue.value.trim().toLowerCase()
  if (!keyword) return sourceGroups.value
  return sourceGroups.value
    .map((group) => {
      const groupMatches = `${group.title} ${group.folderUuid || ''}`.toLowerCase().includes(keyword)
      const children = groupMatches
        ? group.children
        : group.children.filter((asset) =>
            `${asset.title} ${asset.name} ${asset.host} ${asset.ip} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
          )
      return {
        ...group,
        children
      }
    })
    .filter((group) => group.children.length > 0 || group.title.toLowerCase().includes(keyword))
})

const allAssets = computed(() => sourceGroups.value.flatMap((group) => group.children))
const contextAsset = computed(() => allAssets.value.find((asset) => asset.id === contextMenuAssetId.value) || null)
const contextGroup = computed(() => sourceGroups.value.find((group) => group.key === contextMenuGroupKey.value) || null)
const canCommentContextAsset = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell)
const canMoveContextAsset = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value && contextAsset.value.asset_type !== 'organization' && !contextAsset.value.folderUuid)
const canRemoveContextAssetFromFolder = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value?.folderUuid)
const canConnectContextAsset = computed(() => !!contextAsset.value && contextAsset.value.asset_type !== 'organization')
const hostModalTitle = computed(() => {
  if (hostModal.mode === 'edit') return '编辑主机'
  if (hostModal.mode === 'clone') return '克隆主机'
  return '新建主机'
})
const deleteAssetInfo = computed(() => workspaceAssets.value.find((asset) => asset.id === deleteAssetModal.assetId) || null)
const deleteGroupInfo = computed(() => {
  const group = sourceGroups.value.find((item) => item.key === deleteGroupModal.groupKey)
  if (!group) return null
  return {
    key: group.key,
    name: group.title,
    count: group.originalCount,
    kind: group.type
  }
})
const managedOrganization = computed(() => organizationAssets.value.find((asset) => asset.uuid === managementModal.organizationId) || null)
const managedOrganizationAssets = computed(() => {
  const keyword = managementModal.query.trim().toLowerCase()
  return bastionResourceAssets.value
    .filter((asset) => !managementModal.organizationId || asset.organizationId === managementModal.organizationId)
    .filter((asset) => {
      if (!keyword) return true
      return `${asset.name} ${asset.host} ${asset.username} ${asset.comment || ''}`.toLowerCase().includes(keyword)
    })
})

const findEditableAsset = (assetId: string) => workspaceAssets.value.find((item) => item.id === assetId) || null

const isGroupExpanded = (key: string) => !!searchValue.value.trim() || expandedGroups.value.includes(key)

const updateExpandedGroups = (next: string[]) => {
  workspace.updateWorkspacePreferences({ expandedGroups: [...new Set(next)] })
}

const toggleGroup = (key: string) => {
  const next = expandedGroups.value.includes(key)
    ? expandedGroups.value.filter((item) => item !== key)
    : [...expandedGroups.value, key]
  updateExpandedGroups(next)
}

const expandGroup = (key: string) => {
  if (!expandedGroups.value.includes(key)) {
    updateExpandedGroups([...expandedGroups.value, key])
  }
}

const removeExpandedGroup = (key: string) => {
  if (expandedGroups.value.includes(key)) {
    updateExpandedGroups(expandedGroups.value.filter((item) => item !== key))
  }
}

const replaceExpandedGroup = (oldKey: string, newKey: string) => {
  if (!expandedGroups.value.includes(oldKey)) return
  updateExpandedGroups(expandedGroups.value.map((item) => (item === oldKey ? newKey : item)))
}

const closeMenus = () => {
  addMenuOpen.value = false
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
}

const closeContextMenu = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
}

const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
  const menuWidth = 160
  const estimatedMenuHeight = 6 + menuItemCount * 30
  let left = event.clientX
  let top = event.clientY
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 5
  }
  if (top + estimatedMenuHeight > window.innerHeight) {
    top = event.clientY - estimatedMenuHeight
    if (top < 0) top = 5
  }
  contextMenuPosition.x = left
  contextMenuPosition.y = top
}

const countAssetMenuItems = (asset: WorkspaceAsset) => {
  const items = [
    asset.favorite !== undefined,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell,
    activeWorkspace.value === 'bastion' && asset.asset_type !== 'organization' && !asset.folderUuid,
    activeWorkspace.value === 'bastion' && !!asset.folderUuid,
    asset.asset_type === 'person',
    asset.asset_type !== 'organization',
    true,
    asset.asset_type !== 'organization',
    asset.asset_type === 'organization',
    asset.asset_type === 'organization',
    !asset.isLocalShell
  ]
  return items.filter(Boolean).length
}

const countGroupMenuItems = (group: WorkspaceGroup) =>
  [
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.refreshable,
    group.type === 'organization',
    group.type === 'custom-folder' || group.type === 'direct-group',
    group.type === 'organization'
  ].filter(Boolean).length

const handleAddClick = () => {
  if (activeWorkspace.value === 'direct') {
    openCreateHost()
    return
  }
  addMenuOpen.value = !addMenuOpen.value
}

const openCreateFolder = () => {
  addMenuOpen.value = false
  folderModal.visible = true
  folderModal.mode = 'create'
  folderModal.targetKey = ''
  folderModal.fromMove = false
  folderForm.name = ''
  folderForm.description = ''
  folderFormError.value = ''
}

const openCreateFolderFromMoveModal = () => {
  moveModal.visible = false
  openCreateFolder()
  folderModal.fromMove = true
}

const openCreateHost = () => {
  addMenuOpen.value = false
  hostModal.visible = true
  hostModal.mode = 'create'
  hostModal.assetId = ''
  hostForm.assetType = activeWorkspace.value === 'bastion' ? 'organization' : 'person'
  hostForm.title = ''
  hostForm.host = ''
  hostForm.username = activeWorkspace.value === 'bastion' ? 'sync' : 'root'
  hostForm.group = activeWorkspace.value === 'bastion' ? '企业' : '生产'
  hostForm.port = '22'
  hostForm.authType = activeWorkspace.value === 'bastion' ? 'keyBased' : 'password'
  hostForm.comment = ''
  hostFormError.value = ''
}

const closeFolderModal = () => {
  folderModal.visible = false
  folderModal.targetKey = ''
  folderModal.fromMove = false
  folderForm.name = ''
  folderForm.description = ''
  folderFormError.value = ''
}

const closeMoveModal = () => {
  moveModal.visible = false
  moveModal.assetId = ''
}

const closeDeleteGroupModal = () => {
  deleteGroupModal.visible = false
  deleteGroupModal.groupKey = ''
}

const closeHostModal = () => {
  hostModal.visible = false
  hostModal.assetId = ''
  hostFormError.value = ''
}

const closeDeleteAssetModal = () => {
  deleteAssetModal.visible = false
  deleteAssetModal.assetId = ''
}

const closeManagementModal = () => {
  managementModal.visible = false
  managementModal.organizationId = ''
  managementModal.query = ''
}

const createFolderUuid = () => {
  let uuid = `custom-folder-${folderCreateCounter}`
  while (customFolders.value.some((folder) => folder.uuid === uuid)) {
    folderCreateCounter += 1
    uuid = `custom-folder-${folderCreateCounter}`
  }
  folderCreateCounter += 1
  return uuid
}

const saveFolderForm = () => {
  const name = folderForm.name.trim()
  if (!name) {
    folderFormError.value = '请输入文件夹名称'
    return
  }
  const duplicateCustomFolder = customFolders.value.some((folder) => folder.name === name && folder.uuid !== folderModal.targetKey)
  if (activeWorkspace.value === 'bastion' && duplicateCustomFolder) {
    folderFormError.value = '文件夹名称已存在'
    return
  }

  if (folderModal.mode === 'create') {
    const folder = {
      uuid: createFolderUuid(),
      name,
      description: folderForm.description.trim()
    }
    customFolders.value = [...customFolders.value, folder]
    expandGroup(folder.uuid)
    notice.value = `已创建文件夹 ${folder.name}`
    closeFolderModal()
    return
  }

  if (folderModal.mode === 'edit-custom') {
    const folder = customFolders.value.find((item) => item.uuid === folderModal.targetKey)
    if (folder) {
      folder.name = name
      folder.description = folderForm.description.trim()
      notice.value = `已更新文件夹 ${folder.name}`
    }
    closeFolderModal()
    return
  }

  const oldGroupName = folderModal.targetKey.replace(/^group-/, '')
  const oldKey = `group-${oldGroupName}`
  const newKey = `group-${name}`
  workspaceAssets.value.forEach((asset) => {
    if (asset.group === oldGroupName) {
      asset.group = name
      asset.group_name = name
    }
  })
  replaceExpandedGroup(oldKey, newKey)
  notice.value = `已更新分组 ${name}`
  closeFolderModal()
}

const displayAsset = (asset: WorkspaceAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const folderNameByUuid = (folderUuid?: string) => customFolders.value.find((folder) => folder.uuid === folderUuid)?.name || ''

const toggleDisplayMode = () => {
  workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const selectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
}

const connectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset || asset.asset_type === 'organization') {
    if (asset?.asset_type === 'organization') notice.value = `${asset.name} 是堡垒机资源，请使用刷新资产或管理资产。`
    return
  }
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  workspace.registerMockSshSession(workspace.activePanelId, asset)
  workspace.appendTerminalInput(workspace.activePanelId, `aiopsterm ssh ${asset.username}@${asset.host}:${asset.port}\n`)
  workspace.appendTerminalOutput(workspace.activePanelId, `[mock ssh] ${asset.name}\n$ `)
  workspace.selectedContexts = [
    ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
    { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name }
  ]
}

const openContextMenu = (event: MouseEvent, assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  contextMenuAssetId.value = assetId
  contextMenuGroupKey.value = null
  selectedAssetId.value = assetId
  positionContextMenu(event, countAssetMenuItems(asset))
}

const openGroupContextMenu = (event: MouseEvent, groupKey: string) => {
  const group = sourceGroups.value.find((item) => item.key === groupKey)
  if (!group || !group.menu) return
  contextMenuGroupKey.value = groupKey
  contextMenuAssetId.value = null
  positionContextMenu(event, countGroupMenuItems(group))
}

const connectContextAsset = () => {
  if (contextMenuAssetId.value) connectAsset(contextMenuAssetId.value)
  closeContextMenu()
}

const toggleFavorite = () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  if (asset) {
    asset.favorite = !asset.favorite
    notice.value = asset.favorite ? `已收藏 ${asset.name}` : `已取消收藏 ${asset.name}`
  }
  closeContextMenu()
}

const openCommentEditor = (assetId: string) => {
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset) return
  commentAssetId.value = assetId
  editingComment.value = asset.comment || ''
}

const openContextComment = () => {
  if (contextMenuAssetId.value) openCommentEditor(contextMenuAssetId.value)
  closeContextMenu()
}

const saveComment = (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (asset) {
    asset.comment = editingComment.value.trim()
    notice.value = asset.comment ? `已更新备注 ${asset.comment}` : '已清空备注'
  }
  cancelComment()
}

const cancelComment = () => {
  commentAssetId.value = ''
  editingComment.value = ''
}

const toggleTunnel = () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  if (asset) {
    asset.tunnelState = asset.tunnelState === 'active' ? 'created' : 'active'
    notice.value = asset.tunnelState === 'active' ? `隧道已连接 ${asset.name}` : `隧道已创建 ${asset.name}`
  }
  closeContextMenu()
}

const openMoveModal = (assetId: string) => {
  moveModal.visible = true
  moveModal.assetId = assetId
  closeContextMenu()
}

const openMoveModalFromContext = () => {
  if (contextMenuAssetId.value) openMoveModal(contextMenuAssetId.value)
}

const moveAssetToFolder = (folderUuid: string) => {
  const asset = findEditableAsset(moveModal.assetId)
  if (!asset) return
  asset.folderUuid = folderUuid
  if (!asset.organizationId) asset.organizationId = organizationAssets.value[0]?.uuid || 'org-1'
  expandGroup(folderUuid)
  notice.value = `已移动 ${asset.name} 到 ${folderNameByUuid(folderUuid)}`
  closeMoveModal()
}

const removeAssetFromFolder = (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (!asset || !asset.folderUuid) return
  const folderName = folderNameByUuid(asset.folderUuid)
  asset.folderUuid = undefined
  if (!asset.organizationId) asset.organizationId = organizationAssets.value[0]?.uuid || 'org-1'
  if (asset.organizationId) expandGroup(asset.organizationId)
  notice.value = `已从 ${folderName} 移除 ${asset.name}`
  closeContextMenu()
}

const removeContextAssetFromFolder = () => {
  if (contextMenuAssetId.value) removeAssetFromFolder(contextMenuAssetId.value)
}

const createSyncedAssetForOrganization = (organization: WorkspaceAsset) => {
  const baseId = `synced-${organization.uuid}`
  if (workspaceAssets.value.some((asset) => asset.id === baseId)) return
  const syncedAsset: WorkspaceAsset = {
    id: baseId,
    uuid: baseId,
    name: `${organization.name}-synced-asset`,
    title: `${organization.name}-synced-asset`,
    host: organization.host === 'bastion.internal' ? '10.90.0.18' : organization.host,
    ip: organization.host === 'bastion.internal' ? '10.90.0.18' : organization.ip,
    group: '企业',
    group_name: '企业',
    status: 'online',
    tags: ['sync'],
    username: 'ops',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    comment: '刷新同步资产',
    data_source: 'refresh',
    favorite: false,
    organizationId: organization.uuid
  }
  workspaceAssets.value = [...workspaceAssets.value, syncedAsset]
}

const refreshGroup = (groupKey: string) => {
  refreshingGroupKey.value = groupKey
  notice.value = '正在刷新堡垒机资源'
  const organization = organizationAssets.value.find((asset) => asset.uuid === groupKey)
  window.setTimeout(() => {
    if (organization) {
      createSyncedAssetForOrganization(organization)
      expandGroup(organization.uuid)
    }
    refreshingGroupKey.value = ''
    notice.value = organization ? `${organization.name} 资源已刷新` : '堡垒机资源已刷新'
  }, 300)
  closeContextMenu()
}

const refreshContextOrganization = () => {
  if (contextAsset.value) refreshGroup(contextAsset.value.uuid)
}

const openManagementForOrganization = (organizationId: string) => {
  managementModal.visible = true
  managementModal.organizationId = organizationId
  managementModal.query = ''
  closeContextMenu()
}

const openContextOrganizationManagement = () => {
  if (contextAsset.value) openManagementForOrganization(contextAsset.value.uuid)
}

const openGroupOrganizationManagement = () => {
  if (contextGroup.value?.organizationId) openManagementForOrganization(contextGroup.value.organizationId)
}

const openEditGroup = () => {
  const group = contextGroup.value
  if (!group) return
  folderModal.visible = true
  folderModal.targetKey = group.key
  folderModal.mode = group.type === 'custom-folder' ? 'edit-custom' : 'edit-direct'
  folderForm.name = group.title
  folderForm.description = group.type === 'custom-folder' ? customFolders.value.find((folder) => folder.uuid === group.folderUuid)?.description || '' : ''
  folderFormError.value = ''
  closeContextMenu()
}

const openDeleteGroup = () => {
  if (!contextGroup.value) return
  deleteGroupModal.visible = true
  deleteGroupModal.groupKey = contextGroup.value.key
  closeContextMenu()
}

const openDeleteGroupOrganization = () => {
  const group = contextGroup.value
  if (!group?.organizationId) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = organizationAssets.value.find((asset) => asset.uuid === group.organizationId)?.id || ''
  closeContextMenu()
}

const confirmDeleteGroup = () => {
  const group = sourceGroups.value.find((item) => item.key === deleteGroupModal.groupKey)
  if (!group) return
  if (group.type === 'custom-folder') {
    workspaceAssets.value.forEach((asset) => {
      if (asset.folderUuid === group.folderUuid) {
        asset.folderUuid = undefined
        if (!asset.organizationId) asset.organizationId = organizationAssets.value[0]?.uuid || 'org-1'
      }
    })
    customFolders.value = customFolders.value.filter((folder) => folder.uuid !== group.folderUuid)
    removeExpandedGroup(group.key)
    notice.value = `已删除文件夹 ${group.title}`
    closeDeleteGroupModal()
    return
  }
  if (group.type === 'direct-group' && group.groupName) {
    workspaceAssets.value.forEach((asset) => {
      if (asset.group === group.groupName) {
        asset.group = '未分组'
        asset.group_name = '未分组'
      }
    })
    removeExpandedGroup(group.key)
    notice.value = `已删除分组 ${group.title}`
  }
  closeDeleteGroupModal()
}

const openHostEditor = (mode: HostModalMode, asset?: WorkspaceAsset) => {
  hostModal.visible = true
  hostModal.mode = mode
  hostModal.assetId = mode === 'create' ? '' : asset?.id || ''
  hostForm.assetType = asset?.asset_type || (activeWorkspace.value === 'bastion' ? 'organization' : 'person')
  hostForm.title = mode === 'clone' ? `${asset?.name || ''}_Clone` : asset?.name || ''
  hostForm.host = asset?.host || asset?.ip || ''
  hostForm.username = asset?.username || (activeWorkspace.value === 'bastion' ? 'sync' : 'root')
  hostForm.group = asset?.group || (activeWorkspace.value === 'bastion' ? '企业' : '生产')
  hostForm.port = String(asset?.port || 22)
  hostForm.authType = asset?.auth_type || (activeWorkspace.value === 'bastion' ? 'keyBased' : 'password')
  hostForm.comment = asset?.comment || ''
  hostFormError.value = ''
  closeContextMenu()
}

const editContextAsset = () => {
  if (!contextAsset.value || contextAsset.value.isLocalShell) return
  openHostEditor('edit', contextAsset.value)
}

const cloneContextAsset = () => {
  if (!contextAsset.value || contextAsset.value.isLocalShell) return
  openHostEditor('clone', contextAsset.value)
}

const parseHostPort = () => {
  const port = Number(hostForm.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    hostFormError.value = '端口必须是 1-65535 的整数'
    return null
  }
  return port
}

const createHostId = () => {
  let id = `workspace-asset-${hostCreateCounter}`
  while (workspaceAssets.value.some((asset) => asset.id === id)) {
    hostCreateCounter += 1
    id = `workspace-asset-${hostCreateCounter}`
  }
  hostCreateCounter += 1
  return id
}

const saveHostForm = () => {
  const title = hostForm.title.trim()
  const host = hostForm.host.trim()
  const username = hostForm.username.trim()
  const group = hostForm.group.trim() || (hostForm.assetType === 'organization' ? '企业' : '未分组')
  const port = parseHostPort()
  if (!title || !host || !username) {
    hostFormError.value = '请填写主机名、地址和用户名'
    return
  }
  if (port === null) return
  const duplicate = workspaceAssets.value.some((asset) => asset.id !== hostModal.assetId && asset.name === title)
  if (duplicate) {
    hostFormError.value = '主机名已存在'
    return
  }

  if (hostModal.mode === 'edit') {
    const asset = findEditableAsset(hostModal.assetId)
    if (!asset) return
    asset.name = title
    asset.title = title
    asset.host = host
    asset.ip = host
    asset.username = username
    asset.group = group
    asset.group_name = group
    asset.port = port
    asset.auth_type = hostForm.authType
    asset.asset_type = hostForm.assetType
    asset.comment = hostForm.comment.trim()
    asset.data_source = hostForm.assetType === 'organization' ? 'refresh' : asset.data_source
    notice.value = `已更新主机 ${asset.name}`
    closeHostModal()
    return
  }

  const id = createHostId()
  const shouldAttachOrganization = activeWorkspace.value === 'bastion' && hostForm.assetType !== 'organization'
  const sourceAsset = hostModal.mode === 'clone' ? findEditableAsset(hostModal.assetId) : null
  const asset: WorkspaceAsset = {
    id,
    uuid: id,
    name: title,
    title,
    host,
    ip: host,
    group,
    group_name: group,
    status: 'online',
    tags: hostForm.assetType === 'organization' ? ['jumpserver'] : ['ssh'],
    username,
    port,
    asset_type: hostForm.assetType,
    auth_type: hostForm.authType,
    comment: hostForm.comment.trim(),
    data_source: hostForm.assetType === 'organization' ? 'refresh' : 'manual',
    favorite: false,
    tunnelState: sourceAsset?.tunnelState,
    organizationId:
      hostForm.assetType === 'organization'
        ? undefined
        : shouldAttachOrganization
          ? organizationAssets.value[0]?.uuid || 'org-1'
          : sourceAsset?.organizationId,
    folderUuid: hostModal.mode === 'clone' && activeWorkspace.value === 'bastion' ? sourceAsset?.folderUuid : undefined
  }
  workspaceAssets.value = [...workspaceAssets.value, asset]
  expandGroup(asset.asset_type === 'organization' ? asset.uuid : asset.folderUuid || `group-${asset.group}`)
  notice.value = `${hostModal.mode === 'clone' ? '已克隆主机' : '已创建主机'} ${asset.name}`
  closeHostModal()
}

const openDeleteContextAsset = () => {
  if (!contextAsset.value || contextAsset.value.isLocalShell) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = contextAsset.value.id
  closeContextMenu()
}

const confirmDeleteAsset = () => {
  const asset = deleteAssetInfo.value
  if (!asset) return
  workspaceAssets.value = workspaceAssets.value.filter((item) => item.id !== asset.id)
  if (asset.asset_type === 'organization') {
    workspaceAssets.value.forEach((item) => {
      if (item.organizationId === asset.uuid) {
        item.organizationId = undefined
        item.folderUuid = undefined
      }
    })
    removeExpandedGroup(asset.uuid)
  }
  workspace.selectedContexts = workspace.selectedContexts.filter((context) => context.id !== asset.id)
  selectedAssetId.value = selectedAssetId.value === asset.id ? null : selectedAssetId.value
  notice.value = `已删除主机 ${asset.name}`
  closeDeleteAssetModal()
}

watch(activeWorkspace, () => {
  closeMenus()
  closeMoveModal()
  closeFolderModal()
  closeDeleteGroupModal()
  closeHostModal()
  closeDeleteAssetModal()
  closeManagementModal()
  cancelComment()
  searchValue.value = ''
  selectedAssetId.value = null
})
</script>
