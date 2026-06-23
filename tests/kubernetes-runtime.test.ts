import { describe, expect, it } from 'vitest'
import {
  activatedK8sTerminalTabs,
  addK8sAgentRunRecord,
  applyK8sTerminalDataEvent,
  applyK8sTerminalExitEvent,
  applyKubernetesCatalogState,
  appendK8sTerminalOutput,
  cloneK8sProxyConfig,
  closeK8sTerminalTabState,
  completeK8sTerminalConnectTabs,
  createK8sAgentRunRecord,
  currentK8sOutputCommand,
  defaultK8sProxyConfig,
  filteredK8sBastions,
  filteredK8sClusters,
  filteredK8sResources,
  k8sActiveContext,
  k8sActiveNamespaces,
  k8sActiveTerminal,
  k8sAgentCluster,
  k8sAgentCurrentCluster,
  k8sClusterById,
  k8sHasContexts,
  k8sProxyConfigValid,
  k8sResourceCluster,
  k8sResourceSummary,
  k8sTerminalTabFromRecord,
  localK8sClusters,
  markK8sClusterTerminalTabsEnded,
  selectK8sAgentClusterState,
  setK8sResourceKindState,
  startK8sTerminalAiCollection,
  stopK8sTerminalAiCollection,
  updateK8sIdSet,
  updateK8sProxyDraft,
  updateK8sTerminalTabCommandResult,
  updateK8sTerminalTabFromRecord,
  type K8sTerminalTab
} from '@/services/kubernetes/kubernetesRuntime'
import type { KubernetesCatalog, KubernetesClusterRecord, KubernetesResource, KubernetesTerminalRecord } from '@shared/contracts/kubernetes'

const proxyConfig = {
  enabled: false,
  type: 'SOCKS5' as const,
  host: '127.0.0.1',
  port: 1080,
  enableProxyIdentity: false,
  username: '',
  password: '',
  updatedAt: '2026-06-20T00:00:00.000Z'
}

const cluster = (input: Partial<KubernetesClusterRecord> & Pick<KubernetesClusterRecord, 'id' | 'name'>): KubernetesClusterRecord => ({
  kubeconfig_path: null,
  kubeconfig_content: null,
  context_name: input.id,
  server_url: `https://${input.id}.k8s.local:6443`,
  auth_type: 'kubeconfig',
  is_active: 1,
  connection_status: 'connected',
  auto_connect: 0,
  default_namespace: 'default',
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
  source_type: 'local',
  bastion_uuid: null,
  bastion_asset_address: null,
  bastion_asset_name: null,
  bastion_asset_id_last: null,
  ...input
})

const prodCluster = cluster({ id: 'prod', name: 'Production', context_name: 'prod/admin' })
const stageCluster = cluster({
  id: 'stage',
  name: 'Staging',
  context_name: 'stage/dev',
  source_type: 'jumpserver',
  bastion_uuid: 'bastion-1',
  server_url: 'https://stage.k8s.local:6443'
})

const pod = (input: Partial<KubernetesResource> & Pick<KubernetesResource, 'id' | 'clusterId' | 'name'>): KubernetesResource => ({
  kind: 'pods',
  namespace: 'default',
  status: 'Running',
  ready: '1/1',
  age: '1d',
  detail: 'app=api',
  restarts: 0,
  ...input
})

const resources: KubernetesResource[] = [
  pod({ id: 'pod-prod-api', clusterId: 'prod', name: 'api-0', image: 'api:v1' }),
  pod({ id: 'pod-prod-worker', clusterId: 'prod', name: 'worker-0', namespace: 'ops', image: 'worker:v1' }),
  { ...pod({ id: 'deploy-prod-api', clusterId: 'prod', name: 'api' }), kind: 'deployments', ready: '3/3' },
  { ...pod({ id: 'node-prod-1', clusterId: 'prod', name: 'node-1' }), kind: 'nodes', namespace: '', status: 'Ready', detail: 'node' },
  pod({ id: 'pod-stage-api', clusterId: 'stage', name: 'stage-api', namespace: 'stage' })
]

