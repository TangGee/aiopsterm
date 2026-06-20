import type {
  KubernetesAgentProxyConfig,
  KubernetesBastionGroup,
  KubernetesCatalog,
  KubernetesClusterRecord,
  KubernetesClusterTestInput,
  KubernetesCommandResult,
  KubernetesConnectionStatus,
  KubernetesContextInfo,
  KubernetesImportContextInfo,
  KubernetesKubeconfigImportResult,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceAction,
  KubernetesResourceActionExecuteResult,
  KubernetesResourceActionPlanResult,
  KubernetesResourceKind,
  KubernetesResourceRefreshResult,
  KubernetesTerminalCloseResult,
  KubernetesTerminalDataEvent,
  KubernetesTerminalExitEvent,
  KubernetesTerminalRecord,
  KubernetesTerminalStatus,
  KubernetesTerminalWriteData
} from '@shared/contracts/kubernetes'

export type K8sContextInfo = KubernetesContextInfo
export type K8sCluster = KubernetesClusterRecord
export type K8sBastionGroup = KubernetesBastionGroup
export type K8sImportContextInfo = KubernetesImportContextInfo
export type K8sNamespaceInfo = KubernetesNamespaceInfo
export type K8sResource = KubernetesResource
export type K8sResourceKind = KubernetesResourceKind
export type K8sResourceAction = KubernetesResourceAction
export type K8sConnectionStatus = KubernetesConnectionStatus
export type K8sProxyConfig = KubernetesAgentProxyConfig
export type K8sTerminalStatus = KubernetesTerminalStatus
export type K8sBackendCommandData = NonNullable<KubernetesCommandResult['data']>
export type K8sBackendResourceRefreshData = NonNullable<KubernetesResourceRefreshResult['data']>
export type K8sBackendResourceActionPlanData = NonNullable<KubernetesResourceActionPlanResult['data']>
export type K8sBackendResourceActionData = NonNullable<KubernetesResourceActionExecuteResult['data']>
export type K8sKubeconfigImportData = NonNullable<KubernetesKubeconfigImportResult['data']>
export type K8sClusterTestData = {
  success: boolean
  isValid: boolean
  contextName: string
  serverUrl: string
  message: string
  command?: string
  output?: string
  error?: string
  durationMs?: number
}
export type K8sProxyConfigData = {
  proxyConfig: K8sProxyConfig
  message: string
}
export type K8sTerminalCloseData = NonNullable<KubernetesTerminalCloseResult['data']>
export type K8sTerminalWriteResultData = KubernetesTerminalWriteData
export type K8sAgentCleanupData = {
  cleared: true
  cleanedAt: string
}
export type K8sKubeconfigImportRequest = {
  requestId: string
  kubeconfigPath?: string
  kubeconfigContent?: string
}

const k8sResourceKinds: K8sResourceKind[] = ['pods', 'deployments', 'services', 'nodes']
const k8sResourceActions: K8sResourceAction[] = ['get', 'describe', 'logs']
const k8sRefreshKinds: Array<K8sResourceKind | 'all'> = [...k8sResourceKinds, 'all']
const k8sCommandSources: Array<K8sBackendCommandData['source']> = ['terminal', 'agent', 'resource']
const k8sConnectionStatuses: K8sConnectionStatus[] = ['connected', 'connecting', 'disconnected', 'error']
const k8sClusterSources: Array<K8sCluster['source_type']> = ['local', 'jumpserver']
const k8sTerminalStatuses: K8sTerminalStatus[] = ['connecting', 'connected', 'ended', 'error']
const k8sProxyTypes: Array<K8sProxyConfig['type']> = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonNegativeFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPositiveFiniteNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0
const isK8sNumberFlag = (value: unknown) => value === 0 || value === 1
const isK8sOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isK8sOptionalNonNegativeNumber = (value: unknown) => value === undefined || isNonNegativeFiniteNumber(value)
const isNumberOrNull = (value: unknown): value is number | null => value === null || isFiniteNumber(value)

export const isK8sAgentProxyConfig = (source: unknown): source is K8sProxyConfig =>
  isRecord(source) &&
  typeof source.enabled === 'boolean' &&
  k8sProxyTypes.includes(source.type as K8sProxyConfig['type']) &&
  typeof source.host === 'string' &&
  isNonNegativeFiniteNumber(source.port) &&
  typeof source.enableProxyIdentity === 'boolean' &&
  typeof source.username === 'string' &&
  typeof source.password === 'string' &&
  typeof source.updatedAt === 'string'

