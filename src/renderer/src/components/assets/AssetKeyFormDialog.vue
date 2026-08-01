<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="asset-host-modal file-modal"
      :class="{ 'workspace-child-modal-backdrop': child }"
    >
      <aside
        class="asset-form-panel key-form-panel asset-host-form-modal"
        data-testid="asset-key-form-dialog"
      >
        <header>
          <strong>{{ editMode ? '编辑密钥' : '新建密钥' }}</strong>
          <button
            type="button"
            title="关闭"
            @click="$emit('close')"
          >
            <X />
          </button>
        </header>
        <label>
          <span>名称</span>
          <input
            :value="name"
            @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          <span>私钥</span>
          <textarea
            :value="privateKey"
            spellcheck="false"
            @input="$emit('update:privateKey', ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <label>
          <span>公钥</span>
          <textarea
            :value="publicKey"
            spellcheck="false"
            @input="$emit('update:publicKey', ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <label>
          <span>Passphrase</span>
          <input
            :value="passphrase"
            type="password"
            @input="$emit('update:passphrase', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <div
          class="key-drop-area"
          :class="{ 'drag-over': dragOver }"
          @dragover.prevent
          @dragenter.prevent="$emit('update:dragOver', true)"
          @dragleave.prevent="$emit('update:dragOver', false)"
          @drop.prevent="$emit('drop', $event)"
          @click="$emit('import')"
        >
          <Upload />
          <span>拖拽或点击导入密钥文件</span>
        </div>
        <small
          v-if="error"
          class="key-form-error"
        >
          {{ error }}
        </small>
        <small v-if="importNotice">{{ importNotice }}</small>
        <div class="asset-form-actions">
          <button
            type="button"
            class="asset-submit-button secondary"
            @click="$emit('close')"
          >
            取消
          </button>
          <button
            type="button"
            class="asset-submit-button"
            @click="$emit('submit')"
          >
            {{ editMode ? '保存密钥' : '创建密钥' }}
          </button>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Upload, X } from 'lucide-vue-next'

withDefaults(defineProps<{
  visible: boolean
  editMode?: boolean
  name: string
  privateKey: string
  publicKey: string
  passphrase: string
  dragOver?: boolean
  error?: string
  importNotice?: string
  child?: boolean
}>(), {
  editMode: false,
  dragOver: false,
  error: '',
  importNotice: '',
  child: false
})

defineEmits<{
  close: []
  submit: []
  import: []
  drop: [event: DragEvent]
  'update:name': [value: string]
  'update:privateKey': [value: string]
  'update:publicKey': [value: string]
  'update:passphrase': [value: string]
  'update:dragOver': [value: boolean]
}>()
</script>
