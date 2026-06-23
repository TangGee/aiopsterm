<template>
  <div class="plugin_detail_view">
    <ExtensionPluginHeader
      :name="plugin.name"
      :description="plugin.description"
      icon-key="jumpserver"
    />

    <div class="detail_body">
      <main class="main_content">
        <ExtensionDetailTabs
          :active-tab="activeTab"
          @update:active-tab="$emit('update:activeTab', $event)"
        />
        <div
          v-if="activeTab === 'details'"
          class="markdown_readme_container"
        >
          <div class="rendered_markdown">
            <h2>{{ plugin.name }}</h2>
            <p>{{ plugin.detailSummary || plugin.description }}</p>
            <h3>插件能力</h3>
            <ul
              v-if="plugin.functions?.length"
              class="feature_bullets"
            >
              <li
                v-for="item in plugin.functions"
                :key="item.title"
              >
                <b>{{ item.title }}：</b>{{ item.desc }}
              </li>
            </ul>
            <div
              v-else
              class="empty_readme"
            >
              暂无功能说明
            </div>
            <h3>接入步骤</h3>
            <ul
              v-if="plugin.guideSteps?.length"
              class="guide_list"
            >
              <li
                v-for="step in plugin.guideSteps"
                :key="step"
              >
                {{ step }}
              </li>
            </ul>
            <div
              v-else
              class="empty_readme"
            >
              暂无接入步骤
            </div>
            <h3>资产同步状态</h3>
            <div
              v-if="assetError"
              class="jumpserver_asset_notice error"
            >
              {{ assetError }}
            </div>
            <div class="jumpserver_asset_summary">
              <div>
                <span>Jumpserver 数据源</span>
                <strong>{{ organizations.length }}</strong>
              </div>
              <div>
                <span>已同步主机</span>
                <strong>{{ syncedAssets.length }}</strong>
              </div>
              <div>
                <span>在线同步主机</span>
                <strong>{{ onlineSyncedAssets.length }}</strong>
              </div>
            </div>
            <div class="jumpserver_asset_actions">
              <button
                class="op_btn primary"
                :disabled="assetLoading || organizations.length === 0"
                @click="$emit('refreshAssets')"
              >
                {{ assetLoading ? '刷新中' : '刷新组织资产' }}
              </button>
              <button
                class="op_btn"
                @click="$emit('openAssetManagement')"
              >
                打开资产管理
              </button>
              <span v-if="assetNotice">{{ assetNotice }}</span>
            </div>
            <div
              v-if="organizations.length"
              class="jumpserver_source_list"
            >
              <div
                v-for="organization in organizations"
                :key="organization.id"
                class="jumpserver_source_row"
              >
                <span>
                  <strong>{{ organization.title }}</strong>
                  <small>{{ organization.username }}@{{ organization.host }}:{{ organization.port }}</small>
                </span>
                <button
                  class="op_btn"
                  :disabled="assetLoading"
                  @click="$emit('refreshAssets', organization.id)"
                >
                  刷新
                </button>
              </div>
            </div>
            <div
              v-else-if="!assetLoading"
              class="empty_readme"
            >
              暂无 Jumpserver 数据源，请先在资产管理中新增堡垒机。
            </div>
            <div
              v-if="syncedAssets.length"
              class="jumpserver_synced_assets"
            >
              <div
                v-for="asset in syncedAssets"
                :key="asset.id"
                class="jumpserver_synced_asset"
              >
                <span>
                  <strong>{{ asset.title }}</strong>
                  <small>{{ asset.username }}@{{ asset.host }}:{{ asset.port }}</small>
                </span>
                <b :class="`asset_status_${asset.status}`">{{ asset.status }}</b>
              </div>
            </div>
          </div>
        </div>
        <ExtensionFeatureList
          v-else
          :features="plugin.functions || []"
        />
      </main>
      <ExtensionPluginSidebar
        identifier="jumpserver-support"
        version="N/A"
        last-updated="N/A"
        source="Preinstalled"
        size="N/A"
        :tags="plugin.categories || ['SSH', 'Tools']"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ExtensionDetailTabs from '@/components/extensions/ExtensionDetailTabs.vue'
import ExtensionFeatureList from '@/components/extensions/ExtensionFeatureList.vue'
import ExtensionPluginHeader from '@/components/extensions/ExtensionPluginHeader.vue'
import ExtensionPluginSidebar from '@/components/extensions/ExtensionPluginSidebar.vue'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type { ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'

defineProps<{
  plugin: ExtensionPluginRuntimeConfig
  activeTab: 'details' | 'features'
  assetLoading: boolean
  assetError: string
  assetNotice: string
  organizations: AiopsAssetRecord[]
  syncedAssets: AiopsAssetRecord[]
  onlineSyncedAssets: AiopsAssetRecord[]
}>()

defineEmits<{
  'update:activeTab': [value: 'details' | 'features']
  refreshAssets: [organizationId?: string]
  openAssetManagement: []
}>()
</script>
