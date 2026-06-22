import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { createWorkspaceKubernetesResourceAgentController } from '@/services/workspaceKubernetesResourceAgentController'
import { applyKubernetesCatalogState, cloneK8sProxyConfig, defaultK8sProxyConfig, type K8sAgentRunRecord, type K8sTerminalTab } from '@/services/kubernetesRuntime'
import type { K8sCluster, K8sResource, K8sResourceKind } from '@/services/kubernetesBackendGuards'
import type {
  KubernetesCatalog,
  KubernetesCommandResult,
  KubernetesResourceActionExecuteResult,
  KubernetesResourceActionPlanResult,
  KubernetesResourceRefreshResult
} from '@shared/contracts/kubernetes'

const originalAiops = window.aiops

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

const pod = (input: Partial<K8sResource> & Pick<K8sResource, 'id' | 'clusterId' | 'name'>): K8sResource => ({
  kind: 'pods',
  namespace: 'default',
  status: 'Running',
  ready: '1/1',
  age: '1d',
  detail: 'app=api',
  restarts: 0,
  ...input
})

const prodCluster = cluster({ id: 'prod', name: 'Production', context_name: 'prod/admin' })
const stagingCluster = cluster({ id: 'stage', name: 'Staging', context_name: 'stage/dev', default_namespace: 'stage' })
const resources: K8sResource[] = [
  pod({ id: 'pod-prod-api', clusterId: 'prod', name: 'api-0', image: 'api:v1' }),
  pod({ id: 'pod-prod-worker', clusterId: 'prod', name: 'worker-0', namespace: 'ops', image: 'worker:v1', status: 'CrashLoopBackOff' }),
  pod({ id: 'pod-stage-api', clusterId: 'stage', name: 'stage-api', namespace: 'stage' })
]

const catalog: KubernetesCatalog = {
  contexts: [{ name: 'prod/admin', cluster: 'prod', namespace: 'default', server: prodCluster.server_url, isActive: true }],
  currentContext: 'prod/admin',
  clusters: [prodCluster, stagingCluster],
  bastions: [],
  namespaces: [
    { id: 'ns-prod-default', clusterId: 'prod', name: 'default', status: 'Active', age: '1d' },
    { id: 'ns-prod-ops', clusterId: 'prod', name: 'ops', status: 'Active', age: '1d' },
    { id: 'ns-stage', clusterId: 'stage', name: 'stage', status: 'Active', age: '1d' }
  ],
  resources,
  importContexts: [],
  activeClusterId: 'prod',
  selectedClusterId: 'prod',
  agentProxyConfig: defaultK8sProxyConfig
}

const commandResult = (patch: Partial<NonNullable<KubernetesCommandResult['data']>> = {}): NonNullable<KubernetesCommandResult['data']> => {
  const source = patch.source === 'terminal' || patch.source === 'resource' ? patch.source : 'agent'
  return {
    runId: 'run-1',
    command: 'kubectl get pods',
    output: 'NAME READY\napi-0 1/1',
    terminalOutput: '[aiopsterm kubectl] kubectl get pods\nNAME READY\napi-0 1/1',
    success: true,
    error: '',
    durationMs: 12,
    startedAt: '2026-06-20T00:00:00.000Z',
    clusterId: 'prod',
    contextName: 'prod/admin',
    namespace: 'default',
    ...patch,
    source
  }
}

const resourcePlan = {
  resourceId: 'pod-prod-worker',
  resourceName: 'worker-0',
  resourceKind: 'pods' as const,
  action: 'describe' as const,
  title: 'Describe worker-0',
  command: 'kubectl describe pod worker-0 -n ops',
  clusterId: 'prod',
  clusterName: 'Production',
  contextName: 'prod/admin',
  namespace: 'ops'
}

