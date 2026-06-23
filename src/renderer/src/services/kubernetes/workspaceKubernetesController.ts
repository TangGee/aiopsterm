import type { ComputedRef, Ref } from 'vue'
import {
  type K8sBastionGroup,
  type K8sCluster,
  type K8sContextInfo,
  type K8sImportContextInfo,
  type K8sNamespaceInfo,
  type K8sProxyConfig,
  type K8sResource,
  type K8sResourceKind
} from '@/services/kubernetes/kubernetesBackendGuards'
import {
  applyKubernetesCatalogState,
  type K8sAgentRunRecord,
  type K8sTerminalTab
} from '@/services/kubernetes/kubernetesRuntime'
import type { K8sSendChat } from '@/services/kubernetes/workspaceKubernetesChatBoundary'
import { createWorkspaceKubernetesClusterController } from '@/services/kubernetes/workspaceKubernetesClusterController'
import { createWorkspaceKubernetesResourceAgentController } from '@/services/kubernetes/workspaceKubernetesResourceAgentController'
import { createWorkspaceKubernetesTerminalController } from '@/services/kubernetes/workspaceKubernetesTerminalController'
import type { KubernetesCatalog } from '@shared/contracts/kubernetes'

type K8sAgentStatus = 'idle' | 'ready' | 'running' | 'error'

type WorkspaceKubernetesControllerState = {
  k8sContexts: Ref<K8sContextInfo[]>
  k8sClusters: Ref<K8sCluster[]>
  k8sBastions: Ref<K8sBastionGroup[]>
  k8sNamespaces: Ref<K8sNamespaceInfo[]>
  k8sResources: Ref<K8sResource[]>
  k8sConnectingClusterIds: Ref<string[]>
  k8sSyncingBastionIds: Ref<string[]>
  k8sDeleteConfirmClusterId: Ref<string | null>
  k8sClusterActionMenuId: Ref<string | null>
  k8sImportContexts: Ref<K8sImportContextInfo[]>
  k8sActiveClusterId: Ref<string | null>
  k8sSearchQuery: Ref<string>
  k8sConfigTab: Ref<'local' | 'jumpserver'>
  k8sSelectedClusterId: Ref<string | null>
  k8sClusterNotice: Ref<string>
  k8sTerminalTabs: Ref<K8sTerminalTab[]>
  k8sActiveTerminalId: Ref<string | null>
  k8sAddModalOpen: Ref<boolean>
  k8sEditModalOpen: Ref<boolean>
  k8sEditingClusterId: Ref<string | null>
  k8sTestResult: Ref<boolean | null>
  k8sCollapsedBastionIds: Ref<string[]>
  k8sResourceKind: Ref<K8sResourceKind>
  k8sResourceNamespace: Ref<string>
  k8sResourceOutput: Ref<string>
  k8sResourceOutputTitle: Ref<string>
  k8sResourceLoading: Ref<boolean>
  k8sCopiedCommand: Ref<string>
  k8sAgentClusterId: Ref<string | null>
  k8sAgentContextName: Ref<string>
  k8sAgentStatus: Ref<K8sAgentStatus>
  k8sAgentCommandDraft: Ref<string>
  k8sAgentCommandHistory: Ref<string[]>
  k8sAgentRuns: Ref<K8sAgentRunRecord[]>
  k8sAgentLastResult: Ref<K8sAgentRunRecord | null>
  k8sAgentTesting: Ref<boolean>
  savedK8sProxyConfig: Ref<K8sProxyConfig>
  k8sProxyConfig: Ref<K8sProxyConfig>
  k8sProxyConfigOpen: Ref<boolean>
  k8sActiveCluster: ComputedRef<K8sCluster | null>
  k8sSelectedCluster: ComputedRef<K8sCluster | null>
  k8sActiveTerminal: ComputedRef<K8sTerminalTab | null>
  k8sAgentCluster: ComputedRef<K8sCluster | null>
  k8sResourceCluster: ComputedRef<K8sCluster | null>
}

