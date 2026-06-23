import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type AiChatBridge = Pick<
  AiopsPreloadApi,
  | 'createAiChatExchangeRequest'
  | 'generateAiChatResponse'
  | 'cancelAiChatResponse'
  | 'approveAiMcpToolCall'
  | 'rejectAiMcpToolCall'
  | 'approveAiMcpResourceAccess'
  | 'rejectAiMcpResourceAccess'
  | 'exportChat'
>

const bridgeMethod = createBridgeMethod<AiChatBridge>()

export const aiChatClient = {
  createAiChatExchangeRequest: () => bridgeMethod('createAiChatExchangeRequest'),
  generateAiChatResponse: () => bridgeMethod('generateAiChatResponse'),
  cancelAiChatResponse: () => bridgeMethod('cancelAiChatResponse'),
  approveAiMcpToolCall: () => bridgeMethod('approveAiMcpToolCall'),
  rejectAiMcpToolCall: () => bridgeMethod('rejectAiMcpToolCall'),
  approveAiMcpResourceAccess: () => bridgeMethod('approveAiMcpResourceAccess'),
  rejectAiMcpResourceAccess: () => bridgeMethod('rejectAiMcpResourceAccess'),
  exportChat: () => bridgeMethod('exportChat')
}
