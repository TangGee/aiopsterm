import { randomUUID } from 'crypto'
import type {
  AiopsMutationResult,
  KubernetesBastionGroup,
  KubernetesBastionSyncResult,
  KubernetesCatalog,
  KubernetesCatalogResult,
  KubernetesClusterInput,
  KubernetesClusterMutationResult,
  KubernetesClusterRecord,
  KubernetesClusterTestInput,
  KubernetesClusterTestResult,
  KubernetesClusterUpdateInput,
  KubernetesAgentCleanupResult,
  KubernetesCommandInput,
  KubernetesCommandResult,
  KubernetesContextInfo,
  KubernetesContextSwitchResult,
  KubernetesImportContextInfo,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceKind,
  KubernetesTerminalCloseResult,
  KubernetesTerminalCreateInput,
  KubernetesTerminalCreateResult,
  KubernetesTerminalMutationResult,
  KubernetesTerminalRecord
} from './preload'

const nowLabel = () => '刚刚'

const defaultContexts: KubernetesContextInfo[] = [
  {
    name: 'prod/admin',
    cluster: 'prod-cluster',
    namespace: 'default',
    server: 'https://prod.k8s.local:6443',
    isActive: true
  },
  {
    name: 'staging/devops',
    cluster: 'staging-cluster',
    namespace: 'staging',
    server: 'https://staging.k8s.local:6443',
    isActive: false
  }
]

