import { spawn } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type {
  KubernetesAgentProxyConfig,
  KubernetesClusterRecord,
  KubernetesCommandInput,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceAction,
  KubernetesResourceKind,
  KubernetesClusterTestResult
} from './contracts/kubernetes'

export type KubernetesNonRunnableReason = {
  code: string
  message: string
}

export type KubernetesSeedCommandRenderResult = {
  supported: boolean
  success: boolean
  output: string
  error: string
}

export type KubernetesKubectlRuntimeState = {
  clusters: KubernetesClusterRecord[]
  namespaces: KubernetesNamespaceInfo[]
  resources: KubernetesResource[]
}

export type KubernetesKubectlRuntimeOptions = {
  state: () => KubernetesKubectlRuntimeState
  shouldUseSeedData: () => boolean
  developmentSeedClusterIds: Set<string>
  expandHomePath: (value: string) => string
  loadAgentProxyConfig: () => KubernetesAgentProxyConfig
}

const resourceTypeByKind: Record<KubernetesResourceKind, string> = {
  pods: 'pod',
  deployments: 'deployment',
  services: 'service',
  nodes: 'node'
}

const kubectlGetResourceByKind: Record<KubernetesResourceKind, string> = {
  pods: 'pods',
  deployments: 'deployments',
  services: 'services',
  nodes: 'nodes'
}

export const kubernetesResourceActionTitlePrefix: Record<KubernetesResourceAction, string> = {
  get: 'Get',
  describe: 'Describe',
  logs: 'Logs'
}

export const allKubernetesResourceKinds: KubernetesResourceKind[] = ['pods', 'deployments', 'services', 'nodes']

const kindFromToken = (token: string): KubernetesResourceKind | null => {
  if (/^pods?$/.test(token)) return 'pods'
  if (/^deploy(ments?)?$/.test(token) || /^deployments?$/.test(token)) return 'deployments'
  if (/^svc$|^services?$/.test(token)) return 'services'
  if (/^nodes?$/.test(token)) return 'nodes'
  return null
}

export const normalizeKubernetesCommand = (command: string) => command.trim().replace(/\s+/g, ' ')

const namespaceFromCommand = (command: string, fallback: string) => {
  const namespaceMatch = command.match(/(?:-n|--namespace)(?:=|\s+)([^\s]+)/)
  return namespaceMatch?.[1] || fallback
}

export const stripAnsi = (value: string) =>
  value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')

const resolveKubectlCommand = () => process.env.AIOPSTERM_KUBECTL_PATH?.trim() || 'kubectl'

// kubectl 输出收集上限：超限截断并在输出尾部标记，避免大结果集撑爆主进程内存。
const kubectlOutputMaxLength = 10 * 1024 * 1024
const kubectlOutputTruncatedNotice = '[aiopsterm] kubectl output truncated at 10MB.'

const hasArgument = (args: string[], names: string[]) =>
  args.some((arg, index) => names.includes(arg) || names.some((name) => arg.startsWith(`${name}=`)) || (names.includes(args[index - 1]) && !arg.startsWith('-')))

const hasNamespaceArgument = (args: string[]) => hasArgument(args, ['-n', '--namespace'])

const hasContextArgument = (args: string[]) => hasArgument(args, ['--context'])

const hasAllNamespacesArgument = (args: string[]) => args.includes('-A') || args.includes('--all-namespaces')

const isClusterScopedCommand = (args: string[]) => {
  const command = args[0]?.toLowerCase() || ''
  if (!command || ['version', 'config', 'cluster-info', 'api-resources', 'api-versions'].includes(command)) return true
  if (!['get', 'describe', 'delete'].includes(command)) return false
  const kind = args.find((arg, index) => index > 0 && !arg.startsWith('-'))?.toLowerCase() || ''
  return ['namespace', 'namespaces', 'ns', 'node', 'nodes', 'no', 'persistentvolume', 'persistentvolumes', 'pv', 'clusterrole', 'clusterroles'].includes(kind)
}

