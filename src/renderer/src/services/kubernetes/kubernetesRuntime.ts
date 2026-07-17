import type {
  K8sBackendCommandData,
  K8sBackendResourceRefreshData,
  K8sBastionGroup,
  K8sCluster,
  K8sContextInfo,
  K8sImportContextInfo,
  K8sNamespaceInfo,
  K8sProxyConfig,
  K8sResource,
  K8sResourceKind
} from '@/services/kubernetes/kubernetesBackendGuards'
import type { KubernetesCatalog, KubernetesTerminalDataEvent, KubernetesTerminalExitEvent, KubernetesTerminalRecord, KubernetesTerminalStatus } from '@shared/contracts/kubernetes'

export const defaultK8sProxyConfig: K8sProxyConfig = {
  enabled: false,
  type: 'SOCKS5',
  host: '127.0.0.1',
  port: 1080,
  enableProxyIdentity: false,
  username: '',
  password: '',
  updatedAt: ''
}

export const k8sKindLabels: Record<K8sResourceKind, string> = {
  pods: 'Pods',
  deployments: 'Deployments',
  services: 'Services',
  nodes: 'Nodes'
}

export type K8sTerminalStatus = KubernetesTerminalStatus
export type K8sTerminalTab = {
  id: string
  sessionId: string
  clusterId: string
  name: string
  namespace: string
  isActive: boolean
  output: string
  status: K8sTerminalStatus
  cols: number
  rows: number
  createdAt: string
  updatedAt: string
  exitCode: number | null
  commandHistory: string[]
  lastCommand: string
  lastCommandOutput: string
  collectingAiOutput: boolean
  aiCommandTabId: string | null
}

export type K8sAgentRunRecord = {
  id: string
  command: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  output: string
  error?: string
  clusterId: string | null
  contextName: string | null
  namespace: string
  startedAt: string
  durationMs: number
}

export type K8sCatalogState = {
  contexts: K8sContextInfo[]
  clusters: K8sCluster[]
  bastions: K8sBastionGroup[]
  namespaces: K8sNamespaceInfo[]
  resources: K8sResource[]
  importContexts: K8sImportContextInfo[]
  activeClusterId: string | null
  selectedClusterId: string | null
  connectingClusterIds: string[]
  syncingBastionIds: string[]
  terminalTabs: K8sTerminalTab[]
  activeTerminalId: string | null
  savedProxyConfig: K8sProxyConfig
  proxyConfig: K8sProxyConfig
  agentClusterId: string | null
  agentContextName: string
  agentStatus: 'idle' | 'ready' | 'running' | 'error'
}

export type K8sCatalogApplyInput = {
  selectedClusterId: string | null
  connectingClusterIds: string[]
  syncingBastionIds: string[]
  terminalTabs: K8sTerminalTab[]
  activeTerminalId: string | null
  proxyConfigOpen: boolean
  proxyConfig: K8sProxyConfig
  agentClusterId: string | null
  agentContextName: string
  agentStatus: K8sCatalogState['agentStatus']
}

export const cloneK8sProxyConfig = (config: K8sProxyConfig): K8sProxyConfig => ({ ...config })

export const k8sTerminalTabFromRecord = (record: KubernetesTerminalRecord): K8sTerminalTab => ({
  id: record.id,
  sessionId: record.sessionId,
  clusterId: record.clusterId,
  name: record.name,
  namespace: record.namespace,
  isActive: false,
  output: record.output,
  status: record.status,
  cols: record.cols,
  rows: record.rows,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  exitCode: null,
  commandHistory: [],
  lastCommand: '',
  lastCommandOutput: '',
  collectingAiOutput: false,
  aiCommandTabId: null
})

export const activatedK8sTerminalTabs = (tabs: K8sTerminalTab[], id: string) => tabs.map((tab) => ({ ...tab, isActive: tab.id === id }))

export const nextK8sActiveTerminalId = (tabs: K8sTerminalTab[], currentId: string | null) => {
  if (!tabs.length) return null
  if (currentId && tabs.some((tab) => tab.id === currentId)) return currentId
  return tabs[0].id
}

