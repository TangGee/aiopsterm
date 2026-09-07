import type { TerminalSessionInfo } from './terminalSessions'

export type TerminalRecoveryTab = {
  id: string
  title: string
  cwdVerified?: boolean
  cwd: string
  history: string
  resume?: boolean
  sessionId?: string
  split?: 'right' | 'below'
  splitSourceId?: string
  splitGroupId?: string
  splitOrder?: number
  ssh?: {
    host: string
    port: number
    username: string
    assetId?: string
    assetName: string
    needProxy?: boolean
    proxyName?: string
    jumpHostId?: string
  }
}

export type TerminalRecoverySnapshot = {
  version: 1
  activePanelId: string
  tabs: TerminalRecoveryTab[]
}

export type TerminalRecoveryLoadResult = {
  snapshot: TerminalRecoverySnapshot | null
  liveSessions: TerminalSessionInfo[]
}
