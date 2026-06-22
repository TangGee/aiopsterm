<template>
  <div class="recording-status-bar">
    <div>
      <span class="recording-indicator"></span>
      <span>录制中</span>
      <i>|</i>
      <small>{{ commandCount }}</small>
      <small
        v-if="currentLineBuffer"
        class="recording-buffer"
      >{{ currentLineBuffer }}</small>
    </div>
    <div class="recording-actions">
      <button @click="$emit('cancel')">取消</button>
      <button @click="$emit('stop')">停止录制</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  commandCount: number
  currentLineBuffer: string
}>()

defineEmits<{
  cancel: []
  stop: []
}>()
</script>
