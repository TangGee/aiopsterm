import type {
  TerminalExitEvent,
  TerminalLifecycleEvent,
  TerminalSessionInfo,
  TerminalSshConnectionInfo
} from '@shared/contracts/terminalSessions'
import type { ClineAgentHostTarget } from '@shared/contracts/clineAgent'
import type { AiAgentSessionSource } from '@shared/contracts/managedAiSessions'
import type { TerminalProgress } from '@/services/terminal/terminalOscRuntime'

export type PanelDirection = 'right' | 'below'
export type TerminalOutputScope = 'output' | 'input'

export type TerminalOutputSegment = {
  text: string
  scope: TerminalOutputScope
}

export type TerminalSshSession = {
  connectionId?: string
  sourcePanelId?: string
  forkFromConnectionId?: string
  host: string
  port: number
  username: string
  assetId?: string
  assetName: string
  assetType?: string
  organizationId?: string
  jumpHostId?: string
  authType?: string
  needProxy?: boolean
  proxyName?: string
  createdAt?: number
}

export type TerminalPanel = {
  id: string
  title: string
  titleSource?: 'system' | 'user' | 'auto'
  cwd: string
  output: string
  outputSegments: TerminalOutputSegment[]
  status: 'ready' | 'connecting' | 'running' | 'closed' | 'error'
  kind?: 'terminal' | 'knowledge' | 'managed-ai-session' | 'project-file'
  split?: PanelDirection
  splitSourceId?: string
  splitGroupId?: string
  splitOrder?: number
  sessionId?: string
  classicTarget?: ClineAgentHostTarget
  knowledge?: {
    relPath: string
    isImage: boolean
    startLine?: number
    endLine?: number
    jumpToken?: number
  }
  managedAiSession?: {
    source: AiAgentSessionSource
    sessionId: string
  }
  projectFile?: {
    source: AiAgentSessionSource
    sessionId: string
    projectRoot: string
    relativePath: string
    dirty?: boolean
  }
  sshSession?: TerminalSshSession
  terminalLifecycle?: TerminalLifecycleEvent
  terminalExit?: TerminalExitEvent
  terminalProgress?: TerminalProgress
}

export type TerminalLaunchAsset = {
  id?: string
  name?: string
  title?: string
  host: string
  port?: number
  username?: string
  group_name?: string
  asset_type?: string
  auth_type?: string
  needProxy?: boolean
  proxyName?: string
  jumpHostId?: string
}

export type TerminalSessionAsset = Partial<TerminalLaunchAsset>

export type TerminalPanelInputExecution = {
  panelIds: string[]
  inputText: string
  shellText?: string
  source?: string
  writeToShell?: boolean
}

export type TerminalPanelInputRecord = {
  panel: TerminalPanel
  text: string
}

export type TerminalPanelSessionWrite = {
  panel: TerminalPanel
  sessionId: string
}

export const defaultTerminalPanelTitle = '欢迎'
const terminalTextEncoder = new TextEncoder()
const terminalTextDecoder = new TextDecoder()
const detachTerminalText = (value: string) => (value ? terminalTextDecoder.decode(terminalTextEncoder.encode(value)) : '')

export const isNonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

export const isTerminalWorkspacePanel = (panel?: { kind?: string } | null) => !panel?.kind || panel.kind === 'terminal'

export const isTerminalPanelPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535

export const createTerminalSegments = (text: string, scope: TerminalOutputScope = 'output'): TerminalOutputSegment[] => (text ? [{ text, scope }] : [])

export const appendTerminalSegment = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  if (!text) return
  panel.output += text
  if (!panel.outputSegments) {
    panel.outputSegments = []
  }
  panel.outputSegments.push({ text, scope })
}