const createSubject = () => {
  const k8sClusters = ref<K8sCluster[]>(catalog.clusters.map((item) => ({ ...item })))
  const k8sResources = ref<K8sResource[]>(catalog.resources.map((item) => ({ ...item })))
  const k8sResourceKind = ref<K8sResourceKind>('pods')
  const k8sResourceNamespace = ref('default')
  const k8sResourceOutput = ref('选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。')
  const k8sResourceOutputTitle = ref('资源输出')
  const k8sResourceLoading = ref(false)
  const k8sCopiedCommand = ref('')
  const k8sAgentClusterId = ref<string | null>('prod')
  const k8sAgentContextName = ref('prod/admin')
  const k8sAgentStatus = ref<'idle' | 'ready' | 'running' | 'error'>('ready')
  const k8sAgentCommandDraft = ref('kubectl get pods')
  const k8sAgentCommandHistory = ref<string[]>([])
  const k8sAgentRuns = ref<K8sAgentRunRecord[]>([])
  const k8sAgentLastResult = ref<K8sAgentRunRecord | null>(null)
  const k8sAgentTesting = ref(false)
  const notices = ref<string[]>([])
  const sentChats: string[] = []
  const sentTerminalCommands: string[] = []
  const openedTerminals: string[] = []
  const k8sAgentCluster = computed(() => (k8sAgentClusterId.value ? k8sClusters.value.find((item) => item.id === k8sAgentClusterId.value) || null : null))
  const k8sResourceCluster = computed(() => k8sClusters.value.find((item) => item.id === 'prod') || null)
  const applyKubernetesCatalog = (nextCatalog: KubernetesCatalog) => {
    const applied = applyKubernetesCatalogState(nextCatalog, {
      selectedClusterId: 'prod',
      connectingClusterIds: [],
      syncingBastionIds: [],
      terminalTabs: [],
      activeTerminalId: null,
      proxyConfigOpen: false,
      proxyConfig: cloneK8sProxyConfig(defaultK8sProxyConfig),
      agentClusterId: k8sAgentClusterId.value,
      agentContextName: k8sAgentContextName.value,
      agentStatus: k8sAgentStatus.value
    })
    k8sClusters.value = applied.clusters
    k8sResources.value = applied.resources
    return nextCatalog
  }
  const controller = createWorkspaceKubernetesResourceAgentController(
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
      setK8sNotice: (text) => notices.value.push(text),
      applyKubernetesCatalog,
      openK8sTerminal: async (clusterId) => {
        openedTerminals.push(clusterId)
        return { id: 'terminal-1', sessionId: 'session-1', clusterId, name: 'Production', namespace: 'default' } as K8sTerminalTab
      },
      sendK8sTerminalCommand: async (command) => {
        sentTerminalCommands.push(command)
        return `[aiopsterm kubectl] ${command}`
      },
      sendChat: async (text) => {
        sentChats.push(text)
        return true
      }
    }
  )
  return {
    controller,
    k8sClusters,
    k8sResources,
    k8sResourceKind,
    k8sResourceNamespace,
    k8sResourceOutput,
    k8sResourceOutputTitle,
    k8sResourceLoading,
    k8sCopiedCommand,
    k8sAgentClusterId,
    k8sAgentStatus,
    k8sAgentCommandDraft,
    k8sAgentCommandHistory,
    k8sAgentRuns,
    k8sAgentLastResult,
    k8sAgentTesting,
    notices,
    sentChats,
    sentTerminalCommands,
    openedTerminals
  }
}

afterEach(() => {
  window.aiops = originalAiops
  vi.restoreAllMocks()
})

