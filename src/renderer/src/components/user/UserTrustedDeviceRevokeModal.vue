<template>
  <div class="user-modal-backdrop">
    <section class="user-modal-card small user-trusted-device-confirm">
      <header>
        <h3>移除可信设备</h3>
        <button
          title="关闭"
          @click="emit('cancel')"
        >
          <X />
        </button>
      </header>
      <p>确认移除该可信设备？</p>
      <footer>
        <button
          class="settings-button"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="settings-button primary"
          @click="emit('confirm')"
        >
          完成
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
</script>
