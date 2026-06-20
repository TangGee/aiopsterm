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
