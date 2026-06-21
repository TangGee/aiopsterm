import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import type { AiopsAssetRecord, AiopsOrganizationAssetRefreshResult } from './contracts/assets'
import type { AiopsMutationResult } from './contracts/common'
import type {
  KubernetesAgentProxyConfig,
  KubernetesAgentProxyConfigInput,
  KubernetesAgentProxyConfigResult,
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
  KubernetesKubeconfigImportInput,
  KubernetesKubeconfigImportResult,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceAction,
  KubernetesResourceActionExecuteResult,
  KubernetesResourceActionInput,
  KubernetesResourceActionPlanResult,
  KubernetesResourceKind,
  KubernetesResourceRefreshInput,
  KubernetesResourceRefreshResult,
  KubernetesTerminalCloseResult,
  KubernetesTerminalCreateInput,
  KubernetesTerminalCreateResult,
  KubernetesTerminalDataEvent,
  KubernetesTerminalExitEvent,
  KubernetesTerminalMutationResult,
  KubernetesTerminalRecord,
  KubernetesTerminalWriteResult
} from './contracts/kubernetes'
import {
  isRecord,
  normalizePersistedKubernetesState,
  persistedString,
  type KubernetesPersistedCatalogState
} from './kubernetesCatalogPersistence'
import {
  defaultKubernetesBastions as defaultBastions,
  defaultKubernetesClusters as defaultClusters,
  defaultKubernetesContexts as defaultContexts,
  defaultKubernetesImportContexts as defaultImportContexts,
  defaultKubernetesNamespaces as defaultNamespaces,
  defaultKubernetesResources as defaultResources,
  developmentKubernetesSeedClusterIds as developmentSeedClusterIds
} from './kubernetesSeedData'
import {
  allKubernetesResourceKinds,
  buildKubernetesGetCommand,
  buildKubernetesResourceActionCommand,
  createCanRunLocalKubectl,
  createNonRunnableKubernetesReason,
  kubernetesResourceActionTitlePrefix as resourceActionTitlePrefix,
  normalizeKubernetesCommand,
  parseKubectlNamespaces,
  parseKubectlResources,
  probeKubernetesClusterConnection,
  renderList,
  renderSeedCommand,
  renderTerminalCommandOutput,
  requireRunnableKubernetesClusterInput,
  runLocalKubectl
} from './kubernetesKubectlRuntime'
import { shouldUseKubernetesSeedData as runtimeShouldUseKubernetesSeedData } from './runtimeSwitches'

const nowLabel = () => '刚刚'

type KubernetesBackendRuntimeConfig = {
  stateDir?: string
  useSeedData?: boolean
  defaultKubeconfigPath?: string | null
  refreshOrganizationAssets?: (input: { organizationId?: string }) => AiopsOrganizationAssetRefreshResult | Promise<AiopsOrganizationAssetRefreshResult>
}

const jumpserverKubernetesSyncUnavailableMessage = 'JumpServer Kubernetes asset sync requires the live JumpServer backend integration.'

const defaultKubernetesStateDir = () => {
  const envRoot = String(process.env.AIOPSTERM_KUBERNETES_STATE_DIR || '').trim()
  return envRoot ? (isAbsolute(envRoot) ? envRoot : resolve(envRoot)) : join(process.cwd(), '.aiopsterm-kubernetes')
}

const defaultKubernetesSeedMode = runtimeShouldUseKubernetesSeedData

let runtimeConfig: Required<KubernetesBackendRuntimeConfig> = {
  stateDir: defaultKubernetesStateDir(),
  useSeedData: defaultKubernetesSeedMode(),
  defaultKubeconfigPath: join(homedir(), '.kube', 'config'),
  refreshOrganizationAssets: () => {
    throw Object.assign(new Error(jumpserverKubernetesSyncUnavailableMessage), { code: 'K8S_BASTION_SYNC_UNAVAILABLE' })
  }
}

const kubernetesProxyTypes: KubernetesAgentProxyConfig['type'][] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

const defaultAgentProxyConfig: KubernetesAgentProxyConfig = {
  enabled: false,
  type: 'SOCKS5',
  host: '127.0.0.1',
  port: 1080,
  enableProxyIdentity: false,
  username: '',
  password: '',
  updatedAt: ''
}

const shouldUseKubernetesSeedData = () => runtimeConfig.useSeedData

const jumpserverKubernetesSyncUnavailableError = () =>
  Object.assign(new Error(jumpserverKubernetesSyncUnavailableMessage), { code: 'K8S_BASTION_SYNC_UNAVAILABLE' })

const initialKubernetesState = () =>
  shouldUseKubernetesSeedData()
    ? {
        contexts: defaultContexts.map((context) => ({ ...context })),
        clusters: defaultClusters.map((cluster) => ({ ...cluster })),
        bastions: defaultBastions.map((bastion) => ({ ...bastion })),
        namespaces: defaultNamespaces.map((namespace) => ({ ...namespace })),
        resources: defaultResources.map((resource) => ({ ...resource })),
        importContexts: defaultImportContexts.map((context) => ({ ...context }))
      }
    : {
        contexts: [] as KubernetesContextInfo[],
        clusters: [] as KubernetesClusterRecord[],
        bastions: [] as KubernetesBastionGroup[],
        namespaces: [] as KubernetesNamespaceInfo[],
        resources: [] as KubernetesResource[],
        importContexts: [] as KubernetesImportContextInfo[]
      }

const applyInitialKubernetesState = () => {
  const state = initialKubernetesState()
  contexts = state.contexts
  clusters = state.clusters
  bastions = state.bastions
  namespaces = state.namespaces
  resources = state.resources
  importContexts = state.importContexts
}

