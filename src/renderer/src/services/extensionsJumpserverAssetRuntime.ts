import { computed, ref } from 'vue'
import { assetsClient } from '@/services/assetsClient'
import {
  isAiopsAssetSnapshot,
  isAiopsJumpserverOrganization,
  isAiopsJumpserverOrganizationAssetRefreshData,
  malformedAssetBackendResultMessage
} from '@/services/assetBackendGuards'
import type { AiopsAssetSnapshot } from '@shared/contracts/assets'

type ExtensionsJumpserverAssetRuntimeDeps = {
  selectedPluginId: () => string | undefined
}

const emptySnapshot = (): AiopsAssetSnapshot => ({ assets: [], folders: [] })

const cloneSnapshot = (snapshot: AiopsAssetSnapshot): AiopsAssetSnapshot => ({
  assets: snapshot.assets.map((asset) => ({ ...asset, tags: [...asset.tags] })),
  folders: snapshot.folders.map((folder) => ({ ...folder }))
})

export const createExtensionsJumpserverAssetRuntime = (deps: ExtensionsJumpserverAssetRuntimeDeps) => {
  const jumpserverAssetSnapshot = ref<AiopsAssetSnapshot>(emptySnapshot())
  const jumpserverAssetLoading = ref(false)
  const jumpserverAssetError = ref('')
  const jumpserverAssetNotice = ref('')

  const jumpserverOrganizations = computed(() => jumpserverAssetSnapshot.value.assets.filter(isAiopsJumpserverOrganization))
  const jumpserverOrganizationIds = computed(() => new Set(jumpserverOrganizations.value.flatMap((asset) => [asset.id, asset.uuid])))
  const jumpserverSyncedAssets = computed(() =>
    jumpserverAssetSnapshot.value.assets.filter(
      (asset) =>
        !asset.isLocalShell &&
        asset.asset_type !== 'organization' &&
        asset.data_source === 'refresh' &&
        (asset.tags.some((tag) => tag.toLowerCase() === 'jumpserver') || Boolean(asset.organizationId && jumpserverOrganizationIds.value.has(asset.organizationId)))
    )
  )
  const jumpserverOnlineSyncedAssets = computed(() => jumpserverSyncedAssets.value.filter((asset) => asset.status === 'online'))

  const applyJumpserverRefreshSnapshot = (snapshot: unknown) => {
    if (!isAiopsAssetSnapshot(snapshot)) return false
    jumpserverAssetSnapshot.value = cloneSnapshot(snapshot)
    return true
  }

  const loadJumpserverAssetSnapshot = async () => {
    if (deps.selectedPluginId() !== 'jumpserverSupport') return false
    const listAssets = assetsClient.listAssets()
    if (typeof listAssets !== 'function') {
      jumpserverAssetError.value = '资产列表服务不可用'
      return false
    }
    jumpserverAssetLoading.value = true
    try {
      const snapshot = await listAssets()
      if (!isAiopsAssetSnapshot(snapshot)) throw new Error(malformedAssetBackendResultMessage)
      jumpserverAssetSnapshot.value = cloneSnapshot(snapshot)
      jumpserverAssetError.value = ''
      return true
    } catch (error) {
      jumpserverAssetError.value = error instanceof Error ? error.message : '资产列表加载失败'
      return false
    } finally {
      jumpserverAssetLoading.value = false
    }
  }

  const refreshJumpserverAssets = async (organizationId?: string) => {
    const refreshOrganizationAssets = assetsClient.refreshOrganizationAssets()
    if (typeof refreshOrganizationAssets !== 'function') {
      jumpserverAssetError.value = '组织资产刷新服务不可用'
      return false
    }
    const targetOrganizationId = organizationId || jumpserverOrganizations.value[0]?.id
    if (!targetOrganizationId) {
      jumpserverAssetNotice.value = '请先在资产管理中新增 Jumpserver 数据源'
      return false
    }
    jumpserverAssetLoading.value = true
    try {
      const result = await refreshOrganizationAssets({ organizationId: targetOrganizationId })
      if (!result?.ok) throw new Error(result?.errorMessage || '组织资产刷新失败')
      if (!isAiopsJumpserverOrganizationAssetRefreshData(result.data, targetOrganizationId)) throw new Error(malformedAssetBackendResultMessage)
      applyJumpserverRefreshSnapshot(result.data)
      jumpserverAssetError.value = ''
      jumpserverAssetNotice.value = `刷新完成：新增 ${result.data.created}，更新 ${result.data.updated}`
      return true
    } catch (error) {
      jumpserverAssetError.value = error instanceof Error ? error.message : '组织资产刷新失败'
      return false
    } finally {
      jumpserverAssetLoading.value = false
    }
  }

  return {
    jumpserverAssetSnapshot,
    jumpserverAssetLoading,
    jumpserverAssetError,
    jumpserverAssetNotice,
    jumpserverOrganizations,
    jumpserverSyncedAssets,
    jumpserverOnlineSyncedAssets,
    applyJumpserverRefreshSnapshot,
    loadJumpserverAssetSnapshot,
    refreshJumpserverAssets
  }
}

export type ExtensionsJumpserverAssetRuntime = ReturnType<typeof createExtensionsJumpserverAssetRuntime>
