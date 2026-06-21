import { randomUUID } from 'crypto'
import type { AiopsMutationResult } from './contracts/common'
import type {
  KubernetesCatalog,
  KubernetesClusterRecord,
  KubernetesCommandInput,
  KubernetesCommandResult,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceAction,
  KubernetesResourceActionExecuteResult,
  KubernetesResourceActionInput,
  KubernetesResourceActionPlanResult,
  KubernetesResourceKind,
  KubernetesResourceRefreshInput,
  KubernetesResourceRefreshResult
} from './contracts/kubernetes'
import {
  allKubernetesResourceKinds,
  buildKubernetesGetCommand,
  buildKubernetesResourceActionCommand,
  kubernetesResourceActionTitlePrefix as resourceActionTitlePrefix,
  normalizeKubernetesCommand,
  parseKubectlNamespaces,
  parseKubectlResources,
  renderList,
  renderSeedCommand,
  renderTerminalCommandOutput,
  runLocalKubectl,
  type KubernetesKubectlRuntimeOptions,
  type KubernetesNonRunnableReason
} from './kubernetesKubectlRuntime'

type KubernetesCommandRuntimeOptions = {
  clusters: () => KubernetesClusterRecord[]
  namespaces: () => KubernetesNamespaceInfo[]
  setNamespaces: (namespaces: KubernetesNamespaceInfo[]) => void
  resources: () => KubernetesResource[]
  setResources: (resources: KubernetesResource[]) => void
  cloneCatalog: () => KubernetesCatalog
  kubectlRuntimeOptions: () => KubernetesKubectlRuntimeOptions
  canRunLocalKubectl: (cluster: KubernetesClusterRecord) => boolean
  nonRunnableKubernetesReason: (cluster: KubernetesClusterRecord) => KubernetesNonRunnableReason | null
  nowLabel: () => string
  idPart: (value: string) => string
  persistCatalogState: () => void
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

const normalizeResourceAction = (action: KubernetesResourceAction | undefined): KubernetesResourceAction =>
  action === 'describe' || action === 'logs' || action === 'get' ? action : 'get'

const filterResourcesOutsideRefreshScope = (resources: KubernetesResource[], clusterId: string, kind: KubernetesResourceKind, namespace: string) =>
  resources.filter((resource) => {
    if (resource.clusterId !== clusterId || resource.kind !== kind) return true
    if (kind === 'nodes' || namespace === 'all') return false
    return resource.namespace !== namespace
  })

const resourcesInRefreshScope = (resources: KubernetesResource[], clusterId: string, kind: KubernetesResourceKind, namespace: string) =>
  resources.filter((resource) => {
    if (resource.clusterId !== clusterId || resource.kind !== kind) return false
    return kind === 'nodes' || namespace === 'all' || resource.namespace === namespace
  })

export const createKubernetesCommandRuntime = (options: KubernetesCommandRuntimeOptions) => {
  const createKubernetesCommandRun = (
    input: KubernetesCommandInput,
    command: string,
    output: string,
    success: boolean,
    startedAt: number,
    error = ''
  ): NonNullable<KubernetesCommandResult['data']> => {
    const cluster = input.clusterId ? options.clusters().find((item) => item.id === input.clusterId) : undefined
    const namespace = input.namespace || cluster?.default_namespace || input.defaultNamespace || 'default'
    return {
      runId: `k8s-run-${randomUUID()}`,
      command,
      output,
      terminalOutput: success ? renderTerminalCommandOutput(command, output) : '',
      success,
      error,
      durationMs: Math.max(1, Date.now() - startedAt),
      startedAt: options.nowLabel(),
      clusterId: input.clusterId || '',
      contextName: cluster?.context_name || input.contextName || 'unknown-context',
      namespace,
      source: input.source || 'terminal'
    }
  }

  const executeKubernetesCommand = async (input: KubernetesCommandInput): Promise<KubernetesCommandResult> => {
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

    const cluster = options.clusters().find((item) => item.id === input.clusterId)
    if (!cluster) {
      if (input.source === 'agent') {
        return {
          ok: true,
          data: createKubernetesCommandRun(input, command, '', false, startedAt, 'Kubernetes cluster not found.')
        }
      }
      return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
    }

    if (options.canRunLocalKubectl(cluster)) {
      const namespace = input.namespace || cluster.default_namespace || input.defaultNamespace || 'default'
      const result = await runLocalKubectl(cluster, command, namespace, options.kubectlRuntimeOptions())
      const output = result.output || result.error
      return {
        ok: true,
        data: {
          ...createKubernetesCommandRun(input, command, output, result.success, startedAt, result.error),
          terminalOutput: renderTerminalCommandOutput(command, output, result.error)
        }
      }
    }

    const nonRunnableReason = options.nonRunnableKubernetesReason(cluster)
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

    const seedResult = renderSeedCommand({ ...input, command }, options.kubectlRuntimeOptions().state())
    return {
      ok: true,
      data: {
        ...createKubernetesCommandRun(input, command, seedResult.output, seedResult.success, startedAt, seedResult.error),
        terminalOutput: renderTerminalCommandOutput(command, seedResult.output, seedResult.error)
      }
    }
  }

  const requireCluster = (id: string) => {
    const cluster = options.clusters().find((item) => item.id === id)
    if (!cluster) throw Object.assign(new Error('Kubernetes cluster not found.'), { code: 'K8S_CLUSTER_NOT_FOUND' })
    return cluster
  }

  const requireResource = (id: string) => {
    const resource = options.resources().find((item) => item.id === id)
    if (!resource) throw Object.assign(new Error('Kubernetes resource not found.'), { code: 'K8S_RESOURCE_NOT_FOUND' })
    return resource
  }

  const planKubernetesResourceAction = async (input: KubernetesResourceActionInput): Promise<KubernetesResourceActionPlanResult> =>
    asResult(() => {
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

  const executeKubernetesResourceAction = async (input: KubernetesResourceActionInput): Promise<KubernetesResourceActionExecuteResult> => {
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

  const refreshKubernetesResources = async (input: KubernetesResourceRefreshInput): Promise<KubernetesResourceRefreshResult> => {
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
        ...options.cloneCatalog(),
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
        startedAt: options.nowLabel(),
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
    const cluster = options.clusters().find((item) => item.id === clusterId)
    if (!cluster) {
      return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
    }
    if (requestedKind !== 'all' && !allKubernetesResourceKinds.includes(requestedKind)) {
      return { ok: false, errorCode: 'K8S_RESOURCE_KIND_UNSUPPORTED', errorMessage: 'Unsupported Kubernetes resource kind.' }
    }

    if (options.canRunLocalKubectl(cluster)) {
      const refreshedKinds = requestedKind === 'all' ? allKubernetesResourceKinds : [requestedKind]
      const commands: string[] = []
      const outputs: string[] = []
      const parsedByKind = new Map<KubernetesResourceKind, KubernetesResource[]>()
      let parsedNamespaces: KubernetesNamespaceInfo[] | null = null

      const namespaceResult = await runLocalKubectl(cluster, 'kubectl get namespaces', cluster.default_namespace || 'default', options.kubectlRuntimeOptions())
      commands.push('kubectl get namespaces')
      outputs.push(namespaceResult.output || namespaceResult.error)
      if (!namespaceResult.success) {
        const output = outputs.filter(Boolean).join('\n\n')
        return asRefreshResult(cluster, commands.join(' && '), output, false, namespaceResult.error || output, 0, 0, namespaceResult.error || 'Kubernetes namespaces refresh failed.')
      }
      parsedNamespaces = parseKubectlNamespaces(cluster.id, namespaceResult.output, options.idPart)

      for (const kind of refreshedKinds) {
        const command = buildKubernetesGetCommand(kind, namespace)
        const result = await runLocalKubectl(cluster, command, kind === 'nodes' ? 'all' : namespace, options.kubectlRuntimeOptions())
        commands.push(command)
        outputs.push(result.output || result.error)
        if (!result.success) {
          const output = outputs.filter(Boolean).join('\n\n')
          return asRefreshResult(cluster, commands.join(' && '), output, false, result.error || output, 0, 0, result.error || 'Kubernetes resources refresh failed.', requestedKind)
        }
        parsedByKind.set(kind, parseKubectlResources(cluster, kind, result.output, namespace === 'all' ? cluster.default_namespace || 'default' : namespace, options.idPart))
      }

      options.setNamespaces([...options.namespaces().filter((item) => item.clusterId !== cluster.id), ...parsedNamespaces])
      refreshedKinds.forEach((kind) => {
        const parsedResources = parsedByKind.get(kind) || []
        options.setResources([...filterResourcesOutsideRefreshScope(options.resources(), cluster.id, kind, namespace), ...parsedResources])
      })
      options.persistCatalogState()
      const refreshedResources = refreshedKinds.reduce((count, kind) => count + resourcesInRefreshScope(options.resources(), cluster.id, kind, namespace).length, 0)
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

    const nonRunnableReason = options.nonRunnableKubernetesReason(cluster)
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
        ? [renderSeedCommand({ command: 'kubectl get namespaces', clusterId: cluster.id, namespace: cluster.default_namespace || 'default' }, options.kubectlRuntimeOptions().state()).output, ...refreshedKinds.map((kind) => renderList(buildKubernetesGetCommand(kind, namespace), cluster.id, namespace, options.kubectlRuntimeOptions().state()))]
        : [renderList(command, cluster.id, namespace, options.kubectlRuntimeOptions().state())]
    const refreshedResources = refreshedKinds.reduce((count, kind) => count + resourcesInRefreshScope(options.resources(), cluster.id, kind, namespace).length, 0)
    const refreshedNamespaces = options.namespaces().filter((item) => item.clusterId === cluster.id).length
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

  return {
    executeKubernetesCommand,
    planKubernetesResourceAction,
    executeKubernetesResourceAction,
    refreshKubernetesResources
  }
}