const catalog: KubernetesCatalog = {
  contexts: [{ name: 'prod/admin', cluster: 'prod', namespace: 'default', server: prodCluster.server_url, isActive: true }],
  currentContext: 'prod/admin',
  clusters: [prodCluster, stageCluster],
  bastions: [{ uuid: 'bastion-1', label: 'Jumpserver', ip: '10.0.0.10' }],
  namespaces: [
    { id: 'ns-prod-default', clusterId: 'prod', name: 'default', status: 'Active', age: '1d' },
    { id: 'ns-prod-ops', clusterId: 'prod', name: 'ops', status: 'Active', age: '1d' }
  ],
  resources,
  importContexts: [{ name: 'prod/admin', cluster: 'prod', server: prodCluster.server_url, namespace: 'default' }],
  activeClusterId: 'prod',
  selectedClusterId: 'prod',
  agentProxyConfig: proxyConfig
}

const terminalRecord: KubernetesTerminalRecord = {
  id: 'terminal-prod',
  sessionId: 'session-prod',
  clusterId: 'prod',
  name: 'Production',
  namespace: 'default',
  output: '',
  status: 'connecting',
  cols: 120,
  rows: 32,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z'
}

const tab = (input: Partial<K8sTerminalTab> = {}): K8sTerminalTab => ({
  ...k8sTerminalTabFromRecord(terminalRecord),
  ...input
})