export const trimTerminalPanelOutputHistory = (panel: TerminalPanel, maxLines: number, minBytes = maxLines * 512) => {
  const normalizedMaxLines = Math.max(1, Math.floor(maxLines))
  if (panel.output.length <= Math.max(0, minBytes)) return false
  let lineCount = 0
  let cutIndex = 0
  for (let index = panel.output.length - 1; index >= 0; index -= 1) {
    if (panel.output.charCodeAt(index) !== 10) continue
    lineCount += 1
    if (lineCount <= normalizedMaxLines) continue
    cutIndex = index + 1
    break
  }
  if (!cutIndex) return false
  panel.output = detachTerminalText(panel.output.slice(cutIndex))
  if (!panel.outputSegments?.length) {
    panel.outputSegments = createTerminalSegments(panel.output)
    return true
  }
  let remainingCut = cutIndex
  const nextSegments: TerminalOutputSegment[] = []
  panel.outputSegments.forEach((segment) => {
    if (!segment.text) return
    if (remainingCut >= segment.text.length) {
      remainingCut -= segment.text.length
      return
    }
    if (remainingCut > 0) {
      nextSegments.push({ ...segment, text: detachTerminalText(segment.text.slice(remainingCut)) })
      remainingCut = 0
      return
    }
    nextSegments.push(segment)
  })
  panel.outputSegments = nextSegments
  return true
}

export const setTerminalOutput = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  const output = detachTerminalText(text)
  panel.output = output
  panel.outputSegments = createTerminalSegments(output, scope)
}

export const createEmptyTerminalPanel = (
  id: string,
  title: string,
  split?: PanelDirection,
  splitSourceId?: string,
  splitGroupId?: string,
  splitOrder?: number,
  sourcePanel?: TerminalPanel
): TerminalPanel => ({
  id,
  title,
  titleSource: sourcePanel?.titleSource || 'system',
  cwd: sourcePanel?.cwd || '~',
  kind: 'terminal',
  output: '',
  outputSegments: [],
  status: sourcePanel?.sessionId ? 'connecting' : 'ready',
  ...(split ? { split, splitSourceId, splitGroupId, splitOrder } : {}),
  ...(split && sourcePanel?.sshSession
    ? {
        sshSession: {
          ...sourcePanel.sshSession,
          connectionId: undefined,
          sourcePanelId: sourcePanel.id
        }
      }
    : {})
})

export const isWelcomeTerminalPanelPlaceholder = (panel: TerminalPanel) =>
  panel.id === 'panel-main' &&
  panel.title === defaultTerminalPanelTitle &&
  isTerminalWorkspacePanel(panel) &&
  !panel.sessionId &&
  !panel.output &&
  panel.outputSegments.length === 0 &&
  !panel.sshSession &&
  panel.status === 'ready'

export const clearTerminalPanelSplitState = (panel: TerminalPanel) => {
  panel.split = undefined
  panel.splitSourceId = undefined
  panel.splitGroupId = undefined
  panel.splitOrder = undefined
}

export const resetTerminalPanelToDefault = (panel: TerminalPanel) => {
  panel.id = 'panel-main'
  panel.title = defaultTerminalPanelTitle
  panel.cwd = '~'
  panel.kind = 'terminal'
  panel.status = 'ready'
  clearTerminalPanelSplitState(panel)
  panel.sessionId = undefined
  panel.classicTarget = undefined
  panel.knowledge = undefined
  panel.managedAiSession = undefined
  panel.projectFile = undefined
  panel.sshSession = undefined
  panel.terminalLifecycle = undefined
  panel.terminalExit = undefined
  panel.terminalProgress = undefined
  setTerminalOutput(panel, '')
}

export const createForkSshTerminalPanel = (id: string, source: TerminalPanel): TerminalPanel | null => {
  if (!source.sshSession?.connectionId) return null
  const sourceSession = source.sshSession
  const sourceTitle = source.title || sourceSession.assetName
  return {
    id,
    title: sourceTitle,
    titleSource: source.titleSource,
    cwd: source.cwd,
    kind: 'terminal',
    output: '',
    outputSegments: [],
    status: 'ready',
    split: source.split,
    sshSession: {
      host: sourceSession.host,
      port: sourceSession.port,
      username: sourceSession.username,
      assetId: sourceSession.assetId,
      assetName: sourceSession.assetName,
      assetType: sourceSession.assetType,
      organizationId: sourceSession.organizationId,
      jumpHostId: sourceSession.jumpHostId,
      authType: sourceSession.authType,
      needProxy: sourceSession.needProxy,
      proxyName: sourceSession.proxyName,
      sourcePanelId: source.id,
      forkFromConnectionId: sourceSession.connectionId
    }
  }
}

