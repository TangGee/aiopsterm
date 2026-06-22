import type { ComputedRef, Ref } from 'vue'
import {
  isK8sBastionSyncData,
  isK8sCatalogSnapshot,
  isK8sClusterDeleteData,
  isK8sClusterMutationData,
  isK8sClusterTestDataForRequest,
  isK8sContextSwitchData,
  isK8sKubeconfigImportDataForRequest,
  isK8sProxyConfigData,
  isK8sTerminalCloseData,
  isK8sTerminalDataEvent,
  isK8sTerminalExitEvent,
  isK8sTerminalRecord,
  isK8sTerminalWriteDataForRequest,
  type K8sBastionGroup,
  type K8sCluster,
  type K8sContextInfo,
  type K8sImportContextInfo,
  type K8sKubeconfigImportRequest,
  type K8sNamespaceInfo,
  type K8sProxyConfig,
  type K8sResource,
  type K8sResourceKind
} from '@/services/kubernetesBackendGuards'
import { kubernetesClient } from '@/services/kubernetesClient'
import {
  activatedK8sTerminalTabs as activatedK8sTerminalTabsRuntime,
  applyK8sTerminalDataEvent,
  applyK8sTerminalExitEvent,
  applyKubernetesCatalogState,
  cloneK8sProxyConfig,
  closeK8sTerminalTabState,
  completeK8sTerminalConnectTabs,
  k8sProxyConfigValid,
  k8sTerminalTabFromRecord,
  markK8sClusterTerminalTabsEnded,
  nextK8sActiveTerminalId,
  startK8sTerminalAiCollection,
  stopK8sTerminalAiCollection,
  updateK8sIdSet,
  updateK8sProxyDraft,
  updateK8sTerminalTabCommandResult,
  updateK8sTerminalTabFromRecord,
  type K8sAgentRunRecord,
  type K8sTerminalTab
} from '@/services/kubernetesRuntime'
import { createWorkspaceKubernetesResourceAgentController, type K8sSendChat } from '@/services/workspaceKubernetesResourceAgentController'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type { AiContextOption } from '@shared/contracts/aiChat'
import type { KubernetesCatalog, KubernetesClusterTestInput, KubernetesTerminalDataEvent, KubernetesTerminalExitEvent } from '@shared/contracts/kubernetes'

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
  let removeK8sTerminalDataListener: (() => void) | null = null
  let removeK8sTerminalExitListener: (() => void) | null = null
  let k8sKubeconfigImportRequestSequence = 0
  let k8sKubeconfigImportRequestId = ''
  const nextK8sKubeconfigImportRequestId = () => `k8s-kubeconfig-import-${(k8sKubeconfigImportRequestSequence += 1)}`
  const setK8sNotice = (text: string) => {
    k8sClusterNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (k8sClusterNotice.value === text) k8sClusterNotice.value = ''
    }, 2400)
  }

  const activateK8sTerminal = (id: string) => {
    k8sActiveTerminalId.value = id
    k8sTerminalTabs.value = activatedK8sTerminalTabsRuntime(k8sTerminalTabs.value, id)
  }

  const updateK8sTerminalTabState = (id: string, update: (tab: K8sTerminalTab) => K8sTerminalTab) => {
    let updated: K8sTerminalTab | null = null
    k8sTerminalTabs.value = k8sTerminalTabs.value.map((tab) => {
      if (tab.id !== id && tab.sessionId !== id) return tab
      updated = update(tab)
      return updated
    })
    return updated
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

  const clearK8sSearch = () => {
    k8sSearchQuery.value = ''
    setK8sActionMenu(null)
  }

  const setK8sActionMenu = (clusterId: string | null) => {
    k8sClusterActionMenuId.value = clusterId
  }

  const setK8sConnecting = (clusterId: string, connecting: boolean) => {
    k8sConnectingClusterIds.value = updateK8sIdSet(k8sConnectingClusterIds.value, clusterId, connecting)
  }

  const setK8sSyncingBastion = (bastionUuid: string, syncing: boolean) => {
    k8sSyncingBastionIds.value = updateK8sIdSet(k8sSyncingBastionIds.value, bastionUuid, syncing)
  }

  const selectK8sCluster = (id: string | null) => {
    k8sSelectedClusterId.value = id
  }

  const openK8sProxyConfig = () => {
    k8sProxyConfig.value = cloneK8sProxyConfig(savedK8sProxyConfig.value)
    k8sProxyConfigOpen.value = true
  }

  const closeK8sProxyConfig = () => {
    k8sProxyConfig.value = cloneK8sProxyConfig(savedK8sProxyConfig.value)
    k8sProxyConfigOpen.value = false
  }

  const updateK8sProxyConfig = (patch: Partial<K8sProxyConfig>) => {
    k8sProxyConfig.value = updateK8sProxyDraft(k8sProxyConfig.value, patch)
  }

  const saveK8sProxyConfig = async () => {
    if (!k8sProxyConfigValid(k8sProxyConfig.value)) {
      setK8sNotice('请补全 Kubernetes Agent 代理主机和端口')
      return false
    }
    const saveKubernetesAgentProxyConfig = kubernetesClient.saveKubernetesAgentProxyConfig()
    if (!saveKubernetesAgentProxyConfig) {
      setK8sNotice('Kubernetes Agent 代理配置服务不可用')
      return false
    }
    const draft = cloneK8sProxyConfig(k8sProxyConfig.value)
    try {
      const result = await saveKubernetesAgentProxyConfig(draft)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes Agent 代理配置保存失败')
        return false
      }
      if (!isK8sProxyConfigData(result.data)) {
        setK8sNotice('Kubernetes Agent proxy backend returned malformed result data.')
        return false
      }
      savedK8sProxyConfig.value = cloneK8sProxyConfig(result.data.proxyConfig)
      k8sProxyConfig.value = cloneK8sProxyConfig(result.data.proxyConfig)
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes Agent 代理配置保存失败')
      return false
    }
    k8sProxyConfigOpen.value = false
    setK8sNotice(savedK8sProxyConfig.value.enabled ? 'Kubernetes Agent 代理配置已应用' : 'Kubernetes Agent 代理已关闭')
    return true
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
      k8sTerminalTabs.value = markK8sClusterTerminalTabsEnded(k8sTerminalTabs.value, id)
      setK8sNotice(`${cluster.name} 已断开`)
      return true
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 断开失败`)
      return false
    }
  }

  const handleK8sTerminalData = (event: KubernetesTerminalDataEvent) => {
    if (!isK8sTerminalDataEvent(event)) return
    const tab = k8sTerminalTabs.value.find((item) => item.sessionId === event.sessionId && item.id === event.id && item.clusterId === event.clusterId)
    if (!tab || tab.status === 'ended' || tab.status === 'error') return
    k8sTerminalTabs.value = applyK8sTerminalDataEvent(k8sTerminalTabs.value, event)
  }

  const handleK8sTerminalExit = (event: KubernetesTerminalExitEvent) => {
    if (!isK8sTerminalExitEvent(event)) return
    const tab = k8sTerminalTabs.value.find((item) => item.sessionId === event.sessionId && item.id === event.id && item.clusterId === event.clusterId)
    if (!tab) return
    k8sTerminalTabs.value = applyK8sTerminalExitEvent(k8sTerminalTabs.value, event)
    if (event.reason === 'error' && event.error) setK8sNotice(event.error)
  }

  const installK8sTerminalListeners = () => {
    const onKubernetesTerminalData = kubernetesClient.onKubernetesTerminalData()
    if (!removeK8sTerminalDataListener && onKubernetesTerminalData) {
      removeK8sTerminalDataListener = onKubernetesTerminalData(handleK8sTerminalData)
    }
    const onKubernetesTerminalExit = kubernetesClient.onKubernetesTerminalExit()
    if (!removeK8sTerminalExitListener && onKubernetesTerminalExit) {
      removeK8sTerminalExitListener = onKubernetesTerminalExit(handleK8sTerminalExit)
    }
  }

  const completeK8sTerminalConnect = (clusterId: string) => {
    k8sTerminalTabs.value = completeK8sTerminalConnectTabs(k8sTerminalTabs.value, clusterId)
  }

  const openK8sTerminal = async (clusterId: string, options: { forceNew?: boolean; namespace?: string; cols?: number; rows?: number } = {}) => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    if (!cluster) return null
    installK8sTerminalListeners()
    let tab = options.forceNew ? undefined : k8sTerminalTabs.value.find((item) => item.clusterId === clusterId && item.status !== 'ended')
    if (!tab) {
      const createKubernetesTerminal = kubernetesClient.createKubernetesTerminal()
      if (!createKubernetesTerminal) {
        setK8sNotice('Kubernetes terminal API 不可用')
        return null
      }
      const result = await createKubernetesTerminal({
        clusterId,
        namespace: options.namespace,
        cols: options.cols,
        rows: options.rows
      })
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端创建失败')
        return null
      }
      if (!isK8sTerminalRecord(result.data) || result.data.clusterId !== clusterId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return null
      }
      tab = k8sTerminalTabFromRecord(result.data)
      k8sTerminalTabs.value.push(tab)
    }
    activateK8sTerminal(tab.id)
    const tabId = tab.id
    if (cluster.connection_status !== 'connected') {
      const connected = await connectK8sCluster(clusterId)
      const current = k8sTerminalTabs.value.find((item) => item.id === tabId)
      if (!connected && current?.status === 'connecting') {
        updateK8sTerminalTabState(current.id, (item) => ({ ...item, status: 'error' }))
      }
    } else if (tab.status === 'connecting') {
      completeK8sTerminalConnect(clusterId)
    }
    return k8sTerminalTabs.value.find((item) => item.id === tabId) || tab
  }

  const createNewK8sTerminalTab = async (clusterId?: string) => {
    const targetClusterId = clusterId || k8sActiveCluster.value?.id || k8sSelectedCluster.value?.id || k8sClusters.value[0]?.id
    return targetClusterId ? openK8sTerminal(targetClusterId, { forceNew: true }) : null
  }

  const closeK8sTerminalTab = async (id: string) => {
    const index = k8sTerminalTabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const tab = k8sTerminalTabs.value[index]
    if (tab.status !== 'ended') {
      const closeKubernetesTerminal = kubernetesClient.closeKubernetesTerminal()
      if (!closeKubernetesTerminal) {
        setK8sNotice('Kubernetes terminal API 不可用')
        return
      }
      const result = await closeKubernetesTerminal(tab.sessionId, 0)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端关闭失败')
        return
      }
      if (!isK8sTerminalCloseData(result.data) || result.data.sessionId !== tab.sessionId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return
      }
      k8sTerminalTabs.value[index] = {
        ...k8sTerminalTabs.value[index],
        status: result.data.status,
        exitCode: result.data.exitCode,
        updatedAt: result.data.updatedAt
      }
    }
    const closed = closeK8sTerminalTabState(k8sTerminalTabs.value, k8sActiveTerminalId.value, id)
    k8sTerminalTabs.value = closed.tabs
    k8sActiveTerminalId.value = closed.activeTerminalId
  }

  const setActiveK8sTerminal = (id: string) => {
    if (!k8sTerminalTabs.value.some((tab) => tab.id === id)) return
    activateK8sTerminal(id)
  }

  const resizeK8sTerminal = async (id: string, cols: number, rows: number) => {
    const tab = k8sTerminalTabs.value.find((item) => item.id === id || item.sessionId === id)
    if (!tab) return false
    const resizeKubernetesTerminal = kubernetesClient.resizeKubernetesTerminal()
    if (resizeKubernetesTerminal) {
      const result = await resizeKubernetesTerminal(tab.sessionId, cols, rows)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端尺寸同步失败')
        return false
      }
      if (!isK8sTerminalRecord(result.data) || result.data.sessionId !== tab.sessionId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return false
      }
      const record = result.data
      const updated = updateK8sTerminalTabState(tab.id, (item) => updateK8sTerminalTabFromRecord(item, record))
      if (!updated) return false
    } else {
      setK8sNotice('Kubernetes terminal API 不可用')
      return false
    }
    const current = k8sTerminalTabs.value.find((item) => item.id === tab.id) || tab
    setK8sNotice(`${current.name} 终端尺寸已同步 ${current.cols}x${current.rows}`)
    return true
  }

  const sendK8sTerminalCommand = async (command: string) => {
    const tab = k8sActiveTerminal.value
    const text = command.trim()
    if (!tab || !text || tab.status === 'ended') return ''
    if (tab.status !== 'connected') {
      setK8sNotice('Kubernetes terminal is not connected.')
      updateK8sTerminalTabState(tab.id, stopK8sTerminalAiCollection)
      return ''
    }
    const writeKubernetesTerminal = kubernetesClient.writeKubernetesTerminal()
    if (!writeKubernetesTerminal) {
      setK8sNotice('Kubernetes terminal write API 不可用')
      updateK8sTerminalTabState(tab.id, stopK8sTerminalAiCollection)
      return ''
    }
    const payload = text.endsWith('\n') ? text : `${text}\n`
    let result: Awaited<ReturnType<AiopsPreloadApi['writeKubernetesTerminal']>>
    try {
      result = await writeKubernetesTerminal(tab.sessionId, payload)
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes terminal command failed.')
      updateK8sTerminalTabState(tab.id, stopK8sTerminalAiCollection)
      return ''
    }
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes terminal command failed.')
      updateK8sTerminalTabState(tab.id, stopK8sTerminalAiCollection)
      return ''
    }
    if (!isK8sTerminalWriteDataForRequest(result.data, { id: tab.sessionId, data: payload, command: text })) {
      setK8sNotice('Kubernetes terminal backend returned malformed write data.')
      updateK8sTerminalTabState(tab.id, stopK8sTerminalAiCollection)
      return ''
    }
    const writeData = result.data
    const terminalOutput = writeData.terminalOutput || ''
    const latestTab = k8sTerminalTabs.value.find((item) => item.id === tab.id) || tab
    const wasCollectingAiOutput = latestTab.collectingAiOutput
    const updatedTab =
      updateK8sTerminalTabState(latestTab.id, (item) => {
        const withCommand = updateK8sTerminalTabCommandResult(item, text, writeData.updatedAt)
        return wasCollectingAiOutput ? stopK8sTerminalAiCollection(withCommand) : withCommand
      }) || latestTab
    if (wasCollectingAiOutput) {
      if (!terminalOutput.trim()) {
        setK8sNotice('Kubernetes terminal backend returned no output to send.')
      } else {
        const cluster = k8sClusters.value.find((item) => item.id === updatedTab.clusterId)
        const host: AiContextOption | undefined = cluster
          ? {
              id: `k8s-${cluster.id}`,
              kind: 'hosts',
              label: cluster.name,
              detail: `${cluster.context_name} / ${updatedTab.namespace}`
            }
          : undefined
        void sendChat(`Terminal output:\n\`\`\`\n${terminalOutput}\n\`\`\``, undefined, host ? [host] : undefined, { skipKnowledgeSearch: true })
        setK8sNotice(`${updatedTab.name} 命令输出已发送到 AI`)
      }
    }
    return terminalOutput
  }

  const executeK8sTerminalAiCommand = async (command: string, tabId?: string) => {
    const target = tabId ? k8sTerminalTabs.value.find((tab) => tab.id === tabId || tab.sessionId === tabId) : k8sActiveTerminal.value
    if (!target || target.status === 'ended') return false
    const text = command.trim()
    if (!text) {
      updateK8sTerminalTabState(target.id, stopK8sTerminalAiCollection)
      setK8sNotice('当前没有可采集到 AI 的 kubectl 命令')
      return false
    }
    activateK8sTerminal(target.id)
    updateK8sTerminalTabState(target.id, (tab) => startK8sTerminalAiCollection(tab, text, tabId))
    const terminalOutput = await sendK8sTerminalCommand(text)
    return Boolean(terminalOutput.trim())
  }

  const endK8sTerminalSession = async (id: string, exitCode = 0) => {
    const tab = k8sTerminalTabs.value.find((item) => item.id === id || item.sessionId === id)
    if (!tab) return false
    const closeKubernetesTerminal = kubernetesClient.closeKubernetesTerminal()
    if (closeKubernetesTerminal) {
      const result = await closeKubernetesTerminal(tab.sessionId, exitCode)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端会话结束失败')
        return false
      }
      if (!isK8sTerminalCloseData(result.data) || result.data.sessionId !== tab.sessionId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return false
      }
      const closeData = result.data
      updateK8sTerminalTabState(tab.id, (item) => ({
        ...item,
        status: closeData.status,
        exitCode: closeData.exitCode,
        updatedAt: closeData.updatedAt
      }))
    } else {
      setK8sNotice('Kubernetes terminal API 不可用')
      return false
    }
    const endedTab = updateK8sTerminalTabState(tab.id, stopK8sTerminalAiCollection) || tab
    setK8sNotice(`${endedTab.name} 终端会话已结束`)
    return true
  }

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
      openK8sTerminal: (clusterId) => openK8sTerminal(clusterId),
      sendK8sTerminalCommand: (command) => sendK8sTerminalCommand(command),
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
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => tab.clusterId !== id)
    if (k8sSelectedClusterId.value === id) k8sSelectedClusterId.value = null
    if (k8sActiveClusterId.value === id) k8sActiveClusterId.value = null
    k8sActiveTerminalId.value = nextK8sActiveTerminalId(k8sTerminalTabs.value, k8sActiveTerminalId.value)
    if (k8sActiveTerminalId.value) k8sTerminalTabs.value = activatedK8sTerminalTabsRuntime(k8sTerminalTabs.value, k8sActiveTerminalId.value)
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
    refreshKubernetesCatalog,
    switchK8sContext,
    reloadK8sConfig,
    clearK8sSearch,
    selectK8sCluster,
    setK8sActionMenu,
    openK8sProxyConfig,
    closeK8sProxyConfig,
    updateK8sProxyConfig,
    saveK8sProxyConfig,
    setK8sAgentCluster,
    connectK8sCluster,
    disconnectK8sCluster,
    openK8sTerminal,
    createNewK8sTerminalTab,
    closeK8sTerminalTab,
    setActiveK8sTerminal,
    resizeK8sTerminal,
    endK8sTerminalSession,
    sendK8sTerminalCommand,
    executeK8sTerminalAiCommand,
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
