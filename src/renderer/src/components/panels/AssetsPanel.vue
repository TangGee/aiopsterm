<template>
  <AssetsPanelPresentation />
</template>

<script setup lang="ts">
import AssetsPanelPresentation from '@/components/assets/AssetsPanelPresentation.vue'
import { provideAssetsPanelRuntime } from '@/services/assets/assetsPanelContext'
import { useAssetsPanelRuntime } from '@/services/assets/assetsPanelRuntime'

const props = withDefaults(defineProps<{ query: string; mode?: 'panel' | 'workspace' }>(), {
  mode: 'panel'
})

provideAssetsPanelRuntime(useAssetsPanelRuntime(props))
</script>
