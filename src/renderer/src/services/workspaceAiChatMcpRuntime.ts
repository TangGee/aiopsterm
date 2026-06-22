import {
  isAiMcpResourceAccessActionData,
  isAiMcpToolCallActionData,
  type AiMcpResourceAccessActionData,
  type AiMcpToolCallActionData
} from '@/services/aiChatBackendGuards'
import { aiChatClient } from '@/services/aiChatClient'
import { normalizeMcpServersConfig } from '@/services/workspaceConfigRuntime'
import type { AiChatHistoryMessage } from '@shared/contracts/aiChat'
import type { ChatMessage, WorkspaceAiChatControllerState } from '@/services/workspaceAiChatTypes'
import type { ConversationItem } from '@/services/workspaceAiChatTypes'

type AiChatMcpHistoryRuntime = {
  upsertConversationRecord: (conversation: {
    id: string
    title: string
    summary: string
    updatedAt: string
    ts: number
    ipAddress?: string
    favorite?: boolean
  }) => ConversationItem
  applyChatMessageSnapshot: (messages: AiChatHistoryMessage[]) => void
  updateCurrentConversationSnapshot: (summary?: string, options?: { notifyUnavailable?: boolean; notifyFailure?: boolean }) => Promise<boolean>
}

export const createWorkspaceAiChatMcpRuntime = (input: {
  state: Pick<WorkspaceAiChatControllerState, 'chatMessages' | 'selectedConversationId' | 'mcpConfigEditorContent'>
  history: AiChatMcpHistoryRuntime
  setTopNotice: (message: string) => void
  applyMcpServersSnapshot: (snapshot: ReturnType<typeof normalizeMcpServersConfig>) => void
}) => {
  const { state, history, setTopNotice, applyMcpServersSnapshot } = input
  const { chatMessages, selectedConversationId, mcpConfigEditorContent } = state

  const applyAiMcpToolCallResult = (data: AiMcpToolCallActionData) => {
    history.upsertConversationRecord(data.conversation)
    history.applyChatMessageSnapshot(data.messages)
    if (data.mcpConfig) {
      applyMcpServersSnapshot(normalizeMcpServersConfig(data.mcpConfig.mcpServers, data.mcpConfig.mcpToolStates))
      mcpConfigEditorContent.value = JSON.stringify(data.mcpConfig.mcpConfig, null, 2)
    }
  }

  const applyAiMcpResourceAccessResult = (data: AiMcpResourceAccessActionData) => {
    history.upsertConversationRecord(data.conversation)
    history.applyChatMessageSnapshot(data.messages)
  }

  const runAiMcpToolCallAction = async (messageId: string, action: 'approve' | 'reject', options: { autoApprove?: boolean } = {}) => {
    const message = chatMessages.value.find((item: ChatMessage) => item.id === messageId)
    if (!message?.mcpToolCall || message.ask !== 'mcp_tool_call') return false
    if (!selectedConversationId.value) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const bridge = action === 'approve' ? aiChatClient.approveAiMcpToolCall() : aiChatClient.rejectAiMcpToolCall()
    if (typeof bridge !== 'function') {
      setTopNotice('AI MCP 工具审批服务不可用')
      return false
    }
    const synced = await history.updateCurrentConversationSnapshot(undefined, { notifyUnavailable: true, notifyFailure: true })
    if (!synced) return false
    const result = await bridge({
      conversationId: selectedConversationId.value,
      messageId,
      autoApprove: options.autoApprove
    })
    if (!result?.ok || !isAiMcpToolCallActionData(result.data)) {
      setTopNotice(result?.errorMessage || 'AI MCP 工具审批失败')
      return false
    }
    applyAiMcpToolCallResult(result.data)
    return result.data.status
  }

  const runAiMcpResourceAccessAction = async (messageId: string, action: 'approve' | 'reject') => {
    const message = chatMessages.value.find((item: ChatMessage) => item.id === messageId)
    if (!message?.mcpResourceAccess || message.ask !== 'mcp_resource_access') return false
    if (!selectedConversationId.value) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const bridge = action === 'approve' ? aiChatClient.approveAiMcpResourceAccess() : aiChatClient.rejectAiMcpResourceAccess()
    if (typeof bridge !== 'function') {
      setTopNotice('AI MCP 资源审批服务不可用')
      return false
    }
    const synced = await history.updateCurrentConversationSnapshot(undefined, { notifyUnavailable: true, notifyFailure: true })
    if (!synced) return false
    const result = await bridge({
      conversationId: selectedConversationId.value,
      messageId
    })
    if (!result?.ok || !isAiMcpResourceAccessActionData(result.data)) {
      setTopNotice(result?.errorMessage || 'AI MCP 资源审批失败')
      return false
    }
    applyAiMcpResourceAccessResult(result.data)
    return result.data.status
  }

  return {
    approveAiMcpToolCall: (messageId: string, options: { autoApprove?: boolean } = {}) => runAiMcpToolCallAction(messageId, 'approve', options),
    rejectAiMcpToolCall: (messageId: string) => runAiMcpToolCallAction(messageId, 'reject'),
    approveAiMcpResourceAccess: (messageId: string) => runAiMcpResourceAccessAction(messageId, 'approve'),
    rejectAiMcpResourceAccess: (messageId: string) => runAiMcpResourceAccessAction(messageId, 'reject')
  }
}
