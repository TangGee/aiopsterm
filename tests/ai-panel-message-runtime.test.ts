import { describe, expect, it } from 'vitest'
import { isProxy, reactive } from 'vue'
import {
  aiPanelChatExportMessage,
  aiPanelMessagePlainText,
  applyCommandTextToMessage,
  canEditCommandMessage,
  commandHostForMessage,
  commandHostTooltipForMessage,
  commandLineCountForMessage,
  commandOutputLineCount,
  commandTextForMessage,
  formatAiPanelLineCount,
  isAiPanelCommandSuggestionMessage,
  isCommandTerminalActionDisabled,
  isReadOnlyCommandMessage,
  normalizedCommandOutputText,
  renderAiPanelMarkdownParts,
  setAiPanelCommandExecutionState
} from '@/services/ai/aiPanelMessageRuntime'
import type { AiChatHistoryMessage } from '@shared/contracts/aiChat'

describe('aiPanelMessageRuntime', () => {
  it('renders sanitized markdown and separates fenced code blocks', () => {
    const parts = renderAiPanelMarkdownParts(
      'CPU summary\n\n```sh\nps aux\n```\n\n<script>alert(1)</script>\n[bad](javascript:alert(1))'
    )
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'html',
          html: expect.stringContaining('CPU summary')
        }),
        expect.objectContaining({
          type: 'code',
          language: 'bash',
          code: 'ps aux',
          lineCount: 1
        })
      ])
    )
    const html = parts.map((part) => (part.type === 'html' ? part.html : part.html)).join('')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:alert')
  })

  it('normalizes command output and line counts', () => {
    expect(normalizedCommandOutputText('```text\nline 1\nline 2\n```')).toBe('line 1\nline 2')
    expect(commandOutputLineCount('```text\nline 1\nline 2\n```')).toBe(2)
    expect(formatAiPanelLineCount(0)).toBe('1 line')
    expect(formatAiPanelLineCount(3)).toBe('3 lines')
  })

  it('detects command messages and updates editable command state', () => {
    const chipMessage = {
      id: 'm1',
      role: 'assistant',
      text: 'uptime',
      state: 'done',
      action: 'rejected',
      commandExecutionStatus: 'failed',
      commandExecutionMessage: 'blocked',
      executedCommand: 'uptime',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'uptime', label: 'uptime' } }]
    } satisfies AiChatHistoryMessage

    expect(isAiPanelCommandSuggestionMessage(chipMessage)).toBe(true)
    expect(commandTextForMessage(chipMessage)).toBe('uptime')
    expect(applyCommandTextToMessage(chipMessage, 'uptime -p')).toBe(true)
    expect(chipMessage.text).toBe('uptime -p')
    expect(chipMessage.contentParts?.[0]).toEqual({
      type: 'chip',
      chipType: 'command',
      ref: { command: 'uptime -p', label: 'uptime -p' }
    })
    expect(chipMessage.action).toBeUndefined()
    expect(chipMessage.commandExecutionStatus).toBeUndefined()
    expect(chipMessage.commandExecutionMessage).toBeUndefined()
    expect(chipMessage.executedCommand).toBeUndefined()

    setAiPanelCommandExecutionState(chipMessage, 'running', 'sending')
    expect(isCommandTerminalActionDisabled(chipMessage)).toBe(true)
    expect(chipMessage.commandExecutionMessage).toBe('sending')
  })

  it('disables and locks commands whose Cline approval was stale on restore', () => {
    const restored = {
      id: 'restored-cline-command',
      role: 'assistant',
      text: 'systemctl restart api',
      state: 'done',
      ask: 'command',
      commandExecutionStatus: 'failed',
      commandExecutionMessage: '原 Cline Agent 任务已结束，无法恢复旧确认，请重新发起请求。',
      commandExecution: {
        ip: 'current terminal',
        command: 'systemctl restart api',
        requiresApproval: true,
        interactive: false
      },
      agentTask: {
        taskId: 'task-restored',
        turnId: 'turn-restored',
        toolCallId: 'tool-restored',
        status: 'cancelled' as const,
        restored: true
      }
    } satisfies AiChatHistoryMessage

    expect(isCommandTerminalActionDisabled(restored)).toBe(true)
    expect(canEditCommandMessage(restored)).toBe(false)
  })

  it('projects read-only command host metadata and export messages', () => {
    const message = {
      id: 'm2',
      role: 'assistant',
      text: 'df -h',
      state: 'done',
      ask: 'command',
      hosts: [
        { id: 'host-1', kind: 'hosts', label: 'prod', detail: '10.0.0.8' },
        { id: 'doc-1', kind: 'docs', label: 'Runbook' }
      ],
      commandExecution: {
        ip: '10.0.0.8',
        command: 'df -h',
        requiresApproval: false,
        interactive: false
      }
    } satisfies Omit<AiChatHistoryMessage, 'hosts'> & {
      hosts: Array<{ id: string; kind: string; label: string; detail?: string }>
    }

    expect(isReadOnlyCommandMessage(message)).toBe(true)
    expect(commandLineCountForMessage(message)).toBe(1)
    expect(commandHostForMessage(message)).toBe('Host 10.0.0.8')
    expect(commandHostTooltipForMessage(message)).toBe('目标主机：10.0.0.8')
    expect(aiPanelChatExportMessage(message).hosts).toEqual([{ id: 'host-1', kind: 'hosts', label: 'prod', detail: '10.0.0.8' }])
  })

  it('creates an IPC-cloneable export snapshot from reactive message metadata', () => {
    const message = reactive({
      id: 'm-reactive-export',
      role: 'assistant' as const,
      text: 'inspect service',
      contentParts: [{ type: 'chip' as const, chipType: 'command' as const, ref: { command: 'uptime' } }],
      hosts: [{ id: 'host-reactive', kind: 'hosts', label: 'prod', detail: '10.0.0.8' }],
      commandExecution: {
        ip: '10.0.0.8',
        command: 'uptime',
        requiresApproval: false,
        interactive: false
      },
      agentTask: {
        taskId: 'task-reactive',
        turnId: 'turn-reactive',
        status: 'done' as const
      },
      mcpToolCall: {
        serverName: 'ops',
        toolName: 'inspect',
        arguments: { filters: { service: 'api' } }
      },
      mcpResourceAccess: {
        serverName: 'filesystem',
        uri: 'file:///tmp/runbook.md'
      }
    })

    expect(isProxy(message.contentParts)).toBe(true)
    expect(isProxy(message.mcpToolCall.arguments)).toBe(true)

    const exported = aiPanelChatExportMessage(message)

    expect(isProxy(exported.contentParts)).toBe(false)
    expect(isProxy(exported.commandExecution)).toBe(false)
    expect(isProxy(exported.agentTask)).toBe(false)
    expect(isProxy(exported.mcpToolCall)).toBe(false)
    expect(isProxy(exported.mcpToolCall?.arguments)).toBe(false)
    expect(isProxy(exported.mcpResourceAccess)).toBe(false)
    expect(() => structuredClone(exported)).not.toThrow()
  })

  it('builds display text from structured user content parts', () => {
    expect(
      aiPanelMessagePlainText({
        text: '',
        contentParts: [
          { type: 'text', text: 'review ' },
          { type: 'chip', chipType: 'doc', ref: { absPath: '/runbook.md', name: 'Runbook.md' } },
          { type: 'image', mediaType: 'image/png', data: 'abc', name: 'chart.png' }
        ]
      })
    ).toBe('review @Runbook.md[image: chart.png]')
  })
})
