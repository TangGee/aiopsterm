<template>
  <div class="asset-management-header">
    <strong>管理</strong>
  </div>
  <div class="asset-management-search">
    <input
      v-model="managementQuery"
      placeholder="搜索"
    />
    <Search />
  </div>
  <div class="asset-management-list">
    <button
      v-for="entry in filteredManagementEntries"
      :key="entry.key"
      class="asset-management-item"
      :data-onboarding-id="entry.key === 'assetConfig' ? 'host-management-entry' : undefined"
      @click="openManagementEntry(entry.key)"
    >
      <span class="asset-management-icon">
        <component :is="entry.icon" />
      </span>
      <span>
        <strong>{{ entry.name }}</strong>
        <small>{{ entry.description }}</small>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

const {
  managementQuery,
  filteredManagementEntries,
  openManagementEntry
} = useAssetsPanelRuntimeContext()
</script>
