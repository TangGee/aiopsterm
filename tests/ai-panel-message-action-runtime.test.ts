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
    { id: 'mcp-tool', text: 'tool', mcpToolCall: { arguments: { path: '/tmp/readme.md' } } }
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
    summarizeMessageToSkill: vi.fn(async () => ({ name: 'message-skill' }))
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
    summarizeMessageToSkill: calls.summarizeMessageToSkill
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
})
