import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import type { AiopsOrganizationAssetRefreshResult } from './contracts/assets'
import type { AiopsMutationResult } from './contracts/common'
import type {
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
  KubernetesResourceActionExecuteResult,
  KubernetesResourceActionInput,
  KubernetesResourceActionPlanResult,
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
import { normalizePersistedKubernetesState, type KubernetesPersistedCatalogState } from './kubernetesCatalogPersistence'
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
  createCanRunLocalKubectl,
  createNonRunnableKubernetesReason
} from './kubernetesKubectlRuntime'
import { createKubernetesAgentProxyRuntime } from './kubernetesAgentProxyRuntime'
import {
  discoverDefaultKubeconfigState,
  expandHomePath,
  idPart
} from './kubernetesKubeconfigRuntime'
import {
  jumpserverKubernetesSyncUnavailableError,
  jumpserverKubernetesSyncUnavailableMessage
} from './kubernetesJumpserverRuntime'
import { createKubernetesCommandRuntime } from './kubernetesCommandRuntime'
import { createKubernetesTerminalRuntime, type KubernetesPtySpawner } from './kubernetesTerminalRuntime'
import { createKubernetesClusterRuntime } from './kubernetesClusterRuntime'
import { shouldUseKubernetesSeedData as runtimeShouldUseKubernetesSeedData } from './runtimeSwitches'

const nowLabel = () => '刚刚'

type KubernetesBackendRuntimeConfig = {
  stateDir?: string
  useSeedData?: boolean
  defaultKubeconfigPath?: string | null
  refreshOrganizationAssets?: (input: { organizationId?: string }) => AiopsOrganizationAssetRefreshResult | Promise<AiopsOrganizationAssetRefreshResult>
  /** 测试注入用;null 时终端会话使用 node-pty 默认实现。 */
  spawnKubernetesTerminalPty?: KubernetesPtySpawner | null
}

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
  },
  spawnKubernetesTerminalPty: null
}

const shouldUseKubernetesSeedData = () => runtimeConfig.useSeedData

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
let kubernetesCatalogLoadedStateDir = ''
let kubernetesCatalogStateLoaded = false

applyInitialKubernetesState()

const agentProxyRuntime = createKubernetesAgentProxyRuntime({
  stateDir: () => runtimeConfig.stateDir,
  nowLabel
})

const loadAgentProxyConfig = () => agentProxyRuntime.load()

const kubernetesCatalogStatePath = () => join(runtimeConfig.stateDir, 'catalog.json')

const applyKubernetesPersistedState = (state: KubernetesPersistedCatalogState) => {
  contexts = state.contexts.map((context) => ({ ...context }))
  clusters = state.clusters.map((cluster) => ({ ...cluster }))
  bastions = state.bastions.map((bastion) => ({ ...bastion }))
  namespaces = state.namespaces.map((namespace) => ({ ...namespace }))
  resources = state.resources.map((resource) => ({ ...resource }))
  importContexts = state.importContexts.map((context) => ({ ...context }))
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
  const discovered = discoverDefaultKubeconfigState({
    shouldUseSeedData: shouldUseKubernetesSeedData,
    defaultKubeconfigPath: () => runtimeConfig.defaultKubeconfigPath,
    nowLabel
  })
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
    // catalog.json 内含 kubeconfig 凭据(client key/token),必须与 kubeconfig 同级的 0600 权限。
    writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 })
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
      }),
    spawnKubernetesTerminalPty: config.spawnKubernetesTerminalPty || null
  }
  agentProxyRuntime.reset()
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

const commandRuntime = createKubernetesCommandRuntime({
  clusters: () => clusters,
  namespaces: () => namespaces,
  setNamespaces: (nextNamespaces) => {
    namespaces = nextNamespaces
  },
  resources: () => resources,
  setResources: (nextResources) => {
    resources = nextResources
  },
  cloneCatalog,
  kubectlRuntimeOptions,
  canRunLocalKubectl,
  nonRunnableKubernetesReason,
  nowLabel,
  idPart,
  persistCatalogState: persistKubernetesCatalogState
})

const clusterRuntime = createKubernetesClusterRuntime({
  contexts: () => contexts,
  setContexts: (nextContexts) => {
    contexts = nextContexts
  },
  clusters: () => clusters,
  setClusters: (nextClusters) => {
    clusters = nextClusters
  },
  bastions: () => bastions,
  namespaces: () => namespaces,
  setNamespaces: (nextNamespaces) => {
    namespaces = nextNamespaces
  },
  resources: () => resources,
  setResources: (nextResources) => {
    resources = nextResources
  },
  importContexts: () => importContexts,
  setImportContexts: (nextImportContexts) => {
    importContexts = nextImportContexts
  },
  activateClusterTerminalSessions: (clusterId) => terminalRuntime.activateClusterSessions(clusterId),
  disposeClusterTerminalSessions: (clusterId) => {
    terminalRuntime.disposeClusterSessions(clusterId)
  },
  ensureCatalogStateLoaded: ensureKubernetesCatalogStateLoaded,
  cloneCatalog,
  persistCatalogState: persistKubernetesCatalogState,
  shouldUseSeedData: shouldUseKubernetesSeedData,
  developmentSeedClusterIds,
  kubectlRuntimeOptions,
  canRunLocalKubectl,
  nonRunnableKubernetesReason,
  refreshOrganizationAssets: () => runtimeConfig.refreshOrganizationAssets,
  failClusterSessions: (clusterId, errorMessage) => {
    terminalRuntime.failClusterSessions(clusterId, errorMessage)
  },
  nowLabel
})

