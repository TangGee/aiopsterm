import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'
import type { ProductSessionContextRef } from '@shared/contracts/productSessions'

export type ClassicTerminalPanelLike = {
  id: string
  kind?: 'terminal' | 'knowledge' | 'managed-ai-session' | 'project-file'
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
type ClassicHostIdentity = Pick<AiContextOption, 'id'> &
  Partial<Pick<AiContextOption, 'label' | 'host' | 'assetId' | 'connectionId' | 'terminalSessionId' | 'isLocalShell'>>

const isLiveTerminalPanel = (panel: ClassicTerminalPanelLike) =>
  (panel.kind === undefined || panel.kind === 'terminal') &&
  Boolean(text(panel.sessionId)) &&
  panel.status !== 'closed' &&
  panel.status !== 'error'

const terminalHostDetail = (host: string, port?: number, username?: string) => {
  const endpoint = port && port !== 22 ? `${host}:${port}` : host
  return username ? `${username}@${endpoint}` : endpoint
}

export const isClassicLocalHostContext = (
  context: ClassicHostIdentity
) => {
  const id = text(context.id).toLowerCase()
  const label = text(context.label).toLowerCase()
  const host = text(context.host).toLowerCase()
  return context.isLocalShell === true ||
    id === 'opened-local' ||
    id === 'hosts.127.0.0.1' ||
    label === '127.0.0.1' ||
    host === '127.0.0.1'
}

export const classicStableHostTargetId = (
  context: ClassicHostIdentity
) => isClassicLocalHostContext(context)
  ? 'opened-local'
  : text(context.assetId) || text(context.connectionId) || text(context.id)

export const classicHostTargetId = (
  context: ClassicHostIdentity
) => {
  const stableId = classicStableHostTargetId(context)
  const terminalSessionId = text(context.terminalSessionId)
  return terminalSessionId ? `${stableId}::${terminalSessionId}` : stableId
}

export const classicTerminalBindingId = (
  context: Pick<AiContextOption, 'id' | 'panelId' | 'terminalSessionId' | 'assetId' | 'connectionId' | 'isLocalShell'>
) => text(context.terminalSessionId) || text(context.panelId) || classicHostTargetId(context)

export const classicHostContextFromTerminalPanel = (
  panel: ClassicTerminalPanelLike
): AiContextOption | null => {
  if (!isLiveTerminalPanel(panel)) return null
  if (!panel.sshSession) {
    return {
      id: 'opened-local',
      kind: 'hosts',
      label: '127.0.0.1',
      detail: 'local shell',
      host: '127.0.0.1',
      assetName: text(panel.title) || 'Local terminal',
      panelId: panel.id,
      terminalSessionId: text(panel.sessionId),
      isLocalShell: true
    }
  }
  const assetId = text(panel.sshSession.assetId)
  const connectionId = text(panel.sshSession.connectionId)
  const id = assetId || connectionId
  const host = text(panel.sshSession.host)
  if (!id || !host) return null
  const port = Number(panel.sshSession.port) || 22
  const username = text(panel.sshSession.username)
  return {
    id,
    kind: 'hosts',
    label: text(panel.sshSession.assetName) || text(panel.title) || host,
    detail: terminalHostDetail(host, port, username),
    ...(assetId ? { assetId } : {}),
    ...(connectionId ? { connectionId } : {}),
    panelId: panel.id,
    terminalSessionId: text(panel.sessionId),
    host,
    port,
    ...(username ? { username } : {}),
    assetName: text(panel.sshSession.assetName) || text(panel.title) || host
  }
}

export const classicOpenedHostContexts = (
  panels: ClassicTerminalPanelLike[],
  activePanelId = '',
  limit = 5
) => {
  const opened = new Map<string, AiContextOption>()
  const maximum = Math.max(0, Math.floor(limit))
  if (!maximum) return []
  const ordered = [...panels].sort((first, second) => Number(second.id === activePanelId) - Number(first.id === activePanelId))
  for (const panel of ordered) {
    const context = classicHostContextFromTerminalPanel(panel)
    if (!context) continue
    const targetId = classicHostTargetId(context)
    if (!targetId || opened.has(targetId)) continue
    opened.set(targetId, context)
    if (opened.size >= maximum) break
  }
  return [...opened.values()]
}

export const classicActiveHostContext = (
  panels: ClassicTerminalPanelLike[],
  activePanelId = ''
) => {
  const panel = panels.find((candidate) => candidate.id === activePanelId)
  return panel ? classicHostContextFromTerminalPanel(panel) : null
}

const skillNameFor = (context: Pick<AiContextOption, 'id' | 'label' | 'skillName'>) =>
  text(context.skillName) || (context.id.startsWith('skill:') ? text(context.id.slice('skill:'.length)) : text(context.label))

const chatSessionIdFor = (context: Pick<AiContextOption, 'id' | 'chatSessionId'>) =>
  text(context.chatSessionId) || (context.id.startsWith('chat:') ? text(context.id.slice('chat:'.length)) : '')

export const classicSessionContextRef = (context: AiContextOption): ProductSessionContextRef => {
  const localHost = context.kind === 'hosts' && isClassicLocalHostContext(context)
  return {
    id: localHost ? 'opened-local' : context.id,
    kind: context.kind,
    label: context.label,
    ...(text(context.detail) ? { detail: context.detail } : {}),
    ...(!localHost && text(context.assetId) ? { assetId: context.assetId } : {}),
    ...(!localHost && text(context.connectionId) ? { connectionId: context.connectionId } : {}),
    ...(text(context.panelId) ? { panelId: context.panelId } : {}),
    ...(text(context.terminalSessionId) ? { terminalSessionId: context.terminalSessionId } : {}),
    ...(text(context.host) ? { host: context.host } : {}),
    ...(Number.isInteger(context.port) ? { port: context.port } : {}),
    ...(text(context.username) ? { username: context.username } : {}),
    ...(text(context.relPath) ? { relPath: context.relPath } : {}),
    ...(context.contextType ? { contextType: context.contextType } : {}),
    ...(text(context.mediaType) ? { mediaType: context.mediaType } : {}),
    ...(context.kind === 'hosts' && !localHost && !text(context.assetId) && text(context.id)
      ? { assetId: context.id }
      : {}),
    ...(context.kind === 'skills' && skillNameFor(context) ? { skillName: skillNameFor(context) } : {}),
    ...(context.kind === 'chats' && chatSessionIdFor(context) ? { chatSessionId: chatSessionIdFor(context) } : {})
  }
}

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
  if (text(ref.assetId) && candidateAssetId !== text(ref.assetId)) return false
  const refHost = text(ref.host).toLowerCase()
  if (refHost && text(candidate.host).toLowerCase() !== refHost) return false
  if (ref.port !== undefined && Number(candidate.port || 22) !== Number(ref.port || 22)) return false
  if (text(ref.username) && text(candidate.username) !== text(ref.username)) return false
  if (text(ref.assetId) || refHost) return true
  if (text(ref.connectionId)) return text(candidate.connectionId) === text(ref.connectionId)
  return false
}

