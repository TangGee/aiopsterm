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
          @click="addMenuOpen = !addMenuOpen"
        >
          <Laptop v-if="activeWorkspace === 'direct'" />
          <AppWindowMac v-else />
        </button>
        <div
          v-if="addMenuOpen && activeWorkspace === 'bastion'"
          class="workspace-add-menu"
          @click.stop
        >
          <button @click="createFolder">
            <Folder />
            自定义文件夹
          </button>
          <button @click="createHost">
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
          <button
            v-for="asset in group.children"
            :key="asset.id"
            class="workspace-host-row"
            :class="{ selected: selectedAssetId === asset.id }"
            @click="selectAsset(asset.id)"
            @dblclick="connectAsset(asset.id)"
            @contextmenu.prevent="openContextMenu($event, asset.id)"
          >
            <Laptop />
            <span>{{ displayAsset(asset) }}</span>
            <small v-if="asset.comment">({{ asset.comment }})</small>
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
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="contextMenuAssetId"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button
        v-if="contextAsset?.favorite !== undefined"
        @click="toggleFavorite"
      >
        <Star />
        {{ contextAsset?.favorite ? '取消收藏' : '加入收藏' }}
      </button>
      <button
        v-if="activeWorkspace === 'bastion'"
        @click="toggleComment"
      >
        <Pencil />
        {{ contextAsset?.comment ? '编辑备注' : '添加备注' }}
      </button>
      <button
        v-if="contextAsset?.asset_type === 'person'"
        @click="toggleTunnel"
      >
        <Network />
        隧道
      </button>
      <button @click="connectContextAsset">
        <PlugZap />
        连接
      </button>
      <button @click="closeContextMenu">
        <Pencil />
        编辑
      </button>
      <button @click="closeContextMenu">
        <Copy />
        克隆
      </button>
      <button
        class="delete"
        @click="closeContextMenu"
      >
        <Trash2 />
        删除
      </button>
    </div>

    <div
      v-if="contextMenuGroupKey"
      class="asset-context-menu workspace-node-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
      @click.stop
    >
      <button @click="renameGroup">
        <Pencil />
        编辑文件夹
      </button>
      <button
        v-if="activeWorkspace === 'bastion'"
        @click="refreshGroup(contextMenuGroupKey)"
      >
        <RefreshCw />
        刷新
      </button>
      <button
        class="delete"
        @click="deleteGroup"
      >
        <Trash2 />
        删除文件夹
      </button>
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
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  Laptop,
  MoreHorizontal,
  Network,
  Pencil,
  PlugZap,
  RefreshCw,
  Repeat2,
  Search,
  Star,
  Trash2
} from 'lucide-vue-next'
import { mockAssets, type MockAsset } from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
type WorkspaceTabKey = 'direct' | 'bastion'
const workspaceTabs: Array<{ key: WorkspaceTabKey; label: string }> = [
  { key: 'direct', label: '直接连接' },
  { key: 'bastion', label: '堡垒机资源' }
]
type WorkspaceAsset = MockAsset & {
  favorite?: boolean
  tunnelState?: 'created' | 'active'
}
type WorkspaceGroup = {
  key: string
  title: string
  children: WorkspaceAsset[]
  originalCount: number
  refreshable?: boolean
  menu?: boolean
}

const activeWorkspace = ref<WorkspaceTabKey>('direct')
const searchValue = ref('')
const addMenuOpen = ref(false)
const selectedAssetId = ref<string | null>(null)
const contextMenuAssetId = ref<string | null>(null)
const contextMenuGroupKey = ref<string | null>(null)
const contextMenuPosition = reactive({ x: 0, y: 0 })
const refreshingGroupKey = ref('')
const notice = ref('')

const workspaceAssets = ref<WorkspaceAsset[]>(
  mockAssets.map((asset, index) => ({
    ...asset,
    favorite: index === 0 || asset.asset_type === 'organization',
    tunnelState: asset.id === 'asset-3' ? 'created' : asset.id === 'asset-2' ? 'active' : undefined
  }))
)

const directAssets = computed(() => workspaceAssets.value.filter((asset) => asset.asset_type === 'person'))
const bastionAssets = computed(() => workspaceAssets.value.filter((asset) => asset.asset_type === 'organization' || asset.data_source === 'refresh'))

const buildGroups = (source: WorkspaceAsset[]): WorkspaceGroup[] => {
  if (activeWorkspace.value === 'direct') {
    const recentIds = new Set(['asset-1', 'asset-2'])
    return [
      {
        key: 'recent_connections',
        title: '最近连接',
        children: source.filter((asset) => recentIds.has(asset.id)),
        originalCount: source.filter((asset) => recentIds.has(asset.id)).length,
        menu: false
      },
      ...['生产', '预发', '数据库', '维护'].map((group) => {
        const children = source.filter((asset) => asset.group === group)
        return {
          key: `group-${group}`,
          title: group,
          children,
          originalCount: children.length,
          menu: true
        }
      }),
      {
        key: 'local_connections',
        title: '本地连接',
        children: [
          {
            ...source[0],
            id: 'local-127-1',
            uuid: 'local-127-1',
            name: '127.0.0.1',
            title: '127.0.0.1',
            host: '127.0.0.1',
            ip: '127.0.0.1',
            group: '本地连接',
            group_name: '本地连接',
            comment: ''
          }
        ],
        originalCount: 1,
        menu: false
      }
    ].filter((group) => group.children.length > 0)
  }

  const orgAsset = source.find((asset) => asset.asset_type === 'organization')
  const refreshedChildren = workspaceAssets.value.filter((asset) => asset.id === 'asset-1' || asset.id === 'asset-3')
  return [
    orgAsset
      ? {
          key: orgAsset.uuid,
          title: orgAsset.name,
          children: [orgAsset],
          originalCount: 1,
          refreshable: true,
          menu: true
        }
      : null,
    {
      key: 'custom-folder-a',
      title: '核心业务',
      children: refreshedChildren,
      originalCount: refreshedChildren.length,
      refreshable: false,
      menu: true
    }
  ].filter(Boolean) as WorkspaceGroup[]
}

