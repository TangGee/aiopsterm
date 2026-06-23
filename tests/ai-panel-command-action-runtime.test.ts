import { describe, expect, it, vi } from 'vitest'
import {
  createAiPanelCommandActionRuntime,
  createEmptyAiPanelCommandActionRuntimeState,
  resolveAiPanelCommandActionTerminalPanel,
  type AiPanelCommandActionTerminalPanel
} from '@/services/ai/aiPanelCommandActionRuntime'
import type { AiPanelCommandSuggestionMessage } from '@/services/ai/aiPanelMessageRuntime'
import type { TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'

const createHarness = (input: {
  chatMode?: string
  activePanel?: AiPanelCommandActionTerminalPanel
  panels?: AiPanelCommandActionTerminalPanel[]
  terminalDecision?: TerminalSecurityDecision | null
  loopResult?: { status: string; reason?: string }
} = {}) => {
  let messages: AiPanelCommandSuggestionMessage[] = [
    {
      id: 'chip-command',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'uptime', label: 'uptime' } }]
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
    continueAgentCommandLoop: vi.fn(async () => input.loopResult ?? { status: 'continued' }),
    enableAgentReadOnlyAutoRunForCurrentConversation: vi.fn(() => true),
    syncCurrentConversationSnapshot: vi.fn()
  }
  const activePanel = input.activePanel ?? { id: 'terminal-1', kind: 'terminal', output: 'prompt\n' }
  const panels = input.panels ?? [activePanel]
  const runtime = createAiPanelCommandActionRuntime({
    state,
    messages: () => messages,
    activePanel: () => activePanel,
    panels: () => panels,
    chatMode: () => input.chatMode ?? 'cmd',
    copyText: calls.copyText,
    notify: (message) => notices.push(message),
    runActiveTerminalCommand: calls.runActiveTerminalCommand,
    continueAgentCommandLoop: calls.continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation: calls.enableAgentReadOnlyAutoRunForCurrentConversation,
    syncCurrentConversationSnapshot: calls.syncCurrentConversationSnapshot
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
    expect(unavailable.notices.at(-1)).toBe('终端会话不可用，请先打开本地 shell 或连接 SSH。')

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

  it('runs normal command cards by writing to the terminal without continuing agent loop', async () => {
    const { calls, messages, notices, runtime } = createHarness({ chatMode: 'cmd' })
    const message = messages()[0]

    await expect(runtime.runMessageCommand(message)).resolves.toMatchObject({ status: 'allow' })
    expect(calls.runActiveTerminalCommand).toHaveBeenCalledWith('uptime', 'agent')
    expect(calls.continueAgentCommandLoop).not.toHaveBeenCalled()
    expect(message.executedCommand).toBe('uptime')
    expect(message.commandExecutionStatus).toBe('succeeded')
    expect(message.commandExecutionMessage).toBe('已发送到终端：uptime')
    expect(notices.at(-1)).toBe('命令已写入终端输入区。')
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
    expect(calls.runActiveTerminalCommand).toHaveBeenCalledWith('uptime -s', 'agent')
    expect(messages()[0].executedCommand).toBe('uptime -s')
  })

  it('selects a terminal panel when the active panel is knowledge', () => {
    const terminal = { id: 'terminal', kind: 'terminal', output: '' }
    expect(resolveAiPanelCommandActionTerminalPanel({ id: 'knowledge', kind: 'knowledge', output: '' }, [terminal])).toBe(terminal)
    expect(resolveAiPanelCommandActionTerminalPanel(terminal, [terminal])).toBe(terminal)
  })
})