export const createTerminalPanelInCollection = (
  panels: TerminalPanel[],
  options: { id: string; activePanelId: string; split?: PanelDirection; splitOrder?: number }
): TerminalPanel => {
  const { id, activePanelId, split, splitOrder } = options
  const sourcePanel = split ? panels.find((panel) => panel.id === activePanelId) : undefined
  if (!split && panels.length === 1 && isWelcomeTerminalPanelPlaceholder(panels[0])) {
    const panel = panels[0]
    panel.id = id
    panel.title = 'Terminal 1'
    panel.titleSource = 'system'
    return panel
  }

  const sourceId = sourcePanel?.id
  const groupId = split ? sourcePanel?.splitGroupId || sourceId : undefined
  const panel = createEmptyTerminalPanel(
    id,
    split && sourcePanel ? sourcePanel.title : `Terminal ${panels.length}`,
    split,
    sourceId,
    groupId,
    splitOrder,
    sourcePanel
  )
  if (split && sourcePanel && groupId) {
    sourcePanel.splitGroupId = groupId
    const sourceIndex = panels.findIndex((item) => item.id === sourcePanel.id)
    panels.splice(sourceIndex + 1, 0, panel)
  } else {
    panels.push(panel)
  }
  return panel
}

export const hasTerminalPanelSplitState = (panels: TerminalPanel[], panelId: string) => {
  const panel = panels.find((item) => item.id === panelId)
  if (!panel) return false
  if (panel.split || panel.splitGroupId) return true
  return panels.some((item) => item.splitSourceId === panel.id || (panel.splitGroupId && item.splitGroupId === panel.splitGroupId))
}

export const normalizeTerminalPanelSplitState = (panels: TerminalPanel[]) => {
  const ids = new Set(panels.map((panel) => panel.id))
  const groupCounts = new Map<string, number>()
  panels.forEach((panel) => {
    if (!panel.split && !panel.splitGroupId) {
      panel.splitSourceId = undefined
      return
    }
    if (panel.split && (!panel.splitSourceId || !ids.has(panel.splitSourceId) || panel.splitSourceId === panel.id)) {
      clearTerminalPanelSplitState(panel)
      return
    }
    if (panel.splitGroupId) {
      groupCounts.set(panel.splitGroupId, (groupCounts.get(panel.splitGroupId) || 0) + 1)
    }
  })
  panels.forEach((panel) => {
    if (panel.splitGroupId && (groupCounts.get(panel.splitGroupId) || 0) < 2) {
      clearTerminalPanelSplitState(panel)
    }
  })
}

export const detachTerminalPanelFromSplit = (panels: TerminalPanel[], panelId: string) => {
  const panel = panels.find((item) => item.id === panelId)
  if (!panel) return false
  const previousGroupId = panel.splitGroupId
  const previousSourceId = panel.splitSourceId
  const groupSiblings = previousGroupId ? panels.filter((item) => item.id !== panel.id && item.splitGroupId === previousGroupId) : []
  const fallbackSourceId =
    (previousSourceId && groupSiblings.some((item) => item.id === previousSourceId) ? previousSourceId : undefined) ||
    groupSiblings[0]?.id

  clearTerminalPanelSplitState(panel)
  panels.forEach((item) => {
    if (item.id === panel.id || item.splitSourceId !== panel.id) return
    if (!fallbackSourceId) {
      clearTerminalPanelSplitState(item)
      return
    }
    if (item.id === fallbackSourceId) {
      item.split = undefined
      item.splitSourceId = undefined
      item.splitOrder = undefined
      item.splitGroupId = previousGroupId
      return
    }
    item.splitSourceId = fallbackSourceId
  })
  normalizeTerminalPanelSplitState(panels)
  return true
}

