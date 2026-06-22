import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createWorkspaceKubernetesClusterController } from '@/services/workspaceKubernetesClusterController'
import { applyKubernetesCatalogState, cloneK8sProxyConfig, defaultK8sProxyConfig, type K8sTerminalTab } from '@/services/kubernetesRuntime'
import type { K8sBastionGroup, K8sCluster, K8sContextInfo, K8sImportContextInfo, K8sNamespaceInfo, K8sProxyConfig, K8sResource } from '@/services/kubernetesBackendGuards'
import type { KubernetesCatalog } from '@shared/contracts/kubernetes'

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

const prodCluster = cluster({ id: 'prod', name: 'Production', context_name: 'prod/admin' })
const stageCluster = cluster({ id: 'stage', name: 'Staging', context_name: 'stage/dev', connection_status: 'disconnected', default_namespace: 'stage' })
const prodContext: K8sContextInfo = { name: 'prod/admin', cluster: 'prod', namespace: 'default', server: prodCluster.server_url, isActive: true }
const stageContext: K8sContextInfo = { name: 'stage/dev', cluster: 'stage', namespace: 'stage', server: stageCluster.server_url, isActive: false }
const bastion: K8sBastionGroup = { uuid: 'org-prod', label: 'Prod JumpServer', ip: '10.0.0.2' }

const catalog = (patch: Partial<KubernetesCatalog> = {}): KubernetesCatalog => ({
  contexts: [prodContext, stageContext],
  currentContext: 'prod/admin',
  clusters: [prodCluster, stageCluster],
  bastions: [bastion],
  namespaces: [{ id: 'ns-prod-default', clusterId: 'prod', name: 'default', status: 'Active', age: '1d' }],
  resources: [],
  importContexts: [],
  activeClusterId: 'prod',
  selectedClusterId: 'prod',
  agentProxyConfig: defaultK8sProxyConfig,
  ...patch
})