export const isK8sContextInfo = (source: unknown): source is K8sContextInfo =>
  isRecord(source) &&
  typeof source.name === 'string' &&
  typeof source.cluster === 'string' &&
  typeof source.namespace === 'string' &&
  typeof source.server === 'string' &&
  typeof source.isActive === 'boolean'

export const isK8sClusterRecord = (source: unknown): source is K8sCluster =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.name === 'string' &&
  source.name.trim() !== '' &&
  isStringOrNull(source.kubeconfig_path) &&
  isStringOrNull(source.kubeconfig_content) &&
  typeof source.context_name === 'string' &&
  source.context_name.trim() !== '' &&
  typeof source.server_url === 'string' &&
  typeof source.auth_type === 'string' &&
  isK8sNumberFlag(source.is_active) &&
  k8sConnectionStatuses.includes(source.connection_status as K8sConnectionStatus) &&
  isK8sNumberFlag(source.auto_connect) &&
  typeof source.default_namespace === 'string' &&
  typeof source.created_at === 'string' &&
  typeof source.updated_at === 'string' &&
  k8sClusterSources.includes(source.source_type as K8sCluster['source_type']) &&
  isStringOrNull(source.bastion_uuid) &&
  isStringOrNull(source.bastion_asset_address) &&
  isStringOrNull(source.bastion_asset_name) &&
  isNumberOrNull(source.bastion_asset_id_last)

export const isK8sBastionGroup = (source: unknown): source is K8sBastionGroup =>
  isRecord(source) && typeof source.uuid === 'string' && source.uuid.trim() !== '' && typeof source.label === 'string' && typeof source.ip === 'string'

export const isK8sNamespaceInfo = (source: unknown): source is K8sNamespaceInfo =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  typeof source.name === 'string' &&
  typeof source.status === 'string' &&
  typeof source.age === 'string'

export const isK8sResource = (source: unknown): source is K8sResource =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  k8sResourceKinds.includes(source.kind as K8sResourceKind) &&
  typeof source.name === 'string' &&
  typeof source.namespace === 'string' &&
  typeof source.status === 'string' &&
  typeof source.ready === 'string' &&
  typeof source.age === 'string' &&
  typeof source.detail === 'string' &&
  isK8sOptionalString(source.node) &&
  isK8sOptionalString(source.image) &&
  isK8sOptionalString(source.ports) &&
  isK8sOptionalNonNegativeNumber(source.restarts) &&
  isK8sOptionalString(source.selector)

export const isK8sImportContextInfo = (source: unknown): source is K8sImportContextInfo =>
  isRecord(source) &&
  typeof source.name === 'string' &&
  source.name.trim() !== '' &&
  typeof source.cluster === 'string' &&
  typeof source.server === 'string' &&
  typeof source.namespace === 'string'

export const isK8sCatalogSnapshot = (source: unknown): source is KubernetesCatalog => {
  if (
    !isRecord(source) ||
    !Array.isArray(source.contexts) ||
    !Array.isArray(source.clusters) ||
    !Array.isArray(source.bastions) ||
    !Array.isArray(source.namespaces) ||
    !Array.isArray(source.resources) ||
    !Array.isArray(source.importContexts) ||
    typeof source.currentContext !== 'string' ||
    !isStringOrNull(source.activeClusterId) ||
    !isStringOrNull(source.selectedClusterId) ||
    !isK8sAgentProxyConfig(source.agentProxyConfig)
  ) {
    return false
  }
  if (!source.contexts.every(isK8sContextInfo)) return false
  if (!source.clusters.every(isK8sClusterRecord)) return false
  if (!source.bastions.every(isK8sBastionGroup)) return false
  if (!source.namespaces.every(isK8sNamespaceInfo)) return false
  if (!source.resources.every(isK8sResource)) return false
  if (!source.importContexts.every(isK8sImportContextInfo)) return false
  const clusterIds = new Set(source.clusters.map((cluster) => cluster.id))
  if (source.activeClusterId && !clusterIds.has(source.activeClusterId)) return false
  if (source.selectedClusterId && !clusterIds.has(source.selectedClusterId)) return false
  return source.namespaces.every((namespace) => clusterIds.has(namespace.clusterId)) && source.resources.every((resource) => clusterIds.has(resource.clusterId))
}

