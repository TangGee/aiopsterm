import type { AiContextCatalog, AiContextCatalogResult, AiContextCategoryInfo, AiContextOption, AiopsAssetRecord } from '@shared/preload'
import { listAssets } from './assets'
import { listChatConversations } from './chatHistory'

const cloneContextOption = (context: AiContextOption): AiContextOption => ({ ...context })

const cloneCategory = (category: AiContextCategoryInfo): AiContextCategoryInfo => ({
  ...category,
  options: category.options.map(cloneContextOption)
})

const localHostContext = (): AiContextOption => ({
  id: 'opened-local',
  kind: 'hosts',
  label: '127.0.0.1',
  detail: 'local shell'
})

const assetToHostContext = (asset: AiopsAssetRecord): AiContextOption => ({
  id: asset.id,
  kind: 'hosts',
  label: asset.host || asset.ip || asset.name,
  detail: asset.name || asset.title || asset.group_name
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
  const assets = sortAssetsForContext(listAssets().assets.filter((asset) => asset.host || asset.ip || asset.name))
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

const defaultSkillOptions = (): AiContextOption[] => [
  { id: 'skill:audit-readonly', kind: 'skills', label: '巡检技能', detail: '生成只读检查步骤' },
  { id: 'skill:incident-retrospective', kind: 'skills', label: '故障复盘', detail: '整理现象、假设和证据' },
  { id: 'skill:release-guard', kind: 'skills', label: '发布守卫', detail: '发布前后检查清单' }
]

const buildCategories = (hosts: AiContextOption[], chats: AiContextOption[]): AiContextCategoryInfo[] => [
  { id: 'hosts', label: '主机', options: hosts.map(cloneContextOption) },
  { id: 'docs', label: '文档', options: [] },
  { id: 'skills', label: '技能', options: defaultSkillOptions() },
  { id: 'chats', label: '历史会话', options: chats.map(cloneContextOption) }
]

export const listAiContextCatalog = (): AiContextCatalogResult => {
  try {
    const hosts = buildHostOptions()
    const chats = buildChatOptions()
    const defaultRemote = hosts.find((host) => host.id !== 'opened-local')
    const catalog: AiContextCatalog = {
      categories: buildCategories(hosts, chats).map(cloneCategory),
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
