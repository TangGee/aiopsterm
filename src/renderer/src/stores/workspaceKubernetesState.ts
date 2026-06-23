import { computed, ref } from 'vue'
import {
  type K8sBastionGroup,
  type K8sCluster,
  type K8sContextInfo,
  type K8sImportContextInfo,
  type K8sNamespaceInfo,
  type K8sProxyConfig,
  type K8sResource,
  type K8sResourceKind
} from '@/services/kubernetesBackendGuards'
import {
  cloneK8sProxyConfig,
  defaultK8sProxyConfig,
  filteredK8sBastions as filteredK8sBastionsRuntime,
  filteredK8sClusters as filteredK8sClustersRuntime,
  filteredK8sResources as filteredK8sResourcesRuntime,
  k8sActiveContext as k8sActiveContextRuntime,
  k8sActiveNamespaces as k8sActiveNamespacesRuntime,
  k8sActiveTerminal as k8sActiveTerminalRuntime,
  k8sAgentCluster as k8sAgentClusterRuntime,
  k8sAgentCurrentCluster as k8sAgentCurrentClusterRuntime,
  k8sClusterById,
  k8sHasContexts as k8sHasContextsRuntime,
  k8sResourceCluster as k8sResourceClusterRuntime,
  k8sResourceSummary as k8sResourceSummaryRuntime,
  localK8sClusters as localK8sClustersRuntime,
  type K8sAgentRunRecord,
  type K8sTerminalTab
} from '@/services/kubernetesRuntime'

export const createWorkspaceKubernetesState = () => {
  const k8sContexts = ref<K8sContextInfo[]>([])
  const k8sClusters = ref<K8sCluster[]>([])
  const k8sBastions = ref<K8sBastionGroup[]>([])
  const k8sNamespaces = ref<K8sNamespaceInfo[]>([])
  const k8sResources = ref<K8sResource[]>([])
  const k8sConnectingClusterIds = ref<string[]>([])
  const k8sSyncingBastionIds = ref<string[]>([])
  const k8sDeleteConfirmClusterId = ref<string | null>(null)
  const k8sClusterActionMenuId = ref<string | null>(null)
  const k8sImportContexts = ref<K8sImportContextInfo[]>([])
  const k8sActiveClusterId = ref<string | null>(null)
  const k8sSearchQuery = ref('')
  const k8sConfigTab = ref<'local' | 'jumpserver'>('local')
  const k8sSelectedClusterId = ref<string | null>(null)
  const k8sClusterNotice = ref('')
  const k8sTerminalTabs = ref<K8sTerminalTab[]>([])
  const k8sActiveTerminalId = ref<string | null>(null)
  const k8sAddModalOpen = ref(false)
  const k8sEditModalOpen = ref(false)
  const k8sEditingClusterId = ref<string | null>(null)
  const k8sAddMode = ref<'import' | 'manual'>('import')
  const k8sTestResult = ref<boolean | null>(null)
  const k8sCollapsedBastionIds = ref<string[]>([])
  const k8sResourceKind = ref<K8sResourceKind>('pods')
  const k8sResourceNamespace = ref('all')
  const k8sResourceQuery = ref('')
  const k8sResourceOutput = ref('选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。')
  const k8sResourceOutputTitle = ref('资源输出')
  const k8sResourceLoading = ref(false)
  const k8sCopiedCommand = ref('')
  const k8sAgentClusterId = ref<string | null>(null)
  const k8sAgentContextName = ref('')
  const k8sAgentStatus = ref<'idle' | 'ready' | 'running' | 'error'>('idle')
  const k8sAgentCommandDraft = ref('kubectl get pods -A')
  const k8sAgentCommandHistory = ref<string[]>(['kubectl get pods -A', 'kubectl get namespaces', 'kubectl version --request-timeout=10s'])
  const k8sAgentRuns = ref<K8sAgentRunRecord[]>([])
  const k8sAgentLastResult = ref<K8sAgentRunRecord | null>(null)
  const k8sAgentTesting = ref(false)
  const savedK8sProxyConfig = ref<K8sProxyConfig>(cloneK8sProxyConfig(defaultK8sProxyConfig))
  const k8sProxyConfig = ref<K8sProxyConfig>(cloneK8sProxyConfig(defaultK8sProxyConfig))
  const k8sProxyConfigOpen = ref(false)

  const k8sHasContexts = computed(() => k8sHasContextsRuntime(k8sContexts.value))
  const k8sActiveContext = computed(() => k8sActiveContextRuntime(k8sContexts.value))
  const k8sSelectedCluster = computed(() => k8sClusterById(k8sClusters.value, k8sSelectedClusterId.value))
  const k8sActiveCluster = computed(() => k8sClusterById(k8sClusters.value, k8sActiveClusterId.value))
  const k8sDeleteConfirmCluster = computed(() => k8sClusterById(k8sClusters.value, k8sDeleteConfirmClusterId.value))
  const filteredK8sClusters = computed(() => filteredK8sClustersRuntime(k8sClusters.value, k8sSearchQuery.value))
  const localK8sClusters = computed(() => localK8sClustersRuntime(filteredK8sClusters.value))
  const filteredK8sBastions = computed(() => filteredK8sBastionsRuntime(k8sBastions.value, k8sClusters.value, k8sSearchQuery.value))
  const k8sActiveTerminal = computed(() => k8sActiveTerminalRuntime(k8sTerminalTabs.value, k8sActiveTerminalId.value))
  const k8sAgentCluster = computed(() => k8sAgentClusterRuntime(k8sClusters.value, k8sAgentClusterId.value))
  const k8sAgentCurrentCluster = computed(() => k8sAgentCurrentClusterRuntime(k8sAgentCluster.value, k8sAgentContextName.value))
  const k8sResourceCluster = computed(() => k8sResourceClusterRuntime(k8sClusters.value, k8sActiveClusterId.value, k8sSelectedClusterId.value))
  const k8sActiveNamespaces = computed(() => k8sActiveNamespacesRuntime(k8sNamespaces.value, k8sResources.value, k8sResourceCluster.value?.id || null))
  const filteredK8sResources = computed(() =>
    filteredK8sResourcesRuntime(k8sResources.value, {
      clusterId: k8sResourceCluster.value?.id || null,
      kind: k8sResourceKind.value,
      namespace: k8sResourceNamespace.value,
      query: k8sResourceQuery.value
    })
  )
  const k8sResourceSummary = computed<Record<K8sResourceKind, number>>(() =>
    k8sResourceSummaryRuntime(k8sResources.value, k8sResourceCluster.value?.id || null, k8sResourceNamespace.value)
  )

  return {
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
    k8sAddMode,
    k8sTestResult,
    k8sCollapsedBastionIds,
    k8sResourceKind,
    k8sResourceNamespace,
    k8sResourceQuery,
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
    k8sHasContexts,
    k8sActiveContext,
    k8sSelectedCluster,
    k8sActiveCluster,
    k8sDeleteConfirmCluster,
    filteredK8sClusters,
    localK8sClusters,
    filteredK8sBastions,
    k8sActiveTerminal,
    k8sAgentCluster,
    k8sAgentCurrentCluster,
    k8sResourceCluster,
    k8sActiveNamespaces,
    filteredK8sResources,
    k8sResourceSummary
  }
}

export type WorkspaceKubernetesState = ReturnType<typeof createWorkspaceKubernetesState>
