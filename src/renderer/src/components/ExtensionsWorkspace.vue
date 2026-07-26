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
        :provider-values="providerValues"
        :provider-loading="providerLoading"
        @update:active-tab="workspace.extensionDetailTab = $event"
        @install="workspace.installExtensionPlugin"
        @update="workspace.updateExtensionPlugin"
        @uninstall="workspace.uninstallExtensionPlugin"
        @subscribe="workspace.subscribeExtensionPlugin"
        @cancel="workspace.cancelExtensionInstall"
        @run-command="runPluginCommand"
        @update-provider-value="updateProviderValue"
        @sync-provider="syncProvider"
        @cancel-provider="cancelProvider"
        @notice="workspace.setExtensionNotice"
        @refresh-plugins="workspace.refreshExtensionPlugins"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import ExtensionGenericDetail from '@/components/extensions/ExtensionGenericDetail.vue'
import { isExtensionAssetProviderSyncData } from '@/services/extensions/extensionBackendGuards'
import { extensionsClient } from '@/services/extensions/extensionsClient'
import {
  extensionInstallStageText,
  extensionPluginSourceText,
  extensionPluginTags,
  extensionPluginVersion,
  formatExtensionPluginSize
} from '@/services/extensions/extensionsWorkspaceDisplayRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const providerValues = ref<Record<string, string>>({})
const providerLoading = ref(false)
const activeProviderId = ref('')

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

watch(
  () => workspace.selectedExtension?.pluginId,
  () => {
    const values: Record<string, string> = {}
    for (const provider of workspace.selectedExtension?.assetProviders || []) {
      for (const field of provider.fields) values[`${provider.id}:${field.key}`] = field.defaultValue || ''
    }
    providerValues.value = values
  },
  { immediate: true }
)

const updateProviderValue = (providerId: string, fieldKey: string, value: string) => {
  providerValues.value = { ...providerValues.value, [`${providerId}:${fieldKey}`]: value }
}

const runPluginCommand = async (command: string) => {
  const result = await workspace.runActiveTerminalCommand(command, 'snippet')
  workspace.setExtensionNotice(result ? '命令已发送到当前终端' : '请先打开一个可写终端')
}

const syncProvider = async (providerId: string) => {
  const plugin = workspace.selectedExtension
  if (!plugin || providerLoading.value) return
  const bridge = extensionsClient.syncExtensionAssetProvider()
  if (!bridge) {
    workspace.setExtensionNotice('资产导入服务不可用')
    return
  }
  const values: Record<string, string> = {}
  for (const provider of plugin.assetProviders || []) {
    if (provider.id !== providerId) continue
    for (const field of provider.fields) values[field.key] = providerValues.value[`${providerId}:${field.key}`] || ''
  }
  providerLoading.value = true
  activeProviderId.value = providerId
  try {
    const result = await bridge({ pluginId: plugin.pluginId, providerId, values })
    if (!result?.ok) {
      workspace.setExtensionNotice(result?.errorMessage || '资产导入失败')
      return
    }
    if (!isExtensionAssetProviderSyncData(result.data) || result.data.pluginId !== plugin.pluginId || result.data.providerId !== providerId) {
      workspace.setExtensionNotice('扩展服务返回数据无效')
      return
    }
    workspace.setExtensionNotice(`已导入 ${result.data.imported} 个资产`)
  } catch (error) {
    workspace.setExtensionNotice(error instanceof Error ? error.message : '资产导入失败')
  } finally {
    providerLoading.value = false
    activeProviderId.value = ''
  }
}

const cancelProvider = async (providerId: string) => {
  const plugin = workspace.selectedExtension
  const bridge = extensionsClient.cancelExtensionAssetProvider()
  if (!plugin || !bridge || activeProviderId.value !== providerId) return
  const result = await bridge({ pluginId: plugin.pluginId, providerId })
  workspace.setExtensionNotice(result?.data?.cancelled ? '正在取消资产导入' : '没有正在运行的资产导入')
}

onMounted(() => {
  if (workspace.extensionPlugins.length === 0) void workspace.refreshExtensionPlugins()
})
</script>