const defaultBastions: KubernetesBastionGroup[] = [
  { uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' },
  { uuid: 'org-prod', label: 'prod-bastion', ip: '10.24.8.12' }
]

const defaultClusters: KubernetesClusterRecord[] = [
  {
    id: 'k8s-1',
    name: 'prod-cluster',
    kubeconfig_path: '~/.kube/config',
    kubeconfig_content: null,
    context_name: 'prod/admin',
    server_url: 'https://prod.k8s.local:6443',
    auth_type: 'kubeconfig',
    is_active: 1,
    connection_status: 'connected',
    auto_connect: 1,
    default_namespace: 'default',
    created_at: '2026-05-28 10:20',
    updated_at: '2026-06-03 09:30',
    source_type: 'local',
    bastion_uuid: null,
    bastion_asset_address: null,
    bastion_asset_name: null,
    bastion_asset_id_last: null
  },
  {
    id: 'k8s-2',
    name: 'staging-cluster',
    kubeconfig_path: '~/.kube/staging',
    kubeconfig_content: null,
    context_name: 'staging/devops',
    server_url: 'https://staging.k8s.local:6443',
    auth_type: 'kubeconfig',
    is_active: 0,
    connection_status: 'disconnected',
    auto_connect: 0,
    default_namespace: 'staging',
    created_at: '2026-05-28 11:20',
    updated_at: '2026-06-01 12:10',
    source_type: 'local',
    bastion_uuid: null,
    bastion_asset_address: null,
    bastion_asset_name: null,
    bastion_asset_id_last: null
  },
  {
    id: 'k8s-3',
    name: 'jumpserver-prod',
    kubeconfig_path: null,
    kubeconfig_content: null,
    context_name: 'jumpserver/prod',
    server_url: '172.16.20.14:6443',
    auth_type: 'jumpserver',
    is_active: 0,
    connection_status: 'error',
    auto_connect: 0,
    default_namespace: 'ops',
    created_at: '2026-05-30 15:00',
    updated_at: '2026-06-02 18:10',
    source_type: 'jumpserver',
    bastion_uuid: 'org-1',
    bastion_asset_address: '172.16.20.14',
    bastion_asset_name: 'jumpserver-prod',
    bastion_asset_id_last: 1014
  }
]

const defaultNamespaces: KubernetesNamespaceInfo[] = [
  { id: 'k8s-ns-prod-default', clusterId: 'k8s-1', name: 'default', status: 'Active', age: '92d' },
  { id: 'k8s-ns-prod-ops', clusterId: 'k8s-1', name: 'ops', status: 'Active', age: '77d' },
  { id: 'k8s-ns-prod-ingress', clusterId: 'k8s-1', name: 'ingress-nginx', status: 'Active', age: '64d' },
  { id: 'k8s-ns-staging', clusterId: 'k8s-2', name: 'staging', status: 'Active', age: '48d' },
  { id: 'k8s-ns-staging-ci', clusterId: 'k8s-2', name: 'ci', status: 'Active', age: '48d' },
  { id: 'k8s-ns-jump-ops', clusterId: 'k8s-3', name: 'ops', status: 'Active', age: '31d' }
]

const defaultResources: KubernetesResource[] = [
  {
    id: 'k8s-pod-api-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'api-gateway-6d8c9bb7f6-l6j2m',
    namespace: 'default',
    status: 'Running',
    ready: '2/2',
    age: '3d',
    detail: 'REST ingress workload serving public API traffic.',
    node: 'prod-node-01',
    image: 'registry.internal/api-gateway:2.8.4',
    restarts: 0
  },
  {
    id: 'k8s-pod-worker-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'billing-worker-7f9d6f9dd9-rx8mm',
    namespace: 'ops',
    status: 'CrashLoopBackOff',
    ready: '0/1',
    age: '18h',
    detail: 'Background billing worker with repeated startup failures.',
    node: 'prod-node-03',
    image: 'registry.internal/billing-worker:1.15.2',
    restarts: 12
  },
  {
    id: 'k8s-pod-ingress-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'ingress-nginx-controller-66d8f7dbf6-vf9jg',
    namespace: 'ingress-nginx',
    status: 'Running',
    ready: '1/1',
    age: '21d',
    detail: 'Cluster ingress controller.',
    node: 'prod-node-02',
    image: 'registry.k8s.io/ingress-nginx/controller:v1.11.1',
    restarts: 1
  },
  {
    id: 'k8s-deploy-api',
    clusterId: 'k8s-1',
    kind: 'deployments',
    name: 'api-gateway',
    namespace: 'default',
    status: 'Available',
    ready: '4/4',
    age: '38d',
    detail: 'RollingUpdate deployment for the public API gateway.',
    image: 'registry.internal/api-gateway:2.8.4',
    selector: 'app=api-gateway'
  },
  {
    id: 'k8s-deploy-worker',
    clusterId: 'k8s-1',
    kind: 'deployments',
    name: 'billing-worker',
    namespace: 'ops',
    status: 'Progressing',
    ready: '2/3',
    age: '24d',
    detail: 'Worker deployment processing billing queue events.',
    image: 'registry.internal/billing-worker:1.15.2',
    selector: 'app=billing-worker'
  },
  {
    id: 'k8s-svc-api',
    clusterId: 'k8s-1',
    kind: 'services',
    name: 'api-gateway',
    namespace: 'default',
    status: 'ClusterIP',
    ready: '10.96.12.40',
    age: '38d',
    detail: 'Internal service for api-gateway pods.',
    ports: '80/TCP, 443/TCP',
    selector: 'app=api-gateway'
  },
  {
    id: 'k8s-svc-ingress',
    clusterId: 'k8s-1',
    kind: 'services',
    name: 'ingress-nginx-controller',
    namespace: 'ingress-nginx',
    status: 'LoadBalancer',
    ready: '10.96.32.10',
    age: '64d',
    detail: 'Ingress controller service exposing HTTP and HTTPS.',
    ports: '80:32080/TCP, 443:32443/TCP',
    selector: 'app.kubernetes.io/name=ingress-nginx'
  },
  {
    id: 'k8s-node-prod-1',
    clusterId: 'k8s-1',
    kind: 'nodes',
    name: 'prod-node-01',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.29.3',
    age: '92d',
    detail: 'Control-plane capable production worker node.',
    node: '10.24.1.11'
  },
  {
    id: 'k8s-node-prod-2',
    clusterId: 'k8s-1',
    kind: 'nodes',
    name: 'prod-node-02',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.29.3',
    age: '91d',
    detail: 'Production worker node running ingress and API workloads.',
    node: '10.24.1.12'
  },
  {
    id: 'k8s-pod-staging-api',
    clusterId: 'k8s-2',
    kind: 'pods',
    name: 'staging-api-76f7d9cbf7-8l4xf',
    namespace: 'staging',
    status: 'Running',
    ready: '1/1',
    age: '9h',
    detail: 'Staging API pod for pre-release validation.',
    node: 'staging-node-01',
    image: 'registry.internal/api-gateway:2.9.0-rc1',
    restarts: 0
  },
  {
    id: 'k8s-deploy-staging-api',
    clusterId: 'k8s-2',
    kind: 'deployments',
    name: 'staging-api',
    namespace: 'staging',
    status: 'Available',
    ready: '2/2',
    age: '12d',
    detail: 'Staging API deployment.',
    image: 'registry.internal/api-gateway:2.9.0-rc1',
    selector: 'app=staging-api'
  },
  {
    id: 'k8s-svc-staging-api',
    clusterId: 'k8s-2',
    kind: 'services',
    name: 'staging-api',
    namespace: 'staging',
    status: 'ClusterIP',
    ready: '10.100.8.42',
    age: '12d',
    detail: 'Internal staging API service.',
    ports: '8080/TCP',
    selector: 'app=staging-api'
  },
  {
    id: 'k8s-node-staging-1',
    clusterId: 'k8s-2',
    kind: 'nodes',
    name: 'staging-node-01',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.28.8',
    age: '48d',
    detail: 'Staging worker node.',
    node: '10.28.1.11'
  },
  {
    id: 'k8s-pod-jump-ops',
    clusterId: 'k8s-3',
    kind: 'pods',
    name: 'ops-shell-0',
    namespace: 'ops',
    status: 'Pending',
    ready: '0/1',
    age: '42m',
    detail: 'JumpServer imported cluster workload waiting for scheduling.',
    node: '-',
    image: 'registry.internal/ops-shell:latest',
    restarts: 0
  }
]

const defaultImportContexts: KubernetesImportContextInfo[] = [
  { name: 'prod/admin', cluster: 'prod-cluster', server: 'https://prod.k8s.local:6443', namespace: 'default' },
  { name: 'staging/devops', cluster: 'staging-cluster', server: 'https://staging.k8s.local:6443', namespace: 'staging' }
]

let contexts = defaultContexts.map((context) => ({ ...context }))
let clusters = defaultClusters.map((cluster) => ({ ...cluster }))
let bastions = defaultBastions.map((bastion) => ({ ...bastion }))
let namespaces = defaultNamespaces.map((namespace) => ({ ...namespace }))
let resources = defaultResources.map((resource) => ({ ...resource }))
let importContexts = defaultImportContexts.map((context) => ({ ...context }))
let terminalSessions: KubernetesTerminalRecord[] = []

const cloneCatalog = (): KubernetesCatalog => {
  const activeCluster = clusters.find((cluster) => cluster.is_active === 1) || null
  return {
    contexts: contexts.map((context) => ({ ...context })),
    currentContext: contexts.find((context) => context.isActive)?.name || '',
    clusters: clusters.map((cluster) => ({ ...cluster })),
    bastions: bastions.map((bastion) => ({ ...bastion })),
    namespaces: namespaces.map((namespace) => ({ ...namespace })),
    resources: resources.map((resource) => ({ ...resource })),
    importContexts: importContexts.map((context) => ({ ...context })),
    activeClusterId: activeCluster?.id || null,
    selectedClusterId: activeCluster?.id || clusters[0]?.id || null
  }
}

const asResult = <T>(fn: () => T, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode
    return {
      ok: false,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

const requireCluster = (id: string) => {
  const cluster = clusters.find((item) => item.id === id)
  if (!cluster) throw Object.assign(new Error('Kubernetes cluster not found.'), { code: 'K8S_CLUSTER_NOT_FOUND' })
  return cluster
}

const clampTerminalDimension = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Math.round(Number(value) || fallback)
  return Math.max(min, Math.min(max, number))
}

const k8sTerminalPrompt = (namespace: string) => `[${namespace || 'default'}]$ `

const k8sTerminalSessionName = (clusterName: string, index: number) => (index <= 1 ? clusterName : `${clusterName}-${index}`)

const cloneTerminalRecord = (record: KubernetesTerminalRecord): KubernetesTerminalRecord => ({ ...record })

const findTerminalSession = (id: string) => terminalSessions.find((session) => session.id === id || session.sessionId === id)

const stripYamlScalar = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withoutComment = trimmed.replace(/\s+#.*$/, '').trim()
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"')) || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1)
  }
  return withoutComment
}

const yamlValueAfter = (line: string, key: string) => {
  const match = line.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`))
  return match ? stripYamlScalar(match[1]) : ''
}

const parseKubeconfigContexts = (content: string) => {
  const lines = content.split(/\r?\n/)
  const parsedClusters = new Map<string, string>()
  const parsedContexts: KubernetesImportContextInfo[] = []
  let section: 'clusters' | 'contexts' | '' = ''
  let clusterName = ''
  let contextName = ''
  let contextCluster = ''
  let contextNamespace = ''

  const flushContext = () => {
    if (!contextName || !contextCluster) return
    parsedContexts.push({
      name: contextName,
      cluster: contextCluster,
      server: parsedClusters.get(contextCluster) || '',
      namespace: contextNamespace || 'default'
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    if (/^\s*clusters\s*:\s*$/.test(line)) {
      flushContext()
      section = 'clusters'
      clusterName = ''
      contextName = ''
      contextCluster = ''
      contextNamespace = ''
      continue
    }
    if (/^\s*contexts\s*:\s*$/.test(line)) {
      flushContext()
      section = 'contexts'
      clusterName = ''
      contextName = ''
      contextCluster = ''
      contextNamespace = ''
      continue
    }
    if (/^\s*(users|preferences|apiVersion|kind)\s*:/.test(line)) {
      if (section === 'contexts') flushContext()
      section = ''
      clusterName = ''
      contextName = ''
      contextCluster = ''
      contextNamespace = ''
      continue
    }
    if (section === 'clusters') {
      const listName = line.match(/^\s*-\s+name\s*:\s*(.+)$/)
      if (listName) {
        clusterName = stripYamlScalar(listName[1])
        if (!parsedClusters.has(clusterName)) parsedClusters.set(clusterName, '')
        continue
      }
      const server = yamlValueAfter(line, 'server')
      if (clusterName && server) parsedClusters.set(clusterName, server)
      continue
    }
    if (section === 'contexts') {
      const listName = line.match(/^\s*-\s+name\s*:\s*(.+)$/)
      if (listName) {
        flushContext()
        contextName = stripYamlScalar(listName[1])
        contextCluster = ''
        contextNamespace = ''
        continue
      }
      const cluster = yamlValueAfter(line, 'cluster')
      if (contextName && cluster) {
        contextCluster = cluster
        continue
      }
      const namespace = yamlValueAfter(line, 'namespace')
      if (contextName && namespace) contextNamespace = namespace
    }
  }
  if (section === 'contexts') flushContext()

  return parsedContexts.filter((context, index, list) => list.findIndex((item) => item.name === context.name) === index)
}

const findKubernetesTestContext = (contextName: string): KubernetesImportContextInfo | null => {
  const imported = importContexts.find((context) => context.name === contextName)
  if (imported) return { ...imported }
  const listed = contexts.find((context) => context.name === contextName)
  if (listed) return { name: listed.name, cluster: listed.cluster, server: listed.server, namespace: listed.namespace }
  const cluster = clusters.find((item) => item.context_name === contextName)
  if (!cluster) return null
  return {
    name: cluster.context_name,
    cluster: cluster.name,
    server: cluster.server_url,
    namespace: cluster.default_namespace || 'default'
  }
}

const upsertContextForCluster = (cluster: KubernetesClusterRecord, isActive = cluster.is_active === 1) => {
  const context: KubernetesContextInfo = {
    name: cluster.context_name,
    cluster: cluster.name,
    namespace: cluster.default_namespace || 'default',
    server: cluster.server_url,
    isActive
  }
  contexts = contexts.some((item) => item.name === context.name)
    ? contexts.map((item) => (item.name === context.name ? context : item))
    : [context, ...contexts]
  importContexts = importContexts.some((item) => item.name === context.name)
    ? importContexts.map((item) => (item.name === context.name ? { name: context.name, cluster: context.cluster, server: context.server, namespace: context.namespace } : item))
    : [{ name: context.name, cluster: context.cluster, server: context.server, namespace: context.namespace }, ...importContexts]
}

export const listKubernetesCatalog = async (): Promise<KubernetesCatalogResult> => asResult(() => cloneCatalog())

export const switchKubernetesContext = async (contextName: string): Promise<KubernetesContextSwitchResult> =>
  asResult(() => {
    const name = contextName.trim()
    const context = contexts.find((item) => item.name === name)
    if (!context) throw Object.assign(new Error('Kubernetes context not found.'), { code: 'K8S_CONTEXT_NOT_FOUND' })
    contexts = contexts.map((item) => ({ ...item, isActive: item.name === name }))
    const cluster = clusters.find((item) => item.context_name === name)
    if (cluster) {
      clusters = clusters.map((item) => ({ ...item, is_active: item.id === cluster.id ? 1 : 0 }))
    }
    return {
      ...cloneCatalog(),
      currentContext: name
    }
  })

export const testKubernetesClusterConnection = async (input: KubernetesClusterTestInput): Promise<KubernetesClusterTestResult> =>
  asResult(() => {
    const contextName = input.contextName?.trim() || ''
    const requestedServerUrl = input.serverUrl?.trim() || ''
    if (!contextName) {
      throw Object.assign(new Error('Kubernetes context is required.'), { code: 'K8S_TEST_CONTEXT_REQUIRED' })
    }

    const content = input.kubeconfigContent?.trim() || ''
    const parsedContexts = content ? parseKubeconfigContexts(content) : []
    const context = content ? parsedContexts.find((item) => item.name === contextName) || null : findKubernetesTestContext(contextName)
    if (content && !context) {
      throw Object.assign(new Error('Kubernetes context not found in kubeconfig content.'), { code: 'K8S_TEST_CONTEXT_NOT_FOUND' })
    }
    const serverUrl = requestedServerUrl || context?.server || ''
    if (!serverUrl) {
      throw Object.assign(new Error('Kubernetes server URL is required.'), { code: 'K8S_TEST_SERVER_REQUIRED' })
    }
    if (context?.server && requestedServerUrl && context.server !== requestedServerUrl) {
      throw Object.assign(new Error('Kubernetes server URL does not match the selected context.'), { code: 'K8S_TEST_SERVER_MISMATCH' })
    }

    return {
      success: true,
      isValid: true,
      contextName,
      serverUrl,
      message: '连接测试成功'
    }
  }, 'K8S_TEST_FAILED')

export const addKubernetesCluster = async (input: KubernetesClusterInput): Promise<KubernetesClusterMutationResult> =>
  asResult(() => {
    const name = input.name.trim()
    const contextName = input.contextName.trim()
    const serverUrl = input.serverUrl.trim()
    if (!name || !contextName || !serverUrl) {
      throw Object.assign(new Error('Cluster name, context and server URL are required.'), { code: 'K8S_CLUSTER_REQUIRED' })
    }
    const cluster: KubernetesClusterRecord = {
      id: `k8s-${randomUUID()}`,
      name,
      kubeconfig_path: input.kubeconfigPath || null,
      kubeconfig_content: input.kubeconfigContent || null,
      context_name: contextName,
      server_url: serverUrl,
      auth_type: input.authType || (input.sourceType === 'jumpserver' ? 'jumpserver' : 'kubeconfig'),
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: input.autoConnect ? 1 : 0,
      default_namespace: input.defaultNamespace?.trim() || 'default',
      created_at: nowLabel(),
      updated_at: nowLabel(),
      source_type: input.sourceType || 'local',
      bastion_uuid: input.bastionUuid || null,
      bastion_asset_address: null,
      bastion_asset_name: null,
      bastion_asset_id_last: null
    }
    clusters = [cluster, ...clusters]
    upsertContextForCluster(cluster, false)
    return {
      ...cloneCatalog(),
      cluster: { ...cluster }
    }
  })

export const updateKubernetesCluster = async (id: string, input: KubernetesClusterUpdateInput): Promise<KubernetesClusterMutationResult> =>
  asResult(() => {
    const current = requireCluster(id)
    const next: KubernetesClusterRecord = {
      ...current,
      name: input.name?.trim() || current.name,
      default_namespace: input.defaultNamespace?.trim() || current.default_namespace,
      auto_connect: input.autoConnect === undefined ? current.auto_connect : input.autoConnect ? 1 : 0,
      updated_at: nowLabel()
    }
    clusters = clusters.map((cluster) => (cluster.id === id ? next : cluster))
    upsertContextForCluster(next)
    return {
      ...cloneCatalog(),
      cluster: { ...next }
    }
  })

export const deleteKubernetesCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
  asResult(() => {
    const current = requireCluster(id)
    clusters = clusters.filter((cluster) => cluster.id !== id)
    contexts = contexts.filter((context) => context.name !== current.context_name)
    namespaces = namespaces.filter((namespace) => namespace.clusterId !== id)
    resources = resources.filter((resource) => resource.clusterId !== id)
    terminalSessions = terminalSessions.filter((session) => session.clusterId !== id)
    return cloneCatalog()
  })

export const connectKubernetesCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
  asResult(() => {
    const current = requireCluster(id)
    clusters = clusters.map((cluster) => ({
      ...cluster,
      is_active: cluster.id === id ? 1 : 0,
      connection_status: cluster.id === id ? 'connected' : cluster.connection_status === 'connected' ? 'disconnected' : cluster.connection_status,
      updated_at: cluster.id === id ? nowLabel() : cluster.updated_at
    }))
    contexts = contexts.map((context) => ({ ...context, isActive: context.name === current.context_name }))
    const connected = requireCluster(id)
    return {
      ...cloneCatalog(),
      cluster: { ...connected }
    }
  })

export const disconnectKubernetesCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
  asResult(() => {
    const current = requireCluster(id)
    const next = {
      ...current,
      is_active: 0,
      connection_status: 'disconnected' as const,
      updated_at: nowLabel()
    }
    clusters = clusters.map((cluster) => (cluster.id === id ? next : cluster))
    terminalSessions = terminalSessions.filter((session) => session.clusterId !== id)
    return {
      ...cloneCatalog(),
      cluster: { ...next }
    }
  })

export const syncKubernetesBastion = async (bastionUuid: string): Promise<KubernetesBastionSyncResult> =>
  asResult(() => {
    const bastion = bastions.find((item) => item.uuid === bastionUuid)
    if (!bastion) throw Object.assign(new Error('Kubernetes bastion not found.'), { code: 'K8S_BASTION_NOT_FOUND' })
    const existing = clusters.filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid)
    if (existing.length) {
      clusters = clusters.map((cluster) =>
        cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid ? { ...cluster, updated_at: nowLabel() } : cluster
      )
      return {
        ...cloneCatalog(),
        syncedCount: 0,
        updatedCount: existing.length
      }
    }

    const cluster: KubernetesClusterRecord = {
      id: `k8s-${randomUUID()}`,
      name: `${bastion.label}-k8s`,
      kubeconfig_path: null,
      kubeconfig_content: null,
      context_name: `${bastion.label}/synced`,
      server_url: `${bastion.ip}:6443`,
      auth_type: 'jumpserver',
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: 'default',
      created_at: nowLabel(),
      updated_at: nowLabel(),
      source_type: 'jumpserver',
      bastion_uuid: bastion.uuid,
      bastion_asset_address: bastion.ip,
      bastion_asset_name: bastion.label,
      bastion_asset_id_last: null
    }
    clusters = [cluster, ...clusters]
    upsertContextForCluster(cluster, false)
    return {
      ...cloneCatalog(),
      syncedCount: 1,
      updatedCount: 0
    }
  })

export const createKubernetesTerminal = async (input: KubernetesTerminalCreateInput): Promise<KubernetesTerminalCreateResult> =>
  asResult(() => {
    const cluster = requireCluster(input.clusterId)
    const namespace = input.namespace?.trim() || cluster.default_namespace || 'default'
    const activeClusterSessions = terminalSessions.filter((session) => session.clusterId === cluster.id && session.status !== 'ended')
    const sessionIndex = activeClusterSessions.length + 1
    const status = cluster.connection_status === 'connected' ? 'connected' : 'connecting'
    const record: KubernetesTerminalRecord = {
      id: `k8s-tab-${randomUUID()}`,
      sessionId: `k8s-session-${randomUUID()}`,
      clusterId: cluster.id,
      name: k8sTerminalSessionName(cluster.name, sessionIndex),
      namespace,
      output: [`Connecting to cluster ${cluster.name}...`, `kubectl context: ${cluster.context_name}`, `namespace: ${namespace}`, k8sTerminalPrompt(namespace)].join('\n'),
      status,
      cols: clampTerminalDimension(input.cols, 80, 20, 240),
      rows: clampTerminalDimension(input.rows, 24, 8, 80),
      createdAt: nowLabel(),
      updatedAt: nowLabel()
    }
    terminalSessions = [...terminalSessions, record]
    return cloneTerminalRecord(record)
  })

export const resizeKubernetesTerminal = async (id: string, cols: number, rows: number): Promise<KubernetesTerminalMutationResult> =>
  asResult(() => {
    const current = findTerminalSession(id)
    if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
    const updated: KubernetesTerminalRecord = {
      ...current,
      cols: clampTerminalDimension(cols, current.cols || 80, 20, 240),
      rows: clampTerminalDimension(rows, current.rows || 24, 8, 80),
      updatedAt: nowLabel()
    }
    terminalSessions = terminalSessions.map((session) => (session.id === current.id ? updated : session))
    return cloneTerminalRecord(updated)
  })

export const closeKubernetesTerminal = async (id: string, exitCode = 0): Promise<KubernetesTerminalCloseResult> =>
  asResult(() => {
    const current = findTerminalSession(id)
    if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
    const closed: KubernetesTerminalRecord & { exitCode: number } = {
      ...current,
      status: 'ended',
      updatedAt: nowLabel(),
      exitCode
    }
    terminalSessions = terminalSessions.filter((session) => session.id !== current.id)
    return { ...closed }
  })

export const __resetKubernetesCatalogForTests = () => {
  contexts = defaultContexts.map((context) => ({ ...context }))
  clusters = defaultClusters.map((cluster) => ({ ...cluster }))
  bastions = defaultBastions.map((bastion) => ({ ...bastion }))
  namespaces = defaultNamespaces.map((namespace) => ({ ...namespace }))
  resources = defaultResources.map((resource) => ({ ...resource }))
  importContexts = defaultImportContexts.map((context) => ({ ...context }))
  terminalSessions = []
}

const resourceTypeByKind: Record<KubernetesResourceKind, string> = {
  pods: 'pod',
  deployments: 'deployment',
  services: 'service',
  nodes: 'node'
}

const kindFromToken = (token: string): KubernetesResourceKind | null => {
  if (/^pods?$/.test(token)) return 'pods'
  if (/^deploy(ments?)?$/.test(token) || /^deployments?$/.test(token)) return 'deployments'
  if (/^svc$|^services?$/.test(token)) return 'services'
  if (/^nodes?$/.test(token)) return 'nodes'
  return null
}

const normalize = (command: string) => command.trim().replace(/\s+/g, ' ')

const namespaceFromCommand = (command: string, fallback: string) => {
  const namespaceMatch = command.match(/(?:-n|--namespace)\s+([^\s]+)/)
  return namespaceMatch?.[1] || fallback
}

const renderList = (command: string, clusterId: string, namespace: string) => {
  const getKind = command.match(/^kubectl\s+get\s+([^\s]+)/)
  const kind = getKind ? kindFromToken(getKind[1]) : null
  if (!kind) return ''
  const includeAll = command.includes('--all-namespaces') || command.includes(' -A')
  const targetNamespace = namespaceFromCommand(command, namespace)
  return resources
    .filter((resource) => resource.clusterId === clusterId && resource.kind === kind)
    .filter((resource) => kind === 'nodes' || includeAll || resource.namespace === targetNamespace)
    .map((resource) =>
      [
        kind !== 'nodes' && includeAll ? resource.namespace : '',
        resource.name,
        resource.ready,
        resource.status,
        kind === 'pods' ? String(resource.restarts || 0) : resource.node || resource.ports || resource.selector || '-',
        resource.age
      ]
        .filter(Boolean)
        .join('\t')
    )
    .join('\n')
}

const findResource = (clusterId: string, kind: KubernetesResourceKind, name: string, namespace: string) =>
  resources.find((item) => item.clusterId === clusterId && item.kind === kind && item.name === name && (kind === 'nodes' || item.namespace === namespace))

const renderLogs = (command: string, clusterId: string, namespace: string) => {
  const match = command.match(/^kubectl\s+logs\s+([^\s]+)/)
  if (!match) return ''
  const podName = match[1]
  const targetNamespace = namespaceFromCommand(command, namespace)
  const resource = findResource(clusterId, 'pods', podName, targetNamespace)
  if (!resource) return `Error from server (NotFound): pods "${podName}" not found`
  return [
    `2026-06-04T09:27:59Z info starting container ${resource.name}`,
    `2026-06-04T09:28:02Z info namespace=${resource.namespace} node=${resource.node || '-'}`,
    resource.status === 'CrashLoopBackOff' ? '2026-06-04T09:28:11Z error failed to load billing config: missing secret billing-api-token' : '',
    `2026-06-04T09:28:15Z info readiness probe ${resource.status === 'Running' ? 'passed' : 'pending'}`
  ]
    .filter(Boolean)
    .join('\n')
}

const renderDescribe = (command: string, clusterId: string, namespace: string) => {
  const match = command.match(/^kubectl\s+describe\s+([^\s]+)\s+([^\s]+)/)
  if (!match) return ''
  const kind = kindFromToken(match[1])
  const name = match[2]
  if (!kind) return ''
  const targetNamespace = kind === 'nodes' ? 'cluster' : namespaceFromCommand(command, namespace)
  const resource = findResource(clusterId, kind, name, targetNamespace)
  if (!resource) return `Error from server (NotFound): ${resourceTypeByKind[kind]}s "${name}" not found`
  return [
    `Name: ${resource.name}`,
    `Namespace: ${resource.kind === 'nodes' ? '<cluster>' : resource.namespace}`,
    `Kind: ${resourceTypeByKind[resource.kind]}`,
    `Status: ${resource.status}`,
    `Ready: ${resource.ready}`,
    resource.node ? `Node: ${resource.node}` : '',
    resource.image ? `Image: ${resource.image}` : '',
    resource.ports ? `Ports: ${resource.ports}` : '',
    resource.selector ? `Selector: ${resource.selector}` : '',
    resource.restarts !== undefined ? `Restarts: ${resource.restarts}` : '',
    `Age: ${resource.age}`,
    '',
    `Events: ${resource.detail}`
  ]
    .filter(Boolean)
    .join('\n')
}

const renderCommand = (input: KubernetesCommandInput) => {
  const command = normalize(input.command)
  const cluster = clusters.find((item) => item.id === input.clusterId) || {
    id: input.clusterId || '',
    name: input.clusterName || input.clusterId || 'unknown-cluster',
    context_name: input.contextName || 'unknown-context',
    default_namespace: input.defaultNamespace || 'default'
  }
  const namespace = input.namespace || cluster.default_namespace || 'default'

  if (/^kubectl\s+config\s+current-context\b/.test(command)) return cluster.context_name
  if (/^kubectl\s+version\b/.test(command)) {
    return ['Client Version: v1.30.0-aiopsterm', 'Kustomize Version: v5.0.4', `Server Version: ${cluster.name} api v1.29.4`].join('\n')
  }
  if (/^kubectl\s+get\s+ns\b|^kubectl\s+get\s+namespaces\b/.test(command)) {
    return namespaces
      .filter((item) => item.clusterId === cluster.id)
      .map((item) => `${item.name}\t${item.status}\t${item.age}`)
      .join('\n')
  }
  if (/^kubectl\s+get\s+/.test(command)) return renderList(command, cluster.id, namespace)
  if (/^kubectl\s+logs\s+/.test(command)) return renderLogs(command, cluster.id, namespace)
  if (/^kubectl\s+describe\s+/.test(command)) return renderDescribe(command, cluster.id, namespace)
  return `command executed through aiopsterm Kubernetes backend: ${command}`
}

const renderTerminalCommandOutput = (command: string, output: string, error = '') => {
  const body = output || error
  return `[aiopsterm kubectl] ${command}${body ? `\n${body}` : ''}`
}

const createKubernetesCommandRun = (
  input: KubernetesCommandInput,
  command: string,
  output: string,
  success: boolean,
  startedAt: number,
  error = ''
): NonNullable<KubernetesCommandResult['data']> => {
  const cluster = input.clusterId ? clusters.find((item) => item.id === input.clusterId) : undefined
  const namespace = input.namespace || cluster?.default_namespace || input.defaultNamespace || 'default'
  return {
    runId: `k8s-run-${randomUUID()}`,
    command,
    output,
    terminalOutput: success ? renderTerminalCommandOutput(command, output) : '',
    success,
    error,
    durationMs: Math.max(1, Date.now() - startedAt),
    startedAt: nowLabel(),
    clusterId: input.clusterId || '',
    contextName: cluster?.context_name || input.contextName || 'unknown-context',
    namespace,
    source: input.source || 'terminal'
  }
}

export async function executeKubernetesCommand(input: KubernetesCommandInput): Promise<KubernetesCommandResult> {
  const startedAt = Date.now()
  const command = normalize(input.command)
  if (!command) {
    if (input.source === 'agent') {
      return {
        ok: true,
        data: createKubernetesCommandRun(input, '<empty>', '', false, startedAt, 'Kubernetes command is required.')
      }
    }
    return { ok: false, errorCode: 'K8S_EMPTY_COMMAND', errorMessage: 'Kubernetes command is required.' }
  }
  if (!input.clusterId) {
    if (input.source === 'agent') {
      return {
        ok: true,
        data: createKubernetesCommandRun(input, command, '', false, startedAt, 'No cluster selected. Please select a cluster first.')
      }
    }
    return { ok: false, errorCode: 'K8S_CLUSTER_REQUIRED', errorMessage: 'Kubernetes cluster is required.' }
  }

  const output = renderCommand({ ...input, command })
  const success = !/^Error from server/.test(output)
  return {
    ok: true,
    data: {
      ...createKubernetesCommandRun(input, command, output, success, startedAt, success ? '' : output),
      terminalOutput: renderTerminalCommandOutput(command, output, success ? '' : output)
    }
  }
}

export async function cleanupKubernetesAgent(): Promise<KubernetesAgentCleanupResult> {
  return asResult(() => ({
    cleared: true,
    cleanedAt: nowLabel()
  }))
}
