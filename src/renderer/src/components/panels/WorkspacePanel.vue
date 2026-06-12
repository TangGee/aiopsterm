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
        v-if="contextAsset.asset_type === 'person' && !contextAsset.isLocalShell"
        @click="toggleTunnel"
      >
        <Network />
        {{ contextAsset.tunnelState === 'active' ? '停止隧道' : '隧道' }}
      </button>
      <button
        v-if="canConnectContextAsset"
        @click="connectContextAsset"
      >
        <PlugZap />
        连接
      </button>
      <button
        v-if="!contextAsset.isLocalShell"
        @click="editContextAsset"
      >
        <Pencil />
        编辑
      </button>
      <button
        v-if="contextAsset.asset_type !== 'organization' && !contextAsset.isLocalShell"
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
        v-if="!contextAsset.isLocalShell"
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
          <label v-if="hostForm.authType === 'password'">
            <span>密码</span>
            <input
              v-model="hostForm.password"
              type="password"
              placeholder="留空则保留已保存密码"
            />
          </label>
          <label
            v-else
            class="workspace-host-form-wide"
          >
            <span>私钥</span>
            <textarea
              v-model="hostForm.privateKey"
              rows="4"
              placeholder="留空则使用 SSH Agent 或已保存私钥"
            />
          </label>
          <label>
            <span>分组</span>
            <input
              v-model="hostForm.group"
              list="workspace-host-group-options"
              placeholder="请输入分组"
            />
            <datalist id="workspace-host-group-options">
              <option
                v-for="group in hostGroupOptions"
                :key="group.key"
                :value="group.name"
              />
            </datalist>
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
          <p
            v-if="hostTestMessage"
            class="files-folder-error workspace-host-form-wide asset-connection-test-result"
            :class="{ success: hostTestOk }"
          >
            {{ hostTestMessage }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              data-testid="workspace-host-test-connection"
              :disabled="hostTestLoading"
              @click="testHostFormConnection"
            >
              {{ hostTestLoading ? '测试中' : '测试连接' }}
            </button>
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
      v-if="tunnelModal.visible && tunnelAsset"
      class="files-folder-modal-backdrop"
      @click.self="closeTunnelModal"
    >
      <section class="files-folder-modal workspace-tunnel-modal">
        <header>
          <h3>隧道 · {{ tunnelAsset.name }}</h3>
          <button
            type="button"
            @click="closeTunnelModal"
          >
            <X />
          </button>
        </header>
        <form
          class="workspace-tunnel-form files-folder-form"
          @submit.prevent="startTunnelFromModal"
        >
          <div class="workspace-tunnel-type-grid">
            <label
              v-for="option in tunnelTypeOptions"
              :key="option.value"
              class="workspace-tunnel-type-card"
              :class="{ selected: tunnelForm.type === option.value }"
            >
              <input
                v-model="tunnelForm.type"
                type="radio"
                name="workspace-tunnel-type"
                :value="option.value"
              />
              <span>{{ option.label }}</span>
              <small>{{ option.description }}</small>
            </label>
          </div>
          <label>
            <span>{{ tunnelForm.type === 'remote_forward' ? '本地服务端口 *' : '本地监听端口 *' }}</span>
            <input
              v-model="tunnelForm.localPort"
              data-testid="workspace-tunnel-local-port"
              inputmode="numeric"
              placeholder="3306"
            />
          </label>
          <label v-if="tunnelForm.type !== 'dynamic_socks'">
            <span>远端主机</span>
            <input
              v-model="tunnelForm.remoteHost"
              data-testid="workspace-tunnel-remote-host"
              placeholder="localhost"
            />
          </label>
          <label v-if="tunnelForm.type !== 'dynamic_socks'">
            <span>{{ tunnelForm.type === 'remote_forward' ? '远端监听端口 *' : '远端服务端口 *' }}</span>
            <input
              v-model="tunnelForm.remotePort"
              data-testid="workspace-tunnel-remote-port"
              inputmode="numeric"
              placeholder="3306"
            />
          </label>
          <p
            v-if="tunnelFormError"
            class="files-folder-error"
          >
            {{ tunnelFormError }}
          </p>
          <footer>
            <button
              type="button"
              @click="closeTunnelModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
              :disabled="tunnelSubmitting"
            >
              {{ tunnelSubmitting ? '启动中' : '启动隧道' }}
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
import type {
  AiopsAssetAuthType,
  AiopsAssetGroupRecord,
  AiopsAssetInput,
  AiopsAssetRecord,
  AiopsAssetType,
  AiopsCustomFolderRecord,
  AiopsCustomFolderSaveInput,
  AiopsSshTunnelMutationResult,
  AiopsSshTunnelType
} from '@shared/preload'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  isAiopsAssetConnectionTestInfo,
  isAiopsAssetGroupDeleteSnapshot,
  isAiopsAssetGroupListData,
  isAiopsAssetGroupRenameSnapshot,
  isAiopsAssetSnapshot,
  isAiopsDeletedAssetData,
  isAiopsDeletedCustomFolderData,
  isAiopsOrganizationAssetRefreshData,
  isAiopsSavedAssetRecord,
  isAiopsSavedCustomFolderRecord,
  isAiopsSshTunnelMutationData,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'

const workspace = useWorkspaceStore()
type WorkspaceTabKey = 'direct' | 'bastion'
type HostModalMode = 'create' | 'edit' | 'clone'
type FolderModalMode = 'create' | 'edit-custom' | 'edit-direct'
type WorkspaceAssetType = AiopsAssetType
type WorkspaceTunnelType = AiopsSshTunnelType

const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
  { key: 'direct', label: '直接连接' },
  { key: 'bastion', label: '堡垒机资源' }
]

