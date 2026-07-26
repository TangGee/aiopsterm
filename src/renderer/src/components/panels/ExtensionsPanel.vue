<template>
  <section
    class="extension_panel"
    :class="{ 'drag-active': workspace.extensionDragActive }"
    @dragenter.prevent="workspace.setExtensionDragActive(true)"
    @dragover.prevent="workspace.setExtensionDragActive(true)"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <header class="panel_header">
      <h2 class="panel_title">插件</h2>
    </header>

    <label class="extension_search_box">
      <input
        v-model="workspace.extensionSearchQuery"
        placeholder="模糊搜索"
      />
      <Search />
    </label>

    <div class="extension_list_container">
      <button
        v-for="item in workspace.filteredExtensionPlugins"
        :key="item.pluginId"
        class="extension_item"
        :class="{ active: item.pluginId === workspace.selectedExtensionId }"
        @click="workspace.selectExtension(item.pluginId)"
      >
        <span
          class="extension_item_icon"
          :class="`icon-${item.iconKey}`"
        >
          <component :is="iconMap[item.iconKey]" />
        </span>

        <span class="extension_item_info">
          <span class="extension_item_name_container">
            <strong
              class="extension_item_name"
              :title="item.name"
            >
              {{ item.name }}
            </strong>
            <em
              v-if="!item.isPlugin || item.required"
              class="extension_tag"
            >
              {{ !item.isPlugin ? '系统' : 'System' }}
            </em>
            <em
              v-else-if="item.isPrivate"
              class="extension_tag private"
            >
              Private
            </em>
            <em
              v-else-if="item.installed"
              class="extension_tag installed"
            >
              Installed
            </em>
          </span>
          <small
            class="extension_item_desc"
            :title="item.description"
          >
            {{ item.description || '暂无描述' }}
          </small>
          <span
            v-if="item.isPlugin"
            class="extension_item_meta"
          >
            <span>{{ sourceText(item) }}</span>
            <span v-if="item.installedVersion">{{ item.installedVersion }}</span>
            <span v-else-if="item.latestVersion">{{ item.latestVersion }}</span>
            <span v-if="item.hasUpdate">Update available</span>
          </span>
          <span
            v-if="pluginProgress(item.pluginId)"
            class="extension_install_status"
          >
            <span>{{ stageText(pluginProgress(item.pluginId)?.stage || '') }}</span>
            <b>{{ pluginProgress(item.pluginId)?.percent || 0 }}%</b>
            <i :style="{ width: `${pluginProgress(item.pluginId)?.percent || 0}%` }"></i>
          </span>
        </span>

        <span
          v-if="item.isPlugin"
          class="extension_item_actions"
          @click.stop
        >
          <button
            v-if="!item.installed && item.installable !== false"
            class="extension_op_btn primary"
            :class="{ loading: !!workspace.extensionInstallLoadingMap[item.pluginId] }"
            :disabled="isPluginBusy(item.pluginId)"
            title="安装"
            @click="workspace.installExtensionPlugin(item.pluginId)"
          >
            <LoaderCircle v-if="workspace.extensionInstallLoadingMap[item.pluginId]" />
            <CloudDownload v-else />
          </button>
          <button
            v-else-if="!item.installed"
            class="extension_op_btn primary"
            :disabled="isPluginBusy(item.pluginId)"
            title="订阅"
            @click="workspace.subscribeExtensionPlugin(item.pluginId)"
          >
            <Crown />
          </button>
          <button
            v-else-if="item.hasUpdate"
            class="extension_op_btn primary"
            :class="{ loading: !!workspace.extensionUpdateLoadingMap[item.pluginId] }"
            :disabled="isPluginBusy(item.pluginId)"
            title="更新"
            @click="workspace.updateExtensionPlugin(item.pluginId)"
          >
            <LoaderCircle v-if="workspace.extensionUpdateLoadingMap[item.pluginId]" />
            <RefreshCw v-else />
          </button>
        </span>
      </button>

      <div class="extension_drag_placeholder">
        <LoaderCircle v-if="workspace.extensionDragActive || workspace.extensionInstallingPackageName" />
        <PackageOpen v-else />
        <span>{{ dragPlaceholderText }}</span>
      </div>
    </div>

    <div
      v-if="workspace.extensionNotice"
      class="extension_notice"
    >
      {{ workspace.extensionNotice }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import { Cloud, CloudDownload, Crown, FileText, LoaderCircle, PackageOpen, RefreshCw, Search, ShieldCheck, WandSparkles } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ExtensionIconKey, ExtensionInstallStage, ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'

type ExtensionPlugin = ExtensionPluginRuntimeConfig

const workspace = useWorkspaceStore()

const iconMap: Record<ExtensionIconKey, Component> = {
  runbook: FileText,
  cloud: Cloud,
  private: ShieldCheck,
  local: WandSparkles
}

const dragPlaceholderText = computed(() => {
  if (workspace.extensionInstallingPackageName) return `正在安装 ${workspace.extensionInstallingPackageName}`
  if (workspace.extensionDragActive) return '松开安装 .aiopsterm-plugin 插件包'
  return '拖入 .aiopsterm-plugin 插件包'
})

const stageText = (stage: ExtensionInstallStage) => {
  if (stage === 'downloading') return 'Downloading'
  if (stage === 'verifying') return 'Verifying'
  if (stage === 'installing') return 'Installing'
  if (stage === 'done') return 'Done'
  if (stage === 'cancelled') return 'Cancelled'
  if (stage === 'error') return 'Error'
  return ''
}

const pluginProgress = (pluginId: string) => workspace.extensionInstallProgressMap[pluginId] || null

const isPluginBusy = (pluginId: string) => Boolean(workspace.extensionInstallLoadingMap[pluginId] || workspace.extensionUpdateLoadingMap[pluginId])

const sourceText = (plugin: ExtensionPlugin) => {
  if (plugin.source === 'builtin') return 'Built-in'
  if (plugin.source === 'local') return 'Local'
  return 'Store'
}

onMounted(() => {
  if (workspace.extensionPlugins.length === 0) void workspace.refreshExtensionPlugins()
})

const handleDragLeave = (event: DragEvent) => {
  if (event.currentTarget === event.target) {
    workspace.setExtensionDragActive(false)
  }
}

const handleDrop = (event: DragEvent) => {
  const file = event.dataTransfer?.files?.[0]
  workspace.dropExtensionPackage(file ? { name: file.name, path: (file as File & { path?: string }).path, size: file.size } : '')
}
</script>
