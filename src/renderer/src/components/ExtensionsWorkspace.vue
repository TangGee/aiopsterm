<template>
  <section
    class="extensions-workspace"
    data-ui-focus-scope="extensions"
    data-ui-focus-primary
    tabindex="-1"
  >
    <template v-if="workspace.selectedExtension">
      <ExtensionGenericDetail
        :plugin="workspace.selectedExtension"
        :active-tab="workspace.extensionDetailTab"
        :is-busy="isSelectedBusy"
        :install-button-text="installButtonText"
        :update-button-text="updateButtonText"
        :progress-stage-text="progressStageText"
        :download-progress-visible="downloadProgressVisible"
        :download-progress-button-style="downloadProgressButtonStyle"
        :install-progress="workspace.selectedExtensionInstallProgress"
        :version="selectedVersion"
        :source="selectedSource"
        :size="selectedSize"
        :tags="selectedTags"
        @update:active-tab="workspace.extensionDetailTab = $event"
        @install="workspace.installExtensionPlugin"
        @update="workspace.updateExtensionPlugin"
        @uninstall="workspace.uninstallExtensionPlugin"
        @subscribe="workspace.subscribeExtensionPlugin"
        @cancel="workspace.cancelExtensionInstall"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import ExtensionGenericDetail from '@/components/extensions/ExtensionGenericDetail.vue'
import {
  extensionInstallStageText,
  extensionPluginSourceText,
  extensionPluginTags,
  extensionPluginVersion,
  formatExtensionPluginSize
} from '@/services/extensions/extensionsWorkspaceDisplayRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

const isSelectedBusy = computed(() => {
  const id = workspace.selectedExtension?.pluginId
  return Boolean(id && (workspace.extensionInstallLoadingMap[id] || workspace.extensionUpdateLoadingMap[id]))
})

const selectedStageText = computed(() => extensionInstallStageText(workspace.selectedExtensionInstallProgress?.stage))
const progressStageText = computed(() => selectedStageText.value || 'Installing')
const downloadProgressVisible = computed(() => workspace.selectedExtensionInstallProgress?.stage === 'downloading')
const downloadProgressButtonStyle = computed(() => ({ '--download-progress': `${workspace.selectedExtensionInstallProgress?.percent || 0}%` }))
const installButtonText = computed(() => {
  if (!isSelectedBusy.value) return '安装'
  return selectedStageText.value || 'Installing'
})
const updateButtonText = computed(() => {
  if (!isSelectedBusy.value) return '更新'
  return selectedStageText.value || 'Updating'
})

const selectedVersion = computed(() => (workspace.selectedExtension ? extensionPluginVersion(workspace.selectedExtension) : '0.0.0'))
const selectedSource = computed(() => (workspace.selectedExtension ? extensionPluginSourceText(workspace.selectedExtension) : 'Store'))
const selectedSize = computed(() => formatExtensionPluginSize(workspace.selectedExtension?.size))
const selectedTags = computed(() => (workspace.selectedExtension ? extensionPluginTags(workspace.selectedExtension) : []))

onMounted(() => {
  if (workspace.extensionPlugins.length === 0) void workspace.refreshExtensionPlugins()
})
</script>
