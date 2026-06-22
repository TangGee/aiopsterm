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

    <div
      v-if="keyEditorOpen"
      class="asset-host-modal file-modal"
    >
      <aside class="asset-form-panel key-form-panel asset-host-form-modal">
        <header>
          <strong>{{ keyEditMode ? '编辑密钥' : '新建密钥' }}</strong>
          <button
            title="关闭"
            @click="keyEditorOpen = false"
          >
            <X />
          </button>
        </header>
        <label>
          <span>名称</span>
          <input v-model="keyForm.name" />
        </label>
        <label>
          <span>私钥</span>
          <textarea
            v-model="keyForm.privateKey"
            spellcheck="false"
          />
        </label>
        <label>
          <span>公钥</span>
          <textarea
            v-model="keyForm.publicKey"
            spellcheck="false"
          />
        </label>
        <label>
          <span>Passphrase</span>
          <input
            v-model="keyForm.passphrase"
            type="password"
          />
        </label>
        <div
          class="key-drop-area"
          :class="{ 'drag-over': keyDragOver }"
          @dragover.prevent
          @dragenter.prevent="keyDragOver = true"
          @dragleave.prevent="keyDragOver = false"
          @drop.prevent="handleKeyDrop"
          @click="openKeyImportDialog"
        >
          <Upload />
          <span>拖拽或点击导入密钥文件</span>
        </div>
        <small
          v-if="keyFormError"
          class="key-form-error"
        >
          {{ keyFormError }}
        </small>
        <small v-if="keyImportNotice">{{ keyImportNotice }}</small>
        <div class="asset-form-actions">
          <button
            class="asset-submit-button secondary"
            @click="keyEditorOpen = false"
          >
            取消
          </button>
          <button
            class="asset-submit-button"
            @click="submitKeyForm"
          >
            {{ keyEditMode ? '保存密钥' : '创建密钥' }}
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  KeyRound,
  Pencil,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-vue-next'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

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
  openNewKeyPanel,
  editKey,
  submitKeyForm,
  removeKey,
  openKeyContextMenu,
  openKeyImportDialog,
  handleKeyDrop
} = useAssetsPanelRuntimeContext()
</script>