const terminalRuntime = createKubernetesTerminalRuntime({
  sessions: () => terminalSessions,
  setSessions: (sessions) => {
    terminalSessions = sessions
  },
  requireCluster: clusterRuntime.requireCluster,
  canRunLocalKubectl,
  nonRunnableKubernetesReason,
  markClusterRuntimeError: (cluster, errorMessage) => {
    clusterRuntime.markClusterRuntimeError(cluster, errorMessage)
  },
  executeKubernetesCommand: (input) => executeKubernetesCommand(input),
  expandHomePath,
  loadAgentProxyConfig,
  spawnPty: () => runtimeConfig.spawnKubernetesTerminalPty,
  persistCatalogState: persistKubernetesCatalogState,
  nowLabel
})

export const listKubernetesCatalog = async (): Promise<KubernetesCatalogResult> => asResult(() => cloneCatalog())

export const getKubernetesAgentProxyConfig = async (): Promise<KubernetesAgentProxyConfigResult> =>
  asResult(() => ({
    proxyConfig: loadAgentProxyConfig(),
    message: 'Kubernetes Agent proxy configuration loaded.'
  }))

export const saveKubernetesAgentProxyConfig = async (input: KubernetesAgentProxyConfigInput): Promise<KubernetesAgentProxyConfigResult> =>
  asResult(() => {
    const config = agentProxyRuntime.save(input)
    return {
      proxyConfig: config,
      message: config.enabled ? 'Kubernetes Agent proxy configuration saved.' : 'Kubernetes Agent proxy disabled.'
    }
  }, 'K8S_AGENT_PROXY_SAVE_FAILED')

export const switchKubernetesContext = async (contextName: string): Promise<KubernetesContextSwitchResult> =>
  clusterRuntime.switchContext(contextName)

export const testKubernetesClusterConnection = async (input: KubernetesClusterTestInput): Promise<KubernetesClusterTestResult> =>
  clusterRuntime.testClusterConnection(input)

export const importKubernetesKubeconfig = async (input: KubernetesKubeconfigImportInput): Promise<KubernetesKubeconfigImportResult> =>
  clusterRuntime.importKubeconfig(input)

export const addKubernetesCluster = async (input: KubernetesClusterInput): Promise<KubernetesClusterMutationResult> =>
  clusterRuntime.addCluster(input)

export const updateKubernetesCluster = async (id: string, input: KubernetesClusterUpdateInput): Promise<KubernetesClusterMutationResult> =>
  clusterRuntime.updateCluster(id, input)

export const deleteKubernetesCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
  clusterRuntime.deleteCluster(id)

export const connectKubernetesCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
  clusterRuntime.connectCluster(id)

export const disconnectKubernetesCluster = async (id: string): Promise<KubernetesClusterMutationResult> =>
  clusterRuntime.disconnectCluster(id)

export const syncKubernetesBastion = async (bastionUuid: string): Promise<KubernetesBastionSyncResult> =>
  clusterRuntime.syncBastion(bastionUuid)

export const createKubernetesTerminal = async (input: KubernetesTerminalCreateInput): Promise<KubernetesTerminalCreateResult> =>
  terminalRuntime.createTerminal(input)

export const writeKubernetesTerminal = async (id: string, data: string): Promise<KubernetesTerminalWriteResult> =>
  terminalRuntime.writeTerminal(id, data)

export const resizeKubernetesTerminal = async (id: string, cols: number, rows: number): Promise<KubernetesTerminalMutationResult> =>
  terminalRuntime.resizeTerminal(id, cols, rows)

export const closeKubernetesTerminal = async (id: string, exitCode = 0): Promise<KubernetesTerminalCloseResult> =>
  terminalRuntime.closeTerminal(id, exitCode)

export const setKubernetesTerminalEventSink = (sink: ((event: KubernetesTerminalDataEvent | KubernetesTerminalExitEvent) => void) | null) => {
  terminalRuntime.setEventSink(sink)
}

export const __resetKubernetesCatalogForTests = () => {
  applyInitialKubernetesState()
  terminalSessions = []
  agentProxyRuntime.reset()
  terminalRuntime.reset()
  kubernetesCatalogLoadedStateDir = ''
  kubernetesCatalogStateLoaded = false
}

export const executeKubernetesCommand = async (input: KubernetesCommandInput): Promise<KubernetesCommandResult> => {
  ensureKubernetesCatalogStateLoaded()
  return commandRuntime.executeKubernetesCommand(input)
}

export const planKubernetesResourceAction = async (input: KubernetesResourceActionInput): Promise<KubernetesResourceActionPlanResult> => {
  ensureKubernetesCatalogStateLoaded()
  return commandRuntime.planKubernetesResourceAction(input)
}

export const executeKubernetesResourceAction = async (input: KubernetesResourceActionInput): Promise<KubernetesResourceActionExecuteResult> => {
  ensureKubernetesCatalogStateLoaded()
  return commandRuntime.executeKubernetesResourceAction(input)
}

export const refreshKubernetesResources = async (input: KubernetesResourceRefreshInput): Promise<KubernetesResourceRefreshResult> => {
  ensureKubernetesCatalogStateLoaded()
  return commandRuntime.refreshKubernetesResources(input)
}

export async function cleanupKubernetesAgent(): Promise<KubernetesAgentCleanupResult> {
  return asResult(() => ({
    cleared: true,
    cleanedAt: nowLabel()
  }))
}
