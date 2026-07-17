import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import type { AiopsOrganizationAssetRefreshResult } from './contracts/assets'
import type { AiopsMutationResult } from './contracts/common'
import type {
  KubernetesBastionGroup,
  KubernetesBastionSyncResult,
  KubernetesCatalog,
  KubernetesClusterInput,
  KubernetesClusterMutationResult,
  KubernetesClusterRecord,
  KubernetesClusterTestInput,
  KubernetesClusterTestResult,
  KubernetesClusterUpdateInput,
  KubernetesContextInfo,
  KubernetesContextSwitchResult,
  KubernetesImportContextInfo,
  KubernetesKubeconfigImportInput,
  KubernetesKubeconfigImportResult,
  KubernetesNamespaceInfo,
  KubernetesResource
} from './contracts/kubernetes'
import {
  probeKubernetesClusterConnection,
  requireRunnableKubernetesClusterInput,
  type KubernetesKubectlRuntimeOptions,
  type KubernetesNonRunnableReason
} from './kubernetesKubectlRuntime'
import { parseKubeconfig, parseKubeconfigContexts } from './kubernetesKubeconfigRuntime'
import { requireJumpserverKubernetesAssetsFromRefresh, upsertJumpserverKubernetesClusters } from './kubernetesJumpserverRuntime'

type KubernetesClusterRuntimeOptions = {
  contexts: () => KubernetesContextInfo[]
  setContexts: (contexts: KubernetesContextInfo[]) => void
  clusters: () => KubernetesClusterRecord[]
  setClusters: (clusters: KubernetesClusterRecord[]) => void
  bastions: () => KubernetesBastionGroup[]
  namespaces: () => KubernetesNamespaceInfo[]
  setNamespaces: (namespaces: KubernetesNamespaceInfo[]) => void
  resources: () => KubernetesResource[]
  setResources: (resources: KubernetesResource[]) => void
  importContexts: () => KubernetesImportContextInfo[]
  setImportContexts: (contexts: KubernetesImportContextInfo[]) => void
  /** 集群连接成功后激活挂起的终端会话(PTY 会话在此刻拉起 shell)。 */
  activateClusterTerminalSessions: (clusterId: string) => Promise<void>
  /** 断开/删除集群时释放其终端会话(杀 PTY、清理临时 kubeconfig、发 exit 事件)。 */
  disposeClusterTerminalSessions: (clusterId: string) => void
  ensureCatalogStateLoaded: () => void
  cloneCatalog: () => KubernetesCatalog
  persistCatalogState: () => void
  shouldUseSeedData: () => boolean
  developmentSeedClusterIds: Set<string>
  kubectlRuntimeOptions: () => KubernetesKubectlRuntimeOptions
  canRunLocalKubectl: (cluster: KubernetesClusterRecord) => boolean
  nonRunnableKubernetesReason: (cluster: KubernetesClusterRecord) => KubernetesNonRunnableReason | null
  refreshOrganizationAssets: () => (input: { organizationId?: string }) => AiopsOrganizationAssetRefreshResult | Promise<AiopsOrganizationAssetRefreshResult>
  failClusterSessions: (clusterId: string, errorMessage: string) => void
  nowLabel: () => string
}

const toMutationError = <T>(error: unknown, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode
  return {
    ok: false,
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error)
  }
}

const asResult = <T>(fn: () => T, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return toMutationError(error, fallbackCode)
  }
}

