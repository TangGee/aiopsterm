<template>
  <div
    class="assets-panel-native"
    :class="{ 'assets-panel-workspace-mode': isWorkspaceMode }"
  >
    <div
      v-if="isWorkspaceMode"
      class="asset-workspace-tabs"
      role="tablist"
      aria-label="资产管理"
    >
      <button
        v-for="entry in assetManagementEntries"
        :key="entry.key"
        type="button"
        class="asset-workspace-tab"
        :class="{ active: activeAssetView === entry.key }"
        :data-onboarding-id="entry.key === 'assetConfig' ? 'host-management-entry' : undefined"
        role="tab"
        :aria-selected="activeAssetView === entry.key"
        @click="openManagementEntry(entry.key)"
      >
        <component :is="entry.icon" />
        <span>{{ entry.name }}</span>
      </button>
    </div>

    <AssetsPanelManagementMenu v-if="activeAssetView === 'menu'" />
    <AssetsPanelHostConfig v-else-if="activeAssetView === 'assetConfig'" />
    <AssetsPanelProxyManagement v-else-if="activeAssetView === 'proxyManagement'" />
    <AssetsPanelManagedAssets v-else-if="activeAssetView === 'assetManagement'" />
    <AssetsPanelKeyManagement v-else-if="activeAssetView === 'keyManagement'" />

    <AssetsPanelSharedDialogs />
  </div>
</template>

<script setup lang="ts">
import AssetsPanelHostConfig from '@/components/assets/AssetsPanelHostConfig.vue'
import AssetsPanelKeyManagement from '@/components/assets/AssetsPanelKeyManagement.vue'
import AssetsPanelManagedAssets from '@/components/assets/AssetsPanelManagedAssets.vue'
import AssetsPanelManagementMenu from '@/components/assets/AssetsPanelManagementMenu.vue'
import AssetsPanelProxyManagement from '@/components/assets/AssetsPanelProxyManagement.vue'
import AssetsPanelSharedDialogs from '@/components/assets/AssetsPanelSharedDialogs.vue'
import { useAssetsPanelRuntimeContext } from '@/services/assetsPanelContext'

const {
  assetManagementEntries,
  isWorkspaceMode,
  activeAssetView,
  openManagementEntry
} = useAssetsPanelRuntimeContext()
</script>
