import type { AiopsAssetRecord, AiopsOrganizationAssetRefreshResult } from './contracts/assets'
import type { KubernetesBastionGroup, KubernetesClusterRecord } from './contracts/kubernetes'
import { persistedString } from './kubernetesCatalogPersistence'
import { idPart } from './kubernetesKubeconfigRuntime'

export const jumpserverKubernetesSyncUnavailableMessage = 'JumpServer Kubernetes asset sync requires the live JumpServer backend integration.'

export const jumpserverKubernetesSyncUnavailableError = () =>
  Object.assign(new Error(jumpserverKubernetesSyncUnavailableMessage), { code: 'K8S_BASTION_SYNC_UNAVAILABLE' })

export type KubernetesJumpserverRuntimeOptions = {
  clusters: () => KubernetesClusterRecord[]
  nowLabel: () => string
  refreshOrganizationAssets: (input: { organizationId?: string }) => AiopsOrganizationAssetRefreshResult | Promise<AiopsOrganizationAssetRefreshResult>
  upsertContextForCluster: (cluster: KubernetesClusterRecord, isActive?: boolean) => void
}

const numericAssetId = (asset: AiopsAssetRecord): number | null => {
  const rawId = [asset.id, asset.uuid].map((value) => persistedString(value)).find((value) => /^\d+$/.test(value))
  return rawId ? Number(rawId) : null
}

const assetTagSet = (asset: AiopsAssetRecord) => new Set((Array.isArray(asset.tags) ? asset.tags : []).map((tag) => tag.toLowerCase()))

const jumpserverKubernetesAssetAddress = (asset: AiopsAssetRecord) => persistedString(asset.host) || persistedString(asset.ip)

const jumpserverKubernetesAssetName = (asset: AiopsAssetRecord, address: string) =>
  persistedString(asset.title) || persistedString(asset.name) || address

const jumpserverKubernetesServerUrl = (address: string) => {
  if (/^https?:\/\//i.test(address)) return address
  if (/^\[[^\]]+\]:\d+$/.test(address) || /^[^:]+:\d+$/.test(address)) return address
  return `${address}:6443`
}

const jumpserverKubernetesClusterKey = (bastionUuid: string, address: string, name: string) => `${bastionUuid}\u0000${address}\u0000${name}`

const isJumpserverKubernetesAsset = (asset: AiopsAssetRecord, organizationIds: Set<string>) => {
  if (asset.asset_type === 'organization' || asset.isLocalShell) return false
  const address = jumpserverKubernetesAssetAddress(asset)
  if (!address) return false
  const tags = assetTagSet(asset)
  const belongsToBastion = organizationIds.has(persistedString(asset.organizationId))
  const backendSyncedAsset =
    asset.data_source === 'refresh' || tags.has('jumpserver') || tags.has('synced') || tags.has('k8s') || tags.has('kubernetes')
  return belongsToBastion && backendSyncedAsset
}

const jumpserverKubernetesClusterId = (options: KubernetesJumpserverRuntimeOptions, bastionUuid: string, asset: AiopsAssetRecord, address: string, name: string) => {
  const identity = persistedString(asset.uuid) || persistedString(asset.id) || `${address}-${name}`
  const base = `k8s-js-${idPart(bastionUuid)}-${idPart(identity)}`
  let candidate = base
  let sequence = 2
  const existingIds = new Set(options.clusters().map((cluster) => cluster.id))
  while (existingIds.has(candidate)) {
    candidate = `${base}-${sequence}`
    sequence += 1
  }
  return candidate
}

