import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parse as parseYamlDocument, parseDocument as parseYamlEditableDocument } from 'yaml'
import type { KubernetesClusterRecord, KubernetesContextInfo, KubernetesImportContextInfo } from './contracts/kubernetes'
import type { KubernetesPersistedCatalogState } from './kubernetesCatalogPersistence'

export const idPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'

export const expandHomePath = (value: string) => {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const textValue = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')

// kubeconfig 是 YAML(JSON 亦为其子集)。kubectl/client-go 序列化时按字母序输出键,
// 列表项以 `- cluster:`/`- context:` 开头、`name:` 在后,手写解析无法覆盖全部布局,
// 因此这里必须走真正的 YAML 解析。uniqueKeys 放宽以容忍历史 kubeconfig 中的重复键。
const parseKubeconfigDocument = (content: string): Record<string, unknown> | null => {
  try {
    const parsed = parseYamlDocument(content, { uniqueKeys: false }) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const parseKubeconfig = (content: string) => {
  const document = parseKubeconfigDocument(content)
  if (!document) return { contexts: [] as KubernetesImportContextInfo[], currentContext: '' }

  const serverByClusterName = new Map<string, string>()
  const rawClusters = Array.isArray(document.clusters) ? document.clusters : []
  for (const entry of rawClusters) {
    if (!isRecord(entry)) continue
    const name = textValue(entry.name)
    if (!name || serverByClusterName.has(name)) continue
    const cluster = isRecord(entry.cluster) ? entry.cluster : {}
    serverByClusterName.set(name, textValue(cluster.server))
  }

  const parsedContexts: KubernetesImportContextInfo[] = []
  const rawContexts = Array.isArray(document.contexts) ? document.contexts : []
  for (const entry of rawContexts) {
    if (!isRecord(entry)) continue
    const name = textValue(entry.name)
    const context = isRecord(entry.context) ? entry.context : {}
    const cluster = textValue(context.cluster)
    if (!name || !cluster) continue
    parsedContexts.push({
      name,
      cluster,
      server: serverByClusterName.get(cluster) || '',
      namespace: textValue(context.namespace) || 'default'
    })
  }

  return {
    contexts: parsedContexts.filter((context, index, list) => list.findIndex((item) => item.name === context.name) === index),
    currentContext: textValue(document['current-context'])
  }
}

/**
 * Returns a copy of the kubeconfig content with `current-context` pinned to the requested
 * context, or null when the content cannot be parsed. Used to build session-scoped
 * kubeconfig files so terminals never mutate the user's real kubeconfig.
 */
export const pinKubeconfigCurrentContext = (content: string, contextName: string): string | null => {
  try {
    const document = parseYamlEditableDocument(content, { uniqueKeys: false })
    if (!isRecord(document.toJS())) return null
    document.set('current-context', contextName)
    return String(document)
  } catch {
    return null
  }
}

export const parseKubeconfigContexts = (content: string) => parseKubeconfig(content).contexts

export const discoveredKubeconfigClusterId = (contextName: string) => `k8s-local-${idPart(contextName)}`

export const discoverDefaultKubeconfigState = (options: {
  shouldUseSeedData: () => boolean
  defaultKubeconfigPath: () => string | null
  nowLabel: () => string
}): Pick<KubernetesPersistedCatalogState, 'contexts' | 'clusters' | 'importContexts'> | null => {
  if (options.shouldUseSeedData()) return null
  const configuredPath = options.defaultKubeconfigPath()?.trim() || ''
  if (!configuredPath) return null
  const kubeconfigPath = expandHomePath(configuredPath)
  if (!existsSync(kubeconfigPath)) return null
  try {
    const content = readFileSync(kubeconfigPath, 'utf-8')
    const parsed = parseKubeconfig(content)
    if (!parsed.contexts.length) return null
    const discoveredContexts: KubernetesContextInfo[] = parsed.contexts.map((context) => ({
      name: context.name,
      cluster: context.cluster,
      namespace: context.namespace,
      server: context.server,
      isActive: Boolean(parsed.currentContext && context.name === parsed.currentContext)
    }))
    const discoveredClusters: KubernetesClusterRecord[] = parsed.contexts.map((context) => ({
      id: discoveredKubeconfigClusterId(context.name),
      name: context.cluster || context.name,
      kubeconfig_path: kubeconfigPath,
      kubeconfig_content: null,
      context_name: context.name,
      server_url: context.server,
      auth_type: 'kubeconfig',
      is_active: parsed.currentContext && context.name === parsed.currentContext ? 1 : 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: context.namespace || 'default',
      created_at: options.nowLabel(),
      updated_at: options.nowLabel(),
      source_type: 'local',
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
