import type { AiopsMutationResult } from './common'

export type KubernetesConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export type KubernetesClusterSource = 'local' | 'jumpserver'

export type KubernetesContextInfo = {
  name: string
  cluster: string
  namespace: string
  server: string
  isActive: boolean
}

export type KubernetesClusterRecord = {
  id: string
  name: string
  kubeconfig_path: string | null
  kubeconfig_content: string | null
  context_name: string
  server_url: string
  auth_type: string
  is_active: number
  connection_status: KubernetesConnectionStatus
  auto_connect: number
  default_namespace: string
  created_at: string
  updated_at: string
  source_type: KubernetesClusterSource
  bastion_uuid: string | null
  bastion_asset_address: string | null
  bastion_asset_name: string | null
  bastion_asset_id_last: number | null
}

export type KubernetesClusterInput = {
  name: string
  contextName: string
  serverUrl: string
  defaultNamespace?: string
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
  sourceType?: KubernetesClusterSource
  bastionUuid?: string | null
  authType?: string
  autoConnect?: boolean
}

export type KubernetesClusterUpdateInput = {
  name?: string
  defaultNamespace?: string
  autoConnect?: boolean
}

export type KubernetesClusterTestInput = {
  contextName: string
  serverUrl?: string
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
}

export type KubernetesClusterTestResult = AiopsMutationResult<{
  success: boolean
  isValid: boolean
  contextName: string
  serverUrl: string
  message: string
  command?: string
  output?: string
  error?: string
  durationMs?: number
}>

export type KubernetesImportContextInfo = {
  name: string
  cluster: string
  server: string
  namespace: string
}

export type KubernetesKubeconfigImportInput = {
  requestId?: string | null
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
}

export type KubernetesKubeconfigImportResult = AiopsMutationResult<{
  requestId: string
  contexts: KubernetesImportContextInfo[]
  kubeconfigPath: string
  kubeconfigContent: string
  currentContext: string
}>

export type KubernetesBastionGroup = {
  uuid: string
  label: string
  ip: string
}

export type KubernetesResourceKind = 'pods' | 'deployments' | 'services' | 'nodes'

export type KubernetesNamespaceInfo = {
  id: string
  clusterId: string
  name: string
  status: string
  age: string
}

export type KubernetesResource = {
  id: string
  clusterId: string
  kind: KubernetesResourceKind
  name: string
  namespace: string
  status: string
  ready: string
  age: string
  detail: string
  node?: string
  image?: string
  ports?: string
  restarts?: number
  selector?: string
}

export type KubernetesResourceAction = 'get' | 'describe' | 'logs'

export type KubernetesResourceActionInput = {
  resourceId: string
  action?: KubernetesResourceAction
}

export type KubernetesResourceActionPlanResult = AiopsMutationResult<{
  resourceId: string
  resourceName: string
  resourceKind: KubernetesResourceKind
  action: KubernetesResourceAction
  title: string
  command: string
  clusterId: string
  clusterName: string
  contextName: string
  namespace: string
}>

export type KubernetesProxyType = 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'

export type KubernetesAgentProxyConfig = {
  enabled: boolean
  type: KubernetesProxyType
  host: string
  port: number
  enableProxyIdentity: boolean
  username: string
  password: string
  updatedAt: string
}

export type KubernetesAgentProxyConfigInput = Partial<Omit<KubernetesAgentProxyConfig, 'updatedAt'>>

export type KubernetesAgentProxyConfigResult = AiopsMutationResult<{
  proxyConfig: KubernetesAgentProxyConfig
  message: string
}>

export type KubernetesCatalog = {
  contexts: KubernetesContextInfo[]
  currentContext: string
  clusters: KubernetesClusterRecord[]
  bastions: KubernetesBastionGroup[]
  namespaces: KubernetesNamespaceInfo[]
  resources: KubernetesResource[]
  importContexts: KubernetesImportContextInfo[]
  activeClusterId: string | null
  selectedClusterId: string | null
  agentProxyConfig: KubernetesAgentProxyConfig
}

export type KubernetesCatalogResult = AiopsMutationResult<KubernetesCatalog>
export type KubernetesClusterMutationResult = AiopsMutationResult<KubernetesCatalog & { cluster?: KubernetesClusterRecord }>
export type KubernetesContextSwitchResult = AiopsMutationResult<KubernetesCatalog & { currentContext: string }>
export type KubernetesBastionSyncResult = AiopsMutationResult<KubernetesCatalog & { syncedCount: number; updatedCount: number }>

export type KubernetesTerminalStatus = 'connecting' | 'connected' | 'ended' | 'error'

export type KubernetesTerminalCreateInput = {
  clusterId: string
  namespace?: string
  cols?: number
  rows?: number
}

export type KubernetesTerminalRecord = {
  id: string
  sessionId: string
  clusterId: string
  name: string
  namespace: string
  output: string
  status: KubernetesTerminalStatus
  cols: number
  rows: number
  createdAt: string
  updatedAt: string
}

export type KubernetesTerminalCreateResult = AiopsMutationResult<KubernetesTerminalRecord>
export type KubernetesTerminalMutationResult = AiopsMutationResult<KubernetesTerminalRecord>
export type KubernetesTerminalCloseResult = AiopsMutationResult<KubernetesTerminalRecord & { exitCode: number }>
export type KubernetesTerminalWriteData = {
  id: string
  sessionId: string
  bytes: number
  command: string
  output: string
  success: boolean
  error: string
  terminalOutput: string
  updatedAt: string
}
export type KubernetesTerminalWriteResult = AiopsMutationResult<KubernetesTerminalWriteData>
export type KubernetesTerminalDataEvent = {
  id: string
  sessionId: string
  clusterId: string
  data: string
  command: string
  output: string
  success: boolean
  error: string
  emittedAt: string
}
export type KubernetesTerminalExitEvent = {
  id: string
  sessionId: string
  clusterId: string
  exitCode: number
  reason: 'closed' | 'disconnect' | 'error'
  error?: string
  emittedAt: string
}

export type KubernetesCommandInput = {
  command: string
  clusterId?: string
  clusterName?: string
  contextName?: string
  namespace?: string
  defaultNamespace?: string
  source?: 'terminal' | 'agent' | 'resource'
}

export type KubernetesCommandResult = AiopsMutationResult<{
  runId: string
  command: string
  output: string
  terminalOutput: string
  success: boolean
  error: string
  durationMs: number
  startedAt: string
  clusterId: string
  contextName: string
  namespace: string
  source: 'terminal' | 'agent' | 'resource'
}>

export type KubernetesResourceActionExecuteResult = AiopsMutationResult<
  NonNullable<KubernetesCommandResult['data']> & {
    resourceId: string
    resourceName: string
    resourceKind: KubernetesResourceKind
    action: KubernetesResourceAction
    title: string
  }
>

export type KubernetesResourceRefreshInput = {
  clusterId: string
  namespace?: string
  kind?: KubernetesResourceKind | 'all'
}

export type KubernetesResourceRefreshResult = AiopsMutationResult<
  KubernetesCatalog & {
    runId: string
    refreshedClusterId: string
    refreshedKind: KubernetesResourceKind | 'all'
    clusterId: string
    contextName: string
    namespace: string
    command: string
    output: string
    terminalOutput: string
    success: boolean
    error: string
    durationMs: number
    startedAt: string
    source: 'resource'
    refreshedResources: number
    refreshedNamespaces: number
    message: string
  }
>

export type KubernetesAgentCleanupResult = AiopsMutationResult<{
  cleared: boolean
  cleanedAt: string
}>