export const attachTerminalPanelToSplit = (
  panels: TerminalPanel[],
  panelId: string,
  targetPanelId: string,
  direction: PanelDirection = 'right',
  splitOrder: number
) => {
  const panel = panels.find((item) => item.id === panelId)
  const target = panels.find((item) => item.id === targetPanelId)
  if (!panel || !target || panel.id === target.id) return false
  detachTerminalPanelFromSplit(panels, panel.id)
  const groupId = target.splitGroupId || target.id
  target.splitGroupId = groupId
  panel.split = direction
  panel.splitSourceId = target.id
  panel.splitGroupId = groupId
  panel.splitOrder = splitOrder
  const currentIndex = panels.findIndex((item) => item.id === panel.id)
  const targetIndex = panels.findIndex((item) => item.id === target.id)
  if (currentIndex >= 0 && targetIndex >= 0 && currentIndex !== targetIndex + 1) {
    const [moved] = panels.splice(currentIndex, 1)
    const nextTargetIndex = panels.findIndex((item) => item.id === target.id)
    panels.splice(nextTargetIndex + 1, 0, moved)
  }
  normalizeTerminalPanelSplitState(panels)
  return true
}

export const closeTerminalPanelInCollection = (panels: TerminalPanel[], panelId: string, activePanelId: string) => {
  if (panels.length === 1) {
    resetTerminalPanelToDefault(panels[0])
    return panels[0].id
  }
  panels.splice(0, panels.length, ...panels.filter((panel) => panel.id !== panelId))
  normalizeTerminalPanelSplitState(panels)
  return panels.some((panel) => panel.id === activePanelId) ? activePanelId : panels[0]?.id || activePanelId
}

export const discardPendingTerminalPanelInCollection = (
  panels: TerminalPanel[],
  panelId: string,
  activePanelId: string,
  preferredActivePanelId?: string
) => {
  const panel = panels.find((item) => item.id === panelId)
  if (!panel || panel.kind !== 'terminal' || panel.sessionId) return { discarded: false, activePanelId }
  if (panels.length === 1) {
    resetTerminalPanelToDefault(panel)
    return { discarded: true, activePanelId: panel.id }
  }
  const wasActive = activePanelId === panelId
  panels.splice(0, panels.length, ...panels.filter((item) => item.id !== panelId))
  normalizeTerminalPanelSplitState(panels)
  if (preferredActivePanelId && panels.some((item) => item.id === preferredActivePanelId)) {
    return { discarded: true, activePanelId: preferredActivePanelId }
  }
  if (wasActive || !panels.some((item) => item.id === activePanelId)) {
    return { discarded: true, activePanelId: panels[0]?.id || activePanelId }
  }
  return { discarded: true, activePanelId }
}

export const closeOtherTerminalPanelsInCollection = (panels: TerminalPanel[], activePanelId: string) => {
  panels.splice(0, panels.length, ...panels.filter((panel) => panel.id === activePanelId))
  panels.forEach(clearTerminalPanelSplitState)
}

export const resetTerminalPanelCollectionToDefault = (panels: TerminalPanel[]) => {
  panels.splice(0, panels.length, createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle))
  return 'panel-main'
}

export const terminalShellTitle = (shell: string) => shell.replace(/\\/g, '/').split('/').filter(Boolean).pop() || shell || 'local shell'

export const findTerminalPanelByIdOrSession = (panels: TerminalPanel[], id: string) =>
  panels.find((item) => item.id === id || item.sessionId === id) || null

export const findTerminalPanelBySessionOrId = (panels: TerminalPanel[], id: string) =>
  panels.find((item) => item.sessionId === id || item.id === id || item.terminalLifecycle?.id === id) || null

export const renameTerminalPanelInCollection = (
  panels: TerminalPanel[],
  id: string,
  title: string,
  source: TerminalPanel['titleSource'] = 'user'
) => {
  const panel = panels.find((item) => item.id === id)
  const normalizedTitle = title.trim()
  if (!panel || !normalizedTitle) return null
  panel.title = normalizedTitle
  panel.titleSource = source
  return panel
}

export const setTerminalPanelAutoTitleInCollection = (
  panels: TerminalPanel[],
  id: string,
  title: string,
  options: { panelOnlyIfMultiple?: boolean } = {}
) => {
  const panel = panels.find((item) => item.id === id)
  const normalizedTitle = title.trim()
  if (!panel || !normalizedTitle) return { found: Boolean(panel), applied: false, userOwned: panel?.titleSource === 'user' }
  if (panel.titleSource === 'user') return { found: true, applied: false, userOwned: true }
  if (options.panelOnlyIfMultiple && panels.length < 2) return { found: true, applied: false, userOwned: false }
  panel.title = normalizedTitle
  panel.titleSource = 'auto'
  return { found: true, applied: true, userOwned: false }
}

