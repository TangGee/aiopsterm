import type { Ref } from 'vue'
import {
  isK8sBastionSyncData,
  isK8sClusterDeleteData,
  isK8sClusterMutationData,
  isK8sClusterTestDataForRequest,
  isK8sKubeconfigImportDataForRequest,
  type K8sBastionGroup,
  type K8sCluster,
  type K8sImportContextInfo,
  type K8sKubeconfigImportRequest,
  type K8sProxyConfig
} from '@/services/kubernetes/kubernetesBackendGuards'
import { kubernetesClient } from '@/services/kubernetes/kubernetesClient'
import { updateK8sIdSet } from '@/services/kubernetes/kubernetesRuntime'
import type { KubernetesCatalog, KubernetesClusterTestInput } from '@shared/contracts/kubernetes'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type K8sAgentStatus = 'idle' | 'ready' | 'running' | 'error'

type K8sKubeconfigImportResult = {
  success: boolean
  contexts: K8sImportContextInfo[]
  kubeconfigPath: string
  kubeconfigContent: string
  currentContext: string
  stale?: boolean
  error?: string
}

type WorkspaceKubernetesClusterOperationsState = {
  k8sClusters: Ref<K8sCluster[]>
  k8sBastions: Ref<K8sBastionGroup[]>
  k8sConnectingClusterIds: Ref<string[]>
  k8sSyncingBastionIds: Ref<string[]>
  k8sDeleteConfirmClusterId: Ref<string | null>
  k8sImportContexts: Ref<K8sImportContextInfo[]>
  k8sActiveClusterId: Ref<string | null>
  k8sConfigTab: Ref<'local' | 'jumpserver'>
  k8sSelectedClusterId: Ref<string | null>
  k8sAddModalOpen: Ref<boolean>
  k8sEditModalOpen: Ref<boolean>
  k8sEditingClusterId: Ref<string | null>
  k8sTestResult: Ref<boolean | null>
  k8sCollapsedBastionIds: Ref<string[]>
  k8sAgentClusterId: Ref<string | null>
  k8sAgentContextName: Ref<string>
  k8sAgentStatus: Ref<K8sAgentStatus>
  savedK8sProxyConfig: Ref<K8sProxyConfig>
}

type WorkspaceKubernetesClusterOperationsDeps = {
  setK8sNotice: (text: string) => void
  setK8sActionMenu: (clusterId: string | null) => void
  applyKubernetesCatalog: (catalog: KubernetesCatalog) => KubernetesCatalog
  completeK8sTerminalConnect: (clusterId: string) => void
  markK8sClusterTerminalTabsEnded: (clusterId: string) => void
  removeK8sClusterTerminalTabs: (clusterId: string) => void
}

