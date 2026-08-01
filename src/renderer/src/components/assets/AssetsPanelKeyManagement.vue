<template>
  <div class="key-management-container">
    <div class="key-management-main">
      <div class="asset-search-container">
        <div class="asset-search-row">
          <div class="asset-search-input">
            <input
              v-model="keyQuery"
              placeholder="搜索"
            />
            <button
              v-if="keyQuery"
              class="asset-search-clear"
              title="清空搜索"
              @click="keyQuery = ''"
            >
              <X />
            </button>
            <Search />
          </div>
          <button
            class="asset-action-button"
            data-testid="key-new-button"
            @click="openNewKeyPanel"
          >
            <KeyRound />
            新建密钥
          </button>
        </div>
        <small v-if="keyServiceNotice">{{ keyServiceNotice }}</small>
      </div>

      <div class="keychain-list-container">
        <div
          v-if="filteredKeychains.length"
          class="keychain-cards"
          :class="{ 'wide-layout': !keyEditorOpen }"
        >
          <div
            v-for="key in filteredKeychains"
            :key="key.id"
            class="card-wrapper"
          >
            <button
              class="keychain-card"
              @click="selectedKeyId = key.id"
              @contextmenu.prevent="openKeyContextMenu($event, key.id)"
            >
              <span class="keychain-icon"><KeyRound /></span>
              <span class="keychain-info">
                <strong>{{ key.name }}</strong>
                <small>类型{{ key.type }}</small>
              </span>
              <span class="host-card-actions">
                <button
                  title="编辑"
                  @click.stop="editKey(key.id)"
                >
                  <Pencil />
                </button>
                <button
                  title="删除"
                  @click.stop="removeKey(key.id)"
                >
                  <Trash2 />
                </button>
              </span>
            </button>
          </div>
        </div>
        <div
          v-else
          class="asset-empty-state"
        >
          <KeyRound />
          <strong>{{ keyQuery ? '没有搜索结果' : '暂无密钥' }}</strong>
        </div>
      </div>

      <div
        v-if="keyContextMenuId"
        class="asset-context-menu"
        :style="{ left: `${keyContextPosition.x}px`, top: `${keyContextPosition.y}px` }"
      >
        <button @click="editKey(keyContextMenuId)">
          <Pencil />
          编辑
        </button>
        <button
          class="delete"
          @click="removeKey(keyContextMenuId)"
        >
          <Trash2 />
          删除
        </button>
      </div>
    </div>

    <AssetKeyFormDialog
      :visible="keyEditorOpen"
      :edit-mode="keyEditMode"
      :name="keyForm.name"
      :private-key="keyForm.privateKey"
      :public-key="keyForm.publicKey"
      :passphrase="keyForm.passphrase"
      :drag-over="keyDragOver"
      :error="keyFormError"
      :import-notice="keyImportNotice"
      @close="closeKeyEditor"
      @submit="submitKeyForm"
      @import="openKeyImportDialog"
      @drop="handleKeyDrop"
      @update:name="keyForm.name = $event"
      @update:private-key="keyForm.privateKey = $event"
      @update:public-key="keyForm.publicKey = $event"
      @update:passphrase="keyForm.passphrase = $event"
      @update:drag-over="keyDragOver = $event"
    />
  </div>
</template>

<script setup lang="ts">
import {
  KeyRound,
  Pencil,
  Search,
  Trash2,
  X
} from 'lucide-vue-next'
import AssetKeyFormDialog from '@/components/assets/AssetKeyFormDialog.vue'
import { useAssetsPanelRuntimeContext } from '@/services/assets/assetsPanelContext'

const {
  keyQuery,
  keyEditorOpen,
  keyEditMode,
  selectedKeyId,
  keyContextMenuId,
  keyContextPosition,
  keyDragOver,
  keyServiceNotice,
  keyImportNotice,
  keyFormError,
  keyForm,
  filteredKeychains,
  closeKeyEditor,
  openNewKeyPanel,
  editKey,
  submitKeyForm,
  removeKey,
  openKeyContextMenu,
  openKeyImportDialog,
  handleKeyDrop
} = useAssetsPanelRuntimeContext()
</script>