export const setTerminalPanelProgressInCollection = (
  panels: TerminalPanel[],
  id: string,
  progress: TerminalProgress | null
) => {
  const panel = panels.find((item) => item.id === id)
  if (!panel) return null
  panel.terminalProgress = progress || undefined
  return panel
}

export const canForkSshTerminalPanel = (panel?: TerminalPanel | null) => Boolean(panel?.kind === 'terminal' && panel.sshSession?.connectionId)

export const createForkSshTerminalPanelInCollection = (panels: TerminalPanel[], sourcePanelId: string, forkPanelId: string) => {
  const source = panels.find((item) => item.id === sourcePanelId)
  if (!canForkSshTerminalPanel(source)) return null
  const forkPanel = createForkSshTerminalPanel(forkPanelId, source!)
  if (!forkPanel) return null
  panels.push(forkPanel)
  return forkPanel
}

export const appendTerminalOutputToPanelInCollection = (panels: TerminalPanel[], id: string, data: string) => {
  const panel = findTerminalPanelByIdOrSession(panels, id)
  if (!panel) return null
  appendTerminalSegment(panel, data, 'output')
  panel.status = 'running'
  return panel
}

export const appendTerminalInputToPanelInCollection = (panels: TerminalPanel[], id: string, data: string) => {
  const panel = findTerminalPanelByIdOrSession(panels, id)
  if (!panel) return null
  appendTerminalSegment(panel, data, 'input')
  return panel
}

export const replaceTerminalOutputInPanelCollection = (
  panels: TerminalPanel[],
  id: string,
  data: string,
  scope: TerminalOutputScope = 'output'
) => {
  const panel = findTerminalPanelByIdOrSession(panels, id)
  if (!panel) return null
  setTerminalOutput(panel, data, scope)
  return panel
}

export const ensureTerminalPanelOutputSegments = (panel: TerminalPanel) => {
  if (!panel.outputSegments?.length) {
    panel.outputSegments = createTerminalSegments(panel.output)
  }
  return panel.outputSegments
}

export const applyTerminalInputExecutionToPanels = (
  panels: TerminalPanel[],
  execution: TerminalPanelInputExecution
): TerminalPanelInputRecord[] => {
  const records: TerminalPanelInputRecord[] = []
  execution.panelIds.forEach((panelId) => {
    const panel = findTerminalPanelByIdOrSession(panels, panelId)
    if (!panel) return
    appendTerminalSegment(panel, execution.inputText, 'input')
    if (execution.source !== 'snippet') {
      records.push({ panel, text: execution.shellText || execution.inputText })
    }
  })
  return records
}

export const collectTerminalInputExecutionRecords = (
  panels: TerminalPanel[],
  execution: TerminalPanelInputExecution
): TerminalPanelInputRecord[] => {
  if (execution.source === 'snippet') return []
  return execution.panelIds.flatMap((panelId) => {
    const panel = findTerminalPanelByIdOrSession(panels, panelId)
    return panel ? [{ panel, text: execution.shellText || execution.inputText }] : []
  })
}

export const resolveTerminalPanelSessionWrite = (panels: TerminalPanel[], panelId: string): TerminalPanelSessionWrite | null => {
  const panel = findTerminalPanelByIdOrSession(panels, panelId)
  if (!panel?.sessionId) return null
  return { panel, sessionId: panel.sessionId }
}

export const resolveTerminalPanelSessionWrites = (
  panels: TerminalPanel[],
  panelIds: string[]
): TerminalPanelSessionWrite[] | null => {
  const writes: TerminalPanelSessionWrite[] = []
  for (const panelId of panelIds) {
    const write = resolveTerminalPanelSessionWrite(panels, panelId)
    if (!write) return null
    writes.push(write)
  }
  return writes
}

export const canWriteTerminalPanels = (panels: TerminalPanel[], execution: Pick<TerminalPanelInputExecution, 'panelIds' | 'writeToShell'>) => {
  if (!execution.writeToShell) return true
  return Boolean(resolveTerminalPanelSessionWrites(panels, execution.panelIds))
}

