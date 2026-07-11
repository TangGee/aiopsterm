import { describe, expect, it } from 'vitest'
import {
  applyClassicClineTaskEvent,
  isActiveClassicClineTaskMessage
} from '@/services/ai/classicClineTaskRuntime'
import type { ChatMessage } from '@/services/ai/workspaceAiChatTypes'
import type { ClineAgentTaskEvent, ClineAgentTaskEventData } from '@shared/contracts/clineAgent'

const event = <T extends ClineAgentTaskEventData>(
  payload: T,
  seq = 1
) => ({
  protocolVersion: 1,
  sessionId: 'cline-session',
  taskId: 'request-1',
  turnId: 'request-1-assistant',
  seq,
  at: '2026-07-11T00:00:00.000Z',
  ...payload
}) as ClineAgentTaskEvent

describe('Classic Cline renderer task events', () => {
  it('treats non-streaming approval and command cards as an active Agent turn', () => {
    const message = (status: NonNullable<ChatMessage['agentTask']>['status']): ChatMessage => ({
      id: `message-${status}`,
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status }
    })

    expect(isActiveClassicClineTaskMessage(message('starting'))).toBe(true)
    expect(isActiveClassicClineTaskMessage(message('waiting-approval'))).toBe(true)
    expect(isActiveClassicClineTaskMessage(message('running'))).toBe(true)
    expect(isActiveClassicClineTaskMessage(message('done'))).toBe(false)
    expect(isActiveClassicClineTaskMessage(message('cancelled'))).toBe(false)
  })

  it('turns an approval event into a terminal-bound command card', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '正在请求...',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'starting' }
    }]

    expect(applyClassicClineTaskEvent(messages, event({
      type: 'approval-requested',
      toolCallId: 'tool-1',
      toolName: 'run_host_command',
      terminalSessionId: 'terminal-session-1',
      input: { command: 'systemctl restart api' },
      iteration: 1,
      reason: 'State-changing command'
    }))).toBe(true)

    expect(messages[0]).toMatchObject({
      ask: 'command',
      text: 'systemctl restart api',
      state: 'done',
      commandExecutionStatus: 'pending',
      agentTask: {
        toolCallId: 'tool-1',
        terminalSessionId: 'terminal-session-1',
        status: 'waiting-approval'
      }
    })
  })

  it('applies tool results and appends the final Agent answer without replacing the command card', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      commandExecution: { ip: 'current terminal', command: 'uptime', requiresApproval: true, interactive: false },
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        terminalSessionId: 'terminal-session-1',
        toolCallId: 'tool-1',
        toolName: 'run_host_command',
        status: 'running'
      }
    }]

    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-1',
      toolName: 'run_host_command',
      output: { stdout: 'up 10 days' }
    }, 2))
    applyClassicClineTaskEvent(messages, event({
      type: 'text-delta',
      text: '主机已持续运行 10 天。',
      accumulated: '主机已持续运行 10 天。'
    }, 3))
    applyClassicClineTaskEvent(messages, event({
      type: 'done',
      text: '主机已持续运行 10 天。',
      finishReason: 'stop',
      iterations: 2
    }, 4))

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ text: 'uptime', commandExecutionStatus: 'succeeded', agentTask: { status: 'done' } })
    expect(messages[1]).toMatchObject({
      id: 'request-1-assistant-cline-result',
      text: '主机已持续运行 10 天。',
      state: 'done',
      agentTask: { status: 'done' }
    })
  })

  it('creates a new command card when the same turn needs another approval', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      commandExecution: { ip: 'current terminal', command: 'uptime', requiresApproval: true, interactive: false },
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        terminalSessionId: 'terminal-session-1',
        toolCallId: 'tool-1',
        toolName: 'run_host_command',
        status: 'running'
      }
    }]

    applyClassicClineTaskEvent(messages, event({
      type: 'approval-requested',
      toolCallId: 'tool-2',
      toolName: 'run_host_command',
      terminalSessionId: 'terminal-session-1',
      input: { command: 'journalctl -u api -n 50' },
      iteration: 2
    }, 5))

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      text: 'journalctl -u api -n 50',
      ask: 'command',
      agentTask: { toolCallId: 'tool-2', status: 'waiting-approval' }
    })
  })

  it('finishes an accumulated result when the final event has no repeated text', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'running' }
    }]
    applyClassicClineTaskEvent(messages, event({ type: 'text-delta', text: '分析完成。', accumulated: '分析完成。' }, 2))
    applyClassicClineTaskEvent(messages, event({ type: 'done', text: '', finishReason: 'tool_complete', iterations: 1 }, 3))

    expect(messages[1]).toMatchObject({ text: '分析完成。', state: 'done', agentTask: { status: 'done' } })
  })

  it('does not mark a Command proposal tool result as host execution', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'df -h',
      state: 'done',
      ask: 'command',
      commandExecution: { ip: 'current terminal', command: 'df -h', requiresApproval: false, interactive: false },
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        toolCallId: 'proposal-1',
        toolName: 'propose_host_command',
        status: 'done'
      }
    }]

    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'proposal-1',
      toolName: 'propose_host_command',
      output: { command: 'df -h' }
    }, 2))

    expect(messages[0].commandExecutionStatus).toBeUndefined()
    expect(messages[0].executedCommand).toBeUndefined()
  })
})