const tokenizeKubectlCommand = (command: string) => {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false

  const pushCurrent = () => {
    if (!current) return
    args.push(current)
    current = ''
  }

  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      pushCurrent()
      continue
    }
    current += char
  }

  if (escaped) current += '\\'
  if (quote) {
    return {
      ok: false as const,
      args: [],
      error: `Unclosed ${quote === '"' ? 'double' : 'single'} quote in kubectl command.`
    }
  }
  pushCurrent()
  return { ok: true as const, args, error: '' }
}

const buildKubectlArgs = (command: string, cluster: KubernetesClusterRecord, namespace: string) => {
  const parsed = tokenizeKubectlCommand(command)
  if (!parsed.ok) return parsed
  const args = [...parsed.args]
  if (/^kubectl(?:\.exe)?$/i.test(args[0] || '')) args.shift()
  if (!hasContextArgument(args)) args.push(`--context=${cluster.context_name}`)
  if (namespace && namespace !== 'all' && !hasNamespaceArgument(args) && !hasAllNamespacesArgument(args) && !isClusterScopedCommand(args)) {
    args.push(`--namespace=${namespace}`)
  }
  return { ok: true as const, args, error: '' }
}

const unsupportedKubernetesSeedCommandMessage = (command: string) =>
  `Kubernetes development seed data cannot execute "${command}". Select a kubeconfig-backed cluster to run arbitrary kubectl commands.`

const createKubernetesSeedCommandResult = (output: string): KubernetesSeedCommandRenderResult => {
  const success = !/^Error from server/.test(output)
  return {
    supported: true,
    success,
    output,
    error: success ? '' : output
  }
}

const createUnsupportedKubernetesSeedCommandResult = (command: string): KubernetesSeedCommandRenderResult => {
  const message = unsupportedKubernetesSeedCommandMessage(command)
  return {
    supported: false,
    success: false,
    output: message,
    error: message
  }
}

export const createCanRunLocalKubectl = (options: Pick<KubernetesKubectlRuntimeOptions, 'shouldUseSeedData' | 'developmentSeedClusterIds'>) => (cluster: KubernetesClusterRecord) =>
  !(options.shouldUseSeedData() && options.developmentSeedClusterIds.has(cluster.id)) &&
  cluster.source_type === 'local' &&
  cluster.auth_type === 'kubeconfig' &&
  Boolean(cluster.kubeconfig_content?.trim() || cluster.kubeconfig_path?.trim())

export const isLegacyPlaceholderClusterInput = (input: { name: string; contextName: string; serverUrl: string }) =>
  input.name.trim() === 'new-cluster' || input.contextName.trim() === 'new/context' || input.serverUrl.trim() === 'https://new.k8s.local:6443'

export const requireRunnableKubernetesClusterInput = (input: {
  name: string
  contextName: string
  serverUrl: string
  sourceType?: KubernetesClusterRecord['source_type']
  authType?: string
  kubeconfigPath?: string | null
  kubeconfigContent?: string | null
}) => {
  if (isLegacyPlaceholderClusterInput(input)) {
    throw Object.assign(new Error('Replace the placeholder Kubernetes cluster values before saving.'), { code: 'K8S_PLACEHOLDER_CLUSTER_REJECTED' })
  }
  const sourceType = input.sourceType || 'local'
  const authType = input.authType || (sourceType === 'jumpserver' ? 'jumpserver' : 'kubeconfig')
  if (sourceType === 'local' && authType === 'kubeconfig' && !input.kubeconfigPath?.trim() && !input.kubeconfigContent?.trim()) {
    throw Object.assign(new Error('Kubeconfig path or content is required before saving a Kubernetes cluster.'), { code: 'K8S_KUBECONFIG_REQUIRED' })
  }
}

export const createNonRunnableKubernetesReason = (options: Pick<KubernetesKubectlRuntimeOptions, 'shouldUseSeedData' | 'developmentSeedClusterIds'>) => {
  const canRunLocalKubectl = createCanRunLocalKubectl(options)
  return (cluster: KubernetesClusterRecord): KubernetesNonRunnableReason | null => {
    if (cluster.source_type === 'jumpserver' || cluster.auth_type === 'jumpserver') {
      return {
        code: 'K8S_JUMPSERVER_STREAM_UNAVAILABLE',
        message: 'JumpServer Kubernetes command streaming is not connected in this backend yet.'
      }
    }
    if (options.shouldUseSeedData() && options.developmentSeedClusterIds.has(cluster.id)) return null
    if (!cluster.kubeconfig_content?.trim() && !cluster.kubeconfig_path?.trim()) {
      return {
        code: 'K8S_KUBECONFIG_REQUIRED',
        message: 'Kubeconfig path or content is required before executing kubectl.'
      }
    }
    return null
  }
}