const sourceGroups = computed(() => buildGroups(activeWorkspace.value === 'direct' ? directAssets.value : bastionAssets.value))
const showIpMode = computed(() => workspace.workspacePreferences.showIpMode)
const expandedGroups = computed(() => workspace.workspacePreferences.expandedGroups)

const filteredGroups = computed(() => {
  const keyword = searchValue.value.trim().toLowerCase()
  if (!keyword) return sourceGroups.value
  return sourceGroups.value
    .map((group) => ({
      ...group,
      children: group.children.filter((asset) => `${asset.title} ${asset.host} ${asset.ip} ${asset.comment || ''}`.toLowerCase().includes(keyword))
    }))
    .filter((group) => group.children.length > 0 || group.title.toLowerCase().includes(keyword))
})

const allAssets = computed(() => sourceGroups.value.flatMap((group) => group.children))
const contextAsset = computed(() => allAssets.value.find((asset) => asset.id === contextMenuAssetId.value))

const toggleGroup = (key: string) => {
  const next = expandedGroups.value.includes(key)
    ? expandedGroups.value.filter((item) => item !== key)
    : [...expandedGroups.value, key]
  workspace.updateWorkspacePreferences({ expandedGroups: next })
}

const isGroupExpanded = (key: string) => !!searchValue.value.trim() || expandedGroups.value.includes(key)

const closeMenus = () => {
  addMenuOpen.value = false
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
}

const createFolder = () => {
  addMenuOpen.value = false
  notice.value = '已创建自定义文件夹占位'
}

const createHost = () => {
  addMenuOpen.value = false
  workspace.setActiveModule('assets')
}

const displayAsset = (asset: WorkspaceAsset) => (showIpMode.value ? asset.ip || asset.host : asset.name || asset.title)

const toggleDisplayMode = () => {
  workspace.updateWorkspacePreferences({ showIpMode: !showIpMode.value })
}

const selectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
}

const connectAsset = (assetId: string) => {
  selectedAssetId.value = assetId
  const asset = allAssets.value.find((item) => item.id === assetId)
  workspace.createPanel()
  if (asset) {
    workspace.renamePanel(workspace.activePanelId, asset.name)
    workspace.replaceTerminalOutput(workspace.activePanelId, '')
    workspace.appendTerminalInput(workspace.activePanelId, `aiopsterm ssh ${asset.username}@${asset.host}:${asset.port}\n`)
    workspace.appendTerminalOutput(workspace.activePanelId, `[mock ssh] ${asset.name}\n$ `)
    workspace.selectedContexts = [
      ...workspace.selectedContexts.filter((item) => item.id !== asset.id),
      { id: asset.id, kind: 'hosts', label: asset.host, detail: asset.name }
    ]
  }
}

const openContextMenu = (event: MouseEvent, assetId: string) => {
  contextMenuAssetId.value = assetId
  contextMenuGroupKey.value = null
  contextMenuPosition.x = event.clientX
  contextMenuPosition.y = event.clientY
}

const openGroupContextMenu = (event: MouseEvent, groupKey: string) => {
  contextMenuGroupKey.value = groupKey
  contextMenuAssetId.value = null
  contextMenuPosition.x = event.clientX
  contextMenuPosition.y = event.clientY
}

const closeContextMenu = () => {
  contextMenuAssetId.value = null
  contextMenuGroupKey.value = null
}

const connectContextAsset = () => {
  if (contextMenuAssetId.value) connectAsset(contextMenuAssetId.value)
  closeContextMenu()
}

const toggleFavorite = () => {
  const asset = workspaceAssets.value.find((item) => item.id === contextMenuAssetId.value)
  if (asset) asset.favorite = !asset.favorite
  closeContextMenu()
}

const toggleComment = () => {
  const asset = workspaceAssets.value.find((item) => item.id === contextMenuAssetId.value)
  if (asset) asset.comment = asset.comment ? '' : '已备注'
  closeContextMenu()
}

const toggleTunnel = () => {
  const asset = workspaceAssets.value.find((item) => item.id === contextMenuAssetId.value)
  if (asset) asset.tunnelState = asset.tunnelState === 'active' ? 'created' : 'active'
  closeContextMenu()
}

const refreshGroup = (groupKey: string) => {
  refreshingGroupKey.value = groupKey
  notice.value = '正在刷新堡垒机资源'
  window.setTimeout(() => {
    refreshingGroupKey.value = ''
    notice.value = '堡垒机资源已刷新'
  }, 300)
  closeContextMenu()
}

const renameGroup = () => {
  notice.value = '已进入文件夹编辑占位'
  closeContextMenu()
}

const deleteGroup = () => {
  notice.value = '已删除文件夹占位'
  closeContextMenu()
}

watch(activeWorkspace, () => {
  closeMenus()
  searchValue.value = ''
  selectedAssetId.value = null
})
</script>