describe('kubernetesRuntime', () => {
  it('applies catalog snapshots while preserving valid UI selections and draft proxy state', () => {
    const staleTab = tab({ id: 'stale', clusterId: 'missing' })
    const activeTab = tab({ id: 'terminal-prod', status: 'connected', isActive: true })
    const draftProxy = { ...proxyConfig, enabled: true, host: 'draft.proxy.local', port: 18080 }
    const applied = applyKubernetesCatalogState(catalog, {
      selectedClusterId: 'stage',
      connectingClusterIds: ['prod', 'missing'],
      syncingBastionIds: ['bastion-1', 'missing'],
      terminalTabs: [activeTab, staleTab],
      activeTerminalId: 'terminal-prod',
      proxyConfigOpen: true,
      proxyConfig: draftProxy,
      agentClusterId: 'missing',
      agentContextName: '',
      agentStatus: 'idle'
    })

    expect(applied.contexts).not.toBe(catalog.contexts)
    expect(applied.selectedClusterId).toBe('stage')
    expect(applied.connectingClusterIds).toEqual(['prod'])
    expect(applied.syncingBastionIds).toEqual(['bastion-1'])
    expect(applied.terminalTabs).toEqual([{ ...activeTab, isActive: true }])
    expect(applied.activeTerminalId).toBe('terminal-prod')
    expect(applied.savedProxyConfig).toEqual(proxyConfig)
    expect(applied.proxyConfig).toEqual(draftProxy)
    expect(applied.agentClusterId).toBe('prod')
    expect(applied.agentContextName).toBe('prod/admin')
    expect(applied.agentStatus).toBe('ready')

    const fallbackSelection = applyKubernetesCatalogState(catalog, {
      selectedClusterId: 'missing',
      connectingClusterIds: [],
      syncingBastionIds: [],
      terminalTabs: [activeTab],
      activeTerminalId: 'missing',
      proxyConfigOpen: false,
      proxyConfig: draftProxy,
      agentClusterId: 'missing',
      agentContextName: '',
      agentStatus: 'idle'
    })
    expect(fallbackSelection.selectedClusterId).toBe('prod')
    expect(fallbackSelection.proxyConfig).toEqual(proxyConfig)
    expect(fallbackSelection.activeTerminalId).toBe('terminal-prod')
    expect(fallbackSelection.terminalTabs[0].isActive).toBe(true)
  })

  it('derives proxy drafts, id sets, cluster search, namespace, resources, and summaries', () => {
    expect(cloneK8sProxyConfig(proxyConfig)).toEqual(proxyConfig)
    expect(cloneK8sProxyConfig(proxyConfig)).not.toBe(proxyConfig)
    expect(updateK8sIdSet(['prod'], 'stage', true)).toEqual(['prod', 'stage'])
    expect(updateK8sIdSet(['prod', 'stage'], 'prod', false)).toEqual(['stage'])
    expect(updateK8sProxyDraft({ ...proxyConfig, username: 'ops', password: 'pw', enableProxyIdentity: true }, { port: 999999, enableProxyIdentity: false })).toEqual({
      ...proxyConfig,
      port: 65535
    })
    expect(k8sProxyConfigValid({ ...proxyConfig, enabled: true, host: '' })).toBe(false)
    expect(k8sProxyConfigValid({ ...proxyConfig, enabled: true, host: 'proxy.local' })).toBe(true)
    expect(k8sHasContexts(catalog.contexts)).toBe(true)
    expect(k8sHasContexts([])).toBe(false)
    expect(k8sActiveContext(catalog.contexts)).toEqual(catalog.contexts[0])
    expect(k8sActiveContext([{ ...catalog.contexts[0], isActive: false }])).toBeNull()
    expect(k8sClusterById(catalog.clusters, 'prod')).toBe(prodCluster)
    expect(k8sClusterById(catalog.clusters, 'missing')).toBeNull()
    expect(selectK8sAgentClusterState(catalog.clusters, 'stage')).toMatchObject({
      cluster: stageCluster,
      agentClusterId: 'stage',
      agentContextName: 'stage/dev',
      agentStatus: 'ready'
    })
    expect(selectK8sAgentClusterState(catalog.clusters, 'missing')).toMatchObject({ cluster: null, agentClusterId: null, agentStatus: 'idle' })
    expect(filteredK8sClusters(catalog.clusters, 'prod')).toEqual([prodCluster])
    expect(localK8sClusters(catalog.clusters)).toEqual([prodCluster])
    expect(filteredK8sBastions(catalog.bastions, catalog.clusters, 'stage')).toEqual(catalog.bastions)
    expect(k8sResourceCluster(catalog.clusters, null, 'stage')).toBe(stageCluster)
    expect(k8sActiveNamespaces(catalog.namespaces, catalog.resources, 'prod')).toEqual(['default', 'ops'])
    expect(filteredK8sResources(catalog.resources, { clusterId: 'prod', kind: 'pods', namespace: 'ops', query: 'worker' })).toEqual([resources[1]])
    expect(filteredK8sResources(catalog.resources, { clusterId: 'prod', kind: 'nodes', namespace: 'default', query: 'node' })).toEqual([resources[3]])
    expect(k8sResourceSummary(catalog.resources, 'prod', 'all')).toEqual({ pods: 2, deployments: 1, services: 0, nodes: 1 })
    expect(k8sResourceSummary(catalog.resources, 'prod', 'ops')).toEqual({ pods: 1, deployments: 0, services: 0, nodes: 1 })
    expect(setK8sResourceKindState('nodes', 'ops')).toEqual({ kind: 'nodes', namespace: 'all' })
    expect(setK8sResourceKindState('pods', 'ops')).toEqual({ kind: 'pods', namespace: 'ops' })
  })

  it('updates terminal tab state from backend records and terminal events', () => {
    const initial = tab({ id: 'terminal-prod', sessionId: 'session-prod', output: 'first' })
    expect(activatedK8sTerminalTabs([initial, tab({ id: 'other' })], 'other').map((item) => item.isActive)).toEqual([false, true])
    expect(k8sActiveTerminal([initial, tab({ id: 'other' })], 'terminal-prod')).toBe(initial)
    expect(k8sActiveTerminal([initial], 'missing')).toBeNull()
    expect(appendK8sTerminalOutput(initial, 'second').output).toBe('first\nsecond')
    expect(appendK8sTerminalOutput({ ...initial, output: 'first\n' }, 'second').output).toBe('first\nsecond')
    expect(
      applyK8sTerminalDataEvent([initial], {
        id: 'terminal-prod',
        sessionId: 'session-prod',
        clusterId: 'prod',
        data: 'pod/api-0',
        command: 'kubectl get pods',
        output: 'pod/api-0',
        success: true,
        error: '',
        emittedAt: '2026-06-20T00:00:02.000Z'
      })
    ).toEqual([{ ...initial, output: 'first\npod/api-0', lastCommandOutput: 'pod/api-0', updatedAt: '2026-06-20T00:00:02.000Z' }])
    expect(
      applyK8sTerminalExitEvent([initial], {
        id: 'terminal-prod',
        sessionId: 'session-prod',
        clusterId: 'prod',
        exitCode: 1,
        reason: 'error',
        error: 'boom',
        emittedAt: '2026-06-20T00:00:03.000Z'
      })
    ).toEqual([{ ...initial, status: 'error', exitCode: 1, collectingAiOutput: false, updatedAt: '2026-06-20T00:00:03.000Z' }])
    expect(completeK8sTerminalConnectTabs([initial], 'prod')[0].status).toBe('connected')
    expect(markK8sClusterTerminalTabsEnded([initial], 'prod')[0]).toEqual({ ...initial, status: 'ended', exitCode: 0, collectingAiOutput: false, updatedAt: '刚刚' })
    expect(closeK8sTerminalTabState([tab({ id: 'a' }), tab({ id: 'b' })], 'a', 'a')).toEqual({
      tabs: [{ ...tab({ id: 'b' }), isActive: true }],
      activeTerminalId: 'b'
    })
    expect(updateK8sTerminalTabFromRecord(initial, { ...terminalRecord, status: 'connected', cols: 100, rows: 24, updatedAt: 'later' })).toEqual({
      ...initial,
      cols: 100,
      rows: 24,
      updatedAt: 'later',
      status: 'connected'
    })
    expect(updateK8sTerminalTabCommandResult({ ...initial, commandHistory: ['old', 'kubectl get pods'] }, 'kubectl get pods', 'later').commandHistory).toEqual([
      'kubectl get pods',
      'old'
    ])
    expect(startK8sTerminalAiCollection(initial, 'kubectl get pods')).toEqual({ ...initial, collectingAiOutput: true, aiCommandTabId: 'terminal-prod' })
    expect(stopK8sTerminalAiCollection({ ...initial, collectingAiOutput: true, aiCommandTabId: 'terminal-prod' })).toEqual({
      ...initial,
      collectingAiOutput: false,
      aiCommandTabId: null
    })
  })

  it('creates agent run records and extracts resource-output commands', () => {
    expect(currentK8sOutputCommand('title\nkubectl get pods -n ops\noutput')).toBe('kubectl get pods -n ops')
    expect(currentK8sOutputCommand('no command')).toBe('')
    expect(k8sAgentCluster(catalog.clusters, 'stage')).toBe(stageCluster)
    expect(k8sAgentCluster(catalog.clusters, null)).toBeNull()
    expect(k8sAgentCurrentCluster(stageCluster, 'fallback/context')).toEqual({ clusterId: 'stage', contextName: 'stage/dev' })
    expect(k8sAgentCurrentCluster(null, 'fallback/context')).toEqual({ clusterId: null, contextName: 'fallback/context' })
    expect(k8sAgentCurrentCluster(null, '')).toEqual({ clusterId: null, contextName: null })
    const record = createK8sAgentRunRecord(
      {
        runId: 'run-1',
        command: 'kubectl get pods',
        output: 'pod/api',
        terminalOutput: 'pod/api',
        success: true,
        error: '',
        durationMs: 12,
        startedAt: '2026-06-20T00:00:00.000Z',
        clusterId: '',
        contextName: '',
        namespace: 'default',
        source: 'agent'
      },
      { fallbackCluster: prodCluster, agentContextName: 'fallback-context' }
    )
    expect(record).toEqual({
      id: 'run-1',
      command: 'kubectl get pods',
      status: 'success',
      output: 'pod/api',
      error: undefined,
      clusterId: 'prod',
      contextName: 'prod/admin',
      namespace: 'default',
      startedAt: '2026-06-20T00:00:00.000Z',
      durationMs: 12
    })
    expect(addK8sAgentRunRecord(Array.from({ length: 12 }, (_, index) => ({ ...record, id: `old-${index}` })), record)).toHaveLength(12)
    expect(defaultK8sProxyConfig.host).toBe('127.0.0.1')
  })
})
