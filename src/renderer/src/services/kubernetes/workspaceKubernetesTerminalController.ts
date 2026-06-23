import type { ComputedRef, Ref } from 'vue'
import {
  isK8sTerminalCloseData,
  isK8sTerminalDataEvent,
  isK8sTerminalExitEvent,
  isK8sTerminalRecord,
  isK8sTerminalWriteDataForRequest,
  type K8sCluster
} from '@/services/kubernetes/kubernetesBackendGuards'
import { kubernetesClient } from '@/services/kubernetes/kubernetesClient'
import {
  activatedK8sTerminalTabs as activatedK8sTerminalTabsRuntime,
  applyK8sTerminalDataEvent,
  applyK8sTerminalExitEvent,
  closeK8sTerminalTabState,
  completeK8sTerminalConnectTabs,
  k8sTerminalTabFromRecord,
  markK8sClusterTerminalTabsEnded,
  nextK8sActiveTerminalId,
  startK8sTerminalAiCollection,
  stopK8sTerminalAiCollection,
  updateK8sTerminalTabCommandResult,
  updateK8sTerminalTabFromRecord,
  type K8sTerminalTab
} from '@/services/kubernetes/kubernetesRuntime'
import type { K8sSendChat } from '@/services/kubernetes/workspaceKubernetesChatBoundary'
import type { AiContextOption } from '@shared/contracts/aiChat'
import type { KubernetesTerminalDataEvent, KubernetesTerminalExitEvent } from '@shared/contracts/kubernetes'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type WorkspaceKubernetesTerminalState = {
  k8sClusters: Ref<K8sCluster[]>
  k8sTerminalTabs: Ref<K8sTerminalTab[]>
  k8sActiveTerminalId: Ref<string | null>
  k8sActiveCluster: ComputedRef<K8sCluster | null>
  k8sSelectedCluster: ComputedRef<K8sCluster | null>
  k8sActiveTerminal: ComputedRef<K8sTerminalTab | null>
}

type WorkspaceKubernetesTerminalDeps = {
  setK8sNotice: (text: string) => void
  connectK8sCluster: (id: string) => Promise<boolean>
  sendChat: K8sSendChat
}

export const createWorkspaceKubernetesTerminalController = (
  state: WorkspaceKubernetesTerminalState,
  deps: WorkspaceKubernetesTerminalDeps
) => {
  const { k8sClusters, k8sTerminalTabs, k8sActiveTerminalId, k8sActiveCluster, k8sSelectedCluster, k8sActiveTerminal } = state
  const { setK8sNotice, connectK8sCluster, sendChat } = deps
  let removeK8sTerminalDataListener: (() => void) | null = null
  let removeK8sTerminalExitListener: (() => void) | null = null

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

  const markK8sClusterTerminalTabsEndedById = (clusterId: string) => {
    k8sTerminalTabs.value = markK8sClusterTerminalTabsEnded(k8sTerminalTabs.value, clusterId)
  }

  const removeK8sClusterTerminalTabs = (clusterId: string) => {
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => tab.clusterId !== clusterId)
    k8sActiveTerminalId.value = nextK8sActiveTerminalId(k8sTerminalTabs.value, k8sActiveTerminalId.value)
    if (k8sActiveTerminalId.value) k8sTerminalTabs.value = activatedK8sTerminalTabsRuntime(k8sTerminalTabs.value, k8sActiveTerminalId.value)
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

  return {
    activateK8sTerminal,
    updateK8sTerminalTabState,
    handleK8sTerminalData,
    handleK8sTerminalExit,
    installK8sTerminalListeners,
    completeK8sTerminalConnect,
    markK8sClusterTerminalTabsEnded: markK8sClusterTerminalTabsEndedById,
    removeK8sClusterTerminalTabs,
    openK8sTerminal,
    createNewK8sTerminalTab,
    closeK8sTerminalTab,
    setActiveK8sTerminal,
    resizeK8sTerminal,
    sendK8sTerminalCommand,
    executeK8sTerminalAiCommand,
    endK8sTerminalSession
  }
}
