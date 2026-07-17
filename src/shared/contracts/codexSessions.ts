import type { AiopsMutationResult } from './common'

export type CodexSessionCreateOptions = {
  cols?: number
  rows?: number
  target?: CodexSessionTargetContext
  productSessionId?: string
  projectRoot?: string
  launch?: CodexSessionLaunch
}

export type CodexSessionLaunch =
  | { mode: 'new' }
  | { mode: 'resume'; threadId: string }
  | { mode: 'fork'; threadId: string }

export type CodexSessionTargetContext = {
  panelId?: string
  sessionId?: string
  kind?: 'local' | 'ssh' | 'unknown'
  label?: string
  host?: string
  port?: number
  username?: string
  assetId?: string
  connectionId?: string
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
  launch?: CodexSessionLaunch
  recoveredFromThreadId?: string
}

export type CodexSessionDataEvent = {
  id: string
  data: string
  raw?: number[]
}

export type CodexSessionThreadEvent = {
  id: string
  threadId: string
  previousThreadId?: string | null
  reason: 'new' | 'resume' | 'fork' | 'switch'
  at: number
  title?: string
  cwd?: string
  rolloutPath?: string
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
  codexRuntimeId?: string
  sessionId?: string
  target?: CodexSessionTargetContext
  registered: boolean
}>

export type CodexSessionPendingContextResult = AiopsMutationResult<{
  id: string
  bytes: number
  cleared: boolean
}>
