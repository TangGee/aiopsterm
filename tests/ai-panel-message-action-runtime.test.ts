import { describe, expect, it, vi } from 'vitest'
import {
  createAiPanelMessageActionRuntime,
  formatAiPanelMcpToolArguments,
  type AiPanelMessageActionMessage
} from '@/services/ai/aiPanelMessageActionRuntime'

const createHarness = () => {
  let messages: AiPanelMessageActionMessage[] = [
    { id: 'message-1', text: 'hello' },
    { id: 'message-2', text: '', contentParts: [{ type: 'text', text: 'part text' }] },
    { id: 'mcp-tool', text: 'tool', mcpToolCall: { arguments: { path: '/tmp/readme.md' } } },
    {
      id: 'cline-host-read',
      text: 'read_host_file: /var/log/api.log',
      ask: 'mcp_tool_call',
      mcpToolCall: { serverName: 'production', toolName: 'read_host_file', arguments: { path: '/var/log/api.log' } },
      agentTask: {
        taskId: 'request-read',
        turnId: 'request-read-assistant',
        toolCallId: 'tool-read',
        toolName: 'read_host_file',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-prod',
        status: 'waiting-approval'
      }
    },
    {
      id: 'cline-resource',
      text: 'access_mcp_resource: inventory inventory://hosts',
      ask: 'mcp_resource_access',
      mcpResourceAccess: { serverName: 'inventory', uri: 'inventory://hosts' },
      agentTask: {
        taskId: 'request-resource',
        turnId: 'request-resource-assistant',
        toolCallId: 'tool-resource',
        toolName: 'access_mcp_resource',
        status: 'waiting-approval'
      }
    }
  ]
  const notices: string[] = []
  const calls = {
    copyText: vi.fn(async (text: string) => text !== 'fail'),
    approveMcpToolCall: vi.fn(async () => 'approved'),
    rejectMcpToolCall: vi.fn(async () => 'rejected'),
    approveMcpResourceAccess: vi.fn(async () => 'approved'),
    rejectMcpResourceAccess: vi.fn(async () => 'rejected'),
    toggleMessageFavorite: vi.fn(async (id: string) => {
      messages = messages.map((message) => (message.id === id ? { ...message, favorite: !message.favorite } : message))
      return true
    }),
    setMessageFeedback: vi.fn(async (id: string, feedback: 'up' | 'down') => {
      messages = messages.map((message) => (message.id === id ? { ...message, feedback: message.feedback === feedback ? undefined : feedback } : message))
      return true
    }),
    retryAssistantMessage: vi.fn(() => true),
    summarizeMessageToKnowledge: vi.fn(async () => ({ relPath: 'summary/message.md' })),
    summarizeMessageToSkill: vi.fn(async () => ({ name: 'message-skill' })),
    respondClineAgentApproval: vi.fn(async (approval: any) => ({
      ok: true,
      data: {
        taskId: approval.taskId,
        turnId: approval.turnId,
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        ...(approval.targetId
          ? {
              targetId: approval.targetId,
              targetLabel: approval.targetLabel,
              terminalSessionId: approval.terminalSessionId
            }
          : { serverName: approval.serverName, resourceUri: approval.resourceUri }),
        status: approval.approved ? 'approved' as const : 'rejected' as const
      }
    })),
    syncCurrentConversationSnapshot: vi.fn()
  }
  const runtime = createAiPanelMessageActionRuntime({
    messages: () => messages,
    copyText: calls.copyText,
    notify: (message) => notices.push(message),
    approveMcpToolCall: calls.approveMcpToolCall,
    rejectMcpToolCall: calls.rejectMcpToolCall,
    approveMcpResourceAccess: calls.approveMcpResourceAccess,
    rejectMcpResourceAccess: calls.rejectMcpResourceAccess,
    toggleMessageFavorite: calls.toggleMessageFavorite,
    setMessageFeedback: calls.setMessageFeedback,
    retryAssistantMessage: calls.retryAssistantMessage,
    summarizeMessageToKnowledge: calls.summarizeMessageToKnowledge,
    summarizeMessageToSkill: calls.summarizeMessageToSkill,
    respondClineAgentApproval: calls.respondClineAgentApproval,
    syncCurrentConversationSnapshot: calls.syncCurrentConversationSnapshot
  })
  return {
    calls,
    messages: () => messages,
    notices,
    runtime
  }
}

