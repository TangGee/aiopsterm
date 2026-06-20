import { describe, expect, it } from 'vitest'
import {
  aiBridgeErrorMessage,
  aiChatRequestIdFromAssistantMessageId,
  isAiChatCancelDataForRequest,
  isAiChatConversationDeleteData,
  isAiChatConversationMutationData,
  isAiChatConversationRestoreData,
  isAiChatExchangeRequestDataForRequest,
  isAiChatHistoryMessage,
  isAiChatHistorySnapshotData,
  isAiChatMessageMetadataData,
  isAiChatResponseDataForRequest,
  isAiContextUsageForRequest,
  isAiMcpResourceAccessActionData,
  isAiMcpToolCallActionData
} from '@/services/aiChatBackendGuards'
import type { AiChatConversationRecord, AiChatHistoryMessage } from '@shared/contracts/aiChat'

const conversation: AiChatConversationRecord = {
  id: 'conv-1',
  title: 'Operations chat',
  summary: 'Check production',
  updatedAt: '2026-06-20T00:00:00.000Z',
  ts: 1781884800000,
  favorite: false
}

const userMessage: AiChatHistoryMessage = {
  id: 'request-1-user',
  role: 'user',
  text: 'check disk',
  contentParts: [
    { type: 'text', text: 'check disk' },
    { type: 'chip', chipType: 'command', ref: { command: 'df -h', label: 'Disk usage' } },
    { type: 'chip', chipType: 'doc', ref: { absPath: '/tmp/runbook.md', relPath: 'runbook.md', type: 'file', startLine: 1, endLine: 12 } }
  ],
  hosts: [{ id: 'host-1', kind: 'hosts', label: 'prod', detail: 'ssh prod' }]
}

const assistantMessage: AiChatHistoryMessage = {
  id: 'request-1-assistant',
  role: 'assistant',
  text: 'Thinking...',
  state: 'streaming',
  mcpToolCall: {
    serverName: 'ops',
    toolName: 'inspect',
    arguments: { path: '/' }
  },
  ask: 'mcp_tool_call'
}

const contextUsage = {
  used: 32,
  contextWindow: 128000,
  percent: 1,
  tokensIn: 24,
  tokensOut: 8,
  source: 'backend' as const,
  requestId: 'request-1',
  assistantMessageId: assistantMessage.id
}