export const applyKubernetesCatalogState = (catalog: KubernetesCatalog, input: K8sCatalogApplyInput): K8sCatalogState => {
  const contexts = catalog.contexts.map((context) => ({ ...context }))
  const clusters = catalog.clusters.map((cluster) => ({ ...cluster }))
  const bastions = catalog.bastions.map((bastion) => ({ ...bastion }))
  const namespaces = catalog.namespaces.map((namespace) => ({ ...namespace }))
  const resources = catalog.resources.map((resource) => ({ ...resource }))
  const importContexts = catalog.importContexts.map((context) => ({ ...context }))
  const selectedClusterId =
    input.selectedClusterId && clusters.some((cluster) => cluster.id === input.selectedClusterId)
      ? input.selectedClusterId
      : catalog.selectedClusterId
  const connectingClusterIds = input.connectingClusterIds.filter((id) => clusters.some((cluster) => cluster.id === id))
  const syncingBastionIds = input.syncingBastionIds.filter((id) => bastions.some((bastion) => bastion.uuid === id))
  const terminalTabs = input.terminalTabs.filter((tab) => clusters.some((cluster) => cluster.id === tab.clusterId)).map((tab) => ({ ...tab }))
  const activeTerminalId = nextK8sActiveTerminalId(terminalTabs, input.activeTerminalId)
  const activatedTabs = activeTerminalId ? activatedK8sTerminalTabs(terminalTabs, activeTerminalId) : terminalTabs
  const agentProxyConfig = catalog.agentProxyConfig || defaultK8sProxyConfig
  const savedProxyConfig = cloneK8sProxyConfig(agentProxyConfig)
  const proxyConfig = input.proxyConfigOpen ? cloneK8sProxyConfig(input.proxyConfig) : cloneK8sProxyConfig(agentProxyConfig)
  const activeCluster = clusters.find((cluster) => cluster.id === catalog.activeClusterId)
  let agentClusterId = input.agentClusterId
  let agentContextName = input.agentContextName
  let agentStatus = input.agentStatus
  if (activeCluster && (!agentClusterId || !clusters.some((cluster) => cluster.id === agentClusterId))) {
    agentClusterId = activeCluster.id
    agentContextName = activeCluster.context_name
    agentStatus = 'ready'
  } else if (!activeCluster && agentClusterId && !clusters.some((cluster) => cluster.id === agentClusterId)) {
    agentClusterId = null
    agentContextName = ''
    agentStatus = 'idle'
  }

  return {
    contexts,
    clusters,
    bastions,
    namespaces,
    resources,
    importContexts,
    activeClusterId: catalog.activeClusterId,
    selectedClusterId,
    connectingClusterIds,
    syncingBastionIds,
    terminalTabs: activatedTabs,
    activeTerminalId,
    savedProxyConfig,
    proxyConfig,
    agentClusterId,
    agentContextName,
    agentStatus
  }
}

export const updateK8sIdSet = (ids: string[], id: string, enabled: boolean) =>
  enabled ? [...new Set([...ids, id])] : ids.filter((item) => item !== id)

export const updateK8sProxyDraft = (current: K8sProxyConfig, patch: Partial<K8sProxyConfig>) => {
  const next: K8sProxyConfig = {
    ...current,
    ...patch,
    port: patch.port === undefined ? current.port : Math.max(1, Math.min(65535, Number(patch.port) || 1))
  }
  if (!next.enableProxyIdentity) {
    next.username = ''
    next.password = ''
  }
  return next
}

export const k8sProxyConfigValid = (config: K8sProxyConfig) => !config.enabled || (Boolean(config.host.trim()) && Boolean(config.port))

export const k8sHasContexts = (contexts: K8sContextInfo[]) => contexts.length > 0

export const k8sActiveContext = (contexts: K8sContextInfo[]) => contexts.find((context) => context.isActive) || null

export const k8sClusterById = (clusters: K8sCluster[], clusterId: string | null) =>
  clusterId ? clusters.find((cluster) => cluster.id === clusterId) || null : null

export const localK8sClusters = (clusters: K8sCluster[]) => clusters.filter((cluster) => cluster.source_type === 'local')

export const k8sActiveTerminal = (tabs: K8sTerminalTab[], activeTerminalId: string | null) =>
  activeTerminalId ? tabs.find((tab) => tab.id === activeTerminalId) || null : null

export const k8sAgentCluster = (clusters: K8sCluster[], clusterId: string | null) => k8sClusterById(clusters, clusterId)

export const k8sAgentCurrentCluster = (cluster: K8sCluster | null, fallbackContextName: string) => ({
  clusterId: cluster?.id || null,
  contextName: cluster?.context_name || fallbackContextName || null
})