describe('aiPanelMessageActionRuntime', () => {
  it('copies rendered text and messages with user notices', async () => {
    const { calls, notices, runtime } = createHarness()
    await expect(runtime.copyRenderedTextToClipboard('', '代码')).resolves.toBe(false)
    expect(notices.at(-1)).toBe('代码为空，无法复制。')

    await expect(runtime.copyRenderedTextToClipboard('echo ok', '代码')).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenCalledWith('echo ok')
    expect(notices.at(-1)).toBe('代码已复制。')

    await expect(runtime.copyRenderedTextToClipboard('fail', '输出')).resolves.toBe(false)
    expect(notices.at(-1)).toBe('复制失败。')

    await expect(runtime.copyMessageToClipboard({ text: '  ' })).resolves.toBe(false)
    expect(notices.at(-1)).toBe('消息为空，无法复制。')

    await expect(runtime.copyMessageToClipboard({ text: '', contentParts: [{ type: 'text', text: 'part text' }] })).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenLastCalledWith('part text')
    expect(notices.at(-1)).toBe('消息已复制。')
  })

  it('handles MCP actions, favorites, feedback, retry, and summarization notices', async () => {
    const { calls, messages, notices, runtime } = createHarness()

    await expect(runtime.approveMcpToolCall('mcp-tool', true)).resolves.toBe('approved')
    expect(calls.approveMcpToolCall).toHaveBeenCalledWith('mcp-tool', { autoApprove: true })
    expect(notices.at(-1)).toBe('MCP 工具已执行。')
    await expect(runtime.rejectMcpToolCall('mcp-tool')).resolves.toBe('rejected')
    expect(notices.at(-1)).toBe('MCP 工具调用已拒绝。')
    await expect(runtime.approveMcpResourceAccess('mcp-resource')).resolves.toBe('approved')
    expect(notices.at(-1)).toBe('MCP 资源已读取。')
    await expect(runtime.rejectMcpResourceAccess('mcp-resource')).resolves.toBe('rejected')
    expect(notices.at(-1)).toBe('MCP 资源访问已拒绝。')

    await expect(runtime.toggleMessageFavorite('message-1')).resolves.toBe(true)
    expect(messages().find((message) => message.id === 'message-1')?.favorite).toBe(true)
    expect(notices.at(-1)).toBe('已收藏消息。')
    await expect(runtime.setMessageFeedback('message-1', 'up')).resolves.toBe(true)
    expect(notices.at(-1)).toBe('已标记有帮助。')
    await expect(runtime.setMessageFeedback('message-1', 'up')).resolves.toBe(true)
    expect(notices.at(-1)).toBe('已取消反馈。')

    expect(runtime.retryAssistantMessage('message-1')).toBe(true)
    expect(notices.at(-1)).toBe('已重新发送上一条用户消息。')
    await expect(runtime.summarizeMessageToKnowledge('message-1')).resolves.toEqual({ relPath: 'summary/message.md' })
    expect(notices.at(-1)).toBe('已沉淀到知识：summary/message.md')
    await expect(runtime.summarizeMessageToSkill('message-1')).resolves.toEqual({ name: 'message-skill' })
    expect(notices.at(-1)).toBe('已创建技能：message-skill')
  })

  it('formats MCP tool arguments defensively', () => {
    expect(formatAiPanelMcpToolArguments({ mcpToolCall: { arguments: { path: '/tmp/readme.md' } } })).toContain('/tmp/readme.md')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatAiPanelMcpToolArguments({ mcpToolCall: { arguments: circular } })).toBe('[object Object]')
  })

  it('routes sensitive Cline reads through the task-bound approval bridge', async () => {
    const { calls, messages, runtime } = createHarness()

    await expect(runtime.approveMcpToolCall('cline-host-read', true)).resolves.toBe('approved')
    expect(calls.approveMcpToolCall).not.toHaveBeenCalled()
    expect(calls.respondClineAgentApproval).toHaveBeenCalledWith({
      taskId: 'request-read',
      turnId: 'request-read-assistant',
      toolCallId: 'tool-read',
      toolName: 'read_host_file',
      targetId: 'asset-prod',
      targetLabel: 'production',
      terminalSessionId: 'terminal-prod',
      approved: true,
      reason: undefined
    })
    expect(messages().find((message) => message.id === 'cline-host-read')).toMatchObject({
      action: 'approved',
      agentTask: { status: 'running' }
    })

    await expect(runtime.rejectMcpResourceAccess('cline-resource')).resolves.toBe('rejected')
    expect(calls.rejectMcpResourceAccess).not.toHaveBeenCalled()
    expect(calls.respondClineAgentApproval).toHaveBeenLastCalledWith({
      taskId: 'request-resource',
      turnId: 'request-resource-assistant',
      toolCallId: 'tool-resource',
      toolName: 'access_mcp_resource',
      serverName: 'inventory',
      resourceUri: 'inventory://hosts',
      approved: false,
      reason: 'The operator rejected the sensitive read.'
    })
    expect(messages().find((message) => message.id === 'cline-resource')).toMatchObject({
      action: 'rejected',
      agentTask: { status: 'running' }
    })
    expect(calls.syncCurrentConversationSnapshot).toHaveBeenCalledTimes(2)
  })

  it('settles a stale sensitive approval card instead of falling back to legacy MCP execution', async () => {
    const { calls, messages, runtime } = createHarness()
    calls.respondClineAgentApproval.mockResolvedValueOnce({
      ok: false,
      errorCode: 'CLINE_AGENT_APPROVAL_NOT_FOUND',
      errorMessage: 'The Cline Agent approval is no longer pending.'
    } as any)

    await expect(runtime.approveMcpToolCall('cline-host-read')).resolves.toBe('failed')
    expect(calls.approveMcpToolCall).not.toHaveBeenCalled()
    expect(messages().find((message) => message.id === 'cline-host-read')).toMatchObject({
      action: 'rejected',
      agentTask: { status: 'cancelled', restored: true }
    })
  })
})