describe('aiChatBackendGuards', () => {
  it('validates chat history messages, snapshots, and mutations', () => {
    expect(isAiChatHistoryMessage(userMessage)).toBe(true)
    expect(isAiChatHistoryMessage({ ...userMessage, id: '' })).toBe(false)
    expect(isAiChatHistoryMessage({ ...userMessage, contentParts: [{ type: 'image', mediaType: 'text/plain', data: 'x' }] })).toBe(false)
    expect(isAiChatHistorySnapshotData({ conversations: [conversation], selectedConversationId: conversation.id })).toBe(true)
    expect(isAiChatHistorySnapshotData({ conversations: [{ ...conversation, ts: -1 }], selectedConversationId: conversation.id })).toBe(false)
    expect(isAiChatConversationMutationData({ conversation, conversations: [conversation], selectedConversationId: conversation.id })).toBe(true)
    expect(isAiChatConversationMutationData({ conversation, conversations: [], selectedConversationId: conversation.id })).toBe(false)
    expect(isAiChatConversationDeleteData({ deletedId: conversation.id, conversations: [], selectedConversationId: '' })).toBe(true)
    expect(isAiChatConversationRestoreData({ conversation, messages: [userMessage, assistantMessage], totalMessages: 2, returnedMessages: 2, truncated: false })).toBe(true)
    expect(isAiChatMessageMetadataData({ conversation, messages: [userMessage] })).toBe(true)
  })

  it('validates exchange request data and context usage request matching', () => {
    const exchange = {
      requestId: 'request-1',
      userMessage,
      assistantMessage,
      responseInput: {
        requestId: 'request-1',
        assistantMessageId: assistantMessage.id,
        prompt: 'check disk',
        messages: [{ role: 'user' as const, text: 'history' }],
        contexts: [{ id: 'host-1', kind: 'hosts', label: 'prod' }],
        skills: [{ name: 'triage', description: 'ops', content: 'look at disk' }],
        command: { command: 'df -h' },
        mode: 'agent' as const
      },
      contextUsage
    }
    expect(isAiChatExchangeRequestDataForRequest(exchange)).toBe(true)
    expect(isAiChatExchangeRequestDataForRequest({ ...exchange, assistantMessage: { ...assistantMessage, id: 'wrong-assistant' } })).toBe(false)
    expect(isAiChatExchangeRequestDataForRequest({ ...exchange, responseInput: { ...exchange.responseInput, requestId: 'wrong' } })).toBe(false)
    expect(isAiContextUsageForRequest(contextUsage, 'request-1', assistantMessage.id)).toBe(true)
    expect(isAiContextUsageForRequest({ ...contextUsage, percent: 101 }, 'request-1', assistantMessage.id)).toBe(false)
    expect(isAiContextUsageForRequest({ ...contextUsage, requestId: 'wrong' }, 'request-1', assistantMessage.id)).toBe(false)
  })

  it('validates AI response and cancel data against request ids', () => {
    const response = {
      text: 'Disk usage is normal.',
      provider: 'aiopsterm-local' as const,
      model: 'ops-model',
      durationMs: 12,
      status: 'done' as const,
      requestId: 'request-1',
      assistantMessageId: assistantMessage.id,
      message: { ...assistantMessage, text: 'Disk usage is normal.', state: 'done' as const },
      contextUsage
    }
    expect(isAiChatResponseDataForRequest(response, 'request-1', assistantMessage.id)).toBe(true)
    expect(isAiChatResponseDataForRequest({ ...response, provider: 'unknown' }, 'request-1', assistantMessage.id)).toBe(false)
    expect(isAiChatResponseDataForRequest({ ...response, message: { ...response.message, id: 'wrong-assistant' } }, 'request-1', assistantMessage.id)).toBe(false)
    expect(isAiChatCancelDataForRequest({ status: 'cancelled', requestId: 'request-1', assistantMessageId: assistantMessage.id, text: 'Stopped.', active: false, contextUsage }, 'request-1', assistantMessage.id)).toBe(true)
    expect(isAiChatCancelDataForRequest({ status: 'cancelled', requestId: 'wrong', assistantMessageId: assistantMessage.id, text: 'Stopped.', active: false }, 'request-1', assistantMessage.id)).toBe(false)
  })

  it('validates MCP approval action data and optional MCP config snapshots', () => {
    const approvedMessage: AiChatHistoryMessage = {
      ...assistantMessage,
      state: 'done',
      action: 'approved'
    }
    expect(isAiMcpToolCallActionData({ status: 'approved', conversation, messages: [approvedMessage] })).toBe(true)
    expect(
      isAiMcpToolCallActionData({
        status: 'approved',
        conversation,
        messages: [approvedMessage],
        mcpConfig: {
          mcpConfig: {},
          mcpServers: [],
          mcpToolStates: {}
        }
      })
    ).toBe(true)
    expect(isAiMcpToolCallActionData({ status: 'approved', conversation, messages: [approvedMessage], mcpConfig: { mcpServers: [] } })).toBe(false)
    expect(isAiMcpResourceAccessActionData({ status: 'rejected', conversation, messages: [{ ...approvedMessage, ask: 'mcp_resource_access' }] })).toBe(true)
    expect(isAiMcpResourceAccessActionData({ status: 'pending', conversation, messages: [approvedMessage] })).toBe(false)
  })

  it('normalizes AI request ids and bridge error messages', () => {
    expect(aiChatRequestIdFromAssistantMessageId('request-1-assistant')).toBe('request-1')
    expect(aiChatRequestIdFromAssistantMessageId('assistant-only')).toBe('')
    expect(aiBridgeErrorMessage(new Error('backend failed'), 'fallback')).toBe('backend failed')
    expect(aiBridgeErrorMessage(' backend failed ', 'fallback')).toBe('backend failed')
    expect(aiBridgeErrorMessage('', 'fallback')).toBe('fallback')
  })
})
