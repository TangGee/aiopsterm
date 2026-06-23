import type { ComputedRef, Ref } from 'vue'
import {
  isK8sAgentCleanupData,
  isK8sBackendCommandForRequest,
  isK8sBackendResourceActionData,
  isK8sBackendResourceRefreshData,
  isK8sResourceActionPlanData,
  k8sCommandDisplayOutput,
  type K8sBackendCommandData,
  type K8sBackendResourceActionData,
  type K8sBackendResourceActionPlanData,
  type K8sBackendResourceRefreshData,
  type K8sCluster,
  type K8sResource,
  type K8sResourceAction,
  type K8sResourceKind
} from '@/services/kubernetes/kubernetesBackendGuards'
import { kubernetesClient } from '@/services/kubernetes/kubernetesClient'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import {
  addK8sAgentRunRecord,
  createK8sAgentRunRecord,
  currentK8sOutputCommand as currentK8sOutputCommandRuntime,
  k8sKindLabels,
  selectK8sAgentClusterState,
  setK8sResourceKindState,
  type K8sAgentRunRecord,
  type K8sTerminalTab
} from '@/services/kubernetes/kubernetesRuntime'
import type { K8sSendChat } from '@/services/kubernetes/workspaceKubernetesChatBoundary'
import type { AiContextOption } from '@shared/contracts/aiChat'
import type { KubernetesCatalog } from '@shared/contracts/kubernetes'

type K8sAgentStatus = 'idle' | 'ready' | 'running' | 'error'

type WorkspaceKubernetesResourceAgentState = {
  k8sClusters: Ref<K8sCluster[]>
  k8sResources: Ref<K8sResource[]>
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
  k8sAgentCluster: ComputedRef<K8sCluster | null>
  k8sResourceCluster: ComputedRef<K8sCluster | null>
}

type WorkspaceKubernetesResourceAgentDeps = {
  setK8sNotice: (text: string) => void
  applyKubernetesCatalog: (catalog: KubernetesCatalog) => KubernetesCatalog
  openK8sTerminal: (clusterId: string) => Promise<K8sTerminalTab | null>
  sendK8sTerminalCommand: (command: string) => Promise<string>
  sendChat: K8sSendChat
}

