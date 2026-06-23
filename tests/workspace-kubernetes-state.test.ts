import { describe, expect, it } from 'vitest'
import { createWorkspaceKubernetesState } from '@/stores/workspaceKubernetesState'
import type { K8sCluster, K8sContextInfo, K8sResource } from '@/services/kubernetes/kubernetesBackendGuards'
import type { K8sTerminalTab } from '@/services/kubernetes/kubernetesRuntime'

const cluster = (input: Partial<K8sCluster> & Pick<K8sCluster, 'id' | 'name'>): K8sCluster => ({
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

const resource = (input: Partial<K8sResource> & Pick<K8sResource, 'id' | 'clusterId' | 'name'>): K8sResource => ({
  kind: 'pods',
  namespace: 'default',
  status: 'Running',
  ready: '1/1',
  restarts: 0,
  age: '1d',
  detail: '',
  ...input
})

const terminalTab = (input: Partial<K8sTerminalTab> & Pick<K8sTerminalTab, 'id' | 'clusterId'>): K8sTerminalTab => ({
  sessionId: input.id,
  name: input.id,
  namespace: 'default',
  isActive: false,
  output: '',
  status: 'connected',
  cols: 120,
  rows: 32,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  exitCode: null,
  commandHistory: [],
  lastCommand: '',
  lastCommandOutput: '',
  collectingAiOutput: false,
  aiCommandTabId: null,
  ...input
})

describe('workspaceKubernetesState', () => {
  it('owns Kubernetes refs, defaults, and computed projections outside the global workspace state factory', () => {
    const state = createWorkspaceKubernetesState()
    const prod = cluster({ id: 'prod', name: 'Production', context_name: 'prod/admin' })
    const stage = cluster({ id: 'stage', name: 'Staging', context_name: 'stage/dev', source_type: 'jumpserver', bastion_uuid: 'bastion-1' })
    const context: K8sContextInfo = { name: 'prod/admin', cluster: 'prod', namespace: 'default', server: prod.server_url, isActive: true }

    expect(state.k8sConfigTab.value).toBe('local')
    expect(state.k8sAddMode.value).toBe('import')
    expect(state.k8sResourceKind.value).toBe('pods')
    expect(state.k8sResourceNamespace.value).toBe('all')
    expect(state.k8sAgentCommandDraft.value).toBe('kubectl get pods -A')
    expect(state.savedK8sProxyConfig.value).toEqual(state.k8sProxyConfig.value)

    state.k8sContexts.value = [context]
    state.k8sClusters.value = [prod, stage]
    state.k8sBastions.value = [{ uuid: 'bastion-1', label: 'Jumpserver', ip: '10.0.0.1' }]
    state.k8sNamespaces.value = [{ id: 'ns-prod-default', clusterId: 'prod', name: 'default', status: 'Active', age: '1d' }]
    state.k8sResources.value = [
      resource({ id: 'pod-prod-api', clusterId: 'prod', name: 'api-0' }),
      resource({ id: 'pod-stage-api', clusterId: 'stage', name: 'stage-api', namespace: 'stage' })
    ]
    state.k8sSelectedClusterId.value = 'stage'
    state.k8sActiveClusterId.value = 'prod'
    state.k8sDeleteConfirmClusterId.value = 'stage'
    state.k8sSearchQuery.value = 'stag'
    state.k8sActiveTerminalId.value = 'term-prod'
    state.k8sTerminalTabs.value = [terminalTab({ id: 'term-prod', clusterId: 'prod' })]
    state.k8sAgentClusterId.value = 'prod'

    expect(state.k8sHasContexts.value).toBe(true)
    expect(state.k8sActiveContext.value).toEqual(context)
    expect(state.k8sSelectedCluster.value).toEqual(stage)
    expect(state.k8sActiveCluster.value).toEqual(prod)
    expect(state.k8sDeleteConfirmCluster.value).toEqual(stage)
    expect(state.filteredK8sClusters.value).toEqual([stage])
    expect(state.localK8sClusters.value).toEqual([])
    expect(state.filteredK8sBastions.value).toEqual(state.k8sBastions.value)
    expect(state.k8sActiveTerminal.value?.id).toBe('term-prod')
    expect(state.k8sAgentCluster.value).toEqual(prod)
    expect(state.k8sAgentCurrentCluster.value).toEqual({ clusterId: 'prod', contextName: 'prod/admin' })
    expect(state.k8sResourceCluster.value).toEqual(prod)
    expect(state.k8sActiveNamespaces.value).toEqual(['default'])
    expect(state.filteredK8sResources.value).toEqual([state.k8sResources.value[0]])
    expect(state.k8sResourceSummary.value).toEqual({ pods: 1, deployments: 0, services: 0, nodes: 0 })
  })
})
