import type { AiopsMutationResult } from './common'

export type TerminalCreateOptions = {
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
  terminalType?: string
  panelId?: string
  workspaceId?: string
  kind?: 'local' | 'ssh'
  assetId?: string
  title?: string
  ssh?: {
    host: string
    port?: number
    username: string
    password?: string
    privateKey?: string
    passphrase?: string
    needProxy?: boolean
    proxyName?: string
    jumpHostId?: string
    forkFromConnectionId?: string
  }
}

export type TerminalSshConnectionInfo = {
  connectionId: string
  host: string
  port: number
  username: string
  assetId?: string
  assetName: string
  assetType?: string
  organizationId?: string
  authType?: string
  jumpHostId?: string
  needProxy?: boolean
  proxyName?: string
  title?: string
  createdAt: number
  forkFromConnectionId?: string
}

export type TerminalSessionInfo = {
  id: string
  shell: string
  cwd: string
  kind?: 'local' | 'ssh'
  connection?: TerminalSshConnectionInfo
  lifecycle?: TerminalLifecycleEvent
}

export type TerminalWriteResult = AiopsMutationResult<{
  id: string
  bytes: number
}>

export type TerminalKillResult = AiopsMutationResult<{
  id: string
}>

export type TerminalDataEvent = {
  id: string
  data: string
  raw?: number[]
}

export type TerminalBinaryWriteResult = AiopsMutationResult<{
  id: string
  bytes: number
}>

export type TerminalLifecycleStage = 'starting' | 'connecting' | 'proxy-opening' | 'connected' | 'shell-ready' | 'error' | 'closed'

export type TerminalDisconnectReason = 'manual' | 'network' | 'process' | 'error' | 'unknown'

export type TerminalLifecycleEvent = {
  id: string
  kind: 'local' | 'ssh'
  stage: TerminalLifecycleStage
  at: number
  processId?: number
  processGroupId?: number
  shell?: string
  cwd?: string
  host?: string
  port?: number
  username?: string
  targetHost?: string
  targetPort?: number
  targetUsername?: string
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  authScope?: 'target' | 'jump'
  authPurpose?: 'password' | 'keyboard-interactive'
  sshTransport?: 'direct' | 'proxy' | 'jump' | 'relay-shell'
  sshAuthMethods?: string
  connectionReuse?: 'created' | 'reused'
  remoteHop?: 'relay' | 'target' | 'unknown'
  expectedHost?: string
  actualHost?: string
  actualUsername?: string
  endpointConfidence?: 'confirmed' | 'inferred' | 'unknown'
  connectionId?: string
  proxyName?: string
  message?: string
  code?: number | null
  reason?: TerminalDisconnectReason
  isNetworkDisconnect?: boolean
  errorCode?: string
  errorMessage?: string
}

export type TerminalExitEvent = {
  id: string
  code: number | null
  kind?: 'local' | 'ssh'
  reason?: TerminalDisconnectReason
  isNetworkDisconnect?: boolean
  errorCode?: string
  errorMessage?: string
}

export type TerminalKeyboardInteractivePrompt = {
  prompt: string
  echo: boolean
}

export type TerminalKeyboardInteractiveResponse = {
  responses: string[]
  rememberPassword?: boolean
}

export type TerminalKeyboardInteractiveRequest = {
  id: string
  connectionId: string
  host: string
  port: number
  username: string
  purpose?: 'password' | 'keyboard-interactive'
  authScope?: 'target' | 'jump'
  assetId?: string
  canRememberPassword?: boolean
  title?: string
  name?: string
  instructions?: string
  prompts: TerminalKeyboardInteractivePrompt[]
  attempts: number
  maxAttempts: number
  timeoutMs: number
}

export type TerminalKeyboardInteractiveResult = {
  id: string
  status: 'success' | 'failed' | 'canceled' | 'timeout'
  authScope?: 'target' | 'jump'
  attempts?: number
  final?: boolean
  errorMessage?: string
}
