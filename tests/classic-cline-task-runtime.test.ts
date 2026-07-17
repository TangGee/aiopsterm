import { describe, expect, it } from 'vitest'
import {
  applyClassicClineTaskEvent,
  classicClineActivityForMessages,
  exactClassicApprovalHostTarget,
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
  it('reconstructs an approval target only from one exact three-field binding', () => {
    const targets = [
      { targetId: 'asset-a', terminalSessionId: 'terminal-a', label: 'host-a', kind: 'ssh' as const },
      { targetId: 'asset-b', terminalSessionId: 'terminal-b', label: 'host-b', kind: 'ssh' as const }
    ]

    expect(exactClassicApprovalHostTarget({
      targetId: 'asset-b',
      targetLabel: 'host-b',
      terminalSessionId: 'terminal-b'
    }, targets)).toEqual(targets[1])
    expect(exactClassicApprovalHostTarget({
      targetId: 'asset-missing',
      targetLabel: 'host-b',
      terminalSessionId: 'terminal-b'
    }, targets)).toBeNull()
    expect(exactClassicApprovalHostTarget({
      targetId: 'asset-b',
      targetLabel: 'host-b',
      terminalSessionId: 'terminal-a'
    }, targets)).toBeNull()
    expect(exactClassicApprovalHostTarget({
      targetId: 'asset-b',
      targetLabel: 'host-a',
      terminalSessionId: 'terminal-b'
    }, targets)).toBeNull()
    expect(exactClassicApprovalHostTarget({
      targetId: undefined,
      targetLabel: 'host-a',
      terminalSessionId: 'terminal-a'
    }, targets)).toBeNull()
  })

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

  it('distinguishes an operator approval wait from active processing', () => {
    const running: ChatMessage = {
      id: 'running-command',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      commandExecutionStatus: 'succeeded',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'running' }
    }
    const waiting: ChatMessage = {
      id: 'waiting-command',
      role: 'assistant',
      text: 'nproc',
      state: 'done',
      ask: 'command',
      commandExecutionStatus: 'pending',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'waiting-approval' }
    }

    expect(classicClineActivityForMessages([running])).toBe('processing')
    expect(classicClineActivityForMessages([running, waiting])).toBe('waiting-approval')
    expect(classicClineActivityForMessages([{ ...waiting, commandExecutionStatus: 'running' }])).toBe('processing')
    expect(classicClineActivityForMessages([{ ...running, agentTask: { ...running.agentTask!, status: 'done' } }])).toBe('idle')
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
      targetId: 'asset-prod',
      targetLabel: 'production',
      input: { targetId: 'asset-prod', command: 'systemctl restart api' },
      iteration: 1,
      reason: 'State-changing command'
    }))).toBe(true)

    expect(messages[0]).toMatchObject({
      ask: 'command',
      text: 'systemctl restart api',
      state: 'done',
      commandExecutionStatus: 'pending',
      commandExecution: { ip: 'production' },
      agentTask: {
        toolCallId: 'tool-1',
        terminalSessionId: 'terminal-session-1',
        targetId: 'asset-prod',
        targetLabel: 'production',
        status: 'waiting-approval'
      }
    })
  })

  it('preserves the main-owned auto-approval decision on approval cards', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'starting' }
    }]

    expect(applyClassicClineTaskEvent(messages, event({
      type: 'approval-requested',
      toolCallId: 'tool-read-only',
      toolName: 'run_host_command',
      targetId: 'asset-prod',
      targetLabel: 'production',
      terminalSessionId: 'terminal-session-1',
      input: { targetId: 'asset-prod', command: 'uptime' },
      iteration: 1,
      autoApprovable: true
    }))).toBe(true)
    expect(messages[0].commandExecution).toMatchObject({ command: 'uptime', requiresApproval: false })
  })

  it('projects host inspection approval as a target-bound read card and keeps final text after it', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '正在请求...',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'starting' }
    }]

    expect(applyClassicClineTaskEvent(messages, event({
      type: 'approval-requested',
      toolCallId: 'tool-read-file',
      toolName: 'read_host_file',
      targetId: 'asset-prod',
      targetLabel: 'production',
      terminalSessionId: 'terminal-session-1',
      input: { targetId: 'asset-prod', path: '/var/log/api.log', offset: 0, limit: 20 },
      iteration: 1,
      autoApprovable: false
    }))).toBe(true)
    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-read-file',
      toolName: 'read_host_file',
      output: { content: 'api ready' }
    }, 2))
    applyClassicClineTaskEvent(messages, event({
      type: 'done',
      text: '日志显示服务已就绪。',
      finishReason: 'stop',
      iterations: 1
    }, 3))

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      ask: 'mcp_tool_call',
      mcpToolCall: {
        serverName: 'production',
        toolName: 'read_host_file',
        arguments: { path: '/var/log/api.log', offset: 0, limit: 20 }
      },
      agentTask: {
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        toolCallId: 'tool-read-file',
        status: 'done'
      }
    })
    expect(messages[0].mcpToolCall?.arguments).not.toHaveProperty('targetId')
    expect(messages[1]).toMatchObject({ text: '日志显示服务已就绪。', state: 'done', agentTask: { status: 'done' } })
  })

  it('projects an MCP resource approval without host or credential fields', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'starting' }
    }]

    expect(applyClassicClineTaskEvent(messages, event({
      type: 'approval-requested',
      toolCallId: 'tool-resource',
      toolName: 'access_mcp_resource',
      serverName: 'inventory',
      resourceUri: 'inventory://hosts',
      input: { serverName: 'inventory', uri: 'inventory://hosts' },
      iteration: 1,
      autoApprovable: false
    }))).toBe(true)

    expect(messages[0]).toMatchObject({
      ask: 'mcp_resource_access',
      mcpResourceAccess: { serverName: 'inventory', uri: 'inventory://hosts' },
      agentTask: { toolCallId: 'tool-resource', toolName: 'access_mcp_resource', status: 'waiting-approval' }
    })
    expect(messages[0].agentTask?.targetId).toBeUndefined()
    expect(JSON.stringify(messages[0])).not.toContain('authorization')

    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-resource',
      toolName: 'access_mcp_resource',
      error: 'Resource read failed.'
    }, 2))
    expect(messages[0]).toMatchObject({
      action: 'rejected',
      commandExecutionMessage: 'Resource read failed.',
      agentTask: { status: 'running' }
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
      targetId: 'asset-prod',
      targetLabel: 'production',
      terminalSessionId: 'terminal-session-1',
      input: { targetId: 'asset-prod', command: 'journalctl -u api -n 50' },
      iteration: 2
    }, 5))

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      text: 'journalctl -u api -n 50',
      ask: 'command',
      agentTask: { toolCallId: 'tool-2', status: 'waiting-approval' }
    })
  })

  it('keeps every host tool call bound to its own command card', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      ask: 'command',
      commandExecutionStatus: 'pending',
      commandExecution: { ip: 'current terminal', command: 'uptime', requiresApproval: false, interactive: false },
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        terminalSessionId: 'terminal-session-1',
        toolCallId: 'tool-1',
        toolName: 'run_host_command',
        status: 'waiting-approval'
      }
    }]

    const tools = [
      { id: 'tool-1', command: 'uptime', output: 'up 10 days' },
      { id: 'tool-2', command: 'top -bn1 | head -n 20', output: 'top output' },
      { id: 'tool-3', command: 'free -h', output: 'Mem: 46Gi' }
    ]
    tools.forEach((tool, index) => {
      const seq = 4 + index * 3
      applyClassicClineTaskEvent(messages, event({
        type: 'tool-call',
        toolCallId: tool.id,
        toolName: 'run_host_command',
        input: { command: tool.command },
        iteration: index + 1
      }, seq))
      applyClassicClineTaskEvent(messages, event({
        type: 'approval-requested',
        toolCallId: tool.id,
        toolName: 'run_host_command',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-session-1',
        input: { targetId: 'asset-prod', command: tool.command },
        iteration: index + 1
      }, seq + 1))
      applyClassicClineTaskEvent(messages, event({
        type: 'tool-result',
        toolCallId: tool.id,
        toolName: 'run_host_command',
        output: { stdout: tool.output }
      }, seq + 2))
    })

    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({
      text: 'uptime',
      commandExecutionStatus: 'succeeded',
      agentTask: { toolCallId: 'tool-1', status: 'running' }
    })
    expect(messages[1]).toMatchObject({
      text: 'top -bn1 | head -n 20',
      commandExecutionStatus: 'succeeded',
      agentTask: { toolCallId: 'tool-2', status: 'running' }
    })
    expect(messages[2]).toMatchObject({
      text: 'free -h',
      commandExecutionStatus: 'succeeded',
      agentTask: { toolCallId: 'tool-3', status: 'running' }
    })
    expect(new Set(messages.map((message) => message.agentTask?.toolCallId))).toEqual(
      new Set(['tool-1', 'tool-2', 'tool-3'])
    )
  })

  it('prefers a deterministic tool card over a legacy root card polluted with the same tool id', () => {
    const task = {
      taskId: 'request-1',
      turnId: 'request-1-assistant',
      terminalSessionId: 'terminal-session-1',
      toolCallId: 'tool-2',
      toolName: 'run_host_command',
      status: 'running' as const
    }
    const messages: ChatMessage[] = [
      {
        id: 'request-1-assistant',
        role: 'assistant',
        text: 'uptime',
        state: 'done',
        ask: 'command',
        commandExecutionStatus: 'pending',
        commandExecution: { ip: 'current terminal', command: 'uptime', requiresApproval: false, interactive: false },
        agentTask: { ...task }
      },
      {
        id: 'request-1-assistant-cline-command-tool-2',
        role: 'assistant',
        text: 'top -bn1 | head -n 20',
        state: 'done',
        ask: 'command',
        commandExecutionStatus: 'running',
        commandExecution: {
          ip: 'current terminal',
          command: 'top -bn1 | head -n 20',
          requiresApproval: false,
          interactive: false
        },
        agentTask: { ...task }
      }
    ]

    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-2',
      toolName: 'run_host_command',
      output: { stdout: 'top output' }
    }, 12))

    expect(messages[0]).toMatchObject({ text: 'uptime', commandExecutionStatus: 'pending' })
    expect(messages[1]).toMatchObject({
      text: 'top -bn1 | head -n 20',
      commandExecutionStatus: 'succeeded',
      executedCommand: 'top -bn1 | head -n 20'
    })
  })

  it('keeps a preamble above an automatically approved command and appends the answer', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '我先检查内存。',
      state: 'streaming',
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        terminalSessionId: 'terminal-session-1',
        status: 'running'
      }
    }]

    applyClassicClineTaskEvent(messages, event({
      type: 'tool-call',
      toolCallId: 'tool-auto',
      toolName: 'run_host_command',
      terminalSessionId: 'terminal-session-2',
      targetId: 'asset-db',
      targetLabel: 'database-01',
      input: { targetId: 'asset-db', command: 'free -h' },
      iteration: 3
    }, 8))
    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-auto',
      toolName: 'run_host_command',
      output: { stdout: 'Mem: 46Gi' }
    }, 9))
    applyClassicClineTaskEvent(messages, event({
      type: 'done',
      text: '负载检查完成。',
      finishReason: 'stop',
      iterations: 3
    }, 10))

    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ text: '我先检查内存。', state: 'done' })
    expect(messages[1]).toMatchObject({
      text: 'free -h',
      ask: 'command',
      action: 'approved',
      commandExecutionStatus: 'succeeded',
      commandExecution: { ip: 'database-01', requiresApproval: false },
      agentTask: {
        terminalSessionId: 'terminal-session-2',
        targetId: 'asset-db',
        targetLabel: 'database-01',
        toolCallId: 'tool-auto',
        status: 'done'
      }
    })
    expect(messages[2]).toMatchObject({
      id: 'request-1-assistant-cline-result',
      text: '负载检查完成。',
      state: 'done',
      agentTask: { status: 'done' }
    })
  })

  it('keeps text and multiple tool cards in event order', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '我先收集主机信息。',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'running' }
    }]

    const tools = [
      { id: 'tool-1', command: 'uptime' },
      { id: 'tool-2', command: 'free -h' }
    ]
    tools.forEach((tool, index) => {
      const seq = index * 3 + 2
      applyClassicClineTaskEvent(messages, event({
        type: 'tool-call',
        toolCallId: tool.id,
        toolName: 'run_host_command',
        input: { command: tool.command },
        iteration: index + 1
      }, seq))
      applyClassicClineTaskEvent(messages, event({
        type: 'tool-result',
        toolCallId: tool.id,
        toolName: 'run_host_command',
        output: { stdout: `${tool.command} output` }
      }, seq + 1))
    })

    applyClassicClineTaskEvent(messages, event({
      type: 'done',
      text: '主机信息已收集完成。',
      finishReason: 'stop',
      iterations: 2
    }, 10))

    expect(messages.map((message) => message.text)).toEqual([
      '我先收集主机信息。',
      'uptime',
      'free -h',
      '主机信息已收集完成。'
    ])
    expect(messages.slice(1, 3).map((message) => message.agentTask?.toolCallId)).toEqual(['tool-1', 'tool-2'])
    expect(messages.at(-1)).toMatchObject({ id: 'request-1-assistant-cline-result', state: 'done', agentTask: { status: 'done' } })
  })

  it('does not count the initial placeholder as content before tool cards', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '正在请求 aiopsterm AI 后端...',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'running' }
    }]

    for (const [seq, tool] of [[2, 'uptime'], [5, 'nproc']] as const) {
      applyClassicClineTaskEvent(messages, event({
        type: 'tool-call',
        toolCallId: `tool-${tool}`,
        toolName: 'run_host_command',
        input: { command: tool },
        iteration: 1
      }, seq))
      applyClassicClineTaskEvent(messages, event({
        type: 'tool-result',
        toolCallId: `tool-${tool}`,
        toolName: 'run_host_command',
        output: { stdout: `${tool} output` }
      }, seq + 1))
    }
    applyClassicClineTaskEvent(messages, event({
      type: 'done',
      text: '负载检查完成。',
      finishReason: 'stop',
      iterations: 2
    }, 8))

    expect(messages.map((message) => message.text)).toEqual(['uptime', 'nproc', '负载检查完成。'])
    expect(messages.map((message) => message.id)).toEqual([
      'request-1-assistant',
      'request-1-assistant-cline-command-tool-nproc',
      'request-1-assistant-cline-result'
    ])
    expect(messages[0]).toMatchObject({ ask: 'command', agentTask: { toolCallId: 'tool-uptime' } })
    expect(messages.at(-1)).toMatchObject({ id: 'request-1-assistant-cline-result', state: 'done' })
  })

  it('keeps interleaved assistant text and tool calls in emitted order', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: '正在请求...',
      state: 'streaming',
      agentTask: { taskId: 'request-1', turnId: 'request-1-assistant', status: 'running' }
    }]

    applyClassicClineTaskEvent(messages, event({
      type: 'text-delta',
      text: '先检查负载。',
      accumulated: '先检查负载。'
    }, 1))
    applyClassicClineTaskEvent(messages, event({
      type: 'tool-call',
      toolCallId: 'tool-uptime',
      toolName: 'run_host_command',
      input: { command: 'uptime' },
      iteration: 1
    }, 2))
    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-uptime',
      toolName: 'run_host_command',
      output: { stdout: 'up 10 days' }
    }, 3))
    applyClassicClineTaskEvent(messages, event({
      type: 'text-delta',
      text: '再检查 CPU 数量。',
      accumulated: '再检查 CPU 数量。'
    }, 4))
    applyClassicClineTaskEvent(messages, event({
      type: 'tool-call',
      toolCallId: 'tool-nproc',
      toolName: 'run_host_command',
      input: { command: 'nproc' },
      iteration: 2
    }, 5))
    applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-nproc',
      toolName: 'run_host_command',
      output: { stdout: '16' }
    }, 6))
    applyClassicClineTaskEvent(messages, event({
      type: 'done',
      text: '检查完成。',
      finishReason: 'stop',
      iterations: 2
    }, 7))

    expect(messages.map((message) => message.text)).toEqual([
      '先检查负载。',
      'uptime',
      '再检查 CPU 数量。',
      'nproc',
      '检查完成。'
    ])
    expect(messages.map((message) => message.id)).toEqual([
      'request-1-assistant',
      'request-1-assistant-cline-command-tool-uptime',
      'request-1-assistant-cline-result',
      'request-1-assistant-cline-command-tool-nproc',
      'request-1-assistant-cline-result-1'
    ])
  })

  it('keeps a rejected host tool marked as not executed when Cline reports its error result', () => {
    const messages: ChatMessage[] = [{
      id: 'request-1-assistant',
      role: 'assistant',
      text: 'systemctl restart api',
      state: 'done',
      ask: 'command',
      action: 'rejected',
      commandExecutionStatus: 'failed',
      commandExecutionMessage: '已拒绝执行。',
      commandExecution: {
        ip: 'current terminal',
        command: 'systemctl restart api',
        requiresApproval: true,
        interactive: false
      },
      agentTask: {
        taskId: 'request-1',
        turnId: 'request-1-assistant',
        terminalSessionId: 'terminal-session-1',
        toolCallId: 'tool-rejected',
        toolName: 'run_host_command',
        status: 'cancelled'
      }
    }]

    expect(applyClassicClineTaskEvent(messages, event({
      type: 'tool-result',
      toolCallId: 'tool-rejected',
      toolName: 'run_host_command',
      output: { error: 'The operator rejected the host command.' }
    }, 4))).toBe(true)

    expect(messages[0]).toMatchObject({
      action: 'rejected',
      commandExecutionStatus: 'failed',
      commandExecutionMessage: '已拒绝执行。',
      agentTask: { status: 'cancelled' }
    })
    expect(messages[0].executedCommand).toBeUndefined()
  })

  it.each([
    {
      label: 'done',
      payload: { type: 'done', text: '', finishReason: 'stop', iterations: 2 },
      status: 'done',
      message: 'Agent 任务已结束，但未收到该命令的执行结果。'
    },
    {
      label: 'cancelled',
      payload: { type: 'cancelled', reason: '操作员已停止任务。' },
      status: 'cancelled',
      message: '操作员已停止任务。'
    },
    {
      label: 'error',
      payload: { type: 'error', errorCode: 'TEST_ERROR', errorMessage: 'Agent 执行失败。', recoverable: false },
      status: 'error',
      message: 'Agent 执行失败。'
    },
    {
      label: 'interrupted',
      payload: { type: 'status', status: 'interrupted', message: 'Agent 连接已中断。' },
      status: 'error',
      message: 'Agent 连接已中断。'
    }
  ])('settles every unfinished command card when a turn ends as $label', ({ payload, status, message: statusMessage }) => {
    const messages: ChatMessage[] = [
      {
        id: 'request-1-assistant',
        role: 'assistant',
        text: 'uptime',
        state: 'done',
        ask: 'command',
        commandExecutionStatus: 'running',
        commandExecution: { ip: 'current terminal', command: 'uptime', requiresApproval: false, interactive: false },
        agentTask: {
          taskId: 'request-1',
          turnId: 'request-1-assistant',
          terminalSessionId: 'terminal-session-1',
          toolCallId: 'tool-1',
          toolName: 'run_host_command',
          status: 'running'
        }
      },
      {
        id: 'request-1-assistant-cline-command-tool-2',
        role: 'assistant',
        text: 'free -h',
        state: 'done',
        ask: 'command',
        commandExecutionStatus: 'pending',
        commandExecution: { ip: 'current terminal', command: 'free -h', requiresApproval: true, interactive: false },
        agentTask: {
          taskId: 'request-1',
          turnId: 'request-1-assistant',
          terminalSessionId: 'terminal-session-1',
          toolCallId: 'tool-2',
          toolName: 'run_host_command',
          status: 'waiting-approval'
        }
      }
    ]

    applyClassicClineTaskEvent(messages, event(payload as ClineAgentTaskEventData, 20))

    expect(messages.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        text: 'uptime',
        commandExecutionStatus: 'failed',
        commandExecutionMessage: statusMessage,
        agentTask: expect.objectContaining({ toolCallId: 'tool-1', status })
      }),
      expect.objectContaining({
        text: 'free -h',
        commandExecutionStatus: 'failed',
        commandExecutionMessage: statusMessage,
        agentTask: expect.objectContaining({ toolCallId: 'tool-2', status })
      })
    ]))
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
