import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type AiChatBridge = Pick<
  AiopsPreloadApi,
  | 'createAiChatExchangeRequest'
  | 'generateAiChatResponse'
  | 'cancelAiChatResponse'
  | 'approveAiMcpToolCall'
  | 'rejectAiMcpToolCall'
  | 'approveAiMcpResourceAccess'
  | 'rejectAiMcpResourceAccess'
>

const bridgeMethod = <Name extends keyof AiChatBridge>(name: Name): AiChatBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as AiChatBridge[Name]) : undefined
}

export const aiChatClient = {
  createAiChatExchangeRequest: () => bridgeMethod('createAiChatExchangeRequest'),
  generateAiChatResponse: () => bridgeMethod('generateAiChatResponse'),
  cancelAiChatResponse: () => bridgeMethod('cancelAiChatResponse'),
  approveAiMcpToolCall: () => bridgeMethod('approveAiMcpToolCall'),
  rejectAiMcpToolCall: () => bridgeMethod('rejectAiMcpToolCall'),
  approveAiMcpResourceAccess: () => bridgeMethod('approveAiMcpResourceAccess'),
  rejectAiMcpResourceAccess: () => bridgeMethod('rejectAiMcpResourceAccess')
}
