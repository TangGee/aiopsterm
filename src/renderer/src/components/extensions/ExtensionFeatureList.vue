<template>
  <div class="feature_list">
    <template v-if="features.length">
      <div
        v-for="item in features"
        :key="item.title"
        class="feature_item"
      >
        <strong>{{ item.title }}</strong>
        <p>{{ item.desc }}</p>
      </div>
    </template>
    <div
      v-else
      class="empty_readme"
    >
      暂无功能说明
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ExtensionFunctionConfig } from '@shared/contracts/extensions'

defineProps<{
  features: ExtensionFunctionConfig[]
}>()
</script>
