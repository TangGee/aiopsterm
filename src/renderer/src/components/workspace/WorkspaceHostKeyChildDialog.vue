<template>
  <Teleport to="body">
    <div
      v-if="hostChildModal === 'key'"
      class="files-folder-modal-backdrop workspace-child-modal-backdrop"
    >
      <section class="files-folder-modal workspace-child-modal workspace-key-child-modal key-form-panel">
        <header>
          <h3>新建密钥</h3>
          <button
            type="button"
            @click="closeHostChildModal"
          >
            <X />
          </button>
        </header>
        <form
          class="files-folder-form workspace-key-form"
          @submit.prevent="saveHostKeyForm"
        >
          <label>
            <span>名称 *</span>
            <input v-model="hostKeyForm.name" />
          </label>
          <label class="workspace-host-form-wide">
            <span>私钥 *</span>
            <textarea
              v-model="hostKeyForm.privateKey"
              spellcheck="false"
              rows="6"
            />
          </label>
          <label class="workspace-host-form-wide">
            <span>公钥</span>
            <textarea
              v-model="hostKeyForm.publicKey"
              spellcheck="false"
              rows="3"
            />
          </label>
          <label>
            <span>Passphrase</span>
            <input
              v-model="hostKeyForm.passphrase"
              type="password"
            />
          </label>
          <div
            class="key-drop-area workspace-host-form-wide"
            :class="{ 'drag-over': hostKeyDragOver }"
            @dragover.prevent
            @dragenter.prevent="hostKeyDragOver = true"
            @dragleave.prevent="hostKeyDragOver = false"
            @drop.prevent="handleHostKeyDrop"
            @click="openHostKeyImportDialog"
          >
            <Upload />
            <span>拖拽或点击导入密钥文件</span>
          </div>
          <p
            v-if="hostChildFormError"
            class="files-folder-error workspace-host-form-wide"
          >
            {{ hostChildFormError }}
          </p>
          <footer class="workspace-host-form-wide">
            <button
              type="button"
              @click="closeHostChildModal"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary"
            >
              保存
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Upload, X } from 'lucide-vue-next'
import { useWorkspacePanelRuntimeContext } from '@/services/workspace/workspacePanelContext'

const {
  hostChildModal,
  hostChildFormError,
  hostKeyForm,
  hostKeyDragOver,
  openHostKeyImportDialog,
  handleHostKeyDrop,
  saveHostKeyForm,
  closeHostChildModal
} = useWorkspacePanelRuntimeContext()
</script>
