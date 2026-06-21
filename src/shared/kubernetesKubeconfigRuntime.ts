import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { KubernetesClusterRecord, KubernetesContextInfo, KubernetesImportContextInfo } from './contracts/kubernetes'
import type { KubernetesPersistedCatalogState } from './kubernetesCatalogPersistence'

export const idPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'

export const expandHomePath = (value: string) => {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
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

export const parseKubeconfig = (content: string) => {
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
