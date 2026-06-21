<template>
  <div class="asset-tree-group-node">
    <button
      class="asset-tree-group-row"
      :style="{ paddingLeft: `${8 + level * 14}px` }"
      @click="$emit('toggle', group.key)"
      @contextmenu.prevent.stop="$emit('groupContext', $event, group.key)"
    >
      <ChevronDown v-if="expanded" />
      <ChevronRight v-else />
      <span>{{ group.title }}</span>
      <small>{{ assetGroupAssetCount(group) }}</small>
    </button>
    <div
      v-if="expanded"
      class="asset-tree-children"
    >
      <AssetTreeGroupNode
        v-for="child in group.childGroups"
        :key="child.key"
        :group="child"
        :level="level + 1"
        :expanded-keys="expandedKeys"
        :force-expanded="forceExpanded"
        :selected-asset-id="selectedAssetId"
        :first-asset-id="firstAssetId"
        @toggle="$emit('toggle', $event)"
        @select-asset="$emit('selectAsset', $event)"
        @connect-asset="$emit('connectAsset', $event)"
        @edit-asset="$emit('editAsset', $event)"
        @remove-asset="$emit('removeAsset', $event)"
        @group-context="(event, key) => $emit('groupContext', event, key)"
        @asset-context="(event, id) => $emit('assetContext', event, id)"
      />
      <div
        v-for="asset in group.children"
        :key="asset.id"
        class="host-card asset-tree-host-row"
        :class="{ selected: selectedAssetId === asset.id }"
        role="button"
        tabindex="0"
        :aria-label="`${asset.title} 主机${asset.username ? `, ${asset.username}` : ''}`"
        :data-onboarding-id="asset.id === firstAssetId ? 'asset-card' : undefined"
        :style="{ marginLeft: `${(level + 1) * 14}px` }"
        @click="$emit('selectAsset', asset.id)"
        @dblclick.stop="$emit('connectAsset', asset.id)"
        @keydown.enter.prevent="$emit('connectAsset', asset.id)"
        @keydown.space.prevent="$emit('selectAsset', asset.id)"
        @contextmenu.prevent="$emit('assetContext', $event, asset.id)"
      >
        <span class="host-card-icon">
          <Network v-if="asset.asset_type === 'switch'" />
          <Laptop v-else />
          <PlugZap
            v-if="asset.asset_type === 'organization'"
            class="enterprise-indicator"
          />
        </span>
        <span class="host-card-info">
          <strong>{{ asset.title }}</strong>
          <small>{{ asset.username }}@{{ asset.host }}:{{ asset.port }} · {{ asset.asset_type === 'organization' ? '堡垒机' : '主机' }}</small>
        </span>
        <span class="host-card-actions">
          <button
            title="编辑"
            @click.stop="$emit('editAsset', asset.id)"
          >
            <Pencil />
          </button>
          <button
            v-if="asset.asset_type !== 'organization'"
            title="删除"
            @click.stop="$emit('removeAsset', asset.id)"
          >
            <Trash2 />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, ChevronRight, Laptop, Network, Pencil, PlugZap, Trash2 } from 'lucide-vue-next'
import { assetGroupAssetCount, type AssetsPanelGroup } from '@/services/assetsPanelTreeRuntime'

const props = withDefaults(
  defineProps<{
    group: AssetsPanelGroup
    level: number
    expandedKeys: string[]
    forceExpanded?: boolean
    selectedAssetId?: string
    firstAssetId?: string
  }>(),
  {
    forceExpanded: false,
    selectedAssetId: '',
    firstAssetId: ''
  }
)

defineEmits<{
  toggle: [key: string]
  selectAsset: [assetId: string]
  connectAsset: [assetId: string]
  editAsset: [assetId: string]
  removeAsset: [assetId: string]
  groupContext: [event: MouseEvent, key: string]
  assetContext: [event: MouseEvent, assetId: string]
}>()

const expanded = computed(() => props.forceExpanded || props.expandedKeys.includes(props.group.key))
</script>