export const classicHostBindingMatchesContext = (
  ref: ProductSessionContextRef,
  candidate: AiContextOption
) => {
  if (ref.kind !== 'hosts' || candidate.kind !== 'hosts') return false
  if (isClassicLocalHostContext(ref)) return isClassicLocalHostContext(candidate)
  return sameHostRef(ref, candidate)
}

const matchingCatalogOption = (ref: ProductSessionContextRef, options: AiContextOption[]) => {
  if (ref.kind === 'hosts' && isClassicLocalHostContext(ref)) {
    return options.find((candidate) => candidate.kind === 'hosts' && isClassicLocalHostContext(candidate))
  }
  const exact = options.find((candidate) => candidate.kind === ref.kind && candidate.id === ref.id)
  if (exact && ref.kind !== 'hosts') return exact
  if (exact && ref.kind === 'hosts' && (
    (ref.id === 'opened-local' && isClassicLocalHostContext(exact)) || sameHostRef(ref, exact)
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

const availableContext = (ref: ProductSessionContextRef, candidate: AiContextOption): AiContextOption => {
  if (ref.kind === 'hosts' && isClassicLocalHostContext(ref)) {
    return {
      ...candidate,
      id: 'opened-local',
      kind: 'hosts',
      label: candidate.label || ref.label || '127.0.0.1',
      isLocalShell: true,
      unavailable: false,
      unavailableReason: undefined
    }
  }
  return {
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
  }
}

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
  context: AiContextOption,
  activePanelId = ''
) => {
  if (context.kind !== 'hosts' || context.unavailable === true) return null
  const livePanels = panels
    .filter(isLiveTerminalPanel)
    .sort((first, second) => Number(second.id === activePanelId) - Number(first.id === activePanelId))
  const exactPanelId = text(context.panelId)
  const exactTerminalSessionId = text(context.terminalSessionId)
  if (exactPanelId || exactTerminalSessionId) {
    return livePanels.find((panel) =>
      (exactPanelId && panel.id === exactPanelId) ||
      (exactTerminalSessionId && text(panel.sessionId) === exactTerminalSessionId)
    ) || null
  }
  if (isClassicLocalHostContext(context)) {
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