export const isK8sTerminalRecord = (source: unknown): source is KubernetesTerminalRecord =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.sessionId === 'string' &&
  source.sessionId.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  typeof source.name === 'string' &&
  typeof source.namespace === 'string' &&
  typeof source.output === 'string' &&
  k8sTerminalStatuses.includes(source.status as KubernetesTerminalStatus) &&
  isPositiveFiniteNumber(source.cols) &&
  isPositiveFiniteNumber(source.rows) &&
  typeof source.createdAt === 'string' &&
  typeof source.updatedAt === 'string'

export const isK8sTerminalCloseData = (source: unknown): source is K8sTerminalCloseData => {
  if (!isK8sTerminalRecord(source) || source.status !== 'ended' || !isRecord(source)) return false
  return isFiniteNumber((source as Record<string, unknown>).exitCode)
}

export const normalizeK8sCommandText = (value: string) => value.trim().replace(/\s+/g, ' ')

export const isK8sTerminalWriteDataForRequest = (source: unknown, expected: { id: string; data: string; command: string }): source is K8sTerminalWriteResultData => {
  if (
    !isRecord(source) ||
    typeof source.id !== 'string' ||
    typeof source.sessionId !== 'string' ||
    source.sessionId !== expected.id ||
    typeof source.bytes !== 'number' ||
    source.bytes !== new TextEncoder().encode(expected.data).byteLength ||
    typeof source.command !== 'string' ||
    normalizeK8sCommandText(source.command) !== normalizeK8sCommandText(expected.command) ||
    typeof source.output !== 'string' ||
    typeof source.success !== 'boolean' ||
    typeof source.error !== 'string' ||
    typeof source.terminalOutput !== 'string' ||
    typeof source.updatedAt !== 'string'
  ) {
    return false
  }
  return true
}

export const isK8sTerminalDataEvent = (source: unknown): source is KubernetesTerminalDataEvent =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.sessionId === 'string' &&
  source.sessionId.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  typeof source.data === 'string' &&
  typeof source.command === 'string' &&
  typeof source.output === 'string' &&
  typeof source.success === 'boolean' &&
  typeof source.error === 'string' &&
  typeof source.emittedAt === 'string'

export const isK8sTerminalExitEvent = (source: unknown): source is KubernetesTerminalExitEvent =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.sessionId === 'string' &&
  source.sessionId.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  isFiniteNumber(source.exitCode) &&
  (source.reason === 'closed' || source.reason === 'disconnect' || source.reason === 'error') &&
  (source.error === undefined || typeof source.error === 'string') &&
  typeof source.emittedAt === 'string'

export const isK8sProxyConfigData = (source: unknown): source is K8sProxyConfigData =>
  isRecord(source) && isK8sAgentProxyConfig(source.proxyConfig) && typeof source.message === 'string'

export const isK8sAgentCleanupData = (source: unknown): source is K8sAgentCleanupData =>
  isRecord(source) && source.cleared === true && typeof source.cleanedAt === 'string'

export const isK8sContextSwitchData = (source: unknown, expectedContextName: string): source is KubernetesCatalog =>
  isK8sCatalogSnapshot(source) && isRecord(source) && source.currentContext === expectedContextName && source.contexts.some((context) => context.name === expectedContextName && context.isActive)

export const isK8sClusterMutationData = (source: unknown, expectedClusterId?: string, expectedStatus?: K8sConnectionStatus): source is KubernetesCatalog & { cluster: KubernetesClusterRecord } => {
  if (!isRecord(source)) return false
  const record = source as Record<string, unknown>
  if (!isK8sCatalogSnapshot(source) || !isK8sClusterRecord(record.cluster)) return false
  const cluster = record.cluster
  if (expectedClusterId && cluster.id !== expectedClusterId) return false
  if (expectedStatus && cluster.connection_status !== expectedStatus) return false
  return source.clusters.some((item) => item.id === cluster.id)
}

export const isK8sClusterDeleteData = (source: unknown, deletedClusterId: string): source is KubernetesCatalog =>
  isK8sCatalogSnapshot(source) && !source.clusters.some((cluster) => cluster.id === deletedClusterId)

