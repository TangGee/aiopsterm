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
import { Check, ChevronDown, ChevronRight, Folder, FolderInput, FolderMinus, MessageSquare, Pencil, RefreshCw, Search, Star, Trash2, X } from 'lucide-vue-next'
import { useFilesPanelRuntime } from '@/services/files/filesPanelRuntime'

const {
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
} = useFilesPanelRuntime()
</script>
