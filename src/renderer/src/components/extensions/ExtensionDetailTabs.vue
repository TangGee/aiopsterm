<template>
  <div class="detail_tabs">
    <button
      :class="{ active: activeTab === 'details' }"
      @click="$emit('update:activeTab', 'details')"
    >
      详情
    </button>
    <button
      :class="{ active: activeTab === 'features' }"
      @click="$emit('update:activeTab', 'features')"
    >
      插件功能
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  activeTab: 'details' | 'features'
}>()

defineEmits<{
  'update:activeTab': [value: 'details' | 'features']
}>()
</script>