type WorkspaceAsset = AiopsAssetRecord & {
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

type CustomFolder = AiopsCustomFolderRecord

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
const assetBackendReady = ref(false)

const workspaceAssets = ref<WorkspaceAsset[]>([])

const customFolders = ref<CustomFolder[]>([])
const directGroupOptions = ref<AiopsAssetGroupRecord[]>([])

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
  authType: 'password' as AiopsAssetAuthType,
  comment: '',
  password: '',
  privateKey: '',
  passphrase: ''
})
const hostFormError = ref('')
const hostTestLoading = ref(false)
const hostTestMessage = ref('')
const hostTestOk = ref(false)
const deleteAssetModal = reactive({ visible: false, assetId: '' })
const managementModal = reactive({ visible: false, organizationId: '', query: '' })
const tunnelModal = reactive({ visible: false, assetId: '' })
const tunnelForm = reactive({
  type: 'local_forward' as WorkspaceTunnelType,
  localPort: '3306',
  remoteHost: 'localhost',
  remotePort: '3306'
})
const tunnelFormError = ref('')
const tunnelSubmitting = ref(false)

const localShellAssets = computed(() => workspaceAssets.value.filter((asset) => asset.isLocalShell))
const directAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && (asset.asset_type === 'person' || asset.asset_type === 'switch')))
const organizationAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type === 'organization'))
const bastionResourceAssets = computed(() => workspaceAssets.value.filter((asset) => !asset.isLocalShell && asset.asset_type !== 'organization' && (asset.organizationId || asset.folderUuid)))
const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)
const firstDirectGroupName = computed(() => directGroupOptions.value[0]?.name || '')
const hostGroupOptions = computed(() =>
  activeWorkspace.value === 'direct' ? directGroupOptions.value : [{ key: 'group-enterprise', name: '企业', count: organizationAssets.value.length }]
)

const buildDirectGroups = (): WorkspaceGroup[] => {
  const source = directAssets.value
  const localAssets = localShellAssets.value
  const recentIds = new Set(['asset-1', 'asset-2'])
  const groupNames = [...new Set(source.map((asset) => asset.group || asset.group_name).filter(Boolean))]
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
      const children = source.filter((asset) => (asset.group || asset.group_name) === group)
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
      children: localAssets,
      originalCount: localAssets.length,
      type: 'system',
      menu: false
    }
  ]
  return groups.filter((group) => group.children.length > 0)
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
const canMoveContextAsset = computed(
  () => activeWorkspace.value === 'bastion' && !!contextAsset.value && !contextAsset.value.isLocalShell && contextAsset.value.asset_type !== 'organization' && !contextAsset.value.folderUuid
)
const canRemoveContextAssetFromFolder = computed(() => activeWorkspace.value === 'bastion' && !!contextAsset.value?.folderUuid && !contextAsset.value.isLocalShell)
const canConnectContextAsset = computed(() => !!contextAsset.value && contextAsset.value.asset_type !== 'organization')
const tunnelAsset = computed(() => findEditableAsset(tunnelModal.assetId))
const hostModalTitle = computed(() => {
  if (hostModal.mode === 'edit') return '编辑主机'
  if (hostModal.mode === 'clone') return '克隆主机'
  return '新建主机'
})
const tunnelTypeOptions: Array<{ value: WorkspaceTunnelType; label: string; description: string }> = [
  {
    value: 'local_forward',
    label: '访问远端服务',
    description: '把远端服务映射成本机端口'
  },
  {
    value: 'remote_forward',
    label: '暴露本地服务',
    description: '把本地端口暴露到远端主机'
  },
  {
    value: 'dynamic_socks',
    label: '动态 SOCKS',
    description: '在本机启动 SOCKS5 代理'
  }
]
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

