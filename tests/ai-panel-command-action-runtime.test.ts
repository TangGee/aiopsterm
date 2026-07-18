import { describe, expect, it, vi } from 'vitest'
import {
  createAiPanelCommandActionRuntime,
  createEmptyAiPanelCommandActionRuntimeState,
  resolveAiPanelCommandActionTerminalPanel,
  type AiPanelCommandActionTerminalPanel
} from '@/services/ai/aiPanelCommandActionRuntime'
import type { AiPanelCommandSuggestionMessage } from '@/services/ai/aiPanelMessageRuntime'
import type { TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const createHarness = (input: {
  chatMode?: string
  activePanel?: AiPanelCommandActionTerminalPanel
  panels?: AiPanelCommandActionTerminalPanel[]
  terminalDecision?: TerminalSecurityDecision | null
  loopResult?: { status: string; reason?: string }
  clineApprovalOk?: boolean
} = {}) => {
  let messages: AiPanelCommandSuggestionMessage[] = [
    {
      id: 'chip-command',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'uptime', label: 'uptime' } }],
      agentTask: {
        taskId: 'task-chip',
        turnId: 'turn-chip',
        toolName: 'propose_host_command',
        targetId: 'asset-default',
        targetLabel: 'default host',
        terminalSessionId: 'session-1',
        status: 'done'
      }
    },
    {
      id: 'agent-command',
      role: 'assistant',
      text: 'df -h',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: '',
        command: 'df -h',
        requiresApproval: false,
        interactive: false
      },
      agentTask: {
        taskId: 'task-command',
        turnId: 'turn-command',
        toolName: 'propose_host_command',
        targetId: 'asset-default',
        targetLabel: 'default host',
        terminalSessionId: 'session-1',
        status: 'done'
      }
    }
  ]
  const state = createEmptyAiPanelCommandActionRuntimeState()
  const notices: string[] = []
  const calls = {
    copyText: vi.fn(async (text: string) => text !== 'copy-fail'),
    runActiveTerminalCommand: vi.fn(async () =>
      Object.hasOwn(input, 'terminalDecision') ? input.terminalDecision! : ({ status: 'allow' } as TerminalSecurityDecision)
    ),
    runTerminalCommand: vi.fn(async () =>
      Object.hasOwn(input, 'terminalDecision') ? input.terminalDecision! : ({ status: 'allow' } as TerminalSecurityDecision)
    ),
    continueAgentCommandLoop: vi.fn(async () => input.loopResult ?? { status: 'continued' }),
    respondClineAgentApproval: vi.fn(async (approval: any) => input.clineApprovalOk === false
      ? { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_FAILED', errorMessage: 'approval failed' }
      : {
          ok: true,
          data: {
            taskId: approval.taskId,
            turnId: approval.turnId,
            toolCallId: approval.toolCallId,
            toolName: approval.toolName,
            targetId: approval.targetId,
            targetLabel: approval.targetLabel,
            terminalSessionId: approval.terminalSessionId,
            status: approval.approved ? 'approved' as const : 'rejected' as const
          }
        }),
    enableAgentReadOnlyAutoRunForCurrentConversation: vi.fn(() => true),
    syncCurrentConversationSnapshot: vi.fn()
  }
  const activePanel = input.activePanel ?? {
    id: 'terminal-1',
    kind: 'terminal',
    sessionId: 'session-1',
    classicTarget: {
      targetId: 'asset-default',
      label: 'default host',
      terminalSessionId: 'session-1',
      kind: 'ssh'
    },
    output: 'prompt\n'
  }
  const panels = input.panels ?? [activePanel]
  const runtime = createAiPanelCommandActionRuntime({
    state,
    messages: () => messages,
    panels: () => panels,
    chatMode: () => input.chatMode ?? 'cmd',
    copyText: calls.copyText,
    notify: (message) => notices.push(message),
    runTerminalCommand: calls.runTerminalCommand,
    continueAgentCommandLoop: calls.continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation: calls.enableAgentReadOnlyAutoRunForCurrentConversation,
    syncCurrentConversationSnapshot: calls.syncCurrentConversationSnapshot,
    respondClineAgentApproval: calls.respondClineAgentApproval
  })

  return {
    calls,
    messages: () => messages,
    notices,
    runtime,
    setMessages: (nextMessages: AiPanelCommandSuggestionMessage[]) => {
      messages = nextMessages
    },
    state
  }
}