export const buildKubernetesProxyEnvironment = (proxyConfig: KubernetesAgentProxyConfig): NodeJS.ProcessEnv => {
  if (!proxyConfig.enabled) return {}
  const scheme = proxyConfig.type.toLowerCase()
  const username = proxyConfig.enableProxyIdentity ? encodeURIComponent(proxyConfig.username.trim()) : ''
  const password = proxyConfig.enableProxyIdentity && proxyConfig.type !== 'SOCKS4' ? `:${encodeURIComponent(proxyConfig.password)}` : ''
  const auth = username ? `${username}${password}@` : ''
  const proxyUrl = `${scheme}://${auth}${proxyConfig.host}:${proxyConfig.port}`
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl
  }
}

const createKubectlEnvironment = async (cluster: KubernetesClusterRecord, options: Pick<KubernetesKubectlRuntimeOptions, 'expandHomePath' | 'loadAgentProxyConfig'>) => {
  const env: NodeJS.ProcessEnv = { ...process.env }
  let tempDir = ''
  if (cluster.kubeconfig_content?.trim()) {
    tempDir = await mkdtemp(join(tmpdir(), 'aiopsterm-kubeconfig-'))
    const kubeconfigPath = join(tempDir, 'config')
    await writeFile(kubeconfigPath, cluster.kubeconfig_content, { encoding: 'utf-8', mode: 0o600 })
    env.KUBECONFIG = kubeconfigPath
  } else if (cluster.kubeconfig_path?.trim()) {
    env.KUBECONFIG = options.expandHomePath(cluster.kubeconfig_path.trim())
  }
  Object.assign(env, buildKubernetesProxyEnvironment(options.loadAgentProxyConfig()))
  const cleanup = async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  }
  return { env, cleanup }
}