let contexts: KubernetesContextInfo[] = []
let clusters: KubernetesClusterRecord[] = []
let bastions: KubernetesBastionGroup[] = []
let namespaces: KubernetesNamespaceInfo[] = []
let resources: KubernetesResource[] = []
let importContexts: KubernetesImportContextInfo[] = []
let terminalSessions: KubernetesTerminalRecord[] = []
let agentProxyConfigCache: KubernetesAgentProxyConfig | null = null
let kubernetesCatalogLoadedStateDir = ''
let kubernetesCatalogStateLoaded = false
let kubernetesTerminalEventSink: ((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => void) | null = null

applyInitialKubernetesState()

const cloneAgentProxyConfig = (config: KubernetesAgentProxyConfig): KubernetesAgentProxyConfig => ({ ...config })

const agentProxyConfigPath = () => join(runtimeConfig.stateDir, 'agent-proxy.json')

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback

const numberInRange = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

const normalizeAgentProxyConfig = (
  input: unknown,
  base: KubernetesAgentProxyConfig = defaultAgentProxyConfig
): { config: KubernetesAgentProxyConfig; changed: boolean } => {
  const source = isRecord(input) ? input : {}
  const enabled = typeof source.enabled === 'boolean' ? source.enabled : base.enabled
  const enableProxyIdentity = typeof source.enableProxyIdentity === 'boolean' ? source.enableProxyIdentity : base.enableProxyIdentity
  const config: KubernetesAgentProxyConfig = {
    enabled,
    type: stringFromOptions(source.type, kubernetesProxyTypes, base.type),
    host: typeof source.host === 'string' ? source.host.trim() : base.host,
    port: numberInRange(source.port, base.port, 1, 65535),
    enableProxyIdentity,
    username: enableProxyIdentity && typeof source.username === 'string' ? source.username : '',
    password: enableProxyIdentity && typeof source.password === 'string' ? source.password : '',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : base.updatedAt
  }
  const allowedKeys = new Set(['enabled', 'type', 'host', 'port', 'enableProxyIdentity', 'username', 'password', 'updatedAt'])
  const changed =
    !isRecord(input) ||
    source.enabled !== config.enabled ||
    source.type !== config.type ||
    source.host !== config.host ||
    source.port !== config.port ||
    source.enableProxyIdentity !== config.enableProxyIdentity ||
    source.username !== config.username ||
    source.password !== config.password ||
    source.updatedAt !== config.updatedAt ||
    Object.keys(source).some((key) => !allowedKeys.has(key))

  return { config, changed }
}

const validateAgentProxyConfig = (config: KubernetesAgentProxyConfig) => {
  if (!config.enabled) return
  if (!config.host.trim()) {
    throw Object.assign(new Error('Kubernetes Agent proxy host is required.'), { code: 'K8S_AGENT_PROXY_HOST_REQUIRED' })
  }
  if (config.port < 1 || config.port > 65535) {
    throw Object.assign(new Error('Kubernetes Agent proxy port must be between 1 and 65535.'), { code: 'K8S_AGENT_PROXY_PORT_INVALID' })
  }
  if (!config.enableProxyIdentity) return
  if (config.type === 'SOCKS4' && !config.username.trim()) {
    throw Object.assign(new Error('SOCKS4 proxy authentication requires username.'), { code: 'K8S_AGENT_PROXY_USERNAME_REQUIRED' })
  }
  if (config.type !== 'SOCKS4' && (!config.username.trim() || !config.password)) {
    throw Object.assign(new Error('Proxy authentication requires username and password.'), { code: 'K8S_AGENT_PROXY_CREDENTIALS_REQUIRED' })
  }
}

const loadAgentProxyConfig = (): KubernetesAgentProxyConfig => {
  if (agentProxyConfigCache) return cloneAgentProxyConfig(agentProxyConfigCache)
  try {
    const filePath = agentProxyConfigPath()
    if (!existsSync(filePath)) {
      agentProxyConfigCache = { ...defaultAgentProxyConfig }
      return cloneAgentProxyConfig(agentProxyConfigCache)
    }
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const { config } = normalizeAgentProxyConfig(parsed)
    validateAgentProxyConfig(config)
    agentProxyConfigCache = config
    return cloneAgentProxyConfig(agentProxyConfigCache)
  } catch {
    agentProxyConfigCache = { ...defaultAgentProxyConfig }
    return cloneAgentProxyConfig(agentProxyConfigCache)
  }
}

const writeAgentProxyConfig = (config: KubernetesAgentProxyConfig) => {
  mkdirSync(runtimeConfig.stateDir, { recursive: true })
  writeFileSync(agentProxyConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
  agentProxyConfigCache = cloneAgentProxyConfig(config)
}

const kubernetesCatalogStatePath = () => join(runtimeConfig.stateDir, 'catalog.json')

const applyKubernetesPersistedState = (state: KubernetesPersistedCatalogState) => {
  contexts = state.contexts.map((context) => ({ ...context }))
  clusters = state.clusters.map((cluster) => ({ ...cluster }))
  bastions = state.bastions.map((bastion) => ({ ...bastion }))
  namespaces = state.namespaces.map((namespace) => ({ ...namespace }))
  resources = state.resources.map((resource) => ({ ...resource }))
  importContexts = state.importContexts.map((context) => ({ ...context }))
}

const idPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'

const expandHomePath = (value: string) => {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

const kubectlRuntimeState = () => ({
  clusters,
  namespaces,
  resources
})

const kubectlRuntimeOptions = () => ({
  state: kubectlRuntimeState,
  shouldUseSeedData: shouldUseKubernetesSeedData,
  developmentSeedClusterIds,
  expandHomePath,
  loadAgentProxyConfig
})

const canRunLocalKubectl = createCanRunLocalKubectl({
  shouldUseSeedData: shouldUseKubernetesSeedData,
  developmentSeedClusterIds
})

const nonRunnableKubernetesReason = createNonRunnableKubernetesReason({
  shouldUseSeedData: shouldUseKubernetesSeedData,
  developmentSeedClusterIds
})

const discoveredKubeconfigClusterId = (contextName: string) => `k8s-local-${idPart(contextName)}`

const discoverDefaultKubeconfigState = (): Pick<KubernetesPersistedCatalogState, 'contexts' | 'clusters' | 'importContexts'> | null => {
  if (shouldUseKubernetesSeedData()) return null
  const configuredPath = runtimeConfig.defaultKubeconfigPath?.trim() || ''
  if (!configuredPath) return null
  const kubeconfigPath = expandHomePath(configuredPath)
  if (!existsSync(kubeconfigPath)) return null
  try {
    const content = readFileSync(kubeconfigPath, 'utf-8')
    const parsed = parseKubeconfig(content)
    if (!parsed.contexts.length) return null
    const discoveredContexts = parsed.contexts.map((context) => ({
      name: context.name,
      cluster: context.cluster,
      namespace: context.namespace,
      server: context.server,
      isActive: Boolean(parsed.currentContext && context.name === parsed.currentContext)
    }))
    const discoveredClusters = parsed.contexts.map((context) => ({
      id: discoveredKubeconfigClusterId(context.name),
      name: context.cluster || context.name,
      kubeconfig_path: kubeconfigPath,
      kubeconfig_content: null,
      context_name: context.name,
      server_url: context.server,
      auth_type: 'kubeconfig',
      is_active: parsed.currentContext && context.name === parsed.currentContext ? 1 : 0,
      connection_status: 'disconnected' as const,
      auto_connect: 0,
      default_namespace: context.namespace || 'default',
      created_at: nowLabel(),
      updated_at: nowLabel(),
      source_type: 'local' as const,
      bastion_uuid: null,
      bastion_asset_address: null,
      bastion_asset_name: null,
      bastion_asset_id_last: null
    }))
    return {
      contexts: discoveredContexts,
      clusters: discoveredClusters,
      importContexts: parsed.contexts.map((context) => ({ ...context }))
    }
  } catch {
    return null
  }
}

const ensureKubernetesCatalogStateLoaded = () => {
  if (kubernetesCatalogStateLoaded && kubernetesCatalogLoadedStateDir === runtimeConfig.stateDir) return
  kubernetesCatalogStateLoaded = true
  kubernetesCatalogLoadedStateDir = runtimeConfig.stateDir
  applyInitialKubernetesState()
  const filePath = kubernetesCatalogStatePath()
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
      const state = normalizePersistedKubernetesState(parsed, { nowLabel, shouldUseSeedData: shouldUseKubernetesSeedData })
      if (state) {
        applyKubernetesPersistedState(state)
        if (!shouldUseKubernetesSeedData()) persistKubernetesCatalogState()
        return
      }
    } catch {
      /* Keep the seed or empty catalog when local Kubernetes state is corrupt. */
    }
  }
  const discovered = discoverDefaultKubeconfigState()
  if (discovered) {
    contexts = discovered.contexts
    clusters = discovered.clusters
    importContexts = discovered.importContexts
  }
}

const persistKubernetesCatalogState = () => {
  ensureKubernetesCatalogStateLoaded()
  const state: KubernetesPersistedCatalogState = {
    version: 1,
    contexts: contexts.map((context) => ({ ...context })),
    clusters: clusters.map((cluster) => ({ ...cluster })),
    bastions: bastions.map((bastion) => ({ ...bastion })),
    namespaces: namespaces.map((namespace) => ({ ...namespace })),
    resources: resources.map((resource) => ({ ...resource })),
    importContexts: importContexts.map((context) => ({ ...context }))
  }
  try {
    mkdirSync(runtimeConfig.stateDir, { recursive: true })
    const filePath = kubernetesCatalogStatePath()
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tempPath, filePath)
  } catch {
    /* Persistence must not turn a successful Kubernetes API action into a UI failure. */
  }
}

