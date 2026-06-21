import type {
  KubernetesBastionGroup,
  KubernetesClusterRecord,
  KubernetesConnectionStatus,
  KubernetesContextInfo,
  KubernetesImportContextInfo,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceKind
} from './contracts/kubernetes'
import {
  defaultKubernetesBastions,
  defaultKubernetesClusters,
  defaultKubernetesContexts,
  defaultKubernetesImportContexts,
  defaultKubernetesNamespaces,
  defaultKubernetesResources
} from './kubernetesSeedData'

export type KubernetesPersistedCatalogState = {
  version: 1
  contexts: KubernetesContextInfo[]
  clusters: KubernetesClusterRecord[]
  bastions: KubernetesBastionGroup[]
  namespaces: KubernetesNamespaceInfo[]
  resources: KubernetesResource[]
  importContexts: KubernetesImportContextInfo[]
}

export type KubernetesCatalogNormalizeOptions = {
  nowLabel: () => string
  shouldUseSeedData: () => boolean
}

const kubernetesConnectionStatuses = new Set<KubernetesConnectionStatus>(['connected', 'connecting', 'disconnected', 'error'])
const kubernetesClusterSources = new Set<KubernetesClusterRecord['source_type']>(['local', 'jumpserver'])
const kubernetesResourceKinds = new Set<KubernetesResourceKind>(['pods', 'deployments', 'services', 'nodes'])

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = stableValue(value[key])
      if (nextValue !== undefined) result[key] = nextValue
      return result
    }, {})
}

const stableJson = (value: unknown) => JSON.stringify(stableValue(value))

export const persistedString = (value: unknown, fallback = '') => (typeof value === 'string' && value.trim() ? value.trim() : fallback)

const persistedNullableString = (value: unknown) => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

const persistedNumberFlag = (value: unknown) => (value === 1 || value === true || value === '1' ? 1 : 0)

const sanitizeRestoredConnectionStatus = (value: unknown): KubernetesConnectionStatus => {
  const status = typeof value === 'string' && kubernetesConnectionStatuses.has(value as KubernetesConnectionStatus) ? (value as KubernetesConnectionStatus) : 'disconnected'
  return status === 'connected' || status === 'connecting' ? 'disconnected' : status
}

const normalizePersistedContext = (value: unknown): KubernetesContextInfo | null => {
  if (!isRecord(value)) return null
  const name = persistedString(value.name)
  const cluster = persistedString(value.cluster)
  const server = persistedString(value.server)
  if (!name || !cluster) return null
  return {
    name,
    cluster,
    namespace: persistedString(value.namespace, 'default'),
    server,
    isActive: value.isActive === true
  }
}

const normalizePersistedImportContext = (value: unknown): KubernetesImportContextInfo | null => {
  if (!isRecord(value)) return null
  const name = persistedString(value.name)
  const cluster = persistedString(value.cluster)
  const server = persistedString(value.server)
  if (!name || !cluster) return null
  return {
    name,
    cluster,
    server,
    namespace: persistedString(value.namespace, 'default')
  }
}

const normalizePersistedBastion = (value: unknown): KubernetesBastionGroup | null => {
  if (!isRecord(value)) return null
  const uuid = persistedString(value.uuid)
  const label = persistedString(value.label)
  if (!uuid || !label) return null
  return {
    uuid,
    label,
    ip: persistedString(value.ip)
  }
}

