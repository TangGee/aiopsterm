<template>
  <div
    v-if="blankContextMenuVisible"
    class="asset-context-menu workspace-node-menu"
    :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
    @click.stop
  >
    <button @click="openCreateFolder()">
      <Folder />
      新建顶级分组
    </button>
    <button @click="openCreateHost()">
      <Laptop />
      新建主机
    </button>
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
      v-if="canCreateChildInContextGroup"
      @click="openCreateFolder(contextGroup)"
    >
      <Folder />
      新建子分组
    </button>
    <button
      v-if="canCreateHostInContextGroup"
      @click="openCreateHost(contextGroup)"
    >
      <Laptop />
      新建主机
    </button>
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
</template>

<script setup lang="ts">
import {
  Copy,
  Database,
  Folder,
  FolderInput,
  FolderMinus,
  Laptop,
  Network,
  Pencil,
  PlugZap,
  RefreshCw,
  Star,
  Trash2
} from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  contextMenuAssetId,
  contextMenuGroupKey,
  blankContextMenuVisible,
  contextMenuPosition,
  contextAsset,
  contextGroup,
  canCommentContextAsset,
  canMoveContextAsset,
  canRemoveContextAssetFromFolder,
  canConnectContextAsset,
  canCreateChildInContextGroup,
  canCreateHostInContextGroup,
  openCreateFolder,
  openCreateHost,
  connectContextAsset,
  toggleFavorite,
  openContextComment,
  toggleTunnel,
  openMoveModalFromContext,
  removeContextAssetFromFolder,
  refreshGroup,
  refreshContextOrganization,
  openContextOrganizationManagement,
  openGroupOrganizationManagement,
  openEditGroup,
  openDeleteGroup,
  openDeleteGroupOrganization,
  editContextAsset,
  cloneContextAsset,
  openDeleteContextAsset
} = useWorkspacePanelRuntimeContext()
</script>