describe('aiPanelCommandActionRuntime', () => {
  it('runs a completed target-bound proposal on its original terminal instead of the active terminal', async () => {
    const activePanel = {
      id: 'terminal-1',
      kind: 'terminal',
      sessionId: 'session-1',
      classicTarget: { targetId: 'asset-other', terminalSessionId: 'session-1', label: 'other', kind: 'ssh' as const },
      output: 'active\n'
    }
    const targetPanel = {
      id: 'terminal-2',
      kind: 'terminal',
      sessionId: 'session-2',
      classicTarget: { targetId: 'asset-prod', terminalSessionId: 'session-2', label: 'prod', kind: 'ssh' as const },
      output: 'target\n'
    }
    const { calls, messages, runtime } = createHarness({ activePanel, panels: [activePanel, targetPanel] })
    const message = messages()[1]
    message.agentTask = {
      taskId: 'task-1',
      turnId: 'turn-1',
      terminalSessionId: 'session-2',
      targetId: 'asset-prod',
      targetLabel: 'prod',
      status: 'done'
    }

    await expect(runtime.runMessageCommand(message)).resolves.toMatchObject({ status: 'allow' })

    expect(calls.runTerminalCommand).toHaveBeenCalledWith('terminal-2', 'df -h', 'agent')
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
  })

  it('fails closed when a target-bound proposal terminal no longer exists', async () => {
    const activePanel = {
      id: 'terminal-1',
      kind: 'terminal',
      sessionId: 'session-1',
      classicTarget: { targetId: 'asset-other', terminalSessionId: 'session-1', label: 'other', kind: 'ssh' as const },
      output: 'active\n'
    }
    const { calls, messages, runtime } = createHarness({ activePanel, panels: [activePanel] })
    const message = messages()[1]
    message.agentTask = {
      taskId: 'task-1',
      turnId: 'turn-1',
      terminalSessionId: 'missing-session',
      targetId: 'asset-prod',
      targetLabel: 'prod',
      status: 'done'
    }

    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)

    expect(calls.runTerminalCommand).not.toHaveBeenCalled()
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(message.commandExecutionStatus).toBe('failed')
  })

  it('does not execute an unbound Cline proposal on the active terminal', async () => {
    const { calls, messages, runtime } = createHarness()
    const message = messages()[1]
    message.agentTask = {
      taskId: 'task-unbound',
      turnId: 'turn-unbound',
      toolCallId: 'proposal-unbound',
      toolName: 'propose_host_command',
      status: 'done'
    }

    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)

    expect(calls.runTerminalCommand).not.toHaveBeenCalled()
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(message.commandExecutionStatus).toBe('failed')
  })

  it('does not execute a command card without a Cline target binding', async () => {
    const { calls, messages, runtime } = createHarness()
    const message = messages()[0]
    message.agentTask = undefined

    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)

    expect(calls.runTerminalCommand).not.toHaveBeenCalled()
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(message.commandExecutionStatus).toBe('failed')
  })

  it('copies commands and audit drafts with notices', async () => {
    const { calls, notices, runtime, state } = createHarness()
    const message = { id: 'empty', role: 'assistant', text: ' ', state: 'done' } as AiPanelCommandSuggestionMessage

    await expect(runtime.copyCommandToClipboard(message)).resolves.toBe(false)
    expect(notices.at(-1)).toBe('没有可复制的命令。')

    await expect(runtime.copyCommandToClipboard({ ...message, text: 'uptime' })).resolves.toBe(true)
    expect(calls.copyText).toHaveBeenLastCalledWith('uptime')
    expect(notices.at(-1)).toBe('命令已复制。')

    state.commandAuditDialog = { open: true, messageId: 'chip-command', draft: '' }
    await expect(runtime.copyCommandAuditDraft()).resolves.toBe(false)
    expect(notices.at(-1)).toBe('没有可复制的命令。')

    state.commandAuditDialog.draft = 'copy-fail'
    await expect(runtime.copyCommandAuditDraft()).resolves.toBe(false)
    expect(notices.at(-1)).toBe('复制失败。')
  })

  it('opens, saves, and closes the audit dialog while resetting stale execution state', () => {
    const { calls, messages, notices, runtime, state } = createHarness()
    const message = messages()[0]
    message.commandExecutionStatus = 'failed'
    message.commandExecutionMessage = 'old failure'
    message.executedCommand = 'uptime'

    expect(runtime.openCommandAuditDialog(message)).toBe(true)
    expect(state.commandAuditDialog).toEqual({ open: true, messageId: 'chip-command', draft: 'uptime' })
    expect(runtime.activeCommandAuditMessage()?.id).toBe('chip-command')
    expect(runtime.canEditActiveCommandAudit()).toBe(true)

    state.commandAuditDialog.draft = 'uptime -p'
    expect(runtime.saveCommandAuditDraft()).toBe(true)
    expect(messages()[0].text).toBe('uptime -p')
    expect(messages()[0].contentParts?.[0]).toMatchObject({ ref: { command: 'uptime -p' } })
    expect(messages()[0].commandExecutionStatus).toBeUndefined()
    expect(messages()[0].commandExecutionMessage).toBeUndefined()
    expect(messages()[0].executedCommand).toBeUndefined()
    expect(calls.syncCurrentConversationSnapshot).toHaveBeenCalledWith({ notifyFailure: true, notifyUnavailable: true })
    expect(notices.at(-1)).toBe('命令已更新。')

    runtime.closeCommandAuditDialog()
    expect(state.commandAuditDialog).toEqual({ open: false, messageId: '', draft: '' })
  })

  it('rejects commands and refuses to run rejected messages', async () => {
    const { calls, messages, notices, runtime } = createHarness()
    const message = messages()[0]

    expect(runtime.rejectMessageCommand(message)).toBe(true)
    expect(message.action).toBe('rejected')
    expect(message.commandExecutionMessage).toBe('已拒绝执行。')
    expect(notices.at(-1)).toBe('命令已拒绝。')

    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(notices.at(-1)).toBe('命令已拒绝，无法执行。')
  })

  it('marks empty, unavailable, approval, and blocked run decisions', async () => {
    const emptyHarness = createHarness()
    const emptyMessage = { id: 'empty', role: 'assistant', text: '', state: 'done' } as AiPanelCommandSuggestionMessage
    await expect(emptyHarness.runtime.runMessageCommand(emptyMessage)).resolves.toBe(false)
    expect(emptyMessage.commandExecutionStatus).toBe('failed')
    expect(emptyHarness.notices.at(-1)).toBe('没有可运行的命令。')

    const unavailable = createHarness({ terminalDecision: null })
    await expect(unavailable.runtime.runMessageCommand(unavailable.messages()[0])).resolves.toBe(false)
    expect(unavailable.messages()[0].commandExecutionStatus).toBe('failed')
    expect(unavailable.notices.at(-1)).toBe('目标终端会话不可用，请重新连接对应主机。')

    const needsApproval = createHarness({
      terminalDecision: {
        status: 'needs-approval',
        prompt: {
          id: 'prompt-1',
          command: 'rm tmp',
          panelIds: ['terminal-1'],
          source: 'agent',
          result: { isAllowed: true, requiresApproval: true, reason: 'review' },
          execution: {
            command: 'rm tmp',
            panelIds: ['terminal-1'],
            inputText: 'rm tmp\n',
            writeToShell: true,
            source: 'agent'
          }
        }
      }
    })
    await expect(needsApproval.runtime.runMessageCommand(needsApproval.messages()[0])).resolves.toMatchObject({ status: 'needs-approval' })
    expect(needsApproval.messages()[0].commandExecutionStatus).toBe('pending')
    expect(needsApproval.notices.at(-1)).toBe('命令已送入终端安全确认。')

    const blocked = createHarness({
      terminalDecision: {
        status: 'blocked',
        command: 'rm -rf /tmp',
        result: { isAllowed: false, requiresApproval: false, reason: 'blocked' }
      }
    })
    await expect(blocked.runtime.runMessageCommand(blocked.messages()[0])).resolves.toMatchObject({ status: 'blocked' })
    expect(blocked.messages()[0].commandExecutionStatus).toBe('failed')
    expect(blocked.notices.at(-1)).toBe('命令被安全策略拦截。')
  })

  it('runs target-bound command cards without continuing the Agent loop', async () => {
    const { calls, messages, notices, runtime } = createHarness({ chatMode: 'cmd' })
    const message = messages()[0]

    await expect(runtime.runMessageCommand(message)).resolves.toMatchObject({ status: 'allow' })
    expect(calls.runTerminalCommand).toHaveBeenCalledWith('terminal-1', 'uptime', 'agent')
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(calls.continueAgentCommandLoop).not.toHaveBeenCalled()
    expect(message.executedCommand).toBe('uptime')
    expect(message.commandExecutionStatus).toBe('succeeded')
    expect(message.commandExecutionMessage).toBe('已发送到终端：uptime')
    expect(notices.at(-1)).toBe('命令已写入终端输入区。')
  })

  it('routes Cline Agent command approvals through the backend without writing from the renderer', async () => {
    const { calls, notices, runtime, setMessages, state } = createHarness({ chatMode: 'agent' })
    const message: AiPanelCommandSuggestionMessage = {
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'systemctl restart api',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'current terminal',
        command: 'systemctl restart api',
        requiresApproval: true,
        interactive: false
      },
      commandExecutionStatus: 'pending',
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        toolCallId: 'tool-1',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    }
    setMessages([message])

    expect(runtime.openCommandAuditDialog(message)).toBe(true)
    state.commandAuditDialog.draft = 'echo renderer-replacement'
    expect(runtime.canEditActiveCommandAudit()).toBe(false)
    expect(runtime.saveCommandAuditDraft()).toBe(false)
    expect(message.commandExecution?.command).toBe('systemctl restart api')
    expect(notices.at(-1)).toBe('待审批的 Agent 命令必须原样确认或拒绝。')
    runtime.closeCommandAuditDialog()

    await expect(runtime.runMessageCommand(message)).resolves.toMatchObject({ status: 'approved' })
    expect(calls.respondClineAgentApproval).toHaveBeenCalledWith({
      taskId: 'request-1',
      turnId: 'request-1-assistant',
      toolCallId: 'tool-1',
      toolName: 'run_host_command',
      targetId: 'asset-prod',
      targetLabel: 'production',
      terminalSessionId: 'terminal-session-1',
      approved: true,
      reason: undefined
    })
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(calls.continueAgentCommandLoop).not.toHaveBeenCalled()
    expect(message.agentTask?.status).toBe('running')
    expect(message.commandExecutionStatus).toBe('running')
    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)
    expect(calls.respondClineAgentApproval).toHaveBeenCalledTimes(1)
  })

  it('preserves a tool result that arrives before the Cline approval response', async () => {
    const { calls, runtime, setMessages } = createHarness({ chatMode: 'agent' })
    const message: AiPanelCommandSuggestionMessage = {
      id: 'request-race-assistant',
      role: 'assistant',
      text: 'free -h',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'current terminal',
        command: 'free -h',
        requiresApproval: false,
        interactive: false
      },
      commandExecutionStatus: 'pending',
      agentTask: {
        taskId: 'request-race',
        turnId: 'request-race-assistant',
        toolCallId: 'tool-race',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    }
    setMessages([message])
    const approval = deferred<Awaited<ReturnType<typeof calls.respondClineAgentApproval>>>()
    calls.respondClineAgentApproval.mockImplementationOnce(() => approval.promise)

    const pendingRun = runtime.runMessageCommand(message)
    expect(message.commandExecutionStatus).toBe('running')

    const completedMessage: AiPanelCommandSuggestionMessage = {
      ...message,
      action: 'approved',
      commandExecutionStatus: 'succeeded',
      commandExecutionMessage: '命令已由 Cline Agent 执行，结果已回传。',
      executedCommand: 'free -h',
      agentTask: { ...message.agentTask!, status: 'running' }
    }
    setMessages([completedMessage])
    approval.resolve({
      ok: true,
      data: {
        taskId: 'request-race',
        turnId: 'request-race-assistant',
        toolCallId: 'tool-race',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'approved'
      }
    })

    await expect(pendingRun).resolves.toMatchObject({ status: 'approved' })
    expect(completedMessage).toMatchObject({
      action: 'approved',
      commandExecutionStatus: 'succeeded',
      commandExecutionMessage: '命令已由 Cline Agent 执行，结果已回传。',
      executedCommand: 'free -h',
      agentTask: { status: 'running' }
    })
  })

  it('preserves a terminal task event that arrives before a failed Cline approval response', async () => {
    const { calls, runtime, setMessages } = createHarness({ chatMode: 'agent' })
    const message: AiPanelCommandSuggestionMessage = {
      id: 'request-cancelled-assistant',
      role: 'assistant',
      text: 'top -bn1',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'current terminal',
        command: 'top -bn1',
        requiresApproval: false,
        interactive: false
      },
      commandExecutionStatus: 'pending',
      agentTask: {
        taskId: 'request-cancelled',
        turnId: 'request-cancelled-assistant',
        toolCallId: 'tool-cancelled',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    }
    setMessages([message])
    const approval = deferred<Awaited<ReturnType<typeof calls.respondClineAgentApproval>>>()
    calls.respondClineAgentApproval.mockImplementationOnce(() => approval.promise)

    const pendingRun = runtime.runMessageCommand(message)
    message.commandExecutionStatus = 'failed'
    message.commandExecutionMessage = 'Agent 任务已取消，命令未执行。'
    message.agentTask = { ...message.agentTask!, status: 'cancelled' }
    approval.resolve({
      ok: false,
      errorCode: 'CLINE_AGENT_APPROVAL_NOT_FOUND',
      errorMessage: 'The Cline Agent approval is no longer pending.'
    })

    await expect(pendingRun).resolves.toBe(false)
    expect(message).toMatchObject({
      commandExecutionStatus: 'failed',
      commandExecutionMessage: 'Agent 任务已取消，命令未执行。',
      agentTask: { status: 'cancelled' }
    })
  })

  it('settles a stale Cline approval instead of restoring the card to pending', async () => {
    const { calls, notices, runtime, setMessages } = createHarness({ chatMode: 'agent' })
    const message: AiPanelCommandSuggestionMessage = {
      id: 'request-stale-assistant',
      role: 'assistant',
      text: 'systemctl restart api',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'current terminal',
        command: 'systemctl restart api',
        requiresApproval: true,
        interactive: false
      },
      commandExecutionStatus: 'pending',
      agentTask: {
        taskId: 'request-stale',
        turnId: 'request-stale-assistant',
        toolCallId: 'tool-stale',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    }
    setMessages([message])
    calls.respondClineAgentApproval.mockResolvedValueOnce({
      ok: false,
      errorCode: 'CLINE_AGENT_APPROVAL_NOT_FOUND',
      errorMessage: 'The Cline Agent approval is no longer pending.'
    })

    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)
    expect(message).toMatchObject({
      commandExecutionStatus: 'failed',
      commandExecutionMessage: '原 Cline Agent 任务已结束，无法恢复旧确认，请重新发起请求。',
      agentTask: { status: 'cancelled', restored: true }
    })
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(notices.at(-1)).toBe('原 Cline Agent 任务已结束，无法恢复旧确认，请重新发起请求。')

    await expect(runtime.runMessageCommand(message)).resolves.toBe(false)
    expect(calls.respondClineAgentApproval).toHaveBeenCalledTimes(1)
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
  })

  it('settles the original card when a stale approval returns after its projection was detached', async () => {
    const { calls, runtime, setMessages } = createHarness({ chatMode: 'agent' })
    const message: AiPanelCommandSuggestionMessage = {
      id: 'request-detached-assistant',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'current terminal',
        command: 'uptime',
        requiresApproval: false,
        interactive: false
      },
      commandExecutionStatus: 'pending',
      agentTask: {
        taskId: 'request-detached',
        turnId: 'request-detached-assistant',
        toolCallId: 'tool-detached',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    }
    setMessages([message])
    const approval = deferred<Awaited<ReturnType<typeof calls.respondClineAgentApproval>>>()
    calls.respondClineAgentApproval.mockImplementationOnce(() => approval.promise)

    const pendingRun = runtime.runMessageCommand(message)
    setMessages([])
    approval.resolve({
      ok: false,
      errorCode: 'CLINE_AGENT_APPROVAL_NOT_FOUND',
      errorMessage: 'The Cline Agent approval is no longer pending.'
    })

    await expect(pendingRun).resolves.toBe(false)
    expect(message).toMatchObject({
      commandExecutionStatus: 'failed',
      commandExecutionMessage: '原 Cline Agent 任务已结束，无法恢复旧确认，请重新发起请求。',
      agentTask: { status: 'cancelled', restored: true }
    })
  })

  it('enables Cline session read-only auto-run through the approval boundary without renderer execution', async () => {
    const { calls, notices, runtime, setMessages } = createHarness({ chatMode: 'agent' })
    const message: AiPanelCommandSuggestionMessage = {
      id: 'request-read-only-assistant',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'current terminal',
        command: 'uptime',
        requiresApproval: false,
        interactive: false
      },
      commandExecutionStatus: 'pending',
      agentTask: {
        taskId: 'request-read-only',
        turnId: 'request-read-only-assistant',
        toolCallId: 'tool-read-only',
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    }
    setMessages([message])
    calls.respondClineAgentApproval.mockImplementationOnce(async (approval: any) => ({
      ok: true,
      data: {
        taskId: approval.taskId,
        turnId: approval.turnId,
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        targetId: approval.targetId,
        targetLabel: approval.targetLabel,
        terminalSessionId: approval.terminalSessionId,
        status: 'approved' as const,
        readOnlyAutoRunEnabled: true
      }
    }))

    await expect(runtime.runMessageCommand(message, { autoReadOnly: true })).resolves.toMatchObject({
      status: 'approved',
      readOnlyAutoRunEnabled: true
    })
    expect(calls.respondClineAgentApproval).toHaveBeenCalledWith({
      taskId: 'request-read-only',
      turnId: 'request-read-only-assistant',
      toolCallId: 'tool-read-only',
      toolName: 'run_host_command',
      targetId: 'asset-prod',
      targetLabel: 'production',
      terminalSessionId: 'terminal-session-1',
      approved: true,
      enableReadOnlyAutoRun: true,
      reason: undefined
    })
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(calls.enableAgentReadOnlyAutoRunForCurrentConversation).not.toHaveBeenCalled()
    expect(notices.at(-1)).toBe('已开启本会话查询类自动执行，并继续分析。')
  })

  it('continues agent command loops and records returned output status', async () => {
    const { calls, messages, notices, runtime } = createHarness({ chatMode: 'agent' })
    const message = messages()[1]

    await expect(runtime.runMessageCommand(message)).resolves.toMatchObject({ status: 'continued' })
    expect(calls.continueAgentCommandLoop).toHaveBeenCalledWith({
      commandMessageId: 'agent-command',
      command: 'df -h',
      commandExecution: {
        ip: '127.0.0.1',
        command: 'df -h',
        requiresApproval: false,
        interactive: false
      },
      terminalPanelId: 'terminal-1',
      outputStartLength: 'prompt\n'.length
    })
    expect(message.executedCommand).toBe('df -h')
    expect(message.commandExecutionStatus).toBe('succeeded')
    expect(message.commandExecutionMessage).toBe('命令输出已回传 Agent：df -h')
    expect(notices.at(-1)).toBe('命令输出已回传 Agent，正在继续分析。')
  })

  it('settles the command as failed when the agent loop does not continue', async () => {
    const { messages, notices, runtime } = createHarness({
      chatMode: 'agent',
      loopResult: { status: 'cancelled', reason: 'Agent loop cancelled.' }
    })
    const message = messages()[1]

    await expect(runtime.runMessageCommand(message)).resolves.toMatchObject({ status: 'cancelled' })
    expect(message.commandExecutionStatus).toBe('failed')
    expect(message.commandExecutionMessage).toBe('Agent loop cancelled.')
    expect(notices.at(-1)).toBe('Agent loop cancelled.')
  })

  it('enables read-only auto-run when explicitly requested in agent mode', async () => {
    const { calls, messages, notices, runtime } = createHarness({ chatMode: 'agent' })
    const message = messages()[1]

    await expect(runtime.runMessageCommand(message, { autoReadOnly: true })).resolves.toMatchObject({ status: 'continued' })
    expect(calls.enableAgentReadOnlyAutoRunForCurrentConversation).toHaveBeenCalled()
    expect(message.commandExecutionMessage).toBe('命令输出已回传 Agent：df -h')
    expect(notices.at(-1)).toBe('已开启本会话查询类自动执行，并继续分析。')
  })

  it('saves and runs audit draft against the active command message', async () => {
    const { calls, messages, runtime, state } = createHarness()

    runtime.openCommandAuditDialog(messages()[0])
    state.commandAuditDialog.draft = 'uptime -s'
    await expect(runtime.runCommandAuditDraft()).resolves.toMatchObject({ status: 'allow' })
    expect(state.commandAuditDialog.open).toBe(false)
    expect(calls.runTerminalCommand).toHaveBeenCalledWith('terminal-1', 'uptime -s', 'agent')
    expect(calls.runActiveTerminalCommand).not.toHaveBeenCalled()
    expect(messages()[0].executedCommand).toBe('uptime -s')
  })

  it('resolves only a terminal with an exact canonical Classic target binding', () => {
    const terminal = {
      id: 'terminal',
      kind: 'terminal',
      sessionId: 'session-1',
      classicTarget: { targetId: 'asset-1', terminalSessionId: 'session-1', label: 'prod', kind: 'ssh' as const },
      output: ''
    }
    const binding = { targetId: 'asset-1', targetLabel: 'prod', terminalSessionId: 'session-1' }
    expect(resolveAiPanelCommandActionTerminalPanel([terminal], binding)).toBe(terminal)
    expect(resolveAiPanelCommandActionTerminalPanel([terminal])).toBeNull()
    expect(resolveAiPanelCommandActionTerminalPanel([terminal], { ...binding, targetId: 'asset-other' })).toBeNull()
    expect(resolveAiPanelCommandActionTerminalPanel([terminal], { ...binding, targetLabel: 'other' })).toBeNull()
  })
})
