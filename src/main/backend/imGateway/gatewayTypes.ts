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
  actionToken?: string
  replyToMessageId?: string
}
export type GatewayPolicy = {
  allowedUserIds: string[]
  allowedGroupIds: string[]
  allowedAssetIds: string[]
  allowLocalTerminal: boolean
}
export type GatewayCard = { title: string; text: string; buttons: { label: string; token: string }[] }
export type GatewayReply = string | GatewayCard
export type GatewayHost = { id: string; name: string; host: string }
export type GatewayBinding = { sessionId: string; panelId: string }
export type GatewayScreenSender = (message: GatewayMessage, text: string, previousMessageId?: string) => Promise<string>
export type GatewayTerminalPort = {
  list: () => Promise<ControlTerminalSummary[]>
  hosts?: () => Promise<GatewayHost[]>
  create?: (assetId?: string, active?: () => boolean) => Promise<ControlTerminalSummary>
  subscribe?: (binding: GatewayBinding, receive: (data: string) => void) => () => void
  write: (binding: GatewayBinding, text: string) => Promise<void>
  read: (binding: GatewayBinding) => Promise<string>
}
export type GatewayAdapter = {
  start: (receive: (message: GatewayMessage) => Promise<void>) => Promise<void>
  stop: () => void
  send?: (message: GatewayMessage, text: string) => Promise<void>
  sendScreen?: GatewayScreenSender
  reply: (message: GatewayMessage, text: GatewayReply) => Promise<void>
}
export type GatewayAdapterFactory = (context: {
  accountId: string
  secret: string
  connection: (state: ImGatewayConnectionState, error?: string) => void
}) => GatewayAdapter | Promise<GatewayAdapter>