export const selectK8sAgentClusterState = (clusters: K8sCluster[], clusterId: string | null) => {
  const cluster = clusterId ? clusters.find((item) => item.id === clusterId) || null : null
  return {
    cluster,
    agentClusterId: cluster?.id || null,
    agentContextName: cluster?.context_name || '',
    agentStatus: cluster ? ('ready' as const) : ('idle' as const)
  }
}

export const filteredK8sClusters = (clusters: K8sCluster[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return clusters
  return clusters.filter((cluster) =>
    [cluster.name, cluster.context_name, cluster.server_url, cluster.default_namespace].some((value) => value.toLowerCase().includes(normalizedQuery))
  )
}

export const filteredK8sBastions = (bastions: K8sBastionGroup[], clusters: K8sCluster[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return bastions
  return bastions.filter((bastion) => {
    if ([bastion.label, bastion.ip].some((value) => value.toLowerCase().includes(normalizedQuery))) return true
    return clusters.some(
      (cluster) =>
        cluster.source_type === 'jumpserver' &&
        cluster.bastion_uuid === bastion.uuid &&
        [cluster.name, cluster.server_url].some((value) => value.toLowerCase().includes(normalizedQuery))
    )
  })
}

export const k8sResourceCluster = (clusters: K8sCluster[], activeClusterId: string | null, selectedClusterId: string | null) =>
  clusters.find((cluster) => cluster.id === activeClusterId) || clusters.find((cluster) => cluster.id === selectedClusterId) || clusters[0] || null

export const k8sActiveNamespaces = (namespaces: K8sNamespaceInfo[], resources: K8sResource[], clusterId: string | null) => {
  if (!clusterId) return []
  const namespaceNames = new Set<string>()
  namespaces.filter((namespace) => namespace.clusterId === clusterId).forEach((namespace) => namespaceNames.add(namespace.name))
  resources.filter((resource) => resource.clusterId === clusterId && resource.kind !== 'nodes').forEach((resource) => namespaceNames.add(resource.namespace))
  return [...namespaceNames].sort((a, b) => a.localeCompare(b))
}

export const filteredK8sResources = (
  resources: K8sResource[],
  input: { clusterId: string | null; kind: K8sResourceKind; namespace: string; query: string }
) => {
  if (!input.clusterId) return []
  const query = input.query.trim().toLowerCase()
  return resources.filter((resource) => {
    if (resource.clusterId !== input.clusterId || resource.kind !== input.kind) return false
    if (resource.kind !== 'nodes' && input.namespace !== 'all' && resource.namespace !== input.namespace) return false
    if (!query) return true
    return [
      resource.name,
      resource.namespace,
      resource.status,
      resource.ready,
      resource.detail,
      resource.node || '',
      resource.image || '',
      resource.ports || '',
      resource.selector || ''
    ].some((value) => value.toLowerCase().includes(query))
  })
}

export const k8sResourceSummary = (resources: K8sResource[], clusterId: string | null, namespace: string) => {
  const summary: Record<K8sResourceKind, number> = { pods: 0, deployments: 0, services: 0, nodes: 0 }
  if (!clusterId) return summary
  resources.forEach((resource) => {
    if (resource.clusterId !== clusterId) return
    if (resource.kind !== 'nodes' && namespace !== 'all' && resource.namespace !== namespace) return
    summary[resource.kind] += 1
  })
  return summary
}

// 与后端 1MiB 会话输出上限保持一致,渲染层长跑终端同样只保留尾部。
const k8sTerminalTabOutputMaxLength = 1024 * 1024

const capK8sTerminalOutput = (output: string) => (output.length > k8sTerminalTabOutputMaxLength ? output.slice(-k8sTerminalTabOutputMaxLength) : output)

export const appendK8sTerminalOutput = (tab: K8sTerminalTab, text: string): K8sTerminalTab => ({
  ...tab,
  output: capK8sTerminalOutput(tab.output.endsWith('\n') || !tab.output ? `${tab.output}${text}` : `${tab.output}\n${text}`),
  updatedAt: '刚刚'
})

// PTY 流式数据按字节流原样拼接;带 command 的事件是命令模式的整块输出,保留换行分隔。
export const appendK8sTerminalStream = (tab: K8sTerminalTab, text: string): K8sTerminalTab => ({
  ...tab,
  output: capK8sTerminalOutput(`${tab.output}${text}`),
  updatedAt: '刚刚'
})

export const applyK8sTerminalDataEvent = (tabs: K8sTerminalTab[], event: KubernetesTerminalDataEvent) =>
  tabs.map((tab) => {
    if (tab.sessionId !== event.sessionId || tab.id !== event.id || tab.clusterId !== event.clusterId || tab.status === 'ended' || tab.status === 'error') {
      return tab
    }
    const next = event.data ? (event.command ? appendK8sTerminalOutput(tab, event.data) : appendK8sTerminalStream(tab, event.data)) : { ...tab }
    return {
      ...next,
      lastCommandOutput: event.data,
      updatedAt: event.emittedAt
    }
  })

export const applyK8sTerminalExitEvent = (tabs: K8sTerminalTab[], event: KubernetesTerminalExitEvent) =>
  tabs.map((tab) =>
    tab.sessionId === event.sessionId && tab.id === event.id && tab.clusterId === event.clusterId
      ? {
          ...tab,
          status: event.reason === 'error' ? ('error' as const) : ('ended' as const),
          exitCode: event.exitCode,
          collectingAiOutput: false,
          updatedAt: event.emittedAt
        }
      : tab
  )

export const completeK8sTerminalConnectTabs = (tabs: K8sTerminalTab[], clusterId: string) =>
  tabs.map((tab) => (tab.clusterId === clusterId && tab.status === 'connecting' ? { ...tab, status: 'connected' as const, updatedAt: '刚刚' } : tab))

export const markK8sClusterTerminalTabsEnded = (tabs: K8sTerminalTab[], clusterId: string) =>
  tabs.map((tab) =>
    tab.clusterId === clusterId && tab.status !== 'ended'
      ? {
          ...tab,
          status: 'ended' as const,
          exitCode: 0,
          collectingAiOutput: false,
          updatedAt: '刚刚'
        }
      : tab
  )

export const closeK8sTerminalTabState = (tabs: K8sTerminalTab[], activeTerminalId: string | null, id: string) => {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return { tabs, activeTerminalId }
  const nextTabs = tabs.filter((_, itemIndex) => itemIndex !== index)
  if (activeTerminalId !== id) return { tabs: nextTabs, activeTerminalId }
  const next = nextTabs[Math.min(index, nextTabs.length - 1)]
  const nextActiveTerminalId = next?.id || null
  return {
    tabs: nextActiveTerminalId ? activatedK8sTerminalTabs(nextTabs, nextActiveTerminalId) : nextTabs,
    activeTerminalId: nextActiveTerminalId
  }
}

export const updateK8sTerminalTabFromRecord = (tab: K8sTerminalTab, record: KubernetesTerminalRecord): K8sTerminalTab => ({
  ...tab,
  cols: record.cols,
  rows: record.rows,
  updatedAt: record.updatedAt,
  status: record.status
})

export const updateK8sTerminalTabCommandResult = (tab: K8sTerminalTab, command: string, updatedAt: string): K8sTerminalTab => ({
  ...tab,
  commandHistory: [command, ...tab.commandHistory.filter((item) => item !== command)].slice(0, 20),
  lastCommand: command,
  updatedAt
})

export const startK8sTerminalAiCollection = (tab: K8sTerminalTab, command: string, tabId?: string): K8sTerminalTab => ({
  ...tab,
  collectingAiOutput: Boolean(command.trim()),
  aiCommandTabId: command.trim() ? tabId || tab.id : null
})

export const stopK8sTerminalAiCollection = (tab: K8sTerminalTab): K8sTerminalTab => ({
  ...tab,
  collectingAiOutput: false,
  aiCommandTabId: null
})

export const currentK8sOutputCommand = (output: string) => output.split('\n').find((line) => line.trim().startsWith('kubectl '))?.trim() || ''

export const setK8sResourceKindState = (kind: K8sResourceKind, namespace: string) => ({
  kind,
  namespace: kind === 'nodes' ? 'all' : namespace
})

export const createK8sAgentRunRecord = (
  result: K8sBackendCommandData | K8sBackendResourceRefreshData,
  input: { fallbackCluster?: K8sCluster | null; agentContextName: string }
): K8sAgentRunRecord => ({
  id: result.runId,
  command: result.command,
  status: result.success ? 'success' : 'error',
  output: result.output,
  error: result.error || undefined,
  clusterId: result.clusterId || input.fallbackCluster?.id || null,
  contextName: result.contextName || input.fallbackCluster?.context_name || input.agentContextName || null,
  namespace: result.namespace,
  startedAt: result.startedAt,
  durationMs: result.durationMs
})

export const addK8sAgentRunRecord = (runs: K8sAgentRunRecord[], record: K8sAgentRunRecord) => [record, ...runs].slice(0, 12)
