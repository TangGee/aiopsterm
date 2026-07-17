import { describe, expect, it, vi } from 'vitest'
import {
  createAiPanelActionOrchestrationRuntime,
  type AiPanelActionOrchestrationMessage
} from '@/services/ai/aiPanelActionOrchestrationRuntime'
import type { TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'

const createHarness = (input: { chatMode?: string; terminalDecision?: TerminalSecurityDecision | null } = {}) => {
  let messages: AiPanelActionOrchestrationMessage[] = [
    {
      id: 'message-1',
      role: 'assistant',
      text: 'hello',
      state: 'done',
      contentParts: [{ type: 'text', text: 'hello' }]
    },
    {
      id: 'command-1',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'uptime', label: 'uptime' } }],
      agentTask: {
        taskId: 'task-command',
        turnId: 'turn-command',
        toolName: 'propose_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'session-prod',
        status: 'done'
      }
    },
    {
      id: 'tool-1',
      role: 'assistant',
      text: 'tool',
      state: 'done',
      mcpToolCall: { arguments: { path: '/tmp/readme.md' } }
    }
  ]
  const notices: string[] = []
  const calls = {
    afterDomUpdate: vi.fn(async () => undefined),
    approveMcpResourceAccess: vi.fn(async () => 'approved'),
    approveMcpToolCall: vi.fn(async () => 'approved'),
    closePopups: vi.fn(),
    continueAgentCommandLoop: vi.fn(async () => ({ status: 'continued' })),
    copyText: vi.fn(async (text: string) => text !== 'copy-fail'),
    enableAgentReadOnlyAutoRunForCurrentConversation: vi.fn(() => true),
    rejectMcpResourceAccess: vi.fn(async () => 'rejected'),
    rejectMcpToolCall: vi.fn(async () => 'rejected'),
    retryAssistantMessage: vi.fn(() => true),
    runActiveTerminalCommand: vi.fn(async () =>
      Object.hasOwn(input, 'terminalDecision') ? input.terminalDecision! : ({ status: 'allow' } as TerminalSecurityDecision)
    ),
    runTerminalCommand: vi.fn(async () =>
      Object.hasOwn(input, 'terminalDecision') ? input.terminalDecision! : ({ status: 'allow' } as TerminalSecurityDecision)
    ),
    setMessageFeedback: vi.fn(async (id: string, feedback: 'up' | 'down') => {
      messages = messages.map((message) => (message.id === id ? { ...message, feedback } : message))
      return true
    }),
    summarizeMessageToKnowledge: vi.fn(async () => ({ relPath: 'notes/message.md' })),
    summarizeMessageToSkill: vi.fn(async () => ({ name: 'message-skill' })),
    syncCurrentConversationSnapshot: vi.fn(),
    toggleMessageFavorite: vi.fn(async (id: string) => {
      messages = messages.map((message) => (message.id === id ? { ...message, favorite: !message.favorite } : message))
      return true
    })
  }
  const activePanel = {
    id: 'terminal-1',
    kind: 'terminal',
    sessionId: 'session-prod',
    classicTarget: {
      targetId: 'asset-prod',
      terminalSessionId: 'session-prod',
      label: 'production',
      kind: 'ssh' as const
    },
    output: 'prompt\n'
  }
  const runtime = createAiPanelActionOrchestrationRuntime({
    messages: () => messages,
    panels: () => [activePanel],
    chatMode: () => input.chatMode ?? 'cmd',
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
    runTerminalCommand: calls.runTerminalCommand,
    continueAgentCommandLoop: calls.continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation: calls.enableAgentReadOnlyAutoRunForCurrentConversation,
    syncCurrentConversationSnapshot: calls.syncCurrentConversationSnapshot,
    closePopups: calls.closePopups,
    afterDomUpdate: calls.afterDomUpdate
  })

  return {
    calls,
    commandMessage: () => messages.find((message) => message.id === 'command-1')!,
    messages: () => messages,
    notices,
    runtime
  }
}

describe('aiPanelActionOrchestrationRuntime', () => {
  it('exposes message actions through one orchestration surface', async () => {
    const { calls, messages, notices, runtime } = createHarness()

    await expect(runtime.copyRenderedTextToClipboard('rendered text', '输出')).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenCalledWith('rendered text')
    expect(notices.at(-1)).toBe('输出已复制。')

    await expect(runtime.copyMessageToClipboard(messages()[0])).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenLastCalledWith('hello')
    expect(notices.at(-1)).toBe('消息已复制。')

    await expect(runtime.approveMcpToolCall('tool-1', true)).resolves.toBe('approved')
    expect(calls.approveMcpToolCall).toHaveBeenCalledWith('tool-1', { autoApprove: true })
    expect(runtime.formatMcpToolArguments(messages()[2])).toContain('/tmp/readme.md')

    await expect(runtime.toggleMessageFavorite('message-1')).resolves.toBe(true)
    expect(notices.at(-1)).toBe('已收藏消息。')
    await expect(runtime.summarizeMessageToKnowledge('message-1')).resolves.toEqual({ relPath: 'notes/message.md' })
    expect(notices.at(-1)).toBe('已沉淀到知识：notes/message.md')
  })

  it('owns command audit state, popup closure, and textarea focus/select orchestration', async () => {
    const { calls, commandMessage, runtime } = createHarness()
    const focus = vi.fn()
    const select = vi.fn()
    runtime.commandAuditTextareaRef.value = { focus, select } as unknown as HTMLTextAreaElement

    await expect(runtime.openCommandAuditDialog(commandMessage())).resolves.toBe(true)

    expect(runtime.commandAuditDialog.value).toEqual({ open: true, messageId: 'command-1', draft: 'uptime' })
    expect(runtime.activeCommandAuditMessage.value?.id).toBe('command-1')
    expect(runtime.canEditActiveCommandAudit.value).toBe(true)
    expect(calls.closePopups).toHaveBeenCalled()
    expect(calls.afterDomUpdate).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(select).toHaveBeenCalled()
  })

  it('keeps command copy, run, reject, and audit draft paths available', async () => {
    const { calls, commandMessage, notices, runtime } = createHarness()

    await expect(runtime.copyCommandToClipboard(commandMessage())).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenCalledWith('uptime')
    expect(notices.at(-1)).toBe('命令已复制。')

    await runtime.openCommandAuditDialog(commandMessage())
    runtime.commandAuditDialog.value.draft = 'uptime -p'
    await expect(runtime.copyCommandAuditDraft()).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenLastCalledWith('uptime -p')

    await expect(runtime.runCommandAuditDraft()).resolves.toMatchObject({ status: 'allow' })
    expect(calls.runTerminalCommand).toHaveBeenCalledWith('terminal-1', 'uptime -p', 'agent')
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(commandMessage().executedCommand).toBe('uptime -p')

    const second = {
      ...commandMessage(),
      id: 'command-2',
      text: 'date',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'date', label: 'date' } }]
    } satisfies AiPanelActionOrchestrationMessage
    expect(runtime.rejectMessageCommand(second)).toBe(true)
    expect(second.action).toBe('rejected')
    await expect(runtime.runMessageCommand(second)).resolves.toBe(false)
    expect(notices.at(-1)).toBe('命令已拒绝，无法执行。')
  })
})