export const createWorkspaceKubernetesController = (state: WorkspaceKubernetesControllerState, deps: { sendChat: K8sSendChat }) => {
  const {
    k8sContexts,
    k8sClusters,
    k8sBastions,
    k8sNamespaces,
    k8sResources,
    k8sConnectingClusterIds,
    k8sSyncingBastionIds,
    k8sDeleteConfirmClusterId,
    k8sClusterActionMenuId,
    k8sImportContexts,
    k8sActiveClusterId,
    k8sSearchQuery,
    k8sConfigTab,
    k8sSelectedClusterId,
    k8sClusterNotice,
    k8sTerminalTabs,
    k8sActiveTerminalId,
    k8sAddModalOpen,
    k8sEditModalOpen,
    k8sEditingClusterId,
    k8sTestResult,
    k8sCollapsedBastionIds,
    k8sResourceKind,
    k8sResourceNamespace,
    k8sResourceOutput,
    k8sResourceOutputTitle,
    k8sResourceLoading,
    k8sCopiedCommand,
    k8sAgentClusterId,
    k8sAgentContextName,
    k8sAgentStatus,
    k8sAgentCommandDraft,
    k8sAgentCommandHistory,
    k8sAgentRuns,
    k8sAgentLastResult,
    k8sAgentTesting,
    savedK8sProxyConfig,
    k8sProxyConfig,
    k8sProxyConfigOpen,
    k8sActiveCluster,
    k8sSelectedCluster,
    k8sActiveTerminal,
    k8sAgentCluster,
    k8sResourceCluster
  } = state
  const { sendChat } = deps
  let clusterController: ReturnType<typeof createWorkspaceKubernetesClusterController>
  let terminalController: ReturnType<typeof createWorkspaceKubernetesTerminalController>
  const setK8sNotice = (text: string) => {
    k8sClusterNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (k8sClusterNotice.value === text) k8sClusterNotice.value = ''
    }, 2400)
  }

  const applyKubernetesCatalog = (catalog: KubernetesCatalog) => {
    const applied = applyKubernetesCatalogState(catalog, {
      selectedClusterId: k8sSelectedClusterId.value,
      connectingClusterIds: k8sConnectingClusterIds.value,
      syncingBastionIds: k8sSyncingBastionIds.value,
      terminalTabs: k8sTerminalTabs.value,
      activeTerminalId: k8sActiveTerminalId.value,
      proxyConfigOpen: k8sProxyConfigOpen.value,
      proxyConfig: k8sProxyConfig.value,
      agentClusterId: k8sAgentClusterId.value,
      agentContextName: k8sAgentContextName.value,
      agentStatus: k8sAgentStatus.value
    })
    k8sContexts.value = applied.contexts
    k8sClusters.value = applied.clusters
    k8sBastions.value = applied.bastions
    k8sNamespaces.value = applied.namespaces
    k8sResources.value = applied.resources
    k8sImportContexts.value = applied.importContexts
    k8sActiveClusterId.value = applied.activeClusterId
    k8sSelectedClusterId.value = applied.selectedClusterId
    k8sConnectingClusterIds.value = applied.connectingClusterIds
    k8sSyncingBastionIds.value = applied.syncingBastionIds
    k8sTerminalTabs.value = applied.terminalTabs
    k8sActiveTerminalId.value = applied.activeTerminalId
    savedK8sProxyConfig.value = applied.savedProxyConfig
    k8sProxyConfig.value = applied.proxyConfig
    k8sAgentClusterId.value = applied.agentClusterId
    k8sAgentContextName.value = applied.agentContextName
    k8sAgentStatus.value = applied.agentStatus

    return catalog
  }

  clusterController = createWorkspaceKubernetesClusterController(
    {
      k8sClusters,
      k8sBastions,
      k8sConnectingClusterIds,
      k8sSyncingBastionIds,
      k8sDeleteConfirmClusterId,
      k8sClusterActionMenuId,
      k8sImportContexts,
      k8sActiveClusterId,
      k8sSearchQuery,
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
      savedK8sProxyConfig,
      k8sProxyConfig,
      k8sProxyConfigOpen
    },
    {
      setK8sNotice,
      applyKubernetesCatalog,
      completeK8sTerminalConnect: (clusterId) => terminalController.completeK8sTerminalConnect(clusterId),
      markK8sClusterTerminalTabsEnded: (clusterId) => terminalController.markK8sClusterTerminalTabsEnded(clusterId),
      removeK8sClusterTerminalTabs: (clusterId) => terminalController.removeK8sClusterTerminalTabs(clusterId)
    }
  )

  terminalController = createWorkspaceKubernetesTerminalController(
    {
      k8sClusters,
      k8sTerminalTabs,
      k8sActiveTerminalId,
      k8sActiveCluster,
      k8sSelectedCluster,
      k8sActiveTerminal
    },
    {
      setK8sNotice,
      connectK8sCluster: (clusterId) => clusterController.connectK8sCluster(clusterId),
      sendChat
    }
  )

  const resourceAgentController = createWorkspaceKubernetesResourceAgentController(
    {
      k8sClusters,
      k8sResources,
      k8sResourceKind,
      k8sResourceNamespace,
      k8sResourceOutput,
      k8sResourceOutputTitle,
      k8sResourceLoading,
      k8sCopiedCommand,
      k8sAgentClusterId,
      k8sAgentContextName,
      k8sAgentStatus,
      k8sAgentCommandDraft,
      k8sAgentCommandHistory,
      k8sAgentRuns,
      k8sAgentLastResult,
      k8sAgentTesting,
      k8sAgentCluster,
      k8sResourceCluster
    },
    {
      setK8sNotice,
      applyKubernetesCatalog,
      openK8sTerminal: (clusterId) => terminalController.openK8sTerminal(clusterId),
      sendK8sTerminalCommand: (command) => terminalController.sendK8sTerminalCommand(command),
      sendChat
    }
  )
  const {
    setK8sAgentCluster,
    runK8sAgentKubectl,
    testK8sAgentConnection,
    refreshK8sAgentNamespaces,
    cleanupK8sAgent,
    setK8sResourceKind,
    setK8sResourceNamespace,
    refreshK8sResources,
    describeK8sResource,
    showK8sPodLogs,
    copyK8sResourceCommand,
    copyK8sResourceOutput,
    clearK8sResourceOutput,
    sendK8sCurrentOutputToTerminal,
    sendK8sCurrentOutputToAi,
    sendK8sResourceCommand
  } = resourceAgentController

  return {
    refreshKubernetesCatalog: clusterController.refreshKubernetesCatalog,
    switchK8sContext: clusterController.switchK8sContext,
    reloadK8sConfig: clusterController.reloadK8sConfig,
    clearK8sSearch: clusterController.clearK8sSearch,
    selectK8sCluster: clusterController.selectK8sCluster,
    setK8sActionMenu: clusterController.setK8sActionMenu,
    openK8sProxyConfig: clusterController.openK8sProxyConfig,
    closeK8sProxyConfig: clusterController.closeK8sProxyConfig,
    updateK8sProxyConfig: clusterController.updateK8sProxyConfig,
    saveK8sProxyConfig: clusterController.saveK8sProxyConfig,
    setK8sAgentCluster,
    connectK8sCluster: clusterController.connectK8sCluster,
    disconnectK8sCluster: clusterController.disconnectK8sCluster,
    openK8sTerminal: terminalController.openK8sTerminal,
    createNewK8sTerminalTab: terminalController.createNewK8sTerminalTab,
    closeK8sTerminalTab: terminalController.closeK8sTerminalTab,
    setActiveK8sTerminal: terminalController.setActiveK8sTerminal,
    resizeK8sTerminal: terminalController.resizeK8sTerminal,
    endK8sTerminalSession: terminalController.endK8sTerminalSession,
    sendK8sTerminalCommand: terminalController.sendK8sTerminalCommand,
    executeK8sTerminalAiCommand: terminalController.executeK8sTerminalAiCommand,
    runK8sAgentKubectl,
    testK8sAgentConnection,
    refreshK8sAgentNamespaces,
    cleanupK8sAgent,
    setK8sResourceKind,
    setK8sResourceNamespace,
    refreshK8sResources,
    describeK8sResource,
    showK8sPodLogs,
    copyK8sResourceCommand,
    copyK8sResourceOutput,
    clearK8sResourceOutput,
    sendK8sCurrentOutputToTerminal,
    sendK8sCurrentOutputToAi,
    sendK8sResourceCommand,
    testK8sClusterConnection: clusterController.testK8sClusterConnection,
    selectK8sImportContext: clusterController.selectK8sImportContext,
    importK8sKubeconfigContent: clusterController.importK8sKubeconfigContent,
    importK8sKubeconfigFile: clusterController.importK8sKubeconfigFile,
    addK8sCluster: clusterController.addK8sCluster,
    updateK8sCluster: clusterController.updateK8sCluster,
    requestDeleteK8sCluster: clusterController.requestDeleteK8sCluster,
    cancelDeleteK8sCluster: clusterController.cancelDeleteK8sCluster,
    confirmDeleteK8sCluster: clusterController.confirmDeleteK8sCluster,
    deleteK8sCluster: clusterController.deleteK8sCluster,
    syncK8sBastion: clusterController.syncK8sBastion,
    toggleK8sBastionCollapsed: clusterController.toggleK8sBastionCollapsed
  }
}