export const isK8sBastionSyncData = (source: unknown): source is KubernetesCatalog & { syncedCount: number; updatedCount: number } => {
  if (!isRecord(source) || !isK8sCatalogSnapshot(source)) return false
  const record = source as Record<string, unknown>
  return isNonNegativeFiniteNumber(record.syncedCount) && isNonNegativeFiniteNumber(record.updatedCount)
}

export const isK8sKubeconfigImportData = (source: unknown): source is K8sKubeconfigImportData =>
  isRecord(source) &&
  typeof source.requestId === 'string' &&
  Array.isArray(source.contexts) &&
  source.contexts.every(isK8sImportContextInfo) &&
  typeof source.kubeconfigPath === 'string' &&
  typeof source.kubeconfigContent === 'string' &&
  typeof source.currentContext === 'string'

export const isK8sKubeconfigImportDataForRequest = (source: unknown, expected: K8sKubeconfigImportRequest): source is K8sKubeconfigImportData => {
  if (!isK8sKubeconfigImportData(source)) return false
  if (source.requestId !== expected.requestId) return false
  if (!source.contexts.length) return false
  if (expected.kubeconfigPath !== undefined && source.kubeconfigPath !== expected.kubeconfigPath) return false
  if (expected.kubeconfigContent !== undefined && source.kubeconfigContent !== expected.kubeconfigContent) return false
  if (source.currentContext && !source.contexts.some((context) => context.name === source.currentContext)) return false
  return source.contexts.every((context) => {
    if (!context.name.trim() || !context.cluster.trim()) return false
    if (context.server.trim() === '') return false
    if (source.currentContext && context.name === source.currentContext) return true
    return true
  })
}

export const isK8sClusterTestData = (source: unknown): source is K8sClusterTestData =>
  isRecord(source) &&
  typeof source.success === 'boolean' &&
  typeof source.isValid === 'boolean' &&
  typeof source.contextName === 'string' &&
  typeof source.serverUrl === 'string' &&
  typeof source.message === 'string' &&
  isK8sOptionalString(source.command) &&
  isK8sOptionalString(source.output) &&
  isK8sOptionalString(source.error) &&
  isK8sOptionalNonNegativeNumber(source.durationMs)

export const isK8sClusterTestDataForRequest = (source: unknown, expected: Partial<KubernetesClusterTestInput>): source is K8sClusterTestData => {
  if (!isK8sClusterTestData(source)) return false
  if (source.success !== source.isValid) return false
  if (expected.contextName !== undefined && source.contextName !== expected.contextName) return false
  if (expected.serverUrl !== undefined && expected.serverUrl !== null && expected.serverUrl.trim() && source.serverUrl !== expected.serverUrl.trim()) return false
  return true
}

export const expectedK8sResourceNamespace = (resource: K8sResource) => (resource.kind === 'nodes' ? 'all' : resource.namespace)

export const isK8sBackendCommandData = (source: unknown): source is K8sBackendCommandData =>
  isRecord(source) &&
  typeof source.runId === 'string' &&
  source.runId.trim() !== '' &&
  typeof source.command === 'string' &&
  typeof source.output === 'string' &&
  typeof source.terminalOutput === 'string' &&
  typeof source.success === 'boolean' &&
  typeof source.error === 'string' &&
  isNonNegativeFiniteNumber(source.durationMs) &&
  typeof source.startedAt === 'string' &&
  typeof source.clusterId === 'string' &&
  typeof source.contextName === 'string' &&
  typeof source.namespace === 'string' &&
  k8sCommandSources.includes(source.source as K8sBackendCommandData['source'])

export const isK8sBackendCommandForRequest = (
  source: unknown,
  expected: { command?: string; clusterId?: string; namespace?: string; source?: K8sBackendCommandData['source'] } = {}
): source is K8sBackendCommandData => {
  if (!isK8sBackendCommandData(source)) return false
  const hasBackendOutput = source.output.trim() !== '' || source.error.trim() !== '' || source.terminalOutput.trim() !== ''
  if (!hasBackendOutput) return false
  if (source.terminalOutput.trim() && !normalizeK8sCommandText(source.terminalOutput).includes(normalizeK8sCommandText(source.command))) return false
  if (expected.command !== undefined) {
    const expectedCommand = normalizeK8sCommandText(expected.command)
    const actualCommand = normalizeK8sCommandText(source.command)
    if (expectedCommand ? actualCommand !== expectedCommand : actualCommand !== '<empty>') return false
  }
  if (expected.clusterId !== undefined && source.clusterId !== expected.clusterId) return false
  if (expected.namespace !== undefined && source.namespace !== expected.namespace) return false
  if (expected.source !== undefined && source.source !== expected.source) return false
  return true
}

