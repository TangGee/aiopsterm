import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { exportChat } from '../backend/chatExport'
import type {
  AiChatConversationRecord,
  AiChatExportInput,
  AiChatExportResult,
  AiChatHistoryMessage,
  AiMcpResourceAccessActionInput,
  AiMcpResourceAccessActionResult,
  AiMcpToolCallActionInput,
  AiMcpToolCallActionResult,
  AiopsMutationResult
} from '@shared/preload'
import type {
  McpConfigWriteResult,
  McpResourceReadInput,
  McpResourceReadResult,
  McpToolCallInput,
  McpToolCallResult
} from '@shared/contracts/mcp'

type SaveDialogOptions = {
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

type SaveDialogResult = {
  canceled?: boolean
  filePath?: string
}

type ChatConversationMessagesSnapshot = {
  conversation: AiChatConversationRecord
  messages: AiChatHistoryMessage[]
}

type RegisterAiChatActionsIpcInput = {
  getChatConversationMessages: (conversationId: string) => AiopsMutationResult<ChatConversationMessagesSnapshot>
  replaceChatConversationMessages: (
    conversationId: string,
    messages: AiChatHistoryMessage[]
  ) => AiopsMutationResult<{
    conversation: AiChatConversationRecord
    messages: AiChatHistoryMessage[]
  }>
  setMcpToolAutoApprove: (serverName: string, toolName: string, autoApprove: boolean) => Promise<McpConfigWriteResult>
  callMcpTool: (input: McpToolCallInput) => Promise<McpToolCallResult>
  readMcpResource: (input: McpResourceReadInput) => Promise<McpResourceReadResult>
  formatMcpResourceReadContent: (contents: NonNullable<McpResourceReadResult['data']>['contents']) => string
  showChatExportSaveDialog: (event: IpcMainInvokeEvent, options: SaveDialogOptions) => Promise<SaveDialogResult>
}

const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

const cloneChatHistoryMessages = (messages: AiChatHistoryMessage[]) => JSON.parse(JSON.stringify(messages)) as AiChatHistoryMessage[]

const formatMcpToolCallContent = (content: NonNullable<McpToolCallResult['data']>['content']) => {
  if (!content.length) return '[]'
  return content
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.data === 'string') return item.data
      return JSON.stringify(item, null, 2)
    })
    .join('\n\n')
}

const aiMcpToolCallAction = async (
  input: AiMcpToolCallActionInput,
  approve: boolean,
  runtime: RegisterAiChatActionsIpcInput
): Promise<AiMcpToolCallActionResult> => {
  const conversationId = String(input?.conversationId || '').trim()
  const messageId = String(input?.messageId || '').trim()
  if (!conversationId || !messageId) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_TARGET_REQUIRED',
      errorMessage: 'AI MCP tool call approval requires a conversation and message id.'
    }
  }
  const snapshot = runtime.getChatConversationMessages(conversationId)
  if (!snapshot.ok || !snapshot.data) {
    return {
      ok: false,
      errorCode: snapshot.errorCode || 'AI_MCP_TOOL_CALL_HISTORY_UNAVAILABLE',
      errorMessage: snapshot.errorMessage || 'AI chat history is unavailable.'
    }
  }
  const messageIndex = snapshot.data.messages.findIndex((message) => message.id === messageId)
  const message = messageIndex >= 0 ? snapshot.data.messages[messageIndex] : undefined
  if (!message || message.ask !== 'mcp_tool_call' || !message.mcpToolCall) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_NOT_FOUND',
      errorMessage: 'AI MCP tool call message was not found.'
    }
  }
  const nextMessages = cloneChatHistoryMessages(snapshot.data.messages)
  const nextMessage = nextMessages[messageIndex]
  if (!approve) {
    nextMessage.action = 'rejected'
    nextMessage.state = 'done'
    const saved = runtime.replaceChatConversationMessages(conversationId, nextMessages)
    if (!saved.ok || !saved.data) {
      return {
        ok: false,
        errorCode: saved.errorCode || 'AI_MCP_TOOL_CALL_REJECT_SAVE_FAILED',
        errorMessage: saved.errorMessage || 'AI MCP tool rejection could not be saved.'
      }
    }
    return {
      ok: true,
      data: {
        status: 'rejected',
        conversation: saved.data.conversation,
        messages: saved.data.messages
      }
    }
  }

  let mcpConfig: NonNullable<AiMcpToolCallActionResult['data']>['mcpConfig']
  if (input.autoApprove) {
    try {
      const autoApproveResult = await runtime.setMcpToolAutoApprove(message.mcpToolCall.serverName, message.mcpToolCall.toolName, true)
      mcpConfig = autoApproveResult.data
    } catch (error) {
      return {
        ok: false,
        errorCode: 'AI_MCP_TOOL_AUTO_APPROVE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'AI MCP tool auto approve could not be saved.'
      }
    }
  }

  const toolInput: McpToolCallInput = {
    serverName: message.mcpToolCall.serverName,
    toolName: message.mcpToolCall.toolName,
    arguments: cloneJsonRecord(message.mcpToolCall.arguments) || {}
  }
  const toolResult = await runtime.callMcpTool(toolInput)
  nextMessage.action = 'approved'
  nextMessage.state = toolResult.ok && toolResult.data && !toolResult.data.isError ? 'done' : 'error'
  nextMessage.say = 'command_output'
  nextMessage.text = toolResult.ok && toolResult.data ? formatMcpToolCallContent(toolResult.data.content) : toolResult.errorMessage || 'MCP tool call failed.'
  const saved = runtime.replaceChatConversationMessages(conversationId, nextMessages)
  if (!saved.ok || !saved.data) {
    return {
      ok: false,
      errorCode: saved.errorCode || 'AI_MCP_TOOL_CALL_SAVE_FAILED',
      errorMessage: saved.errorMessage || 'AI MCP tool call result could not be saved.'
    }
  }
  return {
    ok: true,
    data: {
      status: 'approved',
      conversation: saved.data.conversation,
      messages: saved.data.messages,
      ...(toolResult.ok && toolResult.data
        ? { toolCall: toolResult.data }
        : { toolCallError: { errorCode: toolResult.errorCode, errorMessage: toolResult.errorMessage || 'MCP tool call failed.' } }),
      ...(mcpConfig ? { mcpConfig } : {})
    }
  }
}