describe('workspaceKubernetesResourceAgentController', () => {
  it('runs Agent commands, refreshes resources, and sends resource output through injected boundaries', async () => {
    const subject = createSubject()
    window.aiops = {
      ...originalAiops,
      executeKubernetesCommand: vi.fn(async (input) => ({ ok: true, data: commandResult({ command: input.command, namespace: input.namespace, source: input.source }) })),
      refreshKubernetesResources: vi.fn(async () => ({
        ok: true,
        data: {
          ...catalog,
          ...commandResult({
            source: 'resource',
            command: 'kubectl get pods -n default',
            terminalOutput: '[aiopsterm kubectl] kubectl get pods -n default\nNAME READY\napi-0 1/1'
          }),
          refreshedClusterId: 'prod',
          refreshedKind: 'pods' as const,
          refreshedResources: 2,
          refreshedNamespaces: 2,
          source: 'resource' as const,
          message: 'refreshed'
        } satisfies NonNullable<KubernetesResourceRefreshResult['data']>
      })),
      planKubernetesResourceAction: vi.fn(async () => ({ ok: true, data: resourcePlan })),
      executeKubernetesResourceAction: vi.fn(async () => ({
        ok: true,
        data: {
          ...commandResult({
            source: 'resource',
            namespace: 'ops',
            command: resourcePlan.command,
            terminalOutput: `[aiopsterm kubectl] ${resourcePlan.command}\nworker detail`
          }),
          ...resourcePlan
        } satisfies NonNullable<KubernetesResourceActionExecuteResult['data']>
      })),
      cleanupKubernetesAgent: vi.fn(async () => ({ ok: true, data: { cleared: true, cleanedAt: '2026-06-20T00:00:00.000Z' } }))
    }
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

    const agentRun = await subject.controller.runK8sAgentKubectl('kubectl get pods')
    expect(agentRun?.status).toBe('success')
    expect(subject.k8sAgentCommandHistory.value[0]).toBe('kubectl get pods')
    expect(subject.k8sResourceOutput.value).toContain('api-0')
    expect(subject.notices.value.at(-1)).toBe('Kubernetes Agent 命令执行完成')

    const refreshed = await subject.controller.refreshK8sResources()
    expect(refreshed?.command).toBe('kubectl get pods -n default')
    expect(subject.k8sResourceLoading.value).toBe(false)
    expect(subject.k8sResourceOutput.value).toContain('kubectl get pods')
    expect(subject.notices.value.at(-1)).toBe('refreshed')

    await subject.controller.describeK8sResource('pod-prod-worker')
    expect(subject.k8sResourceOutputTitle.value).toBe('Describe worker-0')
    expect(subject.k8sResourceOutput.value).toContain(resourcePlan.command)

    await expect(subject.controller.copyK8sResourceCommand('pod-prod-worker', 'describe')).resolves.toBe(resourcePlan.command)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resourcePlan.command)
    expect(subject.k8sCopiedCommand.value).toBe(resourcePlan.command)

    subject.k8sResourceOutput.value = `${resourcePlan.command}\n\npod detail`
    await expect(subject.controller.sendK8sCurrentOutputToTerminal()).resolves.toBe(resourcePlan.command)
    expect(subject.openedTerminals).toEqual(['prod'])
    expect(subject.sentTerminalCommands).toEqual([resourcePlan.command])

    await expect(subject.controller.sendK8sCurrentOutputToAi()).resolves.toBe(true)
    expect(subject.sentChats[0]).toContain('Kubernetes 输出')

    await expect(subject.controller.cleanupK8sAgent()).resolves.toBe(true)
    expect(subject.k8sAgentClusterId.value).toBeNull()
    expect(subject.k8sAgentStatus.value).toBe('idle')
  })

  it('rejects malformed backend data without mutating resource or Agent history state', async () => {
    const subject = createSubject()
    window.aiops = {
      ...originalAiops,
      executeKubernetesCommand: vi.fn(async () => ({ ok: true, data: commandResult({ source: 'terminal', output: 'wrong source' }) })),
      refreshKubernetesResources: vi.fn(async () => ({
        ok: true,
        data: {
          ...catalog,
          ...commandResult({
            source: 'resource',
            clusterId: 'stage',
            terminalOutput: '[aiopsterm kubectl] kubectl get pods\nNAME READY\napi-0 1/1'
          }),
          refreshedClusterId: 'stage',
          refreshedKind: 'pods' as const,
          refreshedResources: 1,
          refreshedNamespaces: 1,
          source: 'resource' as const,
          message: 'wrong cluster'
        } satisfies NonNullable<KubernetesResourceRefreshResult['data']>
      })),
      planKubernetesResourceAction: vi.fn(async () => ({
        ok: true,
        data: { ...resourcePlan, action: 'logs' as const } satisfies NonNullable<KubernetesResourceActionPlanResult['data']>
      })),
      executeKubernetesResourceAction: vi.fn(async () => ({
        ok: true,
        data: { ...commandResult({ source: 'resource', namespace: 'default' }), ...resourcePlan } satisfies NonNullable<KubernetesResourceActionExecuteResult['data']>
      }))
    }
    const originalOutput = subject.k8sResourceOutput.value

    await expect(subject.controller.runK8sAgentKubectl('kubectl get pods')).resolves.toBeNull()
    expect(subject.k8sAgentRuns.value).toEqual([])
    expect(subject.k8sAgentStatus.value).toBe('error')
    expect(subject.k8sResourceOutput.value).toBe('kubectl get pods')
    expect(subject.notices.value).toContain('Kubernetes command backend returned malformed result data.')

    subject.k8sResourceOutput.value = originalOutput
    await expect(subject.controller.refreshK8sResources()).resolves.toBeNull()
    expect(subject.k8sResourceLoading.value).toBe(false)
    expect(subject.k8sAgentRuns.value).toEqual([])
    expect(subject.k8sResourceOutput.value).toBe(originalOutput)
    expect(subject.notices.value).toContain('Kubernetes resource refresh backend returned malformed result data.')

    await expect(subject.controller.copyK8sResourceCommand('pod-prod-worker', 'describe')).resolves.toBe('')
    expect(subject.k8sCopiedCommand.value).toBe('')
    expect(subject.notices.value).toContain('Kubernetes resource action backend returned malformed plan data.')

    await expect(subject.controller.showK8sPodLogs('pod-prod-worker')).resolves.toBeUndefined()
    expect(subject.k8sResourceOutput.value).toBe(originalOutput)
    expect(subject.notices.value).toContain('Kubernetes resource action backend returned malformed result data.')
  })
})