export const liveTerminalPanelIds = (panels: TerminalPanel[]) =>
  panels.filter((panel) => isTerminalWorkspacePanel(panel) && panel.sessionId).map((panel) => panel.id)

export const terminalPanelIds = (panels: TerminalPanel[]) => panels.filter((panel) => isTerminalWorkspacePanel(panel)).map((panel) => panel.id)

export const resolveActiveWritableTerminalPanel = (panels: TerminalPanel[], activePanel: TerminalPanel) =>
  isTerminalWorkspacePanel(activePanel) ? activePanel : panels.find((item) => isTerminalWorkspacePanel(item)) || null

export const appendGeneratedTerminalCommandToPanel = (panels: TerminalPanel[], panelId: string, command: string) => {
  const panel = findTerminalPanelByIdOrSession(panels, panelId)
  const text = command.trim()
  if (!panel || !isTerminalWorkspacePanel(panel) || !text) return null
  appendTerminalSegment(panel, text, 'input')
  return { panel, text }
}

export const registerTerminalSshSession = (panel: TerminalPanel, asset: TerminalLaunchAsset): TerminalSshSession => {
  const title = asset.name || asset.title || asset.host
  const session: TerminalSshSession = {
    host: asset.host,
    port: Number(asset.port) || 22,
    username: asset.username || 'root',
    assetId: asset.id,
    assetName: title,
    assetType: asset.asset_type,
    organizationId: asset.group_name,
    authType: asset.auth_type,
    needProxy: Boolean(asset.needProxy),
    proxyName: asset.proxyName || '',
    jumpHostId: asset.jumpHostId
  }
  panel.kind = 'terminal'
  panel.sshSession = session
  return session
}

export const terminalSshSessionFromConnection = (
  connection: TerminalSshConnectionInfo,
  asset: TerminalSessionAsset | undefined,
  previous: TerminalSshSession | undefined
): TerminalSshSession => ({
  connectionId: connection.connectionId,
  sourcePanelId: previous?.sourcePanelId,
  forkFromConnectionId: connection.forkFromConnectionId || previous?.forkFromConnectionId,
  host: connection.host || asset?.host || previous?.host || '',
  port: Number(connection.port || asset?.port || previous?.port || 22),
  username: connection.username || asset?.username || previous?.username || 'root',
  assetId: connection.assetId || asset?.id || previous?.assetId,
  assetName: connection.assetName || asset?.name || asset?.title || previous?.assetName || connection.host || 'ssh',
  assetType: connection.assetType || asset?.asset_type || previous?.assetType,
  organizationId: connection.organizationId || asset?.group_name || previous?.organizationId,
  authType: connection.authType || asset?.auth_type || previous?.authType,
  needProxy: Boolean(connection.needProxy || asset?.needProxy || previous?.needProxy),
  proxyName: connection.proxyName || asset?.proxyName || previous?.proxyName || '',
  jumpHostId: connection.jumpHostId || asset?.jumpHostId || previous?.jumpHostId,
  createdAt: connection.createdAt
})

export const applySshTerminalSessionToPanel = (
  panel: TerminalPanel,
  terminalSession: TerminalSessionInfo & { connection: TerminalSshConnectionInfo },
  asset?: TerminalSessionAsset
) => {
  const session = terminalSshSessionFromConnection(terminalSession.connection, asset, panel.sshSession)
  panel.sessionId = terminalSession.id
  panel.classicTarget = terminalSession.classicTarget ? { ...terminalSession.classicTarget } : undefined
  panel.cwd = terminalSession.cwd || panel.cwd
  panel.kind = 'terminal'
  panel.status = 'connecting'
  panel.sshSession = session
  panel.title = session.assetName || session.host || panel.title
  return session
}

export const applyLocalTerminalSessionToPanel = (panel: TerminalPanel, terminalSession: TerminalSessionInfo) => {
  panel.sessionId = terminalSession.id
  panel.classicTarget = terminalSession.classicTarget ? { ...terminalSession.classicTarget } : undefined
  panel.cwd = terminalSession.cwd || panel.cwd
  panel.title = terminalShellTitle(terminalSession.shell)
  panel.kind = 'terminal'
  panel.status = 'running'
  panel.sshSession = undefined
  return panel
}