const createSubject = () => {
  const initialCatalog = catalog()
  const k8sClusters = ref<K8sCluster[]>(initialCatalog.clusters.map((item) => ({ ...item })))
  const k8sBastions = ref<K8sBastionGroup[]>(initialCatalog.bastions.map((item) => ({ ...item })))
  const k8sConnectingClusterIds = ref<string[]>([])
  const k8sSyncingBastionIds = ref<string[]>([])
  const k8sDeleteConfirmClusterId = ref<string | null>(null)
  const k8sClusterActionMenuId = ref<string | null>(null)
  const k8sImportContexts = ref<K8sImportContextInfo[]>([])
  const k8sActiveClusterId = ref<string | null>('prod')
  const k8sSearchQuery = ref('')
  const k8sConfigTab = ref<'local' | 'jumpserver'>('local')
  const k8sSelectedClusterId = ref<string | null>('prod')
  const k8sAddModalOpen = ref(false)
  const k8sEditModalOpen = ref(false)
  const k8sEditingClusterId = ref<string | null>(null)
  const k8sTestResult = ref<boolean | null>(null)
  const k8sCollapsedBastionIds = ref<string[]>([])
  const k8sAgentClusterId = ref<string | null>('prod')
  const k8sAgentContextName = ref('prod/admin')
  const k8sAgentStatus = ref<'idle' | 'ready' | 'running' | 'error'>('ready')
  const savedK8sProxyConfig = ref<K8sProxyConfig>(cloneK8sProxyConfig(defaultK8sProxyConfig))
  const k8sProxyConfig = ref<K8sProxyConfig>(cloneK8sProxyConfig(defaultK8sProxyConfig))
  const k8sProxyConfigOpen = ref(false)
  const terminalTabs = ref<K8sTerminalTab[]>([])
  const terminalActions = {
    completedConnects: [] as string[],
    endedClusters: [] as string[],
    removedClusters: [] as string[]
  }
  const notices = ref<string[]>([])
  const contexts = ref<K8sContextInfo[]>(initialCatalog.contexts.map((item) => ({ ...item })))
  const namespaces = ref<K8sNamespaceInfo[]>(initialCatalog.namespaces.map((item) => ({ ...item })))
  const resources = ref<K8sResource[]>([])

  const applyKubernetesCatalog = (nextCatalog: KubernetesCatalog) => {
    const applied = applyKubernetesCatalogState(nextCatalog, {
      selectedClusterId: k8sSelectedClusterId.value,
      connectingClusterIds: k8sConnectingClusterIds.value,
      syncingBastionIds: k8sSyncingBastionIds.value,
      terminalTabs: terminalTabs.value,
      activeTerminalId: null,
      proxyConfigOpen: k8sProxyConfigOpen.value,
      proxyConfig: k8sProxyConfig.value,
      agentClusterId: k8sAgentClusterId.value,
      agentContextName: k8sAgentContextName.value,
      agentStatus: k8sAgentStatus.value
    })
    contexts.value = applied.contexts
    k8sClusters.value = applied.clusters
    k8sBastions.value = applied.bastions
    namespaces.value = applied.namespaces
    resources.value = applied.resources
    k8sImportContexts.value = applied.importContexts
    k8sActiveClusterId.value = applied.activeClusterId
    k8sSelectedClusterId.value = applied.selectedClusterId
    k8sConnectingClusterIds.value = applied.connectingClusterIds
    k8sSyncingBastionIds.value = applied.syncingBastionIds
    savedK8sProxyConfig.value = applied.savedProxyConfig
    k8sProxyConfig.value = applied.proxyConfig
    k8sAgentClusterId.value = applied.agentClusterId
    k8sAgentContextName.value = applied.agentContextName
    k8sAgentStatus.value = applied.agentStatus
    return nextCatalog
  }

  const controller = createWorkspaceKubernetesClusterController(
    {
      k8sClusters,
      k8sBastions,
      k8sConnectingClusterIds,
      k8sSyncingBastionIds,
      k8sDeleteConfirmClusterId,
      k8sClusterActionMenuId,
      k8sImportContexts,
      k8sActiveClusterId,
      k8sSearchQuery,
      k8sConfigTab,
      k8sSelectedClusterId,
      k8sAddModalOpen,
      k8sEditModalOpen,
      k8sEditingClusterId,
      k8sTestResult,
      k8sCollapsedBastionIds,
      k8sAgentClusterId,
      k8sAgentContextName,
      k8sAgentStatus,
      savedK8sProxyConfig,
      k8sProxyConfig,
      k8sProxyConfigOpen
    },
    {
      setK8sNotice: (text) => notices.value.push(text),
      applyKubernetesCatalog,
      completeK8sTerminalConnect: (clusterId) => terminalActions.completedConnects.push(clusterId),
      markK8sClusterTerminalTabsEnded: (clusterId) => terminalActions.endedClusters.push(clusterId),
      removeK8sClusterTerminalTabs: (clusterId) => terminalActions.removedClusters.push(clusterId)
    }
  )

  window.aiops = {
    ...originalAiops,
    listKubernetesCatalog: vi.fn(async () => ({ ok: true, data: catalog() })),
    switchKubernetesContext: vi.fn(async (name) => ({
      ok: true,
      data: catalog({
        currentContext: name,
        contexts: [prodContext, { ...stageContext, isActive: true }],
        activeClusterId: 'stage',
        selectedClusterId: 'stage'
      })
    })),
    saveKubernetesAgentProxyConfig: vi.fn(async (proxyConfig) => ({ ok: true, data: { proxyConfig: { ...proxyConfig, updatedAt: '2026-06-20T00:00:00.000Z' }, message: 'saved' } })),
    connectKubernetesCluster: vi.fn(async (id) => ({
      ok: true,
      data: catalog({
        clusters: k8sClusters.value.map((item) => (item.id === id ? { ...item, connection_status: 'connected' } : item)),
        activeClusterId: id,
        selectedClusterId: id,
        cluster: { ...k8sClusters.value.find((item) => item.id === id)!, connection_status: 'connected' }
      } as any)
    })),
    disconnectKubernetesCluster: vi.fn(async (id) => ({
      ok: true,
      data: catalog({
        clusters: k8sClusters.value.map((item) => (item.id === id ? { ...item, connection_status: 'disconnected' } : item)),
        activeClusterId: id === 'prod' ? null : k8sActiveClusterId.value,
        selectedClusterId: k8sSelectedClusterId.value,
        cluster: { ...k8sClusters.value.find((item) => item.id === id)!, connection_status: 'disconnected' }
      } as any)
    })),
    testKubernetesClusterConnection: vi.fn(async (input) => ({
      ok: true,
      data: {
        success: true,
        isValid: true,
        contextName: input.contextName,
        serverUrl: input.serverUrl || '',
        message: 'connection ok'
      }
    })),
    importKubernetesKubeconfig: vi.fn(async (input) => ({
      ok: true,
      data: {
        requestId: input.requestId,
        contexts: [{ name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa' }],
        kubeconfigPath: input.kubeconfigPath || '',
        kubeconfigContent: input.kubeconfigContent || 'file-content',
        currentContext: 'qa/dev'
      }
    })),
    addKubernetesCluster: vi.fn(async (input) => {
      const added = cluster({
        id: 'qa',
        name: input.name,
        context_name: input.contextName,
        server_url: input.serverUrl,
        default_namespace: input.defaultNamespace || 'default'
      })
      return { ok: true, data: catalog({ clusters: [...k8sClusters.value, added], selectedClusterId: added.id, cluster: added } as any) }
    }),
    updateKubernetesCluster: vi.fn(async (id, patch) => {
      const current = k8sClusters.value.find((item) => item.id === id)!
      const updated = { ...current, name: patch.name || current.name, default_namespace: patch.defaultNamespace || current.default_namespace, auto_connect: patch.autoConnect ? 1 : current.auto_connect }
      return { ok: true, data: catalog({ clusters: k8sClusters.value.map((item) => (item.id === id ? updated : item)), cluster: updated } as any) }
    }),
    deleteKubernetesCluster: vi.fn(async (id) => ({ ok: true, data: catalog({ clusters: k8sClusters.value.filter((item) => item.id !== id), selectedClusterId: 'prod' }) })),
    syncKubernetesBastion: vi.fn(async () => {
      const data = catalog({
        clusters: [...k8sClusters.value, cluster({ id: 'jump-prod', name: 'Jump Prod', source_type: 'jumpserver', bastion_uuid: 'org-prod' })]
      }) as KubernetesCatalog & { syncedCount: number; updatedCount: number }
      data.syncedCount = 1
      data.updatedCount = 0
      return { ok: true, data }
    })
  }

  return {
    controller,
    k8sClusters,
    k8sConnectingClusterIds,
    k8sSyncingBastionIds,
    k8sDeleteConfirmClusterId,
    k8sClusterActionMenuId,
    k8sImportContexts,
    k8sActiveClusterId,
    k8sSearchQuery,
    k8sConfigTab,
    k8sSelectedClusterId,
    k8sAddModalOpen,
    k8sEditModalOpen,
    k8sEditingClusterId,
    k8sTestResult,
    k8sCollapsedBastionIds,
    k8sAgentClusterId,
    k8sAgentContextName,
    k8sAgentStatus,
    savedK8sProxyConfig,
    k8sProxyConfig,
    k8sProxyConfigOpen,
    notices,
    terminalActions,
    contexts
  }
}

afterEach(() => {
  window.aiops = originalAiops
  vi.restoreAllMocks()
})

describe('workspaceKubernetesClusterController', () => {
  it('owns catalog, context, proxy, connection, import, CRUD, and bastion workflows', async () => {
    const subject = createSubject()

    await expect(subject.controller.refreshKubernetesCatalog()).resolves.toEqual(expect.objectContaining({ currentContext: 'prod/admin' }))
    await expect(subject.controller.switchK8sContext('stage/dev')).resolves.toBe(true)
    expect(subject.k8sActiveClusterId.value).toBe('stage')
    expect(subject.notices.value.at(-1)).toBe('已切换到 stage/dev')

    subject.controller.clearK8sSearch()
    expect(subject.k8sSearchQuery.value).toBe('')
    subject.controller.selectK8sCluster('stage')
    expect(subject.k8sSelectedClusterId.value).toBe('stage')

    subject.controller.openK8sProxyConfig()
    subject.controller.updateK8sProxyConfig({ enabled: true, type: 'HTTPS', host: 'proxy.internal', port: 8443 })
    await expect(subject.controller.saveK8sProxyConfig()).resolves.toBe(true)
    expect(subject.savedK8sProxyConfig.value).toMatchObject({ enabled: true, host: 'proxy.internal', port: 8443 })
    expect(subject.k8sProxyConfigOpen.value).toBe(false)

    await expect(subject.controller.connectK8sCluster('stage')).resolves.toBe(true)
    expect(subject.k8sClusters.value.find((item) => item.id === 'stage')?.connection_status).toBe('connected')
    expect(subject.terminalActions.completedConnects).toEqual(['stage'])
    expect(subject.k8sAgentClusterId.value).toBe('stage')

    await expect(subject.controller.disconnectK8sCluster('stage')).resolves.toBe(true)
    expect(subject.k8sClusters.value.find((item) => item.id === 'stage')?.connection_status).toBe('disconnected')
    expect(subject.terminalActions.endedClusters).toEqual(['stage'])

    await expect(subject.controller.testK8sClusterConnection({ contextName: 'qa/dev', serverUrl: 'https://qa.k8s.local:6443' })).resolves.toBe(true)
    expect(subject.k8sTestResult.value).toBe(true)

    const importedContent = await subject.controller.importK8sKubeconfigContent('qa kubeconfig')
    expect(importedContent.success).toBe(true)
    expect(subject.k8sImportContexts.value[0]).toMatchObject({ name: 'qa/dev' })
    expect(window.aiops.importKubernetesKubeconfig).toHaveBeenLastCalledWith({
      requestId: expect.stringMatching(/^k8s-kubeconfig-import-/),
      kubeconfigContent: 'qa kubeconfig'
    })

    const importedFile = await subject.controller.importK8sKubeconfigFile('/tmp/qa.yaml')
    expect(importedFile.success).toBe(true)
    expect(window.aiops.importKubernetesKubeconfig).toHaveBeenLastCalledWith({
      requestId: expect.stringMatching(/^k8s-kubeconfig-import-/),
      kubeconfigPath: '/tmp/qa.yaml'
    })

    subject.k8sAddModalOpen.value = true
    const added = await subject.controller.addK8sCluster({ name: 'QA', contextName: 'qa/dev', serverUrl: 'https://qa.k8s.local:6443', defaultNamespace: 'qa' })
    expect(added?.id).toBe('qa')
    expect(subject.k8sSelectedClusterId.value).toBe('qa')
    expect(subject.k8sAddModalOpen.value).toBe(false)

    subject.k8sEditModalOpen.value = true
    subject.k8sEditingClusterId.value = 'qa'
    const updated = await subject.controller.updateK8sCluster('qa', { name: 'QA Renamed', autoConnect: true })
    expect(updated?.name).toBe('QA Renamed')
    expect(subject.k8sEditModalOpen.value).toBe(false)
    expect(subject.k8sEditingClusterId.value).toBeNull()

    subject.controller.requestDeleteK8sCluster('qa')
    expect(subject.k8sDeleteConfirmClusterId.value).toBe('qa')
    await subject.controller.confirmDeleteK8sCluster()
    expect(subject.k8sClusters.value.some((item) => item.id === 'qa')).toBe(false)
    expect(subject.terminalActions.removedClusters).toEqual(['qa'])

    expect(subject.controller.syncK8sBastion('org-prod')).toBe(true)
    expect(subject.k8sSyncingBastionIds.value).toContain('org-prod')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(subject.k8sConfigTab.value).toBe('jumpserver')
    expect(subject.k8sSyncingBastionIds.value).not.toContain('org-prod')
    expect(subject.k8sClusters.value.some((item) => item.id === 'jump-prod')).toBe(true)

    subject.controller.toggleK8sBastionCollapsed('org-prod')
    expect(subject.k8sCollapsedBastionIds.value).toEqual(['org-prod'])
    subject.controller.toggleK8sBastionCollapsed('org-prod')
    expect(subject.k8sCollapsedBastionIds.value).toEqual([])
  })

  it('rejects malformed backend results without mutating protected state', async () => {
    const subject = createSubject()
    const clustersBefore = JSON.stringify(subject.k8sClusters.value)
    const contextsBefore = JSON.stringify(subject.k8sImportContexts.value)

    vi.mocked(window.aiops.listKubernetesCatalog).mockResolvedValueOnce({ ok: true, data: { ...catalog(), clusters: [{ id: 'bad' }] } as any })
    await expect(subject.controller.refreshKubernetesCatalog()).resolves.toBeNull()
    expect(subject.notices.value.at(-1)).toBe('Kubernetes catalog backend returned malformed result data.')
    expect(JSON.stringify(subject.k8sClusters.value)).toBe(clustersBefore)

    vi.mocked(window.aiops.switchKubernetesContext).mockResolvedValueOnce({ ok: true, data: { ...catalog(), currentContext: 42 } as any })
    await expect(subject.controller.switchK8sContext('stage/dev')).resolves.toBe(false)
    expect(subject.notices.value.at(-1)).toBe('Kubernetes context backend returned malformed result data.')

    subject.controller.openK8sProxyConfig()
    subject.controller.updateK8sProxyConfig({ enabled: true, host: 'bad.proxy', port: 8080 })
    vi.mocked(window.aiops.saveKubernetesAgentProxyConfig).mockResolvedValueOnce({ ok: true, data: { proxyConfig: { enabled: true }, message: 'bad' } as any })
    await expect(subject.controller.saveK8sProxyConfig()).resolves.toBe(false)
    expect(subject.notices.value.at(-1)).toBe('Kubernetes Agent proxy backend returned malformed result data.')
    expect(subject.k8sProxyConfigOpen.value).toBe(true)

    vi.mocked(window.aiops.connectKubernetesCluster).mockResolvedValueOnce({
      ok: true,
      data: catalog({ cluster: { ...stageCluster, connection_status: 'disconnected' } } as any)
    })
    await expect(subject.controller.connectK8sCluster('stage')).resolves.toBe(false)
    expect(subject.notices.value.at(-1)).toBe('Kubernetes cluster backend returned malformed result data.')
    expect(subject.terminalActions.completedConnects).toEqual([])

    vi.mocked(window.aiops.importKubernetesKubeconfig).mockImplementationOnce(async (input) => ({
      ok: true,
      data: {
        requestId: input.requestId,
        contexts: [{ name: 'broken/import' }],
        kubeconfigPath: '',
        kubeconfigContent: 'bad content',
        currentContext: 'broken/import'
      }
    }) as any)
    const imported = await subject.controller.importK8sKubeconfigContent('bad content')
    expect(imported.success).toBe(false)
    expect(subject.notices.value.at(-1)).toBe('Kubeconfig backend returned malformed result data.')
    expect(JSON.stringify(subject.k8sImportContexts.value)).toBe(contextsBefore)

    vi.mocked(window.aiops.testKubernetesClusterConnection).mockResolvedValueOnce({ ok: true, data: { isValid: true, message: 'bad' } as any })
    await expect(subject.controller.testK8sClusterConnection({ contextName: 'prod/admin' })).resolves.toBe(false)
    expect(subject.k8sTestResult.value).toBe(false)

    vi.mocked(window.aiops.addKubernetesCluster).mockResolvedValueOnce({ ok: true, data: catalog({ cluster: { id: 'bad' } } as any) })
    await expect(subject.controller.addK8sCluster({ name: 'Bad', contextName: 'bad/context', serverUrl: 'https://bad.k8s.local:6443' })).resolves.toBeNull()
    expect(JSON.stringify(subject.k8sClusters.value)).toBe(clustersBefore)

    vi.mocked(window.aiops.deleteKubernetesCluster).mockResolvedValueOnce({ ok: true, data: catalog() as any })
    await expect(subject.controller.deleteK8sCluster('stage')).resolves.toBe(false)
    expect(subject.terminalActions.removedClusters).toEqual([])

    subject.k8sConfigTab.value = 'local'
    vi.mocked(window.aiops.syncKubernetesBastion).mockResolvedValueOnce({ ok: true, data: { ...catalog(), syncedCount: '1', updatedCount: 0 } as any })
    expect(subject.controller.syncK8sBastion('org-prod')).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(subject.notices.value.at(-1)).toBe('Kubernetes bastion backend returned malformed result data.')
    expect(subject.k8sConfigTab.value).toBe('local')
  })

  it('keeps stale kubeconfig imports from overwriting newer accepted imports', async () => {
    const subject = createSubject()
    let resolveSlowImport: ((value: Awaited<ReturnType<typeof window.aiops.importKubernetesKubeconfig>>) => void) | undefined
    vi.mocked(window.aiops.importKubernetesKubeconfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlowImport = resolve
        }) as ReturnType<typeof window.aiops.importKubernetesKubeconfig>
    )
    const slowPromise = subject.controller.importK8sKubeconfigContent('slow content')
    vi.mocked(window.aiops.importKubernetesKubeconfig).mockImplementationOnce(async (input) => ({
      ok: true,
      data: {
        requestId: input.requestId || '',
        contexts: [{ name: 'fast/admin', cluster: 'fast-cluster', server: 'https://fast.k8s.local:6443', namespace: 'fast' }],
        kubeconfigPath: '',
        kubeconfigContent: 'fast content',
        currentContext: 'fast/admin'
      }
    }))

    const fastResult = await subject.controller.importK8sKubeconfigContent('fast content')
    expect(fastResult.success).toBe(true)
    expect(subject.k8sImportContexts.value).toEqual([{ name: 'fast/admin', cluster: 'fast-cluster', server: 'https://fast.k8s.local:6443', namespace: 'fast' }])

    resolveSlowImport?.({
      ok: true,
      data: {
        requestId: 'k8s-kubeconfig-import-older',
        contexts: [{ name: 'slow/admin', cluster: 'slow-cluster', server: 'https://slow.k8s.local:6443', namespace: 'slow' }],
        kubeconfigPath: '',
        kubeconfigContent: 'slow content',
        currentContext: 'slow/admin'
      }
    })
    const slowResult = await slowPromise
    expect(slowResult).toEqual(expect.objectContaining({ success: false, stale: true }))
    expect(subject.k8sImportContexts.value).toEqual([{ name: 'fast/admin', cluster: 'fast-cluster', server: 'https://fast.k8s.local:6443', namespace: 'fast' }])
  })
})
