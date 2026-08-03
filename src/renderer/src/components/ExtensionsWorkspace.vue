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
        @update:active-tab="workspace.setExtensionDetailTab($event)"
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
import { useI18n } from '@/i18n'
import { isExtensionAssetProviderSyncData } from '@/services/extensions/extensionBackendGuards'
import { extensionsClient } from '@/services/extensions/extensionsClient'
import {
  extensionPluginSourceText,
  extensionPluginTags,
  extensionPluginVersion,
  formatExtensionPluginSize
} from '@/services/extensions/extensionsWorkspaceDisplayRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const providerValues = ref<Record<string, string>>({})
const providerLoading = ref(false)
const activeProviderId = ref('')

const isSelectedBusy = computed(() => {
  const id = workspace.selectedExtension?.pluginId
  return Boolean(id && (workspace.extensionInstallLoadingMap[id] || workspace.extensionUpdateLoadingMap[id]))
})

const isSelectedUpdating = computed(() => {
  const id = workspace.selectedExtension?.pluginId
  return Boolean(id && workspace.extensionUpdateLoadingMap[id])
})
const progressStageText = computed(() => {
  const stage = workspace.selectedExtensionInstallProgress?.stage
  if (stage === 'error') return t('terminal.status.error')
  if (stage === 'cancelled') return t('common.cancel')
  if (stage === 'verifying' || stage === 'done') return t('common.processing')
  return isSelectedUpdating.value ? t('extensions.detail.updating') : t('extensions.detail.installing')
})
const downloadProgressVisible = computed(() => workspace.selectedExtensionInstallProgress?.stage === 'downloading')
const downloadProgressButtonStyle = computed(() => ({ '--download-progress': `${workspace.selectedExtensionInstallProgress?.percent || 0}%` }))
const installButtonText = computed(() => {
  if (!isSelectedBusy.value) return t('common.install')
  return t('extensions.detail.installing')
})
const updateButtonText = computed(() => {
  if (!isSelectedBusy.value) return t('extensions.detail.update')
  return t('extensions.detail.updating')
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
  workspace.setExtensionNotice(result ? t('extensions.notice.commandSent') : t('extensions.notice.openWritableTerminal'))
}

const syncProvider = async (providerId: string) => {
  const plugin = workspace.selectedExtension
  if (!plugin || providerLoading.value) return
  const bridge = extensionsClient.syncExtensionAssetProvider()
  if (!bridge) {
    workspace.setExtensionNotice(t('extensions.notice.assetServiceUnavailable'))
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
      workspace.setExtensionNotice(result?.errorMessage || t('extensions.notice.assetImportFailed'))
      return
    }
    if (!isExtensionAssetProviderSyncData(result.data) || result.data.pluginId !== plugin.pluginId || result.data.providerId !== providerId) {
      workspace.setExtensionNotice(t('extensions.notice.invalidServiceData'))
      return
    }
    workspace.setExtensionNotice(t('extensions.notice.importedAssets', { count: result.data.imported }))
  } catch (error) {
    workspace.setExtensionNotice(error instanceof Error ? error.message : t('extensions.notice.assetImportFailed'))
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
  workspace.setExtensionNotice(
    result?.data?.cancelled ? t('extensions.notice.cancellingAssetImport') : t('extensions.notice.noAssetImport')
  )
}

onMounted(() => {
  if (workspace.extensionPlugins.length === 0) void workspace.refreshExtensionPlugins()
})
</script>
