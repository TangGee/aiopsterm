import type { AiopsMutationResult } from './common'

export type ExportMcpClientSource = 'codex' | 'claude-code'
export type ExportMcpServerId = 'hosts' | 'ai-sessions' | 'databases'

export type ExportMcpBridgeStatus = {
  enabled: boolean
  listening: boolean
  tokenConfigured: boolean
  socketPath: string
}

export type ExportMcpClientStatus = {
  serverId: ExportMcpServerId
  source: ExportMcpClientSource
  label: string
  binaryName: string
  binaryPath: string
  configPath: string
  configExists: boolean
  installed: boolean
  scriptPath: string
  runtimePath: string
  serverName: string
  bridge: ExportMcpBridgeStatus
  warnings: string[]
  error?: string
}

export type ExportMcpInstallerSnapshot = {
  bridge: ExportMcpBridgeStatus
  clients: ExportMcpClientStatus[]
}

export type ExportMcpInstallerOperationInput = {
  source: ExportMcpClientSource
  serverId: ExportMcpServerId
}

export type ExportMcpInstallerOperation = 'install' | 'uninstall'

export type ExportMcpInstallerOperationResult = AiopsMutationResult<{
  operation: ExportMcpInstallerOperation
  source: ExportMcpClientSource
  status: ExportMcpClientStatus
  snapshot: ExportMcpInstallerSnapshot
}>

export type ExportMcpInstallerListResult = AiopsMutationResult<ExportMcpInstallerSnapshot>

export type ExportMcpCopyConfigKind = 'json' | 'command'

export type ExportMcpCopyConfigInput = {
  kind: ExportMcpCopyConfigKind
  serverId: ExportMcpServerId
}

export type ExportMcpCopyConfigResult = AiopsMutationResult<{
  kind: ExportMcpCopyConfigKind
  serverId: ExportMcpServerId
}>

export type ExportMcpTokenResetResult = AiopsMutationResult<{
  snapshot: ExportMcpInstallerSnapshot
}>
