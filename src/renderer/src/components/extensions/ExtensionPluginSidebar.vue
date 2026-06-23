<template>
  <aside class="sidebar">
    <div class="sidebar_block installation_block">
      <h3 class="sidebar_title">安装</h3>
      <dl class="metadata_descriptions">
        <dt>插件标识</dt>
        <dd>{{ identifier }}</dd>
        <dt>插件版本</dt>
        <dd>{{ version }}</dd>
        <dt>最后更新</dt>
        <dd>{{ lastUpdated }}</dd>
        <dt>插件来源</dt>
        <dd>{{ source }}</dd>
        <dt>插件大小</dt>
        <dd>{{ size }}</dd>
      </dl>
    </div>
    <div class="sidebar_block categories_block">
      <h3 class="sidebar_title">插件分类</h3>
      <div class="categories_tags">
        <span
          v-for="tag in tags"
          :key="tag"
        >
          {{ tag }}
        </span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  identifier: string
  version: string
  lastUpdated: string
  source: string
  size: string
  tags: string[]
}>()
</script>
