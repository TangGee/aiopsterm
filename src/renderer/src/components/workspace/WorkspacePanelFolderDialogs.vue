<template>
  <Teleport to="body">
    <div
      v-if="folderModal.visible"
      class="files-folder-modal-backdrop"
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
          v-if="targetMoveFolders.length === 0"
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
            v-for="folder in targetMoveFolders"
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
  </Teleport>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  folderModal,
  folderForm,
  folderFormError,
  moveModal,
  deleteGroupModal,
  targetMoveFolders,
  deleteGroupInfo,
  openCreateFolderFromMoveModal,
  closeFolderModal,
  closeMoveModal,
  closeDeleteGroupModal,
  saveFolderForm,
  moveAssetToFolder,
  confirmDeleteGroup
} = useWorkspacePanelRuntimeContext()
</script>