export const createWorkspaceKubernetesResourceAgentController = (
  state: WorkspaceKubernetesResourceAgentState,
  deps: WorkspaceKubernetesResourceAgentDeps
) => {
  const {
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
  } = state
  const { setK8sNotice, applyKubernetesCatalog, openK8sTerminal, sendK8sTerminalCommand, sendChat } = deps
  let k8sAgentCleanupRequest = 0

  const executeK8sBackendCommand = async (
    command: string,
    clusterId: string,
    namespace: string,
    source: 'terminal' | 'agent' | 'resource'
  ): Promise<K8sBackendCommandData | null> => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    const executeKubernetesCommand = kubernetesClient.executeKubernetesCommand()
    if (!executeKubernetesCommand) {
      setK8sNotice('Kubernetes command API 不可用')
      return null
    }
    try {
      const result = await executeKubernetesCommand({
        command,
        clusterId,
        clusterName: cluster?.name,
        contextName: cluster?.context_name,
        namespace,
        defaultNamespace: cluster?.default_namespace,
        source
      })
      if (result.ok && isK8sBackendCommandForRequest(result.data, { command, clusterId, namespace, source })) return result.data
      if (result.ok) {
        setK8sNotice('Kubernetes command backend returned malformed result data.')
        return null
      }
      setK8sNotice(result.errorMessage || 'Kubernetes command failed.')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes command failed.')
      return null
    }
  }

  const currentK8sOutputCommand = () => currentK8sOutputCommandRuntime(k8sResourceOutput.value)

  const planK8sResourceAction = async (resourceId: string, action: K8sResourceAction = 'get'): Promise<K8sBackendResourceActionPlanData | null> => {
    const planKubernetesResourceAction = kubernetesClient.planKubernetesResourceAction()
    if (!planKubernetesResourceAction) {
      setK8sNotice('Kubernetes resource action API 不可用')
      return null
    }
    try {
      const result = await planKubernetesResourceAction({ resourceId, action })
      const resource = k8sResources.value.find((item) => item.id === resourceId)
      if (result.ok && isK8sResourceActionPlanData(result.data, { resourceId, action, resource })) return result.data
      if (result.ok) {
        setK8sNotice('Kubernetes resource action backend returned malformed plan data.')
        return null
      }
      setK8sNotice(result.errorMessage || 'Kubernetes 资源命令生成失败')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes 资源命令生成失败')
      return null
    }
  }

  const executeK8sResourceAction = async (resourceId: string, action: K8sResourceAction = 'get'): Promise<K8sBackendResourceActionData | null> => {
    const executeKubernetesResourceAction = kubernetesClient.executeKubernetesResourceAction()
    if (!executeKubernetesResourceAction) {
      setK8sNotice('Kubernetes resource action API 不可用')
      return null
    }
    try {
      const result = await executeKubernetesResourceAction({ resourceId, action })
      const resource = k8sResources.value.find((item) => item.id === resourceId)
      if (result.ok && isK8sBackendResourceActionData(result.data, { resourceId, action, resource })) return result.data
      if (result.ok) {
        setK8sNotice('Kubernetes resource action backend returned malformed result data.')
        return null
      }
      setK8sNotice(result.errorMessage || 'Kubernetes 资源操作失败')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes 资源操作失败')
      return null
    }
  }

  const setK8sAgentCluster = (clusterId: string | null) => {
    const selection = selectK8sAgentClusterState(k8sClusters.value, clusterId)
    k8sAgentClusterId.value = selection.agentClusterId
    k8sAgentContextName.value = selection.agentContextName
    k8sAgentStatus.value = selection.agentStatus
    const cluster = selection.cluster
    if (cluster) setK8sNotice(`Kubernetes Agent 已切换到 ${cluster.name}`)
    return Boolean(cluster)
  }

  const setK8sResourceKind = (kind: K8sResourceKind) => {
    const next = setK8sResourceKindState(kind, k8sResourceNamespace.value)
    k8sResourceKind.value = next.kind
    k8sResourceNamespace.value = next.namespace
  }

  const setK8sResourceNamespace = (namespace: string) => {
    k8sResourceNamespace.value = namespace
  }

  const addK8sAgentRun = (result: K8sBackendCommandData | K8sBackendResourceRefreshData, fallbackCluster?: K8sCluster | null) => {
    const cluster = fallbackCluster ?? k8sAgentCluster.value
    const record = createK8sAgentRunRecord(result, { fallbackCluster: cluster, agentContextName: k8sAgentContextName.value })
    k8sAgentRuns.value = addK8sAgentRunRecord(k8sAgentRuns.value, record)
    k8sAgentLastResult.value = record
    return record
  }

  const runK8sAgentKubectl = async (command?: string) => {
    const cluster = k8sAgentCluster.value
    const text = (command ?? k8sAgentCommandDraft.value).trim()
    if (!cluster || !text) {
      const result = await executeK8sBackendCommand(text, cluster?.id || '', k8sResourceNamespace.value === 'all' ? 'all' : k8sResourceNamespace.value, 'agent')
      if (!result) {
        k8sAgentStatus.value = 'error'
        setK8sNotice('Kubernetes Agent 执行失败')
        return null
      }
      const failed = addK8sAgentRun(result, cluster)
      k8sAgentStatus.value = 'error'
      setK8sNotice(failed.error || 'Kubernetes Agent 执行失败')
      return failed
    }
    k8sAgentStatus.value = 'running'
    const namespace = k8sResourceNamespace.value === 'all' ? cluster.default_namespace || 'default' : k8sResourceNamespace.value
    const result = await executeK8sBackendCommand(text, cluster.id, namespace, 'agent')
    if (!result) {
      k8sAgentStatus.value = 'error'
      k8sResourceOutputTitle.value = `Agent kubectl / ${cluster.name}`
      k8sResourceOutput.value = text
      return null
    }
    const record = addK8sAgentRun(result, cluster)
    k8sAgentCommandHistory.value = [text, ...k8sAgentCommandHistory.value.filter((item) => item !== text)].slice(0, 12)
    k8sAgentCommandDraft.value = text
    k8sAgentStatus.value = result.success ? 'ready' : 'error'
    k8sResourceOutputTitle.value = `Agent kubectl / ${cluster.name}`
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
    setK8sNotice(result.success ? 'Kubernetes Agent 命令执行完成' : result.error || result.output || 'Kubernetes Agent 命令执行失败')
    return record
  }

  const testK8sAgentConnection = async () => {
    k8sAgentTesting.value = true
    const record = await runK8sAgentKubectl('kubectl version --request-timeout=10s')
    if (!record) {
      k8sAgentStatus.value = 'error'
      k8sResourceOutputTitle.value = 'Agent Test Connection'
      window.setTimeout(() => {
        k8sAgentTesting.value = false
      }, 160)
      setK8sNotice('Kubernetes Agent 连接测试失败')
      return null
    }
    k8sAgentStatus.value = record.status === 'success' ? 'ready' : 'error'
    k8sResourceOutputTitle.value = 'Agent Test Connection'
    k8sResourceOutput.value = k8sCommandDisplayOutput(record)
    window.setTimeout(() => {
      k8sAgentTesting.value = false
    }, 160)
    setK8sNotice(record.status === 'success' ? 'Kubernetes Agent 连接测试成功' : 'Kubernetes Agent 连接测试失败')
    return record
  }

  const refreshK8sAgentNamespaces = async () => {
    const cluster = k8sAgentCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes Agent 集群')
      return null
    }
    const result = await executeK8sBackendCommand('kubectl get namespaces', cluster.id, cluster.default_namespace, 'agent')
    if (!result) return null
    const record = addK8sAgentRun(result, cluster)
    k8sResourceOutputTitle.value = `Namespaces / ${cluster.name}`
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
    setK8sNotice(result.success ? 'Kubernetes namespaces 已刷新' : result.error || 'Kubernetes namespaces 刷新失败')
    return record
  }

  const cleanupK8sAgent = async () => {
    const cleanupKubernetesAgent = kubernetesClient.cleanupKubernetesAgent()
    if (!cleanupKubernetesAgent) {
      setK8sNotice('Kubernetes Agent cleanup API 不可用')
      return false
    }
    const requestId = ++k8sAgentCleanupRequest
    const requestedClusterId = k8sAgentClusterId.value
    const requestedContextName = k8sAgentContextName.value
    try {
      const result = await cleanupKubernetesAgent()
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes Agent 清理失败')
        return false
      }
      if (!isK8sAgentCleanupData(result.data)) {
        setK8sNotice('Kubernetes Agent cleanup backend returned malformed result data.')
        return false
      }
      if (requestId !== k8sAgentCleanupRequest || requestedClusterId !== k8sAgentClusterId.value || requestedContextName !== k8sAgentContextName.value) return false
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes Agent 清理失败')
      return false
    }
    k8sAgentClusterId.value = null
    k8sAgentContextName.value = ''
    k8sAgentStatus.value = 'idle'
    k8sAgentLastResult.value = null
    setK8sNotice('Kubernetes Agent 已清理')
    return true
  }

  const refreshK8sResources = async () => {
    const cluster = k8sResourceCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes 集群')
      return
    }
    const refreshKubernetesResources = kubernetesClient.refreshKubernetesResources()
    if (!refreshKubernetesResources) {
      setK8sNotice('Kubernetes resource refresh API 不可用')
      return null
    }
    k8sResourceLoading.value = true
    k8sResourceOutputTitle.value = `${cluster.name} / ${k8sKindLabels[k8sResourceKind.value]}`
    try {
      const result = await refreshKubernetesResources({
        clusterId: cluster.id,
        namespace: k8sResourceNamespace.value,
        kind: k8sResourceKind.value
      })
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 资源刷新失败')
        k8sResourceLoading.value = false
        return null
      }
      if (!isK8sBackendResourceRefreshData(result.data, { clusterId: cluster.id, kind: k8sResourceKind.value, namespace: k8sResourceNamespace.value })) {
        setK8sNotice('Kubernetes resource refresh backend returned malformed result data.')
        k8sResourceLoading.value = false
        return null
      }
      applyKubernetesCatalog(result.data)
      const record = addK8sAgentRun(result.data, cluster)
      k8sResourceOutput.value = k8sCommandDisplayOutput(result.data)
      k8sResourceLoading.value = false
      setK8sNotice(result.data.success ? result.data.message || 'Kubernetes 资源已刷新' : result.data.error || result.data.message || 'Kubernetes 资源刷新失败')
      return record
    } catch (error) {
      k8sResourceLoading.value = false
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes 资源刷新失败')
      return null
    }
  }

  const describeK8sResource = async (resourceId: string) => {
    const result = await executeK8sResourceAction(resourceId, 'describe')
    if (!result) return
    k8sResourceOutputTitle.value = result.title
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
  }

  const showK8sPodLogs = async (resourceId: string) => {
    const result = await executeK8sResourceAction(resourceId, 'logs')
    if (!result) return
    k8sResourceOutputTitle.value = result.title
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
  }

  const writeK8sClipboardText = async (text: string, fallbackError: string) => {
    const copied = await copyTextToClipboard(text)
    if (!copied) setK8sNotice(fallbackError)
    return copied
  }

  const copyK8sResourceCommand = async (resourceId: string, action: K8sResourceAction = 'get') => {
    const plan = await planK8sResourceAction(resourceId, action)
    if (!plan) return ''
    const command = plan.command
    const copied = await writeK8sClipboardText(command, 'Kubernetes kubectl command copy failed.')
    if (!copied) return ''
    k8sCopiedCommand.value = command
    setK8sNotice('kubectl 命令已复制')
    return command
  }

  const copyK8sResourceOutput = async () => {
    const output = k8sResourceOutput.value.trim()
    if (!output) return ''
    const copied = await writeK8sClipboardText(output, 'Kubernetes output copy failed.')
    if (!copied) return ''
    setK8sNotice('Kubernetes 输出已复制')
    return output
  }

  const clearK8sResourceOutput = () => {
    k8sCopiedCommand.value = ''
    k8sResourceOutputTitle.value = '资源输出'
    k8sResourceOutput.value = '选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。'
    setK8sNotice('Kubernetes 输出已清空')
  }

  const sendK8sCurrentOutputToTerminal = async () => {
    const cluster = k8sResourceCluster.value
    const command = currentK8sOutputCommand()
    if (!cluster || !command) {
      setK8sNotice('当前没有可发送到终端的 kubectl 命令')
      return ''
    }
    await openK8sTerminal(cluster.id)
    const terminalOutput = await sendK8sTerminalCommand(command)
    if (!terminalOutput) return ''
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
    return command
  }

  const sendK8sCurrentOutputToAi = async () => {
    const cluster = k8sResourceCluster.value
    const output = k8sResourceOutput.value.trim()
    if (!cluster || !output) {
      setK8sNotice('当前没有可发送到 AI 的 Kubernetes 输出')
      return false
    }
    const host: AiContextOption = {
      id: `k8s-${cluster.id}`,
      kind: 'hosts',
      label: cluster.name,
      detail: `${cluster.context_name} / ${cluster.default_namespace}`
    }
    const sent = await sendChat(`请分析这个 Kubernetes 输出并给出下一步排查建议：\n\nTerminal output:\n\`\`\`\n${output}\n\`\`\``, undefined, [host], {
      skipKnowledgeSearch: true
    })
    if (!sent) return false
    setK8sNotice('Kubernetes 输出已发送到 AI')
    return true
  }

  const sendK8sResourceCommand = async (resourceId: string, action: K8sResourceAction = 'get') => {
    const plan = await planK8sResourceAction(resourceId, action)
    const cluster = plan ? k8sClusters.value.find((item) => item.id === plan.clusterId) : null
    if (!plan || !cluster) return
    await openK8sTerminal(plan.clusterId)
    const terminalOutput = await sendK8sTerminalCommand(plan.command)
    if (!terminalOutput) return
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
  }

  return {
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
  }
}