export const configureKubernetesBackendRuntime = (config: KubernetesBackendRuntimeConfig = {}) => {
  runtimeConfig = {
    stateDir: config.stateDir ? (isAbsolute(config.stateDir) ? config.stateDir : resolve(config.stateDir)) : defaultKubernetesStateDir(),
    useSeedData: config.useSeedData ?? defaultKubernetesSeedMode(),
    defaultKubeconfigPath:
      config.defaultKubeconfigPath === null
        ? ''
        : config.defaultKubeconfigPath
          ? isAbsolute(expandHomePath(config.defaultKubeconfigPath))
            ? expandHomePath(config.defaultKubeconfigPath)
            : resolve(expandHomePath(config.defaultKubeconfigPath))
          : join(homedir(), '.kube', 'config'),
    refreshOrganizationAssets:
      config.refreshOrganizationAssets ||
      (() => {
        throw jumpserverKubernetesSyncUnavailableError()
      })
  }
  agentProxyConfigCache = null
  terminalSessions = []
  kubernetesCatalogLoadedStateDir = ''
  kubernetesCatalogStateLoaded = false
  applyInitialKubernetesState()
}

const cloneCatalog = (): KubernetesCatalog => {
  ensureKubernetesCatalogStateLoaded()
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
    selectedClusterId: activeCluster?.id || clusters[0]?.id || null,
    agentProxyConfig: loadAgentProxyConfig()
  }
}

const toMutationError = <T>(error: unknown, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode
  return {
    ok: false,
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error)
  }
}

const asResult = <T>(fn: () => T, fallbackCode = 'K8S_BACKEND_ERROR'): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return toMutationError(error, fallbackCode)
  }
}

const requireCluster = (id: string) => {
  ensureKubernetesCatalogStateLoaded()
  const cluster = clusters.find((item) => item.id === id)
  if (!cluster) throw Object.assign(new Error('Kubernetes cluster not found.'), { code: 'K8S_CLUSTER_NOT_FOUND' })
  return cluster
}

const requireResource = (id: string) => {
  ensureKubernetesCatalogStateLoaded()
  const resource = resources.find((item) => item.id === id)
  if (!resource) throw Object.assign(new Error('Kubernetes resource not found.'), { code: 'K8S_RESOURCE_NOT_FOUND' })
  return resource
}

const normalizeResourceAction = (action: KubernetesResourceAction | undefined): KubernetesResourceAction =>
  action === 'describe' || action === 'logs' || action === 'get' ? action : 'get'

const clampTerminalDimension = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Math.round(Number(value) || fallback)
  return Math.max(min, Math.min(max, number))
}

const k8sTerminalPrompt = (namespace: string) => `[${namespace || 'default'}]$ `

const k8sTerminalSessionName = (clusterName: string, index: number) => (index <= 1 ? clusterName : `${clusterName}-${index}`)

const cloneTerminalRecord = (record: KubernetesTerminalRecord): KubernetesTerminalRecord => ({ ...record })

const findTerminalSession = (id: string) => terminalSessions.find((session) => session.id === id || session.sessionId === id)

