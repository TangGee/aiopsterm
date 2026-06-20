import type { AiopsMutationResult } from './common'

export type CodexSessionCreateOptions = {
  cols?: number
  rows?: number
  target?: CodexSessionTargetContext
}

export type CodexSessionTargetContext = {
  panelId?: string
  sessionId?: string
  kind?: 'local' | 'ssh' | 'unknown'
  label?: string
  host?: string
  port?: number
  username?: string
  assetId?: string
  assetName?: string
  cwd?: string
}

export type CodexSessionLifecycleStage = 'starting' | 'ready' | 'error' | 'closed'

export type CodexSessionLifecycleEvent = {
  id: string
  stage: CodexSessionLifecycleStage
  at: number
  binaryPath?: string
  codexHome?: string
  cwd?: string
  runtimeKind?: 'pty' | 'process'
  code?: number | null
  message?: string
  errorCode?: string
  errorMessage?: string
}

export type CodexSessionInfo = {
  id: string
  binaryPath: string
  cwd: string
  codexHome: string
  runtimeKind: 'pty' | 'process'
  lifecycle?: CodexSessionLifecycleEvent
}

export type CodexSessionDataEvent = {
  id: string
  data: string
  raw?: number[]
}

export type CodexSessionExitEvent = {
  id: string
  code: number | null
  errorCode?: string
  errorMessage?: string
}

export type CodexSessionWriteResult = AiopsMutationResult<{
  id: string
  bytes: number
}>

export type CodexSessionKillResult = AiopsMutationResult<{
  id: string
}>

export type CodexSessionTargetUpdateResult = AiopsMutationResult<{
  sessionId?: string
  target?: CodexSessionTargetContext
  registered: boolean
}>

export type CodexSessionPendingContextResult = AiopsMutationResult<{
  id: string
  bytes: number
  cleared: boolean
}>
