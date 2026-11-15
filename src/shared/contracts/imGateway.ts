import type { ControlTerminalSummary } from './control'

export type ImGatewayConfig = {
  provider: string
  enabled: boolean
  accountId: string
  appKey?: string
  allowedUserIds: string[]
  allowedGroupIds: string[]
  allowedAssetIds: string[]
  allowLocalTerminal: boolean
}
export type ImGatewaySaveInput = { config: ImGatewayConfig; appSecret?: string }
export type ImGatewayConnectionState = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type ImGatewayStatus = {
  config: ImGatewayConfig
  hasAppSecret: boolean
  connection: ImGatewayConnectionState
  error: string
  pending: number
  bindings: number
  lastMessageAt?: number
}
export type ImGatewaySettingsResult = { ok: boolean; status?: ImGatewayStatus; error?: string }
export type ImGatewayTerminalList = { ok: boolean; terminals: ControlTerminalSummary[]; error?: string }
export const defaultImGatewayConfig: ImGatewayConfig = {
  provider: 'feishu', enabled: false, accountId: '', allowedUserIds: [], allowedGroupIds: [], allowedAssetIds: [], allowLocalTerminal: false
}
