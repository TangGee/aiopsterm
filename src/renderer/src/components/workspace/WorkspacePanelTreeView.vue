<template>
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
  </div>

  <div
    class="workspace-tree"
    @contextmenu.prevent="openBlankContextMenu"
    @dragover.prevent="handleBlankDragOver"
    @dragleave="handleBlankDragLeave"
    @drop.prevent="handleBlankDrop"
  >
    <template
      v-for="row in visibleTreeRows"
      :key="row.key"
    >
      <button
        v-if="row.kind === 'group'"
        class="workspace-folder-row"
        :class="{ 'custom-folder': row.group.type === 'custom-folder' || row.group.type === 'direct-group', 'drag-over': dragOverGroupKey === row.group.key }"
        :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
        :draggable="canDragGroup(row.group)"
        @click="toggleGroup(row.group.key)"
        @contextmenu.prevent.stop="openGroupContextMenu($event, row.group.key)"
        @dragstart="handleGroupDragStart($event, row.group)"
        @dragover.prevent.stop="handleGroupDragOver($event, row.group)"
        @dragleave="handleGroupDragLeave(row.group.key)"
        @drop.prevent.stop="handleGroupDrop($event, row.group)"
        @dragend="clearDragState"
      >
        <ChevronDown v-if="isGroupExpanded(row.group.key)" />
        <ChevronRight v-else />
        <span>{{ row.group.title }}</span>
        <em>({{ assetGroupAssetCount(row.group) }})</em>
        <span
          v-if="activeWorkspace === 'bastion' && row.group.refreshable"
          class="workspace-row-action refresh"
          :title="refreshingGroupKey === row.group.key ? '刷新中' : '刷新'"
          @click.stop="refreshGroup(row.group.key)"
        >
          <RefreshCw :class="{ spinning: refreshingGroupKey === row.group.key }" />
        </span>
        <MoreHorizontal
          v-if="row.group.menu"
          class="workspace-row-more"
          @click.stop="openGroupContextMenu($event, row.group.key)"
        />
      </button>
      <div
        v-else
        class="workspace-host-row"
        :class="{ selected: selectedAssetId === row.asset.id, 'drag-over': dragOverAssetId === row.asset.id }"
        :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
        role="button"
        tabindex="0"
        :draggable="canDragAsset(row.asset)"
        @click="selectAsset(row.asset.id)"
        @dblclick="connectAsset(row.asset.id)"
        @contextmenu.prevent.stop="openContextMenu($event, row.asset.id)"
        @dragstart="handleAssetDragStart($event, row.asset)"
        @dragover.prevent.stop="handleAssetDragOver($event, row.asset)"
        @dragleave="handleAssetDragLeave(row.asset.id)"
        @drop.prevent.stop="handleAssetDrop($event, row.asset)"
        @dragend="clearDragState"
      >
        <Laptop />
        <span>{{ displayAsset(row.asset) }}</span>
        <span
          v-if="commentAssetId === row.asset.id"
          class="workspace-comment-edit"
          @click.stop
        >
          <input
            v-model="editingComment"
            placeholder="备注"
            @keydown.enter.prevent="saveComment(row.asset.id)"
            @keydown.esc.prevent="cancelComment"
          />
          <button
            type="button"
            title="保存备注"
            @click="saveComment(row.asset.id)"
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
        <small v-else-if="row.asset.comment">({{ row.asset.comment }})</small>
        <Network
          v-if="row.asset.tunnelState"
          class="tunnel-icon"
          :class="{ active: row.asset.tunnelState === 'active' }"
          :title="row.asset.tunnelState === 'active' ? '隧道已连接' : '隧道已创建'"
        />
        <PlugZap
          v-if="row.asset.asset_type === 'organization'"
          class="tunnel-icon"
          title="堡垒机资源"
        />
        <MoreHorizontal
          class="workspace-row-more"
          @click.stop="openContextMenu($event, row.asset.id)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronDown,
  ChevronRight,
  Laptop,
  MoreHorizontal,
  Network,
  PlugZap,
  RefreshCw,
  Repeat2,
  Search,
  X
} from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspacePanelContext'

const {
  workspaceTabs,
  activeWorkspace,
  searchValue,
  selectedAssetId,
  refreshingGroupKey,
  commentAssetId,
  editingComment,
  dragOverGroupKey,
  dragOverAssetId,
  showIpMode,
  assetGroupAssetCount,
  visibleTreeRows,
  isGroupExpanded,
  toggleGroup,
  closeMenus,
  displayAsset,
  toggleDisplayMode,
  selectAsset,
  connectAsset,
  openContextMenu,
  openGroupContextMenu,
  openBlankContextMenu,
  canDragAsset,
  canDragGroup,
  clearDragState,
  handleAssetDragStart,
  handleGroupDragStart,
  handleGroupDragOver,
  handleGroupDragLeave,
  handleGroupDrop,
  handleAssetDragOver,
  handleAssetDragLeave,
  handleAssetDrop,
  handleBlankDragOver,
  handleBlankDragLeave,
  handleBlankDrop,
  saveComment,
  cancelComment,
  refreshGroup
} = useWorkspacePanelRuntimeContext()
</script>
