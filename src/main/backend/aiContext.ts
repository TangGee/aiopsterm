import type {
  AiContextCatalog,
  AiContextCatalogResult,
  AiContextCategoryInfo,
  AiContextOption,
  AiopsAssetRecord,
  KnowledgeBaseNodeConfig,
  SkillUserConfig
} from '@shared/preload'
import { listAssets } from './assets'
import { listChatConversations } from './chatHistory'

type AiContextBackendRuntime = {
  listKnowledgeTree?: () => KnowledgeBaseNodeConfig[] | Promise<KnowledgeBaseNodeConfig[]>
  listSkills?: () => SkillUserConfig[] | Promise<SkillUserConfig[]>
}

const aiContextRuntime: AiContextBackendRuntime = {}

export const configureAiContextBackendRuntime = (runtime: AiContextBackendRuntime) => {
  Object.assign(aiContextRuntime, runtime)
}

const cloneContextOption = (context: AiContextOption): AiContextOption => ({ ...context })

const cloneCategory = (category: AiContextCategoryInfo): AiContextCategoryInfo => ({
  ...category,
  options: category.options.map(cloneContextOption)
})

const localHostContext = (): AiContextOption => ({
  id: 'opened-local',
  kind: 'hosts',
  label: '127.0.0.1',
  detail: 'local shell',
  host: '127.0.0.1',
  username: '',
  assetName: 'Local terminal',
  isLocalShell: true
})

const assetToHostContext = (asset: AiopsAssetRecord): AiContextOption => ({
  id: asset.id,
  kind: 'hosts',
  label: asset.host || asset.ip || asset.name,
  detail: asset.name || asset.title || asset.group_name,
  host: asset.host || asset.ip || asset.name,
  port: Number(asset.port) || 22,
  username: asset.username || 'root',
  assetName: asset.name || asset.title || asset.host || asset.ip
})

const sortAssetsForContext = (assets: AiopsAssetRecord[]) =>
  [...assets].sort((first, second) => {
    if (first.asset_type !== second.asset_type) {
      if (first.asset_type === 'person') return -1
      if (second.asset_type === 'person') return 1
    }
    if (Boolean(first.favorite) !== Boolean(second.favorite)) return first.favorite ? -1 : 1
    if (first.status !== second.status) {
      if (first.status === 'online') return -1
      if (second.status === 'online') return 1
    }
    return (first.name || first.title || first.host).localeCompare(second.name || second.title || second.host, 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    })
  })

const buildHostOptions = () => {
  const assets = sortAssetsForContext(listAssets().assets.filter((asset) => !asset.isLocalShell && (asset.host || asset.ip || asset.name)))
  const hosts = [localHostContext(), ...assets.map(assetToHostContext)]
  const deduped = new Map<string, AiContextOption>()
  hosts.forEach((host) => {
    if (!deduped.has(host.id)) deduped.set(host.id, host)
  })
  return [...deduped.values()]
}

const buildChatOptions = (): AiContextOption[] => {
  const result = listChatConversations()
  if (!result.ok || !result.data) return []
  return result.data.conversations
    .map(
      (conversation): AiContextOption => ({
        id: `chat:${conversation.id}`,
        kind: 'chats',
        label: conversation.title,
        detail: conversation.summary || conversation.ipAddress || conversation.updatedAt
      })
    )
    .sort((first, second) => first.label.localeCompare(second.label, 'zh-CN', { numeric: true, sensitivity: 'base' }))
}

const parentRelPathFromRelPath = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

const sortContextOptions = (options: AiContextOption[]) =>
  [...options].sort((first, second) => {
    if (first.contextType !== second.contextType) {
      if (first.contextType === 'dir') return -1
      if (second.contextType === 'dir') return 1
    }
    return first.label.localeCompare(second.label, 'zh-CN', { numeric: true, sensitivity: 'base' })
  })

const flattenKnowledgeNodesToDocOptions = (nodes: KnowledgeBaseNodeConfig[] = [], parentRelPath = ''): AiContextOption[] => {
  const options: AiContextOption[] = []
  for (const node of nodes) {
    const relPath = node.relPath?.trim()
    const label = node.title?.trim() || relPath.split('/').filter(Boolean).at(-1) || relPath
    if (!relPath || !label) continue
    const isDir = node.type === 'dir'
    options.push({
      id: `${isDir ? 'kb-dir' : 'kb-doc'}:${relPath}`,
      kind: 'docs',
      label,
      detail: isDir ? 'dir' : relPath,
      relPath,
      parentRelPath: parentRelPath || parentRelPathFromRelPath(relPath),
      contextType: isDir ? 'dir' : 'doc'
    })
    if (isDir && node.children?.length) {
      options.push(...flattenKnowledgeNodesToDocOptions(node.children, relPath))
    }
  }
  return sortContextOptions(options)
}

const buildDocOptions = async (): Promise<AiContextOption[]> => {
  if (!aiContextRuntime.listKnowledgeTree) return []
  try {
    return flattenKnowledgeNodesToDocOptions(await aiContextRuntime.listKnowledgeTree())
  } catch {
    return []
  }
}

const buildSkillOptions = async (): Promise<AiContextOption[]> => {
  if (!aiContextRuntime.listSkills) return []
  try {
    const skills = await aiContextRuntime.listSkills()
    return sortContextOptions(
      skills
        .filter((skill) => skill.enabled && skill.name?.trim())
        .map((skill): AiContextOption => {
          const name = skill.name.trim()
          return {
            id: `skill:${name}`,
            kind: 'skills',
            label: name,
            detail: skill.description?.trim() || undefined
          }
        })
    )
  } catch {
    return []
  }
}

const buildCategories = (
  hosts: AiContextOption[],
  docs: AiContextOption[],
  skills: AiContextOption[],
  chats: AiContextOption[]
): AiContextCategoryInfo[] => [
  { id: 'hosts', label: '主机', options: hosts.map(cloneContextOption) },
  { id: 'docs', label: '文档', options: docs.map(cloneContextOption) },
  { id: 'skills', label: '技能', options: skills.map(cloneContextOption) },
  { id: 'chats', label: '历史会话', options: chats.map(cloneContextOption) }
]

export const listAiContextCatalog = async (): Promise<AiContextCatalogResult> => {
  try {
    const hosts = buildHostOptions()
    const chats = buildChatOptions()
    const [docs, skills] = await Promise.all([buildDocOptions(), buildSkillOptions()])
    const defaultRemote = hosts.find((host) => host.id !== 'opened-local')
    const catalog: AiContextCatalog = {
      categories: buildCategories(hosts, docs, skills, chats).map(cloneCategory),
      openedHosts: hosts.slice(0, 4).map(cloneContextOption),
      selectedDefaults: [hosts[0], defaultRemote].filter(Boolean).map((context) => cloneContextOption(context as AiContextOption))
    }
    return { ok: true, data: catalog }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'AI_CONTEXT_CATALOG_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}
