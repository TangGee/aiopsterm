import type { Ref } from 'vue'
import {
  isK8sCatalogSnapshot,
  isK8sContextSwitchData,
  type K8sBastionGroup,
  type K8sCluster,
  type K8sImportContextInfo,
  type K8sProxyConfig
} from '@/services/kubernetesBackendGuards'
import { kubernetesClient } from '@/services/kubernetesClient'
import { createWorkspaceKubernetesClusterOperationsController } from '@/services/workspaceKubernetesClusterOperationsController'
import { createWorkspaceKubernetesProxyController } from '@/services/workspaceKubernetesProxyController'
import type { KubernetesCatalog } from '@shared/contracts/kubernetes'

type K8sAgentStatus = 'idle' | 'ready' | 'running' | 'error'

type WorkspaceKubernetesClusterState = {
  k8sClusters: Ref<K8sCluster[]>
  k8sBastions: Ref<K8sBastionGroup[]>
  k8sConnectingClusterIds: Ref<string[]>
  k8sSyncingBastionIds: Ref<string[]>
  k8sDeleteConfirmClusterId: Ref<string | null>
  k8sClusterActionMenuId: Ref<string | null>
  k8sImportContexts: Ref<K8sImportContextInfo[]>
  k8sActiveClusterId: Ref<string | null>
  k8sSearchQuery: Ref<string>
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
  k8sProxyConfig: Ref<K8sProxyConfig>
  k8sProxyConfigOpen: Ref<boolean>
}

type WorkspaceKubernetesClusterDeps = {
  setK8sNotice: (text: string) => void
  applyKubernetesCatalog: (catalog: KubernetesCatalog) => KubernetesCatalog
  completeK8sTerminalConnect: (clusterId: string) => void
  markK8sClusterTerminalTabsEnded: (clusterId: string) => void
  removeK8sClusterTerminalTabs: (clusterId: string) => void
}

export const createWorkspaceKubernetesClusterController = (
  state: WorkspaceKubernetesClusterState,
  deps: WorkspaceKubernetesClusterDeps
) => {
  const { k8sSearchQuery, k8sClusterActionMenuId, k8sSelectedClusterId } = state
  const { setK8sNotice, applyKubernetesCatalog, completeK8sTerminalConnect, markK8sClusterTerminalTabsEnded, removeK8sClusterTerminalTabs } = deps

  const refreshKubernetesCatalog = async () => {
    const listKubernetesCatalog = kubernetesClient.listKubernetesCatalog()
    if (!listKubernetesCatalog) return null
    const result = await listKubernetesCatalog()
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes 配置加载失败')
      return null
    }
    if (!isK8sCatalogSnapshot(result.data)) {
      setK8sNotice('Kubernetes catalog backend returned malformed result data.')
      return null
    }
    return applyKubernetesCatalog(result.data)
  }

  const switchK8sContext = async (name: string) => {
    const switchKubernetesContext = kubernetesClient.switchKubernetesContext()
    if (!switchKubernetesContext) {
      setK8sNotice('Kubernetes context API 不可用')
      return false
    }
    const result = await switchKubernetesContext(name)
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes Context 切换失败')
      return false
    }
    if (!isK8sContextSwitchData(result.data, name)) {
      setK8sNotice('Kubernetes context backend returned malformed result data.')
      return false
    }
    applyKubernetesCatalog(result.data)
    setK8sNotice(`已切换到 ${name}`)
    return true
  }

  const reloadK8sConfig = async () => {
    const catalog = await refreshKubernetesCatalog()
    setK8sNotice(catalog ? 'Kubernetes 配置已刷新' : 'Kubernetes 配置刷新失败')
    return Boolean(catalog)
  }

  const setK8sActionMenu = (clusterId: string | null) => {
    k8sClusterActionMenuId.value = clusterId
  }

  const clearK8sSearch = () => {
    k8sSearchQuery.value = ''
    setK8sActionMenu(null)
  }

  const selectK8sCluster = (id: string | null) => {
    k8sSelectedClusterId.value = id
  }

  const proxyController = createWorkspaceKubernetesProxyController(
    {
      savedK8sProxyConfig: state.savedK8sProxyConfig,
      k8sProxyConfig: state.k8sProxyConfig,
      k8sProxyConfigOpen: state.k8sProxyConfigOpen
    },
    { setK8sNotice }
  )

  const operationsController = createWorkspaceKubernetesClusterOperationsController(
    {
      k8sClusters: state.k8sClusters,
      k8sBastions: state.k8sBastions,
      k8sConnectingClusterIds: state.k8sConnectingClusterIds,
      k8sSyncingBastionIds: state.k8sSyncingBastionIds,
      k8sDeleteConfirmClusterId: state.k8sDeleteConfirmClusterId,
      k8sImportContexts: state.k8sImportContexts,
      k8sActiveClusterId: state.k8sActiveClusterId,
      k8sConfigTab: state.k8sConfigTab,
      k8sSelectedClusterId: state.k8sSelectedClusterId,
      k8sAddModalOpen: state.k8sAddModalOpen,
      k8sEditModalOpen: state.k8sEditModalOpen,
      k8sEditingClusterId: state.k8sEditingClusterId,
      k8sTestResult: state.k8sTestResult,
      k8sCollapsedBastionIds: state.k8sCollapsedBastionIds,
      k8sAgentClusterId: state.k8sAgentClusterId,
      k8sAgentContextName: state.k8sAgentContextName,
      k8sAgentStatus: state.k8sAgentStatus,
      savedK8sProxyConfig: state.savedK8sProxyConfig
    },
    {
      setK8sNotice,
      setK8sActionMenu,
      applyKubernetesCatalog,
      completeK8sTerminalConnect,
      markK8sClusterTerminalTabsEnded,
      removeK8sClusterTerminalTabs
    }
  )

  return {
    refreshKubernetesCatalog,
    switchK8sContext,
    reloadK8sConfig,
    clearK8sSearch,
    selectK8sCluster,
    setK8sActionMenu,
    openK8sProxyConfig: proxyController.openK8sProxyConfig,
    closeK8sProxyConfig: proxyController.closeK8sProxyConfig,
    updateK8sProxyConfig: proxyController.updateK8sProxyConfig,
    saveK8sProxyConfig: proxyController.saveK8sProxyConfig,
    setK8sConnecting: operationsController.setK8sConnecting,
    setK8sSyncingBastion: operationsController.setK8sSyncingBastion,
    connectK8sCluster: operationsController.connectK8sCluster,
    disconnectK8sCluster: operationsController.disconnectK8sCluster,
    testK8sClusterConnection: operationsController.testK8sClusterConnection,
    selectK8sImportContext: operationsController.selectK8sImportContext,
    importK8sKubeconfigContent: operationsController.importK8sKubeconfigContent,
    importK8sKubeconfigFile: operationsController.importK8sKubeconfigFile,
    addK8sCluster: operationsController.addK8sCluster,
    updateK8sCluster: operationsController.updateK8sCluster,
    requestDeleteK8sCluster: operationsController.requestDeleteK8sCluster,
    cancelDeleteK8sCluster: operationsController.cancelDeleteK8sCluster,
    confirmDeleteK8sCluster: operationsController.confirmDeleteK8sCluster,
    deleteK8sCluster: operationsController.deleteK8sCluster,
    syncK8sBastion: operationsController.syncK8sBastion,
    toggleK8sBastionCollapsed: operationsController.toggleK8sBastionCollapsed
  }
}