export const createKubernetesClusterRuntime = (options: KubernetesClusterRuntimeOptions) => {
  const requireCluster = (id: string) => {
    options.ensureCatalogStateLoaded()
    const cluster = options.clusters().find((item) => item.id === id)
    if (!cluster) throw Object.assign(new Error('Kubernetes cluster not found.'), { code: 'K8S_CLUSTER_NOT_FOUND' })
    return cluster
  }

  const upsertContextForCluster = (cluster: KubernetesClusterRecord, isActive = cluster.is_active === 1) => {
    const context: KubernetesContextInfo = {
      name: cluster.context_name,
      cluster: cluster.name,
      namespace: cluster.default_namespace || 'default',
      server: cluster.server_url,
      isActive
    }
    options.setContexts(
      options.contexts().some((item) => item.name === context.name)
        ? options.contexts().map((item) => (item.name === context.name ? context : item))
        : [context, ...options.contexts()]
    )
    const importContext = { name: context.name, cluster: context.cluster, server: context.server, namespace: context.namespace }
    options.setImportContexts(
      options.importContexts().some((item) => item.name === context.name)
        ? options.importContexts().map((item) => (item.name === context.name ? importContext : item))
        : [importContext, ...options.importContexts()]
    )
  }

  const markClusterRuntimeError = (cluster: KubernetesClusterRecord, errorMessage: string) => {
    const failed: KubernetesClusterRecord = {
      ...cluster,
      is_active: 0,
      connection_status: 'error',
      updated_at: options.nowLabel()
    }
    options.setClusters(options.clusters().map((item) => (item.id === cluster.id ? failed : item)))
    options.setContexts(options.contexts().map((context) => (context.name === cluster.context_name ? { ...context, isActive: false } : context)))
    options.failClusterSessions(cluster.id, errorMessage)
    return failed
  }

  const findTestContext = (contextName: string): KubernetesImportContextInfo | null => {
    options.ensureCatalogStateLoaded()
    const imported = options.importContexts().find((context) => context.name === contextName)
    if (imported) return { ...imported }
    const listed = options.contexts().find((context) => context.name === contextName)
    if (listed) return { name: listed.name, cluster: listed.cluster, server: listed.server, namespace: listed.namespace }
    const cluster = options.clusters().find((item) => item.context_name === contextName)
    if (!cluster) return null
    return {
      name: cluster.context_name,
      cluster: cluster.name,
      server: cluster.server_url,
      namespace: cluster.default_namespace || 'default'
    }
  }

  const switchContext = async (contextName: string): Promise<KubernetesContextSwitchResult> =>
    asResult(() => {
      options.ensureCatalogStateLoaded()
      const name = contextName.trim()
      const context = options.contexts().find((item) => item.name === name)
      if (!context) throw Object.assign(new Error('Kubernetes context not found.'), { code: 'K8S_CONTEXT_NOT_FOUND' })
      options.setContexts(options.contexts().map((item) => ({ ...item, isActive: item.name === name })))
      const cluster = options.clusters().find((item) => item.context_name === name)
      if (cluster) {
        options.setClusters(options.clusters().map((item) => ({ ...item, is_active: item.id === cluster.id ? 1 : 0 })))
      }
      options.persistCatalogState()
      return {
        ...options.cloneCatalog(),
        currentContext: name
      }
    })

  const testClusterConnection = async (input: KubernetesClusterTestInput): Promise<KubernetesClusterTestResult> => {
    try {
      options.ensureCatalogStateLoaded()
      const contextName = input.contextName?.trim() || ''
      const requestedServerUrl = input.serverUrl?.trim() || ''
      if (!contextName) {
        throw Object.assign(new Error('Kubernetes context is required.'), { code: 'K8S_TEST_CONTEXT_REQUIRED' })
      }

      const existingCluster = options.clusters().find((item) => item.context_name === contextName)
      const canUseExistingClusterKubeconfig = Boolean(
        existingCluster && !(options.shouldUseSeedData() && options.developmentSeedClusterIds.has(existingCluster.id))
      )
      const content = input.kubeconfigContent?.trim() || (canUseExistingClusterKubeconfig ? existingCluster?.kubeconfig_content?.trim() || '' : '')
      const parsedContexts = content ? parseKubeconfigContexts(content) : []
      const context = content ? parsedContexts.find((item) => item.name === contextName) || null : findTestContext(contextName)
      if (content && !context) {
        throw Object.assign(new Error('Kubernetes context not found in kubeconfig content.'), { code: 'K8S_TEST_CONTEXT_NOT_FOUND' })
      }
      const serverUrl = requestedServerUrl || context?.server || ''
      if (!serverUrl) {
        throw Object.assign(new Error('Kubernetes server URL is required.'), { code: 'K8S_TEST_SERVER_REQUIRED' })
      }
      if (context?.server && requestedServerUrl && context.server !== requestedServerUrl) {
        throw Object.assign(new Error('Kubernetes server URL does not match the selected context.'), { code: 'K8S_TEST_SERVER_MISMATCH' })
      }

      const kubeconfigPath = input.kubeconfigPath?.trim() || (canUseExistingClusterKubeconfig ? existingCluster?.kubeconfig_path?.trim() || '' : '')
      const defaultNamespace = context?.namespace || 'default'
      if (!content && !kubeconfigPath && options.shouldUseSeedData() && context) {
        return {
          ok: true,
          data: {
            success: true,
            isValid: true,
            contextName,
            serverUrl,
            message: '连接测试成功'
          }
        }
      }

      const probeCluster: KubernetesClusterRecord = {
        id: `k8s-test-${randomUUID()}`,
        name: context?.cluster || contextName,
        kubeconfig_path: kubeconfigPath || null,
        kubeconfig_content: content || null,
        context_name: contextName,
        server_url: serverUrl,
        auth_type: 'kubeconfig',
        is_active: 0,
        connection_status: 'disconnected',
        auto_connect: 0,
        default_namespace: defaultNamespace,
        created_at: options.nowLabel(),
        updated_at: options.nowLabel(),
        source_type: 'local',
        bastion_uuid: null,
        bastion_asset_address: null,
        bastion_asset_name: null,
        bastion_asset_id_last: null
      }
      const probe = await probeKubernetesClusterConnection(probeCluster, options.kubectlRuntimeOptions())
      return {
        ok: true,
        data: probe
      }
    } catch (error) {
      return toMutationError(error, 'K8S_TEST_FAILED')
    }
  }

  const importKubeconfig = async (input: KubernetesKubeconfigImportInput): Promise<KubernetesKubeconfigImportResult> => {
    try {
      options.ensureCatalogStateLoaded()
      const requestId = input.requestId?.trim() || ''
      const kubeconfigPath = input.kubeconfigPath?.trim() || ''
      const providedContent = input.kubeconfigContent ?? ''
      if (!kubeconfigPath && !providedContent.trim()) {
        return { ok: false, errorCode: 'K8S_KUBECONFIG_REQUIRED', errorMessage: 'Kubeconfig path or content is required.' }
      }
      let kubeconfigContent = providedContent
      if (!kubeconfigContent.trim()) {
        try {
          kubeconfigContent = await readFile(kubeconfigPath, 'utf-8')
        } catch (error) {
          return {
            ok: false,
            errorCode: 'K8S_KUBECONFIG_READ_FAILED',
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        }
      }
      const parsed = parseKubeconfig(kubeconfigContent)
      if (!parsed.contexts.length) {
        return { ok: false, errorCode: 'K8S_KUBECONFIG_CONTEXTS_EMPTY', errorMessage: 'No kubeconfig contexts were found.' }
      }
      options.setImportContexts(parsed.contexts.map((context) => ({ ...context })))
      options.persistCatalogState()
      return {
        ok: true,
        data: {
          requestId,
          contexts: parsed.contexts.map((context) => ({ ...context })),
          kubeconfigPath,
          kubeconfigContent,
          currentContext: parsed.currentContext
        }
      }
    } catch (error) {
      return {
        ok: false,
        errorCode: 'K8S_KUBECONFIG_IMPORT_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const addCluster = async (input: KubernetesClusterInput): Promise<KubernetesClusterMutationResult> =>
    asResult(() => {
      options.ensureCatalogStateLoaded()
      const name = input.name.trim()
      const contextName = input.contextName.trim()
      const serverUrl = input.serverUrl.trim()
      if (!name || !contextName || !serverUrl) {
        throw Object.assign(new Error('Cluster name, context and server URL are required.'), { code: 'K8S_CLUSTER_REQUIRED' })
      }
      requireRunnableKubernetesClusterInput({
        name,
        contextName,
        serverUrl,
        sourceType: input.sourceType,
        authType: input.authType,
        kubeconfigPath: input.kubeconfigPath,
        kubeconfigContent: input.kubeconfigContent
      })
      const cluster: KubernetesClusterRecord = {
        id: `k8s-${randomUUID()}`,
        name,
        kubeconfig_path: input.kubeconfigPath?.trim() || null,
        kubeconfig_content: input.kubeconfigContent?.trim() || null,
        context_name: contextName,
        server_url: serverUrl,
        auth_type: input.authType || (input.sourceType === 'jumpserver' ? 'jumpserver' : 'kubeconfig'),
        is_active: 0,
        connection_status: 'disconnected',
        auto_connect: input.autoConnect ? 1 : 0,
        default_namespace: input.defaultNamespace?.trim() || 'default',
        created_at: options.nowLabel(),
        updated_at: options.nowLabel(),
        source_type: input.sourceType || 'local',
        bastion_uuid: input.bastionUuid || null,
        bastion_asset_address: null,
        bastion_asset_name: null,
        bastion_asset_id_last: null
      }
      options.setClusters([cluster, ...options.clusters()])
      upsertContextForCluster(cluster, false)
      options.persistCatalogState()
      return {
        ...options.cloneCatalog(),
        cluster: { ...cluster }
      }
    })

  const updateCluster = async (id: string, input: KubernetesClusterUpdateInput): Promise<KubernetesClusterMutationResult> =>
    asResult(() => {
      const current = requireCluster(id)
      const kubeconfigPathProvided = input.kubeconfigPath !== undefined
      const kubeconfigContentProvided = input.kubeconfigContent !== undefined
      if ((kubeconfigPathProvided || kubeconfigContentProvided) && (current.source_type === 'jumpserver' || current.auth_type === 'jumpserver')) {
        throw Object.assign(new Error('JumpServer Kubernetes clusters do not use kubeconfig credentials.'), {
          code: 'K8S_CLUSTER_KUBECONFIG_NOT_SUPPORTED'
        })
      }
      const nextKubeconfigPath = kubeconfigPathProvided ? input.kubeconfigPath?.trim() || null : current.kubeconfig_path
      const nextKubeconfigContent = kubeconfigContentProvided ? input.kubeconfigContent?.trim() || null : current.kubeconfig_content
      const kubeconfigChanged = nextKubeconfigPath !== current.kubeconfig_path || nextKubeconfigContent !== current.kubeconfig_content
      const next: KubernetesClusterRecord = {
        ...current,
        name: input.name?.trim() || current.name,
        default_namespace: input.defaultNamespace?.trim() || current.default_namespace,
        auto_connect: input.autoConnect === undefined ? current.auto_connect : input.autoConnect ? 1 : 0,
        kubeconfig_path: nextKubeconfigPath,
        kubeconfig_content: nextKubeconfigContent,
        // kubeconfig 变更后旧连接状态不再可信,退回 disconnected 促使重新探测。
        connection_status: kubeconfigChanged ? 'disconnected' : current.connection_status,
        updated_at: options.nowLabel()
      }
      requireRunnableKubernetesClusterInput({
        name: next.name,
        contextName: next.context_name,
        serverUrl: next.server_url,
        sourceType: next.source_type,
        authType: next.auth_type,
        kubeconfigPath: next.kubeconfig_path,
        kubeconfigContent: next.kubeconfig_content
      })
      options.setClusters(options.clusters().map((cluster) => (cluster.id === id ? next : cluster)))
      upsertContextForCluster(next)
      options.persistCatalogState()
      return {
        ...options.cloneCatalog(),
        cluster: { ...next }
      }
    })

  const deleteCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
    asResult(() => {
      const current = requireCluster(id)
      options.setClusters(options.clusters().filter((cluster) => cluster.id !== id))
      // context 以 name 全局共享:仅当没有其他集群仍引用同名 context 时才移除,避免删除一个集群导致同 context 的其余集群失联。
      const contextStillReferenced = options.clusters().some((cluster) => cluster.context_name === current.context_name)
      if (!contextStillReferenced) options.setContexts(options.contexts().filter((context) => context.name !== current.context_name))
      options.setNamespaces(options.namespaces().filter((namespace) => namespace.clusterId !== id))
      options.setResources(options.resources().filter((resource) => resource.clusterId !== id))
      options.disposeClusterTerminalSessions(id)
      options.persistCatalogState()
      return options.cloneCatalog()
    })

  const connectCluster = async (id: string): Promise<KubernetesClusterMutationResult> => {
    try {
      const current = requireCluster(id)
      const nonRunnableReason = options.canRunLocalKubectl(current) ? null : options.nonRunnableKubernetesReason(current)
      if (nonRunnableReason) {
        const failed = markClusterRuntimeError(current, nonRunnableReason.message)
        options.persistCatalogState()
        return {
          ok: false,
          data: {
            ...options.cloneCatalog(),
            cluster: { ...failed }
          },
          errorCode: nonRunnableReason.code,
          errorMessage: nonRunnableReason.message
        }
      }
      if (!(options.shouldUseSeedData() && options.developmentSeedClusterIds.has(current.id))) {
        const probe = await probeKubernetesClusterConnection(current, options.kubectlRuntimeOptions())
        if (!probe.success) {
          const errorMessage = probe.error || probe.message || 'Kubernetes connection probe failed.'
          const failed = markClusterRuntimeError(current, errorMessage)
          options.persistCatalogState()
          return {
            ok: false,
            data: {
              ...options.cloneCatalog(),
              cluster: { ...failed }
            },
            errorCode: 'K8S_CONNECT_PROBE_FAILED',
            errorMessage
          }
        }
      }
      options.setClusters(
        options.clusters().map((cluster) => ({
          ...cluster,
          is_active: cluster.id === id ? 1 : 0,
          connection_status: cluster.id === id ? 'connected' : cluster.connection_status === 'connected' ? 'disconnected' : cluster.connection_status,
          updated_at: cluster.id === id ? options.nowLabel() : cluster.updated_at
        }))
      )
      await options.activateClusterTerminalSessions(id)
      options.setContexts(options.contexts().map((context) => ({ ...context, isActive: context.name === current.context_name })))
      const connected = requireCluster(id)
      options.persistCatalogState()
      return {
        ok: true,
        data: {
          ...options.cloneCatalog(),
          cluster: { ...connected }
        }
      }
    } catch (error) {
      return toMutationError(error, 'K8S_CONNECT_FAILED')
    }
  }

  const disconnectCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
    asResult(() => {
      const current = requireCluster(id)
      const next = {
        ...current,
        is_active: 0,
        connection_status: 'disconnected' as const,
        updated_at: options.nowLabel()
      }
      options.setClusters(options.clusters().map((cluster) => (cluster.id === id ? next : cluster)))
      options.disposeClusterTerminalSessions(id)
      options.persistCatalogState()
      return {
        ...options.cloneCatalog(),
        cluster: { ...next }
      }
    })

  const syncBastion = async (bastionUuid: string): Promise<KubernetesBastionSyncResult> => {
    try {
      options.ensureCatalogStateLoaded()
      const bastion = options.bastions().find((item) => item.uuid === bastionUuid)
      if (!bastion) throw Object.assign(new Error('Kubernetes bastion not found.'), { code: 'K8S_BASTION_NOT_FOUND' })
      if (!options.shouldUseSeedData()) {
        const jumpserverOptions = {
          clusters: options.clusters,
          nowLabel: options.nowLabel,
          refreshOrganizationAssets: options.refreshOrganizationAssets(),
          upsertContextForCluster
        }
        const assets = await requireJumpserverKubernetesAssetsFromRefresh(jumpserverOptions, bastion)
        const result = upsertJumpserverKubernetesClusters(jumpserverOptions, bastion, assets)
        options.setClusters(result.clusters)
        if (result.changed) options.persistCatalogState()
        return {
          ok: true,
          data: {
            ...options.cloneCatalog(),
            syncedCount: result.syncedCount,
            updatedCount: result.updatedCount
          }
        }
      }
      const existing = options.clusters().filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid)
      if (existing.length) {
        options.setClusters(
          options.clusters().map((cluster) =>
            cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid ? { ...cluster, updated_at: options.nowLabel() } : cluster
          )
        )
        options.persistCatalogState()
        return {
          ok: true,
          data: {
            ...options.cloneCatalog(),
            syncedCount: 0,
            updatedCount: existing.length
          }
        }
      }

      const cluster: KubernetesClusterRecord = {
        id: `k8s-${randomUUID()}`,
        name: `${bastion.label}-k8s`,
        kubeconfig_path: null,
        kubeconfig_content: null,
        context_name: `${bastion.label}/synced`,
        server_url: `${bastion.ip}:6443`,
        auth_type: 'jumpserver',
        is_active: 0,
        connection_status: 'disconnected',
        auto_connect: 0,
        default_namespace: 'default',
        created_at: options.nowLabel(),
        updated_at: options.nowLabel(),
        source_type: 'jumpserver',
        bastion_uuid: bastion.uuid,
        bastion_asset_address: bastion.ip,
        bastion_asset_name: bastion.label,
        bastion_asset_id_last: null
      }
      options.setClusters([cluster, ...options.clusters()])
      upsertContextForCluster(cluster, false)
      options.persistCatalogState()
      return {
        ok: true,
        data: {
          ...options.cloneCatalog(),
          syncedCount: 1,
          updatedCount: 0
        }
      }
    } catch (error) {
      return toMutationError(error)
    }
  }

  return {
    requireCluster,
    markClusterRuntimeError,
    switchContext,
    testClusterConnection,
    importKubeconfig,
    addCluster,
    updateCluster,
    deleteCluster,
    connectCluster,
    disconnectCluster,
    syncBastion
  }
}