export const requireJumpserverKubernetesAssetsFromRefresh = async (
  options: KubernetesJumpserverRuntimeOptions,
  bastion: KubernetesBastionGroup
): Promise<AiopsAssetRecord[]> => {
  const result = await options.refreshOrganizationAssets({ organizationId: bastion.uuid })
  if (!result || result.ok !== true || !result.data) {
    const error = Object.assign(new Error(result?.errorMessage || 'JumpServer Kubernetes asset refresh failed.'), {
      code: result?.errorCode || 'K8S_BASTION_SYNC_FAILED'
    })
    throw error
  }
  const data = result.data
  if (
    !Array.isArray(data.assets) ||
    !Array.isArray(data.folders) ||
    !Number.isFinite(data.refreshed) ||
    !Number.isFinite(data.created) ||
    !Number.isFinite(data.updated)
  ) {
    throw Object.assign(new Error('JumpServer Kubernetes asset refresh returned an invalid asset snapshot.'), {
      code: 'K8S_BASTION_SYNC_INVALID'
    })
  }
  const organizationRows = data.assets.filter(
    (asset) =>
      asset.asset_type === 'organization' &&
      (asset.id === bastion.uuid || asset.uuid === bastion.uuid) &&
      (!data.organizationId || asset.id === data.organizationId || asset.uuid === data.organizationId)
  )
  const organizationIds = new Set(
    [bastion.uuid, data.organizationId, ...organizationRows.flatMap((asset) => [asset.id, asset.uuid])]
      .map((value) => persistedString(value))
      .filter(Boolean)
  )
  if (data.organizationId && data.organizationId !== bastion.uuid && organizationRows.length === 0) {
    throw Object.assign(new Error('JumpServer Kubernetes asset refresh returned a different organization.'), {
      code: 'K8S_BASTION_SYNC_MISMATCH'
    })
  }
  return data.assets.filter((asset) => isJumpserverKubernetesAsset(asset, organizationIds))
}

export const upsertJumpserverKubernetesClusters = (
  options: KubernetesJumpserverRuntimeOptions,
  bastion: KubernetesBastionGroup,
  assets: AiopsAssetRecord[]
) => {
  const updates = new Map<string, KubernetesClusterRecord>()
  const inserted: KubernetesClusterRecord[] = []
  const seenKeys = new Set<string>()
  let syncedCount = 0
  let updatedCount = 0

  const existingByKey = new Map<string, KubernetesClusterRecord>()
  options
    .clusters()
    .filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastion.uuid)
    .forEach((cluster) => {
      if (!cluster.bastion_asset_address || !cluster.bastion_asset_name) return
      existingByKey.set(jumpserverKubernetesClusterKey(bastion.uuid, cluster.bastion_asset_address, cluster.bastion_asset_name), cluster)
    })

  assets.forEach((asset) => {
    const address = jumpserverKubernetesAssetAddress(asset)
    if (!address) return
    const name = jumpserverKubernetesAssetName(asset, address)
    const key = jumpserverKubernetesClusterKey(bastion.uuid, address, name)
    if (seenKeys.has(key)) return
    seenKeys.add(key)

    const existing = existingByKey.get(key)
    if (existing) {
      const next: KubernetesClusterRecord = {
        ...existing,
        name,
        context_name: name,
        server_url: jumpserverKubernetesServerUrl(address),
        auth_type: 'jumpserver',
        default_namespace: existing.default_namespace || 'default',
        source_type: 'jumpserver',
        bastion_uuid: bastion.uuid,
        bastion_asset_address: address,
        bastion_asset_name: name,
        bastion_asset_id_last: numericAssetId(asset),
        updated_at: options.nowLabel()
      }
      updates.set(existing.id, next)
      options.upsertContextForCluster(next)
      updatedCount += 1
      return
    }

    const cluster: KubernetesClusterRecord = {
      id: jumpserverKubernetesClusterId(options, bastion.uuid, asset, address, name),
      name,
      kubeconfig_path: null,
      kubeconfig_content: null,
      context_name: name,
      server_url: jumpserverKubernetesServerUrl(address),
      auth_type: 'jumpserver',
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: 'default',
      created_at: options.nowLabel(),
      updated_at: options.nowLabel(),
      source_type: 'jumpserver',
      bastion_uuid: bastion.uuid,
      bastion_asset_address: address,
      bastion_asset_name: name,
      bastion_asset_id_last: numericAssetId(asset)
    }
    inserted.push(cluster)
    options.upsertContextForCluster(cluster, false)
    syncedCount += 1
  })

  const nextClusters = inserted.length || updates.size ? [...inserted, ...options.clusters().map((cluster) => updates.get(cluster.id) || cluster)] : options.clusters()
  return { clusters: nextClusters, syncedCount, updatedCount, changed: inserted.length > 0 || updates.size > 0 }
}