const normalizePersistedCluster = (value: unknown, options: KubernetesCatalogNormalizeOptions): KubernetesClusterRecord | null => {
  if (!isRecord(value)) return null
  const id = persistedString(value.id)
  const name = persistedString(value.name)
  const contextName = persistedString(value.context_name)
  const serverUrl = persistedString(value.server_url)
  if (!id || !name || !contextName || !serverUrl) return null
  const sourceType =
    typeof value.source_type === 'string' && kubernetesClusterSources.has(value.source_type as KubernetesClusterRecord['source_type'])
      ? (value.source_type as KubernetesClusterRecord['source_type'])
      : 'local'
  return {
    id,
    name,
    kubeconfig_path: persistedNullableString(value.kubeconfig_path),
    kubeconfig_content: typeof value.kubeconfig_content === 'string' && value.kubeconfig_content.trim() ? value.kubeconfig_content : null,
    context_name: contextName,
    server_url: serverUrl,
    auth_type: persistedString(value.auth_type, sourceType === 'jumpserver' ? 'jumpserver' : 'kubeconfig'),
    is_active: persistedNumberFlag(value.is_active),
    connection_status: sanitizeRestoredConnectionStatus(value.connection_status),
    auto_connect: persistedNumberFlag(value.auto_connect),
    default_namespace: persistedString(value.default_namespace, 'default'),
    created_at: typeof value.created_at === 'string' ? value.created_at : options.nowLabel(),
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : options.nowLabel(),
    source_type: sourceType,
    bastion_uuid: persistedNullableString(value.bastion_uuid),
    bastion_asset_address: persistedNullableString(value.bastion_asset_address),
    bastion_asset_name: persistedNullableString(value.bastion_asset_name),
    bastion_asset_id_last: Number.isFinite(Number(value.bastion_asset_id_last)) ? Number(value.bastion_asset_id_last) : null
  }
}

const normalizePersistedNamespace = (value: unknown, knownClusterIds: Set<string>): KubernetesNamespaceInfo | null => {
  if (!isRecord(value)) return null
  const id = persistedString(value.id)
  const clusterId = persistedString(value.clusterId)
  const name = persistedString(value.name)
  if (!id || !clusterId || !name || !knownClusterIds.has(clusterId)) return null
  return {
    id,
    clusterId,
    name,
    status: persistedString(value.status, 'Unknown'),
    age: persistedString(value.age, '-')
  }
}

const normalizePersistedResource = (value: unknown, knownClusterIds: Set<string>): KubernetesResource | null => {
  if (!isRecord(value)) return null
  const id = persistedString(value.id)
  const clusterId = persistedString(value.clusterId)
  const kind = typeof value.kind === 'string' && kubernetesResourceKinds.has(value.kind as KubernetesResourceKind) ? (value.kind as KubernetesResourceKind) : null
  const name = persistedString(value.name)
  if (!id || !clusterId || !kind || !name || !knownClusterIds.has(clusterId)) return null
  const restarts = Number(value.restarts)
  return {
    id,
    clusterId,
    kind,
    name,
    namespace: persistedString(value.namespace, kind === 'nodes' ? 'cluster' : 'default'),
    status: persistedString(value.status, 'Unknown'),
    ready: persistedString(value.ready, '-'),
    age: persistedString(value.age, '-'),
    detail: persistedString(value.detail),
    ...(persistedString(value.node) ? { node: persistedString(value.node) } : {}),
    ...(persistedString(value.image) ? { image: persistedString(value.image) } : {}),
    ...(persistedString(value.ports) ? { ports: persistedString(value.ports) } : {}),
    ...(Number.isFinite(restarts) ? { restarts: Math.max(0, Math.round(restarts)) } : {}),
    ...(persistedString(value.selector) ? { selector: persistedString(value.selector) } : {})
  }
}

const uniqueBy = <T>(items: T[], keyOf: (item: T) => string) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const createNormalizedSeedMaps = (options: KubernetesCatalogNormalizeOptions) => {
  const seedClusterIds = new Set(defaultKubernetesClusters.map((cluster) => cluster.id))
  return {
    contexts: new Map(defaultKubernetesContexts.map((context) => [context.name, normalizePersistedContext(context)!])),
    importContexts: new Map(
      defaultKubernetesImportContexts.map((context) => [context.name, normalizePersistedImportContext(context)!])
    ),
    bastions: new Map(defaultKubernetesBastions.map((bastion) => [bastion.uuid, normalizePersistedBastion(bastion)!])),
    clusters: new Map(defaultKubernetesClusters.map((cluster) => [cluster.id, normalizePersistedCluster(cluster, options)!])),
    namespaces: new Map(defaultKubernetesNamespaces.map((namespace) => [namespace.id, normalizePersistedNamespace(namespace, seedClusterIds)!])),
    resources: new Map(defaultKubernetesResources.map((resource) => [resource.id, normalizePersistedResource(resource, seedClusterIds)!]))
  }
}

const isSeedEqualById = <T extends { id: string }>(item: T, seedItems: Map<string, T>) => {
  const seed = seedItems.get(item.id)
  return Boolean(seed && stableJson(item) === stableJson(seed))
}

