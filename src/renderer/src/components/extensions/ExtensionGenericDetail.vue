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
            v-if="!plugin.required && plugin.source !== 'builtin' && plugin.source !== 'development'"
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
          <section
            v-if="plugin.commands?.length"
            class="extension_contribution_section"
          >
            <h3>终端命令</h3>
            <article
              v-for="command in plugin.commands"
              :key="command.id"
              class="extension_contribution_card"
            >
              <div>
                <strong>{{ command.title }}</strong>
                <p>{{ command.description }}</p>
                <code>{{ command.command }}</code>
              </div>
              <button
                v-if="command.command"
                class="op_btn"
                @click="$emit('runCommand', command.command || '')"
              >
                发送到终端
              </button>
            </article>
          </section>
          <ExtensionRuntimeFeatures
            :plugin="plugin"
            @notice="$emit('notice', $event)"
            @run-terminal-text="$emit('runCommand', $event)"
            @refresh-plugins="$emit('refreshPlugins')"
          />
          <section
            v-for="provider in plugin.assetProviders || []"
            :key="provider.id"
            class="extension_contribution_section"
          >
            <h3>{{ provider.name }}</h3>
            <p>{{ provider.description }}</p>
            <label
              v-for="field in provider.fields"
              :key="field.key"
              class="extension_provider_field"
            >
              <span>{{ field.label }}</span>
              <textarea
                :value="providerValues[`${provider.id}:${field.key}`] ?? field.defaultValue ?? ''"
                rows="12"
                @input="$emit('updateProviderValue', provider.id, field.key, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </label>
            <button
              class="op_btn primary"
              :disabled="providerLoading"
              @click="$emit('syncProvider', provider.id)"
            >
              {{ providerLoading ? '正在导入' : '导入资产' }}
            </button>
            <button
              v-if="providerLoading"
              class="op_btn"
              @click="$emit('cancelProvider', provider.id)"
            >
              取消导入
            </button>
          </section>
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
import ExtensionRuntimeFeatures from '@/components/extensions/ExtensionRuntimeFeatures.vue'
import type { WorkspaceExtensionInstallProgress } from '@/services/extensions/workspaceExtensionsController'
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
  providerValues: Record<string, string>
  providerLoading: boolean
}>()

defineEmits<{
  'update:activeTab': [value: 'details' | 'features']
  install: [pluginId: string]
  update: [pluginId: string]
  uninstall: [pluginId: string]
  subscribe: [pluginId: string]
  cancel: [pluginId: string]
  runCommand: [command: string]
  updateProviderValue: [providerId: string, fieldKey: string, value: string]
  syncProvider: [providerId: string]
  cancelProvider: [providerId: string]
  notice: [message: string]
  refreshPlugins: []
}>()
</script>