export const runLocalKubectl = async (
  cluster: KubernetesClusterRecord,
  command: string,
  namespace: string,
  options: Pick<KubernetesKubectlRuntimeOptions, 'expandHomePath' | 'loadAgentProxyConfig'>,
  timeoutMs = 30_000
): Promise<{ success: boolean; output: string; error: string; exitCode?: number | null }> => {
  const argsResult = buildKubectlArgs(command, cluster, namespace)
  if (!argsResult.ok) return { success: false, output: '', error: argsResult.error, exitCode: null }

  const { env, cleanup } = await createKubectlEnvironment(cluster, options)
  try {
    return await new Promise((resolve) => {
      const child = spawn(resolveKubectlCommand(), argsResult.args, {
        env,
        cwd: homedir(),
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      let outputTruncated = false
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout>
      const collect = (current: string, data: unknown) => {
        if (current.length >= kubectlOutputMaxLength) {
          outputTruncated = true
          return current
        }
        const next = current + String(data)
        if (next.length <= kubectlOutputMaxLength) return next
        outputTruncated = true
        return next.slice(0, kubectlOutputMaxLength)
      }
      const withTruncationNotice = (output: string) => (outputTruncated ? [output, kubectlOutputTruncatedNotice].filter(Boolean).join('\n') : output)
      const finish = (result: { success: boolean; output: string; error: string; exitCode?: number | null }) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve(result)
      }
      timeoutId = setTimeout(() => {
        child.kill()
        const output = stripAnsi([stdout, stderr].filter(Boolean).join('\n')).trimEnd()
        finish({
          success: false,
          output: withTruncationNotice(output),
          error: `kubectl command timed out after ${timeoutMs}ms.`,
          exitCode: -1
        })
      }, timeoutMs)

      child.stdout?.on('data', (data) => {
        stdout = collect(stdout, data)
      })
      child.stderr?.on('data', (data) => {
        stderr = collect(stderr, data)
      })
      child.on('error', (error) => {
        finish({
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
          exitCode: null
        })
      })
      child.on('close', (code, signal) => {
        const cleanStdout = stripAnsi(stdout).trimEnd()
        const cleanStderr = stripAnsi(stderr).trimEnd()
        const output = [cleanStdout, cleanStderr].filter(Boolean).join('\n')
        const success = code === 0
        finish({
          success,
          output: withTruncationNotice(output),
          error: success ? '' : cleanStderr || (signal ? `Command exited from signal ${signal}.` : `Command exited with code ${code}.`),
          exitCode: code
        })
      })
    })
  } finally {
    await cleanup()
  }
}

export const kubernetesConnectionProbeCommand = 'kubectl get namespaces'

export const probeKubernetesClusterConnection = async (
  cluster: KubernetesClusterRecord,
  options: KubernetesKubectlRuntimeOptions
): Promise<NonNullable<KubernetesClusterTestResult['data']>> => {
  const startedAt = Date.now()
  const command = kubernetesConnectionProbeCommand
  const namespace = cluster.default_namespace || 'default'
  const canRunLocalKubectl = createCanRunLocalKubectl(options)
  const nonRunnableReason = createNonRunnableKubernetesReason(options)(cluster)
  if (nonRunnableReason) {
    return {
      success: false,
      isValid: false,
      contextName: cluster.context_name,
      serverUrl: cluster.server_url,
      message: nonRunnableReason.message,
      command,
      output: nonRunnableReason.message,
      error: nonRunnableReason.message,
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }

  if (!canRunLocalKubectl(cluster)) {
    const seedResult = renderSeedCommand({ command, clusterId: cluster.id, namespace }, options.state())
    return {
      success: seedResult.success,
      isValid: seedResult.success,
      contextName: cluster.context_name,
      serverUrl: cluster.server_url,
      message: seedResult.success ? '连接测试成功' : seedResult.error,
      command,
      output: seedResult.output,
      error: seedResult.error,
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }

  const result = await runLocalKubectl(cluster, command, namespace, options, 15_000)
  const output = result.output || result.error
  return {
    success: result.success,
    isValid: result.success,
    contextName: cluster.context_name,
    serverUrl: cluster.server_url,
    message: result.success ? '连接测试成功' : result.error || 'Kubernetes connection probe failed.',
    command,
    output,
    error: result.success ? '' : result.error || output,
    durationMs: Math.max(1, Date.now() - startedAt)
  }
}

export const renderList = (command: string, clusterId: string, namespace: string, state: Pick<KubernetesKubectlRuntimeState, 'resources'>) => {
  const getKind = command.match(/^kubectl\s+get\s+([^\s]+)/)
  const kind = getKind ? kindFromToken(getKind[1]) : null
  if (!kind) return ''
  const includeAll = command.includes('--all-namespaces') || command.includes(' -A')
  const targetNamespace = namespaceFromCommand(command, namespace)
  const parsed = tokenizeKubectlCommand(command)
  const args = parsed.ok ? parsed.args : []
  if (/^kubectl(?:\.exe)?$/i.test(args[0] || '')) args.shift()
  const kindIndex = args[0] === 'get' ? 1 : -1
  const requestedName = kindIndex >= 0 && args[kindIndex + 1] && !args[kindIndex + 1].startsWith('-') ? args[kindIndex + 1] : ''
  const rows = state.resources
    .filter((resource) => resource.clusterId === clusterId && resource.kind === kind)
    .filter((resource) => kind === 'nodes' || includeAll || resource.namespace === targetNamespace)
    .filter((resource) => !requestedName || resource.name === requestedName)
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
  if (requestedName && !rows) return `Error from server (NotFound): ${resourceTypeByKind[kind]}s "${requestedName}" not found`
  return rows
}

const findResource = (clusterId: string, kind: KubernetesResourceKind, name: string, namespace: string, state: Pick<KubernetesKubectlRuntimeState, 'resources'>) =>
  state.resources.find((item) => item.clusterId === clusterId && item.kind === kind && item.name === name && (kind === 'nodes' || item.namespace === namespace))

const renderLogs = (command: string, clusterId: string, namespace: string, state: Pick<KubernetesKubectlRuntimeState, 'resources'>) => {
  const match = command.match(/^kubectl\s+logs\s+([^\s]+)/)
  if (!match) return ''
  const podName = match[1]
  const targetNamespace = namespaceFromCommand(command, namespace)
  const resource = findResource(clusterId, 'pods', podName, targetNamespace, state)
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

const renderDescribe = (command: string, clusterId: string, namespace: string, state: Pick<KubernetesKubectlRuntimeState, 'resources'>) => {
  const match = command.match(/^kubectl\s+describe\s+([^\s]+)\s+([^\s]+)/)
  if (!match) return ''
  const kind = kindFromToken(match[1])
  const name = match[2]
  if (!kind) return ''
  const targetNamespace = kind === 'nodes' ? 'cluster' : namespaceFromCommand(command, namespace)
  const resource = findResource(clusterId, kind, name, targetNamespace, state)
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

export const renderSeedCommand = (input: KubernetesCommandInput, state: KubernetesKubectlRuntimeState): KubernetesSeedCommandRenderResult => {
  const command = normalizeKubernetesCommand(input.command)
  const cluster = state.clusters.find((item) => item.id === input.clusterId) || {
    id: input.clusterId || '',
    name: input.clusterName || input.clusterId || 'unknown-cluster',
    context_name: input.contextName || 'unknown-context',
    default_namespace: input.defaultNamespace || 'default'
  }
  const namespace = input.namespace || cluster.default_namespace || 'default'

  if (/^kubectl\s+config\s+current-context\b/.test(command)) return createKubernetesSeedCommandResult(cluster.context_name)
  if (/^kubectl\s+version\b/.test(command)) {
    return createKubernetesSeedCommandResult(['Client Version: v1.30.0-aiopsterm', 'Kustomize Version: v5.0.4', `Server Version: ${cluster.name} api v1.29.4`].join('\n'))
  }
  if (/^kubectl\s+get\s+ns\b|^kubectl\s+get\s+namespaces\b/.test(command)) {
    return createKubernetesSeedCommandResult(
      state.namespaces
        .filter((item) => item.clusterId === cluster.id)
        .map((item) => `${item.name}\t${item.status}\t${item.age}`)
        .join('\n')
    )
  }
  if (/^kubectl\s+get\s+/.test(command)) {
    const getKind = command.match(/^kubectl\s+get\s+([^\s]+)/)
    if (!getKind || !kindFromToken(getKind[1])) return createUnsupportedKubernetesSeedCommandResult(command)
    return createKubernetesSeedCommandResult(renderList(command, cluster.id, namespace, state))
  }
  if (/^kubectl\s+logs\s+/.test(command)) return createKubernetesSeedCommandResult(renderLogs(command, cluster.id, namespace, state))
  if (/^kubectl\s+describe\s+/.test(command)) {
    const output = renderDescribe(command, cluster.id, namespace, state)
    return output ? createKubernetesSeedCommandResult(output) : createUnsupportedKubernetesSeedCommandResult(command)
  }
  return createUnsupportedKubernetesSeedCommandResult(command)
}

export const renderTerminalCommandOutput = (command: string, output: string, error = '') => {
  const body = output || error
  return `[aiopsterm kubectl] ${command}${body ? `\n${body}` : ''}`
}

// 真实 kubectl 经 tabwriter 输出,列间至少 2 个空格;按多空格切列才能保留含单空格的
// 单元格(如 RESTARTS 的 "3 (5m ago)"、-o wide 的 "NOMINATED NODE" 表头)。
// 单空格分隔的表格(如测试替身的 echo 输出)退回按任意空白切列。
const splitKubectlTableRow = (line: string, wideColumns: boolean) => (wideColumns ? line.split(/\s{2,}|\t/) : line.split(/\s+/))

const parseKubectlTable = (output: string) => {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^warning:/i.test(line))
  const headerIndex = lines.findIndex((line) => /^(?:NAMESPACE\s+)?NAME\s+/.test(line))
  if (headerIndex < 0) return []
  const wideColumns = /\s{2,}|\t/.test(lines[headerIndex])
  const headers = splitKubectlTableRow(lines[headerIndex], wideColumns)
  return lines
    .slice(headerIndex + 1)
    .filter((line) => !/^No resources found\b/i.test(line))
    .map((line) => {
      const cells = splitKubectlTableRow(line, wideColumns)
      return headers.reduce<Record<string, string>>((row, header, index) => {
        row[header] = cells[index] || ''
        return row
      }, {})
    })
    .filter((row) => Boolean(row.NAME))
}

const parseRestartCount = (value: string) => {
  const count = Number.parseInt(value, 10)
  return Number.isFinite(count) ? count : 0
}

const deploymentStatusFromRow = (row: Record<string, string>) => {
  const available = Number.parseInt(row.AVAILABLE || '', 10)
  if (Number.isFinite(available) && available > 0) return 'Available'
  const ready = row.READY || ''
  if (ready && !ready.startsWith('0/')) return 'Available'
  return 'Progressing'
}

export const parseKubectlNamespaces = (clusterId: string, output: string, idPart: (value: string) => string): KubernetesNamespaceInfo[] =>
  parseKubectlTable(output).map((row) => ({
    id: `k8s-ns-${idPart(clusterId)}-${idPart(row.NAME)}`,
    clusterId,
    name: row.NAME,
    status: row.STATUS || 'Unknown',
    age: row.AGE || '-'
  }))

export const parseKubectlResources = (
  cluster: KubernetesClusterRecord,
  kind: KubernetesResourceKind,
  output: string,
  namespace: string,
  idPart: (value: string) => string
): KubernetesResource[] =>
  parseKubectlTable(output).map((row) => {
    const resourceNamespace = kind === 'nodes' ? 'cluster' : row.NAMESPACE || namespace || cluster.default_namespace || 'default'
    const base = {
      id: `k8s-${idPart(cluster.id)}-${idPart(kind)}-${idPart(resourceNamespace)}-${idPart(row.NAME)}`,
      clusterId: cluster.id,
      kind,
      name: row.NAME,
      namespace: resourceNamespace,
      status: row.STATUS || 'Unknown',
      ready: row.READY || '-',
      age: row.AGE || '-'
    }

    if (kind === 'pods') {
      return {
        ...base,
        detail: `Pod ${row.NAME} reported by kubectl from ${cluster.name}.`,
        node: row.NODE || '',
        restarts: parseRestartCount(row.RESTARTS || '')
      }
    }
    if (kind === 'deployments') {
      return {
        ...base,
        status: deploymentStatusFromRow(row),
        detail: `Deployment ${row.NAME} reported by kubectl from ${cluster.name}.`,
        selector: row.SELECTOR || '',
        node: [row['UP-TO-DATE'], row.AVAILABLE].filter(Boolean).join('/') || ''
      }
    }
    if (kind === 'services') {
      return {
        ...base,
        status: row.TYPE || row.STATUS || 'Unknown',
        ready: row['CLUSTER-IP'] || row.READY || '-',
        detail: `Service ${row.NAME} reported by kubectl from ${cluster.name}.`,
        ports: row['PORT(S)'] || row.PORTS || ''
      }
    }
    return {
      ...base,
      namespace: 'cluster',
      ready: row.VERSION || base.ready,
      detail: `Node ${row.NAME} reported by kubectl from ${cluster.name}.`,
      node: row.ROLES || ''
    }
  })

export const buildKubernetesGetCommand = (kind: KubernetesResourceKind, namespace: string) => {
  if (kind === 'nodes') return 'kubectl get nodes'
  const resource = kubectlGetResourceByKind[kind]
  return namespace === 'all' ? `kubectl get ${resource} --all-namespaces` : `kubectl get ${resource} -n ${namespace || 'default'}`
}

export const buildKubernetesResourceActionCommand = (resource: KubernetesResource, action: KubernetesResourceAction) => {
  const type = resourceTypeByKind[resource.kind]
  const namespaceArg = resource.kind === 'nodes' ? '' : ` -n ${resource.namespace}`
  if (action === 'logs') return `kubectl logs ${resource.name}${namespaceArg} --tail=120`
  if (action === 'describe') return `kubectl describe ${type} ${resource.name}${namespaceArg}`
  return `kubectl get ${type} ${resource.name}${namespaceArg} -o wide`
}