export const terminalLifecycleMatchesPanel = (panel: TerminalPanel, event: TerminalLifecycleEvent) => {
  if (panel.terminalLifecycle?.id === event.id && panel.terminalLifecycle.kind !== event.kind) return false
  if (event.kind === 'local' && panel.sshSession && (panel.sessionId === event.id || panel.terminalLifecycle?.id === event.id)) return false
  return true
}

export const terminalExitMatchesPanel = (panel: TerminalPanel, event: TerminalExitEvent) => {
  if (event.kind && panel.terminalLifecycle?.id === event.id && panel.terminalLifecycle.kind !== event.kind) return false
  if (event.kind === 'local' && panel.sshSession && (panel.sessionId === event.id || panel.terminalLifecycle?.id === event.id)) return false
  if (event.kind === 'ssh' && !panel.sshSession && panel.terminalLifecycle?.kind !== 'ssh') return false
  return true
}

export const terminalSshSessionFromLifecycle = (panel: TerminalPanel, event: TerminalLifecycleEvent): TerminalSshSession | null => {
  const previous = panel.sshSession
  const connectionId = event.connectionId || previous?.connectionId
  const host = event.host || previous?.host
  const port = isTerminalPanelPort(event.port) ? event.port : previous?.port
  const username = event.username || previous?.username
  if (!isNonEmptyText(connectionId) || !isNonEmptyText(host) || !isTerminalPanelPort(port) || !isNonEmptyText(username)) return null
  if (!previous && (!event.connectionId || !event.host || !event.username || !isTerminalPanelPort(event.port))) return null
  return {
    connectionId,
    sourcePanelId: previous?.sourcePanelId,
    forkFromConnectionId: previous?.forkFromConnectionId,
    host,
    port,
    username,
    assetId: previous?.assetId,
    assetName: previous?.assetName || host,
    assetType: previous?.assetType,
    organizationId: previous?.organizationId,
    jumpHostId: previous?.jumpHostId,
    authType: previous?.authType,
    needProxy: previous?.needProxy === true,
    proxyName: event.proxyName || previous?.proxyName || '',
    createdAt: previous?.createdAt
  }
}

export const applyTerminalLifecycleToPanel = (panel: TerminalPanel, event: TerminalLifecycleEvent) => {
  if (!terminalLifecycleMatchesPanel(panel, event)) return null
  const nextSshSession = event.kind === 'ssh' ? terminalSshSessionFromLifecycle(panel, event) : null
  if (event.kind === 'ssh' && !nextSshSession) return null
  panel.terminalLifecycle = event
  panel.kind = 'terminal'
  if (event.cwd) panel.cwd = event.cwd
  if (nextSshSession) panel.sshSession = nextSshSession
  if (event.stage === 'starting' || event.stage === 'connecting' || event.stage === 'proxy-opening') {
    panel.status = 'connecting'
    return panel
  }
  if (event.stage === 'connected' || event.stage === 'shell-ready') {
    panel.status = 'running'
    return panel
  }
  panel.terminalProgress = undefined
  panel.status = event.stage === 'error' ? 'error' : 'closed'
  panel.terminalExit = {
    id: event.id,
    code: event.code ?? null,
    kind: event.kind,
    reason: event.reason,
    isNetworkDisconnect: event.isNetworkDisconnect,
    errorCode: event.errorCode,
    errorMessage: event.errorMessage
  }
  if (panel.sessionId === event.id) {
    panel.sessionId = undefined
    panel.classicTarget = undefined
  }
  return panel
}

export const applyTerminalExitToPanel = (panel: TerminalPanel, event: TerminalExitEvent) => {
  if (!terminalExitMatchesPanel(panel, event)) return null
  panel.terminalExit = event
  if (panel.sessionId === event.id) {
    panel.sessionId = undefined
    panel.classicTarget = undefined
  }
  panel.status = event.reason === 'error' || event.reason === 'network' || event.errorMessage ? 'error' : 'closed'
  panel.terminalProgress = undefined
  appendTerminalSegment(panel, `\n[process exited: ${event.code ?? 'unknown'}]\n`, 'output')
  return panel
}