export const k8sCommandDisplayOutput = (result: { command: string; output?: string; error?: string }) => {
  const body = (result.output || '').trim() || (result.error || '').trim()
  return body ? `${result.command}\n\n${body}` : result.command
}

export const isK8sResourceActionPlanData = (
  source: unknown,
  expected: { resourceId?: string; action?: K8sResourceAction; resource?: K8sResource } = {}
): source is K8sBackendResourceActionPlanData => {
  if (
    !isRecord(source) ||
    typeof source.resourceId !== 'string' ||
    source.resourceId.trim() === '' ||
    typeof source.resourceName !== 'string' ||
    source.resourceName.trim() === '' ||
    !k8sResourceKinds.includes(source.resourceKind as K8sResourceKind) ||
    !k8sResourceActions.includes(source.action as K8sResourceAction) ||
    typeof source.title !== 'string' ||
    source.title.trim() === '' ||
    typeof source.command !== 'string' ||
    source.command.trim() === '' ||
    typeof source.clusterId !== 'string' ||
    source.clusterId.trim() === '' ||
    typeof source.clusterName !== 'string' ||
    typeof source.contextName !== 'string' ||
    typeof source.namespace !== 'string'
  ) {
    return false
  }
  if (expected.resourceId !== undefined && source.resourceId !== expected.resourceId) return false
  if (expected.action !== undefined && source.action !== expected.action) return false
  if (expected.resource) {
    if (source.clusterId !== expected.resource.clusterId) return false
    if (source.resourceName !== expected.resource.name) return false
    if (source.resourceKind !== expected.resource.kind) return false
    if (source.namespace !== expectedK8sResourceNamespace(expected.resource)) return false
  }
  return true
}

export const isK8sBackendResourceActionData = (
  source: unknown,
  expected: { resourceId?: string; action?: K8sResourceAction; resource?: K8sResource } = {}
): source is K8sBackendResourceActionData => {
  if (!isK8sBackendCommandForRequest(source, { clusterId: expected.resource?.clusterId, namespace: expected.resource ? expectedK8sResourceNamespace(expected.resource) : undefined, source: 'resource' }) || !isRecord(source)) return false
  const record = source as Record<string, unknown>
  const valid =
    typeof record.resourceId === 'string' &&
    record.resourceId.trim() !== '' &&
    typeof record.resourceName === 'string' &&
    record.resourceName.trim() !== '' &&
    k8sResourceKinds.includes(record.resourceKind as K8sResourceKind) &&
    k8sResourceActions.includes(record.action as K8sResourceAction) &&
    typeof record.title === 'string' &&
    record.title.trim() !== ''
  if (!valid) return false
  if (expected.resourceId !== undefined && record.resourceId !== expected.resourceId) return false
  if (expected.action !== undefined && record.action !== expected.action) return false
  if (expected.resource) {
    if (record.resourceName !== expected.resource.name) return false
    if (record.resourceKind !== expected.resource.kind) return false
  }
  return true
}

export const isK8sBackendResourceRefreshData = (
  source: unknown,
  expected: { clusterId?: string; kind?: K8sResourceKind | 'all'; namespace?: string } = {}
): source is K8sBackendResourceRefreshData => {
  if (
    !isK8sBackendCommandForRequest(source, { clusterId: expected.clusterId, namespace: expected.namespace, source: 'resource' }) ||
    !isK8sCatalogSnapshot(source) ||
    !isRecord(source)
  ) {
    return false
  }
  const record = source as Record<string, unknown>
  const valid =
    typeof record.refreshedClusterId === 'string' &&
    k8sRefreshKinds.includes(record.refreshedKind as K8sResourceKind | 'all') &&
    isNonNegativeFiniteNumber(record.refreshedResources) &&
    isNonNegativeFiniteNumber(record.refreshedNamespaces) &&
    typeof record.message === 'string'
  if (!valid) return false
  if (expected.clusterId !== undefined && (source.clusterId !== expected.clusterId || record.refreshedClusterId !== expected.clusterId)) return false
  if (expected.kind !== undefined && record.refreshedKind !== expected.kind) return false
  return true
}