const toAssetInput = (asset: WorkspaceAsset, patch: Partial<AiopsAssetInput> = {}): AiopsAssetInput => ({
  id: asset.id,
  name: asset.name,
  title: asset.title,
  host: asset.host,
  ip: asset.ip,
  group: asset.group,
  group_name: asset.group_name,
  status: asset.status,
  username: asset.username,
  port: asset.port,
  asset_type: asset.asset_type,
  auth_type: asset.auth_type,
  comment: asset.comment,
  data_source: asset.data_source,
  tags: [...asset.tags],
  favorite: asset.favorite,
  folderUuid: asset.folderUuid,
  organizationId: asset.organizationId,
  tunnelState: asset.tunnelState,
  needProxy: asset.needProxy,
  proxyName: asset.proxyName,
  ...patch
})

const applyWorkspaceAssetSnapshot = (snapshot: unknown) => {
  if (!isAiopsAssetSnapshot(snapshot)) return false
  workspaceAssets.value = snapshot.assets.map((asset) => ({ ...asset, tags: [...asset.tags] }))
  customFolders.value = snapshot.folders.map((folder) => ({ ...folder }))
  assetBackendReady.value = true
  return true
}

const loadDirectGroupOptions = async () => {
  const listAssetGroups = window.aiops?.listAssetGroups
  if (typeof listAssetGroups !== 'function') throw new Error('资产分组服务不可用')
  const groups = await listAssetGroups({
    assetTypes: ['person', 'switch']
  })
  if (!isAiopsAssetGroupListData(groups)) throw new Error(malformedAssetBackendResultMessage)
  return groups.map((group) => ({ ...group }))
}

const refreshDirectGroupOptions = async () => {
  directGroupOptions.value = await loadDirectGroupOptions()
}

const refreshAssets = async () => {
  const listAssets = window.aiops?.listAssets
  if (typeof listAssets !== 'function') throw new Error('资产列表服务不可用')
  const snapshot = await listAssets()
  if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
  const groups = await loadDirectGroupOptions()
  applyWorkspaceAssetSnapshot(snapshot)
  directGroupOptions.value = groups
  return snapshot
}

const resetHostConnectionTest = () => {
  hostTestLoading.value = false
  hostTestMessage.value = ''
  hostTestOk.value = false
}

const saveAssetRecord = async (input: AiopsAssetInput) => {
  const saveAsset = window.aiops?.saveAsset
  if (typeof saveAsset !== 'function') {
    throw new Error('资产保存服务不可用')
  }
  const result = await saveAsset(input)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产保存失败')
  const saved = result.data
  if (!isAiopsSavedAssetRecord(saved, input)) throw new Error(malformedAssetBackendResultMessage)
  const snapshot = await refreshAssets()
  if (!snapshot.assets.some((asset) => asset.id === saved.id)) throw new Error(malformedAssetBackendResultMessage)
  return saved
}

const deleteAssetRecord = async (assetId: string) => {
  const deleteAsset = window.aiops?.deleteAsset
  if (typeof deleteAsset !== 'function') throw new Error('资产删除服务不可用')
  const result = await deleteAsset(assetId)
  if (!result?.ok) throw new Error(result?.errorMessage || '资产删除失败')
  if (!isAiopsDeletedAssetData(result.data, assetId)) throw new Error(malformedAssetBackendResultMessage)
  const snapshot = await refreshAssets()
  if (snapshot.assets.some((asset) => asset.id === assetId)) throw new Error(malformedAssetBackendResultMessage)
}

