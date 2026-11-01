import type { ControlTerminalSummary } from '@shared/contracts/control'
import type { ImGatewayConnectionState } from '@shared/contracts/imGateway'

export type GatewayMessage = {
  provider: string
  accountId: string
  tenantId: string
  conversationId: string
  senderId: string
  messageId: string
  conversationType: 'direct' | 'group'
  createdAt: number
  text: string
}
export type GatewayPolicy = {
  allowedUserIds: string[]
  allowedGroupIds: string[]
  allowedAssetIds: string[]
  allowLocalTerminal: boolean
}
export type GatewayBinding = { sessionId: string; panelId: string }
export type GatewayTerminalPort = {
  list: () => Promise<ControlTerminalSummary[]>
  write: (binding: GatewayBinding, text: string) => Promise<void>
  read: (binding: GatewayBinding) => Promise<string>
}
export type GatewayAdapter = {
  start: (receive: (message: GatewayMessage) => Promise<void>) => Promise<void>
  stop: () => void
  reply: (message: GatewayMessage, text: string) => Promise<void>
}
export type GatewayAdapterFactory = (context: {
  accountId: string
  secret: string
  connection: (state: ImGatewayConnectionState, error?: string) => void
}) => GatewayAdapter | Promise<GatewayAdapter>