export const createWorkspaceKubernetesClusterOperationsController = (
  state: WorkspaceKubernetesClusterOperationsState,
  deps: WorkspaceKubernetesClusterOperationsDeps
) => {
  const {
    k8sClusters,
    k8sBastions,
    k8sConnectingClusterIds,
    k8sSyncingBastionIds,
    k8sDeleteConfirmClusterId,
    k8sImportContexts,
    k8sActiveClusterId,
    k8sConfigTab,
    k8sSelectedClusterId,
    k8sAddModalOpen,
    k8sEditModalOpen,
    k8sEditingClusterId,
    k8sTestResult,
    k8sCollapsedBastionIds,
    k8sAgentClusterId,
    k8sAgentContextName,
    k8sAgentStatus,
    savedK8sProxyConfig
  } = state
  const {
    setK8sNotice,
    setK8sActionMenu,
    applyKubernetesCatalog,
    completeK8sTerminalConnect,
    markK8sClusterTerminalTabsEnded,
    removeK8sClusterTerminalTabs
  } = deps
  let k8sKubeconfigImportRequestSequence = 0
  let k8sKubeconfigImportRequestId = ''
  const nextK8sKubeconfigImportRequestId = () => `k8s-kubeconfig-import-${(k8sKubeconfigImportRequestSequence += 1)}`

  const setK8sConnecting = (clusterId: string, connecting: boolean) => {
    k8sConnectingClusterIds.value = updateK8sIdSet(k8sConnectingClusterIds.value, clusterId, connecting)
  }

  const setK8sSyncingBastion = (bastionUuid: string, syncing: boolean) => {
    k8sSyncingBastionIds.value = updateK8sIdSet(k8sSyncingBastionIds.value, bastionUuid, syncing)
  }

  const connectK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return false
    const connectKubernetesCluster = kubernetesClient.connectKubernetesCluster()
    if (!connectKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    setK8sActionMenu(null)
    setK8sConnecting(id, true)
    setK8sNotice(`正在连接 ${cluster.name}`)
    try {
      const result = await connectKubernetesCluster(id)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || `${cluster.name} 连接失败`)
        return false
      }
      if (!isK8sClusterMutationData(result.data, id, 'connected')) {
        setK8sNotice('Kubernetes cluster backend returned malformed result data.')
        return false
      }
      applyKubernetesCatalog(result.data)
      const latest = result.data.cluster || result.data.clusters.find((item) => item.id === id)
      if (latest) {
        k8sAgentClusterId.value = latest.id
        k8sAgentContextName.value = latest.context_name
        k8sAgentStatus.value = 'ready'
      }
      completeK8sTerminalConnect(id)
      const appliedProxyConfig = savedK8sProxyConfig.value
      setK8sNotice(
        appliedProxyConfig.enabled
          ? `${latest?.name || cluster.name} 连接成功，K8s Agent 代理 ${appliedProxyConfig.type} ${appliedProxyConfig.host}:${appliedProxyConfig.port} 已应用`
          : `${latest?.name || cluster.name} 连接成功`
      )
      return true
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 连接失败`)
      return false
    } finally {
      setK8sConnecting(id, false)
    }
  }

  const disconnectK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return false
    const disconnectKubernetesCluster = kubernetesClient.disconnectKubernetesCluster()
    if (!disconnectKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    setK8sActionMenu(null)
    setK8sConnecting(id, false)
    try {
      const result = await disconnectKubernetesCluster(id)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || `${cluster.name} 断开失败`)
        return false
      }
      if (!isK8sClusterMutationData(result.data, id, 'disconnected')) {
        setK8sNotice('Kubernetes cluster backend returned malformed result data.')
        return false
      }
      applyKubernetesCatalog(result.data)
      if (k8sAgentClusterId.value === id) {
        k8sAgentClusterId.value = null
        k8sAgentContextName.value = ''
        k8sAgentStatus.value = 'idle'
      }
      markK8sClusterTerminalTabsEnded(id)
      setK8sNotice(`${cluster.name} 已断开`)
      return true
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 断开失败`)
      return false
    }
  }

  const testK8sClusterConnection = async (input: Partial<KubernetesClusterTestInput>) => {
    const testKubernetesClusterConnection = kubernetesClient.testKubernetesClusterConnection()
    if (!testKubernetesClusterConnection) {
      k8sTestResult.value = false
      setK8sNotice('Kubernetes cluster test API 不可用')
      return false
    }
    const request = {
      contextName: input.contextName || '',
      serverUrl: input.serverUrl,
      kubeconfigPath: input.kubeconfigPath,
      kubeconfigContent: input.kubeconfigContent
    }
    const result = await testKubernetesClusterConnection(request)
    if (result?.ok && !isK8sClusterTestDataForRequest(result.data, request)) {
      k8sTestResult.value = false
      setK8sNotice('Kubernetes cluster test backend returned malformed result data.')
      return false
    }
    const ok = Boolean(result?.ok && isK8sClusterTestDataForRequest(result.data, request) && result.data.isValid)
    k8sTestResult.value = ok
    setK8sNotice(ok ? result.data?.message || '连接测试成功' : result?.errorMessage || result?.data?.message || '连接测试失败，请确认 Context 和 Server URL')
    return ok
  }

  const selectK8sImportContext = (contextName: string) => {
    return k8sImportContexts.value.find((context) => context.name === contextName) || null
  }

  const normalizeK8sKubeconfigImportResult = (
    result: Awaited<ReturnType<AiopsPreloadApi['importKubernetesKubeconfig']>>,
    expected: K8sKubeconfigImportRequest
  ): K8sKubeconfigImportResult => {
    if (expected.requestId !== k8sKubeconfigImportRequestId) {
      return {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        stale: true,
        error: 'Kubeconfig backend returned stale result data.'
      }
    }
    if (result?.ok) {
      if (!isK8sKubeconfigImportDataForRequest(result.data, expected)) {
        return {
          success: false,
          contexts: [],
          kubeconfigPath: '',
          kubeconfigContent: '',
          currentContext: '',
          error: 'Kubeconfig backend returned malformed result data.'
        }
      }
      return {
        success: true,
        contexts: result.data.contexts,
        kubeconfigPath: result.data.kubeconfigPath,
        kubeconfigContent: result.data.kubeconfigContent,
        currentContext: result.data.currentContext
      }
    }
    return {
      success: false,
      contexts: [],
      kubeconfigPath: '',
      kubeconfigContent: '',
      currentContext: '',
      error: result?.errorMessage || 'Kubeconfig 导入失败'
    }
  }

  const importK8sKubeconfigContent = async (content: string) => {
    const importKubeconfig = kubernetesClient.importKubernetesKubeconfig()
    if (!importKubeconfig) {
      const failed: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        error: 'Kubeconfig 导入服务不可用'
      }
      setK8sNotice('Kubeconfig 导入服务不可用')
      return failed
    }
    const request: K8sKubeconfigImportRequest = { requestId: nextK8sKubeconfigImportRequestId(), kubeconfigContent: content }
    k8sKubeconfigImportRequestId = request.requestId
    const result = normalizeK8sKubeconfigImportResult(await importKubeconfig(request), request)
    if (result.success) {
      k8sImportContexts.value = result.contexts
      setK8sNotice(`已发现 ${result.contexts.length} 个 kubeconfig Context`)
    } else if (result.stale) {
      return result
    } else {
      setK8sNotice(result.error || 'Kubeconfig 导入失败')
    }
    return result
  }

  const importK8sKubeconfigFile = async (filePath: string) => {
    const kubeconfigPath = filePath.trim()
    if (!kubeconfigPath) {
      const emptyResult: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        error: '请选择 kubeconfig 文件'
      }
      setK8sNotice(emptyResult.error || '请选择 kubeconfig 文件')
      return emptyResult
    }
    try {
      const importKubeconfig = kubernetesClient.importKubernetesKubeconfig()
      if (!importKubeconfig) {
        const failed: K8sKubeconfigImportResult = {
          success: false,
          contexts: [],
          kubeconfigPath: '',
          kubeconfigContent: '',
          currentContext: '',
          error: 'Kubeconfig 导入服务不可用'
        }
        setK8sNotice('Kubeconfig 导入服务不可用')
        return failed
      }
      const request: K8sKubeconfigImportRequest = { requestId: nextK8sKubeconfigImportRequestId(), kubeconfigPath }
      k8sKubeconfigImportRequestId = request.requestId
      const imported = normalizeK8sKubeconfigImportResult(await importKubeconfig(request), request)
      if (imported.success) {
        k8sImportContexts.value = imported.contexts
        setK8sNotice(`已选择 kubeconfig 文件，发现 ${imported.contexts.length} 个 Context`)
      } else if (imported.stale) {
        return imported
      } else {
        setK8sNotice(`Kubeconfig 导入失败：${imported.error}`)
      }
      return imported
    } catch (error) {
      const failed: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        error: error instanceof Error ? error.message : String(error)
      }
      setK8sNotice(`Kubeconfig 导入失败：${failed.error}`)
      return failed
    }
  }

  const addK8sCluster = async (payload: {
    name: string
    contextName: string
    serverUrl: string
    defaultNamespace?: string
    kubeconfigPath?: string | null
    kubeconfigContent?: string | null
    sourceType?: 'local' | 'jumpserver'
    bastionUuid?: string | null
  }) => {
    const name = payload.name.trim()
    const contextName = payload.contextName.trim()
    const serverUrl = payload.serverUrl.trim()
    if (!name || !contextName || !serverUrl) {
      setK8sNotice('请补全集群名称、Context 和 Server URL')
      return null
    }
    const addKubernetesCluster = kubernetesClient.addKubernetesCluster()
    if (!addKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return null
    }
    const result = await addKubernetesCluster({
      name,
      contextName,
      serverUrl,
      defaultNamespace: payload.defaultNamespace,
      kubeconfigPath: payload.kubeconfigPath,
      kubeconfigContent: payload.kubeconfigContent,
      sourceType: payload.sourceType,
      bastionUuid: payload.bastionUuid
    })
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes 集群添加失败')
      return null
    }
    if (!isK8sClusterMutationData(result.data)) {
      setK8sNotice('Kubernetes cluster backend returned malformed result data.')
      return null
    }
    applyKubernetesCatalog(result.data)
    const cluster = result.data.cluster
    k8sSelectedClusterId.value = cluster.id
    k8sAddModalOpen.value = false
    setK8sNotice(`${cluster.name} 已添加`)
    return cluster
  }

  const updateK8sCluster = async (id: string, patch: { name?: string; defaultNamespace?: string; autoConnect?: boolean }) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return null
    const updateKubernetesCluster = kubernetesClient.updateKubernetesCluster()
    if (!updateKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return null
    }
    const result = await updateKubernetesCluster(id, patch)
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || `${cluster.name} 更新失败`)
      return null
    }
    if (!isK8sClusterMutationData(result.data, id)) {
      setK8sNotice('Kubernetes cluster backend returned malformed result data.')
      return null
    }
    applyKubernetesCatalog(result.data)
    const updated = result.data.cluster
    k8sEditModalOpen.value = false
    k8sEditingClusterId.value = null
    setK8sNotice(`${updated.name} 已更新`)
    return updated
  }

  const requestDeleteK8sCluster = (id: string) => {
    k8sDeleteConfirmClusterId.value = id
    setK8sActionMenu(null)
  }

  const cancelDeleteK8sCluster = () => {
    k8sDeleteConfirmClusterId.value = null
  }

  const confirmDeleteK8sCluster = async () => {
    if (!k8sDeleteConfirmClusterId.value) return
    await deleteK8sCluster(k8sDeleteConfirmClusterId.value)
    k8sDeleteConfirmClusterId.value = null
  }

  const deleteK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    const deleteKubernetesCluster = kubernetesClient.deleteKubernetesCluster()
    if (!deleteKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    const result = await deleteKubernetesCluster(id)
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || `${cluster?.name || '集群'} 删除失败`)
      return false
    }
    if (!isK8sClusterDeleteData(result.data, id)) {
      setK8sNotice('Kubernetes cluster backend returned malformed result data.')
      return false
    }
    applyKubernetesCatalog(result.data)
    removeK8sClusterTerminalTabs(id)
    if (k8sSelectedClusterId.value === id) k8sSelectedClusterId.value = null
    if (k8sActiveClusterId.value === id) k8sActiveClusterId.value = null
    setK8sNotice(`${cluster?.name || '集群'} 已删除`)
    return true
  }

  const syncK8sBastion = (bastionUuid: string) => {
    const bastion = k8sBastions.value.find((item) => item.uuid === bastionUuid)
    if (!bastion) return false
    const syncKubernetesBastion = kubernetesClient.syncKubernetesBastion()
    if (!syncKubernetesBastion) {
      setK8sNotice('Kubernetes bastion API 不可用')
      return false
    }
    setK8sSyncingBastion(bastionUuid, true)
    setK8sNotice(`正在同步 ${bastion.label}`)
    void syncKubernetesBastion(bastionUuid)
      .then((result) => {
        if (!result?.ok) {
          setK8sNotice(result?.errorMessage || `${bastion.label} Kubernetes 资产同步失败`)
          return false
        }
        if (!isK8sBastionSyncData(result.data)) {
          setK8sNotice('Kubernetes bastion backend returned malformed result data.')
          return false
        }
        applyKubernetesCatalog(result.data)
        k8sConfigTab.value = 'jumpserver'
        setK8sNotice(
          result.data.syncedCount
            ? `${bastion.label} Kubernetes 资产已同步，新增 ${result.data.syncedCount} 个`
            : `${bastion.label} Kubernetes 资产已同步，更新 ${result.data.updatedCount} 个`
        )
        return true
      })
      .catch((error) => {
        setK8sNotice(error instanceof Error ? error.message : `${bastion.label} Kubernetes 资产同步失败`)
      })
      .finally(() => {
        setK8sSyncingBastion(bastionUuid, false)
      })
    return true
  }

  const toggleK8sBastionCollapsed = (uuid: string) => {
    k8sCollapsedBastionIds.value = k8sCollapsedBastionIds.value.includes(uuid)
      ? k8sCollapsedBastionIds.value.filter((id) => id !== uuid)
      : [...k8sCollapsedBastionIds.value, uuid]
  }

  return {
    setK8sConnecting,
    setK8sSyncingBastion,
    connectK8sCluster,
    disconnectK8sCluster,
    testK8sClusterConnection,
    selectK8sImportContext,
    importK8sKubeconfigContent,
    importK8sKubeconfigFile,
    addK8sCluster,
    updateK8sCluster,
    requestDeleteK8sCluster,
    cancelDeleteK8sCluster,
    confirmDeleteK8sCluster,
    deleteK8sCluster,
    syncK8sBastion,
    toggleK8sBastionCollapsed
  }
}
