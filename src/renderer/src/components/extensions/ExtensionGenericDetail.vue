<template>
  <div class="plugin_detail_view">
    <ExtensionPluginHeader
      :name="plugin.name"
      :description="plugin.description"
      :icon-key="plugin.iconKey"
    >
      <template #actions>
        <button
          v-if="plugin.isPlugin && !plugin.installed && plugin.installable !== false"
          class="op_btn primary"
          :class="{ download_progress_btn: downloadProgressVisible }"
          :style="downloadProgressButtonStyle"
          :disabled="isBusy"
          @click="$emit('install', plugin.pluginId)"
        >
          {{ installButtonText }}
        </button>
        <button
          v-else-if="plugin.isPlugin && !plugin.installed"
          class="op_btn primary"
          :disabled="isBusy"
          @click="$emit('subscribe', plugin.pluginId)"
        >
          订阅
        </button>
        <template v-else-if="plugin.isPlugin">
          <button
            v-if="!plugin.required"
            class="op_btn danger"
            :disabled="isBusy"
            @click="$emit('uninstall', plugin.pluginId)"
          >
            卸载
          </button>
          <button
            v-if="plugin.hasUpdate"
            class="op_btn"
            :class="{ download_progress_btn: downloadProgressVisible }"
            :style="downloadProgressButtonStyle"
            :disabled="isBusy"
            @click="$emit('update', plugin.pluginId)"
          >
            {{ updateButtonText }}
          </button>
        </template>
        <button
          v-if="isBusy"
          class="op_btn"
          @click="$emit('cancel', plugin.pluginId)"
        >
          取消
        </button>
      </template>
    </ExtensionPluginHeader>

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
            <p>{{ plugin.readme || '暂无 README' }}</p>
          </div>
          <div
            v-if="installProgress"
            class="plugin_install_progress"
          >
            <span>{{ progressStageText }}</span>
            <b>{{ installProgress.percent }}%</b>
            <i :style="{ width: `${installProgress.percent}%` }"></i>
          </div>
        </div>
        <ExtensionFeatureList
          v-else
          :features="plugin.functions || []"
        />
      </main>
      <ExtensionPluginSidebar
        :identifier="plugin.pluginId"
        :version="version"
        :last-updated="plugin.lastUpdated || 'N/A'"
        :source="source"
        :size="size"
        :tags="tags"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'
import ExtensionDetailTabs from '@/components/extensions/ExtensionDetailTabs.vue'
import ExtensionFeatureList from '@/components/extensions/ExtensionFeatureList.vue'
import ExtensionPluginHeader from '@/components/extensions/ExtensionPluginHeader.vue'
import ExtensionPluginSidebar from '@/components/extensions/ExtensionPluginSidebar.vue'
import type { WorkspaceExtensionInstallProgress } from '@/services/workspaceExtensionsController'
import type { ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'

defineProps<{
  plugin: ExtensionPluginRuntimeConfig
  activeTab: 'details' | 'features'
  isBusy: boolean
  installButtonText: string
  updateButtonText: string
  progressStageText: string
  downloadProgressVisible: boolean
  downloadProgressButtonStyle: StyleValue
  installProgress: WorkspaceExtensionInstallProgress | null
  version: string
  source: string
  size: string
  tags: string[]
}>()

defineEmits<{
  'update:activeTab': [value: 'details' | 'features']
  install: [pluginId: string]
  update: [pluginId: string]
  uninstall: [pluginId: string]
  subscribe: [pluginId: string]
  cancel: [pluginId: string]
}>()
</script>
