import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'
import type { ProductSessionContextRef } from '@shared/contracts/productSessions'

export type ClassicTerminalPanelLike = {
  id: string
  sessionId?: string | null
  title?: string
  cwd?: string
  status?: string
  sshSession?: {
    assetId?: string
    connectionId?: string
    assetName?: string
    host?: string
    port?: number
    username?: string
  }
}

const text = (value: unknown) => String(value || '').trim()

const isLiveTerminalPanel = (panel: ClassicTerminalPanelLike) =>
  Boolean(text(panel.sessionId)) && panel.status !== 'closed' && panel.status !== 'error'

const isLocalHostContext = (context: Pick<AiContextOption, 'id' | 'isLocalShell'>) =>
  context.isLocalShell === true || context.id === 'opened-local'

export const classicHostTargetId = (
  context: Pick<AiContextOption, 'id' | 'assetId' | 'connectionId' | 'isLocalShell'>
) => isLocalHostContext(context)
  ? 'opened-local'
  : text(context.assetId) || text(context.connectionId) || text(context.id)

const skillNameFor = (context: Pick<AiContextOption, 'id' | 'label' | 'skillName'>) =>
  text(context.skillName) || (context.id.startsWith('skill:') ? text(context.id.slice('skill:'.length)) : text(context.label))

const chatSessionIdFor = (context: Pick<AiContextOption, 'id' | 'chatSessionId'>) =>
  text(context.chatSessionId) || (context.id.startsWith('chat:') ? text(context.id.slice('chat:'.length)) : '')

export const classicSessionContextRef = (context: AiContextOption): ProductSessionContextRef => ({
  id: context.id,
  kind: context.kind,
  label: context.label,
  ...(text(context.detail) ? { detail: context.detail } : {}),
  ...(text(context.assetId) ? { assetId: context.assetId } : {}),
  ...(text(context.connectionId) ? { connectionId: context.connectionId } : {}),
  ...(text(context.host) ? { host: context.host } : {}),
  ...(Number.isInteger(context.port) ? { port: context.port } : {}),
  ...(text(context.username) ? { username: context.username } : {}),
  ...(text(context.relPath) ? { relPath: context.relPath } : {}),
  ...(context.contextType ? { contextType: context.contextType } : {}),
  ...(text(context.mediaType) ? { mediaType: context.mediaType } : {}),
  ...(context.kind === 'hosts' && !context.isLocalShell && !text(context.assetId) && text(context.id)
    ? { assetId: context.id }
    : {}),
  ...(context.kind === 'skills' && skillNameFor(context) ? { skillName: skillNameFor(context) } : {}),
  ...(context.kind === 'chats' && chatSessionIdFor(context) ? { chatSessionId: chatSessionIdFor(context) } : {})
})

export const classicSessionContextRefs = (contexts: AiContextOption[]) => contexts.map(classicSessionContextRef)

const catalogOptions = (catalog: Pick<AiContextCatalog, 'categories' | 'openedHosts'>) => {
  const deduped = new Map<string, AiContextOption>()
  for (const context of [...catalog.openedHosts, ...catalog.categories.flatMap((category) => category.options)]) {
    const key = `${context.kind}\u0000${context.id}`
    if (!deduped.has(key)) deduped.set(key, context)
  }
  return [...deduped.values()]
}

const sameHostRef = (ref: ProductSessionContextRef, candidate: AiContextOption) => {
  const candidateAssetId = text(candidate.assetId) || (!candidate.isLocalShell ? text(candidate.id) : '')
  if (text(ref.assetId)) return candidateAssetId === text(ref.assetId)
  if (text(ref.connectionId)) return text(candidate.connectionId) === text(ref.connectionId)
  return false
}

const matchingCatalogOption = (ref: ProductSessionContextRef, options: AiContextOption[]) => {
  const exact = options.find((candidate) => candidate.kind === ref.kind && candidate.id === ref.id)
  if (exact && ref.kind !== 'hosts') return exact
  if (exact && ref.kind === 'hosts' && (
    (ref.id === 'opened-local' && isLocalHostContext(exact)) || sameHostRef(ref, exact)
  )) return exact
  if (ref.kind === 'hosts') return options.find((candidate) => candidate.kind === 'hosts' && sameHostRef(ref, candidate))
  if (ref.kind === 'docs') {
    return options.find((candidate) => candidate.kind === 'docs' && text(ref.relPath) && candidate.relPath === ref.relPath)
  }
  if (ref.kind === 'images') {
    return options.find((candidate) =>
      (candidate.kind === 'images' || candidate.kind === 'docs') && text(ref.relPath) && candidate.relPath === ref.relPath
    )
  }
  if (ref.kind === 'skills') {
    return options.find((candidate) => candidate.kind === 'skills' && skillNameFor(candidate) === text(ref.skillName))
  }
  return options.find((candidate) => candidate.kind === 'chats' && chatSessionIdFor(candidate) === text(ref.chatSessionId))
}

const availableContext = (ref: ProductSessionContextRef, candidate: AiContextOption): AiContextOption => ({
  ...candidate,
  id: candidate.kind === ref.kind ? candidate.id : ref.id,
  kind: ref.kind,
  ...(ref.kind === 'images' && ref.mediaType ? { mediaType: ref.mediaType } : {}),
  ...(ref.assetId ? { assetId: ref.assetId } : {}),
  ...(ref.connectionId ? { connectionId: ref.connectionId } : {}),
  ...(ref.skillName ? { skillName: ref.skillName } : {}),
  ...(ref.chatSessionId ? { chatSessionId: ref.chatSessionId } : {}),
  unavailable: false,
  unavailableReason: undefined
})

const unavailableContext = (ref: ProductSessionContextRef): AiContextOption => ({
  ...ref,
  unavailable: true,
  unavailableReason: '上下文已不存在或当前不可访问'
})

export const restoreClassicSessionContexts = (
  refs: ProductSessionContextRef[],
  catalog: Pick<AiContextCatalog, 'categories' | 'openedHosts'>
) => {
  const options = catalogOptions(catalog)
  return refs.map((ref) => {
    const candidate = matchingCatalogOption(ref, options)
    return candidate ? availableContext(ref, candidate) : unavailableContext(ref)
  })
}

export const sendableClassicSessionContexts = (contexts: AiContextOption[]) =>
  contexts.filter((context) => context.unavailable !== true)

export const resolveClassicHostTerminalPanel = <Panel extends ClassicTerminalPanelLike>(
  panels: Panel[],
  context: AiContextOption
) => {
  if (context.kind !== 'hosts' || context.unavailable === true) return null
  const livePanels = panels.filter(isLiveTerminalPanel)
  if (isLocalHostContext(context)) {
    return livePanels.find((panel) => !panel.sshSession) || null
  }
  const assetId = text(context.assetId) || text(context.id)
  const connectionId = text(context.connectionId)
  const stableMatch = livePanels.find((panel) =>
    Boolean(panel.sshSession) && (
      (assetId && text(panel.sshSession?.assetId) === assetId) ||
      (connectionId && text(panel.sshSession?.connectionId) === connectionId)
    )
  )
  return stableMatch || null
}