const aiMcpResourceAccessAction = async (
  input: AiMcpResourceAccessActionInput,
  approve: boolean,
  runtime: RegisterAiChatActionsIpcInput
): Promise<AiMcpResourceAccessActionResult> => {
  const conversationId = String(input?.conversationId || '').trim()
  const messageId = String(input?.messageId || '').trim()
  if (!conversationId || !messageId) {
    return {
      ok: false,
      errorCode: 'AI_MCP_RESOURCE_ACCESS_TARGET_REQUIRED',
      errorMessage: 'AI MCP resource access approval requires a conversation and message id.'
    }
  }
  const snapshot = runtime.getChatConversationMessages(conversationId)
  if (!snapshot.ok || !snapshot.data) {
    return {
      ok: false,
      errorCode: snapshot.errorCode || 'AI_MCP_RESOURCE_ACCESS_HISTORY_UNAVAILABLE',
      errorMessage: snapshot.errorMessage || 'AI chat history is unavailable.'
    }
  }
  const messageIndex = snapshot.data.messages.findIndex((message) => message.id === messageId)
  const message = messageIndex >= 0 ? snapshot.data.messages[messageIndex] : undefined
  if (!message || message.ask !== 'mcp_resource_access' || !message.mcpResourceAccess) {
    return {
      ok: false,
      errorCode: 'AI_MCP_RESOURCE_ACCESS_NOT_FOUND',
      errorMessage: 'AI MCP resource access message was not found.'
    }
  }
  const nextMessages = cloneChatHistoryMessages(snapshot.data.messages)
  const nextMessage = nextMessages[messageIndex]
  if (!approve) {
    nextMessage.action = 'rejected'
    nextMessage.state = 'done'
    const saved = runtime.replaceChatConversationMessages(conversationId, nextMessages)
    if (!saved.ok || !saved.data) {
      return {
        ok: false,
        errorCode: saved.errorCode || 'AI_MCP_RESOURCE_ACCESS_REJECT_SAVE_FAILED',
        errorMessage: saved.errorMessage || 'AI MCP resource access rejection could not be saved.'
      }
    }
    return {
      ok: true,
      data: {
        status: 'rejected',
        conversation: saved.data.conversation,
        messages: saved.data.messages
      }
    }
  }

  const resourceInput: McpResourceReadInput = {
    serverName: message.mcpResourceAccess.serverName,
    uri: message.mcpResourceAccess.uri
  }
  const resourceResult = await runtime.readMcpResource(resourceInput)
  nextMessage.action = 'approved'
  nextMessage.say = 'command_output'
  nextMessage.state = resourceResult.ok && resourceResult.data ? 'done' : 'error'
  nextMessage.text =
    resourceResult.ok && resourceResult.data ? runtime.formatMcpResourceReadContent(resourceResult.data.contents) : resourceResult.errorMessage || 'MCP resource access failed.'
  const saved = runtime.replaceChatConversationMessages(conversationId, nextMessages)
  if (!saved.ok || !saved.data) {
    return {
      ok: false,
      errorCode: saved.errorCode || 'AI_MCP_RESOURCE_ACCESS_SAVE_FAILED',
      errorMessage: saved.errorMessage || 'AI MCP resource access result could not be saved.'
    }
  }
  return {
    ok: true,
    data: {
      status: 'approved',
      conversation: saved.data.conversation,
      messages: saved.data.messages,
      ...(resourceResult.ok && resourceResult.data
        ? { resourceAccess: resourceResult.data }
        : { resourceAccessError: { errorCode: resourceResult.errorCode, errorMessage: resourceResult.errorMessage || 'MCP resource access failed.' } })
    }
  }
}

export const registerAiChatActionsIpc = (ipcMain: IpcMain, input: RegisterAiChatActionsIpcInput) => {
  ipcMain.handle('ai:mcp-tool-call:approve', (_event, actionInput: AiMcpToolCallActionInput) => aiMcpToolCallAction(actionInput, true, input))
  ipcMain.handle('ai:mcp-tool-call:reject', (_event, actionInput: AiMcpToolCallActionInput) => aiMcpToolCallAction(actionInput, false, input))
  ipcMain.handle('ai:mcp-resource-access:approve', (_event, actionInput: AiMcpResourceAccessActionInput) => aiMcpResourceAccessAction(actionInput, true, input))
  ipcMain.handle('ai:mcp-resource-access:reject', (_event, actionInput: AiMcpResourceAccessActionInput) => aiMcpResourceAccessAction(actionInput, false, input))
  ipcMain.handle('chat:export', async (event, exportInput: AiChatExportInput): Promise<AiChatExportResult> =>
    exportChat(exportInput, {
      showSaveDialog: (options) => input.showChatExportSaveDialog(event, options)
    })
  )
}