const isSeedEqualByName = <T extends { name: string }>(item: T, seedItems: Map<string, T>) => {
  const seed = seedItems.get(item.name)
  return Boolean(seed && stableJson(item) === stableJson(seed))
}

const isSeedEqualByUuid = <T extends { uuid: string }>(item: T, seedItems: Map<string, T>) => {
  const seed = seedItems.get(item.uuid)
  return Boolean(seed && stableJson(item) === stableJson(seed))
}

const stripLegacySeedKubernetesState = (
  state: KubernetesPersistedCatalogState,
  options: KubernetesCatalogNormalizeOptions
): KubernetesPersistedCatalogState => {
  if (options.shouldUseSeedData()) return state
  const seeds = createNormalizedSeedMaps(options)
  const clusters = state.clusters.filter((cluster) => !isSeedEqualById(cluster, seeds.clusters))
  const keptClusterIds = new Set(clusters.map((cluster) => cluster.id))
  const keptContextNames = new Set(clusters.map((cluster) => cluster.context_name))
  const keptBastionUuids = new Set(clusters.map((cluster) => cluster.bastion_uuid).filter((uuid): uuid is string => Boolean(uuid)))
  const contexts = state.contexts.filter((context) => keptContextNames.has(context.name) || !isSeedEqualByName(context, seeds.contexts))
  const importContexts = state.importContexts.filter((context) => keptContextNames.has(context.name) || !isSeedEqualByName(context, seeds.importContexts))
  const bastions = state.bastions.filter((bastion) => keptBastionUuids.has(bastion.uuid) || !isSeedEqualByUuid(bastion, seeds.bastions))
  return {
    version: 1,
    contexts,
    clusters,
    bastions,
    namespaces: state.namespaces.filter((namespace) => keptClusterIds.has(namespace.clusterId) && !isSeedEqualById(namespace, seeds.namespaces)),
    resources: state.resources.filter((resource) => keptClusterIds.has(resource.clusterId) && !isSeedEqualById(resource, seeds.resources)),
    importContexts
  }
}

export const normalizePersistedKubernetesState = (
  value: unknown,
  options: KubernetesCatalogNormalizeOptions
): KubernetesPersistedCatalogState | null => {
  if (!isRecord(value)) return null
  const clusters = Array.isArray(value.clusters)
    ? uniqueBy(
        value.clusters.map((cluster) => normalizePersistedCluster(cluster, options)).filter((cluster): cluster is KubernetesClusterRecord => Boolean(cluster)),
        (cluster) => cluster.id
      )
    : []
  const knownClusterIds = new Set(clusters.map((cluster) => cluster.id))
  const contexts = Array.isArray(value.contexts)
    ? uniqueBy(
        value.contexts.map(normalizePersistedContext).filter((context): context is KubernetesContextInfo => Boolean(context)),
        (context) => context.name
      )
    : []
  const bastions = Array.isArray(value.bastions)
    ? uniqueBy(
        value.bastions.map(normalizePersistedBastion).filter((bastion): bastion is KubernetesBastionGroup => Boolean(bastion)),
        (bastion) => bastion.uuid
      )
    : []
  const state: KubernetesPersistedCatalogState = {
    version: 1,
    contexts,
    clusters,
    bastions,
    namespaces: Array.isArray(value.namespaces)
      ? uniqueBy(
          value.namespaces
            .map((namespace) => normalizePersistedNamespace(namespace, knownClusterIds))
            .filter((namespace): namespace is KubernetesNamespaceInfo => Boolean(namespace)),
          (namespace) => namespace.id
        )
      : [],
    resources: Array.isArray(value.resources)
      ? uniqueBy(
          value.resources
            .map((resource) => normalizePersistedResource(resource, knownClusterIds))
            .filter((resource): resource is KubernetesResource => Boolean(resource)),
          (resource) => resource.id
        )
      : [],
    importContexts: Array.isArray(value.importContexts)
      ? uniqueBy(
          value.importContexts.map(normalizePersistedImportContext).filter((context): context is KubernetesImportContextInfo => Boolean(context)),
          (context) => context.name
        )
      : []
  }
  return stripLegacySeedKubernetesState(state, options)
}
