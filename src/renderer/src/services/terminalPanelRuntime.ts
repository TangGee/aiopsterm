import type { TerminalExitEvent, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'

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
  kind?: 'terminal' | 'knowledge'
  split?: PanelDirection
  splitSourceId?: string
  splitGroupId?: string
  splitOrder?: number
  sessionId?: string
  knowledge?: {
    relPath: string
    isImage: boolean
    startLine?: number
    endLine?: number
    jumpToken?: number
  }
  sshSession?: TerminalSshSession
  terminalLifecycle?: TerminalLifecycleEvent
  terminalExit?: TerminalExitEvent
}

export const defaultTerminalPanelTitle = '欢迎'

export const isNonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

export const createTerminalSegments = (text: string, scope: TerminalOutputScope = 'output'): TerminalOutputSegment[] => (text ? [{ text, scope }] : [])

export const appendTerminalSegment = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  if (!text) return
  panel.output += text
  if (!panel.outputSegments) {
    panel.outputSegments = []
  }
  panel.outputSegments.push({ text, scope })
}

export const setTerminalOutput = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  panel.output = text
  panel.outputSegments = createTerminalSegments(text, scope)
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
  panel.kind !== 'knowledge' &&
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
  panel.knowledge = undefined
  panel.sshSession = undefined
  panel.terminalLifecycle = undefined
  panel.terminalExit = undefined
  setTerminalOutput(panel, '')
}

export const createForkSshTerminalPanel = (id: string, source: TerminalPanel): TerminalPanel | null => {
  if (!source.sshSession?.connectionId) return null
  const sourceSession = source.sshSession
  return {
    id,
    title: `${source.title} fork`,
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