const saveFolderRecord = async (folder: AiopsCustomFolderSaveInput) => {
  const saveAssetFolder = window.aiops?.saveAssetFolder
  if (typeof saveAssetFolder !== 'function') throw new Error('文件夹保存服务不可用')
  const result = await saveAssetFolder(folder)
  if (!result?.ok) throw new Error(result?.errorMessage || '文件夹保存失败')
  const saved = result.data
  if (!isAiopsSavedCustomFolderRecord(saved, folder)) throw new Error(malformedAssetBackendResultMessage)
  const snapshot = await refreshAssets()
  if (!snapshot.folders.some((item) => item.uuid === saved.uuid)) throw new Error(malformedAssetBackendResultMessage)
  return saved
}

const deleteFolderRecord = async (folderUuid: string) => {
  const deleteAssetFolder = window.aiops?.deleteAssetFolder
  if (typeof deleteAssetFolder !== 'function') throw new Error('文件夹删除服务不可用')
  const result = await deleteAssetFolder(folderUuid)
  if (!result?.ok) throw new Error(result?.errorMessage || '文件夹删除失败')
  if (!isAiopsDeletedCustomFolderData(result.data, folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  const snapshot = await refreshAssets()
  if (snapshot.folders.some((folder) => folder.uuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
  if (snapshot.assets.some((asset) => asset.folderUuid === folderUuid)) throw new Error(malformedAssetBackendResultMessage)
}

const isGroupExpanded = (key: string) => !!searchValue.value.trim() || expandedGroups.value.includes(key)

const updateExpandedGroups = (next: string[]) => workspace.updateWorkspacePreferences({ expandedGroups: [...new Set(next)] })

const toggleGroup = async (key: string) => {
  const next = expandedGroups.value.includes(key)
    ? expandedGroups.value.filter((item) => item !== key)
    : [...expandedGroups.value, key]
  await updateExpandedGroups(next)
}

const expandGroup = async (key: string) => {
  if (!expandedGroups.value.includes(key)) {
    return updateExpandedGroups([...expandedGroups.value, key])
  }
  return true
}

const removeExpandedGroup = async (key: string) => {
  if (expandedGroups.value.includes(key)) {
    return updateExpandedGroups(expandedGroups.value.filter((item) => item !== key))
  }
  return true
}

const replaceExpandedGroup = async (oldKey: string, newKey: string) => {
  if (!expandedGroups.value.includes(oldKey)) return true
  return updateExpandedGroups(expandedGroups.value.map((item) => (item === oldKey ? newKey : item)))
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
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && asset.asset_type !== 'organization' && !asset.folderUuid,
    activeWorkspace.value === 'bastion' && !asset.isLocalShell && !!asset.folderUuid,
    asset.asset_type === 'person' && !asset.isLocalShell,
    true,
    !asset.isLocalShell,
    asset.asset_type !== 'organization' && !asset.isLocalShell,
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
  hostForm.group = activeWorkspace.value === 'bastion' ? '企业' : firstDirectGroupName.value
  hostForm.port = '22'
  hostForm.authType = activeWorkspace.value === 'bastion' ? 'keyBased' : 'password'
  hostForm.comment = ''
  hostForm.password = ''
  hostForm.privateKey = ''
  hostForm.passphrase = ''
  hostFormError.value = ''
  resetHostConnectionTest()
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
  hostForm.password = ''
  hostForm.privateKey = ''
  hostForm.passphrase = ''
  hostFormError.value = ''
  resetHostConnectionTest()
}

const resetTunnelForm = (type: WorkspaceTunnelType = 'local_forward') => {
  tunnelForm.type = type
  tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
  tunnelForm.remoteHost = 'localhost'
  tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
  tunnelFormError.value = ''
  tunnelSubmitting.value = false
}

const closeTunnelModal = () => {
  tunnelModal.visible = false
  tunnelModal.assetId = ''
  resetTunnelForm()
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

const saveFolderForm = async () => {
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
      name,
      description: folderForm.description.trim()
    }
    try {
      const saved = await saveFolderRecord(folder)
      await expandGroup(saved.uuid)
      notice.value = `已创建文件夹 ${saved.name}`
      closeFolderModal()
    } catch (error) {
      folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
    }
    return
  }

  if (folderModal.mode === 'edit-custom') {
    const folder = customFolders.value.find((item) => item.uuid === folderModal.targetKey)
    if (folder) {
      try {
        const saved = await saveFolderRecord({ ...folder, name, description: folderForm.description.trim() })
        notice.value = `已更新文件夹 ${saved.name}`
      } catch (error) {
        folderFormError.value = error instanceof Error ? error.message : '文件夹保存失败'
        return
      }
    }
    closeFolderModal()
    return
  }

  const oldGroupName = folderModal.targetKey.replace(/^group-/, '')
  const oldKey = `group-${oldGroupName}`
  const newKey = `group-${name}`
  const input = {
    oldName: oldGroupName,
    newName: name,
    assetTypes: ['person' as const, 'switch' as const]
  }
  try {
    const renameAssetGroup = window.aiops?.renameAssetGroup
    if (typeof renameAssetGroup !== 'function') throw new Error('资产分组保存服务不可用')
    const result = await renameAssetGroup(input)
    if (!result?.ok) throw new Error(result?.errorMessage || '分组保存失败')
    if (!isAiopsAssetGroupRenameSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
    applyWorkspaceAssetSnapshot(result.data)
    await refreshDirectGroupOptions()
    await replaceExpandedGroup(oldKey, newKey)
    notice.value = `已更新分组 ${name}`
    closeFolderModal()
  } catch (error) {
    folderFormError.value = error instanceof Error ? error.message : '分组保存失败'
  }
}

const displayAsset = (asset: WorkspaceAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const folderNameByUuid = (folderUuid?: string) => customFolders.value.find((folder) => folder.uuid === folderUuid)?.name || ''

const toggleDisplayMode = async () => {
  await workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const selectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
}

const connectAsset = async (assetId: string) => {
  selectedAssetId.value = assetId
  const asset = allAssets.value.find((item) => item.id === assetId)
  if (!asset || asset.asset_type === 'organization') {
    if (asset?.asset_type === 'organization') notice.value = `${asset.name} 是堡垒机资源，请使用刷新资产或管理资产。`
    return
  }
  const previousActivePanelId = workspace.activePanelId
  workspace.createPanel()
  workspace.renamePanel(workspace.activePanelId, asset.name)
  workspace.replaceTerminalOutput(workspace.activePanelId, '')
  const panelId = workspace.activePanelId
  const discardPendingPanel = () => workspace.discardPendingTerminalPanel(panelId, previousActivePanelId)
  if (asset.isLocalShell) {
    if (!window.aiops?.createTerminal) {
      notice.value = '本地终端启动服务不可用'
      discardPendingPanel()
      return
    }
    try {
      const session = await window.aiops.createTerminal({
        kind: 'local',
        title: asset.name,
        cols: 100,
        rows: 30
      })
      const panel = workspace.applyLocalTerminalSession(panelId, session)
      if (!panel) {
        notice.value = '本地终端启动失败'
        discardPendingPanel()
        return
      }
      workspace.renamePanel(panelId, asset.name)
      notice.value = `已打开本地 shell ${asset.host}`
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '本地终端启动失败'
      discardPendingPanel()
      return
    }
  } else {
    if (!window.aiops?.createTerminal) {
      notice.value = 'SSH 终端启动服务不可用'
      discardPendingPanel()
      return
    }
    workspace.registerSshSession(panelId, asset)
    try {
      const session = await window.aiops.createTerminal({
        kind: 'ssh',
        assetId: asset.id,
        title: asset.name,
        cols: 100,
        rows: 30
      })
      const connected = Boolean(workspace.applySshTerminalSession(panelId, session, asset))
      if (!connected) {
        notice.value = 'SSH 终端启动失败'
        discardPendingPanel()
        return
      }
    } catch (error) {
      notice.value = error instanceof Error ? error.message : 'SSH 终端启动失败'
      discardPendingPanel()
      return
    }
  }
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

const toggleFavorite = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  if (asset) {
    const nextFavorite = !Boolean(asset.favorite)
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { favorite: nextFavorite }))
      notice.value = saved.favorite ? `已收藏 ${saved.name}` : `已取消收藏 ${saved.name}`
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '收藏状态保存失败'
    }
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

const saveComment = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (asset) {
    const nextComment = editingComment.value.trim()
    try {
      const saved = await saveAssetRecord(toAssetInput(asset, { comment: nextComment }))
      notice.value = saved.comment ? `已更新备注 ${saved.comment}` : '已清空备注'
      cancelComment()
    } catch (error) {
      notice.value = error instanceof Error ? error.message : '备注保存失败'
    }
    return
  }
  cancelComment()
}

const cancelComment = () => {
  commentAssetId.value = ''
  editingComment.value = ''
}

const applyTunnelResult = (result: AiopsSshTunnelMutationResult, fallbackMessage: string) => {
  if (!result.ok) throw new Error(result.errorMessage || fallbackMessage)
  if (!isAiopsSshTunnelMutationData(result.data)) throw new Error(malformedAssetBackendResultMessage)
  applyWorkspaceAssetSnapshot(result.data)
  notice.value = result.data.message || fallbackMessage
}

const parseTunnelPort = (value: string, label: string) => {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    tunnelFormError.value = `${label}必须是 1-65535 的整数`
    return null
  }
  return port
}

const openTunnelModal = (asset: WorkspaceAsset) => {
  tunnelModal.visible = true
  tunnelModal.assetId = asset.id
  resetTunnelForm('local_forward')
}

const toggleTunnel = async () => {
  const asset = findEditableAsset(contextMenuAssetId.value || '')
  closeContextMenu()
  if (!asset) return
  try {
    if (asset.tunnelState === 'active') {
      const stopTunnel = window.aiops?.stopSshTunnel
      if (typeof stopTunnel !== 'function') {
        notice.value = '隧道运行时服务不可用'
        return
      }
      applyTunnelResult(await stopTunnel({ assetId: asset.id }), '隧道停止失败')
      return
    }
    openTunnelModal(asset)
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '隧道运行失败'
  }
}

const startTunnelFromModal = async () => {
  const asset = tunnelAsset.value
  if (!asset) {
    tunnelFormError.value = '隧道主机不存在'
    return
  }
  const startTunnel = window.aiops?.startSshTunnel
  if (typeof startTunnel !== 'function') {
    tunnelFormError.value = '隧道运行时服务不可用'
    return
  }
  const localPort = parseTunnelPort(tunnelForm.localPort, tunnelForm.type === 'remote_forward' ? '本地服务端口' : '本地监听端口')
  if (localPort === null) return
  const remotePort =
    tunnelForm.type === 'dynamic_socks'
      ? undefined
      : parseTunnelPort(tunnelForm.remotePort, tunnelForm.type === 'remote_forward' ? '远端监听端口' : '远端服务端口')
  if (remotePort === null) return
  const remoteHost = tunnelForm.remoteHost.trim() || 'localhost'
  tunnelSubmitting.value = true
  tunnelFormError.value = ''
  try {
    applyTunnelResult(
      await startTunnel({
        assetId: asset.id,
        type: tunnelForm.type,
        localPort,
        ...(tunnelForm.type === 'dynamic_socks' ? {} : { remoteHost, remotePort })
      }),
      '隧道连接失败'
    )
    closeTunnelModal()
  } catch (error) {
    tunnelFormError.value = error instanceof Error ? error.message : '隧道连接失败'
  } finally {
    tunnelSubmitting.value = false
  }
}

const openMoveModal = (assetId: string) => {
  moveModal.visible = true
  moveModal.assetId = assetId
  closeContextMenu()
}

const openMoveModalFromContext = () => {
  if (contextMenuAssetId.value) openMoveModal(contextMenuAssetId.value)
}

const moveAssetToFolder = async (folderUuid: string) => {
  const asset = findEditableAsset(moveModal.assetId)
  if (!asset) return
  try {
    await saveAssetRecord(toAssetInput(asset, { folderUuid, organizationId: asset.organizationId || organizationAssets.value[0]?.uuid }))
    await expandGroup(folderUuid)
    notice.value = `已移动 ${asset.name} 到 ${folderNameByUuid(folderUuid)}`
    closeMoveModal()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移动资产失败'
  }
}

const removeAssetFromFolder = async (assetId: string) => {
  const asset = findEditableAsset(assetId)
  if (!asset || !asset.folderUuid) return
  const folderName = folderNameByUuid(asset.folderUuid)
  try {
    await saveAssetRecord(toAssetInput(asset, { folderUuid: undefined, organizationId: asset.organizationId || organizationAssets.value[0]?.uuid }))
    if (asset.organizationId) await expandGroup(asset.organizationId)
    notice.value = `已从 ${folderName} 移除 ${asset.name}`
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '移除资产失败'
  }
  closeContextMenu()
}

const removeContextAssetFromFolder = () => {
  if (contextMenuAssetId.value) removeAssetFromFolder(contextMenuAssetId.value)
}

const refreshGroup = async (groupKey: string) => {
  refreshingGroupKey.value = groupKey
  notice.value = '正在刷新堡垒机资源'
  const organization = organizationAssets.value.find((asset) => asset.uuid === groupKey)
  try {
    const expectedOrganizationId = organization?.id
    const refreshOrganizationAssets = window.aiops?.refreshOrganizationAssets
    if (typeof refreshOrganizationAssets !== 'function') throw new Error('组织资产刷新服务不可用')
    const result = await refreshOrganizationAssets(expectedOrganizationId ? { organizationId: expectedOrganizationId } : undefined)
    if (!result?.ok) throw new Error(result?.errorMessage || '刷新堡垒机资源失败')
    if (!isAiopsOrganizationAssetRefreshData(result.data, expectedOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
    applyWorkspaceAssetSnapshot(result.data)
    await refreshDirectGroupOptions()
    if (organization) await expandGroup(organization.uuid)
    notice.value = organization ? `${organization.name} 资源已刷新` : '堡垒机资源已刷新'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '刷新堡垒机资源失败'
  } finally {
    refreshingGroupKey.value = ''
    closeContextMenu()
  }
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
    deleteFolderRecord(group.folderUuid || group.key)
      .then(async () => {
        await removeExpandedGroup(group.key)
        notice.value = `已删除文件夹 ${group.title}`
        closeDeleteGroupModal()
      })
      .catch((error) => {
        notice.value = error instanceof Error ? error.message : '删除文件夹失败'
      })
    return
  }
  if (group.type === 'direct-group' && group.groupName) {
    const deleteAssetGroup = window.aiops?.deleteAssetGroup
    if (typeof deleteAssetGroup !== 'function') {
      notice.value = '资产分组删除服务不可用'
      return
    }
    const input = {
      name: group.groupName,
      fallbackName: '未分组',
      assetTypes: ['person' as const, 'switch' as const]
    }
    deleteAssetGroup(input)
      .then(async (result) => {
        if (!result?.ok) throw new Error(result?.errorMessage || '删除分组失败')
        if (!isAiopsAssetGroupDeleteSnapshot(result.data, input)) throw new Error(malformedAssetBackendResultMessage)
        applyWorkspaceAssetSnapshot(result.data)
        await refreshDirectGroupOptions()
        await removeExpandedGroup(group.key)
        notice.value = `已删除分组 ${group.title}`
        closeDeleteGroupModal()
      })
      .catch((error) => {
        notice.value = error instanceof Error ? error.message : '删除分组失败'
      })
    return
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
  hostForm.group = asset?.group || (activeWorkspace.value === 'bastion' ? '企业' : firstDirectGroupName.value)
  hostForm.port = String(asset?.port || 22)
  hostForm.authType = asset?.auth_type || (activeWorkspace.value === 'bastion' ? 'keyBased' : 'password')
  hostForm.comment = asset?.comment || ''
  hostForm.password = ''
  hostForm.privateKey = ''
  hostForm.passphrase = ''
  hostFormError.value = ''
  resetHostConnectionTest()
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

const buildHostInput = (id: string | undefined, port: number, sourceAsset?: WorkspaceAsset): AiopsAssetInput => {
  const shouldAttachOrganization = activeWorkspace.value === 'bastion' && hostForm.assetType !== 'organization'
  const group = hostForm.group.trim() || (hostForm.assetType === 'organization' ? '企业' : undefined)
  const title = hostForm.title.trim() || hostForm.host.trim()
  return {
    ...(id ? { id } : {}),
    name: title,
    title,
    host: hostForm.host.trim(),
    ip: hostForm.host.trim(),
    username: hostForm.username.trim(),
    ...(group ? { group, group_name: group } : {}),
    port,
    asset_type: hostForm.assetType,
    auth_type: hostForm.authType,
    comment: hostForm.comment.trim(),
    data_source: hostForm.assetType === 'organization' ? 'refresh' : sourceAsset?.data_source || 'manual',
    tags: hostForm.assetType === 'organization' ? ['jumpserver'] : ['ssh'],
    favorite: sourceAsset?.favorite ?? false,
    tunnelState: sourceAsset?.tunnelState,
    organizationId:
      hostForm.assetType === 'organization'
        ? undefined
        : shouldAttachOrganization
          ? organizationAssets.value[0]?.uuid || sourceAsset?.organizationId
          : sourceAsset?.organizationId,
    folderUuid: hostModal.mode === 'clone' && activeWorkspace.value === 'bastion' ? sourceAsset?.folderUuid : sourceAsset?.folderUuid,
    ...(hostForm.password.trim() ? { password: hostForm.password } : {}),
    ...(hostForm.privateKey.trim() ? { privateKey: hostForm.privateKey } : {}),
    ...(hostForm.passphrase.trim() ? { passphrase: hostForm.passphrase } : {})
  }
}

const validateHostConnectionDraft = () => {
  const host = hostForm.host.trim()
  const username = hostForm.username.trim()
  const port = parseHostPort()
  if (!host || !username) {
    hostFormError.value = '请填写地址和用户名'
    return null
  }
  if (port === null) return null
  return port
}

const testHostFormConnection = async () => {
  const testAssetConnection = window.aiops?.testAssetConnection
  if (typeof testAssetConnection !== 'function') {
    hostTestOk.value = false
    hostTestMessage.value = '连接测试服务不可用'
    return
  }
  const port = validateHostConnectionDraft()
  if (port === null) return
  const sourceAsset = hostModal.mode === 'create' ? null : findEditableAsset(hostModal.assetId)
  hostTestLoading.value = true
  hostTestMessage.value = '正在测试连接...'
  hostTestOk.value = false
  try {
    const result = await testAssetConnection({
      ...(sourceAsset ? { assetId: sourceAsset.id } : {}),
      asset: buildHostInput(sourceAsset?.id, port, sourceAsset || undefined)
    })
    if (!result?.ok || !result.data) {
      throw new Error(result?.errorMessage || '连接测试失败')
    }
    if (!isAiopsAssetConnectionTestInfo(result.data)) {
      throw new Error(malformedAssetBackendResultMessage)
    }
    hostTestOk.value = true
    hostTestMessage.value = `连接成功 ${result.data.endpoint} · ${result.data.durationMs}ms`
  } catch (error) {
    hostTestOk.value = false
    hostTestMessage.value = error instanceof Error ? error.message : '连接测试失败'
  } finally {
    hostTestLoading.value = false
  }
}

const saveHostForm = async () => {
  const title = hostForm.title.trim()
  const host = hostForm.host.trim()
  const username = hostForm.username.trim()
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
    try {
      const saved = await saveAssetRecord(buildHostInput(asset.id, port, asset))
      notice.value = `已更新主机 ${saved.name}`
      closeHostModal()
    } catch (error) {
      hostFormError.value = error instanceof Error ? error.message : '主机保存失败'
    }
    return
  }

  const sourceAsset = hostModal.mode === 'clone' ? findEditableAsset(hostModal.assetId) : null
  try {
    const saved = await saveAssetRecord(buildHostInput(undefined, port, sourceAsset || undefined))
    await expandGroup(saved.asset_type === 'organization' ? saved.uuid : saved.folderUuid || `group-${saved.group}`)
    notice.value = `${hostModal.mode === 'clone' ? '已克隆主机' : '已创建主机'} ${saved.name}`
    closeHostModal()
  } catch (error) {
    hostFormError.value = error instanceof Error ? error.message : '主机保存失败'
  }
}

const openDeleteContextAsset = () => {
  if (!contextAsset.value || contextAsset.value.isLocalShell) return
  deleteAssetModal.visible = true
  deleteAssetModal.assetId = contextAsset.value.id
  closeContextMenu()
}

const confirmDeleteAsset = async () => {
  const asset = deleteAssetInfo.value
  if (!asset) return
  try {
    await deleteAssetRecord(asset.id)
    if (asset.asset_type === 'organization') await removeExpandedGroup(asset.uuid)
    workspace.selectedContexts = workspace.selectedContexts.filter((context) => context.id !== asset.id)
    selectedAssetId.value = selectedAssetId.value === asset.id ? null : selectedAssetId.value
    notice.value = `已删除主机 ${asset.name}`
    closeDeleteAssetModal()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '删除主机失败'
  }
}

onMounted(() => {
  refreshAssets().catch((error) => {
    notice.value = error instanceof Error ? error.message : '资产加载失败'
  })
})

watch(activeWorkspace, () => {
  closeMenus()
  closeMoveModal()
  closeFolderModal()
  closeDeleteGroupModal()
  closeHostModal()
  closeTunnelModal()
  closeDeleteAssetModal()
  closeManagementModal()
  cancelComment()
  searchValue.value = ''
  selectedAssetId.value = null
})

watch(
  () => tunnelForm.type,
  (type, previousType) => {
    if (!tunnelModal.visible || type === previousType) return
    tunnelForm.localPort = type === 'dynamic_socks' ? '1080' : '3306'
    tunnelForm.remoteHost = 'localhost'
    tunnelForm.remotePort = type === 'dynamic_socks' ? '' : '3306'
    tunnelFormError.value = ''
  }
)
</script>