export const setKubernetesTerminalEventSink = (sink: ((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => void) | null) => {
  kubernetesTerminalEventSink = sink
}

const emitKubernetesTerminalData = (
  session: KubernetesTerminalRecord,
  event: Omit<KubernetesTerminalDataEvent, 'id' | 'sessionId' | 'clusterId' | 'emittedAt'>
) => {
  kubernetesTerminalEventSink?.({
    id: session.id,
    sessionId: session.sessionId,
    clusterId: session.clusterId,
    emittedAt: nowLabel(),
    ...event
  })
}

const emitKubernetesTerminalExit = (
  session: KubernetesTerminalRecord,
  event: Omit<KubernetesTerminalExitEvent, 'id' | 'sessionId' | 'clusterId' | 'emittedAt'>
) => {
  kubernetesTerminalEventSink?.({
    id: session.id,
    sessionId: session.sessionId,
    clusterId: session.clusterId,
    emittedAt: nowLabel(),
    ...event
  })
}

const failKubernetesClusterTerminalSessions = (clusterId: string, error: string) => {
  terminalSessions = terminalSessions.map((session) => {
    if (session.clusterId !== clusterId || session.status === 'ended' || session.status === 'error') return session
    const failed: KubernetesTerminalRecord = {
      ...session,
      output: session.output.endsWith('\n') || !session.output ? `${session.output}${error}` : `${session.output}\n${error}`,
      status: 'error',
      updatedAt: nowLabel()
    }
    emitKubernetesTerminalExit(failed, {
      exitCode: 1,
      reason: 'error',
      error
    })
    return failed
  })
}

const markKubernetesClusterRuntimeError = (cluster: KubernetesClusterRecord, errorMessage: string) => {
  const failed: KubernetesClusterRecord = {
    ...cluster,
    is_active: 0,
    connection_status: 'error',
    updated_at: nowLabel()
  }
  clusters = clusters.map((item) => (item.id === cluster.id ? failed : item))
  contexts = contexts.map((context) => (context.name === cluster.context_name ? { ...context, isActive: false } : context))
  failKubernetesClusterTerminalSessions(cluster.id, errorMessage)
  return failed
}

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

const parseKubeconfig = (content: string) => {
  const lines = content.split(/\r?\n/)
  const parsedClusters = new Map<string, string>()
  const parsedContexts: KubernetesImportContextInfo[] = []
  const currentContext = lines.map((line) => yamlValueAfter(line, 'current-context')).find(Boolean) || ''
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

  return {
    contexts: parsedContexts.filter((context, index, list) => list.findIndex((item) => item.name === context.name) === index),
    currentContext
  }
}

const parseKubeconfigContexts = (content: string) => parseKubeconfig(content).contexts

const findKubernetesTestContext = (contextName: string): KubernetesImportContextInfo | null => {
  ensureKubernetesCatalogStateLoaded()
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

const numericAssetId = (asset: AiopsAssetRecord): number | null => {
  const rawId = [asset.id, asset.uuid].map((value) => persistedString(value)).find((value) => /^\d+$/.test(value))
  return rawId ? Number(rawId) : null
}

const assetTagSet = (asset: AiopsAssetRecord) => new Set((Array.isArray(asset.tags) ? asset.tags : []).map((tag) => tag.toLowerCase()))

const jumpserverKubernetesAssetAddress = (asset: AiopsAssetRecord) => persistedString(asset.host) || persistedString(asset.ip)

const jumpserverKubernetesAssetName = (asset: AiopsAssetRecord, address: string) =>
  persistedString(asset.title) || persistedString(asset.name) || address

const jumpserverKubernetesServerUrl = (address: string) => {
  if (/^https?:\/\//i.test(address)) return address
  if (/^\[[^\]]+\]:\d+$/.test(address) || /^[^:]+:\d+$/.test(address)) return address
  return `${address}:6443`
}

const jumpserverKubernetesClusterKey = (bastionUuid: string, address: string, name: string) => `${bastionUuid}\u0000${address}\u0000${name}`

const jumpserverKubernetesClusterId = (bastionUuid: string, asset: AiopsAssetRecord, address: string, name: string) => {
  const identity = persistedString(asset.uuid) || persistedString(asset.id) || `${address}-${name}`
  const base = `k8s-js-${idPart(bastionUuid)}-${idPart(identity)}`
  let candidate = base
  let sequence = 2
  const existingIds = new Set(clusters.map((cluster) => cluster.id))
  while (existingIds.has(candidate)) {
    candidate = `${base}-${sequence}`
    sequence += 1
  }
  return candidate
}

const isJumpserverKubernetesAsset = (asset: AiopsAssetRecord, organizationIds: Set<string>) => {
  if (asset.asset_type === 'organization' || asset.isLocalShell) return false
  const address = jumpserverKubernetesAssetAddress(asset)
  if (!address) return false
  const tags = assetTagSet(asset)
  const belongsToBastion = organizationIds.has(persistedString(asset.organizationId))
  const backendSyncedAsset =
    asset.data_source === 'refresh' || tags.has('jumpserver') || tags.has('synced') || tags.has('k8s') || tags.has('kubernetes')
  return belongsToBastion && backendSyncedAsset
}

const requireJumpserverKubernetesAssetsFromRefresh = async (bastion: KubernetesBastionGroup): Promise<AiopsAssetRecord[]> => {
  const result = await runtimeConfig.refreshOrganizationAssets({ organizationId: bastion.uuid })
  if (!result || result.ok !== true || !result.data) {
    const error = Object.assign(new Error(result?.errorMessage || 'JumpServer Kubernetes asset refresh failed.'), {
      code: result?.errorCode || 'K8S_BASTION_SYNC_FAILED'
    })
    throw error
  }
  const data = result.data
  if (
    !Array.isArray(data.assets) ||
    !Array.isArray(data.folders) ||
    !Number.isFinite(data.refreshed) ||
    !Number.isFinite(data.created) ||
    !Number.isFinite(data.updated)
  ) {
    throw Object.assign(new Error('JumpServer Kubernetes asset refresh returned an invalid asset snapshot.'), {
      code: 'K8S_BASTION_SYNC_INVALID'
    })
  }
  const organizationRows = data.assets.filter(
    (asset) =>
      asset.asset_type === 'organization' &&
      (asset.id === bastion.uuid || asset.uuid === bastion.uuid) &&
      (!data.organizationId || asset.id === data.organizationId || asset.uuid === data.organizationId)
  )
  const organizationIds = new Set(
    [bastion.uuid, data.organizationId, ...organizationRows.flatMap((asset) => [asset.id, asset.uuid])]
      .map((value) => persistedString(value))
      .filter(Boolean)
  )
  if (data.organizationId && data.organizationId !== bastion.uuid && organizationRows.length === 0) {
    throw Object.assign(new Error('JumpServer Kubernetes asset refresh returned a different organization.'), {
      code: 'K8S_BASTION_SYNC_MISMATCH'
    })
  }
  return data.assets.filter((asset) => isJumpserverKubernetesAsset(asset, organizationIds))
}

const upsertJumpserverKubernetesClusters = (bastion: KubernetesBastionGroup, assets: AiopsAssetRecord[]) => {
  const updates = new Map<string, KubernetesClusterRecord>()
  const inserted: KubernetesClusterRecord[] = []
  const seenKeys = new Set<string>()
  let syncedCount = 0
  let updatedCount = 0

  const existingByKey = new Map<string, KubernetesClusterRecord>()
  clusters
    .filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastion.uuid)
    .forEach((cluster) => {
      if (!cluster.bastion_asset_address || !cluster.bastion_asset_name) return
      existingByKey.set(jumpserverKubernetesClusterKey(bastion.uuid, cluster.bastion_asset_address, cluster.bastion_asset_name), cluster)
    })

  assets.forEach((asset) => {
    const address = jumpserverKubernetesAssetAddress(asset)
    if (!address) return
    const name = jumpserverKubernetesAssetName(asset, address)
    const key = jumpserverKubernetesClusterKey(bastion.uuid, address, name)
    if (seenKeys.has(key)) return
    seenKeys.add(key)

    const existing = existingByKey.get(key)
    if (existing) {
      const next: KubernetesClusterRecord = {
        ...existing,
        name,
        context_name: name,
        server_url: jumpserverKubernetesServerUrl(address),
        auth_type: 'jumpserver',
        default_namespace: existing.default_namespace || 'default',
        source_type: 'jumpserver',
        bastion_uuid: bastion.uuid,
        bastion_asset_address: address,
        bastion_asset_name: name,
        bastion_asset_id_last: numericAssetId(asset),
        updated_at: nowLabel()
      }
      updates.set(existing.id, next)
      upsertContextForCluster(next)
      updatedCount += 1
      return
    }

    const cluster: KubernetesClusterRecord = {
      id: jumpserverKubernetesClusterId(bastion.uuid, asset, address, name),
      name,
      kubeconfig_path: null,
      kubeconfig_content: null,
      context_name: name,
      server_url: jumpserverKubernetesServerUrl(address),
      auth_type: 'jumpserver',
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: 'default',
      created_at: nowLabel(),
      updated_at: nowLabel(),
      source_type: 'jumpserver',
      bastion_uuid: bastion.uuid,
      bastion_asset_address: address,
      bastion_asset_name: name,
      bastion_asset_id_last: numericAssetId(asset)
    }
    inserted.push(cluster)
    upsertContextForCluster(cluster, false)
    syncedCount += 1
  })

  if (inserted.length || updates.size) {
    clusters = [...inserted, ...clusters.map((cluster) => updates.get(cluster.id) || cluster)]
    persistKubernetesCatalogState()
  }

  return { syncedCount, updatedCount }
}

export const listKubernetesCatalog = async (): Promise<KubernetesCatalogResult> => asResult(() => cloneCatalog())

export const getKubernetesAgentProxyConfig = async (): Promise<KubernetesAgentProxyConfigResult> =>
  asResult(() => ({
    proxyConfig: loadAgentProxyConfig(),
    message: 'Kubernetes Agent proxy configuration loaded.'
  }))

export const saveKubernetesAgentProxyConfig = async (input: KubernetesAgentProxyConfigInput): Promise<KubernetesAgentProxyConfigResult> =>
  asResult(() => {
    const current = loadAgentProxyConfig()
    const { config } = normalizeAgentProxyConfig(
      {
        ...current,
        ...(isRecord(input) ? input : {}),
        updatedAt: nowLabel()
      },
      current
    )
    validateAgentProxyConfig(config)
    writeAgentProxyConfig(config)
    return {
      proxyConfig: cloneAgentProxyConfig(config),
      message: config.enabled ? 'Kubernetes Agent proxy configuration saved.' : 'Kubernetes Agent proxy disabled.'
    }
  }, 'K8S_AGENT_PROXY_SAVE_FAILED')

export const switchKubernetesContext = async (contextName: string): Promise<KubernetesContextSwitchResult> =>
  asResult(() => {
    ensureKubernetesCatalogStateLoaded()
    const name = contextName.trim()
    const context = contexts.find((item) => item.name === name)
    if (!context) throw Object.assign(new Error('Kubernetes context not found.'), { code: 'K8S_CONTEXT_NOT_FOUND' })
    contexts = contexts.map((item) => ({ ...item, isActive: item.name === name }))
    const cluster = clusters.find((item) => item.context_name === name)
    if (cluster) {
      clusters = clusters.map((item) => ({ ...item, is_active: item.id === cluster.id ? 1 : 0 }))
    }
    persistKubernetesCatalogState()
    return {
      ...cloneCatalog(),
      currentContext: name
    }
  })

export async function testKubernetesClusterConnection(input: KubernetesClusterTestInput): Promise<KubernetesClusterTestResult> {
  try {
    ensureKubernetesCatalogStateLoaded()
    const contextName = input.contextName?.trim() || ''
    const requestedServerUrl = input.serverUrl?.trim() || ''
    if (!contextName) {
      throw Object.assign(new Error('Kubernetes context is required.'), { code: 'K8S_TEST_CONTEXT_REQUIRED' })
    }

    const existingCluster = clusters.find((item) => item.context_name === contextName)
    const canUseExistingClusterKubeconfig = Boolean(existingCluster && !(shouldUseKubernetesSeedData() && developmentSeedClusterIds.has(existingCluster.id)))
    const content = input.kubeconfigContent?.trim() || (canUseExistingClusterKubeconfig ? existingCluster?.kubeconfig_content?.trim() || '' : '')
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

    const kubeconfigPath = input.kubeconfigPath?.trim() || (canUseExistingClusterKubeconfig ? existingCluster?.kubeconfig_path?.trim() || '' : '')
    const defaultNamespace = context?.namespace || 'default'
    if (!content && !kubeconfigPath && shouldUseKubernetesSeedData() && context) {
      return {
        ok: true,
        data: {
          success: true,
          isValid: true,
          contextName,
          serverUrl,
          message: '连接测试成功'
        }
      }
    }

    const probeCluster: KubernetesClusterRecord = {
      id: `k8s-test-${randomUUID()}`,
      name: context?.cluster || contextName,
      kubeconfig_path: kubeconfigPath || null,
      kubeconfig_content: content || null,
      context_name: contextName,
      server_url: serverUrl,
      auth_type: 'kubeconfig',
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: defaultNamespace,
      created_at: nowLabel(),
      updated_at: nowLabel(),
      source_type: 'local',
      bastion_uuid: null,
      bastion_asset_address: null,
      bastion_asset_name: null,
      bastion_asset_id_last: null
    }
    const probe = await probeKubernetesClusterConnection(probeCluster, kubectlRuntimeOptions())
    return {
      ok: true,
      data: probe
    }
  } catch (error) {
    return toMutationError(error, 'K8S_TEST_FAILED')
  }
}

export async function importKubernetesKubeconfig(input: KubernetesKubeconfigImportInput): Promise<KubernetesKubeconfigImportResult> {
  try {
    ensureKubernetesCatalogStateLoaded()
    const requestId = input.requestId?.trim() || ''
    const kubeconfigPath = input.kubeconfigPath?.trim() || ''
    const providedContent = input.kubeconfigContent ?? ''
    if (!kubeconfigPath && !providedContent.trim()) {
      return { ok: false, errorCode: 'K8S_KUBECONFIG_REQUIRED', errorMessage: 'Kubeconfig path or content is required.' }
    }
    let kubeconfigContent = providedContent
    if (!kubeconfigContent.trim()) {
      try {
        kubeconfigContent = await readFile(kubeconfigPath, 'utf-8')
      } catch (error) {
        return {
          ok: false,
          errorCode: 'K8S_KUBECONFIG_READ_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      }
    }
    const parsed = parseKubeconfig(kubeconfigContent)
    if (!parsed.contexts.length) {
      return { ok: false, errorCode: 'K8S_KUBECONFIG_CONTEXTS_EMPTY', errorMessage: 'No kubeconfig contexts were found.' }
    }
    importContexts = parsed.contexts.map((context) => ({ ...context }))
    persistKubernetesCatalogState()
    return {
      ok: true,
      data: {
        requestId,
        contexts: parsed.contexts.map((context) => ({ ...context })),
        kubeconfigPath,
        kubeconfigContent,
        currentContext: parsed.currentContext
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'K8S_KUBECONFIG_IMPORT_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

export const addKubernetesCluster = async (input: KubernetesClusterInput): Promise<KubernetesClusterMutationResult> =>
  asResult(() => {
    ensureKubernetesCatalogStateLoaded()
    const name = input.name.trim()
    const contextName = input.contextName.trim()
    const serverUrl = input.serverUrl.trim()
    if (!name || !contextName || !serverUrl) {
      throw Object.assign(new Error('Cluster name, context and server URL are required.'), { code: 'K8S_CLUSTER_REQUIRED' })
    }
    requireRunnableKubernetesClusterInput({
      name,
      contextName,
      serverUrl,
      sourceType: input.sourceType,
      authType: input.authType,
      kubeconfigPath: input.kubeconfigPath,
      kubeconfigContent: input.kubeconfigContent
    })
    const cluster: KubernetesClusterRecord = {
      id: `k8s-${randomUUID()}`,
      name,
      kubeconfig_path: input.kubeconfigPath?.trim() || null,
      kubeconfig_content: input.kubeconfigContent?.trim() || null,
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
    persistKubernetesCatalogState()
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
    persistKubernetesCatalogState()
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
    persistKubernetesCatalogState()
    return cloneCatalog()
  })

export async function connectKubernetesCluster(id: string): Promise<KubernetesClusterMutationResult> {
  try {
    const current = requireCluster(id)
    const nonRunnableReason = canRunLocalKubectl(current) ? null : nonRunnableKubernetesReason(current)
    if (nonRunnableReason) {
      const failed = markKubernetesClusterRuntimeError(current, nonRunnableReason.message)
      persistKubernetesCatalogState()
      return {
        ok: false,
        data: {
          ...cloneCatalog(),
          cluster: { ...failed }
        },
        errorCode: nonRunnableReason.code,
        errorMessage: nonRunnableReason.message
      }
    }
    if (!(shouldUseKubernetesSeedData() && developmentSeedClusterIds.has(current.id))) {
      const probe = await probeKubernetesClusterConnection(current, kubectlRuntimeOptions())
      if (!probe.success) {
        const errorMessage = probe.error || probe.message || 'Kubernetes connection probe failed.'
        const failed = markKubernetesClusterRuntimeError(current, errorMessage)
        persistKubernetesCatalogState()
        return {
          ok: false,
          data: {
            ...cloneCatalog(),
            cluster: { ...failed }
          },
          errorCode: 'K8S_CONNECT_PROBE_FAILED',
          errorMessage
        }
      }
    }
    clusters = clusters.map((cluster) => ({
      ...cluster,
      is_active: cluster.id === id ? 1 : 0,
      connection_status: cluster.id === id ? 'connected' : cluster.connection_status === 'connected' ? 'disconnected' : cluster.connection_status,
      updated_at: cluster.id === id ? nowLabel() : cluster.updated_at
    }))
    terminalSessions = terminalSessions.map((session) =>
      session.clusterId === id && session.status === 'connecting'
        ? {
            ...session,
            status: 'connected',
            updatedAt: nowLabel()
          }
        : session
    )
    contexts = contexts.map((context) => ({ ...context, isActive: context.name === current.context_name }))
    const connected = requireCluster(id)
    persistKubernetesCatalogState()
    return {
      ok: true,
      data: {
        ...cloneCatalog(),
        cluster: { ...connected }
      }
    }
  } catch (error) {
    return toMutationError(error, 'K8S_CONNECT_FAILED')
  }
}

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
    persistKubernetesCatalogState()
    return {
      ...cloneCatalog(),
      cluster: { ...next }
    }
  })

export const syncKubernetesBastion = async (bastionUuid: string): Promise<KubernetesBastionSyncResult> => {
  try {
    ensureKubernetesCatalogStateLoaded()
    const bastion = bastions.find((item) => item.uuid === bastionUuid)
    if (!bastion) throw Object.assign(new Error('Kubernetes bastion not found.'), { code: 'K8S_BASTION_NOT_FOUND' })
    if (!shouldUseKubernetesSeedData()) {
      const assets = await requireJumpserverKubernetesAssetsFromRefresh(bastion)
      const { syncedCount, updatedCount } = upsertJumpserverKubernetesClusters(bastion, assets)
      return {
        ok: true,
        data: {
          ...cloneCatalog(),
          syncedCount,
          updatedCount
        }
      }
    }
    const existing = clusters.filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid)
    if (existing.length) {
      clusters = clusters.map((cluster) =>
        cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid ? { ...cluster, updated_at: nowLabel() } : cluster
      )
      persistKubernetesCatalogState()
      return {
        ok: true,
        data: {
          ...cloneCatalog(),
          syncedCount: 0,
          updatedCount: existing.length
        }
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
    persistKubernetesCatalogState()
    return {
      ok: true,
      data: {
        ...cloneCatalog(),
        syncedCount: 1,
        updatedCount: 0
      }
    }
  } catch (error) {
    return toMutationError(error)
  }
}

export const createKubernetesTerminal = async (input: KubernetesTerminalCreateInput): Promise<KubernetesTerminalCreateResult> =>
  asResult(() => {
    const cluster = requireCluster(input.clusterId)
    const nonRunnableReason = canRunLocalKubectl(cluster) ? null : nonRunnableKubernetesReason(cluster)
    if (nonRunnableReason) {
      markKubernetesClusterRuntimeError(cluster, nonRunnableReason.message)
      persistKubernetesCatalogState()
      throw Object.assign(new Error(nonRunnableReason.message), { code: nonRunnableReason.code })
    }
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

export async function writeKubernetesTerminal(id: string, data: string): Promise<KubernetesTerminalWriteResult> {
  try {
    ensureKubernetesCatalogStateLoaded()
    const current = findTerminalSession(id)
    if (!current) throw Object.assign(new Error('Kubernetes terminal session not found.'), { code: 'K8S_TERMINAL_NOT_FOUND' })
    if (current.status === 'ended') throw Object.assign(new Error('Kubernetes terminal session has ended.'), { code: 'K8S_TERMINAL_ENDED' })
    if (current.status !== 'connected') {
      throw Object.assign(new Error('Kubernetes terminal is not connected.'), { code: 'K8S_TERMINAL_NOT_CONNECTED' })
    }
    const text = typeof data === 'string' ? data : ''
    const command = normalizeKubernetesCommand(text)
    const bytes = Buffer.byteLength(text, 'utf-8')
    if (!command) {
      return {
        ok: false,
        errorCode: 'K8S_EMPTY_COMMAND',
        errorMessage: 'Kubernetes command is required.'
      }
    }
    const cluster = requireCluster(current.clusterId)
    const result = await executeKubernetesCommand({
      command,
      clusterId: current.clusterId,
      clusterName: cluster.name,
      contextName: cluster.context_name,
      namespace: current.namespace,
      defaultNamespace: cluster.default_namespace,
      source: 'terminal'
    })
    if (!result.ok || !result.data) {
      return {
        ok: false,
        errorCode: result.errorCode || 'K8S_TERMINAL_WRITE_FAILED',
        errorMessage: result.errorMessage || 'Kubernetes terminal command failed.'
      }
    }
    const terminalOutput = result.data.terminalOutput
    const updated: KubernetesTerminalRecord = {
      ...current,
      output: terminalOutput ? (current.output.endsWith('\n') || !current.output ? `${current.output}${terminalOutput}` : `${current.output}\n${terminalOutput}`) : current.output,
      status: current.status,
      updatedAt: nowLabel()
    }
    terminalSessions = terminalSessions.map((session) => (session.id === current.id ? updated : session))
    emitKubernetesTerminalData(updated, {
      data: terminalOutput,
      command,
      output: result.data.output,
      success: result.data.success,
      error: result.data.error
    })
    return {
      ok: true,
      data: {
        id: updated.id,
        sessionId: updated.sessionId,
        bytes,
        command,
        output: result.data.output,
        success: result.data.success,
        error: result.data.error,
        terminalOutput,
        updatedAt: updated.updatedAt
      }
    }
  } catch (error) {
    return toMutationError(error, 'K8S_TERMINAL_WRITE_FAILED')
  }
}

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
    emitKubernetesTerminalExit(current, {
      exitCode,
      reason: 'closed'
    })
    return { ...closed }
  })

export const __resetKubernetesCatalogForTests = () => {
  applyInitialKubernetesState()
  terminalSessions = []
  agentProxyConfigCache = null
  kubernetesTerminalEventSink = null
  kubernetesCatalogLoadedStateDir = ''
  kubernetesCatalogStateLoaded = false
}

const filterResourcesOutsideRefreshScope = (clusterId: string, kind: KubernetesResourceKind, namespace: string) =>
  resources.filter((resource) => {
    if (resource.clusterId !== clusterId || resource.kind !== kind) return true
    if (kind === 'nodes' || namespace === 'all') return false
    return resource.namespace !== namespace
  })

const resourcesInRefreshScope = (clusterId: string, kind: KubernetesResourceKind, namespace: string) =>
  resources.filter((resource) => {
    if (resource.clusterId !== clusterId || resource.kind !== kind) return false
    return kind === 'nodes' || namespace === 'all' || resource.namespace === namespace
  })

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
  ensureKubernetesCatalogStateLoaded()
  const startedAt = Date.now()
  const command = normalizeKubernetesCommand(input.command)
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

  const cluster = clusters.find((item) => item.id === input.clusterId)
  if (!cluster) {
    if (input.source === 'agent') {
      return {
        ok: true,
        data: createKubernetesCommandRun(input, command, '', false, startedAt, 'Kubernetes cluster not found.')
      }
    }
    return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
  }

  if (canRunLocalKubectl(cluster)) {
    const namespace = input.namespace || cluster.default_namespace || input.defaultNamespace || 'default'
    const result = await runLocalKubectl(cluster, command, namespace, kubectlRuntimeOptions())
    const output = result.output || result.error
    return {
      ok: true,
      data: {
        ...createKubernetesCommandRun(input, command, output, result.success, startedAt, result.error),
        terminalOutput: renderTerminalCommandOutput(command, output, result.error)
      }
    }
  }

  const nonRunnableReason = nonRunnableKubernetesReason(cluster)
  if (nonRunnableReason) {
    if (input.source !== 'agent') {
      return {
        ok: false,
        errorCode: nonRunnableReason.code,
        errorMessage: nonRunnableReason.message
      }
    }
    return {
      ok: true,
      data: {
        ...createKubernetesCommandRun(input, command, nonRunnableReason.message, false, startedAt, nonRunnableReason.message),
        terminalOutput: renderTerminalCommandOutput(command, nonRunnableReason.message, nonRunnableReason.message)
      }
    }
  }

  const seedResult = renderSeedCommand({ ...input, command }, kubectlRuntimeState())
  return {
    ok: true,
    data: {
      ...createKubernetesCommandRun(input, command, seedResult.output, seedResult.success, startedAt, seedResult.error),
      terminalOutput: renderTerminalCommandOutput(command, seedResult.output, seedResult.error)
    }
  }
}

export async function planKubernetesResourceAction(input: KubernetesResourceActionInput): Promise<KubernetesResourceActionPlanResult> {
  return asResult(() => {
    const resourceId = input.resourceId?.trim() || ''
    if (!resourceId) throw Object.assign(new Error('Kubernetes resource is required.'), { code: 'K8S_RESOURCE_REQUIRED' })
    const resource = requireResource(resourceId)
    const cluster = requireCluster(resource.clusterId)
    const action = normalizeResourceAction(input.action)
    if (action === 'logs' && resource.kind !== 'pods') {
      throw Object.assign(new Error('Kubernetes logs are only available for pods.'), { code: 'K8S_RESOURCE_LOGS_POD_REQUIRED' })
    }
    const namespace = resource.kind === 'nodes' ? 'all' : resource.namespace
    return {
      resourceId: resource.id,
      resourceName: resource.name,
      resourceKind: resource.kind,
      action,
      title: `${resourceActionTitlePrefix[action]} ${resource.name}`,
      command: buildKubernetesResourceActionCommand(resource, action),
      clusterId: cluster.id,
      clusterName: cluster.name,
      contextName: cluster.context_name,
      namespace
    }
  }, 'K8S_RESOURCE_ACTION_PLAN_FAILED')
}

export async function executeKubernetesResourceAction(input: KubernetesResourceActionInput): Promise<KubernetesResourceActionExecuteResult> {
  const planned = await planKubernetesResourceAction(input)
  if (!planned.ok || !planned.data) {
    return {
      ok: false,
      errorCode: planned.errorCode || 'K8S_RESOURCE_ACTION_PLAN_FAILED',
      errorMessage: planned.errorMessage || 'Kubernetes resource action could not be planned.'
    }
  }
  const plan = planned.data
  const result = await executeKubernetesCommand({
    command: plan.command,
    clusterId: plan.clusterId,
    clusterName: plan.clusterName,
    contextName: plan.contextName,
    namespace: plan.namespace,
    source: 'resource'
  })
  if (!result.ok || !result.data) {
    return {
      ok: false,
      errorCode: result.errorCode || 'K8S_RESOURCE_ACTION_EXECUTE_FAILED',
      errorMessage: result.errorMessage || 'Kubernetes resource action failed.'
    }
  }
  return {
    ok: true,
    data: {
      ...result.data,
      resourceId: plan.resourceId,
      resourceName: plan.resourceName,
      resourceKind: plan.resourceKind,
      action: plan.action,
      title: plan.title
    }
  }
}

export async function refreshKubernetesResources(input: KubernetesResourceRefreshInput): Promise<KubernetesResourceRefreshResult> {
  ensureKubernetesCatalogStateLoaded()
  const startedAt = Date.now()
  const clusterId = input.clusterId?.trim() || ''
  const requestedKind = input.kind || 'all'
  const namespace = requestedKind === 'nodes' ? 'all' : input.namespace?.trim() || 'all'
  const asRefreshResult = (
    cluster: KubernetesClusterRecord | null,
    command: string,
    output: string,
    success: boolean,
    error: string,
    refreshedResources: number,
    refreshedNamespaces: number,
    message: string,
    kind: KubernetesResourceKind | 'all' = requestedKind
  ): KubernetesResourceRefreshResult => {
    const data = {
      ...cloneCatalog(),
      runId: `k8s-run-${randomUUID()}`,
      refreshedClusterId: cluster?.id || clusterId,
      refreshedKind: kind,
      clusterId: cluster?.id || clusterId,
      contextName: cluster?.context_name || 'unknown-context',
      namespace,
      command,
      output,
      terminalOutput: renderTerminalCommandOutput(command, output || error, error),
      success,
      error,
      durationMs: Math.max(1, Date.now() - startedAt),
      startedAt: nowLabel(),
      source: 'resource' as const,
      refreshedResources,
      refreshedNamespaces,
      message
    }
    return { ok: true, data }
  }

  if (!clusterId) {
    return { ok: false, errorCode: 'K8S_CLUSTER_REQUIRED', errorMessage: 'Kubernetes cluster is required.' }
  }
  const cluster = clusters.find((item) => item.id === clusterId)
  if (!cluster) {
    return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
  }
  if (requestedKind !== 'all' && !allKubernetesResourceKinds.includes(requestedKind)) {
    return { ok: false, errorCode: 'K8S_RESOURCE_KIND_UNSUPPORTED', errorMessage: 'Unsupported Kubernetes resource kind.' }
  }

  if (canRunLocalKubectl(cluster)) {
    const refreshedKinds = requestedKind === 'all' ? allKubernetesResourceKinds : [requestedKind]
    const commands: string[] = []
    const outputs: string[] = []
    const parsedByKind = new Map<KubernetesResourceKind, KubernetesResource[]>()
    let parsedNamespaces: KubernetesNamespaceInfo[] | null = null

    const namespaceResult = await runLocalKubectl(cluster, 'kubectl get namespaces', cluster.default_namespace || 'default', kubectlRuntimeOptions())
    commands.push('kubectl get namespaces')
    outputs.push(namespaceResult.output || namespaceResult.error)
    if (!namespaceResult.success) {
      const output = outputs.filter(Boolean).join('\n\n')
      return asRefreshResult(cluster, commands.join(' && '), output, false, namespaceResult.error || output, 0, 0, namespaceResult.error || 'Kubernetes namespaces refresh failed.')
    }
    parsedNamespaces = parseKubectlNamespaces(cluster.id, namespaceResult.output, idPart)

    for (const kind of refreshedKinds) {
      const command = buildKubernetesGetCommand(kind, namespace)
      const result = await runLocalKubectl(cluster, command, kind === 'nodes' ? 'all' : namespace, kubectlRuntimeOptions())
      commands.push(command)
      outputs.push(result.output || result.error)
      if (!result.success) {
        const output = outputs.filter(Boolean).join('\n\n')
        return asRefreshResult(cluster, commands.join(' && '), output, false, result.error || output, 0, 0, result.error || 'Kubernetes resources refresh failed.', requestedKind)
      }
      parsedByKind.set(kind, parseKubectlResources(cluster, kind, result.output, namespace === 'all' ? cluster.default_namespace || 'default' : namespace, idPart))
    }

    namespaces = namespaces.filter((item) => item.clusterId !== cluster.id)
    namespaces = [...namespaces, ...parsedNamespaces]
    refreshedKinds.forEach((kind) => {
      const parsedResources = parsedByKind.get(kind) || []
      resources = [...filterResourcesOutsideRefreshScope(cluster.id, kind, namespace), ...parsedResources]
    })
    persistKubernetesCatalogState()
    const refreshedResources = refreshedKinds.reduce((count, kind) => count + resourcesInRefreshScope(cluster.id, kind, namespace).length, 0)
    const output = outputs.filter(Boolean).join('\n\n')
    return asRefreshResult(
      cluster,
      commands.join(' && '),
      output,
      true,
      '',
      refreshedResources,
      parsedNamespaces.length,
      `Kubernetes resources refreshed from kubectl for ${cluster.name}.`,
      requestedKind
    )
  }

  const nonRunnableReason = nonRunnableKubernetesReason(cluster)
  if (nonRunnableReason) {
    return {
      ok: false,
      errorCode: nonRunnableReason.code,
      errorMessage: nonRunnableReason.message
    }
  }

  const refreshedKinds = requestedKind === 'all' ? allKubernetesResourceKinds : [requestedKind]
  const command =
    requestedKind === 'all'
      ? ['kubectl get namespaces', ...refreshedKinds.map((kind) => buildKubernetesGetCommand(kind, namespace))].join(' && ')
      : buildKubernetesGetCommand(requestedKind, namespace)
  const outputParts =
    requestedKind === 'all'
      ? [renderSeedCommand({ command: 'kubectl get namespaces', clusterId: cluster.id, namespace: cluster.default_namespace || 'default' }, kubectlRuntimeState()).output, ...refreshedKinds.map((kind) => renderList(buildKubernetesGetCommand(kind, namespace), cluster.id, namespace, kubectlRuntimeState()))]
      : [renderList(command, cluster.id, namespace, kubectlRuntimeState())]
  const refreshedResources = refreshedKinds.reduce((count, kind) => count + resourcesInRefreshScope(cluster.id, kind, namespace).length, 0)
  const refreshedNamespaces = namespaces.filter((item) => item.clusterId === cluster.id).length
  return asRefreshResult(
    cluster,
    command,
    outputParts.filter(Boolean).join('\n\n'),
    true,
    '',
    refreshedResources,
    refreshedNamespaces,
    `Kubernetes development seed resources refreshed for ${cluster.name}.`,
    requestedKind
  )
}

export async function cleanupKubernetesAgent(): Promise<KubernetesAgentCleanupResult> {
  return asResult(() => ({
    cleared: true,
    cleanedAt: nowLabel()
  }))
}
