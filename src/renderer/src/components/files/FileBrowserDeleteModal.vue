<template>
  <div
    v-if="visible && entry"
    class="file-modal"
  >
    <div class="file-modal-card small file-delete-confirm">
      <header>
        <strong>删除文件</strong>
        <button
          title="关闭"
          @click="$emit('close')"
        >
          <X />
        </button>
      </header>
      <p>
        确认删除
        <strong>{{ entry.path }}</strong>
        ？
      </p>
      <footer>
        <button @click="$emit('close')">取消</button>
        <button
          class="danger"
          @click="$emit('confirm')"
        >
          删除
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { FileBrowserEntry } from '@/services/filesRuntime'

defineProps<{
  visible: boolean
  entry: FileBrowserEntry | null
}>()

defineEmits<{
  close: []
  confirm: []
}>()
</script>
