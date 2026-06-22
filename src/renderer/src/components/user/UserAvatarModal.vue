<template>
  <div class="user-modal-backdrop">
    <section class="user-modal-card avatar-settings-modal">
      <header>
        <h3>头像设置</h3>
        <button
          title="关闭"
          @click="emit('cancel')"
        >
          <X />
        </button>
      </header>
      <div
        class="avatar-preview-box"
        :class="{ empty: !avatarPreview }"
        @click="!avatarPreview ? emit('choose-avatar') : undefined"
      >
        <img
          v-if="avatarPreview"
          :src="avatarPreview"
          :style="{ transform: `scale(${avatarZoom}) translate(${avatarOffset.x / avatarZoom}px, ${avatarOffset.y / avatarZoom}px)` }"
          alt=""
          draggable="false"
          @mousedown="emit('start-drag', $event)"
        />
        <div
          v-else
          class="avatar-preview-placeholder"
        >
          <Camera />
          <p>点击上传头像</p>
        </div>
      </div>
      <div
        v-if="avatarPreview"
        class="avatar-zoom-control"
      >
        <span>-</span>
        <input
          :value="avatarZoom"
          type="range"
          min="1"
          max="2"
          step="0.1"
          @input="emit('update:avatarZoom', Number(($event.target as HTMLInputElement).value))"
        />
        <span>+</span>
      </div>
      <div class="avatar-actions-row">
        <button
          class="settings-button"
          @click="emit('choose-avatar')"
        >
          本地上传
        </button>
        <button
          v-if="avatarPreview"
          class="settings-button"
          @click="emit('clear-avatar')"
        >
          使用缩写
        </button>
      </div>
      <footer>
        <button
          class="settings-button"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="settings-button primary"
          :disabled="!avatarPreparedImageUrl && !avatarCleared"
          @click="emit('save')"
        >
          保存
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Camera, X } from 'lucide-vue-next'
import type { UserAvatarOffset } from '@/services/userPanelTypes'

defineProps<{
  avatarPreview: string
  avatarPreparedImageUrl: string
  avatarCleared: boolean
  avatarZoom: number
  avatarOffset: UserAvatarOffset
}>()

const emit = defineEmits<{
  'update:avatarZoom': [value: number]
  'choose-avatar': []
  'clear-avatar': []
  'start-drag': [event: MouseEvent]
  cancel: []
  save: []
}>()
</script>
