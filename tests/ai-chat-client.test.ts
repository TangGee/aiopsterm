import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiChatClient } from '@/services/aiChatClient'

const originalAiops = window.aiops

const conversation = {
  id: 'conv-1',
  title: 'Operations chat',
  summary: 'Check production',
  updatedAt: '2026-06-20T00:00:00.000Z',
  ts: 1781884800000
}

const userMessage = {
  id: 'request-1-user',
  role: 'user' as const,
  text: 'check disk'
}

const assistantMessage = {
  id: 'request-1-assistant',
  role: 'assistant' as const,
  text: 'Thinking...',
  state: 'streaming' as const
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

afterEach(() => {
  window.aiops = originalAiops
})

describe('aiChatClient', () => {
  it('returns undefined for unavailable bridge methods and binds AI chat response and MCP action methods', async () => {
    window.aiops = {
      ...originalAiops,
      createAiChatExchangeRequest: vi.fn(async () => ({
        ok: true,
        data: {
          requestId: 'request-1',
          userMessage,
          assistantMessage,
          responseInput: {
            requestId: 'request-1',
            assistantMessageId: assistantMessage.id,
            prompt: userMessage.text
          },
          contextUsage
        }
      })),
      generateAiChatResponse: vi.fn(async () => ({
        ok: true,
        data: {
          text: 'Disk usage is normal.',
          provider: 'aiopsterm-local' as const,
          model: 'ops-model',
          durationMs: 12,
          status: 'done' as const,
          requestId: 'request-1',
          assistantMessageId: assistantMessage.id,
          contextUsage
        }
      })),
      cancelAiChatResponse: vi.fn(async () => ({
        ok: true,
        data: {
          status: 'cancelled' as const,
          requestId: 'request-1',
          assistantMessageId: assistantMessage.id,
          text: 'Stopped.',
          active: false,
          contextUsage
        }
      })),
      approveAiMcpToolCall: vi.fn(async () => ({
        ok: true,
        data: {
          status: 'approved' as const,
          conversation,
          messages: [{ ...assistantMessage, state: 'done' as const, ask: 'mcp_tool_call' as const, action: 'approved' as const }]
        }
      })),
      rejectAiMcpToolCall: vi.fn(async () => ({
        ok: true,
        data: {
          status: 'rejected' as const,
          conversation,
          messages: [{ ...assistantMessage, state: 'done' as const, ask: 'mcp_tool_call' as const, action: 'rejected' as const }]
        }
      })),
      approveAiMcpResourceAccess: vi.fn(async () => ({
        ok: true,
        data: {
          status: 'approved' as const,
          conversation,
          messages: [{ ...assistantMessage, state: 'done' as const, ask: 'mcp_resource_access' as const, action: 'approved' as const }]
        }
      })),
      rejectAiMcpResourceAccess: vi.fn(async () => ({
        ok: true,
        data: {
          status: 'rejected' as const,
          conversation,
          messages: [{ ...assistantMessage, state: 'done' as const, ask: 'mcp_resource_access' as const, action: 'rejected' as const }]
        }
      }))
    }

    await expect(aiChatClient.createAiChatExchangeRequest()?.({ text: userMessage.text })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ requestId: 'request-1' })
      })
    )
    await expect(
      aiChatClient.generateAiChatResponse()?.({
        requestId: 'request-1',
        assistantMessageId: assistantMessage.id,
        prompt: userMessage.text
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ text: 'Disk usage is normal.' })
      })
    )
    await expect(aiChatClient.cancelAiChatResponse()?.({ requestId: 'request-1', assistantMessageId: assistantMessage.id })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ status: 'cancelled' })
      })
    )
    await expect(aiChatClient.approveAiMcpToolCall()?.({ conversationId: conversation.id, messageId: assistantMessage.id, autoApprove: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ status: 'approved' })
      })
    )
    await expect(aiChatClient.rejectAiMcpToolCall()?.({ conversationId: conversation.id, messageId: assistantMessage.id })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ status: 'rejected' })
      })
    )
    await expect(aiChatClient.approveAiMcpResourceAccess()?.({ conversationId: conversation.id, messageId: assistantMessage.id })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ status: 'approved' })
      })
    )
    await expect(aiChatClient.rejectAiMcpResourceAccess()?.({ conversationId: conversation.id, messageId: assistantMessage.id })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ status: 'rejected' })
      })
    )

    expect(window.aiops.createAiChatExchangeRequest).toHaveBeenCalledWith({ text: userMessage.text })
    expect(window.aiops.generateAiChatResponse).toHaveBeenCalledWith({
      requestId: 'request-1',
      assistantMessageId: assistantMessage.id,
      prompt: userMessage.text
    })
    expect(window.aiops.cancelAiChatResponse).toHaveBeenCalledWith({
      requestId: 'request-1',
      assistantMessageId: assistantMessage.id
    })
    expect(window.aiops.approveAiMcpToolCall).toHaveBeenCalledWith({
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      autoApprove: true
    })
    expect(window.aiops.rejectAiMcpToolCall).toHaveBeenCalledWith({
      conversationId: conversation.id,
      messageId: assistantMessage.id
    })
    expect(window.aiops.approveAiMcpResourceAccess).toHaveBeenCalledWith({
      conversationId: conversation.id,
      messageId: assistantMessage.id
    })
    expect(window.aiops.rejectAiMcpResourceAccess).toHaveBeenCalledWith({
      conversationId: conversation.id,
      messageId: assistantMessage.id
    })

    window.aiops = {
      ...originalAiops,
      createAiChatExchangeRequest: undefined as any,
      generateAiChatResponse: undefined as any,
      cancelAiChatResponse: undefined as any,
      approveAiMcpToolCall: undefined as any,
      rejectAiMcpToolCall: undefined as any,
      approveAiMcpResourceAccess: undefined as any,
      rejectAiMcpResourceAccess: undefined as any
    }
    expect(aiChatClient.createAiChatExchangeRequest()).toBeUndefined()
    expect(aiChatClient.generateAiChatResponse()).toBeUndefined()
    expect(aiChatClient.cancelAiChatResponse()).toBeUndefined()
    expect(aiChatClient.approveAiMcpToolCall()).toBeUndefined()
    expect(aiChatClient.rejectAiMcpToolCall()).toBeUndefined()
    expect(aiChatClient.approveAiMcpResourceAccess()).toBeUndefined()
    expect(aiChatClient.rejectAiMcpResourceAccess()).toBeUndefined()
  })
})
